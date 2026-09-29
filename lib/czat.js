/* ============================================================
   Czat – składanie kontekstu i strumieniowanie odpowiedzi modelu

   To jest miejsce, które robi z Cosmosa „jeden organizm", a nie czat obok
   narzędzi: przed wysłaniem do modelu doklejamy wiadomości systemowe (czas
   i miejsce, profil, sprzęt, percepcję, instrukcje narzędzi, pamięć, bazę
   wiedzy), a odpowiedź czytamy do końca jako BIEG – należy do serwera, nie
   do karty przeglądarki (lib/biegi.js).

   Wydzielone z server.js (runda 4). Dawniej jedna funkcja na ~550 linii;
   teraz nazwane kroki, w kolejności, w jakiej biegnie żądanie:

     zlozKontekst      → wiadomości systemowe i obrazy z bazy wiedzy
     przytnijDoOkna    → budżet okna modelu lokalnego (czysta funkcja)
     wybierzModel      → lista właściciela, model wizyjny do zdjęć
     wyslijDoDostawcy  → żądanie z jedną próbą modelu wizyjnego po odmowie
     odpowiedzBledem*  → czytelne błędy połączenia i dostawcy
     przekazWprost / pompujDoBiegu → strumień do przeglądarki albo do biegu

   Czyste funkcje (bez stanu i bez sieci) są na poziomie modułu i eksportowane
   – test woła je wprost, bez stawiania serwera.
   ============================================================ */

const { modelToolLevel } = require('../public/models.js');
const { blindToImages, zapytajModel, KONIEC_SRODKOW } = require('./model.js');
const { sendJson, readJson, pickEndpoint, modelErrorHint, bladTrwaly, authHeaders, imageProviders, opisBleduSieci, toStronaHtml } = require('./rdzen.js');
const { kto, czyWlasciciel } = require('./kontekst.js');
const konta = require('./konta.js');
const silniki = require('./silniki.js');
const { WLACZONE: KOD_WLACZONY } = require('./kod.js');
const { zbudujInstrukcje, blokSprzetu } = require('./instrukcje-narzedzi.js');
const { sceneContext } = require('./zdarzenia.js');

/* Ile najdłużej model może milczeć: przed nagłówkami i między kawałkami
   strumienia. Modele rozumujące potrafią myśleć długo, ale przysyłają wtedy
   `reasoning_content` – cisza 90 s to już zawieszenie. */
const CISZA_MODELU_MS = Number(process.env.COSMOS_CISZA_MODELU_MS) || 90_000;
/* Odmowa przyjęcia obrazu – po treści, bo kod bywa różny (400 w chmurze,
   500 w Ollamie i llama.cpp bez --mmproj). */
const ODMOWA_OBRAZU = /image|vision|multimodal|mmproj|content.*type/i;
/* Odmowa FORMATU obrazu (BMP, SVG, HEIC u OpenAI i Claude'a) – model widzi,
   tylko nie ten format: model wizyjny nic tu nie zmieni. */
const ODMOWA_FORMATU = /unsupported image|media_type|invalid_image_format|image format/i;
/* Odmowa ROZMIARU obrazu („image exceeds 5 MB maximum” – Claude). Model widzi,
   obraz jest za duży: „wybierz model, który widzi obrazy” było fałszywym tropem
   (zespół IT, runda 9). Przepełnienie okna („maximum context length”) to co innego. */
const ODMOWA_ROZMIARU = /(image|obraz)[^.\n]{0,80}(exceed|too large|too big|maximum|limit)|(exceed|too large|too big)[^.\n]{0,40}image|image size/i;
const odmowaRozmiaru = (t) => ODMOWA_ROZMIARU.test(String(t || '')) && !/context length|maximum context|context window/i.test(String(t || ''));
/* Modele, które myślą PO CICHU: gpt-5+/o* i Claude przez warstwę zgodną nie
   przysyłają `reasoning_content`, więc po nagłówkach potrafią milczeć minutami
   (Claude 5 myśli adaptacyjnie, na trudnym zadaniu długo). Dla nich osobny,
   dłuższy limit – tylko do PIERWSZEJ treści. Za Cloudflare to bezpieczne, bo
   przeglądarka dostaje puls co 25 s (lib/biegi.js); limit przed nagłówkami
   zostaje 90 s, bo wtedy przeglądarka nie ma jeszcze czym oddychać. */
const CISZA_MYSLENIA_MS = Number(process.env.COSMOS_CISZA_MYSLENIA_MS) || 300_000;
/* Ciche ponowienie tylko wtedy, gdy błąd przyszedł szybko po nagłówkach.
   Po minutach cichego myślenia (gpt-5, Claude 5) drugie podejście to drugie
   tyle czekania i prawdopodobnie drugi rachunek za myślenie (runda 9). */
const PONOWIENIE_DO_MS = Number(process.env.COSMOS_PONOWIENIE_DO_MS) || 20_000;
const cichoMysli = (ep, model) => Boolean(ep.anthropic) || /^claude/i.test(model)
  || /^(o\d|gpt-([5-9]|\d{2,}))/i.test(String(model).replace(/^openai\//, ''));

/* Lokalny GPU za uśpionym Tailscale: każda wiadomość czekała ~11,6 s na
   „fetch failed" (limit połączenia), a następna płaciła to samo. Po porażce
   POŁĄCZENIA pamiętamy ją przez 30 s i odpowiadamy od razu, z przyczyną
   rozpoznaną po kodzie błędu zamiast gołego „fetch failed". */
const LOKALNY_BEZPIECZNIK_MS = Number(process.env.COSMOS_BEZPIECZNIK_LOKALNEGO_MS) || 30_000;

/* Modele lokalne spoza katalogu, które odmówiły klatki z kamery (mistral-nemo,
   qwen2.5, phi4 w Ollamie). Katalog ich nie zna, więc o ślepocie dowiadujemy
   się dopiero z odmowy – potem następna klatka idzie od razu bez obrazu.
   Klucz: `adres|model`, do restartu serwera. */
const SLEPE_MODELE = new Set();
const kluczSlepego = (ep, model) => `${ep.baseUrl || ''}|${model || ''}`;
const slepy = (ep, model) => blindToImages(model) || SLEPE_MODELE.has(kluczSlepego(ep, model));

/* Limit ciała czatu. Wspólne 32 MB pozwalało sześcioma równoległymi czatami
   po 24 MB podnieść pamięć serwera o gigabajt. Oficjalna aplikacja zmniejsza
   zdjęcia do 1024 px, więc 16 MB to kilka zdjęć z dużym zapasem. */
const CZAT_MAX_B = Number(process.env.COSMOS_CZAT_MAX_BYTES) || 16 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Czyste funkcje
// ---------------------------------------------------------------------------

function rodzajBleduPolaczenia(err) {
  const kod = String(err?.cause?.code || err?.code || '');
  if (/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(kod)) return 'uspiony';
  if (/ECONNREFUSED/.test(kod)) return 'odmowa';
  if (/ENOTFOUND|EAI_AGAIN/.test(kod)) return 'dns';
  return '';
}

/* Okno kontekstu lokalnego modelu. LOCAL_NUM_CTX, a bez niego: 4096 dla
   Ollamy (jej domyślne; na komputerze domowym ustaw OLLAMA_CONTEXT_LENGTH
   i to samo tutaj), 0 = bez budżetu dla vLLM/NIM, które znają swoje okno
   i odmawiają głośno zamiast obcinać po cichu. */
function oknoLokalneDla(ep) {
  const ustawione = Number(process.env.LOCAL_NUM_CTX);
  if (Number.isFinite(ustawione) && ustawione > 0) return ustawione;
  return /:11434\b/.test(ep.baseUrl || '') ? 4096 : 0;
}

/* vLLM, NIM i llama.cpp znają swoje okno i mówią je same: vLLM w /v1/models
   (`max_model_len`), llama.cpp w /props (`n_ctx`). Bez tego serwer z oknem
   4096 dostawał pełne instrukcje (ok. 3,7 tys. tokenów) i pierwsze pytanie
   o plan kończyło się „Rozmowa jest za długa” (zespół IT, runda 7).
   Odpowiedź pamiętamy 10 minut, także nieudaną – pytanie nie może spowalniać
   każdej wiadomości. Zwraca okno tylko wtedy, gdy jest małe (≤ 8192): przy
   dużym Cosmos zostawia wszystko jak dotąd. */
const OKNA_Z_SERWERA = new Map();
async function oknoZSerwera(ep, model = ep.model) {
  const baza = String(ep.baseUrl || '').replace(/\/+$/, '');
  if (!baza || /:11434\b/.test(baza)) return 0;
  const klucz = `${baza}|${model || ''}`;
  const znane = OKNA_Z_SERWERA.get(klucz);
  if (znane && Date.now() - znane.czas < 10 * 60_000) return znane.okno;
  let okno = 0;
  try {
    const r = await fetch(`${baza}/models`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) {
      const d = await r.json();
      const lista = Array.isArray(d.data) ? d.data : [];
      const m = lista.find((x) => x && x.id === model) || (lista.length === 1 ? lista[0] : null);
      okno = Number(m && m.max_model_len) || 0;
    }
    if (!okno) {
      const r2 = await fetch(`${baza.replace(/\/v1$/, '')}/props`, { signal: AbortSignal.timeout(1500) });
      if (r2.ok) {
        const d2 = await r2.json();
        okno = Number(d2.n_ctx || (d2.default_generation_settings && d2.default_generation_settings.n_ctx)) || 0;
      }
    }
  } catch { /* serwer nie mówi – zostaje jak dotąd */ }
  const wynik = okno > 0 && okno <= 8192 ? okno : 0;
  OKNA_Z_SERWERA.set(klucz, { czas: Date.now(), okno: wynik });
  return wynik;
}

/** Zgrubnie: ile tokenów zajmie treść. Polszczyzna w tokenizerach Llamy
 *  i Qwena to ok. 3 znaki na token; obraz liczymy jak ~800 tokenów. */
function szacujTokeny(tresc) {
  if (typeof tresc === 'string') return Math.ceil(tresc.length / 3) + 4;
  if (Array.isArray(tresc)) {
    return tresc.reduce((a, p) => a + (p.type === 'text' ? Math.ceil(String(p.text || '').length / 3) : 800), 4);
  }
  return 4;
}

/* Typ błędu → kod HTTP. Anthropic (pewne, dokumentacja): typy błędów w SSE
   przed i po message_start. OpenAI i llama.cpp – `code` i `type` z ich
   odpowiedzi błędów (z pamięci, zbieżne z kodami HTTP tych samych błędów). */
const STATUS_TYPU = {
  invalid_request_error: 400, authentication_error: 401, permission_error: 403, not_found_error: 404,
  request_too_large: 413, rate_limit_error: 429, api_error: 500, overloaded_error: 529, billing_error: 402,
  server_error: 500, insufficient_quota: 429, rate_limit_exceeded: 429, context_length_exceeded: 400,
  unavailable_error: 503, invalid_api_key: 401,
};
function statusBledu(e, tresc) {
  const kod = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 400 && n < 600 ? n : 0; };
  if (e && typeof e === 'object') {
    const z = kod(e.status) || kod(e.code) || STATUS_TYPU[e.type] || STATUS_TYPU[e.code] || 0;
    if (z) return z;
  }
  // Bez typu i kodu (NVIDIA: samo „Service temporarily overloaded”) – po treści.
  const t = String(tresc || '');
  if (/overload/i.test(t)) return 529;
  if (/rate.?limit|too many requests/i.test(t)) return 429;
  if (/temporar|unavailable|capacity|try again|busy|timed? ?out/i.test(t)) return 503;
  if (/internal (server )?error|server error|unexpectedly stopped/i.test(t)) return 500;
  return 0;
}

/** Błąd dostawcy w środku strumienia – PO odpowiedzi 200. Udokumentowany
 *  u Anthropic („an error can occur after the API returns a 200"), znany też
 *  z vLLM. Postacie: `data: {"error":…}` (OpenAI, Anthropic, NVIDIA), stary
 *  vLLM `{"object":"error"}`, llama.cpp `error: {…}`, surowa linia
 *  `{"error":…}` bez „data:” (Ollama po rozpoczętym strumieniu) i problem+json
 *  (`{"status":503,"title":…}`). Zwraca `{ tresc, status }` albo null –
 *  status z typu/kodu błędu, bo po nim decydujemy, czy ponawiać. */
function rozpoznajBladStrumienia(blok) {
  for (const linia of String(blok).split('\n')) {
    const m = linia.match(/^(?:data|error):\s*(\{.*\})\s*$/) || linia.match(/^\s*(\{\s*"error"[\s\S]*\})\s*$/);
    if (!m) continue;
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; /* niepełny blok */ }
    if (!j || typeof j !== 'object' || j.choices) continue;
    let e = j.error ?? (j.object === 'error' ? j : null);
    if (!e && /^error:/.test(linia)) e = j;
    if (!e && Number(j.status) >= 400 && (j.title || j.detail)) e = j;
    if (!e) continue;
    const tresc = typeof e === 'string' ? e : String(e.message || e.detail || e.title || e.type || JSON.stringify(e)).slice(0, 300);
    return { tresc, status: statusBledu(typeof e === 'object' ? e : null, tresc) };
  }
  return null;
}
/** Sama treść błędu w strumieniu albo '' (dawny interfejs). */
function bladWStrumieniu(blok) {
  const b = rozpoznajBladStrumienia(blok);
  return b ? b.tresc : '';
}

/* Ciche ponowienie tylko dla błędów PRZEJŚCIOWYCH: przeciążenie, limit tempa,
   błąd serwera. Brak środków, za długa rozmowa, zły klucz, nieznany model,
   filtr treści – drugie żądanie skończy się tak samo, a płaci się za nie
   drugi raz (zespół IT, runda 9). */
const PRZEJSCIOWE_W_STRUMIENIU = new Set([429, 500, 502, 503, 529]);
const TRWALA_TRESC = /context|too long|too many tokens|not found|does not exist|invalid|filter|safety|unauthori[sz]ed|forbidden|permission/i;
function bladPrzejsciowy(b) {
  return Boolean(b) && PRZEJSCIOWE_W_STRUMIENIU.has(b.status)
    && !KONIEC_SRODKOW.test(b.tresc) && !TRWALA_TRESC.test(b.tresc);
}

/** Czy blok SSE niesie NIEBIAŁĄ treść (odpowiedź albo rozumowanie). Samo „\n”
 *  albo pusty `<think>\n\n</think>` (Nemotron z wyłączonym rozumowaniem)
 *  to jeszcze nie odpowiedź – po nim błąd dalej można po cichu ponowić. */
function maTresc(blok) {
  for (const linia of String(blok).split('\n')) {
    const m = linia.match(/^data:\s*(\{.*\})\s*$/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[1]);
      const c = (Array.isArray(j.choices) && j.choices[0]) || {};
      const d = c.delta || c.message || {};
      const t = [d.content, d.reasoning_content, d.reasoning, c.text].filter((x) => typeof x === 'string').join('');
      if (/\S/.test(t.replace(/<\/?think>/g, ''))) return true;
    } catch {
      if (/"(content|reasoning_content|reasoning)"\s*:\s*"(?:\\[nrt]|\s)*[^"\s\\]/.test(linia)) return true;
    }
  }
  return false;
}

/** Tekst ostatniej wiadomości człowieka – po nim szukamy w pamięci i bazie wiedzy. */
function tekstPytania(wiadomosci) {
  const ostatnia = [...wiadomosci].reverse().find((m) => m.role === 'user');
  if (!ostatnia) return '';
  return typeof ostatnia.content === 'string'
    ? ostatnia.content
    : (ostatnia.content.find?.((p) => p.type === 'text')?.text || '');
}

/** Czy OSTATNIA wiadomość człowieka niesie obraz. Zdjęcie z pierwszej tury
 *  kierowało każdą następną do modelu wizyjnego, choć rozmowa dawno o nim
 *  zapomniała (klient i tak wysyła obrazy tylko z ostatniej wiadomości). */
/* Czy bieżąca tura niesie obraz. Nie „ostatnia wiadomość człowieka”: w drugiej
   rundzie kaskady ostatnią jest wynik narzędzia, a zdjęcie siedzi w pytaniu
   przed nim – podmiana na model wizyjny działała wtedy tylko w pierwszej
   rundzie, a ślepy model dostawał image_url (zespół IT, runda 7). Klient
   wysyła obrazy wyłącznie w pytaniu bieżącej tury (toApiMessages), więc
   każdy image_url w rozmowie to obraz tej tury. */
/** Rozmowa bez obrazów: części image_url wypadają, a model dostaje zdanie, dlaczego. */
function bezObrazow(wiadomosci) {
  const bez = wiadomosci.map((m) => (Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
    ? { ...m, content: m.content.filter((p) => p.type !== 'image_url').map((p) => p.text || '').join('\n') || '(pytanie bez tekstu)' }
    : m));
  const i = bez.findIndex((m) => m.role !== 'system');
  bez.splice(i < 0 ? bez.length : i, 0, { role: 'system', content: 'Do tego pytania była klatka z kamery, ale ten model nie widzi '
    + 'obrazów, więc jej nie dostajesz. Odpowiedz na podstawie KONTEKSTU PERCEPCJI (opis dłoni i palców, wykryte rzeczy); '
    + 'jeśli to za mało, powiedz wprost, że nie widzisz obrazu, i zaproponuj model, który widzi obrazy.' });
  return bez;
}

/* Obraz jest W TEJ TURZE – model ma go przed sobą. Manifest możliwości mówi
   „zmysły offline”, „nie obiecuj rzeczy niedostępnych”, więc model wizyjny
   dostawał klatkę z kamery i odpowiadał „nie widzę nic, bo nie mam dostępu do
   kamery” (Marcin, runda 8). Ta wiadomość idzie na koniec instrukcji i ma
   pierwszeństwo: rozpoznawanie na komputerze to co innego niż ten obraz.

   Runda 9: treść zależy od źródła obrazów. Obraz zaznaczony w bazie wiedzy
   wraca z KAŻDĄ wiadomością – polecenie „patrz na niego i odpowiadaj na
   podstawie tego, co widać” robiło z pytania o pogodę opis mapy. Przy klatce
   i obrazach z bazy model dostawał dwa obrazy bez podpisu i zdanie o jednej
   klatce. Teraz obrazy z bazy mają podpis, a klatka jest ostatnia.
   `payload.obrazowZBazy` – ile obrazów dołożyła baza wiedzy (zlozKontekst).
   Staje przed „TRYB GŁOSOWY”, jeśli ten jest ostatni – on ma mieć ostatnie słowo. */
const NOTKA_OBRAZU = /^(OBRAZ Z KAMERY|OBRAZ W PYTANIU|OBRAZY Z BAZY WIEDZY):/;
function zObrazemWidzisz(wiadomosci, payload = {}) {
  const zBazy = Math.max(0, Number(payload.obrazowZBazy) || 0);
  const wszystkich = wiadomosci.reduce((a, m) => a + (m.role === 'user' && Array.isArray(m.content)
    ? m.content.filter((p) => p.type === 'image_url').length : 0), 0);
  const odCzlowieka = Math.max(0, wszystkich - zBazy);
  const podpis = 'Obrazy z bazy wiedzy mają przed sobą podpis „(Obraz z bazy wiedzy: nazwa)” – to materiały, które '
    + 'użytkownik zaznaczył wcześniej; korzystaj z nich, gdy pytanie ich dotyczy.';
  const offline = 'Informacja „zmysły offline” dotyczy tylko rozpoznawania na komputerze użytkownika, nie tego obrazu.';
  let tresc;
  if (payload.klatkaKamery) {
    tresc = 'OBRAZ Z KAMERY: do tego pytania dołączono AKTUALNĄ klatkę z kamery użytkownika – masz ją przed sobą w jego wiadomości'
      + (zBazy ? ` jako OSTATNI obraz przed pytaniem. ${podpis} ` : '. ')
      + 'Patrz na klatkę i odpowiadaj na podstawie tego, co na niej widać. Nie mów, że nie masz dostępu do kamery ani obrazu. '
      + offline;
  } else if (odCzlowieka) {
    const wiele = odCzlowieka > 1;
    tresc = `OBRAZ W PYTANIU: do tego pytania dołączono ${wiele ? 'obrazy' : 'obraz'} – masz ${wiele ? 'je' : 'go'} przed sobą w wiadomości użytkownika. `
      + `Patrz na ${wiele ? 'nie' : 'niego'} i odpowiadaj na podstawie tego, co na ${wiele ? 'nich' : 'nim'} widać. `
      + (zBazy ? `${podpis} ` : '')
      + 'Nie mów, że nie masz dostępu do obrazu. ' + offline;
  } else {
    tresc = 'OBRAZY Z BAZY WIEDZY: w wiadomości użytkownika widzisz obrazy, które zaznaczył w bazie wiedzy – każdy '
      + 'z podpisem „(Obraz z bazy wiedzy: nazwa)”. Korzystaj z nich, gdy pytanie ich dotyczy; gdy nie dotyczy, odpowiadaj '
      + 'normalnie, bez opisywania ich. Nie mów, że nie masz dostępu do obrazów.';
  }
  const kopia = wiadomosci.slice();
  let ostatniSystem = -1;
  for (let i = 0; i < kopia.length; i++) if (kopia[i].role === 'system') ostatniSystem = i;
  const gdzie = ostatniSystem >= 0 && /^TRYB GŁOSOWY/.test(String(kopia[ostatniSystem].content || ''))
    ? ostatniSystem : ostatniSystem + 1;
  kopia.splice(gdzie, 0, { role: 'system', content: tresc });
  return kopia;
}

function ostatniaMaObraz(wiadomosci) {
  return wiadomosci.some((m) => m.role === 'user' && Array.isArray(m.content)
    && m.content.some((p) => p.type === 'image_url'));
}

/* Reszta budżetu okna lokalnego: najpierw wypadają NAJSTARSZE tury rozmowy
   (nigdy instrukcje i nigdy bieżąca tura), potem limit odpowiedzi schodzi
   do tego, co zostało. Jawnie – nagłówek X-Cosmos-Okno – zamiast cichego
   obcinania po stronie Ollamy, które zabierało początek promptu. Nie zmienia
   tablicy wejściowej.

   `chronOd` – indeks, od którego zaczyna się bieżąca tura: pytanie człowieka
   i to, co po nim (odpowiedź „Sprawdzę to." i wyniki narzędzi w kaskadzie).
   Dawniej chroniona była tylko OSTATNIA wiadomość, a w kaskadzie ostatnia to
   wynik wyszukiwania – model dostawał ~6 tys. znaków wyników bez pytania,
   na które miały odpowiadać. Gdy sama bieżąca tura nie mieści się w oknie,
   skracamy jej najdłuższą wiadomość tekstową w środku (początek i koniec
   zostają: najlepsze wyniki na górze, pytanie pod załącznikiem na dole). */
function przytnijDoOkna(wiadomosci, okno, maxTokens, chronOd = wiadomosci.length - 1) {
  if (!okno) return { wiadomosci, przycietoTur: 0, skrocono: false, limitZOkna: 0 };
  const zostaja = [...wiadomosci];
  const zadane = Number.isInteger(maxTokens) ? maxTokens : 2048;
  const naOdpowiedz = Math.min(zadane, 1024);
  let suma = zostaja.reduce((a, m) => a + szacujTokeny(m.content), 0);
  let chron = Math.min(Math.max(0, Number.isInteger(chronOd) ? chronOd : zostaja.length - 1), zostaja.length - 1);
  let przycietoTur = 0;
  while (suma + naOdpowiedz > okno) {
    const i = zostaja.findIndex((m, idx) => m.role !== 'system' && idx < chron);
    if (i < 0) break;
    suma -= szacujTokeny(zostaja[i].content);
    zostaja.splice(i, 1);
    chron--;
    przycietoTur++;
  }
  let skrocono = false;
  if (suma + naOdpowiedz > okno) {
    let j = -1;
    for (let k = Math.max(0, chron); k < zostaja.length; k++) {
      if (zostaja[k].role === 'system' || typeof zostaja[k].content !== 'string') continue;
      if (j < 0 || zostaja[k].content.length > zostaja[j].content.length) j = k;
    }
    if (j >= 0) {
      const tresc = zostaja[j].content;
      const nadmiarTokenow = suma + naOdpowiedz - okno;
      const zostaw = Math.max(600, tresc.length - nadmiarTokenow * 3 - 120);
      if (zostaw < tresc.length) {
        const glowa = Math.ceil(zostaw * 2 / 3);
        const nowa = tresc.slice(0, glowa) + '\n\n[…skrócone do okna modelu…]\n\n' + tresc.slice(tresc.length - (zostaw - glowa));
        suma += szacujTokeny(nowa) - szacujTokeny(tresc);
        zostaja[j] = { ...zostaja[j], content: nowa };
        skrocono = true;
      }
    }
  }
  return { wiadomosci: zostaja, przycietoTur, skrocono, limitZOkna: Math.max(512, Math.min(zadane, okno - suma - 32)) };
}

/** Zegar ciszy dostawcy. Bez niego czekaliśmy do domyślnych 300 s fetcha
 *  z migającym kursorem. Po nagłówkach ten sam zegar pilnuje przerw między
 *  kawałkami strumienia – pompa odnawia go przy każdym kawałku. */
function zegarCiszy(abort) {
  const zegar = { cisza: false, uchwyt: null };
  zegar.pilnuj = (ms = CISZA_MODELU_MS) => {
    clearTimeout(zegar.uchwyt);
    zegar.uchwyt = setTimeout(() => { zegar.cisza = true; abort.abort(); }, ms);
    if (zegar.uchwyt.unref) zegar.uchwyt.unref();
  };
  zegar.stop = () => clearTimeout(zegar.uchwyt);
  return zegar;
}

// ---------------------------------------------------------------------------
// Trasa czatu
// ---------------------------------------------------------------------------

/**
 * @param {object} z
 * @param {Function} z.U                  stan bieżącej osoby (lib/stan-osoby.js)
 * @param {object}   z.archiwum           archiwum osoby (do instrukcji narzędzi)
 * @param {Function} z.procedury          procedury osoby (lib/nauka.js)
 * @param {*}        z.urzadzenia         urządzenia domu (lib/urzadzenia.js)
 * @param {Function} z.searchMemory       przywołanie z pamięci długotrwałej
 * @param {Function} z.memoryContextLines pamięć → blok dla modelu
 * @param {Function} z.kbSearch           fragmenty bazy wiedzy pasujące do pytania
 * @param {Function} z.obrazDlaModelu     podgląd obrazu z bazy wiedzy (albo null)
 * @param {object}   z.biegi              lib/biegi.js
 * @param {Function} z.terazTekst         data i godzina w strefie właściciela
 * @param {Function} z.capabilityManifest manifest zdolności (samoświadomość)
 * @param {Function} z.capabilityText     manifest → tekst dla modelu
 * @param {Function} z.scrubSecrets       usuwa identyfikatory kont z komunikatów dostawcy
 */
function utworz(z) {
  const {
    U, archiwum, procedury, urzadzenia, searchMemory, memoryContextLines, kbSearch, obrazDlaModelu,
    biegi, terazTekst, capabilityManifest, capabilityText, scrubSecrets,
  } = z;

  /* Żądania czatu wysłane do dostawcy, który jeszcze nie odpowiedział – po nich
     „Stop" przerywa, zanim bieg powstanie. Klucz: `osoba:id biegu`. */
  const OCZEKUJACE = new Map();
  /* Biegi zatrzymane „Stopem", zanim się urodziły – żeby ponowiony przez
     przeglądarkę POST z tym samym biegiem nie zaczął ich od nowa. */
  const ZATRZYMANE = new Set();
  let lokalnyNiedostepny = { do: 0, rodzaj: '' };

  /** „Stop" dla żądania, które nie ma jeszcze biegu. */
  function zatrzymajOczekujacy(klucz) {
    const abort = OCZEKUJACE.get(klucz);
    if (!abort) return false;
    abort.abort();
    OCZEKUJACE.delete(klucz);
    ZATRZYMANE.add(klucz);
    setTimeout(() => ZATRZYMANE.delete(klucz), 120_000).unref?.();
    return true;
  }

  /* Ten sam bieg drugi raz. Chrome sam ponawia POST, gdy połączenie padnie,
     zanim przyszedł pierwszy bajt odpowiedzi – a przy modelu myślącym po cichu
     to trwa. Dawniej: drugie płatne żądanie do dostawcy i dwie RÓŻNE odpowiedzi
     w rozmowie (zespół IT, runda 4). Drugi POST czeka teraz na pierwszy i podpina
     się do jego biegu. '' = pierwszego nie ma (albo padł przed nagłówkami). */
  async function jakDubel(biegId, klucz) {
    if (!OCZEKUJACE.has(klucz) && !biegi.daj(biegId)) return '';
    const koniec = Date.now() + CISZA_MODELU_MS;
    while (OCZEKUJACE.has(klucz) && Date.now() < koniec) await new Promise((r) => setTimeout(r, 100));
    if (ZATRZYMANE.has(klucz)) return 'zatrzymany';
    return biegi.daj(biegId) ? 'bieg' : '';
  }

  function komunikatLokalnego(rodzaj, ep, err) {
    // Adres domu właściciela i rady o Ollamie są dla niego, nie dla gościa.
    if (!czyWlasciciel()) return 'Komputer właściciela z lokalnym modelem teraz nie odpowiada – spróbuj później albo wybierz chmurę.';
    if (rodzaj === 'uspiony') {
      return `Komputer domowy nie odpowiada (${ep.baseUrl}) – jest uśpiony, wyłączony albo poza Tailscale. `
        + 'Obudź go albo przełącz się na Chmurę.';
    }
    if (rodzaj === 'odmowa') {
      return `Komputer domowy odpowiada, ale lokalny model nie przyjmuje połączeń (${ep.baseUrl}). `
        + 'Uruchom Ollamę (albo vLLM); Ollama musi słuchać w sieci: OLLAMA_HOST=0.0.0.0.';
    }
    if (rodzaj === 'brama') {
      return `Komputer domowy odpowiada (${ep.baseUrl}), ale lokalny model za pośrednikiem (Tailscale, nginx) nie działa. `
        + 'Uruchom Ollamę (albo vLLM) albo wyślij przez Chmurę.';
    }
    if (rodzaj === 'dns') {
      return `Nazwa komputera domowego się nie rozwiązuje (${ep.baseUrl}) – sprawdź MagicDNS w Tailscale albo wpisz adres 100.x.y.z w LOCAL_BASE_URL.`;
    }
    return `Nie udało się połączyć z lokalnym modelem (${ep.baseUrl}). Sprawdź, czy Ollama/vLLM działa. (${err?.message || ''})`;
  }

  /* Zimny start Ollamy dłuższy niż limit ciszy: po zerwaniu żądania Ollama
     przerywa ładowanie modelu, więc „spróbuj za chwilę” zaczynało od zera
     i nigdy nie dochodziło (zespół IT, runda 9). W tle, bez czekania i bez
     zegara czatu, prosimy o samo załadowanie – puste /api/generate (dokumentacja
     Ollamy: bez promptu model tylko ładuje się do pamięci). Bez `keep_alive`:
     obowiązuje ustawienie komputera domowego (OLLAMA_KEEP_ALIVE), którego nie
     chcemy skracać. Jedna rozgrzewka naraz na model; vLLM odpowie 404 i tyle. */
  const ROZGRZEWANE = new Set();
  function rozgrzejLokalny(ep, model) {
    const baza = String(ep.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
    const klucz = `${baza}|${model}`;
    if (!baza || !model || ROZGRZEWANE.has(klucz)) return;
    ROZGRZEWANE.add(klucz);
    fetch(`${baza}/api/generate`, {
      method: 'POST', headers: authHeaders(ep), body: JSON.stringify({ model }), signal: AbortSignal.timeout(600_000),
    }).then((r) => r.body?.cancel().catch(() => {})).catch(() => {}).finally(() => ROZGRZEWANE.delete(klucz));
  }

  /** Kontekst: percepcja + narzędzia + pamięć + baza wiedzy – jako dodatkowe
   *  wiadomości systemowe, zaraz po instrukcji systemowej użytkownika. Obrazy
   *  zaznaczone w bazie wiedzy trafiają do ostatniej wiadomości człowieka. */
  async function zlozKontekst(payload, ep) {
    const messages = [...payload.messages];
    const extras = [];
    const queryText = tekstPytania(payload.messages);

    /* Ile instrukcji ten model uniesie. Dotąd każdy dostawał ten sam prompt
       na 1351 tokenów – także model 4-miliardowy, który żadnego z opisanych
       narzędzi nie umie użyć, a znacznik wypisałby użytkownikowi na ekran. */
    let poziom = modelToolLevel(payload.model || ep.model || '');
    /* Małe okno lokalnego modelu (Ollama domyślnie 4096): pełny opis narzędzi
       to 3,3–3,8 tys. tokenów – nie zostawało miejsca na rozmowę ani odpowiedź,
       a Ollama po cichu wyrzucała najstarsze wiadomości, w kaskadzie nawet
       samo PYTANIE. Przy takim oknie wersja krótka (ok. 1 tys. tokenów). */
    const oknoLokalne = payload.endpoint === 'local'
      ? (oknoLokalneDla(ep) || await oknoZSerwera(ep, payload.model || ep.model)) : 0;
    if (poziom === 'pelny' && oknoLokalne && oknoLokalne <= 8192) poziom = 'zwiezly';
    const bezNarzedzi = poziom === 'rozmowa';
    const krotko = poziom !== 'pelny';

    // Samoświadomość – czym Cosmos jest i co realnie potrafi w tej chwili
    if (payload.useCapabilities !== false) {
      try {
        /* Czy TEN silnik widzi obrazy – manifest obiecywał wzrok także modelowi,
           który go nie ma, i przeczył notce bezObrazow w tym samym prompcie. */
        const widzi = Boolean(ep.visionModel) || !slepy(ep, payload.model || ep.model);
        const pelny = capabilityText(await capabilityManifest({ widzi }));
        // Najdłuższy pojedynczy blok promptu. Mniejszym modelom wystarcza sama
        // tożsamość – lista czego brakuje w konfiguracji jest dla nich szumem.
        extras.push({ role: 'system', content: krotko ? pelny.split('\n\n')[0] : pelny });
      } catch { /* manifest nie może blokować rozmowy */ }
    }

    /* Data, godzina i miejsce – dwie rzeczy, których model nie ma skąd wiedzieć,
       a bez których „w okolicy" i „dziś" nie znaczą nic. Idą zawsze i na początku. */
    extras.push({
      role: 'system',
      content: `TERAZ JEST: ${terazTekst()}.`
        + (U().location ? `\nUŻYTKOWNIK ZNAJDUJE SIĘ W: ${U().location}.`
          + ' Używaj tego miejsca, gdy pyta o coś „w okolicy", „niedaleko" albo „u mnie" –'
          + ' nie dopytuj o lokalizację, którą już znasz.'
          : '\nNie znasz lokalizacji użytkownika. Jeśli jest potrzebna, zapytaj o nią raz, krótko.'),
    });

    /* JAK MÓWIĆ – reguła, której przez cały czas nie było, i to się mściło.
     *
     *  Marcin, po przeczytaniu kilku zapisów rozmów: „te rozmowy nie są
     *  nienaganne i nie mają takiego flow, jakbym chciał". Miał rację, a duża
     *  część winy leży w instrukcjach, które sam tu dopisywałem. Każda naprawa
     *  dokładała modelowi zdanie o tym, JAK DZIAŁA SYSTEM – a model uczciwie
     *  przekazywał to dalej użytkownikowi. W zapisach widać efekt:
     *
     *    „Wszystkie te zdjęcia mają `swiatloPrzyblizone: true`"
     *    „użytkownik może użyć przycisku »pokaż kolejne« pod miniaturami"
     *    „do takich wniosków służy polecenie grupowania (`grupuj=aparat`)"
     *    „Microsoft Graph nie czyta metadanych z RAW-ów"
     *    „(próbka z 57 728 pasujących plików)"
     *
     *  To są MOJE zdania z promptu, oddane człowiekowi, który pytał o zdjęcia
     *  psa. Nazwy pól, składnia filtrów, nazwy paneli i cudza firma w jednym
     *  akapicie – plus mówienie o rozmówcy w trzeciej osobie, bo tak brzmiały
     *  instrukcje.
     *
     *  Instrukcje narzędzi zostają, bo są potrzebne, ale od teraz jest granica:
     *  wiedza o mechanice służy do DZIAŁANIA, nie do CYTOWANIA. Ta reguła stoi
     *  przed nimi wszystkimi, bo dotyczy każdej odpowiedzi. */
    extras.push({
      role: 'system',
      content:
        'JAK ODPOWIADASZ – obowiązuje zawsze i jest ważniejsze niż opisy narzędzi niżej.\n'
        + 'Mówisz o ZDJĘCIACH I KLIPACH, nie o rekordach. Nigdy nie wymieniaj w odpowiedzi '
        + 'nazw pól (swiatloPrzyblizone, dataNiepewna, zDanymi), składni filtrów '
        + '(grupuj=, folder=, bezFolderu=), nazw narzędzi ani znaczników, formatu JSON, '
        + 'nazw paneli w interfejsie ani firm, od których biorą się dane. To jest kuchnia. '
        + 'Użytkownik ma dostać danie.\n'
        + 'Gdy coś jest niepewne, powiedz to po ludzku: „ta data pochodzi z pliku, nie '
        + 'z aparatu – może być datą wgrania", a nie „wpis ma dataNiepewna: true".\n'
        + 'Zwracasz się do niego BEZPOŚREDNIO – „możesz", „masz". Nigdy „użytkownik może".\n'
        + 'Nie opowiadaj, co robisz ani czego nie robisz: żadnego „nie wyciągam wniosków", '
        + '„to moja wiedza na podstawie wyników", „przygotuję odpowiednie zapytanie". '
        + 'Po prostu odpowiedz.\n'
        + 'Nie wypisuj list plików ani tabel z metadanymi, jeśli o to nie poproszono – '
        + 'miniatury już widzi. Odpowiedz na PYTANIE, które zadał.\n'
        + 'Nie dopisuj na koniec ofert pomocy w rodzaju „jeśli chcesz, mogę zawęzić…", '
        + 'chyba że naprawdę trzeba wybrać między konkretnymi możliwościami.\n'
        + 'Długość odpowiedzi dobierz do pytania. Na krótkie pytanie – krótka odpowiedź.',
    });

    // Profil użytkownika – pamięć profilowa wstrzykiwana zawsze
    if (U().profile.trim()) {
      extras.push({ role: 'system', content: 'PROFIL UŻYTKOWNIKA (stałe fakty o osobie, z którą rozmawiasz):\n' + U().profile.trim() });
    }

    /* Sprzęt użytkownika – tekst dla modelu mieszka razem z resztą instrukcji,
       w `lib/instrukcje-narzedzi.js`. */
    const blokSprzet = blokSprzetu(U().sprzet);
    if (blokSprzet) extras.push(blokSprzet);

    const scene = payload.useSenses === false ? '' : sceneContext();
    if (scene) extras.push({ role: 'system', content: scene });

    /* Instrukcje narzędzi mieszkają w `lib/instrukcje-narzedzi.js` – to sam
       tekst dla modelu, bez logiki, więc da się go złożyć i sprawdzić
       w teście bez stawiania serwera. Patrz nagłówek tamtego pliku. */
    extras.push(...zbudujInstrukcje({
      payload, krotko, bezNarzedzi, archiwum, userWspolrzedne: U().wspolrzedne,
      procedury, urzadzenia,
      /* Członek bez przyznanego Studia nie dostaje w instrukcji narzędzia
         do generowania obrazów, a narzędzia „uruchom kod" nie dostaje nigdy –
         kod wykonuje się na serwerze, obok kluczy i danych wszystkich. */
      imageProviders: () => (silniki.studioDozwolone() ? imageProviders() : []),
      KOD_WLACZONY: KOD_WLACZONY && czyWlasciciel(), capabilityText,
    }));

    if (payload.useMemory !== false) {
      const recalled = await searchMemory(queryText);
      const memCtx = memoryContextLines(recalled);
      if (memCtx) extras.push({ role: 'system', content: memCtx });
    }

    // Baza wiedzy – pozycje zaznaczone przez użytkownika (zawsze dołączane)
    const kbSelected = Array.isArray(payload.kbSelected) ? payload.kbSelected : [];
    let obrazowZBazy = 0;
    if (kbSelected.length) {
      const chosen = U().kbItems.filter((it) => kbSelected.includes(it.id));

      const textItems = chosen.filter((it) => !/^image\//.test(it.mime || ''));
      if (textItems.length) {
        const parts = textItems.map((it) =>
          `### ${it.name}${it.url ? ` (${it.url})` : ''}\n` +
          `${(it.text || '(plik binarny – brak wyodrębnionego tekstu)').slice(0, 6000)}`);
        extras.push({
          role: 'system',
          // W trybie głosowym bez dopisków [źródło: …] – lektor je czytał.
          content: (payload.trybGlosowy === true ? '' : 'Gdy korzystasz z poniższych materiałów, podaj źródło w formacie [źródło: nazwa]. ') +
                   'BAZA WIEDZY – materiały wybrane przez użytkownika do tej rozmowy. ' +
                   'Odpowiadając, opieraj się na nich w pierwszej kolejności:\n\n' + parts.join('\n\n'),
        });
      }

      /* Obrazy z bazy dołączamy do ostatniej wiadomości użytkownika (model
         wizyjny) – każdy z podpisem, PRZED obrazami człowieka: klatka z kamery
         zostaje ostatnim obrazem przed pytaniem, a model wie, który obraz to
         „mapa.png” z bazy (runda 9). Dawniej szły bez nazw na sam początek. */
      const imageItems = chosen.filter((it) => /^image\//.test(it.mime || '')).slice(0, 3);
      if (imageItems.length) {
        const idx = messages.map((m) => m.role).lastIndexOf('user');
        if (idx >= 0) {
          const m = messages[idx];
          const parts = Array.isArray(m.content)
            ? [...m.content]
            : [{ type: 'text', text: String(m.content) }];
          const zaDuze = [];
          const zlyFormat = [];
          const zBazy = [];
          for (const it of imageItems) {
            const obraz = obrazDlaModelu(it);
            if (!obraz || !obraz.buf) { (obraz && obraz.powod === 'format' ? zlyFormat : zaDuze).push(it.name); continue; }
            zBazy.push({ type: 'text', text: `(Obraz z bazy wiedzy: ${it.name})` }, {
              type: 'image_url',
              image_url: { url: `data:${obraz.mime};base64,${obraz.buf.toString('base64')}` },
            });
            obrazowZBazy++;
          }
          messages[idx] = { ...m, content: [...zBazy, ...parts] };
          if (zaDuze.length) {
            extras.push({ role: 'system', content: `Użytkownik zaznaczył obrazy, których nie da się wysłać – są za duże: `
              + `${zaDuze.join(', ')}. Powiedz mu, że wystarczy otworzyć bazę wiedzy (przygotuje się mniejsza wersja).` });
          }
          if (zlyFormat.length) {
            extras.push({ role: 'system', content: 'Użytkownik zaznaczył obrazy w formacie, którego model nie przyjmuje '
              + `(np. HEIC, TIFF, BMP, SVG): ${zlyFormat.join(', ')}. Powiedz mu, że wystarczy zapisać je jako JPEG albo PNG.` });
          }
        }
      }
    }

    // Baza wiedzy – automatyczne przywołanie pasujących fragmentów z reszty bazy
    if (payload.useKb !== false) {
      const found = await kbSearch(queryText, kbSelected);
      if (found.length) {
        extras.push({
          role: 'system',
          content: (payload.trybGlosowy === true ? '' : 'Gdy korzystasz z poniższych fragmentów, podaj źródło w formacie [źródło: nazwa]. ') +
                   'BAZA WIEDZY – fragmenty pasujące do bieżącego pytania:\n\n' +
                   found.map((f) => `### ${f.name}\n${f.text}`).join('\n\n'),
        });
      }
    }

    /* Tryb głosowy: odpowiedź zostanie PRZECZYTANA. Model o tym nie wiedział
       i pisał listy, tabele i sekcję źródeł – lektor czytał je adres po adresie
       albo ucinał w połowie. Stoi na końcu dodatkowych instrukcji. */
    if (payload.trybGlosowy === true) {
      extras.push({
        role: 'system',
        content: 'TRYB GŁOSOWY: Twoja odpowiedź zostanie przeczytana na głos. Mów jak w rozmowie: '
          + 'zwykle 2–4 krótkie zdania, bez list, tabel, nagłówków, linków i sekcji „Źródła". '
          + 'Liczby i godziny podawaj tak, jak się je mówi. Narzędzi używasz normalnie, '
          + 'ale sam wynik streść krótko – szczegóły użytkownik zobaczy na ekranie. '
          /* Ta zasada wygrywa z „ŹRÓDŁA” z opisu wyszukiwania: w rozmowie głosowej
             „według strony…”, „znalazłem w internecie” i wyliczanie serwisów tylko
             przeszkadzają (Marcin, runda 5). */
          + 'NIE mów, skąd masz informacje: bez „według…”, „znalazłem w sieci”, „na podstawie wyników”, '
          + 'bez nazw stron i bez zdania, że to Twoja wiedza – chyba że użytkownik zapyta o źródło. '
          + 'Ta zasada ma pierwszeństwo przed zasadą o sekcji źródeł.',
      });
    }

    /* To, co zmienia się co minutę (zegar, percepcja), na KONIEC instrukcji.
       Dostawcy (OpenAI) buforują prompt od początku do pierwszej różnicy;
       zegar jako trzecia wiadomość sprawiał, że każda nowa minuta kasowała
       bufor całego promptu (zespół IT, runda 7). */
    // Tryb głosowy zostaje OSTATNI – ma pierwszeństwo przed wcześniejszymi zasadami.
    const miejsce = (e) => (/^TRYB GŁOSOWY/.test(String(e.content || '')) ? 2
      : /^(TERAZ JEST|KONTEKST PERCEPCJI)/.test(String(e.content || '')) ? 1 : 0);
    extras.sort((a, b) => miejsce(a) - miejsce(b));
    if (extras.length) {
      const insertAt = messages[0]?.role === 'system' ? 1 : 0;
      messages.splice(insertAt, 0, ...extras);
    }
    /* Początek bieżącej tury po doklejeniu instrukcji – liczony od końca, bo
       wszystko doklejamy przed rozmową. Klient bez `turaOd` (stara karta, mostek
       MCP) chroni jak dawniej samą ostatnią wiadomość. */
    const turaOd = payload.turaOd;
    const chronOd = Number.isInteger(turaOd) && turaOd >= 0 && turaOd < payload.messages.length
      ? messages.length - (payload.messages.length - turaOd)
      : messages.length - 1;
    return { messages, oknoLokalne, chronOd, obrazowZBazy };
  }

  /** Model do tego żądania albo gotowy błąd dla człowieka ({ blad: [kod, dane] }). */
  function wybierzModel(payload, ep, maObraz) {
    /* Na silniku przyznanym przez właściciela członek dostaje modele z jego
       listy (lib/silniki.js → granice). Zamiana jest jawna – nagłówek w odpowiedzi. */
    const { model: modelOsoby, zamiast: modelSpozaListy } = silniki.modelDozwolony(payload.endpoint, payload.model || ep.model);
    let model = modelOsoby;

    if (!model) {
      return { blad: [400, {
        error: payload.endpoint === 'local'
          ? 'Nie skonfigurowano modelu lokalnego. Ustaw LOCAL_MODEL w .env albo wybierz model w Ustawieniach.'
          : 'Nie skonfigurowano modelu. Ustaw NEMOTRON_MODEL w .env albo wybierz model w Ustawieniach.',
      }] };
    }

    // Zdjęcie do modelu, który nie widzi obrazów, kończy się albo błędem 400,
    // albo – gorzej – odpowiedzią „nie mam dostępu do żadnego zdjęcia”, choć
    // obraz poleciał. Wcześniej przełączenie na model wizyjny działało tylko
    // wtedy, gdy użytkownik NIE wybrał modelu w Ustawieniach; a wybiera prawie
    // zawsze. Teraz decyduje to, czy wybrany model umie patrzeć.
    let swappedFrom = '';
    if (maObraz && slepy(ep, model)) {
      /* Klatka dołączona SAMA (tryb głosowy, pytanie „co trzymam?”) – człowiek
         nie wysłał zdjęcia, więc 400 byłoby odpowiedzią na coś, czego nie
         zrobił. Model dostaje pytanie bez klatki i opis dłoni z percepcji
         (zespół IT, runda 7). */
      if (!ep.visionModel && payload.klatkaKamery) return { model, swappedFrom: '', modelSpozaListy, bezObrazow: true };
      if (!ep.visionModel) {
        const zmienna = { local: 'LOCAL_VISION_MODEL', cloud: 'NEMOTRON_VISION_MODEL' }[payload.endpoint];
        return { blad: [400, {
          error: `Model „${model}" nie odczytuje obrazów, a dla silnika „${ep.label}" nie `
            + 'ustawiono modelu wizyjnego – zdjęcie zostałoby zignorowane.\n\n'
            + (zmienna
              ? 'Masz dwa wyjścia:\n'
                + '• wybierz w Ustawieniach model oznaczony „widzi obrazy”, albo\n'
                + `• ustaw ${zmienna} `
                + 'w .env na serwerze – Cosmos będzie wtedy sam kierował do niego same zdjęcia, '
                + 'a rozmowę zostawi wybranemu modelowi.'
              : 'Wybierz w Ustawieniach model oznaczony „widzi obrazy”.'),
        }] };
      }
      swappedFrom = model;
      model = ep.visionModel;
    }
    return { model, swappedFrom, modelSpozaListy };
  }

  /** Żądanie do dostawcy. Parametry pod dostawcę, poprawki po odmowie 400,
   *  ponowienia przy 429/503 – wszystko w lib/model.js, wspólne z funkcjami
   *  pomocniczymi. Zwraca odpowiedź i model, który faktycznie ją liczy. */
  async function wyslijDoDostawcy({ ep, body, abort, payload, maObraz, swappedFrom }) {
    const wyslij = () => zapytajModel(ep, body, {
      signal: abort.signal,
      // Pomiar płynności ma zobaczyć kapryśny model takim, jaki jest.
      ponowienia: payload.pomiar === true ? 0 : 2,
      // Sufit członka na silniku przyznanym – po podbiciu limitu dla modeli myślących.
      sufit: silniki.granice(payload.endpoint)?.maxTokens,
      // Pusta 502/504 pośrednika i „Loading model” modelu lokalnego – od razu, bez 4,5 s ponowień.
      lokalny: payload.endpoint === 'local',
    });
    let upstream = await wyslij();
    let bezObrazowPo = false;
    /* Klatka z kamery do modelu spoza katalogu, który nie widzi (mistral-nemo,
       qwen2.5, phi4), bez modelu wizyjnego: człowiek nie wysłał żadnego zdjęcia,
       więc „model odmówił przyjęcia zdjęcia” to odpowiedź na coś, czego nie
       zrobił. Jedno ponowienie bez obrazu i zapamiętanie, że ten model jest ślepy
       – następna klatka idzie od razu bez obrazu (zespół IT, runda 9). */
    if (!upstream.ok && maObraz && !ep.visionModel && payload.klatkaKamery
      && [400, 415, 422, 500].includes(upstream.status)) {
      const odmowa = await upstream.clone().text().catch(() => '');
      if (ODMOWA_OBRAZU.test(odmowa) && !ODMOWA_FORMATU.test(odmowa) && !odmowaRozmiaru(odmowa)) {
        upstream.body?.cancel().catch(() => {});
        SLEPE_MODELE.add(kluczSlepego(ep, body.model));
        body.messages = bezObrazow(body.messages.filter((m) => !(m.role === 'system' && NOTKA_OBRAZU.test(String(m.content || '')))));
        bezObrazowPo = true;
        upstream = await wyslij();
      }
    }
    /* Zdjęcie odrzucone, a model wizyjny JEST ustawiony – jedna próba z nim,
       zamiast błędu. Nazw z Ollamy katalog nie zna, więc o ślepocie modelu
       dowiadujemy się dopiero z odmowy – a Ollama i llama.cpp odmawiają
       kodem 500, nie 400 („missing data required for image input"). */
    if (!upstream.ok && maObraz && ep.visionModel && body.model !== ep.visionModel
      && [400, 415, 422, 500].includes(upstream.status)) {
      const odmowa = await upstream.clone().text().catch(() => '');
      if (ODMOWA_OBRAZU.test(odmowa) && !ODMOWA_FORMATU.test(odmowa) && !odmowaRozmiaru(odmowa)) {
        upstream.body?.cancel().catch(() => {});
        swappedFrom = swappedFrom || body.model;
        body.model = ep.visionModel;
        upstream = await wyslij();
      }
    }
    return { upstream, model: body.model, swappedFrom, bezObrazowPo };
  }

  /** Nie doszło do odpowiedzi dostawcy: cisza, „Stop" albo brak połączenia. */
  function odpowiedzBledemPolaczenia(res, err, { ep, model, payload, abort, zegar }) {
    if (zegar.cisza) {
      if (payload.endpoint === 'local') rozgrzejLokalny(ep, model);
      return sendJson(res, 504, { kod: payload.endpoint === 'local' ? 'zimny-start' : 'cisza', error: `Model nie odpowiedział w ${Math.round(CISZA_MODELU_MS / 1000)} s [${ep.label} · ${model}]. `
        + (payload.endpoint === 'local'
          /* Zimny start: Ollama po przerwie ładuje model do pamięci karty –
             duży potrafi potrzebować ponad minuty. To nie awaria. */
          ? 'Jeśli to pierwsze pytanie po przerwie, lokalny model mógł właśnie ładować się do pamięci karty – ładowanie trwa dalej, spróbuj ponownie za chwilę. '
            + 'Na stałe pomaga OLLAMA_KEEP_ALIVE=24h na komputerze domowym.'
          : 'Spróbuj ponownie albo wybierz inny model.') });
    }
    // Restart serwera, zanim dostawca odpowiedział – przeglądarka ma wysłać jeszcze raz.
    if (abort.signal.aborted && abort.signal.reason?.kod === 'aktualizacja') {
      res.setHeader('Retry-After', '5');
      return sendJson(res, 503, { error: 'Cosmos właśnie się aktualizuje – wyślij za kilka sekund.', kod: 'aktualizacja' });
    }
    // Przerwane „Stopem" przed nagłówkami – domykamy odpowiedź, żeby nie wisiała.
    if (abort.signal.aborted) { if (!res.headersSent) res.writeHead(204); return res.end(); }
    if (payload.endpoint === 'local') {
      const rodzaj = rodzajBleduPolaczenia(err);
      // Bezpiecznik tylko dla porażek, które kosztują czekanie (uśpiony, DNS) – odmowa przychodzi od razu.
      if (rodzaj === 'uspiony' || rodzaj === 'dns') lokalnyNiedostepny = { do: Date.now() + LOKALNY_BEZPIECZNIK_MS, rodzaj };
      return sendJson(res, 502, { kod: 'lokalny-niedostepny', rodzaj, error: komunikatLokalnego(rodzaj, ep, err) });
    }
    return sendJson(res, 502, { error: `${opisBleduSieci(err, ep.label)} [${ep.label} · ${model}]` });
  }

  /** Dostawca odpowiedział, ale nie 200 – czytelny błąd z nazwą silnika i modelu. */
  async function odpowiedzBledemDostawcy(res, upstream, { ep, model, payload, maObraz }) {
    let detail = '';
    try { detail = await upstream.text(); } catch { /* ignore */ }
    let message = `Błąd modelu (HTTP ${upstream.status}).`;
    try {
      const parsed = JSON.parse(detail);
      // `message` na wierzchu – stary format vLLM ({"object":"error","message":…}); bez tego znikał.
      message = parsed?.error?.message || parsed?.error || parsed?.message || parsed?.detail || parsed?.title || message;
      if (typeof message !== 'string') message = JSON.stringify(message).slice(0, 300);
    } catch {
      /* Strona HTML (503 bramki dostawcy) stała w czacie jako surowe <html><body>… */
      if (toStronaHtml(detail)) message = `${ep.label} ma chwilową awarię (HTTP ${upstream.status}). Spróbuj za chwilę albo wybierz inny silnik.`;
      else if (detail) message = `${message} ${detail.slice(0, 300)}`;
    }
    // Model spoza katalogu, który jednak nie przyjmuje obrazów, poznajemy dopiero
    // po odmowie dostawcy. „Błąd modelu (HTTP 400)” nic użytkownikowi nie mówi –
    // zamieniamy to na tę samą wskazówkę, co przy modelach znanych.
    /* Odmowa ROZMIARU („image exceeds 5 MB maximum”) – model widzi, obraz za duży. */
    if ([400, 413, 415, 422, 500].includes(upstream.status) && maObraz && odmowaRozmiaru(detail)) {
      return sendJson(res, 413, { kod: 'obraz-za-duzy', error: 'Zdjęcie jest za duże dla tego dostawcy – wyślij mniejsze '
        + `(Claude przyjmuje do 5 MB na obraz), np. zrzut ekranu zamiast oryginału z aparatu.  [${ep.label} · ${model}]` });
    }
    /* Odmowa FORMATU to nie ślepota modelu – „wybierz model, który widzi" było
       fałszywym tropem, bo gpt-4o i Claude widzą, tylko nie BMP ani SVG. */
    if ([400, 415, 422].includes(upstream.status) && maObraz && ODMOWA_FORMATU.test(detail)) {
      return sendJson(res, 400, { error: `Dostawca nie przyjmuje obrazu w tym formacie – przyjmuje JPEG, PNG, GIF i WebP. `
        + `Zapisz zdjęcie w jednym z nich albo odznacz je w bazie wiedzy.  [${ep.label} · ${model}]` });
    }
    if ([400, 415, 422, 500].includes(upstream.status) && maObraz && ODMOWA_OBRAZU.test(detail)) {
      const zmienna = payload.endpoint === 'local' ? 'LOCAL_VISION_MODEL' : 'NEMOTRON_VISION_MODEL';
      return sendJson(res, 400, {
        error: ep.visionModel
          // Model wizyjny był ustawiony i to on odmówił – „ustaw model wizyjny" byłoby kpiną.
          ? `Model wizyjny „${model}" odmówił przyjęcia zdjęcia.\n\n`
            + `Sprawdź w Ustawieniach („Sprawdź"), czy ${zmienna} naprawdę widzi obrazy – `
            + `w Ollamie model wizyjny to np. qwen2.5vl albo llama3.2-vision.\n\nOdpowiedź dostawcy: ${String(detail).slice(0, 200)}`
          : `Model „${model}" odmówił przyjęcia zdjęcia.\n\n`
            + 'Wybierz w Ustawieniach model oznaczony „widzi obrazy”'
            + (['cloud', 'local'].includes(payload.endpoint || 'cloud')
              ? `, albo ustaw ${zmienna} w .env – Cosmos skieruje wtedy same zdjęcia do modelu wizyjnego, a rozmowę zostawi wybranemu`
              : '')
            + `.\n\nOdpowiedź dostawcy: ${String(detail).slice(0, 200)}`,
      });
    }
    // Bez tego widać sam komunikat dostawcy i nie wiadomo nawet, którą zakładkę
    // silnika obwiniać ani jaki identyfikator modelu poleciał w żądaniu.
    const where = `[${ep.label} · ${model}]`;
    let hint = modelErrorHint(payload.endpoint, model, upstream.status, { tresc: detail, baseUrl: ep.baseUrl });
    /* 401/403 DOSTAWCY to nie 401 Cosmosa. Przepuszczony dalej wyglądał dla
       przeglądarki jak wygasła sesja: zły klucz NVIDII pokazywał każdemu, przy
       każdej wiadomości, ekran „Sesja wygasła" (zespół IT, runda 5). */
    const kluczDostawcy = upstream.status === 401 || upstream.status === 403;
    if (kluczDostawcy && payload.endpoint !== 'local') {
      const { zrodlo } = silniki.dostep(payload.endpoint || 'cloud');
      if (zrodlo === 'przyznany' || zrodlo === 'wspolny') {
        const u = kto();
        if (u && u.rola !== 'wlasciciel') hint = ' Klucz właściciela do tego silnika przestał działać – daj mu znać albo wybierz inny silnik.';
      } else if (zrodlo === 'wlasny') {
        hint = ' Twój klucz API jest nieprawidłowy albo nie ma dostępu do tego modelu – popraw go w Ustawieniach → Konto.';
      }
    }
    const status = kluczDostawcy ? 502 : upstream.status;
    // Ten komunikat ląduje na ekranie, a stamtąd na zrzutach ekranu – dostawca
    // wpisuje w niego identyfikator konta, który nikomu nie jest potrzebny.
    return sendJson(res, status, {
      error: `${where} ${scrubSecrets(message)}${hint}`,
      ...(kluczDostawcy ? { kod: 'klucz-dostawcy' } : {}),
      ...(bladTrwaly(upstream.status, detail) ? { trwaly: true } : {}),
    });
  }

  /** Stara droga: zwykłe proxy bajt w bajt. Zostaje dla klientów sprzed
   *  biegów i dla wywołań, którym praca w tle jest niepotrzebna. */
  async function przekazWprost(res, upstream, { model, swappedFrom, modelSpozaListy, okno, zegar }) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      // Który model faktycznie odpowiedział. Przy zdjęciu bywa inny niż wybrany,
      // a podmiana za plecami użytkownika byłaby nieuczciwa.
      'X-Cosmos-Model': encodeURIComponent(model),
      ...(swappedFrom ? { 'X-Cosmos-Model-Swapped-From': encodeURIComponent(swappedFrom) } : {}),
      ...(modelSpozaListy ? { 'X-Cosmos-Model-Spoza-Listy': encodeURIComponent(modelSpozaListy) } : {}),
      ...(okno ? { 'X-Cosmos-Okno': okno } : {}),
    });
    try {
      for await (const chunk of upstream.body) { zegar.pilnuj(); res.write(chunk); }
    } catch {
      /* klient przerwał lub upstream padł – kończymy strumień */
    }
    zegar.stop();
    return res.end();
  }

  /** Przelewa strumień dostawcy do biegu – blokami SSE – i zamyka bieg
   *  z nazwaną przyczyną, gdy coś poszło nie tak. Działa bez widza.
   *
   *  Ciche ponowienie (runda 8, poprawione w rundzie 9): gdy dostawca zawiódł
   *  PRZED pierwszą niebiałą treścią, widz nie dostał nic, więc jedno ponowienie
   *  jest bezpieczne. Ponawiamy błąd przejściowy w strumieniu (429/5xx/529 –
   *  nie brak środków, nie za długą rozmowę, nie zły klucz), koniec bez [DONE]
   *  i zerwane gniazdo. Nie przy pomiarze płynności i nie po długim cichym
   *  myśleniu (błąd później niż PONOWIENIE_DO_MS od nagłówków). Bloki sprzed
   *  pierwszej treści (rola, samo „\n”) czekają – po ponowieniu nie dublują się. */
  async function pompujDoBiegu(bieg, upstream, { ep, model, payload, abort, zegar, ponow = null }) {
    const dekoder = new TextDecoder();
    let ponowien = 0;
    let ogon = '';
    /* Czy dostawca powiedział „koniec" ([DONE] albo finish_reason). Strumień,
       który po prostu się urwał, wyglądał dotąd jak pełna odpowiedź – urwane
       zdanie lądowało w rozmowie jako gotowe. */
    let koniecWidziany = false;
    let bladDostawcy = null;          // { tresc, status }
    let zerwanie = null;              // wyjątek czytania strumienia
    let bylaTresc = false;
    let wstrzymane = [];
    let odNaglowkow = Date.now();
    const zjedz = (blok) => {
      if (!blok.trim()) return;
      /* Błąd po 200 szedł do przeglądarki jak zwykły blok, a ona go nie
         rozumiała – człowiek widział „połączenie się zerwało" zamiast
         „dostawca przeciążony". Teraz zamyka bieg z nazwaną przyczyną. */
      const blad = rozpoznajBladStrumienia(blok);
      if (blad) { bladDostawcy = blad; return; }
      if (/^data:\s*\[DONE\]/m.test(blok) || /"finish_reason"\s*:\s*"[a-z_]+"/.test(blok)) koniecWidziany = true;
      if (bylaTresc) { biegi.dopisz(bieg, blok); return; }
      wstrzymane.push(blok);
      if (!maTresc(blok)) return;
      bylaTresc = true;
      for (const w of wstrzymane) biegi.dopisz(bieg, w);
      wstrzymane = [];
    };
    // Po nagłówkach, przed pierwszą treścią: dłuższy limit dla modeli myślących po cichu.
    const czuwaj = () => zegar.pilnuj(bylaTresc || !cichoMysli(ep, model) ? CISZA_MODELU_MS : CISZA_MYSLENIA_MS);
    const gniazdoPadlo = (e) => /terminated|socket|ECONNRESET|other side closed|UND_ERR/i.test(`${e?.message || ''} ${e?.cause?.code || ''} ${e?.cause?.message || ''}`);
    try {
      czuwaj();
      for (;;) {
        zerwanie = null;
        try {
          for await (const chunk of upstream.body) {
            czuwaj();
            // llama-cpp-python i część serwerów rozdziela ramki „\r\n\r\n" –
            // bez ujednolicenia cała odpowiedź przychodziła jednym kawałkiem na końcu.
            ogon = (ogon + dekoder.decode(chunk, { stream: true })).replace(/\r\n|\r(?!$)/g, '\n');
            // Bloki SSE, nie bajty: numerowanie zdarzeń wymaga całych bloków,
            // bo po nich klient wraca („mam do 137, dawaj resztę").
            const bloki = ogon.split('\n\n');
            ogon = bloki.pop();
            for (const blok of bloki) { zjedz(blok); if (bladDostawcy) break; }
            /* Po błędzie nie czytamy dalej: dostawca, który nie zamyka połączenia,
               trzymał bieg 90 s i kończył „Model zamilkł” zamiast przyczyny. */
            if (bladDostawcy) break;
          }
          if (!bladDostawcy) zjedz(ogon.replace(/\r$/, ''));
        } catch (err) {
          zerwanie = err;
        }
        if (bladDostawcy) upstream.body?.cancel().catch(() => {});
        const zerwaneGniazdo = Boolean(zerwanie) && !zegar.cisza && !abort.signal.aborted && gniazdoPadlo(zerwanie);
        const pustyKoniec = !zerwanie && !bladDostawcy && !koniecWidziany;
        const mozna = !bylaTresc && ponow && ponowien < 1 && !abort.signal.aborted && !zegar.cisza
          && payload.pomiar !== true && Date.now() - odNaglowkow <= PONOWIENIE_DO_MS;
        if (mozna && (bladPrzejsciowy(bladDostawcy) || zerwaneGniazdo || pustyKoniec)) {
          ponowien++;
          const pierwszy = { bladDostawcy, zerwanie };
          console.warn(`Dostawca zawiódł przed pierwszym słowem (${bladDostawcy ? `${bladDostawcy.status || 'bez kodu'}: ${scrubSecrets(bladDostawcy.tresc)}`
            : zerwanie ? 'zerwane połączenie' : 'koniec bez [DONE]'}) – ponawiam raz.`);
          bladDostawcy = null; zerwanie = null; ogon = ''; koniecWidziany = false; wstrzymane = [];
          czuwaj();   // przerwa na ponowienie to nie „cisza modelu”
          await new Promise((r) => setTimeout(r, 700));
          let nowa = null;
          try {
            nowa = await ponow();
          } catch (e) {
            /* Błąd sieci przy ponowieniu kończył bieg surowym „fetch failed” –
               przyczyną dla człowieka zostaje pierwszy błąd (runda 9). */
            throw e;
            console.warn('Ponowienie nie doszło:', e.message);
          }
          if (nowa && nowa.ok && nowa.body) { upstream = nowa; odNaglowkow = Date.now(); czuwaj(); continue; }
          if (nowa && !nowa.ok) {
            /* Ponowienie wróciło z innym błędem (np. 401) – mówimy o NIM, nie
               o pierwszym „przeciążeniu”: przy złym kluczu to byłaby zła rada. */
            const tekst = await nowa.text().catch(() => '');
            let tresc = tekst.slice(0, 300);
            try { const j = JSON.parse(tekst); tresc = String(j?.error?.message || j?.error || j?.message || j?.detail || tresc).slice(0, 300); } catch { /* nie JSON */ }
            bladDostawcy = { tresc, status: nowa.status };
          } else {
            nowa?.body?.cancel().catch(() => {});
            ({ bladDostawcy, zerwanie } = pierwszy);
          }
        }
        break;
      }
      zegar.stop();
      if (!bladDostawcy && !zerwanie && wstrzymane.length) { for (const w of wstrzymane) biegi.dopisz(bieg, w); wstrzymane = []; }
      if (zerwanie) {
        const powod = zegar.cisza
          ? (bylaTresc || !cichoMysli(ep, model)
            ? `Model zamilkł na ${Math.round(CISZA_MODELU_MS / 1000)} s w trakcie odpowiedzi. Spróbuj ponownie.`
            : `Model myślał ponad ${Math.round(CISZA_MYSLENIA_MS / 60000)} min i nie zaczął odpowiadać. Spróbuj ponownie albo zadaj prostsze pytanie.`)
          : abort.signal.aborted ? ''
            : gniazdoPadlo(zerwanie)
              ? (bylaTresc ? 'Połączenie z dostawcą modelu zerwało się w trakcie odpowiedzi. Spróbuj ponownie.'
                : 'Dostawca zamknął połączenie, zanim zaczął odpowiadać. Spróbuj ponownie albo przełącz silnik.')
              : (zerwanie.message || 'Strumień modelu przerwany.');
        return biegi.zakoncz(bieg, powod);
      }
      if (bladDostawcy) {
        /* Gdy znamy przyczynę po polsku (przeciążenie, środki, kontekst, limit
           tempa, błąd serwera), tylko ona. Surowa treść dostawcy idzie do dziennika,
           a na ekran – zdanie po polsku z tym, co zrobić (runda 9). */
        const { tresc, status } = bladDostawcy;
        console.warn(`Dostawca przerwał odpowiedź [${ep.label} · ${model}] (${status || 'bez kodu'}): ${scrubSecrets(tresc)}`);
        /* llama.cpp mówi o pełnym oknie „Context size has been exceeded” – tego
           brzmienia wspólna podpowiedź (lib/rdzen.js) nie zna; dopisujemy kod
           OpenAI, żeby padło zdanie o za długiej rozmowie. */
        const doPodpowiedzi = /context size|context.{0,20}exceeded/i.test(tresc) ? `${tresc} (context_length_exceeded)` : tresc;
        const podpowiedz = modelErrorHint(payload.endpoint, model, status, { tresc: doPodpowiedzi, baseUrl: ep.baseUrl }).trim();
        const powod = podpowiedz ? `Odpowiedź przerwana. ${podpowiedz}`
          : bylaTresc ? 'Dostawca przerwał odpowiedź w trakcie. Naciśnij „Ponów” albo przełącz silnik.'
            : bladPrzejsciowy(bladDostawcy) ? 'Dostawca przerwał odpowiedź, zanim coś napisał. Zwykle to chwilowe – naciśnij „Ponów” albo przełącz silnik.'
              : 'Dostawca odrzucił to pytanie, zanim coś napisał. Przełącz silnik albo wybierz w Ustawieniach inny model.';
        // Trzeci argument (`trwaly`) czyta biegi.zakoncz od rundy 9 – przeglądarka pokazuje wtedy drogę do Ustawień.
        return biegi.zakoncz(bieg, powod, bladTrwaly(status, tresc) ? { trwaly: true } : undefined);
      }
      biegi.zakoncz(bieg, koniecWidziany ? ''
        : bylaTresc ? 'Model urwał odpowiedź w połowie – połączenie z dostawcą się zerwało. Spróbuj ponownie.'
          : 'Dostawca zamknął połączenie, zanim zaczął odpowiadać. Spróbuj ponownie albo przełącz silnik.');
    } catch (err) {
      zegar.stop();
      biegi.zakoncz(bieg, abort.signal.aborted ? '' : (err.message || 'Strumień modelu przerwany.'));
    }
  }

  /** POST /api/chat */
  async function handleChat(req, res, { wazny } = {}) {
    // Limit ciszy liczymy od przyjścia żądania, nie od wysłania do dostawcy – patrz zegar niżej.
    const t0 = Date.now();
    let payload;
    try {
      payload = await readJson(req, CZAT_MAX_B);
    } catch (err) {
      if (/too large|za duż/i.test(err.message || '')) {
        return sendJson(res, 413, { error: `Wiadomość jest za duża (limit ${Math.round(CZAT_MAX_B / 1048576)} MB) – wyślij mniej albo mniejsze zdjęcia.` });
      }
      return sendJson(res, 400, { error: 'Nieprawidłowy JSON w żądaniu.' });
    }

    if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
      return sendJson(res, 400, { error: 'Pole "messages" jest wymagane.' });
    }

    /* Uprawnienie sprawdzamy WPROST, zanim cokolwiek poleci do modelu. Strażnik
       w `pickEndpoint` i tak podmieniłby silnik na chmurę NVIDIA, ale wtedy
       osoba prosząca o Claude'a dostałaby odpowiedź Nemotrona bez słowa
       wyjaśnienia – a to wygląda jak usterka, nie jak decyzja właściciela. */
    const dostepSilnika = silniki.dostep(payload.endpoint);
    if (payload.endpoint && payload.endpoint !== 'cloud' && !dostepSilnika.ok) {
      return sendJson(res, 403, { error: dostepSilnika.powod, kod: 'silnik-niedostepny' });
    }
    const ep = pickEndpoint(payload.endpoint);

    /* Identyfikator biegu nadaje przeglądarka – musi go znać ZANIM wyśle
       żądanie, bo inaczej nie miałaby po czym wrócić, gdyby połączenie padło
       w pierwszej sekundzie. Bez `bieg` trasa działa po staremu (zwykłe proxy),
       co zostawia furtkę dla starych klientów i dla testów. */
    const biegId = typeof payload.bieg === 'string' && /^[a-z0-9-]{8,64}$/i.test(payload.bieg)
      ? payload.bieg : '';
    // Klucz z osobą – jak w lib/biegi.js: znajomość cudzego id nie pozwala przerwać cudzego żądania.
    const kluczOczekujacego = `${kto().id}:${biegId}`;
    if (biegId) {
      const dubel = await jakDubel(biegId, kluczOczekujacego);
      if (dubel === 'bieg' && biegi.podepnij(biegId, 0, res, { wazny })) return;
      if (dubel === 'zatrzymany') { res.writeHead(204); return res.end(); }
    }

    // Jedyne, co właściciel widzi o cudzej aktywności: liczba wiadomości.
    konta.zanotujWiadomosc(kto().id);

    if (!ep.apiKey && ep.baseUrl.includes('integrate.api.nvidia.com')) {
      // 502, nie 401: 401 przeglądarka bierze za wygasłą sesję i pokazuje logowanie.
      return sendJson(res, 502, { kod: 'brak-klucza', trwaly: true,
        error: 'Brak klucza API dla chmury NVIDIA. Ustaw NVIDIA_API_KEY w pliku .env ' +
               '(klucz wygenerujesz na https://build.nvidia.com).',
      });
    }
    /* Bezpiecznik nie odmawia na ślepo: komputer obudzony przed chwilą dostawał
       „jest uśpiony… kolejna próba za 24 s", choć panel stanu mówił już
       „online" (zespół IT, runda 5). Szybka sonda – 1,5 s zamiast 10 s limitu
       łączenia – i przy odpowiedzi bezpiecznik znika. */
    if (payload.endpoint === 'local' && Date.now() < lokalnyNiedostepny.do) {
      const zyje = await fetch(`${ep.baseUrl}/models`, { headers: authHeaders(ep), signal: AbortSignal.timeout(1500) })
        .then((r) => r.status < 500).catch(() => false);
      if (zyje) lokalnyNiedostepny = { do: 0, rodzaj: '' };
      else {
        return sendJson(res, 502, { kod: 'lokalny-niedostepny', rodzaj: lokalnyNiedostepny.rodzaj,
          error: komunikatLokalnego(lokalnyNiedostepny.rodzaj, ep) });
      }
    }

    const abort = new AbortController();
    /* „Stop" zanim dostawca odpowie nagłówkami: biegu jeszcze nie ma, więc
       /api/chat/stop szuka tu. Rejestr trwa od przyjęcia żądania do nagłówków –
       także przez składanie kontekstu, które czeka na embeddingi. Dawniej
       rejestracja stała PO nim: Stop w pierwszych sekundach nie znajdował nic,
       pytanie i tak szło do dostawcy (płatne), a zatrzymana odpowiedź lądowała
       w rozmowie (zespół IT, runda 4). */
    if (biegId) OCZEKUJACE.set(kluczOczekujacego, abort);
    try {
      const { messages: zKontekstem, oknoLokalne, chronOd, obrazowZBazy } = await zlozKontekst(payload, ep);
      // Zatrzymane w trakcie składania kontekstu – nic nie idzie do dostawcy.
      if (abort.signal.aborted) { res.writeHead(204); return res.end(); }

      // Wybór modelu – po zbudowaniu kontekstu, bo baza wiedzy mogła dodać obrazy.
      const maObraz = ostatniaMaObraz(zKontekstem);
      const wybor = wybierzModel(payload, ep, maObraz);
      if (wybor.blad) return sendJson(res, ...wybor.blad);
      const { modelSpozaListy } = wybor;
      const zObrazem = maObraz && !wybor.bezObrazow;
      /* Notka o obrazie (albo o jego braku) PRZED przycięciem do okna – liczy się
         do budżetu. Dawniej doklejana po przycięciu: prompt + limit odpowiedzi
         wychodził poza okno i vLLM odmawiał (runda 9). Obie wstawiają jedną
         wiadomość przed rozmową, więc granica bieżącej tury przesuwa się o tyle. */
      const zNotka = wybor.bezObrazow ? bezObrazow(zKontekstem)
        : zObrazem ? zObrazemWidzisz(zKontekstem, { klatkaKamery: payload.klatkaKamery, obrazowZBazy }) : zKontekstem;
      const { wiadomosci: doWyslania, przycietoTur, skrocono, limitZOkna } = przytnijDoOkna(zNotka, oknoLokalne, payload.max_tokens,
        chronOd + (zNotka.length - zKontekstem.length));
      const okno = przycietoTur || skrocono ? `${oknoLokalne};${przycietoTur};${skrocono ? 1 : 0}` : '';

      const body = {
        model: wybor.model,
        messages: doWyslania,
        temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.6,
        // Sufit osoby także przy oknie modelu lokalnego (LOCAL_NUM_CTX) – dawniej je omijało.
        max_tokens: silniki.tokenyDozwolone(payload.endpoint, limitZOkna || (Number.isInteger(payload.max_tokens) ? payload.max_tokens : 2048)),
        top_p: typeof payload.top_p === 'number' ? payload.top_p : 0.95,
        stream: true,
      };

      /* Było tu `req.on('close', () => abort.abort())` i wyglądało to na przyczynę
         zgłoszenia Marcina („wychodzę ze strony i wszystko jest przerywane").
         Zmierzone: ta linia NIGDY nie działała. `readJson(req)` na początku funkcji
         wyczerpuje strumień żądania, więc `close` leci od razu po wczytaniu korpusu
         – w momencie podpięcia `req.closed` jest już `true` i uchwyt nie ma czego
         złapać. Sonda: klient zrywa połączenie po 1,2 s, a bieg rośnie dalej
         (184 → 612 znaków) i kończy się normalnie.

         Prawdziwa strata była gdzie indziej: odpowiedź istniała WYŁĄCZNIE
         w przeglądarce. Serwer dopisywał ją do martwego gniazda i wyrzucał, nie
         zapisując nigdzie – po powrocie nie było do czego wracać. To naprawiają
         biegi. Uchwyt zostawiamy na starej ścieżce (bez `bieg`), gdzie i tak jest
         martwy, a usunięcie go tylko zaciemniłoby diff. */
      if (!biegId) req.on('close', () => abort.abort());

      /* Limit ciszy od przyjścia żądania: składanie kontekstu (embeddingi) też
         się liczy, inaczej 504 przychodziło po 96,9 s – 3 s od strony 524
         Cloudflare'a (zespół IT, runda 4). */
      const zegar = zegarCiszy(abort);
      // Najmniej 5 s na samego dostawcę – ale nigdy więcej niż ustawiony limit.
      zegar.pilnuj(Math.max(Math.min(5_000, CISZA_MODELU_MS), CISZA_MODELU_MS - (Date.now() - t0)));

      let wynik;
      try {
        wynik = await wyslijDoDostawcy({ ep, body, abort, payload, maObraz: zObrazem, swappedFrom: wybor.swappedFrom });
      } catch (err) {
        zegar.stop();
        return odpowiedzBledemPolaczenia(res, err, { ep, model: body.model, payload, abort, zegar });
      }
      const { upstream, model, swappedFrom } = wynik;
      const zObrazemWyslane = zObrazem && !wynik.bezObrazowPo;

      // Połączenie się udało – komputer domowy żyje, bezpiecznik zdjęty.
      if (payload.endpoint === 'local') lokalnyNiedostepny = { do: 0, rodzaj: '' };
      if (!upstream.ok) {
        zegar.stop();
        if (payload.endpoint === 'local' && [502, 503, 504].includes(upstream.status)) {
          const tresc = await upstream.clone().text().catch(() => '');
          /* Pośrednik (tailscale serve, nginx) przed wyłączoną Ollamą: 502 bez
             treści albo strona HTML. To „komputer domowy nie ma modelu”, nie
             „błąd modelu” – z bezpiecznikiem i przyciskiem „Wyślij przez Chmurę”. */
          if (!tresc.trim() || toStronaHtml(tresc)) {
            upstream.body?.cancel().catch(() => {});
            lokalnyNiedostepny = { do: Date.now() + LOKALNY_BEZPIECZNIK_MS, rodzaj: 'brama' };
            return sendJson(res, 502, { kod: 'lokalny-niedostepny', rodzaj: 'brama', error: komunikatLokalnego('brama', ep) });
          }
          // llama.cpp w trakcie ładowania: 503 „Loading model” – to zimny start, nie awaria.
          if (upstream.status === 503 && /loading model/i.test(tresc)) {
            upstream.body?.cancel().catch(() => {});
            return sendJson(res, 503, { kod: 'zimny-start', error: `Lokalny model dopiero ładuje się do pamięci karty – spróbuj za chwilę `
              + `albo wyślij przez Chmurę.  [${ep.label} · ${model}]` });
          }
        }
        return odpowiedzBledemDostawcy(res, upstream, { ep, model, payload, maObraz: zObrazemWyslane });
      }

      if (!biegId) return przekazWprost(res, upstream, { model, swappedFrom, modelSpozaListy, okno, zegar });

      /* Bieg. Od tej chwili odpowiedź należy do serwera: czytamy ją do końca
         niezależnie od tego, czy ktoś patrzy. Przeglądarka, która właśnie wysłała
         to żądanie, jest po prostu pierwszym widzem – takim samym jak ta, która
         podepnie się za pięć minut z telefonu. */
      const bieg = biegi.zacznij({
        id: biegId,
        rozmowaId: typeof payload.rozmowa === 'string' ? payload.rozmowa : '',
        model,
        silnik: payload.endpoint,
        podmienionyZ: swappedFrom,
        spozaListy: modelSpozaListy,
        okno,
      });
      bieg.przerwij = () => abort.abort();
      biegi.podepnij(biegId, 0, res, { wazny });

      /* Świadomie BEZ `await`: trasa oddaje sterowanie, a pompa dalej przelewa
         strumień do biegu. Gdyby tu było `await`, żądanie HTTP trzymałoby bieg
         przy życiu i wróciłby dokładnie ten problem, który naprawiamy. */
      pompujDoBiegu(bieg, upstream, {
        ep, model, payload, abort, zegar,
        // Pomiar płynności ma zobaczyć model takim, jaki jest – bez cichego ponowienia.
        ponow: payload.pomiar === true ? null
          : async () => (await wyslijDoDostawcy({ ep, body: { ...body, model }, abort, payload, maObraz: zObrazemWyslane, swappedFrom })).upstream,
      });
    } finally {
      if (biegId) OCZEKUJACE.delete(kluczOczekujacego);
    }
  }

  return { handleChat, OCZEKUJACE, zatrzymajOczekujacy, zlozKontekst };
}

module.exports = {
  utworz,
  // czyste funkcje – dla testów
  rodzajBleduPolaczenia, oknoLokalneDla, oknoZSerwera, szacujTokeny, bladWStrumieniu, tekstPytania,
  ostatniaMaObraz, bezObrazow, zObrazemWidzisz, przytnijDoOkna, cichoMysli, zegarCiszy,
  rozpoznajBladStrumienia, bladPrzejsciowy, maTresc, odmowaRozmiaru, SLEPE_MODELE,
};

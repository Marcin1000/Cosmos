/* ============================================================
   Rdzeń serwera — konfiguracja i pomocnicze

   Wszystko, czego potrzebuje każdy inny moduł: wczytanie `.env`, definicje
   silników, ścieżki, oraz cztery funkcje, bez których nie da się obsłużyć
   żądania (odpowiedź JSON-em, odczyt ciała, wybór silnika, nagłówki
   uwierzytelniające).

   Ten plik nie wie nic o rozmowach, zmysłach ani o Studiu — zależność idzie
   tylko w jedną stronę.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

const KORZEN = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Konfiguracja: zmienne środowiskowe + opcjonalny plik .env
// ---------------------------------------------------------------------------

function loadDotEnv(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = value;
    }
  } catch {
    /* brak .env — używamy tylko zmiennych środowiskowych */
  }
}

loadDotEnv(path.join(KORZEN, '.env'));

const ENDPOINTS = {
  cloud: {
    label: 'Chmura NVIDIA',
    baseUrl: (process.env.NEMOTRON_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.NVIDIA_API_KEY || '',
    // Awaryjny domyślny model, gdy .env go nie podaje. Trzymamy go zgodnie
    // z .env.example i z pomiarem płynności — inaczej ktoś bez wpisu w .env
    // dostaje po cichu inny (i wolniejszy) model, niż mówi dokumentacja.
    model: process.env.NEMOTRON_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
    visionModel: process.env.NEMOTRON_VISION_MODEL || '',
  },
  local: {
    label: 'Lokalny (GPU)',
    baseUrl: (process.env.LOCAL_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, ''),
    apiKey: process.env.LOCAL_API_KEY || '',
    model: process.env.LOCAL_MODEL || '',
    visionModel: process.env.LOCAL_VISION_MODEL || '',
  },
};

// Dodatkowe silniki komercyjne — pojawiają się jako zakładki, gdy podasz klucz.
if (process.env.OPENAI_API_KEY) {
  ENDPOINTS.openai = {
    label: 'OpenAI',
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    visionModel: '', // gpt-4o widzi obrazy natywnie
  };
}
if (process.env.ANTHROPIC_API_KEY) {
  ENDPOINTS.claude = {
    label: 'Claude',
    // Warstwa zgodności Anthropic z API OpenAI (chat/completions)
    baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
    visionModel: '',
    anthropic: true,
  };
}

// Studio — generowanie mediów z komercyjnych API (płatne kluczem użytkownika)
const STUDIO = {
  openai: {
    key: process.env.OPENAI_API_KEY || '',
    base: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
  },
  eleven: {
    key: process.env.ELEVENLABS_API_KEY || '',
    base: (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/+$/, ''),
    voice: process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM',
    model: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  },
  seedance: {
    key: process.env.SEEDANCE_API_KEY || '',
    base: (process.env.SEEDANCE_BASE_URL || 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/+$/, ''),
    model: process.env.SEEDANCE_MODEL || 'seedance-2-0',
  },
  firefly: {
    clientId: process.env.FIREFLY_CLIENT_ID || '',
    clientSecret: process.env.FIREFLY_CLIENT_SECRET || '',
    base: (process.env.FIREFLY_BASE_URL || 'https://firefly-api.adobe.io').replace(/\/+$/, ''),
    imsUrl: (process.env.FIREFLY_IMS_URL || 'https://ims-na1.adobelogin.com').replace(/\/+$/, ''),
  },
  exportDir: process.env.STUDIO_EXPORT_DIR || '',
};

function fireflyEnabled() {
  return Boolean(STUDIO.firefly.clientId && STUDIO.firefly.clientSecret);
}

function imageProviders() {
  const list = [];
  if (STUDIO.openai.key) list.push({ id: 'openai', label: `OpenAI (${STUDIO.openai.imageModel})` });
  if (fireflyEnabled()) list.push({ id: 'firefly', label: 'Adobe Firefly' });
  return list;
}

const studioTasks = new Map(); // taskId -> { prompt, osoba } (zadania wideo w toku)

const SENSES_URL = (process.env.SENSES_URL || 'http://localhost:7060').replace(/\/+$/, '');

// Wyszukiwarka internetowa (bez klucza API). Domyślnie DuckDuckGo HTML;
// można podmienić na własny SearXNG itp. (format HTML zgodny z DDG).
const SEARCH_URL = process.env.SEARCH_URL || 'https://html.duckduckgo.com/html/';

// Menedżer haseł — źródło sekretów dla automatyzacji (nazwa → wartość, w locie).
// Sekrety NIGDY nie są zapisywane w procedurach ani wysyłane do przeglądarki-klienta.
const SECRETS = {
  provider: (process.env.SECRETS_PROVIDER || 'none').toLowerCase(), // none|env|bitwarden|onepassword|pass|keepassxc|command
  command: process.env.SECRETS_COMMAND || '',   // szablon z {name}; dla provider=command
  keepassDb: process.env.KEEPASSXC_DB || '',
};

/* Domyślnie `data/` obok serwera. Nadpisywalne, bo testy muszą pisać gdzie
   indziej — inaczej każdy przebieg baterii dokłada rozmowy do prawdziwych
   danych i liczniki rosną z przebiegu na przebieg.
   Miejsce: rdzeń, nie wstrzyknięcie — moduły dziedzin liczą z tego ścieżki
   już w chwili wczytania, więc muszą je znać zanim serwer cokolwiek poda. */
const DATA_DIR = process.env.COSMOS_DATA_DIR
  ? path.resolve(process.env.COSMOS_DATA_DIR)
  : path.join(KORZEN, 'data');

const PORT = Number(process.env.PORT || 3000);
/* Adres nasłuchu. Domyślnie wszystkie interfejsy — tak Cosmos działa w domu,
   z telefonem w tej samej sieci. Na VPS-ie za tunelem: COSMOS_HOST=127.0.0.1,
   bo `cloudflared` łączy się lokalnie, a port 3000 nie ma być osiągalny
   z internetu (bez HTTPS i obok Cloudflare) nawet wtedy, gdy zapora
   przepuści go przez pomyłkę. Nie `HOST`: tę nazwę ustawiają powłoki
   i kontenery — z nazwą maszyny zamiast adresu. */
const HOST = String(process.env.COSMOS_HOST || '').trim();
const PUBLIC_DIR = path.join(KORZEN, 'public');

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    /* Odpowiedzi API to czyjeś dane. Cloudflare ich dziś nie trzyma (ścieżki
       bez rozszerzenia), ale jedna reguła „Cache Everything" w panelu
       podałaby cudzą rozmowę następnej osobie. `no-store` zamyka to z góry. */
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

// 128 MB: plik 50 MB po zakodowaniu base64 w JSON rośnie do ~67 MB
function readBodyBuffer(req, limit = 128 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* JSON czytany domyślnie do 32 MB. Wcześniej każda trasa przyjmowała 128 MB,
   także od gościa: trzy takie żądania podnosiły pamięć serwera do 1,6 GB.
   32 MB mieści czat ze zdjęciami z telefonu; większe (kopia zapasowa, plik
   do bazy wiedzy) podają limit jawnie. */
const JSON_LIMIT = 32 * 1024 * 1024;
async function readJson(req, limit = JSON_LIMIT) {
  return JSON.parse((await readBodyBuffer(req, limit)).toString('utf8'));
}

/* Strażnik silników: przy wielu osobach wybór silnika zależy od tego, KTO
   pyta — czy ma przyznany dostęp, czy własny klucz (lib/silniki.js). Rejestruje
   go serwer, bo rdzeń nie może wymagać modułów zależnych od siebie. Bez
   strażnika — dawne zachowanie. */
let straznikSilnikow = null;
function ustawStraznikaSilnikow(fn) { straznikSilnikow = fn; }

function pickEndpoint(name) {
  if (straznikSilnikow) return straznikSilnikow(name);
  return ENDPOINTS[name] || ENDPOINTS.cloud;
}

/** Podpowiedź „co z tym zrobić" do odmowy dostawcy.
 *
 * Sam komunikat dostawcy nie mówi, co ma zrobić człowiek przed ekranem.
 * Lokalny 404 znaczy zwykle „modelu nie ma jeszcze na dysku" i da się to
 * naprawić jedną komendą, więc tę komendę wypisujemy wprost. W chmurze
 * 404 znaczy co innego: lista modeli u dostawcy pokazuje wszystko, co
 * hostuje, a nie to, do czego Twój klucz ma dostęp.
 */
function modelErrorHint(epName, model, status, { tresc = '', baseUrl = '' } = {}) {
  const local = epName === 'local';
  const t = String(tresc || '');
  /* Najpierw to, co mówi TREŚĆ odmowy — sam kod bywa mylący: brak środków
     przychodzi jako 429 („limit — spróbuj za chwilę") albo 400, a przepełniony
     kontekst jako zwykłe 400. Po angielsku, więc człowiek nie wiedział, że
     „Ponów" nic tu nie da. */
  if (/insufficient_quota|exceeded your current quota|credit balance|billing|API usage limits|regain access|spend_limit/i.test(t)) {
    return ' Na koncie u dostawcy skończyły się środki albo miesięczny limit wydatków — ponawianie nie pomoże. '
      + 'Doładuj konto (albo podnieś limit) u dostawcy albo przełącz się na inny silnik.';
  }
  if (/context.length|context_length_exceeded|maximum context|prompt is too long|exceed context limit|too many tokens/i.test(t)) {
    return ' Rozmowa jest za długa dla tego modelu — nie mieści się w jego oknie kontekstu. '
      + 'Zacznij nową rozmowę (albo streść tę), wyłącz część bazy wiedzy albo wybierz model z większym oknem.';
  }
  if (status === 529 || /overloaded/i.test(t)) {
    return ' Dostawca jest teraz przeciążony (to po jego stronie). Spróbuj za minutę albo przełącz silnik.';
  }
  if (status === 404) {
    if (local) {
      /* „ollama pull" tylko dla Ollamy — vLLM i NIM mają model podany przy
         starcie serwera, a podpowiedź o pull była tam fałszywym tropem. */
      const ollama = /:11434\b/.test(baseUrl) || /try pulling|ollama/i.test(t);
      return ollama
        ? ` Tego modelu nie ma jeszcze na dysku. Pobierz go na domowym komputerze: ollama pull ${model}`
        : ' Lokalny serwer nie ma takiego modelu. W vLLM/NIM identyfikator ustala start serwera '
          + '(--model, --served-model-name) — wybierz w Ustawieniach model z listy „Pobierz listę".';
    }
    return ' Ten model nie jest dostępny na Twoim koncie u dostawcy (lista pokazuje wszystko, co dostawca hostuje). '
      + 'Sprawdź przyciskiem „Sprawdź wszystkie z listy" w Ustawieniach, które modele naprawdę działają.';
  }
  if (status === 401 || status === 403) {
    return local
      ? ' Lokalny silnik odrzucił żądanie — sprawdź LOCAL_API_KEY w .env.'
      : ' Klucz API jest nieprawidłowy albo nie ma dostępu do tego modelu.';
  }
  if (status === 429) return ' Limit zapytań u dostawcy — spróbuj za chwilę.';
  if (status >= 500) return ' Błąd po stronie dostawcy — zwykle przejściowy. Spróbuj ponownie za chwilę.';
  return '';
}

/* Obrazy z cudzych serwerów — miniatury wyszukiwania, OneDrive, klatka
   Kinecta — oddajemy spod NASZEJ domeny. Samo `^image/` przepuszczało SVG,
   a SVG potrafi mieć skrypt: otwarty wprost pod cosmosai.live działałby
   z ciastkiem zalogowanej osoby. Stąd lista dozwolonych typów i nagłówki,
   które każą przeglądarce nie zgadywać typu i niczego nie uruchamiać. */
const OBRAZY_BEZPIECZNE = /^image\/(png|jpeg|jpg|gif|webp|avif|bmp)\s*(;|$)/i;
const obrazBezpieczny = (typ) => OBRAZY_BEZPIECZNE.test(String(typ || '').trim());
const NAGLOWKI_CUDZEGO = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
});

/** Zapis przez plik tymczasowy i podmianę nazwy.
 *
 *  `writeFileSync` NIE JEST niepodzielny: najpierw obcina plik do zera, potem
 *  dopisuje treść. Przerwanie między jednym a drugim — restart usługi w złym
 *  momencie, zanik zasilania VPS-a, brak miejsca na dysku — zostawia plik
 *  pusty albo urwany w połowie. Przy `archiwum.json` zauważyłem to od razu
 *  i zrobiłem tam zapis przez plik tymczasowy; reszta danych została po
 *  staremu, i to jest niespójność po złej stronie. Indeks zdjęć odbudowuje
 *  się jednym kliknięciem „Indeksuj teraz". Rozmowy, pamięć długotrwała
 *  i baza wiedzy nie odbudowują się wcale.
 *
 *  `rename` w obrębie jednego katalogu jest w systemie plików operacją
 *  niepodzielną: albo widać starą treść, albo nową. Nigdy połowy.
 */
function zapiszAtomowo(file, tresc, opcje = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  /* Tryb dostępu USTAWIAMY NA PLIKU TYMCZASOWYM, nie po podmianie. Token
     OneDrive zapisany najpierw jawnie, a obcięty do 0600 dopiero sekundę
     później, jest przez tę sekundę do odczytania przez każdego na maszynie —
     krótkie okno to wciąż okno. `rename` zachowuje uprawnienia pliku.
     Resztka po przerwanym zapisie zachowałaby SWÓJ tryb — `mode` działa tylko
     przy zakładaniu pliku. Stąd świeży plik za każdym razem. */
  try { fs.unlinkSync(tmp); } catch { /* nie było resztki */ }
  const fd = fs.openSync(tmp, 'wx', opcje.mode || 0o666);
  try {
    const buf = Buffer.isBuffer(tresc) ? tresc : Buffer.from(String(tresc));
    for (let off = 0; off < buf.length;) off += fs.writeSync(fd, buf, off, buf.length - off);
    /* `trwale`: zrzut na dysk przed podmianą — dla małych plików, których nie
       da się odtworzyć (konta, klucze, token). Nie dla wszystkich: `fsync`
       stoi w pętli zdarzeń, a licznik wiadomości czy 40-megabajtowy indeks
       bazy wiedzy zatrzymywałyby wtedy serwer przy każdym zapisie. Przy
       podmianie przez `rename` ext4 (VPS) i tak zapisuje dane pliku przed
       nową nazwą — po zaniku zasilania zostaje stara albo nowa treść. */
    if (opcje.trwale) fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  /* Poprzednia wersja zostaje jako `.bak` — przez TWARDE DOWIĄZANIE, nie zmianę
     nazwy. Przy dwóch `rename` (plik → .bak, tmp → plik) między nimi pliku
     nie było wcale: wywrotka w tym oknie i start widział „brak danych".
     Dowiązanie nie kopiuje ani bajtu, a plik ani przez chwilę nie znika spod
     swojej nazwy. Gdzie dowiązań nie ma (FAT, dyski sieciowe) — kopia. */
  if (opcje.kopia && fs.existsSync(file)) {
    const bak = `${file}.bak`;
    try { fs.unlinkSync(bak); } catch { /* pierwszy zapis z kopią */ }
    try { fs.linkSync(file, bak); } catch {
      try { fs.copyFileSync(file, bak); } catch { /* bez kopii — zapis ważniejszy */ }
    }
  }
  fs.renameSync(tmp, file);
}

/* Poprzednia wersja z `.bak` — albo `undefined`, gdy kopii nie ma albo też
   jest nieczytelna. Przywracamy NA DYSKU, nie tylko w pamięci: inaczej
   następny zapis z `kopia: true` odłożyłby jako `.bak` plik uszkodzony,
   a dobrą kopię nadpisał. */
function zKopiiBak(plik) {
  let dane;
  try { dane = JSON.parse(fs.readFileSync(`${plik}.bak`, 'utf8')); } catch { return undefined; }
  try { fs.copyFileSync(`${plik}.bak`, plik); } catch { /* zostaje w pamięci */ }
  console.error(`    Przywrócono poprzednią wersję z ${path.basename(plik)}.bak.\n`);
  return dane;
}

/** Odczyt pliku JSON z danymi, które NIE MOGĄ zniknąć po cichu.
 *
 *  Dawniej każdy moduł robił `try { JSON.parse(readFileSync) } catch { return [] }`.
 *  Ucięty plik (zanik zasilania, ręczna edycja) dawał więc pusty stan
 *  i serwer wstawał „czysty" bez słowa — a PIERWSZY zapis nadpisywał
 *  uszkodzony plik pustą listą. Tak ginęły konta członków, pamięć, baza
 *  wiedzy i indeks rozmów. Teraz:
 *    - brak pliku → wartość domyślna (zwykły pierwszy start) — chyba że
 *      obok leży `.bak`, bo wtedy to nie pierwszy start,
 *    - plik nieczytelny → kopia `*.uszkodzony-<czas>` zanim ktokolwiek go
 *      nadpisze, głośny komunikat w logu, próba z `.bak`,
 *    - `krytyczny` (konta) → serwer NIE wstaje, zamiast wstać bez kont. */
function czytajJson(plik, domyslnie, { krytyczny = false } = {}) {
  let tresc;
  try {
    tresc = fs.readFileSync(plik, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      if (!fs.existsSync(`${plik}.bak`)) return domyslnie;
      console.error(`\n  ✗ BRAK PLIKU: ${plik}, choć jest jego kopia .bak.`);
      const zKopii = zKopiiBak(plik);
      return zKopii === undefined ? domyslnie : zKopii;
    }
    if (krytyczny) throw err;
    console.error(`Nie da się odczytać ${plik}: ${err.message}`);
    return domyslnie;
  }
  try {
    if (!tresc.trim()) throw new Error('plik jest pusty');
    return JSON.parse(tresc);
  } catch (err) {
    const kopia = `${plik}.uszkodzony-${Date.now()}`;
    try { fs.copyFileSync(plik, kopia); } catch { /* i tak próbujemy dalej */ }
    console.error(`\n  ✗ USZKODZONY PLIK: ${plik} (${err.message}).`
      + `\n    Kopia zachowana jako ${path.basename(kopia)} — nic nie zostało nadpisane.`);
    const zKopii = zKopiiBak(plik);
    if (zKopii !== undefined) return zKopii;
    if (krytyczny) {
      throw new Error(`Plik ${plik} jest uszkodzony, a kopii .bak nie ma. Serwer nie wstanie, żeby niczego `
        + 'nie nadpisać — przywróć plik z kopii zapasowej albo usuń go świadomie.');
    }
    console.error('    Brak kopii .bak — startuję z pustym stanem TEGO pliku.\n');
    return domyslnie;
  }
}

/** Zapis JSON-a na dysk bez wywrotki procesu. W rdzeniu, bo używa tego pięć
    różnych dziedzin. Nie rzuca, ale ZWRACA błąd (null = zapisane) — trasa,
    która po zapisie odpowiada „ok", ma go sprawdzić (lib/miejsce.js). */
function saveJsonFile(file, data) {
  try { zapiszAtomowo(file, JSON.stringify(data, null, 2)); return null; }
  catch (err) { console.error(`Nie udało się zapisać ${path.basename(file)}:`, err.message); return err; }
}

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Nagłówki uwierzytelnienia. Claude ma dwie drogi i każda chce CZEGO INNEGO
 *  (dokumentacja Anthropic): warstwa zgodna z OpenAI (`chat/completions`) —
 *  samo `Authorization: Bearer`, tak jak wysyła je SDK OpenAI; natywne API
 *  (`/v1/models`) — `x-api-key` z `anthropic-version`. Wysyłaliśmy oba naraz
 *  wszędzie; API odrzuca żądanie z dwoma poświadczeniami (opisany przypadek:
 *  klucz + token OAuth), więc nie ryzykujemy, że to samo spotka dwa klucze. */
function authHeaders(ep, { natywne = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (!ep.apiKey) return headers;
  if (ep.anthropic && natywne) {
    headers['x-api-key'] = ep.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else {
    headers.Authorization = `Bearer ${ep.apiKey}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
module.exports = {
  KORZEN, PORT, HOST, PUBLIC_DIR, DATA_DIR, ENDPOINTS, STUDIO, SENSES_URL, SEARCH_URL, SECRETS,
  loadDotEnv, sendJson, readBodyBuffer, readJson, pickEndpoint,
  ustawStraznikaSilnikow, modelErrorHint, authHeaders, saveJsonFile, zapiszAtomowo, czytajJson,
  obrazBezpieczny, NAGLOWKI_CUDZEGO, genId, fireflyEnabled, imageProviders, studioTasks,
};

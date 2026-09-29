#!/usr/bin/env node
/**
 * Cosmos – serwer aplikacji AI („dyrygent orkiestry”)
 *
 * Łączy w jeden organizm:
 *   • cloud  – chmura NVIDIA (build.nvidia.com) – rozumowanie / wizja,
 *   • local  – model na Twoim GPU (Ollama / vLLM / NIM),
 *   • senses – usługa percepcji (Python): słuch (Whisper), głos (Piper),
 *              widzenie (YOLO/MediaPipe) i zdarzenia z czujników.
 *
 * Zdarzenia percepcji trafiają do kontekstu rozmowy, więc model
 * „wie”, co dzieje się wokół – jak jeden byt, nie zbiór narzędzi.
 *
 * Zero zależności – wystarczy Node.js >= 18.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Katalog modeli współdzielony z przeglądarką – jedno miejsce wiedzy o tym,
// który model widzi obrazy. Plik eksportuje się i dla okna, i dla Node.
const { modelNotForChat, modelNotAChatPartner } = require('./public/models.js');
// Co model umie (sonda > dostawca > katalog > nazwa) i zapis wyników „Sprawdź”.
const umiejetnosci_ = require('./lib/umiejetnosci.js');

/* Rdzeń: konfiguracja, silniki, ścieżki i cztery pomocnicze, bez których nie
   da się obsłużyć żądania. Zależność idzie tylko w jedną stronę – rdzeń nie
   wie nic o rozmowach, zmysłach ani o Studiu. */
const {
  PORT, HOST, PUBLIC_DIR, DATA_DIR, ENDPOINTS, STUDIO, SENSES_URL, SECRETS,
  sendJson, readBodyBuffer, readJson, pickEndpoint,
  modelErrorHint, authHeaders, saveJsonFile, zapiszAtomowo, czytajJson, genId, fireflyEnabled, imageProviders, ustawStraznikaSilnikow, opisBleduSieci, toStronaHtml,
} = require('./lib/rdzen.js');
/* Wiele osób: kontekst żądania, konta, uprawnienia do silników, stan osoby
   i trasy kont. Zasady – w nagłówkach tych modułów; bramka logowania zostaje
   niżej, w routerze (audyt sprawdza ją strukturalnie). */
const { stan, naUzytkownika, istniejacy, wKontekscie, kto, czyWlasciciel, katalogDla,
  zaladowani, zapomnij, WLASCICIEL_ID } = require('./lib/kontekst.js');
const konta = require('./lib/konta.js');
const agent = require('./lib/agent-zmyslow.js');
const zmyslySerwera = require('./lib/zmysly-serwera.js');
const silniki = require('./lib/silniki.js');
ustawStraznikaSilnikow(silniki.wybierz);
const { stanOsoby } = require('./lib/stan-osoby.js');
/* Cennik modeli i budżet w złotówkach: koszt każdego płatnego wywołania
   (konta.zanotujZuzycie), limity dzienne i miesięczne z rezerwacją dla
   zespołu agentów. Jeden cennik dla kont, czatu, zespołu i widoku. */
const cennik_ = require('./lib/cennik.js').utworzCennik({ env: process.env });
konta.ustawCennik(cennik_);
const budzet_ = require('./lib/budzet.js').utworzBudzet({ konta, cennik: cennik_ });
/* Wywołania pomocnicze (llmComplete) liczą koszt i pilnują budżetu tak samo
   jak czat. Bez osoby (praca serwera, rutyny właściciela) – bez księgowania. */
require('./lib/model.js').ustawKsiegowegoModeli({
  przed(silnik) {
    const u = kto();
    if (!u) return null;
    const d = silniki.dostep(silnik);
    const naKluczuWlasciciela = konta.NA_KLUCZU_WLASCICIELA.includes(d && d.zrodlo);
    if (!cennik_.darmowy(silnik)) {
      const w = budzet_.wyczerpany(u, { naKluczuWlasciciela });
      if (w) {
        const e = new Error(w.limit === 'wlasciciel'
          ? 'Wyczerpany budżet na płatne modele ustawiony przez właściciela. Przełącz na Chmurę albo poproś o większy limit.'
          : 'Wyczerpany Twój budżet na płatne modele (Ustawienia → Agenci). Przełącz na Chmurę albo zmień limit.');
        e.kod = 'budzet-wyczerpany';
        throw e;
      }
    }
    return { id: u.id, zrodlo: d && d.zrodlo };
  },
  po(silnik, model, usage, znacznik, { wy = 0 } = {}) {
    if (!znacznik) return;
    const u = usage ? { we: usage.prompt_tokens || usage.input_tokens || 0, wy: usage.completion_tokens || usage.output_tokens || 0 } : null;
    konta.zanotujZuzycie(znacznik.id, { silnik, zrodlo: znacznik.zrodlo, model,
      we: u ? u.we : 0, wy: u ? u.wy : 0, ...(u ? {} : { szacunek: { we: 0, wy: Math.ceil(wy / 3) } }) });
  },
});
const { authEnabled, ktoPyta, handleLogin, handleLogout, handleZaproszenie,
  obcePochodzenie, handleKonto, handleKonta, migrujDoKont, TYLKO_WLASCICIEL,
} = require('./lib/konta-trasy.js').utworz({
  konta, silniki, kto, katalogDla, zapomnij, WLASCICIEL_ID,
  DATA_DIR, ENDPOINTS, STUDIO, imageProviders, sendJson, readJson, readBodyBuffer,
  budzet: budzet_,
});
/* Czy sesja, z którą przyszło żądanie, dalej istnieje – dla połączeń, które
   trwają długo (strumień zdarzeń, widz odpowiedzi): „Wyloguj wszędzie" i zmiana
   hasła mają je zerwać, a nie tylko odrzucać nowe żądania. */
const sesjaWazna = (req) => () => Boolean(ktoPyta(req));
/* Głos: rozpoznawanie i czytanie na głos z łańcuchem źródeł (zmysły → chmura).
   Tryb głosowy bez Web Speech API = bez piszczenia mikrofonu na Androidzie. */
const glos = require('./lib/glos.js').utworz({
  SENSES_URL, silniki, kto, sendJson, readBodyBuffer, readJson, STUDIO,
  zmysly: { fetch: agent.fetchZmyslow, zrodlo: agent.zrodloZmyslow, stanAgenta: agent.stanAgenta },
  // Płatne źródła głosu na kluczu właściciela liczą się do budżetu osoby.
  budzet: budzet_, cennik: cennik_, konta,
});
const szukanie_ = require('./lib/szukanie.js');
const { handleSearch, szukajTekstu, handleSearchImages, handleImageProxy, stripTags, czytelnyTekst } = szukanie_;
const { uruchomKod, WLACZONE: KOD_WLACZONY } = require('./lib/kod.js');
const { wspolrzedneMiejsca, szukajMiejsca } = require('./lib/miejsca.js');
const canon = require('./lib/canon.js');
const archiwum_ = require('./lib/archiwum.js');
const pamiecModul_ = require('./lib/pamiec.js');
/* Archiwum i OneDrive KAŻDEJ OSOBY OSOBNO. Pośrednik kieruje każde
   `archiwum.coś(…)` do instancji bieżącej osoby, więc reszta pliku się nie
   zmienia – a mimo to nikt nie przeszuka cudzych zdjęć. Dom (do pory światła
   dla zdjęć bez GPS-u) ustawiamy przy tworzeniu instancji, z lokalizacji tej
   samej osoby. */
const archiwum = naUzytkownika('archiwum', (katalog) => {
  const a = archiwum_.utworz(katalog);
  const w = U().wspolrzedne;
  if (w) a.ustawDom(w);
  return a;
});
const onedrive_ = require('./lib/onedrive.js');
const onedrive = naUzytkownika('onedrive', (katalog) => onedrive_.utworz({
  katalogDanych: katalog,
  clientId: process.env.ONEDRIVE_CLIENT_ID || '',
  clientSecret: process.env.ONEDRIVE_CLIENT_SECRET || '',
  redirectUri: process.env.ONEDRIVE_REDIRECT_URI || '',
}));
const trening_ = require('./lib/trening.js');
const { addEvent, recentEvents, podlaczStrumien, ileZdarzen } = require('./lib/zdarzenia.js');
const { TRAIN_DIR, TRAIN_SCRIPT, buildTrainingDataset, commandExists, startTraining, trainJob, trainLog, trainStatusView } = trening_;
const urzadzenia_ = require('./lib/urzadzenia.js');
const { handleGesty } = require('./lib/gesty.js');
const { BRIEFING, handleBriefing, handleDevices, urzadzenia } = urzadzenia_;
const nauka_ = require('./lib/nauka.js');
const { handleAutomation, handleLessons, handleProcedures, handleRoutines,
  routineView, sanitizeStep, saveProcedures, secretsEnabled,
  startScheduler, wzorce, procedury, rutyny, dodajProcedure } = nauka_;
const studio_ = require('./lib/studio.js');
const { handleStudio, tsName } = studio_;
// Praca dłuższa niż 100 s Cloudflare'a (Studio) – zadanie w tle z numerem do dopytywania.
const zadania_ = require('./lib/zadania.js').utworzZadania();
// Limit miejsca na osobę i 507 zamiast „ok", gdy zapis się nie udał.
const miejsce_ = require('./lib/miejsce.js');
const bladZapisu = (res, err) => miejsce_.odpowiedzBledemZapisu(res, sendJson, err);
const { llmComplete, parametryDla } = require('./lib/model.js');
// Pliki statyczne (strona, aplikacja, czcionki, ikony) i CSP aplikacji – lib/statyka.js.
const { serveStatic, wersja: wersjaAplikacji } = require('./lib/statyka.js').utworz({ PUBLIC_DIR });


// ---------------------------------------------------------------------------
// Pamięć długotrwała (RAG) – całość w lib/pamiec.js.
// Tutaj tylko spięcie zależności i cienkie przejścia dla reszty pliku.
// ---------------------------------------------------------------------------
const pamiec_ = naUzytkownika('pamiec', (katalog) => pamiecModul_.utworz({
  katalogDanych: katalog,
  sensesUrl: SENSES_URL,
  fetchZmyslow: agent.fetchZmyslow,
  zmyslyDostepne: () => agent.zmyslyDostepne(),
  chmura: () => ENDPOINTS.cloud,
  sendJson,
  readJson,
}));
const handleMemory = (req, res) => pamiec_.handleMemory(req, res);
const searchMemory = (q, limit) => pamiec_.searchMemory(q, limit);
const memoryContextLines = (items) => pamiec_.memoryContextLines(items);
const embedTexts = (texts, timeoutMs, inputType, opcje) => pamiec_.embedTexts(texts, timeoutMs, inputType, opcje);
const embedStatus = (sensesHasEmbed) => pamiec_.embedStatus(sensesHasEmbed);
// Czyste funkcje podobieństwa – z modułu, nie z instancji: potrzebne też poza żądaniem.
const { cosine, sameModel, keywordScore } = pamiecModul_;

/* Stan bieżącej osoby: indeks rozmów, profil, lokalizacja, sprzęt, baza
   wiedzy, oś czasu – lib/stan-osoby.js. */
const U = () => stanOsoby(BRIEFING);
// Plan zdjęciowy, misja drona, Canon, zestaw sprzętu – lib/plener-trasy.js.
const plener_ = require('./lib/plener-trasy.js').utworz({ U, readJson, sendJson, addEvent, bladZapisu });
// Pośrednik do usługi zmysłów (Python w domu właściciela) – lib/zmysly-proxy.js.
const zmysly_ = require('./lib/zmysly-proxy.js').utworz({ U });
/* Agent zmysłów: komputer osoby łączy się sam (długie odpytywanie), paruje
   kodem z Ustawień i wykonuje zlecenia zmysłów w jej imieniu – lib/agent-zmyslow.js. */
const agentTrasy = agent.utworzTrasy({ konta, wKontekscie, addEvent, stanDomu: async () => sensesState() });
// Historia rozmów: jeden plik na rozmowę + indeks – lib/rozmowy.js.
const rozmowy_ = require('./lib/rozmowy.js').utworz({ U, readJson, sendJson, bladZapisu });
const { convPath } = rozmowy_;
// Baza wiedzy: pliki, linki, notatki, fragmenty z wektorami – lib/baza-wiedzy.js.
const kb_ = require('./lib/baza-wiedzy.js').utworz({
  U, readJson, readBodyBuffer, sendJson, bladZapisu, addEvent, embedTexts, stripTags, czytelnyTekst, SENSES_URL,
  fetchZmyslow: agent.fetchZmyslow, zmyslyDostepne: () => agent.zmyslyDostepne(),
  przepiszMowe: (...a) => glos.przepisz(...a),
  budzet: budzet_, cennik: cennik_, konta,
});
const { kbPliki: KB_FILES, saveKb, kbAddFile, kbItemMeta, kbSearch, obrazDlaModelu, extractKbText, extOf, wymagaTranskrypcji } = kb_;

/* Funkcje save* NIE rzucają (wołają je też timery, gdzie wyjątek wywróciłby
   proces), ale ZWRACAJĄ błąd – null znaczy „zapisane". Trasa, która po zapisie
   odpowiada „ok", sprawdza wynik: pełny dysk ma dać 507, a nie `{ ok: true }`
   dla czegoś, czego po restarcie nie będzie (lib/miejsce.js). */
const { zapiszLubBlad } = miejsce_;

/* Biegi – trwające odpowiedzi modelu, które należą do serwera, a nie do karty
   przeglądarki. Zamknięcie karty ich nie przerywa; patrz lib/biegi.js. */
const biegi_ = require('./lib/biegi.js').utworz({
  zapiszOdpowiedz: rozmowy_.dopiszWiadomosc,
  // Tura zespołu agentów: notatki ról i odpowiedź prowadzącego jednym zapisem.
  zapiszWiadomosci: rozmowy_.dopiszWiadomosci,
});

// Profil użytkownika – trwały tekst wstrzykiwany do każdej rozmowy (pamięć profilowa).
const PROFILE_FILE = () => path.join(U().katalog, 'profile.txt');
function saveProfile(text) {
  const profil = String(text || '').slice(0, 4000);
  const blad = zapiszLubBlad('profilu', () => zapiszAtomowo(PROFILE_FILE(), profil));
  if (!blad) U().profile = profil;
  return blad;
}

/* Lokalizacja domowa – osobno od profilu, bo używa jej nie tylko rozmowa,
   ale i wyszukiwanie („warsztat … w Piasecznie"). Bez niej model pyta
   „w jakim mieście jesteś?" przy każdym pytaniu o cokolwiek w okolicy. */
const LOCATION_FILE = () => path.join(U().katalog, 'location.txt');
/* Sama nazwa miejsca wystarczała do wyszukiwania, ale nie do liczenia pozycji
   Słońca – złota godzina wymaga stopni, nie napisu „Piaseczno". Trzymamy
   jedno i drugie: nazwę dla modelu, współrzędne dla matematyki. */
const WSPOLRZEDNE_FILE = () => path.join(U().katalog, 'location.json');

function saveLocation(text, wspolrzedne) {
  const nazwa = String(text || '').trim().slice(0, 200);
  const blad = zapiszLubBlad('lokalizacji', () => zapiszAtomowo(LOCATION_FILE(), nazwa));
  if (blad) return blad;
  U().location = nazwa;
  /* `null` jawnie = współrzędne do skasowania: nowa nazwa bez współrzędnych
     nie może zostać ze współrzędnymi poprzedniego miejsca („Reykjavik"
     liczony dla Krakowa, zespół IT, runda 5). */
  if (wspolrzedne === null) {
    const bladWsp = zapiszLubBlad('współrzędnych', () => zapiszAtomowo(WSPOLRZEDNE_FILE(), 'null'));
    if (bladWsp) return bladWsp;
    U().wspolrzedne = null;
    return null;
  }
  if (wspolrzedne && Number.isFinite(wspolrzedne.lat) && Number.isFinite(wspolrzedne.lon)) {
    // Nazwa, dla której te współrzędne są – po niej poznajemy, że wpisano nowe miejsce.
    const wsp = { lat: wspolrzedne.lat, lon: wspolrzedne.lon, nazwa };
    const bladWsp = zapiszLubBlad('współrzędnych', () => zapiszAtomowo(WSPOLRZEDNE_FILE(), JSON.stringify(wsp)));
    if (bladWsp) return bladWsp;
    U().wspolrzedne = wsp;
    /* Archiwum liczy pore swiatla dla zdjec bez GPS-u wzgledem domu, wiec
       zmiana lokalizacji musi je przeliczyc - inaczej wpisy dodane wczesniej
       zostaja z `null` mimo ze jest juz z czego je policzyc. */
    if (typeof archiwum !== 'undefined') {
      archiwum.ustawDom(U().wspolrzedne);
      const ile = archiwum.przeliczSwiatlo();
      if (ile) addEvent('archiwum', `przeliczono pore swiatla dla ${ile} plikow`);
    }
  }
  return null;
}

/* Data i godzina. Model zna świat wyłącznie do końca swojego treningu –
   bez tej linijki na pytanie „który dziś?" zgaduje, i to nie „nie wiem",
   tylko konkretną złą datę. Strefa z ENV, bo serwer stoi w UTC. */
const STREFA_CZASU = process.env.COSMOS_TZ || 'Europe/Warsaw';
function terazTekst() {
  const t = new Date();
  const dzien = t.toLocaleDateString('pl-PL',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: STREFA_CZASU });
  const godzina = t.toLocaleTimeString('pl-PL',
    { hour: '2-digit', minute: '2-digit', timeZone: STREFA_CZASU });
  return `${dzien}, godzina ${godzina} (strefa ${STREFA_CZASU})`;
}

/* Współrzędne → nazwa miejscowości. Przeglądarka daje samo „52.05, 20.90",
   a do wyszukiwarki trzeba wpisać „Piaseczno". Zamiana idzie przez serwer,
   nie przez przeglądarkę: dzięki temu współrzędne nie trafiają do obcego
   hosta z Twojego telefonu razem z jego nagłówkami, a my możemy podać
   uczciwy User-Agent, którego Nominatim wymaga. */
const GEOKOD_URL = process.env.GEOCODE_URL || 'https://nominatim.openstreetmap.org/reverse';
const GEOKOD_MS = Number(process.env.GEOCODE_TIMEOUT_MS || 6000);
async function handleGeokod(req, res) {
  if (GEOKOD_URL === 'off') return sendJson(res, 503, { error: 'Zamiana współrzędnych na nazwę jest wyłączona.' });
  let dane;
  try { dane = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
  const lat = Number(dane.lat);
  const lon = Number(dane.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return sendJson(res, 400, { error: 'Brak poprawnych współrzędnych.' });
  }
  const url = `${GEOKOD_URL}?format=jsonv2&zoom=13&accept-language=pl`
    + `&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
  const stoper = AbortSignal.timeout(GEOKOD_MS);
  try {
    const r = await fetch(url, { signal: stoper, headers: { 'User-Agent': 'Cosmos/2.0 (prywatny asystent)' } });
    if (!r.ok) return zapiszSameWspolrzedne();
    const d = await r.json();
    const a = d.address || {};
    // Od najbardziej konkretnego: wieś → miasteczko → miasto → gmina.
    const miejsce = a.village || a.town || a.city || a.municipality || a.county || '';
    const region = a.state || '';
    const nazwa = [miejsce, region].filter(Boolean).join(', ') || d.display_name || '';
    /* Nominatim na morzu i na pustkowiu odpowiada 200 z {"error":"Unable to
       geocode"} – współrzędne z telefonu są dobre i nie mogą przepaść. */
    if (!nazwa) return zapiszSameWspolrzedne();
    // Zapisujemy od razu: to jedyny moment, w którym mamy i nazwę,
    // i współrzędne. Bez nich złota godzina nie ma z czego się policzyć.
    const blad = saveLocation(nazwa, { lat, lon });
    if (blad) return bladZapisu(res, blad);
    addEvent('lokalizacja', `Ustalono lokalizację: ${nazwa}`);
    return sendJson(res, 200, { location: nazwa, lat, lon });
  } catch {
    return zapiszSameWspolrzedne();
  }
  /* Usługa nazw zawiodła, ale współrzędne z telefonu są DOBRE i tylko one są
     potrzebne do liczenia światła. Dawniej przepadały razem z błędem 502
     (agencja, runda 5). Zapisujemy je z nazwą ze współrzędnych. */
  function zapiszSameWspolrzedne() {
    const nazwa = `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    const blad = saveLocation(nazwa, { lat, lon });
    if (blad) return bladZapisu(res, blad);
    return sendJson(res, 200, { location: nazwa, lat, lon, bezNazwy: true });
  }
}

/* Załącznik do ROZMOWY (nie do bazy wiedzy). Cosmos wyciąga tekst i oddaje go
   przeglądarce, która dokleja go do wiadomości – model dostaje treść umowy,
   a nie informację, że plik istnieje. */
const DOKUMENT_MAX_B = Number(process.env.DOCUMENT_MAX_BYTES || 25_000_000);
const DOKUMENT_ZNAKI = Number(process.env.DOCUMENT_MAX_CHARS || 120_000);

async function handleDokument(req, res) {
  const nazwa = String(req.headers['x-file-name'] || 'plik').slice(0, 200);
  const buf = await readBodyBuffer(req);
  if (!buf.length) return sendJson(res, 400, { error: 'Pusty plik.' });
  if (buf.length > DOKUMENT_MAX_B) {
    return sendJson(res, 413, { error: `Plik większy niż ${Math.round(DOKUMENT_MAX_B / 1e6)} MB.` });
  }
  const ext = extOf(nazwa);
  /* Przeglądarka czeka na ten tekst – całość musi się zmieścić przed limitem
     Cloudflare (100 s), inaczej zamiast odpowiedzi przychodzi strona 524. */
  const tekst = (await extractKbText(nazwa, req.headers['content-type'] || '', buf, { czasMs: 85000 })) || '';
  if (!tekst.trim()) {
    return sendJson(res, 200, {
      name: nazwa, chars: 0, text: '',
      error: wymagaTranskrypcji(nazwa, req.headers['content-type'] || '')
        ? 'Nie udało się przepisać nagrania od ręki (zmysły wyłączone albo nagranie za długie na minutę czekania). '
          + 'Dodaj je do bazy wiedzy – tam przepisze się w tle.'
        : ext === 'pdf'
        ? 'To wygląda na skan – nie ma w nim warstwy tekstowej. Odczytanie wymaga OCR, '
          + 'czyli uruchomionej usługi zmysłów na komputerze domowym.'
        : `Nie umiem odczytać pliku .${ext}. Obsługiwane: PDF, DOCX, XLSX, PPTX, CSV i pliki tekstowe.`,
    });
  }
  const przyciety = tekst.slice(0, DOKUMENT_ZNAKI);
  addEvent('dokument', `wczytano ${nazwa} (${przyciety.length} znaków)`);
  sendJson(res, 200, {
    name: nazwa,
    chars: przyciety.length,
    truncated: tekst.length > DOKUMENT_ZNAKI,
    text: przyciety,
  });
}

/* Uruchomienie kodu napisanego przez model. Ograniczenia i to, czego one NIE
   obejmują, opisuje nagłówek lib/kod.js – najkrócej: brak dostępu do plików
   serwera i podprocesów, zero zmiennych środowiskowych, twardy limit czasu. */
async function handleUruchom(req, res) {
  if (!KOD_WLACZONY) return sendJson(res, 503, { error: 'Wykonywanie kodu jest wyłączone (CODE_EXEC=off).' });
  let dane;
  try { dane = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
  const kod = String(dane.code || '');
  if (!kod.trim()) return sendJson(res, 400, { error: 'Brak kodu do uruchomienia.' });
  if (kod.length > 100000) return sendJson(res, 413, { error: 'Kod jest za długi.' });
  const pliki = Array.isArray(dane.files) ? dane.files.slice(0, 8) : [];

  const wynik = await uruchomKod(kod, pliki);
  addEvent('kod', `uruchomiono kod (${wynik.ms} ms${wynik.przerwany ? ', przerwany limitem' : ''})`);
  sendJson(res, 200, wynik);
}

/* OneDrive: logowanie i U().indeksowanie. Cały przepływ OAuth siedzi tutaj,
   bo wymaga tras HTTP; sama rozmowa z Microsoftem jest w lib/onedrive.js. */

async function handleOneDrive(req, res, p) {
  if (p === '/api/onedrive/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      skonfigurowany: onedrive.skonfigurowany(),
      polaczony: onedrive.polaczony(),
      polaczenie: onedrive.stanPolaczenia(),
      wymagaLogowania: onedrive.wymagaLogowania(),
      redirectUri: process.env.ONEDRIVE_REDIRECT_URI || null,
      indeksowanie: U().indeksowanie
        ? { trwa: U().indeksowanie.trwa, przejrzanych: U().indeksowanie.przejrzanych,
            dodanych: U().indeksowanie.dodanych, blad: U().indeksowanie.blad, wznowione: U().indeksowanie.wznowione }
        : null,
      wArchiwum: archiwum.ile(),
      // Ile z tego ma już dane z plików – patrz `postep()` w lib/archiwum.js.
      postep: archiwum.postep(),
    });
  }

  if (p === '/api/onedrive/login' && req.method === 'GET') {
    if (!onedrive.skonfigurowany()) {
      return sendJson(res, 400, {
        error: 'Brak konfiguracji OneDrive. Ustaw ONEDRIVE_CLIENT_ID, '
          + 'ONEDRIVE_CLIENT_SECRET i ONEDRIVE_REDIRECT_URI w pliku .env.',
      });
    }
    /* `state` chroni przed podrzuceniem cudzego kodu autoryzacyjnego:
       wracający callback musi podać dokładnie tę wartość – i wrócić do TEJ
       SAMEJ osoby. Wspólny zbiór pozwalał członkowi podsunąć właścicielowi
       link z kodem ze swojego konta Microsoft: archiwum właściciela
       indeksowało wtedy cudzy OneDrive. Losowanie kryptograficzne, nie genId(). */
    const stanCsrf = crypto.randomBytes(16).toString('base64url');
    oczekiwaneStany.set(stanCsrf, kto().id);
    setTimeout(() => oczekiwaneStany.delete(stanCsrf), 600000).unref?.();
    return sendJson(res, 200, { url: onedrive.adresLogowania(stanCsrf) });
  }

  if (p === '/api/onedrive/callback' && req.method === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const strona = (tytul, tresc) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>${tytul}</title>`
        + '<body style="font-family:system-ui;background:#0b0d12;color:#e6e9ef;'
        + 'display:flex;align-items:center;justify-content:center;height:100vh;text-align:center">'
        + `<div><h2>${tytul}</h2><p>${tresc}</p></div>`);
    };
    if (q.get('error')) {
      return strona('Nie udało się połączyć', escapeHtmlSerwer(q.get('error_description') || q.get('error')));
    }
    if (oczekiwaneStany.get(q.get('state') || '') !== kto().id) {
      return strona('Nie udało się połączyć', 'Nieprawidłowy albo przeterminowany identyfikator sesji.');
    }
    oczekiwaneStany.delete(q.get('state'));
    try {
      await onedrive.polacz(q.get('code'));
      addEvent('archiwum', 'połączono z OneDrive');
      return strona('OneDrive połączony', 'Możesz zamknąć tę kartę i wrócić do Cosmosa.');
    } catch (err) {
      return strona('Nie udało się połączyć', escapeHtmlSerwer(err.message));
    }
  }

  if (p === '/api/onedrive/index' && req.method === 'POST') {
    if (!onedrive.polaczony()) return sendJson(res, 400, { error: 'OneDrive niepołączony.' });
    if (U().indeksowanie && U().indeksowanie.trwa) {
      return sendJson(res, 409, { error: 'Indeksowanie już trwa.', stan: U().indeksowanie });
    }
    let d = {};
    try { d = await readJson(req); } catch { /* bez parametrów też można */ }
    // Zapisana kolejka tego samego folderu = dokończ, zamiast zaczynać od korzenia.
    const zapisana = d.odNowa ? null : czytajJson(KOLEJKA_ONEDRIVE(), null);
    const folder = d.folder || '';
    const wznow = zapisana && zapisana.folder === folder ? zapisana : null;
    ruszIndeksowanieOneDrive({ folder, limit: Number(d.limit) || (wznow && wznow.limit) || 100000, wznow });
    return sendJson(res, 202, { ruszylo: true, wznowione: Boolean(wznow) });
  }

  if (p === '/api/onedrive/index' && req.method === 'DELETE') {
    if (U().indeksowanie) U().indeksowanie.sygnal.przerwane = true;
    // Człowiek przerwał świadomie – następne indeksowanie zaczyna od początku.
    if (U().indeksowanie) U().indeksowanie.porzuc = true;
    /* Bez trwającego indeksowania (np. po nieudanym wznowieniu) kolejki nie
       skasowałby nikt – „Stop" robi to wprost. */
    if (!U().indeksowanie || !U().indeksowanie.trwa) { try { fs.unlinkSync(KOLEJKA_ONEDRIVE()); } catch { /* nie było */ } }
    return sendJson(res, 200, { przerwano: true });
  }

  /* ODŁĄCZENIE ŹRÓDŁA TO NIE TO SAMO CO USUNIĘCIE MATERIAŁU.
   *
   *  Stało tu `archiwum.usunZrodlo('onedrive')`, czyli odłączenie konta
   *  kasowało CAŁY zaindeksowany materiał – u Marcina 55 tysięcy plików
   *  razem z rozpoznanymi treściami i dociągniętym EXIF-em. Wystarczyło
   *  odłączyć i podłączyć konto z powrotem (choćby po to, żeby odświeżyć
   *  poświadczenia), żeby stracić godziny pracy karty graficznej.
   *
   *  Przeczyło to zasadzie zapisanej w nagłówku `lib/archiwum.js`: indeks
   *  jest PASYWNY i ma działać bez połączenia – „ile klipów 50 mm w tym
   *  roku" ma odpowiedzieć z telefonu w terenie przy wyłączonym komputerze.
   *  Bez połączenia nie działają MINIATURY, bo podpisane adresy trzeba
   *  dociągać na bieżąco; metadane nie mają z tym nic wspólnego.
   *
   *  Kasowanie zostaje dostępne, ale jako OSOBNA, świadoma decyzja:
   *  DELETE /api/archive/source?zrodlo=onedrive. */
  if (p === '/api/onedrive/disconnect' && req.method === 'POST') {
    onedrive.rozlacz();
    const zostalo = archiwum.szukaj({ zrodlo: 'onedrive' }).length;
    addEvent('archiwum', `odłączono OneDrive (indeks zachowany: ${zostalo} wpisów)`);
    return sendJson(res, 200, { ok: true, usunieto: 0, zachowano: zostalo });
  }

  return sendJson(res, 404, { error: 'Nieznana trasa OneDrive.' });
}

/* Kolejka folderów OneDrive na dysku osoby – żeby restart serwera w połowie
   przejścia po 2 TB nie zaczynał go od korzenia. Zapis najwyżej co
   KOLEJKA_ZAPIS_MS (kolejka potrafi mieć tysiące adresów), usunięcie po
   skończeniu albo po przerwaniu przez człowieka. Błąd Graph (wygasły token,
   brak sieci) kolejkę ZOSTAWIA – do dokończenia. */
const KOLEJKA_ONEDRIVE = () => path.join(U().katalog, 'onedrive-kolejka.json');
const KOLEJKA_ZAPIS_MS = Number(process.env.COSMOS_ONEDRIVE_ZAPIS_MS ?? 2000);

function ruszIndeksowanieOneDrive({ folder, limit, wznow }) {
  const ind = {
    trwa: true, przejrzanych: (wznow && wznow.przejrzanych) || 0, dodanych: (wznow && wznow.dodanych) || 0,
    blad: null, sygnal: { przerwane: false }, wznowione: Boolean(wznow), porzuc: false,
  };
  U().indeksowanie = ind;
  const plik = KOLEJKA_ONEDRIVE();
  let ostatniZapis = 0;
  /* Indeksowanie idzie W TLE i nie blokuje odpowiedzi: przy 2 TB trwa
     kilkanaście minut, a przeglądarka zerwałaby połączenie po minucie. */
  (async () => {
    try {
      const wynik = await onedrive.indeksuj(async (paczka) => {
        // Porcjami – strona z Graph to setki plików, liczonych jednym ciągiem.
        await archiwum.dodajPorcjami(paczka);
        ind.dodanych += paczka.length;
      }, {
        folder, limit, sygnal: ind.sygnal, wznow,
        naPostep: async (stanKolejki) => {
          ind.przejrzanych = stanKolejki.przejrzanych;
          if (Date.now() - ostatniZapis < KOLEJKA_ZAPIS_MS) return;
          ostatniZapis = Date.now();
          /* Najpierw archiwum, potem kolejka: kolejka nie może obiecywać
             folderów „zrobionych", których wpisów nie ma jeszcze na dysku. Stąd
             zapis obejmujący wszystko do teraz – i kolejka tylko po udanym
             (pełny dysk: kilkukilobajtowa kolejka by się zapisała, a archiwum nie). */
          if (!(await archiwum.zapiszPoTeraz())) return;
          try { zapiszAtomowo(plik, JSON.stringify({ folder, limit, ...stanKolejki, zapisano: Date.now() })); } catch { /* następnym razem */ }
        },
      });
      if (wynik.skonczone || ind.porzuc) { try { fs.unlinkSync(plik); } catch { /* nie było */ } }
      addEvent('archiwum', `OneDrive: zindeksowano ${ind.dodanych} plików${ind.wznowione ? ' (wznowione po przerwie)' : ''}`);
    } catch (err) {
      ind.blad = err.message;
      console.error('Indeksowanie OneDrive:', err.message);
    } finally {
      ind.trwa = false;
      // `zapisz()` jest asynchroniczny – czekamy, żeby „indeksowanie
      // skończone" znaczyło też „zapisane na dysk".
      await archiwum.zapisz();
    }
  })();
}

/** Po starcie serwera: dokończ przerwane indeksowania – każdej osoby w jej imieniu. */
function wznowIndeksowaniaOneDrive() {
  const zwloka = Number(process.env.COSMOS_WZNOW_ONEDRIVE_MS ?? 15000);
  setTimeout(() => {
    for (const osoba of konta.wszyscy()) {
      const u = konta.znajdz(osoba.id);
      if (!u) continue;
      wKontekscie(u, () => {
        const zapisana = czytajJson(KOLEJKA_ONEDRIVE(), null);
        if (!zapisana || !Array.isArray(zapisana.doOdwiedzenia) || !onedrive.polaczony()) return;
        if (U().indeksowanie && U().indeksowanie.trwa) return;
        console.log(`  → OneDrive: wznawiam indeksowanie (${zapisana.doOdwiedzenia.length} w kolejce, ${zapisana.dodanych || 0} już dodanych)`);
        ruszIndeksowanieOneDrive({ folder: zapisana.folder || '', limit: zapisana.limit || 100000, wznow: zapisana });
      });
    }
  }, zwloka).unref();
}

const oczekiwaneStany = new Map();   // state OAuth OneDrive → id osoby, która zaczęła logowanie
const escapeHtmlSerwer = (s) => String(s || '').replace(/[&<>"]/g,
  (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[z]));

// ---------------------------------------------------------------------------
// SAMOŚWIADOMOŚĆ – manifest zdolności.
//   Cosmos musi wiedzieć, czym JEST i co REALNIE potrafi w tej chwili – nie
//   z wyuczonej formułki, tylko z żywego stanu systemu. Dzięki temu nie obiecuje
//   rzeczy, których nie ma skonfigurowanych, i potrafi powiedzieć, jak je włączyć.
// ---------------------------------------------------------------------------

let sensesCache = { at: 0, online: false, caps: {} };
let sensesOdswiezanie = null;

/* Odpytanie zmysłów NIE MOŻE wstrzymywać rozmowy.
   Tak było: co minutę cache wygasał, a `capabilityManifest()` – czekający na
   ten fetch – jest awaitowany PRZED wysłaniem pytania do modelu. Komputer
   domowy Marcina bywa wyłączony, więc raz na minutę pierwsza wiadomość
   płaciła do 1,5 s ciszy, zanim model w ogóle dostał pytanie.

   Ta sama zasada, co przy pamięci długotrwałej: dodatek do odpowiedzi nigdy
   nie wstrzymuje samej odpowiedzi. Oddajemy to, co wiemy, a świeży stan
   dociąga się w tle na następną wiadomość. */
const ZMYSLY_CACHE_MS = Number(process.env.SENSES_CACHE_MS || 60000);
function sensesState() {
  /* Zmysły z komputera tej osoby (agent) – stan zgłasza sam agent, bez pytania. */
  const zrodlo = agent.zrodloZmyslow();
  if (zrodlo === 'agent') return agent.stanAgenta() || { online: false, caps: {} };
  if (zrodlo !== 'dom') return { online: false, caps: {} };
  const swiezy = Date.now() - sensesCache.at < ZMYSLY_CACHE_MS;
  if (!swiezy && !sensesOdswiezanie) {
    sensesOdswiezanie = (async () => {
      try {
        const r = await fetch(`${SENSES_URL}/health`, { signal: AbortSignal.timeout(1500) });
        const caps = r.ok ? await r.json() : {};
        sensesCache = { at: Date.now(), online: r.ok, caps: caps.caps || caps || {} };
      } catch {
        sensesCache = { at: Date.now(), online: false, caps: {} };
      } finally {
        sensesOdswiezanie = null;
      }
    })();
  }
  // Przy pierwszym w życiu zapytaniu nie ma czego oddać – wtedy czekamy,
  // ale tylko ten jeden raz, nie co minutę.
  return sensesCache.at ? sensesCache : sensesOdswiezanie.then(() => sensesCache);
}

// Łańcuch źródeł (ptaki) pomija dom znany jako offline – bez 10 s czekania na połączenie.
agent.znajStanDomu(() => sensesCache);

function moduleExists(...parts) {
  return fs.existsSync(path.join(__dirname, ...parts));
}

/* `opcje.widzi` – czy silnik tej rozmowy widzi obrazy (czat liczy to z modelu
   i modelu wizyjnego). Bez niego manifest nie mówi o obrazach nic: dawniej
   obiecywał wzrok każdemu silnikowi, także ślepemu, i przeczył notce
   „ten model nie widzi obrazów” w tym samym prompcie (runda 9). */
async function capabilityManifest(opcje = {}) {
  // Członek bez zgody na zmysły ich nie ma – model nie może mu ich obiecywać.
  const senses = agent.zmyslyDostepne() ? await sensesState() : { online: false, caps: {} };
  /* Manifest idzie do kontekstu czatu tej osoby – ma mówić o JEJ możliwościach.
     Członkowi obiecywał Studio i silniki, których mu nie przyznano, i oddawał
     ścieżkę eksportu z dysku serwera (zasada 8). */
  const studio = silniki.studioDozwolone();
  const imgs = studio ? imageProviders().map((p) => p.label) : [];
  let playwright = false;
  try { require.resolve('playwright'); playwright = true; } catch { /* brak */ }

  const missing = [];
  if (!ENDPOINTS.cloud.apiKey) missing.push('chmura NVIDIA – ustaw NVIDIA_API_KEY w .env');
  if (!ENDPOINTS.local.model) missing.push('model lokalny na RTX – uruchom Ollamę i ustaw LOCAL_MODEL');
  /* Nie „wzrok”: zdjęcie i klatka z kamery idą do modelu wizyjnego bez zmysłów.
     Po słowie „wzrok” model odmawiał opisania obrazu, który miał przed sobą.
     O obrazach mówi osobna linia manifestu (`obrazy`), tylko gdy wiadomo. */
  if (!senses.online) missing.push('zmysły na komputerze (Whisper, rozpoznawanie obiektów YOLO) – uruchom python senses/service.py');
  if (!embedStatus(senses.caps && senses.caps.embed).provider) {
    missing.push('wyszukiwanie semantyczne – uruchom zmysły albo ustaw NVIDIA_API_KEY '
      + '(embeddingi z chmury działają też przy wyłączonym komputerze domowym)');
  }
  if (!imgs.length) missing.push('generowanie obrazów – ustaw OPENAI_API_KEY lub FIREFLY_CLIENT_ID');
  if (!STUDIO.eleven.key) missing.push('lektor ElevenLabs – ustaw ELEVENLABS_API_KEY');
  if (!STUDIO.seedance.key) missing.push('wideo Seedance – ustaw SEEDANCE_API_KEY');
  if (!playwright) missing.push('nagrywanie i automatyzacja stron – npm install playwright');
  if (!secretsEnabled()) missing.push('logowanie z menedżera haseł – ustaw SECRETS_PROVIDER');
  if (!BRIEFING.lat || !BRIEFING.lon) missing.push('poranna odprawa (pogoda) – ustaw BRIEFING_LAT i BRIEFING_LON');
  if (!BRIEFING.ics) missing.push('kalendarz w odprawie – ustaw CALENDAR_ICS');
  if (!urzadzenia().length) missing.push('sterowanie urządzeniami – dodaj je w Ustawieniach → Urządzenia');

  return {
    tozsamosc: 'Cosmos – osobiste, prywatne środowisko AI użytkownika. Mózgiem jest model '
      + 'językowy (domyślnie NVIDIA Nemotron), ale Cosmos to całość: pamięć, zmysły, '
      + 'narzędzia i zdolność uczenia się. Wszystko działa na sprzęcie użytkownika '
      + 'albo na jego serwerze; dane i klucze nie należą do nikogo innego.',
    mozgi: silniki.dostepne().map(({ nazwa: id, ep }) => ({
      id, model: ep.model || '(nie ustawiono)', gotowy: Boolean(ep.apiKey || ep.model),
    })),
    zmysly: { online: senses.online, ...senses.caps },
    obrazy: typeof opcje.widzi === 'boolean' ? opcje.widzi : null,
    embeddingi: embedStatus(senses.caps && senses.caps.embed),
    studio: { obraz: imgs, dzwiek: studio && Boolean(STUDIO.eleven.key), wideo: studio && Boolean(STUDIO.seedance.key),
      eksport: czyWlasciciel() ? (STUDIO.exportDir || null) : null },
    wiedza: { rozmowy: U().convIndex.length, pamiec: pamiec_.ile(), bazaWiedzy: U().kbItems.length,
      profil: U().profile.trim().length > 0, migawki: U().timeline.length },
    nauka: { wzorce: wzorce().length, procedury: procedury().length, rutyny: rutyny().length,
      nagrywanieEkranu: playwright, automatyzacjaOdczytu: playwright,
      menedzerHasel: secretsEnabled() ? SECRETS.provider : null },
    dom: { urzadzenia: urzadzenia().map((d) => d.name), odprawa: Boolean(BRIEFING.lat && BRIEFING.lon),
      kalendarz: Boolean(BRIEFING.ics) },
    teren: { photoscan: moduleExists('senses', 'photoscan.py'),
      terrain: moduleExists('senses', 'terrain.py') },
    /* Plener. Bez tego wpisu Cosmos na pytanie „co potrafisz" nie wymieniał
       ani misji waypointowej, ani kart ujęć – a od kiedy mają interfejs,
       jest dokąd odesłać człowieka zamiast tłumaczyć trasę HTTP. */
    plener: {
      sprzet: [U().sprzet.korpus, U().sprzet.obiektywy, U().sprzet.dodatki].filter(Boolean).join(' · ') || null,
      aparatPoWifi: canon.skonfigurowany(),
      misjaKmz: true,
      kartyUjec: true,
      archiwum: onedrive.skonfigurowany(),
    },
    /* Liczba rozmów, nie dokładna liczba przykładów. Dokładną liczy
       buildTrainingDataset, czytając i parsując KAŻDĄ rozmowę – a manifest
       idzie do kontekstu przy każdej wiadomości: 114 ms stania serwera na
       wiadomość przy 300 rozmowach. Dokładnie liczy /api/train/env, gdy
       ktoś naprawdę otwiera trening. Trening jest tylko u właściciela. */
    trening: czyWlasciciel()
      ? { przykladyChat: U().convIndex.length, skrypt: moduleExists('training', 'qlora_example.py') }
      : null,
    // Braki w konfiguracji serwera naprawia właściciel – członkowi to tylko szum.
    brakujace: czyWlasciciel() ? missing : [],
  };
}

/** Zwięzły opis do wstrzyknięcia w kontekst rozmowy (model musi to zrozumieć od razu). */
function capabilityText(m) {
  const yes = (v) => (v ? 'tak' : 'nie');
  const z = m.zmysly;
  const lines = [
    'KIM JESTEŚ – TWOJE REALNE MOŻLIWOŚCI (stan na teraz, nie ogólniki):',
    m.tozsamosc,
    '',
    'Mózgi: ' + m.mozgi.map((b) => `${b.id}=${b.model}${b.gotowy ? '' : ' (niegotowy)'}`).join(', '),
    `Zmysły: ${z.online ? 'online' : 'offline'} – mowa(Whisper)=${yes(z.whisper)}, `
      + `głos(Piper)=${yes(z.piper)}, rozpoznawanie obiektów na komputerze (YOLO)=${yes(z.yolo)}, `
      + `embeddingi=${yes(z.embed)}, upscale=${yes(z.upscale)}`,
    // MediaPipe bywa zainstalowany, ale żadna funkcja interfejsu go nie wywołuje.
    // Bez tego zastrzeżenia model obiecywał odczyt sylwetki, którego nie ma.
    // Nigdy oba zdania naraz: albo silnik widzi, albo nie; bez wiedzy – żadne.
    m.obrazy === true ? 'Obrazy: zdjęcia i klatki z kamery dołączone do pytania widzisz – ten silnik ma model wizyjny '
      + '(działa to także bez zmysłów).'
      : m.obrazy === false ? 'Obrazy: ten model nie odczytuje zdjęć ani klatek z kamery – do zdjęć trzeba wybrać '
        + 'w Ustawieniach model oznaczony „widzi obrazy”.' : null,
    `Sylwetka (MediaPipe): ${z.mediapipe ? 'biblioteka zainstalowana, ale ŻADNA funkcja '
      + 'Cosmosa jej nie wywołuje – nie obiecuj odczytu sylwetki z kamery przeglądarki' : 'nie'}`,
    `Kinect 360: ${z.kinect
      ? 'podłączony – masz podgląd obrazu i mapy głębi w panelu „Kamera na żywo”, '
        + 'a z wiersza poleceń (senses/kinect_win.py) szkielet 20 stawów, postawę, gesty, '
        + 'dystans i sterowanie silnikiem pochylenia'
      : 'niepodłączony albo zmysły nie działają'}`,
    `Wyszukiwanie semantyczne (embeddingi): ${m.embeddingi.opis}`,
    `Studio: obraz=${m.studio.obraz.join('/') || 'brak'}, lektor=${yes(m.studio.dzwiek)}, `
      + `wideo=${yes(m.studio.wideo)}`,
    `Wiedza: rozmów=${m.wiedza.rozmowy}, faktów w pamięci=${m.wiedza.pamiec}, `
      + `pozycji w bazie wiedzy=${m.wiedza.bazaWiedzy}, profil użytkownika=${yes(m.wiedza.profil)}`,
    `Nauka: nauczone wzorce=${m.nauka.wzorce}, procedury=${m.nauka.procedury}, `
      + `rutyny=${m.nauka.rutyny}, nagrywanie ekranu=${yes(m.nauka.nagrywanieEkranu)}, `
      + `menedżer haseł=${m.nauka.menedzerHasel || 'brak'}`,
    `Dom: urządzenia=${m.dom.urzadzenia.join(', ') || 'brak'}, odprawa=${yes(m.dom.odprawa)}`,
    `Teren z drona: analiza nasłonecznienia/cieni/widoku/objętości=${yes(m.teren.terrain)} `
      + `(senses/terrain.py), fotogrametria=${yes(m.teren.photoscan)}`,
    `Plener (panel boczny „Plener") – foto i wideo: plan zdjęciowy dla dowolnego miejsca `
      + 'i godziny, lista ujęć do nakręcenia z ogniskowymi, misja waypointowa dla drona '
      + `do pobrania jako .kmz, aparat Canon po Wi-Fi=${yes(m.plener.aparatPoWifi)}, `
      + `archiwum materiału=${yes(m.plener.archiwum)}. Sprzęt użytkownika: `
      + `${m.plener.sprzet || 'niepodany – poproś o uzupełnienie w Plenerze'}`,
    m.trening ? `Trening własnego modelu: rozmów do nauki≈${m.trening.przykladyChat}, skrypt QLoRA=${yes(m.trening.skrypt)}` : null,
    '',
    'JAK SIĘ UCZYSZ (za zgodą użytkownika): możesz zapamiętywać fakty, zapisywać notatki, '
      + 'uczyć się rozpoznawania obiektów z kamery, uczyć się procedur (także nagranych z ekranu), '
      + 'planować rutyny, a z zebranych rozmów można dotrenować lokalny model.',
    'WAŻNE: nie obiecuj rzeczy oznaczonych wyżej jako niedostępne. Jeśli czegoś brakuje, '
      + 'powiedz wprost, czego i jak to włączyć.',
  ];
  if (m.brakujace.length) {
    lines.push('Obecnie niedostępne (i jak włączyć): ' + m.brakujace.join('; ') + '.');
  }
  return lines.filter((l) => l !== null).join('\n');
}

// --- Backlog usprawnień: pomysły Cosmosa na samego siebie ---
//     Całość w lib/pomysly.js; tutaj zostaje tylko spięcie zależności.
const pomysly_ = naUzytkownika('pomysly', (katalog) => require('./lib/pomysly.js').utworz({
  katalogDanych: katalog,
  saveJsonFile,
  sendJson,
  readJson,
  addEvent,
  llmComplete,
  manifest: () => capabilityManifest(),
  opisZdolnosci: (m) => capabilityText(m),
  profil: () => U().profile,
  tematyRozmow: () => U().convIndex.slice(0, 25).map((c) => c.title).filter(Boolean),
  pozycjeWiedzy: () => U().kbItems.slice(-25).map((it) => it.name).filter(Boolean),
}));
const handleImprovements = (req, res, pathname) => pomysly_.handleImprovements(req, res, pathname);
const handleSuggest = (req, res) => pomysly_.handleSuggest(req, res);

async function handlePolish(req, res) {
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
  const raw = String(data.text || '').trim();
  if (!raw) return sendJson(res, 400, { error: 'Pusty tekst.' });
  if (raw.length > 8000) return sendJson(res, 400, { error: 'Tekst za długi (max 8000 znaków).' });

  const lang = (req.headers['x-cosmos-lang'] === 'en') ? 'en' : 'pl';
  const instruction = lang === 'en'
    ? 'Rewrite the user\'s dictated text as a clear, precise prompt. Keep every requirement and '
      + 'detail they gave; do not invent new ones and do not answer the request. Remove filler, '
      + 'repetition and false starts. Where the intent implies it, state the desired output format, '
      + 'and add a short bulleted list of the concrete requirements. Reply with the prompt only, '
      + 'in the same language as the input.'
    : 'Przepisz podyktowany tekst użytkownika jako jasny, precyzyjny prompt. Zachowaj WSZYSTKIE '
      + 'wymagania i szczegóły, które podał; nie dopisuj nowych i nie odpowiadaj na prośbę. '
      + 'Usuń wypełniacze, powtórzenia i urwane początki zdań. Jeśli intencja to sugeruje, dopisz '
      + 'oczekiwany format odpowiedzi oraz krótką listę punktową konkretnych wymagań. '
      + 'Odpowiedz samym promptem, w języku oryginału, bez komentarza i bez cudzysłowów.';

  try {
    const text = await llmComplete([
      { role: 'system', content: instruction },
      { role: 'user', content: raw },
    ], { endpoint: data.endpoint || 'cloud', model: data.model, maxTokens: 1200 });
    return sendJson(res, 200, { ok: true, text: text.trim() });
  } catch (err) {
    return sendJson(res, 502, { error: 'polish-failed', message: err.message });
  }
}

/** „Co jeszcze możesz dla mnie zrobić?" – propozycje szyte pod tego użytkownika. */
// --- Nagrywanie procedur (opcjonalny moduł Playwright) ---
//     Całość w lib/nagrywanie.js; tutaj tylko spięcie zależności.
const nagrywanie_ = require('./lib/nagrywanie.js').utworz({
  katalogTreningu: TRAIN_DIR,
  skryptNagrywarki: path.join(__dirname, 'automation', 'recorder.js'),
  katalogAutomatyzacji: path.join(__dirname, 'automation'),
  sendJson,
  readJson,
  addEvent,
  sanitizeStep: nauka_.sanitizeStep,
  saveProcedures: nauka_.saveProcedures,
  dodajProcedure: nauka_.dodajProcedure,
});
const handleRecord = (req, res, pathname) => nagrywanie_.handleRecord(req, res, pathname);

async function handleTrainRun(req, res, pathname) {
  if (pathname === '/api/train/env' && req.method === 'GET') {
    return sendJson(res, 200, {
      python: await commandExists('python3'),
      ollama: await commandExists('ollama'),
      script: fs.existsSync(TRAIN_SCRIPT),
      examples: buildTrainingDataset('chat').count,
      busy: Boolean(trainJob && trainJob.status === 'running'),
    });
  }
  if (pathname === '/api/train/status' && req.method === 'GET') {
    return sendJson(res, 200, trainStatusView());
  }
  if (pathname === '/api/train/start' && req.method === 'POST') {
    if (trainJob && trainJob.status === 'running') return sendJson(res, 409, { error: 'busy', message: 'Trening już trwa.' });
    let data = {};
    try { data = await readJson(req); } catch { /* domyślne */ }
    const r = await startTraining(data);
    return sendJson(res, r.ok ? 200 : 400, r);
  }
  if (pathname === '/api/train/stop' && req.method === 'POST') {
    if (trainJob && trainJob.child && trainJob.status === 'running') {
      try { trainJob.child.kill('SIGKILL'); } catch { /* */ }
      trainJob.status = 'stopped'; trainJob.endedAt = Date.now(); trainLog('■ Zatrzymano przez użytkownika.');
    }
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405); res.end();
}

// API: konfiguracja i status
// ---------------------------------------------------------------------------

function handleConfig(res) {
  /* Zakładki silników to to, czego TA osoba może użyć – nie to, co ma serwer.
     Członek bez przyznanego Claude'a nie widzi zakładki Claude, chyba że wpisał
     własny klucz; wtedy `zrodlo: 'wlasny'` mówi, że płaci sam. */
  /* Adres lokalnego silnika i zmysłów to adres domu właściciela (Tailscale),
     a folder eksportu – ścieżka na jego dysku. Członkowi nie są do niczego
     potrzebne, więc ich nie dostaje. */
  const wlasciciel = czyWlasciciel();
  const endpoints = {};
  for (const { nazwa, zrodlo, ep } of silniki.dostepne()) {
    endpoints[nazwa] = {
      label: ep.label,
      baseUrl: nazwa === 'local' && !wlasciciel ? '' : ep.baseUrl,
      model: ep.model,
      visionModel: ep.visionModel || '',
      hasApiKey: nazwa === 'local' ? true : Boolean(ep.apiKey),
      zrodlo,
    };
  }
  sendJson(res, 200, {
    app: 'Cosmos',
    endpoints,
    senses: wlasciciel ? { baseUrl: SENSES_URL } : {},
    uzytkownik: kto(),
    // Commit i nazwa pamięci PWA – żeby po wdrożeniu dało się sprawdzić, co działa na telefonie.
    wersja: wersjaAplikacji(),
    glos: glos.mozliwosci(),
    studio: {
      dozwolone: silniki.studioDozwolone(),
      image: imageProviders().length > 0,
      speech: Boolean(STUDIO.eleven.key),
      video: Boolean(STUDIO.seedance.key),
      exportDir: wlasciciel ? STUDIO.exportDir : null,
    },
    // Zespół agentów: czy i jak – bez modeli właściciela, adresów i kluczy.
    // Budżet w zł: ile zostało (najciaśniejszy limit osoby) i kurs do przeliczeń w widoku.
    zespol: { ...zespol_.doKonfiguracji(), budzet: budzet_.stan(kto()), kurs: cennik_.kurs() },
  });
}

async function handleStatus(req, res) {
  const results = {};
  /* Tylko silniki tej osoby (własny klucz albo przyznane). Członek odpytywał
     OpenAI i Claude'a kluczami właściciela co 30 s z każdej karty i widział,
     czy domowy komputer właściciela jest włączony. */
  const zrodloZmyslow = agent.zrodloZmyslow();
  const zmysly = Boolean(zrodloZmyslow);
  await Promise.all([
    ...silniki.dostepne().map(async ({ nazwa: name, ep }) => {
      try {
        const r = await fetch(`${ep.baseUrl}/models`, {
          headers: authHeaders(ep, { natywne: true }),   // /models u Claude'a to natywne API
          signal: AbortSignal.timeout(5000),
        });
        results[name] = { online: r.ok, status: r.status };
      } catch {
        results[name] = { online: false, status: 0 };
      }
    }),
    (async () => {
      if (!zmysly) return;
      if (zrodloZmyslow === 'agent') {
        const st = agent.stanAgenta() || { online: false, caps: {} };
        results.senses = { online: st.online, caps: st.caps, agent: st.agent };
        return;
      }
      try {
        const r = await fetch(`${SENSES_URL}/health`, { signal: AbortSignal.timeout(3000) });
        const caps = r.ok ? await r.json() : {};
        results.senses = { online: r.ok, caps };
      } catch {
        results.senses = { online: false, caps: {} };
      }
    })(),
  ]);
  results.embeddings = embedStatus(results.senses?.caps?.embed);
  /* Bez zgody na zmysły przeglądarka nie może ich zobaczyć jako „online" –
     inaczej kierowałaby do nich mowę i wykrywanie, a dostawała 403. */
  if (!zmysly) results.senses = { online: false, caps: {}, tylkoWlasciciel: true };
  /* Ptaki mają własną drogę (agent → serwer → dom): przycisk w przeglądarce
     pyta o nią, a nie o zmysły domu – inaczej odmawiał, zanim cokolwiek
     wysłał, choć serwer by rozpoznał (runda 8). Bez adresów. */
  await zmyslySerwera.stanSerwera().catch(() => null);
  const zrodlaPtakow = agent.zrodlaDla(kto(), '/ptak');
  results.ptaki = { ok: zrodlaPtakow.length > 0, zrodlo: zrodlaPtakow[0] || '' };
  sendJson(res, 200, results);
}

// ---------------------------------------------------------------------------
// API: zdarzenia percepcji
// ---------------------------------------------------------------------------

async function handleEvents(req, res) {
  if (req.method === 'POST') {
    try {
      const data = await readJson(req);
      if (Array.isArray(data)) {
        for (const e of data) addEvent(e.type, e.summary);
      } else {
        addEvent(data.type, data.summary);
      }
      return sendJson(res, 200, { ok: true, stored: ileZdarzen() });
    } catch {
      return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' });
    }
  }
  // GET – ostatnie zdarzenia dla UI
  sendJson(res, 200, { events: recentEvents(60 * 60 * 1000, 50) });
}

// ---------------------------------------------------------------------------
// API: czat (streaming SSE) z kontekstem percepcji – całość w lib/czat.js:
// składanie kontekstu, okno modelu lokalnego, wybór modelu, wysyłka, biegi.
// ---------------------------------------------------------------------------
const czat_ = require('./lib/czat.js').utworz({
  U, archiwum, procedury, urzadzenia, searchMemory, memoryContextLines, kbSearch, obrazDlaModelu,
  biegi: biegi_, terazTekst, capabilityManifest, capabilityText, scrubSecrets,
  cennik: cennik_, budzet: budzet_,
});
const { OCZEKUJACE } = czat_;

/** Sprawdź, czy model naprawdę działa NA TYM KONCIE – i czy czyta obrazy.
 *
 * `/v1/models` u NVIDII wypisuje wszystko, co NVIDIA hostuje, a nie to, do czego
 * Twój klucz ma dostęp: część pozycji kończy się „Not found for account". Tego
 * nie da się przewidzieć z nazwy – trzeba spróbować. Wysyłamy więc najtańsze
 * możliwe żądanie (jeden token). Rozmowa: odpowiedź 200 znaczy „działa”.
 * Wzrok: obrazek 8×8 w jednym kolorze i pytanie „jaki to kolor” – samo
 * przyjęcie obrazka 1×1 bywało fałszywym „widzi” (dostawca ignorował obraz,
 * zespół IT runda 9). Wynik ocenia `ocenSondeWzroku` z lib/umiejetnosci.js.
 */
/* Wyniki „Sprawdź” i capabilities dostawców: wiedza o MODELU na kluczu
   właściciela, jeden plik serwera obok kont (bez adresów i kluczy). */
const rejestrModeli = umiejetnosci_.utworzRejestrModeli({
  plik: path.join(DATA_DIR, 'konta', 'modele-sprawdzone.json'), czytajJson, zapiszAtomowo,
});

/* Zespół agentów – jedna tura to jeden bieg: planista, role na modelach
   przydzielonych przez serwer, prowadzący scala (lib/zespol.js). Czat oddaje
   mu turę, gdy przeglądarka o to prosi (`payload.zespol`). */
const zespol_ = require('./lib/zespol.js').utworz({
  czat: czat_, biegi: biegi_, konta, U, terazTekst, szukajTekstu, rejestrModeli,
  // Po SIGTERM żadnych nowych płatnych wywołań – wyniku nikt by nie zobaczył.
  czyZamykanie: () => zamykanie, bladZapisu, scrubSecrets,
  /* Koszt w zł i budżet osoby (szacunek składu, rezerwacja przed płatną rolą)
     oraz plan zdjęciowy policzony przez Cosmosa dla fotografa – w kontekście osoby. */
  cennik: cennik_, budzet: budzet_, policzPlan: plener_.policzPlan,
});
czat_.ustawZespol(zespol_);
const modelLib = require('./lib/model.js');

/** Usuń z komunikatu dostawcy rzeczy, których nie chcemy nigdzie kopiować.
 *
 * NVIDIA wpisuje w odmowę identyfikator konta („Not found for account
 * 'LeJn…'"), a przycisk „Kopiuj wynik" wrzuca całość do schowka – łatwo
 * wtedy wkleić to komuś bez zastanowienia. Do zdiagnozowania problemu ten
 * ciąg nie jest potrzebny, więc go nie pokazujemy.
 */
function scrubSecrets(msg) {
  return String(msg || '')
    .replace(/(for account\s+)'[^']+'/gi, "$1'(ukryte)'")
    .replace(/\bnvapi-[A-Za-z0-9_-]+/g, 'nvapi-(ukryte)')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-(ukryte)')
    // OpenAI przy złym kluczu cytuje jego początek i koniec: „sk-abc***xyz".
    .replace(/\b(sk|nvapi)-[A-Za-z0-9_-]*\*+[A-Za-z0-9_-]*/g, '$1-(ukryte)')
    .replace(/\s+/g, ' ')
    .trim();
}

const PROBE_TIMEOUT_MS = 75000;
/* Całe sprawdzenie modelu (rozmowa + obraz, z ponowieniem) musi się zmieścić
   przed limitem Cloudflare (100 s bez odpowiedzi → strona 524). Wcześniej
   dwie sondy po 75 s z ponowieniem potrafiły trwać 300 s. */
const BUDZET_SPRAWDZENIA_MS = 88_000;

/* Sonda idzie przez te same poprawki parametrów co czat (parametryDla):
   surowe `max_tokens: 1` modele rozumujące OpenAI odrzucały, więc „Sprawdź
   wszystkie" oznaczało gpt-5, o3 i o4-mini jako niedostępne, choć w rozmowie
   działały (zespół IT, runda 5). Limit zostaje mały – to tylko „czy odpowie". */
function cialoSondy(ep, model, content, { wzrok = false } = {}) {
  /* Sonda wzroku potrzebuje słowa odpowiedzi („red”), nie jednego tokenu –
     i myślenia WYŁ. (ustawMyslenie z lib/model.js, gdy katalog zna sposób),
     inaczej model myślący odda pustą treść i nic nie udowodni. */
  let b = parametryDla(ep, { model, messages: [{ role: 'user', content }], max_tokens: wzrok ? 16 : 1, stream: false });
  if (wzrok && typeof modelLib.ustawMyslenie === 'function') b = modelLib.ustawMyslenie(b, model, false) || b;
  for (const k of ['max_tokens', 'max_completion_tokens']) if (typeof b[k] === 'number') b[k] = Math.min(b[k], 32);
  return b;
}
/* Odmowa „skończył się limit tokenów" znaczy, że model JEST i odpowiada –
   przy tak małym limicie część dostawców woli 400 niż uciętą odpowiedź. */
const ODMOWA_LIMITU_SONDY = /max_tokens|max_completion_tokens|output limit was reached|could not finish the message/i;

async function probeOnce(ep, model, withImage, czasMs = PROBE_TIMEOUT_MS) {
  const content = withImage
    ? [{ type: 'image_url', image_url: { url: umiejetnosci_.PNG_SONDY_WZROKU } },
      { type: 'text', text: umiejetnosci_.PYTANIE_SONDY_WZROKU }]
    : 'hi';
  try {
    const start = Date.now();
    const r = await fetch(`${ep.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(ep),
      body: JSON.stringify(cialoSondy(ep, model, content, { wzrok: withImage })),
      signal: AbortSignal.timeout(czasMs),
    });
    if (r.ok) {
      const czas = Date.now() - start;
      if (!withImage) { r.body?.cancel().catch(() => {}); return { ok: true, czas }; }
      // Treść liczy się tylko przy wzroku: czy model nazwał kolor.
      let tekst = '';
      try { tekst = String((await r.json())?.choices?.[0]?.message?.content || ''); } catch { /* bez treści */ }
      return { ok: true, czas, tekst: tekst.slice(0, 200) };
    }
    let detail = '';
    try { detail = await r.text(); } catch { /* bez treści */ }
    if (r.status === 400 && ODMOWA_LIMITU_SONDY.test(detail) && !withImage) return { ok: true };
    let msg = `HTTP ${r.status}`;
    try {
      const j = JSON.parse(detail);
      msg = j?.error?.message || j?.message || j?.detail || j?.title || msg;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch { if (detail) msg = toStronaHtml(detail) ? `HTTP ${r.status}` : detail.slice(0, 200); }
    const poSekundach = Math.min(10, Math.max(1, Number(r.headers.get('retry-after')) || 3));
    return { ok: false, status: r.status, error: scrubSecrets(msg), ...(r.status === 429 ? { limit: true, poSekundach } : {}) };
  } catch (e) {
    // Rozróżniamy „nie masz dostępu" od „nie zdążył odpowiedzieć" – to drugie
    // przy modelach ładowanych na żądanie znaczy zwykle tylko tyle, że model
    // wstawał z zimnego startu.
    const timeout = e.name === 'TimeoutError' || /timeout|aborted/i.test(e.message);
    /* Brak połączenia to NIE „niedostępny na Twoim koncie”. Przy uśpionym domu
       „Sprawdź” twierdziło to drugie (agencja, runda 5). Komunikat przeglądarki
       („The operation was aborted due to timeout") zamieniamy na zdanie. */
    const kodSieci = e.cause?.code || e.code || '';
    return { ok: false, status: 0, timeout, siec: !timeout, kodSieci,
      error: timeout ? `Brak odpowiedzi w ${Math.round(czasMs / 1000)} s.` : scrubSecrets(opisBleduSieci(e, ep.label)) };
  }
}

/** Sonda z jedną ponowną próbą po przekroczeniu czasu albo po limicie zapytań.
 *  Pierwsze żądanie do modelu, którego dostawca nie trzyma rozgrzanego,
 *  potrafi trwać dłużej niż każde następne – jedna odmowa to za mało, żeby
 *  napisać komuś „ten model nie działa". Limit zapytań (429) to też nie
 *  „niedostępny": darmowe konto NVIDII przy „Sprawdź wszystkie" dostawało
 *  429 co kilka modeli i działające modele lądowały w „Niedostępne". */
async function probeModel(ep, model, withImage, doKiedy = Date.now() + BUDZET_SPRAWDZENIA_MS) {
  const zostalo = () => doKiedy - Date.now();
  if (zostalo() < 3000) return { ok: false, status: 0, timeout: true, error: 'Zabrakło czasu na to sprawdzenie.' };
  const first = await probeOnce(ep, model, withImage, Math.min(PROBE_TIMEOUT_MS, zostalo()));
  if (first.limit && zostalo() > first.poSekundach * 1000 + 5000) {
    await new Promise((r) => setTimeout(r, first.poSekundach * 1000));
    return probeOnce(ep, model, withImage, Math.min(PROBE_TIMEOUT_MS, zostalo()));
  }
  if (first.ok || !first.timeout || zostalo() < 5000) return first;
  const second = await probeOnce(ep, model, withImage, Math.min(PROBE_TIMEOUT_MS, zostalo()));
  return second.timeout ? { ...second, timeout: true } : second;
}

/** Co powiedzieć człowiekowi, gdy sprawdzenie się nie udało. Trzy różne
 *  sytuacje dawały dotąd to samo „niedostępny na Twoim koncie". */
function podpowiedzSprawdzenia(ep, nazwa, model, wynik) {
  const local = ep === ENDPOINTS.local;
  if (wynik.siec) {
    if (!local) return 'To nie sprawa konta ani modelu: serwer Cosmosa nie połączył się z dostawcą. Spróbuj za chwilę.';
    if (!czyWlasciciel()) return 'Komputer właściciela z lokalnym modelem teraz nie odpowiada.';
    return wynik.kodSieci === 'ECONNREFUSED'
      ? 'Komputer domowy odpowiada, ale Ollama nie przyjmuje połączeń – uruchom ją albo ustaw OLLAMA_HOST=0.0.0.0 (Ustawienia → „Pobierz listę" podpowie więcej).'
      : 'To nie sprawa konta ani modelu: komputer domowy nie odpowiada (wyłączony, uśpiony, poza Tailscale albo blokuje go Zapora Windows).';
  }
  if (wynik.timeout) {
    return local
      ? 'Połączenie jest, ale model się nie odezwał: Ollama ładuje go z dysku do pamięci karty (zimny start – spróbuj za minutę) albo się zawiesiła. Na stałe pomaga OLLAMA_KEEP_ALIVE=24h.'
      : 'Dostawca przyjął pytanie, ale nie odpowiedział na czas – bywa tak przy modelach ładowanych na żądanie. Spróbuj za kilka minut.';
  }
  if (wynik.limit) return 'Dostawca ograniczył liczbę zapytań (limit na minutę). To nie znaczy, że model nie działa – sprawdź go ponownie za minutę.';
  return modelErrorHint(nazwa, model, wynik.status, { tresc: wynik.error, baseUrl: ep.baseUrl }).trim();
}

async function handleModelCheck(req, res) {
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
  const ep = pickEndpoint(data.endpoint);
  const model = String(data.model || '').trim();
  if (!model) return sendJson(res, 400, { error: 'Brak identyfikatora modelu.' });

  /* Rozgrzanie modelu z zakładki po „Sprawdź wszystkie” na silniku lokalnym.
     Każda sonda ładuje model do pamięci karty, więc po sprawdzeniu listy
     zostawał w niej ostatni sprawdzony – a następna wiadomość czekała na
     przeładowanie (zmierzone 15,8 s zamiast 10,1 s, it-modele-open runda 9).
     W tle, bez czekania: puste /api/generate Ollamy tylko ładuje model
     (vLLM i llama.cpp trzymają jeden model i odpowiedzą 404 – bez szkody). */
  if (data.rozgrzej === true) {
    if (data.endpoint !== 'local') return sendJson(res, 400, { error: 'Rozgrzewa się tylko model lokalny.' });
    const baza = String(ep.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/, '');
    fetch(`${baza}/api/generate`, {
      method: 'POST', headers: authHeaders(ep), body: JSON.stringify({ model }), signal: AbortSignal.timeout(600_000),
    }).then((r) => r.body?.cancel().catch(() => {})).catch(() => {});
    return sendJson(res, 202, { rozgrzewany: true, model });
  }

  // Dwie grupy, jeden wniosek: nie stawiaj ich jako modelu czatu.
  //  • Embeddingi, przeszukiwanie, OCR nie mają końcówki rozmowy i zwrócą
  //    „404 page not found" – to nie brak dostępu, tylko inne przeznaczenie,
  //    a część z nich Cosmos sam wykorzystuje (baza wiedzy).
  //  • Klasyfikatory bezpieczeństwa i tłumacze końcówkę mają i odpowiedzą
  //    poprawnie – dlatego wychodziły z testu jako sprawne modele czatu.
  //    Odpowiedzą „safe" na każde pytanie, więc sprawność jest tu pozorna.
  if (modelNotAChatPartner(model)) {
    return sendJson(res, 200, {
      model,
      silnik: ep.label,
      rozmowa: false,
      obrazy: false,
      inneZadanie: true,
      blad: null,
      podpowiedz: modelNotForChat(model)
        ? 'Ten model nie służy do rozmowy (embeddingi / przeszukiwanie / OCR). '
          + 'Nie wybieraj go jako modelu czatu.'
        : 'Ten model odpowie, ale rozmówcą nie jest – to klasyfikator, tłumacz '
          + 'albo model badawczy. Do czatu wybierz model rozmowy z listy.',
      bladObrazy: null,
    });
  }

  const doKiedy = Date.now() + BUDZET_SPRAWDZENIA_MS;
  const text = await probeModel(ep, model, false, doKiedy);
  // Wzrok sprawdzamy tylko wtedy, gdy sama rozmowa działa – inaczej
  // zdublowalibyśmy ten sam błąd dostępu i niepotrzebnie obciążyli limit.
  const vision = text.ok ? await probeModel(ep, model, true, doKiedy) : { ok: false, skipped: true };
  const obrazyPewnosc = text.ok ? umiejetnosci_.ocenSondeWzroku(vision, model, data.endpoint) : 'nie';
  const obrazy = obrazyPewnosc !== 'nie';

  /* Zapis wyniku – tylko to, co jest WIEDZĄ o modelu: działa albo dostawca
     odmówił. Zimny start, limit zapytań i brak sieci nic o modelu nie mówią,
     więc nie nadpisują poprzedniego wyniku. Bez adresu, klucza i treści błędu. */
  if (text.ok || (!text.timeout && !text.limit && !text.siec)) {
    const blad = rejestrModeli.zapiszSprawdzenie({
      silnik: String(data.endpoint || 'cloud'), model, rozmowa: text.ok, obrazy: obrazyPewnosc, czas: text.czas,
    });
    if (blad) console.error('Nie udało się zapisać wyniku sprawdzenia modelu:', blad.message);
  }

  return sendJson(res, 200, {
    model,
    silnik: ep.label,
    rozmowa: text.ok,
    obrazy,
    obrazyPewnosc,
    czas: text.ok ? text.czas : null,
    // „Nie zdążył odpowiedzieć" i „limit zapytań" to nie to samo, co „nie masz dostępu”.
    niepewne: Boolean(text.timeout || text.limit),
    siec: Boolean(text.siec),
    rodzaj: text.ok ? null : text.siec ? 'siec' : text.timeout ? 'czas' : text.limit ? 'limit' : 'odmowa',
    blad: text.ok ? null : text.error,
    // Sam komunikat dostawcy nie mówi, co ma teraz zrobić człowiek przed ekranem.
    podpowiedz: text.ok ? null : podpowiedzSprawdzenia(ep, data.endpoint, model, text),
    bladObrazy: (text.ok && !vision.ok) ? vision.error
      : (text.ok && obrazyPewnosc === 'nie') ? 'Obraz przyjęty, ale model nie rozpoznał koloru próbki – obrazu nie widzi.' : null,
  });
}

/* Zapisane wyniki „Sprawdź” dla listy modeli: znaczki w wybieraku nie znikają
   po odświeżeniu. Tylko pola wiedzy o modelu – bez błędów dostawcy. */
function sprawdzoneDlaListy(nazwa, ids) {
  const zbior = new Set(ids);
  const wynik = {};
  for (const w of rejestrModeli.sprawdzenia(nazwa)) {
    if (zbior.has(w.model)) wynik[w.model] = { rozmowa: w.rozmowa, obrazy: w.obrazy, czas: w.czas, kiedy: w.kiedy };
  }
  return wynik;
}

// ---------------------------------------------------------------------------
// API: lista modeli
// ---------------------------------------------------------------------------

async function handleModels(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ep = pickEndpoint(url.searchParams.get('endpoint'));
  try {
    // Anthropic oddaje domyślnie 20 modeli na stronę – przy kolejnych premierach lista by się ucinała.
    const upstream = await fetch(`${ep.baseUrl}/models${ep.anthropic ? '?limit=1000' : ''}`, {
      headers: authHeaders(ep, { natywne: true }),   // /models u Claude'a to natywne API
      signal: AbortSignal.timeout(15000),
    });
    const tekst = await upstream.text();
    let data = null;
    try { data = JSON.parse(tekst); } catch { /* HTML albo pusto */ }
    if (upstream.ok && data) {
      /* Członek na silniku PRZYZNANYM może użyć tylko modeli z listy właściciela
         (lib/silniki.js → granice). Cały katalog na liście kusił wyborem, który
         serwer i tak podmieniał – a podpis odpowiedzi kłamał (zespół IT, runda 5). */
      const g = silniki.granice(url.searchParams.get('endpoint') || 'cloud');
      if (g && g.modele.length && Array.isArray(data.data)) {
        data = { ...data, data: data.data.filter((m) => g.modele.includes(m.id)), przycieta: true };
        for (const id of g.modele) if (!data.data.some((m) => m.id === id)) data.data.push({ id });
      }
      /* Claude: natywne /v1/models podaje okno, limit wyjścia, wzrok i myślenie
         (Models API, pewne) – źródło pewniejsze niż katalog, więc zapisujemy je
         dla umiejetnosci(). Tylko z prawdziwego API Anthropic. */
      const nazwa = url.searchParams.get('endpoint') || 'cloud';
      if (ep.anthropic && Array.isArray(data.data)) {
        const blad = rejestrModeli.zapiszDostawce(nazwa, data.data);
        if (blad) console.error('Nie udało się zapisać możliwości modeli dostawcy:', blad.message);
      }
      if (Array.isArray(data.data)) {
        data = { ...data, sprawdzone: sprawdzoneDlaListy(nazwa, data.data.map((m) => m && m.id).filter(Boolean)) };
      }
      return sendJson(res, 200, data);
    }
    /* Dostawca odmówił. Surowe ciało (`{error:{message,type}}`) dawało na
       ekranie „[object Object]” (agencja, runda 5). Jedno zdanie po ludzku. */
    const powod = data && (data.error?.message || (typeof data.error === 'string' && data.error) || data.message);
    const klucz = upstream.status === 401 || upstream.status === 403;
    const czlonek = !czyWlasciciel();
    return sendJson(res, 502, {
      error: klucz
        ? (czlonek
          ? `${ep.label} odrzuca klucz API. Jeśli to Twój własny klucz – popraw go w Ustawieniach → Twoje konto; jeśli klucz właściciela – daj mu znać.`
          : `${ep.label} odrzuca klucz API (HTTP ${upstream.status}). Sprawdź klucz w .env serwera albo własny klucz w Ustawieniach → Twoje konto.`)
        : upstream.ok
          ? `Nie udało się odczytać listy modeli z: ${ep.label} – odpowiedź nie jest listą. Sprawdź adres silnika.`
          : toStronaHtml(tekst) || !powod
            ? `Nie udało się pobrać listy modeli z: ${ep.label} (HTTP ${upstream.status}). Spróbuj za chwilę.`
            : `${ep.label}: ${String(powod).slice(0, 200)} (HTTP ${upstream.status})`,
    });
  } catch (err) {
    const local = ep === ENDPOINTS.local;
    if (local && !czyWlasciciel()) {
      return sendJson(res, 502, { error: 'Komputer właściciela z lokalnym modelem teraz nie odpowiada.' });
    }
    if (!local) {
      return sendJson(res, 502, { error: opisBleduSieci(err, ep.label) });
    }
    /* Samo „fetch failed” nic nie mówi. Kod przyczyny rozróżnia dwie zupełnie
       różne sytuacje: komputer odpowiada, ale Ollama nie przyjmuje połączeń
       (odmowa), albo komputera w ogóle nie ma w sieci (cisza, brak trasy).
       Zgłoszenie Marcina ze zrzutem: trzy podpowiedzi naraz i żadnej pewnej. */
    /* TimeoutError (15 s) przychodzi dopiero PO połączeniu – uśpiony komputer
       odpada wcześniej, na limicie łączenia. Wtedy komputer jest, a milczy
       Ollama. Kod „23" z tego błędu to numer wyjątku przeglądarkowego, nie sieci. */
    const zawieszona = err.name === 'TimeoutError';
    const kod = zawieszona ? '' : (err.cause?.code || err.code || '');
    const odmowa = kod === 'ECONNREFUSED';
    if (zawieszona) {
      return sendJson(res, 502, {
        error: 'Komputer domowy przyjął połączenie, ale Ollama nie odpowiedziała w 15 s – ładuje duży model albo się zawiesiła.'
          + '\n\nCo zrobić: poczekaj minutę i spróbuj ponownie; jeśli dalej cisza, zamknij Ollamę z zasobnika i uruchom ją jeszcze raz.'
          + `\n\nAdres: ${ep.baseUrl}`,
      });
    }
    const pierwsze = odmowa
      ? 'Komputer domowy odpowiada, ale Ollama nie przyjmuje połączeń.'
      : 'Komputer domowy nie odpowiada: jest wyłączony, uśpiony, poza Tailscale albo blokuje go Zapora Windows.';
    const coZrobic = odmowa
      ? `\n\nCo zrobić na komputerze domowym:\n`
        + `• Uruchom Ollamę (ikona w zasobniku albo \`ollama serve\`).\n`
        + `• Jeśli działa: słucha tylko na 127.0.0.1. W cmd: setx OLLAMA_HOST 0.0.0.0, `
        + `potem zamknij Ollamę z zasobnika i uruchom ponownie.`
      : `\n\nCo zrobić:\n`
        + `• Włącz albo obudź komputer domowy i sprawdź, czy Tailscale jest połączony.\n`
        + `• Zapora Windows: zezwól Ollamie na połączenia przychodzące (port 11434) w sieci prywatnej.\n`
        + `• Uśpiony komputer nie odbiera połączeń; w opcjach zasilania Windows ustaw `
        + `„Uśpij: nigdy” na zasilaniu sieciowym, jeśli ma być dostępny zawsze.`;
    sendJson(res, 502, {
      error: `${pierwsze}${coZrobic}\n\nAdres: ${ep.baseUrl}${kod ? ` (${kod})` : ''}\n`
        + `Sprawdź z serwera: curl ${ep.baseUrl}/models`,
    });
  }
}

// ---------------------------------------------------------------------------
// Pliki statyczne
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Router + start
// ---------------------------------------------------------------------------

/* Studio potrzebuje bazy wiedzy i dziennika zdarzeń, ale nie odwrotnie.
   Podajemy mu je tutaj, po zdefiniowaniu obu stron: krzyżowe `require`
   dałoby cykliczną zależność i jedna ze stron widziałaby pusty obiekt. */
studio_.polacz({ kbPliki: () => KB_FILES(), addEvent, kbAddFile, kbItemMeta, kbPozycje: () => U().kbItems, zadania: zadania_,
  budzet: budzet_, cennik: cennik_, konta });
// Oś czasu migawek otoczenia (Digital Time Machine) – lib/os-czasu.js.
const osCzasu_ = require('./lib/os-czasu.js').utworz({
  U, readJson, sendJson, addEvent, bladZapisu, kbAddFile, kbPliki: () => KB_FILES(), saveKb, tsName,
});
urzadzenia_.polacz({ addEvent, recentEvents, rutyny, routineView });
trening_.polacz({ addEvent, rozmowy: () => U().convIndex, convPath, profil: () => U().profile });
nauka_.polacz({
  kbPliki: () => KB_FILES(), addEvent, cosine, embedTexts, kbAddFile, keywordScore, sameModel, tsName,
  kbUsun: (id) => { U().kbItems = U().kbItems.filter((it) => it.id !== id); saveKb(); },
});

/* Trasy archiwum materiału. Sam indeks jest PASYWNY – źródła (OneDrive, dysk
   przez zmysły) wpychają wpisy, a zapytania działają, gdy te źródła są
   offline. Dlatego „ile klipów 50 mm w tym roku" odpowie z telefonu w terenie
   przy wyłączonym komputerze domowym. Całość tras: lib/archiwum-trasy.js. */
const archiwumTrasy_ = require('./lib/archiwum-trasy.js').utworz({
  archiwum, onedrive, SENSES_URL, fetchZmyslow: agent.fetchZmyslow, sendJson, readJson, addEvent,
  sensesState, wspolrzedneMiejsca,
});
const handleArchiwum = (req, res, p) => archiwumTrasy_.handleArchiwum(req, res, p);

async function trasyApi(req, res, p) {
  if (p === '/api/agent' || p.startsWith('/api/agent/')) {
    const wynik = await agentTrasy.osoby(req, res, p);
    if (wynik !== null) return wynik;
  }
  /* Restart w toku: nasłuch zostaje otwarty – statyka, wznowienie odpowiedzi,
     zapis rozmowy działają – a nowej pracy nie zaczynamy: czytelne 503 z prośbą
     o ponowienie. Dawniej `server.close()` na samym początku zamykania dawało
     przez ~20 s dokańczania strony 502 Cloudflare wszystkim (zespół IT, runda 4). */
  /* Klatki Kinecta i dłonie też (każda metoda): przeglądarka dokładała nowe
     zlecenia szybciej, niż licznik rzeczy w toku spadał do zera, i każdy
     restart przy otwartej kamerze trwał pełne 20 s (zespół IT, runda 7). */
  if (zamykanie && ((req.method === 'POST' && (p === '/api/chat' || p === '/api/zespol/plan' || p.startsWith('/api/studio/')
    || /^\/api\/(stt|tts|detect|pose|ptak)$/.test(p))) || p === '/api/dlonie' || p.startsWith('/api/kinect/'))) {
    res.setHeader('Retry-After', '5');
    return sendJson(res, 503, { error: 'Cosmos właśnie się aktualizuje – wyślij za kilka sekund.', kod: 'aktualizacja' });
  }
  /* Kinect na WŁASNYM komputerze osoby (agent zmysłów) jest jej – ten sam
     przełącznik co reszta zmysłów. Kinect w domu właściciela zostaje jego. */
  const kinectSwoj = p.startsWith('/api/kinect/') && agent.zrodloZmyslow() === 'agent';
  if (!czyWlasciciel() && !kinectSwoj && TYLKO_WLASCICIEL.some((w) => w.test(p))) {
    return sendJson(res, 403, { error: 'Ta funkcja jest dostępna tylko dla właściciela Cosmosa.' });
  }
  if (p.startsWith('/api/studio') && !silniki.studioDozwolone()) {
    return sendJson(res, 403, { error: 'Studio nie jest dla Ciebie włączone – poproś właściciela o dostęp.' });
  }
  /* Rozpoznawanie treści całego archiwum idzie na karcie graficznej
     właściciela i potrafi ją zająć na godziny. To ten sam zasób co „lokalny
     GPU", więc to samo uprawnienie. */
  if (p === '/api/archive/vision' && !silniki.dostep('local').ok) {
    return sendJson(res, 403, { error: 'Rozpoznawanie treści używa komputera właściciela – poproś o dostęp do lokalnego GPU.' });
  }
  if (p === '/api/konto' || p.startsWith('/api/konto/')) return await handleKonto(req, res, p);
  if (p === '/api/konta' || p.startsWith('/api/konta/')) return await handleKonta(req, res, p);


  if (p === '/api/config' && req.method === 'GET') return handleConfig(res);
  if (p === '/api/status' && req.method === 'GET') return await handleStatus(req, res);
  if (p === '/api/models' && req.method === 'GET') return await handleModels(req, res);
  if (p === '/api/models/check' && req.method === 'POST') return await handleModelCheck(req, res);
  if (p === '/api/chat' && req.method === 'POST') return await czat_.handleChat(req, res, { wazny: sesjaWazna(req) });
  /* Powrót do trwającej odpowiedzi. `od` = numer pierwszego zdarzenia,
     którego przeglądarka jeszcze nie ma – dzięki temu wznowienie po
     zerwanym Wi-Fi nie powtarza połowy zdania ani jej nie gubi. */
  if (p === '/api/chat/bieg' && req.method === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    if (biegi_.podepnij(q.get('id') || '', q.get('od'), res, { wazny: sesjaWazna(req) })) return;
    return sendJson(res, 404, { error: 'Ta odpowiedź już się nie liczy – serwer jej nie pamięta.' });
  }
  // Co się teraz liczy. Przeglądarka pyta o to po odświeżeniu strony.
  if (p === '/api/chat/biegi' && req.method === 'GET') {
    return sendJson(res, 200, { biegi: biegi_.lista() });
  }
  /* „Mam tę odpowiedź i zapisałem ją u siebie." Dopiero to odwołuje zapis
     awaryjny – patrz komentarz przy `potwierdz` w lib/biegi.js. */
  if (p === '/api/chat/odebrane' && req.method === 'POST') {
    let dane = {};
    try { dane = await readJson(req); } catch { /* pusty korpus też akceptujemy */ }
    return sendJson(res, 200, { ok: biegi_.potwierdz(String(dane.bieg || '')) });
  }
  /* Przerwanie musi być ŚWIADOME. Odkąd zamknięcie karty nie przerywa
     generowania, przycisk Stop jest jedyną drogą – i musi docierać do
     serwera, bo to on trzyma połączenie z modelem. */
  if (p === '/api/chat/stop' && req.method === 'POST') {
    let dane = {};
    try { dane = await readJson(req); } catch { /* pusty korpus też akceptujemy */ }
    const id = String(dane.bieg || '');
    const b = biegi_.daj(id);
    if (b && b.przerwij) b.przerwij();
    // Bieg jeszcze się nie urodził – kontekst się składa albo dostawca nie odpowiedział nagłówkami.
    const czeka = !b && czat_.zatrzymajOczekujacy(`${kto().id}:${id}`);
    return sendJson(res, 200, { ok: Boolean(b || czeka) });
  }
  // Zespół agentów: tylko plan, katalog ról, ustawienia osoby, „Pomiń rolę”, „Scal teraz”.
  if (p.startsWith('/api/zespol/')) return await zespol_.obsluz(req, res, p);
  if (p === '/api/polish' && req.method === 'POST') return await handlePolish(req, res);
  if (p === '/api/events') return await handleEvents(req, res);
  // Kanał w drugą stronę: przeglądarka dowiaduje się o zdarzeniach zamiast
  // tylko je wysyłać. Dzięki temu „Hej, Kosmos" wykryte na komputerze
  // dociera do telefonu, a nie umiera w logu serwera.
  if (p === '/api/events/stream' && req.method === 'GET') return podlaczStrumien(req, res, { wazny: sesjaWazna(req) });
  if (p === '/api/memory') return await handleMemory(req, res);
  if (p === '/api/search' && req.method === 'GET') return await handleSearch(req, res);
  if (p === '/api/document' && req.method === 'POST') return await handleDokument(req, res);
  if (p === '/api/run' && req.method === 'POST') return await handleUruchom(req, res);
  if (p === '/api/plan' || p === '/api/plan/mission' || p.startsWith('/api/canon/') || p === '/api/gear') {
    return await plener_.handlePlener(req, res, p);
  }
  if (p.startsWith('/api/archive')) return await handleArchiwum(req, res, p);
  if (p.startsWith('/api/onedrive')) return await handleOneDrive(req, res, p);
  if (p === '/api/search/images' && req.method === 'GET') return await handleSearchImages(req, res);
  if (p === '/api/search/thumb' && req.method === 'GET') return await handleImageProxy(req, res);
  if (p === '/api/conversations' || p === '/api/conversations/meta' || p === '/api/conversations/search') return await rozmowy_.obsluz(req, res, p);
  if (p === '/api/profile') {
    if (req.method === 'GET') return sendJson(res, 200, { profile: U().profile });
    if (req.method === 'POST') {
      let dane;
      try { dane = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const blad = saveProfile(dane.profile);
      if (blad) return bladZapisu(res, blad);
      return sendJson(res, 200, { ok: true });
    }
  }
  if (p === '/api/location') {
    if (req.method === 'GET') return sendJson(res, 200, { location: U().location, wspolrzedne: U().wspolrzedne, teraz: terazTekst() });
    if (req.method === 'POST') {
      let d;
      try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      /* Nazwa wpisana ręcznie („Warszawa”, jak podpowiada pole) dostaje
         współrzędne z wyszukiwarki miejsc. Dawniej zapisywała się sama nazwa,
         a Plener liczy tylko ze współrzędnych i dalej prosił „Ustaw lokalizację”
         (agencja, runda 5). Nie wyszło: zostaje nazwa i uczciwa informacja. */
      let wsp = d.lat !== undefined ? { lat: Number(d.lat), lon: Number(d.lon) } : undefined;
      let wspolrzedneNieznane = false;
      let powod = '';
      const nazwa = String(d.location || '').trim().slice(0, 200);
      /* Porównujemy z nazwą, DLA KTÓREJ zapisano współrzędne, nie z nazwą
         w polu: po nieudanym szukaniu ta sama nazwa wpisana drugi raz musi być
         szukana znowu, a nie „już ją mamy". Stare zapisy (bez `nazwa`) – jak dawniej. */
      const obecne = U().wspolrzedne;
      const nazwaWspolrzednych = obecne ? (obecne.nazwa ?? U().location) : null;
      if (wsp === undefined && nazwa && nazwa !== nazwaWspolrzednych) {
        const z = await szukajMiejsca(nazwa).catch(() => ({ wynik: null, powod: 'usluga' }));
        if (z.wynik) wsp = { lat: z.wynik.lat, lon: z.wynik.lon };
        else { wspolrzedneNieznane = true; powod = z.powod; wsp = null; }
      }
      if (!nazwa) wsp = null;
      const blad = saveLocation(nazwa, wsp);
      if (blad) return bladZapisu(res, blad);
      return sendJson(res, 200, { ok: true, location: U().location, wspolrzedne: U().wspolrzedne, wspolrzedneNieznane, powod });
    }
  }
  if (p === '/api/location/resolve' && req.method === 'POST') return await handleGeokod(req, res);
  if (p === '/api/admin/stats' && req.method === 'GET') {
    let kbBytes = 0;
    try {
      for (const f of fs.readdirSync(KB_FILES())) {
        try { kbBytes += fs.statSync(path.join(KB_FILES(), f)).size; } catch { /* skip */ }
      }
    } catch { /* brak katalogu */ }
    return sendJson(res, 200, {
      conversations: U().convIndex.length,
      memories: pamiec_.ile(),
      kbItems: U().kbItems.length,
      kbBytes,
      profileChars: U().profile.length,
      events: ileZdarzen(),
      engines: Object.keys(ENDPOINTS),
      studio: { image: imageProviders().length > 0, speech: Boolean(STUDIO.eleven.key), video: Boolean(STUDIO.seedance.key) },
      auth: authEnabled(),
    });
  }
  if (p === '/api/backup' && req.method === 'GET') {
    const convs = rozmowy_.wszystkie();
    const bundle = { version: 1, exportedAt: Date.now(), conversations: convs, memories: pamiec_.lista(), profile: U().profile };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="cosmos-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    });
    return res.end(JSON.stringify(bundle));
  }
  if (p === '/api/train/dataset' && req.method === 'GET') {
    const fmt = new URL(req.url, 'http://localhost').searchParams.get('format') || 'chat';
    const { lines, count } = buildTrainingDataset(fmt);
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'X-Example-Count': String(count),
      'Content-Disposition': `attachment; filename="cosmos-dataset-${fmt}-${new Date().toISOString().slice(0, 10)}.jsonl"`,
    });
    return res.end(lines);
  }
  if (p === '/api/train/stats' && req.method === 'GET') {
    return sendJson(res, 200, {
      chat: buildTrainingDataset('chat').count,
      instruction: buildTrainingDataset('instruction').count,
    });
  }
  if (p === '/api/train/env' || p === '/api/train/status' || p === '/api/train/start' || p === '/api/train/stop') {
    return await handleTrainRun(req, res, p);
  }
  if (p === '/api/backup' && req.method === 'POST') {
    let bundle;
    try { bundle = await readJson(req, 128 * 1024 * 1024); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    let restored = 0;
    let blad = null;
    if (Array.isArray(bundle.conversations)) {
      // Kopia to też miejsce na dysku osoby – sprawdzane dla całości w przywroc().
      ({ przywrocono: restored, blad } = await rozmowy_.przywroc(bundle.conversations));
    }
    if (Array.isArray(bundle.memories)) blad = pamiec_.ustawListe(bundle.memories) || blad;
    if (typeof bundle.profile === 'string') blad = saveProfile(bundle.profile) || blad;
    if (blad) {
      // Część weszła, część nie – człowiek ma wiedzieć, że kopia NIE jest cała.
      const { kod } = miejsce_.bladDlaCzlowieka(blad);
      return sendJson(res, kod === 507 ? 507 : 500, {
        error: `Przywrócono ${restored} rozmów, ale nie wszystko się zapisało: ${miejsce_.zBleduDysku(blad).message}`, restored,
      });
    }
    return sendJson(res, 200, { ok: true, restored });
  }
  if (p === '/api/summarize' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const text = String(data.text || '').slice(0, 40000);
    if (!text.trim()) return sendJson(res, 400, { error: 'Brak treści do streszczenia.' });
    try {
      const summary = await llmComplete([
        { role: 'system', content: 'Streść poniższą rozmowę zwięźle w punktach, w języku rozmowy. Zwróć samo streszczenie.' },
        { role: 'user', content: text },
      ], { endpoint: data.endpoint || 'cloud', model: data.model, maxTokens: 600 });
      return sendJson(res, 200, { ok: true, summary });
    } catch (err) {
      return sendJson(res, 502, { error: `Streszczenie nie powiodło się: ${err.message}` });
    }
  }
  if (p === '/api/timeline') return await osCzasu_.handleTimeline(req, res);
  if (p === '/api/lessons' || p === '/api/lessons/match') return await handleLessons(req, res, p);
  if (p === '/api/procedures') return await handleProcedures(req, res, p);
  if (p === '/api/procedures/run-readonly' || p === '/api/automation/status') return await handleAutomation(req, res, p);
  if (p.startsWith('/api/procedures/record/')) return await handleRecord(req, res, p);
  if (p === '/api/devices' || p === '/api/devices/run') return await handleDevices(req, res, p);
  if (p === '/api/gesty') return await handleGesty(req, res);
  if (p === '/api/briefing' && req.method === 'GET') return await handleBriefing(req, res);
  if (p === '/api/capabilities' && req.method === 'GET') {
    const m = await capabilityManifest();
    return sendJson(res, 200, { manifest: m, opis: capabilityText(m) });
  }
  if (p === '/api/suggest' && req.method === 'POST') return await handleSuggest(req, res);
  if (p === '/api/improvements') return await handleImprovements(req, res, p);
  if (p === '/api/routines' || p === '/api/routines/due') return await handleRoutines(req, res, p);
  if (p.startsWith('/api/kb')) return await kb_.obsluz(req, res, p);
  if (p.startsWith('/api/studio')) return await handleStudio(req, res, p);
  if (p === '/api/zadania' && req.method === 'GET') return zadania_.obsluzStan(req, res);
  if (p === '/api/stt' && req.method === 'POST') return await glos.handleStt(req, res);
  if (p === '/api/tts' && req.method === 'POST') return await glos.handleTts(req, res);
  // Zmysły przez pośrednika: ptak (BirdNET), wykrywanie, poza, Kinect – lib/zmysly-proxy.js.
  if (p === '/api/ptak' || p === '/api/detect' || p === '/api/pose' || p === '/api/dlonie' || p.startsWith('/api/kinect/')) {
    return await zmysly_.handleZmysly(req, res, p);
  }
  return sendJson(res, 404, { error: 'Nie ma takiej trasy.' });
}

/* HSTS tylko za HTTPS – to samo ustawienie, które każe ciastku jechać wyłącznie
   szyfrowanym połączeniem. Bez niego pierwsze wejście wpisane z ręki idzie
   zwykłym HTTP i da się je przechwycić, zanim Cloudflare przekieruje. */
const HSTS = process.env.COSMOS_COOKIE_SECURE === '1';

const server = http.createServer(async (req, res) => {
  if (HSTS) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  try {
    const p = new URL(req.url, 'http://localhost').pathname;
    if (!p.startsWith('/api/')) {
      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
      res.writeHead(405);
      return res.end();
    }

    // --- publiczne: logowanie i zaproszenia ---
    /* Też z kontrolą pochodzenia. Cudza strona mogła wysłać formularz
       logowania z SWOIMI danymi – Twoja przeglądarka zostawała zalogowana
       na obce konto i Twoje rozmowy trafiały do niego („login CSRF"). */
    if ((p === '/api/login' || p === '/api/logout' || p === '/api/zaproszenie') && obcePochodzenie(req)) {
      return sendJson(res, 403, { error: 'Żądanie z innej strony – odrzucone.' });
    }
    if (p === '/api/auth' && req.method === 'GET') {
      const u = ktoPyta(req);
      return sendJson(res, 200, { required: authEnabled(), authed: Boolean(u), uzytkownik: u });
    }
    if (p === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if (p === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
    if (p === '/api/zaproszenie') return await handleZaproszenie(req, res);

    // Agent zmysłów na komputerze osoby – własny token, przed bramką (lib/agent-zmyslow.js).
    if (p.startsWith('/api/agent/') && await agentTrasy.publiczne(req, res, p)) return;
    /* Obserwator kamery na komputerze osoby wysyła zdarzenia tokenem jej agenta
       – trafiają na JEJ konto, nie właściciela. Tylko ta jedna trasa. */
    const uidAgenta = agent.osobaAgentaZdarzen(req, p);
    const u = ktoPyta(req) || (uidAgenta ? konta.znajdz(uidAgenta) : null);
    if (!u) return sendJson(res, 401, { error: 'Sesja wygasła albo nie jesteś zalogowany. Zaloguj się ponownie.', kod: 'niezalogowany' });
    if (obcePochodzenie(req)) return sendJson(res, 403, { error: 'Żądanie z innej strony – odrzucone.' });

    /* Od tego miejsca wszystko dzieje się W IMIENIU tej osoby: dane, zdarzenia,
       praca w tle. Kontekst podąża za każdym `await` (lib/kontekst.js). */
    return await wKontekscie(u, () => trasyApi(req, res, p));
  } catch (err) {
    // Pełny dysk i limit osoby → 507 z wyjaśnieniem; reszta → 500 (lib/miejsce.js).
    if (!res.headersSent) { const { kod, error } = miejsce_.bladDlaCzlowieka(err); sendJson(res, kod, { error }); }
    else res.end();
  }
});
/* cloudflared trzyma połączenia do Cosmosa do ~90 s, a Node domyślnie zamyka
   bezczynne po 5 s – żądanie wysłane w tej samej chwili dostaje zerwane
   połączenie, a pula agenta zmysłów martwe gniazda (zespół IT, runda 7). */
server.keepAliveTimeout = 95_000;
server.headersTimeout = 96_000;

function start(port = PORT) {
  /* Nowe pliki tylko dla procesu Cosmosa (0600/0700): rozmowy, pamięć, kopie.
     Z domyślną maską 022 każde konto na maszynie czytało cudze rozmowy.
     W systemd to samo robi `UMask=0077` (docs/START-TUTAJ.md). */
  try { process.umask(0o077); } catch { /* Windows, wątek roboczy */ }
  return new Promise((resolve) => {
    const migracja = migrujDoKont();
    konta.przeladuj();
    konta.zapewnijWlasciciela({
      haslo: process.env.COSMOS_PASSWORD || '',
      login: process.env.COSMOS_LOGIN || '',
      nazwa: process.env.COSMOS_NAZWA || process.env.COSMOS_LOGIN || '',
    }).then((wlasciciel) => server.listen(...(HOST ? [port, HOST] : [port]), () => {
      console.log('');
      console.log('  ✦ Cosmos');
      console.log(`  → UI:      http://localhost:${port}${HOST ? `  (nasłuch tylko na ${HOST})` : ''}`);
      console.log(`  → Chmura:  ${ENDPOINTS.cloud.baseUrl}  (model: ${ENDPOINTS.cloud.model})`);
      console.log(`             klucz API: ${ENDPOINTS.cloud.apiKey ? 'ustawiony' : 'BRAK – ustaw NVIDIA_API_KEY w .env'}`);
      console.log(`  → Lokalny: ${ENDPOINTS.local.baseUrl}  (model: ${ENDPOINTS.local.model || 'nie ustawiono'})`);
      console.log(`  → Zmysły:  ${SENSES_URL}  (uruchom: python senses/service.py)`);
      /* Liczby właściciela liczymy w JEGO imieniu – poza kontekstem nie ma
         czyich danych liczyć, i dobrze. */
      wKontekscie(wlasciciel, () => {
        console.log(`  → Pamięć:  ${pamiec_.ile()} wpisów`);
        console.log(`  → Baza wiedzy: ${U().kbItems.length} pozycji`);
        console.log(`  → Rozmowy: ${U().convIndex.length}`);
        if (procedury().length || rutyny().length) {
          console.log(`  → Nauka:   ${wzorce().length} wzorców, ${procedury().length} procedur, ${rutyny().length} rutyn`);
        }
      });
      if (migracja) {
        console.log(`  → Migracja do kont: przeniesiono ${migracja.przeniesione.length} pozycji do data/uzytkownicy/${WLASCICIEL_ID}/`);
        console.log(`               kopia zapasowa: ${migracja.kopia}`);
        if (migracja.pominiete.length) console.log(`               pominięto (już były u celu): ${migracja.pominiete.join(', ')}`);
      }
      const ileKont = konta.wszyscy().length;
      console.log(`  → Logowanie: ${authEnabled() ? `WŁĄCZONE – kont: ${ileKont}, login właściciela: ${wlasciciel.login}` : 'wyłączone (tryb domowy/localhost)'}`);
      if (!authEnabled()) {
        console.log('               ⚠  Nie wystawiaj tego serwera do internetu bez COSMOS_PASSWORD!');
      }
      const extraTabs = ['openai', 'claude'].filter((k) => ENDPOINTS[k]);
      if (extraTabs.length) console.log(`  → Silniki dodatkowe: ${extraTabs.join(', ')}`);
      const studioOn = [STUDIO.openai.key && 'obraz(OpenAI)', fireflyEnabled() && 'obraz(Firefly)',
        STUDIO.eleven.key && 'dźwięk(ElevenLabs)', STUDIO.seedance.key && 'wideo(Seedance)'].filter(Boolean);
      console.log(`  → Studio:  ${studioOn.length ? studioOn.join(', ') : 'brak kluczy (opcjonalne)'}` +
        (STUDIO.exportDir ? `  eksport → ${STUDIO.exportDir}` : ''));
      if (secretsEnabled()) {
        console.log(`  → Sekrety: menedżer haseł „${SECRETS.provider}" (automatyzacja z logowaniem)`);
      }
      console.log('');
      startScheduler();
      wznowIndeksowaniaOneDrive();
      resolve(server);
    }));
  });
}

/* Zapis indeksu PRZED zamknięciem. Zapis archiwum jest odkładany w czasie,
   a odstęp dobiera się do jego kosztu – przy 28 MB to kilkanaście sekund.
   Bez tego `systemctl restart` w środku indeksowania albo rozpoznawania
   treści wyrzucałby do kosza całą pracę od ostatniego zapisu. Timer zapisu
   jest `unref`-owany, więc sam z siebie przy wyjściu nie zdąży. */
/* Restart w trakcie odpowiedzi kasował ją w całości: proces kończył się
   w 10 ms, bieg znikał, a rozmowa zostawała z samym pytaniem. Teraz serwer
   przestaje przyjmować nowe połączenia, daje trwającym odpowiedziom do 20 s
   na dokończenie (systemd czeka 30 s – TimeoutStopSec), a resztę zapisuje
   w rozmowach tak, jak ją zastał. Drugi sygnał (Ctrl+C dwa razy) – od razu. */
const CZAS_NA_DOKONCZENIE_MS = Number(process.env.COSMOS_CZAS_NA_DOKONCZENIE_MS) || 20_000;
let zamykanie = false;

function zamknijPorzadnie(sygnal) {
  process.on(sygnal, () => {
    if (zamykanie) process.exit(0);
    zamykanie = true;
    // Liczniki wiadomości i „ostatnio widziany" zapisują się z opóźnieniem (lib/konta.js).
    konta.zapiszZalegle();
    const koniec = Date.now() + CZAS_NA_DOKONCZENIE_MS;
    /* Czekamy na odpowiedzi w toku, na czaty wysłane do dostawcy, który jeszcze
       nie odpowiedział (OCZEKUJACE – dawniej ginęły bez śladu, zostawało samo
       pytanie), i na zadania Studia. Nasłuch zamykamy dopiero potem. */
    // Zlecenia zmysłów u agentów osób też: wynik wraca po chwili, a restart by go zgubił.
    const wToku = () => biegi_.aktywne() + OCZEKUJACE.size + zadania_.ileWszystkich() + agent.ileZlecen();
    const dokonczone = async () => {
      if (wToku()) console.log(`  Zamykanie: czekam na ${wToku()} rzeczy w toku (do ${CZAS_NA_DOKONCZENIE_MS / 1000} s)…`);
      while (wToku() && Date.now() < koniec) await new Promise((r) => setTimeout(r, 250));
      // Kto dalej czeka na nagłówki dostawcy, dostaje 503 „aktualizacja" zamiast zerwanego połączenia.
      for (const abort of OCZEKUJACE.values()) abort.abort(Object.assign(new Error('restart'), { kod: 'aktualizacja' }));
      biegi_.zapiszWszystkoTeraz('Serwer uruchamiał się ponownie i przerwał odpowiedź w tym miejscu. Zapytaj jeszcze raz, żeby dostać całość.');
      server.close();
      await new Promise((r) => setTimeout(r, 100));   // niech 503 zdążą wyjść
    };
    dokonczone().then(() => {
      /* Każda osoba ma własne archiwum i własną bazę wiedzy – zapisujemy to,
         co CZEKA na zapis, w imieniu właścicieli. Instancji, której nikt nie
         wczytał, nie tworzymy (istniejacy): dawniej zamknięcie czytało cały
         indeks archiwum z dysku tylko po to, żeby go od razu zapisać. */
      const zapisy = zaladowani().map((id) => {
        const u = konta.znajdz(id);
        if (!u) return Promise.resolve();
        return Promise.resolve(wKontekscie(u, () => {
          const s = istniejacy('serwer');
          if (s && s.kbZapisZaplanowany) { clearTimeout(s.kbZapisZaplanowany); s.kbZapisZaplanowany = null; saveKb(); }
          const a = istniejacy('archiwum');
          return a ? a.zapiszZalegle() : undefined;
        })).catch((err) => console.error(`Nie udało się dopisać danych (${u.login}):`, err.message));
      });
      return Promise.all(zapisy);
    }).finally(() => process.exit(0));
  });
}

if (require.main === module) {
  zamknijPorzadnie('SIGTERM');
  zamknijPorzadnie('SIGINT');
  start();
}

module.exports = { start, server, PORT };

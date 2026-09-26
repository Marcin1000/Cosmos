#!/usr/bin/env node
/**
 * Cosmos — serwer aplikacji AI („dyrygent orkiestry”)
 *
 * Łączy w jeden organizm:
 *   • cloud  — chmura NVIDIA (build.nvidia.com) — rozumowanie / wizja,
 *   • local  — model na Twoim GPU (Ollama / vLLM / NIM),
 *   • senses — usługa percepcji (Python): słuch (Whisper), głos (Piper),
 *              widzenie (YOLO/MediaPipe) i zdarzenia z czujników.
 *
 * Zdarzenia percepcji trafiają do kontekstu rozmowy, więc model
 * „wie”, co dzieje się wokół — jak jeden byt, nie zbiór narzędzi.
 *
 * Zero zależności — wystarczy Node.js >= 18.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Katalog modeli współdzielony z przeglądarką — jedno miejsce wiedzy o tym,
// który model widzi obrazy. Plik eksportuje się i dla okna, i dla Node.
const { modelNotForChat, modelNotAChatPartner, modelToolLevel } = require('./public/models.js');

/* Rdzeń: konfiguracja, silniki, ścieżki i cztery pomocnicze, bez których nie
   da się obsłużyć żądania. Zależność idzie tylko w jedną stronę — rdzeń nie
   wie nic o rozmowach, zmysłach ani o Studiu. */
const {
  PORT, HOST, PUBLIC_DIR, DATA_DIR, ENDPOINTS, STUDIO, SENSES_URL, SECRETS,
  sendJson, readBodyBuffer, readJson, pickEndpoint,
  modelErrorHint, authHeaders, saveJsonFile, zapiszAtomowo, genId, fireflyEnabled, imageProviders, ustawStraznikaSilnikow,
} = require('./lib/rdzen.js');
/* Wiele osób: kontekst żądania, konta, uprawnienia do silników, stan osoby
   i trasy kont. Zasady — w nagłówkach tych modułów; bramka logowania zostaje
   niżej, w routerze (audyt sprawdza ją strukturalnie). */
const { stan, naUzytkownika, istniejacy, wKontekscie, kto, czyWlasciciel, katalogDla,
  zaladowani, zapomnij, WLASCICIEL_ID } = require('./lib/kontekst.js');
const konta = require('./lib/konta.js');
const silniki = require('./lib/silniki.js');
ustawStraznikaSilnikow(silniki.wybierz);
const { stanOsoby } = require('./lib/stan-osoby.js');
const { authEnabled, ktoPyta, handleLogin, handleLogout, handleZaproszenie,
  obcePochodzenie, handleKonto, handleKonta, migrujDoKont, TYLKO_WLASCICIEL,
} = require('./lib/konta-trasy.js').utworz({
  konta, silniki, kto, katalogDla, zapomnij, WLASCICIEL_ID,
  DATA_DIR, ENDPOINTS, STUDIO, imageProviders, sendJson, readJson, readBodyBuffer,
});
/* Głos: rozpoznawanie i czytanie na głos z łańcuchem źródeł (zmysły → chmura).
   Tryb głosowy bez Web Speech API = bez piszczenia mikrofonu na Androidzie. */
const glos = require('./lib/glos.js').utworz({
  SENSES_URL, silniki, kto, sendJson, readBodyBuffer, readJson, STUDIO,
});
const { pobierzStrone } = require('./lib/pobieranie.js');
const szukanie_ = require('./lib/szukanie.js');
const { handleSearch, handleSearchImages, handleImageProxy, stripTags, czytelnyTekst } = szukanie_;
const { czytajLokalnie, OBSLUGIWANE: DOK_OBSLUGIWANE } = require('./lib/dokumenty.js');
const { uruchomKod, WLACZONE: KOD_WLACZONY } = require('./lib/kod.js');
const { wspolrzedneMiejsca } = require('./lib/miejsca.js');
const { zbudujInstrukcje, blokSprzetu } = require('./lib/instrukcje-narzedzi.js');
const canon = require('./lib/canon.js');
const archiwum_ = require('./lib/archiwum.js');
const pamiecModul_ = require('./lib/pamiec.js');
/* Archiwum i OneDrive KAŻDEJ OSOBY OSOBNO. Pośrednik kieruje każde
   `archiwum.coś(…)` do instancji bieżącej osoby, więc reszta pliku się nie
   zmienia — a mimo to nikt nie przeszuka cudzych zdjęć. Dom (do pory światła
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
const { addEvent, recentEvents, sceneContext, podlaczStrumien, ileZdarzen } = require('./lib/zdarzenia.js');
const { TRAIN_DIR, TRAIN_SCRIPT, buildTrainingDataset, commandExists, startTraining, trainJob, trainLog, trainStatusView } = trening_;
const urzadzenia_ = require('./lib/urzadzenia.js');
const { BRIEFING, handleBriefing, handleDevices, urzadzenia } = urzadzenia_;
const nauka_ = require('./lib/nauka.js');
const { handleAutomation, handleLessons, handleProcedures, handleRoutines,
  routineView, sanitizeStep, saveProcedures, secretsEnabled,
  startScheduler, wzorce, procedury, rutyny, dodajProcedure } = nauka_;
const studio_ = require('./lib/studio.js');
const { handleStudio, tsName } = studio_;
// Praca dłuższa niż 100 s Cloudflare'a (Studio) — zadanie w tle z numerem do dopytywania.
const zadania_ = require('./lib/zadania.js').utworzZadania();
// Limit miejsca na osobę i 507 zamiast „ok", gdy zapis się nie udał.
const miejsce_ = require('./lib/miejsce.js');
const bladZapisu = (res, err) => miejsce_.odpowiedzBledemZapisu(res, sendJson, err);
const { llmComplete, blindToImages, zapytajModel } = require('./lib/model.js');
// Pliki statyczne (strona, aplikacja, czcionki, ikony) i CSP aplikacji — lib/statyka.js.
const { serveStatic } = require('./lib/statyka.js').utworz({ PUBLIC_DIR });


// ---------------------------------------------------------------------------
// Pamięć długotrwała (RAG) — całość w lib/pamiec.js.
// Tutaj tylko spięcie zależności i cienkie przejścia dla reszty pliku.
// ---------------------------------------------------------------------------
const pamiec_ = naUzytkownika('pamiec', (katalog) => pamiecModul_.utworz({
  katalogDanych: katalog,
  sensesUrl: SENSES_URL,
  chmura: () => ENDPOINTS.cloud,
  sendJson,
  readJson,
}));
const handleMemory = (req, res) => pamiec_.handleMemory(req, res);
const searchMemory = (q, limit) => pamiec_.searchMemory(q, limit);
const memoryContextLines = (items) => pamiec_.memoryContextLines(items);
const embedTexts = (texts, timeoutMs, inputType) => pamiec_.embedTexts(texts, timeoutMs, inputType);
const embedStatus = (sensesHasEmbed) => pamiec_.embedStatus(sensesHasEmbed);
// Czyste funkcje podobieństwa — z modułu, nie z instancji: potrzebne też poza żądaniem.
const { cosine, sameModel, keywordScore } = pamiecModul_;

// ---------------------------------------------------------------------------
// Baza wiedzy — pliki, linki i notatki użytkownika.
// Tekst wyciągany lokalnie (pliki tekstowe) lub przez usługę zmysłów
// (PDF/Office → /extract, audio/wideo → /stt, obrazy → /detect).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Historia rozmów — jeden plik JSON na rozmowę + lekki indeks metadanych.
// Współdzielona między urządzeniami (PC, Android, Electron), bez limitu
// localStorage. Bez bazy danych — rozmowy to dokumenty, nie dane relacyjne.
// ---------------------------------------------------------------------------

/* Stan bieżącej osoby: indeks rozmów, profil, lokalizacja, sprzęt, baza
   wiedzy, oś czasu — lib/stan-osoby.js. */
const U = () => stanOsoby(BRIEFING);
// Plan zdjęciowy, misja drona, Canon, zestaw sprzętu — lib/plener-trasy.js.
const plener_ = require('./lib/plener-trasy.js').utworz({ U, readJson, sendJson, addEvent, bladZapisu });
// Pośrednik do usługi zmysłów (Python w domu właściciela) — lib/zmysly-proxy.js.
const zmysly_ = require('./lib/zmysly-proxy.js').utworz({ U });
const CONV_DIR = () => path.join(U().katalog, 'conversations');
const CONV_INDEX = () => path.join(CONV_DIR(), 'index.json');

/* Funkcje save* NIE rzucają (wołają je też timery, gdzie wyjątek wywróciłby
   proces), ale ZWRACAJĄ błąd — null znaczy „zapisane". Trasa, która po zapisie
   odpowiada „ok", sprawdza wynik: pełny dysk ma dać 507, a nie `{ ok: true }`
   dla czegoś, czego po restarcie nie będzie (lib/miejsce.js). */
const { zapiszLubBlad } = miejsce_;

function saveConvIndex() {
  return zapiszLubBlad('indeksu rozmów', () => zapiszAtomowo(CONV_INDEX(), JSON.stringify(U().convIndex)));
}

// Sanityzacja ID → tylko nasz alfabet uid; blokuje path traversal.
function convPath(id) {
  return path.join(CONV_DIR(), `${String(id).replace(/[^a-z0-9]/gi, '')}.json`);
}

function sortConvIndex() {
  // przypięte na górze, potem wg czasu modyfikacji
  U().convIndex.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
}

/** Dopisz wiadomość do rozmowy PO STRONIE SERWERA.
 *
 *  Normalnie rozmowy zapisuje przeglądarka, całym dokumentem. Ta furtka jest
 *  dla jednego przypadku: odpowiedź skończyła się, gdy nikogo już nie było
 *  przy ekranie. Bez niej „praca w tle" znaczyłaby tylko tyle, że serwer
 *  dokończył czytanie od modelu i wyrzucił wynik.
 *
 *  Zabezpieczenie przed dublem: wiadomość niesie `bieg` — identyfikator biegu,
 *  który ją wyprodukował. Gdy przeglądarka wróci i zapisze rozmowę po swojemu,
 *  jej wersja nadpisze plik w całości, więc dubla nie będzie. Gdyby jednak
 *  dopisywano dwa razy z tym samym `bieg`, drugi raz pomijamy.
 */
function dopiszWiadomoscDoRozmowy(id, wiadomosc) {
  const plik = convPath(id);
  let conv;
  try { conv = JSON.parse(fs.readFileSync(plik, 'utf8')); } catch { return false; }
  if (!Array.isArray(conv.messages)) return false;
  if (wiadomosc.bieg && conv.messages.some((m) => m.bieg === wiadomosc.bieg)) return false;
  /* Drugi pas bezpieczeństwa: przeglądarka mogła już zapisać tę samą
     odpowiedź pod swoją postacią (bez znacznika biegu). Dwie identyczne
     wypowiedzi pod rząd to dla użytkownika ewidentna usterka. */
  const ostatnia = conv.messages[conv.messages.length - 1];
  if (ostatnia && ostatnia.role === 'assistant' && typeof ostatnia.content === 'string'
      && typeof wiadomosc.content === 'string'
      && ostatnia.content.trim() === wiadomosc.content.trim()) return false;
  conv.messages.push(wiadomosc);
  conv.updatedAt = Date.now();
  zapiszAtomowo(plik, JSON.stringify(conv));
  const meta = U().convIndex.find((c) => c.id === id);
  if (meta) { meta.updatedAt = conv.updatedAt; sortConvIndex(); saveConvIndex(); }
  return true;
}

/* Biegi — trwające odpowiedzi modelu, które należą do serwera, a nie do karty
   przeglądarki. Zamknięcie karty ich nie przerywa; patrz lib/biegi.js. */
const biegi_ = require('./lib/biegi.js').utworz({
  zapiszOdpowiedz: dopiszWiadomoscDoRozmowy,
});

// Wyszukiwanie po TREŚCI rozmów (skan plików) — zwraca dopasowania z fragmentem.
function searchConversationsContent(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const meta of U().convIndex) {
    try {
      const conv = JSON.parse(fs.readFileSync(convPath(meta.id), 'utf8'));
      let snippet = '';
      for (const m of conv.messages || []) {
        const text = typeof m.content === 'string' ? m.content
          : (Array.isArray(m.content) ? (m.content.find((p) => p.type === 'text')?.text || '') : (m.content?.text || ''));
        const at = text.toLowerCase().indexOf(q);
        if (at >= 0) { snippet = text.slice(Math.max(0, at - 40), at + 80); break; }
      }
      const inTitle = (meta.title || '').toLowerCase().includes(q);
      if (snippet || inTitle) out.push({ id: meta.id, title: meta.title, snippet: snippet.trim() });
    } catch { /* pomiń uszkodzony plik */ }
  }
  return out.slice(0, 30);
}

// Profil użytkownika — trwały tekst wstrzykiwany do każdej rozmowy (pamięć profilowa).
const PROFILE_FILE = () => path.join(U().katalog, 'profile.txt');
function saveProfile(text) {
  const profil = String(text || '').slice(0, 4000);
  const blad = zapiszLubBlad('profilu', () => zapiszAtomowo(PROFILE_FILE(), profil));
  if (!blad) U().profile = profil;
  return blad;
}

/* Lokalizacja domowa — osobno od profilu, bo używa jej nie tylko rozmowa,
   ale i wyszukiwanie („warsztat … w Piasecznie"). Bez niej model pyta
   „w jakim mieście jesteś?" przy każdym pytaniu o cokolwiek w okolicy. */
const LOCATION_FILE = () => path.join(U().katalog, 'location.txt');
/* Sama nazwa miejsca wystarczała do wyszukiwania, ale nie do liczenia pozycji
   Słońca — złota godzina wymaga stopni, nie napisu „Piaseczno". Trzymamy
   jedno i drugie: nazwę dla modelu, współrzędne dla matematyki. */
const WSPOLRZEDNE_FILE = () => path.join(U().katalog, 'location.json');

function saveLocation(text, wspolrzedne) {
  const nazwa = String(text || '').trim().slice(0, 200);
  const blad = zapiszLubBlad('lokalizacji', () => zapiszAtomowo(LOCATION_FILE(), nazwa));
  if (blad) return blad;
  U().location = nazwa;
  if (wspolrzedne && Number.isFinite(wspolrzedne.lat) && Number.isFinite(wspolrzedne.lon)) {
    const wsp = { lat: wspolrzedne.lat, lon: wspolrzedne.lon };
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

/* Data i godzina. Model zna świat wyłącznie do końca swojego treningu —
   bez tej linijki na pytanie „który dziś?" zgaduje, i to nie „nie wiem",
   tylko konkretną złą datę. Strefa z ENV, bo serwer stoi w UTC. */
const STREFA_CZASU = process.env.COSMOS_TZ || 'Europe/Warsaw';
function terazTekst() {
  const t = new Date();
  const dzien = t.toLocaleDateString('pl-PL',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: STREFA_CZASU });
  const godzina = t.toLocaleTimeString('pl-PL',
    { hour: '2-digit', minute: '2-digit', timeZone: STREFA_CZASU });
  return `${dzien}, godzina ${godzina}`;
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
    if (!r.ok) return sendJson(res, 502, { error: `Usługa nazw miejsc odpowiedziała ${r.status}.` });
    const d = await r.json();
    const a = d.address || {};
    // Od najbardziej konkretnego: wieś → miasteczko → miasto → gmina.
    const miejsce = a.village || a.town || a.city || a.municipality || a.county || '';
    const region = a.state || '';
    const nazwa = [miejsce, region].filter(Boolean).join(', ') || d.display_name || '';
    if (!nazwa) return sendJson(res, 502, { error: 'Nie udało się ustalić nazwy miejsca.' });
    // Zapisujemy od razu: to jedyny moment, w którym mamy i nazwę,
    // i współrzędne. Bez nich złota godzina nie ma z czego się policzyć.
    const blad = saveLocation(nazwa, { lat, lon });
    if (blad) return bladZapisu(res, blad);
    addEvent('lokalizacja', `Ustalono lokalizację: ${nazwa}`);
    return sendJson(res, 200, { location: nazwa, lat, lon });
  } catch (err) {
    return sendJson(res, 502, {
      error: /timeout|abort/i.test(err.message)
        ? `Usługa nazw miejsc nie odpowiedziała w ${GEOKOD_MS / 1000} s.`
        : `Nie udało się ustalić miejsca: ${err.message}`,
    });
  }
}

async function handleConversations(req, res, pathname) {
  const rawId = new URL(req.url, 'http://localhost').searchParams.get('id');
  // ta sama sanityzacja co convPath — indeks i nazwa pliku zawsze zgodne
  const id = rawId ? String(rawId).replace(/[^a-z0-9]/gi, '') : rawId;

  // zmiana nazwy / przypięcie — bez nadpisywania treści rozmowy
  if (pathname === '/api/conversations/meta' && req.method === 'POST' && id) {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const entry = U().convIndex.find((c) => c.id === id);
    if (!entry) return sendJson(res, 404, { error: 'Nie znaleziono rozmowy.' });
    if (typeof data.title === 'string' && data.title.trim()) entry.title = data.title.trim().slice(0, 120);
    if (typeof data.pinned === 'boolean') entry.pinned = data.pinned;
    // zapisz też do pliku (trwałość tytułu/przypięcia)
    try {
      const conv = JSON.parse(fs.readFileSync(convPath(id), 'utf8'));
      conv.title = entry.title;
      conv.pinned = entry.pinned || false;
      zapiszAtomowo(convPath(id), JSON.stringify(conv));
    } catch { /* plik mógł zniknąć — indeks i tak zaktualizowany */ }
    sortConvIndex();
    const blad = saveConvIndex();
    if (blad) return bladZapisu(res, blad);
    return sendJson(res, 200, { ok: true, meta: entry });
  }

  if (pathname === '/api/conversations/search' && req.method === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
    return sendJson(res, 200, { results: searchConversationsContent(q) });
  }

  if (req.method === 'GET' && !id) {
    return sendJson(res, 200, { conversations: U().convIndex });
  }
  if (req.method === 'GET' && id) {
    try {
      return sendJson(res, 200, JSON.parse(fs.readFileSync(convPath(id), 'utf8')));
    } catch {
      return sendJson(res, 404, { error: 'Nie znaleziono rozmowy.' });
    }
  }
  if (req.method === 'PUT' && id) {
    let conv;
    try { conv = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    /* Zapis z nieaktualnej kopii (drugie urządzenie) nie nadpisuje nowszej
       wersji — 409 z nią, klient scala. Bez `bazaUpdatedAt` (stary klient,
       skrypty) — dawne zachowanie. */
    const baza = Number(conv.bazaUpdatedAt);
    delete conv.bazaUpdatedAt;
    if (Number.isFinite(baza) && baza > 0) {
      let naDysku = null;
      try { naDysku = JSON.parse(fs.readFileSync(convPath(id), 'utf8')); } catch { /* nowa rozmowa */ }
      if (naDysku && Number(naDysku.updatedAt) > baza) {
        return sendJson(res, 409, { error: 'Ta rozmowa zmieniła się w międzyczasie na innym urządzeniu.', rozmowa: naDysku });
      }
    }
    conv.id = id;
    conv.updatedAt = Date.now();
    if (!conv.createdAt) conv.createdAt = conv.updatedAt;
    /* Rozmowa ze zdjęciami potrafi urosnąć — liczy się do limitu osoby tak
       samo jak baza wiedzy. Liczymy przyrost, nie całość: poprawka literówki
       w rozmowie przy pełnym limicie ma przejść. */
    const tresc = JSON.stringify(conv);
    let bylo = 0;
    try { bylo = fs.statSync(convPath(id)).size; } catch { /* nowa rozmowa */ }
    const przyrost = Buffer.byteLength(tresc) - bylo;
    if (przyrost > 0) await miejsce_.sprawdz(przyrost);
    try {
      zapiszAtomowo(convPath(id), tresc);
    } catch (err) {
      if (miejsce_.toBrakMiejsca(err)) return bladZapisu(res, err);
      return sendJson(res, 500, { error: `Zapis rozmowy nie powiódł się: ${err.message}` });
    }
    miejsce_.dolicz(przyrost);
    const prev = U().convIndex.find((c) => c.id === id);
    const meta = {
      id,
      title: conv.title || 'Rozmowa',
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      pinned: (typeof conv.pinned === 'boolean' ? conv.pinned : prev?.pinned) || false,
    };
    const i = U().convIndex.findIndex((c) => c.id === id);
    if (i >= 0) U().convIndex[i] = meta; else U().convIndex.push(meta);
    sortConvIndex();
    const bladIndeksu = saveConvIndex();
    if (bladIndeksu) return bladZapisu(res, bladIndeksu);
    return sendJson(res, 200, { ok: true, meta });
  }
  if (req.method === 'DELETE' && id) {
    const usunieta = U().convIndex.find((c) => c.id === id);
    U().convIndex = U().convIndex.filter((c) => c.id !== id);
    const blad = saveConvIndex();
    if (blad) {
      // Indeks na dysku dalej ją ma — niech i w pamięci wróci, zamiast zniknąć do restartu.
      if (usunieta) { U().convIndex.push(usunieta); sortConvIndex(); }
      return bladZapisu(res, blad);
    }
    try { fs.unlinkSync(convPath(id)); } catch { /* już nie ma */ }
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405);
  res.end();
}

const KB_DIR = () => path.join(U().katalog, 'kb');
/* Największy plik do bazy wiedzy. 95 MB, bo Cloudflare odrzuca ciało powyżej
   100 MB własną stroną 413, zanim cokolwiek dojdzie do serwera. */
const KB_PLIK_MAX = (Number(process.env.COSMOS_KB_MAX_MB) || 95) * 1024 * 1024;
const KB_FILES = () => path.join(KB_DIR(), 'files');
const KB_INDEX = () => path.join(KB_DIR(), 'index.json');

function saveKb() {
  return zapiszLubBlad('bazy wiedzy', () => {
    fs.mkdirSync(KB_FILES(), { recursive: true });
    // `.bak`: indeksu bazy wiedzy nie da się odbudować z plików — opisy i wektory są tylko tu.
    zapiszAtomowo(KB_INDEX(), JSON.stringify(U().kbItems), { kopia: true });
  });
}

const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'js', 'ts', 'py',
  'html', 'htm', 'css', 'xml', 'yaml', 'yml', 'log', 'ini', 'sh', 'bat', 'sql']);
const OFFICE_EXTS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods']);
const AV_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov', 'mkv', 'avi']);

function extOf(name) {
  return (String(name).split('.').pop() || '').toLowerCase();
}

/* Zmysły to domowe GPU właściciela: członek bez przyznanego „lokalnego GPU"
   ich nie używa (lib/silniki.js → zmyslyDozwolone). Wyciąganie tekstu
   i transkrypcja zwracają wtedy pusty tekst — tak samo jak przy wyłączonych
   zmysłach, więc dalsza ścieżka jest ta sama. */

async function sensesExtract(name, buf, czasMs = 90000) {
  if (!silniki.zmyslyDozwolone()) return '';
  try {
    const r = await fetch(`${SENSES_URL}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: buf.toString('base64') }),
      signal: AbortSignal.timeout(czasMs),
    });
    if (!r.ok) return '';
    return (await r.json()).text || '';
  } catch { return ''; }
}

async function sensesTranscribe(buf, mime, czasMs = 600000) {
  if (!silniki.zmyslyDozwolone()) return '';
  try {
    const r = await fetch(`${SENSES_URL}/stt`, {
      method: 'POST',
      headers: { 'Content-Type': mime || 'application/octet-stream' },
      body: buf,
      signal: AbortSignal.timeout(czasMs),
    });
    if (!r.ok) return '';
    return (await r.json()).text || '';
  } catch { return ''; }
}

async function sensesDetectSummary(buf, mime, czasMs = 60000) {
  if (!silniki.zmyslyDozwolone()) return '';
  try {
    const r = await fetch(`${SENSES_URL}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: `data:${mime};base64,${buf.toString('base64')}` }),
      signal: AbortSignal.timeout(czasMs),
    });
    if (!r.ok) return '';
    return (await r.json()).summary || '';
  } catch { return ''; }
}

/* Załącznik do ROZMOWY (nie do bazy wiedzy). Cosmos wyciąga tekst i oddaje go
   przeglądarce, która dokleja go do wiadomości — model dostaje treść umowy,
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
  /* Przeglądarka czeka na ten tekst — całość musi się zmieścić przed limitem
     Cloudflare (100 s), inaczej zamiast odpowiedzi przychodzi strona 524. */
  const tekst = (await extractKbText(nazwa, req.headers['content-type'] || '', buf, { czasMs: 85000 })) || '';
  if (!tekst.trim()) {
    return sendJson(res, 200, {
      name: nazwa, chars: 0, text: '',
      error: wymagaTranskrypcji(nazwa, req.headers['content-type'] || '')
        ? 'Nie udało się przepisać nagrania od ręki (zmysły wyłączone albo nagranie za długie na minutę czekania). '
          + 'Dodaj je do bazy wiedzy — tam przepisze się w tle.'
        : ext === 'pdf'
        ? 'To wygląda na skan — nie ma w nim warstwy tekstowej. Odczytanie wymaga OCR, '
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
   obejmują, opisuje nagłówek lib/kod.js — najkrócej: brak dostępu do plików
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
            dodanych: U().indeksowanie.dodanych, blad: U().indeksowanie.blad }
        : null,
      wArchiwum: archiwum.ile(),
      // Ile z tego ma już dane z plików — patrz `postep()` w lib/archiwum.js.
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
       wracający callback musi podać dokładnie tę wartość. */
    const stanCsrf = genId();
    oczekiwaneStany.add(stanCsrf);
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
    if (!oczekiwaneStany.has(q.get('state') || '')) {
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
    U().indeksowanie = { trwa: true, przejrzanych: 0, dodanych: 0, blad: null, sygnal: { przerwane: false } };
    /* Indeksowanie idzie W TLE i nie blokuje odpowiedzi: przy 2 TB trwa
       kilkanaście minut, a przeglądarka zerwałaby połączenie po minucie. */
    (async () => {
      try {
        await onedrive.indeksuj(async (paczka) => {
          // Porcjami — strona z Graph to setki plików, liczonych jednym ciągiem.
          await archiwum.dodajPorcjami(paczka);
          U().indeksowanie.dodanych += paczka.length;
        }, { folder: d.folder || '', limit: Number(d.limit) || 100000, sygnal: U().indeksowanie.sygnal });
        addEvent('archiwum', `OneDrive: zindeksowano ${U().indeksowanie.dodanych} plików`);
      } catch (err) {
        U().indeksowanie.blad = err.message;
        console.error('Indeksowanie OneDrive:', err.message);
      } finally {
        U().indeksowanie.trwa = false;
        // `zapisz()` jest asynchroniczny — czekamy, żeby „U().indeksowanie
        // skończone" znaczyło też „zapisane na dysk".
        await archiwum.zapisz();
      }
    })();
    return sendJson(res, 202, { ruszylo: true });
  }

  if (p === '/api/onedrive/index' && req.method === 'DELETE') {
    if (U().indeksowanie) U().indeksowanie.sygnal.przerwane = true;
    return sendJson(res, 200, { przerwano: true });
  }

  /* ODŁĄCZENIE ŹRÓDŁA TO NIE TO SAMO CO USUNIĘCIE MATERIAŁU.
   *
   *  Stało tu `archiwum.usunZrodlo('onedrive')`, czyli odłączenie konta
   *  kasowało CAŁY zaindeksowany materiał — u Marcina 55 tysięcy plików
   *  razem z rozpoznanymi treściami i dociągniętym EXIF-em. Wystarczyło
   *  odłączyć i podłączyć konto z powrotem (choćby po to, żeby odświeżyć
   *  poświadczenia), żeby stracić godziny pracy karty graficznej.
   *
   *  Przeczyło to zasadzie zapisanej w nagłówku `lib/archiwum.js`: indeks
   *  jest PASYWNY i ma działać bez połączenia — „ile klipów 50 mm w tym
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

const oczekiwaneStany = new Set();
const escapeHtmlSerwer = (s) => String(s || '').replace(/[&<>"]/g,
  (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[z]));

const wymagaTranskrypcji = (name, mime) => AV_EXTS.has(extOf(name)) || /^(audio|video)\//.test(mime || '');

async function extractKbText(name, mime, buf, { czasMs } = {}) {
  const ext = extOf(name);
  const limit = (domyslny) => (czasMs ? Math.min(czasMs, domyslny) : domyslny);
  if (TEXT_EXTS.has(ext) || /^text\//.test(mime || '')) {
    return buf.toString('utf8').slice(0, 200000);
  }
  /* Najpierw własnym czytnikiem, dopiero potem zmysłami. Odwrotna kolejność
     znaczyła, że wczytanie umowy z telefonu nie działa, gdy komputer domowy
     jest wyłączony — czyli prawie zawsze. */
  if (OFFICE_EXTS.has(ext) || DOK_OBSLUGIWANE.has(ext)) {
    const { text, potrzebnyOcr } = czytajLokalnie(name, buf);
    if (text && !potrzebnyOcr) return text.slice(0, 200000);
    // Skan albo format, którego sami nie umiemy (doc, xls, odt) — do zmysłów.
    const zeZmyslow = await sensesExtract(name, buf, limit(90000));
    if (zeZmyslow) return zeZmyslow.slice(0, 200000);
    return text.slice(0, 200000);
  }
  if (wymagaTranskrypcji(name, mime)) {
    return (await sensesTranscribe(buf, mime, limit(600000))).slice(0, 200000);
  }
  if (/^image\//.test(mime || '')) {
    const summary = await sensesDetectSummary(buf, mime, limit(60000));
    return summary ? `Na obrazie wykryto: ${summary}` : '';
  }
  return '';
}

/* 140 fragmentów po 1500 znaków = cały tekst, który trzymamy (200 tys. znaków).
   Przy dawnych 30 baza wiedzy przeszukiwała tylko pierwsze 45 tys. —
   reszta dłuższego PDF-a była niewidoczna dla pytań. */
function chunkText(text, size = 1500, max = 140) {
  const chunks = [];
  for (let i = 0; i < text.length && chunks.length < max; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

async function buildChunks(text) {
  const parts = chunkText(text || '');
  if (!parts.length) return [];
  const embs = await embedTexts(parts, 60000, 'passage');
  return parts.map((t, i) => ({
    text: t,
    embedding: embs ? embs.vectors[i] : null,
    embModel: embs ? embs.model : null,
  }));
}

function kbItemMeta(it) {
  return {
    id: it.id,
    type: it.type,
    name: it.name,
    mime: it.mime || '',
    url: it.url || '',
    size: it.size || 0,
    time: it.time,
    textChars: (it.text || '').length,
    preview: (it.text || '').slice(0, 140),
    przetwarzanie: it.przetwarzanie || '',   // np. nagranie przepisuje się w tle
  };
}

// Przeliczenie fragmentów bazy wiedzy na aktualny model embeddingów.
// Działa w tle i pilnuje, by nie uruchomić się dwa razy naraz.
/* Dwie rzeczy zmierzone przez zespół IT: każda zmiana dostawcy embeddingów
   (zmysły zasnęły → chmura, zmysły wróciły → z powrotem) przeliczała bazę
   przy KAŻDYM czacie i zapisywała cały indeks — 40 MB synchronicznie, pętla
   zdarzeń stała do 1,5 s. Teraz: model musi się utrzymać kilka minut, zanim
   ruszy przeliczanie (chwilowa drzemka zmysłów nic nie przepisuje), a zapis
   przeliczonych wektorów jest odroczony i zbiorczy. */
const REEMBED_ZWLOKA_MS = Number(process.env.COSMOS_REEMBED_ZWLOKA_MS) || 5 * 60 * 1000;
const REEMBED_ZAPIS_MS = 20_000;
function zapiszKbWkrotce() {
  const stanOsobyTeraz = U();
  if (stanOsobyTeraz.kbZapisZaplanowany) return;
  const u = kto();
  stanOsobyTeraz.kbZapisZaplanowany = setTimeout(() => {
    stanOsobyTeraz.kbZapisZaplanowany = null;
    wKontekscie(u, saveKb);
  }, REEMBED_ZAPIS_MS);
  if (stanOsobyTeraz.kbZapisZaplanowany.unref) stanOsobyTeraz.kbZapisZaplanowany.unref();
}

async function reembedKbChunks(model, budget = 40) {
  if (U().reembedBusy) return;
  const cel = U().reembedCel;
  if (!cel || cel.model !== model) { U().reembedCel = { model, od: Date.now() }; }
  const stale = [];
  for (const it of U().kbItems) {
    for (const ch of it.chunks || []) {
      if (!sameModel(ch, model)) stale.push(ch);
      if (stale.length >= budget) break;
    }
    if (stale.length >= budget) break;
  }
  if (!stale.length) return;
  /* Fragmenty BEZ wektora (plik dodany, gdy embeddingów nie było) liczymy od
     razu; przepisywanie wektorów z innego modelu — dopiero gdy nowy model
     utrzymał się przez REEMBED_ZWLOKA_MS. */
  const tylkoPuste = stale.every((c) => !Array.isArray(c.embedding) || !c.embedding.length);
  if (!tylkoPuste && Date.now() - U().reembedCel.od < REEMBED_ZWLOKA_MS) return;
  U().reembedBusy = true;
  try {
    const embs = await embedTexts(stale.map((c) => c.text), 60000, 'passage');
    if (embs) {
      stale.forEach((c, i) => { c.embedding = embs.vectors[i]; c.embModel = embs.model; });
      zapiszKbWkrotce();
      console.log(`  → Przeliczono ${stale.length} fragmentów bazy wiedzy na model ${model}`);
    }
  } catch { /* spróbujemy przy następnym pytaniu */ } finally {
    U().reembedBusy = false;
  }
}

async function kbSearch(query, excludeIds = [], limit = 4) {
  if (!query || !query.trim()) return [];
  const pool = [];
  for (const it of U().kbItems) {
    if (excludeIds.includes(it.id)) continue;
    for (const ch of it.chunks || []) pool.push({ name: it.name, ...ch });
  }
  if (!pool.length) return [];

  let qvec = null, qmodel = null;
  const q = await embedTexts([query], 5000, 'query');
  if (q) { qvec = q.vectors[0]; qmodel = q.model; }

  // Fragmenty policzone innym modelem (albo wcale) przelicz w tle — nie
  // blokujemy tym odpowiedzi, przy kolejnym pytaniu będą już gotowe.
  if (qmodel) reembedKbChunks(qmodel);

  // Próg dla każdego fragmentu osobno — patrz searchMemory w lib/pamiec.js.
  return pool
    .map((c) => {
      const wektor = Boolean(qvec && sameModel(c, qmodel));
      return { c, wektor, score: wektor ? cosine(qvec, c.embedding) : keywordScore(query, c.text) };
    })
    .filter((s) => s.score > (s.wektor ? 0.35 : 0.18))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ name: s.c.name, text: s.c.text }));
}

async function kbAddFile(name, mime, buf, presetText = null) {
  // Limit miejsca osoby — przed zapisem, nie po (lib/miejsce.js). Obejmuje też
  // wyniki Studia i notatki głosowe, bo wszystkie idą tędy.
  await miejsce_.sprawdz(buf.length);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const plik = path.join(KB_FILES(), id);
  try {
    fs.mkdirSync(KB_FILES(), { recursive: true });
    fs.writeFileSync(plik, buf);
  } catch (err) {
    try { fs.unlinkSync(plik); } catch { /* nie powstał */ }
    throw miejsce_.zBleduDysku(err);
  }
  /* Pozycja trafia do indeksu albo wcale: indeks, który się nie zapisał,
     zostawiłby po restarcie plik-sierotę, a człowiek dostałby „ok". */
  const wpisz = (item) => {
    U().kbItems.push(item);
    const blad = saveKb();
    if (blad) {
      U().kbItems = U().kbItems.filter((it) => it !== item);
      try { fs.unlinkSync(plik); } catch { /* już nie ma */ }
      throw miejsce_.zBleduDysku(blad);
    }
    miejsce_.dolicz(buf.length);
  };
  /* Nagranie przepisuje się W TLE. Transkrypcja godzinnego nagrania trwa
     minuty, a żądanie, które na nią czekało, za Cloudflare kończyło się po
     100 s stroną 524 — choć plik i tak się potem dodawał. Pozycja jest od
     razu, tekst dochodzi, gdy zmysły skończą (kontekst osoby idzie za nami). */
  if (presetText === null && wymagaTranskrypcji(name, mime)) {
    const item = { id, type: 'file', name, mime, size: buf.length, time: Date.now(), text: '', chunks: [], przetwarzanie: 'transkrypcja' };
    wpisz(item);
    (async () => {
      const text = await extractKbText(name, mime, buf);
      item.text = text;
      item.chunks = await buildChunks(text);
      delete item.przetwarzanie;
      saveKb();
      addEvent('baza-wiedzy', text ? `przepisano nagranie „${name}"` : `nie udało się przepisać nagrania „${name}"`);
    })().catch((err) => {
      delete item.przetwarzanie;
      saveKb();
      console.error(`Transkrypcja „${name}" nie powiodła się:`, err.message);
    });
    return item;
  }
  const text = presetText !== null ? presetText : await extractKbText(name, mime, buf);
  const item = {
    id, type: 'file', name, mime, size: buf.length, time: Date.now(),
    text, chunks: await buildChunks(text),
  };
  wpisz(item);
  return item;
}

// ---------------------------------------------------------------------------
// SAMOŚWIADOMOŚĆ — manifest zdolności.
//   Cosmos musi wiedzieć, czym JEST i co REALNIE potrafi w tej chwili — nie
//   z wyuczonej formułki, tylko z żywego stanu systemu. Dzięki temu nie obiecuje
//   rzeczy, których nie ma skonfigurowanych, i potrafi powiedzieć, jak je włączyć.
// ---------------------------------------------------------------------------

let sensesCache = { at: 0, online: false, caps: {} };
let sensesOdswiezanie = null;

/* Odpytanie zmysłów NIE MOŻE wstrzymywać rozmowy.
   Tak było: co minutę cache wygasał, a `capabilityManifest()` — czekający na
   ten fetch — jest awaitowany PRZED wysłaniem pytania do modelu. Komputer
   domowy Marcina bywa wyłączony, więc raz na minutę pierwsza wiadomość
   płaciła do 1,5 s ciszy, zanim model w ogóle dostał pytanie.

   Ta sama zasada, co przy pamięci długotrwałej: dodatek do odpowiedzi nigdy
   nie wstrzymuje samej odpowiedzi. Oddajemy to, co wiemy, a świeży stan
   dociąga się w tle na następną wiadomość. */
const ZMYSLY_CACHE_MS = Number(process.env.SENSES_CACHE_MS || 60000);
function sensesState() {
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
  // Przy pierwszym w życiu zapytaniu nie ma czego oddać — wtedy czekamy,
  // ale tylko ten jeden raz, nie co minutę.
  return sensesCache.at ? sensesCache : sensesOdswiezanie.then(() => sensesCache);
}

function moduleExists(...parts) {
  return fs.existsSync(path.join(__dirname, ...parts));
}

async function capabilityManifest() {
  // Członek bez zgody na zmysły ich nie ma — model nie może mu ich obiecywać.
  const senses = silniki.zmyslyDozwolone() ? await sensesState() : { online: false, caps: {} };
  const imgs = imageProviders().map((p) => p.label);
  let playwright = false;
  try { require.resolve('playwright'); playwright = true; } catch { /* brak */ }

  const missing = [];
  if (!ENDPOINTS.cloud.apiKey) missing.push('chmura NVIDIA — ustaw NVIDIA_API_KEY w .env');
  if (!ENDPOINTS.local.model) missing.push('model lokalny na RTX — uruchom Ollamę i ustaw LOCAL_MODEL');
  if (!senses.online) missing.push('zmysły (mowa, wzrok) — uruchom python senses/service.py');
  if (!embedStatus(senses.caps && senses.caps.embed).provider) {
    missing.push('wyszukiwanie semantyczne — uruchom zmysły albo ustaw NVIDIA_API_KEY '
      + '(embeddingi z chmury działają też przy wyłączonym komputerze domowym)');
  }
  if (!imgs.length) missing.push('generowanie obrazów — ustaw OPENAI_API_KEY lub FIREFLY_CLIENT_ID');
  if (!STUDIO.eleven.key) missing.push('lektor ElevenLabs — ustaw ELEVENLABS_API_KEY');
  if (!STUDIO.seedance.key) missing.push('wideo Seedance — ustaw SEEDANCE_API_KEY');
  if (!playwright) missing.push('nagrywanie i automatyzacja stron — npm install playwright');
  if (!secretsEnabled()) missing.push('logowanie z menedżera haseł — ustaw SECRETS_PROVIDER');
  if (!BRIEFING.lat || !BRIEFING.lon) missing.push('poranna odprawa (pogoda) — ustaw BRIEFING_LAT i BRIEFING_LON');
  if (!BRIEFING.ics) missing.push('kalendarz w odprawie — ustaw CALENDAR_ICS');
  if (!urzadzenia().length) missing.push('sterowanie urządzeniami — dodaj je w Ustawieniach → Urządzenia');

  return {
    tozsamosc: 'Cosmos — osobiste, prywatne środowisko AI użytkownika. Mózgiem jest model '
      + 'językowy (domyślnie NVIDIA Nemotron), ale Cosmos to całość: pamięć, zmysły, '
      + 'narzędzia i zdolność uczenia się. Wszystko działa na sprzęcie użytkownika '
      + 'albo na jego serwerze; dane i klucze nie należą do nikogo innego.',
    mozgi: Object.entries(ENDPOINTS).map(([id, ep]) => ({
      id, model: ep.model || '(nie ustawiono)', gotowy: Boolean(ep.apiKey || ep.model),
    })),
    zmysly: { online: senses.online, ...senses.caps },
    embeddingi: embedStatus(senses.caps && senses.caps.embed),
    studio: { obraz: imgs, dzwiek: Boolean(STUDIO.eleven.key), wideo: Boolean(STUDIO.seedance.key),
      eksport: STUDIO.exportDir || null },
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
       ani misji waypointowej, ani kart ujęć — a od kiedy mają interfejs,
       jest dokąd odesłać człowieka zamiast tłumaczyć trasę HTTP. */
    plener: {
      sprzet: [U().sprzet.korpus, U().sprzet.obiektywy, U().sprzet.dodatki].filter(Boolean).join(' · ') || null,
      aparatPoWifi: canon.skonfigurowany(),
      misjaKmz: true,
      kartyUjec: true,
      archiwum: onedrive.skonfigurowany(),
    },
    /* Liczba rozmów, nie dokładna liczba przykładów. Dokładną liczy
       buildTrainingDataset, czytając i parsując KAŻDĄ rozmowę — a manifest
       idzie do kontekstu przy każdej wiadomości: 114 ms stania serwera na
       wiadomość przy 300 rozmowach. Dokładnie liczy /api/train/env, gdy
       ktoś naprawdę otwiera trening. Trening jest tylko u właściciela. */
    trening: czyWlasciciel()
      ? { przykladyChat: U().convIndex.length, skrypt: moduleExists('training', 'qlora_example.py') }
      : null,
    brakujace: missing,
  };
}

/** Zwięzły opis do wstrzyknięcia w kontekst rozmowy (model musi to zrozumieć od razu). */
function capabilityText(m) {
  const yes = (v) => (v ? 'tak' : 'nie');
  const z = m.zmysly;
  const lines = [
    'KIM JESTEŚ — TWOJE REALNE MOŻLIWOŚCI (stan na teraz, nie ogólniki):',
    m.tozsamosc,
    '',
    'Mózgi: ' + m.mozgi.map((b) => `${b.id}=${b.model}${b.gotowy ? '' : ' (niegotowy)'}`).join(', '),
    `Zmysły: ${z.online ? 'online' : 'offline'} — mowa(Whisper)=${yes(z.whisper)}, `
      + `głos(Piper)=${yes(z.piper)}, wzrok(YOLO)=${yes(z.yolo)}, `
      + `embeddingi=${yes(z.embed)}, upscale=${yes(z.upscale)}`,
    // MediaPipe bywa zainstalowany, ale żadna funkcja interfejsu go nie wywołuje.
    // Bez tego zastrzeżenia model obiecywał odczyt sylwetki, którego nie ma.
    `Sylwetka (MediaPipe): ${z.mediapipe ? 'biblioteka zainstalowana, ale ŻADNA funkcja '
      + 'Cosmosa jej nie wywołuje — nie obiecuj odczytu sylwetki z kamery przeglądarki' : 'nie'}`,
    `Kinect 360: ${z.kinect
      ? 'podłączony — masz podgląd obrazu i mapy głębi w panelu „Kamera na żywo”, '
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
    `Plener (panel boczny „Plener") — foto i wideo: plan zdjęciowy dla dowolnego miejsca `
      + 'i godziny, lista ujęć do nakręcenia z ogniskowymi, misja waypointowa dla drona '
      + `do pobrania jako .kmz, aparat Canon po Wi-Fi=${yes(m.plener.aparatPoWifi)}, `
      + `archiwum materiału=${yes(m.plener.archiwum)}. Sprzęt użytkownika: `
      + `${m.plener.sprzet || 'niepodany — poproś o uzupełnienie w Plenerze'}`,
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

/** „Co jeszcze możesz dla mnie zrobić?" — propozycje szyte pod tego użytkownika. */
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

async function handleKb(req, res, pathname) {
  if (pathname === '/api/kb' && req.method === 'GET') {
    return sendJson(res, 200, { items: U().kbItems.map(kbItemMeta) });
  }

  if (pathname === '/api/kb' && req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const item = U().kbItems.find((it) => it.id === id);
    U().kbItems = U().kbItems.filter((it) => it.id !== id);
    if (item?.type === 'file') {
      try { fs.unlinkSync(path.join(KB_FILES(), item.id)); miejsce_.dolicz(-(item.size || 0)); } catch { /* już nie ma */ }
    }
    const blad = saveKb();
    if (blad) return bladZapisu(res, blad);
    return sendJson(res, 200, { ok: true, total: U().kbItems.length });
  }

  if (pathname === '/api/kb/raw' && req.method === 'GET') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const item = U().kbItems.find((it) => it.id === id && it.type === 'file');
    if (!item) { res.writeHead(404); return res.end(); }
    try {
      const buf = fs.readFileSync(path.join(KB_FILES(), item.id));
      /* Wgrany HTML albo SVG otwarty „inline" na adresie aplikacji to skrypt
         z pełnym dostępem do /api/* w imieniu tego, kto kliknął. Takie pliki
         tylko do pobrania i w piaskownicy; zdjęcia i PDF-y dalej w podglądzie. */
      const mime = String(item.mime || 'application/octet-stream').toLowerCase();
      const aktywny = /html|svg|xml|javascript|ecmascript/.test(mime) || !/^(image\/(png|jpe?g|gif|webp|avif|heic)|application\/pdf|text\/plain|audio\/|video\/)/.test(mime);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Disposition': `${aktywny ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(item.name)}`,
        'X-Content-Type-Options': 'nosniff',
        ...(mime === 'application/pdf' ? {} : { 'Content-Security-Policy': 'sandbox; default-src \'none\'; img-src \'self\' data:; media-src \'self\'' }),
      });
      return res.end(buf);
    } catch { res.writeHead(404); return res.end(); }
  }

  if (pathname === '/api/kb/search' && req.method === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
    const results = await kbSearch(q, [], 5);
    return sendJson(res, 200, { query: q, results });
  }

  if (pathname === '/api/kb/file' && req.method === 'POST') {
    /* Plik przychodzi jako SUROWE ciało: typ w Content-Type, nazwa w nagłówku
       X-Cosmos-Nazwa (zakodowana jak w adresie — nie w adresie, bo ten trafia
       do dzienników Cloudflare'a). Dawniej przeglądarka kodowała plik do base64
       i pakowała w JSON w wątku głównym: 45 MB zamrażało telefon na 4,7 s,
       przez tunel szło o 33% więcej danych, a serwer parsował 60 MB JSON-a,
       stojąc w miejscu. Droga JSON + base64 zostaje dla zgodności (skrypty). */
    const typ = String(req.headers['content-type'] || '').toLowerCase();
    let name; let mime; let buf;
    if (typ.startsWith('application/json')) {
      let data;
      try { data = await readJson(req, KB_PLIK_MAX + KB_PLIK_MAX / 3); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      name = String(data.name || 'plik').slice(0, 200);
      mime = String(data.mime || '');
      try { buf = Buffer.from(String(data.data || ''), 'base64'); } catch { buf = null; }
    } else {
      try { name = decodeURIComponent(String(req.headers['x-cosmos-nazwa'] || '')); } catch { name = ''; }
      name = (name || 'plik').replace(/[\/\u0000-\u001f]/g, '_').slice(0, 200);
      mime = typ.split(';')[0].trim();
      if (mime === 'application/octet-stream') mime = '';
      const dlugosc = Number(req.headers['content-length']) || 0;
      if (dlugosc > KB_PLIK_MAX) {
        req.resume();
        return sendJson(res, 413, { error: `Plik jest za duży — limit to ${Math.round(KB_PLIK_MAX / 1048576)} MB (Cloudflare i tak nie przepuszcza więcej niż 100 MB).` });
      }
      /* Limit miejsca znamy przed wysyłką (Content-Length). Odmowę wysyłamy
         dopiero po odczytaniu ciała: odpowiedź w trakcie wysyłki przeglądarka
         potrafi zgubić i pokazać „błąd sieci" zamiast wyjaśnienia. */
      if (dlugosc) {
        try { await miejsce_.sprawdz(dlugosc); } catch (err) {
          req.resume();
          return req.on('end', () => bladZapisu(res, err));
        }
      }
      try { buf = await readBodyBuffer(req, KB_PLIK_MAX); } catch {
        return sendJson(res, 413, { error: `Plik jest za duży — limit to ${Math.round(KB_PLIK_MAX / 1048576)} MB.` });
      }
    }
    if (!buf || !buf.length) return sendJson(res, 400, { error: 'Brak danych pliku.' });

    const item = await kbAddFile(name, mime, buf);
    addEvent('baza-wiedzy', `dodano plik: ${name}${item.text ? ` (${item.text.length} znaków tekstu)` : ''}`);
    return sendJson(res, 200, { ok: true, item: kbItemMeta(item) });
  }

  if (pathname === '/api/kb/link' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    let url = String(data.url || '').trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try {
      /* Bezpieczne pobieranie: gość nie może kazać serwerowi zajrzeć do sieci
         prywatnej (127.0.0.1, zmysły, metadane chmury, Tailscale). Właściciel
         może — i tak ma pełny dostęp do serwera. Patrz lib/pobieranie.js. */
      const r = await pobierzStrone(url, { pozwolPrywatne: czyWlasciciel(), czasMs: 20000, maxBajtow: 3_000_000 });
      if (r.status >= 400) throw new Error(`strona odpowiedziała HTTP ${r.status}`);
      url = r.adres;
      const html = r.tekst;
      const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '') || url;
      const text = czytelnyTekst(html).slice(0, 200000);
      await miejsce_.sprawdz(Buffer.byteLength(text));
      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'link', name: title.slice(0, 200), url, time: Date.now(),
        text, chunks: await buildChunks(text),
      };
      U().kbItems.push(item);
      const blad = saveKb();
      if (blad) {
        U().kbItems = U().kbItems.filter((it) => it !== item);
        return bladZapisu(res, blad);
      }
      addEvent('baza-wiedzy', `dodano link: ${title.slice(0, 80)}`);
      return sendJson(res, 200, { ok: true, item: kbItemMeta(item) });
    } catch (err) {
      if (miejsce_.toBrakMiejsca(err)) return bladZapisu(res, err);
      /* Człowiek ma zobaczyć, co jest nie tak, a nie „getaddrinfo ENOTFOUND". */
      const kod = err.code || (err.cause && err.cause.code) || '';
      const powod = err.name === 'ZablokowanyAdres' ? err.message
        : /ENOTFOUND|EAI_AGAIN/.test(kod) ? 'taki adres nie istnieje — sprawdź, czy nie ma literówki'
          : /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT/.test(kod) ? 'strona nie odpowiada'
            : /CERT|SSL|TLS/i.test(kod + err.message) ? 'strona ma nieważny certyfikat bezpieczeństwa'
              : err.message;
      return sendJson(res, 502, { error: `Nie udało się pobrać strony: ${powod}` });
    }
  }

  if (pathname === '/api/kb/note' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const text = String(data.text || '').trim().slice(0, 200000);
    if (!text) return sendJson(res, 400, { error: 'Pusta notatka.' });
    const name = String(data.title || '').trim() ||
      `Notatka głosowa ${new Date().toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}`;
    await miejsce_.sprawdz(Buffer.byteLength(text));
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'note', name: name.slice(0, 200), time: Date.now(),
      text, chunks: await buildChunks(text),
    };
    U().kbItems.push(item);
    const blad = saveKb();
    if (blad) {
      U().kbItems = U().kbItems.filter((it) => it !== item);
      return bladZapisu(res, blad);
    }
    addEvent('baza-wiedzy', `zapisano notatkę: ${name.slice(0, 80)}`);
    return sendJson(res, 200, { ok: true, item: kbItemMeta(item) });
  }

  res.writeHead(405);
  res.end();
}

// API: konfiguracja i status
// ---------------------------------------------------------------------------

function handleConfig(res) {
  /* Zakładki silników to to, czego TA osoba może użyć — nie to, co ma serwer.
     Członek bez przyznanego Claude'a nie widzi zakładki Claude, chyba że wpisał
     własny klucz; wtedy `zrodlo: 'wlasny'` mówi, że płaci sam. */
  /* Adres lokalnego silnika i zmysłów to adres domu właściciela (Tailscale),
     a folder eksportu — ścieżka na jego dysku. Członkowi nie są do niczego
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
    glos: glos.mozliwosci(),
    studio: {
      dozwolone: silniki.studioDozwolone(),
      image: imageProviders().length > 0,
      speech: Boolean(STUDIO.eleven.key),
      video: Boolean(STUDIO.seedance.key),
      exportDir: wlasciciel ? STUDIO.exportDir : null,
    },
  });
}

async function handleStatus(req, res) {
  const results = {};
  await Promise.all([
    ...Object.entries(ENDPOINTS).map(async ([name, ep]) => {
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
  /* Bez zgody na zmysły przeglądarka nie może ich zobaczyć jako „online" —
     inaczej kierowałaby do nich mowę i wykrywanie, a dostawała 403. */
  if (!silniki.zmyslyDozwolone()) results.senses = { online: false, caps: {}, tylkoWlasciciel: true };
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
  // GET — ostatnie zdarzenia dla UI
  sendJson(res, 200, { events: recentEvents(60 * 60 * 1000, 50) });
}

// ---------------------------------------------------------------------------
// API: czat (streaming SSE) z kontekstem percepcji
// ---------------------------------------------------------------------------

/* Żądania czatu wysłane do dostawcy, który jeszcze nie odpowiedział — po nich
   „Stop" przerywa, zanim bieg powstanie. Klucz: id biegu. */
const OCZEKUJACE = new Map();
/* Ile najdłużej model może milczeć: przed nagłówkami i między kawałkami
   strumienia. Modele rozumujące potrafią myśleć długo, ale przysyłają wtedy
   `reasoning_content` — cisza 90 s to już zawieszenie. */
const CISZA_MODELU_MS = Number(process.env.COSMOS_CISZA_MODELU_MS) || 90_000;
/* Odmowa przyjęcia obrazu — po treści, bo kod bywa różny (400 w chmurze,
   500 w Ollamie i llama.cpp bez --mmproj). */
const ODMOWA_OBRAZU = /image|vision|multimodal|mmproj|content.*type/i;
/* Modele, które myślą PO CICHU: gpt-5+/o* i Claude przez warstwę zgodną nie
   przysyłają `reasoning_content`, więc po nagłówkach potrafią milczeć minutami
   (Claude 5 myśli adaptacyjnie, na trudnym zadaniu długo). Dla nich osobny,
   dłuższy limit — tylko do PIERWSZEJ treści. Za Cloudflare to bezpieczne, bo
   przeglądarka dostaje puls co 25 s (lib/biegi.js); limit przed nagłówkami
   zostaje 90 s, bo wtedy przeglądarka nie ma jeszcze czym oddychać. */
const CISZA_MYSLENIA_MS = Number(process.env.COSMOS_CISZA_MYSLENIA_MS) || 300_000;
const cichoMysli = (ep, model) => Boolean(ep.anthropic) || /^claude/i.test(model)
  || /^(o\d|gpt-([5-9]|\d{2,}))/i.test(String(model).replace(/^openai\//, ''));

/* Lokalny GPU za uśpionym Tailscale: każda wiadomość czekała ~11,6 s na
   „fetch failed" (limit połączenia), a następna płaciła to samo. Po porażce
   POŁĄCZENIA pamiętamy ją przez 30 s i odpowiadamy od razu, z przyczyną
   rozpoznaną po kodzie błędu zamiast gołego „fetch failed". */
const LOKALNY_BEZPIECZNIK_MS = Number(process.env.COSMOS_BEZPIECZNIK_LOKALNEGO_MS) || 30_000;
let lokalnyNiedostepny = { do: 0, rodzaj: '' };

function rodzajBleduPolaczenia(err) {
  const kod = String(err?.cause?.code || err?.code || '');
  if (/UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(kod)) return 'uspiony';
  if (/ECONNREFUSED/.test(kod)) return 'odmowa';
  if (/ENOTFOUND|EAI_AGAIN/.test(kod)) return 'dns';
  return '';
}

function komunikatLokalnego(rodzaj, ep, err) {
  // Adres domu właściciela i rady o Ollamie są dla niego, nie dla gościa.
  if (!czyWlasciciel()) return 'Komputer właściciela z lokalnym modelem teraz nie odpowiada — spróbuj później albo wybierz chmurę.';
  if (rodzaj === 'uspiony') {
    return `Komputer domowy nie odpowiada (${ep.baseUrl}) — jest uśpiony, wyłączony albo poza Tailscale. `
      + 'Obudź go albo przełącz się na Chmurę.';
  }
  if (rodzaj === 'odmowa') {
    return `Komputer domowy odpowiada, ale lokalny model nie przyjmuje połączeń (${ep.baseUrl}). `
      + 'Uruchom Ollamę (albo vLLM); Ollama musi słuchać w sieci: OLLAMA_HOST=0.0.0.0.';
  }
  if (rodzaj === 'dns') {
    return `Nazwa komputera domowego się nie rozwiązuje (${ep.baseUrl}) — sprawdź MagicDNS w Tailscale albo wpisz adres 100.x.y.z w LOCAL_BASE_URL.`;
  }
  return `Nie udało się połączyć z lokalnym modelem (${ep.baseUrl}). Sprawdź, czy Ollama/vLLM działa. (${err?.message || ''})`;
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

/** Zgrubnie: ile tokenów zajmie treść. Polszczyzna w tokenizerach Llamy
 *  i Qwena to ok. 3 znaki na token; obraz liczymy jak ~800 tokenów. */
function szacujTokeny(tresc) {
  if (typeof tresc === 'string') return Math.ceil(tresc.length / 3) + 4;
  if (Array.isArray(tresc)) {
    return tresc.reduce((a, p) => a + (p.type === 'text' ? Math.ceil(String(p.text || '').length / 3) : 800), 4);
  }
  return 4;
}

/** Błąd dostawcy w środku strumienia — PO odpowiedzi 200. Udokumentowany
 *  u Anthropic („an error can occur after the API returns a 200"), znany też
 *  z vLLM. Zwraca treść błędu albo ''. */
function bladWStrumieniu(blok) {
  for (const linia of String(blok).split('\n')) {
    const m = linia.match(/^data:\s*(\{.*\})\s*$/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[1]);
      if (j.choices) continue;
      const e = j.error ?? (j.object === 'error' ? j : null);
      if (!e) continue;
      return typeof e === 'string' ? e : String(e.message || e.type || JSON.stringify(e)).slice(0, 300);
    } catch { /* niepełny blok */ }
  }
  return '';
}

/* Limit ciała czatu. Wspólne 32 MB pozwalało sześcioma równoległymi czatami
   po 24 MB podnieść pamięć serwera o gigabajt. Oficjalna aplikacja zmniejsza
   zdjęcia do 1024 px, więc 16 MB to kilka zdjęć z dużym zapasem. */
const CZAT_MAX_B = Number(process.env.COSMOS_CZAT_MAX_BYTES) || 16 * 1024 * 1024;

async function handleChat(req, res) {
  let payload;
  try {
    payload = await readJson(req, CZAT_MAX_B);
  } catch (err) {
    if (/too large|za duż/i.test(err.message || '')) {
      return sendJson(res, 413, { error: `Wiadomość jest za duża (limit ${Math.round(CZAT_MAX_B / 1048576)} MB) — wyślij mniej albo mniejsze zdjęcia.` });
    }
    return sendJson(res, 400, { error: 'Nieprawidłowy JSON w żądaniu.' });
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return sendJson(res, 400, { error: 'Pole "messages" jest wymagane.' });
  }

  /* Uprawnienie sprawdzamy WPROST, zanim cokolwiek poleci do modelu. Strażnik
     w `pickEndpoint` i tak podmieniłby silnik na chmurę NVIDIA, ale wtedy
     osoba prosząca o Claude'a dostałaby odpowiedź Nemotrona bez słowa
     wyjaśnienia — a to wygląda jak usterka, nie jak decyzja właściciela. */
  const dostepSilnika = silniki.dostep(payload.endpoint);
  if (payload.endpoint && payload.endpoint !== 'cloud' && !dostepSilnika.ok) {
    return sendJson(res, 403, { error: dostepSilnika.powod, kod: 'silnik-niedostepny' });
  }
  const ep = pickEndpoint(payload.endpoint);
  // Jedyne, co właściciel widzi o cudzej aktywności: liczba wiadomości.
  konta.zanotujWiadomosc(kto().id);

  if (!ep.apiKey && ep.baseUrl.includes('integrate.api.nvidia.com')) {
    return sendJson(res, 401, {
      error: 'Brak klucza API dla chmury NVIDIA. Ustaw NVIDIA_API_KEY w pliku .env ' +
             '(klucz wygenerujesz na https://build.nvidia.com).',
    });
  }
  if (payload.endpoint === 'local' && Date.now() < lokalnyNiedostepny.do) {
    const za = Math.ceil((lokalnyNiedostepny.do - Date.now()) / 1000);
    return sendJson(res, 502, { kod: 'lokalny-niedostepny',
      error: `${komunikatLokalnego(lokalnyNiedostepny.rodzaj, ep)} (Sprawdzone przed chwilą — kolejna próba możliwa za ${za} s.)` });
  }

  // Kontekst: percepcja + narzędzia + pamięć + baza wiedzy — jako dodatkowe
  // wiadomości systemowe, zaraz po instrukcji systemowej użytkownika.
  const messages = [...payload.messages];
  const extras = [];

  const lastUser = [...payload.messages].reverse().find((m) => m.role === 'user');
  const queryText = !lastUser ? ''
    : (typeof lastUser.content === 'string'
        ? lastUser.content
        : (lastUser.content.find?.((p) => p.type === 'text')?.text || ''));

  /* Ile instrukcji ten model uniesie. Dotąd każdy dostawał ten sam prompt
     na 1351 tokenów — także model 4-miliardowy, który żadnego z opisanych
     narzędzi nie umie użyć, a znacznik wypisałby użytkownikowi na ekran. */
  let poziom = modelToolLevel(payload.model || ep.model || '');
  /* Małe okno lokalnego modelu (Ollama domyślnie 4096): pełny opis narzędzi
     to 3,3–3,8 tys. tokenów — nie zostawało miejsca na rozmowę ani odpowiedź,
     a Ollama po cichu wyrzucała najstarsze wiadomości, w kaskadzie nawet
     samo PYTANIE. Przy takim oknie wersja krótka (ok. 1 tys. tokenów). */
  const oknoLokalne = payload.endpoint === 'local' ? oknoLokalneDla(ep) : 0;
  if (poziom === 'pelny' && oknoLokalne && oknoLokalne <= 8192) poziom = 'zwiezly';
  const bezNarzedzi = poziom === 'rozmowa';
  const krotko = poziom !== 'pelny';

  // Samoświadomość — czym Cosmos jest i co realnie potrafi w tej chwili
  if (payload.useCapabilities !== false) {
    try {
      const pelny = capabilityText(await capabilityManifest());
      // Najdłuższy pojedynczy blok promptu. Mniejszym modelom wystarcza sama
      // tożsamość — lista czego brakuje w konfiguracji jest dla nich szumem.
      extras.push({ role: 'system', content: krotko ? pelny.split('\n\n')[0] : pelny });
    } catch { /* manifest nie może blokować rozmowy */ }
  }

  /* Data, godzina i miejsce — dwie rzeczy, których model nie ma skąd wiedzieć,
     a bez których „w okolicy" i „dziś" nie znaczą nic. Idą zawsze i na początku. */
  extras.push({
    role: 'system',
    content: `TERAZ JEST: ${terazTekst()}.`
      + (U().location ? `\nUŻYTKOWNIK ZNAJDUJE SIĘ W: ${U().location}.`
        + ' Używaj tego miejsca, gdy pyta o coś „w okolicy", „niedaleko" albo „u mnie" —'
        + ' nie dopytuj o lokalizację, którą już znasz.'
        : '\nNie znasz lokalizacji użytkownika. Jeśli jest potrzebna, zapytaj o nią raz, krótko.'),
  });

  /* JAK MÓWIĆ — reguła, której przez cały czas nie było, i to się mściło.
   *
   *  Marcin, po przeczytaniu kilku zapisów rozmów: „te rozmowy nie są
   *  nienaganne i nie mają takiego flow, jakbym chciał". Miał rację, a duża
   *  część winy leży w instrukcjach, które sam tu dopisywałem. Każda naprawa
   *  dokładała modelowi zdanie o tym, JAK DZIAŁA SYSTEM — a model uczciwie
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
   *  akapicie — plus mówienie o rozmówcy w trzeciej osobie, bo tak brzmiały
   *  instrukcje.
   *
   *  Instrukcje narzędzi zostają, bo są potrzebne, ale od teraz jest granica:
   *  wiedza o mechanice służy do DZIAŁANIA, nie do CYTOWANIA. Ta reguła stoi
   *  przed nimi wszystkimi, bo dotyczy każdej odpowiedzi. */
  extras.push({
    role: 'system',
    content:
      'JAK ODPOWIADASZ — obowiązuje zawsze i jest ważniejsze niż opisy narzędzi niżej.\n'
      + 'Mówisz o ZDJĘCIACH I KLIPACH, nie o rekordach. Nigdy nie wymieniaj w odpowiedzi '
      + 'nazw pól (swiatloPrzyblizone, dataNiepewna, zDanymi), składni filtrów '
      + '(grupuj=, folder=, bezFolderu=), nazw narzędzi ani znaczników, formatu JSON, '
      + 'nazw paneli w interfejsie ani firm, od których biorą się dane. To jest kuchnia. '
      + 'Użytkownik ma dostać danie.\n'
      + 'Gdy coś jest niepewne, powiedz to po ludzku: „ta data pochodzi z pliku, nie '
      + 'z aparatu — może być datą wgrania", a nie „wpis ma dataNiepewna: true".\n'
      + 'Zwracasz się do niego BEZPOŚREDNIO — „możesz", „masz". Nigdy „użytkownik może".\n'
      + 'Nie opowiadaj, co robisz ani czego nie robisz: żadnego „nie wyciągam wniosków", '
      + '„to moja wiedza na podstawie wyników", „przygotuję odpowiednie zapytanie". '
      + 'Po prostu odpowiedz.\n'
      + 'Nie wypisuj list plików ani tabel z metadanymi, jeśli o to nie poproszono — '
      + 'miniatury już widzi. Odpowiedz na PYTANIE, które zadał.\n'
      + 'Nie dopisuj na koniec ofert pomocy w rodzaju „jeśli chcesz, mogę zawęzić…", '
      + 'chyba że naprawdę trzeba wybrać między konkretnymi możliwościami.\n'
      + 'Długość odpowiedzi dobierz do pytania. Na krótkie pytanie — krótka odpowiedź.',
  });

  // Profil użytkownika — pamięć profilowa wstrzykiwana zawsze
  if (U().profile.trim()) {
    extras.push({ role: 'system', content: 'PROFIL UŻYTKOWNIKA (stałe fakty o osobie, z którą rozmawiasz):\n' + U().profile.trim() });
  }

  /* Sprzęt użytkownika — tekst dla modelu mieszka razem z resztą instrukcji,
     w `lib/instrukcje-narzedzi.js`. */
  const blokSprzet = blokSprzetu(U().sprzet);
  if (blokSprzet) extras.push(blokSprzet);

  const scene = payload.useSenses === false ? '' : sceneContext();
  if (scene) extras.push({ role: 'system', content: scene });

  /* Instrukcje narzędzi mieszkają w `lib/instrukcje-narzedzi.js` — to sam
     tekst dla modelu, bez logiki, więc da się go złożyć i sprawdzić
     w teście bez stawiania serwera. Patrz nagłówek tamtego pliku. */
  extras.push(...zbudujInstrukcje({
    payload, krotko, bezNarzedzi, archiwum, userWspolrzedne: U().wspolrzedne,
    procedury, urzadzenia,
    /* Członek bez przyznanego Studia nie dostaje w instrukcji narzędzia
       do generowania obrazów, a narzędzia „uruchom kod" nie dostaje nigdy —
       kod wykonuje się na serwerze, obok kluczy i danych wszystkich. */
    imageProviders: () => (silniki.studioDozwolone() ? imageProviders() : []),
    KOD_WLACZONY: KOD_WLACZONY && czyWlasciciel(), capabilityText,
  }));

  if (payload.useMemory !== false) {
    const recalled = await searchMemory(queryText);
    const memCtx = memoryContextLines(recalled);
    if (memCtx) extras.push({ role: 'system', content: memCtx });
  }

  // Baza wiedzy — pozycje zaznaczone przez użytkownika (zawsze dołączane)
  const kbSelected = Array.isArray(payload.kbSelected) ? payload.kbSelected : [];
  if (kbSelected.length) {
    const chosen = U().kbItems.filter((it) => kbSelected.includes(it.id));

    const textItems = chosen.filter((it) => !/^image\//.test(it.mime || ''));
    if (textItems.length) {
      const parts = textItems.map((it) =>
        `### ${it.name}${it.url ? ` (${it.url})` : ''}\n` +
        `${(it.text || '(plik binarny — brak wyodrębnionego tekstu)').slice(0, 6000)}`);
      extras.push({
        role: 'system',
        content: 'Gdy korzystasz z poniższych materiałów, podaj źródło w formacie [źródło: nazwa]. ' +
                 'BAZA WIEDZY — materiały wybrane przez użytkownika do tej rozmowy. ' +
                 'Odpowiadając, opieraj się na nich w pierwszej kolejności:\n\n' + parts.join('\n\n'),
      });
    }

    // obrazy z bazy dołączamy do ostatniej wiadomości użytkownika (model wizyjny)
    const imageItems = chosen.filter((it) => /^image\//.test(it.mime || '')).slice(0, 3);
    if (imageItems.length) {
      const idx = messages.map((m) => m.role).lastIndexOf('user');
      if (idx >= 0) {
        const m = messages[idx];
        const parts = Array.isArray(m.content)
          ? [...m.content]
          : [{ type: 'text', text: String(m.content) }];
        for (const it of imageItems) {
          try {
            const buf = fs.readFileSync(path.join(KB_FILES(), it.id));
            parts.unshift({
              type: 'image_url',
              image_url: { url: `data:${it.mime};base64,${buf.toString('base64')}` },
            });
          } catch { /* plik zniknął z dysku */ }
        }
        messages[idx] = { ...m, content: parts };
      }
    }
  }

  // Baza wiedzy — automatyczne przywołanie pasujących fragmentów z reszty bazy
  if (payload.useKb !== false) {
    const found = await kbSearch(queryText, kbSelected);
    if (found.length) {
      extras.push({
        role: 'system',
        content: 'Gdy korzystasz z poniższych fragmentów, podaj źródło w formacie [źródło: nazwa]. ' +
                 'BAZA WIEDZY — fragmenty pasujące do bieżącego pytania:\n\n' +
                 found.map((f) => `### ${f.name}\n${f.text}`).join('\n\n'),
      });
    }
  }

  /* Tryb głosowy: odpowiedź zostanie PRZECZYTANA. Model o tym nie wiedział
     i pisał listy, tabele i sekcję źródeł — lektor czytał je adres po adresie
     albo ucinał w połowie. Stoi na końcu dodatkowych instrukcji. */
  if (payload.trybGlosowy === true) {
    extras.push({
      role: 'system',
      content: 'TRYB GŁOSOWY: Twoja odpowiedź zostanie przeczytana na głos. Mów jak w rozmowie: '
        + 'zwykle 2–4 krótkie zdania, bez list, tabel, nagłówków, linków i sekcji „Źródła". '
        + 'Liczby i godziny podawaj tak, jak się je mówi. Narzędzi używasz normalnie, '
        + 'ale sam wynik streść krótko — szczegóły użytkownik zobaczy na ekranie.',
    });
  }

  if (extras.length) {
    const insertAt = messages[0]?.role === 'system' ? 1 : 0;
    messages.splice(insertAt, 0, ...extras);
  }

  /* Reszta budżetu okna lokalnego: najpierw wypadają NAJSTARSZE tury rozmowy
     (nigdy instrukcje i nigdy ostatnia wiadomość człowieka), potem limit
     odpowiedzi schodzi do tego, co zostało. Jawnie — nagłówek niżej — zamiast
     cichego obcinania po stronie Ollamy, które zabierało początek promptu. */
  let przycietoTur = 0;
  let limitZOkna = 0;
  if (oknoLokalne) {
    const zadane = Number.isInteger(payload.max_tokens) ? payload.max_tokens : 2048;
    const naOdpowiedz = Math.min(zadane, 1024);
    let suma = messages.reduce((a, m) => a + szacujTokeny(m.content), 0);
    while (suma + naOdpowiedz > oknoLokalne) {
      const i = messages.findIndex((m, idx) => m.role !== 'system' && idx < messages.length - 1);
      if (i < 0) break;
      suma -= szacujTokeny(messages[i].content);
      messages.splice(i, 1);
      przycietoTur++;
    }
    limitZOkna = Math.max(512, Math.min(zadane, oknoLokalne - suma - 32));
  }

  // Wybór modelu — po zbudowaniu kontekstu, bo baza wiedzy mogła dodać obrazy.
  /* Liczy się OSTATNIA wiadomość człowieka. Zdjęcie z pierwszej tury
     kierowało każdą następną do modelu wizyjnego, choć rozmowa dawno o nim
     zapomniała (klient i tak wysyła obrazy tylko z ostatniej wiadomości). */
  const ostatniaOdCzlowieka = [...messages].reverse().find((m) => m.role === 'user');
  const hasImages = Boolean(ostatniaOdCzlowieka && Array.isArray(ostatniaOdCzlowieka.content)
    && ostatniaOdCzlowieka.content.some((p) => p.type === 'image_url'));

  /* Na silniku przyznanym przez właściciela członek dostaje modele z jego
     listy (lib/silniki.js → granice). Zamiana jest jawna — nagłówek niżej. */
  const { model: modelOsoby, zamiast: modelSpozaListy } = silniki.modelDozwolony(payload.endpoint, payload.model || ep.model);
  let model = modelOsoby;

  if (!model) {
    return sendJson(res, 400, {
      error: payload.endpoint === 'local'
        ? 'Nie skonfigurowano modelu lokalnego. Ustaw LOCAL_MODEL w .env albo wybierz model w Ustawieniach.'
        : 'Nie skonfigurowano modelu. Ustaw NEMOTRON_MODEL w .env albo wybierz model w Ustawieniach.',
    });
  }

  // Zdjęcie do modelu, który nie widzi obrazów, kończy się albo błędem 400,
  // albo — gorzej — odpowiedzią „nie mam dostępu do żadnego zdjęcia”, choć
  // obraz poleciał. Wcześniej przełączenie na model wizyjny działało tylko
  // wtedy, gdy użytkownik NIE wybrał modelu w Ustawieniach; a wybiera prawie
  // zawsze. Teraz decyduje to, czy wybrany model umie patrzeć.
  let swappedFrom = '';
  if (hasImages && blindToImages(model)) {
    if (ep.visionModel) {
      swappedFrom = model;
      model = ep.visionModel;
    } else {
      return sendJson(res, 400, {
        error: `Model „${model}" nie odczytuje obrazów, a dla silnika „${ep.label}" nie `
          + 'ustawiono modelu wizyjnego — zdjęcie zostałoby zignorowane.\n\n'
          + 'Masz dwa wyjścia:\n'
          + '• wybierz w Ustawieniach model oznaczony „widzi obrazy”, albo\n'
          + `• ustaw ${payload.endpoint === 'local' ? 'LOCAL_VISION_MODEL' : 'NEMOTRON_VISION_MODEL'} `
          + 'w .env na serwerze — Cosmos będzie wtedy sam kierował do niego same zdjęcia, '
          + 'a rozmowę zostawi wybranemu modelowi.',
      });
    }
  }

  const body = {
    model,
    messages,
    temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.6,
    max_tokens: limitZOkna || silniki.tokenyDozwolone(payload.endpoint, Number.isInteger(payload.max_tokens) ? payload.max_tokens : 2048),
    top_p: typeof payload.top_p === 'number' ? payload.top_p : 0.95,
    stream: true,
  };

  /* Identyfikator biegu nadaje przeglądarka — musi go znać ZANIM wyśle
     żądanie, bo inaczej nie miałaby po czym wrócić, gdyby połączenie padło
     w pierwszej sekundzie. Bez `bieg` trasa działa po staremu (zwykłe proxy),
     co zostawia furtkę dla starych klientów i dla testów. */
  const biegId = typeof payload.bieg === 'string' && /^[a-z0-9-]{8,64}$/i.test(payload.bieg)
    ? payload.bieg : '';

  const abort = new AbortController();
  /* Było tu `req.on('close', () => abort.abort())` i wyglądało to na przyczynę
     zgłoszenia Marcina („wychodzę ze strony i wszystko jest przerywane").
     Zmierzone: ta linia NIGDY nie działała. `readJson(req)` na początku funkcji
     wyczerpuje strumień żądania, więc `close` leci od razu po wczytaniu korpusu
     — w momencie podpięcia `req.closed` jest już `true` i uchwyt nie ma czego
     złapać. Sonda: klient zrywa połączenie po 1,2 s, a bieg rośnie dalej
     (184 → 612 znaków) i kończy się normalnie.

     Prawdziwa strata była gdzie indziej: odpowiedź istniała WYŁĄCZNIE
     w przeglądarce. Serwer dopisywał ją do martwego gniazda i wyrzucał, nie
     zapisując nigdzie — po powrocie nie było do czego wracać. To naprawiają
     biegi. Uchwyt zostawiamy na starej ścieżce (bez `bieg`), gdzie i tak jest
     martwy, a usunięcie go tylko zaciemniłoby diff. */
  if (!biegId) req.on('close', () => abort.abort());

  /* „Stop" zanim dostawca odpowie nagłówkami: biegu jeszcze nie ma, więc
     /api/chat/stop nie miał czego przerwać — odpowiedź rodziła się mimo to
     i po 20 s lądowała w rozmowie. Rejestr trwa od wysłania do nagłówków. */
  // Klucz z osobą — jak w lib/biegi.js: znajomość cudzego id nie pozwala przerwać cudzego żądania.
  const kluczOczekujacego = `${kto().id}:${biegId}`;
  if (biegId) OCZEKUJACE.set(kluczOczekujacego, abort);
  /* Własny limit na ciszę dostawcy. Bez niego czekaliśmy do domyślnych
     300 s fetcha z migającym kursorem. Po nagłówkach ten sam zegar pilnuje
     przerw między kawałkami strumienia (pompa niżej go odnawia). */
  let cisza = false;
  let straznik = null;
  const pilnujCiszy = () => {
    clearTimeout(straznik);
    straznik = setTimeout(() => { cisza = true; abort.abort(); }, CISZA_MODELU_MS);
    if (straznik.unref) straznik.unref();
  };
  pilnujCiszy();

  let upstream;
  try {
    // Parametry pod dostawcę, poprawki po odmowie 400, ponowienia przy
    // 429/503 — wszystko w lib/model.js, wspólne z funkcjami pomocniczymi.
    const wyslij = () => zapytajModel(ep, body, {
      signal: abort.signal,
      // Pomiar płynności ma zobaczyć kapryśny model takim, jaki jest.
      ponowienia: payload.pomiar === true ? 0 : 2,
    });
    upstream = await wyslij();
    /* Zdjęcie odrzucone, a model wizyjny JEST ustawiony — jedna próba z nim,
       zamiast błędu. Nazw z Ollamy katalog nie zna, więc o ślepocie modelu
       dowiadujemy się dopiero z odmowy — a Ollama i llama.cpp odmawiają
       kodem 500, nie 400 („missing data required for image input"). */
    if (!upstream.ok && hasImages && ep.visionModel && model !== ep.visionModel
      && [400, 415, 422, 500].includes(upstream.status)) {
      const odmowa = await upstream.clone().text().catch(() => '');
      if (ODMOWA_OBRAZU.test(odmowa)) {
        upstream.body?.cancel().catch(() => {});
        swappedFrom = swappedFrom || model;
        model = ep.visionModel;
        body.model = model;
        upstream = await wyslij();
      }
    }
  } catch (err) {
    if (biegId) OCZEKUJACE.delete(kluczOczekujacego);
    clearTimeout(straznik);
    if (cisza) {
      return sendJson(res, 504, { error: `Model nie odpowiedział w ${Math.round(CISZA_MODELU_MS / 1000)} s [${ep.label} · ${model}]. `
        + (payload.endpoint === 'local'
          /* Zimny start: Ollama po przerwie ładuje model do pamięci karty —
             duży potrafi potrzebować ponad minuty. To nie awaria. */
          ? 'Jeśli to pierwsze pytanie po przerwie, lokalny model mógł właśnie ładować się do pamięci karty — spróbuj ponownie za chwilę. '
            + 'Na stałe pomaga OLLAMA_KEEP_ALIVE=24h na komputerze domowym.'
          : 'Spróbuj ponownie albo wybierz inny model.') });
    }
    // Przerwane „Stopem" przed nagłówkami — domykamy odpowiedź, żeby nie wisiała.
    if (abort.signal.aborted) { if (!res.headersSent) res.writeHead(204); return res.end(); }
    if (payload.endpoint === 'local') {
      const rodzaj = rodzajBleduPolaczenia(err);
      // Bezpiecznik tylko dla porażek, które kosztują czekanie (uśpiony, DNS) — odmowa przychodzi od razu.
      if (rodzaj === 'uspiony' || rodzaj === 'dns') lokalnyNiedostepny = { do: Date.now() + LOKALNY_BEZPIECZNIK_MS, rodzaj };
      return sendJson(res, 502, { kod: 'lokalny-niedostepny', error: komunikatLokalnego(rodzaj, ep, err) });
    }
    return sendJson(res, 502, { error: `Nie udało się połączyć z ${ep.baseUrl}: ${err.message}` });
  }

  if (biegId) OCZEKUJACE.delete(kluczOczekujacego);
  // Połączenie się udało — komputer domowy żyje, bezpiecznik zdjęty.
  if (payload.endpoint === 'local') lokalnyNiedostepny = { do: 0, rodzaj: '' };
  if (!upstream.ok) {
    clearTimeout(straznik);
    let detail = '';
    try { detail = await upstream.text(); } catch { /* ignore */ }
    let message = `Błąd modelu (HTTP ${upstream.status}).`;
    try {
      const parsed = JSON.parse(detail);
      // `message` na wierzchu — stary format vLLM ({"object":"error","message":…}); bez tego znikał.
      message = parsed?.error?.message || parsed?.error || parsed?.message || parsed?.detail || parsed?.title || message;
      if (typeof message !== 'string') message = JSON.stringify(message).slice(0, 300);
    } catch {
      if (detail) message = `${message} ${detail.slice(0, 300)}`;
    }
    // Model spoza katalogu, który jednak nie przyjmuje obrazów, poznajemy dopiero
    // po odmowie dostawcy. „Błąd modelu (HTTP 400)” nic użytkownikowi nie mówi —
    // zamieniamy to na tę samą wskazówkę, co przy modelach znanych.
    if ([400, 415, 422, 500].includes(upstream.status) && hasImages && ODMOWA_OBRAZU.test(detail)) {
      const zmienna = payload.endpoint === 'local' ? 'LOCAL_VISION_MODEL' : 'NEMOTRON_VISION_MODEL';
      return sendJson(res, 400, {
        error: ep.visionModel
          // Model wizyjny był ustawiony i to on odmówił — „ustaw model wizyjny" byłoby kpiną.
          ? `Model wizyjny „${model}" odmówił przyjęcia zdjęcia.\n\n`
            + `Sprawdź w Ustawieniach („Sprawdź"), czy ${zmienna} naprawdę widzi obrazy — `
            + `w Ollamie model wizyjny to np. qwen2.5vl albo llama3.2-vision.\n\nOdpowiedź dostawcy: ${String(detail).slice(0, 200)}`
          : `Model „${model}" odmówił przyjęcia zdjęcia.\n\n`
            + 'Wybierz w Ustawieniach model oznaczony „widzi obrazy”'
            + (['cloud', 'local'].includes(payload.endpoint || 'cloud')
              ? `, albo ustaw ${zmienna} w .env — Cosmos skieruje wtedy same zdjęcia do modelu wizyjnego, a rozmowę zostawi wybranemu`
              : '')
            + `.\n\nOdpowiedź dostawcy: ${String(detail).slice(0, 200)}`,
      });
    }
    // Bez tego widać sam komunikat dostawcy i nie wiadomo nawet, którą zakładkę
    // silnika obwiniać ani jaki identyfikator modelu poleciał w żądaniu.
    const where = `[${ep.label} · ${model}]`;
    const hint = modelErrorHint(payload.endpoint, model, upstream.status, { tresc: detail, baseUrl: ep.baseUrl });
    // Ten komunikat ląduje na ekranie, a stamtąd na zrzutach ekranu — dostawca
    // wpisuje w niego identyfikator konta, który nikomu nie jest potrzebny.
    return sendJson(res, upstream.status, { error: `${where} ${scrubSecrets(message)}${hint}` });
  }

  if (!biegId) {
    // Stara droga: zwykłe proxy bajt w bajt. Zostaje dla klientów sprzed
    // biegów i dla wywołań, którym praca w tle jest niepotrzebna.
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
      ...(przycietoTur ? { 'X-Cosmos-Okno': `${oknoLokalne};${przycietoTur}` } : {}),
    });
    try {
      for await (const chunk of upstream.body) { pilnujCiszy(); res.write(chunk); }
    } catch {
      /* klient przerwał lub upstream padł — kończymy strumień */
    }
    clearTimeout(straznik);
    return res.end();
  }

  /* Bieg. Od tej chwili odpowiedź należy do serwera: czytamy ją do końca
     niezależnie od tego, czy ktoś patrzy. Przeglądarka, która właśnie wysłała
     to żądanie, jest po prostu pierwszym widzem — takim samym jak ta, która
     podepnie się za pięć minut z telefonu. */
  const bieg = biegi_.zacznij({
    id: biegId,
    rozmowaId: typeof payload.rozmowa === 'string' ? payload.rozmowa : '',
    model,
    silnik: payload.endpoint,
    podmienionyZ: swappedFrom,
    spozaListy: modelSpozaListy,
    okno: przycietoTur ? `${oknoLokalne};${przycietoTur}` : '',
  });
  bieg.przerwij = () => abort.abort();
  biegi_.podepnij(biegId, 0, res);

  /* Świadomie BEZ `await`: trasa oddaje sterowanie, a pompa dalej przelewa
     strumień do biegu. Gdyby tu było `await`, żądanie HTTP trzymałoby bieg
     przy życiu i wróciłby dokładnie ten problem, który naprawiamy. */
  (async () => {
    const dekoder = new TextDecoder();
    let ogon = '';
    /* Czy dostawca powiedział „koniec" ([DONE] albo finish_reason). Strumień,
       który po prostu się urwał, wyglądał dotąd jak pełna odpowiedź — urwane
       zdanie lądowało w rozmowie jako gotowe. */
    let koniecWidziany = false;
    let bladDostawcy = '';
    let bylaTresc = false;
    const zjedz = (blok) => {
      if (!blok.trim()) return;
      /* Błąd po 200 szedł do przeglądarki jak zwykły blok, a ona go nie
         rozumiała — człowiek widział „połączenie się zerwało" zamiast
         „dostawca przeciążony". Teraz zamyka bieg z nazwaną przyczyną. */
      const blad = bladWStrumieniu(blok);
      if (blad) { bladDostawcy = blad; return; }
      if (/^data:\s*\[DONE\]/m.test(blok) || /"finish_reason"\s*:\s*"[a-z_]+"/.test(blok)) koniecWidziany = true;
      if (!bylaTresc && /"(content|reasoning_content|reasoning)"\s*:\s*"[^"]/.test(blok)) bylaTresc = true;
      biegi_.dopisz(bieg, blok);
    };
    // Po nagłówkach, przed pierwszą treścią: dłuższy limit dla modeli myślących po cichu.
    const czuwaj = () => {
      if (bylaTresc || !cichoMysli(ep, model)) return pilnujCiszy();
      clearTimeout(straznik);
      straznik = setTimeout(() => { cisza = true; abort.abort(); }, CISZA_MYSLENIA_MS);
      if (straznik.unref) straznik.unref();
    };
    czuwaj();
    try {
      for await (const chunk of upstream.body) {
        czuwaj();
        // llama-cpp-python i część serwerów rozdziela ramki „\r\n\r\n" —
        // bez ujednolicenia cała odpowiedź przychodziła jednym kawałkiem na końcu.
        ogon = (ogon + dekoder.decode(chunk, { stream: true })).replace(/\r\n|\r(?!$)/g, '\n');
        // Bloki SSE, nie bajty: numerowanie zdarzeń wymaga całych bloków,
        // bo po nich klient wraca („mam do 137, dawaj resztę").
        const bloki = ogon.split('\n\n');
        ogon = bloki.pop();
        for (const blok of bloki) zjedz(blok);
      }
      clearTimeout(straznik);
      zjedz(ogon.replace(/\r$/, ''));
      biegi_.zakoncz(bieg, bladDostawcy
        ? `Dostawca przerwał odpowiedź: ${scrubSecrets(bladDostawcy)}${modelErrorHint(payload.endpoint, model, 0, { tresc: bladDostawcy, baseUrl: ep.baseUrl })}`
        : koniecWidziany ? '' : 'Model urwał odpowiedź w połowie — połączenie z dostawcą się zerwało. Spróbuj ponownie.');
    } catch (err) {
      clearTimeout(straznik);
      const powod = cisza
        ? (bylaTresc || !cichoMysli(ep, model)
          ? `Model zamilkł na ${Math.round(CISZA_MODELU_MS / 1000)} s w trakcie odpowiedzi. Spróbuj ponownie.`
          : `Model myślał ponad ${Math.round(CISZA_MYSLENIA_MS / 60000)} min i nie zaczął odpowiadać. Spróbuj ponownie albo zadaj prostsze pytanie.`)
        : abort.signal.aborted ? ''
          : /terminated|socket|ECONNRESET|other side closed/i.test(err.message || '')
            ? 'Połączenie z dostawcą modelu zerwało się w trakcie odpowiedzi. Spróbuj ponownie.'
            : (err.message || 'Strumień modelu przerwany.');
      biegi_.zakoncz(bieg, powod);
    }
  })();
}

/** Sprawdź, czy model naprawdę działa NA TYM KONCIE — i czy czyta obrazy.
 *
 * `/v1/models` u NVIDII wypisuje wszystko, co NVIDIA hostuje, a nie to, do czego
 * Twój klucz ma dostęp: część pozycji kończy się „Not found for account". Tego
 * nie da się przewidzieć z nazwy — trzeba spróbować. Wysyłamy więc najtańsze
 * możliwe żądanie (jeden token), a przy teście wzroku dokładamy obrazek 1×1.
 * Odpowiedź 200 znaczy „działa”; treść nas nie interesuje.
 */
const PROBE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** Usuń z komunikatu dostawcy rzeczy, których nie chcemy nigdzie kopiować.
 *
 * NVIDIA wpisuje w odmowę identyfikator konta („Not found for account
 * 'LeJn…'"), a przycisk „Kopiuj wynik" wrzuca całość do schowka — łatwo
 * wtedy wkleić to komuś bez zastanowienia. Do zdiagnozowania problemu ten
 * ciąg nie jest potrzebny, więc go nie pokazujemy.
 */
function scrubSecrets(msg) {
  return String(msg || '')
    .replace(/(for account\s+)'[^']+'/gi, "$1'(ukryte)'")
    .replace(/\bnvapi-[A-Za-z0-9_-]+/g, 'nvapi-(ukryte)')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-(ukryte)')
    .replace(/\s+/g, ' ')
    .trim();
}

const PROBE_TIMEOUT_MS = 75000;
/* Całe sprawdzenie modelu (rozmowa + obraz, z ponowieniem) musi się zmieścić
   przed limitem Cloudflare (100 s bez odpowiedzi → strona 524). Wcześniej
   dwie sondy po 75 s z ponowieniem potrafiły trwać 300 s. */
const BUDZET_SPRAWDZENIA_MS = 88_000;

async function probeOnce(ep, model, withImage, czasMs = PROBE_TIMEOUT_MS) {
  const content = withImage
    ? [{ type: 'image_url', image_url: { url: PROBE_PNG } }, { type: 'text', text: 'hi' }]
    : 'hi';
  try {
    const r = await fetch(`${ep.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(ep),
      body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(czasMs),
    });
    if (r.ok) return { ok: true };
    let detail = '';
    try { detail = await r.text(); } catch { /* bez treści */ }
    let msg = `HTTP ${r.status}`;
    try {
      const j = JSON.parse(detail);
      msg = j?.error?.message || j?.message || j?.detail || j?.title || msg;
      if (typeof msg !== 'string') msg = JSON.stringify(msg);
    } catch { if (detail) msg = detail.slice(0, 200); }
    return { ok: false, status: r.status, error: scrubSecrets(msg) };
  } catch (e) {
    // Rozróżniamy „nie masz dostępu" od „nie zdążył odpowiedzieć" — to drugie
    // przy modelach ładowanych na żądanie znaczy zwykle tylko tyle, że model
    // wstawał z zimnego startu.
    const timeout = e.name === 'TimeoutError' || /timeout|aborted/i.test(e.message);
    return { ok: false, status: 0, timeout, error: scrubSecrets(e.message) };
  }
}

/** Sonda z jedną ponowną próbą po przekroczeniu czasu.
 *  Pierwsze żądanie do modelu, którego dostawca nie trzyma rozgrzanego,
 *  potrafi trwać dłużej niż każde następne — jedna odmowa to za mało, żeby
 *  napisać komuś „ten model nie działa". */
async function probeModel(ep, model, withImage, doKiedy = Date.now() + BUDZET_SPRAWDZENIA_MS) {
  const zostalo = () => doKiedy - Date.now();
  if (zostalo() < 3000) return { ok: false, status: 0, timeout: true, error: 'Zabrakło czasu na to sprawdzenie.' };
  const first = await probeOnce(ep, model, withImage, Math.min(PROBE_TIMEOUT_MS, zostalo()));
  if (first.ok || !first.timeout || zostalo() < 5000) return first;
  const second = await probeOnce(ep, model, withImage, Math.min(PROBE_TIMEOUT_MS, zostalo()));
  return second.timeout ? { ...second, timeout: true } : second;
}

async function handleModelCheck(req, res) {
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
  const ep = pickEndpoint(data.endpoint);
  const model = String(data.model || '').trim();
  if (!model) return sendJson(res, 400, { error: 'Brak identyfikatora modelu.' });

  // Dwie grupy, jeden wniosek: nie stawiaj ich jako modelu czatu.
  //  • Embeddingi, przeszukiwanie, OCR nie mają końcówki rozmowy i zwrócą
  //    „404 page not found" — to nie brak dostępu, tylko inne przeznaczenie,
  //    a część z nich Cosmos sam wykorzystuje (baza wiedzy).
  //  • Klasyfikatory bezpieczeństwa i tłumacze końcówkę mają i odpowiedzą
  //    poprawnie — dlatego wychodziły z testu jako sprawne modele czatu.
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
        : 'Ten model odpowie, ale rozmówcą nie jest — to klasyfikator, tłumacz '
          + 'albo model badawczy. Do czatu wybierz Nemotrona.',
      bladObrazy: null,
    });
  }

  const doKiedy = Date.now() + BUDZET_SPRAWDZENIA_MS;
  const text = await probeModel(ep, model, false, doKiedy);
  // Wzrok sprawdzamy tylko wtedy, gdy sama rozmowa działa — inaczej
  // zdublowalibyśmy ten sam błąd dostępu i niepotrzebnie obciążyli limit.
  const vision = text.ok ? await probeModel(ep, model, true, doKiedy) : { ok: false, skipped: true };

  return sendJson(res, 200, {
    model,
    silnik: ep.label,
    rozmowa: text.ok,
    obrazy: vision.ok,
    // „Nie zdążył odpowiedzieć" to nie to samo, co „nie masz dostępu”.
    niepewne: Boolean(text.timeout),
    blad: text.ok ? null : text.error,
    // Sam komunikat dostawcy nie mówi, co ma teraz zrobić człowiek przed ekranem.
    podpowiedz: text.ok ? null
      : (text.timeout
        ? 'Model nie odpowiedział na czas — u dostawcy wstaje z zimnego startu. '
          + 'Spróbuj go sprawdzić pojedynczo przyciskiem „Sprawdź”.'
        : modelErrorHint(data.endpoint, model, text.status, { tresc: text.error, baseUrl: ep.baseUrl }).trim()),
    bladObrazy: (text.ok && !vision.ok) ? vision.error : null,
  });
}

// ---------------------------------------------------------------------------
// API: lista modeli
// ---------------------------------------------------------------------------

async function handleModels(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ep = pickEndpoint(url.searchParams.get('endpoint'));
  try {
    const upstream = await fetch(`${ep.baseUrl}/models`, {
      headers: authHeaders(ep, { natywne: true }),   // /models u Claude'a to natywne API
      signal: AbortSignal.timeout(15000),
    });
    const data = await upstream.json();
    sendJson(res, upstream.status, data);
  } catch (err) {
    // „fetch failed” samo w sobie nie mówi nic. Najczęstszy powód przy modelu
    // lokalnym to wyłączona Ollama albo nasłuch tylko na 127.0.0.1 — i to
    // właśnie trzeba napisać, zamiast zostawiać użytkownika z komunikatem sieci.
    const local = ep === ENDPOINTS.local;
    if (local && !czyWlasciciel()) {
      return sendJson(res, 502, { error: 'Komputer właściciela z lokalnym modelem teraz nie odpowiada.' });
    }
    const hint = local
      ? `\n\nNajczęstsze przyczyny:\n`
        + `• Ollama nie działa na komputerze domowym — uruchom ją (\`ollama serve\` albo ikona w zasobniku).\n`
        + `• Ollama słucha tylko lokalnie — ustaw OLLAMA_HOST=0.0.0.0 i zrestartuj.\n`
        + `• Komputer domowy jest wyłączony albo poza Tailscale.\n`
        + `Sprawdź z serwera: curl ${ep.baseUrl}/models`
      : '';
    sendJson(res, 502, {
      error: `Nie udało się pobrać listy modeli z ${ep.baseUrl}: ${err.message}${hint}`,
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
studio_.polacz({ kbPliki: () => KB_FILES(), addEvent, kbAddFile, kbItemMeta, kbPozycje: () => U().kbItems, zadania: zadania_ });
// Oś czasu migawek otoczenia (Digital Time Machine) — lib/os-czasu.js.
const osCzasu_ = require('./lib/os-czasu.js').utworz({
  U, readJson, sendJson, addEvent, bladZapisu, kbAddFile, kbPliki: () => KB_FILES(), saveKb, tsName,
});
urzadzenia_.polacz({ addEvent, recentEvents, rutyny, routineView });
trening_.polacz({ addEvent, rozmowy: () => U().convIndex, convPath, profil: () => U().profile });
nauka_.polacz({
  kbPliki: () => KB_FILES(), addEvent, cosine, embedTexts, kbAddFile, keywordScore, sameModel, tsName,
  kbUsun: (id) => { U().kbItems = U().kbItems.filter((it) => it.id !== id); saveKb(); },
});

/* Trasy archiwum materiału. Sam indeks jest PASYWNY — źródła (OneDrive, dysk
   przez zmysły) wpychają wpisy, a zapytania działają, gdy te źródła są
   offline. Dlatego „ile klipów 50 mm w tym roku" odpowie z telefonu w terenie
   przy wyłączonym komputerze domowym. Całość tras: lib/archiwum-trasy.js. */
const archiwumTrasy_ = require('./lib/archiwum-trasy.js').utworz({
  archiwum, onedrive, SENSES_URL, sendJson, readJson, addEvent,
  sensesState, wspolrzedneMiejsca,
});
const handleArchiwum = (req, res, p) => archiwumTrasy_.handleArchiwum(req, res, p);

async function trasyApi(req, res, p) {
  if (!czyWlasciciel() && TYLKO_WLASCICIEL.some((w) => w.test(p))) {
    return sendJson(res, 403, { error: 'Ta funkcja jest dostępna tylko dla właściciela Cosmosa.' });
  }
  if (p.startsWith('/api/studio') && !silniki.studioDozwolone()) {
    return sendJson(res, 403, { error: 'Studio nie jest dla Ciebie włączone — poproś właściciela o dostęp.' });
  }
  /* Rozpoznawanie treści całego archiwum idzie na karcie graficznej
     właściciela i potrafi ją zająć na godziny. To ten sam zasób co „lokalny
     GPU", więc to samo uprawnienie. */
  if (p === '/api/archive/vision' && !silniki.dostep('local').ok) {
    return sendJson(res, 403, { error: 'Rozpoznawanie treści używa komputera właściciela — poproś o dostęp do lokalnego GPU.' });
  }
  if (p === '/api/konto' || p.startsWith('/api/konto/')) return await handleKonto(req, res, p);
  if (p === '/api/konta' || p.startsWith('/api/konta/')) return await handleKonta(req, res, p);


  if (p === '/api/config' && req.method === 'GET') return handleConfig(res);
  if (p === '/api/status' && req.method === 'GET') return await handleStatus(req, res);
  if (p === '/api/models' && req.method === 'GET') return await handleModels(req, res);
  if (p === '/api/models/check' && req.method === 'POST') return await handleModelCheck(req, res);
  if (p === '/api/chat' && req.method === 'POST') return await handleChat(req, res);
  /* Powrót do trwającej odpowiedzi. `od` = numer pierwszego zdarzenia,
     którego przeglądarka jeszcze nie ma — dzięki temu wznowienie po
     zerwanym Wi-Fi nie powtarza połowy zdania ani jej nie gubi. */
  if (p === '/api/chat/bieg' && req.method === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams;
    if (biegi_.podepnij(q.get('id') || '', q.get('od'), res)) return;
    return sendJson(res, 404, { error: 'Ta odpowiedź już się nie liczy — serwer jej nie pamięta.' });
  }
  // Co się teraz liczy. Przeglądarka pyta o to po odświeżeniu strony.
  if (p === '/api/chat/biegi' && req.method === 'GET') {
    return sendJson(res, 200, { biegi: biegi_.lista() });
  }
  /* „Mam tę odpowiedź i zapisałem ją u siebie." Dopiero to odwołuje zapis
     awaryjny — patrz komentarz przy `potwierdz` w lib/biegi.js. */
  if (p === '/api/chat/odebrane' && req.method === 'POST') {
    let dane = {};
    try { dane = await readJson(req); } catch { /* pusty korpus też akceptujemy */ }
    return sendJson(res, 200, { ok: biegi_.potwierdz(String(dane.bieg || '')) });
  }
  /* Przerwanie musi być ŚWIADOME. Odkąd zamknięcie karty nie przerywa
     generowania, przycisk Stop jest jedyną drogą — i musi docierać do
     serwera, bo to on trzyma połączenie z modelem. */
  if (p === '/api/chat/stop' && req.method === 'POST') {
    let dane = {};
    try { dane = await readJson(req); } catch { /* pusty korpus też akceptujemy */ }
    const id = String(dane.bieg || '');
    const b = biegi_.daj(id);
    if (b && b.przerwij) b.przerwij();
    // Bieg jeszcze się nie urodził — dostawca nie odpowiedział nagłówkami.
    const czeka = !b && OCZEKUJACE.get(`${kto().id}:${id}`);
    if (czeka) { czeka.abort(); OCZEKUJACE.delete(`${kto().id}:${id}`); }
    return sendJson(res, 200, { ok: Boolean(b || czeka) });
  }
  if (p === '/api/polish' && req.method === 'POST') return await handlePolish(req, res);
  if (p === '/api/events') return await handleEvents(req, res);
  // Kanał w drugą stronę: przeglądarka dowiaduje się o zdarzeniach zamiast
  // tylko je wysyłać. Dzięki temu „Hej, Kosmos" wykryte na komputerze
  // dociera do telefonu, a nie umiera w logu serwera.
  if (p === '/api/events/stream' && req.method === 'GET') return podlaczStrumien(req, res);
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
  if (p === '/api/conversations' || p === '/api/conversations/meta' || p === '/api/conversations/search') return await handleConversations(req, res, p);
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
      const blad = saveLocation(d.location, d.lat !== undefined ? { lat: Number(d.lat), lon: Number(d.lon) } : null);
      if (blad) return bladZapisu(res, blad);
      return sendJson(res, 200, { ok: true, location: U().location, wspolrzedne: U().wspolrzedne });
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
    const convs = U().convIndex.map((meta) => {
      try { return JSON.parse(fs.readFileSync(convPath(meta.id), 'utf8')); } catch { return null; }
    }).filter(Boolean);
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
      // Kopia to też miejsce na dysku osoby — cała naraz, zanim cokolwiek zapiszemy.
      const tresci = bundle.conversations.filter((c) => c && c.id).map((c) => JSON.stringify(c));
      await miejsce_.sprawdz(tresci.reduce((suma, t) => suma + Buffer.byteLength(t), 0));
      for (const conv of bundle.conversations) {
        if (!conv || !conv.id) continue;
        const id = String(conv.id).replace(/[^a-z0-9]/gi, '');
        try {
          zapiszAtomowo(convPath(id), JSON.stringify(conv));
          const meta = { id, title: conv.title || 'Rozmowa', createdAt: conv.createdAt || Date.now(), updatedAt: conv.updatedAt || Date.now(), pinned: conv.pinned || false };
          const i = U().convIndex.findIndex((c) => c.id === id);
          if (i >= 0) U().convIndex[i] = meta; else U().convIndex.push(meta);
          restored++;
        } catch (err) { blad = blad || err; }
      }
      sortConvIndex();
      blad = saveConvIndex() || blad;
    }
    if (Array.isArray(bundle.memories)) blad = pamiec_.ustawListe(bundle.memories) || blad;
    if (typeof bundle.profile === 'string') blad = saveProfile(bundle.profile) || blad;
    if (blad) {
      // Część weszła, część nie — człowiek ma wiedzieć, że kopia NIE jest cała.
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
  if (p === '/api/briefing' && req.method === 'GET') return await handleBriefing(req, res);
  if (p === '/api/capabilities' && req.method === 'GET') {
    const m = await capabilityManifest();
    return sendJson(res, 200, { manifest: m, opis: capabilityText(m) });
  }
  if (p === '/api/suggest' && req.method === 'POST') return await handleSuggest(req, res);
  if (p === '/api/improvements') return await handleImprovements(req, res, p);
  if (p === '/api/routines' || p === '/api/routines/due') return await handleRoutines(req, res, p);
  if (p.startsWith('/api/kb')) return await handleKb(req, res, p);
  if (p.startsWith('/api/studio')) return await handleStudio(req, res, p);
  if (p === '/api/zadania' && req.method === 'GET') return zadania_.obsluzStan(req, res);
  if (p === '/api/stt' && req.method === 'POST') return await glos.handleStt(req, res);
  if (p === '/api/tts' && req.method === 'POST') return await glos.handleTts(req, res);
  // Zmysły przez pośrednika: ptak (BirdNET), wykrywanie, poza, Kinect — lib/zmysly-proxy.js.
  if (p === '/api/ptak' || p === '/api/detect' || p === '/api/pose' || p.startsWith('/api/kinect/')) {
    return await zmysly_.handleZmysly(req, res, p);
  }
  return sendJson(res, 404, { error: 'Nie ma takiej trasy.' });
}

/* HSTS tylko za HTTPS — to samo ustawienie, które każe ciastku jechać wyłącznie
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
       logowania z SWOIMI danymi — Twoja przeglądarka zostawała zalogowana
       na obce konto i Twoje rozmowy trafiały do niego („login CSRF"). */
    if ((p === '/api/login' || p === '/api/logout' || p === '/api/zaproszenie') && obcePochodzenie(req)) {
      return sendJson(res, 403, { error: 'Żądanie z innej strony — odrzucone.' });
    }
    if (p === '/api/auth' && req.method === 'GET') {
      const u = ktoPyta(req);
      return sendJson(res, 200, { required: authEnabled(), authed: Boolean(u), uzytkownik: u });
    }
    if (p === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if (p === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
    if (p === '/api/zaproszenie') return await handleZaproszenie(req, res);

    const u = ktoPyta(req);
    if (!u) return sendJson(res, 401, { error: 'Wymagane logowanie.' });
    if (obcePochodzenie(req)) return sendJson(res, 403, { error: 'Żądanie z innej strony — odrzucone.' });

    /* Od tego miejsca wszystko dzieje się W IMIENIU tej osoby: dane, zdarzenia,
       praca w tle. Kontekst podąża za każdym `await` (lib/kontekst.js). */
    return await wKontekscie(u, () => trasyApi(req, res, p));
  } catch (err) {
    // Pełny dysk i limit osoby → 507 z wyjaśnieniem; reszta → 500 (lib/miejsce.js).
    if (!res.headersSent) { const { kod, error } = miejsce_.bladDlaCzlowieka(err); sendJson(res, kod, { error }); }
    else res.end();
  }
});

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
      console.log(`             klucz API: ${ENDPOINTS.cloud.apiKey ? 'ustawiony' : 'BRAK — ustaw NVIDIA_API_KEY w .env'}`);
      console.log(`  → Lokalny: ${ENDPOINTS.local.baseUrl}  (model: ${ENDPOINTS.local.model || 'nie ustawiono'})`);
      console.log(`  → Zmysły:  ${SENSES_URL}  (uruchom: python senses/service.py)`);
      /* Liczby właściciela liczymy w JEGO imieniu — poza kontekstem nie ma
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
      console.log(`  → Logowanie: ${authEnabled() ? `WŁĄCZONE — kont: ${ileKont}, login właściciela: ${wlasciciel.login}` : 'wyłączone (tryb domowy/localhost)'}`);
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
      resolve(server);
    }));
  });
}

/* Zapis indeksu PRZED zamknięciem. Zapis archiwum jest odkładany w czasie,
   a odstęp dobiera się do jego kosztu — przy 28 MB to kilkanaście sekund.
   Bez tego `systemctl restart` w środku indeksowania albo rozpoznawania
   treści wyrzucałby do kosza całą pracę od ostatniego zapisu. Timer zapisu
   jest `unref`-owany, więc sam z siebie przy wyjściu nie zdąży. */
/* Restart w trakcie odpowiedzi kasował ją w całości: proces kończył się
   w 10 ms, bieg znikał, a rozmowa zostawała z samym pytaniem. Teraz serwer
   przestaje przyjmować nowe połączenia, daje trwającym odpowiedziom do 20 s
   na dokończenie (systemd czeka 30 s — TimeoutStopSec), a resztę zapisuje
   w rozmowach tak, jak ją zastał. Drugi sygnał (Ctrl+C dwa razy) — od razu. */
const CZAS_NA_DOKONCZENIE_MS = Number(process.env.COSMOS_CZAS_NA_DOKONCZENIE_MS) || 20_000;
let zamykanie = false;

function zamknijPorzadnie(sygnal) {
  process.on(sygnal, () => {
    if (zamykanie) process.exit(0);
    zamykanie = true;
    // Liczniki wiadomości i „ostatnio widziany" zapisują się z opóźnieniem (lib/konta.js).
    konta.zapiszZalegle();
    server.close();
    const koniec = Date.now() + CZAS_NA_DOKONCZENIE_MS;
    const dokonczone = async () => {
      if (biegi_.aktywne()) console.log(`  Zamykanie: czekam na ${biegi_.aktywne()} trwające odpowiedzi (do ${CZAS_NA_DOKONCZENIE_MS / 1000} s)…`);
      while (biegi_.aktywne() && Date.now() < koniec) await new Promise((r) => setTimeout(r, 250));
      biegi_.zapiszWszystkoTeraz('Serwer uruchamiał się ponownie i przerwał odpowiedź w tym miejscu. Zapytaj jeszcze raz, żeby dostać całość.');
    };
    dokonczone().then(() => {
      /* Każda osoba ma własne archiwum i własną bazę wiedzy — zapisujemy to,
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

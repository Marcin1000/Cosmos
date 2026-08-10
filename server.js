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
const { spawn } = require('node:child_process');
// Katalog modeli współdzielony z przeglądarką — jedno miejsce wiedzy o tym,
// który model widzi obrazy. Plik eksportuje się i dla okna, i dla Node.
const { modelInfo, modelNotForChat, modelNotAChatPartner, modelToolLevel } = require('./public/models.js');

/* Rdzeń: konfiguracja, silniki, ścieżki i cztery pomocnicze, bez których nie
   da się obsłużyć żądania. Zależność idzie tylko w jedną stronę — rdzeń nie
   wie nic o rozmowach, zmysłach ani o Studiu. */
const {
  KORZEN, PORT, PUBLIC_DIR, DATA_DIR, ENDPOINTS, STUDIO, SENSES_URL, SEARCH_URL, SECRETS,
  loadDotEnv, sendJson, readBodyBuffer, readJson, pickEndpoint,
  modelErrorHint, authHeaders, saveJsonFile, zapiszAtomowo, genId, fireflyEnabled, imageProviders, studioTasks,
} = require('./lib/rdzen.js');
const szukanie_ = require('./lib/szukanie.js');
const { handleSearch, handleSearchImages, handleImageProxy, stripTags } = szukanie_;
const { czytajLokalnie, OBSLUGIWANE: DOK_OBSLUGIWANE } = require('./lib/dokumenty.js');
const { uruchomKod, WLACZONE: KOD_WLACZONY } = require('./lib/kod.js');
const { swiatloDnia, zaIleMinut } = require('./lib/slonce.js');
const { SPRZET, OBIEKTYWY, evZeSlonca, dobierz, evZPomiaru, orientacja,
  rozpoznajObiektywy } = require('./lib/ekspozycja.js');
const { pogodaDla } = require('./lib/pogoda.js');
const { wspolrzedneMiejsca } = require('./lib/miejsca.js');
const { prognozaZorzy } = require('./lib/zorza.js');
const { rozpoznajTemat } = require('./lib/tematy.js');
const { planUjec, optykaDrona } = require('./lib/ujecia.js');
const canon = require('./lib/canon.js');
const { misjaKmz, siatka } = require('./lib/kmz.js');
const archiwum_ = require('./lib/archiwum.js');
const archiwum = archiwum_.utworz(DATA_DIR);
const onedrive_ = require('./lib/onedrive.js');
const onedrive = onedrive_.utworz({
  katalogDanych: DATA_DIR,
  clientId: process.env.ONEDRIVE_CLIENT_ID || '',
  clientSecret: process.env.ONEDRIVE_CLIENT_SECRET || '',
  redirectUri: process.env.ONEDRIVE_REDIRECT_URI || '',
});
const trening_ = require('./lib/trening.js');
const { addEvent, recentEvents, sceneContext, podlaczStrumien, iluSluchaczy,
  ileZdarzen } = require('./lib/zdarzenia.js');
const { TRAIN_DIR, TRAIN_SCRIPT, buildTrainingDataset, commandExists, startTraining, trainJob, trainLog, trainStatusView } = trening_;
const urzadzenia_ = require('./lib/urzadzenia.js');
const { BRIEFING, handleBriefing, handleDevices, urzadzenia } = urzadzenia_;
const nauka_ = require('./lib/nauka.js');
const { handleAutomation, handleLessons, handleProcedures, handleRoutines,
  routineView, sanitizeStep, saveProcedures, secretsEnabled,
  startScheduler, wzorce, procedury, rutyny, dodajProcedure } = nauka_;
const studio_ = require('./lib/studio.js');
const { handleStudio, tsName } = studio_;
const { llmComplete, parseModelResponse, blindToImages } = require('./lib/model.js');
/* Studio potrzebuje bazy wiedzy i dziennika zdarzeń, ale nie odwrotnie.
   Podajemy mu je raz, po zdefiniowaniu obu stron — krzyżowe `require`
   dałoby cykliczną zależność i jedna ze stron widziałaby pusty obiekt. */

// Uwierzytelnianie (konieczne przy wystawieniu na VPS/publicznie).
//   COSMOS_PASSWORD    — hasło do logowania w przeglądarce.
//   COSMOS_API_TOKEN   — stały token dla klientów programowych (MCP, skrypty).
// Gdy żadne nie jest ustawione, auth jest wyłączone (tryb domowy/localhost)
// i zachowuje się jak dotychczas.
// ---------------------------------------------------------------------------

const AUTH = {
  password: process.env.COSMOS_PASSWORD || '',
  apiToken: process.env.COSMOS_API_TOKEN || '',
  cookieSecure: process.env.COSMOS_COOKIE_SECURE === '1', // ustaw przy publicznym HTTPS
};

const sessions = new Set(); // aktywne tokeny sesji (w pamięci)

function authEnabled() {
  return Boolean(AUTH.password || AUTH.apiToken);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function isAuthed(req) {
  if (!authEnabled()) return true;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (bearer) {
    if (AUTH.apiToken && safeEqual(bearer, AUTH.apiToken)) return true;
    if (sessions.has(bearer)) return true;
  }
  const cookie = parseCookies(req).cosmos_auth;
  if (cookie && sessions.has(cookie)) return true;
  return false;
}

async function handleLogin(req, res) {
  let data;
  try { data = JSON.parse((await readBodyBuffer(req)).toString('utf8')); }
  catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
  if (!AUTH.password || !safeEqual(String(data.password || ''), AUTH.password)) {
    return sendJson(res, 401, { error: 'Nieprawidłowe hasło.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.add(token);
  const cookie = `cosmos_auth=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}` +
    (AUTH.cookieSecure ? '; Secure' : '');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie });
  res.end(JSON.stringify({ ok: true, token }));
}

function handleLogout(req, res) {
  const token = parseCookies(req).cosmos_auth;
  if (token) sessions.delete(token);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': 'cosmos_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
  });
  res.end('{"ok":true}');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};


// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Pamięć długotrwała (RAG) — całość w lib/pamiec.js.
// Tutaj tylko spięcie zależności i cienkie przejścia dla reszty pliku.
// ---------------------------------------------------------------------------
const pamiec_ = require('./lib/pamiec.js').utworz({
  katalogDanych: DATA_DIR,
  sensesUrl: SENSES_URL,
  chmura: () => ENDPOINTS.cloud,
  sendJson,
  readJson,
});
const handleMemory = (req, res) => pamiec_.handleMemory(req, res);
const searchMemory = (q, limit) => pamiec_.searchMemory(q, limit);
const memoryContextLines = (items) => pamiec_.memoryContextLines(items);
const embedTexts = (texts, timeoutMs, inputType) => pamiec_.embedTexts(texts, timeoutMs, inputType);
const embedStatus = (sensesHasEmbed) => pamiec_.embedStatus(sensesHasEmbed);
const { cosine, sameModel, keywordScore } = pamiec_;

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

const CONV_DIR = path.join(DATA_DIR, 'conversations');
const CONV_INDEX = path.join(CONV_DIR, 'index.json');

let convIndex = [];
try { convIndex = JSON.parse(fs.readFileSync(CONV_INDEX, 'utf8')); } catch { /* brak pliku */ }

function saveConvIndex() {
  try {
    zapiszAtomowo(CONV_INDEX, JSON.stringify(convIndex));
  } catch (err) {
    console.error('Nie udało się zapisać indeksu rozmów:', err.message);
  }
}

// Sanityzacja ID → tylko nasz alfabet uid; blokuje path traversal.
function convPath(id) {
  return path.join(CONV_DIR, `${String(id).replace(/[^a-z0-9]/gi, '')}.json`);
}

function sortConvIndex() {
  // przypięte na górze, potem wg czasu modyfikacji
  convIndex.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
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
  const meta = convIndex.find((c) => c.id === id);
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
  for (const meta of convIndex) {
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

/* SPRZĘT użytkownika — domyślny zestaw do planu zdjęciowego.
 *
 * Osobno od profilu, bo profil jest wolnym tekstem DLA MODELU, a to są dane
 * DLA NARZĘDZIA: z nich liczy się przysłona i ogniskowa. Marcin podał swój
 * zestaw raz („24-105 f/4, 70-200 f/4, 50 f/1.8") i nie ma powodu, żeby
 * wpisywał go przy każdym pytaniu — a model nie ma powodu go zgadywać.
 *
 * Podanie obiektywu w rozmowie ZAWSZE wygrywa z tym zapisem: sprzęt bywa
 * pożyczony, a jedno zdanie w czacie jest świeższe niż ustawienie sprzed
 * miesiąca.
 */
const SPRZET_FILE = path.join(DATA_DIR, 'sprzet.json');
let userSprzet = { korpus: '', obiektywy: '', dodatki: '' };
try { userSprzet = { ...userSprzet, ...JSON.parse(fs.readFileSync(SPRZET_FILE, 'utf8')) }; }
catch { /* brak — panel Ustawień pozwoli uzupełnić */ }
function saveSprzet(dane) {
  userSprzet = {
    korpus: String((dane && dane.korpus) || '').slice(0, 120),
    obiektywy: String((dane && dane.obiektywy) || '').slice(0, 400),
    /* Dron, gimbal, statyw, slider. Osobne pole, bo to NIE jest optyka —
       nie wpływa na ekspozycję, ale przesądza, których ujęć da się w ogóle
       nakręcić. Wpisywane jak człowiek mówi: „Mavic 3, Ronin-S, statyw". */
    dodatki: String((dane && dane.dodatki) || '').slice(0, 300),
  };
  try {
    zapiszAtomowo(SPRZET_FILE, JSON.stringify(userSprzet));
  } catch (err) { console.error('Nie udało się zapisać sprzętu:', err.message); }
}

// Profil użytkownika — trwały tekst wstrzykiwany do każdej rozmowy (pamięć profilowa).
const PROFILE_FILE = path.join(DATA_DIR, 'profile.txt');
let userProfile = '';
try { userProfile = fs.readFileSync(PROFILE_FILE, 'utf8'); } catch { /* brak */ }
function saveProfile(text) {
  userProfile = String(text || '').slice(0, 4000);
  try { zapiszAtomowo(PROFILE_FILE, userProfile); }
  catch (err) { console.error('Nie udało się zapisać profilu:', err.message); }
}

/* Lokalizacja domowa — osobno od profilu, bo używa jej nie tylko rozmowa,
   ale i wyszukiwanie („warsztat … w Złotokłosie"). Bez niej model pyta
   „w jakim mieście jesteś?" przy każdym pytaniu o cokolwiek w okolicy. */
const LOCATION_FILE = path.join(DATA_DIR, 'location.txt');
const WSPOLRZEDNE_FILE = path.join(DATA_DIR, 'location.json');
let userLocation = '';
/* Sama nazwa miejsca wystarczała do wyszukiwania, ale nie do liczenia pozycji
   Słońca — złota godzina wymaga stopni, nie napisu „Złotokłos". Trzymamy
   jedno i drugie: nazwę dla modelu, współrzędne dla matematyki. */
let userWspolrzedne = null;
try { userLocation = fs.readFileSync(LOCATION_FILE, 'utf8'); } catch { /* brak */ }
try { userWspolrzedne = JSON.parse(fs.readFileSync(WSPOLRZEDNE_FILE, 'utf8')); } catch { /* brak */ }
// Zapas z odprawy porannej — kto ustawił BRIEFING_LAT, nie musi robić tego drugi raz.
if (!userWspolrzedne && BRIEFING.lat && BRIEFING.lon) {
  userWspolrzedne = { lat: Number(BRIEFING.lat), lon: Number(BRIEFING.lon) };
}
/* Archiwum potrzebuje domu do liczenia pory światła dla zdjęć bez GPS-u.
   Ustawiamy TU, a nie przy tworzeniu indeksu: `userWspolrzedne` deklarowane
   jest niżej niż `archiwum`, więc wcześniejsze odwołanie trafiało w martwą
   strefę czasową i serwer w ogóle nie wstawał. */
if (userWspolrzedne) archiwum.ustawDom(userWspolrzedne);

function saveLocation(text, wspolrzedne) {
  userLocation = String(text || '').trim().slice(0, 200);
  try { zapiszAtomowo(LOCATION_FILE, userLocation); }
  catch (err) { console.error('Nie udało się zapisać lokalizacji:', err.message); }
  if (wspolrzedne && Number.isFinite(wspolrzedne.lat) && Number.isFinite(wspolrzedne.lon)) {
    userWspolrzedne = { lat: wspolrzedne.lat, lon: wspolrzedne.lon };
    try { zapiszAtomowo(WSPOLRZEDNE_FILE, JSON.stringify(userWspolrzedne)); }
    catch (err) { console.error('Nie udalo sie zapisac wspolrzednych:', err.message); }
    /* Archiwum liczy pore swiatla dla zdjec bez GPS-u wzgledem domu, wiec
       zmiana lokalizacji musi je przeliczyc - inaczej wpisy dodane wczesniej
       zostaja z `null` mimo ze jest juz z czego je policzyc. */
    if (typeof archiwum !== 'undefined') {
      archiwum.ustawDom(userWspolrzedne);
      const ile = archiwum.przeliczSwiatlo();
      if (ile) addEvent('archiwum', `przeliczono pore swiatla dla ${ile} plikow`);
    }
  }
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
   a do wyszukiwarki trzeba wpisać „Złotokłos". Zamiana idzie przez serwer,
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
    const r = await fetch(url, { signal: stoper, headers: { 'User-Agent': 'Cosmos/1.0 (prywatny asystent)' } });
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
    saveLocation(nazwa, { lat, lon });
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
    const entry = convIndex.find((c) => c.id === id);
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
    saveConvIndex();
    return sendJson(res, 200, { ok: true, meta: entry });
  }

  if (pathname === '/api/conversations/search' && req.method === 'GET') {
    const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
    return sendJson(res, 200, { results: searchConversationsContent(q) });
  }

  if (req.method === 'GET' && !id) {
    return sendJson(res, 200, { conversations: convIndex });
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
    conv.id = id;
    conv.updatedAt = Date.now();
    if (!conv.createdAt) conv.createdAt = conv.updatedAt;
    try {
      zapiszAtomowo(convPath(id), JSON.stringify(conv));
    } catch (err) {
      return sendJson(res, 500, { error: `Zapis rozmowy nie powiódł się: ${err.message}` });
    }
    const prev = convIndex.find((c) => c.id === id);
    const meta = {
      id,
      title: conv.title || 'Rozmowa',
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      pinned: (typeof conv.pinned === 'boolean' ? conv.pinned : prev?.pinned) || false,
    };
    const i = convIndex.findIndex((c) => c.id === id);
    if (i >= 0) convIndex[i] = meta; else convIndex.push(meta);
    sortConvIndex();
    saveConvIndex();
    return sendJson(res, 200, { ok: true, meta });
  }
  if (req.method === 'DELETE' && id) {
    convIndex = convIndex.filter((c) => c.id !== id);
    saveConvIndex();
    try { fs.unlinkSync(convPath(id)); } catch { /* już nie ma */ }
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405);
  res.end();
}

const KB_DIR = path.join(DATA_DIR, 'kb');
const KB_FILES = path.join(KB_DIR, 'files');
const KB_INDEX = path.join(KB_DIR, 'index.json');

let kbItems = [];
try { kbItems = JSON.parse(fs.readFileSync(KB_INDEX, 'utf8')); } catch { /* brak pliku */ }

function saveKb() {
  try {
    fs.mkdirSync(KB_FILES, { recursive: true });
    zapiszAtomowo(KB_INDEX, JSON.stringify(kbItems));
  } catch (err) {
    console.error('Nie udało się zapisać bazy wiedzy:', err.message);
  }
}

const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'js', 'ts', 'py',
  'html', 'htm', 'css', 'xml', 'yaml', 'yml', 'log', 'ini', 'sh', 'bat', 'sql']);
const OFFICE_EXTS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods']);
const AV_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov', 'mkv', 'avi']);

function extOf(name) {
  return (String(name).split('.').pop() || '').toLowerCase();
}

async function sensesExtract(name, buf) {
  try {
    const r = await fetch(`${SENSES_URL}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: buf.toString('base64') }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) return '';
    return (await r.json()).text || '';
  } catch { return ''; }
}

async function sensesTranscribe(buf, mime) {
  try {
    const r = await fetch(`${SENSES_URL}/stt`, {
      method: 'POST',
      headers: { 'Content-Type': mime || 'application/octet-stream' },
      body: buf,
      signal: AbortSignal.timeout(600000),
    });
    if (!r.ok) return '';
    return (await r.json()).text || '';
  } catch { return ''; }
}

async function sensesDetectSummary(buf, mime) {
  try {
    const r = await fetch(`${SENSES_URL}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: `data:${mime};base64,${buf.toString('base64')}` }),
      signal: AbortSignal.timeout(60000),
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
  const tekst = (await extractKbText(nazwa, req.headers['content-type'] || '', buf)) || '';
  if (!tekst.trim()) {
    return sendJson(res, 200, {
      name: nazwa, chars: 0, text: '',
      error: ext === 'pdf'
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

/* OneDrive: logowanie i indeksowanie. Cały przepływ OAuth siedzi tutaj,
   bo wymaga tras HTTP; sama rozmowa z Microsoftem jest w lib/onedrive.js. */
let indeksowanie = null;      // { przejrzanych, dodanych, trwa, blad, sygnal }

async function handleOneDrive(req, res, p) {
  if (p === '/api/onedrive/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      skonfigurowany: onedrive.skonfigurowany(),
      polaczony: onedrive.polaczony(),
      polaczenie: onedrive.stanPolaczenia(),
      redirectUri: process.env.ONEDRIVE_REDIRECT_URI || null,
      indeksowanie: indeksowanie
        ? { trwa: indeksowanie.trwa, przejrzanych: indeksowanie.przejrzanych,
            dodanych: indeksowanie.dodanych, blad: indeksowanie.blad }
        : null,
      wArchiwum: archiwum.ile(),
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
    if (indeksowanie && indeksowanie.trwa) {
      return sendJson(res, 409, { error: 'Indeksowanie już trwa.', stan: indeksowanie });
    }
    let d = {};
    try { d = await readJson(req); } catch { /* bez parametrów też można */ }
    indeksowanie = { trwa: true, przejrzanych: 0, dodanych: 0, blad: null, sygnal: { przerwane: false } };
    /* Indeksowanie idzie W TLE i nie blokuje odpowiedzi: przy 2 TB trwa
       kilkanaście minut, a przeglądarka zerwałaby połączenie po minucie. */
    (async () => {
      try {
        await onedrive.indeksuj(async (paczka) => {
          archiwum.dodaj(paczka);
          indeksowanie.dodanych += paczka.length;
        }, { folder: d.folder || '', limit: Number(d.limit) || 100000, sygnal: indeksowanie.sygnal });
        addEvent('archiwum', `OneDrive: zindeksowano ${indeksowanie.dodanych} plików`);
      } catch (err) {
        indeksowanie.blad = err.message;
        console.error('Indeksowanie OneDrive:', err.message);
      } finally {
        indeksowanie.trwa = false;
        archiwum.zapisz();
      }
    })();
    return sendJson(res, 202, { ruszylo: true });
  }

  if (p === '/api/onedrive/index' && req.method === 'DELETE') {
    if (indeksowanie) indeksowanie.sygnal.przerwane = true;
    return sendJson(res, 200, { przerwano: true });
  }

  if (p === '/api/onedrive/disconnect' && req.method === 'POST') {
    onedrive.rozlacz();
    const usuniete = archiwum.usunZrodlo('onedrive');
    addEvent('archiwum', `odłączono OneDrive (usunięto ${usuniete} wpisów)`);
    return sendJson(res, 200, { ok: true, usunieto: usuniete });
  }

  return sendJson(res, 404, { error: 'Nieznana trasa OneDrive.' });
}

const oczekiwaneStany = new Set();
const escapeHtmlSerwer = (s) => String(s || '').replace(/[&<>"]/g,
  (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[z]));

/* Asystent planu zdjęciowego — to, czego nie ma żaden asystent w chmurze.
   ChatGPT nie wie, gdzie stoisz, która jest u Ciebie godzina ani jaki masz
   sprzęt. Cosmos wie wszystko troje, więc może policzyć konkretne nastawy
   zamiast opowiadać ogólniki o „złotej godzinie". */

async function handlePlanZdjeciowy(req, res) {
  let d;
  try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }

  /* Współrzędne: z żądania (telefon w terenie) albo zapisane w Ustawieniach.
     `Number(null)` to ZERO, nie NaN — pierwsza wersja przy braku lokalizacji
     liczyła więc światło dla punktu 0°N 0°E na Atlantyku i oddawała to jako
     poprawną odpowiedź. Stąd jawne sprawdzenie „czy w ogóle jest wartość". */
  /* Nazwa miejsca ma pierwszeństwo przed zapisaną lokalizacją, bo znaczy
     „planuję zdjęcia TAM", a nie „stoję tutaj". Kiedyś takiego parametru nie
     było wcale: na „w sobotę kręcę w Krakowie" model musiał zgadnąć
     współrzędne z pamięci albo zignorować miejsce — a złota godzina policzona
     dla złego punktu wygląda tak samo wiarygodnie jak dla dobrego. */
  let zNazwy = null;
  let miejsceNieznane = '';
  if (d.miejsce && !(Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon)))) {
    zNazwy = await wspolrzedneMiejsca(String(d.miejsce));
    if (!zNazwy) miejsceNieznane = String(d.miejsce).slice(0, 80);
  }

  const zapis = userWspolrzedne || {};
  const surowyLat = d.lat ?? (zNazwy && zNazwy.lat) ?? zapis.lat;
  const surowyLon = d.lon ?? (zNazwy && zNazwy.lon) ?? zapis.lon;
  const lat = surowyLat === null || surowyLat === undefined ? NaN : Number(surowyLat);
  const lon = surowyLon === null || surowyLon === undefined ? NaN : Number(surowyLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return sendJson(res, 400, {
      error: miejsceNieznane
        ? `Nie udało się ustalić współrzędnych miejsca „${miejsceNieznane}". `
          + 'Podaj je dokładniej (np. „Kraków, Polska") albo wprost jako lat i lon.'
        /* Komunikat musi podać drogę, którą da się przejść STĄD. „Podaj lat
           i lon w żądaniu" to instrukcja dla programisty, a nie dla człowieka
           patrzącego na panel — a tuż nad tym napisem jest pole „Miejsce",
           w które wystarczy wpisać nazwę. */
        : 'Nie znam Twoich współrzędnych. Wpisz nazwę miejsca w polu „Miejsce" '
          + '(Plener → Plan zdjęciowy) albo ustaw lokalizację na stałe '
          + 'w Ustawieniach przyciskiem „📍 Wykryj".',
    });
  }

  const kiedy = d.kiedy ? new Date(d.kiedy) : new Date();
  if (Number.isNaN(kiedy.getTime())) return sendJson(res, 400, { error: 'Zła data.' });

  const swiatlo = swiatloDnia(kiedy, lat, lon);

  /* Zachmurzenie: z prognozy, chyba że użytkownik wybrał je ręcznie w panelu.
     Ręczny wybór wygrywa — stoisz na miejscu i widzisz niebo lepiej niż
     model pogodowy dla kwadratu kilometra. */
  /* Pogoda i zorza lecą RÓWNOLEGLE i obie są tylko dodatkiem — żadna nie może
     wstrzymać planu. Zorzy nie pytamy w biały dzień: przy Słońcu wysoko nad
     horyzontem odpowiedź jest znana z góry i byłoby to marnowanie sekundy. */
  const ciemnoBedzie = swiatlo.teraz.wysokosc < 6;
  const [pogoda, zorza] = await Promise.all([
    d.zachmurzenie ? Promise.resolve(null) : pogodaDla(lat, lon, kiedy),
    ciemnoBedzie ? prognozaZorzy(lat, lon).catch(() => null) : Promise.resolve(null),
  ]);
  const zachmurzenie = d.zachmurzenie || (pogoda && pogoda.zachmurzenie) || 'bezchmurnie';

  /* EV liczymy ze Słońca, a gdy przeglądarka zmierzyła jasność podglądu —
     korygujemy pomiarem. Model nie wie, czy stoisz w cieniu budynku. */
  let ev = evZeSlonca(swiatlo.teraz.wysokosc, zachmurzenie);
  let zrodloEv = 'pozycja Słońca';
  if (Number.isFinite(Number(d.jasnosc))) {
    const zmierzony = evZPomiaru(Number(d.jasnosc), d.pomiar || {});
    // Ufamy pomiarowi, ale nie bezgranicznie: telefon potrafi się pomylić
    // przy mocnym kontraście, więc bierzemy średnią ważoną.
    ev = ev * 0.4 + zmierzony * 0.6;
    zrodloEv = 'pomiar z kamery + pozycja Słońca';
  }

  /* Obiektywy przychodzą tak, jak je człowiek napisał („24-70 f/2.8 i 70-200 f/4”),
     bo wpisuje je Marcin w rozmowie, a nie formularz. Rozbiciem zajmuje się
     `rozpoznajObiektywy`; gdy nic nie da się odczytać, `dobierz` po prostu
     liczy jak dawniej — dla korpusu. */
  /* Gdy w pytaniu nie padł żaden obiektyw, bierzemy zestaw zapisany
     w Plenerze. Podanie szkła wprost zawsze wygrywa. */
  const zPytania = Array.isArray(d.obiektyw)
    ? d.obiektyw.flatMap((x) => rozpoznajObiektywy(String(x)))
    : rozpoznajObiektywy(d.obiektyw || '');
  const zUstawien = zPytania.length ? [] : rozpoznajObiektywy(userSprzet.obiektywy || '');
  const szkla = zPytania.length ? zPytania : zUstawien;
  const nieRozpoznane = (d.obiektyw && !zPytania.length) ? String(d.obiektyw).slice(0, 120) : '';

  const ustawienia = dobierz(ev, {
    sprzet: d.sprzet || userSprzet.korpus || undefined, tryb: d.tryb, klatki: d.klatki,
    ogniskowa: d.ogniskowa, ruch: d.ruch, glebia: d.glebia,
    obiektyw: szkla, temat: d.temat,
  });
  if (nieRozpoznane) {
    ustawienia.powody.unshift(`Nie odczytałem obiektywu z „${nieRozpoznane}" — policzyłem dla samego `
      + 'korpusu. Podaj ogniskową i jasność, np. „24-70 f/2.8", a policzę dla tego szkła.');
  }

  /* LISTA UJĘĆ — tylko przy wideo, bo tylko tam ma sens. Przy zdjęciu pytanie
     brzmi „jakie nastawy", a przy filmie „co w ogóle nakręcić, żeby dało się
     to potem zmontować" — i to jest pytanie, na które nikt nie odpowiada
     liczbami. Lista jest przefiltrowana przez SPRZĘT: bez drona nie ma ujęć
     z góry, a POMINIĘTE oddajemy osobno, bo „nie ma na liście" i „nie masz
     czym" to dla planującego dzień dwie różne informacje. */
  const ujecia = d.tryb === 'zdjecie' ? null : planUjec({
    temat: (rozpoznajTemat(d.temat || '') || {}).klucz,
    obiektywy: szkla,
    /* Optyka drona osobno od obiektywów korpusu. Bez tego kadr z Mavica
       dostawał szkło od Canona — rada oparta na sprzęcie, którego nie da
       się zamontować, podważa całą resztę listy. */
    optykaDrona: optykaDrona(sprzetTekst(d)),
    dron: /dron|mavic|dji|air\s?\d|mini\s?\d/i.test(sprzetTekst(d)),
    gimbal: /gimbal|ronin|crane|osmo|ibis|stabiliz/i.test(sprzetTekst(d)),
    statyw: !/bez statyw/i.test(sprzetTekst(d)),
    slider: /slider|wózek|dolly/i.test(sprzetTekst(d)),
  });

  const kadr = orientacja(Number(d.szerokosc), Number(d.wysokosc));
  const czas = (x) => (x ? x.toISOString() : null);

  if (miejsceNieznane) {
    ustawienia.powody.unshift(`Nie znalazłem miejsca „${miejsceNieznane}" — policzyłem dla `
      + 'zapisanej lokalizacji. Podaj nazwę dokładniej albo współrzędne.');
  }

  sendJson(res, 200, {
    // Gdy liczymy dla PODANEGO miejsca, to jego nazwa jest tu istotna —
    // inaczej odpowiedź mówiłaby o domu, a liczby dotyczyły Krakowa.
    miejsce: (zNazwy && zNazwy.nazwa) || userLocation || null,
    miejsceZNazwy: Boolean(zNazwy),
    wspolrzedne: { lat, lon },
    slonce: {
      wysokosc: swiatlo.teraz.wysokosc,
      azymut: swiatlo.teraz.azymut,
      faza: swiatlo.faza,
      wschod: czas(swiatlo.wschod),
      zachod: czas(swiatlo.zachod),
      zlotaRano: swiatlo.zlotaRano && { od: czas(swiatlo.zlotaRano.od), do: czas(swiatlo.zlotaRano.do) },
      zlotaWieczor: swiatlo.zlotaWieczor && { od: czas(swiatlo.zlotaWieczor.od), do: czas(swiatlo.zlotaWieczor.do) },
      niebieskaWieczor: swiatlo.niebieskaWieczor
        && { od: czas(swiatlo.niebieskaWieczor.od), do: czas(swiatlo.niebieskaWieczor.do) },
      // Ile zostało realnego czasu na ujęcie — to jest liczba, na którą się patrzy.
      doZlotejMin: zaIleMinut(swiatlo.zlotaWieczor && swiatlo.zlotaWieczor.od, kiedy),
      doZachoduMin: zaIleMinut(swiatlo.zachod, kiedy),
    },
    kadr,
    zrodloEv,
    pogoda,
    zorza,
    zachmurzenie,
    ustawienia,
    ujecia,
  });
}

/* Wszystko, co użytkownik napisał o sprzęcie, w jednym worku — dodatki
 * (dron, gimbal, statyw) wpisuje się raz w Plenerze albo rzuca w zdaniu
 * „lecę z Mavikiem", a nie wypełnia formularza z polami wyboru. */
function sprzetTekst(d) {
  return [d.sprzet, d.dodatki, userSprzet.korpus, userSprzet.dodatki]
    .filter(Boolean).join(' ');
}

async function extractKbText(name, mime, buf) {
  const ext = extOf(name);
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
    const zeZmyslow = await sensesExtract(name, buf);
    if (zeZmyslow) return zeZmyslow.slice(0, 200000);
    return text.slice(0, 200000);
  }
  if (AV_EXTS.has(ext) || /^(audio|video)\//.test(mime || '')) {
    return (await sensesTranscribe(buf, mime)).slice(0, 200000);
  }
  if (/^image\//.test(mime || '')) {
    const summary = await sensesDetectSummary(buf, mime);
    return summary ? `Na obrazie wykryto: ${summary}` : '';
  }
  return '';
}

function chunkText(text, size = 1500, max = 30) {
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
  };
}

// Przeliczenie fragmentów bazy wiedzy na aktualny model embeddingów.
// Działa w tle i pilnuje, by nie uruchomić się dwa razy naraz.
let reembedBusy = false;
async function reembedKbChunks(model, budget = 40) {
  if (reembedBusy) return;
  const stale = [];
  for (const it of kbItems) {
    for (const ch of it.chunks || []) {
      if (!sameModel(ch, model)) stale.push(ch);
      if (stale.length >= budget) break;
    }
    if (stale.length >= budget) break;
  }
  if (!stale.length) return;
  reembedBusy = true;
  try {
    const embs = await embedTexts(stale.map((c) => c.text), 60000, 'passage');
    if (embs) {
      stale.forEach((c, i) => { c.embedding = embs.vectors[i]; c.embModel = embs.model; });
      saveKb();
      console.log(`  → Przeliczono ${stale.length} fragmentów bazy wiedzy na model ${model}`);
    }
  } catch { /* spróbujemy przy następnym pytaniu */ } finally {
    reembedBusy = false;
  }
}

async function kbSearch(query, excludeIds = [], limit = 4) {
  if (!query || !query.trim()) return [];
  const pool = [];
  for (const it of kbItems) {
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

  const threshold = qvec ? 0.35 : 0.18;
  return pool
    .map((c) => ({
      c,
      score: (qvec && sameModel(c, qmodel)) ? cosine(qvec, c.embedding) : keywordScore(query, c.text),
    }))
    .filter((s) => s.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ name: s.c.name, text: s.c.text }));
}

async function kbAddFile(name, mime, buf, presetText = null) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  fs.mkdirSync(KB_FILES, { recursive: true });
  fs.writeFileSync(path.join(KB_FILES, id), buf);
  const text = presetText !== null ? presetText : await extractKbText(name, mime, buf);
  const item = {
    id, type: 'file', name, mime, size: buf.length, time: Date.now(),
    text, chunks: await buildChunks(text),
  };
  kbItems.push(item);
  saveKb();
  return item;
}

// ---------------------------------------------------------------------------
// Digital Time Machine — oś czasu migawek otoczenia (obraz + wykryte obiekty).
// ---------------------------------------------------------------------------

const TIMELINE_FILE = path.join(DATA_DIR, 'timeline.json');
let timeline = [];
try { timeline = JSON.parse(fs.readFileSync(TIMELINE_FILE, 'utf8')); } catch { /* brak */ }
function saveTimeline() {
  try { zapiszAtomowo(TIMELINE_FILE, JSON.stringify(timeline)); }
  catch (err) { console.error('Nie udało się zapisać osi czasu:', err.message); }
}

async function handleTimeline(req, res) {
  if (req.method === 'GET') {
    // dołącz różnice względem poprzedniej migawki
    const withDiff = timeline.map((s, i) => {
      const prev = timeline[i - 1];
      const cur = new Set(s.objects || []);
      const old = new Set(prev ? prev.objects || [] : []);
      return {
        ...s,
        appeared: [...cur].filter((o) => !old.has(o)),
        disappeared: [...old].filter((o) => !cur.has(o)),
      };
    });
    return sendJson(res, 200, { snapshots: withDiff });
  }
  if (req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    let imageId = null;
    if (data.image) {
      try {
        const buf = Buffer.from(String(data.image).split(',').pop(), 'base64');
        const item = await kbAddFile(tsName('migawka', 'jpg'), 'image/jpeg', buf, 'Migawka osi czasu.');
        imageId = item.id;
      } catch { /* bez obrazu */ }
    }
    const snap = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      time: Date.now(),
      label: String(data.label || '').slice(0, 120),
      objects: Array.isArray(data.objects) ? data.objects.slice(0, 40) : [],
      imageId,
    };
    timeline.push(snap);
    if (timeline.length > 500) timeline = timeline.slice(-500);
    saveTimeline();
    addEvent('oś-czasu', `zapisano migawkę otoczenia${snap.objects.length ? `: ${snap.objects.join(', ')}` : ''}`);
    return sendJson(res, 200, { ok: true, id: snap.id });
  }
  if (req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const snap = timeline.find((s) => s.id === id);
    if (snap?.imageId) { try { fs.unlinkSync(path.join(KB_FILES, snap.imageId)); } catch { /* skip */ }
      kbItems = kbItems.filter((it) => it.id !== snap.imageId); saveKb(); }
    timeline = timeline.filter((s) => s.id !== id);
    saveTimeline();
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405); res.end();
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
  const senses = await sensesState();
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
    wiedza: { rozmowy: convIndex.length, pamiec: pamiec_.ile(), bazaWiedzy: kbItems.length,
      profil: userProfile.trim().length > 0, migawki: timeline.length },
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
      sprzet: [userSprzet.korpus, userSprzet.obiektywy, userSprzet.dodatki].filter(Boolean).join(' · ') || null,
      aparatPoWifi: canon.skonfigurowany(),
      misjaKmz: true,
      kartyUjec: true,
      archiwum: onedrive.skonfigurowany(),
    },
    trening: { przykladyChat: buildTrainingDataset('chat').count,
      skrypt: moduleExists('training', 'qlora_example.py') },
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
    `Trening własnego modelu: przykładów=${m.trening.przykladyChat}, skrypt QLoRA=${yes(m.trening.skrypt)}`,
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
  return lines.join('\n');
}

// --- Backlog usprawnień: pomysły Cosmosa na samego siebie ---
//     Całość w lib/pomysly.js; tutaj zostaje tylko spięcie zależności.
const pomysly_ = require('./lib/pomysly.js').utworz({
  katalogDanych: DATA_DIR,
  saveJsonFile,
  sendJson,
  readJson,
  addEvent,
  llmComplete,
  manifest: () => capabilityManifest(),
  opisZdolnosci: (m) => capabilityText(m),
  profil: () => userProfile,
  tematyRozmow: () => convIndex.slice(0, 25).map((c) => c.title).filter(Boolean),
  pozycjeWiedzy: () => kbItems.slice(-25).map((it) => it.name).filter(Boolean),
});
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
    return sendJson(res, 200, { items: kbItems.map(kbItemMeta) });
  }

  if (pathname === '/api/kb' && req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const item = kbItems.find((it) => it.id === id);
    kbItems = kbItems.filter((it) => it.id !== id);
    if (item?.type === 'file') {
      try { fs.unlinkSync(path.join(KB_FILES, item.id)); } catch { /* już nie ma */ }
    }
    saveKb();
    return sendJson(res, 200, { ok: true, total: kbItems.length });
  }

  if (pathname === '/api/kb/raw' && req.method === 'GET') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const item = kbItems.find((it) => it.id === id && it.type === 'file');
    if (!item) { res.writeHead(404); return res.end(); }
    try {
      const buf = fs.readFileSync(path.join(KB_FILES, item.id));
      res.writeHead(200, {
        'Content-Type': item.mime || 'application/octet-stream',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.name)}`,
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
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const name = String(data.name || 'plik').slice(0, 200);
    const mime = String(data.mime || '');
    let buf;
    try { buf = Buffer.from(String(data.data || ''), 'base64'); } catch { buf = null; }
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
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0' },
        signal: AbortSignal.timeout(20000),
      });
      const html = await r.text();
      const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '') || url;
      const text = stripTags(
        html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
      ).slice(0, 200000);
      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'link', name: title.slice(0, 200), url, time: Date.now(),
        text, chunks: await buildChunks(text),
      };
      kbItems.push(item);
      saveKb();
      addEvent('baza-wiedzy', `dodano link: ${title.slice(0, 80)}`);
      return sendJson(res, 200, { ok: true, item: kbItemMeta(item) });
    } catch (err) {
      return sendJson(res, 502, { error: `Nie udało się pobrać strony: ${err.message}` });
    }
  }

  if (pathname === '/api/kb/note' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const text = String(data.text || '').trim().slice(0, 200000);
    if (!text) return sendJson(res, 400, { error: 'Pusta notatka.' });
    const name = String(data.title || '').trim() ||
      `Notatka głosowa ${new Date().toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}`;
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: 'note', name: name.slice(0, 200), time: Date.now(),
      text, chunks: await buildChunks(text),
    };
    kbItems.push(item);
    saveKb();
    addEvent('baza-wiedzy', `zapisano notatkę: ${name.slice(0, 80)}`);
    return sendJson(res, 200, { ok: true, item: kbItemMeta(item) });
  }

  res.writeHead(405);
  res.end();
}

// API: konfiguracja i status
// ---------------------------------------------------------------------------

function handleConfig(res) {
  const endpoints = {};
  for (const [name, ep] of Object.entries(ENDPOINTS)) {
    endpoints[name] = {
      label: ep.label,
      baseUrl: ep.baseUrl,
      model: ep.model,
      visionModel: ep.visionModel || '',
      hasApiKey: name === 'local' ? true : Boolean(ep.apiKey),
    };
  }
  sendJson(res, 200, {
    app: 'Cosmos',
    endpoints,
    senses: { baseUrl: SENSES_URL },
    studio: {
      image: imageProviders().length > 0,
      speech: Boolean(STUDIO.eleven.key),
      video: Boolean(STUDIO.seedance.key),
      exportDir: STUDIO.exportDir,
    },
  });
}

async function handleStatus(req, res) {
  const results = {};
  await Promise.all([
    ...Object.entries(ENDPOINTS).map(async ([name, ep]) => {
      try {
        const r = await fetch(`${ep.baseUrl}/models`, {
          headers: authHeaders(ep),
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
// API: proxy do usługi percepcji (Cosmos Senses)
// ---------------------------------------------------------------------------

async function proxySenses(req, res, targetPath, { json = false, search = '' } = {}) {
  let upstream;
  try {
    const body = await readBodyBuffer(req);
    upstream = await fetch(`${SENSES_URL}${targetPath}${search}`, {
      method: 'POST',
      headers: { 'Content-Type': req.headers['content-type'] || (json ? 'application/json' : 'application/octet-stream') },
      body,
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    return sendJson(res, 502, {
      error: `Usługa percepcji (Cosmos Senses) nie odpowiada pod ${SENSES_URL}. ` +
             `Uruchom ją: python senses/service.py (${err.message})`,
    });
  }
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, { 'Content-Type': contentType, 'Content-Length': buf.length });
  res.end(buf);
}

/* Kinect nie jest kamerą UVC, więc przeglądarka go nie widzi i podgląd nie może
   użyć getUserMedia. Obraz idzie tędy: usługa zmysłów → serwer → przeglądarka. */

/** Przekaż strumień MJPEG bez buforowania.
 *
 * Zwykłe proxy czeka na całą odpowiedź — a strumień nie kończy się nigdy.
 * Tutaj przepisujemy nagłówki i przelewamy ciało kawałek po kawałku, żeby
 * klatki docierały na bieżąco.
 */
async function proxySensesStream(req, res, targetPath, search = '') {
  const ctrl = new AbortController();
  // Gdy przeglądarka zamknie podgląd, zrywamy też połączenie do zmysłów —
  // inaczej Kinect produkowałby klatki w nieskończoność dla nikogo.
  res.on('close', () => ctrl.abort());

  let upstream;
  try {
    upstream = await fetch(`${SENSES_URL}${targetPath}${search}`, { signal: ctrl.signal });
  } catch (err) {
    if (!res.headersSent) sendJson(res, 502, { error: `Usługa percepcji nie odpowiada: ${err.message}` });
    return;
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    if (!res.headersSent) {
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
      res.end(text);
    }
    return;
  }
  res.writeHead(200, {
    'Content-Type': upstream.headers.get('content-type') || 'multipart/x-mixed-replace',
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  try {
    for await (const chunk of upstream.body) {
      if (!res.write(Buffer.from(chunk))) {
        await new Promise((r) => res.once('drain', r));
      }
    }
  } catch { /* zerwane połączenie — normalne przy zamknięciu podglądu */ }
  res.end();
}

/** Odczyt z usługi percepcji (GET) — pojedyncza klatka, status czujnika.
 *  Zapasowa droga, gdy strumień MJPEG nie przejdzie przez proxy. */
async function proxySensesGet(req, res, targetPath, search = '') {
  let upstream;
  try {
    upstream = await fetch(`${SENSES_URL}${targetPath}${search}`, {
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return sendJson(res, 502, {
      error: `Usługa percepcji nie odpowiada pod ${SENSES_URL}. ` +
             `Uruchom ją: python senses/service.py (${err.message})`,
    });
  }
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

// ---------------------------------------------------------------------------
// API: czat (streaming SSE) z kontekstem percepcji
// ---------------------------------------------------------------------------

async function handleChat(req, res) {
  let payload;
  try {
    payload = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: 'Nieprawidłowy JSON w żądaniu.' });
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return sendJson(res, 400, { error: 'Pole "messages" jest wymagane.' });
  }

  const ep = pickEndpoint(payload.endpoint);

  if (!ep.apiKey && ep.baseUrl.includes('integrate.api.nvidia.com')) {
    return sendJson(res, 401, {
      error: 'Brak klucza API dla chmury NVIDIA. Ustaw NVIDIA_API_KEY w pliku .env ' +
             '(klucz wygenerujesz na https://build.nvidia.com).',
    });
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
  const poziom = modelToolLevel(payload.model || ep.model || '');
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
      + (userLocation ? `\nUŻYTKOWNIK ZNAJDUJE SIĘ W: ${userLocation}.`
        + ' Używaj tego miejsca, gdy pyta o coś „w okolicy", „niedaleko" albo „u mnie" —'
        + ' nie dopytuj o lokalizację, którą już znasz.'
        : '\nNie znasz lokalizacji użytkownika. Jeśli jest potrzebna, zapytaj o nią raz, krótko.'),
  });

  // Profil użytkownika — pamięć profilowa wstrzykiwana zawsze
  if (userProfile.trim()) {
    extras.push({ role: 'system', content: 'PROFIL UŻYTKOWNIKA (stałe fakty o osobie, z którą rozmawiasz):\n' + userProfile.trim() });
  }

  const scene = payload.useSenses === false ? '' : sceneContext();
  if (scene) extras.push({ role: 'system', content: scene });

  if (payload.useSearch !== false && !bezNarzedzi) {
    extras.push({
      role: 'system',
      content: krotko
        ? 'NARZĘDZIE — INTERNET: gdy potrzebujesz aktualnych informacji, zakończ '
          + 'odpowiedź osobną linią: [SZUKAJ: zapytanie]. Dostaniesz wyniki i odpowiesz '
          + 'na ich podstawie. Gdy brakuje Ci miasta — zapytaj o nie zamiast szukać.'
        :
        'NARZĘDZIE — WYSZUKIWANIE W INTERNECIE: gdy pytanie wymaga aktualnych lub zewnętrznych ' +
        'informacji (modele urządzeń, ceny, specyfikacje, wiadomości, fakty, których nie znasz), ' +
        'NIE zgaduj — zakończ swoją odpowiedź osobną linią dokładnie w formacie: [SZUKAJ: zapytanie]. ' +
        'Otrzymasz wtedy wiadomość „WYNIKI WYSZUKIWANIA” i na jej podstawie udzielisz pełnej ' +
        'odpowiedzi. Gdy znasz odpowiedź lub pytanie dotyczy rozmowy/obrazu, ' +
        'odpowiadaj normalnie, bez [SZUKAJ:].\n' +
        /* „Podaj źródła" bez podanego formatu kończyło się zapisem „【1†L1-L4】",
           w który nie da się kliknąć i który nikomu nic nie mówi. */
        'ŹRÓDŁA: ilekroć odpowiadasz na podstawie wyników z internetu — nieważne, ' +
        'czy chodzi o pogodę, sprzęt, przepisy czy plan podróży — zakończ ' +
        'odpowiedź sekcją „Źródła:" i wypisz strony jako linki markdown ' +
        '[tytuł](adres), po jednej w wierszu. Nie używaj zapisów typu [1] ani ' +
        '【1†L1-L4】. Gdy odpowiadasz z własnej wiedzy, bez wyszukiwania, nie ' +
        'wymyślaj źródeł — napisz wprost, że to Twoja wiedza, i zaproponuj sprawdzenie.\n' +
        /* Bez tej zasady model przy „znajdź coś w okolicy" bez znanej lokalizacji
           kręcił się w kółko: „mam szukać czy zapytać? instrukcja każe szukać,
           ale nie mam czego". Cztery ekrany rozważań, zero odpowiedzi. */
        'GDY BRAKUJE CI JEDNEJ INFORMACJI do sensownego wyszukania (najczęściej miasta), ' +
        'a nie masz jej ani w profilu, ani w lokalizacji użytkownika — po prostu zapytaj o nią ' +
        'jednym zdaniem i NIE dodawaj [SZUKAJ:]. To poprawne zachowanie, nie złamanie zasady; ' +
        'nie roztrząsaj go w myślach.\n' +
        'GDY SZUKASZ LOKALNEJ USŁUGI (warsztat, lekarz, sklep): w odpowiedzi podaj konkretne ' +
        'firmy z adresem i telefonem, jeśli są w wynikach. Sama lista katalogów typu PKT czy ' +
        'PanoramaFirm to słaba odpowiedź — użytkownik znalazłby ją sam. Jeśli w wynikach są ' +
        'wyłącznie katalogi, powiedz to wprost i zaproponuj węższe zapytanie.',
    });
  }

  /* Archiwum materiału — drugi wyróżnik. Model w chmurze nie ma Twoich
     plików, więc na „ile klipów 50 mm w tym roku" nie odpowie nigdy. */
  if (payload.useArchive !== false && !krotko && archiwum.ile() > 0) {
    extras.push({
      role: 'system',
      content:
        'NARZĘDZIE — ARCHIWUM MATERIAŁU: użytkownik ma zindeksowane '
        + `${archiwum.ile()} własnych zdjęć i klipów (aparat, obiektyw, ogniskowa, `
        + 'przysłona, czas, ISO, data, GPS). Gdy pyta o SWÓJ materiał — „ile klipów '
        + 'nakręciłem 50 mm", „pokaż ujęcia z czerwca o zachodzie", „mam coś z tego '
        + 'miejsca" — zakończ odpowiedź osobną linią: [ARCHIWUM: filtry].\n'
        + 'Filtry (wszystkie opcjonalne, oddzielone spacjami):\n'
        + '  folder=Mazury 2026 (FRAGMENT ŚCIEŻKI albo nazwy katalogu — bez wielkości '
        + 'liter i bez ogonków; „mazury" znajdzie też „/Zdjęcia Mazury 2024 Dron/”) ·\n'
        + '  rok=2026 · miesiac=06 · typ=zdjecie|wideo · aparat=R6 · obiektyw=RF50 ·\n'
        + '  ogniskowa=50 · ogniskowaOd=24 ogniskowaDo=70 · isoOd=1600 · przyslonaDo=2.8 ·\n'
        + '  swiatlo=złota godzina|niebieska godzina|ostre światło|zmierzch|noc ·\n'
        + '  poraDnia=rano|poludnie|wieczor|noc (można kilka po przecinku: „rano,wieczor") ·\n'
        + '  miejsce=Kraków (nazwa miejsca albo regionu — Cosmos sam zamieni ją na '
        + 'współrzędne i dobierze promień; NIE podawaj lat/lon z pamięci) ·\n'
        + '  temat=ptaki-w-locie|zwierzeta-dzikie|zwierzeta-domowe|wyscig|pojazdy-statycznie|\n'
        + '    ulica|portret|sesja-moda|ludzie-w-ruchu|koncert|mecz|slub|wydarzenie-rodzinne|\n'
        + '    krajobraz|gory|las|woda-wybrzeze|jezioro|kanion-klif|architektura|noc-gwiazdy|makro\n'
        + '    (można kilka po przecinku) ·\n'
        + '  obiekt=person · grupuj=ogniskowa|aparat|rok|miesiac|obiektyw|swiatlo|poraDnia|temat\n'
        + 'PORA DNIA to co innego niż PORA ŚWIATŁA: złota godzina bywa rano i wieczorem, '
        + 'więc „zdjęcia z rana i z wieczora" to poraDnia=rano,wieczor, a nie swiatlo=.\n'
        + 'TEMAT jest zgadywany z nazw folderów i plików, więc bywa niepełny — przy '
        + 'niskim pokryciu powiedz to wprost, zamiast podawać liczbę jak fakt.\n'
        + 'Z `grupuj` dostaniesz zestawienie liczbowe zamiast listy plików — tego '
        + 'używaj przy pytaniach „ile" i „najczęściej".\n'
        + 'Pora światła jest policzona z pozycji Słońca nad miejscem zdjęcia, '
        + 'nie zgadnięta z godziny. Gdy zdjęcie nie ma GPS-u, liczy się ją dla domu '
        + 'użytkownika, a wpis dostaje `swiatloPrzyblizone: true` — wtedy powiedz, '
        + 'że to przybliżenie.\n'
        + 'GDY UŻYTKOWNIK MÓWI O FOLDERZE — użyj `folder=`, a NIE `miejsce=`. '
        + 'To on porządkuje materiał katalogami i nazwa katalogu jest pewniejsza '
        + 'niż GPS, którego w plikach zwykle nie ma.\n'
        + 'LISTA PLIKÓW TO PRÓBKA, NIE CAŁE ARCHIWUM. Dostajesz kilkadziesiąt '
        + 'najnowszych wpisów i jest to napisane w nagłówku wyniku. NIGDY nie '
        + 'wnioskuj z niej o tym, czego w archiwum NIE MA („same zrzuty ekranu”, '
        + '„brak zdjęć z aparatu”) — na to jest `grupuj`, który liczy CAŁOŚĆ. '
        + 'Gdy szukasz materiału z aparatu, a widzisz same telefony, zrób '
        + '[ARCHIWUM: grupuj=aparat …] zamiast orzekać.\n'
        + 'NIE POWTARZAJ TEGO SAMEGO ZAPYTANIA. Jeśli filtr dał zero, zmień go '
        + '(inny rok, `folder=` zamiast `miejsce=`, szerszy zakres) albo powiedz '
        + 'wprost, czego nie znalazłeś. Kolejne identyczne wywołanie da to samo zero.\n'
        + 'ZAWSZE PATRZ NA POKRYCIE DANYCH. Zestawienie oddaje `zDanymi` i `bezDanych`. '
        + 'Gdy większość plików nie ma wypełnionego pola, liczba NIE JEST odpowiedzią '
        + 'na pytanie „ile” — jest rozmiarem luki w metadanych. Powiedz to wprost, '
        + 'zamiast podawać wynik jak fakt.',
    });
  }

  /* Plan zdjęciowy — wyróżnik Cosmosa. Model w chmurze nie wie, gdzie stoisz
     ani jaki masz sprzęt, więc na „jakie ustawienia" odpowiada ogólnikami.
     Tutaj są konkretne liczby, policzone z pozycji Słońca nad Twoim miejscem. */
  if (payload.usePlan !== false && !krotko && userWspolrzedne) {
    extras.push({
      role: 'system',
      content:
        'NARZĘDZIE — PLAN ZDJĘCIOWY: gdy pytanie dotyczy ustawień aparatu, światła, '
        + 'złotej godziny, wschodu/zachodu albo „kiedy najlepiej kręcić", zakończ '
        + 'odpowiedź osobną linią: [PLAN: parametry]. Parametry oddzielaj spacjami, '
        + 'wszystkie są opcjonalne:\n'
        + '  tryb=wideo|zdjecie · klatki=25 · sprzet=canon-r6ii|mavic-3|telefon · '
        + 'ogniskowa=50 · ruch=statyczne|spacer|szybkie · glebia=2.8 · '
        + 'obiektyw=24-70 f/2.8 (można kilka po przecinku: „24-70 f/2.8, 70-200 f/4”) · '
        + 'temat=CO fotografuje (ptaki w locie, jelenie, wyścig motocykli, portret, '
        + 'koncert, ślub, góry, las, jezioro, klify, gwiazdy… — pisz WŁASNYMI SŁOWAMI, '
        + 'lista jest otwarta; z tego wychodzą czas migawki, ogniskowa i przysłona) · '
        + '(glebia PODAWAJ TYLKO wtedy, gdy użytkownik wprost prosił o określoną '
        + 'głębię ostrości — narzucona z własnej inicjatywy wymusza mocny filtr ND '
        + 'i psuje resztę doboru) · '
        + 'zachmurzenie=bezchmurnie|lekkie|pochmurno|deszcz · kiedy=2026-06-21T19:30 · '
        + 'miejsce=Kraków (gdy zdjęcia planowane są GDZIE INDZIEJ niż lokalizacja '
        + 'użytkownika — Cosmos sam zamieni nazwę na współrzędne; NIE zgaduj lat/lon '
        + 'z pamięci) · lat=52.02 lon=20.90 (gdy znasz je dokładnie)\n'
        + 'ZACHMURZENIE POMIŃ, chyba że użytkownik sam je poda — bez niego Cosmos '
        + 'bierze prognozę pogody dla tego miejsca i tej godziny.\n'
        + 'Przykład: [PLAN: tryb=wideo klatki=25 sprzet=canon-r6ii]\n'
        + 'LISTA UJĘĆ: przy `tryb=wideo` dostajesz pole `ujecia` — gotowy zestaw ujęć '
        + 'dobrany do TEMATU i przefiltrowany przez posiadany sprzęt, każde z ogniskową, '
        + 'ruchem kamery i czasem trwania. Podaj je jako listę do odhaczenia w kolejności '
        + 'KRĘCENIA, nie przepisuj jako opowieści. Pole `ujecia.pominiete` mówi, czego NIE '
        + 'da się nakręcić tym sprzętem i dlaczego — POWIEDZ O TYM WPROST. Przemilczenie '
        + 'wygląda, jakby Cosmos o tych ujęciach zapomniał, a nie jakby ich świadomie nie '
        + 'proponował.\n'
        + 'ZORZA: przy Słońcu poniżej horyzontu dostajesz też pole `zorza` — bieżące Kp '
        + 'z NOAA, prognozę i PRÓG Kp dla tego miejsca. „Kp 7" samo w sobie nic nie znaczy: '
        + 'porównaj je z `progNadHoryzontem`. Gdy `szansa` to „brak", powiedz wprost, '
        + 'że zorzy nie będzie, zamiast owijać. Zawsze dodaj, że zasłoni ją zachmurzenie '
        + 'i Księżyc, a patrzeć trzeba na PÓŁNOC.\n'
        + 'Dostaniesz pozycję Słońca, prognozę, godziny złotej i niebieskiej oraz policzone '
        + 'czas/przysłonę/ISO. NIE zgaduj tych liczb sam — Twoja wiedza nie obejmuje '
        + 'dzisiejszej daty ani miejsca, w którym stoi użytkownik.',
    });
  }

  /* Płótno — długi tekst obok rozmowy. Kluczowa jest DRUGA połowa instrukcji:
     bez niej model przy każdej poprawce przepisuje cały dokument, co przy
     scenariuszu na trzy tysiące słów trwa minutę i za każdym razem coś gubi. */
  if (payload.useCanvas !== false && !krotko) {
    extras.push({
      role: 'system',
      content:
        'NARZĘDZIE — PŁÓTNO (dokument obok rozmowy): gdy użytkownik prosi o dłuższy '
        + 'tekst do dalszej pracy — scenariusz, opis filmu, artykuł, plan, dłuższy kod — '
        + 'nie wypisuj go w rozmowie. Otwórz płótno:\n'
        + '```płótno: Tytuł dokumentu\n(cała treść)\n```\n'
        + 'POPRAWKI RÓB FRAGMENTAMI, nigdy nie przepisuj całości:\n'
        + '```płótno-zmiana\n<<<<<<< SZUKAJ\n(dokładny fragment obecnej treści)\n'
        + '=======\n(nowa wersja tego fragmentu)\n>>>>>>> ZAMIEŃ\n```\n'
        + 'Fragment w SZUKAJ musi występować w płótnie DOKŁADNIE RAZ i być przepisany '
        + 'znak w znak. Gdy trafia w dwa miejsca albo nie trafia wcale, zmiana zostanie '
        + 'odrzucona — weź wtedy dłuższy, jednoznaczny fragment. Możesz podać kilka '
        + 'bloków SZUKAJ/ZAMIEŃ naraz.\n'
        + 'Aktualną treść płótna dostajesz w każdej wiadomości — użytkownik mógł ją '
        + 'zmienić ręcznie, więc opieraj się na niej, a nie na tym, co sam napisałeś '
        + 'wcześniej. Krótkie odpowiedzi zostawiaj w rozmowie; płótno jest do tego, '
        + 'co się redaguje.',
    });
  }

  /* Liczenie na danych. Tylko dla modeli poziomu „pełny": mniejsze i tak nie
     napiszą poprawnego programu, a blok kodu wypisany w rozmowie zamiast
     wykonania jest gorszy niż brak narzędzia. */
  if (KOD_WLACZONY && payload.useCode !== false && !krotko) {
    extras.push({
      role: 'system',
      content:
        'NARZĘDZIE — LICZENIE NA DANYCH: gdy pytanie wymaga policzenia, przetworzenia '
        + 'albo zestawienia danych (sumy, średnie, sortowanie, porównania, wykres), '
        + 'NIE licz w pamięci — napisz program i zakończ nim odpowiedź:\n'
        + '```uruchom\n// JavaScript (Node). Wypisz wynik przez console.log\n```\n'
        + 'Program dostanie treść załączników z rozmowy jako pliki w katalogu roboczym '
        + '(np. `fs.readFileSync(\'dane.csv\', \'utf8\')`). Otrzymasz z powrotem to, co '
        + 'wypisał, i dopiero wtedy udzielisz odpowiedzi.\n'
        + 'Możesz zapisać plik wynikowy — `wykres.svg` zostanie pokazany w rozmowie. '
        + 'Wykres rysuj jako czysty SVG, bez bibliotek: żadnej nie ma i `npm install` '
        + 'nie zadziała. Dostępna jest wyłącznie standardowa biblioteka Node.\n'
        + 'Program nie ma dostępu do internetu ani do plików serwera i ma '
        + `${Math.round((Number(process.env.CODE_TIMEOUT_MS || 10000)) / 1000)} sekund na wykonanie.`,
    });
  }

  if (payload.useActions !== false && !bezNarzedzi) {
    const procList = procedury().length
      ? ' Nauczone procedury (możesz zaproponować ich uruchomienie): ' +
        procedury().map((pr) => `"${pr.name}"`).join(', ') +
        '. Aby uruchomić procedurę, użyj [AKCJA: procedura | dokładna nazwa]. ' +
        'Uruchomienie tylko przygotowuje kroki — każdy krok wrażliwy (płatność, wysłanie) ' +
        'i tak wymaga osobnego potwierdzenia użytkownika.'
      : '';
    const devList = urzadzenia().length
      ? ' Podłączone urządzenia (światło, sprzęt, scena): ' +
        urzadzenia().map((d) => `"${d.name}"`).join(', ') +
        '. Aby użyć urządzenia, napisz [AKCJA: urządzenie | dokładna nazwa]. ' +
        'Użytkownik zatwierdza jednym kliknięciem.'
      : '';
    extras.push({
      role: 'system',
      content:
        'NARZĘDZIE — AKCJE (za zgodą użytkownika): gdy użytkownik prosi o zapisanie lub ' +
        'zapamiętanie czegoś, zakończ odpowiedź osobną linią w formacie ' +
        '[AKCJA: typ | treść]. Dozwolone typy: "zapamiętaj" (trwały fakt do pamięci), ' +
        '"notatka" (notatka do bazy wiedzy), "pomysł" (propozycja usprawnienia siebie — ' +
        'nowa umiejętność, procedura, rutyna lub zastosowanie; trafia do listy do akceptacji)' +
        (procList ? ', "procedura" (uruchom nauczoną czynność)' : '') +
        (devList ? ', "urządzenie" (użyj podłączonego urządzenia)' : '') +
        '. Użytkownik ręcznie zatwierdzi akcję. Nie używaj [AKCJA:] w innych sytuacjach. ' +
        'Gdy zauważysz, że mógłbyś się czegoś nauczyć albo coś zautomatyzować dla ' +
        'użytkownika — zaproponuj to przez [AKCJA: pomysł | konkretny opis].' +
        procList + devList,
    });
  }

  if (imageProviders().length && payload.useStudio !== false && !bezNarzedzi) {
    extras.push({
      role: 'system',
      content:
        'NARZĘDZIE — GENEROWANIE OBRAZÓW: gdy użytkownik prosi o wygenerowanie grafiki, obrazu, ' +
        'ilustracji lub loga, odpowiedz krótko i zakończ osobną linią dokładnie w formacie: ' +
        '[OBRAZ: szczegółowy opis sceny po angielsku]. Obraz zostanie wygenerowany i pokazany. ' +
        'Nie używaj [OBRAZ:] w innych sytuacjach.',
    });
  }

  if (payload.useSearch !== false && !bezNarzedzi) {
    extras.push({
      role: 'system',
      content: krotko
        ? 'NARZĘDZIE — ZDJĘCIA Z INTERNETU: gdy użytkownik chce zobaczyć, jak coś '
          + 'naprawdę wygląda, zakończ odpowiedź osobną linią: [GRAFIKA: zapytanie]. '
          + 'To prawdziwe zdjęcia; [OBRAZ:] to rysunek tworzony przez AI — nie myl ich.'
        :
        /* Cosmos umiał obraz wygenerować, ale nie umiał żadnego ZNALEŹĆ.
           Na „pokaż zdjęcia tych miejsc" model odpowiadał uczciwie „nie mam
           dostępu do wyszukiwania obrazów" i proponował wizje artystyczne
           zamiast prawdziwej Majorki. */
        'NARZĘDZIE — WYSZUKIWANIE GRAFIK: gdy użytkownik chce ZOBACZYĆ, jak coś ' +
        'naprawdę wygląda (miejsce, zabytek, produkt, osoba, sprzęt), zakończ odpowiedź ' +
        'osobną linią dokładnie w formacie: [GRAFIKA: zapytanie]. Zdjęcia zostaną ' +
        'znalezione w internecie i pokazane pod Twoją odpowiedzią.\n' +
        'RÓŻNICA MIĘDZY NARZĘDZIAMI: [GRAFIKA:] to prawdziwe zdjęcia z internetu — ' +
        'używaj jej, gdy pada słowo „zdjęcia", „jak wygląda", „pokaż". [OBRAZ:] to ' +
        'rysunek tworzony przez AI — tylko gdy użytkownik prosi o wygenerowanie, ' +
        'narysowanie albo wymyślenie grafiki. Na prośbę o zdjęcia prawdziwego miejsca ' +
        'NIE proponuj wizji artystycznych — po prostu użyj [GRAFIKA:].\n' +
        'Możesz poprosić o grafiki dla kilku rzeczy naraz, oddzielając je średnikiem: ' +
        '[GRAFIKA: Katedra La Seu Palma; plaża Es Trenc; Valldemossa]. Nie pytaj ' +
        'użytkownika, które z wymienionych miejsc chce zobaczyć — pokaż kilka najlepszych.\n' +
        /* Marcin poprosił „ze zdjęciami proszę" do siedmiodniowego planu Majorki
           i dostał osiem zdjęć jednej katedry. Model potraktował znacznik jak
           zapowiedź („oto propozycje zapytań o zdjęcia") i wysłał jedno miejsce
           z siedmiu. Obie te rzeczy trzeba powiedzieć wprost. */
        'GDY PROŚBA DOTYCZY PLANU, LISTY MIEJSC ALBO TRASY — wymień w JEDNYM ' +
        'znaczniku wszystkie kluczowe punkty (do czterech), po średniku. Jedno ' +
        'miejsce z siedmiu to nie jest odpowiedź na „ze zdjęciami proszę".\n' +
        'NIE ZAPOWIADAJ WYSZUKIWANIA. Nie pisz „oto propozycje zapytań o zdjęcia" ' +
        'ani „po ich wykonaniu otrzymasz zdjęcia" — po prostu dodaj znacznik. ' +
        'Zdjęcia pojawią się od razu, a Ty dostaniesz je z powrotem i wtedy ' +
        'przypiszesz je do miejsc z planu.\n' +
        /* Marcin: „zdjęcia się nie pokazywały, a jak podałem mu, że Kraków, to
           zgłupiał". Samo doprecyzowanie jest najzwyklejszą rzeczą w rozmowie,
           a model traktował je jak nowy, niezrozumiały temat. */
        'ZAPYTANIE MA BYĆ KONKRETNE: „rynek" nie znajdzie nic sensownego, ' +
        '„Rynek Główny Kraków" znajdzie. Dodawaj miejsce, nazwę własną albo kontekst ' +
        'z rozmowy.\n' +
        'GDY UŻYTKOWNIK DOPOWIADA jedno słowo albo nazwę (np. samo „Kraków”) po tym, ' +
        'jak prosił o zdjęcia — to jest DOPRECYZOWANIE POPRZEDNIEJ PROŚBY, nie nowy ' +
        'temat i nie pytanie o miasto. Połącz to z tym, o co prosił wcześniej, ' +
        'i po prostu poszukaj jeszcze raz.',
    });
  }

  if (payload.useMemory !== false) {
    const recalled = await searchMemory(queryText);
    const memCtx = memoryContextLines(recalled);
    if (memCtx) extras.push({ role: 'system', content: memCtx });
  }

  // Baza wiedzy — pozycje zaznaczone przez użytkownika (zawsze dołączane)
  const kbSelected = Array.isArray(payload.kbSelected) ? payload.kbSelected : [];
  if (kbSelected.length) {
    const chosen = kbItems.filter((it) => kbSelected.includes(it.id));

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
            const buf = fs.readFileSync(path.join(KB_FILES, it.id));
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

  if (extras.length) {
    const insertAt = messages[0]?.role === 'system' ? 1 : 0;
    messages.splice(insertAt, 0, ...extras);
  }

  // Wybór modelu — po zbudowaniu kontekstu, bo baza wiedzy mogła dodać obrazy.
  const hasImages = messages.some((m) => Array.isArray(m.content) &&
    m.content.some((p) => p.type === 'image_url'));

  let model = payload.model || ep.model;

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
    max_tokens: Number.isInteger(payload.max_tokens) ? payload.max_tokens : 2048,
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

  let upstream;
  try {
    upstream = await fetch(`${ep.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(ep),
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    // Modele rozumujące OpenAI (o1, o3, gpt-5) odrzucają `max_tokens` i własną
    // temperaturę — trzeba `max_completion_tokens` i temperatury domyślnej.
    // Bez tego cała zakładka silnika po prostu nie działa, a użytkownik widzi
    // tylko surowy błąd 400. Jedna ponowna próba z poprawionym żądaniem.
    if (upstream.status === 400) {
      const raw = await upstream.clone().text().catch(() => '');
      const fixed = { ...body };
      let changed = false;
      if (/max_completion_tokens/.test(raw)) {
        fixed.max_completion_tokens = fixed.max_tokens;
        delete fixed.max_tokens;
        changed = true;
      }
      if (/temperature/.test(raw)) { delete fixed.temperature; delete fixed.top_p; changed = true; }
      if (changed) {
        upstream = await fetch(`${ep.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: authHeaders(ep),
          body: JSON.stringify(fixed),
          signal: abort.signal,
        });
      }
    }
  } catch (err) {
    if (abort.signal.aborted) return;
    return sendJson(res, 502, {
      error: payload.endpoint === 'local'
        ? `Nie udało się połączyć z lokalnym modelem (${ep.baseUrl}). Sprawdź, czy Ollama/vLLM działa. (${err.message})`
        : `Nie udało się połączyć z ${ep.baseUrl}: ${err.message}`,
    });
  }

  if (!upstream.ok) {
    let detail = '';
    try { detail = await upstream.text(); } catch { /* ignore */ }
    let message = `Błąd modelu (HTTP ${upstream.status}).`;
    try {
      const parsed = JSON.parse(detail);
      message = parsed?.error?.message || parsed?.error || parsed?.detail || parsed?.title || message;
      if (typeof message !== 'string') message = JSON.stringify(message).slice(0, 300);
    } catch {
      if (detail) message = `${message} ${detail.slice(0, 300)}`;
    }
    // Model spoza katalogu, który jednak nie przyjmuje obrazów, poznajemy dopiero
    // po odmowie dostawcy. „Błąd modelu (HTTP 400)” nic użytkownikowi nie mówi —
    // zamieniamy to na tę samą wskazówkę, co przy modelach znanych.
    if (upstream.status === 400 && hasImages && /image|vision|multimodal|content.*type/i.test(detail)) {
      return sendJson(res, 400, {
        error: `Model „${model}" odmówił przyjęcia zdjęcia.\n\n`
          + 'Wybierz w Ustawieniach model oznaczony „widzi obrazy”, albo ustaw '
          + `${payload.endpoint === 'local' ? 'LOCAL_VISION_MODEL' : 'NEMOTRON_VISION_MODEL'} `
          + 'w .env — Cosmos skieruje wtedy same zdjęcia do modelu wizyjnego, '
          + `a rozmowę zostawi wybranemu.\n\nOdpowiedź dostawcy: ${String(detail).slice(0, 200)}`,
      });
    }
    // Bez tego widać sam komunikat dostawcy i nie wiadomo nawet, którą zakładkę
    // silnika obwiniać ani jaki identyfikator modelu poleciał w żądaniu.
    const where = `[${ep.label} · ${model}]`;
    const hint = modelErrorHint(payload.endpoint, model, upstream.status);
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
    });
    try {
      for await (const chunk of upstream.body) res.write(chunk);
    } catch {
      /* klient przerwał lub upstream padł — kończymy strumień */
    }
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
    podmienionyZ: swappedFrom,
  });
  bieg.przerwij = () => abort.abort();
  biegi_.podepnij(biegId, 0, res);

  /* Świadomie BEZ `await`: trasa oddaje sterowanie, a pompa dalej przelewa
     strumień do biegu. Gdyby tu było `await`, żądanie HTTP trzymałoby bieg
     przy życiu i wróciłby dokładnie ten problem, który naprawiamy. */
  (async () => {
    const dekoder = new TextDecoder();
    let ogon = '';
    try {
      for await (const chunk of upstream.body) {
        ogon += dekoder.decode(chunk, { stream: true });
        // Bloki SSE, nie bajty: numerowanie zdarzeń wymaga całych bloków,
        // bo po nich klient wraca („mam do 137, dawaj resztę").
        const bloki = ogon.split('\n\n');
        ogon = bloki.pop();
        for (const blok of bloki) if (blok.trim()) biegi_.dopisz(bieg, blok);
      }
      if (ogon.trim()) biegi_.dopisz(bieg, ogon);
      biegi_.zakoncz(bieg);
    } catch (err) {
      biegi_.zakoncz(bieg, abort.signal.aborted ? '' : (err.message || 'Strumień modelu przerwany.'));
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

async function probeOnce(ep, model, withImage) {
  const content = withImage
    ? [{ type: 'image_url', image_url: { url: PROBE_PNG } }, { type: 'text', text: 'hi' }]
    : 'hi';
  try {
    const r = await fetch(`${ep.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(ep),
      body: JSON.stringify({ model, messages: [{ role: 'user', content }], max_tokens: 1, stream: false }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (r.ok) return { ok: true };
    let detail = '';
    try { detail = await r.text(); } catch { /* bez treści */ }
    let msg = `HTTP ${r.status}`;
    try {
      const j = JSON.parse(detail);
      msg = j?.error?.message || j?.detail || j?.title || msg;
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
async function probeModel(ep, model, withImage) {
  const first = await probeOnce(ep, model, withImage);
  if (first.ok || !first.timeout) return first;
  const second = await probeOnce(ep, model, withImage);
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

  const text = await probeModel(ep, model, false);
  // Wzrok sprawdzamy tylko wtedy, gdy sama rozmowa działa — inaczej
  // zdublowalibyśmy ten sam błąd dostępu i niepotrzebnie obciążyli limit.
  const vision = text.ok ? await probeModel(ep, model, true) : { ok: false, skipped: true };

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
        : modelErrorHint(data.endpoint, model, text.status).trim()),
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
      headers: authHeaders(ep),
      signal: AbortSignal.timeout(15000),
    });
    const data = await upstream.json();
    sendJson(res, upstream.status, data);
  } catch (err) {
    // „fetch failed” samo w sobie nie mówi nic. Najczęstszy powód przy modelu
    // lokalnym to wyłączona Ollama albo nasłuch tylko na 127.0.0.1 — i to
    // właśnie trzeba napisać, zamiast zostawiać użytkownika z komunikatem sieci.
    const local = ep === ENDPOINTS.local;
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

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (ext === '.woff2' || urlPath.startsWith('/icons/')) {
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Router + start
// ---------------------------------------------------------------------------

/* Studio potrzebuje bazy wiedzy i dziennika zdarzeń, ale nie odwrotnie.
   Podajemy mu je tutaj, po zdefiniowaniu obu stron: krzyżowe `require`
   dałoby cykliczną zależność i jedna ze stron widziałaby pusty obiekt. */
studio_.polacz({ KB_FILES, addEvent, kbAddFile, kbItemMeta, kbItems });
urzadzenia_.polacz({ addEvent, recentEvents, rutyny, routineView });
trening_.polacz({ addEvent, convIndex, convPath, userProfile });
nauka_.polacz({ KB_FILES, addEvent, cosine, embedTexts, kbAddFile, kbItems,
  keywordScore, sameModel, saveKb, tsName });

/* Trasy archiwum materiału. Sam indeks jest PASYWNY — źródła (OneDrive, dysk
   przez zmysły) wpychają wpisy, a zapytania działają, gdy te źródła są
   offline. Dlatego „ile klipów 50 mm w tym roku" odpowie z telefonu w terenie
   przy wyłączonym komputerze domowym. Całość tras: lib/archiwum-trasy.js. */
const archiwumTrasy_ = require('./lib/archiwum-trasy.js').utworz({
  archiwum, onedrive, SENSES_URL, sendJson, readJson, addEvent,
  sensesState, wspolrzedneMiejsca,
});
const handleArchiwum = (req, res, p) => archiwumTrasy_.handleArchiwum(req, res, p);

const server = http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://localhost').pathname;

    // --- uwierzytelnianie ---
    if (p === '/api/auth' && req.method === 'GET') {
      return sendJson(res, 200, { required: authEnabled(), authed: isAuthed(req) });
    }
    if (p === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if (p === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
    if (p.startsWith('/api/') && !isAuthed(req)) {
      return sendJson(res, 401, { error: 'Wymagane logowanie.' });
    }

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
      const b = biegi_.daj(String(dane.bieg || ''));
      if (b && b.przerwij) b.przerwij();
      return sendJson(res, 200, { ok: Boolean(b) });
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
    if (p === '/api/plan' && req.method === 'POST') return await handlePlanZdjeciowy(req, res);
    if (p.startsWith('/api/archive')) return await handleArchiwum(req, res, p);
    if (p.startsWith('/api/onedrive')) return await handleOneDrive(req, res, p);
    if (p === '/api/search/images' && req.method === 'GET') return await handleSearchImages(req, res);
    if (p === '/api/search/thumb' && req.method === 'GET') return await handleImageProxy(req, res);
    if (p === '/api/conversations' || p === '/api/conversations/meta' || p === '/api/conversations/search') return await handleConversations(req, res, p);
    /* CANON CCAPI — aparat jako urządzenie, nie tylko temat rozmowy.
       Trzy trasy, bo tyle wystarczy: co tam stoi, co ma ustawione, i zmień to.
       Wyzwalanie migawki jest osobno i celowo nie ma go w podpowiedziach dla
       modelu — zdjęcie ma robić człowiek, a nie model, któremu wydawało się,
       że to dobry moment. */
    /* MISJA WAYPOINTOWA → plik KMZ. `senses/flightplan.py` liczy już wysokość,
       pokrycie i liczbę zdjęć; tu domykamy pętlę i oddajemy to dronowi.
       Odpowiedź jest PLIKIEM, nie JSON-em — trafia prosto do pobrania. */
    if (p === '/api/plan/mission' && req.method === 'POST') {
      let d;
      try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      try {
        const punkty = Array.isArray(d.punkty) && d.punkty.length
          ? d.punkty
          : siatka({
            lat: Number(d.lat), lon: Number(d.lon),
            szerokoscM: Number(d.szerokoscM) || 200,
            dlugoscM: Number(d.dlugoscM) || 200,
            odstepM: Number(d.odstepM) || 50,
            kierunek: Number(d.kierunek) || 0,
          });
        const buf = misjaKmz(punkty, d);
        const nazwa = String(d.nazwa || 'misja').replace(/[^\w-]+/g, '-').slice(0, 40);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.google-earth.kmz',
          'Content-Length': buf.length,
          'Content-Disposition': `attachment; filename="${nazwa}.kmz"`,
        });
        addEvent('plan', `misja waypointowa: ${punkty.length} punktów`);
        return res.end(buf);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (p === '/api/canon/status' && req.method === 'GET') {
      return sendJson(res, 200, await canon.stan());
    }
    if (p === '/api/canon/settings') {
      if (!canon.skonfigurowany()) {
        return sendJson(res, 503, { error: 'Nie ustawiono CANON_CCAPI_URL — patrz .env.example.' });
      }
      try {
        if (req.method === 'GET') {
          const w = await canon.nastawy();
          return sendJson(res, 200, { ...w, liczby: canon.naLiczby(w.nastawy) });
        }
        if (req.method === 'PUT') {
          const d = await readJson(req);
          const zmiany = [];
          /* Kolejność ma znaczenie: najpierw ISO, potem przysłona, na końcu
             czas. Aparat sam koryguje pozostałe nastawy pod tę, którą właśnie
             zmieniono, więc ustawienie czasu jako ostatniego zostawia go
             takim, jakiego chcieliśmy. */
          for (const nazwa of ['iso', 'przyslona', 'czas']) {
            if (d[nazwa] === undefined || d[nazwa] === null || d[nazwa] === '') continue;
            zmiany.push(await canon.ustaw(nazwa, d[nazwa]));
          }
          if (!zmiany.length) return sendJson(res, 400, { error: 'Nie podano żadnej nastawy.' });
          addEvent('aparat', `nastawy zmienione: ${zmiany.map((z) => `${z.nazwa}=${z.wartosc}`).join(', ')}`);
          return sendJson(res, 200, { ok: true, zmiany });
        }
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }
    if (p === '/api/canon/shutter' && req.method === 'POST') {
      if (!canon.skonfigurowany()) {
        return sendJson(res, 503, { error: 'Nie ustawiono CANON_CCAPI_URL — patrz .env.example.' });
      }
      let d = {};
      try { d = await readJson(req); } catch { /* domyślne */ }
      try {
        const w = await canon.migawka({ af: d.af === true });
        addEvent('aparat', 'migawka wyzwolona zdalnie');
        return sendJson(res, 200, w);
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (p === '/api/gear') {
      if (req.method === 'GET') return sendJson(res, 200, userSprzet);
      if (req.method === 'PUT') {
        try { saveSprzet(await readJson(req)); return sendJson(res, 200, { ok: true, ...userSprzet }); }
        catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      }
    }
    if (p === '/api/profile') {
      if (req.method === 'GET') return sendJson(res, 200, { profile: userProfile });
      if (req.method === 'POST') {
        try { saveProfile((await readJson(req)).profile); return sendJson(res, 200, { ok: true }); }
        catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      }
    }
    if (p === '/api/location') {
      if (req.method === 'GET') return sendJson(res, 200, { location: userLocation, wspolrzedne: userWspolrzedne, teraz: terazTekst() });
      if (req.method === 'POST') {
        try {
          const d = await readJson(req);
          saveLocation(d.location, d.lat !== undefined ? { lat: Number(d.lat), lon: Number(d.lon) } : null);
          return sendJson(res, 200, { ok: true, location: userLocation, wspolrzedne: userWspolrzedne });
        }
        catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      }
    }
    if (p === '/api/location/resolve' && req.method === 'POST') return await handleGeokod(req, res);
    if (p === '/api/admin/stats' && req.method === 'GET') {
      let kbBytes = 0;
      try {
        for (const f of fs.readdirSync(KB_FILES)) {
          try { kbBytes += fs.statSync(path.join(KB_FILES, f)).size; } catch { /* skip */ }
        }
      } catch { /* brak katalogu */ }
      return sendJson(res, 200, {
        conversations: convIndex.length,
        memories: pamiec_.ile(),
        kbItems: kbItems.length,
        kbBytes,
        profileChars: userProfile.length,
        events: ileZdarzen(),
        engines: Object.keys(ENDPOINTS),
        studio: { image: imageProviders().length > 0, speech: Boolean(STUDIO.eleven.key), video: Boolean(STUDIO.seedance.key) },
        auth: authEnabled(),
      });
    }
    if (p === '/api/backup' && req.method === 'GET') {
      const convs = convIndex.map((meta) => {
        try { return JSON.parse(fs.readFileSync(convPath(meta.id), 'utf8')); } catch { return null; }
      }).filter(Boolean);
      const bundle = { version: 1, exportedAt: Date.now(), conversations: convs, memories: pamiec_.lista(), profile: userProfile };
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
      try { bundle = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      let restored = 0;
      if (Array.isArray(bundle.conversations)) {
        for (const conv of bundle.conversations) {
          if (!conv || !conv.id) continue;
          const id = String(conv.id).replace(/[^a-z0-9]/gi, '');
          try {
            zapiszAtomowo(convPath(id), JSON.stringify(conv));
            const meta = { id, title: conv.title || 'Rozmowa', createdAt: conv.createdAt || Date.now(), updatedAt: conv.updatedAt || Date.now(), pinned: conv.pinned || false };
            const i = convIndex.findIndex((c) => c.id === id);
            if (i >= 0) convIndex[i] = meta; else convIndex.push(meta);
            restored++;
          } catch { /* skip */ }
        }
        sortConvIndex(); saveConvIndex();
      }
      if (Array.isArray(bundle.memories)) pamiec_.ustawListe(bundle.memories);
      if (typeof bundle.profile === 'string') saveProfile(bundle.profile);
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
    if (p === '/api/timeline') return await handleTimeline(req, res);
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
    if (p === '/api/stt' && req.method === 'POST') return await proxySenses(req, res, '/stt');
    /* Ptak z dźwięku (BirdNET). Osobna trasa, a nie „jeszcze jeden tryb STT",
       bo to inne pytanie: nie „co ktoś powiedział", tylko „kto to śpiewa".
       Współrzędne dokłada SERWER z ustawień — przeglądarka nie musi ich znać,
       a BirdNET bez nich zawęża listę gatunków do całego świata zamiast do
       tego, co w tym tygodniu naprawdę lata nad Twoją łąką. */
    if (p === '/api/ptak' && req.method === 'POST') {
      const w = userWspolrzedne;
      const qs = w && Number.isFinite(w.lat)
        ? `?lat=${encodeURIComponent(w.lat)}&lon=${encodeURIComponent(w.lon)}`
        : '';
      return await proxySenses(req, res, '/ptak', { search: qs });
    }
    if (p === '/api/tts' && req.method === 'POST') return await proxySenses(req, res, '/tts', { json: true });
    if (p === '/api/detect' && req.method === 'POST') return await proxySenses(req, res, '/detect', { json: true });
    if (p === '/api/pose' && req.method === 'POST') return await proxySenses(req, res, '/pose', { json: true });
    if (p === '/api/kinect/stream' && req.method === 'GET') {
      return await proxySensesStream(req, res, '/kinect/stream',
        new URL(req.url, 'http://localhost').search);
    }
    if (p === '/api/kinect/frame' && req.method === 'GET') {
      return await proxySensesGet(req, res, '/kinect/frame',
        new URL(req.url, 'http://localhost').search);
    }
    if (p === '/api/kinect/status' && req.method === 'GET') {
      return await proxySensesGet(req, res, '/kinect/status');
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res);
    res.writeHead(405);
    res.end();
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: `Błąd serwera: ${err.message}` });
    else res.end();
  }
});

function start(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log('');
      console.log('  ✦ Cosmos');
      console.log(`  → UI:      http://localhost:${port}`);
      console.log(`  → Chmura:  ${ENDPOINTS.cloud.baseUrl}  (model: ${ENDPOINTS.cloud.model})`);
      console.log(`             klucz API: ${ENDPOINTS.cloud.apiKey ? 'ustawiony' : 'BRAK — ustaw NVIDIA_API_KEY w .env'}`);
      console.log(`  → Lokalny: ${ENDPOINTS.local.baseUrl}  (model: ${ENDPOINTS.local.model || 'nie ustawiono'})`);
      console.log(`  → Zmysły:  ${SENSES_URL}  (uruchom: python senses/service.py)`);
      console.log(`  → Pamięć:  ${pamiec_.ile()} wpisów (data/memory.json)`);
      console.log(`  → Baza wiedzy: ${kbItems.length} pozycji (data/kb/)`);
      console.log(`  → Rozmowy: ${convIndex.length} (data/conversations/)`);
      console.log(`  → Logowanie: ${authEnabled() ? 'WŁĄCZONE' : 'wyłączone (tryb domowy/localhost)'}`);
      if (!authEnabled()) {
        console.log('               ⚠  Nie wystawiaj tego serwera do internetu bez COSMOS_PASSWORD!');
      }
      const extraTabs = ['openai', 'claude'].filter((k) => ENDPOINTS[k]);
      if (extraTabs.length) console.log(`  → Silniki dodatkowe: ${extraTabs.join(', ')}`);
      const studioOn = [STUDIO.openai.key && 'obraz(OpenAI)', fireflyEnabled() && 'obraz(Firefly)',
        STUDIO.eleven.key && 'dźwięk(ElevenLabs)', STUDIO.seedance.key && 'wideo(Seedance)'].filter(Boolean);
      console.log(`  → Studio:  ${studioOn.length ? studioOn.join(', ') : 'brak kluczy (opcjonalne)'}` +
        (STUDIO.exportDir ? `  eksport → ${STUDIO.exportDir}` : ''));
      if (procedury().length || rutyny().length) {
        console.log(`  → Nauka:   ${wzorce().length} wzorców, ${procedury().length} procedur, ${rutyny().length} rutyn`);
      }
      if (secretsEnabled()) {
        console.log(`  → Sekrety: menedżer haseł „${SECRETS.provider}" (automatyzacja z logowaniem)`);
      }
      console.log('');
      startScheduler();
      resolve(server);
    });
  });
}

if (require.main === module) {
  start();
}

module.exports = { start, server, PORT };

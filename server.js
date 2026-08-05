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
  modelErrorHint, authHeaders, saveJsonFile, genId, fireflyEnabled, imageProviders, studioTasks,
} = require('./lib/rdzen.js');
const szukanie_ = require('./lib/szukanie.js');
const { handleSearch, handleSearchImages, handleImageProxy, stripTags } = szukanie_;
const { czytajLokalnie, OBSLUGIWANE: DOK_OBSLUGIWANE } = require('./lib/dokumenty.js');
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
// Pamięć długotrwała (RAG) — fakty zapisane przez użytkownika.
// Embeddingi liczy usługa zmysłów (/embed); bez niej działa
// wyszukiwanie słów kluczowych.
// ---------------------------------------------------------------------------

const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

let memories = [];
try { memories = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch { /* brak pliku */ }

function saveMemories() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2));
  } catch (err) {
    console.error('Nie udało się zapisać pamięci:', err.message);
  }
}

// timeoutMs: przy indeksowaniu (upload) dajemy modelowi czas na start (60 s),
// ale przy wyszukiwaniu w trakcie rozmowy czekamy krótko (5 s), żeby
// niedostępna usługa zmysłów nie opóźniała odpowiedzi czatu.
// Embeddingi: lokalnie przez zmysły (bge-m3 na Twoim GPU) albo z chmury NVIDII.
// „auto" = najpierw zmysły (za darmo, prywatnie), a gdy są offline — chmura.
// Dzięki temu baza wiedzy działa w pełni także wtedy, gdy komputer domowy śpi.
const EMBED = {
  provider: (process.env.EMBED_PROVIDER || 'auto').toLowerCase(), // auto | senses | nvidia | off
  nvidiaModel: process.env.NVIDIA_EMBED_MODEL || 'nvidia/llama-nemotron-embed-1b-v2',
};

async function embedViaSenses(texts, timeoutMs) {
  try {
    const r = await fetch(`${SENSES_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d.vectors) || !d.vectors.length) return null;
    return { vectors: d.vectors, model: `senses:${d.vectors[0].length}` };
  } catch {
    return null;
  }
}

async function embedViaNvidia(texts, timeoutMs, inputType) {
  const ep = ENDPOINTS.cloud;
  if (!ep.apiKey) return null;
  // Modele wyszukiwawcze rozróżniają pytanie od dokumentu (input_type). Gdy
  // dany model tego pola nie przyjmuje, powtarzamy żądanie bez niego.
  for (const withType of [true, false]) {
    try {
      const body = { input: texts, model: EMBED.nvidiaModel, encoding_format: 'float' };
      if (withType) {
        body.input_type = inputType === 'query' ? 'query' : 'passage';
        body.truncate = 'END';
      }
      const r = await fetch(`${ep.baseUrl}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(ep) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) {
        if (withType && (r.status === 400 || r.status === 422)) continue;  // spróbuj bez input_type
        return null;
      }
      const d = await r.json();
      const rows = Array.isArray(d.data) ? [...d.data] : [];
      if (!rows.length) return null;
      rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      const vectors = rows.map((x) => x.embedding).filter(Array.isArray);
      if (vectors.length !== texts.length) return null;
      return { vectors, model: `nvidia:${EMBED.nvidiaModel}` };
    } catch {
      return null;
    }
  }
  return null;
}

/** Zwraca { vectors, model } albo null. `model` znakuje wektory — patrz sameModel(). */
/* Bezpiecznik na wolne embeddingi.
 *
 * Gdy usługa raz nie wyrobiła się w budżecie, następne wywołania z krótkim
 * budżetem (te z rozmowy) nie czekają wcale — od razu idzie dopasowanie po
 * słowach kluczowych, a rozmowa rusza bez zwłoki. Po minucie próbujemy
 * ponownie: usługa mogła po prostu wstawać albo liczyć coś ciężkiego.
 *
 * Bez tego cisza 1,2 s wracała przy KAŻDEJ wiadomości — dokładnie ten rodzaj
 * drobnego tarcia, który sprawia, że narzędzie „jakoś tak mierzi".
 */
const embedAwaria = { do: 0 };
const EMBED_KARENCJA_MS = 60000;
/* Poniżej tego budżetu wywołanie uznajemy za „z rozmowy" — takie odpuszczamy
   po awarii. Przeliczanie w tle (60 s) idzie zawsze, bo nikt na nie nie czeka. */
const EMBED_BUDZET_ROZMOWY_MS = 5000;

async function embedTexts(texts, timeoutMs = 60000, inputType = 'passage') {
  if (!texts || !texts.length || EMBED.provider === 'off') return null;
  if (timeoutMs <= EMBED_BUDZET_ROZMOWY_MS && Date.now() < embedAwaria.do) return null;
  const order = EMBED.provider === 'senses' ? ['senses']
    : EMBED.provider === 'nvidia' ? ['nvidia']
    : ['senses', 'nvidia'];
  for (const src of order) {
    const out = src === 'senses'
      ? await embedViaSenses(texts, timeoutMs)
      : await embedViaNvidia(texts, timeoutMs, inputType);
    if (out) { embedAwaria.do = 0; return out; }
  }
  // Nikt nie odpowiedział — przez chwilę nie zatrzymujemy dla nich rozmowy.
  embedAwaria.do = Date.now() + EMBED_KARENCJA_MS;
  return null;
}

/** Który dostawca embeddingów realnie zadziała przy obecnej konfiguracji. */
function embedStatus(sensesHasEmbed) {
  if (EMBED.provider === 'off') return { provider: 'off', model: null, opis: 'wyłączone' };
  const cloudReady = Boolean(ENDPOINTS.cloud.apiKey);
  if (EMBED.provider === 'nvidia') {
    return { provider: cloudReady ? 'nvidia' : null, model: EMBED.nvidiaModel,
      opis: cloudReady ? `chmura NVIDIA (${EMBED.nvidiaModel})` : 'brak NVIDIA_API_KEY' };
  }
  if (EMBED.provider === 'senses') {
    return { provider: sensesHasEmbed ? 'senses' : null, model: 'bge-m3',
      opis: sensesHasEmbed ? 'zmysły lokalnie' : 'zmysły offline — wyszukiwanie po słowach kluczowych' };
  }
  if (sensesHasEmbed) return { provider: 'senses', model: 'bge-m3', opis: 'zmysły lokalnie' };
  if (cloudReady) {
    return { provider: 'nvidia', model: EMBED.nvidiaModel,
      opis: `zmysły offline → chmura NVIDIA (${EMBED.nvidiaModel})` };
  }
  return { provider: null, model: null, opis: 'brak — wyszukiwanie po słowach kluczowych' };
}

/** Wektory z różnych modeli są nieporównywalne — pilnujemy zgodności znacznika. */
function sameModel(item, model) {
  return Boolean(item.embedding) && (item.embModel || null) === model;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function keywords(text) {
  return new Set(
    text.toLowerCase().split(/[^a-ząćęłńóśźż0-9]+/i).filter((w) => w.length >= 4)
  );
}

function keywordScore(query, text) {
  const q = keywords(query);
  if (!q.size) return 0;
  const t = keywords(text);
  let hits = 0;
  for (const w of q) if (t.has(w)) hits++;
  return hits / Math.sqrt(q.size * Math.max(t.size, 1));
}

/* Przeliczanie wektorów w tle. NIE w ścieżce czatu.
 *
 * Wektory z różnych modeli są nieporównywalne, więc po zmianie dostawcy
 * embeddingów trzeba przeliczyć całą pamięć. Kiedyś robiliśmy to wewnątrz
 * `searchMemory`, z limitem 60 s — użytkownik patrzył w pustkę, zanim model
 * w ogóle dostał prompt. Pomiar: 5 s ciszy przy KAŻDEJ wiadomości, gdy
 * usługa embeddingów była wolna. Teraz pamięć doucza się sama, w tle,
 * a rozmowa idzie dalej na dopasowaniu słów kluczowych.
 */
let uzupelnianieTrwa = false;
function uzupelnijWektoryWTle(qmodel) {
  if (uzupelnianieTrwa) return;
  const brakujace = memories.filter((m) => !sameModel(m, qmodel));
  if (!brakujace.length) return;
  uzupelnianieTrwa = true;
  setTimeout(async () => {
    try {
      const embs = await embedTexts(brakujace.map((m) => m.text), 60000, 'passage');
      if (embs) {
        brakujace.forEach((m, i) => { m.embedding = embs.vectors[i]; m.embModel = embs.model; });
        saveMemories();
      }
    } catch { /* następnym razem */ } finally { uzupelnianieTrwa = false; }
  }, 0);
}

/* Ile wolno czekać na embedding zapytania, zanim odpuścimy i użyjemy słów
   kluczowych. Przywołanie pamięci jest miłym dodatkiem — wstrzymywanie dla
   niego całej rozmowy nie jest. */
const BUDZET_PAMIECI_MS = Number(process.env.MEMORY_SEARCH_BUDGET_MS || 1200);

async function searchMemory(query, limit = 4) {
  if (!memories.length || !query || !query.trim()) return [];

  let qvec = null, qmodel = null;
  const q = await embedTexts([query], BUDZET_PAMIECI_MS, 'query');
  if (q) {
    qvec = q.vectors[0];
    qmodel = q.model;
    uzupelnijWektoryWTle(qmodel);   // w tle, nie blokuje odpowiedzi
  }

  const threshold = qvec ? 0.35 : 0.15;
  return memories
    .map((m) => ({
      m,
      score: (qvec && sameModel(m, qmodel)) ? cosine(qvec, m.embedding) : keywordScore(query, m.text),
    }))
    .filter((s) => s.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.m);
}

function memoryContextLines(items) {
  if (!items.length) return '';
  const lines = items.map((m) => {
    const d = new Date(m.time).toLocaleDateString('pl-PL');
    return `- [zapisano ${d}] ${m.text}`;
  });
  return 'PAMIĘĆ DŁUGOTRWAŁA — fakty, które użytkownik kazał Ci wcześniej zapamiętać ' +
         '(przywołane, bo pasują do bieżącej rozmowy):\n' + lines.join('\n');
}

async function handleMemory(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET') {
    return sendJson(res, 200, {
      memories: memories.map(({ id, text, time, embedding }) => ({
        id, text, time, hasEmbedding: Boolean(embedding),
      })),
    });
  }
  if (req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const text = String(data.text || '').trim().slice(0, 2000);
    if (!text) return sendJson(res, 400, { error: 'Puste pole text.' });
    const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, time: Date.now(), embedding: null };
    const vecs = await embedTexts([text], 60000, 'passage');
    if (vecs) { item.embedding = vecs.vectors[0]; item.embModel = vecs.model; }
    memories.push(item);
    saveMemories();
    return sendJson(res, 200, { ok: true, id: item.id, hasEmbedding: Boolean(item.embedding), total: memories.length });
  }
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    const before = memories.length;
    memories = memories.filter((m) => m.id !== id);
    if (memories.length !== before) saveMemories();
    return sendJson(res, 200, { ok: true, total: memories.length });
  }
  res.writeHead(405);
  res.end();
}

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
    fs.mkdirSync(CONV_DIR, { recursive: true });
    fs.writeFileSync(CONV_INDEX, JSON.stringify(convIndex));
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

// Profil użytkownika — trwały tekst wstrzykiwany do każdej rozmowy (pamięć profilowa).
const PROFILE_FILE = path.join(DATA_DIR, 'profile.txt');
let userProfile = '';
try { userProfile = fs.readFileSync(PROFILE_FILE, 'utf8'); } catch { /* brak */ }
function saveProfile(text) {
  userProfile = String(text || '').slice(0, 4000);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(PROFILE_FILE, userProfile); }
  catch (err) { console.error('Nie udało się zapisać profilu:', err.message); }
}

/* Lokalizacja domowa — osobno od profilu, bo używa jej nie tylko rozmowa,
   ale i wyszukiwanie („warsztat … w Złotokłosie"). Bez niej model pyta
   „w jakim mieście jesteś?" przy każdym pytaniu o cokolwiek w okolicy. */
const LOCATION_FILE = path.join(DATA_DIR, 'location.txt');
let userLocation = '';
try { userLocation = fs.readFileSync(LOCATION_FILE, 'utf8'); } catch { /* brak */ }
function saveLocation(text) {
  userLocation = String(text || '').trim().slice(0, 200);
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(LOCATION_FILE, userLocation); }
  catch (err) { console.error('Nie udało się zapisać lokalizacji:', err.message); }
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
    addEvent('lokalizacja', `Ustalono lokalizację: ${nazwa}`);
    return sendJson(res, 200, { location: nazwa });
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
      fs.writeFileSync(convPath(id), JSON.stringify(conv));
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
      fs.mkdirSync(CONV_DIR, { recursive: true });
      fs.writeFileSync(convPath(id), JSON.stringify(conv));
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
    fs.writeFileSync(KB_INDEX, JSON.stringify(kbItems));
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
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(TIMELINE_FILE, JSON.stringify(timeline)); }
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
    wiedza: { rozmowy: convIndex.length, pamiec: memories.length, bazaWiedzy: kbItems.length,
      profil: userProfile.trim().length > 0, migawki: timeline.length },
    nauka: { wzorce: wzorce().length, procedury: procedury().length, rutyny: rutyny().length,
      nagrywanieEkranu: playwright, automatyzacjaOdczytu: playwright,
      menedzerHasel: secretsEnabled() ? SECRETS.provider : null },
    dom: { urzadzenia: urzadzenia().map((d) => d.name), odprawa: Boolean(BRIEFING.lat && BRIEFING.lon),
      kalendarz: Boolean(BRIEFING.ics) },
    teren: { photoscan: moduleExists('senses', 'photoscan.py'),
      terrain: moduleExists('senses', 'terrain.py') },
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

// --- Backlog usprawnień: pomysły Cosmosa na samego siebie, zatwierdzane przez Ciebie ---
const IMPROVE_FILE = path.join(DATA_DIR, 'improvements.json');
let improvements = [];
try { improvements = JSON.parse(fs.readFileSync(IMPROVE_FILE, 'utf8')); } catch { /* brak */ }
const saveImprovements = () => saveJsonFile(IMPROVE_FILE, improvements);

async function handleImprovements(req, res, pathname) {
  if (pathname === '/api/improvements' && req.method === 'GET') {
    return sendJson(res, 200, { improvements });
  }
  if (pathname === '/api/improvements' && req.method === 'POST') {
    let data; try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const text = String(data.text || '').trim().slice(0, 1000);
    if (!text) return sendJson(res, 400, { error: 'Pusty pomysł.' });
    const item = { id: genId(), text, zrodlo: data.zrodlo === 'model' ? 'model' : 'ja',
      status: 'nowy', createdAt: Date.now() };
    improvements.push(item);
    saveImprovements();
    addEvent('rozwój', `nowy pomysł na usprawnienie: ${text.slice(0, 80)}`);
    return sendJson(res, 200, { ok: true, id: item.id });
  }
  if (pathname === '/api/improvements' && req.method === 'PUT') {
    let data; try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const it = improvements.find((x) => x.id === data.id);
    if (!it) return sendJson(res, 404, { error: 'Nie znaleziono.' });
    if (['nowy', 'zaakceptowany', 'odrzucony', 'zrobione'].includes(data.status)) it.status = data.status;
    saveImprovements();
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/improvements' && req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    improvements = improvements.filter((x) => x.id !== id);
    saveImprovements();
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405); res.end();
}

/** Zamień surową wypowiedź w precyzyjny prompt.
 *
 * Dyktowana wiadomość jest z natury luźna: powtórzenia, „yyy", myśl zmieniana
 * w połowie zdania. Model dostaje ją do przepisania — ma zachować INTENCJĘ
 * i wszystkie szczegóły, a uporządkować formę. Zwracamy sam tekst, bez
 * komentarzy, żeby dało się nim po prostu podmienić zawartość pola.
 */
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
async function handleSuggest(req, res) {
  const m = await capabilityManifest();
  const titles = convIndex.slice(0, 25).map((c) => c.title).filter(Boolean);
  const kbNames = kbItems.slice(-25).map((it) => it.name).filter(Boolean);
  const known = improvements.map((i) => i.text.slice(0, 60));

  const context = [
    capabilityText(m),
    userProfile.trim() ? '\nPROFIL UŻYTKOWNIKA:\n' + userProfile.trim() : '',
    titles.length ? '\nOSTATNIE TEMATY ROZMÓW:\n- ' + titles.join('\n- ') : '',
    kbNames.length ? '\nCO JEST W BAZIE WIEDZY:\n- ' + kbNames.join('\n- ') : '',
    known.length ? '\nJUŻ ZAPROPONOWANE (nie powtarzaj):\n- ' + known.join('\n- ') : '',
  ].filter(Boolean).join('\n');

  const lang = (req.headers['x-cosmos-lang'] === 'en') ? 'en' : 'pl';
  const instruction = lang === 'en'
    ? 'You are Cosmos. Based on your real capabilities and this user\'s context, propose 4 concrete, '
      + 'personal ways they could use you that they probably have not thought of. Skip anything already '
      + 'listed. For each: a bold one-line title, two sentences on the value, and a short "How:" line with '
      + 'the exact steps or what to enable. Only propose things your listed capabilities actually allow.'
    : 'Jesteś Cosmosem. Na podstawie swoich REALNYCH możliwości i kontekstu tego użytkownika zaproponuj '
      + '4 konkretne, osobiste sposoby wykorzystania siebie, na które on prawdopodobnie nie wpadł. '
      + 'Pomiń to, co już zaproponowane. Każdy pomysł: pogrubiony tytuł w jednej linii, dwa zdania '
      + 'o wartości, oraz krótka linia „Jak:" z dokładnymi krokami albo co włączyć. '
      + 'Proponuj wyłącznie rzeczy, na które pozwalają wymienione możliwości. Bez lania wody.';

  try {
    const text = await llmComplete([
      { role: 'system', content: instruction },
      { role: 'user', content: context },
    ], { endpoint: 'cloud', maxTokens: 900 });
    addEvent('rozwój', 'Cosmos zaproponował nowe zastosowania');
    return sendJson(res, 200, { ok: true, text });
  } catch (err) {
    return sendJson(res, 502, { error: 'suggest-failed', message: err.message });
  }
}

// --- Nagrywanie procedur (opcjonalny moduł Playwright, wymaga ekranu) ---
const RECORDER_SCRIPT = path.join(__dirname, 'automation', 'recorder.js');
let recordJob = null; // { child, status, outFile, startedAt, log:[] }
const RECORD_OUT = path.join(TRAIN_DIR, 'recording.json');

function recLog(line) {
  if (!recordJob) return;
  for (const l of String(line).split('\n')) { const s = l.replace(/\s+$/, ''); if (s) recordJob.log.push(s); }
  if (recordJob.log.length > 100) recordJob.log = recordJob.log.slice(-100);
}

async function handleRecord(req, res, pathname) {
  if (pathname === '/api/procedures/record/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      recording: Boolean(recordJob && recordJob.status === 'recording'),
      status: recordJob ? recordJob.status : 'idle',
      log: recordJob ? recordJob.log.slice(-20) : [],
    });
  }
  if (pathname === '/api/procedures/record/start' && req.method === 'POST') {
    let available = false; try { require.resolve('playwright'); available = true; } catch { /* */ }
    if (!available) return sendJson(res, 400, { error: 'no-playwright', message: 'Moduł automatyzacji nie jest zainstalowany (npm install playwright).' });
    if (recordJob && recordJob.status === 'recording') return sendJson(res, 409, { error: 'busy', message: 'Nagrywanie już trwa.' });
    let data = {}; try { data = await readJson(req); } catch { /* */ }
    const url = String(data.url || '').slice(0, 500);
    fs.mkdirSync(TRAIN_DIR, { recursive: true });
    try { fs.unlinkSync(RECORD_OUT); } catch { /* */ }
    const args = [RECORDER_SCRIPT];
    if (/^https?:\/\//i.test(url)) { args.push('--url', url); }
    recordJob = { status: 'recording', startedAt: Date.now(), outFile: RECORD_OUT, log: [], child: null };
    let child;
    try { child = spawn('node', args, { cwd: path.join(__dirname, 'automation'), env: { ...process.env, COSMOS_RECORD_OUT: RECORD_OUT }, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (err) { recordJob.status = 'error'; return sendJson(res, 500, { error: 'spawn-failed', message: err.message }); }
    recordJob.child = child;
    child.stdout.on('data', (d) => recLog(d));
    child.stderr.on('data', (d) => recLog(d));
    child.on('close', () => { if (recordJob && recordJob.status === 'recording') recordJob.status = 'ready'; });
    addEvent('nauka', 'rozpoczęto nagrywanie procedury');
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/procedures/record/stop' && req.method === 'POST') {
    if (!recordJob) return sendJson(res, 400, { error: 'not-recording' });
    let data = {}; try { data = await readJson(req); } catch { /* */ }
    // zatrzymaj proces (nagrywarka flushuje kroki przy SIGTERM/zamknięciu okna)
    if (recordJob.child && recordJob.status === 'recording') { try { recordJob.child.kill('SIGTERM'); } catch { /* */ } }
    await new Promise((r) => setTimeout(r, 600)); // daj czas na flush
    let parsed = { steps: [] };
    try { parsed = JSON.parse(fs.readFileSync(RECORD_OUT, 'utf8')); } catch { /* brak */ }
    recordJob.status = 'idle';
    if (parsed.error) return sendJson(res, 400, { error: parsed.error, message: 'Nagrywanie nie powiodło się (brak ekranu lub przeglądarki).' });
    const steps = Array.isArray(parsed.steps) ? parsed.steps.slice(0, 60).map(sanitizeStep) : [];
    if (!steps.length) return sendJson(res, 200, { ok: true, id: null, steps: [], message: 'Nie zarejestrowano żadnych kroków.' });
    const name = String(data.name || '').trim().slice(0, 120) || `Nagranie ${new Date().toLocaleString('pl-PL')}`;
    const item = { id: genId(), name, description: 'Nagrana automatycznie.', scope: 'web', steps, createdAt: Date.now(), updatedAt: Date.now() };
    dodajProcedure(item); saveProcedures();
    addEvent('nauka', `zapisano nagraną procedurę: ${name} (${steps.length} kroków)`);
    return sendJson(res, 200, { ok: true, id: item.id, steps, name });
  }
  res.writeHead(405); res.end();
}

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

async function proxySenses(req, res, targetPath, { json = false } = {}) {
  let upstream;
  try {
    const body = await readBodyBuffer(req);
    upstream = await fetch(`${SENSES_URL}${targetPath}`, {
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
        'odpowiedzi, podając źródła. Gdy znasz odpowiedź lub pytanie dotyczy rozmowy/obrazu, ' +
        'odpowiadaj normalnie, bez [SZUKAJ:].\n' +
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
        'użytkownika, które z wymienionych miejsc chce zobaczyć — pokaż kilka najlepszych.',
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

  const abort = new AbortController();
  req.on('close', () => abort.abort());

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
    for await (const chunk of upstream.body) {
      res.write(chunk);
    }
  } catch {
    /* klient przerwał lub upstream padł — kończymy strumień */
  }
  res.end();
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
  keywordScore, sameModel, saveKb });

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
    if (p === '/api/polish' && req.method === 'POST') return await handlePolish(req, res);
    if (p === '/api/events') return await handleEvents(req, res);
    // Kanał w drugą stronę: przeglądarka dowiaduje się o zdarzeniach zamiast
    // tylko je wysyłać. Dzięki temu „Hej, Kosmos" wykryte na komputerze
    // dociera do telefonu, a nie umiera w logu serwera.
    if (p === '/api/events/stream' && req.method === 'GET') return podlaczStrumien(req, res);
    if (p === '/api/memory') return await handleMemory(req, res);
    if (p === '/api/search' && req.method === 'GET') return await handleSearch(req, res);
    if (p === '/api/document' && req.method === 'POST') return await handleDokument(req, res);
    if (p === '/api/search/images' && req.method === 'GET') return await handleSearchImages(req, res);
    if (p === '/api/search/thumb' && req.method === 'GET') return await handleImageProxy(req, res);
    if (p === '/api/conversations' || p === '/api/conversations/meta' || p === '/api/conversations/search') return await handleConversations(req, res, p);
    if (p === '/api/profile') {
      if (req.method === 'GET') return sendJson(res, 200, { profile: userProfile });
      if (req.method === 'POST') {
        try { saveProfile((await readJson(req)).profile); return sendJson(res, 200, { ok: true }); }
        catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      }
    }
    if (p === '/api/location') {
      if (req.method === 'GET') return sendJson(res, 200, { location: userLocation, teraz: terazTekst() });
      if (req.method === 'POST') {
        try { saveLocation((await readJson(req)).location); return sendJson(res, 200, { ok: true, location: userLocation }); }
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
        memories: memories.length,
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
      const bundle = { version: 1, exportedAt: Date.now(), conversations: convs, memories, profile: userProfile };
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
            fs.mkdirSync(CONV_DIR, { recursive: true });
            fs.writeFileSync(convPath(id), JSON.stringify(conv));
            const meta = { id, title: conv.title || 'Rozmowa', createdAt: conv.createdAt || Date.now(), updatedAt: conv.updatedAt || Date.now(), pinned: conv.pinned || false };
            const i = convIndex.findIndex((c) => c.id === id);
            if (i >= 0) convIndex[i] = meta; else convIndex.push(meta);
            restored++;
          } catch { /* skip */ }
        }
        sortConvIndex(); saveConvIndex();
      }
      if (Array.isArray(bundle.memories)) { memories = bundle.memories; saveMemories(); }
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
      console.log(`  → Pamięć:  ${memories.length} wpisów (data/memory.json)`);
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

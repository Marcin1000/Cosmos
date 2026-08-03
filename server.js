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

loadDotEnv(path.join(__dirname, '.env'));

const ENDPOINTS = {
  cloud: {
    label: 'Chmura NVIDIA',
    baseUrl: (process.env.NEMOTRON_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.NVIDIA_API_KEY || '',
    model: process.env.NEMOTRON_MODEL || 'nvidia/nemotron-nano-9b-v2',
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

const studioTasks = new Map(); // taskId -> { prompt } (zadania wideo w toku)

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

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------------------------
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
// Magazyn zdarzeń percepcji (pamięć krótkotrwała „zmysłów”)
// ---------------------------------------------------------------------------

const EVENTS_MAX = 100;
const events = []; // { time, type, summary }

function addEvent(type, summary) {
  events.push({ time: Date.now(), type: String(type || 'event'), summary: String(summary || '').slice(0, 400) });
  if (events.length > EVENTS_MAX) events.splice(0, events.length - EVENTS_MAX);
}

function recentEvents(maxAgeMs = 10 * 60 * 1000, limit = 12) {
  const cutoff = Date.now() - maxAgeMs;
  return events.filter((e) => e.time >= cutoff).slice(-limit);
}

function sceneContext() {
  const recent = recentEvents();
  if (!recent.length) return '';
  const lines = recent.map((e) => {
    const t = new Date(e.time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `[${t}] (${e.type}) ${e.summary}`;
  });
  return 'KONTEKST PERCEPCJI — ostatnie zdarzenia z czujników (kamera/mikrofon/czujniki użytkownika). ' +
         'Traktuj je jako to, co właśnie widzisz i słyszysz w otoczeniu użytkownika:\n' + lines.join('\n');
}

// ---------------------------------------------------------------------------
// Pamięć długotrwała (RAG) — fakty zapisane przez użytkownika.
// Embeddingi liczy usługa zmysłów (/embed); bez niej działa
// wyszukiwanie słów kluczowych.
// ---------------------------------------------------------------------------

const DATA_DIR = path.join(__dirname, 'data');
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
async function embedTexts(texts, timeoutMs = 60000, inputType = 'passage') {
  if (!texts || !texts.length || EMBED.provider === 'off') return null;
  const order = EMBED.provider === 'senses' ? ['senses']
    : EMBED.provider === 'nvidia' ? ['nvidia']
    : ['senses', 'nvidia'];
  for (const src of order) {
    const out = src === 'senses'
      ? await embedViaSenses(texts, timeoutMs)
      : await embedViaNvidia(texts, timeoutMs, inputType);
    if (out) return out;
  }
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

async function searchMemory(query, limit = 4) {
  if (!memories.length || !query || !query.trim()) return [];

  let qvec = null, qmodel = null;
  const q = await embedTexts([query], 5000, 'query');
  if (q) {
    qvec = q.vectors[0];
    qmodel = q.model;
    // Uzupełnij wpisy bez embeddingu ORAZ policzone innym modelem — wektory
    // z różnych modeli są nieporównywalne, więc trzeba je przeliczyć.
    const missing = memories.filter((m) => !sameModel(m, qmodel));
    if (missing.length) {
      const embs = await embedTexts(missing.map((m) => m.text), 60000, 'passage');
      if (embs) {
        missing.forEach((m, i) => { m.embedding = embs.vectors[i]; m.embModel = embs.model; });
        saveMemories();
      }
    }
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

async function extractKbText(name, mime, buf) {
  const ext = extOf(name);
  if (TEXT_EXTS.has(ext) || /^text\//.test(mime || '')) {
    return buf.toString('utf8').slice(0, 200000);
  }
  if (OFFICE_EXTS.has(ext)) return (await sensesExtract(name, buf)).slice(0, 200000);
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
// NAUKA — uczenie Cosmosa.
//   1) Rozpoznawanie przez zmysły ("pokaż w kamerze"): zapamiętane wzorce
//      (etykieta + opis + embedding + miniatura). Później dopasowywane do
//      tego, co widzą zmysły — jak pamięć długotrwała, ale dla obrazu/gestu.
//   2) Procedury ("pokaż kroki"): nauczona sekwencja czynności w przeglądarce,
//      z krokami oznaczonymi jako wrażliwe (płatność, wysłanie) — te zawsze
//      wymagają potwierdzenia użytkownika.
//   3) Rutyny: cykliczny harmonogram odpalania procedur. Domyślnie tryb
//      "prepare" — Cosmos przygotowuje czynność, ale nic nieodwracalnego nie
//      robi sam. Scheduler tylko zgłasza, że nadszedł czas.
// ---------------------------------------------------------------------------

const LESSONS_FILE = path.join(DATA_DIR, 'lessons.json');
const PROCEDURES_FILE = path.join(DATA_DIR, 'procedures.json');
const ROUTINES_FILE = path.join(DATA_DIR, 'routines.json');

let lessons = [];
let procedures = [];
let routines = [];
try { lessons = JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8')); } catch { /* brak */ }
try { procedures = JSON.parse(fs.readFileSync(PROCEDURES_FILE, 'utf8')); } catch { /* brak */ }
try { routines = JSON.parse(fs.readFileSync(ROUTINES_FILE, 'utf8')); } catch { /* brak */ }

function saveJsonFile(file, data) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (err) { console.error(`Nie udało się zapisać ${path.basename(file)}:`, err.message); }
}
const saveLessons = () => saveJsonFile(LESSONS_FILE, lessons);
const saveProcedures = () => saveJsonFile(PROCEDURES_FILE, procedures);
const saveRoutines = () => saveJsonFile(ROUTINES_FILE, routines);

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function lessonDescriptor(l) {
  return [l.label, l.note, (l.objects || []).join(', ')].filter(Boolean).join('. ');
}

// --- 1) Rozpoznawanie ---
async function handleLessons(req, res, pathname) {
  if (pathname === '/api/lessons' && req.method === 'GET') {
    return sendJson(res, 200, {
      lessons: lessons.map((l) => ({
        id: l.id, label: l.label, kind: l.kind, note: l.note,
        objects: l.objects || [], thumbId: l.thumbId, createdAt: l.createdAt,
        hasEmbedding: Boolean(l.embedding),
      })),
    });
  }
  if (pathname === '/api/lessons' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const label = String(data.label || '').trim().slice(0, 120);
    if (!label) return sendJson(res, 400, { error: 'Podaj nazwę tego, czego Cosmos ma się nauczyć.' });
    const kind = ['object', 'gesture', 'pose', 'scene'].includes(data.kind) ? data.kind : 'object';
    let thumbId = null;
    if (data.image) {
      try {
        const buf = Buffer.from(String(data.image).split(',').pop(), 'base64');
        const item = await kbAddFile(tsName('wzorzec', 'jpg'), 'image/jpeg', buf, `Wzorzec nauki: ${label}`);
        thumbId = item.id;
      } catch { /* bez miniatury */ }
    }
    const item = {
      id: genId(), label, kind, note: String(data.note || '').slice(0, 400),
      objects: Array.isArray(data.objects) ? data.objects.slice(0, 40) : [],
      thumbId, createdAt: Date.now(), embedding: null,
    };
    const vecs = await embedTexts([lessonDescriptor(item)], 60000, 'passage');
    if (vecs) { item.embedding = vecs.vectors[0]; item.embModel = vecs.model; }
    lessons.push(item);
    saveLessons();
    addEvent('nauka', `nauczono rozpoznawać: ${label}`);
    return sendJson(res, 200, { ok: true, id: item.id, hasEmbedding: Boolean(item.embedding) });
  }
  if (pathname === '/api/lessons' && req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const l = lessons.find((x) => x.id === id);
    if (l?.thumbId) { try { fs.unlinkSync(path.join(KB_FILES, l.thumbId)); } catch { /* skip */ }
      kbItems = kbItems.filter((it) => it.id !== l.thumbId); saveKb(); }
    lessons = lessons.filter((x) => x.id !== id);
    saveLessons();
    return sendJson(res, 200, { ok: true });
  }
  // dopasowanie: co z tego, co widać, Cosmos już zna?
  if (pathname === '/api/lessons/match' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const matches = await matchLessons(String(data.text || ''), Array.isArray(data.objects) ? data.objects : []);
    return sendJson(res, 200, { matches });
  }
  res.writeHead(405); res.end();
}

async function matchLessons(text, objects, limit = 4) {
  if (!lessons.length) return [];
  const queryText = [text, objects.join(', ')].filter(Boolean).join('. ');
  if (!queryText.trim()) return [];
  let qvec = null, qmodel = null;
  const q = await embedTexts([queryText], 5000, 'query');
  if (q) {
    qvec = q.vectors[0];
    qmodel = q.model;
    const missing = lessons.filter((l) => !sameModel(l, qmodel));
    if (missing.length) {
      const embs = await embedTexts(missing.map(lessonDescriptor), 60000, 'passage');
      if (embs) {
        missing.forEach((l, i) => { l.embedding = embs.vectors[i]; l.embModel = embs.model; });
        saveLessons();
      }
    }
  }
  const objSet = new Set(objects.map((o) => String(o).toLowerCase()));
  const threshold = qvec ? 0.4 : 0.2;
  return lessons
    .map((l) => {
      let score = (qvec && sameModel(l, qmodel)) ? cosine(qvec, l.embedding) : keywordScore(queryText, lessonDescriptor(l));
      // premia, gdy wykryte obiekty pokrywają się z obiektami wzorca
      const overlap = (l.objects || []).filter((o) => objSet.has(String(o).toLowerCase())).length;
      if (overlap) score += 0.15 * overlap;
      return { l, score };
    })
    .filter((s) => s.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ id: s.l.id, label: s.l.label, kind: s.l.kind, note: s.l.note, score: Math.round(s.score * 100) / 100 }));
}

// --- 2) Procedury ---
function sanitizeStep(s) {
  const action = ['open', 'click', 'type', 'read', 'wait', 'confirm', 'note'].includes(s.action) ? s.action : 'note';
  return {
    action,
    target: String(s.target || '').slice(0, 500),
    value: String(s.value || '').slice(0, 500),
    // krok wrażliwy = nieodwracalny (płatność, wysłanie, potwierdzenie); zawsze wymaga zgody
    sensitive: Boolean(s.sensitive) || action === 'confirm',
    // krok logowania (type/click) — może użyć sekretu z menedżera haseł; dozwolony w trybie auto
    auth: Boolean(s.auth) && (action === 'type' || action === 'click'),
    note: String(s.note || '').slice(0, 300),
  };
}

async function handleProcedures(req, res, pathname) {
  const url = new URL(req.url, 'http://localhost');
  if (pathname === '/api/procedures' && req.method === 'GET') {
    return sendJson(res, 200, { procedures: procedures.map((p) => ({ ...p, readOnly: autoEligibility(p).eligible, needsAuth: autoEligibility(p).needsAuth })) });
  }
  if (pathname === '/api/procedures' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const name = String(data.name || '').trim().slice(0, 120);
    if (!name) return sendJson(res, 400, { error: 'Podaj nazwę procedury.' });
    const steps = Array.isArray(data.steps) ? data.steps.slice(0, 60).map(sanitizeStep) : [];
    const item = {
      id: genId(), name, description: String(data.description || '').slice(0, 600),
      scope: 'web', steps, createdAt: Date.now(), updatedAt: Date.now(),
    };
    procedures.push(item);
    saveProcedures();
    addEvent('nauka', `nauczono procedury: ${name} (${steps.length} kroków)`);
    return sendJson(res, 200, { ok: true, id: item.id });
  }
  if (pathname === '/api/procedures' && req.method === 'PUT') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const p = procedures.find((x) => x.id === data.id);
    if (!p) return sendJson(res, 404, { error: 'Nie znaleziono procedury.' });
    if (data.name != null) p.name = String(data.name).trim().slice(0, 120) || p.name;
    if (data.description != null) p.description = String(data.description).slice(0, 600);
    if (Array.isArray(data.steps)) p.steps = data.steps.slice(0, 60).map(sanitizeStep);
    p.updatedAt = Date.now();
    saveProcedures();
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/procedures' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    procedures = procedures.filter((x) => x.id !== id);
    routines = routines.filter((r) => r.procedureId !== id); saveRoutines();
    saveProcedures();
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405); res.end();
}

// --- 3) Rutyny (harmonogram) ---
function computeNextRun(schedule, from = Date.now()) {
  const s = schedule || {};
  if (s.type === 'interval') {
    const mins = Math.max(1, Number(s.everyMinutes) || 60);
    return from + mins * 60 * 1000;
  }
  const [hh, mm] = String(s.time || '09:00').split(':').map((n) => parseInt(n, 10) || 0);
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setHours(hh, mm, 0, 0);
  if (s.type === 'weekly') {
    const target = Math.min(6, Math.max(0, Number(s.day) || 0));
    let add = (target - d.getDay() + 7) % 7;
    if (add === 0 && d.getTime() <= from) add = 7;
    d.setDate(d.getDate() + add);
  } else if (s.type === 'monthly') {
    const dom = Math.min(28, Math.max(1, Number(s.day) || 1));
    d.setDate(dom);
    if (d.getTime() <= from) d.setMonth(d.getMonth() + 1);
  } else { // daily
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

function routineView(r) {
  const proc = procedures.find((p) => p.id === r.procedureId);
  return { ...r, procedureName: proc ? proc.name : '(usunięta procedura)' };
}

async function handleRoutines(req, res, pathname) {
  const url = new URL(req.url, 'http://localhost');
  if (pathname === '/api/routines' && req.method === 'GET') {
    return sendJson(res, 200, { routines: routines.map(routineView) });
  }
  if (pathname === '/api/routines/due' && req.method === 'GET') {
    return sendJson(res, 200, { due: routines.filter((r) => r.pending).map(routineView) });
  }
  if (pathname === '/api/routines' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    if (!procedures.find((p) => p.id === data.procedureId)) {
      return sendJson(res, 400, { error: 'Wskaż istniejącą procedurę.' });
    }
    const schedule = {
      type: ['daily', 'weekly', 'monthly', 'interval'].includes(data.type) ? data.type : 'daily',
      time: String(data.time || '09:00').slice(0, 5),
      day: Number(data.day) || 0,
      everyMinutes: Number(data.everyMinutes) || 60,
    };
    const item = {
      id: genId(), procedureId: data.procedureId, schedule,
      // "prepare": przygotuj i poproś o potwierdzenie (bezpieczne, domyślne).
      // "auto-read": tylko czynności do odczytu mogą iść same.
      mode: data.mode === 'auto-read' ? 'auto-read' : 'prepare',
      enabled: data.enabled !== false, pending: false,
      lastRun: null, nextRun: computeNextRun(schedule), createdAt: Date.now(),
    };
    routines.push(item);
    saveRoutines();
    return sendJson(res, 200, { ok: true, id: item.id, nextRun: item.nextRun });
  }
  if (pathname === '/api/routines' && req.method === 'PUT') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const r = routines.find((x) => x.id === data.id);
    if (!r) return sendJson(res, 404, { error: 'Nie znaleziono rutyny.' });
    if (typeof data.enabled === 'boolean') r.enabled = data.enabled;
    if (data.mode) r.mode = data.mode === 'auto-read' ? 'auto-read' : 'prepare';
    if (data.schedule || data.type) {
      const s = data.schedule || data;
      r.schedule = {
        type: ['daily', 'weekly', 'monthly', 'interval'].includes(s.type) ? s.type : r.schedule.type,
        time: String(s.time || r.schedule.time).slice(0, 5),
        day: Number(s.day) || 0,
        everyMinutes: Number(s.everyMinutes) || r.schedule.everyMinutes,
      };
      r.nextRun = computeNextRun(r.schedule);
    }
    if (data.pending === false) { r.pending = false; }
    saveRoutines();
    return sendJson(res, 200, { ok: true, nextRun: r.nextRun });
  }
  if (pathname === '/api/routines' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    routines = routines.filter((x) => x.id !== id);
    saveRoutines();
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405); res.end();
}

// Scheduler: co 30 s sprawdza rutyny. Gdy nadszedł czas — TYLKO oznacza je
// jako "pending" i zgłasza zdarzenie. Nic nieodwracalnego nie dzieje się samo;
// właściwe wykonanie (za zgodą) uruchamia użytkownik w interfejsie.
let schedulerTimer = null;
function tickRoutines() {
  const now = Date.now();
  let changed = false;
  for (const r of routines) {
    if (!r.enabled) continue;
    if (!r.nextRun) { r.nextRun = computeNextRun(r.schedule, now); changed = true; }
    if (now >= r.nextRun) {
      r.pending = true;
      r.lastRun = now;
      r.nextRun = computeNextRun(r.schedule, now);
      changed = true;
      const proc = procedures.find((p) => p.id === r.procedureId);
      addEvent('rutyna', `zaplanowana czynność do wykonania: ${proc ? proc.name : r.procedureId}`);
    }
  }
  if (changed) saveRoutines();
}
function startScheduler() {
  if (schedulerTimer) return;
  tickRoutines();
  schedulerTimer = setInterval(tickRoutines, 30 * 1000);
  if (schedulerTimer.unref) schedulerTimer.unref();
}

// --- Automatyzacja web (opcjonalny moduł Playwright) ---
// Tryb auto obejmuje: odczyt (open/wait/read/click) ORAZ logowanie z menedżera
// haseł (kroki oznaczone auth: type/click). NIGDY kroków wrażliwych ani
// zmieniających stan poza logowaniem (płatność, wysłanie, potwierdzenie).
const READONLY_ACTIONS = new Set(['open', 'wait', 'read', 'click']);
const AUTOMATION_RUNNER = path.join(__dirname, 'automation', 'runner.js');

function secretsEnabled() { return SECRETS.provider && SECRETS.provider !== 'none'; }

// Menedżer haseł — pobranie jednego sekretu po nazwie. Uruchamiane w procesie
// serwera (ma dostęp do sesji vaulta przez env), wartość leci do runnera przez
// stdin. Nigdy nie logujemy wartości ani nie zwracamy jej do klienta.
function resolveSecret(name) {
  return new Promise((resolve) => {
    const safe = String(name).replace(/[^\w.@:/-]/g, ''); // bez metaznaków powłoki
    if (!safe) return resolve(null);
    let cmd, args;
    switch (SECRETS.provider) {
      case 'env':
        return resolve(process.env['COSMOS_SECRET_' + safe.toUpperCase().replace(/[^A-Z0-9]/g, '_')] || null);
      case 'bitwarden': cmd = 'bw'; args = ['get', 'password', safe]; break;
      case 'onepassword': cmd = 'op'; args = ['read', safe]; break;
      case 'pass': cmd = 'pass'; args = ['show', safe]; break;
      case 'keepassxc':
        if (!SECRETS.keepassDb) return resolve(null);
        cmd = 'keepassxc-cli'; args = ['show', '-a', 'Password', '-q', SECRETS.keepassDb, safe]; break;
      case 'command': {
        if (!SECRETS.command) return resolve(null);
        const full = SECRETS.command.replaceAll('{name}', safe);
        cmd = '/bin/sh'; args = ['-c', full]; break;
      }
      default: return resolve(null);
    }
    let out = '';
    try {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } }, 15000);
      child.stdout.on('data', (d) => { out += d; });
      child.on('error', () => { clearTimeout(timer); resolve(null); });
      child.on('close', () => { clearTimeout(timer); resolve(out.split('\n')[0].trim() || null); });
    } catch { resolve(null); }
  });
}

// Podmiana wzorców {{secret:NAZWA}} w wartościach kroków na prawdziwe sekrety.
// Zwraca {steps, missing[]}. Wywoływane WYŁĄCZNIE po stronie serwera (auto).
async function materializeSecrets(steps) {
  const missing = [];
  const out = [];
  for (const s of steps) {
    let value = s.value || '';
    const refs = [...value.matchAll(/\{\{\s*secret:\s*([^}]+?)\s*\}\}/gi)];
    for (const m of refs) {
      const val = secretsEnabled() ? await resolveSecret(m[1]) : null;
      if (val == null) { missing.push(m[1]); }
      else value = value.replace(m[0], val);
    }
    out.push({ ...s, value });
  }
  return { steps: out, missing };
}

// Krok kwalifikuje się do trybu auto: odczyt zawsze; type/click tylko jako
// logowanie (auth); nigdy krok wrażliwy ani confirm.
function stepAutoEligible(s) {
  if (s.sensitive || s.action === 'confirm') return false;
  if (READONLY_ACTIONS.has(s.action)) return true;
  if (s.action === 'type' && s.auth) return true;
  return false;
}
function autoEligibility(proc) {
  if (!proc || !proc.steps.length) return { eligible: false, needsAuth: false };
  const eligible = proc.steps.every(stepAutoEligible);
  const needsAuth = proc.steps.some((s) => s.auth ||
    /\{\{\s*secret:/i.test(s.value || ''));
  return { eligible, needsAuth };
}

function runAutomation(name, steps, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [AUTOMATION_RUNNER], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ ok: false, error: 'spawn-failed', reason: err.message });
    }
    let out = '', errOut = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errOut += d; });
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: 'spawn-failed', reason: err.message }); });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); }
      catch { resolve({ ok: false, error: 'no-output', reason: (errOut || out).slice(0, 300) }); }
    });
    child.stdin.write(JSON.stringify({ name, steps }));
    child.stdin.end();
  });
}

async function handleAutomation(req, res, pathname) {
  if (pathname === '/api/automation/status' && req.method === 'GET') {
    let available = false;
    try { require.resolve('playwright'); available = true; } catch { /* brak */ }
    return sendJson(res, 200, {
      available, runner: fs.existsSync(AUTOMATION_RUNNER),
      secrets: secretsEnabled() ? SECRETS.provider : null,
    });
  }
  if (pathname === '/api/procedures/run-readonly' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const proc = procedures.find((p) => p.id === data.id);
    if (!proc) return sendJson(res, 404, { error: 'Nie znaleziono procedury.' });
    const { eligible, needsAuth } = autoEligibility(proc);
    if (!eligible) {
      return sendJson(res, 400, {
        error: 'not-readonly',
        message: 'Ta procedura zawiera kroki wrażliwe lub zmieniające stan poza logowaniem ' +
                 '(płatność, wysłanie, potwierdzenie). Uruchom ją ręcznym runnerem z potwierdzeniem.',
      });
    }
    // logowanie wymaga skonfigurowanego menedżera haseł
    if (needsAuth && !secretsEnabled()) {
      return sendJson(res, 400, {
        error: 'no-secrets',
        message: 'Ta procedura loguje się z menedżera haseł, ale żaden nie jest skonfigurowany. ' +
                 'Ustaw SECRETS_PROVIDER w .env (patrz automation/README.md).',
      });
    }
    // podmień {{secret:...}} na prawdziwe wartości tuż przed uruchomieniem
    const { steps, missing } = await materializeSecrets(proc.steps);
    if (missing.length) {
      return sendJson(res, 400, { error: 'secret-missing', message: `Nie znaleziono w menedżerze haseł: ${[...new Set(missing)].join(', ')}` });
    }
    const result = await runAutomation(proc.name, steps);
    if (result.ok) {
      const summary = result.results.map((r) => `${r.label}: ${r.value}`).join(' | ').slice(0, 400);
      addEvent('automatyzacja', `odczyt „${proc.name}": ${summary || '(brak wyników)'}`);
    }
    return sendJson(res, result.ok ? 200 : 502, result);
  }
  res.writeHead(405); res.end();
}

// ---------------------------------------------------------------------------
// TRENING — eksport danych do fine-tuningu (QLoRA/LoRA).
// Buduje zbiór JSONL z rozmów: czyste tury user↔assistant (bez akcji, wyszukiwań,
// błędów i obrazów). Dwa formaty: "chat" (messages[]) i "instruction".
// To NIE trenuje modelu — przygotowuje dane, które wytrenujesz w training/ .
// ---------------------------------------------------------------------------
function convTextTurns(conv) {
  const turns = [];
  for (const m of (conv.messages || [])) {
    if (m.role !== 'user' && m.role !== 'assistant') continue; // pomiń action/search
    if (m.search || m.error) continue;
    const text = typeof m.content === 'string' ? m.content : (m.content && m.content.text) || '';
    const t = String(text).trim();
    if (!t) continue; // pomiń tury bez tekstu (np. sam obraz)
    turns.push({ role: m.role, content: t });
  }
  return turns;
}

function buildTrainingDataset(format) {
  const sys = userProfile.trim();
  const out = [];
  for (const meta of convIndex) {
    let conv;
    try { conv = JSON.parse(fs.readFileSync(convPath(meta.id), 'utf8')); } catch { continue; }
    const turns = convTextTurns(conv);
    if (turns.length < 2) continue;

    if (format === 'instruction') {
      // pary: każda tura użytkownika + następna odpowiedź asystenta
      for (let i = 0; i < turns.length - 1; i++) {
        if (turns[i].role === 'user' && turns[i + 1].role === 'assistant') {
          out.push({ instruction: turns[i].content, input: '', output: turns[i + 1].content });
        }
      }
    } else { // chat
      if (!turns.some((t) => t.role === 'assistant')) continue;
      const messages = sys ? [{ role: 'system', content: sys }] : [];
      out.push({ messages: messages.concat(turns) });
    }
  }
  return { lines: out.map((o) => JSON.stringify(o)).join('\n') + (out.length ? '\n' : ''), count: out.length };
}

// --- „Dotrenuj" — uruchomienie treningu QLoRA lokalnie (opcjonalne) ---
const TRAIN_DIR = path.join(DATA_DIR, 'train');
const TRAIN_SCRIPT = path.join(__dirname, 'training', 'qlora_example.py');
let trainJob = null; // { status, startedAt, endedAt, log:[], model, ollamaName, exitCode, child }
const TRAIN_LOG_MAX = 400;

function commandExists(cmd) {
  return new Promise((resolve) => {
    try {
      const c = spawn(cmd, ['--version'], { stdio: 'ignore' });
      const timer = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* */ } resolve(false); }, 4000);
      c.on('error', () => { clearTimeout(timer); resolve(false); });
      c.on('close', (code) => { clearTimeout(timer); resolve(code === 0 || code === null ? true : true); });
    } catch { resolve(false); }
  });
}

function trainLog(line) {
  if (!trainJob) return;
  for (const l of String(line).split('\n')) {
    const s = l.replace(/\s+$/, '');
    if (s) trainJob.log.push(s);
  }
  if (trainJob.log.length > TRAIN_LOG_MAX) trainJob.log = trainJob.log.slice(-TRAIN_LOG_MAX);
}

function trainStatusView() {
  if (!trainJob) return { running: false, status: 'idle', log: [] };
  return {
    running: trainJob.status === 'running',
    status: trainJob.status,
    startedAt: trainJob.startedAt,
    endedAt: trainJob.endedAt || null,
    model: trainJob.model,
    ollamaName: trainJob.ollamaName,
    exitCode: trainJob.exitCode,
    log: trainJob.log.slice(-60),
  };
}

async function startTraining(opts) {
  const { lines, count } = buildTrainingDataset('chat');
  if (count < 1) return { ok: false, error: 'no-data', message: 'Brak danych do treningu — porozmawiaj najpierw z Cosmosem.' };
  if (!fs.existsSync(TRAIN_SCRIPT)) return { ok: false, error: 'no-script' };
  if (!(await commandExists('python3'))) {
    return { ok: false, error: 'no-python', message: 'Brak python3. Zainstaluj Pythona i zależności z training/README.md.' };
  }
  fs.mkdirSync(TRAIN_DIR, { recursive: true });
  const dataPath = path.join(TRAIN_DIR, 'dataset.jsonl');
  fs.writeFileSync(dataPath, lines);

  const model = String(opts.model || 'unsloth/Qwen2.5-7B-Instruct-bnb-4bit').replace(/[^\w./:-]/g, '');
  const ollamaName = String(opts.ollamaName || 'cosmos-ft').replace(/[^a-z0-9._-]/gi, '');
  const args = [TRAIN_SCRIPT, '--data', dataPath, '--model', model, '--out', path.join(TRAIN_DIR, 'lora'), '--gguf'];

  trainJob = { status: 'running', startedAt: Date.now(), endedAt: null, log: [], model, ollamaName, exitCode: null, child: null };
  trainLog(`▶ Start treningu: model=${model}, przykłady=${count}`);
  addEvent('trening', `rozpoczęto dotrenowywanie modelu (${count} przykładów)`);

  let child;
  try {
    child = spawn('python3', args, { cwd: path.join(__dirname, 'training'), stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    trainJob.status = 'error'; trainJob.endedAt = Date.now(); trainLog('✗ ' + err.message);
    return { ok: false, error: 'spawn-failed', message: err.message };
  }
  trainJob.child = child;
  child.stdout.on('data', (d) => trainLog(d));
  child.stderr.on('data', (d) => trainLog(d));
  child.on('close', async (code) => {
    trainJob.exitCode = code;
    if (code === 0) {
      trainLog('✓ Trening zakończony.');
      // rejestracja w Ollamie (jeśli dostępna)
      const ggufModelfile = path.join(__dirname, 'training', 'cosmos-model-gguf', 'Modelfile');
      if (fs.existsSync(ggufModelfile) && await commandExists('ollama')) {
        trainLog(`▶ Rejestruję model w Ollamie jako „${ollamaName}"…`);
        try {
          const oc = spawn('ollama', ['create', ollamaName, '-f', ggufModelfile], { stdio: ['ignore', 'pipe', 'pipe'] });
          oc.stdout.on('data', (d) => trainLog(d));
          oc.stderr.on('data', (d) => trainLog(d));
          oc.on('close', (oco) => {
            if (oco === 0) { trainLog(`✓ Gotowe. Ustaw LOCAL_MODEL=${ollamaName} w .env i przełącz na profil „Lokalnie".`); addEvent('trening', `model „${ollamaName}" gotowy w Ollamie`); }
            else trainLog(`✗ ollama create zwróciło kod ${oco}.`);
            trainJob.status = 'done'; trainJob.endedAt = Date.now();
          });
        } catch (err) { trainLog('✗ ' + err.message); trainJob.status = 'done'; trainJob.endedAt = Date.now(); }
      } else {
        trainLog('ℹ Ollama niedostępna lub brak GGUF — model LoRA zapisany w data/train/lora.');
        trainJob.status = 'done'; trainJob.endedAt = Date.now();
        addEvent('trening', 'trening zakończony (adapter LoRA zapisany)');
      }
    } else {
      trainLog(`✗ Trening zakończony błędem (kod ${code}). Sprawdź zależności: training/README.md.`);
      trainJob.status = 'error'; trainJob.endedAt = Date.now();
    }
  });
  return { ok: true, startedAt: trainJob.startedAt };
}

// ---------------------------------------------------------------------------
// JARVIS — urządzenia (smart home) i poranna odprawa.
//   Urządzenia: prosty mostek HTTP. Definiujesz je w data/devices.json albo
//   w Ustawieniach; Cosmos może zaproponować użycie, ale WYKONANIE zawsze
//   wymaga Twojego kliknięcia (ten sam wzorzec co inne akcje).
//   Działa z Home Assistant, Shelly, Philips Hue, Tasmota i czymkolwiek,
//   co przyjmuje żądanie HTTP.
// ---------------------------------------------------------------------------

const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
let devices = [];
try { devices = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8')); } catch { /* brak */ }
const saveDevices = () => saveJsonFile(DEVICES_FILE, devices);

function sanitizeDevice(d) {
  const method = ['GET', 'POST', 'PUT'].includes(String(d.method || '').toUpperCase())
    ? String(d.method).toUpperCase() : 'POST';
  let headers = {};
  if (d.headers && typeof d.headers === 'object') {
    for (const [k, v] of Object.entries(d.headers)) headers[String(k).slice(0, 80)] = String(v).slice(0, 500);
  }
  return {
    id: d.id || genId(),
    name: String(d.name || '').trim().slice(0, 60),
    url: String(d.url || '').trim().slice(0, 500),
    method, headers,
    body: typeof d.body === 'string' ? d.body.slice(0, 2000) : '',
    note: String(d.note || '').slice(0, 200),
  };
}

async function runDevice(dev) {
  if (!/^https?:\/\//i.test(dev.url)) return { ok: false, error: 'bad-url' };
  try {
    const opts = { method: dev.method, headers: { ...dev.headers }, signal: AbortSignal.timeout(10000) };
    if (dev.method !== 'GET' && dev.body) {
      if (!Object.keys(opts.headers).some((h) => h.toLowerCase() === 'content-type')) {
        opts.headers['Content-Type'] = 'application/json';
      }
      opts.body = dev.body;
    }
    const r = await fetch(dev.url, opts);
    const text = (await r.text()).slice(0, 300);
    addEvent('urządzenie', `${dev.name}: ${r.ok ? 'wykonano' : 'błąd ' + r.status}`);
    return { ok: r.ok, status: r.status, response: text };
  } catch (err) {
    return { ok: false, error: 'request-failed', reason: err.message };
  }
}

async function handleDevices(req, res, pathname) {
  if (pathname === '/api/devices' && req.method === 'GET') {
    return sendJson(res, 200, { devices });
  }
  if (pathname === '/api/devices' && req.method === 'POST') {
    let data; try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const dev = sanitizeDevice(data);
    if (!dev.name || !dev.url) return sendJson(res, 400, { error: 'Podaj nazwę i adres URL urządzenia.' });
    const i = devices.findIndex((d) => d.id === dev.id);
    if (i >= 0) devices[i] = dev; else devices.push(dev);
    saveDevices();
    return sendJson(res, 200, { ok: true, id: dev.id });
  }
  if (pathname === '/api/devices' && req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    devices = devices.filter((d) => d.id !== id);
    saveDevices();
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/devices/run' && req.method === 'POST') {
    let data; try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const want = String(data.id || data.name || '').trim().toLowerCase();
    const dev = devices.find((d) => d.id === data.id)
      || devices.find((d) => d.name.toLowerCase() === want)
      || devices.find((d) => d.name.toLowerCase().includes(want));
    if (!dev) return sendJson(res, 404, { error: 'Nie znaleziono urządzenia.' });
    const result = await runDevice(dev);
    return sendJson(res, result.ok ? 200 : 502, result);
  }
  res.writeHead(405); res.end();
}

// --- Poranna odprawa ---
const BRIEFING = {
  lat: process.env.BRIEFING_LAT || '',
  lon: process.env.BRIEFING_LON || '',
  ics: process.env.CALENDAR_ICS || '',
};

async function fetchWeather() {
  if (!BRIEFING.lat || !BRIEFING.lon) return null;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(BRIEFING.lat)}` +
      `&longitude=${encodeURIComponent(BRIEFING.lon)}&current=temperature_2m,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
      `&forecast_days=1&timezone=auto`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      teraz: d.current?.temperature_2m, wiatr: d.current?.wind_speed_10m,
      max: d.daily?.temperature_2m_max?.[0], min: d.daily?.temperature_2m_min?.[0],
      opady: d.daily?.precipitation_probability_max?.[0],
      wschod: (d.daily?.sunrise?.[0] || '').slice(11), zachod: (d.daily?.sunset?.[0] || '').slice(11),
    };
  } catch { return null; }
}

// Minimalny czytnik ICS — wydarzenia na dziś (plik lokalny albo adres URL).
async function fetchCalendar() {
  if (!BRIEFING.ics) return [];
  let text = '';
  try {
    if (/^https?:\/\//i.test(BRIEFING.ics)) {
      const r = await fetch(BRIEFING.ics, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return [];
      text = await r.text();
    } else {
      text = fs.readFileSync(BRIEFING.ics, 'utf8');
    }
  } catch { return []; }

  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const today = new Date();
  const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const out = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const get = (k) => (block.match(new RegExp(`^${k}[^:]*:(.*)$`, 'm')) || [])[1]?.trim() || '';
    const start = get('DTSTART');
    if (!start.startsWith(stamp)) continue;
    const time = start.length > 8 ? `${start.slice(9, 11)}:${start.slice(11, 13)}` : 'cały dzień';
    out.push({ czas: time, tytul: get('SUMMARY').slice(0, 120) });
    if (out.length >= 12) break;
  }
  return out.sort((a, b) => a.czas.localeCompare(b.czas));
}

async function handleBriefing(req, res) {
  const [weather, calendar] = await Promise.all([fetchWeather(), fetchCalendar()]);
  const due = routines.filter((r) => r.pending).map((r) => routineView(r).procedureName);
  const recent = recentEvents(12 * 60 * 60 * 1000, 12).map((e) => e.summary);

  const facts = [];
  if (weather) {
    facts.push(`Pogoda: teraz ${weather.teraz}°C, dziś ${weather.min}–${weather.max}°C, ` +
      `szansa opadów ${weather.opady}%, wiatr ${weather.wiatr} km/h, ` +
      `wschód ${weather.wschod}, zachód ${weather.zachod}.`);
  }
  if (calendar.length) {
    facts.push('Kalendarz na dziś:\n' + calendar.map((c) => `- ${c.czas} ${c.tytul}`).join('\n'));
  }
  if (due.length) facts.push(`Zaplanowane czynności czekające na uruchomienie: ${due.join(', ')}.`);
  if (recent.length) facts.push('Ostatnie zdarzenia:\n' + recent.map((s) => `- ${s}`).join('\n'));
  if (!facts.length) {
    return sendJson(res, 200, {
      ok: true, text: 'Brak danych do odprawy. Ustaw BRIEFING_LAT/BRIEFING_LON (pogoda) ' +
        'i opcjonalnie CALENDAR_ICS (kalendarz) w pliku .env.', facts: {},
    });
  }

  const lang = (req.headers['x-cosmos-lang'] === 'en') ? 'en' : 'pl';
  const prompt = lang === 'en'
    ? 'Give a short spoken morning briefing (max 6 sentences) from the facts below. Be concrete, no filler, no greeting formulas beyond one short opener.'
    : 'Przygotuj krótką poranną odprawę do przeczytania na głos (maks. 6 zdań) na podstawie poniższych faktów. ' +
      'Konkretnie, bez lania wody, bez powtarzania liczb, które nic nie wnoszą.';
  try {
    const text = await llmComplete([
      { role: 'system', content: prompt },
      { role: 'user', content: facts.join('\n\n') },
    ], { endpoint: 'cloud', maxTokens: 400 });
    addEvent('odprawa', 'przygotowano poranną odprawę');
    return sendJson(res, 200, { ok: true, text, facts: { weather, calendar, due, recent } });
  } catch (err) {
    // bez modelu i tak zwróć surowe fakty — odprawa ma działać zawsze
    return sendJson(res, 200, { ok: true, text: facts.join('\n\n'), facts: { weather, calendar, due, recent }, raw: true });
  }
}

// ---------------------------------------------------------------------------
// SAMOŚWIADOMOŚĆ — manifest zdolności.
//   Cosmos musi wiedzieć, czym JEST i co REALNIE potrafi w tej chwili — nie
//   z wyuczonej formułki, tylko z żywego stanu systemu. Dzięki temu nie obiecuje
//   rzeczy, których nie ma skonfigurowanych, i potrafi powiedzieć, jak je włączyć.
// ---------------------------------------------------------------------------

let sensesCache = { at: 0, online: false, caps: {} };

async function sensesState() {
  if (Date.now() - sensesCache.at < 60000) return sensesCache;
  try {
    const r = await fetch(`${SENSES_URL}/health`, { signal: AbortSignal.timeout(1500) });
    const caps = r.ok ? await r.json() : {};
    sensesCache = { at: Date.now(), online: r.ok, caps: caps.caps || caps || {} };
  } catch {
    sensesCache = { at: Date.now(), online: false, caps: {} };
  }
  return sensesCache;
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
  if (!devices.length) missing.push('sterowanie urządzeniami — dodaj je w Ustawieniach → Urządzenia');

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
    nauka: { wzorce: lessons.length, procedury: procedures.length, rutyny: routines.length,
      nagrywanieEkranu: playwright, automatyzacjaOdczytu: playwright,
      menedzerHasel: secretsEnabled() ? SECRETS.provider : null },
    dom: { urzadzenia: devices.map((d) => d.name), odprawa: Boolean(BRIEFING.lat && BRIEFING.lon),
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
      + `głos(Piper)=${yes(z.piper)}, wzrok(YOLO)=${yes(z.yolo)}, sylwetka=${yes(z.mediapipe)}, `
      + `embeddingi=${yes(z.embed)}, upscale=${yes(z.upscale)}`,
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
    procedures.push(item); saveProcedures();
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

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
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

async function readJson(req) {
  return JSON.parse((await readBodyBuffer(req)).toString('utf8'));
}

function pickEndpoint(name) {
  return ENDPOINTS[name] || ENDPOINTS.cloud;
}

function authHeaders(ep) {
  const headers = { 'Content-Type': 'application/json' };
  if (ep.apiKey) headers.Authorization = `Bearer ${ep.apiKey}`;
  if (ep.anthropic) {
    headers['x-api-key'] = ep.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }
  return headers;
}

// ---------------------------------------------------------------------------
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
      return sendJson(res, 200, { ok: true, stored: events.length });
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

/** Odczyt z usługi percepcji (GET) — np. klatki z Kinecta.
 *
 * Kinect nie jest kamerą UVC, więc przeglądarka go nie widzi i podgląd nie może
 * użyć getUserMedia. Klatki idą tędy: usługa zmysłów → serwer → przeglądarka.
 */
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
// API: Studio — generowanie mediów (OpenAI / ElevenLabs / Seedance)
// Każdy wynik trafia do bazy wiedzy i (opcjonalnie) do folderu eksportu
// (STUDIO_EXPORT_DIR — np. folder projektu Adobe).
// ---------------------------------------------------------------------------

function exportToStudioDir(name, buf) {
  if (!STUDIO.exportDir) return '';
  try {
    fs.mkdirSync(STUDIO.exportDir, { recursive: true });
    const p = path.join(STUDIO.exportDir, name);
    fs.writeFileSync(p, buf);
    return p;
  } catch (err) {
    console.error('Eksport nie powiódł się:', err.message);
    return '';
  }
}

function tsName(prefix, ext) {
  const t = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  return `${prefix}-${t}.${ext}`;
}

// --- Adobe Firefly: token IMS (server-to-server) z pamięcią podręczną ---

let fireflyTokenCache = { token: '', exp: 0 };

async function getFireflyToken() {
  if (fireflyTokenCache.token && Date.now() < fireflyTokenCache.exp) return fireflyTokenCache.token;
  const r = await fetch(`${STUDIO.firefly.imsUrl}/ims/token/v3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: STUDIO.firefly.clientId,
      client_secret: STUDIO.firefly.clientSecret,
      scope: 'openid,AdobeID,firefly_api,ff_apis',
    }),
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) {
    throw new Error(d.error_description || d.error || 'Nie udało się pobrać tokenu Adobe IMS.');
  }
  fireflyTokenCache = {
    token: d.access_token,
    exp: Date.now() + Math.max(60, (d.expires_in || 3600) - 300) * 1000,
  };
  return d.access_token;
}

async function fireflyGenerateImage(prompt, size) {
  const token = await getFireflyToken();
  const dims = size === '1536x1024' ? { width: 2304, height: 1792 }
    : size === '1024x1536' ? { width: 1792, height: 2304 }
    : { width: 2048, height: 2048 };
  const r = await fetch(`${STUDIO.firefly.base}/v3/images/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-api-key': STUDIO.firefly.clientId,
    },
    body: JSON.stringify({ prompt, size: dims, numVariations: 1 }),
    signal: AbortSignal.timeout(180000),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || d.error_code || `HTTP ${r.status}`);
  const url = d.outputs?.[0]?.image?.url;
  if (!url) throw new Error('Firefly nie zwrócił obrazu.');
  return Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(120000) })).arrayBuffer());
}

// Niestreamowane wywołanie modelu (Storyboard, streszczenia itp.)
async function llmComplete(messages, { endpoint = 'cloud', maxTokens = 1024 } = {}) {
  const ep = pickEndpoint(endpoint);
  const model = ep.model;
  if (!ep.apiKey && ep.baseUrl.includes('integrate.api.nvidia.com')) {
    throw new Error('Brak klucza API dla chmury NVIDIA.');
  }
  const r = await fetch(`${ep.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(ep),
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(120000),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || d.error || `HTTP ${r.status}`);
  return d.choices?.[0]?.message?.content || '';
}

// Wygeneruj jeden obraz (dowolny skonfigurowany silnik) → wpis w bazie wiedzy.
async function studioGenImage(prompt, size, provider) {
  const providers = imageProviders();
  const prov = providers.some((p) => p.id === provider) ? provider : providers[0]?.id;
  let buf; let engineLabel;
  if (prov === 'firefly') {
    buf = await fireflyGenerateImage(prompt, size); engineLabel = 'Adobe Firefly';
  } else {
    const body = { model: STUDIO.openai.imageModel, prompt, size, n: 1 };
    if (!STUDIO.openai.imageModel.startsWith('gpt-image')) body.response_format = 'b64_json';
    const r = await fetch(`${STUDIO.openai.base}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STUDIO.openai.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    const resp = await r.json();
    if (!r.ok) throw new Error(resp.error?.message || `HTTP ${r.status}`);
    const first = resp.data?.[0] || {};
    if (first.b64_json) buf = Buffer.from(first.b64_json, 'base64');
    else if (first.url) buf = Buffer.from(await (await fetch(first.url)).arrayBuffer());
    else throw new Error('API nie zwróciło obrazu.');
    engineLabel = STUDIO.openai.imageModel;
  }
  const name = tsName('obraz', 'png');
  const item = await kbAddFile(name, 'image/png', buf,
    `Grafika wygenerowana w Studiu (silnik: ${engineLabel}). Prompt: ${prompt}`);
  exportToStudioDir(name, buf);
  return { item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` };
}

async function handleStudio(req, res, pathname) {
  if (pathname === '/api/studio/providers' && req.method === 'GET') {
    return sendJson(res, 200, {
      image: imageProviders().length > 0,
      imageProviders: imageProviders(),
      speech: Boolean(STUDIO.eleven.key),
      video: Boolean(STUDIO.seedance.key),
      imageModel: STUDIO.openai.imageModel,
      voice: STUDIO.eleven.voice,
      videoModel: STUDIO.seedance.model,
      exportDir: STUDIO.exportDir,
    });
  }

  // --- OBRAZ (OpenAI lub Adobe Firefly) ---
  if (pathname === '/api/studio/image' && req.method === 'POST') {
    const providers = imageProviders();
    if (!providers.length) {
      return sendJson(res, 400, {
        error: 'Brak silnika obrazów. Ustaw OPENAI_API_KEY albo FIREFLY_CLIENT_ID + FIREFLY_CLIENT_SECRET w .env.',
      });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const prompt = String(data.prompt || '').trim();
    if (!prompt) return sendJson(res, 400, { error: 'Puste pole prompt.' });
    const size = ['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792']
      .includes(data.size) ? data.size : '1024x1024';
    const provider = providers.some((p) => p.id === data.provider) ? data.provider : providers[0].id;
    const count = Math.min(4, Math.max(1, parseInt(data.count, 10) || 1)); // liczba wariantów

    const genOne = async () => {
      if (provider === 'firefly') {
        return { buf: await fireflyGenerateImage(prompt, size), engineLabel: 'Adobe Firefly' };
      }
      const body = { model: STUDIO.openai.imageModel, prompt, size, n: 1 };
      if (!STUDIO.openai.imageModel.startsWith('gpt-image')) body.response_format = 'b64_json';
      const r = await fetch(`${STUDIO.openai.base}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STUDIO.openai.key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
      const resp = await r.json();
      if (!r.ok) throw new Error(resp.error?.message || `HTTP ${r.status}`);
      const first = resp.data?.[0] || {};
      let buf;
      if (first.b64_json) buf = Buffer.from(first.b64_json, 'base64');
      else if (first.url) buf = Buffer.from(await (await fetch(first.url)).arrayBuffer());
      else throw new Error('API nie zwróciło obrazu.');
      return { buf, engineLabel: STUDIO.openai.imageModel };
    };

    try {
      const items = [];
      let engineLabel = '';
      for (let k = 0; k < count; k++) {
        const { buf, engineLabel: lbl } = await genOne();
        engineLabel = lbl;
        const name = tsName('obraz', 'png');
        const item = await kbAddFile(name, 'image/png', buf,
          `Grafika wygenerowana w Studiu (silnik: ${lbl}). Prompt: ${prompt}`);
        exportToStudioDir(name, buf);
        items.push({ item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` });
      }
      addEvent('studio', `wygenerowano ${count > 1 ? count + ' warianty obrazu' : 'obraz'} (${engineLabel}): „${prompt.slice(0, 80)}”`);
      // zgodność wstecz: pierwszy obraz jako item/url (dla znacznika [OBRAZ:] w czacie)
      return sendJson(res, 200, {
        ok: true, provider, items, item: items[0].item, url: items[0].url,
      });
    } catch (err) {
      return sendJson(res, 502, { error: `Generowanie obrazu nie powiodło się: ${err.message}` });
    }
  }

  // --- STORYBOARD (scena → ujęcia → obraz na ujęcie) ---
  if (pathname === '/api/studio/storyboard' && req.method === 'POST') {
    if (!imageProviders().length) {
      return sendJson(res, 400, { error: 'Brak silnika obrazów (OPENAI_API_KEY / Firefly).' });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const scene = String(data.scene || '').trim();
    if (!scene) return sendJson(res, 400, { error: 'Puste pole scene.' });
    const shots = Math.min(6, Math.max(2, parseInt(data.shots, 10) || 4));
    const size = data.size || '1536x1024';
    try {
      const raw = await llmComplete([
        { role: 'system', content: 'Jesteś reżyserem. Rozpisz scenę na ujęcia filmowe. ' +
          'Zwróć WYŁĄCZNIE tablicę JSON stringów — po jednym szczegółowym opisie kadru po angielsku na ujęcie, ' +
          'gotowym jako prompt do generatora obrazów. Bez komentarza, bez numeracji.' },
        { role: 'user', content: `Scena: ${scene}\nLiczba ujęć: ${shots}` },
      ], { maxTokens: 900 });
      let prompts;
      try {
        const m = raw.match(/\[[\s\S]*\]/);
        prompts = JSON.parse(m ? m[0] : raw);
      } catch {
        prompts = raw.split('\n').map((l) => l.replace(/^\s*[-*\d.)\]]+\s*/, '').trim()).filter(Boolean);
      }
      prompts = (prompts || []).filter((p) => typeof p === 'string' && p.trim()).slice(0, shots);
      if (!prompts.length) throw new Error('Model nie zwrócił opisów ujęć.');

      const frames = [];
      for (let i = 0; i < prompts.length; i++) {
        const img = await studioGenImage(prompts[i], size, data.provider);
        frames.push({ shot: i + 1, prompt: prompts[i], ...img });
      }
      addEvent('studio', `storyboard: „${scene.slice(0, 60)}" → ${frames.length} ujęć`);
      return sendJson(res, 200, { ok: true, scene, frames });
    } catch (err) {
      return sendJson(res, 502, { error: `Storyboard nie powiódł się: ${err.message}` });
    }
  }

  // --- INPAINTING (obraz z bazy + maska + prompt → OpenAI images/edit) ---
  if (pathname === '/api/studio/edit' && req.method === 'POST') {
    if (!STUDIO.openai.key) {
      return sendJson(res, 400, { error: 'Edycja obrazu wymaga OPENAI_API_KEY.' });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const prompt = String(data.prompt || '').trim();
    const imageId = String(data.imageId || '');
    if (!prompt || !imageId) return sendJson(res, 400, { error: 'Wymagane: imageId i prompt.' });
    let maskBuf = null;
    try { if (data.mask) maskBuf = Buffer.from(String(data.mask).split(',').pop(), 'base64'); } catch { /* brak maski */ }
    let srcBuf;
    try { srcBuf = fs.readFileSync(path.join(KB_FILES, imageId.replace(/[^a-z0-9]/gi, ''))); }
    catch { return sendJson(res, 404, { error: 'Nie znaleziono obrazu w bazie.' }); }

    try {
      const form = new FormData();
      form.append('model', STUDIO.openai.imageModel);
      form.append('prompt', prompt);
      form.append('image', new Blob([srcBuf], { type: 'image/png' }), 'image.png');
      if (maskBuf) form.append('mask', new Blob([maskBuf], { type: 'image/png' }), 'mask.png');
      const r = await fetch(`${STUDIO.openai.base}/images/edits`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${STUDIO.openai.key}` },
        body: form,
        signal: AbortSignal.timeout(180000),
      });
      const resp = await r.json();
      if (!r.ok) throw new Error(resp.error?.message || `HTTP ${r.status}`);
      const first = resp.data?.[0] || {};
      let buf;
      if (first.b64_json) buf = Buffer.from(first.b64_json, 'base64');
      else if (first.url) buf = Buffer.from(await (await fetch(first.url)).arrayBuffer());
      else throw new Error('API nie zwróciło obrazu.');
      const name = tsName('edycja', 'png');
      const item = await kbAddFile(name, 'image/png', buf, `Edycja obrazu (inpainting). Prompt: ${prompt}`);
      exportToStudioDir(name, buf);
      addEvent('studio', `edycja obrazu (inpainting): „${prompt.slice(0, 60)}"`);
      return sendJson(res, 200, { ok: true, item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` });
    } catch (err) {
      return sendJson(res, 502, { error: `Edycja obrazu nie powiodła się: ${err.message}` });
    }
  }

  // --- UPSCALE (przez usługę zmysłów, jeśli dostępny model Real-ESRGAN) ---
  if (pathname === '/api/studio/upscale' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const imageId = String(data.imageId || '').replace(/[^a-z0-9]/gi, '');
    let srcBuf;
    try { srcBuf = fs.readFileSync(path.join(KB_FILES, imageId)); }
    catch { return sendJson(res, 404, { error: 'Nie znaleziono obrazu.' }); }
    try {
      const r = await fetch(`${SENSES_URL}/upscale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: `data:image/png;base64,${srcBuf.toString('base64')}`, scale: data.scale || 4 }),
        signal: AbortSignal.timeout(180000),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return sendJson(res, r.status, { error: e.error || 'Upscale niedostępny — zainstaluj Real-ESRGAN w usłudze zmysłów (senses/README.md).' });
      }
      const d = await r.json();
      const buf = Buffer.from(String(d.image).split(',').pop(), 'base64');
      const name = tsName('upscale', 'png');
      const item = await kbAddFile(name, 'image/png', buf, 'Obraz powiększony (upscale).');
      exportToStudioDir(name, buf);
      return sendJson(res, 200, { ok: true, item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` });
    } catch (err) {
      return sendJson(res, 502, { error: `Upscale niedostępny: ${err.message} (uruchom usługę zmysłów z Real-ESRGAN).` });
    }
  }

  // --- DŹWIĘK (ElevenLabs) ---
  if (pathname === '/api/studio/speech' && req.method === 'POST') {
    if (!STUDIO.eleven.key) {
      return sendJson(res, 400, { error: 'Brak klucza ElevenLabs. Ustaw ELEVENLABS_API_KEY w .env.' });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const text = String(data.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'Puste pole text.' });
    const voice = String(data.voiceId || STUDIO.eleven.voice);

    try {
      const r = await fetch(`${STUDIO.eleven.base}/v1/text-to-speech/${encodeURIComponent(voice)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': STUDIO.eleven.key },
        body: JSON.stringify({ text, model_id: STUDIO.eleven.model }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { msg = (await r.json()).detail?.message || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const buf = Buffer.from(await r.arrayBuffer());
      const name = tsName('glos', 'mp3');
      const item = await kbAddFile(name, 'audio/mpeg', buf,
        `Nagranie głosowe (ElevenLabs, głos: ${voice}). Tekst: ${text.slice(0, 800)}`);
      const exported = exportToStudioDir(name, buf);
      addEvent('studio', `wygenerowano dźwięk: „${text.slice(0, 60)}”`);
      return sendJson(res, 200, { ok: true, item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}`, exported });
    } catch (err) {
      return sendJson(res, 502, { error: `Generowanie dźwięku nie powiodło się: ${err.message}` });
    }
  }

  // --- WIDEO (Seedance przez API zgodne z BytePlus/Ark: zadania asynchroniczne) ---
  if (pathname === '/api/studio/video' && req.method === 'POST') {
    if (!STUDIO.seedance.key) {
      return sendJson(res, 400, { error: 'Brak klucza Seedance. Ustaw SEEDANCE_API_KEY w .env.' });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const prompt = String(data.prompt || '').trim();
    if (!prompt) return sendJson(res, 400, { error: 'Puste pole prompt.' });

    // Parametry w formacie komend tekstowych Ark (--resolution, --ratio, …)
    const duration = Math.min(15, Math.max(2, parseInt(data.duration, 10) || 5));
    const resolution = ['480p', '720p', '1080p'].includes(data.resolution) ? data.resolution : '720p';
    const ratio = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].includes(data.ratio)
      ? data.ratio : '16:9';
    let cmd = ` --resolution ${resolution} --ratio ${ratio} --duration ${duration}`;
    if (data.seed !== undefined && String(data.seed).trim() !== '' && Number.isInteger(Number(data.seed))) {
      cmd += ` --seed ${Number(data.seed)}`;
    }
    if (data.camerafixed === true) cmd += ' --camerafixed true';
    if (data.watermark === true) cmd += ' --watermark true';

    const content = [{ type: 'text', text: `${prompt}${cmd}` }];

    const frameFor = (id) => {
      const kbItem = kbItems.find((it) => it.id === id && /^image\//.test(it.mime || ''));
      if (!kbItem) return null;
      try {
        const buf = fs.readFileSync(path.join(KB_FILES, kbItem.id));
        return `data:${kbItem.mime};base64,${buf.toString('base64')}`;
      } catch { return null; }
    };

    // pierwsza/ostatnia klatka (i2v first–last frame; imageId = stara nazwa pola)
    const firstUrl = frameFor(data.firstFrameId || data.imageId);
    const lastUrl = frameFor(data.lastFrameId);
    if (lastUrl && !firstUrl) {
      return sendJson(res, 400, {
        error: 'Ostatnia klatka wymaga podania także pierwszej klatki (wymóg API Seedance).',
      });
    }
    if (firstUrl) {
      content.push({ type: 'image_url', image_url: { url: firstUrl }, role: 'first_frame' });
    }
    if (lastUrl) {
      content.push({ type: 'image_url', image_url: { url: lastUrl }, role: 'last_frame' });
    }

    try {
      const r = await fetch(`${STUDIO.seedance.base}/contents/generations/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STUDIO.seedance.key}` },
        body: JSON.stringify({ model: STUDIO.seedance.model, content }),
        signal: AbortSignal.timeout(30000),
      });
      const resp = await r.json();
      if (!r.ok) throw new Error(resp.error?.message || resp.message || `HTTP ${r.status}`);
      const taskId = resp.id || resp.data?.id;
      if (!taskId) throw new Error('API nie zwróciło identyfikatora zadania.');
      studioTasks.set(String(taskId), { prompt });
      addEvent('studio', `rozpoczęto generowanie wideo: „${prompt.slice(0, 60)}”`);
      return sendJson(res, 200, { ok: true, taskId });
    } catch (err) {
      return sendJson(res, 502, { error: `Nie udało się zlecić wideo: ${err.message}` });
    }
  }

  if (pathname === '/api/studio/video/status' && req.method === 'GET') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
    try {
      const r = await fetch(`${STUDIO.seedance.base}/contents/generations/tasks/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${STUDIO.seedance.key}` },
        signal: AbortSignal.timeout(20000),
      });
      const resp = await r.json();
      if (!r.ok) throw new Error(resp.error?.message || `HTTP ${r.status}`);
      const status = resp.status || resp.data?.status || 'running';

      if (['succeeded', 'success', 'completed'].includes(status)) {
        const videoUrl = resp.content?.video_url || resp.video_url ||
                         resp.data?.content?.video_url || resp.data?.video_url;
        if (!videoUrl) throw new Error('Zadanie ukończone, ale brak adresu wideo w odpowiedzi.');
        const buf = Buffer.from(await (await fetch(videoUrl, { signal: AbortSignal.timeout(300000) })).arrayBuffer());
        const meta = studioTasks.get(id) || {};
        const name = tsName('wideo', 'mp4');
        const item = await kbAddFile(name, 'video/mp4', buf,
          `Wideo wygenerowane w Studiu (model: ${STUDIO.seedance.model}). Prompt: ${meta.prompt || ''}`);
        const exported = exportToStudioDir(name, buf);
        studioTasks.delete(id);
        addEvent('studio', `ukończono wideo: „${(meta.prompt || '').slice(0, 60)}”`);
        return sendJson(res, 200, { status: 'done', item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}`, exported });
      }
      if (['failed', 'error', 'cancelled'].includes(status)) {
        studioTasks.delete(id);
        return sendJson(res, 200, { status: 'failed', error: resp.error?.message || 'Zadanie nie powiodło się.' });
      }
      return sendJson(res, 200, { status: 'running' });
    } catch (err) {
      return sendJson(res, 502, { error: `Sprawdzenie zadania nie powiodło się: ${err.message}` });
    }
  }

  res.writeHead(405);
  res.end();
}

// ---------------------------------------------------------------------------
// API: wyszukiwanie w internecie (DuckDuckGo HTML — bez klucza API)
// ---------------------------------------------------------------------------

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function resolveDdgUrl(href) {
  // DDG opakowuje linki: //duckduckgo.com/l/?uddg=<zakodowany-url>&...
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try { return decodeURIComponent(m[1]); } catch { /* zostaw jak jest */ }
  }
  return href.startsWith('//') ? 'https:' + href : href;
}

async function handleSearch(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  if (!q) return sendJson(res, 400, { error: 'Brak zapytania (parametr q).' });

  try {
    const upstream = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.6',
      },
      signal: AbortSignal.timeout(12000),
    });
    const html = await upstream.text();

    const results = [];
    const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const links = [...html.matchAll(linkRe)];
    const snips = [...html.matchAll(snipRe)];
    for (let i = 0; i < Math.min(links.length, 5); i++) {
      results.push({
        title: stripTags(links[i][2]),
        url: resolveDdgUrl(decodeEntities(links[i][1])),
        snippet: snips[i] ? stripTags(snips[i][1]).slice(0, 300) : '',
      });
    }
    addEvent('internet', `wyszukano: „${q}” (${results.length} wyników)`);
    sendJson(res, 200, { query: q, results });
  } catch (err) {
    sendJson(res, 200, {
      query: q,
      results: [],
      error: `Wyszukiwarka niedostępna (${err.message}). Sprawdź połączenie z internetem.`,
    });
  }
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

  // Samoświadomość — czym Cosmos jest i co realnie potrafi w tej chwili
  if (payload.useCapabilities !== false) {
    try {
      extras.push({ role: 'system', content: capabilityText(await capabilityManifest()) });
    } catch { /* manifest nie może blokować rozmowy */ }
  }

  // Profil użytkownika — pamięć profilowa wstrzykiwana zawsze
  if (userProfile.trim()) {
    extras.push({ role: 'system', content: 'PROFIL UŻYTKOWNIKA (stałe fakty o osobie, z którą rozmawiasz):\n' + userProfile.trim() });
  }

  const scene = payload.useSenses === false ? '' : sceneContext();
  if (scene) extras.push({ role: 'system', content: scene });

  if (payload.useSearch !== false) {
    extras.push({
      role: 'system',
      content:
        'NARZĘDZIE — WYSZUKIWANIE W INTERNECIE: gdy pytanie wymaga aktualnych lub zewnętrznych ' +
        'informacji (modele urządzeń, ceny, specyfikacje, wiadomości, fakty, których nie znasz), ' +
        'NIE zgaduj — zakończ swoją odpowiedź osobną linią dokładnie w formacie: [SZUKAJ: zapytanie]. ' +
        'Otrzymasz wtedy wiadomość „WYNIKI WYSZUKIWANIA” i na jej podstawie udzielisz pełnej ' +
        'odpowiedzi, podając źródła. Gdy znasz odpowiedź lub pytanie dotyczy rozmowy/obrazu, ' +
        'odpowiadaj normalnie, bez [SZUKAJ:].',
    });
  }

  if (payload.useActions !== false) {
    const procList = procedures.length
      ? ' Nauczone procedury (możesz zaproponować ich uruchomienie): ' +
        procedures.map((pr) => `"${pr.name}"`).join(', ') +
        '. Aby uruchomić procedurę, użyj [AKCJA: procedura | dokładna nazwa]. ' +
        'Uruchomienie tylko przygotowuje kroki — każdy krok wrażliwy (płatność, wysłanie) ' +
        'i tak wymaga osobnego potwierdzenia użytkownika.'
      : '';
    const devList = devices.length
      ? ' Podłączone urządzenia (światło, sprzęt, scena): ' +
        devices.map((d) => `"${d.name}"`).join(', ') +
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

  if (imageProviders().length && payload.useStudio !== false) {
    extras.push({
      role: 'system',
      content:
        'NARZĘDZIE — GENEROWANIE OBRAZÓW: gdy użytkownik prosi o wygenerowanie grafiki, obrazu, ' +
        'ilustracji lub loga, odpowiedz krótko i zakończ osobną linią dokładnie w formacie: ' +
        '[OBRAZ: szczegółowy opis sceny po angielsku]. Obraz zostanie wygenerowany i pokazany. ' +
        'Nie używaj [OBRAZ:] w innych sytuacjach.',
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

  const model = payload.model
    || (hasImages && ep.visionModel ? ep.visionModel : ep.model);

  if (!model) {
    return sendJson(res, 400, {
      error: payload.endpoint === 'local'
        ? 'Nie skonfigurowano modelu lokalnego. Ustaw LOCAL_MODEL w .env albo wybierz model w Ustawieniach.'
        : 'Nie skonfigurowano modelu. Ustaw NEMOTRON_MODEL w .env albo wybierz model w Ustawieniach.',
    });
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
    return sendJson(res, upstream.status, { error: message });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
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
    sendJson(res, 502, { error: `Nie udało się pobrać listy modeli z ${ep.baseUrl}: ${err.message}` });
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
    if (p === '/api/chat' && req.method === 'POST') return await handleChat(req, res);
    if (p === '/api/events') return await handleEvents(req, res);
    if (p === '/api/memory') return await handleMemory(req, res);
    if (p === '/api/search' && req.method === 'GET') return await handleSearch(req, res);
    if (p === '/api/conversations' || p === '/api/conversations/meta' || p === '/api/conversations/search') return await handleConversations(req, res, p);
    if (p === '/api/profile') {
      if (req.method === 'GET') return sendJson(res, 200, { profile: userProfile });
      if (req.method === 'POST') {
        try { saveProfile((await readJson(req)).profile); return sendJson(res, 200, { ok: true }); }
        catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      }
    }
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
        events: events.length,
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
        ], { endpoint: data.endpoint || 'cloud', maxTokens: 600 });
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
      if (procedures.length || routines.length) {
        console.log(`  → Nauka:   ${lessons.length} wzorców, ${procedures.length} procedur, ${routines.length} rutyn`);
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

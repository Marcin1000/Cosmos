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
async function embedTexts(texts, timeoutMs = 60000) {
  try {
    const r = await fetch(`${SENSES_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d.vectors) ? d.vectors : null;
  } catch {
    return null;
  }
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

  let qvec = null;
  const vecs = await embedTexts([query], 5000);
  if (vecs) {
    qvec = vecs[0];
    // uzupełnij embeddingi wpisów dodanych, gdy zmysły były offline
    const missing = memories.filter((m) => !m.embedding);
    if (missing.length) {
      const embs = await embedTexts(missing.map((m) => m.text));
      if (embs) {
        missing.forEach((m, i) => { m.embedding = embs[i]; });
        saveMemories();
      }
    }
  }

  const threshold = qvec ? 0.35 : 0.15;
  return memories
    .map((m) => ({
      m,
      score: (qvec && m.embedding) ? cosine(qvec, m.embedding) : keywordScore(query, m.text),
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
    const vecs = await embedTexts([text]);
    if (vecs) item.embedding = vecs[0];
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
  const embs = await embedTexts(parts);
  return parts.map((t, i) => ({ text: t, embedding: embs ? embs[i] : null }));
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

async function kbSearch(query, excludeIds = [], limit = 4) {
  if (!query || !query.trim()) return [];
  const pool = [];
  for (const it of kbItems) {
    if (excludeIds.includes(it.id)) continue;
    for (const ch of it.chunks || []) pool.push({ name: it.name, ...ch });
  }
  if (!pool.length) return [];

  let qvec = null;
  const vecs = await embedTexts([query], 5000);
  if (vecs) qvec = vecs[0];

  const threshold = qvec ? 0.35 : 0.18;
  return pool
    .map((c) => ({
      c,
      score: (qvec && c.embedding) ? cosine(qvec, c.embedding) : keywordScore(query, c.text),
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
        content: 'BAZA WIEDZY — materiały wybrane przez użytkownika do tej rozmowy. ' +
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
        content: 'BAZA WIEDZY — fragmenty pasujące do bieżącego pytania:\n\n' +
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
    if (p === '/api/conversations' || p === '/api/conversations/meta') return await handleConversations(req, res, p);
    if (p.startsWith('/api/kb')) return await handleKb(req, res, p);
    if (p.startsWith('/api/studio')) return await handleStudio(req, res, p);
    if (p === '/api/stt' && req.method === 'POST') return await proxySenses(req, res, '/stt');
    if (p === '/api/tts' && req.method === 'POST') return await proxySenses(req, res, '/tts', { json: true });
    if (p === '/api/detect' && req.method === 'POST') return await proxySenses(req, res, '/detect', { json: true });
    if (p === '/api/pose' && req.method === 'POST') return await proxySenses(req, res, '/pose', { json: true });
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
      console.log('');
      resolve(server);
    });
  });
}

if (require.main === module) {
  start();
}

module.exports = { start, server, PORT };

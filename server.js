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

const SENSES_URL = (process.env.SENSES_URL || 'http://localhost:7060').replace(/\/+$/, '');

// Wyszukiwarka internetowa (bez klucza API). Domyślnie DuckDuckGo HTML;
// można podmienić na własny SearXNG itp. (format HTML zgodny z DDG).
const SEARCH_URL = process.env.SEARCH_URL || 'https://html.duckduckgo.com/html/';

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

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

async function embedTexts(texts) {
  try {
    const r = await fetch(`${SENSES_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(30000),
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
  const vecs = await embedTexts([query]);
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

function readBodyBuffer(req, limit = 64 * 1024 * 1024) {
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
  return ENDPOINTS[name === 'local' ? 'local' : 'cloud'];
}

function authHeaders(ep) {
  const headers = { 'Content-Type': 'application/json' };
  if (ep.apiKey) headers.Authorization = `Bearer ${ep.apiKey}`;
  return headers;
}

// ---------------------------------------------------------------------------
// API: konfiguracja i status
// ---------------------------------------------------------------------------

function handleConfig(res) {
  sendJson(res, 200, {
    app: 'Cosmos',
    endpoints: {
      cloud: {
        label: ENDPOINTS.cloud.label,
        baseUrl: ENDPOINTS.cloud.baseUrl,
        model: ENDPOINTS.cloud.model,
        visionModel: ENDPOINTS.cloud.visionModel,
        hasApiKey: Boolean(ENDPOINTS.cloud.apiKey),
      },
      local: {
        label: ENDPOINTS.local.label,
        baseUrl: ENDPOINTS.local.baseUrl,
        model: ENDPOINTS.local.model,
        visionModel: ENDPOINTS.local.visionModel,
        hasApiKey: true,
      },
    },
    senses: { baseUrl: SENSES_URL },
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

  const hasImages = payload.messages.some((m) => Array.isArray(m.content) &&
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

  // Kontekst percepcji + pamięć długotrwała: doklejamy jako dodatkowe
  // wiadomości systemowe, zaraz po instrukcji systemowej użytkownika.
  const messages = [...payload.messages];
  const extras = [];

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

  if (payload.useMemory !== false) {
    const lastUser = [...payload.messages].reverse().find((m) => m.role === 'user');
    let queryText = '';
    if (lastUser) {
      queryText = typeof lastUser.content === 'string'
        ? lastUser.content
        : (lastUser.content.find?.((p) => p.type === 'text')?.text || '');
    }
    const recalled = await searchMemory(queryText);
    const memCtx = memoryContextLines(recalled);
    if (memCtx) extras.push({ role: 'system', content: memCtx });
  }

  if (extras.length) {
    const insertAt = messages[0]?.role === 'system' ? 1 : 0;
    messages.splice(insertAt, 0, ...extras);
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
    if (p === '/api/config' && req.method === 'GET') return handleConfig(res);
    if (p === '/api/status' && req.method === 'GET') return await handleStatus(req, res);
    if (p === '/api/models' && req.method === 'GET') return await handleModels(req, res);
    if (p === '/api/chat' && req.method === 'POST') return await handleChat(req, res);
    if (p === '/api/events') return await handleEvents(req, res);
    if (p === '/api/memory') return await handleMemory(req, res);
    if (p === '/api/search' && req.method === 'GET') return await handleSearch(req, res);
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
      console.log('');
      resolve(server);
    });
  });
}

if (require.main === module) {
  start();
}

module.exports = { start, server, PORT };

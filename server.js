#!/usr/bin/env node
/**
 * Cosmos — serwer aplikacji AI
 *
 * Obsługuje dwa profile endpointów zgodnych z API OpenAI:
 *   • cloud — chmura NVIDIA (build.nvidia.com) lub inny zdalny serwer,
 *   • local — model uruchomiony lokalnie (Ollama / vLLM / NIM na RTX 3080).
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

function readBody(req, limit = 32 * 1024 * 1024) {
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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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
// Endpointy API
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
        hasApiKey: true, // lokalny endpoint zwykle nie wymaga klucza
      },
    },
  });
}

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

async function handleStatus(req, res) {
  const results = {};
  await Promise.all(Object.entries(ENDPOINTS).map(async ([name, ep]) => {
    try {
      const r = await fetch(`${ep.baseUrl}/models`, {
        headers: authHeaders(ep),
        signal: AbortSignal.timeout(5000),
      });
      results[name] = { online: r.ok, status: r.status };
    } catch {
      results[name] = { online: false, status: 0 };
    }
  }));
  sendJson(res, 200, results);
}

async function handleChat(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
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

  // Jeśli rozmowa zawiera obrazy, a skonfigurowano osobny model wizyjny — użyj go.
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

  const body = {
    model,
    messages: payload.messages,
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

  // Przekazujemy strumień SSE 1:1 do klienta.
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
    if (req.url === '/api/config' && req.method === 'GET') return handleConfig(res);
    if (req.url.startsWith('/api/models') && req.method === 'GET') return await handleModels(req, res);
    if (req.url === '/api/status' && req.method === 'GET') return await handleStatus(req, res);
    if (req.url === '/api/chat' && req.method === 'POST') return await handleChat(req, res);
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
      console.log('');
      resolve(server);
    });
  });
}

if (require.main === module) {
  start();
}

module.exports = { start, server, PORT };

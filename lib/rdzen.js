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

/* Domyślnie `data/` obok serwera. Nadpisywalne, bo testy muszą pisać gdzie
   indziej — inaczej każdy przebieg baterii dokłada rozmowy do prawdziwych
   danych i liczniki rosną z przebiegu na przebieg.
   Miejsce: rdzeń, nie wstrzyknięcie — moduły dziedzin liczą z tego ścieżki
   już w chwili wczytania, więc muszą je znać zanim serwer cokolwiek poda. */
const DATA_DIR = process.env.COSMOS_DATA_DIR
  ? path.resolve(process.env.COSMOS_DATA_DIR)
  : path.join(KORZEN, 'data');

const PORT = Number(process.env.PORT || 3000);
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

/** Podpowiedź „co z tym zrobić" do odmowy dostawcy.
 *
 * Sam komunikat dostawcy nie mówi, co ma zrobić człowiek przed ekranem.
 * Lokalny 404 znaczy zwykle „modelu nie ma jeszcze na dysku" i da się to
 * naprawić jedną komendą, więc tę komendę wypisujemy wprost. W chmurze
 * 404 znaczy co innego: lista modeli u dostawcy pokazuje wszystko, co
 * hostuje, a nie to, do czego Twój klucz ma dostęp.
 */
function modelErrorHint(epName, model, status) {
  const local = epName === 'local';
  if (status === 404) {
    return local
      ? ` Tego modelu nie ma jeszcze na dysku. Pobierz go na domowym komputerze: ollama pull ${model}`
      : ' Ten model nie jest dostępny na Twoim koncie u dostawcy (lista pokazuje wszystko, co dostawca hostuje). '
        + 'Sprawdź przyciskiem „Sprawdź wszystkie z listy" w Ustawieniach, które modele naprawdę działają.';
  }
  if (status === 401 || status === 403) {
    return local
      ? ' Lokalny silnik odrzucił żądanie — sprawdź LOCAL_API_KEY w .env.'
      : ' Klucz API jest nieprawidłowy albo nie ma dostępu do tego modelu.';
  }
  if (status === 429) return ' Limit zapytań u dostawcy — spróbuj za chwilę.';
  return '';
}

/** Zapis JSON-a na dysk z czytelnym błędem zamiast wywrotki procesu.
    W rdzeniu, bo używa tego pięć różnych dziedzin. */
function saveJsonFile(file, data) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  catch (err) { console.error(`Nie udało się zapisać ${path.basename(file)}:`, err.message); }
}

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

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
module.exports = {
  KORZEN, PORT, PUBLIC_DIR, DATA_DIR, ENDPOINTS, STUDIO, SENSES_URL, SEARCH_URL, SECRETS,
  loadDotEnv, sendJson, readBodyBuffer, readJson, pickEndpoint,
  modelErrorHint, authHeaders, saveJsonFile, genId, fireflyEnabled, imageProviders, studioTasks,
};

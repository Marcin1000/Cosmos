#!/usr/bin/env node
/**
 * Cosmos MCP — mostek Model Context Protocol (stdio) dla Cursora i innych
 * narzędzi zgodnych z MCP (Claude Desktop, Claude Code itp.).
 *
 * Dzięki niemu agent w Cursorze widzi Twojego Cosmosa: przeszukuje bazę
 * wiedzy, czyta pamięć i zdarzenia percepcji, dodaje notatki i generuje
 * obrazy przez Studio.
 *
 * Konfiguracja w Cursorze (Settings → MCP → Add server), plik mcp.json:
 *   {
 *     "mcpServers": {
 *       "cosmos": {
 *         "command": "node",
 *         "args": ["C:/sciezka/do/Bear/mcp/cosmos-mcp.js"],
 *         "env": { "COSMOS_URL": "http://localhost:3000" }
 *       }
 *     }
 *   }
 *
 * Wymaga uruchomionego Cosmosa (npm start).
 */

const readline = require('node:readline');

const COSMOS_URL = (process.env.COSMOS_URL || 'http://localhost:3000').replace(/\/+$/, '');
// Gdy Cosmos wymaga logowania (VPS): ustaw COSMOS_TOKEN = wartość COSMOS_API_TOKEN z .env serwera.
const COSMOS_TOKEN = process.env.COSMOS_TOKEN || '';

const authHeaders = COSMOS_TOKEN ? { Authorization: `Bearer ${COSMOS_TOKEN}` } : {};

const TOOLS = [
  {
    name: 'cosmos_kb_search',
    description: 'Przeszukuje bazę wiedzy Cosmosa (pliki, linki, notatki użytkownika) i zwraca pasujące fragmenty.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Zapytanie w języku naturalnym' } },
      required: ['query'],
    },
  },
  {
    name: 'cosmos_kb_list',
    description: 'Listuje wszystkie pozycje w bazie wiedzy Cosmosa (nazwa, typ, rozmiar, data).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cosmos_kb_add_note',
    description: 'Zapisuje notatkę tekstową w bazie wiedzy Cosmosa.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Treść notatki' },
        title: { type: 'string', description: 'Opcjonalny tytuł' },
      },
      required: ['text'],
    },
  },
  {
    name: 'cosmos_memory_list',
    description: 'Zwraca wpisy pamięci długotrwałej Cosmosa (fakty zapamiętane przez użytkownika).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cosmos_events',
    description: 'Zwraca ostatnie zdarzenia percepcji Cosmosa (kamera, Kinect, studio, internet).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cosmos_generate_image',
    description: 'Generuje obraz przez Studio Cosmosa (OpenAI; wymaga OPENAI_API_KEY po stronie Cosmosa). Obraz trafia do bazy wiedzy.',
    inputSchema: {
      type: 'object',
      properties: { prompt: { type: 'string', description: 'Opis obrazu (najlepiej po angielsku)' } },
      required: ['prompt'],
    },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'cosmos_kb_search': {
      const r = await fetch(`${COSMOS_URL}/api/kb/search?q=${encodeURIComponent(args.query || '')}`, { headers: authHeaders });
      const d = await r.json();
      if (!d.results?.length) return 'Brak pasujących fragmentów w bazie wiedzy.';
      return d.results.map((f) => `### ${f.name}\n${f.text}`).join('\n\n');
    }
    case 'cosmos_kb_list': {
      const r = await fetch(`${COSMOS_URL}/api/kb`, { headers: authHeaders });
      const d = await r.json();
      if (!d.items?.length) return 'Baza wiedzy jest pusta.';
      return d.items.map((i) =>
        `- [${i.type}] ${i.name} (${i.textChars} znaków tekstu, ${new Date(i.time).toLocaleDateString('pl-PL')})`
      ).join('\n');
    }
    case 'cosmos_kb_add_note': {
      const r = await fetch(`${COSMOS_URL}/api/kb/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ text: args.text, title: args.title }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return `Zapisano notatkę: ${d.item.name}`;
    }
    case 'cosmos_memory_list': {
      const r = await fetch(`${COSMOS_URL}/api/memory`, { headers: authHeaders });
      const d = await r.json();
      if (!d.memories?.length) return 'Pamięć długotrwała jest pusta.';
      return d.memories.map((m) => `- ${m.text}`).join('\n');
    }
    case 'cosmos_events': {
      const r = await fetch(`${COSMOS_URL}/api/events`, { headers: authHeaders });
      const d = await r.json();
      if (!d.events?.length) return 'Brak zdarzeń percepcji.';
      return d.events.map((e) =>
        `[${new Date(e.time).toLocaleTimeString('pl-PL')}] (${e.type}) ${e.summary}`
      ).join('\n');
    }
    case 'cosmos_generate_image': {
      const r = await fetch(`${COSMOS_URL}/api/studio/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ prompt: args.prompt }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return `Wygenerowano obraz „${d.item.name}” — dostępny pod ${COSMOS_URL}${d.url}` +
             (d.exported ? ` oraz w ${d.exported}` : '');
    }
    default:
      throw new Error(`Nieznane narzędzie: ${name}`);
  }
}

// --- minimalny serwer JSON-RPC 2.0 po stdio (transport MCP) ---

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }
  const { id, method, params } = req;

  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'cosmos-mcp', version: '1.0.0' },
        },
      });
    }
    if (method === 'notifications/initialized' || String(method).startsWith('notifications/')) {
      return; // powiadomienia nie wymagają odpowiedzi
    }
    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }
    if (method === 'tools/call') {
      const text = await callTool(params?.name, params?.arguments || {});
      return send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: String(text) }] },
      });
    }
    if (method === 'ping') {
      return send({ jsonrpc: '2.0', id, result: {} });
    }
    if (id !== undefined) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Nieobsługiwana metoda: ${method}` } });
    }
  } catch (err) {
    if (id !== undefined) {
      send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: `Błąd: ${err.message}` }], isError: true },
      });
    }
  }
});

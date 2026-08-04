/* ============================================================
   Jarvis — urządzenia domowe i poranna odprawa

   Urządzenia to prosty mostek HTTP: definiujesz adres i metodę, Cosmos może
   ZAPROPONOWAĆ użycie w rozmowie, ale wykonanie zawsze wymaga kliknięcia.
   Odprawa składa pogodę, kalendarz i zaplanowane rutyny w jedno streszczenie.
   ============================================================ */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { DATA_DIR, readJson, sendJson } = require('./rdzen.js');

/* Wstrzykiwane przez server.js — te elementy należą do innych dziedzin.
   Zamiast krzyżowych `require` (i pułapki cyklicznych zależności) serwer
   podaje je raz, przy starcie. */
let addEvent, recentEvents;
function polacz(z) {
  ({ addEvent, recentEvents } = z);
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
  const due = rutyny().filter((r) => r.pending).map((r) => routineView(r).procedureName);
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


/* `devices` jest podmieniane przy usuwaniu, więc wychodzi jako funkcja —
   tablica dałaby serwerowi kopię wiązania i nieaktualny stan. */
module.exports = { BRIEFING, handleBriefing, handleDevices, polacz, urzadzenia: () => devices };

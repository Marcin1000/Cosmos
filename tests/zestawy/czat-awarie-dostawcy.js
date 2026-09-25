/* Czat na serwerze, gdy dostawca modelu zawodzi (server.js handleChat + lib/biegi.js).
 *
 * Każdy przypadek odtworzony przez przegląd backendu na atrapie awarii:
 *   1. strumień urwany bez [DONE] i finish_reason → bieg kończy się błędem,
 *      a nie urwanym zdaniem udającym pełną odpowiedź,
 *   2. ramki rozdzielane „\r\n\r\n" (llama-cpp-python) płyną na bieżąco,
 *      a nie jednym kawałkiem na końcu,
 *   3. dostawca milczy po nagłówkach → błąd po limicie ciszy, nie 300 s,
 *   4. dostawca milczy przed nagłówkami → 504 po limicie ciszy,
 *   5. zerwane gniazdo → polski komunikat, nie surowe „terminated",
 *   6. „Stop" zanim dostawca odpowie → nic nie trafia do rozmowy,
 *   7. odpowiedź-sierota zapisana bez znacznika narzędzia i z silnikiem. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3487;
const S = `http://127.0.0.1:${PORT}`;
const problemy = [];
const ok = (w, opis) => { console.log(`${w ? 'OK ' : 'ZLE'} ${opis}`); if (!w) problemy.push(opis); };
const spij = (ms) => new Promise((r) => setTimeout(r, ms));

const atrapa = http.createServer((req, res) => {
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"test"}]}'); }
  let b = '';
  req.on('data', (c) => { b += c; }).on('end', () => {
    let d = {}; try { d = JSON.parse(b); } catch { /* puste */ }
    const ost = [...(d.messages || [])].reverse().find((m) => m.role === 'user') || { content: '' };
    const t = typeof ost.content === 'string' ? ost.content : JSON.stringify(ost.content);
    if (/przedcisza/.test(t)) return;
    if (/opoznij/.test(t)) {
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Odpowiedź po stopie.' } }] })}\n\ndata: [DONE]\n\n`);
      }, 1500);
      return;
    }
    const sep = /crlf/.test(t) ? '\r\n\r\n' : '\n\n';
    const ch = (s) => `data: ${JSON.stringify({ choices: [{ delta: { content: s } }] })}${sep}`;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (/sierota/.test(t)) {
      setTimeout(() => {
        res.write(ch('Sprawdzę to.\n[SZUKAJ: pogoda Kraków]'));
        res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}${sep}data: [DONE]${sep}`);
      }, 400);
      return;
    }
    res.write(ch('Początek. '));
    if (/cisza/.test(t)) return;
    if (/urwij/.test(t)) { setTimeout(() => res.socket.destroy(), 200); return; }
    if (/bezdone/.test(t)) { setTimeout(() => { res.write(ch('Środek zdania i')); res.end(); }, 150); return; }
    let i = 0;
    const n = /dlugo/.test(t) ? 12 : 3;
    const tm = setInterval(() => {
      res.write(ch(`kawałek${i} `));
      if (++i >= n) { clearInterval(tm); res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}${sep}data: [DONE]${sep}`); }
    }, 100);
  });
});

const los = () => 'b' + Math.random().toString(36).slice(2, 12);
async function czat(slowo, { bieg = los(), rozmowa = '', zerwijPoMs = 0 } = {}) {
  const t0 = Date.now();
  const ac = new AbortController();
  if (zerwijPoMs) setTimeout(() => ac.abort(), zerwijPoMs);
  try {
    const r = await fetch(`${S}/api/chat`, {
      method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'cloud', bieg, rozmowa, useSenses: false, useMemory: false, useKb: false, useSearch: false,
        messages: [{ role: 'user', content: slowo }] }),
    });
    let txt = '';
    const kiedy = [];
    const rd = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      const k = dec.decode(value);
      if (/kawałek/.test(k)) kiedy.push(Date.now() - t0);
      txt += k;
    }
    let koniec = null;
    const m = txt.match(/event: koniec\ndata: (.*)/);
    if (m) { try { koniec = JSON.parse(m[1]); } catch { koniec = {}; } }
    return { status: r.status, czas: Date.now() - t0, txt, kiedy, koniec };
  } catch (e) {
    return { wyjatek: e.name, czas: Date.now() - t0 };
  }
}

(async () => {
  await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
  const srv = serwerCosmosa(PORT, {
    NEMOTRON_BASE_URL: `http://127.0.0.1:${atrapa.address().port}/v1`, SENSES_URL: 'http://127.0.0.1:1',
    COSMOS_CISZA_MODELU_MS: '1500', COSMOS_BIEG_SIEROTA_MS: '600',
  });
  if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer nie wstał');

  let w = await czat('zwykle');
  ok(w.status === 200 && w.koniec && !w.koniec.blad, `zwykła odpowiedź kończy się bez błędu (${w.koniec && w.koniec.blad})`);

  w = await czat('bezdone');
  ok(w.koniec && /urwał/.test(w.koniec.blad || ''), `1. strumień bez [DONE] → błąd „urwał" (${w.koniec && w.koniec.blad})`);

  w = await czat('crlf dlugo');
  const rozpietosc = w.kiedy.length > 1 ? w.kiedy[w.kiedy.length - 1] - w.kiedy[0] : 0;
  ok(w.kiedy.length >= 6 && rozpietosc > 500, `2. ramki \\r\\n płyną na bieżąco (${w.kiedy.length} kawałków w ${rozpietosc} ms)`);
  ok(w.koniec && !w.koniec.blad, '2. ramki \\r\\n — koniec rozpoznany, bez błędu');

  w = await czat('cisza');
  ok(w.koniec && /zamilkł/.test(w.koniec.blad || '') && w.czas < 5000, `3. cisza po nagłówkach → błąd po limicie (${w.czas} ms, ${w.koniec && w.koniec.blad})`);

  w = await czat('przedcisza');
  ok(w.status === 504 && w.czas < 5000, `4. cisza przed nagłówkami → 504 (${w.status}, ${w.czas} ms)`);

  w = await czat('urwij');
  ok(w.koniec && w.koniec.blad && !/terminated/i.test(w.koniec.blad), `5. zerwane gniazdo → polski komunikat (${w.koniec && w.koniec.blad})`);

  // --- 6 i 7 potrzebują pliku rozmowy
  const katRozmow = path.join(srv.katalogDanych, 'uzytkownicy', 'wlasciciel', 'conversations');
  fs.mkdirSync(katRozmow, { recursive: true });
  const nowa = (id) => fs.writeFileSync(path.join(katRozmow, `${id}.json`),
    JSON.stringify({ id, title: 't', messages: [{ role: 'user', content: 'x' }], createdAt: Date.now(), updatedAt: Date.now() }));
  const zPliku = (id) => JSON.parse(fs.readFileSync(path.join(katRozmow, `${id}.json`), 'utf8'));

  nowa('rozmowastop');
  const bieg = los();
  const wStop = czat('opoznij', { bieg, rozmowa: 'rozmowastop' });
  await spij(300);
  const st = await (await fetch(`${S}/api/chat/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bieg }) })).json();
  await wStop;
  await spij(2500);
  const poStopie = zPliku('rozmowastop').messages.filter((m) => m.role === 'assistant');
  ok(st.ok === true, `6. „Stop" przed nagłówkami dostawcy — przyjęty (${JSON.stringify(st)})`);
  ok(poStopie.length === 0, `6. nic nie trafiło do rozmowy po „Stop" (${poStopie.length})`);

  nowa('rozmowasierota');
  await czat('sierota', { rozmowa: 'rozmowasierota', zerwijPoMs: 100 });
  await spij(2500);
  const sierota = zPliku('rozmowasierota').messages.find((m) => m.role === 'assistant');
  ok(sierota && !/\[SZUKAJ/.test(sierota.content) && /Sprawdzę to/.test(sierota.content), `7. sierota bez znacznika (${sierota && JSON.stringify(sierota.content).slice(0, 80)})`);
  ok(sierota && sierota.silnik === 'cloud', `7. sierota z silnikiem (${sierota && sierota.silnik})`);

  zabij(srv); atrapa.close();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nCZAT WOBEC AWARII DOSTAWCY OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

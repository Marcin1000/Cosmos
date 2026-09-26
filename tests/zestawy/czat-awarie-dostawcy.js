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
 *   7. odpowiedź-sierota zapisana bez znacznika narzędzia i z silnikiem,
 *   8. przeciążenie (529) ponowione — oficjalne SDK robią to samo,
 *   9. brak środków (insufficient_quota) NIE ponawiany, z podpowiedzią po polsku,
 *  10. Retry-After dłuższy niż cierpliwość → błąd od razu, bez czekania,
 *  11. błąd dostawcy w środku strumienia → nazwana przyczyna, fragment zostaje,
 *  12. za długi kontekst → jedna próba z mniejszym limitem odpowiedzi,
 *  13. zdjęcie odrzucone kodem 500 (Ollama) → ponowienie z modelem wizyjnym,
 *  14. model myślący po cichu → dłuższy limit do pierwszej treści, z pulsem,
 *  15. restart serwera w trakcie odpowiedzi → odpowiedź dokończona i zapisana,
 *  16. uśpiony komputer domowy → nazwana przyczyna i bezpiecznik 30 s. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3487;
const S = `http://127.0.0.1:${PORT}`;
const problemy = [];
const ok = (w, opis) => { console.log(`${w ? 'OK ' : 'ZLE'} ${opis}`); if (!w) problemy.push(opis); };
const spij = (ms) => new Promise((r) => setTimeout(r, ms));

const proby = {};                 // słowo → ile żądań dostał dostawca
const ostatnie = {};              // słowo → treść ostatniego żądania
const blad = (res, kod, tresc, naglowki = {}) => {
  res.writeHead(kod, { 'Content-Type': 'application/json', ...naglowki });
  res.end(JSON.stringify(tresc));
};
const atrapa = http.createServer((req, res) => {
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[{"id":"test"}]}'); }
  let b = '';
  req.on('data', (c) => { b += c; }).on('end', () => {
    let d = {}; try { d = JSON.parse(b); } catch { /* puste */ }
    const ost = [...(d.messages || [])].reverse().find((m) => m.role === 'user') || { content: '' };
    const t = typeof ost.content === 'string' ? ost.content : JSON.stringify(ost.content);
    const slowo = (t.match(/przeciazony|brakgotowki|poczekajdlugo|bladwtrakcie|zadlugo|zdjecie|myslipocichu/) || [''])[0];
    if (slowo) { proby[slowo] = (proby[slowo] || 0) + 1; ostatnie[slowo] = d; }
    if (slowo === 'przeciazony' && proby[slowo] < 3) {
      return blad(res, 529, { error: { message: 'Overloaded', type: 'overloaded_error' } }, { 'retry-after': '0.2' });
    }
    if (slowo === 'brakgotowki') {
      return blad(res, 429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } });
    }
    if (slowo === 'poczekajdlugo') {
      return blad(res, 429, { error: { message: 'Rate limit reached', type: 'rate_limit_error' } }, { 'retry-after': '20' });
    }
    if (slowo === 'zadlugo' && (d.max_tokens || d.max_completion_tokens) > 1100) {
      return blad(res, 400, { error: { message: "This model's maximum context length is 4096 tokens. However, you requested 5048 tokens (3000 in the messages, 2048 in the completion)." } });
    }
    if (slowo === 'zdjecie' && d.model !== 'wizja-model') {
      return blad(res, 500, { error: 'this model is missing data required for image input' });
    }
    if (slowo === 'bladwtrakcie') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Połowa odpowiedzi, dość długa.' } }] })}\n\n`);
      return setTimeout(() => res.end(`data: ${JSON.stringify({ error: { message: 'Overloaded', type: 'overloaded_error' } })}\n\n`), 150);
    }
    if (slowo === 'myslipocichu') {
      // Nagłówki od razu, potem 2,5 s ciszy (myślenie bez reasoning_content), dopiero wtedy treść.
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`);
      return setTimeout(() => res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Przemyślana odpowiedź.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`), 2500);
    }
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
async function czat(slowo, { bieg = los(), rozmowa = '', zerwijPoMs = 0, adres = S, dodatki = {}, tresc = null } = {}) {
  const t0 = Date.now();
  const ac = new AbortController();
  if (zerwijPoMs) setTimeout(() => ac.abort(), zerwijPoMs);
  try {
    const r = await fetch(`${adres}/api/chat`, {
      method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'cloud', bieg, rozmowa, useSenses: false, useMemory: false, useKb: false, useSearch: false,
        messages: [{ role: 'user', content: tresc || slowo }], ...dodatki }),
    });
    if (!(r.headers.get('content-type') || '').includes('event-stream')) {
      let json = {}; try { json = await r.json(); } catch { /* nie JSON */ }
      return { status: r.status, czas: Date.now() - t0, json, naglowki: r.headers };
    }
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
    return { status: r.status, czas: Date.now() - t0, txt, kiedy, koniec, naglowki: r.headers };
  } catch (e) {
    return { wyjatek: e.name, czas: Date.now() - t0 };
  }
}

(async () => {
  await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
  const srv = serwerCosmosa(PORT, {
    NEMOTRON_BASE_URL: `http://127.0.0.1:${atrapa.address().port}/v1`, SENSES_URL: 'http://127.0.0.1:1',
    COSMOS_CISZA_MODELU_MS: '1500', COSMOS_BIEG_SIEROTA_MS: '600',
    NEMOTRON_VISION_MODEL: 'wizja-model', COSMOS_CISZA_MYSLENIA_MS: '6000', COSMOS_PULS_MS: '400',
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

  // --- 8–10: ponawiać tylko to, co ponowienie może naprawić
  w = await czat('przeciazony');
  ok(w.koniec && !w.koniec.blad && proby.przeciazony === 3, `8. przeciążenie (529) ponowione — ${proby.przeciazony} żądania, odpowiedź doszła`);
  w = await czat('brakgotowki');
  ok(w.status === 429 && proby.brakgotowki === 1, `9. brak środków nie ponawiany (${proby.brakgotowki} żądanie)`);
  ok(/środki|limit wydatków/i.test(w.json && w.json.error || ''), `9. podpowiedź mówi o środkach, nie „spróbuj za chwilę" (${(w.json && w.json.error || '').slice(0, 90)}…)`);
  w = await czat('poczekajdlugo');
  ok(w.status === 429 && proby.poczekajdlugo === 1 && w.czas < 1500, `10. Retry-After 20 s → błąd od razu (${w.czas} ms, ${proby.poczekajdlugo} żądanie)`);

  // --- 11: błąd po 200, w środku strumienia
  nowa('rozmowabled');
  w = await czat('bladwtrakcie', { rozmowa: 'rozmowabled' });
  ok(w.koniec && /Dostawca przerwał/.test(w.koniec.blad || '') && /przeciążony/.test(w.koniec.blad || ''),
    `11. błąd w trakcie → nazwana przyczyna (${(w.koniec && w.koniec.blad || '').slice(0, 70)}…)`);
  ok(/Połowa odpowiedzi/.test(w.txt) && !/overloaded_error/.test(w.txt), '11. napisany fragment doszedł, a surowy blok błędu nie trafił do przeglądarki');
  await spij(1500);
  const zBledem = zPliku('rozmowabled').messages.find((m) => m.role === 'assistant');
  ok(zBledem && /Połowa odpowiedzi/.test(zBledem.content) && /⚠/.test(zBledem.content),
    `11. w rozmowie zostaje fragment i pod nim przyczyna (${zBledem && JSON.stringify(zBledem.content).slice(0, 70)})`);

  // --- 12: kontekst
  w = await czat('zadlugo');
  const limit = ostatnie.zadlugo && (ostatnie.zadlugo.max_tokens || ostatnie.zadlugo.max_completion_tokens);
  ok(w.koniec && !w.koniec.blad && proby.zadlugo === 2 && limit === 1032,
    `12. za długi kontekst → druga próba z limitem ${limit} (4096 − 3000 − zapas) i odpowiedź`);

  // --- 13: zdjęcie odrzucone kodem 500, model wizyjny ustawiony
  w = await czat('zdjecie', { dodatki: { model: 'slepy-model-spoza-katalogu' },
    tresc: [{ type: 'text', text: 'zdjecie — co tu jest?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] });
  ok(w.koniec && !w.koniec.blad && decodeURIComponent(w.naglowki.get('x-cosmos-model') || '') === 'wizja-model'
    && decodeURIComponent(w.naglowki.get('x-cosmos-model-swapped-from') || '') === 'slepy-model-spoza-katalogu',
  `13. odmowa obrazu (500) → ponowienie z modelem wizyjnym, jawnie (${w.naglowki && w.naglowki.get('x-cosmos-model')})`);

  // --- 14: myślenie po cichu
  w = await czat('myslipocichu', { dodatki: { model: 'claude-sonnet-5' } });
  ok(w.koniec && !w.koniec.blad && /Przemyślana/.test(w.txt), `14. Claude myślący 2,5 s po cichu nie jest „zamilkłym" (${w.koniec && w.koniec.blad})`);
  ok(/: puls/.test(w.txt), '14. w czasie ciszy przeglądarka dostaje puls (Cloudflare nie zerwie)');
  w = await czat('myslipocichu', { dodatki: { model: 'zwykly-model' } });
  ok(w.koniec && /zamilkł/.test(w.koniec.blad || ''), '14. zwykły model milczący tak samo długo — dalej „zamilkł" po 1,5 s');

  // --- 15: restart w trakcie odpowiedzi (musi być ostatni — zamyka serwer)
  nowa('rozmowarestart');
  const wRestart = czat('dlugo restart', { rozmowa: 'rozmowarestart', zerwijPoMs: 300 });
  await spij(450);
  process.kill(srv.pid, 'SIGTERM');
  await wRestart;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try { process.kill(srv.pid, 0); } catch { break; }   // czekamy, aż proces sam się zamknie
    await spij(200);
  }
  const poRestarcie = zPliku('rozmowarestart').messages.find((m) => m.role === 'assistant');
  ok(poRestarcie && /kawałek11/.test(poRestarcie.content),
    `15. restart w trakcie → odpowiedź dokończona i zapisana w rozmowie (${poRestarcie ? `${poRestarcie.content.length} znaków` : 'brak'})`);

  // --- 16: uśpiony komputer domowy (osobny serwer: limit ciszy musi być dłuższy niż czekanie na połączenie)
  const PORT2 = 3492;
  const srv2 = serwerCosmosa(PORT2, { LOCAL_BASE_URL: 'http://10.255.255.1:11434/v1', LOCAL_MODEL: 'lokalny-test', SENSES_URL: 'http://127.0.0.1:1' });
  const S2 = `http://127.0.0.1:${PORT2}`;
  if (!(await czekajNa(`${S2}/api/auth`))) throw new Error('drugi serwer nie wstał');
  const l1 = await czat('uspiony', { adres: S2, dodatki: { endpoint: 'local' } });
  ok(l1.status === 502 && /uśpiony|poza Tailscale/.test(l1.json.error || ''), `16. uśpiony komputer → nazwana przyczyna (${l1.czas} ms: ${(l1.json.error || '').slice(0, 60)}…)`);
  const l2 = await czat('uspiony', { adres: S2, dodatki: { endpoint: 'local' } });
  ok(l2.status === 502 && l2.czas < 1000 && /przed chwilą/.test(l2.json.error || ''), `16. druga wiadomość bez czekania — bezpiecznik (${l2.czas} ms)`);
  zabij(srv2);

  zabij(srv); atrapa.close();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nCZAT WOBEC AWARII DOSTAWCY OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

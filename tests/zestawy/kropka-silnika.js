/* Kropka silnika w plakietce i w powitaniu – przeglądarka (runda 10, kontrakt K1).

   Marcin, zrzut 2: „kropka w prawym górnym rogu przy modelu lokalnym nie
   zmienia koloru – powinna być niebieska”. Lokalny model właśnie odpowiadał,
   a plakietka była szara, bo jedynym źródłem stanu było /api/status co 30 s –
   udana odpowiedź, przełączenie zakładki ani powrót do aplikacji jej nie
   poprawiały. Do tego kropka w powitaniu była zawsze w kolorze silnika:
   dwa sprzeczne sygnały na jednym ekranie. Serwer (stan-silnikow) mówi teraz
   true / false / null („nie wiadomo”) z powodem; tu pilnujemy strony klienta:

     1. `online: false` → kropka szara w plakietce I w powitaniu, podpowiedź
        zdaniem według powodu (nie „offline”),
     2. udana odpowiedź silnika → kropka od razu w kolorze,
     3. przez 2 minuty po udanej odpowiedzi sprawdzenie mówiące „offline” jej
        nie gasi (inaczej migałaby co 30 s),
     4. `online: null` (termin sprawdzenia) → kolor zostaje, podpowiedź mówi
        o terminie (8 s dla lokalnego),
     5. powrót do aplikacji odświeża stan – ale nie częściej niż co 10 s,
     6. przełączenie na zakładkę silnika w stanie „offline” odświeża stan,
     7. czat mówi „lokalny niedostępny” → kropka gaśnie od razu, bez czekania. */
const http = require('node:http');
const { serwerCosmosa, czekajNa, zabij, przegladarka, maPrzegladarke } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

const PORT = 3595;
const PORT_ATRAPY = 7595;
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

// Atrapa lokalnego: GET /models → 500 (serwer powie „offline, http-500”), czat działa.
const atrapa = http.createServer((req, res) => {
  if (req.url.endsWith('/chat/completions')) {
    req.resume();
    return req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Cześć z domu.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  }
  if (req.url.endsWith('/models')) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"error":"boom"}'); }
  res.writeHead(404); res.end();
});

(async () => {
  await new Promise((r) => atrapa.listen(PORT_ATRAPY, '127.0.0.1', r));
  const srv = serwerCosmosa(PORT, {
    NEMOTRON_BASE_URL: `http://127.0.0.1:${PORT_ATRAPY}/v1`,
    LOCAL_BASE_URL: `http://127.0.0.1:${PORT_ATRAPY}/v1`, LOCAL_API_KEY: 'test', LOCAL_MODEL: 'local/model-testowy',
  });
  const b = await przegladarka();
  try {
    await czekajNa(`http://127.0.0.1:${PORT}/api/config`);
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const bledy = [];
    p.on('pageerror', (e) => bledy.push(e.message));
    let statusow = 0;
    let podmiana = null;       // podstawiona odpowiedź /api/status (przypadki 3 i 4)
    let czatBlad = false;      // przypadek 7
    await p.route('**/api/status', async (r) => {
      statusow++;
      if (podmiana) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(podmiana) });
      return r.continue();
    });
    await p.route('**/api/chat', (r) => {
      if (!czatBlad || r.request().method() !== 'POST') return r.continue();
      return r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Komputer z modelem nie odpowiada.', kod: 'lokalny-niedostepny' }) });
    });
    await p.goto(`http://127.0.0.1:${PORT}/app`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.app.gotowa'));
    const kropka = () => p.evaluate(() => ({
      szara: document.getElementById('topbar-model').classList.contains('niedostepny'),
      powitanie: document.querySelector('.welcome-kropka')?.classList.contains('niedostepny') || false,
      podpowiedz: document.getElementById('topbar-model').title,
    }));

    /* ---- 1. online:false → szara w obu miejscach, podpowiedź z powodu ---- */
    await p.click('.endpoint-tab[data-endpoint="local"]');
    await p.evaluate(() => refreshStatus());
    const k1 = await kropka();
    ok(k1.szara && k1.powitanie, `1. „offline” (http-500): kropka szara w plakietce i w powitaniu (${k1.szara}/${k1.powitanie})`);
    ok(k1.podpowiedz && !/^offline$/i.test(k1.podpowiedz), `1. podpowiedź zdaniem, nie „offline” („${k1.podpowiedz}”)`);

    /* ---- 2. udana odpowiedź → kolor od razu ---- */
    await p.fill('#input', 'Cześć');
    await p.click('#send-btn');
    await p.waitForFunction(() => /Cześć z domu/.test(document.getElementById('messages').textContent) && document.getElementById('stop-btn').style.display === 'none', null, { timeout: 15000 });
    const k2 = await kropka();
    ok(!k2.szara && !k2.powitanie, `2. po udanej odpowiedzi lokalnego kropka w kolorze (${k2.szara}/${k2.powitanie})`);

    /* ---- 3. sprawdzenie „offline” w ciągu 2 min po odpowiedzi nie gasi ---- */
    podmiana = { cloud: { online: true, powod: '' }, local: { online: false, status: 500, powod: 'http-500' } };
    await p.evaluate(() => refreshStatus());
    const k3 = await kropka();
    ok(!k3.szara, '3. sprawdzenie „offline” zaraz po udanej odpowiedzi nie gasi kropki (bez migania co 30 s)');

    /* ---- 4. null (termin) → kolor zostaje, podpowiedź o terminie ---- */
    await p.evaluate(() => { ostatniKontakt.local = 0; });
    podmiana = { cloud: { online: true, powod: '' }, local: { online: null, status: 0, powod: 'termin' } };
    await p.evaluate(() => refreshStatus());
    const k4 = await kropka();
    ok(!k4.szara && /8 s/.test(k4.podpowiedz), `4. „nie wiadomo” (termin): kolor zostaje, podpowiedź o 8 s („${k4.podpowiedz}”)`);

    /* ---- 5. powrót do aplikacji: odświeżenie, ale nie częściej niż co 10 s ---- */
    await p.evaluate(() => { ostatnieSprawdzenie = 0; });
    const przed5 = statusow;
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(400);
    const po5 = statusow;
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(400);
    ok(po5 === przed5 + 1 && statusow === po5, `5. powrót do aplikacji odświeża stan raz, drugi zaraz potem już nie (+${po5 - przed5}, potem +${statusow - po5})`);

    /* ---- 6. zakładka silnika w stanie „offline” → odświeżenie ---- */
    podmiana = { cloud: { online: true, powod: '' }, local: { online: false, status: 500, powod: 'http-500' } };
    await p.evaluate(() => { ostatnieSprawdzenie = 0; ostatniKontakt.local = 0; });
    await p.evaluate(() => refreshStatus());
    await p.click('.endpoint-tab[data-endpoint="cloud"]');
    await p.evaluate(() => { ostatnieSprawdzenie = 0; });
    const przed6 = statusow;
    await p.click('.endpoint-tab[data-endpoint="local"]');
    await p.waitForTimeout(400);
    ok(statusow === przed6 + 1, `6. przełączenie na zakładkę „offline” sprawdza stan od razu (+${statusow - przed6})`);

    /* ---- 7. „lokalny niedostępny” z czatu → szara od razu ---- */
    podmiana = { cloud: { online: true, powod: '' }, local: { online: true, status: 200, powod: '' } };
    await p.evaluate(() => refreshStatus());
    czatBlad = true;
    await p.fill('#input', 'Jeszcze raz');
    await p.click('#send-btn');
    await p.waitForFunction(() => document.getElementById('stop-btn').style.display === 'none' && document.querySelector('.msg-error'), null, { timeout: 15000 }).catch(() => {});
    const k7 = await kropka();
    ok(k7.szara, '7. czat mówi „lokalny niedostępny” → kropka gaśnie od razu, nie po 30 s');

    ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    await b.close();
    zabij(srv);
    atrapa.close();
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nKROPKA SILNIKA OK');
  process.exit(fail.length ? 1 : 0);
})();

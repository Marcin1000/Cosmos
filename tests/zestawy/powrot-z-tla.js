/* Powrót z tła na telefonie i paski zdjęć (runda 12).

   Marcin: „Kiedy zmieniam okno na telefonie, to rozłącza Cosmosa” oraz „nie
   pokazujmy zdjęć w odpowiedziach, których nie można wczytać lub nie pokazują
   miejsca”. Telefon budzi stronę chwilę przed siecią: pierwsze /api/status
   padało, pasek „Brak połączenia z serwerem Cosmosa” wisiał do 30 s, Wyślij
   było zablokowane, a odpowiedź gotowa na serwerze nie wracała, dopóki ktoś
   jeszcze raz nie zmienił okna.

   Cosmos na 3681, przed nim pośrednik TCP 3682 („winda”: zrywa połączenia
   i odcina sieć), atrapa dostawcy 7681. Widoczność karty podstawiona
   (`document.visibilityState`), jak w pomiarze it-plynnosc (pomiar5-cykl.js).

   A. Krótkie tło, sieć wraca 2 s po stronie: ani paska, ani zablokowanego
      Wyślij; na powrocie JEDNO /api/status (zaległe tyknięcie co 30 s nie dubluje).
   B. Sieć nie wraca: pasek dopiero po oknie łaski (10 s), znika sam, gdy sieć
      wróci – bez zdarzenia 'online', którego telefon wtedy nie wysyła.
   C. Każda odpowiedź serwera dowodzi osiągalności: pasek gaśnie po udanym
      pobraniu rozmów, choć /api/status dalej pada.
   D. Odpowiedź porzucona bez sieci: karta ma „Pobierz odpowiedź” (nie płatne
      „Ponów”); powrót do karty przy wciąż martwej sieci ponawia się sam
      i pełna odpowiedź wraca bez nowego zapytania do modelu.
   D2. „Pobierz odpowiedź” pobiera odpowiedź z serwera, nie pyta modelu.
   E. Przeładowanie w trakcie odpowiedzi, /api/* martwe przez 3 s po starcie
      (Android wyrzucił kartę): odpowiedź wraca sama, bez zmiany okna.
   F. Prośba o zdjęcia, a plan bez znaczników: zdjęcia miejsc z nagłówków
      „### Dzień N · X”; bez prośby – żadnych.
   G. Pasek zdjęć: kafel niewczytany, ikonka i baner znikają; etykieta miejsca
      przechodzi na następny kafel; miejsce bez zdjęć znika z paska; pasek bez
      zdjęć znika cały; porażki zapamiętane w rozmowie (także na serwerze).
*/
const http = require('http');
const net = require('net');
const zlib = require('zlib');
const path = require('path');
const { serwerCosmosa, czekajNa, zwolnijPorty, przegladarka, maPrzegladarke, wynik } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

const PORT = 3681;
const POSREDNIK = 3682;
const ATRAPA = 7681;
const w = wynik('powrot-z-tla');
const ok = (warunek, opis) => { console.log(`${warunek ? '✓' : '✗'} ${opis}`); w.sprawdz(warunek, opis); return warunek; };
const spij = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- PNG
/* Prawdziwy PNG o zadanych wymiarach – przeglądarka musi go zdekodować, żeby
   pasek mógł zmierzyć miniaturę (naturalWidth/Height). */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(szer, wys, [r, g, b] = [90, 140, 180]) {
  const kawalek = (typ, dane) => {
    const dl = Buffer.alloc(4); dl.writeUInt32BE(dane.length);
    const td = Buffer.concat([Buffer.from(typ), dane]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([dl, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(szer, 0); ihdr.writeUInt32BE(wys, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const wiersz = Buffer.alloc(1 + szer * 3);
  for (let x = 0; x < szer; x++) { wiersz[1 + x * 3] = (r + x) & 255; wiersz[2 + x * 3] = g; wiersz[3 + x * 3] = b; }
  const surowe = Buffer.concat(Array.from({ length: wys }, () => wiersz));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), kawalek('IHDR', ihdr), kawalek('IDAT', zlib.deflateSync(surowe)), kawalek('IEND', Buffer.alloc(0))]);
}
const ZDJECIE = png(208, 156);
const IKONKA = png(48, 48, [200, 30, 30]);
const BANER = png(600, 120, [30, 30, 200]);
/** Miniatury testowe pod /test-zdj/: dobre-*, ikonka-*, baner-*, reszta – 404. */
const podstawMiniatury = (page) => page.route('**/test-zdj/**', (r) => {
  const plik = r.request().url().split('/test-zdj/')[1] || '';
  if (/^dobre/.test(plik)) return r.fulfill({ status: 200, contentType: 'image/png', body: ZDJECIE });
  if (/^ikonka/.test(plik)) return r.fulfill({ status: 200, contentType: 'image/png', body: IKONKA });
  if (/^baner/.test(plik)) return r.fulfill({ status: 200, contentType: 'image/png', body: BANER });
  return r.fulfill({ status: 404, body: '' });
});

// ---------------------------------------------------------------- atrapa
const DLUGI = 'Odpowiedź płynie powoli, zdanie po zdaniu, żeby sieć zdążyła zniknąć w połowie. '.repeat(12);
const PLAN_DNI = `**Tydzień na Sycylii**

### Dzień 1 · Palermo · zwiedzanie
Spacer po Quattro Canti i katedrze, wieczorem targ Ballarò.

### Dzień 2 · Odpoczynek · Cefalù
Plaża rano, starówka po południu.

### Dzień 3 · Taormina
Teatro Greco rano, Isola Bella po południu.
`;
const tekstWiad = (ms) => (ms || []).map((m) => (typeof m.content === 'string' ? m.content
  : Array.isArray(m.content) ? m.content.map((p) => p.text || '').join('\n') : '')).join('\n\n');

function strumien(res, tekst, krokMs = 15) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const kawalki = tekst.match(/[\s\S]{1,8}/g) || [];
  let i = 0;
  const tik = setInterval(() => {
    if (res.destroyed) { clearInterval(tik); return; }
    if (i >= kawalki.length) {
      clearInterval(tik);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 40 } })}\n\n`);
      res.write('data: [DONE]\n\n'); res.end();
      return;
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: kawalki[i++] } }] })}\n\n`);
  }, krokMs);
  res.on('close', () => clearInterval(tik));
}

const atrapa = http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ object: 'list', data: [{ id: 'nvidia/nemotron-3-super-120b-a12b', object: 'model' }] }));
  }
  if (req.url !== '/v1/chat/completions' || req.method !== 'POST') { res.writeHead(404); return res.end('{}'); }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let p;
    try { p = JSON.parse(body); } catch { res.writeHead(400); return res.end('{}'); }
    const pytanie = [...(p.messages || [])].reverse().find((m) => m.role === 'user' && /scena-/.test(tekstWiad([m])));
    const sc = ((pytanie && tekstWiad([pytanie]).match(/scena-([a-z]+)/)) || [])[1] || '';
    if (p.stream === false) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
    }
    if (sc === 'wolny') return strumien(res, `${DLUGI}KONIEC-ODPOWIEDZI`, 50);
    if (sc === 'dni') return strumien(res, PLAN_DNI);
    return strumien(res, 'Cześć z atrapy.');
  });
  return undefined;
});

// ---------------------------------------------------------------- pomiar
/** Co widzi człowiek: pasek, zablokowane Wyślij (przy tekście w polu), kropki stanu. */
const PROBKA = () => ({
  pasek: !document.getElementById('offline-bar').hidden,
  wyslijOff: document.getElementById('send-btn').disabled && document.getElementById('input').value.length > 0,
  kropkiErr: [...document.querySelectorAll('#status-cloud .status-dot.err')].length,
});
const pokaz = (page) => page.evaluate(() => { window.__widocznosc = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
const ukryj = (page) => page.evaluate(() => { window.__widocznosc = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
/** Próbki co 100 ms przez `ms`; zwraca je z czasem od startu. */
async function obserwuj(page, ms, wTrakcie) {
  const os = [];
  const start = Date.now();
  let zrobione = false;
  while (Date.now() - start < ms) {
    const s = await page.evaluate(PROBKA).catch(() => null);
    if (s) os.push({ t: Date.now() - start, ...s });
    if (wTrakcie && !zrobione && Date.now() - start >= wTrakcie.po) { zrobione = true; await wTrakcie.zrob(); }
    await spij(100);
  }
  return os;
}

(async () => {
  await zwolnijPorty([PORT, POSREDNIK, ATRAPA]);
  const gniazda = new Set();
  let bezSieci = false;
  const posrednik = net.createServer((we) => {
    if (bezSieci) { we.destroy(); return; }
    const wy = net.connect(PORT, '127.0.0.1');
    gniazda.add(we); gniazda.add(wy);
    we.pipe(wy); wy.pipe(we);
    const zamknij = () => { we.destroy(); wy.destroy(); gniazda.delete(we); gniazda.delete(wy); };
    we.on('error', zamknij); wy.on('error', zamknij); we.on('close', zamknij); wy.on('close', zamknij);
  });
  await new Promise((r) => posrednik.listen(POSREDNIK, '127.0.0.1', r));
  const odetnijSiec = (tak) => { bezSieci = tak; if (tak) for (const g of gniazda) g.destroy(); };
  await new Promise((r) => atrapa.listen(ATRAPA, '127.0.0.1', r));
  serwerCosmosa(PORT, {
    NVIDIA_API_KEY: 'test-nvidia', NEMOTRON_BASE_URL: `http://127.0.0.1:${ATRAPA}/v1`,
    NEMOTRON_MODEL: 'nvidia/nemotron-3-super-120b-a12b',
    IMAGE_SEARCH_URL: `http://127.0.0.1:${ATRAPA}/brak`, COMMONS_API_URL: `http://127.0.0.1:${ATRAPA}/brak`,
    OPENVERSE_API_URL: `http://127.0.0.1:${ATRAPA}/brak`, SEARCH_URL: `http://127.0.0.1:${ATRAPA}/brak`,
    SEARXNG_URL: `http://127.0.0.1:${ATRAPA}/brak`,
    COSMOS_BIEG_SIEROTA_MS: '1500',
  });
  if (!(await czekajNa(`http://127.0.0.1:${PORT}/api/config`))) { w.zapisz('serwer nie wstał'); atrapa.close(); posrednik.close(); return w.zakoncz(); }
  const ADRES = `http://127.0.0.1:${POSREDNIK}`;
  const b = await przegladarka();
  const bledy = [];
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block', locale: 'pl-PL' });
    await ctx.addInitScript(() => {
      window.COSMOS_PRZERWA_BIEGU_MS = 2500;
      window.__widocznosc = 'visible';
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__widocznosc });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__widocznosc === 'hidden' });
      try {
        if (!localStorage.getItem('cosmos.settings')) localStorage.setItem('cosmos.settings', JSON.stringify({ zespolPotwierdzaj: false }));
        localStorage.setItem('cosmos.lang', 'pl');
      } catch { /* */ }
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => bledy.push(e.message));
    const zadania = [];
    page.on('request', (r) => zadania.push({ t: Date.now(), u: r.url().replace(/^https?:\/\/[^/]+/, ''), m: r.method() }));
    const ileZadan = (od, wzor, metoda) => zadania.filter((z) => z.t >= od && wzor.test(z.u) && (!metoda || z.m === metoda)).length;
    await page.goto(`${ADRES}/app`, { waitUntil: 'load' });
    await page.waitForSelector('.app.gotowa', { timeout: 15000 }).catch(() => {});
    await spij(1200);
    const zrzut = async (nazwa) => {
      if (!process.env.ZRZUTY) return;
      for (const [szer, wys] of [[390, 800], [1440, 900]]) {
        await page.setViewportSize({ width: szer, height: wys });
        for (const motyw of ['light', 'dark']) {
          await page.emulateMedia({ colorScheme: motyw });
          await spij(250);
          await page.screenshot({ path: path.join(process.env.ZRZUTY, `wa-${nazwa}-${motyw}-${szer}.png`) });
        }
      }
      await page.setViewportSize({ width: 390, height: 800 });
      await page.emulateMedia({ colorScheme: 'light' });
    };

    // ---------------------------------------------------------------- A
    {
      await page.fill('#input', 'Dalej');
      // > 10 s od ostatniego sprawdzenia stanu – jak telefon, który leżał w kieszeni.
      await page.evaluate(() => { ostatnieSprawdzenie = 0; });
      await ukryj(page);
      odetnijSiec(true);
      await spij(1500);
      const powrot = Date.now();
      // Powrót: visibilitychange i zaległe tyknięcie co 30 s w tej samej chwili.
      await page.evaluate(() => {
        window.__widocznosc = 'visible';
        document.dispatchEvent(new Event('visibilitychange'));
        sprawdzStanCyklicznie();
      });
      const os = await obserwuj(page, 9000, { po: 2000, zrob: async () => odetnijSiec(false) });
      const pasek = os.filter((s) => s.pasek);
      const zablokowane = os.filter((s) => s.wyslijOff);
      const statusyNaPowrocie = ileZadan(powrot, /^\/api\/status/) && zadania.filter((z) => z.t >= powrot && z.t < powrot + 400 && /^\/api\/status/.test(z.u)).length;
      ok(!pasek.length && !zablokowane.length,
        `A1. krótkie tło, sieć po 2 s: bez paska „Brak połączenia” i bez blokady Wyślij (pasek ${pasek.length ? `od ${pasek[0].t} ms` : 'nie'}, blokada ${zablokowane.length} próbek)`);
      ok(statusyNaPowrocie <= 1, `A2. na powrocie jedno /api/status, nie dwa naraz (${statusyNaPowrocie})`);
      const koniecA = os[os.length - 1] || {};
      ok(!koniecA.kropkiErr, `A3. po powrocie sieci kropka chmury nie jest czerwona (${JSON.stringify(koniecA)})`);
    }

    // ---------------------------------------------------------------- B
    {
      await page.evaluate(() => { ostatnieSprawdzenie = 0; });
      await ukryj(page);
      odetnijSiec(true);
      await spij(800);
      await pokaz(page);
      const os = await obserwuj(page, 13000);
      const pierwszy = os.find((s) => s.pasek);
      ok(pierwszy && pierwszy.t >= 9000 && pierwszy.t <= 12500,
        `B1. sieć nie wraca: pasek dopiero po oknie łaski 10 s (${pierwszy ? `${pierwszy.t} ms` : 'nie pojawił się'})`);
      ok(pierwszy && os.some((s) => s.pasek && s.wyslijOff), 'B2. przy pasku Wyślij jest zablokowane (nowe wiadomości nie wyjdą)');
      odetnijSiec(false);
      const os2 = await obserwuj(page, 17000);
      const zgasl = os2.find((s) => !s.pasek);
      ok(Boolean(zgasl), `B3. sieć wraca bez zdarzenia 'online' – pasek gaśnie sam (${zgasl ? `po ${zgasl.t} ms` : 'nie zgasł w 17 s'})`);
    }

    // ---------------------------------------------------------------- C
    {
      await page.route('**/api/status', (r) => r.abort());
      for (let i = 0; i < 3; i++) { await page.evaluate(() => refreshStatus()); await spij(450); }
      const przed = await page.evaluate(PROBKA);
      await page.evaluate(() => loadConversations());
      await spij(200);
      const po = await page.evaluate(PROBKA);
      ok(przed.pasek && !po.pasek, `C1. udana odpowiedź serwera (lista rozmów) gasi pasek, choć /api/status pada (przed ${przed.pasek}, po ${po.pasek})`);
      await page.unroute('**/api/status');
      await page.evaluate(() => refreshStatus());
      await spij(500);
    }

    // ---------------------------------------------------------------- D
    const porzuc = async (pytanie) => {
      await page.evaluate(() => newConversation());
      await spij(200);
      await page.fill('#input', pytanie);
      await page.press('#input', 'Enter');
      await page.waitForFunction(() => (document.querySelector('#messages .msg.nowa .strumien-tresc') || {}).textContent?.length > 200, null, { timeout: 15000 }).catch(() => {});
      odetnijSiec(true);
      await page.waitForFunction(() => !isGenerating, null, { timeout: 30000 }).catch(() => {});
      return page.evaluate(() => {
        const karty = [...document.querySelectorAll('#messages .msg')];
        const ost = karty[karty.length - 1];
        return {
          id: activeConversation.id,
          blad: activeConversation.messages.filter((m) => m.error).map((m) => ({ porzucony: Boolean(m.porzucony), bieg: Boolean(m.bieg) })),
          przyciski: ost ? [...ost.querySelectorAll('.msg-bledu-akcje button')].filter((x) => !x.hidden).map((x) => x.textContent.trim()) : [],
        };
      });
    };
    const pelnaNaEkranie = () => page.evaluate(() => ({
      blad: activeConversation.messages.some((m) => m.error),
      koniec: activeConversation.messages.some((m) => m.role === 'assistant' && /KONIEC-ODPOWIEDZI/.test(String(m.content))),
      gen: isGenerating,
    }));
    {
      const stan = await porzuc('scena-wolny Opowiedz powoli o Sycylii.');
      ok(stan.blad.length === 1 && stan.blad[0].porzucony && stan.blad[0].bieg,
        `D1. karta błędu bez sieci jest „porzucona” i zna bieg (${JSON.stringify(stan.blad)})`);
      ok(stan.przyciski.includes('Pobierz odpowiedź') && !stan.przyciski.includes('Ponów'),
        `D2. na karcie „Pobierz odpowiedź”, nie płatne „Ponów” (${JSON.stringify(stan.przyciski)})`);
      await zrzut('pobierz-odpowiedz');
      await spij(9000);                     // serwer dokańcza (~7,5 s) i po 1,5 s zapisuje sam
      const od = Date.now();
      await ukryj(page);
      await pokaz(page);                    // powrót do karty – sieci jeszcze nie ma
      await spij(1500);
      odetnijSiec(false);                   // sieć wraca po cichu, bez 'online'
      await page.waitForFunction(() => !activeConversation.messages.some((m) => m.error) && !isGenerating
        && activeConversation.messages.some((m) => /KONIEC-ODPOWIEDZI/.test(String(m.content))), null, { timeout: 15000 }).catch(() => {});
      const po = await pelnaNaEkranie();
      ok(!po.blad && po.koniec, `D3. powrót przy martwej sieci ponawia się sam: pełna odpowiedź bez karty błędu (${JSON.stringify(po)}, ${Math.round((Date.now() - od) / 100) / 10} s)`);
      ok(ileZadan(od, /^\/api\/chat$/, 'POST') === 0, `D4. bez nowego zapytania do modelu (POST /api/chat: ${ileZadan(od, /^\/api\/chat$/, 'POST')})`);
    }
    {
      await porzuc('scena-wolny Opowiedz powoli o Etnie.');
      await spij(9000);
      odetnijSiec(false);                   // sieć wraca, ale nic o tym nie mówi
      const od = Date.now();
      await page.evaluate(() => { const p = document.querySelector('#messages .msg-pobierz'); if (p) p.click(); });
      await page.waitForFunction(() => !activeConversation.messages.some((m) => m.error)
        && activeConversation.messages.some((m) => /KONIEC-ODPOWIEDZI/.test(String(m.content))), null, { timeout: 8000 }).catch(() => {});
      const po = await pelnaNaEkranie();
      ok(!po.blad && po.koniec && ileZadan(od, /^\/api\/chat$/, 'POST') === 0,
        `D5. „Pobierz odpowiedź” bierze odpowiedź z serwera, bez pytania modelu (${JSON.stringify(po)}, POST ${ileZadan(od, /^\/api\/chat$/, 'POST')})`);
    }

    // ---------------------------------------------------------------- E
    {
      await page.evaluate(() => newConversation());
      await spij(200);
      await page.fill('#input', 'scena-wolny Opowiedz powoli o Noto.');
      await page.press('#input', 'Enter');
      await page.waitForFunction(() => (document.querySelector('#messages .msg.nowa .strumien-tresc') || {}).textContent?.length > 200, null, { timeout: 15000 }).catch(() => {});
      let blokada = true;
      await page.route('**/api/**', (r) => (blokada ? r.abort('internetdisconnected') : r.continue()));
      const od = Date.now();
      await page.reload({ waitUntil: 'load' });
      setTimeout(() => { blokada = false; }, 3000);
      await page.waitForFunction(() => typeof activeConversation !== 'undefined' && activeConversation && !isGenerating
        && activeConversation.messages.some((m) => /KONIEC-ODPOWIEDZI/.test(String(m.content))), null, { timeout: 20000 }).catch(() => {});
      const po = await page.evaluate(() => ({
        koniec: Boolean(activeConversation && activeConversation.messages.some((m) => /KONIEC-ODPOWIEDZI/.test(String(m.content)))),
        bieg: Boolean(localStorage.getItem('cosmos.bieg')),
      })).catch(() => ({}));
      ok(po.koniec && !po.bieg, `E1. przeładowanie przy martwym /api/* przez 3 s: odpowiedź wraca sama, bez zmiany okna (${JSON.stringify(po)}, ${Math.round((Date.now() - od) / 100) / 10} s)`);
      ok(ileZadan(od, /^\/api\/chat$/, 'POST') === 0, 'E2. bez nowego zapytania do modelu');
      await page.unroute('**/api/**');
    }

    // ---------------------------------------------------------------- F
    {
      await podstawMiniatury(page);
      await page.route('**/api/search/images?*', (r) => {
        const q = new URL(r.request().url()).searchParams.get('q') || '';
        const slug = encodeURIComponent(q.replace(/\s+/g, '-'));
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [0, 1, 2].map((i) => ({
          title: `${q} ${i}`, thumb: `/test-zdj/dobre-${slug}-${i}.png`, full: `/test-zdj/dobre-${slug}-${i}.png`, source: 'https://commons.wikimedia.org/', zrodlo: 'Wikimedia Commons',
        })) }) });
      });
      const turaF = async (pytanie) => {
        await page.evaluate(() => newConversation());
        await spij(200);
        await page.fill('#input', pytanie);
        await page.press('#input', 'Enter');
        await spij(800);
        await page.waitForFunction(() => !isGenerating, null, { timeout: 20000 }).catch(() => {});
        await spij(600);
        return page.evaluate(() => {
          const m = [...activeConversation.messages].reverse().find((x) => x.role === 'assistant');
          const body = [...document.querySelectorAll('#messages .msg-assistant .msg-content')].pop();
          const uklad = body ? [...body.children].map((e) => (e.classList.contains('zdj-pasek') ? 'PASEK' : e.tagName)).join(',') : '';
          return { q: m && Array.isArray(m.zdjecia) ? m.zdjecia.map((g) => g.q) : [], uklad };
        });
      };
      const z = await turaF('scena-dni Plan tygodnia na Sycylii ze zdjęciami kluczowych miejsc.');
      ok(JSON.stringify(z.q) === JSON.stringify(['Palermo', 'Cefalù', 'Taormina']),
        `F1. prośba o zdjęcia, plan bez znaczników: zdjęcia miejsc z nagłówków dni (${JSON.stringify(z.q)})`);
      ok(/H3,PASEK.*H3,PASEK.*H3,PASEK/.test(z.uklad), `F2. paski pod nagłówkami dni (${z.uklad})`);
      await zrzut('zdjecia-z-naglowkow');
      const bez = await turaF('scena-dni Plan tygodnia na Sycylii.');
      ok(!bez.q.length && !/PASEK/.test(bez.uklad), `F3. bez prośby o zdjęcia – żadnych zdjęć (${JSON.stringify(bez.q)})`);
    }

    // ---------------------------------------------------------------- G
    {
      const id = await page.evaluate(async () => {
        newConversation();
        const c = ensureConversation('Paski zdjęć');
        const f = (plik, tytul) => ({ thumb: `/test-zdj/${plik}.png`, full: `/test-zdj/${plik}.png`, title: tytul, source: 'https://commons.wikimedia.org/', zrodlo: 'Wikimedia Commons' });
        c.messages.push({ role: 'user', content: 'Plan ze zdjęciami' });
        c.messages.push({ role: 'assistant', content: '### Dzień 1 · Ortigia\nSpacer.\n\n### Dzień 2 · Noto\nBarok.\n\n### Dzień 3 · Etna\nKrater.', silnik: 'cloud', zdjecia: [
          { q: 'Ortigia', etykieta: 'Ortigia', stan: 'gotowe', po: 25, sekcja: 1, photos: [f('brak-1', 'a'), f('ikonka-1', 'logo'), f('baner-1', 'baner'), f('dobre-o1', 'o1'), f('dobre-o2', 'o2')] },
          { q: 'Noto', etykieta: 'Noto', stan: 'gotowe', po: 40, sekcja: 1, photos: [f('brak-2', 'b'), f('brak-3', 'c')] },
          { q: 'Etna', etykieta: 'Etna', stan: 'gotowe', po: 60, sekcja: 3, photos: [f('dobre-e1', 'e1')] },
          { q: 'Noto pusty', etykieta: 'Noto katedra', stan: 'gotowe', po: 45, sekcja: 2, photos: [f('brak-4', 'd'), f('ikonka-2', 'herb')] },
        ] });
        saveConversations(true, c);
        renderMessages();
        return c.id;
      });
      // Dalsze kafle czekają na przewinięcie toru – przewijamy jak palec, tam i z powrotem.
      await spij(800);
      await page.evaluate(() => { for (const t of document.querySelectorAll('#messages .zdj-tor')) t.scrollLeft = 99999; });
      await spij(1000);
      await page.evaluate(() => { for (const t of document.querySelectorAll('#messages .zdj-tor')) t.scrollLeft = 0; });
      await spij(1500);
      const g = await page.evaluate(() => {
        const paski = [...document.querySelectorAll('#messages .zdj-pasek')];
        const p0 = paski.find((p) => p.dataset.sekcja === '1');
        const kafle = p0 ? [...p0.querySelectorAll('a.zdj-kafel')] : [];
        const m = [...activeConversation.messages].reverse().find((x) => x.role === 'assistant');
        return {
          paski: paski.map((p) => p.dataset.sekcja),
          kafle: kafle.map((k) => k.querySelector('img')?.getAttribute('src') || '?'),
          pusteKafle: document.querySelectorAll('#messages .zdj-kafel.pusty, #messages .zdj-kafel:not(.szkielet):not(:has(img))').length,
          etykieta: kafle[0] ? { tekst: kafle[0].querySelector('.zdj-etykieta')?.textContent || '', start: kafle[0].hasAttribute('data-miejsce-start'), aria: kafle[0].getAttribute('aria-label') || '' } : null,
          etykiet: p0 ? p0.querySelectorAll('.zdj-etykieta').length : 0,
          opis: p0 ? p0.getAttribute('aria-label') : '',
          niewczytane: m.zdjecia.flatMap((gr) => gr.photos.filter((x) => x.niewczytane).map((x) => x.title)).sort(),
        };
      });
      ok(JSON.stringify(g.kafle) === JSON.stringify(['/test-zdj/dobre-o1.png', '/test-zdj/dobre-o2.png']) && !g.pusteKafle,
        `G1. niewczytany kafel, ikonka 48×48 i baner 5:1 znikają – zostają same zdjęcia (${JSON.stringify(g.kafle)}, puste ${g.pusteKafle})`);
      ok(g.etykieta && g.etykieta.tekst === 'Ortigia' && g.etykieta.start && /Ortigia/.test(g.etykieta.aria) && g.etykiet === 1,
        `G2. etykieta „Ortigia” przechodzi na pierwszy wczytany kafel (${JSON.stringify(g.etykieta)})`);
      ok(!/Noto/.test(g.opis || '') && /Ortigia/.test(g.opis || ''), `G3. miejsce bez żadnego zdjęcia znika z opisu paska („${g.opis}”)`);
      ok(JSON.stringify(g.paski) === JSON.stringify(['1', '3']), `G4. pasek bez wczytanych zdjęć (Noto katedra) znika cały (sekcje: ${JSON.stringify(g.paski)})`);
      ok(JSON.stringify(g.niewczytane) === JSON.stringify(['a', 'b', 'baner', 'c', 'd', 'herb', 'logo']), `G5. porażki zapamiętane w rozmowie (${JSON.stringify(g.niewczytane)})`);
      // Klawiatura: ←/→ chodzi po kaflach, które zostały.
      const nawig = await page.evaluate(() => {
        const p0 = document.querySelector('#messages .zdj-pasek[data-sekcja="1"]');
        const kafle = [...p0.querySelectorAll('a.zdj-kafel')];
        const klawisz = (k, key) => k.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        kafle[0].focus();
        klawisz(kafle[0], 'ArrowRight');
        const naDrugim = document.activeElement === kafle[1];
        klawisz(kafle[1], 'Home');
        const home = document.activeElement === kafle[0];
        klawisz(kafle[0], 'ArrowLeft');
        return { naDrugim, home, zostal: document.activeElement === kafle[0] };
      });
      ok(nawig.naDrugim && nawig.home && nawig.zostal, `G6. ←/→/Home chodzą tylko po kaflach, które zostały (${JSON.stringify(nawig)})`);
      // Przebudowa rozmowy i serwer: odrzucone nie wracają.
      const poPrzebudowie = await page.evaluate(() => {
        renderMessages();
        return { src: [...document.querySelectorAll('#messages .zdj-pasek a.zdj-kafel img')].map((i) => i.getAttribute('src')),
          paski: [...document.querySelectorAll('#messages .zdj-pasek')].map((p) => p.dataset.sekcja) };
      });
      ok(poPrzebudowie.src.every((s) => /dobre/.test(s)) && poPrzebudowie.src.length === 3 && JSON.stringify(poPrzebudowie.paski) === '["1","3"]',
        `G7. po przebudowie od razu same wczytane kafle, bez pustego paska (${JSON.stringify(poPrzebudowie)})`);
      await spij(2500);
      const zSerwera = await page.evaluate(async (cid) => {
        const c = await (await fetch(`/api/conversations?id=${encodeURIComponent(cid)}`)).json();
        const m = [...c.messages].reverse().find((x) => x.role === 'assistant');
        return (m.zdjecia || []).flatMap((gr) => gr.photos.filter((x) => x.niewczytane)).length;
      }, id);
      ok(zSerwera === 7, `G8. porażki zapisane na serwerze – po odświeżeniu i na drugim urządzeniu nie wracają (${zSerwera} z 7)`);
      await zrzut('paski-po-odsiewie');
    }

    ok(!bledy.length, `brak błędów JS (${bledy.slice(0, 3).join(' | ')})`);
  } catch (e) {
    w.zapisz(`wyjątek: ${e.stack || e.message}`);
  } finally {
    await b.close();
    atrapa.close();
    posrednik.close();
  }
  w.zakoncz();
})();

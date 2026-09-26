/* Wysyłka pliku do bazy wiedzy – telefon nie zamiera, plik dochodzi co do bajtu.

   Plik szedł dawniej jako base64 w JSON-ie: przeglądarka czytała go
   readAsDataURL, kopiowała napis, pakowała JSON.stringify – wszystko w wątku
   głównym. Zespół zmierzył na telefonie (CPU ×4): plik 20 MB = jedno zadanie
   2,3 s, 45 MB = 4,7 s martwej strony, bez żadnego postępu. Do tego przez
   tunel szło o jedną trzecią więcej danych, a serwer parsował 60 MB JSON-a.

   Co musi być prawdą:
     1. Surowe ciało dochodzi bajt w bajt, z polską nazwą z nagłówka i typem
        z Content-Type; stara droga (JSON + base64) dalej działa.
     2. Za duży plik dostaje 413 z wyjaśnieniem, zanim serwer go przeczyta.
     3. Aplikacja wysyła plik jako surowe ciało (nie JSON), z nazwą w nagłówku,
        a nie w adresie (adresy trafiają do dzienników Cloudflare'a).
     4. W trakcie wysyłki 20 MB na telefonie (CPU ×4) strona nie zamiera:
        najdłuższe zadanie wątku głównego < 300 ms (było 2,3 s).
     5. Człowiek widzi postęp („Wysyłam … %"), potem „Przetwarzam". */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { serwerCosmosa, czekajNa, zabij, przegladarka, maPrzegladarke } = require('../pomoc');

const PORT = 3495;
const ADRES = `http://127.0.0.1:${PORT}`;
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const skrot = (b) => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  const srv = serwerCosmosa(PORT, { EMBED_PROVIDER: 'off', SENSES_URL: 'http://127.0.0.1:9', COSMOS_KB_MAX_MB: '25' });
  if (!await czekajNa(ADRES)) { zabij(srv); throw new Error('serwer testowy nie wstał'); }

  // --- 1. surowe ciało bajt w bajt -----------------------------------------
  {
    const dane = crypto.randomBytes(3 * 1024 * 1024);
    const nazwa = 'Zdjęcia z Mazur – źródła ąę.bin';
    const r = await fetch(`${ADRES}/api/kb/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-Cosmos-Nazwa': encodeURIComponent(nazwa) },
      body: dane,
    });
    const d = await r.json();
    ok(r.status === 200 && d.item && d.item.name === nazwa, `surowe ciało: 200 z polską nazwą z nagłówka („${d.item && d.item.name}")`);
    const z = await fetch(`${ADRES}/api/kb/raw?id=${encodeURIComponent(d.item ? d.item.id : '')}`);
    const wrocilo = z.ok ? Buffer.from(await z.arrayBuffer()) : Buffer.alloc(0);
    ok(skrot(wrocilo) === skrot(dane), `plik wraca bajt w bajt (${wrocilo.length} B z ${dane.length} B)`);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNsaGj4DwAFhAJ/l3WBIQAAAABJRU5ErkJggg==', 'base64');
    const rp = await fetch(`${ADRES}/api/kb/file`, {
      method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Cosmos-Nazwa': encodeURIComponent('kadr.png') }, body: png,
    });
    const dp = await rp.json();
    const lista = (await (await fetch(`${ADRES}/api/kb`)).json()).items || [];
    const wpis = lista.find((x) => x.id === (dp.item && dp.item.id));
    ok(rp.status === 200 && wpis && wpis.mime === 'image/png', `typ pliku z Content-Type (${wpis && wpis.mime})`);

    const rj = await fetch(`${ADRES}/api/kb/file`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'stary-klient.txt', mime: 'text/plain', data: Buffer.from('Stara droga działa').toString('base64') }),
    });
    ok(rj.status === 200, `stara droga (JSON + base64) dalej działa (${rj.status})`);
  }

  // --- 2. za duży plik: 413 z wyjaśnieniem ----------------------------------
  {
    const r = await fetch(`${ADRES}/api/kb/file`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Cosmos-Nazwa': 'wielki.bin' },
      body: Buffer.alloc(26 * 1024 * 1024, 1),
    }).catch((e) => ({ status: 0, json: async () => ({ error: e.message }) }));
    const d = await r.json().catch(() => ({}));
    ok(r.status === 413 && /za duży/.test(d.error || ''), `plik ponad limit: 413 z wyjaśnieniem (${r.status}: ${d.error})`);
  }

  // --- 3–5. przeglądarka na telefonie -----------------------------------------
  if (!maPrzegladarke()) {
    console.log('⚠ Brak Chromium – pomijam część z przeglądarką.');
  } else {
    const b = await przegladarka();
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const wysylki = [];
    p.on('request', (r) => {
      if (r.url().includes('/api/kb/file') && r.method() === 'POST') {
        wysylki.push({ adres: r.url(), typ: r.headers()['content-type'] || '', nazwa: r.headers()['x-cosmos-nazwa'] || '' });
      }
    });
    await p.goto(`${ADRES}/app`, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof kbUploadFiles === 'function');
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p.evaluate(() => {
      window.__zadania = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__zadania.push(e.duration); })
        .observe({ type: 'longtask', buffered: false });
      window.__statusy = [];
      const org = kbSetStatus;
      window.kbSetStatus = (x) => { if (x) window.__statusy.push(x); org(x); };
    });
    /* Plik z DYSKU, nie z bufora: bufor Playwright wstrzykuje do strony
       przez JavaScript (base64 w wątku strony) – przy CPU ×4 to 25 s zadania,
       które zmierzylibyśmy zamiast aplikacji. Ścieżkę ustawia protokół. */
    const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-wysylka-'));
    // Nazwa ASCII: polskie znaki w NAZWIE NA DYSKU potrafią nie przejść przez
    // setInputFiles (ustawienia regionalne systemu); polską nazwę w nagłówku
    // sprawdza punkt 1.
    const plik = path.join(katalog, 'Nagranie-z-proby.bin');
    fs.writeFileSync(plik, crypto.randomBytes(20 * 1024 * 1024));
    await p.setInputFiles('#kb-file-input', plik);
    await p.waitForFunction(() => (window.__statusy || []).length && !document.getElementById('kb-status').textContent, null, { timeout: 60000 })
      .catch(() => {});
    await p.waitForTimeout(300);
    const { zadania, statusy } = await p.evaluate(() => ({ zadania: window.__zadania, statusy: window.__statusy }));
    const w = wysylki[0] || {};
    ok(wysylki.length === 1 && !/json/.test(w.typ), `aplikacja wysyła surowy plik, nie JSON (Content-Type: ${w.typ || 'brak'})`);
    ok(/Nagranie/.test(decodeURIComponent(w.nazwa || '')) && !/Nagranie/.test(decodeURIComponent(w.adres || '')),
      'nazwa pliku jedzie w nagłówku, nie w adresie');
    const najdluzsze = Math.round(Math.max(0, ...zadania));
    ok(najdluzsze < 300, `wysyłka 20 MB na telefonie (CPU ×4): najdłuższe zadanie ${najdluzsze} ms (było 2300 ms)`);
    ok(statusy.some((x) => /%/.test(x)), `człowiek widzi postęp wysyłki (${statusy.slice(0, 2).join(' | ')})`);
    const lista = (await (await fetch(`${ADRES}/api/kb`)).json()).items || [];
    ok(lista.some((x) => x.name === 'Nagranie-z-proby.bin' && x.size === 20 * 1024 * 1024), 'plik z aplikacji jest w bazie wiedzy w całości');
    await b.close();
    fs.rmSync(katalog, { recursive: true, force: true });
  }

  zabij(srv);
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nWYSYŁKA DO BAZY OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

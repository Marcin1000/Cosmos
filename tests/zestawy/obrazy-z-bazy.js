/* Obrazy z bazy wiedzy idą do modelu w mniejszej wersji, nie w oryginale.

   Zdjęcie z aparatu (kilkanaście MB) zaznaczone w bazie wiedzy szło do modelu
   w całości, w KAŻDEJ wiadomości: ~20 MB base64 na żądanie, płatny przesył,
   a u Claude'a ponad limit 5 MB na obraz — żądanie odrzucone. Serwer nie ma
   dekodera obrazów, więc podgląd (≤1568 px, JPEG) robi przeglądarka.

   Co musi być prawdą:
     1. Duże zdjęcie wgrane przez aplikację dostaje podgląd: ≤1568 px
        i najwyżej 3,5 MB; oryginał zostaje bajt w bajt.
     2. Model dostaje podgląd, nie oryginał — całe żądanie do modelu jest
        wielokrotnie mniejsze od samego zdjęcia.
     3. Stara pozycja bez podglądu: za duża nie idzie do modelu (model dostaje
        zdanie, że jest za duża), a zaznaczenie jej w bazie wiedzy dorabia
        podgląd — i następna wiadomość już go niesie.
     4. Mały obraz podglądu nie potrzebuje i idzie w oryginale.
     5. Usunięcie pozycji usuwa też podgląd z dysku.
     6. Mały obraz w formacie, którego dostawcy nie przyjmują (BMP), też dostaje
        podgląd JPEG — a bez podglądu nie idzie do modelu w oryginale (każda
        wiadomość padała odmową 400), tylko model dostaje zdanie o formacie. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { serwerCosmosa, czekajNa, zabij, przegladarka, maPrzegladarke, katalogOsoby } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

const PORT = 3498;
const PORT_MODELU = 3499;
const ADRES = `http://127.0.0.1:${PORT}`;
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

// --- atrapa modelu: zapamiętuje obrazy i instrukcje ------------------------
const zapytania = [];
const atrapa = http.createServer((req, res) => {
  const kawalki = [];
  req.on('data', (c) => kawalki.push(c));
  req.on('end', () => {
    const cialo = Buffer.concat(kawalki);
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"data":[]}'); }
    let d = {};
    try { d = JSON.parse(cialo.toString()); } catch { /* */ }
    const obrazy = [];
    for (const m of d.messages || []) {
      if (Array.isArray(m.content)) for (const p of m.content) if (p.type === 'image_url') obrazy.push(p.image_url.url);
    }
    zapytania.push({ bajty: cialo.length, obrazy, systemowe: (d.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n') });
    if (d.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'widzę' } }] })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'widzę' } }] }));
  });
});

/** Najprostszy poprawny BMP (24 bity, bez kompresji) — Node nie ma kodera obrazów. */
function bmp(w, h) {
  const wiersz = Math.ceil((w * 3) / 4) * 4;
  const b = Buffer.alloc(54 + wiersz * h);
  b.write('BM', 0); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(w, 18); b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(wiersz * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = 54 + y * wiersz + x * 3; b[o] = 40; b[o + 1] = 120; b[o + 2] = 200; }
  return b;
}

/** Wymiary JPEG-a z nagłówka SOF — bez dekodera. */
function wymiaryJpeg(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const znak = buf[i + 1];
    const dl = buf.readUInt16BE(i + 2);
    if (znak >= 0xc0 && znak <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + dl;
  }
  return null;
}

async function zapytajModel(kbSelected) {
  zapytania.length = 0;
  const r = await fetch(`${ADRES}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', kbSelected, useKb: false, useMemory: false, useSenses: false,
      messages: [{ role: 'user', content: 'Co jest na tym zdjęciu?' }] }),
  });
  await r.text();
  return zapytania.find((z) => z.obrazy.length) || zapytania[0] || { bajty: 0, obrazy: [], systemowe: '' };
}

(async () => {
  await new Promise((r) => atrapa.listen(PORT_MODELU, r));
  const srv = serwerCosmosa(PORT, {
    EMBED_PROVIDER: 'off', SENSES_URL: 'http://127.0.0.1:9',
    NEMOTRON_BASE_URL: `http://127.0.0.1:${PORT_MODELU}/v1`,
    NEMOTRON_MODEL: 'atrapa-wzrok', NEMOTRON_VISION_MODEL: 'atrapa-wzrok',
  });
  if (!await czekajNa(ADRES)) { zabij(srv); throw new Error('serwer testowy nie wstał'); }
  const pliki = path.join(katalogOsoby({ katalogDanych: srv.katalogDanych }), 'kb', 'files');

  const b = await przegladarka();
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const bledy = [];
  p.on('pageerror', (e) => bledy.push(e.message));
  await p.goto(`${ADRES}/app`, { waitUntil: 'load' });
  await p.waitForFunction(() => typeof kbUploadFiles === 'function');

  /* Duże „zdjęcie z aparatu": 4000×3000, szum (JPEG się nie skompresuje),
     jakość 0.95 — robi je przeglądarka, bo Node nie ma kodera JPEG. */
  const zrobZdjecie = (nazwa, w, h) => p.evaluate(async ({ nazwa, w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const obraz = g.createImageData(w, h);
    for (let i = 0; i < obraz.data.length; i += 4) {
      obraz.data[i] = Math.random() * 255; obraz.data[i + 1] = Math.random() * 255;
      obraz.data[i + 2] = Math.random() * 255; obraz.data[i + 3] = 255;
    }
    g.putImageData(obraz, 0, 0);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.95));
    window.__zdjecia = window.__zdjecia || {};
    window.__zdjecia[nazwa] = new File([blob], nazwa, { type: 'image/jpeg' });
    return blob.size;
  }, { nazwa, w, h });
  const lista = async () => (await (await fetch(`${ADRES}/api/kb`)).json()).items || [];

  // --- 1. duże zdjęcie przez aplikację ---------------------------------------
  const rozmiar = await zrobZdjecie('mazury.jpg', 4000, 3000);
  await p.evaluate(() => kbUploadFiles([window.__zdjecia['mazury.jpg']]));
  const duze = (await lista()).find((x) => x.name === 'mazury.jpg');
  ok(duze && duze.podglad, `duże zdjęcie (${(rozmiar / 1048576).toFixed(1)} MB) dostało podgląd`);
  const plikPodgladu = duze ? path.join(pliki, `${duze.id}.podglad`) : '';
  const podglad = plikPodgladu && fs.existsSync(plikPodgladu) ? fs.readFileSync(plikPodgladu) : Buffer.alloc(0);
  const wym = wymiaryJpeg(podglad) || { w: 0, h: 0 };
  ok(podglad.length > 0 && podglad.length <= 3.5 * 1048576 && Math.max(wym.w, wym.h) <= 1568,
    `podgląd ≤1568 px i ≤3,5 MB (${wym.w}×${wym.h}, ${(podglad.length / 1048576).toFixed(2)} MB)`);
  const oryginal = duze ? fs.statSync(path.join(pliki, duze.id)).size : 0;
  ok(oryginal === rozmiar, `oryginał zostaje nietknięty (${oryginal} B)`);

  // --- 2. model dostaje podgląd ------------------------------------------------
  const z1 = await zapytajModel([duze && duze.id]);
  const wyslany = z1.obrazy[0] ? Buffer.from(z1.obrazy[0].split(',').pop(), 'base64') : Buffer.alloc(0);
  ok(wyslany.length === podglad.length && wyslany.equals(podglad), `model dostał podgląd, nie oryginał (${wyslany.length} B)`);
  ok(z1.bajty < rozmiar / 2, `żądanie do modelu ${(z1.bajty / 1048576).toFixed(2)} MB przy zdjęciu ${(rozmiar / 1048576).toFixed(1)} MB`);

  // --- 3. stara pozycja bez podglądu ---------------------------------------------
  await zrobZdjecie('stare.jpg', 4000, 3000);
  const stareId = await p.evaluate(async () => {
    const r = await fetch('/api/kb/file', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-Cosmos-Nazwa': 'stare.jpg' }, body: window.__zdjecia['stare.jpg'] });
    return (await r.json()).item.id;
  });
  const z2 = await zapytajModel([stareId]);
  ok(z2.obrazy.length === 0 && /za duże/.test(z2.systemowe), 'za duży obraz bez podglądu nie idzie do modelu, model wie dlaczego');
  // zaznaczenie w panelu bazy wiedzy dorabia podgląd
  await p.evaluate(() => { document.getElementById('kb-btn').click(); });
  await p.waitForSelector('.kb-item input[type="checkbox"]');
  await p.evaluate((id) => {
    const wiersz = [...document.querySelectorAll('.kb-item')].find((w) => w.textContent.includes('stare.jpg'));
    const box = wiersz.querySelector('input[type="checkbox"]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    void id;
  }, stareId);
  let dorobiony = false;
  for (let i = 0; i < 40 && !dorobiony; i++) {
    await new Promise((r) => setTimeout(r, 250));
    dorobiony = Boolean((await lista()).find((x) => x.id === stareId && x.podglad));
  }
  ok(dorobiony, 'zaznaczenie starej pozycji dorabia podgląd');
  const z3 = await zapytajModel([stareId]);
  ok(z3.obrazy.length === 1 && z3.bajty < 4 * 1048576, `potem model dostaje obraz (${(z3.bajty / 1048576).toFixed(2)} MB żądania)`);

  // --- 4. mały obraz bez podglądu -------------------------------------------------
  await zrobZdjecie('maly.jpg', 400, 300);
  await p.evaluate(() => kbUploadFiles([window.__zdjecia['maly.jpg']]));
  const maly = (await lista()).find((x) => x.name === 'maly.jpg');
  const z4 = await zapytajModel([maly && maly.id]);
  ok(maly && !maly.podglad && z4.obrazy.length === 1, 'mały obraz idzie w oryginale, bez podglądu');
  // Galeria na telefonie pobierała przy każdym otwarciu wszystko od nowa (89 MB) — plik o danym id się nie zmienia.
  const surowy = await fetch(`${ADRES}/api/kb/raw?id=${encodeURIComponent(maly ? maly.id : '')}`);
  ok(/immutable/.test(surowy.headers.get('cache-control') || '') && /private/.test(surowy.headers.get('cache-control') || '')
    && Number(surowy.headers.get('content-length')) > 0, `plik z bazy ma pamięć podręczną i długość (${surowy.headers.get('cache-control')})`);

  // --- 6. mały BMP ---------------------------------------------------------------------
  await p.evaluate((b64) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    window.__bmp = new File([u], 'plan.bmp', { type: 'image/bmp' });
  }, bmp(64, 48).toString('base64'));
  await p.evaluate(() => kbUploadFiles([window.__bmp]));
  const plan = (await lista()).find((x) => x.name === 'plan.bmp');
  const z6 = await zapytajModel([plan && plan.id]);
  ok(plan && plan.podglad && z6.obrazy.length === 1 && /^data:image\/jpeg/.test(z6.obrazy[0]),
    `mały BMP dostaje podgląd i model dostaje JPEG (${z6.obrazy[0] ? z6.obrazy[0].slice(0, 22) : 'brak obrazu'})`);
  const staryBmp = await (await fetch(`${ADRES}/api/kb/file`, { method: 'POST', headers: { 'Content-Type': 'image/bmp', 'X-Cosmos-Nazwa': 'szkic.bmp' }, body: bmp(32, 32) })).json();
  const z7 = await zapytajModel([staryBmp.item && staryBmp.item.id]);
  ok(z7.obrazy.length === 0 && /szkic\.bmp/.test(z7.systemowe) && /JPEG albo PNG/.test(z7.systemowe),
    'BMP bez podglądu nie idzie do modelu w oryginale — model wie, że to kwestia formatu');

  // --- 5. usunięcie sprząta podgląd ------------------------------------------------
  await fetch(`${ADRES}/api/kb?id=${encodeURIComponent(duze ? duze.id : '')}`, { method: 'DELETE' });
  ok(plikPodgladu && !fs.existsSync(plikPodgladu), 'usunięcie pozycji usuwa podgląd z dysku');
  ok(bledy.length === 0, `bez błędów JavaScript (${bledy.slice(0, 2).join(' | ') || 'brak'})`);

  await b.close();
  zabij(srv);
  atrapa.close();
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nOBRAZY Z BAZY OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

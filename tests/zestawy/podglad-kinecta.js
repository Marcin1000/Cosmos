const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Podgląd z Kinecta w panelu na żywo: przełączanie źródła, klatki, sprzątanie
const SHOT = require('../pomoc').KATALOG_ZRZUTOW;

(async () => {
  const env = await srodowisko('zmysly');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const fail = [];
  // MJPEG: jedno połączenie na strumień. Liczymy połączenia, nie klatki –
  // ich przybywanie sprawdzamy po zmianie treści obrazu.
  const frameReqs = [];
  const streamReqs = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/kinect/frame')) frameReqs.push(r.url());
    if (r.url().includes('/api/kinect/stream')) streamReqs.push(r.url());
  });
  const snapshot = () => page.evaluate(() => {
    const img = document.getElementById('live-image');
    if (!img.naturalWidth) return '';
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL().slice(-120);
  });

  await page.goto(`${ADRES}/app`, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // wybierz Kinecta jako źródło i otwórz panel
  await page.evaluate(() => { localStorage.setItem('cosmos.liveSource', 'kinect-color'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.click('#live-btn').catch(async () => {
    await page.evaluate(() => startLive());
  });
  await page.waitForTimeout(1500);

  let s = await page.evaluate(() => {
    const img = document.getElementById('live-image');
    const vid = document.getElementById('live-video');
    return {
      panel: document.getElementById('live-panel').style.display !== 'none',
      imgVisible: !img.hidden, vidVisible: !vid.hidden,
      imgW: img.naturalWidth, imgH: img.naturalHeight,
      src: (img.getAttribute('src') || '').split('?')[1] || '',
      select: document.getElementById('live-source').value,
    };
  });
  console.log(`1. panel otwarty=${s.panel}, <img> widoczny=${s.imgVisible}, <video> ukryty=${!s.vidVisible}`);
  console.log(`   klatka: ${s.imgW}×${s.imgH}, zapytanie: ${s.src}`);
  if (!s.panel) fail.push('panel się nie otworzył');
  if (!s.imgVisible || s.vidVisible) fail.push('zły element pokazany dla Kinecta');
  if (!s.imgW) fail.push('klatka nie wczytana');
  if (!/stream=color/.test(s.src)) fail.push('zły strumień w zapytaniu');
  if (s.select !== 'kinect-color') fail.push('lista nie odzwierciedla źródła');
  await page.screenshot({ path: `${SHOT}/kinect-live.png` });

  // Odświeżanie: obraz ma się zmieniać, a połączeń ma NIE przybywać –
  // na tym polega przewaga MJPEG nad odpytywaniem klatka po klatce.
  const pixA = await snapshot();
  const conn = streamReqs.length;
  await page.waitForTimeout(1500);
  const pixB = await snapshot();
  console.log(`2. odświeżanie: połączeń ${conn} → ${streamReqs.length}, `
    + `zapytań o pojedynczą klatkę ${frameReqs.length}, obraz zmieniony=${pixA !== pixB}`);
  if (pixA === pixB) fail.push('klatki się nie odświeżają');
  if (streamReqs.length > conn) fail.push('MJPEG zrywa i wznawia połączenie');
  if (frameReqs.length > 1) fail.push('wciąż odpytywanie klatka po klatce');

  // przełącz na głębię
  await page.selectOption('#live-source', 'kinect-depth');
  await page.waitForTimeout(1200);
  s = await page.evaluate(() => ({
    src: (document.getElementById('live-image').getAttribute('src') || '').split('?')[1] || '',
    w: document.getElementById('live-image').naturalWidth,
  }));
  console.log(`3. po przełączeniu na głębię: ${s.src}, klatka ${s.w}px`);
  if (!/stream=depth/.test(s.src)) fail.push('przełączenie na głębię nie zmieniło strumienia');

  // zamknięcie panelu musi zatrzymać odpytywanie
  await page.evaluate(() => stopLive());
  const n1 = frameReqs.length + streamReqs.length;
  const src1 = await page.evaluate(() => document.getElementById('live-image').getAttribute('src') || '');
  await page.waitForTimeout(1200);
  const n2 = frameReqs.length + streamReqs.length;
  console.log(`4. po zamknięciu: ${n1} → ${n2} zapytań, src wyczyszczony=${!src1}`);
  if (n2 > n1) fail.push('odpytywanie trwa po zamknięciu panelu');
  if (src1) fail.push('src obrazka nie wyczyszczony – MJPEG zostaje otwarty w tle');

  /* 5. Czujnik zajęty (zgłoszenie Marcina: czarny kadr, ikona zepsutego
     obrazka i „czy działa senses/service.py?”). Agent nie przepuszcza
     strumienia (501), klatka odpowiada 503 z przyczyną – przyczyna ma stanąć
     pod kadrem, a ikona zepsutego obrazka zniknąć. */
  let zajety = true;
  await page.route('**/api/kinect/stream?*', (r) => r.fulfill({ status: 501, contentType: 'application/json', body: '{"error":"bez strumienia","kod":"bez-strumienia"}' }));
  await page.route('**/api/kinect/frame?*', (r) => (zajety
    ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Kinect niedostępny: urządzenie w użyciu' }) })
    : r.continue()));
  await page.evaluate(() => startLive());
  await page.waitForFunction(() => /urządzenie w użyciu/.test(document.getElementById('live-panel').textContent), null, { timeout: 8000 }).catch(() => {});
  s = await page.evaluate(() => ({
    tekst: document.getElementById('live-status').textContent,
    widocznosc: document.getElementById('live-image').style.visibility,
  }));
  const przyczyna = /urządzenie w użyciu/.test(s.tekst);
  console.log(`5. czujnik zajęty: przyczyna pod kadrem=${przyczyna}, obrazek ukryty=${s.widocznosc === 'hidden'}, stary tekst o service.py=${/service\.py/.test(s.tekst)}`);
  if (!przyczyna) fail.push('przyczyna z usługi zmysłów nie stanęła pod kadrem');
  if (s.widocznosc !== 'hidden') fail.push('ikona zepsutego obrazka zostaje przy błędzie');
  if (/service\.py/.test(s.tekst)) fail.push('komunikat odsyła do senses/service.py');

  // 6. Czujnik się zwolnił – klatki wracają same, przyczyna znika.
  zajety = false;
  await page.waitForFunction(() => {
    const img = document.getElementById('live-image');
    return img.naturalWidth > 0 && img.style.visibility !== 'hidden'
      && !/urządzenie w użyciu/.test(document.getElementById('live-panel').textContent);
  }, null, { timeout: 8000 }).then(() => true).catch(() => false).then((wrocily) => {
    console.log(`6. czujnik wolny: klatki wróciły i komunikat zniknął=${wrocily}`);
    if (!wrocily) fail.push('po zwolnieniu czujnika klatki nie wróciły albo komunikat został');
  });
  await page.evaluate(() => stopLive());
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  /* 7. Komputer bez kamery (Kinect to nie kamera dla przeglądarki):
     zamiast „Requested device not found” zdanie, że Kinect jest na liście. */
  await page.evaluate(() => {
    localStorage.setItem('cosmos.liveSource', 'camera');
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Requested device not found', 'NotFoundError'); };
  });
  await page.evaluate(() => { document.getElementById('live-source').value = 'camera'; document.getElementById('live-source').dispatchEvent(new Event('change')); });
  await page.evaluate(() => startLive());
  await page.waitForTimeout(800);
  const bezKamery = await page.evaluate(() => document.getElementById('live-status').textContent);
  const dobrze7 = /Kinect/.test(bezKamery) && !/Requested device not found/.test(bezKamery);
  console.log(`7. brak kamery w przeglądarce: podpowiedź o Kinekcie=${dobrze7} („${bezKamery}”)`);
  if (!dobrze7) fail.push('brak kamery: surowe „Requested device not found” zamiast podpowiedzi o Kinekcie');

  /* 8. Klatki przez agenta nie idą gęsiego (Marcin: „strasznie poklatkowo”).
     Agent nie przepuszcza strumienia, każda klatka odpowiada po 300 ms – jak
     obieg telefon → serwer → komputer z Kinectem. Klatki mają lecieć po kilka
     naraz i bez stałej przerwy po każdej: 3 s to co najmniej 12 klatek
     (jedna naraz z przerwą 120 ms dawała ~7). */
  await page.evaluate(() => { stopLive(); const w = document.getElementById('live-source'); w.value = 'kinect-color'; w.dispatchEvent(new Event('change')); });
  let wLocie = 0, najwiecej = 0, klatek = 0;
  await page.route('**/api/kinect/stream?*', (r) => r.fulfill({ status: 501, contentType: 'application/json', body: '{"kod":"bez-strumienia"}' }));
  await page.route('**/api/kinect/frame?*', async (r) => {
    wLocie++; najwiecej = Math.max(najwiecej, wLocie);
    try {
      const odp = await r.fetch();
      const cialo = await odp.body();
      await new Promise((k) => setTimeout(k, 300));
      klatek++;
      await r.fulfill({ status: 200, contentType: odp.headers()['content-type'], body: cialo });
    } catch { /* trasa zdjęta w trakcie – koniec punktu */ } finally { wLocie--; }
  });
  await page.evaluate(() => startLive());
  await page.waitForTimeout(700);   // rozbieg: 501 ze strumienia i pierwsze klatki
  const przed8 = klatek;
  await page.waitForTimeout(3000);
  const w3s = klatek - przed8;
  console.log(`8. klatki przez agenta: ${w3s} w 3 s, najwięcej naraz ${najwiecej}`);
  if (najwiecej < 2) fail.push('klatki przez agenta idą jedna po drugiej');
  if (w3s < 12) fail.push(`podgląd przez agenta poklatkowy: ${w3s} klatek w 3 s`);
  await page.evaluate(() => stopLive());
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  /* 9. Rozpoznawanie da się wyłączyć: ramki znikają od razu, do zmysłów nie
     idzie już żadna klatka, a wybór przeżywa przeładowanie. */
  const detekcje = [];
  page.on('request', (r) => { if (r.url().includes('/api/detect')) detekcje.push(Date.now()); });
  const ramki = () => page.evaluate(() => {
    const c = document.getElementById('live-overlay');
    if (!c.width) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n;
  });
  await page.evaluate(() => startLive());
  await page.waitForFunction(() => {
    const c = document.getElementById('live-overlay');
    return c.width && c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v);
  }, null, { timeout: 8000 }).catch(() => {});
  const zRamkami = await ramki();
  const przycisk = await page.$('#live-rozpoznawanie');
  const wlaczonyNaStart = przycisk && await przycisk.getAttribute('aria-pressed');
  if (przycisk) await przycisk.click();
  const poWylaczeniu = await ramki();
  const status9 = await page.evaluate(() => document.getElementById('live-status').textContent);
  const detPrzed = detekcje.length;
  await page.waitForTimeout(4000);
  const detPo = detekcje.length - detPrzed;
  const poCzasie = await ramki();
  console.log(`9. rozpoznawanie: ramki ${zRamkami} px → po wyłączeniu ${poWylaczeniu} px (po 4 s ${poCzasie}), zapytań do zmysłów przez 4 s: ${detPo}, przycisk na starcie aria-pressed=${wlaczonyNaStart}`);
  if (!przycisk) fail.push('brak przełącznika rozpoznawania');
  if (!zRamkami) fail.push('rozpoznawanie włączone, a ramek nie ma');
  if (poWylaczeniu || poCzasie) fail.push('ramki zostają po wyłączeniu rozpoznawania');
  if (detPo) fail.push('wyłączone rozpoznawanie dalej wysyła klatki do zmysłów');
  if (/person/.test(status9)) fail.push('opis rozpoznanych rzeczy zostaje po wyłączeniu');
  await page.evaluate(() => stopLive());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  const poPrzeladowaniu = await page.$eval('#live-rozpoznawanie', (b) => b.getAttribute('aria-pressed')).catch(() => null);
  console.log(`   po przeładowaniu aria-pressed=${poPrzeladowaniu}`);
  if (poPrzeladowaniu !== 'false') fail.push('wybór rozpoznawania nie przeżywa przeładowania');

  console.log(fail.length ? '\nPROBLEMY: ' + fail.join('; ') : '\nPODGLĄD Z KINECTA OK');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

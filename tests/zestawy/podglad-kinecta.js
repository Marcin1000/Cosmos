const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Podgląd z Kinecta w panelu na żywo: przełączanie źródła, klatki, sprzątanie
const SHOT = process.env.SHOT_DIR;

(async () => {
  const env = await srodowisko('zmysly');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const fail = [];
  // MJPEG: jedno połączenie na strumień. Liczymy połączenia, nie klatki —
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

  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // wybierz Kinecta jako źródło i otwórz panel
  await page.evaluate(() => { localStorage.setItem('cosmos.liveSource', 'kinect-color'); });
  await page.reload({ waitUntil: 'networkidle' });
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

  // Odświeżanie: obraz ma się zmieniać, a połączeń ma NIE przybywać —
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
  if (src1) fail.push('src obrazka nie wyczyszczony — MJPEG zostaje otwarty w tle');

  console.log(fail.length ? '\nPROBLEMY: ' + fail.join('; ') : '\nPODGLĄD Z KINECTA OK');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

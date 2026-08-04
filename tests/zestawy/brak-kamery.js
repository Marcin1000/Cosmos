const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Zachowanie bez navigator.mediaDevices — dokładnie jak po zwykłym HTTP na adres IP
const SHOT = process.env.SHOT_DIR;

(async () => {
  const env = await srodowisko('zmysly');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const fail = [];
  let alerted = null;
  page.on('dialog', async (d) => { alerted = d.message(); await d.dismiss(); });

  // usuń API zanim strona się załaduje
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { get: () => undefined, configurable: true });
    localStorage.setItem('cosmos.liveSource', 'camera');
  });
  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  await page.click('#live-btn');
  await page.waitForTimeout(800);

  const s = await page.evaluate(() => ({
    panelOpen: document.getElementById('live-panel').style.display !== 'none',
    status: document.getElementById('live-status').textContent,
    selectorVisible: Boolean(document.getElementById('live-source').offsetParent),
  }));
  console.log(`1. panel otwarty mimo braku kamery: ${s.panelOpen}`);
  console.log(`2. lista źródeł dostępna: ${s.selectorVisible}`);
  console.log(`3. komunikat: ${s.status.slice(0, 110)}`);
  console.log(`4. okienko alert: ${alerted ? 'BYŁO — ' + alerted.slice(0, 60) : 'brak (dobrze)'}`);
  if (!s.panelOpen) fail.push('panel się nie otworzył — nie da się wybrać Kinecta');
  if (!s.selectorVisible) fail.push('lista źródeł niedostępna');
  if (!/HTTPS|localhost|Kinect/.test(s.status)) fail.push('komunikat nie wskazuje wyjścia');
  if (alerted) fail.push('nadal wyskakuje alert zamiast komunikatu w panelu');

  // przełączenie na Kinect musi zadziałać mimo braku kamery
  await page.selectOption('#live-source', 'kinect-color');
  await page.waitForTimeout(1200);
  const k = await page.evaluate(() => ({
    img: !document.getElementById('live-image').hidden,
    w: document.getElementById('live-image').naturalWidth,
  }));
  console.log(`5. po wyborze Kinecta: <img> widoczny=${k.img}, klatka ${k.w}px`);
  if (!k.img || !k.w) fail.push('Kinect nie ruszył mimo braku kamery przeglądarki');

  await page.screenshot({ path: `${SHOT}/insecure.png` });
  console.log(fail.length ? '\nPROBLEMY: ' + fail.join('; ') : '\nBRAK KAMERY OBSŁUŻONY POPRAWNIE');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

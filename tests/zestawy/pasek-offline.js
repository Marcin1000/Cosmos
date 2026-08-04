const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Pasek „brak połączenia": pojawia się po zerwaniu, znika po powrocie serwera
const SHOT = process.env.SHOT_DIR;

const state = (page) => page.evaluate(() => ({
  bar: !document.getElementById('offline-bar').hidden,
  send: document.getElementById('send-btn').disabled,
  text: document.getElementById('offline-bar').innerText.replace(/\s+/g, ' ').trim().slice(0, 70),
}));

(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });
  const fail = [];

  // 1. serwer działa — paska nie ma
  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  let s = await state(page);
  console.log('serwer działa    :', JSON.stringify(s));
  if (s.bar) fail.push('pasek widoczny mimo działającego serwera');

  // 2. wpisz tekst — przycisk wysyłania ma być aktywny
  await page.fill('#input', 'test');
  s = await state(page);
  if (s.send) fail.push('wysyłanie zablokowane przy działającym serwerze');

  // 3. zerwij połączenie z API i wymuś odświeżenie statusu
  await page.route('**/api/**', (r) => r.abort());
  await page.evaluate(() => refreshStatus());
  await page.waitForTimeout(400);
  s = await state(page);
  console.log('serwer padł      :', JSON.stringify(s));
  if (!s.bar) fail.push('brak paska po zerwaniu połączenia');
  if (!s.send) fail.push('wysyłanie nadal aktywne mimo braku serwera');
  if (!/Brak połączenia/.test(s.text)) fail.push('pasek bez treści: ' + s.text);
  await page.screenshot({ path: `${SHOT}/o1-offline.png` });

  // 4. „Spróbuj ponownie" przy wciąż zerwanym łączu — pasek zostaje
  await page.click('#offline-retry');
  await page.waitForTimeout(500);
  s = await state(page);
  console.log('po nieudanej pr. :', JSON.stringify(s));
  if (!s.bar) fail.push('pasek zniknął mimo dalszego braku serwera');

  // 5. serwer wraca — pasek znika, wysyłanie odblokowane
  await page.unroute('**/api/**');
  await page.click('#offline-retry');
  await page.waitForTimeout(700);
  s = await state(page);
  console.log('serwer wrócił    :', JSON.stringify(s));
  if (s.bar) fail.push('pasek został mimo powrotu serwera');
  if (s.send) fail.push('wysyłanie zablokowane mimo powrotu serwera');

  console.log(fail.length ? '\nPROBLEMY: ' + fail.join('; ') : '\nPASEK OFFLINE OK');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

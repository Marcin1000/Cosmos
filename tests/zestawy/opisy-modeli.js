const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Opis modelu: pojawia się, zmienia z modelem, znika dla nieznanych
const SHOT = process.env.SHOT_DIR;

(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const fail = [];

  await page.click('#settings-btn');
  await page.waitForTimeout(400);

  const read = () => page.evaluate(() => {
    const b = document.getElementById('model-info-cloud');
    return { hidden: b.hidden, text: b.innerText.replace(/\s+/g, ' ').trim() };
  });

  // 1. domyślny model z .env — opis widoczny od razu
  let s = await read();
  console.log(`1. domyślny (.env): ${s.hidden ? 'UKRYTY' : s.text.slice(0, 80)}`);
  if (s.hidden) fail.push('brak opisu dla modelu domyślnego');

  const setModel = async (v) => {
    await page.fill('#set-model-cloud', v);
    await page.waitForTimeout(250);
    return read();
  };

  // 2. flagowiec — ostrzeżenie o szybkości
  s = await setModel('nvidia/nemotron-3-ultra-550b-a55b');
  console.log(`2. ultra-550b: ${s.text.slice(0, 90)}`);
  if (s.hidden || !/Ultra/.test(s.text)) fail.push('ultra bez opisu');
  if (!/⚠/.test(s.text)) fail.push('ultra bez ostrzeżenia o szybkości');

  // 3. model wizyjny — znacznik „widzi obrazy"
  s = await setModel('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
  console.log(`3. omni: ${s.text.slice(0, 90)}`);
  if (!/widzi obrazy/.test(s.text)) fail.push('omni bez znacznika wizji');

  // 4. model spoza katalogu z czytelną nazwą — opis oznaczony jako domysł
  s = await setModel('meta/llama-3.3-70b-instruct');
  console.log(`4. llama-instruct: ${s.text.slice(0, 90)}`);
  if (!/spoza katalogu/.test(s.text)) fail.push('nieznany model bez adnotacji o domyśle');

  // 5. całkiem nieznany — ramka znika, zamiast zmyślać
  s = await setModel('zupelnie-nieznany-xyz');
  console.log(`5. nieznany: ${s.hidden ? 'ramka ukryta (poprawnie)' : 'WIDOCZNA: ' + s.text}`);
  if (!s.hidden) fail.push('nieznany model pokazuje opis');

  // 6. embeddingi — ostrzeżenie, żeby nie wybierać do czatu
  s = await setModel('nvidia/llama-nemotron-embed-1b-v2');
  console.log(`6. embed: ${s.text.slice(0, 90)}`);
  if (!/Nie wybieraj/.test(s.text)) fail.push('model embeddingów bez ostrzeżenia');

  await page.screenshot({ path: `${SHOT}/models-settings.png` });

  // 7. brak poziomego przepełnienia w ustawieniach na telefonie
  await page.setViewportSize({ width: 412, height: 900 });
  await page.waitForTimeout(300);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  console.log(`7. telefon, ustawienia: ${over ? 'PRZEPEŁNIENIE' : 'mieści się'}`);
  if (over) fail.push('opis modelu rozpycha ustawienia na telefonie');
  await page.screenshot({ path: `${SHOT}/models-mobile.png` });

  console.log(fail.length ? '\nPROBLEMY: ' + fail.join('; ') : '\nOPISY MODELI OK');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

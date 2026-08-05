const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
const fs = require('fs');

(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 500) console.log(`   500 z: ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'shot-welcome.png') });

  // 1. czat w trybie chmury
  await page.fill('#input', 'Cześć! Pokaż mi przykład kodu.');
  await page.click('#send-btn');
  await page.waitForSelector('.msg-assistant .code-block', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'shot-chat.png') });

  // 2. przełącz na tryb lokalny i wyślij
  await page.click('.endpoint-tab[data-endpoint="local"]');
  await page.fill('#input', 'Test lokalnego GPU');
  await page.click('#send-btn');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.msg-assistant')].some(m => /local/i.test(m.textContent)), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'shot-local.png') });

  // 3. wyślij obraz (tryb chmury, powinien pójść model wizyjny)
  await page.click('.endpoint-tab[data-endpoint="cloud"]');
  // stwórz mały PNG w locie
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
  // do katalogu zrzutów (poza repozytorium), nie obok kodu
  const plik = require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'test-img.png');
  fs.writeFileSync(plik, png);
  await page.setInputFiles('#file-input', plik);
  await page.waitForSelector('.attachment img', { timeout: 5000 });
  await page.fill('#input', 'Co widzisz na obrazie?');
  await page.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'shot-attach.png') });
  await page.click('#send-btn');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.msg-assistant')].some(m => /Widzę/.test(m.textContent)), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'shot-vision.png') });

  // 4. ustawienia + pobranie list modeli z obu endpointów
  await page.click('#settings-btn');
  await page.click('#fetch-models-cloud');
  await page.waitForSelector('#model-select-cloud option', { state: 'attached', timeout: 5000 });
  await page.click('#fetch-models-local');
  await page.waitForSelector('#model-select-local option', { state: 'attached', timeout: 5000 });
  await page.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'shot-settings.png') });
  await page.click('#settings-close');

  // 5. motyw jasny
  await page.click('#theme-btn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'shot-light.png') });
  await page.click('#theme-btn');

  // 6. historia po odświeżeniu + service worker
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.conv-title');
  await page.waitForTimeout(300);
  const msgCount = await page.locator('.msg').count();
  const swActive = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(reg && (reg.active || reg.installing || reg.waiting));
  });

  // 7. manifest PWA
  const manifestOk = await page.evaluate(async () => {
    const r = await fetch('/manifest.webmanifest');
    const m = await r.json();
    return m.name === 'Cosmos' && m.icons.length >= 3;
  });

  console.log('Wiadomości po odświeżeniu i kliknięciu rozmowy:', msgCount);
  console.log('Service worker zarejestrowany:', swActive);
  console.log('Manifest PWA poprawny:', manifestOk);
  console.log('Błędy JS:', errors.length ? errors : 'brak');
  await browser.close();
  env.koniec();
  process.exit(errors.length ? 1 : 0);
})();

const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600); // status refresh

  // 1. status zmysłów
  const sensesState = await page.locator('#status-senses .status-state').textContent();
  console.log('Status zmysłów:', sensesState.trim());

  // 2. przyciski widoczne
  for (const id of ['mic-btn', 'camera-btn', 'tts-toggle', 'attach-btn']) {
    const visible = await page.locator('#' + id).isVisible();
    console.log(`#${id} widoczny:`, visible);
  }

  // 3. kamera: otwórz, zrób zdjęcie (fake device daje obraz testowy)
  await page.click('#camera-btn');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'shot-camera.png' });
  await page.click('#camera-capture');
  await page.waitForSelector('.attachment img', { timeout: 5000 });
  console.log('Zdjęcie z kamery dodane jako załącznik: true');

  // 4. wyślij ze zdjęciem — powinien odpowiedzieć model wizyjny
  await page.fill('#input', 'Co widzisz przez kamerę?');
  await page.click('#send-btn');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.msg-assistant')].some(m => /Widzę/.test(m.textContent)), null, { timeout: 15000 });
  console.log('Model wizyjny odpowiedział na zdjęcie z kamery: true');

  // 5. STT przez /api/stt (symulacja: bez klikania mic — bezpośredni fetch jak zrobiłby to handler)
  const stt = await page.evaluate(async () => {
    const res = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: new Blob([new Uint8Array(64)]) });
    return (await res.json()).text;
  });
  console.log('STT przez proxy:', stt);

  // 6. TTS: włącz głos i sprawdź endpoint
  await page.click('#tts-toggle');
  const ttsActive = await page.locator('#tts-toggle').evaluate((n) => n.classList.contains('active'));
  const ttsOk = await page.evaluate(async () => {
    const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'test' }) });
    return res.ok && (res.headers.get('content-type') || '').includes('audio');
  });
  console.log('Przełącznik głosu aktywny:', ttsActive, '| TTS zwraca audio:', ttsOk);

  // 7. zapytaj o zmiany w pokoju — kontekst percepcji
  await page.fill('#input', 'Co się ostatnio zmieniło w pokoju?');
  await page.click('#send-btn');
  await page.waitForFunction(() =>
    document.querySelectorAll('.msg-assistant').length >= 2, null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'shot-orchestra.png' });

  console.log('Błędy JS:', errors.length ? errors : 'brak');
  await browser.close();
  env.koniec();
  process.exit(errors.length ? 1 : 0);
})();

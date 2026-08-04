const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Ostrzeżenie o obrazie wysyłanym do modelu bez wzroku
const { spawn } = require('child_process');
// Ostrzeżenie pojawia się TYLKO bez ustawionego modelu wizyjnego — inaczej Cosmos podmienia model sam.
const PORT = 3070;
let srv;
const start = async () => {
  srv = spawn('node', ['server.js'], { cwd: '/home/user/Bear', stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: String(PORT), NVIDIA_API_KEY: 'test',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:9099/v1', LOCAL_BASE_URL: 'http://127.0.0.1:9098/v1',
      LOCAL_API_KEY: 'test' } });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return; } catch { /* jeszcze wstaje */ }
  }
  throw new Error('serwer testowy nie wstał');
};
const stop = () => { try { process.kill(-srv.pid); } catch { /* już nie żyje */ } };
(async () => {
  const env = await srodowisko('bezWzroku');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  await start();
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const fail = [];

  const probe = (model) => page.evaluate((m) => {
    settings.modelCloud = m;
    endpoint = 'cloud';
    pendingImages = ['data:image/png;base64,iVBORw0KGgo='];
    renderAttachments();
    const w = document.getElementById('blind-model-warn');
    return { warn: Boolean(w), text: w ? w.innerText.slice(0, 60) : '' };
  }, model);

  // 1. model bez wzroku → ostrzeżenie
  let r = await probe('nvidia/nemotron-nano-9b-v2');
  console.log(`1. nano-9b (bez wzroku): ${r.warn ? 'ostrzega — ' + r.text : 'BRAK OSTRZEŻENIA'}`);
  if (!r.warn) fail.push('brak ostrzeżenia dla modelu bez wzroku');

  // 2. model wizyjny → cisza
  r = await probe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
  console.log(`2. omni (widzi obrazy): ${r.warn ? 'FAŁSZYWE OSTRZEŻENIE' : 'brak ostrzeżenia (poprawnie)'}`);
  if (r.warn) fail.push('fałszywe ostrzeżenie dla modelu wizyjnego');

  // 3. brak załączników → ostrzeżenie znika
  r = await page.evaluate(() => {
    settings.modelCloud = 'nvidia/nemotron-nano-9b-v2';
    pendingImages = [];
    renderAttachments();
    return { warn: Boolean(document.getElementById('blind-model-warn')) };
  });
  console.log(`3. bez załącznika: ${r.warn ? 'OSTRZEŻENIE ZOSTAŁO' : 'znika (poprawnie)'}`);
  if (r.warn) fail.push('ostrzeżenie nie znika po usunięciu obrazu');

  console.log(fail.length ? '\nPROBLEMY: ' + fail.join('; ') : '\nOSTRZEŻENIE O OBRAZACH OK');
  await browser.close();
  stop();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

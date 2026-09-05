const { srodowisko, przegladarka, maPrzegladarke, KORZEN } = require('../pomoc');
// Cztery zakładki silników na wąskim ekranie: pasek ma się przewijać, nie rozpychać strony
const { spawn } = require('child_process');
// Cztery zakładki pojawiają się dopiero, gdy są klucze do czterech silników.
const PORT = 3071;
let srv;
const start = async () => {
  srv = spawn('node', ['server.js'], { cwd: KORZEN, stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: String(PORT), NVIDIA_API_KEY: 'test',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:9099/v1', LOCAL_BASE_URL: 'http://127.0.0.1:9098/v1',
      OPENAI_API_KEY: 'test', ANTHROPIC_API_KEY: 'test', LOCAL_API_KEY: 'test' } });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) return; } catch { /* jeszcze wstaje */ }
  }
  throw new Error('serwer testowy nie wstał');
};
const stop = () => { try { process.kill(-srv.pid); } catch { /* już nie żyje */ } };
const SHOT = require('../pomoc').KATALOG_ZRZUTOW;

(async () => {
  const env = await srodowisko('czterySilniki');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  await start();
  const browser = await przegladarka();
  const fail = [];

  for (const w of [360, 412]) {
    const page = await browser.newPage({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true });
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'load' });
    await page.waitForTimeout(600);

    const r = await page.evaluate(() => {
      const sw = document.querySelector('.endpoint-switch');
      return {
        tabs: sw.querySelectorAll('.endpoint-tab').length,
        switchScrolls: sw.scrollWidth > sw.clientWidth,
        pageScrollW: document.documentElement.scrollWidth,
        pageClientW: document.documentElement.clientWidth,
        lastTabReachable: (() => {
          const t = sw.querySelectorAll('.endpoint-tab');
          return t.length ? t[t.length - 1].scrollWidth > 0 : false;
        })(),
      };
    });
    const overflow = r.pageScrollW > r.pageClientW + 1;
    console.log(`${w}px: zakładek=${r.tabs} pasek-przewijalny=${r.switchScrolls} strona=${r.pageScrollW}/${r.pageClientW} ${overflow ? 'ZLE' : 'OK'}`);
    if (overflow) fail.push(`${w}px rozpycha stronę`);
    if (r.tabs !== 4) fail.push(`${w}px: ${r.tabs} zakładek zamiast 4`);
    await page.screenshot({ path: `${SHOT}/t-${w}.png`, clip: { x: 0, y: 0, width: w, height: 120 } });
    await page.close();
  }

  console.log(fail.length ? 'PROBLEMY: ' + fail.join('; ') : 'ZAKŁADKI OK');
  await browser.close();
  stop();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

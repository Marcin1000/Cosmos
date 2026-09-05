const { srodowisko, przegladarka, maPrzegladarke, KORZEN } = require('../pomoc');
// Licznik czekania: pojawia się, gdy model milczy; znika, gdy zacznie pisać.
const http = require('http');

// atrapa: 3 sekundy ciszy, potem odpowiedź
const mock = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[]}'); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  setTimeout(() => {
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Gotowe po czekaniu.' } }] }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  }, 3500);
});

mock.listen(7093, async () => {
  const { spawn } = require('child_process');
  const srv = spawn('node', ['server.js'], {
    cwd: KORZEN, stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3011', NVIDIA_API_KEY: 'test', NEMOTRON_BASE_URL: 'http://127.0.0.1:7093/v1' },
  });
  await new Promise((r) => setTimeout(r, 4000));

  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const fail = [];
  page.on('pageerror', (e) => fail.push('błąd JS: ' + e.message));
  await page.goto('http://localhost:3011', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  await page.fill('#input', 'Czy możesz stworzyć grafikę z widokiem Dolomitów?');
  await page.click('#send-btn');

  await page.waitForTimeout(2200);
  const during = await page.evaluate(() => {
    const n = document.querySelector('.msg-assistant .wait-note');
    return { shown: !!n, text: n ? n.textContent : '' };
  });
  console.log(`1. w trakcie czekania: licznik=${during.shown} „${during.text}"`);
  if (!during.shown) fail.push('brak licznika czekania — pusty dymek jak przy zawieszeniu');
  if (!/\d+\s*s/.test(during.text)) fail.push('licznik nie pokazuje sekund');

  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.msg-assistant .msg-content')].pop();
    return { note: !!b.querySelector('.wait-note'), text: b.innerText.trim() };
  });
  console.log(`2. po odpowiedzi: licznik=${after.note}, treść „${after.text.slice(0, 40)}"`);
  if (after.note) fail.push('licznik został po nadejściu odpowiedzi');
  if (!/Gotowe po czekaniu/.test(after.text)) fail.push('brak odpowiedzi');

  await browser.close();
  try { process.kill(-srv.pid); } catch { /* już nie żyje */ }
  mock.close();
  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nLICZNIK CZEKANIA OK');
  process.exit(fail.length ? 1 : 0);
});

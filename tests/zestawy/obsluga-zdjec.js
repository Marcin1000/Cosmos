const { srodowisko, przegladarka, maPrzegladarke, KORZEN } = require('../pomoc');
// Zdjęcie do modelu bez wzroku: przekierowanie na model wizyjny albo czytelny błąd.
// Plus: zdjęcie z aparatu trafia do Galerii.
const http = require('http');
const { spawn } = require('child_process');

const seen = [];
const up = http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end('{"data":[]}'); }
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const j = JSON.parse(b); seen.push(j);
    if (j.model === 'acme/nieznany-model-tekstowy') {   // model spoza katalogu, który odmawia
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'This model does not support image content type.' } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Widzę stół i książeczkę.' } }] }) + '\n\n');
    res.write('data: [DONE]\n\n'); res.end();
  });
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

const ask = async (port, model, vision) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', model, messages: [
      { role: 'user', content: [{ type: 'image_url', image_url: { url: PNG } }, { type: 'text', text: 'Co to?' }] }] }),
  });
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  return { status: r.status, used: decodeURIComponent(r.headers.get('X-Cosmos-Model') || ''),
    swapped: decodeURIComponent(r.headers.get('X-Cosmos-Model-Swapped-From') || ''), body };
};

up.listen(7089, async () => {
  const fail = [];
  // A. z ustawionym modelem wizyjnym → przekierowanie
  let srv = spawn('node', ['server.js'], { cwd: KORZEN, stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3015', NVIDIA_API_KEY: 'test', NEMOTRON_BASE_URL: 'http://127.0.0.1:7089/v1',
      NEMOTRON_VISION_MODEL: 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1' } });
  await new Promise((r) => setTimeout(r, 4000));

  let a = await ask(3015, 'nvidia/nemotron-nano-9b-v2');
  console.log(`1. model bez wzroku + ustawiony wizyjny → HTTP ${a.status}`);
  console.log(`   odpowiedział: ${a.used}  (zamiast ${a.swapped || '—'})`);
  if (a.status !== 200) fail.push('nie przekierował na model wizyjny');
  if (a.used !== 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1') fail.push('użyty zły model');
  if (a.swapped !== 'nvidia/nemotron-nano-9b-v2') fail.push('brak informacji o podmianie');

  // model, który widzi — bez podmiany
  a = await ask(3015, 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning');
  console.log(`2. model wizyjny → odpowiedział: ${a.used}, podmiana: ${a.swapped || 'brak'}`);
  if (a.swapped) fail.push('podmienił model, który i tak widzi obrazy');

  // model spoza katalogu, który odmawia → czytelny błąd zamiast „HTTP 400"
  a = await ask(3015, 'acme/nieznany-model-tekstowy');
  const msg = typeof a.body === 'object' ? a.body.error : String(a.body);
  console.log(`3. model spoza katalogu odmawia → HTTP ${a.status}`);
  console.log(`   ${String(msg).split('\n')[0].slice(0, 90)}`);
  if (!/odmówił przyjęcia zdjęcia|widzi obrazy/.test(String(msg))) fail.push('błąd 400 nadal nic nie mówi');
  try { process.kill(-srv.pid); } catch {}

  // B. bez modelu wizyjnego → czytelny błąd, nie bezużyteczna odpowiedź
  srv = spawn('node', ['server.js'], { cwd: KORZEN, stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3016', NVIDIA_API_KEY: 'test', NEMOTRON_BASE_URL: 'http://127.0.0.1:7089/v1' } });
  await new Promise((r) => setTimeout(r, 4000));
  a = await ask(3016, 'nvidia/nemotron-nano-9b-v2');
  const m2 = typeof a.body === 'object' ? a.body.error : String(a.body);
  console.log(`4. brak modelu wizyjnego → HTTP ${a.status}`);
  console.log(`   ${String(m2).split('\n')[0].slice(0, 92)}`);
  if (a.status !== 400) fail.push('wysłał zdjęcie do ślepego modelu zamiast ostrzec');
  if (!/NEMOTRON_VISION_MODEL/.test(String(m2))) fail.push('błąd nie mówi, co ustawić');

  // C. zdjęcie z aparatu trafia do Galerii
  const b = await przegladarka({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ permissions: ['camera'] });
  const p = await ctx.newPage();
  const kbPosts = [];
  p.on('request', (r) => { if (r.url().includes('/api/kb/file') && r.method() === 'POST') kbPosts.push(r.postDataJSON()); });
  await p.goto('http://localhost:3016', { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.evaluate(() => openCamera());
  await p.waitForTimeout(1200);
  await p.click('#camera-capture');
  await p.waitForTimeout(1500);
  console.log(`5. „Zrób zdjęcie" → zapisów do bazy wiedzy: ${kbPosts.length}`);
  if (kbPosts.length) console.log(`   nazwa: ${kbPosts[0].name}, typ: ${kbPosts[0].mime}, dane: ${String(kbPosts[0].data).length} B`);
  const attached = await p.evaluate(() => pendingImages.length);
  console.log(`   nadal dołączone do wiadomości: ${attached}`);
  if (!kbPosts.length) fail.push('zdjęcie nie trafia do Galerii');
  if (kbPosts.length && !/^zdjecie-.*\.jpg$/.test(kbPosts[0].name)) fail.push('zła nazwa pliku');
  if (attached !== 1) fail.push('zdjęcie zniknęło z załączników wiadomości');

  await b.close(); try { process.kill(-srv.pid); } catch {} up.close();
  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nOBSŁUGA ZDJĘĆ OK');
  process.exit(fail.length ? 1 : 0);
});

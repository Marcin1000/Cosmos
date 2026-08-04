// Funkcje pomocnicze mają używać modelu WYBRANEGO, nie tego z .env
const http = require('http');
const { spawn } = require('child_process');

const seen = [];
const up = http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end('{"data":[]}'); }
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const model = JSON.parse(b).model;
    seen.push(model);
    if (model === 'nvidia/nieistniejacy-z-env') {      // stary wpis w .env → 404 jak u Marcina
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 page not found');
    }
    const body = JSON.stringify({ choices: [{ message: { content: 'Dopracowany prompt.' } }] });
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body);
  });
});

up.listen(7091, async () => {
  const srv = spawn('node', ['server.js'], { cwd: '/home/user/Bear', stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3013', NVIDIA_API_KEY: 'test',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:7091/v1', NEMOTRON_MODEL: 'nvidia/nieistniejacy-z-env' } });
  await new Promise((r) => setTimeout(r, 4000));
  const fail = [];
  const ask = async (body) => {
    const r = await fetch('http://127.0.0.1:3013/api/polish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, d: await r.json() };
  };

  // 1. z modelem wybranym w Ustawieniach — ma go użyć
  let a = await ask({ text: 'x'.repeat(40), endpoint: 'cloud', model: 'nvidia/nemotron-3-super-120b-a12b' });
  console.log(`1. z modelem z Ustawień → HTTP ${a.status}, użyty: ${seen[seen.length-1]}`);
  if (a.status !== 200) fail.push('nie użył wybranego modelu: ' + JSON.stringify(a.d).slice(0, 80));
  if (seen[seen.length-1] !== 'nvidia/nemotron-3-super-120b-a12b') fail.push('poszedł inny model niż wybrany');

  // 2. bez modelu — awaryjnie ten z .env, a błąd ma powiedzieć KTÓRY
  a = await ask({ text: 'x'.repeat(40), endpoint: 'cloud' });
  const msg = String(a.d.message || a.d.error || '');
  console.log(`2. bez modelu (spada na .env) → HTTP ${a.status}`);
  console.log(`   ${msg.replace(/\n/g, ' | ').slice(0, 120)}`);
  if (!msg.includes('nieistniejacy-z-env')) fail.push('błąd nie mówi, jaki model poleciał');
  if (!/Pobierz listę/.test(msg)) fail.push('brak podpowiedzi, co zrobić przy 404');
  if (/Unexpected non-whitespace/.test(msg)) fail.push('surowy błąd parsera nadal wycieka');

  // 3. streszczenie tą samą drogą
  const r3 = await fetch('http://127.0.0.1:3013/api/summarize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'rozmowa', endpoint: 'cloud', model: 'nvidia/nemotron-3-super-120b-a12b' }) });
  const d3 = await r3.json();
  console.log(`3. streszczenie z modelem z Ustawień → HTTP ${r3.status}, „${String(d3.summary || d3.error).slice(0, 40)}"`);
  if (r3.status !== 200) fail.push('streszczenie nie używa wybranego modelu');

  try { process.kill(-srv.pid); } catch {}
  up.close();
  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nWYBÓR MODELU OK');
  process.exit(fail.length ? 1 : 0);
});

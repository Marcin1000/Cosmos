// /api/polish przy dostawcy, który ignoruje stream:false albo zwraca śmieci
const http = require('http');
const KORZEN = require('node:path').resolve(__dirname, '..', '..');
const { spawn } = require('child_process');

let mode = 'sse';
const upstream = http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end('{"data":[]}'); }
  if (mode === 'sse') {
    // strumień mimo stream:false — to odtwarza zgłoszony objaw
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Zbuduj system śledzenia meczów.\n\nWymagania:\n- kanał\n- godzina\n- dyscyplina' } }] }) + '\n\n');
    res.write('data: [DONE]\n\n'); res.end();
  } else {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end('<html>502 Bad Gateway</html>');
  }
});

upstream.listen(7092, async () => {
  const srv = spawn('node', ['server.js'], { cwd: KORZEN, stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3012', NVIDIA_API_KEY: 'test', NEMOTRON_BASE_URL: 'http://127.0.0.1:7092/v1' } });
  await new Promise((r) => setTimeout(r, 4000));
  const fail = [];
  const ask = async () => {
    const r = await fetch('http://127.0.0.1:3012/api/polish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'chcialbym system w ktorym sprawdzam mecze i jakie te mecze sa kiedy i na jakim kanale' }),
    });
    return { status: r.status, body: await r.json() };
  };

  let a = await ask();
  console.log(`1. dostawca strumieniuje mimo stream:false → HTTP ${a.status}`);
  console.log(`   ${JSON.stringify(a.body).slice(0, 100)}`);
  if (a.status !== 200 || !a.body.text) fail.push('nie poradził sobie ze strumieniem');
  if (/Unexpected non-whitespace/.test(JSON.stringify(a.body))) fail.push('surowy błąd parsera nadal wycieka');

  mode = 'html';
  a = await ask();
  console.log(`2. dostawca oddaje HTML → HTTP ${a.status}`);
  console.log(`   ${String(a.body.message || a.body.error).slice(0, 96)}`);
  const msg = String(a.body.message || a.body.error || '');
  if (/Unexpected non-whitespace|is not valid JSON/.test(msg)) fail.push('nadal komunikat o JSON zamiast przyczyny');
  if (!/502/.test(msg)) fail.push('błąd nie mówi, co przyszło od dostawcy');

  try { process.kill(-srv.pid); } catch {}
  upstream.close();
  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nDOPRACOWANIE PROMPTU OK');
  process.exit(fail.length ? 1 : 0);
});

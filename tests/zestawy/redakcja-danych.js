// scrubSecrets jest zadeklarowana NIŻEJ niż miejsce wywołania — sprawdźmy,
// że hoisting faktycznie działa, zamiast zakładać.
const http = require('http');
const KORZEN = require('node:path').resolve(__dirname, '..', '..');
const { spawn } = require('child_process');
const KONTO = 'LeJnCuVKFSUWaEmU-j4546SFuR2EU-IJTkbLwD78VKs';

http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end('{"data":[]}'); }
  let b=''; req.on('data',(c)=>{b+=c;});
  req.on('end', () => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Function 'x': Not found for account '${KONTO}'` } }));
  });
}).listen(7107, async () => {
  const srv = spawn('node', ['server.js'], { cwd: KORZEN, stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3062', NVIDIA_API_KEY: 'test', NEMOTRON_BASE_URL: 'http://127.0.0.1:7107/v1' } });
  await new Promise((r) => setTimeout(r, 4500));
  const r = await fetch('http://127.0.0.1:3062/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', model: 'x', messages: [{ role: 'user', content: 'cześć' }] }),
  });
  const j = await r.json();
  console.log('błąd czatu: ' + j.error);
  const ok = !j.error.includes(KONTO) && /ukryte/.test(j.error);
  console.log(ok ? '\nREDAKCJA W CZACIE OK' : '\nDO POPRAWY: identyfikator konta widoczny w czacie');
  process.kill(-srv.pid);
  process.exit(ok ? 0 : 1);
});

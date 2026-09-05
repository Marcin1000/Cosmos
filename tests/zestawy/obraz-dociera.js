const { srodowisko, przegladarka, maPrzegladarke, KORZEN } = require('../pomoc');
// Czy obraz w ogóle dociera do modelu? Nagrywamy, co dostaje dostawca.
const http = require('http');
const { spawn } = require('child_process');

const got = [];
const up = http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end('{"data":[]}'); }
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    got.push(JSON.parse(b));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }) + '\n\n');
    res.write('data: [DONE]\n\n'); res.end();
  });
});

up.listen(7090, async () => {
  const srv = spawn('node', ['server.js'], { cwd: KORZEN, stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3014', NVIDIA_API_KEY: 'test',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:7090/v1',
      // model wizyjny — inaczej serwer (słusznie) odrzuci zdjęcie do ślepego modelu
      NEMOTRON_MODEL: 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1' } });
  await new Promise((r) => setTimeout(r, 4000));

    const b = await przegladarka();
  const p = await b.newPage();
  const fail = [];
  p.on('pageerror', (e) => fail.push('błąd JS: ' + e.message));
  await p.goto('http://localhost:3014', { waitUntil: 'load' });
  await p.waitForTimeout(600);

  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

  // dokładnie tak, jak robi to aparat: dołóż obraz do pendingImages i wyślij
  await p.evaluate(async (png) => {
    pendingImages.push(png);
    renderAttachments();
    document.getElementById('input').value = 'Co przedstawia to zdjęcie?';
    await sendMessage();
  }, PNG);
  await p.waitForTimeout(3000);

  console.log(`  żądań do modelu: ${got.length}`);
  if (!got.length) { console.log('BŁĄD: nic nie doszło'); await b.close(); try{process.kill(-srv.pid);}catch{} up.close(); process.exit(1); }

  const req = got[0];
  const userMsgs = req.messages.filter((m) => m.role === 'user');
  const last = userMsgs[userMsgs.length - 1];
  const isArray = Array.isArray(last.content);
  const hasImg = isArray && last.content.some((x) => x.type === 'image_url');
  console.log(`  model: ${req.model}`);
  console.log(`  ostatnia wiadomość użytkownika: ${isArray ? 'tablica części' : 'zwykły tekst'}`);
  console.log(`  zawiera image_url: ${hasImg}`);
  if (isArray) console.log(`  części: ${last.content.map((x) => x.type).join(', ')}`);
  else console.log(`  treść: ${String(last.content).slice(0, 80)}`);
  if (!hasImg) fail.push('OBRAZ NIE DOTARŁ DO MODELU');

  console.log(fail.length ? '\nBŁĘDY: ' + fail.join('; ') : '\nOBRAZ DOCIERA POPRAWNIE');
  await b.close(); try { process.kill(-srv.pid); } catch {} up.close();
  process.exit(fail.length ? 1 : 0);
});

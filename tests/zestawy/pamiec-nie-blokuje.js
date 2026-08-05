// Hipoteza: pamięć długotrwała blokuje czat. searchMemory czeka na embedding
// zapytania (5 s), a gdy wpisy mają wektory z innego modelu — dolicza
// przeliczenie WSZYSTKICH z limitem 60 s. Wszystko zanim model dostanie prompt.
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

const DANE = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'cosmos-pamiec-'));
let opoznienieEmbed = 8000;          // ile „liczy" usługa embeddingów

// atrapa zmysłów: /embed odpowiada powoli, jak przeciążony komputer domowy
const zmysly = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"whisper":false,"piper":false,"yolo":false,"embed":true}');
  }
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => setTimeout(() => {
    const n = (JSON.parse(b).texts || ['x']).length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ vectors: Array.from({ length: n }, () => [0.1, 0.2, 0.3]), model: 'atrapa-embed' }));
  }, opoznienieEmbed));
});

const model = http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200, {'Content-Type':'application/json'}); return res.end('{"data":[]}'); }
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Odpowiedź.' } }] })}\n\n`);
    res.write('data: [DONE]\n\n'); res.end();
  });
});

const czat = async (tresc) => {
  const t0 = Date.now();
  const r = await fetch('http://127.0.0.1:3112/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', messages: [{ role: 'user', content: tresc }] }),
  });
  await r.body.getReader().read();
  return Date.now() - t0;
};

zmysly.listen(7112, () => model.listen(7113, async () => {
  // pamięć z wektorami policzonymi INNYM modelem — tak jest po każdej zmianie
  // dostawcy embeddingów albo po przejściu chmura↔zmysły
  fs.rmSync(DANE, { recursive: true, force: true });
  fs.mkdirSync(DANE, { recursive: true });
  fs.writeFileSync(`${DANE}/memory.json`, JSON.stringify(
    Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`, text: `Fakt numer ${i} o sprzęcie i preferencjach.`,
      embedding: [0.9, 0.8, 0.7], embModel: 'stary-model', at: Date.now(),
    }))));

  const srv = spawn('node', ['server.js'], {
    cwd: '/home/user/Bear', stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3112', NVIDIA_API_KEY: 'test',
      COSMOS_DATA_DIR: DANE,
      SENSES_URL: 'http://127.0.0.1:7112',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:7113/v1' },
  });
  await new Promise((r) => setTimeout(r, 4500));

  const fail = [];
  console.log(`usługa embeddingów odpowiada po ${opoznienieEmbed / 1000} s (wolny komputer domowy)\n`);

  const a = await czat('Co wiesz o moim sprzęcie?');
  console.log(`1. pierwsza wiadomość (30 wpisów do przeliczenia): ${(a / 1000).toFixed(1)} s`);
  // Budżet 1,2 s + narzut. Kiedyś: 5 s, bo przeliczanie wektorów szło
  // w ścieżce żądania z limitem 60 s.
  if (a > 2500) fail.push(`pierwsza wiadomość czeka ${(a / 1000).toFixed(1)} s — pamięć znów blokuje`);

  const b2 = await czat('A drugie pytanie?');
  console.log(`2. druga wiadomość (bezpiecznik już zadziałał):    ${(b2 / 1000).toFixed(1)} s`);
  if (b2 > 800) fail.push(`druga wiadomość czeka ${(b2 / 1000).toFixed(1)} s — bezpiecznik nie działa`);

  // usługa pada zupełnie — rozmowa i tak ma ruszyć od razu
  opoznienieEmbed = 30000;
  fs.writeFileSync(`${DANE}/memory.json`, JSON.stringify(
    Array.from({ length: 30 }, (_, i) => ({
      id: `m${i}`, text: `Fakt ${i}`, embedding: [0.9], embModel: 'znowu-inny', at: Date.now(),
    }))));
  const c = await czat('Trzecie pytanie przy zawieszonej usłudze');
  console.log(`3. gdy usługa embeddingów wisi:                    ${(c / 1000).toFixed(1)} s`);
  if (c > 800) fail.push(`przy zawieszonej usłudze czeka ${(c / 1000).toFixed(1)} s`);

  // 4. mimo wszystko odpowiedź jest pełna — pamięć odpuszczona, nie zepsuta
  const r = await fetch('http://127.0.0.1:3112/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', messages: [{ role: 'user', content: 'ostatnie' }] }),
  });
  const tekst = await r.text();
  console.log(`4. odpowiedź mimo odpuszczonej pamięci: ${/Odpowied/.test(tekst) ? 'jest' : 'BRAK'}`);
  if (!/Odpowied/.test(tekst)) fail.push('rozmowa przestała działać bez embeddingów');

  process.kill(-srv.pid); zmysly.close(); model.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPAMIĘĆ NIE BLOKUJE ROZMOWY');
  process.exit(fail.length ? 1 : 0);
}));

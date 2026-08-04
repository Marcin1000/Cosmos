// Atrapy: OpenAI Images + ElevenLabs + Seedance (Ark) na porcie 9095
const http = require('node:http');
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNsaGj4DwAFhAJ/l3WBIQAAAABJRU5ErkJggg==', 'base64');
let seedanceCalls = 0;

http.createServer((req, res) => {
  let body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    body = Buffer.concat(body).toString();
    console.log('STUDIO-MOCK', req.method, req.url);
    if (req.url === '/v1/images/edits') {
      console.log('  EDIT (inpainting)');
      res.writeHead(200,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({ data:[{ b64_json: PNG.toString('base64') }] }));
    }
    if (req.url === '/v1/images/generations') {
      const p = JSON.parse(body);
      console.log('  image prompt:', p.prompt.slice(0, 60), 'model:', p.model, 'size:', p.size);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }));
    }
    if (req.url.startsWith('/v1/text-to-speech/')) {
      console.log('  tts voice:', req.url.split('/').pop(), 'key:', req.headers['xi-api-key']);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(Buffer.from('ID3fake-mp3-data-cosmos'));
    }
    if (req.url === '/api/v3/contents/generations/tasks' && req.method === 'POST') {
      const p = JSON.parse(body);
      console.log('  video model:', p.model); console.log('  text:', p.content.find(c=>c.type==='text').text); console.log('  klatki:', p.content.filter(c=>c.type==='image_url').map(c=>c.role||'(bez roli)').join(', ') || 'brak');
      seedanceCalls = 0;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: 'task-777' }));
    }
    if (req.url === '/api/v3/contents/generations/tasks/task-777') {
      seedanceCalls++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (seedanceCalls < 2) return res.end(JSON.stringify({ status: 'running' }));
      return res.end(JSON.stringify({ status: 'succeeded', content: { video_url: 'http://localhost:9095/fake.mp4' } }));
    }
    if (req.url === '/ims/token/v3' && req.method === 'POST') {
      console.log('  IMS token:', body.includes('client_credentials') ? 'client_credentials OK' : body.slice(0,80));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ access_token: 'ims-tok-123', expires_in: 3600 }));
    }
    if (req.url === '/v3/images/generate' && req.method === 'POST') {
      const p = JSON.parse(body);
      console.log('  firefly prompt:', p.prompt.slice(0, 50), 'size:', JSON.stringify(p.size),
        'auth:', req.headers.authorization, 'x-api-key:', req.headers['x-api-key']);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ outputs: [{ image: { url: 'http://localhost:9095/ff.png' } }] }));
    }
    if (req.url === '/ff.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(PNG);
    }
    if (req.url === '/fake.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      return res.end(Buffer.from('ftyp-fake-mp4-cosmos-video'));
    }
    res.writeHead(404); res.end();
  });
}).listen(9095, () => console.log('mock studio on 9095'));

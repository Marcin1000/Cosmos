// Atrapa Cosmos Senses do testów e2e
const http = require('node:http');
http.createServer((req, res) => {
  let body = [];
  req.on('data', c => body.push(c));
  req.on('end', () => {
    body = Buffer.concat(body);
    if (req.url === '/health') {
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({whisper:true,piper:true,yolo:true,mediapipe:true}));
    }
    if (req.url === '/stt') {
      console.log('SENSES /stt otrzymał', body.length, 'bajtów,', req.headers['content-type']);
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({text:'To jest test dyktowania przez Whisper.', language:'pl'}));
    }
    if (req.url === '/tts') {
      // minimalny nagłówek WAV (44 bajty) + cisza
      const wav = Buffer.alloc(44 + 1600);
      wav.write('RIFF',0); wav.writeUInt32LE(36+1600,4); wav.write('WAVEfmt ',8);
      wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
      wav.writeUInt32LE(16000,24); wav.writeUInt32LE(32000,28); wav.writeUInt16LE(2,32);
      wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(1600,40);
      res.writeHead(200, {'Content-Type':'audio/wav'});
      return res.end(wav);
    }
    if (req.url === '/upscale') {
      const p = JSON.parse(body.toString());
      res.writeHead(200,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({ image: p.image }));
    }
    if (req.url === '/embed') {
      const texts = JSON.parse(body.toString()).texts || [];
      const vec = (t) => {
        const v = new Array(64).fill(0);
        for (const w of t.toLowerCase().split(/[^a-ząćęłńóśźż0-9]+/).filter(x => x.length >= 4)) {
          let h = 0; for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
          v[h % 64] += 1;
        }
        const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
        return v.map(x => x / n);
      };
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({vectors: texts.map(vec)}));
    }
    if (req.url === '/extract') {
      const p = JSON.parse(body.toString());
      console.log('SENSES /extract:', p.name);
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({text: 'Arkusz: Budzet 2026. Kamera Canon: 12000 zl. Dron zapasowy: 8000 zl. Oswietlenie: 3500 zl. Razem: 23500 zl.'}));
    }
    if (req.url === '/detect') {
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({objects:[{label:'person',conf:0.92,box:[10,10,200,400]}],summary:'1× person'}));
    }
    res.writeHead(404); res.end();
  });
}).listen(7060, () => console.log('mock senses on 7060'));

// Atrapa dostawcy z listą jak u NVIDII: większość pozycji konto ma zablokowane.
const http = require('http');
const OK = ['nvidia/nemotron-nano-9b-v2', 'nvidia/nemotron-3-super-120b'];
const VL = ['nvidia/vl-8b'];
const BAD = ['meta/zablokowany-1', 'meta/zablokowany-2', 'inny/nie-dla-ciebie'];
const ALL = [...OK, ...VL, ...BAD];
http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: ALL.map((id) => ({ id })) }));
  }
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const j = JSON.parse(b);
    const img = Array.isArray(j.messages[0].content);
    const bad = (code, msg) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: msg } }));
    };
    if (BAD.includes(j.model)) return bad(404, `Function '${j.model}' Not found for account.`);
    if (img && !VL.includes(j.model)) return bad(400, 'This model does not support image content type.');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
}).listen(7103, () => console.log('katalog na 7103'));

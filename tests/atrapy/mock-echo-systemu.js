/* Atrapa, która oddaje w treści odpowiedzi to, co dostała w wiadomościach
   systemowych. Dzięki temu test sprawdza, co model NAPRAWDĘ widzi, zamiast
   zgadywać po kodzie serwera — a właśnie tam siedziały luki: Cosmos nigdy
   nie podawał daty ani lokalizacji, więc „dziś" i „w okolicy" nic nie
   znaczyły. */
const http = require('http');

http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'atrapa/echo' }] }));
  }
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    let systemowe = '';
    try {
      systemowe = (JSON.parse(b).messages || [])
        .filter((m) => m.role === 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n---\n');
    } catch { systemowe = 'BŁĄD PARSOWANIA'; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Jednym kawałkiem — treść jest tu danymi, nie testem płynności.
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: systemowe } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(7116, () => console.log('atrapa echa systemu na 7116'));

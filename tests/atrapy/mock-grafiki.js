/* Atrapa DuckDuckGo dla grafik. Dwa kroki, tak jak naprawdę: najpierw strona
   HTML z żetonem `vqd`, dopiero z nim wolno odpytać `i.js`. Atrapa pilnuje
   tej kolejności — bez żetonu oddaje pustkę, tak jak oryginał. */
const http = require('http');

const ZETON = '4-123456789';

const OBRAZY = (q) => Array.from({ length: 8 }, (_, i) => ({
  title: `${q} — zdjęcie ${i + 1}`,
  thumbnail: `http://127.0.0.1:7117/iu/?u=mini${i}`,
  image: `https://przyklad.pl/${encodeURIComponent(q)}-${i}.jpg`,
  url: `https://przyklad.pl/strona/${i}`,
  width: 1200, height: 800,
}));

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const q = u.searchParams.get('q') || '';

  // krok 1 — strona z żetonem
  if (u.pathname === '/' && u.searchParams.get('ia') === 'images') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<html><body><script>vqd="${ZETON}";</script></body></html>`);
  }

  // krok 2 — właściwe wyniki, ale tylko z poprawnym żetonem
  if (u.pathname === '/i.js') {
    if (u.searchParams.get('vqd') !== ZETON) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ results: [] }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ results: OBRAZY(q) }));
  }

  // miniatura — jednopikselowy GIF, żeby proxy miało co przepuścić
  if (u.pathname === '/iu/') {
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': gif.length });
    return res.end(gif);
  }

  res.writeHead(404); res.end();
}).listen(7117, () => console.log('atrapa grafik na 7117'));

// Sprawdź samą ekstrakcję tekstu ze strony — na lokalnym serwerze HTML,
// bo wyszukiwarka jest z tego środowiska nieosiągalna.
const http = require('http');
// Import zamiast wycinania regexem: tamto psuło się przy każdym dołożeniu
// stałej między funkcjami, choć sam kod działał bez zarzutu.
const { fetchPageText } = require('../../lib/szukanie.js');

const page = `<!doctype html><html><head><title>Pogoda</title>
<style>.x{color:red}</style><script>var a=1;</script></head>
<body><nav>Menu Start Kontakt</nav>
<h1>Warszawa</h1><p>Temperatura teraz: <b>7&deg;C</b>, wiatr 12 km/h.</p>
<ul><li>Ci&sbquo;nienie 1013 hPa</li><li>Wilgotno&#347;&#263; 81%</li></ul>
<!-- komentarz do pomini&eogon;cia --><footer>&copy; 2026</footer></body></html>`;

const srv = http.createServer((req, res) => {
  if (req.url === '/binary') {
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.alloc(64));
  } else if (req.url === '/big') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<p>' + 'x'.repeat(900000) + '</p>');
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page);
  }
});

srv.listen(7096, async () => {
  const fail = [];
  const txt = await fetchPageText('http://127.0.0.1:7096/');
  console.log(`1. tekst (${txt.length} zn.): ${txt.slice(0, 130)}`);
  if (!/7°C/.test(txt)) fail.push('nie wyciągnięto temperatury');
  if (/var a=1|color:red/.test(txt)) fail.push('skrypt lub styl trafił do tekstu');
  if (/komentarz/.test(txt)) fail.push('komentarz HTML nie usunięty');
  if (/<[a-z]/i.test(txt)) fail.push('zostały znaczniki');

  const bin = await fetchPageText('http://127.0.0.1:7096/binary');
  console.log(`2. plik binarny: „${bin}" (ma być pusty)`);
  if (bin) fail.push('binarny content-type nie odrzucony');

  const big = await fetchPageText('http://127.0.0.1:7096/big', 2500);
  console.log(`3. wielka strona: ${big.length} zn. (limit 2500)`);
  if (big.length > 2500) fail.push('limit długości nie zadziałał');

  const dead = await fetchPageText('http://127.0.0.1:1/nic');
  console.log(`4. strona nieosiągalna: „${dead}" (ma być pusty, bez wyjątku)`);
  if (dead) fail.push('błąd sieci nie obsłużony');

  console.log(fail.length ? '\nBŁĘDY: ' + fail.join('; ') : '\nEKSTRAKCJA TREŚCI OK');
  srv.close();
  process.exit(fail.length ? 1 : 0);
});

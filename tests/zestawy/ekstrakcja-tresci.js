// Atrapy stron stoją na 127.0.0.1 — jawnie zaufane (lib/pobieranie.js blokuje sieć prywatną).
process.env.POBIERANIE_ZAUFANE = '127.0.0.1,localhost';
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
  } else if (req.url === '/portal') {
    // Typowy portal: nagłówek, menu i baner cookies PRZED treścią. Przy
    // limicie 2500 znaków sama nawigacja wypierała właściwą liczbę.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body><header>' + 'Portal Kategoria numer 0 '.repeat(60) + '</header>'
      + '<nav>' + 'Sport Pogoda Kultura '.repeat(60) + '</nav>'
      + '<div class="cookies"><form><button>Akceptuję wszystkie cookies</button></form></div>'
      + '<main><h1>Prognoza Kraków</h1><p>Jutro w Krakowie 7°C i zachmurzenie.</p>'
      + '<p>Szczegóły prognozy na kolejne godziny. </p>'.repeat(12) + '</main><footer>© 2026</footer></body></html>');
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

  const portal = await fetchPageText('http://127.0.0.1:7096/portal', 2500);
  console.log(`1b. portal: ${portal.slice(0, 60)}…`);
  if (!/7°C/.test(portal)) fail.push('portal: treść z <main> wyparta przez menu i nagłówek');
  if (/Portal Kategoria|Akceptuję|Sport Pogoda/.test(portal)) fail.push('portal: menu, nagłówek albo baner cookies w tekście dla modelu');

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

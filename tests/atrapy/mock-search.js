// Atrapa DuckDuckGo HTML (format zgodny z parserem Cosmosa)
const http = require('node:http');
http.createServer((req, res) => {
  const q = decodeURIComponent((req.url.match(/[?&]q=([^&]*)/) || [,''])[1]);
  console.log('SEARCH:', q);
  res.writeHead(200, {'Content-Type':'text/html'});
  res.end(`<html><body>
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.gsmarena.com%2Fsamsung_galaxy_s24-12773.php&rut=x">Samsung Galaxy S24 - Full phone specifications</a>
    <a class="result__snippet" href="#">Samsung Galaxy S24 <b>specyfikacja</b>: 6.2&quot; AMOLED 120Hz, Exynos 2400, 8GB RAM, aparat 50MP.</a>
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.samsung.com%2Fpl%2Fsmartphones%2Fgalaxy-s24%2F&rut=y">Galaxy S24 | Samsung Polska</a>
    <a class="result__snippet" href="#">Oficjalna strona Galaxy S24 &#x27;AI Phone&#x27; - ceny od 3799 z&#322;.</a>
  </body></html>`);
}).listen(9097, () => console.log('mock search on 9097'));

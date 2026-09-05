// Cała ścieżka /api/search na podstawionej wyszukiwarce: reklamy odpadają,
// zostają prawdziwe wyniki, treść stron się dokleja.
const http = require('http');
const KORZEN = require('node:path').resolve(__dirname, '..', '..');

const page = (t) => `<html><body><h1>${t}</h1><p>Temperatura teraz: 7&deg;C.</p></body></html>`;
const ddg = `<html><body>
 <a class="result__a" href="//duckduckgo.com/y.js?ad_domain=booking.com&amp;click_metadata=x">Booking — REKLAMA</a>
 <a class="result__snippet" href="#">Rezerwuj tanio</a>
 <a class="result__a" href="//duckduckgo.com/l/?uddg=http%3A%2F%2F127.0.0.1%3A7094%2Fimgw&amp;rut=1">IMGW Warszawa</a>
 <a class="result__snippet" href="#">Serwis pogodowy IMGW</a>
 <a class="result__a" href="//duckduckgo.com/y.js?ad_domain=itaka.pl">Itaka — REKLAMA</a>
 <a class="result__snippet" href="#">Wycieczki</a>
 <a class="result__a" href="http://127.0.0.1:7094/radar">Radary24</a>
 <a class="result__snippet" href="#">Radar temperatury</a>
 <a class="result__a" href="//duckduckgo.com/l/?uddg=http%3A%2F%2F127.0.0.1%3A7094%2Fradar">Radary24 znowu</a>
 <a class="result__snippet" href="#">Duplikat</a>
</body></html>`;

const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(ddg);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page(req.url));
  }
});

srv.listen(7094, async () => {
  const { spawn } = require('child_process');
  const srvProc = spawn('node', ['server.js'], {
    cwd: KORZEN,
    env: { ...process.env, PORT: '3010', SEARCH_URL: 'http://127.0.0.1:7094/html', NVIDIA_API_KEY: 'test' },
    stdio: 'ignore', detached: true,
  });
  await new Promise((r) => setTimeout(r, 4000));
  const fail = [];
  try {
    const d = await (await fetch('http://127.0.0.1:3010/api/search?q=pogoda')).json();
    console.log(`  wyników: ${d.results.length}`);
    for (const r of d.results) {
      console.log(`   • ${r.title.padEnd(18)} ${r.url}`);
      console.log(`     treść: ${r.text ? r.text.slice(0, 46) + '…' : '(brak)'}`);
    }
    if (d.results.some((r) => /duckduckgo\.com/.test(r.url))) fail.push('reklama przeszła do wyników');
    if (d.results.some((r) => /REKLAMA/.test(r.title))) fail.push('pozycja reklamowa w wynikach');
    if (d.results.length !== 2) fail.push(`oczekiwano 2 unikalnych wyników, jest ${d.results.length}`);
    if (!d.results.every((r) => r.text)) fail.push('brak treści strony przy wyniku');
    if (!d.results.some((r) => /7°C/.test(r.text || ''))) fail.push('encja &deg; nierozwinięta');
  } catch (e) {
    fail.push('zapytanie padło: ' + e.message);
  }
  try { process.kill(-srvProc.pid); } catch { /* już nie żyje */ }
  srv.close();
  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nWYSZUKIWANIE OD KOŃCA DO KOŃCA OK');
  process.exit(fail.length ? 1 : 0);
});

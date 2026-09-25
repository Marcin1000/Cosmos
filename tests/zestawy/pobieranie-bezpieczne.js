/* Bezpieczne pobieranie stron (lib/pobieranie.js).
 *
 * Luka, którą to zamyka: `/api/kb/link` pobierał dowolny adres podany przez
 * użytkownika, a odkąd są konta, użytkownikiem bywa zaproszony gość. Mógł
 * kazać serwerowi zajrzeć do 127.0.0.1 (zmysły, SearXNG), do metadanych chmury
 * albo przez Tailscale do komputera domowego — i przeczytać wynik w swojej
 * bazie wiedzy. Sprawdzamy gwarancje, nie brzmienie:
 *   1. prywatne adresy (IPv4, IPv6, zmapowane, CGNAT/Tailscale) — odrzucone,
 *   2. przekierowanie z „publicznego" adresu na prywatny — odrzucone,
 *   3. właściciel (pozwolPrywatne) — przepuszczony,
 *   4. limit bajtów działa, a strona w windows-1250 wychodzi z ogonkami. */
const http = require('node:http');
const { pobierzStrone, prywatnyAdres, ZablokowanyAdres } = require('../../lib/pobieranie.js');

const problemy = [];
const ok = (w, opis) => { console.log(`${w ? 'OK ' : 'ZLE'} ${opis}`); if (!w) problemy.push(opis); };

(async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '100.101.102.103', '169.254.169.254', '192.168.1.1', '172.20.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) {
    ok(prywatnyAdres(ip), `prywatny: ${ip}`);
  }
  for (const ip of ['8.8.8.8', '151.101.1.69', '2a00:1450:4001::1']) ok(!prywatnyAdres(ip), `publiczny: ${ip}`);

  const srv = http.createServer((req, res) => {
    if (req.url === '/przekieruj') { res.writeHead(302, { Location: 'http://127.0.0.1:1/tajne' }); return res.end(); }
    if (req.url === '/duza') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('x'.repeat(50000)); }
    if (req.url === '/cp1250') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=windows-1250' });
      return res.end(Buffer.from([0xaf, 0xf3, 0xb3, 0xe6]));   // „Żółć" w cp1250
    }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<title>wnętrze</title>tajne');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${srv.address().port}`;

  let blad = null;
  try { await pobierzStrone(`${A}/`); } catch (e) { blad = e; }
  ok(blad instanceof ZablokowanyAdres, 'gość: http://127.0.0.1 — zablokowane');
  blad = null;
  try { await pobierzStrone('http://localhost:1/'); } catch (e) { blad = e; }
  ok(blad instanceof ZablokowanyAdres, 'gość: localhost (przez DNS) — zablokowane w chwili łączenia');
  blad = null;
  try { await pobierzStrone('file:///etc/passwd'); } catch (e) { blad = e; }
  ok(blad instanceof ZablokowanyAdres, 'schemat file:// — zablokowany');

  const w = await pobierzStrone(`${A}/`, { pozwolPrywatne: true });
  ok(w.status === 200 && /tajne/.test(w.tekst), 'właściciel: adres prywatny przepuszczony');
  blad = null;
  try { await pobierzStrone(`${A}/przekieruj`, { pozwolPrywatne: true, maksPrzekierowan: 0 }); } catch (e) { blad = e; }
  ok(blad instanceof ZablokowanyAdres, 'przekierowania liczone i ograniczane');
  const d = await pobierzStrone(`${A}/duza`, { pozwolPrywatne: true, maxBajtow: 1000 });
  ok(d.tekst.length === 1000, `limit bajtów (${d.tekst.length})`);
  const c = await pobierzStrone(`${A}/cp1250`, { pozwolPrywatne: true });
  ok(c.tekst === 'Żółć', `windows-1250 → „${c.tekst}"`);

  srv.close();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nPOBIERANIE BEZPIECZNE OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

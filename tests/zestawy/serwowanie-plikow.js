/* Pliki statyczne (server.js, serveStatic): pamięć podręczna, kompresja, zepsute adresy.
 *   1. „no-cache" + ETag → drugie pobranie to 304 bez treści (było: zawsze całe 120 kB),
 *   2. kompresja br/gzip dla tekstu, gdy przeglądarka o nią prosi — i treść po
 *      rozpakowaniu jest ta sama,
 *   3. „/%E0" to 400, nie 500; ścieżka poza public/ — 403 albo 404, nigdy plik,
 *   4. robots.txt i sitemap.xml z właściwym typem. */
const zlib = require('node:zlib');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3488;
const S = `http://127.0.0.1:${PORT}`;
const problemy = [];
const ok = (w, opis) => { console.log(`${w ? 'OK ' : 'ZLE'} ${opis}`); if (!w) problemy.push(opis); };
const http = require('node:http');
// fetch sam rozpakowuje — tu chcemy widzieć surowe bajty i nagłówki
const pobierz = (sciezka, naglowki = {}) => new Promise((ok_, zle) => {
  http.get(`${S}${sciezka}`, { headers: naglowki }, (r) => {
    const k = []; r.on('data', (c) => k.push(c)); r.on('end', () => ok_({ status: r.statusCode, h: r.headers, cialo: Buffer.concat(k) }));
  }).on('error', zle);
});

(async () => {
  const srv = serwerCosmosa(PORT, { SENSES_URL: 'http://127.0.0.1:1' });
  if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer nie wstał');

  const a = await pobierz('/app.js');
  ok(a.status === 200 && a.h.etag, `app.js ma ETag (${a.h.etag})`);
  const b = await pobierz('/app.js', { 'If-None-Match': a.h.etag });
  ok(b.status === 304 && b.cialo.length === 0, `drugie pobranie → 304 bez treści (${b.status}, ${b.cialo.length} B)`);

  const br = await pobierz('/app.js', { 'Accept-Encoding': 'br' });
  ok(br.h['content-encoding'] === 'br' && br.cialo.length < a.cialo.length / 2, `br: ${a.cialo.length} → ${br.cialo.length} B`);
  ok(zlib.brotliDecompressSync(br.cialo).equals(a.cialo), 'br: po rozpakowaniu ta sama treść');
  const gz = await pobierz('/', { 'Accept-Encoding': 'gzip' });
  ok(gz.h['content-encoding'] === 'gzip' && /<html/i.test(zlib.gunzipSync(gz.cialo).toString()), 'gzip dla strony produktowej');
  const png = await pobierz('/icons/cosmos-192.png', { 'Accept-Encoding': 'br' });
  ok(!png.h['content-encoding'], 'obrazów nie kompresujemy');

  ok((await pobierz('/%E0')).status === 400, 'zepsuty adres → 400');
  const poza = await pobierz('/..%2F..%2Fpackage.json');
  ok(poza.status === 403 || poza.status === 404, `ścieżka poza public/ → ${poza.status}`);

  const rob = await pobierz('/robots.txt');
  ok(rob.status === 200 && /text\/plain/.test(rob.h['content-type']), `robots.txt: ${rob.h['content-type']}`);
  const map = await pobierz('/sitemap.xml');
  ok(map.status === 200 && /xml/.test(map.h['content-type']), `sitemap.xml: ${map.h['content-type']}`);

  zabij(srv);
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nSERWOWANIE PLIKÓW OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

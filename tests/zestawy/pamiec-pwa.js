/* Wersja pamięci PWA liczy się z treści plików, a nie z pamięci człowieka.
 *
 * Zespół IT, runda 8: po zmianie czegokolwiek z listy STATIC_ASSETS trzeba było
 * ręcznie podnieść `cosmos-vNN` w public/sw.js. 10 z 30 commitów tego nie
 * zrobiło – telefon Marcina dostawał wtedy nowy kod dopiero przy DRUGIM
 * otwarciu, bez paska „Jest nowa wersja”, a przez jedno otwarcie mógł chodzić
 * stary index.html z nowym app.js. Teraz serwer dopisuje do nazwy skrót treści:
 *   1. ta sama treść → ta sama nazwa (bez zbędnych aktualizacji),
 *   2. zmiana jednego bajtu w pliku z listy → inna nazwa (nowy service worker),
 *   3. zmiana pliku SPOZA listy → nazwa bez zmian,
 *   4. prawdziwy public/sw.js: każdy plik z listy istnieje (brakujący plik
 *      wywracałby instalację service workera – cache.addAll pada w całości),
 *   5. /api/config dostaje commit i nazwę pamięci do linii wersji w Ustawieniach.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { utworz } = require('../../lib/statyka.js');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

function serwer(PUBLIC_DIR) {
  const st = utworz({ PUBLIC_DIR });
  const s = http.createServer((req, res) => st.serveStatic(req, res));
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, st, adres: `http://127.0.0.1:${s.address().port}` })));
}
const nazwa = async (adres) => {
  const t = await (await fetch(`${adres}/sw.js`)).text();
  return (/const CACHE = '([^']+)'/.exec(t) || [])[1] || '';
};

(async () => {
  // --- 1–3. katalog tymczasowy z małą listą
  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-pwa-'));
  fs.writeFileSync(path.join(kat, 'sw.js'), "const CACHE = 'cosmos-v7';\nconst STATIC_ASSETS = [\n  '/app',\n  '/a.js',\n];\n");
  fs.writeFileSync(path.join(kat, 'index.html'), '<!doctype html><title>x</title>');
  fs.writeFileSync(path.join(kat, 'a.js'), 'console.log(1);');
  fs.writeFileSync(path.join(kat, 'inny.txt'), 'poza listą');
  const { s, adres } = await serwer(kat);
  const n1 = await nazwa(adres);
  const n2 = await nazwa(adres);
  ok(/^cosmos-v7-[0-9a-f]{10}$/.test(n1), `nazwa = ręczna wersja + skrót treści (${n1})`);
  ok(n1 === n2, '1. ta sama treść → ta sama nazwa');
  fs.writeFileSync(path.join(kat, 'a.js'), 'console.log(2);');
  const n3 = await nazwa(adres);
  ok(n3 && n3 !== n1, `2. zmiana bajtu w a.js → nowa nazwa (${n3})`);
  fs.writeFileSync(path.join(kat, 'inny.txt'), 'dalej poza listą, ale inaczej');
  const n4 = await nazwa(adres);
  ok(n4 === n3, '3. zmiana pliku spoza listy nie zmienia nazwy');
  fs.writeFileSync(path.join(kat, 'index.html'), '<!doctype html><title>nowy</title>');
  ok((await nazwa(adres)) !== n4, '2. zmiana index.html (pod /app) też zmienia nazwę');
  s.close();
  fs.rmSync(kat, { recursive: true, force: true });

  // --- 4–5. prawdziwy katalog public/
  const PUBLIC = path.join(__dirname, '..', '..', 'public');
  const tekst = fs.readFileSync(path.join(PUBLIC, 'sw.js'), 'utf8');
  const lista = [...((/const STATIC_ASSETS = \[([\s\S]*?)\];/.exec(tekst) || [])[1] || '').matchAll(/'([^']+)'/g)].map(([, a]) => a);
  const brak = lista.filter((a) => !fs.existsSync(path.join(PUBLIC, a === '/app' ? 'index.html' : a)));
  ok(lista.length > 10 && !brak.length, `4. każdy plik z STATIC_ASSETS istnieje (${lista.length}${brak.length ? `, brak: ${brak.join(', ')}` : ''})`);
  const { s: s2, st, adres: a2 } = await serwer(PUBLIC);
  const prawdziwa = await nazwa(a2);
  const reczna = (/const CACHE = '([^']+)'/.exec(tekst) || [])[1];
  ok(prawdziwa.startsWith(`${reczna}-`), `serwer podaje ${prawdziwa}`);
  const w = st.wersja();
  ok(w.pamiec === prawdziwa, `5. wersja() zna tę samą nazwę pamięci (${w.pamiec})`);
  ok(fs.existsSync(path.join(PUBLIC, '..', '.git')) ? /^[0-9a-f]{7}$/.test(w.commit) : w.commit === '', `5. commit z repozytorium (${w.commit || 'brak .git'})`);
  s2.close();

  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nPAMIĘĆ PWA OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

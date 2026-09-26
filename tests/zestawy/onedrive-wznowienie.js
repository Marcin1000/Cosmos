/* Indeksowanie OneDrive wznawia się po restarcie serwera, zamiast zaczynać
   od korzenia.

   Przejście po 2 TB to godziny i dziesiątki tysięcy zapytań do Graph.
   Restart w połowie (aktualizacja, awaria prądu) kasował kolejkę folderów
   z pamięci — następne indeksowanie szło od nowa po tych samych folderach.

   Co musi być prawdą:
     1. Serwer zabity w połowie (SIGKILL — bez porządnego zamknięcia) po
        starcie sam dokańcza indeksowanie: foldery już przejrzane NIE są
        pytane drugi raz, brakujące są, archiwum ma komplet.
     2. Wpisy z przejrzanych folderów przetrwały zabicie (kolejka nie obiecuje
        folderów, których wpisów nie ma na dysku).
     3. Po skończeniu kolejka znika z dysku; status mówi, że to wznowienie.
     4. Przerwanie przez człowieka (Przerwij) kasuje kolejkę — następne
        indeksowanie zaczyna od początku, bo tak zdecydował. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { serwerCosmosa, uruchom, czekajNa, katalogOsoby, KORZEN } = require('../pomoc');

const PORT = 3496;
const ADRES = `http://127.0.0.1:${PORT}`;
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));
async function az(warunek, ms = 15000) {
  const koniec = Date.now() + ms;
  while (Date.now() < koniec) { if (await warunek()) return true; await czekaj(100); }
  return Boolean(await warunek());
}

// --- atrapa Microsoft Graph: cztery foldery po jednym zdjęciu -----------------
const FOLDERY = ['a', 'b', 'c', 'd'];
const pytania = new Map();          // ścieżka → ile razy pytana
const zablokowane = new Map();      // ścieżka → lista wstrzymanych odpowiedzi
const blokuj = new Set();
const graph = http.createServer((req, res) => {
  const sciezka = new URL(req.url, 'http://x').pathname.replace(/^\/graph/, '');
  pytania.set(sciezka, (pytania.get(sciezka) || 0) + 1);
  const odpowiedz = () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (sciezka === '/me/drive/root/children') {
      return res.end(JSON.stringify({ value: FOLDERY.map((f) => ({ id: `f${f}`, name: `Folder ${f}`, folder: { childCount: 1 } })) }));
    }
    const m = sciezka.match(/^\/me\/drive\/items\/f(\w)\/children$/);
    if (m) {
      return res.end(JSON.stringify({ value: [{
        id: `p${m[1]}`, name: `IMG_${m[1]}.jpg`, size: 5_000_000,
        parentReference: { path: `/drive/root:/Folder ${m[1]}` },
        image: { width: 6000, height: 4000 }, photo: { takenDateTime: '2026-06-14T20:40:00Z' },
      }] }));
    }
    res.end('{"value":[]}');
  };
  if (blokuj.has(sciezka)) {
    if (!zablokowane.has(sciezka)) zablokowane.set(sciezka, []);
    zablokowane.get(sciezka).push(odpowiedz);
  } else odpowiedz();
});
const pusc = (sciezka) => { blokuj.delete(sciezka); for (const f of zablokowane.get(sciezka) || []) f(); zablokowane.delete(sciezka); };

const ENV = {
  ONEDRIVE_GRAPH_URL: `http://127.0.0.1:${PORT + 100}/graph`,
  COSMOS_ONEDRIVE_ZAPIS_MS: '0', COSMOS_WZNOW_ONEDRIVE_MS: '300',
  EMBED_PROVIDER: 'off', SENSES_URL: 'http://127.0.0.1:9',
};
const status = async () => (await fetch(`${ADRES}/api/onedrive/status`)).json();
const zabijTwardo = (p) => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* */ } };

(async () => {
  await new Promise((r) => graph.listen(PORT + 100, '127.0.0.1', r));

  // Katalog danych z połączonym OneDrive (token ważny — bez logowania u Microsoftu).
  const pierwszy = serwerCosmosa(PORT, ENV);
  const dane = pierwszy.katalogDanych;
  const osoba = katalogOsoby({ katalogDanych: dane });
  fs.mkdirSync(osoba, { recursive: true });
  fs.writeFileSync(path.join(osoba, 'onedrive.json'), JSON.stringify({ refresh_token: 'r', access_token: 'a', wygasa: Date.now() + 3600e3 }));
  const kolejka = path.join(osoba, 'onedrive-kolejka.json');
  if (!(await czekajNa(`${ADRES}/api/auth`))) throw new Error('serwer nie wstał');

  // --- 1–2. zabicie w połowie ------------------------------------------------------
  blokuj.add('/me/drive/items/fc/children');
  await fetch(`${ADRES}/api/onedrive/index`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const doszlo = await az(async () => zablokowane.has('/me/drive/items/fc/children') && fs.existsSync(kolejka)
    && JSON.parse(fs.readFileSync(kolejka, 'utf8')).doOdwiedzenia.length === 2);
  ok(doszlo, 'indeksowanie doszło do trzeciego folderu, kolejka zapisana na dysku');
  zabijTwardo(pierwszy);
  await czekaj(500);
  pusc('/me/drive/items/fc/children');
  pytania.clear();

  const drugi = uruchom('node', ['server.js'], {
    cwd: KORZEN,
    env: { ...process.env, PORT: String(PORT), COSMOS_DATA_DIR: dane, NVIDIA_API_KEY: 'test', ...ENV },
  });
  await czekajNa(`${ADRES}/api/auth`);
  const skonczone = await az(async () => { const s = await status(); return s.wArchiwum === 4 && s.indeksowanie && !s.indeksowanie.trwa; });
  const s = await status();
  ok(skonczone, `po restarcie indeksowanie dokończyło się samo (w archiwum ${s.wArchiwum} z 4)`);
  const ponownie = ['/me/drive/root/children', '/me/drive/items/fa/children', '/me/drive/items/fb/children'].filter((p) => pytania.get(p));
  ok(ponownie.length === 0, `przejrzane foldery nie są pytane drugi raz (${ponownie.join(', ') || 'żaden'})`);
  ok(pytania.get('/me/drive/items/fc/children') === 1 && pytania.get('/me/drive/items/fd/children') === 1, 'brakujące foldery pytane dokładnie raz');
  ok(!fs.existsSync(kolejka), 'po skończeniu kolejka znika z dysku');
  ok(s.indeksowanie && s.indeksowanie.wznowione === true, 'status mówi, że to wznowienie');

  // --- 4. przerwanie przez człowieka kasuje kolejkę -------------------------------------
  blokuj.add('/me/drive/items/fa/children');
  await fetch(`${ADRES}/api/onedrive/index`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"odNowa":true}' });
  await az(async () => zablokowane.has('/me/drive/items/fa/children') && fs.existsSync(kolejka));
  const byla = fs.existsSync(kolejka);
  await fetch(`${ADRES}/api/onedrive/index`, { method: 'DELETE' });
  pusc('/me/drive/items/fa/children');
  await az(async () => !(await status()).indeksowanie.trwa);
  ok(byla && !fs.existsSync(kolejka), 'Przerwij kasuje zapisaną kolejkę — następnym razem od początku');

  process.kill(-drugi.pid);
  graph.close();
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nONEDRIVE WZNOWIENIE OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

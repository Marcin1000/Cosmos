/* Embeddingi: skąd biorą się wektory pytania i kto może użyć zmysłów.

   Runda 4, zespół IT (modele open source) zmierzył dwie rzeczy:
     • Komputer domowy śpi, chmura działa — KAŻDA wiadomość czekała ~6,2 s,
       zanim model dostał pytanie: pamięć czekała cały budżet na zmysły,
       baza wiedzy drugi raz, a karencja po awarii była jedna na oba źródła
       i zerowana sukcesem chmury, więc nie włączała się nigdy.
     • Członek BEZ prawa do zmysłów (domowego GPU właściciela) liczył tam
       wektory swoich notatek, wpisów pamięci i każdego pytania z czatu.

   Co musi być prawdą:
     1. Po jednej nieudanej próbie zmysłów następne pytanie z rozmowy idzie od
        razu do chmury — zmysły nie dostają nic nowego, odpowiedź przychodzi
        w ułamku budżetu.
     2. Przeliczanie w tle (długi budżet) karencji nie słucha — próbuje zmysłów.
     3. To samo pytanie z jednej wiadomości (pamięć, potem baza wiedzy) liczy
        się raz.
     4. Członek bez zgody na zmysły: ani jednego żądania do zmysłów, także gdy
        działają; wektory z chmury. Członek ze zgodą i właściciel — zmysły. */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.COSMOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-embed-'));
delete process.env.EMBED_PROVIDER;
delete process.env.MEMORY_SEARCH_BUDGET_MS;

const pamiecModul = require('../../lib/pamiec.js');
const { wKontekscie } = require('../../lib/kontekst.js');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

const WYMIAR = 64;
const wektor = () => Array.from({ length: WYMIAR }, (_, i) => (i === 0 ? 1 : 0.001));
const nasluch = (serwer) => new Promise((r) => serwer.listen(0, '127.0.0.1', () => r(serwer.address().port)));

(async () => {
  // Zmysły, które można „uśpić": wtedy przyjmują połączenie i milczą jak węzeł za Tailscale.
  let zmyslySpia = true;
  let doZmyslow = 0;
  const wiszace = new Set();
  const zmysly = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      doZmyslow++;
      if (zmyslySpia) { wiszace.add(res); return; }
      const n = (JSON.parse(b).texts || []).length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ vectors: Array.from({ length: n }, wektor) }));
    });
  });
  let doChmury = 0;
  const chmura = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      doChmury++;
      const n = (JSON.parse(b).input || []).length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: Array.from({ length: n }, (_, index) => ({ index, embedding: wektor() })) }));
    });
  });
  const portZmyslow = await nasluch(zmysly);
  const portChmury = await nasluch(chmura);

  const nowaPamiec = (nazwa) => pamiecModul.utworz({
    katalogDanych: fs.mkdtempSync(path.join(os.tmpdir(), `cosmos-embed-${nazwa}-`)),
    sensesUrl: `http://127.0.0.1:${portZmyslow}`,
    chmura: () => ({ apiKey: 'test', baseUrl: `http://127.0.0.1:${portChmury}/v1` }),
    sendJson: () => {}, readJson: async () => ({}),
  });
  const wlasciciel = { id: 'wlasciciel', rola: 'wlasciciel' };

  // --- 1. śpiący dom: jedna próba, potem od razu chmura --------------------------------
  const p = nowaPamiec('dom-spi');
  let t0 = Date.now();
  const pierwsze = await wKontekscie(wlasciciel, () => p.embedTexts(['Jaka jest pogoda?'], 1200, 'query'));
  const czasPierwszego = Date.now() - t0;
  ok(pierwsze && /^nvidia:/.test(pierwsze.model) && doZmyslow === 1,
    `pierwsze pytanie: zmysły milczą, wektor z chmury (${czasPierwszego} ms)`);

  t0 = Date.now();
  const drugie = await wKontekscie(wlasciciel, () => p.embedTexts(['Co mam jutro w planie?'], 1200, 'query'));
  const czasDrugiego = Date.now() - t0;
  ok(drugie && /^nvidia:/.test(drugie.model) && doZmyslow === 1,
    'następne pytanie z rozmowy pomija śpiące zmysły (karencja osobno dla każdego źródła)');
  ok(czasDrugiego < 500, `następne pytanie bez czekania na zmysły (${czasDrugiego} ms, budżet 1200 ms)`);

  // --- 2. praca w tle próbuje zmysłów mimo karencji ---------------------------------------
  zmyslySpia = false;
  const wTle = await wKontekscie(wlasciciel, () => p.embedTexts(['fakt do przeliczenia'], 60000, 'passage'));
  ok(wTle && /^senses:/.test(wTle.model) && doZmyslow === 2, 'przeliczanie w tle próbuje zmysłów mimo karencji');

  // --- 3. to samo pytanie liczy się raz ------------------------------------------------------
  const chmuraPrzed = doChmury;
  const q = nowaPamiec('raz');
  const zmyslyPrzed = doZmyslow;
  const a = await wKontekscie(wlasciciel, () => q.embedTexts(['Który obiektyw na klify?'], 1200, 'query'));
  const b = await wKontekscie(wlasciciel, () => q.embedTexts(['Który obiektyw na klify?'], 1200, 'query'));
  ok(a && b && a.vectors[0] === b.vectors[0] && doZmyslow - zmyslyPrzed === 1 && doChmury === chmuraPrzed,
    'pamięć i baza wiedzy pytają o to samo zdanie — liczy się raz');

  // --- 4. zgoda na zmysły ------------------------------------------------------------------------
  const ania = { id: 'ania', rola: 'czlonek', silniki: { local: false } };
  const pa = nowaPamiec('ania');
  const zmyslyAni = doZmyslow;
  const notatka = await wKontekscie(ania, () => pa.embedTexts(['Prywatne: numer PESEL i adres.'], 60000, 'passage'));
  const pytanie = await wKontekscie(ania, () => pa.embedTexts(['Co zapisałam o szkole?'], 1200, 'query'));
  ok(doZmyslow === zmyslyAni, 'członek bez zgody: zero żądań do zmysłów właściciela (notatka i pytanie)');
  ok(notatka && /^nvidia:/.test(notatka.model) && pytanie && /^nvidia:/.test(pytanie.model),
    'członek bez zgody dostaje wektory z chmury');

  const basia = { id: 'basia', rola: 'czlonek', silniki: { local: true } };
  const pb = nowaPamiec('basia');
  const zBasia = await wKontekscie(basia, () => pb.embedTexts(['Notatka Basi'], 60000, 'passage'));
  ok(zBasia && /^senses:/.test(zBasia.model), 'członek ze zgodą na lokalny GPU liczy na zmysłach');

  for (const res of wiszace) res.destroy();
  zmysly.close(); chmura.close();
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nEMBEDDINGI OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

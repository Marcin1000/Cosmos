/* Wektory pamięci trzymane per model — przejście między dostawcami
   embeddingów nie przelicza wszystkiego od nowa.

   Cosmos ma dwóch dostawców: zmysły w domu (bge-m3) i chmurę NVIDII. Wpis
   trzymał jeden wektor, więc każde uśpienie i obudzenie komputera domowego
   przepisywało całą pamięć na drugi model, a po powrocie z powrotem. Przez
   ten czas pamięć szukała po słowach kluczowych, a chmura liczyła to samo
   drugi raz.

   Co musi być prawdą:
     1. Po przejściu zmysły → chmura → zmysły powrót nie liczy ani jednego
        wpisu od nowa (zmysły dostają tylko pytanie).
     2. Pierwsze pytanie po powrocie trafia WEKTOROWO — pytanie bez wspólnych
        słów z faktem i tak go znajduje.
     3. Chmura też nie liczy drugi raz, gdy wróci ponownie.
     4. Stary kształt wpisu (`embedding` + `embModel`) działa i nie ginie
        przy dopisaniu wektora z drugiego modelu; modeli najwyżej MAKS_MODELI. */
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pamiecModul = require('../../lib/pamiec.js');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

const FAKTY = [
  'Mój korpus to Canon R6, obiektyw 24-105 f/4.',
  'Mieszkam w Piasecznie pod Warszawą.',
  'Nie lubię kolendry.',
];
/* Wektor „tematu": aparat/foto → oś 0, miejsce → oś 1, jedzenie → oś 2.
   Pytanie „czym fotografuję?" nie ma z faktem ani jednego wspólnego słowa
   dłuższego niż 3 litery, więc trafić może je tylko wektor. */
function wektor(tekst, wymiar) {
  const v = new Array(wymiar).fill(0.001);
  const t = tekst.toLowerCase();
  if (/canon|fotograf|aparat/.test(t)) v[0] = 1;
  if (/piasecz|mieszka|warszaw/.test(t)) v[1] = 1;
  if (/kolendr|jedz/.test(t)) v[2] = 1;
  return v;
}

const liczone = { zmysly: 0, chmura: 0 };   // ile FAKTÓW (nie pytań) policzono
let pytaniaDoZmyslow = 0;
let zmyslyDzialaja = true;

function atrapa(nazwa, obsluz) {
  return http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => obsluz(JSON.parse(b || '{}'), res));
  });
}
const zmysly = atrapa('zmysly', (d, res) => {
  if (!zmyslyDzialaja) { res.writeHead(503); return res.end(); }
  const teksty = d.texts || [];
  liczone.zmysly += teksty.filter((x) => FAKTY.includes(x)).length;
  pytaniaDoZmyslow += teksty.filter((x) => !FAKTY.includes(x)).length;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ vectors: teksty.map((x) => wektor(x, 64)) }));
});
const chmura = atrapa('chmura', (d, res) => {
  const teksty = d.input || [];
  liczone.chmura += teksty.filter((x) => FAKTY.includes(x)).length;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: teksty.map((x, index) => ({ index, embedding: wektor(x, 96) })) }));
});

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));
async function az(warunek, ms = 3000) {
  const koniec = Date.now() + ms;
  while (Date.now() < koniec) { if (warunek()) return true; await czekaj(20); }
  return warunek();
}

(async () => {
  await new Promise((r) => zmysly.listen(0, '127.0.0.1', r));
  await new Promise((r) => chmura.listen(0, '127.0.0.1', r));
  const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-wektory-'));
  delete process.env.EMBED_PROVIDER;   // auto: najpierw zmysły, potem chmura
  const nowa = () => pamiecModul.utworz({
    katalogDanych: katalog,
    sensesUrl: `http://127.0.0.1:${zmysly.address().port}`,
    chmura: () => ({ apiKey: 'test', baseUrl: `http://127.0.0.1:${chmura.address().port}/v1` }),
    sendJson: () => {}, readJson: async () => ({}),
  });
  let p = nowa();
  p.ustawListe(FAKTY.map((text, i) => ({ id: `f${i}`, text, time: Date.now() })));
  const lista = () => p.lista();
  const wszystkieMaja = (model) => lista().every((m) => pamiecModul.sameModel(m, model));

  // --- zmysły liczą pamięć -----------------------------------------------------
  await p.searchMemory('czym fotografuję?');
  ok(await az(() => wszystkieMaja('senses:64')), 'zmysły policzyły wektory całej pamięci');

  // --- zmysły zasypiają: chmura dolicza SWOJE, nie kasując zmysłowych ------------
  /* Każdy krok pyta innym zdaniem: to samo zdanie w ciągu kilkunastu sekund
     bierze wektor zapamiętany przy poprzednim pytaniu (lib/pamiec.js — pamięć
     i baza wiedzy pytają o nie jedna po drugiej), więc nie sprawdzałoby zmiany źródła. */
  zmyslyDzialaja = false;
  await p.searchMemory('czym fotografuję w górach?');
  ok(await az(() => wszystkieMaja('nvidia:nvidia/llama-nemotron-embed-1b-v2')), 'chmura policzyła wektory, gdy zmysły spały');
  ok(wszystkieMaja('senses:64'), 'wektory zmysłów zostały obok wektorów chmury');

  // --- zmysły wracają: nic do przeliczenia, trafienie od razu wektorem --------------
  /* Po awarii zmysły mają minutę karencji — rozmowa idzie wtedy od razu do
     chmury (lib/pamiec.js). Powrót po karencji udaje świeża instancja na tym
     samym katalogu: czyta z pliku wektory obu modeli, karencji nie zna. */
  await az(() => {
    try { return JSON.parse(fs.readFileSync(path.join(katalog, 'memory.json'), 'utf8')).every((m) => m.wektory && Object.keys(m.wektory).length === 2); } catch { return false; }
  });
  p = nowa();
  zmyslyDzialaja = true;
  const przed = liczone.zmysly;
  const pytaniaPrzed = pytaniaDoZmyslow;
  const wynik = await p.searchMemory('czym fotografuję nad morzem?');
  await czekaj(300);   // gdyby coś ruszyło w tle — niech zdąży się policzyć
  ok(pytaniaDoZmyslow > pytaniaPrzed, 'pytanie po powrocie liczą zmysły');
  ok(liczone.zmysly === przed, `powrót zmysłów nie przelicza pamięci (policzono ${liczone.zmysly - przed} faktów)`);
  ok(wynik.length >= 1 && /Canon/.test(wynik[0].text), `pierwsze pytanie po powrocie trafia wektorem („${(wynik[0] || {}).text || 'nic'}")`);

  // --- i chmura też nie liczy drugi raz ----------------------------------------------
  zmyslyDzialaja = false;
  const przedChmura = liczone.chmura;
  const wynik2 = await p.searchMemory('czym fotografuję zimą?');
  await czekaj(300);
  ok(liczone.chmura === przedChmura && wynik2.length >= 1 && /Canon/.test(wynik2[0].text),
    `ponowne przejście na chmurę: zero przeliczeń, trafienie wektorem (policzono ${liczone.chmura - przedChmura})`);

  // --- na dysku zostają oba ------------------------------------------------------------
  const zDysku = JSON.parse(fs.readFileSync(path.join(katalog, 'memory.json'), 'utf8'));
  ok(zDysku.every((m) => m.wektory && Object.keys(m.wektory).length === 2), 'plik pamięci trzyma wektory obu modeli');

  // --- stary kształt i sufit liczby modeli ------------------------------------------------
  const stary = { text: 'x', embedding: [1, 2, 3], embModel: 'A' };
  ok(pamiecModul.sameModel(stary, 'A') && !pamiecModul.sameModel(stary, 'B'), 'stary kształt wpisu dalej działa');
  pamiecModul.ustawWektor(stary, 'B', [4, 5, 6]);
  ok(pamiecModul.wektorDla(stary, 'A')?.[0] === 1 && pamiecModul.wektorDla(stary, 'B')?.[0] === 4 && !('embedding' in stary),
    'dopisanie drugiego modelu przenosi stary wektor, nie gubi go');
  pamiecModul.ustawWektor(stary, 'C', [7]);
  ok(Object.keys(stary.wektory).join(',') === 'B,C', `najwyżej ${pamiecModul.MAKS_MODELI} modele, najdawniejszy wypada (${Object.keys(stary.wektory)})`);

  // --- zapis zwarty: napis f32 zamiast tablicy liczb -------------------------------------
  /* Tablica liczb w JSON-ie to ~18 znaków na liczbę: przy dwóch modelach indeks
     bazy wiedzy ważył 110 MB, a jego zapis (JSON.stringify w pętli zdarzeń)
     stawiał serwer wszystkim na 2–3 s. */
  const losowy = (n) => Array.from({ length: n }, () => Math.random() * 2 - 1);
  const zs = losowy(1024), ch = losowy(2048);
  const zwarty = { text: 'fragment' };
  pamiecModul.ustawWektor(zwarty, 'senses:1024', zs);
  pamiecModul.ustawWektor(zwarty, 'nvidia:x', ch);
  const tablicowy = { text: 'fragment', wektory: { 'senses:1024': zs, 'nvidia:x': ch } };
  const rozmiar = (o) => JSON.stringify(o).length;
  ok(rozmiar(zwarty) * 3 < rozmiar(tablicowy),
    `zapis zwarty co najmniej 3× mniejszy (${Math.round(rozmiar(zwarty) / 1024)} KB zamiast ${Math.round(rozmiar(tablicowy) / 1024)} KB)`);
  const odczyt = pamiecModul.wektorDla(zwarty, 'nvidia:x');
  ok(odczyt && odczyt.length === 2048 && odczyt.every((x, i) => Math.abs(x - ch[i]) < 1e-6), 'odczyt oddaje te same liczby (precyzja float32)');
  const zapytanie = losowy(2048);
  ok(Math.abs(pamiecModul.cosine(zapytanie, odczyt) - pamiecModul.cosine(zapytanie, ch)) < 1e-6, 'cosinus taki sam jak na tablicy');
  ok(pamiecModul.wektorDla(zwarty, 'nvidia:x') === odczyt, 'drugi odczyt bez dekodowania od nowa');
  const nowy = losowy(2048);
  pamiecModul.ustawWektor(zwarty, 'nvidia:x', nowy);
  ok(Math.abs(pamiecModul.wektorDla(zwarty, 'nvidia:x')[0] - nowy[0]) < 1e-6, 'nowy wektor tego modelu unieważnia odczyt z pamięci');
  const poDrodze = JSON.parse(JSON.stringify(zwarty));
  ok(pamiecModul.wektorDla(poDrodze, 'senses:1024')?.length === 1024 && pamiecModul.maWektor(poDrodze), 'wektor przeżywa zapis i odczyt pliku');

  // Pliki sprzed zmiany: tablice czytamy wprost, a kompaktujWektory zamienia je przy wczytaniu.
  const plik = [
    { text: 'nowy kształt', wektory: { A: [0.5, 0.25] } },
    { text: 'stary kształt', embedding: [1, 2], embModel: 'B' },
    { name: 'dokument', chunks: [{ text: 'fragment', wektory: { A: [0.75, 1] } }] },
  ];
  ok(pamiecModul.wektorDla(plik[0], 'A')?.[1] === 0.25, 'tablica sprzed zmiany czytana wprost');
  pamiecModul.kompaktujWektory(plik);
  ok(typeof plik[0].wektory.A === 'string' && typeof plik[2].chunks[0].wektory.A === 'string' && typeof plik[1].wektory.B === 'string'
    && !('embedding' in plik[1]), 'kompaktowanie zamienia tablice (także fragmenty i stary kształt)');
  ok(pamiecModul.wektorDla(plik[0], 'A')?.[1] === 0.25 && pamiecModul.wektorDla(plik[1], 'B')?.[1] === 2
    && pamiecModul.wektorDla(plik[2].chunks[0], 'A')?.[0] === 0.75, 'po kompaktowaniu te same wartości');

  zmysly.close(); chmura.close();
  fs.rmSync(katalog, { recursive: true, force: true });
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nWEKTORY PER MODEL OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

/* „Cala d'Or, Hotel Barceló Ponent Beach" — czyli jak człowiek nazywa miejsce.

   Marcin poprosił o plan zdjęciowy na tygodniową Majorkę i podał hotel razem
   z miejscowością. Geokoder nie zna nazw hoteli, więc na całą frazę nie oddał
   nic, plan policzył się dla zapisanej lokalizacji pod Warszawą, a model
   DWA RAZY poprosił o lokalizację, którą już dostał. Zapis rozmowy kończy się
   zdaniem „Proszę więc o podanie dokładnej lokalizacji na Majorkę" — po tym,
   jak użytkownik podał ją dwukrotnie.

   Sedno nie jest w geokoderze, tylko w założeniu: człowiek pisze miejsce tak,
   jak je nazywa, a nie tak, jak indeksuje je baza. Dokleja hotel, plażę,
   nazwę wyspy, w dowolnej kolejności. Jedna próba na całą frazę zakłada, że
   trafi za pierwszym razem — a nie trafia.

   Zestaw sprawdza więc dwie rzeczy, obie na atrapie geokodera, która zna
   WYŁĄCZNIE gołe nazwy miejscowości — dokładnie jak prawdziwy Nominatim:
     1. że fraza z doklejonym hotelem mimo to trafia,
     2. że doprecyzowanie, które POMAGA („Kraków, Polska"), nie zostaje
        zepsute przez upraszczanie.
*/
const http = require('node:http');
const path = require('node:path');

const fail = [];

/* Atrapa Nominatim. Zna cztery miejsca i tylko wtedy, gdy zapytanie jest
   DOKŁADNIE nazwą jednego z nich — tak samo bezlitośnie jak oryginał. */
const ZNANE = {
  "cala d'or": { lat: 39.3776, lon: 3.2333, display_name: "Cala d'Or, Baleary" },
  'kraków, polska': { lat: 50.0614, lon: 19.9366, display_name: 'Kraków, Polska' },
  'kraków': { lat: 50.0614, lon: 19.9366, display_name: 'Kraków' },
  'zakopane': { lat: 49.2992, lon: 19.9496, display_name: 'Zakopane' },
};

let zapytania = [];
const serwer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const q = (u.searchParams.get('q') || '').trim().toLowerCase();
  zapytania.push(q);
  const t = ZNANE[q];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(t ? [t] : []));
});

(async () => {
  await new Promise((r) => serwer.listen(0, '127.0.0.1', r));
  const port = serwer.address().port;
  process.env.GEOCODE_SEARCH_URL = `http://127.0.0.1:${port}/szukaj`;
  // Bez ograniczenia do kraju — inaczej każda próba to dwa zapytania i zestaw
  // mierzyłby przy okazji logikę „najpierw Polska", która ma własne miejsce.
  process.env.GEOCODE_COUNTRY = '';
  /* Odstępu 1,1 s między zapytaniami NIE da się tu wyłączyć i tak ma być:
     to wymóg Nominatim wpisany na stałe. Zestaw trwa przez to kilka sekund
     i pokazuje przy okazji prawdziwą cenę upraszczania — każda dodatkowa
     kandydatura to sekunda czekania użytkownika. Dlatego jest ich trzy,
     a nie „wszystkie możliwe". */

  const { wspolrzedneMiejsca } = require(path.join(__dirname, '..', '..', 'lib', 'miejsca.js'));

  const PRZYPADKI = [
    // [co wpisał człowiek, oczekiwana szerokość albo null, opis]
    ["Cala d'Or, Hotel Barceló Ponent Beach", 39.3776,
      'miejscowość z doklejonym hotelem — dokładnie fraza Marcina'],
    ["Hotel Barceló Ponent Beach, Cala d'Or", 39.3776,
      'ta sama treść w odwrotnej kolejności — hotel z przodu'],
    ['Kraków, Polska', 50.0614,
      'doprecyzowanie, które POMAGA — ma trafić za pierwszym razem'],
    ['Zakopane', 49.2992, 'gołe miasto, bez przecinków'],
    ['Wymyślone Miejsce Którego Nie Ma', null,
      'czego nie ma, tego nie ma — upraszczanie nie może zmyślać trafienia'],
  ];

  for (const [pytanie, oczek, opis] of PRZYPADKI) {
    zapytania = [];
    const w = await wspolrzedneMiejsca(pytanie);
    const lat = w ? Number(w.lat.toFixed(4)) : null;
    const ok = oczek === null ? w === null : lat === Number(oczek.toFixed(4));
    console.log(`${ok ? 'ok ' : 'ŹLE'} „${pytanie}" → ${w ? w.nazwa : 'null'} `
      + `(prób: ${zapytania.length})`);
    if (!ok) {
      fail.push(`${opis}: „${pytanie}" dało ${w ? w.nazwa : 'null'}, `
        + `spodziewane ${oczek === null ? 'null' : oczek}`);
    }
    /* Upraszczanie nie może zamienić się w kanonadę zapytań: Nominatim
       wymaga sekundy odstępu, więc każda zbędna próba to sekunda czekania
       użytkownika. Trzy kandydatury to sufit. */
    if (zapytania.length > 3) {
      fail.push(`„${pytanie}": ${zapytania.length} zapytań do geokodera — za dużo`);
    }
    /* Pełna fraza MUSI iść pierwsza. Gdyby upraszczanie zaczynało od skrótu,
       „Kraków, Polska" trafiłby w Kraków w stanie Wisconsin. */
    if (zapytania[0] !== pytanie.toLowerCase()) {
      fail.push(`„${pytanie}": pierwsze zapytanie to „${zapytania[0]}", `
        + 'a ma być pełna fraza — doprecyzowanie ma pierwszeństwo');
    }
  }

  /* --- Instrukcja dla modelu na wypadek, gdy i to nie wystarczy ----------
     Geokoder nie zna wszystkiego i zawsze będzie fraza, która nie trafi.
     Wtedy komunikat błędu ma powiedzieć MODELOWI, co zrobić dalej — bo to
     on go czyta jako pierwszy, a jego reakcją było dwukrotne pytanie
     użytkownika o miejsce, które ten już podał. */
  const fs = require('node:fs');
  const serwerJs = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const maPonow = /SPRÓBUJ JESZCZE RAZ z samą nazwą miejscowości/.test(serwerJs);
  const maZakaz = /nie pytaj go\s*'?\s*\+?\s*'?o miejsce, które już podał/.test(serwerJs);
  console.log(`instrukcja przy nieznanym miejscu: ponów ${maPonow ? 'jest' : 'BRAK'}, `
    + `zakaz pytania o to samo ${maZakaz ? 'jest' : 'BRAK'}`);
  if (!maPonow) fail.push('komunikat o nieznanym miejscu nie każe modelowi spróbować prostszej nazwy');
  if (!maZakaz) fail.push('komunikat nie zabrania pytać użytkownika o miejsce, które już podał');

  serwer.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nMIEJSCE Z HOTELEM OK');
  process.exit(fail.length ? 1 : 0);
})();

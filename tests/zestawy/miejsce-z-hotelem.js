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
  /* Pytamy o plan NAPRAWDĘ i czytamy odpowiedź, którą dostanie model.

     Kiedyś stały tu dwa regexpy po `server.js`. Zdawały nawet wtedy, gdyby
     ten komunikat przestał być wysyłany — bo tekst w pliku i tekst
     w odpowiedzi to dwie różne rzeczy. Tu stawiamy serwer bez zapisanej
     lokalizacji, pytamy o miejsce, którego atrapa geokodera nie zna,
     i sprawdzamy, co przyszło z powrotem. */
  const { uruchom, zabij, czekajNa, zwolnijPorty, KORZEN } = require('../pomoc');
  const fsp = require('node:fs');
  const PORT = 8232;
  const dane = fsp.mkdtempSync(path.join(require('node:os').tmpdir(), 'plan-miejsce-'));
  await zwolnijPorty([PORT]);
  const proc = uruchom('node', ['server.js'], {
    cwd: KORZEN,
    env: {
      ...process.env,
      PORT: String(PORT),
      COSMOS_DATA_DIR: dane,
      NVIDIA_API_KEY: 'test',
      GEOCODE_SEARCH_URL: `http://127.0.0.1:${port}/szukaj`,
      GEOCODE_COUNTRY: '',
    },
  });
  const adres = `http://127.0.0.1:${PORT}`;
  try {
    if (!await czekajNa(adres)) throw new Error('serwer testowy nie wstał');
    const planuj = async (tresc) => {
      const r = await fetch(`${adres}/api/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tresc),
      });
      return { kod: r.status, ...(await r.json()) };
    };

    const nieznane = await planuj({ miejsce: 'Wyspa Której Nie Ma, Hotel Widmo' });
    const komunikat = String(nieznane.error || '');
    const maPonow = /SPRÓBUJ JESZCZE RAZ z samą nazwą miejscowości/.test(komunikat);
    const maZakaz = /nie pytaj go o miejsce, które już podał/.test(komunikat);
    console.log(`instrukcja przy nieznanym miejscu (kod ${nieznane.kod}): `
      + `ponów ${maPonow ? 'jest' : 'BRAK'}, zakaz pytania o to samo ${maZakaz ? 'jest' : 'BRAK'}`);
    if (nieznane.kod !== 400) fail.push(`nieznane miejsce dało kod ${nieznane.kod} zamiast 400`);
    if (!maPonow) fail.push('komunikat o nieznanym miejscu nie każe modelowi spróbować prostszej nazwy');
    if (!maZakaz) fail.push('komunikat nie zabrania pytać użytkownika o miejsce, które już podał');
    // Nazwa, której nie udało się rozpoznać, ma być w komunikacie — inaczej
    // model nie wie, o które z podanych miejsc chodzi.
    if (!komunikat.includes('Wyspa Której Nie Ma')) {
      fail.push('komunikat nie powtarza nazwy, której nie udało się rozpoznać');
    }

    /* A miejsce ZNANE ma się policzyć, i to dla niego — nie dla zapisanej
       lokalizacji. To druga połowa skargi Marcina: plan na Majorkę wychodził
       dla Złotokłosu. */
    const znane = await planuj({ miejsce: "Cala d'Or, Hotel Barceló Ponent Beach" });
    const lat = Number(znane.wspolrzedne && znane.wspolrzedne.lat);
    console.log(`plan dla „Cala d'Or, Hotel…": kod ${znane.kod}, szerokość ${lat}, `
      + `miejsce „${znane.miejsce}", z nazwy: ${znane.miejsceZNazwy}`);
    if (znane.kod !== 200) {
      fail.push(`plan dla znanej miejscowości z doklejonym hotelem dał kod ${znane.kod}`);
    } else {
      if (!(Math.abs(lat - 39.3776) < 0.5)) {
        fail.push(`plan policzył się dla szerokości ${lat}, a Cala d'Or leży na 39,38 `
          + '— czyli znowu dla zapisanej lokalizacji zamiast dla podanego miejsca');
      }
      /* Odpowiedź musi też NAZWAĆ miejsce, dla którego liczyła. Bez tego model
         napisze „o zachodzie u Ciebie", choć liczby dotyczą Balearów. */
      if (!znane.miejsceZNazwy) {
        fail.push('odpowiedź nie zaznacza, że liczby dotyczą podanego miejsca, a nie zapisanej lokalizacji');
      }
      if (!/Cala d'Or/i.test(String(znane.miejsce || ''))) {
        fail.push(`odpowiedź podaje miejsce „${znane.miejsce}" zamiast rozpoznanego Cala d'Or`);
      }
    }
  } finally {
    zabij(proc);
    fsp.rmSync(dane, { recursive: true, force: true });
  }

  serwer.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nMIEJSCE Z HOTELEM OK');
  process.exit(fail.length ? 1 : 0);
})();

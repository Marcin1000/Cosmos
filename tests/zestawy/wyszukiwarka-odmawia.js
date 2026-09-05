/* „Wyszukiwarka nie odpowiada" — kiedy odpowiada aż za dobrze.

   Marcin zapytał Cosmosa o pogodę w Warszawie i dostał „błąd — Wyszukiwarka
   nie odpowiada (fetch failed). Sprawdź połączenie z internetem." Połączenie
   miał sprawne. Pomiar na jego VPS-ie pokazał coś innego niż awaria sieci:

     próba 1-2  → HTTP 200, ~33 000 znaków  (prawdziwe wyniki)
     próba 3-10 → HTTP 202, ~14 200 znaków  (strona weryfikacyjna)

   DuckDuckGo ogranicza ruch z adresów centrów danych. Oddaje wtedy stronę
   weryfikacyjną — ale ze statusem 202, który mieści się w zakresie „ok",
   więc `fetch` nie rzuca, `r.ok` jest prawdą, a kod leciał dalej. Parser nie
   znajdował ani jednej klasy `result__a` i meldował „0 wyników".

   To jest gorsze niż błąd, bo wygląda jak odpowiedź: człowiek myśli, że
   internet nic nie ma na ten temat, i zawęża zapytanie — a trzeba postawić
   SearXNG. Dwa różne stany muszą prowadzić do dwóch różnych komunikatów.

   Zestaw sprawdza obie strony, bo obie mogą zawieść niezależnie:
     1. ODMOWA (202 bez trafień) ma dać błąd mówiący o ograniczaniu ruchu.
     2. PRAWDZIWY BRAK TRAFIEŃ (200 bez trafień) NIE MOŻE go dawać — inaczej
        zamienilibyśmy jedno mylące zdanie na drugie.
     3. Przy awarii połączenia komunikat ma nieść przyczynę z `err.cause`,
        a nie samo „fetch failed”.
*/
const http = require('node:http');

const fail = [];

/* Port poznajemy dopiero po `listen`, a atrapa SearXNG musi oddać adres
   strony na tym samym serwerze — stąd zmienna wypełniana po starcie. */
let PORT = 0;

/* Serwer, który udaje DuckDuckGo. Każda ścieżka to inny scenariusz. */
function atrapa() {
  return new Promise((gotowe) => {
    const s = http.createServer((req, res) => {
      if (req.url.startsWith('/odmowa')) {
        // Strona weryfikacyjna: status 202, treść bez ani jednego wyniku.
        res.writeHead(202, { 'Content-Type': 'text/html' });
        return res.end('<html><body><div class="anomaly-modal">'
          + 'Unfortunately, bots use DuckDuckGo too.</div></body></html>');
      }
      if (req.url.startsWith('/searxng/search')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ results: [
          { title: 'Pogoda Warszawa', url: `http://127.0.0.1:${PORT}/strona`,
            content: 'Zajawka bez liczby, o którą pytał użytkownik.' },
        ] }));
      }
      if (req.url.startsWith('/strona')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html><body><p>Dziś w Warszawie 18 stopni '
          + 'i słabe zachmurzenie.</p></body></html>');
      }
      if (req.url.startsWith('/pusto')) {
        // Uczciwe „nic nie znalazłem": status 200, brak trafień.
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html><body><div class="no-results">No results.</div></body></html>');
      }
      // Normalna odpowiedź z jednym trafieniem.
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>'
        + '<a class="result__a" href="//duckduckgo.com/l/?uddg='
        + encodeURIComponent('https://example.com/pogoda') + '">Pogoda Warszawa</a>'
        + '<a class="result__snippet" href="#">Dziś 18 stopni.</a>'
        + '</body></html>');
    });
    s.listen(0, '127.0.0.1', () => gotowe(s));
  });
}

(async () => {
  const s = await atrapa();
  PORT = s.address().port;
  const baza = `http://127.0.0.1:${PORT}`;

  /* `sendJson` woła metody odpowiedzi HTTP, więc dajemy mu atrapę, która
     zapamiętuje ciało zamiast je wysyłać. */
  const wolaj = async (sciezka, q) => {
    delete require.cache[require.resolve('../../lib/szukanie.js')];
    delete require.cache[require.resolve('../../lib/rdzen.js')];
    process.env.SEARCH_URL = sciezka;
    delete process.env.SEARXNG_URL;
    const { handleSearch } = require('../../lib/szukanie.js');
    let ciało = '';
    const res = {
      writeHead() { return res; },
      setHeader() { return res; },
      end(t) { ciało = t || ''; },
    };
    await handleSearch({ method: 'GET', url: `/api/search?q=${encodeURIComponent(q)}` }, res);
    try { return JSON.parse(ciało); } catch { return { _surowe: ciało }; }
  };

  // --- 1. ODMOWA: 202 bez trafień ------------------------------------------
  const odmowa = await wolaj(`${baza}/odmowa`, 'pogoda Warszawa');
  const mowiOOgraniczeniu = /ogranicza ruch|202/i.test(odmowa.error || '');
  const nieKlamieOSieci = !/sprawdź połączenie z internetem/i.test(odmowa.error || '');
  console.log(`1. HTTP 202 bez trafień → error: ${JSON.stringify((odmowa.error || '(brak)').slice(0, 70))}`);
  if (!odmowa.error) {
    fail.push('odmowa wyszukiwarki (202) przechodzi jako zwykły pusty wynik — '
      + 'człowiek widzi „0 wyników" i zawęża zapytanie zamiast postawić SearXNG');
  } else if (!mowiOOgraniczeniu) {
    fail.push(`komunikat przy 202 nie mówi o ograniczaniu ruchu: ${odmowa.error}`);
  }
  if (!nieKlamieOSieci) fail.push('komunikat przy 202 odsyła do sprawdzania internetu — a internet działa');

  // --- 2. PRAWDZIWY BRAK TRAFIEŃ: 200 bez wyników --------------------------
  /* Strona odwrotna. Gdyby punkt 1 załatwić przez „pusto = odmowa", ten
     punkt by padł — i słusznie, bo to dwa różne stany świata. */
  const pusto = await wolaj(`${baza}/pusto`, 'zapytanie bez trafień');
  console.log(`2. HTTP 200 bez trafień → error: ${JSON.stringify(pusto.error || '(brak — dobrze)')}`);
  if (pusto.error) {
    fail.push('uczciwy brak trafień (HTTP 200) jest zgłaszany jako awaria wyszukiwarki: '
      + pusto.error);
  }
  if (!Array.isArray(pusto.results) || pusto.results.length) {
    fail.push('przy braku trafień wyniki nie są pustą tablicą');
  }

  // --- 3. NORMALNA ODPOWIEDŹ nadal działa ----------------------------------
  const dobrze = await wolaj(`${baza}/ok`, 'pogoda Warszawa');
  console.log(`3. HTTP 200 z trafieniem → wyników: ${(dobrze.results || []).length}, error: ${dobrze.error || 'brak'}`);
  if (!(dobrze.results || []).length) fail.push('poprawna odpowiedź przestała dawać wyniki');
  if (dobrze.error) fail.push(`poprawna odpowiedź zgłasza błąd: ${dobrze.error}`);

  // --- 4. AWARIA POŁĄCZENIA niesie przyczynę -------------------------------
  /* Port, na którym nic nie nasłuchuje: `fetch` rzuci „fetch failed”,
     a konkret (ECONNREFUSED) schowa w `err.cause`. Właśnie ten konkret
     Marcin powinien był zobaczyć zamiast rady o sprawdzeniu internetu.

     Port bierzemy z jądra i dopiero potem zwalniamy — stały numer bywa
     zajęty, a numer poniżej 1024 daje „bad port" zamiast odmowy połączenia,
     czyli mierzyłby co innego, niż udaje. */
  const wolnyPort = await new Promise((g) => {
    const t = http.createServer().listen(0, '127.0.0.1', () => {
      const p = t.address().port;
      t.close(() => g(p));
    });
  });
  const martwy = await wolaj(`http://127.0.0.1:${wolnyPort}/`, 'cokolwiek');
  console.log(`4. port bez nasłuchu → error: ${JSON.stringify((martwy.error || '(brak)').slice(0, 80))}`);
  if (!martwy.error) {
    fail.push('awaria połączenia nie daje żadnego błędu');
  } else if (!/przyczyna:/i.test(martwy.error)) {
    fail.push('komunikat o awarii nie niesie przyczyny z err.cause — '
      + `każda awaria wygląda tak samo: ${martwy.error}`);
  }

  /* --- 5. SEARXNG TEŻ MUSI DOWOZIĆ TREŚĆ STRON ---------------------------
     Nagłówek tego pliku obiecuje, że Cosmos „nie tylko zbiera linki, ale
     POBIERA TREŚĆ dwóch pierwszych stron" — bo bez tego model dostawał same
     tytuły i w kółko prosił o kolejne wyszukiwanie, aż wyczerpał rundy.

     Obietnica była spełniona tylko na drodze DuckDuckGo. Droga SearXNG
     zwracała wyniki od razu, więc kto włączył SEARXNG_URL — czyli dokładnie
     ten, kto uciekał przed odmowami DuckDuckGo — po cichu wracał do usterki,
     dla której `fetchPageText` powstało.

     Atrapa oddaje zajawkę BEZ liczby i osobną stronę, na której ta liczba
     stoi. Jeśli „18 stopni" nie dotrze do wyniku, treść nie została pobrana. */
  const stara = process.env.SEARXNG_URL;
  process.env.SEARXNG_URL = `${baza}/searxng`;
  const przezSearxng = await (async () => {
    delete require.cache[require.resolve('../../lib/szukanie.js')];
    delete require.cache[require.resolve('../../lib/rdzen.js')];
    const { handleSearch } = require('../../lib/szukanie.js');
    let ciało = '';
    const res = { writeHead() { return res; }, setHeader() { return res; }, end(t) { ciało = t || ''; } };
    await handleSearch({ method: 'GET', url: '/api/search?q=pogoda' }, res);
    try { return JSON.parse(ciało); } catch { return {}; }
  })();
  if (stara === undefined) delete process.env.SEARXNG_URL; else process.env.SEARXNG_URL = stara;

  const pierwszy = (przezSearxng.results || [])[0] || {};
  const maTresc = /18 stopni/.test(pierwszy.text || '');
  console.log(`5. SearXNG → silnik: ${przezSearxng.silnik}, `
    + `treść strony: ${maTresc ? 'jest' : 'BRAK'} (${(pierwszy.text || '(puste)').slice(0, 40)})`);
  if (przezSearxng.silnik !== 'searxng') {
    fail.push(`zapytanie nie poszło przez SearXNG (silnik: ${przezSearxng.silnik})`);
  } else if (!maTresc) {
    fail.push('wyniki z SearXNG nie niosą treści stron — model dostaje same zajawki '
      + 'i będzie prosił o kolejne wyszukiwania, tak jak przed powstaniem fetchPageText');
  }

  s.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nWYSZUKIWARKA ODMAWIA OK');
  process.exit(fail.length ? 1 : 0);
})();

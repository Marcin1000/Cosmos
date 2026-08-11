/* Ile realnie trwa uzupełnianie archiwum na 59 tysiącach plików.

   Marcin, po pierwszej paczce: „To dociąganie danych z plików przy takiej
   dużej liczbie plików chyba potrwa parę dni. Strasznie wolno to idzie."
   Licznik szedł 71 → 96 uzupełnionych, przy 55 tysiącach w kolejce.

   Zmierzone przyczyny — obie zaskakujące, obie NIE tam, gdzie się ich szukało:

     1. `writeFileSync` na indeksie 97,8 MB trwał 5,2 s i BLOKOWAŁ pętlę
        zdarzeń. Zapis był odkładany o sekundę, więc przy dociąganiu serwer
        stał dłużej, niż pracował — i nie obsługiwał w tym czasie niczego.
     2. 70 z 98 MB tego pliku to były adresy miniatur z OneDrive: po 1,2 kB
        podpisanego adresu na plik, przepisywane przy każdym zapisie. Nikt ich
        nie czyta — przeglądarka bierze podgląd z `/api/archive/thumb`, bo te
        adresy i tak wygasają po godzinie.

   Czego NIE było przyczyną, choć wyglądało: `indexOf` w `dodaj()`. Wygląda na
   kwadrat po liczbie wpisów, a zmierzone daje 132 ms na 500 aktualizacji
   z końca tablicy. Zgadywanie zaprowadziłoby w złe miejsce.

   Trzecia zmiana to sieć: dociąganie szło plik po pliku, a każdy plik to jedno
   żądanie do Microsoftu. Tutaj sprawdzamy, że idzie ich kilka naraz.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');

const fail = [];
const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-arch-'));
const archiwum = require('../../lib/archiwum.js').utworz(katalog);

// --- 1. Indeks nie puchnie od adresów, których nikt nie czyta --------------
const N = 20000;
const wpisy = [];
for (let i = 0; i < N; i++) {
  wpisy.push({
    id: `onedrive:${i}`, zrodlo: 'onedrive', typ: 'zdjecie',
    nazwa: `3B9A${1000 + i}.CR3`,
    sciezka: `/Zdjęcia/Mazury 2026/3B9A${1000 + i}.CR3`,
    kiedy: '2026-06-21T10:00:00.000Z',
    // Tak wygląda podpisany adres miniatury z Graph: ~1,2 kB na plik.
    miniatura: 'https://public.bl.files.1drv.com/' + 'x'.repeat(1200),
  });
}
archiwum.dodaj(wpisy);
const zPamieci = JSON.stringify(archiwum.szukaj({ zrodlo: 'onedrive' }));
const naPlik = Buffer.byteLength(zPamieci) / N;
console.log(`1. bajtów indeksu na plik: ${Math.round(naPlik)}`);
if (/1drv\.com/.test(zPamieci)) {
  fail.push('adresy miniatur wróciły do indeksu — 1,2 kB na plik za coś, czego nikt nie czyta');
}
if (naPlik > 700) fail.push(`${Math.round(naPlik)} B na wpis to za dużo — indeks znowu puchnie`);

(async () => {
  // --- 2. Zapis nie blokuje pętli zdarzeń ---------------------------------
  /* Sam czas zapisu to nie wszystko. Pytanie brzmi: czy w tym czasie serwer
     może cokolwiek obsłużyć. Liczymy tyknięcia zegara — przy zapisie
     synchronicznym nie ma ani jednego. */
  let tykniecia = 0;
  const zegar = setInterval(() => { tykniecia++; }, 5);
  const start = Date.now();
  await archiwum.zapisz();
  const trwal = Date.now() - start;
  clearInterval(zegar);
  const rozmiar = fs.statSync(path.join(katalog, 'archiwum.json')).size;
  console.log(`2. zapis ${(rozmiar / 1048576).toFixed(1)} MB trwał ${trwal} ms, `
    + `pętla zdarzeń tyknęła ${tykniecia} razy`);
  if (trwal > 40 && tykniecia === 0) {
    fail.push('zapis blokuje pętlę zdarzeń — w tym czasie serwer nie obsługuje żądań');
  }

  // --- 3. Dociąganie EXIF-u idzie RÓWNOLEGLE ------------------------------
  /* Atrapa OneDrive z opóźnieniem 50 ms na plik. Sekwencyjnie 60 plików = 3 s;
     przy sześciu naraz — około pół sekundy. Mierzymy też szczyt jednoczesnych
     żądań, bo sam czas dałoby się poprawić przypadkiem. */
  let teraz = 0;
  let szczyt = 0;
  const onedrive = {
    polaczony: () => true,
    dociagnijExif: async () => {
      teraz++; szczyt = Math.max(szczyt, teraz);
      await new Promise((r) => setTimeout(r, 50));
      teraz--;
      return { aparat: 'Canon EOS R6m2', obiektyw: 'RF24-105mm F4 L IS USM' };
    },
  };
  const trasy = require('../../lib/archiwum-trasy.js').utworz({
    archiwum,
    onedrive,
    SENSES_URL: '',
    sendJson: (res, kod, dane) => { res.kod = kod; res.dane = dane; },
    readJson: async () => ({ ile: 60 }),
    addEvent: () => {},
    sensesState: () => ({}),
    wspolrzedneMiejsca: async () => null,
  });

  const res = {};
  const t = Date.now();
  await trasy.handleArchiwum({ method: 'POST', url: '/api/archive/lenses' }, res, '/api/archive/lenses');
  const czas = Date.now() - t;
  console.log(`3. 60 plików po 50 ms: ${czas} ms, szczyt równoległych żądań: ${szczyt}`);
  console.log(`   wynik: uzupełnione ${res.dane && res.dane.uzupelnione}, zostało ${res.dane && res.dane.zostalo}`);
  if (szczyt < 2) fail.push('dociąganie idzie plik po pliku — opóźnienie łącza sumuje się 56 tysięcy razy');
  if (czas > 1500) fail.push(`60 plików po 50 ms zajęło ${czas} ms — to tempo sekwencyjne`);
  if (!res.dane || res.dane.uzupelnione !== 60) {
    fail.push(`uzupełniono ${res.dane && res.dane.uzupelnione} z 60 — równoległość gubi pliki`);
  }

  /* Kolejka MUSI maleć — inaczej pętla paczek w przeglądarce kręci się bez
     końca. To już raz się zdarzyło, przy plikach bez obiektywu. */
  if (!res.dane || res.dane.zostalo !== N - 60) {
    fail.push(`w kolejce zostało ${res.dane && res.dane.zostalo}, spodziewane ${N - 60}`);
  }

  /* --- 4. WCZYTANIE INDEKSU ZAPISANEGO PRZEZ STARSZĄ WERSJĘ ---------------
     To jest ten punkt, którego brak kosztował Marcina padnięty serwer.

     Punkty 1-3 budują archiwum od zera, przez `dodaj()`. Tam `miniatura` już
     nie powstaje, więc ścieżka „wczytaj stary plik i posprzątaj" nie była
     wykonywana ANI RAZU — mimo że to jedyna droga, którą przechodzi każda
     istniejąca instalacja. Serwer wywracał się przy starcie z ReferenceError
     (sprzątanie stało nad definicjami, w martwej strefie `let`), a bateria
     świeciła na zielono.

     Dlatego tu piszemy plik RĘCZNIE, tak jak zapisała go poprzednia wersja. */
  const staryKatalog = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-arch-stary-'));
  fs.writeFileSync(path.join(staryKatalog, 'archiwum.json'), JSON.stringify([
    { id: 'onedrive:1', zrodlo: 'onedrive', typ: 'zdjecie', nazwa: 'a.CR3',
      sciezka: '/Zdjęcia/a.CR3', kiedy: '2026-06-01T10:00:00.000Z',
      miniatura: 'https://public.bl.files.1drv.com/' + 'x'.repeat(1200) },
    { id: 'onedrive:2', zrodlo: 'onedrive', typ: 'zdjecie', nazwa: 'b.CR3',
      sciezka: '/Zdjęcia/b.CR3', kiedy: '2026-06-02T10:00:00.000Z',
      miniatura: 'https://public.bl.files.1drv.com/' + 'y'.repeat(1200) },
  ]));

  let stary = null;
  let wyjatek = '';
  try {
    stary = require('../../lib/archiwum.js').utworz(staryKatalog);
  } catch (err) {
    wyjatek = `${err.constructor.name}: ${err.message}`;
  }
  console.log(`4. wczytanie indeksu ze starszej wersji: ${wyjatek || 'bez wyjątku'}`);
  if (wyjatek) {
    fail.push(`wczytanie starego indeksu wywraca moduł (${wyjatek}) — serwer nie wstanie po aktualizacji`);
  } else {
    const ile = stary.ile();
    const zostalyAdresy = JSON.stringify(stary.szukaj({ zrodlo: 'onedrive' })).includes('1drv.com');
    console.log(`   wpisów po wczytaniu: ${ile}, adresy miniatur usunięte: ${!zostalyAdresy}`);
    if (ile !== 2) fail.push(`po wczytaniu starego indeksu jest ${ile} wpisów zamiast 2 — migracja gubi dane`);
    if (zostalyAdresy) fail.push('adresy miniatur zostały w starym indeksie — nie chudnie po aktualizacji');

    // Posprzątany indeks ma też TRAFIĆ NA DYSK, inaczej sprzątamy przy każdym starcie.
    await new Promise((r) => setTimeout(r, 3600));
    const naDysku = fs.readFileSync(path.join(staryKatalog, 'archiwum.json'), 'utf8');
    console.log(`   plik na dysku bez adresów: ${!naDysku.includes('1drv.com')}`);
    if (naDysku.includes('1drv.com')) {
      fail.push('posprzątany indeks nie został zapisany — czyszczenie powtórzy się przy każdym starcie');
    }
  }
  fs.rmSync(staryKatalog, { recursive: true, force: true });

  /* --- 5. Dławienie (429) to prośba o zwolnienie, nie awaria --------------
     Marcin, po włączeniu sześciu równoległych żądań: „Przerwane: kolejka nie
     maleje (50963 do zrobienia). Powód: Graph 429". Cała paczka przepadała,
     bo 429 leciało jako zwykły błąd — a Microsoft prosił tylko o zwolnienie
     i podał w nagłówku, na ile.

     Stawiamy prawdziwy serwer HTTP udający Graph: pierwsze żądania odbija
     z 429 i `Retry-After: 1`, potem zaczyna odpowiadać. Klient OneDrive ma to
     przeczekać i dowieźć plik, a nie rzucić wyjątkiem. */
  const http = require('http');
  let odbite = 0;
  let przepuszczone = 0;
  const serwer = http.createServer((req, res) => {
    if (/oauth2/.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_in: 3600 }));
    }
    if (odbite < 3) {
      odbite++;
      res.writeHead(429, { 'Retry-After': '1' });
      return res.end('throttled');
    }
    przepuszczone++;
    res.writeHead(206, { 'Content-Type': 'application/octet-stream' });
    // Kawałek bez EXIF-u wystarczy: sprawdzamy DROGĘ, nie parser.
    return res.end(Buffer.from('\xff\xd8\xff\xe0nic', 'binary'));
  });
  await new Promise((r) => serwer.listen(0, r));
  const port = serwer.address().port;

  const katalogOd = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-od-'));
  fs.writeFileSync(path.join(katalogOd, 'onedrive.json'),
    JSON.stringify({ refresh_token: 'y', access_token: '', wygasa: 0, od: Date.now() }));
  /* Adresy Microsoftu są w module na stałe, więc podmieniamy je przez
     zmienne środowiskowe modułu — tak samo jak w innych zestawach. */
  const kod = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'onedrive.js'), 'utf8')
    .replace(/const GRAF = '[^']*'/, `const GRAF = 'http://127.0.0.1:${port}'`)
    .replace(/const TOKEN = '[^']*'/, `const TOKEN = 'http://127.0.0.1:${port}/oauth2/token'`);
  const podmieniony = path.join(katalogOd, 'onedrive-test.js');
  fs.writeFileSync(podmieniony, kod.replace(/require\('\.\//g, `require('${path.join(__dirname, '..', '..', 'lib')}/`));
  const od = require(podmieniony).utworz({
    katalogDanych: katalogOd, clientId: 'a', clientSecret: 'b', redirectUri: 'http://x',
  });

  const start429 = Date.now();
  let bladDlawienia = '';
  try {
    await od.dociagnijExif('abc');
  } catch (err) {
    bladDlawienia = err.message;
  }
  const czekano = Date.now() - start429;
  console.log(`5. odbić 429: ${odbite}, przepuszczonych: ${przepuszczone}, `
    + `czekano ${czekano} ms, błąd: ${bladDlawienia || 'brak'}`);
  if (bladDlawienia) {
    fail.push(`429 kończy się błędem (${bladDlawienia}) zamiast odczekaniem — paczka przepada`);
  }
  if (!przepuszczone) fail.push('po dławieniu nie doszło ani jedno żądanie — nie ma ponowienia');
  if (czekano < 900) fail.push(`odczekano ${czekano} ms mimo Retry-After: 1 — nagłówek jest ignorowany`);
  if (typeof od.zdlawienia !== 'function' || od.zdlawienia() < 1) {
    fail.push('dławienie nie jest liczone — panel nie ma jak o nim powiedzieć');
  }
  /* --- 6. Plik, którego NIGDY nie da się przeczytać, nie blokuje kolejki ---
     Marcin: „Przerwane: kolejka nie maleje (4 do zrobienia). Powód: Graph 416".
     416 („Requested Range Not Satisfiable") dostajemy dla plików PUSTYCH:
     prosimy o bajty 0-N, a w pliku nie ma ani jednego. Cztery puste `.SRT`
     zatrzymały całe zadanie, bo wpis nigdy nie dostawał znacznika
     „sprawdzony" i wracał w każdej paczce. To samo dotyczy 404 i 410 —
     pliku skasowanego między indeksowaniem a odczytem.

     Ponawianie tu NIE POMAGA: te odpowiedzi znaczą „nigdy", nie „później". */
  const beznadziejne = http.createServer((req, res) => {
    if (/oauth2/.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_in: 3600 }));
    }
    res.writeHead(/pusty/.test(req.url) ? 416 : 404);
    return res.end();
  });
  await new Promise((r) => beznadziejne.listen(0, r));
  const port2 = beznadziejne.address().port;
  const kod2 = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'onedrive.js'), 'utf8')
    .replace(/const GRAF = '[^']*'/, `const GRAF = 'http://127.0.0.1:${port2}'`)
    .replace(/const TOKEN = '[^']*'/, `const TOKEN = 'http://127.0.0.1:${port2}/oauth2/token'`)
    .replace(/require\('\.\//g, `require('${path.join(__dirname, '..', '..', 'lib')}/`);
  const katalogOd2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-od2-'));
  fs.writeFileSync(path.join(katalogOd2, 'onedrive.json'),
    JSON.stringify({ refresh_token: 'y', access_token: '', wygasa: 0, od: Date.now() }));
  const plik2 = path.join(katalogOd2, 'onedrive-test.js');
  fs.writeFileSync(plik2, kod2);
  const od2 = require(plik2).utworz({
    katalogDanych: katalogOd2, clientId: 'a', clientSecret: 'b', redirectUri: 'http://x',
  });

  const start416 = Date.now();
  const wyniki = { srt: 'nie próbowano', exif: 'nie próbowano', blad: '' };
  try {
    wyniki.srt = JSON.stringify(await od2.dociagnijSrt('pusty'));
    wyniki.exif = JSON.stringify(await od2.dociagnijExif('zniknal'));
  } catch (err) {
    wyniki.blad = err.message;
  }
  const czas416 = Date.now() - start416;
  console.log(`6. pusty .SRT (416) → ${wyniki.srt}, skasowane zdjęcie (404) → ${wyniki.exif}`
    + `${wyniki.blad ? `, błąd: ${wyniki.blad}` : ''} · ${czas416} ms`);
  if (wyniki.blad) {
    fail.push(`416/404 kończy się błędem (${wyniki.blad}) — cztery puste pliki zatrzymają całą kolejkę`);
  }
  if (wyniki.srt !== '""') fail.push(`pusty .SRT oddał ${wyniki.srt} zamiast pustego tekstu`);
  if (wyniki.exif !== 'null') fail.push(`skasowane zdjęcie oddało ${wyniki.exif} zamiast null`);
  // Ponawianie „nigdy" byłoby czekaniem na darmo — 4 próby po 5 s to 35 sekund.
  if (czas416 > 3000) fail.push(`odczekano ${czas416} ms na odpowiedzi, które znaczą „nigdy"`);
  beznadziejne.close();
  fs.rmSync(katalogOd2, { recursive: true, force: true });

  serwer.close();
  fs.rmSync(katalogOd, { recursive: true, force: true });

  /* --- 6b. Rozpoznawanie treści też idzie równolegle ---------------------
     Marcin, po uruchomieniu: „schodzi po 30 w ciągu około 36 sekund", przy
     55 206 w kolejce — osiemnaście godzin. Każde zdjęcie to TRZY kolejki po
     sieci: adres miniatury z Graph, pobranie miniatury, wysyłka do YOLO na
     komputer domowy. Sekwencyjnie sumują się wszystkie trzy.

     Równolegle mniej niż przy EXIF-ie, bo na końcu stoi jedna karta graficzna
     — ale pobieranie następnej miniatury ma się dziać w tle rozpoznawania
     poprzedniej i to jest cały zysk. */
  let terazYolo = 0;
  let szczytYolo = 0;
  const trasyYolo = require('../../lib/archiwum-trasy.js').utworz({
    archiwum,
    onedrive: {
      polaczony: () => true,
      graf: async () => {
        terazYolo++; szczytYolo = Math.max(szczytYolo, terazYolo);
        await new Promise((r) => setTimeout(r, 30));
        terazYolo--;
        return { url: 'http://127.0.0.1:1/mini.jpg' };
      },
    },
    SENSES_URL: 'http://127.0.0.1:1',
    sendJson: (res2, kod, dane) => { res2.kod = kod; res2.dane = dane; },
    readJson: async () => ({ ile: 30 }),
    addEvent: () => {},
    sensesState: async () => ({ online: true, caps: { yolo: true } }),
    wspolrzedneMiejsca: async () => null,
  });
  const resY = {};
  const tY = Date.now();
  await trasyYolo.handleArchiwum(
    { method: 'POST', url: '/api/archive/vision' }, resY, '/api/archive/vision');
  console.log(`6b. rozpoznawanie: szczyt równoległych żądań ${szczytYolo}, ${Date.now() - tY} ms`);
  if (szczytYolo < 2) {
    fail.push('rozpoznawanie treści idzie zdjęcie po zdjęciu — trzy kolejki po sieci sumują się 55 tysięcy razy');
  }
  /* Pliki, których nie udało się przerobić, NIE mogą zostać oznaczone jako
     obejrzane — inaczej awaria sieci cicho wykreśla je z kolejki na zawsze.
     Tu wszystkie padają (adres 127.0.0.1:1 nie istnieje), więc kolejka
     ma zostać nietknięta. */
  console.log(`    po samych błędach zostało: ${resY.dane && resY.dane.zostalo}`);
  if (resY.dane && resY.dane.opisane) {
    fail.push('opisano zdjęcia mimo braku zmysłów — wynik jest zmyślony');
  }

  /* --- 7. Panel MUSI umieć powiedzieć, czy praca się skończyła -----------
     Po wielogodzinnym dociąganiu panel pokazywał wyłącznie „W archiwum:
     59 421 plików". Żeby dowiedzieć się, czy zostało coś do zrobienia, trzeba
     było kliknąć przycisk — czyli uruchomić zadanie po to, by się przekonać,
     że nie ma go po co uruchamiać. */
  const p7 = archiwum.postep();
  console.log(`7. postęp: ${p7.zDanymi} z ${p7.zdjec} zdjęć ma dane, zostało ${p7.zostaloZdjec}`);
  if (p7.zdjec !== N) fail.push(`postęp widzi ${p7.zdjec} zdjęć zamiast ${N}`);
  if (p7.zDanymi !== 60) fail.push(`postęp mówi o ${p7.zDanymi} uzupełnionych zamiast 60`);
  if (p7.zostaloZdjec !== N - 60) {
    fail.push(`postęp mówi „zostało ${p7.zostaloZdjec}" zamiast ${N - 60}`);
  }

  /* --- 8. RAW i JPG to JEDNO zdjęcie -------------------------------------
     Pomiar z instrumentacji u Marcina: „adres 628 ms · pobranie 6805 ms
     (99 kB) · YOLO 220 ms". Dziewięćdziesiąt procent czasu to czekanie na
     miniaturę z Microsoftu, przy karcie graficznej stojącej na 18%. Powód:
     dla RAW-a Graph MUSI wygenerować podgląd u siebie, bo w pliku nie ma
     gotowej miniatury w rozmiarze „large" — dla JPG oddaje plik z półki
     (w tej samej paczce: 451 ms przy 74 kB).

     PIERWSZA WERSJA TEGO PAROWANIA ZNALAZŁA U MARCINA ZERO PAR, bo grupowała
     po ścieżce bez rozszerzenia — a on trzyma pliki inaczej. Jego słowami:
     „nie raz robiłem tak, że rozdzielałem jpg i raw w dwóch folderach albo
     jpg trafiały do podfolderu z jpg w folderze zawierającym pliki RAW",
     do tego RAW-y to CR3, CR2, format Nikona i Samsunga.

     Dlatego kluczem jest NAZWA PLIKU I SEKUNDA ZDJĘCIA. Ten zestaw odtwarza
     wszystkie cztery układy naraz — i dwie pułapki, w które taki klucz może
     wpaść: serię zdjęć w tej samej sekundzie (różne kadry, nie wolno sklejać)
     i przewinięty licznik aparatu (ta sama nazwa, inny wyjazd). */
  const katalogPar = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-pary-'));
  const archPary = require('../../lib/archiwum.js').utworz(katalogPar);
  const zdj = (id, sciezka, kiedy, extra) => ({
    id: `onedrive:${id}`, zrodlo: 'onedrive', typ: 'zdjecie',
    nazwa: sciezka.split('/').pop(), sciezka, kiedy, ...extra,
  });
  archPary.dodaj([
    // A. RAW i JPG obok siebie, ten sam folder.
    zdj('A-raw', '/Mazury 2026/3B9A4860.CR3', '2026-06-21T10:00:00'),
    zdj('A-jpg', '/Mazury 2026/3B9A4860.JPG', '2026-06-21T10:00:00'),
    /* B. Rozdzielone na dwa osobne foldery, RAW Nikona. Data zapisana raz ze
       spacją, raz z „T" — bo Graph oddaje jeden format, a EXIF drugi, i po
       dociągnięciu danych z plików w indeksie leżą oba. */
    zdj('B-raw', '/RAW Nikon/DSC_1000.NEF', '2025-08-14 19:30:12'),
    zdj('B-jpg', '/JPG Nikon/DSC_1000.JPG', '2025-08-14T19:30:12'),
    // C. JPG w podfolderze „jpg" wewnątrz folderu z RAW-ami, CR2.
    zdj('C-raw', '/Wesele Kasi/IMG_2001.CR2', '2024-09-07T14:05:33'),
    zdj('C-jpg', '/Wesele Kasi/jpg/IMG_2001.JPG', '2024-09-07T14:05:33'),
    // D. Sam RAW, format Samsunga — bliźniaka nie ma i mieć nie będzie.
    zdj('D-raw', '/Telefon/SAM_9001.SRW', '2023-05-01T08:00:00'),
    /* E. PUŁAPKA: seria z Canona, dwa różne kadry w tej samej sekundzie.
       Sama data by je skleiła i drugie zdjęcie dostałoby cudze etykiety. */
    zdj('E-1', '/Seria/3B9A5000.CR3', '2026-07-02T11:11:11'),
    zdj('E-2', '/Seria/3B9A5001.CR3', '2026-07-02T11:11:11'),
    /* F. PUŁAPKA: licznik w aparacie się przewinął. Ta sama nazwa pliku,
       dwa różne wyjazdy — sama nazwa by je skleiła. */
    zdj('F-1', '/Wyjazd 2019/DSC_0001.JPG', '2019-04-11T07:00:00'),
    zdj('F-2', '/Wyjazd 2022/DSC_0001.JPG', '2022-04-11T07:00:00'),
    /* G. Bliźniak obejrzany PRZED wprowadzeniem parowania — u Marcina takich
       jest kilkanaście tysięcy. Etykiety mają się przepisać za darmo. */
    zdj('G-raw', '/Stare/9999.CR3', '2020-01-01T12:00:00'),
    zdj('G-jpg', '/Stare/9999.JPG', '2020-01-01T12:00:00',
      { obejrzane: true, obiekty: ['dog'] }),
  ]);

  const serwerMini = http.createServer((req, res) => {
    if (/detect/.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ objects: [{ label: 'boat', conf: 0.9 }] }));
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    return res.end(Buffer.from('\xff\xd8\xff\xe0mini', 'binary'));
  });
  await new Promise((r) => serwerMini.listen(0, r));
  const portMini = serwerMini.address().port;

  const pytano = [];
  const trasyPary = require('../../lib/archiwum-trasy.js').utworz({
    archiwum: archPary,
    onedrive: {
      polaczony: () => true,
      graf: async (sciezkaGraf) => {
        /* Zapisujemy NAZWĘ PLIKU, nie identyfikator: cała rzecz w tym zestawie
           polega na tym, o który plik z kadru pytamy, a `A-jpg` tego nie
           pokazuje. Nazwy się powtarzają (pułapka F) i o to właśnie chodzi. */
        const id = decodeURIComponent(String(sciezkaGraf).split('/items/')[1].split('/')[0]);
        const w = archPary.szukaj({ zrodlo: 'onedrive' }).find((x) => x.id === `onedrive:${id}`);
        pytano.push(w ? w.nazwa : id);
        return { url: `http://127.0.0.1:${portMini}/mini.jpg` };
      },
    },
    SENSES_URL: `http://127.0.0.1:${portMini}`,
    sendJson: (res2, kod, dane) => { res2.kod = kod; res2.dane = dane; },
    readJson: async () => ({ ile: 20 }),
    addEvent: () => {},
    sensesState: async () => ({ online: true, caps: { yolo: true } }),
    wspolrzedneMiejsca: async () => null,
  });
  const resP = {};
  await trasyPary.handleArchiwum(
    { method: 'POST', url: '/api/archive/vision' }, resP, '/api/archive/vision');

  const d8 = resP.dane || {};
  console.log(`8. 13 plików w 9 kadrach: żądań ${pytano.length} → ${pytano.join(', ')}`);
  console.log(`   oznaczone ${d8.sprawdzone}, opisane ${d8.opisane}, `
    + `z pary ${d8.zParowania}, zostało ${d8.zostalo}`);
  /* Osiem żądań: siedem kadrów płatnych (A, B, C, D, E×2, F×2 to osiem…
     policzmy uczciwie: A, B, C, D, E-1, E-2, F-1, F-2 = osiem) plus G za
     darmo z obejrzanego bliźniaka. */
  if (pytano.length !== 8) {
    fail.push(`o miniaturę pytano ${pytano.length} razy zamiast 8 — grupowanie kadrów nie działa`);
  }
  // Z każdej pary ma iść JPG, nigdy RAW — to jest cała oszczędność.
  for (const rawZPary of ['3B9A4860.CR3', 'DSC_1000.NEF', 'IMG_2001.CR2', '9999.CR3']) {
    if (pytano.includes(rawZPary)) {
      fail.push(`pytano o ${rawZPary}, choć obok leży JPG — to 8 s zamiast pół sekundy`);
    }
  }
  for (const jpgZPary of ['3B9A4860.JPG', 'DSC_1000.JPG', 'IMG_2001.JPG']) {
    if (!pytano.includes(jpgZPary)) fail.push(`nie zapytano o ${jpgZPary} — kadr wypadł z paczki`);
  }
  // Pułapki: seria w tej samej sekundzie i przewinięty licznik — osobne kadry.
  if (!(pytano.includes('3B9A5000.CR3') && pytano.includes('3B9A5001.CR3'))) {
    fail.push('seria z tej samej sekundy została sklejona — drugi kadr dostał cudze etykiety');
  }
  if (pytano.filter((x) => x === 'DSC_0001.JPG').length !== 2) {
    fail.push('dwa zdjęcia o tej samej nazwie z różnych lat zostały sklejone w jeden kadr');
  }
  if (d8.sprawdzone !== 12) fail.push(`oznaczono ${d8.sprawdzone} z 12 nieobejrzanych plików`);
  if (d8.zParowania !== 4) {
    fail.push(`zParowania=${d8.zParowania} zamiast 4 (A, B, C i darmowe G) — panel nie pokaże zysku`);
  }
  if (d8.zostalo !== 0) fail.push(`w kolejce zostało ${d8.zostalo} zamiast 0 — kadry wracają w kółko`);
  const poId8 = new Map(archPary.szukaj({ zrodlo: 'onedrive' }).map((w) => [w.id, w]));
  const et = (id) => (poId8.get(`onedrive:${id}`) || {}).obiekty || [];
  console.log(`   RAW z pary A: [${et('A-raw')}], RAW z pary G (darmowy): [${et('G-raw')}]`);
  for (const id of ['A-raw', 'A-jpg', 'B-raw', 'B-jpg', 'C-raw', 'C-jpg', 'D-raw']) {
    if (!et(id).includes('boat')) fail.push(`${id} nie dostał etykiety z rozpoznania`);
  }
  /* G to inny sprawdzian niż reszta: etykiety mają przyjść Z BLIŹNIAKA
     („dog"), a nie z atrapy YOLO („boat"). Gdyby przyszło „boat", znaczyłoby
     to, że i tak zapytaliśmy — czyli darmowa ścieżka nie zadziałała. */
  if (!et('G-raw').includes('dog') || et('G-raw').includes('boat')) {
    fail.push(`G-raw ma [${et('G-raw')}] zamiast [dog] — etykiety nie przeszły z obejrzanego bliźniaka`);
  }

  /* --- 8b. Podgląd RAW-a też idzie przez JPG-owego bliźniaka --------------
     Ta sama cena dotyczy panelu archiwum i siatki zdjęć w rozmowie: każdy
     kafelek z CR3 to siedem sekund czekania, aż Microsoft wygeneruje podgląd.
     Skoro obok leży JPG z tym samym kadrem, nie ma po co o RAW pytać. */
  pytano.length = 0;
  const resT = {};
  await trasyPary.handleArchiwum(
    { method: 'GET', url: '/api/archive/thumb?id=' + encodeURIComponent('onedrive:B-raw') },
    resT, '/api/archive/thumb');
  console.log(`8b. podgląd NEF-a z osobnego folderu → pytano o ${pytano.join(', ') || 'nic'}`);
  if (pytano.length !== 1 || pytano[0] !== 'DSC_1000.JPG') {
    fail.push(`podgląd RAW-a pyta o ${pytano.join(', ')} zamiast o DSC_1000.JPG — 8 s na kafelek`);
  }
  /* Plik BEZ bliźniaka ma iść po sobie samym, a nie zniknąć po drodze. */
  pytano.length = 0;
  await trasyPary.handleArchiwum(
    { method: 'GET', url: '/api/archive/thumb?id=' + encodeURIComponent('onedrive:D-raw') },
    resT, '/api/archive/thumb');
  console.log(`    RAW bez pary → pytano o ${pytano.join(', ') || 'nic'}`);
  if (pytano[0] !== 'SAM_9001.SRW') {
    fail.push(`RAW bez bliźniaka poszedł po ${pytano.join(', ')} zamiast po sobie`);
  }
  /* --- 8c. Dociągnięcie EXIF-u zmienia datę — indeks kadrów MUSI to zauważyć
     Do RAW-ów Graph nie czyta EXIF-u i wpisuje datę WGRANIA pliku; dopiero
     „Dociągnij dane z plików" podmienia ją na datę zrobienia zdjęcia. Gdyby
     indeks rodzeństwa tego nie zauważał (liczba wpisów się nie zmienia!),
     parowanie po dociągnięciu danych działałoby na starych datach. */
  const podglad = async (id) => {
    pytano.length = 0;
    await trasyPary.handleArchiwum(
      { method: 'GET', url: '/api/archive/thumb?id=' + encodeURIComponent(`onedrive:${id}`) },
      resT, '/api/archive/thumb');
    return pytano.join(', ');
  };
  archPary.dodaj([zdj('H-raw', '/Nowe/7777.CR3', '2026-08-10T09:00:00')]);
  /* Zanim EXIF poprawi datę, RAW ma datę WGRANIA — a JPG akurat tę samą co
     zupełnie inne zdjęcie (`H-inny`). Tak wygląda archiwum przed dociągnięciem
     danych i tak powstaje fałszywa para, którą trzeba potem rozpiąć. */
  archPary.dodaj([zdj('H-jpg', '/Nowe/jpg/7777.JPG', '2026-01-01T00:00:00')]);
  archPary.dodaj([zdj('H-inny', '/Nowe/jpg/7777.PNG', '2026-01-01T00:00:00')]);
  const przedExifem = await podglad('H-raw');
  const falszywaPara = await podglad('H-inny');
  // Dociągnięcie danych z pliku podmienia datę wgrania na datę zdjęcia.
  archPary.dodaj([zdj('H-jpg', '/Nowe/jpg/7777.JPG', '2026-08-10T09:00:00')]);
  const poExifie = await podglad('H-raw');
  const poRozpieciu = await podglad('H-inny');
  console.log(`8c. RAW przed dociągnięciem daty: ${przedExifem} → po: ${poExifie}`);
  console.log(`    kadr obok, sklejony starą datą: ${falszywaPara} → po: ${poRozpieciu}`);
  if (przedExifem !== '7777.CR3') {
    fail.push(`przy różnych datach sparowano mimo wszystko (${przedExifem}) — klucz ignoruje sekundę`);
  }
  if (poExifie !== '7777.JPG') {
    fail.push('po zrównaniu dat nadal pytamy o RAW — indeks kadrów nie widzi nowej daty');
  }
  /* To jest sprawdzian sprzątania po starym kluczu. Gdy przy zmianie daty
     zostawilibyśmy identyfikator w poprzednim koszyku, `H-inny` dalej miałby
     „bliźniaka", którego już nie ma — i brałby podgląd cudzego zdjęcia. */
  if (poRozpieciu !== '7777.PNG') {
    fail.push(`po rozpięciu pary sąsiad bierze podgląd z ${poRozpieciu} — stary klucz nie posprzątany`);
  }
  serwerMini.close();
  fs.rmSync(katalogPar, { recursive: true, force: true });

  /* --- 9. Zapis indeksu nie może zjadać pętli zdarzeń w trakcie pracy -----
     To jest usterka, którą wykryła arytmetyka, a nie komunikat błędu.
     U Marcina, przy dwunastu robotnikach i zmierzonych 6,1 s na żądanie,
     powinno wychodzić 1,95 żądania na sekundę. Wychodziło 1,07 — czterdzieści
     pięć procent czasu ginęło POZA mierzonymi etapami.

     Powód: zapis jest asynchroniczny, ale `JSON.stringify` już nie. Na jego
     archiwum (57 728 wpisów, 28 MB) stringify trwa 497 ms, a cały zapis
     zamraża pętlę zdarzeń na ~650 ms. Przy stałym odstępie trzech sekund
     serwer zamierał co trzecią sekundę na dwie trzecie sekundy — i wtedy
     dwanaście pobrań stało w miejscu, a stopery tykały dalej, więc pomiar
     `pobranie` sam się zawyżał.

     Tu ustawiamy odstęp podłogowy na 50 ms i mielimy przez trzy sekundy.
     Ze stałym odstępem to znaczy zapis goniący zapis; z odstępem dobranym
     do kosztu — najwyżej jeden. Liczymy tyknięcia zegara, bo tylko one mówią,
     czy serwer w tym czasie mógł cokolwiek obsłużyć. */
  process.env.COSMOS_ARCHIWUM_ZAPIS_MS = '50';
  const katalogZapis = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-zapis-'));
  const archZapis = require('../../lib/archiwum.js').utworz(katalogZapis);
  archZapis.dodaj(wpisy.map((w) => ({ ...w, miniatura: undefined })));
  await archZapis.zapisz();            // pierwszy zapis podaje koszt kolejnym
  const OKNO_MS = 3000;
  const KROK_MS = 5;
  let tyk9 = 0;
  const zegar9 = setInterval(() => { tyk9++; }, KROK_MS);
  const koniec9 = Date.now() + OKNO_MS;
  let i9 = 0;
  while (Date.now() < koniec9) {
    // Tak wygląda rozpoznawanie: co chwilę oznaczamy kolejne pliki.
    archZapis.dodaj([{ ...wpisy[i9++ % wpisy.length], obiekty: ['dog'], obejrzane: true }]);
    await new Promise((r) => setTimeout(r, 50));
  }
  clearInterval(zegar9);
  const mozliwe = Math.round(OKNO_MS / KROK_MS);
  const zablokowane = Math.max(0, Math.round((1 - tyk9 / mozliwe) * 100));
  console.log(`9. przy ciągłym oznaczaniu pętla zdarzeń stała ${zablokowane}% czasu `
    + `(${tyk9} z ${mozliwe} tyknięć)`);
  if (zablokowane > 25) {
    fail.push(`zapis indeksu zamraża serwer na ${zablokowane}% czasu pracy `
      + '— pobrania stoją, a stopery tykają dalej');
  }
  fs.rmSync(katalogZapis, { recursive: true, force: true });
  delete process.env.COSMOS_ARCHIWUM_ZAPIS_MS;

  fs.rmSync(katalog, { recursive: true, force: true });
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nTEMPO ARCHIWUM OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Kolejka wiadomości pisanych w trakcie odpowiedzi.

   Marcin: „dobre było wprowadzenie kolejkowania odpowiedzi w trakcie
   udzielania odpowiedzi przez Cosmos tak jak w Claude". Do tej pory pole
   tekstowe było w tym czasie martwe — `sendMessage` wychodziło od razu przy
   `isGenerating`, więc myśl, która przyszła w połowie czytania, trzeba było
   trzymać w głowie albo przerywać generowanie.

   Trzy rzeczy, które muszą działać, żeby to było użyteczne, a nie tylko
   „nie gubi się":

     1. Wiadomość napisana w trakcie ZOSTAJE i jest WIDOCZNA — inaczej nie
        wiadomo, czy poszła, czy przepadła.
     2. Idzie SAMA po zakończeniu odpowiedzi, w kolejności napisania.
     3. Da się ją WYJĄĆ przed wysłaniem. W połowie odpowiedzi często okazuje
        się, że pytanie było niepotrzebne, a nieodwracalna kolejka zmusza do
        wysłania czegoś, czego już się nie chce.

   Przy okazji drugie zgłoszenie z tej samej rozmowy: „Cosmos sam się wznawiał
   jako kolejne zapytanie". Sprawdzamy, że pętla narzędzi ma twardy limit
   i nie potrafi kręcić się w nieskończoność.
*/
const { srodowisko, przegladarka, maPrzegladarke, KATALOG_ZRZUTOW } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

(async () => {
  const fail = [];
  const env = await srodowisko('pelne');
  const b = await przegladarka();
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push(e.message));
  await pg.goto(env.adres, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);

  const wyslij = async (tekst) => {
    await pg.fill('#input', tekst);
    await pg.press('#input', 'Enter');
    await pg.waitForTimeout(250);
  };
  const generuje = () => pg.evaluate(() => document.getElementById('stop-btn').style.display !== 'none');
  const wKolejce = () => pg.evaluate(() => [...document.querySelectorAll('.queue-text')].map((e) => e.textContent));
  const pytania = () => pg.evaluate(() => [...document.querySelectorAll('.msg-user .msg-content')]
    .map((e) => e.textContent.trim()));

  /* ---- 1. Pierwsza wiadomość rusza normalnie ----
     „powoli" to umowa z atrapą: rozciąga strumień na kilka sekund. Bez tego
     nie ma czego kolejkować — odpowiedź kończy się, zanim test zdąży napisać
     drugie zdanie, i zestaw sprawdzałby zupełnie inną sytuację niż ta,
     w której Marcin dopisuje myśl w połowie czytania. */
  await wyslij('pierwsze pytanie powoli');
  console.log(`1. po wysłaniu pierwszej — generuje: ${await generuje()}`);
  if (!await generuje()) fail.push('pierwsza wiadomość nie uruchomiła generowania');

  /* ---- 2. Pisanie w trakcie: nie ginie, ląduje w kolejce ---- */
  await wyslij('drugie pytanie');
  await wyslij('trzecie pytanie');
  const kolejka = await wKolejce();
  console.log(`2. w kolejce: ${JSON.stringify(kolejka)}`);
  if (kolejka.length !== 2) fail.push(`w kolejce ${kolejka.length} pozycji zamiast 2`);
  if (kolejka[0] !== 'drugie pytanie') fail.push('kolejka nie zachowuje kolejności napisania');

  // Pole musi się wyczyścić — inaczej nie wiadomo, czy wiadomość poszła.
  const wPolu = await pg.inputValue('#input');
  console.log(`   pole po wysłaniu do kolejki: „${wPolu}"`);
  if (wPolu) fail.push('pole nie zostało wyczyszczone — nie wiadomo, czy wiadomość poszła');

  // Kolejkowana wiadomość NIE jest jeszcze pytaniem w rozmowie.
  const teraz = await pytania();
  console.log(`   pytań w rozmowie: ${teraz.length} (${JSON.stringify(teraz)})`);
  if (teraz.length !== 1) fail.push(`kolejkowana wiadomość trafiła do rozmowy przedwcześnie (${teraz.length})`);
  if (teraz[0] !== 'pierwsze pytanie powoli') fail.push('pierwsze pytanie nie jest pierwszym pytaniem w rozmowie');

  /* ---- 3. Wyjęcie z kolejki ----
     Bez `count()` zestaw bez kolejki nie zgłasza usterki, tylko wisi 30 s na
     kliknięciu w nieistniejący przycisk i pada wyjątkiem. Awaria ma być
     opisana, a nie zgadywana z komunikatu Playwrighta. */
  if (await pg.locator('.queue-item .queue-del').count()) {
    await pg.click('.queue-item:last-child .queue-del');
    await pg.waitForTimeout(200);
    const poUsunieciu = await wKolejce();
    console.log(`3. po usunięciu ostatniej: ${JSON.stringify(poUsunieciu)}`);
    if (poUsunieciu.length !== 1) fail.push(`po usunięciu zostało ${poUsunieciu.length} zamiast 1`);
    if (poUsunieciu[0] !== 'drugie pytanie') fail.push('usunięto niewłaściwą pozycję');
  } else {
    console.log('3. brak przycisku wyjęcia z kolejki');
    fail.push('kolejkowanej wiadomości nie da się wyjąć — brak przycisku');
  }

  /* ---- 4. Po zakończeniu odpowiedzi kolejka rusza SAMA ---- */
  for (let i = 0; i < 60 && (await generuje() || (await wKolejce()).length); i++) {
    await pg.waitForTimeout(500);
  }
  const koncowe = await pytania();
  console.log(`4. pytania w rozmowie po opróżnieniu kolejki: ${JSON.stringify(koncowe)}`);
  if (!koncowe.includes('drugie pytanie')) {
    fail.push('wiadomość z kolejki nigdy nie została wysłana');
  }
  if (koncowe.includes('trzecie pytanie')) {
    fail.push('wysłano wiadomość usuniętą z kolejki');
  }
  const zostalo = await wKolejce();
  console.log(`   kolejka po wszystkim: ${zostalo.length} pozycji`);
  if (zostalo.length) fail.push('kolejka nie opróżniła się do końca');

  /* ---- 5. Odpowiedzi przyszły na OBA pytania, w kolejności ---- */
  const odpowiedzi = await pg.evaluate(() => document.querySelectorAll('.msg-assistant').length);
  console.log(`5. odpowiedzi na ekranie: ${odpowiedzi}`);
  if (odpowiedzi < 2) fail.push(`tylko ${odpowiedzi} odpowiedzi na dwa pytania`);

  /* ---- 6. Pętla narzędzi ma twardy limit ----
     „Cosmos sam się wznawiał jako kolejne zapytanie" — to była pętla narzędzi
     widziana z zewnątrz: model wołał archiwum, dostawał wynik, wołał znowu.
     Limit istnieje w kodzie, ale musi być SPRAWDZANY, bo bez niego jedno
     pytanie potrafi zająć całą sesję. */
  const zrodlo = await (await fetch(`${env.adres}/app.js`)).text();
  const maxSzukan = (zrodlo.match(/const MAX_SEARCHES = (\d+)/) || [])[1];
  console.log(`6. MAX_SEARCHES = ${maxSzukan}`);
  if (!maxSzukan || Number(maxSzukan) > 4) {
    fail.push(`limit rund narzędzi to ${maxSzukan} — jedno pytanie może zająć całą sesję`);
  }
  // Powtórzone zapytanie do archiwum ma być odcinane, a nie wysyłane ponownie.
  if (!/pytaniaArchiwum/.test(zrodlo)) {
    fail.push('brak odcinania powtórzonych zapytań do archiwum');
  }

  /* ---- 7. Żaden ruch narzędzia nie udaje wiadomości użytkownika ----
     Wyniki narzędzi wracają do modelu z `role: 'user'` — taki jest protokół.
     Na ekranie odróżnia je JEDYNIE flaga `search`; bez niej rysuje się zwykły
     dymek z pytaniem, którego nikt nie zadał, i wygląda to dokładnie tak, jak
     Marcin to opisał: rozmowa wznawia się sama. Zamiast pilnować flagi w pięciu
     miejscach mamy jedną furtkę `dodajWynikNarzedzia` — i tu sprawdzamy, że
     nikt jej nie obszedł. */
  const ciało = zrodlo.slice(zrodlo.indexOf('async function runGeneration'),
    zrodlo.indexOf('function stopGeneration'));
  const nagie = (ciało.match(/role: 'user'/g) || []).length;
  console.log(`7. surowych wstawek role:'user' w runGeneration: ${nagie}`);
  if (nagie) {
    fail.push(`${nagie} wyników narzędzia omija dodajWynikNarzedzia — narysują się `
      + 'jako pytania, których użytkownik nie zadał');
  }
  if (!/function dodajWynikNarzedzia[\s\S]{0,300}search: true/.test(zrodlo)) {
    fail.push('dodajWynikNarzedzia nie ustawia flagi search');
  }

  await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/kolejka.png` });
  console.log(`8. błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  if (bledy.length) fail.push(`błędy JS: ${bledy.join(' | ')}`);

  await b.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKOLEJKA WIADOMOŚCI OK');
  process.exit(fail.length ? 1 : 0);
})();

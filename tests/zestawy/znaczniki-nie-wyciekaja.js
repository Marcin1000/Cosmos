/* Polecenia dla modelu nie mają prawa stanąć na ekranie jako treść.

   Marcin przysłał zapis rozmowy, w którym widniało gołe
   `[ARCHIWUM: grupuj=rok]`, a kawałek niżej pusty blok kodu bez ani jednego
   znaku w środku. Znacznik jest instrukcją dla modelu — poleceniem „sięgnij
   do archiwum" — i dla użytkownika znaczy tyle, co wyciek wewnętrznego
   protokołu. Pusty płot wygląda z kolei na zgubioną odpowiedź.

   Czyszczenie istniało od dawna, ale miało dwie dziury i obie brały się
   z tego samego założenia: że model zawsze napisze znacznik w całości,
   samodzielnie, w osobnej linii.

     1. ZNACZNIK URWANY. Wypowiedź kończy się w połowie znacznika — bo
        skończył się budżet tokenów albo Marcin nacisnął „stop". Bez
        domykającego `]` żaden wzorzec nie pasował.
     2. ZNACZNIK W PŁOCIE. Model lubi opakować polecenie w ```blok```.
        Usunięcie samego znacznika zostawiało parę płotków bez zawartości.

   Do tego przerwana odpowiedź szła na ekran zupełnie bez czyszczenia — a to
   właśnie ona najczęściej urywa się w trakcie sięgania po narzędzie.

   Zestaw sprawdza też stronę odwrotną i ważniejszą: czyszczenie nie może
   zjadać zwykłego tekstu. Nawias kwadratowy w środku zdania to nawias,
   a nie początek polecenia.
*/
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

/* [wejście, oczekiwane wyjście, opis]. Puste wyjście znaczy „ma zostać nic". */
const PRZYPADKI = [
  ['Zaraz sprawdzę.\n[ARCHIWUM: grupuj=rok]', 'Zaraz sprawdzę.',
    'znacznik w całości, na końcu wypowiedzi'],
  ['[ARCHIWUM: grupuj=rok]', '', 'sam znacznik i nic poza nim'],
  ['Sprawdzam.\n[ARCHIWUM: folder=Mazury 2026', 'Sprawdzam.',
    'znacznik urwany — zabrakło tokenów albo przerwano generowanie'],
  ['Już patrzę.\n```\n[ARCHIWUM: grupuj=aparat]\n```', 'Już patrzę.',
    'znacznik w płocie — po jego usunięciu płot ma zniknąć razem z nim'],
  ['Patrzę.\n```json\n[ARCHIWUM: rok=2026]\n```', 'Patrzę.',
    'płot z nazwą języka też'],
  ['[SZUKAJ: pogoda Mazury]', '', 'wyszukiwanie w internecie'],
  ['[PLAN: obiektyw=24-105 f/4]', '', 'plan zdjęciowy'],
  ['Dwa naraz.\n[ARCHIWUM: rok=2026]\n[SZUKAJ: zachód słońca]', 'Dwa naraz.',
    'dwa znaczniki w jednej wypowiedzi'],

  /* --- i strona odwrotna: czego ruszać NIE WOLNO --------------------------
     Wzorzec na urwany znacznik kończy się na `$`, więc łapie tylko koniec
     tekstu. Gdyby działał w środku, zjadłby resztę zdania od pierwszego
     nawiasu — a nawiasy kwadratowe są w Markdownie na porządku dziennym. */
  ['Zdjęcia [1] i [2] są ostre.', 'Zdjęcia [1] i [2] są ostre.',
    'zwykłe nawiasy w środku zdania'],
  ['Zobacz [dokumentację](https://example.com).', 'Zobacz [dokumentację](https://example.com).',
    'odnośnik w Markdownie'],
  ['Plik nazywa się [ARCHIWUM] — tak go nazwałeś.', 'Plik nazywa się  — tak go nazwałeś.',
    'znacznik bez treści też jest znacznikiem (tu akurat zjada, i tak ma być)'],
  ['```js\nconst x = 1;\n```', '```js\nconst x = 1;\n```',
    'płot z prawdziwym kodem zostaje nietknięty'],
  ['Tekst [w nawiasie] na końcu zdania.', 'Tekst [w nawiasie] na końcu zdania.',
    'nawias niebędący znacznikiem, blisko końca'],
];

(async () => {
  const fail = [];
  const env = await srodowisko('pelne');
  const br = await przegladarka();
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  await pg.goto(env.adres, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);

  /* --- 1. Czyszczenie znaczników -----------------------------------------
     Czysta funkcja z `public/protokol.js`, wywoływana wprost w Node.
     Wcześniej szła przez `page.evaluate` i sięgała po `window.stripSearchMarker`
     — co przestało istnieć w chwili, gdy funkcja przeniosła się do modułu
     i nie była już globalną deklaracją skryptu. Przeglądarka niczego tu nie
     wnosiła: to jest napis na wejściu i napis na wyjściu. */
  const { utworzProtokol } = require('../../public/protokol.js');
  const { stripSearchMarker } = utworzProtokol();
  for (const [wejscie, oczek, opis] of PRZYPADKI) {
    const got = stripSearchMarker(wejscie);
    const ok = got === oczek;
    console.log(`1. ${ok ? 'ok ' : 'ŹLE'} — ${opis}`);
    if (!ok) {
      fail.push(`${opis}: dostałem ${JSON.stringify(got)}, `
        + `spodziewane ${JSON.stringify(oczek)}`);
    }
  }

  /* --- 2. PRZERWANA ODPOWIEDŹ TEŻ PRZECHODZI PRZEZ CZYSZCZENIE ------------
     Jedyna droga, którą tekst z modelu trafiał na ekran surowy — i najczęstsza,
     bo przerywa się wtedy, gdy coś trwa za długo, czyli dokładnie w trakcie
     sięgania po narzędzie.

     Kiedyś stał tu regexp po `public/app.js`: „czy w 600 znakach za
     `AbortError` jest napis `stripSearchMarker`". Zdawał również wtedy, gdyby
     czyszczenie przeniosło się do gałęzi, którą przerwanie omija. Teraz
     naprawdę przerywamy odpowiedź w połowie znacznika i patrzymy na ekran.

     Atrapa dostaje pytanie „przerwij mnie" i odpowiada strumieniem, w którym
     `[ARCHIWUM: …` zaczyna się wcześnie, a domykający nawias stoi na końcu. */
  await pg.fill('#input', 'przerwij mnie w połowie');
  await pg.click('#send-btn');
  // Czekamy, aż w odpowiedzi pojawi się POCZĄTEK znacznika — dopiero wtedy
  // przerwanie ma co zostawić.
  await pg.waitForFunction(
    () => /\[ARCHIWUM/.test(document.querySelector('.msg-assistant')?.textContent || ''),
    null, { timeout: 15000 },
  );
  await pg.click('#stop-btn');
  await pg.waitForTimeout(1500);

  const naEkranie = await pg.evaluate(() => Array.from(document.querySelectorAll('.msg-assistant'))
    .map((e) => e.textContent).join('\n'));
  const wyciekl = /\[ARCHIWUM/.test(naEkranie);
  console.log(`2. po „stop" w połowie znacznika: ${wyciekl ? 'ZNACZNIK NA EKRANIE' : 'czysto'}`
    + ` (${naEkranie.trim().slice(0, 60)}…)`);
  if (wyciekl) {
    fail.push('przerwana odpowiedź idzie na ekran bez czyszczenia znaczników — '
      + `widać „${naEkranie.match(/\[ARCHIWUM[^\n]{0,40}/)[0]}"`);
  }
  // Sam początek wypowiedzi ma zostać — czyszczenie nie może zjeść odpowiedzi.
  if (!/Zaraz sprawdzę archiwum/.test(naEkranie)) {
    fail.push('po przerwaniu zniknęła cała odpowiedź, nie tylko znacznik');
  }

  await br.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nZNACZNIKI NIE WYCIEKAJĄ OK');
  process.exit(fail.length ? 1 : 0);
})();

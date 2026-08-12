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
  const env = await srodowisko('goly');
  const br = await przegladarka();
  const ctx = await br.newContext({ viewport: { width: 1280, height: 800 } });
  const pg = await ctx.newPage();
  await pg.goto(env.adres, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);

  // --- 1. Czyszczenie znaczników ------------------------------------------
  for (const [wejscie, oczek, opis] of PRZYPADKI) {
    const got = await pg.evaluate((s) => window.stripSearchMarker(s), wejscie);
    const ok = got === oczek;
    console.log(`1. ${ok ? 'ok ' : 'ŹLE'} — ${opis}`);
    if (!ok) {
      fail.push(`${opis}: dostałem ${JSON.stringify(got)}, `
        + `spodziewane ${JSON.stringify(oczek)}`);
    }
  }

  /* --- 2. Przerwana odpowiedź też przechodzi przez czyszczenie ------------
     Jedyna droga, którą tekst z modelu trafiał na ekran surowy. Sprawdzamy
     to na kodzie, bo odtworzenie przerwania w przeglądarce wymagałoby
     modelu, który urywa w środku znacznika — a to akurat sytuacja, której
     atrapa nie odda wiernie. */
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.js'), 'utf8');
  /* Szukamy od obsługi PRZERWANIA, nie od pierwszego `err.partial` w pliku —
     to drugie trafia w miejsce, gdzie treść jest do `err.partial`
     PRZYPISYWANA, a nas interesuje miejsce, w którym trafia na ekran. */
  const przerwanie = app.match(/AbortError'\)\s*\{[\s\S]{0,600}?conv\.messages\.push/);
  const czysci = przerwanie && /stripSearchMarker/.test(przerwanie[0]);
  console.log(`2. przerwana odpowiedź przechodzi przez czyszczenie: ${czysci ? 'tak' : 'NIE'}`);
  if (!czysci) {
    fail.push('przerwana odpowiedź (`err.partial`) idzie na ekran bez czyszczenia znaczników');
  }

  await br.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nZNACZNIKI NIE WYCIEKAJĄ OK');
  process.exit(fail.length ? 1 : 0);
})();

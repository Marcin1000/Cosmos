/* Lektor odmienia liczby.

   Marcin: „w trybie głosowym należy poprawić odmianę liczb, bo teraz mówi je
   w ogóle ich nie odmieniając”. Każdy silnik mowy czyta cyfry w mianowniku:
   „do dwadzieścia jeden stopni”, „o siedemnaście zero zero”, „dwanaście
   września”, „dwa godziny”.

   `liczbyNaGlos` (public/protokol.js) wołana wprost w Node – i razem
   z `jednostkiNaGlos`, bo tak idzie tekst do lektora:
     1. godziny w przypadku od słowa przed nimi (o, od, do, przed, między… a…),
     2. przyimki z dopełniaczem („do”, „od”, „około”, „dla”, „powyżej”…),
     3. daty i lata („12 września 2027 roku”, „6 wrz”, „we wrześniu 2027”),
     4. rodzaj żeński („2 godziny”, „22 minuty”, „1 osoba”),
     5. czego nie da się ustalić pewnie – zostaje cyframi (ułamki, „12 godzin”,
        „3 tysiące”, numery, godziny bez przyimka w mianowniku).
*/
const { utworzProtokol } = require('../../public/protokol.js');

const { liczbyNaGlos, jednostkiNaGlos, liczbaSlownie } = utworzProtokol();
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

const PRZYPADKI = [
  // 1. godziny
  ['Świt o 6:41, zachód o 19:05.', 'Świt o szóstej czterdzieści jeden, zachód o dziewiętnastej zero pięć.'],
  ['Od 17:30 do 18:00 najlepsze światło.', 'Od siedemnastej trzydzieści do osiemnastej najlepsze światło.'],
  ['Przed 18:00 zamykają.', 'Przed osiemnastą zamykają.'],
  ['Między 7:00 a 9:00.', 'Między siódmą a dziewiątą.'],
  ['Pobudka: 5:15.', 'Pobudka: piąta piętnaście.'],
  ['Po 22:00 cisza.', 'Po dwudziestej drugiej cisza.'],
  // 2. przyimki z dopełniaczem
  ['Temperatura od 20 do 28 stopni.', 'Temperatura od dwudziestu do dwudziestu ośmiu stopni.'],
  ['Około 5 kilometrów pod górę.', 'Około pięciu kilometrów pod górę.'],
  ['Bilet dla 2 osób kosztuje 30 zł.', 'Bilet dla dwóch osób kosztuje 30 zł.'],
  ['Powyżej 1500 metrów leży śnieg.', 'Powyżej tysiąca pięciuset metrów leży śnieg.'],
  ['Do 21 stopni.', 'Do dwudziestu jeden stopni.'],
  // 3. daty i lata
  ['Wyjazd 12 września 2027 roku.', 'Wyjazd dwunastego września dwa tysiące dwudziestego siódmego roku.'],
  ['Poniedziałek 6 wrz, wtorek 7 wrz.', 'Poniedziałek szóstego września, wtorek siódmego września.'],
  ['Od 6 wrz. do 12 wrz. jest ciepło.', 'Od szóstego września do dwunastego września jest ciepło.'],
  ['We wrześniu 2027 będzie ciepło.', 'We wrześniu dwa tysiące dwudziestego siódmego będzie ciepło.'],
  ['W 2000 r. i w 1989 roku.', 'W dwutysięcznego roku i w tysiąc dziewięćset osiemdziesiątego dziewiątego roku.'],
  ['1 stycznia i 31 grudnia.', 'pierwszego stycznia i trzydziestego pierwszego grudnia.'],
  // 4. rodzaj żeński
  ['Przejazd trwa 2 godziny.', 'Przejazd trwa dwie godziny.'],
  ['Potem 22 minuty spaceru.', 'Potem dwadzieścia dwie minuty spaceru.'],
  ['1 osoba płaci, 2 noce w hotelu.', 'jedna osoba płaci, dwie noce w hotelu.'],
  // Runda 7 (agencja-rozmowa): przypadek z końcówki rzeczownika, godziny bez dwukropka, lata po przyimku.
  ['Po 2 godzinach wracamy.', 'Po dwóch godzinach wracamy.'],
  ['Z 2 osobami.', 'Z dwiema osobami.'],
  ['Za 1 minutę.', 'Za jedną minutę.'],
  ['Dla 1 osoby.', 'Dla jednej osoby.'],
  ['Około 2 godziny jazdy.', 'Około dwie godziny jazdy.'],
  ['Czynne od 9 do 17.', 'Czynne od dziewiątej do siedemnastej.'],
  ['Od 2019 do 2023 roku.', 'Od dwa tysiące dziewiętnastego do dwa tysiące dwudziestego trzeciego roku.'],
  ['Działa od 2019.', 'Działa od dwa tysiące dziewiętnastego.'],
  ['Do 2000 metrów.', 'Do dwóch tysięcy metrów.'],
  ['Od 9 do 17 stopni to za mało.', 'Od dziewięciu do siedemnastu stopni to za mało.'],
];
const ZOSTAJE = [
  'Zostało 12 godzin i 5 dni.',
  'Ma 2,5 km i 1987 m wysokości.',
  'Ok. 3 tysiące ludzi.',
  'Wybierz opcję 2 z listy.',
  'Dom ma numer 12, a mieszkanie 4.',
  'Kup 2 bilety.',
  '21 osób i 12 minut.',
  // Odstęp tysięcy to jedna liczba – nie „około jednego 500 zł”.
  'ok. 1 500 zł',
  'Przyjdzie 36 000 osób.',
  'Skala 1:25 000.',
];

for (const [wej, oczek] of PRZYPADKI) {
  const wyn = liczbyNaGlos(wej);
  ok(wyn === oczek, `„${wej}” → „${wyn}”${wyn === oczek ? '' : `  (oczekiwane: „${oczek}”)`}`);
}
for (const zdanie of ZOSTAJE) {
  const wyn = liczbyNaGlos(zdanie);
  ok(wyn === zdanie, `zostaje: „${zdanie}”${wyn === zdanie ? '' : ` → „${wyn}”`}`);
}

// Razem z jednostkami – tak, jak idzie do lektora.
const razem = (x) => liczbyNaGlos(jednostkiNaGlos(x, 'pl'));
const R = [
  ['Jutro 20–28 °C.', /od dwudziestu do dwudziestu ośmiu stopni/],
  ['Do 21 °C w południe.', /Do dwudziestu jeden stopni/],
  ['Przejazd ok. 2 h.', /(około|ok\.) dwóch godzin|około 2 godzin|dwie godziny/],
];
for (const [wej, wzor] of R) {
  const wyn = razem(wej);
  ok(wzor.test(wyn), `z jednostkami: „${wej}” → „${wyn}”`);
}

// Liczebniki na wyrywki.
const LICZBY = [[0, 'm', 'zero'], [15, 'd', 'piętnastu'], [100, 'm', 'sto'], [212, 'd', 'dwustu dwunastu'],
  [2001, 'm', 'dwa tysiące jeden'], [21000, 'm', 'dwadzieścia jeden tysięcy'], [2000, 'd', 'dwóch tysięcy'],
  [12345, 'm', 'dwanaście tysięcy trzysta czterdzieści pięć']];
for (const [n, p, oczek] of LICZBY) ok(liczbaSlownie(n, p) === oczek, `liczebnik ${n} (${p}) → „${liczbaSlownie(n, p)}”`);

console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : `\nLICZBY NA GŁOS OK (${PRZYPADKI.length} odmian, ${ZOSTAJE.length} bez zmian)`);
process.exit(fail.length ? 1 : 0);

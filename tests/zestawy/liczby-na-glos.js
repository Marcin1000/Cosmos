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
  /* Zakresy „około 8–9” (runda 8, zrzut z trybu głosowego: „około ośmiu-9
     stopni”, „dwunastu-15 kilometrów”) – każdy łącznik, jaki piszą modele. */
  ['W nocy spadnie do około 8-9 °C.', /^W nocy spadnie do około ośmiu do dziewięciu stopni Celsjusza\.$/],
  ['Wiatr około 12\u201115 km/h.', /^Wiatr około dwunastu do piętnastu kilometrów na godzinę\.$/],
  ['Około 8\u20139 stopni w nocy.', /^Około ośmiu do dziewięciu stopni w nocy\.$/],
  ['Temperatura 8\u22129 °C.', /^Temperatura od ośmiu do dziewięciu stopni Celsjusza\.$/],
  ['Test COVID-19 jutro.', /^Test COVID-19 jutro\.$/],
  ['Do 21 °C w południe.', /Do dwudziestu jeden stopni/],
  ['Przejazd ok. 2 h.', /(około|ok\.) dwóch godzin|około 2 godzin|dwie godziny/],
];
for (const [wej, wzor] of R) {
  const wyn = razem(wej);
  ok(wzor.test(wyn), `z jednostkami: „${wej}” → „${wyn}”`);
}

/* Runda 9 (agencja-rozmowa): zakresy na końcu zdania, jednostka w dopełniaczu
   po przyimku, zakresy dat, ogólne „A–B słowo”, „o 6:55–7:10”, minus. */
const R9 = [
  // Zakres po „około” na końcu zdania i przed przecinkiem – kształt odpowiedzi w trybie głosowym.
  ['Ile stopni? Około 8–9.', 'Ile stopni? Około ośmiu do dziewięciu.'],
  ['Będzie ich około 20–30, może więcej.', 'Będzie ich około dwudziestu do trzydziestu, może więcej.'],
  ['Około 8–9 (w nocy mniej).', 'Około ośmiu do dziewięciu (w nocy mniej).'],
  // Jednostka po przyimku w dopełniaczu.
  ['Spadnie do 2 °C.', 'Spadnie do dwóch stopni Celsjusza.'],
  ['Najcieplej około 22–24 °C.', 'Najcieplej około dwudziestu dwóch do dwudziestu czterech stopni Celsjusza.'],
  ['Wiatr do 3 m/s.', 'Wiatr do trzech metrów na sekundę.'],
  ['Około 2 km.', 'Około dwóch kilometrów.'],
  ['Do 1 km.', 'Do jednego kilometra.'],
  ['Powyżej 23 %.', 'Powyżej dwudziestu trzech procent.'],
  // Bez przyimku forma zostaje po liczbie.
  ['Na zewnątrz 2 °C.', 'Na zewnątrz 2 stopnie Celsjusza.'],
  ['Szczyt 1 km dalej.', 'Szczyt 1 kilometr dalej.'],
  // Zakres dat.
  ['Festiwal trwa 12–14 września.', 'Festiwal trwa od dwunastego do czternastego września.'],
  ['Festiwal trwa od 12 do 14 września.', 'Festiwal trwa od dwunastego do czternastego września.'],
  ['W dniach 1–3 paź.', 'W dniach od pierwszego do trzeciego października.'],
  // Ogólny zakres przed słowem: przy 5+ „od … do …”, przy 2–4 tak, jak mówi się na głos.
  ['Zostań 3–5 dni.', 'Zostań od trzech do pięciu dni.'],
  ['Będzie 10–20 osób.', 'Będzie od dziesięciu do dwudziestu osób.'],
  ['Zajmie to 2–3 godziny.', 'Zajmie to dwie, trzy godziny.'],
  ['Będzie około 2–3 godziny marszu.', 'Będzie około dwie, trzy godziny marszu.'],
  ['Wystarczą 2–3 tygodnie.', 'Wystarczą dwa, trzy tygodnie.'],
  // Godziny po „o” – bez „o od”.
  ['Złota godzina o 6:55–7:10.', 'Złota godzina o szóstej pięćdziesiąt pięć do siódmej dziesięć.'],
  // Minus: w zakresie ujemnym i w działaniu.
  ['Nocą od -5 do -2 °C.', 'Nocą od minus pięciu do minus dwóch stopni Celsjusza.'],
  ['Nocą -3–-1 °C.', 'Nocą od minus trzech do minus jednego stopnia Celsjusza.'],
  ['Nocą około −3 °C.', 'Nocą około minus trzech stopni Celsjusza.'],
  ['Wynik: 10 − 4 = 6.', 'Wynik: 10 minus 4 = 6.'],
  ['Jutro około 8−9 °C.', 'Jutro około ośmiu do dziewięciu stopni Celsjusza.'],
  // Co zostaje: wynik meczu, COVID-19.
  ['Mecz skończył się 2–1.', 'Mecz skończył się 2–1.'],
  ['Test COVID-19 jutro.', 'Test COVID-19 jutro.'],
];
const wyniki9 = [];
for (const [wej, oczek] of R9) {
  const wyn = razem(wej);
  wyniki9.push(wyn);
  ok(wyn === oczek, `runda 9: „${wej}” → „${wyn}”${wyn === oczek ? '' : `  (oczekiwane: „${oczek}”)`}`);
}
// Gwarancja ogólna: słowo nigdy nie jest sklejone kreską z cyfrą („ośmiu–9”), nigdy „o od”.
for (const wyn of [...wyniki9, ...R.map(([w]) => razem(w))]) {
  ok(!/\p{L}–\d/u.test(wyn) && !/(?:^|\s)o od\s/iu.test(wyn), `bez „słowo–cyfra” i „o od”: „${wyn}”`);
}
/* Gwarancja dopełniacza: po przyimku jednostka nigdy w formie „2–4” ani
   w mianowniku liczby pojedynczej – dla liczb, których forma różni się od
   dopełniacza (1, 2, 3, 4, 22, 23, 24). */
const ZLA_FORMA = /\b(?:stopnie|stopień|kilometry|kilometr|metry|metr)(?!\p{L})/u;
for (const n of [1, 2, 3, 4, 22, 23, 24]) {
  for (const j of ['°C', 'km', 'm/s', '%']) {
    for (const wej of [`Do ${n} ${j}.`, `Około ${n >= 21 ? 21 : 0}–${n} ${j}.`, `Powyżej ${n} ${j}.`]) {
      const wyn = razem(wej);
      ok(!ZLA_FORMA.test(wyn) && !/\d/.test(wyn), `dopełniacz: „${wej}” → „${wyn}”`);
    }
  }
}
// Po angielsku bez zmian w zasadach: „from 8 to 9”, „about 8 to 9”.
const en = (x) => jednostkiNaGlos(x, 'en');
ok(en('Tomorrow about 8–9 °C.') === 'Tomorrow about 8 to 9 degrees Celsius.', `EN: „${en('Tomorrow about 8–9 °C.')}”`);
ok(en('At night from -5 to -2 °C.') === 'At night from minus 5 to minus 2 degrees Celsius.', `EN: „${en('At night from -5 to -2 °C.')}”`);

// Liczebniki na wyrywki.
const LICZBY = [[0, 'm', 'zero'], [15, 'd', 'piętnastu'], [100, 'm', 'sto'], [212, 'd', 'dwustu dwunastu'],
  [2001, 'm', 'dwa tysiące jeden'], [21000, 'm', 'dwadzieścia jeden tysięcy'], [2000, 'd', 'dwóch tysięcy'],
  [12345, 'm', 'dwanaście tysięcy trzysta czterdzieści pięć']];
for (const [n, p, oczek] of LICZBY) ok(liczbaSlownie(n, p) === oczek, `liczebnik ${n} (${p}) → „${liczbaSlownie(n, p)}”`);

console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : `\nLICZBY NA GŁOS OK (${PRZYPADKI.length} odmian, ${ZOSTAJE.length} bez zmian)`);
process.exit(fail.length ? 1 : 0);

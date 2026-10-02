/* Instrukcje narzędzi dla modelu – gwarancje rundy 11 (bez serwera).

   Składamy instrukcje naprawdę (zbudujInstrukcje, blokWkladowZespolu) i
   patrzymy na to, co pojedzie do modelu – nie na brzmienie pliku.

   Gwarancje:
   1. SZUKAJ i PLAN (pełne i krótkie): „napisz SAM znacznik”, bez „zakończ
      odpowiedź osobną linią” – to dawało pełną odpowiedź z pamięci, a po
      wynikach drugą (R1, dwa plany na ekranie);
   2. SZUKAJ: zapytanie 3–8 słów, jedna sprawa; odpowiedź po polsku z polskimi
      nazwami miejsc (Syrakuzy);
   3. PLAN: przy innym miejscu lub dniu zawsze miejsce= i kiedy=, sam miesiąc
      = 15. dzień; opis dostaje też osoba bez zapisanej lokalizacji – z zasadą,
      że miejsce= jest wtedy obowiązkowe (R3);
   4. GRAFIKA: plan na kilka dni jako „### Dzień N”, znacznik pod nagłówkiem,
      bez tabeli (R2, R6);
   5. notatki zespołu: punkt o [GRAFIKA:] tylko przy prośbie o zdjęcia (nie
      przy „planie zdjęciowym”, nie w głosie); źródła tylko z adresów
      z notatek, bez adresów – bez sekcji „Źródła” (R5).
*/
const path = require('node:path');

const KORZEN = path.join(__dirname, '..', '..');
const { zbudujInstrukcje, blokWkladowZespolu } = require(path.join(KORZEN, 'lib', 'instrukcje-narzedzi.js'));

const fail = [];
const ok = (warunek, opis) => { console.log(`${warunek ? '✓' : '✗'} ${opis}`); if (!warunek) fail.push(opis); };

const zloz = ({ krotko = false, wspolrzedne = { lat: 52.23, lon: 21.01 } } = {}) => zbudujInstrukcje({
  payload: {}, krotko, bezNarzedzi: false,
  archiwum: { ile: () => 0 }, userWspolrzedne: wspolrzedne,
  procedury: () => [], urzadzenia: () => [], imageProviders: () => [],
  KOD_WLACZONY: false, capabilityText: '',
}).map((b) => b.content);
const blok = (bloki, re) => bloki.find((t) => re.test(t)) || '';
const ZAKONCZ = /zakończ\s+(swoją\s+)?odpowiedź\s+(osobną\s+)?lini/i;

// 1–2. SZUKAJ
for (const krotko of [false, true]) {
  const b = zloz({ krotko });
  const szukaj = blok(b, /^NARZĘDZIE – (INTERNET|WYSZUKIWANIE W INTERNECIE)/);
  ok(szukaj && /SAM\s+znacznik/.test(szukaj) && /bez odpowiedzi i bez zapowiedzi|bez zapowiedzi/.test(szukaj) && !ZAKONCZ.test(szukaj),
    `1. SZUKAJ (${krotko ? 'krótko' : 'pełne'}): sam znacznik bez zapowiedzi, nie „zakończ odpowiedź”`);
  ok(/3–8 słów, jedna sprawa/.test(szukaj), `2. SZUKAJ (${krotko ? 'krótko' : 'pełne'}): zapytanie 3–8 słów, jedna sprawa`);
}
ok(/Syrakuzy/.test(blok(zloz(), /^NARZĘDZIE – WYSZUKIWANIE W INTERNECIE/)) && /bez angielskich wtrąceń/.test(blok(zloz(), /^NARZĘDZIE – WYSZUKIWANIE W INTERNECIE/)),
  '2. SZUKAJ: odpowiedź z polskimi nazwami miejsc (Syrakuzy), bez angielskich wtrąceń');

// 3. PLAN
for (const krotko of [false, true]) {
  for (const wspolrzedne of [{ lat: 52.23, lon: 21.01 }, null]) {
    const opis = `${krotko ? 'krótko' : 'pełne'}, ${wspolrzedne ? 'z lokalizacją' : 'bez lokalizacji'}`;
    const plan = blok(zloz({ krotko, wspolrzedne }), /^NARZĘDZIE – PLAN ZDJĘCIOWY/);
    ok(plan && /SAM\s+znacznik/.test(plan) && !ZAKONCZ.test(plan) && /miejsce= i kiedy=/.test(plan) && /15\. dzień/.test(plan),
      `3. PLAN (${opis}): opis jest, sam znacznik, przy innym miejscu/dniu miejsce= i kiedy=, sam miesiąc = 15. dzień`);
    ok(wspolrzedne ? !/nie jest zapisana/.test(plan) : /zawsze podaj miejsce=/.test(plan),
      `3. PLAN (${opis}): ${wspolrzedne ? 'bez zdania o braku lokalizacji' : 'miejsce= obowiązkowe'}`);
  }
}

// 4. GRAFIKA
{
  const pelna = blok(zloz(), /^NARZĘDZIE – WYSZUKIWANIE GRAFIK/);
  const krotka = blok(zloz({ krotko: true }), /^NARZĘDZIE – ZDJĘCIA Z INTERNETU/);
  ok(/### Dzień 1/.test(pelna) && /\*\*Światło:\*\*/.test(pelna) && /\*\*Aparat:\*\*/.test(pelna) && /Bez tabeli/.test(pelna),
    '4. GRAFIKA (pełna): plan dzień po dniu – „### Dzień N”, Światło, Aparat, bez tabeli');
  ok(/### Dzień 1/.test(krotka) && /Bez tabeli/.test(krotka), '4. GRAFIKA (krótka): „### Dzień N” i bez tabeli');
}

// 5. Notatki zespołu
{
  const zAdresem = [{ nazwa: 'Badacz', model: 'm', tekst: 'WNIOSKI: otwarte 9–19 (https://www.parcovalledeitempli.it/orari)' }];
  const bezAdresu = [{ nazwa: 'Fotograf', model: 'm', tekst: 'WNIOSKI: złota godzina 18:33–19:08' }];
  const GRAFIKA = /\[GRAFIKA: nazwa miejsca\]/;
  const zdj = blokWkladowZespolu({ wklady: bezAdresu, pytanie: 'Plan wyjazdu na Sycylię na 5 dni ze zdjęciami miejsc' });
  const planZdj = blokWkladowZespolu({ wklady: bezAdresu, pytanie: 'Zrób plan zdjęciowy na złotą godzinę' });
  const glos = blokWkladowZespolu({ wklady: bezAdresu, pytanie: 'pokaż zdjęcia Etny', trybGlosowy: true });
  const jawnie = blokWkladowZespolu({ wklady: bezAdresu, zdjecia: true });
  ok(GRAFIKA.test(zdj) && GRAFIKA.test(jawnie) && !GRAFIKA.test(planZdj) && !GRAFIKA.test(glos),
    '5. notatki: punkt o [GRAFIKA:] przy prośbie o zdjęcia; nie przy „planie zdjęciowym” i nie w głosie');
  const zr = blokWkladowZespolu({ wklady: zAdresem, pytanie: 'godziny otwarcia' });
  const bez = blokWkladowZespolu({ wklady: bezAdresu, pytanie: 'godziny otwarcia' });
  ok(/tylko adresy stron z notatek/.test(zr) && !/nie rób z nich sekcji „Źródła”/.test(zr)
    && /nie rób z nich sekcji „Źródła”/.test(bez) && !/źródła z notatek podaj|tylko adresy stron/.test(bez),
    '5. notatki: źródła tylko z adresów z notatek; bez adresów – bez sekcji „Źródła”');
}

console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\ninstrukcje-narzedzi OK');
process.exit(fail.length ? 1 : 0);

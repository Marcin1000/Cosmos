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
   Runda 12 (agencja-rozmowa):
   6. przykłady znaczników zdjęć mają prawdziwe nazwy – przepisany dosłownie
      daje pasek (szablon „miejsce” dawał podpis „miejsce”);
   7. zasady notatek przy prośbie o zdjęcia: plan BEZ TABELI, „### Dzień N”,
      bez sekcji „Zdjęcia” – po „TERAZ napisz”, nie tylko w opisie narzędzia;
   8. zakres planu fotografa to punkt zasad po „TERAZ napisz”, nie <wklad>;
   9. pytanie o okolicę bez badacza → reguła [SZUKAJ:]; z badaczem – nie;
   10. bezOpisuSzukania zdejmuje opis [SZUKAJ:], a opis zdjęć zostaje;
   11. SZUKAJ: zapytanie w języku rozmowy, nazw miejsc w okolicy nie wymyślać.
*/
const path = require('node:path');

const KORZEN = path.join(__dirname, '..', '..');
const { zbudujInstrukcje, blokWkladowZespolu, bezOpisuSzukania } = require(path.join(KORZEN, 'lib', 'instrukcje-narzedzi.js'));
const protokol = require(path.join(KORZEN, 'public', 'protokol.js')).utworzProtokol();

const fail = [];
const ok = (warunek, opis) => { console.log(`${warunek ? '✓' : '✗'} ${opis}`); if (!warunek) fail.push(opis); };

const zlozBloki = ({ krotko = false, wspolrzedne = { lat: 52.23, lon: 21.01 } } = {}) => zbudujInstrukcje({
  payload: {}, krotko, bezNarzedzi: false,
  archiwum: { ile: () => 0 }, userWspolrzedne: wspolrzedne,
  procedury: () => [], urzadzenia: () => [], imageProviders: () => [],
  KOD_WLACZONY: false, capabilityText: '',
});
const zloz = (o) => zlozBloki(o).map((b) => b.content);
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
  const GRAFIKA = /BEZ TABELI[^\n]*\[GRAFIKA: [^\]]+\]/;
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

// 6. Przykłady znaczników zdjęć: przepisany dosłownie daje pasek z prawdziwym miejscem.
{
  const teksty = [...zloz(), ...zloz({ krotko: true }), blokWkladowZespolu({ wklady: [], zdjecia: true })];
  const przyklady = teksty.flatMap((t) => [...t.matchAll(/\[GRAFIKA:\s*([^\]]+)\]/g)].map((m) => m[0]));
  const szablony = przyklady.filter((zn) => protokol.rozlozZdjecia(zn).zdjecia.length === 0);
  ok(przyklady.length >= 4 && !szablony.length,
    `6. przykłady [GRAFIKA:] (${przyklady.length}) przepisane dosłownie dają pasek – bez szablonów${szablony.length ? ': ' + szablony.join(', ') : ''}`);
}

// 7–9. Zasady pod notatkami („TERAZ napisz…”) – to ostatnie słowo przed odpowiedzią.
{
  const wklady = [{ nazwa: 'Fotograf', model: 'm', tekst: 'WNIOSKI: złota godzina 18:33–19:08' }];
  const zasady = (o) => { const t = blokWkladowZespolu({ wklady, ...o }); return { calosc: t, po: t.split('TERAZ napisz')[1] || '' }; };
  const zdj = zasady({ pytanie: 'Plan wyjazdu na Sycylię na 7 dni ze zdjęciami miejsc' });
  ok(/BEZ TABELI/.test(zdj.po) && /### Dzień 1 · Palermo/.test(zdj.po) && /sekcji „Zdjęcia” nie rób/.test(zdj.po)
    && /\*\*Światło:\*\*/.test(zdj.po) && /\*\*Aparat:\*\*/.test(zdj.po),
    '7. zasady przy prośbie o zdjęcia: BEZ TABELI, „### Dzień N”, Światło/Aparat, bez sekcji „Zdjęcia”');
  ok(!/BEZ TABELI/.test(zasady({ pytanie: 'Ile kosztuje bilet do Doliny Świątyń?' }).po), '7. bez prośby o zdjęcia – bez zasad planu ze zdjęciami');

  const wWkladzie = (t, re) => [...t.matchAll(/<wklad[\s\S]*?<\/wklad>/g)].some((m) => re.test(m[0]));
  const plan = zasady({ pytanie: 'Plan zdjęciowy Sycylia', zakresPlanu: { ok: true, miejsce: 'Taormina', chwila: '15.09.2027 06:50', strefa: 'Europe/Rome' } });
  const brak = zasady({ pytanie: 'Plan zdjęciowy Sycylia', zakresPlanu: { ok: false, powod: 'pytanie dotyczy wyjazdu' } });
  const bezFotografa = zasady({ pytanie: 'Plan zdjęciowy Sycylia' });
  ok(/WYŁĄCZNIE z planu policzonego dla: Taormina, 15\.09\.2027 06:50/.test(plan.po) && !wWkladzie(plan.calosc, /Taormina/)
    && /nie policzono \(pytanie dotyczy wyjazdu\)[^\n]*nie podawaj z pamięci/.test(brak.po) && !wWkladzie(brak.calosc, /nie policzono/)
    && !/WYŁĄCZNIE z planu|nie policzono/.test(bezFotografa.po),
    '8. zakres planu (policzony / niepoliczony) to punkt zasad po „TERAZ napisz”, nie <wklad>; bez fotografa – brak');

  const OKOLICA = /\[SZUKAJ: <miejscowość> okolice/;
  const q = 'Plan wycieczki foto blisko Złotokłosu.';
  ok(OKOLICA.test(zasady({ pytanie: q }).po) && !OKOLICA.test(zasady({ pytanie: q, badacz: true }).po)
    && !OKOLICA.test(zasady({ pytanie: q, szukanieDostepne: false }).po)
    && !OKOLICA.test(zasady({ pytanie: 'Jakie nastawy na zachód słońca?' }).po)
    && !OKOLICA.test(zasady({ pytanie: q, trybGlosowy: true }).po),
    '9. pytanie o okolicę bez badacza → [SZUKAJ:] w zasadach; z badaczem, bez szukania, w głosie i przy innym pytaniu – nie');
  ok(/w polskiej formie[^\n]*Syrakuzy/.test(zdj.po), '9. zasady: polskie nazwy miejsc (Syrakuzy), bez angielskich');
}

// 10–11. Opis wyszukiwania: zdejmowany po badaczu, zapytanie w języku rozmowy.
for (const krotko of [false, true]) {
  const bloki = zlozBloki({ krotko });
  const bez = bezOpisuSzukania([{ role: 'system', content: 'Jesteś Cosmos.' }, ...bloki, { role: 'user', content: 'NARZĘDZIE – INTERNET: tekst człowieka' }]);
  const tresci = bez.map((m) => m.content);
  ok(!tresci.some((t) => /\[SZUKAJ: zapytanie\]/.test(t)) && tresci.some((t) => /\[GRAFIKA:/.test(t))
    && tresci.length === bloki.length + 1 && tresci.includes('NARZĘDZIE – INTERNET: tekst człowieka'),
    `10. bezOpisuSzukania (${krotko ? 'krótko' : 'pełne'}): bez opisu [SZUKAJ:], opis zdjęć i reszta zostają`);
  const szukaj = blok(zloz({ krotko }), /^NARZĘDZIE – (INTERNET|WYSZUKIWANIE W INTERNECIE)/);
  ok(/zapytanie[^.]*w języku rozmowy/i.test(szukaj) && /nie wymyślaj nazw|nazw nie wymyślaj/.test(szukaj),
    `11. SZUKAJ (${krotko ? 'krótko' : 'pełne'}): zapytanie w języku rozmowy; miejsc w okolicy nie wymyślać – najpierw szukać`);
}

console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\ninstrukcje-narzedzi OK');
process.exit(fail.length ? 1 : 0);

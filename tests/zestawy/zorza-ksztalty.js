/* Prognoza Kp — cztery układy tych samych danych, jeden wynik.

   Pierwsza wersja czytnika zakładała UKŁAD KOLUMN: „czas to w[0], Kp to w[1],
   pierwszy wiersz to nagłówek, więc go pomiń". Atrapa była zbudowana z tego
   samego założenia, więc wszystko zgadzało się samo ze sobą — i przez to
   nie znaczyło nic.

   Rozstrzygnęło pierwsze uruchomienie na serwerze Marcina: adres NOAA
   odpowiedział, a prognoza wyszła PUSTA. Pusta prognoza jest stanem
   dozwolonym (zorza to dodatek, nie może niczego blokować), więc nic nie
   krzyknęło — usterka mogła tam siedzieć dowolnie długo.

   Stąd ten zestaw. Nie sprawdza „czy nasza atrapa pasuje do naszego kodu",
   tylko czy czytnik przeżyje ZMIANĘ po stronie NOAA, na którą nie mamy
   wpływu: brak wiersza nagłówka, przestawione kolumny, obiekty zamiast
   tablic. Danych jest za każdym razem tyle samo — ma wyjść to samo.

   POTWIERDZONE NA ŻYWO (serwer Marcina, 2026-08-09): NOAA oddaje
   `tablicę obiektów (81; time_tag, kp, observed, noaa_scale)` — czyli układ
   „obiekty zamiast tablic" z listy niżej. Tak też wygląda teraz atrapa
   w `mock-grafiki.js`. Pozostałe trzy układy zostają w tym zestawie
   celowo: raz już nas zaskoczyli, a rozpoznawanie pól nic nie kosztuje.

   ⚠ Czego to nadal NIE dowodzi: że układ nie zmieni się jutro. Z tego
   kontenera nie widzę NOAA ani razu (403), więc potwierdzenie przychodzi
   z wydruku `scripts/zorza.js` u Marcina, nie z mojego przebiegu.
*/
const http = require('node:http');
const { zwolnijPorty } = require('../pomoc');

const PORT = 7789;
const zaGodzin = (h) => new Date(Date.now() + h * 3600e3).toISOString().replace('T', ' ').slice(0, 19);

/* Te same trzy wartości w czterech układach. Wpis sprzed doby jest wszędzie
   i wszędzie ma wypaść — prognoza dotyczy przyszłości. */
function ksztalty() {
  const przeszlosc = zaGodzin(-24);
  const za3 = zaGodzin(3);
  const za6 = zaGodzin(6);
  return {
    'z naglowkiem': [
      ['time_tag', 'kp', 'observed', 'noaa_scale'],
      [przeszlosc, '3.00', 'observed', null],
      [za3, '5.67', 'predicted', 'G1'],
      [za6, '7.33', 'predicted', 'G3'],
    ],
    'bez naglowka': [
      [przeszlosc, '3.00', 'observed', null],
      [za3, '5.67', 'predicted', 'G1'],
      [za6, '7.33', 'predicted', 'G3'],
    ],
    'inna kolejnosc kolumn': [
      ['kp', 'time_tag', 'observed'],
      ['3.00', przeszlosc, 'observed'],
      ['5.67', za3, 'predicted'],
      ['7.33', za6, 'predicted'],
    ],
    'obiekty zamiast tablic': [
      { time_tag: przeszlosc, kp: '3.00', observed: 'observed' },
      { time_tag: za3, kp: '5.67', observed: 'predicted' },
      { time_tag: za6, kp: '7.33', observed: 'predicted' },
    ],
    // Dwa stany, w których pusto jest POPRAWNĄ odpowiedzią.
    'pusta tablica': [],
    'koperta z bledem': { error: 'temporarily unavailable' },
    'same wpisy z przeszlosci': [
      ['time_tag', 'kp', 'observed'],
      [zaGodzin(-48), '2.00', 'observed'],
      [przeszlosc, '3.00', 'observed'],
    ],
  };
}

(async () => {
  const fail = [];
  const dane = ksztalty();
  /* Port musi być wolny, zanim cokolwiek postawimy. Atrapa z poprzedniego
     przebiegu odpowiada tak samo jak nowa — tylko starymi danymi. */
  await zwolnijPorty([PORT]);
  const serwer = http.createServer((q, s) => {
    const klucz = decodeURIComponent(q.url.slice(1));
    s.writeHead(200, { 'Content-Type': 'application/json' });
    s.end(JSON.stringify(dane[klucz] ?? []));
  });
  // Tylko pętla lokalna — atrapa testowa nie ma czego szukać na zewnątrz.
  await new Promise((r) => serwer.listen(PORT, '127.0.0.1', r));

  const czytaj = async (klucz) => {
    process.env.SWPC_KP_FORECAST_URL = `http://127.0.0.1:${PORT}/${encodeURIComponent(klucz)}`;
    // Moduł czyta adres przy każdym wywołaniu przez `process.env`? Nie —
    // czyta go RAZ, przy wczytaniu. Dlatego ładujemy go świeżo dla każdego
    // kształtu, zamiast udawać, że da się go przestawić w locie.
    delete require.cache[require.resolve('../../lib/zorza.js')];
    return require('../../lib/zorza.js').kpPrognoza();
  };

  // ---- 1. Cztery układy, ten sam wynik ----
  const OCZEKIWANE = [5.67, 7.33];
  for (const klucz of ['z naglowkiem', 'bez naglowka', 'inna kolejnosc kolumn', 'obiekty zamiast tablic']) {
    const w = await czytaj(klucz);
    const kp = w.map((x) => x.kp);
    console.log(`${klucz.padEnd(24)} → ${w.length} wpisów, Kp ${JSON.stringify(kp)}`);
    if (JSON.stringify(kp) !== JSON.stringify(OCZEKIWANE)) {
      fail.push(`„${klucz}": Kp ${JSON.stringify(kp)}, oczekiwane ${JSON.stringify(OCZEKIWANE)}`);
    }
    // Znacznik czasu musi się dać sparsować — bez tego szczyt prognozy
    // pokazywałby „Invalid Date" i nikt by nie wiedział, kiedy wyjść.
    for (const x of w) {
      if (Number.isNaN(new Date(String(x.kiedy).replace(' ', 'T') + 'Z').getTime())) {
        fail.push(`„${klucz}": nieczytelny znacznik czasu „${x.kiedy}"`);
      }
    }
  }

  // ---- 2. Pusto ma zostać pusto, bez wywrotki ----
  for (const klucz of ['pusta tablica', 'koperta z bledem', 'same wpisy z przeszlosci']) {
    let w;
    try { w = await czytaj(klucz); } catch (e) { fail.push(`„${klucz}" wywróciło czytnik: ${e.message}`); continue; }
    console.log(`${klucz.padEnd(24)} → ${w.length} wpisów (oczekiwane 0)`);
    if (w.length) fail.push(`„${klucz}" dało ${w.length} wpisów zamiast zera`);
  }

  /* ---- 3. Wiersz nagłówka nie może przejść jako dane ----
     To jest ta pułapka, którą rozpoznawanie pól rozwiązuje: gdyby „kp"
     przeszło jako liczba albo „time_tag" jako data, w prognozie siedziałby
     wpis-widmo i psuł szczyt. */
  const zNaglowkiem = await czytaj('z naglowkiem');
  if (zNaglowkiem.some((x) => !/^\d{4}-/.test(String(x.kiedy)))) {
    fail.push('wiersz nagłówka przeszedł jako dane');
  }
  console.log(`nagłówek odsiany: ${!zNaglowkiem.some((x) => !/^\d{4}-/.test(String(x.kiedy)))}`);

  /* ---- 4. Kp poza skalą odpada ----
     Skala Kp kończy się na 9. Liczba spoza zakresu znaczy, że trafiliśmy
     w niewłaściwą kolumnę — lepiej nie oddać nic niż oddać „Kp 2024". */
  dane['zla kolumna'] = [['time_tag', 'rok'], [zaGodzin(3), '2026']];
  const zla = await czytaj('zla kolumna');
  console.log(`liczba spoza skali Kp (2026) odrzucona: ${zla.length === 0}`);
  if (zla.length) fail.push(`liczba spoza skali Kp przeszła jako Kp: ${JSON.stringify(zla)}`);

  serwer.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKSZTAŁTY PROGNOZY ZORZY OK');
  process.exit(fail.length ? 1 : 0);
})();

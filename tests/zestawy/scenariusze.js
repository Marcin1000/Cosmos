/* SCENARIUSZE — przewidywanie usterek, zanim zgłosi je Marcin.

   Ten zestaw powstał po dwóch zgłoszeniach z realnego użycia: „nie pokazuje
   zdjęć, które wyszukał" i „napisałem, jakich obiektywów użyję, i zgłupiał".
   Obie usterki wyglądały na niezwiązane, a miały jedną wspólną przyczynę:

       NARZĘDZIE NIE MIAŁO GDZIE PRZYJĄĆ TEGO, CO POWIEDZIAŁ CZŁOWIEK,
       ALBO NIE MIAŁO CO ZROBIĆ, GDY COŚ POSZŁO NIE TAK.

   Nie sprawdzamy tu więc pojedynczych funkcji — od tego są inne zestawy.
   Sprawdzamy KLASY sytuacji, w których takie luki się objawiają:

     A. człowiek podaje coś, czego kontrakt narzędzia nie przewiduje
     B. człowiek podaje wartość spoza listy albo bez sensu
     C. brakuje danych, bez których nie da się policzyć
     D. usługa zewnętrzna odmawia

   Reguła wspólna dla wszystkich czterech: Cosmos ma ODPOWIEDZIEĆ i POWIEDZIEĆ,
   czego zabrakło. Nie wolno mu ani milczeć, ani wywalić się, ani — najgorsze —
   podać wyniku, który wygląda poprawnie, a jest policzony nie dla tego, o co
   pytano. Cicha nieprawda jest gorsza niż jawny błąd.
*/
const { srodowisko } = require('../pomoc');

(async () => {
  const env = await srodowisko('grafiki');
  const fail = [];
  const plan = async (ciało) => {
    const r = await fetch(`${env.adres}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ciało),
    });
    let d = null;
    try { d = await r.json(); } catch { /* nie-JSON to też wynik */ }
    return { status: r.status, d };
  };
  const powodyZ = (o) => ((o && o.d && o.d.ustawienia && o.d.ustawienia.powody) || []);

  /* ---- A. Miejsce podane NAZWĄ, nie współrzędnymi ---------------------
     „W sobotę kręcę w Krakowie" to najzwyklejsze zdanie i do niedawna nie
     było parametru, który by je przyjął. Model musiał zgadywać współrzędne
     z pamięci — a złota godzina policzona dla złego punktu wygląda równie
     wiarygodnie jak policzona dla dobrego. */
  const wKrakowie = await plan({ miejsce: 'Kraków', tryb: 'zdjecie', kiedy: '2026-06-21T20:00' });
  console.log(`A1. miejsce=Kraków → HTTP ${wKrakowie.status}, `
    + `współrzędne ${JSON.stringify(wKrakowie.d?.wspolrzedne)}, miejsce „${wKrakowie.d?.miejsce}"`);
  if (wKrakowie.status !== 200) fail.push('nazwa miejsca odrzucona');
  const lat = wKrakowie.d?.wspolrzedne?.lat;
  if (Math.abs((lat ?? 0) - 50.06) > 0.5) fail.push(`Kraków wypadł na ${lat} zamiast ~50.06`);
  if (!wKrakowie.d?.miejsceZNazwy) fail.push('odpowiedź nie mówi, że liczono dla podanego miejsca');

  // Nazwa nieznana: NIE WOLNO po cichu policzyć dla domu i oddać jako wynik.
  const nigdzie = await plan({ miejsce: 'Wólka Zmyślona Nieistniejąca', tryb: 'zdjecie' });
  const przyznajeSie = nigdzie.status === 400
    || powodyZ(nigdzie).some((p) => /Nie znalazłem miejsca/.test(p));
  console.log(`A2. nieznane miejsce → HTTP ${nigdzie.status}, przyznaje się: ${przyznajeSie}`);
  if (!przyznajeSie) fail.push('nieznane miejsce policzone po cichu dla innej lokalizacji');

  /* ---- B. Wartości spoza listy --------------------------------------- */
  const obcyKorpus = await plan({ lat: 50, lon: 20, sprzet: 'sony-a7iv', tryb: 'zdjecie' });
  console.log(`B1. nieznany korpus „sony-a7iv" → HTTP ${obcyKorpus.status}, `
    + `sprzęt w wyniku: ${obcyKorpus.d?.ustawienia?.sprzet}`);
  if (obcyKorpus.status !== 200) fail.push('nieznany korpus wywraca odpowiedź zamiast wpaść w domyślny');
  if (!obcyKorpus.d?.ustawienia?.czas) fail.push('brak wyniku dla nieznanego korpusu');
  // …ale podmiana korpusu nie może być MILCZĄCA: sufit ISO i zapas ze
  // stabilizacji są inne, więc wynik dotyczy nie tego aparatu, o który pytano.
  if (!powodyZ(obcyKorpus).some((p) => /nie mam .* w katalogu/i.test(p))) {
    fail.push('nieznany korpus podmieniony po cichu — odpowiedź dotyczy innego aparatu');
  }

  const dziwneWartosci = await plan({
    lat: 50, lon: 20, tryb: 'malowanie', klatki: 'dużo', ruch: 'na golasa',
    zachmurzenie: 'mgła', ogniskowa: 'szeroko',
  });
  console.log(`B2. same bzdurne wartości → HTTP ${dziwneWartosci.status}, `
    + `${dziwneWartosci.d?.ustawienia?.czas} ${dziwneWartosci.d?.ustawienia?.przyslona} `
    + `ISO ${dziwneWartosci.d?.ustawienia?.iso}`);
  if (dziwneWartosci.status !== 200) fail.push('bzdurne wartości wywracają narzędzie');
  if (!Number.isFinite(dziwneWartosci.d?.ustawienia?.iso)) fail.push('ISO wyszło nieliczbą');

  // Ogniskowa ujemna i absurdalna — wynik musi zostać liczbą, nie NaN.
  for (const zla of [-50, 0, 99999]) {
    const o = await plan({ lat: 50, lon: 20, tryb: 'zdjecie', ogniskowa: zla });
    if (o.status !== 200 || !Number.isFinite(o.d?.ustawienia?.iso)) {
      fail.push(`ogniskowa=${zla} psuje wynik (HTTP ${o.status}, ISO ${o.d?.ustawienia?.iso})`);
    }
  }
  console.log('B3. ogniskowe -50 / 0 / 99999 → wynik nadal liczbowy');

  // Data bez sensu ma być odrzucona wprost, a nie policzona dla „Invalid Date".
  const zlaData = await plan({ lat: 50, lon: 20, kiedy: 'w przyszłą sobotę' });
  console.log(`B4. „kiedy=w przyszłą sobotę" → HTTP ${zlaData.status}`);
  if (zlaData.status !== 400) fail.push('nierozpoznana data nie została odrzucona');

  /* ---- C. Brak danych, bez których nie ma odpowiedzi ------------------
     Kluczowe: `Number(null)` to ZERO, nie NaN. Bez jawnego sprawdzenia
     Cosmos liczył światło dla punktu 0°N 0°E na Atlantyku i oddawał to jako
     poprawną odpowiedź — czyli dokładnie „cicha nieprawda". */
  const bezMiejsca = await plan({ tryb: 'zdjecie' });
  console.log(`C1. bez lokalizacji → HTTP ${bezMiejsca.status}, „${(bezMiejsca.d?.error || '').slice(0, 60)}"`);
  if (bezMiejsca.status !== 400) fail.push('brak lokalizacji nie został zgłoszony');
  if (!/lokaliz|współrzędn/i.test(bezMiejsca.d?.error || '')) fail.push('komunikat nie mówi, czego brakuje');

  const jawneNulle = await plan({ lat: null, lon: null, tryb: 'zdjecie' });
  console.log(`C2. lat=null lon=null → HTTP ${jawneNulle.status}`);
  if (jawneNulle.status !== 400) fail.push('null wzięty za współrzędne 0,0 (Atlantyk)');

  // Archiwum bez wpisów: pytanie ma dostać uczciwą odpowiedź, nie wywrotkę.
  const puste = await fetch(`${env.adres}/api/archive/stats?pole=ogniskowa`);
  const pusteD = await puste.json().catch(() => null);
  console.log(`C3. zestawienie z pustego archiwum → HTTP ${puste.status}, `
    + `razem ${pusteD?.razem ?? '—'}, z danymi ${pusteD?.zDanymi ?? '—'}, `
    + `bez danych ${pusteD?.bezDanych ?? '—'}`);
  if (puste.status !== 200) fail.push('puste archiwum wywraca zestawienie');
  if (pusteD && pusteD.razem === undefined) fail.push('zestawienie nie podaje, ile w ogóle jest wpisów');

  // Grupowanie po polu, którego nie ma — jasna odmowa, nie cicha pustka.
  const zleGrupowanie = await fetch(`${env.adres}/api/archive/stats?pole=kolorSkarpetek`);
  console.log(`C4. grupowanie po nieistniejącym polu → HTTP ${zleGrupowanie.status}`);
  if (zleGrupowanie.status !== 400) fail.push('nieznane pole grupowania nie zostało odrzucone');

  /* ---- D. Usługa zewnętrzna odmawia ----------------------------------
     Pogoda jest DODATKIEM do planu. Zasada, którą powtarzamy w całym
     projekcie: nic, co jest tylko dodatkiem, nie może zablokować odpowiedzi. */
  const zPogoda = await plan({ lat: 50, lon: 20, tryb: 'wideo', klatki: 25 });
  console.log(`D1. plan przy niedostępnej pogodzie → HTTP ${zPogoda.status}, `
    + `pogoda=${JSON.stringify(zPogoda.d?.pogoda)}, ustawienia są: ${Boolean(zPogoda.d?.ustawienia)}`);
  if (zPogoda.status !== 200) fail.push('brak pogody zablokował cały plan');
  if (!zPogoda.d?.ustawienia?.czas) fail.push('brak pogody odebrał ustawienia ekspozycji');

  // Wyszukiwanie grafik przy wszystkich źródłach w dół — musi POWIEDZIEĆ dlaczego.
  await fetch('http://127.0.0.1:7117/awaria?zrodla=searxng,ddg,commons,openverse');
  const brakZrodel = await (await fetch(`${env.adres}/api/search/images?q=cokolwiek`)).json();
  console.log(`D2. wszystkie źródła grafik padły → ${brakZrodel.results.length} zdjęć, `
    + `powód: „${(brakZrodel.error || '').slice(0, 60)}"`);
  if (!brakZrodel.error) fail.push('padły wszystkie źródła, a Cosmos nie podaje powodu');
  if (brakZrodel.results.length) fail.push('atrapa miała paść — sprawdzenie nic nie bada');
  await fetch('http://127.0.0.1:7117/awaria?zrodla=');

  /* ---- E. Śmieci na wejściu HTTP -------------------------------------
     Nie „ktoś nas atakuje", tylko: przeglądarka potrafi wysłać ucięte żądanie
     przy zerwanej sieci w terenie, a model — wygenerować niepoprawny JSON. */
  const smieci = await fetch(`${env.adres}/api/plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{niepoprawny',
  });
  console.log(`E1. uszkodzony JSON → HTTP ${smieci.status}`);
  if (smieci.status !== 400) fail.push(`uszkodzony JSON dał HTTP ${smieci.status} zamiast 400`);

  const pustyBody = await fetch(`${env.adres}/api/plan`, { method: 'POST' });
  console.log(`E2. puste ciało żądania → HTTP ${pustyBody.status}`);
  if (pustyBody.status >= 500) fail.push('puste ciało żądania wywraca serwer');

  // Bardzo długi tekst w polu — nie może przejść dalej bez ucięcia.
  const dlugi = await plan({ lat: 50, lon: 20, obiektyw: 'x'.repeat(5000) });
  console.log(`E3. 5000 znaków w polu obiektyw → HTTP ${dlugi.status}`);
  if (dlugi.status >= 500) fail.push('długi tekst wywraca serwer');

  // Serwer ma nadal żyć po tym wszystkim.
  const zywy = await fetch(`${env.adres}/api/config`).then((r) => r.status).catch(() => 0);
  console.log(`E4. serwer po wszystkich scenariuszach → HTTP ${zywy}`);
  if (zywy !== 200) fail.push('serwer nie przeżył zestawu scenariuszy');

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nSCENARIUSZE OK');
  process.exit(fail.length ? 1 : 0);
})();

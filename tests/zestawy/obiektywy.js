/* Marcin napisał, jakich obiektywów użyje — i Cosmos zgłupiał.

   Powód nie był w kodzie liczącym, tylko w KONTRAKCIE narzędzia: parametr
   „obiektyw" nie istniał. Cosmos znał wyłącznie korpus, a listę przysłon miał
   przypisaną do korpusu — co jest bez sensu, bo przysłona jest cechą szkła.
   Model nie miał gdzie odłożyć najważniejszej rzeczy, jaką fotograf podaje
   o swoim sprzęcie, więc albo ją gubił, albo odpowiadał od rzeczy.

   Sprawdzamy trzy warstwy, bo każda mogła zawieść osobno:
     1. czy rozpoznajemy zapisy obiektywów, jakich ludzie NAPRAWDĘ używają,
     2. czy dobór ekspozycji bierze szkło pod uwagę (i nie obiecuje przysłony,
        której ono nie ma),
     3. czy parametr przechodzi całą drogę: znacznik [PLAN:] → serwer → wynik.
*/
const { srodowisko } = require('../pomoc');
const {
  rozpoznajObiektyw, rozpoznajObiektywy, wybierzObiektyw, jasnoscPrzy, dobierz, evZeSlonca,
} = require('../../lib/ekspozycja.js');

(async () => {
  const fail = [];

  /* 1. Zapisy z realnego świata. Ta lista to nie fantazja — tak wyglądają
     nazwy na obiektywach i tak ludzie je skracają w rozmowie. */
  const ZAPISY = [
    ['RF 24-70mm f/2.8L IS USM', 24, 70, 2.8],
    ['24-70 f2.8', 24, 70, 2.8],
    ['50mm 1.8', 50, 50, 1.8],
    ['18-135 f/3.5-5.6', 18, 135, 3.5],
    ['16-35 f/4', 16, 35, 4],
    ['70-200mm f/4L', 70, 200, 4],
    ['Sigma 18-35 1.8', 18, 35, 1.8],
    ['RF 100-500mm F4.5-7.1 L IS USM', 100, 500, 4.5],
    ['EF 24-105 1:4 L IS', 24, 105, 4],
    ['RF 85 f/1.2', 85, 85, 1.2],
    ['nikkor 14-24 2.8', 14, 24, 2.8],
    ['600mm f/11', 600, 600, 11],
  ];
  let zle = 0;
  for (const [zapis, od, doO, jasnosc] of ZAPISY) {
    const o = rozpoznajObiektyw(zapis);
    if (!o || o.od !== od || o.do !== doO || o.jasnosc !== jasnosc) {
      zle++;
      fail.push(`„${zapis}" → ${o ? `${o.od}-${o.do} f/${o.jasnosc}` : 'null'} `
        + `(oczekiwane ${od}-${doO} f/${jasnosc})`);
    }
  }
  console.log(`1. zapisy obiektywów: ${ZAPISY.length - zle}/${ZAPISY.length} rozpoznanych`);

  // Tekst bez ogniskowej ma dać null — zgadywanie szkła jest gorsze niż „nie wiem".
  for (const bezSensu of ['obiektyw szerokokątny', '', 'jakiś tam', 'nie pamiętam']) {
    if (rozpoznajObiektyw(bezSensu) !== null) fail.push(`„${bezSensu}" wzięte za obiektyw`);
  }

  const kilka = rozpoznajObiektywy('mam 24-70 f/2.8 i 70-200 f/4');
  console.log(`2. „mam 24-70 f/2.8 i 70-200 f/4" → ${kilka.length} obiektywy`);
  if (kilka.length !== 2) fail.push(`lista obiektywów rozbita na ${kilka.length} zamiast 2`);

  /* 3. Zoom ze zmienną jasnością. Obiecywanie f/4.5 przy 500 mm na szkle,
     które ma tam f/7.1, to półtorej działki błędu — czyli zdjęcie ciemniejsze
     niż zapowiedziane. */
  const zmienny = rozpoznajObiektyw('RF 100-500mm F4.5-7.1');
  const naKoncu = jasnoscPrzy(zmienny, 500);
  console.log(`3. RF 100-500 f/4.5-7.1 → przy 100 mm f/${jasnoscPrzy(zmienny, 100)}, `
    + `przy 500 mm f/${naKoncu}`);
  if (jasnoscPrzy(zmienny, 100) !== 4.5) fail.push('zła jasność na krótkim końcu');
  if (naKoncu !== 7.1) fail.push(`na długim końcu f/${naKoncu} zamiast f/7.1`);

  /* 4. Wybór szkła pod ogniskową i uczciwe przyznanie, gdy żadne nie sięga. */
  const dwa = rozpoznajObiektywy('24-70 f/2.8, 70-200 f/4');
  const w50 = wybierzObiektyw(dwa, 50);
  const w300 = wybierzObiektyw(dwa, 300);
  console.log(`4. 50 mm → ${w50.obiektyw.nazwa}; 300 mm → pasuje=${w300.pasuje}`);
  if (!/24-70/.test(w50.obiektyw.nazwa)) fail.push('do 50 mm wybrany zły obiektyw');
  if (w300.pasuje) fail.push('300 mm uznane za mieszczące się w 24-70/70-200');
  if (!w300.uwaga) fail.push('brak ostrzeżenia, że żaden obiektyw nie ma 300 mm');

  /* 5. Sedno: dobór ekspozycji NIE MOŻE proponować przysłony, której szkło
     nie ma. Ciemny zoom przy słabym świetle musi iść w ISO, nie w f/1.4.

     Scena musi być NAPRAWDĘ ciemna. Pierwsza wersja tego sprawdzenia brała
     zmierzch przy Słońcu -3° (EV ≈ 9,5) i oba obiektywy dawały ten sam wynik
     f/5.6 — słusznie, bo przy tylu światłach nikt nie musi otwierać do końca
     i jasność szkła nie ma znaczenia. Sprawdzenie nie badało wtedy niczego.
     Dopiero gdy światła BRAKUJE, widać, po co Cosmosowi wiedza o obiektywie. */
  const evNoc = evZeSlonca(-10);           // dobrze po zachodzie, EV ≈ 5,3
  const zCiemnym = dobierz(evNoc, { tryb: 'zdjecie', ogniskowa: 200, obiektyw: '70-200 f/4' });
  const otwarta = Number(String(zCiemnym.przyslona).replace('f/', ''));
  console.log(`5. zmierzch, 70-200 f/4 przy 200 mm → ${zCiemnym.czas} ${zCiemnym.przyslona} ISO ${zCiemnym.iso}`);
  if (otwarta < 4) fail.push(`zaproponowana ${zCiemnym.przyslona} — szkło ma najjaśniej f/4`);

  const zJasnym = dobierz(evNoc, { tryb: 'zdjecie', ogniskowa: 50, obiektyw: '50mm f/1.8' });
  console.log(`   ten sam zmierzch, 50 mm f/1.8 → ${zJasnym.czas} ${zJasnym.przyslona} ISO ${zJasnym.iso}`);
  if (Number(String(zJasnym.przyslona).replace('f/', '')) > 1.8) {
    fail.push('jasny obiektyw nieotwarty mimo braku światła');
  }
  // Jasne szkło musi dać NIŻSZE ISO niż ciemne w tych samych warunkach —
  // inaczej cała ta wiedza o obiektywie do niczego nie służy.
  if (!(zJasnym.iso < zCiemnym.iso)) {
    fail.push(`f/1.8 dało ISO ${zJasnym.iso}, a f/4 — ${zCiemnym.iso}; obiektyw nie wpływa na wynik`);
  }

  /* 5b. Żądana głębia ostrości poza możliwościami szkła.
     To ten sam gatunek nieprawdy, co naprawiony w Partii 31: prośba o f/1.4
     na zoomie f/4 kończyła się zdaniem „przysłona f/4 zostaje, bo taka
     została podana" — a podana była f/1.4. Odpowiedź brzmi poprawnie i mija
     się z tym, o co pytano. */
  const zaJasno = dobierz(evZeSlonca(20), {
    tryb: 'zdjecie', ogniskowa: 100, obiektyw: '70-200 f/4', glebia: 1.4,
  });
  const mowiOPodmianie = zaJasno.powody.some((p) => /Prosiłeś o f\/1\.4/.test(p));
  console.log(`5b. prośba o f/1.4 na szkle f/4 → ${zaJasno.przyslona}, `
    + `mówi o podmianie: ${mowiOPodmianie}`);
  if (zaJasno.przyslona !== 'f/4') fail.push(`dał ${zaJasno.przyslona} zamiast f/4`);
  if (!mowiOPodmianie) fail.push('podmienił żądaną przysłonę po cichu');
  if (zaJasno.powody.some((p) => /f\/4 zostaje, bo taka została podana/.test(p))) {
    fail.push('twierdzi, że f/4 „została podana" — podana była f/1.4');
  }
  // …a gdy prośba JEST wykonalna, nie ma się z czego tłumaczyć.
  const wykonalna = dobierz(evZeSlonca(20), {
    tryb: 'zdjecie', ogniskowa: 100, obiektyw: '70-200 f/4', glebia: 8,
  });
  if (wykonalna.przyslona !== 'f/8') fail.push(`wykonalna prośba o f/8 dała ${wykonalna.przyslona}`);
  if (wykonalna.powody.some((p) => /Prosiłeś o/.test(p))) {
    fail.push('tłumaczy się z podmiany, której nie było');
  }

  /* 6. Cała droga przez serwer. To tutaj psuł się parametr: wartość
     „24-70 f/2.8" ma spację, a klient dzielił parametry po spacjach —
     przysłona przepadała i Cosmos liczył f/4 komuś, kto ma f/2.8. */
  const env = await srodowisko('grafiki');
  const plan = async (ciało) => {
    const r = await fetch(`${env.adres}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 50.06, lon: 19.94, kiedy: '2026-06-21T20:30', ...ciało }),
    });
    return r.json();
  };

  const zObiektywem = await plan({ tryb: 'zdjecie', ogniskowa: 200, obiektyw: '70-200 f/4' });
  const powody = (zObiektywem.ustawienia && zObiektywem.ustawienia.powody) || [];
  console.log(`6. /api/plan z obiektywem → ${zObiektywem.ustawienia?.przyslona} ISO ${zObiektywem.ustawienia?.iso}`);
  if (!powody.some((p) => /70-200/.test(p))) {
    fail.push('serwer zignorował obiektyw — nie ma go w uzasadnieniu');
  }
  if (Number(String(zObiektywem.ustawienia?.przyslona).replace('f/', '')) < 4) {
    fail.push('serwer proponuje przysłonę jaśniejszą, niż obiektyw potrafi');
  }

  // Kilka obiektywów jednym ciągiem — tak, jak je człowiek napisze.
  const zListą = await plan({ tryb: 'wideo', klatki: 25, ogniskowa: 35, obiektyw: '24-70 f/2.8, 70-200 f/4' });
  const powody2 = (zListą.ustawienia && zListą.ustawienia.powody) || [];
  console.log(`7. lista dwóch obiektywów, 35 mm → ${powody2.find((p) => /Liczę dla/.test(p))?.slice(0, 60) || 'BRAK'}`);
  if (!powody2.some((p) => /24-70/.test(p))) fail.push('przy 35 mm nie wybrano obiektywu 24-70');

  // Tekst, z którego nic nie wynika — ma być uczciwe przyznanie, nie cisza.
  const bezSensu = await plan({ tryb: 'zdjecie', obiektyw: 'jakiś szerokokątny' });
  const powody3 = (bezSensu.ustawienia && bezSensu.ustawienia.powody) || [];
  console.log(`8. nierozpoznany obiektyw → ${powody3.some((p) => /Nie odczytałem obiektywu/.test(p)) ? 'przyznaje się' : 'MILCZY'}`);
  if (!powody3.some((p) => /Nie odczytałem obiektywu/.test(p))) {
    fail.push('nierozpoznany obiektyw przemilczany — użytkownik nie wie, że dane przepadły');
  }

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nOBIEKTYWY OK');
  process.exit(fail.length ? 1 : 0);
})();

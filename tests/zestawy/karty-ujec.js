/* Karty ujęć — lista rzeczy do nakręcenia, dobrana do tematu i do SPRZĘTU.

   Pomysł z video-shotcraft (z trendów). Wartość nie jest w tym, że istnieje
   lista ujęć — takich jest w internecie tysiąc. Jest w trzech rzeczach, które
   tamte listy z definicji mieć nie mogą, i każdą z nich sprawdzamy tutaj:

     1. że zestaw ZALEŻY OD TEMATU (wesele ≠ wyścig),
     2. że ujęcia niewykonalne posiadanym sprzętem WYPADAJĄ, i to Z POWODEM —
        bo „nie ma na liście" i „nie masz drona" to dwie różne informacje,
     3. że ogniskowa jest policzona dla SZKŁA, które Marcin naprawdę ma,
        a nie wzięta ze środka teoretycznego zakresu.

   Na koniec przejście całą drogą: [PLAN: tryb=wideo] → serwer → pole `ujecia`.
*/
const { srodowisko } = require('../pomoc');
const { planUjec, UJECIA, ZESTAWY } = require('../../lib/ujecia.js');
const { rozpoznajObiektywy } = require('../../lib/ekspozycja.js');

// Prawdziwy zestaw Marcina — na nim liczą się wszystkie sprawdzenia niżej.
const MOJE_SZKLA = rozpoznajObiektywy('24-105 f/4, 70-200 f/4, 50 f/1.8');

(async () => {
  const fail = [];

  /* ---- 0. Spójność katalogu ----
     Literówka w kluczu zestawu daje po cichu KRÓTSZĄ listę ujęć, bo nieznany
     klucz jest po prostu pomijany. To dokładnie ta klasa usterki, której nikt
     nie zauważy w działaniu. */
  let sieroty = 0;
  for (const [temat, klucze] of Object.entries(ZESTAWY)) {
    for (const k of klucze) {
      if (!UJECIA[k]) { sieroty++; fail.push(`zestaw „${temat}" wskazuje nieistniejące ujęcie „${k}"`); }
    }
  }
  console.log(`0. katalog: ${Object.keys(UJECIA).length} kart, ${Object.keys(ZESTAWY).length} zestawów, `
    + `${sieroty} odwołań w próżnię`);
  for (const [k, u] of Object.entries(UJECIA)) {
    if (!Array.isArray(u.ogniskowa) || u.ogniskowa[0] > u.ogniskowa[1]) {
      fail.push(`karta „${k}" ma bezsensowny zakres ogniskowych`);
    }
    if (!Array.isArray(u.sekund) || u.sekund[0] > u.sekund[1]) {
      fail.push(`karta „${k}" ma bezsensowny czas trwania`);
    }
  }

  /* ---- 1. Temat decyduje o zestawie ---- */
  const wesele = planUjec({ temat: 'slub', obiektywy: MOJE_SZKLA, gimbal: true, statyw: true });
  const wyscig = planUjec({ temat: 'wyscig', obiektywy: MOJE_SZKLA, gimbal: true, statyw: true });
  const nazwy = (p) => p.ujecia.map((u) => u.klucz);
  console.log(`1. ślub  → ${nazwy(wesele).join(', ')}`);
  console.log(`   wyścig → ${nazwy(wyscig).join(', ')}`);
  if (JSON.stringify(nazwy(wesele)) === JSON.stringify(nazwy(wyscig))) {
    fail.push('ślub i wyścig dostały identyczny zestaw ujęć — temat nic nie zmienia');
  }
  if (!nazwy(wesele).includes('zza-ramienia')) fail.push('w zestawie na ślub brakuje ujęcia zza ramienia');
  if (!nazwy(wyscig).includes('prowadzenie')) fail.push('w zestawie na wyścig brakuje prowadzenia');

  /* ---- 2. Bez drona nie ma ujęć z drona — I TRZEBA TO POWIEDZIEĆ ---- */
  const bezDrona = planUjec({ temat: 'gory', obiektywy: MOJE_SZKLA, statyw: true, gimbal: true });
  const zDronem = planUjec({ temat: 'gory', obiektywy: MOJE_SZKLA, statyw: true, gimbal: true, dron: true });
  console.log(`2. góry bez drona → ${bezDrona.ujecia.length} ujęć, pominięte: `
    + `${bezDrona.pominiete.map((x) => x.nazwa).join(', ') || 'brak'}`);
  console.log(`   góry z dronem  → ${zDronem.ujecia.length} ujęć`);
  if (nazwy(bezDrona).some((k) => (UJECIA[k].potrzebuje || []).includes('dron'))) {
    fail.push('Cosmos doradza ujęcie dronem komuś, kto drona nie ma');
  }
  if (!bezDrona.pominiete.length) {
    fail.push('ujęcia dronowe zniknęły w ciszy — użytkownik pomyśli, że Cosmos o nich zapomniał');
  }
  if (!bezDrona.pominiete.some((x) => /drona/.test(x.powod))) {
    fail.push('powód pominięcia nie mówi, czego brakuje');
  }
  if (zDronem.ujecia.length <= bezDrona.ujecia.length) {
    fail.push('dodanie drona nie odblokowało ani jednego ujęcia');
  }

  /* ---- 3. Ogniskowa liczona dla POSIADANEGO szkła ----
     Ujęcie ustalające ma zakres 14-35 mm. Marcin ma 24-105, więc realna
     odpowiedź to okolice 24-35 — a NIE 24 mm wzięte ze środka 14-35, bo
     środek tamtego zakresu (24) akurat by tu wyszedł przypadkiem. Sprawdzamy
     na przypadku, w którym przypadek nie ratuje: zakres 14-35 przecięty
     z 24-105 daje 24-35, czyli środek 29 lub 30. */
  const ustal = wesele.ujecia.find((u) => u.klucz === 'ustalajace');
  console.log(`3. ujęcie ustalające (zakres 14-35 mm, szkła 24-105/70-200/50) → `
    + `${ustal ? `${ustal.ogniskowa} mm na ${ustal.naSzkle}` : 'BRAK'}`);
  if (!ustal) {
    fail.push('ujęcie ustalające wypadło z zestawu na ślub');
  } else {
    if (ustal.ogniskowa < 24) {
      fail.push(`${ustal.ogniskowa} mm — Cosmos radzi ogniskową, której żadne z Twoich szkieł nie ma`);
    }
    if (!/24-105/.test(ustal.naSzkle || '')) fail.push(`ustalające przypisane do ${ustal.naSzkle}`);
  }

  /* Szkło, które nie sięga daleko: ujęcie „spłaszczony plan" chce 135-400 mm.
     Z samym 24-105 ma wypaść, i to z powodem o ogniskowej, nie o sprzęcie. */
  const tylkoStandard = rozpoznajObiektywy('24-105 f/4');
  const goryKrotkie = planUjec({ temat: 'gory', obiektywy: tylkoStandard, statyw: true, gimbal: true });
  const powodTele = (goryKrotkie.pominiete.find((x) => x.klucz === 'tele-sprasowane') || {}).powod;
  console.log(`4. tylko 24-105 → „spłaszczony plan": ${powodTele || 'NIE POMINIĘTO'}`);
  if (!powodTele) fail.push('ujęcie 135-400 mm zostało w zestawie mimo braku takiego szkła');
  else if (!/135-400 mm/.test(powodTele)) fail.push(`powód nie podaje potrzebnej ogniskowej: ${powodTele}`);

  /* ---- 4. Brak informacji o szkle to NIE to samo, co brak szkła ----
     Gdyby pusta lista znaczyła „nie ma nic", Cosmos odrzuciłby wszystkie
     ujęcia komuś, kto po prostu nie napisał, co ma w torbie. */
  const bezWiedzy = planUjec({ temat: 'gory', statyw: true, gimbal: true, dron: true });
  console.log(`5. temat bez podanego szkła → ${bezWiedzy.ujecia.length} ujęć `
    + `(pominięte: ${bezWiedzy.pominiete.length})`);
  if (bezWiedzy.ujecia.length !== ZESTAWY.gory.length) {
    fail.push('niepodanie obiektywów obcięło listę ujęć — „nie wiem" potraktowane jak „nie mam"');
  }

  /* ---- 5. Temat spoza listy dostaje zestaw ratunkowy ---- */
  const dziwny = planUjec({ temat: 'zawody-w-rzucaniu-beretem', obiektywy: MOJE_SZKLA, gimbal: true });
  console.log(`6. temat spoza listy → ${dziwny.ujecia.length} ujęć (${nazwy(dziwny).join(', ')})`);
  if (dziwny.ujecia.length < 4) fail.push('nieznany temat zostawia użytkownika prawie bez planu');

  /* ---- 6. Cała droga: [PLAN: tryb=wideo] → serwer → pole `ujecia` ---- */
  const env = await srodowisko('grafiki');
  const plan = async (body) => {
    const r = await fetch(`${env.adres}/api/plan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: 52.23, lon: 21.01, kiedy: '2026-06-21T17:00:00Z', ...body }),
    });
    return r.json();
  };

  const wideo = await plan({ tryb: 'wideo', temat: 'wesele siostry', obiektyw: '24-105 f/4, 70-200 f/4' });
  console.log(`7. [PLAN: tryb=wideo temat=wesele] → ${(wideo.ujecia && wideo.ujecia.ujecia || []).length} ujęć`);
  if (!wideo.ujecia) fail.push('serwer nie oddał listy ujęć przy trybie wideo');
  else if (!wideo.ujecia.ujecia.length) fail.push('lista ujęć z serwera jest pusta');

  const zdjecie = await plan({ tryb: 'zdjecie', temat: 'wesele siostry' });
  console.log(`8. [PLAN: tryb=zdjecie] → ujecia: ${JSON.stringify(zdjecie.ujecia)}`);
  if (zdjecie.ujecia !== null) {
    fail.push('lista ujęć doklejona do planu ZDJĘCIOWEGO — tam pytanie brzmi inaczej');
  }

  // Dron podany w rozmowie musi odblokować ujęcia z góry.
  const zDronemHttp = await plan({
    tryb: 'wideo', temat: 'góry', obiektyw: '24-105 f/4', dodatki: 'DJI Mavic 3, statyw',
  });
  const kluczeHttp = ((zDronemHttp.ujecia || {}).ujecia || []).map((u) => u.klucz);
  console.log(`9. + „DJI Mavic 3" w dodatkach → ${kluczeHttp.join(', ')}`);
  if (!kluczeHttp.some((k) => (UJECIA[k].potrzebuje || []).includes('dron'))) {
    fail.push('dron wpisany w dodatkach nie odblokował żadnego ujęcia z góry');
  }

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKARTY UJĘĆ OK');
  process.exit(fail.length ? 1 : 0);
})();

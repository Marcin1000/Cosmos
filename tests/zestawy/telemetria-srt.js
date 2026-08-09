/* Telemetria z klipów DJI — plik .SRT obok nagrania.

   Największa dziura, jaka została w archiwum: Cosmos wiedział o zdjęciach
   wszystko, a o klipach nic. Microsoft Graph oddaje dla wideo samą datę
   i rozmiar, więc „pokaż ujęcia znad jeziora o zachodzie" działało wyłącznie
   dla fotografii. Tymczasem Mavic 3 zapisuje obok każdego klipu plik
   z telemetrią — dla każdej klatki ISO, czas, przysłonę, ogniskową, GPS
   i dwie wysokości.

   Zestaw sprawdza dwie rzeczy osobno:
     1. czy CZYTAMY oba formaty poprawnie — z liczbami, które da się sprawdzić
        z zewnątrz (długość klipu ze znacznika, dystans z odległości punktów),
     2. czy śmieci NIE PRZECHODZĄ jako telemetria.
*/
const { czytajSrt, jestSrtDji, nazwaSrtDla, naWpisArchiwum, czasNaSekundy } = require('../../lib/srt.js');

/** Sztuczny klip w nowym formacie: `sekund` sekund po `fps` klatek. */
function nowySrt({ sekund = 3, fps = 30, iso = 400, lat0 = 53.500000, lon0 = 22.600000 } = {}) {
  const bloki = [];
  const razem = sekund * fps;
  for (let i = 0; i < razem; i++) {
    const t = i / fps;
    const kon = (i + 1) / fps;
    const zegar = (s) => {
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const sek = String(Math.floor(s % 60)).padStart(2, '0');
      const ms = String(Math.round((s % 1) * 1000)).padStart(3, '0');
      return `${h}:${m}:${sek},${ms}`;
    };
    // Dron leci prosto na północ, 10 m na sekundę, i wznosi się.
    const lat = lat0 + (t * 10) / 111320;
    const rel = 20 + t * 2;
    bloki.push(
      `${i + 1}\r\n${zegar(t)} --> ${zegar(kon)}\r\n`
      + `<font size="28">FrameCnt: ${i + 1}, DiffTime: ${Math.round(1000 / fps)}ms\r\n`
      + `2026-06-21 20:15:${String(10 + Math.floor(t)).padStart(2, '0')}.000\r\n`
      + `[iso: ${iso}] [shutter: 1/320.0] [fnum: 2.8] [ev: 0] [color_md: default] `
      + `[focal_len: 24.00] [latitude: ${lat.toFixed(6)}] [longitude: ${lon0.toFixed(6)}] `
      + `[rel_alt: ${rel.toFixed(3)} abs_alt: ${(rel + 130).toFixed(3)}] [ct: 5695] </font>`,
    );
  }
  return bloki.join('\r\n\r\n');
}

const STARY_SRT = `1
00:00:00,000 --> 00:00:01,000
HOME(149.0251,-20.2532) 2017.08.05 14:11:51
GPS(149.0251,-20.2533,16) BAROMETER:1.9
ISO:100 Shutter:60 EV: 0 Fnum:2.2

2
00:00:01,000 --> 00:00:02,000
HOME(149.0251,-20.2532) 2017.08.05 14:11:52
GPS(149.0261,-20.2533,18) BAROMETER:3.4
ISO:100 Shutter:60 EV: 0 Fnum:2.2
`;

(async () => {
  const fail = [];

  /* ---- 1. Czas migawki: pułapka starego formatu ----
     `Shutter:60` NIE znaczy 60 sekund, tylko 1/60 s — DJI zapisywało tam
     mianownik. Wzięte dosłownie dałoby minutową ekspozycję z lecącego drona. */
  const czasy = {
    '1/320.0': czasNaSekundy('1/320.0'),
    '60': czasNaSekundy('60'),
    '0.5': czasNaSekundy('0.5'),
  };
  console.log('1. czas migawki:', JSON.stringify(czasy));
  if (Math.abs(czasy['1/320.0'] - 1 / 320) > 1e-9) fail.push('ułamek 1/320 źle odczytany');
  if (Math.abs(czasy['60'] - 1 / 60) > 1e-9) fail.push('„Shutter:60" wzięte jako 60 sekund, nie 1/60 s');
  if (Math.abs(czasy['0.5'] - 0.5) > 1e-9) fail.push('długi czas 0,5 s zamieniony na ułamek');

  /* ---- 2. Nowy format: liczby sprawdzalne z zewnątrz ---- */
  const t = czytajSrt(nowySrt({ sekund: 4, fps: 30 }));
  console.log(`2. klip 4 s / 30 kl.: ${t.klatek} klatek, ${t.sekund} s, `
    + `${t.klatekNaSekunde} kl./s, ISO ${t.iso}, f/${t.przyslona}, ${t.ogniskowa} mm, `
    + `wys. ${t.wysokoscMin}-${t.wysokoscMax} m, ${t.dystansM} m trasy`);
  if (t.klatek !== 120) fail.push(`odczytano ${t.klatek} klatek zamiast 120`);
  if (Math.abs(t.sekund - 4) > 0.1) fail.push(`długość ${t.sekund} s zamiast 4`);
  if (t.klatekNaSekunde !== 30) fail.push(`${t.klatekNaSekunde} kl./s zamiast 30`);
  if (t.iso !== 400 || t.przyslona !== 2.8 || t.ogniskowa !== 24) {
    fail.push(`nastawy odczytane źle: ISO ${t.iso}, f/${t.przyslona}, ${t.ogniskowa} mm`);
  }
  if (Math.abs(t.czasS - 1 / 320) > 1e-6) fail.push(`czas ${t.czasS} zamiast 1/320`);
  // Wznoszenie 2 m/s przez 4 s: od 20 do ~28 m.
  if (Math.abs(t.wysokoscMin - 20) > 0.5 || Math.abs(t.wysokoscMax - 28) > 0.5) {
    fail.push(`wysokość ${t.wysokoscMin}-${t.wysokoscMax} m, oczekiwane 20-28`);
  }
  // Lot 10 m/s przez 4 s to około 40 m — z dokładnością do zaokrągleń GPS.
  if (Math.abs(t.dystansM - 40) > 4) fail.push(`dystans ${t.dystansM} m zamiast ~40`);

  /* Ślad co sekundę, nie co klatkę. Klip minutowy to 1800 klatek i wszystkie
     w indeksie byłyby marnowaniem miejsca. */
  console.log(`3. ślad lotu: ${t.slad.length} punktów ze 120 klatek`);
  if (t.slad.length > 6) fail.push(`ślad ma ${t.slad.length} punktów — nie został przerzedzony`);
  if (!t.slad.length) fail.push('ślad lotu pusty');
  if (t.slad[0] && !Number.isFinite(t.slad[0].w)) fail.push('punkty śladu bez wysokości');

  /* KLUCZOWE: liczba klatek na sekundę NIE MOŻE być zgadywana ze stałej.
     Ten sam klip w 60 kl./s musi dać tę samą długość, nie dwukrotną. */
  const szybki = czytajSrt(nowySrt({ sekund: 4, fps: 60 }));
  console.log(`4. ten sam klip w 60 kl./s: ${szybki.klatek} klatek, ${szybki.sekund} s, `
    + `${szybki.klatekNaSekunde} kl./s`);
  if (Math.abs(szybki.sekund - 4) > 0.1) {
    fail.push(`60 kl./s dało ${szybki.sekund} s zamiast 4 — długość liczona z liczby klatek`);
  }
  if (szybki.klatekNaSekunde !== 60) fail.push(`rozpoznano ${szybki.klatekNaSekunde} kl./s zamiast 60`);
  if (szybki.slad.length > 6) fail.push('przy 60 kl./s ślad nie został przerzedzony');

  /* ---- 3. Stary format i kolejność współrzędnych ----
     GPS(lon,lat,alt) — długość PIERWSZA, odwrotnie niż podpowiada nazwa.
     Zamiana miejscami przenosi materiał z Australii w środek Atlantyku. */
  const s = czytajSrt(STARY_SRT);
  console.log(`5. stary format → lat ${s.lat}, lon ${s.lon}, ISO ${s.iso}, `
    + `f/${s.przyslona}, czas ${s.czasS && s.czasS.toFixed(4)} s`);
  if (!(s.lat < 0 && s.lat > -21)) fail.push(`szerokość ${s.lat} — zamienione z długością`);
  if (!(s.lon > 148 && s.lon < 150)) fail.push(`długość ${s.lon} — zamienione z szerokością`);
  if (s.iso !== 100 || s.przyslona !== 2.2) fail.push('nastawy starego formatu odczytane źle');
  if (Math.abs(s.czasS - 1 / 60) > 1e-9) fail.push('czas ze starego formatu nie jest ułamkiem');

  /* ---- 4. Śmieci nie przechodzą ---- */
  const smieci = [
    ['zwykłe napisy do filmu', '1\n00:00:01,000 --> 00:00:02,000\nDzień dobry, tu narrator.\n'],
    ['pusty plik', ''],
    ['przypadkowy tekst', 'Lorem ipsum dolor sit amet'],
    ['JSON', '{"latitude": 52.1, "longitude": 21.0}'],
  ];
  const przeszly = [];
  for (const [opis, tresc] of smieci) {
    if (czytajSrt(tresc) !== null) przeszly.push(opis);
    if (jestSrtDji(tresc)) przeszly.push(opis + ' (wykrywacz)');
  }
  console.log(`6. śmieci wzięte za telemetrię: ${przeszly.length ? przeszly.join(', ') : 'żadne'}`);
  if (przeszly.length) fail.push(`za telemetrię uznane: ${przeszly.join(', ')}`);

  /* Brak zasięgu GPS zapisany zerami to NIE jest punkt na Ziemi. */
  const bezGps = czytajSrt(nowySrt({ sekund: 2 }).replace(/latitude: [\d.]+/g, 'latitude: 0.000000')
    .replace(/longitude: [\d.]+/g, 'longitude: 0.000000'));
  console.log(`7. klip bez zasięgu GPS → lat ${bezGps.lat}, punktów śladu ${bezGps.slad.length}, `
    + `ISO ${bezGps.iso}`);
  if (bezGps.lat !== null) fail.push('współrzędne 0,0 potraktowane jako miejsce na Ziemi');
  if (bezGps.slad.length) fail.push('ślad lotu zbudowany z samych zer');
  if (bezGps.iso !== 400) fail.push('brak GPS-u zabrał też nastawy, które były poprawne');

  /* ---- 5. Nazwa pliku i wpięcie we wpis archiwum ---- */
  console.log(`8. DJI_0042.MP4 → ${nazwaSrtDla('DJI_0042.MP4')}`);
  if (nazwaSrtDla('DJI_0042.MP4') !== 'DJI_0042.SRT') fail.push('zła nazwa pliku telemetrii');

  const wpis = naWpisArchiwum(
    { id: 'onedrive:1', nazwa: 'DJI_0042.MP4', typ: 'wideo', kiedy: null, lat: null, lon: null,
      iso: null, przyslona: null, ogniskowa: null, czasS: null },
    t,
  );
  console.log(`9. wpis po wzbogaceniu: ${wpis.lat}, ISO ${wpis.iso}, ${wpis.ogniskowa} mm, `
    + `lot ${wpis.lot.sekund} s / ${wpis.lot.dystansM} m`);
  if (!wpis.lat || !wpis.iso || !wpis.ogniskowa) fail.push('telemetria nie trafiła do wpisu');
  if (!wpis.lot || !wpis.lot.dystansM) fail.push('brak podsumowania lotu we wpisie');

  // Dane, które już są, mają PIERWSZEŃSTWO — telemetria uzupełnia, nie nadpisuje.
  const zDanymi = naWpisArchiwum(
    { id: 'x', kiedy: '2020-01-01T10:00:00', lat: 50.0, lon: 20.0, iso: 100,
      przyslona: 8, ogniskowa: 50, czasS: 0.01 },
    t,
  );
  console.log(`10. wpis z własnymi danymi: lat ${zDanymi.lat}, ISO ${zDanymi.iso}, `
    + `${zDanymi.ogniskowa} mm (telemetria miała ${t.lat}, ${t.iso}, ${t.ogniskowa})`);
  if (zDanymi.lat !== 50.0 || zDanymi.iso !== 100 || zDanymi.ogniskowa !== 50) {
    fail.push('telemetria nadpisała dane, które już były we wpisie');
  }

  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nTELEMETRIA SRT OK');
  process.exit(fail.length ? 1 : 0);
})();

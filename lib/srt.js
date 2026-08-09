/* ============================================================
   Telemetria z klipów DJI — plik .SRT obok każdego nagrania

   To jest największa dziura, jaka została w archiwum, i przez cały czas
   leżała na wierzchu. Cosmos wie o Twoich ZDJĘCIACH wszystko: aparat,
   obiektyw, ogniskową, przysłonę, ISO, GPS, porę światła. O KLIPACH nie wie
   NIC — Microsoft Graph oddaje dla wideo samą datę i rozmiar. Pytanie „pokaż
   ujęcia znad jeziora o zachodzie" działało więc wyłącznie dla zdjęć.

   Tymczasem Mavic 3 zapisuje obok każdego klipu plik `.SRT`, a w nim DLA
   KAŻDEJ KLATKI: ISO, czas, przysłonę, korektę ekspozycji, ogniskową,
   szerokość, długość i dwie wysokości. Czyli dokładnie ten sam zestaw pól,
   który trzyma `lib/archiwum.js` — tyle że nikt go nie czytał.

   Format jest zwykłym tekstem, więc czytamy go sami, bez ani jednej
   biblioteki — tak samo jak EXIF w `lib/exif.js`. Warianty są dwa i oba
   trzeba znać, bo w jednym katalogu potrafią leżeć klipy z dwóch dronów:

     NOWY (Mavic 3, Air, Mini od kilku lat):
       [iso: 400] [shutter: 1/320.0] [fnum: 2.8] [ev: 0] [focal_len: 24.00]
       [latitude: 53.123456] [longitude: 22.654321]
       [rel_alt: 42.300 abs_alt: 158.900]

     STARY (Mavic Pro, Phantom):
       GPS(149.0251,-20.2533,16) BAROMETER:1.9
       ISO:100 Shutter:60 EV: 0 Fnum:2.2

   Z całego pliku robimy JEDEN wpis do archiwum, nie tysiąc. Klip trwający
   minutę to 1800 klatek; wrzucenie ich wszystkich do indeksu rozsadziłoby go
   i niczego nie dało, bo pytania brzmią „gdzie i czym to nakręciłem", a nie
   „jakie było ISO w klatce 1247". Ślad lotu zostaje osobno i w rozdzielczości
   sekundowej — tyle wystarczy na mapę i na profil wysokości.
   ============================================================ */

/** Czy ten plik w ogóle wygląda na telemetrię DJI? */
function jestSrtDji(tekst) {
  const t = String(tekst).slice(0, 4000);
  return /\[latitude\s*:/i.test(t) || /\bGPS\s*\(/.test(t);
}

/** Ułamek „1/320.0" albo liczba „60" → sekundy.
 *
 *  Uwaga na starą postać: `Shutter:60` NIE znaczy 60 sekund, tylko 1/60 s.
 *  DJI zapisywało tam mianownik. Potraktowanie tego dosłownie dawałoby
 *  minutową ekspozycję z drona w locie, co jest bez sensu — i właśnie
 *  ta bezsensowność jest tu regułą rozstrzygającą.
 */
function czasNaSekundy(x) {
  const s = String(x).trim();
  const ulamek = s.match(/^1\s*\/\s*([\d.]+)$/);
  if (ulamek) return 1 / Number(ulamek[1]);
  const liczba = Number(s);
  if (!Number.isFinite(liczba) || liczba <= 0) return null;
  return liczba >= 1 ? 1 / liczba : liczba;
}

function liczbaZ(tekst, wzorzec) {
  const m = tekst.match(wzorzec);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

/** Jedna klatka z nowego formatu (nawiasy kwadratowe). */
function klatkaNowa(blok) {
  const lat = liczbaZ(blok, /\[latitude\s*:\s*(-?[\d.]+)\s*\]/i);
  const lon = liczbaZ(blok, /\[long?itude\s*:\s*(-?[\d.]+)\s*\]/i);
  const czasTekst = (blok.match(/\[shutter\s*:\s*([^\]\s]+)\s*\]/i) || [])[1];
  return {
    lat, lon,
    iso: liczbaZ(blok, /\[iso\s*:\s*(\d+)\s*\]/i),
    przyslona: liczbaZ(blok, /\[fnum\s*:\s*([\d.]+)\s*\]/i),
    ogniskowa: liczbaZ(blok, /\[focal_len\s*:\s*([\d.]+)\s*\]/i),
    ev: liczbaZ(blok, /\[ev\s*:\s*(-?[\d.]+)\s*\]/i),
    czasS: czasTekst ? czasNaSekundy(czasTekst) : null,
    wysokoscWzgl: liczbaZ(blok, /\brel_alt\s*:\s*(-?[\d.]+)/i),
    wysokoscBezwzgl: liczbaZ(blok, /\babs_alt\s*:\s*(-?[\d.]+)/i),
    kiedy: (blok.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/) || [])[1] || null,
  };
}

/** Jedna klatka ze starego formatu (pary klucz:wartość). */
function klatkaStara(blok) {
  const gps = blok.match(/GPS\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(?:,\s*(-?[\d.]+)\s*)?\)/);
  const czasTekst = (blok.match(/\bShutter\s*:\s*([\d./]+)/i) || [])[1];
  /* W starym formacie długość jest PIERWSZA: GPS(lon,lat,alt). Odwrotnie niż
     w nowym i odwrotnie niż podpowiada nazwa. Zamiana tych dwóch miejscami
     przenosi materiał z Biebrzy do Somalii i nikt tego nie zauważy, dopóki
     nie spojrzy na mapę. */
  return {
    lon: gps ? Number(gps[1]) : null,
    lat: gps ? Number(gps[2]) : null,
    iso: liczbaZ(blok, /\bISO\s*:\s*(\d+)/i),
    przyslona: liczbaZ(blok, /\bFnum\s*:\s*([\d.]+)/i),
    ogniskowa: null,
    ev: liczbaZ(blok, /\bEV\s*:\s*(-?[\d.]+)/i),
    czasS: czasTekst ? czasNaSekundy(czasTekst) : null,
    wysokoscWzgl: liczbaZ(blok, /\bBAROMETER\s*:\s*(-?[\d.]+)/i),
    wysokoscBezwzgl: gps && gps[3] !== undefined ? Number(gps[3]) : null,
    kiedy: (blok.match(/(\d{4})[.-](\d{2})[.-](\d{2})[ T](\d{2}:\d{2}:\d{2})/) || null)
      && blok.replace(/.*?(\d{4})[.-](\d{2})[.-](\d{2})[ T](\d{2}:\d{2}:\d{2}).*/s, '$1-$2-$3T$4'),
  };
}

/** Najczęstsza wartość w zbiorze — do ISO i przysłony sensowniejsza niż
 *  średnia. Średnia z ISO 100 i ISO 6400 daje 3250, czyli wartość, której
 *  aparat nigdy nie miał ustawionej. */
function najczestsza(wartosci) {
  const licznik = new Map();
  for (const w of wartosci) {
    if (w === null || w === undefined) continue;
    licznik.set(w, (licznik.get(w) || 0) + 1);
  }
  let best = null;
  let ile = 0;
  for (const [w, n] of licznik) if (n > ile) { best = w; ile = n; }
  return best;
}

function mediana(wartosci) {
  const a = wartosci.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.floor(a.length / 2)];
}

/** Odległość w metrach — do policzenia długości trasy lotu. */
function metry(a, b) {
  const R = 6371000;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Ile sekund trwa klip — z OSTATNIEGO ZNACZNIKA SubRip, nie z liczby klatek.
 *
 *  Pierwsza wersja dzieliła liczbę klatek przez 30 i to było zgadywanie:
 *  Mavic 3 nagrywa też 24, 25, 48, 50 i 120 kl./s, więc dwuminutowy klip
 *  w 60 kl./s wychodził na cztery minuty. Znacznik czasu jest w pliku wprost
 *  i nie trzeba niczego zakładać.
 *
 *  Format SubRip: `00:01:23,456 --> 00:01:23,489`. Bierzemy największy
 *  koniec, jaki widzimy — nie ostatni, bo uszkodzony ogon pliku potrafi mieć
 *  zera. */
function dlugoscSekund(surowy) {
  let max = 0;
  for (const m of surowy.matchAll(/-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/g)) {
    const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    if (s > max) max = s;
  }
  return max;
}

/**
 * Cały plik SRT → jeden opis klipu.
 *
 * @param {string} tekst treść pliku .SRT
 * @param {object} [opcje]
 * @param {number} [opcje.sladCo=1] co ile SEKUND zapisać punkt śladu lotu
 * @returns {object|null} null, gdy to nie jest telemetria DJI
 */
function czytajSrt(tekst, opcje = {}) {
  const surowy = String(tekst || '');
  if (!jestSrtDji(surowy)) return null;

  const nowy = /\[latitude\s*:/i.test(surowy);
  /* Bloki rozdziela pusta linia — tak wygląda każdy plik SubRip. Tolerujemy
     zarówno \n, jak i \r\n, bo klipy z karty pamięci mają zwykle to drugie. */
  const bloki = surowy.split(/\r?\n\s*\r?\n/).filter((b) => b.trim());
  const klatki = [];
  for (const blok of bloki) {
    const k = nowy ? klatkaNowa(blok) : klatkaStara(blok);
    if (k && (k.lat !== null || k.iso !== null)) klatki.push(k);
  }
  if (!klatki.length) return null;

  const zGps = klatki.filter((k) => Number.isFinite(k.lat) && Number.isFinite(k.lon)
    // 0,0 to nie jest miejsce na Ziemi, tylko brak zasięgu GPS zapisany zerami.
    && (k.lat !== 0 || k.lon !== 0));

  /* Ślad lotu w rozdzielczości sekundowej. Klip minutowy to 1800 klatek
     i wszystkie z nich w indeksie byłyby marnowaniem miejsca — ruch drona
     w ciągu jednej klatki jest poniżej dokładności GPS-u. */
  const trwa = dlugoscSekund(surowy);
  const naSekunde = trwa > 0 ? klatki.length / trwa : 30;
  const krok = Math.max(1, Math.round(naSekunde * (Number(opcje.sladCo) || 1)));
  const slad = zGps.filter((_, i) => i % krok === 0)
    .map((k) => ({
      lat: Number(k.lat.toFixed(6)),
      lon: Number(k.lon.toFixed(6)),
      w: Number.isFinite(k.wysokoscWzgl) ? Number(k.wysokoscWzgl.toFixed(1)) : null,
    }));

  let dystans = 0;
  for (let i = 1; i < zGps.length; i++) dystans += metry(zGps[i - 1], zGps[i]);

  const wysokosci = klatki.map((k) => k.wysokoscWzgl).filter(Number.isFinite);
  const srodek = zGps.length ? zGps[Math.floor(zGps.length / 2)] : null;

  return {
    klatek: klatki.length,
    sekund: trwa ? Number(trwa.toFixed(1)) : null,
    klatekNaSekunde: trwa ? Math.round(naSekunde) : null,
    kiedy: klatki[0].kiedy || null,
    /* Współrzędne bierzemy ze ŚRODKA lotu, nie z pierwszej klatki. Pierwsza
       bywa jeszcze na ziemi przy samochodzie, a pytanie „co mam znad tego
       jeziora" dotyczy miejsca, nad którym dron faktycznie był. */
    lat: srodek ? Number(srodek.lat.toFixed(6)) : null,
    lon: srodek ? Number(srodek.lon.toFixed(6)) : null,
    iso: najczestsza(klatki.map((k) => k.iso)),
    przyslona: najczestsza(klatki.map((k) => k.przyslona)),
    ogniskowa: najczestsza(klatki.map((k) => k.ogniskowa)),
    czasS: mediana(klatki.map((k) => k.czasS)),
    wysokoscMin: wysokosci.length ? Number(Math.min(...wysokosci).toFixed(1)) : null,
    wysokoscMax: wysokosci.length ? Number(Math.max(...wysokosci).toFixed(1)) : null,
    dystansM: Math.round(dystans),
    slad,
  };
}


/** Nazwa pliku wideo → nazwa oczekiwanego pliku telemetrii.
 *  DJI zapisuje `DJI_0001.MP4` i obok `DJI_0001.SRT`. Bywa też `.srt`. */
function nazwaSrtDla(nazwaWideo) {
  return String(nazwaWideo).replace(/\.[^.]+$/, '') + '.SRT';
}

/** Opis telemetrii wpleciony w pola wpisu archiwum.
 *  Osobno od `czytajSrt`, żeby parser nie musiał nic wiedzieć o archiwum. */
function naWpisArchiwum(wpis, tele) {
  if (!tele) return wpis;
  return {
    ...wpis,
    // Nie nadpisujemy tego, co już wiadomo z innego źródła.
    kiedy: wpis.kiedy || tele.kiedy,
    lat: wpis.lat !== null && wpis.lat !== undefined ? wpis.lat : tele.lat,
    lon: wpis.lon !== null && wpis.lon !== undefined ? wpis.lon : tele.lon,
    iso: wpis.iso || tele.iso,
    przyslona: wpis.przyslona || tele.przyslona,
    ogniskowa: wpis.ogniskowa || tele.ogniskowa,
    czasS: wpis.czasS || tele.czasS,
    lot: {
      sekund: tele.sekund,
      wysokoscMin: tele.wysokoscMin,
      wysokoscMax: tele.wysokoscMax,
      dystansM: tele.dystansM,
      punktow: tele.slad.length,
    },
  };
}

module.exports = { czytajSrt, jestSrtDji, nazwaSrtDla, naWpisArchiwum, czasNaSekundy };

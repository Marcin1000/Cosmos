/* ============================================================
   EXIF — metadane zdjęcia prosto z pliku

   Fundament archiwum materiału. Bez tego indeks wiedziałby tylko „jest plik
   IMG_4821.jpg", a z tym wie: Canon R6 II, 50 mm, f/1.8, 1/200 s, ISO 400,
   14 czerwca o 19:42, 52,02°N 20,90°E. Dopiero na takich danych da się
   zapytać „ile klipów nakręciłem 50 mm w tym roku".

   Czytamy sami, bo to zamknięty format, nie długi ogon: EXIF to struktura
   TIFF wklejona w segment APP1 pliku JPEG. Sto kilkadziesiąt linijek na
   wszystko, co potrzebne. Formaty RAW (CR3) i wideo mają własne kontenery
   i te oddajemy zmysłom — zgodnie z zasadą z README.
   ============================================================ */

// Interesujące nas znaczniki. Reszta EXIF-u to setki pól, których nikt
// nigdy o nic nie zapyta.
const IFD0 = {
  0x010f: 'producent',
  0x0110: 'aparat',
  0x0112: 'orientacja',
  0x0132: 'data',
};
const EXIF_IFD = {
  0x829a: 'czas',           // ExposureTime
  0x829d: 'przyslona',      // FNumber
  0x8827: 'iso',
  0x9003: 'dataZdjecia',    // DateTimeOriginal
  0x920a: 'ogniskowa',
  0xa002: 'szerokosc',
  0xa003: 'wysokosc',
  0xa434: 'obiektyw',       // LensModel
};
const GPS_IFD = {
  0x0001: 'szerGeoRef',
  0x0002: 'szerGeo',
  0x0003: 'dlugGeoRef',
  0x0004: 'dlugGeo',
};

const ROZMIAR_TYPU = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Znajdź segment APP1 z EXIF-em. Zwraca offset początku nagłówka TIFF. */
function znajdzExif(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return -1;   // nie JPEG
  let p = 2;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return -1;                 // rozjechaliśmy się na segmentach
    const marker = buf[p + 1];
    if (marker === 0xda || marker === 0xd9) return -1;  // początek danych obrazu
    const dlugosc = buf.readUInt16BE(p + 2);
    if (dlugosc < 2) return -1;
    if (marker === 0xe1 && buf.toString('latin1', p + 4, p + 10) === 'Exif\0\0') {
      return p + 10;
    }
    p += 2 + dlugosc;
  }
  return -1;
}

/** Odczytaj jeden katalog IFD. */
function czytajIfd(buf, tiff, offset, mapa, male, wynik) {
  const u16 = (o) => (male ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (male ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const i32 = (o) => (male ? buf.readInt32LE(o) : buf.readInt32BE(o));

  const poz = tiff + offset;
  if (poz + 2 > buf.length) return {};
  const ile = u16(poz);
  // Uszkodzony plik potrafi podać absurdalną liczbę wpisów — nie idziemy w to.
  if (ile > 512) return {};

  const wskazniki = {};
  for (let i = 0; i < ile; i++) {
    const w = poz + 2 + i * 12;
    if (w + 12 > buf.length) break;
    const tag = u16(w);
    const typ = u16(w + 2);
    const licznik = u32(w + 4);
    const bajtow = (ROZMIAR_TYPU[typ] || 0) * licznik;
    if (!bajtow) continue;

    // Wartości do czterech bajtów siedzą w samym wpisie, dłuższe pod adresem.
    const dane = bajtow <= 4 ? w + 8 : tiff + u32(w + 8);
    if (dane < 0 || dane + bajtow > buf.length) continue;

    if (tag === 0x8769) { wskazniki.exif = u32(w + 8); continue; }
    if (tag === 0x8825) { wskazniki.gps = u32(w + 8); continue; }

    const nazwa = mapa[tag];
    if (!nazwa) continue;

    if (typ === 2) {
      wynik[nazwa] = buf.toString('latin1', dane, dane + bajtow).replace(/\0.*$/, '').trim();
    } else if (typ === 3) {
      wynik[nazwa] = u16(dane);
    } else if (typ === 4) {
      wynik[nazwa] = u32(dane);
    } else if (typ === 5 || typ === 10) {
      // RATIONAL: licznik i mianownik jako osobne liczby.
      const ulamki = [];
      for (let k = 0; k < licznik; k++) {
        const licz = typ === 10 ? i32(dane + k * 8) : u32(dane + k * 8);
        const mian = typ === 10 ? i32(dane + k * 8 + 4) : u32(dane + k * 8 + 4);
        ulamki.push(mian ? licz / mian : 0);
      }
      wynik[nazwa] = licznik === 1 ? ulamki[0] : ulamki;
    }
  }
  return wskazniki;
}

/** Stopnie z zapisu EXIF (stopnie, minuty, sekundy) plus półkula. */
function naStopnie(dms, ref) {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const st = dms[0] + dms[1] / 60 + dms[2] / 3600;
  if (!Number.isFinite(st)) return null;
  return (ref === 'S' || ref === 'W') ? -st : st;
}

/** „2026:06:14 19:42:03" → „2026-06-14T19:42:03". EXIF używa dwukropków
 *  także w części datowej.
 *
 *  Świadomie NIE dodajemy strefy ani nie zamieniamy na UTC. Aparat zapisuje
 *  czas ze swojego zegara, czyli lokalny czas ścienny, i nie mówi jaki.
 *  Dopisanie „Z" znaczyłoby „to było o 19:42 UTC", czyli o 21:42 w Polsce —
 *  zdjęcie ze złotej godziny wylądowałoby po ciemku. */
function naDate(s) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, r, mi, d, g, min, sek] = m;
  if (Number(mi) < 1 || Number(mi) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${r}-${mi}-${d}T${g}:${min}:${sek}`;
}

/** Canon wpisuje „Canon" i w pole producenta, i w nazwę modelu — sklejenie
 *  na ślepo dawało „Canon Canon EOS R6m2" przy każdym jego zdjęciu. */
function zlozNazweAparatu(producent, model) {
  const p = (producent || '').trim();
  const m = (model || '').trim();
  if (!p) return m || null;
  if (!m) return p;
  return m.toLowerCase().startsWith(p.toLowerCase()) ? m : `${p} ${m}`;
}

/** Odczytaj EXIF z bufora JPEG. Zwraca `null`, gdy go nie ma.
 *  Nigdy nie rzuca — uszkodzone zdjęcie ma zostać pominięte, nie wywrócić
 *  indeksowania dwustu tysięcy plików. */
function czytajExif(buf) {
  try {
    const tiff = znajdzExif(buf);
    if (tiff < 0 || tiff + 8 > buf.length) return null;

    const kolejnosc = buf.toString('latin1', tiff, tiff + 2);
    if (kolejnosc !== 'II' && kolejnosc !== 'MM') return null;
    const male = kolejnosc === 'II';
    const u32 = (o) => (male ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

    const surowe = {};
    const wskazniki = czytajIfd(buf, tiff, u32(tiff + 4), IFD0, male, surowe);
    if (wskazniki.exif) czytajIfd(buf, tiff, wskazniki.exif, EXIF_IFD, male, surowe);
    const gps = {};
    if (wskazniki.gps) czytajIfd(buf, tiff, wskazniki.gps, GPS_IFD, male, gps);

    const lat = naStopnie(gps.szerGeo, gps.szerGeoRef);
    const lon = naStopnie(gps.dlugGeo, gps.dlugGeoRef);

    const out = {
      aparat: zlozNazweAparatu(surowe.producent, surowe.aparat),
      obiektyw: surowe.obiektyw || null,
      ogniskowa: Number.isFinite(surowe.ogniskowa) ? Math.round(surowe.ogniskowa) : null,
      przyslona: Number.isFinite(surowe.przyslona) ? Number(surowe.przyslona.toFixed(1)) : null,
      // Czas trzymamy w sekundach; „1/200" jest do pokazania, nie do liczenia.
      czasS: Number.isFinite(surowe.czas) ? surowe.czas : null,
      iso: Number.isFinite(surowe.iso) ? surowe.iso : null,
      kiedy: naDate(surowe.dataZdjecia) || naDate(surowe.data),
      szerokosc: surowe.szerokosc || null,
      wysokosc: surowe.wysokosc || null,
      lat: Number.isFinite(lat) ? Number(lat.toFixed(6)) : null,
      lon: Number.isFinite(lon) ? Number(lon.toFixed(6)) : null,
    };
    // Plik bez jednej użytecznej informacji to tyle, co brak EXIF-u.
    return Object.values(out).some((v) => v !== null) ? out : null;
  } catch {
    return null;
  }
}

/** „1/200" albo „2,5 s" — do pokazania człowiekowi. */
function czasJakoTekst(czasS) {
  if (!Number.isFinite(czasS) || czasS <= 0) return null;
  if (czasS >= 1) return `${Number(czasS.toFixed(1))} s`;
  return `1/${Math.round(1 / czasS)}`;
}

module.exports = { czytajExif, czasJakoTekst, znajdzExif, zlozNazweAparatu };

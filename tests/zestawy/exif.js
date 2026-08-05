/* EXIF — fundament archiwum materiału.

   Bez tego indeks wiedziałby tylko „jest plik IMG_4821.jpg". Z tym wie:
   Canon R6 II, 50 mm, f/1.8, 1/200 s, ISO 400, 14 czerwca o 19:42,
   52,02°N 20,90°E. Dopiero na takich danych da się zapytać „ile klipów
   nakręciłem 50 mm w tym roku".

   Testowe zdjęcia składamy TUTAJ, bajt po bajcie, zamiast wrzucać do
   repozytorium plik „przykladowy.jpg". Dzięki temu wiadomo, że test bada
   kod, a nie pamiątkę — i widać, jakie dokładnie bajty mają dać jaki wynik. */
const { czytajExif, czasJakoTekst } = require('../../lib/exif.js');

/* --- składanie JPEG-a z EXIF-em ---------------------------------------
   Struktura: SOI, segment APP1 („Exif\0\0" + nagłówek TIFF), koniec.
   TIFF: kolejność bajtów, magiczne 42, offset do IFD0. Każdy wpis IFD ma
   12 bajtów: tag, typ, liczba wartości, wartość albo offset. Wartości do
   czterech bajtów mieszczą się w samym wpisie, dłuższe leżą dalej. */

const TYPY = { ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5 };

function zbudujJpeg(ifd0, exifIfd, gpsIfd, { male = true } = {}) {
  const bufory = [];          // dane spoza wpisów (długie wartości)
  let ogonOffset = 0;         // liczony od początku TIFF, uzupełniany później

  const u16 = (v) => { const b = Buffer.alloc(2); male ? b.writeUInt16LE(v) : b.writeUInt16BE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); male ? b.writeUInt32LE(v) : b.writeUInt32BE(v); return b; };

  const dodajOgon = (buf) => {
    const gdzie = ogonOffset;
    bufory.push(buf);
    ogonOffset += buf.length;
    return gdzie;
  };

  function wpis(tag, typ, wartosc) {
    let licznik;
    let dane;
    if (typ === TYPY.ASCII) {
      const s = Buffer.from(`${wartosc}\0`, 'latin1');
      licznik = s.length;
      dane = s;
    } else if (typ === TYPY.RATIONAL) {
      const pary = Array.isArray(wartosc[0]) ? wartosc : [wartosc];
      licznik = pary.length;
      dane = Buffer.concat(pary.map(([l, m]) => Buffer.concat([u32(l), u32(m)])));
    } else if (typ === TYPY.SHORT) {
      licznik = 1;
      dane = Buffer.concat([u16(wartosc), Buffer.alloc(2)]);
    } else {
      licznik = 1;
      dane = u32(wartosc);
    }
    return { tag, typ, licznik, dane, wKrotce: dane.length <= 4 };
  }

  /* Układ: IFD0 → ExifIFD → GPS IFD → ogon z długimi wartościami.
     Offsety muszą być policzone z góry, więc najpierw mierzymy rozmiary. */
  const rozmiarIfd = (n) => 2 + n * 12 + 4;
  const offIfd0 = 8;
  const offExif = offIfd0 + rozmiarIfd(Object.keys(ifd0).length + (exifIfd ? 1 : 0) + (gpsIfd ? 1 : 0));
  const offGps = offExif + (exifIfd ? rozmiarIfd(Object.keys(exifIfd).length) : 0);
  ogonOffset = offGps + (gpsIfd ? rozmiarIfd(Object.keys(gpsIfd).length) : 0);

  function zlozIfd(wpisy) {
    const czesci = [u16(wpisy.length)];
    for (const w of wpisy) {
      czesci.push(u16(w.tag), u16(w.typ), u32(w.licznik));
      czesci.push(w.wKrotce
        ? Buffer.concat([w.dane, Buffer.alloc(4 - w.dane.length)])
        : u32(dodajOgon(w.dane)));
    }
    czesci.push(u32(0));
    return Buffer.concat(czesci);
  }

  // Kolejność ma znaczenie: ogon zapełnia się w trakcie składania.
  const wpisyIfd0 = Object.entries(ifd0).map(([t, [typ, v]]) => wpis(Number(t), typ, v));
  if (exifIfd) wpisyIfd0.push(wpis(0x8769, TYPY.LONG, offExif));
  if (gpsIfd) wpisyIfd0.push(wpis(0x8825, TYPY.LONG, offGps));
  const bIfd0 = zlozIfd(wpisyIfd0);
  const bExif = exifIfd ? zlozIfd(Object.entries(exifIfd).map(([t, [typ, v]]) => wpis(Number(t), typ, v))) : Buffer.alloc(0);
  const bGps = gpsIfd ? zlozIfd(Object.entries(gpsIfd).map(([t, [typ, v]]) => wpis(Number(t), typ, v))) : Buffer.alloc(0);

  const tiff = Buffer.concat([
    Buffer.from(male ? 'II' : 'MM', 'latin1'),
    u16(42), u32(offIfd0),
    bIfd0, bExif, bGps, ...bufory,
  ]);

  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const dlugosc = Buffer.alloc(2);
  dlugosc.writeUInt16BE(app1.length + 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),               // SOI
    Buffer.from([0xff, 0xe1]), dlugosc, app1,
    Buffer.from([0xff, 0xd9]),               // EOI
  ]);
}

const ZDJECIE = (opcje) => zbudujJpeg(
  {
    0x010f: [TYPY.ASCII, 'Canon'],
    0x0110: [TYPY.ASCII, 'Canon EOS R6m2'],
    0x0132: [TYPY.ASCII, '2026:06:14 19:42:03'],
  },
  {
    0x829a: [TYPY.RATIONAL, [1, 200]],       // 1/200 s
    0x829d: [TYPY.RATIONAL, [18, 10]],       // f/1.8
    0x8827: [TYPY.SHORT, 400],               // ISO 400
    0x9003: [TYPY.ASCII, '2026:06:14 19:42:03'],
    0x920a: [TYPY.RATIONAL, [50, 1]],        // 50 mm
    0xa002: [TYPY.LONG, 6000],
    0xa003: [TYPY.LONG, 4000],
    0xa434: [TYPY.ASCII, 'RF50mm F1.8 STM'],
  },
  {
    0x0001: [TYPY.ASCII, 'N'],
    0x0002: [TYPY.RATIONAL, [[52, 1], [1, 1], [2892, 100]]],   // 52°1'28,92"
    0x0003: [TYPY.ASCII, 'E'],
    0x0004: [TYPY.RATIONAL, [[20, 1], [54, 1], [660, 100]]],   // 20°54'6,6"
  },
  opcje,
);

(async () => {
  const fail = [];

  // 1. pełny odczyt
  const e = czytajExif(ZDJECIE());
  console.log('1.', JSON.stringify(e));
  if (!e) { console.log('\nDO POPRAWY:\n- nie odczytał żadnego EXIF-u'); process.exit(1); }
  // Canon wpisuje „Canon" i w producenta, i w model — nie chcemy tego dwa razy.
  if (e.aparat !== 'Canon EOS R6m2') fail.push(`aparat: „${e.aparat}" (podwójny producent?)`);
  if (e.obiektyw !== 'RF50mm F1.8 STM') fail.push(`obiektyw: „${e.obiektyw}"`);
  if (e.ogniskowa !== 50) fail.push(`ogniskowa: ${e.ogniskowa}`);
  if (e.przyslona !== 1.8) fail.push(`przysłona: ${e.przyslona}`);
  if (e.iso !== 400) fail.push(`ISO: ${e.iso}`);
  if (Math.abs(e.czasS - 1 / 200) > 1e-9) fail.push(`czas: ${e.czasS}`);
  if (e.szerokosc !== 6000 || e.wysokosc !== 4000) fail.push('wymiary zdjęcia');

  // 2. data — EXIF używa dwukropków także w części datowej
  /* Aparat zapisuje czas ze swojego zegara — lokalny, bez strefy. Dopisanie
     „Z" znaczyłoby „19:42 UTC", czyli 21:42 w Polsce: zdjęcie ze złotej
     godziny wylądowałoby po ciemku. Dlatego data ma zostać naiwna. */
  console.log(`2. data: ${e.kiedy}`);
  if (e.kiedy !== '2026-06-14T19:42:03') fail.push(`data: ${e.kiedy}`);
  if (/[Zz]|[+-]\d{2}:\d{2}$/.test(e.kiedy || '')) fail.push('data dostała strefę, której EXIF nie podaje');

  /* 3. GPS: stopnie-minuty-sekundy → stopnie dziesiętne. Tu najłatwiej
     o cichy błąd — wynik „52,0" zamiast „52,0247" wygląda wiarygodnie,
     a wskazuje miejsce oddalone o kilka kilometrów. */
  console.log(`3. GPS: ${e.lat}, ${e.lon}`);
  if (Math.abs(e.lat - 52.0247) > 0.0005) fail.push(`szerokość: ${e.lat}`);
  if (Math.abs(e.lon - 20.9018) > 0.0005) fail.push(`długość: ${e.lon}`);

  // 4. półkula południowa i zachodnia muszą dać wartości ujemne
  const pd = czytajExif(zbudujJpeg({ 0x010f: [TYPY.ASCII, 'X'] }, null, {
    0x0001: [TYPY.ASCII, 'S'],
    0x0002: [TYPY.RATIONAL, [[33, 1], [52, 1], [0, 1]]],
    0x0003: [TYPY.ASCII, 'W'],
    0x0004: [TYPY.RATIONAL, [[70, 1], [40, 1], [0, 1]]],
  }));
  console.log(`4. półkula S/W: ${pd.lat}, ${pd.lon}`);
  if (pd.lat > 0 || pd.lon > 0) fail.push('nie uwzględnił półkuli S/W — znak dodatni');

  /* 5. Big-endian. Aparaty Canona zapisują „II", ale Nikon i Fuji „MM".
     Pominięcie tego znaczyłoby, że połowa archiwum czyta się jako śmieci. */
  const mm = czytajExif(ZDJECIE({ male: false }));
  console.log(`5. big-endian (MM): ISO ${mm && mm.iso}, ogniskowa ${mm && mm.ogniskowa}`);
  if (!mm || mm.iso !== 400 || mm.ogniskowa !== 50) fail.push('nie czyta zapisu big-endian');

  // 6. pliki bez EXIF-u i uszkodzone — pominięcie, nie wywrotka
  // 5b. producent bez powtórzenia w modelu — sklejamy normalnie
  const nikon = czytajExif(zbudujJpeg({
    0x010f: [TYPY.ASCII, 'NIKON CORPORATION'], 0x0110: [TYPY.ASCII, 'NIKON Z 6'],
  }, null, null));
  console.log(`5b. inny producent → „${nikon.aparat}"`);
  if (nikon.aparat !== 'NIKON CORPORATION NIKON Z 6') fail.push(`sklejanie nazwy: „${nikon.aparat}"`);

  const przypadki = [
    ['pusty bufor', Buffer.alloc(0)],
    ['nie JPEG', Buffer.from('to jest zwykły tekst')],
    ['JPEG bez EXIF', Buffer.from([0xff, 0xd8, 0xff, 0xd9])],
    ['obcięty w połowie', ZDJECIE().subarray(0, 30)],
    ['same śmieci po nagłówku', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]), Buffer.from('Exif\0\0ŚMIEĆ')])],
  ];
  for (const [opis, buf] of przypadki) {
    let wynik;
    try { wynik = czytajExif(buf); } catch (err) { fail.push(`„${opis}" rzucił wyjątkiem: ${err.message}`); continue; }
    console.log(`6. ${opis} → ${wynik === null ? 'null (dobrze)' : JSON.stringify(wynik)}`);
  }

  // 7. czas dla człowieka
  const czasy = [[1 / 200, '1/200'], [1 / 60, '1/60'], [2.5, '2.5 s'], [1, '1 s'], [0, null]];
  for (const [wejscie, oczekiwane] of czasy) {
    const got = czasJakoTekst(wejscie);
    if (got !== oczekiwane) fail.push(`czasJakoTekst(${wejscie}) = „${got}", oczekiwano „${oczekiwane}"`);
  }
  console.log(`7. czas dla człowieka: ${czasy.map(([w]) => czasJakoTekst(w)).join(' · ')}`);

  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nEXIF OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Data zdjęcia i to, co ginie przy ponownym indeksowaniu.

   Dwie usterki z jednego korzenia: archiwum nie odróżniało MOMENTU ZROBIENIA
   zdjęcia od MOMENTU WGRANIA pliku do chmury.

   1. PORZĄDEK. Marcin: „Nie idzie od najnowszych zdjęć, bo pokazuje zdjęcia
      gór z 2022 roku." Sortowanie było poprawne — kłamała data. Microsoft
      Graph wypełnia `photo.takenDateTime` dla JPEG-ów, ale dla RAW-ów Canona
      (CR2/CR3) już nie, a wtedy braliśmy `createdDateTime`, czyli chwilę
      wgrania. Zdjęcie zrobione w 2022 i wgrane w 2026 uczciwie lądowało na
      szczycie listy „od najnowszych".

   2. PRACA DO KOSZA. `dodaj()` podmieniało znany wpis w CAŁOŚCI. Dla nowego
      pliku poprawne, dla znanego — katastrofalne: jedno kliknięcie
      „indeksuj OneDrive" po dograniu nowej sesji kasowało `obejrzane`,
      `obiekty`, `obiektyw`, dane lotu i poprawione daty. Czyli 55 tysięcy
      plików przemielonych rozpoznawaniem treści i osobny przebieg po EXIF —
      do powtórzenia, bez jednego ostrzeżenia, przy indeksowaniu, które
      wygląda na udane, bo liczba plików się zgadza.

   Punkt 2 nie wyszedł z użycia, tylko z czytania kodu przy okazji punktu 1.
   Dlatego jest tu na stałe: to jedyna usterka w archiwum, która niszczy dane
   nieodwracalnie, a objawia się dopiero wtedy, gdy jest już po wszystkim.
*/
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { utworz } = require('../../lib/archiwum.js');
const { dataZNazwy } = require('../../lib/onedrive.js');

const fail = [];

/* --- 1. DATA Z NAZWY PLIKU ------------------------------------------------
   Aparaty numerują (`IMG_4821.CR3`) i tam nie ma czego szukać, ale telefony
   i OneDrive datują — a to właśnie te pliki mają najczęściej bezużyteczną
   datę systemową. Sprawdzamy też, czego funkcja NIE ma prawa uznać za datę:
   wpis z fałszywą datą jest gorszy niż wpis bez daty, bo wchodzi do
   sortowania i do filtra `rok=`. */
const NAZWY = [
  ['20220814_153012.jpg', '2022-08-14T15:30:12'],           // Samsung
  ['IMG_20220814_153012.jpg', '2022-08-14T15:30:12'],       // Android
  ['PXL_20220814_153012123.jpg', '2022-08-14T15:30:12'],    // Pixel
  ['Screenshot_20220814-153012.png', '2022-08-14T15:30:12'],
  ['2022-08-14 15.30.12.jpg', '2022-08-14T15:30:12'],       // wysyłka z OneDrive
  ['VID_20220814_153012.mp4', '2022-08-14T15:30:12'],
  ['IMG_4821.CR3', null],                                    // sam numer klatki
  ['DJI_0001.JPG', null],
  ['DSC_20231245_996100.jpg', null],                         // 12. miesiąc 45. dnia
  ['20220814_253012.jpg', null],                             // godzina 25
  ['2099-01-01 00.00.00.jpg', null],                         // data z przyszłości
];
for (const [nazwa, oczek] of NAZWY) {
  const got = dataZNazwy(nazwa);
  console.log(`1. ${nazwa.padEnd(32)} → ${got}`);
  if (got !== oczek) fail.push(`dataZNazwy("${nazwa}") dało ${got}, spodziewane ${oczek}`);
}

/* --- 2. PONOWNE INDEKSOWANIE NIE KASUJE PRZEBIEGÓW ------------------------
   Odtwarzamy dokładnie tę kolejność, która zdarza się u Marcina:
   listowanie → rozpoznanie treści → dociągnięcie EXIF → PONOWNE listowanie
   (bo doszła nowa sesja). Po ostatnim kroku ma zostać wszystko. */
const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-reindeks-'));
const a = utworz(katalog);

// Tak wygląda RAW z Canona prosto z listowania Grapha: bez aparatu, bez ISO,
// z datą WGRANIA i bez obiektywu — Graph nie czyta CR3.
const zListowania = {
  id: 'onedrive:c1', zrodlo: 'onedrive', typ: 'zdjecie',
  nazwa: '3B9A4703.CR3', sciezka: '/Zdjęcia/Góry 2022/3B9A4703.CR3',
  kiedy: '2026-08-08T20:19:00', dataZrodlo: 'plik',
  aparat: null, iso: null, przyslona: null, ogniskowa: null, obiektyw: null,
};
a.dodaj([zListowania]);

// Przebieg po obrazie: YOLO zobaczyło, co jest na zdjęciu.
const poObrazie = a.szukaj({})[0];
a.dodaj([{ ...poObrazie, obejrzane: true, obiekty: ['person', 'backpack'] }]);

// Przebieg po EXIF: prawdziwa data, aparat, obiektyw, GPS.
const poYolo = a.szukaj({})[0];
a.dodaj([{
  ...poYolo, exifCzytany: true, dataZrodlo: 'exif',
  kiedy: '2022-08-14T15:30:12', aparat: 'Canon EOS R6m2',
  obiektyw: 'RF24-105mm F4 L IS USM', iso: 400, przyslona: 4, ogniskowa: 35,
  lat: 49.2992, lon: 19.9496,
}]);

const przed = a.szukaj({})[0];
console.log(`2. po obu przebiegach: kiedy=${przed.kiedy}, aparat=${przed.aparat}, `
  + `obiektyw=${przed.obiektyw}, obejrzane=${przed.obejrzane}, obiekty=${przed.obiekty.length}`);

// I TERAZ to samo listowanie z Grapha jeszcze raz — Marcin dograł nową sesję.
a.dodaj([zListowania]);
const po = a.szukaj({})[0];
console.log(`   po ponownym listowaniu: kiedy=${po.kiedy}, aparat=${po.aparat}, `
  + `obiektyw=${po.obiektyw}, obejrzane=${po.obejrzane}, obiekty=${po.obiekty.length}, `
  + `exifCzytany=${po.exifCzytany}`);

if (po.kiedy !== '2022-08-14T15:30:12') {
  fail.push(`ponowne indeksowanie cofnęło datę na ${po.kiedy} — data wgrania nadpisała EXIF`);
}
if (po.aparat !== 'Canon EOS R6m2') fail.push('ponowne indeksowanie skasowało aparat');
if (!po.obiektyw) fail.push('ponowne indeksowanie skasowało obiektyw');
if (!po.obejrzane) fail.push('ponowne indeksowanie skasowało `obejrzane` — YOLO pójdzie od nowa');
if (po.obiekty.length !== 2) fail.push('ponowne indeksowanie skasowało wykryte obiekty');
if (!po.exifCzytany) fail.push('ponowne indeksowanie skasowało `exifCzytany` — EXIF pójdzie od nowa');
if (po.iso !== 400 || po.lat === null) fail.push('ponowne indeksowanie skasowało ISO albo GPS');

/* Pola WYLICZANE muszą iść za składnikami. Zdjęcie odzyskuje datę i GPS,
   więc pora światła też ma być policzona dla sierpnia 2022 w Tatrach,
   a nie zostać ta sprzed scalenia. */
console.log(`   światło=${po.swiatlo}, poraDnia=${po.poraDnia}, przybliżone=${po.swiatloPrzyblizone}`);
if (po.swiatloPrzyblizone) fail.push('`swiatloPrzyblizone` zostało na true mimo odzyskanego GPS-u');

/* --- 3. NOWE DANE MAJĄ PRAWO WYGRAĆ ---------------------------------------
   Scalanie nie może być zamrażarką: gdy plik naprawdę się zmienił (Marcin
   poprawił metadane w Lightroomie i zsynchronizował), nowa wartość ma wejść.
   Inaczej wylecielibyśmy z jednej skrajności w drugą. */
a.dodaj([{ ...zListowania, aparat: 'Canon EOS R5', dataZrodlo: 'exif',
  kiedy: '2022-08-14T16:00:00', obiektyw: 'RF70-200mm F4 L IS USM' }]);
const po3 = a.szukaj({})[0];
console.log(`3. nowsze dane z EXIF: aparat=${po3.aparat}, kiedy=${po3.kiedy}, obiektyw=${po3.obiektyw}`);
if (po3.aparat !== 'Canon EOS R5') fail.push('scalanie zablokowało poprawioną wartość aparatu');
if (po3.kiedy !== '2022-08-14T16:00:00') fail.push('scalanie zablokowało poprawioną datę z EXIF-u');
if (!/70-200/.test(po3.obiektyw || '')) fail.push('scalanie zablokowało poprawiony obiektyw');

/* --- 4. PORZĄDEK OD NAJNOWSZYCH ------------------------------------------
   Sedno skargi Marcina. Trzy pliki: zdjęcie z gór z 2022 (wgrane wczoraj),
   zdjęcie z maja 2026 i zrzut ekranu z sierpnia 2026. Po naprawie góry mają
   być NA KOŃCU listy, a nie na jej szczycie. */
const kat4 = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-porzadek-'));
const a4 = utworz(kat4);
a4.dodaj([
  { id: 'g', zrodlo: 'onedrive', typ: 'zdjecie', nazwa: '3B9A4703.CR3',
    sciezka: '/Góry 2022/3B9A4703.CR3', kiedy: '2022-08-14T15:30:12', dataZrodlo: 'exif' },
  { id: 'm', zrodlo: 'onedrive', typ: 'zdjecie', nazwa: '3B9A5000.CR3',
    sciezka: '/Mazury 2026/3B9A5000.CR3', kiedy: '2026-05-02T09:00:00', dataZrodlo: 'exif' },
  { id: 's', zrodlo: 'onedrive', typ: 'zdjecie', nazwa: 'Screenshot_20260809_154500.jpg',
    sciezka: '/Z aparatu/Screenshot_20260809_154500.jpg', kiedy: '2026-08-09T15:45:00', dataZrodlo: 'nazwa' },
]);
const kolejnosc = a4.szukaj({}).map((w) => w.id).join(',');
console.log(`4. kolejność od najnowszych: ${kolejnosc}`);
if (kolejnosc !== 's,m,g') fail.push(`porządek to ${kolejnosc}, a ma być s,m,g (od najnowszych)`);

// A teraz to samo listowanie z Grapha, które kiedyś psuło porządek:
// góry dostają z powrotem datę wgrania i wskakują na czoło.
a4.dodaj([{ id: 'g', zrodlo: 'onedrive', typ: 'zdjecie', nazwa: '3B9A4703.CR3',
  sciezka: '/Góry 2022/3B9A4703.CR3', kiedy: '2026-08-08T20:19:00', dataZrodlo: 'plik' }]);
const kolejnosc2 = a4.szukaj({}).map((w) => w.id).join(',');
console.log(`   po ponownym listowaniu: ${kolejnosc2}`);
if (kolejnosc2 !== 's,m,g') {
  fail.push(`po ponownym listowaniu porządek to ${kolejnosc2} — data wgrania wypchnęła stare zdjęcie na górę`);
}
/* --- 5. WPISY SPRZED WPROWADZENIA `dataZrodlo` ----------------------------
   Archiwum Marcina liczy 55 tysięcy wpisów zapisanych ZANIM to pole powstało.
   Przebieg po EXIF naprawił im daty, ale nie zostawił po sobie śladu
   w `dataZrodlo` — więc gdyby ranga liczyła się wyłącznie z tego pola, wyszłyby
   z zerem i pierwsze ponowne indeksowanie cofnęłoby im daty na wgranie.
   Dokładnie tym plikom, którym najbardziej zależy. `exifCzytany` mówi o nich
   to samo i tu sprawdzamy, że jest czytane. */
const kat5 = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-stare-'));
const a5 = utworz(kat5);
a5.dodaj([{ id: 'stary', zrodlo: 'onedrive', typ: 'zdjecie', nazwa: '3B9A4703.CR3',
  sciezka: '/Góry 2022/3B9A4703.CR3', kiedy: '2022-08-14T15:30:12',
  exifCzytany: true /* i ani śladu `dataZrodlo` */ }]);
a5.dodaj([{ id: 'stary', zrodlo: 'onedrive', typ: 'zdjecie', nazwa: '3B9A4703.CR3',
  sciezka: '/Góry 2022/3B9A4703.CR3', kiedy: '2026-08-08T20:19:00', dataZrodlo: 'plik' }]);
const po5 = a5.szukaj({})[0];
console.log(`5. wpis bez \`dataZrodlo\`, za to z exifCzytany: kiedy=${po5.kiedy}`);
if (po5.kiedy !== '2022-08-14T15:30:12') {
  fail.push(`stary wpis stracił datę z EXIF-u przy ponownym indeksowaniu (${po5.kiedy})`);
}
fs.rmSync(kat5, { recursive: true, force: true });

fs.rmSync(kat4, { recursive: true, force: true });

fs.rmSync(katalog, { recursive: true, force: true });
console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nDATA I PONOWNE INDEKSOWANIE OK');
process.exit(fail.length ? 1 : 0);

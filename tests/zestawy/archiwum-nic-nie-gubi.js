/* Czy ta operacja może UBYĆ INFORMACJI? — pytanie zadane systematycznie.

   Marcin, po tym jak znalazłem kasowanie 55 tysięcy rozpoznanych plików przy
   ponownym indeksowaniu: „to pytanie należy zadać systematycznie wszystkim
   ścieżkom zapisu archiwum".

   Tamtą usterkę znalazłem CZYTAJĄC KOD, nie przez test i nie przez użycie.
   Przeszła przez wszystkie audyty, bo żaden nie pytał o ubytek informacji —
   pytały o poprawność wyniku, a wynik po skasowaniu jest formalnie poprawny:
   pliki się zgadzają co do liczby, tylko są puste.

   Zestaw przechodzi więc po KAŻDEJ ścieżce, która pisze do archiwum, i dla
   każdej sprawdza to samo: czy po operacji zostało wszystko, co było.
   Ścieżek jest pięć:

     1. `dodaj()` z listowania źródła      — ponowne indeksowanie
     2. `dodaj()` z przebiegu po EXIF      — dociąganie danych z plików
     3. `dodaj()` z przebiegu po obrazie   — rozpoznawanie treści
     4. wczytanie indeksu z dysku          — restart serwera
     5. `usunZrodlo()`                     — jedyne celowe kasowanie

   Do tego dwa przypadki brzegowe, które wyszły przy pisaniu tego zestawu
   i okazały się prawdziwymi usterkami — opisane przy swoich punktach.
*/
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { utworz } = require('../../lib/archiwum.js');

const fail = [];

/** Pełny wpis po wszystkich przebiegach — tyle informacji ma przeżyć. */
function bogatyWpis() {
  return {
    id: 'onedrive:x1', zrodlo: 'onedrive', typ: 'zdjecie',
    nazwa: '3B9A4703.CR3', sciezka: '/Zdjęcia/Góry 2022/3B9A4703.CR3',
    kiedy: '2022-08-14T15:30:12', dataZrodlo: 'exif', exifCzytany: true,
    aparat: 'Canon EOS R6m2', obiektyw: 'RF24-105mm F4 L IS USM',
    iso: 400, przyslona: 4, ogniskowa: 35, czasS: 0.004,
    lat: 49.2992, lon: 19.9496,
    obejrzane: true, obiekty: ['person', 'backpack'],
    dron: { wysokoscWzgl: 42, gimbalPochylenie: -30, gimbalObrot: 10 },
  };
}

/** Czego nie wolno stracić i jak to sprawdzić. */
const SKARBY = [
  ['obejrzane', (w) => w.obejrzane === true],
  ['obiekty', (w) => Array.isArray(w.obiekty) && w.obiekty.length === 2],
  ['obiektyw', (w) => /24-105/.test(w.obiektyw || '')],
  ['aparat', (w) => /R6m2/.test(w.aparat || '')],
  ['exifCzytany', (w) => w.exifCzytany === true],
  ['data z EXIF-u', (w) => w.kiedy === '2022-08-14T15:30:12'],
  ['ISO', (w) => w.iso === 400],
  ['GPS', (w) => w.lat !== null && w.lon !== null],
  ['dane lotu', (w) => Boolean(w.dron && w.dron.wysokoscWzgl === 42)],
];

function sprawdzSkarby(w, gdzie) {
  if (!w) { fail.push(`${gdzie}: wpis zniknął całkowicie`); return; }
  const stracone = SKARBY.filter(([, ma]) => !ma(w)).map(([co]) => co);
  console.log(`   ${gdzie}: ${stracone.length ? `STRACONE → ${stracone.join(', ')}` : 'wszystko na miejscu'}`);
  for (const co of stracone) fail.push(`${gdzie}: stracono „${co}"`);
}

const katalogi = [];
function nowyKatalog(nazwa) {
  const k = fs.mkdtempSync(path.join(os.tmpdir(), `arch-${nazwa}-`));
  katalogi.push(k);
  return k;
}

(async () => {
  /* --- 1. PONOWNE LISTOWANIE ŹRÓDŁA ------------------------------------
     Najgroźniejsza ścieżka i ta, która realnie kasowała pracę. Listowanie
     zna nazwę, ścieżkę i to, co chmura sama wyczytała z JPEG-a — nie zna
     niczego, co policzyliśmy później. */
  console.log('1. ponowne listowanie źródła (indeksuj OneDrive drugi raz)');
  {
    const a = utworz(nowyKatalog('listowanie'));
    a.dodaj([bogatyWpis()]);
    a.dodaj([{
      id: 'onedrive:x1', zrodlo: 'onedrive', typ: 'zdjecie',
      nazwa: '3B9A4703.CR3', sciezka: '/Zdjęcia/Góry 2022/3B9A4703.CR3',
      kiedy: '2026-08-08T20:19:00', dataZrodlo: 'plik',
      aparat: null, iso: null, przyslona: null, ogniskowa: null, obiektyw: null,
    }]);
    sprawdzSkarby(a.szukaj({})[0], 'po ponownym listowaniu');
  }

  /* --- 2. PRZEBIEG PO EXIF ---------------------------------------------- */
  console.log('2. przebieg po EXIF (dociągnij dane z plików)');
  {
    const a = utworz(nowyKatalog('exif'));
    a.dodaj([bogatyWpis()]);
    const w = a.szukaj({})[0];
    a.dodaj([{ ...w, exifCzytany: true, obiektyw: 'RF24-105mm F4 L IS USM' }]);
    sprawdzSkarby(a.szukaj({})[0], 'po przebiegu EXIF');
  }

  /* --- 3. PRZEBIEG PO OBRAZIE ------------------------------------------- */
  console.log('3. przebieg po obrazie (rozpoznawanie treści)');
  {
    const a = utworz(nowyKatalog('yolo'));
    a.dodaj([bogatyWpis()]);
    const w = a.szukaj({})[0];
    a.dodaj([{ ...w, obejrzane: true, obiekty: ['person', 'backpack'] }]);
    sprawdzSkarby(a.szukaj({})[0], 'po rozpoznaniu treści');
  }

  /* --- 4. RESTART SERWERA ----------------------------------------------- */
  console.log('4. zapis na dysk i wczytanie z powrotem (restart serwera)');
  {
    const kat = nowyKatalog('restart');
    const a = utworz(kat);
    a.dodaj([bogatyWpis()]);
    await a.zapisz();
    const b = utworz(kat);
    sprawdzSkarby(b.szukaj({})[0], 'po restarcie');
  }

  /* --- 5. INDEKS ZE STARSZEJ WERSJI -------------------------------------
     Wpisy wczytują się z dysku SUROWE — bez normalizacji. Wpis zapisany
     przez starszą wersję nie ma pól, które doszły później, a scalanie
     zakłada, że są. Zmierzone: pierwsze `dodaj` dla takiego wpisu rzucało
     `Cannot read properties of undefined (reading 'length')` i przerywało
     CAŁE indeksowanie — nie jeden plik, tylko całą paczkę.
     To nie jest hipoteza: tak zachowywał się kod, zanim ten punkt powstał. */
  console.log('5. indeks zapisany przez starszą wersję');
  {
    const kat = nowyKatalog('stary');
    fs.writeFileSync(path.join(kat, 'archiwum.json'), JSON.stringify([{
      id: 'onedrive:x1', zrodlo: 'onedrive', nazwa: '3B9A4703.CR3',
      sciezka: '/Zdjęcia/Góry 2022/3B9A4703.CR3', typ: 'zdjecie',
      kiedy: '2022-08-14T15:30:12', aparat: 'Canon EOS R6m2', exifCzytany: true,
      // Ani `obiekty`, ani `obejrzane`, ani `dataZrodlo` — tak wyglądał wpis wcześniej.
    }]));
    const a = utworz(kat);
    let wywrotka = '';
    try {
      a.dodaj([{
        id: 'onedrive:x1', zrodlo: 'onedrive', typ: 'zdjecie', nazwa: '3B9A4703.CR3',
        sciezka: '/Zdjęcia/Góry 2022/3B9A4703.CR3',
        kiedy: '2026-08-08T20:19:00', dataZrodlo: 'plik',
      }]);
    } catch (err) { wywrotka = err.message; }
    console.log(`   dodaj na starym wpisie: ${wywrotka ? `WYWROTKA — ${wywrotka}` : 'przeszło'}`);
    if (wywrotka) {
      fail.push(`ponowne indeksowanie wywraca się na wpisie ze starszej wersji (${wywrotka}) `
        + '— pada cała paczka, nie jeden plik');
    } else {
      const po = a.szukaj({})[0];
      if (po.kiedy !== '2022-08-14T15:30:12') {
        fail.push(`stary wpis stracił datę z EXIF-u (${po.kiedy}) — `
          + '`exifCzytany` miało go obronić');
      }
    }
  }

  /* --- 6. USUWANIE ŹRÓDŁA JEST CELOWE, ALE MA BYĆ JEDYNE ----------------
     `usunZrodlo` to jedyna operacja, która MA usuwać — i dobrze, że jest.
     Sprawdzamy dwie rzeczy: że usuwa dokładnie to, o co poproszono,
     i że nie rusza niczego innego. */
  console.log('6. celowe usunięcie źródła');
  {
    const a = utworz(nowyKatalog('usuwanie'));
    a.dodaj([bogatyWpis(), {
      id: 'dysk:y1', zrodlo: 'dysk', typ: 'zdjecie', nazwa: 'z.jpg',
      sciezka: '/dysk/z.jpg', kiedy: '2026-01-01T10:00:00',
    }]);
    const usuniete = a.usunZrodlo('onedrive');
    const zostalo = a.szukaj({});
    console.log(`   usunięto ${usuniete}, zostało ${zostalo.length} (${zostalo.map((w) => w.zrodlo)})`);
    if (usuniete !== 1) fail.push(`usunZrodlo('onedrive') usunęło ${usuniete} zamiast 1`);
    if (zostalo.length !== 1 || zostalo[0].zrodlo !== 'dysk') {
      fail.push('usunięcie jednego źródła ruszyło drugie');
    }
  }

  /* --- 7. ODŁĄCZENIE ŹRÓDŁA TO NIE TO SAMO CO USUNIĘCIE MATERIAŁU -------
     Znalezione przy tym audycie. Odłączenie OneDrive kasowało CAŁY indeks —
     czyli u Marcina 55 tysięcy plików razem z rozpoznanymi treściami
     i dociągniętym EXIF-em. Wystarczyło odłączyć i podłączyć konto, żeby
     stracić godziny pracy karty graficznej.

     A przecież indeks jest pasywny i ma działać BEZ połączenia — to jest
     wprost zapisane w nagłówku `lib/archiwum.js`: „zapytania działają nawet
     wtedy, gdy te źródła są offline. Dlatego »ile klipów 50 mm w tym roku«
     odpowie z telefonu w terenie przy wyłączonym komputerze domowym".
     Kasowanie przy odłączeniu przeczyło własnej zasadzie modułu.

     Bez połączenia nie działają MINIATURY, bo adresy trzeba dociągać na
     bieżąco. Same metadane nie mają z tym nic wspólnego. */
  console.log('7. odłączenie źródła nie kasuje materiału');
  {
    const serwer = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
    const i = serwer.indexOf("/api/onedrive/disconnect");
    const blok = i >= 0 ? serwer.slice(i, i + 700) : '';
    const kasuje = /usunZrodlo\(/.test(blok);
    console.log(`   trasa odłączenia kasuje indeks: ${kasuje}`);
    if (kasuje) {
      fail.push('odłączenie OneDrive kasuje cały zaindeksowany materiał razem '
        + 'z rozpoznanymi treściami — a indeks ma z założenia działać offline');
    }
  }

  for (const k of katalogi) fs.rmSync(k, { recursive: true, force: true });
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nARCHIWUM NIC NIE GUBI OK');
  process.exit(fail.length ? 1 : 0);
})();

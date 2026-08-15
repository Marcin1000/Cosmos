/* Archiwum: folder, EXIF z RAW-a i próbka, która nie kłamie.

   Ten zestaw powstał po pierwszym prawdziwym użyciu archiwum na 59 421
   plikach Marcina. „Pokaż zdjęcia z folderu Mazury 2026" nie działało, a Cosmos
   odpowiadał, że w archiwum nie ma zdjęć z aparatu. Jedno i drugie brzmiało
   wiarygodnie i jedno i drugie było nieprawdą.

   Trzy przyczyny, każda sprawdzana tu osobno:

     1. FOLDER. Ścieżkę zapisywaliśmy od początku, ale filtry tekstowe jej
        nie obejmowały. Dane leżały w indeksie i były nieosiągalne.

     2. RAW. Microsoft Graph czyta metadane z JPEG-ów, ale CR2/CR3 nie rusza —
        `photo` przychodzi puste. Dociąganie EXIF-u zapisywało z przeczytanego
        pliku WYŁĄCZNIE obiektyw, więc zdjęcia z R6 II zostawały bez aparatu,
        bez ISO i z datą WGRANIA zamiast daty zrobienia. W wynikach wyglądały
        identycznie jak zrzuty ekranu.

     3. PRÓBKA. Do modelu szło `JSON.stringify(...).slice(0, 12000)`, a jeden
        adres miniatury z OneDrive to 1248 znaków. Mieściło się SZEŚĆ plików,
        z czego 71% treści to podpisane tokeny — i nigdzie nie było napisane,
        że to sześć z pięćdziesięciu dziewięciu tysięcy. Model dostawał
        polecenie „nie zgaduj, odpowiadaj z tych danych" i uczciwie orzekał,
        że aparatu w archiwum nie ma.

   Punkt 3 jest najważniejszy i najłatwiejszy do przeoczenia: nie było to
   zmyślanie modelu, tylko poprawny wniosek z próbki, którą sami podsunęliśmy.
*/
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { utworz } = require('../../lib/archiwum.js');

/* Odtworzenie kawałka OneDrive Marcina: katalogi z wyjazdów, zrzuty ekranu
   i pary CR3+JPG z Canona (widoczne na zrzucie jako „3B9A4703" dwa razy). */
function przykladoweArchiwum(a) {
  const wpisy = [];
  // Zrzuty ekranu i zdjęcia z telefonu — najnowsze, więc na górze listy.
  for (let i = 0; i < 30; i++) {
    wpisy.push({
      id: `onedrive:s${i}`, zrodlo: 'onedrive', typ: 'zdjecie',
      nazwa: `Screenshot_20260809_1545${String(i).padStart(2, '0')}.jpg`,
      sciezka: `/Obrazy/Z aparatu/Screenshot_20260809_1545${String(i).padStart(2, '0')}.jpg`,
      kiedy: `2026-08-09T15:45:${String(i).padStart(2, '0')}`,
      aparat: i % 2 ? 'samsung Galaxy S25' : null,
      miniatura: `https://ukwest1-mediap.svc.ms/transform/thumbnail?${'t'.repeat(1200)}`,
    });
  }
  // Canon z folderu Mazury 2026 — data WGRANIA, bez aparatu (tak daje Graph dla RAW).
  for (let i = 0; i < 12; i++) {
    wpisy.push({
      id: `onedrive:c${i}`, zrodlo: 'onedrive', typ: 'zdjecie',
      nazwa: `3B9A47${String(i).padStart(2, '0')}.CR3`,
      sciezka: `/Zdjęcia/Mazury 2026/3B9A47${String(i).padStart(2, '0')}.CR3`,
      kiedy: '2026-08-08T20:19:00',
      aparat: null, iso: null, przyslona: null, ogniskowa: null,
      miniatura: `https://ukwest1-mediap.svc.ms/transform/thumbnail?${'t'.repeat(1200)}`,
    });
  }
  // Starszy wyjazd, inny wariant nazwy katalogu.
  for (let i = 0; i < 8; i++) {
    wpisy.push({
      id: `onedrive:d${i}`, zrodlo: 'onedrive', typ: 'zdjecie',
      nazwa: `DJI_00${i}.JPG`,
      sciezka: `/Zdjęcia Mazury 2024 Dron/DJI_00${i}.JPG`,
      kiedy: '2024-07-01T10:00:00',
    });
  }
  a.dodaj(wpisy);
}

/* Ta sama funkcja, którą przeglądarka buduje kontekst dla modelu.

   Kiedyś stało tu wycinanie tekstu z `public/app.js` między `const
   ARCH_LIMIT_ZNAKOW` a `const IMAGE_MARKER_RE` i wykonywanie go przez
   `new Function`. Działało dokładnie do chwili, w której któraś z tych dwóch
   nazw się przesunęła — a przy okazji sprawdzało nie tę funkcję, którą
   uruchamia przeglądarka, tylko jej odtworzoną kopię. Po wydzieleniu
   `public/protokol.js` wystarczy ją zwyczajnie wczytać. */
function zaladujNaKontekst() {
  const { utworzProtokol } = require(path.join(__dirname, '..', '..', 'public', 'protokol.js'));
  return utworzProtokol().naKontekst;
}

(async () => {
  const fail = [];
  const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-folder-'));
  const a = utworz(katalog);
  przykladoweArchiwum(a);
  console.log(`0. archiwum próbne: ${a.ile()} plików`);

  /* ---- 1. FOLDER ---- */
  const mazury2026 = a.szukaj({ folder: 'Mazury 2026' });
  console.log(`1. folder=„Mazury 2026" → ${mazury2026.length} plików`);
  if (mazury2026.length !== 12) fail.push(`folder „Mazury 2026" dał ${mazury2026.length} zamiast 12`);
  if (mazury2026.some((w) => !/Mazury 2026/.test(w.sciezka))) {
    fail.push('do wyniku wpadł plik spoza folderu');
  }

  /* Bez wielkości liter i bez ogonków — człowiek nie pisze ścieżek dokładnie.
     „zdjecia mazury" ma trafić w „/Zdjęcia Mazury 2024 Dron/". */
  /* Fragment ze slashem też działa i tak ma być: „/Zdjęcia/Mazury 2026/"
     po odarciu z ogonków zawiera „zdjecia/mazury". Pierwsza wersja tego
     sprawdzenia zakładała tu zero — i to test był w błędzie, nie kod. */
  for (const [pytanie, ile] of [['mazury', 20], ['MAZURY 2024', 8],
    ['zdjecia mazury', 8], ['zdjęcia/mazury', 12], ['Z aparatu', 30]]) {
    const w = a.szukaj({ folder: pytanie }).length;
    console.log(`   folder=„${pytanie}" → ${w}`);
    if (w !== ile) fail.push(`folder „${pytanie}" dał ${w} zamiast ${ile}`);
  }

  // Folder składa się z innymi filtrami — to jest cały sens.
  const rok2024 = a.szukaj({ folder: 'mazury', rok: 2024 }).length;
  console.log(`2. folder=mazury + rok=2024 → ${rok2024}`);
  if (rok2024 !== 8) fail.push(`folder+rok dał ${rok2024} zamiast 8`);

  /* ---- 3. PRÓBKA DLA MODELU ---- */
  const naKontekst = zaladujNaKontekst();
  const wyniki = a.szukaj({});
  const kontekst = naKontekst({ znaleziono: wyniki.length, wyniki: wyniki.slice(0, 40) });
  const widocznych = (kontekst.match(/"nazwa":/g) || []).length;
  console.log(`3. kontekst dla modelu: ${kontekst.length} znaków, ${widocznych} wpisów widocznych`);

  // Miniatury to 1,2 kB podpisanego adresu na plik — nie mają prawa tam być.
  if (/ukwest1-mediap|tempauth/.test(kontekst)) {
    fail.push('adresy miniatur poszły do modelu — zjadają cały budżet');
  }
  /* Przed poprawką mieściło się SZEŚĆ wpisów. Poniżej piętnastu znaczy, że
     coś znów zjada kontekst. */
  if (widocznych < 15) fail.push(`do modelu trafiło tylko ${widocznych} wpisów (przed poprawką było 6)`);
  if (kontekst.length > 12600) fail.push(`kontekst urósł do ${kontekst.length} znaków`);

  /* Najważniejsze: model MUSI wiedzieć, że to próbka. Bez tego zdania
     wyciąga z trzydziestu najnowszych zrzutów ekranu wniosek o całym
     archiwum — i robi to zgodnie z instrukcją „nie zgaduj". */
  console.log(`   nagłówek o próbce: ${/widzisz \d+ z \d+/.test(kontekst)}`);
  if (!/widzisz \d+ z \d+/.test(kontekst)) {
    fail.push('brak informacji, że to próbka — model uogólni z kilkudziesięciu najnowszych plików');
  }
  if (!/PRÓBKA/.test(kontekst)) fail.push('brak ostrzeżenia przed wnioskowaniem o tym, czego NIE MA');

  // JSON nie może być ucięty w połowie — model dostawał składniowo zepsuty dokument.
  const jsonOd = kontekst.indexOf('{');
  let poprawny = true;
  try { JSON.parse(kontekst.slice(jsonOd)); } catch { poprawny = false; }
  console.log(`   JSON w kontekście parsuje się: ${poprawny}`);
  if (!poprawny) fail.push('JSON dla modelu jest ucięty w połowie');

  /* ---- 4. RAW: dociągnięty EXIF ma wypełnić datę i aparat, nie sam obiektyw ---- */
  const przed = a.szukaj({ folder: 'Mazury 2026' })[0];
  console.log(`4. przed dociągnięciem: aparat=${przed.aparat}, kiedy=${przed.kiedy}, iso=${przed.iso}`);
  // Symulujemy to, co robi trasa /api/archive/lenses po przeczytaniu pliku.
  const zPliku = {
    aparat: 'Canon EOS R6m2', obiektyw: 'RF24-105mm F4 L IS USM',
    ogniskowa: 35, przyslona: 4, czasS: 0.008, iso: 400,
    kiedy: '2026-06-14T19:12:33', lat: 53.6779, lon: 21.7783,
  };
  const scal = { ...przed, exifCzytany: true };
  for (const pole of Object.keys(zPliku)) scal[pole] = zPliku[pole];
  a.dodaj([scal]);
  const po = a.szukaj({ folder: 'Mazury 2026' }).find((w) => w.id === przed.id);
  console.log(`   po dociągnięciu: aparat=${po.aparat}, kiedy=${po.kiedy}, iso=${po.iso}, GPS=${po.lat !== null}`);
  for (const [pole, oczekiwane] of [['aparat', 'Canon EOS R6m2'], ['kiedy', '2026-06-14T19:12:33'],
    ['iso', 400], ['ogniskowa', 35]]) {
    if (po[pole] !== oczekiwane) fail.push(`po dociągnięciu EXIF-u ${pole}=${po[pole]}, oczekiwano ${oczekiwane}`);
  }
  if (!po.exifCzytany) fail.push('brak znacznika `exifCzytany` — plik wróci do kolejki w nieskończoność');
  // Data z pliku ma przestawić wpis do właściwego miesiąca.
  if (!a.szukaj({ folder: 'Mazury 2026', miesiac: '06' }).length) {
    fail.push('data z EXIF-u nie trafiła do indeksu — zdjęcie zostało pod datą wgrania');
  }
  // I dać się znaleźć po aparacie, o co Marcin pytał wprost.
  if (!a.szukaj({ aparat: 'R6' }).length) fail.push('zdjęcie z Canona nie znajduje się po `aparat=R6`');

  /* ---- 5. Znacznik `exifCzytany` przeżywa zapis i odczyt ----
     Zapis jest opóźniony o sekundę (`zapiszWkrotce`), więc wymuszamy go
     wprost — inaczej sprawdzalibyśmy wyścig z debounce'em, a nie trwałość.
     `zapisz()` jest ASYNCHRONICZNY (blokujący zatrzymywał serwer na 5 s przy
     dużym indeksie), więc trzeba na niego poczekać. */
  await a.zapisz();
  const b = utworz(katalog);
  const poWczytaniu = b.szukaj({ folder: 'Mazury 2026' }).find((w) => w.id === przed.id);
  console.log(`5. po ponownym wczytaniu z dysku: exifCzytany=${poWczytaniu && poWczytaniu.exifCzytany}`);
  if (!poWczytaniu || !poWczytaniu.exifCzytany) {
    fail.push('`exifCzytany` nie przeżywa zapisu — kolejka zacznie się od nowa po restarcie');
  }

  /* --- 6. WYKLUCZENIE FOLDERU -------------------------------------------
     Marcin: „Zdjęcia najnowsze z wyłączeniem folderu Mazury 2026 i tak
     pokazuje zdjęcia z tego folderu." Filtrów było dwadzieścia i ani jednego
     ODEJMUJĄCEGO — model układał zapytanie bez wykluczenia i pisał
     w odpowiedzi, że folder pominął. Bywało to prawdą przez przypadek,
     gdy najnowsze pliki i tak leżały gdzie indziej. */
  const wszystkie = b.szukaj({});
  const bezMazur = b.szukaj({ bezFolderu: 'Mazury 2026' });
  const zostalyMazury = bezMazur.filter((w) => /Mazury 2026/i.test(w.sciezka || '')).length;
  console.log(`6. wykluczenie folderu: ${wszystkie.length} → ${bezMazur.length}, `
    + `zostało z Mazur: ${zostalyMazury}`);
  if (zostalyMazury) {
    fail.push(`po wykluczeniu „Mazury 2026" zostało ${zostalyMazury} plików z tego folderu`);
  }
  if (bezMazur.length >= wszystkie.length) {
    fail.push('wykluczenie folderu niczego nie odjęło — filtr jest ignorowany');
  }
  // Wykluczenie NIE MOŻE zjeść wszystkiego: reszta archiwum ma zostać.
  if (!bezMazur.length) fail.push('wykluczenie folderu usunęło całe archiwum');
  // Kilka nazw naraz — „oprócz Mazur i zrzutów ekranu" to jedno pytanie.
  const bezDwoch = b.szukaj({ bezFolderu: 'Mazury 2026, Z aparatu' });
  console.log(`   dwa wykluczenia naraz: ${bezDwoch.length} plików`);
  if (bezDwoch.length >= bezMazur.length) fail.push('drugie wykluczenie po przecinku nie działa');

  /* --- 7. APARAT DOPASOWANY PO SŁOWACH -----------------------------------
     Marcin, patrząc na OneDrive: „mój canon to tak naprawdę u niego
     EOS R6 Mark II". EXIF zapisuje „Canon EOS R6m2", OneDrive pokazuje
     „EOS R6 Mark II" — a dopasowanie całą frazą znaczyło, że naturalne
     „aparat=Canon R6" nie trafia w NIC, bo taki ciąg nie występuje nigdzie. */
  const kat7 = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-aparat-'));
  const a7 = utworz(kat7);
  a7.dodaj([
    { id: 'x1', zrodlo: 'dysk', typ: 'zdjecie', nazwa: 'a.CR3', sciezka: '/a.CR3',
      kiedy: '2026-06-01T10:00:00', aparat: 'Canon EOS R6m2' },
    { id: 'x2', zrodlo: 'dysk', typ: 'zdjecie', nazwa: 'b.JPG', sciezka: '/b.JPG',
      kiedy: '2026-06-01T10:00:01', aparat: 'Canon EOS R6 Mark II' },
    { id: 'x3', zrodlo: 'dysk', typ: 'zdjecie', nazwa: 'c.JPG', sciezka: '/c.JPG',
      kiedy: '2026-06-01T10:00:02', aparat: 'Canon EOS R5' },
    { id: 'x4', zrodlo: 'dysk', typ: 'zdjecie', nazwa: 'd.JPG', sciezka: '/d.JPG',
      kiedy: '2026-06-01T10:00:03', aparat: 'Samsung SM-A515F' },
  ]);
  for (const [pyt, ile] of [['Canon R6', 2], ['R6', 2], ['canon eos r6', 2], ['R5', 1], ['Canon', 3]]) {
    const zn = a7.szukaj({ aparat: pyt }).length;
    console.log(`7. aparat=„${pyt}" → ${zn} (spodziewane ${ile})`);
    if (zn !== ile) fail.push(`aparat=„${pyt}" znalazł ${zn} zamiast ${ile}`);
  }
  fs.rmSync(kat7, { recursive: true, force: true });

  fs.rmSync(katalog, { recursive: true, force: true });
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nARCHIWUM PO FOLDERACH OK');
  process.exit(fail.length ? 1 : 0);
})();

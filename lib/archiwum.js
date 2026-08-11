/* ============================================================
   Archiwum materiału — indeks zdjęć i klipów

   Wyróżnik, którego chmurowy asystent nie zrobi: ChatGPT nie ma Twoich
   plików i nigdy nie będzie miał, bo nikt nie wrzuci dwóch terabajtów do
   okna czatu. Cosmos stoi na Twoim serwerze, więc dla niego to naturalne.

   Indeks jest PASYWNY: sam niczego nie skanuje. Źródła (OneDrive przez
   Microsoft Graph, dysk lokalny przez zmysły) wpychają do niego wpisy.
   Dzięki temu dołożenie trzeciego źródła nie wymaga ruszania zapytań,
   a zapytania działają, gdy źródła są offline — indeks mieszka na VPS-ie,
   więc „ile klipów 50 mm w tym roku" odpowie z telefonu w terenie
   przy wyłączonym komputerze domowym.

   Najciekawsze filtrowanie to PORA ŚWIATŁA. Mając czas i GPS zdjęcia,
   liczymy, jak wysoko stało wtedy Słońce — i „pokaż ujęcia z zachodu"
   przestaje być zgadywaniem po godzinie w nazwie pliku.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const { kategoriePliku } = require('./tematy.js');
const { fazaSwiatla, poraDnia, pozycjaSlonca } = require('./slonce.js');

const POLA_LICZBOWE = ['ogniskowa', 'przyslona', 'iso', 'rozmiar', 'czasS'];

const STREFA = process.env.COSMOS_TZ || 'Europe/Warsaw';

/** Czas ścienny bez strefy (tak zapisuje go aparat) → moment bezwzględny.
 *
 *  Pierwsza wersja odtwarzała strefę z DŁUGOŚCI GEOGRAFICZNEJ — przy 20,9°E
 *  wychodziło UTC+1,39. Tymczasem w Polsce latem obowiązuje UTC+2, więc błąd
 *  sięgał 37 minut i zdjęcie ze złotej godziny lądowało po zachodzie Słońca.
 *  Czas urzędowy nie wynika z południka.
 *
 *  Bierzemy więc strefę z konfiguracji (COSMOS_TZ) — zegar aparatu jest
 *  ustawiony na czas domowy. `toLocaleString` sam uwzględnia zmianę czasu,
 *  więc zdjęcia z lipca i ze stycznia liczą się poprawnie bez tablicy DST.
 */
function lokalnyNaUtc(naiwneISO) {
  const jakUtc = new Date(`${naiwneISO}Z`);
  if (Number.isNaN(jakUtc.getTime())) return null;
  try {
    // „sv-SE" daje format zbliżony do ISO, bez kombinowania z parsowaniem.
    const wStrefie = new Date(`${jakUtc.toLocaleString('sv-SE', { timeZone: STREFA }).replace(' ', 'T')}Z`);
    if (Number.isNaN(wStrefie.getTime())) return jakUtc;
    return new Date(jakUtc.getTime() + (jakUtc.getTime() - wStrefie.getTime()));
  } catch {
    return jakUtc;                     // nieznana strefa — lepiej UTC niż nic
  }
}

function utworz(katalogDanych) {
  const PLIK = path.join(katalogDanych, 'archiwum.json');
  /* Zapasowe współrzędne — dom użytkownika. Większość zdjęć nie ma GPS-u
     (aparaty bez modułu, wyłączona lokalizacja w telefonie, OneDrive
     czyszczący metadane), a bez współrzędnych pora światła jest `null`
     i cały filtr „pokaż ujęcia z zachodu" nie ma czego zwrócić. Lepiej
     policzyć ją dla domu i OZNACZYĆ jako przybliżoną, niż nie policzyć
     wcale i udawać, że w archiwum nie ma zdjęć o zachodzie. */
  let domyslneWspolrzedne = null;
  let wpisy = [];
  let poId = new Map();
  /* Indeks kadrów: klucz „nazwa pliku + sekunda zdjęcia" → identyfikatory.
     Deklaracja MUSI stać tutaj, nad `przebuduj()`, bo `przebuduj()` woła się
     przy wczytaniu pliku — a `let` niżej oznaczałby martwą strefę i wywrotkę
     modułu przy starcie. Ta pułapka zjadła już raz serwer Marcina. */
  let rodzenstwoIndeks = null;

  try {
    const surowe = JSON.parse(fs.readFileSync(PLIK, 'utf8'));
    if (Array.isArray(surowe)) wpisy = surowe;
  } catch { /* brak indeksu — pierwszy raz */ }
  przebuduj();

  function przebuduj() {
    poId = new Map(wpisy.map((w) => [w.id, w]));
    rodzenstwoIndeks = null;      // policzy się przy pierwszym pytaniu
  }

  let zapisZaplanowany = null;
  let zapisTrwa = false;
  let zapisZaległy = false;
  /* Zapis zbiorczy. Indeksowanie wrzuca wpisy paczkami po kilkaset; zapis
     przy każdej z nich to przy 200 tys. plików kilkaset przepisań całego
     pliku. */
  const ZAPIS_MS = Number(process.env.COSMOS_ARCHIWUM_ZAPIS_MS) || 3000;
  /* ODSTĘP DOBIERA SIĘ DO KOSZTU ZAPISU, nie jest stały.
   *
   *  Zapis jest asynchroniczny, ale `JSON.stringify` już nie — i to on jest
   *  blokadą. Zmierzone na archiwum wielkości Marcinowego (57 728 wpisów,
   *  28 MB): stringify 497 ms, cały zapis blokuje pętlę zdarzeń na ~650 ms.
   *  Przy stałych trzech sekundach oznaczało to, że co trzecią sekundę serwer
   *  zamiera na dwie trzecie sekundy — DWADZIEŚCIA DWA PROCENT czasu z całą
   *  obsługą wstrzymaną. Podczas rozpoznawania treści dwanaście pobrań stoi
   *  wtedy w miejscu, a stopery i tak tykają, więc pomiar `pobranie` sam się
   *  zawyża. Rachunek się nie spinał: 12 robotników po 6,1 s na żądanie
   *  powinno dawać 1,95 żądania na sekundę, dawało 1,07.
   *
   *  Odstęp trzymamy więc na dwudziestokrotności ostatniego zapisu, czyli
   *  najwyżej 5% czasu na zapisywanie. Małe archiwum (20 ms) zapisuje się
   *  jak dotąd, po sekundzie z hakiem; Marcinowe co kilkanaście sekund.
   *  Górna granica to minuta — tyle najwyżej pracy przepada przy nagłym
   *  restarcie, a przy rozpoznawaniu treści „przepada" znaczy tylko, że
   *  kilkadziesiąt plików pójdzie w kolejce jeszcze raz. */
  const ZAPIS_MAX_MS = Number(process.env.COSMOS_ARCHIWUM_ZAPIS_MAX_MS) || 60000;
  let ostatniZapisMs = 0;
  function odstepZapisu() {
    return Math.min(ZAPIS_MAX_MS, Math.max(ZAPIS_MS, ostatniZapisMs * 20));
  }
  function zapiszWkrotce() {
    if (zapisZaplanowany) return;
    zapisZaplanowany = setTimeout(() => { zapisZaplanowany = null; zapisz(); }, odstepZapisu());
    if (zapisZaplanowany.unref) zapisZaplanowany.unref();
  }

  /** Zapis indeksu na dysk. ASYNCHRONICZNY — i to nie jest kosmetyka.
   *
   *  `writeFileSync` na 98-megabajtowym indeksie trwał zmierzone 5,2 s
   *  i przez ten czas serwer NIE ROBIŁ NIC INNEGO: pętla zdarzeń stoi, więc
   *  żadne żądanie się nie obsługuje. Przy dociąganiu EXIF-u zapis wracał co
   *  sekundę, czyli serwer stał dłużej, niż pracował. Marcin zobaczył to jako
   *  „strasznie wolno to idzie".
   *
   *  Nakładające się zapisy składamy w jeden: gdy w trakcie pisania przyjdzie
   *  kolejna zmiana, po zakończeniu robimy jeszcze jeden przebieg.
   */
  async function zapisz() {
    if (zapisTrwa) { zapisZaległy = true; return; }
    zapisTrwa = true;
    const start = Date.now();
    try {
      await fs.promises.mkdir(katalogDanych, { recursive: true });
      // Przez plik tymczasowy: przerwany zapis nie może zostawić indeksu
      // w połowie, bo wtedy tracisz cały katalog przy jednym restarcie.
      const tmp = `${PLIK}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(wpisy));
      await fs.promises.rename(tmp, PLIK);
      ostatniZapisMs = Date.now() - start;
    } catch (err) {
      console.error('Nie udało się zapisać archiwum:', err.message);
    } finally {
      zapisTrwa = false;
      if (zapisZaległy) { zapisZaległy = false; zapiszWkrotce(); }
    }
  }

  /* Sprzątanie po starszych wersjach — DOPIERO TU, po definicjach.
   *
   *  Adresy miniatur trzymaliśmy w indeksie, choć NIKT ich nie czyta:
   *  przeglądarka bierze podgląd z `/api/archive/thumb`, bo podpisane adresy
   *  Microsoftu i tak wygasają po godzinie. Zmierzone na archiwum wielkości
   *  Marcinowego: 80,7 MB indeksu, z czego 70,3 MB to same te adresy.
   *
   *  Ten blok stał wcześniej WYŻEJ, nad definicjami — i to wywracało serwer
   *  przy starcie: `zapiszWkrotce()` sięgało po `zapisZaplanowany` i `ZAPIS_MS`
   *  z martwej strefy `let`/`const`, więc moduł rzucał ReferenceError.
   *  Nie widać było tego w żadnym teście, bo warunek zapala się wyłącznie na
   *  indeksie ZAPISANYM przez starszą wersję. Testy budowały archiwum od zera,
   *  gdzie `miniatura` już nie powstaje — czyli sprawdzały wszystko poza samą
   *  ścieżką przejścia. Stąd zestaw `tempo-archiwum` punkt 4. */
  let wyczyszczone = 0;
  for (const w of wpisy) {
    if (w && w.miniatura) { delete w.miniatura; wyczyszczone++; }
  }
  if (wyczyszczone) zapiszWkrotce();

  /** Dołóż paczkę wpisów. Ten sam `id` nadpisuje — powtórne indeksowanie
   *  tego samego katalogu ma odświeżać, nie mnożyć. */
  function dodaj(nowe) {
    let dodanych = 0;
    let odswiezonych = 0;
    for (const w of nowe || []) {
      if (!w || !w.id) continue;
      const wpis = znormalizuj(w);
      if (poId.has(wpis.id)) {
        const stary = poId.get(wpis.id);
        const i = wpisy.indexOf(stary);
        przepniKadr(stary, wpis);
        wpisy[i] = wpis;
        odswiezonych++;
      } else {
        przepniKadr(null, wpis);
        wpisy.push(wpis);
        dodanych++;
      }
      poId.set(wpis.id, wpis);
    }
    if (dodanych || odswiezonych) zapiszWkrotce();
    return { dodanych, odswiezonych, razem: wpisy.length };
  }

  /* RODZEŃSTWO PLIKU — `3B9A4860.CR3` i `3B9A4860.JPG` to jeden kadr.
   *
   *  Ma to znaczenie przy miniaturach: dla RAW-a Microsoft Graph musi
   *  wygenerować podgląd u siebie i zmierzone trwa to 6,8-9 s, dla JPG oddaje
   *  gotowy plik w pół sekundy. Znając rodzeństwo, pytamy o tańszy — a przy
   *  rozpoznawaniu treści robimy to raz na kadr, nie raz na plik.
   *
   *  KLUCZEM JEST NAZWA PLIKU I SEKUNDA ZDJĘCIA, nie ścieżka. Pierwsza wersja
   *  grupowała po pełnej ścieżce bez rozszerzenia i na archiwum Marcina
   *  znalazła ZERO par, bo tak trzyma pliki tylko czasem. Jego własny opis:
   *  „nie raz robiłem tak, że rozdzielałem jpg i raw w dwóch folderach albo
   *  jpg trafiały do podfolderu z jpg w folderze zawierającym pliki RAW".
   *  Nazwa i sekunda przetrwają każde z tych ułożeń, a przy okazji nie
   *  obchodzi ich, czy RAW to CR3, CR2, NEF czy format Samsunga.
   *
   *  Sekunda jest w tym kluczu po to, żeby nie sklejać różnych zdjęć o tej
   *  samej nazwie: licznik w aparacie się przewija, a `DSC_0001` z dwóch
   *  wyjazdów to dwa różne kadry. Sama sekunda też by nie wystarczyła —
   *  seria zdjęć z Canona ma po kilka klatek w tej samej sekundzie.
   *
   *  Gdy daty brak, wracamy do ścieżki bez rozszerzenia: wtedy grupują się
   *  wyłącznie pliki leżące obok siebie, czyli sytuacja, w której pomyłka
   *  jest najmniej prawdopodobna.
   *
   *  Indeks liczy się przy pierwszym pytaniu i od tej pory jest DOKŁADANY,
   *  nie przebudowywany (`przepniKadr` przy każdym `dodaj`). Przebudowa
   *  całości wygląda niewinnie — kilkadziesiąt milisekund na 59 tysiącach —
   *  ale unieważniałoby ją każde dociągnięcie EXIF-u, bo ono podmienia datę
   *  WGRANIA na datę ZROBIENIA zdjęcia. Panel archiwum otwarty w trakcie
   *  dociągania przeliczałby wtedy cały indeks przy każdym kafelku i to na
   *  pętli zdarzeń, czyli z zatrzymaniem całego serwera.
   *
   *  Trzymamy identyfikatory, nie obiekty: `dodaj()` PODMIENIA obiekt wpisu
   *  przy odświeżeniu, więc referencje zwietrzałyby po pierwszym dociągnięciu
   *  danych z pliku. */
  const bezRozszerzenia = (s) => String(s || '').toLowerCase().replace(/\.[^./]+$/, '');
  function kluczKadru(w) {
    if (!w) return '';
    // Nazwa pliku bez ścieżki i bez rozszerzenia — z `sciezka`, bo `nazwa`
    // bywa pusta przy wpisach z dysku.
    const plik = bezRozszerzenia(String(w.sciezka || w.nazwa || '').split('/').pop());
    // Do sekundy włącznie, wspólny format dla „2026-06-21T10:00:00"
    // i „2026-06-21 10:00:00" — pierwsze przychodzi z Graph, drugie z EXIF-u.
    const chwila = w.kiedy ? String(w.kiedy).replace(' ', 'T').slice(0, 19) : '';
    if (plik && chwila) return `k:${plik}|${chwila}`;
    return `s:${bezRozszerzenia(w.sciezka)}`;
  }
  const doKosza = (k, id) => {
    const ids = rodzenstwoIndeks.get(k);
    if (!ids) return;
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1);
    if (!ids.length) rodzenstwoIndeks.delete(k);
  };
  /** Utrzymanie indeksu kadrów przy `dodaj()`. Nic nie robi, dopóki indeksu
   *  nie ma — czyli dopóki nikt o rodzeństwo nie zapytał. */
  function przepniKadr(stary, nowy) {
    if (!rodzenstwoIndeks) return;
    const kNowy = kluczKadru(nowy);
    if (stary) {
      const kStary = kluczKadru(stary);
      if (kStary === kNowy) return;      // nazwa i sekunda bez zmian
      doKosza(kStary, stary.id);
    }
    if (!kNowy || kNowy === 's:') return;
    if (!rodzenstwoIndeks.has(kNowy)) rodzenstwoIndeks.set(kNowy, []);
    rodzenstwoIndeks.get(kNowy).push(nowy.id);
  }
  function rodzenstwo(id) {
    const w = poId.get(String(id));
    if (!w) return [];
    if (!w.sciezka && !w.nazwa) return [w];
    if (!rodzenstwoIndeks) {
      rodzenstwoIndeks = new Map();
      for (const x of wpisy) {
        const k = kluczKadru(x);
        if (!k || k === 's:') continue;
        if (!rodzenstwoIndeks.has(k)) rodzenstwoIndeks.set(k, []);
        rodzenstwoIndeks.get(k).push(x.id);
      }
    }
    const ids = rodzenstwoIndeks.get(kluczKadru(w));
    if (!ids) return [w];
    return ids.map((i) => poId.get(i)).filter(Boolean);
  }

  function znormalizuj(w) {
    const out = {
      id: String(w.id).slice(0, 400),
      zrodlo: w.zrodlo === 'onedrive' ? 'onedrive' : 'dysk',
      nazwa: String(w.nazwa || '').slice(0, 300),
      sciezka: String(w.sciezka || '').slice(0, 600),
      typ: w.typ === 'wideo' ? 'wideo' : 'zdjecie',
      kiedy: w.kiedy || null,
      aparat: w.aparat || null,
      obiektyw: w.obiektyw || null,
      lat: Number.isFinite(w.lat) ? w.lat : null,
      lon: Number.isFinite(w.lon) ? w.lon : null,
      miejsce: w.miejsce || null,
      obiekty: Array.isArray(w.obiekty) ? w.obiekty.slice(0, 20).map(String) : [],
      /* `miniatura` świadomie NIE trafia do indeksu. Podpisany adres z Graph
         ma ~1,2 kB i wygasa po godzinie, a przeglądarka i tak bierze podgląd
         z `/api/archive/thumb?id=`. Przy 59 tys. plików to było 70 MB pliku
         przepisywanego przy każdym zapisie — za coś, czego nikt nie czyta. */
      /* „Oglądaliśmy już to zdjęcie wzrokiem?" — a NIE „czy coś na nim
         znaleźliśmy". Bez tego rozróżnienia krajobraz, na którym YOLO
         słusznie nie widzi żadnego z 80 obiektów, wracałby do kolejki
         w nieskończoność i paczka mieliłaby w kółko te same pliki. */
      obejrzane: Boolean(w.obejrzane),
      /* „Czytaliśmy już EXIF z tego pliku?" — znów rozróżnienie „sprawdzone"
         od „coś znaleziono". Bez niego plik RAW, w którym nie ma obiektywu,
         wracał do kolejki przy każdym przebiegu i paczka mieliła w kółko te
         same zdjęcia zamiast iść dalej. */
      exifCzytany: Boolean(w.exifCzytany),
      /* TELEMETRIA KLIPU. `srtId` mówi, że obok nagrania leży plik .SRT
         i da się go dociągnąć; `lot` to już odczytane podsumowanie. Ta sama
         para co przy obiektywach: najpierw wiemy, że jest co brać, potem
         bierzemy paczkami. */
      srtId: w.srtId || null,
      /* Dane lotu ze zdjęcia z drona (XMP). Wysokość nad punktem startu
         i kąty gimbala — czego EXIF nie ma w ogóle. */
      dron: w.dron && typeof w.dron === 'object' ? {
        wysokoscWzgl: Number.isFinite(w.dron.wysokoscWzgl) ? w.dron.wysokoscWzgl : null,
        gimbalPochylenie: Number.isFinite(w.dron.gimbalPochylenie) ? w.dron.gimbalPochylenie : null,
        gimbalObrot: Number.isFinite(w.dron.gimbalObrot) ? w.dron.gimbalObrot : null,
      } : null,
      lot: w.lot && typeof w.lot === 'object' ? {
        sekund: Number.isFinite(w.lot.sekund) ? w.lot.sekund : null,
        wysokoscMin: Number.isFinite(w.lot.wysokoscMin) ? w.lot.wysokoscMin : null,
        wysokoscMax: Number.isFinite(w.lot.wysokoscMax) ? w.lot.wysokoscMax : null,
        dystansM: Number.isFinite(w.lot.dystansM) ? w.lot.dystansM : null,
        punktow: Number.isFinite(w.lot.punktow) ? w.lot.punktow : null,
      } : null,
    };
    for (const pole of POLA_LICZBOWE) {
      out[pole] = Number.isFinite(w[pole]) ? w[pole] : null;
    }
    /* Pora światła liczona RAZ, przy dodaniu. Zapytanie „pokaż ujęcia
       z zachodu" ma być filtrem po polu, a nie liczeniem pozycji Słońca
       dla dwustu tysięcy wpisów przy każdym pytaniu. */
    out.swiatlo = poraSwiatla(out);
    /* Pora dnia to CO INNEGO niż faza światła i dlatego jest osobnym polem.
       Złota godzina rano i wieczorem mają identyczną fazę, więc prośby
       „pokaż zdjęcia z rana i z wieczora" nie dało się w ogóle wyrazić. */
    out.poraDnia = poraDniaWpisu(out);
    /* Kategorie tematyczne — ze ścieżki, nazwy i wykrytych obiektów.
       OneDrive nie ma tagów, ale nazwy folderów („Wesele Kasi", „Ptaki
       Biebrza") to gotowa klasyfikacja, tylko zapisana po ludzku. */
    out.tematy = kategoriePliku(out);
    // Bez GPS-u pora światła jest policzona dla domu — musi to być widać,
    // inaczej zdjęcie z Hiszpanii dostanie polską godzinę zachodu bez słowa.
    out.swiatloPrzyblizone = Boolean(out.swiatlo && out.lat === null);
    return out;
  }

  function poraSwiatla(w) {
    if (!w.kiedy) return null;
    const lat = w.lat !== null ? w.lat : (domyslneWspolrzedne && domyslneWspolrzedne.lat);
    const lon = w.lon !== null ? w.lon : (domyslneWspolrzedne && domyslneWspolrzedne.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const utc = lokalnyNaUtc(w.kiedy);
    if (!utc) return null;
    try {
      return fazaSwiatla(pozycjaSlonca(utc, lat, lon).wysokosc);
    } catch { return null; }
  }

  /** Pora dnia wpisu — liczona z kąta godzinnego, tak jak faza światła. */
  function poraDniaWpisu(w) {
    if (!w.kiedy) return null;
    const lat = w.lat !== null ? w.lat : (domyslneWspolrzedne && domyslneWspolrzedne.lat);
    const lon = w.lon !== null ? w.lon : (domyslneWspolrzedne && domyslneWspolrzedne.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const utc = lokalnyNaUtc(w.kiedy);
    if (!utc) return null;
    try {
      const p = pozycjaSlonca(utc, lat, lon);
      return poraDnia(p.wysokosc, p.kat);
    } catch { return null; }
  }

  /** Napis do porównywania: małe litery, bez ogonków, bez podwójnych spacji.
   *  „Zdjęcia Mazury 2024” i „zdjecia mazury 2024” to dla człowieka to samo. */
  function bezOgonkow(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l').replace(/Ł/g, 'L')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Odległość w kilometrach — do „co mam z tego miejsca". */
  function odleglosc(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /** Filtrowanie. Każdy warunek jest opcjonalny; brak warunków = wszystko. */
  function szukaj(f = {}) {
    let out = wpisy;
    const ma = (x) => x !== undefined && x !== null && x !== '';

    if (ma(f.rok)) out = out.filter((w) => w.kiedy && w.kiedy.startsWith(String(f.rok)));
    if (ma(f.miesiac)) {
      const mm = String(f.miesiac).padStart(2, '0');
      out = out.filter((w) => w.kiedy && w.kiedy.slice(5, 7) === mm);
    }
    if (ma(f.od)) out = out.filter((w) => w.kiedy && w.kiedy >= f.od);
    if (ma(f.do)) out = out.filter((w) => w.kiedy && w.kiedy <= f.do);
    if (ma(f.typ)) out = out.filter((w) => w.typ === f.typ);
    if (ma(f.zrodlo)) out = out.filter((w) => w.zrodlo === f.zrodlo);
    if (ma(f.swiatlo)) out = out.filter((w) => w.swiatlo === f.swiatlo);
    /* Pora dnia i temat przyjmują KILKA wartości po przecinku, bo tak brzmią
       prawdziwe pytania: „zdjęcia zrobione rano i wieczorem". Jedna wartość
       na filtr wymuszałaby dwa osobne zapytania i ręczne sklejanie wyników. */
    if (ma(f.poraDnia)) {
      const chciane = String(f.poraDnia).split(',').map((x) => x.trim()).filter(Boolean);
      out = out.filter((w) => chciane.includes(w.poraDnia));
    }
    if (ma(f.temat)) {
      const chciane = String(f.temat).split(',').map((x) => x.trim()).filter(Boolean);
      out = out.filter((w) => (w.tematy || []).some((x) => chciane.includes(x)));
    }

    /* FOLDER. Marcin porządkuje materiał katalogami — „Mazury 2026",
       „Zdjęcia Mazury 2024 Dron", „Wesele Kasi" — i to jest jego prawdziwy
       indeks, ważniejszy niż EXIF. Ścieżkę zapisujemy od początku, ale nie
       dało się po niej szukać: filtry tekstowe obejmowały aparat, obiektyw,
       miejsce i nazwę, a `sciezka` była tuż obok i niedostępna.

       Skutek był gorszy niż brak funkcji. Na „pokaż zdjęcia z folderu
       Mazury 2026" Cosmos odpowiadał, że nazw folderów nie przeszukuje —
       zgodnie z prawdą i zupełnie bezużytecznie, bo dane leżały w indeksie.

       Porównujemy bez znaków diakrytycznych i bez wielkości liter: „zdjecia
       mazury" ma trafić w „/Zdjęcia Mazury 2024 Dron/". */
    if (ma(f.folder)) {
      const igla = bezOgonkow(f.folder);
      out = out.filter((w) => bezOgonkow(w.sciezka).includes(igla));
    }

    // Teksty dopasowujemy fragmentem: „R6" ma znaleźć „Canon EOS R6m2".
    for (const pole of ['aparat', 'obiektyw', 'miejsce', 'nazwa']) {
      if (ma(f[pole])) {
        const igla = String(f[pole]).toLowerCase();
        out = out.filter((w) => (w[pole] || '').toLowerCase().includes(igla));
      }
    }
    if (ma(f.obiekt)) {
      const igla = String(f.obiekt).toLowerCase();
      out = out.filter((w) => w.obiekty.some((o) => o.toLowerCase().includes(igla)));
    }
    for (const [pole, min, max] of [
      ['ogniskowa', f.ogniskowaOd, f.ogniskowaDo],
      ['iso', f.isoOd, f.isoDo],
      ['przyslona', f.przyslonaOd, f.przyslonaDo],
    ]) {
      if (ma(min)) out = out.filter((w) => w[pole] !== null && w[pole] >= Number(min));
      if (ma(max)) out = out.filter((w) => w[pole] !== null && w[pole] <= Number(max));
    }
    if (ma(f.ogniskowa)) out = out.filter((w) => w.ogniskowa === Number(f.ogniskowa));

    /* GODZINA ZEGAROWA. Najzwyklejsze pytanie o własny materiał — „zdjęcia
       z Mazur, które zrobiłem przed czternastą" — nie dało się zadać. Były
       tylko `od`/`do` (konkretne daty z godziną) i `poraDnia`, a to co innego:
       `poraDnia` liczy się z POŁOŻENIA SŁOŃCA, nie z zegara. Zdjęcie z 14:27
       ma `poraDnia: wieczor`, bo Słońce jest już na zachód od południa —
       astronomicznie słusznie, tylko że człowiek pytający „przed 14" ma na
       myśli zegarek.

       Marcin zapytał dokładnie o to i dostał cztery rundy „nie znalazłem",
       bo model nie miał czym tego wyrazić. */
    const godzinaZ = (w) => (w.kiedy ? Number(String(w.kiedy).slice(11, 13)) : null);
    const naGodzine = (x) => {
      const m = String(x).match(/^(\d{1,2})/);
      return m ? Math.min(23, Math.max(0, Number(m[1]))) : null;
    };
    if (ma(f.godzinaOd)) {
      const g = naGodzine(f.godzinaOd);
      if (g !== null) out = out.filter((w) => { const h = godzinaZ(w); return h !== null && h >= g; });
    }
    if (ma(f.godzinaDo)) {
      const g = naGodzine(f.godzinaDo);
      // „do 14" znaczy „przed czternastą", czyli godziny 0-13 włącznie.
      if (g !== null) out = out.filter((w) => { const h = godzinaZ(w); return h !== null && h < g; });
    }

    if (ma(f.lat) && ma(f.lon)) {
      const promien = Number(f.promienKm) || 1;
      out = out.filter((w) => w.lat !== null
        && odleglosc(Number(f.lat), Number(f.lon), w.lat, w.lon) <= promien);
    }

    // Najnowsze pierwsze — przy przeglądaniu materiału to jedyny sensowny domyślny porządek.
    return [...out].sort((a, b) => String(b.kiedy || '').localeCompare(String(a.kiedy || '')));
  }

  /** Zestawienie liczbowe: ile czego, pogrupowane po dowolnym polu. */
  function zestawienie(pole, filtr = {}) {
    const dozwolone = ['aparat', 'obiektyw', 'ogniskowa', 'iso', 'przyslona',
      'typ', 'zrodlo', 'swiatlo', 'poraDnia', 'temat', 'rok', 'miesiac', 'miejsce'];
    if (!dozwolone.includes(pole)) return null;
    const grupy = new Map();
    for (const w of szukaj(filtr)) {
      let klucz;
      if (pole === 'temat') {
        // Plik bywa w kilku kategoriach naraz — liczy się w każdej z nich.
        for (const k of (w.tematy || [])) grupy.set(k, (grupy.get(k) || 0) + 1);
        if (!(w.tematy || []).length) grupy.set('(brak danych)', (grupy.get('(brak danych)') || 0) + 1);
        continue;
      }
      if (pole === 'rok') klucz = w.kiedy ? w.kiedy.slice(0, 4) : null;
      else if (pole === 'miesiac') klucz = w.kiedy ? w.kiedy.slice(0, 7) : null;
      else klucz = w[pole];
      if (klucz === null || klucz === undefined || klucz === '') klucz = '(brak danych)';
      grupy.set(String(klucz), (grupy.get(String(klucz)) || 0) + 1);
    }
    const lista = [...grupy.entries()]
      .map(([wartosc, ile]) => ({ wartosc, ile }))
      .sort((a, b) => b.ile - a.ile);
    /* Pokrycie danych. „6 zdjęć 50 mm w tym roku" brzmi jak fakt, a bywa
       artefaktem: gdy 2100 z 2106 plików nie ma zapisanej ogniskowej, to nie
       jest odpowiedź, tylko rozmiar luki w metadanych. Liczba musi jechać
       razem z wynikiem, bo model sam się nie domyśli, że powinien zapytać. */
    const brak = lista.find((g) => g.wartosc === '(brak danych)');
    const razem = lista.reduce((sum, g) => sum + g.ile, 0);
    return {
      grupy: lista,
      razem,
      zDanymi: razem - (brak ? brak.ile : 0),
      bezDanych: brak ? brak.ile : 0,
    };
  }

  function podsumowanie() {
    const zDatami = wpisy.filter((w) => w.kiedy).map((w) => w.kiedy).sort();
    return {
      wpisow: wpisy.length,
      zdjec: wpisy.filter((w) => w.typ === 'zdjecie').length,
      wideo: wpisy.filter((w) => w.typ === 'wideo').length,
      zGps: wpisy.filter((w) => w.lat !== null).length,
      zrodla: [...new Set(wpisy.map((w) => w.zrodlo))],
      najstarsze: zDatami[0] || null,
      najnowsze: zDatami[zDatami.length - 1] || null,
    };
  }

  /** Ile jeszcze zostało do uzupełnienia — dla panelu archiwum.
   *
   *  Bez tego panel po wielogodzinnym dociąganiu mówił wyłącznie „W archiwum:
   *  59 421 plików" i nie było jak sprawdzić, czy praca się skończyła.
   *  Jedyną drogą było kliknięcie przycisku jeszcze raz i zobaczenie zera —
   *  czyli uruchomienie zadania, żeby dowiedzieć się, że nie ma go po co
   *  uruchamiać.
   *
   *  Liczymy jednym przebiegiem, bez budowania tablic pośrednich: przy
   *  sześćdziesięciu tysiącach wpisów `filter().length` cztery razy pod rząd
   *  to cztery kopie indeksu na każde otwarcie panelu.
   */
  function postep() {
    let zdjec = 0;
    let zDanymi = 0;
    let klipow = 0;
    let zTelemetria = 0;
    let doTelemetrii = 0;
    for (const w of wpisy) {
      if (w.zrodlo !== 'onedrive') continue;
      if (w.typ === 'wideo') {
        klipow++;
        if (w.lot) zTelemetria++;
        else if (w.srtId) doTelemetrii++;
      } else {
        zdjec++;
        if (w.exifCzytany || w.dron) zDanymi++;
      }
    }
    return { zdjec, zDanymi, zostaloZdjec: zdjec - zDanymi, klipow, zTelemetria, doTelemetrii };
  }

  function usunZrodlo(zrodlo) {
    const przed = wpisy.length;
    wpisy = wpisy.filter((w) => w.zrodlo !== zrodlo);
    przebuduj();
    zapiszWkrotce();
    return przed - wpisy.length;
  }

  /** Ustaw dom — wywoływane przy starcie i po zmianie lokalizacji. */
  function ustawDom(wspolrzedne) {
    domyslneWspolrzedne = wspolrzedne && Number.isFinite(wspolrzedne.lat) ? wspolrzedne : null;
  }

  /** Przelicz pory światła jeszcze raz — po ustawieniu domu wpisy bez GPS-u
   *  mają nagle z czego je policzyć, a były zapisane jako `null`. */
  function przeliczSwiatlo() {
    let zmienionych = 0;
    for (const w of wpisy) {
      const nowe = poraSwiatla(w);
      if (nowe !== w.swiatlo) {
        w.swiatlo = nowe;
        w.swiatloPrzyblizone = Boolean(nowe && w.lat === null);
        zmienionych++;
      }
      /* `poraDnia` też jest liczona ze Słońca i też była `null` przed
         ustawieniem domu — a przeliczaliśmy wyłącznie `swiatlo`. Kto ustawił
         lokalizację PO zindeksowaniu, dostawał indeks z wypełnioną fazą
         światła i pustą porą dnia, więc filtr `poraDnia=rano` cicho zwracał
         zero. Dwa pola z tego samego rachunku muszą się odświeżać razem. */
      const nowaPora = poraDniaWpisu(w);
      if (nowaPora !== w.poraDnia) {
        w.poraDnia = nowaPora;
        zmienionych++;
      }
    }
    if (zmienionych) zapiszWkrotce();
    return zmienionych;
  }

  return { dodaj, szukaj, zestawienie, podsumowanie, usunZrodlo, zapisz,
    ustawDom, przeliczSwiatlo, ile: () => wpisy.length, poraSwiatla, postep,
    rodzenstwo };
}

module.exports = { utworz, lokalnyNaUtc };

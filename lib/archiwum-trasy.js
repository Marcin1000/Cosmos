/* ============================================================
   Trasy archiwum materialu - /api/archive/*

   Wydzielone z server.js, gdy plik znow przekroczyl prog 2600 linii. To jest
   spojna calosc: szesc tras czytajacych i uzupelniajacych jeden indeks, plus
   dwa pomocniki, ktorych nie uzywa nic poza nimi.

   Zaleznosci wchodza przez `utworz()`, nie przez stan globalny serwera - ta
   sama zasada, co przy `lib/nagrywanie.js` i `lib/pomysly.js`. Przy poprzednim
   podziale osiem usterek przeszlo `node --check`, bo skladnia byla poprawna,
   a nazwy nie istnialy. Dlatego kontrola "wolane, ale niezdefiniowane"
   ze `scripts/audyt.js` pilnuje tego pliku tak samo jak pozostalych.
   ============================================================ */

const { czytajSrt, naWpisArchiwum } = require('./srt.js');

/**
 * @param {object} z
 * @param {object} z.archiwum   indeks materialu (lib/archiwum.js)
 * @param {object} z.onedrive   klient Microsoft Graph (lib/onedrive.js)
 * @param {string} z.SENSES_URL adres uslugi percepcji
 * @param {Function} z.sendJson  odpowiedz HTTP
 * @param {Function} z.readJson  odczyt ciala zadania
 * @param {Function} z.addEvent  dziennik zdarzen
 * @param {Function} z.sensesState stan zmyslow (moze oddac obiekt albo obietnice)
 * @param {Function} z.wspolrzedneMiejsca nazwa miejsca -> wspolrzedne (lib/miejsca.js)
 */
function utworz({ archiwum, onedrive, SENSES_URL, sendJson, readJson, addEvent,
  sensesState, wspolrzedneMiejsca }) {
  /* Archiwum materiału. Indeks jest pasywny — źródła (OneDrive, dysk przez
     zmysły) wpychają wpisy, a zapytania działają nawet wtedy, gdy te źródła
     są offline. Dlatego „ile klipów 50 mm w tym roku" odpowie z telefonu
     w terenie przy wyłączonym komputerze domowym. */
  async function handleArchiwum(req, res, p) {
    if (p === '/api/archive/add' && req.method === 'POST') {
      let d;
      try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      if (!Array.isArray(d.wpisy)) return sendJson(res, 400, { error: 'Brak tablicy `wpisy`.' });
      if (d.wpisy.length > 5000) return sendJson(res, 413, { error: 'Najwyżej 5000 wpisów naraz.' });
      const wynik = archiwum.dodaj(d.wpisy);
      if (wynik.dodanych) addEvent('archiwum', `zindeksowano ${wynik.dodanych} plików (razem ${wynik.razem})`);
      return sendJson(res, 200, wynik);
    }
    if (p === '/api/archive/search' && req.method === 'GET') {
      const q = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      const limit = Math.min(Number(q.limit) || 40, 200);
      const szukaneMiejsce = q.miejsce;
      const dodatki = await miejsceNaPromien(q);
      const wyniki = archiwum.szukaj(q);
      /* Zero wyników po MIEJSCU, a ta sama nazwa siedzi w ścieżkach.
       *
       *  `miejsce=` działa przez GPS: nazwa idzie do geokodera, a potem
       *  filtrujemy po promieniu. Zdjęcia Marcina z Mazur GPS-u nie mają
       *  (aparat bez modułu), więc `miejsce=Mazury` nie mogło trafić w nic —
       *  mimo że 804 pliki leżą w katalogu „/Mazury 2026/".
       *
       *  Model zobaczył „znaleziono: 0" i przez cztery rundy tłumaczył, że
       *  nazwa folderu jest pewnie inna. Nie była. Zamiast kazać mu zgadywać,
       *  mówimy wprost, ile plików ma tę nazwę w ścieżce. */
      const podpowiedz = {};
      if (!wyniki.length && szukaneMiejsce) {
        const poFolderze = archiwum.szukaj({ ...q, miejsce: undefined, lat: undefined,
          lon: undefined, promienKm: undefined, folder: szukaneMiejsce });
        if (poFolderze.length) {
          podpowiedz.zamiastMiejsca = {
            folder: szukaneMiejsce,
            ile: poFolderze.length,
            uwaga: `Filtr miejsce= działa po GPS, a te pliki go nie mają. `
              + `${poFolderze.length} plików ma „${szukaneMiejsce}" w ścieżce — `
              + `powtórz zapytanie z folder=${szukaneMiejsce} zamiast miejsce=.`,
          };
        }
      }
      return sendJson(res, 200, {
        znaleziono: wyniki.length, wyniki: wyniki.slice(0, limit), ...dodatki, ...podpowiedz,
      });
    }
    /* Miniatura pliku z archiwum — dociągana W CHWILI PYTANIA, nie z indeksu.
       Microsoft Graph oddaje podpisane adresy, które WYGASAJĄ. Zapisane przy
       indeksowaniu byłyby martwe w momencie, gdy Marcin o nie pyta — a to
       właśnie wtedy mają się pokazać. Poza tym adres idzie przez nas, więc
       przeglądarka nie potrzebuje żadnych poświadczeń do OneDrive. */
    if (p === '/api/archive/thumb' && req.method === 'GET') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
      if (!id.startsWith('onedrive:')) return sendJson(res, 400, { error: 'Zły identyfikator.' });
      if (!onedrive.polaczony()) return sendJson(res, 503, { error: 'OneDrive niepołączony.' });
      try {
        /* O podgląd RAW-a pytamy przez jego JPG-owego bliźniaka, gdy taki
           leży obok. Zmierzone: CR3 6805 ms (Graph generuje podgląd u siebie),
           JPG poniżej sekundy (oddaje gotowy). Ten sam kadr, ta sama sekunda —
           różnica jest wyłącznie w cenie. */
        const el = await onedrive.graf(`/me/drive/items/${encodeURIComponent(tanszyPlik(id).slice(9))}`
          + '/thumbnails/0/large');
        if (!el || !el.url) return sendJson(res, 404, { error: 'Brak miniatury.' });
        const r = await fetch(el.url, { signal: AbortSignal.timeout(15000) });
        const typ = r.headers.get('content-type') || '';
        if (!r.ok || !/^image\//i.test(typ)) return sendJson(res, 502, { error: 'To nie jest obraz.' });
        const buf = Buffer.from(await r.arrayBuffer());
        res.writeHead(200, {
          'Content-Type': typ,
          'Content-Length': buf.length,
          // Krótko, bo sam adres u Microsoftu i tak wygasa.
          'Cache-Control': 'private, max-age=600',
        });
        return res.end(buf);
      } catch (err) {
        return sendJson(res, 502, { error: `Nie udało się pobrać miniatury: ${err.message}` });
      }
    }
    if (p === '/api/archive/stats' && req.method === 'GET') {
      const q = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      if (!q.pole) return sendJson(res, 200, archiwum.podsumowanie());
      const wynik = archiwum.zestawienie(q.pole, q);
      if (!wynik) return sendJson(res, 400, { error: `Nie umiem grupować po „${q.pole}".` });
      return sendJson(res, 200, { pole: q.pole, ...wynik });
    }
    /* Dociągnięcie OBIEKTYWU do wpisów z OneDrive.
       Osobno od indeksowania, bo kosztuje jedno żądanie HTTP na plik — przy
       dwóch tysiącach zdjęć to dwa tysiące żądań. Robimy je paczkami, żeby
       dało się przerwać i wznowić, i tylko dla wpisów, którym obiektywu brakuje. */
    if (p === '/api/archive/lenses' && req.method === 'POST') {
      if (!onedrive.polaczony()) return sendJson(res, 503, { error: 'OneDrive niepołączony.' });
      let d = {};
      try { d = await readJson(req); } catch { /* domyślne */ }
      const paczka = Math.min(Math.max(Number(d.ile) || 100, 1), 500);

      /* Kolejka po `exifCzytany`, nie po braku obiektywu.
         Poprzedni warunek („nie ma obiektywu i nie ma drona") miał wadę,
         której nie dało się zauważyć bez prawdziwego archiwum: pliki, w których
         obiektywu po prostu NIE MA — RAW-y z zapisem nietypowym, skany, kadry
         wyeksportowane bez EXIF-u — wracały do kolejki przy każdym przebiegu.
         Paczka mieliła w kółko te same zdjęcia i nigdy nie dochodziła do
         reszty archiwum. */
      const doKolejki = (w) => !w.exifCzytany && !w.dron;
      const doZrobienia = archiwum.szukaj({ zrodlo: 'onedrive', typ: 'zdjecie' })
        .filter(doKolejki).slice(0, paczka);

      let uzupelnione = 0;
      let bezExifu = 0;
      const bledy = [];
      /* RÓWNOLEGLE, nie plik po pliku.
       *
       *  Każdy plik to jedno żądanie zakresu do Microsoftu. Sekwencyjnie
       *  wychodziło ~2-3 pliki na sekundę — czyli przy 56 tysiącach zdjęć
       *  Marcina kilka godzin samego czekania na sieć, przy zerowym obciążeniu
       *  procesora. Opóźnienie łącza sumuje się tylko wtedy, gdy stoi się
       *  w kolejce po jednym.
       *
       *  Cztery naraz, nie sześć: przy sześciu konto Marcina dostało od Graph
       *  serię 429 i cała paczka przepadała. Samo dławienie obsługuje teraz
       *  `lib/onedrive.js` (czeka tyle, ile każe `Retry-After`), ale lepiej
       *  w nie nie wchodzić. Wartość zmienia ONEDRIVE_RUWNOLEGLE. */
      const ILE_NARAZ = Math.min(Math.max(Number(process.env.ONEDRIVE_RUWNOLEGLE) || 4, 1), 16);
      let nastepny = 0;
      const jedenPlik = async (w) => {
        try {
          const exif = await onedrive.dociagnijExif(String(w.id).replace(/^onedrive:/, ''));
          /* BIERZEMY WSZYSTKO, CO PRZECZYTALIŚMY, a nie sam obiektyw.

             To była najdroższa pomyłka w całym archiwum. Ten sam pobrany
             kawałek pliku niesie datę zdjęcia, aparat, ISO, przysłonę, czas,
             ogniskową i GPS — a zapisywaliśmy z tego wyłącznie `obiektyw`
             i dane lotu, resztę wyrzucając.

             Skutek widać było dopiero na prawdziwym archiwum Marcina.
             Microsoft Graph czyta metadane z JPEG-ów, ale RAW-ów Canona (CR2,
             CR3) nie rusza: `photo` przychodzi puste. Więc każde zdjęcie
             z R6 II miało `aparat: null`, `iso: null` i — najgorsze — `kiedy`
             wzięte z daty WGRANIA pliku, nie z daty zrobienia zdjęcia.
             W wynikach wyglądało to identycznie jak zrzut ekranu, a materiał
             z wakacji sprzed roku lądował pod datą wczorajszego wgrania.
             Stąd wrażenie, że Cosmos „widzi tylko zdjęcia z telefonu":
             widział wszystko, tylko lustrzanka nie miała czym się przedstawić.

             Dane z pliku WYGRYWAJĄ z tym, co dał Graph — plik jest źródłem,
             Graph pośrednikiem. Wyjątkiem jest sytuacja, gdy w pliku czegoś
             nie ma; wtedy zostaje to, co było. */
          if (exif) {
            const scal = { ...w, exifCzytany: true };
            for (const pole of ['aparat', 'obiektyw', 'ogniskowa', 'przyslona',
              'czasS', 'iso', 'lat', 'lon', 'kiedy']) {
              if (exif[pole] !== null && exif[pole] !== undefined) scal[pole] = exif[pole];
            }
            if (exif.dron) scal.dron = exif.dron;
            archiwum.dodaj([scal]);
            uzupelnione++;
          } else {
            // Sprawdzony i pusty — zapamiętujemy TO, żeby nie wracał w kółko.
            archiwum.dodaj([{ ...w, exifCzytany: true }]);
            bezExifu++;
          }
        } catch (err) {
          if (bledy.length < 3) bledy.push(String(err.message).slice(0, 80));
        }
      };
      /* Sześciu robotników bierze z jednej kolejki. Nie `Promise.all` po
         wszystkim naraz: paczka to nawet 500 plików i pięćset równoległych
         żądań do Microsoftu skończyłoby się ścianą 429. */
      await Promise.all(Array.from({ length: ILE_NARAZ }, async () => {
        for (;;) {
          const i = nastepny++;
          if (i >= doZrobienia.length) return;
          await jedenPlik(doZrobienia[i]);
        }
      }));
      const zostalo = archiwum.szukaj({ zrodlo: 'onedrive', typ: 'zdjecie' })
        .filter(doKolejki).length;
      if (uzupelnione) addEvent('archiwum', `dane z pliku dociągnięte do ${uzupelnione} zdjęć`);
      return sendJson(res, 200, {
        sprawdzone: doZrobienia.length, uzupelnione, bezExifu, zostalo, bledy,
        // „Microsoft kazał zwolnić" to nie to samo co „nie udało się".
        zdlawione: typeof onedrive.zdlawienia === 'function' ? onedrive.zdlawienia() : 0,
      });
    }

    /* CO WIDAĆ na zdjęciu z OneDrive — YOLO po miniaturze.
       To jest ta część Immicha, która ma tu sens. Immich robi wyszukiwanie
       semantyczne zdjęć modelem CLIP i to naprawdę działa, ale kosztuje Dockera
       z Postgresem, kontener ML i drugą bazę obok naszej — cały równoległy stos
       dla jednej funkcji. Tymczasem materiał z OneDrive nie ma o sobie ŻADNEJ
       informacji o treści: Microsoft Graph oddaje datę, aparat i GPS, i tyle.
       Kategorie tematyczne zgadujemy z nazw folderów, więc „Wesele Kasi" działa,
       a „IMG_4471.JPG" nie mówi nic.

       Wystarczy podać zdjęcie oczom, które już mamy. YOLO ze zmysłów rozpoznaje
       80 klas obiektów (osoba, pies, ptak, koń, samochód, motocykl, łódź...) —
       dokładnie ten poziom, na którym pyta się o własne archiwum. Idzie po
       MINIATURZE, nie po pliku: detekcja na 800 px daje ten sam wynik co na
       40 megapikselach, a ściąga kilkadziesiąt kilobajtów zamiast dwudziestu
       megabajtów. Wypełnione `obiekty` wpadają potem w kategoryzację tematyczną
       przy zapisie wpisu, więc „pokaż zdjęcia z psem" zaczyna działać samo. */
    if (p === '/api/archive/vision' && req.method === 'POST') {
      if (!onedrive.polaczony()) return sendJson(res, 503, { error: 'OneDrive niepołączony.' });
      const zmysly = await sensesState();
      if (!(zmysly.online && zmysly.caps && zmysly.caps.yolo)) {
        return sendJson(res, 503, {
          error: 'Rozpoznawanie treści wymaga zmysłów z YOLO. Uruchom je na komputerze '
               + 'domowym: python senses/service.py (pip install ultralytics).',
        });
      }
      let d = {};
      try { d = await readJson(req); } catch { /* domyślne */ }
      const paczka = Math.min(Math.max(Number(d.ile) || 50, 1), 300);

      const brakuje = () => archiwum.szukaj({ zrodlo: 'onedrive', typ: 'zdjecie' })
        .filter((w) => !w.obejrzane);
      const grupy = sparujRawZJpg(brakuje(), paczka);

      let opisane = 0;
      let pusteKadry = 0;
      let zParowania = 0;              // pliki opisane bez ani jednego żądania
      const bledy = [];
      /* Trzy kolejki po sieci NA KAŻDE ZDJĘCIE: adres miniatury z Graph,
       *  pobranie miniatury, wysyłka do YOLO na domowy komputer. Sekwencyjnie
       *  zmierzone u Marcina: 30 zdjęć w 36 s, czyli 1,2 s na plik przy 55
       *  tysiącach w kolejce — osiemnaście godzin, z czego większość to
       *  czekanie, aż coś doleci.
       *
       *  Zaczęliśmy od trzech, w obawie o JEDNĄ kartę graficzną na końcu
       *  łańcucha. Pomiar pokazał, że obawa była nietrafiona: „adres 628 ms ·
       *  pobranie 6805 ms · YOLO 220 ms", RTX 3080 na 18% i 46 °C. Wąskim
       *  gardłem jest czekanie na Microsoft, a czekanie zrównolegla się za
       *  darmo — karta dostaje 220 ms pracy na siedem sekund czekania i przy
       *  sześciu naraz nadal się nudzi.
       *
       *  Sześć, nie dwanaście, bo po drugiej stronie jest limit żądań Graph
       *  i 429 kosztuje więcej, niż zyskuje kolejny wątek. */
      const ileNarazYolo = Math.min(Math.max(Number(process.env.YOLO_RUWNOLEGLE) || 6, 1), 12);
      let nastepnaGrupa = 0;
      const czasy = { adres: 0, pobranie: 0, yolo: 0, bajty: 0, ile: 0 };
      const jednaGrupa = async (grupa) => {
        /* Pierwszy w grupie jest najtańszy (patrz `sparujRawZJpg`). Gdy poleci
           błędem — miniatura zniknęła, Graph oddał 404 — próbujemy kolejnego
           z tej samej pary, zamiast odpuszczać całą grupę przez jeden plik. */
        let obiekty = null;
        let ostatniBlad = null;
        for (const kandydat of grupa) {
          try {
            obiekty = await obiektyZMiniatury(String(kandydat.id).replace(/^onedrive:/, ''), czasy);
            break;
          } catch (err) { ostatniBlad = err; }
        }
        if (!obiekty) {
          // Bez `obejrzane` — pliki wrócą do kolejki i spróbujemy jeszcze raz.
          if (bledy.length < 3) bledy.push(String(ostatniBlad.message).slice(0, 100));
          return;
        }
        /* `obejrzane` stawiamy TAKŻE gdy nic nie znaleziono. Bez tego zdjęcia
           krajobrazu — na których YOLO słusznie nie widzi żadnego z 80
           obiektów — wracałyby do kolejki przy każdym przebiegu i paczka
           mieliłaby w kółko te same pliki, nigdy nie docierając do reszty. */
        archiwum.dodaj(grupa.map((w) => ({ ...w, obiekty, obejrzane: true })));
        for (const _ of grupa) { if (obiekty.length) opisane++; else pusteKadry++; }
        zParowania += grupa.length - 1;
      };
      await Promise.all(Array.from({ length: ileNarazYolo }, async () => {
        for (;;) {
          const i = nastepnaGrupa++;
          if (i >= grupy.length) return;
          await jednaGrupa(grupy[i]);
        }
      }));
      const zostalo = brakuje().length;
      if (opisane) addEvent('archiwum', `treść rozpoznana na ${opisane} zdjęciach`);
      const sr = (x) => (czasy.ile ? Math.round(x / czasy.ile) : 0);
      return sendJson(res, 200, {
        sprawdzone: grupy.reduce((s, g) => s + g.length, 0),
        opisane, pusteKadry, zostalo, bledy,
        rownolegle: ileNarazYolo,
        // Ile plików dostało etykiety z pary, bez własnego żądania do Graph.
        zParowania,
        // Średnie na ŻĄDANIE (nie na plik), w ms — widać, który etap kosztuje.
        czasy: { adres: sr(czasy.adres), pobranie: sr(czasy.pobranie), yolo: sr(czasy.yolo),
          kb: czasy.ile ? Math.round(czasy.bajty / czasy.ile / 1024) : 0 },
      });
    }

    /* TELEMETRIA KLIPÓW — plik .SRT leżący obok nagrania.
       To była największa dziura w indeksie: o zdjęciach Cosmos wiedział
       wszystko, o klipach nic, bo Microsoft Graph oddaje dla wideo samą datę
       i rozmiar. Tymczasem Mavic 3 zapisuje obok każdego nagrania telemetrię
       z ISO, czasem, przysłoną, ogniskową, GPS-em i wysokością — dla każdej
       klatki. Jeden przebieg wypełnia wszystkie te pola naraz i klipy zaczynają
       się pojawiać w tych samych pytaniach co zdjęcia. */
    if (p === '/api/archive/telemetry' && req.method === 'POST') {
      if (!onedrive.polaczony()) return sendJson(res, 503, { error: 'OneDrive niepołączony.' });
      let d = {};
      try { d = await readJson(req); } catch { /* domyślne */ }
      const paczka = Math.min(Math.max(Number(d.ile) || 25, 1), 200);

      // Bierzemy tylko te klipy, przy których indeksowanie ZOBACZYŁO plik .SRT.
      const brakuje = () => archiwum.szukaj({ zrodlo: 'onedrive', typ: 'wideo' })
        .filter((w) => w.srtId && !w.lot);
      const doZrobienia = brakuje().slice(0, paczka);

      let odczytane = 0;
      let bezTelemetrii = 0;
      const bledy = [];
      /* Próbka z pierwszego pliku, który .SRT-em był, a telemetrią nie.
         Marcin zobaczył „telemetria odczytana z 0 klipów" i nie miał z czego
         wywnioskować dlaczego: czy pliki są puste, czy to zwykłe napisy, czy
         nasz czytnik nie zna jego wariantu formatu. Bez próbki jedyną drogą
         byłoby zgadywanie. */
      let probka = '';
      // Ten sam powód co przy EXIF-ie: jedno żądanie na plik, więc czekanie
      // na sieć sumuje się tyle razy, ile jest klipów.
      const ileNaraz = Math.min(Math.max(Number(process.env.ONEDRIVE_RUWNOLEGLE) || 4, 1), 16);
      let nastepnyKlip = 0;
      const jedenKlip = async (w) => {
        try {
          const tekst = await onedrive.dociagnijSrt(w.srtId);
          const tele = czytajSrt(tekst);
          if (tele) {
            archiwum.dodaj([naWpisArchiwum(w, tele)]);
            odczytane++;
          } else {
            /* Plik był, ale to nie telemetria — czasem obok klipu leżą zwykłe
               napisy. Zerujemy `srtId`, żeby nie wracał do kolejki w kółko;
               to ta sama pułapka, co przy `obejrzane` w rozpoznawaniu treści. */
            archiwum.dodaj([{ ...w, srtId: null }]);
            bezTelemetrii++;
            if (!probka && tekst && tekst.trim()) {
              probka = String(tekst).replace(/\s+/g, ' ').trim().slice(0, 160);
            }
          }
        } catch (err) {
          if (bledy.length < 3) bledy.push(String(err.message).slice(0, 100));
        }
      };
      await Promise.all(Array.from({ length: ileNaraz }, async () => {
        for (;;) {
          const i = nastepnyKlip++;
          if (i >= doZrobienia.length) return;
          await jedenKlip(doZrobienia[i]);
        }
      }));
      const zostalo = brakuje().length;
      if (odczytane) addEvent('archiwum', `telemetria odczytana z ${odczytane} klipów`);
      return sendJson(res, 200, {
        sprawdzone: doZrobienia.length, odczytane, bezTelemetrii, zostalo, bledy, probka,
        zdlawione: typeof onedrive.zdlawienia === 'function' ? onedrive.zdlawienia() : 0,
      });
    }

    if (p === '/api/archive/source' && req.method === 'DELETE') {
      const zrodlo = new URL(req.url, 'http://localhost').searchParams.get('zrodlo') || '';
      if (!zrodlo) return sendJson(res, 400, { error: 'Podaj `zrodlo`.' });
      return sendJson(res, 200, { usunieto: archiwum.usunZrodlo(zrodlo) });
    }
    return sendJson(res, 404, { error: 'Nieznana trasa archiwum.' });
  }

  /* Miniatura z OneDrive → lista obiektów wykrytych przez YOLO.
   *
   *  Próg pewności jest tu WYŻSZY niż w podglądzie na żywo (0,45 zamiast
   *  domyślnego). Przy podglądzie fałszywy alarm mija po klatce; tutaj zapisuje
   *  się w indeksie na stałe i wystarczy, żeby zdjęcie z lasu wpadło na zawsze
   *  do kategorii „zwierzęta dzikie", bo cień w krzakach przez pół sekundy
   *  przypominał psa. */
  const YOLO_PROG = Number(process.env.ARCHIVE_VISION_MIN_CONF || 0.45);

  /* RAW I JPG TO JEDNO ZDJĘCIE — dwa pliki, jedna treść.
   *
   *  Marcin fotografuje w RAW+JPEG, więc obok `3B9A4860.CR3` leży
   *  `3B9A4860.JPG`: ten sam kadr, ta sama sekunda, ten sam folder. Bez
   *  parowania YOLO ogląda oba i dwa razy płacimy za to samo rozpoznanie.
   *
   *  Płacimy nierówno. Pomiar u Marcina: pobranie miniatury 6805 ms przy
   *  99 kB, samo YOLO 220 ms — czyli 89% czasu to czekanie na Microsoft,
   *  a nie liczenie na RTX 3080 (18% obciążenia, 46 °C). Powód: dla CR3
   *  Graph MUSI wygenerować podgląd u siebie, bo w RAW nie ma gotowej
   *  miniatury w rozmiarze „large". Dla JPG oddaje plik z półki.
   *
   *  Stąd dwa zyski naraz: kolejka topnieje o połowę, a z każdej pary
   *  pytamy o TAŃSZY plik. Kolejność w grupie to kolejność prób —
   *  pierwszy jest ten, o który pytamy.
   *
   *  Grupujemy po pełnej ścieżce bez rozszerzenia, więc `/Mazury/A.CR3`
   *  i `/Wesele/A.CR3` zostają osobno. Gdy ścieżki brak, kluczem jest `id`:
   *  wpis idzie sam, zamiast skleić się z każdym innym bezścieżkowym.
   */
  const TANIE = ['.jpg', '.jpeg', '.png', '.heic', '.webp'];
  function kosztPliku(w) {
    const nazwa = String(w.nazwa || w.sciezka || '').toLowerCase();
    const i = TANIE.findIndex((r) => nazwa.endsWith(r));
    return i < 0 ? TANIE.length : i;       // nieznane/RAW na koniec
  }
  /** Ten sam kadr, najtańsza miniatura. Gdy bliźniaka nie ma — wejściowy `id`. */
  function tanszyPlik(id) {
    if (typeof archiwum.rodzenstwo !== 'function') return id;
    const bracia = archiwum.rodzenstwo(id);
    if (bracia.length < 2) return id;
    const naj = bracia.slice().sort((a, b) => kosztPliku(a) - kosztPliku(b))[0];
    return naj && naj.id ? naj.id : id;
  }
  function sparujRawZJpg(wpisy, limitPlikow) {
    const grupy = new Map();
    for (const w of wpisy) {
      const s = String(w.sciezka || '');
      const klucz = s ? s.toLowerCase().replace(/\.[^./]+$/, '') : `#${w.id}`;
      if (!grupy.has(klucz)) grupy.set(klucz, []);
      grupy.get(klucz).push(w);
    }
    const out = [];
    let plikow = 0;
    for (const g of grupy.values()) {
      /* Limit liczymy w PLIKACH, nie w grupach — pasek postępu u Marcina
         pokazuje pliki i paczka ma zostać tej samej wielkości. Sprawdzamy
         przed dołożeniem, więc nigdy nie przekraczamy, ale zawsze bierzemy
         co najmniej jedną grupę. */
      if (plikow && plikow + g.length > limitPlikow) break;
      g.sort((a, b) => kosztPliku(a) - kosztPliku(b));
      out.push(g);
      plikow += g.length;
      if (plikow >= limitPlikow) break;
    }
    return out;
  }

  async function obiektyZMiniatury(idPliku, czasy = null) {
    /* Pomiar etapów, nie całości.
     *
     *  „1,63 s na zdjęcie" nie mówi, co poprawić. Te same 1,63 s mogą znaczyć
     *  wolne łącze do Microsoftu, wolne łącze do domu albo zatkane YOLO —
     *  a każda z tych rzeczy wymaga czego innego. Trzy stopery kosztują nic
     *  i zamieniają zgadywanie w odczyt. */
    const t0 = Date.now();
    const el = await onedrive.graf(`/me/drive/items/${encodeURIComponent(idPliku)}`
      + '/thumbnails/0/large');
    if (!el || !el.url) throw new Error('Brak miniatury.');
    const t1 = Date.now();
    const r = await fetch(el.url, { signal: AbortSignal.timeout(20000) });
    const typ = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//i.test(typ)) throw new Error(`Miniatura: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const t2 = Date.now();
    if (czasy) {
      czasy.adres += t1 - t0;
      czasy.pobranie += t2 - t1;
      czasy.bajty += buf.length;
    }

    const odp = await fetch(`${SENSES_URL}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: `data:${typ};base64,${buf.toString('base64')}` }),
      signal: AbortSignal.timeout(60000),
    });
    if (!odp.ok) throw new Error(`Zmysły: HTTP ${odp.status}`);
    const dane = await odp.json();
    if (czasy) { czasy.yolo += Date.now() - t2; czasy.ile++; }
    const etykiety = (dane.objects || [])
      .filter((o) => Number(o.conf) >= YOLO_PROG)
      .map((o) => String(o.label));
    // Bez powtórzeń: „12× person" na zdjęciu z wesela to wciąż jedna informacja,
    // a indeks trzyma najwyżej 20 obiektów na wpis.
    return [...new Set(etykiety)];
  }

  /* „Pokaż zdjęcia z Krakowa" — nazwa miejsca na filtr promieniowy.
   *
   *  Indeks trzyma współrzędne, nie nazwy: Microsoft Graph oddaje lat/lon
   *  i tyle. Dopóki tego nie było, pytanie o miasto nie miało jak zadziałać —
   *  pole `miejsce` dla materiału z OneDrive jest zawsze puste.
   *
   *  Promień dobieramy do tego, CZYM jest miejsce. „Kraków" to punkt i 25 km
   *  wystarczy z zapasem; „Mazury" albo „Bieszczady" to region rozciągnięty na
   *  dziesiątki kilometrów i ten sam promień uciąłby większość materiału.
   *  Nominatim podaje obwiednię (`boundingbox`), więc bierzemy ją zamiast
   *  zgadywać — a gdy jej nie ma, zostaje rozsądne 25 km.
   */
  async function miejsceNaPromien(q) {
    if (!q.miejsce || (q.lat && q.lon)) return {};
    const m = await wspolrzedneMiejsca(String(q.miejsce));
    if (!m) return { miejsceNieznane: String(q.miejsce).slice(0, 80) };
    q.lat = m.lat;
    q.lon = m.lon;
    if (!q.promienKm) q.promienKm = m.promienKm || 25;
    delete q.miejsce;              // dalej filtruje już promień, nie tekst
    return { miejsceZNazwy: { nazwa: m.nazwa, lat: m.lat, lon: m.lon, promienKm: q.promienKm } };
  }
  return { handleArchiwum, miejsceNaPromien, obiektyZMiniatury };
}

module.exports = { utworz };

/* ============================================================
   CO fotografujesz — jeden słownik, dwa zastosowania

   Marcin: „w aspekcie planu zdjęciowego ważne jest to, co będę filmował lub
   co będę fotografował" — psy, ptaki, niedźwiedzie, łosie, samochody
   statycznie i w wyścigu, modelki, mecze, koncerty, śluby, a osobno przyroda:
   lasy, kaniony, jeziora, wybrzeże, góry, doliny, klify. I zaraz potem:
   „po takich kategoriach też bym chciał później przeszukiwać archiwum".

   To są DWA pytania do jednego słownika i dlatego słownik jest osobnym
   modułem, a nie częścią doboru ekspozycji:

     • PLAN     — „jadę fotografować żurawie" → jaki czas, jaka ogniskowa,
                  jaka przysłona, na co uważać
     • ARCHIWUM — „pokaż zdjęcia ptaków z zeszłego roku" → po czym poznać, że
                  dany plik jest z tej kategorii

   Gdyby słowniki były dwa, rozjechałyby się przy pierwszej zmianie i „ptaki"
   w planie znaczyłyby co innego niż „ptaki" w archiwum.

   LISTA JEST OTWARTA — to warunek postawiony wprost. Nierozpoznany temat nie
   jest błędem: dostaje neutralne ustawienia, znacznik `zgadywany` i Cosmos
   mówi wprost, że zgaduje. Lepiej policzyć rozsądnie i się przyznać, niż
   odmówić albo udawać wiedzę.

   Liczby (czas migawki, ogniskowe) to praktyka fotograficzna, nie wzory:
   1/1600 na ptaka w locie i 1/60 na panning przy motocyklu biorą się stąd,
   że tak się to robi. Gdzie coś jest sporne, mówię o tym w `uwagi`.
   ============================================================ */

/* `ogniskowa` to zakres, w którym temat ma sens, a `ogniskowaPref` to
   ogniskowa TYPOWA — ta, którą fotograf ustawia najczęściej. Sam zakres nie
   wystarczał do wyboru szkła: przy krajobrazie [16-200] wygrywał obiektyw
   pokrywający większą część zakresu, czyli 70-200, i Cosmos radził 135 mm na
   panoramę gór. Punkt odniesienia musi być jeden, nie przedział.

   Poziomy ruchu przekładają się na NAJKRÓTSZY czas, jaki ma sens.
   `czasMin` to mianownik ułamka: 1600 znaczy 1/1600 s. */
const RUCH = {
  'statyczne': 0,
  'spacer': 125,
  'szybkie': 500,
  'bardzo-szybkie': 1600,
};

const TEMATY = {
  // ---------------------------------------------------------- zwierzęta
  'ptaki-w-locie': {
    nazwa: 'ptaki w locie',
    slowa: ['ptak', 'ptaki', 'ptaków', 'orzeł', 'orła', 'bielik', 'bocian', 'żuraw', 'żurawie',
      'mewa', 'sokół', 'jastrząb', 'czapla', 'kaczk', 'gęsi', 'łabędz', 'w locie', 'birding'],
    ruch: 'bardzo-szybkie',
    czasMin: 1600,
    ogniskowa: [300, 600],
    ogniskowaPref: 500,
    glebia: 'otwarcie',
    uwagi: 'AF-C ze śledzeniem oka zwierzęcia, seria zdjęć. Przy 1/1600 s i dłuższym '
      + 'szkle ISO poleci wysoko — to normalne, ostry kadr przy ISO 6400 jest wart '
      + 'więcej niż czysty i poruszony.',
  },
  'zwierzeta-dzikie': {
    nazwa: 'dzikie zwierzęta',
    slowa: ['niedźwiedz', 'łoś', 'łosie', 'jeleń', 'sarn',
      'dzik', 'wilk', 'lis', 'żubr', 'ryś', 'dzikie zwierz', 'safari', 'zwierzyn'],
    ruch: 'szybkie',
    czasMin: 500,
    ogniskowa: [200, 600],
    ogniskowaPref: 400,
    glebia: 'otwarcie',
    uwagi: 'Najlepsze światło i największa aktywność to świt i zmierzch — czyli wtedy, '
      + 'gdy światła jest najmniej. Zakładaj wysokie ISO i trzymaj dystans: '
      + 'dłuższe szkło jest tu kwestią bezpieczeństwa, nie kadru.',
  },
  'zwierzeta-domowe': {
    nazwa: 'zwierzęta domowe',
    slowa: ['pies', 'psy', 'psa', 'kot', 'koty', 'szczeniak', 'kociak', 'pupil', 'zwierzak'],
    ruch: 'szybkie',
    czasMin: 500,
    ogniskowa: [35, 135],
    ogniskowaPref: 85,
    glebia: 'otwarcie',
    uwagi: 'Schodź do wysokości oczu zwierzęcia. Przy biegnącym psie 1/1000 s, '
      + 'przy leżącym wystarczy 1/250 s.',
  },

  // ---------------------------------------------------------- pojazdy
  'wyscig': {
    nazwa: 'wyścig, pojazdy w ruchu',
    slowa: ['wyścig', 'wyścigi', 'tor', 'rajd', 'formuła', 'motocross', 'race', 'racing',
      'samochody w ruchu', 'motocykle w ruchu', 'panning'],
    ruch: 'szybkie',
    czasMin: 500,
    ogniskowa: [100, 400],
    ogniskowaPref: 200,
    glebia: 'otwarcie',
    uwagi: 'Dwa różne zdjęcia z tego samego miejsca: ZAMROŻENIE przy 1/1000 s i wyżej, '
      + 'albo PANNING przy 1/60-1/125 s z prowadzeniem aparatu za pojazdem — wtedy tło '
      + 'się rozmywa i widać prędkość. Panning wymaga krótszego czasu niż podpowiada '
      + 'automat, więc podaj go wprost, jeśli o niego Ci chodzi.',
  },
  'pojazdy-statycznie': {
    nazwa: 'pojazdy statycznie',
    slowa: ['samochód', 'samochody', 'auto', 'motocykl', 'motor', 'sesja auta',
      'youngtimer', 'oldtimer', 'car spotting'],
    ruch: 'statyczne',
    czasMin: 0,
    ogniskowa: [35, 135],
    ogniskowaPref: 50,
    glebia: 'srednia',
    uwagi: 'Lakier to lustro — najwięcej daje pora, nie przysłona: pochmurne niebo albo '
      + 'złota godzina zamiast ostrego słońca, które wpisze w maskę całe otoczenie. '
      + 'Filtr polaryzacyjny zdejmuje odbicia z szyb.',
  },
  'ulica': {
    nazwa: 'fotografia uliczna',
    slowa: ['ulica', 'uliczna', 'street', 'miasto', 'miejska', 'reportaż uliczny'],
    ruch: 'spacer',
    czasMin: 250,
    ogniskowa: [23, 50],
    ogniskowaPref: 35,
    glebia: 'srednia',
    uwagi: 'Klasyka to 35 mm i przysłona f/8 z ostrością ustawioną na 3-5 m — wtedy '
      + 'wszystko od 2 m do nieskończoności jest ostre i nie czekasz na autofokus.',
  },

  // ---------------------------------------------------------- ludzie
  'portret': {
    nazwa: 'portret',
    slowa: ['portret', 'headshot', 'twarz', 'modelka', 'model', 'modelki'],
    ruch: 'statyczne',
    czasMin: 160,
    ogniskowa: [85, 135],
    ogniskowaPref: 105,
    glebia: 'otwarcie',
    uwagi: 'Ostrość na oko bliższe aparatowi. Przy f/1.4 i 85 mm głębia ostrości to '
      + 'centymetry — jeśli model choćby drgnie, ostre będą rzęsy zamiast źrenicy. '
      + 'f/2 bywa bezpieczniejsze niż f/1.2.',
  },
  'sesja-moda': {
    nazwa: 'sesja modowa',
    slowa: ['sesja', 'moda', 'modowa', 'lookbook', 'fashion', 'edytorial', 'kampania'],
    ruch: 'spacer',
    czasMin: 250,
    ogniskowa: [50, 135],
    ogniskowaPref: 85,
    glebia: 'srednia',
    uwagi: 'Ubranie ma być czytelne, więc nie otwieraj do końca — f/4 do f/5.6 trzyma '
      + 'całą sylwetkę ostro. Przy zdjęciach w ruchu (podskok, obrót sukni) 1/500 s.',
  },
  'ludzie-w-ruchu': {
    nazwa: 'ludzie w ruchu',
    slowa: ['w ruchu', 'bieg', 'biegacz', 'taniec', 'tancer', 'skok', 'parkour', 'dzieci'],
    ruch: 'szybkie',
    czasMin: 800,
    ogniskowa: [50, 200],
    ogniskowaPref: 135,
    glebia: 'otwarcie',
    uwagi: 'Ręce i stopy poruszają się szybciej niż tułów — czas dobierany „na sylwetkę" '
      + 'zostawi rozmyte dłonie.',
  },

  // ---------------------------------------------------------- wydarzenia
  'koncert': {
    nazwa: 'koncert',
    slowa: ['koncert', 'koncerc', 'scena', 'zespół', 'festiwal', 'klub', 'gig'],
    ruch: 'szybkie',
    czasMin: 250,
    ogniskowa: [35, 200],
    ogniskowaPref: 85,
    glebia: 'otwarcie',
    uwagi: 'Światło sceniczne skacze o kilka działek w sekundę i jest kolorowe. Pomiar '
      + 'punktowy na twarz, ekspozycja pod ŚWIATŁA (przepalonego reflektora nie odzyskasz), '
      + 'balieli bieli ustaw ręcznie. Jasne szkło jest tu ważniejsze niż korpus.',
  },
  'mecz': {
    nazwa: 'mecz, sport',
    slowa: ['mecz', 'sport', 'piłka', 'boisko', 'hala', 'zawody', 'turniej', 'stadion'],
    ruch: 'bardzo-szybkie',
    czasMin: 1000,
    ogniskowa: [70, 400],
    ogniskowaPref: 200,
    glebia: 'otwarcie',
    uwagi: 'W hali światło jest gorsze, niż wygląda, i często migocze — przy sztucznym '
      + 'oświetleniu sprawdź zdjęcia próbne pod paski. Na zewnątrz ustaw się tak, '
      + 'żeby mieć słońce za plecami.',
  },
  'slub': {
    nazwa: 'ślub',
    slowa: ['ślub', 'wesel', 'panna młoda', 'para młoda', 'ceremoni', 'oczepiny'],
    ruch: 'spacer',
    czasMin: 200,
    ogniskowa: [24, 135],
    ogniskowaPref: 50,
    glebia: 'srednia',
    uwagi: 'Biała suknia i ciemny garnitur w jednym kadrze to rozpiętość na granicy '
      + 'matrycy — ekspozycja pod suknię, cienie podnosisz później. W kościele bywa '
      + 'ciemniej niż w klubie, a lampy zwykle nie wolno użyć.',
  },
  'wydarzenie-rodzinne': {
    nazwa: 'wydarzenie rodzinne',
    slowa: ['urodzin', 'chrzest', 'komuni', 'rodzinn', 'przyjęci', 'impreza', 'jubileusz'],
    ruch: 'spacer',
    czasMin: 160,
    ogniskowa: [24, 85],
    ogniskowaPref: 35,
    glebia: 'srednia',
    uwagi: 'Wnętrza i mieszane światło (żarówki plus okno). Odbita lampa w sufit '
      + 'ratuje więcej kadrów niż jakiekolwiek podbicie ISO.',
  },

  // ---------------------------------------------------------- przyroda i krajobraz
  'krajobraz': {
    nazwa: 'krajobraz, duże przestrzenie',
    slowa: ['krajobraz', 'krajobrazy', 'panorama', 'przestrzeń', 'przestrzenie', 'pole',
      'łąka', 'step', 'pustynia', 'landscape', 'dolina', 'doliny'],
    ruch: 'statyczne',
    czasMin: 0,
    ogniskowa: [16, 50],
    ogniskowaPref: 24,
    glebia: 'zamkniecie',
    uwagi: 'f/8-f/11 daje najostrzejszy obraz w całym kadrze; powyżej f/16 dyfrakcja '
      + 'zaczyna zabierać szczegół. Statyw i najniższe ISO — czasu nikt tu nie goni.',
  },
  'gory': {
    nazwa: 'góry',
    slowa: ['gory', 'górach', 'górsk', 'szczyt', 'grań', 'tatr', 'bieszczad', 'alpy', 'przełęcz', 'schronisko'],
    ruch: 'statyczne',
    czasMin: 0,
    ogniskowa: [16, 200],
    ogniskowaPref: 35,
    glebia: 'zamkniecie',
    uwagi: 'Powietrze w górach jest przejrzyste, więc kontrast jest wyższy niż na nizinach '
      + 'i łatwo przepalić śnieg albo skałę w słońcu. Teleobiektyw spłaszcza plany '
      + 'i daje warstwy grani — często lepiej niż szeroki kadr.',
  },
  'las': {
    nazwa: 'las',
    slowa: ['las', 'lesie', 'lasy', 'lasach', 'puszcz', 'drzew', 'bór', 'runo', 'mgła w lesie'],
    ruch: 'statyczne',
    czasMin: 0,
    ogniskowa: [24, 135],
    ogniskowaPref: 50,
    glebia: 'zamkniecie',
    uwagi: 'W lesie jest 3-5 działek ciemniej niż na otwartym terenie, a plamy słońca '
      + 'między koronami dają kontrast nie do uratowania. Pochmurny dzień albo mgła '
      + 'są tu lepsze niż słońce.',
  },
  'woda-wybrzeze': {
    nazwa: 'morze, wybrzeże',
    slowa: ['morz', 'ocean', 'wybrzeż', 'plaż', 'fale', 'seaside', 'oceanside',
      'latarnia', 'port', 'zatoka'],
    ruch: 'statyczne',
    czasMin: 0,
    ogniskowa: [16, 200],
    ogniskowaPref: 24,
    glebia: 'zamkniecie',
    uwagi: 'Fale to wybór: 1/500 s zamraża rozprysk, 1-30 s zamienia wodę w mgłę — '
      + 'to drugie wymaga filtra ND i statywu. Sól osiada na przedniej soczewce '
      + 'w kilkanaście minut, miej czym czyścić.',
  },
  'jezioro': {
    nazwa: 'jezioro',
    slowa: ['jezior', 'mazur', 'staw', 'zalew', 'tafla', 'pomost'],
    ruch: 'statyczne',
    czasMin: 0,
    ogniskowa: [16, 135],
    ogniskowaPref: 24,
    glebia: 'zamkniecie',
    uwagi: 'Odbicie w tafli wymaga bezwietrznej wody — praktycznie tylko o świcie. '
      + 'Polaryzator ODEJMUJE odbicie, więc przy lustrzanym kadrze go zdejmij.',
  },
  'kanion-klif': {
    nazwa: 'kanion, klify',
    slowa: ['kanion', 'klif', 'wąwóz', 'urwisko', 'skał', 'ściana skalna'],
    ruch: 'statyczne',
    czasMin: 0,
    ogniskowa: [14, 70],
    ogniskowaPref: 20,
    glebia: 'zamkniecie',
    uwagi: 'Dno w cieniu i krawędź w słońcu to rozpiętość poza zasięgiem jednej klatki — '
      + 'albo bracketing, albo poczekaj, aż słońce zejdzie z krawędzi. Skala robi się '
      + 'czytelna dopiero, gdy w kadrze jest człowiek.',
  },
  'architektura': {
    nazwa: 'architektura',
    slowa: ['architektura', 'budynek', 'budynki', 'wnętrze', 'wnętrza', 'kościół', 'zamek',
      'katedra', 'kamienica', 'most'],
    ruch: 'statyczne',
    czasMin: 0,
    ogniskowa: [14, 50],
    ogniskowaPref: 24,
    glebia: 'zamkniecie',
    uwagi: 'Trzymaj matrycę pionowo względem fasady, inaczej pionowe linie się zbiegną. '
      + 'Poprawianie tego później kosztuje kilkanaście procent kadru.',
  },
  'noc-gwiazdy': {
    nazwa: 'noc, gwiazdy',
    slowa: ['gwiazdy', 'mleczna droga', 'nocne niebo', 'astro', 'zorza', 'nocą', 'nocne'],
    ruch: 'statyczne',
    czasMin: 0,
    ogniskowa: [14, 35],
    ogniskowaPref: 20,
    glebia: 'otwarcie',
    dlugieCzasy: true,          // tu ekspozycja idzie w SEKUNDY, nie w ułamki
    uwagi: 'Reguła 500: najdłuższy czas bez smug gwiazd to 500 podzielone przez ogniskową '
      + '(przy 20 mm — 25 s). Ostrość ustawiaj ręcznie na najjaśniejszej gwieździe '
      + 'w podglądzie, autofokus w ciemności nie działa.',
  },
  'makro': {
    nazwa: 'makro, detal',
    slowa: ['makro', 'detal', 'zbliżenie', 'owad', 'kwiat', 'kropla', 'insekt'],
    ruch: 'statyczne',
    czasMin: 250,
    ogniskowa: [90, 105],
    ogniskowaPref: 100,
    glebia: 'zamkniecie',
    uwagi: 'W skali 1:1 głębia ostrości przy f/8 to milimetry — stąd f/11-f/16 mimo '
      + 'dyfrakcji, albo składanie ostrości z kilku klatek. Największym wrogiem jest '
      + 'najlżejszy wiatr, nie brak światła.',
  },
};

/* Słowa, które PRZESĄDZAJĄ o kategorii, choć w tekście stoi obok inne.
   „Wyścig motocykli" to wyścig, nie sesja motocykla — i bez tej listy
   przegrywał, bo „motocykl" jest dłuższym słowem niż „wyścig". Podobnie
   „klify nad oceanem" to klify, a ocean jest tylko tłem. */
const MOCNE = {
  'wyscig': ['wyścig', 'wyścigi', 'rajd', 'motocross', 'race', 'racing', 'panning', 'w ruchu'],
  'kanion-klif': ['klif', 'klify', 'kanion', 'kaniony', 'wąwóz'],
  'ptaki-w-locie': ['w locie'],
  'noc-gwiazdy': ['mleczna droga', 'astro', 'zorza'],
};

/** Odmiana polska zjada końcówki, więc porównujemy rdzenie. */
function uprosc(tekst) {
  return String(tekst || '').toLowerCase()
    .replace(/[ąàâ]/g, 'a').replace(/[ćč]/g, 'c').replace(/[ęè]/g, 'e')
    .replace(/[łl]/g, 'l').replace(/[ńñ]/g, 'n').replace(/[óô]/g, 'o')
    .replace(/[śš]/g, 's').replace(/[żź]/g, 'z')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Czy słowo kluczowe pasuje do tekstu? Zwraca „siłę" trafienia albo 0.
 *
 *  Dopasowanie po zwykłym fragmencie było za luźne i dawało wyniki absurdalne:
 *  „robię ZDJĘCIA rowerów" trafiało w koncert, bo w środku słowa „zdjęcia"
 *  siedzi „dj". Stąd dopasowanie do POCZĄTKU SŁOWA, nie do jego środka.
 *
 *  Rdzenie trzyliterowe („łoś", „tor") wymagają trafienia dokładnego —
 *  inaczej „tort" na urodzinach robi się torem wyścigowym. Dłuższe rdzenie
 *  łapią odmianę przez początek: „zuraw" znajdzie „żurawie" i „żurawi".
 */
function dopasuj(slowo, slowaTekstu, calyTekst) {
  const s = uprosc(slowo);
  if (!s || s.length < 3) return 0;
  if (s.includes(' ')) return calyTekst.includes(s) ? s.length : 0;   // fraza
  for (const w of slowaTekstu) {
    if (s.length === 3 ? w === s : w.startsWith(s)) return s.length;
  }
  return 0;
}

/**
 * Rozpoznaj temat z tego, jak człowiek go opisał.
 *
 * Zwraca wpis ze słownika albo — gdy nic nie pasuje — wpis ZGADYWANY
 * o neutralnych ustawieniach. Nigdy `null` dla niepustego tekstu: lista jest
 * otwarta z założenia, więc „fotografuję pociągi" ma dostać sensowną
 * odpowiedź i uczciwe „tego tematu nie znam", a nie odmowę.
 */
function rozpoznajTemat(tekst) {
  const szukane = uprosc(tekst);
  if (!szukane) return null;
  const slowaT = szukane.split(' ').filter(Boolean);

  let najlepszy = null;
  let najlepszyWynik = 0;
  for (const [klucz, t] of Object.entries(TEMATY)) {
    const mocne = (MOCNE[klucz] || []).map(uprosc);
    let wynik = 0;
    for (const slowo of t.slowa) {
      const trafienie = dopasuj(slowo, slowaT, szukane);
      // Słowo przesądzające wygrywa z dłuższym, ale ogólniejszym.
      if (trafienie) wynik = Math.max(wynik, trafienie + (mocne.includes(uprosc(slowo)) ? 20 : 0));
    }
    for (const cz of uprosc(klucz).split(' ')) {
      if (cz.length > 3 && dopasuj(cz, slowaT, szukane)) wynik = Math.max(wynik, cz.length);
    }
    if (wynik > najlepszyWynik) { najlepszyWynik = wynik; najlepszy = { klucz, ...t }; }
  }
  if (najlepszy) return { ...najlepszy, zgadywany: false };

  return {
    klucz: 'inne',
    nazwa: String(tekst).trim().slice(0, 60),
    ruch: 'spacer',
    czasMin: 250,
    ogniskowa: null,
    glebia: 'srednia',
    uwagi: '',
    zgadywany: true,
  };
}

/** Wszystkie tematy pasujące do tekstu — do etykietowania archiwum, gdzie
 *  jeden folder („Wesele nad jeziorem") bywa i ślubem, i jeziorem. */
function tematyZTekstu(tekst) {
  const szukane = uprosc(tekst);
  if (!szukane) return [];
  const slowaT = szukane.split(' ').filter(Boolean);
  const trafione = [];
  for (const [klucz, t] of Object.entries(TEMATY)) {
    if (t.slowa.some((s) => dopasuj(s, slowaT, szukane))) trafione.push(klucz);
  }
  return trafione;
}

/**
 * Kategorie pliku w archiwum — ze ścieżki, nazwy i rozpoznanych obiektów.
 *
 * Skąd to w ogóle wziąć, skoro OneDrive nie ma tagów: z tego, jak człowiek
 * sam nazwał foldery. „2024-08 Bieszczady", „Wesele Kasi", „Ptaki Biebrza" to
 * jest gotowa klasyfikacja, tylko zapisana po ludzku, a nie w metadanych.
 * Do tego dochodzą obiekty wykryte przez zmysły (`obiekty`), jeśli są.
 *
 * To jest przybliżenie i tak trzeba je traktować — dlatego wynik trafia do
 * pola `tematy`, a nie udaje danych z aparatu.
 */
function kategoriePliku({ sciezka = '', nazwa = '', obiekty = [] } = {}) {
  const zrodlo = [sciezka, nazwa, ...(obiekty || [])].join(' ');
  const zTekstu = tematyZTekstu(zrodlo);

  /* Obiekty z YOLO są po angielsku i nie wpadną w polskie słowa kluczowe,
     więc mają własne przełożenie na kategorie. */
  const PO_ANGIELSKU = {
    bird: 'ptaki-w-locie', dog: 'zwierzeta-domowe', cat: 'zwierzeta-domowe',
    horse: 'zwierzeta-dzikie', sheep: 'zwierzeta-dzikie', cow: 'zwierzeta-dzikie',
    elephant: 'zwierzeta-dzikie', bear: 'zwierzeta-dzikie', zebra: 'zwierzeta-dzikie',
    giraffe: 'zwierzeta-dzikie', car: 'pojazdy-statycznie', truck: 'pojazdy-statycznie',
    motorcycle: 'pojazdy-statycznie', bicycle: 'ulica', person: 'portret',
    boat: 'woda-wybrzeze', 'sports ball': 'mecz',
  };
  for (const o of obiekty || []) {
    const k = PO_ANGIELSKU[String(o).toLowerCase()];
    if (k && !zTekstu.includes(k)) zTekstu.push(k);
  }
  return zTekstu;
}

/** Ludzka nazwa kategorii — do pokazania w odpowiedzi. */
function nazwaTematu(klucz) {
  return (TEMATY[klucz] && TEMATY[klucz].nazwa) || klucz;
}

module.exports = { TEMATY, RUCH, rozpoznajTemat, tematyZTekstu, kategoriePliku, nazwaTematu, uprosc };

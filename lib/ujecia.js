/* ============================================================
   Karty ujęć — lista zdjęć do nakręcenia, nie porada o „ładnym kadrze"

   Z trendów GitHuba: **video-shotcraft** (4 tys. ★) — sto kilkadziesiąt „kart
   przepisów" na ujęcia filmowe. Sam zapisałem wtedy, że to TREŚĆ, nie kod,
   i że asystent planu mógłby z niej czerpać w trybie wideo. To jest właśnie to.

   Czego tu NIE ma i dlaczego. Nie kopiujemy cudzej listy — po pierwsze to
   czyjaś praca, po drugie karty pisane pod produkcję filmową („crane down
   over the crowd") są bezużyteczne dla człowieka, który stoi sam z gimbalem
   i jednym korpusem. Bierzemy POMYSŁ: że plan ujęć to lista pozycji do
   odhaczenia, każda z konkretnymi liczbami, a nie akapit o kompozycji.

   Trzy rzeczy odróżniają to od dowolnego poradnika w internecie i wszystkie
   trzy wynikają z tego, co Cosmos już wie:

     1. UJĘCIA SĄ DOBRANE DO TEMATU. Zestaw na wesele to nie jest zestaw na
        wyścig. Kategorie bierzemy z `lib/tematy.js`, tego samego słownika,
        którym przeszukujemy archiwum.
     2. UJĘCIA SĄ FILTROWANE PRZEZ SPRZĘT. Bez drona nie ma ujęć z góry;
        z 24-105 i 70-200 nie ma ujęcia szerokiego na 16 mm. Cosmos mówi
        WPROST, czego nie da się zrobić tym, co masz — zamiast doradzać
        sprzęt, którego nie kupisz przed sobotą.
     3. UJĘCIA MAJĄ LICZBY. Ogniskowa, ruch, wysokość kamery, czas trwania.
        „Zrób detal" to nie jest plan; „85-200 mm, statycznie, 4-6 s" jest.

   Reguła 180° i ekspozycja zostają tam, gdzie były — w `lib/ekspozycja.js`.
   Tutaj jest tylko odpowiedź na pytanie „CO nakręcić", nie „JAK ustawić".
   ============================================================ */

/* Ruch kamery. Nazwy po polsku, bo Marcin nie kręci po angielsku, ale
   z angielskim odpowiednikiem w nawiasie — cała reszta internetu używa tamtych
   i szukanie „jazda w bok" nic nie da, a „tracking shot" da wszystko. */
const RUCH_KAMERY = {
  'statycznie': 'statycznie (na statywie albo na czymś stabilnym)',
  'panorama': 'powolna panorama w poziomie (pan)',
  'odchylenie': 'odchylenie w pionie (tilt)',
  'jazda-bok': 'jazda w bok, równolegle do obiektu (tracking)',
  'jazda-przod': 'najazd do przodu (push in)',
  'jazda-tyl': 'odjazd do tyłu (pull out)',
  'zza-ramienia': 'zza ramienia bohatera (over the shoulder)',
  'z-reki': 'z ręki, świadomie niespokojnie (handheld)',
  'orbita': 'okrążenie obiektu (orbit)',
  'z-gory': 'z góry, z drona',
  'przelot': 'przelot dronem nad sceną albo obok niej',
};

/* Czego ujęcie WYMAGA. Sprawdzane wprost przeciw zestawowi sprzętu, bo
   „poradzę ci przelot dronem" komuś, kto drona nie ma, to nie jest porada. */
const POTRZEBUJE = {
  dron: 'drona',
  gimbal: 'gimbala albo stabilizacji w korpusie',
  statyw: 'statywu',
  slider: 'slidera albo gładkiej powierzchni do przesuwu',
};

/** Jedna karta ujęcia.
 *  `ogniskowa` to zakres, w którym to ujęcie ma sens — jeśli żadne szkło
 *  z zestawu w niego nie wchodzi, ujęcie wypada z listy z podaniem powodu. */
const UJECIA = {
  // ---------------------------------------------------------- podstawa
  'ustalajace': {
    nazwa: 'ujęcie ustalające',
    poCo: 'mówi widzowi, GDZIE jesteśmy. Bez niego każde następne ujęcie wisi w próżni.',
    ogniskowa: [14, 35], ruch: 'statycznie', sekund: [5, 8],
    jak: 'Szeroko, cała scena w kadrze, horyzont prosty. Jeśli coś się w kadrze rusza '
      + '(ludzie, woda, chmury) — trzymaj dłużej, obraz sam się ożywi.',
  },
  'sredni': {
    nazwa: 'plan średni',
    poCo: 'łącznik między szerokim a detalem — pokazuje, CO się dzieje.',
    ogniskowa: [35, 85], ruch: 'statycznie', sekund: [4, 6],
    jak: 'Postać od pasa w górę albo obiekt z niewielkim otoczeniem. To ujęcie, '
      + 'którego w montażu zawsze brakuje, więc nakręć go więcej niż myślisz.',
  },
  'detal': {
    nazwa: 'detal',
    poCo: 'ratuje montaż. Każdą przeskoczkę i każdy błąd ciągłości da się zakryć detalem.',
    ogniskowa: [50, 200], ruch: 'statycznie', sekund: [3, 5],
    jak: 'Ręce, oczy, faktura, napis, przedmiot. Otwórz przysłonę — rozmyte tło '
      + 'od razu oddziela detal od bałaganu za nim.',
  },
  'przebitka': {
    nazwa: 'przebitka (cutaway)',
    poCo: 'to, na co bohater patrzy albo co jest obok. Bez przebitek montaż jest sztywny.',
    ogniskowa: [35, 200], ruch: 'statycznie', sekund: [3, 5],
    jak: 'Nakręć minimum pięć, nawet jeśli teraz nie wiesz, do czego. Kosztują '
      + 'kilkanaście sekund karty, a w montażu są warte pół dnia dokrętek.',
  },

  // ---------------------------------------------------------- ruch
  'najazd': {
    nazwa: 'najazd (push in)',
    poCo: 'skupia uwagę i buduje napięcie — kadr się zacieśnia, widz się pochyla.',
    ogniskowa: [24, 85], ruch: 'jazda-przod', sekund: [5, 8],
    potrzebuje: ['gimbal'],
    jak: 'Idź krokiem od pięty, nie zoomuj. Zoom to nie jest najazd — przy zoomie '
      + 'perspektywa stoi w miejscu i widać, że to sztuczka.',
  },
  'jazda-rownolegle': {
    nazwa: 'jazda w bok',
    poCo: 'oddaje ruch bohatera i pokazuje głębię — przednie plany przesuwają się '
      + 'szybciej niż tło.',
    ogniskowa: [24, 70], ruch: 'jazda-bok', sekund: [5, 10],
    potrzebuje: ['gimbal'],
    jak: 'Ustaw coś BLISKO obiektywu, w pierwszym planie. Bez tego jazda wygląda '
      + 'jak statyczne ujęcie z drgającym kadrem.',
  },
  'orbita': {
    nazwa: 'okrążenie',
    poCo: 'pokazuje obiekt ze wszystkich stron w jednym cięciu.',
    ogniskowa: [24, 50], ruch: 'orbita', sekund: [6, 12],
    potrzebuje: ['gimbal'],
    jak: 'Stały promień i stała prędkość. Najczęstszy błąd to przyspieszanie '
      + 'w połowie łuku, bo nogi same idą szybciej.',
  },

  // ---------------------------------------------------------- dron
  'z-gory-plaskie': {
    nazwa: 'kadr z góry (prosto w dół)',
    poCo: 'zamienia scenę w grafikę — drogi, pola, plaża, tłum stają się wzorem.',
    ogniskowa: [24, 24], ruch: 'z-gory', sekund: [5, 8],
    potrzebuje: ['dron'],
    jak: 'Kamera dokładnie 90° w dół, wysokość 40-100 m. Powolny obrót wokół osi '
      + 'wygląda tu lepiej niż przelot.',
  },
  'przelot-odslona': {
    nazwa: 'przelot z odsłonięciem',
    poCo: 'najmocniejsze otwarcie, jakie ma dron: zza drzewa/skały wyłania się scena.',
    ogniskowa: [24, 24], ruch: 'przelot', sekund: [6, 10],
    potrzebuje: ['dron'],
    jak: 'Start nisko za przeszkodą, lot do przodu z powolnym podniesieniem kamery. '
      + 'Przeszkoda musi być BLISKO — z dziesięciu metrów efekt znika.',
  },

  // ---------------------------------------------------------- ludzie
  'zza-ramienia': {
    nazwa: 'zza ramienia',
    poCo: 'wciąga widza w rozmowę — patrzy oczami jednej ze stron.',
    ogniskowa: [50, 105], ruch: 'zza-ramienia', sekund: [5, 10],
    jak: 'Ramię ostro na krawędzi kadru, twarz rozmówcy w tercji. Nakręć obie strony, '
      + 'inaczej rozmowy nie zmontujesz.',
  },
  'portret-wideo': {
    nazwa: 'portret w ruchu',
    poCo: 'twarz z reakcją — to z tego zbudujesz emocję całego materiału.',
    ogniskowa: [50, 135], ruch: 'statycznie', sekund: [6, 12],
    jak: 'Otwórz przysłonę, oko w górnej tercji, zostaw miejsce w kierunku spojrzenia. '
      + 'Kręć DŁUŻEJ, niż wydaje się potrzebne — najlepsza reakcja przychodzi, '
      + 'gdy człowiek zapomni o kamerze.',
  },

  // ---------------------------------------------------------- przyroda
  'uplyw-czasu': {
    nazwa: 'upływ czasu w kadrze',
    poCo: 'chmury, woda, tłum — ruch, którego oko nie zauważa, a kamera tak.',
    ogniskowa: [14, 70], ruch: 'statycznie', sekund: [15, 40],
    potrzebuje: ['statyw'],
    jak: 'Kadr bez ludzi wchodzących w pierwszy plan, statyw obciążony. Nakręć '
      + 'MINIMUM 15 sekund — z krótszego materiału nie zrobisz przyspieszenia.',
  },
  'tele-sprasowane': {
    nazwa: 'spłaszczony plan teleobiektywem',
    poCo: 'grzbiety gór, rzędy drzew i warstwy mgły nakładają się na siebie jak kulisy.',
    ogniskowa: [135, 400], ruch: 'statycznie', sekund: [5, 8],
    jak: 'Im dalej stoisz, tym mocniejszy efekt. To jest ujęcie, dla którego warto '
      + 'przejść kilometr w drugą stronę.',
  },

  // ---------------------------------------------------------- tempo
  'szybki-obiekt': {
    nazwa: 'obiekt przelatujący przez kadr',
    poCo: 'oddaje PRĘDKOŚĆ — nieruchoma kamera i coś, co znika w ułamku sekundy.',
    ogniskowa: [70, 300], ruch: 'statycznie', sekund: [3, 5],
    jak: 'Kamera nieruchomo, obiekt wpada i wypada z kadru. Nie prowadź go — '
      + 'prowadzenie zabija wrażenie prędkości, bo tło przestaje uciekać.',
  },
  'prowadzenie': {
    nazwa: 'prowadzenie obiektu (panning)',
    poCo: 'obiekt ostry, tło rozmyte smugą — klasyka wyścigu.',
    ogniskowa: [70, 300], ruch: 'panorama', sekund: [4, 6],
    jak: 'Obracaj się w biodrach, nie w rękach, i nie zatrzymuj po przejeździe. '
      + 'Przy wideo trzymaj czas z reguły 180°, smuga zrobi się sama.',
  },
};

/* Zestaw ujęć na temat. To jest właściwa treść tego modułu: KTÓRE karty
   i W JAKIEJ KOLEJNOŚCI składają się na kompletny materiał z takiego dnia.
   Kolejność jest kolejnością KRĘCENIA, nie montażu — ustalające najpierw,
   bo światło z niego ucieka najszybciej, a detale zrobisz o każdej porze. */
const ZESTAWY = {
  'ptaki-w-locie': ['ustalajace', 'tele-sprasowane', 'szybki-obiekt', 'prowadzenie', 'detal'],
  'zwierzeta-dzikie': ['ustalajace', 'tele-sprasowane', 'sredni', 'detal', 'przebitka'],
  'zwierzeta-domowe': ['sredni', 'detal', 'jazda-rownolegle', 'portret-wideo', 'przebitka'],
  'wyscig': ['ustalajace', 'prowadzenie', 'szybki-obiekt', 'detal', 'przebitka'],
  'pojazdy-statycznie': ['ustalajace', 'orbita', 'detal', 'najazd', 'jazda-rownolegle'],
  'ulica': ['ustalajace', 'sredni', 'detal', 'przebitka', 'jazda-rownolegle'],
  'portret': ['portret-wideo', 'sredni', 'detal', 'najazd', 'przebitka'],
  'sesja-moda': ['ustalajace', 'sredni', 'portret-wideo', 'detal', 'orbita'],
  'ludzie-w-ruchu': ['ustalajace', 'jazda-rownolegle', 'sredni', 'detal', 'szybki-obiekt'],
  'koncert': ['ustalajace', 'sredni', 'portret-wideo', 'detal', 'przebitka'],
  'mecz': ['ustalajace', 'prowadzenie', 'szybki-obiekt', 'portret-wideo', 'przebitka'],
  'slub': ['ustalajace', 'sredni', 'portret-wideo', 'zza-ramienia', 'detal', 'przebitka'],
  'wydarzenie-rodzinne': ['ustalajace', 'sredni', 'portret-wideo', 'detal', 'przebitka'],
  'krajobraz': ['ustalajace', 'tele-sprasowane', 'uplyw-czasu', 'przelot-odslona', 'detal'],
  'gory': ['ustalajace', 'tele-sprasowane', 'uplyw-czasu', 'przelot-odslona', 'detal'],
  'las': ['ustalajace', 'jazda-rownolegle', 'detal', 'tele-sprasowane', 'przebitka'],
  'woda-wybrzeze': ['ustalajace', 'uplyw-czasu', 'z-gory-plaskie', 'detal', 'przelot-odslona'],
  'jezioro': ['ustalajace', 'z-gory-plaskie', 'uplyw-czasu', 'detal', 'przelot-odslona'],
  'kanion-klif': ['ustalajace', 'przelot-odslona', 'tele-sprasowane', 'z-gory-plaskie', 'detal'],
  'architektura': ['ustalajace', 'najazd', 'detal', 'orbita', 'tele-sprasowane'],
  'noc-gwiazdy': ['ustalajace', 'uplyw-czasu', 'tele-sprasowane', 'detal'],
  'makro': ['detal', 'sredni', 'najazd', 'przebitka'],
};

// Gdy tematu nie znamy — zestaw, który ratuje każdy materiał.
const ZESTAW_DOMYSLNY = ['ustalajace', 'sredni', 'detal', 'przebitka', 'najazd'];

/** Czy zestaw szkła obejmuje choć kawałek zakresu ujęcia? */
function ktoreSzklo(obiektywy, [od, doO]) {
  for (const o of obiektywy || []) {
    if (!o || !Number.isFinite(o.od)) continue;
    if (o.od <= doO && o.do >= od) return o;
  }
  return null;
}

/** Ogniskowa, którą realnie ustawisz: środek części wspólnej zakresów. */
function ogniskowaDla(szklo, [od, doO]) {
  if (!szklo) return Math.round((od + doO) / 2);
  const a = Math.max(od, szklo.od);
  const b = Math.min(doO, szklo.do);
  return Math.round((a + b) / 2);
}

/**
 * Lista ujęć na dzisiejszy temat, przefiltrowana przez posiadany sprzęt.
 *
 * @param {object} o
 * @param {string}  o.temat      klucz z lib/tematy.js (albo null)
 * @param {Array}   o.obiektywy  wynik `rozpoznajObiektywy()` — [{od, do, jasnosc}]
 * @param {boolean} o.dron       czy w zestawie jest dron
 * @param {boolean} o.gimbal     czy jest gimbal albo stabilizacja
 * @param {boolean} o.statyw     czy jest statyw
 * @param {number}  o.ile        ile pozycji zwrócić (domyślnie wszystkie z zestawu)
 *
 * @returns {{ujecia: Array, pominiete: Array}} — POMINIĘTE też oddajemy,
 *   i to jest ważne. „Nie ma na liście przelotu dronem" i „nie masz drona"
 *   to dla człowieka planującego dzień dwie różne informacje, a bez tej
 *   drugiej wygląda to, jakby Cosmos o dronie zapomniał.
 */
function planUjec(o = {}) {
  const klucze = ZESTAWY[o.temat] || ZESTAW_DOMYSLNY;
  const mam = {
    dron: Boolean(o.dron),
    gimbal: Boolean(o.gimbal),
    statyw: Boolean(o.statyw),
    slider: Boolean(o.slider),
  };
  const obiektywy = Array.isArray(o.obiektywy) ? o.obiektywy : [];

  const ujecia = [];
  const pominiete = [];

  for (const klucz of klucze) {
    const u = UJECIA[klucz];
    if (!u) continue;

    const brakSprzetu = (u.potrzebuje || []).filter((p) => !mam[p]);
    if (brakSprzetu.length) {
      pominiete.push({
        klucz, nazwa: u.nazwa,
        powod: `wymaga ${brakSprzetu.map((p) => POTRZEBUJE[p]).join(' i ')}`,
      });
      continue;
    }

    /* Sprzęt sprawdzamy tylko wtedy, gdy WIEMY, jakie są obiektywy. Pusta
       lista znaczy „nie podał", a nie „nie ma żadnego" — odrzucenie wszystkich
       ujęć na tej podstawie byłoby najgorszą możliwą odpowiedzią. */
    const szklo = obiektywy.length ? ktoreSzklo(obiektywy, u.ogniskowa) : null;
    if (obiektywy.length && !szklo) {
      pominiete.push({
        klucz, nazwa: u.nazwa,
        powod: `potrzebuje ${u.ogniskowa[0]}-${u.ogniskowa[1]} mm, a Twoje szkła tego nie obejmują`,
      });
      continue;
    }

    ujecia.push({
      klucz,
      nazwa: u.nazwa,
      poCo: u.poCo,
      ogniskowa: ogniskowaDla(szklo, u.ogniskowa),
      zakres: u.ogniskowa,
      ruch: RUCH_KAMERY[u.ruch] || u.ruch,
      sekund: u.sekund,
      jak: u.jak,
      naSzkle: szklo ? `${szklo.od}-${szklo.do} f/${szklo.jasnosc}` : null,
    });
  }

  const ile = Number(o.ile);
  return {
    ujecia: ile > 0 ? ujecia.slice(0, ile) : ujecia,
    pominiete,
  };
}

module.exports = { UJECIA, ZESTAWY, RUCH_KAMERY, POTRZEBUJE, planUjec };

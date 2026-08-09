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

/* ------------------------------------------------------------------
   OPTYKA DRONA to NIE są obiektywy od korpusu

   Marcin, patrząc na gotową listę: „martwi mnie ujęcie z przelotem, gdzie
   jest wskazane 24-105 f/4, a przecież to obiektyw na moim Canonie, a nie
   w dronie Mavic 3". Święta racja i to była prawdziwa usterka: dobór szkła
   szedł po JEDNEJ liście dla wszystkich ujęć, więc kadr z drona dostawał
   szkło z aparatu. Liczba 24 mm nawet się zgadzała — Mavic 3 ma 24 mm
   ekwiwalentu — ale zgadzała się przez przypadek, bo tyle wyszło z przycięcia
   zakresu do 24-105. Przy innym zestawie wyszłoby cokolwiek.

   Rada oparta na sprzęcie, którego nie da się zamontować, podważa całą resztę
   listy: skoro to jest nieprawda, to co jeszcze?
   ------------------------------------------------------------------ */
const OPTYKA_DRONOW = {
  // Mavic 3 (nie Enterprise): Hasselblad 4/3 24 mm + teleobiektyw 162 mm.
  'mavic-3': {
    nazwa: 'DJI Mavic 3',
    wzorzec: /\bmavic\s*3\b/i,
    szkla: [
      { od: 24, do: 24, jasnosc: 2.8, nazwa: 'Hasselblad 24 mm' },
      { od: 162, do: 162, jasnosc: 4.4, nazwa: 'tele 162 mm' },
    ],
  },
  'mavic-2': {
    nazwa: 'DJI Mavic 2',
    wzorzec: /\bmavic\s*2\b/i,
    szkla: [{ od: 28, do: 28, jasnosc: 2.8, nazwa: 'kamera 28 mm' }],
  },
  'mini': {
    nazwa: 'DJI Mini / Air',
    wzorzec: /\b(mini\s*[2-5]|air\s*[23]|avata)\b/i,
    szkla: [{ od: 24, do: 24, jasnosc: 1.7, nazwa: 'kamera 24 mm' }],
  },
};

/* Nieznany dron: zakładamy szeroki kadr około 24 mm, bo tak ma większość
   konsumenckich maszyn — i mówimy WPROST, że to założenie, przez nazwę. */
const OPTYKA_DRONA_DOMYSLNA = {
  nazwa: 'dron',
  szkla: [{ od: 24, do: 24, jasnosc: 2.8, nazwa: 'kamera drona (zakładam ok. 24 mm)' }],
};

/** Optyka drona rozpoznana z opisu sprzętu („DJI Mavic 3, Ronin-S, statyw"). */
function optykaDrona(tekst) {
  const s = String(tekst || '');
  for (const d of Object.values(OPTYKA_DRONOW)) {
    if (d.wzorzec.test(s)) return d;
  }
  return OPTYKA_DRONA_DOMYSLNA;
}

/* ------------------------------------------------------------------
   ROLA UJĘCIA W MATERIALE

   Druga uwaga Marcina z tej samej listy: „nie daje np. ujęć kończących,
   a na tej liście jest też kilka otwarć". Też racja. Zestaw na góry dawał
   ujęcie ustalające ORAZ przelot z odsłonięciem — oba opisane jako otwarcie
   — i ani jednego domknięcia. Materiał zmontowany z takiej listy zaczyna
   się dwa razy i nie kończy wcale.

   Stąd `rola` przy każdej karcie i twarda zasada w `planUjec`: na liście
   ZAWSZE jest przynajmniej jedno domknięcie. Kolejność wyjścia to
   otwarcie → rozwinięcie → domknięcie, bo tak się to potem montuje,
   a przy kręceniu i tak najpierw łapie się to, czemu ucieka światło.
   ------------------------------------------------------------------ */
const ROLE = {
  otwarcie: 'otwarcie',
  rozwiniecie: 'rozwinięcie',
  domkniecie: 'domknięcie',
};

/** Jedna karta ujęcia.
 *  `ogniskowa` to zakres, w którym to ujęcie ma sens — jeśli żadne szkło
 *  z zestawu w niego nie wchodzi, ujęcie wypada z listy z podaniem powodu. */
const UJECIA = {
  // ---------------------------------------------------------- podstawa
  'ustalajace': {
    rola: 'otwarcie',
    nazwa: 'ujęcie ustalające',
    poCo: 'mówi widzowi, GDZIE jesteśmy. Bez niego każde następne ujęcie wisi w próżni.',
    ogniskowa: [14, 35], ruch: 'statycznie', sekund: [5, 8],
    jak: 'Szeroko, cała scena w kadrze, horyzont prosty. Jeśli coś się w kadrze rusza '
      + '(ludzie, woda, chmury) — trzymaj dłużej, obraz sam się ożywi.',
  },
  'sredni': {
    rola: 'rozwiniecie',
    nazwa: 'plan średni',
    poCo: 'łącznik między szerokim a detalem — pokazuje, CO się dzieje.',
    ogniskowa: [35, 85], ruch: 'statycznie', sekund: [4, 6],
    jak: 'Postać od pasa w górę albo obiekt z niewielkim otoczeniem. To ujęcie, '
      + 'którego w montażu zawsze brakuje, więc nakręć go więcej niż myślisz.',
  },
  'detal': {
    rola: 'rozwiniecie',
    nazwa: 'detal',
    poCo: 'ratuje montaż. Każdą przeskoczkę i każdy błąd ciągłości da się zakryć detalem.',
    ogniskowa: [50, 200], ruch: 'statycznie', sekund: [3, 5],
    jak: 'Ręce, oczy, faktura, napis, przedmiot. Otwórz przysłonę — rozmyte tło '
      + 'od razu oddziela detal od bałaganu za nim.',
  },
  'przebitka': {
    rola: 'rozwiniecie',
    nazwa: 'przebitka (cutaway)',
    poCo: 'to, na co bohater patrzy albo co jest obok. Bez przebitek montaż jest sztywny.',
    ogniskowa: [35, 200], ruch: 'statycznie', sekund: [3, 5],
    jak: 'Nakręć minimum pięć, nawet jeśli teraz nie wiesz, do czego. Kosztują '
      + 'kilkanaście sekund karty, a w montażu są warte pół dnia dokrętek.',
  },

  // ---------------------------------------------------------- ruch
  'najazd': {
    rola: 'rozwiniecie',
    nazwa: 'najazd (push in)',
    poCo: 'skupia uwagę i buduje napięcie — kadr się zacieśnia, widz się pochyla.',
    ogniskowa: [24, 85], ruch: 'jazda-przod', sekund: [5, 8],
    potrzebuje: ['gimbal'],
    jak: 'Idź krokiem od pięty, nie zoomuj. Zoom to nie jest najazd — przy zoomie '
      + 'perspektywa stoi w miejscu i widać, że to sztuczka.',
  },
  'jazda-rownolegle': {
    rola: 'rozwiniecie',
    nazwa: 'jazda w bok',
    poCo: 'oddaje ruch bohatera i pokazuje głębię — przednie plany przesuwają się '
      + 'szybciej niż tło.',
    ogniskowa: [24, 70], ruch: 'jazda-bok', sekund: [5, 10],
    potrzebuje: ['gimbal'],
    jak: 'Ustaw coś BLISKO obiektywu, w pierwszym planie. Bez tego jazda wygląda '
      + 'jak statyczne ujęcie z drgającym kadrem.',
  },
  'orbita': {
    rola: 'rozwiniecie',
    nazwa: 'okrążenie',
    poCo: 'pokazuje obiekt ze wszystkich stron w jednym cięciu.',
    ogniskowa: [24, 50], ruch: 'orbita', sekund: [6, 12],
    potrzebuje: ['gimbal'],
    jak: 'Stały promień i stała prędkość. Najczęstszy błąd to przyspieszanie '
      + 'w połowie łuku, bo nogi same idą szybciej.',
  },

  // ---------------------------------------------------------- dron
  'z-gory-plaskie': {
    /* NIE otwarcie, choć kusi. Kadr prosto w dół zamienia scenę w abstrakcję
       i właśnie dlatego nie mówi widzowi, GDZIE jest — a od tego jest
       otwarcie. To beat graficzny w środku materiału. Zaklasyfikowanie go
       jako otwarcia dawało zestawy z trzema otwarciami i zero domknięć. */
    rola: 'rozwiniecie',
    nazwa: 'kadr z góry (prosto w dół)',
    poCo: 'zamienia scenę w grafikę — drogi, pola, plaża, tłum stają się wzorem.',
    ogniskowa: [24, 24], ruch: 'z-gory', sekund: [5, 8],
    potrzebuje: ['dron'],
    jak: 'Kamera dokładnie 90° w dół, wysokość 40-100 m. Powolny obrót wokół osi '
      + 'wygląda tu lepiej niż przelot.',
  },
  'przelot-odslona': {
    rola: 'otwarcie',
    nazwa: 'przelot z odsłonięciem',
    poCo: 'najmocniejsze otwarcie, jakie ma dron: zza drzewa/skały wyłania się scena.',
    ogniskowa: [24, 24], ruch: 'przelot', sekund: [6, 10],
    potrzebuje: ['dron'],
    jak: 'Start nisko za przeszkodą, lot do przodu z powolnym podniesieniem kamery. '
      + 'Przeszkoda musi być BLISKO — z dziesięciu metrów efekt znika.',
  },

  // ---------------------------------------------------------- ludzie
  'zza-ramienia': {
    rola: 'rozwiniecie',
    nazwa: 'zza ramienia',
    poCo: 'wciąga widza w rozmowę — patrzy oczami jednej ze stron.',
    ogniskowa: [50, 105], ruch: 'zza-ramienia', sekund: [5, 10],
    jak: 'Ramię ostro na krawędzi kadru, twarz rozmówcy w tercji. Nakręć obie strony, '
      + 'inaczej rozmowy nie zmontujesz.',
  },
  'portret-wideo': {
    rola: 'rozwiniecie',
    nazwa: 'portret w ruchu',
    poCo: 'twarz z reakcją — to z tego zbudujesz emocję całego materiału.',
    ogniskowa: [50, 135], ruch: 'statycznie', sekund: [6, 12],
    jak: 'Otwórz przysłonę, oko w górnej tercji, zostaw miejsce w kierunku spojrzenia. '
      + 'Kręć DŁUŻEJ, niż wydaje się potrzebne — najlepsza reakcja przychodzi, '
      + 'gdy człowiek zapomni o kamerze.',
  },

  // ---------------------------------------------------------- przyroda
  'uplyw-czasu': {
    rola: 'rozwiniecie',
    nazwa: 'upływ czasu w kadrze',
    poCo: 'chmury, woda, tłum — ruch, którego oko nie zauważa, a kamera tak.',
    ogniskowa: [14, 70], ruch: 'statycznie', sekund: [15, 40],
    potrzebuje: ['statyw'],
    jak: 'Kadr bez ludzi wchodzących w pierwszy plan, statyw obciążony. Nakręć '
      + 'MINIMUM 15 sekund — z krótszego materiału nie zrobisz przyspieszenia.',
  },
  'tele-sprasowane': {
    rola: 'rozwiniecie',
    nazwa: 'spłaszczony plan teleobiektywem',
    poCo: 'grzbiety gór, rzędy drzew i warstwy mgły nakładają się na siebie jak kulisy.',
    ogniskowa: [135, 400], ruch: 'statycznie', sekund: [5, 8],
    jak: 'Im dalej stoisz, tym mocniejszy efekt. To jest ujęcie, dla którego warto '
      + 'przejść kilometr w drugą stronę.',
  },

  // ---------------------------------------------------------- tempo
  'szybki-obiekt': {
    rola: 'rozwiniecie',
    nazwa: 'obiekt przelatujący przez kadr',
    poCo: 'oddaje PRĘDKOŚĆ — nieruchoma kamera i coś, co znika w ułamku sekundy.',
    ogniskowa: [70, 300], ruch: 'statycznie', sekund: [3, 5],
    jak: 'Kamera nieruchomo, obiekt wpada i wypada z kadru. Nie prowadź go — '
      + 'prowadzenie zabija wrażenie prędkości, bo tło przestaje uciekać.',
  },
  // ---------------------------------------------------------- domknięcia
  /* Tych trzech kart nie było w katalogu w ogóle — i to jest dokładnie ten
     rodzaj braku, którego nie widać, dopóki ktoś nie spojrzy na gotową listę
     i nie zapyta „a gdzie koniec?". Materiał bez domknięcia po prostu się
     urywa, a widz to czuje, nawet jeśli nie umie nazwać. */
  'domkniecie-odejscie': {
    rola: 'domkniecie',
    nazwa: 'wyjście z kadru',
    poCo: 'zamyka scenę bez montażowej sztuczki — coś było, wyszło, kadr zostaje pusty.',
    ogniskowa: [24, 85], ruch: 'statycznie', sekund: [6, 12],
    jak: 'Kamera stoi, bohater (albo pojazd, albo zwierzę) wychodzi z kadru — '
      + 'i TRZYMAJ jeszcze dwie, trzy sekundy po jego zniknięciu. Te dwie sekundy '
      + 'to całe ujęcie; bez nich masz zwykłą przebitkę.',
  },
  'domkniecie-odjazd': {
    rola: 'domkniecie',
    nazwa: 'odjazd na koniec',
    poCo: 'odwrotność otwarcia: scena, którą już znasz, oddala się i robi mała.',
    ogniskowa: [24, 50], ruch: 'jazda-tyl', sekund: [8, 14],
    potrzebuje: ['gimbal'],
    jak: 'Wolno do tyłu, bez zatrzymania na końcu — ruch ma wygasnąć poza cięciem. '
      + 'Jeśli masz drona, to samo zrobisz wznosem; z ręki idź krokiem od pięty.',
  },
  'domkniecie-wygaszenie': {
    rola: 'domkniecie',
    nazwa: 'ostatni kadr, który sam gaśnie',
    poCo: 'kończy materiał obrazem, nie napisem — ostatnie światło, mgła, woda, dym.',
    ogniskowa: [24, 200], ruch: 'statycznie', sekund: [8, 15],
    jak: 'Coś, co zmienia się samo i powoli: gasnące niebo, para nad kubkiem, '
      + 'fala cofająca się z piasku. Kręć DŁUGO — z tego ujęcia bierze się '
      + 'ostatnie dziesięć sekund, pod które podłożysz muzykę i napisy.',
  },
  'domkniecie-z-gory': {
    rola: 'domkniecie',
    nazwa: 'wznos na koniec',
    poCo: 'najprostsze mocne zakończenie, jakie ma dron — scena znika pod maszyną.',
    ogniskowa: [24, 24], ruch: 'z-gory', sekund: [8, 14],
    potrzebuje: ['dron'],
    jak: 'Start nad sceną, powolny wznos z lekkim odchyleniem kamery w dół. '
      + 'Bez ruchu w bok — pion czyta się jako „koniec", ukos jako „lecimy dalej".',
  },

  'prowadzenie': {
    rola: 'rozwiniecie',
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
  'ptaki-w-locie': ['ustalajace', 'tele-sprasowane', 'szybki-obiekt', 'prowadzenie', 'detal', 'domkniecie-wygaszenie'],
  'zwierzeta-dzikie': ['ustalajace', 'tele-sprasowane', 'sredni', 'detal', 'przebitka', 'domkniecie-odejscie'],
  'zwierzeta-domowe': ['sredni', 'detal', 'jazda-rownolegle', 'portret-wideo', 'przebitka', 'domkniecie-odejscie'],
  'wyscig': ['ustalajace', 'prowadzenie', 'szybki-obiekt', 'detal', 'przebitka', 'domkniecie-odejscie'],
  'pojazdy-statycznie': ['ustalajace', 'orbita', 'detal', 'najazd', 'jazda-rownolegle', 'domkniecie-odjazd'],
  'ulica': ['ustalajace', 'sredni', 'detal', 'przebitka', 'jazda-rownolegle', 'domkniecie-wygaszenie'],
  'portret': ['portret-wideo', 'sredni', 'detal', 'najazd', 'przebitka', 'domkniecie-odejscie'],
  'sesja-moda': ['ustalajace', 'sredni', 'portret-wideo', 'detal', 'orbita', 'domkniecie-odejscie'],
  'ludzie-w-ruchu': ['ustalajace', 'jazda-rownolegle', 'sredni', 'detal', 'szybki-obiekt', 'domkniecie-odejscie'],
  'koncert': ['ustalajace', 'sredni', 'portret-wideo', 'detal', 'przebitka', 'domkniecie-wygaszenie'],
  'mecz': ['ustalajace', 'prowadzenie', 'szybki-obiekt', 'portret-wideo', 'przebitka', 'domkniecie-wygaszenie'],
  'slub': ['ustalajace', 'sredni', 'portret-wideo', 'zza-ramienia', 'detal', 'przebitka', 'domkniecie-odejscie'],
  'wydarzenie-rodzinne': ['ustalajace', 'sredni', 'portret-wideo', 'detal', 'przebitka', 'domkniecie-odejscie'],
  'krajobraz': ['ustalajace', 'tele-sprasowane', 'uplyw-czasu', 'przelot-odslona', 'detal', 'domkniecie-z-gory'],
  'gory': ['ustalajace', 'tele-sprasowane', 'uplyw-czasu', 'przelot-odslona', 'detal', 'domkniecie-z-gory'],
  'las': ['ustalajace', 'jazda-rownolegle', 'detal', 'tele-sprasowane', 'przebitka', 'domkniecie-wygaszenie'],
  'woda-wybrzeze': ['ustalajace', 'uplyw-czasu', 'z-gory-plaskie', 'detal', 'przelot-odslona', 'domkniecie-wygaszenie'],
  'jezioro': ['ustalajace', 'z-gory-plaskie', 'uplyw-czasu', 'detal', 'przelot-odslona', 'domkniecie-z-gory'],
  'kanion-klif': ['ustalajace', 'przelot-odslona', 'tele-sprasowane', 'z-gory-plaskie', 'detal', 'domkniecie-z-gory'],
  'architektura': ['ustalajace', 'najazd', 'detal', 'orbita', 'tele-sprasowane', 'domkniecie-odjazd'],
  'noc-gwiazdy': ['ustalajace', 'uplyw-czasu', 'tele-sprasowane', 'detal', 'domkniecie-wygaszenie'],
  'makro': ['detal', 'sredni', 'najazd', 'przebitka', 'domkniecie-wygaszenie'],
};

// Gdy tematu nie znamy — zestaw, który ratuje każdy materiał.
const ZESTAW_DOMYSLNY = ['ustalajace', 'sredni', 'detal', 'przebitka', 'najazd', 'domkniecie-odejscie'];

/** Jak nazwać szkło na liście ujęć.
 *
 *  Nazwa własna, gdy ją znamy („Hasselblad 24 mm"), bo przy dronie
 *  „24-24 f/2.8" nic nikomu nie mówi i wygląda jak usterka. Ale obiektywy
 *  z `rozpoznajObiektywy` mają jasność JUŻ w nazwie („70-200 f/4"), więc
 *  doklejenie jej po raz drugi dawało „70-200 f/4 f/4" — widać to było na
 *  zrzucie ekranu, nie w żadnym teście. */
function nazwijSzklo(s) {
  if (!s.nazwa) return `${s.od}-${s.do} f/${s.jasnosc}`;
  return /f\/\d/.test(s.nazwa) ? s.nazwa : `${s.nazwa} f/${s.jasnosc}`;
}

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
  const dron = o.optykaDrona || OPTYKA_DRONA_DOMYSLNA;

  const ujecia = [];
  const pominiete = [];

  /** Zbuduj kartę albo powiedz, czemu wypada. `null` = wypadła. */
  function rozwaz(klucz) {
    const u = UJECIA[klucz];
    if (!u) return null;

    const brakSprzetu = (u.potrzebuje || []).filter((p) => !mam[p]);
    if (brakSprzetu.length) {
      pominiete.push({
        klucz, nazwa: u.nazwa,
        powod: `wymaga ${brakSprzetu.map((p) => POTRZEBUJE[p]).join(' i ')}`,
      });
      return null;
    }

    /* SKĄD BIERZEMY SZKŁO zależy od tego, CZYM się kręci to ujęcie.
       Kadr z drona idzie na optykę drona, reszta na obiektywy od korpusu.
       Wcześniej wszystko szło po jednej liście i przelot dostawał
       „24-105 f/4" — obiektyw, którego do Mavica nie da się przykręcić. */
    const zDrona = (u.potrzebuje || []).includes('dron');
    const szkla = zDrona ? dron.szkla : obiektywy;

    /* Przy korpusie pusta lista znaczy „nie podał", a nie „nie ma żadnego" —
       odrzucenie wszystkich ujęć na tej podstawie byłoby najgorszą możliwą
       odpowiedzią. Przy dronie takiej niepewności nie ma: skoro ujęcie wymaga
       drona, a dron jest w zestawie, to jego optykę znamy. */
    const szklo = szkla.length ? ktoreSzklo(szkla, u.ogniskowa) : null;
    if (szkla.length && !szklo) {
      pominiete.push({
        klucz,
        nazwa: u.nazwa,
        powod: zDrona
          ? `potrzebuje ${u.ogniskowa[0]}-${u.ogniskowa[1]} mm, a ${dron.nazwa} ma `
            + dron.szkla.map((x) => `${x.od} mm`).join(' i ')
          : `potrzebuje ${u.ogniskowa[0]}-${u.ogniskowa[1]} mm, a Twoje szkła tego nie obejmują`,
      });
      return null;
    }

    return {
      klucz,
      rola: u.rola || 'rozwiniecie',
      rolaOpis: ROLE[u.rola] || ROLE.rozwiniecie,
      nazwa: u.nazwa,
      poCo: u.poCo,
      ogniskowa: ogniskowaDla(szklo, u.ogniskowa),
      zakres: u.ogniskowa,
      ruch: RUCH_KAMERY[u.ruch] || u.ruch,
      sekund: u.sekund,
      jak: u.jak,
      naSzkle: szklo ? nazwijSzklo(szklo) : null,
      zDrona,
    };
  }

  for (const klucz of klucze) {
    const karta = rozwaz(klucz);
    if (karta) ujecia.push(karta);
  }

  /* DOMKNIĘCIE JEST OBOWIĄZKOWE. Zestaw na góry kończył się „detalem", bo
     jedyne domknięcie w zestawie wymagało drona i wypadło razem z nim.
     Lista bez zakończenia to lista, z której zmontuje się materiał urywający
     się w pół zdania — więc gdy domknięcie wypadnie, szukamy zastępczego,
     od najmniej wymagającego. */
  if (!ujecia.some((x) => x.rola === 'domkniecie')) {
    for (const zapas of ['domkniecie-wygaszenie', 'domkniecie-odejscie', 'domkniecie-odjazd']) {
      if (klucze.includes(zapas)) continue;         // już próbowaliśmy, wypadło
      const karta = rozwaz(zapas);
      if (karta) { ujecia.push(karta); break; }
    }
  }

  /* Kolejność: otwarcie → rozwinięcie → domknięcie. Tak się to montuje,
     a przy kręceniu i tak najpierw łapie się to, czemu ucieka światło. */
  const WAGA = { otwarcie: 0, rozwiniecie: 1, domkniecie: 2 };
  ujecia.sort((a, b) => WAGA[a.rola] - WAGA[b.rola]);

  const ile = Number(o.ile);
  return {
    ujecia: ile > 0 ? ujecia.slice(0, ile) : ujecia,
    pominiete,
  };
}

module.exports = {
  UJECIA, ZESTAWY, RUCH_KAMERY, POTRZEBUJE, ROLE, planUjec,
  optykaDrona, OPTYKA_DRONOW, OPTYKA_DRONA_DOMYSLNA,
};

/* ============================================================
   Dobór ekspozycji — czas, przysłona, ISO

   Punktem wyjścia jest EV (wartość ekspozycji) sceny. Wyliczamy go z
   WYSOKOŚCI SŁOŃCA, nie z pory dnia — „18:00" w czerwcu i w grudniu to
   różnica sześciu działek. Gdy przeglądarka poda jasność z podglądu kamery,
   korygujemy tym pomiarem: model nie wie, czy stoisz w cieniu budynku.

   Potem rozwiązujemy trójkąt ekspozycji, ale nie „po równo" — kolejność
   ustępstw zależy od tego, co kręcisz:

     • WIDEO ma czas ZABLOKOWANY regułą 180° (1/(2×klatki)). Zmiana czasu
       psuje płynność ruchu, więc wolno ruszać tylko przysłoną i ISO.
     • ZDJĘCIE ma czas ograniczony od dołu przez poruszenie — własne drgania
       (tu pomaga stabilizacja) i ruch tego, co fotografujesz.

   Zamknięta matematyka, więc liczymy sami — zgodnie z zasadą z README.
   ============================================================ */

const { rozpoznajTemat, RUCH } = require('./tematy.js');

/* Sprzęt Marcina plus wpisy ogólne. Liczby, które naprawdę wpływają na wynik:
   zakres przysłony, sensowny sufit ISO (nie katalogowy — ten, powyżej którego
   materiał robi się nie do użycia) i zapas ze stabilizacji. */
/* `wzorzec` to sposób, w jaki człowiek NAPISZE ten sprzęt, a nie klucz, którym
   nazywamy go w kodzie. Bez tego pola „Canon R6 Mark II" wpisane w Plenerze
   nie trafiało we własny wpis katalogowy: klucz `canon-r6ii` nie jest
   podciągiem napisu „canonr6markii", więc dobór spadał na ogólną klasę
   pełnoklatkową i mówił „Nie mam tego w katalogu" o aparacie, który jest
   w katalogu pierwszy. Kosztowało to działkę stabilizacji i drugi zakres
   wzmocnienia (ISO 800), czyli akurat te dwie liczby, dla których wpis
   katalogowy w ogóle istnieje. */
const SPRZET = {
  'canon-r6ii': {
    nazwa: 'Canon R6 Mark II',
    wzorzec: /\b(canon\s*)?(eos\s*)?r\s?6\s*(mark\s*)?(ii|2|m2)\b/i,
    przyslony: [1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16, 22],
    isoMin: 100,
    isoMax: 12800,        // wyżej daje radę, ale to już ratowanie ujęcia
    isoDrugiZakres: 800,  // druga baza wzmocnienia — tu szum spada
    stabilizacjaEV: 5,    // IBIS: realnie ~5 działek, nie katalogowe 8
    format: 'pełna klatka',
  },
  'mavic-3': {
    nazwa: 'DJI Mavic 3',
    // Mavic 3, 3 Classic, 3 Pro i 3 Cine mają tę samą matrycę 4/3 Hasselblada.
    wzorzec: /\bmavic\s*3\b/i,
    przyslony: [2.8, 4, 5.6, 8, 11],
    isoMin: 100,
    isoMax: 3200,
    isoDrugiZakres: 0,
    // Gimbal tłumi drgania, ale dron leci — to nie to samo co statyw.
    stabilizacjaEV: 2,
    format: '4/3',
    uwaga: 'W locie i tak potrzebny filtr ND, żeby utrzymać regułę 180°.',
  },
  'telefon': {
    nazwa: 'Telefon',
    przyslony: [1.8],
    isoMin: 50,
    isoMax: 3200,
    isoDrugiZakres: 0,
    stabilizacjaEV: 3,
    format: 'mały',
  },
};

/* ------------------------------------------------------------------
   DOWOLNY SPRZĘT, nie tylko ten trzeci wpis wyżej

   Marcin: „tutaj zawsze ten sprzęt mogę zmienić, więc Cosmos musi być do tego
   też przygotowany". Słusznie — katalog z trzema pozycjami działa dokładnie
   do dnia, w którym ktoś weźmie pożyczone body albo kupi innego drona.

   Rozpoznajemy więc KLASĘ sprzętu po nazwie i z niej bierzemy to, co naprawdę
   wpływa na dobór: sufit ISO, zapas ze stabilizacji i mnożnik ogniskowej.
   Klasyfikacja po fragmentach nazw jest przybliżeniem i tak jest oznaczana
   (`zgadywany`) — Cosmos mówi wprost, co założył, zamiast udawać, że zna
   każdy korpus na świecie.
   ------------------------------------------------------------------ */
const KLASY_SPRZETU = {
  'dron': {
    nazwa: 'dron', isoMin: 100, isoMax: 3200, isoDrugiZakres: 0,
    stabilizacjaEV: 2, mnoznik: 2, format: '4/3 lub 1"',
    przyslony: [2.8, 4, 5.6, 8, 11],
    uwaga: 'W locie i tak potrzebny filtr ND, żeby utrzymać regułę 180°.',
  },
  'telefon': {
    nazwa: 'telefon', isoMin: 50, isoMax: 3200, isoDrugiZakres: 0,
    stabilizacjaEV: 3, mnoznik: 1, format: 'mały',
    przyslony: [1.8],
  },
  'aparat-pelna-klatka': {
    nazwa: 'aparat pełnoklatkowy', isoMin: 100, isoMax: 12800, isoDrugiZakres: 0,
    stabilizacjaEV: 4, mnoznik: 1, format: 'pełna klatka',
    przyslony: [1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16, 22],
  },
  'aparat-aps-c': {
    nazwa: 'aparat APS-C', isoMin: 100, isoMax: 6400, isoDrugiZakres: 0,
    stabilizacjaEV: 3, mnoznik: 1.5, format: 'APS-C',
    przyslony: [1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16, 22],
  },
};

const WZORCE_SPRZETU = [
  ['dron', /\b(dji|mavic|avata|inspire|autel|evo\s*ii|dron|drone|air\s*[23]|mini\s*[2-5])\b/i],
  ['telefon', /\b(iphone|pixel|galaxy|samsung|xiaomi|huawei|telefon|smartfon|phone)\b/i],
  ['aparat-aps-c', /\b(a6\d{3}|z\s*50|zfc|r7|r10|r50|r100|x-?[ts]\d|x100|d500|d7\d{3}|aps-?c)\b/i],
  ['aparat-pelna-klatka', /\b(a7|a7r|a7s|a1|a9|z[5-9]\b|z\s*[5-9]|r5|r6|r8|r3\b|s5|sl[23]|lumix\s*s|d8\d0|pełna klatka|full ?frame)\b/i],
];

/** Rozpoznaj sprzęt: z katalogu, a jak nie — z klasy odgadniętej po nazwie. */
function rozpoznajSprzet(tekst) {
  const s = String(tekst || '').trim();
  if (!s) return null;
  const klucz = s.toLowerCase().replace(/[^a-z0-9-]/g, '');
  for (const [k, v] of Object.entries(SPRZET)) {
    if (klucz === k.replace(/[^a-z0-9-]/g, '') || klucz.includes(k.replace(/[^a-z0-9-]/g, ''))) {
      return { ...v, zgadywany: false };
    }
  }
  // Dopiero teraz po nazwie własnej — „Canon R6 Mark II", „EOS R6 II", „Mavic 3 Pro".
  for (const v of Object.values(SPRZET)) {
    if (v.wzorzec && v.wzorzec.test(s)) return { ...v, zgadywany: false };
  }
  for (const [klasa, wzor] of WZORCE_SPRZETU) {
    if (wzor.test(s)) {
      return { ...KLASY_SPRZETU[klasa], nazwa: s.slice(0, 40), klasa, zgadywany: true };
    }
  }
  // Nic nie pasuje: pełna klatka jest najbezpieczniejszym założeniem dla
  // „jakiegoś aparatu", bo nie zawyża ani ogniskowej, ani sufitu ISO.
  return { ...KLASY_SPRZETU['aparat-pelna-klatka'], nazwa: s.slice(0, 40),
    klasa: 'aparat-pelna-klatka', zgadywany: true };
}

// Typowe czasy migawki (mianownik ułamka) — do zaokrąglania do pełnej działki.
const CZASY = [1, 2, 4, 8, 15, 30, 60, 125, 250, 500, 1000, 2000, 4000, 8000];
/* Ekspozycje dłuższe od sekundy. Zapisujemy je tym samym „mianownikiem", więc
   1/30 znaczy 30 sekund — dzięki temu cała reszta rachunku (EV, ISO, różnica)
   działa bez zmian. Bez tej listy Cosmos nie umiał WYRAZIĆ zdjęcia nocnego:
   najdłuższe, co potrafił zaproponować, to 1 sekunda, więc na gwiazdy radził
   1/30 s — a robi się je przez dwadzieścia kilka sekund. */
const CZASY_DLUGIE = [1 / 30, 1 / 25, 1 / 20, 1 / 15, 1 / 10, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2];
const ISO_KROKI = [50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600];

/* ------------------------------------------------------------------
   OBIEKTYWY

   Do tej pory Cosmos znał tylko KORPUS, a listę przysłon miał przypisaną do
   korpusu — co jest bez sensu, bo przysłona jest cechą obiektywu. Gdy Marcin
   napisał, jakiego szkła użyje, narzędzie nie miało gdzie tego przyjąć:
   parametr nie istniał. Model albo tę informację gubił, albo próbował ją
   gdzieś wcisnąć i odpowiadał bez sensu. Stąd „zgłupiał".

   Katalog nazwanych obiektywów jest tylko wygodą. Sedno to PARSER zapisu
   „24-70 f/2.8", bo obejmuje każde szkło, także takie, którego nie znam.
   ------------------------------------------------------------------ */

// Pełne działki przysłony. Jasność maksymalna obiektywu często nie jest
// pełną działką (f/1.8, f/3.5, f/6.3), więc dokładamy ją osobno.
const PELNE_PRZYSLONY = [1, 1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22, 32];

const OBIEKTYWY = {
  'rf16f2.8':      { nazwa: 'RF 16 mm f/2.8 STM',            od: 16,  do: 16,  jasnosc: 2.8 },
  'rf50f1.8':      { nazwa: 'RF 50 mm f/1.8 STM',            od: 50,  do: 50,  jasnosc: 1.8 },
  'rf24-105f4':    { nazwa: 'RF 24-105 mm f/4L IS',          od: 24,  do: 105, jasnosc: 4 },
  'rf24-105f4-7.1': { nazwa: 'RF 24-105 mm f/4-7.1 IS STM',  od: 24,  do: 105, jasnosc: 4, jasnoscDo: 7.1 },
  'rf24-70f2.8':   { nazwa: 'RF 24-70 mm f/2.8L IS',         od: 24,  do: 70,  jasnosc: 2.8 },
  'rf70-200f2.8':  { nazwa: 'RF 70-200 mm f/2.8L IS',        od: 70,  do: 200, jasnosc: 2.8 },
  'rf70-200f4':    { nazwa: 'RF 70-200 mm f/4L IS',          od: 70,  do: 200, jasnosc: 4 },
  'rf15-35f2.8':   { nazwa: 'RF 15-35 mm f/2.8L IS',         od: 15,  do: 35,  jasnosc: 2.8 },
  'rf35f1.8':      { nazwa: 'RF 35 mm f/1.8 IS Macro STM',   od: 35,  do: 35,  jasnosc: 1.8 },
  'rf85f2':        { nazwa: 'RF 85 mm f/2 Macro IS STM',     od: 85,  do: 85,  jasnosc: 2 },
};

/** Lista przysłon, jakie obiektyw naprawdę oferuje przy danej ogniskowej. */
function przyslonyObiektywu(jasnosc, najciemniej = 22) {
  const lista = PELNE_PRZYSLONY.filter((f) => f > jasnosc && f <= najciemniej);
  return [Number(jasnosc), ...lista];
}

/** Jasność maksymalna przy konkretnej ogniskowej.
 *
 *  Zoomy ze zmienną jasnością (f/4-7.1) tracą światło przy dłuższym końcu.
 *  Producenci nie podają krzywej, ale w praktyce zmiana idzie liniowo
 *  w działkach względem logarytmu ogniskowej — i to przybliżenie wystarcza,
 *  żeby nie obiecywać f/4 przy 105 mm na szkle, które ma tam f/7.1.
 */
function jasnoscPrzy(ob, ogniskowa) {
  if (!ob) return null;
  if (!ob.jasnoscDo || ob.do <= ob.od) return ob.jasnosc;
  const f = Math.max(ob.od, Math.min(ob.do, Number(ogniskowa) || ob.od));
  const udzial = Math.log(f / ob.od) / Math.log(ob.do / ob.od);
  return Number((ob.jasnosc * Math.pow(ob.jasnoscDo / ob.jasnosc, udzial)).toFixed(1));
}

/** Rozpoznaj obiektyw z tego, jak ludzie go zapisują.
 *
 *  „RF 24-70mm f/2.8L IS", „24-70 f2.8", „50mm 1.8", „18-135 f/3.5-5.6",
 *  „Sigma 18-35 1.8" — wszystkie te zapisy znaczą to samo co katalog.
 *  Zwraca `null`, gdy w tekście nie ma ogniskowej: lepiej przyznać, że nie
 *  wiadomo, niż zgadnąć szkło i policzyć ekspozycję dla nieistniejącego.
 */
function rozpoznajObiektyw(tekst) {
  const s = String(tekst || '').replace(/[–—]/g, '-').replace(/,(\d)/g, '.$1').trim();
  if (!s) return null;

  const klucz = s.toLowerCase().replace(/[^a-z0-9.]/g, '');
  if (OBIEKTYWY[klucz]) return { ...OBIEKTYWY[klucz] };
  for (const [k, v] of Object.entries(OBIEKTYWY)) {
    if (klucz && (klucz === k || klucz.includes(k))) return { ...v };
  }

  /* Kolejność ma znaczenie. NAJPIERW wycinamy przysłonę zapisaną wprost
     („f/2.8", „F4.5-7.1", „1:4"), bo tylko ona jest jednoznaczna. Dopiero
     z RESZTY czytamy ogniskową — inaczej liczby wchodzą sobie w drogę.

     `\b` przed `f` jest tu konieczne: bez niego „f" z przedrostka mocowania
     RF/EF łapało się na pierwszą liczbę i „RF 24-70mm f/2.8" dawało f/24-70.
     Między „R" a „F" nie ma granicy słowa, więc `\bf` tego już nie tknie. */
  let jasnosc = null;
  let jasnoscDo = null;
  let reszta = s;
  const zF = s.match(/(?:\bf[\s/:]?\s*|\b1:)(\d{1,2}(?:\.\d+)?)(?:\s*-\s*(\d{1,2}(?:\.\d+)?))?/i);
  if (zF) {
    jasnosc = Number(zF[1]);
    if (zF[2]) jasnoscDo = Number(zF[2]);
    reszta = s.replace(zF[0], ' ');
  }

  let od = null;
  let doO = null;
  const zakres = reszta.match(/\b(\d{1,4}(?:\.\d)?)\s*-\s*(\d{1,4}(?:\.\d)?)\s*(?:mm)?\b/i);
  const zMm = reszta.match(/\b(\d{1,4}(?:\.\d)?)\s*mm\b/i);
  if (zakres) { od = Number(zakres[1]); doO = Number(zakres[2]); }
  else if (zMm) { od = Number(zMm[1]); doO = od; }
  else {
    // Bez jednostki i bez zakresu — pierwsza liczba, która MOŻE być ogniskową.
    // Próg 8 mm odsiewa „przysłona 2.8" wziętą za obiektyw 2 mm.
    const luzem = reszta.match(/\b(\d{1,4})\b/);
    if (luzem && Number(luzem[1]) >= 8) { od = Number(luzem[1]); doO = od; }
  }
  if (od === null) return null;
  if (doO < od) [od, doO] = [doO, od];

  /* Przysłona bez „f" — „Sigma 18-35 1.8". Bierzemy liczbę stojącą PO
     ogniskowej i tylko taką, która mieści się w sensownym zakresie przysłon. */
  if (jasnosc === null) {
    const dopasowanie = zakres || zMm || reszta.match(/\b(\d{1,4})\b/);
    const ogon = reszta.slice(dopasowanie.index + dopasowanie[0].length);
    const luzem = ogon.match(/\b(\d{1,2}(?:\.\d+)?)(?:\s*-\s*(\d{1,2}(?:\.\d+)?))?\b/);
    if (luzem && Number(luzem[1]) >= 0.9 && Number(luzem[1]) <= 32) {
      jasnosc = Number(luzem[1]);
      if (luzem[2]) jasnoscDo = Number(luzem[2]);
    }
  }

  const zgadywana = jasnosc === null;
  if (zgadywana) jasnosc = 4;   // nic lepszego nie wiemy — mówimy o tym wprost
  const ob = { nazwa: s.slice(0, 60), od, do: doO, jasnosc, zgadywanaJasnosc: zgadywana };
  if (jasnoscDo && jasnoscDo > jasnosc) ob.jasnoscDo = jasnoscDo;
  return ob;
}

/** Rozpoznaj KILKA obiektywów naraz — „mam 24-70 f/2.8 i 70-200 f/4". */
function rozpoznajObiektywy(tekst) {
  return String(tekst || '')
    .split(/\s*(?:[;,+]|\bi\b|\boraz\b|\bplus\b)\s*/i)
    .map((cz) => rozpoznajObiektyw(cz))
    .filter(Boolean);
}

/** Który z posiadanych obiektywów pasuje do tej ogniskowej?
 *  Gdy żaden nie sięga — oddajemy najbliższy i mówimy o tym wprost. */
function wybierzObiektyw(lista, ogniskowa) {
  const szkla = (lista || []).filter(Boolean);
  if (!szkla.length) return { obiektyw: null, pasuje: false, uwaga: '' };
  const f = Number(ogniskowa);
  if (!Number.isFinite(f)) return { obiektyw: szkla[0], pasuje: true, uwaga: '' };

  const miesci = szkla.filter((o) => f >= o.od && f <= o.do);
  if (miesci.length) {
    // Kilka pasuje — bierzemy najjaśniejszy przy tej ogniskowej.
    const naj = miesci.reduce((a, b) => (jasnoscPrzy(b, f) < jasnoscPrzy(a, f) ? b : a));
    return { obiektyw: naj, pasuje: true, uwaga: '' };
  }
  const odleglosc = (o) => (f < o.od ? o.od - f : f - o.do);
  const blisko = szkla.reduce((a, b) => (odleglosc(b) < odleglosc(a) ? b : a));
  const zakres = blisko.od === blisko.do ? `${blisko.od} mm` : `${blisko.od}-${blisko.do} mm`;
  return {
    obiektyw: blisko,
    pasuje: false,
    uwaga: `Żaden z podanych obiektywów nie ma ${f} mm. Najbliżej jest ${blisko.nazwa} `
      + `(${zakres}) — liczę dla ${f < blisko.od ? blisko.od : blisko.do} mm.`,
  };
}

/** EV sceny na podstawie wysokości Słońca i zachmurzenia (przy ISO 100).
 *  Punkty odniesienia to klasyczna tabela ekspozycji; między nimi interpolujemy,
 *  bo światło nie zmienia się skokowo. */
function evZeSlonca(wysokoscSlonca, zachmurzenie = 'bezchmurnie') {
  const punkty = [
    /* Noc bezksiężycowa to EV około −6, nie +1. Pierwsza wersja tej tabeli
       miała tu 1 i była zawyżona o ponad SIEDEM działek — czyli każda porada
       na noc, gwiazdy czy długą ekspozycję wychodziła kompletnie nie tak.
       Kontrola: rozgwieżdżone niebo fotografuje się typowo 20 s przy f/2.8
       i ISO 3200, a to daje log2(2.8²/20) − log2(3200/100) = −6,4. */
    [-18, -6],   // noc astronomiczna, bez Księżyca
    [-15, -3],
    [-12, 1],    // zmierzch żeglarski
    [-6, 8],     // początek niebieskiej godziny
    [-2, 10],
    [0, 11],     // Słońce na horyzoncie
    [3, 12.5],
    [6, 13.5],   // koniec złotej godziny
    [15, 14.5],
    [30, 15],    // reguła „słoneczne 16"
    [60, 15.5],
  ];
  const h = Math.max(-18, Math.min(60, wysokoscSlonca));
  let ev = punkty[punkty.length - 1][1];
  for (let i = 0; i < punkty.length - 1; i++) {
    const [h1, e1] = punkty[i];
    const [h2, e2] = punkty[i + 1];
    if (h >= h1 && h <= h2) { ev = e1 + ((h - h1) / (h2 - h1)) * (e2 - e1); break; }
  }
  // Chmury zabierają światło tylko wtedy, gdy Słońce jest nad horyzontem.
  const nadHoryzontem = Math.max(0, Math.min(1, (wysokoscSlonca + 2) / 6));
  const upust = { bezchmurnie: 0, lekkie: 1, pochmurno: 2.5, deszcz: 4 }[zachmurzenie] || 0;
  return ev - upust * nadHoryzontem;
}

const najblizszy = (lista, x) => lista.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));

/** Czas migawki po ludzku. Mianownik poniżej 1 znaczy sekundy: 1/30 → „30 s". */
function zapisCzasu(mianownik) {
  if (mianownik >= 1) return `1/${Math.round(mianownik)}`;
  const sekundy = 1 / mianownik;
  return `${sekundy >= 10 ? Math.round(sekundy) : Number(sekundy.toFixed(1))} s`;
}

/** Rozwiąż trójkąt ekspozycji.
 *
 *  @param {number} ev            EV sceny przy ISO 100
 *  @param {object} o
 *  @param {string} o.sprzet      klucz z SPRZET
 *  @param {string} o.tryb        'wideo' | 'zdjecie'
 *  @param {number} o.klatki      klatek na sekundę (wideo)
 *  @param {number} o.ogniskowa   mm — do reguły 1/ogniskowa
 *  @param {string} o.ruch        'statyczne' | 'spacer' | 'szybkie'
 *  @param {number} o.glebia      preferowana przysłona (np. 2.8 na płytką)
 */
function dobierz(ev, o = {}) {
  const s = (o.sprzet ? rozpoznajSprzet(o.sprzet) : null) || SPRZET['canon-r6ii'];
  const tryb = o.tryb === 'zdjecie' ? 'zdjecie' : 'wideo';
  const klatki = Number(o.klatki) || 25;
  const powody = [];

  /* Sprzęt spoza katalogu wpada w KLASĘ (dron / telefon / pełna klatka /
     APS-C) i trzeba to POWIEDZIEĆ. Milczące podstawienie innego aparatu daje
     odpowiedź, która wygląda poprawnie, a dotyczy nie tego sprzętu: sufit ISO
     i zapas ze stabilizacji są inne. */
  if (s.zgadywany) {
    powody.push(`Nie mam „${s.nazwa}" w katalogu — potraktowałem go jak `
      + `${KLASY_SPRZETU[s.klasa].nazwa} (${s.format}, ISO do ${s.isoMax}). `
      + 'Jeśli to nie ta półka, powiedz, a poprawię.');
  }

  /* CO fotografujesz — z tego biorą się czas i ogniskowa, gdy ich nie podałeś.
     Bez tego „jadę na żurawie" i „jadę w góry" dostawały identyczną odpowiedź,
     choć jedno potrzebuje 1/1600 s przy 500 mm, a drugie statywu przy 24 mm. */
  const temat = o.temat ? rozpoznajTemat(o.temat) : null;
  const ruch = o.ruch || (temat && temat.ruch) || 'statyczne';

  /* --- 0. obiektyw ---
     Przysłona jest cechą SZKŁA, nie korpusu. Dopóki Cosmos znał tylko korpus,
     potrafił doradzić f/1.4 komuś, kto ma zoom f/4 — i nie umiał przyjąć
     odpowiedzi na pytanie „jakich obiektywów użyjesz". */
  const szkla = (Array.isArray(o.obiektyw) ? o.obiektyw : [o.obiektyw])
    .filter(Boolean)
    .map((x) => (typeof x === 'string' ? rozpoznajObiektyw(x) : x))
    .filter(Boolean);

  let ogniskowa = Number(o.ogniskowa);
  /* Ogniskowej nie podano, ale WIADOMO, co fotografujesz — a to wystarczy,
     żeby ją zaproponować. Ptak w locie przy 35 mm to nie jest zdjęcie ptaka.
     Bierzemy część wspólną tego, co radzi temat, i tego, co ma szkło. */
  if (!Number.isFinite(ogniskowa) && temat && temat.ogniskowaPref) {
    /* Celujemy w ogniskową TYPOWĄ dla tematu i bierzemy szkło, które podchodzi
       do niej najbliżej; przy remisie — jaśniejsze. Wcześniej wybór szedł po
       tym, który obiektyw pokrywa większą część zakresu tematu, i przy
       krajobrazie [16-200] wygrywał 70-200: Cosmos radził 135 mm na panoramę
       gór, zamiast 24 mm. */
    const cel = temat.ogniskowaPref;
    const siegaDo = (x) => Math.max(x.od, Math.min(x.do, cel));
    const najlepsze = szkla.length
      ? szkla.reduce((a, b) => {
        const ra = Math.abs(siegaDo(a) - cel);
        const rb = Math.abs(siegaDo(b) - cel);
        if (rb !== ra) return rb < ra ? b : a;
        return jasnoscPrzy(b, siegaDo(b)) < jasnoscPrzy(a, siegaDo(a)) ? b : a;
      })
      : null;
    ogniskowa = najlepsze ? Math.round(siegaDo(najlepsze)) : cel;
  }
  /* Temat chce dłuższego szkła, niż użytkownik ma — i to trzeba POWIEDZIEĆ.
     Bez tego Cosmos po cichu liczył dla 200 mm prośbę o ptaki w locie
     (słownik radzi 300-600 mm) i odpowiedź wyglądała na kompletną. Marcin ma
     najdłużej 200 mm, więc to nie jest przypadek teoretyczny. */
  if (temat && temat.ogniskowa && szkla.length && !Number.isFinite(Number(o.ogniskowa))) {
    const najdluzsze = Math.max(...szkla.map((x) => x.do));
    if (najdluzsze < temat.ogniskowaPref) {
      powody.push(`Na ${temat.nazwa} przydałoby się ${temat.ogniskowa[0]}-${temat.ogniskowa[1]} mm, `
        + `a najdłuższe, co masz, to ${najdluzsze} mm — liczę dla niego. `
        + 'Podejdź bliżej albo licz się z kadrowaniem w postprodukcji.');
    }
  }

  const wybor = wybierzObiektyw(szkla, Number.isFinite(ogniskowa) ? ogniskowa : NaN);
  const ob = wybor.obiektyw;
  if (!Number.isFinite(ogniskowa)) {
    // Bez podanej ogniskowej: krótki koniec szkła, a bez szkła — 35 mm.
    ogniskowa = ob ? ob.od : 35;
  } else if (ob && !wybor.pasuje) {
    ogniskowa = ogniskowa < ob.od ? ob.od : ob.do;
  }
  if (wybor.uwaga) powody.push(wybor.uwaga);

  // Lista przysłon: obiektywu, gdy go znamy; inaczej ta przypisana do korpusu.
  const jasnoscTu = ob ? jasnoscPrzy(ob, ogniskowa) : null;
  // Gdy szkło jest znane, to ONO wyznacza przysłony — korpus ich nie ogranicza.
  const przyslony = ob ? przyslonyObiektywu(jasnoscTu, ob.najciemniej || 22) : s.przyslony;
  if (ob) {
    powody.push(`Liczę dla ${ob.nazwa} przy ${ogniskowa} mm — najjaśniej f/${jasnoscTu}`
      + (ob.jasnoscDo ? ' (zoom ze zmienną jasnością, na dłuższym końcu ciemniej).' : '.')
      + (ob.zgadywanaJasnosc ? ' Jasności nie podałeś, przyjąłem f/4 — podaj ją, jeśli inna.' : ''));
  }

  /* Masz w torbie coś JAŚNIEJSZEGO — powiedz o tym.
     Przy portrecie czy koncercie różnica dwóch działek jest warta ciaśniejszego
     kadru, a Cosmos wybiera szkło po ogniskowej i sam z siebie by o tym nie
     wspomniał. Decyzja zostaje przy człowieku, ale musi ją znać. */
  if (ob && temat && temat.glebia === 'otwarcie' && szkla.length > 1) {
    /* …ale tylko jeśli to szkło ma sens PRZY TYM TEMACIE. Bez tego warunku
       Cosmos podsuwał 50 mm do ptaków w locie i do gwiazd, bo patrzył
       wyłącznie na jasność. Musi mieścić się w zakresie ogniskowych tematu. */
    const [tOd, tDo] = temat.ogniskowa || [0, 1e9];
    const jasniejsze = szkla
      .filter((x) => x !== ob && x.do >= tOd && x.od <= tDo
        && jasnoscPrzy(x, x.od) < jasnoscTu - 0.4)
      .sort((a, b) => jasnoscPrzy(a, a.od) - jasnoscPrzy(b, b.od))[0];
    if (jasniejsze) {
      const dzialki = Math.round(2 * Math.log2(jasnoscTu / jasnoscPrzy(jasniejsze, jasniejsze.od)) * 5) / 10;
      powody.push(`Masz też ${jasniejsze.nazwa} — o ${dzialki} działki jaśniej, `
        + `czyli mocniej odcięte tło i niższe ISO, kosztem ciaśniejszego kadru `
        + `(${jasniejsze.od}${jasniejsze.do !== jasniejsze.od ? '-' + jasniejsze.do : ''} mm).`);
    }
  }

  // --- 1. czas migawki ---
  let mianownik = 0;
  if (tryb === 'wideo') {
    /* DOKŁADNIE 1/(2×klatki), bez zaokrąglania do drabinki zdjęciowej.
       Wcześniej 25 kl./s dawało 1/60 zamiast 1/50, bo pięćdziesiątki nie ma
       w klasycznej drabince czasów aparatu — i to był błąd w dwóch miejscach
       naraz. Po pierwsze reguła 180° przestawała być regułą (1/60 przy 25
       kl./s to kąt 150°, ruch wychodzi twardszy). Po drugie, i ważniejsze
       w Polsce: przy sieci 50 Hz świetlówki i LED-y migoczą 100 razy na
       sekundę, więc 1/50 i 1/100 są czasami BEZPIECZNYMI, a 1/60 daje
       przewijające się pasy na każdym ujęciu w hali, kościele i biurze.
       W trybie filmowym każdy aparat oferuje pełną drabinkę wideo, więc nie
       ma czego zaokrąglać. */
    mianownik = Math.round(klatki * 2);
    powody.push(`Czas 1/${mianownik} s wynika z reguły 180° przy ${klatki} kl./s — `
      + 'to on daje naturalne rozmycie ruchu. Nie zmieniaj go, żeby doświetlić kadr.');
    // Sieć 50 Hz to Europa; przy 25 i 50 kl./s wychodzi to samo, co reguła 180°.
    if (mianownik % 50 !== 0) {
      powody.push(`Uwaga na światło sztuczne: przy sieci 50 Hz bezpieczne są 1/50 i 1/100, `
        + `a 1/${mianownik} s może dać przewijające się pasy pod świetlówkami i LED-ami. `
        + 'W pomieszczeniu warto przełączyć się na 25 albo 50 kl./s.');
    }
  } else {
    /* Od dołu ogranicza nas poruszenie: własne drgania i ruch obiektu.
       Drgania liczymy od ogniskowej PRZELICZONEJ na pełną klatkę — na APS-C
       200 mm kadruje jak 300 mm i tak samo szybko widać poruszenie. */
    const zDrgan = (ogniskowa * (s.mnoznik || 1)) / Math.pow(2, s.stabilizacjaEV);
    const zRuchu = Math.max(RUCH[ruch] || 0, (temat && temat.czasMin) || 0);
    mianownik = najblizszy(CZASY, Math.max(zDrgan, zRuchu, 30));
    /* Przy zdjęciach nocnych ta uwaga byłaby myląca: czas i tak zaraz
       wydłużymy do sekund na statywie, a wtedy „tyle można z ręki" przeczy
       temu, co pada dwie linijki niżej. */
    if (!(temat && temat.dlugieCzasy)) {
      powody.push(zRuchu > zDrgan
        ? `Czas 1/${mianownik} s zatrzymuje ruch (${ruch}).`
        : `Czas 1/${mianownik} s przy ${ogniskowa} mm — stabilizacja daje zapas `
          + `${s.stabilizacjaEV} działek, stąd tak długo można z ręki.`);
    }
  }

  /* --- 2. przysłona i ISO ---
     EV = log2(N²/t). Mając czas, szukamy przysłony przy ISO bazowym; gdy
     brakuje światła, dopiero wtedy podnosimy ISO. Odwrotna kolejność
     (najpierw ISO) dawałaby niepotrzebny szum w biały dzień. */
  const docelowa = o.glebia ? najblizszy(przyslony, Number(o.glebia)) : null;
  let iso = s.isoMin;
  let przyslona;

  /* Przysłona wynikająca z TEMATU — miękka preferencja, nie żądanie.
     Bez niej dobór zamykał przysłonę wszędzie tam, gdzie było dużo światła,
     bo czas trzymał na minimum: krajobraz wychodził f/22 (dyfrakcja zjada
     szczegół), a portret f/11 (zero oddzielenia od tła). Jedno i drugie jest
     technicznie poprawnie naświetlone i fotograficznie bez sensu.

     W trybie ZDJĘCIOWYM czas jest tylko DOLNĄ granicą, więc właściwa
     odpowiedź brzmi: trzymaj przysłonę, skracaj czas. Tak się to robi
     w praktyce i tak liczymy poniżej. */
  const doZamkniecia = przyslony.filter((f) => f <= 11);
  const PREFERENCJE = {
    otwarcie: () => przyslony[0],
    zamkniecie: () => (doZamkniecia.length ? najblizszy(doZamkniecia, 8) : przyslony[0]),
    srednia: () => najblizszy(przyslony, 5.6),
  };
  const preferowana = (!docelowa && temat && PREFERENCJE[temat.glebia])
    ? PREFERENCJE[temat.glebia]() : null;

  const potrzebnaPrzyslona = (isoTeraz) => {
    const evPrzyIso = ev + Math.log2(isoTeraz / 100);
    return Math.sqrt(Math.pow(2, evPrzyIso) / mianownik);
  };

  if (docelowa) {
    // Głębia ostrości jest wyborem twórczym — trzymamy ją i ruszamy ISO.
    przyslona = docelowa;
    const brak = Math.log2((przyslona * przyslona) * mianownik) - ev;
    iso = najblizszy(ISO_KROKI, 100 * Math.pow(2, brak));
    /* Wcześniej brzmiało „bo o głębię ostrości prosiłeś" — a przysłonę
       podawał model z własnej inicjatywy, nie użytkownik. Cosmos twierdził
       więc, że spełnia prośbę, której nikt nie zgłosił.

       Drugi wariant tego samego kłamstwa: żądana przysłona bywa poza
       możliwościami szkła. Prośba o f/1.4 na zoomie f/4 kończyła się zdaniem
       „przysłona f/4 zostaje, bo taka została podana" — a podana była f/1.4.
       Podmiana musi być powiedziana wprost, inaczej odpowiedź brzmi
       poprawnie i mija się z tym, o co pytano. */
    const zadana = Number(o.glebia);
    if (Math.abs(zadana - przyslona) > 0.05) {
      powody.push(`Prosiłeś o f/${zadana}, ale ${ob ? ob.nazwa : s.nazwa} tego nie ma — `
        + `najbliżej jest f/${przyslona} i pod nią dobrałem ISO.`
        + (ob && zadana < jasnoscTu ? ` Jaśniej niż f/${jasnoscTu} to szkło nie otworzy.` : ''));
    } else {
      powody.push(`Przysłona f/${przyslona} zostaje, bo taka została podana — ISO dobrane pod nią. `
        + 'Jeśli nie zależy Ci na tej głębi ostrości, pomiń ją, a dobiorę przysłonę pod światło.');
    }
  } else if (preferowana) {
    przyslona = preferowana;
    /* W wideo czas jest zablokowany regułą 180°, więc przysłony nie da się
       „opłacić" krótszym czasem. Zostawiamy ją mimo to: nadmiar światła
       załatwia filtr ND, o którym mówi sekcja o różnicy EV niżej. Zamykanie
       do f/16 tylko po to, żeby zejść z jasnością, kosztuje ostrość na
       dyfrakcji — a tego się już nie odzyska. */
    const brakPrzyCzasie = () => Math.log2((przyslona * przyslona) * mianownik) - ev;
    if (tryb === 'wideo') {
      powody.push(`Przysłona f/${przyslona} pod ${temat.nazwa}. Czasu ruszyć nie wolno `
        + '(reguła 180°), więc nadmiar światła zdejmij filtrem ND, a nie przymknięciem.');
      const brak = brakPrzyCzasie();
      if (brak > 0) iso = najblizszy(ISO_KROKI, 100 * Math.pow(2, brak));
    } else {
      /* Ile klatek na sekundę „zniesie" ta przysłona przy ISO bazowym:
         EV = log2(N²/t), więc 1/t = 2^EV / N². */
      const mozliwy = Math.pow(2, ev) / (przyslona * przyslona);
      if (temat.dlugieCzasy && mozliwy < 1) {
        /* Zdjęcia nocne: zamiast dobijać ISO do sufitu, WYDŁUŻAMY czas —
           statyw jest tu założeniem, nie ustępstwem. Granicą nie jest
           poruszenie z ręki, tylko obrót Ziemi: reguła 500 mówi, ile sekund
           wolno naświetlać, zanim gwiazdy zrobią się kreskami. */
        const maxSekund = 500 / Math.max(1, ogniskowa * (s.mnoznik || 1));
        const trzeba = 1 / mozliwy;                     // sekundy przy ISO bazowym
        const sekundy = Math.min(trzeba, maxSekund);
        mianownik = najblizszy(CZASY_DLUGIE, 1 / sekundy);
        iso = najblizszy(ISO_KROKI, 100 * Math.pow(2, Math.max(0, brakPrzyCzasie())));
        powody.push(`Czas ${zapisCzasu(mianownik)} przy f/${przyslona} — statyw obowiązkowy. `
          + `Reguła 500 przy ${ogniskowa} mm pozwala na ${Math.round(maxSekund)} s, `
          + `zanim gwiazdy przestaną być punktami`
          + (trzeba > maxSekund ? '; brakującą resztę światła dobiera ISO.' : '.'));
      } else if (mozliwy >= mianownik) {
        // Światła jest dość — skracamy czas i zostawiamy przysłonę w spokoju.
        mianownik = najblizszy(CZASY, Math.min(mozliwy, CZASY[CZASY.length - 1]));
        powody.push(`Przysłona f/${przyslona} pod ${temat.nazwa} — czas skracam do `
          + `1/${mianownik} s, żeby ją utrzymać. Przy tym świetle jest na to zapas.`);
      } else {
        // Za ciemno na tę przysłonę przy minimalnym czasie — dokładamy ISO.
        iso = najblizszy(ISO_KROKI, 100 * Math.pow(2, brakPrzyCzasie()));
        powody.push(`Przysłona f/${przyslona} pod ${temat.nazwa}; czasu skrócić się nie da `
          + `poniżej 1/${mianownik} s, więc brakujące światło nadrabia ISO.`);
      }
    }
  } else {
    const idealna = potrzebnaPrzyslona(s.isoMin);
    if (idealna > przyslony[przyslony.length - 1]) {
      // Sam brak zapasu przysłony odnotowujemy niżej, razem z liczbą działek —
      // dwa osobne zdania o tym samym brzmiały jak dwie różne diagnozy.
      przyslona = przyslony[przyslony.length - 1];
    } else if (idealna < przyslony[0]) {
      przyslona = przyslony[0];
      const brak = Math.log2((przyslona * przyslona) * mianownik) - ev;
      iso = najblizszy(ISO_KROKI, 100 * Math.pow(2, brak));
      powody.push(`Otwieramy maksymalnie (f/${przyslona}) i dopiero brakujące światło nadrabiamy ISO.`);
    } else {
      przyslona = najblizszy(przyslony, idealna);
    }
  }

  iso = Math.max(s.isoMin, Math.min(s.isoMax, iso));

  /* Skok na drugą bazę wzmocnienia. W R6 II ISO 800 ma MNIEJ szumu niż 640 —
     wbrew intuicji „im niżej, tym czyściej". Warto o tym powiedzieć, bo to
     rzecz, której nie widać w menu aparatu. */
  if (s.isoDrugiZakres && iso > s.isoDrugiZakres / 2 && iso < s.isoDrugiZakres) {
    powody.push(`Podnieś ISO do ${s.isoDrugiZakres} zamiast zostawać na ${iso} — `
      + `${s.nazwa} ma tam drugą bazę wzmocnienia i szum jest MNIEJSZY niż o działkę niżej.`);
    iso = s.isoDrugiZakres;
  }

  /* Czy ustawienia w ogóle domykają scenę.
     EV ustawień = log2(N²/t) − log2(ISO/100). Im WYŻSZE, tym ciemniejszy kadr.
     Gdy EV sceny przewyższa to, co ustawienia potrafią przyjąć, obraz będzie
     PRZEŚWIETLONY — brakuje nam możliwości przyciemnienia, nie światła.
     (Pierwsza wersja miała ten znak odwrotnie i przy słońcu w zenicie radziła
     „weź statyw", zamiast „załóż filtr ND".) */
  const czasS = 1 / mianownik;
  const evUstawien = Math.log2((przyslona * przyslona) / czasS) - Math.log2(iso / 100);
  const roznica = Number((ev - evUstawien).toFixed(1));
  if (roznica > 0.5) {
    powody.push(`Zostaje ${roznica.toFixed(1)} działki prześwietlenia — `
      + (tryb === 'wideo'
        ? 'to jest właśnie moment na filtr ND. Skracanie czasu zepsułoby regułę 180°.'
        : 'przymknij bardziej albo skróć czas; przy tym świetle jest na to zapas.'));
  } else if (roznica < -0.5) {
    powody.push(`Brakuje ${Math.abs(roznica).toFixed(1)} działki światła — `
      + (iso >= s.isoMax ? 'ISO jest już na maksimum, więc ' : '')
      + 'potrzebny statyw, jaśniejszy obiektyw albo światło zastane.');
  }

  // Uwaga o sprzęcie tylko wtedy, gdy nie powiedzieliśmy już tego samego wyżej.
  if (s.uwaga && !powody.some((p) => /filtr ND/.test(p))) powody.push(s.uwaga);

  /* Rada praktyczna do TEMATU — to zwykle najcenniejsza część odpowiedzi.
     Liczby powie każdy kalkulator; „ekspozycja pod suknię, cienie podnosisz
     później" albo „reguła 500" to jest to, po co się w ogóle pyta. */
  if (temat) {
    if (temat.zgadywany) {
      powody.push(`Tematu „${temat.nazwa}" nie mam w słowniku — policzyłem jak dla `
        + 'ujęcia w umiarkowanym ruchu. Jeśli obiekt jest szybszy albo zupełnie '
        + 'statyczny, powiedz, a poprawię czas.');
    } else if (temat.uwagi) {
      powody.push(`${temat.nazwa.charAt(0).toUpperCase()}${temat.nazwa.slice(1)}: ${temat.uwagi}`);
    }
  }

  return {
    sprzet: s.nazwa,
    tryb,
    czas: zapisCzasu(mianownik),
    przyslona: `f/${przyslona}`,
    iso,
    ev: Number(ev.toFixed(1)),
    // Dodatnie = prześwietlenie (brak zapasu przysłony/ND),
    // ujemne = niedoświetlenie (brak światła).
    roznicaEV: roznica,
    powody,
  };
}

/** Zmierzony EV z jasności podglądu kamery telefonu.
 *
 *  Telefon nie poda nam wprost EV sceny, ale poda średnią jasność klatki przy
 *  swoich ustawieniach. Znając je, da się odtworzyć EV: automat telefonu
 *  celuje w średnią szarość, więc odchylenie od niej to odchylenie ekspozycji.
 */
function evZPomiaru(jasnosc, ustawienia = {}) {
  const { iso = 100, czasS = 1 / 60, przyslona = 1.8 } = ustawienia;
  const evAparatu = Math.log2((przyslona * przyslona) / czasS) - Math.log2(iso / 100);
  // 0,45 to średnia szarość po korekcji gamma sRGB (18% liniowo).
  const odchylenie = Math.log2(Math.max(0.01, jasnosc) / 0.45);
  return evAparatu + odchylenie;
}

/** Orientacja kadru z proporcji podglądu. */
function orientacja(szerokosc, wysokosc) {
  if (!szerokosc || !wysokosc) return { uklad: 'nieznany', proporcje: '' };
  const r = szerokosc / wysokosc;
  const nazwa = (x) => {
    const kandydaci = [[16 / 9, '16:9'], [4 / 3, '4:3'], [3 / 2, '3:2'], [1, '1:1'],
      [9 / 16, '9:16'], [3 / 4, '3:4'], [2 / 3, '2:3']];
    return kandydaci.reduce((a, b) => (Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a))[1];
  };
  return {
    uklad: r > 1.05 ? 'poziomo' : (r < 0.95 ? 'pionowo' : 'kwadrat'),
    proporcje: nazwa(r),
  };
}

module.exports = {
  SPRZET, OBIEKTYWY, evZeSlonca, dobierz, evZPomiaru, orientacja, CZASY, ISO_KROKI,
  rozpoznajObiektyw, rozpoznajObiektywy, wybierzObiektyw, jasnoscPrzy, przyslonyObiektywu,
  rozpoznajSprzet, KLASY_SPRZETU,
};

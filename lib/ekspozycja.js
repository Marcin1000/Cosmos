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

/* Sprzęt Marcina plus wpisy ogólne. Liczby, które naprawdę wpływają na wynik:
   zakres przysłony, sensowny sufit ISO (nie katalogowy — ten, powyżej którego
   materiał robi się nie do użycia) i zapas ze stabilizacji. */
const SPRZET = {
  'canon-r6ii': {
    nazwa: 'Canon R6 Mark II',
    przyslony: [1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16, 22],
    isoMin: 100,
    isoMax: 12800,        // wyżej daje radę, ale to już ratowanie ujęcia
    isoDrugiZakres: 800,  // druga baza wzmocnienia — tu szum spada
    stabilizacjaEV: 5,    // IBIS: realnie ~5 działek, nie katalogowe 8
    format: 'pełna klatka',
  },
  'mavic-3': {
    nazwa: 'DJI Mavic 3',
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

// Typowe czasy migawki (mianownik ułamka) — do zaokrąglania do pełnej działki.
const CZASY = [1, 2, 4, 8, 15, 30, 60, 125, 250, 500, 1000, 2000, 4000, 8000];
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
    [-18, 1],    // noc astronomiczna, bez Księżyca
    [-12, 4],
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
  const s = SPRZET[o.sprzet] || SPRZET['canon-r6ii'];
  const tryb = o.tryb === 'zdjecie' ? 'zdjecie' : 'wideo';
  const klatki = Number(o.klatki) || 25;
  const ruch = o.ruch || 'statyczne';
  const powody = [];

  /* Nieznany korpus wpada w domyślny — i trzeba to POWIEDZIEĆ. Milczące
     podstawienie innego aparatu daje odpowiedź, która wygląda poprawnie,
     a dotyczy nie tego sprzętu: sufit ISO i zapas ze stabilizacji są inne.
     Cicha nieprawda jest gorsza niż jawne „nie znam tego korpusu". */
  if (o.sprzet && !SPRZET[o.sprzet]) {
    powody.push(`Nie znam korpusu „${String(o.sprzet).slice(0, 40)}" — liczę dla ${s.nazwa}. `
      + 'Sufit ISO i zapas ze stabilizacji mogą się u Ciebie różnić.');
  }

  /* --- 0. obiektyw ---
     Przysłona jest cechą SZKŁA, nie korpusu. Dopóki Cosmos znał tylko korpus,
     potrafił doradzić f/1.4 komuś, kto ma zoom f/4 — i nie umiał przyjąć
     odpowiedzi na pytanie „jakich obiektywów użyjesz". */
  const szkla = (Array.isArray(o.obiektyw) ? o.obiektyw : [o.obiektyw])
    .filter(Boolean)
    .map((x) => (typeof x === 'string' ? rozpoznajObiektyw(x) : x))
    .filter(Boolean);

  let ogniskowa = Number(o.ogniskowa);
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

  // --- 1. czas migawki ---
  let mianownik;
  if (tryb === 'wideo') {
    mianownik = najblizszy(CZASY, klatki * 2);
    powody.push(`Czas 1/${mianownik} s wynika z reguły 180° przy ${klatki} kl./s — `
      + 'to on daje naturalne rozmycie ruchu. Nie zmieniaj go, żeby doświetlić kadr.');
  } else {
    // Od dołu ogranicza nas poruszenie: własne drgania i ruch obiektu.
    const zDrgan = ogniskowa / Math.pow(2, s.stabilizacjaEV);
    const zRuchu = { statyczne: 0, spacer: 125, szybkie: 500 }[ruch] || 0;
    mianownik = najblizszy(CZASY, Math.max(zDrgan, zRuchu, 30));
    powody.push(zRuchu > zDrgan
      ? `Czas 1/${mianownik} s zatrzymuje ruch (${ruch}).`
      : `Czas 1/${mianownik} s przy ${ogniskowa} mm — stabilizacja daje zapas `
        + `${s.stabilizacjaEV} działek, stąd tak długo można z ręki.`);
  }
  const czasS = 1 / mianownik;

  /* --- 2. przysłona i ISO ---
     EV = log2(N²/t). Mając czas, szukamy przysłony przy ISO bazowym; gdy
     brakuje światła, dopiero wtedy podnosimy ISO. Odwrotna kolejność
     (najpierw ISO) dawałaby niepotrzebny szum w biały dzień. */
  const docelowa = o.glebia ? najblizszy(przyslony, Number(o.glebia)) : null;
  let iso = s.isoMin;
  let przyslona;

  const potrzebnaPrzyslona = (isoTeraz) => {
    const evPrzyIso = ev + Math.log2(isoTeraz / 100);
    return Math.sqrt(Math.pow(2, evPrzyIso) * czasS);
  };

  if (docelowa) {
    // Głębia ostrości jest wyborem twórczym — trzymamy ją i ruszamy ISO.
    przyslona = docelowa;
    const brak = Math.log2((przyslona * przyslona) / czasS) - ev;
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
  } else {
    const idealna = potrzebnaPrzyslona(s.isoMin);
    if (idealna > przyslony[przyslony.length - 1]) {
      // Sam brak zapasu przysłony odnotowujemy niżej, razem z liczbą działek —
      // dwa osobne zdania o tym samym brzmiały jak dwie różne diagnozy.
      przyslona = przyslony[przyslony.length - 1];
    } else if (idealna < przyslony[0]) {
      przyslona = przyslony[0];
      const brak = Math.log2((przyslona * przyslona) / czasS) - ev;
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

  return {
    sprzet: s.nazwa,
    tryb,
    czas: `1/${mianownik}`,
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
};

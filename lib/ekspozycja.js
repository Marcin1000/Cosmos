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
  const ogniskowa = Number(o.ogniskowa) || 35;
  const ruch = o.ruch || 'statyczne';
  const powody = [];

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
  const docelowa = o.glebia ? najblizszy(s.przyslony, Number(o.glebia)) : null;
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
    powody.push(`Przysłona f/${przyslona} zostaje, bo o głębię ostrości prosiłeś — ISO dobrane pod nią.`);
  } else {
    const idealna = potrzebnaPrzyslona(s.isoMin);
    if (idealna > s.przyslony[s.przyslony.length - 1]) {
      // Sam brak zapasu przysłony odnotowujemy niżej, razem z liczbą działek —
      // dwa osobne zdania o tym samym brzmiały jak dwie różne diagnozy.
      przyslona = s.przyslony[s.przyslony.length - 1];
    } else if (idealna < s.przyslony[0]) {
      przyslona = s.przyslony[0];
      const brak = Math.log2((przyslona * przyslona) / czasS) - ev;
      iso = najblizszy(ISO_KROKI, 100 * Math.pow(2, brak));
      powody.push(`Otwieramy maksymalnie (f/${przyslona}) i dopiero brakujące światło nadrabiamy ISO.`);
    } else {
      przyslona = najblizszy(s.przyslony, idealna);
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

module.exports = { SPRZET, evZeSlonca, dobierz, evZPomiaru, orientacja, CZASY, ISO_KROKI };

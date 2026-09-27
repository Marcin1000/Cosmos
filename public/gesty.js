/* ============================================================
   GESTY – własne gesty: nagraj, nazwij, przypisz czynność

   Marcin: „jeśli chodzi o gesty, to mógłby zapisywać je po ich pokazaniu
   z informacją, co one mają znaczyć, i potem je odtwarzać, jak się je pokaże,
   np. dwa palce poruszające się w górę oznaczają jakąś czynność, np.
   przewijanie strony w górę”.

   Gest to trzy rzeczy wyciągnięte z nagrania dłoni (punkty z /api/dlonie):
     • które palce są wyprostowane (to, co człowiek naprawdę „pokazuje”),
     • kształt dłoni – 21 punktów przesuniętych do nadgarstka i przeskalowanych
       wielkością dłoni, więc ten sam gest bliżej i dalej od kamery to ten sam
       kształt,
     • ruch – dokąd przesunął się środek dłoni: w górę, w dół, w lewo,
       w prawo albo wcale.

   Strona ruchu jest podana z punktu widzenia osoby: kamera (Kinect,
   kamera przeglądarki) widzi obraz nieodbity, więc dłoń przesuwana w prawo
   osoby jedzie w kadrze w lewo.

   Czyste funkcje (bez DOM-u) – test woła je wprost w Node.
   ============================================================ */

const PALCE_GESTU = ['kciuk', 'wskazujący', 'środkowy', 'serdeczny', 'mały'];
const RUCHY = ['brak', 'gora', 'dol', 'lewo', 'prawo'];
const CZYNNOSCI = ['przewin-gora', 'przewin-dol', 'migawka', 'glos', 'stop', 'wyslij', 'otworz', 'znaczenie'];
// Ile trzeba przesunąć środek dłoni (w szerokościach kadru), żeby to był ruch.
const PROG_RUCHU = 0.12;
// Średnia odległość punktów kształtu (w wielkościach dłoni), przy której to „ten sam” kształt.
const PROG_KSZTALTU = 0.45;

function utworzGesty() {
  const odl = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  /** 21 punktów → 42 liczby: nadgarstek w (0,0), wielkość dłoni = 1. */
  function ksztalt(punkty) {
    if (!Array.isArray(punkty) || punkty.length !== 21) return null;
    const skala = odl(punkty[0], punkty[9]) || 1;
    return punkty.flatMap(([x, y]) => [(x - punkty[0][0]) / skala, (y - punkty[0][1]) / skala]);
  }

  function roznicaKsztaltu(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let suma = 0;
    for (let i = 0; i < a.length; i += 2) suma += Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1]);
    return suma / (a.length / 2);
  }

  const kluczPalcow = (palce) => PALCE_GESTU.filter((p) => (palce || []).includes(p)).join(',');

  /** Dokąd przesunął się środek dłoni (punkt 9) między początkiem a końcem próbek. */
  function kierunekRuchu(probki) {
    const zDlonia = probki.filter((p) => p.punkty && p.punkty.length === 21);
    if (zDlonia.length < 2) return 'brak';
    const srodek = (lista) => {
      const xs = lista.map((p) => p.punkty[9][0]);
      const ys = lista.map((p) => p.punkty[9][1]);
      return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
    };
    const ile = Math.max(1, Math.floor(zDlonia.length / 4));
    const [x0, y0] = srodek(zDlonia.slice(0, ile));
    const [x1, y1] = srodek(zDlonia.slice(-ile));
    const dx = x1 - x0, dy = y1 - y0;
    if (Math.hypot(dx, dy) < PROG_RUCHU) return 'brak';
    if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'gora' : 'dol';
    // Kadr nieodbity: ruch w prawo osoby to ruch w lewo obrazu.
    return dx < 0 ? 'prawo' : 'lewo';
  }

  /** Wzorzec gestu z nagrania albo null, gdy dłoni prawie nie było widać. */
  function wzorzecZNagrania(probki) {
    const zDlonia = (probki || []).filter((p) => p.punkty && p.punkty.length === 21);
    if (zDlonia.length < 3) return null;
    // Palce: najczęstszy układ w nagraniu (dłoń w ruchu daje po drodze przypadkowe).
    const liczniki = new Map();
    for (const p of zDlonia) { const k = kluczPalcow(p.palce); liczniki.set(k, (liczniki.get(k) || 0) + 1); }
    const [klucz] = [...liczniki.entries()].sort((a, b) => b[1] - a[1])[0];
    const pasujace = zDlonia.filter((p) => kluczPalcow(p.palce) === klucz);
    const ksztalty = pasujace.map((p) => ksztalt(p.punkty));
    const sredni = ksztalty[0].map((_, i) => ksztalty.reduce((s, k) => s + k[i], 0) / ksztalty.length);
    return {
      palce: klucz ? klucz.split(',') : [],
      ksztalt: sredni.map((v) => Math.round(v * 1000) / 1000),
      ruch: kierunekRuchu(zDlonia),
    };
  }

  /**
   * Który zapisany gest właśnie pokazano – albo null.
   * `okno` to ostatnie próbki (najstarsza pierwsza) z ostatnich ~2,5 s.
   * Gest z ruchem wygrywa z nieruchomym o tym samym układzie palców:
   * „dwa palce w górę” to coś więcej niż „dwa palce”.
   */
  function dopasuj(wzorce, okno) {
    const zDlonia = (okno || []).filter((p) => p.punkty && p.punkty.length === 21);
    if (!zDlonia.length || !(wzorce || []).length) return null;
    let najlepszy = null;
    for (const w of wzorce) {
      const klucz = kluczPalcow(w.palce);
      if (w.ruch && w.ruch !== 'brak') {
        const zPalcami = zDlonia.filter((p) => kluczPalcow(p.palce) === klucz);
        if (zPalcami.length < 2 || zPalcami.length < zDlonia.length * 0.6) continue;
        if (kierunekRuchu(zPalcami) !== w.ruch) continue;
        return w;                                   // ruch – od razu
      }
      // Nieruchomy: dwa ostatnie odczyty z tym układem palców i podobnym kształtem.
      const dwa = zDlonia.slice(-2);
      if (dwa.length < 2 || !dwa.every((p) => kluczPalcow(p.palce) === klucz)) continue;
      if (kierunekRuchu(zDlonia) !== 'brak') continue;
      const r = roznicaKsztaltu(ksztalt(dwa[1].punkty), w.ksztalt);
      if (r < PROG_KSZTALTU && (!najlepszy || r < najlepszy.r)) najlepszy = { w, r };
    }
    return najlepszy ? najlepszy.w : null;
  }

  /** Opis wzorca dla człowieka: „2 palce (wskazujący, środkowy), ruch w górę”. */
  function opisWzorca(w, t = (k) => k) {
    const n = (w.palce || []).length;
    const palce = n ? `${n} ${t(n === 1 ? 'gest.palec' : n < 5 ? 'gest.palce' : 'gest.palcow')} (${w.palce.join(', ')})` : t('gest.piesc');
    return w.ruch && w.ruch !== 'brak' ? `${palce}, ${t(`gest.ruch.${w.ruch}`)}` : palce;
  }

  return { ksztalt, roznicaKsztaltu, kierunekRuchu, wzorzecZNagrania, dopasuj, opisWzorca, kluczPalcow };
}

if (typeof window !== 'undefined') {
  window.utworzGesty = utworzGesty;
  window.CZYNNOSCI_GESTOW = CZYNNOSCI;
}
if (typeof module !== 'undefined') module.exports = { utworzGesty, PALCE_GESTU, RUCHY, CZYNNOSCI };

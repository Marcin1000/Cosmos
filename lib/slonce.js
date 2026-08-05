/* ============================================================
   Pozycja Słońca — złota godzina, niebieska godzina, wschód i zachód

   Do zdjęć liczy się nie „która godzina", tylko JAK WYSOKO jest Słońce.
   Ta sama 18:00 w czerwcu i w grudniu to zupełnie inne światło, a złota
   godzina nie ma nic wspólnego z godziną: to przedział, w którym Słońce
   stoi między −4° a +6° nad horyzontem.

   Zamknięty wzór, nie długi ogon poprawności — dlatego liczymy sami,
   zgodnie z zasadą z README. Algorytm: NOAA Solar Calculator, dokładność
   rzędu minuty, czyli grubo poniżej tego, co widać w kadrze.
   ============================================================ */

const STOP = Math.PI / 180;
const NASTOPNIE = 180 / Math.PI;

// Progi wysokości Słońca (w stopniach) — granice pór światła.
const PROGI = {
  noc: -18,          // koniec zmierzchu astronomicznego
  niebieskaOd: -6,   // zmierzch cywilny: niebieska godzina
  wschodZachod: -0.833, // z uwzględnieniem refrakcji i tarczy Słońca
  zlotaDo: 6,        // powyżej tego światło robi się twarde
};

/** Dni juliańskie od J2000.0 */
function dniOdJ2000(data) {
  return data.getTime() / 86400000 - 10957.5;
}

/** Wysokość i azymut Słońca dla chwili i miejsca.
 *  @returns {{ wysokosc: number, azymut: number }} w stopniach
 */
function pozycjaSlonca(data, lat, lon) {
  const d = dniOdJ2000(data);

  // Średnia anomalia i długość ekliptyczna
  const M = (357.5291 + 0.98560028 * d) * STOP;
  const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * STOP;
  const L = M + C + Math.PI + 102.9372 * STOP;

  // Nachylenie osi Ziemi
  const e = 23.4397 * STOP;
  const rektascensja = Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
  const deklinacja = Math.asin(Math.sin(e) * Math.sin(L));

  // Kąt godzinny
  const czasGwiazdowy = (280.16 + 360.9856235 * d) * STOP + lon * STOP;
  const H = czasGwiazdowy - rektascensja;

  const fi = lat * STOP;
  const wysokosc = Math.asin(
    Math.sin(fi) * Math.sin(deklinacja) + Math.cos(fi) * Math.cos(deklinacja) * Math.cos(H),
  );
  const azymut = Math.atan2(
    Math.sin(H),
    Math.cos(H) * Math.sin(fi) - Math.tan(deklinacja) * Math.cos(fi),
  );

  return {
    wysokosc: wysokosc * NASTOPNIE,
    // Z południa na północ: 0° = północ, 90° = wschód — tak jak na kompasie.
    azymut: (azymut * NASTOPNIE + 180) % 360,
  };
}

/** Kiedy Słońce przekracza daną wysokość — szukane przez połowienie.
 *
 *  Wzory na wschód/zachód dają się rozwiązać wprost, ale dla DOWOLNEGO progu
 *  (−6°, +6°) trzeba by osobnego wzoru na każdy. Połowienie po minucie jest
 *  krótsze, czytelniejsze i działa tak samo dla każdego progu — a kilkanaście
 *  iteracji to ułamek milisekundy.
 */
function przejscie(dzien, lat, lon, prog, rosnaco) {
  const doba = 24 * 3600 * 1000;
  const start = new Date(dzien);
  start.setHours(0, 0, 0, 0);

  let poprzednia = pozycjaSlonca(start, lat, lon).wysokosc;
  for (let min = 1; min <= 1440; min++) {
    const t = new Date(start.getTime() + min * 60000);
    const teraz = pozycjaSlonca(t, lat, lon).wysokosc;
    const przecina = rosnaco ? (poprzednia < prog && teraz >= prog) : (poprzednia > prog && teraz <= prog);
    if (przecina) {
      // Doprecyzowanie w obrębie minuty — interpolacja liniowa wystarcza.
      const udzial = (prog - poprzednia) / (teraz - poprzednia);
      return new Date(start.getTime() + (min - 1 + udzial) * 60000);
    }
    poprzednia = teraz;
    if (min * 60000 > doba) break;
  }
  return null;                       // dzień polarny albo noc polarna
}

/** Pełny obraz światła na dany dzień i miejsce. */
function swiatloDnia(data, lat, lon) {
  const p = pozycjaSlonca(data, lat, lon);
  const zn = (prog, rosnaco) => przejscie(data, lat, lon, prog, rosnaco);

  const wschod = zn(PROGI.wschodZachod, true);
  const zachod = zn(PROGI.wschodZachod, false);
  const zlotaRanoDo = zn(PROGI.zlotaDo, true);
  const zlotaWieczorOd = zn(PROGI.zlotaDo, false);
  const niebieskaRanoOd = zn(PROGI.niebieskaOd, true);
  const niebieskaWieczorDo = zn(PROGI.niebieskaOd, false);

  return {
    teraz: { wysokosc: Number(p.wysokosc.toFixed(2)), azymut: Number(p.azymut.toFixed(1)) },
    faza: fazaSwiatla(p.wysokosc),
    wschod,
    zachod,
    // Złota godzina rano trwa od wschodu do +6°, wieczorem odwrotnie.
    zlotaRano: wschod && zlotaRanoDo ? { od: wschod, do: zlotaRanoDo } : null,
    zlotaWieczor: zlotaWieczorOd && zachod ? { od: zlotaWieczorOd, do: zachod } : null,
    niebieskaRano: niebieskaRanoOd && wschod ? { od: niebieskaRanoOd, do: wschod } : null,
    niebieskaWieczor: zachod && niebieskaWieczorDo ? { od: zachod, do: niebieskaWieczorDo } : null,
  };
}

function fazaSwiatla(wysokosc) {
  if (wysokosc < PROGI.noc) return 'noc';
  if (wysokosc < PROGI.niebieskaOd) return 'zmierzch';
  if (wysokosc < PROGI.wschodZachod) return 'niebieska godzina';
  if (wysokosc < PROGI.zlotaDo) return 'złota godzina';
  if (wysokosc < 20) return 'miękkie światło';
  return 'ostre światło';
}

/** Ile minut do zdarzenia (ujemne = już minęło). */
function zaIleMinut(kiedy, teraz = new Date()) {
  if (!kiedy) return null;
  return Math.round((kiedy.getTime() - teraz.getTime()) / 60000);
}

module.exports = { pozycjaSlonca, swiatloDnia, fazaSwiatla, zaIleMinut, PROGI };

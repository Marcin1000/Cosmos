/* ============================================================
   Zorza polarna — czy dziś w nocy jest po co wychodzić

   Z listy awesome-astrophotography: SolarHam i dane NOAA SWPC. Pomysł jest
   prosty i pasuje do reszty planu zdjęciowego dokładnie tak jak pogoda —
   zorzę w Polsce widać kilka razy w roku, jest do przewidzenia z kilkunastu
   godzin wyprzedzeniem, a przegapienie jej boli.

   NOAA udostępnia dane publicznie, bez klucza i bez rejestracji. Bierzemy dwa
   strumienie: bieżący wskaźnik Kp i prognozę na trzy doby.

   ------------------------------------------------------------
   CZEGO TO NARZĘDZIE NIE ROBI — i dlaczego mówi o tym wprost

   „Kp 7" nie znaczy „zobaczysz zorzę". Widoczność zależy od szerokości
   GEOMAGNETYCZNEJ (innej niż geograficzna), od zachmurzenia, od Księżyca,
   od świateł miasta i od tego, czy patrzysz na północ z odsłoniętym
   horyzontem. Liczymy więc PRÓG — przy jakim Kp owal zorzowy sięga Twojej
   szerokości — i podajemy go razem z prognozą, zamiast obiecywać widok.

   Szerokość geomagnetyczną liczymy w przybliżeniu DIPOLOWYM. To jest
   uproszczenie: tablice „Kp → granica owalu" opierają się na szerokości
   geomagnetycznej SKORYGOWANEJ, która dla Polski wypada o 2-3° niżej.
   Przybliżenie dipolowe jest więc lekko OPTYMISTYCZNE i tak je opisujemy.
   ============================================================ */

const KP_TERAZ = process.env.SWPC_KP_URL
  || 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';
const KP_PROGNOZA = process.env.SWPC_KP_FORECAST_URL
  || 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
const CZAS_MS = Number(process.env.SWPC_TIMEOUT_MS || 7000);

/* Biegun geomagnetyczny (dipol IGRF, epoka 2020). Dryfuje o ułamki stopnia
   rocznie — na próg widoczności wpływa to mniej niż samo przybliżenie. */
const BIEGUN = { lat: 80.7, lon: -72.7 };

/* Granica owalu zorzowego: przy danym Kp zorza sięga MNIEJ WIĘCEJ tej
   szerokości geomagnetycznej. Tablica jest standardem używanym przez serwisy
   prognozy zorzy; różnice między wersjami to pojedyncze dziesiąte stopnia. */
const GRANICA_OWALU = [66.5, 64.5, 62.4, 60.4, 58.3, 56.3, 54.2, 52.2, 50.1, 48.1];

/* O ile stopni NIŻEJ niż sam owal widać jeszcze łunę nad północnym
   horyzontem. Zorza sięga setek kilometrów w górę, więc widać ją z daleka —
   i właśnie tak wygląda w Polsce: nie nad głową, tylko łuna nad północą.

   Pierwsza wersja miała tu 8° i wychodziło z niej, że w Gdańsku zorza jest
   przy Kp 3. To bzdura — Kp 3 to spokojny dzień. Kontrola z rzeczywistości:
   w Polsce zorzę widać przy Kp 6-7, a wielką burzę z maja 2024 (Kp 8-9) było
   widać w całym kraju. Przy 4° progi wychodzą Gdańsk 5, Warszawa 6,
   Kraków 7, Zakopane 8 — i to się z tym zgadza. */
const ZASIEG_NAD_HORYZONTEM = 4;

/** Szerokość geomagnetyczna w przybliżeniu dipolowym. */
function szerokoscGeomagnetyczna(lat, lon) {
  const r = Math.PI / 180;
  const s = Math.sin(lat * r) * Math.sin(BIEGUN.lat * r)
    + Math.cos(lat * r) * Math.cos(BIEGUN.lat * r) * Math.cos((lon - BIEGUN.lon) * r);
  return Number((Math.asin(Math.max(-1, Math.min(1, s))) / r).toFixed(1));
}

/** Najniższe Kp, przy którym zorza sięga danej szerokości geomagnetycznej.
 *  `null`, gdy nie sięga nawet przy Kp 9. */
function progKp(szerokoscGeo, zapas = 0) {
  for (let kp = 0; kp <= 9; kp++) {
    if (GRANICA_OWALU[kp] - zapas <= szerokoscGeo) return kp;
  }
  return null;
}

async function pobierz(adres) {
  const r = await fetch(adres, {
    headers: { Accept: 'application/json', 'User-Agent': 'Cosmos/2.0 (prywatny asystent)' },
    signal: AbortSignal.timeout(CZAS_MS),
  });
  if (!r.ok) throw new Error(`SWPC ${r.status}`);
  return r.json();
}

/** Bieżące Kp z pomiaru minutowego. */
async function kpTeraz() {
  const d = await pobierz(KP_TERAZ);
  if (!Array.isArray(d) || !d.length) return null;
  const ostatni = d[d.length - 1];
  const kp = Number(ostatni.kp_index ?? ostatni.estimated_kp ?? ostatni.kp);
  return Number.isFinite(kp) ? { kp: Number(kp.toFixed(1)), kiedy: ostatni.time_tag || null } : null;
}

const WZOR_CZASU = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Znacznik czasu NOAA na milisekundy. Bez strefy zakładamy UTC — tak SWPC podaje. */
function czasSwpc(s) {
  const t = String(s).replace(' ', 'T');
  return new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(t) ? t : t + 'Z').getTime();
}

/** Jeden wiersz prognozy → wpis, albo `null`, gdy to nie jest wiersz z danymi.
 *
 *  Kolumn NIE liczymy po indeksie i nie zakładamy wiersza nagłówka. Pierwsza
 *  wersja robiła jedno i drugie („czas to w[0], Kp to w[1], pomiń wiersz zero")
 *  i wystarczyła zmiana kolejności kolumn albo brak nagłówka, żeby cała
 *  prognoza wyszła pusta — bez śladu, bo pusta prognoza jest dozwolonym
 *  stanem. Zamiast zgadywać układ, ROZPOZNAJEMY pola: znacznik czasu wygląda
 *  jak data, Kp jest liczbą z zakresu 0-9. Wiersz nagłówka nie spełnia ani
 *  jednego z tych warunków, więc odpada sam z siebie. */
function wierszPrognozy(w) {
  const pola = Array.isArray(w) ? w
    : (w && typeof w === 'object' ? Object.values(w) : null);
  if (!pola) return null;
  let kiedy = null;
  let kp = null;
  let obserwowane = false;
  for (const p of pola) {
    if (typeof p === 'string' && /observed/i.test(p)) { obserwowane = true; continue; }
    if (kiedy === null && typeof p === 'string' && WZOR_CZASU.test(p.trim())) {
      if (Number.isFinite(czasSwpc(p.trim()))) { kiedy = p.trim(); continue; }
    }
    if (kp === null && p !== null && p !== '' && typeof p !== 'boolean') {
      const n = Number(p);
      if (Number.isFinite(n) && n >= 0 && n <= 9) kp = n;
    }
  }
  return kiedy && kp !== null ? { kiedy, kp, obserwowane } : null;
}

/** Prognoza Kp na najbliższe doby. */
async function kpPrognoza(ile = 8) {
  const d = await pobierz(KP_PROGNOZA);
  if (!Array.isArray(d) || !d.length) return [];
  const teraz = Date.now();
  return d
    .map(wierszPrognozy)
    .filter(Boolean)
    // Interesuje nas przyszłość, nie wczorajsza burza.
    .filter((x) => czasSwpc(x.kiedy) >= teraz - 3 * 3600 * 1000)
    .slice(0, ile);
}

/**
 * Pełna odpowiedź „czy warto dziś wyjść na zorzę" dla miejsca.
 *
 * NIGDY nie rzuca i nigdy nie blokuje — zwraca `null`, gdy NOAA nie odpowiada.
 * Zorza jest DODATKIEM do planu zdjęciowego, a zasada w całym projekcie jest
 * jedna: nic, co jest tylko dodatkiem, nie może wstrzymać odpowiedzi.
 */
async function prognozaZorzy(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  let teraz = null;
  let prognoza = [];
  try {
    [teraz, prognoza] = await Promise.all([
      kpTeraz().catch(() => null),
      kpPrognoza().catch(() => []),
    ]);
  } catch { return null; }
  if (!teraz && !prognoza.length) return null;

  const geo = szerokoscGeomagnetyczna(lat, lon);
  const progNadGlowa = progKp(geo, 0);
  const progNadHoryzontem = progKp(geo, ZASIEG_NAD_HORYZONTEM);
  const szczyt = prognoza.reduce((a, b) => (b.kp > (a ? a.kp : -1) ? b : a), null);
  const najwyzsze = Math.max(teraz ? teraz.kp : 0, szczyt ? szczyt.kp : 0);

  let szansa = 'brak';
  if (progNadHoryzontem !== null && najwyzsze >= progNadHoryzontem) szansa = 'łuna nad północą';
  if (progNadGlowa !== null && najwyzsze >= progNadGlowa) szansa = 'nad głową';

  return {
    kpTeraz: teraz ? teraz.kp : null,
    kpTerazKiedy: teraz ? teraz.kiedy : null,
    prognoza,
    szczyt: szczyt ? { kp: szczyt.kp, kiedy: szczyt.kiedy } : null,
    szerokoscGeomagnetyczna: geo,
    progNadHoryzontem,
    progNadGlowa,
    szansa,
    uwaga: 'Szerokość geomagnetyczna liczona przybliżeniem dipolowym — dla Polski '
      + 'wypada o 2-3° korzystniej niż w tablicach opartych na szerokości '
      + 'skorygowanej, więc próg traktuj jako optymistyczny. Zorzę i tak zasłoni '
      + 'zachmurzenie, Księżyc w pełni i światła miasta; patrz na PÓŁNOC, '
      + 'z odsłoniętym horyzontem.',
  };
}

module.exports = {
  prognozaZorzy, szerokoscGeomagnetyczna, progKp, kpTeraz, kpPrognoza,
  GRANICA_OWALU, ZASIEG_NAD_HORYZONTEM,
};

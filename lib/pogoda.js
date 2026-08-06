/* ============================================================
   Pogoda dla planu zdjęciowego

   Pozycja Słońca mówi, ILE światła BYŁOBY przy czystym niebie. Chmury
   potrafią zabrać dwie i pół działki, a deszcz cztery — bez tego panel
   proponowałby f/11 w środku ulewy.

   Open-Meteo: bez klucza API, z prognozą godzinową. Ta sama usługa, której
   Cosmos używa już w porannej odprawie.

   Prognoza jest DODATKIEM do odpowiedzi, więc nie może jej wstrzymywać:
   krótki limit czasu i wynik z pamięci podręcznej, gdy usługa milczy.
   Ta sama zasada, co przy pamięci długotrwałej i manifeście zdolności.
   ============================================================ */

const POGODA_URL = process.env.WEATHER_URL || 'https://api.open-meteo.com/v1/forecast';
const POGODA_MS = Number(process.env.WEATHER_TIMEOUT_MS || 4000);
const CACHE_MS = Number(process.env.WEATHER_CACHE_MS || 600000);   // 10 minut

/* Kody pogody WMO → nasze kategorie zachmurzenia (te same, których używa
   lib/ekspozycja.js). Pełna tabela ma czterdzieści pozycji; interesuje nas
   wyłącznie to, ile światła ubywa. */
function zKoduWmo(kod) {
  if (kod === null || kod === undefined) return null;
  if (kod === 0) return 'bezchmurnie';
  if (kod <= 2) return 'lekkie';                    // głównie czyste / częściowe
  if (kod === 3) return 'pochmurno';                // zachmurzenie całkowite
  if (kod >= 45 && kod <= 48) return 'pochmurno';   // mgła
  if (kod >= 51 && kod <= 67) return 'deszcz';
  if (kod >= 71 && kod <= 86) return 'deszcz';      // śnieg — światła ubywa podobnie
  if (kod >= 95) return 'deszcz';                   // burza
  return 'lekkie';
}

const OPIS_WMO = {
  0: 'bezchmurnie', 1: 'prawie bezchmurnie', 2: 'częściowe zachmurzenie',
  3: 'pochmurno', 45: 'mgła', 48: 'mgła osadzająca szron',
  51: 'mżawka', 53: 'mżawka', 55: 'gęsta mżawka',
  61: 'słaby deszcz', 63: 'deszcz', 65: 'ulewa',
  71: 'słaby śnieg', 73: 'śnieg', 75: 'intensywny śnieg',
  80: 'przelotny deszcz', 81: 'przelotny deszcz', 82: 'gwałtowna ulewa',
  95: 'burza', 96: 'burza z gradem', 99: 'burza z gradem',
};

const cache = new Map();

/** Pogoda dla miejsca i chwili. `kiedy` to obiekt Date; brak = teraz.
 *  Zwraca `null`, gdy usługa nie odpowiada — wtedy plan liczy się z samej
 *  pozycji Słońca, tak jak dotąd. */
async function pogodaDla(lat, lon, kiedy = new Date()) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Zaokrąglenie do dwóch miejsc: sto metrów w bok to ta sama pogoda,
  // a bez tego każdy drobny ruch telefonu byłby nowym zapytaniem.
  const klucz = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const zPamieci = cache.get(klucz);
  if (zPamieci && Date.now() - zPamieci.o < CACHE_MS) return wybierzGodzine(zPamieci.dane, kiedy);

  try {
    const url = `${POGODA_URL}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
      + '&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m'
      + '&hourly=temperature_2m,weather_code,cloud_cover,precipitation_probability,visibility'
      + '&forecast_days=3&timezone=auto';
    const r = await fetch(url, { signal: AbortSignal.timeout(POGODA_MS) });
    if (!r.ok) return null;
    const dane = await r.json();
    cache.set(klucz, { o: Date.now(), dane });
    return wybierzGodzine(dane, kiedy);
  } catch {
    // Usługa milczy — lepiej stara prognoza niż żadna.
    return zPamieci ? wybierzGodzine(zPamieci.dane, kiedy) : null;
  }
}

/** Wyciągnij z prognozy godzinę najbliższą podanej chwili. */
function wybierzGodzine(dane, kiedy) {
  if (!dane) return null;
  const godziny = dane.hourly && dane.hourly.time;

  // Dla „teraz" mamy dokładniejszy odczyt bieżący niż prognozę godzinową.
  const rozniceMin = Math.abs(kiedy.getTime() - Date.now()) / 60000;
  if (rozniceMin < 45 && dane.current) {
    return zloz(dane.current.weather_code, dane.current.cloud_cover,
      dane.current.temperature_2m, dane.current.wind_speed_10m, null, 'pomiar bieżący');
  }
  if (!Array.isArray(godziny) || !godziny.length) return null;

  /* Open-Meteo przy `timezone=auto` oddaje czas LOKALNY dla tego miejsca,
     bez oznaczenia strefy. Porównujemy więc łańcuchy „RRRR-MM-DDTHH", a nie
     momenty — inaczej trafialibyśmy w godzinę przesuniętą o offset. */
  const szukana = `${kiedy.getFullYear()}-${String(kiedy.getMonth() + 1).padStart(2, '0')}`
    + `-${String(kiedy.getDate()).padStart(2, '0')}T${String(kiedy.getHours()).padStart(2, '0')}`;
  let i = godziny.findIndex((t) => t.startsWith(szukana));
  if (i < 0) i = 0;

  const h = dane.hourly;
  return zloz(h.weather_code?.[i], h.cloud_cover?.[i], h.temperature_2m?.[i],
    null, h.precipitation_probability?.[i], `prognoza na ${godziny[i].slice(11, 16)}`);
}

function zloz(kod, chmury, temp, wiatr, opady, zrodlo) {
  const zachmurzenie = zKoduWmo(kod);
  if (!zachmurzenie) return null;
  return {
    zachmurzenie,
    opis: OPIS_WMO[kod] || zachmurzenie,
    chmuryProc: Number.isFinite(chmury) ? chmury : null,
    temperatura: Number.isFinite(temp) ? temp : null,
    wiatr: Number.isFinite(wiatr) ? wiatr : null,
    opadyProc: Number.isFinite(opady) ? opady : null,
    zrodlo,
  };
}

module.exports = { pogodaDla, zKoduWmo, OPIS_WMO };

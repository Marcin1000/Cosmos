#!/usr/bin/env node
/* Czy dane o zorzy docierają Z TEGO SERWERA — i co z nich wynika dla miejsca.
 *
 * NOAA SWPC udostępnia je publicznie i bez klucza, ale mój kontener testowy
 * ma zablokowane wyjście, więc kształtu odpowiedzi NIE potwierdziłem na żywym
 * API — tylko na atrapie zbudowanej z dokumentacji. Ten skrypt jest jedynym
 * miejscem, w którym da się to rozstrzygnąć.
 *
 *   node scripts/zorza.js               — dla zapisanej lokalizacji (albo Warszawy)
 *   node scripts/zorza.js 54.35 18.65   — dla podanych współrzędnych
 *
 * WAŻNE: skrypt pyta OBA źródła OSOBNO i mówi, które padło.
 *
 * Pierwsza wersja szła przez `prognozaZorzy()`, a ta — słusznie — połyka błędy
 * i oddaje pustą prognozę, bo zorza jest dodatkiem do planu zdjęciowego i nic,
 * co jest dodatkiem, nie może wstrzymać odpowiedzi. Tyle że dla NARZĘDZIA
 * DIAGNOSTYCZNEGO ta sama cecha jest wadą: „Wpisów prognozy: 0" znaczyło naraz
 * „NOAA nie odpowiada", „adres zmieniony", „zmienił się kształt danych"
 * i „naprawdę nie ma wpisów", a Marcin nie miał jak tego rozróżnić ani ruszyć
 * dalej. Biblioteka zostaje cicha, skrypt ma być głośny.
 */
const fs = require('node:fs');
const path = require('node:path');
const { prognozaZorzy, szerokoscGeomagnetyczna, progKp, kpTeraz, kpPrognoza } = require('../lib/zorza.js');

/** Zapisana lokalizacja z danych serwera — sensowniejsza domyślnie niż Warszawa. */
function zapisaneWspolrzedne() {
  const katalog = process.env.COSMOS_DATA_DIR || path.join(__dirname, '..', 'data');
  try {
    const d = JSON.parse(fs.readFileSync(path.join(katalog, 'location.json'), 'utf8'));
    if (Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon))) {
      return { lat: Number(d.lat), lon: Number(d.lon), skad: 'zapisana lokalizacja' };
    }
  } catch { /* brak pliku — lecimy dalej */ }
  if (Number(process.env.BRIEFING_LAT) && Number(process.env.BRIEFING_LON)) {
    return { lat: Number(process.env.BRIEFING_LAT), lon: Number(process.env.BRIEFING_LON), skad: 'BRIEFING_LAT/LON' };
  }
  return { lat: 52.23, lon: 21.01, skad: 'domyślnie Warszawa' };
}

const podane = Number.isFinite(Number(process.argv[2])) && Number.isFinite(Number(process.argv[3]));
const miejsce = podane
  ? { lat: Number(process.argv[2]), lon: Number(process.argv[3]), skad: 'z wiersza poleceń' }
  : zapisaneWspolrzedne();
const { lat, lon } = miejsce;

/** Zapytaj źródło i powiedz WPROST, co z niego wyszło. */
async function zrodlo(nazwa, adres, wywolaj) {
  const start = Date.now();
  try {
    const wynik = await wywolaj();
    const ms = Date.now() - start;
    const ile = Array.isArray(wynik) ? wynik.length : (wynik ? 1 : 0);
    if (!ile) {
      console.log(`  ${nazwa.padEnd(12)} ⚠ odpowiedziało (${ms} ms), ale nie dało ani jednej wartości`);
      console.log(`  ${' '.repeat(12)}   → adres odpowiada, więc to nie sieć: albo zmienił się kształt`);
      console.log(`  ${' '.repeat(12)}     danych po stronie NOAA, albo produkt jest chwilowo pusty.`);
      console.log(`  ${' '.repeat(12)}     Sprawdź gołym okiem: curl -s "${adres}" | head -c 400`);
      return null;
    }
    console.log(`  ${nazwa.padEnd(12)} ✓ ${ile} ${Array.isArray(wynik) ? 'wpisów' : 'wartość'} (${ms} ms)`);
    return wynik;
  } catch (e) {
    console.log(`  ${nazwa.padEnd(12)} ✗ ${e.message}`);
    console.log(`  ${' '.repeat(12)}   → ${adres}`);
    return null;
  }
}

(async () => {
  console.log(`Miejsce: ${lat}, ${lon} (${miejsce.skad})`);
  console.log(`Szerokość geomagnetyczna (dipol): ${szerokoscGeomagnetyczna(lat, lon)}°`);
  console.log(`Próg Kp — łuna nad północą: ${progKp(szerokoscGeomagnetyczna(lat, lon), 4)}`
    + ` · nad głową: ${progKp(szerokoscGeomagnetyczna(lat, lon), 0)}\n`);

  console.log('Źródła NOAA SWPC:');
  const ADR_TERAZ = process.env.SWPC_KP_URL
    || 'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json';
  const ADR_PROGNOZA = process.env.SWPC_KP_FORECAST_URL
    || 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
  const teraz = await zrodlo('Kp teraz', ADR_TERAZ, kpTeraz);
  const prognoza = await zrodlo('prognoza Kp', ADR_PROGNOZA, kpPrognoza);
  console.log('');

  const z = await prognozaZorzy(lat, lon);
  if (!z) {
    console.log('✗ Żadne ze źródeł nie odpowiedziało — zorzy w planie zdjęciowym nie będzie.');
    console.log('  To DODATEK: plan działa bez niej, tylko bez tego jednego pola.');
    process.exit(1);
  }

  console.log(`Kp teraz: ${z.kpTeraz ?? '—'}${z.kpTerazKiedy ? ` (${z.kpTerazKiedy})` : ''}`);
  console.log(`Szczyt prognozy: ${z.szczyt ? `Kp ${z.szczyt.kp} o ${z.szczyt.kiedy}` : '—'}`);
  console.log(`Wpisów prognozy: ${z.prognoza.length}`);
  for (const p of z.prognoza.slice(0, 6)) console.log(`  ${p.kiedy}  Kp ${p.kp}`);

  console.log(`\nWERDYKT: ${z.szansa}`);
  /* Werdykt bez połowy danych jest słabszy, niż wygląda — i trzeba to
     powiedzieć, zamiast pozwolić mu udawać pełną odpowiedź. */
  if (teraz && !prognoza) {
    console.log('⚠ Werdykt opiera się WYŁĄCZNIE na bieżącym Kp — prognozy nie ma, więc');
    console.log('  „brak" znaczy tu „nie ma zorzy TERAZ", a nie „nie będzie dziś w nocy".');
  } else if (!teraz && prognoza) {
    console.log('⚠ Werdykt opiera się wyłącznie na prognozie — bieżącego Kp nie ma.');
  }
  console.log(`\n${z.uwaga}`);
})();

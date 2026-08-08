#!/usr/bin/env node
/* Czy dane o zorzy docierają Z TEGO SERWERA — i co z nich wynika dla miejsca.
 *
 * NOAA SWPC udostępnia je publicznie i bez klucza, ale mój kontener testowy
 * ma zablokowane wyjście, więc kształtu odpowiedzi NIE potwierdziłem na żywym
 * API — tylko na atrapie zbudowanej z dokumentacji. Ten skrypt jest jedynym
 * miejscem, w którym da się to rozstrzygnąć.
 *
 *   node scripts/zorza.js               — dla Warszawy
 *   node scripts/zorza.js 54.35 18.65   — dla podanych współrzędnych
 */
const { prognozaZorzy, szerokoscGeomagnetyczna, progKp } = require('../lib/zorza.js');

const lat = Number(process.argv[2]) || 52.23;
const lon = Number(process.argv[3]) || 21.01;

(async () => {
  console.log(`Miejsce: ${lat}, ${lon}`);
  console.log(`Szerokość geomagnetyczna (dipol): ${szerokoscGeomagnetyczna(lat, lon)}°`);
  console.log(`Próg Kp — łuna nad północą: ${progKp(szerokoscGeomagnetyczna(lat, lon), 4)}`
    + ` · nad głową: ${progKp(szerokoscGeomagnetyczna(lat, lon), 0)}\n`);

  const z = await prognozaZorzy(lat, lon);
  if (!z) {
    console.log('✗ NOAA SWPC nie odpowiada z tego serwera.');
    console.log('  Zorza jest DODATKIEM — plan zdjęciowy działa bez niej, tylko bez tego pola.');
    process.exit(1);
  }
  console.log(`Kp teraz: ${z.kpTeraz ?? '—'}${z.kpTerazKiedy ? ` (${z.kpTerazKiedy})` : ''}`);
  console.log(`Szczyt prognozy: ${z.szczyt ? `Kp ${z.szczyt.kp} o ${z.szczyt.kiedy}` : '—'}`);
  console.log(`Wpisów prognozy: ${z.prognoza.length}`);
  for (const p of z.prognoza.slice(0, 6)) console.log(`  ${p.kiedy}  Kp ${p.kp}`);
  console.log(`\nWERDYKT: ${z.szansa}`);
  console.log(`\n${z.uwaga}`);
})();

/* Ile par RAW+JPG naprawdę jest w archiwum — odczyt, nie zgadywanie.
 *
 *  Parowanie kadrów opłaca się tym bardziej, im więcej zdjęć leży w archiwum
 *  dwa razy. Ile ich jest, wie tylko właściciel archiwum — a pierwsza wersja
 *  klucza (po ścieżce) znalazła u Marcina zero par i dowiedzieliśmy się o tym
 *  dopiero po godzinie przemiału. Ten skrypt odpowiada w kilkanaście sekund,
 *  ZANIM cokolwiek ruszy.
 *
 *  Nie zmienia niczego — tylko czyta indeks i liczy.
 *
 *      node scripts/pary-w-archiwum.js
 */
const path = require('path');

const KATALOG = process.env.COSMOS_DATA_DIR || path.resolve(__dirname, '..', 'data');
const archiwum = require(path.resolve(__dirname, '..', 'lib', 'archiwum.js')).utworz(KATALOG);

const zdjecia = archiwum.szukaj({ zrodlo: 'onedrive', typ: 'zdjecie' });
if (!zdjecia.length) {
  console.log(`W ${KATALOG} nie ma zdjęć z OneDrive. Zły katalog albo pusty indeks.`);
  process.exit(0);
}

const rozszerzenie = (w) => {
  const m = String(w.nazwa || w.sciezka || '').match(/\.([^./]+)$/);
  return m ? m[1].toUpperCase() : '(bez rozszerzenia)';
};
const TANIE = new Set(['JPG', 'JPEG', 'PNG', 'HEIC', 'WEBP']);

const wgRozszerzenia = new Map();
for (const w of zdjecia) {
  const r = rozszerzenie(w);
  wgRozszerzenia.set(r, (wgRozszerzenia.get(r) || 0) + 1);
}

/* Grupowanie tym SAMYM `rodzenstwo()`, którego używa rozpoznawanie treści —
   inaczej ten skrypt mierzyłby własną kopię reguły, a nie tę, która działa. */
const ruszone = new Set();
let kadrow = 0;
let kadrowZParami = 0;
let plikowWParach = 0;
let bezDaty = 0;
const przyklady = [];

for (const w of zdjecia) {
  if (ruszone.has(w.id)) continue;
  const bracia = archiwum.rodzenstwo(w.id);
  for (const b of bracia) ruszone.add(b.id);
  kadrow++;
  if (!w.kiedy) bezDaty++;
  if (bracia.length > 1) {
    kadrowZParami++;
    plikowWParach += bracia.length;
    if (przyklady.length < 5) przyklady.push(bracia.map((b) => b.sciezka || b.nazwa));
  }
}

// To samo dla SAMEJ KOLEJKI — tylko te liczby przełożą się na czas przemiału.
const kolejka = zdjecia.filter((w) => !w.obejrzane);
const ruszone2 = new Set();
let zapytamy = 0;          // ile żądań do Microsoftu pójdzie
let zaDarmo = 0;           // ile plików dostanie etykiety bez żądania
let zapytamyORaw = 0;      // ile z tych żądań dotyczy drogiego RAW-a
for (const w of kolejka) {
  if (ruszone2.has(w.id)) continue;
  const bracia = archiwum.rodzenstwo(w.id);
  for (const b of bracia) ruszone2.add(b.id);
  const doOznaczenia = bracia.filter((x) => !x.obejrzane).length;
  if (bracia.some((x) => x.obejrzane)) {
    zaDarmo += doOznaczenia;                       // etykiety z obejrzanego bliźniaka
  } else {
    zapytamy++;
    zaDarmo += doOznaczenia - 1;
    const najtanszy = bracia.slice()
      .sort((a, b) => (TANIE.has(rozszerzenie(a)) ? 0 : 1) - (TANIE.has(rozszerzenie(b)) ? 0 : 1))[0];
    if (!TANIE.has(rozszerzenie(najtanszy))) zapytamyORaw++;
  }
}

const proc = (x, z) => (z ? `${Math.round((x / z) * 100)}%` : '—');
console.log(`\nCAŁE ARCHIWUM (zdjęcia z OneDrive): ${zdjecia.length}`);
console.log('  wg rozszerzenia:');
for (const [r, ile] of [...wgRozszerzenia].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`    ${r.padEnd(16)} ${String(ile).padStart(7)}  ${TANIE.has(r) ? '(tania miniatura)' : ''}`);
}
console.log(`  kadrów (plików po sparowaniu): ${kadrow}`);
console.log(`  kadrów mających więcej niż jeden plik: ${kadrowZParami} `
  + `(${proc(kadrowZParami, kadrow)} kadrów, ${plikowWParach} plików)`);
if (bezDaty) {
  console.log(`  UWAGA: ${bezDaty} kadrów bez daty — te parują się tylko po ścieżce.`);
  console.log('         Uruchom najpierw „Dociągnij dane z plików".');
}

console.log(`\nDO ROZPOZNANIA ZOSTAŁO: ${kolejka.length} plików`);
console.log(`  żądań do Microsoftu pójdzie: ${zapytamy}`);
console.log(`  z tego o drogi RAW: ${zapytamyORaw} (${proc(zapytamyORaw, zapytamy)})`);
console.log(`  plików z etykietą bez żądania: ${zaDarmo}`);
/* SZACUNEK Z JEDNEJ LICZBY, nie z dwóch zmyślonych.
 *
 *  Pierwsza wersja rozdzielała RAW (8 s) i JPG (0,7 s) i wyszło jej 1,7 h,
 *  podczas gdy realne tempo dawało dziewięć. Pomyłka była w tym drugim
 *  składniku: pomiar u Marcina pokazał, że wolno idą TAKŻE tanie pliki
 *  — pobranie 7959 ms przy 32 kB — więc rozbicie na typy dawało fałszywą
 *  precyzję. Do czasu, aż będzie pomiar osobno dla RAW-a i osobno dla JPG-a
 *  (panel go teraz pokazuje), lepsza jest jedna uczciwa liczba z odczytu.
 *
 *  Wstaw swoją: MS_ZADANIE=3000 node scripts/pary-w-archiwum.js
 *  Odczytasz ją z panelu — pozycja „realnie N ms/żądanie". */
const rownolegle = Number(process.env.YOLO_RUWNOLEGLE) || 24;
const msZadanie = Number(process.env.MS_ZADANIE) || 6100;
const sekund = (zapytamy * (msZadanie / 1000)) / rownolegle;
console.log(`  szacowany czas przy ${rownolegle} naraz: ${(sekund / 3600).toFixed(1)} h`);
console.log(`  (przy ${msZadanie} ms na żądanie — podmień przez MS_ZADANIE=...,`);
console.log('   wartość odczytasz z panelu: „realnie N ms/żądanie")');

if (przyklady.length) {
  console.log('\nPrzykładowe sparowane kadry:');
  for (const p of przyklady) console.log(`  ${p.join('  +  ')}`);
} else {
  console.log('\nNIE ZNALEZIONO ANI JEDNEJ PARY — parowanie nic tu nie da,');
  console.log('cały zysk musi przyjść z równoległości (YOLO_RUWNOLEGLE).');
}
console.log('');
process.exit(0);

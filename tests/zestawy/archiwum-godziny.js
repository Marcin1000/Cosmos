/* „Zdjęcia z Mazur, które zrobiłem przed 14" — pytanie bez odpowiedzi.

   Marcin zadał je po zakończeniu dociągania danych i dostał cztery rundy
   „nie udało się znaleźć", a na koniec 804 pliki, wszystkie wieczorne.
   Napisał: „wiem, kiedy robiłem zdjęcia na Mazurach (…) jest dużo więcej
   zdjęć wykonanych przed południem i po południu".

   Miał rację, a archiwum go okłamało — z dwóch niezależnych powodów.

   1. NIE BYŁO FILTRA PO ZEGARZE. Istniały `od`/`do` (konkretne daty
      z godziną) i `poraDnia`. `poraDnia` wygląda jak odpowiedź, ale liczy się
      z POŁOŻENIA SŁOŃCA: zdjęcie z 14:27 ma `poraDnia: wieczor`, bo Słońce
      jest już na zachód od południa. Model, pytany o zegarek, sięgał po
      astronomię i dostawał wynik wyglądający na prawdziwy.

   2. `miejsce=Mazury` NIE MOŻE ZADZIAŁAĆ dla tych plików. Ten filtr zamienia
      nazwę na współrzędne i filtruje po promieniu — a zdjęcia z lustrzanki
      nie mają GPS. 804 pliki leżały w katalogu „/Mazury 2026/" i były
      niewidoczne dla zapytania o miejsce. Model przez cztery rundy tłumaczył,
      że folder nazywa się pewnie inaczej. Nie nazywał się.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');

const fail = [];
const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-godz-'));
const archiwum = require('../../lib/archiwum.js').utworz(katalog);

/* Materiał jak u Marcina: katalog „Mazury 2026", zdjęcia z Canona BEZ GPS,
   rozrzucone po całym dniu — poranek, południe, popołudnie, wieczór. */
const godziny = [6, 8, 9, 11, 12, 13, 14, 15, 17, 19, 21];
archiwum.dodaj(godziny.map((g, i) => ({
  id: `onedrive:m${i}`,
  zrodlo: 'onedrive',
  typ: 'zdjecie',
  nazwa: `3B9A${4800 + i}.CR3`,
  sciezka: `/Mazury 2026/3B9A${4800 + i}.CR3`,
  kiedy: `2026-08-08T${String(g).padStart(2, '0')}:15:00`,
  aparat: 'Canon EOS R6 Mark II',
  exifCzytany: true,
  // Bez lat/lon — dokładnie jak zdjęcia z lustrzanki bez modułu GPS.
})));

// --- 1. Filtr po godzinie zegarowej w ogóle istnieje ----------------------
const przed14 = archiwum.szukaj({ folder: 'Mazury', godzinaDo: 14 });
const po14 = archiwum.szukaj({ folder: 'Mazury', godzinaOd: 14 });
console.log(`1. przed 14: ${przed14.length}, od 14: ${po14.length} (razem ${godziny.length})`);
if (przed14.length !== 6) fail.push(`„przed 14" dało ${przed14.length} zamiast 6 — filtr po zegarze nie działa`);
if (po14.length !== 5) fail.push(`„po 14" dało ${po14.length} zamiast 5`);
if (przed14.length + po14.length !== godziny.length) {
  fail.push('podział na przed/po 14 gubi albo dubluje pliki — granica jest źle postawiona');
}
// „do 14" znaczy PRZED czternastą: zdjęcie z 14:15 należy do drugiej grupy.
if (przed14.some((w) => w.kiedy.slice(11, 13) === '14')) {
  fail.push('zdjęcie z godziny 14 wpadło do „przed 14"');
}

/* Zakres z obu stron. Granica górna jest WYŁĄCZNA, tak samo jak w „do 14":
   „między 9 a 12" to godziny 9, 10 i 11. Za pierwszym razem wpisałem tu
   oczekiwanie 3, licząc dwunastą — i zestaw słusznie mnie poprawił. */
const rano = archiwum.szukaj({ folder: 'Mazury', godzinaOd: 9, godzinaDo: 12 });
console.log(`   między 9 a 12: ${rano.length} (godziny: ${rano.map((w) => w.kiedy.slice(11, 16)).join(', ')})`);
if (rano.length !== 2) fail.push(`zakres 9-12 dał ${rano.length} zamiast 2 (9:15 i 11:15)`);
if (rano.some((w) => w.kiedy.slice(11, 13) === '12')) {
  fail.push('godzina 12 wpadła do zakresu „do 12" — granica ma być wyłączna');
}

// Zapis „14:30" też ma być zrozumiały, nie tylko goła liczba.
const zDwukropkiem = archiwum.szukaj({ folder: 'Mazury', godzinaDo: '14:30' });
if (zDwukropkiem.length !== przed14.length) {
  fail.push('godzina zapisana jako „14:30" nie jest rozumiana');
}

/* --- 2. `poraDnia` to NIE jest zegar — i o to właśnie się potknęliśmy -----

   Odtwarzamy sytuację z serwera Marcina: dom jest ustawiony, więc porę
   światła liczymy dla współrzędnych domowych nawet bez GPS w pliku (stąd
   `swiatloPrzyblizone` w jego wynikach). Wtedy `poraDnia` ISTNIEJE i wygląda
   wiarygodnie — tylko odpowiada na inne pytanie niż zegarek. */
archiwum.ustawDom({ lat: 52.02, lon: 20.90 });
archiwum.przeliczSwiatlo();
const po14zPora = archiwum.szukaj({ folder: 'Mazury', godzinaOd: 14 });
const pory = po14zPora.map((w) => `${w.kiedy.slice(11, 16)}→${w.poraDnia}`);
console.log(`2. zdjęcia od 14 i ich poraDnia: ${pory.join(', ')}`);
const czternasta = po14zPora.find((w) => w.kiedy.slice(11, 13) === '14');
if (!czternasta) {
  fail.push('brak zdjęcia z godziny 14 — nie ma na czym pokazać różnicy');
} else if (czternasta.poraDnia === 'poludnie') {
  console.log('   (14:15 wypadło jeszcze w „poludnie" — różnica pojawia się później)');
}
/* Sedno: zdjęcia z popołudnia mają `poraDnia: wieczor`. Człowiek pytający
   „przed 14" nie ma na myśli astronomii, a model sięgał właśnie po nią. */
const wieczorne = archiwum.szukaj({ folder: 'Mazury', poraDnia: 'wieczor' });
const najwczesniejszaWieczorem = wieczorne
  .map((w) => Number(w.kiedy.slice(11, 13))).sort((a2, b2) => a2 - b2)[0];
console.log(`   najwcześniejsza godzina z etykietą „wieczor": ${najwczesniejszaWieczorem}`);
if (najwczesniejszaWieczorem >= 18) {
  fail.push('„wieczor" zaczyna się dopiero po 18 — to nie odtwarza danych Marcina i zestaw nic nie mierzy');
}

// --- 3. Zero po miejscu → podpowiedź o folderze ---------------------------
/* Zdjęcia nie mają GPS, więc `miejsce=Mazury` nie może trafić. Trasa ma
   wtedy POWIEDZIEĆ, ile plików ma tę nazwę w ścieżce — zamiast zostawiać
   modelowi zgadywanie, którego nie da się wygrać. */
const trasy = require('../../lib/archiwum-trasy.js').utworz({
  archiwum,
  onedrive: { polaczony: () => true },
  SENSES_URL: '',
  sendJson: (res, kod, dane) => { res.kod = kod; res.dane = dane; },
  readJson: async () => ({}),
  addEvent: () => {},
  sensesState: () => ({}),
  // Geokoder zna Mazury — i to jest sedno: nazwa jest poprawna, GPS-u nie ma.
  wspolrzedneMiejsca: async () => ({ nazwa: 'Mazury', lat: 53.8, lon: 21.6, promienKm: 40 }),
});

(async () => {
  const res = {};
  await trasy.handleArchiwum(
    { method: 'GET', url: '/api/archive/search?miejsce=Mazury' }, res, '/api/archive/search');
  const d = res.dane || {};
  console.log(`3. miejsce=Mazury → znaleziono ${d.znaleziono}, podpowiedź: `
    + `${d.zamiastMiejsca ? `${d.zamiastMiejsca.ile} plików po folderze` : 'BRAK'}`);
  if (d.znaleziono !== 0) {
    fail.push(`miejsce=Mazury dało ${d.znaleziono} wyników — zestaw mierzy nie tę sytuację`);
  }
  if (!d.zamiastMiejsca) {
    fail.push('zero po miejscu i ani słowa o tym, że te pliki są w folderze o tej nazwie');
  } else {
    if (d.zamiastMiejsca.ile !== godziny.length) {
      fail.push(`podpowiedź mówi o ${d.zamiastMiejsca.ile} plikach zamiast ${godziny.length}`);
    }
    if (!/folder=/.test(d.zamiastMiejsca.uwaga || '')) {
      fail.push('podpowiedź nie mówi WPROST, czego użyć zamiast miejsce=');
    }
  }

  /* Gdy miejsce działa (pliki mają GPS), podpowiedzi być NIE MA — inaczej
     doklejalibyśmy szum do każdej poprawnej odpowiedzi. */
  archiwum.dodaj([{
    id: 'onedrive:gps', zrodlo: 'onedrive', typ: 'zdjecie', nazwa: 'z-gps.jpg',
    sciezka: '/Mazury 2026/z-gps.jpg', kiedy: '2026-08-08T10:00:00',
    lat: 53.8, lon: 21.6,
  }]);
  const res2 = {};
  await trasy.handleArchiwum(
    { method: 'GET', url: '/api/archive/search?miejsce=Mazury' }, res2, '/api/archive/search');
  console.log(`   po dodaniu pliku z GPS: znaleziono ${res2.dane.znaleziono}, `
    + `podpowiedź: ${res2.dane.zamiastMiejsca ? 'JEST' : 'brak (dobrze)'}`);
  if (!res2.dane.znaleziono) fail.push('plik z GPS w promieniu nie znalazł się po miejscu');
  if (res2.dane.zamiastMiejsca) fail.push('podpowiedź dokleja się do poprawnej odpowiedzi');

  // --- 4. Model musi WIEDZIEĆ, że te filtry istnieją ----------------------
  const prompt = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const maGodziny = /godzinaOd=/.test(prompt) && /godzinaDo=/.test(prompt);
  const maOstrzezenie = /ZEGAR TO NIE PORA DNIA/.test(prompt);
  const maMiejsce = /MIEJSCE DZIAŁA PO GPS/.test(prompt);
  console.log(`4. w instrukcji: godziny ${maGodziny ? 'są' : 'BRAK'}, `
    + `ostrzeżenie o porze dnia ${maOstrzezenie ? 'jest' : 'BRAK'}, `
    + `o GPS w miejscu ${maMiejsce ? 'jest' : 'BRAK'}`);
  if (!maGodziny) fail.push('model nie wie o filtrach godzinaOd/godzinaDo — nie użyje ich');
  if (!maOstrzezenie) fail.push('nic nie odróżnia zegara od pory dnia — model znowu sięgnie po poraDnia');
  if (!maMiejsce) fail.push('model nie wie, że miejsce= wymaga GPS');

  fs.rmSync(katalog, { recursive: true, force: true });
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nARCHIWUM PO GODZINACH OK');
  process.exit(fail.length ? 1 : 0);
})();

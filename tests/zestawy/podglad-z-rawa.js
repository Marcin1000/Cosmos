/* Podgląd JPEG wyjęty z pliku RAW zamiast renderowany przez Microsoft.
 *
 *  Skąd to się wzięło. Rozdzielone stopery w panelu Marcina pokazywały przez
 *  wiele paczek to samo:
 *
 *      JPG  pobranie   309-1957 ms
 *      RAW  pobranie  7408-14101 ms
 *
 *  a 429 („zwolnij") zapalało się DOKŁADNIE w paczkach z przewagą RAW-ów.
 *  Czyli dławi się nie nasze łącze, tylko generowanie podglądów po stronie
 *  Microsoftu — i dlatego dokładanie robotników pogarszało sprawę zamiast
 *  poprawiać. Przy szesnastu pobranie RAW-a rosło do 14 s, przy czterech
 *  zostawało na 11,5 s. Tempo spadło do 0,38 zdjęcia na sekundę, czyli
 *  poniżej stanu sprzed wszystkich poprawek.
 *
 *  Aparat zapisuje gotowy podgląd WEWNĄTRZ pliku RAW — to z niego korzysta
 *  ekranik z tyłu korpusu. Graph obsługuje `Range`, więc da się go wyjąć.
 *
 *  Czego ten zestaw pilnuje. Pliki składamy tu bajt po bajcie, bo prawdziwego
 *  CR3 w repozytorium nie ma i mieć nie będzie. To znaczy, że sprawdzamy
 *  ZNAJOMOŚĆ FORMATU, nie zgodność z konkretnym egzemplarzem — i dlatego
 *  najważniejszy punkt jest ostatni: przy pliku, którego nie rozumiemy,
 *  czytnik ma powiedzieć „nie wiem", a rozpoznawanie wrócić do miniatury
 *  z Graph. Bez tego warunku nie warto było tego pisać.
 */
const raw = require('../../lib/raw-podglad.js');

const fail = [];

/** Najprostszy poprawny JPEG: znacznik początku, trochę treści, koniec. */
function jpegNaNic(bajtow, wypelniacz = 0x41) {
  const b = Buffer.alloc(bajtow, wypelniacz);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0;
  b[bajtow - 2] = 0xff; b[bajtow - 1] = 0xd9;
  return b;
}

/* --- 1. TIFF: CR2 z podglądem w paskach IFD0 ---------------------------- */
/** Zbuduj plik TIFF z jednym IFD i podanymi tagami. */
function tiff(tagi, { podglad, przesuniecieDanych = 4096 }) {
  const naglowek = Buffer.alloc(8);
  naglowek.write('II', 0, 'latin1');
  naglowek.writeUInt16LE(42, 2);
  naglowek.writeUInt32LE(8, 4);                 // IFD0 zaraz za nagłówkiem
  const ifd = Buffer.alloc(2 + tagi.length * 12 + 4);
  ifd.writeUInt16LE(tagi.length, 0);
  tagi.forEach(([tag, typ, wartosc], i) => {
    const o = 2 + i * 12;
    ifd.writeUInt16LE(tag, o);
    ifd.writeUInt16LE(typ, o + 2);
    ifd.writeUInt32LE(1, o + 4);
    if (typ === 3) ifd.writeUInt16LE(wartosc, o + 8); else ifd.writeUInt32LE(wartosc, o + 8);
  });
  const plik = Buffer.alloc(przesuniecieDanych + podglad.length, 0);
  naglowek.copy(plik, 0);
  ifd.copy(plik, 8);
  podglad.copy(plik, przesuniecieDanych);
  return plik;
}

const podgladCr2 = jpegNaNic(60000, 0x11);
const plikCr2 = tiff([
  [0x0103, 3, 6],                     // Compression = JPEG
  [0x0111, 4, 4096],                  // StripOffsets
  [0x0117, 4, podgladCr2.length],     // StripByteCounts
], { podglad: podgladCr2 });

const plan1 = raw.zaplanuj(plikCr2);
console.log(`1. CR2 (paski IFD0): plan ${plan1 ? `od ${plan1.od}, ${plan1.ile} B` : 'BRAK'}`);
if (!plan1 || plan1.od !== 4096 || plan1.ile !== podgladCr2.length) {
  fail.push('podgląd w paskach IFD0 nieodnaleziony — dla CR2 zostaje renderowanie po stronie Microsoftu');
} else {
  const jpeg = raw.wyjmijJpeg(plikCr2.subarray(plan1.od, plan1.od + plan1.ile), plan1);
  console.log(`   wyjęty JPEG: ${jpeg ? `${jpeg.length} B` : 'BRAK'}`);
  if (!jpeg || jpeg.length !== podgladCr2.length) fail.push('wycięty JPEG z CR2 ma zły rozmiar');
}

/* --- 2. TIFF: para JPEGInterchangeFormat (NEF, część DNG) --------------- */
const podgladNef = jpegNaNic(90000, 0x22);
const plikNef = tiff([
  [0x0201, 4, 4096],                  // JPEGInterchangeFormat
  [0x0202, 4, podgladNef.length],     // …Length
], { podglad: podgladNef });
const plan2 = raw.zaplanuj(plikNef);
console.log(`2. NEF (JPEGInterchangeFormat): plan ${plan2 ? `${plan2.ile} B` : 'BRAK'}`);
if (!plan2 || plan2.ile !== podgladNef.length) {
  fail.push('para JPEGInterchangeFormat nieobsłużona — NEF i część DNG zostają na starej drodze');
}

/* --- 3. Bierzemy WIĘKSZY podgląd, nie pierwszy z brzegu ----------------- */
/* Każdy RAW ma miniaturkę 160×120 obok właściwego podglądu. Wzięcie
   pierwszego z brzegu znaczyłoby, że YOLO dostaje obrazek, na którym nie ma
   czego rozpoznawać — a wynik byłby zapisany w indeksie na stałe. */
const duzy = jpegNaNic(300000, 0x33);
const plikDwa = (() => {
  const p = tiff([
    [0x0103, 3, 6],
    [0x0111, 4, 4096],
    [0x0117, 4, 20000],               // miniaturka
    [0x0201, 4, 30000],               // duży podgląd
    [0x0202, 4, duzy.length],
  ], { podglad: jpegNaNic(20000, 0x44) });
  const caly = Buffer.alloc(30000 + duzy.length, 0);
  p.copy(caly, 0);
  duzy.copy(caly, 30000);
  return caly;
})();
const plan3 = raw.zaplanuj(plikDwa);
console.log(`3. dwa podglądy w pliku: wybrano ${plan3 ? `${plan3.ile} B` : 'BRAK'} (większy ma ${duzy.length})`);
if (!plan3 || plan3.ile !== duzy.length) {
  fail.push(`wybrano podgląd ${plan3 && plan3.ile} B zamiast ${duzy.length} — YOLO dostanie miniaturkę`);
}

/* --- 4. Wielopaskowy zapis to DANE RAW, nie podgląd --------------------- */
/* Kompresja 7 z wieloma paskami znaczy „właściwy obraz pocięty na kafelki".
   Pobranie pierwszego kafelka dałoby kawałek nieodwracalnej mozaiki, a nie
   obrazek — i to jest dokładnie ten rodzaj pomyłki, który przechodzi przez
   testy na atrapie i wychodzi dopiero na prawdziwym pliku. */
const wielePaskow = (() => {
  const naglowek = Buffer.alloc(8);
  naglowek.write('II', 0, 'latin1');
  naglowek.writeUInt16LE(42, 2);
  naglowek.writeUInt32LE(8, 4);
  const tagi = [[0x0103, 3, 7], [0x0111, 4, 1000], [0x0117, 4, 900]];
  const ifd = Buffer.alloc(2 + tagi.length * 12 + 4);
  ifd.writeUInt16LE(tagi.length, 0);
  tagi.forEach(([tag, typ, wartosc], i) => {
    const o = 2 + i * 12;
    ifd.writeUInt16LE(tag, o);
    ifd.writeUInt16LE(typ, o + 2);
    // Cztery paski, nie jeden — wartości leżą pod adresem.
    ifd.writeUInt32LE(tag === 0x0103 ? 1 : 4, o + 4);
    if (typ === 3) ifd.writeUInt16LE(wartosc, o + 8); else ifd.writeUInt32LE(2048, o + 8);
  });
  const plik = Buffer.alloc(8192, 0);
  naglowek.copy(plik, 0);
  ifd.copy(plik, 8);
  for (let k = 0; k < 4; k++) plik.writeUInt32LE(3000 + k * 1000, 2048 + k * 4);
  return plik;
})();
const plan4 = raw.zaplanuj(wielePaskow);
console.log(`4. wielopaskowy RAW: plan ${plan4 ? `od ${plan4.od}, ${plan4.ile} B` : 'BRAK (dobrze)'}`);
if (plan4) fail.push('wielopaskowe dane RAW wzięte za podgląd — do YOLO poleci kawałek mozaiki');

/* --- 5. CR3: pudełko PRVW wewnątrz moov --------------------------------- */
function pudelko(nazwa, tresc) {
  const b = Buffer.alloc(8 + tresc.length);
  b.writeUInt32BE(8 + tresc.length, 0);
  b.write(nazwa, 4, 'latin1');
  tresc.copy(b, 8);
  return b;
}
function pudelkoUuid(tresc) {
  const b = Buffer.alloc(24 + tresc.length);
  b.writeUInt32BE(24 + tresc.length, 0);
  b.write('uuid', 4, 'latin1');
  tresc.copy(b, 24);
  return b;
}
const podgladCr3 = jpegNaNic(240000, 0x55);
const thumbCr3 = jpegNaNic(9000, 0x66);
/* Nagłówek PRVW ma przed JPEG-iem kilkanaście bajtów pól, których układu
   nie odliczamy na sztywno — czytnik ma znaleźć znacznik początku obrazka
   w granicach pudełka. Dlatego tu też wstawiamy „śmieci" przed obrazkiem. */
const prvw = pudelko('PRVW', Buffer.concat([Buffer.alloc(16, 0), podgladCr3]));
const thmb = pudelko('THMB', Buffer.concat([Buffer.alloc(16, 0), thumbCr3]));
const moov = pudelko('moov', pudelkoUuid(Buffer.concat([thmb, prvw])));
const plikCr3 = Buffer.concat([
  pudelko('ftyp', Buffer.from('crx isom', 'latin1')),
  moov,
  pudelko('mdat', Buffer.alloc(1000, 0)),
]);

const plan5 = raw.zaplanuj(plikCr3);
console.log(`5. CR3: plan ${plan5 ? `od ${plan5.od}, ${plan5.ile} B, wytnij=${plan5.wytnij}` : 'BRAK'}`);
if (!plan5 || !plan5.wytnij) {
  fail.push('moov w CR3 nieodnaleziony — 6786 plików CR3 zostaje na renderowaniu przez Microsoft');
} else {
  const jpeg5 = raw.wyjmijJpeg(plikCr3.subarray(plan5.od, plan5.od + plan5.ile), plan5);
  console.log(`   wyjęty JPEG: ${jpeg5 ? `${jpeg5.length} B` : 'BRAK'} (PRVW ma ${podgladCr3.length}, THMB ${thumbCr3.length})`);
  if (!jpeg5) {
    fail.push('z moov nie udało się wyjąć JPEG-a');
  } else if (jpeg5.length !== podgladCr3.length) {
    fail.push(`z CR3 wyjęto ${jpeg5.length} B zamiast ${podgladCr3.length} — to miniaturka THMB, nie podgląd PRVW`);
  }
}

/* --- 6. NIE ROZUMIEM = mówię „nie wiem" --------------------------------- */
/* Najważniejszy punkt zestawu. Czytnik składany na atrapach NA PEWNO trafi
   u Marcina na plik, którego nie przewidziałem — format Samsunga, obcięty
   plik z uszkodzonej karty, TIFF z tagami w innej kolejności. Wtedy ma
   oddać `null`, a nie zgadywać: rozpoznawanie wróci wtedy do miniatury
   z Graph, czyli do stanu sprzed tej zmiany. */
const nieznane = [
  ['pusty', Buffer.alloc(0)],
  ['same zera', Buffer.alloc(5000, 0)],
  ['zwykły JPEG', jpegNaNic(5000)],
  ['obcięty TIFF', plikCr2.subarray(0, 12)],
  ['TIFF bez podglądu', tiff([[0x0103, 3, 1]], { podglad: Buffer.alloc(0) })],
  ['BMFF bez moov', Buffer.concat([pudelko('ftyp', Buffer.from('isom', 'latin1')),
    pudelko('mdat', Buffer.alloc(2000, 0))])],
  ['losowe bajty', Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 37) % 256))],
];
const zgadnieta = [];
for (const [opis, b] of nieznane) {
  let plan = 'wyjątek';
  try { plan = raw.zaplanuj(b); } catch (err) { plan = `WYJĄTEK: ${err.message}`; }
  if (plan) zgadnieta.push(`${opis} → ${JSON.stringify(plan)}`);
}
console.log(`6. plików, których nie rozumiemy: ${nieznane.length}, z tego zgadniętych: ${zgadnieta.length}`);
for (const z of zgadnieta) console.log(`   ${z}`);
if (zgadnieta.length) {
  fail.push(`czytnik zgaduje przy nieznanym pliku (${zgadnieta.length}) — zamiast wrócić do miniatury z Graph`);
}

/* --- 7. Wyjmowanie też nie może wywracać ani przepuszczać śmieci -------- */
const smieci = [
  ['nie-JPEG', Buffer.alloc(50000, 0x7a)],
  ['sam znacznik początku', Buffer.from([0xff, 0xd8, 0xff])],
  ['JPEG za krótki', jpegNaNic(100)],
];
const przepuszczone = [];
for (const [opis, b] of smieci) {
  let out = null;
  try { out = raw.wyjmijJpeg(b, { wytnij: false }); } catch (err) { out = `WYJĄTEK: ${err.message}`; }
  if (out) przepuszczone.push(`${opis} → ${out.length || out}`);
}
console.log(`7. śmieci przepuszczonych jako obrazek: ${przepuszczone.length}`);
for (const z of przepuszczone) console.log(`   ${z}`);
if (przepuszczone.length) {
  fail.push('wyjmowanie przepuszcza coś, co nie jest obrazkiem — YOLO dostanie śmieci i zapisze wynik na stałe');
}

/* --- 8. CAŁA DROGA: rozpoznawanie bierze podgląd z pliku, a gdy się nie da,
       wraca do miniatury z Graph ------------------------------------------
   Punkty 1-7 sprawdzają sam czytnik. Ten sprawdza to, co z niego wynika:
   czy przy RAW-ie z czytelnym podglądem NIE PYTAMY Graph o miniaturę
   (bo to jest te 11,5 s), a przy pliku, którego nie rozumiemy, pytamy jak
   dotąd i nic nie przepada. */
(async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const http = require('http');

  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'podglad-raw-'));
  const archiwum = require('../../lib/archiwum.js').utworz(kat);
  const zdj = (id, sciezka, kiedy) => ({
    id: `onedrive:${id}`, zrodlo: 'onedrive', typ: 'zdjecie',
    nazwa: sciezka.split('/').pop(), sciezka, kiedy,
  });
  archiwum.dodaj([
    zdj('cr3', '/Mazury 2026/3B9A4860.CR3', '2026-06-21T10:00:00'),
    zdj('cr2', '/Wesele/IMG_2001.CR2', '2024-09-07T14:05:33'),
    zdj('dziwny', '/Skan/staredzieje.tif', '2010-01-01T09:00:00'),
  ]);

  const serwer = http.createServer((req, res) => {
    if (/detect/.test(req.url)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ objects: [{ label: 'boat', conf: 0.9 }] }));
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    return res.end(jpegNaNic(3000));
  });
  await new Promise((r) => serwer.listen(0, r));
  const port = serwer.address().port;

  // Plik „dziwny" to sam nagłówek TIFF bez podglądu — czytnik ma odpaść.
  const pliki = {
    cr3: plikCr3,
    cr2: plikCr2,
    dziwny: tiff([[0x0103, 3, 1]], { podglad: Buffer.alloc(0) }),
  };
  const pytanoOMiniature = [];
  let zakresow = 0;
  const trasy = require('../../lib/archiwum-trasy.js').utworz({
    archiwum,
    onedrive: {
      polaczony: () => true,
      graf: async (sciezka) => {
        pytanoOMiniature.push(decodeURIComponent(String(sciezka).split('/items/')[1].split('/')[0]));
        return { url: `http://127.0.0.1:${port}/mini.jpg` };
      },
      kawalekPliku: async (id, od, ile) => {
        zakresow++;
        const p = pliki[id];
        if (!p) return null;
        return p.subarray(od, Math.min(od + ile, p.length));
      },
    },
    SENSES_URL: `http://127.0.0.1:${port}`,
    sendJson: (res2, kod, dane) => { res2.kod = kod; res2.dane = dane; },
    readJson: async () => ({ ile: 10 }),
    addEvent: () => {},
    sensesState: async () => ({ online: true, caps: { yolo: true } }),
    wspolrzedneMiejsca: async () => null,
  });
  const res = {};
  await trasy.handleArchiwum(
    { method: 'POST', url: '/api/archive/vision' }, res, '/api/archive/vision');
  serwer.close();
  const d = res.dane || {};
  const zPliku = (d.czasy && d.czasy.zPliku || 0) + (d.czasyRaw && d.czasyRaw.zPliku || 0);
  console.log(`8. trzy pliki: żądań zakresowych ${zakresow}, `
    + `podglądów z pliku ${zPliku}, o miniaturę pytano ${pytanoOMiniature.length}× `
    + `(${pytanoOMiniature.join(', ') || '—'})`);
  console.log(`   opisane ${d.opisane}, zostało ${d.zostalo}`);
  if (zPliku !== 2) {
    fail.push(`podglądów z pliku ${zPliku} zamiast 2 — CR3 i CR2 dalej czekają na render Microsoftu`);
  }
  if (pytanoOMiniature.length !== 1 || !pytanoOMiniature.includes('dziwny')) {
    fail.push(`o miniaturę pytano dla [${pytanoOMiniature}] — spodziewane tylko dla pliku bez podglądu`);
  }
  /* Najważniejsze: plik, którego czytnik nie rozumie, MUSI zostać opisany
     starą drogą. Inaczej nowa ścieżka nie przyspiesza, tylko gubi zdjęcia. */
  if (d.opisane !== 3 || d.zostalo !== 0) {
    fail.push(`opisano ${d.opisane} z 3, zostało ${d.zostalo} — powrót do miniatury nie działa`);
  }
  fs.rmSync(kat, { recursive: true, force: true });

  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPODGLĄD Z RAW-A OK');
  process.exit(fail.length ? 1 : 0);
})();

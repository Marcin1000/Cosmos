/* PODGLĄD JPEG ZASZYTY W PLIKU RAW — bez pobierania całego pliku.
 *
 *  Po co to w ogóle jest
 *  ---------------------
 *  Rozpoznawanie treści potrzebuje obrazka. Dotąd braliśmy miniaturę
 *  z Microsoft Graph i dla JPEG-ów jest to znakomite — Graph oddaje gotowy
 *  plik z półki w niecałą sekundę. Dla RAW-a gotowego pliku NIE MA: Graph
 *  musi zdekodować RAW-a u siebie i wyrenderować podgląd. Zmierzone
 *  u Marcina, konsekwentnie przez wiele paczek:
 *
 *      JPG  pobranie   309-1957 ms
 *      RAW  pobranie  7408-14101 ms
 *
 *  I — co ważniejsze — 429 („zwolnij") pojawiało się DOKŁADNIE w paczkach
 *  z przewagą RAW-ów. To nie nasze łącze się dławi, tylko generowanie
 *  podglądów po stronie Microsoftu. Dlatego zwiększanie równoległości tam
 *  nie pomagało: przy szesnastu robotnikach pobranie RAW-a rosło do 14 s,
 *  przy czterech zostawało na 11,5 s. Ścieżka wyczerpana.
 *
 *  Ale każdy aparat ZAPISUJE gotowy podgląd JPEG wewnątrz pliku RAW — to
 *  z niego korzysta ekranik z tyłu korpusu. Wystarczy go stamtąd wyjąć.
 *  Graph obsługuje nagłówek `Range`, więc pobieramy dwa kawałki zamiast
 *  całego pliku: początek (żeby przeczytać, gdzie podgląd leży) i sam
 *  podgląd. Tą samą drogą chodzi już dociąganie EXIF-u i jest szybka.
 *
 *  Dwa rodziny formatów, obie u Marcina obecne
 *  -------------------------------------------
 *  • TIFF-owe: CR2 (6180 plików), DNG (870), NEF (34), TIF (78), a przy
 *    okazji ARW i SRW. Podgląd wskazują tagi IFD — albo para
 *    (JPEGInterchangeFormat, …Length), albo (StripOffsets, StripByteCounts)
 *    przy kompresji JPEG.
 *  • ISO-BMFF: CR3 (6786 plików) — ten sam szkielet pudełek co MP4.
 *    Podgląd siedzi w pudełku `PRVW` wewnątrz `moov`, miniaturka w `THMB`.
 *
 *  Zasada: NIGDY nie zgadujemy w ciemno
 *  ------------------------------------
 *  Każdy plan kończy się sprawdzeniem, czy pobrane bajty naprawdę zaczynają
 *  się od znacznika JPEG. Gdy cokolwiek nie pasuje — nieznany format, dziwny
 *  układ tagów, obcięty plik — oddajemy `null`, a wywołujący wraca do
 *  miniatury z Graph. Gorzej niż było być nie może; to jest warunek, pod
 *  którym w ogóle warto było to pisać.
 */

'use strict';

/* Podgląd mniejszy niż to nie nadaje się do rozpoznawania (miniaturka
   160×120 z THMB), większy niż to znaczy, że trafiliśmy w same dane RAW
   i pobieranie kosztowałoby więcej niż miniatura z Graph. */
const MIN_B = 8 * 1024;
const MAX_B = 6 * 1024 * 1024;
// Zapory na wypadek pliku uszkodzonego albo celowo dziwnego.
const MAX_IFD = 24;
const MAX_WPISOW = 400;
const MAX_PUDELEK = 400;

const ROZMIAR_TYPU = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/** Czy bufor zaczyna się od nagłówka TIFF-a (a więc CR2/NEF/DNG/ARW/TIF). */
function jestTiff(buf) {
  if (!buf || buf.length < 8) return false;
  const znak = buf.toString('latin1', 0, 2);
  if (znak !== 'II' && znak !== 'MM') return false;
  const magia = znak === 'II' ? buf.readUInt16LE(2) : buf.readUInt16BE(2);
  return magia === 42;
}

/** Czy bufor zaczyna się od pudełka `ftyp` (a więc CR3/MP4/HEIC). */
function jestBmff(buf) {
  return Boolean(buf && buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp');
}

/* --- TIFF ---------------------------------------------------------------
   Nagłówek wskazuje pierwszy IFD, każdy IFD wskazuje następny. Do tego
   tag 0x014A (SubIFDs) rozgałęzia drzewo — i to WŁAŚNIE tam Nikon i DNG
   trzymają duży podgląd, więc pominięcie gałęzi znaczyłoby, że dla NEF-a
   znajdujemy tylko miniaturkę 160×120. */
function podgladyTiff(buf) {
  const le = buf.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));

  const znalezione = [];
  const doOdwiedzenia = [u32(4)];
  const odwiedzone = new Set();
  let licznik = 0;

  while (doOdwiedzenia.length && licznik++ < MAX_IFD) {
    const start = doOdwiedzenia.shift();
    if (!start || odwiedzone.has(start) || start + 2 > buf.length) continue;
    odwiedzone.add(start);
    const ile = u16(start);
    if (ile > MAX_WPISOW || start + 2 + ile * 12 + 4 > buf.length) continue;

    const tagi = new Map();
    for (let i = 0; i < ile; i++) {
      const o = start + 2 + i * 12;
      const tag = u16(o);
      const typ = u16(o + 2);
      const liczba = u32(o + 4);
      const bajtow = (ROZMIAR_TYPU[typ] || 0) * liczba;
      /* Wartość mieści się w czterech bajtach wpisu albo leży pod adresem
         zapisanym w tych czterech bajtach — to jest cała sztuczka TIFF-a. */
      const wartosci = [];
      if (bajtow && bajtow <= 4) {
        for (let k = 0; k < liczba && k < 8; k++) {
          const p = o + 8 + k * ROZMIAR_TYPU[typ];
          wartosci.push(ROZMIAR_TYPU[typ] === 2 ? u16(p) : (ROZMIAR_TYPU[typ] === 4 ? u32(p) : buf[p]));
        }
      } else if (bajtow) {
        const adres = u32(o + 8);
        for (let k = 0; k < liczba && k < 8; k++) {
          const p = adres + k * ROZMIAR_TYPU[typ];
          if (p + ROZMIAR_TYPU[typ] > buf.length) break;
          wartosci.push(ROZMIAR_TYPU[typ] === 2 ? u16(p) : (ROZMIAR_TYPU[typ] === 4 ? u32(p) : buf[p]));
        }
      }
      tagi.set(tag, wartosci);
    }

    for (const pod of tagi.get(0x014a) || []) doOdwiedzenia.push(pod);
    const nastepny = u32(start + 2 + ile * 12);
    if (nastepny) doOdwiedzenia.push(nastepny);

    /* Dwa sposoby zapisania podglądu, oba spotykane w plikach Marcina:
       para JPEGInterchangeFormat (Canon CR2 w IFD1) i para StripOffsets
       przy kompresji 6 albo 7 (CR2 w IFD0, DNG, NEF). */
    const kandydat = (od, dlugosc) => {
      if (!od || !dlugosc || dlugosc < MIN_B || dlugosc > MAX_B) return;
      znalezione.push({ od, ile: dlugosc });
    };
    kandydat((tagi.get(0x0201) || [])[0], (tagi.get(0x0202) || [])[0]);
    const kompresja = (tagi.get(0x0103) || [])[0];
    const paski = tagi.get(0x0111) || [];
    const dlugosci = tagi.get(0x0117) || [];
    /* JEDEN pasek, nie wiele. Wielopaskowy zapis przy kompresji 7 to
       właściwe dane RAW pocięte na kafelki — pobranie pierwszego kafelka
       dałoby nam kawałek nieodwracalnego mozaiku zamiast obrazka. */
    if ((kompresja === 6 || kompresja === 7) && paski.length === 1 && dlugosci.length === 1) {
      kandydat(paski[0], dlugosci[0]);
    }
  }
  return znalezione;
}

/* --- ISO-BMFF (CR3) -----------------------------------------------------
   Plik to drzewo pudełek: 4 bajty rozmiaru, 4 bajty nazwy, potem treść.
   `moov` jest pojemnikiem i w nim, wewnątrz pudełek `uuid`, siedzą `PRVW`
   (podgląd ~1620×1080) i `THMB` (miniaturka). Nie znamy z góry układu
   nagłówka wewnątrz PRVW, więc nie odliczamy bajtów na sztywno — szukamy
   znacznika początku JPEG-a W GRANICACH tego pudełka. */
const POJEMNIKI = new Set(['moov', 'uuid', 'trak', 'mdia', 'minf', 'stbl', 'CMTA']);

function przejdzPudelka(buf, od, koniec, naPudelko, glebokosc = 0) {
  let p = od;
  let licznik = 0;
  while (p + 8 <= koniec && licznik++ < MAX_PUDELEK) {
    let rozmiar = buf.readUInt32BE(p);
    const nazwa = buf.toString('latin1', p + 4, p + 8);
    let tresc = p + 8;
    if (rozmiar === 1) {
      // Rozmiar 64-bitowy. Górne cztery bajty ignorujemy: pudełko większe
      // niż 4 GB i tak jest poza zasięgiem tego, co chcemy pobierać.
      if (p + 16 > koniec) return;
      rozmiar = buf.readUInt32BE(p + 12);
      tresc = p + 16;
    } else if (rozmiar === 0) {
      rozmiar = koniec - p;                       // pudełko do końca pliku
    }
    if (rozmiar < 8) return;
    const kres = Math.min(p + rozmiar, koniec);
    if (nazwa === 'uuid') tresc += 16;            // 16 bajtów identyfikatora
    naPudelko(nazwa, tresc, kres, p, p + rozmiar);
    if (POJEMNIKI.has(nazwa) && glebokosc < 6 && tresc < kres) {
      przejdzPudelka(buf, tresc, kres, naPudelko, glebokosc + 1);
    }
    p += rozmiar;
  }
}

/** Gdzie w pliku leży `moov` — jedyne pudełko, którego potrzebujemy. */
function zakresMoov(buf) {
  let wynik = null;
  przejdzPudelka(buf, 0, buf.length, (nazwa, tresc, kres, poczatek, kresPelny) => {
    if (nazwa === 'moov' && !wynik) wynik = { od: poczatek, ile: kresPelny - poczatek };
  });
  return wynik;
}

/** Wytnij największy JPEG z pudełek PRVW/THMB wewnątrz pobranego `moov`. */
function jpegZMoov(buf) {
  let najlepszy = null;
  przejdzPudelka(buf, 0, buf.length, (nazwa, tresc, kres) => {
    if (nazwa !== 'PRVW' && nazwa !== 'THMB') return;
    const soi = szukajSoi(buf, tresc, kres);
    if (soi < 0) return;
    const kawalek = przytnijJpeg(buf.subarray(soi, kres));
    if (kawalek && (!najlepszy || kawalek.length > najlepszy.length)) najlepszy = kawalek;
  });
  return najlepszy;
}

function szukajSoi(buf, od, doKad) {
  for (let i = od; i + 3 < doKad; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) return i;
  }
  return -1;
}

/** Obetnij na ostatnim znaczniku końca JPEG-a. Bez tego do YOLO poleciałby
 *  obrazek z doklejonym ogonem pudełka — dekodery zwykle to wybaczają,
 *  ale „zwykle" to za mało, żeby na tym opierać cały przebieg. */
function przytnijJpeg(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  for (let i = buf.length - 2; i > 1; i--) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd9) return buf.subarray(0, i + 2);
  }
  return null;
}

/** PLAN POBRANIA PODGLĄDU na podstawie początku pliku.
 *
 *  Zwraca `{ od, ile, wytnij }` albo `null`, gdy nic pewnego nie widać.
 *  `wytnij: true` znaczy „pobrany kawałek to pojemnik, przepuść go jeszcze
 *  przez `wyjmijJpeg`"; `false` — „pobrany kawałek JEST JPEG-iem".
 */
function zaplanuj(buf) {
  try {
    if (jestTiff(buf)) {
      const kandydaci = podgladyTiff(buf);
      if (!kandydaci.length) return null;
      // Największy sensowny = najlepszej jakości podgląd, nie miniaturka.
      const naj = kandydaci.sort((a, b) => b.ile - a.ile)[0];
      return { od: naj.od, ile: naj.ile, wytnij: false, format: 'tiff' };
    }
    if (jestBmff(buf)) {
      const moov = zakresMoov(buf);
      if (!moov || moov.ile < MIN_B || moov.ile > MAX_B) return null;
      return { od: moov.od, ile: moov.ile, wytnij: true, format: 'bmff' };
    }
  } catch { /* uszkodzony plik — niżej `null`, wywołujący weźmie miniaturę */ }
  return null;
}

/** Zamień pobrany kawałek na gotowy JPEG (albo `null`, gdy to nie wyszło). */
function wyjmijJpeg(buf, plan) {
  try {
    if (!buf || !buf.length) return null;
    const jpeg = plan && plan.wytnij ? jpegZMoov(buf) : przytnijJpeg(buf);
    if (!jpeg || jpeg.length < MIN_B) return null;
    return jpeg;
  } catch {
    return null;
  }
}

module.exports = { zaplanuj, wyjmijJpeg, jestTiff, jestBmff, MIN_B, MAX_B };

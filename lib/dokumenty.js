/* ============================================================
   Czytanie dokumentów bez ani jednej zewnętrznej biblioteki

   Cosmos umiał już wyciągać tekst z PDF-ów i Office'a — ale wyłącznie przez
   usługę zmysłów na komputerze domowym. Ten komputer zwykle jest wyłączony,
   więc w praktyce wczytanie umowy z telefonu nie działało nigdy.

   Tutaj to samo robi sam serwer. DOCX, XLSX i PPTX to zwykłe archiwa ZIP
   z XML-em w środku, a ZIP-a rozpakuje `zlib`, który Node ma w standardzie.
   PDF jest trudniejszy i czasem trzeba oddać go zmysłom — ale „czasem"
   to nie „zawsze".
   ============================================================ */

const zlib = require('node:zlib');

// ---------------------------------------------------------------------------
// ZIP — tyle, ile potrzeba, żeby wyjąć jeden plik z archiwum
// ---------------------------------------------------------------------------

const SIG_EOCD = 0x06054b50;      // koniec katalogu centralnego
const SIG_CEN = 0x02014b50;       // wpis w katalogu centralnym

/** Znajdź katalog centralny i wypisz, co jest w archiwum. */
function wpisyZip(buf) {
  // EOCD leży na końcu, ale może mieć po sobie komentarz (do 64 kB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const ile = buf.readUInt16LE(eocd + 10);
  let poz = buf.readUInt32LE(eocd + 16);

  const wpisy = [];
  for (let n = 0; n < ile && poz + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(poz) !== SIG_CEN) break;
    const metoda = buf.readUInt16LE(poz + 10);
    const spakowany = buf.readUInt32LE(poz + 20);
    const dlNazwy = buf.readUInt16LE(poz + 28);
    const dlExtra = buf.readUInt16LE(poz + 30);
    const dlKom = buf.readUInt16LE(poz + 32);
    const offsetLok = buf.readUInt32LE(poz + 42);
    const nazwa = buf.toString('utf8', poz + 46, poz + 46 + dlNazwy);
    wpisy.push({ nazwa, metoda, spakowany, offsetLok });
    poz += 46 + dlNazwy + dlExtra + dlKom;
  }
  return wpisy;
}

/** Rozpakuj jeden wpis. Zwraca '' zamiast rzucać — uszkodzony plik nie może
 *  wywalić rozmowy. */
function zZip(buf, wpis) {
  try {
    const p = wpis.offsetLok;
    if (buf.readUInt32LE(p) !== 0x04034b50) return '';
    const dlNazwy = buf.readUInt16LE(p + 26);
    const dlExtra = buf.readUInt16LE(p + 28);
    const start = p + 30 + dlNazwy + dlExtra;
    const dane = buf.subarray(start, start + wpis.spakowany);
    if (wpis.metoda === 0) return dane.toString('utf8');
    if (wpis.metoda === 8) return zlib.inflateRawSync(dane).toString('utf8');
    return '';
  } catch { return ''; }
}

function plikZZip(buf, wpisy, nazwa) {
  const w = wpisy.find((x) => x.nazwa === nazwa);
  return w ? zZip(buf, w) : '';
}

// ---------------------------------------------------------------------------
// XML → tekst
// ---------------------------------------------------------------------------

const ENCJE = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function odkodujXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (c, n) => ENCJE[n.toLowerCase()] ?? c);
}

const bezZnacznikow = (s) => odkodujXml(s.replace(/<[^>]*>/g, '')).replace(/[ \t]+/g, ' ').trim();

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

// Znacznik końca komórki tabeli. Musi być czymś, co nie wystąpi w treści
// dokumentu — stąd znak sterujący, a nie kreska czy średnik.
const KOMORKA = '\u0000';

function zDocx(buf) {
  const wpisy = wpisyZip(buf);
  const xml = plikZZip(buf, wpisy, 'word/document.xml');
  if (!xml) return '';
  const zAkapitami = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    /* Kolejność jest tu istotna. Komórka tabeli zawiera akapit, więc gdyby
       `</w:p>` zamieniać na nowy wiersz jako pierwsze, każda komórka lądowałaby
       w osobnej linii i tabela rozsypywała się na pionowy słupek. */
    .replace(/<\/w:p>\s*<\/w:tc>/g, KOMORKA)
    .replace(/<\/w:tc>/g, KOMORKA)
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n');

  return odkodujXml(zAkapitami.replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((linia) => {
      if (!linia.includes(KOMORKA)) return linia.trim();
      const komorki = linia.split(KOMORKA).map((c) => c.trim());
      // Po ostatniej komórce zostaje pusty ogon — to nie jest kolumna.
      if (komorki[komorki.length - 1] === '') komorki.pop();
      return komorki.join(' | ');
    })
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// XLSX — arkusze, nazwy arkuszy i teksty współdzielone
// ---------------------------------------------------------------------------

const LITERY = (ref) => (String(ref).match(/^[A-Z]+/) || [''])[0];
const numerKolumny = (litery) => [...litery].reduce((n, z) => n * 26 + (z.charCodeAt(0) - 64), 0);

function zXlsx(buf, maxWierszy = 3000) {
  const wpisy = wpisyZip(buf);
  if (!wpisy.length) return '';

  // Teksty współdzielone: arkusz trzyma numer, nie treść.
  const ss = plikZZip(buf, wpisy, 'xl/sharedStrings.xml');
  const teksty = ss
    ? [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => bezZnacznikow(m[1]))
    : [];

  // Nazwy arkuszy z workbook.xml; kolejność plików sheetN.xml jej odpowiada.
  const wb = plikZZip(buf, wpisy, 'xl/workbook.xml');
  const nazwy = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => odkodujXml(m[1]));

  const arkusze = wpisy
    .filter((w) => /^xl\/worksheets\/sheet\d+\.xml$/.test(w.nazwa))
    .sort((a, b) => Number(a.nazwa.match(/\d+/)[0]) - Number(b.nazwa.match(/\d+/)[0]));

  const linie = [];
  arkusze.forEach((w, i) => {
    const xml = zZip(buf, w);
    if (!xml) return;
    linie.push(`## Arkusz: ${nazwy[i] || `#${i + 1}`}`);
    for (const wiersz of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      if (linie.length > maxWierszy) { linie.push('… (arkusz przycięty)'); return; }
      const komorki = [];
      let ostatnia = 0;
      for (const c of wiersz[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const atr = c[1];
        const ref = (atr.match(/r="([A-Z]+\d+)"/) || [])[1] || '';
        const nr = ref ? numerKolumny(LITERY(ref)) : ostatnia + 1;
        // Puste kolumny w środku wiersza muszą zostać puste, inaczej dane
        // przesuwają się w lewo i tabela przestaje się zgadzać.
        while (ostatnia + 1 < nr) { komorki.push(''); ostatnia++; }
        ostatnia = nr;
        const typ = (atr.match(/t="([^"]+)"/) || [])[1] || 'n';
        const v = (c[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        const isr = (c[2].match(/<is>([\s\S]*?)<\/is>/) || [])[1];
        let wartosc = '';
        if (typ === 's' && v !== undefined) wartosc = teksty[Number(v)] ?? '';
        else if (typ === 'inlineStr' && isr !== undefined) wartosc = bezZnacznikow(isr);
        else if (v !== undefined) wartosc = odkodujXml(v);
        komorki.push(wartosc);
      }
      // Wiersz z samych pustych komórek nie niesie nic.
      if (komorki.some((x) => x !== '')) linie.push(komorki.join(' | '));
    }
  });
  return linie.join('\n');
}

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

function zPptx(buf) {
  const wpisy = wpisyZip(buf);
  const slajdy = wpisy
    .filter((w) => /^ppt\/slides\/slide\d+\.xml$/.test(w.nazwa))
    .sort((a, b) => Number(a.nazwa.match(/\d+/)[0]) - Number(b.nazwa.match(/\d+/)[0]));
  const linie = [];
  slajdy.forEach((w, i) => {
    const xml = zZip(buf, w);
    if (!xml) return;
    linie.push(`## Slajd ${i + 1}`);
    for (const p of xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
      const tekst = [...p[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => odkodujXml(m[1])).join('');
      if (tekst.trim()) linie.push(tekst.trim());
    }
  });
  return linie.join('\n');
}

// ---------------------------------------------------------------------------
// PDF
//
// Tekst siedzi w strumieniach zawartości, zwykle spakowanych FlateDecode,
// jako operatory `(tekst) Tj` albo `[(a) -20 (b)] TJ`. To wystarcza dla
// PDF-ów wygenerowanych cyfrowo. Skanów i egzotycznych kodowań czcionek
// tak się nie odczyta — od tego jest OCR w zmysłach, a `wygladaNaSkan()`
// mówi, kiedy trzeba po nie sięgnąć.
// ---------------------------------------------------------------------------

function odkodujPdfString(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { out += s[i]; continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 't') out += '\t';
    else if (n === 'b' || n === 'f') out += ' ';
    else if (n >= '0' && n <= '7') {
      let osemkowo = n;
      while (osemkowo.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') osemkowo += s[++i];
      out += String.fromCharCode(parseInt(osemkowo, 8));
    } else out += n;                    // \\ \( \) i reszta
  }
  return out;
}

/** Wyciągnij literały tekstowe z jednego strumienia zawartości. */
function tekstZeStrumienia(tresc) {
  const linie = [];
  let biezaca = '';
  // Operatory rozdzielające akapity: Td/TD/T*/ET kończą linijkę.
  const re = /\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^\][\\]|\\.)*\]\s*TJ|T\*|Td|TD|ET/g;
  for (const m of tresc.match(re) || []) {
    if (/^(T\*|Td|TD|ET)$/.test(m)) {
      if (biezaca.trim()) linie.push(biezaca.trim());
      biezaca = '';
      continue;
    }
    if (m.endsWith('Tj')) {
      const s = m.slice(m.indexOf('(') + 1, m.lastIndexOf(')'));
      biezaca += odkodujPdfString(s);
    } else {
      /* [(Ala) -250 (ma) -250 (kota)] TJ — liczby to przesunięcia w tysięcznych
         firetu, i to WŁAŚNIE NIMI PDF robi spacje między słowami. Bez tego
         „Sprzedawca:” i „Marcin” sklejały się w jedno słowo. Próg -100 to
         mniej więcej jedna dziesiąta firetu: mniejsze wartości to kerning
         wewnątrz słowa, większe — odstęp. */
      for (const cz of m.matchAll(/\((?:\\.|[^\\()])*\)|-?[\d.]+/g)) {
        const kawalek = cz[0];
        if (kawalek[0] === '(') biezaca += odkodujPdfString(kawalek.slice(1, -1));
        else if (Number(kawalek) < -100 && !/\s$/.test(biezaca)) biezaca += ' ';
      }
    }
  }
  if (biezaca.trim()) linie.push(biezaca.trim());
  return linie.join('\n');
}

function zPdf(buf, maxZnakow = 200000) {
  const kawalki = [];
  let poz = 0;
  // Szukamy po bajtach: `stream` … `endstream`. Zawartość bywa binarna,
  // więc nie da się tego zrobić na stringu bez psucia danych.
  const START = Buffer.from('stream');
  const KONIEC = Buffer.from('endstream');
  while (poz < buf.length) {
    const a = buf.indexOf(START, poz);
    if (a < 0) break;
    const b = buf.indexOf(KONIEC, a);
    if (b < 0) break;
    let s = a + START.length;
    if (buf[s] === 0x0d) s++;
    if (buf[s] === 0x0a) s++;
    let e = b;
    if (buf[e - 1] === 0x0a) e--;
    if (buf[e - 1] === 0x0d) e--;
    const dane = buf.subarray(s, e);
    poz = b + KONIEC.length;
    if (!dane.length) continue;

    let tekst = '';
    try {
      tekst = zlib.inflateSync(dane).toString('latin1');
    } catch {
      try { tekst = zlib.inflateRawSync(dane).toString('latin1'); }
      catch { tekst = dane.toString('latin1'); }   // strumień nieskompresowany
    }
    if (!/(Tj|TJ)\b/.test(tekst)) continue;        // to nie strumień z tekstem
    const wyjete = tekstZeStrumienia(tekst);
    if (wyjete) kawalki.push(wyjete);
    if (kawalki.join('\n').length > maxZnakow) break;
  }
  return kawalki.join('\n').slice(0, maxZnakow);
}

/** Czy z tego PDF-a wyszło tak mało, że to zapewne skan?
 *  Wtedy warto spróbować OCR-em, zamiast oddawać użytkownikowi pustkę. */
function wygladaNaSkan(tekst, buf) {
  const dlugosc = tekst.trim().length;
  if (dlugosc < 20) return true;                // praktycznie nic nie wyszło
  /* Sama długość tekstu nie wystarczy: jednostronicowa faktura ma legalnie
     kilkadziesiąt znaków i przy progu „mało znaków = skan" szła niepotrzebnie
     do OCR. Skan poznaje się po PROPORCJI — to obrazy, więc setki kilobajtów
     na stronę przy zerowej treści. Mały plik z paroma zdaniami skanem nie jest. */
  const kb = buf.length / 1024;
  return kb > 50 && dlugosc / kb < 1;
}

// ---------------------------------------------------------------------------
// CSV / TSV — do tabelki, którą model faktycznie przeczyta
// ---------------------------------------------------------------------------

function podzielCsv(linia, sep) {
  const pola = [];
  let biez = '';
  let wCudzyslowie = false;
  for (let i = 0; i < linia.length; i++) {
    const z = linia[i];
    if (wCudzyslowie) {
      if (z === '"' && linia[i + 1] === '"') { biez += '"'; i++; }
      else if (z === '"') wCudzyslowie = false;
      else biez += z;
    } else if (z === '"') wCudzyslowie = true;
    else if (z === sep) { pola.push(biez); biez = ''; }
    else biez += z;
  }
  pola.push(biez);
  return pola;
}

function zCsv(tekst, maxWierszy = 500) {
  const linie = tekst.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!linie.length) return '';
  // Separator zgadujemy z pierwszej linii — średnik jest w polskim Excelu normą.
  const pierwsza = linie[0];
  const sep = [';', '\t', ','].sort((a, b) =>
    pierwsza.split(b).length - pierwsza.split(a).length)[0];
  const wiersze = linie.slice(0, maxWierszy).map((l) => podzielCsv(l, sep).join(' | '));
  if (linie.length > maxWierszy) wiersze.push(`… (${linie.length - maxWierszy} dalszych wierszy pominięto)`);
  return wiersze.join('\n');
}

// ---------------------------------------------------------------------------

const OBSLUGIWANE = new Set(['docx', 'xlsx', 'xlsm', 'pptx', 'pdf', 'csv', 'tsv']);

/** Wyciągnij tekst lokalnie. Zwraca `{ text, potrzebnyOcr }`.
 *  Nigdy nie rzuca: uszkodzony plik ma dać pustkę i wyjaśnienie, nie wywrotkę. */
function czytajLokalnie(nazwa, buf) {
  const ext = (String(nazwa).split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'docx') return { text: zDocx(buf), potrzebnyOcr: false };
    if (ext === 'xlsx' || ext === 'xlsm') return { text: zXlsx(buf), potrzebnyOcr: false };
    if (ext === 'pptx') return { text: zPptx(buf), potrzebnyOcr: false };
    if (ext === 'csv' || ext === 'tsv') return { text: zCsv(buf.toString('utf8')), potrzebnyOcr: false };
    if (ext === 'pdf') {
      const text = zPdf(buf);
      return { text, potrzebnyOcr: wygladaNaSkan(text, buf) };
    }
  } catch (err) {
    console.error(`Nie udało się odczytać ${nazwa}:`, err.message);
  }
  return { text: '', potrzebnyOcr: false };
}

module.exports = {
  czytajLokalnie, OBSLUGIWANE,
  zDocx, zXlsx, zPptx, zPdf, zCsv, wygladaNaSkan,
  wpisyZip, odkodujPdfString,
};

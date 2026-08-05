/* Cosmos umiał wyciągać tekst z PDF-ów i Office'a — ale wyłącznie przez
   usługę zmysłów na komputerze domowym, który zwykle jest wyłączony.
   W praktyce wczytanie umowy z telefonu nie działało nigdy.

   Te czytniki są w Node, bez ani jednej zewnętrznej biblioteki, więc działają
   zawsze. Zestaw sprawdza je na plikach zbudowanych tutaj, a nie na
   „przykładowym.pdf" wrzuconym kiedyś do repozytorium — inaczej nie wiadomo,
   czy test bada kod, czy pamiątkę. */
const zlib = require('node:zlib');
const { srodowisko } = require('../pomoc');
const D = require('../../lib/dokumenty.js');

// --- budowa plików próbnych (bez bibliotek: ZIP i PDF składamy ręcznie) -----

function zipuj(pliki) {
  const lokalne = [];
  const centralne = [];
  let offset = 0;
  for (const [nazwa, tresc] of Object.entries(pliki)) {
    const surowe = Buffer.from(tresc, 'utf8');
    const spakowane = zlib.deflateRawSync(surowe);
    const nb = Buffer.from(nazwa, 'utf8');
    const crc = crc32(surowe);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(spakowane.length, 18);
    lh.writeUInt32LE(surowe.length, 22); lh.writeUInt16LE(nb.length, 26);
    lokalne.push(lh, nb, spakowane);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(spakowane.length, 20);
    ch.writeUInt32LE(surowe.length, 24); ch.writeUInt16LE(nb.length, 28);
    ch.writeUInt32LE(offset, 42);
    centralne.push(ch, nb);
    offset += 30 + nb.length + spakowane.length;
  }
  const cd = Buffer.concat(centralne);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(pliki).length, 8);
  eocd.writeUInt16LE(Object.keys(pliki).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokalne, cd, eocd]);
}

let TABELA;
function crc32(buf) {
  if (!TABELA) {
    TABELA = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABELA[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABELA[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const DOCX = zipuj({
  'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="x"><w:body>'
    + '<w:p><w:r><w:t>Umowa o dzieło</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Zamawiający: Marcin</w:t></w:r><w:r><w:t> Przybylski</w:t></w:r></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Kwota</w:t></w:r></w:p></w:tc>'
    + '<w:tc><w:p><w:r><w:t>4500 zł</w:t></w:r></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:r><w:t>Termin</w:t></w:r></w:p></w:tc>'
    + '<w:tc><w:p><w:r><w:t>14 dni</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '</w:body></w:document>',
});

const XLSX = zipuj({
  'xl/sharedStrings.xml': '<sst><si><t>Miesiąc</t></si><si><t>Przychód</t></si><si><t>Styczeń</t></si></sst>',
  'xl/workbook.xml': '<workbook><sheets><sheet name="Budżet" sheetId="1"/></sheets></workbook>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>12000</v></c></row>'
    + '</sheetData></worksheet>',
});

function pdfZTekstem() {
  const tresc = Buffer.from(
    'BT /F1 14 Tf 72 720 Td (Faktura VAT nr 12/2026) Tj ET\n'
    + 'BT /F1 11 Tf 72 690 Td [(Sprzedawca:) -300 (Marcin Przybylski)] TJ ET\n'
    + 'BT /F1 11 Tf 72 670 Td (Termin: 14 dni \\(przelew\\)) Tj ET', 'latin1');
  const spak = zlib.deflateSync(tresc);
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n'
      + `4 0 obj<</Length ${spak.length}/Filter/FlateDecode>>stream\n`, 'latin1'),
    spak,
    Buffer.from('\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'latin1'),
  ]);
}

// ---------------------------------------------------------------------------

(async () => {
  const fail = [];

  // 1. DOCX — akapity i tabela
  const docx = D.czytajLokalnie('umowa.docx', DOCX).text;
  console.log('1. DOCX:', JSON.stringify(docx.slice(0, 120)));
  if (!/Umowa o dzieło/.test(docx)) fail.push('DOCX: brak nagłówka');
  if (!/Zamawiający: Marcin Przybylski/.test(docx)) fail.push('DOCX: sklejone przebiegi tekstu');
  if (!/Kwota \| 4500 zł/.test(docx)) fail.push('DOCX: tabela rozsypana na pionowy słupek');
  if (!/Termin \| 14 dni/.test(docx)) fail.push('DOCX: drugi wiersz tabeli zgubiony');

  // 2. XLSX — nazwa arkusza, teksty współdzielone i PUSTA kolumna w środku
  const xlsx = D.czytajLokalnie('budzet.xlsx', XLSX).text;
  console.log('2. XLSX:', JSON.stringify(xlsx));
  if (!/## Arkusz: Budżet/.test(xlsx)) fail.push('XLSX: brak nazwy arkusza');
  if (!/Miesiąc \| Przychód/.test(xlsx)) fail.push('XLSX: nie rozwinął tekstów współdzielonych');
  // Styczeń jest w A2, liczba w C2 — B2 puste. Gdyby puste kolumny wypadały,
  // 12000 wylądowałoby pod „Przychód", czyli dane przesunęłyby się o kolumnę.
  if (!/Styczeń \|\s*\| 12000/.test(xlsx)) fail.push('XLSX: pusta kolumna wypadła, dane przesunięte');

  // 3. PDF — strumień FlateDecode, odstępy z kerningu, znaki uciekane
  const pdfBuf = pdfZTekstem();
  const pdf = D.czytajLokalnie('faktura.pdf', pdfBuf);
  console.log('3. PDF:', JSON.stringify(pdf.text));
  if (!/Faktura VAT nr 12\/2026/.test(pdf.text)) fail.push('PDF: nie rozpakował strumienia');
  if (!/Sprzedawca: Marcin/.test(pdf.text)) fail.push('PDF: kerning nie dał spacji — słowa sklejone');
  if (!/\(przelew\)/.test(pdf.text)) fail.push('PDF: nawiasy uciekane odczytane źle');
  if (pdf.potrzebnyOcr) fail.push('PDF z tekstem uznany za skan');

  // 4. skan rozpoznany jako skan (inaczej użytkownik dostaje pustkę bez powodu)
  const skan = D.wygladaNaSkan('', Buffer.alloc(400000));
  console.log(`4. skan 400 kB bez tekstu → potrzebny OCR: ${skan}`);
  if (!skan) fail.push('skan nieodróżniony od dokumentu z tekstem');

  // 5. CSV z średnikiem i przecinkiem w cudzysłowie
  const csv = D.zCsv('imie;nazwisko;kwota\nMarcin;"Przybylski, jr";4500');
  console.log('5. CSV:', JSON.stringify(csv));
  if (!/Przybylski, jr/.test(csv)) fail.push('CSV: przecinek w cudzysłowie rozerwał pole');
  if (!/Marcin \| Przybylski, jr \| 4500/.test(csv)) fail.push('CSV: zły separator');

  // 6. uszkodzony plik ma dać pustkę, nie wywrotkę
  const smiec = D.czytajLokalnie('psuty.docx', Buffer.from('to nie jest zip'));
  console.log(`6. uszkodzony DOCX → „${smiec.text}" (bez wyjątku)`);
  if (smiec.text !== '') fail.push('uszkodzony plik zwrócił coś dziwnego');

  // --- przez API, czyli tak jak używa tego przeglądarka ---
  const env = await srodowisko('goly');
  const wyslij = (nazwa, buf) => fetch(`${env.adres}/api/document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': nazwa },
    body: buf,
  });

  const r = await wyslij('umowa.docx', DOCX);
  const d = await r.json();
  console.log(`7. /api/document → HTTP ${r.status}, ${d.chars} znaków`);
  if (r.status !== 200 || !d.chars) fail.push('API nie oddało treści dokumentu');
  if (!/Kwota \| 4500 zł/.test(d.text || '')) fail.push('API zgubiło tabelę');

  const pusty = await wyslij('nic.docx', Buffer.alloc(0));
  console.log(`8. pusty plik → HTTP ${pusty.status}`);
  if (pusty.status !== 400) fail.push('pusty plik nie został odrzucony');

  // 9. format, którego nie umiemy — komunikat zamiast ciszy
  const dziwny = await wyslij('projekt.blend', Buffer.from('BLENDER-v300'));
  const dd = await dziwny.json();
  console.log(`9. nieznany format → „${dd.error}"`);
  if (!dd.error) fail.push('nieobsługiwany format nie tłumaczy, co poszło nie tak');

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nDOKUMENTY OK');
  process.exit(fail.length ? 1 : 0);
})();

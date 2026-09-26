/* Po wyciętym znaczniku nie zostaje śmieć, a „prawie-znaczniki” też znikają.

   agencja-rozmowa, runda 5 – na ekranie stało:
   1. Goła kreska listy: „Sprawdzę:\n- [SZUKAJ: …]” dawało „Sprawdzę: -”,
      a plan „2. [GRAFIKA: …]” zostawiał samotne „2.”.
   2. „[SEARCH: …]” – Qwen i Llama przy angielskiej rozmowie tłumaczą nazwę.
      Stało surowo i wyszukiwanie nie ruszało.
   3. Znacznik bez dwukropka („[SZUKAJ pogoda Kraków]”).
   4. `<tool_call>{…}</tool_call>` – format modeli z function callingiem.

   Strona odwrotna jest ważniejsza: zwykły nawias kwadratowy, odnośnik
   Markdown, „[Plan B]” w zdaniu i samotny punktor w tekście BEZ znaczników
   zostają nietknięte. Czysta funkcja z public/protokol.js, w Node.
*/
const { utworzProtokol } = require('../../public/protokol.js');

const { stripSearchMarker, widokWToku, SEARCH_MARKER_RE } = utworzProtokol();
const fail = [];
const sprawdz = (opis, wejscie, oczek, f = stripSearchMarker) => {
  const got = f(wejscie);
  const ok = got === oczek;
  console.log(`${ok ? 'OK ' : 'ŹLE'} ${opis}`);
  if (!ok) fail.push(`${opis}: ${JSON.stringify(got)} zamiast ${JSON.stringify(oczek)}`);
};

// 1. Puste punkty po wyciętym znaczniku.
sprawdz('kreska listy po znaczniku', 'Sprawdzę:\n- [SZUKAJ: pogoda Kraków]', 'Sprawdzę:');
sprawdz('dwa punkty ze znacznikami', 'Szukam:\n- [SZUKAJ: a]\n* [SZUKAJ: b]\nZaraz wracam.', 'Szukam:\nZaraz wracam.');
sprawdz('numer punktu po znaczniku', 'Plan:\n1. Wawel\n2. [GRAFIKA: Wawel]\n3. Kopiec', 'Plan:\n1. Wawel\n3. Kopiec');
sprawdz('punktor z kropką', 'Zdjęcia:\n• [GRAFIKA: Wawel]', 'Zdjęcia:');

// 2. [SEARCH: …] znika z ekranu i uruchamia to samo wyszukiwanie.
sprawdz('[SEARCH: …]', 'Let me check.\n[SEARCH: weather Kraków tomorrow]', 'Let me check.');
sprawdz('urwany [SEARCH: …', 'Let me check.\n[SEARCH: weather Kra', 'Let me check.');
{
  const m = 'Let me check.\n[SEARCH: weather Kraków]'.match(SEARCH_MARKER_RE);
  const q = m && m[1];
  console.log(`${q === 'weather Kraków' ? 'OK ' : 'ŹLE'} [SEARCH: …] uruchamia wyszukiwanie: ${q}`);
  if (q !== 'weather Kraków') fail.push(`[SEARCH: …] nie daje zapytania narzędziu (${q})`);
  const s = '[SZUKAJ: pogoda]'.match(SEARCH_MARKER_RE);
  if (!s || s[1] !== 'pogoda') fail.push('[SZUKAJ: …] przestało dawać zapytanie');
}

// 3. Bez dwukropka.
sprawdz('[SZUKAJ bez dwukropka]', 'Sprawdzę.\n[SZUKAJ pogoda Kraków jutro]', 'Sprawdzę.');
sprawdz('[GRAFIKA bez dwukropka]', 'Wawel:\n[GRAFIKA Wawel Kraków]', 'Wawel:');

// 4. <tool_call>.
sprawdz('<tool_call> w całości', 'Sprawdzę.\n<tool_call>\n{"name": "search", "arguments": {"q": "pogoda"}}\n</tool_call>', 'Sprawdzę.');
sprawdz('<tool_call> urwany na końcu', 'Sprawdzę.\n<tool_call>{"name": "sea', 'Sprawdzę.');
sprawdz('<tool_call> w toku, sam początek znacznika', 'Już patrzę.\n<tool_c', 'Już patrzę.', (x) => widokWToku(x).trim());

// 5. Czego ruszać NIE WOLNO.
sprawdz('„[Plan B]” w zdaniu', 'Mamy [Plan B] na deszcz.', 'Mamy [Plan B] na deszcz.');
sprawdz('„[Obraz Moneta]” w zdaniu', 'To [Obraz Moneta] z 1872.', 'To [Obraz Moneta] z 1872.');
sprawdz('odnośnik Markdown', 'Zobacz [Szukaj w Google](https://example.com) i [SEARCH engines](https://example.org).',
  'Zobacz [Szukaj w Google](https://example.com) i [SEARCH engines](https://example.org).');
sprawdz('przypisy [1] i nawias', 'Źródło [1], tekst [w nawiasie].', 'Źródło [1], tekst [w nawiasie].');
sprawdz('samotny punktor w tekście bez znaczników', 'Lista:\n- a\n-\n- b', 'Lista:\n- a\n-\n- b');
sprawdz('lista numerowana bez znaczników', 'Plan:\n\n1. Wawel\n\n2. Kopiec', 'Plan:\n\n1. Wawel\n\n2. Kopiec');
sprawdz('„<tool>” w zwykłym zdaniu', 'Znacznik <tool> w HTML-u.', 'Znacznik <tool> w HTML-u.');

console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nRESZTKI ZNACZNIKÓW OK');
process.exit(fail.length ? 1 : 0);

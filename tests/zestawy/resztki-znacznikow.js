/* Po wyciętym znaczniku nie zostaje śmieć, a „prawie-znaczniki” też znikają.

   agencja-rozmowa, runda 5 – na ekranie stało:
   1. Goła kreska listy: „Sprawdzę:\n- [SZUKAJ: …]” dawało „Sprawdzę: -”,
      a plan „2. [GRAFIKA: …]” zostawiał samotne „2.”.
   2. „[SEARCH: …]” – Qwen i Llama przy angielskiej rozmowie tłumaczą nazwę.
      Stało surowo i wyszukiwanie nie ruszało.
   3. Znacznik bez dwukropka („[SZUKAJ pogoda Kraków]”).
   4. `<tool_call>{…}</tool_call>` – format modeli z function callingiem.

   Runda 11 (dalsze czyste funkcje protokołu, ten sam plik):
   6. `<TOOLCALL>[…]</TOOLCALL>` (Llama-Nemotron, Nano 9B v2) wyciekał; trzy
      natywne kształty wywołania i „[SZUKAJ bez dwukropka]” URUCHAMIAJĄ szukanie
      (`natywneSzukanie`), zamiast zostawić samą obietnicę „Sprawdzę.”.
   7. Mieszane pismo w słowie („Monte τauro”) – poprawione; symbole, jednostki,
      całe słowa greckie i rosyjskie, kod i adresy – bez zmian.
   8. `<thinking>` (Claude i modele uczone na jego zapisach) idzie do myślenia.
   9. Punkt listy z samą etykietą przy [GRAFIKA:] – etykieta staje się podpisem
      paska, pusty punkt nie zostaje.
  10. „Ponów” pod błędem prowadzącego nie wyrzuca opłaconych notatek zespołu.
  11. K8: sierota z serwera wygrywa z urywkiem/błędem karty o tym samym biegu.

   Strona odwrotna jest ważniejsza: zwykły nawias kwadratowy, odnośnik
   Markdown, „[Plan B]” w zdaniu i samotny punktor w tekście BEZ znaczników
   zostają nietknięte. Czysta funkcja z public/protokol.js, w Node.
*/
const { utworzProtokol } = require('../../public/protokol.js');

const {
  stripSearchMarker, widokWToku, SEARCH_MARKER_RE, natywneSzukanie, ujednolicPismo,
  rozdzielMyslenie, rozlozZdjecia, granicaPonowienia, scalRozmowy,
} = utworzProtokol();
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

// 6. Natywne wywołania narzędzi: czyste na ekranie i URUCHAMIAJĄ wyszukiwanie.
{
  const KSZTALTY = [
    ['<TOOLCALL>[…] (Nemotron Nano 9B v2)', 'Sprawdzę.\n<TOOLCALL>[{"name": "search", "arguments": {"query": "pogoda Taormina"}}]</TOOLCALL>', 'pogoda Taormina'],
    ['<tool_call> JSON (Qwen, Hermes)', 'Sprawdzę.\n<tool_call>\n{"name": "web_search", "arguments": {"query": "Etna wrzesień"}}\n</tool_call>', 'Etna wrzesień'],
    ['<tool_call> XML (Nemotron 3, Qwen3-Coder)', 'Sprawdzę.\n<tool_call>\n<function=search>\n<parameter=query>\nIsola Bella godziny\n</parameter>\n</function>\n</tool_call>', 'Isola Bella godziny'],
    ['arguments jako napis JSON', 'Sprawdzę.\n<tool_call>{"name":"search","arguments":"{\\"q\\":\\"bilety Etna\\"}"}</tool_call>', 'bilety Etna'],
    ['[SZUKAJ bez dwukropka]', 'Sprawdzę.\n[SZUKAJ pogoda Kraków jutro]', 'pogoda Kraków jutro'],
  ];
  for (const [opis, wej, q] of KSZTALTY) {
    sprawdz(`${opis}: ekran`, wej, 'Sprawdzę.');
    sprawdz(`${opis}: w toku`, wej, 'Sprawdzę.', (x) => widokWToku(x).trim());
    const m = natywneSzukanie(wej);
    const ok = Boolean(m) && m[1] === q && wej.replace(m[0], '').trim() === 'Sprawdzę.';
    console.log(`${ok ? 'OK ' : 'ŹLE'} ${opis}: uruchamia szukanie „${m && m[1]}”`);
    if (!ok) fail.push(`${opis}: wyszukiwanie nie rusza (zostaje sama obietnica „Sprawdzę.”) – ${JSON.stringify(m && [...m])}`);
  }
  sprawdz('<TOOLCALL> urwany na końcu', 'Sprawdzę.\n<TOOLCALL>[{"name": "sea', 'Sprawdzę.');
  sprawdz('<TOOLC w toku', 'Już patrzę.\n<TOOLC', 'Już patrzę.', (x) => widokWToku(x).trim());
  const NIE = [
    'Mamy [Plan B] i [Szukaj w Google](https://google.com).',
    'Zobacz [Szukaj dalej] w menu.',
    'Sprawdzę.\n<tool_call>{"name": "kalkulator", "arguments": {"query": "2+2"}}</tool_call>',
    'Sprawdzę.\n<tool_call>{"name": "search", "arguments": {}}</tool_call>',
    'Sprawdzę.\n<tool_call>nie JSON</tool_call>',
  ];
  for (const x of NIE) {
    const m = natywneSzukanie(x);
    if (m) fail.push(`natywneSzukanie odpala wyszukiwanie tam, gdzie go nie ma: ${JSON.stringify(x)} → ${m[1]}`);
  }
  console.log(`${NIE.every((x) => !natywneSzukanie(x)) ? 'OK ' : 'ŹLE'} zwykły nawias, link, inne narzędzie i pusty argument nie uruchamiają szukania`);
}

// 7. Mieszane pismo w słowie.
{
  const PISMO = [
    ['wjazd kolejką na Monte τauro (widok na zatokę)', 'wjazd kolejką na Monte tauro (widok na zatokę)'],
    ['Taormina – Τeatro Greco', 'Taormina – Teatro Greco'],
    ['Сosmos i Сefalù', 'Cosmos i Cefalù'],
    ['plaża w Іsola Bella', 'plaża w Isola Bella'],
    ['stała czasowa τ = RC wynosi 2 s', null],
    ['ziarno 5 μm, opór 4,7 kΩ, różnica ΔT = 3 K, ΔEV = 2', null],
    ['Ελλάδα i Москва to słowa w swoich alfabetach', null],
    ['λ/2 i α-pinen', null],
    ['kod: `const τauro = 1;` zostaje', null],
    ['```js\nconst τauro = 1;\n```', null],
    ['[link](https://el.wikipedia.org/wiki/Ταυρομένιο) i https://example.com/τauro', null],
    ['Sycylia: Syrakuzy, Katania, Taormina', null],
  ];
  for (const [we, oczek] of PISMO) sprawdz(`pismo: ${we.slice(0, 40)}`, we, oczek === null ? we : oczek, ujednolicPismo);
  sprawdz('pismo naprawiane także na ekranie (stripSearchMarker)', 'Wieczorem Monte τauro.\n[SZUKAJ: Etna]', 'Wieczorem Monte tauro.');
}

// 8. <thinking> jak <think>.
{
  const a = rozdzielMyslenie('<thinking>Rozważam plan.</thinking>Odpowiedź.');
  const b = rozdzielMyslenie('Rozważam w szablonie.</thinking>Odpowiedź.');
  const c = rozdzielMyslenie('<thinking>urwane w trakcie');
  const ok = a.think === 'Rozważam plan.' && a.tresc === 'Odpowiedź.' && b.think === 'Rozważam w szablonie.'
    && b.tresc === 'Odpowiedź.' && c.tresc === '' && c.think === 'urwane w trakcie';
  console.log(`${ok ? 'OK ' : 'ŹLE'} <thinking> idzie do myślenia (całe, samo zamknięcie, urwane)`);
  if (!ok) fail.push(`<thinking> zostaje w odpowiedzi: ${JSON.stringify([a, b, c])}`);
  sprawdz('<thinking> urwany w toku', 'Odpowiedź <thinki', 'Odpowiedź', (x) => widokWToku(x).trim());
  const d = rozdzielMyslenie('<think>x</think>y');
  if (d.think !== 'x' || d.tresc !== 'y') fail.push('<think> przestało działać');
}

// 9. Punkt listy z samą etykietą przy [GRAFIKA:] – podpis paska, bez pustego punktu.
{
  const r = rozlozZdjecia('Propozycje zdjęć:\n- Palermo – centrum: [GRAFIKA: Palermo katedra]\n- **Etna**: [GRAFIKA: Etna krater]\n'
    + '- Wieczór nad Isola Bella [GRAFIKA: Isola Bella]\n- Bilety: 15 € [GRAFIKA: Teatro Greco]\nKoniec.');
  const podpisy = r.zdjecia.map((g) => `${g.q}=${g.etykieta}`).join(', ');
  const puste = r.tresc.split('\n').filter((l) => /^\s*(?:[-*+•]|\d+[.)])\s+[^\n]{0,80}[:–-]\s*$/.test(l));
  const ok = !puste.length && /Palermo katedra=Palermo – centrum/.test(podpisy) && /Etna krater=Etna(,|$)/.test(podpisy)
    && /Wieczór nad Isola Bella/.test(r.tresc) && /Bilety: 15 €/.test(r.tresc) && /Isola Bella=Isola Bella/.test(podpisy);
  console.log(`${ok ? 'OK ' : 'ŹLE'} punkt z samą etykietą → podpis paska (${podpisy}); puste punkty: ${puste.length}`);
  if (!ok) fail.push(`puste punkty po [GRAFIKA:] albo zgubiona etykieta: ${JSON.stringify(r.tresc)} / ${podpisy}`);
}

// 10. „Ponów” pod błędem prowadzącego zostawia notatki zespołu z treścią.
{
  const pytanie = { role: 'user', content: 'Plan Sycylii' };
  const notatki = { role: 'user', search: true, narzedzie: 'zespol', content: 'NOTATKI ZESPOŁU…', zespol: { v: 1 } };
  const blad = { role: 'assistant', content: 'Przeciążony', error: true };
  const r1 = [pytanie, notatki, { role: 'assistant', content: 'Poło' }, blad];
  const ok1 = granicaPonowienia(r1, 3) === 2;
  const r2 = [pytanie, { ...notatki, content: '' }, blad];
  const ok2 = granicaPonowienia(r2, 2) === 1;
  const r3 = [pytanie, { role: 'assistant', content: 'Sprawdzę.' }, { role: 'user', content: 'WYNIKI', search: true }, blad];
  const ok3 = granicaPonowienia(r3, 3) === 1;
  console.log(`${ok1 && ok2 && ok3 ? 'OK ' : 'ŹLE'} „Ponów” pod błędem: notatki z treścią zostają, puste i wyniki narzędzi – nie`);
  if (!ok1) fail.push('„Ponów” pod błędem prowadzącego wyrzuca opłacone notatki zespołu');
  if (!ok2 || !ok3) fail.push('„Ponów” zatrzymuje się na pustych notatkach albo na wynikach narzędzia');
}

// 11. K8: sierota z serwera wygrywa z urywkiem i błędem karty o tym samym biegu.
{
  const baza = [{ role: 'user', content: 'Plan Sycylii' }];
  const pelna = { role: 'assistant', content: 'Pełna odpowiedź z serwera…', bieg: 'b1' };
  const karta = { messages: [...baza, { role: 'assistant', content: 'Urywek', bieg: 'b1' },
    { role: 'assistant', content: '⚠︎ Połączenie zerwane', error: true, bieg: 'b1' }] };
  const s1 = scalRozmowy(karta, { messages: [...baza, pelna] }).messages;
  const ok1 = s1.length === 2 && s1[1].content === pelna.content;
  // bez błędu karty – jak dawniej: odpowiedź karty wygrywa, sierota nie dubluje
  const karta2 = { messages: [...baza, { role: 'assistant', content: 'Pełna odpowiedź karty', bieg: 'b1' }] };
  const s2 = scalRozmowy(karta2, { messages: [...baza, pelna] }).messages;
  const ok2 = s2.length === 2 && s2[1].content === 'Pełna odpowiedź karty';
  // błąd z INNEGO biegu nie zdejmuje odpowiedzi tej karty
  const karta3 = { messages: [...baza, { role: 'assistant', content: 'Inna', error: true, bieg: 'b2' }] };
  const s3 = scalRozmowy(karta3, { messages: [...baza, pelna] }).messages;
  const ok3 = s3.length === 2 && s3[1].content === 'Inna';
  console.log(`${ok1 && ok2 && ok3 ? 'OK ' : 'ŹLE'} K8 scalanie sieroty: ${s1.map((m) => m.content).join(' | ')}`);
  if (!ok1) fail.push(`K8: urywek z błędem karty kasuje pełną odpowiedź-sierotę z serwera: ${JSON.stringify(s1.map((m) => m.content))}`);
  if (!ok2) fail.push('K8: odpowiedź karty bez błędu przestała wygrywać z sierotą (dubel)');
  if (!ok3) fail.push('K8: błąd z innego biegu zmienia scalanie');
}

console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nRESZTKI ZNACZNIKÓW OK');
process.exit(fail.length ? 1 : 0);

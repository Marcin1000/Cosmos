/* Renderer Markdown jako jedyna bariera przed `innerHTML`.

   Odpowiedź modelu trafia do rozmowy przez `innerHTML`. To znaczy, że
   `renderMarkdown` nie jest ozdobnikiem — jest granicą bezpieczeństwa.
   A model bierze treść z internetu (wyszukiwarka, strony, opisy zdjęć),
   więc „model nie napisze przecież `<script>`" nie jest żadną gwarancją:
   wystarczy, że przepisze cytat ze znalezionej strony.

   Do tej pory sprawdzały to dwa punkty w zestawie przeglądarkowym
   `klikalne-linki`. Działały, ale wymagały Chromium i potrafiły sprawdzić
   tylko tyle, ile widać na ekranie. Po wydzieleniu `public/tekst.js` te
   funkcje da się wywołać wprost — więc zamiast dwóch prób przepuszczamy
   całą listę, i to w ułamku sekundy.

   Zestaw pilnuje trzech rzeczy:
     1. nic z wejścia nie może wyjść jako wykonywalny HTML,
     2. adresy w odnośnikach muszą być http(s) — nigdy `javascript:`,
     3. składnia Markdown ma działać (bariera, która psuje tekst, zostanie
        prędzej czy później obejściem, nie barierą).
*/
const path = require('node:path');

const { utworzTekst } = require(path.join(__dirname, '..', '..', 'public', 'tekst.js'));

const fail = [];
const T = utworzTekst({ t: (k) => k, COPY_SVG: '<svg data-ikona></svg>' });

/* Znaczniki, które renderer ma prawo wypuścić. Świadomie krótka lista:
   gdyby ktoś dołożył do renderera nowy znacznik, ten zestaw ma o tym
   powiedzieć, a nie przepuścić go w milczeniu. */
const WOLNO = new Set(['p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'h1', 'h2', 'h3',
  'h4', 'ul', 'ol', 'li', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th',
  'td', 'div', 'span', 'button', 'svg', 'path', 'rect']);

/** Co realnie wyszło jako HTML — pierwsza wersja tego testu szukała frazy
 *  `onerror=` w całym wyniku i zgłaszała usterkę przy poprawnie UCIECZKOWANYM
 *  `&lt;img src=x onerror=…&gt;`, czyli dokładnie tam, gdzie bariera zadziałała.
 *  Liczy się tylko to, co przeglądarka weźmie za znacznik. */
function zarzuty(html) {
  const out = [];
  for (const m of html.matchAll(/<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g)) {
    const [caly, tag, atrybuty] = m;
    if (!WOLNO.has(tag.toLowerCase())) out.push(`niedozwolony znacznik <${tag}>`);
    const zdarzenie = /\son[a-z]+\s*=/i.exec(atrybuty);
    if (zdarzenie) out.push(`atrybut zdarzenia${zdarzenie[0]} w <${tag}>`);
    const href = /\b(?:href|src)\s*=\s*"([^"]*)"/i.exec(atrybuty);
    if (href && !/^(https?:\/\/|#|\/)/i.test(href[1].trim())) {
      out.push(`adres spoza http(s) w <${tag}>: ${href[1].slice(0, 40)}`);
    }
    if (/javascript:|vbscript:|data:text\/html/i.test(caly)) {
      out.push(`wykonywalny adres w <${tag}>`);
    }
  }
  return out;
}

/* --- 1. PRÓBY WSTRZYKNIĘCIA -------------------------------------------
   Każda pozycja to treść, którą model może przepisać z internetu.
   Wynik nie może zawierać znacznika, który przeglądarka uruchomi. */
const PROBY = [
  ['goły skrypt', '<script>alert(1)</script>'],
  ['obrazek z onerror', '<img src=x onerror=alert(1)>'],
  ['ramka', '<iframe src="https://zly.example"></iframe>'],
  ['zdarzenie na akapicie', '<p onclick="alert(1)">klik</p>'],
  ['svg z onload', '<svg onload=alert(1)></svg>'],
  ['skrypt w bloku kodu', '```\n<script>alert(1)</script>\n```'],
  ['skrypt w kodzie liniowym', 'zobacz `<script>alert(1)</script>`'],
  ['skrypt w nagłówku', '# <script>alert(1)</script>'],
  ['skrypt w tabeli', '| a | b |\n| - | - |\n| <script>alert(1)</script> | 2 |'],
  ['skrypt w cytacie', '> <script>alert(1)</script>'],
  ['skrypt na liście', '- <script>alert(1)</script>'],
  ['nazwa języka bloku', '```<script>alert(1)</script>\nx\n```'],
  ['domknięcie atrybutu', 'a" onmouseover="alert(1)'],
  ['skrypt w tekście odnośnika', '[<script>alert(1)</script>](https://ok.example)'],
];

let przepuszczone = 0;
for (const [nazwa, wejscie] of PROBY) {
  const out = T.renderMarkdown(wejscie);
  const z = zarzuty(out);
  if (z.length) {
    przepuszczone++;
    fail.push(`„${nazwa}": ${z.join('; ')} — wynik: ${out.slice(0, 120)}`);
  }
}
console.log(`1. prób wstrzyknięcia: ${PROBY.length}, przepuszczonych: ${przepuszczone}`);

/* Sam detektor też musi być sprawdzony — inaczej cały punkt 1 mógłby być
   zielony dlatego, że nic nie wykrywa. Podajemy mu HTML, który MA odrzucić. */
{
  const kontrola = [
    '<script>alert(1)</script>',
    '<p onclick="alert(1)">x</p>',
    '<a href="javascript:alert(1)">x</a>',
  ];
  const slepe = kontrola.filter((h) => zarzuty(h).length === 0);
  console.log(`   kontrola detektora: ${kontrola.length - slepe.length}/${kontrola.length} złapane`);
  for (const h of slepe) fail.push(`detektor nie widzi zagrożenia w: ${h}`);
  if (zarzuty(T.renderMarkdown('zwykły **tekst** z [linkiem](https://a.example)')).length) {
    fail.push('detektor zgłasza zagrożenie w poprawnym tekście — punkt 1 nic nie znaczy');
  }
}

/* --- 2. ADRESY W ODNOŚNIKACH ------------------------------------------
   `[tekst](javascript:…)` to zwykły odnośnik dla Markdowna, a wykonanie kodu
   dla przeglądarki. Wzorzec musi wymagać http(s) — i musi to robić także
   wtedy, gdy adres jest zapisany dziwnie. */
const ADRESY = [
  '[klik](javascript:alert(1))',
  '[klik](JavaScript:alert(1))',
  '[klik](data:text/html,<script>alert(1)</script>)',
  '[klik](vbscript:msgbox(1))',
  '[klik](  javascript:alert(1))',
];
let zleAdresy = 0;
for (const wejscie of ADRESY) {
  const out = T.renderMarkdown(wejscie);
  if (/href="\s*(javascript|data|vbscript):/i.test(out)) {
    zleAdresy++;
    fail.push(`odnośnik przepuścił niebezpieczny adres: ${wejscie} → ${out}`);
  }
}
console.log(`2. niebezpiecznych adresów: ${ADRESY.length}, przepuszczonych: ${zleAdresy}`);

// A zwykły adres ma dalej działać — inaczej „bezpieczeństwo" oznacza brak linków.
const zwykly = T.renderMarkdown('[źródło](https://nikon.example/raw)');
if (!/href="https:\/\/nikon\.example\/raw"/.test(zwykly)) {
  fail.push('poprawny odnośnik przestał się renderować');
}
if (!/rel="noopener noreferrer"/.test(zwykly)) {
  fail.push('odnośnik nie ma `rel="noopener noreferrer"` — nowa karta dostaje `window.opener`');
}

/* --- 3. GOŁY ADRES W ZDANIU STAJE SIĘ ODNOŚNIKIEM ---------------------
   Model podaje źródła raz jako `[tekst](adres)`, a raz jako sam adres.
   Druga postać była kiedyś martwym tekstem. */
{
  const out = T.renderMarkdown('Więcej na https://dpreview.example/r6ii oraz www.canon.example.');
  const linki = (out.match(/<a\b/g) || []).length;
  console.log(`3. gołe adresy w zdaniu → odnośników: ${linki}`);
  if (linki !== 2) fail.push(`z dwóch gołych adresów zrobiło się ${linki} odnośników`);
  // Kropka kończąca zdanie należy do zdania, nie do adresu.
  if (/href="[^"]*\.">|href="https:\/\/www\.canon\.example\."/.test(out)) {
    fail.push('kropka na końcu zdania weszła do adresu');
  }
  if (!/canon\.example<\/a>\./.test(out)) {
    fail.push('kropka po adresie zniknęła z tekstu');
  }
}

/* Adres wewnątrz istniejącego odnośnika ani w bloku kodu nie może dostać
   drugiego opakowania — kiedyś dawało to `<a href="<a href=…">`. */
{
  const out = T.renderMarkdown('[tu](https://a.example) i `https://b.example`');
  if (/<a[^>]*<a/.test(out)) fail.push('odnośnik został podlinkowany po raz drugi');
  if (/<code>[^<]*<a /.test(out)) fail.push('adres w bloku kodu zamienił się w odnośnik');
}

/* --- 4. SKŁADNIA MARKDOWN DZIAŁA -------------------------------------
   Bariera, która przy okazji psuje tekst, zostanie kiedyś rozluźniona.
   Dlatego to też jest test bezpieczeństwa, nie tylko wyglądu. */
const SKLADNIA = [
  ['pogrubienie', '**mocno**', /<strong>mocno<\/strong>/],
  ['kursywa', 'to *ukośnie* tak', /<em>ukośnie<\/em>/],
  ['kod liniowy', 'użyj `f/1.8`', /<code>f\/1\.8<\/code>/],
  ['nagłówek', '## Plan', /<h2>Plan<\/h2>/],
  ['lista', '- jeden\n- dwa', /<ul>.*<li>jeden<\/li>.*<li>dwa<\/li>.*<\/ul>/s],
  ['lista numerowana', '1. jeden\n2. dwa', /<ol>.*<li>jeden<\/li>/s],
  ['cytat', '> uwaga', /<blockquote>/],
  ['linia', '---', /<hr/],
  ['tabela', '| a | b |\n| - | - |\n| 1 | 2 |', /<table>.*<td>1<\/td>/s],
  ['blok kodu', '```python\nprint(1)\n```', /<pre><code>print\(1\)<\/code><\/pre>/],
];
const zle = [];
for (const [nazwa, wejscie, wzor] of SKLADNIA) {
  if (!wzor.test(T.renderMarkdown(wejscie))) zle.push(nazwa);
}
console.log(`4. składnia Markdown: ${SKLADNIA.length - zle.length}/${SKLADNIA.length} działa`
  + (zle.length ? ` — nie działa: ${zle.join(', ')}` : ''));
for (const n of zle) fail.push(`składnia „${n}" przestała się renderować`);

/* Nazwa języka trafia do nagłówka bloku i musi być oczyszczona — to jedyne
   miejsce, gdzie tekst od modelu ląduje w atrybucie widocznym na ekranie. */
{
  const out = T.renderMarkdown('```python\nx=1\n```');
  if (!/<span>python<\/span>/.test(out)) fail.push('blok kodu nie podpisuje języka');
  if (!/data-ikona/.test(out)) fail.push('blok kodu nie ma przycisku kopiowania');
}

/* --- 5. ODCZYT TREŚCI WIADOMOŚCI -------------------------------------
   Wiadomości mają dwie postaci — stary zapis to goły string, nowy to obiekt.
   Każdy odczyt musi znieść obie, inaczej wczytanie starej rozmowy wywraca
   ekran. To realna ścieżka: rozmowy leżą w `localStorage` od pierwszej wersji. */
{
  const stara = { content: 'zwykły tekst' };
  const nowa = {
    content: {
      text: 'z załącznikami',
      images: ['data:,a'],
      photos: [{ thumb: '/1' }],
      docs: [{ name: 'dane.csv', text: 'a,b' }],
      run: { stdout: 'ok' },
      dalej: { pomin: 24 },
    },
  };
  const puste = { content: null };
  const odczyty = [
    ['msgText', (m) => T.msgText(m), 'zwykły tekst', 'z załącznikami', ''],
    ['msgImages', (m) => T.msgImages(m).length, 0, 1, 0],
    ['msgPhotos', (m) => T.msgPhotos(m).length, 0, 1, 0],
    ['msgDocs', (m) => T.msgDocs(m).length, 0, 1, 0],
    ['msgRun', (m) => (T.msgRun(m) ? 1 : 0), 0, 1, 0],
    ['msgDalej', (m) => (T.msgDalej(m) ? 1 : 0), 0, 1, 0],
  ];
  for (const [nazwa, f, oczStara, oczNowa, oczPusta] of odczyty) {
    for (const [opis, m, ocz] of [['stara', stara, oczStara], ['nowa', nowa, oczNowa], ['pusta', puste, oczPusta]]) {
      let got;
      try { got = f(m); } catch (e) { got = `WYJĄTEK: ${e.message}`; }
      if (got !== ocz) fail.push(`${nazwa} na wiadomości ${opis}: ${JSON.stringify(got)} zamiast ${JSON.stringify(ocz)}`);
    }
  }
  console.log(`5. odczyt treści: ${odczyty.length} funkcji × 3 postaci wiadomości`);

  // Materiał dla programu: najwyżej osiem plików, żeby nie wysłać całej rozmowy.
  const conv = { messages: Array.from({ length: 12 }, (_, i) => ({ content: { docs: [{ name: `p${i}.csv`, text: 'x' }] } })) };
  const pliki = T.zebranyMaterial(conv);
  console.log(`   materiał z 12 dokumentów: ${pliki.length} plików`);
  if (pliki.length !== 8) fail.push(`zebranyMaterial oddaje ${pliki.length} plików zamiast ośmiu`);
}

console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nTEKST NIE WPUSZCZA OK');
process.exit(fail.length ? 1 : 0);

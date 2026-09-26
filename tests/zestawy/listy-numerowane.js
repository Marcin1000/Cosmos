/* Listy numerowane mają liczyć 1, 2, 3, a nie „1. 1. 1.”.

   agencja-rozmowa, runda 5: plan od Claude'a stał na ekranie jako trzy listy
   po jednym punkcie, każdy z numerem 1. Dwie przyczyny w renderMarkdown:

   1. LISTA LUŹNA. GPT i Claude piszą punkty z pustą linią pomiędzy
      („1. Wawel\n\n2. Kopiec\n\n3. Bulwary”). Pusta linia zamykała listę.
   2. PLAN PRZEDZIELONY ZDJĘCIAMI. Znacznik [GRAFIKA: …] pod punktem dzieli
      odpowiedź na osobne wiadomości (tekst, siatka, tekst…). Druga zaczyna
      się od „2.”, a numer z tekstu przepadał – znów „1.”.

   Sprawdzamy to, co widzi człowiek: numery, które przeglądarka narysuje
   z wyniku renderMarkdown (`<ol start>` + liczba `<li>`), a nie brzmienie HTML-a.
   Do tego strona odwrotna: zwykłe akapity i lista wypunktowana nie sklejają
   się z numerowaną, a akapit między punktami nie jest wciągany do listy.
*/
const { utworzTekst } = require('../../public/tekst.js');
const { utworzProtokol } = require('../../public/protokol.js');

const { renderMarkdown } = utworzTekst({ t: (k) => k, COPY_SVG: '' });
const { PHOTO_MARKER_RE, stripSearchMarker } = utworzProtokol();
const fail = [];

/** Numery punktów tak, jak narysuje je przeglądarka. Listy wypunktowane jako „•”. */
function numery(html) {
  const wynik = [];
  const stos = [];
  for (const m of html.matchAll(/<(ol|ul)(?:\s+start="(\d+)")?>|<\/(ol|ul)>|<li>/g)) {
    if (m[1]) stos.push({ typ: m[1], n: m[2] ? Number(m[2]) : 1 });
    else if (m[3]) stos.pop();
    else {
      const lista = stos[stos.length - 1];
      wynik.push(lista.typ === 'ol' ? lista.n++ : '•');
    }
  }
  return wynik.join(' ');
}

function sprawdz(opis, tekst, oczekiwane, html = renderMarkdown(tekst)) {
  const widac = numery(html);
  const ok = widac === oczekiwane;
  console.log(`${ok ? 'OK ' : 'ŹLE'} ${opis}: ${widac}`);
  if (!ok) fail.push(`${opis}: „${widac}” zamiast „${oczekiwane}” (${html})`);
  return html;
}

// 1. Lista luźna – tak piszą GPT i Claude.
sprawdz('lista luźna (pusta linia między punktami)',
  '1. **Wawel** – złota godzina.\n\n2. **Kopiec Kraka** – zachód.\n\n3. Bulwary.', '1 2 3');
sprawdz('lista luźna z dwiema pustymi liniami',
  '1. Wawel\n\n\n2. Kopiec\n\n\n3. Bulwary', '1 2 3');
sprawdz('lista zwarta dalej działa', '1. a\n2. b\n3. c', '1 2 3');
sprawdz('lista luźna wypunktowana to jedna lista', '- a\n\n- b\n\n- c', '• • •');
{
  const html = renderMarkdown('1. a\n\n2. b\n\n3. c');
  const list = (html.match(/<ol/g) || []).length;
  if (list !== 1) fail.push(`lista luźna to ${list} list <ol> zamiast jednej`);
}

// 2. Numer z tekstu nie przepada.
sprawdz('lista zaczynająca się od 2', '2. Kopiec Kraka\n\n3. Bulwary', '2 3');
sprawdz('akapit między punktami: numeracja idzie dalej',
  '1. Wawel\n\nPotem przerwa na kawę.\n\n2. Kopiec', '1 2');

/* 3. Plan przedzielony siatką zdjęć. Kaskada (public/narzedzia.js) tnie
   odpowiedź na kawałki po każdym [GRAFIKA: …] i każdy kawałek rysuje jako
   osobną wiadomość – tu tniemy tym samym wzorcem i tym samym czyszczeniem. */
{
  const odpowiedz = 'Plan na sobotę:\n\n1. **Wawel** – złota godzina 6:41.\n[GRAFIKA: Wawel]\n\n'
    + '2. **Kopiec Kraka** – zachód.\n[GRAFIKA: Kopiec Kraka]\n\n3. **Bulwary** – niebieska godzina.';
  const kawalki = odpowiedz.split(new RegExp(PHOTO_MARKER_RE.source, 'gi'))
    .filter((_, i) => i % 2 === 0)             // split z grupą oddaje też treść znacznika
    .map((k) => stripSearchMarker(k)).filter(Boolean);
  const html = kawalki.map((k) => `<div class="msg">${renderMarkdown(k)}</div>`).join('<div class="siatka"></div>');
  sprawdz(`plan w ${kawalki.length} wiadomościach, przedzielony zdjęciami`, '', '1 2 3', html);
}

// 4. Wcięty dalszy ciąg punktu zostaje w punkcie, a nie jako akapit w liście.
{
  const html = sprawdz('wcięty opis pod punktem', '1. Wawel\n   złota godzina 6:41\n\n2. Kopiec\n\n   zachód 19:12', '1 2');
  if (/<ol[^>]*>[^]*<p>[^]*<\/ol>/.test(html)) fail.push(`akapit wewnątrz listy: ${html}`);
  if (!/złota godzina 6:41<\/li>/.test(html) || !/zachód 19:12<\/li>/.test(html)) fail.push(`opis punktu poza punktem: ${html}`);
}

// 5. Strona odwrotna – czego nie wolno sklejać.
sprawdz('wypunktowana, potem numerowana: dwie listy', '- a\n\n- b\n\n1. c\n\n2. d', '• • 1 2');
{
  const html = renderMarkdown('Wstęp.\n\n1. a\n\nKoniec listy, zwykły akapit.');
  if (!/<\/ol><p>Koniec listy, zwykły akapit\.<\/p>$/.test(html)) fail.push(`akapit po liście wciągnięty do listy: ${html}`);
  const bez = renderMarkdown('Zwykły tekst.\n\nDrugi akapit.');
  if (bez !== '<p>Zwykły tekst.</p><p>Drugi akapit.</p>') fail.push(`akapity bez listy zmienione: ${bez}`);
}
// Numer idzie do atrybutu – ma być liczbą i niczym więcej.
{
  const html = renderMarkdown('7) "><img src=x onerror=alert(1)>');
  if (!/^<ol start="7"><li>&quot;&gt;&lt;img/.test(html)) fail.push(`numer listy albo treść nie są bezpieczne: ${html}`);
}

console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nLISTY NUMEROWANE OK');
process.exit(fail.length ? 1 : 0);

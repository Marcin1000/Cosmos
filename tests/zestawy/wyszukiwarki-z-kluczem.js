/* Wyszukiwarki z kluczem: Serper (wyniki Google) i Brave.

   Marcin: „mógłby wyszukiwać lepiej, używając np. Google – tak, żeby jakość
   informacji, grafik i zdjęć była dużo większa”. Bez klucza Cosmos ma tylko
   DuckDuckGo (skrobane, z VPS-a chętnie odmawia), Commons i Openverse.

   Prawdziwy serwer Cosmosa, a Serper, Brave, DuckDuckGo i Commons udaje
   jedna atrapa w tym procesie:
     1. z SERPER_API_KEY tekst idzie przez Serper (klucz w nagłówku, polskie
        wyniki), ramka odpowiedzi Google jest pierwszym wynikiem, a DuckDuckGo
        nie jest w ogóle pytany,
     2. Serper pada → Brave (swój nagłówek), dalej bez DuckDuckGo,
     3. zdjęcia: Google na pierwszym miejscu, na przemian z Commons, a zdjęcia
        z DuckDuckGo dopiero za nimi; pełne zdjęcie to oryginał, źródło to strona,
     4. miniatury Google i Brave przechodzą przez proxy (host na liście),
     5. klucz nie wychodzi do przeglądarki: ani w wynikach, ani w /api/config,
     6. bez kluczy – po staremu, DuckDuckGo.
*/
const http = require('node:http');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

const PORT_ATRAPY = 7471;
const A = `http://127.0.0.1:${PORT_ATRAPY}`;
const wolania = [];
let serperPada = false;

const atrapa = http.createServer((req, res) => {
  let cialo = '';
  req.on('data', (c) => { cialo += c; });
  req.on('end', () => {
    const u = new URL(req.url, A);
    wolania.push({ sciezka: u.pathname, naglowki: req.headers, cialo, q: u.searchParams });
    const json = (kod, d) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (u.pathname === '/serper/search') {
      if (serperPada) return json(500, { message: 'awaria' });
      return json(200, {
        answerBox: { title: 'Pogoda Palermo', answer: '27 °C, słonecznie', link: 'https://pogoda.example/palermo' },
        organic: [{ title: 'Palermo – przewodnik', link: 'https://przewodnik.example/palermo', snippet: 'Katedra, targi, plaże.' },
          { title: 'Sycylia wrzesień', link: 'https://sycylia.example/wrzesien', snippet: 'Średnio 27 °C.' }],
      });
    }
    if (u.pathname === '/serper/images') {
      return json(200, { images: Array.from({ length: 6 }, (_, i) => ({
        title: `Katedra Palermo ${i}`, imageUrl: `https://zdjecia.example/katedra-${i}.jpg`, thumbnailUrl: `https://encrypted-tbn0.gstatic.com/images?q=tbn:${i}`,
        imageWidth: 1600, imageHeight: 1067, link: `https://strona.example/katedra-${i}`, domain: 'strona.example' })) });
    }
    if (u.pathname === '/brave/web/search') {
      return json(200, { web: { results: [{ title: 'Brave: Palermo', url: 'https://brave-wynik.example/palermo', description: 'Z Brave.' }] } });
    }
    if (u.pathname === '/commons') {
      return json(200, { query: { pages: { 1: { title: 'File:Palermo Cathedral.jpg', imageinfo: [{ thumburl: `${A}/c1.jpg`, url: `${A}/c1-pelne.jpg`, descriptionurl: 'https://commons.wikimedia.org/c1', width: 800, height: 600 }] },
        2: { title: 'File:Palermo Cathedral 2.jpg', imageinfo: [{ thumburl: `${A}/c2.jpg`, url: `${A}/c2-pelne.jpg`, descriptionurl: 'https://commons.wikimedia.org/c2', width: 800, height: 600 }] } } } });
    }
    if (u.pathname === '/openverse') return json(200, { results: [] });
    // DuckDuckGo: strona startowa grafik z żetonem, wyniki grafik, HTML wyszukiwania
    if (u.pathname === '/ddg/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<script>vqd="4-123"</script>'); }
    if (u.pathname === '/ddg/i.js') {
      return json(200, { results: Array.from({ length: 6 }, (_, i) => ({ title: `DDG ${i}`, thumbnail: `${A}/d${i}.jpg`, image: `${A}/d${i}-pelne.jpg`, url: `https://ddg.example/${i}` })) });
    }
    if (u.pathname === '/ddg-html/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<a class="result__a" href="https://ddg-wynik.example/palermo">DDG: Palermo</a><a class="result__snippet">z DDG</a>');
    }
    if (/\.example$/.test(u.hostname)) { res.writeHead(404); return res.end(); }
    res.writeHead(404); res.end();
  });
});

const ENV_WSPOLNE = {
  SEARCH_URL: `${A}/ddg-html/`, IMAGE_SEARCH_URL: `${A}/ddg/`,
  COMMONS_API_URL: `${A}/commons`, OPENVERSE_API_URL: `${A}/openverse`,
  SERPER_API_URL: `${A}/serper`, BRAVE_API_URL: `${A}/brave`,
};

(async () => {
  await new Promise((r) => atrapa.listen(PORT_ATRAPY, '127.0.0.1', r));
  const P1 = 3531;
  const srv = serwerCosmosa(P1, { ...ENV_WSPOLNE, SERPER_API_KEY: 'klucz-serpera', BRAVE_API_KEY: 'klucz-brave' });
  let srv2 = null;
  try {
    if (!(await czekajNa(`http://127.0.0.1:${P1}/api/auth`))) throw new Error('serwer testowy nie wstał');
    const S = `http://127.0.0.1:${P1}`;

    /* ---- 1. Tekst przez Serper ---- */
    wolania.length = 0;
    const d1 = await (await fetch(`${S}/api/search?q=pogoda%20Palermo`)).json();
    const serperW = wolania.find((w) => w.sciezka === '/serper/search');
    ok(d1.silnik === 'serper' && d1.results[0].url === 'https://pogoda.example/palermo' && /27 °C/.test(d1.results[0].snippet),
      `1. tekst przez Serper, ramka odpowiedzi Google pierwsza (${d1.silnik}: ${(d1.results[0] || {}).title})`);
    ok(serperW && serperW.naglowki['x-api-key'] === 'klucz-serpera' && JSON.parse(serperW.cialo).gl === 'pl', '1. klucz w nagłówku X-API-KEY, polskie wyniki (gl=pl)');
    ok(!wolania.some((w) => w.sciezka.startsWith('/ddg-html')), '1. DuckDuckGo nie był pytany');

    /* ---- 2. Serper pada → Brave ---- */
    serperPada = true;
    wolania.length = 0;
    const d2 = await (await fetch(`${S}/api/search?q=Palermo`)).json();
    serperPada = false;
    const braveW = wolania.find((w) => w.sciezka === '/brave/web/search');
    ok(d2.silnik === 'brave' && /Brave: Palermo/.test((d2.results[0] || {}).title), `2. Serper pada → Brave (${d2.silnik})`);
    ok(braveW && braveW.naglowki['x-subscription-token'] === 'klucz-brave' && braveW.q.get('country') === 'pl', '2. Brave z własnym nagłówkiem i krajem pl');
    ok(!wolania.some((w) => w.sciezka.startsWith('/ddg-html')), '2. DuckDuckGo dalej nie potrzebny');

    /* ---- 3. Zdjęcia ---- */
    const d3 = await (await fetch(`${S}/api/search/images?q=Katedra%20Palermo&ile=16`)).json();
    const zr = (d3.results || []).map((x) => (/^Google/.test(x.zrodlo) ? 'G' : x.zrodlo === 'Wikimedia Commons' ? 'C' : x.zrodlo === 'DuckDuckGo' ? 'D' : '?'));
    ok(zr.slice(0, 4).join('') === 'GCGC' && zr.indexOf('D') >= 4, `3. Google pierwszy, na przemian z Commons, DuckDuckGo dopiero za nimi (${zr.join('')})`);
    const g = (d3.results || []).find((x) => /^Google/.test(x.zrodlo)) || {};
    ok(g.full === 'https://zdjecia.example/katedra-0.jpg' && g.source === 'https://strona.example/katedra-0' && g.width === 1600,
      '3. pełne zdjęcie to oryginał, źródło to strona, wymiary podane');

    /* ---- 4. Miniatury przez proxy ---- */
    const { HOSTY_MINIATUR } = require('../../lib/szukanie.js');
    ok(HOSTY_MINIATUR.includes('encrypted-tbn0.gstatic.com') && HOSTY_MINIATUR.includes('imgs.search.brave.com'), '4. hosty miniatur Google i Brave są na liście proxy');
    const obcy = await fetch(`${S}/api/search/thumb?u=${encodeURIComponent('https://zdjecia.example/katedra-0.jpg')}`);
    ok(obcy.status === 403, `4. dowolny inny host dalej zablokowany (${obcy.status})`);

    /* ---- 5. Klucz nie wychodzi ---- */
    const config = await (await fetch(`${S}/api/config`)).text();
    ok(!/klucz-serpera|klucz-brave/.test(JSON.stringify(d1) + JSON.stringify(d3) + config), '5. klucza nie ma w wynikach ani w /api/config');

    /* ---- 6. Bez kluczy – po staremu ---- */
    zabij(srv);
    const P2 = 3532;
    srv2 = serwerCosmosa(P2, ENV_WSPOLNE);
    if (!(await czekajNa(`http://127.0.0.1:${P2}/api/auth`))) throw new Error('drugi serwer testowy nie wstał');
    wolania.length = 0;
    const d6 = await (await fetch(`http://127.0.0.1:${P2}/api/search?q=Palermo`)).json();
    ok(!d6.silnik && /DDG: Palermo/.test((d6.results[0] || {}).title) && !wolania.some((w) => /serper|brave/.test(w.sciezka)),
      `6. bez kluczy: DuckDuckGo, Serpera ani Brave nikt nie pyta (${(d6.results[0] || {}).title})`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    zabij(srv);
    if (srv2) zabij(srv2);
    atrapa.close();
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nWYSZUKIWARKI Z KLUCZEM OK');
  process.exit(fail.length ? 1 : 0);
})();

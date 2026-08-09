/* Atrapa źródeł grafik — wszystkich trzech.

   DuckDuckGo działa dwustopniowo, tak jak naprawdę: najpierw strona HTML
   z żetonem `vqd`, dopiero z nim wolno odpytać `i.js`. Atrapa pilnuje tej
   kolejności — bez żetonu oddaje pustkę, tak jak oryginał.

   Commons i Openverse dostały tu kształt odpowiedzi zgodny z ich
   dokumentacją. UWAGA na uczciwość: to sprawdza, czy Cosmos POPRAWNIE CZYTA
   taki kształt — nie dowodzi, że prawdziwe usługi dokładnie taki oddają.
   Tego dowodzi dopiero `node scripts/grafiki.js` puszczone na serwerze
   z prawdziwą siecią.

   Atrapa umie też ODMÓWIĆ: `?awaria=commons,ddg` w adresie ustawia, które
   źródła mają paść. Bez tego nie da się sprawdzić rzeczy najważniejszej —
   że kiedy jedno źródło pada, zdjęcia i tak się pokazują. */
const http = require('http');

const ZETON = '4-123456789';
// Które źródła mają udawać awarię — ustawiane przez /awaria?zrodla=...
let padnij = new Set();

const OBRAZY = (q) => Array.from({ length: 8 }, (_, i) => ({
  title: `${q} — zdjęcie ${i + 1}`,
  thumbnail: `http://127.0.0.1:7117/iu/?u=mini${i}`,
  image: `https://przyklad.pl/${encodeURIComponent(q)}-${i}.jpg`,
  url: `https://przyklad.pl/strona/${i}`,
  width: 1200, height: 800,
}));

/* Kształt odpowiedzi Wikimedia Commons: `query.pages` kluczowane po numerze
   strony, każda z tablicą `imageinfo`, w niej `thumburl` i `extmetadata`. */
const COMMONS = (q, ile) => ({
  query: {
    pages: Object.fromEntries(Array.from({ length: ile }, (_, i) => [String(100 + i), {
      pageid: 100 + i,
      title: `File:${q} ${i + 1}.jpg`,
      imageinfo: [{
        thumburl: `http://127.0.0.1:7117/iu/?u=commons${i}`,
        url: `https://upload.wikimedia.org/${encodeURIComponent(q)}-${i}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${i}.jpg`,
        width: 2400, height: 1600,
        extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } },
      }],
    }])),
  },
});

/* Kształt odpowiedzi Openverse: płaska lista `results`. */
const OPENVERSE = (q, ile) => ({
  result_count: ile,
  results: Array.from({ length: ile }, (_, i) => ({
    id: `ov-${i}`,
    title: `${q} — Openverse ${i + 1}`,
    thumbnail: `http://127.0.0.1:7117/iu/?u=ov${i}`,
    url: `https://openverse.example/${encodeURIComponent(q)}-${i}.jpg`,
    foreign_landing_url: `https://openverse.example/strona/${i}`,
    license: 'by-nc', license_version: '4.0',
    width: 1600, height: 1200,
  })),
});

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const q = u.searchParams.get('q') || u.searchParams.get('gsrsearch') || '';
  const json = (kod, obiekt) => {
    res.writeHead(kod, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obiekt));
  };

  // Sterowanie awariami — bez tego nie sprawdzimy zapasowych źródeł.
  if (u.pathname === '/awaria') {
    padnij = new Set((u.searchParams.get('zrodla') || '').split(',').filter(Boolean));
    return json(200, { padaja: [...padnij] });
  }

  /* Atrapa Nominatim (nazwa miejsca → współrzędne). Zna kilka miast; na
     resztę odpowiada pustą listą, tak jak oryginał przy nieznanej nazwie. */
  if (u.pathname === '/geokoduj') {
    const ZNANE = {
      'kraków': [50.0614, 19.9366, 'Kraków, województwo małopolskie, Polska'],
      'krakow': [50.0614, 19.9366, 'Kraków, województwo małopolskie, Polska'],
      'gdańsk': [54.3520, 18.6466, 'Gdańsk, województwo pomorskie, Polska'],
      'zakopane': [49.2992, 19.9496, 'Zakopane, województwo małopolskie, Polska'],
    };
    const t = ZNANE[String(u.searchParams.get('q') || '').trim().toLowerCase()];
    return json(200, t ? [{ lat: String(t[0]), lon: String(t[1]), display_name: t[2] }] : []);
  }

  /* SearXNG — kształt odpowiedzi zgodny z jego wyjściem `format=json`.
     Obsługuje obie kategorie: grafiki i strony. */
  if (u.pathname === '/searxng/search') {
    if (padnij.has('searxng')) return json(403, { error: 'atrapa: searxng wyłączony' });
    const grafiki = (u.searchParams.get('categories') || '').includes('images');
    return json(200, {
      results: Array.from({ length: 4 }, (_, i) => (grafiki ? {
        title: `${q} — SearXNG ${i + 1}`,
        thumbnail_src: `http://127.0.0.1:7117/iu/?u=sx${i}`,
        img_src: `https://searx.example/${encodeURIComponent(q)}-${i}.jpg`,
        url: `https://searx.example/strona/${i}`,
        resolution: '1600x1200',
        source: 'example.com',
      } : {
        title: `${q} — wynik ${i + 1}`,
        url: `https://przyklad.pl/${i}`,
        content: `Zajawka wyniku ${i + 1} dla zapytania ${q}.`,
      })),
    });
  }

  /* Atrapa NOAA SWPC. Dwa strumienie o RÓŻNYM kształcie i to jest sedno:
     bieżące Kp to lista obiektów, a prognoza — lista TABLIC z wierszem
     nagłówka. Pomylenie ich to najłatwiejszy błąd przy czytaniu tego API. */
  if (u.pathname === '/swpc/kp') {
    if (padnij.has('swpc')) return json(503, { error: 'atrapa: SWPC wyłączony' });
    return json(200, [
      { time_tag: '2026-08-08T07:00:00', kp_index: 4.33 },
      { time_tag: '2026-08-08T07:01:00', kp_index: 6.67 },
    ]);
  }
  if (u.pathname === '/swpc/prognoza') {
    if (padnij.has('swpc')) return json(503, { error: 'atrapa: SWPC wyłączony' });
    const zaGodzin = (h) => new Date(Date.now() + h * 3600 * 1000)
      .toISOString().replace('T', ' ').slice(0, 19);
    return json(200, [
      ['time_tag', 'kp', 'observed', 'noaa_scale'],
      [zaGodzin(-24), '3.00', 'observed', null],   // przeszłość — ma wypaść
      [zaGodzin(3), '5.67', 'predicted', 'G1'],
      [zaGodzin(6), '7.33', 'predicted', 'G3'],
      [zaGodzin(9), '4.00', 'predicted', null],
    ]);
  }

  if (u.pathname === '/commons') {
    if (padnij.has('commons')) return json(503, { error: 'atrapa: commons wyłączony' });
    return json(200, COMMONS(q, 4));
  }

  if (u.pathname === '/openverse') {
    if (padnij.has('openverse')) return json(503, { error: 'atrapa: openverse wyłączony' });
    return json(200, OPENVERSE(q, 4));
  }

  // krok 1 — strona z żetonem
  if (u.pathname === '/' && u.searchParams.get('ia') === 'images') {
    if (padnij.has('ddg')) { res.writeHead(403); return res.end('blocked'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<html><body><script>vqd="${ZETON}";</script></body></html>`);
  }

  // krok 2 — właściwe wyniki, ale tylko z poprawnym żetonem
  if (u.pathname === '/i.js') {
    if (padnij.has('ddg')) return json(403, { results: [] });
    if (u.searchParams.get('vqd') !== ZETON) return json(403, { results: [] });
    return json(200, { results: OBRAZY(q) });
  }

  // miniatura — jednopikselowy GIF, żeby proxy miało co przepuścić
  if (u.pathname === '/iu/') {
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Length': gif.length });
    return res.end(gif);
  }

  res.writeHead(404); res.end();
}).listen(7117, () => console.log('atrapa grafik na 7117'));

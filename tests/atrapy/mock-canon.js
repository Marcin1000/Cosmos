/* Atrapa aparatu Canon z CCAPI.
 *
 * Odwzorowuje to, co jest w tej rozmowie istotne, i NIE UDAJE, że wie więcej:
 *   • `/ccapi` oddaje SPIS obsługiwanych ścieżek — na tym stoi cała nasza
 *     odporność na różnice wersji, więc atrapa musi to mieć,
 *   • nastawy mają `value` ORAZ `ability` (listę dopuszczalnych wartości),
 *   • wartość spoza listy jest odrzucana z komunikatem, tak jak w aparacie.
 *
 * Sterowanie zachowaniem przez adres:
 *   /awaria?co=busy       — aparat zajęty (503), tak jak przy zapisie na kartę
 *   /awaria?co=brak-iso   — ISO znika ze spisu (tryb automatyczny)
 *   /awaria?co=off        — aparat przestaje odpowiadać (uśpione Wi-Fi)
 */
const http = require('http');

const PORT = Number(process.env.PORT || 7120);

let awaria = '';
const stan = {
  iso: { value: 'auto', ability: ['auto', '100', '200', '400', '800', '1600', '3200', '6400'] },
  av: { value: 'f4.0', ability: ['f2.8', 'f4.0', 'f5.6', 'f8.0', 'f11', 'f16'] },
  tv: { value: '1/60', ability: ['1/30', '1/60', '1/125', '1/250', '1/500', '1/1000', '4"'] },
  wb: { value: 'auto', ability: ['auto', 'daylight', 'shade', 'tungsten'] },
};
let wyzwolen = 0;

function spis() {
  const sciezki = [
    'deviceinformation',
    'shooting/settings/iso',
    'shooting/settings/av',
    'shooting/settings/tv',
    'shooting/settings/wb',
    'shooting/control/shutterbutton',
  ].filter((s) => !(awaria === 'brak-iso' && s.endsWith('/iso')));
  return {
    ver100: sciezki.map((s) => ({
      path: `/ccapi/ver100/${s}`, get: true, post: s.includes('control'), put: s.includes('settings'),
    })),
    /* Druga wersja z tą samą trasą — sprawdzamy, że wybieramy NOWSZĄ.
       Gdy aparat przestaje wystawiać nastawę, znika ona ze WSZYSTKICH wersji;
       pierwsza wersja atrapy chowała ją tylko z ver100 i przez to udawała
       sytuację, która na prawdziwym aparacie nie występuje. */
    ver110: awaria === 'brak-iso' ? []
      : [{ path: '/ccapi/ver110/shooting/settings/iso', get: true, put: true }],
  };
}

const KLUCZE = { iso: 'iso', av: 'av', tv: 'tv', wb: 'wb' };

const serwer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const odp = (kod, dane) => {
    res.writeHead(kod, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(dane));
  };

  if (p === '/awaria') { awaria = url.searchParams.get('co') || ''; return odp(200, { awaria }); }
  if (p === '/licznik') return odp(200, { wyzwolen, stan });

  if (awaria === 'off') { req.destroy(); return; }
  if (awaria === 'busy') return odp(503, { message: 'Device busy.' });

  if (p === '/ccapi') return odp(200, spis());
  if (p.endsWith('/deviceinformation')) {
    return odp(200, {
      manufacturer: 'Canon', productname: 'Canon EOS R6m2',
      serialnumber: '123456789', firmwareversion: '1.7.0',
    });
  }

  const nastawa = Object.keys(KLUCZE).find((k) => p.endsWith(`/shooting/settings/${k}`));
  if (nastawa) {
    if (req.method === 'GET') return odp(200, stan[nastawa]);
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let d = {};
        try { d = JSON.parse(body); } catch { /* puste */ }
        const v = String(d.value);
        if (!stan[nastawa].ability.includes(v)) {
          return odp(400, { message: `Invalid parameter: ${v}` });
        }
        stan[nastawa].value = v;
        odp(200, { value: v });
      });
      return undefined;
    }
  }

  if (p.endsWith('/shooting/control/shutterbutton') && req.method === 'POST') {
    wyzwolen++;
    return odp(200, {});
  }
  return odp(404, { message: 'Not found' });
});

serwer.listen(PORT, () => console.log(`atrapa Canona na ${PORT}`));

/* Lokalizacja i plan przy awariach usług – i w innej strefie czasu.

   Zespół IT, runda 5:
     – przy padniętym geokoderze wpisany „Reykjavik" zapisywał się ze
       współrzędnymi Krakowa; ekran mówił „bez współrzędnych Plener nie policzy",
       a Plener liczył – dla Krakowa. Po powrocie usługi ta sama nazwa nie była
       już szukana („Znaleziono 50.06, 19.94"),
     – „Wykryj" gubił współrzędne GPS, gdy geokoder odpowiedział 200 bez adresu,
     – plan dla Reykjavíku liczył wszystko w czasie polskim (19:00 → 17:00Z,
       zachód o 21:09 zamiast 19:09),
     – plan „W pomieszczeniu" czekał 7 s na zawieszoną pogodę i zorzę,
     – jedna kolejka geokodera: trzy osoby naraz czekały 6, 12 i 18 s.

   Wszystko przez HTTP, na atrapach geokodera i pogody.
*/
const http = require('node:http');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3504;
const S = `http://127.0.0.1:${PORT}`;
const fail = [];
const ok = (warunek, opis) => { console.log(`${warunek ? 'ok ' : 'ŹLE'} ${opis}`); if (!warunek) fail.push(opis); };

let geokoderPadl = false;
let pogodaWisi = false;
let zapytaniaGeo = 0;
const MIEJSCA = {
  krakow: { lat: '50.0614', lon: '19.9366', display_name: 'Kraków, Małopolska' },
  reykjavik: { lat: '64.1466', lon: '-21.9426', display_name: 'Reykjavík, Stolica' },
};
const STREFY = { '50.06': ['Europe/Warsaw', 7200], '64.15': ['Atlantic/Reykjavik', 0] };

const atrapa = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const json = (kod, d) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
  if (u.pathname === '/szukaj') {
    zapytaniaGeo++;
    if (geokoderPadl) return json(429, { error: 'too many requests' });
    const t = MIEJSCA[(u.searchParams.get('q') || '').toLowerCase()];
    return json(200, t ? [t] : []);
  }
  if (u.pathname === '/odwrotnie') return json(200, { error: 'Unable to geocode' });
  if (u.pathname === '/pogoda') {
    if (pogodaWisi) return;                        // nigdy nie odpowiada
    const lat = Number(u.searchParams.get('latitude')).toFixed(2);
    const [timezone, off] = STREFY[lat] || ['GMT', 0];
    return json(200, { timezone, utc_offset_seconds: off,
      current: { weather_code: 0, cloud_cover: 0, temperature_2m: 10, wind_speed_10m: 2 },
      hourly: { time: [], weather_code: [], cloud_cover: [], temperature_2m: [] } });
  }
  return json(404, {});
});

async function zadaj(sciezka, dane) {
  const t0 = Date.now();
  const r = await fetch(`${S}${sciezka}`, {
    method: dane === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: dane === undefined ? undefined : JSON.stringify(dane),
  });
  return { kod: r.status, json: await r.json().catch(() => ({})), ms: Date.now() - t0 };
}

(async () => {
  await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${atrapa.address().port}`;
  const srv = serwerCosmosa(PORT, {
    GEOCODE_SEARCH_URL: `${A}/szukaj`, GEOCODE_URL: `${A}/odwrotnie`, GEOCODE_COUNTRY: '',
    GEOCODE_BEZPIECZNIK_MS: '1500', WEATHER_URL: `${A}/pogoda`, WEATHER_TIMEOUT_MS: '4000',
    SWPC_KP_URL: `${A}/kp`, SWPC_KP_FORECAST_URL: `${A}/kp2`, TZ: 'Europe/Warsaw', SENSES_URL: 'http://127.0.0.1:1',
  });
  try {
    if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer testowy nie wstał');

    /* ---- 1. Nowa nazwa przy padniętym geokoderze ---- */
    const krakow = await zadaj('/api/location', { location: 'Krakow' });
    ok(krakow.json.wspolrzedne && Math.abs(krakow.json.wspolrzedne.lat - 50.06) < 0.01, '1. Kraków zapisany ze współrzędnymi');
    geokoderPadl = true;
    const rey = await zadaj('/api/location', { location: 'Reykjavik' });
    ok(!rey.json.wspolrzedne, `1. Reykjavik przy padniętym geokoderze NIE dostaje współrzędnych Krakowa (${JSON.stringify(rey.json.wspolrzedne)})`);
    ok(rey.json.wspolrzedneNieznane && rey.json.powod === 'usluga', `1. przyczyna nazwana: usługa, nie „nie ma miejsca" (${rey.json.powod})`);
    const plan = await zadaj('/api/plan', {});
    ok(plan.kod === 400 && plan.json.brakLokalizacji, `1. Plener nie liczy dla Krakowa pod nazwą „Reykjavik" (${plan.kod})`);

    /* ---- 1b. Bezpiecznik: kolejne zapytania nie czekają w kolejce ---- */
    const przed = zapytaniaGeo;
    const naraz = await Promise.all(['Oslo', 'Bergen', 'Tromso'].map((m) => zadaj('/api/location', { location: m })));
    ok(zapytaniaGeo === przed && naraz.every((r) => r.ms < 1500), `1b. po odmowie usługi bez kolejki: ${naraz.map((r) => r.ms).join('/')} ms, zapytań ${zapytaniaGeo - przed}`);

    /* ---- 1c. Ta sama nazwa po powrocie usługi jest szukana od nowa ---- */
    geokoderPadl = false;
    await new Promise((r) => setTimeout(r, 1600));
    const rey2 = await zadaj('/api/location', { location: 'Reykjavik' });
    ok(rey2.json.wspolrzedne && Math.abs(rey2.json.wspolrzedne.lat - 64.15) < 0.01,
      `1c. ta sama nazwa po powrocie usługi → współrzędne Reykjavíku (${JSON.stringify(rey2.json.wspolrzedne)})`);

    /* ---- 2. Wykryj: 200 bez adresu ---- */
    const wykryj = await zadaj('/api/location/resolve', { lat: 54.5, lon: 18.9 });
    ok(wykryj.kod === 200 && wykryj.json.bezNazwy, `2. „Wykryj" na morzu zapisuje współrzędne (${wykryj.kod}, bezNazwy=${wykryj.json.bezNazwy})`);

    /* ---- 3. Plan w strefie miejsca ---- */
    const planR = await zadaj('/api/plan', { miejsce: 'Reykjavik', kiedy: '2026-10-02T19:00', zachmurzenie: 'lekkie' });
    ok(planR.json.kiedy === '2026-10-02T19:00:00.000Z', `3. „19:00" w Reykjavíku to 19:00Z (${planR.json.kiedy})`);
    ok(planR.json.slonce && planR.json.slonce.lokalnie.strefa === 'Atlantic/Reykjavik', `3. godziny w strefie miejsca (${planR.json.slonce && planR.json.slonce.lokalnie.strefa})`);
    const zach = planR.json.slonce && planR.json.slonce.lokalnie.zachod;
    ok(/^(18|19):\d\d$/.test(zach || ''), `3. zachód w Reykjavíku o czasie tamtejszym (${zach})`);
    const planK = await zadaj('/api/plan', { miejsce: 'Krakow', kiedy: '2026-10-02T19:00', zachmurzenie: 'lekkie' });
    ok(planK.json.kiedy === '2026-10-02T17:00:00.000Z', `3. „19:00" w Krakowie to 17:00Z (${planK.json.kiedy})`);

    /* ---- 4. Wnętrze nie czeka na pogodę ---- */
    pogodaWisi = true;
    const wn = await zadaj('/api/plan', { zachmurzenie: 'wnetrze', lat: 50.1, lon: 20.1 });
    ok(wn.kod === 200 && wn.ms < 2500, `4. plan „W pomieszczeniu" przy zawieszonej pogodzie: ${wn.ms} ms`);
    ok(!/bezchmurn/.test(String(wn.json.zachmurzenie)), `4. wnętrze nie udaje „bezchmurnie" (${wn.json.zachmurzenie})`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    zabij(srv); atrapa.close();
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nMIEJSCE I STREFA OK');
  process.exit(fail.length ? 1 : 0);
})();

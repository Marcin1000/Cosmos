/* Dwa dołożenia do wyróżników: prognoza w planie zdjęciowym i OneDrive jako
   źródło archiwum.

   Prognoza ma znaczenie, bo pozycja Słońca mówi tylko, ile światła BYŁOBY
   przy czystym niebie. Chmury zabierają dwie i pół działki, deszcz cztery —
   bez tego panel proponowałby f/11 w środku ulewy.

   Przy OneDrive najwięcej uwagi idzie na to, czego NIE wolno: tokeny i sekret
   aplikacji nie mogą wyjść do przeglądarki, a callback nie może przyjąć kodu
   bez pasującego `state`. */
const http = require('node:http');
const { srodowisko, zwolnijPorty } = require('../pomoc');
const { pogodaDla, zKoduWmo } = require('../../lib/pogoda.js');
const onedrive_ = require('../../lib/onedrive.js');

const PORT = 7118;

(async () => {
  const fail = [];

  // --- 1. kody WMO → kategorie zachmurzenia ---
  const kody = [[0, 'bezchmurnie'], [1, 'lekkie'], [3, 'pochmurno'], [45, 'pochmurno'],
    [63, 'deszcz'], [75, 'deszcz'], [95, 'deszcz']];
  for (const [kod, chciane] of kody) {
    if (zKoduWmo(kod) !== chciane) fail.push(`kod ${kod} → ${zKoduWmo(kod)}, oczekiwano ${chciane}`);
  }
  console.log(`1. kody pogodowe: ${kody.map(([k]) => `${k}→${zKoduWmo(k)}`).join(' ')}`);
  if (zKoduWmo(null) !== null) fail.push('brak kodu powinien dać null, nie zgadywanie');

  // --- 2. prognoza niedostępna nie może wywrócić planu ---
  process.env.WEATHER_URL = 'http://127.0.0.1:1/nie-ma';
  delete require.cache[require.resolve('../../lib/pogoda.js')];
  const { pogodaDla: pogodaZepsuta } = require('../../lib/pogoda.js');
  const nic = await pogodaZepsuta(52.02, 20.9);
  console.log(`2. usługa pogodowa nie odpowiada → ${nic === null ? 'null (plan liczy się dalej)' : 'COŚ ODDAŁ'}`);
  if (nic !== null) fail.push('przy zerwanej pogodzie oddaje coś zamiast null');

  // --- 3. atrapa Open-Meteo: prognoza wchodzi do planu ---
  await zwolnijPorty([PORT]);
  const atrapa = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/pogoda') {
      const teraz = new Date();
      const godziny = [];
      for (let i = 0; i < 48; i++) {
        const t = new Date(teraz.getTime() + i * 3600000);
        godziny.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`
          + `-${String(t.getDate()).padStart(2, '0')}T${String(t.getHours()).padStart(2, '0')}:00`);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        current: { temperature_2m: 18.4, weather_code: 3, cloud_cover: 95, wind_speed_10m: 12 },
        hourly: {
          time: godziny,
          temperature_2m: godziny.map(() => 15),
          weather_code: godziny.map(() => 61),        // słaby deszcz
          cloud_cover: godziny.map(() => 90),
          precipitation_probability: godziny.map(() => 70),
        },
      }));
    }
    // --- atrapa Microsoft Graph ---
    if (u.pathname === '/graph/me/drive/root/children') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ value: [
        { id: 'f1', name: 'Zdjecia', folder: { childCount: 2 } },
        { id: 'x1', name: 'notatki.txt', size: 12 },
      ] }));
    }
    if (u.pathname === '/graph/me/drive/items/f1/children') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ value: [
        { id: 'p1', name: 'IMG_9001.jpg', size: 8400000,
          parentReference: { path: '/drive/root:/Zdjecia' },
          image: { width: 6000, height: 4000 },
          photo: { takenDateTime: '2026-06-14T20:40:00Z', cameraMake: 'Canon',
            cameraModel: 'EOS R6m2', focalLength: 50, fNumber: 1.8, iso: 400,
            exposureNumerator: 1, exposureDenominator: 200 },
          location: { latitude: 52.2297, longitude: 21.0122 },
          thumbnails: [{ small: { url: 'https://przyklad/mini1.jpg' } }] },
        { id: 'v1', name: 'DJI_0044.MP4', size: 990000000,
          parentReference: { path: '/drive/root:/Zdjecia' },
          photo: { takenDateTime: '2026-06-15T20:45:00Z' } },
        { id: 'z1', name: 'projekt.psd', size: 4000 },
      ] }));
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise((ok) => atrapa.listen(PORT, ok));

  process.env.WEATHER_URL = `http://127.0.0.1:${PORT}/pogoda`;
  delete require.cache[require.resolve('../../lib/pogoda.js')];
  const { pogodaDla: pogodaOk } = require('../../lib/pogoda.js');

  const teraz = await pogodaOk(52.02, 20.9);
  console.log(`3. teraz: ${teraz.opis}, ${teraz.temperatura}°C, ${teraz.zachmurzenie} (${teraz.zrodlo})`);
  if (teraz.zachmurzenie !== 'pochmurno') fail.push(`bieżąca pogoda: ${teraz.zachmurzenie}`);
  if (!/bieżąc/.test(teraz.zrodlo)) fail.push('dla „teraz" powinien wziąć pomiar bieżący, nie prognozę');

  // 4. prognoza na później bierze się z godzinówki, nie z pomiaru bieżącego
  const zaTrzy = await pogodaOk(52.02, 20.9, new Date(Date.now() + 3 * 3600000));
  console.log(`4. za 3 h: ${zaTrzy.opis}, ${zaTrzy.zachmurzenie}, opady ${zaTrzy.opadyProc}% (${zaTrzy.zrodlo})`);
  if (zaTrzy.zachmurzenie !== 'deszcz') fail.push(`prognoza za 3 h: ${zaTrzy.zachmurzenie}`);
  if (!/prognoza/.test(zaTrzy.zrodlo)) fail.push('dla przyszłości powinien wziąć prognozę godzinową');

  // --- 5. OneDrive: mapowanie pozycji Graph na wpisy archiwum ---
  const od = onedrive_.utworz({
    katalogDanych: require('node:fs').mkdtempSync('/tmp/cosmos-od-'),
    clientId: 'x', clientSecret: 'y', redirectUri: 'https://przyklad/cb',
  });
  console.log(`5. skonfigurowany=${od.skonfigurowany()}, połączony=${od.polaczony()}`);
  if (!od.skonfigurowany()) fail.push('nie widzi własnej konfiguracji');
  if (od.polaczony()) fail.push('twierdzi, że połączony bez tokenu');

  // 6. adres logowania zawiera to, co musi — i `offline_access`
  const url = od.adresLogowania('abc123');
  console.log(`6. adres logowania: ${url.slice(0, 78)}…`);
  if (!url.includes('offline_access')) fail.push('brak offline_access — token wygasłby po godzinie');
  if (!url.includes('state=abc123')) fail.push('brak parametru state (ochrona przed podrzuceniem kodu)');
  if (!url.includes('response_type=code')) fail.push('zły typ odpowiedzi OAuth');

  // --- 7. przez API: statusy, ochrona callbacku, brak wycieku sekretów ---
  const env = await srodowisko('kontekst');
  const status = await (await fetch(`${env.adres}/api/onedrive/status`)).json();
  console.log(`7. status: skonfigurowany=${status.skonfigurowany}, w archiwum=${status.wArchiwum}`);
  if (status.skonfigurowany !== false) fail.push('bez zmiennych .env twierdzi, że jest skonfigurowany');

  const bezKonfiguracji = await fetch(`${env.adres}/api/onedrive/login`);
  const komunikat = await bezKonfiguracji.json();
  console.log(`8. logowanie bez konfiguracji → HTTP ${bezKonfiguracji.status}: „${komunikat.error.slice(0, 60)}…"`);
  if (bezKonfiguracji.status !== 400) fail.push('nie tłumaczy, że brakuje konfiguracji');
  if (!/ONEDRIVE_CLIENT_ID/.test(komunikat.error)) fail.push('nie mówi, CO ustawić');

  /* 9. Callback bez pasującego `state` musi odmówić. Bez tego ktoś, kto zna
     adres Cosmosa, mógłby podrzucić własny kod autoryzacyjny i podpiąć
     SWÓJ OneDrive pod cudze archiwum. */
  const podrzucony = await fetch(`${env.adres}/api/onedrive/callback?code=cudzy&state=zmyslony`);
  const html = await podrzucony.text();
  console.log(`9. callback z obcym state → ${/Nieprawidłowy/.test(html) ? 'odrzucony' : 'PRZYJĘTY'}`);
  if (!/Nieprawidłowy/.test(html)) fail.push('callback przyjmuje kod bez pasującego state');

  // 10. sekrety nie wychodzą do przeglądarki
  const cala = JSON.stringify(status);
  console.log(`10. w /status: ${/secret|token|refresh/i.test(cala) ? 'SĄ ŚLADY SEKRETÓW' : 'brak sekretów'}`);
  if (/secret|refresh_token|access_token/i.test(cala)) fail.push('status ujawnia sekrety');

  const konfig = await (await fetch(`${env.adres}/api/config`)).json();
  if (/ONEDRIVE_CLIENT_SECRET|refresh_token/i.test(JSON.stringify(konfig))) {
    fail.push('/api/config ujawnia sekret OneDrive');
  }

  // 11. indeksowanie bez połączenia — odmowa, nie wywrotka
  const bezPolaczenia = await fetch(`${env.adres}/api/onedrive/index`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  console.log(`11. indeksowanie bez połączenia → HTTP ${bezPolaczenia.status}`);
  if (bezPolaczenia.status !== 400) fail.push('próbuje indeksować bez połączenia');

  // 12. plan zdjęciowy bierze pogodę, gdy użytkownik jej nie narzucił
  await fetch(`${env.adres}/api/location`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: 'Piaseczno', lat: 52.2297, lon: 21.0122 }),
  });
  const plan = await (await fetch(`${env.adres}/api/plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sprzet: 'canon-r6ii', tryb: 'wideo', klatki: 25 }),
  })).json();
  console.log(`12. plan bez podanego nieba → zachmurzenie „${plan.zachmurzenie}", pogoda: `
    + `${plan.pogoda ? plan.pogoda.opis : 'brak'}`);
  if (!plan.pogoda) fail.push('plan nie sięgnął po prognozę');
  if (plan.zachmurzenie !== 'pochmurno') fail.push(`plan wziął ${plan.zachmurzenie} zamiast prognozy`);

  // 13. wybór ręczny wygrywa z prognozą — stoisz na miejscu i widzisz niebo
  const reczny = await (await fetch(`${env.adres}/api/plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sprzet: 'canon-r6ii', tryb: 'wideo', klatki: 25, zachmurzenie: 'bezchmurnie' }),
  })).json();
  console.log(`13. z ręcznym „bezchmurnie" → ${reczny.zachmurzenie}, pogoda: ${reczny.pogoda ? 'pobrana' : 'pominięta'}`);
  if (reczny.zachmurzenie !== 'bezchmurnie') fail.push('prognoza nadpisała ręczny wybór użytkownika');
  if (reczny.pogoda) fail.push('niepotrzebnie odpytał pogodę mimo ręcznego wyboru');

  atrapa.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPOGODA I ONEDRIVE OK');
  process.exit(fail.length ? 1 : 0);
})();

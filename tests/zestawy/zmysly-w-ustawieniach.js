/* Ustawienia → Zmysły w przeglądarce – lista komputerów pod palcami.

   Agencja i zespół IT (runda 6) na prawdziwym agencie: lista przerysowywała
   się w całości co 4 s. Zaznaczony pakiet znikał, zanim ktoś kliknął
   „Zainstaluj”, fokus klawiatury spadał na <body>, dwuklik dawał dwie
   instalacje naraz, a upadek składnika pokazywał surowy traceback.

   Lista komputerów przychodzi z atrapy (page.route) – ten zestaw sprawdza
   widok, a agenta i serwer sprawdza zestaw `agent-zmyslow`:
     1. upadek składnika: ludzkie zdanie nad dziennikiem (brakujący pakiet
        nazwany po imieniu),
     2. zaznaczony pakiet zostaje zaznaczony po kolejnych odświeżeniach,
     3. fokus na przełączniku zostaje na nim po odświeżeniu,
     4. „Zainstaluj zaznaczone” kliknięte dwa razy wysyła JEDNO polecenie,
     5. komputer niepołączony: zdanie, co to znaczy; na 360 px stan składnika
        nie nachodzi na jego etykietę.
*/
const { przegladarka, maPrzegladarke, serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3509;
const S = `http://127.0.0.1:${PORT}`;
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

let licznik = 0;
function lista(online) {
  licznik++;
  return {
    zrodlo: online ? 'agent' : '',
    agenci: [{
      id: 'k1', nazwa: 'laptop-ani', utworzono: 1, online, uspiony: false, ostatnio: Date.now() + licznik,
      caps: { whisper: true, extract: true }, zmyslyDzialaja: online, system: 'Windows 11',
      chce: { zmysly: true, obserwator: true, kinect: false },
      skladniki: {
        zmysly: { dziala: true, jest: true, kodWyjscia: null },
        obserwator: { dziala: false, jest: true, kodWyjscia: 1,
          log: 'Traceback (most recent call last):\n  File "watcher.py", line 29\nModuleNotFoundError: No module named \'ultralytics\'' },
        kinect: { dziala: false, jest: true, kodWyjscia: null },
      },
      pakiety: { rdzen: true, dokumenty: true, sluch: true, wzrok: false, cialo: false, pamiec: false, glos: false },
      instalacja: null, autostart: true, nieaktualny: false,
    }],
  };
}

(async () => {
  const srv = serwerCosmosa(PORT, { SENSES_URL: 'http://127.0.0.1:1' });
  const b = await przegladarka();
  try {
    if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer testowy nie wstał');
    const bledy = [];
    let online = true;
    let polecen = 0;
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => bledy.push(e.message));
    await p.route('**/api/agent/lista', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lista(online)) }));
    await p.route('**/api/agent/polecenie?*', (r) => { polecen++; setTimeout(() => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }), 300); });
    await p.goto(`${S}/app`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.app.gotowa') && typeof openSettings === 'function');
    await p.evaluate(() => openSettings('zmysly'));
    await p.waitForSelector('.zm-komputer');

    /* ---- 1. Ludzkie zdanie przy upadku ---- */
    const zdanie = await p.$eval('.zm-dlaczego', (e) => e.textContent).catch(() => '');
    ok(/ultralytics/.test(zdanie) && !/Traceback/.test(zdanie), `1. upadek obserwatora: ludzkie zdanie z nazwą pakietu („${zdanie}”)`);

    /* ---- 2. Zaznaczony pakiet przeżywa odświeżenie ---- */
    await p.evaluate(() => { const d = document.querySelector('.zm-pakiety'); d.open = true; });
    await p.evaluate(() => document.querySelector('.zm-pakiety input[value="wzrok"]').click());
    await p.evaluate(() => document.body.focus());
    await p.waitForTimeout(9000);   // co najmniej dwa odświeżenia (co 4 s), za każdym razem inna odpowiedź
    const zaznaczony = await p.evaluate(() => document.querySelector('.zm-pakiety input[value="wzrok"]').checked);
    const otwarte = await p.evaluate(() => document.querySelector('.zm-pakiety').open);
    ok(zaznaczony, '2. zaznaczony pakiet „Wzrok” zostaje zaznaczony po odświeżeniach listy');
    ok(otwarte, '2. rozwinięte „Pakiety zmysłów” zostają rozwinięte');

    /* ---- 3. Fokus zostaje na przełączniku ---- */
    await p.focus('input[data-skladnik="kinect"]');
    await p.waitForTimeout(9000);
    const fokus = await p.evaluate(() => document.activeElement && document.activeElement.dataset.skladnik);
    ok(fokus === 'kinect', `3. fokus klawiatury zostaje na przełączniku po odświeżeniu (${fokus || 'fokus zgubiony'})`);

    /* ---- 4. Dwuklik = jedno polecenie ---- */
    const przed = polecen;
    await p.evaluate(() => {
      const b = [...document.querySelectorAll('.zm-pakiety button')].find((x) => /Zainstaluj|Install/.test(x.textContent));
      b.click(); b.click();
    });
    await p.waitForTimeout(800);
    ok(polecen - przed === 1, `4. „Zainstaluj zaznaczone” kliknięte dwa razy wysyła jedno polecenie (${polecen - przed})`);

    /* ---- 5. Niepołączony komputer na 360 px ---- */
    online = false;
    await p.setViewportSize({ width: 360, height: 740 });
    await p.evaluate(() => document.body.focus());
    await p.waitForFunction(() => document.querySelector('.zm-komputer.offline'), null, { timeout: 10000 });
    const offline = await p.evaluate(() => {
      const zd = document.querySelector('.zm-offline-zdanie');
      const nachodzi = [...document.querySelectorAll('.zm-skladnik')].some((w) => {
        const st = w.querySelector('.zm-stan');
        if (!st) return false;
        const a = w.querySelector('.zm-etykieta').getBoundingClientRect();
        const s = st.getBoundingClientRect();
        return a.left < s.right && s.left < a.right && a.top < s.bottom && s.top < a.bottom;
      });
      // Jedno zdanie o niepołączonym komputerze na górze karty, nie pod każdym przełącznikiem (runda 8).
      const karta = document.querySelector('.zm-komputer.offline');
      const stany = [...karta.querySelectorAll('.zm-stan')].filter((x) => x.textContent.trim()).length;
      const banery = karta.querySelectorAll('.zm-offline-zdanie').length;
      return { zdanie: zd ? zd.textContent : '', nachodzi, stany, banery };
    });
    ok(/wyłączony|śpi|uśpiony|asleep|off/i.test(offline.zdanie), `5. niepołączony komputer: zdanie, co to znaczy („${offline.zdanie}”)`);
    ok(!offline.nachodzi, '5. na 360 px stan składnika nie nachodzi na jego etykietę');
    ok(offline.banery === 1 && offline.stany === 0, `5. niepołączony: jeden baner, bez stanu pod każdym przełącznikiem (banerów ${offline.banery}, stanów ${offline.stany})`);

    ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    await b.close();
    zabij(srv);
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nZMYSŁY W USTAWIENIACH OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Konta po stronie przeglądarki – trzy rzeczy, których nie widać w teście
   serwera, a które decydują o prywatności na wspólnym telefonie.

   1. LINK Z ZAPROSZENIEM. Token siedzi we fragmencie po `#`, więc nie trafia
      do logów serwera ani Cloudflare. Rozpoznajemy tylko dokładny kształt –
      przypadkowy `#zaproszenie` w adresie nie może otwierać ekranu dołączania.

   2. PAMIĘĆ PODRĘCZNA ROZMÓW. Przeglądarka trzyma kopie rozmów do pracy bez
      sieci. Marcin wylogowuje się na telefonie, loguje się ktoś z rodziny –
      przy pierwszym zaniku sieci zobaczyłby rozmowy Marcina. Kopia musi
      znikać przy zmianie osoby, a ustawienia urządzenia (język) zostawać.

   3. IMIĘ GOŚCIA W PANELU WŁAŚCICIELA. Imię wpisuje zaproszona osoba, a czyta
      je właściciel. Gdyby panel składał wiersze przez `innerHTML`, imię
      `<img src=x onerror=…>` wykonałoby kod w sesji właściciela. Sprawdzamy
      na atrapie DOM-u, że żaden węzeł panelu nie ma treści HTML, a imię
      stoi w nim jako zwykły tekst.

   4. W PRAWDZIWEJ PRZEGLĄDARCE (runda 9), na serwerze z kontami – bo czysta
      funkcja na atrapie magazynu przechodziła, a telefon przepuszczał błąd:
      a) nagranie ptaka odłożone bez zasięgu (IndexedDB) przy chwilowym błędzie
         serwera (503) zostaje, a błąd treści (400) je kończy;
      b) aplikacja otwarta już z siecią rozpoznaje odłożone nagranie sama, bez
         trybu głosowego (po pierwszym /api/status);
      c) nagranie cudzej osoby nie idzie na konto bieżącej;
      d) sesja wygasła, na tym samym telefonie loguje się ktoś inny: nagrania
         poprzedniej osoby znikają, jej lektor nie czyta odpowiedzi nowej (stan
         w pamięci strony, nie tylko w localStorage), kamera w trybie głosowym
         nie włącza się sama;
      e) „Wyloguj” kasuje nagrania;
      f) po angielsku błędy ptaków (429, 503, 501) są po angielsku, a 503 na
         żywo odkłada nagranie zamiast je gubić.
*/
const path = require('node:path');
const { zainstalujDom, Element } = require(path.join(__dirname, '..', 'atrapy', 'maly-dom.js'));
const { utworzKonta } = require(path.join(__dirname, '..', '..', 'public', 'konta.js'));

const fail = [];
const fetchNatywny = global.fetch;   // część 3 podmienia fetch na atrapę, część 4 potrzebuje prawdziwego
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

function magazyn(poczatek = {}) {
  const m = new Map(Object.entries(poczatek));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    klucze: () => [...m.keys()].sort(),
  };
}

(async () => {
  const dom = zainstalujDom();
  const elementy = new Map();
  const $ = (id) => { if (!elementy.has(id)) elementy.set(id, new Element('div')); return elementy.get(id); };
  const k = utworzKonta({ $, t });

  // --- 1. Link z zaproszeniem ---------------------------------------------
  const TOKEN = 'Ab3_dE-fGhIjKlMnOpQrStUv';
  ok(k.tokenZaproszenia(`#zaproszenie=${TOKEN}`) === TOKEN, 'poprawny link → token');
  ok(k.tokenZaproszenia('#zaproszenie=krotki') === '', 'za krótki token nie otwiera ekranu dołączania');
  ok(k.tokenZaproszenia(`#inne=${TOKEN}`) === '', 'inny fragment nie otwiera ekranu dołączania');
  ok(k.tokenZaproszenia(`#zaproszenie=${TOKEN}<script>`) === '', 'znaki spoza alfabetu tokenu – odrzucone');

  // --- 2. Pamięć podręczna rozmów ---------------------------------------------
  const m = magazyn({
    'cosmos.conv.abc': '{"title":"rozmowa Marcina"}', 'cosmos.convIndex': '[{"id":"abc"}]',
    'cosmos.kbSelected': '["x"]', 'cosmos.lang': 'pl', 'cosmos.micId': 'kinect',
    'cosmos.liveSource': 'kinect-color', 'cosmos.settings': '{"speak":true,"temperature":0.4}',
  });
  ok(k.pilnujWlascicielaPamieci({ id: 'wlasciciel' }, m) === false, 'pierwsze logowanie niczego nie czyści');
  ok(m.getItem('cosmos.conv.abc') !== null, 'kopia właściciela zostaje, dopóki loguje się właściciel');
  ok(k.pilnujWlascicielaPamieci({ id: 'wlasciciel' }, m) === false, 'ponowne logowanie tej samej osoby niczego nie czyści');
  ok(k.pilnujWlascicielaPamieci({ id: 'u-ania' }, m) === true, 'logowanie innej osoby wykryte');
  ok(m.getItem('cosmos.conv.abc') === null && m.getItem('cosmos.convIndex') === null,
    'po zmianie osoby kopia rozmów poprzedniej zniknęła');
  ok(m.getItem('cosmos.kbSelected') === null, 'zaznaczenia w bazie wiedzy poprzedniej osoby też zniknęły');
  /* Wspólny telefon (runda 8): „Kinect” właściciela i czytanie na głos nie
     przechodzą na gościa – u niego kamera odpytywałaby 403 bez końca,
     a odpowiedzi czytałyby się na głos w pociągu. */
  ok(m.getItem('cosmos.liveSource') === null, 'źródło kamery poprzedniej osoby zniknęło');
  const ustPo = JSON.parse(m.getItem('cosmos.settings') || '{}');
  ok(ustPo.speak !== true && ustPo.temperature === 0.4, 'czytanie na głos wyłączone dla nowej osoby, reszta ustawień urządzenia została');
  ok(m.getItem('cosmos.lang') === 'pl' && m.getItem('cosmos.micId') === 'kinect',
    'ustawienia urządzenia (język, mikrofon) zostały');
  ok(m.getItem('cosmos.kto') === 'u-ania', 'przeglądarka pamięta, czyja jest teraz kopia');

  // --- 3. Imię gościa w panelu właściciela --------------------------------------
  const ZLE_IMIE = '<img src=x onerror="fetch(\'/api/konta/uzytkownik?id=wlasciciel\',{method:\'DELETE\'})">';
  global.location = { origin: 'https://cosmosai.live', pathname: '/', hash: '' };
  global.navigator = {};
  global.fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url).startsWith('/api/konta') ? {
      logowanie: true,
      silnikiSerwera: { local: false, openai: true, claude: false, studio: false },
      uzytkownicy: [
        { id: 'wlasciciel', login: 'marcin', nazwa: 'Marcin', rola: 'wlasciciel', zuzycie: {} },
        { id: 'u-1', login: 'gosc', nazwa: ZLE_IMIE, rola: 'czlonek', silniki: { openai: false }, zuzycie: { wiadomosci: 3 } },
      ],
      zaproszenia: [{ id: 'z1', nazwa: ZLE_IMIE, wygasa: Date.now() + 1e6 }],
    } : {}),
  });
  k.zastosujRole({ id: 'wlasciciel', rola: 'wlasciciel' });
  await k.odswiezDostep();
  const lista = $('dostep-lista');
  const zapr = $('dostep-zaproszenia');
  const htmlGdziekolwiek = (el) => Boolean(el._html) || el.children.some(htmlGdziekolwiek);
  ok(lista.children.length === 2, `panel pokazuje obie osoby (${lista.children.length})`);
  ok(!htmlGdziekolwiek(lista) && !htmlGdziekolwiek(zapr), 'żaden węzeł panelu Dostęp nie ma treści HTML – wszystko przez textContent');
  ok(lista.textContent.includes(ZLE_IMIE), 'imię gościa stoi w panelu jako zwykły tekst, znak po znaku');
  ok(zapr.textContent.includes(ZLE_IMIE), 'imię z zaproszenia też jako tekst');
  const przelaczniki = lista.children[1].poKlasie('osoba-silnik');
  // Lokalny GPU, OpenAI, Claude, Studio, płatne wyszukiwarki (runda 7), ptaki na serwerze (runda 8) i zespół agentów.
  ok(przelaczniki.length === 7, `członek ma siedem przełączników: silniki, Studio, wyszukiwarki, ptaki, zespół (${przelaczniki.length})`);

  // Członek nie widzi panelu Dostęp
  k.zastosujRole({ id: 'u-1', rola: 'czlonek' });
  await k.odswiezDostep();
  ok($('dostep-blok').hidden === true, 'członkowi panel Dostęp się nie pokazuje');
  ok(dom.dokument.body.classList.contains('rola-czlonek'), 'rola członka oznaczona na <body> (ukrywa elementy właściciela)');

  dom.odinstaluj();
  delete global.location; delete global.navigator; global.fetch = fetchNatywny;

  await wPrzegladarce();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKONTA W PRZEGLĄDARCE OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// --- 4. Prawdziwa przeglądarka, prawdziwe konta ---------------------------------
async function wPrzegladarce() {
  const { maPrzegladarke, przegladarka, serwerCosmosa, czekajNa, zabij } = require(path.join(__dirname, '..', 'pomoc'));
  if (!maPrzegladarke()) { console.log('POMINIĘTE (część przeglądarkowa): brak Chromium'); return; }
  const PORT = 3511;
  const S = `http://127.0.0.1:${PORT}`;
  const HASLO = 'haslo-wlasciciela-123';
  const srv = serwerCosmosa(PORT, { COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin', COSMOS_NAZWA: 'Marcin',
    EMBED_PROVIDER: 'off', SENSES_URL: 'http://127.0.0.1:9', NEMOTRON_BASE_URL: 'http://127.0.0.1:9/v1' });
  let b;
  try {
    if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer testowy nie wstał');
    const ciastko = (r) => r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const log = await fetch(`${S}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: S },
      body: JSON.stringify({ login: 'marcin', password: HASLO }) });
    const W = ciastko(log);
    const z = await (await fetch(`${S}/api/konta/zaproszenia`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: S, Cookie: W }, body: JSON.stringify({ nazwa: 'Bartek' }) })).json();
    const zap = await fetch(`${S}/api/zaproszenie`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: S },
      body: JSON.stringify({ token: z.token, login: 'bartek', nazwa: 'Bartek', haslo: 'haslo-bartka-123' }) });
    ok(zap.ok, `konto Bartka założone z zaproszenia (${zap.status})`);

    b = await przegladarka();
    const ctx = await b.newContext({ viewport: { width: 358, height: 607 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addCookies(W.split('; ').map((kv) => ({ name: kv.split('=')[0], value: kv.slice(kv.indexOf('=') + 1), url: S })));
    const p = await ctx.newPage();
    const bledy = [];
    p.on('pageerror', (e) => bledy.push(e.message));

    // Atrapa /api/ptak w przeglądarce: licznik żądań i odpowiedź zależna od trybu.
    const ptak = { n: 0, tryb: 200 };
    await p.route('**/api/ptak', (r) => {
      ptak.n++;
      const [status, cialo] = {
        200: [200, { gatunki: [] }],
        400: [400, { error: 'Zły plik.', kod: 'zly-plik' }],
        429: [429, { error: 'Poprzednie nagranie jeszcze się liczy – chwilę.', kod: 'zajete' }],
        501: [501, { error: 'BirdNET niedostępny', kod: 'zmysly-blad' }],
        503: [503, { error: 'Dużo osób rozpoznaje teraz ptaki – spróbuj za kilka sekund.', kod: 'kolejka-pelna' }],
      }[ptak.tryb];
      return r.fulfill({ status, contentType: 'application/json', headers: { 'Retry-After': '300' }, body: JSON.stringify(cialo) });
    });
    const gotowa = (kto) => p.waitForFunction((k) => typeof kimJestem === 'function' && kimJestem() === k
      && document.querySelector('.app.gotowa'), kto, { timeout: 15000 });
    const ileOdlozonych = () => p.evaluate(async () => (await ptakiOdlozone.wszystkie()).length);
    const dodaj = (kto) => p.evaluate(async (k) => {
      await ptakiOdlozone.dodaj(new Blob([new Uint8Array(4000).fill(7)], { type: 'audio/wav' }), k || undefined);
    }, kto || null);
    const kolejka = () => p.evaluate(async () => { clearTimeout(ptakiPonowTimer); await rozpoznajOdlozonePtaki(); });

    await p.goto(`${S}/app`, { waitUntil: 'load' });
    await gotowa('wlasciciel');
    await p.waitForTimeout(600);   // pierwszy /api/status

    // a) 503 – nagranie zostaje; 400 – znika
    ptak.tryb = 503; ptak.n = 0;
    await dodaj();
    await kolejka();
    ok(ptak.n === 1 && await ileOdlozonych() === 1, `4a. chwilowy błąd (503) – nagranie dalej czeka w przeglądarce (żądań ${ptak.n})`);

    // b) aplikacja otwarta z siecią – nagranie rusza samo, bez trybu głosowego
    ptak.tryb = 200; ptak.n = 0;
    await p.goto(`${S}/app`, { waitUntil: 'load' });
    await gotowa('wlasciciel');
    // (waitForFunction z funkcją async nie czeka – obietnica jest „prawdziwa” od razu)
    for (let i = 0; i < 40 && (ptak.n < 1 || await ileOdlozonych() > 0); i++) await p.waitForTimeout(200);
    ok(ptak.n === 1 && await ileOdlozonych() === 0, `4b. start z siecią: odłożone nagranie rozpoznane bez trybu głosowego (żądań ${ptak.n})`);

    ptak.tryb = 400; ptak.n = 0;
    await dodaj();
    await kolejka();
    ok(ptak.n === 1 && await ileOdlozonych() === 0, '4a. błąd treści (400) kończy nagranie – bez ponawiania w nieskończoność');

    // c) cudze nagranie nie wychodzi
    ptak.tryb = 200; ptak.n = 0;
    await dodaj('u-obcy');
    await kolejka();
    ok(ptak.n === 0 && await ileOdlozonych() === 1, `4c. nagranie innej osoby nie idzie na konto bieżącej (żądań ${ptak.n})`);

    // d) sesja wygasła, loguje się Bartek formularzem
    await dodaj();
    await p.evaluate(() => {
      settings.speak = true; saveSettings(); pokazGlosnik();
      localStorage.setItem('cosmos.voiceCam', '1');
    });
    ptak.n = 0;
    await ctx.clearCookies();
    await p.goto(`${S}/app`, { waitUntil: 'load' });
    await p.waitForSelector('#login-form', { state: 'visible', timeout: 10000 });
    await p.fill('#login-login', 'bartek');
    await p.fill('#login-password', 'haslo-bartka-123');
    const idB = (await (await fetch(`${S}/api/auth`, { headers: { Cookie: ciastko(zap) } })).json()).uzytkownik.id;
    await p.click('#login-submit');
    await gotowa(idB);
    await p.waitForTimeout(1200);
    const d = await p.evaluate(() => ({
      speak: settings.speak === true, glosnik: document.getElementById('tts-toggle').getAttribute('aria-pressed'),
      voiceCam: localStorage.getItem('cosmos.voiceCam'),
    }));
    ok(await ileOdlozonych() === 0 && ptak.n === 0, `4d. po zmianie osoby nagrania poprzedniej zniknęły i nic nie poszło na konto nowej (żądań ${ptak.n})`);
    ok(!d.speak && d.glosnik !== 'true', `4d. lektor poprzedniej osoby wyłączony w pamięci strony (speak ${d.speak}, aria-pressed ${d.glosnik})`);
    ok(d.voiceCam === null, `4d. kamera w trybie głosowym poprzedniej osoby nie przechodzi na nową (${d.voiceCam})`);

    // f) po angielsku: 503 na żywo odkłada nagranie, zdania po angielsku
    await p.evaluate(() => {
      setLang('en');
      window.NasluchWlasny = { dostepny: () => true, nagrajWav: async () => new Blob([new Uint8Array(4000)], { type: 'audio/wav' }) };
    });
    const naZywo = async (tryb) => {
      ptak.tryb = tryb;
      return p.evaluate(async () => { stanPtakow = { dostepne: true, znany: true }; await rozpoznajPtaka(); clearTimeout(ptakiPonowTimer); return document.getElementById('voice-answer').textContent; });
    };
    const po503 = await naZywo(503);
    ok(await ileOdlozonych() === 1, '4f. 503 na żywo – nagranie odłożone, nie zgubione');
    const polskie = /[ąćęłńóśźż]/i;
    const po429 = await naZywo(429);
    const po501 = await naZywo(501);
    ok([po503, po429, po501].every((x) => x && !polskie.test(x)), `4f. błędy ptaków po angielsku („${po503}” | „${po429}” | „${po501}”)`);

    // e) „Wyloguj” kasuje nagrania
    await p.evaluate(async () => { await konta_.odswiez().catch(() => {}); });
    await Promise.all([p.waitForNavigation({ waitUntil: 'load' }), p.evaluate(() => document.getElementById('konto-wyloguj').click())]);
    await p.waitForSelector('#login-form', { state: 'visible', timeout: 10000 });
    ok(await ileOdlozonych() === 0, '4e. „Wyloguj” kasuje nagrania ptaków odłożone w przeglądarce');

    ok(!bledy.length, `4. błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  } finally {
    if (b) await b.close();
    zabij(srv);
  }
}

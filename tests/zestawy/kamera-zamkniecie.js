/* Kamera zamknięta NAPRAWDĘ – także wtedy, gdy człowiek zamyka ją, zanim się
 * otworzyła.
 *
 *  Runda 9 (agencja i zespół IT, każdy osobno): startLive czeka na
 *  getUserMedia (na telefonie – okno zgody), play() i listę kamer. Esc, „×”
 *  albo „wstecz” w tym czasie chowały panel, ale kamera zostawała WŁĄCZONA:
 *  strumień przychodził po zamknięciu, pętle rozpoznawania ruszały i klatki
 *  szły do zmysłów, a zdarzenia „widzę…” do rozmowy – przy zamkniętym panelu.
 *  Dioda świeciła do przeładowania strony.
 *
 *  Gwarancje (prawdziwa aplikacja, atrapa kamery z opóźnieniem jak okno zgody):
 *    1. zamknięcie w trakcie getUserMedia (Esc, „×”, wstecz, „×” okienka) →
 *       po 2 s 0 żywych ścieżek, przez 5 s 0 żądań /api/detect|dlonie|pose|events,
 *    2. zamknij i od razu otwórz ponownie → dokładnie 1 żywa ścieżka,
 *    3. karta w tle → pętle stoją; powrót → ruszają,
 *    4. pętla dłoni przy zapisanym geście: pusty kadr – rzadko (≤ 8 w 6 s),
 *       dłoń w kadrze – często (≥ 12 w 6 s),
 *    5. otwarcie na pełny ekran nie mierzy pola wiadomości w obsłudze kliknięcia,
 *    6. okienko kamery nie zabiera Esc innemu oknu ani polu wiadomości,
 *    7. `pod-nakladka` na <html>, gdy powitanie jest zasłonięte (animacje stoją),
 *    8. „Rozpoznawanie” ma stan w nazwie dostępnej, a #live-status nie powtarza
 *       tego samego zdania czytnikowi co sekundę.
 */
const { przegladarka, maPrzegladarke, serwerCosmosa, czekajNa, zabij } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

const PORT = 3512;
const S = `http://127.0.0.1:${PORT}`;
const problemy = [];
const ok = (warunek, opis) => { console.log(`${warunek ? 'OK ' : 'ZLE'} ${opis}`); if (!warunek) problemy.push(opis); };

/* Atrapa kamery: strumień z płótna, wydany po `window.__opoznienie` ms (okno
   zgody na telefonie). Każdy strumień trafia do rejestru – po zamknięciu
   liczymy, ile ścieżek dalej żyje. */
function atrapaKamery() {
  window.__strumienie = [];
  window.__opoznienie = 0;
  const daj = async () => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 480;
    const g = c.getContext('2d');
    const rysuj = () => { g.fillStyle = '#3a6'; g.fillRect(0, 0, 640, 480); g.fillStyle = '#fff'; g.fillRect(200, 150, 100, 100); };
    rysuj();
    setInterval(rysuj, 200);
    const s = c.captureStream(10);
    window.__strumienie.push(s);
    if (window.__opoznienie) await new Promise((r) => setTimeout(r, window.__opoznienie));
    return s;
  };
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
  navigator.mediaDevices.getUserMedia = daj;
  navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'a', label: 'atrapa' }];
}

const DLON = { palce: [1, 1, 0, 0, 0], punkty: Array.from({ length: 21 }, (_, i) => [0.4 + i * 0.01, 0.5]), strona: 'prawa' };

(async () => {
  const srv = serwerCosmosa(PORT, { SENSES_URL: 'http://127.0.0.1:9', EMBED_PROVIDER: 'off' });
  let b;
  try {
    if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer testowy nie wstał');
    b = await przegladarka();
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    await ctx.addInitScript(atrapaKamery);
    const p = await ctx.newPage();
    const bledy = [];
    // pwa.js przy zablokowanym service workerze (serviceWorkers: 'block') i sztucznym visibilitychange woła reg.update() na niczym – to nie kamera.
    p.on('pageerror', (e) => { if (!/reading 'update'/.test(e.message)) bledy.push(e.message); });

    // Zmysły „działają” (z YOLO, dłońmi i pozą) – inaczej pętle rozpoznawania w ogóle nie ruszą.
    const licznik = { detect: 0, dlonie: 0, pose: 0, events: 0 };
    const zeruj = () => { for (const k of Object.keys(licznik)) licznik[k] = 0; };
    const razem = () => licznik.detect + licznik.dlonie + licznik.pose + licznik.events;
    let zDlonia = false;
    let gesty = [];
    await p.route('**/api/status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      cloud: { online: true }, local: { online: false }, senses: { online: true, caps: { yolo: true, dlonie: true, pose: true } }, ptaki: { ok: false },
    }) }));
    await p.route('**/api/detect', (r) => { licznik.detect++; r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ objects: [{ label: 'person', confidence: 0.9, box: [10, 10, 200, 300] }] }) }); });
    await p.route('**/api/dlonie', (r) => { licznik.dlonie++; r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(zDlonia ? { dlonie: [DLON], summary: 'prawa dłoń: 2 palce' } : { dlonie: [] }) }); });
    await p.route('**/api/pose', (r) => { licznik.pose++; r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    await p.route('**/api/events', (r) => { if (r.request().method() === 'POST') licznik.events++; r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
    await p.route('**/api/lessons/match', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await p.route('**/api/gesty', (r) => (r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ gesty }) }) : r.continue()));

    await p.goto(`${S}/app`, { waitUntil: 'load' });
    await p.waitForSelector('.app.gotowa', { timeout: 10000 });
    await p.waitForFunction(() => senses && senses.online === true, null, { timeout: 8000 });

    const zywe = () => p.evaluate(() => window.__strumienie.flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);
    const panelOtwarty = () => p.evaluate(() => document.getElementById('live-panel').style.display !== 'none');
    const tryb = (t) => p.evaluate((x) => localStorage.setItem('cosmos.kameraTryb', x), t);
    const kliknij = (sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
    const czekajNaObraz = () => p.waitForFunction(() => document.getElementById('live-video').videoWidth > 0, null, { timeout: 8000 });

    // --- 1. Zamknięcie w trakcie otwierania ----------------------------------
    const SPOSOBY = {
      Esc: async () => p.keyboard.press('Escape'),
      '„×”': async () => kliknij('#live-close'),
      wstecz: async () => p.evaluate(() => history.back()),
      '„×” okienka': async () => kliknij('#live-zamknij-mini'),
    };
    for (const [nazwa, zamknij] of Object.entries(SPOSOBY)) {
      await tryb(nazwa === '„×” okienka' ? 'mini' : 'pelny');
      await p.evaluate(() => { window.__opoznienie = 800; });
      await kliknij('#live-btn');
      await p.waitForTimeout(100);
      await zamknij();
      await p.waitForTimeout(2000);
      const po = { zywe: await zywe(), otwarty: await panelOtwarty() };
      zeruj();
      await p.waitForTimeout(5000);
      ok(po.zywe === 0 && !po.otwarty && razem() === 0,
        `1. ${nazwa} w trakcie getUserMedia: żywych ścieżek ${po.zywe}, panel ${po.otwarty ? 'otwarty' : 'zamknięty'}, żądań rozpoznawania przez 5 s ${razem()} (${JSON.stringify(licznik)})`);
    }

    // --- 2. Zamknij i od razu otwórz ------------------------------------------
    await tryb('pelny');
    await p.evaluate(() => { window.__opoznienie = 800; });
    await kliknij('#live-btn');
    await p.waitForTimeout(100);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(100);
    await kliknij('#live-btn');
    await p.waitForTimeout(2000);
    ok(await zywe() === 1 && await panelOtwarty(), `2. zamknij i otwórz w trakcie otwierania – dokładnie 1 żywa ścieżka (${await zywe()})`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    ok(await zywe() === 0, '2. po zamknięciu 0 żywych ścieżek');

    // --- 3. Karta w tle ---------------------------------------------------------
    await p.evaluate(() => { window.__opoznienie = 0; });
    await kliknij('#live-btn');
    await czekajNaObraz();
    await p.waitForTimeout(2500);
    const ukryj = (tak) => p.evaluate((h) => {
      Object.defineProperty(document, 'hidden', { get: () => h, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: () => (h ? 'hidden' : 'visible'), configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, tak);
    await ukryj(true);
    await p.waitForTimeout(500);
    zeruj();
    await p.waitForTimeout(4500);
    const wTle = razem();
    await ukryj(false);
    zeruj();
    await p.waitForTimeout(4500);
    ok(wTle === 0 && razem() > 0, `3. karta w tle: żądań ${wTle}; po powrocie ${razem()}`);

    // --- 8. #live-status nie powtarza tego samego ---------------------------------
    const zmianyStatusu = await p.evaluate(async () => {
      let n = 0;
      const o = new MutationObserver((z) => { n += z.length; });
      o.observe(document.getElementById('live-status'), { childList: true, characterData: true, subtree: true });
      await new Promise((r) => setTimeout(r, 7000));
      o.disconnect();
      return n;
    });
    ok(zmianyStatusu <= 3, `8. #live-status (role=status) bez powtórzeń tego samego zdania: ${zmianyStatusu} zmian w 7 s`);
    const aria = await p.evaluate(() => ({
      nazwa: document.getElementById('live-rozpoznawanie').getAttribute('aria-label') || '',
      stan: document.getElementById('live-rozp-stan').textContent,
    }));
    ok(aria.stan && aria.nazwa.includes(aria.stan), `8. „Rozpoznawanie” ma stan w nazwie dostępnej („${aria.nazwa}”)`);
    await kliknij('#live-close');
    await p.waitForTimeout(300);

    // --- 4. Tempo pętli dłoni przy zapisanym geście ---------------------------------
    gesty = [{ id: 'g1', nazwa: 'dwa palce', czynnosc: 'wyslij', parametr: 'hej', palce: [1, 1, 0, 0, 0], ruch: 'brak' }];
    zDlonia = false;
    await kliknij('#live-btn');
    await czekajNaObraz();
    await p.waitForTimeout(1500);
    zeruj();
    await p.waitForTimeout(6000);
    const pusty = licznik.dlonie;
    zDlonia = true;
    await p.waitForTimeout(1500);
    zeruj();
    await p.waitForTimeout(6000);
    const zRęką = licznik.dlonie;
    ok(pusty <= 8 && zRęką >= 12, `4. pętla dłoni: pusty kadr ${pusty} żądań w 6 s (≤ 8), dłoń w kadrze ${zRęką} (≥ 12)`);
    await kliknij('#live-close');
    zDlonia = false;
    gesty = [];
    await p.waitForTimeout(300);

    // --- 5. Pełny ekran bez pomiaru pola w obsłudze kliknięcia -------------------------
    await tryb('pelny');
    const pomiary = await p.evaluate(() => {
      let n = 0;
      const org = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (...a) { if (this.id === 'composer') n++; return org.apply(this, a); };
      try { document.getElementById('live-btn').click(); } finally { Element.prototype.getBoundingClientRect = org; }
      return n;
    });
    ok(pomiary === 0, `5. otwarcie pełnego ekranu nie mierzy pola wiadomości w obsłudze kliknięcia (${pomiary})`);
    await czekajNaObraz();

    // --- 7. pod-nakladka ------------------------------------------------------------------
    await p.waitForTimeout(200);
    const podPelnym = await p.evaluate(() => document.documentElement.classList.contains('pod-nakladka'));
    await kliknij('#live-do-okienka');
    await p.waitForTimeout(200);
    const podOkienkiem = await p.evaluate(() => document.documentElement.classList.contains('pod-nakladka'));
    ok(podPelnym && !podOkienkiem, `7. pod-nakladka: pełny ekran ${podPelnym}, okienko ${podOkienkiem}`);

    // --- 6. Esc przy okienku --------------------------------------------------------------
    const OKNA = [['Ustawienia', 'settings-modal', () => openSettings()], ['Baza wiedzy', 'kb-modal', () => { el.kbModal.style.display = ''; }]];
    for (const [nazwa, id, otworz] of OKNA) {
      await p.evaluate(`(${otworz.toString()})()`);
      await p.waitForTimeout(300);
      const pod = await p.evaluate(() => document.documentElement.classList.contains('pod-nakladka'));
      await p.keyboard.press('Escape');
      await p.waitForTimeout(300);
      const s6 = await p.evaluate((x) => ({ okno: document.getElementById(x).style.display !== 'none', kamera: document.getElementById('live-panel').style.display !== 'none' }), id);
      ok(!s6.okno && s6.kamera && await zywe() === 1, `6. okienko kamery + ${nazwa}: Esc zamyka okno, kamera zostaje (okno ${s6.okno}, kamera ${s6.kamera})`);
      ok(pod, `7. pod-nakladka przy otwartym oknie ${nazwa}`);
    }
    await p.focus('#input');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(200);
    ok(await panelOtwarty(), '6. Esc w polu wiadomości nie zamyka okienka kamery');
    await p.focus('#live-zamknij-mini');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    ok(!(await panelOtwarty()) && await zywe() === 0, '6. Esc z fokusem w okienku zamyka kamerę i zwalnia ścieżkę');

    ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  } finally {
    if (b) await b.close();
    zabij(srv);
  }
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nKAMERA ZAMKNIĘCIE OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

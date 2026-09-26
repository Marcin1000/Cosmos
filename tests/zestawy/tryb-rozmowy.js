/* Tryb głosowy bez piszczenia mikrofonu – sprawdzone w przeglądarce.
 *
 * Marcin: „musimy wykluczyć ten dźwięk włączania i wyłączania mikrofonu".
 * Piszczy Android przy każdym starcie i końcu Web Speech API. Gwarancja tego
 * zestawu: tam, gdzie serwer umie rozpoznać mowę (tu: tylko chmura, zmysły
 * wyłączone), tryb głosowy NIE tworzy ani jednego obiektu SpeechRecognition.
 *
 *   1. otwarcie trybu głosowego → od razu „słucham", bez słowa budzącego
 *      (w chmurze nie słuchamy otoczenia),
 *   2. zero SpeechRecognition przez cały czas,
 *   3. po ciszy kula czeka na dotknięcie („push"), mikrofon zamknięty,
 *   4. dotknięcie kuli → znowu „słucham", dalej zero SpeechRecognition,
 *   5. telefon z Androidem BEZ rozpoznawania na serwerze → od razu kula pod
 *      palcem, bez kilkunastu piśnięć, zanim Cosmos sam to odkryje,
 *   6. otwarcie trybu, ZANIM przyjdzie /api/config – dalej zero
 *      SpeechRecognition (dawniej: 4, a po konfiguracji dwa nasłuchy naraz),
 *   7. szybkie klikanie kuli i zamknięcie trybu → mikrofon naprawdę
 *      zamknięty (dawniej zostawała żywa ścieżka audio).
 */
const http = require('node:http');
const { przegladarka, serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT_Z = 3485;       // z rozpoznawaniem w chmurze
const PORT_BEZ = 3486;     // bez żadnego rozpoznawania na serwerze
const problemy = [];
const ok = (warunek, opis) => {
  console.log(`${warunek ? 'OK ' : 'ZLE'} ${opis}`);
  if (!warunek) problemy.push(opis);
};

/* Atrapa OpenAI: lista modeli i rozpoznawanie, które zawsze oddaje pusty tekst –
   atrapa mikrofonu Chromium pika, a my nie chcemy, żeby piknięcie stało się
   pytaniem i zabrało tryb w „myślę". */
const atrapa = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.endsWith('/models')) return res.end('{"data":[{"id":"atrapa"}]}');
    if (req.url.endsWith('/audio/transcriptions')) return res.end('{"text":""}');
    res.end('{}');
  });
});

const LICZ_SR = () => {
  window.__srNowe = 0;
  // Żywe ścieżki mikrofonu – „zamknięty" ma znaczyć zamknięty, nie ukryty.
  window.__sciezki = [];
  const gum = navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  if (gum) {
    navigator.mediaDevices.getUserMedia = async (o) => {
      // Prawdziwy telefon oddaje mikrofon po chwili (pytanie o zgodę, sprzęt).
      if (window.__gumDelay) await new Promise((r) => setTimeout(r, window.__gumDelay));
      const s = await gum(o);
      window.__sciezki.push(...s.getAudioTracks());
      return s;
    };
  }
  window.__zywe = () => window.__sciezki.filter((t) => t.readyState === 'live').length;
  const Oryginal = window.webkitSpeechRecognition || window.SpeechRecognition;
  function Liczony() {
    window.__srNowe++;
    return Oryginal ? new Oryginal() : { start() {}, stop() {}, abort() {} };
  }
  window.SpeechRecognition = Liczony;
  window.webkitSpeechRecognition = Liczony;
};

(async () => {
  await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${atrapa.address().port}/v1`;
  const wspolne = { NEMOTRON_BASE_URL: A, SENSES_URL: 'http://127.0.0.1:1' };
  const zChmura = serwerCosmosa(PORT_Z, { ...wspolne, OPENAI_API_KEY: 'test', OPENAI_BASE_URL: A });
  const bez = serwerCosmosa(PORT_BEZ, wspolne);
  if (!(await czekajNa(`http://127.0.0.1:${PORT_Z}/api/auth`)) || !(await czekajNa(`http://127.0.0.1:${PORT_BEZ}/api/auth`))) {
    throw new Error('serwery testowe nie wstały');
  }

  const b = await przegladarka({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const stan = (p) => p.evaluate(() => ({ klasa: document.getElementById('voice-orb').className, sr: window.__srNowe }));

  // --- 1–4: rozpoznawanie tylko w chmurze
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    const p = await ctx.newPage();
    await p.addInitScript(LICZ_SR);
    await p.goto(`http://127.0.0.1:${PORT_Z}/app`, { waitUntil: 'load' });
    // `serverConfig` to `let` w skrypcie, nie własność `window` – pytamy wprost.
    await p.waitForFunction(() => Boolean(typeof serverConfig !== 'undefined' && serverConfig.glos), null, { timeout: 8000 }).catch(() => {});
    ok(await p.evaluate(() => Boolean(serverConfig.glos && serverConfig.glos.sttChmura)), '/api/config zgłasza rozpoznawanie w chmurze');
    await p.click('#voice-btn');
    await p.waitForTimeout(800);
    let s = await stan(p);
    ok(/listening/.test(s.klasa), `otwarcie → od razu „słucham" (${s.klasa})`);
    ok(s.sr === 0, `zero SpeechRecognition po otwarciu (${s.sr})`);
    await p.waitForFunction(() => /push/.test(document.getElementById('voice-orb').className), null, { timeout: 15000 }).catch(() => {});
    s = await stan(p);
    ok(/push/.test(s.klasa), `po ciszy kula czeka na dotknięcie (${s.klasa})`);
    await p.click('#voice-orb');
    await p.waitForTimeout(600);
    s = await stan(p);
    ok(/listening/.test(s.klasa), `dotknięcie kuli → „słucham" (${s.klasa})`);
    ok(s.sr === 0, `dalej zero SpeechRecognition (${s.sr})`);
    // 7. zamknięcie trybu, zanim mikrofon zdążył się otworzyć
    await p.click('#voice-close');
    await p.waitForTimeout(500);
    await p.evaluate(() => { window.__gumDelay = 1200; });
    await p.click('#voice-btn');
    await p.waitForTimeout(150);
    await p.click('#voice-close');
    await p.waitForTimeout(2500);
    const zywe = await p.evaluate(() => window.__zywe());
    ok(zywe === 0, `zamknięcie w trakcie otwierania mikrofonu → mikrofon zamknięty (żywych ścieżek: ${zywe})`);
    await ctx.close();
  }

  // --- 6: tryb otwarty, zanim przyszła konfiguracja
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    const p = await ctx.newPage();
    await p.addInitScript(LICZ_SR);
    await p.route('**/api/config', async (r) => { await new Promise((w) => setTimeout(w, 2500)); r.continue(); });
    await p.route('**/api/status', async (r) => { await new Promise((w) => setTimeout(w, 2500)); r.continue(); });
    await p.goto(`http://127.0.0.1:${PORT_Z}/app`, { waitUntil: 'load' });
    await p.click('#voice-btn');
    await p.waitForTimeout(4500);
    const s = await stan(p);
    ok(s.sr === 0, `otwarcie przed /api/config: zero SpeechRecognition (${s.sr})`);
    ok(/listening|push/.test(s.klasa), `otwarcie przed /api/config: tryb rozmowy po nadejściu konfiguracji (${s.klasa})`);
    await ctx.close();
  }

  // --- 5: Android bez rozpoznawania na serwerze
  {
    const ctx = await b.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['microphone'],
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
    });
    const p = await ctx.newPage();
    await p.addInitScript(LICZ_SR);
    await p.goto(`http://127.0.0.1:${PORT_BEZ}/app`, { waitUntil: 'load' });
    await p.waitForTimeout(1500);
    await p.click('#voice-btn');
    await p.waitForTimeout(800);
    const s = await stan(p);
    ok(/push/.test(s.klasa), `Android bez rozpoznawania na serwerze → od razu kula pod palcem (${s.klasa})`);
    ok(s.sr === 0, `Android: żadnej sesji rozpoznawania, zanim ktoś dotknie kuli (${s.sr})`);
    await ctx.close();
  }

  await b.close();
  zabij(zChmura); zabij(bez); atrapa.close();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nTRYB ROZMOWY OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

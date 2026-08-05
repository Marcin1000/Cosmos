// „Hej, Kosmos" wykryte na domowym komputerze musi dotrzeć do telefonu.
// Dotąd przeglądarka tylko WYSYŁAŁA zdarzenia i nigdy się nie dowiadywała,
// że coś się stało — wake_listener.py umierał w logu serwera.
const { srodowisko, przegladarka } = require('../pomoc');

const wyslijZdarzenie = (adres, type, summary) => fetch(`${adres}/api/events`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type, summary }),
});

(async () => {
  const env = await srodowisko('pelne');
  const fail = [];

  // 1. sam strumień, bez przeglądarki
  const r = await fetch(`${env.adres}/api/events/stream`, { signal: AbortSignal.timeout(8000) });
  console.log(`1. strumień: HTTP ${r.status}, typ „${r.headers.get('content-type')}"`);
  if (r.status !== 200) fail.push('strumień nie odpowiada');
  if (!/text\/event-stream/.test(r.headers.get('content-type') || '')) fail.push('zły typ treści');

  const czytnik = r.body.getReader();
  const pierwsza = new TextDecoder().decode((await czytnik.read()).value);
  console.log(`   pierwsza ramka: ${pierwsza.split('\n')[0]}`);
  if (!/event: historia/.test(pierwsza)) fail.push('brak historii przy podłączeniu');

  await wyslijZdarzenie(env.adres, 'czujnik', 'drzwi otwarte');
  const druga = new TextDecoder().decode((await czytnik.read()).value);
  console.log(`   po wysłaniu: ${druga.trim().split('\n').join(' | ').slice(0, 90)}`);
  if (!/drzwi otwarte/.test(druga)) fail.push('zdarzenie nie dotarło strumieniem');
  czytnik.cancel().catch(() => {});

  // ---- przeglądarka ----
  const b = await przegladarka();
  const pg = await b.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(env.adres);
  await pg.waitForTimeout(1500);

  // 2. zwykłe zdarzenie miga i znika
  await wyslijZdarzenie(env.adres, 'kamera', 'widzę kubek na biurku');
  await pg.waitForFunction(() => !document.getElementById('event-flash').hidden,
    null, { timeout: 8000 }).catch(() => {});
  const napis = await pg.textContent('#event-flash');
  console.log(`2. mignięcie w oknie: „${napis.trim()}"`);
  if (!/kubek/.test(napis)) fail.push('zdarzenie nie pokazało się w oknie');

  // 3. „Hej, Kosmos" z komputera otwiera tryb głosowy w telefonie
  const ctx = await b.newContext({ permissions: ['microphone'] });
  const pg2 = await ctx.newPage();
  await pg2.addInitScript(() => {
    // Chromium bez prawdziwego mikrofonu — podstawiamy rozpoznawanie mowy,
    // żeby mierzyć nasze zachowanie, a nie brak sprzętu w obrazie.
    window.SpeechRecognition = class { start() {} stop() {} abort() {} addEventListener() {} };
    window.webkitSpeechRecognition = window.SpeechRecognition;
    navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
  });
  await pg2.goto(env.adres);
  await pg2.waitForTimeout(1500);
  await wyslijZdarzenie(env.adres, 'wake', 'wykryto słowo aktywujące');
  await pg2.waitForFunction(() => document.getElementById('voice-overlay')
    && document.getElementById('voice-overlay').style.display !== 'none', null, { timeout: 8000 }).catch(() => {});
  const trybGlosowy = await pg2.evaluate(() => {
    const m = document.getElementById('voice-overlay');
    return Boolean(m && m.style.display !== 'none');
  });
  console.log(`3. „Hej, Kosmos" z komputera → tryb głosowy w oknie: ${trybGlosowy}`);
  if (!trybGlosowy) fail.push('słowo aktywujące nie otworzyło trybu głosowego');

  // 4. wyłączony przełącznik = mikrofon się nie włącza
  const ctx3 = await b.newContext();
  const pg3 = await ctx3.newPage();
  await pg3.addInitScript(() => localStorage.setItem('cosmos.wakeZdalny', '0'));
  await pg3.goto(env.adres);
  await pg3.waitForTimeout(1500);
  await wyslijZdarzenie(env.adres, 'wake', 'wykryto słowo aktywujące');
  await pg3.waitForTimeout(2500);
  const cichy = await pg3.evaluate(() => {
    const m = document.getElementById('voice-overlay');
    return !m || m.style.display === 'none';
  });
  console.log(`4. przełącznik wyłączony → mikrofon zostaje wyłączony: ${cichy}`);
  if (!cichy) fail.push('mikrofon włączył się mimo wyłączonego przełącznika');

  // 5. drugie zdarzenie po chwili też dociera — strumień żyje, nie był
  //    jednorazowy (EventSource nie pojawia się w Resource Timing, więc
  //    mierzymy zachowanie, a nie wpis w przeglądarce)
  await pg.waitForTimeout(1500);
  await wyslijZdarzenie(env.adres, 'czujnik', 'druga wiadomość po czasie');
  await pg.waitForFunction(() => /druga wiadomość/.test(
    document.getElementById('event-flash').textContent), null, { timeout: 8000 }).catch(() => {});
  const drugie = await pg.textContent('#event-flash');
  console.log(`5. drugie zdarzenie po 1,5 s: „${drugie.trim()}"`);
  if (!/druga wiadomość/.test(drugie)) fail.push('strumień przestał działać po pierwszym zdarzeniu');

  if (errs.length) fail.push('błędy JS: ' + errs.join(' | '));
  await b.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nSTRUMIEŃ ZDARZEŃ OK');
  process.exit(fail.length ? 1 : 0);
})();

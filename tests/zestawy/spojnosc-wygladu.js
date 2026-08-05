const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
const OUT = require('../pomoc').KATALOG_ZRZUTOW;
let B;
async function overflow(page, label) {
  const r = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    bodyH: document.body.scrollHeight,
  }));
  const over = r.sw > r.iw + 1;
  console.log(`  [${label}] scrollW=${r.sw} innerW=${r.iw} horizОverflow=${over ? 'YES ⚠' : 'no'}`);
  return over;
}

(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  B = ADRES;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();

  // ---- Desktop dark ----
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  let page = await ctx.newPage();
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/d1-welcome-dark.png` });
  await overflow(page, 'desktop dark welcome');

  // Settings modal → scroll to training
  await page.click('#settings-btn');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/d2-settings.png` });
  await overflow(page, 'settings');
  // scroll the modal body to bottom to show training panel
  await page.evaluate(() => { const m = document.querySelector('#settings-modal .modal-body'); if (m) m.scrollTop = m.scrollHeight; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/d3-settings-training.png` });
  // slider check
  const sliders = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input[type=range]').forEach((s) => out.push({ id: s.id, min: s.min, max: s.max, val: s.value }));
    return out;
  });
  console.log('  sliders:', JSON.stringify(sliders));
  await page.click('#settings-close').catch(() => {});
  await page.waitForTimeout(200);

  // Nauka modal
  await page.click('#learn-btn');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/d4-learn-recog.png` });
  await overflow(page, 'learn recog');
  await page.click('[data-learn-tab="proc"]');
  await page.waitForTimeout(200);
  await page.click('#proc-add-step');
  await page.click('#proc-add-step');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/d5-learn-proc.png` });
  await overflow(page, 'learn proc');
  await page.click('[data-learn-tab="routine"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/d6-learn-routine.png` });
  await page.click('#learn-close').catch(() => {});
  await page.waitForTimeout(200);

  // Studio modal
  await page.click('#studio-btn').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/d7-studio.png` });
  await overflow(page, 'studio');
  await ctx.close();

  // ---- Desktop light ----
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  page = await ctx.newPage();
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/d8-welcome-light.png` });
  await overflow(page, 'desktop light welcome');
  await ctx.close();

  // ---- Mobile dark ----
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
  page = await ctx.newPage();
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/m1-welcome.png` });
  await overflow(page, 'mobile welcome');
  await page.click('#learn-btn').catch(() => {});
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/m2-learn.png` });
  await overflow(page, 'mobile learn');
  await page.click('#learn-close').catch(() => {});
  await page.click('#settings-btn').catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(() => { const m = document.querySelector('#settings-modal .modal-body'); if (m) m.scrollTop = m.scrollHeight; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/m3-settings-training.png` });
  await overflow(page, 'mobile settings training');
  await ctx.close();

  await browser.close();
  console.log('DONE');
})().catch((e) => { console.error('ERR', e.message); env.koniec(); process.exit(1); });

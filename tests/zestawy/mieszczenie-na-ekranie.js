const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Konkretne zarzuty z telefonu: łamany placeholder, ucinane zakładki, treść poza ekranem
const SHOT = require('../pomoc').KATALOG_ZRZUTOW;

(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const fail = [];

  for (const w of [360, 412]) {
    const page = await browser.newPage({ viewport: { width: w, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });
    await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    const r = await page.evaluate(() => {
      const ta = document.querySelector('#input');
      const sw = document.querySelector('.endpoint-switch');
      const tabs = [...sw.querySelectorAll('.endpoint-tab')];
      const wrap = document.querySelector('.composer-wrap');
      const scroll = document.querySelector('.chat-scroll');
      const welcome = document.querySelector('.welcome');
      const cs = getComputedStyle(ta);
      return {
        // 1. placeholder mieści się w jednej linii?
        taWidth: Math.round(ta.getBoundingClientRect().width),
        taHeight: Math.round(ta.getBoundingClientRect().height),
        lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.55,
        // 2. wszystkie zakładki widoczne bez przewijania?
        tabsCount: tabs.length,
        switchScrollW: sw.scrollWidth,
        switchClientW: sw.clientWidth,
        // 3. czy treść powitalna mieści się w obszarze przewijania?
        welcomeH: Math.round(welcome.getBoundingClientRect().height),
        scrollH: Math.round(scroll.getBoundingClientRect().height),
        composerTop: Math.round(wrap.getBoundingClientRect().top),
        pageScrollW: document.documentElement.scrollWidth,
        pageClientW: document.documentElement.clientWidth,
      };
    });

    const oneLine = r.taHeight < r.lineHeight * 1.8;
    const tabsFit = r.switchScrollW <= r.switchClientW + 2;
    const welcomeFits = r.welcomeH <= r.scrollH + 2;
    const noOverflow = r.pageScrollW <= r.pageClientW + 1;

    console.log(`\n── ${w}px ──`);
    console.log(`  ${oneLine ? 'OK ' : 'ZLE'} pole wiadomości: szer. ${r.taWidth}px, wys. ${r.taHeight}px (linia ${Math.round(r.lineHeight)}px)`);
    console.log(`  ${tabsFit ? 'OK ' : 'ZLE'} zakładki silników: ${r.tabsCount} szt., ${r.switchScrollW}/${r.switchClientW}px`);
    console.log(`  ${welcomeFits ? 'OK ' : 'ZLE'} ekran powitalny: ${r.welcomeH}px w oknie ${r.scrollH}px`);
    console.log(`  ${noOverflow ? 'OK ' : 'ZLE'} brak poziomego przepełnienia`);

    if (!oneLine) fail.push(`${w}px: placeholder łamie się`);
    if (!tabsFit) fail.push(`${w}px: zakładki nie mieszczą się (${r.switchScrollW}>${r.switchClientW})`);
    if (!welcomeFits) fail.push(`${w}px: powitanie nie mieści się (${r.welcomeH}>${r.scrollH})`);
    if (!noOverflow) fail.push(`${w}px: poziome przepełnienie`);

    await page.screenshot({ path: `${SHOT}/n-${w}.png` });
    await page.close();
  }

  console.log(fail.length ? '\nPROBLEMY:\n  ' + fail.join('\n  ') : '\nWSZYSTKO MIEŚCI SIĘ NA EKRANIE');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

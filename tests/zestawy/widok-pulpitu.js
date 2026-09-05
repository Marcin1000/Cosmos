const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Kontrola regresji: pulpit ma wyglądać tak jak przed zmianami mobilnymi
const SHOT = require('../pomoc').KATALOG_ZRZUTOW;

(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${ADRES}`, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  const r = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    inputFont: getComputedStyle(document.querySelector('#input')).fontSize,
    searchFont: getComputedStyle(document.querySelector('.conv-search')).fontSize,
    scrim: getComputedStyle(document.querySelector('.sidebar-scrim')).display,
    kbd: getComputedStyle(document.querySelector('.kbd-hint')).display,
    sidebarPos: getComputedStyle(document.querySelector('.sidebar')).position,
  }));
  console.log(JSON.stringify(r, null, 1));

  const fail = [];
  if (r.scrollW > r.clientW + 1) fail.push('poziome przepełnienie');
  if (r.inputFont !== '15px') fail.push('pole czatu zmieniło rozmiar na pulpicie: ' + r.inputFont);
  if (r.searchFont !== '13px') fail.push('wyszukiwarka zmieniła rozmiar: ' + r.searchFont);
  if (r.scrim !== 'none') fail.push('przyciemnienie widoczne na pulpicie');
  if (r.kbd === 'none') fail.push('skróty klawiszowe ukryte na pulpicie');
  if (r.sidebarPos === 'fixed') fail.push('panel boczny nakładką na pulpicie');

  await page.screenshot({ path: `${SHOT}/d1-desktop.png` });
  console.log(fail.length ? 'REGRESJE: ' + fail.join('; ') : 'PULPIT BEZ ZMIAN');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

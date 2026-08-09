const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Escape ma zamykać każdą nakładkę, a przy dwóch otwartych — tylko wierzchnią

const CASES = [
  { name: 'ustawienia',  open: '#settings-btn', id: 'settings-modal' },
  { name: 'studio',      open: '#studio-btn',   id: 'studio-modal' },
  { name: 'plener',      open: '#plener-btn',   id: 'plener-modal' },
  { name: 'nauka',       open: '#learn-btn',    id: 'learn-modal' },
  { name: 'baza wiedzy', open: '#kb-btn',       id: 'kb-modal' },
  { name: 'oś czasu',    open: '#timeline-btn', id: 'timeline-modal' },
  { name: 'galeria',     open: '#gallery-btn',  id: 'gallery-modal' },
];

const shown = (page, id) => page.evaluate((i) => document.getElementById(i).style.display !== 'none', id);

(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const fail = [];

  for (const c of CASES) {
    await page.click(c.open);
    await page.waitForTimeout(300);
    if (!(await shown(page, c.id))) { console.log(`?   ${c.name}: nie otworzyło się`); fail.push(c.name + ' nie otwiera'); continue; }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const stillOpen = await shown(page, c.id);
    console.log(`${stillOpen ? 'ZLE' : 'OK '} ${c.name}`);
    if (stillOpen) { fail.push(c.name); await page.click(`#${c.id.replace('-modal', '')}-close`).catch(() => {}); await page.waitForTimeout(200); }
  }

  // dwie warstwy: kamera nad czatem — Escape zdejmuje tylko kamerę
  await page.context().grantPermissions(['camera']);
  await page.click('#settings-btn');
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('camera-modal').style.display = ''; });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const cam = await shown(page, 'camera-modal');
  const set = await shown(page, 'settings-modal');
  console.log(`${!cam && set ? 'OK ' : 'ZLE'} warstwy: kamera=${cam ? 'otwarta' : 'zamknięta'} ustawienia=${set ? 'otwarte' : 'zamknięte'}`);
  if (cam || !set) fail.push('kolejność warstw');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  if (await shown(page, 'settings-modal')) fail.push('drugie Escape nie zamknęło ustawień');
  else console.log('OK  drugie Escape zamyka warstwę pod spodem');

  console.log(fail.length ? '\nPROBLEMY: ' + fail.join('; ') : '\nESCAPE OK WSZĘDZIE');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

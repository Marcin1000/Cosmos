const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Podgląd obrazu: otwiera się kliknięciem, ma pobieranie, zamyka się na trzy sposoby
(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const fail = [];
  page.on('pageerror', (e) => fail.push('błąd JS: ' + e.message));
  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // wstaw rozmowę z obrazem (jak po wygenerowaniu grafiki)
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
  await page.evaluate((png) => {
    // przez wewnętrzne funkcje aplikacji — układ w localStorage jest jej sprawą
    activeId = 'test-img';
    activeConversation = { id: 'test-img', title: 'Grafika', messages: [
      { role: 'assistant', content: { text: 'Gotowe — obraz zapisany.', images: [png] } }] };
    renderMessages();
  }, PNG);
  await page.waitForTimeout(600);

  const thumb = await page.evaluate(() => {
    const i = document.querySelector('.msg-images img');
    return i ? { exists: true, cursor: getComputedStyle(i).cursor, title: i.title } : { exists: false };
  });
  console.log(`1. miniatura: ${thumb.exists}, kursor=${thumb.cursor}, podpowiedź=„${thumb.title}"`);
  if (!thumb.exists) { console.log('BŁĄD: brak obrazu w rozmowie'); await browser.close(); env.koniec(); process.exit(1); }
  if (thumb.cursor !== 'zoom-in') fail.push('kursor nie sugeruje powiększenia');

  await page.click('.msg-images img');
  await page.waitForTimeout(400);
  const open = await page.evaluate(() => {
    const v = document.getElementById('img-viewer');
    const i = document.getElementById('img-viewer-img');
    const r = i.getBoundingClientRect();
    return {
      shown: v.style.display !== 'none',
      w: Math.round(r.width), h: Math.round(r.height),
      hasSrc: !!i.getAttribute('src'),
      dl: !!document.getElementById('img-viewer-download'),
      onTop: parseInt(getComputedStyle(v).zIndex, 10),
    };
  });
  console.log(`2. podgląd otwarty=${open.shown}, obraz ${open.w}×${open.h}, pobieranie=${open.dl}, warstwa z-index=${open.onTop}`);
  if (!open.shown) fail.push('podgląd się nie otworzył');
  if (!open.hasSrc) fail.push('podgląd bez obrazu');
  if (open.onTop < 50) fail.push('podgląd pod innymi warstwami');

  // pobieranie
  const dl = await page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  const clickDl = page.click('#img-viewer-download');
  const got = await Promise.race([
    page.waitForEvent('download', { timeout: 6000 }).then((d) => d.suggestedFilename()).catch(() => null),
    clickDl.then(() => new Promise((r) => setTimeout(() => r(null), 5500))),
  ]);
  console.log(`3. pobieranie: plik „${got || '(nie wykryto)'}"`);
  if (!got || !/^cosmos-.*\.png$/.test(got)) fail.push('pobieranie nie wystartowało albo zła nazwa pliku');

  // Escape zamyka
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  let closed = await page.evaluate(() => document.getElementById('img-viewer').style.display === 'none');
  console.log(`4. Escape zamyka: ${closed}`);
  if (!closed) fail.push('Escape nie zamyka podglądu');

  // kliknięcie w tło zamyka, kliknięcie w obraz nie
  await page.click('.msg-images img');
  await page.waitForTimeout(300);
  await page.click('#img-viewer-img');
  await page.waitForTimeout(250);
  const stillOpen = await page.evaluate(() => document.getElementById('img-viewer').style.display !== 'none');
  await page.mouse.click(30, 500);
  await page.waitForTimeout(300);
  closed = await page.evaluate(() => document.getElementById('img-viewer').style.display === 'none');
  console.log(`5. kliknięcie w obraz NIE zamyka=${stillOpen}, kliknięcie w tło zamyka=${closed}`);
  if (!stillOpen) fail.push('kliknięcie w sam obraz zamyka podgląd');
  if (!closed) fail.push('kliknięcie w tło nie zamyka');

  // mobile
  const m = await browser.newPage({ viewport: { width: 360, height: 740 } });
  await m.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(700);
  await m.evaluate((png) => {
    activeId = 'test-img';
    activeConversation = { id: 'test-img', title: 'g', messages: [
      { role: 'assistant', content: { text: 'x', images: [png] } }] };
    renderMessages();
  }, PNG);
  await m.waitForTimeout(500);
  await m.click('.msg-images img');
  await m.waitForTimeout(400);
  const mob = await m.evaluate(() => {
    const i = document.getElementById('img-viewer-img').getBoundingClientRect();
    const bar = document.querySelector('.img-viewer-bar').getBoundingClientRect();
    return {
      fits: i.right <= window.innerWidth + 1 && i.bottom <= window.innerHeight + 1 && i.left >= -1,
      overlap: i.top < bar.bottom && i.right > bar.left,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  console.log(`6. telefon: obraz mieści się=${mob.fits}, scroll X=${mob.overflowX}`);
  if (!mob.fits) fail.push('podgląd wychodzi poza ekran telefonu');
  if (mob.overflowX) fail.push('poziomy scroll przy podglądzie');
  await m.screenshot({ path: process.env.SHOT_DIR + '/viewer-mobile.png' });

  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nPODGLĄD OBRAZU OK');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

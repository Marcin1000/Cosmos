const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// „Użyj jako pierwsza klatka wideo" z Galerii → pole w Studiu
(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  const fail = [];
  page.on('pageerror', (e) => fail.push('błąd JS: ' + e.message));

  const ITEM = { id: 'img-42', name: 'obraz-2026-08-03.png', mime: 'image/png', kind: 'file' };
  await page.route('**/api/kb', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ items: [ITEM] }),
  }));
  await page.route('**/api/studio/providers', (r) => r.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ image: true, imageProviders: [{ id: 'openai', label: 'OpenAI' }],
      speech: true, video: true, voice: 'Rachel' }),
  }));
  await page.route('**/api/kb/raw**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: '' }));

  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // Galeria → klik 🎬
  await page.evaluate(() => openGallery());
  await page.waitForTimeout(900);
  const cell = await page.evaluate(() => {
    const b = document.querySelector('[data-frame]');
    return { exists: !!b, id: b ? b.dataset.frame : null, title: b ? b.title : '' };
  });
  console.log(`1. przycisk klatki w Galerii: ${cell.exists}, id=${cell.id}`);
  if (!cell.exists) { console.log('BŁĄD: brak przycisku 🎬'); await browser.close(); env.koniec(); process.exit(1); }

  await page.click('[data-frame]');
  await page.waitForTimeout(300);
  const pending = await page.evaluate(() => ({
    saved: localStorage.getItem('cosmos.videoFrame'),
    note: (document.getElementById('gallery-note') || {}).textContent || '',
    marked: !!document.querySelector('[data-frame].frame-on'),
  }));
  console.log(`2. zapamiętane: ${pending.saved}, oznaczone w Galerii=${pending.marked}`);
  console.log(`   komunikat: „${pending.note}"`);
  if (pending.saved !== ITEM.id) fail.push(`nie zapamiętano wyboru (${pending.saved})`);
  if (!pending.marked) fail.push('brak oznaczenia wybranego obrazu w Galerii');
  if (!pending.note) fail.push('brak potwierdzenia dla użytkownika');

  // zamknij Galerię, otwórz Studio
  await page.evaluate(() => closeGallery());
  await page.waitForTimeout(300);
  await page.evaluate(() => openStudio());
  await page.waitForTimeout(1200);

  const studio = await page.evaluate(() => {
    const s = $('studio-video-image');
    return {
      opts: [...s.options].map((o) => `${o.value}|${o.textContent}`),
      value: s.value,
      selectedText: s.options[s.selectedIndex] ? s.options[s.selectedIndex].textContent : '',
      pendingAfter: localStorage.getItem('cosmos.videoFrame'),
      visible: $('studio-modal').style.display !== 'none',
    };
  });
  console.log(`3. Studio otwarte=${studio.visible}, opcje: ${studio.opts.join(' / ')}`);
  console.log(`   wybrana wartość: „${studio.value}" → „${studio.selectedText}"`);
  console.log(`   wybór nadal zapisany: ${studio.pendingAfter === ITEM.id}`);
  if (studio.value !== ITEM.id) fail.push(`pole pierwszej klatki puste (wartość „${studio.value}")`);
  if (studio.pendingAfter !== ITEM.id) fail.push('wybór skasowany po pierwszym otwarciu');

  // DRUGIE otwarcie Studia — tu wcześniej wybór przepadał
  await page.evaluate(() => { $('studio-modal').style.display = 'none'; });
  await page.waitForTimeout(200);
  await page.evaluate(() => openStudio());
  await page.waitForTimeout(1200);
  const again = await page.evaluate(() => $('studio-video-image').value);
  console.log(`4. po ponownym wejściu do Studia: „${again}"`);
  if (again !== ITEM.id) fail.push('przy drugim otwarciu Studia wybór przepadł — to był zgłoszony błąd');

  // usunięty obraz nie zostawia martwego wyboru
  await page.route('**/api/kb', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ items: [] }) }));
  await page.evaluate(() => { $('studio-modal').style.display = 'none'; });
  await page.evaluate(() => openStudio());
  await page.waitForTimeout(1000);
  const stale = await page.evaluate(() => localStorage.getItem('cosmos.videoFrame'));
  console.log(`5. po usunięciu obrazu z bazy wybór wyczyszczony: ${stale === null}`);
  if (stale !== null) fail.push('martwy wybór został po usunięciu obrazu');

  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nPIERWSZA KLATKA OK');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

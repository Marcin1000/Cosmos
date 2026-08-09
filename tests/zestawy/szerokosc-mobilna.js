const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Sprawdzian mobilny: brak poziomego przepełnienia + pola >= 16px + zrzuty
const SHOT = require('../pomoc').KATALOG_ZRZUTOW;

(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 });
  const problems = [];

  const checkOverflow = async (label) => {
    const r = await page.evaluate(() => {
      const bad = [];
      const vw = document.documentElement.clientWidth;
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && (b.right > vw + 1 || b.left < -1) && getComputedStyle(el).visibility !== 'hidden') {
          // pomiń elementy wewnątrz przewijalnych kontenerów i schowany sidebar
          let p = el.parentElement, scrollable = false;
          while (p) {
            const s = getComputedStyle(p);
            if (/(auto|scroll)/.test(s.overflowX)) { scrollable = true; break; }
            if (p.classList && p.classList.contains('sidebar') && p.classList.contains('collapsed')) { scrollable = true; break; }
            p = p.parentElement;
          }
          if (el.classList.contains('sidebar') && el.classList.contains('collapsed')) scrollable = true;
          if (!scrollable) bad.push(`${el.tagName}.${[...el.classList].join('.')} right=${Math.round(b.right)} vw=${vw}`);
        }
      }
      return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, bad: bad.slice(0, 6) };
    });
    const ok = r.scrollW <= r.clientW + 1 && r.bad.length === 0;
    console.log(`${ok ? 'OK ' : 'ZLE'} ${label}: scrollW=${r.scrollW} clientW=${r.clientW}${r.bad.length ? '\n     ' + r.bad.join('\n     ') : ''}`);
    if (!ok) problems.push(label);
  };

  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // 1. ekran powitalny (sidebar sam się chowa na mobile? sprawdź stan)
  await checkOverflow('ekran powitalny');
  await page.screenshot({ path: `${SHOT}/m1-welcome.png` });

  // 2. czcionki pól — Chrome auto-zoom threshold
  const fonts = await page.evaluate(() => {
    const sel = ['#input', '.conv-search'];
    return sel.map(s => {
      const el = document.querySelector(s);
      return el ? `${s}=${getComputedStyle(el).fontSize}` : `${s}=BRAK`;
    });
  });
  console.log('Czcionki pól:', fonts.join(', '));
  for (const f of fonts) if (!f.includes('=16px') && !f.includes('BRAK')) problems.push('font<16px: ' + f);

  // 3. sidebar otwarty
  // 4. ustawienia
  const openSidebar = async () => {
    const collapsed = await page.evaluate(() => document.querySelector('.sidebar')?.classList.contains('collapsed'));
    if (collapsed) { await page.click('#expand-btn'); await page.waitForTimeout(400); }
  };
  const closeSidebar = async () => {
    const collapsed = await page.evaluate(() => document.querySelector('.sidebar')?.classList.contains('collapsed'));
    if (!collapsed) { await page.click('#collapse-btn'); await page.waitForTimeout(400); }
  };

  const openModal = async (btnSel, closeSel, label, shot) => {
    const b = await page.$(btnSel);
    if (!b) { console.log('POMINIETO', label, '(brak przycisku', btnSel + ')'); return; }
    await openSidebar();
    await b.click();
    await page.waitForTimeout(450);
    await checkOverflow(label);
    await page.screenshot({ path: `${SHOT}/${shot}.png` });
    await page.click(closeSel);
    await page.waitForTimeout(300);
    await closeSidebar();
  };

  await openSidebar();
  await checkOverflow('sidebar otwarty');
  await page.screenshot({ path: `${SHOT}/m2-sidebar.png` });
  await closeSidebar();

  await openModal('#settings-btn', '#settings-close', 'ustawienia', 'm3-settings');
  await openModal('#studio-btn', '#studio-close', 'studio', 'm4-studio');
  await openModal('#plener-btn', '#plener-close', 'plener', 'm4b-plener');
  await openModal('#learn-btn', '#learn-close', 'nauka', 'm5-learn');
  await openModal('#kb-btn', '#kb-close', 'baza wiedzy', 'm6-kb');
  await openModal('#timeline-btn', '#timeline-close', 'oś czasu', 'm7-timeline');
  await openModal('#gallery-btn', '#gallery-close', 'galeria', 'm8-gallery');

  console.log(problems.length ? `\nPROBLEMY: ${problems.join('; ')}` : '\nWSZYSTKO OK');
  await browser.close();
  env.koniec();
  process.exit(problems.length ? 1 : 0);
})();

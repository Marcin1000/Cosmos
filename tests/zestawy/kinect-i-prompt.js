const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Trzy funkcje: kamera na pełnym ekranie i w okienku, wybór mikrofonu, dopracowanie promptu

(async () => {
  const env = await srodowisko('rozumujacy');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, permissions: ['microphone', 'camera'] });
  const page = await ctx.newPage();
  const fail = [];
  page.on('pageerror', (e) => fail.push('błąd JS: ' + e.message));
  page.on('dialog', (d) => { fail.push('alert: ' + d.message()); d.dismiss(); });

  await page.goto(`${ADRES}/app`, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // ---- 1. kamera: pełny ekran i okienko (runda 8 – zamiast „powiększ”) ----
  await page.evaluate(() => { localStorage.setItem('cosmos.liveSource', 'kinect-color'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.click('#live-btn');
  await page.waitForTimeout(1200);

  const stan = () => page.evaluate(() => {
    const p = document.getElementById('live-panel');
    const r = p.getBoundingClientRect();
    return {
      tryb: p.dataset.tryb, w: Math.round(r.width), h: Math.round(r.height),
      modalny: document.querySelector('.app') ? document.querySelector('.app').inert : null,
      kropka: document.getElementById('live-btn').classList.contains('na-zywo'),
      saved: localStorage.getItem('cosmos.kameraTryb'),
    };
  });
  const pelny = await stan();
  console.log(`1. otwarta: tryb=${pelny.tryb}, ${pelny.w}×${pelny.h}, reszta nieaktywna=${pelny.modalny}`);
  if (pelny.tryb !== 'pelny') fail.push(`kamera nie startuje na pełnym ekranie (${pelny.tryb})`);
  if (pelny.w < 1190 || pelny.h < 890) fail.push(`pełny ekran nie zajmuje okna (${pelny.w}×${pelny.h})`);
  if (pelny.modalny !== true) fail.push('pełny ekran nie jest modalny – rozmowa pod spodem dalej przyjmuje fokus');

  await page.click('#live-do-okienka');
  await page.waitForTimeout(400);
  const mini = await stan();
  console.log(`   okienko: ${mini.w}×${mini.h}, zapamiętane=${mini.saved}, kropka na ikonie=${mini.kropka}, rozmowa aktywna=${!mini.modalny}`);
  if (mini.tryb !== 'mini' || mini.w > 260) fail.push(`„do okienka” nie zmniejsza (${mini.tryb}, ${mini.w} px)`);
  if (mini.modalny) fail.push('okienko blokuje rozmowę (inert)');
  if (!mini.kropka) fail.push('ikona kamery nie mówi, że kamera działa w okienku');
  if (mini.saved !== 'mini') fail.push('tryb okienka nie zapamiętany');

  // przetrwa przeładowanie
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.click('#live-btn');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    const p = document.getElementById('live-panel');
    const img = document.getElementById('live-image');
    return { tryb: p.dataset.tryb, w: img.naturalWidth, src: img.getAttribute('src') || '' };
  });
  console.log(`2. po przeładowaniu: tryb=${after.tryb}, klatka ${after.w}px, src=${after.src.slice(0, 46)}`);
  if (after.tryb !== 'mini') fail.push('okienko nie przetrwało przeładowania');
  if (!after.w) fail.push('brak klatki po przeładowaniu');
  if (!/\/api\/kinect\/stream/.test(after.src)) fail.push('nie użyto MJPEG');

  // z okienka ikona w pasku wraca na pełny ekran, „×” zamyka
  await page.click('#live-btn');
  await page.waitForTimeout(300);
  const znow = await stan();
  console.log(`3. ikona z okienka: tryb=${znow.tryb}`);
  if (znow.tryb !== 'pelny') fail.push('ikona kamery z okienka nie wraca na pełny ekran');
  await page.screenshot({ path: require('../pomoc').KATALOG_ZRZUTOW + '/feat3-expanded.png' });
  await page.click('#live-close');
  await page.waitForTimeout(300);
  const zamkniete = await page.evaluate(() => document.getElementById('live-panel').style.display);
  if (zamkniete !== 'none') fail.push('„×” nie zamyka kamery');

  // ---- 2. wybór mikrofonu w ustawieniach ----
  await page.click('#settings-btn');
  await page.waitForTimeout(1500);
  const mic = await page.evaluate(() => {
    const s = document.getElementById('set-mic');
    return {
      exists: !!s, disabled: s.disabled, n: s.options.length,
      opts: Array.from(s.options).map((o) => o.textContent).slice(0, 5),
      hasRefresh: !!document.getElementById('mic-refresh'),
    };
  });
  console.log(`4. mikrofony: ${mic.n} pozycji, odśwież=${mic.hasRefresh}, wyłączony=${mic.disabled}`);
  console.log(`   ${mic.opts.join(' | ')}`);
  if (!mic.exists || !mic.hasRefresh) fail.push('brak kontrolek mikrofonu');
  if (mic.disabled) fail.push('lista mikrofonów wyłączona mimo dostępnego API');
  if (mic.n < 2) fail.push('lista mikrofonów pusta (oczekiwano domyślny + urządzenie)');

  // wybór zapisuje się
  const val = await page.evaluate(() => {
    const s = document.getElementById('set-mic');
    s.value = s.options[1].value;
    s.dispatchEvent(new Event('change'));
    return { chosen: s.value, saved: localStorage.getItem('cosmos.micId') };
  });
  console.log(`5. wybór zapisany: ${val.saved === val.chosen ? 'tak' : 'NIE'} (${String(val.saved).slice(0, 12)}…)`);
  if (val.saved !== val.chosen) fail.push('wybór mikrofonu nie zapisany');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ---- 3. dopracowanie promptu ----
  const shortState = await page.evaluate(() => {
    const i = document.getElementById('input');
    i.value = 'krótko'; i.dispatchEvent(new Event('input'));
    return document.getElementById('polish-btn').hidden;
  });
  console.log(`6. przy krótkim tekście przycisk ukryty: ${shortState}`);
  if (!shortState) fail.push('przycisk widoczny przy krótkim tekście');

  const dictated = 'no wiec chcialbym zeby ta strona byla ladna i szybka i zeby dzialala na telefonie no wiesz';
  const longState = await page.evaluate((txt) => {
    const i = document.getElementById('input');
    i.value = txt; i.dispatchEvent(new Event('input'));
    return document.getElementById('polish-btn').hidden;
  }, dictated);
  console.log(`7. przy dłuższym tekście przycisk widoczny: ${!longState}`);
  if (longState) fail.push('przycisk ukryty przy długim tekście');

  await page.click('#polish-btn');
  await page.waitForTimeout(1200);
  const polished = await page.evaluate(() => ({
    v: document.getElementById('input').value,
    title: document.getElementById('polish-btn').title,
    disabled: document.getElementById('polish-btn').disabled,
    ph: document.getElementById('input').placeholder,
  }));
  console.log(`8. po dopracowaniu (${polished.v.length} zn.): ${polished.v.slice(0, 60).replace(/\n/g, '⏎')}…`);
  console.log(`   tytuł=„${polished.title}", zablokowany=${polished.disabled}`);
  if (polished.v === dictated) fail.push('tekst się nie zmienił');
  if (polished.v.length < 10) fail.push('nie wstawiono odpowiedzi modelu');
  if (polished.disabled) fail.push('przycisk został zablokowany');
  if (!/przywróć|restore/i.test(polished.title)) fail.push('brak podpowiedzi o cofnięciu');

  await page.click('#polish-btn');
  await page.waitForTimeout(500);
  const undone = await page.evaluate(() => document.getElementById('input').value);
  console.log(`9. cofnięcie przywraca oryginał: ${undone === dictated}`);
  if (undone !== dictated) fail.push('cofnięcie nie przywróciło oryginału');

  await page.screenshot({ path: require('../pomoc').KATALOG_ZRZUTOW + '/feat3-desktop.png' });

  // ---- 4. mobile: przycisk nie rozbija kompozytora ----
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 360, height: 740 });
  await m.goto(`${ADRES}/app`, { waitUntil: 'load' });
  await m.waitForTimeout(500);
  const mob = await m.evaluate((txt) => {
    const i = document.getElementById('input');
    i.value = txt; i.dispatchEvent(new Event('input'));
    const b = document.getElementById('polish-btn').getBoundingClientRect();
    return {
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollW: document.documentElement.scrollWidth, vw: window.innerWidth,
      btnRight: Math.round(b.right), btnW: Math.round(b.width), btnH: Math.round(b.height),
    };
  }, dictated);
  console.log(`10. mobile: szerokość ${mob.scrollW}/${mob.vw}, przycisk ${mob.btnW}×${mob.btnH} prawa=${mob.btnRight}`);
  if (mob.overflowX) fail.push('poziomy scroll na mobile');
  if (mob.btnRight > mob.vw) fail.push('przycisk dopracowania poza ekranem');
  if (mob.btnW < 28 || mob.btnH < 28) fail.push('przycisk za mały pod palec');
  await m.screenshot({ path: require('../pomoc').KATALOG_ZRZUTOW + '/feat3-mobile.png' });

  // ---- 5. kamera na małych/niskich ekranach: pełny ekran się mieści, okienko ma kształt kadru ----
  for (const vp of [{ width: 360, height: 740, n: 'telefon' }, { width: 1280, height: 640, n: 'niski laptop' }]) {
    await m.setViewportSize({ width: vp.width, height: vp.height });
    await m.evaluate(() => {
      localStorage.setItem('cosmos.liveSource', 'kinect-color');
      localStorage.setItem('cosmos.kameraTryb', 'pelny');
    });
    await m.reload({ waitUntil: 'load' });
    await m.waitForTimeout(400);
    await m.click('#live-btn');
    await m.waitForTimeout(900);
    const r = await m.evaluate(() => {
      const p = document.getElementById('live-panel').getBoundingClientRect();
      const s = document.querySelector('.live-stage').getBoundingClientRect();
      return {
        l: Math.round(p.left), t: Math.round(p.top), r: Math.round(p.right), b: Math.round(p.bottom),
        vw: window.innerWidth, vh: window.innerHeight,
        ratio: s.width / s.height, sw: Math.round(s.width),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
    const fits = r.l >= -1 && r.t >= -1 && r.r <= r.vw + 1 && r.b <= r.vh + 1;
    // Klatka Kinecta jest 4:3 – okienko przy rozmowie ma dokładnie ten kształt.
    await m.click('#live-do-okienka');
    await m.waitForTimeout(400);
    r.ratio = await m.evaluate(() => { const s = document.querySelector('.live-stage').getBoundingClientRect(); return s.width / s.height; });
    await m.click('#live-na-pelny');
    console.log(`11. ${vp.n} ${vp.width}×${vp.height}: panel [${r.l},${r.t}]–[${r.r},${r.b}] `
      + `mieści się=${fits}, scena ${r.sw}px ${r.ratio.toFixed(2)}:1, scroll X=${r.overflowX}`);
    if (!fits) fail.push(`kamera na pełnym ekranie nie mieści się na ${vp.n}`);
    if (Math.abs(r.ratio - 4 / 3) > 0.03) fail.push(`okienko nie 4:3 na ${vp.n} (${r.ratio.toFixed(2)})`);
    if (r.overflowX) fail.push(`poziomy scroll na ${vp.n}`);
    await m.screenshot({ path: `${require("../pomoc").KATALOG_ZRZUTOW}/feat3-exp-${vp.width}x${vp.height}.png` });
    await m.click('#live-close');
  }

  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nWSZYSTKO OK');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

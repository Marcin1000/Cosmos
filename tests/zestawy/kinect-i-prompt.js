const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Trzy nowe funkcje: powiększenie podglądu, wybór mikrofonu, dopracowanie promptu

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

  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ---- 1. powiększenie podglądu ----
  await page.evaluate(() => { localStorage.setItem('cosmos.liveSource', 'kinect-color'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('#live-btn');
  await page.waitForTimeout(1200);

  const small = await page.evaluate(() => {
    const p = document.getElementById('live-panel');
    return { w: p.getBoundingClientRect().width, exp: p.classList.contains('expanded') };
  });
  await page.click('#live-expand');
  await page.waitForTimeout(400);
  const big = await page.evaluate(() => {
    const p = document.getElementById('live-panel');
    const r = p.getBoundingClientRect();
    const st = document.getElementById('live-stage') || p.querySelector('.live-stage');
    const sr = st.getBoundingClientRect();
    return {
      w: r.width, exp: p.classList.contains('expanded'),
      cx: Math.round(r.left + r.width / 2), pageCx: Math.round(window.innerWidth / 2),
      overflowY: document.documentElement.scrollHeight > window.innerHeight + 2,
      offRight: r.right > window.innerWidth + 1, offTop: r.top < -1,
      stageH: Math.round(sr.height), stageW: Math.round(sr.width),
      stageBottom: Math.round(sr.bottom), vh: window.innerHeight,
      saved: localStorage.getItem('cosmos.liveExpanded'),
    };
  });
  console.log(`1. panel: ${Math.round(small.w)}px → ${Math.round(big.w)}px, wyśrodkowany: ${big.cx} vs ${big.pageCx}`);
  const ratio = big.stageW / big.stageH;
  console.log(`   scena ${big.stageW}×${big.stageH} (${ratio.toFixed(2)}:1), zapamiętane=${big.saved}, `
    + `poza ekranem: prawo=${big.offRight} góra=${big.offTop} dół=${big.stageBottom > big.vh}`);
  if (Math.abs(ratio - 4 / 3) > 0.02) fail.push(`scena nie 4:3 (${ratio.toFixed(2)}) — czarne pasy`);
  if (small.exp) fail.push('panel startuje powiększony');
  if (!big.exp) fail.push('klasa expanded nie doszła');
  if (big.w <= small.w + 100) fail.push('panel się nie powiększył');
  if (Math.abs(big.cx - big.pageCx) > 3) fail.push('panel nie jest wyśrodkowany');
  if (big.offRight || big.offTop) fail.push('powiększony panel wychodzi poza ekran');
  if (big.saved !== '1') fail.push('powiększenie nie zapamiętane');

  // przetrwa przeładowanie
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('#live-btn');
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => {
    const p = document.getElementById('live-panel');
    const img = document.getElementById('live-image');
    return { exp: p.classList.contains('expanded'), w: img.naturalWidth, src: img.getAttribute('src') || '' };
  });
  console.log(`2. po przeładowaniu: expanded=${after.exp}, klatka ${after.w}px, src=${after.src.slice(0, 46)}`);
  if (!after.exp) fail.push('powiększenie nie przetrwało przeładowania');
  if (!after.w) fail.push('brak klatki po przeładowaniu');
  if (!/\/api\/kinect\/stream/.test(after.src)) fail.push('nie użyto MJPEG');

  await page.screenshot({ path: process.env.SHOT_DIR + '/feat3-expanded.png' });

  // zwiń z powrotem
  await page.click('#live-expand');
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => ({
    exp: document.getElementById('live-panel').classList.contains('expanded'),
    saved: localStorage.getItem('cosmos.liveExpanded'),
  }));
  console.log(`3. zwinięcie: expanded=${back.exp}, zapamiętane=${back.saved}`);
  if (back.exp || back.saved !== '0') fail.push('zwijanie nie działa');
  await page.click('#live-close');
  await page.waitForTimeout(300);

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

  await page.screenshot({ path: process.env.SHOT_DIR + '/feat3-desktop.png' });

  // ---- 4. mobile: przycisk nie rozbija kompozytora ----
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 360, height: 740 });
  await m.goto(`${ADRES}`, { waitUntil: 'networkidle' });
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
  await m.screenshot({ path: process.env.SHOT_DIR + '/feat3-mobile.png' });

  // ---- 5. powiększony podgląd na małych/niskich ekranach ----
  for (const vp of [{ width: 360, height: 740, n: 'telefon' }, { width: 1280, height: 640, n: 'niski laptop' }]) {
    await m.setViewportSize({ width: vp.width, height: vp.height });
    await m.evaluate(() => {
      localStorage.setItem('cosmos.liveSource', 'kinect-color');
      localStorage.setItem('cosmos.liveExpanded', '1');
    });
    await m.reload({ waitUntil: 'networkidle' });
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
    console.log(`11. ${vp.n} ${vp.width}×${vp.height}: panel [${r.l},${r.t}]–[${r.r},${r.b}] `
      + `mieści się=${fits}, scena ${r.sw}px ${r.ratio.toFixed(2)}:1, scroll X=${r.overflowX}`);
    if (!fits) fail.push(`powiększony panel nie mieści się na ${vp.n}`);
    if (Math.abs(r.ratio - 4 / 3) > 0.03) fail.push(`scena nie 4:3 na ${vp.n} (${r.ratio.toFixed(2)})`);
    if (r.overflowX) fail.push(`poziomy scroll na ${vp.n}`);
    await m.screenshot({ path: `${process.env.SHOT_DIR}/feat3-exp-${vp.width}x${vp.height}.png` });
    await m.click('#live-close');
  }

  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nWSZYSTKO OK');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

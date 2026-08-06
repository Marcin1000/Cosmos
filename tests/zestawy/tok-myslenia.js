const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Naprawy zgłoszone z telefonu: myślenie widoczne, brak pustych odpowiedzi,
// pętla wyszukiwania kończy się odpowiedzią, panel boczny i kamera na mobile.
const SHOT = require('../pomoc').KATALOG_ZRZUTOW;

(async () => {
  const env = await srodowisko('rozumujacy');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 900 }, permissions: ['microphone', 'camera'],
  });
  const page = await ctx.newPage();
  const fail = [];
  const alerts = [];
  page.on('pageerror', (e) => fail.push('błąd JS: ' + e.message));
  page.on('dialog', (d) => { alerts.push(d.message()); d.dismiss(); });

  const send = async (text) => {
    await page.fill('#input', text);
    await page.click('#send-btn');
  };
  const lastAssistant = () => page.evaluate(() => {
    const all = [...document.querySelectorAll('.msg-assistant .msg-content')];
    const n = all[all.length - 1];
    return n ? n.innerText.trim() : '';
  });

  await page.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // ---- 1. model, który myśli i pisze: myślenie widoczne, odpowiedź na miejscu ----
  await send('Zwykłe pytanie o nic szczególnego');
  await page.waitForTimeout(2500);
  let s = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.msg-assistant .msg-content')].pop();
    const th = b.querySelector('.think-block');
    return {
      text: b.innerText.trim(),
      hasThink: !!th,
      thinkOpen: th ? th.hasAttribute('open') : null,
      thinkText: th ? th.innerText.trim() : '',
    };
  });
  console.log(`1. odpowiedź: „${s.text.split('\n').pop().slice(0, 50)}"`);
  console.log(`   blok myślenia=${s.hasThink}, zwinięty=${s.thinkOpen === false}, treść=„${s.thinkText.split('\n').pop().slice(0, 40)}"`);
  if (!s.hasThink) fail.push('tok myślenia nie pokazany');
  if (s.thinkOpen) fail.push('blok myślenia rozwinięty mimo gotowej odpowiedzi');
  if (!/Odpowiedź modelu/.test(s.text)) fail.push('brak właściwej odpowiedzi');

  // ---- 2. model zużywa cały budżet na myślenie: NIE „pusta odpowiedź” ----
  await page.click('#new-chat-btn').catch(() => {});
  await page.waitForTimeout(400);
  await send('pusto — ile kosztują nowe buty New Balance');
  await page.waitForTimeout(2500);
  /* Kontrakt zmienił się w Partii 31 i test musiał pójść za nim. Kiedyś surowe
     rozumowanie SAMO stawało się odpowiedzią — angielskie, urwane w pół zdania,
     podane jak gotowy wynik. Teraz na miejscu odpowiedzi pada jedno zdanie, co
     się stało, a rozumowanie ląduje w panelu. Nie wolno go jednak zwinąć: gdy
     to jedyne, co przyszło, użytkownik zostałby z samym ostrzeżeniem. */
  s = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.msg-assistant .msg-content')].pop();
    const th = b.querySelector('.think-block');
    return {
      text: b.innerText.trim(),
      hasThink: !!th,
      otwarty: th ? th.hasAttribute('open') : null,
      thinkText: th ? th.innerText.trim() : '',
    };
  });
  console.log(`2. sam tok myślenia: „${s.text.replace(/\n/g, ' ').slice(0, 70)}"`);
  console.log(`   panel myślenia=${s.hasThink}, otwarty=${s.otwarty}, `
    + `treść=„${s.thinkText.replace(/\n/g, ' ').slice(0, 50)}"`);
  if (/pusta odpowiedź|empty model/i.test(s.text)) fail.push('nadal „(pusta odpowiedź modelu)”');
  if (!s.hasThink) fail.push('tok myślenia nie trafił na ekran');
  if (!/buty|cen/i.test(s.thinkText)) fail.push('panel myślenia nie zawiera rozumowania');
  if (!s.otwarty) fail.push('panel zwinięty, choć myślenie to jedyna treść — zostaje samo ostrzeżenie');
  // …i rozumowanie NIE MOŻE udawać odpowiedzi poza panelem
  const pozaPanelem = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.msg-assistant .msg-content')].pop().cloneNode(true);
    const th = b.querySelector('.think-block');
    if (th) th.remove();
    return b.innerText.trim();
  });
  if (/buty|cen/i.test(pozaPanelem)) fail.push(`surowe rozumowanie podane jako odpowiedź: „${pozaPanelem.slice(0, 60)}"`);

  // ---- 3. pętla wyszukiwania kończy się odpowiedzią, bez surowego [SZUKAJ:] ----
  await page.click('#new-chat-btn').catch(() => {});
  await page.waitForTimeout(400);
  await send('szukaj — jaka jest teraz pogoda w Warszawie');
  await page.waitForTimeout(14000);
  const conv = await page.evaluate(() => ({
    all: [...document.querySelectorAll('.msg')].map((m) => m.innerText.trim()),
    last: ([...document.querySelectorAll('.msg-assistant .msg-content')].pop() || {}).innerText || '',
  }));
  const searches = conv.all.filter((x) => /Szukam w internecie/i.test(x)).length;
  const leaked = /\[SZUKAJ:/i.test(conv.last);
  console.log(`3. wyszukiwań: ${searches}, ostatnia wiadomość: „${conv.last.replace(/\n/g, ' ').slice(0, 60)}"`);
  console.log(`   surowe [SZUKAJ:] na ekranie: ${leaked}`);
  if (leaked) fail.push('dyrektywa [SZUKAJ:] pokazana użytkownikowi');
  if (!/stopni|IMGW/i.test(conv.last)) fail.push('pętla nie zakończyła się odpowiedzią');
  if (searches > 4) fail.push(`za dużo rund wyszukiwania (${searches})`);

  // ---- 4. streszczenie ----
  const sum = await page.evaluate(async () => {
    const r = await fetch('/api/summarize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'pusto — rozmowa', endpoint: 'cloud' }),
    });
    return { ok: r.ok, d: await r.json() };
  });
  console.log(`4. streszczenie: ok=${sum.ok}, „${String(sum.d.summary || sum.d.error).slice(0, 50)}"`);
  if (!sum.ok || !String(sum.d.summary || '').trim()) fail.push('streszczenie puste');

  // ---- 5. przełącznik kamery przód/tył ----
  // Chromium z atrapą ma tylko jedną kamerę, a przełącznik ma się pokazywać
  // wyłącznie przy dwóch — udajemy telefon, dokładając drugie urządzenie.
  await page.evaluate(() => {
    const real = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => {
      const d = await real();
      return [...d, { kind: 'videoinput', deviceId: 'fake_device_1', label: 'Tylna', groupId: 'g2' }];
    };
  });
  await page.click('#camera-btn');
  await page.waitForTimeout(1200);
  const cam = await page.evaluate(() => ({
    open: document.getElementById('camera-modal').style.display !== 'none',
    flip: !document.getElementById('camera-flip').hidden,
    w: document.getElementById('camera-video').videoWidth,
  }));
  console.log(`5. kamera: otwarta=${cam.open}, przełącznik=${cam.flip}, obraz ${cam.w}px`);
  if (!cam.open) fail.push('kamera się nie otworzyła');
  if (!cam.w) fail.push('brak obrazu z kamery');
  if (!cam.flip) fail.push('brak przełącznika przód/tył (atrapa ma 2 kamery)');
  if (cam.flip) {
    await page.click('#camera-flip');
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => ({
      w: document.getElementById('camera-video').videoWidth,
      saved: localStorage.getItem('cosmos.cameraFacing'),
    }));
    console.log(`   po przełączeniu: obraz ${after.w}px, zapamiętane=${after.saved}`);
    if (!after.w) fail.push('po przełączeniu nie ma obrazu');
    if (after.saved !== 'user') fail.push('wybór kamery nie zapamiętany');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---- 6. tryb głosowy: kamera NIE startuje sama ----
  await page.evaluate(() => localStorage.removeItem('cosmos.voiceCam'));
  await page.click('#voice-btn');
  await page.waitForTimeout(1800);
  const v = await page.evaluate(() => ({
    open: document.getElementById('voice-overlay').style.display !== 'none',
    camShown: document.getElementById('voice-camera-wrap').style.display !== 'none',
    btn: !!document.getElementById('voice-cam-btn'),
  }));
  console.log(`6. tryb głosowy: otwarty=${v.open}, kamera sama=${v.camShown}, przycisk kamery=${v.btn}`);
  if (!v.open) fail.push('tryb głosowy się nie otworzył');
  if (v.camShown) fail.push('kamera włączyła się sama w trybie głosowym');
  if (!v.btn) fail.push('brak przycisku włączenia kamery');

  await page.click('#voice-cam-btn');
  await page.waitForTimeout(1500);
  const v2 = await page.evaluate(() => ({
    camShown: document.getElementById('voice-camera-wrap').style.display !== 'none',
    saved: localStorage.getItem('cosmos.voiceCam'),
  }));
  console.log(`   po kliknięciu: kamera=${v2.camShown}, zapamiętane=${v2.saved}`);
  if (!v2.camShown) fail.push('przycisk nie włączył kamery');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ---- 7. mobile: panel boczny ----
  // osobny kontekst z dotykiem — bez tego `@media (hover: none)` nie zadziała
  const mctx = await browser.newContext({
    viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true,
    permissions: ['microphone', 'camera'],
  });
  const m = await mctx.newPage();
  await m.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(600);
  // kilka rozmów, żeby lista miała co pokazywać
  await m.evaluate(() => {
    const convs = Array.from({ length: 8 }, (_, i) => ({
      id: 'c' + i, title: 'Rozmowa testowa numer ' + (i + 1), messages: [], updated: Date.now() - i * 1000,
    }));
    localStorage.setItem('cosmos.conversations', JSON.stringify(convs));
  });
  await m.reload({ waitUntil: 'networkidle' });
  await m.waitForTimeout(600);
  await m.evaluate(() => {
    document.querySelector('.app').classList.remove('sidebar-hidden');
    document.querySelector('.sidebar').classList.remove('collapsed');
  });
  await m.waitForTimeout(600);
  const sb = await m.evaluate(() => {
    const list = document.querySelector('.conversations');
    const foot = document.querySelector('.sidebar-footer');
    const items = [...document.querySelectorAll('.conv-item')];
    const acts = items[0] ? [...items[0].querySelectorAll('.conv-action, .conv-delete')] : [];
    const visible = items.filter((it) => {
      const r = it.getBoundingClientRect();
      const lr = list.getBoundingClientRect();
      return r.top >= lr.top - 1 && r.bottom <= lr.bottom + 1;
    }).length;
    return {
      listH: Math.round(list.getBoundingClientRect().height),
      footH: Math.round(foot.getBoundingClientRect().height),
      vh: window.innerHeight,
      items: items.length, visible,
      actsShown: acts.filter((a) => getComputedStyle(a).display !== 'none').length,
      actsTotal: acts.length,
      obszarow: [...document.querySelectorAll('#sidebar *')].filter((e) =>
        e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY)).length,
      zmyslyWidac: (() => {
        const sc = document.querySelector('.sidebar-scroll');
        sc.scrollTop = sc.scrollHeight;
        const r = document.getElementById('status-senses').getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      })(),
    };
  });
  console.log(`7. panel boczny 360×740: lista ${sb.listH}px (${sb.visible}/${sb.items} rozmów widocznych), `
    + `stopka ${sb.footH}px z ${sb.vh}px, obszarów przewijania ${sb.obszarow}, „Zmysły" widać=${sb.zmyslyWidac}`);
  console.log(`   przyciski rozmowy widoczne bez najechania: ${sb.actsShown}/${sb.actsTotal}`);
  if (sb.visible < 3) fail.push(`lista rozmów za niska — widać tylko ${sb.visible}`);
  // Po przejściu na JEDEN obszar przewijania stopka jest wysoka z założenia —
  // liczy się tylko to, czy da się do niej dojechać (o to szła skarga).
  if (sb.obszarow !== 1) fail.push(`obszarów przewijania: ${sb.obszarow}, ma być 1`);
  if (!sb.zmyslyWidac) fail.push('nie da się dojechać do „Zmysłów”');
  if (sb.actsShown !== sb.actsTotal) fail.push('przyciski rozmowy niewidoczne na dotyku');
  await m.screenshot({ path: SHOT + '/fix-sidebar.png' });

  // ---- 8. mobile: brak poziomego przepełnienia w ustawieniach ----
  await m.keyboard.press('Escape');
  await m.waitForTimeout(300);
  await m.evaluate(() => openSettings());
  await m.waitForTimeout(1500);
  const st = await m.evaluate(() => {
    const modal = document.querySelector('#settings-modal .modal') || document.querySelector('#settings-modal');
    const over = [...modal.querySelectorAll('*')].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.right > window.innerWidth + 1;
    }).map((n) => (n.id || n.className || n.tagName).toString().slice(0, 30));
    return { overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, over: over.slice(0, 5) };
  });
  console.log(`8. ustawienia na 360px: scroll X=${st.overflowX}, elementy poza ekranem: ${st.over.length ? st.over.join(', ') : 'brak'}`);
  if (st.over.length) fail.push('elementy ustawień wychodzą poza ekran: ' + st.over.join(', '));
  await m.screenshot({ path: SHOT + '/fix-settings.png' });

  if (alerts.length) console.log(`   (okienka alert: ${alerts.length} — ${alerts[0].slice(0, 60)})`);
  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nWSZYSTKO OK');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

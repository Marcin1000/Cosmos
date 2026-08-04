const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Panel boczny (jeden suwak, widoczny status), lista modeli na telefonie,
// dyktowanie bez urywania, czytanie długiego tekstu, przełącznik kamery.
const SHOT = process.env.SHOT_DIR;

(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const browser = await przegladarka({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const fail = [];

  // ---------- TELEFON ----------
  const mctx = await browser.newContext({
    viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true,
    permissions: ['microphone', 'camera'],
  });
  const m = await mctx.newPage();
  m.on('pageerror', (e) => fail.push('błąd JS: ' + e.message));
  await m.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await m.evaluate(() => {
    localStorage.setItem('cosmos.conversations', JSON.stringify(
      Array.from({ length: 10 }, (_, i) => ({
        id: 'c' + i, title: 'Rozmowa numer ' + (i + 1), messages: [], updated: Date.now() - i * 1000,
      }))));
  });
  await m.reload({ waitUntil: 'networkidle' });
  await m.waitForTimeout(700);
  await m.evaluate(() => {
    document.querySelector('.app').classList.remove('sidebar-hidden');
    document.querySelector('.sidebar').classList.remove('collapsed');
  });
  await m.waitForTimeout(500);

  // 1. jeden suwak, status widoczny po przewinięciu na dół
  const sb = await m.evaluate(() => {
    const scrollers = [...document.querySelectorAll('.sidebar *')].filter((n) => {
      const s = getComputedStyle(n);
      return /auto|scroll/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2;
    }).map((n) => n.className);
    const wrap = document.querySelector('.sidebar-scroll');
    wrap.scrollTop = wrap.scrollHeight;
    const senses = document.getElementById('status-senses').getBoundingClientRect();
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
    const items = [...document.querySelectorAll('.conv-item')];
    return {
      scrollers, n: scrollers.length,
      sensesVisible: senses.bottom <= sidebar.bottom + 1 && senses.top >= sidebar.top - 1 && senses.height > 0,
      sensesText: document.getElementById('status-senses').innerText.replace(/\s+/g, ' ').trim(),
      convs: items.length,
    };
  });
  console.log(`1. panel boczny: obszarów przewijania=${sb.n} (${sb.scrollers.join(', ') || '—'})`);
  console.log(`   po przewinięciu na dół „Zmysły" widoczne=${sb.sensesVisible} → „${sb.sensesText}"`);
  if (sb.n !== 1) fail.push(`${sb.n} suwaki w panelu bocznym zamiast jednego`);
  if (!sb.sensesVisible) fail.push('pasek „Zmysły" nadal nieosiągalny');

  // przewinięcie na górę pokazuje rozmowy w całości
  const top = await m.evaluate(() => {
    const wrap = document.querySelector('.sidebar-scroll');
    wrap.scrollTop = 0;
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
    const items = [...document.querySelectorAll('.conv-item')];
    const whole = items.filter((it) => {
      const r = it.getBoundingClientRect();
      return r.top >= sidebar.top - 1 && r.bottom <= sidebar.bottom + 1;
    }).length;
    // czy któryś wiersz jest przecięty krawędzią panelu
    const clipped = items.some((it) => {
      const r = it.getBoundingClientRect();
      return r.top < sidebar.bottom && r.bottom > sidebar.bottom && r.top > sidebar.top;
    });
    return { whole, total: items.length, clipped };
  });
  console.log(`2. rozmowy widoczne w całości: ${top.whole}/${top.total}, wiersz przecięty krawędzią=${top.clipped}`);
  if (top.whole < 4) fail.push(`za mało rozmów widocznych (${top.whole})`);
  await m.screenshot({ path: SHOT + '/fix2-sidebar.png' });

  // 3. lista modeli — krótkie etykiety na wąskim ekranie
  await m.keyboard.press('Escape');
  await m.evaluate(() => openSettings());
  await m.waitForTimeout(1200);
  const opts = await m.evaluate(async () => {
    await fetchModelsInto('cloud', el.modelSelectCloud, el.fetchModelsCloud);
    const s = document.getElementById('model-select-cloud');
    return {
      shown: s.style.display !== 'none',
      labels: [...s.options].slice(1, 5).map((o) => o.textContent),
      values: [...s.options].slice(1, 3).map((o) => o.value),
      longest: Math.max(...[...s.options].map((o) => o.textContent.length)),
    };
  });
  console.log(`3. lista modeli na 360px: najdłuższa etykieta ${opts.longest} zn.`);
  opts.labels.forEach((l) => console.log(`     „${l}"`));
  console.log(`   wartości (identyfikatory) zachowane: ${opts.values[0] || '—'}`);
  if (opts.longest > 48) fail.push(`etykieta modelu za długa na telefon (${opts.longest} zn.)`);
  if (!(opts.values[0] || '').includes('/')) fail.push('identyfikator modelu zgubiony w value');
  const all = await m.evaluate(() =>
    [...document.getElementById('model-select-cloud').options].slice(1).map((o) => o.textContent));
  const dup = all.filter((x, i) => all.indexOf(x) !== i);
  if (dup.length) fail.push('nierozróżnialne pozycje na liście modeli: ' + [...new Set(dup)].join(', '));
  await m.screenshot({ path: SHOT + '/fix2-models.png' });
  await m.keyboard.press('Escape');
  await m.waitForTimeout(300);

  // 4. przełącznik kamery używa exact, nie ideal
  const flip = await m.evaluate(async () => {
    const asked = [];
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => { asked.push(JSON.parse(JSON.stringify(c))); return real(c); };
    const realEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => {
      const d = await realEnum();
      return [...d, { kind: 'videoinput', deviceId: 'cam2', label: 'Kamera tylna', groupId: 'g2' }];
    };
    await openCamera();
    await new Promise((r) => setTimeout(r, 600));
    const before = localStorage.getItem('cosmos.cameraFacing');
    await flipCamera();
    await new Promise((r) => setTimeout(r, 600));
    return {
      before, after: localStorage.getItem('cosmos.cameraFacing'),
      asked, w: document.getElementById('camera-video').videoWidth,
    };
  });
  const flipReq = flip.asked[flip.asked.length - 1] || {};
  const usedExact = JSON.stringify(flipReq).includes('exact');
  console.log(`4. kamera: ${flip.before} → ${flip.after}, obraz ${flip.w}px`);
  console.log(`   żądanie przy przełączaniu: ${JSON.stringify(flipReq.video || flipReq)}`);
  if (!usedExact) fail.push('przełączanie nadal używa `ideal` — przeglądarka może to zignorować');
  if (flip.before === flip.after) fail.push('kierunek kamery się nie zmienił');
  if (!flip.w) fail.push('brak obrazu po przełączeniu');
  await m.keyboard.press('Escape');

  // ---------- WSPÓLNE: mowa ----------
  const speech = await m.evaluate(() => {
    const long = 'Zdanie pierwsze o czymś ważnym. ' .repeat(12)
      + 'A teraz bardzo długie zdanie bez kropki w środku, które ciągnie się i ciągnie, '
      + 'z przecinkami, ale bez końca, żeby sprawdzić cięcie po przecinku oraz po spacji, '
      + 'bo inaczej wyszłoby rozerwane słowo w połowie.';
    const parts = splitForSpeech(long);
    return {
      n: parts.length,
      longest: Math.max(...parts.map((p) => p.length)),
      joined: parts.join(' ').replace(/\s+/g, ' ').trim(),
      original: long.replace(/\s+/g, ' ').trim(),
      brokenWord: parts.some((p) => /\S$/.test(p) && !/[.!?…,;]$/.test(p) && p.length >= 180),
    };
  });
  console.log(`5. czytanie: ${speech.n} kawałków, najdłuższy ${speech.longest} zn.`);
  console.log(`   tekst zachowany w całości: ${speech.joined === speech.original}`);
  if (speech.longest > 185) fail.push(`kawałek za długi (${speech.longest}) — Chrome go utnie`);
  if (speech.joined !== speech.original) fail.push('cięcie zgubiło lub zmieniło tekst');
  if (speech.brokenWord) fail.push('rozerwane słowo na granicy kawałka');

  // 6. dyktowanie wznawia się, gdy przeglądarka sama zakończy sesję
  const dict = await m.evaluate(async () => {
    let started = 0;
    class FakeSR {
      constructor() { this.lang = ''; FakeSR.last = this; }
      start() { started++; }
      stop() { this.onend && this.onend(); }
    }
    window.SpeechRecognition = FakeSR;
    window.webkitSpeechRecognition = FakeSR;
    startBrowserRecognition();
    const afterStart = started;
    FakeSR.last.onend();                       // Chrome kończy sesję po pauzie
    await new Promise((r) => setTimeout(r, 500));
    const afterAuto = started;
    dictationWanted = false;                   // użytkownik klika „stop"
    FakeSR.last.onend();
    await new Promise((r) => setTimeout(r, 500));
    return { afterStart, afterAuto, afterStop: started };
  });
  console.log(`6. dyktowanie: start=${dict.afterStart}, po samoistnym końcu=${dict.afterAuto}, `
    + `po kliknięciu stop=${dict.afterStop}`);
  if (dict.afterAuto <= dict.afterStart) fail.push('dyktowanie nie wznawia się — urywa w połowie');
  if (dict.afterStop !== dict.afterAuto) fail.push('dyktowanie wznawia się mimo zatrzymania przez użytkownika');

  // 7. błąd nie-JSON pokazuje treść, nie „Unexpected token"
  const errMsg = await m.evaluate(async () => {
    const res = new Response('Internal Server Error', { status: 500 });
    const d = await readJsonSafe(res);
    return d.error;
  });
  console.log(`7. błąd nie-JSON: „${errMsg}"`);
  if (/Unexpected token|not valid JSON/i.test(errMsg)) fail.push('nadal bełkot o JSON zamiast treści błędu');
  if (!/Internal Server Error/.test(errMsg)) fail.push('treść błędu zgubiona');

  // ---------- PULPIT: brak regresji ----------
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await d.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await d.waitForTimeout(600);
  const desk = await d.evaluate(() => {
    const list = document.querySelector('.conversations');
    const foot = document.querySelector('.sidebar-footer');
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
    return {
      listScrolls: /auto|scroll/.test(getComputedStyle(list).overflowY),
      footBottom: Math.round(foot.getBoundingClientRect().bottom),
      sidebarBottom: Math.round(sidebar.bottom),
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  console.log(`8. pulpit: lista przewija się sama=${desk.listScrolls}, `
    + `stopka na dole (${desk.footBottom} vs ${desk.sidebarBottom}), scroll X=${desk.overflowX}`);
  if (!desk.listScrolls) fail.push('na pulpicie lista rozmów przestała się przewijać');
  if (Math.abs(desk.footBottom - desk.sidebarBottom) > 2) fail.push('stopka odkleiła się od dołu na pulpicie');
  if (desk.overflowX) fail.push('poziomy scroll na pulpicie');

  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nWSZYSTKO OK');
  await browser.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

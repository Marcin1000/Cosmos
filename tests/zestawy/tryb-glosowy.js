const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Tryb głosowy: JEDEN rozpoznawacz na sesję, brak trzymania mikrofonu,
// oraz przełączanie kamery, które najpierw zwalnia stary obiektyw.
(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const b = await przegladarka({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const ctx = await b.newContext({ viewport: { width: 400, height: 820 }, permissions: ['microphone', 'camera'] });
  const p = await ctx.newPage();
  const fail = [];
  p.on('pageerror', (e) => fail.push('błąd JS: ' + e.message));
  await p.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);

  // podstaw rozpoznawanie mowy i policz, ile razy przejmowany jest mikrofon
  await p.evaluate(() => {
    window.__stats = { created: 0, started: 0, gum: 0, audioGum: 0 };
    const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => {
      window.__stats.gum++;
      if (c && c.audio) window.__stats.audioGum++;
      return realGum(c);
    };
    class FakeSR {
      constructor() { window.__stats.created++; FakeSR.last = this; this.running = false; }
      start() { if (this.running) throw new Error('already started'); this.running = true; window.__stats.started++; }
      stop() { this.running = false; if (this.onend) this.onend(); }
      say(text, final = true) {
        if (!this.onresult) return;
        const r = [{ 0: { transcript: text }, isFinal: final, length: 1 }];
        r.resultIndex = 0;
        this.onresult({ results: Object.assign(r, { length: 1 }), resultIndex: 0 });
      }
    }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;
  });

  // podejrzyj, z czym wołane jest zadanie pytania — bez zgadywania po stanie
  await p.evaluate(() => {
    window.__asked = [];
    const real = window.handleVoiceQuery;
    window.handleVoiceQuery = (t) => { window.__asked.push(t); return real(t); };
  });
  await p.evaluate(() => enterVoiceMode());
  await p.waitForTimeout(800);
  let s = await p.evaluate(() => ({ ...window.__stats, state: voiceState, open: el.voiceOverlay.style.display !== 'none' }));
  console.log(`1. wejście w tryb głosowy: rozpoznawaczy=${s.created}, przejęć mikrofonu (getUserMedia audio)=${s.audioGum}`);
  if (!s.open) fail.push('tryb głosowy się nie otworzył');
  if (s.audioGum > 0) fail.push('Cosmos trzyma własny strumień mikrofonu — to blokuje rozpoznawanie na Androidzie');
  if (s.created !== 1) fail.push(`utworzono ${s.created} rozpoznawaczy zamiast jednego`);

  // wypowiedz słowo budzące
  await p.evaluate(() => window.SpeechRecognition.last.say('hej kosmos'));
  await p.waitForTimeout(400);
  s = await p.evaluate(() => ({ ...window.__stats, state: voiceState }));
  console.log(`2. po „hej kosmos": stan=${s.state}, rozpoznawaczy nadal=${s.created}`);
  if (s.state !== 'listening') fail.push(`słowo budzące nie przełączyło stanu (${s.state})`);
  if (s.created !== 1) fail.push('przejście wake→pytanie utworzyło nowy rozpoznawacz (dźwięk mikrofonu)');

  // zadaj pytanie, poczekaj na ciszę
  // zaraz po wypowiedzeniu — zanim odliczanie ciszy wyśle pytanie dalej
  const live = await p.evaluate(() => {
    window.SpeechRecognition.last.say('jaka jest pogoda');
    return { txt: el.voiceTranscript.textContent, heard: voiceHeard, deaf: voiceDeaf };
  });
  console.log(`3. w trakcie mówienia: transkrypcja=„${live.txt}", głuchy=${live.deaf}`);
  if (!/pogoda/.test(live.txt)) fail.push('pytanie nie trafiło do transkrypcji');
  if (live.deaf) fail.push('rozpoznawacz głuchy w trakcie słuchania');

  // po chwili ciszy pytanie ma pójść dalej i Cosmos ma przestać słuchać siebie
  await p.waitForTimeout(1800);
  s = await p.evaluate(() => ({ ...window.__stats, asked: window.__asked, heard: voiceHeard }));
  console.log(`   po ciszy: zadane pytania=${JSON.stringify(s.asked)}, bufor pusty=${!s.heard}`);
  if (!s.asked.some((x) => /pogoda/.test(x))) fail.push('cisza nie zakończyła pytania');
  if (s.heard) fail.push('bufor usłyszanego tekstu nie wyczyszczony');
  if (s.created !== 1) fail.push('pytanie utworzyło nowy rozpoznawacz');
  await p.waitForTimeout(1200);

  // Chrome ucina sesję — ma się wznowić TYM SAMYM sposobem, bez skoku licznika
  await p.evaluate(() => { const r = window.SpeechRecognition.last; r.onend && r.onend(); });
  await p.waitForTimeout(600);
  s = await p.evaluate(() => ({ ...window.__stats }));
  console.log(`4. po samoistnym końcu sesji: rozpoznawaczy=${s.created} (wznowienie jest nieuniknione)`);
  if (s.created > 2) fail.push('wznowienie tworzy więcej niż jeden nowy rozpoznawacz');

  // wyjście zamyka wszystko
  await p.evaluate(() => exitVoiceMode());
  await p.waitForTimeout(700);
  const after = await p.evaluate(() => ({ created: window.__stats.created, mode: voiceMode, rec: voiceRec }));
  console.log(`5. po wyjściu: tryb=${after.mode}, rozpoznawacz=${after.rec === null ? 'zwolniony' : 'NADAL ŻYJE'}`);
  if (after.mode) fail.push('tryb głosowy nie wyłączony');
  if (after.rec !== null) fail.push('rozpoznawacz nie zwolniony — mikrofon zostaje zajęty');

  // ---- kamera: najpierw zwolnij, potem otwórz ----
  const order = await p.evaluate(async () => {
    const events = [];
    const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      events.push('open');
      const s = await realGum(c);
      s.getTracks().forEach((tr) => {
        const stop = tr.stop.bind(tr);
        tr.stop = () => { events.push('stop'); stop(); };
      });
      return s;
    };
    const realEnum = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => [...(await realEnum()),
      { kind: 'videoinput', deviceId: 'cam2', label: 'Tylna', groupId: 'g2' }];
    await openCamera();
    await new Promise((r) => setTimeout(r, 500));
    events.length = 0;
    await flipCamera();
    await new Promise((r) => setTimeout(r, 600));
    return events;
  });
  console.log(`6. kolejność przy przełączaniu kamery: ${order.join(' → ')}`);
  if (order[0] !== 'stop') fail.push('nowy obiektyw otwierany przed zwolnieniem starego — „Could not start video source"');

  // przycisk przełączania po prawej, obok zamknięcia
  const pos = await p.evaluate(() => {
    const f = document.getElementById('camera-flip').getBoundingClientRect();
    const c = document.getElementById('camera-close').getBoundingClientRect();
    const h = document.querySelector('#camera-modal .modal-header').getBoundingClientRect();
    return { flipRight: Math.round(f.right), closeLeft: Math.round(c.left),
      gap: Math.round(c.left - f.right), headRight: Math.round(h.right),
      distFromEdge: Math.round(h.right - c.right) };
  });
  console.log(`7. przyciski nagłówka: odstęp przełącznik↔zamknij ${pos.gap}px, od krawędzi ${pos.distFromEdge}px`);
  if (pos.gap > 24) fail.push(`przełącznik oderwany od zamknięcia (${pos.gap}px) — ląduje na środku nagłówka`);
  await p.screenshot({ path: require('../pomoc').KATALOG_ZRZUTOW + '/voice-camera-header.png' });

  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nTRYB GŁOSOWY I KAMERA OK');
  await b.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

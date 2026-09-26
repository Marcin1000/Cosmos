/* Tryb głosowy: widać, że Cosmos słyszy, i widać słowa w trakcie mówienia.

   Zgłoszenie Marcina: „jak się mówi, to na żywo mają się pojawiać słowa, a jak
   skończę, to on to wyłapie i zacznie działać — bo tak nie wiadomo, czy to
   słyszy. Nie wiem, czy mam kliknąć kulę, czy od razu mówić. Mówię, ale on nic
   nie robi. Mówię kilka razy i może się uda."

   Mikrofon jest tu sztuczny i STEROWANY: ton z oscylatora, włączany
   i wyłączany z testu (`__mow(true|false)`). Atrapa rozpoznawania oddaje krótszy
   tekst dla krótkiego nagrania (podgląd w trakcie) i pełny dla całego.

     1. Po otwarciu: „słucham", a podpowiedź mówi, że nie trzeba nic klikać.
     2. Głos → od razu „słyszę cię" i kula idzie za poziomem mikrofonu.
     3. W trakcie mówienia pojawia się szkic słów (podgląd).
     4. Po ciszy: „rozpoznaję", potem pełne pytanie i odpowiedź.
     5. Dotknięcie kuli w trakcie odpowiedzi przerywa ją i od razu słucha.
     6. Zdanie zaczęte tuż przed końcem okna słuchania NIE jest ucinane.
*/
const http = require('node:http');
const { przegladarka, maPrzegladarke, serwerCosmosa, czekajNa, zabij } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

const PORT = 3473;
const problemy = [];
const ok = (warunek, opis) => {
  console.log(`${warunek ? 'OK ' : 'ZLE'} ${opis}`);
  if (!warunek) problemy.push(opis);
};

const zapytania = [];
const atrapa = http.createServer((req, res) => {
  const kawalki = [];
  req.on('data', (c) => kawalki.push(c));
  req.on('end', () => {
    const cialo = Buffer.concat(kawalki);
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"data":[{"id":"atrapa"}]}');
    }
    if (req.url.endsWith('/audio/transcriptions')) {
      // ~32 kB na sekundę nagrania (16 kHz, 16 bit). Krótkie = podgląd w trakcie.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ text: cialo.length < 70000 ? 'Jaka jutro' : 'Jaka jutro pogoda?' }));
    }
    if (req.url.endsWith('/audio/speech')) {
      // Wolny lektor: odpowiedź „mówi" kilka sekund, więc jest co przerwać.
      return setTimeout(() => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(10)); }, 6000);
    }
    if (req.url.endsWith('/chat/completions')) {
      const j = JSON.parse(cialo.toString() || '{}');
      const ostatnia = (j.messages || []).filter((m) => m.role === 'user').pop();
      zapytania.push(typeof ostatnia?.content === 'string' ? ostatnia.content : JSON.stringify(ostatnia?.content));
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Jutro będzie słonecznie."}}]}\n\n');
      return res.end('data: [DONE]\n\n');
    }
    res.writeHead(404); res.end('{}');
  });
});

/* Sztuczny mikrofon: oscylator 220 Hz przez wzmacniacz. Zero = cisza. */
const MIKROFON = () => {
  const oryginal = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  let wzmacniacz = null;
  window.__mow = (wlacz) => { if (wzmacniacz) wzmacniacz.gain.value = wlacz ? 0.35 : 0; };
  navigator.mediaDevices.getUserMedia = async (o) => {
    if (!o || !o.audio) return oryginal(o);
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 220;
    wzmacniacz = ctx.createGain();
    wzmacniacz.gain.value = 0;
    const cel = ctx.createMediaStreamDestination();
    osc.connect(wzmacniacz).connect(cel);
    osc.start();
    return cel.stream;
  };
};

(async () => {
  await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${atrapa.address().port}/v1`;
  const srv = serwerCosmosa(PORT, { NEMOTRON_BASE_URL: A, OPENAI_API_KEY: 'test', OPENAI_BASE_URL: A, SENSES_URL: 'http://127.0.0.1:1' });
  if (!(await czekajNa(`http://127.0.0.1:${PORT}/api/auth`))) throw new Error('serwer testowy nie wstał');

  const b = await przegladarka({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['microphone'] });
  const p = await ctx.newPage();
  const bledy = [];
  p.on('pageerror', (e) => bledy.push(e.message));
  await p.addInitScript(MIKROFON);
  await p.goto(`http://127.0.0.1:${PORT}/app`, { waitUntil: 'load' });
  await p.waitForFunction(() => Boolean(typeof serverConfig !== 'undefined' && serverConfig.glos && serverConfig.glos.sttChmura), null, { timeout: 8000 }).catch(() => {});

  const stan = () => p.evaluate(() => {
    const orb = document.getElementById('voice-orb');
    const tr = document.getElementById('voice-transcript');
    return {
      klasa: orb.className, podstan: orb.dataset.podstan || '',
      status: document.getElementById('voice-status').textContent,
      hint: document.querySelector('.voice-hint').textContent,
      tekst: tr.textContent, szkic: tr.classList.contains('podglad'),
      poziom: Number(getComputedStyle(document.getElementById('voice-overlay')).getPropertyValue('--poziom') || 0),
    };
  });
  const czekaj = async (warunek, ms) => {
    for (const koniec = Date.now() + ms; Date.now() < koniec;) {
      const s = await stan();
      if (warunek(s)) return s;
      await p.waitForTimeout(100);
    }
    return stan();
  };

  // 1. Otwarcie
  await p.click('#voice-btn');
  let s = await czekaj((x) => /listening/.test(x.klasa), 5000);
  ok(/listening/.test(s.klasa), `otwarcie → słucham (${s.klasa}, „${s.status}")`);
  ok(/nie trzeba/i.test(s.hint) && !/Hej, Cosmos/.test(s.hint), `podpowiedź: mów od razu, bez słowa budzącego („${s.hint.slice(0, 60)}…")`);

  // 2. Głos → słyszę
  await p.waitForTimeout(600);           // tło mikrofonu się ustala
  await p.evaluate(() => window.__mow(true));
  s = await czekaj((x) => x.podstan === 'slysze', 1500);
  ok(s.podstan === 'slysze' && /SŁYSZĘ/.test(s.status), `głos → „${s.status}" w mniej niż 1,5 s`);
  ok(s.poziom > 0.05, `kula idzie za poziomem mikrofonu (--poziom=${s.poziom})`);

  // 3. Szkic w trakcie mówienia
  s = await czekaj((x) => x.szkic && x.tekst, 3500);
  ok(s.szkic && s.tekst === 'Jaka jutro', `w trakcie mówienia widać szkic słów („${s.tekst}", szkic=${s.szkic})`);

  // 4. Cisza → rozpoznaję → pytanie i odpowiedź
  await p.waitForTimeout(600);
  await p.evaluate(() => window.__mow(false));
  s = await czekaj((x) => x.podstan === 'rozpoznaje' || !/listening/.test(x.klasa), 2500);
  ok(s.podstan === 'rozpoznaje' || !/listening/.test(s.klasa), `po ciszy: „${s.status}"`);
  s = await czekaj((x) => /speaking/.test(x.klasa), 8000);
  ok(zapytania[0] === 'Jaka jutro pogoda?', `do modelu poszło pełne pytanie („${zapytania[0]}")`);
  ok(!s.szkic, 'pytanie w dymku jest ostateczne, nie szkicem');
  ok(/speaking/.test(s.klasa) && /przerwać/i.test(s.hint), `odpowiedź czytana, podpowiedź mówi o przerwaniu („${s.hint}")`);

  // 5. Przerwanie dotknięciem kuli
  await p.click('#voice-orb');
  s = await czekaj((x) => /listening/.test(x.klasa), 1500);
  ok(/listening/.test(s.klasa), `dotknięcie kuli w trakcie odpowiedzi → od razu słucham (${s.klasa})`);

  // 6. Zdanie zaczęte tuż przed końcem okna (12 s) nie jest ucinane
  await p.waitForTimeout(10500);
  await p.evaluate(() => window.__mow(true));
  await p.waitForTimeout(3500);          // okno minęło w trakcie mówienia
  s = await stan();
  ok(/listening/.test(s.klasa), `12 s minęło w trakcie mówienia → dalej słucham (${s.klasa})`);
  await p.evaluate(() => window.__mow(false));
  await czekaj(() => zapytania.length >= 2, 6000);
  ok(zapytania.length >= 2, `zdanie z końca okna dotarło do modelu (zapytań: ${zapytania.length})`);

  ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  await b.close();
  zabij(srv); atrapa.close();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nGŁOS NA ŻYWO OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

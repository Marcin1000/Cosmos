const { srodowisko, przegladarka, maPrzegladarke, KORZEN } = require('../pomoc');
// Licznik czekania: pojawia się, gdy model milczy; znika, gdy zacznie pisać.
const http = require('http');

// atrapa: 3 sekundy ciszy, potem odpowiedź
/* Drugi scenariusz („licznik-myslenia” w pytaniu) – zrzut 4 Marcina: nagłówki od razu,
   JEDEN kawałek rozumowania i cisza. Licznik zerowany bez odmalowania stał
   wtedy zamrożony („czekam na odpowiedź modelu… 23 s” obok „Myślę…”) przez
   całe myślenie – to było „wisi po zdjęciach” (runda 10). */
const mock = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"data":[]}'); return;
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const tresc = (t) => res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n');
    if (/licznik-myslenia/.test(body)) {
      setTimeout(() => res.write('data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'Rozważam plan. ' } }] }) + '\n\n'), 1500);
      setTimeout(() => { tresc('Przemyślane.'); res.write('data: [DONE]\n\n'); res.end(); }, 7500);
      return;
    }
    setTimeout(() => {
      tresc('Gotowe po czekaniu.');
      res.write('data: [DONE]\n\n');
      res.end();
    }, 3500);
  });
});

mock.listen(7093, async () => {
  const { spawn } = require('child_process');
  const srv = spawn('node', ['server.js'], {
    cwd: KORZEN, stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3011', NVIDIA_API_KEY: 'test', NEMOTRON_BASE_URL: 'http://127.0.0.1:7093/v1' },
  });
  await new Promise((r) => setTimeout(r, 4000));

  const browser = await przegladarka();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const fail = [];
  page.on('pageerror', (e) => fail.push('błąd JS: ' + e.message));
  await page.goto('http://localhost:3011/app', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  await page.fill('#input', 'Czy możesz stworzyć grafikę z widokiem Dolomitów?');
  await page.click('#send-btn');

  await page.waitForTimeout(2200);
  const during = await page.evaluate(() => {
    const n = document.querySelector('.msg-assistant .wait-note');
    return { shown: !!n, text: n ? n.textContent : '' };
  });
  console.log(`1. w trakcie czekania: licznik=${during.shown} „${during.text}"`);
  if (!during.shown) fail.push('brak licznika czekania – pusty dymek jak przy zawieszeniu');
  if (!/\d+\s*s/.test(during.text)) fail.push('licznik nie pokazuje sekund');

  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.msg-assistant .msg-content')].pop();
    return { note: !!b.querySelector('.wait-note'), text: b.innerText.trim() };
  });
  console.log(`2. po odpowiedzi: licznik=${after.note}, treść „${after.text.slice(0, 40)}"`);
  if (after.note) fail.push('licznik został po nadejściu odpowiedzi');
  if (!/Gotowe po czekaniu/.test(after.text)) fail.push('brak odpowiedzi');

  /* 3. Samo myślenie: przez ciszę po pierwszym kawałku rozumowania na ekranie
     ma się coś zmieniać – żywe „Myślę… N s” – a nie zamrożona liczba. */
  await page.fill('#input', 'licznik-myslenia: rozważ ten plan');
  /* Każda klatka od kliknięcia (runda 11, P1): JEDEN wskaźnik naraz – wiersz
     stanu „Łączę z modelem…” od pierwszej chwili, NAD treścią, i nigdy razem
     z „Myślę…”. Próbki co sekundę nie łapały okna < 1 s z dwoma wskaźnikami. */
  await page.evaluate(() => {
    window.__klatki = [];
    const t0 = performance.now();
    const tik = () => {
      const b = document.querySelector('#messages .msg.nowa .msg-content');
      if (b) {
        const n = b.querySelector('.wait-note');
        window.__klatki.push({ ms: performance.now() - t0, nota: n ? n.textContent : '', mysle: Boolean(b.querySelector('.think-block')),
          nadTrescia: n ? Boolean(n.compareDocumentPosition(b.querySelector('.strumien-tresc')) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
          samKursor: Boolean(n && b.querySelector('.strumien-tresc > .cursor-blink, .strumien-tresc .cursor-blink')) });
      }
      if (window.__klatki.length < 4000) requestAnimationFrame(tik);
    };
    requestAnimationFrame(tik);
  });
  await page.click('#send-btn');
  await page.waitForFunction(() => /Rozważam/.test([...document.querySelectorAll('.msg-assistant .msg-content')].pop()?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const kl = await page.evaluate(() => window.__klatki);
  const pierwszaNota = kl.find((k) => k.nota);
  const dwa = kl.filter((k) => k.nota && k.mysle);
  const odDymka = pierwszaNota && kl.length ? pierwszaNota.ms - kl[0].ms : Infinity;
  console.log(`2b. klatek ${kl.length}; pierwszy wiersz stanu ${Math.round(odDymka)} ms po pojawieniu się dymka („${pierwszaNota ? pierwszaNota.nota : ''}”), dwa wskaźniki w ${dwa.length} klatkach`);
  if (odDymka > 300) fail.push('wiersz stanu nie stoi od pierwszej chwili (pusty dymek z kursorem)');
  if (pierwszaNota && !/^Łączę z modelem… \d+ s/.test(pierwszaNota.nota)) fail.push(`wiersz stanu nie mówi „Łączę z modelem…” („${pierwszaNota.nota}”)`);
  if (dwa.length) fail.push(`„Myślę…” i wiersz czekania naraz w ${dwa.length} klatkach`);
  if (kl.some((k) => k.nota && k.nadTrescia === false)) fail.push('wiersz stanu pod treścią, nie nad nią');
  if (kl.some((k) => k.samKursor)) fail.push('samotny kursor obok wiersza stanu (drugi wskaźnik)');
  const probka = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('.msg-assistant .msg-content')].pop();
    const s = b && b.querySelector('.think-block summary');
    return { podsumowanie: s ? s.textContent : '', nota: b && b.querySelector('.wait-note') ? b.querySelector('.wait-note').textContent : '' };
  });
  await page.waitForTimeout(1200);
  const p1 = await probka();
  await page.waitForTimeout(2200);
  const p2 = await probka();
  console.log(`3. samo myślenie: „${p1.podsumowanie}” → „${p2.podsumowanie}”, notka: „${p2.nota}”`);
  if (p1.podsumowanie === p2.podsumowanie && p1.nota === p2.nota) fail.push('przy samym myśleniu ekran stoi – licznik zamrożony, wygląda na zawieszenie');
  if (!/\d+\s*s/.test(p2.podsumowanie)) fail.push('przy samym myśleniu nagłówek nie liczy sekund („Myślę… N s”)');
  if (p2.nota) fail.push(`obok „Myślę…” wisi sprzeczna notka „${p2.nota}”`);
  await page.waitForFunction(() => /Przemyślane/.test([...document.querySelectorAll('.msg-assistant .msg-content')].pop()?.textContent || ''), null, { timeout: 10000 }).catch(() => {});

  await browser.close();
  try { process.kill(-srv.pid); } catch { /* już nie żyje */ }
  mock.close();
  console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nLICZNIK CZEKANIA OK');
  process.exit(fail.length ? 1 : 0);
});

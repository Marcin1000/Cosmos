const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Trzy błędy z prawdziwej listy Marcina:
//  1. raport wynosił identyfikator konta NVIDII do schowka,
//  2. modele wstające z zimnego startu były raportowane jako niedostępne,
//  3. embeddingi/OCR („404 page not found") lądowały w worku „niedostępne”,
//     choć część z nich Cosmos sam wykorzystuje.
const http = require('http');

const KONTO = 'LeJnCuVKFSUWaEmU-j4546SFuR2EU-IJTkbLwD78VKs';
let prob = 0;                       // ile razy odpytano „wolny" model
const LISTA = ['nvidia/nemotron-3-super-120b-a12b', 'nvidia/vl-8b',
  'meta/wolny-model', 'meta/zablokowany', 'nvidia/llama-nemotron-embed-1b-v2'];

const up = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: LISTA.map((id) => ({ id })) }));
  }
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const j = JSON.parse(b);
    const img = Array.isArray(j.messages[0].content);
    const bad = (code, msg) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: msg } }));
    };
    if (j.model === 'meta/zablokowany') {
      return bad(404, `Function 'abc-123': Not found for account '${KONTO}'`);
    }
    // zimny start: pierwsze żądanie wisi, drugie odpowiada
    if (j.model === 'meta/wolny-model') {
      prob++;
      if (prob === 1) return;               // brak odpowiedzi → przekroczenie czasu
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
    }
    if (img && j.model !== 'nvidia/vl-8b') {
      return bad(400, 'This model does not support image content type.');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
});

const check = async (model) => (await fetch('http://127.0.0.1:3060/api/models/check', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ endpoint: 'cloud', model }),
})).json();

up.listen(7105, async () => {
  const fail = [];
  const { spawn } = require('child_process');
  const srv = spawn('node', ['server.js'], { cwd: '/home/user/Bear', stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3060', NVIDIA_API_KEY: 'test',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:7105/v1' } });
  await new Promise((r) => setTimeout(r, 4500));

  // 1. identyfikator konta nie może wyjść z serwera
  let a = await check('meta/zablokowany');
  console.log(`1. odmowa dostępu → ${a.blad}`);
  if (a.blad.includes(KONTO)) fail.push('identyfikator konta wycieka w komunikacie');
  if (!/ukryte/.test(a.blad)) fail.push('nie oznaczył, że coś ukryto');
  if (!/Not found for account/.test(a.blad)) fail.push('zgubił sens komunikatu dostawcy');

  // 2. embeddingi: „inne przeznaczenie", nie „niedostępne" — i bez odpytywania
  const przed = prob;
  a = await check('nvidia/llama-nemotron-embed-1b-v2');
  console.log(`2. model embeddingów → inneZadanie=${a.inneZadanie}, rozmowa=${a.rozmowa}`);
  console.log(`   ${a.podpowiedz}`);
  if (!a.inneZadanie) fail.push('nie rozpoznał modelu o innym przeznaczeniu');
  if (a.niepewne) fail.push('oznaczył go jako niepewny');

  // 3. zimny start: jedna ponowna próba ma go uratować
  a = await check('meta/wolny-model');
  console.log(`3. zimny start → rozmowa=${a.rozmowa}, niepewne=${!!a.niepewne}, sond=${prob - przed}`);
  if (a.rozmowa !== true) fail.push('nie ponowił próby po przekroczeniu czasu');
  if (prob - przed < 2) fail.push('nie było ponownej próby');

  // 4. model, który naprawdę milczy → „niepewne", nie „niedostępny"
  prob = 0;                                  // znów pierwsza próba wisi
  const cichy = await check('meta/wolny-model');   // 1. wisi, 2. odpowiada → działa
  console.log(`4. drugi przebieg tego samego → rozmowa=${cichy.rozmowa}`);

  // ---- UI: pięć kategorii w raporcie ----
  const br = await przegladarka();
  const ctx = await br.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('http://127.0.0.1:3060/');
  await pg.evaluate(() => document.getElementById('settings-btn').click());
  await pg.waitForTimeout(400);
  await pg.evaluate(() => document.getElementById('fetch-models-cloud').click());
  await pg.waitForSelector('#check-all-cloud', { timeout: 15000 });
  await pg.evaluate(() => document.getElementById('check-all-cloud').click());
  await pg.waitForSelector('#copy-check-cloud', { timeout: 120000 });

  const marks = await pg.$$eval('#model-select-cloud option', (os) =>
    os.filter((o) => o.value).map((o) => `${[...o.textContent.trim()][0]} ${o.value}`));
  console.log('5. oznaczenia w liście:');
  marks.forEach((m) => console.log(`   ${m}`));
  if (!marks.some((m) => m.startsWith('⚙') && m.includes('embed'))) fail.push('embeddingi bez znaczka ⚙');
  if (!marks.some((m) => m.startsWith('✗') && m.includes('zablokowany'))) fail.push('brak ✗ przy niedostępnym');
  if (!marks.some((m) => m.startsWith('👁') && m.includes('vl-8b'))) fail.push('brak 👁 przy wizyjnym');

  await pg.evaluate(() => document.getElementById('copy-check-cloud').click());
  await pg.waitForTimeout(500);
  const txt = await pg.evaluate(() => navigator.clipboard.readText());
  console.log('6. raport w schowku:');
  console.log(txt.split('\n').map((l) => '     ' + l).join('\n'));
  if (txt.includes(KONTO)) fail.push('identyfikator konta trafia do schowka');
  if (!/INNE PRZEZNACZENIE/.test(txt)) fail.push('brak grupy „inne przeznaczenie”');
  if (!/NIE ZDĄŻYŁY/.test(txt)) fail.push('brak grupy „nie zdążyły odpowiedzieć”');

  if (errs.length) fail.push('błędy JS: ' + errs.join(' | '));
  await br.close();
  process.kill(-srv.pid); up.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKATEGORIE SPRAWDZANIA OK');
  process.exit(fail.length ? 1 : 0);
});

const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// „Sprawdź model": czy Cosmos umie sam ustalić, które modele naprawdę działają
// na tym koncie — i które z nich czytają obrazy.
const http = require('http');
const { spawn } = require('child_process');

const seen = [];   // co dostał dostawca
const LISTA = ['nvidia/nemotron-nano-9b-v2', 'nvidia/vl-8b', 'meta/zablokowany'];

const up = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: LISTA.map((id) => ({ id })) }));
  }
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const j = JSON.parse(b);
    const withImage = Array.isArray(j.messages[0].content);
    seen.push({ model: j.model, withImage, max_tokens: j.max_tokens, stream: j.stream });
    const bad = (code, msg) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: msg } }));
    };
    if (j.model === 'meta/zablokowany') {
      return bad(404, "Function 'meta/zablokowany' Not found for account.");
    }
    if (withImage && j.model !== 'nvidia/vl-8b') {
      return bad(400, 'This model does not support image content type.');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  });
});

const check = async (port, model) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/models/check`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', model }),
  });
  return { status: r.status, body: await r.json() };
};

up.listen(7101, async () => {
  const fail = [];
  const srv = spawn('node', ['server.js'], {
    cwd: '/home/user/Bear', stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: '3021', NVIDIA_API_KEY: 'test',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:7101/v1', NEMOTRON_MODEL: 'nvidia/nemotron-nano-9b-v2',
      LOCAL_BASE_URL: 'http://127.0.0.1:7101/v1' },
  });
  await new Promise((r) => setTimeout(r, 4000));

  // 1. model, który rozmawia, ale nie widzi
  let a = await check(3021, 'nvidia/nemotron-nano-9b-v2');
  console.log(`1. model tekstowy → rozmowa=${a.body.rozmowa} obrazy=${a.body.obrazy}`);
  if (a.body.rozmowa !== true) fail.push('nie rozpoznał działającej rozmowy');
  if (a.body.obrazy !== false) fail.push('przypisał wzrok modelowi bez wzroku');
  if (!/image content type/.test(a.body.bladObrazy || '')) fail.push('nie podał powodu braku wzroku');

  // 2. model wizyjny
  a = await check(3021, 'nvidia/vl-8b');
  console.log(`2. model wizyjny  → rozmowa=${a.body.rozmowa} obrazy=${a.body.obrazy}`);
  if (a.body.rozmowa !== true || a.body.obrazy !== true) fail.push('nie rozpoznał modelu wizyjnego');

  // 3. model, którego konto nie ma — i to jest właśnie sedno całej funkcji
  const przed = seen.length;
  a = await check(3021, 'meta/zablokowany');
  console.log(`3. model spoza konta → rozmowa=${a.body.rozmowa}`);
  console.log(`   powód: ${a.body.blad}`);
  if (a.body.rozmowa !== false) fail.push('nie wykrył braku dostępu');
  if (!/Not found for account/.test(a.body.blad || '')) fail.push('zgubił komunikat dostawcy');
  if (seen.length - przed !== 1) fail.push('próbował wzroku mimo braku dostępu — marnuje limit');

  // 4. sonda ma być najtańsza z możliwych
  const drogie = seen.filter((s) => s.max_tokens !== 1 || s.stream !== false);
  console.log(`4. sondy: ${seen.length}, wszystkie max_tokens=1 i bez strumienia: ${!drogie.length}`);
  if (drogie.length) fail.push('sonda nie jest najtańsza');

  // 5. brak modelu → czytelny błąd, nie wywrotka
  a = await check(3021, '   ');
  console.log(`5. puste pole → HTTP ${a.status}: ${a.body.error}`);
  if (a.status !== 400) fail.push('puste pole nie daje 400');

  // 5b. lokalny brak modelu → konkretna komenda, nie „HTTP 404"
  const r5 = await fetch('http://127.0.0.1:3021/api/models/check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'local', model: 'meta/zablokowany' }),
  }).then((x) => x.json());
  console.log(`5b. lokalny brak modelu → ${r5.podpowiedz}`);
  if (!/ollama pull meta\/zablokowany/.test(r5.podpowiedz || '')) fail.push('brak komendy ollama pull');

  // ---- UI ----
  const br = await przegladarka();
  const pg = await br.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto('http://127.0.0.1:3021/');
  await pg.click('#settings-btn');
  await pg.waitForTimeout(400);

  // 6. „Sprawdź" przy polu modelu
  await pg.fill('#set-model-cloud', 'nvidia/vl-8b');
  await pg.click('#check-model-cloud');
  await pg.waitForFunction(() => /obraz/i.test(document.getElementById('model-info-cloud')?.textContent || ''),
    null, { timeout: 15000 }).catch(() => {});
  let txt = await pg.textContent('#model-info-cloud');
  console.log(`6. przycisk „Sprawdź" → ${txt.trim().replace(/\s+/g, ' ').slice(0, 80)}`);
  if (!/dziala|działa/i.test(txt)) fail.push('UI nie pokazał wyniku sprawdzenia');

  // 7. „Sprawdź wszystkie" po pobraniu listy
  await pg.click('#fetch-models-cloud');
  await pg.waitForSelector('#check-all-cloud', { timeout: 15000 });
  await pg.click('#check-all-cloud');
  await pg.waitForFunction(() => /\d+\s*z\s*\d+|\d+\s*of\s*\d+/.test(
    document.getElementById('model-info-cloud')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  txt = await pg.textContent('#model-info-cloud');
  const marks = await pg.$$eval('#model-select-cloud option', (os) =>
    os.filter((o) => o.value).map((o) => `${[...o.textContent.trim()][0]} ${o.value}`));
  console.log(`7. „Sprawdź wszystkie" → ${txt.trim().replace(/\s+/g, ' ')}`);
  marks.forEach((m) => console.log(`   ${m}`));
  if (!marks.some((m) => m.startsWith('👁') && m.includes('vl-8b'))) fail.push('nie oznaczył modelu wizyjnego');
  if (!marks.some((m) => m.startsWith('✓') && m.includes('nano-9b'))) fail.push('nie oznaczył modelu tekstowego');
  if (!marks.some((m) => m.startsWith('✗') && m.includes('zablokowany'))) fail.push('nie oznaczył modelu bez dostępu');

  // 8. dwa przebiegi nie mnożą znaczków
  await pg.click('#check-all-cloud');
  await pg.waitForTimeout(3000);
  const dbl = await pg.$$eval('#model-select-cloud option', (os) =>
    os.filter((o) => /^[✗✓👁][\s\uD800-\uDFFF]*[✗✓👁]/u.test(o.textContent)
      || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/.test(o.textContent)).length);
  console.log(`8. drugi przebieg — podwojone znaczki: ${dbl}`);
  if (dbl) fail.push('znaczki się mnożą przy ponownym sprawdzeniu');

  if (errs.length) fail.push('błędy JS: ' + errs.join(' | '));
  await br.close();
  process.kill(-srv.pid); up.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nWSZYSTKO GRA');
  process.exit(fail.length ? 1 : 0);
});

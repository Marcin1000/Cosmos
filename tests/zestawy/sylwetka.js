// /api/pose istniał od dawna, ale nikt go nie wołał — MediaPipe liczył
// postawę w próżnię. Teraz pytanie o sylwetkę jest doklejone do pętli
// detekcji (gotowa klatka, rzadziej niż o obiekty) i trafia do kontekstu.
const { srodowisko, przegladarka } = require('../pomoc');

(async () => {
  const env = await srodowisko('zmysly');
  const fail = [];
  const b = await przegladarka({ args: ['--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ permissions: ['camera'] });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));

  const zadania = [];
  pg.on('request', (r) => { if (r.url().includes('/api/')) zadania.push(r.url().split('/api/')[1]); });

  await pg.goto(env.adres);
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.getElementById('live-btn').click());
  await pg.waitForTimeout(5000);

  // 1. pytamy o sylwetkę tylko wtedy, gdy w kadrze jest człowiek
  const ilePose = zadania.filter((u) => u.startsWith('pose')).length;
  const ileDetect = zadania.filter((u) => u.startsWith('detect')).length;
  console.log(`1. żądań detect: ${ileDetect}, pose: ${ilePose}`);
  if (!ilePose) fail.push('nigdy nie zapytał o sylwetkę');
  if (ilePose >= ileDetect) fail.push('pyta o sylwetkę tak często jak o obiekty — miało być rzadziej');

  // 2. wynik widać w panelu
  const status = await pg.textContent('#live-status');
  console.log(`2. status panelu: „${status.trim().slice(0, 80)}"`);
  if (!/sylwetka|stoi/.test(status)) fail.push('postawa nie pokazała się w panelu');

  // 3. trafia do kontekstu rozmowy jako zdarzenie
  const zdarzenia = await (await fetch(`${env.adres}/api/events`)).json();
  const sylwetki = (zdarzenia.events || []).filter((e) => e.type === 'sylwetka');
  console.log(`3. zdarzeń typu „sylwetka" u serwera: ${sylwetki.length}`
    + (sylwetki.length ? ` — „${sylwetki[0].summary}"` : ''));
  if (!sylwetki.length) fail.push('postawa nie trafiła do kontekstu percepcji');

  // 4. ta sama postawa nie zasypuje dziennika w kółko
  if (sylwetki.length > 2) fail.push(`powtarza tę samą postawę ${sylwetki.length} razy`);

  if (errs.length) fail.push('błędy JS: ' + errs.join(' | '));
  await b.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nSYLWETKA OK');
  process.exit(fail.length ? 1 : 0);
})();

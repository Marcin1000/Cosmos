const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Wynik sprawdzenia musi dać się wynieść na zewnątrz: przy stu pozycjach
// nikt nie przepisze listy ręcznie, a znaczki znikają po odświeżeniu strony.

(async () => {
  const env = await srodowisko('katalogModeli');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const fail = [];
  const br = await przegladarka();
  const ctx = await br.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(e.message));
  await pg.goto(`${ADRES}/`);
  await pg.click('#settings-btn');
  await pg.waitForTimeout(400);

  await pg.click('#fetch-models-cloud');
  await pg.waitForSelector('#check-all-cloud', { timeout: 15000 });
  await pg.click('#check-all-cloud');
  await pg.waitForSelector('#copy-check-cloud', { timeout: 60000 });
  console.log('1. po sprawdzeniu pojawia się przycisk kopiowania: true');

  await pg.click('#copy-check-cloud');
  await pg.waitForTimeout(600);
  const label = await pg.textContent('#copy-check-cloud');
  const txt = await pg.evaluate(() => navigator.clipboard.readText());
  console.log(`2. etykieta po kliknięciu: „${label.trim()}"`);
  console.log('3. schowek:');
  console.log(txt.split('\n').map((l) => '     ' + l).join('\n'));

  if (!/Skopiowano/.test(label)) fail.push('przycisk nie potwierdził skopiowania');
  if (!/ROZMOWA \+ OBRAZY \(1\)/.test(txt)) fail.push('brak grupy z obrazami');
  if (!/SAMA ROZMOWA \(2\)/.test(txt)) fail.push('brak grupy z samą rozmową');
  if (!/NIEDOSTĘPNE \(3\)/.test(txt)) fail.push('brak grupy niedostępnych');
  if (!/Not found for account/.test(txt)) fail.push('zgubił powód odmowy');
  if (!/Działa 3 z 6/.test(txt)) fail.push('brak podsumowania');
  if (!/nvidia\/vl-8b/.test(txt)) fail.push('brak identyfikatorów modeli');

  // 4. etykieta wraca, żeby dało się skopiować drugi raz
  await pg.waitForTimeout(2600);
  const back = await pg.textContent('#copy-check-cloud');
  console.log(`4. etykieta wraca po chwili: „${back.trim()}"`);
  if (/Skopiowano/.test(back)) fail.push('etykieta nie wróciła — drugi raz nie wiadomo, czy zadziałało');

  // 5. bez uprawnień do schowka (stary WebView na Androidzie) — droga zapasowa
  const ctx2 = await br.newContext();
  const pg2 = await ctx2.newPage();
  await pg2.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { get: () => undefined, configurable: true });
  });
  await pg2.goto(`${ADRES}/`);
  await pg2.click('#settings-btn');
  await pg2.waitForTimeout(300);
  await pg2.click('#fetch-models-cloud');
  await pg2.waitForSelector('#check-all-cloud', { timeout: 15000 });
  await pg2.click('#check-all-cloud');
  await pg2.waitForSelector('#copy-check-cloud', { timeout: 60000 });
  // strona sama ma pola tekstowe — liczy się RÓŻNICA, nie wartość bezwzględna
  const przed = await pg2.$$eval('textarea', (ts) => ts.length);
  await pg2.click('#copy-check-cloud');
  await pg2.waitForTimeout(600);
  const l2 = await pg2.textContent('#copy-check-cloud');
  const leftover = (await pg2.$$eval('textarea', (ts) => ts.length)) - przed;
  console.log(`5. bez navigator.clipboard: „${l2.trim()}", <textarea> przed=${przed}, dołożonych=${leftover}`);
  if (/Nie udało/.test(l2)) fail.push('droga zapasowa nie zadziałała');
  if (leftover) fail.push('zostawia śmieci w DOM');

  if (errs.length) fail.push('błędy JS: ' + errs.join(' | '));
  await br.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKOPIOWANIE WYNIKU OK');
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

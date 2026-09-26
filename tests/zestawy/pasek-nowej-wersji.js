/* Pasek „Jest nowa wersja" nie może przykrywać pola wiadomości.

   Po każdym wdrożeniu (nowa wersja pamięci podręcznej PWA) aplikacja otwarta
   w tle pokazuje pasek z „Odśwież". Stał na dole, dokładnie tam, gdzie pole
   wiadomości: na telefonie zasłaniał wpisywany tekst i przyciski między
   aparatem a „Wyślij", na komputerze — dolną połowę pola. Bez zamknięcia,
   więc wisiał do przeładowania (zespół IT, płynność, runda 4).

   Co musi być prawdą, na telefonie (390) i komputerze (1440):
     1. Po zmianie wersji (controllerchange przy stronie już kontrolowanej
        przez service workera) pasek się pojawia.
     2. Nie nachodzi na pole wiadomości ani na jego przyciski.
     3. „Później" go zamyka, a strona się nie przeładowuje. */
const { serwerCosmosa, czekajNa, zabij, przegladarka, maPrzegladarke } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

const PORT = 3483;
const ADRES = `http://127.0.0.1:${PORT}`;
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

(async () => {
  const srv = serwerCosmosa(PORT, { EMBED_PROVIDER: 'off', SENSES_URL: 'http://127.0.0.1:9' });
  if (!(await czekajNa(`${ADRES}/api/auth`))) { zabij(srv); throw new Error('serwer testowy nie wstał'); }
  const b = await przegladarka();

  for (const [nazwa, viewport, mobile] of [['telefon', { width: 390, height: 844 }, true], ['komputer', { width: 1440, height: 900 }, false]]) {
    const ctx = await b.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
    const p = await ctx.newPage();
    await p.goto(`${ADRES}/app`, { waitUntil: 'load' });
    // Pierwsze wejście instaluje service workera; drugie jest już przez niego kontrolowane.
    await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 15000 });
    await p.waitForSelector('.app.gotowa', { timeout: 15000 }).catch(() => {});
    // Nowa wersja przejęła stronę — tak, jak po wdrożeniu z podniesionym CACHE.
    await p.evaluate(() => { window.__bezPrzeladowania = true; navigator.serviceWorker.dispatchEvent(new Event('controllerchange')); });
    const jest = await p.waitForSelector('#nowa-wersja', { timeout: 5000 }).then(() => true).catch(() => false);
    ok(jest, `${nazwa}: po zmianie wersji pojawia się pasek`);
    if (jest) {
      const g = await p.evaluate(() => {
        const r = (el) => el && el.getBoundingClientRect();
        const pasek = r(document.getElementById('nowa-wersja'));
        // Pole wiadomości razem z przyciskami (aparat, mikrofon, „Wyślij").
        const kompozytor = r(document.getElementById('composer'));
        const nachodzi = !(pasek.bottom <= kompozytor.top || pasek.top >= kompozytor.bottom
          || pasek.right <= kompozytor.left || pasek.left >= kompozytor.right);
        return { pasek: [Math.round(pasek.top), Math.round(pasek.bottom)], kompozytor: [Math.round(kompozytor.top), Math.round(kompozytor.bottom)], nachodzi };
      });
      ok(!g.nachodzi, `${nazwa}: pasek (y ${g.pasek.join('–')}) nie przykrywa pola wiadomości (y ${g.kompozytor.join('–')})`);
      await p.click('#nowa-wersja .nowa-wersja-pozniej');
      const zamkniety = await p.evaluate(() => !document.getElementById('nowa-wersja') && window.__bezPrzeladowania === true);
      ok(zamkniety, `${nazwa}: „Później" zamyka pasek bez przeładowania strony`);
    }
    await ctx.close();
  }

  await b.close();
  zabij(srv);
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nPASEK NOWEJ WERSJI OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

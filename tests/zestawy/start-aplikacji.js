/* Start aplikacji i jej aktualizacja — bez skoków układu i bez zasłaniania.

   A. SKOK UKŁADU PRZY STARCIE. Zakładki silników budują się dopiero po
   sprawdzeniu sesji, a pusty pasek (10×10) rozpychał potem cały pasek górny:
   CLS 0,10–0,16 na komputerze i 0,05–0,11 na telefonie przy KAŻDYM starcie,
   do tego podpowiedzi skakały przy podmianie czcionki (zespół IT, płynność,
   runda 4). Miejsce na zakładki jest teraz zarezerwowane od pierwszej klatki,
   a czcionka ładowana z wyprzedzeniem. Co musi być prawdą: przy trzech
   kolejnych startach (z /api/config opóźnionym o 400 ms, jak przez tunel)
   suma przesunięć układu zostaje poniżej 0,02 — na 1440 i na 390 z CPU ×4.

   B. PASEK „JEST NOWA WERSJA". Po każdym wdrożeniu (nowa wersja pamięci podręcznej PWA) aplikacja otwarta
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
const PROG_CLS = 0.02;
const ADRES = `http://127.0.0.1:${PORT}`;
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

(async () => {
  const srv = serwerCosmosa(PORT, { EMBED_PROVIDER: 'off', SENSES_URL: 'http://127.0.0.1:9' });
  if (!(await czekajNa(`${ADRES}/api/auth`))) { zabij(srv); throw new Error('serwer testowy nie wstał'); }
  const b = await przegladarka();

  // --- A. skok układu przy starcie ---------------------------------------------------
  for (const [nazwa, opcje] of [['komputer', { viewport: { width: 1440, height: 900 } }],
    ['telefon', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }]]) {
    const ctx = await b.newContext({ ...opcje, serviceWorkers: 'block' });
    await ctx.addInitScript(() => {
      window.__przesuniecia = [];
      new PerformanceObserver((l) => l.getEntries().forEach((e) => {
        if (!e.hadRecentInput) window.__przesuniecia.push({ v: e.value, z: (e.sources || []).map((s) => (s.node && (s.node.id || s.node.className)) || '?').slice(0, 3).join('+') });
      })).observe({ type: 'layout-shift', buffered: true });
    });
    const p = await ctx.newPage();
    if (opcje.isMobile) await (await ctx.newCDPSession(p)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await p.route('**/api/config', async (r) => { await new Promise((x) => setTimeout(x, 400)); r.continue(); });
    const sumy = [];
    let najgorsze = '';
    for (let i = 1; i <= 3; i++) {
      if (i === 1) await p.goto(`${ADRES}/app`, { waitUntil: 'load' }); else await p.reload({ waitUntil: 'load' });
      await p.waitForSelector('.app.gotowa', { timeout: 15000 }).catch(() => {});
      await p.waitForTimeout(1500);
      const ls = await p.evaluate(() => window.__przesuniecia);
      sumy.push(ls.reduce((a, x) => a + x.v, 0));
      const max = ls.reduce((m, x) => (x.v > m.v ? x : m), { v: 0, z: '' });
      if (max.v > 0.005) najgorsze = `${max.v.toFixed(3)} ${max.z}`;
    }
    ok(Math.max(...sumy) < PROG_CLS, `${nazwa}: przesunięcia układu przy starcie ${sumy.map((x) => x.toFixed(3)).join(' / ')} (próg ${PROG_CLS})${najgorsze ? ` — największe: ${najgorsze}` : ''}`);
    await ctx.close();
  }

  // --- B. pasek „Jest nowa wersja" ------------------------------------------------------
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
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nSTART APLIKACJI OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

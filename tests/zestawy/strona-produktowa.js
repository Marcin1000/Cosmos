/* Strona produktowa pod „/" i aplikacja pod „/app".
 *
 * Co musi być prawdą, żeby strona była wizytówką, a nie przeszkodą:
 *   1. „/" to strona, „/app" to Cosmos — i nic z aplikacji nie zgubiło się
 *      przy przeprowadzce (pliki ładowane ścieżkami bezwzględnymi).
 *   2. Stary link z zaproszeniem (/#zaproszenie=…) dalej otwiera formularz
 *      dołączenia — żaden wysłany link nie może przestać działać.
 *   3. Przełącznik PL/EN podmienia KAŻDY tekst. Brak angielskiego wpisu
 *      oznaczałby polskie zdanie w angielskiej wersji, a to wygląda gorzej niż
 *      literówka.
 *   4. Wybór języka przeżywa przeładowanie i jest wspólny z aplikacją.
 *   5. Telefon: bez poziomego przewijania w obu językach, na całej długości.
 *   6. Ograniczony ruch: wszystko widać od razu, rozmowa pokazowa jest pełna.
 *   7. Przełącznik silników w rozmowie pokazowej naprawdę przełącza.
 *   8. Zero błędów w konsoli.
 *   9. Układ nie skacze (CLS < 0,1), nawet gdy strona.js dochodzi 400 ms po
 *      stylach — tak jest w prawdziwej sieci, a lokalnie wyścig tego nie łapie.
 *  10. Bez JavaScriptu treść jest widoczna (czytniki, podgląd linku, NoScript).
 *  11. Angielski ma własny adres (/?lang=en), a „/” bez zapisanego wyboru
 *      zostaje po polsku także w angielskiej przeglądarce — inaczej robot
 *      en-US indeksuje angielski tekst pod polskim adresem. „Open Cosmos”
 *      z angielskiej strony otwiera aplikację po angielsku.
 *  12. Opisy dla czytnika i meta description też są tłumaczone.
 *  13. Skok do sekcji (link w menu, adres z #sekcją) trafia w jej początek.
 *      Sekcje poza ekranem nie liczą się przy starcie (content-visibility),
 *      więc ich wysokość jest do pierwszego narysowania szacowana — i skok
 *      „w ciemno" lądował o setki pikseli obok. */
const { srodowisko, przegladarka } = require('../pomoc');

(async () => {
  const env = await srodowisko('pelne');
  const b = await przegladarka();
  const problemy = [];
  const ok = (warunek, opis) => {
    console.log(`${warunek ? 'OK ' : 'ZLE'} ${opis}`);
    if (!warunek) problemy.push(opis);
  };
  const bledy = [];
  const nowaStrona = async (opcje = {}, sledzKonsole = true) => {
    const ctx = await b.newContext({ locale: 'pl-PL', ...opcje });
    const p = await ctx.newPage();
    if (sledzKonsole) p.on('pageerror', (e) => bledy.push(`pageerror: ${e.message}`));
    if (sledzKonsole) p.on('console', (m) => { if (m.type() === 'error') bledy.push(`console: ${m.text()}`); });
    return { ctx, p };
  };

  // --- 1. adresy ------------------------------------------------------------
  {
    const { ctx, p } = await nowaStrona({ viewport: { width: 1440, height: 900 } });
    await p.goto(env.adres + '/', { waitUntil: 'load' });
    ok(await p.locator('.hero-h').count() === 1, '„/" pokazuje stronę produktową');
    ok(await p.locator('#welcome, #login-overlay').count() === 0, '„/" nie ładuje aplikacji');

    for (const adres of ['/app', '/app/']) {
      await p.goto(env.adres + adres, { waitUntil: 'load' });
      await p.waitForSelector('#welcome', { state: 'attached' });
      const zaladowane = await p.evaluate(() => typeof window.utworzKonta === 'function' && typeof window.t === 'function');
      ok(zaladowane, `„${adres}" ładuje aplikację razem z jej skryptami`);
    }
    await ctx.close();
  }

  // --- 2. stary link z zaproszeniem -----------------------------------------
  {
    /* Zmyślony token: serwer słusznie odpowie 410, a aplikacja zapisze to
       w konsoli — tu liczy się tylko, dokąd prowadzi link. */
    const { ctx, p } = await nowaStrona({ viewport: { width: 1280, height: 800 } }, false);
    const token = 'x'.repeat(32);
    await p.goto(`${env.adres}/#zaproszenie=${token}`, { waitUntil: 'load' });
    await p.waitForURL(/\/app#zaproszenie=/, { timeout: 5000 }).catch(() => {});
    ok(p.url() === `${env.adres}/app#zaproszenie=${token}`, `stary link przekierowuje z tokenem → ${p.url()}`);
    await p.waitForSelector('#invite-overlay', { state: 'visible', timeout: 5000 }).catch(() => {});
    ok(await p.locator('#invite-overlay').isVisible(), 'po przekierowaniu widać formularz dołączenia');
    await ctx.close();
  }

  // --- 3–4. języki ----------------------------------------------------------
  {
    const { ctx, p } = await nowaStrona({ viewport: { width: 1440, height: 900 } });
    await p.goto(env.adres + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => !document.documentElement.classList.contains('czeka-na-jezyk'));
    ok(await p.evaluate(() => document.documentElement.lang) === 'pl', 'polska przeglądarka → strona po polsku');

    const polskie = await p.evaluate(() => [...document.querySelectorAll('[data-t]')].map((el) => [el.dataset.t, el.textContent.trim()]));
    const zbierzOpisy = () => p.evaluate(() => ({
      aria: [...document.querySelectorAll('[data-t-aria]')].map((el) => [el.dataset.tAria, el.getAttribute('aria-label')]),
      opis: document.querySelector('meta[name="description"]').content,
    }));
    const opisyPl = await zbierzOpisy();
    await p.click('[data-jezyk="en"]');
    await p.waitForFunction(() => document.documentElement.lang === 'en');
    const angielskie = await p.evaluate(() => [...document.querySelectorAll('[data-t]')].map((el) => [el.dataset.t, el.textContent.trim()]));
    /* Słowa, które w obu językach brzmią tak samo — i tylko one. */
    const TAKIE_SAME = new Set(['pm.w2']);   // „Routing"
    const bezTlumaczenia = polskie.filter(([k, tekst], i) => tekst && !TAKIE_SAME.has(k) && angielskie[i][1] === tekst).map(([k]) => k);
    ok(bezTlumaczenia.length === 0, `każdy tekst ma angielską wersję${bezTlumaczenia.length ? ' — brak: ' + [...new Set(bezTlumaczenia)].join(', ') : ''}`);
    ok(/One thread/.test(await p.textContent('.hero-h')), 'nagłówek po angielsku');
    ok(/one thread/i.test(await p.title()), 'tytuł karty po angielsku');
    const opisyEn = await zbierzOpisy();
    const ariaBez = opisyPl.aria.filter(([, pl], i) => !pl || pl === opisyEn.aria[i][1]).map(([k]) => k);
    ok(opisyPl.aria.length > 0 && ariaBez.length === 0, `opisy dla czytnika (aria-label) tłumaczone${ariaBez.length ? ' — brak: ' + ariaBez.join(', ') : ''}`);
    ok(opisyEn.opis && opisyEn.opis !== opisyPl.opis, 'meta description zmienia się na angielski');

    /* Adres „/” bez ?lang — język musi przyjść z zapisanego wyboru. */
    await p.goto(env.adres + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => !document.documentElement.classList.contains('czeka-na-jezyk'));
    ok(await p.evaluate(() => document.documentElement.lang) === 'en', 'angielski przeżywa przeładowanie');
    ok(await p.evaluate(() => localStorage.getItem('cosmos.lang')) === 'en', 'wybór zapisany pod tym samym kluczem co w aplikacji (cosmos.lang)');

    await p.click('[data-jezyk="pl"]');
    await p.waitForFunction(() => document.documentElement.lang === 'pl');
    ok(/Jedna rozmowa/.test(await p.textContent('.hero-h')), 'powrót na polski przywraca polski nagłówek');

    // --- 7. przełącznik silników
    await p.click('[data-silnik="claude"]');
    await p.waitForFunction(() => /claude/.test(document.querySelector('#pill-tekst').textContent), null, { timeout: 3000 }).catch(() => {});
    ok(/claude/.test(await p.textContent('#pill-tekst')), 'klik „Claude" przełącza model w rozmowie pokazowej');
    const ostatni = await p.evaluate(() => { const e = [...document.querySelectorAll('#czat-zywy .odp-silnik')].pop(); return e ? e.textContent : ''; });
    ok(ostatni === 'Claude', `następna odpowiedź przychodzi z wybranego silnika (${ostatni || 'brak'})`);
    ok(await p.getAttribute('[data-silnik="claude"]', 'aria-pressed') === 'true', 'przycisk silnika ma aria-pressed');
    await ctx.close();
  }

  // --- 5. telefon: bez poziomego przewijania --------------------------------
  for (const jezyk of ['pl', 'en']) {
    const { ctx, p } = await nowaStrona({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, locale: jezyk === 'en' ? 'en-US' : 'pl-PL' });
    await p.goto(env.adres + (jezyk === 'en' ? '/?lang=en' : '/'), { waitUntil: 'load' });
    await p.waitForFunction((j) => document.documentElement.lang === j, jezyk, { timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(400);
    const wysokosc = await p.evaluate(() => document.documentElement.scrollHeight);
    let najgorzej = 0;
    for (let y = 0; y <= wysokosc; y += 600) {
      await p.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y);
      await p.waitForTimeout(40);
      najgorzej = Math.max(najgorzej, await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
    }
    ok(najgorzej <= 0, `telefon 360 px (${jezyk}): brak poziomego przewijania (nadmiar ${najgorzej} px)`);
    await ctx.close();
  }

  // --- 6. ograniczony ruch --------------------------------------------------
  {
    const { ctx, p } = await nowaStrona({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await p.goto(env.adres + '/', { waitUntil: 'load' });
    await p.waitForTimeout(300);
    const ukryte = await p.evaluate(() => [...document.querySelectorAll('[data-pokaz]')].filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length);
    ok(ukryte === 0, `ograniczony ruch: treść widoczna bez przewijania (ukrytych: ${ukryte})`);
    const odpowiedzi = await p.locator('#czat-zywy .odp').count();
    ok(odpowiedzi === 4, `ograniczony ruch: rozmowa pokazowa pełna od razu (${odpowiedzi}/4)`);
    await ctx.close();
  }

  // --- 9. układ nie skacze, gdy skrypt przychodzi później ------------------
  for (const [opis, viewport, adres] of [['1440 PL', { width: 1440, height: 900 }, '/'], ['1366×768 PL', { width: 1366, height: 768 }, '/'], ['390 EN', { width: 390, height: 844 }, '/?lang=en']]) {
    const { ctx, p } = await nowaStrona({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    await p.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; }))
        .observe({ type: 'layout-shift', buffered: true });
    });
    /* Style i HTML od razu, skrypt 400 ms później — pierwsze malowanie
       następuje bez niego, więc wszystko, co skrypt dobudowuje, widać jako skok. */
    await p.route('**/strona/strona.js', async (r) => { await new Promise((z) => setTimeout(z, 400)); await r.continue(); });
    await p.goto(env.adres + adres, { waitUntil: 'load' });
    await p.waitForTimeout(2500);
    const cls = await p.evaluate(() => window.__cls);
    ok(cls < 0.1, `CLS ${opis} przy skrypcie spóźnionym o 400 ms: ${cls.toFixed(4)} (< 0,1)`);
    await ctx.close();
  }

  // --- 13. skok do sekcji trafia --------------------------------------------
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const { ctx, p } = await nowaStrona({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    const chybione = [];
    const gora = (id) => p.evaluate((i) => Math.round(document.getElementById(i).getBoundingClientRect().top), id);
    const padding = await (async () => { await p.goto(env.adres + '/', { waitUntil: 'load' }); return p.evaluate(() => parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0); })();
    // z menu: te same linki, które klika człowiek
    for (const id of ['prywatnosc', 'dostep', 'pamiec']) {
      await p.goto(env.adres + '/', { waitUntil: 'load' });
      await p.evaluate((i) => { location.hash = i; }, id);
      await p.waitForFunction((i) => Math.abs(document.getElementById(i).getBoundingClientRect().top - (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0)) < 4, id, { timeout: 4000 }).catch(() => {});
      const g = await gora(id);
      if (Math.abs(g - padding) > 4) chybione.push(`#${id} z menu: ${g}px`);
    }
    // wejście prosto z adresu
    await p.goto(env.adres + '/#prywatnosc', { waitUntil: 'load' });
    await p.waitForTimeout(800);
    const g = await gora('prywatnosc');
    if (Math.abs(g - padding) > 4) chybione.push(`/#prywatnosc z adresu: ${g}px`);
    ok(chybione.length === 0, `${viewport.width}px: skok do sekcji trafia w jej początek (${chybione.join(', ') || `wszystkie na ${padding}px`})`);
    await ctx.close();
  }

  // --- 10. bez JavaScriptu ----------------------------------------------------
  {
    const { ctx, p } = await nowaStrona({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false }, false);
    await p.goto(env.adres + '/', { waitUntil: 'load' });
    await p.waitForTimeout(300);
    const { ukryte, wszystkie } = await p.evaluate(() => {
      const bloki = [...document.querySelectorAll('[data-pokaz]')];
      return { wszystkie: bloki.length, ukryte: bloki.filter((el) => Number(getComputedStyle(el).opacity) < 1).length };
    });
    ok(wszystkie > 0 && ukryte === 0, `bez JavaScriptu treść widoczna (ukrytych ${ukryte}/${wszystkie})`);
    await ctx.close();
  }

  // --- 11. adres angielski i brak zgadywania po przeglądarce -----------------
  {
    const { ctx, p } = await nowaStrona({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    await p.goto(env.adres + '/', { waitUntil: 'load' });
    await p.waitForFunction(() => !document.documentElement.classList.contains('czeka-na-jezyk'));
    await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.documentElement.lang) === 'pl', 'angielska przeglądarka bez wyboru: „/” zostaje po polsku');
    ok(/Jedna rozmowa/.test(await p.textContent('.hero-h')), 'angielska przeglądarka bez wyboru: nagłówek po polsku');
    ok(await p.evaluate(() => localStorage.getItem('cosmos.lang')) === null, 'samo wejście niczego nie zapisuje za użytkownika');
    await ctx.close();
  }
  {
    const { ctx, p } = await nowaStrona({ viewport: { width: 1280, height: 800 } });
    await p.goto(env.adres + '/?lang=en', { waitUntil: 'load' });
    await p.waitForFunction(() => !document.documentElement.classList.contains('czeka-na-jezyk'));
    ok(await p.evaluate(() => document.documentElement.lang) === 'en', '/?lang=en: angielski od razu, także w polskiej przeglądarce');
    ok(/One thread/.test(await p.textContent('.hero-h')), '/?lang=en: nagłówek po angielsku');
    const kanon = await p.getAttribute('link[rel="canonical"]', 'href');
    ok(/[?&]lang=en/.test(kanon || ''), `/?lang=en: adres kanoniczny wskazuje wersję angielską (${kanon})`);
    await ctx.close();
  }
  {
    /* …ale „Open Cosmos" kliknięte na angielskiej stronie to już wybór:
       aplikacja ma przywitać po angielsku kogoś, kto przed chwilą czytał po
       angielsku. Konsoli tu nie śledzimy — to już aplikacja, nie strona. */
    const { ctx, p } = await nowaStrona({ viewport: { width: 1280, height: 800 } }, false);
    await p.goto(env.adres + '/?lang=en', { waitUntil: 'load' });
    await p.waitForFunction(() => !document.documentElement.classList.contains('czeka-na-jezyk'));
    ok(await p.evaluate(() => localStorage.getItem('cosmos.lang')) === null, '/?lang=en: samo wejście też niczego nie zapisuje');
    await Promise.all([p.waitForURL(/\/app\/?$/), p.locator('.js-wejscie:visible').first().click()]);
    const poAngielsku = await p.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 5000 })
      .then(() => true, () => false);
    ok(poAngielsku, `„Open Cosmos" z /?lang=en: aplikacja po angielsku (lang=${await p.evaluate(() => document.documentElement.lang)})`);
    await ctx.close();
  }

  // --- 8. konsola -----------------------------------------------------------
  ok(bledy.length === 0, `brak błędów w konsoli${bledy.length ? ':\n     ' + bledy.slice(0, 5).join('\n     ') : ''}`);

  await b.close();
  env.koniec();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nWszystko w porządku');
  process.exit(problemy.length ? 1 : 0);
})();

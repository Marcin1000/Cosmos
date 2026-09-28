/* Strona produktowa pod „/" i aplikacja pod „/app".
 *
 * Co musi być prawdą, żeby strona była wizytówką, a nie przeszkodą:
 *   1. „/" to strona, „/app" to Cosmos – i nic z aplikacji nie zgubiło się
 *      przy przeprowadzce (pliki ładowane ścieżkami bezwzględnymi).
 *   2. Stary link z zaproszeniem (/#zaproszenie=…) dalej otwiera formularz
 *      dołączenia – żaden wysłany link nie może przestać działać.
 *   3. Przełącznik PL/EN podmienia KAŻDY tekst. Brak angielskiego wpisu
 *      oznaczałby polskie zdanie w angielskiej wersji, a to wygląda gorzej niż
 *      literówka.
 *   4. Wybór języka przeżywa przeładowanie i jest wspólny z aplikacją.
 *   5. Telefon: bez poziomego przewijania w obu językach, na całej długości.
 *      Sam scrollWidth nie widzi elementu wystającego w lewo ani tekstu uciętego
 *      z boku przez sekcję z overflow: clip, więc sprawdzamy też krawędzie
 *      widocznych elementów.
 *   6. Ograniczony ruch: wszystko widać od razu, rozmowa pokazowa jest pełna.
 *   7. Przełącznik silników w rozmowie pokazowej naprawdę przełącza.
 *   8. Zero błędów w konsoli.
 *   9. Układ nie skacze (CLS < 0,1), nawet gdy strona.js dochodzi 400 ms po
 *      stylach – tak jest w prawdziwej sieci, a lokalnie wyścig tego nie łapie.
 *  10. Bez JavaScriptu treść jest widoczna (czytniki, podgląd linku, NoScript).
 *  11. Angielski ma własny adres (/?lang=en), a „/” bez zapisanego wyboru
 *      zostaje po polsku także w angielskiej przeglądarce – inaczej robot
 *      en-US indeksuje angielski tekst pod polskim adresem. „Open Cosmos”
 *      z angielskiej strony otwiera aplikację po angielsku.
 *  12. Opisy dla czytnika i meta description też są tłumaczone.
 *  13. Skok do sekcji (link w menu, adres z #sekcją) trafia w jej początek.
 *      Sekcje poza ekranem nie liczą się przy starcie (content-visibility),
 *      więc ich wysokość jest do pierwszego narysowania szacowana – i skok
 *      „w ciemno" lądował o setki pikseli obok.
 *  14. Rozmowa pokazowa: odpowiedź należy do klikniętego silnika, a nie do
 *      numeru kroku. Kliknięty OpenAI mówił „Przejrzane lokalnie – nic nie
 *      wyszło z komputera” – demo przeczyło obietnicy prywatności obok.
 *  15. Zmiana języka w połowie strony zostawia człowieka tam, gdzie czytał
 *      (dawniej nagłówek Pamięci lądował 430 px niżej).
 *  16. /?lang=en w SUROWYM HTML-u jest angielska: lang, canonical, og:*, tytuł,
 *      opis. Roboty i podgląd linku nie uruchamiają skryptów. Obie wersje mają
 *      własny ETag, a powrót na polski przywraca polską głowę.
 *  17. 320 i 343 px: przycisk wejścia w nawigacji mieści się na ekranie; 1024 i 768 px:
 *      podpowiedź „Read in English” nie zasłania przełącznika silników,
 *      a nazwa modelu w pigułce nie jest ucięta.
 *  18. „Cztery warstwy”: przy przewijaniu każda warstwa się podświetla, a jej
 *      płyta i opis są wtedy na ekranie razem (telefon i komputer).
 *  19. Pas znaczników leży NAD pionową nicią wątku (Marcin: „poziomy pasek
 *      wchodzi pod pasek pionowy”) – w punkcie przecięcia na wierzchu jest pas,
 *      a na zrzucie piksel pasa na linii nici jest taki sam jak 40 px obok
 *      (1366 i 1440 px, oba motywy). elementFromPoint nie widzi maski ani
 *      przezroczystego tła: maska krawędzi pasa pokazywała nić na 1320–1511 px.
 *  20. Kolor mieszany z var() (color-mix, gradient „in oklch”) stoi w @supports.
 *      Zapas „najpierw stara wartość, potem nowa” nie działa, gdy nowa ma var():
 *      stara przeglądarka (m.in. Firefox ESR 115) odrzuca ją dopiero przy
 *      liczeniu i bierze wartość początkową – „Każdy model.” w hero znikał.
 *  21. Ruter „Jedna rozmowa”: każda pastylka silnika cała w karcie i żadna nie
 *      nachodzi na inną – każdy stan (aktywna ma scale), oba języki, telefon
 *      320–560 px i szerszy, także z dłuższymi napisami. „Lokalny GPU” wychodził
 *      za kartę przy ~343 px (zrzut Marcina: telefon z powiększonym tekstem). */
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
       w konsoli – tu liczy się tylko, dokąd prowadzi link. */
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
    /* Słowa, które w obu językach brzmią tak samo – i tylko one. */
    const TAKIE_SAME = new Set(['pm.w2']);   // „Routing"
    const bezTlumaczenia = polskie.filter(([k, tekst], i) => tekst && !TAKIE_SAME.has(k) && angielskie[i][1] === tekst).map(([k]) => k);
    ok(bezTlumaczenia.length === 0, `każdy tekst ma angielską wersję${bezTlumaczenia.length ? ' – brak: ' + [...new Set(bezTlumaczenia)].join(', ') : ''}`);
    ok(/One thread/.test(await p.textContent('.hero-h')), 'nagłówek po angielsku');
    ok(/one thread/i.test(await p.title()), 'tytuł karty po angielsku');
    const opisyEn = await zbierzOpisy();
    const ariaBez = opisyPl.aria.filter(([, pl], i) => !pl || pl === opisyEn.aria[i][1]).map(([k]) => k);
    ok(opisyPl.aria.length > 0 && ariaBez.length === 0, `opisy dla czytnika (aria-label) tłumaczone${ariaBez.length ? ' – brak: ' + ariaBez.join(', ') : ''}`);
    ok(opisyEn.opis && opisyEn.opis !== opisyPl.opis, 'meta description zmienia się na angielski');

    /* Adres „/” bez ?lang – język musi przyjść z zapisanego wyboru. */
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

  // --- 5. telefon: bez poziomego przewijania (17: także 320 i 343 px) -------
  /* Sam scrollWidth przepuszcza dwie rzeczy: element wystający W LEWO (ujemny
     nadmiar nie wydłuża przewijania) i tekst ucięty z boku przez sekcję
     z overflow: clip (hero, karty) – nadmiaru nie ma, bo sekcja go zjada, a na
     ekranie brakuje końcówki zdania. Dlatego patrzymy na krawędzie elementów:
     - wystający poza ekran, chyba że obcina go przodek, który sam mieści się
       na ekranie (zorza w hero, dekoracje kart; body się nie liczy – jego
       overflow-x: clip niczego nie naprawia, tylko chowa),
     - element z własnym tekstem wystający w bok poza obcinającego przodka
       (poza pasem znaczników, który przesuwa się celowo). */
  const wystajacePozaEkran = () => {
    const vw = document.documentElement.clientWidth;
    const obcina = (el) => { const cs = getComputedStyle(el); return cs.overflowX !== 'visible' || cs.overflowY !== 'visible'; };
    const przewija = (el) => /auto|scroll/.test(getComputedStyle(el).overflowX);
    const maTekst = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    const opis = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '');
    const zle = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      if (zle.some((z) => z.el.contains(el))) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      let a = el.parentElement;
      while (a && a !== document.body && !obcina(a)) a = a.parentElement;
      const przodek = a && a !== document.body ? a : null;
      if (przodek && maTekst(el) && !przewija(przodek) && !el.closest('.pas')) {
        const ar = przodek.getBoundingClientRect(), ps = getComputedStyle(przodek);
        const bok = Math.max(ar.left + parseFloat(ps.borderLeftWidth) - r.left, r.right - (ar.right - parseFloat(ps.borderRightWidth)));
        if (bok > 1.5) { zle.push({ el, tekst: `${opis(el)} ucięty ${Math.round(bok)} px przez ${opis(przodek)}` }); continue; }
      }
      const wy = Math.max(r.right - vw, -r.left);
      if (wy <= 1) continue;
      let q = przodek, schowany = false;
      while (q && q !== document.body) {
        if (obcina(q)) { const qr = q.getBoundingClientRect(); if (qr.right <= vw + 1 && qr.left >= -1) { schowany = true; break; } }
        q = q.parentElement;
      }
      if (!schowany) zle.push({ el, tekst: `${opis(el)} ${Math.round(wy)} px poza ekranem` });
    }
    return zle.map((z) => z.tekst);
  };
  for (const [szer, jezyk] of [[360, 'pl'], [360, 'en'], [343, 'pl'], [343, 'en'], [320, 'pl'], [320, 'en']]) {
    const { ctx, p } = await nowaStrona({ viewport: { width: szer, height: 780 }, isMobile: true, hasTouch: true, locale: jezyk === 'en' ? 'en-US' : 'pl-PL' });
    await p.goto(env.adres + (jezyk === 'en' ? '/?lang=en' : '/'), { waitUntil: 'load' });
    await p.waitForFunction((j) => document.documentElement.lang === j, jezyk, { timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(400);
    const wysokosc = await p.evaluate(() => document.documentElement.scrollHeight);
    let najgorzej = 0;
    const wystajace = new Set();
    for (let y = 0; y <= wysokosc; y += 600) {
      await p.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y);
      await p.waitForTimeout(40);
      najgorzej = Math.max(najgorzej, await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
      for (const w of await p.evaluate(`(${wystajacePozaEkran})()`)) wystajace.add(w);
    }
    ok(najgorzej <= 0, `telefon ${szer} px (${jezyk}): brak poziomego przewijania (nadmiar ${najgorzej} px)`);
    ok(wystajace.size === 0, `telefon ${szer} px (${jezyk}): nic nie wystaje poza ekran ani nie jest ucięte z boku${wystajace.size ? ' – ' + [...wystajace].slice(0, 4).join('; ') : ''}`);
    await p.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    const przycisk = await p.evaluate(() => { const r = document.querySelector('.nav .js-wejscie').getBoundingClientRect(); return { l: r.left, p: r.right, w: document.documentElement.clientWidth }; });
    ok(przycisk.l >= 0 && przycisk.p <= przycisk.w, `telefon ${szer} px (${jezyk}): przycisk wejścia w nawigacji cały na ekranie (${Math.round(przycisk.l)}–${Math.round(przycisk.p)} z ${przycisk.w})`);
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
    /* Style i HTML od razu, skrypt 400 ms później – pierwsze malowanie
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
       angielsku. Konsoli tu nie śledzimy – to już aplikacja, nie strona. */
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

  // --- 14. rozmowa pokazowa: tekst należy do silnika -------------------------
  for (const ruch of ['no-preference', 'reduce']) {
    const { ctx, p } = await nowaStrona({ viewport: { width: 1280, height: 800 }, reducedMotion: ruch });
    await p.goto(env.adres + '/', { waitUntil: 'load' });
    /* Wzór: niewidoczny „duch” z index.html – pełna rozmowa, każda odpowiedź
       podpisana swoim silnikiem. Niezależny od skryptu, który ją odtwarza. */
    const norm = (t) => t.replace(/\s+/g, ' ').trim();
    const wzor = await p.evaluate(() => [...document.querySelectorAll('#czat-duch .odp')]
      .map((o) => [o.querySelector('.odp-silnik').textContent, o.querySelector('.odp-tekst').textContent]));
    const wzorMapa = Object.fromEntries(wzor.map(([s, t]) => [s, norm(t)]));
    /* Kolejność inna niż w autoodtwarzaniu, zaczynając od OpenAI – to on
       dostawał zdanie lokalnego GPU. Po każdym kliknięciu czekamy, aż
       odpowiedź się dopisze (silnik, który już mówił, zaczyna rundę od nowa). */
    const NAZWY = { cloud: 'NVIDIA Nemotron', local: 'Lokalny GPU', claude: 'Claude', openai: 'OpenAI' };
    const cudze = [];
    for (const s of ['openai', 'local', 'claude', 'cloud', 'openai']) {
      await p.click(`[data-silnik="${s}"]`);
      await p.waitForTimeout(ruch === 'reduce' ? 150 : 3200);
      const [podpis, tekst] = await p.evaluate(() => { const o = [...document.querySelectorAll('#czat-zywy .odp')].pop(); return [o.querySelector('.odp-silnik').textContent, o.querySelector('.odp-tekst').textContent]; });
      if (podpis !== NAZWY[s] || norm(tekst) !== wzorMapa[NAZWY[s]]) cudze.push(`${s} → ${podpis}: „${norm(tekst).slice(0, 44)}…”`);
    }
    ok(Object.keys(wzorMapa).length === 4 && cudze.length === 0,
      `rozmowa pokazowa (${ruch}): każdy kliknięty silnik mówi swoje zdanie${cudze.length ? ' – cudze: ' + cudze.join('; ') : ''}`);
    await ctx.close();
  }

  // --- 15. zmiana języka w połowie strony nie gubi miejsca ------------------
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const tel = viewport.width < 500;
    const { ctx, p } = await nowaStrona({ viewport, isMobile: tel, hasTouch: tel });
    await p.goto(env.adres + '/#pamiec', { waitUntil: 'load' });
    await p.waitForTimeout(900);
    const gora = () => p.evaluate(() => document.querySelector('#pamiec h2').getBoundingClientRect().top);
    const przed = await gora();
    /* Klik z DOM-u, nie p.click(): Playwright przed kliknięciem „przewija do”
       przyklejonej nawigacji i sam przesuwa stronę o kilkaset pikseli – człowiek
       stukający w PL/EN tego nie robi. */
    await p.evaluate(() => document.querySelector('[data-jezyk="en"]').click());
    await p.waitForFunction(() => document.documentElement.lang === 'en');
    await p.waitForTimeout(700);
    const po = await gora();
    /* Próg 24 px: przed poprawką nagłówek uciekał o ~184 px. Pod obciążeniem
       baterii zostaje kilka pikseli (fonty doładowują się po podmianie), co
       nie zmienia miejsca czytania; 8 px padało przy 8,3. */
    ok(Math.abs(po - przed) <= 24, `${viewport.width}px: zmiana języka w połowie strony zostawia nagłówek Pamięci na miejscu (${Math.round(przed)} → ${Math.round(po)} px)`);
    await ctx.close();
  }

  // --- 16. /?lang=en: angielska głowa w surowym HTML-u ------------------------
  {
    const pobierz = async (adres, naglowki = {}) => { const r = await fetch(env.adres + adres, { headers: naglowki }); return { r, html: await r.text() }; };
    const meta = (html, wzor) => ((html.match(wzor) || [])[1] || '');
    const en = await pobierz('/?lang=en');
    const pl = await pobierz('/');
    const opis = (h) => meta(h, /<meta name="description" content="([^"]*)"/);
    const sprawdz = {
      'lang="en"': /<html lang="en"/.test(en.html),
      canonical: meta(en.html, /<link rel="canonical" href="([^"]*)"/) === 'https://cosmosai.live/?lang=en',
      'og:url': meta(en.html, /<meta property="og:url" content="([^"]*)"/) === 'https://cosmosai.live/?lang=en',
      title: /one thread/i.test(meta(en.html, /<title[^>]*>([^<]*)<\/title>/)),
      description: /personal, hybrid AI system/.test(opis(en.html)),
      'og:title': /one thread/i.test(meta(en.html, /<meta property="og:title" content="([^"]*)"/)),
      'og:description': /personal, hybrid AI system/i.test(meta(en.html, /<meta property="og:description" content="([^"]*)"/)),
      'og:locale': meta(en.html, /<meta property="og:locale" content="([^"]*)"/) === 'en_GB'
        && meta(en.html, /<meta property="og:locale:alternate" content="([^"]*)"/) === 'pl_PL',
    };
    const zle = Object.entries(sprawdz).filter(([, v]) => !v).map(([k]) => k);
    ok(zle.length === 0, `/?lang=en: surowy HTML po angielsku${zle.length ? ' – po polsku: ' + zle.join(', ') : ' (lang, canonical, og:*, title, description)'}`);
    ok(/<html lang="pl"/.test(pl.html) && meta(pl.html, /<link rel="canonical" href="([^"]*)"/) === 'https://cosmosai.live/'
      && /jedna rozmowa/.test(meta(pl.html, /<title[^>]*>([^<]*)<\/title>/)), '„/”: surowy HTML zostaje polski');
    const etagEn = en.r.headers.get('etag');
    const etagPl = pl.r.headers.get('etag');
    const ponownie = await pobierz('/?lang=en', { 'If-None-Match': etagEn });
    const cudzy = await pobierz('/?lang=en', { 'If-None-Match': etagPl });
    ok(etagEn && etagPl && etagEn !== etagPl && ponownie.r.status === 304 && cudzy.r.status === 200,
      `/?lang=en: własny ETag (304 dla swojego, 200 dla polskiego; ${ponownie.r.status}/${cudzy.r.status})`);

    /* Powrót na polski w przeglądarce: głowa wraca do polskiej wersji, którą
       serwer odłożył do data-pl. */
    const { ctx, p } = await nowaStrona({ viewport: { width: 1280, height: 800 } });
    await p.goto(env.adres + '/?lang=en', { waitUntil: 'load' });
    await p.waitForFunction(() => !document.documentElement.classList.contains('czeka-na-jezyk'));
    await p.click('[data-jezyk="pl"]');
    await p.waitForFunction(() => document.documentElement.lang === 'pl');
    const glowa = await p.evaluate(() => ({
      tytul: document.title,
      kanon: document.querySelector('link[rel="canonical"]').href,
      og: document.querySelector('meta[property="og:title"]').content,
      opis: document.querySelector('meta[name="description"]').content,
      loc: document.querySelector('meta[property="og:locale"]').content,
    }));
    ok(/jedna rozmowa/.test(glowa.tytul) && glowa.kanon === 'https://cosmosai.live/' && /jedna rozmowa/.test(glowa.og)
      && glowa.opis === opis(pl.html) && glowa.loc === 'pl_PL', `/?lang=en → PL: głowa wraca do polskiej (${glowa.tytul}; ${glowa.kanon}; ${glowa.loc})`);
    await ctx.close();
  }

  // --- 17. 1024 i 768 px: podpowiedź języka i pigułka modelu -----------------
  for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }]) {
    const { ctx, p } = await nowaStrona({ viewport, locale: 'en-US' });
    await p.goto(env.adres + '/', { waitUntil: 'load' });
    await p.waitForSelector('#podpowiedz-jezyka:not([hidden])', { timeout: 3000 }).catch(() => {});
    const zakryte = await p.evaluate(() => {
      const pj = document.getElementById('podpowiedz-jezyka');
      if (pj.hidden) return null;
      const a = pj.getBoundingClientRect();
      return [...document.querySelectorAll('[data-silnik]')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.left < a.right && a.left < r.right && r.top < a.bottom && a.top < r.bottom;
      }).map((b) => b.dataset.silnik);
    });
    ok(Array.isArray(zakryte) && zakryte.length === 0, `${viewport.width} px: podpowiedź „Read in English” nie zasłania przełącznika silników${zakryte && zakryte.length ? ' – zasłania: ' + zakryte.join(', ') : zakryte ? '' : ' (podpowiedzi nie ma)'}`);
    await p.click('[data-silnik="local"]');
    await p.waitForFunction(() => /local/.test(document.querySelector('#pill-tekst').textContent), null, { timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(600);
    const pigulka = await p.evaluate(() => { const e = document.getElementById('pill-tekst'); return { tekst: e.textContent, sw: e.scrollWidth, cw: e.clientWidth }; });
    ok(pigulka.sw <= pigulka.cw + 1, `${viewport.width} px: nazwa modelu w pigułce cała („${pigulka.tekst}”, ${pigulka.sw}/${pigulka.cw} px)`);
    await ctx.close();
  }

  // --- 17. Cztery warstwy: podświetlona płyta i jej opis widać RAZEM ----------
  /* Marcin: „kiepsko działa część Cztery warstwy”. Pomiar agencji: na 360 px
     ani jedna klatka z 44 nie pokazywała naraz podświetlonej płyty i jej opisu,
     a na 1280 warstwa „Modele” nie była tak widoczna nigdy. Przewijamy sekcję
     krok po kroku i sprawdzamy dwie rzeczy: każda z czterech warstw choć raz
     świeci, i za każdym razem, gdy świeci, jej płyta i opis są na ekranie. */
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const { ctx, p } = await nowaStrona({ viewport, reducedMotion: 'no-preference' });
    // Wejście z menu („Jak to działa”): z kotwicą sekcje nad nią mają prawdziwą
    // wysokość (content-visibility), więc strona nie przesuwa się pod pomiarem.
    await p.goto(env.adres + '/#pod-maska', { waitUntil: 'load' });
    await p.waitForTimeout(400);
    for (let k = 0; k < 15; k++) {
      await p.evaluate(() => scrollBy({ top: document.querySelector('.przekroj-tor').getBoundingClientRect().top - innerHeight * 0.6, behavior: 'instant' }));
      await p.waitForTimeout(120);
    }
    const swiecily = new Set();
    let zlych = 0;
    for (let i = 0; i < 50; i++) {
      await p.evaluate(() => scrollBy({ top: 70, behavior: 'instant' }));
      await p.waitForTimeout(70);
      const stan = await p.evaluate(() => {
        const a = document.querySelector('.legenda li.aktywna');
        if (!a) return null;
        const plyta = document.querySelector(`.warstwa[data-w="${a.dataset.w}"]`);
        const naEkranie = (r) => r.top >= 56 && r.bottom <= innerHeight;
        return { w: a.dataset.w, razem: naEkranie(a.getBoundingClientRect()) && naEkranie(plyta.getBoundingClientRect()) };
      });
      if (!stan) continue;
      swiecily.add(stan.w);
      if (!stan.razem) zlych++;
    }
    ok(swiecily.size === 4, `${viewport.width} px: każda z czterech warstw choć raz się podświetla (${[...swiecily].sort().join(', ') || 'żadna'})`);
    ok(zlych === 0, `${viewport.width} px: podświetlona płyta i jej opis są na ekranie razem (klatek bez tego: ${zlych})`);
    await ctx.close();
  }

  // --- 19. pas znaczników nad nicią wątku ----------------------------------
  {
    const { ctx, p } = await nowaStrona({ viewport: { width: 1600, height: 900 } });
    await p.goto(`${env.adres}/`, { waitUntil: 'load' });
    await p.evaluate(() => document.querySelector('.pas').scrollIntoView({ block: 'center', behavior: 'instant' }));
    await p.waitForTimeout(300);
    const wynik = await p.evaluate(() => {
      const pas = document.querySelector('.pas').getBoundingClientRect();
      const nic = document.querySelector('.watek');
      if (!nic || getComputedStyle(nic).display === 'none') return { brakNici: true };
      // Nić ma pointer-events: none – bez tego elementFromPoint patrzyłby przez nią
      // i test przechodziłby bez względu na to, co jest narysowane na wierzchu.
      // Głowica celowo jedzie NAD pasem (środek okna), więc patrzymy obok niej.
      for (const e of [nic, ...nic.querySelectorAll('*')]) if (!e.matches('.watek-glowa')) e.style.pointerEvents = 'auto';
      const n = nic.getBoundingClientRect();
      const gl = document.querySelector('.watek-glowa').getBoundingClientRect();
      const x = n.left + n.width / 2;
      const y = Math.abs(pas.top + 4 - (gl.top + gl.height / 2)) > 12 ? pas.top + 4 : pas.bottom - 4;
      const el = document.elementFromPoint(x, y);
      return { naWierzchu: el ? (el.closest('.pas') ? 'pas' : (el.closest('.watek') ? 'nic' : el.className || el.tagName)) : '–' };
    });
    ok(!wynik.brakNici && wynik.naWierzchu === 'pas', `19. w przecięciu z nicią wątku na wierzchu jest pas znaczników (${wynik.naWierzchu || 'brak nici'})`);
    await ctx.close();
  }
  /* To, co NARYSOWANE: piksel pasa na linii nici i 40 px obok. Pas w górnej
     części okna (głowica jedzie środkiem i celowo leży nad pasem), próbka
     w odstępie nad tekstem, ziarno tła wyłączone. Nad pasem ta sama para
     pikseli MUSI się różnić – inaczej test nie widziałby nici w ogóle. */
  for (const motyw of ['light', 'dark']) {
    for (const szer of [1366, 1440]) {
      const { ctx, p } = await nowaStrona({ viewport: { width: szer, height: 900 }, colorScheme: motyw });
      await p.goto(`${env.adres}/`, { waitUntil: 'load' });
      await p.addStyleTag({ content: 'body::after { display: none !important; } .pas-tor { animation-play-state: paused !important; }' });
      await p.evaluate(() => {
        const r = document.querySelector('.pas').getBoundingClientRect();
        scrollBy({ top: r.top + r.height / 2 - innerHeight * 0.3, behavior: 'instant' });
      });
      await p.waitForTimeout(500);
      const g = await p.evaluate(() => {
        const r = document.querySelector('.pas').getBoundingClientRect();
        const n = document.querySelector('.watek').getBoundingClientRect();
        return { x: Math.round(n.left + n.width / 2), top: Math.round(r.top), h: Math.round(r.height) };
      });
      const zrzut = await p.screenshot({ clip: { x: g.x - 2, y: g.top - 20, width: 50, height: g.h + 40 } });
      const px = await p.evaluate(async ({ src, wPasie }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const k = c.getContext('2d');
        k.drawImage(img, 0, 0);
        const piksel = (x, y) => Array.from(k.getImageData(x, y, 1, 1).data.slice(0, 3));
        const roznica = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
        return { wPasie: roznica(piksel(2, wPasie), piksel(42, wPasie)), nadPasem: roznica(piksel(2, 10), piksel(42, 10)) };
      }, { src: 'data:image/png;base64,' + zrzut.toString('base64'), wPasie: 20 + 7 });
      ok(px.nadPasem > 30 && px.wPasie <= 8,
        `19. ${szer} px (${motyw}): nić nie prześwituje przez pas (różnica pikseli na nici i obok: ${px.wPasie} ≤ 8; nad pasem nić widać: ${px.nadPasem})`);
      await ctx.close();
    }
  }

  // --- 20. kolory mieszane z var() tylko za @supports -----------------------
  {
    const { ctx, p } = await nowaStrona({ viewport: { width: 1440, height: 900 } });
    await p.goto(`${env.adres}/`, { waitUntil: 'load' });
    const wynik = await p.evaluate(() => {
      const zle = [];
      // Deklaracje reguły, dzielone średnikiem poza nawiasami i cudzysłowami (data: URL).
      const deklaracje = (tekst) => {
        const wynik = [];
        let glebokosc = 0, cudzyslow = null, biezaca = '';
        for (const z of tekst) {
          if (cudzyslow) { biezaca += z; if (z === cudzyslow) cudzyslow = null; continue; }
          if (z === '"' || z === "'") { cudzyslow = z; biezaca += z; continue; }
          if (z === '(') glebokosc++;
          else if (z === ')') glebokosc--;
          if (z === ';' && glebokosc === 0) { wynik.push(biezaca.trim()); biezaca = ''; } else biezaca += z;
        }
        if (biezaca.trim()) wynik.push(biezaca.trim());
        return wynik;
      };
      const przejdz = (reguly, warunki) => {
        for (const r of reguly) {
          const w = r instanceof CSSSupportsRule ? `${warunki} ${r.conditionText}` : warunki;
          if (r.style) {
            for (const d of deklaracje(r.style.cssText)) {
              if (!/var\(/.test(d)) continue;
              const brak = (/color-mix\(/i.test(d) && !/color-mix/.test(w)) || (/\bin\s+oklch\b/i.test(d) && !/oklch/.test(w));
              if (brak) zle.push(`${r.selectorText || r.keyText || '?'} { ${d.slice(0, 60)}… }`);
            }
          }
          if (r.cssRules) przejdz(r.cssRules, w);
        }
      };
      let arkuszy = 0;
      for (const a of document.styleSheets) {
        let reguly;
        try { reguly = a.cssRules; } catch { continue; }
        arkuszy++;
        przejdz(reguly, '');
      }
      return { arkuszy, zle };
    });
    ok(wynik.arkuszy >= 2 && wynik.zle.length === 0,
      `20. każdy kolor mieszany z var() stoi w @supports (arkuszy: ${wynik.arkuszy}${wynik.zle.length ? '; poza @supports: ' + wynik.zle.slice(0, 5).join(' | ') : ''})`);
    await ctx.close();
  }

  // --- 21. ruter „Jedna rozmowa”: każda pastylka cała w karcie ----------------
  /* Węzeł środkowany na 83% szerokości wyjeżdżał za kartę (overflow: hidden) przy
     ~343 px. Sprawdzamy KAŻDY stan data-akt (aktywny ma scale), oba języki
     i podmienione dłuższe napisy – przyszły tekst nie może wypchnąć pastylki.
     Ograniczony ruch, żeby nie mierzyć w połowie przejścia. */
  for (const jezyk of ['pl', 'en']) for (const szer of [320, 343, 360, 390, 412, 430, 560, 600, 1440]) for (const dlugie of [false, true]) {
    const telefon = szer <= 560;
    const { ctx, p } = await nowaStrona({ viewport: { width: szer, height: 800 }, isMobile: telefon, hasTouch: telefon, reducedMotion: 'reduce' });
    await p.goto(`${env.adres}/?lang=${jezyk}`, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.addStyleTag({ content: '.router-wezel { transition: none !important; } .sekcja { content-visibility: visible !important; }' });
    if (dlugie) await p.evaluate(() => {
      const t = ['NVIDIA Cloud Nemotron', 'Local GPU at home (Ollama)', 'Claude by Anthropic', 'OpenAI GPT-5 family'];
      document.querySelectorAll('.router-wezel b').forEach((b, i) => { b.textContent = t[i]; });
    });
    const zle = await p.evaluate(() => {
      const router = document.querySelector('.router'), karta = router.closest('.karta');
      const k = karta.getBoundingClientRect(), bw = parseFloat(getComputedStyle(karta).borderLeftWidth);
      const bledy = [];
      for (const akt of ['0', '1', '2', '3']) {
        router.dataset.akt = akt;
        const w = [...router.querySelectorAll('.router-wezel')].map((e) => ({ n: e.querySelector('b').textContent, r: e.getBoundingClientRect() }));
        for (const { n, r } of w) {
          const wy = Math.max(k.left + bw - r.left, r.right - (k.right - bw), k.top + bw - r.top, r.bottom - (k.bottom - bw));
          if (wy > 0.5) bledy.push(`akt ${akt}: „${n}” ${Math.round(wy)} px poza kartą`);
        }
        for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) {
          const a = w[i].r, b = w[j].r;
          if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0) bledy.push(`akt ${akt}: „${w[i].n}” nachodzi na „${w[j].n}”`);
        }
      }
      return bledy;
    });
    ok(zle.length === 0, `21. ${szer} px ${jezyk}${dlugie ? ' (długie napisy)' : ''}: pastylki rutera całe w karcie i bez nachodzenia${zle.length ? ' – ' + zle.slice(0, 3).join('; ') : ''}`);
    await ctx.close();
  }

  // --- 8. konsola -----------------------------------------------------------
  ok(bledy.length === 0, `brak błędów w konsoli${bledy.length ? ':\n     ' + bledy.slice(0, 5).join('\n     ') : ''}`);

  await b.close();
  env.koniec();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nWszystko w porządku');
  process.exit(problemy.length ? 1 : 0);
})();

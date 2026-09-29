/* Zespół agentów w prawdziwej aplikacji – blok, przycisk, propozycja, bramka, ustawienia, głos.

   Serwer w trybie domowym (właściciel) z czterema silnikami na atrapie
   tests/atrapy/mock-zespol.js (7551–7554). Atrapa rozpoznaje planistę, role
   i prowadzącego po treści i zapisuje każde żądanie (/__stan).

   Gwarancje:
   P1. przycisk „Zespół” (aria-pressed) działa na jedną wiadomość; `zespol`
       idzie w JEDNYM żądaniu tury; w trakcie – blok z wierszami ról (silnik
       tekstem obok kropki), aria-live=off + osobny role=status z ogłoszeniami
       ≤ ról + 2; po `faza` blok zwinięty; w rozmowie notatki (DOKŁADNIE tekst,
       który dostał prowadzący) PRZED odpowiedzią, bez własnego dymka; na
       ekranie nigdy klucz narzedzie.zespol, <wklad ani „NOTATKI ZESPOŁU”;
   P2. następna tura dostaje notatki jako jedną linię (bez <wklad);
   P3. „Regeneruj” pod odpowiedzią zespołu = jedno żądanie do modelu (sam
       prowadzący), bez planisty i ról, bez pola `zespol`; notatki zostają;
   P4. Stop w fazie ról – prowadzący nie rusza; blok zostaje na ekranie;
   P5. „Proponuj, gdy warto”: linijka pod odpowiedzią solo; „Uruchom” =
       ta sama odpowiedź zespołem (jedno pytanie = jedna odpowiedź);
       „×” wycisza do końca rozmowy (bez planisty w następnych turach);
   P6. bramka zgody (lokalny prowadzący, rola w chmurze): skład przed startem,
       fokus zostaje w polu; „Tylko lokalnie” – zero żądań do chmury;
       rola na innym płatnym silniku przy „Pytaj przed startem” – bramka też;
   P7. telefon 358 px: bez przewijania w bok (blok, edycja składu), Start ≥ 44 px,
       edytor modelu jako arkusz od dołu, Escape zamyka;
   P8. telefon w poziomie 740×313: role jako pigułki w jednym rzędzie;
   P9. Ustawienia → Agenci po „Silnikach”; tryb zapisany na serwerze;
       „Wyłączony” chowa przycisk zespołu;
   P10. EN: blok i przycisk po angielsku;
   P11. tryb głosowy: kropki ról pod kulą, czytana tylko odpowiedź prowadzącego. */
const path = require('path');
const { ATRAPY, serwerCosmosa, uruchom, czekajNa, zwolnijPorty, przegladarka, wynik } = require('../pomoc');

const PORT = 3551;
const A = { cloud: 7551, local: 7552, openai: 7553, claude: 7554 };
const ADRES = `http://127.0.0.1:${PORT}`;
const w = wynik('zespol-w-przegladarce');
const ok = (warunek, opis) => { console.log(`${warunek ? '✓' : '✗'} ${opis}`); w.sprawdz(warunek, opis); return warunek; };
const spij = (ms) => new Promise((r) => setTimeout(r, ms));
const stanAtrapy = async () => (await (await fetch(`http://127.0.0.1:${A.cloud}/__stan`)).json()).zadania;
const zeruj = () => fetch(`http://127.0.0.1:${A.cloud}/__zeruj`);
const doModeli = (z) => z.filter((x) => x.rodzaj !== 'szukanie');

(async () => {
  await zwolnijPorty([PORT, ...Object.values(A)]);
  uruchom('node', [path.join(ATRAPY, 'mock-zespol.js')], { cwd: ATRAPY, env: { ...process.env, ZESPOL_PORTY: Object.values(A).join(',') } });
  await spij(600);
  serwerCosmosa(PORT, {
    NVIDIA_API_KEY: 'test-nvidia', LOCAL_API_KEY: 'test',
    NEMOTRON_BASE_URL: `http://127.0.0.1:${A.cloud}/v1`, NEMOTRON_MODEL: 'nvidia/nemotron-3-super-120b-a12b',
    LOCAL_BASE_URL: `http://127.0.0.1:${A.local}/v1`, LOCAL_MODEL: 'qwen3:14b',
    OPENAI_API_KEY: 'sk-openai-zespol-przegladarka-1', OPENAI_BASE_URL: `http://127.0.0.1:${A.openai}/v1`, OPENAI_MODEL: 'gpt-5-mini',
    ANTHROPIC_API_KEY: 'sk-ant-zespol-przegladarka-1', ANTHROPIC_BASE_URL: `http://127.0.0.1:${A.claude}/v1`, CLAUDE_MODEL: 'claude-sonnet-5',
    SEARCH_URL: `http://127.0.0.1:${A.cloud}/szukaj`, SENSES_URL: 'http://127.0.0.1:7559',
    COSMOS_BIEG_SIEROTA_MS: '1500',
  });
  if (!(await czekajNa(`${ADRES}/api/config`))) { w.zapisz('serwer nie wstał'); return w.zakoncz(); }
  const b = await przegladarka();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', locale: 'pl-PL' });
    // „Pytaj przed startem” wyłączone – bramkę płatnego silnika sprawdza P6 osobno.
    await ctx.addInitScript(() => {
      try {
        if (!localStorage.getItem('cosmos.settings')) localStorage.setItem('cosmos.settings', JSON.stringify({ zespolPotwierdzaj: false }));
        localStorage.setItem('cosmos.lang', localStorage.getItem('cosmos.lang') || 'pl');
      } catch { /* */ }
      // Ogłoszenia czytnika ekranu (region role=status w bloku).
      window.__ogloszenia = [];
      new MutationObserver((lista) => {
        for (const m of lista) {
          const cel = m.target.nodeType === 1 ? m.target : m.target.parentElement;
          if (cel && cel.classList && cel.classList.contains('zespol-sr') && cel.textContent) window.__ogloszenia.push(cel.textContent);
        }
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    const page = await ctx.newPage();
    const bledy = [];
    page.on('pageerror', (e) => bledy.push(e.message));
    const zadaniaCzatu = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/chat')) { try { zadaniaCzatu.push(JSON.parse(r.postData() || '{}')); } catch { /* */ } }
    });
    await page.goto(`${ADRES}/app`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const x = document.getElementById('zespol-btn'); return x && !x.hidden; }, null, { timeout: 15000 });
    const koniecTury = () => page.waitForFunction(() => !isGenerating, null, { timeout: 60000 });
    const wyslij = async (tekst) => { await page.fill('#input', tekst); await page.press('#input', 'Enter'); };
    const nowaRozmowa = async () => { await page.evaluate(() => newConversation()); await page.waitForTimeout(150); };
    const wiadomosci = () => page.evaluate(() => activeConversation.messages.map((m) => ({ role: m.role, narzedzie: m.narzedzie || '', search: Boolean(m.search),
      content: typeof m.content === 'string' ? m.content : '', silnik: m.silnik || '', wklady: m.zespol ? m.zespol.wklady.length : 0 })));
    const ekran = () => page.evaluate(() => document.getElementById('messages').innerText);

    // ---------------------------------------------------------------- P1
    await zeruj();
    zadaniaCzatu.length = 0;
    const btn = page.locator('#zespol-btn');
    ok(await btn.getAttribute('aria-pressed') === 'false', 'P1a. przycisk zespołu widoczny, niewciśnięty');
    await btn.click();
    ok(await btn.getAttribute('aria-pressed') === 'true' && await page.getAttribute('#input', 'placeholder') === 'Zadanie dla zespołu…',
      'P1b. wciśnięty: aria-pressed=true i podpowiedź „Zadanie dla zespołu…”');
    await wyslij('plan-kod rola-wolna:PROGRAMISTA napisz funkcję w pythonie');
    await page.waitForSelector('.zespol .rola[data-stan="pracuje"]', { timeout: 15000 });
    const praca = await page.evaluate(() => {
      const z = document.querySelector('.zespol');
      const wiersz = z.querySelector('.rola[data-stan="pracuje"]');
      return {
        stan: z.dataset.stan, live: z.getAttribute('aria-live'), status: Boolean(z.querySelector('[role="status"]')),
        silnik: wiersz.dataset.silnik, nazwaSilnika: wiersz.querySelector('.rola-silnik').textContent,
        kropka: getComputedStyle(wiersz.querySelector('.rola-kropka')).backgroundColor,
        podgladUkryty: wiersz.querySelector('.rola-podglad').getAttribute('aria-hidden'),
        prowadzi: Boolean(z.closest('.msg').querySelector('.msg-silnik-prowadzi')),
      };
    });
    ok(praca.stan === 'praca' && praca.live === 'off' && praca.status, `P1c. blok w pracy: aria-live=off i osobny role=status (${JSON.stringify(praca).slice(0, 80)})`);
    ok(/^(NVIDIA|OpenAI|Claude|Lokalny GPU)$/.test(praca.nazwaSilnika) && praca.kropka !== 'rgba(0, 0, 0, 0)' && praca.podgladUkryty === 'true',
      `P1d. wiersz roli: kropka w kolorze silnika, nazwa silnika TEKSTEM (${praca.nazwaSilnika}), podgląd aria-hidden`);
    ok(await btn.getAttribute('aria-pressed') === 'false', 'P1e. przycisk wraca po wysłaniu (jednorazowy)');
    await koniecTury();
    await page.waitForTimeout(300);
    const zZespolem = zadaniaCzatu.filter((x) => x.zespol);
    ok(zZespolem.length === 1 && (zZespolem[0].zespol.uruchom === true || Array.isArray(zZespolem[0].zespol.sklad)),
      `P1f. pole zespol w jednym żądaniu tury (${zZespolem.length} z ${zadaniaCzatu.length})`);
    const m1 = await wiadomosci();
    const prowadzacy = (await stanAtrapy()).filter((x) => x.rodzaj === 'prowadzacy');
    ok(m1.length === 3 && m1[1].narzedzie === 'zespol' && m1[1].search && m1[2].role === 'assistant' && m1[2].silnik === 'cloud'
      && m1[1].wklady === 2, `P1g. rozmowa: pytanie, notatki (wynik narzędzia), odpowiedź prowadzącego (${m1.map((m) => m.narzedzie || m.role).join(',')})`);
    // Serwer skleja pytanie i notatki w jedną wypowiedź człowieka (ujednolicRole) – notatki są jej końcem.
    ok(prowadzacy.length === 1 && /NOTATKI ZESPOŁU/.test(m1[1].content) && prowadzacy[0].ostatnia.endsWith(m1[1].content.trim()),
      'P1h. zapisane notatki = DOKŁADNIE tekst, który dostał prowadzący');
    const po = await page.evaluate(() => {
      const z = document.querySelector('.zespol');
      if (!z) return { otwarty: '', stan: 'brak bloku', dymkiNarzedzi: document.querySelectorAll('#messages .msg-search').length, wBloku: false };
      return { otwarty: z.dataset.otwarty, stan: z.dataset.stan, dymkiNarzedzi: document.querySelectorAll('#messages .msg-search').length,
        wBloku: Boolean(z.closest('.msg-assistant') && z.closest('.msg-assistant').querySelector('.msg-content').textContent.includes('Odpowiedź prowadzącego')) };
    });
    ok(po.otwarty === 'false' && po.stan === 'wynik' && po.wBloku, 'P1i. po wyniku blok zwinięty do jednej linii, w karcie odpowiedzi prowadzącego');
    const tekst1 = await ekran();
    ok(po.dymkiNarzedzi === 0 && !/narzedzie\.zespol|<wklad|NOTATKI ZESPOŁU|<\/?think>/.test(tekst1),
      'P1j. notatki bez własnego dymka; na ekranie ani klucza narzedzie.zespol, ani ograniczników');
    const ogl = await page.evaluate(() => window.__ogloszenia);
    ok(ogl.length >= 2 && ogl.length <= 2 + 2, `P1k. ogłoszeń czytnika ${ogl.length} ≤ ról + 2 (${ogl.join(' | ').slice(0, 160)})`);
    await page.click('.zespol-glowa');
    await page.click('.zespol .rola-wiersz');
    const wklad = await page.evaluate(() => ({ exp: document.querySelector('.zespol .rola-wiersz').getAttribute('aria-expanded'),
      tresc: document.querySelector('.zespol .rola-tresc').innerText }));
    ok(wklad.exp === 'true' && /WNIOSKI: notatka roli/.test(wklad.tresc), 'P1l. rozwinięty wiersz pokazuje pełny wkład roli (aria-expanded)');

    // ---------------------------------------------------------------- P2
    zadaniaCzatu.length = 0;
    await wyslij('Dziękuję, a jak to uruchomić?');
    await koniecTury();
    const nast = zadaniaCzatu[0] || { messages: [] };
    const tresci = nast.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    ok(/\(wcześniejszy wynik narzędzia: praca zespołu: [^)]*– już wykorzystany w odpowiedzi\)/.test(tresci) && !/<wklad|NOTATKI ZESPOŁU/.test(tresci)
      && !(nast.zespol && nast.zespol.uruchom), 'P2. następna tura: notatki jako jedna linia, bez <wklad, bez uruchamiania zespołu');

    // ---------------------------------------------------------------- P3
    await nowaRozmowa();
    await btn.click();
    await wyslij('plan-trzy policz i napisz kod');
    await koniecTury();
    await zeruj();
    zadaniaCzatu.length = 0;
    const przed = (await wiadomosci()).length;
    await page.locator('.msg-assistant .msg-actions button[title]').last().click();
    await koniecTury();
    await page.waitForTimeout(300);
    const z3 = doModeli(await stanAtrapy());
    const m3 = await wiadomosci();
    ok(z3.length === 1 && z3[0].rodzaj === 'prowadzacy' && /NOTATKI ZESPOŁU/.test(z3[0].tekst),
      `P3a. Regeneruj pod odpowiedzią zespołu: jedno żądanie do modelu, prowadzący na tych samych notatkach (${z3.map((x) => x.rodzaj).join(',')})`);
    ok(zadaniaCzatu.length === 1 && !zadaniaCzatu[0].zespol && m3.length === przed && m3[1].narzedzie === 'zespol',
      'P3b. bez pola zespol w żądaniu; notatki zostały, dalej jedna odpowiedź');

    // ---------------------------------------------------------------- P4
    await nowaRozmowa();
    await zeruj();
    await btn.click();
    await wyslij('rola-wolna:ANALITYK rola-wolna:RECENZENT policz dokładnie');
    await page.waitForSelector('.zespol .rola[data-stan="pracuje"]', { timeout: 15000 });
    await page.click('#stop-btn');
    await koniecTury();
    await page.waitForTimeout(2500);
    const z4 = await stanAtrapy();
    const m4 = await wiadomosci();
    ok(!z4.some((x) => x.rodzaj === 'prowadzacy'), `P4a. Stop w fazie ról – prowadzący nie ruszył (${z4.map((x) => x.rodzaj).join(',')})`);
    ok(m4.some((m) => m.narzedzie === 'zespol') && await page.locator('#messages .zespol').count() === 1,
      'P4b. po Stopie blok zespołu zostaje na ekranie (notatki zapisane dla oczu)');

    // ---------------------------------------------------------------- P5
    await nowaRozmowa();
    const PYTANIE = 'Porównaj najnowsze ceny obiektywów i napisz skrypt w pythonie, który je zestawi, oraz sprawdź opinie';
    await wyslij(PYTANIE);
    await koniecTury();
    await page.waitForSelector('.zespol-sugestia', { timeout: 5000 }).catch(() => null);
    const sug = await page.evaluate(() => { const s = document.querySelector('.zespol-sugestia'); return s ? s.innerText : ''; });
    ok(/Mogę to sprawdzić zespołem/.test(sug) && /· (NVIDIA|Claude|OpenAI|Lokalny GPU)/.test(sug), `P5a. propozycja pod odpowiedzią solo: role i silniki tekstem (${sug.replace(/\n/g, ' ').slice(0, 90)})`);
    if (sug) {
      await page.click('.zespol-sugestia .zespol-uruchom');
      await koniecTury();
      const m5 = await wiadomosci();
      ok(m5.length === 3 && m5.filter((m) => m.role === 'assistant').length === 1 && m5[1].narzedzie === 'zespol',
        `P5b. „Uruchom” zastępuje odpowiedź solo odpowiedzią zespołu – jedno pytanie, jedna odpowiedź (${m5.map((m) => m.narzedzie || m.role).join(',')})`);
    }
    await nowaRozmowa();
    await wyslij(PYTANIE);
    await koniecTury();
    await page.waitForSelector('.zespol-sugestia', { timeout: 5000 }).catch(() => null);
    await page.click('.zespol-sugestia .zamknij').catch(() => {});
    ok(await page.locator('.zespol-sugestia').count() === 0, 'P5c. „×” chowa propozycję');
    zadaniaCzatu.length = 0;
    await wyslij(`${PYTANIE} – i jeszcze raz`);
    await koniecTury();
    await page.waitForTimeout(300);
    ok(await page.locator('.zespol-sugestia').count() === 0 && zadaniaCzatu.length === 1 && !zadaniaCzatu[0].zespol,
      'P5d. wyciszone do końca rozmowy: bez propozycji i bez planisty w następnej turze');

    // ---------------------------------------------------------------- P6
    await page.evaluate(() => fetch('/api/zespol/ustawienia', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: { badacz: { silnik: 'cloud', model: 'nvidia/nemotron-3-super-120b-a12b' } } }) }));
    await nowaRozmowa();
    await page.click('.endpoint-tab[data-endpoint="local"]');
    await btn.click();
    await wyslij('plan-badacz sprawdź ceny Samsunga i porównaj');
    const bramka = await page.waitForSelector('.zespol[data-stan="propozycja"] .zespol-zgoda', { timeout: 15000 }).catch(() => null);
    const b6 = await page.evaluate(() => ({ fokus: document.activeElement && document.activeElement.id,
      tekst: (document.querySelector('.zespol[data-stan="propozycja"]') || {}).innerText || '' }));
    ok(Boolean(bramka) && /wyśle treść rozmowy do chmury/.test(b6.tekst) && /Tylko lokalnie/.test(b6.tekst) && /Bez agentów/.test(b6.tekst),
      'P6a. lokalny prowadzący + rola w chmurze → bramka: Start / Tylko lokalnie / Bez agentów');
    ok(b6.fokus === 'input', `P6b. bramka nie zabiera fokusu z pola wiadomości (${b6.fokus})`);
    await zeruj();
    if (bramka) await page.click('.zespol[data-stan="propozycja"] .btn-secondary');
    await koniecTury();
    await page.waitForTimeout(300);
    const z6 = doModeli(await stanAtrapy());
    ok(z6.length > 0 && z6.every((x) => x.silnik === 'local'), `P6c. „Tylko lokalnie” – zero żądań do chmury (${z6.map((x) => `${x.silnik}:${x.rodzaj}`).join(',')})`);
    await page.evaluate(() => fetch('/api/zespol/ustawienia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: {} }) }));
    await page.click('.endpoint-tab[data-endpoint="cloud"]');
    // Rola na innym płatnym silniku przy „Pytaj przed startem”: bramka bez zgody na chmurę.
    await page.evaluate(() => { settings.zespolPotwierdzaj = true; });
    await page.evaluate(() => fetch('/api/zespol/ustawienia', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: { programista: { silnik: 'claude', model: 'claude-sonnet-5' } } }) }));
    await nowaRozmowa();
    await btn.click();
    await wyslij('plan-kod napisz funkcję');
    const bramka2 = await page.waitForSelector('.zespol[data-stan="propozycja"] .btn-primary', { timeout: 15000 }).catch(() => null);
    const b62 = await page.evaluate(() => (document.querySelector('.zespol[data-stan="propozycja"]') || {}).innerText || '');
    ok(Boolean(bramka2) && /Claude/i.test(b62) && !/wyśle treść rozmowy do chmury/.test(b62), 'P6d. rola na innym płatnym silniku – skład do potwierdzenia (bez zdania o chmurze)');
    if (bramka2) await page.click('.zespol[data-stan="propozycja"] .btn-ghost');
    await koniecTury();
    const m62 = await wiadomosci();
    ok(m62.length === 2 && !m62.some((m) => m.narzedzie === 'zespol'), '„Bez agentów” – odpowiedź bez zespołu'.replace(/^/, 'P6e. '));
    await page.evaluate(() => { settings.zespolPotwierdzaj = false; });
    await page.evaluate(() => fetch('/api/zespol/ustawienia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: {} }) }));

    // ---------------------------------------------------------------- P7, P8
    await nowaRozmowa();
    await btn.click();
    await wyslij('plan-trzy policz i napisz kod');
    await koniecTury();
    const idRozmowy = await page.evaluate(() => activeConversation.id);
    const tel = await b.newContext({ viewport: { width: 358, height: 700 }, serviceWorkers: 'block', locale: 'pl-PL', isMobile: true, hasTouch: true });
    const p7 = await tel.newPage();
    p7.on('pageerror', (e) => bledy.push(`358: ${e.message}`));
    await p7.goto(`${ADRES}/app`, { waitUntil: 'load' });
    await p7.waitForFunction(() => typeof selectConversation === 'function', null, { timeout: 10000 });
    await p7.evaluate((id) => selectConversation(id), idRozmowy);
    await p7.waitForSelector('.zespol', { timeout: 10000 });
    await p7.click('.zespol-glowa');
    const bokiem = () => p7.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(await bokiem() <= 0, 'P7a. 358 px: rozwinięty blok bez przewijania w bok');
    await p7.click('.zespol .zespol-link');       // „Zmień skład”
    await p7.waitForSelector('.zespol[data-stan="propozycja"] .btn-primary', { timeout: 5000 });
    const start = await p7.evaluate(() => document.querySelector('.zespol[data-stan="propozycja"] .btn-primary').getBoundingClientRect().height);
    ok(await bokiem() <= 0 && start >= 44, `P7b. 358 px: edycja składu bez przewijania w bok, Start ${Math.round(start)} px`);
    await p7.click('.zespol[data-stan="propozycja"] .rola-model-btn');
    const arkusz = await p7.waitForSelector('.rola-edytor', { timeout: 3000 }).then(() => p7.evaluate(() => {
      const r = document.querySelector('.rola-edytor').getBoundingClientRect();
      return { dol: Math.round(window.innerHeight - r.bottom), szer: Math.round(r.width), opcja: document.querySelector('.rola-edytor .model-opcja').getBoundingClientRect().height };
    })).catch(() => null);
    ok(arkusz && arkusz.dol <= 1 && arkusz.szer >= 356 && arkusz.opcja >= 44, `P7c. edytor modelu na telefonie – arkusz od dołu, opcje ≥ 44 px (${JSON.stringify(arkusz)})`);
    await p7.keyboard.press('Escape');
    ok(await p7.locator('.rola-edytor').count() === 0, 'P7d. Escape zamyka edytor');
    await p7.setViewportSize({ width: 740, height: 313 });
    await p7.evaluate(() => renderMessages());
    await p7.click('.zespol-glowa');
    const pigulki = await p7.evaluate(() => {
      const li = [...document.querySelectorAll('.zespol .rola')];
      return { gory: [...new Set(li.map((x) => Math.round(x.getBoundingClientRect().top)))].length, n: li.length, bok: document.documentElement.scrollWidth - innerWidth };
    });
    ok(pigulki.n === 3 && pigulki.gory === 1 && pigulki.bok <= 0, `P8. 740×313: role jako pigułki w jednym rzędzie (${JSON.stringify(pigulki)})`);
    await tel.close();

    // ---------------------------------------------------------------- P9
    await page.evaluate(() => openSettings('agenci'));
    await page.waitForSelector('#ag-ustawienia .ag-tryb', { timeout: 5000 });
    const karty = await page.evaluate(() => [...document.querySelectorAll('.set-karty [role="tab"]')].filter((k) => !k.hidden).map((k) => k.dataset.cel));
    ok(karty.indexOf('agenci') === karty.indexOf('silniki') + 1, `P9a. karta „Agenci” zaraz po „Silnikach” (${karty.join(',')})`);
    await page.click('#ag-ustawienia input[value="wylaczony"] + .kolko');
    await page.waitForTimeout(600);
    const tryb = await page.evaluate(() => fetch('/api/zespol/ustawienia').then((r) => r.json()).then((d) => d.ustawienia.tryb));
    ok(tryb === 'wylaczony' && await page.locator('#zespol-btn').isHidden(), 'P9b. „Wyłączony” zapisany na serwerze, przycisk zespołu znika');
    await page.click('#ag-ustawienia input[value="proponuj"] + .kolko');
    await page.waitForTimeout(600);
    ok(await page.locator('#zespol-btn').isVisible(), 'P9c. powrót do „Proponuj” – przycisk wraca');
    await page.evaluate(() => closeSettings());

    // ---------------------------------------------------------------- P10
    await page.evaluate(() => { setLang('en'); renderMessages(); });
    const en = await page.evaluate(() => ({ glowa: document.querySelector('.zespol .zespol-tytul').textContent, btn: document.getElementById('zespol-btn').getAttribute('aria-label') }));
    ok(/^Team · 3 roles$/.test(en.glowa) && en.btn === 'Agent team', `P10. EN: „${en.glowa}”, przycisk „${en.btn}”`);
    await page.evaluate(() => { setLang('pl'); renderMessages(); });

    // ---------------------------------------------------------------- P11
    await nowaRozmowa();
    await page.evaluate(() => {
      window.__mowa = []; window.__kropki = 0;
      speakText = async (tekst) => { window.__mowa.push(tekst); };
      startQueryListening = () => {};
      voiceMode = true;
      new MutationObserver(() => { if (document.querySelector('#voice-overlay .voice-zespol .vz-rola')) window.__kropki++; })
        .observe(document.getElementById('voice-overlay'), { subtree: true, childList: true });
      const conv = ensureConversation('głos');
      conv.messages.push({ role: 'user', content: 'rola-wolna:ANALITYK zrób to zespołem: policz' });
      zespolNaTure = { uruchom: true };
      runGeneration(conv);
    });
    await koniecTury();
    const glos = await page.evaluate(() => { const g = { mowa: window.__mowa.join('\n'), kropki: window.__kropki, zostaly: document.querySelectorAll('.voice-zespol').length }; voiceMode = false; return g; });
    ok(glos.kropki > 0 && glos.zostaly === 0, 'P11a. tryb głosowy: kropki ról pod kulą w trakcie, sprzątnięte po turze');
    ok(/Odpowiedź prowadzącego/.test(glos.mowa) && !/WNIOSKI|NOTATKI|notatka roli/.test(glos.mowa), `P11b. czytana tylko odpowiedź prowadzącego (${glos.mowa.slice(0, 80)})`);

    ok(!bledy.length, `P0. bez błędów strony (${bledy.join(' | ').slice(0, 200)})`);
  } catch (err) {
    w.zapisz(`wyjątek: ${err && err.message}`);
    console.log(err);
  } finally {
    await b.close();
  }
  w.zakoncz();
})();

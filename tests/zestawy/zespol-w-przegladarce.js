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
   P11. tryb głosowy: kropki ról pod kulą, czytana tylko odpowiedź prowadzącego.
   Etap 5 (dokładki):
   P14. Ustawienia → Agenci, „Własne role”: formularz (fokus, brak nazwy – powód
        pod polem, aria-invalid; „Anuluj” wraca na „Edytuj”; globalne „Zapisz”
        najpierw zapisuje otwartą rolę, przy błędzie okno zostaje),
        zapis na serwerze (id od serwera), nazwa od osoby TYLKO jako tekst,
        znacznik „własna”, licznik, edycja tej samej roli;
   P15. własna rola w „Dodaj rolę” (oznaczona) → w składzie idzie jej id,
        w bloku wiersz ze znacznikiem „własna”;
   P16. poprawka po recenzji (fala 3): wiersz „Programista – poprawka po
        recenzji” pod recenzentem, nagłówek liczy role bez poprawki;
   P17. złotówki: limit dzienny zapisany na serwerze („Budżet zapisany.” przy
        polach, dwa szybkie zapisy nie kasują się, zła kwota – widoczny powód),
        koszt ról przy wyniku,
        szacunek w bramce płatnego silnika, rola pominięta z powodu budżetu,
        czat 429 budzet-wyczerpany → komunikat, „Wyślij przez Chmurę”,
        „Ustawienia budżetu” (karta Agenci);
   P18. zgoda GŁOSEM (lokalny prowadzący, rola w chmurze) w prawdziwym trybie
        głosowym na podstawionym SpeechRecognition: Cosmos mówi pytanie (co
        wychodzi i na jak długo), na scenie trzy przyciski, do odpowiedzi nic
        nie idzie do chmury; ogon pytania z głośnika nie rozstrzyga; odpowiedź
        powtarzająca słowa pytania nie jest echem („tak…” → chmura, „Tak, ale
        tylko lokalnie” → lokalnie); przeczenie w środku zdania nie jest zgodą;
        „Tylko lokalnie” na scenie → zero żądań do chmury, 10 s ciszy → bez zespołu;
   P19. „Pytaj przed startem” na serwerze: wyłączone w przeglądarce idzie tam
        JEDNYM zapisem i znika z pamięci przeglądarki;
   P21. „Darmowe modele”: wybór w bramce i ustawienie osoby docierają do
        serwera jako zespol.tylkoDarmowe (skład na darmowych silnikach).
   P20. blok: postęp po składzie z „poprawka” słowem, „ok.” przy szacunku,
        stopka „koszt ról · cała odpowiedź” (z prowadzącym, C2), „5 ról”. */
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
    const zapisyUstawien = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/api/chat')) { try { zadaniaCzatu.push(JSON.parse(r.postData() || '{}')); } catch { /* */ } }
      if (r.method() === 'POST' && r.url().endsWith('/api/zespol/ustawienia')) { try { zapisyUstawien.push(JSON.parse(r.postData() || '{}')); } catch { /* */ } }
    });
    await page.goto(`${ADRES}/app`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const x = document.getElementById('zespol-btn'); return x && !x.hidden; }, null, { timeout: 15000 });
    const koniecTury = () => page.waitForFunction(() => !isGenerating, null, { timeout: 60000 });
    const ustawieniaSerwera = () => page.evaluate(() => fetch('/api/zespol/ustawienia').then((r) => r.json()).then((d) => d.ustawienia));

    // ---------------------------------------------------------------- P19
    await page.waitForFunction(() => { try { return !('zespolPotwierdzaj' in JSON.parse(localStorage.getItem('cosmos.settings') || '{}')); } catch { return false; } },
      null, { timeout: 8000 }).catch(() => {});
    const us19 = await ustawieniaSerwera();
    const lok19 = await page.evaluate(() => localStorage.getItem('cosmos.settings'));
    ok(us19.potwierdzaj === false && zapisyUstawien.filter((z) => 'potwierdzaj' in z).length === 1 && !/zespolPotwierdzaj/.test(lok19)
      && await page.evaluate(() => potwierdzajZespolu()) === false,
      `P19. „Pytaj przed startem” wyłączone w przeglądarce → jeden zapis na serwerze, klucz znika z przeglądarki (zapisów ${zapisyUstawien.length})`);
    const wyslij = async (tekst) => { await page.fill('#input', tekst); await page.press('#input', 'Enter'); };
    const nowaRozmowa = async () => { await page.evaluate(() => newConversation()); await page.waitForTimeout(150); };
    const wiadomosci = () => page.evaluate(() => activeConversation.messages.map((m) => ({ role: m.role, narzedzie: m.narzedzie || '', search: Boolean(m.search),
      // Wkłady ról składu – poprawka po recenzji (fala 3) to druga runda programisty, nie osobna rola.
      content: typeof m.content === 'string' ? m.content : '', silnik: m.silnik || '', wklady: m.zespol ? m.zespol.wklady.filter((x) => x.fala !== 3).length : 0 })));
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

    // ---------------------------------------------------------------- P16, P17b
    const f3 = await page.evaluate(() => {
      const li = [...document.querySelectorAll('.zespol .rola')];
      const ost = li[li.length - 1];
      return { n: li.length, fala: ost && ost.dataset.fala, nazwa: ost ? ost.querySelector('.rola-nazwa').innerText : '', przed: li.length > 1 ? li[li.length - 2].dataset.rola : '',
        glowa: document.querySelector('.zespol .zespol-tytul').textContent, koszt: (document.querySelector('.zespol .zespol-koszt') || {}).textContent || '' };
    });
    ok(f3.fala === '3' && /^Programista – poprawka po recenzji/.test(f3.nazwa) && f3.przed === 'recenzent' && /· 2 role$/.test(f3.glowa),
      `P16. poprawka po recenzji: ostatni wiersz pod recenzentem, nagłówek bez niej (${JSON.stringify(f3).slice(0, 160)})`);
    await page.click('.zespol-glowa');
    const koszt17 = await page.evaluate(() => ({ glowa: (document.querySelector('.zespol .zespol-koszt-glowa') || {}).textContent || '',
      widac: getComputedStyle(document.querySelector('.zespol .zespol-koszt-glowa') || document.body).display !== 'none' }));
    ok(/zł$/.test(f3.koszt) && /koszt ról/.test(f3.koszt) && /· .*zł$/.test(koszt17.glowa) && koszt17.widac,
      `P17b. koszt ról po wyniku: w stopce rozwiniętego bloku i przy czasie zwiniętego („${f3.koszt}”, „${koszt17.glowa}”)`);

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
    // „Pytaj przed startem” żyje na serwerze (etap 5) – przełącznik jak w Ustawieniach.
    await page.evaluate(() => zmienUstawieniaZespolu({ potwierdzaj: true }));
    await page.evaluate(() => fetch('/api/zespol/ustawienia', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: { programista: { silnik: 'claude', model: 'claude-sonnet-5' } } }) }));
    await nowaRozmowa();
    await btn.click();
    await wyslij('plan-kod napisz funkcję');
    const bramka2 = await page.waitForSelector('.zespol[data-stan="propozycja"] .btn-primary', { timeout: 15000 }).catch(() => null);
    const b62 = await page.evaluate(() => (document.querySelector('.zespol[data-stan="propozycja"]') || {}).innerText || '');
    ok(Boolean(bramka2) && /Claude/i.test(b62) && !/wyśle treść rozmowy do chmury/.test(b62), 'P6d. rola na innym płatnym silniku – skład do potwierdzenia (bez zdania o chmurze)');
    // Przy dwóch gotowych składach (K5) kwota stoi w polu „Proponowany”, bez segmentu – w stopce z etykietą „koszt”.
    const szac = await page.evaluate(() => { const z = document.querySelector('.zespol[data-stan="propozycja"]');
      const seg = z && z.querySelector('.zespol-wariant[data-wariant="proponowany"] span');
      return seg ? `segment:${seg.textContent}` : ((z && z.querySelector('.zespol-szacunek')) || {}).textContent || ''; });
    ok(/^(koszt |segment:)(ok\. \d+,\d{2}|poniżej 0,01)\s?zł$/.test(szac.replace(/\u00a0/g, ' ')), `P17c. szacunek kosztu w bramce płatnego silnika – „koszt” w stopce albo kwota w polu „Proponowany” („${szac}”)`);
    if (bramka2) await page.click('.zespol[data-stan="propozycja"] .btn-ghost');
    await koniecTury();
    const m62 = await wiadomosci();
    ok(m62.length === 2 && !m62.some((m) => m.narzedzie === 'zespol'), '„Bez agentów” – odpowiedź bez zespołu'.replace(/^/, 'P6e. '));
    await page.evaluate(() => fetch('/api/zespol/ustawienia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: {} }) }));

    // ---------------------------------------------------------------- P21
    /* „Darmowe modele” (K5): wybór w bramce dociera do serwera jako
       zespol.tylkoDarmowe, a ustawienie „darmowy” omija bramkę płatnego
       silnika. Plan podstawiony – liczy się droga przez app.js, nie dobór. */
    const plan21 = (skladDomyslny) => ({ sklad: {
      role: [{ rola: 'programista', zadanie: 'kod', silnik: 'claude', model: 'claude-sonnet-5' }], szacunekZl: 0.31,
      darmowe: { role: [{ rola: 'programista', zadanie: 'kod', silnik: 'cloud', model: 'qwen/qwen3-coder-480b-a35b-instruct' }], odrzucone: [], szacunekZl: 0 },
      ...(skladDomyslny ? { skladDomyslny } : {}) } });
    let domyslny21 = '';
    await page.route('**/api/zespol/plan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plan21(domyslny21)) }));
    const zespol21 = () => (zadaniaCzatu.find((z) => z.zespol) || {}).zespol || null;
    await nowaRozmowa();
    zadaniaCzatu.length = 0;
    await btn.click();
    await wyslij('plan-kod napisz funkcję za darmo');
    const seg21 = await page.waitForSelector('.zespol[data-stan="propozycja"] .zespol-wariant[data-wariant="darmowe"]', { timeout: 15000 }).catch(() => null);
    if (seg21) await seg21.click();
    const uwaga21 = await page.evaluate(() => (document.querySelector('.zespol[data-stan="propozycja"] .zespol-uwaga') || {}).textContent || '');
    if (seg21) await page.click('.zespol[data-stan="propozycja"] .btn-primary');
    await koniecTury();
    const z21a = zespol21();
    ok(Boolean(seg21) && /gorsz|słabsz/i.test(uwaga21) && z21a && z21a.tylkoDarmowe === true && z21a.sklad[0].silnik === 'cloud',
      `P21a. bramka: „Darmowe modele” + Start → skład darmowy z tylkoDarmowe do serwera, z uwagą o jakości (${JSON.stringify(z21a).slice(0, 200)}; „${uwaga21.slice(0, 80)}”)`);
    domyslny21 = 'darmowy';
    await nowaRozmowa();
    zadaniaCzatu.length = 0;
    await btn.click();
    await wyslij('plan-kod napisz funkcję domyślnie za darmo');
    // Bramka (błąd) albo koniec tury; bramkę zamyka „Bez agentów”, żeby zestaw szedł dalej.
    await page.waitForFunction(() => !isGenerating || document.querySelector('.zespol[data-stan="propozycja"]'), null, { timeout: 60000 });
    const bramka21b = await page.locator('.zespol[data-stan="propozycja"]').count();
    if (bramka21b) await page.click('.zespol[data-stan="propozycja"] .btn-ghost');
    await koniecTury();
    const z21b = zespol21();
    ok(z21b && z21b.tylkoDarmowe === true && z21b.sklad[0].silnik === 'cloud' && bramka21b === 0,
      `P21b. ustawienie „Darmowe modele”: skład darmowy bez bramki płatnego silnika, z tylkoDarmowe (${JSON.stringify(z21b).slice(0, 200)})`);
    await page.unroute('**/api/zespol/plan');
    await page.evaluate(() => zmienUstawieniaZespolu({ potwierdzaj: false }));

    // ---------------------------------------------------------------- P12, P13
    await nowaRozmowa();
    await zeruj();
    await btn.click();
    await wyslij('rola-wolna:ANALITYK policz dokładnie');
    await page.waitForSelector('.zespol .rola[data-rola="analityk"][data-stan="pracuje"] .rola-akcje button', { timeout: 15000 });
    await page.click('.zespol .rola[data-rola="analityk"] .rola-akcje button');
    await koniecTury();
    const z12 = await stanAtrapy();
    const w12 = await page.evaluate(() => (activeConversation.messages.find((m) => m.narzedzie === 'zespol') || { zespol: { wklady: [] } }).zespol.wklady.map((x) => `${x.rola}:${x.stan}`));
    ok(w12.includes('analityk:pominieta') && z12.some((x) => x.rodzaj === 'prowadzacy'), `P12. „Pomiń” przy pracującej roli – rola pominięta, prowadzący odpowiada (${w12.join(',')})`);
    await nowaRozmowa();
    await zeruj();
    await btn.click();
    await wyslij('plan-trzy rola-wolna:ANALITYK rola-wolna:PROGRAMISTA policz i napisz');
    await page.waitForSelector('.zespol .rola[data-stan="pracuje"]', { timeout: 15000 });
    await page.click('.zespol .zespol-stopka .zespol-link');
    await koniecTury();
    const z13 = await stanAtrapy();
    const m13 = await wiadomosci();
    ok(z13.some((x) => x.rodzaj === 'prowadzacy') && m13[m13.length - 1].role === 'assistant' && !m13[m13.length - 1].content.includes('⚠'),
      '„Stop zespołu – odpowiedz sam” – prowadzący scala to, co jest'.replace(/^/, 'P13. '));

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
    /* Role składu w jednym rzędzie; poprawka po recenzji (fala 3, czwarta
       pigułka) może zejść do drugiego – byle bez przewijania w bok. */
    const pigulki = await p7.evaluate(() => {
      const li = [...document.querySelectorAll('.zespol .rola:not([data-fala="3"])')];
      return { gory: [...new Set(li.map((x) => Math.round(x.getBoundingClientRect().top)))].length, n: li.length, bok: document.documentElement.scrollWidth - innerWidth,
        poprawka: document.querySelectorAll('.zespol .rola[data-fala="3"]').length };
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
    await page.evaluate(() => openSettings('agenci'));
    await page.waitForSelector('#ag-ustawienia .ag-wlasne-sekcja', { timeout: 5000 }).catch(() => {});
    const en14 = await page.evaluate(() => ({ wl: (document.querySelector('.ag-wlasne-sekcja h3') || {}).textContent, bud: (document.querySelector('.ag-budzet-sekcja h3') || {}).textContent,
      dodaj: (document.querySelector('.ag-wl-dodaj') || {}).textContent }));
    ok(en14.wl === 'Custom roles' && en14.bud === 'Budget (PLN)' && /^Add a custom role$/.test((en14.dodaj || '').trim()),
      `P10b. EN: „${en14.wl}”, „${en14.bud}”, „${en14.dodaj}”`);
    await page.evaluate(() => closeSettings());
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

    // ---------------------------------------------------------------- P14
    await page.evaluate(() => openSettings('agenci'));
    await page.waitForSelector('#ag-ustawienia .ag-wl-dodaj', { timeout: 5000 });
    await page.click('#ag-ustawienia .ag-wl-dodaj');
    await page.waitForSelector('.ag-wl-formularz [data-pole="nazwa"]');
    const fok14 = await page.evaluate(() => document.activeElement && document.activeElement.dataset.pole);
    await page.click('.ag-wl-zapisz');
    const blad14 = await page.evaluate(() => { const e = document.querySelector('.ag-wl-blad'); return e && !e.hidden ? e.textContent : ''; });
    const pole14 = await page.evaluate(() => { const n = document.querySelector('[data-pole="nazwa"]'); const e = document.querySelector('.ag-wl-blad');
      return { inv: n.getAttribute('aria-invalid'), opis: (n.getAttribute('aria-describedby') || '').split(' ').includes(e.id), podPolem: e.parentElement === n.closest('.field'),
        fokus: document.activeElement && document.activeElement.dataset.pole }; });
    ok(fok14 === 'nazwa' && /Wpisz nazwę/.test(blad14), `P14a. „Dodaj własną rolę”: fokus w nazwie, bez nazwy nie zapisuje („${blad14}”)`);
    ok(pole14.inv === 'true' && pole14.opis && pole14.podPolem && pole14.fokus === 'nazwa',
      `P14a2. powód pod polem nazwy (nie przy przyciskach), pole z aria-invalid i aria-describedby na powód (${JSON.stringify(pole14)})`);
    // Nazwa ≤ 40 znaków (serwer tnie dłuższe) – w całości znacznik HTML.
    const ZLA = '<img src=x onerror=window.__xss=1>';
    await page.fill('[data-pole="nazwa"]', ZLA);
    await page.fill('[data-pole="cel"]', 'Przekłada wnioski na prosty angielski');
    await page.fill('[data-pole="instrukcja"]', 'Przetłumacz najważniejsze zdania na angielski.');
    await page.check('[data-pole="cecha-polski"]');
    await page.click('.ag-wl-zapisz');
    await page.waitForSelector('#ag-ustawienia .ag-wlasna', { timeout: 5000 });
    const us14 = (await ustawieniaSerwera()).wlasneRole || [];
    const w14 = await page.evaluate(() => {
      const li = document.querySelector('#ag-ustawienia .ag-wlasna');
      return { tekst: li.innerText, img: Boolean(li.querySelector('img')), znak: Boolean(li.querySelector('.rola-wlasna')), xss: window.__xss || 0,
        licznik: document.querySelector('.ag-wl-licznik').textContent, fokus: (document.activeElement && document.activeElement.className) || '' };
    });
    ok(us14.length === 1 && /^w-/.test(us14[0].id) && us14[0].nazwa === ZLA && (us14[0].cechy || []).includes('polski') && us14[0].instrukcja,
      `P14b. własna rola zapisana na serwerze (id od serwera: ${us14[0] && us14[0].id})`);
    ok(w14.tekst.includes(ZLA) && !w14.img && !w14.xss && w14.znak && /^1 z 8$/.test(w14.licznik),
      'P14c. nazwa od osoby w liście TYLKO jako tekst (bez <img>), znacznik „własna”, licznik 1 z 8');
    ok(/ag-wl-dodaj/.test(w14.fokus), `P14d. po zapisie fokus wraca na „Dodaj własną rolę” (${w14.fokus})`);
    await page.click('#ag-ustawienia .ag-wl-edytuj');
    await page.fill('[data-pole="nazwa"]', 'Tłumacz');
    await page.click('.ag-wl-zapisz');
    await page.waitForFunction(() => { const li = document.querySelector('#ag-ustawienia .ag-wlasna'); return li && /^Tłumacz\s/.test(li.innerText); }, null, { timeout: 5000 }).catch(() => {});
    const us14b = (await ustawieniaSerwera()).wlasneRole || [];
    ok(us14b.length === 1 && us14[0] && us14b[0].id === us14[0].id && us14b[0].nazwa === 'Tłumacz', 'P14e. edycja zmienia tę samą rolę (to samo id)');
    await page.click('#ag-ustawienia .ag-wl-edytuj');
    await page.click('.ag-wl-formularz .btn-ghost');
    const fok14f = await page.evaluate(() => document.activeElement && document.activeElement.className);
    ok(/ag-wl-edytuj/.test(fok14f), `P14f. „Anuluj” edycji – fokus wraca na „Edytuj” tej roli (${fok14f})`);
    // Globalne „Zapisz” w stopce Ustawień z otwartym formularzem: najpierw zapis roli, błąd = okno zostaje.
    await page.click('#ag-ustawienia .ag-wl-dodaj');
    await page.fill('[data-pole="nazwa"]', 'Szkic');
    await page.click('#settings-save');
    await page.waitForTimeout(300);
    const g14 = await page.evaluate(() => ({ otwarte: document.getElementById('settings-modal').style.display !== 'none',
      inv: document.querySelector('[data-pole="instrukcja"]') && document.querySelector('[data-pole="instrukcja"]').getAttribute('aria-invalid') }));
    await page.fill('[data-pole="instrukcja"]', 'Streść w trzech zdaniach.');
    await page.click('#settings-save');
    await page.waitForFunction(() => document.getElementById('settings-modal').style.display === 'none', null, { timeout: 5000 }).catch(() => {});
    const us14g = (await ustawieniaSerwera()).wlasneRole || [];
    const zamkniete14 = await page.evaluate(() => document.getElementById('settings-modal').style.display === 'none');
    ok(g14.otwarte && g14.inv === 'true' && us14g.length === 2 && us14g[1].nazwa === 'Szkic' && zamkniete14,
      `P14g. globalne „Zapisz” zapisuje otwartą rolę (bez instrukcji – okno zostaje z błędem) (${JSON.stringify(g14)}, ról ${us14g.length}, zamknięte ${zamkniete14})`);
    await page.evaluate((r) => fetch('/api/zespol/ustawienia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wlasneRole: [r] }) }), us14g[0]);
    await page.evaluate(() => openSettings('agenci'));
    await page.waitForSelector('#ag-ustawienia [data-pole="budzet-dzien"]', { timeout: 5000 });
    // P17a – limit dzienny w złotówkach
    await page.fill('[data-pole="budzet-dzien"]', '3,5');
    await page.press('[data-pole="budzet-dzien"]', 'Tab');
    await page.waitForTimeout(600);
    const us17 = await ustawieniaSerwera();
    const stan17 = await page.evaluate(() => (document.querySelector('.ag-budzet-stan') || {}).textContent || '');
    ok(us17.budzetZl && us17.budzetZl.dzien === 3.5 && /Wydano dziś/.test(stan17), `P17a. limit dzienny „3,5” zapisany jako 3.5 zł; stan wydatków w karcie („${stan17}”)`);
    const zapisany17 = await page.evaluate(() => { const e = document.querySelector('.ag-budzet-zapisany'); return e ? { rola: e.getAttribute('role'), tekst: e.textContent } : null; });
    ok(zapisany17 && zapisany17.rola === 'status' && /Budżet zapisany/.test(zapisany17.tekst), `P17g. „Budżet zapisany.” przy polach (role=status) (${JSON.stringify(zapisany17)})`);
    // Dwa szybkie zapisy przy wolnej sieci (jak za Cloudflare): drugi nie kasuje pierwszego.
    await page.route('**/api/zespol/ustawienia', async (r) => { if (r.request().method() === 'POST') await spij(700); return r.continue(); });
    await page.fill('[data-pole="budzet-dzien"]', '4');
    await page.press('[data-pole="budzet-dzien"]', 'Tab');
    await page.fill('[data-pole="budzet-miesiac"]', '50');
    await page.press('[data-pole="budzet-miesiac"]', 'Tab');
    await page.waitForTimeout(2000);
    await page.unroute('**/api/zespol/ustawienia');
    const us17h = (await ustawieniaSerwera()).budzetZl || {};
    ok(us17h.dzien === 4 && us17h.miesiac === 50, `P17h. dwa szybkie zapisy limitu (dzień, potem miesiąc przy wolnej sieci) – serwer ma oba (${JSON.stringify(us17h)})`);
    // Zła kwota: powód WIDOCZNY pod polami (role=alert), wpisany tekst i fokus zostają (bez przebudowy panelu).
    await page.fill('[data-pole="budzet-miesiac"]', 'abc');
    await page.press('[data-pole="budzet-miesiac"]', 'Tab');
    await page.waitForTimeout(300);
    const zly17 = await page.evaluate(() => { const e = document.querySelector('.ag-budzet-blad'); const i = document.querySelector('[data-pole="budzet-miesiac"]');
      return { widac: Boolean(e && !e.hidden && e.getBoundingClientRect().height > 0), tekst: e ? e.textContent : '', rola: e && e.getAttribute('role'), wartosc: i.value,
        opis: (i.getAttribute('aria-describedby') || '').includes('ag-budzet-blad'), inv: i.getAttribute('aria-invalid') }; });
    ok(zly17.widac && zly17.rola === 'alert' && /od 0 do 100/.test(zly17.tekst) && zly17.wartosc === 'abc' && zly17.opis && zly17.inv === 'true',
      `P17i. zła kwota – widoczny powód pod polami (role=alert, aria-describedby), wpisane „abc” zostaje (${JSON.stringify(zly17)})`);
    // P19b: „Pytaj przed startem” włączane bez sieci – widoczny błąd zapisu, bez cichego `true` w przeglądarce.
    await page.route('**/api/zespol/ustawienia', (r) => (r.request().method() === 'POST' ? r.abort() : r.continue()));
    await page.locator('[data-przel="potwierdzaj"]').evaluate((el) => el.click());
    await page.waitForSelector('.ag-start-blad', { timeout: 3000 }).catch(() => {});
    await page.unroute('**/api/zespol/ustawienia');
    const p19b = await page.evaluate(() => ({ blad: (document.querySelector('.ag-start-blad') || {}).textContent || '',
      lokalnie: JSON.parse(localStorage.getItem('cosmos.settings') || '{}').zespolPotwierdzaj, przel: document.querySelector('[data-przel="potwierdzaj"]').checked }));
    ok(/Nie udało się zapisać|zapis/i.test(p19b.blad) && p19b.lokalnie !== true && p19b.przel === false,
      `P19b. „Pytaj przed startem” bez sieci – błąd zapisu pod przełącznikiem, bez cichego true w przeglądarce (${JSON.stringify(p19b)})`);
    await page.evaluate(() => zmienUstawieniaZespolu({ budzetZl: { dzien: 0, miesiac: 0 } }));
    await page.evaluate(() => closeSettings());

    // ---------------------------------------------------------------- P15
    await nowaRozmowa();
    await btn.click();
    await wyslij('rola-wolna:ANALITYK policz dokładnie');
    await koniecTury();
    await page.click('.zespol-glowa');
    await page.click('.zespol .zespol-stopka-cicha .zespol-link');
    await page.waitForSelector('.zespol[data-stan="propozycja"] .zespol-dodaj', { timeout: 5000 });
    await page.click('.zespol[data-stan="propozycja"] .zespol-dodaj');
    const opcja15 = await page.evaluate(() => { const o = document.querySelector('.zespol-dodaj-opcja.wlasna'); return o ? o.innerText.replace(/\s+/g, ' ') : ''; });
    ok(/^Tłumacz WŁASNA$|^Tłumacz własna$/i.test(opcja15), `P15a. „Dodaj rolę” pokazuje własną rolę z oznaczeniem („${opcja15}”)`);
    zadaniaCzatu.length = 0;
    await page.click('.zespol-dodaj-opcja.wlasna');
    await page.click('.zespol[data-stan="propozycja"] .btn-primary');
    await koniecTury();
    const sklad15 = ((zadaniaCzatu.find((z) => z.zespol) || {}).zespol || {}).sklad || [];
    ok(sklad15.some((r) => r.rola === us14[0].id) && sklad15.every((r) => !r.instrukcja && !r.nazwa), `P15b. w składzie idzie id własnej roli, bez nazwy i instrukcji (${sklad15.map((r) => r.rola).join(',')})`);
    await page.click('.zespol-glowa');
    const w15 = await page.evaluate(() => { const li = document.querySelector('.zespol .rola[data-wlasna="true"]'); return li ? li.querySelector('.rola-nazwa').innerText : ''; });
    ok(/Tłumacz/.test(w15) && /własna/i.test(w15), `P15c. w bloku wiersz własnej roli z nazwą osoby i znacznikiem („${w15.replace(/\s+/g, ' ')}”)`);

    // ---------------------------------------------------------------- P17d, P17e
    const pom17 = await page.evaluate(() => {
      const st = ZESPOL.stanZWiadomosci({ content: 'N', zespol: { prowadzacy: { silnik: 'cloud', model: 'm' }, wklady: [
        { r: 'r1', rola: 'badacz', silnik: 'cloud', model: 'm', stan: 'gotowa', tresc: 'x', ms: 1000 },
        { r: 'r2', rola: 'programista', silnik: 'claude', model: 'c', stan: 'pominieta', kod: 'budzet', tresc: '', ms: 0 }],
      odrzucone: [{ rola: 'analityk', kod: 'budzet', silnik: 'openai' }] } });
      const b = zespolWidok.blokZespolu(st, { zywy: false });
      document.body.append(b.el);
      b.el.querySelector('.zespol-glowa').click();
      const w = { blad: b.el.querySelector('.rola[data-rola="programista"] .rola-blad').textContent, odrz: b.el.querySelector('.zespol-odrzucone').textContent };
      b.el.remove();
      return w;
    });
    ok(/budżet/.test(pom17.blad) && /budżet wyczerpany/.test(pom17.odrz), `P17d. rola pominięta i odrzucona z powodu budżetu – słowami („${pom17.blad}”, „${pom17.odrz}”)`);
    // P20: blok zespołu – postęp po składzie z „poprawka” słowem, „ok.” przy szacunku, koszt całej odpowiedzi, odmiana „5 ról”.
    const b20 = await page.evaluate(() => {
      const rola = (r, rola, extra = {}) => ({ r, rola, silnik: 'openai', model: 'gpt-5-mini', stan: 'gotowa', tresc: 'x', ms: 1000, ...extra });
      const zywy = ZESPOL.nowyStanTury(Date.now() - 5000);
      ZESPOL.zjedzZdarzenieZespolu(zywy, 'sklad', { v: 1, zrodlo: 'plan', prowadzacy: { silnik: 'cloud', model: 'm' }, role: [
        { r: 'r1', rola: 'programista', silnik: 'openai', model: 'gpt-5-mini' }, { r: 'r2', rola: 'recenzent', silnik: 'claude', model: 'c' }] });
      ZESPOL.zjedzZdarzenieZespolu(zywy, 'rola', { r: 'r1', stan: 'gotowa', ms: 10 });
      ZESPOL.zjedzZdarzenieZespolu(zywy, 'rola', { r: 'r2', stan: 'gotowa', ms: 10 });
      ZESPOL.zjedzZdarzenieZespolu(zywy, 'rola', { r: 'r1p', rola: 'programista', fala: 3, poprawkaZ: 'r1', stan: 'pracuje', silnik: 'openai', model: 'gpt-5-mini' });
      const bz = zespolWidok.blokZespolu(zywy, { zywy: true });
      document.body.append(bz.el);
      const postep = bz.el.querySelector('.zespol-czas').textContent;
      bz.el.remove();
      const st = ZESPOL.stanZWiadomosci({ content: 'N', zespol: { prowadzacy: { silnik: 'claude', model: 'c' }, kosztZl: 0.06, kosztProwadzacegoZl: 0.12,
        wklady: [rola('r1', 'badacz', { kosztZl: 0.03, kosztSzacowany: true }), rola('r2', 'analityk'), rola('r3', 'programista'), rola('r4', 'recenzent'), rola('r5', 'fotograf')] } });
      const b = zespolWidok.blokZespolu(st, { zywy: false });
      document.body.append(b.el);
      const glowa = b.el.querySelector('.zespol-koszt-glowa').textContent;
      const tytul = b.el.querySelector('.zespol-tytul').textContent;
      b.el.querySelector('.zespol-glowa').click();
      const stopka = (b.el.querySelector('.zespol-koszt') || {}).textContent || '';
      b.el.remove();
      return { postep, glowa, tytul, stopka };
    });
    const nb20 = (x) => x.replace(/\u00a0/g, ' ');
    ok(/^2 z 2 · poprawka · \d+ s$/.test(b20.postep), `P20a. fala 3 w toku: postęp po składzie, poprawka słowem („${b20.postep}”)`);
    ok(nb20(b20.glowa) === ' · ok. 0,18 zł' && /· 5 ról$/.test(b20.tytul), `P20b. zwinięty: cała odpowiedź z „ok.” przy szacunku, „5 ról” („${b20.glowa}”, „${b20.tytul}”)`);
    ok(nb20(b20.stopka) === 'koszt ról: ok. 0,06 zł · cała odpowiedź: ok. 0,18 zł', `P20c. stopka: koszt ról i cała odpowiedź z prowadzącym („${b20.stopka}”)`);
    await nowaRozmowa();
    await page.route('**/api/chat', (r) => (r.request().method() === 'POST'
      ? r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ kod: 'budzet-wyczerpany', error: 'Budżet wyczerpany.', blad: 'Budżet wyczerpany.', zostalo: 0, okres: 'dzien', limit: 'wlasny' }) })
      : r.continue()));
    await page.click('.endpoint-tab[data-endpoint="claude"]');
    await wyslij('Ile to kosztuje?');
    await koniecTury();
    await page.unroute('**/api/chat');
    const e17 = await page.evaluate(() => { const m = [...document.querySelectorAll('.msg')].pop(); return { tekst: m.innerText,
      przyciski: [...m.querySelectorAll('.msg-bledu-akcje button')].filter((x) => !x.hidden).map((x) => x.textContent) }; });
    ok(/Dzienny budżet na płatne modele jest wyczerpany/.test(e17.tekst) && e17.przyciski.join('|') === 'Wyślij przez Chmurę|Ustawienia budżetu',
      `P17e. czat 429 budzet-wyczerpany: komunikat, „Wyślij przez Chmurę”, „Ustawienia budżetu” (${e17.przyciski.join('|')})`);
    await page.click('.msg-bledu-akcje button:has-text("Ustawienia budżetu")');
    await page.waitForSelector('#set-panel-agenci:not([hidden]) .ag-budzet-sekcja', { timeout: 5000 }).catch(() => {});
    ok(await page.locator('#set-panel-agenci:not([hidden]) .ag-budzet-sekcja').count() === 1, 'P17f. „Ustawienia budżetu” otwiera kartę Agenci z budżetem');
    await page.evaluate(() => closeSettings());
    await page.click('.endpoint-tab[data-endpoint="cloud"]');

    // ---------------------------------------------------------------- P18
    /* Prawdziwy tryb głosowy (enterVoiceMode, rozpoznawanie przeglądarki) na
       podstawionym SpeechRecognition i speechSynthesis – odpowiedź idzie
       „mikrofonem” przez askVoice, jak u człowieka. Dawniej zestaw wołał
       handleVoiceQuery wprost i nie widział, że zapora echa połyka odpowiedź
       powtarzającą słowa pytania. */
    const gctx = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block', locale: 'pl-PL' });
    await gctx.addInitScript(() => {
      try {
        localStorage.setItem('cosmos.settings', JSON.stringify({ zespolPotwierdzaj: false }));
        localStorage.setItem('cosmos.lang', 'pl'); localStorage.setItem('cosmos.sttEngine', 'przegladarka'); localStorage.setItem('cosmos.samouczek', '1');
      } catch { /* */ }
      window.__sr = [];
      window.__mowa = [];
      class SR {
        constructor() { window.__sr.push(this); this.wyniki = []; this.dziala = false; }
        start() { if (this.dziala) throw new DOMException('już działa', 'InvalidStateError'); this.dziala = true; setTimeout(() => this.onstart && this.onstart(), 5); }
        stop() { if (!this.dziala) return; this.dziala = false; setTimeout(() => this.onend && this.onend(), 5); }
        abort() { this.stop(); }
      }
      window.SpeechRecognition = SR; window.webkitSpeechRecognition = SR;
      window.__powiedz = (tekst) => {
        const r = [...window.__sr].reverse().find((x) => x.dziala);
        if (!r) return false;
        const w = [{ transcript: tekst, confidence: 0.9 }]; w.isFinal = true;
        r.wyniki.push(w);
        if (r.onresult) r.onresult({ resultIndex: r.wyniki.length - 1, results: r.wyniki });
        return true;
      };
      const synth = { speaking: false, pending: false, paused: false, _u: null,
        speak(u) { window.__mowa.push(u.text); this.speaking = true; this._u = u; setTimeout(() => u.onstart && u.onstart({}), 1);
          u.__t = setTimeout(() => { this.speaking = false; this._u = null; if (u.onend) u.onend({}); }, 300); },
        cancel() { const u = this._u; if (!u) return; clearTimeout(u.__t); this._u = null; this.speaking = false; if (u.onerror) u.onerror({ error: 'canceled' }); else if (u.onend) u.onend({}); },
        getVoices() { return []; }, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {} };
      Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    });
    const gp = await gctx.newPage();
    gp.on('pageerror', (e) => bledy.push(`głos: ${e.message}`));
    await gp.goto(`${ADRES}/app`, { waitUntil: 'load' });
    await gp.waitForFunction(() => { const x = document.getElementById('zespol-btn'); return x && !x.hidden; }, null, { timeout: 15000 });
    const PYT18 = 'plan-chmura rola-wolna:ANALITYK zrób to zespołem: policz ekspozycję';
    let nr18 = 0;
    /** Wejście w tryb głosowy, pytanie głosem, czekanie na pytanie o zgodę (Cosmos słucha). */
    const zgodaGlosem18 = async () => {
      nr18++;
      await gp.evaluate(() => { newConversation(); setEndpoint('local'); window.__mowa = []; });
      await gp.click('#voice-btn');
      await gp.waitForFunction(() => voiceMode && voiceState === 'wake' && window.__sr.some((x) => x.dziala), null, { timeout: 8000 });
      await gp.evaluate((t) => __powiedz(t), `Hej Cosmos, ${PYT18} numer ${nr18}`);
      return gp.waitForFunction(() => !document.getElementById('voice-zgoda').hidden && voiceState === 'listening' && window.__sr.some((x) => x.dziala),
        null, { timeout: 20000 }).then(() => true).catch(() => false);
    };
    /** Koniec tury i wyjście z trybu głosowego; zwraca żądania do modeli i wiadomości. */
    const po18 = async () => {
      await gp.waitForFunction(() => !zgodaGlosem, null, { timeout: 20000 }).catch(() => {});
      await gp.waitForFunction(() => !isGenerating && activeConversation.messages[activeConversation.messages.length - 1].role === 'assistant', null, { timeout: 30000 }).catch(() => {});
      await spij(300);
      const z = doModeli(await stanAtrapy());
      const m = await gp.evaluate(() => activeConversation.messages.map((x) => (x.zespol ? `zespol:${x.zespol.wklady.map((y) => y.silnik).join('+')}` : x.role)));
      const mowa = await gp.evaluate(() => window.__mowa.join(' '));
      await gp.click('#voice-close').catch(() => {});
      await spij(300);
      return { z, m, mowa, chmura: z.some((x) => x.rodzaj === 'rola' && x.silnik !== 'local'), role: z.some((x) => x.rodzaj === 'rola') };
    };
    await zeruj();
    const jest18 = await zgodaGlosem18();
    await spij(200);
    const g18 = await gp.evaluate(() => ({ mowa: window.__mowa.join(' '), przyciski: [...document.querySelectorAll('#voice-zgoda button')].map((x) => x.textContent),
      kropki: document.querySelectorAll('#voice-overlay .voice-zespol .vz-rola').length }));
    const przed18 = doModeli(await stanAtrapy()).filter((x) => x.rodzaj === 'rola');
    ok(jest18 && /Zespół chce wysłać rozmowę do chmury: (NVIDIA|OpenAI|Claude)(, (NVIDIA|OpenAI|Claude))*\. Powiedz „tak”, „tylko lokalnie” albo „bez agentów” – zgoda obowiązuje do końca tej rozmowy\.$/.test(g18.mowa)
      && g18.przyciski.join('|') === 'Tak|Tylko lokalnie|Bez agentów' && g18.kropki > 0,
      `P18a. tryb głosowy: Cosmos mówi pytanie o chmurę (co wychodzi i na jak długo), na scenie trzy przyciski i kropki ról (${JSON.stringify(g18).slice(0, 400)})`);
    /* Którą chmurę dobierze serwer (NVIDIA albo płatną z lepszą polszczyzną – runda 10),
       nie jest przedmiotem P18: liczy się, że pytanie ją nazywa, a role ruszają dopiero po „tak”. */
    // Serwer czeka na zgodę, zanim ruszy JAKĄKOLWIEK rolę (Z8) – lokalne też nie zajmują GPU na darmo.
    ok(przed18.length === 0, `P18b. zanim padnie odpowiedź, żadna rola nie rusza – ani w chmurze, ani lokalnie (${przed18.map((x) => x.silnik).join(',') || 0})`);
    // Echo ogona pytania z głośnika tuż po końcu mowy – nie rozstrzyga i nie liczy się jako niejasne.
    const mowaPrzed18 = await gp.evaluate(() => window.__mowa.length);
    await gp.evaluate(() => __powiedz('do końca tej rozmowy'));
    await spij(2200);   // 1,4 s ciszy kończy wypowiedź – echo idzie do askVoice osobno
    const echo18 = await gp.evaluate(() => ({ czeka: Boolean(zgodaGlosem), mowa: window.__mowa.length }));
    await zeruj();
    // Odpowiedź powtarzająca słowa pytania (tak, wysłać, chmury) – mikrofonem.
    await gp.evaluate(() => __powiedz('Tak, można wysłać do chmury'));
    const r18c = await po18();
    ok(echo18.czeka && echo18.mowa === mowaPrzed18, `P18c. ogon pytania z głośnika (echo) nie rozstrzyga zgody i nie wywołuje „nie rozumiem” (czeka: ${echo18.czeka}, wypowiedzi: ${mowaPrzed18} → ${echo18.mowa})`);
    ok(r18c.chmura && r18c.m.some((x) => /^zespol:.*(cloud|openai|claude)/.test(x)) && r18c.m[r18c.m.length - 1] === 'assistant'
      && r18c.m.filter((x) => x.startsWith('zespol')).length === 1,
      `P18d. „Tak, można wysłać do chmury” mikrofonem (słowa z pytania) → role w chmurze, jedne notatki, jedna odpowiedź (${r18c.m.join(',')})`);
    for (const [odp, opis] of [['Tak, ale tylko lokalnie', 'P18e. „Tak, ale tylko lokalnie” mikrofonem (75% słów z pytania – nie echo)'],
      ['Ja nie chcę do chmury', 'P18f. „Ja nie chcę do chmury” (przeczenie w środku zdania)'],
      ['Tylko lokalnie, nie wysyłaj rozmowy', 'P18g. „Tylko lokalnie, nie wysyłaj rozmowy”']]) {
      await zgodaGlosem18();
      await spij(600);
      await zeruj();
      await gp.evaluate((o) => __powiedz(o), odp);
      const r = await po18();
      ok(r.role && !r.chmura, `${opis} → role tylko lokalnie, zero żądań do chmury (${r.z.map((x) => `${x.silnik}:${x.rodzaj}`).join(',')})`);
    }
    await zgodaGlosem18();
    await zeruj();
    await gp.click('#voice-zgoda [data-zgoda="lokalnie"]');
    const r18h = await po18();
    ok(r18h.role && r18h.z.every((x) => x.silnik === 'local'), `P18h. „Tylko lokalnie” na scenie → zero żądań do chmury (${r18h.z.map((x) => `${x.silnik}:${x.rodzaj}`).join(',')})`);
    await zgodaGlosem18();
    await zeruj();
    const t18 = Date.now();
    await gp.waitForFunction(() => document.getElementById('voice-zgoda').hidden, null, { timeout: 25000 }).catch(() => {});
    const czekal = Date.now() - t18;
    const r18i = await po18();
    ok(czekal >= 9000 && !r18i.m.some((x) => x.startsWith('zespol')) && r18i.m[r18i.m.length - 1] === 'assistant' && !r18i.role && r18i.z.every((x) => x.silnik === 'local')
      && /bez zespołu/.test(r18i.mowa),
      `P18i. 10 s ciszy → „bez agentów”: odpowiedź bez zespołu, nic do chmury (czekał ${Math.round(czekal / 1000)} s; ${r18i.m.join(',')}; ${r18i.z.map((x) => `${x.silnik}:${x.rodzaj}`).join(',')}; „${r18i.mowa.slice(-120)}”)`);
    // P18j (poza dokładkami): po wyjściu z głosu i ponownym wejściu to samo pierwsze zdanie nie przepada jako „już zużyte”.
    const wejdzIPowiedz = async (tekst) => {
      await gp.evaluate(() => { newConversation(); setEndpoint('cloud'); });
      await gp.click('#voice-btn');
      await gp.waitForFunction(() => voiceMode && voiceState === 'wake' && window.__sr.some((x) => x.dziala), null, { timeout: 8000 });
      await gp.evaluate((t) => __powiedz(t), tekst);
      const ruszyl = await gp.waitForFunction(() => voiceState !== 'wake', null, { timeout: 4000 }).then(() => true).catch(() => false);
      await gp.waitForFunction(() => !isGenerating, null, { timeout: 20000 }).catch(() => {});
      await gp.click('#voice-close').catch(() => {});
      await spij(300);
      return ruszyl;
    };
    const r1 = await wejdzIPowiedz('Hej Cosmos, która godzina');
    const r2 = await wejdzIPowiedz('Hej Cosmos, która godzina');
    ok(r1 && r2, `P18j. to samo pierwsze zdanie po ponownym wejściu w tryb głosowy nie jest ignorowane (1: ${r1}, 2: ${r2})`);
    await gctx.close();

    ok(!bledy.length, `P0. bez błędów strony (${bledy.join(' | ').slice(0, 200)})`);
  } catch (err) {
    w.zapisz(`wyjątek: ${err && err.message}`);
    console.log(err);
  } finally {
    await b.close();
  }
  w.zakoncz();
})();

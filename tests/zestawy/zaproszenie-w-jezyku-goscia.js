/* Formularz zaproszenia mówi językiem przeglądarki gościa.

   Aplikacja startuje po polsku, dopóki ktoś nie wybierze inaczej — to dom
   właściciela. Zaproszona osoba widzi Cosmosa pierwszy raz, często z telefonu
   po angielsku, i formularz „Ustaw login i hasło" po polsku był dla niej
   ścianą, a przełącznika języka nie było gdzie szukać.

   Co musi być prawdą:
     1. Link z zaproszeniem w przeglądarce angielskiej → formularz po angielsku
        (także zdanie z imieniem zapraszającego, składane przez skrypt).
     2. W przeglądarce polskiej → po polsku.
     3. Zapisany wcześniej wybór wygrywa z przeglądarką.
     4. Przełącznik na formularzu zmienia język jednym klikiem, razem ze
        zdaniem z imieniem.
     5. Po dołączeniu (przeładowanie) aplikacja zostaje w języku formularza.
     6. Bez zaproszenia nic się nie zmienia: aplikacja startuje po polsku
        także w przeglądarce angielskiej.
     7. Wybór języka startowego jako czysta funkcja: kolejność preferencji,
        język, którego nie mamy. */
const path = require('node:path');
const { serwerCosmosa, czekajNa, zabij, przegladarka, maPrzegladarke } = require('../pomoc');
const { jezykStartowy } = require(path.join(__dirname, '..', '..', 'public', 'i18n.js'));

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

// --- 7. czysta funkcja — bez przeglądarki ----------------------------------------
const Z = '#zaproszenie=' + 'a'.repeat(24);
ok(jezykStartowy(null, Z, ['en-GB', 'pl']).jezyk === 'en', 'pierwsza preferencja przeglądarki wygrywa (en-GB, pl → en)');
ok(jezykStartowy(null, Z, ['de-DE', 'pl-PL']).jezyk === 'pl', 'język, którego nie mamy, jest pomijany (de, pl → pl)');
ok(jezykStartowy(null, Z, ['de-DE']).jezyk === 'en', 'żadnego naszego na liście → angielski');
ok(jezykStartowy('pl', Z, ['en-US']).jezyk === 'pl' && !jezykStartowy('pl', Z, ['en-US']).zapisz, 'zapisany wybór wygrywa i niczego nie nadpisuje');
ok(jezykStartowy(null, '', ['en-US']).jezyk === 'pl', 'bez zaproszenia — po polsku');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam część przeglądarkową.');
  process.exit(fail.length ? 1 : 0);
}

const PORT = 3497;
const ADRES = `http://127.0.0.1:${PORT}`;
const HASLO = 'haslo-wlasciciela-123';

(async () => {
  const srv = serwerCosmosa(PORT, { COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin', COSMOS_NAZWA: 'Marcin', EMBED_PROVIDER: 'off', SENSES_URL: 'http://127.0.0.1:9' });
  if (!(await czekajNa(`${ADRES}/api/auth`))) { zabij(srv); throw new Error('serwer nie wstał'); }
  const log = await fetch(`${ADRES}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: HASLO }) });
  const ciastko = (log.headers.get('set-cookie') || '').split(';')[0];
  const zapros = async (nazwa) => {
    const r = await fetch(`${ADRES}/api/konta/zaproszenia`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ciastko }, body: JSON.stringify({ nazwa }) });
    return (await r.json()).sciezka;
  };

  const b = await przegladarka();
  const bledy = [];
  const otworz = async (locale, sciezka, zapisany) => {
    const ctx = await b.newContext({ locale, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => bledy.push(e.message));
    if (zapisany) await p.addInitScript((j) => { if (!sessionStorage.getItem('__raz')) { localStorage.setItem('cosmos.lang', j); sessionStorage.setItem('__raz', '1'); } }, zapisany);
    await p.goto(ADRES + sciezka, { waitUntil: 'load' });
    return { ctx, p };
  };
  const formularz = async (p) => {
    await p.waitForFunction(() => document.getElementById('invite-overlay').style.display !== 'none'
      && document.getElementById('invite-name').value !== '', null, { timeout: 8000 }).catch(() => {});
    return p.evaluate(() => ({
      przycisk: document.getElementById('invite-submit').textContent.trim(),
      opis: document.getElementById('invite-sub').textContent.trim(),
      haslo: document.getElementById('invite-pass').placeholder,
      lang: document.documentElement.lang,
      zapisany: localStorage.getItem('cosmos.lang'),
    }));
  };

  // --- 1. przeglądarka angielska --------------------------------------------------
  {
    const { ctx, p } = await otworz('en-GB', await zapros('Ania'));
    const f = await formularz(p);
    ok(f.przycisk === 'Join' && /invited|invites/.test(f.opis) && /password/i.test(f.haslo) && f.lang === 'en',
      `przeglądarka en-GB → formularz po angielsku („${f.przycisk}", „${f.opis.slice(0, 40)}…")`);

    // --- 4. przełącznik na formularzu ----------------------------------------------
    await p.click('#invite-lang');
    const po = await formularz(p);
    ok(po.przycisk === 'Dołącz' && /zaprasza|zaproszenie/.test(po.opis) && po.lang === 'pl',
      `przełącznik → po polsku, razem ze zdaniem z imieniem („${po.opis.slice(0, 40)}…")`);
    await p.click('#invite-lang');

    // --- 5. dołączenie i przeładowanie --------------------------------------------------
    await p.fill('#invite-login', 'ania');
    await p.fill('#invite-pass', 'haslo-ani-12345');
    await p.fill('#invite-pass2', 'haslo-ani-12345');
    await Promise.all([p.waitForNavigation({ waitUntil: 'load' }).catch(() => {}), p.click('#invite-submit')]);
    await p.waitForFunction(() => document.querySelector('.app.gotowa'), null, { timeout: 10000 }).catch(() => {});
    const poDolaczeniu = await p.evaluate(() => ({ lang: document.documentElement.lang, hash: location.hash }));
    ok(poDolaczeniu.lang === 'en' && !poDolaczeniu.hash, `po dołączeniu aplikacja zostaje po angielsku (lang=${poDolaczeniu.lang})`);
    await ctx.close();
  }

  // --- 2. przeglądarka polska ----------------------------------------------------------
  {
    const { ctx, p } = await otworz('pl-PL', await zapros('Kuba'));
    const f = await formularz(p);
    ok(f.przycisk === 'Dołącz' && f.lang === 'pl', `przeglądarka pl-PL → po polsku („${f.przycisk}")`);
    await ctx.close();
  }

  // --- 3. zapisany wybór wygrywa -----------------------------------------------------------
  {
    const { ctx, p } = await otworz('en-US', await zapros('Ola'), 'pl');
    const f = await formularz(p);
    ok(f.przycisk === 'Dołącz' && f.zapisany === 'pl', `zapisane „pl" w przeglądarce en-US → po polsku („${f.przycisk}")`);
    await ctx.close();
  }

  // --- 6. bez zaproszenia bez zmian -----------------------------------------------------------
  {
    const { ctx, p } = await otworz('en-US', '/app');
    await p.waitForSelector('#login-overlay, .app', { timeout: 8000 }).catch(() => {});
    const s = await p.evaluate(() => ({ lang: document.documentElement.lang, zapisany: localStorage.getItem('cosmos.lang') }));
    ok(s.lang === 'pl' && s.zapisany === null, `bez zaproszenia przeglądarka en-US nie zmienia języka aplikacji (lang=${s.lang}, zapis=${s.zapisany})`);
    await ctx.close();
  }

  ok(bledy.length === 0, `bez błędów JavaScript (${bledy.slice(0, 2).join(' | ') || 'brak'})`);
  await b.close();
  zabij(srv);
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nZAPROSZENIE W JĘZYKU GOŚCIA OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

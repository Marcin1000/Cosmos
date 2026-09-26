/* CSP aplikacji – druga linia obrony przed skryptem obcej osoby.

   W DOM Cosmosa trafiają rzeczy od innych ludzi (imiona w panelu Dostęp)
   i od modeli (Markdown odpowiedzi). Pilnują tego textContent i escape – ale
   jedna pomyłka w szablonie to skrypt obcej osoby w sesji właściciela,
   z pełnym dostępem do /api/*. Nagłówek Content-Security-Policy ma sprawić,
   że nawet wtedy przeglądarka takiego skryptu nie uruchomi.

   Co musi być prawdą:
     1. /app ma nagłówek CSP; strona produktowa pod „/" go nie dostaje
        (ma własne skrypty inline i własne potrzeby).
     2. Wstrzyknięty do DOM-u `<img onerror=…>` i `<script>` NIE wykonują się –
        tak wyglądałby błąd w szablonie wykorzystany przez obcą osobę.
     3. Skrypt inline z index.html (motyw przed malowaniem) działa – jego skrót
        serwer liczy z pliku, więc edycja nie psuje polityki po cichu.
     4. Aplikacja pod CSP działa: start i otwarcie paneli bez ani jednego
        naruszenia polityki i bez błędów JavaScript. */
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium – pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

(async () => {
  const env = await srodowisko('pelne');

  // --- 1. nagłówek ----------------------------------------------------------
  const app = await fetch(`${env.adres}/app`);
  const csp = app.headers.get('content-security-policy') || '';
  ok(/script-src 'self' 'sha256-/.test(csp), `/app ma CSP ze skrótem skryptu inline (${csp.slice(0, 70)}…)`);
  ok(/frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp), 'CSP zabrania osadzania i wtyczek');
  const strona = await fetch(`${env.adres}/`);
  ok(!strona.headers.get('content-security-policy'), 'strona produktowa bez CSP aplikacji');

  // --- 2–4. przeglądarka ----------------------------------------------------
  const b = await przegladarka();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const bledy = [];
  p.on('pageerror', (e) => bledy.push(e.message));
  await p.addInitScript(() => {
    window.__naruszenia = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__naruszenia.push(`${e.violatedDirective} ← ${e.blockedURI || 'inline'} (${e.sourceFile || ''}:${e.lineNumber || ''})`);
    });
  });
  await p.goto(`${env.adres}/app`, { waitUntil: 'load' });
  await p.waitForFunction(() => typeof openStudio === 'function');

  const motyw = await p.evaluate(() => document.documentElement.dataset.theme || '');
  ok(motyw === 'dark' || motyw === 'light', `skrypt inline z index.html działa (motyw: ${motyw})`);

  // Otwórz panele tak, jak człowiek – każdy ładuje swoje rzeczy.
  for (const [przycisk, zamknij] of [['#settings-btn', '#settings-close'], ['#studio-btn', '#studio-close'],
    ['#kb-btn', '#kb-close'], ['#gallery-btn', '#gallery-close'], ['#plener-btn', '#plener-close']]) {
    const jest = await p.$(przycisk);
    if (!jest) continue;
    await p.evaluate((s) => document.querySelector(s).click(), przycisk);
    await p.waitForTimeout(500);
    await p.evaluate((s) => { const z = document.querySelector(s); if (z) z.click(); }, zamknij);
    await p.waitForTimeout(200);
  }

  // Błąd w szablonie, który ktoś wykorzystuje: HTML obcej osoby w innerHTML.
  await p.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = '<img src="x-nie-ma" onerror="window.__xss = (window.__xss || 0) + 1">'
      + '<a id="xss-link" href="javascript:window.__xss2=1">x</a>';
    document.body.appendChild(d);
    const s = document.createElement('script');
    s.textContent = 'window.__xss3 = 1';
    document.body.appendChild(s);
    document.getElementById('xss-link').click();
  });
  await p.waitForTimeout(600);
  const xss = await p.evaluate(() => ({ a: window.__xss, b: window.__xss2, c: window.__xss3 }));
  ok(!xss.a, `wstrzyknięty <img onerror> nie wykonuje się (${xss.a || 0})`);
  ok(!xss.b, 'wstrzyknięty link javascript: nie wykonuje się');
  ok(!xss.c, 'wstrzyknięty <script> nie wykonuje się');

  const naruszenia = await p.evaluate(() => window.__naruszenia);
  // Nasze trzy próby są naruszeniami z definicji (skrypt inline) – innych być nie może.
  const wlasne = naruszenia.filter((n) => !/^script-src(-elem|-attr)? ← inline/.test(n));
  ok(naruszenia.length >= 2, `przeglądarka zgłosiła zablokowane próby (${naruszenia.length})`);
  ok(wlasne.length === 0, `aplikacja pod CSP bez naruszeń poza wstrzykniętymi (${wlasne.slice(0, 3).join(' | ') || 'brak'})`);
  ok(bledy.length === 0, `bez błędów JavaScript (${bledy.slice(0, 2).join(' | ') || 'brak'})`);

  await b.close();
  env.koniec();
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nCSP APLIKACJI OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

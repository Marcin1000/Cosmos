/* Układ z rundy 9 – gwarancje wyglądu, które się rozjechały (agencja i zespół IT).
 *
 *  Każdy punkt mierzy WYNIK w przeglądarce (położenie, wysokość, kontrast),
 *  nie brzmienie reguły w arkuszu – przeniesienie CSS w inne miejsce nie
 *  wywraca zestawu, cofnięcie poprawki tak.
 *
 *   1. Telefon w poziomie (740×313, 844×390): panel boczny to szuflada jak
 *      w pionie – po starcie poza ekranem, ikony paska ≥ 24×24, a po otwarciu
 *      „Ustawienia” są osiągalne przewinięciem panelu (dokument stoi).
 *      Na komputerze (1280×720, mysz) panel stoi obok rozmowy.
 *   2. Okna z kartami/filtrami (Ustawienia, Galeria, Nauka): pasek kart
 *      i wysokość okna nie zmieniają się (±1 px) po kliknięciu każdej karty.
 *   3. Kamera → Własne gesty: „Nagraj gest” i „Zapisz” mają kontrast ≥ 4,5:1
 *      w obu motywach (regresja 7719d41: tekst w kolorze tła).
 *   4. Logowanie i zaproszenie w poziomie: przycisk wysyłki na ekranie, nic
 *      do przewinięcia; zaproszenie mieści przycisk także w pionie 358×607;
 *      pola wypełnione z góry mają etykietę <label>; błąd logowania ≥ 4,5:1.
 *   5. Przełączniki w Ustawieniach stoją równo przy prawej krawędzi (±2 px).
 *   6. Kamera: ikony sterowania i migawka na wspólnej osi (±1 px), także po
 *      przełączeniu „Rozpoznawania”; bez treści pod obrazem nie ma pustego pasa.
 *   7. Pod błędem „Wyślij przez Chmurę” i „Ponów” stoją w jednym wierszu.
 *   8. Klasa pod-nakladka pauzuje animacje powitania; na ciemnej scenie
 *      (kamera, tryb głosowy) kolor silnika OpenAI jest jasny w obu motywach.
 *   9. Powitanie na komputerze lżejsze: podpowiedzi cieńsze od nagłówka, bez cienia.
 */
const { serwerCosmosa, czekajNa, przegladarka, maPrzegladarke, wynik } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium – pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

const PORT = 3561;
const PORT_KONTA = 3562;
const ADRES = `http://127.0.0.1:${PORT}`;
const ADRES_KONTA = `http://127.0.0.1:${PORT_KONTA}`;
const HASLO = 'haslo-wlasciciela-123';

const TEL = { width: 358, height: 607 };
const POZIOM = [{ width: 740, height: 313 }, { width: 844, height: 390 }];

// Kontrast WCAG liczony w stronie: tło z najbliższego przodka z kryjącym kolorem.
const KONTRAST = `
  window.__kontrast = (el) => {
    const rgb = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    let e = el, tlo = null;
    while (e) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.9)) { tlo = c; break; } e = e.parentElement; }
    tlo = tlo || [255, 255, 255];
    const a = lum(rgb(getComputedStyle(el).color)), b = lum(tlo);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };`;

(async () => {
  const w = wynik('UKŁAD RUNDY 9');
  const srv = serwerCosmosa(PORT, { SENSES_URL: 'http://127.0.0.1:9', NEMOTRON_BASE_URL: 'http://127.0.0.1:9/v1', EMBED_PROVIDER: 'off' });
  const srvK = serwerCosmosa(PORT_KONTA, { COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin', SENSES_URL: 'http://127.0.0.1:9', EMBED_PROVIDER: 'off' });
  if (!(await czekajNa(`${ADRES}/api/status`)) || !(await czekajNa(`${ADRES_KONTA}/api/auth`))) { w.zapisz('serwer testowy nie wstał'); return w.zakoncz(); }
  const br = await przegladarka({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });

  const strona = async (viewport, { tel = false, motyw = 'light', adres = ADRES, sciezka = '/app' } = {}) => {
    const ctx = await br.newContext({ viewport, isMobile: tel, hasTouch: tel, colorScheme: motyw, serviceWorkers: 'block', permissions: ['camera', 'microphone'] });
    await ctx.addInitScript((m) => { try { localStorage.setItem('cosmos.theme', m); localStorage.setItem('cosmos.lang', 'pl'); } catch {} }, motyw);
    await ctx.addInitScript(KONTRAST);
    const p = await ctx.newPage();
    await p.goto(adres + sciezka, { waitUntil: 'load' });
    if (adres === ADRES) await p.waitForSelector('.app.gotowa', { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(400);
    return p;
  };
  const opis = (v) => `${v.width}×${v.height}`;

  // ---- 1. Telefon w poziomie: szuflada ----------------------------------------
  for (const v of POZIOM) {
    const p = await strona(v, { tel: true });
    const start = await p.evaluate(() => {
      const s = document.querySelector('.sidebar');
      return { poz: getComputedStyle(s).position, prawa: s.getBoundingClientRect().right };
    });
    w.sprawdz(start.poz === 'fixed', `${opis(v)}: panel boczny w poziomie ma być szufladą (position: fixed), jest ${start.poz}`);
    w.sprawdz(start.prawa <= 0, `${opis(v)}: po starcie szuflada ma być schowana (prawa krawędź ${Math.round(start.prawa)} px) – warunek SZUFLADA w app.js`);
    // Niezależnie od stanu startowego: zamknięta szuflada → pełny pasek.
    await p.evaluate(() => { document.getElementById('sidebar').classList.add('collapsed'); document.querySelector('.app').classList.add('sidebar-hidden'); });
    await p.waitForTimeout(350);
    const ikony = await p.evaluate(() => [...document.querySelectorAll('.topbar .icon-btn')].filter((b) => b.offsetWidth)
      .map((b) => ({ id: b.id || b.className, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height })));
    for (const i of ikony) w.sprawdz(i.w >= 24 && i.h >= 24, `${opis(v)}: ikona paska ${i.id} ma ${Math.round(i.w)}×${Math.round(i.h)} px (< 24)`);
    const rozwin = await p.evaluate(() => { const b = document.getElementById('expand-btn'); return b.offsetWidth > 0; });
    w.sprawdz(rozwin, `${opis(v)}: przycisk otwarcia szuflady niewidoczny`);
    if (rozwin) { await p.click('#expand-btn'); await p.waitForTimeout(400); }
    const ust = await p.evaluate(() => {
      const b = document.getElementById('settings-btn');
      b.scrollIntoView({ block: 'nearest' });
      const r = b.getBoundingClientRect();
      const cel = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { dol: r.bottom, vh: innerHeight, trafia: Boolean(cel && b.contains(cel)), dok: document.scrollingElement.scrollTop };
    });
    w.sprawdz(ust.dol <= ust.vh + 0.5 && ust.trafia, `${opis(v)}: „Ustawienia” w szufladzie nieosiągalne (dół ${Math.round(ust.dol)} przy oknie ${ust.vh}, trafia: ${ust.trafia})`);
    w.sprawdz(ust.dok === 0, `${opis(v)}: przewinął się cały dokument (${ust.dok} px), a nie panel`);
    await p.context().close();
  }
  {
    const p = await strona({ width: 1280, height: 720 });
    const poz = await p.evaluate(() => ({ poz: getComputedStyle(document.querySelector('.sidebar')).position, lewa: document.querySelector('.sidebar').getBoundingClientRect().left }));
    w.sprawdz(poz.poz !== 'fixed' && poz.lewa === 0, `1280×720 z myszą: panel boczny ma stać obok rozmowy (${poz.poz}, left ${poz.lewa})`);
    await p.context().close();
  }

  // ---- 2. Okna z kartami: pasek nie skacze --------------------------------------
  const OKNA = [
    ['Ustawienia', '#settings-btn', '#settings-modal', '.set-karty', '.set-karty button:not([hidden])'],
    ['Galeria', '#gallery-btn', '#gallery-modal', '.gallery-filters', '.gallery-filter'],
    ['Nauka', '#learn-btn', '#learn-modal', '.studio-tabs', '.studio-tab'],
  ];
  for (const [v, tel] of [[{ width: 1440, height: 900 }, false], [{ width: 1024, height: 768 }, false], [TEL, true]]) {
    const p = await strona(v, { tel });
    for (const [nazwa, przycisk, okno, pasek, karta] of OKNA) {
      await p.evaluate((s) => document.querySelector(s).click(), przycisk);
      await p.waitForSelector(`${okno} ${pasek}`, { state: 'visible', timeout: 5000 }).catch(() => {});
      await p.waitForTimeout(300);
      const pomiary = await p.evaluate(async ([okno, pasek, karta]) => {
        const wyn = [];
        const karty = [...document.querySelectorAll(`${okno} ${karta}`)].filter((b) => b.offsetWidth);
        for (const k of karty) {
          k.click();
          await new Promise((r) => setTimeout(r, 200));
          wyn.push({ karta: k.textContent.trim().slice(0, 14), top: document.querySelector(`${okno} ${pasek}`).getBoundingClientRect().top, h: document.querySelector(`${okno} .modal`).getBoundingClientRect().height });
        }
        return wyn;
      }, [okno, pasek, karta]);
      w.sprawdz(pomiary.length >= 3, `${nazwa} ${opis(v)}: za mało kart do sprawdzenia (${pomiary.length})`);
      for (const m of pomiary) {
        const skok = Math.max(Math.abs(m.top - pomiary[0].top), Math.abs(m.h - pomiary[0].h));
        w.sprawdz(skok <= 1, `${nazwa} ${opis(v)}: po „${m.karta}” pasek/okno skacze o ${Math.round(skok)} px (top ${Math.round(m.top)} vs ${Math.round(pomiary[0].top)}, wys. ${Math.round(m.h)} vs ${Math.round(pomiary[0].h)})`);
      }
      await p.keyboard.press('Escape');
      await p.waitForTimeout(300);
    }
    await p.context().close();
  }

  // ---- 3, 6, 8b. Kamera -----------------------------------------------------------
  for (const motyw of ['light', 'dark']) {
    for (const [v, tel] of [[TEL, true], [{ width: 1280, height: 800 }, false]]) {
      const p = await strona(v, { tel, motyw });
      await p.evaluate(() => { document.documentElement.dataset.silnik = 'openai'; document.getElementById('live-btn').click(); });
      await p.waitForSelector('#live-panel[data-tryb="pelny"]', { timeout: 8000 }).catch(() => {});
      await p.waitForTimeout(800);
      const tag = `kamera ${opis(v)} ${motyw}`;
      const os = () => p.evaluate(() => ['#live-rozpoznawanie .kam-przel-ikona', '#live-snapshot', '#live-gesty-btn .kam-przel-ikona']
        .map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.top + r.height / 2; }));
      const a = await os();
      w.sprawdz(Math.max(...a) - Math.min(...a) <= 1, `${tag}: ikony sterowania i migawka nie na jednej osi (${a.map(Math.round).join(' / ')})`);
      // Przełączenie „Rozpoznawania” zmienia podpis pod ikoną (także na długi) – oś ma zostać.
      await p.evaluate(() => { const s = document.getElementById('live-rozp-stan'); s.textContent = 'wył. · sam podgląd – czeka na komputer ze zmysłami, który jeszcze się nie odezwał'; });
      await p.waitForTimeout(100);
      const b = await os();
      w.sprawdz(a.every((x, i) => Math.abs(x - b[i]) <= 1), `${tag}: długi stan przesuwa przyciski (${a.map(Math.round).join('/')} → ${b.map(Math.round).join('/')})`);
      // Ciemna scena: kolor silnika OpenAI jasny także w jasnym motywie.
      const jasnosc = await p.evaluate(() => {
        const s = document.createElement('i'); s.style.cssText = 'position:absolute;width:4px;height:4px;background:var(--k-akt)';
        document.getElementById('live-panel').appendChild(s);
        const c = (getComputedStyle(s).backgroundColor.match(/[\d.]+/g) || []).map(Number); s.remove();
        return (c[0] + c[1] + c[2]) / 3;
      });
      w.sprawdz(jasnosc > 150, `${tag}: kolor silnika OpenAI na ciemnej scenie kamery za ciemny (średnio ${Math.round(jasnosc)})`);
      await p.evaluate(() => document.getElementById('live-gesty-btn').click());
      await p.waitForTimeout(300);
      const kontr = await p.evaluate(() => ['#gest-nagraj', '#gest-zapisz'].map((q) => { const e = document.querySelector(q); e.disabled = false; return [q, window.__kontrast(e)]; }));
      for (const [q, k] of kontr) w.sprawdz(k >= 4.5, `${tag}: ${q} ma kontrast ${k.toFixed(2)}:1 (< 4,5)`);
      await p.context().close();
    }
  }
  // Pusty pas pod obrazem: bez wyjaśnienia, nastaw i gestów.
  for (const [v, tel, poziom] of [[TEL, true, false], [{ width: 740, height: 313 }, true, true]]) {
    const p = await strona(v, { tel });
    await p.evaluate(() => document.getElementById('live-btn').click());
    await p.waitForSelector('#live-panel[data-tryb="pelny"]', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(600);
    const r = await p.evaluate(() => {
      document.getElementById('live-wyjasnienie').hidden = true;
      document.getElementById('plan-box').hidden = true;
      document.getElementById('live-gesty').open = false;
      const st = document.getElementById('live-stage').getBoundingClientRect();
      const ks = document.querySelector('.kam-ster').getBoundingClientRect();
      return { pas: ks.top - st.bottom, dol: innerHeight - st.bottom };
    });
    if (poziom) w.sprawdz(r.dol <= 8, `kamera 740×313: pod obrazem pusty pas ${Math.round(r.dol)} px`);
    else w.sprawdz(r.pas <= 12, `kamera 358×607: między obrazem a przyciskami pusty pas ${Math.round(r.pas)} px`);
    await p.context().close();
  }

  // ---- 4. Logowanie i zaproszenie -------------------------------------------------
  for (const motyw of ['light', 'dark']) {
    for (const v of [...POZIOM, TEL]) {
      const p = await strona(v, { tel: true, motyw, adres: ADRES_KONTA });
      await p.waitForSelector('#login-overlay', { state: 'visible', timeout: 8000 }).catch(() => {});
      await p.fill('#login-login', 'marcin');
      await p.fill('#login-password', 'zle-haslo-123');
      await p.evaluate(() => document.getElementById('login-submit').click());
      await p.waitForFunction(() => document.getElementById('login-error').textContent.trim() !== '', null, { timeout: 5000 }).catch(() => {});
      const r = await p.evaluate(() => {
        const o = document.getElementById('login-overlay'), b = document.getElementById('login-submit'), e = document.getElementById('login-error');
        return { dol: b.getBoundingClientRect().bottom, vh: innerHeight, nadmiar: o.scrollHeight - o.clientHeight, blad: e.textContent.trim(), k: window.__kontrast(e) };
      });
      const tag = `logowanie ${opis(v)} ${motyw}`;
      w.sprawdz(r.dol <= r.vh && r.nadmiar <= 0, `${tag}: „Zaloguj” poza ekranem (dół ${Math.round(r.dol)} przy ${r.vh}, do przewinięcia ${r.nadmiar} px)`);
      w.sprawdz(r.blad && r.k >= 4.5, `${tag}: komunikat błędu ${r.blad ? `ma kontrast ${r.k.toFixed(2)}:1` : 'się nie pojawił'}`);
      await p.context().close();
    }
  }
  {
    const lg = await fetch(`${ADRES_KONTA}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: HASLO }) });
    const ciastko = (lg.headers.get('set-cookie') || '').split(';')[0];
    for (const v of [{ width: 740, height: 313 }, TEL]) {
      const z = await (await fetch(`${ADRES_KONTA}/api/konta/zaproszenia`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ciastko }, body: JSON.stringify({ nazwa: 'Bartek' }) })).json();
      const p = await strona(v, { tel: true, adres: ADRES_KONTA, sciezka: z.sciezka });
      await p.waitForFunction(() => document.getElementById('invite-name').value !== '', null, { timeout: 8000 }).catch(() => {});
      const r = await p.evaluate(() => {
        const o = document.getElementById('invite-overlay'), b = document.getElementById('invite-submit');
        const bezEtykiety = ['invite-name', 'invite-login'].filter((id) => { const i = document.getElementById(id); return !(i.labels && i.labels.length && i.labels[0].textContent.trim()); });
        return { dol: b.getBoundingClientRect().bottom, vh: innerHeight, nadmiar: o.scrollHeight - o.clientHeight, bezEtykiety };
      });
      w.sprawdz(r.dol <= r.vh, `zaproszenie ${opis(v)}: „Dołącz” poza ekranem (dół ${Math.round(r.dol)} przy ${r.vh})`);
      if (v.width > v.height) w.sprawdz(r.nadmiar <= 0, `zaproszenie ${opis(v)}: formularz do przewinięcia o ${r.nadmiar} px`);
      w.sprawdz(!r.bezEtykiety.length, `zaproszenie: pola wypełnione z góry bez widocznej etykiety <label>: ${r.bezEtykiety.join(', ')}`);
      await p.context().close();
    }
  }

  // ---- 5. Przełączniki w Ustawieniach równo po prawej -----------------------------
  for (const [v, tel] of [[{ width: 1440, height: 900 }, false], [TEL, true]]) {
    const p = await strona(v, { tel });
    await p.evaluate(() => document.getElementById('settings-btn').click());
    await p.waitForSelector('#settings-modal .set-karty', { state: 'visible' });
    const odstepy = await p.evaluate(async () => {
      const wyn = [];
      for (const k of document.querySelectorAll('#settings-modal .set-karty button:not([hidden])')) {
        k.click();
        await new Promise((r) => setTimeout(r, 100));
        for (const wiersz of document.querySelectorAll('#settings-modal .set-wiersz')) {
          const s = wiersz.querySelector('.zm-suwak');
          if (!s || !s.offsetWidth) continue;
          // Względem treści SEKCJI, nie wiersza: wiersz-flex kurczy się do treści.
          const sek = wiersz.parentElement, r = sek.getBoundingClientRect(), cs = getComputedStyle(sek);
          wyn.push({ karta: k.textContent.trim(), odstep: r.right - parseFloat(cs.paddingRight) - s.getBoundingClientRect().right });
        }
      }
      return wyn;
    });
    w.sprawdz(odstepy.length >= 3, `przełączniki ${opis(v)}: za mało wierszy do sprawdzenia (${odstepy.length})`);
    for (const o of odstepy) w.sprawdz(Math.abs(o.odstep) <= 2, `przełączniki ${opis(v)}: w karcie „${o.karta}” suwak ${Math.round(o.odstep)} px od prawej krawędzi sekcji`);
    await p.context().close();
  }

  // ---- 7, 8a, 9. Powitanie, przyciski błędu, pauza pod nakładką -------------------
  for (const motyw of ['light', 'dark']) {
    const p = await strona({ width: 1440, height: 900 }, { motyw });
    const pow = await p.evaluate(() => {
      const s = getComputedStyle(document.querySelector('.suggestion')), h = getComputedStyle(document.querySelector('.welcome h1'));
      return { sw: Number(s.fontWeight), hw: Number(h.fontWeight), cien: s.boxShadow };
    });
    w.sprawdz(pow.sw < pow.hw && pow.cien === 'none', `powitanie 1440 ${motyw}: podpowiedzi mają być lżejsze od nagłówka i bez cienia (grubość ${pow.sw} vs ${pow.hw}, cień ${pow.cien})`);

    const anim = await p.evaluate(async () => {
      const biegnie = () => document.getAnimations().filter((a) => a.playState === 'running' && /welcome/.test(a.animationName || '')).length;
      const przed = biegnie();
      document.documentElement.classList.add('pod-nakladka');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const pod = biegnie();
      document.documentElement.classList.remove('pod-nakladka');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { przed, pod, po: biegnie() };
    });
    w.sprawdz(anim.przed > 0 && anim.pod === 0 && anim.po > 0, `pod-nakladka ${motyw}: animacje powitania ${anim.przed} → pod nakładką ${anim.pod} → po ${anim.po} (ma być >0 → 0 → >0)`);

    // Tryb głosowy: kolor silnika OpenAI na nocnej scenie.
    const glos = await p.evaluate(() => {
      document.documentElement.dataset.silnik = 'openai';
      const s = document.createElement('i'); s.style.cssText = 'position:absolute;width:4px;height:4px;background:var(--k-akt)';
      document.getElementById('voice-overlay').appendChild(s);
      const c = (getComputedStyle(s).backgroundColor.match(/[\d.]+/g) || []).map(Number); s.remove();
      return (c[0] + c[1] + c[2]) / 3;
    });
    w.sprawdz(glos > 150, `tryb głosowy ${motyw}: kolor silnika OpenAI na ciemnej scenie za ciemny (średnio ${Math.round(glos)})`);
    await p.context().close();

    // Przyciski pod błędem: taki układ, jaki buduje app.js (opakowanie, chmura pierwsza).
    for (const [v, tel] of [[TEL, true], [{ width: 1440, height: 900 }, false]]) {
      const q = await strona(v, { tel, motyw });
      const r = await q.evaluate(() => {
        const msg = document.createElement('div'); msg.className = 'msg msg-error';
        msg.innerHTML = '<div class="msg-content">Komputer w domu nie odpowiada – lokalny model jest uśpiony albo wyłączony.<div class="msg-bledu-akcje"><button class="msg-action-btn msg-ponow msg-przez-chmure">Wyślij przez Chmurę</button><button class="msg-action-btn msg-ponow ik ik-odswiez">Ponów</button></div></div>';
        document.getElementById('messages').appendChild(msg);
        const [c, p] = [...msg.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
        const kropka = getComputedStyle(msg.querySelector('.msg-przez-chmure'), '::before');
        return { dt: Math.abs(c.top - p.top), kolejnosc: c.left < p.left, kropka: kropka.content !== 'none' && kropka.backgroundColor !== 'rgba(0, 0, 0, 0)' };
      });
      w.sprawdz(r.dt <= 2 && r.kolejnosc, `błąd ${opis(v)} ${motyw}: „Wyślij przez Chmurę” i „Ponów” nie w jednym wierszu (różnica ${Math.round(r.dt)} px, chmura pierwsza: ${r.kolejnosc})`);
      w.sprawdz(r.kropka, `błąd ${opis(v)} ${motyw}: przycisk chmury bez kropki w kolorze silnika`);
      await q.context().close();
    }
  }

  await br.close();
  srv.kill(); srvK.kill();
  w.zakoncz();
})().catch((e) => { console.error(e); process.exit(1); });

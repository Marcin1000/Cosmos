/* Ekran powitalny na telefonie stoi w miejscu – nic się nie przewija.
 *
 *  Marcin (wrzesień 2026): „główny ekran Cosmosa można przesuwać góra dół,
 *  a lepiej żeby był w jednej pozycji. Góra mi się podoba z logiem, ładnym
 *  tekstem i aktywnym modelem”. Znak, etykieta, nagłówek, długa nazwa modelu
 *  i cztery podpowiedzi w kolumnie wystawały nad pole wiadomości o ~150 px.
 *
 *  Okna jak w panel-kamery-miesci: 360×600 i 360×700 (telefon Marcina,
 *  przeglądarka i PWA), 740×313 w poziomie, 1280×720 laptop. Gwarancje:
 *    1. obszar rozmowy nie ma czego przewijać (scrollHeight ≤ clientHeight),
 *    2. znak, etykieta, nagłówek i aktywny model są na ekranie w całości
 *       (w poziomie sam nagłówek i model – znak i etykieta ustępują),
 *       a nazwa modelu mieści się w JEDNYM wierszu i nie jest ucięta
 *       (pełna nazwa zostaje w podpowiedzi `title`),
 *    3. każda podpowiedź jest w całości nad polem wiadomości, klikalna
 *       (nic jej nie zasłania) i ma co najmniej 40 px wysokości pod palec,
 *    4. nic nie wystaje w bok.
 */
const { srodowisko, przegladarka, maPrzegladarke, wynik } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium – pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

// Ostatnia kolumna: elementy górnej części, które MUSZĄ być widoczne. W poziomie
// (~140 px na rozmowę) znak i etykieta ustępują nagłówkowi i podpowiedziom.
const CALA_GORA = ['.welcome-icon', '.welcome-et', '.welcome h1', '.welcome-sub'];
const OKNA = [
  ['telefon 360×600', { width: 360, height: 600 }, true, CALA_GORA],
  ['telefon 360×700', { width: 360, height: 700 }, true, CALA_GORA],
  ['telefon poziomo 740×313', { width: 740, height: 313 }, true, ['.welcome h1', '.welcome-sub']],
  ['laptop 1280×720', { width: 1280, height: 720 }, false, CALA_GORA],
];
// Najdłuższa nazwa, jaką Marcin widzi na co dzień (zrzut z telefonu).
const MODEL = 'nvidia/nemotron-3-super-120b-a12b';

(async () => {
  const w = wynik('POWITANIE BEZ PRZEWIJANIA');
  const env = await srodowisko('goly');
  const br = await przegladarka();

  for (const [nazwa, viewport, tel, gora] of OKNA) {
    for (const jezyk of ['pl', 'en']) {
      const ctx = await br.newContext({ viewport, isMobile: tel, hasTouch: tel });
      await ctx.addInitScript((j) => { try { localStorage.setItem('cosmos.lang', j); } catch {} }, jezyk);
      const pg = await ctx.newPage();
      await pg.goto(`${env.adres}/app`, { waitUntil: 'load' });
      await pg.waitForSelector('.app.gotowa', { timeout: 10000 }).catch(() => {});
      // Nazwę ustawia aplikacja tą samą drogą co pole w Ustawieniach – nadpisanie modelu.
      await pg.evaluate((m) => { settings[POLE_MODELU[endpoint]] = m; updateModelBadge(); }, MODEL);
      await pg.waitForTimeout(300);
      const tag = `${nazwa} (${jezyk})`;

      const r = await pg.evaluate((gora) => {
        const rect = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const scroll = document.getElementById('chat-scroll');
        const sc = rect(scroll);
        const composer = rect(document.querySelector('.composer-wrap'));
        const dol = Math.min(sc.b, composer.t);
        const naEkranie = (b) => b.w > 0 && b.h > 0 && b.l >= -1 && b.r <= innerWidth + 1 && b.t >= sc.t - 1 && b.b <= dol + 1;
        const klikalna = (el) => {
          const b = el.getBoundingClientRect();
          const x = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return Boolean(x) && (x === el || el.contains(x));
        };
        const model = document.getElementById('welcome-model');
        const sub = document.querySelector('.welcome-sub');
        const lh = parseFloat(getComputedStyle(sub).lineHeight) || parseFloat(getComputedStyle(sub).fontSize) * 1.5;
        return {
          przewijanie: scroll.scrollHeight - scroll.clientHeight,
          wbok: document.documentElement.scrollWidth - innerWidth,
          gora: gora.map((s) => [s, naEkranie(rect(document.querySelector(s)))]),
          modelWiersze: Math.round(rect(sub).h / lh),
          modelUciety: model.scrollWidth > model.clientWidth + 1,
          modelTekst: model.textContent, modelTytul: model.title || sub.title || '',
          podpowiedzi: [...document.querySelectorAll('.suggestion')].map((el) => ({
            tekst: el.textContent.trim(), naEkranie: naEkranie(rect(el)), klikalna: klikalna(el), h: rect(el).h,
          })),
        };
      }, gora);

      w.sprawdz(r.przewijanie <= 1, `${tag}: 1. ekran powitalny przewija się o ${r.przewijanie} px`);
      for (const [s, ok] of r.gora) w.sprawdz(ok, `${tag}: 2. ${s} nie jest w całości na ekranie`);
      w.sprawdz(r.modelWiersze === 1, `${tag}: 2. „Aktywny model” zajmuje ${r.modelWiersze} wiersze`);
      w.sprawdz(!r.modelUciety || r.modelTytul.includes('nemotron-3-super-120b-a12b'), `${tag}: 2. nazwa modelu ucięta bez pełnej nazwy w podpowiedzi`);
      w.sprawdz(r.modelTekst.includes('nemotron'), `${tag}: 2. nazwa modelu nie pokazuje się („${r.modelTekst}”)`);
      w.sprawdz(r.podpowiedzi.length >= 3, `${tag}: 3. tylko ${r.podpowiedzi.length} podpowiedzi`);
      for (const p of r.podpowiedzi) {
        w.sprawdz(p.naEkranie, `${tag}: 3. podpowiedź „${p.tekst}” nie mieści się nad polem wiadomości`);
        w.sprawdz(p.klikalna, `${tag}: 3. podpowiedź „${p.tekst}” jest zasłonięta`);
        w.sprawdz(p.h >= 40, `${tag}: 3. podpowiedź „${p.tekst}” ma ${Math.round(p.h)} px – za mało pod palec`);
      }
      w.sprawdz(r.wbok <= 1, `${tag}: 4. strona wystaje w bok o ${r.wbok} px`);
      console.log(`${tag}: przewijanie ${r.przewijanie} px, model ${r.modelWiersze} wiersz(e)`);
      await ctx.close();
    }
  }
  await br.close();
  w.zakoncz();
})().catch((e) => { console.error(e); process.exit(1); });

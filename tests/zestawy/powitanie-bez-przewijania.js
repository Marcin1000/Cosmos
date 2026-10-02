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
 *    4. nic nie wystaje w bok,
 *    5. na telefonie podpowiedzi są LŻEJSZE od nagłówka (Marcin: „ciężar
 *       całości jest przesunięty na te opcje”): zwykła grubość i tekst
 *       jaśniejszy niż w nagłówku, ale nadal czytelny – kontrast ≥ 4,5:1
 *       w jasnym i ciemnym motywie,
 *    6. „Od czego zaczynamy?” stoi w JEDNEJ linii i nie wystaje poza kolumnę –
 *       także z otwartą klawiaturą (Android: interactive-widget=resizes-content
 *       zmniejsza okno do 360×410, przy większej klawiaturze 360×380 –
 *       wtedy podpowiedzi idą w rząd pigułek przewijany palcem),
 *    7. na dotyku pasek przewijania rozmowy nie zabiera szerokości (runda 11:
 *       globalny ::-webkit-scrollbar 8 px zwężał kolumnę 328 → 320 px i łamał
 *       nagłówek – zrzuty Marcina 2dce7c26, 9b5758cf),
 *    8. klasa `klawiatura` na <html> (iOS, z visualViewport) daje to samo
 *       zwarte powitanie co niskie okno,
 *    9. wpisany tekst chowa podpowiedzi (dotknięcie podpowiedzi wysyła ją
 *       od razu – przypadkowe muśnięcie nie może zabrać zaczętego zdania).
 *
 *  Chromium idzie z PRAWDZIWYMI paskami przewijania (`paskiPrzewijania`):
 *  Playwright bez okna je ukrywa i dlatego błąd paska przeszedł niezauważony.
 *  Każde okno w PL i EN, w jasnym i ciemnym motywie.
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
  ['telefon 360×740', { width: 360, height: 740 }, true, CALA_GORA],
  // Klawiatura otwarta: zostaje pytanie i podpowiedzi (znak, etykieta i model są na pasku górnym).
  ['telefon z klawiaturą 360×410', { width: 360, height: 410 }, true, ['.welcome h1']],
  ['telefon z dużą klawiaturą 360×380', { width: 360, height: 380 }, true, ['.welcome h1']],
  ['telefon poziomo 740×313', { width: 740, height: 313 }, true, ['.welcome h1', '.welcome-sub']],
  ['laptop 1280×720', { width: 1280, height: 720 }, false, CALA_GORA],
];
// Najdłuższa nazwa, jaką Marcin widzi na co dzień (zrzut z telefonu).
const MODEL = 'nvidia/nemotron-3-super-120b-a12b';

(async () => {
  const w = wynik('POWITANIE BEZ PRZEWIJANIA');
  const env = await srodowisko('goly');
  const br = await przegladarka({ paskiPrzewijania: true });

  for (const [nazwa, viewport, tel, gora] of OKNA) {
    for (const [jezyk, motyw] of [['pl', 'light'], ['pl', 'dark'], ['en', 'light'], ['en', 'dark']]) {
      const ctx = await br.newContext({ viewport, isMobile: tel, hasTouch: tel, colorScheme: motyw });
      await ctx.addInitScript((j) => { try { localStorage.setItem('cosmos.lang', j); } catch {} }, jezyk);
      const pg = await ctx.newPage();
      await pg.goto(`${env.adres}/app`, { waitUntil: 'load' });
      await pg.waitForSelector('.app.gotowa', { timeout: 10000 }).catch(() => {});
      // Nazwę ustawia aplikacja tą samą drogą co pole w Ustawieniach – nadpisanie modelu.
      await pg.evaluate((m) => { settings[POLE_MODELU[endpoint]] = m; updateModelBadge(); }, MODEL);
      await pg.waitForTimeout(300);
      const tag = `${nazwa} (${jezyk}, ${motyw})`;

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
        // Kolor jako [r,g,b] – przeglądarka liczy color-mix i zmienne za nas.
        const rgb = (c) => { const x = document.createElement('i'); x.style.color = c; document.body.append(x);
          const v = getComputedStyle(x).color; x.remove();
          const cv = document.createElement('canvas').getContext('2d'); cv.fillStyle = v; cv.fillRect(0, 0, 1, 1);
          return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3); };
        const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
          .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
        const kontrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const tlo = rgb(getComputedStyle(document.body).backgroundColor);
        const pierwsza = document.querySelector('.suggestion');
        const h1 = document.querySelector('.welcome h1');
        const waga = {
          podp: Number(getComputedStyle(pierwsza).fontWeight), h1: Number(getComputedStyle(h1).fontWeight),
          kPodp: kontrast(rgb(getComputedStyle(pierwsza).color), tlo),
          kH1: kontrast(rgb(getComputedStyle(h1).color), tlo),
        };
        const h1b = rect(h1);
        const em = h1.querySelector('em') || h1;
        const naglowek = {
          linie: em.getClientRects().length,
          wystaje: h1.scrollWidth - h1.clientWidth,
          poza: Math.max(0, -em.getBoundingClientRect().left, em.getBoundingClientRect().right - innerWidth),
          tekst: h1.textContent.trim(), naEkranie: naEkranie(h1b),
        };
        const sug = document.getElementById('suggestions');
        const pigulki = getComputedStyle(sug).display === 'flex';
        const model = document.getElementById('welcome-model');
        const sub = document.querySelector('.welcome-sub');
        const lh = parseFloat(getComputedStyle(sub).lineHeight) || parseFloat(getComputedStyle(sub).fontSize) * 1.5;
        return {
          waga, naglowek, pigulki, rzadPrzewijany: sug.scrollWidth > sug.clientWidth + 1,
          modelWidoczny: sub.getClientRects().length > 0,
          przewijanie: scroll.scrollHeight - scroll.clientHeight,
          wbok: document.documentElement.scrollWidth - innerWidth,
          gora: gora.map((s) => [s, naEkranie(rect(document.querySelector(s)))]),
          modelWiersze: Math.round(rect(sub).h / lh),
          modelUciety: model.scrollWidth > model.clientWidth + 1,
          modelTekst: model.textContent, modelTytul: model.title || sub.title || '',
          podpowiedzi: [...document.querySelectorAll('.suggestion')].map((el) => {
            const b = rect(el);
            return {
              tekst: el.textContent.trim(), naEkranie: naEkranie(b), klikalna: klikalna(el), h: b.h,
              wPionie: b.h > 0 && b.t >= sc.t - 1 && b.b <= dol + 1,
            };
          }),
        };
      }, gora);

      w.sprawdz(r.przewijanie <= 1, `${tag}: 1. ekran powitalny przewija się o ${r.przewijanie} px`);
      for (const [s, ok] of r.gora) w.sprawdz(ok, `${tag}: 2. ${s} nie jest w całości na ekranie`);
      if (gora.includes('.welcome-sub')) w.sprawdz(r.modelWiersze === 1, `${tag}: 2. „Aktywny model” zajmuje ${r.modelWiersze} wiersze`);
      w.sprawdz(!r.modelUciety || r.modelTytul.includes('nemotron-3-super-120b-a12b'), `${tag}: 2. nazwa modelu ucięta bez pełnej nazwy w podpowiedzi`);
      w.sprawdz(r.modelTekst.includes('nemotron'), `${tag}: 2. nazwa modelu nie pokazuje się („${r.modelTekst}”)`);
      w.sprawdz(r.podpowiedzi.length >= 3, `${tag}: 3. tylko ${r.podpowiedzi.length} podpowiedzi`);
      // Rząd pigułek (bardzo nisko): pierwsza w całości, reszta w tym samym rzędzie, dostępna gestem w bok.
      r.podpowiedzi.forEach((p, i) => {
        const cala = !r.pigulki || i === 0;
        w.sprawdz(cala ? p.naEkranie : p.wPionie, `${tag}: 3. podpowiedź „${p.tekst}” nie mieści się nad polem wiadomości`);
        if (cala) w.sprawdz(p.klikalna, `${tag}: 3. podpowiedź „${p.tekst}” jest zasłonięta`);
        w.sprawdz(p.h >= 40, `${tag}: 3. podpowiedź „${p.tekst}” ma ${Math.round(p.h)} px – za mało pod palec`);
      });
      if (r.pigulki) w.sprawdz(r.rzadPrzewijany, `${tag}: 3. rząd pigułek nie przewija się w bok – część podpowiedzi niedostępna`);
      const n = r.naglowek;
      w.sprawdz(n.linie === 1, `${tag}: 6. „${n.tekst}” łamie się na ${n.linie} linie`);
      w.sprawdz(n.wystaje <= 1 && n.poza <= 1, `${tag}: 6. „${n.tekst}” wystaje poza kolumnę (${n.wystaje} px / ${Math.round(n.poza)} px poza ekran)`);
      if (tel) {
        const { podp, h1, kPodp, kH1 } = r.waga;
        w.sprawdz(podp <= 400 && podp < h1, `${tag}: 5. podpowiedzi mają grubość ${podp} (nagłówek ${h1}) – ciężar idzie w dół ekranu`);
        w.sprawdz(kPodp < kH1 - 1, `${tag}: 5. podpowiedzi tak ciemne jak nagłówek (kontrast ${kPodp.toFixed(1)} vs ${kH1.toFixed(1)})`);
        w.sprawdz(kPodp >= 4.5, `${tag}: 5. podpowiedzi nieczytelne (kontrast ${kPodp.toFixed(1)}:1 < 4,5:1)`);
      }
      w.sprawdz(r.wbok <= 1, `${tag}: 4. strona wystaje w bok o ${r.wbok} px`);
      if (tel) {
        // 7. Rozmowa dłuższa niż ekran: pasek na dotyku jest nakładką, kolumna nie traci szerokości.
        const pasek = await pg.evaluate(() => {
          const cs = document.getElementById('chat-scroll');
          const atrapa = document.createElement('div'); atrapa.style.height = '3000px';
          document.getElementById('messages').append(atrapa);
          const px = cs.offsetWidth - cs.clientWidth; atrapa.remove(); return px;
        });
        w.sprawdz(pasek === 0, `${tag}: 7. pasek przewijania zabiera ${pasek} px szerokości na dotyku`);
        // 9. Wpisany tekst chowa podpowiedzi.
        await pg.fill('#input', 'Zaczęte zdanie');
        await pg.waitForTimeout(250);
        const ukryte = await pg.evaluate(() => getComputedStyle(document.getElementById('suggestions')).visibility === 'hidden');
        w.sprawdz(ukryte, `${tag}: 9. podpowiedzi zostają pod palcem, choć w polu jest wpisany tekst`);
        await pg.fill('#input', '');
      }
      console.log(`${tag}: przewijanie ${r.przewijanie} px, nagłówek ${r.naglowek.linie} linia, model ${r.modelWidoczny ? r.modelWiersze + ' wiersz(e)' : 'schowany'}`);
      await ctx.close();
    }
  }

  // 8. iOS: Safari nie zmniejsza okna pod klawiaturę – app.js ustawia klasę `klawiatura` na <html>.
  for (const [jezyk, motyw] of [['pl', 'light'], ['en', 'dark']]) {
    const ctx = await br.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, colorScheme: motyw });
    await ctx.addInitScript((j) => { try { localStorage.setItem('cosmos.lang', j); } catch {} }, jezyk);
    const pg = await ctx.newPage();
    await pg.goto(`${env.adres}/app`, { waitUntil: 'load' });
    await pg.waitForSelector('.app.gotowa', { timeout: 10000 }).catch(() => {});
    await pg.evaluate(() => document.documentElement.classList.add('klawiatura'));
    await pg.waitForTimeout(300);
    const r = await pg.evaluate(() => {
      const widac = (s) => document.querySelector(s).getClientRects().length > 0;
      const h1 = document.querySelector('.welcome h1');
      return {
        znak: widac('.welcome-icon'), model: widac('.welcome-sub'),
        linie: (h1.querySelector('em') || h1).getClientRects().length, wystaje: h1.scrollWidth - h1.clientWidth,
      };
    });
    const tag = `iOS z klawiaturą 360×740 (${jezyk}, ${motyw})`;
    w.sprawdz(!r.znak && !r.model, `${tag}: 8. html.klawiatura nie zwija powitania (znak ${r.znak}, model ${r.model})`);
    w.sprawdz(r.linie === 1 && r.wystaje <= 1, `${tag}: 8. nagłówek ${r.linie} linie, wystaje ${r.wystaje} px`);
    await ctx.close();
  }
  await br.close();
  w.zakoncz();
})().catch((e) => { console.error(e); process.exit(1); });

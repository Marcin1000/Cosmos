/* Kamera na pełnym ekranie MIEŚCI SIĘ – w każdym oknie i przy każdym kadrze.
 *
 *  Marcin (runda 8, zrzuty 03, 16, 17, 22): „okno kamery kiepsko wygląda
 *  i nie dobrze się składa z pozostałymi informacjami. W przeglądarce
 *  w ogóle nie pokazuje nastaw, a kiedy telefon weźmiemy poziomo, to
 *  tragicznie to wygląda”. Pływający panel miał siedem warstw łatek i każda
 *  runda naprawiała jeden rozmiar, psując inny.
 *
 *  Poprzednia wersja tego zestawu przepuściła te zrzuty, bo: „da się
 *  doprzewijać” liczyło się jako sukces, okna nie udawały telefonu
 *  (isMobile/hasTouch), atrapa kamery była 4:3, a kadr pionowy był tylko
 *  wstrzykiwaną zmienną CSS. Teraz:
 *    – okna Marcina: 360×600 i 360×700 (telefon z powiększonym tekstem),
 *      740×313 w poziomie, oraz 1280×720 i 1440×900,
 *    – PRAWDZIWY strumień z płótna 720×1280 (pion) i 1280×720 (poziom),
 *    – gwarancje:
 *      1. widok zajmuje całe okno i nic nie wystaje w bok,
 *      2. migawka, rozpoznawanie, zamknięcie, źródło i nastawy są w całości
 *         na ekranie BEZ przewijania i nic ich nie zasłania,
 *      3. obraz ma proporcję strumienia (±2 %) i – gdy kadr ma orientację
 *         ekranu – zajmuje co najmniej 25 % (telefon) albo 35 % ekranu,
 *      4. źródło i nastawy w jednej linii, bez uciętego tekstu,
 *      5. kontrolki nie nachodzą na siebie ani na obraz,
 *      6. „Rozpoznawanie” mówi SŁOWAMI, w jakim jest stanie,
 *      7. po zamknięciu kamera jest zwolniona (0 żywych ścieżek)
 *         i nic nie odpytuje /api/detect.
 */
const { srodowisko, przegladarka, maPrzegladarke, KATALOG_ZRZUTOW } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium – pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

const OKNA = [
  ['telefon 360×600', { width: 360, height: 600 }, true],
  ['telefon 360×700', { width: 360, height: 700 }, true],
  ['telefon poziomo 740×313', { width: 740, height: 313 }, true],
  ['laptop 1280×720', { width: 1280, height: 720 }, false],
  ['desktop 1440×900', { width: 1440, height: 900 }, false],
];
const KADRY = [['pion', 720, 1280], ['poziom', 1280, 720]];

/* Atrapa kamery: strumień z płótna o zadanych wymiarach. Każdy strumień
   trafia do listy, żeby po zamknięciu sprawdzić, czy ścieżki są zatrzymane. */
function atrapaKamery([w, h]) {
  window.__strumienie = [];
  const daj = async () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const rysuj = () => { g.fillStyle = '#3a6'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(w * 0.4, h * 0.4, w * 0.2, h * 0.2); };
    rysuj();
    setInterval(rysuj, 200);
    const s = c.captureStream(10);
    window.__strumienie.push(s);
    return s;
  };
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {} });
  navigator.mediaDevices.getUserMedia = daj;
  navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'videoinput', deviceId: 'a', label: 'atrapa' }];
}

(async () => {
  const fail = [];
  const env = await srodowisko('goly');
  // Nastawy kadru pokazują się tylko przy znanym miejscu – bez niego nie ma czego mierzyć.
  await fetch(`${env.adres}/api/location`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: 'Piaseczno', lat: 52.08, lon: 21.02 }),
  }).catch(() => {});
  const br = await przegladarka();

  for (const [nazwa, viewport, tel] of OKNA) {
    for (const [kadr, kw, kh] of KADRY) {
      const ctx = await br.newContext({ viewport, isMobile: tel, hasTouch: tel });
      await ctx.addInitScript(atrapaKamery, [kw, kh]);
      const pg = await ctx.newPage();
      const bledy = [];
      pg.on('pageerror', (e) => bledy.push(e.message));
      let detekcji = 0;
      await pg.route('**/api/detect', (r) => { detekcji++; r.fulfill({ status: 503, body: '{}' }); });
      await pg.goto(`${env.adres}/app`, { waitUntil: 'load' });
      await pg.waitForSelector('.app.gotowa', { timeout: 10000 }).catch(() => {});
      await pg.evaluate(() => { try { localStorage.removeItem('cosmos.kameraTryb'); } catch {} });
      await pg.evaluate(() => document.getElementById('live-btn').click());
      await pg.waitForFunction(() => document.getElementById('live-video').videoWidth > 0, null, { timeout: 8000 }).catch(() => {});
      await pg.waitForFunction(() => !document.getElementById('plan-box').hidden, null, { timeout: 5000 }).catch(() => {});
      await pg.waitForTimeout(400);
      const tag = `${nazwa}, kadr ${kadr}`;

      const r = await pg.evaluate(() => {
        const rect = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const naEkranie = (b) => b.w > 0 && b.l >= -1 && b.t >= -1 && b.r <= innerWidth + 1 && b.b <= innerHeight + 1;
        const nieZaslonieta = (el) => {
          const b = el.getBoundingClientRect();
          const x = el.ownerDocument.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return Boolean(x) && (x === el || el.contains(x));
        };
        const panel = document.getElementById('live-panel');
        const video = document.getElementById('live-video');
        const scena = rect(document.getElementById('live-stage'));
        // Prostokąt samego obrazu w scenie (object-fit: contain).
        const vw = video.videoWidth; const vh = video.videoHeight;
        const skala = Math.min(scena.w / vw, scena.h / vh);
        const obraz = { w: vw * skala, h: vh * skala };
        const plan = document.querySelector('#plan-box > summary');
        const kontrolki = {
          migawka: document.getElementById('live-snapshot'),
          rozpoznawanie: document.getElementById('live-rozpoznawanie'),
          zamknij: document.getElementById('live-close'),
          zrodlo: document.querySelector('.kam-zrodlo'),
          okienko: document.getElementById('live-do-okienka'),
          gesty: document.getElementById('live-gesty-btn'),
          nastawy: plan && plan.offsetParent ? plan : null,
        };
        const wynik = {};
        for (const [k, el] of Object.entries(kontrolki)) {
          if (!el) { wynik[k] = null; continue; }
          wynik[k] = { ...rect(el), naEkranie: naEkranie(rect(el)), widoczna: nieZaslonieta(el) };
        }
        const select = document.getElementById('live-source');
        const shot = document.getElementById('plan-shot');
        return {
          okno: { w: innerWidth, h: innerHeight },
          panel: rect(panel), tryb: panel.dataset.tryb,
          wystaje: document.documentElement.scrollWidth - innerWidth,
          scena, obraz, vw, vh,
          kontrolki: wynik,
          zrodloJednaLinia: select.getBoundingClientRect().height <= 46,
          nastawyTekst: shot ? shot.textContent : '',
          nastawyUciete: shot ? shot.scrollWidth > shot.clientWidth + 1 : false,
          nastawyWiersze: shot ? Math.round(shot.getBoundingClientRect().height / parseFloat(getComputedStyle(shot).lineHeight || '20')) : 0,
          stanWl: document.getElementById('live-rozp-stan').textContent,
        };
      });

      // 1. cały ekran, nic w bok
      if (r.tryb !== 'pelny') fail.push(`${tag}: kamera nie otwiera się na pełnym ekranie (${r.tryb})`);
      if (Math.abs(r.panel.w - r.okno.w) > 1 || Math.abs(r.panel.h - r.okno.h) > 1) fail.push(`${tag}: widok ${Math.round(r.panel.w)}×${Math.round(r.panel.h)} nie zajmuje okna ${r.okno.w}×${r.okno.h}`);
      if (r.wystaje > 0) fail.push(`${tag}: strona wystaje w bok o ${r.wystaje} px`);
      // 2. kontrolki na ekranie, nic ich nie zasłania
      for (const [k, v] of Object.entries(r.kontrolki)) {
        if (!v) { if (k === 'nastawy') fail.push(`${tag}: nastaw kadru nie widać`); continue; }
        if (!v.naEkranie) fail.push(`${tag}: ${k} poza ekranem (${Math.round(v.l)},${Math.round(v.t)}–${Math.round(v.r)},${Math.round(v.b)})`);
        else if (!v.widoczna) fail.push(`${tag}: ${k} zasłonięte`);
      }
      // 3. proporcja i wielkość obrazu
      if (!r.vw) fail.push(`${tag}: brak obrazu z atrapy`);
      else {
        if (Math.abs(r.vw / r.vh - kw / kh) > 0.02 * (kw / kh)) fail.push(`${tag}: strumień ma inną proporcję niż atrapa`);
        const pole = (r.obraz.w * r.obraz.h) / (r.okno.w * r.okno.h);
        const minimum = tel ? 0.25 : 0.35;
        // Kadr pionowy na ekranie poziomym (i odwrotnie) z definicji zajmuje mało – liczy się proporcja.
        const zgodny = (kw > kh) === (r.okno.w > r.okno.h);
        if (zgodny && pole < minimum) fail.push(`${tag}: obraz zajmuje tylko ${Math.round(pole * 100)}% ekranu (minimum ${minimum * 100}%)`);
      }
      // 4. jedna linia
      if (!r.zrodloJednaLinia) fail.push(`${tag}: wybór źródła nie mieści się w jednej linii`);
      if (r.nastawyUciete) fail.push(`${tag}: nastawy kadru ucięte („${r.nastawyTekst}”)`);
      if (r.nastawyWiersze > 1) fail.push(`${tag}: nastawy kadru w ${r.nastawyWiersze} wierszach`);
      // 5. nic na siebie nie nachodzi
      const lista = Object.entries(r.kontrolki).filter(([, v]) => v && v.w);
      const tnie = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
      for (let i = 0; i < lista.length; i++) {
        if (tnie(lista[i][1], r.scena)) fail.push(`${tag}: ${lista[i][0]} nachodzi na obraz (${Math.round(lista[i][1].t)}–${Math.round(lista[i][1].b)} wobec obrazu ${Math.round(r.scena.t)}–${Math.round(r.scena.b)})`);
        for (let j = i + 1; j < lista.length; j++) {
          if (tnie(lista[i][1], lista[j][1])) fail.push(`${tag}: ${lista[i][0]} nachodzi na ${lista[j][0]}`);
        }
      }
      // 6. stan słowami, różny dla wł. i wył.
      await pg.evaluate(() => document.getElementById('live-rozpoznawanie').click());
      await pg.waitForTimeout(100);
      const stanWyl = await pg.$eval('#live-rozp-stan', (e) => e.textContent);
      await pg.evaluate(() => document.getElementById('live-rozpoznawanie').click());
      if (!r.stanWl || !stanWyl || r.stanWl === stanWyl) fail.push(`${tag}: „Rozpoznawanie” nie mówi stanu słowami („${r.stanWl}” / „${stanWyl}”)`);

      console.log(`${tag}: obraz ${Math.round(r.obraz.w)}×${Math.round(r.obraz.h)}, nastawy „${r.nastawyTekst}”, stan „${r.stanWl}”/„${stanWyl}”`);
      await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/kamera-${viewport.width}x${viewport.height}-${kadr}.png` });

      // 7. zamknięcie zwalnia kamerę i gasi odpytywanie
      await pg.evaluate(() => document.getElementById('live-close').click());
      await pg.waitForTimeout(300);
      const przed = detekcji;
      await pg.waitForTimeout(3500);
      const sciezki = await pg.evaluate(() => (window.__strumienie || []).flatMap((s) => s.getTracks()).filter((t) => t.readyState === 'live').length);
      if (sciezki) fail.push(`${tag}: po zamknięciu ${sciezki} ścieżek kamery dalej działa`);
      if (detekcji !== przed) fail.push(`${tag}: po zamknięciu dalej odpytuje /api/detect (${detekcji - przed}×)`);
      if (bledy.length) fail.push(`${tag}: błędy JS: ${bledy.join(' | ')}`);
      await ctx.close();
    }
  }

  await br.close();
  env.koniec();
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nKAMERA MIEŚCI SIĘ OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Podgląd ma znać proporcję kadru TAKŻE przy wyłączonym komputerze domowym.

   Marcin, ze zrzutów z telefonu: „na mobile to cały czas nie wygląda dobrze".
   Na obu zrzutach widać ten sam obraz – wąski pasek pośrodku, obłożony
   czarnymi pasami z lewej i z prawej, zajmującymi więcej miejsca niż sam kadr.

   Przyczyna nie była w układzie, tylko w tym, KTO ustawia proporcję sceny.
   `liveMediaSize()` – jedyne miejsce, które czyta wymiary strumienia i podaje
   je CSS-owi jako `--live-ar` – wisiało wyłącznie w pętli `liveDetect()`.
   A `liveDetect()` ma co robić dopiero wtedy, gdy działają zmysły z YOLO.
   Status na zrzucie mówił to wprost: „Podgląd działa, ale bez rozpoznawania
   obiektów. Rozpoznawanie liczy komputer z GPU, nie telefon."

   Czyli: przy wyłączonym komputerze domowym scena zostawała na domyślnym 4:3,
   choć telefon podaje 9:16. Sam podgląd działał – tylko wyglądał źle.

   Zestaw `panel-kamery-miesci` tego nie łapał i nie mógł: sam PODSTAWIA
   `--live-ar` przed pomiarem, żeby sprawdzić układ przy kadrze pionowym.
   Sprawdzał więc, co układ robi z podaną proporcją, a nigdy tego, czy
   aplikacja w ogóle ją sobie ustawia. Stąd osobny zestaw i osobne środowisko
   – BEZ zmysłów, bo o to tu właśnie chodzi.
*/
const { srodowisko, przegladarka, maPrzegladarke, KATALOG_ZRZUTOW } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium – pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

(async () => {
  const fail = [];
  // `goly` = serwer bez atrap, więc i bez usługi zmysłów. Dokładnie sytuacja
  // Marcina z telefonu przy wyłączonym komputerze domowym.
  const env = await srodowisko('goly');
  /* Bez współrzędnych pudełko nastaw zostaje ukryte, a wtedy pomiar „czy
     status na nie nachodzi" mierzy odległość do elementu o zerowych wymiarach
     i wypisuje bzdurę (772 px). Pierwsza wersja tego zestawu tak właśnie
     zrobiła i sama się na tym złapała. */
  await fetch(`${env.adres}/api/location`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: 'Piaseczno', lat: 52.2297, lon: 21.0122 }),
  }).catch(() => {});
  const br = await przegladarka({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  ] });

  for (const [nazwa, viewport] of [
    ['telefon 360×700', { width: 360, height: 700 }],
    ['telefon poziomo 740×313', { width: 740, height: 313 }],
    ['desktop 1440×900', { width: 1440, height: 900 }],
  ]) {
    const tel = viewport.width < 800;
    const ctx = await br.newContext({ viewport, permissions: ['camera'], isMobile: tel, hasTouch: tel });
    const pg = await ctx.newPage();
    await pg.goto(env.adres + '/app', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1200);
    await pg.click('#live-btn');
    await pg.waitForTimeout(2500);

    const r = await pg.evaluate(() => {
      const panel = document.getElementById('live-panel');
      const scena = document.getElementById('live-stage');
      const wideo = document.getElementById('live-video');
      const sr = scena.getBoundingClientRect();
      return {
        // Czy kod W OGÓLE ustawił proporcję, czy scena stoi na domyślnej z CSS.
        ustawione: panel.style.getPropertyValue('--live-arn').trim(),
        status: (document.getElementById('live-status').textContent || '').slice(0, 40),
        mediaW: wideo.videoWidth,
        mediaH: wideo.videoHeight,
        scenaProporcja: sr.width / sr.height,
        scenaW: Math.round(sr.width),
        scenaH: Math.round(sr.height),
      };
    });

    const mediaProporcja = r.mediaH ? r.mediaW / r.mediaH : 0;
    console.log(`\n${nazwa}  (status: „${r.status}…")`);
    console.log(`   strumień ${r.mediaW}×${r.mediaH} (${mediaProporcja.toFixed(2)}), --live-arn ustawione przez kod: ${r.ustawione || 'NIE'}`);

    if (!r.mediaW || !r.mediaH) {
      fail.push(`${nazwa}: atrapa kamery nie podała wymiarów – zestaw nic nie mierzy`);
      await ctx.close();
      continue;
    }
    /* Sedno. Bez tego sprawdzenia zestaw przechodziłby na atrapie Chromium,
       która akurat jest 4:3 – czyli przypadkiem taka jak wartość domyślna. */
    if (!r.ustawione) {
      fail.push(`${nazwa}: kod nie ustawił \`--live-arn\` – okienko stoi na domyślnym 4:3 `
        + 'z CSS, więc kadr pionowy dostanie czarne pasy (zmysły są wyłączone)');
    }

    /* --- WYJAŚNIENIE OBOK OBRAZU, NIGDY NA NIM ----------------------
     *  Dawniej sześciowierszowe wyjaśnienie („Podgląd działa, ale…”) stało
     *  nad podglądem, potem w dymku ⓘ, który zasłaniał pół kadru (runda 8,
     *  zrzut 18). Teraz na kadrze stoi krótka pigułka stanu, a wyjaśnienie –
     *  pod obrazem (telefon) albo w panelu obok (komputer). Gwarancja: jest
     *  widoczne bez dotykania i nie zachodzi na obraz ani na przyciski. */
    await pg.evaluate(() => { const box = document.getElementById('plan-box'); if (box) box.open = true; });
    await pg.waitForTimeout(600);
    const w = await pg.evaluate(() => {
      const pr = (id) => document.getElementById(id).getBoundingClientRect();
      const tnie = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const wyj = document.getElementById('live-wyjasnienie');
      const wr = wyj.getBoundingClientRect();
      const pig = document.getElementById('live-status');
      return {
        tekst: (wyj.textContent || '').slice(0, 40),
        widoczne: !wyj.hidden && wr.height > 0 && wr.bottom <= innerHeight + 1,
        naObrazie: tnie(wr, pr('live-stage')),
        naPrzyciskach: ['live-snapshot', 'live-rozpoznawanie', 'live-close'].filter((id) => tnie(wr, pr(id))),
        pigulka: pig.hidden ? '' : pig.textContent,
        stan: document.getElementById('live-rozp-stan').textContent,
      };
    });
    console.log(`   wyjaśnienie: „${w.tekst}…", widoczne=${w.widoczne}, na obrazie=${w.naObrazie}; pigułka „${w.pigulka}”, stan przycisku „${w.stan}”`);
    // W poziomie telefonu (~313 px) wyjaśnienie celowo znika – mówi to pigułka na kadrze.
    const poziom = viewport.height < 400;
    if (poziom) {
      if (!/Sam podgląd|Preview only/.test(w.pigulka)) fail.push(`${nazwa}: w poziomie pigułka na kadrze nie mówi, że to sam podgląd („${w.pigulka}”)`);
    } else if (!w.widoczne) fail.push(`${nazwa}: wyjaśnienie o wyłączonym rozpoznawaniu nie jest widoczne`);
    if (!/nie odpowiada|not responding/i.test(w.tekst)) fail.push(`${nazwa}: wyjaśnienie nie mówi, że komputer ze zmysłami nie odpowiada („${w.tekst}”)`);
    if (w.naObrazie) fail.push(`${nazwa}: wyjaśnienie zasłania obraz`);
    if (w.naPrzyciskach.length) fail.push(`${nazwa}: wyjaśnienie zasłania ${w.naPrzyciskach.join(', ')}`);
    if (w.pigulka.length > 60) fail.push(`${nazwa}: na kadrze stoi długi tekst zamiast krótkiego stanu (${w.pigulka.length} znaków)`);
    if (!/czeka|waiting/i.test(w.stan)) fail.push(`${nazwa}: przycisk rozpoznawania nie mówi, że czeka („${w.stan}”)`);

    /* --- OKIENKO MA KSZTAŁT KADRU ------------------------------------
     *  Na pełnym ekranie obraz jest cały (contain) w polu sceny. Okienko
     *  przy rozmowie jest małe – tam czarne pasy byłyby połową podglądu,
     *  więc ma dokładnie proporcję strumienia. */
    await pg.click('#live-do-okienka');
    await pg.waitForTimeout(500);
    const m = await pg.evaluate(() => {
      const sr = document.getElementById('live-stage').getBoundingClientRect();
      return { p: sr.width / sr.height, w: Math.round(sr.width), h: Math.round(sr.height) };
    });
    const pasyProc = mediaProporcja && m.p > mediaProporcja
      ? Math.round((1 - mediaProporcja / m.p) * 100)
      : Math.round((1 - m.p / mediaProporcja) * 100);
    console.log(`   okienko ${m.w}×${m.h} (${m.p.toFixed(2)}), czarne pasy: ${pasyProc}%`);
    if (pasyProc > 5) fail.push(`${nazwa}: okienko ma inną proporcję niż strumień – czarne pasy ${pasyProc}%`);

    await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/proporcja-bez-zmyslow-${viewport.width}.png` });
    await ctx.close();
  }

  await br.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPROPORCJA BEZ ZMYSŁÓW OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Podgląd ma znać proporcję kadru TAKŻE przy wyłączonym komputerze domowym.

   Marcin, ze zrzutów z telefonu: „na mobile to cały czas nie wygląda dobrze".
   Na obu zrzutach widać ten sam obraz — wąski pasek pośrodku, obłożony
   czarnymi pasami z lewej i z prawej, zajmującymi więcej miejsca niż sam kadr.

   Przyczyna nie była w układzie, tylko w tym, KTO ustawia proporcję sceny.
   `liveMediaSize()` — jedyne miejsce, które czyta wymiary strumienia i podaje
   je CSS-owi jako `--live-ar` — wisiało wyłącznie w pętli `liveDetect()`.
   A `liveDetect()` ma co robić dopiero wtedy, gdy działają zmysły z YOLO.
   Status na zrzucie mówił to wprost: „Podgląd działa, ale bez rozpoznawania
   obiektów. Rozpoznawanie liczy komputer z GPU, nie telefon."

   Czyli: przy wyłączonym komputerze domowym scena zostawała na domyślnym 4:3,
   choć telefon podaje 9:16. Sam podgląd działał — tylko wyglądał źle.

   Zestaw `panel-kamery-miesci` tego nie łapał i nie mógł: sam PODSTAWIA
   `--live-ar` przed pomiarem, żeby sprawdzić układ przy kadrze pionowym.
   Sprawdzał więc, co układ robi z podaną proporcją, a nigdy tego, czy
   aplikacja w ogóle ją sobie ustawia. Stąd osobny zestaw i osobne środowisko
   — BEZ zmysłów, bo o to tu właśnie chodzi.
*/
const { srodowisko, przegladarka, maPrzegladarke, KATALOG_ZRZUTOW } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam zestaw przeglądarkowy.');
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
    body: JSON.stringify({ location: 'Złotokłos', lat: 52.0247, lon: 20.9019 }),
  }).catch(() => {});
  const br = await przegladarka({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  ] });

  for (const [nazwa, viewport] of [
    ['telefon 390×844', { width: 390, height: 844 }],
    ['desktop 1440×900', { width: 1440, height: 900 }],
  ]) {
    const ctx = await br.newContext({ viewport, permissions: ['camera'] });
    const pg = await ctx.newPage();
    await pg.goto(env.adres, { waitUntil: 'domcontentloaded' });
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
    /* Ile szerokości sceny zajmuje czerń. Przy `object-fit: contain` obraz
       węższy od sceny zostawia pasy po bokach — i to jest liczba, na którą
       Marcin patrzył, a nie żadna proporcja w konsoli. */
    const pasyProc = mediaProporcja && r.scenaProporcja > mediaProporcja
      ? Math.round((1 - mediaProporcja / r.scenaProporcja) * 100)
      : 0;

    console.log(`\n${nazwa}  (status: „${r.status}…")`);
    console.log(`   strumień ${r.mediaW}×${r.mediaH} (${mediaProporcja.toFixed(2)}), `
      + `scena ${r.scenaW}×${r.scenaH} (${r.scenaProporcja.toFixed(2)})`);
    console.log(`   --live-arn ustawione przez kod: ${r.ustawione || 'NIE'}, `
      + `czarne pasy: ${pasyProc}% szerokości`);

    if (!r.mediaW || !r.mediaH) {
      fail.push(`${nazwa}: atrapa kamery nie podała wymiarów — zestaw nic nie mierzy`);
      await ctx.close();
      continue;
    }
    /* Sedno. Bez tego sprawdzenia zestaw przechodziłby na atrapie Chromium,
       która akurat jest 4:3 — czyli przypadkiem taka jak wartość domyślna. */
    if (!r.ustawione) {
      fail.push(`${nazwa}: kod nie ustawił \`--live-arn\` — scena stoi na domyślnym 4:3 `
        + 'z CSS, więc kadr pionowy dostanie czarne pasy (zmysły są wyłączone)');
    }
    if (pasyProc > 5) {
      fail.push(`${nazwa}: czarne pasy zajmują ${pasyProc}% szerokości sceny `
        + `(strumień ${mediaProporcja.toFixed(2)}, scena ${r.scenaProporcja.toFixed(2)})`);
    }
    /* --- STATUS NIE MOŻE WCHODZIĆ POD NASTAWY -------------------------
     *
     *  Marcin: „ten tekst »Podgląd działa, ale…« wchodzi nieładnie pod
     *  Nastawy, zarówno na mobile, jak i na desktop."
     *
     *  Ten komunikat istnieje TYLKO przy wyłączonych zmysłach — ma sześć
     *  wierszy i to on się nie mieścił. Zestaw `panel-kamery-miesci` nie mógł
     *  tego zobaczyć, bo działa z atrapą zmysłów włączoną i status jest tam
     *  krótki („nic nie wykryto"). Dlatego sprawdzenie jest tutaj: to jedyne
     *  środowisko z prawdziwie długim tekstem.
     *
     *  Mierzymy dwie rzeczy. Po pierwsze wysokość CO DO WIERSZA — ucięcie
     *  w połowie wiersza wygląda dokładnie jak tekst wchodzący pod ramkę
     *  poniżej. Po drugie brak poziomego rozjazdu, bo to drugie zgłoszenie
     *  z tej samej pary zrzutów. */
    await pg.evaluate(() => {
      const box = document.getElementById('plan-box');
      if (box) box.open = true;
    });
    await pg.waitForTimeout(900);
    const st = await pg.evaluate(() => {
      const el = document.getElementById('live-status');
      const body = document.getElementById('live-body');
      const box = document.getElementById('plan-box');
      const cs = getComputedStyle(el);
      const er = el.getBoundingClientRect();
      const gora = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      return {
        tekst: el.textContent.slice(0, 30),
        wierszy: (er.height - gora) / parseFloat(cs.lineHeight),
        pelnaTresc: el.scrollHeight > el.clientHeight + 1,
        // Pudełko musi być WIDOCZNE, inaczej pomiar nie znaczy nic.
        boxWidoczny: Boolean(box) && box.getBoundingClientRect().height > 0,
        // Czym wysokość jest ZAGWARANTOWANA, a nie ile akurat wyszło.
        lineHeight: cs.lineHeight,
        maxHeight: cs.maxHeight,
        nachodzi: box ? Math.round(er.bottom - box.getBoundingClientRect().top) : 0,
        zaSzeroko: body ? body.scrollWidth - body.clientWidth : 0,
      };
    });
    console.log(`   status „${st.tekst}…": ${st.wierszy.toFixed(2)} wiersza, `
      + `ucięty: ${st.pelnaTresc}, nachodzi na nastawy: ${st.nachodzi} px, `
      + `poziomy rozjazd: ${st.zaSzeroko} px`);
    if (!st.pelnaTresc) {
      fail.push(`${nazwa}: status mieści się w całości — zestaw mierzy nie ten stan `
        + '(komunikat o wyłączonych zmysłach ma być długi)');
    }
    if (Math.abs(st.wierszy - Math.round(st.wierszy)) > 0.15) {
      fail.push(`${nazwa}: status ma ${st.wierszy.toFixed(2)} wiersza — ostatni jest ucięty `
        + 'w połowie i wchodzi pod ramkę nastaw');
    }
    /* SPRAWDZAMY GWARANCJĘ, NIE PRÓBKĘ — i to jest tu najważniejsze zdanie.
     *
     *  Marcin widział na telefonie kawałek trzeciego wiersza wchodzący pod
     *  ramkę nastaw. W Chromium w kontenerze ta sama wersja kodu daje 2,05
     *  wiersza, czyli niewidoczny jeden piksel: pomiar wysokości NIE ODTWARZA
     *  jego usterki i gdyby zestaw opierał się tylko na nim, przechodziłby
     *  na kodzie, który u użytkownika jest zepsuty.
     *
     *  Bo usterka nie brała się z liczby, tylko z tego, CO tę liczbę ustala.
     *  Przy `line-height: normal` wysokość wiersza wyznacza font urządzenia,
     *  a obcięcie zależało od `overflow: hidden` — więc gdzie dokładnie
     *  tnie, rozstrzygał krój pisma w telefonie. Na jednym wypadało równo
     *  na wierszu, na innym w jego połowie.
     *
     *  Dlatego pytamy o mechanizm: `line-height` musi być podany wprost,
     *  a `max-height` policzone w tych samych jednostkach. Wtedy wysokość
     *  jest wielokrotnością wiersza Z KONSTRUKCJI, na każdym urządzeniu —
     *  także takim, którego nigdy nie zobaczymy w tym zestawie. */
    if (st.lineHeight === 'normal') {
      fail.push(`${nazwa}: status ma \`line-height: normal\` — wysokość wiersza zależy `
        + 'wtedy od fontu urządzenia i obcięcie potrafi wypaść w połowie wiersza');
    }
    if (!st.maxHeight || st.maxHeight === 'none') {
      fail.push(`${nazwa}: status nie ma \`max-height\` liczonego w wierszach — `
        + 'obcięcie zależy wtedy wyłącznie od `overflow`, bez gwarancji, gdzie tnie');
    }
    if (!st.boxWidoczny) {
      fail.push(`${nazwa}: pudełko nastaw jest ukryte — pomiar nachodzenia nic nie znaczy`);
    } else if (st.nachodzi > 1) {
      fail.push(`${nazwa}: status nachodzi na pudełko nastaw o ${st.nachodzi} px`);
    }
    if (st.zaSzeroko > 1) {
      fail.push(`${nazwa}: dolna część jest o ${st.zaSzeroko} px szersza niż panel `
        + '— poziomy rozjazd');
    }

    await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/proporcja-bez-zmyslow-${viewport.width}.png` });
    await ctx.close();
  }

  await br.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPROPORCJA BEZ ZMYSŁÓW OK');
  process.exit(fail.length ? 1 : 0);
})();

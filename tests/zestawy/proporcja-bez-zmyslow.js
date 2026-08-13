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
    /* --- WYJAŚNIENIE POD ⓘ, A NIE NAD PODGLĄDEM ----------------------
     *
     *  Marcin: „ten tekst »Podgląd działa, ale…« wchodzi nieładnie pod
     *  Nastawy" — a potem: „to ⓘ umieśćmy gdzieś w rogu po prostu.
     *  To nam wykluczy chyba problem."
     *
     *  Miał rację i to jest inne rozwiązanie niż lepsze mieszczenie tekstu.
     *  Dopóki sześciowierszowe wyjaśnienie stało w kolumnie nad podglądem,
     *  każda jego długość była czyimś problemem: kłóciło się o wysokość
     *  z obrazem i z nastawami, a kolejne poprawki tylko przesuwały ten spór.
     *  W rogu nagłówka nie kłóci się o nic.
     *
     *  Zestaw sprawdza więc WŁAŚCIWOŚĆ, nie wygląd: pokazanie wyjaśnienia
     *  nie ma prawa przesunąć ani obrazu, ani wysokości panelu. Ten komunikat
     *  istnieje tylko przy wyłączonych zmysłach, czyli w tym środowisku. */
    await pg.evaluate(() => {
      const box = document.getElementById('plan-box');
      if (box) box.open = true;
    });
    await pg.waitForTimeout(900);

    const przed = await pg.evaluate(() => {
      const panel = document.getElementById('live-panel');
      const scena = document.getElementById('live-stage');
      const status = document.getElementById('live-status');
      const info = document.getElementById('live-info');
      return {
        panelH: Math.round(panel.getBoundingClientRect().height),
        scenaH: Math.round(scena.getBoundingClientRect().height),
        statusWidoczny: !status.hidden && status.getBoundingClientRect().height > 0,
        infoWidoczny: !info.hidden && info.getBoundingClientRect().width > 0,
        dymekWidoczny: !document.getElementById('live-info-box').hidden,
      };
    });
    console.log(`   pasek statusu widoczny: ${przed.statusWidoczny}, `
      + `ⓘ w nagłówku: ${przed.infoWidoczny}, dymek otwarty: ${przed.dymekWidoczny}`);

    if (przed.statusWidoczny) {
      fail.push(`${nazwa}: pasek statusu zajmuje miejsce, choć nie ma bieżącego stanu `
        + 'do pokazania — wyjaśnienie ma być pod ⓘ');
    }
    if (!przed.infoWidoczny) {
      fail.push(`${nazwa}: brak ⓘ w nagłówku, a jest co wyjaśnić `
        + '(zmysły wyłączone) — treść stała się nieosiągalna');
    }
    if (przed.dymekWidoczny) fail.push(`${nazwa}: dymek ⓘ jest otwarty sam z siebie`);

    // Dotknięcie ⓘ — tak, jak robi to Marcin na telefonie.
    await pg.click('#live-info');
    await pg.waitForTimeout(400);
    const po = await pg.evaluate(() => {
      const panel = document.getElementById('live-panel');
      const scena = document.getElementById('live-stage');
      const dymek = document.getElementById('live-info-box');
      const body = document.getElementById('live-body');
      const dr = dymek.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      return {
        panelH: Math.round(pr.height),
        scenaH: Math.round(scena.getBoundingClientRect().height),
        widoczny: !dymek.hidden && dr.height > 0,
        tresc: (dymek.textContent || '').slice(0, 30),
        pelnaTresc: dymek.scrollHeight <= dymek.clientHeight + 1,
        wPanelu: dr.left >= pr.left - 1 && dr.right <= pr.right + 1
          && dr.top >= pr.top - 1 && dr.bottom <= pr.bottom + 1,
        zaSzeroko: body ? body.scrollWidth - body.clientWidth : 0,
      };
    });
    console.log(`   po dotknięciu ⓘ: „${po.tresc}…", panel ${przed.panelH}→${po.panelH} px, `
      + `obraz ${przed.scenaH}→${po.scenaH} px, w panelu: ${po.wPanelu}`);

    if (!po.widoczny) fail.push(`${nazwa}: dotknięcie ⓘ nie pokazało wyjaśnienia`);
    if (!/Podgl/.test(po.tresc)) {
      fail.push(`${nazwa}: dymek ⓘ nie zawiera komunikatu o wyłączonym rozpoznawaniu `
        + `(jest „${po.tresc}")`);
    }
    /* SEDNO CAŁEJ ZMIANY. Wyjaśnienie ma nie kosztować układu ani piksela —
       dlatego dymek leży NAD treścią, a nie w kolumnie. */
    if (po.panelH !== przed.panelH) {
      fail.push(`${nazwa}: pokazanie ⓘ zmieniło wysokość panelu `
        + `${przed.panelH} → ${po.panelH} px — dymek przesuwa układ`);
    }
    if (po.scenaH !== przed.scenaH) {
      fail.push(`${nazwa}: pokazanie ⓘ zmieniło wysokość obrazu `
        + `${przed.scenaH} → ${po.scenaH} px`);
    }
    if (!po.wPanelu) fail.push(`${nazwa}: dymek ⓘ wychodzi poza panel`);
    if (!po.pelnaTresc) {
      fail.push(`${nazwa}: treść nie mieści się w dymku i nie da się jej doczytać`);
    }
    if (po.zaSzeroko > 1) {
      fail.push(`${nazwa}: dolna część jest o ${po.zaSzeroko} px szersza niż panel `
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

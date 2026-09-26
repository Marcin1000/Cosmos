const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Skarga Marcina: „rozjechane niektóre pola plus strzałki dropdownów są bardzo
// blisko prawego obrysu pola". Mierzymy jedno i drugie, w obu motywach.

(async () => {
  const env = await srodowisko('katalogModeli');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const fail = [];
  const br = await przegladarka();

  for (const motyw of ['dark', 'light']) {
    for (const [w, h] of [[1280, 900], [360, 740]]) {
      const pg = await br.newPage({ viewport: { width: w, height: h }, isMobile: w < 500, hasTouch: w < 500 });
      await pg.addInitScript((m) => localStorage.setItem('cosmos.theme', m), motyw);
      await pg.goto(`${ADRES}/app`);
      await pg.evaluate((m) => document.documentElement.setAttribute('data-theme', m), motyw);
      await pg.evaluate(() => document.getElementById('settings-btn').click());
      await pg.waitForTimeout(400);
      // wypełnij listę mikrofonów bardzo długą nazwą — to ona rozpychała wiersz
      await pg.evaluate(() => {
        const s = document.getElementById('set-mic');
        s.innerHTML = '<option>Domyślny mikrofon systemu</option>'
          + '<option>Zestaw słuchawkowy Galaxy Buds3 Pro (Bluetooth) — mikrofon kierunkowy, kanał lewy</option>';
      });
      await pg.evaluate(() => document.getElementById('fetch-models-cloud').click());
      await pg.waitForTimeout(1200);

      const r = await pg.evaluate(() => {
        const modal = document.querySelector('#settings-modal .modal');
        const box = modal.getBoundingClientRect();
        const out = [];
        for (const el of modal.querySelectorAll('select, input[type="text"], input[type="time"], input[type="number"]')) {
          const b = el.getBoundingClientRect();
          if (!b.width) continue;
          const cs = getComputedStyle(el);
          out.push({
            id: el.id || el.tagName.toLowerCase(),
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type') || '',
            poza: Math.round(Math.max(0, b.right - box.right) + Math.max(0, box.left - b.left)),
            padRight: parseFloat(cs.paddingRight),
            tlo: cs.backgroundColor,
            kolor: cs.color,
          });
        }
        return { out, przewijaSie: modal.scrollWidth > modal.clientWidth + 1 };
      });

      const poza = r.out.filter((x) => x.poza > 1);
      const ciasne = r.out.filter((x) => x.tag === 'select' && x.padRight < 24);
      const biale = r.out.filter((x) => /^rgba?\(2[45]\d,\s*2[45]\d,\s*2[45]\d/.test(x.tlo));

      console.log(`[${motyw} ${w}px] pól: ${r.out.length}, poza ramką: ${poza.length}, `
        + `strzałka przy krawędzi: ${ciasne.length}, poziomy suwak: ${r.przewijaSie}`);
      poza.forEach((x) => console.log(`   poza o ${x.poza}px: #${x.id}`));
      ciasne.forEach((x) => console.log(`   padding-right ${x.padRight}px: #${x.id}`));
      if (motyw === 'dark' && biale.length) {
        biale.forEach((x) => console.log(`   BIAŁE TŁO w ciemnym motywie: #${x.id} (${x.tlo})`));
        fail.push(`${motyw} ${w}px: białe pola — ` + biale.map((x) => x.id).join(', '));
      }
      if (poza.length) fail.push(`${motyw} ${w}px: pola poza ramką — ` + poza.map((x) => x.id).join(', '));
      if (ciasne.length) fail.push(`${motyw} ${w}px: strzałka za blisko — ` + ciasne.map((x) => x.id).join(', '));
      if (r.przewijaSie) fail.push(`${motyw} ${w}px: okno przewija się w poziomie`);

      if (motyw === 'dark' && w === 1280) await pg.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'pola-desktop.png'), fullPage: false });
      if (motyw === 'dark' && w === 360) await pg.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'pola-mobile.png'), fullPage: false });

      /* Karty u góry Ustawień: kliknięta karta ma zaświecić. Grupy bloków są
         w HTML-u przeplecione, więc „Dom" nie świecił nigdy — po kliknięciu
         zapalały się „Dane". */
      if (motyw === 'dark') {
        const karty = await pg.$$eval('#settings-modal .set-karty [data-cel]',
          (ks) => ks.filter((k) => !k.hidden).map((k) => k.dataset.cel));
        if (!karty.includes('dom')) fail.push(`${w}px: brak karty „Dom" u właściciela`);
        for (const cel of karty) {
          /* Dokąd przewinie klik — ta sama rachuba co w aplikacji. Czekamy na
             CEL, nie na „bezruch": pod obciążeniem (pełna bateria) płynne
             przewijanie rusza z opóźnieniem i dwa równe odczyty scrollTop
             zdarzały się, zanim w ogóle ruszyło — test czytał podświetlenie
             przy górze listy. */
          const doKad = await pg.evaluate((g) => {
            const cialo = document.querySelector('#settings-modal .modal-body');
            const pasek = cialo.querySelector('.set-karty');
            const pierwszy = [...cialo.querySelectorAll(`[data-karta="${g}"]`)].find((b) => b.offsetParent !== null);
            const y = pierwszy.offsetTop - (pasek ? pasek.offsetHeight + 8 : 0);
            return Math.max(0, Math.min(y, cialo.scrollHeight - cialo.clientHeight));
          }, cel);
          await pg.click(`#settings-modal .set-karty [data-cel="${cel}"]`);
          await pg.waitForFunction((y) => Math.abs(document.querySelector('#settings-modal .modal-body').scrollTop - y) < 2,
            doKad, { timeout: 6000 }).catch(() => {});
          // Podświetlenie liczy się w requestAnimationFrame po przewinięciu — dajmy mu chwilę (ale nie więcej).
          await pg.waitForFunction((c) => document.querySelector('#settings-modal .set-karty .aktywna')?.dataset.cel === c,
            cel, { timeout: 1500 }).catch(() => {});
          const swieci = await pg.$eval('#settings-modal .set-karty .aktywna', (k) => k.dataset.cel).catch(() => null);
          console.log(`   [${w}px] karta „${cel}" → świeci „${swieci}"`);
          if (swieci !== cel) fail.push(`${w}px: po kliknięciu karty „${cel}" świeci „${swieci}"`);
        }
      }
      await pg.close();
    }
  }

  await br.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPOLA W USTAWIENIACH OK');
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

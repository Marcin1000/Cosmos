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
    for (const [w, h] of [[1280, 900], [360, 740], [740, 313]]) {
      const pg = await br.newPage({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800 });
      await pg.addInitScript((m) => localStorage.setItem('cosmos.theme', m), motyw);
      await pg.goto(`${ADRES}/app`);
      await pg.evaluate((m) => document.documentElement.setAttribute('data-theme', m), motyw);
      await pg.evaluate(() => document.getElementById('settings-btn').click());
      await pg.waitForTimeout(400);
      // wypełnij listę mikrofonów bardzo długą nazwą – to ona rozpychała wiersz
      await pg.evaluate(() => {
        const s = document.getElementById('set-mic');
        s.innerHTML = '<option>Domyślny mikrofon systemu</option>'
          + '<option>Zestaw słuchawkowy Galaxy Buds3 Pro (Bluetooth) – mikrofon kierunkowy, kanał lewy</option>';
      });
      await pg.evaluate(() => document.getElementById('fetch-models-cloud').click());
      await pg.waitForTimeout(1200);

      /* Ustawienia to zakładki: pola każdej karty mierzymy po jej otwarciu. */
      const karty = await pg.$$eval('#settings-modal .set-karty [role="tab"]',
        (ks) => ks.filter((k) => !k.hidden).map((k) => k.dataset.cel));
      const r = { out: [], przewijaSie: false };
      for (const cel of karty) {
        await pg.click(`#settings-modal .set-karty [data-cel="${cel}"]`);
        const czesc = await pg.evaluate(() => {
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
        r.out.push(...czesc.out);
        r.przewijaSie = r.przewijaSie || czesc.przewijaSie;
      }

      const poza = r.out.filter((x) => x.poza > 1);
      const ciasne = r.out.filter((x) => x.tag === 'select' && x.padRight < 24);
      const biale = r.out.filter((x) => /^rgba?\(2[45]\d,\s*2[45]\d,\s*2[45]\d/.test(x.tlo));

      console.log(`[${motyw} ${w}px] pól: ${r.out.length}, poza ramką: ${poza.length}, `
        + `strzałka przy krawędzi: ${ciasne.length}, poziomy suwak: ${r.przewijaSie}`);
      poza.forEach((x) => console.log(`   poza o ${x.poza}px: #${x.id}`));
      ciasne.forEach((x) => console.log(`   padding-right ${x.padRight}px: #${x.id}`));
      if (motyw === 'dark' && biale.length) {
        biale.forEach((x) => console.log(`   BIAŁE TŁO w ciemnym motywie: #${x.id} (${x.tlo})`));
        fail.push(`${motyw} ${w}px: białe pola – ` + biale.map((x) => x.id).join(', '));
      }
      if (r.out.length < 10) fail.push(`${motyw} ${w}px: zmierzono tylko ${r.out.length} pól – karty nie pokazują treści`);
      if (poza.length) fail.push(`${motyw} ${w}px: pola poza ramką – ` + poza.map((x) => x.id).join(', '));
      if (ciasne.length) fail.push(`${motyw} ${w}px: strzałka za blisko – ` + ciasne.map((x) => x.id).join(', '));
      if (r.przewijaSie) fail.push(`${motyw} ${w}px: okno przewija się w poziomie`);

      if (motyw === 'dark' && w === 1280) await pg.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'pola-desktop.png'), fullPage: false });
      if (motyw === 'dark' && w === 360) await pg.screenshot({ path: require('path').join(require('../pomoc').KATALOG_ZRZUTOW, 'pola-mobile.png'), fullPage: false });

      /* Karty to prawdziwe zakładki (Marcin, runda 8: „przeskakują nie
         w kolejności”, bo dawniej przewijały jedną listę z przeplecionymi
         grupami). Gwarancje:
         – na telefonie wszystkie karty w JEDNYM wierszu (nie dwa rzędy),
         – po kliknięciu widać wyłącznie sekcje tej karty,
         – aria-selected ma tylko ona,
         – przewijanie treści nie przestawia wybranej karty. */
      if (motyw === 'dark') {
        if (!karty.includes('dom')) fail.push(`${w}px: brak karty „Dom" u właściciela`);
        if (w < 760 && h > 500) {   // w poziomie telefonu karty stoją w pionowej liście – celowo
          const wiersze = await pg.$$eval('#settings-modal .set-karty [role="tab"]',
            (ks) => [...new Set(ks.filter((k) => !k.hidden).map((k) => k.offsetTop))]);
          if (wiersze.length !== 1) fail.push(`${w}px: karty w ${wiersze.length} wierszach (${wiersze.join(', ')})`);
        }
        for (const cel of karty) {
          await pg.click(`#settings-modal .set-karty [data-cel="${cel}"]`);
          const stan = await pg.evaluate((c) => {
            const cialo = document.querySelector('#settings-modal .modal-body');
            const obce = [...cialo.querySelectorAll('[data-karta]')]
              .filter((b) => b.offsetParent !== null && b.dataset.karta !== c).map((b) => b.dataset.karta);
            const swoje = [...cialo.querySelectorAll(`[data-karta="${c}"]`)].filter((b) => b.offsetParent !== null).length;
            const wybrane = [...document.querySelectorAll('#settings-modal [role="tab"][aria-selected="true"]')].map((k) => k.dataset.cel);
            cialo.scrollTop = cialo.scrollHeight;
            return { obce: [...new Set(obce)], swoje, wybrane };
          }, cel);
          await pg.waitForTimeout(150);
          const poPrzewinieciu = await pg.$$eval('#settings-modal [role="tab"][aria-selected="true"]', (ks) => ks.map((k) => k.dataset.cel));
          console.log(`   [${w}px] karta „${cel}": swoich sekcji ${stan.swoje}, obcych: ${stan.obce.join(',') || 'brak'}, wybrana: ${stan.wybrane.join(',')}`);
          if (!stan.swoje) fail.push(`${w}px: karta „${cel}" nic nie pokazuje`);
          if (stan.obce.length) fail.push(`${w}px: w karcie „${cel}" widać sekcje innych kart (${stan.obce.join(', ')})`);
          if (stan.wybrane.join() !== cel) fail.push(`${w}px: po kliknięciu „${cel}" aria-selected ma „${stan.wybrane.join()}"`);
          if (poPrzewinieciu.join() !== cel) fail.push(`${w}px: przewinięcie treści przestawiło kartę na „${poPrzewinieciu.join()}"`);
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

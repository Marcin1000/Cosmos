/* Warstwa głosowa: nic na nic nie nachodzi, kula jest kulą.

   Marcin przysłał cztery zrzuty z trybu głosowego — dwa z telefonu w pionie,
   dwa w poziomie. Na wszystkich rozpoznane pytanie, odpowiedź i podpowiedź
   na dole leżały jedno na drugim, litera na literze. W poziomie kula była
   spłaszczonym spodkiem zamiast kulą.

   Obie rzeczy mają tę samą przyczynę: warstwa jest kolumną `flex`, a jej
   zawartość nie miała żadnego sufitu. Długie rozpoznanie rozpychało kolumnę
   poza ekran, `flex` ściskał kulę o stałej wysokości, a podpowiedź
   pozycjonowana bezwzględnie zostawała na wierzchu tekstu.

   Zestaw wpisuje do warstwy tekst tak długi, jak ten ze zrzutu, i mierzy
   prostokąty. Sprawdza trzy rzeczy, których nie widać na statycznym zrzucie:
   czy bloki się nie zachodzą, czy kula jest okrągła i czy nic nie wystaje
   poza ekran.
*/
const { srodowisko, przegladarka, maPrzegladarke, KATALOG_ZRZUTOW } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

// Dokładnie to, co zobaczył Marcin — z jego zrzutu, słowo w słowo.
const DLUGIE_PYTANIE = 'Jakiejakiejakie sąjakie są największejakie są największejakie '
  + 'są największejakie są największejakie są największe atrakcjejakie są największe '
  + 'atrakcjejakie są największe atrakcjejakie są największe atrakcje najakie są '
  + 'największe atrakcje na Majorce';
const DLUGA_ODPOWIEDZ = 'Największe atrakcje na Majorce to przede wszystkim: Katedra '
  + 'w Palma (La Seu) – imponująca gotycka świątynia z widokiem na port. Zamek Bellver '
  + '– okrągły gotycki zamek na wzgórzu nad miastem, oferujący panoramę zatoki. Serra '
  + 'de Tramuntana – pasmo górskie wpisane na listę UNESCO, idealne do wędrówek, jazdy '
  + 'na rowerze i podziwiania malowniczych wiosek. Wioska Valldemossa – znana '
  + 'z klasztoru Kartuzów, gdzie mieszkał Fryderyk Chopin i George Sand.';

const EKRANY = [
  ['telefon w pionie', { width: 412, height: 915 }],
  ['telefon w poziomie', { width: 915, height: 412 }],
  ['wąski telefon', { width: 360, height: 740 }],
  ['pulpit', { width: 1440, height: 900 }],
];

(async () => {
  const fail = [];
  const env = await srodowisko('goly');
  const br = await przegladarka();

  for (const [nazwa, viewport] of EKRANY) {
    const ctx = await br.newContext({ viewport, deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    await pg.goto(env.adres, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(900);

    /* Wchodzimy w tryb głosowy i wypełniamy go treścią wprost. Nie udajemy
       mikrofonu — mierzymy UKŁAD, a układ nie wie, skąd wziął się tekst. */
    await pg.evaluate(([pytanie, odpowiedz]) => {
      document.getElementById('voice-overlay').style.display = '';
      document.getElementById('voice-transcript').textContent = pytanie;
      document.getElementById('voice-answer').textContent = odpowiedz;
    }, [DLUGIE_PYTANIE, DLUGA_ODPOWIEDZ]);
    await pg.waitForTimeout(400);

    const miara = await pg.evaluate(() => {
      const p = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { sel, top: r.top, bottom: r.bottom, left: r.left, right: r.right,
          w: r.width, h: r.height };
      };
      return {
        bloki: ['#voice-orb', '#voice-status', '#voice-transcript', '#voice-answer', '.voice-hint']
          .map(p).filter(Boolean),
        okno: { w: innerWidth, h: innerHeight },
        wSzerz: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });

    // --- 1. Żadne dwa bloki nie mogą się zachodzić ------------------------
    const zachodzi = [];
    for (let i = 0; i < miara.bloki.length; i++) {
      for (let j = i + 1; j < miara.bloki.length; j++) {
        const a = miara.bloki[i];
        const b = miara.bloki[j];
        const pion = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        const poziom = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        // Jeden piksel tolerancji na zaokrąglenia układu.
        if (pion > 1 && poziom > 1) {
          zachodzi.push(`${a.sel} × ${b.sel} (${Math.round(pion)} px w pionie)`);
        }
      }
    }

    // --- 2. Kula ma być kulą ---------------------------------------------
    const orb = miara.bloki.find((b) => b.sel === '#voice-orb');
    const owal = orb ? Math.abs(orb.w - orb.h) : 0;

    // --- 3. Nic nie wystaje poza ekran ------------------------------------
    const poza = miara.bloki.filter((b) => b.bottom > miara.okno.h + 1 || b.top < -1)
      .map((b) => b.sel);

    console.log(`${nazwa} (${viewport.width}×${viewport.height}): `
      + `kula ${Math.round(orb.w)}×${Math.round(orb.h)}, `
      + `zachodzeń ${zachodzi.length}, poza ekranem ${poza.length}, `
      + `przewijanie w bok: ${miara.wSzerz ? 'JEST' : 'brak'}`);
    for (const z of zachodzi) console.log(`   ${z}`);

    if (zachodzi.length) {
      fail.push(`${nazwa}: bloki nachodzą na siebie — ${zachodzi.join('; ')}`);
    }
    if (owal > 1) {
      fail.push(`${nazwa}: kula jest elipsą ${Math.round(orb.w)}×${Math.round(orb.h)} px`);
    }
    if (poza.length) {
      fail.push(`${nazwa}: poza ekranem: ${poza.join(', ')}`);
    }
    if (miara.wSzerz) fail.push(`${nazwa}: warstwa głosowa przewija się w bok`);

    await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/glos-${viewport.width}x${viewport.height}.png` });
    await ctx.close();
  }

  await br.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nWARSTWA GŁOSOWA MIEŚCI OK');
  process.exit(fail.length ? 1 : 0);
})();

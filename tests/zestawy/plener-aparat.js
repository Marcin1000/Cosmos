/* Aparat po Wi-Fi — cała droga z ekranu do aparatu.

   `aparat-canon.js` sprawdza sam moduł: odkrywanie ścieżek, odrzucanie
   wartości spoza listy, komunikaty awarii. To jest sprawdzenie o poziom
   wyżej i odpowiada na inne pytanie: czy człowiek, patrząc na Plener,
   może DOJŚĆ do zmiany nastaw w aparacie — i czy to, co widzi na ekranie,
   zgadza się z tym, co aparat naprawdę ma ustawione.

   To jedyna funkcja Cosmosa, która pisze do cudzego sprzętu. Cicha pomyłka
   kończy się serią zdjęć zrobioną z parametrami, których nikt nie zamawiał,
   więc sprawdzamy licznikiem po stronie atrapy, a nie napisem w przeglądarce.
*/
const { srodowisko, przegladarka, maPrzegladarke, KATALOG_ZRZUTOW } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

const ATRAPA = 'http://127.0.0.1:7120';

(async () => {
  const fail = [];
  const env = await srodowisko('aparat');
  const b = await przegladarka();
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push(e.message));
  await pg.goto(env.adres, { waitUntil: 'load' });
  await pg.waitForTimeout(400);

  await pg.click('#plener-btn');
  await pg.waitForTimeout(1500);

  /* 1. Skonfigurowany i odpowiadający aparat MUSI być widoczny.
     Odwrotność sprawdzenia z zestawu `plener`: tam brak CANON_CCAPI_URL
     chował wiersz, tu obecny aparat ma go pokazać. Obie strony tego warunku
     trzeba sprawdzać osobno — chowanie zawsze i pokazywanie nigdy wygląda
     w kodzie tak samo źle, a w testach różnie. */
  const wiersz = await pg.evaluate(() => {
    const w = document.getElementById('plan-camera');
    const r = w.getBoundingClientRect();
    return {
      widoczny: r.width > 0 && getComputedStyle(w).display !== 'none',
      tekst: document.getElementById('plan-camera-now').textContent.trim(),
      przyciski: [...w.querySelectorAll('button')].filter((x) => !x.hidden).length,
    };
  });
  console.log(`1. wiersz aparatu widoczny: ${wiersz.widoczny} → „${wiersz.tekst}"`);
  if (!wiersz.widoczny) fail.push('skonfigurowany aparat nie pokazał się w Plenerze');
  if (!/R6/.test(wiersz.tekst)) fail.push(`wiersz nie podaje modelu aparatu: „${wiersz.tekst}"`);
  // Atrapa startuje z ISO auto, f/4.0, 1/60 — to ma być na ekranie.
  if (!/1\/60/.test(wiersz.tekst)) fail.push(`nastawy z aparatu nie dotarły na ekran: „${wiersz.tekst}"`);
  if (wiersz.przyciski !== 2) fail.push(`spodziewane dwa przyciski (ustaw, migawka), jest ${wiersz.przyciski}`);

  /* 2. „Ustaw w aparacie" ma zmienić stan ATRAPY, a nie tylko napis.
     Liczymy plan dla jasnego dnia, żeby wyszło coś innego niż to, co aparat
     ma teraz — inaczej sprawdzenie przeszłoby także przy przycisku, który
     nic nie robi. */
  await pg.fill('#fp-place', 'Kraków');
  await pg.selectOption('#fp-mode', 'zdjecie');
  await pg.fill('#fp-when', '2026-06-21T12:00');
  await pg.click('#fp-go');
  await pg.waitForTimeout(1600);
  const policzone = (await pg.textContent('#fp-shot') || '').trim();
  console.log(`2. plan w południe → „${policzone}"`);

  const przed = await (await fetch(`${ATRAPA}/licznik`)).json();
  await pg.click('#plan-camera-apply');
  await pg.waitForTimeout(1500);
  const po = await (await fetch(`${ATRAPA}/licznik`)).json();
  const zmiany = ['iso', 'av', 'tv'].filter((k) => przed.stan[k].value !== po.stan[k].value);
  console.log(`3. po „Ustaw w aparacie": iso ${przed.stan.iso.value}→${po.stan.iso.value}, `
    + `av ${przed.stan.av.value}→${po.stan.av.value}, tv ${przed.stan.tv.value}→${po.stan.tv.value}`);
  if (!zmiany.length) fail.push('przycisk „Ustaw w aparacie" nie zmienił niczego w aparacie');

  /* Wysłane wartości muszą być TYMI policzonymi, a nie jakimikolwiek.
     Aparat oczekuje swojego zapisu („f8.0", nie „f/8"), więc to jest też
     sprawdzenie tłumaczenia formatu. */
  const [czasP, przyslonaP, isoP] = policzone.split('·').map((x) => x.trim());
  if (isoP && !isoP.includes(po.stan.iso.value)) {
    fail.push(`w aparacie ISO ${po.stan.iso.value}, a policzone „${isoP}"`);
  }
  if (przyslonaP && po.stan.av.value.replace(/^f/, 'f/') !== przyslonaP) {
    console.log(`   (przysłona: aparat ${po.stan.av.value}, plan ${przyslonaP} — `
      + 'aparat mógł dobrać najbliższą ze swojej listy)');
  }
  if (czasP && po.stan.tv.value !== czasP) {
    console.log(`   (czas: aparat ${po.stan.tv.value}, plan ${czasP} — jw.)`);
  }

  // 4. Po zmianie ekran ma pokazywać NOWY stan, a nie zapamiętany stary.
  const poZmianie = (await pg.textContent('#plan-camera-now') || '').trim();
  console.log(`4. ekran po zmianie: „${poZmianie}"`);
  if (poZmianie === wiersz.tekst) fail.push('ekran nie odświeżył się po zmianie nastaw');

  // 5. Migawka: liczy się licznik w atrapie, nie napis „Pstryk".
  await pg.click('#plan-camera-shutter');
  await pg.waitForTimeout(1200);
  const poStrzale = await (await fetch(`${ATRAPA}/licznik`)).json();
  console.log(`5. wyzwoleń migawki: ${przed.wyzwolen} → ${poStrzale.wyzwolen}`);
  if (poStrzale.wyzwolen <= przed.wyzwolen) fail.push('przycisk migawki nie wyzwolił zdjęcia');

  /* 6. Aparat, który przestał odpowiadać (uśpione Wi-Fi), nie może zostawić
     przycisku obiecującego działanie. To najczęstszy stan w praktyce —
     R6 II usypia Wi-Fi po kilku minutach bezczynności. */
  /* Nie zerujemy już pamięci stanu aparatu z zewnątrz — po wydzieleniu
     `public/plener.js` jest ona prywatna, a przypisanie do `aparatSprawdzony`
     w `page.evaluate` tworzyłoby tylko nową zmienną globalną i niczego nie
     resetowało. To dobrze: test, który musi sięgnąć do środka modułu, mierzy
     jego budowę, a nie zachowanie.

     Sprawdzamy więc to, co widzi Marcin. Atrapa przestaje odpowiadać, panel
     przelicza plan — i w tym samym przebiegu ma przestać obiecywać działanie,
     bez czekania na wygaśnięcie trzydziestosekundowej pamięci stanu. */
  await fetch(`${ATRAPA}/awaria?co=off`).catch(() => {});
  await pg.click('#fp-go');
  await pg.waitForTimeout(2500);
  const uspiony = await pg.evaluate(() => ({
    tekst: document.getElementById('plan-camera-now').textContent.trim(),
    ustaw: document.getElementById('plan-camera-apply').hidden,
  }));
  console.log(`6. aparat uśpiony → „${uspiony.tekst.slice(0, 90)}" (przycisk schowany: ${uspiony.ustaw})`);
  if (!uspiony.ustaw) fail.push('„Ustaw w aparacie" zostało widoczne przy niedostępnym aparacie');
  if (!uspiony.tekst) fail.push('niedostępny aparat nie powiedział, co jest nie tak');
  await fetch(`${ATRAPA}/awaria?co=`).catch(() => {});

  await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/plener-aparat.png` });
  console.log(`7. błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  if (bledy.length) fail.push(`błędy JS: ${bledy.join(' | ')}`);

  await b.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPLENER — APARAT OK');
  process.exit(fail.length ? 1 : 0);
})();

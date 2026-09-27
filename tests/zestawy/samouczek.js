/* Samouczek pierwszego uruchomienia i kreator „Podłącz komputer”.

   Pierwsze wejście do Cosmosa ma prowadzić za rękę: imię, własne klucze API,
   zmysły na własnym komputerze, telefon. Wszystko do pominięcia i wszystko
   z panelu, bez wiersza poleceń poza jednym wklejonym poleceniem.

   Sprawdza w prawdziwej przeglądarce:
     1. pierwsze wejście pokazuje samouczek; pod automatem (navigator.webdriver)
        nie wyskakuje sam – inaczej zasłoniłby aplikację w każdym zestawie,
     2. imię wpisane w samouczku zapisuje się na koncie,
     3. zły klucz API zatrzymuje krok z czytelnym błędem zamiast iść dalej,
     4. „Zakończ” zapamiętuje samouczek NA SERWERZE – po przeładowaniu
        (i na innym urządzeniu) już się nie pokazuje; „Pokaż samouczek”
        w Ustawieniach go przywraca,
     5. „Pomiń samouczek” też jest zapamiętane,
     6. kreator w Ustawieniach → Zmysły daje polecenie z adresem tego Cosmosa
        i działającym kodem – serwer oddaje pod nim skrypt instalacji.
*/
const { przegladarka, maPrzegladarke, serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3507;
const S = `http://127.0.0.1:${PORT}`;
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

(async () => {
  const srv = serwerCosmosa(PORT, { SENSES_URL: 'http://127.0.0.1:1' });
  const b = await przegladarka();
  try {
    if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer testowy nie wstał');
    const bledy = [];

    /* ---- 1a. Pod automatem samouczek sam nie wyskakuje ---- */
    const ctxA = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
    const pA = await ctxA.newPage();
    await pA.goto(`${S}/app`, { waitUntil: 'load' });
    await pA.waitForFunction(() => document.querySelector('.app.gotowa'));
    await pA.waitForTimeout(800);
    ok(!(await pA.$('#samouczek')), '1. pod automatem samouczek nie zasłania aplikacji');
    await ctxA.close();

    /* ---- 1b. Człowiek przy pierwszym wejściu go dostaje ---- */
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
    await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => bledy.push(e.message));
    await p.goto(`${S}/app`, { waitUntil: 'load' });
    const jest = await p.waitForSelector('#samouczek', { timeout: 8000 }).then(() => true).catch(() => false);
    ok(jest, '1. pierwsze wejście pokazuje samouczek');

    /* ---- 2. Imię ---- */
    await p.click('.sm-dalej');                                  // Zaczynamy
    await p.waitForSelector('#sm-imie');
    await p.fill('#sm-imie', 'Kasia');
    await p.click('.sm-dalej');
    await p.waitForSelector('#sm-klucz-openai');
    const konto = await (await p.evaluate(() => fetch('/api/konto').then((r) => r.json())));
    ok(konto.uzytkownik && konto.uzytkownik.nazwa === 'Kasia', `2. imię z samouczka zapisane na koncie (${konto.uzytkownik && konto.uzytkownik.nazwa})`);

    /* ---- 3. Zły klucz ---- */
    await p.fill('#sm-klucz-openai', 'za-krotki');
    await p.click('.sm-dalej');
    await p.waitForTimeout(500);
    const s3 = await p.evaluate(() => ({ krok: document.querySelector('.sm-cialo').dataset.krok, blad: document.querySelector('.sm-cialo .konto-komunikat').textContent }));
    ok(s3.krok === 'klucze' && /klucz/i.test(s3.blad), `3. zły klucz zatrzymuje krok z błędem („${s3.blad}”)`);
    await p.fill('#sm-klucz-openai', '');
    await p.click('.sm-pomin');                                  // Pomiń ten krok

    /* ---- zmysły: kreator w samouczku ---- */
    const s4 = await p.evaluate(() => ({ krok: document.querySelector('.sm-cialo').dataset.krok, przycisk: Boolean(document.querySelector('.sm-cialo .zm-podlacz')) }));
    ok(s4.krok === 'zmysly' && s4.przycisk, '4. krok „Zmysły” ma przycisk „Podłącz komputer”');
    await p.click('.sm-dalej');                                  // telefon
    await p.click('.sm-dalej');                                  // gotowe
    await p.click('.sm-dalej');                                  // Zacznij rozmowę
    await p.waitForFunction(() => !document.getElementById('samouczek'));
    const po = await p.evaluate(() => fetch('/api/konto').then((r) => r.json()));
    ok(po.samouczek && po.samouczek.kiedy && !po.samouczek.pominiety, '4. przejście samouczka zapamiętane na serwerze');

    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.app.gotowa'));
    await p.waitForTimeout(1000);
    ok(!(await p.$('#samouczek')), '4. po przeładowaniu samouczek już się nie pokazuje');
    const drugie = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await drugie.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    const p2 = await drugie.newPage();
    await p2.goto(`${S}/app`, { waitUntil: 'load' });
    await p2.waitForFunction(() => document.querySelector('.app.gotowa'));
    await p2.waitForTimeout(1000);
    ok(!(await p2.$('#samouczek')), '4. na drugim urządzeniu samouczek też się nie pokazuje');
    await drugie.close();

    await p.evaluate(() => openSettings());
    await p.evaluate(() => document.getElementById('konto-samouczek').click());
    const wrocil = await p.waitForSelector('#samouczek', { timeout: 5000 }).then(() => true).catch(() => false);
    ok(wrocil, '4. „Pokaż samouczek” w Ustawieniach go przywraca');

    /* ---- 5. Pominięcie ---- */
    await p.click('.sm-pomin');                                  // Pomiń samouczek (krok 1)
    await p.waitForFunction(() => !document.getElementById('samouczek'));
    const pom = await p.evaluate(() => fetch('/api/konto').then((r) => r.json()));
    ok(pom.samouczek && pom.samouczek.pominiety === true, '5. „Pomiń samouczek” zapamiętane');

    /* ---- 6. Kreator w Ustawieniach → Zmysły ---- */
    await p.evaluate(() => openSettings());
    await p.waitForSelector('#zm-kreator .zm-podlacz');
    await p.evaluate(() => document.querySelector('#zm-kreator .zm-podlacz').click());
    await p.waitForSelector('#zm-kreator .zm-polecenie');
    const polecenie = await p.$eval('#zm-kreator .zm-polecenie', (e) => e.textContent);
    const kod = (/kod=(\d{6})/.exec(polecenie) || [])[1];
    ok(polecenie.includes(S) && kod, `6. polecenie niesie adres tego Cosmosa i kod („${polecenie}”)`);
    const skrypt = await fetch(`${S}/api/agent/instaluj.${/irm/.test(polecenie) ? 'ps1' : 'sh'}?kod=${kod}`);
    ok(skrypt.status === 200 && (await skrypt.text()).includes(kod), '6. pod poleceniem serwer oddaje skrypt instalacji z tym kodem');
    const zrodlo = await p.$eval('.zm-zrodlo', (e) => e.textContent);
    ok(/bez zmysłów|No senses/.test(zrodlo), `6. bez podłączonego komputera zdanie mówi, że zmysły są w przeglądarce („${zrodlo}”)`);

    ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    await b.close();
    zabij(srv);
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nSAMOUCZEK OK');
  process.exit(fail.length ? 1 : 0);
})();

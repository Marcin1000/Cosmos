/* Nić rozmowy: każda odpowiedź nosi znak silnika, który ją napisał.
 *
 * To jest obietnica ze strony produktowej („Jedna rozmowa. Każdy model.") —
 * po wejściu do aplikacji ma być widać, który silnik odpowiadał, także po
 * przełączeniu w połowie wątku i po przeładowaniu strony. Sprawdzamy:
 *   1. odpowiedź w trakcie pisania ma już kolor i podpis wybranego silnika,
 *   2. po przełączeniu silnika następna odpowiedź ma JEGO znak, a poprzednia
 *      zostaje przy swoim (nić zmienia kolor, nie przemalowuje historii),
 *   3. znak jest zapisany w rozmowie na dysku, więc przeżywa przeładowanie,
 *   4. <html data-silnik> idzie za wybraną zakładką (kolor pola i kropki modelu). */
const fs = require('fs');
const path = require('path');
const { srodowisko, przegladarka, katalogOsoby } = require('../pomoc');

(async () => {
  const env = await srodowisko('czterySilniki');
  const b = await przegladarka();
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  const problemy = [];
  const ok = (warunek, opis) => {
    console.log(`${warunek ? 'OK ' : 'ZLE'} ${opis}`);
    if (!warunek) problemy.push(opis);
  };
  const znakiOdpowiedzi = () => p.evaluate(() => [...document.querySelectorAll('#messages .msg-assistant')]
    .map((m) => ({ silnik: m.dataset.silnik || '', podpis: (m.querySelector('.msg-silnik') || {}).textContent || '' })));
  const zapytaj = async (tresc) => {
    const ile = (await znakiOdpowiedzi()).length;
    await p.fill('#input', tresc);
    await p.click('#send-btn');
    await p.waitForFunction((n) => document.querySelectorAll('#messages .msg-assistant').length > n, ile, { timeout: 15000 });
    await p.waitForFunction(() => !document.querySelector('#stop-btn') || getComputedStyle(document.querySelector('#stop-btn')).display === 'none', null, { timeout: 20000 });
    await p.waitForTimeout(400);
  };

  await p.goto(env.adres + '/app', { waitUntil: 'load' });
  await p.waitForSelector('.endpoint-tab[data-endpoint="claude"]', { timeout: 8000 });

  // --- 1–2. dwie odpowiedzi, dwa silniki
  await p.click('.endpoint-tab[data-endpoint="cloud"]');
  ok(await p.evaluate(() => document.documentElement.dataset.silnik) === 'cloud', '<html data-silnik> = cloud po wybraniu NVIDIA');
  await zapytaj('Pierwsze pytanie');
  await p.click('.endpoint-tab[data-endpoint="claude"]');
  ok(await p.evaluate(() => document.documentElement.dataset.silnik) === 'claude', '<html data-silnik> idzie za zakładką (claude)');
  await zapytaj('Drugie pytanie');

  let znaki = await znakiOdpowiedzi();
  ok(znaki.length >= 2, `są dwie odpowiedzi (${znaki.length})`);
  const [pierwsza, druga] = [znaki[0] || {}, znaki[znaki.length - 1] || {}];
  ok(pierwsza.silnik === 'cloud' && /^NVIDIA/.test(pierwsza.podpis), `pierwsza odpowiedź podpisana NVIDIA (${pierwsza.silnik} / ${pierwsza.podpis})`);
  ok(druga.silnik === 'claude' && /^Claude/.test(druga.podpis), `druga odpowiedź podpisana Claude (${druga.silnik} / ${druga.podpis})`);
  const kolory = await p.evaluate(() => [...document.querySelectorAll('#messages .msg-assistant .msg-avatar')].map((a) => getComputedStyle(a).backgroundColor));
  ok(kolory.length >= 2 && kolory[0] !== kolory[kolory.length - 1], `nić zmienia kolor przy zmianie silnika (${kolory.join(' → ')})`);

  // --- 3. zapis na dysku i przeładowanie
  const katalog = path.join(katalogOsoby(env), 'conversations');
  const pliki = fs.existsSync(katalog) ? fs.readdirSync(katalog).filter((f) => f.endsWith('.json') && !f.startsWith('_')) : [];
  const zapisane = pliki.map((f) => { try { return JSON.parse(fs.readFileSync(path.join(katalog, f), 'utf8')); } catch { return null; } })
    .filter((r) => r && Array.isArray(r.messages))
    .flatMap((r) => r.messages.filter((m) => m.role === 'assistant').map((m) => m.silnik));
  ok(zapisane.includes('cloud') && zapisane.includes('claude'), `silnik zapisany w rozmowie na dysku (${zapisane.join(', ') || 'brak'})`);

  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('.conv-item', { timeout: 8000 });
  await p.click('.conv-item .conv-title');
  await p.waitForSelector('#messages .msg-assistant', { timeout: 8000 });
  znaki = await znakiOdpowiedzi();
  ok(znaki.map((z) => z.silnik).join(',') === 'cloud,claude', `po przeładowaniu nić ta sama (${znaki.map((z) => z.silnik).join(',')})`);

  await b.close();
  env.koniec();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nNIĆ ROZMOWY OK');
  process.exit(problemy.length ? 1 : 0);
})();

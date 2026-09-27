/* Własne gesty: nagraj, nazwij, przypisz czynność.

   Marcin: „mógłby zapisywać gesty po ich pokazaniu z informacją, co mają
   znaczyć, i potem je odtwarzać, jak się je pokaże, np. dwa palce poruszające
   się w górę oznaczają przewijanie strony w górę”.

   Część bez przeglądarki (public/gesty.js, lib/gesty.js wołane wprost):
     1. kształt dłoni nie zależy od odległości od kamery ani miejsca w kadrze,
     2. ruch: w górę, w dół, w lewo i w prawo z punktu widzenia osoby (kadr
        nieodbity), drobne drżenie to nie ruch,
     3. nagranie → wzorzec: najczęstszy układ palców (przypadkowe odczyty
        w ruchu nie psują wzorca), kształt, ruch,
     4. dopasowanie: gest nieruchomy po dwóch zgodnych odczytach, gest z ruchem
        wygrywa z nieruchomym o tych samych palcach, inne palce nie pasują,
     5. serwer odrzuca czynność spoza listy, „otwórz” bez adresu http(s)
        (javascript: nie przejdzie) i gest bez nagrania.
   Część w przeglądarce (środowisko `pelne`, dłonie podstawione):
     6. nagranie dwóch palców jadących w górę daje „2 palce (…), ruch w górę”,
        zapis trafia na serwer i na listę,
     7. pokazanie tego gestu przewija rozmowę w górę i mówi o nim modelowi,
     8. przy zapisanych gestach pętla dłoni chodzi szybciej,
     9. nazwa wpisana przez człowieka trafia na ekran jako tekst, usunięcie działa.
*/
const { utworzGesty } = require('../../public/gesty.js');
const { oczysc } = require('../../lib/gesty.js');
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const G = utworzGesty();

/** Dłoń: 21 punktów, nadgarstek w (x,y), wielkość `s`; `palce` – które proste. */
function dlon(x, y, s = 0.1, prosteIdx = [1, 2]) {
  const p = Array.from({ length: 21 }, () => [x, y]);
  for (let f = 0; f < 5; f++) {
    for (let j = 1; j <= 4; j++) {
      const i = f * 4 + j;
      const prosty = prosteIdx.includes(f);
      p[i] = [x + (f - 2) * 0.25 * s, y - (prosty ? j * 0.45 : Math.min(j, 2) * 0.35) * s];
    }
  }
  p[9] = [x, y - s];      // środek dłoni – u podstawy środkowego palca
  return p;
}
const NAZWY = ['kciuk', 'wskazujący', 'środkowy', 'serdeczny', 'mały'];
const probka = (t, x, y, idx = [1, 2], s = 0.1) => ({ t, palce: idx.map((i) => NAZWY[i]), punkty: dlon(x, y, s, idx) });

/* ---- 1. Kształt ---- */
const k1 = G.ksztalt(dlon(0.3, 0.7, 0.1));
const k2 = G.ksztalt(dlon(0.6, 0.4, 0.2));
ok(G.roznicaKsztaltu(k1, k2) < 1e-9, '1. ten sam gest bliżej i w innym miejscu kadru = ten sam kształt');
ok(G.roznicaKsztaltu(k1, G.ksztalt(dlon(0.3, 0.7, 0.1, [0, 1, 2, 3, 4]))) > 0.2, '1. inna dłoń (otwarta) = wyraźnie inny kształt');

/* ---- 2. Ruch ---- */
const tor = (dx, dy) => Array.from({ length: 6 }, (_, i) => probka(i * 350, 0.5 + dx * i / 5, 0.6 + dy * i / 5));
ok(G.kierunekRuchu(tor(0, -0.3)) === 'gora', '2. dłoń jedzie w górę kadru → „gora”');
ok(G.kierunekRuchu(tor(0, 0.3)) === 'dol', '2. w dół → „dol”');
ok(G.kierunekRuchu(tor(-0.3, 0)) === 'prawo', '2. w lewo obrazu = w prawo osoby (kadr nieodbity)');
ok(G.kierunekRuchu(tor(0.3, 0)) === 'lewo', '2. w prawo obrazu = w lewo osoby');
ok(G.kierunekRuchu(tor(0.03, -0.04)) === 'brak', '2. drżenie dłoni to nie ruch');

/* ---- 3. Nagranie → wzorzec ---- */
const nagranie = tor(0, -0.3);
nagranie[2] = probka(700, 0.5, 0.48, [1]);      // w ruchu raz „wyszedł” jeden palec
nagranie.push({ t: 2200 });                      // i raz dłoni nie było w kadrze
const w = G.wzorzecZNagrania(nagranie);
ok(w && w.palce.join(',') === 'wskazujący,środkowy' && w.ruch === 'gora' && w.ksztalt.length === 42,
  `3. wzorzec: najczęstsze palce, ruch, kształt (${w && G.opisWzorca(w)})`);
ok(G.wzorzecZNagrania([probka(0, 0.5, 0.5), { t: 300 }]) === null, '3. za mało dłoni w nagraniu → brak wzorca');

/* ---- 4. Dopasowanie ---- */
const gestRuch = { nazwa: 'Dwa palce w górę', ...w };
const gestV = { nazwa: 'V', ...G.wzorzecZNagrania([probka(0, 0.5, 0.6), probka(350, 0.5, 0.6), probka(700, 0.5, 0.6)]) };
const statyczne = [probka(0, 0.5, 0.6), probka(350, 0.501, 0.6)];
ok(G.dopasuj([gestV], [probka(0, 0.5, 0.6)]) === null, '4. nieruchomy: jeden odczyt to za mało');
ok(G.dopasuj([gestV], statyczne) === gestV, '4. nieruchomy: dwa zgodne odczyty → gest');
ok(G.dopasuj([gestV, gestRuch], tor(0, -0.3)) === gestRuch, '4. ruch w górę → gest z ruchem, nie nieruchomy');
ok(G.dopasuj([gestV, gestRuch], [probka(0, 0.5, 0.6, [0, 1, 2, 3, 4]), probka(350, 0.5, 0.6, [0, 1, 2, 3, 4])]) === null, '4. otwarta dłoń nie pasuje do dwóch palców');
ok(G.dopasuj([gestRuch], tor(0, 0.3)) === null, '4. ruch w dół nie uruchamia gestu „w górę”');

/* ---- 5. Serwer pilnuje umowy ---- */
const baza = { nazwa: 'Test', palce: ['wskazujący'], ruch: 'gora', ksztalt: w.ksztalt };
ok(oczysc({ ...baza, czynnosc: 'rm -rf' })[0] === null, '5. czynność spoza listy odrzucona');
ok(oczysc({ ...baza, czynnosc: 'otworz', parametr: 'javascript:alert(1)' })[0] === null, '5. „otwórz” z javascript: odrzucone');
ok((oczysc({ ...baza, czynnosc: 'otworz', parametr: 'onet.pl' })[0] || {}).parametr === 'https://onet.pl/', '5. „otwórz onet.pl” → https://onet.pl/');
ok(oczysc({ ...baza, ksztalt: [1, 2], czynnosc: 'migawka' })[0] === null, '5. gest bez nagrania odrzucony');
ok(oczysc({ ...baza, czynnosc: 'migawka', ruch: 'po-skosie' })[0].ruch === 'brak', '5. nieznany ruch → „brak”');

(async () => {
  if (!maPrzegladarke()) { console.log('POMINIĘTE 6–9: brak Chromium'); return koniec(); }
  const env = await srodowisko('pelne');
  const b = await przegladarka();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const bledy = [];
    p.on('pageerror', (e) => bledy.push(e.message));
    const zapytania = [];
    p.on('request', (r) => { if (r.method() === 'POST') zapytania.push([Date.now(), new URL(r.url()).pathname, r.postData() || '']); });
    // Dłonie podstawione: tryb „gora” – dwa palce jadą w górę, „v” – stoją, „brak” – pusto.
    let tryb = 'brak';
    let krok = 0;
    await p.route('**/api/dlonie', (r) => {
      krok++;
      let dlonie = [];
      const zPunktami = (x, y) => ({ strona: 'prawa', palce: ['wskazujący', 'środkowy'], gest: 'znak V', punkty: dlon(x, y) });
      if (tryb === 'gora') dlonie = [zPunktami(0.5, Math.max(0.25, 0.9 - krok * 0.07))];   // stale w górę, bez zawijania
      if (tryb === 'v') dlonie = [zPunktami(0.5, 0.6)];
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dlonie, summary: dlonie.length ? 'prawa dłoń: 2 palce' : 'nie widać dłoni' }) });
    });
    await p.goto(`${env.adres}/app`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.app.gotowa') && typeof startLive === 'function');
    await p.evaluate(() => localStorage.setItem('cosmos.liveSource', 'kinect-color'));
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.app.gotowa') && typeof startLive === 'function');
    await p.evaluate(() => startLive());
    await p.evaluate(() => { document.getElementById('live-gesty').open = true; });

    /* ---- 6. Nagranie ---- */
    await p.fill('#gest-nazwa', 'Dwa palce <img src=x> w górę');
    await p.selectOption('#gest-czynnosc', 'przewin-gora');
    await p.fill('#gest-znaczenie', 'przewiń do góry');
    await p.click('#gest-nagraj');
    // Dłoń rusza dopiero z „Pokazuj gest teraz” – odliczanie to jeszcze nie nagranie.
    await p.waitForFunction(() => /Pokazuj|Show the gesture/.test(document.getElementById('gest-stan').textContent), null, { timeout: 6000 });
    tryb = 'gora'; krok = 0;
    await p.waitForFunction(() => /Nagrany|Recorded|Nie widziałem/.test(document.getElementById('gest-stan').textContent), null, { timeout: 12000 }).catch(() => {});
    const stan6 = await p.$eval('#gest-stan', (e) => e.textContent);
    ok(/2 palce \(wskazujący, środkowy\), ruch w górę/.test(stan6), `6. nagranie: „${stan6}”`);
    tryb = 'brak';
    await p.click('#gest-zapisz');
    await p.waitForFunction(() => document.querySelectorAll('#gesty-lista li').length === 1, null, { timeout: 5000 }).catch(() => {});
    const naSerwerze = await p.evaluate(async () => (await (await fetch('/api/gesty')).json()).gesty);
    ok(naSerwerze.length === 1 && naSerwerze[0].ruch === 'gora' && naSerwerze[0].czynnosc === 'przewin-gora', '6. gest zapisany na serwerze');
    const li = await p.evaluate(() => { const e = document.querySelector('#gesty-lista li'); return e ? { tekst: e.textContent, img: e.querySelectorAll('img').length } : null; });
    ok(li && /Dwa palce <img src=x> w górę/.test(li.tekst) && li.img === 0, '9. nazwa od człowieka na liście jako tekst, nie HTML');

    /* ---- 8. Pętla szybsza przy gestach ---- */
    const od8 = Date.now();
    await p.waitForTimeout(3500);
    const ile8 = zapytania.filter(([t, a]) => a === '/api/dlonie' && t >= od8).length;
    // Bez gestów co 1,2 s – w 3,5 s najwyżej trzy odczyty.
    ok(ile8 >= 5, `8. przy zapisanych gestach pętla dłoni szybsza (${ile8} odczytów w 3,5 s, bez gestów najwyżej 3)`);

    /* ---- 7. Rozpoznanie przewija rozmowę ---- */
    await p.evaluate(() => {
      const conv = ensureConversation('Długa rozmowa');
      for (let i = 0; i < 60; i++) conv.messages.push({ role: i % 2 ? 'assistant' : 'user', content: `Wiadomość numer ${i} – `.repeat(8) });
      renderMessages();
      const m = document.getElementById('chat-scroll');
      m.scrollTop = m.scrollHeight;
    });
    await p.waitForTimeout(300);
    const przed = await p.evaluate(() => document.getElementById('chat-scroll').scrollTop);
    const od7 = Date.now();
    tryb = 'gora'; krok = 0;
    await p.waitForFunction((przed) => document.getElementById('chat-scroll').scrollTop < przed - 50, przed, { timeout: 8000 }).catch(() => {});
    tryb = 'brak';
    const po = await p.evaluate(() => document.getElementById('chat-scroll').scrollTop);
    ok(po < przed - 50, `7. gest „dwa palce w górę” przewinął rozmowę w górę (${przed} → ${po})`);
    const zd = zapytania.filter(([t, a, d]) => t >= od7 && a === '/api/events' && /gest „Dwa palce/.test(d));
    ok(zd.length >= 1 && /przewiń do góry/.test(zd[0][2]), '7. model dostaje zdarzenie z nazwą i znaczeniem gestu');

    /* ---- 9. Usunięcie ---- */
    await p.click('#gesty-lista .gest-usun');
    await p.waitForFunction(() => document.querySelectorAll('#gesty-lista li').length === 0, null, { timeout: 5000 }).catch(() => {});
    const poUsunieciu = await p.evaluate(async () => (await (await fetch('/api/gesty')).json()).gesty.length);
    ok(poUsunieciu === 0, '9. usunięty z listy i z serwera');
    const zly = await p.evaluate(async () => (await fetch('/api/gesty', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nazwa: 'x', czynnosc: 'otworz', parametr: 'javascript:alert(1)', palce: [], ruch: 'brak', ksztalt: Array(42).fill(0) }) })).status);
    ok(zly === 400, `5. serwer odrzuca „otwórz javascript:” (${zly})`);

    ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    await b.close();
    env.koniec();
  }
  koniec();
})();

function koniec() {
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nWŁASNE GESTY OK');
  process.exit(fail.length ? 1 : 0);
}

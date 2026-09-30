/* Zdjęcia w odpowiedzi: tekst nie znika, nic nie przepada po cichu.

   Rozmowa Marcina o tygodniu na Sycylii pokazała cztery usterki naraz:
   – „w momencie, kiedy szukał zdjęć, nagle cała jego odpowiedź zniknęła,
     po czym pojawiła się wraz ze zdjęciami” (na czas szukania w miejscu
     planu stał pasek „Szukam zdjęć…”),
   – „Źródła” ucięte na „travelplanet.pl/przew” – budżet tokenów skończył się
     w połowie, a zdjęcia poszły dalej, jakby odpowiedź była cała,
   – przy drugiej prośbie Etna, Katania i plaża zostały bez zdjęć i bez słowa
     (limit dziesięciu siatek, reszta znaczników znikała),
   – „możesz jakieś inne wyszukać?” → [SZUKAJ: zdjęcia …] i „nie znalazłem”.

   Runda 10: zdjęcia stoją w paskach nad sekcjami TEJ SAMEJ odpowiedzi
   (`zdjecia` w wiadomości), a czego zabrakło, mówi Cosmos – bez rundy modelu.

   Środowisko `pelne`, wyszukiwarka grafik podstawiona w przeglądarce:
     1. w trakcie szukania plan stoi na ekranie, w miejscach zdjęć szkielety
        pasków; grupa, która przyszła, podmienia TYLKO swój pasek (bez
        przebudowy rozmowy), a miejsce bez wyników znika i pod odpowiedzią
        stoi zdanie „Nie znaleziono zdjęć: …”,
     2. te same miejsca drugi raz: z pamięci rozmowy (bez sieci), a na prośbę
        o inne – zdjęcia, których rozmowa jeszcze nie pokazała,
     3. osiemnaście znaczników: szesnaście grup, a dwa pominięte człowiek
        widzi z nazwy pod odpowiedzią,
     4. [SZUKAJ: zdjęcia …] – model dostaje uwagę, że zdjęcia szuka się
        przez [GRAFIKA:],
     5. plan ucięty budżetem w połowie adresu jest dokańczany przed zdjęciami –
        adres w „Źródłach” cały,
     6. odświeżenie strony (albo ubicie karty przez Androida) w fazie zdjęć
        nie gubi pokazanych, a brakujące dochodzą same po powrocie,
     7. „Zatrzymaj” w trakcie szukania zdjęć kończy turę od razu i nie wysyła
        kolejnych zapytań; tekst zostaje, szkielety znikają,
     8. telefon 412 px: paski nie rozpychają strony w bok,
     9. stara rozmowa (kawałki + osobne siatki) – jedna odpowiedź z paskami,
        historia ze znacznikami, eksport jedną linią.
*/
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

const fotki = (q, od, ile) => Array.from({ length: ile }, (_, i) => ({
  title: `${q} ${od + i}`, thumb: `https://upload.wikimedia.org/${encodeURIComponent(q)}/${od + i}.jpg`,
  full: `https://upload.wikimedia.org/${encodeURIComponent(q)}/${od + i}-pelne.jpg`, source: 'https://commons.wikimedia.org/',
}));

(async () => {
  const env = await srodowisko('pelne');
  const b = await przegladarka();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const bledy = [];
    p.on('pageerror', (e) => bledy.push(e.message));
    // Wyszukiwarka grafik: odpowiada dopiero na sygnał (albo od razu, gdy `natychmiast`).
    const czekajace = new Map();
    let natychmiast = false;
    let zapytanZdjec = 0;
    await p.route('**/api/search/images?*', (r) => {
      zapytanZdjec++;
      const q = new URL(r.request().url()).searchParams.get('q');
      const odpowiedz = () => r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ results: /Etna/.test(q) ? [] : fotki(q, 1, 16), error: '' }) }).catch(() => {});
      if (natychmiast) return odpowiedz();
      czekajace.set(q, odpowiedz);
    });
    await p.route('**/thumb?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('89504e470d0a1a0a', 'hex') }));
    await p.goto(`${env.adres}/app`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.app.gotowa') && typeof NARZEDZIA !== 'undefined');

    const uruchomGrafiki = (acc) => p.evaluate((acc) => {
      const conv = ensureConversation('Sycylia');
      window.__conv = conv;
      renderMessages();
      const g = NARZEDZIA.find((n) => n.nazwa === 'grafiki');
      // Jak w prawdziwej turze: grupy w drodze rysują się w trakcie generowania.
      isGenerating = true;
      window.__wynik = g.wykonaj({ acc, dop: g.dopasuj(acc), conv, depth: 0, ostatnia: false, przed: '',
        stan: { archiwum: new Set(), grafiki: new Set(), plan: new Set(), grafikiOdlozone: new Set() } })
        .finally(() => { isGenerating = false; });
    }, acc);
    const ostatniaOdpowiedz = () => p.evaluate(() => {
      const m = [...window.__conv.messages].reverse().find((x) => x.role === 'assistant' && Array.isArray(x.zdjecia));
      return m ? { content: m.content, zdjecia: m.zdjecia.map((g) => ({ q: g.q, stan: g.stan, n: (g.photos || []).length, pierwsze: ((g.photos || [])[0] || {}).title || '' })), pominiete: m.zdjeciaPominiete || [] } : null;
    });

    /* ---- 1. Tekst stoi w trakcie szukania; grupa podmienia tylko swój pasek ---- */
    await uruchomGrafiki('### Dzień 1 – Palermo\nKatedra.\n[GRAFIKA: Katedra Palermo]\n### Dzień 2 – Etna\nKrater.\n[GRAFIKA: Etna krater]\nKoniec planu.');
    await p.waitForTimeout(400);
    const wTrakcie = await p.evaluate(() => {
      const msg = [...document.querySelectorAll('.msg-assistant')].pop();
      if (msg) msg.__ten = true;   // ten sam element po przyjściu zdjęć = brak przebudowy rozmowy
      return {
        tekst: document.getElementById('messages').textContent,
        szkielety: document.querySelectorAll('.zdj-pasek[aria-busy="true"]').length,
      };
    });
    ok(/Dzień 1 – Palermo/.test(wTrakcie.tekst) && /Dzień 2 – Etna/.test(wTrakcie.tekst) && /Koniec planu/.test(wTrakcie.tekst),
      '1. w trakcie szukania zdjęć cały plan stoi na ekranie');
    ok(wTrakcie.szkielety === 2, `1. nad każdym dniem szkielet paska (${wTrakcie.szkielety})`);
    czekajace.get('Katedra Palermo')();
    await p.waitForFunction(() => document.querySelectorAll('.zdj-kafel img').length > 0, null, { timeout: 5000 }).catch(() => {});
    const poPierwszej = await p.evaluate(() => ({
      kafelki: document.querySelectorAll('.zdj-kafel:not(.szkielet)').length,
      szkielety: document.querySelectorAll('.zdj-pasek[aria-busy="true"]').length,
      tenSam: Boolean([...document.querySelectorAll('.msg-assistant')].pop()?.__ten),
      podNaglowkiem: document.querySelector('.msg-content > h3 + .zdj-pasek:not([aria-busy])') !== null,
    }));
    ok(poPierwszej.kafelki === 8 && poPierwszej.szkielety === 1, `1. pasek Palermo wypełnia się od razu, Etna dalej czeka (${poPierwszej.kafelki} zdjęć, ${poPierwszej.szkielety} szkielet)`);
    ok(poPierwszej.tenSam, '1. przyjście zdjęć jednego miejsca nie przebudowuje całej rozmowy (ten sam element odpowiedzi)');
    ok(poPierwszej.podNaglowkiem, '1. pasek stoi nad treścią swojego dnia, zaraz pod nagłówkiem');
    czekajace.get('Etna krater')();
    await p.evaluate(() => window.__wynik);
    const po1 = await ostatniaOdpowiedz();
    const ekran1 = await p.evaluate(() => ({
      szkielety: document.querySelectorAll('.zdj-pasek[aria-busy="true"]').length,
      uwagi: [...document.querySelectorAll('.cosmos-uwagi')].map((e) => e.textContent).join(' '),
      odpowiedzi: window.__conv.messages.filter((m) => m.role === 'assistant').length,
    }));
    ok(ekran1.szkielety === 0, '1. puste miejsce po Etnie (bez wyników) znika');
    ok(ekran1.odpowiedzi === 1 && /Dzień 1[\s\S]*Dzień 2[\s\S]*Koniec planu/.test(po1.content),
      `1. cały plan w JEDNEJ wiadomości (wiadomości: ${ekran1.odpowiedzi})`);
    ok(po1.zdjecia.map((g) => `${g.q}:${g.stan}`).join(' | ') === 'Katedra Palermo:gotowe | Etna krater:brak',
      `1. grupy w kolejności znaczników (${po1.zdjecia.map((g) => `${g.q}:${g.stan}`).join(' | ')})`);
    ok(/Etna krater/.test(ekran1.uwagi), `1. człowiek widzi, dla czego zdjęć nie znaleziono („${ekran1.uwagi}”)`);

    /* ---- 2. Te same miejsca drugi raz ---- */
    natychmiast = true;
    const przedZmiana = zapytanZdjec;
    await p.evaluate(() => window.__conv.messages.push({ role: 'user', content: 'Zmień dzień 2 na Cefalù' }));
    await uruchomGrafiki('Zmieniony plan.\n[GRAFIKA: Katedra Palermo]');
    await p.evaluate(() => window.__wynik);
    const zPamieci = await ostatniaOdpowiedz();
    ok(zapytanZdjec === przedZmiana && zPamieci.zdjecia[0].pierwsze === 'Katedra Palermo 1',
      `2. to samo miejsce w przepisanym planie → te same zdjęcia, bez sieci (zapytań: ${zapytanZdjec - przedZmiana})`);
    await p.evaluate(() => window.__conv.messages.push({ role: 'user', content: 'Możesz wyszukać jakieś inne zdjęcia?' }));
    await uruchomGrafiki('Jeszcze raz Palermo.\n[GRAFIKA: Katedra Palermo]');
    await p.evaluate(() => window.__wynik);
    const inne = await ostatniaOdpowiedz();
    ok(inne.zdjecia[0].pierwsze === 'Katedra Palermo 9', `2. „inne zdjęcia” → zdjęcia, których nie było (pierwsze: ${inne.zdjecia[0].pierwsze})`);

    /* ---- 3. Osiemnaście znaczników ---- */
    const osiemnascie = Array.from({ length: 18 }, (_, i) => `Punkt ${i + 1}.\n[GRAFIKA: Miejsce ${i + 1}]`).join('\n');
    await uruchomGrafiki(osiemnascie);
    await p.evaluate(() => window.__wynik);
    const po18 = await ostatniaOdpowiedz();
    const uwagi18 = await p.evaluate(() => [...document.querySelectorAll('.cosmos-uwagi')].pop()?.textContent || '');
    ok(po18.zdjecia.length === 16, `3. szesnaście grup zdjęć (${po18.zdjecia.length})`);
    ok(/Miejsce 17, Miejsce 18/.test(uwagi18), `3. dwa pominięte miejsca człowiek widzi z nazwy („${uwagi18}”)`);
    ok(/Punkt 18/.test(po18.content), '3. tekst przy pominiętych znacznikach zostaje na ekranie');

    /* ---- 4. [SZUKAJ: zdjęcia …] ---- */
    await p.route('**/api/search?*', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ query: 'x', results: [{ title: 'Sycylia – przewodnik', url: 'https://przyklad.pl/sycylia', snippet: 'Plaże i zabytki.' }] }) }));
    const wynik4 = await p.evaluate(async () => {
      const s = NARZEDZIA.find((n) => n.nazwa === 'szukaj');
      const acc = 'Szukam.\n[SZUKAJ: zdjęcia Palermo Cathedral; zdjęcia Etna crater]';
      await s.wykonaj({ acc, dop: s.dopasuj(acc), conv: window.__conv, depth: 0, ostatnia: false, przed: '', stan: {} });
      const m = [...window.__conv.messages].reverse().find((x) => x.role === 'user');
      return m ? String(m.content) : '';
    });
    ok(/wyszukiwanie TEKSTU/.test(wynik4) && /\[GRAFIKA:/.test(wynik4), '4. przy [SZUKAJ: zdjęcia …] model dostaje wskazówkę, żeby użył [GRAFIKA:]');

    /* ---- 5. Ucięty plan dokańczany przed zdjęciami ---- */
    await p.evaluate(() => { newConversation(); });
    await p.fill('#input', 'urwany plan Sycylii');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => typeof isGenerating !== 'undefined' && !isGenerating && document.querySelectorAll('.zdj-kafel img').length > 0, null, { timeout: 20000 }).catch(() => {});
    const piaty = await p.evaluate(() => ({
      link: [...document.querySelectorAll('#messages a')].map((a) => a.href).find((h) => /travelplanet/.test(h)) || '',
      kafelki: document.querySelectorAll('.zdj-kafel img').length,
    }));
    ok(piaty.link === 'https://travelplanet.pl/przewodnik-sycylia', `5. adres w „Źródłach” cały, dokończony przed zdjęciami (${piaty.link || 'brak linku'})`);
    ok(piaty.kafelki > 0, `5. zdjęcia i tak są (${piaty.kafelki})`);

    /* ---- 6. Odświeżenie strony w fazie zdjęć ---- */
    natychmiast = false;
    czekajace.clear();
    await p.evaluate(() => { newConversation(); });
    await uruchomGrafiki('### Dzień 1\nPalermo.\n[GRAFIKA: Katedra Palermo]\n### Dzień 2\nCefalù.\n[GRAFIKA: Cefalù plaża]');
    await p.waitForTimeout(300);
    czekajace.get('Katedra Palermo')();
    await p.waitForFunction(() => document.querySelectorAll('.zdj-kafel img').length > 0, null, { timeout: 5000 }).catch(() => {});
    await p.waitForTimeout(1600);     // zapis po grupie (z krótką zwłoką) + zapis na serwerze
    natychmiast = true;
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.app.gotowa'));
    await p.waitForFunction(() => document.querySelectorAll('.zdj-pasek').length >= 2 && !document.querySelector('.zdj-pasek[aria-busy="true"]'), null, { timeout: 8000 }).catch(() => {});
    const poOdswiezeniu = await p.evaluate(() => {
      const m = (activeConv()?.messages || []).find((x) => Array.isArray(x.zdjecia));
      return { grupy: m ? m.zdjecia.map((g) => `${g.q}:${g.stan}:${(g.photos || []).length}`).join(' | ') : 'brak', paski: document.querySelectorAll('.zdj-pasek').length };
    });
    ok(poOdswiezeniu.grupy === 'Katedra Palermo:gotowe:8 | Cefalù plaża:gotowe:8',
      `6. po odświeżeniu w fazie zdjęć pokazane zostały, a brakujące doszły same (${poOdswiezeniu.grupy})`);

    /* ---- 7. „Zatrzymaj” w trakcie szukania zdjęć ---- */
    natychmiast = false;
    czekajace.clear();
    await p.evaluate(() => { newConversation(); });
    const zapytanPrzedTura = zapytanZdjec;
    await p.fill('#input', 'pokaż zdjęcia miejsc z Majorki');
    await p.keyboard.press('Enter');
    // Oba zapytania o zdjęcia w drodze (odpowiedzi wstrzymane) – dopiero wtedy „Zatrzymaj”.
    for (let i = 0; i < 150 && zapytanZdjec - zapytanPrzedTura < 2; i++) await p.waitForTimeout(100);
    const zapytanPrzedStop = zapytanZdjec;
    const t0 = Date.now();
    await p.click('#stop-btn');
    await p.waitForFunction(() => document.getElementById('stop-btn').style.display === 'none', null, { timeout: 10000 }).catch(() => {});
    const czasStopu = Date.now() - t0;
    await p.waitForTimeout(1000);
    const poStopie = await p.evaluate(() => {
      const m = (activeConv()?.messages || []).find((x) => Array.isArray(x.zdjecia));
      return { stany: m ? [...new Set(m.zdjecia.map((g) => g.stan))].join(',') : 'brak', tekst: m ? m.content : '', szkielety: document.querySelectorAll('.zdj-kafel.szkielet').length };
    });
    ok(czasStopu < 1500, `7. „Zatrzymaj” kończy turę od razu (${czasStopu} ms)`);
    ok(zapytanZdjec === zapytanPrzedStop, `7. po „Zatrzymaj” nie idą kolejne zapytania o zdjęcia (+${zapytanZdjec - zapytanPrzedStop})`);
    ok(poStopie.stany === 'przerwane' && poStopie.szkielety === 0, `7. grupy przerwane, szkielety zniknęły (${poStopie.stany}, szkieletów ${poStopie.szkielety})`);
    ok(/Proszę/.test(poStopie.tekst), '7. tekst odpowiedzi zostaje po „Zatrzymaj”');

    /* ---- 8. Telefon 412 px: nic nie wystaje w bok ---- */
    const tel = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const pt = await tel.newPage();
    await pt.route('**/thumb?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('89504e470d0a1a0a', 'hex') }));
    await pt.goto(`${env.adres}/app`, { waitUntil: 'load' });
    await pt.waitForFunction(() => document.querySelector('.app.gotowa'));
    const szer = await pt.evaluate((f) => {
      const conv = ensureConversation('Telefon');
      const grupa = (q, sekcja, po) => ({ q, etykieta: q, sekcja, po, stan: 'gotowe', photos: f.map((x) => ({ ...x, title: q })) });
      conv.messages.push({ role: 'user', content: 'Plan' }, {
        role: 'assistant', content: '### Dzień 1\nTaormina.\n\n### Dzień 2\nEtna.', silnik: 'cloud',
        zdjecia: [grupa('Teatro Greco, Taormina', 1, 22), grupa('Isola Bella', 1, 22), grupa('Etna', 2, 37)],
      });
      renderMessages();
      /* Trzy miary, bo każda łapie co innego: strona (Chrome na Androidzie
         oddala wtedy cały widok), przewijana rozmowa (ma overflow-x: hidden,
         więc strona sama nie urośnie) i sam pasek względem karty odpowiedzi. */
      const sc = document.getElementById('chat-scroll');
      const karta = document.querySelector('.msg-assistant .msg-kolumna').getBoundingClientRect();
      const zaKarte = [...document.querySelectorAll('.zdj-pasek')].filter((p) => p.getBoundingClientRect().right > karta.right + 1).length;
      return { scroll: document.documentElement.scrollWidth, klient: document.documentElement.clientWidth,
        rozmowa: sc.scrollWidth, rozmowaKlient: sc.clientWidth, zaKarte, kartaPrawa: Math.round(karta.right), okno: innerWidth,
        paski: document.querySelectorAll('.zdj-pasek').length };
    }, fotki('x', 1, 8));
    ok(szer.paski === 2 && szer.scroll <= szer.klient && szer.rozmowa <= szer.rozmowaKlient && szer.zaKarte === 0 && szer.kartaPrawa <= szer.okno,
      `8. 412 px: ${szer.paski} paski, nic nie wystaje w bok (strona ${szer.scroll}/${szer.klient}, rozmowa ${szer.rozmowa}/${szer.rozmowaKlient}, pasków za kartą ${szer.zaKarte}, karta do ${szer.kartaPrawa}/${szer.okno})`);
    await tel.close();

    /* ---- 9. Stara rozmowa (plan pokrojony siatkami) – bez migracji ----
       Zapisane kawałki tekstu i osobne wiadomości { text, photos } rysują się
       jako JEDNA odpowiedź z paskami; wiersz „dane dla modelu” o zdjęciach
       znika; Kopiuj/Regeneruj pod całością; eksport – jedna linia o zdjęciach;
       model dostaje własne znaczniki zamiast ramki „(pokazano zdjęcia: …)”. */
    const stara = await p.evaluate((f) => {
      newConversation();
      const conv = ensureConversation('Stara Sycylia');
      conv.messages.push(
        { role: 'user', content: 'Plan Sycylii ze zdjęciami' },
        { role: 'assistant', content: '### Dzień 1 – Taormina\n- Spacer.', silnik: 'cloud' },
        { role: 'assistant', content: { text: 'Taormina Sicily view', photos: f }, silnik: 'cloud' },
        { role: 'assistant', content: '### Dzień 2 – Etna\n- Kratery.', silnik: 'cloud' },
        { role: 'assistant', content: { text: 'Mount Etna', photos: f }, silnik: 'cloud' },
        { role: 'user', content: 'ZDJĘCIA POKAZANE UŻYTKOWNIKOWI…', search: true, searchQuery: 'wyszukiwanie grafik', narzedzie: 'grafiki' },
        { role: 'assistant', content: 'Miłego wyjazdu!', silnik: 'cloud' },
      );
      renderMessages();
      const doModelu = toApiMessages(conv).filter((m) => m.role === 'assistant').map((m) => m.content).join('\n');
      let eksport = '';
      const stary = URL.createObjectURL;
      URL.createObjectURL = (blob) => { blob.text().then((t) => { eksport = t; }); return 'blob:x'; };
      const klik = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      exportConversation();
      URL.createObjectURL = stary;
      HTMLAnchorElement.prototype.click = klik;
      return new Promise((ok) => setTimeout(() => ok({
        odpowiedzi: document.querySelectorAll('.msg-assistant').length,
        paski: document.querySelectorAll('.zdj-pasek').length,
        akcje: document.querySelectorAll('.msg-assistant .msg-actions').length,
        wiersze: document.querySelectorAll('.msg-search').length,
        doModelu,
        eksport,
      }), 100));
    }, fotki('stare', 1, 8));
    ok(stara.odpowiedzi === 1 && stara.paski === 2, `9. stara rozmowa: jedna odpowiedź z paskami (odpowiedzi ${stara.odpowiedzi}, pasków ${stara.paski})`);
    ok(stara.akcje === 1 && stara.wiersze === 0, `9. pod całością jedne Kopiuj/Regeneruj, bez wiersza „dane dla modelu” (akcje ${stara.akcje}, wiersze ${stara.wiersze})`);
    ok(/\[GRAFIKA: Taormina Sicily view\]/.test(stara.doModelu) && !/pokazano zdjęcia/.test(stara.doModelu),
      '9. model dostaje w historii własne znaczniki, nie ramkę „(pokazano zdjęcia: …)”');
    ok((stara.eksport.match(/\*\*Cosmos:\*\*/g) || []).length === 1 && /\(16\): Taormina Sicily view, Mount Etna/.test(stara.eksport),
      `9. eksport: jedna odpowiedź i jedna linia o zdjęciach z nazwami miejsc`);

    ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    await b.close();
    env.koniec();
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nZDJĘCIA BEZ ZNIKANIA OK');
  process.exit(fail.length ? 1 : 0);
})();

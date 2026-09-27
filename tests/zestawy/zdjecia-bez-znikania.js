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

   Środowisko `pelne`, wyszukiwarka grafik podstawiona w przeglądarce:
     1. w trakcie szukania plan stoi na ekranie, pod punktami szkielety siatek;
        siatka wskakuje na miejsce, gdy przychodzą jej zdjęcia, a puste miejsce
        (brak wyników) znika – i model dowiaduje się, czego nie znaleziono,
     2. te same miejsca drugi raz: zdjęcia, których rozmowa jeszcze nie pokazała,
     3. osiemnaście znaczników: szesnaście siatek, a dwa pominięte model dostaje
        z nazwy,
     4. [SZUKAJ: zdjęcia …] – model dostaje uwagę, że zdjęcia szuka się
        przez [GRAFIKA:],
     5. plan ucięty budżetem w połowie adresu jest dokańczany przed zdjęciami –
        adres w „Źródłach” cały.
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
    await p.route('**/api/search/images?*', (r) => {
      const q = new URL(r.request().url()).searchParams.get('q');
      const odpowiedz = () => r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ results: /Etna/.test(q) ? [] : fotki(q, 1, 16), error: '' }) });
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
      // Jak w prawdziwej turze: szkielet siatki żyje tylko w trakcie generowania.
      isGenerating = true;
      window.__wynik = g.wykonaj({ acc, dop: g.dopasuj(acc), conv, depth: 0, ostatnia: false, przed: '',
        stan: { archiwum: new Set(), grafiki: new Set(), plan: new Set(), grafikiOdlozone: new Set() } })
        .finally(() => { isGenerating = false; });
    }, acc);
    const ostatniWynikNarzedzia = () => p.evaluate(() => {
      const m = [...window.__conv.messages].reverse().find((x) => x.role === 'user');
      return m ? (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) : '';
    });

    /* ---- 1. Tekst stoi w trakcie szukania ---- */
    await uruchomGrafiki('Dzień 1 – Palermo, katedra.\n[GRAFIKA: Katedra Palermo]\nDzień 2 – Etna, krater.\n[GRAFIKA: Etna krater]\nKoniec planu.');
    await p.waitForTimeout(400);
    const wTrakcie = await p.evaluate(() => ({
      tekst: document.getElementById('messages').textContent,
      szkielety: document.querySelectorAll('.photo-grid.szukam').length,
    }));
    ok(/Dzień 1 – Palermo/.test(wTrakcie.tekst) && /Dzień 2 – Etna/.test(wTrakcie.tekst) && /Koniec planu/.test(wTrakcie.tekst),
      '1. w trakcie szukania zdjęć cały plan stoi na ekranie');
    ok(wTrakcie.szkielety === 2, `1. pod każdym punktem szkielet siatki (${wTrakcie.szkielety})`);
    czekajace.get('Katedra Palermo')();
    await p.waitForFunction(() => document.querySelectorAll('.photo-tile').length > 0, null, { timeout: 5000 }).catch(() => {});
    const poPierwszej = await p.evaluate(() => ({
      kafelki: document.querySelectorAll('.photo-tile').length,
      szkielety: document.querySelectorAll('.photo-grid.szukam').length,
    }));
    ok(poPierwszej.kafelki === 8 && poPierwszej.szkielety === 1, `1. siatka Palermo wskakuje od razu, Etna dalej czeka (${poPierwszej.kafelki} zdjęć, ${poPierwszej.szkielety} szkielet)`);
    czekajace.get('Etna krater')();
    await p.evaluate(() => window.__wynik);
    const poWszystkich = await p.evaluate(() => ({
      szkielety: document.querySelectorAll('.photo-grid.szukam').length,
      kolejnosc: window.__conv.messages.filter((m) => m.role === 'assistant' && !m.status)
        .map((m) => (m.content && m.content.photos ? `SIATKA ${m.content.text}` : String(m.content).slice(0, 12))),
    }));
    ok(poWszystkich.szkielety === 0, '1. puste miejsce po Etnie (bez wyników) znika');
    ok(poWszystkich.kolejnosc.join(' | ') === 'Dzień 1 – Pa | SIATKA Katedra Palermo | Dzień 2 – Et | Koniec planu',
      `1. siatka Palermo pod swoim punktem, reszta planu na miejscu (${poWszystkich.kolejnosc.join(' | ')})`);
    const wynik1 = await ostatniWynikNarzedzia();
    ok(/BEZ WYNIKÓW: Etna krater/.test(wynik1), '1. model wie, dla czego zdjęć nie znaleziono');

    /* ---- 2. Te same miejsca drugi raz: inne zdjęcia ---- */
    natychmiast = true;
    await uruchomGrafiki('Jeszcze raz Palermo.\n[GRAFIKA: Katedra Palermo]');
    await p.evaluate(() => window.__wynik);
    const drugie = await p.evaluate(() => {
      const siatki = window.__conv.messages.filter((m) => m.content && m.content.photos && m.content.photos.length);
      return siatki.map((s) => s.content.photos.map((f) => f.title.split(' ').pop()).join(','));
    });
    ok(drugie.length === 2 && drugie[0] === '1,2,3,4,5,6,7,8' && drugie[1] === '9,10,11,12,13,14,15,16', `2. drugi raz te same miejsca → zdjęcia, których nie było (${drugie.join(' / ')})`);

    /* ---- 3. Osiemnaście znaczników ---- */
    const osiemnascie = Array.from({ length: 18 }, (_, i) => `Punkt ${i + 1}.\n[GRAFIKA: Miejsce ${i + 1}]`).join('\n');
    await uruchomGrafiki(osiemnascie);
    await p.evaluate(() => window.__wynik);
    const po18 = await p.evaluate(() => {
      const od = window.__conv.messages.findLastIndex((m) => m.role === 'user' && /Sycylia/.test(String(m.content))) + 1;
      const siatki = window.__conv.messages.filter((m) => m.content && m.content.photos && /Miejsce/.test(m.content.text || ''));
      const teksty = window.__conv.messages.filter((m) => typeof m.content === 'string' && /Punkt 18/.test(m.content));
      return { siatek: siatki.length, punkt18: teksty.length, od };
    });
    const wynik3 = await ostatniWynikNarzedzia();
    ok(po18.siatek === 16, `3. szesnaście siatek (${po18.siatek})`);
    ok(/POMINIĘTE[^\n]*Miejsce 17, Miejsce 18/.test(wynik3), '3. dwa pominięte miejsca model dostaje z nazwy');
    ok(po18.punkt18 === 1, '3. tekst przy pominiętych znacznikach zostaje na ekranie');

    /* ---- 4. [SZUKAJ: zdjęcia …] ---- */
    await p.route('**/api/search?*', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ query: 'x', results: [{ title: 'Sycylia – przewodnik', url: 'https://przyklad.pl/sycylia', snippet: 'Plaże i zabytki.' }] }) }));
    await p.evaluate(async () => {
      const s = NARZEDZIA.find((n) => n.nazwa === 'szukaj');
      const acc = 'Szukam.\n[SZUKAJ: zdjęcia Palermo Cathedral; zdjęcia Etna crater]';
      await s.wykonaj({ acc, dop: s.dopasuj(acc), conv: window.__conv, depth: 0, ostatnia: false, przed: '', stan: {} });
    });
    const wynik4 = await ostatniWynikNarzedzia();
    ok(/wyszukiwanie TEKSTU/.test(wynik4) && /\[GRAFIKA:/.test(wynik4), '4. przy [SZUKAJ: zdjęcia …] model dostaje wskazówkę, żeby użył [GRAFIKA:]');

    /* ---- 5. Ucięty plan dokańczany przed zdjęciami ---- */
    await p.evaluate(() => { newConversation(); });
    await p.fill('#input', 'urwany plan Sycylii');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => typeof isGenerating !== 'undefined' && !isGenerating && document.querySelectorAll('.photo-tile').length > 0, null, { timeout: 20000 }).catch(() => {});
    const piaty = await p.evaluate(() => ({
      link: [...document.querySelectorAll('#messages a')].map((a) => a.href).find((h) => /travelplanet/.test(h)) || '',
      kafelki: document.querySelectorAll('.photo-tile').length,
    }));
    ok(piaty.link === 'https://travelplanet.pl/przewodnik-sycylia', `5. adres w „Źródłach” cały, dokończony przed zdjęciami (${piaty.link || 'brak linku'})`);
    ok(piaty.kafelki > 0, `5. zdjęcia i tak są (${piaty.kafelki})`);

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

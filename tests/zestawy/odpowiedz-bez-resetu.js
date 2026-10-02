/* Odpowiedź, którą człowiek czyta, nie resetuje się w trakcie tury (R1, runda 11).

   Marcin: „odpowiedź resetuje się i pisze od nowa”. Mierzymy to tak, jak widzi
   to człowiek: co 100 ms długość tekstu odpowiedzi w #messages (karty
   asystenta bez pasków postępu, myślenia, podpisów i przycisków). Gwarancja:
   ta długość NIGDY nie spada w trakcie tury. Tekst zwinięty do „Poprzedniej
   wersji” (agencja-ux, decyzja 4) liczy się jako zachowany – stoi w tej samej
   karcie, jedno kliknięcie od oczu.

   Atrapa dostawcy (OpenAI-compatible, strumień) w tym pliku, port 7671;
   Cosmos na 3671. Słowo w pytaniu wybiera scenariusz:

   G1. scena-szkic: runda 0 = pełny plan (tabela) + [PLAN:] + [GRAFIKA:] →
       zdjęcia odłożone, runda 1 = gotowy plan dzień po dniu. Dawniej szkic
       w ogóle nie szedł na ekran (1017 → 0 zn.). Teraz: bez spadku, na końcu
       JEDEN plan na wierzchu, szkic zwinięty w „Szkic przed danymi”.
   G2. scena-przepis: plan + [PLAN:] → runda 1 przepisuje plan z danymi
       (zapora powtórek podmienia). Bez spadku; stara wersja zwinięta.
   G3. scena-dymek: przebudowa rozmowy w trakcie pisania (zapis z 409, wynik
       narzędzia) nie wyrzuca żywego dymka – tekst dalej widać i rośnie.
   G4. scena-zespol: zespół z fotografem (plan policzony), prowadzący pisze
       gotową odpowiedź i na końcu [PLAN:] → JEDNO wywołanie prowadzącego,
       tekst zostaje (kontrakt K2), bez spadku; polecenie „plan już policzony”
       nie jest rysowane (K1).
   G5. EN: „Poprzednia wersja” po angielsku.
   G6. koszt (W4.3/W4.11): tura zespołu z prowadzącym na płatnym silniku i dwiema
       rundami kaskady – „cała odpowiedź” w stopce bloku = przyrost licznika
       zużycia na serwerze (dawniej tylko runda 0, ~70% rachunku).
   G7. „Odpowiedz zespołem” pod odpowiedzią solo: solo zwija się do „Odpowiedź
       bez zespołu” w karcie odpowiedzi zespołu (K6), a jej koszt jest w „cała
       odpowiedź” („w tym zastąpiona odpowiedź”); całość = przyrost licznika
       od pytania solo. */
const http = require('http');
const { serwerCosmosa, czekajNa, zwolnijPorty, przegladarka, wynik } = require('../pomoc');

const PORT = 3671;
const POSREDNIK = 3672;      // pośrednik TCP przed Cosmosem – „winda”: zrywa połączenia i odcina sieć
const ATRAPA = 7671;
const ADRES = `http://127.0.0.1:${PORT}`;
const w = wynik('odpowiedz-bez-resetu');
const ok = (warunek, opis) => { console.log(`${warunek ? '✓' : '✗'} ${opis}`); w.sprawdz(warunek, opis); return warunek; };
const spij = (ms) => new Promise((r) => setTimeout(r, ms));

const DZIEN = (n, miejsce) => `| **${n}** | ${miejsce} | Zwiedzanie – spacer po starym mieście, punkt widokowy, lody dla córki | ISO 200, f/8, 1/250 s |`;
const PLAN0 = `**Tygodniowy plan wyjazdu na Sycylię (wrzesień 2027)**

| Dzień | Miejsce | Plan | Nastawy |
|---|---|---|---|
${['Palermo', 'Monreale', 'Cefalù', 'Agrigento', 'Plaża San Vito', 'Syrakuzy', 'Taormina'].map((m, i) => DZIEN(i + 1, m)).join('\n')}

### Uwagi dotyczące pogody i światła
- We wrześniu na Sycylii średnie temperatury dzienne wynoszą 24-29 °C, nocą 18-20 °C.
- Długość dnia wynosi ok. 12,5 h (wschód ≈ 06:45, zachód ≈ 19:00-19:30). Złota godzina wieczorem jest najlepsza na zdjęcia nad morzem.
`;
const PLAN1_DNI = `### Dzień 1 · Palermo · zwiedzanie
Spacer po Quattro Canti i katedrze. Wieczorem złota godzina 18:33–19:08.
[GRAFIKA: Katedra Palermo]

### Dzień 2 · Etna · zwiedzanie
Wyjazd rano, kolejka linowa, łatwe ścieżki dla czterolatki. Na górze chłodniej o kilkanaście stopni.
[GRAFIKA: Etna]

### Dzień 3 · Taormina · odpoczynek
Teatro Greco rano, plaża Isola Bella po południu, kolacja z widokiem na zatokę.
`;
const DLUGI = 'Odpowiedź płynie powoli, zdanie po zdaniu, żeby przebudowa trafiła w środek pisania. '.repeat(14);
const ZESPOL_ODP = `## Morskie Oko o zachodzie\n\n${'Plan na wieczór: wyjście z parkingu na Palenicy o 15:30, nad stawem przed złotą godziną. '.repeat(6)}\n\n[PLAN: miejsce=Morskie Oko kiedy=2026-10-01T18:00]`;

// ---------------------------------------------------------------- atrapa
const zadania = [];
const tekstWiad = (ms) => (ms || []).map((m) => (typeof m.content === 'string' ? m.content
  : Array.isArray(m.content) ? m.content.map((p) => p.text || '').join('\n') : '')).join('\n\n');

const DUZE = { prompt_tokens: 200000, completion_tokens: 20000 };
const ileRund = new Map();      // pytanie → ile razy prowadzący już odpowiadał

function strumien(res, tekst, krokMs = 15, usage = { prompt_tokens: 100, completion_tokens: 40 }) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const kawalki = tekst.match(/[\s\S]{1,8}/g) || [];
  let i = 0;
  const tik = setInterval(() => {
    if (res.destroyed) { clearInterval(tik); return; }
    if (i >= kawalki.length) {
      clearInterval(tik);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
      res.write('data: [DONE]\n\n'); res.end();
      return;
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: kawalki[i++] } }] })}\n\n`);
  }, krokMs);
  res.on('close', () => clearInterval(tik));
}

const atrapa = http.createServer((req, res) => {
  if (req.url.startsWith('/geokoduj')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify([{ lat: '49.2013', lon: '20.0714', display_name: 'Morskie Oko, Tatry' }]));
  }
  if (req.url.startsWith('/pogoda')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ timezone: 'Europe/Warsaw', utc_offset_seconds: 7200,
      current: { weather_code: 0, cloud_cover: 0, temperature_2m: 10, wind_speed_10m: 2 },
      hourly: { time: [], weather_code: [], cloud_cover: [], temperature_2m: [] } }));
  }
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ object: 'list', data: [{ id: 'nvidia/nemotron-3-super-120b-a12b', object: 'model' }] }));
  }
  if (req.url !== '/v1/chat/completions' || req.method !== 'POST') { res.writeHead(404); return res.end('{}'); }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let p;
    try { p = JSON.parse(body); } catch { res.writeHead(400); return res.end('{}'); }
    const system = (p.messages || []).filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const pelny = tekstWiad(p.messages);
    const rola = (system.match(/ROLA AGENTA: ([A-ZĄĆĘŁŃÓŚŹŻ]+)/) || [])[1] || '';
    const rodzaj = /ZAPLANUJ SKŁAD/.test(system) ? 'planista' : rola ? 'rola' : 'prowadzacy';
    // Ostatnie pytanie człowieka (nie wynik narzędzia) wybiera scenariusz.
    const pytanie = [...(p.messages || [])].reverse().find((m) => m.role === 'user' && /scena-/.test(tekstWiad([m])));
    const sc = ((pytanie && tekstWiad([pytanie]).match(/scena-([a-z]+)/)) || [])[1] || '';
    zadania.push({ rodzaj, rola, sc, czas: Date.now(), model: p.model, ost: tekstWiad([(p.messages || []).slice(-1)[0]]).slice(0, 70).replace(/\n/g, ' '), notatki: /NOTATKI ZESPOŁU/.test(pelny) });
    if (p.stream === false || rodzaj === 'planista') {
      const tresc = rodzaj === 'planista' && /scena-(koszt|zapas)/.test(pelny)
        ? '{"zespol": true, "role": [{"rola": "analityk", "zadanie": "Porównaj ceny"}, {"rola": "recenzent", "zadanie": "Sprawdź"}]}'
        : rodzaj === 'planista'
        ? '{"zespol": true, "role": [{"rola": "fotograf", "zadanie": "Nastawy na zachód"}, {"rola": "recenzent", "zadanie": "Czy nastawy mieszczą się w sprzęcie"}], "szukaj": "", "miejsce": "Morskie Oko", "kiedy": "2026-10-01T18:00"}'
        : 'OK.';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: tresc }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 30 } }));
    }
    const duze = /scena-koszt/.test(pelny) ? DUZE : undefined;
    // Model roli wycofany u dostawcy (404) – rola przechodzi na zapas (K3).
    if (rodzaj === 'rola' && rola === 'ANALITYK' && /scena-zapas/.test(pelny) && /wycofany/.test(String(p.model))) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: `Function '${p.model}': Not found for account 'atrapa'` } }));
    }
    if (rodzaj === 'rola') return strumien(res, `WNIOSKI: notatka roli ${rola}.\nLICZBY I FAKTY: ISO 100, f/8, 1/125 s.\nNIEPEWNE: brak.`, 5, duze);
    if (sc === 'koszt') {
      // Runda 0: odpowiedź + nowe wyszukanie (druga runda kaskady), runda 1: gotowa odpowiedź.
      // Wynik narzędzia skleja się z pytaniem w jedną wiadomość (ujednolicRole) – kluczem jest samo zdanie.
      const klucz = ((pytanie ? tekstWiad([pytanie]) : '').match(/scena-[^\n]*/) || [''])[0];
      const n = (ileRund.get(klucz) || 0) + 1;
      ileRund.set(klucz, n);
      const zespol = /NOTATKI ZESPOŁU/.test(pelny);
      if (!zespol) return strumien(res, `Odpowiedź solo o cenach obiektywów. ${'Porównanie cen w sklepach i opinie użytkowników. '.repeat(6)}`, 10, DUZE);
      return strumien(res, n % 2 === 1
        ? 'Sprawdzam aktualne ceny obiektywów.\n\n[SZUKAJ: ceny obiektywów 24-70 f/4 październik]'
        : `## Ceny obiektywów\n\n${'Zestawienie cen i opinii po wyszukaniu. '.repeat(8)}`, 10, DUZE);
    }
    const zdjeciaNie = /ZDJĘCIA JESZCZE NIE POKAZANE/.test(pelny);
    const danePlanu = /DANE PLANU ZDJ/.test(pelny);
    if (sc === 'szkic') return strumien(res, zdjeciaNie ? PLAN1_DNI : `${PLAN0}\n[PLAN: miejsce=Palermo kiedy=2027-09-15T18:30]\n[GRAFIKA: Katedra Palermo; Etna]`);
    if (sc === 'przepis') return strumien(res, danePlanu ? PLAN0.replace('06:45', '06:40').replace('19:00-19:30', '19:08') : `${PLAN0}\n[PLAN: miejsce=Palermo kiedy=2027-09-15T18:30]`);
    if (sc === 'dymek') return strumien(res, DLUGI, 30);
    if (sc === 'wolny') return strumien(res, `${DLUGI}KONIEC-ODPOWIEDZI`, 25);
    if (sc === 'zespol') return strumien(res, ZESPOL_ODP);
    if (sc === 'zapas') return strumien(res, 'Odpowiedź zespołu po zapasie roli.');
    return strumien(res, 'Cześć z atrapy.');
  });
  return undefined;
});

// ---------------------------------------------------------------- pomiar
/* Długość tekstu odpowiedzi na ekranie – karty asystenta bez pasków postępu
   i kuchni (myślenie, czekanie, podpis, przyciski, blok zespołu, paski zdjęć). */
const PROBKA = () => {
  const m = document.getElementById('messages');
  const karty = [...m.querySelectorAll('.msg-assistant:not(.msg-status)')];
  const tekst = (el) => {
    const k = el.cloneNode(true);
    k.querySelectorAll('.think-block, .wait-note, .model-note, .msg-actions, .msg-silnik, .zdj-pasek, .zespol, .zespol-blok, .msg-avatar').forEach((x) => x.remove());
    return (k.textContent || '').replace(/\s+/g, ' ').trim();
  };
  const dl = karty.reduce((s, a) => s + tekst(a.querySelector('.msg-kolumna') || a).length, 0);
  return { dl, generuje: typeof isGenerating !== 'undefined' && isGenerating };
};

/** Wyślij pytanie i próbkuj co 100 ms do końca tury. Zwraca oś i spadki. */
async function tura(page, pytanie, { wTrakcie } = {}) {
  await page.fill('#input', pytanie);
  await page.press('#input', 'Enter');
  const os = [];
  const start = Date.now();
  let poprzedni = 0;
  const spadki = [];
  let zrobione = false;
  let poKoncu = 0;
  while (Date.now() - start < 45000) {
    let s;
    try { s = await page.evaluate(PROBKA); } catch { await spij(100); continue; }
    s.ms = Date.now() - start;
    os.push(s);
    if (s.dl < poprzedni - 2) spadki.push(`${s.ms} ms: ${poprzedni} → ${s.dl}`);
    poprzedni = s.dl;
    if (wTrakcie && !zrobione && s.dl > 300) { zrobione = true; await wTrakcie(); }
    if (!s.generuje && s.ms > 1500) { if (!poKoncu) poKoncu = s.ms; if (s.ms - poKoncu > 600) break; }
    await spij(100);
  }
  return { os, spadki, max: Math.max(0, ...os.map((x) => x.dl)) };
}

(async () => {
  await zwolnijPorty([PORT, ATRAPA, POSREDNIK]);
  const net = require('net');
  const gniazda = new Set();
  let bezSieci = false;
  const posrednik = net.createServer((we) => {
    if (bezSieci) { we.destroy(); return; }
    const wy = net.connect(PORT, '127.0.0.1');
    gniazda.add(we); gniazda.add(wy);
    we.pipe(wy); wy.pipe(we);
    const zamknij = () => { we.destroy(); wy.destroy(); gniazda.delete(we); gniazda.delete(wy); };
    we.on('error', zamknij); wy.on('error', zamknij); we.on('close', zamknij); wy.on('close', zamknij);
  });
  await new Promise((r) => posrednik.listen(POSREDNIK, '127.0.0.1', r));
  const odetnijSiec = (tak) => { bezSieci = tak; if (tak) for (const g of gniazda) g.destroy(); };
  await new Promise((r) => atrapa.listen(ATRAPA, '127.0.0.1', r));
  serwerCosmosa(PORT, {
    NVIDIA_API_KEY: 'test-nvidia', NEMOTRON_BASE_URL: `http://127.0.0.1:${ATRAPA}/v1`,
    NEMOTRON_MODEL: 'nvidia/nemotron-3-super-120b-a12b',
    ANTHROPIC_API_KEY: 'sk-ant-odpowiedz-bez-resetu', ANTHROPIC_BASE_URL: `http://127.0.0.1:${ATRAPA}/v1`, CLAUDE_MODEL: 'claude-sonnet-5',
    GEOCODE_SEARCH_URL: `http://127.0.0.1:${ATRAPA}/geokoduj`, WEATHER_URL: `http://127.0.0.1:${ATRAPA}/pogoda`,
    // Zdjęcia nie są tu sprawdzane – źródła odpowiadają od razu pustką.
    IMAGE_SEARCH_URL: `http://127.0.0.1:${ATRAPA}/brak`, COMMONS_API_URL: `http://127.0.0.1:${ATRAPA}/brak`,
    OPENVERSE_API_URL: `http://127.0.0.1:${ATRAPA}/brak`, SEARCH_URL: `http://127.0.0.1:${ATRAPA}/brak`,
    COSMOS_BIEG_SIEROTA_MS: '1500',
  });
  if (!(await czekajNa(`${ADRES}/api/config`))) { w.zapisz('serwer nie wstał'); return w.zakoncz(); }
  const b = await przegladarka();
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block', locale: 'pl-PL' });
    await ctx.addInitScript(() => {
      try {
        if (!localStorage.getItem('cosmos.settings')) localStorage.setItem('cosmos.settings', JSON.stringify({ zespolPotwierdzaj: false }));
        localStorage.setItem('cosmos.lang', localStorage.getItem('cosmos.lang') || 'pl');
      } catch { /* */ }
    });
    const page = await ctx.newPage();
    const bledy = [];
    page.on('pageerror', (e) => bledy.push(e.message));
    await page.goto(`${ADRES}/app`, { waitUntil: 'load' });
    await page.waitForSelector('.app.gotowa', { timeout: 15000 }).catch(() => {});
    const nowaRozmowa = async () => { await page.evaluate(() => newConversation()); await spij(150); };
    const koniec = () => page.evaluate(() => {
      const karty = [...document.querySelectorAll('#messages .msg-assistant:not(.msg-status)')];
      return {
        karty: karty.length,
        tabele: karty.filter((k) => k.querySelector('.msg-content table')).length,
        poprzednie: [...document.querySelectorAll('#messages .wersja-poprzednia')].map((d) => ({ tytul: d.querySelector('.tytul').textContent, meta: d.querySelector('.meta').textContent, otwarte: d.open })),
        dzien: [...document.querySelectorAll('#messages .msg-content > h3')].map((h) => h.textContent),
        ekran: document.getElementById('messages').innerText,
        apiPoprzednie: JSON.stringify(toApiMessages(activeConversation)).includes('Tygodniowy plan wyjazdu'),
        zapisane: activeConversation.messages.filter((m) => Array.isArray(m.poprzednie)).length,
      };
    });

    // ---------------------------------------------------------------- G1
    const g1 = await tura(page, 'scena-szkic Wybieram się na Sycylię za rok we wrześniu, plan tygodnia ze zdjęciami.');
    const k1 = await koniec();
    ok(g1.max > 900 && !g1.spadki.length, `G1a. szkic przy odłożonych zdjęciach: tekst nie spada ani razu (max ${g1.max}, spadki: ${g1.spadki.join('; ') || 'brak'})`);
    ok(k1.tabele === 0 && k1.dzien.length >= 3, `G1b. na końcu na wierzchu JEDEN plan – gotowa wersja dzień po dniu (tabel na wierzchu: ${k1.tabele}, nagłówków dni: ${k1.dzien.length})`);
    ok(k1.poprzednie.length === 1 && k1.poprzednie[0].tytul === 'Szkic przed danymi' && !k1.poprzednie[0].otwarte && /znaków/.test(k1.poprzednie[0].meta),
      `G1c. szkic zwinięty w „Szkic przed danymi” z liczbą znaków (${JSON.stringify(k1.poprzednie)})`);
    // Wersja poprzednia to widok – do modelu w następnej turze nie idzie.
    ok(k1.zapisane === 1 && !k1.apiPoprzednie, `G1d. poprzednia wersja zapisana w rozmowie, ale toApiMessages jej nie wysyła (${k1.zapisane}, w API: ${k1.apiPoprzednie})`);

    // ---------------------------------------------------------------- G2
    await nowaRozmowa();
    const g2 = await tura(page, 'scena-przepis Plan na Sycylię z nastawami aparatu.');
    const k2 = await koniec();
    ok(g2.max > 900 && !g2.spadki.length, `G2a. przepisany plan: tekst nie spada (max ${g2.max}, spadki: ${g2.spadki.join('; ') || 'brak'})`);
    const slad2 = await page.evaluate(() => [...document.querySelectorAll('#messages .msg-search[data-narzedzie="plan"] summary')].map((x) => x.textContent));
    ok(slad2.length === 1 && /^Plan zdjęciowy · [^·]+ · 15 wrz 2027$/.test(slad2[0]), `G2c. ślad planu: data-narzedzie="plan" i podpis „miejsce · dzień” (${JSON.stringify(slad2)})`);
    ok(k2.tabele === 1 && k2.poprzednie.length === 1 && k2.poprzednie[0].tytul === 'Poprzednia wersja' && /06:40/.test(k2.ekran),
      `G2b. na końcu jeden plan (z danymi), stara wersja zwinięta (tabel: ${k2.tabele}, poprzednie: ${k2.poprzednie.length})`);

    // ---------------------------------------------------------------- G3
    await nowaRozmowa();
    const g3 = await tura(page, 'scena-dymek Opowiedz coś długiego.', {
      wTrakcie: async () => {
        // Przebudowa w trakcie pisania – tak robi zapis po 409, wynik narzędzia i zmiana bloku.
        await page.evaluate(() => renderMessages());
        await spij(250);
        await page.evaluate(() => renderMessages({ przewin: false }));
      },
    });
    ok(g3.max > DLUGI.trim().length * 0.9 && !g3.spadki.length, `G3. przebudowa rozmowy w trakcie pisania nie zabiera żywego dymka (max ${g3.max}, spadki: ${g3.spadki.join('; ') || 'brak'})`);

    // ---------------------------------------------------------------- G4
    await nowaRozmowa();
    zadania.length = 0;
    await page.click('#zespol-btn');
    const g4 = await tura(page, 'scena-zespol Plan zdjęć nad Morskim Okiem o zachodzie, nastawy aparatu.');
    const prowadzacy = zadania.filter((z) => z.rodzaj === 'prowadzacy' && z.sc === 'zespol').length;
    const k4 = await koniec();
    const wRozmowie = await page.evaluate(() => activeConversation.messages.map((m) => ({ s: Boolean(m.search), st: Boolean(m.sterowanie), n: m.narzedzie || '' })));
    ok(prowadzacy === 1, `G4a. plan policzony przez fotografa + [PLAN:] prowadzącego → jedno wywołanie prowadzącego (${prowadzacy}, role: ${zadania.filter((z) => z.rodzaj === 'rola').length})`);
    ok(g4.max > 400 && !g4.spadki.length && /Morskie Oko o zachodzie/.test(k4.ekran), `G4b. tekst prowadzącego zostaje, bez spadku (max ${g4.max}, spadki: ${g4.spadki.join('; ') || 'brak'})`);
    ok(!/PLAN JEST JUŻ POLICZONY|dane dla modelu/i.test(k4.ekran) && !/\[PLAN:/.test(k4.ekran),
      `G4c. ani polecenie dla modelu, ani znacznik nie stoją na ekranie (sterowanie w rozmowie: ${wRozmowie.filter((m) => m.st).length})`);
    const plan4 = await page.evaluate(() => (document.querySelector('#messages .zespol .zespol-plan') || {}).textContent || '');
    ok(/^Plan zdjęciowy · Morskie Oko(, Tatry)? · 1 paź 2026$/.test(plan4), `G4d. blok zespołu mówi, dla czego policzono plan (K4): „${plan4}”`);

    // ---------------------------------------------------------------- G8
    await nowaRozmowa();
    // Skład z edycji: analityk na modelu, którego dostawca już nie ma (404) – zapas.
    await page.evaluate(() => { zespolNaTure = { sklad: [{ rola: 'analityk', silnik: 'cloud', model: 'nvidia/model-wycofany-49b' }, { rola: 'recenzent' }] }; });
    await tura(page, 'scena-zapas Porównaj ceny dwóch obiektywów.');
    const z8 = await page.evaluate(() => ({
      nota: [...document.querySelectorAll('#messages .zespol .zespol-zapas')].map((x) => x.textContent),
      uwagi: [...document.querySelectorAll('#messages .zespol .rola-uwaga')].filter((x) => !x.hidden).map((x) => x.textContent),
    }));
    ok(z8.nota.length === 1 && /^model-wycofany-49b jest niedostępny – Analityk na zapasowym modelu\.$/.test(z8.nota[0]) && !z8.uwagi.some((u) => /zapas/.test(u)),
      `G8. zapas roli: jedna cicha nota na blok, bez dopisku przy roli (K3) (${JSON.stringify(z8)})`);

    // ---------------------------------------------------------------- G5
    await page.evaluate(() => { localStorage.setItem('cosmos.lang', 'en'); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.app.gotowa', { timeout: 15000 }).catch(() => {});
    await page.evaluate(async () => {
      const lista = conversations.filter((c) => c.title || true);
      for (const c of lista) { await selectConversation(c.id); if (activeConversation && activeConversation.messages.some((m) => Array.isArray(m.poprzednie))) break; }
    });
    await spij(300);
    const en = await page.evaluate(() => [...document.querySelectorAll('#messages .wersja-poprzednia')].map((d) => `${d.querySelector('.tytul').textContent} | ${d.querySelector('.meta').textContent}`));
    ok(en.length >= 1 && en.every((x) => /^(Previous version|Draft before the data) \| .*characters/.test(x)), `G5. EN: linijka poprzedniej wersji po angielsku (${JSON.stringify(en)})`);

    // ---------------------------------------------------------------- G6, G7
    await page.evaluate(() => { localStorage.setItem('cosmos.lang', 'pl'); });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.app.gotowa', { timeout: 15000 }).catch(() => {});
    /** Licznik zużycia osoby na serwerze (zł, ten miesiąc, wszystkie silniki). */
    const licznik = () => page.evaluate(async () => {
      const d = await (await fetch('/api/konto')).json();
      return Number((((d.uzytkownik || {}).zuzycie || {}).zl || {}).miesiac) || 0;
    });
    const kwotaZ = (t) => Number((String(t).replace(/\u00a0/g, ' ').match(/cała odpowiedź: (?:ok\. )?(\d+,\d{2})/) || [])[1]?.replace(',', '.') || NaN);
    const stopka = () => page.evaluate(() => { const k = [...document.querySelectorAll('#messages .zespol .zespol-koszt')].pop(); return k ? k.textContent : ''; });

    await nowaRozmowa();
    await page.evaluate(() => setEndpoint('claude'));
    const przed6 = await licznik();
    await page.click('#zespol-btn');
    zadania.length = 0;
    await tura(page, 'scena-koszt Porównaj ceny obiektywów 24-70 f/4 i sprawdź opinie.');
    await spij(800);
    const po6 = await licznik();
    const s6 = await stopka();
    const rund6 = zadania.filter((z) => z.rodzaj === 'prowadzacy' && z.sc === 'koszt').length;
    if (process.env.DEBUG_KOSZT) console.log(JSON.stringify(zadania, null, 0));
    ok(rund6 === 2 && Math.abs(kwotaZ(s6) - (po6 - przed6)) <= 0.011,
      `G6. „cała odpowiedź” = przyrost licznika przy dwóch rundach prowadzącego (stopka „${s6}”, licznik +${(po6 - przed6).toFixed(4)} zł, rund ${rund6})`);

    await nowaRozmowa();
    const przed7 = await licznik();
    await tura(page, 'scena-koszt Porównaj najnowsze ceny obiektywów i napisz skrypt w pythonie, który je zestawi, oraz sprawdź opinie');
    const sug = await page.waitForSelector('.zespol-sugestia .zespol-uruchom', { timeout: 5000 }).then((e) => e.textContent()).catch(() => '');
    ok(sug === 'Odpowiedz zespołem', `G7a. link pod odpowiedzią solo mówi, co robi: „${sug}”`);
    if (sug) {
      await page.click('.zespol-sugestia .zespol-uruchom');
      await spij(300);
      await page.waitForFunction(() => !isGenerating, null, { timeout: 30000 });
      await spij(800);
      const po7 = await licznik();
      const s7 = await stopka();
      const k7 = await koniec();
      const m7 = await page.evaluate(() => activeConversation.messages.filter((m) => m.role === 'assistant' && !m.status).map((m) => ({ p: (m.poprzednie || []).map((x) => x.powod), k: m.kosztZl })));
      ok(m7.length === 1 && m7[0].p.includes('bez-zespolu') && k7.poprzednie.some((x) => x.tytul === 'Odpowiedź bez zespołu'),
        `G7b. jedno pytanie, jedna odpowiedź – solo zwinięte nad nią jako „Odpowiedź bez zespołu” (${JSON.stringify(m7)})`);
      ok(/w tym zastąpiona odpowiedź: \d/.test(s7.replace(/\u00a0/g, ' ')) && Math.abs(kwotaZ(s7) - (po7 - przed7)) <= 0.011,
        `G7c. „cała odpowiedź” z kosztem zastąpionej odpowiedzi = przyrost licznika od pytania solo (stopka „${s7}”, licznik +${(po7 - przed7).toFixed(4)} zł)`);
    }

    // ---------------------------------------------------------------- G12
    {
      /* P3: czytnik ekranu – region rozmowy `aria-busy` przez turę, na końcu jedno
         zdanie w role=status; fokus klawiatury przeżywa przebudowy i koniec tury. */
      await nowaRozmowa();
      await tura(page, 'Cześć');
      await page.focus('#messages .msg-assistant .msg-actions .msg-action-btn');
      const przed12 = await page.evaluate(() => document.activeElement.closest('[data-idx]')?.dataset.idx);
      await page.evaluate(() => { el.input.value = 'scena-przepis Plan na Sycylię z nastawami aparatu.'; sendMessage(); });
      const probki = [];
      for (let i = 0; i < 300; i++) {
        const p12 = await page.evaluate(() => ({ busy: document.getElementById('messages').getAttribute('aria-busy'), gen: isGenerating,
          fokus: document.activeElement === document.body ? 'body' : document.activeElement.id || document.activeElement.className,
          idx: document.activeElement.closest('[data-idx]')?.dataset.idx }));
        probki.push(p12);
        if (!p12.gen && i > 5) break;
        await spij(80);
      }
      await spij(300);
      const koniec12 = await page.evaluate(() => ({ busy: document.getElementById('messages').getAttribute('aria-busy'), sr: (document.getElementById('sr-odpowiedz') || {}).textContent || '',
        fokus: document.activeElement.className, idx: document.activeElement.closest('[data-idx]')?.dataset.idx }));
      const wTurze = probki.filter((x) => x.gen);
      ok(wTurze.length > 3 && wTurze.every((x) => x.busy === 'true') && koniec12.busy === null && koniec12.sr === 'Odpowiedź gotowa.',
        `G12a. #messages aria-busy przez całą turę (${wTurze.length} próbek), po niej zdjęte; jedno zdanie statusu „${koniec12.sr}”`);
      ok([...wTurze, koniec12].every((x) => x.idx === przed12 && /msg-action-btn/.test(x.fokus)),
        `G12b. fokus zostaje na „Kopiuj” poprzedniej odpowiedzi przez przebudowy i po końcu tury (${JSON.stringify([...new Set([...wTurze, koniec12].map((x) => `${x.idx}:${String(x.fokus).slice(0, 30)}`))])})`);
    }

    // ---------------------------------------------------------------- G13
    {
      /* Skurczenie treści przy dole (zwinięty blok zespołu) nie wyłącza jazdy na
         dole – kolejna porcja odpowiedzi dalej jest widoczna. */
      const z13 = await page.evaluate(async () => {
        const kl = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 60)));
        const blok = document.createElement('div');
        blok.style.height = '900px';
        el.messages.appendChild(blok);
        scrollToBottom(true);
        await kl();
        blok.style.height = '300px';           // blok zespołu się zwija
        await kl(); await kl();
        const poZwinieciu = sledzeDol;
        blok.style.height = '1500px';          // odpowiedź rośnie
        scrollToBottom();
        await kl();
        const sc = el.chatScroll;
        const odDolu = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
        blok.remove();
        return { poZwinieciu, odDolu };
      });
      ok(z13.poZwinieciu === true && z13.odDolu < 5, `G13. zwinięcie treści przy dole nie wyłącza śledzenia dołu (${JSON.stringify(z13)})`);
    }

    // ---------------------------------------------------------------- G9, G10
    {
      /* G9. K7: iOS nie zmniejsza okna przy klawiaturze – mówi o niej tylko
         visualViewport. Podstawiony visualViewport (wysokość jak przy klawiaturze). */
      const c9 = await b.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
      await c9.addInitScript(() => {
        const vv = new EventTarget();
        vv.height = window.innerHeight || 800; vv.width = 390; vv.scale = 1; vv.offsetTop = 0; vv.offsetLeft = 0; vv.pageTop = 0; vv.pageLeft = 0;
        Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
        window.__vv = vv;
      });
      const p9 = await c9.newPage();
      await p9.goto(`${ADRES}/app`, { waitUntil: 'load' });
      await p9.waitForSelector('.app.gotowa', { timeout: 15000 }).catch(() => {});
      const klasa = () => p9.evaluate(() => document.documentElement.classList.contains('klawiatura'));
      const przed9 = await klasa();
      await p9.evaluate(() => { window.__vv.height = 420; window.__vv.dispatchEvent(new Event('resize')); });
      const z9 = await klasa();
      await p9.evaluate(() => { window.__vv.height = window.innerHeight; window.__vv.dispatchEvent(new Event('resize')); });
      const po9 = await klasa();
      ok(!przed9 && z9 && !po9, `G9. html.klawiatura z visualViewport: bez ${przed9}, z klawiaturą ${z9}, po schowaniu ${po9}`);
      /* G10. Wpisany tekst wygrywa: dotknięcie podpowiedzi nie nadpisuje go i nie wysyła. */
      await p9.fill('#input', 'moje własne pytanie');
      await p9.evaluate(() => document.querySelector('.suggestion').click());
      await spij(300);
      const z10 = await p9.evaluate(() => ({ pole: document.getElementById('input').value, wiad: (activeConversation ? activeConversation.messages.length : 0) }));
      ok(z10.pole === 'moje własne pytanie' && z10.wiad === 0, `G10. dotknięcie podpowiedzi przy wpisanym tekście nic nie nadpisuje i nie wysyła (${JSON.stringify(z10)})`);
      /* G11. Plan jako tabela (K5): pasek zdjęć sekcji staje POD tabelą, nie nad nią. */
      const z11 = await p9.evaluate(() => {
        const body = document.createElement('div');
        body.className = 'msg-content md';
        body.innerHTML = renderMarkdown('**Plan**\n\n| Dzień | Miejsce | Plan | Nastawy |\n|---|---|---|---|\n| 1 | Etna | spacer | f/8 |\n\nUwagi pod tabelą.\n\n### Dzień 2\nTaormina.');
        document.body.appendChild(body);
        const foto = { thumb: '/icons/icon-192.png', full: '/icons/icon-192.png', title: 'x', url: 'https://przyklad.pl' };
        wstawPaski(body, { zdjecia: [{ q: 'Etna', etykieta: 'Etna', po: 10, sekcja: 0, photos: [foto], stan: 'gotowe' },
          { q: 'Taormina', etykieta: 'Taormina', po: 200, sekcja: 1, photos: [foto], stan: 'gotowe' }] });
        const dzieci = [...body.children].map((e) => (e.classList.contains('zdj-pasek') ? 'PASEK' : e.tagName));
        body.remove();
        return dzieci.join(',');
      });
      ok(/^P,TABLE,PASEK,P,H3,PASEK/.test(z11), `G11. pasek sekcji z tabelą stoi pod tabelą, w sekcji bez tabeli – pod nagłówkiem (${z11})`);
      await c9.close();
    }

    // ---------------------------------------------------------------- G14
    {
      /* Sieć znika na dłużej niż klient czeka (winda, tunel), JS działa dalej.
         Serwer dokańcza odpowiedź i zapisuje ją sam; po powrocie sieci pełna
         odpowiedź wygrywa z urywkiem i kartą błędu (K8) – także w pliku na serwerze.
         Dawniej zapis kopii z przeglądarki (urywek) nadpisywał pełną odpowiedź. */
      const c14 = await b.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' });
      await c14.addInitScript(() => { window.COSMOS_PRZERWA_BIEGU_MS = 2500; try { localStorage.setItem('cosmos.lang', 'pl'); } catch { /* */ } });
      const p14 = await c14.newPage();
      p14.on('pageerror', (e) => bledy.push(e.message));
      await p14.goto(`http://127.0.0.1:${POSREDNIK}/app`, { waitUntil: 'load' });
      await p14.waitForSelector('.app.gotowa', { timeout: 15000 }).catch(() => {});
      await p14.fill('#input', 'scena-wolny Opowiedz powoli.');
      await p14.press('#input', 'Enter');
      await p14.waitForFunction(() => (document.querySelector('#messages .msg.nowa .strumien-tresc') || {}).textContent?.length > 200, null, { timeout: 15000 }).catch(() => {});
      odetnijSiec(true);
      await p14.waitForFunction(() => !isGenerating, null, { timeout: 30000 }).catch(() => {});
      const wTrakcie = await p14.evaluate(() => ({ bledy: activeConversation.messages.filter((m) => m.error).map((m) => ({ bieg: Boolean(m.bieg), t: String(m.content).slice(0, 60) })),
        urywek: activeConversation.messages.filter((m) => m.role === 'assistant' && !m.error).map((m) => ({ bieg: Boolean(m.bieg), n: String(m.content).length })),
        biegZapamietany: Boolean(localStorage.getItem('cosmos.bieg')), id: activeConversation.id }));
      ok(wTrakcie.bledy.length === 1 && wTrakcie.bledy[0].bieg && /wrócę po nią/.test(wTrakcie.bledy[0].t) && wTrakcie.urywek.every((u) => u.bieg) && wTrakcie.biegZapamietany,
        `G14a. bez sieci dłużej niż czeka klient: urywek i błąd niosą bieg (K8), bieg zapamiętany, komunikat „wrócę po nią” (${JSON.stringify(wTrakcie)})`);
      await spij(12000);                   // serwer kończy (~8 s) i po 1,5 s zapisuje odpowiedź sam
      odetnijSiec(false);
      await p14.evaluate(() => window.dispatchEvent(new Event('online')));
      await p14.waitForFunction(() => !activeConversation.messages.some((m) => m.error) && !isGenerating, null, { timeout: 15000 }).catch(() => {});
      await spij(1500);
      const po = await p14.evaluate(async (id) => {
        const naEkranie = activeConversation.messages.filter((m) => m.role === 'assistant').map((m) => ({ e: Boolean(m.error), n: String(m.content).length, k: /KONIEC-ODPOWIEDZI/.test(m.content) }));
        const zSerwera = await (await fetch(`/api/conversations?id=${encodeURIComponent(id)}`)).json();
        return { naEkranie, serwer: zSerwera.messages.filter((m) => m.role === 'assistant').map((m) => ({ e: Boolean(m.error), k: /KONIEC-ODPOWIEDZI/.test(m.content) })) };
      }, wTrakcie.id);
      ok(po.naEkranie.length === 1 && po.naEkranie[0].k && !po.naEkranie[0].e && po.serwer.length === 1 && po.serwer[0].k && !po.serwer[0].e,
        `G14b. po powrocie sieci pełna odpowiedź na ekranie i w pliku na serwerze, bez urywka i błędu (${JSON.stringify(po)})`);
      await c14.close();
    }

    ok(!bledy.length, `brak błędów JS (${bledy.slice(0, 3).join(' | ')})`);
  } catch (e) {
    w.zapisz(`wyjątek: ${e.stack || e.message}`);
  } finally {
    await b.close();
    atrapa.close();
    posrednik.close();
  }
  w.zakoncz();
})();

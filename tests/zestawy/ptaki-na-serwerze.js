/* Ptaki na serwerze – rozpoznawanie bez komputera w domu.

   Marcin: „rozpoznawanie ptaków powinno działać bez komputera stacjonarnego
   i lokalnego GPU. Masz telefon w lesie i chcesz, żeby wyszukał, jaki to
   ptak, nie myśląc o tym, czy komputer w domu jest włączony”. Dziś dostawał
   „działa na komputerze domowym, a ten teraz nie odpowiada”.

   Prawdziwy serwer Cosmosa w trybie z kontami; komputer domowy (SENSES_URL)
   martwy; usługę ptaków na serwerze (PTAKI_URL) udaje atrapa w tym procesie,
   która odsyła skrót nagrania – dzięki temu widać, czy ktoś nie dostał
   cudzego wyniku:
     1. ptak działa bez domu: 200, polska nazwa, /api/status mówi „ptaki są”,
     2. biała lista: /api/detect nie trafia na serwer (tylko /ptak),
     3. kolejka: jedna analiza naraz, trzy czekają, reszta od razu 503 –
        i każda osoba dostaje SWÓJ wynik,
     4. ta sama osoba dwa nagrania naraz → drugie 429,
     5. członek bez przyznania „Ptaki na serwerze” → 403, z przyznaniem → 200,
     6. błąd usługi ze ścieżką z dysku (C:\Users\Marcin…) – członek dostaje
        ogólne zdanie, bez ścieżki i bez adresu,
     7. usługa padła → członek dostaje 503 w < 2 s, bez adresu,
     8. nagranie większe niż 4 MB → 413 bez czytania,
     9. współrzędne idą do usługi zaokrąglone do 0,1°, w nagłówkach, nie w adresie,
    10. usługa w rozgrzewce (birdnet_gotowy:false) → 503 „ptaki-chwilowo” z Retry-After,
        nie 403 „na Twoim koncie”; gotowość widać najpóźniej ~4 s po rozgrzewce, nie po 30,
    11. zerwane nagranie trzyma miejsce, dopóki usługa liczy: 10 × wyślij-i-zerwij
        → usługa nigdy nie liczy więcej niż PTAKI_NARAZ naraz, drugie nagranie tej
        osoby 429, a nagranie innej osoby dochodzi,
    12. 30 nagrań jednej osoby naraz → do usługi dociera jedno (reszta 429 bez czytania).
*/
const http = require('node:http');
const crypto = require('node:crypto');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

const PORT = 3543;
const PORT_PTAKOW = 7476;
const ADRES = `http://127.0.0.1:${PORT}`;
const HASLO = 'haslo-wlasciciela-ptaki';

const wywolania = [];
let tryb = 'ok';
let niegotowyDo = 0;           // do tej chwili /health mówi „rozgrzewka”
let liczyNaraz = 0;
let liczyMaks = 0;
const atrapa = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const cialo = [];
  req.on('data', (c) => cialo.push(c));
  req.on('end', () => {
    const json = (kod, d) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (u.pathname === '/health') return json(200, { birdnet: true, birdnet_gotowy: Date.now() >= niegotowyDo });
    wywolania.push({ sciezka: u.pathname, q: u.searchParams, lat: req.headers['x-cosmos-lat'], lon: req.headers['x-cosmos-lon'] });
    if (u.pathname !== '/ptak') return json(404, { error: 'tylko ptaki' });
    if (tryb === 'blad') {
      return json(500, { error: "Error opening 'C:\\Users\\Marcin\\AppData\\Local\\Temp\\tmpk3x9.wav': Format not recognised." });
    }
    const skrot = crypto.createHash('sha1').update(Buffer.concat(cialo)).digest('hex');
    liczyNaraz++; liczyMaks = Math.max(liczyMaks, liczyNaraz);
    setTimeout(() => { liczyNaraz--; json(200, {
      gatunki: [{ nazwa: 'puszczyk', nazwaEn: 'Tawny Owl', lacinska: 'Strix aluco', pewnosc: 0.97 }],
      wykryc: 1, zMiejscem: Boolean(req.headers['x-cosmos-lat']), skrot,
    }); }, tryb === 'wolno' ? 600 : tryb === 'wolno2' ? 2000 : 5);
  });
});

function klient(ip) {
  let ciastko = '';
  return {
    async zadaj(sciezka, { metoda = 'GET', dane, surowe, typ } = {}) {
      const r = await fetch(`${ADRES}${sciezka}`, {
        method: metoda,
        headers: {
          'Content-Type': typ || 'application/json', 'CF-Connecting-IP': ip,
          ...(ciastko ? { Cookie: ciastko } : {}),
        },
        body: surowe !== undefined ? surowe : (dane === undefined ? undefined : JSON.stringify(dane)),
      });
      const sc = r.headers.get('set-cookie');
      // (ciastko() niżej – dla zapytań, które test wysyła sam, z własnym sygnałem)
      if (sc) ciastko = sc.split(';')[0];
      const tekst = await r.text();
      let json = {};
      try { json = JSON.parse(tekst); } catch { /* tekst */ }
      return { kod: r.status, json, tekst };
    },
    ciastko: () => ciastko,
  };
}
const nagranie = (znak) => Buffer.from(`RIFF-atrapa-wav-${znak}`.repeat(200));
const ptak = (k, znak) => k.zadaj('/api/ptak', { metoda: 'POST', surowe: nagranie(znak), typ: 'audio/wav' });

(async () => {
  await new Promise((r) => atrapa.listen(PORT_PTAKOW, '127.0.0.1', r));
  niegotowyDo = Date.now() + 6000;
  const startSerwera = Date.now();
  const srv = serwerCosmosa(PORT, {
    COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin',
    SENSES_URL: 'http://127.0.0.1:1',            // dom wyłączony
    PTAKI_URL: `http://127.0.0.1:${PORT_PTAKOW}`,
    PTAKI_NARAZ: '1', PTAKI_KOLEJKA: '3',
  });
  try {
    if (!(await czekajNa(`${ADRES}/api/auth`))) throw new Error('serwer nie wstał');
    const marcin = klient('10.9.0.1');
    await marcin.zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
    await marcin.zadaj('/api/location', { metoda: 'POST', dane: { location: 'Biebrza', lat: 53.4567, lon: 22.6789 } });

    /* ---- 10. Rozgrzewka: chwilowo, nie „na Twoim koncie” ---- */
    const r10 = await fetch(`${ADRES}/api/ptak`, { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'CF-Connecting-IP': '10.9.0.1', Cookie: marcin.ciastko() }, body: nagranie('rozgrzewka') });
    const j10 = await r10.json().catch(() => ({}));
    ok(r10.status === 503 && j10.kod === 'ptaki-chwilowo' && Number(r10.headers.get('retry-after')) > 0,
      `10. usługa w rozgrzewce → ${r10.status} ${j10.kod}, Retry-After ${r10.headers.get('retry-after')}`);
    let gotowePo = -1;
    for (let i = 0; i < 60; i++) {
      const s10 = (await marcin.zadaj('/api/status')).json;
      if (s10.ptaki && s10.ptaki.ok) { gotowePo = Date.now() - startSerwera; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    ok(gotowePo > 0 && gotowePo < 12500, `10. gotowość widać ${gotowePo} ms od startu (rozgrzewka 6 s, sprawdzanie co 4 s, nie co 30)`);

    /* ---- 1. Bez domu ---- */
    const r1 = await ptak(marcin, 'w1');
    const st = (await marcin.zadaj('/api/status')).json;
    ok(r1.kod === 200 && (r1.json.gatunki || [])[0]?.nazwa === 'puszczyk', `1. ptak bez domu: ${r1.kod}, ${(r1.json.gatunki || [])[0]?.nazwa || r1.tekst.slice(0, 80)}`);
    ok(st.ptaki && st.ptaki.ok === true && !JSON.stringify(st.ptaki).includes('127.0.0.1'), `1. /api/status: ptaki dostępne, bez adresu (${JSON.stringify(st.ptaki)})`);

    /* ---- 9. Współrzędne zaokrąglone ---- */
    const ostatni = wywolania.filter((w) => w.sciezka === '/ptak').pop();
    ok(ostatni && ostatni.lat === '53.5' && ostatni.lon === '22.7', `9. współrzędne do 0,1° (${ostatni && `${ostatni.lat},${ostatni.lon}`})`);
    ok(ostatni && !ostatni.q.has('lat') && !ostatni.q.has('lon'), `9. współrzędnych nie ma w adresie (${ostatni && ostatni.q.toString()})`);

    /* ---- 2. Biała lista ---- */
    wywolania.length = 0;
    await marcin.zadaj('/api/detect', { metoda: 'POST', dane: { image: 'data:image/jpeg;base64,AAAA' } });
    ok(!wywolania.some((w) => w.sciezka !== '/ptak'), `2. /api/detect nie trafia na serwer (${wywolania.map((w) => w.sciezka).join(',') || 'brak wywołań'})`);

    /* ---- członkowie ---- */
    const czlonkowie = [];
    for (let i = 0; i < 8; i++) {
      const zap = await marcin.zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: `Osoba ${i}` } });
      const k = klient(`10.9.1.${i + 2}`);
      const przyj = await k.zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token: zap.json.token, login: `osoba${i}`, haslo: `haslo-osoby-${i}-12345` } });
      if (przyj.kod !== 200) throw new Error(`członek ${i}: ${przyj.tekst}`);
      czlonkowie.push({ k, id: przyj.json.uzytkownik.id });
    }

    /* ---- 5. Przyznanie ---- */
    const bez = await ptak(czlonkowie[0].k, 'bez');
    const stBez = (await czlonkowie[0].k.zadaj('/api/status')).json;
    ok(bez.kod === 403 && bez.json.kod === 'ptaki-niedostepne' && !/komputer|GPU/i.test(bez.json.error || ''), `5. członek bez przyznania: ${bez.kod} „${bez.json.error}”`);
    ok(stBez.ptaki && stBez.ptaki.ok === false, '5. /api/status członka bez przyznania: ptaków nie ma');
    for (const c of czlonkowie) await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: c.id, silniki: { ptaki: true } } });
    const zPrzyznaniem = await ptak(czlonkowie[0].k, 'z');
    ok(zPrzyznaniem.kod === 200, `5. z przyznaniem: ${zPrzyznaniem.kod}`);

    /* ---- 3. Kolejka ---- */
    tryb = 'wolno';
    const start = Date.now();
    const wyniki = await Promise.all(czlonkowie.map((c, i) => ptak(c.k, `osoba-${i}`).then((r) => ({ r, i, ms: Date.now() - start }))));
    const udane = wyniki.filter((w) => w.r.kod === 200);
    const odmowy = wyniki.filter((w) => w.r.kod === 503 && w.r.json.kod === 'kolejka-pelna');
    const swoje = udane.every((w) => w.r.json.skrot === crypto.createHash('sha1').update(nagranie(`osoba-${w.i}`)).digest('hex'));
    ok(udane.length === 4 && odmowy.length === 4, `3. 8 osób naraz przy 1 analizie + 3 w kolejce: ${udane.length}×200, ${odmowy.length}×503`);
    ok(swoje, '3. każda osoba dostała wynik SWOJEGO nagrania');
    ok(odmowy.every((w) => w.ms < 1500), `3. odmowa od razu, nie po czekaniu (${odmowy.map((w) => w.ms).join(', ')} ms)`);

    /* ---- 4. Ta sama osoba dwa razy ---- */
    const [a, b] = await Promise.all([ptak(czlonkowie[1].k, 'raz'), ptak(czlonkowie[1].k, 'dwa')]);
    ok([a.kod, b.kod].sort().join(',') === '200,429', `4. ta sama osoba dwa nagrania naraz: ${a.kod}, ${b.kod}`);
    tryb = 'ok';

    /* ---- 11. Zerwane nagranie trzyma miejsce, dopóki usługa liczy ---- */
    tryb = 'wolno2';
    liczyMaks = 0;
    const wyslijIZerwij = (c, znak) => {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), 100);
      return fetch(`${ADRES}/api/ptak`, { method: 'POST', signal: ac.signal,
        headers: { 'Content-Type': 'audio/wav', Cookie: c.k.ciastko() }, body: nagranie(znak) }).catch(() => null);
    };
    const przed11 = wywolania.length;
    for (let i = 0; i < 10; i++) await wyslijIZerwij(czlonkowie[5], `zerw-${i}`);
    const drugie = await ptak(czlonkowie[5].k, 'zerw-drugie');
    const innej = await ptak(czlonkowie[6].k, 'innej');
    ok(liczyMaks <= 1, `11. 10 × wyślij-i-zerwij: usługa liczyła naraz najwyżej ${liczyMaks} (PTAKI_NARAZ=1), zleceń ${wywolania.length - przed11}`);
    ok(drugie.kod === 429, `11. ta sama osoba w trakcie zerwanego nagrania → ${drugie.kod}`);
    ok(innej.kod === 200, `11. nagranie innej osoby dochodzi → ${innej.kod}`);
    await new Promise((r) => setTimeout(r, 2200));

    /* ---- 12. 30 nagrań jednej osoby naraz ---- */
    tryb = 'wolno';
    const przed12 = wywolania.length;
    const trzydziesci = await Promise.all(Array.from({ length: 30 }, (_, i) => ptak(czlonkowie[7].k, `rownolegle-${i}`)));
    const k12 = trzydziesci.map((w) => w.kod);
    ok(wywolania.length - przed12 === 1 && k12.filter((k) => k === 200).length === 1 && k12.filter((k) => k === 429).length === 29,
      `12. 30 naraz jednej osoby → do usługi ${wywolania.length - przed12}, 200×${k12.filter((k) => k === 200).length}, 429×${k12.filter((k) => k === 429).length}`);
    tryb = 'ok';

    /* ---- 6. Błąd ze ścieżką ---- */
    tryb = 'blad';
    const bl = await ptak(czlonkowie[2].k, 'blad');
    ok(bl.kod >= 400 && !/C:\\\\Users|Marcin|AppData|127\.0\.0\.1/.test(bl.tekst), `6. członek nie widzi ścieżki z dysku (${bl.kod}: ${bl.tekst.slice(0, 90)})`);
    tryb = 'ok';

    /* ---- 8. Za duże nagranie ---- */
    const duze = await czlonkowie[3].k.zadaj('/api/ptak', { metoda: 'POST', surowe: Buffer.alloc(5 * 1024 * 1024), typ: 'audio/wav' });
    ok(duze.kod === 413, `8. nagranie 5 MB → ${duze.kod}`);

    /* ---- 7. Usługa padła ---- */
    await new Promise((r) => atrapa.close(r));
    atrapa.closeAllConnections?.();
    const t0 = Date.now();
    const pad = await ptak(czlonkowie[4].k, 'pad');
    const ms = Date.now() - t0;
    ok([502, 503].includes(pad.kod) && ms < 2000 && !/127\.0\.0\.1|localhost|:7476/.test(pad.tekst), `7. usługa padła: ${pad.kod} po ${ms} ms, bez adresu („${pad.json.error}”)`);
    // Członek z przyznaniem przy leżącej usłudze: dalej „chwilowo” (503), nie „na Twoim koncie” (403).
    const pad2 = await ptak(czlonkowie[4].k, 'pad2');
    ok(pad2.kod === 503 && pad2.json.kod === 'ptaki-chwilowo', `7. druga próba przy leżącej usłudze: ${pad2.kod} ${pad2.json.kod}`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    zabij(srv);
    try { atrapa.close(); } catch { /* już zamknięta */ }
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nPTAKI NA SERWERZE OK');
  process.exit(fail.length ? 1 : 0);
})();

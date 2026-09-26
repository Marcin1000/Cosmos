/* Izolacja osób – czy zaproszony gość widzi wyłącznie swoje.

   Cosmos przez dwa lata był jednoosobowy: jeden katalog danych, jedna lista
   zdarzeń, wykonywanie kodu włączone domyślnie. Gdyby wpuścić gościa na
   takim kodzie, zobaczyłby profil właściciela z jego adresem, jego rozmowy,
   obraz z jego kamery w swoim kontekście – i mógłby uruchomić program na
   serwerze, obok pliku ze wszystkimi kluczami.

   Zestaw stawia serwer z hasłem, zakłada właściciela i członka przez
   prawdziwe zaproszenie, a potem sprawdza z obu stron:
     1. dane właściciela są dla członka NIEWIDOCZNE – każdą drogą, którą
        da się je odczytać (profil, lokalizacja, sprzęt, rozmowy, wyszukiwanie
        w rozmowach, kopia zapasowa, statystyki),
     2. zapis członka nie nadpisuje danych właściciela,
     3. zdarzenia (kamera, mikrofon, czujniki) trafiają tylko do właściciela
        zdarzenia – strumień SSE drugiej osoby milczy,
     4. trasy działające na serwerze albo w domu właściciela zwracają członkowi
        403, a model członka nie dostaje nawet opisu narzędzia „uruchom kod",
     5. silniki: bez przyznania i bez klucza – odmowa z wyjaśnieniem, a tam,
        gdzie strażnik podmienia silnik, zapytanie idzie kluczem NVIDIA,
        nigdy płatnym kluczem właściciela; własny klucz członka płaci za
        członka; przyznanie przez właściciela – płaci właściciel,
     6. cudzego biegu (odpowiedzi w tle) nie da się podejrzeć,
     7. właściciel widzi zużycie członka, ale nie jego treści.

   Atrapa modelu zapamiętuje nagłówek Authorization każdego zapytania –
   dzięki temu widać nie „czy odpowiedziało", tylko CZYIM kluczem.
*/
const http = require('node:http');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3481;
const PORT_MODELU = 3482;
const ADRES = `http://127.0.0.1:${PORT}`;
const HASLO = 'haslo-wlasciciela-2026';
const KLUCZ_NVIDIA = 'klucz-nvidia-wspolny-0001';
const KLUCZ_OPENAI_WLASCICIELA = 'sk-wlasciciela-platny-000000000001';
const KLUCZ_OPENAI_CZLONKA = 'sk-czlonka-wlasny-00000000000000042';

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

// --- atrapa modelu: zapamiętuje klucz i instrukcje ---------------------------
const zapytania = [];
const atrapa = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [] }));
    }
    let d = {};
    try { d = JSON.parse(body); } catch { /* */ }
    zapytania.push({
      klucz: (req.headers.authorization || '').replace(/^Bearer /, ''),
      systemowe: (d.messages || []).filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n'),
    });
    if (d.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'odpowiedź' } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'gotowe' } }] }));
    }
  });
});

function klient(ip) {
  let ciastko = '';
  return {
    async zadaj(sciezka, { metoda = 'GET', dane } = {}) {
      const r = await fetch(`${ADRES}${sciezka}`, {
        method: metoda,
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(ciastko ? { Cookie: ciastko } : {}) },
        body: dane === undefined ? undefined : JSON.stringify(dane),
      });
      const sc = r.headers.get('set-cookie');
      if (sc) ciastko = sc.split(';')[0];
      const tekst = await r.text();
      let json = {};
      try { json = JSON.parse(tekst); } catch { /* strumień albo tekst */ }
      return { kod: r.status, json, tekst };
    },
    /** Otwórz strumień zdarzeń i zbieraj ramki przez `ms`. */
    async sluchaj(ms) {
      const ctrl = new AbortController();
      const ramki = [];
      const r = await fetch(`${ADRES}/api/events/stream`, { headers: { Cookie: ciastko }, signal: ctrl.signal });
      const czytnik = r.body.getReader();
      const dekoder = new TextDecoder();
      const koniec = setTimeout(() => ctrl.abort(), ms);
      (async () => {
        try {
          for (;;) {
            const { value, done } = await czytnik.read();
            if (done) break;
            ramki.push(dekoder.decode(value));
          }
        } catch { /* przerwane – tak ma być */ }
      })();
      return { ramki, gotowe: new Promise((r2) => setTimeout(() => { clearTimeout(koniec); r2(ramki.join('')); }, ms + 100)) };
    },
  };
}

(async () => {
  await new Promise((r) => atrapa.listen(PORT_MODELU, '127.0.0.1', r));
  const srv = serwerCosmosa(PORT, {
    COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin',
    NVIDIA_API_KEY: KLUCZ_NVIDIA,
    NEMOTRON_BASE_URL: `http://127.0.0.1:${PORT_MODELU}/v1`,
    NEMOTRON_MODEL: 'atrapa-nvidia',
    OPENAI_API_KEY: KLUCZ_OPENAI_WLASCICIELA,
    OPENAI_BASE_URL: `http://127.0.0.1:${PORT_MODELU}/v1`,
    OPENAI_MODEL: 'atrapa-openai',
  });
  if (!(await czekajNa(`${ADRES}/api/auth`))) throw new Error('serwer nie wstał');

  const marcin = klient('10.1.0.1');
  await marcin.zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
  const zap = await marcin.zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: 'Ania' } });
  const ania = klient('10.1.0.2');
  const przyj = await ania.zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token: zap.json.token, login: 'ania', haslo: 'haslo-ani-12345' } });
  if (przyj.kod !== 200) throw new Error(`nie udało się założyć konta członka: ${przyj.tekst}`);
  const idAni = przyj.json.uzytkownik.id;

  // --- 1. Właściciel zostawia ślady w każdym miejscu ---------------------------
  await marcin.zadaj('/api/profile', { metoda: 'POST', dane: { profile: 'SEKRET-PROFIL-W: mieszkam przy ulicy Tajnej 7' } });
  await marcin.zadaj('/api/location', { metoda: 'POST', dane: { location: 'SEKRET-MIEJSCOWOSC', lat: 52.1, lon: 20.8 } });
  await marcin.zadaj('/api/gear', { metoda: 'PUT', dane: { korpus: 'SEKRET-KORPUS', obiektywy: '24-105 f/4' } });
  await marcin.zadaj('/api/conversations?id=sekret1', { metoda: 'PUT',
    dane: { title: 'SEKRET-TYTUL', messages: [{ role: 'user', content: 'SEKRET-ROZMOWA-W' }] } });

  const widzi = async (sciezka) => (await ania.zadaj(sciezka)).tekst;
  const drogi = {
    profil: '/api/profile', lokalizacja: '/api/location', sprzęt: '/api/gear',
    'lista rozmów': '/api/conversations', 'wyszukiwanie w rozmowach': '/api/conversations/search?q=SEKRET',
    'rozmowa po identyfikatorze': '/api/conversations?id=sekret1',
    'kopia zapasowa': '/api/backup', statystyki: '/api/admin/stats',
  };
  for (const [opis, sciezka] of Object.entries(drogi)) {
    const t = await widzi(sciezka);
    ok(!/SEKRET/.test(t), `członek NIE widzi danych właściciela: ${opis}`);
  }
  const lok = (await ania.zadaj('/api/location')).json;
  ok(!lok.wspolrzedne, 'członek nie dostaje współrzędnych domu właściciela');
  const staty = (await ania.zadaj('/api/admin/stats')).json;
  ok(staty.conversations === 0, `statystyki członka liczą JEGO rozmowy (${staty.conversations}), nie właściciela`);

  // --- 2. Zapis członka nie rusza właściciela ---------------------------------
  await ania.zadaj('/api/profile', { metoda: 'POST', dane: { profile: 'Profil Ani' } });
  await ania.zadaj('/api/conversations?id=sekret1', { metoda: 'PUT', dane: { title: 'Ania nadpisuje', messages: [] } });
  const profilW = (await marcin.zadaj('/api/profile')).json.profile;
  ok(/SEKRET-PROFIL-W/.test(profilW), 'zapis profilu przez członka nie nadpisał profilu właściciela');
  const rozmW = (await marcin.zadaj('/api/conversations?id=sekret1')).tekst;
  ok(/SEKRET-ROZMOWA-W/.test(rozmW), 'rozmowa o tym samym identyfikatorze u członka nie nadpisała rozmowy właściciela');
  ok((await ania.zadaj('/api/profile')).json.profile === 'Profil Ani', 'członek widzi swój profil');

  // --- 3. Zdarzenia tylko dla ich właściciela -----------------------------------
  const sluchAni = await ania.sluchaj(1500);
  const sluchW = await marcin.sluchaj(1500);
  await new Promise((r) => setTimeout(r, 300));
  await marcin.zadaj('/api/events', { metoda: 'POST', dane: { type: 'kamera', summary: 'SEKRET-KAMERA: ktoś w salonie' } });
  const [ramkiAni, ramkiW] = await Promise.all([sluchAni.gotowe, sluchW.gotowe]);
  ok(/SEKRET-KAMERA/.test(ramkiW), 'zdarzenie z kamery dociera do strumienia właściciela');
  ok(!/SEKRET-KAMERA/.test(ramkiAni), 'zdarzenie z kamery właściciela NIE dociera do strumienia członka');

  // --- 4. Trasy tylko dla właściciela -----------------------------------------
  const zakazane = [
    ['POST', '/api/run', { code: 'print(1)' }], ['GET', '/api/konta'], ['GET', '/api/kinect/status'],
    ['GET', '/api/devices'], ['GET', '/api/train/stats'], ['POST', '/api/models/check', {}],
    ['POST', '/api/procedures/run-readonly', {}], ['GET', '/api/canon/status'], ['GET', '/api/briefing'],
  ];
  for (const [m, s, d] of zakazane) {
    const r = await ania.zadaj(s, { metoda: m, dane: d });
    ok(r.kod === 403, `członek: ${m} ${s} → ${r.kod} (ma być 403)`);
  }
  ok((await marcin.zadaj('/api/konta')).kod === 200, 'właściciel ma dostęp do /api/konta');
  const studio = await ania.zadaj('/api/studio/tasks');
  ok(studio.kod === 403, `Studio bez przyznania → ${studio.kod}`);

  // Instrukcja „uruchom kod" – właściciel ją dostaje, członek nie.
  zapytania.length = 0;
  await marcin.zadaj('/api/chat', { metoda: 'POST', dane: { endpoint: 'cloud', messages: [{ role: 'user', content: 'policz średnią 1 2 3' }] } });
  const sysW = (zapytania.find((z) => z.systemowe) || {}).systemowe || '';
  zapytania.length = 0;
  await ania.zadaj('/api/chat', { metoda: 'POST', dane: { endpoint: 'cloud', messages: [{ role: 'user', content: 'policz średnią 1 2 3' }] } });
  const sysA = (zapytania.find((z) => z.systemowe) || {}).systemowe || '';
  ok(/LICZENIE NA DANYCH/.test(sysW), 'model właściciela dostaje narzędzie „licz na danych" (wykonywanie kodu)');
  ok(sysA.length > 0 && !/LICZENIE NA DANYCH/.test(sysA), 'model członka NIE dostaje narzędzia wykonywania kodu');
  ok(!/SEKRET/.test(sysA), 'instrukcje systemowe członka nie zawierają profilu ani lokalizacji właściciela');
  ok(/Profil Ani/.test(sysA), 'instrukcje systemowe członka zawierają JEGO profil');

  // --- 5. Silniki i klucze --------------------------------------------------------
  const cfgA = (await ania.zadaj('/api/config')).json;
  ok(Object.keys(cfgA.endpoints || {}).join(',') === 'cloud', `członek widzi tylko chmurę NVIDIA (${Object.keys(cfgA.endpoints || {})})`);

  const czat = await ania.zadaj('/api/chat', { metoda: 'POST', dane: { endpoint: 'openai', messages: [{ role: 'user', content: 'hej' }] } });
  ok(czat.kod === 403 && czat.json.kod === 'silnik-niedostepny' && /własny klucz/.test(czat.json.error || ''),
    'czat członka z OpenAI bez przyznania → 403 z podpowiedzią o własnym kluczu');

  const polish = async (kto) => {
    zapytania.length = 0;
    await kto.zadaj('/api/polish', { metoda: 'POST', dane: { text: 'popraw to', endpoint: 'openai' } });
    return (zapytania[0] || {}).klucz;
  };
  let klucz = await polish(ania);
  ok(klucz === KLUCZ_NVIDIA, `bez uprawnień strażnik kieruje do NVIDIA (klucz: ${klucz}), nie na płatny klucz właściciela`);

  const ust = await ania.zadaj('/api/konto/klucze', { metoda: 'PUT', dane: { nazwa: 'openai', klucz: KLUCZ_OPENAI_CZLONKA } });
  ok(ust.kod === 200 && ust.json.klucze.openai === '…0042', `własny klucz zapisany i oddany zamaskowany (${ust.json.klucze && ust.json.klucze.openai})`);
  ok(!(await ania.zadaj('/api/konto')).tekst.includes(KLUCZ_OPENAI_CZLONKA), 'pełny klucz nigdy nie wraca w odpowiedzi');
  const cfgA2 = (await ania.zadaj('/api/config')).json;
  ok(cfgA2.endpoints.openai && cfgA2.endpoints.openai.zrodlo === 'wlasny', 'z własnym kluczem zakładka OpenAI pojawia się jako „własny"');
  klucz = await polish(ania);
  ok(klucz === KLUCZ_OPENAI_CZLONKA, 'zapytanie członka z własnym kluczem idzie JEGO kluczem');

  await ania.zadaj('/api/konto/klucze', { metoda: 'PUT', dane: { nazwa: 'openai', klucz: '' } });
  await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: idAni, silniki: { openai: true } } });
  const cfgA3 = (await ania.zadaj('/api/config')).json;
  ok(cfgA3.endpoints.openai && cfgA3.endpoints.openai.zrodlo === 'przyznany', 'po przyznaniu zakładka OpenAI jest „przyznana"');
  klucz = await polish(ania);
  ok(klucz === KLUCZ_OPENAI_WLASCICIELA, 'po przyznaniu przez właściciela płaci właściciel');

  await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: idAni, silniki: { openai: false } } });
  klucz = await polish(ania);
  ok(klucz === KLUCZ_NVIDIA, 'po odebraniu uprawnienia – z powrotem NVIDIA, od następnego zapytania');

  // --- 6. Cudzy bieg ------------------------------------------------------------
  const BIEG = 'biegwlasciciela01';
  await marcin.zadaj('/api/chat', { metoda: 'POST', dane: { endpoint: 'cloud', bieg: BIEG, messages: [{ role: 'user', content: 'x' }] } });
  const podglad = await ania.zadaj(`/api/chat/bieg?id=${BIEG}&od=0`);
  ok(podglad.kod === 404, `członek nie podejrzy biegu właściciela → ${podglad.kod}`);
  const listaA = (await ania.zadaj('/api/chat/biegi')).json.biegi || [];
  ok(!listaA.some((b) => b.id === BIEG), 'lista biegów członka nie zawiera biegu właściciela');
  const listaW = (await marcin.zadaj('/api/chat/biegi')).json.biegi || [];
  ok(listaW.some((b) => b.id === BIEG), 'właściciel widzi swój bieg');

  // --- 7. Zużycie tak, treści nie ---------------------------------------------------
  const kontaW = await marcin.zadaj('/api/konta');
  const aniaW = (kontaW.json.uzytkownicy || []).find((u) => u.id === idAni) || {};
  ok((aniaW.zuzycie || {}).wiadomosci >= 1, `właściciel widzi liczbę wiadomości członka (${(aniaW.zuzycie || {}).wiadomosci})`);
  ok(!/Profil Ani|haslo|skrot|sol/.test(kontaW.tekst), 'lista kont nie zawiera profilu członka ani skrótów haseł');

  zabij(srv);
  atrapa.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nIZOLACJA OSÓB OK');
  process.exit(fail.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

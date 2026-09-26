/* Konta, zaproszenia i sesje – czyli czy do Cosmosa na publicznej domenie
   wejdzie tylko ten, kogo Marcin zaprosił.

   Do września 2026 Cosmos miał jedno hasło i anonimowe sesje w pamięci.
   Za Tailscale wystarczało. Na `cosmosai.live`, z rodziną i znajomymi, nie
   wystarcza nic z tego: serwer musi wiedzieć KTO pyta, sesja musi przeżyć
   restart, a formularz logowania nie może pozwalać zgadywać w nieskończoność.

   Każdy punkt sprawdza zachowanie przez HTTP, na prawdziwym serwerze:
     1. bez sesji – 401 na danych, a nie „puste dane",
     2. stary ekran logowania (samo hasło) nadal wpuszcza właściciela,
     3. zaproszenie działa RAZ; drugi klik w ten sam link – 410,
     4. sesja przeżywa restart serwera (wcześniej restart wylogowywał wszystkich),
     5. zmiana hasła wylogowuje POZOSTAŁE urządzenia, a to bieżące zostaje,
     6. usunięte konto traci sesję natychmiast, a jego dane nie znikają,
     7. pięć pomyłek z jednego adresu blokuje ten adres – nawet poprawne hasło,
        ale inny adres wchodzi bez przeszkód,
     8. żądanie z ciastkiem i obcym nagłówkiem Origin jest odrzucane,
     9. „Wyloguj wszędzie" działa – przycisk wysyła POST BEZ treści, a serwer
        brał to za zły JSON i przez miesiące odpowiadał 400,
    10. członek na silniku przyznanym przez właściciela dostaje model z jego
        listy i sufit max_tokens – nie „o1-pro na 100 tys. tokenów" na cudzy koszt;
        sufit wygrywa też z podbiciem limitu dla modeli myślących,
    11. zmysły (domowe GPU właściciela) i adres domu tylko ze zgodą; manifest
        zdolności i stan silników członka mówią tylko o JEGO silnikach, bez
        ścieżek serwera; identyfikator logowania OneDrive działa tylko u osoby,
        która je zaczęła; cudzy numer zadania wideo Studia daje 404,
    12. logowanie z cudzej strony odrzucone („login CSRF"),
    13. blokada IPv6 liczona po sieci /64, nie po pojedynczym adresie,
    14. miniatura SVG (może nieść skrypt) nie przechodzi przez proxy, a proxy nie
        idzie za przekierowaniem poza listę hostów,
     9b. „Wyloguj wszędzie" zrywa też OTWARTY strumień zdarzeń na innym urządzeniu.
*/
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { serwerCosmosa, czekajNa, zabij, katalogOsoby } = require('../pomoc');

const PORT = 3480;
const ADRES = `http://127.0.0.1:${PORT}`;
const HASLO = 'haslo-wlasciciela-2026';
const fail = [];
const ok = (warunek, opis) => { console.log(`${warunek ? 'ok ' : 'ŹLE'} ${opis}`); if (!warunek) fail.push(opis); };

/* Klient z ciastkiem. `ip` wkładamy w CF-Connecting-IP – serwer ufa temu
   nagłówkowi tylko z pętli zwrotnej, czyli dokładnie tak, jak za Cloudflare
   Tunnel. Dzięki temu da się sprawdzić blokadę „z dwóch różnych adresów". */
function klient(ip = '10.0.0.1') {
  let ciastko = '';
  return {
    get ciastko() { return ciastko; },
    ustaw(c) { ciastko = c; },
    async zadaj(sciezka, { metoda = 'GET', dane } = {}) {
      const r = await fetch(`${ADRES}${sciezka}`, {
        method: metoda,
        headers: {
          'Content-Type': 'application/json', 'CF-Connecting-IP': ip,
          ...(ciastko ? { Cookie: ciastko } : {}),
        },
        body: dane === undefined ? undefined : JSON.stringify(dane),
      });
      const sc = r.headers.get('set-cookie');
      if (sc) ciastko = sc.split(';')[0];
      let json = {};
      try { json = await r.json(); } catch { /* nie JSON */ }
      return { kod: r.status, json };
    },
  };
}

/* Atrapa dostawcy modeli i obrazków. Zapisuje, O CO serwer poprosił – model
   i max_tokens – bo tylko to mówi, na co poszły pieniądze właściciela. */
const zadaniaModelu = [];
const atrapa = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; }).on('end', () => {
    if (req.url.endsWith('/chat/completions')) {
      try { zadaniaModelu.push(JSON.parse(b)); } catch { /* bez treści */ }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return res.end('data: {"choices":[{"delta":{"content":"Dzień dobry."},"finish_reason":null}]}\n\n'
        + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    }
    if (req.url.startsWith('/obraz.svg')) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>');
    }
    // Przekierowanie z hosta z listy miniatur poza listę (tu: ten sam port pod „localhost").
    if (req.url.startsWith('/przekieruj')) {
      res.writeHead(302, { Location: `http://localhost:${atrapa.address().port}/obraz.png` });
      return res.end();
    }
    if (req.url.startsWith('/obraz.png')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
    }
    // Seedance (wideo Studia): zlecenie → numer zadania, status → gotowe, plik wideo.
    if (req.url === '/seedance/contents/generations/tasks' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: `cgt-${Date.now()}` }));
    }
    if (req.url.startsWith('/seedance/contents/generations/tasks/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'succeeded', content: { video_url: `http://127.0.0.1:${atrapa.address().port}/wideo.mp4` } }));
    }
    if (req.url === '/wideo.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      return res.end(Buffer.from('00000018667479706d703432', 'hex'));
    }
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"data":[]}');
    }
    // Zmysły właściciela – ŻYWE, bo tylko wtedy widać, komu je udostępniamy.
    if (req.url === '/zmysly/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true,"caps":{"detect":true}}');
    }
    if (req.url === '/zmysly/detect') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"summary":"kot na parapecie"}');
    }
    res.writeHead(404); res.end();
  });
});
let ZMYSLY = '';                               // adres zmysłów na atrapie – znany po starcie
const EKSPORT = '/tmp/cosmos-eksport-wlasciciela';
let envAtrapy = {};

async function postaw(dataDir) {
  const env = { COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin', COSMOS_NAZWA: 'Marcin', ...envAtrapy };
  const proc = dataDir
    ? require('../pomoc').uruchom('node', ['server.js'], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, PORT: String(PORT), COSMOS_DATA_DIR: dataDir, NVIDIA_API_KEY: 'test', ...env },
    })
    : serwerCosmosa(PORT, env);
  if (dataDir) proc.katalogDanych = dataDir;
  if (!(await czekajNa(`${ADRES}/api/auth`))) throw new Error('serwer nie wstał');
  return proc;
}

(async () => {
  await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${atrapa.address().port}`;
  ZMYSLY = `${A}/zmysly`;
  envAtrapy = {
    OPENAI_API_KEY: 'klucz-wlasciciela', OPENAI_BASE_URL: `${A}/v1`, OPENAI_MODEL: 'gpt-4o-mini',
    COSMOS_MODELE_PRZYZNANE: 'gpt-5-mini',
    // OneDrive skonfigurowany na niby; wymiana kodu na token trafia w atrapę (404), bez sieci.
    ONEDRIVE_CLIENT_ID: 'x', ONEDRIVE_CLIENT_SECRET: 'y', ONEDRIVE_REDIRECT_URI: 'https://przyklad/cb',
    ONEDRIVE_TOKEN_URL: `${A}/token`,
    SEEDANCE_API_KEY: 'klucz-seedance-wlasciciela', SEEDANCE_BASE_URL: `${A}/seedance`,
    NEMOTRON_BASE_URL: `${A}/v1`, LOCAL_BASE_URL: 'http://127.0.0.1:9/v1',
    SENSES_URL: ZMYSLY, STUDIO_EXPORT_DIR: EKSPORT, IMAGE_SEARCH_URL: `${A}/`,
  };
  let srv = await postaw();
  const dane = srv.katalogDanych;

  // --- 1. Bez sesji: 401, nie puste dane --------------------------------------
  const anonim = klient();
  const a = await anonim.zadaj('/api/profile');
  ok(a.kod === 401, `bez logowania /api/profile → ${a.kod} (ma być 401)`);
  const auth = await anonim.zadaj('/api/auth');
  ok(auth.json.required === true && auth.json.authed === false, 'serwer z hasłem mówi, że logowanie jest wymagane');

  // --- 2. Stary ekran logowania: samo hasło = właściciel ----------------------
  const marcin = klient('10.0.0.2');
  const zle = await marcin.zadaj('/api/login', { metoda: 'POST', dane: { password: 'nie-to-haslo' } });
  ok(zle.kod === 401, `złe hasło → ${zle.kod}`);
  const log = await marcin.zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
  ok(log.kod === 200 && log.json.uzytkownik && log.json.uzytkownik.rola === 'wlasciciel',
    'samo hasło (bez loginu) loguje właściciela – stary ekran i skrypty działają dalej');
  ok(log.json.uzytkownik && log.json.uzytkownik.login === 'marcin', 'login właściciela pochodzi z COSMOS_LOGIN');
  const log2 = await klient('10.0.0.3').zadaj('/api/login', { metoda: 'POST', dane: { login: 'Marcin', password: HASLO } });
  ok(log2.kod === 200, 'login wpisany wielką literą też pasuje');

  // --- 3. Zaproszenie działa raz ---------------------------------------------
  const zap = await marcin.zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: 'Ania Łęcka' } });
  ok(zap.kod === 200 && zap.json.token && zap.json.sciezka.startsWith('/app#zaproszenie='),
    'właściciel tworzy zaproszenie i dostaje link z tokenem w #fragmencie (nie trafia do logów serwera)');
  const token = zap.json.token;
  const podglad = await anonim.zadaj(`/api/zaproszenie?token=${encodeURIComponent(token)}`);
  ok(podglad.kod === 200 && podglad.json.nazwa === 'Ania Łęcka' && podglad.json.proponowanyLogin === 'ania',
    `podgląd zaproszenia bez logowania: „${podglad.json.nazwa}", proponowany login „${podglad.json.proponowanyLogin}"`);

  const ania = klient('10.0.0.4');
  const krotkie = await ania.zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token, login: 'ania', haslo: '123' } });
  ok(krotkie.kod === 400, 'za krótkie hasło odrzucone');
  const zajety = await ania.zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token, login: 'marcin', haslo: 'haslo-ani-12345' } });
  ok(zajety.kod === 409, 'zajęty login odrzucony – i zaproszenie po tym NIE przepada');
  const przyj = await ania.zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token, login: 'ania', haslo: 'haslo-ani-12345' } });
  ok(przyj.kod === 200 && przyj.json.uzytkownik.rola === 'czlonek' && Boolean(ania.ciastko),
    'przyjęcie zaproszenia zakłada konto członka i od razu loguje');
  const drugi = await klient('10.0.0.5').zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token, login: 'ktos', haslo: 'haslo-ktosia-123' } });
  ok(drugi.kod === 410, `drugi klik w ten sam link → ${drugi.kod} (ma być 410)`);
  const mojeAni = await ania.zadaj('/api/konto');
  ok(mojeAni.kod === 200 && mojeAni.json.uzytkownik.login === 'ania', 'Ania widzi swoje konto');

  // Członek nie tworzy zaproszeń
  const zapAni = await ania.zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: 'X' } });
  ok(zapAni.kod === 403, `członek nie tworzy zaproszeń → ${zapAni.kod}`);

  // Token nie leży jawnie na dysku
  const pliki = ['uzytkownicy.json', 'sesje.json', 'zaproszenia.json']
    .map((f) => { try { return fs.readFileSync(path.join(dane, 'konta', f), 'utf8'); } catch { return ''; } }).join('\n');
  ok(!pliki.includes(token), 'token zaproszenia nie leży jawnie w plikach kont');
  ok(!pliki.includes(ania.ciastko.split('=')[1]), 'token sesji nie leży jawnie w plikach kont');
  ok(!pliki.includes('haslo-ani-12345') && !pliki.includes(HASLO), 'hasła nie leżą jawnie w plikach kont');

  // --- 4. Sesja przeżywa restart ---------------------------------------------
  zabij(srv);
  await new Promise((r) => setTimeout(r, 800));
  srv = await postaw(dane);
  const poRestarcie = await marcin.zadaj('/api/profile');
  ok(poRestarcie.kod === 200, `po restarcie serwera właściciel nadal zalogowany → ${poRestarcie.kod}`);
  const aniaPo = await ania.zadaj('/api/konto');
  ok(aniaPo.kod === 200, 'po restarcie Ania też nadal zalogowana');

  // --- 5. Zmiana hasła wylogowuje pozostałe urządzenia ------------------------
  const aniaTelefon = klient('10.0.0.6');
  await aniaTelefon.zadaj('/api/login', { metoda: 'POST', dane: { login: 'ania', password: 'haslo-ani-12345' } });
  const zleStare = await ania.zadaj('/api/konto/haslo', { metoda: 'POST', dane: { stare: 'zle', nowe: 'nowe-haslo-ani-1' } });
  ok(zleStare.kod === 403, 'zmiana hasła bez poprawnego starego – odmowa');
  const zmiana = await ania.zadaj('/api/konto/haslo', { metoda: 'POST', dane: { stare: 'haslo-ani-12345', nowe: 'nowe-haslo-ani-1' } });
  ok(zmiana.kod === 200 && zmiana.json.wylogowano >= 1, `zmiana hasła wylogowała ${zmiana.json.wylogowano} inne urządzenie(a)`);
  ok((await ania.zadaj('/api/konto')).kod === 200, 'urządzenie, na którym zmieniono hasło, zostaje zalogowane');
  ok((await aniaTelefon.zadaj('/api/konto')).kod === 401, 'drugie urządzenie Ani zostało wylogowane');
  const stareHaslo = await klient('10.0.0.7').zadaj('/api/login', { metoda: 'POST', dane: { login: 'ania', password: 'haslo-ani-12345' } });
  ok(stareHaslo.kod === 401, 'stare hasło już nie działa');

  // --- 9. „Wyloguj wszędzie" – dokładnie tak, jak wysyła go przycisk ------------
  const aniaTablet = klient('10.0.0.8');
  await aniaTablet.zadaj('/api/login', { metoda: 'POST', dane: { login: 'ania', password: 'nowe-haslo-ani-1' } });
  /* Otwarty strumień zdarzeń na „zgubionym" tablecie. Wylogowanie odrzucało
     tylko NOWE żądania – otwarte połączenie żyło dalej i tablet widział nazwy
     plików, notatki i prompty aż do zerwania sieci. */
  const strumienTabletu = { tekst: '', zamkniety: false };
  const przerwijStrumien = new AbortController();
  fetch(`${ADRES}/api/events/stream`, { headers: { Cookie: aniaTablet.ciastko }, signal: przerwijStrumien.signal })
    .then(async (r) => {
      const czytnik = r.body.getReader();
      const dekoder = new TextDecoder();
      for (;;) { const { done, value } = await czytnik.read(); if (done) break; strumienTabletu.tekst += dekoder.decode(value); }
    }).catch(() => {}).finally(() => { strumienTabletu.zamkniety = true; });
  await new Promise((r) => setTimeout(r, 300));
  await ania.zadaj('/api/events', { metoda: 'POST', dane: { type: 'test', summary: 'PRZED-WYLOGOWANIEM' } });
  await new Promise((r) => setTimeout(r, 300));
  ok(strumienTabletu.tekst.includes('PRZED-WYLOGOWANIEM'), 'otwarty strumień tabletu dostaje zdarzenia (kontrola)');
  const wszedzie = await ania.zadaj('/api/konto/wyloguj-wszedzie', { metoda: 'POST' });   // bez treści
  ok(wszedzie.kod === 200 && wszedzie.json.wylogowano >= 1,
    `„Wyloguj wszędzie" z pustym żądaniem → ${wszedzie.kod}, wylogowano ${wszedzie.json.wylogowano}`);
  ok((await aniaTablet.zadaj('/api/konto')).kod === 401, 'tablet Ani wylogowany przyciskiem „Wyloguj wszędzie"');
  await ania.zadaj('/api/events', { metoda: 'POST', dane: { type: 'test', summary: 'PO-WYLOGOWANIU-WSZEDZIE' } });
  await new Promise((r) => setTimeout(r, 300));
  ok(!strumienTabletu.tekst.includes('PO-WYLOGOWANIU-WSZEDZIE') && strumienTabletu.zamkniety,
    'otwarty strumień tabletu zerwany – zdarzenie po wylogowaniu do niego nie dociera');
  przerwijStrumien.abort();
  ok((await ania.zadaj('/api/konto')).kod === 200, 'urządzenie, z którego kliknięto, zostaje zalogowane');
  const zepsuty = await fetch(`${ADRES}/api/konto`, { method: 'PUT', body: '{nazwa:',
    headers: { 'Content-Type': 'application/json', Cookie: ania.ciastko } });
  ok(zepsuty.status === 400, 'zepsuty JSON nadal jest błędem – tolerujemy tylko PUSTE żądanie');

  // --- 10. Silnik przyznany: model z listy właściciela, sufit max_tokens --------
  const idAniTu = przyj.json.uzytkownik.id;
  await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: idAniTu, silniki: { openai: true } } });
  const czat = async (kto, dane) => {
    const r = await fetch(`${ADRES}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: kto.ciastko },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Dzień dobry' }], useSenses: false,
        useSearch: false, useMemory: false, useKb: false, useActions: false, useStudio: false, ...dane }),
    });
    await r.text();
    return { kod: r.status, spozaListy: decodeURIComponent(r.headers.get('x-cosmos-model-spoza-listy') || ''),
      zadanie: zadaniaModelu[zadaniaModelu.length - 1] || {} };
  };
  const tokeny = (z) => z.max_tokens ?? z.max_completion_tokens;
  const cz = await czat(ania, { endpoint: 'openai', model: 'o1-pro', max_tokens: 100000 });
  ok(cz.kod === 200 && cz.zadanie.model === 'gpt-4o-mini',
    `członek prosi o o1-pro na kluczu właściciela → do OpenAI idzie „${cz.zadanie.model}"`);
  ok(cz.spozaListy === 'o1-pro', 'odpowiedź mówi wprost, że model został zamieniony (nagłówek dla adnotacji)');
  ok(tokeny(cz.zadanie) <= 8192, `max_tokens członka ma sufit (${tokeny(cz.zadanie)})`);
  const cw = await czat(marcin, { endpoint: 'openai', model: 'o1-pro', max_tokens: 100000 });
  ok(cw.zadanie.model === 'o1-pro' && !cw.spozaListy && tokeny(cw.zadanie) === 100000,
    `właściciel wybiera dowolny model i długość (${cw.zadanie.model}, ${tokeny(cw.zadanie)})`);
  /* Model myślący z listy właściciela: Cosmos podbija im limit do 16 000 (myślenie
     liczy się do limitu) – i to podbicie przebijało sufit członka. */
  const myslacy = await czat(ania, { endpoint: 'openai', model: 'gpt-5-mini', max_tokens: 2048 });
  ok(myslacy.zadanie.model === 'gpt-5-mini' && tokeny(myslacy.zadanie) <= 8192,
    `model myślący członka: sufit wygrywa z podbiciem limitu (${tokeny(myslacy.zadanie)})`);
  const myslacyW = await czat(marcin, { endpoint: 'openai', model: 'gpt-5-mini', max_tokens: 2048 });
  ok(tokeny(myslacyW.zadanie) === 16000, `u właściciela podbicie dla modelu myślącego zostaje (${tokeny(myslacyW.zadanie)})`);

  // --- 11. Zmysły i adres domu tylko ze zgodą ----------------------------------
  const obraz = { image: 'data:image/png;base64,iVBORw0KGgo=' };
  const detAni = await ania.zadaj('/api/detect', { metoda: 'POST', dane: obraz });
  ok(detAni.kod === 403 && detAni.json.kod === 'zmysly-niedostepne',
    `członek bez „lokalnego GPU" nie używa zmysłów właściciela → ${detAni.kod}`);
  const detW = await marcin.zadaj('/api/detect', { metoda: 'POST', dane: obraz });
  ok(detW.kod === 200 && detW.json.summary, `właściciel ma swoje zmysły → ${detW.kod}`);
  const stAni = await ania.zadaj('/api/status');
  const stW = await marcin.zadaj('/api/status');
  ok(stW.json.senses && stW.json.senses.online === true, 'właściciel widzi swoje zmysły jako działające');
  ok(stAni.json.senses && stAni.json.senses.online === false,
    'członek nie widzi ich jako dostępnych – przeglądarka nie skieruje do nich mowy ani kamery');
  const cfgAni = await ania.zadaj('/api/config');
  const cfgW = await marcin.zadaj('/api/config');
  ok(!cfgAni.json.senses.baseUrl && cfgAni.json.studio.exportDir === null,
    'członek nie dostaje adresu zmysłów ani ścieżki eksportu właściciela');
  ok(cfgW.json.senses.baseUrl === ZMYSLY && cfgW.json.studio.exportDir === EKSPORT, 'właściciel widzi swoje adresy');
  /* Manifest zdolności idzie do kontekstu czatu: członkowi oddawał ścieżkę
     eksportu z dysku serwera i obiecywał silniki, których mu nie przyznano. */
  const capAni = (await ania.zadaj('/api/capabilities')).json.manifest || {};
  const capW = (await marcin.zadaj('/api/capabilities')).json.manifest || {};
  ok(capAni.studio && capAni.studio.eksport === null && capW.studio && capW.studio.eksport === EKSPORT,
    'manifest zdolności: ścieżka eksportu tylko u właściciela');
  const mozgiAni = (capAni.mozgi || []).map((m) => m.id).sort().join(',');
  ok(mozgiAni === 'cloud,openai', `manifest członka wymienia tylko jego silniki (${mozgiAni})`);
  ok(!('local' in stAni.json) && 'local' in stW.json,
    'stan silników członka bez „lokalnego GPU" nie zdradza, czy komputer właściciela jest włączony');
  /* OneDrive: `state` z logowania Ani nie może zadziałać u właściciela. Inaczej
     link od członka z kodem jego konta Microsoft podpinał cudzy OneDrive
     do archiwum właściciela. */
  const loginAni = await ania.zadaj('/api/onedrive/login');
  const stanAni = new URL(loginAni.json.url || 'https://x/').searchParams.get('state') || '';
  const callback = async (k) => (await fetch(`${ADRES}/api/onedrive/callback?code=kod-ani&state=${encodeURIComponent(stanAni)}`,
    { headers: { Cookie: k.ciastko } })).text();
  ok(stanAni.length >= 20 && /Nieprawidłowy albo przeterminowany/.test(await callback(marcin)),
    'OneDrive: identyfikator logowania Ani nie działa w callbacku właściciela');
  ok(!/Nieprawidłowy albo przeterminowany/.test(await callback(ania)),
    'OneDrive: ten sam identyfikator przechodzi u osoby, która zaczęła logowanie (kontrola)');
  /* Wideo Studia: rejestr zadań jest wspólny, klucz Seedance – właściciela.
     Członek ze Studiem, znając numer zadania (np. ze zrzutu ekranu), dostawał
     cudze wideo z promptem do swojej bazy wiedzy. */
  await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: idAniTu, silniki: { openai: true, studio: true } } });
  const zlecenie = await marcin.zadaj('/api/studio/video', { metoda: 'POST', dane: { prompt: 'SEKRET-WIDEO prywatny film' } });
  const numer = zlecenie.json.taskId;
  const cudzy = await ania.zadaj(`/api/studio/video/status?id=${encodeURIComponent(numer || '')}`);
  const nieznany = await ania.zadaj('/api/studio/video/status?id=cgt-spoza-cosmosa');
  ok(Boolean(numer) && cudzy.kod === 404 && nieznany.kod === 404,
    `wideo Studia: cudzy i nieznany numer zadania dla członka → ${cudzy.kod}, ${nieznany.kod}`);
  let swoj = await marcin.zadaj(`/api/studio/video/status?id=${encodeURIComponent(numer || '')}`);
  for (let i = 0; i < 20 && swoj.json.status === 'running'; i++) {
    await new Promise((r) => setTimeout(r, 150));
    swoj = await marcin.zadaj(`/api/studio/video/status?id=${encodeURIComponent(numer || '')}`);
  }
  ok(swoj.json.status === 'done', `właściciel dostaje swoje wideo (${swoj.json.status})`);
  await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: idAniTu, silniki: { openai: true, local: true } } });
  const cfgAniLokalny = await ania.zadaj('/api/config');
  ok(cfgAniLokalny.json.endpoints.local && cfgAniLokalny.json.endpoints.local.baseUrl === '',
    'z przyznanym „lokalnym GPU" członek ma zakładkę, ale nie adres komputera właściciela');
  const detAni2 = await ania.zadaj('/api/detect', { metoda: 'POST', dane: obraz });
  ok(detAni2.kod === 200, `z przyznanym „lokalnym GPU" członek dochodzi do zmysłów → ${detAni2.kod}`);

  // --- 6. Usunięcie konta ------------------------------------------------------
  // Ania zostawia coś po sobie, żeby było co „nie zgubić".
  await ania.zadaj('/api/profile', { metoda: 'POST', dane: { profile: 'Profil Ani' } });
  const idAni = przyj.json.uzytkownik.id;
  const usun = await marcin.zadaj(`/api/konta/uzytkownik?id=${idAni}`, { metoda: 'DELETE' });
  ok(usun.kod === 200, 'właściciel usuwa konto Ani');
  ok((await ania.zadaj('/api/konto')).kod === 401, 'sesja usuniętego konta przestaje działać natychmiast');
  const odlozone = fs.existsSync(path.join(dane, 'usuniete'))
    && fs.readdirSync(path.join(dane, 'usuniete')).some((d) => d.startsWith(idAni));
  ok(odlozone && !fs.existsSync(katalogOsoby(srv, idAni)), 'dane usuniętego konta odłożone do data/usuniete/, a nie skasowane');
  const usunWlasc = await marcin.zadaj('/api/konta/uzytkownik?id=wlasciciel', { metoda: 'DELETE' });
  ok(usunWlasc.kod === 404, 'konta właściciela nie da się usunąć');

  // --- 7. Blokada po pomyłkach -------------------------------------------------
  const napastnik = klient('203.0.113.9');
  for (let i = 0; i < 5; i++) {
    await napastnik.zadaj('/api/login', { metoda: 'POST', dane: { login: 'nieistnieje', password: `zgaduje-${i}` } });
  }
  const zablok = await napastnik.zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
  ok(zablok.kod === 429 && /\d+ min/.test(zablok.json.error || ''),
    `po 5 pomyłkach adres zablokowany – nawet z poprawnym hasłem (${zablok.kod}: ${zablok.json.error})`);
  const zInnego = await klient('198.51.100.7').zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
  ok(zInnego.kod === 200, 'z innego adresu właściciel wchodzi bez przeszkód – blokada nie zamyka wszystkich');

  // --- 8. Obce pochodzenie ------------------------------------------------------
  /* fetch nie pozwala podmienić nagłówka Host, więc idziemy przez http.request.
     Host „cosmosai.live" udaje żądanie przychodzące przez tunel. */
  const surowe = (origin) => new Promise((gotowe) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/profile', method: 'POST',
      headers: { Host: 'cosmosai.live', Origin: origin, Cookie: marcin.ciastko, 'Content-Type': 'application/json' } },
    (res) => { res.resume(); gotowe(res.statusCode); });
    r.end(JSON.stringify({ profile: 'podmienione' }));
  });
  ok((await surowe('https://zla-strona.example')) === 403, 'POST z ciastkiem i obcym Origin → 403');
  ok((await surowe('https://cosmosai.live')) === 200, 'ten sam Origin co Host → przechodzi');

  // --- 12. Logowanie z cudzej strony („login CSRF") -----------------------------
  /* Cudza strona wysyła formularz z SWOIM loginem i hasłem – przeglądarka ofiary
     zostaje zalogowana na obce konto i jej rozmowy trafiają do napastnika. */
  const logowanieZ = (origin) => new Promise((gotowe) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/login', method: 'POST',
      headers: { Host: 'cosmosai.live', Origin: origin, 'Content-Type': 'text/plain', 'CF-Connecting-IP': '192.0.2.50' } },
    (res) => { res.resume(); gotowe(res.statusCode); });
    r.end(JSON.stringify({ login: 'marcin', password: HASLO }));
  });
  ok((await logowanieZ('https://zla-strona.example')) === 403, 'formularz logowania z cudzej strony → 403');
  ok((await logowanieZ('https://cosmosai.live')) === 200, 'logowanie z własnej strony przechodzi');

  // --- 13. IPv6: blokada po sieci /64 -------------------------------------------
  /* Łącze domowe dostaje całą pulę /64. Zgadujący zmienia adres co pięć prób,
     więc blokada pojedynczego adresu IPv6 nie zatrzymywała nikogo. */
  for (let i = 1; i <= 5; i++) {
    await klient(`2001:db8:5:6::${i}`).zadaj('/api/login', { metoda: 'POST', dane: { login: 'nieistnieje', password: 'zle' } });
  }
  const v6 = await klient('2001:db8:5:6::99').zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
  ok(v6.kod === 429, `pięć pomyłek z różnych adresów jednej sieci /64 blokuje całą sieć → ${v6.kod}`);
  const v6inna = await klient('2001:db8:5:7::1').zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
  ok(v6inna.kod === 200, `sąsiednia sieć /64 wchodzi bez przeszkód → ${v6inna.kod}`);

  // --- 14. Proxy miniatur: bez SVG, z nosniff i sandbox -------------------------
  const miniatura = (plik) => fetch(`${ADRES}/api/search/thumb?u=${encodeURIComponent(`${A}/${plik}`)}`,
    { headers: { Cookie: marcin.ciastko } });
  const svg = await miniatura('obraz.svg');
  ok(svg.status === 415, `miniatura SVG (może nieść skrypt) nie przechodzi → ${svg.status}`);
  const png = await miniatura('obraz.png');
  ok(png.status === 200 && png.headers.get('x-content-type-options') === 'nosniff'
    && /sandbox/.test(png.headers.get('content-security-policy') || ''),
  `miniatura PNG przechodzi – z nosniff i sandbox (${png.status})`);
  const przekierowana = await miniatura('przekieruj');
  ok(przekierowana.status !== 200 && przekierowana.status >= 400,
    `przekierowanie poza listę hostów nie przechodzi (SSRF do sieci serwera) → ${przekierowana.status}`);

  atrapa.close();
  zabij(srv);
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKONTA I LOGOWANIE OK');
  process.exit(fail.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

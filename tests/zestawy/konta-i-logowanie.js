/* Konta, zaproszenia i sesje — czyli czy do Cosmosa na publicznej domenie
   wejdzie tylko ten, kogo Marcin zaprosił.

   Do września 2026 Cosmos miał jedno hasło i anonimowe sesje w pamięci.
   Za Tailscale wystarczało. Na `cosmosai.live`, z rodziną i znajomymi, nie
   wystarcza nic z tego: serwer musi wiedzieć KTO pyta, sesja musi przeżyć
   restart, a formularz logowania nie może pozwalać zgadywać w nieskończoność.

   Każdy punkt sprawdza zachowanie przez HTTP, na prawdziwym serwerze:
     1. bez sesji — 401 na danych, a nie „puste dane",
     2. stary ekran logowania (samo hasło) nadal wpuszcza właściciela,
     3. zaproszenie działa RAZ; drugi klik w ten sam link — 410,
     4. sesja przeżywa restart serwera (wcześniej restart wylogowywał wszystkich),
     5. zmiana hasła wylogowuje POZOSTAŁE urządzenia, a to bieżące zostaje,
     6. usunięte konto traci sesję natychmiast, a jego dane nie znikają,
     7. pięć pomyłek z jednego adresu blokuje ten adres — nawet poprawne hasło,
        ale inny adres wchodzi bez przeszkód,
     8. żądanie z ciastkiem i obcym nagłówkiem Origin jest odrzucane.
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

/* Klient z ciastkiem. `ip` wkładamy w CF-Connecting-IP — serwer ufa temu
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

async function postaw(dataDir) {
  const env = { COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin', COSMOS_NAZWA: 'Marcin' };
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
    'samo hasło (bez loginu) loguje właściciela — stary ekran i skrypty działają dalej');
  ok(log.json.uzytkownik && log.json.uzytkownik.login === 'marcin', 'login właściciela pochodzi z COSMOS_LOGIN');
  const log2 = await klient('10.0.0.3').zadaj('/api/login', { metoda: 'POST', dane: { login: 'Marcin', password: HASLO } });
  ok(log2.kod === 200, 'login wpisany wielką literą też pasuje');

  // --- 3. Zaproszenie działa raz ---------------------------------------------
  const zap = await marcin.zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: 'Ania Łęcka' } });
  ok(zap.kod === 200 && zap.json.token && zap.json.sciezka.startsWith('/#zaproszenie='),
    'właściciel tworzy zaproszenie i dostaje link z tokenem w #fragmencie (nie trafia do logów serwera)');
  const token = zap.json.token;
  const podglad = await anonim.zadaj(`/api/zaproszenie?token=${encodeURIComponent(token)}`);
  ok(podglad.kod === 200 && podglad.json.nazwa === 'Ania Łęcka' && podglad.json.proponowanyLogin === 'ania',
    `podgląd zaproszenia bez logowania: „${podglad.json.nazwa}", proponowany login „${podglad.json.proponowanyLogin}"`);

  const ania = klient('10.0.0.4');
  const krotkie = await ania.zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token, login: 'ania', haslo: '123' } });
  ok(krotkie.kod === 400, 'za krótkie hasło odrzucone');
  const zajety = await ania.zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token, login: 'marcin', haslo: 'haslo-ani-12345' } });
  ok(zajety.kod === 409, 'zajęty login odrzucony — i zaproszenie po tym NIE przepada');
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
  ok(zleStare.kod === 403, 'zmiana hasła bez poprawnego starego — odmowa');
  const zmiana = await ania.zadaj('/api/konto/haslo', { metoda: 'POST', dane: { stare: 'haslo-ani-12345', nowe: 'nowe-haslo-ani-1' } });
  ok(zmiana.kod === 200 && zmiana.json.wylogowano >= 1, `zmiana hasła wylogowała ${zmiana.json.wylogowano} inne urządzenie(a)`);
  ok((await ania.zadaj('/api/konto')).kod === 200, 'urządzenie, na którym zmieniono hasło, zostaje zalogowane');
  ok((await aniaTelefon.zadaj('/api/konto')).kod === 401, 'drugie urządzenie Ani zostało wylogowane');
  const stareHaslo = await klient('10.0.0.7').zadaj('/api/login', { metoda: 'POST', dane: { login: 'ania', password: 'haslo-ani-12345' } });
  ok(stareHaslo.kod === 401, 'stare hasło już nie działa');

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
    `po 5 pomyłkach adres zablokowany — nawet z poprawnym hasłem (${zablok.kod}: ${zablok.json.error})`);
  const zInnego = await klient('198.51.100.7').zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
  ok(zInnego.kod === 200, 'z innego adresu właściciel wchodzi bez przeszkód — blokada nie zamyka wszystkich');

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

  zabij(srv);
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKONTA I LOGOWANIE OK');
  process.exit(fail.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

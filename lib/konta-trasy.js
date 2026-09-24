/* ============================================================
   Trasy kont — logowanie, zaproszenia, własne konto, zarządzanie ludźmi

   Wydzielone z server.js, kiedy przez konta urósł z 2,6 do 2,9 tys. linii.
   Zasady (kto może co, czemu tak) opisują nagłówki lib/konta.js,
   lib/kontekst.js i lib/silniki.js; tu jest tylko HTTP wokół nich.

   Bramka logowania ZOSTAJE w server.js, w samym routerze — audyt sprawdza
   strukturalnie, że nad nią stoją wyłącznie trasy publiczne. Tu jest tylko
   to, co bramka woła.
   ============================================================ */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function utworz({
  konta, silniki, kto, katalogDla, zapomnij, WLASCICIEL_ID,
  DATA_DIR, ENDPOINTS, STUDIO, imageProviders, sendJson, readJson, readBodyBuffer,
}) {
  // Uwierzytelnianie — konta, sesje, zaproszenia (szczegóły: lib/konta.js).
  //
  //   Tryb domowy: żadne konto nie ma hasła i nie ustawiono tokenu API.
  //   Wtedy jest jedna osoba — właściciel — i nikt nie pyta o hasło.
  //   Tak działał Cosmos od początku i tak nadal działa na localhost.
  //
  //   COSMOS_PASSWORD — przy pierwszym starcie staje się hasłem konta
  //                     właściciela (login z COSMOS_LOGIN). Potem hasło żyje
  //                     w koncie i zmienia się je w Ustawieniach.
  //   COSMOS_API_TOKEN — stały token dla klientów programowych (mostek MCP,
  //                      watcher zmysłów). Działa w imieniu właściciela.
  // ---------------------------------------------------------------------------

  const AUTH = {
    apiToken: process.env.COSMOS_API_TOKEN || '',
    cookieSecure: process.env.COSMOS_COOKIE_SECURE === '1', // ustaw przy publicznym HTTPS
  };

  function authEnabled() {
    return Boolean(AUTH.apiToken || konta.maHasla());
  }

  function safeEqual(a, b) {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  }

  function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  function tokenZadania(req) {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) return { token: header.slice(7).trim(), zCiastka: false };
    return { token: parseCookies(req).cosmos_auth || '', zCiastka: true };
  }

  /** Kto wysłał to żądanie — widok konta albo null. */
  function ktoPyta(req) {
    if (!authEnabled()) return konta.wlasciciel();
    const { token } = tokenZadania(req);
    if (!token) return null;
    if (AUTH.apiToken && safeEqual(token, AUTH.apiToken)) return konta.wlasciciel();
    return konta.uzytkownikSesji(token);
  }

  function ciastkoSesji(token) {
    return `cosmos_auth=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`
      + (AUTH.cookieSecure ? '; Secure' : '');
  }

  function zalogowano(res, u, token) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': ciastkoSesji(token) });
    res.end(JSON.stringify({ ok: true, token, uzytkownik: u }));
  }

  /* Blokada po nieudanych próbach — liczona dla adresu I dla loginu. Odpowiedź
     mówi, ile minut poczekać: „spróbuj później" bez liczby każe próbować co
     minutę, czyli przedłużać sobie blokadę. */
  function blokadaLogowania(ip, login) {
    const do_ = Math.max(konta.zablokowanyDo(`ip:${ip}`), login ? konta.zablokowanyDo(`login:${login}`) : 0);
    return do_ ? Math.ceil((do_ - Date.now()) / 60000) : 0;
  }

  async function handleLogin(req, res) {
    let data;
    try { data = JSON.parse((await readBodyBuffer(req, 64 * 1024)).toString('utf8')); }
    catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const ip = konta.adresKlienta(req);
    /* Puste pole loginu = właściciel. Stary ekran logowania (samo hasło)
       i skrypty sprzed kont działają dalej bez zmian. */
    const login = konta.normalizujLogin(data.login || '') || (konta.wlasciciel() || {}).login || '';
    const minut = blokadaLogowania(ip, login);
    if (minut) {
      return sendJson(res, 429, { error: `Za dużo nieudanych prób. Spróbuj ponownie za ${minut} min.` });
    }
    const u = await konta.zaloguj(login, String(data.password || data.haslo || ''));
    if (!u) {
      konta.zanotujPomylke(`ip:${ip}`);
      konta.zanotujPomylke(`login:${login}`);
      return sendJson(res, 401, { error: 'Nieprawidłowy login lub hasło.' });
    }
    konta.wyczyscPomylki(`ip:${ip}`);
    konta.wyczyscPomylki(`login:${login}`);
    return zalogowano(res, u, konta.utworzSesje(u.id, req.headers['user-agent'] || ''));
  }

  function handleLogout(req, res) {
    const { token } = tokenZadania(req);
    if (token) konta.usunSesje(token);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'cosmos_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    });
    res.end('{"ok":true}');
  }

  /* Zaproszenie: sprawdzenie (GET) i przyjęcie (POST). Publiczne, bo osoba
     zaproszona nie ma jeszcze konta. Token trzydziestu dwóch znaków losowych
     nie da się zgadnąć, ale limit prób i tak obowiązuje — kosztuje nas zero. */
  async function handleZaproszenie(req, res) {
    const ip = konta.adresKlienta(req);
    if (konta.zablokowanyDo(`ip:${ip}`)) {
      return sendJson(res, 429, { error: 'Za dużo prób. Spróbuj ponownie za kwadrans.' });
    }
    if (req.method === 'GET') {
      const token = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
      const z = konta.zaproszenieZTokenu(token);
      if (!z) {
        konta.zanotujPomylke(`ip:${ip}`);
        return sendJson(res, 410, { error: 'To zaproszenie wygasło albo zostało już użyte. Poproś o nowe.' });
      }
      return sendJson(res, 200, { ok: true, nazwa: z.nazwa, wygasa: z.wygasa,
        // Imię zapraszającego — „Marcin zaprasza Cię" mówi więcej niż „masz zaproszenie".
        zapraszajacy: z.przez ? (konta.znajdz(z.przez) || {}).nazwa || '' : '',
        proponowanyLogin: konta.normalizujLogin(z.nazwa.split(/\s+/)[0] || '') });
    }
    if (req.method === 'POST') {
      let d;
      try { d = JSON.parse((await readBodyBuffer(req, 64 * 1024)).toString('utf8')); }
      catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      try {
        const u = await konta.przyjmijZaproszenie(String(d.token || ''),
          { login: d.login, nazwa: d.nazwa, haslo: String(d.haslo || '') });
        return zalogowano(res, u, konta.utworzSesje(u.id, req.headers['user-agent'] || ''));
      } catch (err) {
        if (err.kod === 410) konta.zanotujPomylke(`ip:${ip}`);
        return sendJson(res, err.kod || 500, { error: err.message });
      }
    }
    res.writeHead(405); res.end();
  }

  /* Pochodzenie żądania zmieniającego stan. Ciastko SameSite=Lax już nie jedzie
     z cudzej strony przy POST-cie, ale to druga warstwa: żądanie z ciastkiem
     i z nagłówkiem Origin innej domeny odrzucamy. Gdy pośrednik przepisał Host
     na adres lokalny (niektóre konfiguracje proxy), nie ma z czym porównać —
     wtedy polegamy na SameSite, zamiast blokować wszystkich. */
  function obcePochodzenie(req) {
    if (req.method === 'GET' || req.method === 'HEAD') return false;
    const { zCiastka } = tokenZadania(req);
    if (!zCiastka) return false;
    const origin = req.headers.origin;
    const host = req.headers.host || '';
    if (!origin || !host || /^(localhost|127\.|\[::1\])/.test(host)) return false;
    let hostOrigin;
    try { hostOrigin = new URL(origin).host; } catch { return true; }
    const dozwolone = [host, req.headers['x-forwarded-host']].filter(Boolean).map(String);
    return !dozwolone.includes(hostOrigin);
  }

  /* Trasy, których nie wolno nikomu poza właścicielem — bo działają na
     serwerze albo w domu właściciela, a nie w danych pytającej osoby:
       kod i trening       — uruchamiają procesy obok .env i danych wszystkich,
       automatyzacja       — loguje się hasłami z menedżera haseł właściciela,
       Canon, Kinect       — sprzęt w domu właściciela, obraz na żywo,
       urządzenia, odprawa — inteligentny dom i kalendarz właściciela; do tego
                             urządzenie to adres, który SERWER odpytuje, więc
                             w rękach gościa byłoby furtką do sieci serwera,
       sondowanie modeli   — zapytania na kluczach właściciela,
       konta               — zarządzanie ludźmi. */
  const TYLKO_WLASCICIEL = [
    /^\/api\/run$/, /^\/api\/train\//,
    /^\/api\/procedures\/run-readonly$/, /^\/api\/automation\//, /^\/api\/procedures\/record\//,
    /^\/api\/canon\//, /^\/api\/kinect\//,
    /^\/api\/devices(\/|$)/, /^\/api\/briefing$/,
    /^\/api\/models\/check$/,
    /^\/api\/konta(\/|$)/,
  ];

  /* WŁASNE KONTO — każdy: nazwa, hasło, własne klucze, wylogowanie wszędzie. */
  async function handleKonto(req, res, p) {
    const u = kto();
    if (p === '/api/konto' && req.method === 'GET') {
      return sendJson(res, 200, {
        uzytkownik: u,
        klucze: silniki.kluczeWidok(),
        silniki: silniki.dostepne().map(({ nazwa, zrodlo }) => ({ nazwa, zrodlo })),
        sesji: konta.ileSesji(u.id),
        logowanie: authEnabled(),
      });
    }
    let d = {};
    try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    if (p === '/api/konto' && req.method === 'PUT') {
      return sendJson(res, 200, { ok: true, uzytkownik: konta.ustawNazwe(u.id, d.nazwa) });
    }
    if (p === '/api/konto/haslo' && req.method === 'POST') {
      /* Stare hasło wymagane zawsze, gdy konto już jakieś ma. Otwarta karta na
         cudzym komputerze nie może wystarczyć do przejęcia konta. */
      if (u.maHaslo && !(await konta.zaloguj(u.login, String(d.stare || '')))) {
        return sendJson(res, 403, { error: 'Obecne hasło się nie zgadza.' });
      }
      try { await konta.ustawHaslo(u.id, String(d.nowe || '')); }
      catch (err) { return sendJson(res, err.kod || 500, { error: err.message }); }
      // Wyloguj pozostałe urządzenia — po to zwykle zmienia się hasło.
      const ile = konta.usunSesjeUzytkownika(u.id, tokenZadania(req).token);
      return sendJson(res, 200, { ok: true, wylogowano: ile });
    }
    if (p === '/api/konto/klucze' && req.method === 'PUT') {
      try { return sendJson(res, 200, { ok: true, klucze: silniki.ustawKlucz(String(d.nazwa || ''), d.klucz) }); }
      catch (err) { return sendJson(res, err.kod || 500, { error: err.message }); }
    }
    if (p === '/api/konto/wyloguj-wszedzie' && req.method === 'POST') {
      return sendJson(res, 200, { ok: true, wylogowano: konta.usunSesjeUzytkownika(u.id, tokenZadania(req).token) });
    }
    return sendJson(res, 404, { error: 'Nie ma takiej trasy.' });
  }

  /* LUDZIE — tylko właściciel (bramka TYLKO_WLASCICIEL). Zgodnie z decyzją
     Marcina widać tu konta, ostatnią wizytę i liczbę wiadomości — i nic
     więcej. Rozmów, pamięci ani bazy wiedzy innych osób ta trasa nie oddaje. */
  async function handleKonta(req, res, p) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    if (p === '/api/konta' && req.method === 'GET') {
      return sendJson(res, 200, {
        logowanie: authEnabled(),
        uzytkownicy: konta.wszyscy().map((x) => ({ ...x, sesji: konta.ileSesji(x.id) })),
        zaproszenia: konta.listaZaproszen(),
        silnikiSerwera: {
          local: Boolean(ENDPOINTS.local && ENDPOINTS.local.model),
          openai: Boolean(ENDPOINTS.openai), claude: Boolean(ENDPOINTS.claude),
          studio: imageProviders().length > 0 || Boolean(STUDIO.eleven.key) || Boolean(STUDIO.seedance.key),
        },
      });
    }
    if (p === '/api/konta/zaproszenia' && req.method === 'POST') {
      /* Bez hasła właściciela Cosmos jest otwarty dla każdego, kto trafi pod
         adres. Zaproszenie „dla Ani" nic by wtedy nie znaczyło — Ania i tak
         weszłaby jako właściciel. */
      if (!authEnabled()) {
        return sendJson(res, 409, { error: 'Najpierw ustaw sobie hasło (Ustawienia → Konto). Bez niego każdy, kto zna adres, wchodzi jako Ty.' });
      }
      let d = {};
      try { d = await readJson(req); } catch { /* bez nazwy też można */ }
      const { token, zaproszenie } = konta.utworzZaproszenie({ nazwa: d.nazwa, przez: kto().id });
      return sendJson(res, 200, { ok: true, token, sciezka: `/app#zaproszenie=${token}`, zaproszenie });
    }
    if (p === '/api/konta/zaproszenia' && req.method === 'DELETE') {
      return sendJson(res, 200, { ok: konta.usunZaproszenie(q.get('id') || '') });
    }
    if (p === '/api/konta/uzytkownik' && req.method === 'PUT') {
      let d = {};
      try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const u = konta.ustawSilniki(String(d.id || ''), d.silniki || {});
      return u ? sendJson(res, 200, { ok: true, uzytkownik: u }) : sendJson(res, 404, { error: 'Nie ma takiego konta.' });
    }
    if (p === '/api/konta/uzytkownik' && req.method === 'DELETE') {
      const id = q.get('id') || '';
      if (!konta.usunUzytkownika(id)) return sendJson(res, 404, { error: 'Nie ma takiego konta (albo to konto właściciela).' });
      /* Dane usuniętej osoby NIE znikają — trafiają do data/usuniete/. Usunięcie
         konta to decyzja o dostępie, a nie o zniszczeniu czyichś rozmów; gdyby
         to była pomyłka, da się je przywrócić ręcznie. */
      zapomnij(id);
      try {
        const skad = katalogDla(id);
        if (fs.existsSync(skad)) {
          const dokad = path.join(DATA_DIR, 'usuniete', `${id}-${new Date().toISOString().slice(0, 10)}`);
          fs.mkdirSync(path.dirname(dokad), { recursive: true });
          fs.renameSync(skad, dokad);
        }
      } catch (err) { console.error('Nie udało się odłożyć danych usuniętego konta:', err.message); }
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/konta/wyloguj' && req.method === 'POST') {
      let d = {};
      try { d = await readJson(req); } catch { /* */ }
      return sendJson(res, 200, { ok: true, wylogowano: konta.usunSesjeUzytkownika(String(d.id || '')) });
    }
    return sendJson(res, 404, { error: 'Nie ma takiej trasy.' });
  }

  /* MIGRACJA DO KONT. Do tej pory wszystkie dane leżały wprost w data/.
     Teraz każda osoba ma data/uzytkownicy/<id>/, a stare dane są danymi
     właściciela. Przenosimy je RAZ, przy starcie, z kopią zapasową obok.

     Przeniesienie, nie kopia: po nim żaden moduł nie czyta już starych
     ścieżek, a zostawione pliki sugerowałyby, że wciąż coś znaczą.
     Plik, który już istnieje u celu, zostaje nietknięty po obu stronach —
     migracja przerwana w połowie nie może nadpisać nowszych danych starszymi. */
  const STARE_DANE = ['conversations', 'kb', 'profile.txt', 'location.txt', 'location.json',
    'sprzet.json', 'timeline.json', 'memory.json', 'lessons.json', 'procedures.json',
    'routines.json', 'devices.json', 'onedrive.json', 'archiwum.json', 'improvements.json', 'train'];

  function migrujDoKont() {
    const doPrzeniesienia = STARE_DANE.filter((n) => fs.existsSync(path.join(DATA_DIR, n)));
    if (!doPrzeniesienia.length) return null;
    const znacznik = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const kopia = path.join(DATA_DIR, `kopia-przed-kontami-${znacznik}`);
    for (const n of doPrzeniesienia) {
      fs.cpSync(path.join(DATA_DIR, n), path.join(kopia, n), { recursive: true });
    }
    const cel = katalogDla(WLASCICIEL_ID);
    fs.mkdirSync(cel, { recursive: true });
    const przeniesione = [];
    const pominiete = [];
    for (const n of doPrzeniesienia) {
      const dokad = path.join(cel, n);
      if (fs.existsSync(dokad)) { pominiete.push(n); continue; }
      fs.renameSync(path.join(DATA_DIR, n), dokad);
      przeniesione.push(n);
    }
    return { przeniesione, pominiete, kopia };
  }

  return {
    AUTH, TYLKO_WLASCICIEL, STARE_DANE,
    authEnabled, ktoPyta, tokenZadania, handleLogin, handleLogout, handleZaproszenie,
    obcePochodzenie, handleKonto, handleKonta, migrujDoKont,
  };
}

module.exports = { utworz };

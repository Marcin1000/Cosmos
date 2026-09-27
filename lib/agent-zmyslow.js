/* ============================================================
   Agent zmysłów – zmysły na komputerze KAŻDEJ osoby

   Do tej pory zmysły (Whisper, Piper, wykrywanie obiektów, poza, Kinect,
   wyciąganie tekstu, embeddingi) były jedne: na domowym GPU właściciela,
   pod SENSES_URL. Zaproszona osoba mogła najwyżej dostać do nich zgodę –
   i wtedy jej zdjęcia i nagrania liczył komputer Marcina.

   Teraz każda osoba może podłączyć SWÓJ komputer. Działa na nim
   `senses/service.py` (te same zmysły co u właściciela) i mały program
   `senses/agent.py`, który:
     – paruje się z Cosmosem 6-cyfrowym kodem z Ustawień,
     – sam łączy się z serwerem (połączenie WYCHODZĄCE: bez przekierowania
       portów, bez VPN-a, działa za każdym routerem),
     – odbiera zlecenia („rozpoznaj to nagranie”, „co jest na zdjęciu”),
       wykonuje je na lokalnej usłudze i odsyła wynik.

   Protokół to długie odpytywanie po HTTP (zero zależności, przechodzi przez
   Cloudflare): agent pyta GET /api/agent/czekaj, serwer trzyma odpowiedź do
   25 s albo do pierwszego zlecenia; wynik wraca POST /api/agent/wynik.

   Wszystkie wywołania zmysłów w serwerze idą przez `fetchZmyslow()`:
     1. osoba ma połączonego agenta → zlecenie do JEJ komputera,
     2. nie ma, ale ma zgodę na zmysły właściciela → SENSES_URL (jak dotąd),
     3. ani jedno, ani drugie → błąd „zmysły niedostępne”.
   Dzięki temu zasada „adres domu nie trafia do członka” i „bez zgody nie
   ma zmysłów właściciela” obowiązuje w jednym miejscu, nie w piętnastu.
   ============================================================ */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { KORZEN, DATA_DIR, SENSES_URL, zapiszAtomowo, czytajJson, sendJson, readBodyBuffer } = require('./rdzen.js');
const { kto } = require('./kontekst.js');
const silniki = require('./silniki.js');

const PLIK_AGENTOW = path.join(DATA_DIR, 'konta', 'agenci.json');
const KOD_WAZNY_MS = 10 * 60 * 1000;
/* Agent pyta co ≤25 s; po 45 s ciszy uznajemy go za rozłączonego i zmysły
   tej osoby wracają do drogi zapasowej (przeglądarka, chmura). */
const ONLINE_MS = 45 * 1000;
const CZEKAJ_MS = 25 * 1000;
/* Twardy sufit jednego zlecenia. Właściwy limit daje wołający przez `signal`
   (głos 60 s, transkrypcja do bazy wiedzy 10 min) – ten tylko sprząta, gdy
   wołający żadnego nie podał. */
const ZLECENIE_DOMYSLNIE_MS = 15 * 60 * 1000;

/* Składniki, które agent umie włączać i wyłączać na komputerze osoby –
   z przełączników w Ustawieniach, bez wiersza poleceń. */
const SKLADNIKI = ['zmysly', 'obserwator', 'kinect'];

/* Pliki, które agent pobiera z serwera (instalacja i „Aktualizuj”). Stała
   lista: agent nie przyjmie od serwera pliku o innej nazwie. */
const KATALOG_ZMYSLOW = path.join(KORZEN, 'senses');
const PLIKI_AGENTA = ['agent.py', 'service.py', 'watcher.py', 'kinect_watcher.py', 'kinect_win.py', 'requirements.txt'];
let manifestPamiec = null;
/** Nazwa, skrót i rozmiar każdego pliku agenta – agent porównuje i dociąga różnice. */
function manifestPlikow() {
  if (manifestPamiec && Date.now() - manifestPamiec.kiedy < 60000) return manifestPamiec.pliki;
  const pliki = [];
  for (const nazwa of PLIKI_AGENTA) {
    try {
      const buf = fs.readFileSync(path.join(KATALOG_ZMYSLOW, nazwa));
      pliki.push({ nazwa, sha256: crypto.createHash('sha256').update(buf).digest('hex'), rozmiar: buf.length });
    } catch { /* pliku nie ma w tej instalacji – agent go nie dostanie */ }
  }
  manifestPamiec = { kiedy: Date.now(), pliki };
  return pliki;
}
/** Wersja agenta = początek skrótu agent.py; różna od zgłoszonej → „Aktualizuj”. */
const wersjaAgenta = () => ((manifestPlikow().find((f) => f.nazwa === 'agent.py') || {}).sha256 || '').slice(0, 12);
const MAX_WYNIK_B = 40 * 1024 * 1024;

const skrot = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const losowy = (n = 32) => crypto.randomBytes(n).toString('base64url');

/* ---------------------------------------------------------------- stan --- */

// Na dysku tylko skróty tokenów – wyciek pliku nie daje nikomu działającego agenta.
let agenci = czytajJson(PLIK_AGENTOW, []);
function zapiszAgentow() {
  try {
    zapiszAtomowo(PLIK_AGENTOW, JSON.stringify(agenci, null, 2), { mode: 0o600, kopia: true });
  } catch (err) { console.error('Nie udało się zapisać listy agentów zmysłów:', err.message); }
}

const kody = new Map();          // skrót kodu → { uid, wygasa }
const zywe = new Map();          // id agenta → { ostatnio, caps, czekajacy: [res], kolejka: [zlecenie] }
const oczekujace = new Map();    // id zlecenia → { resolve, reject, timer, agentId }

function zywy(id) {
  let z = zywe.get(id);
  if (!z) { z = { ostatnio: 0, caps: {}, czekajacy: [], kolejka: [] }; zywe.set(id, z); }
  return z;
}

/** Połączony agent tej osoby (najświeższy) albo null. */
function agentOsoby(uid = (kto() || {}).id) {
  if (!uid) return null;
  const teraz = Date.now();
  let najlepszy = null;
  for (const a of agenci) {
    if (a.uid !== uid) continue;
    const z = zywe.get(a.id);
    if (z && teraz - z.ostatnio < ONLINE_MS && (!najlepszy || z.ostatnio > zywe.get(najlepszy.id).ostatnio)) najlepszy = a;
  }
  return najlepszy;
}

/** Skąd ta osoba ma teraz zmysły: 'agent' (swój komputer), 'dom' (zgoda na zmysły
 *  właściciela) albo '' (żadne). Bez osoby (praca serwera) – dom, jak dotąd. */
function zrodloZmyslow(u = kto()) {
  const a = u ? agentOsoby(u.id) : null;
  if (a && (zywe.get(a.id) || {}).online) return 'agent';
  if (SENSES_URL && silniki.zmyslyDozwolone(u)) return 'dom';
  // Komputer połączony, ale zmysły na nim wyłączone: dalej „agent”, żeby
  // komunikat mówił o własnym komputerze, a nie o komputerze właściciela.
  return a ? 'agent' : '';
}
const zmyslyDostepne = (u = kto()) => Boolean(zrodloZmyslow(u));

/* --------------------------------------------------------- fetchZmyslow --- */

/**
 * Zamiennik `fetch(`${SENSES_URL}${sciezka}`, init)` dla całego serwera.
 * Oddaje prawdziwy `Response`, więc wołający nie wie i nie musi wiedzieć,
 * czy odpowiedział komputer domowy właściciela, czy agent osoby.
 */
async function fetchZmyslow(sciezka, init = {}) {
  const u = kto();
  const zrodlo = zrodloZmyslow(u);
  if (zrodlo === 'dom') return fetch(`${SENSES_URL}${sciezka}`, init);
  if (zrodlo !== 'agent') {
    throw Object.assign(new Error('Zmysły są niedostępne dla tego konta.'), { kod: 'zmysly-niedostepne' });
  }
  const agent = agentOsoby(u.id);
  let cialo = '';
  if (init.body !== undefined && init.body !== null) {
    if (typeof init.body === 'string') cialo = Buffer.from(init.body).toString('base64');
    else if (Buffer.isBuffer(init.body) || init.body instanceof Uint8Array) cialo = Buffer.from(init.body).toString('base64');
    else if (init.body instanceof ArrayBuffer) cialo = Buffer.from(new Uint8Array(init.body)).toString('base64');
    else throw new Error('Agent zmysłów przyjmuje ciało jako tekst albo bajty.');
  }
  const naglowki = {};
  for (const [k, v] of Object.entries(init.headers || {})) if (/^content-type$/i.test(k)) naglowki['content-type'] = String(v);
  const zlecenie = { id: losowy(12), metoda: init.method || 'GET', sciezka, naglowki, cialo };
  return new Promise((resolve, reject) => {
    const koniec = (err) => { const o = oczekujace.get(zlecenie.id); if (!o) return; clearTimeout(o.timer); oczekujace.delete(zlecenie.id); reject(err); };
    const timer = setTimeout(() => koniec(Object.assign(new Error('Agent zmysłów nie odpowiedział na czas.'), { name: 'TimeoutError' })),
      ZLECENIE_DOMYSLNIE_MS);
    timer.unref?.();
    oczekujace.set(zlecenie.id, { resolve, reject, timer, agentId: agent.id });
    if (init.signal) {
      if (init.signal.aborted) return koniec(init.signal.reason || Object.assign(new Error('przerwane'), { name: 'AbortError' }));
      init.signal.addEventListener('abort', () => koniec(init.signal.reason || Object.assign(new Error('przerwane'), { name: 'AbortError' })), { once: true });
    }
    wyslijDoAgenta(agent.id, zlecenie);
  });
}

function wyslijDoAgenta(id, zlecenie) {
  const z = zywy(id);
  const res = z.czekajacy.shift();
  if (res) { oddajZlecenie(res, zlecenie); return; }
  z.kolejka.push(zlecenie);
}
function oddajZlecenie(res, zlecenie) {
  clearTimeout(res.__czas);
  sendJson(res, 200, { zadanie: zlecenie });
}

/* ---------------------------------------------------------- instalator --- */

/** Adres, pod którym komputer osoby widzi ten serwer – do skryptu instalacji.
 *  Za Cloudflare Tunnel przychodzi Host cosmosai.live i X-Forwarded-Proto: https. */
function adresSerwera(req) {
  if (process.env.COSMOS_PUBLIC_URL) return process.env.COSMOS_PUBLIC_URL.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return '';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return `${proto === 'https' || /https/.test(String(req.headers['cf-visitor'] || '')) ? 'https' : 'http'}://${host}`;
}

/* Skrypty bez polskich znaków: `irm | iex` w starym PowerShellu i terminale
   z inną stroną kodową psują diakrytyki, a tu każdy komunikat musi być czytelny. */
function skryptPowerShell(serwer, kod) {
  return `$ErrorActionPreference = 'Stop'
$serwer = '${serwer}'; $kod = '${kod}'
$kat = Join-Path $env:USERPROFILE '.cosmos'
New-Item -ItemType Directory -Force -Path $kat | Out-Null
Write-Host 'Cosmos: pobieram agenta zmyslow...'
Invoke-WebRequest -UseBasicParsing "$serwer/api/agent/agent.py" -OutFile (Join-Path $kat 'agent.py')
function Znajdz-Pythona {
  foreach ($k in @('py', 'python')) {
    if (Get-Command $k -ErrorAction SilentlyContinue) {
      & $k -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" 2>$null
      if ($LASTEXITCODE -eq 0) { return $k }
    }
  }
  return $null
}
$py = Znajdz-Pythona
if (-not $py) {
  Write-Host 'Cosmos: instaluje Pythona 3.12 (winget, tylko dla tego uzytkownika)...'
  winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $py = Znajdz-Pythona
  if (-not $py) { Write-Host 'Cosmos: nie udalo sie zainstalowac Pythona. Zainstaluj go z python.org i uruchom to polecenie ponownie.'; exit 1 }
}
& $py (Join-Path $kat 'agent.py') --serwer $serwer --kod $kod --autostart --w-tle
`;
}
function skryptSh(serwer, kod) {
  return `#!/bin/sh
set -e
SERWER='${serwer}'; KOD='${kod}'
KAT="$HOME/.cosmos"; mkdir -p "$KAT"
echo "Cosmos: pobieram agenta zmyslow..."
curl -fsSL "$SERWER/api/agent/agent.py" -o "$KAT/agent.py"
PY=$(command -v python3 || command -v python || true)
if [ -z "$PY" ]; then
  echo "Cosmos: potrzebny Python 3.9+ (Debian/Ubuntu: sudo apt install python3 python3-venv, macOS: brew install python)."
  exit 1
fi
"$PY" "$KAT/agent.py" --serwer "$SERWER" --kod "$KOD" --autostart --w-tle
`;
}

/* --------------------------------------------------------------- trasy --- */

function tokenAgenta(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}
/** Agent z tokenu w nagłówku albo null. */
function agentZTokenu(req) {
  const t = tokenAgenta(req);
  if (!t) return null;
  const s = skrot(t);
  return agenci.find((a) => a.skrot === s) || null;
}

function oddajPlik(res, nazwa) {
  if (!PLIKI_AGENTA.includes(nazwa)) return sendJson(res, 404, { error: 'Nie ma takiego pliku.' });
  let buf;
  try { buf = fs.readFileSync(path.join(KATALOG_ZMYSLOW, nazwa)); } catch { return sendJson(res, 404, { error: 'Nie ma takiego pliku.' }); }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(buf);
}

/** Ustawione przełącznikami: które składniki mają działać na tym komputerze. */
function chceAgenta(a) {
  const c = a.chce || {};
  return Object.fromEntries(SKLADNIKI.map((k) => [k, Boolean(c[k])]));
}

/** Polecenie sterujące do agenta – bez czekania na wynik (stan wróci w /stan). */
function sterujAgentem(id, polecenie) {
  wyslijDoAgenta(id, { id: losowy(12), sterowanie: true, ...polecenie });
}

/**
 * @param {object} z
 * @param {object} z.konta     lib/konta.js (limit prób, widok konta)
 * @param {Function} z.wKontekscie
 * @param {Function} z.addEvent  zdarzenie w imieniu osoby
 */
function utworzTrasy({ konta, wKontekscie, addEvent, stanDomu }) {
  const domOdpowiada = stanDomu || (async () => ({ online: true }));
  /** Trasy agenta – PRZED bramką logowania, z własnym tokenem. true = obsłużone. */
  async function publiczne(req, res, p) {
    if (p === '/api/agent/paruj' && req.method === 'POST') {
      const ip = konta.adresKlienta(req);
      if (konta.zablokowanyDo(`ip:${ip}`)) return sendJson(res, 429, { error: 'Za dużo prób. Spróbuj ponownie za kwadrans.', kod: 'za-duzo-prob' }), true;
      let d = {};
      try { d = JSON.parse((await readBodyBuffer(req, 16 * 1024)).toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }), true; }
      const kod = String(d.kod || '').replace(/\D/g, '');
      const wpis = kody.get(skrot(kod));
      if (!wpis || wpis.wygasa < Date.now()) {
        konta.zanotujPomylke(`ip:${ip}`);
        return sendJson(res, 404, { error: 'Nieznany albo przeterminowany kod. Wygeneruj nowy w Ustawieniach → Zmysły.', kod: 'zly-kod' }), true;
      }
      kody.delete(skrot(kod));
      const u = konta.znajdz(wpis.uid);
      if (!u) return sendJson(res, 404, { error: 'To konto już nie istnieje.' }), true;
      const token = losowy(32);
      const agent = { id: losowy(8), skrot: skrot(token), uid: u.id, nazwa: String(d.nazwa || 'komputer').trim().slice(0, 60), utworzono: Date.now() };
      agenci.push(agent);
      zapiszAgentow();
      return sendJson(res, 200, { ok: true, token, id: agent.id, osoba: u.nazwa || u.login }), true;
    }

    /* Instalacja jednym poleceniem. Skrypt nie niesie żadnego sekretu poza
       jednorazowym kodem, który i tak trzeba było przepisać z ekranu. */
    const inst = /^\/api\/agent\/instaluj\.(ps1|sh)$/.exec(p);
    if (inst && req.method === 'GET') {
      const kod = String(new URL(req.url, 'http://localhost').searchParams.get('kod') || '').replace(/\D/g, '').slice(0, 6);
      const serwer = adresSerwera(req);
      if (kod.length !== 6 || !serwer) return sendJson(res, 400, { error: 'Brak kodu albo adresu serwera.' }), true;
      const tresc = inst[1] === 'ps1' ? skryptPowerShell(serwer, kod) : skryptSh(serwer, kod);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(tresc);
      return true;
    }
    // Sam agent – potrzebny, zanim jest sparowany (instalator pobiera go przed kodem).
    if (p === '/api/agent/agent.py' && req.method === 'GET') {
      return oddajPlik(res, 'agent.py'), true;
    }

    const trasyAgenta = ['/api/agent/czekaj', '/api/agent/wynik', '/api/agent/stan', '/api/agent/zdarzenie', '/api/agent/pliki', '/api/agent/plik'];
    if (!trasyAgenta.includes(p)) return false;
    const agent = agentZTokenu(req);
    if (!agent) return sendJson(res, 401, { error: 'Nieznany agent – sparuj go ponownie kodem z Ustawień.', kod: 'agent-nieznany' }), true;
    const z = zywy(agent.id);
    z.ostatnio = Date.now();

    if (p === '/api/agent/czekaj' && req.method === 'GET') {
      const zlecenie = z.kolejka.shift();
      if (zlecenie) return oddajZlecenie(res, zlecenie), true;
      res.__czas = setTimeout(() => {
        z.czekajacy = z.czekajacy.filter((r) => r !== res);
        if (!res.headersSent) { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); }
      }, CZEKAJ_MS);
      res.on('close', () => { clearTimeout(res.__czas); z.czekajacy = z.czekajacy.filter((r) => r !== res); });
      z.czekajacy.push(res);
      return true;
    }
    if (p === '/api/agent/stan' && req.method === 'POST') {
      let d = {};
      try { d = JSON.parse((await readBodyBuffer(req, 64 * 1024)).toString('utf8') || '{}'); } catch { /* bez stanu */ }
      const obiekt = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
      z.caps = obiekt(d.caps);
      z.online = d.online === true;
      z.wersja = String(d.wersja || '').slice(0, 20);
      z.skladniki = obiekt(d.skladniki);
      z.pakiety = obiekt(d.pakiety);
      z.instalacja = d.instalacja ? obiekt(d.instalacja) : null;
      z.system = String(d.system || '').slice(0, 40);
      z.autostart = Boolean(d.autostart);
      // W odpowiedzi to, co osoba ustawiła przełącznikami – agent się do tego dostraja.
      return sendJson(res, 200, { ok: true, osoba: (konta.znajdz(agent.uid) || {}).nazwa || '', chce: chceAgenta(agent), wersja: wersjaAgenta() }), true;
    }
    if (p === '/api/agent/pliki' && req.method === 'GET') {
      return sendJson(res, 200, { pliki: manifestPlikow() }), true;
    }
    if (p === '/api/agent/plik' && req.method === 'GET') {
      return oddajPlik(res, new URL(req.url, 'http://localhost').searchParams.get('nazwa') || ''), true;
    }
    if (p === '/api/agent/wynik' && req.method === 'POST') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
      const o = oczekujace.get(id);
      let d = {};
      try { d = JSON.parse((await readBodyBuffer(req, MAX_WYNIK_B)).toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }), true; }
      // Wynik tylko od agenta, do którego zlecenie poszło – cudzy agent nie podrzuci odpowiedzi.
      if (!o || o.agentId !== agent.id) return sendJson(res, 404, { error: 'Nie ma takiego zlecenia (mogło wygasnąć).' }), true;
      clearTimeout(o.timer);
      oczekujace.delete(id);
      const cialo = Buffer.from(String(d.cialo || ''), 'base64');
      o.resolve(new Response(cialo, { status: Number(d.status) || 502, headers: { 'content-type': String(d.typ || 'application/octet-stream') } }));
      return sendJson(res, 200, { ok: true }), true;
    }
    if (p === '/api/agent/zdarzenie' && req.method === 'POST') {
      let d = {};
      try { d = JSON.parse((await readBodyBuffer(req, 64 * 1024)).toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }), true; }
      const u = konta.znajdz(agent.uid);
      if (!u) return sendJson(res, 404, { error: 'To konto już nie istnieje.' }), true;
      await wKontekscie(u, () => addEvent(String(d.typ || 'zmysly').slice(0, 40), String(d.tresc || '').slice(0, 2000)));
      return sendJson(res, 200, { ok: true }), true;
    }
    return false;
  }

  /** Trasy osoby zalogowanej (za bramką, w jej kontekście). */
  async function osoby(req, res, p) {
    const u = kto();
    if (p === '/api/agent/kod' && req.method === 'POST') {
      // Nowy kod unieważnia poprzedni tej osoby.
      for (const [k, v] of kody) if (v.uid === u.id) kody.delete(k);
      const kod = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const wygasa = Date.now() + KOD_WAZNY_MS;
      kody.set(skrot(kod), { uid: u.id, wygasa });
      return sendJson(res, 200, { kod, wygasa });
    }
    if (p === '/api/agent/lista' && req.method === 'GET') {
      const teraz = Date.now();
      return sendJson(res, 200, {
        agenci: agenci.filter((a) => a.uid === u.id).map((a) => {
          const z = zywe.get(a.id);
          const w = wersjaAgenta();
          return { id: a.id, nazwa: a.nazwa, utworzono: a.utworzono,
            online: Boolean(z && teraz - z.ostatnio < ONLINE_MS), ostatnio: z ? z.ostatnio || null : null,
            caps: z ? z.caps : {}, zmyslyDzialaja: Boolean(z && z.online),
            chce: chceAgenta(a), skladniki: (z && z.skladniki) || {}, pakiety: (z && z.pakiety) || {},
            instalacja: (z && z.instalacja) || null, system: (z && z.system) || '', autostart: Boolean(z && z.autostart),
            nieaktualny: Boolean(z && z.wersja && w && z.wersja !== w) };
        }),
        zrodlo: await (async () => {
          // „Dom” tylko wtedy, gdy komputer domowy naprawdę odpowiada – inaczej
          // zdanie w Ustawieniach obiecywałoby zmysły, których nie ma.
          const z = zrodloZmyslow(u);
          if (z !== 'dom') return z;
          const st = await Promise.resolve(domOdpowiada()).catch(() => ({ online: false }));
          return st && st.online ? 'dom' : '';
        })(),
      });
    }
    /* Przełączniki „Zmysły / Obserwator kamery / Kinect” w Ustawieniach.
       Zapisane na serwerze: agent po restarcie komputera wraca do nich sam. */
    if (p === '/api/agent/ustaw' && req.method === 'POST') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
      const a = agenci.find((x) => x.id === id && x.uid === u.id);
      if (!a) return sendJson(res, 404, { error: 'Nie ma takiego komputera.' });
      let d = {};
      try { d = JSON.parse((await readBodyBuffer(req, 16 * 1024)).toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const chce = { ...chceAgenta(a) };
      for (const k of SKLADNIKI) if (typeof (d.chce || {})[k] === 'boolean') chce[k] = d.chce[k];
      a.chce = chce;
      zapiszAgentow();
      sterujAgentem(a.id, { polecenie: 'uzgodnij', chce });
      return sendJson(res, 200, { ok: true, chce });
    }
    /* Instalacja pakietów, aktualizacja plików, autostart – jednym kliknięciem.
       Agent przyjmuje tylko nazwy ze swojej listy; dowolnego polecenia nie wykona. */
    if (p === '/api/agent/polecenie' && req.method === 'POST') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
      const a = agenci.find((x) => x.id === id && x.uid === u.id);
      if (!a) return sendJson(res, 404, { error: 'Nie ma takiego komputera.' });
      let d = {};
      try { d = JSON.parse((await readBodyBuffer(req, 16 * 1024)).toString('utf8') || '{}'); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const polecenie = String(d.polecenie || '');
      if (!['instaluj', 'aktualizuj', 'autostart'].includes(polecenie)) return sendJson(res, 400, { error: 'Nieznane polecenie.' });
      const pakiety = (Array.isArray(d.pakiety) ? d.pakiety : []).map((x) => String(x).replace(/[^a-z]/g, '')).filter(Boolean).slice(0, 12);
      sterujAgentem(a.id, { polecenie, pakiety, wlacz: d.wlacz !== false });
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/agent' && req.method === 'DELETE') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
      const przed = agenci.length;
      agenci = agenci.filter((a) => !(a.id === id && a.uid === u.id));
      if (agenci.length === przed) return sendJson(res, 404, { error: 'Nie ma takiego komputera.' });
      zapiszAgentow();
      const z = zywe.get(id);
      if (z) { for (const r of z.czekajacy) { try { r.writeHead(410); r.end(); } catch { /* zamknięte */ } } zywe.delete(id); }
      return sendJson(res, 200, { ok: true });
    }
    return null;
  }

  return { publiczne, osoby };
}

/** Osoba, której agent wysłał to żądanie – dla /api/events (obserwator kamery
 *  na komputerze osoby z tokenem agenta zamiast COSMOS_API_TOKEN). */
function osobaAgenta(req) {
  const a = agentZTokenu(req);
  return a ? a.uid : null;
}
/** Jak wyżej, ale tylko dla POST /api/events – jedynej trasy za bramką, na
 *  którą wolno wejść tokenem agenta (obserwator kamery na komputerze osoby). */
function osobaAgentaZdarzen(req, p) {
  return p === '/api/events' && req.method === 'POST' ? osobaAgenta(req) : null;
}

/** Stan zmysłów osoby (do /api/status i wyboru dróg w głosie). */
function stanAgenta(uid = (kto() || {}).id) {
  const a = agentOsoby(uid);
  if (!a) return null;
  const z = zywe.get(a.id);
  return { online: Boolean(z && z.online), caps: (z && z.caps) || {}, agent: a.nazwa };
}

module.exports = {
  fetchZmyslow, zrodloZmyslow, zmyslyDostepne, agentOsoby, stanAgenta, osobaAgenta, osobaAgentaZdarzen, utworzTrasy,
  adresSerwera, PLIKI_AGENTA, SKLADNIKI,
  _reset: () => { agenci = []; kody.clear(); zywe.clear(); oczekujace.clear(); },
};

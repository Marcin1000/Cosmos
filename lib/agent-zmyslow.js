/* ============================================================
   Agent zmysłów – zmysły na komputerze KAŻDEJ osoby

   Do tej pory zmysły (Whisper, Piper, wykrywanie obiektów, poza, Kinect,
   wyciąganie tekstu, embeddingi) były jedne: na domowym GPU właściciela,
   pod SENSES_URL. Zaproszona osoba mogła najwyżej dostać do nich zgodę –
   i wtedy jej zdjęcia i nagrania liczył komputer Marcina.

   Teraz każda osoba może podłączyć SWÓJ komputer. Działa na nim
   `senses/service.py` (te same zmysły co u właściciela) i mały program
   `senses/agent.py`, który:
     – łączy się z kontem kodem z Ustawień (6 cyfr do przepisania albo długi
       kod wklejony w poleceniu instalacji),
     – sam łączy się z serwerem (połączenie WYCHODZĄCE: bez przekierowania
       portów, bez VPN-a, działa za każdym routerem),
     – odbiera zlecenia („rozpoznaj to nagranie”, „co jest na zdjęciu”),
       wykonuje je na lokalnej usłudze i odsyła wynik.

   Protokół (długie odpytywanie po HTTP, zero zależności, przechodzi przez
   Cloudflare):
     1. GET  /api/agent/czekaj   – serwer trzyma odpowiedź do 25 s albo do
        pierwszego zlecenia; oddaje SAME METADANE zlecenia,
     2. GET  /api/agent/cialo    – agent pobiera ciało surowymi bajtami; to
        jest jednocześnie POTWIERDZENIE ODBIORU,
     3. POST /api/agent/wynik    – wynik surowym ciałem, status w X-Status.
   Dawniej ciało jechało base64 w JSON-ie w obie strony: kodowanie 100 MB
   stawiało pętlę zdarzeń na 4 s dla wszystkich osób (zespół IT, runda 6).

   Uśpiony laptop nie zamyka połączenia TCP, więc serwer pisał zlecenie
   w próżnię i osoba czekała na głos 61 s. Teraz zlecenie, którego agent nie
   odebrał w ODBIOR_MS, kończy się od razu błędem, agent zostaje uznany za
   uśpionego, a zmysły tej osoby schodzą na drogę zapasową.

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
/* Ile agent ma na odebranie zlecenia. Zdrowy odbiera w milisekundach; brak
   odbioru znaczy „śpi albo zgubił sieć” – lepiej od razu przejść na chmurę,
   niż kazać osobie czekać minutę w trybie głosowym. */
const ODBIOR_MS = 4000;
/* Agent zawsze ma otwarte /czekaj (wraca po każdej odpowiedzi w ułamku
   sekundy). Dłuższa przerwa bez żadnego otwartego = agent nie słucha. */
const BEZ_CZEKANIA_MS = 8000;
/* Twardy sufit jednego zlecenia. Właściwy limit daje wołający przez `signal`
   (głos 60 s, transkrypcja do bazy wiedzy 10 min) – ten tylko sprząta, gdy
   wołający żadnego nie podał. */
const ZLECENIE_DOMYSLNIE_MS = 15 * 60 * 1000;
const MAX_CIALO_B = 32 * 1024 * 1024;
const MAX_WYNIK_B = 48 * 1024 * 1024;
const MAX_KOMPUTEROW = 5;
/* Zgadywanie kodu: licznik z jednego adresu (5 pomyłek) nie wystarcza –
   każda sieć /64 ma osobny licznik, a 6 cyfr przechodzi się w kwadrans
   (zespół IT, runda 6). Stąd też licznik na cały serwer. */
const POMYLKI_GLOBALNIE = 30;
const OKNO_POMYLEK_MS = 10 * 60 * 1000;

/* Składniki, które agent umie włączać i wyłączać na komputerze osoby –
   z przełączników w Ustawieniach, bez wiersza poleceń. */
const SKLADNIKI = ['zmysly', 'obserwator', 'kinect'];

/* Pliki, które agent pobiera z serwera (instalacja i „Aktualizuj”). Stała
   lista: agent nie przyjmie od serwera pliku o innej nazwie. */
const KATALOG_ZMYSLOW = path.join(KORZEN, 'senses');
const PLIKI_AGENTA = ['agent.py', 'service.py', 'watcher.py', 'kinect_watcher.py', 'kinect_win.py', 'kinect_usluga.py', 'requirements.txt'];
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

const skrot = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const losowy = (n = 32) => crypto.randomBytes(n).toString('base64url');
const blad = (tekst, pola) => Object.assign(new Error(tekst), pola);

/* ---------------------------------------------------------------- stan --- */

/* Na dysku tylko skróty tokenów – wyciek pliku nie daje nikomu działającego
   agenta. Odłączony komputer zostaje jako „nagrobek” (odlaczony: true), żeby
   jego agent dostał 410 i sprzątnął po sobie autostart, a nie próbował się
   łączyć przy każdym starcie systemu. */
let agenci = czytajJson(PLIK_AGENTOW, []);
/** Zapis listy. Zwraca błąd (null = zapisane) – trasa nie odpowiada „ok”
 *  po nieudanym zapisie (zasada z CLAUDE.md). */
function zapiszAgentow() {
  const miesiac = Date.now() - 30 * 24 * 3600 * 1000;
  agenci = agenci.filter((a) => !a.odlaczony || (a.odlaczony > miesiac));
  try {
    zapiszAtomowo(PLIK_AGENTOW, JSON.stringify(agenci, null, 2), { mode: 0o600, kopia: true });
    return null;
  } catch (err) {
    console.error('Nie udało się zapisać listy agentów zmysłów:', err.message);
    return err;
  }
}
const aktywni = () => agenci.filter((a) => !a.odlaczony);

const kody = new Map();          // skrót kodu → { uid, wygasa, klucze }
const zywe = new Map();          // id agenta → { ostatnio, caps, czekajacy: [res], kolejka: [zlecenie] }
const oczekujace = new Map();    // id zlecenia → { resolve, reject, agentId, zlecenie, sprzatnij }
let kontaRef = null;             // lib/konta.js – ustawiane przez utworzTrasy
let pomylki = { n: 0, od: 0 };
let blokadaParowania = 0;

function zywy(id) {
  let z = zywe.get(id);
  if (!z) { z = { ostatnio: 0, caps: {}, czekajacy: [], kolejka: [], bezCzekaniaOd: 0, uspiony: 0 }; zywe.set(id, z); }
  return z;
}

/** Czy agent teraz naprawdę słucha: niedawno się odezwał, nie przegapił
 *  zlecenia i ma otwarte /czekaj (albo zamknął je przed chwilą). */
function slucha(z, teraz = Date.now()) {
  if (!z || teraz - z.ostatnio >= ONLINE_MS || z.uspiony) return false;
  return z.czekajacy.length > 0 || !z.bezCzekaniaOd || teraz - z.bezCzekaniaOd < BEZ_CZEKANIA_MS;
}

/** Połączony agent tej osoby albo null. Pierwszeństwo ma komputer, na którym
 *  zmysły DZIAŁAJĄ – dawniej wygrywał ten, który odezwał się ostatni, więc
 *  drugi laptop z wyłączonymi zmysłami odbierał zlecenia (zespół IT, runda 6). */
function agentOsoby(uid = (kto() || {}).id) {
  if (!uid) return null;
  const teraz = Date.now();
  let najlepszy = null;
  let ocena = -1;
  for (const a of aktywni()) {
    if (a.uid !== uid) continue;
    const z = zywe.get(a.id);
    if (!slucha(z, teraz)) continue;
    const o = (z.online ? 2e13 : 0) + z.ostatnio;
    if (o > ocena) { ocena = o; najlepszy = a; }
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

function doBufora(body) {
  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  throw new Error('Agent zmysłów przyjmuje ciało jako tekst albo bajty.');
}

/**
 * Zamiennik `fetch(`${SENSES_URL}${sciezka}`, init)` dla całego serwera.
 * Oddaje prawdziwy `Response`, więc wołający nie wie i nie musi wiedzieć,
 * czy odpowiedział komputer domowy właściciela, czy agent osoby.
 */
async function fetchZmyslow(sciezka, init = {}) {
  const u = kto();
  const zrodlo = zrodloZmyslow(u);
  if (zrodlo === 'dom') return fetch(`${SENSES_URL}${sciezka}`, init);
  if (zrodlo !== 'agent') throw blad('Zmysły są niedostępne dla tego konta.', { kod: 'zmysly-niedostepne' });
  const agent = agentOsoby(u.id);
  const cialo = doBufora(init.body);
  if (cialo && cialo.length > MAX_CIALO_B) throw blad('Plik jest za duży dla zmysłów (limit 32 MB).', { kod: 'za-duze' });
  const naglowki = {};
  for (const [k, v] of Object.entries(init.headers || {})) if (/^content-type$/i.test(k)) naglowki['content-type'] = String(v);
  const zlecenie = { id: losowy(12), metoda: init.method || 'GET', sciezka, naglowki, cialo };

  return new Promise((resolve, reject) => {
    const sygnal = init.signal;
    let timer = null;
    let odbior = null;
    const przerwij = () => koniec(sygnal.reason || blad('przerwane', { name: 'AbortError' }));
    /* Sprzątanie w JEDNYM miejscu: słuchacz sygnału trzymał domknięcie
       z ciałem zlecenia, więc nagranie wisiało w pamięci do końca limitu
       wołającego – 10 minut po skończonej transkrypcji (zespół IT, runda 6). */
    const sprzatnij = () => {
      clearTimeout(timer); clearTimeout(odbior);
      if (sygnal) sygnal.removeEventListener('abort', przerwij);
      oczekujace.delete(zlecenie.id);
      const z = zywe.get(agent.id);
      if (z) z.kolejka = z.kolejka.filter((x) => x.id !== zlecenie.id);
      zlecenie.cialo = null;
    };
    function koniec(err) {
      if (!oczekujace.has(zlecenie.id)) return;
      sprzatnij();
      reject(err);
    }
    timer = setTimeout(() => koniec(blad('Agent zmysłów nie odpowiedział na czas.', { name: 'TimeoutError' })), ZLECENIE_DOMYSLNIE_MS);
    odbior = setTimeout(() => {
      const o = oczekujace.get(zlecenie.id);
      if (!o || o.odebrane) return;
      zywy(agent.id).uspiony = Date.now();
      koniec(blad('Twój komputer ze zmysłami nie odebrał zlecenia – śpi albo nie ma sieci.', { name: 'TimeoutError', kod: 'agent-uspiony' }));
    }, ODBIOR_MS);
    timer.unref?.(); odbior.unref?.();
    oczekujace.set(zlecenie.id, { resolve, reject, agentId: agent.id, zlecenie, sprzatnij, odebrane: false });
    if (sygnal) {
      if (sygnal.aborted) return przerwij();
      sygnal.addEventListener('abort', przerwij, { once: true });
    }
    wyslijDoAgenta(agent.id, zlecenie);
  });
}

/** Metadane zlecenia dla agenta – ciało pobiera osobno (/cialo). */
function naglowekZlecenia(z) {
  const { cialo, ...reszta } = z;
  return { ...reszta, dlugosc: cialo ? cialo.length : 0 };
}

function wyslijDoAgenta(id, zlecenie) {
  const z = zywy(id);
  // Gniazdo, które już się zamknęło, nie dostanie zlecenia – przepadłoby.
  while (z.czekajacy.length) {
    const res = z.czekajacy.shift();
    if (res.destroyed || res.writableEnded || res.headersSent) continue;
    oddajZlecenie(res, zlecenie);
    return;
  }
  z.kolejka.push(zlecenie);
}
function oddajZlecenie(res, zlecenie) {
  clearTimeout(res.__czas);
  sendJson(res, 200, { zadanie: naglowekZlecenia(zlecenie) });
}

/** Ile zleceń zmysłów jest teraz w drodze – restart serwera na nie czeka. */
const ileZlecen = () => oczekujace.size;

/** Odrzuć wszystko, co czeka na tego agenta (restart agenta, odłączenie). */
function odrzucZleceniaAgenta(id, err) {
  for (const o of [...oczekujace.values()]) {
    if (o.agentId !== id) continue;
    o.sprzatnij();
    o.reject(err);
  }
}

/* ---------------------------------------------------------- instalator --- */

/** Adres, pod którym komputer osoby widzi ten serwer – do skryptu instalacji.
 *  Za Cloudflare Tunnel przychodzi Host cosmosai.live i X-Forwarded-Proto: https.
 *  X-Forwarded-Host tylko za pośrednikiem, który go ustawia (COSMOS_POSREDNIK=inny)
 *  – inaczej każdy mógłby wygenerować skrypt pobierający agenta z obcego serwera. */
function adresSerwera(req) {
  if (process.env.COSMOS_PUBLIC_URL) return process.env.COSMOS_PUBLIC_URL.replace(/\/+$/, '');
  const zPosrednika = process.env.COSMOS_POSREDNIK === 'inny' ? req.headers['x-forwarded-host'] : '';
  const host = String(zPosrednika || req.headers.host || '').split(',')[0].trim();
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return '';
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return `${proto === 'https' || /https/.test(String(req.headers['cf-visitor'] || '')) ? 'https' : 'http'}://${host}`;
}

/* Skrypty bez polskich znaków: `irm | iex` w starym PowerShellu i terminale
   z inną stroną kodową psują diakrytyki, a tu każdy komunikat musi być czytelny.

   PowerShell: całość w bloku `& { }`, żeby ustawienia nie zostały w sesji
   osoby; `return` zamiast `exit` (exit wewnątrz iex zamyka okno razem
   z komunikatem); zaślepka `python` ze Sklepu Microsoft (WindowsApps) nie
   jest Pythonem; winget bywa nieobecny (LTSC, stary Windows 10); instalator
   Pythona nie zawsze dopisuje się do PATH. */
function skryptPowerShell(serwer, kod) {
  return `& {
$serwer = '${serwer}'; $kod = '${kod}'
$kat = Join-Path $env:USERPROFILE '.cosmos'
New-Item -ItemType Directory -Force -Path $kat | Out-Null
Write-Host 'Cosmos: pobieram agenta zmyslow...'
try { Invoke-WebRequest -UseBasicParsing "$serwer/api/agent/agent.py" -OutFile (Join-Path $kat 'agent.py') }
catch { Write-Host "Cosmos: nie udalo sie pobrac agenta z $serwer. Sprawdz internet i sprobuj ponownie."; return }
function Znajdz-Pythona {
  $kandydaci = @()
  foreach ($k in @('py', 'python', 'python3')) {
    $c = Get-Command $k -ErrorAction SilentlyContinue
    if ($c -and $c.Source -notlike '*\\WindowsApps\\*') { $kandydaci += $c.Source }
  }
  $kandydaci += @(Get-ChildItem "$env:LOCALAPPDATA\\Programs\\Python\\Python3*\\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object { $_.FullName })
  foreach ($p in $kandydaci) {
    try {
      $w = & $p -c "import sys; print(1 if sys.version_info >= (3, 9) else 0)" 2>$null
      if ("$w".Trim() -eq '1') { return $p }
    } catch { }
  }
  return $null
}
$py = Znajdz-Pythona
if (-not $py) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host 'Cosmos: potrzebny Python 3.9 lub nowszy. Pobierz go z https://www.python.org/downloads/ (zaznacz "Add python.exe to PATH") i wklej to polecenie jeszcze raz.'
    return
  }
  Write-Host 'Cosmos: instaluje Pythona 3.12 (winget, tylko dla tego uzytkownika, to potrwa minute)...'
  try { winget install -e --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Null } catch { }
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $py = Znajdz-Pythona
  if (-not $py) { Write-Host 'Cosmos: nie udalo sie zainstalowac Pythona. Pobierz go z https://www.python.org/downloads/ i wklej to polecenie jeszcze raz.'; return }
}
& $py (Join-Path $kat 'agent.py') --serwer $serwer --kod $kod --autostart --w-tle
}
`;
}
/* sh: macOS bez narzędzi Xcode ma w /usr/bin/python3 atrapę, która zamiast
   Pythona otwiera okno instalacji – sprawdzamy, czy python naprawdę działa. */
function skryptSh(serwer, kod) {
  return `#!/bin/sh
SERWER='${serwer}'; KOD='${kod}'
KAT="$HOME/.cosmos"; mkdir -p "$KAT"
echo "Cosmos: pobieram agenta zmyslow..."
if ! curl -fsSL "$SERWER/api/agent/agent.py" -o "$KAT/agent.py"; then
  echo "Cosmos: nie udalo sie pobrac agenta z $SERWER. Sprawdz internet i sprobuj ponownie."
  exit 1
fi
PY=""
for k in python3 python; do
  if command -v "$k" >/dev/null 2>&1 && "$k" -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >/dev/null 2>&1; then PY="$k"; break; fi
done
if [ -z "$PY" ]; then
  echo "Cosmos: potrzebny Python 3.9 lub nowszy."
  echo "  macOS: pobierz go z https://www.python.org/downloads/"
  echo "  Debian/Ubuntu: sudo apt install python3 python3-venv"
  echo "Potem wklej to polecenie jeszcze raz."
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
/** Wpis agenta z tokenu w nagłówku (także nagrobek) albo null. */
function wpisZTokenu(req) {
  const t = tokenAgenta(req);
  if (!t) return null;
  const s = skrot(t);
  return agenci.find((a) => a.skrot === s) || null;
}
/** Czy ten wpis jeszcze coś może: nie odłączony i konto dalej istnieje. */
function zywyWpis(a) {
  return Boolean(a && !a.odlaczony && (!kontaRef || kontaRef.znajdz(a.uid)));
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
  wyslijDoAgenta(id, { id: losowy(12), sterowanie: true, ...polecenie, cialo: null });
}

/** Status i typ od agenta tak, żeby `new Response` nie rzucił – wyjątek
 *  zostawiał żądanie osoby bez odpowiedzi na zawsze (zespół IT, runda 6). */
function bezpiecznaOdpowiedz(status, typ, cialo) {
  let s = Number(status);
  if (!Number.isInteger(s) || s < 200 || s > 599) s = 502;
  const t = /^[\x20-\x7e]{1,200}$/.test(String(typ || '')) ? String(typ) : 'application/octet-stream';
  const bezCiala = s === 204 || s === 205 || s === 304;
  return new Response(bezCiala ? null : cialo, { status: s, headers: { 'content-type': t } });
}

/**
 * @param {object} z
 * @param {object} z.konta     lib/konta.js (limit prób, widok konta)
 * @param {Function} z.wKontekscie
 * @param {Function} z.addEvent  zdarzenie w imieniu osoby
 * @param {Function} [z.stanDomu] czy komputer domowy (SENSES_URL) odpowiada
 */
function utworzTrasy({ konta, wKontekscie, addEvent, stanDomu }) {
  kontaRef = konta;
  const domOdpowiada = stanDomu || (async () => ({ online: true }));
  const nieZapisane = (res) => sendJson(res, 507, { error: 'Serwer nie mógł zapisać zmian (brak miejsca na dysku). Spróbuj za chwilę.', kod: 'zapis' });

  async function czytajJsonAgenta(req, limit) {
    return JSON.parse((await readBodyBuffer(req, limit)).toString('utf8') || '{}');
  }

  /** Trasy agenta – PRZED bramką logowania, z własnym tokenem. true = obsłużone. */
  async function publiczne(req, res, p) {
    const q = new URL(req.url, 'http://localhost').searchParams;

    if (p === '/api/agent/paruj' && req.method === 'POST') {
      const ip = konta.adresKlienta(req);
      const teraz = Date.now();
      if (blokadaParowania > teraz || konta.zablokowanyDo(`paruj:${ip}`)) {
        return sendJson(res, 429, { error: 'Za dużo prób. Wygeneruj nowy kod w Ustawieniach → Zmysły za kwadrans.', kod: 'za-duzo-prob' }), true;
      }
      let d = {};
      try { d = await czytajJsonAgenta(req, 16 * 1024); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }), true; }
      const kod = String(d.kod || '').trim();
      const wpis = /^[A-Za-z0-9_-]{6,40}$/.test(kod) ? kody.get(skrot(kod)) : null;
      if (!wpis || wpis.wygasa < teraz) {
        konta.zanotujPomylke(`paruj:${ip}`);
        if (teraz - pomylki.od > OKNO_POMYLEK_MS) pomylki = { n: 0, od: teraz };
        if (++pomylki.n >= POMYLKI_GLOBALNIE) {
          // Ktoś zgaduje z wielu adresów: wszystkie aktywne kody tracą ważność.
          kody.clear();
          blokadaParowania = teraz + OKNO_POMYLEK_MS;
          pomylki = { n: 0, od: teraz };
          console.warn('Agent zmysłów: za dużo błędnych kodów – parowanie wstrzymane na 10 minut.');
        }
        return sendJson(res, 404, { error: 'Nieznany albo przeterminowany kod. Wygeneruj nowy w Ustawieniach → Zmysły.', kod: 'zly-kod' }), true;
      }
      const u = konta.znajdz(wpis.uid);
      if (!u) return sendJson(res, 404, { error: 'To konto już nie istnieje.' }), true;
      const nazwa = String(d.nazwa || 'komputer').trim().slice(0, 60) || 'komputer';
      const token = losowy(32);
      // Ponowne polecenie instalacji na tym samym komputerze: podmieniamy
      // token w istniejącym wpisie zamiast dopisywać „ducha” na liście.
      const stary = d.poprzedni ? aktywni().find((a) => a.skrot === skrot(d.poprzedni) && a.uid === u.id) : null;
      if (!stary && aktywni().filter((a) => a.uid === u.id).length >= MAX_KOMPUTEROW) {
        return sendJson(res, 409, { error: `Możesz podłączyć najwyżej ${MAX_KOMPUTEROW} komputerów. Odłącz któryś w Ustawieniach → Zmysły.`, kod: 'limit-komputerow' }), true;
      }
      let agent;
      const kopia = JSON.stringify(agenci);
      if (stary) {
        stary.skrot = skrot(token); stary.nazwa = nazwa;
        agent = stary;
        odrzucZleceniaAgenta(stary.id, blad('Komputer połączył się od nowa.', { kod: 'agent-restart' }));
      } else {
        agent = { id: losowy(8), skrot: skrot(token), uid: u.id, nazwa, utworzono: teraz };
        agenci.push(agent);
      }
      if (zapiszAgentow()) { agenci = JSON.parse(kopia); return nieZapisane(res), true; }
      // Kod zużyty dopiero po udanym zapisie – przy pełnym dysku można spróbować jeszcze raz.
      for (const k of wpis.klucze) kody.delete(k);
      // Ślad na osi czasu osoby: podłączenie komputera, którego nie rozpoznaje, od razu widać.
      try { await wKontekscie(u, () => addEvent('agent', `podłączono komputer ze zmysłami: ${nazwa}`)); } catch { /* ślad nie może zablokować parowania */ }
      return sendJson(res, 200, { ok: true, token, id: agent.id, osoba: u.nazwa || u.login }), true;
    }

    /* Instalacja jednym poleceniem. Skrypt nie niesie żadnego sekretu poza
       jednorazowym kodem – długim, żeby nie dało się go zgadnąć. */
    const inst = /^\/api\/agent\/instaluj\.(ps1|sh)$/.exec(p);
    if (inst && req.method === 'GET') {
      const kod = String(q.get('kod') || '');
      const serwer = adresSerwera(req);
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(kod) || !serwer) return sendJson(res, 400, { error: 'Brak kodu albo adresu serwera.' }), true;
      const tresc = inst[1] === 'ps1' ? skryptPowerShell(serwer, kod) : skryptSh(serwer, kod);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(tresc);
      return true;
    }
    // Sam agent – potrzebny, zanim jest sparowany (instalator pobiera go przed kodem).
    if (p === '/api/agent/agent.py' && req.method === 'GET') {
      return oddajPlik(res, 'agent.py'), true;
    }

    const trasyAgenta = ['/api/agent/czekaj', '/api/agent/cialo', '/api/agent/wynik', '/api/agent/stan',
      '/api/agent/zdarzenie', '/api/agent/pliki', '/api/agent/plik'];
    if (!trasyAgenta.includes(p)) return false;
    const agent = wpisZTokenu(req);
    if (!agent) return sendJson(res, 401, { error: 'Nieznany agent – podłącz ten komputer ponownie kodem z Ustawień.', kod: 'agent-nieznany' }), true;
    // Odłączony w aplikacji albo konto usunięte: 410 – agent sprząta autostart i kończy.
    if (!zywyWpis(agent)) return sendJson(res, 410, { error: 'Ten komputer został odłączony od Cosmosa.', kod: 'agent-odlaczony' }), true;
    const z = zywy(agent.id);
    z.ostatnio = Date.now();
    z.uspiony = 0;
    /* Nowa sesja agenta (restart programu albo komputera): zlecenia wysłane
       poprzedniej już nie wrócą – odrzucamy je od razu zamiast czekać
       do końca limitu, a transkrypcja w tle może spróbować ponownie. */
    const sesja = String(req.headers['x-sesja'] || '').slice(0, 64);
    if (sesja && z.sesja && sesja !== z.sesja) {
      odrzucZleceniaAgenta(agent.id, blad('Komputer ze zmysłami uruchomił się ponownie.', { kod: 'agent-restart' }));
      z.kolejka = z.kolejka.filter((x) => x.sterowanie);
    }
    if (sesja) z.sesja = sesja;

    if (p === '/api/agent/czekaj' && req.method === 'GET') {
      // Zlecenia, na które nikt już nie czeka, nie jadą do agenta.
      while (z.kolejka.length) {
        const zl = z.kolejka.shift();
        if (zl.sterowanie || oczekujace.has(zl.id)) return oddajZlecenie(res, zl), true;
      }
      // Najwyżej dwa otwarte odpytania na agenta – nadmiarowe kończymy.
      while (z.czekajacy.length >= 2) {
        const r = z.czekajacy.shift();
        clearTimeout(r.__czas);
        if (!r.headersSent) { r.writeHead(204, { 'Cache-Control': 'no-store' }); r.end(); }
      }
      res.__czas = setTimeout(() => {
        z.czekajacy = z.czekajacy.filter((r) => r !== res);
        if (!res.headersSent) { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); }
      }, CZEKAJ_MS);
      res.on('close', () => {
        clearTimeout(res.__czas);
        z.czekajacy = z.czekajacy.filter((r) => r !== res);
        if (!z.czekajacy.length) z.bezCzekaniaOd = Date.now();
      });
      z.czekajacy.push(res);
      z.bezCzekaniaOd = 0;
      return true;
    }
    if (p === '/api/agent/cialo' && req.method === 'GET') {
      const o = oczekujace.get(q.get('id') || '');
      if (!o || o.agentId !== agent.id) return sendJson(res, 404, { error: 'Nie ma takiego zlecenia (mogło wygasnąć).' }), true;
      o.odebrane = true;
      const cialo = o.zlecenie.cialo || Buffer.alloc(0);
      o.zlecenie.cialo = null;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': cialo.length, 'Cache-Control': 'no-store' });
      res.end(cialo);
      return true;
    }
    if (p === '/api/agent/stan' && req.method === 'POST') {
      let d = {};
      try { d = await czytajJsonAgenta(req, 64 * 1024); } catch { /* bez stanu */ }
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
      return oddajPlik(res, q.get('nazwa') || ''), true;
    }
    if (p === '/api/agent/wynik' && req.method === 'POST') {
      const o = oczekujace.get(q.get('id') || '');
      /* Najpierw: czy to zlecenie istnieje i jest TEGO agenta. Dopiero potem
         czytamy ciało – dawniej 40 MB wczytywało się, żeby usłyszeć 404,
         a kilka takich żądań zapychało pamięć serwera (zespół IT, runda 6). */
      if (!o || o.agentId !== agent.id) {
        req.resume();
        return sendJson(res, 404, { error: 'Nie ma takiego zlecenia (mogło wygasnąć).' }), true;
      }
      const zaDuzy = () => {
        o.sprzatnij();
        o.reject(blad('Wynik ze zmysłów jest za duży, żeby go przesłać (limit 48 MB).', { kod: 'wynik-za-duzy' }));
      };
      if (Number(req.headers['content-length'] || 0) > MAX_WYNIK_B) {
        zaDuzy(); req.resume();
        return sendJson(res, 413, { error: 'Wynik za duży.' }), true;
      }
      let cialo;
      try { cialo = await readBodyBuffer(req, MAX_WYNIK_B); } catch {
        zaDuzy();
        return true;   // gniazdo już zamknięte przez readBodyBuffer
      }
      if (!oczekujace.has(o.zlecenie.id)) return sendJson(res, 404, { error: 'Zlecenie wygasło w trakcie.' }), true;
      o.sprzatnij();
      try { o.resolve(bezpiecznaOdpowiedz(req.headers['x-status'], req.headers['content-type'], cialo)); }
      catch (err) { o.reject(err); }
      return sendJson(res, 200, { ok: true }), true;
    }
    if (p === '/api/agent/zdarzenie' && req.method === 'POST') {
      let d = {};
      try { d = await czytajJsonAgenta(req, 64 * 1024); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }), true; }
      const u = konta.znajdz(agent.uid);
      await wKontekscie(u, () => addEvent(String(d.typ || 'zmysly').slice(0, 40), String(d.tresc || '').slice(0, 2000)));
      return sendJson(res, 200, { ok: true }), true;
    }
    return false;
  }

  /** Trasy osoby zalogowanej (za bramką, w jej kontekście). */
  async function osoby(req, res, p) {
    const u = kto();
    const q = new URL(req.url, 'http://localhost').searchParams;
    const moj = () => aktywni().find((x) => x.id === (q.get('id') || '') && x.uid === u.id);

    if (p === '/api/agent/kod' && req.method === 'POST') {
      // Nowy kod unieważnia poprzedni tej osoby.
      for (const [k, v] of kody) if (v.uid === u.id) kody.delete(k);
      /* Dwa klucze do tego samego wpisu: 6 cyfr do przepisania ręcznie
         i długi kod w poleceniu instalacji, którego nie da się zgadnąć. */
      const kod = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const dlugi = losowy(16);
      const wygasa = Date.now() + KOD_WAZNY_MS;
      const wpis = { uid: u.id, wygasa, klucze: [skrot(kod), skrot(dlugi)] };
      for (const k of wpis.klucze) kody.set(k, wpis);
      return sendJson(res, 200, { kod, dlugi, wygasa });
    }
    if (p === '/api/agent/lista' && req.method === 'GET') {
      const teraz = Date.now();
      const w = wersjaAgenta();
      return sendJson(res, 200, {
        agenci: aktywni().filter((a) => a.uid === u.id).map((a) => {
          const z = zywe.get(a.id);
          return { id: a.id, nazwa: a.nazwa, utworzono: a.utworzono,
            online: slucha(z, teraz), uspiony: Boolean(z && z.uspiony), ostatnio: z ? z.ostatnio || null : null,
            caps: z ? z.caps : {}, zmyslyDzialaja: Boolean(z && z.online && slucha(z, teraz)),
            chce: chceAgenta(a), skladniki: (z && z.skladniki) || {}, pakiety: (z && z.pakiety) || {},
            instalacja: (z && z.instalacja) || null, system: (z && z.system) || '', autostart: Boolean(z && z.autostart),
            nieaktualny: Boolean(z && z.wersja && w && z.wersja !== w) };
        }),
        zrodlo: await (async () => {
          // „Dom” tylko wtedy, gdy komputer domowy naprawdę odpowiada – inaczej
          // zdanie w Ustawieniach obiecywałoby zmysły, których nie ma.
          const zr = zrodloZmyslow(u);
          if (zr !== 'dom') return zr;
          const st = await Promise.resolve(domOdpowiada()).catch(() => ({ online: false }));
          return st && st.online ? 'dom' : '';
        })(),
      });
    }
    /* Przełączniki „Zmysły / Obserwator kamery / Kinect” w Ustawieniach.
       Zapisane na serwerze: agent po restarcie komputera wraca do nich sam. */
    if (p === '/api/agent/ustaw' && req.method === 'POST') {
      const a = moj();
      if (!a) return sendJson(res, 404, { error: 'Nie ma takiego komputera.' });
      let d = {};
      try { d = await czytajJsonAgenta(req, 16 * 1024); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const przed = a.chce;
      const chce = { ...chceAgenta(a) };
      for (const k of SKLADNIKI) if (typeof (d.chce || {})[k] === 'boolean') chce[k] = d.chce[k];
      a.chce = chce;
      if (zapiszAgentow()) { a.chce = przed; return nieZapisane(res); }
      sterujAgentem(a.id, { polecenie: 'uzgodnij', chce });
      return sendJson(res, 200, { ok: true, chce });
    }
    /* Instalacja pakietów, aktualizacja plików, autostart – jednym kliknięciem.
       Agent przyjmuje tylko nazwy ze swojej listy; dowolnego polecenia nie wykona. */
    if (p === '/api/agent/polecenie' && req.method === 'POST') {
      const a = moj();
      if (!a) return sendJson(res, 404, { error: 'Nie ma takiego komputera.' });
      let d = {};
      try { d = await czytajJsonAgenta(req, 16 * 1024); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const polecenie = String(d.polecenie || '');
      if (!['instaluj', 'aktualizuj', 'autostart'].includes(polecenie)) return sendJson(res, 400, { error: 'Nieznane polecenie.' });
      const pakiety = (Array.isArray(d.pakiety) ? d.pakiety : []).map((x) => String(x).replace(/[^a-z]/g, '')).filter(Boolean).slice(0, 12);
      sterujAgentem(a.id, { polecenie, pakiety, wlacz: d.wlacz !== false });
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/agent' && req.method === 'DELETE') {
      const a = moj();
      if (!a) return sendJson(res, 404, { error: 'Nie ma takiego komputera.' });
      a.odlaczony = Date.now();
      delete a.chce;
      if (zapiszAgentow()) { delete a.odlaczony; return nieZapisane(res); }
      odrzucZleceniaAgenta(a.id, blad('Komputer został odłączony.', { kod: 'agent-odlaczony' }));
      const z = zywe.get(a.id);
      if (z) {
        for (const r of z.czekajacy) { try { clearTimeout(r.__czas); r.writeHead(410); r.end(); } catch { /* zamknięte */ } }
        zywe.delete(a.id);
      }
      return sendJson(res, 200, { ok: true });
    }
    return null;
  }

  return { publiczne, osoby };
}

/** Osoba, której agent wysłał to żądanie – dla /api/events (obserwator kamery
 *  na komputerze osoby z tokenem agenta zamiast COSMOS_API_TOKEN). */
function osobaAgenta(req) {
  const a = wpisZTokenu(req);
  return zywyWpis(a) ? a.uid : null;
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
  adresSerwera, ileZlecen, PLIKI_AGENTA, SKLADNIKI, MAX_CIALO_B,
  _reset: () => { agenci = []; kody.clear(); zywe.clear(); oczekujace.clear(); pomylki = { n: 0, od: 0 }; blokadaParowania = 0; },
};

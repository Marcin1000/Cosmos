/* ============================================================
   Konta, zaproszenia i sesje

   Do tej pory Cosmos znał jedno hasło i zbiór anonimowych tokenów w pamięci:
   wiedział, że KTOŚ jest zalogowany, ale nie wiedział KTO. Restart serwera
   wylogowywał wszystkich. Przy jednej osobie za Tailscale to wystarczało.
   Na publicznej domenie, z rodziną i znajomymi, nie wystarcza żadna z tych
   trzech rzeczy.

   Tutaj:
     — konta z rolą (właściciel / członek) i uprawnieniami do silników,
     — hasła jako scrypt z solą, nigdy jawnie,
     — sesje na dysku, ale jako SKRÓTY tokenów: wyciek pliku `sesje.json`
       nie daje nikomu działającej sesji,
     — zaproszenia jednorazowe z terminem ważności, też trzymane jako skróty,
     — limit nieudanych logowań, bo publiczny formularz bez limitu to
       zaproszenie do zgadywania hasła w nieskończoność.

   Zero zależności: wszystko z `node:crypto`.
   ============================================================ */

const crypto = require('node:crypto');
const path = require('node:path');
const { DATA_DIR, zapiszAtomowo, czytajJson } = require('./rdzen.js');
const { WLASCICIEL_ID } = require('./kontekst.js');

const KATALOG = path.join(DATA_DIR, 'konta');
const PLIK_UZYTKOWNICY = path.join(KATALOG, 'uzytkownicy.json');
const PLIK_ZAPROSZENIA = path.join(KATALOG, 'zaproszenia.json');
const PLIK_SESJE = path.join(KATALOG, 'sesje.json');

const SESJA_WAZNA_MS = 30 * 24 * 60 * 60 * 1000;     // 30 dni od ostatniego użycia
const ZAPROSZENIE_WAZNE_MS = 7 * 24 * 60 * 60 * 1000;
const ODSWIEZ_SESJE_CO_MS = 10 * 60 * 1000;          // nie zapisuj pliku przy każdym żądaniu
const MIN_HASLO = 8;

/* Silniki, które właściciel przyznaje członkom. Chmura NVIDIA jest dla
   wszystkich i nie ma tu przełącznika — to decyzja Marcina, nie brak. */
const SILNIKI_PRZYZNAWANE = ['local', 'openai', 'claude', 'studio'];

/* Parametry scrypt: N=2^15, r=8 → ok. 32 MB pamięci i ~100 ms na próbę.
   Dla człowieka niezauważalne, dla zgadującego — kosztowne. */
const SCRYPT = { N: 1 << 15, r: 8, p: 1, dlugosc: 64, maxmem: 64 * 1024 * 1024 };

// ---------------------------------------------------------------------------
// Odczyt i zapis
// ---------------------------------------------------------------------------

/* Konta są krytyczne: uszkodzony plik NIE może dać „serwera bez kont",
   bo zapewnijWlasciciela od razu by go nadpisał i członkowie znikliby na
   zawsze. Wtedy serwer nie wstaje (czytajJson w lib/rdzen.js). */
function czytaj(plik, domyslnie, krytyczny = false) {
  return czytajJson(plik, domyslnie, { krytyczny });
}
/* 0600: te pliki zawierają skróty haseł i sesji. Nie ma powodu, żeby
   ktokolwiek poza procesem Cosmosa je czytał. `trwale` — zrzut na dysk:
   nowe konto czy zmienione hasło nie może zniknąć przy zaniku zasilania. */
function zapisz(plik, dane) {
  zapiszAtomowo(plik, JSON.stringify(dane, null, 2), { mode: 0o600, kopia: true, trwale: true });
}

let uzytkownicy = czytaj(PLIK_UZYTKOWNICY, [], true);
let zaproszenia = czytaj(PLIK_ZAPROSZENIA, []);
let sesje = czytaj(PLIK_SESJE, []);

const zapiszUzytkownikow = () => { anulujOdroczony(); zapisz(PLIK_UZYTKOWNICY, uzytkownicy); };
const zapiszZaproszenia = () => zapisz(PLIK_ZAPROSZENIA, zaproszenia);
const zapiszSesje = () => zapisz(PLIK_SESJE, sesje);

/* Zapis, który może poczekać i nie może niczego wywrócić: licznik wiadomości
   i „ostatnio widziany". Dawniej plik kont szedł na dysk przy KAŻDEJ
   wiadomości (84 zapisy na minutę przy 12 osobach), a pełny dysk dawał 500
   na czacie i na logowaniu — wszystkim, choć czat dysku nie potrzebuje.
   Teraz: jeden zapis na pół minuty, błąd tylko w logu. Zamknięcie serwera
   dopisuje zaległy stan (zapiszZalegle). */
const ODROCZENIE_MS = 30 * 1000;
let odroczony = null;
function anulujOdroczony() { if (odroczony) { clearTimeout(odroczony); odroczony = null; } }
function zapiszZalegle() {
  if (!odroczony) return;
  anulujOdroczony();
  try { zapisz(PLIK_UZYTKOWNICY, uzytkownicy); }
  catch (err) { console.error('Nie udało się zapisać liczników kont:', err.message); }
}
function zapiszUzytkownikowWkrotce() {
  if (odroczony) return;
  odroczony = setTimeout(zapiszZalegle, ODROCZENIE_MS);
  // Samo odroczenie nie może trzymać procesu przy życiu (testy, narzędzie konto.js).
  if (odroczony.unref) odroczony.unref();
}

/** Wczytaj pliki od nowa (testy, narzędzie wiersza poleceń). */
function przeladuj() {
  uzytkownicy = czytaj(PLIK_UZYTKOWNICY, [], true);
  zaproszenia = czytaj(PLIK_ZAPROSZENIA, []);
  sesje = czytaj(PLIK_SESJE, []);
}

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

const skrot = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const losowy = (bajtow = 32) => crypto.randomBytes(bajtow).toString('base64url');

/** Login: małe litery, cyfry, kropka, myślnik, podkreślnik. 2–32 znaki.
 *  Polskie znaki zamieniamy, bo „Łukasz" wpisany raz z ogonkiem, a raz bez,
 *  nie może dawać dwóch różnych kont. */
function normalizujLogin(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '').slice(0, 32);
}

/** Widok konta bez sekretów — to i tylko to może wyjść poza ten moduł. */
function widok(u) {
  if (!u) return null;
  return {
    id: u.id, login: u.login, nazwa: u.nazwa, rola: u.rola,
    utworzono: u.utworzono, ostatnio: u.ostatnio || null,
    maHaslo: Boolean(u.haslo),
    silniki: u.rola === 'wlasciciel'
      ? Object.fromEntries(SILNIKI_PRZYZNAWANE.map((s) => [s, true]))
      : { ...Object.fromEntries(SILNIKI_PRZYZNAWANE.map((s) => [s, false])), ...(u.silniki || {}) },
    zuzycie: u.zuzycie || { wiadomosci: 0, dzien: null, dzisiaj: 0 },
  };
}

function scryptAsync(haslo, sol) {
  return new Promise((ok, zle) => {
    crypto.scrypt(String(haslo), sol, SCRYPT.dlugosc,
      { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem },
      (err, klucz) => (err ? zle(err) : ok(klucz)));
  });
}

async function skrotHasla(haslo) {
  const sol = crypto.randomBytes(16);
  const klucz = await scryptAsync(haslo, sol);
  return { alg: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
    sol: sol.toString('base64'), skrot: klucz.toString('base64') };
}

async function hasloPasuje(zapisane, haslo) {
  if (!zapisane || zapisane.alg !== 'scrypt') return false;
  const klucz = await scryptAsync(haslo, Buffer.from(zapisane.sol, 'base64'));
  const wzor = Buffer.from(zapisane.skrot, 'base64');
  return wzor.length === klucz.length && crypto.timingSafeEqual(wzor, klucz);
}

function sprawdzHaslo(haslo) {
  if (typeof haslo !== 'string' || haslo.length < MIN_HASLO) {
    return `Hasło musi mieć co najmniej ${MIN_HASLO} znaków.`;
  }
  if (haslo.length > 200) return 'Hasło jest za długie.';
  return null;
}

// ---------------------------------------------------------------------------
// Konta
// ---------------------------------------------------------------------------

const wszyscy = () => uzytkownicy.map(widok);
const znajdz = (id) => uzytkownicy.find((u) => u.id === id) || null;
const poLoginie = (login) => uzytkownicy.find((u) => u.login === normalizujLogin(login)) || null;
const wlasciciel = () => uzytkownicy.find((u) => u.rola === 'wlasciciel') || null;

/** Czy logowanie jest w ogóle możliwe — czyli czy jakiekolwiek konto ma hasło. */
const maHasla = () => uzytkownicy.some((u) => u.haslo);

/** Zapewnij konto właściciela. Wołane przy starcie.
 *
 *  Istniejąca instalacja miała jedno hasło w `COSMOS_PASSWORD`. Przy pierwszym
 *  starcie nowej wersji to hasło staje się hasłem konta właściciela, a login
 *  bierzemy z `COSMOS_LOGIN` (domyślnie „wlasciciel"). Dalej hasło żyje już
 *  w koncie — zmienia się je w Ustawieniach, a `COSMOS_PASSWORD` służy tylko
 *  do tego pierwszego razu. */
async function zapewnijWlasciciela({ haslo, login, nazwa } = {}) {
  let w = wlasciciel();
  if (!w) {
    w = {
      id: WLASCICIEL_ID,
      login: normalizujLogin(login) || 'wlasciciel',
      nazwa: String(nazwa || login || 'Właściciel').slice(0, 60),
      rola: 'wlasciciel',
      utworzono: Date.now(),
    };
    uzytkownicy.unshift(w);
    if (haslo) w.haslo = await skrotHasla(haslo);
    zapiszUzytkownikow();
  } else if (haslo && !w.haslo) {
    // Konto było z trybu domowego (bez hasła), a teraz hasło ustawiono w .env.
    w.haslo = await skrotHasla(haslo);
    zapiszUzytkownikow();
  }
  return widok(w);
}

async function ustawHaslo(id, haslo) {
  const blad = sprawdzHaslo(haslo);
  if (blad) throw Object.assign(new Error(blad), { kod: 400 });
  const u = znajdz(id);
  if (!u) throw Object.assign(new Error('Nie ma takiego konta.'), { kod: 404 });
  u.haslo = await skrotHasla(haslo);
  zapiszUzytkownikow();
}

function ustawNazwe(id, nazwa) {
  const u = znajdz(id);
  if (!u) return null;
  const n = String(nazwa || '').trim().slice(0, 60);
  if (n) { u.nazwa = n; zapiszUzytkownikow(); }
  return widok(u);
}

/** Przyznaj lub odbierz członkowi silniki. Właścicielowi nic się nie zmienia. */
function ustawSilniki(id, silniki) {
  const u = znajdz(id);
  if (!u || u.rola === 'wlasciciel') return widok(u);
  u.silniki = { ...(u.silniki || {}) };
  for (const s of SILNIKI_PRZYZNAWANE) {
    if (silniki && typeof silniki[s] === 'boolean') u.silniki[s] = silniki[s];
  }
  zapiszUzytkownikow();
  return widok(u);
}

/** Usuń konto członka. Właściciela usunąć się nie da — zostałby serwer bez nikogo. */
function usunUzytkownika(id) {
  const u = znajdz(id);
  if (!u || u.rola === 'wlasciciel') return false;
  uzytkownicy = uzytkownicy.filter((x) => x.id !== id);
  sesje = sesje.filter((s) => s.uid !== id);
  zapiszUzytkownikow();
  zapiszSesje();
  return true;
}

/** Licznik zużycia — to jedyne, co właściciel widzi o cudzej aktywności. */
function zanotujWiadomosc(id) {
  const u = znajdz(id);
  if (!u) return;
  const dzien = new Date().toISOString().slice(0, 10);
  const z = u.zuzycie || { wiadomosci: 0, dzien, dzisiaj: 0 };
  z.wiadomosci = (z.wiadomosci || 0) + 1;
  if (z.dzien !== dzien) { z.dzien = dzien; z.dzisiaj = 0; }
  z.dzisiaj = (z.dzisiaj || 0) + 1;
  u.zuzycie = z;
  zapiszUzytkownikowWkrotce();
}

async function zaloguj(login, haslo) {
  const u = poLoginie(login);
  /* Nawet gdy konta nie ma, liczymy scrypt na atrapie — inaczej czas odpowiedzi
     zdradzałby, które loginy istnieją. */
  if (!u || !u.haslo) {
    await scryptAsync(String(haslo || ''), Buffer.alloc(16));
    return null;
  }
  return (await hasloPasuje(u.haslo, haslo)) ? widok(u) : null;
}

// ---------------------------------------------------------------------------
// Sesje
// ---------------------------------------------------------------------------

function utworzSesje(uid, urzadzenie = '') {
  const token = losowy(32);
  const teraz = Date.now();
  sesje.push({ skrot: skrot(token), uid, utworzono: teraz, ostatnio: teraz,
    urzadzenie: String(urzadzenie).slice(0, 120) });
  const u = znajdz(uid);
  if (u) { u.ostatnio = teraz; zapiszUzytkownikowWkrotce(); }
  /* Pełny dysk nie może zamknąć drzwi przed właścicielem, który właśnie
     przyszedł zrobić miejsce. Sesja działa wtedy do restartu serwera. */
  try { zapiszSesje(); } catch (err) { console.error('Sesja tylko w pamięci — zapis się nie udał:', err.message); }
  return token;
}

/** Użytkownik dla tokenu sesji albo null. Przedłuża sesję przy użyciu. */
function uzytkownikSesji(token) {
  if (!token) return null;
  const s = sesje.find((x) => x.skrot === skrot(token));
  if (!s) return null;
  const teraz = Date.now();
  if (teraz - s.ostatnio > SESJA_WAZNA_MS) {
    sesje = sesje.filter((x) => x !== s);
    zapiszSesje();
    return null;
  }
  const u = znajdz(s.uid);
  if (!u) return null;
  if (teraz - s.ostatnio > ODSWIEZ_SESJE_CO_MS) {
    s.ostatnio = teraz;
    u.ostatnio = teraz;
    /* Przedłużenie sesji to wygoda, nie warunek. Wyjątek stąd wywracał
       KAŻDE żądanie /api/* (ktoPyta), gdy dysk był pełny. */
    try { zapiszSesje(); } catch (err) { console.error('Nie udało się przedłużyć sesji na dysku:', err.message); }
    zapiszUzytkownikowWkrotce();
  }
  return widok(u);
}

function usunSesje(token) {
  const przed = sesje.length;
  sesje = sesje.filter((x) => x.skrot !== skrot(token));
  if (sesje.length !== przed) zapiszSesje();
}

/** Wyloguj wszędzie — po zmianie hasła albo gdy telefon zginął. */
function usunSesjeUzytkownika(uid, pozaTokenem = null) {
  const zostaw = pozaTokenem ? skrot(pozaTokenem) : null;
  const przed = sesje.length;
  sesje = sesje.filter((x) => x.uid !== uid || x.skrot === zostaw);
  if (sesje.length !== przed) zapiszSesje();
  return przed - sesje.length;
}

const ileSesji = (uid) => sesje.filter((x) => x.uid === uid).length;

// ---------------------------------------------------------------------------
// Zaproszenia
// ---------------------------------------------------------------------------

/** Nowe zaproszenie. Token wraca RAZ — do linku. Na dysku zostaje tylko skrót,
 *  więc nawet właściciel nie odtworzy linku później; najwyżej wystawi nowy. */
function utworzZaproszenie({ nazwa, przez }) {
  const token = losowy(24);
  const teraz = Date.now();
  const z = {
    id: losowy(8),
    skrot: skrot(token),
    nazwa: String(nazwa || '').trim().slice(0, 60),
    przez: przez || null,
    utworzono: teraz,
    wygasa: teraz + ZAPROSZENIE_WAZNE_MS,
  };
  zaproszenia.push(z);
  zapiszZaproszenia();
  return { token, zaproszenie: widokZaproszenia(z) };
}

function widokZaproszenia(z) {
  return { id: z.id, nazwa: z.nazwa, przez: z.przez, utworzono: z.utworzono, wygasa: z.wygasa };
}

function sprzatnijZaproszenia() {
  const teraz = Date.now();
  const przed = zaproszenia.length;
  zaproszenia = zaproszenia.filter((z) => z.wygasa > teraz);
  if (zaproszenia.length !== przed) zapiszZaproszenia();
}

function listaZaproszen() {
  sprzatnijZaproszenia();
  return zaproszenia.map(widokZaproszenia);
}

function zaproszenieZTokenu(token) {
  if (!token) return null;
  sprzatnijZaproszenia();
  return zaproszenia.find((z) => z.skrot === skrot(token)) || null;
}

function usunZaproszenie(id) {
  const przed = zaproszenia.length;
  zaproszenia = zaproszenia.filter((z) => z.id !== id);
  if (zaproszenia.length !== przed) { zapiszZaproszenia(); return true; }
  return false;
}

/** Przyjęcie zaproszenia: nowe konto członka. Zaproszenie znika NATYCHMIAST,
 *  przed zapisem konta — drugi, równoległy klik w ten sam link nie może
 *  założyć drugiego konta. */
async function przyjmijZaproszenie(token, { login, nazwa, haslo }) {
  const z = zaproszenieZTokenu(token);
  if (!z) throw Object.assign(new Error('To zaproszenie wygasło albo zostało już użyte.'), { kod: 410 });
  const l = normalizujLogin(login);
  if (l.length < 2) throw Object.assign(new Error('Login musi mieć co najmniej 2 znaki (litery, cyfry, kropka).'), { kod: 400 });
  if (poLoginie(l)) throw Object.assign(new Error('Ten login jest już zajęty — wybierz inny.'), { kod: 409 });
  const blad = sprawdzHaslo(haslo);
  if (blad) throw Object.assign(new Error(blad), { kod: 400 });

  zaproszenia = zaproszenia.filter((x) => x !== z);
  zapiszZaproszenia();

  const u = {
    id: `u-${crypto.randomBytes(6).toString('hex')}`,
    login: l,
    nazwa: String(nazwa || z.nazwa || l).trim().slice(0, 60),
    rola: 'czlonek',
    utworzono: Date.now(),
    silniki: Object.fromEntries(SILNIKI_PRZYZNAWANE.map((s) => [s, false])),
    zaproszonyPrzez: z.przez,
    haslo: await skrotHasla(haslo),
  };
  uzytkownicy.push(u);
  zapiszUzytkownikow();
  return widok(u);
}

// ---------------------------------------------------------------------------
// Limit nieudanych logowań
// ---------------------------------------------------------------------------

/* Pomyłki w kwadrans → kwadrans przerwy. Liczone osobno dla adresu i dla
   loginu: pierwsze zatrzymuje zgadywanie z jednego miejsca, drugie —
   zgadywanie hasła jednej osoby z wielu miejsc.

   Próg dla LOGINU jest wyższy celowo. Blokada po loginie to broń obosieczna:
   obcy, który zna Twój login, może wpisać pod nim złe hasło i zamknąć CIEBIE
   na kwadrans. Pięć prób z jednego adresu wystarcza, żeby zatrzymać
   zgadującego; do zablokowania cudzego konta trzeba ich dziesięciu, a więc
   co najmniej dwóch adresów — i każdy z nich sam wpada w blokadę.

   W pamięci, bo restart i tak kosztuje atakującego więcej niż kwadrans. */
const PROBY_ADRES = 5;
const PROBY_LOGIN = 10;
const OKNO_MS = 15 * 60 * 1000;
const BLOKADA_MS = 15 * 60 * 1000;
const proby = new Map();

function zablokowanyDo(klucz) {
  const p = proby.get(klucz);
  return p && p.blokadaDo > Date.now() ? p.blokadaDo : 0;
}

function zanotujPomylke(klucz) {
  const teraz = Date.now();
  /* Sprzątanie starych wpisów — bez niego mapa rosła z każdym adresem, który
     kiedykolwiek pomylił hasło, aż do restartu. */
  if (proby.size > 500) {
    for (const [k, w] of proby) if (teraz - w.od > OKNO_MS && w.blokadaDo < teraz) proby.delete(k);
  }
  let p = proby.get(klucz);
  if (!p || teraz - p.od > OKNO_MS) p = { n: 0, od: teraz, blokadaDo: 0 };
  p.n += 1;
  const prog = klucz.startsWith('login:') ? PROBY_LOGIN : PROBY_ADRES;
  if (p.n >= prog) p.blokadaDo = teraz + BLOKADA_MS;
  proby.set(klucz, p);
}

const wyczyscPomylki = (klucz) => proby.delete(klucz);

/** Prawdziwy adres klienta. Za Cloudflare Tunnel i za `tailscale serve`
 *  każde żądanie przychodzi z 127.0.0.1 — bez tego limit prób blokowałby
 *  wszystkich naraz albo nikogo. Nagłówkom ufamy WYŁĄCZNIE wtedy, gdy
 *  połączenie przyszło z tej samej maszyny: z internetu każdy może wpisać
 *  sobie dowolne `CF-Connecting-IP`. */
function adresKlienta(req) {
  const zdalny = (req.socket && req.socket.remoteAddress) || '';
  const lokalny = /^(::1|127\.|::ffff:127\.)/.test(zdalny);
  let adres = zdalny;
  if (lokalny) {
    const cf = req.headers['cf-connecting-ip'];
    const xff = req.headers['x-forwarded-for'];
    if (cf) adres = String(cf).trim();
    else if (xff) adres = String(xff).split(',')[0].trim();
  }
  return prefiksAdresu(adres);
}

/* Adres do limitu prób. IPv6 liczymy PO SIECI /64, nie po adresie: dostawca
   daje jednemu łączu całą pulę 2^64 adresów, więc zgadujący zmieniałby adres
   co pięć prób i blokada po adresie nie działałaby wcale. IPv4 bez zmian. */
function prefiksAdresu(adres) {
  const a = String(adres || '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  if (!a.includes(':')) return a;
  const [przed, po = ''] = a.split('%')[0].split('::');
  const lewa = przed ? przed.split(':') : [];
  const prawa = po ? po.split(':') : [];
  const brak = a.includes('::') ? Math.max(0, 8 - lewa.length - prawa.length) : 0;
  const pelny = [...lewa, ...Array(brak).fill('0'), ...prawa];
  return `${pelny.slice(0, 4).map((h) => (parseInt(h, 16) || 0).toString(16)).join(':')}::/64`;
}

module.exports = {
  SILNIKI_PRZYZNAWANE, MIN_HASLO, PLIK_UZYTKOWNICY, PROBY_ADRES, PROBY_LOGIN,
  przeladuj, normalizujLogin, widok,
  wszyscy, znajdz: (id) => widok(znajdz(id)), poLoginie: (l) => widok(poLoginie(l)),
  wlasciciel: () => widok(wlasciciel()), maHasla,
  zapewnijWlasciciela, ustawHaslo, ustawNazwe, ustawSilniki, usunUzytkownika, zanotujWiadomosc,
  zaloguj, utworzSesje, uzytkownikSesji, usunSesje, usunSesjeUzytkownika, ileSesji, zapiszZalegle,
  utworzZaproszenie, listaZaproszen, zaproszenieZTokenu: (t) => {
    const z = zaproszenieZTokenu(t); return z ? widokZaproszenia(z) : null;
  }, usunZaproszenie, przyjmijZaproszenie,
  zablokowanyDo, zanotujPomylke, wyczyscPomylki, adresKlienta, prefiksAdresu,
};

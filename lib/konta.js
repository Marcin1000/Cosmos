/* ============================================================
   Konta, zaproszenia i sesje

   Do tej pory Cosmos znał jedno hasło i zbiór anonimowych tokenów w pamięci:
   wiedział, że KTOŚ jest zalogowany, ale nie wiedział KTO. Restart serwera
   wylogowywał wszystkich. Przy jednej osobie za Tailscale to wystarczało.
   Na publicznej domenie, z rodziną i znajomymi, nie wystarcza żadna z tych
   trzech rzeczy.

   Tutaj:
     – konta z rolą (właściciel / członek) i uprawnieniami do silników,
     – hasła jako scrypt z solą, nigdy jawnie,
     – sesje na dysku, ale jako SKRÓTY tokenów: wyciek pliku `sesje.json`
       nie daje nikomu działającej sesji,
     – zaproszenia jednorazowe z terminem ważności, też trzymane jako skróty,
     – limit nieudanych logowań, bo publiczny formularz bez limitu to
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
   wszystkich i nie ma tu przełącznika – to decyzja Marcina, nie brak. */
// „szukanie” – płatne wyszukiwarki z kluczem właściciela (Serper, Brave), lib/wyszukiwarki.js.
// „ptaki” – rozpoznawanie ptaków na procesorze serwera (lib/zmysly-serwera.js).
// „zespol” – zespół agentów: kilka wywołań modelu na jedno pytanie (silniki.zespolDozwolony).
const SILNIKI_PRZYZNAWANE = ['local', 'openai', 'claude', 'studio', 'szukanie', 'ptaki', 'zespol'];

/* Parametry scrypt: N=2^15, r=8 → ok. 32 MB pamięci i ~100 ms na próbę.
   Dla człowieka niezauważalne, dla zgadującego – kosztowne. */
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
   ktokolwiek poza procesem Cosmosa je czytał. `trwale` – zrzut na dysk:
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
   na czacie i na logowaniu – wszystkim, choć czat dysku nie potrzebuje.
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
/* Złotówki to dane rozliczeniowe, nie licznik „ostatnio widziany”: wydatek
   zgubiony przez kill -9 w oknie 30 s oddawał członkowi pieniądze (zespół IT,
   etap 5). Zużycie z kosztem > 0 idzie na dysk po ODROCZENIE_ZL_MS; zapis
   już zaplanowany na później przesuwa się na wcześniej. */
const ODROCZENIE_ZL_MS = 3 * 1000;
let odroczonyNa = 0;
function zapiszUzytkownikowWkrotce(ms = ODROCZENIE_MS) {
  const kiedy = Date.now() + ms;
  if (odroczony && odroczonyNa <= kiedy) return;
  anulujOdroczony();
  odroczonyNa = kiedy;
  odroczony = setTimeout(zapiszZalegle, ms);
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

/** Widok konta bez sekretów – to i tylko to może wyjść poza ten moduł.
 *  `zWlasnymKluczem` – liczniki także z własnego klucza członka. Domyślnie
 *  bez nich: to jego rachunek, nie właściciela (panel Dostęp). Osoba widzi
 *  swoje w całości przez `zuzycieOsoby` (/api/konto). */
function widok(u, { zWlasnymKluczem = false } = {}) {
  if (!u) return null;
  return {
    id: u.id, login: u.login, nazwa: u.nazwa, rola: u.rola,
    utworzono: u.utworzono, ostatnio: u.ostatnio || null,
    maHaslo: Boolean(u.haslo),
    silniki: u.rola === 'wlasciciel'
      ? Object.fromEntries(SILNIKI_PRZYZNAWANE.map((s) => [s, true]))
      : { ...Object.fromEntries(SILNIKI_PRZYZNAWANE.map((s) => [s, false])), ...(u.silniki || {}) },
    zuzycie: { ...zuzycieNaDzis(u.zuzycie),
      silniki: widokSilnikow(u.zuzycie && u.zuzycie.silniki, zWlasnymKluczem || u.rola === 'wlasciciel'),
      zl: widokZl(u.zuzycie && u.zuzycie.silniki, zWlasnymKluczem || u.rola === 'wlasciciel') },
    // Budżet na kluczach właściciela – ustawia go właściciel członkowi (panel Dostęp).
    budzetZl: u.rola === 'wlasciciel' ? { dzien: 0, miesiac: 0 } : limit(u.budzetZl),
  };
}

/* Doba w strefie procesu (= właściciela, lib/rdzen.js), nie w UTC: między
   północą a drugą w nocy wiadomości trafiały do „wczoraj" (zespół IT, runda 5).
   „dzisiaj" liczone przy odczycie – licznik z wczoraj nie udaje dzisiejszego. */
const dzisiajLokalnie = () => new Date().toLocaleDateString('sv-SE');
function zuzycieNaDzis(z) {
  const dzien = dzisiajLokalnie();
  const w = z || { wiadomosci: 0, dzien: null, dzisiaj: 0 };
  return { ...w, dzisiaj: w.dzien === dzien ? (w.dzisiaj || 0) : 0, dzien };
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

/** Stały kod błędu hasła – przeglądarka zamienia go na zdanie w języku osoby. */
const kodHasla = (haslo) => (typeof haslo === 'string' && haslo.length > 200 ? 'haslo-dlugie' : 'haslo-krotkie');
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

/** Czy logowanie jest w ogóle możliwe – czyli czy jakiekolwiek konto ma hasło. */
const maHasla = () => uzytkownicy.some((u) => u.haslo);

/** Zapewnij konto właściciela. Wołane przy starcie.
 *
 *  Istniejąca instalacja miała jedno hasło w `COSMOS_PASSWORD`. Przy pierwszym
 *  starcie nowej wersji to hasło staje się hasłem konta właściciela, a login
 *  bierzemy z `COSMOS_LOGIN` (domyślnie „wlasciciel"). Dalej hasło żyje już
 *  w koncie – zmienia się je w Ustawieniach, a `COSMOS_PASSWORD` służy tylko
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
  if (blad) throw Object.assign(new Error(blad), { kod: 400, kodBledu: kodHasla(haslo) });
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

/** Usuń konto członka. Właściciela usunąć się nie da – zostałby serwer bez nikogo. */
function usunUzytkownika(id) {
  const u = znajdz(id);
  if (!u || u.rola === 'wlasciciel') return false;
  uzytkownicy = uzytkownicy.filter((x) => x.id !== id);
  sesje = sesje.filter((s) => s.uid !== id);
  zapiszUzytkownikow();
  zapiszSesje();
  return true;
}

/** Licznik zużycia – to jedyne, co właściciel widzi o cudzej aktywności. */
function zanotujWiadomosc(id) {
  const u = znajdz(id);
  if (!u) return;
  const dzien = dzisiajLokalnie();
  const z = u.zuzycie || { wiadomosci: 0, dzien, dzisiaj: 0 };
  z.wiadomosci = (z.wiadomosci || 0) + 1;
  if (z.dzien !== dzien) { z.dzien = dzien; z.dzisiaj = 0; }
  z.dzisiaj = (z.dzisiaj || 0) + 1;
  u.zuzycie = z;
  zapiszUzytkownikowWkrotce();
}

/* ZUŻYCIE SILNIKÓW – wywołania, tokeny i złotówki na dzień i silnik. Tylko
   liczby: bez treści, bez modeli, bez nazw ról zespołu (model służy tylko do
   policzenia kosztu z cennika i nie zostaje w zapisie). Źródło płatności
   osobno, bo własny klucz członka to jego rachunek i nie trafia do panelu
   właściciela. Na dysku (w koncie): zuzycie.silniki = { '2026-09-29': {
   claude: { przyznany: { wywolan, we, wy, zl }, wlasny: {…} } } }, najwyżej
   DNI_ZUZYCIA dni – tyle, ile ma najdłuższy miesiąc, bo z tego samego zapisu
   liczy się budżet miesięczny (lib/budzet.js). */
const DNI_ZUZYCIA = 31;
const ZRODLA = ['wspolny', 'wlasciciel', 'przyznany', 'wlasny'];
const SILNIKI_ZUZYCIA = ['cloud', 'local', 'openai', 'claude', 'studio'];
// Na czyim kluczu: klucze właściciela (jego własne wywołania i przyznane członkom) albo własny klucz osoby.
const NA_KLUCZU_WLASCICIELA = ['wlasciciel', 'przyznany'];
const liczba = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.round(Number(x)) : 0);
const zl4 = (x) => Math.round((Number(x) || 0) * 1e4) / 1e4;

/* Cennik (lib/cennik.js) – server.js wstrzykuje ten sam, którego używa
   budżet; bez tego (narzędzie konto.js, testy modułów) – z .env procesu. */
let cennikKont = null;
const cennik = () => cennikKont || (cennikKont = require('./cennik.js').utworzCennik({ env: process.env }));
function ustawCennik(c) { cennikKont = c || null; }

/* Koszt jednego wywołania w zł. Kolejność: kwota podana wprost (orkiestrator
   zespołu ją zna) → `usage` dostawcy × cennik → gdy dostawca nie podał usage
   (przerwany strumień, pośrednik bez include_usage), a wołający zna szacunek
   tokenów – 1,5 × szacunek. Zero przy płatnym silniku przepuściłoby budżet,
   a dostawca i tak policzył tokeny (zespół IT, runda 9). Darmowy silnik – 0. */
function kosztWywolania(silnik, model, { we, wy, zl, szacunek, cache }) {
  const c = cennik();
  if (c.darmowy(silnik)) return 0;
  if (typeof zl === 'number' && Number.isFinite(zl) && zl >= 0) return zl4(zl);
  if (liczba(we) || liczba(wy)) return c.kosztZl(model, silnik, { we, wy, cache });
  /* Szacunek z ukrytym myśleniem modelu (cennik.szacujZl): przerwany strumień
     albo pośrednik bez usage u modelu rozumującego to głównie myślenie, którego
     w tekście nie widać. `szacunek.myslenie` (false albo liczba) nadpisuje. */
  if (szacunek && (liczba(szacunek.we) || liczba(szacunek.wy))) return zl4(1.5 * c.szacujZl(model, silnik, szacunek));
  return 0;
}

/** Zanotuj jedno wywołanie modelu osoby. `we`/`wy` – tokeny wejścia i wyjścia
 *  (z `usage` dostawcy; 0, gdy dostawca ich nie podał), `model` – do cennika,
 *  `zl` – koszt podany wprost, `szacunek` – {we, wy} na wypadek braku usage.
 *  Oddaje koszt w zł, który właśnie zapisał – to JEDYNY zapis wydatków
 *  (budzet.rozlicz tylko zwalnia rezerwację). Zapis odroczony – jak licznik
 *  wiadomości: czat nie czeka na dysk i pełny dysk go nie wywraca. */
function zanotujZuzycie(id, { silnik, zrodlo, we = 0, wy = 0, model = '', zl, szacunek, cache = 0 } = {}) {
  const u = znajdz(id);
  if (!u) return 0;
  const s = SILNIKI_ZUZYCIA.includes(silnik) ? silnik : 'cloud';
  const z = ZRODLA.includes(zrodlo) ? zrodlo : 'wspolny';
  const koszt = kosztWywolania(s, String(model || ''), { we, wy, zl, szacunek, cache });
  const dzien = dzisiajLokalnie();
  u.zuzycie = u.zuzycie || { wiadomosci: 0, dzien, dzisiaj: 0 };
  const dni = u.zuzycie.silniki && typeof u.zuzycie.silniki === 'object' ? u.zuzycie.silniki : {};
  const dnia = dni[dzien] || (dni[dzien] = {});
  const sil = dnia[s] || (dnia[s] = {});
  const w = sil[z] || (sil[z] = { wywolan: 0, we: 0, wy: 0 });
  w.wywolan += 1; w.we += liczba(we); w.wy += liczba(wy);
  if (koszt) w.zl = Math.round(((Number(w.zl) || 0) + koszt) * 1e6) / 1e6;
  // Najstarsze dni wypadają – plik kont nie rośnie bez końca.
  for (const d of Object.keys(dni).sort().slice(0, -DNI_ZUZYCIA)) delete dni[d];
  u.zuzycie.silniki = dni;
  zapiszUzytkownikowWkrotce(koszt > 0 ? ODROCZENIE_ZL_MS : ODROCZENIE_MS);
  return koszt;
}

/** Wydane złotówki osoby: dziś i w bieżącym miesiącu kalendarzowym, osobno
 *  na kluczach właściciela i na własnym kluczu. Surowe liczby dla budżetu. */
function sumyZl(dni) {
  const dzis = dzisiajLokalnie();
  const miesiac = dzis.slice(0, 7);
  const wynik = { dzis: { wlasciciel: 0, wlasny: 0 }, miesiac: { wlasciciel: 0, wlasny: 0 } };
  for (const [dzien, silniki] of Object.entries(dni || {})) {
    if (dzien.slice(0, 7) !== miesiac) continue;
    for (const zrodla of Object.values(silniki || {})) {
      for (const [z, w] of Object.entries(zrodla || {})) {
        const klucz = z === 'wlasny' ? 'wlasny' : NA_KLUCZU_WLASCICIELA.includes(z) ? 'wlasciciel' : null;
        const kwota = Number(w && w.zl) || 0;
        if (!klucz || !kwota) continue;
        wynik.miesiac[klucz] += kwota;
        if (dzien === dzis) wynik.dzis[klucz] += kwota;
      }
    }
  }
  for (const o of ['dzis', 'miesiac']) for (const k of ['wlasciciel', 'wlasny']) wynik[o][k] = zl4(wynik[o][k]);
  return wynik;
}

/** { dzis, miesiac, zrodla: { wlasciciel: {dzis, miesiac}, wlasny?: {…} } } –
 *  bez własnego klucza członka w widoku właściciela (to jego rachunek). */
function widokZl(dni, zWlasnym) {
  const s = sumyZl(dni);
  const zrodla = { wlasciciel: { dzis: s.dzis.wlasciciel, miesiac: s.miesiac.wlasciciel } };
  if (zWlasnym) zrodla.wlasny = { dzis: s.dzis.wlasny, miesiac: s.miesiac.wlasny };
  return {
    dzis: zl4(s.dzis.wlasciciel + (zWlasnym ? s.dzis.wlasny : 0)),
    miesiac: zl4(s.miesiac.wlasciciel + (zWlasnym ? s.miesiac.wlasny : 0)),
    zrodla,
  };
}

/** Surowe sumy dla lib/budzet.js – czytane ŚWIEŻO z konta przy każdym pytaniu. */
function wydaneZl(id) {
  const u = znajdz(id);
  return sumyZl(u && u.zuzycie && u.zuzycie.silniki);
}

/* BUDŻET W ZŁOTÓWKACH. Dwa limity, każdy dzienny i miesięczny (0 = bez limitu):
     budzetZl       – ustawia WŁAŚCICIEL członkowi; dotyczy wydatków na kluczach
                      właściciela (przyznany silnik),
     wlasnyBudzetZl – ustawia każda osoba sobie (Ustawienia → Agenci); dotyczy
                      wszystkiego płatnego, co uruchamia – także własnych kluczy.
   Liczy i pilnuje lib/budzet.js; tu tylko zapis w koncie. */
const MAX_BUDZET_ZL = 100000;
const limit = (x) => ({
  dzien: Number(x && x.dzien) > 0 ? Number(x.dzien) : 0,
  miesiac: Number(x && x.miesiac) > 0 ? Number(x.miesiac) : 0,
});
/** Kwota z pola formularza: liczba albo tekst („12,50”); puste = 0 (bez limitu). null = zła. */
function kwotaBudzetu(v) {
  if (v === null || v === '' || v === 0) return 0;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim().replace(/\s+/g, '').replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_BUDZET_ZL) return null;
  return Math.round(n * 100) / 100;
}

function limityBudzetu(id) {
  const u = znajdz(id);
  if (!u) return null;
  return { wlasny: limit(u.wlasnyBudzetZl), odWlasciciela: u.rola === 'wlasciciel' ? null : limit(u.budzetZl) };
}

/** Ustaw limit: `wlasny: false` – limit członka od właściciela (właściciel sam
 *  sobie go nie ustawia), `wlasny: true` – limit osoby dla siebie. Brak pola =
 *  bez zmiany. Oddaje { blad } albo { blad: null, limit, uzytkownik }; pamięć
 *  zmienia się na stałe dopiero po udanym zapisie. */
function ustawBudzet(id, dane, { wlasny = false } = {}) {
  const u = znajdz(id);
  if (!u || (!wlasny && u.rola === 'wlasciciel')) {
    return { blad: Object.assign(new Error('Nie ma takiego konta (albo to konto właściciela – swój limit ustawiasz w Ustawienia → Agenci).'), { kod: 404 }) };
  }
  const pole = wlasny ? 'wlasnyBudzetZl' : 'budzetZl';
  const d = dane && typeof dane === 'object' ? dane : {};
  const nowy = limit(u[pole]);
  for (const k of ['dzien', 'miesiac']) {
    if (d[k] === undefined) continue;
    const v = kwotaBudzetu(d[k]);
    if (v === null) {
      return { blad: Object.assign(new Error(`Budżet to kwota w złotówkach od 0 do ${MAX_BUDZET_ZL} (0 = bez limitu).`), { kod: 400, kodBledu: 'budzet-zly' }) };
    }
    nowy[k] = v;
  }
  const stary = u[pole];
  u[pole] = nowy;
  try { zapiszUzytkownikow(); } catch (err) { u[pole] = stary; return { blad: err }; }
  return { blad: null, limit: { ...nowy }, uzytkownik: widok(u) };
}

/** { dzisiaj: {silnik: {wywolan, we, wy}}, dni30: {…} } – zsumowane po źródłach
 *  (bez `wlasny`, gdy zWlasnym = false). */
function widokSilnikow(dni, zWlasnym) {
  const dzis = dzisiajLokalnie();
  const granica = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE');
  const wynik = { dzisiaj: {}, dni30: {} };
  for (const [dzien, silniki] of Object.entries(dni || {})) {
    if (dzien < granica) continue;
    for (const [s, zrodla] of Object.entries(silniki || {})) {
      for (const [z, w] of Object.entries(zrodla || {})) {
        if (z === 'wlasny' && !zWlasnym) continue;
        for (const cel of dzien === dzis ? [wynik.dzisiaj, wynik.dni30] : [wynik.dni30]) {
          const c = cel[s] || (cel[s] = { wywolan: 0, we: 0, wy: 0, zl: 0 });
          c.wywolan += liczba(w.wywolan); c.we += liczba(w.we); c.wy += liczba(w.wy);
          c.zl = zl4(c.zl + (Number(w.zl) || 0));
        }
      }
    }
  }
  return wynik;
}

/** Zużycie osoby w całości – razem z jej własnym kluczem (dla niej samej). */
function zuzycieOsoby(id) {
  const u = znajdz(id);
  return u ? widok(u, { zWlasnymKluczem: true }).zuzycie : null;
}

async function zaloguj(login, haslo) {
  const u = poLoginie(login);
  /* Nawet gdy konta nie ma, liczymy scrypt na atrapie – inaczej czas odpowiedzi
     zdradzałby, które loginy istnieją. */
  if (!u || !u.haslo) {
    await scryptAsync(String(haslo || ''), Buffer.alloc(16));
    return null;
  }
  return (await hasloPasuje(u.haslo, haslo)) ? widok(u) : null;
}

/* Znane urządzenia. Blokada pod loginem chroni hasło przed zgadywaniem z wielu
   adresów, ale ma drugą stronę: obcy, który zna login (a pusty login to
   właściciel), może pod nim wpisywać złe hasła co kwadrans i trzymać
   prawdziwą osobę na zewnątrz bez końca. Urządzenie, które kiedyś zalogowało
   się poprawnie, dostaje długie ciastko; blokada pod loginem go nie zatrzymuje
   (blokada po adresie – tak). Na dysku tylko skróty, jak przy sesjach. */
const ZNANYCH_NA_OSOBE = 20;
function znaneUrzadzenie(login, token) {
  const u = poLoginie(login);
  return Boolean(u && token && (u.znane || []).includes(skrot(token)));
}
/** Zapamiętaj urządzenie po udanym logowaniu. Oddaje token do ciastka. */
function zapamietajUrzadzenie(uid, token) {
  const u = znajdz(uid);
  if (!u) return '';
  const t = token && (u.znane || []).includes(skrot(token)) ? token : losowy(24);
  const s = skrot(t);
  u.znane = [s, ...(u.znane || []).filter((x) => x !== s)].slice(0, ZNANYCH_NA_OSOBE);
  zapiszUzytkownikowWkrotce();
  return t;
}

// ---------------------------------------------------------------------------
// Sesje
// ---------------------------------------------------------------------------

function utworzSesje(uid, urzadzenie = '') {
  const token = losowy(32);
  const teraz = Date.now();
  // Wygasłe sesje nie leżą w pliku bez końca (i nie zawyżają licznika urządzeń).
  sesje = sesje.filter((x) => teraz - x.ostatnio <= SESJA_WAZNA_MS);
  sesje.push({ skrot: skrot(token), uid, utworzono: teraz, ostatnio: teraz,
    urzadzenie: String(urzadzenie).slice(0, 120) });
  const u = znajdz(uid);
  if (u) { u.ostatnio = teraz; zapiszUzytkownikowWkrotce(); }
  /* Pełny dysk nie może zamknąć drzwi przed właścicielem, który właśnie
     przyszedł zrobić miejsce. Sesja działa wtedy do restartu serwera. */
  try { zapiszSesje(); } catch (err) { console.error('Sesja tylko w pamięci – zapis się nie udał:', err.message); }
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

/** Wyloguj wszędzie – po zmianie hasła albo gdy telefon zginął. */
function usunSesjeUzytkownika(uid, pozaTokenem = null) {
  const zostaw = pozaTokenem ? skrot(pozaTokenem) : null;
  const przed = sesje.length;
  sesje = sesje.filter((x) => x.uid !== uid || x.skrot === zostaw);
  if (sesje.length !== przed) zapiszSesje();
  return przed - sesje.length;
}

const ileSesji = (uid) => sesje.filter((x) => x.uid === uid && Date.now() - x.ostatnio <= SESJA_WAZNA_MS).length;

// ---------------------------------------------------------------------------
// Zaproszenia
// ---------------------------------------------------------------------------

/** Nowe zaproszenie. Token wraca RAZ – do linku. Na dysku zostaje tylko skrót,
 *  więc nawet właściciel nie odtworzy linku później; najwyżej wystawi nowy. */
function utworzZaproszenie({ nazwa, przez, dla = null }) {
  const token = losowy(24);
  const teraz = Date.now();
  const z = {
    id: losowy(8),
    skrot: skrot(token),
    nazwa: String(nazwa || '').trim().slice(0, 60),
    przez: przez || null,
    utworzono: teraz,
    // Link do nowego hasła żyje krócej niż zaproszenie: otwiera istniejące konto.
    wygasa: teraz + (dla ? RESET_WAZNY_MS : ZAPROSZENIE_WAZNE_MS),
    ...(dla ? { dla } : {}),
  };
  zaproszenia.push(z);
  zapiszZaproszenia();
  return { token, zaproszenie: widokZaproszenia(z) };
}

function widokZaproszenia(z) {
  return { id: z.id, nazwa: z.nazwa, przez: z.przez, utworzono: z.utworzono, wygasa: z.wygasa,
    ...(z.dla ? { dla: z.dla } : {}) };
}

/* NOWE HASŁO DLA CZŁONKA. Kto zapomniał hasła, miał jedną drogę z interfejsu:
   usunięcie konta i nowe zaproszenie – a to wynosiło jego rozmowy do
   data/usuniete/. Teraz właściciel wystawia jednorazowy link na tym samym
   mechanizmie co zaproszenie; osoba ustawia nowe hasło, stare sesje znikają.
   Właściciel sam siebie tak nie odblokuje – od tego jest scripts/konto.js. */
const RESET_WAZNY_MS = 24 * 60 * 60 * 1000;
function utworzLinkHasla(uid, przez) {
  const u = znajdz(uid);
  if (!u || u.rola === 'wlasciciel') return null;
  // Poprzedni, niewykorzystany link tej osoby przestaje działać.
  zaproszenia = zaproszenia.filter((z) => z.dla !== uid);
  return utworzZaproszenie({ nazwa: u.nazwa, przez, dla: uid });
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
 *  przed zapisem konta – drugi, równoległy klik w ten sam link nie może
 *  założyć drugiego konta. */
async function przyjmijZaproszenie(token, { login, nazwa, haslo }) {
  const z = zaproszenieZTokenu(token);
  if (!z) throw Object.assign(new Error('To zaproszenie wygasło albo zostało już użyte.'), { kod: 410, kodBledu: 'zaproszenie-wygaslo' });
  const blad = sprawdzHaslo(haslo);
  if (z.dla) {
    // Link do nowego hasła: konto już jest, login zostaje ten sam.
    const cel = znajdz(z.dla);
    if (!cel) throw Object.assign(new Error('To konto już nie istnieje.'), { kod: 410, kodBledu: 'zaproszenie-wygaslo' });
    if (blad) throw Object.assign(new Error(blad), { kod: 400, kodBledu: kodHasla(haslo) });
    zaproszenia = zaproszenia.filter((x) => x !== z);
    zapiszZaproszenia();
    cel.haslo = await skrotHasla(haslo);
    zapiszUzytkownikow();
    usunSesjeUzytkownika(cel.id);
    return widok(cel);
  }
  const l = normalizujLogin(login);
  if (l.length < 2) throw Object.assign(new Error('Login musi mieć co najmniej 2 znaki (litery, cyfry, kropka).'), { kod: 400, kodBledu: 'login-krotki' });
  if (poLoginie(l)) throw Object.assign(new Error('Ten login jest już zajęty – wybierz inny.'), { kod: 409, kodBledu: 'login-zajety' });
  if (blad) throw Object.assign(new Error(blad), { kod: 400, kodBledu: kodHasla(haslo) });

  zaproszenia = zaproszenia.filter((x) => x !== z);
  zapiszZaproszenia();

  const skrotH = await skrotHasla(haslo);
  /* Drugi raz, po await: dwa zaproszenia przyjęte naraz z tym samym loginem
     przeszły oba pierwsze sprawdzenie i dawały dwa konta „ola". Zaproszenie
     wraca na listę – osoba wybierze inny login i użyje tego samego linku. */
  if (poLoginie(l)) {
    zaproszenia.push(z);
    zapiszZaproszenia();
    throw Object.assign(new Error('Ten login jest już zajęty – wybierz inny.'), { kod: 409, kodBledu: 'login-zajety' });
  }
  const u = {
    id: `u-${crypto.randomBytes(6).toString('hex')}`,
    login: l,
    nazwa: String(nazwa || z.nazwa || l).trim().slice(0, 60),
    rola: 'czlonek',
    utworzono: Date.now(),
    silniki: Object.fromEntries(SILNIKI_PRZYZNAWANE.map((s) => [s, false])),
    zaproszonyPrzez: z.przez,
    haslo: skrotH,
  };
  uzytkownicy.push(u);
  zapiszUzytkownikow();
  return widok(u);
}

// ---------------------------------------------------------------------------
// Limit nieudanych logowań
// ---------------------------------------------------------------------------

/* Pomyłki w kwadrans → kwadrans przerwy. Liczone osobno dla adresu i dla
   loginu: pierwsze zatrzymuje zgadywanie z jednego miejsca, drugie –
   zgadywanie hasła jednej osoby z wielu miejsc.

   Próg dla LOGINU jest wyższy celowo. Blokada po loginie to broń obosieczna:
   obcy, który zna Twój login, może wpisać pod nim złe hasło i zamknąć CIEBIE
   na kwadrans. Pięć prób z jednego adresu wystarcza, żeby zatrzymać
   zgadującego; do zablokowania cudzego konta trzeba ich dziesięciu, a więc
   co najmniej dwóch adresów – i każdy z nich sam wpada w blokadę.

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
  /* Sprzątanie starych wpisów – bez niego mapa rosła z każdym adresem, który
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
 *  każde żądanie przychodzi z 127.0.0.1 – bez tego limit prób blokowałby
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
    /* CF-Connecting-IP ustawia Cloudflare i nadpisuje to, co przysłał klient.
       Inny pośrednik (Caddy) przepuszcza go bez zmian – wtedy
       COSMOS_POSREDNIK=inny i liczy się X-Forwarded-For, z niego OSTATNI
       wpis: ten dopisał nasz pośrednik, wcześniejsze mógł wpisać klient. */
    if (cf && process.env.COSMOS_POSREDNIK !== 'inny') adres = String(cf).trim();
    else if (xff) adres = String(xff).split(',').pop().trim();
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
  zapewnijWlasciciela, ustawHaslo, ustawNazwe, ustawSilniki, usunUzytkownika, zanotujWiadomosc, zanotujZuzycie, zuzycieOsoby,
  ustawCennik, wydaneZl, limityBudzetu, ustawBudzet, MAX_BUDZET_ZL, NA_KLUCZU_WLASCICIELA,
  zaloguj, znaneUrzadzenie, zapamietajUrzadzenie, utworzSesje, uzytkownikSesji, usunSesje, usunSesjeUzytkownika, ileSesji, zapiszZalegle,
  utworzZaproszenie, listaZaproszen, zaproszenieZTokenu: (t) => {
    const z = zaproszenieZTokenu(t); return z ? widokZaproszenia(z) : null;
  }, usunZaproszenie, przyjmijZaproszenie, utworzLinkHasla,
  zablokowanyDo, zanotujPomylke, wyczyscPomylki, adresKlienta, prefiksAdresu,
};

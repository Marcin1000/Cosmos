/* ============================================================
   Kontekst użytkownika – kto jest „po drugiej stronie" tego żądania

   Cosmos powstał dla jednej osoby. Każdy moduł trzymał swoje dane w jednym
   katalogu i w zmiennych ładowanych raz przy starcie: profil, rozmowy,
   pamięć, archiwum. Przy drugim użytkowniku to znaczy, że gość czyta
   profil właściciela razem z jego adresem.

   Zamiast przepisywać sygnatury setek funkcji, żeby każda dostawała
   „użytkownika" w argumencie, używamy AsyncLocalStorage: żądanie ustala
   kontekst raz, na wejściu, a ten podąża za każdym `await`, każdym
   timerem i każdą pracą w tle, którą żądanie uruchomiło. Odpowiedź, która
   kończy się minutę po zamknięciu karty, nadal wie, czyja to rozmowa.

   JEDNA REGUŁA, OD KTÓREJ ZALEŻY PRYWATNOŚĆ: brak kontekstu to wyjątek.
   Nigdy „w takim razie weź katalog wspólny" ani „w takim razie właściciel".
   Cichy powrót do domyślnego użytkownika to dokładnie ten błąd, który
   pokazałby gościowi cudze dane – i nikt by go nie zauważył, bo wszystko
   by działało. Wyjątek widać od razu, w teście albo w logu.
   ============================================================ */

const { AsyncLocalStorage, AsyncResource } = require('node:async_hooks');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./rdzen.js');

const als = new AsyncLocalStorage();

/* Stały identyfikator właściciela. Stały, bo migracja starego katalogu
   danych i tryb domowy (bez hasła) muszą trafić w to samo miejsce bez
   zaglądania do listy kont. */
const WLASCICIEL_ID = 'wlasciciel';
const KATALOG_UZYTKOWNIKOW = path.join(DATA_DIR, 'uzytkownicy');

class BrakKontekstu extends Error {
  constructor(co) {
    super(`Brak kontekstu użytkownika${co ? ` (${co})` : ''} – odmawiam dostępu do danych.`);
    this.name = 'BrakKontekstu';
  }
}

/** Uruchom `fn` w imieniu użytkownika. Wszystko, co `fn` wywoła – także
 *  asynchronicznie i po czasie – widzi tego użytkownika. */
function wKontekscie(uzytkownik, fn) {
  if (!uzytkownik || !uzytkownik.id) throw new Error('wKontekscie: brak użytkownika');
  return als.run({ uzytkownik }, fn);
}

/** Bieżący użytkownik albo null. Do decyzji „czy w ogóle jest ktoś". */
function kto() {
  const s = als.getStore();
  return (s && s.uzytkownik) || null;
}

/** Bieżący użytkownik; bez kontekstu – wyjątek. Do wszystkiego, co dotyka danych. */
function ktoWymagany(co) {
  const u = kto();
  if (!u) throw new BrakKontekstu(co);
  return u;
}

function czyWlasciciel(u = kto()) {
  return Boolean(u && u.rola === 'wlasciciel');
}

/* Identyfikator trafia do ścieżki na dysku, więc przepuszczamy wyłącznie
   własny alfabet. `../` w identyfikatorze to próba wyjścia poza katalog. */
function bezpiecznyId(id) {
  const czysty = String(id || '').replace(/[^a-z0-9-]/gi, '');
  if (!czysty || czysty !== String(id)) throw new Error(`Niedozwolony identyfikator użytkownika: ${id}`);
  return czysty;
}

function katalogDla(id) {
  return path.join(KATALOG_UZYTKOWNIKOW, bezpiecznyId(id));
}

/** Prywatny katalog bieżącego użytkownika (tworzony przy pierwszym użyciu). */
function katalogUzytkownika(u = ktoWymagany('katalog danych')) {
  const k = katalogDla(u.id);
  fs.mkdirSync(k, { recursive: true });
  return k;
}

/* Stan per użytkownik: identyfikator → (klucz → wartość). Wartość powstaje
   przy pierwszym użyciu z fabryki, która dostaje katalog i użytkownika. */
const stany = new Map();

function stan(klucz, fabryka) {
  return stanDla(ktoWymagany(klucz), klucz, fabryka);
}

/** Stan WSKAZANEJ osoby – nie tej z kontekstu. Dla kodu, który dostaje osobę
 *  jawnie (lib/silniki.js, dostepDla): w kolejce do dostawcy zadanie osoby B
 *  potrafi biec w kontekście osoby A, a wtedy `stan()` oddałby klucze A. */
function stanDla(u, klucz, fabryka) {
  if (!u || !u.id) throw new BrakKontekstu(klucz);
  let mapa = stany.get(u.id);
  if (!mapa) { mapa = new Map(); stany.set(u.id, mapa); }
  if (!mapa.has(klucz)) mapa.set(klucz, fabryka(katalogUzytkownika(u), u));
  return mapa.get(klucz);
}

/** Pośrednik udający jeden obiekt, a w rzeczywistości kierujący każde
 *  odwołanie do instancji BIEŻĄCEGO użytkownika. Dzięki temu kod, który
 *  pisał `archiwum.szukaj(…)`, nie musi się zmieniać – a mimo to każdy
 *  szuka w swoim archiwum. Poza kontekstem każde odwołanie rzuca. */
function naUzytkownika(klucz, fabryka) {
  const instancja = () => stan(klucz, fabryka);
  return new Proxy({}, {
    get(_, prop) {
      const inst = instancja();
      const v = inst[prop];
      return typeof v === 'function' ? v.bind(inst) : v;
    },
    set(_, prop, wartosc) { instancja()[prop] = wartosc; return true; },
    has(_, prop) { return prop in instancja(); },
  });
}

/* KOLEJKI I PRACOWNICY. AsyncLocalStorage idzie za `await` i timerem, ale nie
   za obietnicą rozwiązaną przez KOGOŚ INNEGO. Kolejka z pętlą-pracownikiem
   (zadania w tablicy, pętla startuje przy pierwszym) wykonuje zadanie osoby B
   w kontekście osoby A, która pętlę uruchomiła – i wtedy „własny klucz” B to
   klucz A (sonda it-konta, runda 9). Zasada: zadanie wrzucane do kolejki niesie
   swój kontekst – `zwiazZKontekstem(fn)` (AsyncResource.bind) albo jawne
   `wKontekscie(u, fn)`. Gotowa kolejka poniżej robi to sama. */

/** `fn` wywoływana później (z kolejki, ze zdarzenia) biegnie w kontekście
 *  z chwili związania, a nie w kontekście tego, kto ją woła. */
function zwiazZKontekstem(fn) {
  return AsyncResource.bind(fn);
}

/** Kolejka z ograniczeniem współbieżności, w której każde zadanie biegnie
 *  w kontekście osoby, która je zleciła. `wykonaj(fn)` → obietnica wyniku fn.
 *  `naraz` – ile zadań jednocześnie (np. 1 dla modelu lokalnego: VRAM). */
function kolejkaZKontekstem({ naraz = 1 } = {}) {
  const czeka = [];
  let trwa = 0;
  const dalej = () => {
    while (trwa < naraz && czeka.length) {
      const { zadanie, ok, zle } = czeka.shift();
      trwa++;
      Promise.resolve().then(zadanie).then(ok, zle).finally(() => { trwa--; dalej(); });
    }
  };
  function wykonaj(fn) {
    if (typeof fn !== 'function') throw new TypeError('kolejkaZKontekstem: zadanie musi być funkcją');
    return new Promise((ok, zle) => {
      czeka.push({ zadanie: zwiazZKontekstem(fn), ok, zle });
      dalej();
    });
  }
  wykonaj.czekajacych = () => czeka.length;
  wykonaj.trwajacych = () => trwa;
  return wykonaj;
}

/** Wszyscy użytkownicy, dla których w pamięci jest już jakiś stan. */
function zaladowani() { return [...stany.keys()]; }

/** Instancja bieżącej osoby, jeśli JUŻ istnieje – bez tworzenia jej.
 *  Zamknięcie serwera nie może wczytywać z dysku całego archiwum tylko po
 *  to, żeby je od razu zapisać (tak robił dostęp przez `naUzytkownika`). */
function istniejacy(klucz, u = kto()) {
  const mapa = u && stany.get(u.id);
  return mapa && mapa.has(klucz) ? mapa.get(klucz) : null;
}

/** Zapomnij stan użytkownika (po usunięciu konta albo w testach). */
function zapomnij(id) { stany.delete(id); }

module.exports = {
  WLASCICIEL_ID, KATALOG_UZYTKOWNIKOW, BrakKontekstu,
  wKontekscie, kto, ktoWymagany, czyWlasciciel,
  katalogDla, katalogUzytkownika, stan, stanDla, naUzytkownika, zwiazZKontekstem, kolejkaZKontekstem, zaladowani, istniejacy, zapomnij,
};

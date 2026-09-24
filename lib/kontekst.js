/* ============================================================
   Kontekst użytkownika — kto jest „po drugiej stronie" tego żądania

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
   pokazałby gościowi cudze dane — i nikt by go nie zauważył, bo wszystko
   by działało. Wyjątek widać od razu, w teście albo w logu.
   ============================================================ */

const { AsyncLocalStorage } = require('node:async_hooks');
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
    super(`Brak kontekstu użytkownika${co ? ` (${co})` : ''} — odmawiam dostępu do danych.`);
    this.name = 'BrakKontekstu';
  }
}

/** Uruchom `fn` w imieniu użytkownika. Wszystko, co `fn` wywoła — także
 *  asynchronicznie i po czasie — widzi tego użytkownika. */
function wKontekscie(uzytkownik, fn) {
  if (!uzytkownik || !uzytkownik.id) throw new Error('wKontekscie: brak użytkownika');
  return als.run({ uzytkownik }, fn);
}

/** Bieżący użytkownik albo null. Do decyzji „czy w ogóle jest ktoś". */
function kto() {
  const s = als.getStore();
  return (s && s.uzytkownik) || null;
}

/** Bieżący użytkownik; bez kontekstu — wyjątek. Do wszystkiego, co dotyka danych. */
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
  const u = ktoWymagany(klucz);
  let mapa = stany.get(u.id);
  if (!mapa) { mapa = new Map(); stany.set(u.id, mapa); }
  if (!mapa.has(klucz)) mapa.set(klucz, fabryka(katalogUzytkownika(u), u));
  return mapa.get(klucz);
}

/** Pośrednik udający jeden obiekt, a w rzeczywistości kierujący każde
 *  odwołanie do instancji BIEŻĄCEGO użytkownika. Dzięki temu kod, który
 *  pisał `archiwum.szukaj(…)`, nie musi się zmieniać — a mimo to każdy
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

/** Wszyscy użytkownicy, dla których w pamięci jest już jakiś stan. */
function zaladowani() { return [...stany.keys()]; }

/** Zapomnij stan użytkownika (po usunięciu konta albo w testach). */
function zapomnij(id) { stany.delete(id); }

module.exports = {
  WLASCICIEL_ID, KATALOG_UZYTKOWNIKOW, BrakKontekstu,
  wKontekscie, kto, ktoWymagany, czyWlasciciel,
  katalogDla, katalogUzytkownika, stan, naUzytkownika, zaladowani, zapomnij,
};

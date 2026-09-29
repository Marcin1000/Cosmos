/* ============================================================
   Zmysły NA SERWERZE – dziś tylko rozpoznawanie ptaków

   Marcin: „rozpoznawanie ptaków powinno działać bez komputera stacjonarnego
   i lokalnego GPU. Masz telefon w lesie i chcesz, żeby wyszukał, jaki to
   ptak, nie myśląc o tym, czy komputer w domu jest włączony”.

   BirdNET liczy na samym procesorze: 8 s nagrania to 0,2–0,5 s na jednym
   rdzeniu VPS-a (zmierzone przez zespół IT i agencję, runda 8). Działa jako
   osobna usługa (`cosmos-ptaki.service`, ta sama senses/service.py z filtrem
   COSMOS_ZMYSLY_TYLKO=ptak) pod PTAKI_URL, tylko na 127.0.0.1.

   Ten moduł jest trzecim źródłem dla `fetchZmyslow` (lib/agent-zmyslow.js),
   wyłącznie dla tras z białej listy. Pilnuje, żeby procesor serwera nie
   został zajęty przez nikogo w nadmiarze:
     – jedna analiza naraz, kilka czeka, ponad to od razu 503 (nie wiszenie),
     – jedna osoba – jedno nagranie w drodze (drugie: 429),
     – sufit czasu jednego zlecenia poniżej 90 s Cloudflare'a.
   Stan usługi (/health) odświeża się w tle – żądanie nigdy na niego nie czeka
   poza pierwszym razem, tak jak stan zmysłów domu w server.js.
   ============================================================ */

const cfg = () => ({
  url: String(process.env.PTAKI_URL || '').replace(/\/+$/, ''),
  naraz: Math.max(1, Number(process.env.PTAKI_NARAZ) || 1),
  kolejka: Math.max(0, Number(process.env.PTAKI_KOLEJKA ?? 6)),
  czasMs: Number(process.env.PTAKI_CZAS_MS) || 60_000,
});

/** Trasy, które mogą iść na procesor serwera. Nic poza tym. */
const TRASY_SERWERA = new Set(['/ptak']);
/** Zdolność, której trasa wymaga od źródła (agent bez BirdNET-u nie dostaje /ptak). */
const ZDOLNOSC_TRASY = { '/ptak': 'birdnet' };
const trasa = (sciezka) => String(sciezka || '').split('?')[0];
const naSerwer = (sciezka) => TRASY_SERWERA.has(trasa(sciezka));

const blad = (tekst, pola) => Object.assign(new Error(tekst), pola);

/* ------------------------------------------------------------- stan --- */

let stan = { kiedy: 0, online: false, caps: {} };
let odswiezanie = null;
const STAN_MS = 30_000;
/* Usługa offline albo w trakcie rozgrzewki – następne pytanie o stan za 4 s,
   nie za 30. Po każdej aktualizacji Cosmos i ptaki startują razem: pierwsze
   pytanie trafiało we wstającą usługę, a ptaki „nie istniały” jeszcze przez
   pół minuty, choć BirdNET był gotowy po ~13 s (zespół IT, runda 9). */
const STAN_NIEGOTOWY_MS = 30_000;
const gotowyTeraz = () => stan.online && Object.entries(ZDOLNOSC_TRASY)
  .every(([, z]) => Boolean(stan.caps[z]) && stan.caps[`${z}_gotowy`] !== false);
const waznoscStanu = () => (gotowyTeraz() ? STAN_MS : STAN_NIEGOTOWY_MS);

function odswiez() {
  const { url } = cfg();
  if (!url || odswiezanie) return odswiezanie;
  odswiezanie = fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })
    .then(async (r) => {
      const c = r.ok ? await r.json().catch(() => ({})) : {};
      stan = { kiedy: Date.now(), online: r.ok, caps: (c && (c.caps || c)) || {} };
    })
    .catch(() => { stan = { kiedy: Date.now(), online: false, caps: {} }; })
    .finally(() => { odswiezanie = null; });
  return odswiezanie;
}

/** Stan usługi bez czekania (poza pierwszym razem): {online, caps}. */
async function stanSerwera() {
  if (!cfg().url) return { online: false, caps: {} };
  if (Date.now() - stan.kiedy > waznoscStanu()) {
    const p = odswiez();
    if (!stan.kiedy && p) await p;
  }
  return stan;
}

/** Czy serwer obsłuży tę trasę TERAZ (według ostatniego znanego stanu). */
function serwerGotowy(sciezka) {
  const t = trasa(sciezka);
  if (!cfg().url || !naSerwer(t) || !stan.online) return false;
  const z = ZDOLNOSC_TRASY[t];
  // `<zdolność>_gotowy` zgłasza usługa po rozgrzewce modelu; bez tego pola – sama zdolność.
  return !z || (Boolean(stan.caps[z]) && stan.caps[`${z}_gotowy`] !== false);
}

/* ----------------------------------------------------------- kolejka --- */

let zajete = 0;
const czekajacy = [];          // [{ruszaj, porzuc, sygnal, termin}]
const wDrodze = new Set();     // id osób z nagraniem w drodze do usługi
const rezerwacje = new Set();  // id osób, których nagranie jest właśnie wczytywane albo w drodze

const pelnaKolejka = () => blad('Kolejka rozpoznawania jest pełna.', { kod: 'kolejka-pelna', status: 503 });
/* Miejsce, które zostało czekającemu na mniej niż tyle przed jego terminem, nic mu
   nie da: wysłałby 4 MB do usługi i zaraz zerwał, a BirdNET liczyłby dalej dla nikogo. */
const ZAPAS_TERMINU_MS = 5_000;

function zajmij(sygnal, termin = Infinity) {
  const { naraz, kolejka } = cfg();
  if (zajete < naraz) { zajete++; return Promise.resolve(); }
  if (czekajacy.length >= kolejka) return Promise.reject(pelnaKolejka());
  return new Promise((ruszaj, porzuc) => {
    const wpis = { ruszaj, porzuc, sygnal, termin };
    czekajacy.push(wpis);
    if (sygnal) {
      sygnal.addEventListener('abort', () => {
        const i = czekajacy.indexOf(wpis);
        if (i >= 0) { czekajacy.splice(i, 1); porzuc(sygnal.reason || blad('przerwane', { name: 'AbortError' })); }
      }, { once: true });
    }
  });
}
/** Oddaj miejsce pierwszemu czekającemu, który jeszcze na nie czeka i zdąży z niego skorzystać. */
function zwolnij() {
  for (;;) {
    const nast = czekajacy.shift();
    if (!nast) { zajete = Math.max(0, zajete - 1); return; }
    if (nast.sygnal && nast.sygnal.aborted) continue;
    if (Date.now() > nast.termin - ZAPAS_TERMINU_MS) { nast.porzuc(pelnaKolejka()); continue; }
    nast.ruszaj();
    return;
  }
}

/** Czy nowe zlecenie dostałoby teraz od razu „kolejka pełna” (sprawdzane przed wczytaniem nagrania). */
function kolejkaPelna() {
  const { naraz, kolejka } = cfg();
  return zajete >= naraz && czekajacy.length >= kolejka;
}

/**
 * Jedno nagranie na osobę – zarezerwowane PRZED wczytaniem ciała (lib/zmysly-proxy.js).
 * Dawniej sprawdzane dopiero tu, po wczytaniu 4 MB: 30 równoległych nagrań jednej
 * osoby podnosiło stertę o 120 MB, choć 29 i tak dostawało 429 (zespół IT, runda 9).
 * @returns {Function|null} zwolnienie rezerwacji albo null, gdy osoba już ma nagranie w drodze
 */
function zarezerwuj(u) {
  const kto = (u && u.id) || '-';
  if (rezerwacje.has(kto) || wDrodze.has(kto)) return null;
  rezerwacje.add(kto);
  let zwolnione = false;
  return () => { if (!zwolnione) { zwolnione = true; rezerwacje.delete(kto); } };
}

/**
 * Zlecenie do usługi na serwerze w imieniu osoby `u`. Oddaje prawdziwy
 * Response z całym ciałem (kolejka zwalnia się dopiero po ciele).
 */
async function doSerwera(u, sciezka, init = {}) {
  const { url, czasMs } = cfg();
  const kto = (u && u.id) || '-';
  if (wDrodze.has(kto)) throw blad('Poprzednie nagranie jeszcze się liczy.', { kod: 'zajete', status: 429 });
  wDrodze.add(kto);
  let mamMiejsce = false;
  try {
    const limit = AbortSignal.timeout(czasMs);
    /* Zerwanie klienta przerywa tylko CZEKANIE w kolejce. Zlecenie, które już
       poszło do usługi, trzyma miejsce do jej odpowiedzi (albo do czasMs): BirdNET
       i tak liczy je do końca, a zwolnione wcześniej miejsce wpuszczało następne –
       10 zerwanych nagrań w sekundę dawało 10 analiz naraz przy PTAKI_NARAZ=1
       (zespół IT, runda 9). Za Cloudflare to częste: telefon w lesie gubi zasięg. */
    await zajmij(init.signal ? AbortSignal.any([init.signal, limit]) : limit, Date.now() + czasMs);
    mamMiejsce = true;
    const r = await fetch(`${url}${sciezka}`, { ...init, signal: limit });
    const buf = await r.arrayBuffer();
    return new Response(buf, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' } });
  } catch (err) {
    // Usługa nie odpowiada – następne pytanie o stan niech sprawdzi od razu.
    if (/ECONNREFUSED|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|EHOSTUNREACH/.test(String(err?.cause?.code || err?.code || ''))) {
      stan = { kiedy: Date.now(), online: false, caps: {} };
    }
    throw err;
  } finally {
    if (mamMiejsce) zwolnij();
    wDrodze.delete(kto);
  }
}

/** Ile zleceń jest teraz na serwerze (restart na nie czeka). */
const ileWDrodze = () => wDrodze.size;

// Stan w tle od startu – pierwsze nagranie nie płaci pytania o /health.
// Odstęp zależy od stanu: gotowa usługa co 30 s, niegotowa co 4 s.
function odswiezajWTle() {
  Promise.resolve(odswiez()).finally(() => {
    const t = setTimeout(odswiezajWTle, waznoscStanu());
    t.unref?.();
  });
}
if (cfg().url) odswiezajWTle();

module.exports = {
  naSerwer, trasa, ZDOLNOSC_TRASY, stanSerwera, serwerGotowy, doSerwera, ileWDrodze, zarezerwuj, kolejkaPelna,
  _reset: () => { stan = { kiedy: 0, online: false, caps: {} }; zajete = 0; czekajacy.length = 0; wDrodze.clear(); rezerwacje.clear(); },
};

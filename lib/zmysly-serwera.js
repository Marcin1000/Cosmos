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
  if (Date.now() - stan.kiedy > STAN_MS) {
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
const czekajacy = [];          // [{ruszaj, porzuc}]
const wDrodze = new Set();     // id osób z nagraniem w drodze

function zajmij(sygnal) {
  const { naraz, kolejka } = cfg();
  if (zajete < naraz) { zajete++; return Promise.resolve(); }
  if (czekajacy.length >= kolejka) {
    return Promise.reject(blad('Kolejka rozpoznawania jest pełna.', { kod: 'kolejka-pelna', status: 503 }));
  }
  return new Promise((ruszaj, porzuc) => {
    const wpis = { ruszaj, porzuc };
    czekajacy.push(wpis);
    if (sygnal) {
      sygnal.addEventListener('abort', () => {
        const i = czekajacy.indexOf(wpis);
        if (i >= 0) { czekajacy.splice(i, 1); porzuc(sygnal.reason || blad('przerwane', { name: 'AbortError' })); }
      }, { once: true });
    }
  });
}
function zwolnij() {
  const nast = czekajacy.shift();
  if (nast) nast.ruszaj(); else zajete = Math.max(0, zajete - 1);
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
    const sygnal = AbortSignal.any([init.signal, AbortSignal.timeout(czasMs)].filter(Boolean));
    await zajmij(sygnal);
    mamMiejsce = true;
    const r = await fetch(`${url}${sciezka}`, { ...init, signal: sygnal });
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
if (cfg().url) {
  odswiez();
  const t = setInterval(odswiez, STAN_MS);
  t.unref?.();
}

module.exports = {
  naSerwer, trasa, ZDOLNOSC_TRASY, stanSerwera, serwerGotowy, doSerwera, ileWDrodze,
  _reset: () => { stan = { kiedy: 0, online: false, caps: {} }; zajete = 0; czekajacy.length = 0; wDrodze.clear(); },
};

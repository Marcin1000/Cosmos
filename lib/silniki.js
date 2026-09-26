/* ============================================================
   Silniki per osoba – kto z czego może korzystać i na czyim koncie

   Decyzja Marcina (wrzesień 2026):
     – chmura NVIDIA jest dla wszystkich,
     – OpenAI, Claude, lokalny GPU i Studio są płatne albo stoją na jego
       sprzęcie, więc członek dostaje je tylko wtedy, gdy właściciel mu je
       PRZYZNA w panelu Dostęp,
     – każdy może też wpisać WŁASNY klucz OpenAI albo Claude i płacić sam.

   Wszystko idzie przez jedno miejsce: `pickEndpoint` w lib/rdzen.js pyta
   tutejszego strażnika. Dzięki temu uprawnienia działają w czacie,
   w streszczaniu, w dopracowaniu promptu i wszędzie, gdzie ktoś kiedyś
   dopisze wywołanie modelu – bez pamiętania, żeby je sprawdzić.

   Przy braku uprawnień strażnik oddaje chmurę NVIDIA, a nie błąd. To jest
   bezpieczny kierunek pomyłki: nikt nie wyda cudzych pieniędzy. Czat
   sprawdza uprawnienie osobno i mówi wprost, czemu nie może.
   ============================================================ */

const path = require('node:path');
const { ENDPOINTS, zapiszAtomowo, czytajJson } = require('./rdzen.js');
const { kto, stan } = require('./kontekst.js');

/* Szablony dla osób z WŁASNYM kluczem, gdy właściciel danego silnika nie ma
   (nie ustawił OPENAI_API_KEY) – wtedy nie ma czego skopiować z ENDPOINTS. */
const SZABLONY = {
  openai: {
    label: 'OpenAI',
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    visionModel: '',
  },
  claude: {
    label: 'Claude',
    baseUrl: (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, ''),
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
    visionModel: '',
    anthropic: true,
  },
};
const Z_WLASNYM_KLUCZEM = Object.keys(SZABLONY);

// ---------------------------------------------------------------------------
// Własne klucze – w prywatnym katalogu osoby, nigdy w odpowiedzi w całości
// ---------------------------------------------------------------------------

function K() {
  return stan('klucze', (katalog) => {
    const plik = path.join(katalog, 'klucze.json');
    const dane = czytajJson(plik, {}) || {};
    return { plik, dane };
  });
}

/** Ostatnie cztery znaki – tyle, żeby rozpoznać, który klucz wpisano. */
const maskuj = (k) => (k ? `…${String(k).slice(-4)}` : '');

function kluczeWidok() {
  const d = K().dane;
  return Object.fromEntries(Z_WLASNYM_KLUCZEM.map((s) => [s, maskuj(d[s])]));
}

function ustawKlucz(nazwa, klucz) {
  if (!Z_WLASNYM_KLUCZEM.includes(nazwa)) {
    throw Object.assign(new Error(`Własny klucz można ustawić tylko dla: ${Z_WLASNYM_KLUCZEM.join(', ')}.`), { kod: 400 });
  }
  const k = K();
  const czysty = String(klucz || '').trim();
  if (czysty) {
    if (czysty.length < 20 || /\s/.test(czysty)) {
      throw Object.assign(new Error('To nie wygląda na klucz API – sprawdź, czy skopiował się w całości.'), { kod: 400 });
    }
    k.dane[nazwa] = czysty;
  } else {
    delete k.dane[nazwa];
  }
  zapiszAtomowo(k.plik, JSON.stringify(k.dane), { mode: 0o600 });
  return kluczeWidok();
}

// ---------------------------------------------------------------------------
// Dostęp
// ---------------------------------------------------------------------------

const ETYKIETA = { local: 'lokalny GPU', openai: 'OpenAI', claude: 'Claude' };

/** Czy bieżąca osoba może użyć silnika – i skąd płyną pieniądze.
 *  { ok, ep, zrodlo: 'wspolny'|'wlasciciel'|'przyznany'|'wlasny', powod } */
function dostep(nazwa, u = kto()) {
  // Nieznana nazwa → chmura, tak jak zawsze robił `pickEndpoint`.
  const n = ['local', 'openai', 'claude'].includes(nazwa) ? nazwa : 'cloud';
  if (n === 'cloud') return { ok: true, ep: ENDPOINTS.cloud, zrodlo: 'wspolny' };

  // Wywołanie wewnętrzne, poza czyimkolwiek żądaniem – silnik serwera.
  if (!u) return ENDPOINTS[n] ? { ok: true, ep: ENDPOINTS[n], zrodlo: 'wlasciciel' } : { ok: false, powod: 'brak' };

  if (u.rola === 'wlasciciel') {
    return ENDPOINTS[n]
      ? { ok: true, ep: ENDPOINTS[n], zrodlo: 'wlasciciel' }
      : { ok: false, powod: `Silnik ${ETYKIETA[n] || n} nie jest skonfigurowany na serwerze.` };
  }

  // Członek: najpierw WŁASNY klucz – wtedy płaci sam, a nie właściciel.
  if (SZABLONY[n]) {
    const wlasny = K().dane[n];
    if (wlasny) return { ok: true, ep: { ...(ENDPOINTS[n] || SZABLONY[n]), apiKey: wlasny }, zrodlo: 'wlasny' };
  }
  if (ENDPOINTS[n] && u.silniki && u.silniki[n]) return { ok: true, ep: ENDPOINTS[n], zrodlo: 'przyznany' };

  return {
    ok: false,
    powod: SZABLONY[n]
      ? `${ETYKIETA[n]} nie jest dla Ciebie włączony. Możesz poprosić właściciela o dostęp albo wpisać własny klucz w Ustawienia → Konto.`
      : `${ETYKIETA[n] || n} nie jest dla Ciebie włączony – poproś właściciela o dostęp.`,
  };
}

/** Strażnik dla `pickEndpoint`: dozwolony silnik albo chmura NVIDIA. */
function wybierz(nazwa) {
  const d = dostep(nazwa);
  return d.ok ? d.ep : ENDPOINTS.cloud;
}

/** Silniki, które bieżąca osoba widzi jako zakładki. */
function dostepne(u = kto()) {
  const nazwy = ['cloud', 'local', ...Z_WLASNYM_KLUCZEM];
  /* Zakładka „Lokalnie" jest zawsze, gdy osoba ma do niej prawo – także bez
     LOCAL_MODEL, bo model wybiera się w Ustawieniach. Tak było przed kontami
     i tak zostaje: ukrycie jej przy pustym .env zabrało właścicielowi zakładkę,
     której używał (wyłapał to zestaw zakladki-silnikow). */
  return nazwy
    .map((n) => ({ n, d: dostep(n, u) }))
    .filter(({ d }) => d.ok)
    .map(({ n, d }) => ({ nazwa: n, zrodlo: d.zrodlo, ep: d.ep }));
}

/* Co członek może na CUDZYM rachunku. Przyznanie „OpenAI" było zgodą na
   każdy model – także taki za 150 $ za milion tokenów – i na dowolne
   max_tokens. Teraz na silniku PRZYZNANYM członek dostaje modele z listy
   właściciela (ten z .env, jego wizyjny i COSMOS_MODELE_PRZYZNANE), a długość
   odpowiedzi ma sufit na każdym wspólnym silniku. Z własnym kluczem płaci
   sam, więc wybiera, co chce. Pusta lista (np. LOCAL_MODEL nieustawiony, model
   wybiera się w Ustawieniach) = bez ograniczenia modelu – inaczej silnik
   przyznany byłby dla członka martwy. */
const SUFIT_TOKENOW_CZLONKA = Number(process.env.COSMOS_MAX_TOKENS_CZLONKA) || 8192;
const MODELE_PRZYZNANE = String(process.env.COSMOS_MODELE_PRZYZNANE || '')
  .split(',').map((m) => m.trim()).filter(Boolean);

/** Granice dla bieżącej osoby na danym silniku albo null (bez granic).
 *  { maxTokens, modele: [...] } – pusta lista modeli = model dowolny. */
function granice(nazwa, u = kto()) {
  if (!u || u.rola === 'wlasciciel') return null;
  const d = dostep(nazwa, u);
  if (!d.ok || d.zrodlo === 'wlasny') return null;
  const modele = d.zrodlo === 'przyznany'
    ? [...new Set([d.ep.model, d.ep.visionModel, ...MODELE_PRZYZNANE].filter(Boolean))]
    : [];
  return { maxTokens: SUFIT_TOKENOW_CZLONKA, modele };
}

/** Model, którego osoba może użyć: zadany albo pierwszy z listy właściciela.
 *  { model, zamiast } – `zamiast` to model zadany, gdy trzeba było go zmienić. */
function modelDozwolony(nazwa, zadany, u = kto()) {
  const g = granice(nazwa, u);
  if (!g || !g.modele.length || !zadany || g.modele.includes(zadany)) return { model: zadany, zamiast: '' };
  return { model: g.modele[0], zamiast: zadany };
}

/** max_tokens po suficie osoby. */
function tokenyDozwolone(nazwa, zadane, u = kto()) {
  const g = granice(nazwa, u);
  return g ? Math.min(zadane, g.maxTokens) : zadane;
}

/** Zmysły (Whisper, Piper, YOLO, wyciąganie tekstu, powiększanie) stoją na
 *  domowym GPU właściciela – to ten sam sprzęt co „lokalny GPU", więc ta sama
 *  zgoda. Bez niej członek ma mikrofon, głos i kamerę z przeglądarki. Wywołanie
 *  bez osoby (praca serwera) – dozwolone. */
function zmyslyDozwolone(u = kto()) {
  return !u || u.rola === 'wlasciciel' || Boolean(u.silniki && u.silniki.local);
}

/** Studio (płatne generowanie obrazów, dźwięku, wideo) – tylko z przyznania. */
function studioDozwolone(u = kto()) {
  return !u || u.rola === 'wlasciciel' || Boolean(u.silniki && u.silniki.studio);
}

module.exports = { SZABLONY, Z_WLASNYM_KLUCZEM, SUFIT_TOKENOW_CZLONKA, maskuj, kluczeWidok, ustawKlucz, dostep, wybierz, dostepne,
  granice, modelDozwolony, tokenyDozwolone, zmyslyDozwolone, studioDozwolone };

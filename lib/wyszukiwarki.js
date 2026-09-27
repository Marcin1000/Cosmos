/* ============================================================
   Wyszukiwarki z kluczem: Serper (wyniki Google) i Brave Search

   Marcin: „zdjęcia i grafiki z internetu działają, ale mógłby wyszukiwać
   lepiej, używając np. Google – tak, żeby jakość informacji, grafik i zdjęć
   była dużo większa”. Bez klucza Cosmos ma tylko DuckDuckGo (skrobane
   z HTML-a, z adresów centrów danych chętnie odmawia), Wikimedia Commons
   i Openverse. Dobre na zabytki, słabe na wszystko inne.

   Dlaczego Serper, a nie Google Custom Search: Google zamknął Custom Search
   JSON API dla nowych klientów. Serper oddaje wyniki Google przez zwykłe API
   (JSON, klucz w nagłówku, darmowa pula na start). Brave Search ma własny
   indeks i własne API. Oba są OPCJONALNE: bez klucza tego modułu po prostu
   nie ma, a reszta działa jak dotąd. Klucz płaci właściciel – wyszukiwanie
   idzie z serwera, dla każdej osoby.

   Klucze czytamy przy każdym wywołaniu, nie przy starcie: test (i operator
   po zmianie .env i restarcie) nie musi się martwić kolejnością `require`.
   ============================================================ */

const cfg = () => ({
  serperKlucz: process.env.SERPER_API_KEY || '',
  serperUrl: (process.env.SERPER_API_URL || 'https://google.serper.dev').replace(/\/+$/, ''),
  braveKlucz: process.env.BRAVE_API_KEY || '',
  braveUrl: (process.env.BRAVE_API_URL || 'https://api.search.brave.com/res/v1').replace(/\/+$/, ''),
  // Język i kraj wyników: Cosmos mówi po polsku, więc domyślnie polskie wyniki.
  kraj: (process.env.SEARCH_COUNTRY || 'pl').toLowerCase(),
  jezyk: (process.env.SEARCH_LANG || 'pl').toLowerCase(),
});

const czysc = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/* KTO PŁACI. Klucz jest właściciela, a wyszukiwanie idzie z serwera dla
   każdej osoby. Członek bez przyznania „Wyszukiwarki” w panelu Dostęp
   korzysta z darmowych źródeł (SearXNG, DuckDuckGo, Commons) jak dotąd;
   z przyznaniem – w granicach limitu na minutę i dobę. Wynik wyszukiwania
   nie jest daną osoby, więc pamięć wyników jest WSPÓLNA: to samo pytanie
   w ciągu kwadransa nie kosztuje drugi raz. Zespół IT, runda 7: członek
   puścił 60 płatnych zapytań w 353 ms, jedna tura ze zdjęciami to było do
   20 zapytań naraz (Serper i Brave równolegle). */
const NA_MINUTE = () => Number(process.env.COSMOS_SZUKANIE_NA_MINUTE) || 20;
const NA_DOBE = () => Number(process.env.COSMOS_SZUKANIE_NA_DOBE) || 300;
const PAMIEC_MS = 15 * 60_000;
const pamiec = new Map();      // klucz → { czas, wynik }
const zuzycie = new Map();     // id osoby → { minuta: [czasy], dzien, ile }

function osoba() {
  try { return require('./kontekst.js').kto(); } catch { return null; }
}

/** Czy bieżącej osobie wolno teraz wydać płatne zapytanie (nie liczy go). */
function platneDozwolone(u = osoba()) {
  if (!u || u.rola === 'wlasciciel') return true;
  if (!(u.silniki && u.silniki.szukanie)) return false;
  const z = zuzycie.get(u.id);
  if (!z) return true;
  const teraz = Date.now();
  const dzien = new Date().toDateString();
  if (z.dzien === dzien && z.ile >= NA_DOBE()) return false;
  return z.minuta.filter((t) => teraz - t < 60_000).length < NA_MINUTE();
}

function policzPlatne(u = osoba()) {
  if (!u || u.rola === 'wlasciciel') return;
  const teraz = Date.now();
  const dzien = new Date().toDateString();
  const z = zuzycie.get(u.id) || { minuta: [], dzien, ile: 0 };
  if (z.dzien !== dzien) { z.dzien = dzien; z.ile = 0; }
  z.minuta = z.minuta.filter((t) => teraz - t < 60_000);
  z.minuta.push(teraz);
  z.ile += 1;
  zuzycie.set(u.id, z);
}

function zPamieci(klucz) {
  const w = pamiec.get(klucz);
  if (!w) return null;
  if (Date.now() - w.czas > PAMIEC_MS) { pamiec.delete(klucz); return null; }
  return w.wynik;
}
function doPamieci(klucz, wynik) {
  pamiec.set(klucz, { czas: Date.now(), wynik });
  // Najstarsze wypadają – Map pamięta kolejność wstawiania.
  while (pamiec.size > 500) pamiec.delete(pamiec.keys().next().value);
}
const kluczPamieci = (rodzaj, q, limit) => `${rodzaj}|${String(q).trim().toLowerCase()}|${limit}`;

/** Które wyszukiwarki z kluczem są włączone DLA BIEŻĄCEJ OSOBY, w kolejności pytania. */
function dostepne() {
  const c = cfg();
  if (!platneDozwolone()) return [];
  return [c.serperKlucz && 'serper', c.braveKlucz && 'brave'].filter(Boolean);
}

/* Treść odpowiedzi jako JSON. Gdy zamiast JSON-a przyszedł HTML (strona
   błędu, pośrednik), komunikat parsera cytuje początek treści – do zdarzeń
   i do `zrodla[].blad` szedł wtedy kawałek odpowiedzi dostawcy. */
async function jsonOdpowiedzi(r) {
  try {
    return await r.json();
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw err;
    throw new Error('odpowiedź nie jest JSON-em');
  }
}

async function serper(sciezka, cialo, timeoutMs, sygnal) {
  const c = cfg();
  const r = await fetch(`${c.serperUrl}/${sciezka}`, {
    method: 'POST',
    headers: { 'X-API-KEY': c.serperKlucz, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gl: c.kraj, hl: c.jezyk, ...cialo }),
    signal: sygnal || AbortSignal.timeout(timeoutMs),
  });
  // Treści odpowiedzi przy błędzie nie oddajemy dalej – bywa w niej echo klucza.
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'zły klucz SERPER_API_KEY' : `HTTP ${r.status}`);
  return jsonOdpowiedzi(r);
}

async function brave(sciezka, parametry, timeoutMs, sygnal) {
  const c = cfg();
  const p = new URLSearchParams({ country: c.kraj, search_lang: c.jezyk, ...parametry });
  const r = await fetch(`${c.braveUrl}/${sciezka}?${p}`, {
    headers: { 'X-Subscription-Token': c.braveKlucz, Accept: 'application/json' },
    signal: sygnal || AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'zły klucz BRAVE_API_KEY' : `HTTP ${r.status}`);
  return jsonOdpowiedzi(r);
}

/* ---------------------------------------------------------------- tekst */

/** Wyniki jednej wyszukiwarki: [{title, url, snippet}] (może być pusto). */
async function wynikiTekstu(nazwa, q, limit, sygnal) {
  let wyniki = [];
  if (nazwa === 'serper') {
    const d = await serper('search', { q, num: 10 }, 0, sygnal);
    /* Ramka odpowiedzi Google („answerBox”) – krótka, konkretna odpowiedź
       z liczbą, której model szuka. Idzie jako pierwszy wynik. */
    const ab = d.answerBox;
    if (ab && (ab.answer || ab.snippet) && ab.link) {
      wyniki.push({ title: czysc(ab.title || 'Odpowiedź'), url: String(ab.link), snippet: czysc(ab.answer || ab.snippet).slice(0, 400) });
    }
    for (const x of d.organic || []) wyniki.push({ title: czysc(x.title), url: String(x.link || ''), snippet: czysc(x.snippet).slice(0, 300) });
  } else {
    const d = await brave('web/search', { q, count: '10' }, 0, sygnal);
    for (const x of (d.web && d.web.results) || []) wyniki.push({ title: czysc(x.title), url: String(x.url || ''), snippet: czysc(x.description).slice(0, 300) });
  }
  const widziane = new Set();
  return wyniki.filter((x) => /^https?:\/\//.test(x.url) && x.title && !widziane.has(x.url) && widziane.add(x.url)).slice(0, limit);
}

/** Wyniki wyszukiwania tekstu: [{title, url, snippet}] z pierwszej wyszukiwarki,
 *  która odpowie. Rzuca, gdy żadna z włączonych nie dała wyników – wołający
 *  wraca wtedy do SearXNG/DuckDuckGo.
 *
 *  `timeoutMs` to limit na CAŁOŚĆ, nie na każdą wyszukiwarkę: wiszący Serper
 *  i wiszący Brave po kolei dawały 16 s, zanim ruszył SearXNG (a kaskada
 *  czatu mnoży to przez liczbę rund). Brave rusza, gdy Serper zawiedzie albo
 *  nie odpowie w połowie limitu – w zwykłym przypadku idzie jedno płatne
 *  zapytanie, nie dwa. */
async function szukajTekstu(q, { limit = 5, timeoutMs = 8000 } = {}) {
  const nazwy = dostepne();
  if (!nazwy.length) throw new Error('brak wyszukiwarki z kluczem');
  const klucz = kluczPamieci('tekst', q, limit);
  const zapamietany = zPamieci(klucz);
  if (zapamietany) return zapamietany;
  const wynik = await szukajTekstuUDostawcow(nazwy, q, limit, timeoutMs);
  doPamieci(klucz, wynik);
  return wynik;
}

function szukajTekstuUDostawcow(nazwy, q, limit, timeoutMs) {
  const sygnal = AbortSignal.timeout(timeoutMs);
  const bledy = [];
  return new Promise((gotowe, porazka) => {
    let nastepny = 0;
    let wToku = 0;
    let koniec = false;
    let zegar = null;
    const zakoncz = () => {
      if (!koniec && wToku === 0 && nastepny >= nazwy.length) {
        koniec = true;
        porazka(new Error(bledy.join('; ')));
      }
    };
    const zapytajKolejna = () => {
      clearTimeout(zegar);
      if (koniec || nastepny >= nazwy.length) return;
      const nazwa = nazwy[nastepny++];
      wToku += 1;
      policzPlatne();
      if (nastepny < nazwy.length) {
        zegar = setTimeout(zapytajKolejna, Math.floor(timeoutMs / 2));
        if (zegar.unref) zegar.unref();
      }
      wynikiTekstu(nazwa, q, limit, sygnal).then((wyniki) => {
        wToku -= 1;
        if (koniec) return;
        if (wyniki.length) {
          koniec = true;
          clearTimeout(zegar);
          gotowe({ wyniki, silnik: nazwa });
          return;
        }
        bledy.push(`${nazwa}: brak wyników`);
        zapytajKolejna();
        zakoncz();
      }, (err) => {
        wToku -= 1;
        if (koniec) return;
        bledy.push(`${nazwa}: ${String((err && err.message) || err).slice(0, 80)}`);
        zapytajKolejna();
        zakoncz();
      });
    };
    zapytajKolejna();
  });
}

/* ---------------------------------------------------------------- zdjęcia */

/* Adresy z wyników dostawcy przechodzą dalej tylko z właściwym schematem.
   Miniatura: wyłącznie https:// (adres względny albo „//host” ominąłby proxy
   miniatur i trafił w nasz własny serwer). Źródło zdjęcia to link na
   ekranie – tylko http(s), `javascript:` i podobne wypadają (bez linku). */
const tylkoHttps = (u) => (typeof u === 'string' && /^https:\/\/[^/\s]/i.test(u) ? u : '');
const tylkoHttp = (u) => (typeof u === 'string' && /^https?:\/\/[^/\s]/i.test(u) ? u : '');

/** Zdjęcia z płatnej wyszukiwarki: najpierw pamięć, potem zapytanie (liczone). */
async function zPamieciAlbo(rodzaj, q, limit, fn) {
  const klucz = kluczPamieci(rodzaj, q, limit);
  const zapamietany = zPamieci(klucz);
  if (zapamietany) return zapamietany;
  policzPlatne();
  const wynik = await fn();
  if (wynik.length) doPamieci(klucz, wynik);
  return wynik;
}

/** Zdjęcia z płatnych wyszukiwarek: Serper, a Brave TYLKO jako zapas, gdy
 *  Serpera nie ma, zawiódł albo dał za mało. Dawniej oba szły równolegle –
 *  każde szukanie zdjęć płaciło podwójnie. */
async function zrodloPlatne(q, { limit, timeoutMs }) {
  const nazwy = dostepne();
  let bladSerpera = null;
  if (nazwy.includes('serper')) {
    try {
      const w = await zrodloSerper(q, { limit, timeoutMs });
      if (w.length >= Math.min(4, limit) || !nazwy.includes('brave')) return w;
    } catch (err) {
      bladSerpera = err;
      if (!nazwy.includes('brave')) throw err;
    }
  }
  if (nazwy.includes('brave')) return zrodloBrave(q, { limit, timeoutMs });
  throw bladSerpera || new Error('brak wyszukiwarki z kluczem');
}

async function zrodloSerper(q, opcje) {
  return zPamieciAlbo('serper-zdjecia', q, opcje.limit, () => zrodloSerperTeraz(q, opcje));
}
async function zrodloBrave(q, opcje) {
  return zPamieciAlbo('brave-zdjecia', q, opcje.limit, () => zrodloBraveTeraz(q, opcje));
}

async function zrodloSerperTeraz(q, { limit, timeoutMs }) {
  const d = await serper('images', { q, num: Math.min(100, Math.max(10, limit)) }, timeoutMs);
  return (d.images || []).slice(0, limit).map((x) => ({
    title: czysc(x.title).slice(0, 160),
    thumb: tylkoHttps(x.thumbnailUrl),
    full: String(x.imageUrl || ''),
    source: tylkoHttp(x.link),
    width: Number(x.imageWidth) || 0,
    height: Number(x.imageHeight) || 0,
    zrodlo: `Google${x.domain ? ` · ${czysc(x.domain)}` : ''}`,
    licencja: '',
  })).filter((x) => x.thumb && /^https:\/\//.test(x.full));
}

async function zrodloBraveTeraz(q, { limit, timeoutMs }) {
  const d = await brave('images/search', { q, count: String(Math.min(100, Math.max(10, limit))), safesearch: 'strict' }, timeoutMs);
  return (d.results || []).slice(0, limit).map((x) => ({
    title: czysc(x.title).slice(0, 160),
    thumb: tylkoHttps(x.thumbnail && x.thumbnail.src),
    full: String((x.properties && x.properties.url) || ''),
    source: tylkoHttp(x.url),
    width: Number(x.properties && x.properties.width) || 0,
    height: Number(x.properties && x.properties.height) || 0,
    zrodlo: `Brave${x.source ? ` · ${czysc(x.source)}` : ''}`,
    licencja: '',
  })).filter((x) => x.thumb && /^https:\/\//.test(x.full));
}

/* Hosty miniatur tych wyszukiwarek – dopisywane do wąskiej listy proxy
   miniatur (lib/szukanie.js). Pełne zdjęcia przeglądarka pobiera sama. */
const HOSTY = [
  'encrypted-tbn0.gstatic.com', 'encrypted-tbn1.gstatic.com',
  'encrypted-tbn2.gstatic.com', 'encrypted-tbn3.gstatic.com',
  'imgs.search.brave.com',
];

module.exports = { dostepne, szukajTekstu, zrodloSerper, zrodloBrave, zrodloPlatne, platneDozwolone, HOSTY,
  _wyczyscPamiec: () => { pamiec.clear(); zuzycie.clear(); } };

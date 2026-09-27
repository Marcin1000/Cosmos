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

/** Które wyszukiwarki z kluczem są włączone, w kolejności pytania. */
function dostepne() {
  const c = cfg();
  return [c.serperKlucz && 'serper', c.braveKlucz && 'brave'].filter(Boolean);
}

async function serper(sciezka, cialo, timeoutMs) {
  const c = cfg();
  const r = await fetch(`${c.serperUrl}/${sciezka}`, {
    method: 'POST',
    headers: { 'X-API-KEY': c.serperKlucz, 'Content-Type': 'application/json' },
    body: JSON.stringify({ gl: c.kraj, hl: c.jezyk, ...cialo }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Treści odpowiedzi przy błędzie nie oddajemy dalej – bywa w niej echo klucza.
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'zły klucz SERPER_API_KEY' : `HTTP ${r.status}`);
  return r.json();
}

async function brave(sciezka, parametry, timeoutMs) {
  const c = cfg();
  const p = new URLSearchParams({ country: c.kraj, search_lang: c.jezyk, ...parametry });
  const r = await fetch(`${c.braveUrl}/${sciezka}?${p}`, {
    headers: { 'X-Subscription-Token': c.braveKlucz, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'zły klucz BRAVE_API_KEY' : `HTTP ${r.status}`);
  return r.json();
}

/* ---------------------------------------------------------------- tekst */

/** Wyniki wyszukiwania tekstu: [{title, url, snippet}] z pierwszej wyszukiwarki,
 *  która odpowie. Rzuca, gdy żadna z włączonych nie dała wyników – wołający
 *  wraca wtedy do SearXNG/DuckDuckGo. */
async function szukajTekstu(q, { limit = 5, timeoutMs = 8000 } = {}) {
  const bledy = [];
  for (const nazwa of dostepne()) {
    try {
      let wyniki = [];
      if (nazwa === 'serper') {
        const d = await serper('search', { q, num: 10 }, timeoutMs);
        /* Ramka odpowiedzi Google („answerBox”) – krótka, konkretna odpowiedź
           z liczbą, której model szuka. Idzie jako pierwszy wynik. */
        const ab = d.answerBox;
        if (ab && (ab.answer || ab.snippet) && ab.link) {
          wyniki.push({ title: czysc(ab.title || 'Odpowiedź'), url: String(ab.link), snippet: czysc(ab.answer || ab.snippet).slice(0, 400) });
        }
        for (const x of d.organic || []) wyniki.push({ title: czysc(x.title), url: String(x.link || ''), snippet: czysc(x.snippet).slice(0, 300) });
      } else {
        const d = await brave('web/search', { q, count: '10' }, timeoutMs);
        for (const x of (d.web && d.web.results) || []) wyniki.push({ title: czysc(x.title), url: String(x.url || ''), snippet: czysc(x.description).slice(0, 300) });
      }
      const widziane = new Set();
      wyniki = wyniki.filter((x) => /^https?:\/\//.test(x.url) && x.title && !widziane.has(x.url) && widziane.add(x.url)).slice(0, limit);
      if (wyniki.length) return { wyniki, silnik: nazwa };
      bledy.push(`${nazwa}: brak wyników`);
    } catch (err) {
      bledy.push(`${nazwa}: ${String(err.message || err).slice(0, 80)}`);
    }
  }
  throw new Error(bledy.join('; ') || 'brak wyszukiwarki z kluczem');
}

/* ---------------------------------------------------------------- zdjęcia */

async function zrodloSerper(q, { limit, timeoutMs }) {
  const d = await serper('images', { q, num: Math.min(100, Math.max(10, limit)) }, timeoutMs);
  return (d.images || []).slice(0, limit).map((x) => ({
    title: czysc(x.title).slice(0, 160),
    thumb: String(x.thumbnailUrl || ''),
    full: String(x.imageUrl || ''),
    source: String(x.link || ''),
    width: Number(x.imageWidth) || 0,
    height: Number(x.imageHeight) || 0,
    zrodlo: `Google${x.domain ? ` · ${czysc(x.domain)}` : ''}`,
    licencja: '',
  })).filter((x) => x.thumb && /^https:\/\//.test(x.full));
}

async function zrodloBrave(q, { limit, timeoutMs }) {
  const d = await brave('images/search', { q, count: String(Math.min(100, Math.max(10, limit))), safesearch: 'strict' }, timeoutMs);
  return (d.results || []).slice(0, limit).map((x) => ({
    title: czysc(x.title).slice(0, 160),
    thumb: String((x.thumbnail && x.thumbnail.src) || ''),
    full: String((x.properties && x.properties.url) || ''),
    source: String(x.url || ''),
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

module.exports = { dostepne, szukajTekstu, zrodloSerper, zrodloBrave, HOSTY };

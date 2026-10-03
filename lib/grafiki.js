/* ============================================================
   Wyszukiwanie grafik – KILKA źródeł, nie jedno

   Dlaczego to osobny moduł i dlaczego źródeł jest kilka.

   Pierwsza wersja miała jedno źródło: DuckDuckGo. Żeby o cokolwiek zapytać,
   trzeba najpierw wyskrobać ze strony HTML żeton `vqd` – i to jest zależność
   od CZEGOŚ, CZEGO NIKT NAM NIE OBIECAŁ. DuckDuckGo może zmienić format tego
   pola (już to robił), odmówić adresowi centrum danych albo po prostu
   przywitać nas captchą. Wtedy Cosmos mówi „szukam zdjęć" i nie pokazuje nic.
   Dokładnie to zgłosił Marcin.

   Jedno źródło bez zapasu to nie jest usterka do naprawienia – to jest wada
   konstrukcyjna. Stąd trzy źródła odpytywane RÓWNOLEGLE:

     • DuckDuckGo       – najszerszy zasięg, ale scraping i żeton
     • Wikimedia Commons – prawdziwe API, bez klucza i bez żetonu; świetne
                          w miejscach i zabytkach, czyli w tym, o co Marcin
                          pyta najczęściej („zdjęcia Krakowa")
     • Openverse        – prawdziwe API, agregat materiałów na licencjach CC

   Równolegle, a nie po kolei, bo czekanie na przeterminowanie pierwszego
   źródła zanim ruszy drugie dawałoby trzykrotny czas oczekiwania w najgorszym
   przypadku. Tak koszt to jeden najwolniejszy strzał zamiast trzech po kolei.

   Wyniki scalamy w kolejności zaufania i odsiewamy duplikaty. Każdy wynik
   niesie swoje źródło i licencję – dla kogoś, kto realnie montuje film,
   „skąd to jest i czy wolno tego użyć" to nie ozdobnik.
   ============================================================ */

const PRZEGLADARKA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// Wikimedia prosi w regulaminie API o kontaktowy User-Agent i tego się trzymamy.
const UA_WIKI = 'Cosmos/2.0 (osobisty asystent; https://cosmosai.live)';

const wyszukiwarki = require('./wyszukiwarki.js');

const czysc = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/* Adresy da się podmienić przez ENV. Dwa powody: testy potrzebują atrapy
   (bez sieci nie sprawdzimy odczytu odpowiedzi), a operator może chcieć
   wskazać własne lustro albo instancję Openverse. */
const COMMONS_API = process.env.COMMONS_API_URL || 'https://commons.wikimedia.org/w/api.php';
const OPENVERSE_API = process.env.OPENVERSE_API_URL || 'https://api.openverse.org/v1/images/';
/* SearXNG – WŁASNA metawyszukiwarka, jeśli operator ją postawił.
   Nie ma domyślnego adresu i to jest celowe: publiczne instancje SearXNG
   ograniczają ruch i bywają wyłączane, więc wskazanie cudzej z automatu
   dołożyłoby czwarte niepewne źródło zamiast pewnego. Pusty adres = źródło
   po prostu nie istnieje, reszta działa jak dotąd. */
const SEARXNG_URL = (process.env.SEARXNG_URL || '').replace(/\/+$/, '');

/* ---------------------------------------------------------------- DuckDuckGo */

async function zrodloDdg(q, { start, limit, timeoutMs }) {
  const r0 = await fetch(`${start}?q=${encodeURIComponent(q)}&iax=images&ia=images`, {
    headers: { 'User-Agent': PRZEGLADARKA, 'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.6' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r0.ok) throw new Error(`strona startowa ${r0.status}`);
  const html = await r0.text();
  // Format tego pola zmieniał się już kilka razy – bierzemy wszystkie znane.
  const m = html.match(/vqd=["']([^"']+)["']/) || html.match(/vqd=([\d-]+)&/)
    || html.match(/"vqd":\s*"([^"]+)"/);
  if (!m) throw new Error('brak żetonu vqd');

  const adres = `${start}i.js?l=pl-pl&o=json&q=${encodeURIComponent(q)}`
    + `&vqd=${encodeURIComponent(m[1])}&f=,,,&p=1`;
  const r = await fetch(adres, {
    headers: {
      'User-Agent': PRZEGLADARKA,
      'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.6',
      Referer: start,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`i.js ${r.status}`);
  const dane = await r.json();
  return (dane.results || []).slice(0, limit).map((x) => ({
    title: czysc(x.title).slice(0, 160),
    thumb: String(x.thumbnail || x.image || ''),
    full: String(x.image || ''),
    source: String(x.url || ''),
    width: Number(x.width) || 0,
    height: Number(x.height) || 0,
    zrodlo: 'DuckDuckGo',
    licencja: '',
  })).filter((x) => x.thumb);
}

/* -------------------------------------------------------------------- SearXNG */

/* Własna instancja metawyszukiwarki. Sama pyta Google, Bing, Brave, Qwant
   i kilkanaście innych, i sama radzi sobie z tym, że któryś odmówi.

   Nie znosi to blokad magicznie – SearXNG na tym samym VPS-ie wychodzi z tego
   samego adresu, więc też może dostać captchę. Różnica jest inna i ważniejsza:
   utrzymywaniem kilkunastu silników i nadążaniem za zmianami ich formatów
   zajmuje się projekt z pięcioletnią historią, a nie nasze trzy scrapery. */
async function zrodloSearxng(q, { limit, timeoutMs }) {
  const p = new URLSearchParams({ q, format: 'json', categories: 'images', language: 'pl' });
  const r = await fetch(`${SEARXNG_URL}/search?${p}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA_WIKI },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    /* Świeży SearXNG ma wyłączone wyjście JSON i odpowiada 403 – to najczęstsza
       pomyłka przy stawianiu, więc mówimy wprost, co poprawić. */
    throw new Error(r.status === 403
      ? 'API 403 – dopisz `- json` do `search.formats` w settings.yml'
      : `API ${r.status}`);
  }
  const dane = await r.json();
  return (dane.results || []).slice(0, limit).map((x) => ({
    title: czysc(x.title).slice(0, 160),
    thumb: String(x.thumbnail_src || x.img_src || ''),
    full: String(x.img_src || ''),
    source: String(x.url || ''),
    width: Number(x.resolution && String(x.resolution).split('x')[0]) || 0,
    height: Number(x.resolution && String(x.resolution).split('x')[1]) || 0,
    zrodlo: 'SearXNG',
    licencja: czysc(x.source || ''),
  })).filter((x) => x.thumb);
}

/* ---------------------------------------------------------- Wikimedia Commons */

async function zrodloCommons(q, { limit, timeoutMs }) {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: q,
    gsrnamespace: '6',            // przestrzeń „Plik:"
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '400',            // Commons sam zrobi miniaturę tej szerokości
  });
  const r = await fetch(`${COMMONS_API}?${p}`, {
    headers: { 'User-Agent': UA_WIKI, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  const dane = await r.json();
  const strony = (dane.query && dane.query.pages) || {};
  return Object.values(strony).map((s) => {
    const info = (s.imageinfo && s.imageinfo[0]) || null;
    if (!info || !info.thumburl) return null;
    const meta = info.extmetadata || {};
    return {
      title: czysc(s.title).replace(/^Plik:|^File:/i, '').slice(0, 160),
      thumb: info.thumburl,
      full: info.url || info.thumburl,
      source: info.descriptionurl || '',
      width: Number(info.width) || 0,
      height: Number(info.height) || 0,
      zrodlo: 'Wikimedia Commons',
      licencja: czysc((meta.LicenseShortName && meta.LicenseShortName.value) || '').slice(0, 40),
    };
  }).filter(Boolean);
}

/* -------------------------------------------------------------------- Openverse */

async function zrodloOpenverse(q, { limit, timeoutMs }) {
  const p = new URLSearchParams({ q, page_size: String(limit) });
  const r = await fetch(`${OPENVERSE_API}?${p}`, {
    headers: { 'User-Agent': UA_WIKI, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`API ${r.status}`);
  const dane = await r.json();
  return (dane.results || []).slice(0, limit).map((x) => ({
    title: czysc(x.title).slice(0, 160),
    thumb: String(x.thumbnail || x.url || ''),
    full: String(x.url || ''),
    source: String(x.foreign_landing_url || x.url || ''),
    width: Number(x.width) || 0,
    height: Number(x.height) || 0,
    zrodlo: 'Openverse',
    licencja: czysc(x.license ? `${x.license} ${x.license_version || ''}` : '').toUpperCase().slice(0, 40),
  })).filter((x) => x.thumb);
}

/* ------------------------------------------------------------------- odsiew */

/* Znak, herb, flaga, mapa, ikona – to nie zdjęcie miejsca. Marcin dostał przy
   „Ortigia” logo klubu sportowego (runda 12): wyszukiwarki obrazów oddają
   herby i loga drużyn o tej samej nazwie, a Commons – mapy i schematy. */
const NIE_ZDJECIE = /(^|[^\p{L}])(logo|logotyp|logotipo|stemma|crest|coat[ _-]?of[ _-]?arms|herb|emblem|emblemat|escudo|wappen|blason|flag|flaga|bandiera|icon|ikona|map|mapa|mappa|karte|locator|diagram|schemat|plan[ _-]miasta|svg|clipart|vector|wektor)([^\p{L}]|$)/iu;

/** Czy wynik wygląda na zdjęcie miejsca: bez logo, herbu, mapy, ikony i bez
 *  plików wektorowych; znane wymiary nie mniejsze niż 240×160 px. */
function toZdjecieMiejsca(x) {
  if (!x) return false;
  const tekst = `${x.title || ''} ${x.full || ''} ${x.source || ''}`;
  if (NIE_ZDJECIE.test(tekst)) return false;
  if (/\.svg(\.png)?(\?|$)/i.test(String(x.full || x.thumb || ''))) return false;
  const w = Number(x.width) || 0; const h = Number(x.height) || 0;
  if (w && h && (w < 240 || h < 160)) return false;
  return true;
}

/* ------------------------------------------------------------------------ scal */

/** Ten sam obraz potrafi wrócić z dwóch źródeł – poznajemy go po pełnym
 *  adresie, a gdy go brak, po miniaturze. */
function bezDuplikatow(lista) {
  const widziane = new Set();
  const out = [];
  for (const x of lista) {
    const klucz = (x.full || x.thumb || '').replace(/^https?:\/\//, '').split('?')[0].toLowerCase();
    if (!klucz || widziane.has(klucz)) continue;
    widziane.add(klucz);
    out.push(x);
  }
  return out;
}

/**
 * Poszukaj grafik we wszystkich dostępnych źródłach naraz.
 *
 * Zawsze oddaje obiekt – nigdy nie rzuca. Gdy wszystkie źródła zawiodą,
 * `results` jest puste, a `bledy` mówi KTÓRE i DLACZEGO. To nie jest
 * ozdobnik: bez tego „nie pokazuje zdjęć" jest nie do zdiagnozowania
 * z drugiej strony ekranu.
 */
async function szukajGrafik(q, opcje = {}) {
  const limit = Number(opcje.limit) || 8;
  const timeoutMs = Number(opcje.timeoutMs) || 9000;
  const start = opcje.ddgStart || 'https://duckduckgo.com/';
  const tylko = opcje.zrodla || null;   // do testów: ogranicz zestaw źródeł

  const zKluczem = wyszukiwarki.dostepne();
  const wszystkie = [
    /* Wyszukiwarki z kluczem (Serper = Google, Brave) – najlepsza jakość, gdy
       operator je włączył (lib/wyszukiwarki.js).
       Jedno źródło, nie dwa: Brave jest zapasem Serpera, nie drugim
       płatnym zapytaniem do każdego zdjęcia (zespół IT, runda 7). */
    ...(zKluczem.length ? [[zKluczem.includes('serper') ? 'serper' : 'brave', (x) => wyszukiwarki.zrodloPlatne(x, { limit, timeoutMs })]] : []),
    // Własna instancja idzie pierwsza: to jedyne źródło, nad którym mamy kontrolę.
    ...(SEARXNG_URL ? [['searxng', (x) => zrodloSearxng(x, { limit, timeoutMs })]] : []),
    ['duckduckgo', (x) => zrodloDdg(x, { start, limit, timeoutMs })],
    ['commons', (x) => zrodloCommons(x, { limit, timeoutMs })],
    ['openverse', (x) => zrodloOpenverse(x, { limit, timeoutMs })],
  ].filter(([nazwa]) => !tylko || tylko.includes(nazwa));

  const wyniki = await Promise.all(wszystkie.map(async ([nazwa, fn]) => {
    try {
      return { nazwa, obrazy: await fn(q), blad: '' };
    } catch (err) {
      return { nazwa, obrazy: [], blad: String(err.message || err).slice(0, 120) };
    }
  }));

  /* Scalamy NA PRZEMIAN, po jednym z każdego źródła, a nie „najpierw całe
     DuckDuckGo". Dwa powody, oba praktyczne:

     • DuckDuckGo oddaje przypadkowe obrazy z sieci – często znaki wodne
       i agregatory. Commons i Openverse dają materiał na jasnej licencji,
       więc dla kogoś, kto realnie montuje film, bywają WARTOŚCIOWSZE.
       Przy sklejaniu po kolei nie pokazałyby się nigdy: DuckDuckGo sam
       wypełniał wszystkie osiem miejsc.
     • Awarię jednego źródła widać wtedy od razu, a nie dopiero wtedy, gdy
       padną wszystkie. */
  /* Z wyszukiwarką z kluczem dwa piętra: najpierw na przemian Google/Brave
     i Commons (najlepsze zdjęcia miejsc), dopiero potem reszta. Bez tego
     DuckDuckGo i Openverse dalej zajmowałyby co drugie miejsce w ósemce. */
  const przeplatanka = (lista) => {
    const kolejki = lista.map((w) => [...w.obrazy]);
    const out = [];
    while (kolejki.some((k) => k.length)) for (const k of kolejki) if (k.length) out.push(k.shift());
    return out;
  };
  const gorne = zKluczem.length ? ['serper', 'brave', 'commons'] : [];
  const przeplot = [
    ...przeplatanka(wyniki.filter((w) => gorne.includes(w.nazwa))),
    ...przeplatanka(wyniki.filter((w) => !gorne.includes(w.nazwa))),
  ];
  const scalone = bezDuplikatow(przeplot.filter(toZdjecieMiejsca)).slice(0, limit);
  return {
    query: q,
    results: scalone,
    zrodla: wyniki.map((w) => ({ nazwa: w.nazwa, ile: w.obrazy.length, blad: w.blad })),
    bledy: wyniki.filter((w) => w.blad).map((w) => `${w.nazwa}: ${w.blad}`),
  };
}

/* Hosty, z których wolno przepuścić miniaturę przez proxy Cosmosa.
   Lista jest WĄSKA celowo – otwarte proxy to narzędzie do skanowania sieci
   lokalnej cudzymi rękami. Każdy host odpowiada jednemu ze źródeł wyżej. */
const HOSTY = [
  'external-content.duckduckgo.com',
  'duckduckgo.com',
  'upload.wikimedia.org',
  'commons.wikimedia.org',
  'api.openverse.org',
];

HOSTY.push(...wyszukiwarki.HOSTY);

/* Miniatury z własnego SearXNG też muszą przejść przez proxy. */
try { if (SEARXNG_URL) HOSTY.push(new URL(SEARXNG_URL).hostname); } catch { /* zły adres */ }

module.exports = {
  szukajGrafik, HOSTY, bezDuplikatow, toZdjecieMiejsca,
  zrodloCommons, zrodloOpenverse, zrodloDdg, zrodloSearxng,
};

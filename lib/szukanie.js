/* ============================================================
   Wyszukiwanie w internecie (DuckDuckGo HTML — bez klucza API)

   Model prosi o wyszukanie znacznikiem [SZUKAJ: …], a Cosmos nie tylko
   zbiera linki, ale POBIERA TREŚĆ dwóch pierwszych stron. Bez tego model
   dostawał same tytuły i w kółko prosił o kolejne wyszukiwanie.

   Budżety czasu są tu krytyczne dla płynności: model potrafi zrobić trzy
   rundy, więc każda sekunda mnoży się przez trzy.
   ============================================================ */

const http = require('node:http');
const { SEARCH_URL, sendJson } = require('./rdzen.js');
const { addEvent } = require('./zdarzenia.js');
const { szukajGrafik, HOSTY: HOSTY_GRAFIK } = require('./grafiki.js');

// ---------------------------------------------------------------------------
// API: wyszukiwanie w internecie (DuckDuckGo HTML — bez klucza API)
// ---------------------------------------------------------------------------

// Nazwane encje, które realnie sypią się ze stron — stopnie przy pogodzie,
// polskie znaki, myślniki i cudzysłowy. Bez tego model dostawał „7&deg;C”
// zamiast „7°C” i nie umiał odczytać liczby, o którą pytał użytkownik.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', deg: '°',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', bdquo: '„', sbquo: '‚',
  copy: '©', reg: '®', trade: '™', euro: '€', pound: '£', middot: '·',
  times: '×', divide: '÷', plusmn: '±', frac12: '½', frac14: '¼', sup2: '²', sup3: '³',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  agrave: 'à', egrave: 'è', ccedil: 'ç', ntilde: 'ñ',
  auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß', aring: 'å', oslash: 'ø',
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z][a-z0-9]{1,9});/gi, (whole, name) => {
      const lower = name.toLowerCase();
      if (NAMED_ENTITIES[name]) return NAMED_ENTITIES[name];
      // wielkość liter rozróżnia tylko litery akcentowane (&Ouml; vs &ouml;)
      if (NAMED_ENTITIES[lower]) {
        const v = NAMED_ENTITIES[lower];
        return name[0] === name[0].toUpperCase() && /[a-zà-ÿ]/i.test(v) ? v.toUpperCase() : v;
      }
      return whole;                 // nieznana encja — zostaw, nie zgaduj
    });
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Rozpakuj adres wyniku DuckDuckGo. Zwraca '' dla pozycji, których nie chcemy.
 *
 * Wyniki przychodzą w trzech postaciach:
 *  • zwykły link — bierzemy jak jest,
 *  • przekierowanie `//duckduckgo.com/l/?uddg=<zakodowany-adres>` — rozpakowujemy,
 *  • REKLAMA `//duckduckgo.com/y.js?ad_domain=…&click_metadata=…` — odrzucamy.
 *
 * Reklamy trafiały do odpowiedzi jako „źródła”. Po kliknięciu użytkownik
 * dostawał stronę DuckDuckGo z „Oops, there was an error”, bo te adresy są
 * jednorazowe i wygasają — a model i tak nie mógł z nich nic wyczytać.
 */
function resolveDdgUrl(href) {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try { href = decodeURIComponent(m[1]); } catch { /* zostaw jak jest */ }
  }
  const full = href.startsWith('//') ? 'https:' + href : href;
  let u;
  try { u = new URL(full); } catch { return ''; }
  if (!/^https?:$/.test(u.protocol)) return '';
  // wszystko, co zostało na duckduckgo.com, to reklama albo strona pomocnicza
  if (/(^|\.)duckduckgo\.com$/i.test(u.hostname)) return '';
  return u.href;
}

/** Pobierz czytelny tekst ze strony wyniku.
 *
 * Bez tego model dostawał wyłącznie tytuły, adresy i zajawki z wyszukiwarki —
 * a w zajawce nie ma liczby, o którą pytał użytkownik („ile jest stopni”).
 * Skutek: model szukał znowu i znowu, aż wyczerpał limit rund i nic nie podał.
 * Tutaj wchodzimy na stronę i wyciągamy sam tekst.
 */
/* Budżety wyszukiwania. Przy trzech rundach każda sekunda mnoży się przez
   trzy: 12 s + 7 s dawało do 57 s ciszy zanim padnie odpowiedź. Strona, która
   nie odda treści w 5 s, i tak najczęściej ładuje ją skryptem — a wtedy nic
   z niej nie mamy. */
const SZUKANIE_LINKI_MS = Number(process.env.SEARCH_TIMEOUT_MS || 8000);
const SZUKANIE_STRONA_MS = Number(process.env.PAGE_TIMEOUT_MS || 5000);

async function fetchPageText(pageUrl, maxChars = 2500) {
  try {
    const r = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.6',
      },
      signal: AbortSignal.timeout(SZUKANIE_STRONA_MS),
      redirect: 'follow',
    });
    if (!r.ok) return '';
    const type = r.headers.get('content-type') || '';
    if (!/text\/html|text\/plain/i.test(type)) return '';

    // Czytamy z górnym limitem — nie chcemy wciągnąć kilkumegabajtowej strony.
    const raw = (await r.text()).slice(0, 400000);
    const body = raw
      .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, '\n');
    return stripTags(body.replace(/\n\s*\n+/g, '\n')).slice(0, maxChars);
  } catch {
    return '';                        // strona niedostępna — zostają zajawki
  }
}

/* Wyszukiwanie STRON przez własny SearXNG, gdy operator go postawił.
 *
 * Ta droga jest lepsza od skrobania HTML-a DuckDuckGo z tego samego powodu,
 * co przy grafikach: SearXNG pyta kilkanaście silników i sam sobie radzi,
 * gdy któryś odmówi, a my dostajemy czysty JSON zamiast wyrażeń regularnych
 * na klasach CSS, które potrafią się zmienić z dnia na dzień.
 *
 * Rzuca wyjątkiem przy niepowodzeniu — wołający wraca wtedy do DuckDuckGo.
 */
async function szukajPrzezSearxng(q) {
  const adres = (process.env.SEARXNG_URL || '').replace(/\/+$/, '');
  const p = new URLSearchParams({ q, format: 'json', language: 'pl' });
  const r = await fetch(`${adres}/search?${p}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Cosmos/2.0' },
    signal: AbortSignal.timeout(SZUKANIE_LINKI_MS),
  });
  if (!r.ok) {
    throw new Error(r.status === 403
      ? 'SearXNG 403 — dopisz `- json` do `search.formats` w settings.yml'
      : `SearXNG ${r.status}`);
  }
  const dane = await r.json();
  return (dane.results || []).slice(0, 5).map((x) => ({
    title: stripTags(String(x.title || '')),
    url: String(x.url || ''),
    snippet: stripTags(String(x.content || '')).slice(0, 300),
  })).filter((x) => x.url && x.title);
}

/* Konkret spod `fetch failed`. Node chowa go w `err.cause` — zwykle jako
   `code` (ENOTFOUND, ECONNRESET, ENETUNREACH), czasem tylko jako komunikat. */
function przyczyna(err) {
  const c = err && err.cause;
  if (!c) return '';
  const kod = c.code || c.message;
  return kod ? `, przyczyna: ${String(kod).slice(0, 80)}` : '';
}

async function handleSearch(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  if (!q) return sendJson(res, 400, { error: 'Brak zapytania (parametr q).' });

  /* Najpierw własna instancja, gdy istnieje. Jej awaria NIE kończy sprawy —
     spadamy do DuckDuckGo, bo lepiej mieć gorsze wyniki niż żadnych. */
  if (process.env.SEARXNG_URL) {
    try {
      const results = await szukajPrzezSearxng(q);
      if (results.length) {
        addEvent('internet', `szukanie: „${q}" (${results.length} wyników — SearXNG)`);
        return sendJson(res, 200, { query: q, results, silnik: 'searxng' });
      }
    } catch (err) {
      addEvent('internet', `SearXNG zawiódł (${String(err.message).slice(0, 60)}) — wracam do DuckDuckGo`);
    }
  }

  try {
    const upstream = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
        'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.6',
      },
      signal: AbortSignal.timeout(SZUKANIE_LINKI_MS),
    });
    const html = await upstream.text();

    const results = [];
    const linkRe = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const snipRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const links = [...html.matchAll(linkRe)];
    const snips = [...html.matchAll(snipRe)];
    const seen = new Set();
    for (let i = 0; i < links.length && results.length < 5; i++) {
      const url = resolveDdgUrl(decodeEntities(links[i][1]));
      if (!url) continue;                    // reklama albo adres nie do użycia
      if (seen.has(url)) continue;           // ten sam wynik dwa razy
      seen.add(url);
      results.push({
        title: stripTags(links[i][2]),
        url,
        snippet: snips[i] ? stripTags(snips[i][1]).slice(0, 300) : '',
      });
    }
    /* PUSTY WYNIK PRZY NIE-200 TO ODMOWA, NIE BRAK TRAFIEŃ.
       DuckDuckGo ogranicza ruch z adresów centrów danych: po dwóch zapytaniach
       zaczyna oddawać stronę weryfikacyjną — ale ze statusem 202, więc `r.ok`
       jest prawdą, a `fetch` nie rzuca. Kod leciał dalej, nie znajdował ani
       jednej klasy `result__a` i meldował „0 wyników", jakby internet nie miał
       nic na ten temat. Zmierzone na VPS-ie Marcina: próby 1-2 dały HTTP 200
       i 33 tys. znaków, próby 3-10 — HTTP 202 i zawsze te same 14 tys.

       Rozróżnienie jest ważne, bo prowadzi do innych działań: przy braku
       trafień zawęża się zapytanie, przy odmowie trzeba postawić SearXNG. */
    if (!results.length && upstream.status !== 200) {
      addEvent('internet', `wyszukiwarka odmówiła (HTTP ${upstream.status}) — „${q}"`);
      return sendJson(res, 200, {
        query: q,
        results: [],
        error: `Wyszukiwarka ogranicza ruch z tego serwera (HTTP ${upstream.status}) `
          + 'i zamiast wyników oddała stronę weryfikacyjną. To nie jest awaria połączenia. '
          + 'Trwałe rozwiązanie: własna instancja SearXNG (zmienna SEARXNG_URL).',
      });
    }

    // Treść dwóch pierwszych trafień — równolegle, żeby nie sumować opóźnień.
    const texts = await Promise.all(results.slice(0, 2).map((r) => fetchPageText(r.url)));
    texts.forEach((txt, i) => { if (txt) results[i].text = txt; });

    const withText = texts.filter(Boolean).length;
    addEvent('internet', `wyszukano: „${q}” (${results.length} wyników, ${withText} z treścią)`);
    sendJson(res, 200, { query: q, results });
  } catch (err) {
    sendJson(res, 200, {
      query: q,
      results: [],
      /* Nie zgadujemy przyczyny: „sprawdź internet" przy błędzie w kodzie
         wysyła człowieka w złą stronę (tak było z `addEvent is not defined`).

         Sam ten komentarz był przez chwilę nieprawdą. `fetch` w Node zawsze
         rzuca gołym „fetch failed", a konkret — ENOTFOUND, ECONNRESET,
         CERT_HAS_EXPIRED — chowa w `err.cause`. Kod tego nie pokazywał,
         więc każda awaria wyglądała identycznie i doradzała sprawdzenie
         połączenia. Marcin miał połączenie sprawne; stracił na tej
         podpowiedzi dobre pół godziny. Dokładamy przyczynę. */
      error: /fetch failed|timeout|abort|ENOTFOUND|ECONN/i.test(err.message)
        ? `Wyszukiwarka nie odpowiada (${err.message}${przyczyna(err)}).`
        : `Błąd wyszukiwania: ${err.message}${przyczyna(err)}`,
    });
  }
}

/* ---------------------------------------------------------------------------
   Wyszukiwanie GRAFIK

   Cosmos umiał wygenerować obraz, ale nie umiał ŻADNEGO znaleźć — na prośbę
   „pokaż zdjęcia tych miejsc" model uczciwie odpowiadał „nie mam dostępu do
   wyszukiwania obrazów" i proponował wizje artystyczne zamiast Majorki.

   Samo szukanie mieszka w `lib/grafiki.js`, bo źródeł jest kilka i pytamy je
   równolegle. Jedno źródło (DuckDuckGo ze skrobanym żetonem `vqd`) okazało się
   wadą konstrukcyjną: kiedy odmawiało, Cosmos mówił „szukam zdjęć" i nie
   pokazywał nic. Tutaj zostaje już tylko obsługa trasy HTTP.
   --------------------------------------------------------------------------- */
const DDG_START = process.env.IMAGE_SEARCH_URL || 'https://duckduckgo.com/';
const GRAFIKI_MAX = Number(process.env.IMAGE_SEARCH_MAX || 8);

/* Które źródła wolno odpytać. Domyślnie wszystkie; `IMAGE_SEARCH_SOURCES`
   pozwala zawęzić (testy z atrapą, albo świadoma decyzja operatora). */
const ZRODLA_GRAFIK = (process.env.IMAGE_SEARCH_SOURCES || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

async function handleSearchImages(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  if (!q) return sendJson(res, 400, { error: 'Brak zapytania (parametr q).' });

  /* Całą robotę robi `lib/grafiki.js`, bo źródeł jest kilka i pytamy je
     równolegle. Tutaj zostaje tylko to, co dotyczy TEJ trasy: dziennik
     zdarzeń i zamiana wyniku na odpowiedź HTTP. */
  const wynik = await szukajGrafik(q, {
    limit: GRAFIKI_MAX,
    timeoutMs: SZUKANIE_LINKI_MS,
    ddgStart: DDG_START,
    zrodla: ZRODLA_GRAFIK.length ? ZRODLA_GRAFIK : null,
  });

  const opisZrodel = wynik.zrodla.map((z) => `${z.nazwa}:${z.blad ? 'błąd' : z.ile}`).join(' ');
  addEvent('internet', `grafiki: „${q}” (${wynik.results.length} obrazów — ${opisZrodel})`);

  /* Gdy nie ma ANI JEDNEGO obrazu, mówimy które źródło i dlaczego padło.
     Bez tego „Cosmos nie pokazuje zdjęć" jest nie do zdiagnozowania. */
  sendJson(res, 200, {
    query: q,
    results: wynik.results,
    zrodla: wynik.zrodla,
    error: wynik.results.length ? '' : (wynik.bledy.join('; ') || 'Żadne źródło nie zwróciło obrazów.'),
  });
}

/* Miniatury idą przez Cosmos, nie prosto do przeglądarki. Powody dwa:
   telefon nie łączy się wtedy z cudzym CDN-em przy każdym wyniku, a strona
   działa też wtedy, gdy sieć blokuje ten CDN.

   To jest proxy, więc musi być WĄSKIE — inaczej robi się z niego narzędzie do
   skanowania sieci lokalnej cudzymi rękami (SSRF). Stąd: tylko https, tylko
   znane hosty DuckDuckGo, tylko odpowiedzi będące obrazem, z limitem rozmiaru. */
const HOSTY_MINIATUR = [...HOSTY_GRAFIK];
/* Gdy wyszukiwarkę grafik podmieniono przez ENV (atrapa w testach, własny
   serwer), jej host też musi być dozwolony — inaczej proxy blokuje własne
   wyniki. Rozszerzenie idzie z konfiguracji operatora, nie z żądania. */
for (const adres of [DDG_START, process.env.COMMONS_API_URL, process.env.OPENVERSE_API_URL]) {
  if (!adres) continue;
  try { HOSTY_MINIATUR.push(new URL(adres).hostname); } catch { /* zostaje domyślna lista */ }
}
const MINIATURA_MAX_B = Number(process.env.IMAGE_PROXY_MAX_BYTES || 3_000_000);

async function handleImageProxy(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const cel = url.searchParams.get('u') || '';
  let docelowy;
  try { docelowy = new URL(cel); } catch { return sendJson(res, 400, { error: 'Zły adres.' }); }
  // Poza testami wymagamy https: proxy nie może służyć do zaglądania
  // po http w sieć lokalną serwera.
  const lokalnaAtrapa = docelowy.origin === (() => {
    try { return new URL(DDG_START).origin; } catch { return null; }
  })();
  if (docelowy.protocol !== 'https:' && !lokalnaAtrapa) {
    return sendJson(res, 400, { error: 'Tylko https.' });
  }
  if (!HOSTY_MINIATUR.includes(docelowy.hostname)) {
    return sendJson(res, 403, { error: 'Ten host nie jest na liście miniatur.' });
  }
  try {
    const r = await fetch(docelowy.href, {
      headers: { 'User-Agent': 'Cosmos/1.0', Referer: DDG_START },
      signal: AbortSignal.timeout(SZUKANIE_STRONA_MS),
    });
    const typ = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//i.test(typ)) return sendJson(res, 502, { error: 'To nie jest obraz.' });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MINIATURA_MAX_B) return sendJson(res, 502, { error: 'Miniatura za duża.' });
    res.writeHead(200, {
      'Content-Type': typ,
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(buf);
  } catch (err) {
    sendJson(res, 502, { error: `Nie udało się pobrać miniatury: ${err.message}` });
  }
}

/** Czy MAMY PEWNOŚĆ, że model nie odczyta obrazu?
 *
 * Katalog `public/models.js` jest wspólny dla przeglądarki i serwera — ta sama
 * wiedza po obu stronach, jedno miejsce do aktualizacji. Odpowiadamy „tak”
 * tylko dla modeli, które katalog zna i które nie mają cechy „wizja”.
 * Model nieznany przepuszczamy: może widzieć, a my byśmy go zablokowali.
 */


/* fetchPageText i decodeEntities wychodzą, żeby dało się je przetestować
   wprost. Wcześniej test wycinał je z server.js regexem i eval-ował —
   psuło się przy każdym dołożeniu stałej między funkcjami, choć sam kod
   działał bez zarzutu. */
module.exports = {
  handleSearch, handleSearchImages, handleImageProxy,
  stripTags, fetchPageText, decodeEntities, resolveDdgUrl,
  SZUKANIE_LINKI_MS, SZUKANIE_STRONA_MS, HOSTY_MINIATUR,
};

/* ============================================================
   Baza wiedzy — pliki, linki i notatki osoby

   Tekst wyciągany lokalnie (pliki tekstowe, PDF, Office) lub przez usługę
   zmysłów (skany → /extract, audio/wideo → /stt, obrazy → /detect). Każda
   pozycja dzielona na fragmenty z wektorami, żeby czat mógł przywołać te,
   które pasują do pytania.

   Wydzielone z server.js (runda 3). Stan osoby (U().kbItems) wyłącznie przez
   U() wołane W FUNKCJI — nigdy wartość przy starcie (zasada 4 z CLAUDE.md).
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const { zapiszAtomowo } = require('./rdzen.js');
const miejsce_ = require('./miejsce.js');
const silniki = require('./silniki.js');
const { kto, wKontekscie, czyWlasciciel } = require('./kontekst.js');
const { czytajLokalnie, OBSLUGIWANE: DOK_OBSLUGIWANE } = require('./dokumenty.js');
const { pobierzStrone } = require('./pobieranie.js');
const { cosine, sameModel, keywordScore, wektorDla, ustawWektor, maWektor } = require('./pamiec.js');

/**
 * @param {object} z
 * @param {Function} z.U              stan bieżącej osoby (lib/stan-osoby.js)
 * @param {Function} z.readJson       odczyt JSON-a z żądania
 * @param {Function} z.readBodyBuffer odczyt surowego ciała z limitem
 * @param {Function} z.sendJson       odpowiedź JSON
 * @param {Function} z.bladZapisu     odpowiedź na nieudany zapis (507/500)
 * @param {Function} z.addEvent       dziennik zdarzeń
 * @param {Function} z.embedTexts     wektory tekstów (pamięć bieżącej osoby)
 * @param {Function} z.stripTags      HTML → tekst (tytuł strony)
 * @param {Function} z.czytelnyTekst  HTML → czytelna treść strony
 * @param {string}   z.SENSES_URL     adres usługi zmysłów
 */
function utworz({ U, readJson, readBodyBuffer, sendJson, bladZapisu, addEvent, embedTexts, stripTags, czytelnyTekst, SENSES_URL }) {
  const { zapiszLubBlad } = miejsce_;

  const KB_DIR = () => path.join(U().katalog, 'kb');
  /* Największy plik do bazy wiedzy. 95 MB, bo Cloudflare odrzuca ciało powyżej
     100 MB własną stroną 413, zanim cokolwiek dojdzie do serwera. */
  const KB_PLIK_MAX = (Number(process.env.COSMOS_KB_MAX_MB) || 95) * 1024 * 1024;
  const KB_FILES = () => path.join(KB_DIR(), 'files');
  const KB_INDEX = () => path.join(KB_DIR(), 'index.json');
  const BUDZET_PYTANIA_MS = Number(process.env.MEMORY_SEARCH_BUDGET_MS || 1200);

  function saveKb() {
    return zapiszLubBlad('bazy wiedzy', () => {
      fs.mkdirSync(KB_FILES(), { recursive: true });
      // `.bak`: indeksu bazy wiedzy nie da się odbudować z plików — opisy i wektory są tylko tu.
      zapiszAtomowo(KB_INDEX(), JSON.stringify(U().kbItems), { kopia: true });
    });
  }

  const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'js', 'ts', 'py',
    'html', 'htm', 'css', 'xml', 'yaml', 'yml', 'log', 'ini', 'sh', 'bat', 'sql']);
  const OFFICE_EXTS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods']);
  const AV_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov', 'mkv', 'avi']);

  function extOf(name) {
    return (String(name).split('.').pop() || '').toLowerCase();
  }

  /* Zmysły to domowe GPU właściciela: członek bez przyznanego „lokalnego GPU"
     ich nie używa (lib/silniki.js → zmyslyDozwolone). Wyciąganie tekstu
     i transkrypcja zwracają wtedy pusty tekst — tak samo jak przy wyłączonych
     zmysłach, więc dalsza ścieżka jest ta sama. */

  async function sensesExtract(name, buf, czasMs = 90000) {
    if (!silniki.zmyslyDozwolone()) return '';
    try {
      const r = await fetch(`${SENSES_URL}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data: buf.toString('base64') }),
        signal: AbortSignal.timeout(czasMs),
      });
      if (!r.ok) return '';
      return (await r.json()).text || '';
    } catch { return ''; }
  }

  async function sensesTranscribe(buf, mime, czasMs = 600000) {
    if (!silniki.zmyslyDozwolone()) return '';
    try {
      const r = await fetch(`${SENSES_URL}/stt`, {
        method: 'POST',
        headers: { 'Content-Type': mime || 'application/octet-stream' },
        body: buf,
        signal: AbortSignal.timeout(czasMs),
      });
      if (!r.ok) return '';
      return (await r.json()).text || '';
    } catch { return ''; }
  }

  async function sensesDetectSummary(buf, mime, czasMs = 60000) {
    if (!silniki.zmyslyDozwolone()) return '';
    try {
      const r = await fetch(`${SENSES_URL}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: `data:${mime};base64,${buf.toString('base64')}` }),
        signal: AbortSignal.timeout(czasMs),
      });
      if (!r.ok) return '';
      return (await r.json()).summary || '';
    } catch { return ''; }
  }

  const wymagaTranskrypcji = (name, mime) => AV_EXTS.has(extOf(name)) || /^(audio|video)\//.test(mime || '');

  async function extractKbText(name, mime, buf, { czasMs } = {}) {
    const ext = extOf(name);
    const limit = (domyslny) => (czasMs ? Math.min(czasMs, domyslny) : domyslny);
    if (TEXT_EXTS.has(ext) || /^text\//.test(mime || '')) {
      return buf.toString('utf8').slice(0, 200000);
    }
    /* Najpierw własnym czytnikiem, dopiero potem zmysłami. Odwrotna kolejność
       znaczyła, że wczytanie umowy z telefonu nie działa, gdy komputer domowy
       jest wyłączony — czyli prawie zawsze. */
    if (OFFICE_EXTS.has(ext) || DOK_OBSLUGIWANE.has(ext)) {
      const { text, potrzebnyOcr } = czytajLokalnie(name, buf);
      if (text && !potrzebnyOcr) return text.slice(0, 200000);
      // Skan albo format, którego sami nie umiemy (doc, xls, odt) — do zmysłów.
      const zeZmyslow = await sensesExtract(name, buf, limit(90000));
      if (zeZmyslow) return zeZmyslow.slice(0, 200000);
      return text.slice(0, 200000);
    }
    if (wymagaTranskrypcji(name, mime)) {
      return (await sensesTranscribe(buf, mime, limit(600000))).slice(0, 200000);
    }
    if (/^image\//.test(mime || '')) {
      const summary = await sensesDetectSummary(buf, mime, limit(60000));
      return summary ? `Na obrazie wykryto: ${summary}` : '';
    }
    return '';
  }

  /* 140 fragmentów po 1500 znaków = cały tekst, który trzymamy (200 tys. znaków).
     Przy dawnych 30 baza wiedzy przeszukiwała tylko pierwsze 45 tys. —
     reszta dłuższego PDF-a była niewidoczna dla pytań. */
  function chunkText(text, size = 1500, max = 140) {
    const chunks = [];
    for (let i = 0; i < text.length && chunks.length < max; i += size) {
      chunks.push(text.slice(i, i + size));
    }
    return chunks;
  }

  /* Budżet na wektory przy dodawaniu. Człowiek czeka na odpowiedź — przy
     śpiącym komputerze domowym notatka czekała minutę na wyszarzonym
     przycisku (zespół IT, runda 4). Nie zdążą — pozycja i tak jest od razu,
     wyszukiwanie idzie po słowach, a wektory dolicza w tle reembedKbChunks. */
  const WEKTORY_NOTATKI_MS = 3000;
  const WEKTORY_PLIKU_MS = 20000;

  async function buildChunks(text, budzetMs = 60000) {
    const parts = chunkText(text || '');
    if (!parts.length) return [];
    const embs = await embedTexts(parts, budzetMs, 'passage');
    return parts.map((t, i) => {
      const ch = { text: t };
      if (embs) ustawWektor(ch, embs.model, embs.vectors[i]);
      return ch;
    });
  }

  /* OBRAZ Z BAZY WIEDZY DLA MODELU. Zdjęcie 15 MB z aparatu szło do modelu
     w oryginale — ~20 MB base64 w KAŻDEJ wiadomości, z płatnym przesyłem,
     a u Claude'a ponad limit 5 MB na obraz (odrzucone żądanie). Serwer nie ma
     dekodera obrazów (rdzeń bez zależności), więc mniejszą wersję (≤1568 px,
     JPEG) robi przeglądarka i odsyła jako PODGLĄD pozycji: przy dodaniu pliku
     albo przy zaznaczeniu starej pozycji. Oryginał zostaje do pobrania i edycji. */
  const OBRAZ_DO_MODELU_MAX = 3.5 * 1024 * 1024;   // po base64 ~4,7 MB — pod limitem 5 MB
  const podgladPlik = (id) => path.join(KB_FILES(), `${id}.podglad`);

  /** Obraz pozycji do wysłania modelowi: podgląd, a bez niego oryginał,
   *  jeśli jest dość mały. Za duży bez podglądu → null (model dostaje o tym zdanie). */
  /** { mime, buf } — albo { powod } bez obrazu: 'rozmiar' (większy niż
   *  OBRAZ_DO_MODELU_MAX) lub 'format' (oryginał w formacie, którego dostawcy
   *  nie przyjmują — HEIC, TIFF, BMP, SVG; oddawaliśmy go i każda wiadomość
   *  padała odmową 400 „model nie widzi obrazów"). */
  function obrazDlaModelu(it) {
    if (it.podglad) {
      try { return { mime: it.podglad.mime || 'image/jpeg', buf: fs.readFileSync(podgladPlik(it.id)) }; } catch { /* zniknął — spróbuj oryginału */ }
    }
    if (!/^image\/(jpeg|png|gif|webp)$/.test(it.mime || '')) return { powod: 'format' };
    try {
      const st = fs.statSync(path.join(KB_FILES(), it.id));
      if (st.size > OBRAZ_DO_MODELU_MAX) return { powod: 'rozmiar' };
      return { mime: it.mime, buf: fs.readFileSync(path.join(KB_FILES(), it.id)) };
    } catch { return { powod: 'rozmiar' }; }
  }

  function kbItemMeta(it) {
    return {
      id: it.id,
      type: it.type,
      name: it.name,
      mime: it.mime || '',
      url: it.url || '',
      size: it.size || 0,
      time: it.time,
      textChars: (it.text || '').length,
      preview: (it.text || '').slice(0, 140),
      przetwarzanie: it.przetwarzanie || '',   // np. nagranie przepisuje się w tle
      podglad: Boolean(it.podglad),            // mniejsza wersja obrazu dla modelu
    };
  }

  // Przeliczenie fragmentów bazy wiedzy na aktualny model embeddingów.
  // Działa w tle i pilnuje, by nie uruchomić się dwa razy naraz.
  /* Dwie rzeczy zmierzone przez zespół IT: każda zmiana dostawcy embeddingów
     (zmysły zasnęły → chmura, zmysły wróciły → z powrotem) przeliczała bazę
     przy KAŻDYM czacie i zapisywała cały indeks — 40 MB synchronicznie, pętla
     zdarzeń stała do 1,5 s. Teraz: model musi się utrzymać kilka minut, zanim
     ruszy przeliczanie (chwilowa drzemka zmysłów nic nie przepisuje), a zapis
     przeliczonych wektorów jest odroczony i zbiorczy. */
  const REEMBED_ZWLOKA_MS = Number(process.env.COSMOS_REEMBED_ZWLOKA_MS) || 5 * 60 * 1000;
  const REEMBED_ZAPIS_MS = 20_000;
  function zapiszKbWkrotce() {
    const stanOsobyTeraz = U();
    if (stanOsobyTeraz.kbZapisZaplanowany) return;
    const u = kto();
    stanOsobyTeraz.kbZapisZaplanowany = setTimeout(() => {
      stanOsobyTeraz.kbZapisZaplanowany = null;
      wKontekscie(u, saveKb);
    }, REEMBED_ZAPIS_MS);
    if (stanOsobyTeraz.kbZapisZaplanowany.unref) stanOsobyTeraz.kbZapisZaplanowany.unref();
  }

  async function reembedKbChunks(model, budget = 40) {
    if (U().reembedBusy) return;
    const cel = U().reembedCel;
    if (!cel || cel.model !== model) { U().reembedCel = { model, od: Date.now() }; }
    const stale = [];
    for (const it of U().kbItems) {
      for (const ch of it.chunks || []) {
        if (!sameModel(ch, model)) stale.push(ch);
        if (stale.length >= budget) break;
      }
      if (stale.length >= budget) break;
    }
    if (!stale.length) return;
    /* Fragmenty BEZ wektora (plik dodany, gdy embeddingów nie było) liczymy od
       razu; przepisywanie wektorów z innego modelu — dopiero gdy nowy model
       utrzymał się przez REEMBED_ZWLOKA_MS. */
    const tylkoPuste = stale.every((c) => !maWektor(c));
    if (!tylkoPuste && Date.now() - U().reembedCel.od < REEMBED_ZWLOKA_MS) return;
    U().reembedBusy = true;
    try {
      const embs = await embedTexts(stale.map((c) => c.text), 60000, 'passage');
      if (embs) {
        stale.forEach((c, i) => ustawWektor(c, embs.model, embs.vectors[i]));
        zapiszKbWkrotce();
        console.log(`  → Przeliczono ${stale.length} fragmentów bazy wiedzy na model ${model}`);
      }
    } catch { /* spróbujemy przy następnym pytaniu */ } finally {
      U().reembedBusy = false;
    }
  }

  async function kbSearch(query, excludeIds = [], limit = 4) {
    wznowPrzetwarzanieRaz();
    if (!query || !query.trim()) return [];
    const pool = [];
    for (const it of U().kbItems) {
      if (excludeIds.includes(it.id)) continue;
      for (const ch of it.chunks || []) pool.push({ name: it.name, ...ch });
    }
    if (!pool.length) return [];

    /* Budżet jak przy pamięci (1,2 s): fragmenty z bazy to dodatek do odpowiedzi.
       Przy 5 s śpiący komputer domowy dokładał tyle ciszy przed pierwszym znakiem.
       Wektor pytania zwykle jest już policzony przez pamięć (lib/pamiec.js). */
    let qvec = null, qmodel = null;
    const q = await embedTexts([query], BUDZET_PYTANIA_MS, 'query');
    if (q) { qvec = q.vectors[0]; qmodel = q.model; }

    // Fragmenty policzone innym modelem (albo wcale) przelicz w tle — nie
    // blokujemy tym odpowiedzi, przy kolejnym pytaniu będą już gotowe.
    if (qmodel) reembedKbChunks(qmodel);

    // Próg dla każdego fragmentu osobno — patrz searchMemory w lib/pamiec.js.
    return pool
      .map((c) => {
        const wektor = Boolean(qvec && sameModel(c, qmodel));
        return { c, wektor, score: wektor ? cosine(qvec, wektorDla(c, qmodel)) : keywordScore(query, c.text) };
      })
      .filter((s) => s.score > (s.wektor ? 0.35 : 0.18))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => ({ name: s.c.name, text: s.c.text }));
  }

  /** Przepisanie nagrania W TLE — przy dodaniu i po restarcie. Kontekst osoby
   *  idzie za obietnicą (lib/kontekst.js). */
  function przepiszWTle(item, buf) {
    (async () => {
      const text = await extractKbText(item.name, item.mime, buf);
      item.text = text;
      item.chunks = await buildChunks(text);
      delete item.przetwarzanie;
      delete item.probPrzepisania;
      saveKb();
      addEvent('baza-wiedzy', text ? `przepisano nagranie „${item.name}"` : `nie udało się przepisać nagrania „${item.name}"`);
    })().catch((err) => {
      delete item.przetwarzanie;
      saveKb();
      console.error(`Transkrypcja „${item.name}" nie powiodła się:`, err.message);
    });
  }

  /* Nagranie przerwane restartem serwera zostawało na zawsze „przepisuje się
     w tle", bez tekstu — obietnica żyła tylko w pamięci procesu (zespół IT,
     runda 4). Przy pierwszym zajrzeniu osoby do bazy wiedzy (lista albo
     przywołanie w czacie) takie pozycje ruszają od nowa; po dwóch przerwanych
     próbach zostają bez tekstu, ale już nie „w toku". */
  function wznowPrzetwarzanieRaz() {
    if (U().przetwarzanieWznowione) return;
    U().przetwarzanieWznowione = true;
    let zmiana = false;
    for (const it of U().kbItems) {
      if (it.przetwarzanie !== 'transkrypcja') continue;
      zmiana = true;
      it.probPrzepisania = (it.probPrzepisania || 0) + 1;
      let buf = null;
      try { buf = fs.readFileSync(path.join(KB_FILES(), it.id)); } catch { /* pliku nie ma */ }
      if (!buf || it.probPrzepisania > 2) { delete it.przetwarzanie; continue; }
      przepiszWTle(it, buf);
    }
    if (zmiana) saveKb();
  }

  async function kbAddFile(name, mime, buf, presetText = null) {
    // Limit miejsca osoby — przed zapisem, nie po (lib/miejsce.js). Obejmuje też
    // wyniki Studia i notatki głosowe, bo wszystkie idą tędy.
    await miejsce_.sprawdz(buf.length);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const plik = path.join(KB_FILES(), id);
    try {
      fs.mkdirSync(KB_FILES(), { recursive: true });
      fs.writeFileSync(plik, buf);
    } catch (err) {
      try { fs.unlinkSync(plik); } catch { /* nie powstał */ }
      throw miejsce_.zBleduDysku(err);
    }
    /* Pozycja trafia do indeksu albo wcale: indeks, który się nie zapisał,
       zostawiłby po restarcie plik-sierotę, a człowiek dostałby „ok". */
    const wpisz = (item) => {
      U().kbItems.push(item);
      const blad = saveKb();
      if (blad) {
        U().kbItems = U().kbItems.filter((it) => it !== item);
        try { fs.unlinkSync(plik); } catch { /* już nie ma */ }
        throw miejsce_.zBleduDysku(blad);
      }
      miejsce_.dolicz(buf.length);
    };
    /* Nagranie przepisuje się W TLE. Transkrypcja godzinnego nagrania trwa
       minuty, a żądanie, które na nią czekało, za Cloudflare kończyło się po
       100 s stroną 524 — choć plik i tak się potem dodawał. Pozycja jest od
       razu, tekst dochodzi, gdy zmysły skończą (kontekst osoby idzie za nami). */
    if (presetText === null && wymagaTranskrypcji(name, mime)) {
      const item = { id, type: 'file', name, mime, size: buf.length, time: Date.now(), text: '', chunks: [], przetwarzanie: 'transkrypcja' };
      wpisz(item);
      przepiszWTle(item, buf);
      return item;
    }
    const text = presetText !== null ? presetText : await extractKbText(name, mime, buf);
    const item = {
      id, type: 'file', name, mime, size: buf.length, time: Date.now(),
      text, chunks: await buildChunks(text, WEKTORY_PLIKU_MS),
    };
    wpisz(item);
    return item;
  }

  async function handleKb(req, res, pathname) {
    if (pathname === '/api/kb' && req.method === 'GET') {
      wznowPrzetwarzanieRaz();
      return sendJson(res, 200, { items: U().kbItems.map(kbItemMeta) });
    }

    if (pathname === '/api/kb' && req.method === 'DELETE') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      const item = U().kbItems.find((it) => it.id === id);
      const przed = U().kbItems;
      U().kbItems = przed.filter((it) => it.id !== id);
      /* Najpierw indeks, potem pliki. Odwrotnie przy pełnym dysku plik znikał,
         a indeks na dysku dalej go wskazywał — po restarcie pozycja-duch z 404.
         Nieudany zapis przywraca stan w pamięci (zespół IT, runda 4). */
      const blad = saveKb();
      if (blad) { U().kbItems = przed; return bladZapisu(res, blad); }
      if (item?.type === 'file') {
        try { fs.unlinkSync(path.join(KB_FILES(), item.id)); miejsce_.dolicz(-(item.size || 0)); } catch { /* już nie ma */ }
        if (item.podglad) { try { fs.unlinkSync(podgladPlik(item.id)); miejsce_.dolicz(-(item.podglad.bajty || 0)); } catch { /* już nie ma */ } }
      }
      return sendJson(res, 200, { ok: true, total: U().kbItems.length });
    }

    if (pathname === '/api/kb/raw' && req.method === 'GET') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      const item = U().kbItems.find((it) => it.id === id && it.type === 'file');
      if (!item) { res.writeHead(404); return res.end(); }
      try {
        const buf = fs.readFileSync(path.join(KB_FILES(), item.id));
        /* Wgrany HTML albo SVG otwarty „inline" na adresie aplikacji to skrypt
           z pełnym dostępem do /api/* w imieniu tego, kto kliknął. Takie pliki
           tylko do pobrania i w piaskownicy; zdjęcia i PDF-y dalej w podglądzie. */
        const mime = String(item.mime || 'application/octet-stream').toLowerCase();
        const aktywny = /html|svg|xml|javascript|ecmascript/.test(mime) || !/^(image\/(png|jpe?g|gif|webp|avif|heic)|application\/pdf|text\/plain|audio\/|video\/)/.test(mime);
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Disposition': `${aktywny ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(item.name)}`,
          'X-Content-Type-Options': 'nosniff',
          /* Treść pliku o danym id nigdy się nie zmienia. Bez tego galeria na
             telefonie pobierała przy KAŻDYM otwarciu wszystko od nowa — 89 MB
             (zespół IT, płynność, runda 4). Prywatnie: nie w pamięci pośredników. */
          'Cache-Control': 'private, max-age=31536000, immutable',
          'Content-Length': buf.length,
          ...(mime === 'application/pdf' ? {} : { 'Content-Security-Policy': 'sandbox; default-src \'none\'; img-src \'self\' data:; media-src \'self\'' }),
        });
        return res.end(buf);
      } catch { res.writeHead(404); return res.end(); }
    }

    /* Podgląd obrazu dla modelu — mniejszą wersję robi przeglądarka (canvas),
       bo serwer nie ma dekodera obrazów. Surowe ciało, jak /api/kb/file. */
    if (pathname === '/api/kb/podglad' && req.method === 'POST') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      const item = U().kbItems.find((it) => it.id === id && it.type === 'file' && /^image\//.test(it.mime || ''));
      if (!item) { req.resume(); return sendJson(res, 404, { error: 'Nie ma takiego obrazu w bazie wiedzy.' }); }
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
      if (!['image/jpeg', 'image/webp', 'image/png'].includes(mime)) { req.resume(); return sendJson(res, 415, { error: 'Podgląd: JPEG, WebP albo PNG.' }); }
      let buf;
      try { buf = await readBodyBuffer(req, OBRAZ_DO_MODELU_MAX); } catch { return sendJson(res, 413, { error: 'Podgląd za duży — najwyżej 3,5 MB.' }); }
      if (!buf.length) return sendJson(res, 400, { error: 'Pusty podgląd.' });
      await miejsce_.sprawdz(buf.length);
      try { zapiszAtomowo(podgladPlik(item.id), buf); } catch (err) { return bladZapisu(res, err); }
      const bylo = item.podglad;
      item.podglad = { mime, bajty: buf.length };
      const blad = saveKb();
      if (blad) { item.podglad = bylo; return bladZapisu(res, blad); }
      miejsce_.dolicz(buf.length - ((bylo && bylo.bajty) || 0));
      return sendJson(res, 200, { ok: true, bajty: buf.length });
    }

    if (pathname === '/api/kb/search' && req.method === 'GET') {
      const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
      const results = await kbSearch(q, [], 5);
      return sendJson(res, 200, { query: q, results });
    }

    if (pathname === '/api/kb/file' && req.method === 'POST') {
      /* Plik przychodzi jako SUROWE ciało: typ w Content-Type, nazwa w nagłówku
         X-Cosmos-Nazwa (zakodowana jak w adresie — nie w adresie, bo ten trafia
         do dzienników Cloudflare'a). Dawniej przeglądarka kodowała plik do base64
         i pakowała w JSON w wątku głównym: 45 MB zamrażało telefon na 4,7 s,
         przez tunel szło o 33% więcej danych, a serwer parsował 60 MB JSON-a,
         stojąc w miejscu. Droga JSON + base64 zostaje dla zgodności (skrypty). */
      const typ = String(req.headers['content-type'] || '').toLowerCase();
      let name; let mime; let buf;
      if (typ.startsWith('application/json')) {
        let data;
        try { data = await readJson(req, KB_PLIK_MAX + KB_PLIK_MAX / 3); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
        name = String(data.name || 'plik').slice(0, 200);
        mime = String(data.mime || '');
        try { buf = Buffer.from(String(data.data || ''), 'base64'); } catch { buf = null; }
      } else {
        try { name = decodeURIComponent(String(req.headers['x-cosmos-nazwa'] || '')); } catch { name = ''; }
        name = (name || 'plik').replace(/[\/\u0000-\u001f]/g, '_').slice(0, 200);
        mime = typ.split(';')[0].trim();
        if (mime === 'application/octet-stream') mime = '';
        const dlugosc = Number(req.headers['content-length']) || 0;
        if (dlugosc > KB_PLIK_MAX) {
          req.resume();
          return sendJson(res, 413, { error: `Plik jest za duży — limit to ${Math.round(KB_PLIK_MAX / 1048576)} MB (Cloudflare i tak nie przepuszcza więcej niż 100 MB).` });
        }
        /* Limit miejsca znamy przed wysyłką (Content-Length). Odmowę wysyłamy
           dopiero po odczytaniu ciała: odpowiedź w trakcie wysyłki przeglądarka
           potrafi zgubić i pokazać „błąd sieci" zamiast wyjaśnienia. */
        if (dlugosc) {
          try { await miejsce_.sprawdz(dlugosc); } catch (err) {
            req.resume();
            return req.on('end', () => bladZapisu(res, err));
          }
        }
        try { buf = await readBodyBuffer(req, KB_PLIK_MAX); } catch {
          return sendJson(res, 413, { error: `Plik jest za duży — limit to ${Math.round(KB_PLIK_MAX / 1048576)} MB.` });
        }
      }
      if (!buf || !buf.length) return sendJson(res, 400, { error: 'Brak danych pliku.' });

      const item = await kbAddFile(name, mime, buf);
      addEvent('baza-wiedzy', `dodano plik: ${name}${item.text ? ` (${item.text.length} znaków tekstu)` : ''}`);
      return sendJson(res, 200, { ok: true, item: kbItemMeta(item) });
    }

    if (pathname === '/api/kb/link' && req.method === 'POST') {
      let data;
      try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      let url = String(data.url || '').trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      try {
        /* Bezpieczne pobieranie: gość nie może kazać serwerowi zajrzeć do sieci
           prywatnej (127.0.0.1, zmysły, metadane chmury, Tailscale). Właściciel
           może — i tak ma pełny dostęp do serwera. Patrz lib/pobieranie.js. */
        const r = await pobierzStrone(url, { pozwolPrywatne: czyWlasciciel(), czasMs: 20000, maxBajtow: 3_000_000 });
        if (r.status >= 400) throw new Error(`strona odpowiedziała HTTP ${r.status}`);
        url = r.adres;
        const html = r.tekst;
        const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '') || url;
        const text = czytelnyTekst(html).slice(0, 200000);
        await miejsce_.sprawdz(Buffer.byteLength(text));
        const item = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          type: 'link', name: title.slice(0, 200), url, time: Date.now(),
          text, chunks: await buildChunks(text, WEKTORY_NOTATKI_MS),
        };
        U().kbItems.push(item);
        const blad = saveKb();
        if (blad) {
          U().kbItems = U().kbItems.filter((it) => it !== item);
          return bladZapisu(res, blad);
        }
        addEvent('baza-wiedzy', `dodano link: ${title.slice(0, 80)}`);
        return sendJson(res, 200, { ok: true, item: kbItemMeta(item) });
      } catch (err) {
        if (miejsce_.toBrakMiejsca(err)) return bladZapisu(res, err);
        /* Człowiek ma zobaczyć, co jest nie tak, a nie „getaddrinfo ENOTFOUND". */
        const kod = err.code || (err.cause && err.cause.code) || '';
        const powod = err.name === 'ZablokowanyAdres' ? err.message
          : /ENOTFOUND|EAI_AGAIN/.test(kod) ? 'taki adres nie istnieje — sprawdź, czy nie ma literówki'
            : /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT/.test(kod) ? 'strona nie odpowiada'
              : /CERT|SSL|TLS/i.test(kod + err.message) ? 'strona ma nieważny certyfikat bezpieczeństwa'
                : err.message;
        return sendJson(res, 502, { error: `Nie udało się pobrać strony: ${powod}` });
      }
    }

    if (pathname === '/api/kb/note' && req.method === 'POST') {
      let data;
      try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const text = String(data.text || '').trim().slice(0, 200000);
      if (!text) return sendJson(res, 400, { error: 'Pusta notatka.' });
      const name = String(data.title || '').trim() ||
        `Notatka głosowa ${new Date().toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}`;
      await miejsce_.sprawdz(Buffer.byteLength(text));
      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'note', name: name.slice(0, 200), time: Date.now(),
        text, chunks: await buildChunks(text, WEKTORY_NOTATKI_MS),
      };
      U().kbItems.push(item);
      const blad = saveKb();
      if (blad) {
        U().kbItems = U().kbItems.filter((it) => it !== item);
        return bladZapisu(res, blad);
      }
      addEvent('baza-wiedzy', `zapisano notatkę: ${name.slice(0, 80)}`);
      return sendJson(res, 200, { ok: true, item: kbItemMeta(item) });
    }

    res.writeHead(405);
    res.end();
  }

  return {
    obsluz: handleKb, kbPliki: KB_FILES, saveKb, kbAddFile, kbItemMeta, kbSearch,
    obrazDlaModelu, extractKbText, extOf, wymagaTranskrypcji,
  };
}

module.exports = { utworz };

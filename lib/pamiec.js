/* ============================================================
   Pamięć długotrwała (RAG) — fakty zapisane przez użytkownika

   Wyszukiwanie idzie dwutorowo i to jest celowe: wektorowo, gdy są dostępne
   embeddingi (zmysły na domowym GPU albo chmura NVIDII), a słowami
   kluczowymi zawsze. Dzięki temu pamięć DZIAŁA także wtedy, gdy komputer
   domowy śpi i nie ma klucza do chmury — gorzej, ale działa.

   Zasada nadrzędna, powtarzana w całym projekcie: nic, co jest tylko
   DODATKIEM do odpowiedzi, nie może jej blokować. Liczenie wektorów ma
   budżet czasowy i karencję po błędzie; przekroczenie budżetu oznacza
   odpowiedź bez wektorów, a nie brak odpowiedzi.

   Wydzielone z server.js przy podziale pliku. Zależności wchodzą przez
   `utworz()` — moduł nie sięga po globalne stany serwera.
   ============================================================ */

const path = require('node:path');
const { zapiszAtomowo, authHeaders, czytajJson } = require('./rdzen.js');
const { odpowiedzBledemZapisu } = require('./miejsce.js');
const silniki = require('./silniki.js');

/* Czyste funkcje podobieństwa — na poziomie modułu, nie w fabryce. Nie
   dotykają niczyich danych, a baza wiedzy i nauka potrzebują ich już przy
   starcie serwera, gdy nie ma jeszcze żadnego użytkownika. W fabryce byłyby
   dostępne dopiero przez instancję konkretnej osoby. */
/* WEKTORY PER MODEL. Wektory z różnych modeli są nieporównywalne, a Cosmos
   ma dwóch dostawców: zmysły w domu (bge-m3) i chmurę NVIDII. Wpis trzymał
   JEDEN wektor, więc każde przejście — komputer domowy zasnął, obudził się —
   przepisywało całą pamięć i bazę wiedzy na drugi model, a po powrocie
   z powrotem. Przez kilka minut po każdej zmianie wyszukiwanie szło po słowach
   kluczowych, a chmura liczyła (i kasowała) to samo drugi raz.

   Teraz wpis trzyma `wektory: { model: wektor }` — najwyżej MAKS_MODELI,
   najdawniej ustawiony wypada. Stary kształt (`embedding` + `embModel`)
   czytamy dalej i przenosimy przy pierwszym zapisie nowego wektora. */
const MAKS_MODELI = 2;

/* ZAPIS WEKTORA: 'f32:' + base64 z float32 (little-endian), nie tablica liczb.
   Przy dwóch modelach indeks bazy wiedzy ważył 110 MB (tablica liczb w JSON-ie
   to ~18 znaków na liczbę), a zapisuje go JSON.stringify w pętli zdarzeń —
   każda notatka, podgląd zdjęcia, wynik Studia stawiały CAŁY serwer, wszystkim
   osobom, na 2–3 s. Jako napis: 31 MB i ~0,15 s. Modele liczą w float32, więc
   precyzja zostaje. Stare tablice czytamy dalej, a kompaktujWektory() zamienia
   je przy wczytaniu pliku. */
const PREFIKS_F32 = 'f32:';

function wektorNaNapis(wektor) {
  const buf = Buffer.alloc(wektor.length * 4);
  for (let i = 0; i < wektor.length; i++) buf.writeFloatLE(wektor[i], i * 4);
  return PREFIKS_F32 + buf.toString('base64');
}

function napisNaWektor(napis) {
  const buf = Buffer.from(napis.slice(PREFIKS_F32.length), 'base64');
  const w = new Float32Array(buf.length >> 2);
  for (let i = 0; i < w.length; i++) w[i] = buf.readFloatLE(i * 4);
  return w;
}

const niepusty = (w) => (Array.isArray(w) ? w.length > 0
  : typeof w === 'string' && w.length > PREFIKS_F32.length && w.startsWith(PREFIKS_F32));

/* Zdekodowane wektory przy wpisie — każde pytanie nie dekoduje całej bazy od
   nowa. WeakMap: znikają razem z wpisem; zmieniony napis unieważnia wpis. */
const zdekodowane = new WeakMap();

function odczytaj(item, model, w) {
  if (!niepusty(w)) return null;
  if (Array.isArray(w)) return w;
  let pamiec = zdekodowane.get(item);
  if (!pamiec) { pamiec = new Map(); zdekodowane.set(item, pamiec); }
  const c = pamiec.get(model);
  if (c && c.napis === w) return c.wektor;
  const wektor = napisNaWektor(w);
  pamiec.set(model, { napis: w, wektor });
  return wektor;
}

/** Wektor wpisu dla danego modelu (tablica albo Float32Array) albo null. */
function wektorDla(item, model) {
  if (!item || !model) return null;
  const z = odczytaj(item, model, item.wektory && item.wektory[model]);
  if (z) return z;
  if ((item.embModel || null) === model) return odczytaj(item, model, item.embedding);
  return null;
}

/** Czy wpis ma jakikolwiek wektor. */
function maWektor(item) {
  if (item && item.wektory && Object.values(item.wektory).some(niepusty)) return true;
  return Boolean(item && niepusty(item.embedding));
}

/** Dopisz wektor modelu do wpisu, zachowując te z innych modeli. */
function ustawWektor(item, model, wektor) {
  if (!model || !(Array.isArray(wektor) || ArrayBuffer.isView(wektor))) return;
  const w = { ...(item.wektory || {}) };
  // stary kształt → mapa, żeby nie zgubić wektora sprzed zmiany
  if (niepusty(item.embedding) && item.embModel && !w[item.embModel]) w[item.embModel] = item.embedding;
  delete item.embedding;
  delete item.embModel;
  delete w[model];                 // ponowne ustawienie przesuwa model na koniec kolejki
  w[model] = wektor;
  const modele = Object.keys(w);
  for (const stary of modele.slice(0, Math.max(0, modele.length - MAKS_MODELI))) delete w[stary];
  for (const k of Object.keys(w)) {
    if (Array.isArray(w[k]) || ArrayBuffer.isView(w[k])) w[k] = wektorNaNapis(w[k]);
    else if (typeof w[k] !== 'string') delete w[k];
  }
  item.wektory = w;
}

/** Wektory zapisane jako tablice (pliki sprzed zmiany) → napisy f32. Wołane przy
 *  wczytaniu pamięci, bazy wiedzy (także fragmentów) i wzorców nauki; plik kurczy
 *  się przy najbliższym zapisie. Zwraca tę samą listę. */
function kompaktujWektory(wpisy) {
  const jeden = (item) => {
    if (!item || typeof item !== 'object') return;
    if (item.wektory && typeof item.wektory === 'object') {
      for (const [model, w] of Object.entries(item.wektory)) {
        if (Array.isArray(w)) item.wektory[model] = wektorNaNapis(w);
      }
    }
    if (niepusty(item.embedding) && item.embModel) ustawWektor(item, item.embModel, item.embedding);
    if (Array.isArray(item.chunks)) item.chunks.forEach(jeden);
  };
  if (Array.isArray(wpisy)) wpisy.forEach(jeden);
  return wpisy;
}

/** Czy wpis ma wektor z tego modelu (tylko takie wolno porównywać). */
function sameModel(item, model) {
  return Boolean(wektorDla(item, model));
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

function keywords(text) {
  return new Set(
    text.toLowerCase().split(/[^a-ząćęłńóśźż0-9]+/i).filter((w) => w.length >= 4)
  );
}

function keywordScore(query, text) {
  const q = keywords(query);
  if (!q.size) return 0;
  const t = keywords(text);
  let hits = 0;
  for (const w of q) if (t.has(w)) hits++;
  return hits / Math.sqrt(q.size * Math.max(t.size, 1));
}

/**
 * @param {object} z
 * @param {string} z.katalogDanych  gdzie trzymać memory.json
 * @param {string} z.sensesUrl      adres usługi zmysłów
 * @param {Function} z.chmura       () => ENDPOINTS.cloud (klucz i adres API)
 * @param {Function} z.sendJson     odpowiedź HTTP
 * @param {Function} z.readJson     odczyt ciała żądania
 */
function utworz({ katalogDanych, sensesUrl, chmura, sendJson, readJson }) {
  const SENSES_URL = sensesUrl;
  const MEMORY_FILE = path.join(katalogDanych, 'memory.json');

  let memories = kompaktujWektory(czytajJson(MEMORY_FILE, []));

  /** Zapis pamięci. Nie rzuca (woła go też praca w tle), ale ZWRACA błąd —
   *  trasa, która odpowiada „ok", ma go sprawdzić (lib/miejsce.js). */
  function saveMemories() {
    try {
      zapiszAtomowo(MEMORY_FILE, JSON.stringify(memories, null, 2), { kopia: true });
      return null;
    } catch (err) {
      console.error('Nie udało się zapisać pamięci:', err.message);
      return err;
    }
  }

  // timeoutMs: przy indeksowaniu (upload) dajemy modelowi czas na start (60 s),
  // ale przy wyszukiwaniu w trakcie rozmowy czekamy krótko (5 s), żeby
  // niedostępna usługa zmysłów nie opóźniała odpowiedzi czatu.
  // Embeddingi: lokalnie przez zmysły (bge-m3 na Twoim GPU) albo z chmury NVIDII.
  // „auto" = najpierw zmysły (za darmo, prywatnie), a gdy są offline — chmura.
  // Dzięki temu baza wiedzy działa w pełni także wtedy, gdy komputer domowy śpi.
  const EMBED = {
    provider: (process.env.EMBED_PROVIDER || 'auto').toLowerCase(), // auto | senses | nvidia | off
    nvidiaModel: process.env.NVIDIA_EMBED_MODEL || 'nvidia/llama-nemotron-embed-1b-v2',
  };

  async function embedViaSenses(texts, timeoutMs) {
    try {
      const r = await fetch(`${SENSES_URL}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) return null;
      const d = await r.json();
      if (!wektoryWPorzadku(d.vectors, texts.length)) return null;
      return { vectors: d.vectors, model: `senses:${d.vectors[0].length}` };
    } catch {
      return null;
    }
  }

  /* Śmieci z usługi (atrapa, usługa w połowie restartu, zły model) zapisywały
     się jako wektory o długości 3 — i od tej chwili każde pytanie „pasowało"
     do nich po cosinusie. Przyjmujemy tylko komplet równych, liczbowych
     wektorów o sensownym wymiarze (bge-m3: 1024, NVIDIA: 2048). */
  const MIN_WYMIAR = Number(process.env.EMBED_MIN_DIM) || 64;
  function wektoryWPorzadku(wektory, ile) {
    if (!Array.isArray(wektory) || wektory.length !== ile || !ile) return false;
    const wymiar = Array.isArray(wektory[0]) ? wektory[0].length : 0;
    if (wymiar < MIN_WYMIAR) return false;
    return wektory.every((w) => Array.isArray(w) && w.length === wymiar && w.every((x) => Number.isFinite(x)));
  }

  async function embedViaNvidia(texts, timeoutMs, inputType) {
    const ep = chmura();
    if (!ep.apiKey) return null;
    // Modele wyszukiwawcze rozróżniają pytanie od dokumentu (input_type). Gdy
    // dany model tego pola nie przyjmuje, powtarzamy żądanie bez niego.
    for (const withType of [true, false]) {
      try {
        const body = { input: texts, model: EMBED.nvidiaModel, encoding_format: 'float' };
        if (withType) {
          body.input_type = inputType === 'query' ? 'query' : 'passage';
          body.truncate = 'END';
        }
        const r = await fetch(`${ep.baseUrl}/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders(ep) },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!r.ok) {
          if (withType && (r.status === 400 || r.status === 422)) continue;  // spróbuj bez input_type
          return null;
        }
        const d = await r.json();
        const rows = Array.isArray(d.data) ? [...d.data] : [];
        if (!rows.length) return null;
        rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        const vectors = rows.map((x) => x.embedding).filter(Array.isArray);
        if (!wektoryWPorzadku(vectors, texts.length)) return null;
        return { vectors, model: `nvidia:${EMBED.nvidiaModel}` };
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Zwraca { vectors, model } albo null. `model` znakuje wektory — patrz sameModel(). */
  /* Bezpiecznik na wolne embeddingi — OSOBNO dla każdego źródła.
   *
   * Gdy źródło raz nie wyrobiło się w budżecie, następne wywołania z krótkim
   * budżetem (te z rozmowy) je pomijają: idzie od razu drugie źródło albo
   * dopasowanie po słowach kluczowych, a rozmowa rusza bez zwłoki. Po minucie
   * próbujemy ponownie: usługa mogła po prostu wstawać.
   *
   * Karencja była jedna na oba źródła i zerowana przy sukcesie chmury. Przy
   * śpiącym komputerze domowym i działającej chmurze nie włączała się więc
   * nigdy: KAŻDA wiadomość czekała cały budżet na zmysły (pamięć 1,2 s, baza
   * wiedzy 5 s), zanim poszła do chmury — zmierzone 6,2 s do pierwszego znaku.
   */
  const awaria = { senses: 0, nvidia: 0 };
  const EMBED_KARENCJA_MS = 60000;
  /* Poniżej tego budżetu wywołanie uznajemy za „z rozmowy" — takie odpuszczamy
     po awarii. Przeliczanie w tle (60 s) idzie zawsze, bo nikt na nie nie czeka. */
  const EMBED_BUDZET_ROZMOWY_MS = 5000;
  /* Wektor pytania z tej samej wiadomości: pamięć i baza wiedzy pytają o niego
     jedna po drugiej. Bez tego to samo zdanie liczyło się dwa razy. */
  const PYTANIE_WAZNE_MS = 15000;
  let ostatniePytanie = { tekst: '', wynik: null, do: 0 };

  async function embedTexts(texts, timeoutMs = 60000, inputType = 'passage') {
    if (!texts || !texts.length || EMBED.provider === 'off') return null;
    const jednoPytanie = inputType === 'query' && texts.length === 1;
    if (jednoPytanie && texts[0] === ostatniePytanie.tekst && Date.now() < ostatniePytanie.do) return ostatniePytanie.wynik;
    const zRozmowy = timeoutMs <= EMBED_BUDZET_ROZMOWY_MS;
    const order = (EMBED.provider === 'senses' ? ['senses']
      : EMBED.provider === 'nvidia' ? ['nvidia']
      : ['senses', 'nvidia'])
      /* Zmysły to domowe GPU właściciela: członek bez tej zgody liczy wektory
         w chmurze, a jego notatki i pytania nie jadą do cudzego domu
         (zasada 8 w CLAUDE.md). Praca serwera bez osoby — jak dotąd. */
      .filter((src) => src !== 'senses' || silniki.zmyslyDozwolone());
    for (const src of order) {
      if (zRozmowy && Date.now() < awaria[src]) continue;
      const out = src === 'senses'
        ? await embedViaSenses(texts, timeoutMs)
        : await embedViaNvidia(texts, timeoutMs, inputType);
      if (out) {
        awaria[src] = 0;
        if (jednoPytanie) ostatniePytanie = { tekst: texts[0], wynik: out, do: Date.now() + PYTANIE_WAZNE_MS };
        return out;
      }
      // To źródło przez chwilę nie zatrzymuje rozmowy.
      awaria[src] = Date.now() + EMBED_KARENCJA_MS;
    }
    return null;
  }

  /** Który dostawca embeddingów realnie zadziała przy obecnej konfiguracji. */
  function embedStatus(sensesHasEmbed) {
    if (EMBED.provider === 'off') return { provider: 'off', model: null, opis: 'wyłączone' };
    const cloudReady = Boolean(chmura().apiKey);
    if (EMBED.provider === 'nvidia') {
      return { provider: cloudReady ? 'nvidia' : null, model: EMBED.nvidiaModel,
        opis: cloudReady ? `chmura NVIDIA (${EMBED.nvidiaModel})` : 'brak NVIDIA_API_KEY' };
    }
    if (EMBED.provider === 'senses') {
      return { provider: sensesHasEmbed ? 'senses' : null, model: 'bge-m3',
        opis: sensesHasEmbed ? 'zmysły lokalnie' : 'zmysły offline — wyszukiwanie po słowach kluczowych' };
    }
    if (sensesHasEmbed) return { provider: 'senses', model: 'bge-m3', opis: 'zmysły lokalnie' };
    if (cloudReady) {
      return { provider: 'nvidia', model: EMBED.nvidiaModel,
        opis: `zmysły offline → chmura NVIDIA (${EMBED.nvidiaModel})` };
    }
    return { provider: null, model: null, opis: 'brak — wyszukiwanie po słowach kluczowych' };
  }

  /* Przeliczanie wektorów w tle. NIE w ścieżce czatu.
   *
   * Wektory z różnych modeli są nieporównywalne, więc po zmianie dostawcy
   * embeddingów trzeba przeliczyć całą pamięć. Kiedyś robiliśmy to wewnątrz
   * `searchMemory`, z limitem 60 s — użytkownik patrzył w pustkę, zanim model
   * w ogóle dostał prompt. Pomiar: 5 s ciszy przy KAŻDEJ wiadomości, gdy
   * usługa embeddingów była wolna. Teraz pamięć doucza się sama, w tle,
   * a rozmowa idzie dalej na dopasowaniu słów kluczowych.
   */
  let uzupelnianieTrwa = false;
  function uzupelnijWektoryWTle(qmodel) {
    if (uzupelnianieTrwa) return;
    const brakujace = memories.filter((m) => !sameModel(m, qmodel));
    if (!brakujace.length) return;
    uzupelnianieTrwa = true;
    setTimeout(async () => {
      try {
        const embs = await embedTexts(brakujace.map((m) => m.text), 60000, 'passage');
        if (embs) {
          brakujace.forEach((m, i) => ustawWektor(m, embs.model, embs.vectors[i]));
          saveMemories();
        }
      } catch { /* następnym razem */ } finally { uzupelnianieTrwa = false; }
    }, 0);
  }

  /* Ile wolno czekać na embedding zapytania, zanim odpuścimy i użyjemy słów
     kluczowych. Przywołanie pamięci jest miłym dodatkiem — wstrzymywanie dla
     niego całej rozmowy nie jest. */
  const BUDZET_PAMIECI_MS = Number(process.env.MEMORY_SEARCH_BUDGET_MS || 1200);

  async function searchMemory(query, limit = 4) {
    if (!memories.length || !query || !query.trim()) return [];

    let qvec = null, qmodel = null;
    const q = await embedTexts([query], BUDZET_PAMIECI_MS, 'query');
    if (q) {
      qvec = q.vectors[0];
      qmodel = q.model;
      uzupelnijWektoryWTle(qmodel);   // w tle, nie blokuje odpowiedzi
    }

    /* Próg zależy od tego, JAK policzono wynik — dla każdego wpisu osobno.
       Wpis bez wektora z tego samego modelu dostaje wynik ze słów kluczowych
       (skala 0–1, ale dużo niższa), a mierzony progiem wektorowym 0,35
       przepadał: „jaki mam aparat" dawało 0,29 i pamięć milczała. */
    return memories
      .map((m) => {
        const wektor = Boolean(qvec && sameModel(m, qmodel));
        return { m, wektor, score: wektor ? cosine(qvec, wektorDla(m, qmodel)) : keywordScore(query, m.text) };
      })
      .filter((s) => s.score > (s.wektor ? 0.35 : 0.15))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.m);
  }

  function memoryContextLines(items) {
    if (!items.length) return '';
    const lines = items.map((m) => {
      const d = new Date(m.time).toLocaleDateString('pl-PL');
      return `- [zapisano ${d}] ${m.text}`;
    });
    return 'PAMIĘĆ DŁUGOTRWAŁA — fakty, które użytkownik kazał Ci wcześniej zapamiętać ' +
           '(przywołane, bo pasują do bieżącej rozmowy):\n' + lines.join('\n');
  }

  async function handleMemory(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET') {
      return sendJson(res, 200, {
        memories: memories.map((m) => ({
          id: m.id, text: m.text, time: m.time, hasEmbedding: maWektor(m),
        })),
      });
    }
    if (req.method === 'POST') {
      let data;
      try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const text = String(data.text || '').trim().slice(0, 2000);
      if (!text) return sendJson(res, 400, { error: 'Puste pole text.' });
      const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, time: Date.now() };
      const vecs = await embedTexts([text], 60000, 'passage');
      if (vecs) ustawWektor(item, vecs.model, vecs.vectors[0]);
      memories.push(item);
      const blad = saveMemories();
      if (blad) {
        memories = memories.filter((m) => m !== item);
        return odpowiedzBledemZapisu(res, sendJson, blad);
      }
      return sendJson(res, 200, { ok: true, id: item.id, hasEmbedding: maWektor(item), total: memories.length });
    }
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      const before = memories.length;
      memories = memories.filter((m) => m.id !== id);
      const blad = memories.length !== before ? saveMemories() : null;
      if (blad) return odpowiedzBledemZapisu(res, sendJson, blad);
      return sendJson(res, 200, { ok: true, total: memories.length });
    }
    res.writeHead(405);
    res.end();
  }
  return {
    handleMemory, searchMemory, memoryContextLines, embedTexts, embedStatus,
    uzupelnijWektoryWTle,
    /* Te trzy używa też baza wiedzy i moduł nauki — to ten sam sposób
       liczenia podobieństwa, więc nie ma go po co dublować. */
    cosine, sameModel, keywordScore, wektorDla, ustawWektor, maWektor,
    /* Kopia zapasowa musi umieć ODCZYTAĆ i PODMIENIĆ całą listę. */
    // Zwraca błąd zapisu (null = zapisane) — przywracanie kopii ma go zgłosić.
    ustawListe: (nowe) => { memories = Array.isArray(nowe) ? nowe : memories; return saveMemories(); },
    lista: () => memories,
    ile: () => memories.length,
  };
}

module.exports = { utworz, cosine, sameModel, keywordScore, wektorDla, ustawWektor, maWektor, kompaktujWektory, MAKS_MODELI };

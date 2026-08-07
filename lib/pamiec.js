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

const fs = require('node:fs');
const path = require('node:path');

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

  let memories = [];
  try { memories = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch { /* brak pliku */ }

  function saveMemories() {
    try {
      fs.mkdirSync(katalogDanych, { recursive: true });
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2));
    } catch (err) {
      console.error('Nie udało się zapisać pamięci:', err.message);
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
      if (!Array.isArray(d.vectors) || !d.vectors.length) return null;
      return { vectors: d.vectors, model: `senses:${d.vectors[0].length}` };
    } catch {
      return null;
    }
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
        if (vectors.length !== texts.length) return null;
        return { vectors, model: `nvidia:${EMBED.nvidiaModel}` };
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Zwraca { vectors, model } albo null. `model` znakuje wektory — patrz sameModel(). */
  /* Bezpiecznik na wolne embeddingi.
   *
   * Gdy usługa raz nie wyrobiła się w budżecie, następne wywołania z krótkim
   * budżetem (te z rozmowy) nie czekają wcale — od razu idzie dopasowanie po
   * słowach kluczowych, a rozmowa rusza bez zwłoki. Po minucie próbujemy
   * ponownie: usługa mogła po prostu wstawać albo liczyć coś ciężkiego.
   *
   * Bez tego cisza 1,2 s wracała przy KAŻDEJ wiadomości — dokładnie ten rodzaj
   * drobnego tarcia, który sprawia, że narzędzie „jakoś tak mierzi".
   */
  const embedAwaria = { do: 0 };
  const EMBED_KARENCJA_MS = 60000;
  /* Poniżej tego budżetu wywołanie uznajemy za „z rozmowy" — takie odpuszczamy
     po awarii. Przeliczanie w tle (60 s) idzie zawsze, bo nikt na nie nie czeka. */
  const EMBED_BUDZET_ROZMOWY_MS = 5000;

  async function embedTexts(texts, timeoutMs = 60000, inputType = 'passage') {
    if (!texts || !texts.length || EMBED.provider === 'off') return null;
    if (timeoutMs <= EMBED_BUDZET_ROZMOWY_MS && Date.now() < embedAwaria.do) return null;
    const order = EMBED.provider === 'senses' ? ['senses']
      : EMBED.provider === 'nvidia' ? ['nvidia']
      : ['senses', 'nvidia'];
    for (const src of order) {
      const out = src === 'senses'
        ? await embedViaSenses(texts, timeoutMs)
        : await embedViaNvidia(texts, timeoutMs, inputType);
      if (out) { embedAwaria.do = 0; return out; }
    }
    // Nikt nie odpowiedział — przez chwilę nie zatrzymujemy dla nich rozmowy.
    embedAwaria.do = Date.now() + EMBED_KARENCJA_MS;
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

  /** Wektory z różnych modeli są nieporównywalne — pilnujemy zgodności znacznika. */
  function sameModel(item, model) {
    return Boolean(item.embedding) && (item.embModel || null) === model;
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
          brakujace.forEach((m, i) => { m.embedding = embs.vectors[i]; m.embModel = embs.model; });
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

    const threshold = qvec ? 0.35 : 0.15;
    return memories
      .map((m) => ({
        m,
        score: (qvec && sameModel(m, qmodel)) ? cosine(qvec, m.embedding) : keywordScore(query, m.text),
      }))
      .filter((s) => s.score > threshold)
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
        memories: memories.map(({ id, text, time, embedding }) => ({
          id, text, time, hasEmbedding: Boolean(embedding),
        })),
      });
    }
    if (req.method === 'POST') {
      let data;
      try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const text = String(data.text || '').trim().slice(0, 2000);
      if (!text) return sendJson(res, 400, { error: 'Puste pole text.' });
      const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, time: Date.now(), embedding: null };
      const vecs = await embedTexts([text], 60000, 'passage');
      if (vecs) { item.embedding = vecs.vectors[0]; item.embModel = vecs.model; }
      memories.push(item);
      saveMemories();
      return sendJson(res, 200, { ok: true, id: item.id, hasEmbedding: Boolean(item.embedding), total: memories.length });
    }
    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      const before = memories.length;
      memories = memories.filter((m) => m.id !== id);
      if (memories.length !== before) saveMemories();
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
    cosine, sameModel, keywordScore,
    /* Kopia zapasowa musi umieć ODCZYTAĆ i PODMIENIĆ całą listę. */
    ustawListe: (nowe) => { memories = Array.isArray(nowe) ? nowe : memories; saveMemories(); },
    lista: () => memories,
    ile: () => memories.length,
  };
}

module.exports = { utworz };

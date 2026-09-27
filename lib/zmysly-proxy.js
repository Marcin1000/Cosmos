/* ============================================================
   Pośrednik do usługi zmysłów (Cosmos Senses, Python na komputerze osoby
   albo w domu właściciela)

   Wydzielone z server.js (propozycja podziału zespołu IT, krok 2). Cosmos
   nie zależy od zmysłów – gdy usługa nie odpowiada, trasa oddaje 502
   z instrukcją, a reszta działa dalej. Droga do zmysłów idzie przez
   lib/agent-zmyslow.js: własny komputer osoby (agent) albo domowe GPU
   właściciela za zgodą. Bez żadnego – 403 (zasada 8 z CLAUDE.md), a adres
   domu (SENSES_URL) widzi tylko właściciel.
   ============================================================ */

const { SENSES_URL, NAGLOWKI_CUDZEGO, sendJson, readBodyBuffer } = require('./rdzen.js');
const { czyWlasciciel } = require('./kontekst.js');
const agent = require('./agent-zmyslow.js');

const BEZ_ZMYSLOW = 'Zmysły (rozpoznawanie, Whisper, YOLO) działają na Twoim komputerze – podłącz go w Ustawieniach → Zmysły. '
  + 'Mikrofon, głos i kamera z przeglądarki działają bez tego.';

/** Komunikat, gdy zmysły nie odpowiedziały – zależnie od tego, czyje były. */
function nieOdpowiada(err) {
  if (err && ['agent-uspiony', 'wynik-za-duzy', 'za-duze', 'agent-restart'].includes(err.kod)) return err.message;
  if (agent.zrodloZmyslow() === 'agent') {
    return 'Twój komputer ze zmysłami nie odpowiada – sprawdź w Ustawieniach → Zmysły, czy zmysły są włączone.';
  }
  // Adres domu (Tailscale) i polecenie startu – tylko dla właściciela. Karta
  // Ustawienia → Zmysły steruje komputerami osób, nie usługą pod SENSES_URL.
  return czyWlasciciel()
    ? `Komputer domowy ze zmysłami nie odpowiada (${SENSES_URL}): włącz go i uruchom na nim `
      + `python senses/service.py – albo podłącz go w Ustawieniach → Zmysły. (${err.cause?.code || err.message})`
    : 'Zmysły na komputerze właściciela teraz nie odpowiadają.';
}

/**
 * @param {object} z
 * @param {Function} z.U stan bieżącej osoby (współrzędne dla BirdNET)
 */
function utworz({ U }) {
  async function proxySenses(req, res, targetPath, { json = false, search = '' } = {}) {
    if (!agent.zmyslyDostepne()) return sendJson(res, 403, { error: BEZ_ZMYSLOW, kod: 'zmysly-niedostepne' });
    let upstream;
    let body;
    /* 32 MB: więcej przez agenta i tak nie pojedzie, a 128 MB wczytane
       w pamięć stawiało pętlę zdarzeń wszystkim (zespół IT, runda 6). */
    try { body = await readBodyBuffer(req, agent.MAX_CIALO_B); } catch {
      return sendJson(res, 413, { error: 'Plik jest za duży dla zmysłów (limit 32 MB).', kod: 'za-duze' });
    }
    try {
      upstream = await agent.fetchZmyslow(`${targetPath}${search}`, {
        method: 'POST',
        headers: { 'Content-Type': req.headers['content-type'] || (json ? 'application/json' : 'application/octet-stream') },
        body,
        // 90 s: za Cloudflare 100 s bez odpowiedzi to strona 524 zamiast czytelnego błędu.
        signal: AbortSignal.timeout(90000),
      });
    } catch (err) {
      return sendJson(res, 502, { error: nieOdpowiada(err), kod: 'zmysly-offline' });
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(statusZmyslow(upstream.status), { 'Content-Type': contentType, 'Content-Length': buf.length });
    res.end(buf);
  }

  /* Kinect nie jest kamerą UVC, więc przeglądarka go nie widzi i podgląd nie może
     użyć getUserMedia. Obraz idzie tędy: usługa zmysłów → serwer → przeglądarka. */

  /** Przekaż strumień MJPEG bez buforowania.
   *
   * Zwykłe proxy czeka na całą odpowiedź – a strumień nie kończy się nigdy.
   * Tutaj przepisujemy nagłówki i przelewamy ciało kawałek po kawałku, żeby
   * klatki docierały na bieżąco.
   */
  async function proxySensesStream(req, res, targetPath, search = '') {
    if (!agent.zmyslyDostepne()) return sendJson(res, 403, { error: BEZ_ZMYSLOW, kod: 'zmysly-niedostepne' });
    /* Agent zmysłów przekazuje zlecenia pojedynczo (długie odpytywanie), więc
       strumienia MJPEG nie przeniesie – przeglądarka przechodzi wtedy na
       pojedyncze klatki (proxySensesGet), tak jak przy proxy bez strumieni. */
    if (agent.zrodloZmyslow() === 'agent') return sendJson(res, 501, { error: 'Strumień niedostępny przez agenta – pojedyncze klatki.', kod: 'bez-strumienia' });
    const ctrl = new AbortController();
    // Gdy przeglądarka zamknie podgląd, zrywamy też połączenie do zmysłów –
    // inaczej Kinect produkowałby klatki w nieskończoność dla nikogo.
    res.on('close', () => ctrl.abort());

    let upstream;
    try {
      upstream = await fetch(`${SENSES_URL}${targetPath}${search}`, { signal: ctrl.signal });
    } catch (err) {
      if (!res.headersSent) sendJson(res, 502, { error: `Usługa percepcji nie odpowiada: ${err.message}` });
      return;
    }
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '');
      if (!res.headersSent) {
        res.writeHead(statusZmyslow(upstream.status), { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
        res.end(text);
      }
      return;
    }
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') || 'multipart/x-mixed-replace',
      'Cache-Control': 'no-store',
      Connection: 'close',
    });
    try {
      for await (const chunk of upstream.body) {
        if (!res.write(Buffer.from(chunk))) {
          await new Promise((r) => res.once('drain', r));
        }
      }
    } catch { /* zerwane połączenie – normalne przy zamknięciu podglądu */ }
    res.end();
  }

  /** Odczyt z usługi percepcji (GET) – pojedyncza klatka, status czujnika.
   *  Zapasowa droga, gdy strumień MJPEG nie przejdzie przez proxy. */
  async function proxySensesGet(req, res, targetPath, search = '') {
    if (!agent.zmyslyDostepne()) return sendJson(res, 403, { error: BEZ_ZMYSLOW, kod: 'zmysly-niedostepne' });
    let upstream;
    try {
      upstream = await agent.fetchZmyslow(`${targetPath}${search}`, {
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      return sendJson(res, 502, { error: nieOdpowiada(err), kod: 'zmysly-offline' });
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(statusZmyslow(upstream.status), {
      ...NAGLOWKI_CUDZEGO,   // treść z innego procesu pod naszą domeną – bez zgadywania typu i bez skryptów
      'Content-Type': contentType,
      'Content-Length': buf.length,
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  }

  async function handleZmysly(req, res, p) {
    /* Ptak z dźwięku (BirdNET). Osobna trasa, a nie „jeszcze jeden tryb STT",
       bo to inne pytanie: nie „co ktoś powiedział", tylko „kto to śpiewa".
       Współrzędne dokłada SERWER z ustawień – przeglądarka nie musi ich znać,
       a BirdNET bez nich zawęża listę gatunków do całego świata zamiast do
       tego, co w tym tygodniu naprawdę lata nad Twoją łąką. */
    if (p === '/api/ptak' && req.method === 'POST') {
      const w = U().wspolrzedne;
      const qs = w && Number.isFinite(w.lat)
        ? `?lat=${encodeURIComponent(w.lat)}&lon=${encodeURIComponent(w.lon)}`
        : '';
      return await proxySenses(req, res, '/ptak', { search: qs });
    }
    if (p === '/api/detect' && req.method === 'POST') return await proxySenses(req, res, '/detect', { json: true });
    if (p === '/api/pose' && req.method === 'POST') return await proxySenses(req, res, '/pose', { json: true });
    if (p === '/api/kinect/stream' && req.method === 'GET') {
      return await proxySensesStream(req, res, '/kinect/stream',
        new URL(req.url, 'http://localhost').search);
    }
    if (p === '/api/kinect/frame' && req.method === 'GET') {
      return await proxySensesGet(req, res, '/kinect/frame',
        new URL(req.url, 'http://localhost').search);
    }
    if (p === '/api/kinect/status' && req.method === 'GET') {
      return await proxySensesGet(req, res, '/kinect/status');
    }
    return sendJson(res, 404, { error: 'Nie ma takiej trasy.' });
  }

  return { handleZmysly, proxySenses };
}

/* 401/403 usługi zmysłów to nie wygasła sesja Cosmosa – przepuszczone dalej
   kazały przeglądarce pokazać ekran logowania (zespół IT, runda 5). */
function statusZmyslow(s) { return s === 401 || s === 403 ? 502 : s; }

module.exports = { utworz, BEZ_ZMYSLOW };

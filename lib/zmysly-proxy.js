/* ============================================================
   Pośrednik do usługi zmysłów (Cosmos Senses, Python w domu właściciela)

   Wydzielone z server.js (propozycja podziału zespołu IT, krok 2). Cosmos
   nie zależy od zmysłów – gdy usługa nie odpowiada, trasa oddaje 502
   z instrukcją, a reszta działa dalej. Zmysły to domowe GPU właściciela:
   członek bez przyznanego „lokalnego GPU" dostaje 403 (zasada 8 z CLAUDE.md),
   a adres domu (SENSES_URL) widzi tylko właściciel.
   ============================================================ */

const { SENSES_URL, NAGLOWKI_CUDZEGO, sendJson, readBodyBuffer } = require('./rdzen.js');
const { czyWlasciciel } = require('./kontekst.js');
const silniki = require('./silniki.js');

const BEZ_ZMYSLOW = 'Zmysły (rozpoznawanie, Whisper, YOLO) działają na komputerze właściciela – '
  + 'dostęp daje przełącznik „lokalny GPU" w panelu Dostęp. Mikrofon, głos i kamera z przeglądarki działają bez tego.';

/**
 * @param {object} z
 * @param {Function} z.U stan bieżącej osoby (współrzędne dla BirdNET)
 */
function utworz({ U }) {
  async function proxySenses(req, res, targetPath, { json = false, search = '' } = {}) {
    if (!silniki.zmyslyDozwolone()) return sendJson(res, 403, { error: BEZ_ZMYSLOW, kod: 'zmysly-niedostepne' });
    let upstream;
    try {
      const body = await readBodyBuffer(req);
      upstream = await fetch(`${SENSES_URL}${targetPath}${search}`, {
        method: 'POST',
        headers: { 'Content-Type': req.headers['content-type'] || (json ? 'application/json' : 'application/octet-stream') },
        body,
        // 90 s: za Cloudflare 100 s bez odpowiedzi to strona 524 zamiast czytelnego błędu.
        signal: AbortSignal.timeout(90000),
      });
    } catch (err) {
      // Adres domu (Tailscale) i polecenie startu – tylko dla właściciela.
      return sendJson(res, 502, {
        error: czyWlasciciel()
          ? `Usługa percepcji (Cosmos Senses) nie odpowiada pod ${SENSES_URL}. `
            + `Uruchom ją: python senses/service.py (${err.message})`
          : 'Usługa percepcji na komputerze właściciela teraz nie odpowiada.',
      });
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { 'Content-Type': contentType, 'Content-Length': buf.length });
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
        res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
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
    let upstream;
    try {
      upstream = await fetch(`${SENSES_URL}${targetPath}${search}`, {
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      // Trasy stąd (Kinect) są tylko dla właściciela – adres może zostać.
      return sendJson(res, 502, {
        error: `Usługa percepcji nie odpowiada pod ${SENSES_URL}. ` +
               `Uruchom ją: python senses/service.py (${err.message})`,
      });
    }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
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

module.exports = { utworz, BEZ_ZMYSLOW };

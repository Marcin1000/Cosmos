/* ============================================================
   Zdarzenia percepcji – pamięć krótkotrwała „zmysłów"

   Wszystko, co Cosmos zauważa (kamera, mikrofon, czujniki, słowo aktywujące
   z komputera), ląduje tutaj i trafia do kontekstu rozmowy.

   Nowość: kanał w drugą stronę. Dotąd przeglądarka tylko WYSYŁAŁA zdarzenia
   i nigdy się nie dowiadywała, że coś się stało – dlatego „Hej, Kosmos"
   wykryte przez `senses/wake_listener.py` na komputerze umierało w logu
   serwera. Teraz każde zdarzenie jest rozgłaszane strumieniem SSE do
   wszystkich otwartych okien.
   ============================================================ */

const { kto, ktoWymagany } = require('./kontekst.js');

const EVENTS_MAX = 100;

/* Zdarzenia KAŻDEJ OSOBY OSOBNO. To jest pamięć tego, co widzi kamera
   i słyszy mikrofon – przy wspólnej liście obraz z Kinecta właściciela
   trafiałby do kontekstu rozmowy gościa i na jego ekran. */
const zdarzeniaOsob = new Map(); // id użytkownika → [{ time, type, summary }]

function listaOsoby(id) {
  let l = zdarzeniaOsob.get(id);
  if (!l) { l = []; zdarzeniaOsob.set(id, l); }
  return l;
}

/* Otwarte strumienie do przeglądarek: { res, uid, wazny, rozlacz }. Set, nie
   tablica – okno może zniknąć w dowolnej chwili i chcemy je usuwać po referencji. */
const sluchacze = new Set();

/** Podłącz przeglądarkę do strumienia zdarzeń (SSE). `wazny()` mówi, czy sesja,
 *  z którą się podłączyła, jeszcze istnieje – sprawdzamy przy każdym zdarzeniu
 *  i pulsie. „Wyloguj wszędzie", zmiana hasła i usunięte konto kasowały sesję,
 *  ale otwarte połączenie żyło dalej: zgubiony telefon widział nazwy plików,
 *  notatki, prompty Studia i lokalizację aż do zerwania sieci. */
function podlaczStrumien(req, res, { wazny } = {}) {
  const u = ktoWymagany('strumień zdarzeń');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Pierwsza porcja od razu: okno otwarte po zdarzeniu ma poznać stan.
  res.write(`event: historia\ndata: ${JSON.stringify(recentEvents(60000, 5))}\n\n`);
  const wpis = { res, uid: u.id, wazny };
  sluchacze.add(wpis);

  // Puls co 25 s – pośredniki (Caddy, Cloudflare) zamykają ciche połączenia.
  const puls = setInterval(() => {
    if (wpis.wazny && !wpis.wazny()) return rozlacz();
    try { res.write(': puls\n\n'); } catch { rozlacz(); }
  }, 25000);

  const rozlacz = () => {
    clearInterval(puls);
    sluchacze.delete(wpis);
    try { res.end(); } catch { /* już zamknięte */ }
  };
  wpis.rozlacz = rozlacz;
  req.on('close', rozlacz);
  req.on('error', rozlacz);
}

function rozglos(uid, zdarzenie) {
  const ramka = `event: zdarzenie\ndata: ${JSON.stringify(zdarzenie)}\n\n`;
  for (const wpis of sluchacze) {
    if (wpis.uid !== uid) continue;
    if (wpis.wazny && !wpis.wazny()) { wpis.rozlacz(); continue; }
    try { wpis.res.write(ramka); } catch { sluchacze.delete(wpis); }
  }
}

/* Zdarzenie bez właściciela (start serwera, zadanie systemowe) NIE idzie do
   nikogo – tylko do logu. Wysłanie go „do wszystkich" albo „do właściciela
   na wszelki wypadek" to dokładnie ten rodzaj cichego rozlania danych,
   przed którym broni lib/kontekst.js. */
function addEvent(type, summary) {
  const zdarzenie = {
    time: Date.now(),
    type: String(type || 'event'),
    summary: String(summary || '').slice(0, 400),
  };
  const u = kto();
  if (!u) {
    console.log(`  · [${zdarzenie.type}] ${zdarzenie.summary}`);
    return;
  }
  const events = listaOsoby(u.id);
  events.push(zdarzenie);
  if (events.length > EVENTS_MAX) events.splice(0, events.length - EVENTS_MAX);
  rozglos(u.id, zdarzenie);
}

/** Ostatnie zdarzenia BIEŻĄCEJ osoby. Bez kontekstu – pusto, nie cudze. */
function recentEvents(maxAgeMs = 10 * 60 * 1000, limit = 12) {
  const u = kto();
  if (!u) return [];
  const cutoff = Date.now() - maxAgeMs;
  return listaOsoby(u.id).filter((e) => e.time >= cutoff).slice(-limit);
}

function sceneContext() {
  const recent = recentEvents();
  if (!recent.length) return '';
  const lines = recent.map((e) => {
    const t = new Date(e.time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `[${t}] (${e.type}) ${e.summary}`;
  });
  return 'KONTEKST PERCEPCJI – ostatnie zdarzenia z czujników (kamera/mikrofon/czujniki użytkownika). ' +
         'Traktuj je jako to, co właśnie widzisz i słyszysz w otoczeniu użytkownika:\n' + lines.join('\n');
}

module.exports = {
  EVENTS_MAX, addEvent, recentEvents, sceneContext,
  podlaczStrumien, iluSluchaczy: () => sluchacze.size,
  ileZdarzen: () => { const u = kto(); return u ? listaOsoby(u.id).length : 0; },
};

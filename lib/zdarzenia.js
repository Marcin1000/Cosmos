/* ============================================================
   Zdarzenia percepcji — pamięć krótkotrwała „zmysłów"

   Wszystko, co Cosmos zauważa (kamera, mikrofon, czujniki, słowo aktywujące
   z komputera), ląduje tutaj i trafia do kontekstu rozmowy.

   Nowość: kanał w drugą stronę. Dotąd przeglądarka tylko WYSYŁAŁA zdarzenia
   i nigdy się nie dowiadywała, że coś się stało — dlatego „Hej, Kosmos"
   wykryte przez `senses/wake_listener.py` na komputerze umierało w logu
   serwera. Teraz każde zdarzenie jest rozgłaszane strumieniem SSE do
   wszystkich otwartych okien.
   ============================================================ */

const EVENTS_MAX = 100;
const events = []; // { time, type, summary }

/* Otwarte strumienie do przeglądarek. Set, nie tablica — okno może zniknąć
   w dowolnej chwili i chcemy je usuwać po referencji. */
const sluchacze = new Set();

/** Podłącz przeglądarkę do strumienia zdarzeń (SSE). */
function podlaczStrumien(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // Pierwsza porcja od razu: okno otwarte po zdarzeniu ma poznać stan.
  res.write(`event: historia\ndata: ${JSON.stringify(recentEvents(60000, 5))}\n\n`);
  sluchacze.add(res);

  // Puls co 25 s — pośredniki (Caddy, Cloudflare) zamykają ciche połączenia.
  const puls = setInterval(() => {
    try { res.write(': puls\n\n'); } catch { rozlacz(); }
  }, 25000);

  const rozlacz = () => {
    clearInterval(puls);
    sluchacze.delete(res);
    try { res.end(); } catch { /* już zamknięte */ }
  };
  req.on('close', rozlacz);
  req.on('error', rozlacz);
}

function rozglos(zdarzenie) {
  const ramka = `event: zdarzenie\ndata: ${JSON.stringify(zdarzenie)}\n\n`;
  for (const res of sluchacze) {
    try { res.write(ramka); } catch { sluchacze.delete(res); }
  }
}

function addEvent(type, summary) {
  const zdarzenie = {
    time: Date.now(),
    type: String(type || 'event'),
    summary: String(summary || '').slice(0, 400),
  };
  events.push(zdarzenie);
  if (events.length > EVENTS_MAX) events.splice(0, events.length - EVENTS_MAX);
  rozglos(zdarzenie);
}

function recentEvents(maxAgeMs = 10 * 60 * 1000, limit = 12) {
  const cutoff = Date.now() - maxAgeMs;
  return events.filter((e) => e.time >= cutoff).slice(-limit);
}

function sceneContext() {
  const recent = recentEvents();
  if (!recent.length) return '';
  const lines = recent.map((e) => {
    const t = new Date(e.time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `[${t}] (${e.type}) ${e.summary}`;
  });
  return 'KONTEKST PERCEPCJI — ostatnie zdarzenia z czujników (kamera/mikrofon/czujniki użytkownika). ' +
         'Traktuj je jako to, co właśnie widzisz i słyszysz w otoczeniu użytkownika:\n' + lines.join('\n');
}

module.exports = {
  EVENTS_MAX, addEvent, recentEvents, sceneContext,
  podlaczStrumien, iluSluchaczy: () => sluchacze.size, ileZdarzen: () => events.length,
};

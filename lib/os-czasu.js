/* ============================================================
   Oś czasu – migawki otoczenia (Digital Time Machine)

   Wydzielone z server.js. Migawka = chwila z kamery: obraz (w bazie wiedzy)
   i wykryte obiekty; GET dokłada, co się pojawiło i co zniknęło względem
   poprzedniej. Zapis, który się nie udał, odpowiada 507/500, nie „ok"
   (lib/miejsce.js).
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const { zapiszAtomowo } = require('./rdzen.js');
const { zapiszLubBlad, toBrakMiejsca } = require('./miejsce.js');

/**
 * @param {object} z
 * @param {Function} z.U          stan bieżącej osoby
 * @param {Function} z.kbAddFile  zapis obrazu migawki do bazy wiedzy
 * @param {Function} z.kbPliki    katalog plików bazy wiedzy bieżącej osoby
 * @param {Function} z.saveKb     zapis indeksu bazy wiedzy
 * @param {Function} z.tsName     nazwa pliku ze znacznikiem czasu
 */
function utworz({ U, readJson, sendJson, addEvent, bladZapisu, kbAddFile, kbPliki, saveKb, tsName }) {
  const TIMELINE_FILE = () => path.join(U().katalog, 'timeline.json');
  function saveTimeline() {
    return zapiszLubBlad('osi czasu', () => zapiszAtomowo(TIMELINE_FILE(), JSON.stringify(U().timeline)));
  }

  async function handleTimeline(req, res) {
    if (req.method === 'GET') {
      // dołącz różnice względem poprzedniej migawki
      const withDiff = U().timeline.map((s, i) => {
        const prev = U().timeline[i - 1];
        const cur = new Set(s.objects || []);
        const old = new Set(prev ? prev.objects || [] : []);
        return {
          ...s,
          appeared: [...cur].filter((o) => !old.has(o)),
          disappeared: [...old].filter((o) => !cur.has(o)),
        };
      });
      return sendJson(res, 200, { snapshots: withDiff });
    }
    if (req.method === 'POST') {
      let data;
      try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      let imageId = null;
      if (data.image) {
        try {
          const buf = Buffer.from(String(data.image).split(',').pop(), 'base64');
          const item = await kbAddFile(tsName('migawka', 'jpg'), 'image/jpeg', buf, 'Migawka osi czasu.');
          imageId = item.id;
        } catch (err) {
          // Pełny dysk albo limit osoby – powiedz to, zamiast zapisać migawkę bez obrazu.
          if (toBrakMiejsca(err)) return bladZapisu(res, err);
        }
      }
      const snap = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        time: Date.now(),
        label: String(data.label || '').slice(0, 120),
        objects: Array.isArray(data.objects) ? data.objects.slice(0, 40) : [],
        imageId,
      };
      U().timeline.push(snap);
      if (U().timeline.length > 500) U().timeline = U().timeline.slice(-500);
      const blad = saveTimeline();
      if (blad) {
        U().timeline = U().timeline.filter((x) => x !== snap);
        return bladZapisu(res, blad);
      }
      addEvent('oś-czasu', `zapisano migawkę otoczenia${snap.objects.length ? `: ${snap.objects.join(', ')}` : ''}`);
      return sendJson(res, 200, { ok: true, id: snap.id });
    }
    if (req.method === 'DELETE') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      const snap = U().timeline.find((s) => s.id === id);
      if (snap?.imageId) { try { fs.unlinkSync(path.join(kbPliki(), snap.imageId)); } catch { /* skip */ }
        U().kbItems = U().kbItems.filter((it) => it.id !== snap.imageId); saveKb(); }
      U().timeline = U().timeline.filter((s) => s.id !== id);
      const blad = saveTimeline();
      if (blad) return bladZapisu(res, blad);
      return sendJson(res, 200, { ok: true });
    }
    res.writeHead(405); res.end();
  }

  return { handleTimeline, saveTimeline };
}

module.exports = { utworz };

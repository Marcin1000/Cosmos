/* ============================================================
   Nagrywanie procedur — Playwright pod nadzorem

   Cosmos potrafi nagrać, jak wykonujesz coś w przeglądarce, i zapisać to jako
   procedurę do późniejszego odtworzenia. Moduł jest OPCJONALNY: wymaga
   Playwrighta i ekranu, więc na serwerze bez GUI po prostu nie wystartuje
   i mówi o tym wprost, zamiast się wywracać.

   Wydzielone z server.js przy podziale pliku — zależności wchodzą przez
   `utworz()`, nie przez globalne stany serwera.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { genId } = require('./rdzen.js');

/**
 * @param {object} z
 * @param {string} z.katalogTreningu  gdzie zapisać nagranie
 * @param {string} z.skryptNagrywarki ścieżka do automation/recorder.js
 * @param {string} z.katalogAutomatyzacji katalog roboczy nagrywarki
 *
 * Katalog przekazujemy JAWNIE, a nie przez `__dirname`. W server.js `__dirname`
 * wskazywał katalog główny projektu; po przeniesieniu do `lib/` wskazywałby
 * `lib/` i nagrywarka startowałaby w złym miejscu. To jest dokładnie ta klasa
 * usterki, która przy podziale pliku przechodzi niezauważona.
 * @param {Function} z.sendJson       odpowiedź HTTP
 * @param {Function} z.readJson       odczyt ciała żądania
 * @param {Function} z.addEvent       dziennik zdarzeń
 * @param {Function} z.sanitizeStep   walidacja kroku procedury (lib/nauka.js)
 * @param {Function} z.saveProcedures zapis listy procedur (lib/nauka.js)
 * @param {Function} z.dodajProcedure dopisanie procedury (lib/nauka.js)
 */
function utworz({ katalogTreningu, skryptNagrywarki, katalogAutomatyzacji,
  sendJson, readJson, addEvent, sanitizeStep, saveProcedures, dodajProcedure }) {
  const RECORDER_SCRIPT = skryptNagrywarki;
  const TRAIN_DIR = katalogTreningu;
  let recordJob = null; // { child, status, outFile, startedAt, log:[] }
  const RECORD_OUT = path.join(TRAIN_DIR, 'recording.json');

  function recLog(line) {
    if (!recordJob) return;
    for (const l of String(line).split('\n')) { const s = l.replace(/\s+$/, ''); if (s) recordJob.log.push(s); }
    if (recordJob.log.length > 100) recordJob.log = recordJob.log.slice(-100);
  }

  async function handleRecord(req, res, pathname) {
    if (pathname === '/api/procedures/record/status' && req.method === 'GET') {
      return sendJson(res, 200, {
        recording: Boolean(recordJob && recordJob.status === 'recording'),
        status: recordJob ? recordJob.status : 'idle',
        log: recordJob ? recordJob.log.slice(-20) : [],
      });
    }
    if (pathname === '/api/procedures/record/start' && req.method === 'POST') {
      let available = false; try { require.resolve('playwright'); available = true; } catch { /* */ }
      if (!available) return sendJson(res, 400, { error: 'no-playwright', message: 'Moduł automatyzacji nie jest zainstalowany (npm install playwright).' });
      if (recordJob && recordJob.status === 'recording') return sendJson(res, 409, { error: 'busy', message: 'Nagrywanie już trwa.' });
      let data = {}; try { data = await readJson(req); } catch { /* */ }
      const url = String(data.url || '').slice(0, 500);
      fs.mkdirSync(TRAIN_DIR, { recursive: true });
      try { fs.unlinkSync(RECORD_OUT); } catch { /* */ }
      const args = [RECORDER_SCRIPT];
      if (/^https?:\/\//i.test(url)) { args.push('--url', url); }
      recordJob = { status: 'recording', startedAt: Date.now(), outFile: RECORD_OUT, log: [], child: null };
      let child;
      try { child = spawn('node', args, { cwd: katalogAutomatyzacji, env: { ...process.env, COSMOS_RECORD_OUT: RECORD_OUT }, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (err) { recordJob.status = 'error'; return sendJson(res, 500, { error: 'spawn-failed', message: err.message }); }
      recordJob.child = child;
      child.stdout.on('data', (d) => recLog(d));
      child.stderr.on('data', (d) => recLog(d));
      child.on('close', () => { if (recordJob && recordJob.status === 'recording') recordJob.status = 'ready'; });
      addEvent('nauka', 'rozpoczęto nagrywanie procedury');
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/procedures/record/stop' && req.method === 'POST') {
      if (!recordJob) return sendJson(res, 400, { error: 'not-recording' });
      let data = {}; try { data = await readJson(req); } catch { /* */ }
      // zatrzymaj proces (nagrywarka flushuje kroki przy SIGTERM/zamknięciu okna)
      if (recordJob.child && recordJob.status === 'recording') { try { recordJob.child.kill('SIGTERM'); } catch { /* */ } }
      await new Promise((r) => setTimeout(r, 600)); // daj czas na flush
      let parsed = { steps: [] };
      try { parsed = JSON.parse(fs.readFileSync(RECORD_OUT, 'utf8')); } catch { /* brak */ }
      recordJob.status = 'idle';
      if (parsed.error) return sendJson(res, 400, { error: parsed.error, message: 'Nagrywanie nie powiodło się (brak ekranu lub przeglądarki).' });
      const steps = Array.isArray(parsed.steps) ? parsed.steps.slice(0, 60).map(sanitizeStep) : [];
      if (!steps.length) return sendJson(res, 200, { ok: true, id: null, steps: [], message: 'Nie zarejestrowano żadnych kroków.' });
      const name = String(data.name || '').trim().slice(0, 120) || `Nagranie ${new Date().toLocaleString('pl-PL')}`;
      const item = { id: genId(), name, description: 'Nagrana automatycznie.', scope: 'web', steps, createdAt: Date.now(), updatedAt: Date.now() };
      dodajProcedure(item); saveProcedures();
      addEvent('nauka', `zapisano nagraną procedurę: ${name} (${steps.length} kroków)`);
      return sendJson(res, 200, { ok: true, id: item.id, steps, name });
    }
    res.writeHead(405); res.end();
  }

  return { handleRecord };
}

module.exports = { utworz };

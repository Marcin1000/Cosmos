/* ============================================================
   Nauka — jak Cosmos uczy się od Ciebie

   Trzy rzeczy naraz, dlatego jeden moduł:
     • rozpoznawanie — pokazujesz coś w kamerze i nazywasz,
     • procedury — czynności krok po kroku, nagrane albo wpisane,
     • rutyny — te procedury odpalane cyklicznie.

   Kroki wrażliwe (płatność, wysłanie) zawsze wymagają potwierdzenia człowieka;
   automatyzacja stron jest domyślnie tylko-do-odczytu.
   ============================================================ */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DATA_DIR, SECRETS, genId, readJson, saveJsonFile, sendJson } = require('./rdzen.js');

/* Wstrzykiwane przez server.js — te elementy należą do innych dziedzin.
   Zamiast krzyżowych `require` (i pułapki cyklicznych zależności) serwer
   podaje je raz, przy starcie. */
let KB_FILES, addEvent, cosine, embedTexts, kbAddFile, kbItems, keywordScore, sameModel, saveKb;
function polacz(z) {
  ({ KB_FILES, addEvent, cosine, embedTexts, kbAddFile, kbItems, keywordScore, sameModel, saveKb } = z);
}

// ---------------------------------------------------------------------------
// NAUKA — uczenie Cosmosa.
//   1) Rozpoznawanie przez zmysły ("pokaż w kamerze"): zapamiętane wzorce
//      (etykieta + opis + embedding + miniatura). Później dopasowywane do
//      tego, co widzą zmysły — jak pamięć długotrwała, ale dla obrazu/gestu.
//   2) Procedury ("pokaż kroki"): nauczona sekwencja czynności w przeglądarce,
//      z krokami oznaczonymi jako wrażliwe (płatność, wysłanie) — te zawsze
//      wymagają potwierdzenia użytkownika.
//   3) Rutyny: cykliczny harmonogram odpalania procedur. Domyślnie tryb
//      "prepare" — Cosmos przygotowuje czynność, ale nic nieodwracalnego nie
//      robi sam. Scheduler tylko zgłasza, że nadszedł czas.
// ---------------------------------------------------------------------------

const LESSONS_FILE = path.join(DATA_DIR, 'lessons.json');
const PROCEDURES_FILE = path.join(DATA_DIR, 'procedures.json');
const ROUTINES_FILE = path.join(DATA_DIR, 'routines.json');

let lessons = [];
let procedures = [];
let routines = [];
try { lessons = JSON.parse(fs.readFileSync(LESSONS_FILE, 'utf8')); } catch { /* brak */ }
try { procedures = JSON.parse(fs.readFileSync(PROCEDURES_FILE, 'utf8')); } catch { /* brak */ }
try { routines = JSON.parse(fs.readFileSync(ROUTINES_FILE, 'utf8')); } catch { /* brak */ }

const saveLessons = () => saveJsonFile(LESSONS_FILE, lessons);
const saveProcedures = () => saveJsonFile(PROCEDURES_FILE, procedures);
const saveRoutines = () => saveJsonFile(ROUTINES_FILE, routines);


function lessonDescriptor(l) {
  return [l.label, l.note, (l.objects || []).join(', ')].filter(Boolean).join('. ');
}

// --- 1) Rozpoznawanie ---
async function handleLessons(req, res, pathname) {
  if (pathname === '/api/lessons' && req.method === 'GET') {
    return sendJson(res, 200, {
      lessons: lessons.map((l) => ({
        id: l.id, label: l.label, kind: l.kind, note: l.note,
        objects: l.objects || [], thumbId: l.thumbId, createdAt: l.createdAt,
        hasEmbedding: Boolean(l.embedding),
      })),
    });
  }
  if (pathname === '/api/lessons' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const label = String(data.label || '').trim().slice(0, 120);
    if (!label) return sendJson(res, 400, { error: 'Podaj nazwę tego, czego Cosmos ma się nauczyć.' });
    const kind = ['object', 'gesture', 'pose', 'scene'].includes(data.kind) ? data.kind : 'object';
    let thumbId = null;
    if (data.image) {
      try {
        const buf = Buffer.from(String(data.image).split(',').pop(), 'base64');
        const item = await kbAddFile(tsName('wzorzec', 'jpg'), 'image/jpeg', buf, `Wzorzec nauki: ${label}`);
        thumbId = item.id;
      } catch { /* bez miniatury */ }
    }
    const item = {
      id: genId(), label, kind, note: String(data.note || '').slice(0, 400),
      objects: Array.isArray(data.objects) ? data.objects.slice(0, 40) : [],
      thumbId, createdAt: Date.now(), embedding: null,
    };
    const vecs = await embedTexts([lessonDescriptor(item)], 60000, 'passage');
    if (vecs) { item.embedding = vecs.vectors[0]; item.embModel = vecs.model; }
    lessons.push(item);
    saveLessons();
    addEvent('nauka', `nauczono rozpoznawać: ${label}`);
    return sendJson(res, 200, { ok: true, id: item.id, hasEmbedding: Boolean(item.embedding) });
  }
  if (pathname === '/api/lessons' && req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const l = lessons.find((x) => x.id === id);
    if (l?.thumbId) { try { fs.unlinkSync(path.join(KB_FILES, l.thumbId)); } catch { /* skip */ }
      kbItems = kbItems.filter((it) => it.id !== l.thumbId); saveKb(); }
    lessons = lessons.filter((x) => x.id !== id);
    saveLessons();
    return sendJson(res, 200, { ok: true });
  }
  // dopasowanie: co z tego, co widać, Cosmos już zna?
  if (pathname === '/api/lessons/match' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const matches = await matchLessons(String(data.text || ''), Array.isArray(data.objects) ? data.objects : []);
    return sendJson(res, 200, { matches });
  }
  res.writeHead(405); res.end();
}

async function matchLessons(text, objects, limit = 4) {
  if (!lessons.length) return [];
  const queryText = [text, objects.join(', ')].filter(Boolean).join('. ');
  if (!queryText.trim()) return [];
  let qvec = null, qmodel = null;
  const q = await embedTexts([queryText], 5000, 'query');
  if (q) {
    qvec = q.vectors[0];
    qmodel = q.model;
    const missing = lessons.filter((l) => !sameModel(l, qmodel));
    if (missing.length) {
      const embs = await embedTexts(missing.map(lessonDescriptor), 60000, 'passage');
      if (embs) {
        missing.forEach((l, i) => { l.embedding = embs.vectors[i]; l.embModel = embs.model; });
        saveLessons();
      }
    }
  }
  const objSet = new Set(objects.map((o) => String(o).toLowerCase()));
  const threshold = qvec ? 0.4 : 0.2;
  return lessons
    .map((l) => {
      let score = (qvec && sameModel(l, qmodel)) ? cosine(qvec, l.embedding) : keywordScore(queryText, lessonDescriptor(l));
      // premia, gdy wykryte obiekty pokrywają się z obiektami wzorca
      const overlap = (l.objects || []).filter((o) => objSet.has(String(o).toLowerCase())).length;
      if (overlap) score += 0.15 * overlap;
      return { l, score };
    })
    .filter((s) => s.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => ({ id: s.l.id, label: s.l.label, kind: s.l.kind, note: s.l.note, score: Math.round(s.score * 100) / 100 }));
}

// --- 2) Procedury ---
function sanitizeStep(s) {
  const action = ['open', 'click', 'type', 'read', 'wait', 'confirm', 'note'].includes(s.action) ? s.action : 'note';
  return {
    action,
    target: String(s.target || '').slice(0, 500),
    value: String(s.value || '').slice(0, 500),
    // krok wrażliwy = nieodwracalny (płatność, wysłanie, potwierdzenie); zawsze wymaga zgody
    sensitive: Boolean(s.sensitive) || action === 'confirm',
    // krok logowania (type/click) — może użyć sekretu z menedżera haseł; dozwolony w trybie auto
    auth: Boolean(s.auth) && (action === 'type' || action === 'click'),
    note: String(s.note || '').slice(0, 300),
  };
}

async function handleProcedures(req, res, pathname) {
  const url = new URL(req.url, 'http://localhost');
  if (pathname === '/api/procedures' && req.method === 'GET') {
    return sendJson(res, 200, { procedures: procedures.map((p) => ({ ...p, readOnly: autoEligibility(p).eligible, needsAuth: autoEligibility(p).needsAuth })) });
  }
  if (pathname === '/api/procedures' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const name = String(data.name || '').trim().slice(0, 120);
    if (!name) return sendJson(res, 400, { error: 'Podaj nazwę procedury.' });
    const steps = Array.isArray(data.steps) ? data.steps.slice(0, 60).map(sanitizeStep) : [];
    const item = {
      id: genId(), name, description: String(data.description || '').slice(0, 600),
      scope: 'web', steps, createdAt: Date.now(), updatedAt: Date.now(),
    };
    procedures.push(item);
    saveProcedures();
    addEvent('nauka', `nauczono procedury: ${name} (${steps.length} kroków)`);
    return sendJson(res, 200, { ok: true, id: item.id });
  }
  if (pathname === '/api/procedures' && req.method === 'PUT') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const p = procedures.find((x) => x.id === data.id);
    if (!p) return sendJson(res, 404, { error: 'Nie znaleziono procedury.' });
    if (data.name != null) p.name = String(data.name).trim().slice(0, 120) || p.name;
    if (data.description != null) p.description = String(data.description).slice(0, 600);
    if (Array.isArray(data.steps)) p.steps = data.steps.slice(0, 60).map(sanitizeStep);
    p.updatedAt = Date.now();
    saveProcedures();
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/procedures' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    procedures = procedures.filter((x) => x.id !== id);
    routines = routines.filter((r) => r.procedureId !== id); saveRoutines();
    saveProcedures();
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405); res.end();
}

// --- 3) Rutyny (harmonogram) ---
function computeNextRun(schedule, from = Date.now()) {
  const s = schedule || {};
  if (s.type === 'interval') {
    const mins = Math.max(1, Number(s.everyMinutes) || 60);
    return from + mins * 60 * 1000;
  }
  const [hh, mm] = String(s.time || '09:00').split(':').map((n) => parseInt(n, 10) || 0);
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setHours(hh, mm, 0, 0);
  if (s.type === 'weekly') {
    const target = Math.min(6, Math.max(0, Number(s.day) || 0));
    let add = (target - d.getDay() + 7) % 7;
    if (add === 0 && d.getTime() <= from) add = 7;
    d.setDate(d.getDate() + add);
  } else if (s.type === 'monthly') {
    const dom = Math.min(28, Math.max(1, Number(s.day) || 1));
    d.setDate(dom);
    if (d.getTime() <= from) d.setMonth(d.getMonth() + 1);
  } else { // daily
    if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

function routineView(r) {
  const proc = procedures.find((p) => p.id === r.procedureId);
  return { ...r, procedureName: proc ? proc.name : '(usunięta procedura)' };
}

async function handleRoutines(req, res, pathname) {
  const url = new URL(req.url, 'http://localhost');
  if (pathname === '/api/routines' && req.method === 'GET') {
    return sendJson(res, 200, { routines: routines.map(routineView) });
  }
  if (pathname === '/api/routines/due' && req.method === 'GET') {
    return sendJson(res, 200, { due: routines.filter((r) => r.pending).map(routineView) });
  }
  if (pathname === '/api/routines' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    if (!procedures.find((p) => p.id === data.procedureId)) {
      return sendJson(res, 400, { error: 'Wskaż istniejącą procedurę.' });
    }
    const schedule = {
      type: ['daily', 'weekly', 'monthly', 'interval'].includes(data.type) ? data.type : 'daily',
      time: String(data.time || '09:00').slice(0, 5),
      day: Number(data.day) || 0,
      everyMinutes: Number(data.everyMinutes) || 60,
    };
    const item = {
      id: genId(), procedureId: data.procedureId, schedule,
      // "prepare": przygotuj i poproś o potwierdzenie (bezpieczne, domyślne).
      // "auto-read": tylko czynności do odczytu mogą iść same.
      mode: data.mode === 'auto-read' ? 'auto-read' : 'prepare',
      enabled: data.enabled !== false, pending: false,
      lastRun: null, nextRun: computeNextRun(schedule), createdAt: Date.now(),
    };
    routines.push(item);
    saveRoutines();
    return sendJson(res, 200, { ok: true, id: item.id, nextRun: item.nextRun });
  }
  if (pathname === '/api/routines' && req.method === 'PUT') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const r = routines.find((x) => x.id === data.id);
    if (!r) return sendJson(res, 404, { error: 'Nie znaleziono rutyny.' });
    if (typeof data.enabled === 'boolean') r.enabled = data.enabled;
    if (data.mode) r.mode = data.mode === 'auto-read' ? 'auto-read' : 'prepare';
    if (data.schedule || data.type) {
      const s = data.schedule || data;
      r.schedule = {
        type: ['daily', 'weekly', 'monthly', 'interval'].includes(s.type) ? s.type : r.schedule.type,
        time: String(s.time || r.schedule.time).slice(0, 5),
        day: Number(s.day) || 0,
        everyMinutes: Number(s.everyMinutes) || r.schedule.everyMinutes,
      };
      r.nextRun = computeNextRun(r.schedule);
    }
    if (data.pending === false) { r.pending = false; }
    saveRoutines();
    return sendJson(res, 200, { ok: true, nextRun: r.nextRun });
  }
  if (pathname === '/api/routines' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    routines = routines.filter((x) => x.id !== id);
    saveRoutines();
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405); res.end();
}

// Scheduler: co 30 s sprawdza rutyny. Gdy nadszedł czas — TYLKO oznacza je
// jako "pending" i zgłasza zdarzenie. Nic nieodwracalnego nie dzieje się samo;
// właściwe wykonanie (za zgodą) uruchamia użytkownik w interfejsie.
let schedulerTimer = null;
function tickRoutines() {
  const now = Date.now();
  let changed = false;
  for (const r of routines) {
    if (!r.enabled) continue;
    if (!r.nextRun) { r.nextRun = computeNextRun(r.schedule, now); changed = true; }
    if (now >= r.nextRun) {
      r.pending = true;
      r.lastRun = now;
      r.nextRun = computeNextRun(r.schedule, now);
      changed = true;
      const proc = procedures.find((p) => p.id === r.procedureId);
      addEvent('rutyna', `zaplanowana czynność do wykonania: ${proc ? proc.name : r.procedureId}`);
    }
  }
  if (changed) saveRoutines();
}
function startScheduler() {
  if (schedulerTimer) return;
  tickRoutines();
  schedulerTimer = setInterval(tickRoutines, 30 * 1000);
  if (schedulerTimer.unref) schedulerTimer.unref();
}

// --- Automatyzacja web (opcjonalny moduł Playwright) ---
// Tryb auto obejmuje: odczyt (open/wait/read/click) ORAZ logowanie z menedżera
// haseł (kroki oznaczone auth: type/click). NIGDY kroków wrażliwych ani
// zmieniających stan poza logowaniem (płatność, wysłanie, potwierdzenie).
const READONLY_ACTIONS = new Set(['open', 'wait', 'read', 'click']);
const AUTOMATION_RUNNER = path.join(__dirname, 'automation', 'runner.js');

function secretsEnabled() { return SECRETS.provider && SECRETS.provider !== 'none'; }

// Menedżer haseł — pobranie jednego sekretu po nazwie. Uruchamiane w procesie
// serwera (ma dostęp do sesji vaulta przez env), wartość leci do runnera przez
// stdin. Nigdy nie logujemy wartości ani nie zwracamy jej do klienta.
function resolveSecret(name) {
  return new Promise((resolve) => {
    const safe = String(name).replace(/[^\w.@:/-]/g, ''); // bez metaznaków powłoki
    if (!safe) return resolve(null);
    let cmd, args;
    switch (SECRETS.provider) {
      case 'env':
        return resolve(process.env['COSMOS_SECRET_' + safe.toUpperCase().replace(/[^A-Z0-9]/g, '_')] || null);
      case 'bitwarden': cmd = 'bw'; args = ['get', 'password', safe]; break;
      case 'onepassword': cmd = 'op'; args = ['read', safe]; break;
      case 'pass': cmd = 'pass'; args = ['show', safe]; break;
      case 'keepassxc':
        if (!SECRETS.keepassDb) return resolve(null);
        cmd = 'keepassxc-cli'; args = ['show', '-a', 'Password', '-q', SECRETS.keepassDb, safe]; break;
      case 'command': {
        if (!SECRETS.command) return resolve(null);
        const full = SECRETS.command.replaceAll('{name}', safe);
        cmd = '/bin/sh'; args = ['-c', full]; break;
      }
      default: return resolve(null);
    }
    let out = '';
    try {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } }, 15000);
      child.stdout.on('data', (d) => { out += d; });
      child.on('error', () => { clearTimeout(timer); resolve(null); });
      child.on('close', () => { clearTimeout(timer); resolve(out.split('\n')[0].trim() || null); });
    } catch { resolve(null); }
  });
}

// Podmiana wzorców {{secret:NAZWA}} w wartościach kroków na prawdziwe sekrety.
// Zwraca {steps, missing[]}. Wywoływane WYŁĄCZNIE po stronie serwera (auto).
async function materializeSecrets(steps) {
  const missing = [];
  const out = [];
  for (const s of steps) {
    let value = s.value || '';
    const refs = [...value.matchAll(/\{\{\s*secret:\s*([^}]+?)\s*\}\}/gi)];
    for (const m of refs) {
      const val = secretsEnabled() ? await resolveSecret(m[1]) : null;
      if (val == null) { missing.push(m[1]); }
      else value = value.replace(m[0], val);
    }
    out.push({ ...s, value });
  }
  return { steps: out, missing };
}

// Krok kwalifikuje się do trybu auto: odczyt zawsze; type/click tylko jako
// logowanie (auth); nigdy krok wrażliwy ani confirm.
function stepAutoEligible(s) {
  if (s.sensitive || s.action === 'confirm') return false;
  if (READONLY_ACTIONS.has(s.action)) return true;
  if (s.action === 'type' && s.auth) return true;
  return false;
}
function autoEligibility(proc) {
  if (!proc || !proc.steps.length) return { eligible: false, needsAuth: false };
  const eligible = proc.steps.every(stepAutoEligible);
  const needsAuth = proc.steps.some((s) => s.auth ||
    /\{\{\s*secret:/i.test(s.value || ''));
  return { eligible, needsAuth };
}

function runAutomation(name, steps, timeoutMs = 120000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, [AUTOMATION_RUNNER], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ ok: false, error: 'spawn-failed', reason: err.message });
    }
    let out = '', errOut = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errOut += d; });
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, error: 'spawn-failed', reason: err.message }); });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(out)); }
      catch { resolve({ ok: false, error: 'no-output', reason: (errOut || out).slice(0, 300) }); }
    });
    child.stdin.write(JSON.stringify({ name, steps }));
    child.stdin.end();
  });
}

async function handleAutomation(req, res, pathname) {
  if (pathname === '/api/automation/status' && req.method === 'GET') {
    let available = false;
    try { require.resolve('playwright'); available = true; } catch { /* brak */ }
    return sendJson(res, 200, {
      available, runner: fs.existsSync(AUTOMATION_RUNNER),
      secrets: secretsEnabled() ? SECRETS.provider : null,
    });
  }
  if (pathname === '/api/procedures/run-readonly' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const proc = procedures.find((p) => p.id === data.id);
    if (!proc) return sendJson(res, 404, { error: 'Nie znaleziono procedury.' });
    const { eligible, needsAuth } = autoEligibility(proc);
    if (!eligible) {
      return sendJson(res, 400, {
        error: 'not-readonly',
        message: 'Ta procedura zawiera kroki wrażliwe lub zmieniające stan poza logowaniem ' +
                 '(płatność, wysłanie, potwierdzenie). Uruchom ją ręcznym runnerem z potwierdzeniem.',
      });
    }
    // logowanie wymaga skonfigurowanego menedżera haseł
    if (needsAuth && !secretsEnabled()) {
      return sendJson(res, 400, {
        error: 'no-secrets',
        message: 'Ta procedura loguje się z menedżera haseł, ale żaden nie jest skonfigurowany. ' +
                 'Ustaw SECRETS_PROVIDER w .env (patrz automation/README.md).',
      });
    }
    // podmień {{secret:...}} na prawdziwe wartości tuż przed uruchomieniem
    const { steps, missing } = await materializeSecrets(proc.steps);
    if (missing.length) {
      return sendJson(res, 400, { error: 'secret-missing', message: `Nie znaleziono w menedżerze haseł: ${[...new Set(missing)].join(', ')}` });
    }
    const result = await runAutomation(proc.name, steps);
    if (result.ok) {
      const summary = result.results.map((r) => `${r.label}: ${r.value}`).join(' | ').slice(0, 400);
      addEvent('automatyzacja', `odczyt „${proc.name}": ${summary || '(brak wyników)'}`);
    }
    return sendJson(res, result.ok ? 200 : 502, result);
  }
  res.writeHead(405); res.end();
}


/* Uwaga: `lessons`, `procedures` i `routines` są PODMIENIANE przy usuwaniu
   (`lessons = lessons.filter(...)`). Gdyby wyszły stąd jako tablice, serwer
   dostałby kopię wiązania i po pierwszym skasowaniu procedury pokazywałby
   nieaktualny stan. Dlatego wychodzą jako funkcje odczytujące. */
module.exports = {
  handleAutomation, handleLessons, handleProcedures, handleRoutines,
  polacz, routineView, sanitizeStep, saveProcedures,
  secretsEnabled, startScheduler, dodajProcedure: (p) => procedures.push(p),
  wzorce: () => lessons, procedury: () => procedures, rutyny: () => routines,
};

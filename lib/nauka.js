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
const { SECRETS, genId, readJson, saveJsonFile, sendJson, czytajJson } = require('./rdzen.js');
const { odpowiedzBledemZapisu } = require('./miejsce.js');
const { stan, wKontekscie } = require('./kontekst.js');
const { wektorDla, ustawWektor, maWektor, kompaktujWektory } = require('./pamiec.js');   // czyste funkcje, bez cyklu

/* Wstrzykiwane przez server.js — te elementy należą do innych dziedzin.
   Zamiast krzyżowych `require` (i pułapki cyklicznych zależności) serwer
   podaje je raz, przy starcie. */
/* `kbPliki` i `kbUsun` to FUNKCJE, nie katalog i tablica. Tablica wstrzyknięta
   raz była kopią wiązania: `kbItems = kbItems.filter(...)` podmieniało tylko
   tutejszą kopię, a indeks bazy wiedzy serwera zostawał ze zdjęciem, którego
   już nie ma na dysku. Przy wielu osobach wartość wstrzyknięta przy starcie
   byłaby do tego bazą wiedzy pierwszej z nich. */
let kbPliki, kbUsun, addEvent, cosine, embedTexts, kbAddFile, keywordScore, sameModel, tsName;
function polacz(z) {
  ({ kbPliki, kbUsun, addEvent, cosine, embedTexts, kbAddFile, keywordScore, sameModel, tsName } = z);
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

/* Wzorce, procedury i rutyny KAŻDEJ OSOBY OSOBNO — w jej katalogu danych.
   Ładowane leniwie, przy pierwszym użyciu w kontekście tej osoby.
   Uszkodzony plik nie przepada po cichu: `czytajJson` odkłada jego kopię
   i próbuje `.bak` — patrz lib/rdzen.js. */
function N() {
  return stan('nauka', (katalog) => ({
    katalog,
    lessons: kompaktujWektory(czytajJson(path.join(katalog, 'lessons.json'), [])),
    procedures: czytajJson(path.join(katalog, 'procedures.json'), []),
    routines: czytajJson(path.join(katalog, 'routines.json'), []),
  }));
}

const saveLessons = () => saveJsonFile(path.join(N().katalog, 'lessons.json'), N().lessons);
const saveProcedures = () => saveJsonFile(path.join(N().katalog, 'procedures.json'), N().procedures);
const saveRoutines = () => saveJsonFile(path.join(N().katalog, 'routines.json'), N().routines);


function lessonDescriptor(l) {
  return [l.label, l.note, (l.objects || []).join(', ')].filter(Boolean).join('. ');
}

// --- 1) Rozpoznawanie ---
async function handleLessons(req, res, pathname) {
  if (pathname === '/api/lessons' && req.method === 'GET') {
    return sendJson(res, 200, {
      lessons: N().lessons.map((l) => ({
        id: l.id, label: l.label, kind: l.kind, note: l.note,
        objects: l.objects || [], thumbId: l.thumbId, createdAt: l.createdAt,
        hasEmbedding: maWektor(l),
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
      thumbId, createdAt: Date.now(),
    };
    const vecs = await embedTexts([lessonDescriptor(item)], 60000, 'passage');
    if (vecs) ustawWektor(item, vecs.model, vecs.vectors[0]);
    N().lessons.push(item);
    const blad = saveLessons();
    if (blad) {
      N().lessons = N().lessons.filter((x) => x !== item);
      return odpowiedzBledemZapisu(res, sendJson, blad);
    }
    addEvent('nauka', `nauczono rozpoznawać: ${label}`);
    return sendJson(res, 200, { ok: true, id: item.id, hasEmbedding: maWektor(item) });
  }
  if (pathname === '/api/lessons' && req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const l = N().lessons.find((x) => x.id === id);
    if (l?.thumbId) { try { fs.unlinkSync(path.join(kbPliki(), l.thumbId)); } catch { /* skip */ }
      kbUsun(l.thumbId); }
    N().lessons = N().lessons.filter((x) => x.id !== id);
    const blad = saveLessons();
    if (blad) return odpowiedzBledemZapisu(res, sendJson, blad);
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

const BUDZET_ROZPOZNAWANIA_MS = Number(process.env.MEMORY_SEARCH_BUDGET_MS || 1200);

let uzupelnianieWzorcow = false;
function uzupelnijWzorceWTle(qmodel) {
  if (uzupelnianieWzorcow) return;
  const brakujace = N().lessons.filter((l) => !sameModel(l, qmodel));
  if (!brakujace.length) return;
  uzupelnianieWzorcow = true;
  setTimeout(async () => {
    try {
      const embs = await embedTexts(brakujace.map(lessonDescriptor), 60000, 'passage');
      if (embs) {
        brakujace.forEach((l, i) => ustawWektor(l, embs.model, embs.vectors[i]));
        saveLessons();
      }
    } catch { /* następnym razem */ } finally { uzupelnianieWzorcow = false; }
  }, 0);
}

async function matchLessons(text, objects, limit = 4) {
  if (!N().lessons.length) return [];
  const queryText = [text, objects.join(', ')].filter(Boolean).join('. ');
  if (!queryText.trim()) return [];
  let qvec = null, qmodel = null;
  /* Ten sam budżet co przy pamięci i z tego samego powodu: dopasowanie leci
     z pętli detekcji kamery, kilka razy na sekundę. Czekanie 5 s na embedding
     zamrażało podgląd na żywo. Przeliczanie brakujących wektorów idzie w tle. */
  const q = await embedTexts([queryText], BUDZET_ROZPOZNAWANIA_MS, 'query');
  if (q) {
    qvec = q.vectors[0];
    qmodel = q.model;
    uzupelnijWzorceWTle(qmodel);
  }
  const objSet = new Set(objects.map((o) => String(o).toLowerCase()));
  const threshold = qvec ? 0.4 : 0.2;
  return N().lessons
    .map((l) => {
      let score = (qvec && sameModel(l, qmodel)) ? cosine(qvec, wektorDla(l, qmodel)) : keywordScore(queryText, lessonDescriptor(l));
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
    return sendJson(res, 200, { procedures: N().procedures.map((p) => ({ ...p, readOnly: autoEligibility(p).eligible, needsAuth: autoEligibility(p).needsAuth })) });
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
    N().procedures.push(item);
    const blad = saveProcedures();
    if (blad) {
      N().procedures = N().procedures.filter((x) => x !== item);
      return odpowiedzBledemZapisu(res, sendJson, blad);
    }
    addEvent('nauka', `nauczono procedury: ${name} (${steps.length} kroków)`);
    return sendJson(res, 200, { ok: true, id: item.id });
  }
  if (pathname === '/api/procedures' && req.method === 'PUT') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const p = N().procedures.find((x) => x.id === data.id);
    if (!p) return sendJson(res, 404, { error: 'Nie znaleziono procedury.' });
    if (data.name != null) p.name = String(data.name).trim().slice(0, 120) || p.name;
    if (data.description != null) p.description = String(data.description).slice(0, 600);
    if (Array.isArray(data.steps)) p.steps = data.steps.slice(0, 60).map(sanitizeStep);
    p.updatedAt = Date.now();
    const blad = saveProcedures();
    if (blad) return odpowiedzBledemZapisu(res, sendJson, blad);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === '/api/procedures' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    N().procedures = N().procedures.filter((x) => x.id !== id);
    N().routines = N().routines.filter((r) => r.procedureId !== id);
    const blad = saveRoutines() || saveProcedures();
    if (blad) return odpowiedzBledemZapisu(res, sendJson, blad);
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
  const proc = N().procedures.find((p) => p.id === r.procedureId);
  return { ...r, procedureName: proc ? proc.name : '(usunięta procedura)' };
}

async function handleRoutines(req, res, pathname) {
  const url = new URL(req.url, 'http://localhost');
  if (pathname === '/api/routines' && req.method === 'GET') {
    return sendJson(res, 200, { routines: N().routines.map(routineView) });
  }
  if (pathname === '/api/routines/due' && req.method === 'GET') {
    return sendJson(res, 200, { due: N().routines.filter((r) => r.pending).map(routineView) });
  }
  if (pathname === '/api/routines' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    if (!N().procedures.find((p) => p.id === data.procedureId)) {
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
    N().routines.push(item);
    const blad = saveRoutines();
    if (blad) {
      N().routines = N().routines.filter((x) => x !== item);
      return odpowiedzBledemZapisu(res, sendJson, blad);
    }
    return sendJson(res, 200, { ok: true, id: item.id, nextRun: item.nextRun });
  }
  if (pathname === '/api/routines' && req.method === 'PUT') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const r = N().routines.find((x) => x.id === data.id);
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
    const blad = saveRoutines();
    if (blad) return odpowiedzBledemZapisu(res, sendJson, blad);
    return sendJson(res, 200, { ok: true, nextRun: r.nextRun });
  }
  if (pathname === '/api/routines' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    N().routines = N().routines.filter((x) => x.id !== id);
    const blad = saveRoutines();
    if (blad) return odpowiedzBledemZapisu(res, sendJson, blad);
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
  for (const r of N().routines) {
    if (!r.enabled) continue;
    if (!r.nextRun) { r.nextRun = computeNextRun(r.schedule, now); changed = true; }
    if (now >= r.nextRun) {
      r.pending = true;
      r.lastRun = now;
      r.nextRun = computeNextRun(r.schedule, now);
      changed = true;
      const proc = N().procedures.find((p) => p.id === r.procedureId);
      addEvent('rutyna', `zaplanowana czynność do wykonania: ${proc ? proc.name : r.procedureId}`);
    }
  }
  if (changed) saveRoutines();
}
/* Timer nie należy do żadnego żądania, więc nie ma użytkownika. Obchodzimy
   KAŻDEGO po kolei, jawnie w jego imieniu — rutyny i zdarzenie „czas na
   czynność" trafiają tylko do osoby, która tę rutynę założyła. */
function tickWszystkich() {
  const konta = require('./konta.js');
  for (const u of konta.wszyscy()) {
    try { wKontekscie(u, tickRoutines); }
    catch (err) { console.error(`Rutyny (${u.login}):`, err.message); }
  }
}
function startScheduler() {
  if (schedulerTimer) return;
  tickWszystkich();
  schedulerTimer = setInterval(tickWszystkich, 30 * 1000);
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
    const proc = N().procedures.find((p) => p.id === data.id);
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


/* Wzorce, procedury i rutyny wychodzą jako FUNKCJE: każde wywołanie czyta
   stan bieżącej osoby. Tablica wyeksportowana raz byłaby zamrożoną listą
   pierwszej osoby — i do tego nieaktualną po pierwszym usunięciu. */
module.exports = {
  handleAutomation, handleLessons, handleProcedures, handleRoutines,
  polacz, routineView, sanitizeStep, saveProcedures,
  secretsEnabled, startScheduler, dodajProcedure: (p) => N().procedures.push(p),
  wzorce: () => N().lessons, procedury: () => N().procedures, rutyny: () => N().routines,
};

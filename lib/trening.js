/* ============================================================
   Trening — eksport danych do dotrenowania własnego modelu (QLoRA/LoRA)

   Buduje zbiór JSONL z rozmów: czyste tury użytkownik↔asystent, bez akcji,
   wyszukiwań i tekstów systemowych. Uruchamia też skrypt treningowy
   i pilnuje jego postępu.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { DATA_DIR } = require('./rdzen.js');

/* Wstrzykiwane przez server.js — te elementy należą do innych dziedzin.
   Zamiast krzyżowych `require` (i pułapki cyklicznych zależności) serwer
   podaje je raz, przy starcie. */
let addEvent, convIndex, convPath, userProfile;
function polacz(z) {
  ({ addEvent, convIndex, convPath, userProfile } = z);
}

// ---------------------------------------------------------------------------
// TRENING — eksport danych do fine-tuningu (QLoRA/LoRA).
// Buduje zbiór JSONL z rozmów: czyste tury user↔assistant (bez akcji, wyszukiwań,
// błędów i obrazów). Dwa formaty: "chat" (messages[]) i "instruction".
// To NIE trenuje modelu — przygotowuje dane, które wytrenujesz w training/ .
// ---------------------------------------------------------------------------
function convTextTurns(conv) {
  const turns = [];
  for (const m of (conv.messages || [])) {
    if (m.role !== 'user' && m.role !== 'assistant') continue; // pomiń action/search
    if (m.search || m.error) continue;
    const text = typeof m.content === 'string' ? m.content : (m.content && m.content.text) || '';
    const t = String(text).trim();
    if (!t) continue; // pomiń tury bez tekstu (np. sam obraz)
    turns.push({ role: m.role, content: t });
  }
  return turns;
}

function buildTrainingDataset(format) {
  const sys = userProfile.trim();
  const out = [];
  for (const meta of convIndex) {
    let conv;
    try { conv = JSON.parse(fs.readFileSync(convPath(meta.id), 'utf8')); } catch { continue; }
    const turns = convTextTurns(conv);
    if (turns.length < 2) continue;

    if (format === 'instruction') {
      // pary: każda tura użytkownika + następna odpowiedź asystenta
      for (let i = 0; i < turns.length - 1; i++) {
        if (turns[i].role === 'user' && turns[i + 1].role === 'assistant') {
          out.push({ instruction: turns[i].content, input: '', output: turns[i + 1].content });
        }
      }
    } else { // chat
      if (!turns.some((t) => t.role === 'assistant')) continue;
      const messages = sys ? [{ role: 'system', content: sys }] : [];
      out.push({ messages: messages.concat(turns) });
    }
  }
  return { lines: out.map((o) => JSON.stringify(o)).join('\n') + (out.length ? '\n' : ''), count: out.length };
}

// --- „Dotrenuj" — uruchomienie treningu QLoRA lokalnie (opcjonalne) ---
const TRAIN_DIR = path.join(DATA_DIR, 'train');
const TRAIN_SCRIPT = path.join(__dirname, 'training', 'qlora_example.py');
let trainJob = null; // { status, startedAt, endedAt, log:[], model, ollamaName, exitCode, child }
const TRAIN_LOG_MAX = 400;

function commandExists(cmd) {
  return new Promise((resolve) => {
    try {
      const c = spawn(cmd, ['--version'], { stdio: 'ignore' });
      const timer = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* */ } resolve(false); }, 4000);
      c.on('error', () => { clearTimeout(timer); resolve(false); });
      c.on('close', (code) => { clearTimeout(timer); resolve(code === 0 || code === null ? true : true); });
    } catch { resolve(false); }
  });
}

function trainLog(line) {
  if (!trainJob) return;
  for (const l of String(line).split('\n')) {
    const s = l.replace(/\s+$/, '');
    if (s) trainJob.log.push(s);
  }
  if (trainJob.log.length > TRAIN_LOG_MAX) trainJob.log = trainJob.log.slice(-TRAIN_LOG_MAX);
}

function trainStatusView() {
  if (!trainJob) return { running: false, status: 'idle', log: [] };
  return {
    running: trainJob.status === 'running',
    status: trainJob.status,
    startedAt: trainJob.startedAt,
    endedAt: trainJob.endedAt || null,
    model: trainJob.model,
    ollamaName: trainJob.ollamaName,
    exitCode: trainJob.exitCode,
    log: trainJob.log.slice(-60),
  };
}

async function startTraining(opts) {
  const { lines, count } = buildTrainingDataset('chat');
  if (count < 1) return { ok: false, error: 'no-data', message: 'Brak danych do treningu — porozmawiaj najpierw z Cosmosem.' };
  if (!fs.existsSync(TRAIN_SCRIPT)) return { ok: false, error: 'no-script' };
  if (!(await commandExists('python3'))) {
    return { ok: false, error: 'no-python', message: 'Brak python3. Zainstaluj Pythona i zależności z training/README.md.' };
  }
  fs.mkdirSync(TRAIN_DIR, { recursive: true });
  const dataPath = path.join(TRAIN_DIR, 'dataset.jsonl');
  fs.writeFileSync(dataPath, lines);

  const model = String(opts.model || 'unsloth/Qwen2.5-7B-Instruct-bnb-4bit').replace(/[^\w./:-]/g, '');
  const ollamaName = String(opts.ollamaName || 'cosmos-ft').replace(/[^a-z0-9._-]/gi, '');
  const args = [TRAIN_SCRIPT, '--data', dataPath, '--model', model, '--out', path.join(TRAIN_DIR, 'lora'), '--gguf'];

  trainJob = { status: 'running', startedAt: Date.now(), endedAt: null, log: [], model, ollamaName, exitCode: null, child: null };
  trainLog(`▶ Start treningu: model=${model}, przykłady=${count}`);
  addEvent('trening', `rozpoczęto dotrenowywanie modelu (${count} przykładów)`);

  let child;
  try {
    child = spawn('python3', args, { cwd: path.join(__dirname, 'training'), stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    trainJob.status = 'error'; trainJob.endedAt = Date.now(); trainLog('✗ ' + err.message);
    return { ok: false, error: 'spawn-failed', message: err.message };
  }
  trainJob.child = child;
  child.stdout.on('data', (d) => trainLog(d));
  child.stderr.on('data', (d) => trainLog(d));
  child.on('close', async (code) => {
    trainJob.exitCode = code;
    if (code === 0) {
      trainLog('✓ Trening zakończony.');
      // rejestracja w Ollamie (jeśli dostępna)
      const ggufModelfile = path.join(__dirname, 'training', 'cosmos-model-gguf', 'Modelfile');
      if (fs.existsSync(ggufModelfile) && await commandExists('ollama')) {
        trainLog(`▶ Rejestruję model w Ollamie jako „${ollamaName}"…`);
        try {
          const oc = spawn('ollama', ['create', ollamaName, '-f', ggufModelfile], { stdio: ['ignore', 'pipe', 'pipe'] });
          oc.stdout.on('data', (d) => trainLog(d));
          oc.stderr.on('data', (d) => trainLog(d));
          oc.on('close', (oco) => {
            if (oco === 0) { trainLog(`✓ Gotowe. Ustaw LOCAL_MODEL=${ollamaName} w .env i przełącz na profil „Lokalnie".`); addEvent('trening', `model „${ollamaName}" gotowy w Ollamie`); }
            else trainLog(`✗ ollama create zwróciło kod ${oco}.`);
            trainJob.status = 'done'; trainJob.endedAt = Date.now();
          });
        } catch (err) { trainLog('✗ ' + err.message); trainJob.status = 'done'; trainJob.endedAt = Date.now(); }
      } else {
        trainLog('ℹ Ollama niedostępna lub brak GGUF — model LoRA zapisany w data/train/lora.');
        trainJob.status = 'done'; trainJob.endedAt = Date.now();
        addEvent('trening', 'trening zakończony (adapter LoRA zapisany)');
      }
    } else {
      trainLog(`✗ Trening zakończony błędem (kod ${code}). Sprawdź zależności: training/README.md.`);
      trainJob.status = 'error'; trainJob.endedAt = Date.now();
    }
  });
  return { ok: true, startedAt: trainJob.startedAt };
}

module.exports = { TRAIN_DIR, TRAIN_SCRIPT, buildTrainingDataset, commandExists, polacz, startTraining, trainJob, trainLog, trainStatusView };

/* Wybór modelu OpenAI i Claude w Ustawieniach.

   Zgłoszenie Marcina: „W ustawieniach nie ma możliwości zmiany modelu OpenAI
   oraz zmiany modelu Claude". Pola były tylko dwa (NVIDIA, lokalny), więc na
   silnikach komercyjnych zostawał na zawsze model z .env.

   Sprawdzamy gwarancję, nie wygląd:
     1. Pole modelu jest dla każdego silnika, którego osoba może użyć
        (tu: NVIDIA, OpenAI i Claude z kluczem serwera).
     2. „Pobierz listę" na OpenAI i Claude pokazuje modele od tego dostawcy.
     3. Model wybrany w Ustawieniach NAPRAWDĘ idzie w żądaniu czatu na tym
        silniku – i tylko na nim (NVIDIA dalej dostaje swój).
     4. Wybór przeżywa przeładowanie strony.
*/
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { przegladarka, maPrzegladarke, czekajNa } = require('../pomoc');

const poczekaj = async (warunek, ms) => {
  for (const koniec = Date.now() + ms; Date.now() < koniec;) {
    if (await warunek()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

const KORZEN = path.resolve(__dirname, '..', '..');
const PORT = 3484;
const ATRAPA = 7121;

// Jedna atrapa za obu dostawców: /openai/v1/models i /claude/v1/models.
const LISTY = {
  openai: ['gpt-4o', 'gpt-5-mini', 'gpt-5.2'],
  claude: ['claude-sonnet-5', 'claude-haiku-4-5', 'claude-opus-5-5'],
};
const atrapa = http.createServer((req, res) => {
  const m = req.url.match(/^\/(openai|claude)\/v1\/models/);
  if (m) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: LISTY[m[1]].map((id) => ({ id, type: 'model' })) }));
  }
  res.writeHead(404); res.end('{}');
});

(async () => {
  const fail = [];
  await new Promise((r) => atrapa.listen(ATRAPA, r));
  const srv = spawn('node', ['server.js'], {
    cwd: KORZEN, stdio: 'ignore', detached: true,
    env: {
      ...process.env, PORT: String(PORT), COSMOS_DATA_DIR: path.join(require('node:os').tmpdir(), `cosmos-mkwu-${Date.now()}`),
      NVIDIA_API_KEY: 'test', NEMOTRON_BASE_URL: `http://127.0.0.1:${ATRAPA}/nv/v1`,
      OPENAI_API_KEY: 'test', OPENAI_BASE_URL: `http://127.0.0.1:${ATRAPA}/openai/v1`,
      ANTHROPIC_API_KEY: 'test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${ATRAPA}/claude/v1`,
      LOCAL_BASE_URL: '', LOCAL_MODEL: '',
    },
  });
  const adres = `http://127.0.0.1:${PORT}`;
  await czekajNa(`${adres}/api/config`);

  const b = await przegladarka();
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push(e.message));
  // Czat przechwytujemy w przeglądarce: interesuje nas, JAKI model wysyła
  // aplikacja. To, że serwer honoruje `model` z żądania, pilnują inne zestawy.
  const wyslane = [];
  await pg.route('**/api/chat', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    wyslane.push({ endpoint: body.endpoint, model: body.model });
    await route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n' });
  });
  await pg.goto(`${adres}/app`, { waitUntil: 'load' });
  await pg.waitForFunction(() => document.querySelectorAll('.endpoint-switch button').length >= 3);

  const otworzUstawienia = async () => {
    await pg.evaluate(() => document.getElementById('settings-btn').click());
    await pg.waitForSelector('#settings-modal', { state: 'visible' });
    await pg.waitForTimeout(400);
  };

  /* ---- 1. Pola dla silników z kluczem, bez pola dla lokalnego ---- */
  await otworzUstawienia();
  await pg.click('[data-cel="silniki"]');
  await pg.waitForTimeout(300);
  const pola = await pg.evaluate(() => Object.fromEntries(['cloud', 'local', 'openai', 'claude'].map((ep) => {
    const pole = document.getElementById(`set-model-${ep}`);
    return [ep, Boolean(pole && pole.getClientRects().length)];
  })));
  console.log(`1. pola modelu widoczne: ${JSON.stringify(pola)}`);
  if (!pola.openai) fail.push('brak pola modelu OpenAI, choć klucz jest ustawiony');
  if (!pola.claude) fail.push('brak pola modelu Claude, choć klucz jest ustawiony');
  if (!pola.cloud) fail.push('zniknęło pole modelu NVIDIA');

  /* ---- 2. „Pobierz listę" pokazuje modele dostawcy ---- */
  for (const ep of ['openai', 'claude']) {
    await pg.click(`#fetch-models-${ep}`);
    await pg.waitForFunction((e) => document.getElementById(`model-select-${e}`).options.length > 1
      || document.querySelector(`#model-info-${e} .model-info-err`), ep, { timeout: 10000 }).catch(() => {});
    const opcje = await pg.evaluate((e) => [...document.getElementById(`model-select-${e}`).options]
      .map((o) => o.value).filter(Boolean), ep);
    console.log(`2. ${ep}: lista ${JSON.stringify(opcje)}`);
    for (const id of LISTY[ep]) if (!opcje.includes(id)) fail.push(`${ep}: na liście brak ${id}`);
  }

  /* ---- 3. Wybór trafia do żądania czatu na swoim silniku ---- */
  await pg.selectOption('#model-select-openai', 'gpt-5-mini');
  await pg.selectOption('#model-select-claude', 'claude-haiku-4-5');
  const wPolach = await pg.evaluate(() => [document.getElementById('set-model-openai').value,
    document.getElementById('set-model-claude').value]);
  console.log(`3. w polach po wyborze: ${JSON.stringify(wPolach)}`);
  if (wPolach[0] !== 'gpt-5-mini' || wPolach[1] !== 'claude-haiku-4-5') fail.push('wybór z listy nie trafia do pola');
  await pg.click('#settings-save');
  await pg.waitForTimeout(300);

  const zapytaj = async (ep, tekst) => {
    await pg.evaluate((e) => setEndpoint(e), ep);
    await pg.evaluate(() => newConversation());
    await pg.fill('#input', tekst);
    await pg.press('#input', 'Enter');
    await poczekaj(() => wyslane.some((w) => w.endpoint === ep), 8000);
    await pg.waitForFunction(() => document.getElementById('stop-btn').style.display === 'none',
      null, { timeout: 8000 }).catch(() => {});
    return wyslane.filter((w) => w.endpoint === ep).pop();
  };
  const o = await zapytaj('openai', 'pytanie do OpenAI');
  const c = await zapytaj('claude', 'pytanie do Claude');
  const n = await zapytaj('cloud', 'pytanie do NVIDII');
  console.log(`   wysłane: openai→${o && o.model}, claude→${c && c.model}, cloud→${n && n.model}`);
  if (!o || o.model !== 'gpt-5-mini') fail.push(`OpenAI dostał ${o && o.model} zamiast modelu z Ustawień`);
  if (!c || c.model !== 'claude-haiku-4-5') fail.push(`Claude dostał ${c && c.model} zamiast modelu z Ustawień`);
  if (n && n.model && /gpt|claude/.test(n.model)) fail.push(`model OpenAI/Claude wyciekł na NVIDIĘ (${n.model})`);

  /* ---- 4. Wybór przeżywa przeładowanie ---- */
  await pg.reload({ waitUntil: 'load' });
  await pg.waitForFunction(() => typeof settings !== 'undefined');
  const poPrzeladowaniu = await pg.evaluate(() => [settings.modelOpenai, settings.modelClaude]);
  console.log(`4. po przeładowaniu: ${JSON.stringify(poPrzeladowaniu)}`);
  if (poPrzeladowaniu[0] !== 'gpt-5-mini' || poPrzeladowaniu[1] !== 'claude-haiku-4-5') {
    fail.push('wybór modelu OpenAI/Claude nie przeżywa przeładowania');
  }

  console.log(`5. błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  if (bledy.length) fail.push(`błędy JS: ${bledy.join(' | ')}`);

  await b.close();
  try { process.kill(-srv.pid); } catch { /* już nie żyje */ }
  atrapa.close();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nMODELE KOMERCYJNE W USTAWIENIACH OK');
  process.exit(fail.length ? 1 : 0);
})();

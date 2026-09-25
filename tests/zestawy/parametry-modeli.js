/* Parametry żądania dopasowane do dostawcy modelu (lib/model.js, zapytajModel).
 *
 * Prawdziwe API odmawia po JEDNYM parametrze naraz. Stara poprawka robiła
 * jedną ponowną próbę, więc gpt-5 (odmowa `max_tokens`, potem `temperature`)
 * nie odpowiadał nigdy. Atrapa zachowuje się jak prawdziwy dostawca:
 *   1. gpt-5 dostaje od razu max_completion_tokens i żadnej temperatury,
 *   2. model odmawiający kolejno dwóch parametrów — i tak odpowiada,
 *   3. drugie pytanie do tego samego modelu idzie od razu poprawne (bez odmowy),
 *   4. 429 z Retry-After → ponowienie i odpowiedź,
 *   5. 400 z innego powodu → oddane wołającemu bez pętli,
 *   6. llmComplete nie oddaje toku myślenia jako odpowiedzi. */
const http = require('node:http');

const problemy = [];
const ok = (w, opis) => { console.log(`${w ? 'OK ' : 'ZLE'} ${opis}`); if (!w) problemy.push(opis); };

const zadania = [];
let limit429 = 0;
const atrapa = http.createServer((req, res) => {
  let c = '';
  req.on('data', (k) => { c += k; });
  req.on('end', () => {
    const b = JSON.parse(c || '{}');
    zadania.push(b);
    const odmow = (msg) => { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: msg } })); };
    if (b.model === 'wybredny') {
      if (b.max_tokens !== undefined) return odmow("Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead.");
      if (b.temperature !== undefined) return odmow("Unsupported value: 'temperature' does not support 0.7 with this model.");
    }
    if (b.model === 'zly') return odmow('The model `zly` does not exist.');
    if (b.model === 'tloczno' && limit429-- > 0) { res.writeHead(429, { 'Retry-After': '0' }); return res.end('{}'); }
    if (b.model === 'mysli') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: '', reasoning_content: 'We need to think in English.' }, finish_reason: 'length' }] }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: `odp ${b.model}` }, finish_reason: 'stop' }] }));
  });
});

(async () => {
  await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
  const baza = `http://127.0.0.1:${atrapa.address().port}/v1`;
  process.env.NEMOTRON_BASE_URL = baza;
  process.env.NVIDIA_API_KEY = 'test';
  const { zapytajModel, llmComplete } = require('../../lib/model.js');
  const ep = { baseUrl: baza, apiKey: 'k', label: 'test' };
  const cialo = (model) => ({ model, messages: [{ role: 'user', content: 'hej' }], temperature: 0.7, top_p: 0.9, max_tokens: 100 });

  zadania.length = 0;
  let r = await zapytajModel(ep, cialo('gpt-5'));
  ok(r.status === 200 && zadania.length === 1, `gpt-5: jedno żądanie (${zadania.length})`);
  ok(zadania[0].max_completion_tokens >= 100 && zadania[0].max_tokens === undefined && zadania[0].temperature === undefined,
    'gpt-5: max_completion_tokens, bez max_tokens i temperatury');
  ok(zadania[0].max_completion_tokens >= 16000, `gpt-5: sufit odpowiedzi mieści myślenie (${zadania[0].max_completion_tokens})`);
  zadania.length = 0;
  await zapytajModel(ep, cialo('nemotron-zwykly'));
  ok(zadania[0].max_tokens === 100, `zwykły model: limit bez zmian (${zadania[0].max_tokens})`);

  zadania.length = 0;
  r = await zapytajModel(ep, cialo('wybredny'));
  ok(r.status === 200, `model odmawiający dwóch parametrów po kolei — odpowiada (${r.status}, żądań ${zadania.length})`);
  zadania.length = 0;
  r = await zapytajModel(ep, cialo('wybredny'));
  ok(r.status === 200 && zadania.length === 1, `drugie pytanie od razu poprawne (${zadania.length} żądanie)`);

  limit429 = 1; zadania.length = 0;
  r = await zapytajModel(ep, cialo('tloczno'));
  ok(r.status === 200 && zadania.length === 2, `429 z Retry-After → ponowienie (${r.status}, ${zadania.length})`);

  zadania.length = 0;
  r = await zapytajModel(ep, cialo('zly'));
  ok(r.status === 400 && zadania.length === 1, `inna odmowa 400 — bez pętli (${zadania.length})`);

  let blad = null;
  try { await llmComplete([{ role: 'user', content: 'x' }], { model: 'mysli' }); } catch (e) { blad = e; }
  ok(blad && !/think in English/.test(blad.message), 'llmComplete nie oddaje toku myślenia jako odpowiedzi');

  atrapa.close();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nPARAMETRY MODELI OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

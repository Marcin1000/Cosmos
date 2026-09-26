/* Parametry żądania dopasowane do dostawcy modelu (lib/model.js, zapytajModel).
 *
 * Prawdziwe API odmawia po JEDNYM parametrze naraz. Stara poprawka robiła
 * jedną ponowną próbę, więc gpt-5 (odmowa `max_tokens`, potem `temperature`)
 * nie odpowiadał nigdy. Atrapa zachowuje się jak prawdziwy dostawca:
 *   1. gpt-5 dostaje od razu max_completion_tokens i żadnej temperatury,
 *   2. model odmawiający kolejno dwóch parametrów – i tak odpowiada,
 *   3. drugie pytanie do tego samego modelu idzie od razu poprawne (bez odmowy),
 *   4. 429 z Retry-After → ponowienie i odpowiedź,
 *   5. 400 z innego powodu → oddane wołającemu bez pętli,
 *   6. llmComplete nie oddaje toku myślenia jako odpowiedzi,
 *   7. Claude dostaje od razu to, co przyjmuje: bez top_p/top_k, a rodzina 5
 *      i Opus 4.7/4.8 – bez temperatury (dokumentacja Anthropic; treści tej
 *      odmowy nie da się przewidzieć, więc zgadywanie „z odmowy" nie wystarczy),
 *   8. sufit 16 000 tylko dla modeli myślących – Haiku 4.5 dostaje to, co ustawiono,
 *   9. gpt-6 to model rozumujący; API OpenAI zawsze max_completion_tokens,
 *  10. Claude: `chat/completions` z samym Bearer, natywne /models z x-api-key,
 *  11. podpowiedź czyta TREŚĆ odmowy: brak środków, za długi kontekst, przeciążenie,
 *      a „ollama pull" tylko dla Ollamy,
 *  12. `<think>` w treści odpowiedzi pomocniczej nie trafia do człowieka,
 *  14. za duży limit odpowiedzi (gpt-4o: najwyżej 16 384) → jedna próba z limitem
 *      z odmowy, a następne pytanie od razu dobre,
 *  13. llmComplete ma JEDEN termin na całość, z ponowieniem po `length`
 *      włącznie – dawniej ponowienie liczyło od nowa i streszczenie modelem
 *      rozumującym kończyło się za Cloudflare stroną 524 po 100 s. */
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
    const limitOdp = b.max_completion_tokens ?? b.max_tokens;
    if (b.model === 'limit16k' && limitOdp > 16384) {
      return odmow(`max_tokens is too large: ${limitOdp}. This model supports at most 16384 completion tokens, whereas you provided ${limitOdp}.`);
    }
    if (b.model === 'mysli-w-tresci') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { content: '<think>The user asks in Polish, let me think.</think>\n\nKrótkie streszczenie.' }, finish_reason: 'stop' }] }));
    }
    if (b.model === 'tloczno' && limit429-- > 0) { res.writeHead(429, { 'Retry-After': '0' }); return res.end('{}'); }
    // Model rozumujący, który myśli długo (tu 700 ms) i nie zdąży z odpowiedzią.
    if (b.model === 'mysli-wolno') {
      return setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '', reasoning_content: 'Hmm…' }, finish_reason: 'length' }] }));
      }, 700);
    }
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
  ok(r.status === 200, `model odmawiający dwóch parametrów po kolei – odpowiada (${r.status}, żądań ${zadania.length})`);
  zadania.length = 0;
  r = await zapytajModel(ep, cialo('wybredny'));
  ok(r.status === 200 && zadania.length === 1, `drugie pytanie od razu poprawne (${zadania.length} żądanie)`);

  limit429 = 1; zadania.length = 0;
  r = await zapytajModel(ep, cialo('tloczno'));
  ok(r.status === 200 && zadania.length === 2, `429 z Retry-After → ponowienie (${r.status}, ${zadania.length})`);

  zadania.length = 0;
  r = await zapytajModel(ep, cialo('zly'));
  ok(r.status === 400 && zadania.length === 1, `inna odmowa 400 – bez pętli (${zadania.length})`);

  let blad = null;
  try { await llmComplete([{ role: 'user', content: 'x' }], { model: 'mysli' }); } catch (e) { blad = e; }
  ok(blad && !/think in English/.test(blad.message), 'llmComplete nie oddaje toku myślenia jako odpowiedzi');

  // --- 7–9. Parametry pod dostawcę bez straconego żądania
  const { parametryDla } = require('../../lib/model.js');
  const claudeEp = { baseUrl: 'https://api.anthropic.com/v1', anthropic: true, apiKey: 'k' };
  const zClaude = (model) => parametryDla(claudeEp, { model, temperature: 0.6, top_p: 0.95, top_k: 40, max_tokens: 2048 });
  for (const m of ['claude-sonnet-5', 'claude-opus-5-5', 'claude-opus-4-8', 'claude-fable-5-1']) {
    const b = zClaude(m);
    ok(b.temperature === undefined && b.top_p === undefined && b.top_k === undefined, `${m}: bez samplingu (${JSON.stringify(b)})`);
  }
  const haiku = zClaude('claude-haiku-4-5-20251001');
  ok(haiku.temperature === 0.6 && haiku.top_p === undefined, `Haiku 4.5: temperatura zostaje, top_p nie (razem → 400)`);
  ok(haiku.max_tokens === 2048, `Haiku 4.5 nie myśli sam – limit bez podwyższenia (${haiku.max_tokens})`);
  ok(zClaude('claude-sonnet-5').max_tokens >= 16000, 'Sonnet 5 myśli sam – sufit mieści myślenie');
  const gpt6 = parametryDla({ baseUrl: 'https://api.openai.com/v1' }, { model: 'gpt-6-luna', temperature: 0.6, top_p: 0.9, max_tokens: 700 });
  ok(gpt6.max_completion_tokens >= 16000 && gpt6.max_tokens === undefined && gpt6.temperature === undefined,
    `gpt-6: rozumujący od pierwszego żądania (${JSON.stringify(gpt6)})`);
  const gpt4o = parametryDla({ baseUrl: 'https://api.openai.com/v1' }, { model: 'gpt-4o-mini', temperature: 0.6, max_tokens: 700 });
  ok(gpt4o.max_completion_tokens === 700 && gpt4o.temperature === 0.6, 'API OpenAI: max_completion_tokens także dla gpt-4o');
  const vllm = parametryDla({ baseUrl: 'http://100.64.0.7:8000/v1' }, { model: 'gpt-4o-mini', max_tokens: 700 });
  ok(vllm.max_tokens === 700, 'inny serwer zgodny z OpenAI: max_tokens bez zmian');

  // --- 10. Nagłówki Claude'a
  const { authHeaders, modelErrorHint } = require('../../lib/rdzen.js');
  const czat = authHeaders(claudeEp);
  const natywne = authHeaders(claudeEp, { natywne: true });
  ok(czat.Authorization === 'Bearer k' && !czat['x-api-key'], 'Claude, chat/completions: sam Bearer (jak SDK OpenAI)');
  ok(natywne['x-api-key'] === 'k' && natywne['anthropic-version'] && !natywne.Authorization, 'Claude, natywne /models: x-api-key + anthropic-version');

  // --- 11. Podpowiedzi z treści odmowy
  const quota = modelErrorHint('openai', 'gpt-4o', 429, { tresc: 'You exceeded your current quota, please check your plan and billing details.' });
  ok(/środki/.test(quota) && !/za chwilę/.test(quota), 'brak środków: „doładuj", nie „spróbuj za chwilę"');
  ok(/za długa/.test(modelErrorHint('cloud', 'm', 400, { tresc: "This model's maximum context length is 4096 tokens." })), 'za długi kontekst: rada, co zrobić');
  ok(/przeciążony/.test(modelErrorHint('claude', 'm', 529)), '529: dostawca przeciążony');
  ok(/ollama pull/.test(modelErrorHint('local', 'qwen3:8b', 404, { baseUrl: 'http://100.64.0.7:11434/v1' })), '404 w Ollamie: ollama pull');
  const vllm404 = modelErrorHint('local', 'Qwen/Qwen3-8B', 404, { baseUrl: 'http://100.64.0.7:8000/v1', tresc: 'The model `x` does not exist.' });
  ok(!/ollama pull/.test(vllm404) && /served-model-name/.test(vllm404), '404 w vLLM: bez fałszywego tropu „ollama pull"');

  // --- 12. <think> w odpowiedzi pomocniczej
  const streszczenie = await llmComplete([{ role: 'user', content: 'x' }], { model: 'mysli-w-tresci' });
  ok(streszczenie === 'Krótkie streszczenie.', `streszczenie bez <think> (${JSON.stringify(streszczenie)})`);

  // --- 14. Za duży limit odpowiedzi
  zadania.length = 0;
  r = await zapytajModel(ep, { ...cialo('limit16k'), max_tokens: 32000 });
  ok(r.status === 200 && zadania.length === 2 && (zadania[1].max_tokens ?? zadania[1].max_completion_tokens) === 16384,
    `limit 32 000 dla modelu z sufitem 16 384 → ponowienie z limitem z odmowy (${r.status}, ${zadania.length} żądania)`);
  zadania.length = 0;
  r = await zapytajModel(ep, { ...cialo('limit16k'), max_tokens: 32000 });
  ok(r.status === 200 && zadania.length === 1, `następne pytanie od razu z dobrym limitem (${zadania.length} żądanie)`);

  // --- 13. Jeden termin na całe llmComplete (tu 1 s zamiast 88 s)
  zadania.length = 0;
  let t0 = Date.now();
  let bladTerminu = null;
  try { await llmComplete([{ role: 'user', content: 'x' }], { model: 'mysli-wolno', terminMs: 1000 }); } catch (e) { bladTerminu = e; }
  const czas = Date.now() - t0;
  ok(zadania.length === 1 && czas < 1300 && /budżet tokenów/.test(bladTerminu?.message || ''),
    `za mało czasu na ponowienie – od razu czytelny błąd, bez drugiego żądania (${zadania.length} żądanie, ${czas} ms)`);
  zadania.length = 0;
  t0 = Date.now();
  bladTerminu = null;
  try { await llmComplete([{ role: 'user', content: 'x' }], { model: 'mysli-wolno', terminMs: 400 }); } catch (e) { bladTerminu = e; }
  ok(Date.now() - t0 < 700 && /nie odpowiedział w wyznaczonym czasie/.test(bladTerminu?.message || ''),
    `termin mija w trakcie – ludzki komunikat zamiast „operation was aborted" (${Date.now() - t0} ms)`);

  atrapa.close();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nPARAMETRY MODELI OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

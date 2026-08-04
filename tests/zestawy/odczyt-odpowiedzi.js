// parseModelResponse: strumień mimo stream:false, sklejone obiekty, śmieci
const src = require('fs').readFileSync('/home/user/Bear/server.js', 'utf8');
const fn = src.match(/\/\*\* Odczytaj odpowiedź modelu[\s\S]*?\nasync function parseModelResponse[\s\S]*?\n}\n/)[0];
const parseModelResponse = eval(`(() => { ${fn}\n return parseModelResponse; })()`);
const res = (body, status = 200) => ({ status, text: async () => body });

const fail = [];
const cases = [
  ['czysty JSON', JSON.stringify({ choices: [{ message: { content: 'Zwykła odpowiedź.' } }] }), 'Zwykła odpowiedź.'],
  ['strumień mimo stream:false',
    'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Prompt ' } }] }) + '\n\n'
    + 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'sklejony.' }, finish_reason: 'stop' }] }) + '\n\n'
    + 'data: [DONE]\n\n', 'Prompt sklejony.'],
  ['sklejone obiekty JSON',
    '{"warmup":true}' + JSON.stringify({ choices: [{ message: { content: 'Drugi obiekt.' } }] }), 'Drugi obiekt.'],
  ['strumień z samym myśleniem',
    'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'Myślę i myślę.' } }] }) + '\n\ndata: [DONE]\n\n',
    { reasoning: 'Myślę i myślę.' }],
];

(async () => {
  for (const [name, body, want] of cases) {
    try {
      const d = await parseModelResponse(res(body));
      const m = d.choices?.[0]?.message || {};
      const got = typeof want === 'string' ? m.content : { reasoning: (m.reasoning_content || '').trim() };
      const ok = JSON.stringify(got) === JSON.stringify(want);
      console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(28)} → ${JSON.stringify(got)}`);
      if (!ok) fail.push(name);
    } catch (e) {
      console.log(`  ✗ ${name.padEnd(28)} WYJĄTEK: ${e.message.slice(0, 60)}`);
      fail.push(name);
    }
  }

  // nieczytelna odpowiedź: błąd MUSI pokazać, co przyszło
  for (const [name, body, status] of [
    ['HTML od proxy', '<html><body>502 Bad Gateway</body></html>', 502],
    ['pusta odpowiedź', '', 200],
    ['śmieci z liczbą', '1234abcdef', 200],
  ]) {
    try {
      await parseModelResponse(res(body, status));
      console.log(`  ✗ ${name.padEnd(28)} nie rzucił błędu`); fail.push(name);
    } catch (e) {
      const shows = body ? e.message.includes(body.trim().slice(0, 20)) : e.message.includes('pusto');
      const hasStatus = e.message.includes(String(status));
      console.log(`  ${shows && hasStatus ? '✓' : '✗'} ${name.padEnd(28)} → ${e.message.slice(0, 78)}`);
      if (!shows || !hasStatus) fail.push(name + ' (błąd nie pokazuje treści/statusu)');
      if (/Unexpected non-whitespace|is not valid JSON/.test(e.message)) {
        fail.push(name + ' — surowy błąd parsera nadal wycieka');
      }
    }
  }
  console.log(fail.length ? '\nBŁĘDY: ' + fail.join('; ') : '\nODCZYT ODPOWIEDZI MODELU OK');
  process.exit(fail.length ? 1 : 0);
})();

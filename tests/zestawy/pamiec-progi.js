/* Przywołanie pamięci, gdy wpisy mają wektory z INNEGO modelu niż zapytanie.
 *
 * Tak jest po każdej zmianie dostawcy embeddingów (zmysły padły, „auto"
 * przeszło na chmurę). Wpis dostaje wtedy wynik ze słów kluczowych, a ten
 * był mierzony progiem wektorowym 0,35 — „jaki mam aparat" dawało 0,29
 * i pamięć milczała. Próg ma zależeć od tego, jak policzono wynik. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const problemy = [];
const ok = (w, opis) => { console.log(`${w ? 'OK ' : 'ZLE'} ${opis}`); if (!w) problemy.push(opis); };

const zmysly = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; }).on('end', () => {
    const n = (JSON.parse(b || '{}').texts || ['x']).length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ vectors: Array.from({ length: n }, () => [0.3, 0.1, 0.9]), model: 'nowy-model' }));
  });
});

(async () => {
  await new Promise((r) => zmysly.listen(0, '127.0.0.1', r));
  process.env.EMBED_PROVIDER = 'senses';
  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-progi-'));
  fs.writeFileSync(path.join(kat, 'memory.json'), JSON.stringify([
    { id: 'a', text: 'Fotografuje Canonem EOS R6 Mark II, ma aparat od 2023 roku.', embedding: [1, 0, 0], embModel: 'stary-model', time: 1 },
    { id: 'b', text: 'Lubię kawę bez cukru.', embedding: [0, 1, 0], embModel: 'stary-model', time: 2 },
  ]));
  const { utworz } = require('../../lib/pamiec.js');
  const p = utworz({ katalogDanych: kat, sensesUrl: `http://127.0.0.1:${zmysly.address().port}`, chmura: {}, sendJson: () => {}, readJson: async () => ({}) });
  const wynik = await p.searchMemory('jaki mam aparat');
  ok(wynik.some((m) => m.id === 'a'), `wpis z innym modelem wektorów przywołany słowami kluczowymi (${wynik.map((m) => m.id).join(',') || 'nic'})`);
  ok(!wynik.some((m) => m.id === 'b'), 'niepasujący wpis dalej pominięty');
  zmysly.close();
  fs.rmSync(kat, { recursive: true, force: true });
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nPROGI PAMIĘCI OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

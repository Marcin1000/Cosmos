/* Nagranie w bazie wiedzy przepisuje się RAZ – i w kolejce.

   Zespół IT (runda 9): pierwsze zajrzenie osoby do bazy wiedzy po starcie
   serwera (GET /api/kb, przywołanie w czacie) uznawało nagranie, które ten sam
   proces właśnie przepisywał, za przerwane restartem i zlecało drugą
   transkrypcję – podwójnie płatne OpenAI. Sześć nagrań naraz liczyło się
   równolegle (791 MB RSS, 429 od OpenAI). Plik bez typu MIME (octet-stream)
   nie szedł do chmury wcale, a odmowa dostawcy zostawiała pozycję bez słowa.

   Prawdziwy serwer (tryb domowy, bez zmysłów), OpenAI udaje atrapa, która
   liczy zlecenia i ile ich jest naraz:
     1. wgranie nagrania + od razu GET /api/kb → dokładnie 1 zlecenie,
     2. plik .m4a wysłany jako application/octet-stream → idzie do chmury,
        model whisper-1, bez podpowiedzi „Hej, Cosmos.”,
     3. pięć nagrań naraz → nigdy więcej niż 2 zlecenia jednocześnie, każde z tekstem,
     4. odmowa dostawcy (nagranie za długie) → przyczyna w pozycji,
     5. pozycja przerwana restartem dalej wznawia się – raz. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { serwerCosmosa, czekajNa, zabij, katalogOsoby } = require('../pomoc');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

const PORT = 3547;
const PORT_OA = 7478;
const ADRES = `http://127.0.0.1:${PORT}`;

const zlecenia = [];
let naraz = 0;
let maksNaraz = 0;
const atrapa = http.createServer((req, res) => {
  const cialo = [];
  req.on('data', (c) => cialo.push(c));
  req.on('end', () => {
    if (req.url !== '/v1/audio/transcriptions') { res.writeHead(404); return res.end('{}'); }
    const tresc = Buffer.concat(cialo).toString('latin1');
    zlecenia.push(tresc);
    naraz++; maksNaraz = Math.max(maksNaraz, naraz);
    setTimeout(() => {
      naraz--;
      if (/NAGRANIE-DLUGIE/.test(tresc)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'audio duration 2803.2 seconds is longer than 1500 seconds which is the maximum for this model', code: 'invalid_value' } }));
      }
      const znak = (tresc.match(/NAGRANIE-([a-z0-9]+)/) || [])[1] || '?';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: `Tekst nagrania ${znak}.` }));
    }, 800);
  });
});

const wyslij = (nazwa, tresc, typ = 'audio/mpeg') => fetch(`${ADRES}/api/kb/file`, {
  method: 'POST', headers: { 'Content-Type': typ, 'X-Cosmos-Nazwa': encodeURIComponent(nazwa) },
  body: Buffer.from(`ID3 NAGRANIE-${tresc} `.repeat(50)),
}).then((r) => r.json());
const lista = async () => (await (await fetch(`${ADRES}/api/kb`)).json()).items || [];
const czekajNaTekst = async (ids, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const it = (await lista()).filter((x) => ids.includes(x.id));
    if (it.length === ids.length && it.every((x) => !x.przetwarzanie)) return it;
    await new Promise((r) => setTimeout(r, 200));
  }
  return (await lista()).filter((x) => ids.includes(x.id));
};

(async () => {
  await new Promise((r) => atrapa.listen(PORT_OA, '127.0.0.1', r));
  const env = {
    SENSES_URL: 'http://127.0.0.1:1', OPENAI_API_KEY: 'test-oa', OPENAI_BASE_URL: `http://127.0.0.1:${PORT_OA}/v1`,
  };
  let srv = serwerCosmosa(PORT, env);
  try {
    if (!(await czekajNa(`${ADRES}/api/auth`))) throw new Error('serwer nie wstał');

    /* ---- 1. raz, choć lista zajrzała w trakcie ---- */
    const a = await wyslij('a.mp3', 'a');
    await lista();
    const [ia] = await czekajNaTekst([a.item.id]);
    ok(zlecenia.length === 1, `1. jedno nagranie + GET /api/kb w trakcie → zleceń transkrypcji: ${zlecenia.length}`);
    ok(ia && ia.textChars > 0, `1. pozycja ma tekst (${ia && ia.preview})`);

    /* ---- 2. typ z rozszerzenia, whisper-1, bez podpowiedzi ---- */
    zlecenia.length = 0;
    const b = await wyslij('memo.m4a', 'b', 'application/octet-stream');
    const [ib] = await czekajNaTekst([b.item.id]);
    ok(zlecenia.length === 1 && ib && ib.textChars > 0, `2. .m4a bez typu MIME idzie do chmury (${zlecenia.length} zlec., tekst ${ib && ib.textChars} zn.)`);
    ok(zlecenia[0] && /name="model"\r\n\r\nwhisper-1/.test(zlecenia[0]), '2. nagranie z bazy wiedzy → whisper-1');
    ok(zlecenia[0] && !/name="prompt"/.test(zlecenia[0]), '2. bez podpowiedzi „Hej, Cosmos.”');

    /* ---- 3. kolejka: najwyżej 2 naraz ---- */
    zlecenia.length = 0; maksNaraz = 0;
    const piec = await Promise.all(['c1', 'c2', 'c3', 'c4', 'c5'].map((z) => wyslij(`${z}.mp3`, z)));
    const gotowe = await czekajNaTekst(piec.map((p) => p.item.id), 20000);
    ok(maksNaraz <= 2 && zlecenia.length === 5, `3. pięć nagrań naraz → zleceń ${zlecenia.length}, najwięcej jednocześnie ${maksNaraz}`);
    ok(gotowe.length === 5 && gotowe.every((x) => x.textChars > 0), '3. każde nagranie z kolejki ma tekst');

    /* ---- 4. przyczyna porażki w pozycji ---- */
    const d = await wyslij('wyklad.mp3', 'DLUGIE');
    const [id] = await czekajNaTekst([d.item.id]);
    ok(id && id.textChars === 0 && /za długie/.test(id.bladPrzepisania || ''), `4. odmowa „za długie” zapisana w pozycji („${id && id.bladPrzepisania}”)`);

    /* ---- 5. przerwane restartem – wznawia się raz ---- */
    zabij(srv);
    await new Promise((r) => setTimeout(r, 800));
    const dane = srv.katalogDanych;
    const indeks = path.join(katalogOsoby(dane), 'kb', 'index.json');
    const pozycje = JSON.parse(fs.readFileSync(indeks, 'utf8'));
    const pa = pozycje.find((x) => x.id === a.item.id);
    pa.przetwarzanie = 'transkrypcja'; pa.text = ''; pa.chunks = [];
    fs.writeFileSync(indeks, JSON.stringify(pozycje));
    zlecenia.length = 0;
    srv = serwerCosmosa(PORT, { ...env, COSMOS_DATA_DIR: dane });
    if (!(await czekajNa(`${ADRES}/api/auth`))) throw new Error('serwer nie wstał po restarcie');
    await lista(); await lista();
    const [po] = await czekajNaTekst([a.item.id]);
    ok(zlecenia.length === 1 && po && po.textChars > 0, `5. po restarcie przerwana pozycja przepisana raz (${zlecenia.length} zlec.)`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    zabij(srv);
    atrapa.close();
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nTRANSKRYPCJA RAZ OK');
  process.exit(fail.length ? 1 : 0);
})();

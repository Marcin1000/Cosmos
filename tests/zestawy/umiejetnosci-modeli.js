const { przegladarka, maPrzegladarke, KORZEN, uruchom, zabij, czekajNa } = require('../pomoc');
/* Wiedza o modelach: katalog, sonda wzroku, zapis wyników „Sprawdź”,
   capabilities Claude'a i dobór modelu do roli zespołu (etap 1 agentów).

   Gwarancje:
   A. katalog – poziom mini/nano z nazwy PRZED fragmentem (gpt-5.5-mini to
      mini, nie flagowiec), cecha „kod”, nowe modele lokalne, seria o z wizją,
      pole `myslenie` tylko z uzgodnionych wartości, VRAM wg rozmiaru;
   B. umiejetnosci() – kolejność pewności sonda > dostawca > katalog > nazwa;
   C. dobierzModel() – rola „oko” tylko z widzącym, automat nie bierze na
      płatnym silniku modelu droższego niż prowadzący, głos woli szybkie;
      runda 10: remis cech wygrywa darmowy silnik (nie „inny model”), zapora
      porównuje cenę, wariant „tylko darmowe” (zalecenia na rolę, recenzent
      z innej rodziny, wizja z pamięci ostrożniej), Ultra „wolny” (C10–C13);
      katalog: Super 120B bez „polski”, modele build.nvidia.com z pewne:false,
      sposób myślenia nieznany (A15–A17);
   D. sonda wzroku = obrazek 8×8 i pytanie o kolor: model, który obraz
      zignorował i odpowiedział „Hello”, NIE widzi (dawniej 1×1 = „widzi”);
   E. wynik „Sprawdź” zapisany w data/konta/modele-sprawdzone.json – bez
      adresów, kluczy i treści błędów, przeżywa restart, wraca w /api/models;
      zimny start i limit zapytań niczego nie nadpisują;
   F. capabilities z natywnego /v1/models Claude'a zapisane i znormalizowane;
   G. przeglądarka: znaczki po odświeżeniu z zapisu, po „Sprawdź wszystkie”
      na silniku lokalnym – rozgrzanie modelu z zakładki (/api/generate). */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const M = require(path.join(KORZEN, 'public/models.js'));
const U = require(path.join(KORZEN, 'lib/umiejetnosci.js'));
const { czytajJson, zapiszAtomowo } = require(path.join(KORZEN, 'lib/rdzen.js'));

const PORT = 3524;
const KLUCZ = 'klucz-tajny-sonda-1234567890';
const fail = [];
const ok = (warunek, opis) => { console.log(`${warunek ? '✓' : '✗'} ${opis}`); if (!warunek) fail.push(opis); };

// ------------------------------------------------------------------ A. katalog
{
  const i = (id, s) => M.modelInfo(id, s) || { cechy: [] };
  ok(i('gpt-5.5-mini').poziom === 'mini' && i('gpt-5.5-mini').nazwa === 'GPT-5 mini',
    `A1. gpt-5.5-mini → ${i('gpt-5.5-mini').nazwa} / ${i('gpt-5.5-mini').poziom}`);
  ok(i('gpt-5.4-nano').poziom === 'nano' && i('openai/gpt-5.4-nano-2026-03-01').poziom === 'nano',
    `A2. gpt-5.4-nano → ${i('gpt-5.4-nano').poziom}`);
  ok(i('gpt-5-mini').cechy.includes('rozumowanie') && i('gpt-5-nano').cechy.includes('rozumowanie')
    && !i('gpt-4o-mini').cechy.includes('rozumowanie'), 'A3. gpt-5-mini/nano rozumują, gpt-4o-mini nie');
  ok(['o3', 'o4-mini', 'o1'].every((m) => i(m).cechy.includes('wizja'))
    && ['o3-mini', 'o1-mini'].every((m) => !i(m).cechy.includes('wizja')), 'A4. o3/o4-mini/o1 widzą, o3-mini/o1-mini nie');
  ok(i('o4-mini').poziom === 'mini' && i('o3').poziom === 'flagowy', `A4b. poziom o4-mini ${i('o4-mini').poziom}, o3 ${i('o3').poziom}`);
  ok(i('qwen2.5-coder:7b').cechy.includes('kod') && M.modelInfo('ktos/super-coder-9').cechy.includes('kod')
    && M.modelInfo('ktos/super-coder-9').zgadywane, 'A5. cecha kod: qwen2.5-coder z katalogu, „coder” z nazwy jako domysł');
  ok(M.CECHA_OPIS.kod && M.CECHA_OPIS.kod.pl && M.CECHA_OPIS.kod.en, 'A6. CECHA_OPIS.kod po polsku i angielsku');
  const wszystkieCechy = new Set(M.MODEL_CATALOG.flatMap((e) => e.cechy));
  ok([...wszystkieCechy].every((c) => M.CECHA_OPIS[c]), `A7. każda cecha z katalogu ma opis (${[...wszystkieCechy].join(', ')})`);
  const nowe = { 'qwen3:8b': 'Qwen3 (8B–32B)', 'qwen3:14b': 'Qwen3 (8B–32B)', 'qwen2.5-coder:14b': 'Qwen2.5 Coder',
    'mistral-nemo': 'Mistral Nemo 12B', 'phi4': 'Phi-4 14B', 'deepseek-r1:8b': 'DeepSeek R1', 'gemma3:12b': 'Gemma 3' };
  const zle = Object.entries(nowe).filter(([id, n]) => i(id).nazwa !== n || i(id).zgadywane);
  ok(!zle.length, `A8. nowe wpisy lokalne rozpoznane${zle.length ? ': ' + zle.map(([id]) => `${id}→${i(id).nazwa}`).join(', ') : ''}`);
  ok(i('deepseek-r1:8b').myslenie === 'zawsze', 'A9. deepseek-r1 myśli zawsze');
  ok(i('gemma3:12b').cechy.includes('wizja') && i('gemma3:12b').cechy.includes('polski')
    && i('gemma3:1b').nazwa === 'Mały model lokalny (do 4B)', 'A10. gemma3 osobno: widzi i pisze po polsku; gemma3:1b to mały model');
  const obce = M.MODEL_CATALOG.filter((e) => e.myslenie && !M.MYSLENIE.includes(e.myslenie));
  ok(!obce.length && M.MODEL_CATALOG.some((e) => e.myslenie), 'A11. pole myslenie tylko z uzgodnionych wartości');
  ok(i('nvidia/llama-3.3-nemotron-super-49b-v1.5').myslenie === 'no_think'
    && i('nvidia/llama-3.3-nemotron-super-49b-v1').myslenie === 'detailed', 'A12. Super 49B v1.5 /no_think, v1 detailed thinking');
  ok(i('qwen3:14b').vramGb === 10 && i('qwen2.5-coder:7b').vramGb === 5 && i('mistral-nemo').vramGb === 8
    && i('qwen3:30b-a3b').vramGb === 19 && i('qwen2.5-coder').vramGb === null, `A13. VRAM wg rozmiaru (qwen3:14b → ${i('qwen3:14b').vramGb} GB)`);
  const zlePoziomy = M.MODEL_CATALOG.filter((e) => e.poziom && !M.POZIOMY.includes(e.poziom));
  ok(!zlePoziomy.length, 'A14. poziomy tylko z POZIOMY');
  // Runda 10 (paczka Z): Super 120B bez „polski” (błędy odmiany w transkrypcji), z „kod”; modele build.nvidia.com z pamięci.
  const s120 = i('nvidia/nemotron-3-super-120b-a12b');
  ok(!s120.cechy.includes('polski') && s120.cechy.includes('kod') && /polszczyzna nierówna/i.test(s120.uwaga || ''),
    `A15. Super 120B: bez „polski”, z „kod”, uwaga o polszczyźnie (${s120.cechy.join(', ')})`);
  const nowe10 = { 'qwen/qwen3-coder-480b-a35b-instruct': 'Qwen3 Coder 480B', 'qwen/qwen3-235b-a22b': 'Qwen3 235B', 'deepseek-ai/deepseek-v3.2': 'DeepSeek V3',
    'z-ai/glm-4.7': 'GLM-4', 'moonshotai/kimi-k2.5': 'Kimi K2.5', 'moonshotai/kimi-k2-instruct': 'Kimi K2', 'meta/llama-4-maverick-17b-128e-instruct': 'Llama 4' };
  const zle10 = Object.entries(nowe10).filter(([id, n]) => i(id).nazwa !== n || i(id).pewne !== false);
  ok(!zle10.length && i('glm4:9b').nazwa !== 'GLM-4', `A16. modele build.nvidia.com w katalogu z pewne:false (lokalny glm4:9b to nie ten wpis)${zle10.length ? ': ' + zle10.map(([id]) => `${id}→${i(id).nazwa}`).join(', ') : ''}`);
  const u10 = (id) => U.umiejetnosci(id, 'cloud');
  ok(u10('deepseek-ai/deepseek-v3.2').myslenieNieznane && u10('moonshotai/kimi-k2.5').myslenieNieznane && u10('nieznany/model-xyz').myslenieNieznane
    && !u10('qwen/qwen3-coder-480b-a35b-instruct').myslenieNieznane && !u10('nvidia/nemotron-3-super-120b-a12b').myslenieNieznane
    && u10('moonshotai/kimi-k2.5').pewnosc.wizja === 'pamiec' && u10('nvidia/nemotron-nano-12b-v2-vl').pewnosc.wizja === 'katalog',
    'A17. sposób myślenia nieznany (wpis z pamięci bez `myslenie`, model spoza katalogu), „nigdy” i znany – znane; wizja z pamięci oznaczona');
}

// ------------------------------------------------------------------ B. umiejetnosci
{
  const u1 = U.umiejetnosci('openai/gpt-oss-20b', 'cloud', { sprawdzenie: { rozmowa: true, obrazy: 'pewne' } });
  ok(u1.wizja === true && u1.pewnosc.wizja === 'sonda', 'B1. sonda „pewne” wygrywa z katalogiem (model tekstowy)');
  const u2 = U.umiejetnosci('claude-sonnet-5', 'claude', { dostawca: { wizja: false, okno: 200000 } });
  ok(u2.wizja === false && u2.pewnosc.wizja === 'dostawca' && u2.okno === 200000, 'B2. capabilities dostawcy wygrywają z katalogiem');
  const u3 = U.umiejetnosci('claude-sonnet-5', 'claude', { sprawdzenie: { rozmowa: true, obrazy: 'nie' }, dostawca: { wizja: true } });
  ok(u3.wizja === false && u3.pewnosc.wizja === 'sonda', 'B3. sonda „nie” wygrywa z dostawcą');
  const u4 = U.umiejetnosci('claude-sonnet-5', 'claude', { sprawdzenie: { rozmowa: true, obrazy: 'prawdopodobnie' }, dostawca: { wizja: false } });
  ok(u4.wizja === false, 'B4. „prawdopodobnie” z sondy przegrywa z pewnym „nie” dostawcy');
  const u5 = U.umiejetnosci('nieznany/model-vision-x', 'cloud');
  ok(u5.wizja === true && u5.pewnosc.wizja === 'nazwa', 'B5. bez niczego – domysł z nazwy, oznaczony jako nazwa');
  const u6 = U.umiejetnosci('meta/zablokowany', 'cloud', { sprawdzenie: { rozmowa: false, obrazy: 'nie' } });
  ok(u6.rozmowa === false && u6.pewnosc.rozmowa === 'sonda', 'B6. sonda „nie działa” = rozmowa false');
  const u7 = U.umiejetnosci('gpt-5.5-mini', 'openai');
  ok(u7.poziom === 'mini' && u7.myslenie === 'reasoning_effort' && u7.kod === true, 'B7. poziom, myślenie i kod z katalogu');
}

// ------------------------------------------------------------------ C. dobierzModel
{
  const k = (id, silnik, x = {}) => ({ id, silnik, ...x });
  const lista = [k('nvidia/llama-3.3-nemotron-super-49b-v1.5', 'cloud'), k('nvidia/nemotron-nano-12b-v2-vl', 'cloud'),
    k('qwen2.5-coder:7b', 'cloud')];
  ok(U.dobierzModel('oko', lista)?.id === 'nvidia/nemotron-nano-12b-v2-vl', 'C1. oko → model widzący');
  ok(U.dobierzModel('oko', [lista[0], lista[2]]) === null, 'C2. oko bez widzącego → null (nie ślepy model)');
  ok(U.dobierzModel('oko', [k('openai/gpt-oss-20b', 'cloud', { sprawdzenie: { rozmowa: true, obrazy: 'nie' } })]) === null,
    'C3. oko: sonda „nie widzi” wyklucza');
  ok(U.dobierzModel('programista', [lista[1], lista[2]])?.id === 'qwen2.5-coder:7b', 'C4. programista woli model z cechą kod');
  const prow = { id: 'gpt-5-mini', silnik: 'openai' };
  ok(U.dobierzModel('analityk', [k('gpt-5', 'openai'), k('gpt-5-nano', 'openai')], { prowadzacy: prow })?.id === 'gpt-5-nano',
    'C5. płatny silnik: automat nie bierze modelu droższego niż prowadzący');
  ok(U.dobierzModel('analityk', [k('gpt-5', 'openai')], { prowadzacy: prow }) === null, 'C5b. sam droższy kandydat → null');
  const lok = { id: 'qwen3:8b', silnik: 'local' };
  ok(U.dobierzModel('programista', [k('qwen3:8b', 'local'), k('qwen2.5-coder:7b', 'local')], { prowadzacy: lok })?.id === 'qwen3:8b',
    'C6. lokalnie woli model prowadzącego (bez przeładowania VRAM)');
  ok(U.dobierzModel('badacz', [k('deepseek-r1:8b', 'cloud'), k('nvidia/nvidia-nemotron-nano-9b-v2', 'cloud')], { glosowy: true })?.id
    === 'nvidia/nvidia-nemotron-nano-9b-v2', 'C7. tryb głosowy: szybki zamiast zawsze myślącego');
  ok(U.dobierzModel('nieznana-rola', lista) === null && U.dobierzModel('oko', []) === null, 'C8. nieznana rola i pusta pula → null');
  ok(Object.keys(U.ROLE).sort().join() === 'analityk,badacz,fotograf,oko,programista,recenzent,sprzetowiec', 'C9. katalog ról (MVP + fotograf)');

  // Runda 10 (paczka Z): skład „Darmowe modele”.
  const super120 = { id: 'nvidia/nemotron-3-super-120b-a12b', silnik: 'cloud' };
  /* C10: remis cech – wygrywa DARMOWY silnik, nie „inny model niż prowadzący”
     (zrzut 3 Marcina: Sonnet za 0,26 zł przy darmowym Nemotronie). Płatny
     pierwszy na liście, żeby dawny remis rozstrzygała kolejność. */
  const remis = [k('claude-sonnet-5', 'claude'), k('nvidia/llama-3.3-nemotron-super-49b-v1.5', 'cloud')];
  ok(U.dobierzModel('analityk', remis, { prowadzacy: super120 })?.id === 'nvidia/llama-3.3-nemotron-super-49b-v1.5'
    && U.ocenKandydata('analityk', remis[1], { prowadzacy: super120 }) - U.ocenKandydata('analityk', remis[0], { prowadzacy: super120 }) === 1,
    'C10. remis cech: darmowy silnik +1, płatny wygrywa tylko przewagą cech');
  ok(U.dobierzModel('badacz', [k('gpt-4o', 'openai'), super120], { prowadzacy: super120 })?.id === 'gpt-4o',
    'C10b. płatny z przewagą cech (polszczyzna) dalej wygrywa w składzie proponowanym');
  // C11: zapora ceny przy płatnym prowadzącym – ten sam poziom („pelny”), ale droższy model odpada.
  const cena = (id) => ({ 'gpt-4o': 2.5 + 4 * 10, 'claude-sonnet-5': 3 + 4 * 15, 'claude-haiku-4-5': 1 + 4 * 5 })[id] ?? null;
  const prow4o = { id: 'gpt-4o', silnik: 'openai' };
  ok(U.ocenKandydata('analityk', k('claude-sonnet-5', 'claude'), { prowadzacy: prow4o, cena }) === null
    && U.ocenKandydata('analityk', k('claude-sonnet-5', 'claude'), { prowadzacy: prow4o }) !== null
    && U.ocenKandydata('analityk', k('claude-haiku-4-5', 'claude'), { prowadzacy: prow4o, cena }) !== null,
    'C11. zapora porównuje cenę: Sonnet droższy od gpt-4o odpada, tańszy Haiku przechodzi');
  // C12: wariant darmowy – płatny odpada, zalecenia na rolę, recenzent z innej rodziny, wizja z pamięci ostrożniej.
  const pulaD = ['nvidia/nemotron-3-super-120b-a12b', 'nvidia/llama-3.3-nemotron-super-49b-v1.5', 'deepseek-ai/deepseek-v3.2', 'qwen/qwen3-235b-a22b',
    'moonshotai/kimi-k2.5', 'nvidia/nemotron-nano-12b-v2-vl', 'openai/gpt-oss-120b'].map((id) => k(id, 'cloud'));
  const oD = { prowadzacy: super120, tylkoDarmowe: true };
  ok(U.ocenKandydata('analityk', k('claude-sonnet-5', 'claude'), oD) === null
    && U.dobierzModel('analityk', [k('claude-sonnet-5', 'claude'), ...pulaD], oD)?.id === 'nvidia/llama-3.3-nemotron-super-49b-v1.5'
    && U.dobierzModel('recenzent', pulaD, { ...oD, rodzinyNotatek: ['nemotron'] })?.id === 'deepseek-ai/deepseek-v3.2'
    && U.dobierzModel('oko', pulaD, oD)?.id === 'nvidia/nemotron-nano-12b-v2-vl',
    'C12. „tylko darmowe”: płatny odpada, analityk → Super 49B v1.5, recenzent spoza Nemotrona, oko → zmierzony 12B VL przed Kimi z pamięci');
  ok(U.ocenKandydata('recenzent', pulaD[2], { ...oD, rodzinyNotatek: ['nemotron'] }) - U.ocenKandydata('recenzent', pulaD[2], oD) === 2
    && U.rodzinaModelu('nvidia/llama-3.3-nemotron-super-49b-v1.5') === 'nemotron' && U.rodzinaModelu('openai/gpt-oss-120b') === 'openai'
    && U.rodzinaModelu('gpt-4o') === 'openai' && U.rodzinaModelu('claude-sonnet-5') === 'claude' && U.rodzinaModelu('qwen3:8b') === 'qwen',
    'C12b. rodzina modelu (Llama-Nemotron to Nemotron, gpt-oss to OpenAI) i premia za inną rodzinę niż autorzy notatek');
  // C13: Ultra ma te same cechy analityka co Super 49B, ale jest „wolny” – pierwszy na liście i tak przegrywa.
  ok(U.umiejetnosci('nvidia/nemotron-3-ultra-550b', 'cloud').wolny === true
    && U.dobierzModel('analityk', [k('nvidia/nemotron-3-ultra-550b', 'cloud'), k('nvidia/llama-3.3-nemotron-super-49b-v1.5', 'cloud')])?.id
      === 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    'C13. Ultra „wolny” – przegrywa z szybszym modelem o tych samych cechach');
}

// ------------------------------------------------------------------ D. obrazek sondy i ocena
function wymiaryPng(dataUrl) {
  const b = Buffer.from(String(dataUrl).split(',')[1] || '', 'base64');
  if (b.slice(1, 4).toString() !== 'PNG') return null;
  const w = b.readUInt32BE(16); const h = b.readUInt32BE(20);
  const idat = []; let off = 8;
  while (off < b.length) {
    const dl = b.readUInt32BE(off); const typ = b.slice(off + 4, off + 8).toString();
    if (typ === 'IDAT') idat.push(b.slice(off + 8, off + 8 + dl));
    off += 12 + dl;
  }
  let piksele = null;
  try { piksele = zlib.inflateSync(Buffer.concat(idat)); } catch { /* nie PNG RGB */ }
  return { w, h, piksele };
}
{
  const p = wymiaryPng(U.PNG_SONDY_WZROKU);
  const czerwony = p && p.piksele && p.piksele.length === p.h * (1 + 3 * p.w)
    && [...Array(p.h * p.w).keys()].every((n) => {
      const wiersz = Math.floor(n / p.w); const x = n % p.w; const o = wiersz * (1 + 3 * p.w) + 1 + 3 * x;
      return p.piksele[o] > 180 && p.piksele[o + 1] < 80 && p.piksele[o + 2] < 80;
    });
  ok(p && p.w === 8 && p.h === 8 && czerwony, `D1. obrazek sondy ${p ? `${p.w}×${p.h}` : '?'} jednolicie czerwony`);
  ok(U.ocenSondeWzroku({ ok: true, tekst: 'Red.' }, 'cokolwiek') === 'pewne', 'D2. „Red” → pewne');
  ok(U.ocenSondeWzroku({ ok: true, tekst: 'Hello! How can I help?' }, 'openai/gpt-oss-20b') === 'nie', 'D3. model tekstowy bez koloru → nie');
  ok(U.ocenSondeWzroku({ ok: true, tekst: '' }, 'nvidia/nemotron-nano-12b-v2-vl') === 'prawdopodobnie', 'D4. pusta odpowiedź widzącego → prawdopodobnie');
  ok(U.ocenSondeWzroku({ ok: false }, 'nvidia/nemotron-nano-12b-v2-vl') === 'nie', 'D5. odmowa obrazu → nie');
}

// ------------------------------------------------------------------ normalizacja Claude'a i rejestr
{
  const n = U.normalizujClaude({ id: 'claude-x', max_input_tokens: 1000000, max_tokens: 128000,
    capabilities: { image_input: { supported: true }, thinking: { supported: true, types: { adaptive: { supported: true } } },
      effort: { supported: false } } });
  ok(n && n.okno === 1000000 && n.maxWyjscie === 128000 && n.wizja === true && n.myslenie === true && n.wysilek === false,
    'F1. normalizujClaude: okno, limit wyjścia, wzrok, myślenie');
  ok(U.normalizujClaude({ id: 'gpt-4o' }) === null && U.normalizujClaude(null) === null, 'F2. brak capabilities → null, nie fałszywe „nie”');

  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-umiej-'));
  const plik = path.join(kat, 'konta', 'modele-sprawdzone.json');
  let czas = 1_000_000;
  const r = U.utworzRejestrModeli({ plik, czytajJson, zapiszAtomowo, teraz: () => czas });
  const blad = r.zapiszSprawdzenie({ silnik: 'cloud', model: 'm1', rozmowa: true, obrazy: 'pewne', czas: 420,
    baseUrl: 'http://dom:11434', apiKey: KLUCZ, blad: 'Not found for account abc' });
  const tresc = fs.readFileSync(plik, 'utf8');
  ok(blad === null && !/dom:11434|klucz-tajny|account/.test(tresc), 'E1. zapis tylko z białej listy pól (bez adresu, klucza, błędu)');
  ok((fs.statSync(plik).mode & 0o777) === 0o600, 'E2. plik ma uprawnienia 0600 jak reszta kont');
  const r2 = U.utworzRejestrModeli({ plik, czytajJson, zapiszAtomowo, teraz: () => czas });
  ok(r2.sprawdzenie('cloud', 'm1')?.obrazy === 'pewne', 'E3. nowa instancja czyta zapis z dysku');
  czas += U.WAZNOSC_SONDY_MS + 1;
  ok(r2.sprawdzenie('cloud', 'm1') === null && r2.sprawdzenie('cloud', 'm1', { wszystkie: true }), 'E4. po tygodniu decyzje wracają do katalogu, wpis zostaje');
  r2.zapiszDostawce('claude', [{ id: 'claude-x', max_input_tokens: 200000, capabilities: { image_input: { supported: false } } }, { id: 'bez-caps' }]);
  ok(r2.umiejetnosciModelu('claude-x', 'claude').okno === 200000 && r2.umiejetnosciModelu('claude-x', 'claude').wizja === false
    && r2.dostawca('claude', 'bez-caps') === null, 'F3. rejestr: capabilities trafiają do umiejetnosci()');
  fs.rmSync(kat, { recursive: true, force: true });
}

// ------------------------------------------------------------------ serwer
const zadania = [];          // co dostał dostawca
const rozgrzewki = [];
let limitProb = 0;
const up = http.createServer((req, res) => {
  const json = (kod, d, naglowki = {}) => { res.writeHead(kod, { 'Content-Type': 'application/json', ...naglowki }); res.end(JSON.stringify(d)); };
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const u = req.url;
    if (req.method === 'GET' && u.startsWith('/nv/v1/models')) {
      return json(200, { data: ['nvidia/widzi-8b', 'openai/gpt-oss-20b', 'meta/zablokowany', 'meta/limit'].map((id) => ({ id })) });
    }
    if (req.method === 'GET' && u.startsWith('/lok/v1/models')) return json(200, { data: [{ id: 'qwen3:8b' }, { id: 'gemma3:12b' }] });
    if (req.method === 'GET' && u.startsWith('/cl/v1/models')) {
      return json(200, { data: [{ id: 'claude-test-5', max_input_tokens: 777000, max_tokens: 64000,
        capabilities: { image_input: { supported: true }, thinking: { supported: true } } }] });
    }
    if (u === '/lok/api/generate') { rozgrzewki.push(b); return json(200, { done: true }); }
    let j = {}; try { j = JSON.parse(b); } catch { /* puste */ }
    const tresc = j.messages?.[j.messages.length - 1]?.content;
    const obraz = Array.isArray(tresc) ? tresc.find((c) => c.type === 'image_url')?.image_url?.url : null;
    const pytanie = Array.isArray(tresc) ? tresc.find((c) => c.type === 'text')?.text : tresc;
    zadania.push({ sciezka: u, model: j.model, obraz, pytanie, max: j.max_tokens ?? j.max_completion_tokens, auth: req.headers.authorization });
    if (j.model === 'meta/zablokowany') return json(404, { error: { message: "Function 'x': Not found for account 'konto-123'" } });
    if (j.model === 'meta/limit') { limitProb++; return json(429, { error: { message: 'Too many requests' } }, { 'retry-after': '1' }); }
    const widzi = ['nvidia/widzi-8b', 'gemma3:12b'].includes(j.model);
    if (obraz && j.model === 'qwen3:8b') return json(400, { error: { message: 'model does not support images' } });
    // gpt-oss-20b jak prawdziwy dostawca: obraz przyjmuje i… ignoruje
    const odp = obraz ? (widzi && /colou?r/i.test(pytanie || '') ? 'Red' : 'Hello! How can I help you today?') : 'ok';
    return json(200, { choices: [{ message: { content: odp }, finish_reason: 'stop' }] });
  });
});

const katDanych = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-test-'));
const plikRejestru = path.join(katDanych, 'konta', 'modele-sprawdzone.json');
let srv = null;
let baza = '';
const wstan = async () => {
  srv = uruchom('node', ['server.js'], { cwd: KORZEN, env: { ...process.env, PORT: String(PORT), COSMOS_DATA_DIR: katDanych,
    NVIDIA_API_KEY: KLUCZ, NEMOTRON_BASE_URL: `${baza}/nv/v1`, NEMOTRON_MODEL: 'nvidia/widzi-8b',
    LOCAL_BASE_URL: `${baza}/lok/v1`, LOCAL_MODEL: 'gemma3:12b', LOCAL_API_KEY: '',
    ANTHROPIC_API_KEY: 'test-claude', ANTHROPIC_BASE_URL: `${baza}/cl/v1`, CLAUDE_MODEL: 'claude-test-5',
    SENSES_URL: 'http://127.0.0.1:1' } });
  if (!await czekajNa(`http://127.0.0.1:${PORT}/api/status`)) throw new Error('serwer nie wstał');
};
const post = async (dane) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/models/check`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dane) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const lista = async (ep) => (await fetch(`http://127.0.0.1:${PORT}/api/models?endpoint=${ep}`)).json();

up.listen(0, '127.0.0.1', async () => {
  baza = `http://127.0.0.1:${up.address().port}`;
  try {
    await wstan();
    // D. sonda na żywo
    let w = await post({ endpoint: 'cloud', model: 'nvidia/widzi-8b' });
    const sondaWzroku = zadania.find((z) => z.model === 'nvidia/widzi-8b' && z.obraz);
    const wym = sondaWzroku && wymiaryPng(sondaWzroku.obraz);
    ok(w.json.rozmowa === true && w.json.obrazy === true && w.json.obrazyPewnosc === 'pewne',
      `D6. model, który nazwał kolor → obrazy pewne (${w.json.obrazyPewnosc})`);
    ok(wym && wym.w === 8 && wym.h === 8 && /colou?r/i.test(sondaWzroku.pytanie || '') && sondaWzroku.max > 1 && sondaWzroku.max <= 32,
      `D7. sonda wysyła obrazek ${wym ? `${wym.w}×${wym.h}` : '?'} z pytaniem o kolor, limit ${sondaWzroku?.max}`);
    w = await post({ endpoint: 'cloud', model: 'openai/gpt-oss-20b' });
    ok(w.json.rozmowa === true && w.json.obrazy === false && w.json.obrazyPewnosc === 'nie',
      `D8. obraz przyjęty, ale zignorowany → NIE widzi (${w.json.obrazyPewnosc}; dawniej 1×1 = „widzi”)`);

    // E. zapis
    w = await post({ endpoint: 'cloud', model: 'meta/zablokowany' });
    const przedLimitem = fs.existsSync(plikRejestru) ? fs.readFileSync(plikRejestru, 'utf8') : '';
    w = await post({ endpoint: 'cloud', model: 'meta/limit' });
    const plik = fs.existsSync(plikRejestru) ? fs.readFileSync(plikRejestru, 'utf8') : '';
    const zapis = plik ? JSON.parse(plik) : { sprawdzone: {} };
    const s = zapis.sprawdzone || {};
    ok(s['cloud|nvidia/widzi-8b']?.obrazy === 'pewne' && s['cloud|openai/gpt-oss-20b']?.obrazy === 'nie'
      && s['cloud|meta/zablokowany']?.rozmowa === false, 'E5. wyniki „Sprawdź” zapisane w data/konta/modele-sprawdzone.json');
    ok(!s['cloud|meta/limit'] && limitProb >= 1 && plik === przedLimitem, `E6. limit zapytań niczego nie zapisał (${limitProb} prób)`);
    ok(!plik.includes(KLUCZ) && !plik.includes('127.0.0.1') && !/konto-123|Not found/.test(plik),
      'E7. w pliku nie ma klucza, adresu ani treści błędu dostawcy');
    ok(Number.isFinite(s['cloud|nvidia/widzi-8b']?.czas) && s['cloud|nvidia/widzi-8b']?.kiedy > 0, 'E8. zapis ma czas odpowiedzi i datę');

    // F. Claude – capabilities z natywnego /v1/models
    const lc = await lista('claude');
    const zapis2 = JSON.parse(fs.readFileSync(plikRejestru, 'utf8'));
    const d = zapis2.dostawcy?.['claude|claude-test-5'];
    ok(Array.isArray(lc.data) && d && d.okno === 777000 && d.maxWyjscie === 64000 && d.wizja === true && d.myslenie === true,
      'F4. /api/models Claude\'a zapisuje okno, limit wyjścia, wzrok i myślenie');

    // restart: zapis przeżywa
    zabij(srv); await new Promise((r) => setTimeout(r, 600));
    await wstan();
    const ln = await lista('cloud');
    ok(ln.sprawdzone?.['nvidia/widzi-8b']?.obrazy === 'pewne' && ln.sprawdzone?.['meta/zablokowany']?.rozmowa === false
      && !JSON.stringify(ln.sprawdzone).includes('Not found'), 'E9. po restarcie /api/models oddaje zapisane wyniki (bez błędów)');

    // rozgrzewanie
    const rz = await post({ endpoint: 'local', model: 'qwen3:8b', rozgrzej: true });
    await new Promise((r) => setTimeout(r, 400));
    const ostatnia = rozgrzewki.map((x) => { try { return JSON.parse(x); } catch { return {}; } }).pop() || {};
    ok(rz.status === 202 && ostatnia.model === 'qwen3:8b' && ostatnia.prompt === undefined,
      `G1. rozgrzej → 202 i puste /api/generate modelu (${rz.status}, ${rozgrzewki.length})`);
    const rzc = await post({ endpoint: 'cloud', model: 'nvidia/widzi-8b', rozgrzej: true });
    ok(rzc.status === 400, `G2. rozgrzewanie tylko lokalnie (chmura → ${rzc.status})`);

    // G. przeglądarka
    if (maPrzegladarke()) {
      const br = await przegladarka();
      const pg = await (await br.newContext({ serviceWorkers: 'block' })).newPage();
      const bledy = [];
      pg.on('pageerror', (e) => bledy.push(e.message));
      await pg.goto(`http://127.0.0.1:${PORT}/app`, { waitUntil: 'load' });
      await pg.click('#settings-btn');
      await pg.evaluate(() => document.querySelector('#settings-modal [data-cel="silniki"]').click());
      await pg.click('#fetch-models-cloud');
      await pg.waitForSelector('#check-all-cloud', { timeout: 15000 });
      const znaki = await pg.$$eval('#model-select-cloud option', (os) => Object.fromEntries(
        os.filter((o) => o.value).map((o) => [o.value, [...o.textContent.trim()][0]])));
      ok(znaki['nvidia/widzi-8b'] === '👁' && znaki['openai/gpt-oss-20b'] === '✓' && znaki['meta/zablokowany'] === '✗',
        `G3. po odświeżeniu znaczki z zapisu: ${JSON.stringify(znaki)}`);

      const przed = rozgrzewki.length;
      await pg.click('#fetch-models-local');
      await pg.waitForSelector('#check-all-local', { timeout: 15000 });
      await pg.click('#check-all-local');
      await pg.waitForFunction(() => /\d+\s*z\s*\d+|\d+\s*of\s*\d+/.test(
        document.getElementById('model-info-local')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
      await pg.waitForTimeout(400);
      const po = rozgrzewki.slice(przed).map((x) => { try { return JSON.parse(x).model; } catch { return ''; } });
      const tekst = await pg.textContent('#model-info-local');
      const ostatniaSonda = zadania.filter((z) => z.sciezka.startsWith('/lok/')).pop();
      ok(po.includes('gemma3:12b') && ostatniaSonda && ostatniaSonda.model === 'qwen3:8b',
        `G4. po „Sprawdź wszystkie” lokalnie rozgrzany model z zakładki (ostatnia sonda: ${ostatniaSonda?.model}, rozgrzewki: ${po.join(',')})`);
      ok(/gemma3:12b/.test(tekst || ''), `G5. komunikat o rozgrzaniu: ${(tekst || '').replace(/\s+/g, ' ').slice(0, 120)}`);
      const znakiL = await pg.$$eval('#model-select-local option', (os) => Object.fromEntries(
        os.filter((o) => o.value).map((o) => [o.value, [...o.textContent.trim()][0]])));
      ok(znakiL['gemma3:12b'] === '👁' && znakiL['qwen3:8b'] === '✓', `G6. znaczki lokalne: ${JSON.stringify(znakiL)}`);
      ok(!bledy.length, `G7. bez błędów JS${bledy.length ? ': ' + bledy.join(' | ') : ''}`);
      await br.close();
    } else {
      console.log('(bez przeglądarki – część G pominięta)');
    }
  } catch (e) {
    fail.push(`wyjątek: ${e.stack || e.message}`);
  }
  zabij(srv); up.close();
  try { fs.rmSync(katDanych, { recursive: true, force: true }); } catch { /* zostaje w tmp */ }
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nWSZYSTKO GRA');
  process.exit(fail.length ? 1 : 0);
});

/* Dostęp do silników z JAWNĄ osobą – fundament zespołu agentów (etap 1).

   Zespół agentów to kilka wywołań modelu na jedno pytanie, w kolejkach
   i pracownikach, poza zwykłym żądaniem. Sondy zespołu IT (runda 9,
   it-konta: sonda-kontekstu.js, sonda-kolejki.js) pokazały trzy dziury:

     – w zdarzeniu HTTP (`res.on('close')`) kontekstu osoby nie ma, a wtedy
       `silniki.dostep('claude')` oddawał klucz WŁAŚCICIELA członkowi bez
       przyznania,
     – kolejka z pętlą-pracownikiem wykonywała zadanie osoby B w kontekście
       osoby A,
     – `silniki.dostep('openai', B)` wołane w kontekście A brało WŁASNY klucz A.

   Gwarancje:
     1. `dostepDla(nazwa, u)` – bez osoby, bez kontekstu albo z inną osobą
        w kontekście rzuca BrakKontekstu; nigdy „w takim razie właściciel”,
     2. `dostep()` z członkiem w kontekście liczy dla członka – także gdy
        ktoś poda `null`; własny klucz czytany z konta WSKAZANEJ osoby,
     3. `kolejkaZKontekstem` – każde zadanie widzi osobę, która je zleciła,
     4. przyznanie „zespol” (właściciel zawsze, członek z przyznania),
     5. liczniki zużycia na silnik: bez własnego klucza członka w widoku
        właściciela, w całości dla samej osoby,
     6. `stream_options` zdejmowane po odmowie 400, `usage` czytane ze strumienia,
     7. `ustawMyslenie` – znane rodziny przełączane, nieznany model bez zmian.

   Bez serwera i bez przeglądarki – moduły wołane wprost. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const PORT_ATRAPY = 7880;
process.env.COSMOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-dostep-osoba-'));
const KLUCZ_CLAUDE_W = 'sk-ant-wlasciciela-0000000000000001';
const KLUCZ_OPENAI_W = 'sk-openai-wlasciciela-00000000000001';
process.env.ANTHROPIC_API_KEY = KLUCZ_CLAUDE_W;
process.env.OPENAI_API_KEY = KLUCZ_OPENAI_W;
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${PORT_ATRAPY}/v1`;
process.env.OPENAI_MODEL = 'atrapa-openai';

const R = path.join(__dirname, '..', '..', 'lib');
const { wKontekscie, kto, kolejkaZKontekstem } = require(path.join(R, 'kontekst.js'));
const silniki = require(path.join(R, 'silniki.js'));
const konta = require(path.join(R, 'konta.js'));
const model = require(path.join(R, 'model.js'));
const czat = require(path.join(R, 'czat.js'));
const { ustawStraznikaSilnikow, ENDPOINTS } = require(path.join(R, 'rdzen.js'));
ustawStraznikaSilnikow(silniki.wybierz);

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const pauza = (ms) => new Promise((r) => setTimeout(r, ms));
const rzuca = (fn) => { try { fn(); return null; } catch (e) { return e; } };

(async () => {
  // --- osoby --------------------------------------------------------------------
  await konta.zapewnijWlasciciela({ login: 'marcin' });
  const nowy = async (login) => {
    const { token } = konta.utworzZaproszenie({ nazwa: login, przez: 'wlasciciel' });
    return (await konta.przyjmijZaproszenie(token, { login, haslo: `haslo-${login}-12345` })).id;
  };
  const idA = await nowy('ania');
  const idB = await nowy('bartek');
  konta.ustawSilniki(idB, { claude: true });
  const W = konta.znajdz('wlasciciel');
  const A = konta.znajdz(idA);
  const B = konta.znajdz(idB);
  ok(Boolean(ENDPOINTS.claude && ENDPOINTS.openai), 'silniki właściciela Claude i OpenAI ustawione w atrapie środowiska');

  // --- 1. dostepDla -------------------------------------------------------------
  const bezOsoby = wKontekscie(A, () => rzuca(() => silniki.dostepDla('claude')));
  ok(bezOsoby && bezOsoby.name === 'BrakKontekstu', `dostepDla bez osoby → ${bezOsoby && bezOsoby.name}`);
  const bezKontekstu = rzuca(() => silniki.dostepDla('claude', A));
  ok(bezKontekstu && bezKontekstu.name === 'BrakKontekstu', `dostepDla poza kontekstem → ${bezKontekstu && bezKontekstu.name}`);
  const cudzy = wKontekscie(A, () => rzuca(() => silniki.dostepDla('claude', B)));
  ok(cudzy && cudzy.name === 'BrakKontekstu', `dostepDla(B) w kontekście A → ${cudzy && cudzy.name}`);
  const wlasnyA = wKontekscie(A, () => silniki.dostepDla('claude', A));
  ok(!wlasnyA.ok, 'dostepDla: członek bez przyznania nie dostaje Claude');
  const wlasnyB = wKontekscie(B, () => silniki.dostepDla('claude', B));
  ok(wlasnyB.ok && wlasnyB.zrodlo === 'przyznany', `dostepDla: członek z przyznaniem → ${wlasnyB.zrodlo}`);
  const wl = wKontekscie(W, () => silniki.dostepDla('claude', W));
  ok(wl.ok && wl.zrodlo === 'wlasciciel', 'dostepDla: właściciel ma swój silnik');

  // Trzy role naraz dla dwóch osób – przeplatane (Promise.all, setImmediate, timer).
  const rola = (u) => async () => {
    await pauza(Math.random() * 20);
    await new Promise((r) => setImmediate(r));
    const d = silniki.dostepDla('claude', u);
    return { kto: kto().id, zrodlo: d.ok ? d.zrodlo : 'brak' };
  };
  const [ra, rb] = await Promise.all([
    wKontekscie(A, () => Promise.all([1, 2, 3].map(() => rola(A)()))),
    wKontekscie(B, () => Promise.all([1, 2, 3].map(() => rola(B)()))),
  ]);
  ok(ra.every((x) => x.kto === idA && x.zrodlo === 'brak') && rb.every((x) => x.kto === idB && x.zrodlo === 'przyznany'),
    'role dwóch osób naraz: każda widzi swoją osobę i swoje uprawnienia');

  // Zdarzenie spoza kontekstu (jak res.on('close') z gniazda) – EventEmitter i prawdziwe HTTP.
  const em = new EventEmitter();
  let wZdarzeniu = null;
  wKontekscie(A, () => em.on('koniec', () => { wZdarzeniu = rzuca(() => silniki.dostepDla('claude', A)); }));
  em.emit('koniec');
  ok(wZdarzeniu && wZdarzeniu.name === 'BrakKontekstu', 'zdarzenie poza kontekstem: dostepDla rzuca, nie oddaje klucza właściciela');
  const wClose = await new Promise((gotowe) => {
    const srv = http.createServer((req, res) => {
      wKontekscie(A, () => {
        res.on('close', () => {
          let d = null;
          const e = rzuca(() => { d = silniki.dostepDla('claude', A); });
          gotowe({ kto: kto(), e, d }); srv.close();
        });
        res.writeHead(200); res.write('x');
      });
    }).listen(PORT_ATRAPY + 1, '127.0.0.1', () => {
      const rq = http.get(`http://127.0.0.1:${PORT_ATRAPY + 1}/`, (r) => { r.once('data', () => rq.destroy()); });
      rq.on('error', () => {});
    });
  });
  ok(wClose.kto === null && wClose.e && wClose.e.name === 'BrakKontekstu' && !wClose.d,
    'res.on(close) członka: brak kontekstu → BrakKontekstu, żadnego klucza');

  // --- 2. dostep() bez osoby w kontekście członka; własny klucz WSKAZANEJ osoby --
  ok(!wKontekscie(A, () => silniki.dostep('claude')).ok, 'dostep() w kontekście członka liczy dla członka');
  const zNullem = wKontekscie(A, () => silniki.dostep('claude', null));
  ok(!zNullem.ok, `dostep(claude, null) w kontekście członka NIE daje klucza właściciela (${zNullem.zrodlo || zNullem.ok})`);
  const serwera = silniki.dostep('claude');
  ok(serwera.ok && serwera.zrodlo === 'wlasciciel', 'bez żadnego kontekstu (praca serwera) – silnik właściciela jak dotąd');
  const KLUCZ_A = 'sk-proj-A-wlasny-klucz-0123456789abcdef';
  await wKontekscie(A, () => silniki.ustawKlucz('openai', KLUCZ_A));
  const dlaB = wKontekscie(A, () => silniki.dostep('openai', B));
  ok(!(dlaB.ok && dlaB.ep && dlaB.ep.apiKey === KLUCZ_A), `dostep(openai, B) w kontekście A nie bierze klucza A (${dlaB.ok ? dlaB.zrodlo : 'brak'})`);
  const dlaA = wKontekscie(B, () => silniki.dostep('openai', A));
  ok(dlaA.ok && dlaA.zrodlo === 'wlasny' && dlaA.ep.apiKey === KLUCZ_A, 'dostep(openai, A) w kontekście B bierze klucz A – osoby wskazanej');

  // --- 3. kolejka z kontekstem -----------------------------------------------------
  const kolejka = kolejkaZKontekstem({ naraz: 1 });
  const zadanie = (u) => async () => {
    await pauza(10);
    let d = null;
    try { d = silniki.dostepDla('openai', u); } catch { /* osoba w cudzym kontekście – to jest błąd, który łapiemy niżej */ }
    return { kto: kto() && kto().id, d };
  };
  const [ka, kb] = await Promise.all([
    wKontekscie(A, () => kolejka(zadanie(A))),
    wKontekscie(B, () => kolejka(zadanie(B))),
  ]);
  ok(ka.kto === idA && kb.kto === idB, `kolejka: zadanie A widzi ${ka.kto}, zadanie B widzi ${kb.kto}`);
  ok(Boolean(ka.d && ka.d.ok && ka.d.ep.apiKey === KLUCZ_A && kb.d && !kb.d.ok), 'kolejka: klucz A tylko w zadaniu A, dostepDla działa w obu zadaniach');
  // Współbieżność: nie więcej niż `naraz`.
  const dwie = kolejkaZKontekstem({ naraz: 2 });
  let trwa = 0; let max = 0;
  await Promise.all([1, 2, 3, 4, 5].map((i) => wKontekscie(i % 2 ? A : B, () => dwie(async () => {
    trwa++; max = Math.max(max, trwa); await pauza(15); trwa--;
  }))));
  ok(max === 2, `kolejka {naraz: 2}: najwyżej ${max} zadania naraz`);
  const blad = await wKontekscie(A, () => kolejka(async () => { throw new Error('zadanie padło'); })).catch((e) => e.message);
  const poBledzie = await wKontekscie(B, () => kolejka(async () => kto().id));
  ok(blad === 'zadanie padło' && poBledzie === idB, 'kolejka: błąd zadania wraca do zlecającego, a kolejka jedzie dalej');

  // --- 4. przyznanie „zespol” --------------------------------------------------------
  ok(konta.SILNIKI_PRZYZNAWANE.includes('zespol'), 'zespol jest na liście przyznawanych');
  ok(A.silniki.zespol === false, 'nowy członek domyślnie bez zespołu');
  ok(silniki.zespolDozwolony(W) && !silniki.zespolDozwolony(A), 'zespół: właściciel zawsze, członek bez przyznania nie');
  const Az = konta.ustawSilniki(idA, { zespol: true });
  ok(Az.silniki.zespol === true && silniki.zespolDozwolony(Az), 'po przyznaniu „zespol” członek ma zespół');
  ok(!silniki.zespolDozwolony(null) && !silniki.zespolDozwolony(), 'bez osoby zespołu nie ma (nie jest pracą serwera)');
  ok(wKontekscie(Az, () => silniki.zespolDozwolony()) === true, 'zespolDozwolony() bez argumentu – osoba z kontekstu');
  konta.ustawSilniki(idA, { zespol: false });

  // --- 5. liczniki zużycia ------------------------------------------------------------
  konta.zanotujZuzycie(idA, { silnik: 'cloud', zrodlo: 'wspolny', we: 100, wy: 20 });
  konta.zanotujZuzycie(idA, { silnik: 'cloud', zrodlo: 'wspolny', we: 50, wy: 5 });
  konta.zanotujZuzycie(idA, { silnik: 'openai', zrodlo: 'wlasny', we: 999, wy: 111 });
  konta.zanotujZuzycie(idA, { silnik: 'claude', zrodlo: 'przyznany', we: 10, wy: 1 });
  konta.zanotujZuzycie('wlasciciel', { silnik: 'claude', zrodlo: 'wlasny', we: 7, wy: 3 });
  const widokW = konta.wszyscy().find((u) => u.id === idA).zuzycie.silniki;
  ok(widokW.dzisiaj.cloud && widokW.dzisiaj.cloud.wywolan === 2 && widokW.dzisiaj.cloud.we === 150 && widokW.dzisiaj.cloud.wy === 25,
    `dzisiaj na chmurze: 2 wywołania, 150/25 tokenów (${JSON.stringify(widokW.dzisiaj.cloud)})`);
  ok(!widokW.dzisiaj.openai && !widokW.dni30.openai, 'właściciel NIE widzi zużycia z własnego klucza członka');
  ok(widokW.dzisiaj.claude && widokW.dzisiaj.claude.wywolan === 1, 'właściciel widzi zużycie przyznanego Claude');
  const osoby = konta.zuzycieOsoby(idA).silniki;
  ok(osoby.dzisiaj.openai && osoby.dzisiaj.openai.we === 999, 'osoba widzi też swoje zużycie z własnego klucza');
  const wlW = konta.wszyscy().find((u) => u.id === 'wlasciciel').zuzycie.silniki;
  ok(wlW.dzisiaj.claude && wlW.dzisiaj.claude.wywolan === 1, 'właściciel widzi własny klucz u siebie');
  ok(!JSON.stringify(konta.wszyscy()).match(/tresc|content|rola\b.*badacz/), 'w widoku kont żadnych treści ani nazw ról');
  // Zapis odroczony – czekamy na zaległy zapis jawnie.
  konta.zapiszZalegle();
  const poZapisie = JSON.parse(fs.readFileSync(konta.PLIK_UZYTKOWNICY, 'utf8'));
  const aNaDysku = poZapisie.find((u) => u.id === idA);
  ok(Boolean(aNaDysku && aNaDysku.zuzycie && aNaDysku.zuzycie.silniki && aNaDysku.zuzycie.silniki[Object.keys(aNaDysku.zuzycie.silniki)[0]].cloud),
    'liczniki trafiają na dysk (dzień → silnik → źródło) po zapisie odroczonym');
  konta.zanotujZuzycie(idA, { silnik: 'nieznany', zrodlo: 'zmyslone', we: -5, wy: 'x' });
  const poDziwnym = konta.zuzycieOsoby(idA).silniki.dzisiaj.cloud;
  ok(poDziwnym.wywolan === 3 && poDziwnym.we === 150, 'nieznany silnik → chmura, ujemne i nieliczbowe tokeny → 0');

  // --- 6. stream_options i usage --------------------------------------------------------
  const proby = [];
  const atrapa = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const d = JSON.parse(b || '{}');
      proby.push(d);
      if (d.stream_options) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: stream_options' } }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((r) => atrapa.listen(PORT_ATRAPY, '127.0.0.1', r));
  const ep = { baseUrl: `http://127.0.0.1:${PORT_ATRAPY}/v1`, apiKey: 'x', label: 'atrapa' };
  const odp = await model.zapytajModel(ep, { model: 'bez-usage', messages: [{ role: 'user', content: 'a' }], stream: true, stream_options: { include_usage: true } }, { ponowienia: 0 });
  await odp.text();
  ok(odp.ok && proby.length === 2 && proby[0].stream_options && !proby[1].stream_options,
    `odmowa 400 na stream_options → drugie zapytanie bez niego (${proby.length} zapytań)`);
  proby.length = 0;
  (await model.zapytajModel(ep, { model: 'bez-usage', messages: [{ role: 'user', content: 'b' }], stream: true, stream_options: { include_usage: true } }, { ponowienia: 0 })).text();
  await pauza(50);
  ok(proby.length === 1 && !proby[0].stream_options, 'następne zapytanie do tego modelu od razu bez stream_options (zapamiętane)');
  atrapa.close();

  const ostatni = 'data: {"id":"x","choices":[],"usage":{"prompt_tokens":321,"completion_tokens":45,"total_tokens":366}}';
  assert.deepStrictEqual(model.czytajUsage(ostatni), { we: 321, wy: 45 });
  ok(model.czytajUsage('data: {"choices":[{"delta":{"content":"usage"}}]}') === null, 'blok bez usage → null (słowo „usage” w treści nie myli)');
  ok(model.czytajUsage('data: {"choices":[],"usage":null}') === null, '„usage”: null → null');
  const ciagly = 'data: {"choices":[{"delta":{"content":"a"}}],"usage":{"prompt_tokens":10,"completion_tokens":1}}\n'
    + 'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":7}}';
  ok(model.czytajUsage(ciagly).wy === 7, 'usage w każdym bloku (vLLM) → ostatnie');
  const licz = model.licznikUsage();
  const strumien = `data: {"choices":[{"delta":{"content":"x"}}]}\n\n${ostatni}\n\ndata: [DONE]\n\n`;
  for (let i = 0; i < strumien.length; i += 7) licz.karm(strumien.slice(i, i + 7));
  assert.deepStrictEqual(licz.wynik(), { we: 321, wy: 45 });
  ok(true, 'licznikUsage składa usage z kawałków po 7 znaków');
  const bezKonca = model.licznikUsage();
  bezKonca.karm(ostatni);
  ok(bezKonca.wynik() && bezKonca.wynik().we === 321, 'usage w ogonie bez pustej linii też się liczy');

  // --- 7. myślenie ----------------------------------------------------------------------
  const cialo = () => ({ model: 'x', messages: [{ role: 'system', content: 'Jesteś pomocny.' }, { role: 'user', content: 'Hej' }], max_tokens: 100 });
  const przyp = [
    ['nvidia/nemotron-3-nano-30b-a3b', false, (b) => b.chat_template_kwargs && b.chat_template_kwargs.enable_thinking === false],
    ['nvidia/nemotron-3-super-120b-a12b', true, (b) => b.chat_template_kwargs.enable_thinking === true],
    ['nvidia/nvidia-nemotron-nano-9b-v2', false, (b) => /\/no_think$/.test(b.messages[0].content) && b.messages[0].content.startsWith('Jesteś')],
    ['nvidia/llama-3.3-nemotron-super-49b-v1.5', true, (b) => /\/think$/.test(b.messages[0].content)],
    ['qwen3:14b', false, (b) => /\/no_think$/.test(b.messages[0].content)],
    ['nvidia/llama-3.3-nemotron-super-49b-v1', false, (b) => b.messages[0].content.startsWith('detailed thinking off')],
    ['nvidia/llama-3.3-nemotron-super-49b-v1', true, (b) => b.messages[0].content.startsWith('detailed thinking on')],
    ['gpt-oss:20b', false, (b) => b.reasoning_effort === 'low'],
    ['gpt-5-mini', false, (b) => b.reasoning_effort === 'minimal'],
    ['gpt-5.1', false, (b) => b.reasoning_effort === 'none'],
    ['o4-mini', true, (b) => b.reasoning_effort === 'medium'],
  ];
  for (const [id, wlacz, sprawdz] of przyp) {
    const wej = cialo();
    const kopia = JSON.parse(JSON.stringify(wej));
    const wyn = model.ustawMyslenie(wej, id, wlacz);
    ok(sprawdz(wyn) && JSON.stringify(wej) === JSON.stringify(kopia), `myślenie ${wlacz ? 'wł.' : 'wył.'}: ${id} (${model.sposobMyslenia(id)}), wejście nietknięte`);
  }
  for (const id of ['llama3.1:8b', 'claude-sonnet-5', 'deepseek-r1:8b', 'qwen3-coder:30b', 'mistral-nemo', 'nieznany/model-1']) {
    for (const wlacz of [true, false]) {
      const wej = cialo();
      let rowne = true;
      try { assert.deepStrictEqual(model.ustawMyslenie(wej, id, wlacz), cialo()); } catch { rowne = false; }
      ok(rowne, `nieznany albo bez przełącznika – bez zmian: ${id} (${wlacz})`);
    }
  }
  const bezWl = cialo();
  ok(model.ustawMyslenie(bezWl, 'qwen3:8b', undefined) === bezWl, 'wl różne od true/false → to samo ciało');
  const dwaRazy = model.ustawMyslenie(model.ustawMyslenie(cialo(), 'qwen3:8b', true), 'qwen3:8b', false);
  ok(/\/no_think$/.test(dwaRazy.messages[0].content) && !/\/think/.test(dwaRazy.messages[0].content.replace('/no_think', '')),
    'drugi przełącznik zastępuje pierwszy, nie dokleja się');
  const bezSystemu = model.ustawMyslenie({ messages: [{ role: 'user', content: 'a' }] }, 'nvidia/nvidia-nemotron-nano-9b-v2', false);
  ok(bezSystemu.messages[0].role === 'system' && bezSystemu.messages[0].content === '/no_think' && bezSystemu.messages.length === 2,
    'bez instrukcji systemowej – przełącznik jako nowa, pierwsza wiadomość system');

  // cichoMysli mieszka w model.js, czat oddaje tę samą funkcję (zachowanie bez zmian).
  ok(czat.cichoMysli === model.cichoMysli, 'czat.cichoMysli to ta sama funkcja co model.cichoMysli');
  const cm = (m, e = {}) => model.cichoMysli(e, m);
  ok(cm('gpt-5') && cm('openai/o3') && cm('claude-opus-5') && cm('x', { anthropic: true }) && cm('gpt-6-luna')
    && !cm('gpt-4o') && !cm('nemotron-3-nano') && !cm('gpt-oss:20b'), 'cichoMysli: te same modele co przed przeniesieniem');

  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nDOSTĘP Z OSOBĄ OK');
  process.exit(fail.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

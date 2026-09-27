/* Zmiana modelu kliknięciem w plakietkę w prawym górnym rogu.

   Zgłoszenie Marcina: model zmieniało się tylko w Ustawieniach, a plakietka
   z nazwą modelu u góry była martwym napisem. Teraz klik otwiera listę modeli
   TEGO silnika, na którego zakładce jesteś (Chmura, Lokalnie, OpenAI, Claude).

   Sprawdza w przeglądarce, na atrapie listy modeli:
     1. lista pokazuje modele bieżącego silnika, bez modeli do embeddingów,
     2. wybór zapisuje model dla tego silnika, zmienia plakietkę i trafia
        do następnego pytania,
     3. na innej zakładce lista jest inna, a wybór nie rusza modelu
        poprzedniego silnika,
     4. „Domyślny” wraca do modelu z konfiguracji serwera, Escape zamyka listę.
*/
const { przegladarka, maPrzegladarke, serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3508;
const S = `http://127.0.0.1:${PORT}`;
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

const LISTY = {
  cloud: ['nvidia/nemotron-test-a', 'nvidia/nemotron-test-b', 'nvidia/llama-nemotron-embed-1b-v2'],
  openai: ['gpt-5-test', 'gpt-5-mini-test', 'text-embedding-3-small'],
};

(async () => {
  const srv = serwerCosmosa(PORT, { OPENAI_API_KEY: 'sk-test-0000000000000000000000', SENSES_URL: 'http://127.0.0.1:1' });
  const b = await przegladarka();
  try {
    if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer testowy nie wstał');
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const bledy = [];
    p.on('pageerror', (e) => bledy.push(e.message));
    await p.route('**/api/models?*', (r) => {
      const ep = new URL(r.request().url()).searchParams.get('endpoint');
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: (LISTY[ep] || []).map((id) => ({ id })) }) });
    });
    let modelPytania = null;
    await p.route('**/api/chat', (r) => {
      try { modelPytania = JSON.parse(r.request().postData() || '{}').model; } catch { /* */ }
      r.fulfill({ status: 200, contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n` });
    });
    await p.goto(`${S}/app`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.app.gotowa') && document.querySelectorAll('.endpoint-switch button').length > 1);
    await p.evaluate(() => setEndpoint('cloud'));

    const opcje = () => p.$$eval('#model-lista .model-opcja .model-opcja-nazwa', (xs) => xs.map((x) => x.textContent));

    /* ---- 1. Lista silnika Chmura ---- */
    await p.click('#topbar-model');
    await p.waitForSelector('#model-lista .model-opcja:nth-child(3)');
    const l1 = await opcje();
    ok(l1.includes('nvidia/nemotron-test-a') && l1.includes('nvidia/nemotron-test-b') && !l1.some((m) => /gpt-5/.test(m)),
      `1. klik w plakietkę pokazuje modele Chmury (${l1.join(', ')})`);
    ok(!l1.some((m) => /embed/.test(m)), '1. modele do embeddingów nie są na liście do rozmowy');

    /* ---- 2. Wybór ---- */
    await p.click('#model-lista .model-opcja:has-text("nvidia/nemotron-test-b")');
    const s2 = await p.evaluate(() => ({ ust: settings.modelCloud, plakietka: document.getElementById('topbar-model').textContent,
      otwarta: !document.getElementById('model-lista').hidden }));
    ok(s2.ust === 'nvidia/nemotron-test-b' && !s2.otwarta, `2. wybór zapisany dla Chmury i lista zamknięta (${s2.ust})`);
    ok(/nemotron-test-b/.test(s2.plakietka), `2. plakietka pokazuje wybrany model („${s2.plakietka.trim()}”)`);
    await p.evaluate(() => newConversation());
    await p.fill('#input', 'pytanie po zmianie modelu');
    await p.press('#input', 'Enter');
    await p.waitForFunction(() => document.getElementById('stop-btn').style.display === 'none', null, { timeout: 15000 }).catch(() => {});
    ok(modelPytania === 'nvidia/nemotron-test-b', `2. następne pytanie idzie wybranym modelem (${modelPytania})`);

    /* ---- 3. Inna zakładka ---- */
    await p.evaluate(() => setEndpoint('openai'));
    await p.click('#topbar-model');
    await p.waitForSelector('#model-lista .model-opcja:has-text("gpt-5-test")');
    const l3 = await opcje();
    ok(!l3.some((m) => /nemotron/.test(m)), `3. na zakładce OpenAI lista OpenAI (${l3.join(', ')})`);
    await p.click('#model-lista .model-opcja:has-text("gpt-5-mini-test")');
    const s3 = await p.evaluate(() => ({ oa: settings.modelOpenai, cloud: settings.modelCloud }));
    ok(s3.oa === 'gpt-5-mini-test' && s3.cloud === 'nvidia/nemotron-test-b', `3. wybór na OpenAI nie rusza modelu Chmury (${JSON.stringify(s3)})`);

    /* ---- 4. Domyślny i Escape ---- */
    await p.click('#topbar-model');
    await p.waitForSelector('#model-lista .model-opcja');
    await p.click('#model-lista .model-opcja >> nth=0');
    ok((await p.evaluate(() => settings.modelOpenai)) === '', '4. „Domyślny” czyści wybór i wraca do modelu serwera');
    await p.click('#topbar-model');
    await p.waitForSelector('#model-lista .model-opcja');
    await p.keyboard.press('Escape');
    ok(await p.evaluate(() => document.getElementById('model-lista').hidden), '4. Escape zamyka listę');

    ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    await b.close();
    zabij(srv);
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nPLAKIETKA MODELU OK');
  process.exit(fail.length ? 1 : 0);
})();

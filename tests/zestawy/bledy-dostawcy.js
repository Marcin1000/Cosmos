/* Błędy dostawcy mówią prawdę i nie wylogowują.

   Zespół IT, runda 5:
     – zły klucz NVIDII, OpenAI albo Claude: dostawca odpowiada 401, Cosmos
       przepuszczał ten kod, a przeglądarka brała go za wygasłą sesję – ekran
       „Sesja wygasła" przy każdej wiadomości, także u zaproszonej osoby,
     – każdy 404 modelu kończył się „nie jest dostępny na Twoim koncie"
       i przyciskiem „Ponów", choć przyczyny są różne i ponawianie nie pomoże,
     – „Sprawdź wszystkie" oznaczało gpt-5 i o-serię jako niedostępne (sonda
       wysyłała surowe max_tokens), a limit zapytań (429) – działające modele,
     – członek widział na liście cały katalog, choć wolno mu tylko modele
       z listy właściciela.

   Sprawdzamy przez HTTP, na atrapie dostawcy:
     1. 401 dostawcy → 502 z kodem `klucz-dostawcy` i `trwaly`, sesja żyje.
     2. Członek na przyznanym silniku dostaje zdanie o kluczu właściciela.
     3. 404 „tylko Responses API" i „wycofany" → różne, trafne zdania, `trwaly`.
     4. Sonda modelu rozumującego przechodzi (max_completion_tokens).
     5. 429 w sondzie → jedno ponowienie; ciągłe 429 → „niepewne", nie „nie działa".
     6. Lista modeli członka przycięta do listy właściciela.
*/
const http = require('node:http');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3503;
const S = `http://127.0.0.1:${PORT}`;
const HASLO = 'haslo-wlasciciela-2026';
const fail = [];
const ok = (warunek, opis) => { console.log(`${warunek ? 'ok ' : 'ŹLE'} ${opis}`); if (!warunek) fail.push(opis); };

let limitZostalo = 0;
const atrapa = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; }).on('end', () => {
    const json = (kod, dane) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(dane)); };
    if (req.url.endsWith('/models')) {
      return json(200, { data: ['gpt-4o', 'gpt-5-mini', 'gpt-5-pro', 'o1-pro', 'dall-e-3'].map((id) => ({ id })) });
    }
    if (!req.url.endsWith('/chat/completions')) return json(404, {});
    const d = JSON.parse(b || '{}');
    if (d.model === 'zly-klucz') return json(401, { error: { message: 'Incorrect API key provided: sk-abc***', type: 'invalid_request_error' } });
    if (d.model === 'gpt-5-pro') return json(404, { error: { message: 'This model is only supported in v1/responses and not in v1/chat/completions.' } });
    if (d.model === 'gpt-4.5-preview') return json(404, { error: { message: 'The model `gpt-4.5-preview` has been deprecated.' } });
    if (d.model === 'gpt-5-mini' && d.max_tokens !== undefined) {
      return json(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } });
    }
    if (d.model === 'zawsze-limit') return json(429, { error: { message: 'Rate limit reached' } });
    if (d.model === 'raz-limit' && limitZostalo > 0) { limitZostalo--; res.writeHead(429, { 'Retry-After': '1' }); return res.end('{"error":{"message":"Rate limit"}}'); }
    if (d.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    }
    return json(200, { choices: [{ message: { content: 'o' } }] });
  });
});

function klient() {
  let ciastko = '';
  return async (sciezka, { metoda = 'GET', dane } = {}) => {
    const r = await fetch(`${S}${sciezka}`, {
      method: metoda,
      headers: { 'Content-Type': 'application/json', ...(ciastko ? { Cookie: ciastko } : {}) },
      body: dane === undefined ? undefined : JSON.stringify(dane),
    });
    const sc = r.headers.getSetCookie().find((c) => c.startsWith('cosmos_auth='));
    if (sc) ciastko = sc.split(';')[0];
    const tekst = await r.text();
    let json = {};
    try { json = JSON.parse(tekst); } catch { json = { surowe: tekst }; }
    return { kod: r.status, json, tekst };
  };
}

const czat = (zadaj, endpoint, model) => zadaj('/api/chat', { metoda: 'POST', dane: {
  endpoint, model, messages: [{ role: 'user', content: 'hej' }],
  useSenses: false, useSearch: false, useActions: false, useMemory: false, useKb: false, useStudio: false,
} });

(async () => {
  await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${atrapa.address().port}/v1`;
  const srv = serwerCosmosa(PORT, {
    COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin',
    NEMOTRON_BASE_URL: A, OPENAI_API_KEY: 'test', OPENAI_BASE_URL: A, OPENAI_MODEL: 'gpt-4o',
    COSMOS_MODELE_PRZYZNANE: 'gpt-5-mini,zly-klucz', SENSES_URL: 'http://127.0.0.1:1',
  });
  try {
    if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer testowy nie wstał');
    const wl = klient();
    await wl('/api/login', { metoda: 'POST', dane: { login: '', password: HASLO } });

    /* ---- 1. 401 dostawcy ---- */
    const r1 = await czat(wl, 'openai', 'zly-klucz');
    ok(r1.kod === 502 && r1.json.kod === 'klucz-dostawcy', `1. 401 dostawcy → ${r1.kod} ${r1.json.kod} (ma być 502 klucz-dostawcy)`);
    ok(r1.json.trwaly === true, '1. zły klucz oznaczony jako trwały (bez „Ponów")');
    ok(!/sk-abc/.test(r1.tekst), '1. fragment klucza z komunikatu dostawcy nie trafia na ekran');
    ok((await wl('/api/auth')).json.authed === true, '1. sesja właściciela żyje po błędzie dostawcy');

    /* ---- 2. Członek na przyznanym silniku ---- */
    const zapr = (await wl('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: 'Ania' } })).json.token;
    const cz = klient();
    const przyjete = await cz('/api/zaproszenie', { metoda: 'POST', dane: { token: zapr, login: 'ania', haslo: 'haslo-ani-12345' } });
    const aniaId = przyjete.json.uzytkownik.id;
    await wl('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: aniaId, silniki: { openai: true } } });
    /* Na przyznanym silniku serwer podmienia model spoza listy na model właściciela,
       więc „zły klucz" jest na liście przyznanych (COSMOS_MODELE_PRZYZNANE). */
    const r2 = await czat(cz, 'openai', 'zly-klucz');
    ok(r2.kod === 502 && /Klucz właściciela/.test(r2.json.error || ''), `2. członek: „Klucz właściciela… daj mu znać" (${r2.kod}: …${(r2.json.error || '').slice(-80)})`);
    ok(!/\.env/.test(r2.json.error || ''), '2. członka nie odsyłamy do .env serwera');
    ok((await cz('/api/auth')).json.authed === true, '2. sesja członka żyje po błędzie dostawcy');

    /* ---- 3. 404: różne przyczyny, różne zdania ---- */
    const r3a = await czat(wl, 'openai', 'gpt-5-pro');
    ok(r3a.kod === 404 && /nie służy do rozmowy/.test(r3a.json.error || '') && r3a.json.trwaly === true,
      `3. „tylko Responses API" → ${r3a.kod}: …${(r3a.json.error || '').slice(-90)}`);
    const r3b = await czat(wl, 'openai', 'gpt-4.5-preview');
    ok(/wycofał/.test(r3b.json.error || ''), `3. model wycofany → „wycofał" (${(r3b.json.error || '').slice(-70)})`);
    ok(!/na Twoim koncie/.test((r3a.json.error || '') + (r3b.json.error || '')), '3. żadne z nich nie twierdzi „niedostępny na Twoim koncie"');

    /* ---- 4. Sonda modelu rozumującego ---- */
    const r4 = await wl('/api/models/check', { metoda: 'POST', dane: { endpoint: 'openai', model: 'gpt-5-mini' } });
    ok(r4.json.rozmowa === true, `4. „Sprawdź" gpt-5-mini → rozmowa ${r4.json.rozmowa} (${r4.json.blad || 'bez błędu'})`);

    /* ---- 5. Limit zapytań w sondzie ---- */
    limitZostalo = 1;
    const r5a = await wl('/api/models/check', { metoda: 'POST', dane: { endpoint: 'openai', model: 'raz-limit' } });
    ok(r5a.json.rozmowa === true, `5. jedno 429 → ponowienie i „działa" (${r5a.json.rozmowa}, ${r5a.json.blad || ''})`);
    const r5b = await wl('/api/models/check', { metoda: 'POST', dane: { endpoint: 'openai', model: 'zawsze-limit' } });
    ok(r5b.json.rozmowa === false && r5b.json.niepewne === true && r5b.json.rodzaj === 'limit',
      `5. ciągłe 429 → niepewne, rodzaj „limit" (${r5b.json.niepewne}, ${r5b.json.rodzaj})`);

    /* ---- 6. Lista modeli członka ---- */
    const listaCz = await cz('/api/models?endpoint=openai');
    const ids = (listaCz.json.data || []).map((m) => m.id).sort();
    ok(JSON.stringify(ids) === JSON.stringify(['gpt-4o', 'gpt-5-mini', 'zly-klucz']), `6. członek widzi tylko modele z listy właściciela (${ids.join(', ')})`);
    const listaWl = await wl('/api/models?endpoint=openai');
    ok((listaWl.json.data || []).length === 5, `6. właściciel widzi cały katalog (${(listaWl.json.data || []).length})`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    zabij(srv); atrapa.close();
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nBŁĘDY DOSTAWCY OK');
  process.exit(fail.length ? 1 : 0);
})();

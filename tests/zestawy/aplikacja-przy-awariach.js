/* Aplikacja w przeglądarce przy awariach, które zdarzają się naprawdę.

   Zespół IT, runda 5 – każdy punkt to coś, co człowiek widział na ekranie:
     1. Zły klucz dostawcy (serwer: 502 „klucz-dostawcy”, trwały) NIE pokazuje
        „Sesja wygasła”, a pod błędem jest „Ustawienia” zamiast „Ponów”.
     2. Pełny dysk przy zapisie rozmowy (507): pasek z przyczyną, a po
        „Spróbuj ponownie” rozmowa z odpowiedzią ląduje na serwerze.
     3. Wi-Fi zrywa się w trakcie odpowiedzi na dłużej niż pół sekundy: powrót
        do biegu, pełna odpowiedź – bez angielskiego „Failed to execute
        'getReader'…”.
     4. „Edytuj” to widoczny tryb z „Anuluj”; puste pole kończy edycję, więc
        nowe pytanie nie kasuje po cichu poprzedniej części rozmowy.
     5. „Sprawdź wszystkie” przy braku połączenia z silnikiem: jedna rada
        zamiast „Działa 0 z N”.
     6. Wylogowanie na wspólnym urządzeniu czyści instrukcję systemową
        poprzedniej osoby (funkcja w Node, bez przeglądarki).
*/
const { przegladarka, maPrzegladarke, serwerCosmosa, czekajNa, zabij } = require('../pomoc');
const { utworzKonta } = require('../../public/konta.js');

const PORT = 3505;
const S = `http://127.0.0.1:${PORT}`;
const problemy = [];
const ok = (warunek, opis) => { console.log(`${warunek ? 'OK ' : 'ZLE'} ${opis}`); if (!warunek) problemy.push(opis); };

/* ---- 6. Wspólne urządzenie – czysta funkcja ---- */
{
  const dane = new Map(Object.entries({
    'cosmos.settings': JSON.stringify({ systemPrompt: 'Mam cukrzycę typu 1.', modelOpenai: 'gpt-5', lang: 'pl', speak: true }),
    'cosmos.conv.abc': '{}', 'cosmos.ujecia.x': '[]', 'cosmos.bieg': '{}', 'cosmos.micId': 'mikrofon-1',
  }));
  const magazyn = {
    get length() { return dane.size; }, key: (i) => [...dane.keys()][i],
    getItem: (k) => (dane.has(k) ? dane.get(k) : null), setItem: (k, v) => dane.set(k, String(v)), removeItem: (k) => dane.delete(k),
  };
  const k = utworzKonta({ $: () => null, t: (x) => x });
  k.wyczyscPamiecOsoby(magazyn);
  const ust = JSON.parse(dane.get('cosmos.settings'));
  ok(!ust.systemPrompt && !ust.modelOpenai, `6. po zmianie osoby instrukcja i modele poprzedniej znikają (${JSON.stringify(ust)})`);
  ok(ust.lang === 'pl' && dane.get('cosmos.micId') === 'mikrofon-1', '6. ustawienia urządzenia (język, mikrofon) zostają');
  // Runda 8: czytanie na głos NIE zostaje – odpowiedzi nowej osoby czytałyby się na głos bez jej wiedzy.
  ok(ust.speak !== true, '6. czytanie na głos poprzedniej osoby wyłączone');
  ok(!dane.has('cosmos.ujecia.x') && !dane.has('cosmos.bieg'), '6. kadry i bieg poprzedniej osoby wyczyszczone');
}

if (!maPrzegladarke()) {
  console.log('POMINIĘTE (część przeglądarkowa): brak Chromium');
  process.exit(problemy.length ? 1 : 0);
}

const sse = (tekst) => `data: ${JSON.stringify({ choices: [{ delta: { content: tekst } }] })}\n\n`;

(async () => {
  const srv = serwerCosmosa(PORT, { SENSES_URL: 'http://127.0.0.1:1', LOCAL_BASE_URL: 'http://127.0.0.1:9/v1', LOCAL_MODEL: 'lokalny-test' });
  if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer testowy nie wstał');
  const b = await przegladarka();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const bledy = [];
  p.on('pageerror', (e) => bledy.push(e.message));
  await p.goto(`${S}/app`, { waitUntil: 'load' });
  await p.waitForFunction(() => typeof newConversation === 'function' && document.querySelectorAll('.endpoint-switch button').length > 0);

  const wyslij = async (tekst) => {
    await p.fill('#input', tekst);
    await p.press('#input', 'Enter');
  };
  const czekajNaKoniec = () => p.waitForFunction(() => document.getElementById('stop-btn').style.display === 'none', null, { timeout: 20000 }).catch(() => {});

  /* ---- 1. Zły klucz dostawcy ---- */
  await p.route('**/api/chat', (r) => r.fulfill({ status: 502, contentType: 'application/json',
    body: JSON.stringify({ error: '[Chmura NVIDIA · m] Incorrect API key.', kod: 'klucz-dostawcy', trwaly: true }) }));
  await p.evaluate(() => newConversation());
  await wyslij('pytanie przy złym kluczu');
  await czekajNaKoniec();
  const s1 = await p.evaluate(() => ({
    login: getComputedStyle(document.getElementById('login-overlay')).display !== 'none',
    przycisk: (document.querySelector('.msg-error .msg-ponow') || {}).textContent || '',
  }));
  ok(!s1.login, '1. zły klucz dostawcy nie pokazuje ekranu logowania');
  ok(/Ustawienia|Settings/.test(s1.przycisk) && !/Ponów|Retry/.test(s1.przycisk), `1. pod błędem trwałym „Ustawienia”, nie „Ponów” („${s1.przycisk}”)`);
  await p.unroute('**/api/chat');

  /* ---- 2. Pełny dysk przy zapisie ---- */
  await p.route('**/api/chat', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream',
    body: `${sse('Odpowiedź, która ma przetrwać.')}data: [DONE]\n\n` }));
  await p.route('**/api/conversations?id=*', (r) => (r.request().method() === 'PUT'
    ? r.fulfill({ status: 507, contentType: 'application/json', body: JSON.stringify({ error: 'Brak miejsca – limit 2 MB wyczerpany.' }) })
    : r.continue()));
  await p.evaluate(() => newConversation());
  await wyslij('pytanie przy pełnym dysku');
  await czekajNaKoniec();
  await p.waitForTimeout(800);
  const s2 = await p.evaluate(() => ({
    pasek: !document.getElementById('zapis-bar').hidden, powod: document.getElementById('zapis-powod').textContent, id: activeId,
  }));
  ok(s2.pasek && /limit/.test(s2.powod), `2. pasek „nie zapisano” z przyczyną od serwera („${s2.powod}”)`);
  await p.unroute('**/api/conversations?id=*');
  await p.evaluate(() => document.getElementById('zapis-retry').click());
  await p.waitForFunction(() => document.getElementById('zapis-bar').hidden, null, { timeout: 8000 }).catch(() => {});
  const naSerwerze = await (await fetch(`${S}/api/conversations?id=${encodeURIComponent(s2.id)}`)).json().catch(() => ({}));
  ok((naSerwerze.messages || []).some((m) => m.role === 'assistant' && /przetrwać/.test(m.content)),
    '2. „Spróbuj ponownie” zapisuje rozmowę z odpowiedzią na serwerze');
  await p.unroute('**/api/chat');

  /* ---- 3. Zerwane Wi-Fi w trakcie odpowiedzi ---- */
  let probPowrotu = 0;
  await p.route('**/api/chat', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream',
    body: `id: 0\n${sse('Pierwsza połowa, ')}` }));          // bez „koniec” – połączenie się urwało
  await p.route('**/api/chat/bieg?*', (r) => {
    probPowrotu++;
    if (probPowrotu <= 2) return r.abort('internetdisconnected');   // sieci jeszcze nie ma
    return r.fulfill({ status: 200, contentType: 'text/event-stream',
      body: `id: 1\n${sse('druga połowa.')}event: koniec\ndata: {}\n\n` });
  });
  await p.evaluate(() => newConversation());
  await wyslij('pytanie przy zrywanym Wi-Fi');
  await czekajNaKoniec();
  const s3 = await p.evaluate(() => activeConversation.messages.filter((m) => m.role === 'assistant').map((m) => m.content).join(' | '));
  ok(/Pierwsza połowa, druga połowa\./.test(s3) && !/getReader/.test(s3), `3. po przerwie w sieci pełna odpowiedź („${s3.slice(0, 80)}”, prób powrotu: ${probPowrotu})`);
  await p.unroute('**/api/chat/bieg?*');
  await p.unroute('**/api/chat');

  /* ---- 4. Tryb edycji ---- */
  await p.route('**/api/chat', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: `${sse('Odpowiedź.')}data: [DONE]\n\n` }));
  await p.evaluate(() => newConversation());
  await wyslij('pierwsze pytanie');
  await czekajNaKoniec();
  await p.evaluate(() => editFrom(0));
  const widac = await p.evaluate(() => !document.getElementById('edycja-bar').hidden);
  ok(widac, '4. „Edytuj” pokazuje pasek trybu edycji');
  await p.fill('#input', '');
  await p.dispatchEvent('#input', 'input');
  await p.fill('#input', 'zupełnie nowe pytanie');
  await p.press('#input', 'Enter');
  await czekajNaKoniec();
  const s4 = await p.evaluate(() => activeConversation.messages.filter((m) => m.role === 'user').map((m) => m.content));
  ok(s4.includes('pierwsze pytanie') && s4.includes('zupełnie nowe pytanie'),
    `4. wyczyszczenie pola kończy edycję – pierwsze pytanie zostaje (${JSON.stringify(s4)})`);
  await p.unroute('**/api/chat');

  /* ---- 5. Sprawdź wszystkie przy braku połączenia ---- */
  let sprawdzen = 0;
  await p.route('**/api/models/check', (r) => { sprawdzen++; return r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ rozmowa: false, siec: true, rodzaj: 'siec', blad: 'Brak połączenia', podpowiedz: 'Komputer domowy nie odpowiada.' }) }); });
  const s5 = await p.evaluate(async () => {
    const sel = document.getElementById('model-select-local');
    sel.innerHTML = ['a', 'b', 'c', 'd'].map((m) => `<option value="${m}">${m}</option>`).join('');
    await checkAllModels('local');
    return document.getElementById('model-info-local').textContent;
  });
  ok(sprawdzen === 1 && !/0 z 4|0 of 4/.test(s5) && /nie odpowiada/.test(s5),
    `5. brak połączenia przerywa „Sprawdź wszystkie” po pierwszym (${sprawdzen} zapytań; „${s5.slice(0, 70)}”)`);

  ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  await b.close();
  zabij(srv);
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nAPLIKACJA PRZY AWARIACH OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

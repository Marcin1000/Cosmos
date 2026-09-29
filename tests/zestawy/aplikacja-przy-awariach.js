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

   Runda 9:
     7. Pytanie, po którym był tylko błąd, nie skleja się z następnym („A\n\nB”)
        – ani w zwykłej rozmowie, ani w „Wyślij przez Chmurę”, które wysyła
        TYLKO ostatnie pytanie.
     8. „Wyślij przez Chmurę” pierwsze, w jednym wierszu z „Ponów”, bez znaków-
        emoji; jest też przy zimnym starcie i już w trakcie czekania (≥ 15 s)
        na lokalny model.
     9. Po angielsku błąd silnika Lokalnie jest po angielsku.
    10. Karta Ustawień: wolne /api/auth nie przestawia na „Zmysły” i nic nie
        zapisuje bez kliknięcia.
    11. Twarda spacja po jednoliterowym słowie na ekranie (PL), nie w t().
    12. Głos serwera zablokowany przez przeglądarkę: następna odpowiedź od
        razu głosem systemowym, bez kolejnego /api/tts.
    13. Linia wersji po aktualizacji w tle nie mówi „starsza” o NOWEJ pamięci.
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

/* ---- 11. Twarda spacja – czysta funkcja ---- */
{
  const { twardeSpacje, I18N } = require('../../public/i18n.js');
  const zle = Object.entries(I18N.pl).filter(([, v]) => /(^|\s)[aiouwz] /i.test(twardeSpacje(v))).map(([k]) => k);
  ok(!zle.length, `11. żadna wartość PL po twardeSpacje nie zostawia jednoliterowego słowa na końcu wiersza (${zle.slice(0, 5).join(', ') || 'brak'})`);
  ok(twardeSpacje('Napisz funkcję w Pythonie') === 'Napisz funkcję w\u00A0Pythonie', '11. „w Pythonie” z twardą spacją');
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

  /* ---- 6. Komputer w domu nie odpowiada → „Wyślij przez Chmurę” ----
     Prawdziwy serwer z martwym LOCAL_BASE_URL oddaje „lokalny-niedostepny”.
     Pod błędem jest jedno kliknięcie do chmury – bez samoczynnego przełączania
     (Marcin, runda 8). */
  const silniki6 = [];
  await p.route('**/api/chat', (r) => {
    const ep = JSON.parse(r.request().postData() || '{}').endpoint;
    silniki6.push(ep);
    if (ep === 'local') return r.continue();
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: `${sse('Odpowiedź z chmury.')}data: [DONE]\n\n` });
  });
  await p.evaluate(() => { newConversation(); setEndpoint('local'); });
  await wyslij('pytanie przy uśpionym komputerze');
  await czekajNaKoniec();
  const przycisk6 = await p.evaluate(() => (document.querySelector('.msg-error .msg-przez-chmure') || {}).textContent || '');
  ok(/Chmur|Cloud/.test(przycisk6) && silniki6.join() === 'local',
    `6. pod „komputer nie odpowiada” jest „Wyślij przez Chmurę”, nic nie poszło samo (${silniki6.join()}; „${przycisk6}”)`);
  await p.click('.msg-error .msg-przez-chmure');
  await czekajNaKoniec();
  await p.waitForFunction(() => /Odpowiedź z chmury/.test(document.getElementById('messages').textContent), null, { timeout: 8000 }).catch(() => {});
  const s6 = await p.evaluate(() => ({ tekst: document.getElementById('messages').textContent, silnik: endpoint, bledy: document.querySelectorAll('.msg-error').length }));
  ok(silniki6.join() === 'local,cloud' && /Odpowiedź z chmury/.test(s6.tekst) && s6.bledy === 0 && s6.silnik === 'cloud',
    `6. kliknięcie wysyła to samo pytanie do chmury i przełącza zakładkę (${silniki6.join()}, zakładka ${s6.silnik}, błędów ${s6.bledy})`);
  await p.unroute('**/api/chat');

  /* ---- 7. Pytanie bez odpowiedzi nie skleja się z następnym ---- */
  const api7 = await p.evaluate(() => toApiMessages({ messages: [
    { role: 'user', content: 'Pytanie A' }, { role: 'assistant', content: '⚠︎ błąd', error: true },
    { role: 'user', content: 'Pytanie B' },
  ] }).filter((m) => m.role === 'user').map((m) => m.content));
  ok(api7.length === 1 && api7[0] === 'Pytanie B', `7. po błędzie model dostaje tylko nowe pytanie (${JSON.stringify(api7)})`);
  const api7b = await p.evaluate(() => toApiMessages({ messages: [
    { role: 'user', content: 'Pytanie A' }, { role: 'assistant', content: 'Urywek odpowiedzi' },
    { role: 'assistant', content: '⚠︎ błąd', error: true }, { role: 'user', content: 'Pytanie B' },
  ] }).filter((m) => m.role === 'user').map((m) => m.content));
  ok(api7b.length === 2, `7. pytanie z urywkiem odpowiedzi zostaje w historii (${JSON.stringify(api7b)})`);

  const doChmury = [];
  await p.route('**/api/chat', (r) => {
    const cialo = JSON.parse(r.request().postData() || '{}');
    if (cialo.endpoint === 'local') return r.continue();
    doChmury.push(cialo.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : '')));
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: `${sse('Odpowiedź z chmury.')}data: [DONE]\n\n` });
  });
  await p.evaluate(() => { newConversation(); setEndpoint('local'); });
  await wyslij('Pytanie A o Kraków');
  await czekajNaKoniec();
  await wyslij('Pytanie B o Gdańsk');
  await czekajNaKoniec();
  const s8 = await p.evaluate(() => {
    const akcje = document.querySelector('.msg-error .msg-bledu-akcje');
    const przyciski = akcje ? [...akcje.querySelectorAll('button')] : [];
    const r = przyciski.map((x) => x.getBoundingClientRect().top);
    return {
      pierwszy: przyciski[0] ? przyciski[0].classList.contains('msg-przez-chmure') : false,
      ile: przyciski.length, jedenWiersz: r.length === 2 && Math.abs(r[0] - r[1]) <= 2,
      znaki: przyciski.map((x) => x.textContent).join('|'),
    };
  });
  ok(s8.pierwszy && s8.ile === 2, `8. „Wyślij przez Chmurę” jest pierwsze, obok „Ponów” (${s8.ile} przycisków)`);
  ok(!/[\u2190-\u27BF]/.test(s8.znaki), `8. przyciski pod błędem bez znaków-emoji („${s8.znaki}”)`);
  await p.click('.msg-error .msg-przez-chmure');
  await czekajNaKoniec();
  ok(doChmury.length === 1 && doChmury[0].length === 1 && doChmury[0][0] === 'Pytanie B o Gdańsk',
    `7. „Wyślij przez Chmurę” wysyła tylko ostatnie pytanie (${JSON.stringify(doChmury)})`);
  await p.unroute('**/api/chat');

  /* ---- 8. Zimny start ma przycisk ---- */
  await p.route('**/api/chat', (r) => r.fulfill({ status: 504, contentType: 'application/json',
    body: JSON.stringify({ error: 'Lokalny model dopiero się ładuje (Ollama) – spróbuj za chwilę.', kod: 'zimny-start' }) }));
  await p.evaluate(() => { newConversation(); setEndpoint('local'); });
  await wyslij('pytanie przy zimnym starcie');
  await czekajNaKoniec();
  ok(await p.evaluate(() => Boolean(document.querySelector('.msg-error .msg-przez-chmure'))), '8. przy zimnym starcie pod błędem jest „Wyślij przez Chmurę”');
  await p.unroute('**/api/chat');

  /* ---- 9. Po angielsku błąd Lokalnie po angielsku ---- */
  await p.route('**/api/chat', (r) => r.fulfill({ status: 502, contentType: 'application/json',
    body: JSON.stringify({ error: 'Komputer w domu nie odpowiada (http://100.1.2.3:11434/v1) – obudź go.', kod: 'lokalny-niedostepny', rodzaj: 'uspiony' }) }));
  await p.evaluate(() => { setLang('en'); newConversation(); setEndpoint('local'); });
  await wyslij('question while the home computer sleeps');
  await czekajNaKoniec();
  const s9 = await p.evaluate(() => {
    const b = document.querySelector('.msg-error .msg-content');
    if (!b) return { tekst: '', szczegol: '' };
    const kopia = b.cloneNode(true);
    kopia.querySelectorAll('button, .msg-bledu-akcje').forEach((x) => x.remove());
    return { tekst: kopia.textContent, szczegol: b.title };
  });
  ok(s9.tekst && !/[ąćęłńóśźż]/i.test(s9.tekst) && /Cloud/.test(s9.tekst), `9. po angielsku błąd Lokalnie po angielsku („${s9.tekst.slice(0, 90)}”)`);
  ok(/100\.1\.2\.3/.test(s9.szczegol), '9. zdanie serwera (szczegół) zostaje w podpowiedzi');
  await p.evaluate(() => setLang('pl'));
  await p.unroute('**/api/chat');

  /* ---- 8. Przycisk chmury już w trakcie czekania na lokalny ---- */
  const silniki8 = [];
  await p.route('**/api/chat', async (r) => {
    const cialo = JSON.parse(r.request().postData() || '{}');
    silniki8.push(cialo.endpoint);
    if (cialo.endpoint === 'local') {
      await new Promise((x) => setTimeout(x, 25000));      // model się ładuje, nagłówków nie ma
      return r.abort().catch(() => {});
    }
    return r.fulfill({ status: 200, contentType: 'text/event-stream', body: `${sse('Odpowiedź z chmury.')}data: [DONE]\n\n` });
  });
  await p.evaluate(() => { newConversation(); setEndpoint('local'); });
  await wyslij('pytanie przy ładującym się modelu');
  const przycisk8 = await p.waitForSelector('.wait-przez-chmure', { timeout: 20000 }).catch(() => null);
  ok(Boolean(przycisk8), '8. po ~15 s czekania na lokalny w notce jest „Wyślij przez Chmurę”');
  if (przycisk8) {
    await p.click('.wait-przez-chmure');
    await p.waitForFunction(() => /Odpowiedź z chmury/.test(document.getElementById('messages').textContent), null, { timeout: 10000 }).catch(() => {});
    await czekajNaKoniec();
    const s8b = await p.evaluate(() => ({
      role: activeConversation.messages.map((m) => (m.error ? 'blad' : m.role)).join(','), silnik: endpoint,
    }));
    ok(silniki8.join() === 'local,cloud' && s8b.role === 'user,assistant' && s8b.silnik === 'cloud',
      `8. kliknięcie w trakcie czekania: to samo pytanie do chmury, jedno pytanie i jedna odpowiedź (${silniki8.join()}; ${s8b.role}; ${s8b.silnik})`);
  }
  await p.unroute('**/api/chat');

  /* ---- 10. Karta Ustawień przy wolnym /api/auth ---- */
  await p.route(/\/api\/(konto|konta|auth)/, async (r) => { await new Promise((x) => setTimeout(x, 450)); r.continue().catch(() => {}); });
  for (const zapamietana of ['konto', null]) {
    await p.evaluate((z) => { if (z) localStorage.setItem('cosmos.kartaUstawien', z); else localStorage.removeItem('cosmos.kartaUstawien'); }, zapamietana);
    await p.reload({ waitUntil: 'load' });
    await p.waitForSelector('.app.gotowa', { timeout: 10000 });
    await p.evaluate(() => document.getElementById('settings-btn').click());
    await p.waitForTimeout(1500);
    const s10 = await p.evaluate(() => ({
      wybrana: document.querySelector('#settings-modal .set-karty [aria-selected="true"]')?.dataset.cel,
      zapisana: localStorage.getItem('cosmos.kartaUstawien'),
    }));
    ok(s10.wybrana === 'konto' && s10.zapisana === zapamietana,
      `10. zapamiętana „${zapamietana}”, wolne /api/auth → pokazana „${s10.wybrana}”, zapisana „${s10.zapisana}”`);
  }
  await p.unroute(/\/api\/(konto|konta|auth)/);

  /* ---- 11. Na ekranie twarda spacja, w t() – nie ---- */
  const s11 = await p.evaluate(() => ({ ekran: document.querySelector('[data-i18n="sug2"]')?.textContent || '', t: t('sug2') }));
  ok(s11.ekran.includes('\u00A0') && !s11.t.includes('\u00A0'), `11. podpowiedź na ekranie z twardą spacją, t() bez (${JSON.stringify(s11)})`);

  /* ---- 12. Głos serwera zablokowany ---- */
  let tts = 0;
  await p.route('**/api/tts', (r) => { tts++; return r.fulfill({ status: 200, contentType: 'audio/wav', body: Buffer.alloc(2000) }); });
  const s12 = await p.evaluate(async () => {
    serverConfig.glos = { ...(serverConfig.glos || {}), ttsChmura: true };
    HTMLMediaElement.prototype.play = function () { return Promise.reject(new DOMException('zablokowane', 'NotAllowedError')); };
    let systemowy = 0;
    speechSynthesis.speak = (u) => { systemowy++; setTimeout(() => u.onend && u.onend(), 20); };
    const dlugi = 'Pierwsze zdanie odpowiedzi jest krótkie. ' + 'Dalej idzie dłuższy akapit, który trafi do drugiej porcji czytania. '.repeat(6);
    await speakText(dlugi);
    const poPierwszej = systemowy;
    return { poPierwszej, dlugi };
  });
  const ttsPoPierwszej = tts;
  const s12b = await p.evaluate(async (dlugi) => {
    let systemowy = 0;
    const start = performance.now();
    let pierwszy = null;
    speechSynthesis.speak = (u) => { systemowy++; if (pierwszy === null) pierwszy = performance.now() - start; setTimeout(() => u.onend && u.onend(), 20); };
    await speakText(dlugi);
    return { systemowy, pierwszy };
  }, s12.dlugi);
  ok(s12.poPierwszej > 0 && ttsPoPierwszej <= 2, `12. zablokowany dźwięk: głos systemowy przeczytał odpowiedź (${s12.poPierwszej} części), /api/tts ${ttsPoPierwszej}`);
  ok(tts === ttsPoPierwszej && s12b.systemowy > 0 && s12b.pierwszy < 100,
    `12. następna odpowiedź bez /api/tts (${tts - ttsPoPierwszej}) i od razu głosem systemowym (${Math.round(s12b.pierwszy)} ms)`);
  await p.evaluate(() => document.dispatchEvent(new Event('pointerdown')));
  ok(await p.evaluate(() => glosSerweraZablokowany === false), '12. dotknięcie znosi blokadę – następna odpowiedź znów spróbuje głosu serwera');
  await p.unroute('**/api/tts');

  /* ---- 13. Linia wersji po aktualizacji w tle ---- */
  await p.route('**/api/config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ wersja: { commit: 'nowy', pamiec: 'cosmos-v999-nowa' } }) }));
  const s13 = await p.evaluate(async () => {
    for (const k of await caches.keys()) await caches.delete(k);
    await caches.open('cosmos-v999-nowa');
    serverConfig.wersja = { commit: 'stary', pamiec: 'cosmos-v998-stara' };
    await pokazWersje();
    const poAktualizacji = document.getElementById('set-wersja').textContent;
    serverConfig.wersja = { commit: 'nowy', pamiec: 'cosmos-v999-nowa' };
    await pokazWersje();
    const poOdswiezeniu = document.getElementById('set-wersja').textContent;
    await caches.delete('cosmos-v999-nowa');
    return { poAktualizacji, poOdswiezeniu };
  });
  ok(!/starsz/.test(s13.poAktualizacji.replace(/ta karta ma jeszcze starszą/, '')) && /odśwież/.test(s13.poAktualizacji) && /cosmos-v999-nowa/.test(s13.poAktualizacji),
    `13. po aktualizacji w tle: „${s13.poAktualizacji}”`);
  ok(!/starsz|odśwież/.test(s13.poOdswiezeniu), `13. po odświeżeniu bez „starsza” („${s13.poOdswiezeniu}”)`);
  await p.unroute('**/api/config');

  ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  await b.close();
  zabij(srv);
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nAPLIKACJA PRZY AWARIACH OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

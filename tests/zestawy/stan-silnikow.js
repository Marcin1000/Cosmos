/* Stan silników w /api/status (kontrakt K1, runda 10).
 *
 * Marcin: „kropka w prawym górnym rogu przy modelu lokalnym nie zmienia koloru
 * – powinna być niebieska". Lokalny model odpowiadał, a plakietka mówiła
 * „offline", bo jedyne sprawdzenie – GET /models z terminem 5 s i tylko 2xx –
 * padało przy pośredniku bez tej trasy (404), przy Ollamie liczącej listę
 * modeli z uśpionego dysku i przy pierwszym pakiecie przez Tailscale. Udana
 * odpowiedź modelu niczego nie zmieniała.
 *
 * Każdy przypadek na własnym serwerze (wynik jest pamiętany 10 s na silnik,
 * więc jeden serwer nie przełączy się między trybami atrapy):
 *   1. lokalny odpowiada 200 → online, bez powodu; trzy równoległe sprawdzenia
 *      i czwarte zaraz po nich → JEDNO zapytanie do domu (pamięć 10 s),
 *      chmura z odrzuconym kluczem → offline z powodem „klucz",
 *   2. lokalny: 404 na /models (pośrednik) → online; chmura milczy dłużej
 *      niż 5 s → „nie wiadomo" (null) z powodem „termin", nie offline,
 *   3. /models milczy, /api/version (Ollama) odpowiada → online w ~2 s,
 *   4. /models milczy, zapasowe próby też nie → null, „termin", po ~8 s,
 *   5. /models 500 i zapasowe 404 → offline, „http-500",
 *   6. /models 502, /health (vLLM, llama.cpp) 200 → online,
 *   7. lokalny odrzuca klucz (401) → offline, „klucz",
 *   8. nikt nie słucha na porcie → offline, „odmowa",
 *   9. /models odpowiada po 6,5 s → online (termin lokalnego 8 s, nie 5),
 *  10. /models milczy, a czat lokalny działa: przed czatem „nie wiadomo",
 *      po udanej odpowiedzi od razu online (źródło „czat"), bez pytania domu. */
const http = require('node:http');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT_ATRAPY = 7581;
const PORT_ZAMKNIETY = 7589;   // nikt tu nie słucha
const problemy = [];
const ok = (w, opis) => { console.log(`${w ? 'OK ' : 'ZLE'} ${opis}`); if (!w) problemy.push(opis); };

/* Atrapa silników: pierwszy człon ścieżki to tryb. `/<tryb>/v1/models`,
   `/<tryb>/api/version`, `/<tryb>/health`, `/<tryb>/v1/chat/completions`. */
const licznik = {};   // „tryb ścieżka” → ile zapytań
const atrapa = http.createServer((req, res) => {
  const [, tryb, ...reszta] = req.url.split('?')[0].split('/');
  const sciezka = `/${reszta.join('/')}`;
  licznik[`${tryb} ${sciezka}`] = (licznik[`${tryb} ${sciezka}`] || 0) + 1;
  const json = (kod, o) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  const lista = { data: [{ id: 'model-testowy' }] };
  if (sciezka === '/v1/chat/completions') {
    let b = '';
    return req.on('data', (c) => { b += c; }).on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Cześć z domu.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  }
  if (sciezka === '/v1/models') {
    if (tryb === 'ok' || tryb === 'chmura-ok') return json(200, lista);
    if (tryb === 'nie404') return json(404, { error: 'not found' });
    if (tryb === 'blad500') return json(500, { error: 'boom' });
    if (tryb === 'brama502') { res.writeHead(502); return res.end(); }
    if (tryb === 'klucz' || tryb === 'chmura-klucz') return json(401, { error: 'invalid api key' });
    if (tryb === 'wolno65') return setTimeout(() => json(200, lista), 6500);
    if (tryb === 'chmura-wolno') return setTimeout(() => { if (!res.destroyed) json(200, lista); }, 7000);
    return;   // wolno, wolno-zapas, wolno-czat: milczy
  }
  if (sciezka === '/api/version' && tryb === 'wolno-zapas') return json(200, { version: '0.12.0' });
  if (sciezka === '/health' && tryb === 'brama502') return json(200, { status: 'ok' });
  return json(404, { error: 'not found' });
});

const A = (tryb) => `http://127.0.0.1:${PORT_ATRAPY}/${tryb}/v1`;
const SERWERY = [
  // port, lokalny, chmura
  [3581, A('ok'), A('chmura-klucz')],
  [3582, A('nie404'), A('chmura-wolno')],
  [3583, A('wolno-zapas'), A('chmura-ok')],
  [3584, A('wolno'), A('chmura-ok')],
  [3585, A('blad500'), A('chmura-ok')],
  [3586, A('brama502'), A('chmura-ok')],
  [3587, A('klucz'), A('chmura-ok')],
  [3588, `http://127.0.0.1:${PORT_ZAMKNIETY}/v1`, A('chmura-ok')],
  [3591, A('wolno65'), A('chmura-ok')],
  [3592, A('wolno-czat'), A('chmura-ok')],
];

async function status(port) {
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(20_000) });
  return { ...(await r.json()), czas: Date.now() - t0 };
}
const opis = (s) => (s ? `online=${s.online} powod=${s.powod}${s.zrodlo ? ` zrodlo=${s.zrodlo}` : ''}` : 'brak pola');

(async () => {
  await new Promise((r) => atrapa.listen(PORT_ATRAPY, '127.0.0.1', r));
  const procesy = SERWERY.map(([port, lokalny, chmura]) => serwerCosmosa(port, {
    LOCAL_BASE_URL: lokalny, LOCAL_MODEL: 'model-testowy', NEMOTRON_BASE_URL: chmura,
    SENSES_URL: `http://127.0.0.1:${PORT_ZAMKNIETY}`,
  }));
  try {
    const wstaly = await Promise.all(SERWERY.map(([port]) => czekajNa(`http://127.0.0.1:${port}/api/auth`)));
    if (wstaly.some((w) => !w)) throw new Error('któryś serwer testowy nie wstał');

    // Sprawdzenia równolegle – najdłuższe trwa ok. 8 s.
    const [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10przed] = await Promise.all([
      Promise.all([status(3581), status(3581), status(3581)]),
      status(3582), status(3583), status(3584), status(3585), status(3586), status(3587), status(3588), status(3591),
      status(3592),
    ]);

    // 1. 200 → online; pamięć 10 s i jedno sprawdzenie naraz
    ok(s1.every((s) => s.local && s.local.online === true && s.local.powod === ''), `1. lokalny 200 → online (${opis(s1[0].local)})`);
    const s1b = await status(3581);
    ok(licznik['ok /v1/models'] === 1, `1. trzy równoległe i czwarte sprawdzenie → jedno zapytanie do domu (${licznik['ok /v1/models']})`);
    ok(s1b.local && s1b.local.online === true, '1. czwarte sprawdzenie z pamięci – dalej online');
    ok(s1[0].cloud && s1[0].cloud.online === false && s1[0].cloud.powod === 'klucz', `1. chmura z odrzuconym kluczem → offline, „klucz" (${opis(s1[0].cloud)})`);

    // 2. 404 pośrednika = żyje; termin chmury = nie wiadomo
    ok(s2.local && s2.local.online === true, `2. lokalny: 404 na /models → online (${opis(s2.local)})`);
    ok(s2.cloud && s2.cloud.online === null && s2.cloud.powod === 'termin', `2. chmura milczy > 5 s → null, „termin" (${opis(s2.cloud)})`);

    // 3. zapasowa próba Ollamy
    ok(s3.local && s3.local.online === true && s3.czas < 5000, `3. /models milczy, /api/version 200 → online w ${s3.czas} ms (${opis(s3.local)})`);
    ok(licznik['wolno-zapas /api/version'] === 1, `3. zapasowa próba poszła (${licznik['wolno-zapas /api/version'] || 0})`);

    // 4. termin to nie offline
    ok(s4.local && s4.local.online === null && s4.local.powod === 'termin', `4. /models i zapasowe milczą → null, „termin" (${opis(s4.local)})`);
    ok(s4.czas >= 7000 && s4.czas < 11_000, `4. termin lokalnego ok. 8 s (${s4.czas} ms)`);

    // 5–8
    ok(s5.local && s5.local.online === false && s5.local.powod === 'http-500', `5. /models 500, zapasowe 404 → offline, „http-500" (${opis(s5.local)})`);
    ok(s6.local && s6.local.online === true, `6. /models 502, /health 200 → online (${opis(s6.local)})`);
    ok(s7.local && s7.local.online === false && s7.local.powod === 'klucz', `7. lokalny odrzuca klucz → offline, „klucz" (${opis(s7.local)})`);
    ok(s8.local && s8.local.online === false && s8.local.powod === 'odmowa', `8. zamknięty port → offline, „odmowa" (${opis(s8.local)})`);

    // 9. termin 8 s, nie 5
    ok(s9.local && s9.local.online === true, `9. /models po 6,5 s → online (${opis(s9.local)}, ${s9.czas} ms)`);

    // 10. udana odpowiedź = online przez 2 min, bez pytania domu
    ok(s10przed.local && s10przed.local.online === null, `10. przed czatem: /models milczy → nie wiadomo (${opis(s10przed.local)})`);
    const r = await fetch('http://127.0.0.1:3592/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'local', useSenses: false, useMemory: false, useKb: false, useSearch: false,
        messages: [{ role: 'user', content: 'hej' }] }),
      signal: AbortSignal.timeout(20_000),
    });
    const odp = await r.text();
    ok(r.status === 200 && /Cześć z domu/.test(odp), `10. czat lokalny działa (${r.status})`);
    const przed = licznik['wolno-czat /v1/models'] || 0;
    const s10po = await status(3592);
    ok(s10po.local && s10po.local.online === true && s10po.local.zrodlo === 'czat' && s10po.czas < 1500,
      `10. po udanej odpowiedzi → online od razu (${opis(s10po.local)}, ${s10po.czas} ms)`);
    ok((licznik['wolno-czat /v1/models'] || 0) === przed, '10. bez nowego zapytania do domu');
  } finally {
    procesy.forEach(zabij);
    atrapa.close();
  }
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nSTAN SILNIKÓW OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

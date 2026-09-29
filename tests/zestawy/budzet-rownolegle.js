/* Budżet w złotówkach poza zespołem: zwykły czat i wywołania pomocnicze
   pod obciążeniem, restart i uczciwe „wydano” (etap 5, paczka B1).

   Zespół IT (etap 5) pokazał, że samo pytanie „czy budżet już wyczerpany”
   przepuszcza równoległe żądania: 20 kart członka z limitem 0,50 zł wydało
   na kluczu właściciela 44,40 zł, 10 streszczeń – 15 zł. Gwarancje:

     1. czat równolegle: osiem i więcej żądań naraz członka z małym limitem –
        wydane ≤ limit + jedno wywołanie, do dostawcy idzie tyle żądań, ile
        dostało 200, reszta 429 `budzet-wyczerpany`; rezerwacje wracają do 0,
     2. llmComplete równolegle (/api/summarize): to samo; odmowa to 429
        z kodem, nie 502 „nie powiodło się”,
     3. zdarzenie `koniec` biegu niesie koszt odpowiedzi (`kosztZl`), bez
        usage od dostawcy z flagą `kosztSzacowany`; Stop też kosztuje
        i nie zostawia rezerwacji,
     4. llmComplete bez usage liczy wejście z wiadomości (nie 0),
     5. wywołanie pomocnicze członka bez dostępu do Claude'a idzie do Chmury:
        zapisane pod Chmurą, bez złotówek – nie jako „Claude” z kwotą,
     6. restart (SIGTERM) w trakcie płatnej odpowiedzi nie gubi jej kosztu;
        kill -9 kilka sekund po odpowiedzi też nie (zapis zł po ~3 s),
     7. `budzet.stan()`: „wydano dziś / w miesiącu” zawsze z tego samego
        zakresu (wszystko), kwoty w limicie właściciela osobno.

   Własny serwer (3571) i własna atrapa dostawcy (3572): zużycie w atrapie
   jest realistyczne – wejście z długości wiadomości, wyjście = pełne
   max_tokens – więc koszt nigdy nie przekracza szacunku rezerwacji. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3571;
const PORT_MODELU = 3572;
const ADRES = `http://127.0.0.1:${PORT}`;
const HASLO = 'haslo-wlasciciela-budzet-2026';
const KLUCZ_NVIDIA = 'klucz-nvidia-budzet-0001';
const KLUCZ_CLAUDE = 'sk-ant-wlasciciela-budzet-0001';

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const pauza = (ms) => new Promise((r) => setTimeout(r, ms));

// --- atrapa dostawcy: liczy żądania, oddaje realistyczne usage ----------------
const zapytania = [];
const atrapa = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [] }));
    }
    let d = {};
    try { d = JSON.parse(body); } catch { /* */ }
    const tekst = JSON.stringify(d.messages || []);
    zapytania.push({ klucz: (req.headers.authorization || req.headers['x-api-key'] || '').replace(/^Bearer /, ''), model: d.model });
    const bezUsage = /BEZ-USAGE/.test(tekst);
    if (/BLAD-500/.test(tekst)) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'awaria atrapy', type: 'api_error' } }));
    }
    const wolno = /WOLNO/.test(tekst) ? 1800 : 0;
    const usage = { prompt_tokens: Math.ceil(tekst.length / 3.5), completion_tokens: Number(d.max_tokens) || 1000 };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    if (d.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Odpowiedź ' } }] })}\n\n`);
      if (wolno) await pauza(wolno);
      if (res.destroyed) return;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'gotowa.' }, finish_reason: 'stop' }] })}\n\n`);
      if (!bezUsage && d.stream_options && d.stream_options.include_usage) {
        res.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
      }
      return res.end('data: [DONE]\n\n');
    }
    if (wolno) await pauza(wolno);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'Streszczenie gotowe.' }, finish_reason: 'stop' }], ...(bezUsage ? {} : { usage }) }));
  });
});

function klient(ip) {
  let ciastko = '';
  return {
    async zadaj(sciezka, { metoda = 'GET', dane } = {}) {
      const r = await fetch(`${ADRES}${sciezka}`, {
        method: metoda,
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(ciastko ? { Cookie: ciastko } : {}) },
        body: dane === undefined ? undefined : JSON.stringify(dane),
      });
      const sc = r.headers.get('set-cookie');
      if (sc) ciastko = sc.split(';')[0];
      const tekst = await r.text();
      let json = {};
      try { json = JSON.parse(tekst); } catch { /* strumień albo tekst */ }
      return { kod: r.status, json, tekst };
    },
  };
}
/** Zdarzenie `koniec` ze strumienia biegu. */
const koniecBiegu = (tekst) => {
  const m = String(tekst).match(/event: koniec\ndata: (.*)\n/);
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
};

const katalogDanych = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-budzet-rownolegle-'));
const ENV = {
  COSMOS_DATA_DIR: katalogDanych,
  COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin',
  NVIDIA_API_KEY: KLUCZ_NVIDIA,
  NEMOTRON_BASE_URL: `http://127.0.0.1:${PORT_MODELU}/v1`,
  NEMOTRON_MODEL: 'atrapa-nvidia',
  ANTHROPIC_API_KEY: KLUCZ_CLAUDE,
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT_MODELU}/v1`,
  CLAUDE_MODEL: 'claude-sonnet-5',
  COSMOS_CZAS_NA_DOKONCZENIE_MS: '8000',
};
let srv = null;
async function wstan() {
  srv = serwerCosmosa(PORT, ENV);
  if (!(await czekajNa(`${ADRES}/api/auth`))) throw new Error('serwer nie wstał');
}
/** Zatrzymaj serwer sygnałem i poczekaj na koniec procesu. */
async function zatrzymaj(sygnal) {
  const p = srv;
  const koniec = new Promise((r) => { if (p.exitCode !== null) r(); else p.once('exit', r); });
  try { process.kill(-p.pid, sygnal); } catch { /* już nie żyje */ }
  await Promise.race([koniec, pauza(20000)]);
  zabij(p);
}

(async () => {
  // --- 7. Spójne „wydano” (moduł, bez serwera) ------------------------------------
  {
    const { utworzBudzet } = require(path.join(__dirname, '..', '..', 'lib', 'budzet.js'));
    const konta = {
      limityBudzetu: () => ({ wlasny: { dzien: 0, miesiac: 0 }, odWlasciciela: { dzien: 0, miesiac: 5 } }),
      wydaneZl: () => ({ dzis: { wlasciciel: 1, wlasny: 50 }, miesiac: { wlasciciel: 4, wlasny: 60 } }),
    };
    const st = utworzBudzet({ konta, cennik: { kurs: () => 3.7 } }).stan({ id: 'x' });
    ok(st.wydanoDzis === 51 && st.wydanoMiesiac === 64,
      `7a. „wydano” dziś i w miesiącu z jednego zakresu – wszystko (${st.wydanoDzis} / ${st.wydanoMiesiac}, nie 51 / 4)`);
    ok(st.wydanoNaKluczuWlascicielaDzis === 1 && st.wydanoNaKluczuWlascicielaMiesiac === 4
      && st.wydanoWLimicieMiesiac === 4 && st.wydanoWLimicieDzis === null && st.zostaloMiesiac === 1,
      `7b. kwoty na kluczach właściciela i w limicie osobno, „zostało” z limitu (${JSON.stringify(st)})`);
  }

  await new Promise((r) => atrapa.listen(PORT_MODELU, '127.0.0.1', r));
  await wstan();

  const marcin = klient('10.2.0.1');
  await marcin.zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
  async function czlonek(nazwa, ip) {
    const zap = await marcin.zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa } });
    const k = klient(ip);
    const przyj = await k.zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token: zap.json.token, login: nazwa.toLowerCase(), haslo: `haslo-${nazwa}-12345` } });
    if (przyj.kod !== 200) throw new Error(`nie udało się założyć konta ${nazwa}: ${przyj.tekst}`);
    k.id = przyj.json.uzytkownik.id;
    return k;
  }
  const LIMIT = 0.3;
  const ania = await czlonek('Ania', '10.2.0.2');
  const bartek = await czlonek('Bartek', '10.2.0.3');
  const cezary = await czlonek('Cezary', '10.2.0.4');
  for (const k of [ania, bartek]) {
    await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: k.id, silniki: { claude: true } } });
    await marcin.zadaj('/api/konta/budzet', { metoda: 'PUT', dane: { id: k.id, dzien: LIMIT } });
  }
  const stan = async (k) => (await k.zadaj('/api/konto')).json.budzet || {};
  const zuzycieOsoby = async (id) => ((((await marcin.zadaj('/api/konta')).json.uzytkownicy || []).find((u) => u.id === id) || {}).zuzycie || {});

  // --- 1. Czat: 10 żądań naraz przy małym limicie ------------------------------------
  zapytania.length = 0;
  const N = 10;
  const odp = await Promise.all(Array.from({ length: N }, (_, i) => ania.zadaj('/api/chat', { metoda: 'POST',
    dane: { endpoint: 'claude', bieg: `biegbudzetrown${String(i).padStart(2, '0')}`, messages: [{ role: 'user', content: `WOLNO płatne pytanie ${i}` }] } })));
  const przeszlo = odp.filter((r) => r.kod === 200).length;
  const odmow = odp.filter((r) => r.kod === 429 && r.json.kod === 'budzet-wyczerpany').length;
  const kosztyCzatu = odp.map((r) => (r.kod === 200 ? (koniecBiegu(r.tekst) || {}).kosztZl || 0 : 0));
  const najdrozszy = Math.max(0, ...kosztyCzatu);
  const s1 = await stan(ania);
  ok(przeszlo >= 1 && przeszlo + odmow === N && zapytania.length === przeszlo,
    `1a. ${N} czatów naraz: ${przeszlo} × 200, ${odmow} × 429 budzet-wyczerpany, do dostawcy ${zapytania.length} żądań`);
  ok(s1.wydanoDzis > 0 && s1.wydanoDzis <= LIMIT + najdrozszy + 1e-4,
    `1b. wydane ≤ limit + jedno wywołanie (${s1.wydanoDzis} ≤ ${LIMIT} + ${najdrozszy})`);
  ok(s1.zarezerwowano === 0, `1c. po wszystkich odpowiedziach bez wiszących rezerwacji (${s1.zarezerwowano})`);

  // --- 2. llmComplete: 10 streszczeń naraz ---------------------------------------------
  zapytania.length = 0;
  const dlugi = 'Ala ma kota, a kot ma Alę. '.repeat(1100);
  const odp2 = await Promise.all(Array.from({ length: N }, (_, i) => bartek.zadaj('/api/summarize', { metoda: 'POST',
    dane: { endpoint: 'claude', text: `WOLNO ${i} ${dlugi}` } })));
  const przeszlo2 = odp2.filter((r) => r.kod === 200).length;
  const odmowy2 = odp2.filter((r) => r.kod !== 200);
  const s2 = await stan(bartek);
  const jedno2 = s2.wydanoDzis / Math.max(1, przeszlo2);
  ok(przeszlo2 >= 1 && zapytania.length === przeszlo2 && odmowy2.length === N - przeszlo2,
    `2a. ${N} streszczeń naraz: ${przeszlo2} × 200, do dostawcy ${zapytania.length} żądań`);
  ok(odmowy2.length > 0 && odmowy2.every((r) => r.kod === 429 && r.json.kod === 'budzet-wyczerpany' && /budżet/i.test(r.json.error || '')),
    `2b. odmowa budżetu w streszczeniu to 429 z kodem, nie 502 (${[...new Set(odmowy2.map((r) => r.kod))].join(',')})`);
  ok(s2.wydanoDzis > 0 && s2.wydanoDzis <= LIMIT + jedno2 + 1e-4 && s2.zarezerwowano === 0,
    `2c. wydane ≤ limit + jedno wywołanie, rezerwacje zwolnione (${s2.wydanoDzis} ≤ ${LIMIT} + ${jedno2.toFixed(4)}; rez. ${s2.zarezerwowano})`);
  const polish = await bartek.zadaj('/api/polish', { metoda: 'POST', dane: { endpoint: 'claude', text: 'popraw to' } });
  ok(polish.kod === 429 && polish.json.kod === 'budzet-wyczerpany', `2d. dopracowanie promptu przy wyczerpanym budżecie → 429 (${polish.kod})`);

  // --- 3. Koszt w zdarzeniu `koniec`, Stop -------------------------------------------------
  const c1 = await marcin.zadaj('/api/chat', { metoda: 'POST', dane: { endpoint: 'claude', bieg: 'biegbudzetkoszt01', messages: [{ role: 'user', content: 'ile to kosztuje' }] } });
  const k1 = koniecBiegu(c1.tekst) || {};
  ok(c1.kod === 200 && k1.kosztZl > 0 && !k1.kosztSzacowany, `3a. „koniec” biegu niesie koszt z usage (${JSON.stringify(k1)})`);
  const c2 = await marcin.zadaj('/api/chat', { metoda: 'POST', dane: { endpoint: 'claude', bieg: 'biegbudzetkoszt02', messages: [{ role: 'user', content: 'BEZ-USAGE ile to kosztuje' }] } });
  const k2 = koniecBiegu(c2.tekst) || {};
  ok(c2.kod === 200 && k2.kosztZl > 0 && k2.kosztSzacowany === true, `3b. bez usage – koszt z szacunku, z flagą (${JSON.stringify(k2)})`);
  const przedStop = (await stan(marcin)).wydanoDzis;
  const wToku = marcin.zadaj('/api/chat', { metoda: 'POST', dane: { endpoint: 'claude', bieg: 'biegbudzetstop01', messages: [{ role: 'user', content: 'WOLNO przerwę to' }] } });
  await pauza(700);
  await marcin.zadaj('/api/chat/stop', { metoda: 'POST', dane: { bieg: 'biegbudzetstop01' } });
  await wToku;
  await pauza(200);
  const poStop = await stan(marcin);
  ok(poStop.wydanoDzis > przedStop && poStop.zarezerwowano === 0,
    `3c. Stop: przerwana odpowiedź kosztuje, rezerwacja zwolniona (${przedStop} → ${poStop.wydanoDzis}; rez. ${poStop.zarezerwowano})`);

  // Dostawca odmówił przed strumieniem (czat i streszczenie) – rezerwacja wraca, nic nie zapisane.
  const przedBlad = await stan(marcin);
  const b1 = await marcin.zadaj('/api/chat', { metoda: 'POST', dane: { endpoint: 'claude', bieg: 'biegbudzetblad01', messages: [{ role: 'user', content: 'BLAD-500 proszę' }] } });
  const b2 = await marcin.zadaj('/api/summarize', { metoda: 'POST', dane: { endpoint: 'claude', text: 'BLAD-500 streść' } });
  const poBlad = await stan(marcin);
  ok(b1.kod >= 500 && b2.kod === 502 && poBlad.zarezerwowano === 0 && Math.abs(poBlad.wydanoDzis - przedBlad.wydanoDzis) < 1e-9,
    `3d. odmowa dostawcy: rezerwacje czatu i streszczenia zwolnione, bez kosztu (${b1.kod}/${b2.kod}; rez. ${poBlad.zarezerwowano})`);

  // --- 4. llmComplete bez usage: wejście z wiadomości ------------------------------------
  const przed4 = (await stan(marcin)).wydanoDzis;
  const sum4 = await marcin.zadaj('/api/summarize', { metoda: 'POST', dane: { endpoint: 'claude', text: `BEZ-USAGE ${dlugi}` } });
  const po4 = (await stan(marcin)).wydanoDzis;
  /* Szacunek bez usage = 1,5 × (wejście + wyjście + myślenie Sonneta 5, 2000 tok.): samo myślenie
     z wyjściem to ~0,11 zł, wejście (~10 tys. tokenów × 2 USD / mln × 3,70 × 1,5) dokłada ~0,11 zł.
     Dawniej wejście liczone jako 0 – wtedy wychodziło ~0,11 zł. */
  ok(sum4.kod === 200 && po4 - przed4 > 0.18, `4. streszczenie bez usage liczy wejście (${(po4 - przed4).toFixed(4)} zł > 0,18)`);

  // --- 5. Podmiana na Chmurę: bez „Claude” z kwotą ------------------------------------------
  zapytania.length = 0;
  const sum5 = await cezary.zadaj('/api/summarize', { metoda: 'POST', dane: { endpoint: 'claude', text: 'krótki tekst do streszczenia' } });
  const z5 = await zuzycieOsoby(cezary.id);
  const sil5 = (z5.silniki || {}).dzisiaj || {};
  ok(sum5.kod === 200 && zapytania.length === 1 && zapytania[0].klucz === KLUCZ_NVIDIA,
    `5a. członek bez dostępu do Claude'a – streszczenie idzie do Chmury (${zapytania.map((z) => z.klucz).join(',')})`);
  ok(!(sil5.claude && sil5.claude.wywolan) && sil5.cloud && sil5.cloud.wywolan >= 1 && !((z5.zl || {}).dzis > 0),
    `5b. zapisane pod Chmurą, bez złotówek (${JSON.stringify(sil5)}; zł ${JSON.stringify(z5.zl && z5.zl.dzis)})`);

  // --- 6. Restart w oknie zamykania i kill -9 po odpowiedzi -----------------------------
  const przed6 = (await stan(marcin)).wydanoDzis;
  const wToku6 = marcin.zadaj('/api/chat', { metoda: 'POST', dane: { endpoint: 'claude', bieg: 'biegbudzetrestart1', messages: [{ role: 'user', content: 'WOLNO odpowiedz w trakcie restartu' }] } })
    .catch((e) => ({ kod: 0, tekst: String(e) }));
  await pauza(600);
  await zatrzymaj('SIGTERM');
  const r6 = await wToku6;
  const k6 = koniecBiegu(r6.tekst) || {};
  await wstan();
  await marcin.zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
  const po6 = (await stan(marcin)).wydanoDzis;
  ok(k6.kosztZl > 0 && Math.abs(po6 - przed6 - k6.kosztZl) < 2e-4,
    `6a. SIGTERM w trakcie płatnej odpowiedzi: po restarcie jej koszt jest w „wydano” (${przed6} + ${k6.kosztZl} → ${po6})`);
  const c7 = await marcin.zadaj('/api/chat', { metoda: 'POST', dane: { endpoint: 'claude', bieg: 'biegbudzetkill9a', messages: [{ role: 'user', content: 'zaraz kill -9' }] } });
  const k7 = koniecBiegu(c7.tekst) || {};
  await pauza(3800);
  await zatrzymaj('SIGKILL');
  await wstan();
  await marcin.zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
  const po7 = (await stan(marcin)).wydanoDzis;
  ok(k7.kosztZl > 0 && Math.abs(po7 - po6 - k7.kosztZl) < 2e-4,
    `6b. kill -9 kilka sekund po odpowiedzi: koszt już na dysku (${po6} + ${k7.kosztZl} → ${po7})`);

  zabij(srv);
  atrapa.close();
  try { fs.rmSync(katalogDanych, { recursive: true, force: true }); } catch { /* */ }
  console.log(fail.length ? `\n${fail.length} ŹLE` : '\nwszystko ok');
  process.exit(fail.length ? 1 : 0);
})().catch((err) => {
  console.error('ŹLE – wyjątek:', err);
  zabij(srv);
  process.exit(1);
});

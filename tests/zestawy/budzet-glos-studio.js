/* Budżet w złotówkach poza czatem: głos, przepisywanie nagrań i Studio.
 *
 * Po co: płatne źródła głosu (OpenAI, ElevenLabs) i Studio (obrazy, lektor,
 * wideo) szły na kluczach właściciela poza budżetem. Członek po wyczerpaniu
 * limitu dalej przepisywał, czytał na głos i generował obrazy na rachunek
 * właściciela, a wydatki nie trafiały do zużycia (zespół IT, etap 5). Do tego
 * cennik liczył każdy gpt-5.x ceną gpt-5 z sierpnia 2025 – nowsze, droższe wersje
 * wychodziły za tanio. Ten zestaw pilnuje:
 *
 *   1. cennik gpt-5.x: znane wersje (5.1, 5.2, 5.4, mini/nano/pro) z ceną z pamięci;
 *      nieznana gpt-N.M → najdroższa znana GŁÓWNA wersja (nie gpt-5); warianty
 *      z wariantów; ostrzeżenie w dzienniku raz na model; `stan()` mówi o cenach
 *      zgadniętych,
 *   2. `kosztUslugiZl` (kontrakt C4): stt – sekundy, tts/dzwiek – znaki, obraz –
 *      sztuki z rozmiarem, wideo – sekundy z rozdzielczością; COSMOS_CENNIK
 *      nadpisuje usługi (pewne: true), nieznany model – ostrożnie (najdrożej),
 *   3. głos (lib/glos.js) na prawdziwych kontach i budżecie:
 *      a) rozpoznawanie i czytanie liczą koszt do zużycia osoby (OpenAI pod
 *         'openai', ElevenLabs pod 'studio'), czas nagrania od dostawcy,
 *      b) wyczerpany budżet → płatne źródło pominięte: rozpoznawanie 502
 *         `stt-trwaly` z `powod: budzet-wyczerpany` (przeglądarka od razu na
 *         własne), czytanie schodzi na zmysły albo 502 (głos systemowy),
 *      c) własny klucz osoby – limit od właściciela go nie dotyczy,
 *      d) równoległe czytania przy budżecie na dwa – do dostawcy idą najwyżej dwa
 *         (rezerwacja, nie samo „czy wyczerpany”),
 *   4. przepisywanie nagrania do bazy wiedzy przy wyczerpanym budżecie – czytelny
 *      powód w pozycji, bez wywołania chmury,
 *   5. Studio (lib/studio.js):
 *      a) obraz, lektor i wideo liczą koszt do zużycia (obraz – za sztukę),
 *      b) wyczerpany budżet → 429 `budzet-wyczerpany` dla obrazu, storyboardu,
 *         edycji, lektora i wideo – bez wywołania dostawcy,
 *      c) praca, która w całości się nie mieści (4 warianty przy budżecie na 2),
 *         dostaje 429 od razu,
 *      d) żadna rezerwacja nie wisi – także gdy zadanie nie ruszyło (za dużo naraz).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.COSMOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-budzet-glos-studio-'));
delete process.env.COSMOS_CENNIK;
delete process.env.COSMOS_KURS_USD_PLN;

const R = path.join(__dirname, '..', '..', 'lib');
const { utworzCennik } = require(path.join(R, 'cennik.js'));
const { utworzBudzet } = require(path.join(R, 'budzet.js'));
const konta = require(path.join(R, 'konta.js'));
const { utworz: utworzGlos } = require(path.join(R, 'glos.js'));
const { sendJson, readBodyBuffer, readJson, STUDIO } = require(path.join(R, 'rdzen.js'));
const { wKontekscie } = require(path.join(R, 'kontekst.js'));
const studio = require(path.join(R, 'studio.js'));
const { utworzZadania } = require(path.join(R, 'zadania.js'));

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const blisko = (a, b) => Math.abs(a - b) < 1e-4;

/* Atrapa dostawców: OpenAI (audio, obrazy), ElevenLabs, Seedance, zmysły. */
const wywolania = [];
let elevenMs = 0;
let obrazMs = 0;
let zmyslyZywe = false;
const PNG = Buffer.from('iVBORw0KGgo=', 'base64');
const atrapa = http.createServer((req, res) => {
  const cialo = [];
  req.on('data', (c) => cialo.push(c));
  req.on('end', () => {
    const url = req.url.split('?')[0];
    wywolania.push({ url, tresc: Buffer.concat(cialo).toString('latin1') });
    const json = (kod, d) => { res.writeHead(kod, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (url === '/oa/v1/audio/transcriptions') return json(200, { text: 'Dzień dobry.', usage: { type: 'duration', seconds: 30 } });
    if (url === '/oa/v1/audio/speech') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end('MP3-OA'); }
    if (url === '/oa/v1/images/generations' || url === '/oa/v1/images/edits') {
      return setTimeout(() => json(200, { data: [{ b64_json: PNG.toString('base64') }] }), obrazMs);
    }
    if (url.startsWith('/el/v1/text-to-speech/')) {
      return setTimeout(() => { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end('MP3-EL'); }, elevenMs);
    }
    if (url === '/sd/contents/generations/tasks') return json(200, { id: `zad-${wywolania.length}` });
    if (url === '/zm/health') return zmyslyZywe ? json(200, { piper: true }) : (res.writeHead(503), res.end());
    if (url === '/zm/tts') { res.writeHead(200, { 'Content-Type': 'audio/wav' }); return res.end('WAV-ZM'); }
    res.writeHead(404); return res.end();
  });
});
const ile = (przedrostek) => wywolania.filter((w) => w.url.startsWith(przedrostek)).length;

(async () => {
  // --- 1. Cennik gpt-5.x ----------------------------------------------------------------
  const ostrzezenia = [];
  const warn = console.warn;
  console.warn = (...a) => ostrzezenia.push(a.join(' '));
  const c = utworzCennik({ env: {} });
  const cena = (m) => c.ceny(m, 'openai');
  const g5 = cena('gpt-5');
  const g52 = cena('gpt-5.2');
  const g54 = cena('gpt-5.4');
  ok(g52.zrodlo === 'katalog' && g52.we > g5.we && g52.wy > g5.wy && !g52.pewne, `gpt-5.2 ma własną cenę, wyższą niż gpt-5 (${g52.we}/${g52.wy}), z pamięci`);
  ok(g54.zrodlo === 'katalog' && g54.we >= g52.we && g54.wy >= g52.wy, `gpt-5.4 z katalogu (${g54.we}/${g54.wy})`);
  ok(cena('gpt-5.1').zrodlo === 'katalog' && cena('gpt-5.4-mini').zrodlo === 'katalog' && cena('gpt-5.2-pro').zrodlo === 'katalog',
    'znane warianty: gpt-5.1, gpt-5.4-mini, gpt-5.2-pro');
  const g53 = cena('gpt-5.3');
  const g6 = cena('gpt-6');
  const glowne = ['gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5.4'].map(cena);
  ok(g53.zrodlo === 'domysl' && glowne.every((x) => g53.we >= x.we && g53.wy >= x.wy),
    `nieznana gpt-5.3 → najdroższa znana główna wersja, nie gpt-5 (${g53.we}/${g53.wy})`);
  ok(g6.we >= g54.we && g6.wy >= g54.wy, `gpt-6 → nie taniej niż najdroższa znana (${g6.we}/${g6.wy})`);
  const m53 = cena('gpt-5.3-mini');
  ok(m53.wy >= cena('gpt-5.4-mini').wy && m53.wy < g53.wy, `gpt-5.3-mini → najdroższy znany mini, taniej niż pełna wersja (${m53.we}/${m53.wy})`);
  const p56 = cena('gpt-5.6-pro');
  ok(p56.wy >= cena('gpt-5.4-pro').wy && p56.wy >= cena('gpt-5.2-pro').wy, `gpt-5.6-pro → najdroższy znany pro (${p56.wy})`);
  const codex = cena('gpt-5-codex');
  ok(codex.we === g5.we && codex.wy === g5.wy, `„gpt-5-coś” bez numeru wersji – dalej jak gpt-5 (${codex.we}/${codex.wy})`);
  cena('gpt-5.3'); cena('gpt-5.3');
  ok(ostrzezenia.filter((o) => o.includes('gpt-5.3”')).length === 1, `ostrzeżenie o cenie zgadniętej raz na model (${ostrzezenia.filter((o) => o.includes('gpt-5.3”')).length})`);
  ok(!ostrzezenia.some((o) => /gpt-5\.2”|gpt-5”/.test(o)), 'znany model – bez ostrzeżenia');
  const st = c.stan();
  ok(st.saZgadniete === true && st.zgadniete.some((z) => z.model === 'gpt-5.3') && st.openai.pewne === false && st.openai.stan !== '2025-08-07',
    `stan(): ceny zgadnięte i data cennika OpenAI (${JSON.stringify({ openai: st.openai, n: st.zgadniete.length })})`);
  const czysty = utworzCennik({ env: {} });
  czysty.ceny('gpt-5.4', 'openai'); czysty.ceny('claude-opus-5-5', 'claude');
  ok(czysty.stan().saZgadniete === false && czysty.stan().claude.pewne === true, 'same znane modele – stan bez cen zgadniętych');

  // --- 1b. Cache wejścia OpenAI ---------------------------------------------------------
  const bezCache = c.kosztZl('gpt-5', 'openai', { we: 20000, wy: 500 });
  const zCache = c.kosztZl('gpt-5', 'openai', { we: 20000, wy: 500, cache: 18000 });
  const oczekCache = Math.round(((2000 * 1.25 + 18000 * 1.25 * 0.1 + 500 * 10) / 1e6) * 3.7 * 1e4) / 1e4;
  ok(blisko(zCache, oczekCache) && zCache < bezCache, `gpt-5: 18 tys. z 20 tys. wejścia z cache ceną 0,1 (${zCache} zł, bez cache ${bezCache})`);
  ok(c.mnoznikCache('gpt-5.4-mini') === 0.1 && c.mnoznikCache('gpt-4.1') === 0.25 && c.mnoznikCache('o4-mini') === 0.25
    && c.mnoznikCache('gpt-4o-2024-08-06') === 0.5, 'mnożniki cache: gpt-5* 0,1; gpt-4.1/o3/o4-mini 0,25; gpt-4o 0,5');
  ok(c.kosztZl('claude-sonnet-5', 'claude', { we: 20000, wy: 500, cache: 18000 }) === c.kosztZl('claude-sonnet-5', 'claude', { we: 20000, wy: 500 }),
    'Claude przez warstwę zgodną – cache pełną ceną (ostrożnie)');
  ok(c.kosztZl('gpt-5', 'openai', { we: 1000, wy: 0, cache: 5000 }) === c.kosztZl('gpt-5', 'openai', { we: 1000, wy: 0, cache: 1000 }),
    'cache większy niż wejście – przycięty do wejścia');

  // --- 2. kosztUslugiZl -----------------------------------------------------------------
  const k = (...a) => c.kosztUslugiZl(...a);
  const stt60 = k('stt', 'gpt-4o-mini-transcribe', 60);
  ok(stt60.pewne === false && stt60.zl > 0 && blisko(k('stt', 'gpt-4o-mini-transcribe', 120).zl, 2 * stt60.zl), `stt: koszt rośnie z sekundami (${stt60.zl} zł za minutę)`);
  ok(k('stt', 'whisper-1', 60).zl >= stt60.zl, 'whisper-1 nie taniej niż mini-transcribe');
  const tts = k('tts', 'gpt-4o-mini-tts', 1000);
  ok(tts.zl > 0 && blisko(k('tts', 'gpt-4o-mini-tts', 2000).zl, 2 * tts.zl), `tts: koszt ze znaków (${tts.zl} zł za 1000)`);
  ok(k('tts', 'eleven_flash_v2_5', 1000).zl > 0 && k('dzwiek', 'eleven_multilingual_v2', 1000).zl >= k('tts', 'eleven_flash_v2_5', 1000).zl,
    'ElevenLabs: szybki model rozmowy nie droższy niż lektor Studia');
  const o1 = k('obraz', 'gpt-image-1@1024x1024', 1).zl;
  const o2 = k('obraz', 'gpt-image-1@1536x1024', 1).zl;
  ok(o1 > 0 && o2 > o1 && blisko(k('obraz', 'gpt-image-1@1024x1024', 3).zl, 3 * o1), `obraz: za sztukę, większy droższy (${o1} / ${o2} zł)`);
  const w720 = k('wideo', 'seedance-2-0@720p', 5).zl;
  ok(w720 > 0 && k('wideo', 'seedance-2-0@1080p', 5).zl > w720, `wideo: sekundy i rozdzielczość (${w720} zł za 5 s 720p)`);
  const obcy = k('obraz', 'nieznany-generator', 1);
  ok(obcy.zrodlo === 'domysl' && obcy.zl >= o2, `nieznany model usługi – ostrożnie, najdrożej (${obcy.zl})`);
  ok(k('nic', 'x', 5).zl === 0, 'nieznany rodzaj usługi – 0, bez wyjątku');
  const cE = utworzCennik({ env: { COSMOS_CENNIK: '{"gpt-image-1": {"obraz": 0.04}, "seedance-2-0*": {"wideo": 0.1}, "gpt-5.5*": [2, 15]}' } });
  const oE = cE.kosztUslugiZl('obraz', 'gpt-image-1@1536x1024', 2);
  ok(oE.pewne === true && oE.zrodlo === 'env' && blisko(oE.zl, 2 * 0.04 * 3.7), `COSMOS_CENNIK nadpisuje cenę obrazu (${JSON.stringify(oE)})`);
  ok(blisko(cE.kosztUslugiZl('wideo', 'seedance-2-0@1080p', 5).zl, 0.5 * 3.7), 'COSMOS_CENNIK: przedrostek z „*” dla wideo');
  ok(cE.ceny('gpt-5.5-mini', 'openai').we === 2 && cE.ceny('gpt-image-1', 'openai').zrodlo !== 'env',
    'wpis samych usług nie zmienia cen tokenów, a tokeny z [we, wy] działają dalej');
  ok(!c.darmowy('studio'), "silnik zużycia 'studio' jest płatny (ElevenLabs, Seedance, Firefly)");
  console.warn = warn;

  // --- 3. Głos na prawdziwych kontach i budżecie ------------------------------------------
  await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${atrapa.address().port}`;
  konta.ustawCennik(c);
  await konta.zapewnijWlasciciela({ login: 'marcin' });
  const nowy = async (login) => {
    const { token } = konta.utworzZaproszenie({ nazwa: login, przez: 'wlasciciel' });
    return (await konta.przyjmijZaproszenie(token, { login, haslo: `haslo-${login}-12345` })).id;
  };
  const idA = await nowy('ania');
  const idB = await nowy('bartek');
  const budzet = utworzBudzet({ konta, cennik: c });
  const EP = { baseUrl: `${A}/oa/v1`, apiKey: 'klucz-oa' };
  let wlasnyKlucz = false;
  const silniki = {
    dostep: (n, u) => (n !== 'openai' ? { ok: false }
      : { ok: true, ep: EP, zrodlo: u.rola === 'wlasciciel' ? 'wlasciciel' : wlasnyKlucz ? 'wlasny' : 'przyznany' }),
    studioDozwolone: () => true,
    zmyslyDozwolone: () => true,
  };
  Object.assign(STUDIO.eleven, { key: 'klucz-el', base: `${A}/el`, voice: 'g1', model: 'eleven_multilingual_v2' });
  let ktoTeraz = konta.znajdz(idA);
  const kto = () => ktoTeraz;
  const zrobGlos = (env = {}) => utworzGlos({
    SENSES_URL: `${A}/zm`, silniki, kto, sendJson, readBodyBuffer, readJson, STUDIO, env: { GLOS_TTS: 'elevenlabs,openai,zmysly', ...env },
    zmysly: { fetch: (s, init) => fetch(`${A}/zm${s}`, init), zrodlo: () => 'dom', stanAgenta: () => null },
    budzet, cennik: c, konta,
  });
  let glos = zrobGlos();
  const serwerGlosu = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    const g = glos;
    return wKontekscie(ktoTeraz, () => (p === '/api/stt' ? g.handleStt(req, res) : g.handleTts(req, res)));
  });
  await new Promise((r) => serwerGlosu.listen(0, '127.0.0.1', r));
  const S = `http://127.0.0.1:${serwerGlosu.address().port}`;
  const sttZ = () => fetch(`${S}/api/stt?jezyk=pl`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.alloc(9000, 1) });
  const ttsZ = (text) => fetch(`${S}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, jezyk: 'pl' }) });
  const zlSilnika = (id, s) => ((konta.zuzycieOsoby(id).silniki.dzisiaj[s] || {}).zl || 0);
  const wydano = (id) => konta.zuzycieOsoby(id).zl.dzis;

  konta.ustawBudzet(idA, { dzien: 5 });
  // a) koszt do zużycia
  let r = await sttZ();
  let d = await r.json();
  const oczekSTT = c.kosztUslugiZl('stt', 'gpt-4o-mini-transcribe', 30).zl;
  ok(r.status === 200 && d.zrodlo === 'openai', `STT członka z przyznanym OpenAI → OpenAI (${r.status})`);
  ok(blisko(zlSilnika(idA, 'openai'), oczekSTT), `STT: koszt z czasu podanego przez dostawcę (30 s) pod 'openai' (${zlSilnika(idA, 'openai')} / ${oczekSTT})`);
  const tekst1000 = 'a'.repeat(1000);
  r = await ttsZ(tekst1000);
  ok(r.status === 200 && r.headers.get('x-glos-zrodlo') === 'elevenlabs', `TTS → ElevenLabs (${r.status})`);
  const oczekTTS = c.kosztUslugiZl('tts', 'eleven_flash_v2_5', 1000).zl;
  ok(blisko(zlSilnika(idA, 'studio'), oczekTTS), `TTS ElevenLabs: koszt za znaki pod 'studio' (${zlSilnika(idA, 'studio')} / ${oczekTTS})`);
  ok(budzet._rezerwacji() === 0, 'po głosie nie wisi żadna rezerwacja');

  // b) wyczerpany budżet od właściciela
  konta.zanotujZuzycie(idA, { silnik: 'claude', zrodlo: 'przyznany', model: 'claude-opus-5-5', zl: 5 });
  wywolania.length = 0;
  r = await sttZ();
  d = await r.json();
  ok(r.status === 502 && d.kod === 'stt-trwaly' && d.powod === 'budzet-wyczerpany' && d.limit === 'wlasciciel',
    `STT po wyczerpaniu → 502 stt-trwaly, powód budżet (${r.status} ${JSON.stringify(d).slice(0, 120)})`);
  ok(ile('/oa/') === 0, 'STT po wyczerpaniu nie trafiło do OpenAI');
  const przedTts = wydano(idA);
  r = await ttsZ('Dzień dobry.');
  ok(r.status === 502 && ile('/el/') === 0 && ile('/oa/') === 0, `TTS po wyczerpaniu: bez ElevenLabs i OpenAI → 502 = głos systemowy (${r.status})`);
  zmyslyZywe = true;
  glos = zrobGlos();   // świeży stan zmysłów (pamięć 30 s)
  r = await ttsZ('Dzień dobry.');
  ok(r.status === 200 && r.headers.get('x-glos-zrodlo') === 'zmysly' && ile('/el/') === 0, `TTS po wyczerpaniu schodzi na zmysły (${r.headers.get('x-glos-zrodlo')})`);
  ok(blisko(wydano(idA), przedTts), 'odmówione źródła nic nie dopisały do wydatków');
  zmyslyZywe = false;
  glos = zrobGlos();

  // c) własny klucz – limit od właściciela go nie dotyczy
  wlasnyKlucz = true;
  wywolania.length = 0;
  r = await sttZ();
  ok(r.status === 200 && ile('/oa/') === 1, `własny klucz członka: STT działa mimo wyczerpanego limitu od właściciela (${r.status})`);
  konta.ustawBudzet(idA, { dzien: 0.01 }, { wlasny: true });
  wywolania.length = 0;
  r = await sttZ();
  ok(r.status === 502 && ile('/oa/') === 0, `…ale własny limit osoby obowiązuje także na własnym kluczu (${r.status})`);
  wlasnyKlucz = false;

  // d) równoległe czytania przy budżecie na dwa
  ktoTeraz = konta.znajdz(idB);
  const naDwa = Math.round((2.5 * oczekTTS) * 1e4) / 1e4;
  konta.ustawBudzet(idB, { dzien: naDwa });
  elevenMs = 300;
  wywolania.length = 0;
  const rownolegle = await Promise.all(Array.from({ length: 6 }, () => ttsZ(tekst1000)));
  const doEleven = ile('/el/');
  ok(doEleven <= 2, `6 czytań naraz przy budżecie na 2: do ElevenLabs poszło ${doEleven} (kody ${rownolegle.map((x) => x.status).join(',')})`);
  ok(wydano(idB) <= naDwa + 1e-9, `wydatki nie przebiły limitu (${wydano(idB)} ≤ ${naDwa})`);
  ok(budzet._rezerwacji() === 0, 'po równoległych czytaniach nie wisi żadna rezerwacja');
  elevenMs = 0;

  // --- 4. Przepisywanie nagrania do bazy wiedzy ---------------------------------------------
  ktoTeraz = konta.znajdz(idA);
  const kb = require(path.join(R, 'baza-wiedzy.js')).utworz({
    U: () => ({ kbItems: [], katalog: process.env.COSMOS_DATA_DIR }), readJson, readBodyBuffer, sendJson, bladZapisu: () => {},
    addEvent: () => {}, embedTexts: async () => null, stripTags: (x) => x, czytelnyTekst: (x) => x, SENSES_URL: '',
    fetchZmyslow: null, zmyslyDostepne: () => false, przepiszMowe: (...a) => glos.przepisz(...a),
    budzet, cennik: c, konta,
  });
  wywolania.length = 0;
  const info = {};
  const tekstNagrania = await wKontekscie(ktoTeraz, () => kb.extractKbText('spotkanie.webm', 'audio/webm', Buffer.alloc(9000, 2), { info }));
  ok(tekstNagrania === '' && /budżet/.test(info.przyczyna || '') && ile('/oa/') === 0,
    `nagranie w bazie wiedzy przy wyczerpanym budżecie: bez chmury, powód w pozycji („${info.przyczyna}”)`);

  // --- 5. Studio -----------------------------------------------------------------------------
  Object.assign(STUDIO.openai, { key: 'klucz-oa', base: `${A}/oa/v1`, imageModel: 'gpt-image-1' });
  Object.assign(STUDIO.seedance, { key: 'klucz-sd', base: `${A}/sd`, model: 'seedance-2-0' });
  let nr = 0;
  const zadania = utworzZadania({ czekajMs: 3000, naraz: 1 });
  studio.polacz({
    kbPliki: () => process.env.COSMOS_DATA_DIR, addEvent: () => {},
    kbAddFile: async (name, mime) => ({ id: `kb${++nr}`, name, mime }), kbItemMeta: (i) => i, kbPozycje: () => [],
    zadania, budzet, cennik: c, konta,
  });
  fs.writeFileSync(path.join(process.env.COSMOS_DATA_DIR, 'obrazzrodlo'), PNG);
  const serwerStudia = http.createServer((req, res) => wKontekscie(ktoTeraz,
    () => studio.handleStudio(req, res, new URL(req.url, 'http://x').pathname)));
  await new Promise((rr) => serwerStudia.listen(0, '127.0.0.1', rr));
  const SS = `http://127.0.0.1:${serwerStudia.address().port}`;
  const post = async (p, dane) => {
    const odp = await fetch(`${SS}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dane) });
    return { kod: odp.status, json: await odp.json().catch(() => ({})) };
  };

  const idC = await nowy('celina');
  ktoTeraz = konta.znajdz(idC);
  konta.ustawBudzet(idC, { dzien: 20 });
  // a) koszt do zużycia
  wywolania.length = 0;
  let o = await post('/api/studio/image', { prompt: 'lis w śniegu', size: '1536x1024', count: 2 });
  const oczekObraz = 2 * c.kosztUslugiZl('obraz', 'gpt-image-1@1536x1024', 1).zl;
  ok(o.kod === 200 && ile('/oa/v1/images/generations') === 2, `obraz: 2 warianty wygenerowane (${o.kod})`);
  ok(blisko(zlSilnika(idC, 'openai'), oczekObraz), `obraz: koszt za sztukę pod 'openai' (${zlSilnika(idC, 'openai')} / ${oczekObraz})`);
  o = await post('/api/studio/speech', { text: 'b'.repeat(500) });
  const oczekLektor = c.kosztUslugiZl('dzwiek', 'eleven_multilingual_v2', 500).zl;
  ok(o.kod === 200 && blisko(zlSilnika(idC, 'studio'), oczekLektor), `lektor: koszt za znaki pod 'studio' (${zlSilnika(idC, 'studio')} / ${oczekLektor})`);
  o = await post('/api/studio/video', { prompt: 'fale', duration: 5, resolution: '720p' });
  const oczekWideo = c.kosztUslugiZl('wideo', 'seedance-2-0@720p', 5).zl;
  ok(o.kod === 200 && blisko(zlSilnika(idC, 'studio'), oczekLektor + oczekWideo), `wideo: koszt przy przyjęciu zadania (${zlSilnika(idC, 'studio')})`);
  ok(budzet._rezerwacji() === 0, 'po pracach Studia nie wisi żadna rezerwacja');

  // c) praca, która w całości się nie mieści
  const zostalo = budzet.stan(ktoTeraz, { naKluczuWlasciciela: true }).zostaloDzis;
  const cena1 = c.kosztUslugiZl('obraz', 'gpt-image-1@1024x1024', 1).zl;
  konta.ustawBudzet(idC, { dzien: Math.round((20 - zostalo + 2.5 * cena1) * 1e4) / 1e4 });
  wywolania.length = 0;
  o = await post('/api/studio/image', { prompt: 'cztery warianty', size: '1024x1024', count: 4 });
  ok(o.kod === 429 && o.json.kod === 'budzet-wyczerpany' && ile('/oa/') === 0, `4 warianty przy budżecie na 2,5 → 429 od razu, bez dostawcy (${o.kod})`);

  // d) zadanie nie ruszyło (za dużo naraz) – rezerwacja wraca
  konta.ustawBudzet(idC, { dzien: 50 });
  obrazMs = 600;
  const pierwsze = post('/api/studio/image', { prompt: 'pierwszy', size: '1024x1024' });
  await new Promise((rr) => setTimeout(rr, 150));
  const drugie = await post('/api/studio/image', { prompt: 'drugi', size: '1024x1024' });
  await pierwsze;
  obrazMs = 0;
  ok(drugie.kod === 429 && !drugie.json.kod, `drugie zadanie przy limicie 1 naraz → 429 „za dużo naraz” (${drugie.kod})`);
  ok(budzet._rezerwacji() === 0, 'zadanie, które nie ruszyło, nie zostawiło rezerwacji');

  // b) wyczerpany budżet
  konta.zanotujZuzycie(idC, { silnik: 'claude', zrodlo: 'przyznany', model: 'claude-opus-5-5', zl: 50 });
  wywolania.length = 0;
  const odmowy = [
    ['obraz', await post('/api/studio/image', { prompt: 'lis', size: '1024x1024' })],
    ['storyboard', await post('/api/studio/storyboard', { scene: 'poranek w porcie', shots: 3 })],
    ['edycja', await post('/api/studio/edit', { prompt: 'dodaj ptaka', imageId: 'obrazzrodlo' })],
    ['lektor', await post('/api/studio/speech', { text: 'Dzień dobry.' })],
    ['wideo', await post('/api/studio/video', { prompt: 'fale', duration: 5 })],
  ];
  for (const [co, x] of odmowy) {
    ok(x.kod === 429 && x.json.kod === 'budzet-wyczerpany' && x.json.limit === 'wlasciciel' && /budżet/.test(x.json.blad || ''),
      `Studio po wyczerpaniu: ${co} → 429 budzet-wyczerpany (${x.kod})`);
  }
  ok(wywolania.length === 0, `po wyczerpaniu żadne żądanie Studia nie poszło do dostawcy (${wywolania.map((w) => w.url).join(', ')})`);

  serwerGlosu.close();
  serwerStudia.close();
  atrapa.close();
  konta.zapiszZalegle();
  if (fail.length) {
    console.log(`\nNIEZDANE (${fail.length}):\n - ${fail.join('\n - ')}`);
    process.exit(1);
  }
  console.log('\nWszystko zdane.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });

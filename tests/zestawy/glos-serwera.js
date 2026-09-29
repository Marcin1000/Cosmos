/* Głos na serwerze: rozpoznawanie i czytanie z łańcuchem źródeł (lib/glos.js).
 *
 * Po co: tryb głosowy bez piszczenia mikrofonu działał tylko z Whisperem
 * w zmysłach. Bez komputera domowego telefon wracał do Web Speech API, a Android
 * kwituje dźwiękiem każdy start i koniec rozpoznawania. Teraz serwer ma dokąd
 * wysłać nagranie – i to musi być prawda w każdym z tych przypadków:
 *
 *   1. zmysły wyłączone + klucz OpenAI → rozpoznanie idzie do OpenAI, z językiem
 *      i podpowiedzią pisowni „Cosmos"; /api/config zgłasza sttChmura,
 *   2. nasłuch otoczenia (`tryb=nasluch`) NIGDY nie trafia do chmury,
 *   3. czytanie: ElevenLabs pierwsze (szybki model rozmowy), przy jego awarii
 *      OpenAI – a przy braku wszystkiego 502, żeby przeglądarka wzięła głos
 *      systemowy,
 *   4. gość bez prawa do OpenAI i Studia nie dostaje płatnego głosu właściciela,
 *   5. zmysły z Whisperem mają pierwszeństwo przed chmurą (lokalnie, za darmo),
 *   6. własny serwer rozpoznawania (STT_BASE_URL): w internecie nie dostaje
 *      nasłuchu otoczenia, a gość bez przyznań nie korzysta z niego na klucz
 *      właściciela,
 *   7. koniec środków / zły klucz → kod `stt-trwaly` (przeglądarka od razu na
 *      własne rozpoznawanie, zamiast gubić trzy wypowiedzi),
 *   8. `przepisz()` – ten sam łańcuch dla nagrań w bazie wiedzy bez zmysłów,
 *   9. wspólny termin łańcucha: wiszące zmysły i wiszący własny serwer w domu nie
 *      zjadają 2 × 60 s – OpenAI odpowiada, zanim Cloudflare odda 524,
 *  10. klient odszedł → płatna chmura nie dostaje zlecenia (rozpoznawanie i czytanie),
 *  11. zmysły bez Whispera (501) + odrzucony klucz → `stt-trwaly`, nie „spróbuj jeszcze raz”,
 *  12. własny serwer STT z 404 `{detail}` → zdanie o własnym serwerze (nie o chmurze),
 *      treść `detail` w dzienniku,
 *  13. nagranie z bazy wiedzy (`tryb: 'plik'`): whisper-1, bez podpowiedzi „Hej, Cosmos.”,
 *      opus jako .ogg. */
const http = require('node:http');
const { utworz } = require('../../lib/glos.js');
const { sendJson, readBodyBuffer, readJson } = require('../../lib/rdzen.js');

const problemy = [];
const ok = (warunek, opis) => {
  console.log(`${warunek ? 'OK ' : 'ZLE'} ${opis}`);
  if (!warunek) problemy.push(opis);
};

/* Atrapa: OpenAI (/v1/audio/transcriptions, /v1/audio/speech), ElevenLabs
   (/v1/text-to-speech/:glos) i zmysły (/health, /stt, /tts). */
const wywolania = [];
let elevenPada = false;
let zmyslyZywe = false;
let oaBrakSrodkow = false;
let oaZlyKlucz = false;
let zmyslySttTryb = 'ok';        // ok | wisi | 501
let elevenWisi = false;
let elevenWolnoPada = false;
const wiszace = [];
const atrapa = http.createServer((req, res) => {
  const cialo = [];
  req.on('data', (c) => cialo.push(c));
  req.on('end', () => {
    const tresc = Buffer.concat(cialo);
    wywolania.push({ url: req.url, auth: req.headers.authorization || req.headers['xi-api-key'] || '', tresc: tresc.toString('latin1') });
    // Uśpiony komputer w domu: połączenie przyjęte, odpowiedzi nie ma.
    if (req.url === '/wl-wisi/v1/audio/transcriptions') { wiszace.push(res); return undefined; }
    if (req.url === '/wl-404/v1/audio/transcriptions') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ detail: 'Model whisper-1 is not installed locally.' }));
    }
    if (req.url === '/oa/v1/audio/transcriptions') {
      if (oaZlyKlucz) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided.', code: 'invalid_api_key' } }));
      }
      if (oaBrakSrodkow) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan and billing details.', code: 'insufficient_quota' } }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ text: 'Hej, Cosmos, jaka jutro pogoda?' }));
    }
    if (req.url === '/oa/v1/audio/speech') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(Buffer.from('MP3-OPENAI'));
    }
    if (req.url.startsWith('/el/v1/text-to-speech/')) {
      if (elevenWisi) { wiszace.push(res); return undefined; }
      // Wolny i w końcu odmawiający (np. przeciążony): po 2 s 401 – potem byłaby kolej OpenAI.
      if (elevenWolnoPada) { setTimeout(() => { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"detail":{"message":"quota"}}'); }, 2000); return undefined; }
      if (elevenPada) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"detail":{"message":"quota"}}'); }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(Buffer.from('MP3-ELEVEN'));
    }
    if (req.url === '/zm/health') {
      if (!zmyslyZywe) { res.writeHead(503); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ whisper: true, piper: true }));
    }
    // Zmysły dostają tryb i język w parametrach (?tryb=nasluch&jezyk=pl) – liczy się ścieżka.
    if (req.url.split('?')[0] === '/zm/stt') {
      if (zmyslySttTryb === 'wisi') { wiszace.push(res); return undefined; }
      if (zmyslySttTryb === '501') {
        res.writeHead(501, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ detail: 'Whisper nie jest zainstalowany.' }));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ text: 'z Whispera' }));
    }
    res.writeHead(404); res.end();
  });
});

(async () => {
  await new Promise((r) => atrapa.listen(0, '127.0.0.1', r));
  const A = `http://127.0.0.1:${atrapa.address().port}`;

  const wlasciciel = { id: 'wlasciciel', rola: 'wlasciciel' };
  const gosc = { id: 'u-gosc', rola: 'czlonek', silniki: {} };
  let ktoTeraz = wlasciciel;
  const EP_OPENAI = { baseUrl: `${A}/oa/v1`, apiKey: 'klucz-oa' };
  const silniki = {
    dostep: (nazwa, u) => (nazwa === 'openai' && u.rola === 'wlasciciel' ? { ok: true, ep: EP_OPENAI } : { ok: false }),
    studioDozwolone: (u) => u.rola === 'wlasciciel',
    // Zmysły = domowe GPU właściciela: gość tylko z przyznanym „lokalnym GPU" (lib/silniki.js).
    zmyslyDozwolone: (u) => u.rola === 'wlasciciel' || Boolean(u.silniki && u.silniki.local),
  };
  const STUDIO = { eleven: { key: 'klucz-el', base: `${A}/el`, voice: 'glos1', model: 'eleven_multilingual_v2' } };
  const glos = utworz({ SENSES_URL: `${A}/zm`, silniki, kto: () => ktoTeraz, sendJson, readBodyBuffer, readJson, STUDIO, env: {} });

  const serwer = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/api/stt') return glos.handleStt(req, res);
    if (p === '/api/tts') return glos.handleTts(req, res);
    res.writeHead(404); res.end();
  });
  await new Promise((r) => serwer.listen(0, '127.0.0.1', r));
  const S = `http://127.0.0.1:${serwer.address().port}`;
  const wav = Buffer.from('RIFF....WAVEfmt nagranie');
  const stt = (qs = '') => fetch(`${S}/api/stt${qs}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  const tts = (text) => fetch(`${S}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, jezyk: 'pl' }) });

  // --- 1. rozpoznawanie przez OpenAI, gdy zmysły leżą
  let m = glos.mozliwosci(wlasciciel);
  ok(m.sttChmura === true && m.ttsChmura === 'elevenlabs', `możliwości właściciela: sttChmura=${m.sttChmura}, ttsChmura=${m.ttsChmura}`);
  let r = await stt('?jezyk=pl&tryb=pytanie');
  let d = await r.json();
  ok(r.status === 200 && d.text === 'Hej, Cosmos, jaka jutro pogoda?' && d.zrodlo === 'openai', `zmysły wyłączone → OpenAI (${r.status}, ${d.zrodlo})`);
  const w1 = wywolania.find((w) => w.url === '/oa/v1/audio/transcriptions');
  ok(w1 && /name="language"\r\n\r\npl/.test(w1.tresc), 'do OpenAI idzie język rozmowy (pl)');
  ok(w1 && /Hej, Cosmos/.test(w1.tresc) && w1.auth === 'Bearer klucz-oa', 'podpowiedź pisowni „Cosmos" i klucz osoby');

  // --- 2. nasłuch otoczenia nie idzie do chmury
  wywolania.length = 0;
  r = await stt('?jezyk=pl&tryb=nasluch');
  d = await r.json();
  ok(r.status === 502 && d.brak === true, `tryb=nasluch bez lokalnego Whispera → 502 (${r.status})`);
  ok(!wywolania.some((w) => w.url.startsWith('/oa/')), 'nasłuch otoczenia NIE trafił do OpenAI');

  // --- 3. czytanie: ElevenLabs, potem OpenAI, potem 502
  wywolania.length = 0;
  r = await tts('Dzień dobry.');
  ok(r.status === 200 && (await r.text()) === 'MP3-ELEVEN' && r.headers.get('x-glos-zrodlo') === 'elevenlabs', 'czytanie: najpierw ElevenLabs');
  const w2 = wywolania.find((w) => w.url.startsWith('/el/'));
  ok(w2 && /eleven_flash_v2_5/.test(w2.tresc), 'ElevenLabs dostaje szybki model do rozmowy (eleven_flash_v2_5)');
  elevenPada = true;
  r = await tts('Dzień dobry.');
  ok(r.status === 200 && (await r.text()) === 'MP3-OPENAI', 'ElevenLabs pada → OpenAI');
  const w3 = wywolania.filter((w) => w.url === '/oa/v1/audio/speech').pop();
  ok(w3 && /gpt-4o-mini-tts/.test(w3.tresc) && /po polsku/.test(w3.tresc), 'OpenAI: model mowy z instrukcją polskiej wymowy');
  elevenPada = false;

  // --- 4. gość bez uprawnień
  ktoTeraz = gosc;
  m = glos.mozliwosci(gosc);
  ok(m.sttChmura === false && m.ttsChmura === '', `gość bez przyznań: sttChmura=${m.sttChmura}, ttsChmura="${m.ttsChmura}"`);
  wywolania.length = 0;
  r = await stt('?jezyk=pl');
  ok(r.status === 502, `gość: rozpoznawanie → 502, bez płatnego klucza właściciela (${r.status})`);
  r = await tts('Test.');
  ok(r.status === 502, `gość: czytanie → 502 = głos systemowy (${r.status})`);
  ok(!wywolania.some((w) => w.url.startsWith('/oa/') || w.url.startsWith('/el/')), 'gość nie wywołał ani OpenAI, ani ElevenLabs');
  ktoTeraz = wlasciciel;

  // --- 5. zmysły mają pierwszeństwo
  zmyslyZywe = true;
  // pamięć stanu zmysłów trwa 30 s – nowy obiekt, żeby zobaczyć świeży stan
  const glos2 = utworz({ SENSES_URL: `${A}/zm`, silniki, kto: () => ktoTeraz, sendJson, readBodyBuffer, readJson, STUDIO, env: {} });
  const serwer2 = http.createServer((req, res) => glos2.handleStt(req, res));
  await new Promise((rr) => serwer2.listen(0, '127.0.0.1', rr));
  wywolania.length = 0;
  r = await fetch(`http://127.0.0.1:${serwer2.address().port}/api/stt?tryb=nasluch`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  d = await r.json();
  ok(r.status === 200 && d.zrodlo === 'zmysly' && d.text === 'z Whispera', `zmysły żyją → lokalny Whisper, także dla nasłuchu (${d.zrodlo})`);
  ok(!wywolania.some((w) => w.url.startsWith('/oa/')), 'przy żywych zmysłach nic nie poszło do chmury');
  /* Gość bez przyznanego „lokalnego GPU" nie zajmuje Whispera na komputerze
     właściciela – nawet gdy zmysły żyją. Z przyznaniem – tak. */
  ktoTeraz = gosc;
  wywolania.length = 0;
  r = await fetch(`http://127.0.0.1:${serwer2.address().port}/api/stt?jezyk=pl`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  ok(r.status === 502 && !wywolania.some((w) => w.url.split('?')[0] === '/zm/stt'), `gość bez zgody nie trafia do zmysłów właściciela (${r.status})`);
  ktoTeraz = { ...gosc, silniki: { local: true } };
  r = await fetch(`http://127.0.0.1:${serwer2.address().port}/api/stt?jezyk=pl`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  d = await r.json();
  ok(r.status === 200 && d.zrodlo === 'zmysly', `gość z przyznanym „lokalnym GPU" dostaje Whispera (${d.zrodlo})`);
  ktoTeraz = wlasciciel;

  // --- 6. własny serwer rozpoznawania (STT_BASE_URL)
  const glos3 = (env) => utworz({ SENSES_URL: 'http://127.0.0.1:1', silniki, kto: () => ktoTeraz, sendJson, readBodyBuffer, readJson, STUDIO, env });
  const stawiaj = async (g) => {
    const s3 = http.createServer((req, res) => g.handleStt(req, res));
    await new Promise((rr) => s3.listen(0, '127.0.0.1', rr));
    return s3;
  };
  const zChmury = glos3({ STT_BASE_URL: 'https://stt.example.com/v1', STT_API_KEY: 'sk-WLASCICIELA' });
  ok(zChmury.mozliwosci(wlasciciel).sttLokalnyWlasny === false, 'STT_BASE_URL w internecie nie uchodzi za lokalny');
  const s4 = await stawiaj(glos3({ STT_BASE_URL: `${A}/oa/v1`, STT_LOKALNY: '0', STT_API_KEY: 'sk-WLASCICIELA' }));
  const u4 = `http://127.0.0.1:${s4.address().port}/api/stt`;
  wywolania.length = 0;
  r = await fetch(`${u4}?tryb=nasluch`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  ok(r.status === 502 && !wywolania.some((w) => w.auth === 'Bearer sk-WLASCICIELA'), `nasłuch otoczenia nie idzie do serwera rozpoznawania w chmurze (${r.status})`);
  ktoTeraz = gosc;
  wywolania.length = 0;
  r = await fetch(`${u4}?tryb=pytanie`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  ok(r.status === 502 && !wywolania.some((w) => w.auth === 'Bearer sk-WLASCICIELA'), `gość bez przyznań nie używa serwera rozpoznawania właściciela (${r.status})`);
  ok(glos3({ STT_BASE_URL: 'http://127.0.0.1:9/v1' }).mozliwosci(gosc).sttLokalnyWlasny === false, 'gość nie dostaje w /api/config cudzego serwera rozpoznawania');
  ktoTeraz = wlasciciel;
  // za duże nagranie odcięte przy czytaniu
  /* …i odmowa DOCHODZI: dawniej readBodyBuffer zrywał gniazdo, zanim trasa odpisała
     413 – klient dostawał reset (za Cloudflare 502), a przeglądarka „serwer niedostępny”
     zamiast „limit 25 MB” (zespół IT, runda 9). */
  r = await fetch(`${u4}?tryb=pytanie`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.alloc(26 * 1024 * 1024) }).catch(() => ({ status: 0, json: async () => ({}) }));
  d = await r.json().catch(() => ({}));
  ok(r.status === 413 && /25 MB/.test(d.error || ''), `nagranie ponad 25 MB (z Content-Length) → ${r.status} „${d.error || ''}”`);
  const strumien = new ReadableStream({
    start(c) { for (let i = 0; i < 26; i++) c.enqueue(new Uint8Array(1024 * 1024)); c.close(); },
  });
  r = await fetch(`${u4}?tryb=pytanie`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: strumien, duplex: 'half' })
    .catch(() => ({ status: 0, json: async () => ({}) }));
  d = await r.json().catch(() => ({}));
  ok(r.status === 413 && /25 MB/.test(d.error || ''), `nagranie ponad 25 MB bez Content-Length (strumień) → ${r.status}`);
  r = await fetch(`${u4}?tryb=pytanie`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  ok(r.status === 200 || r.status === 502, `serwer żyje po za dużych nagraniach (${r.status})`);
  s4.close();
  /* Własny LOKALNY serwer rozpoznawania: nasłuch słowa budzącego bez podpowiedzi
     („Hej, Cosmos.” w prompt) – na szumie Whisper „słyszał” ją i Cosmos budził
     się sam. Pytanie podpowiedź dostaje (agencja, runda 7). */
  const s5 = await stawiaj(glos3({ STT_BASE_URL: `${A}/oa/v1` }));
  const u5 = `http://127.0.0.1:${s5.address().port}/api/stt`;
  wywolania.length = 0;
  await fetch(`${u5}?tryb=nasluch&jezyk=pl`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  const nasl = wywolania.find((w) => w.url === '/oa/v1/audio/transcriptions');
  wywolania.length = 0;
  await fetch(`${u5}?tryb=pytanie&jezyk=pl`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  const pyt = wywolania.find((w) => w.url === '/oa/v1/audio/transcriptions');
  ok(nasl && !/name="prompt"/.test(nasl.tresc), 'własny lokalny serwer: nasłuch słowa budzącego BEZ podpowiedzi');
  ok(pyt && /name="prompt"/.test(pyt.tresc), 'własny lokalny serwer: pytanie z podpowiedzią');
  s5.close();

  // --- 7. koniec środków na koncie OpenAI: błąd trwały, nie „spróbuj jeszcze raz”
  ktoTeraz = wlasciciel;
  zmyslyZywe = false;
  oaBrakSrodkow = true;
  r = await stt('?jezyk=pl&tryb=pytanie');
  d = await r.json();
  ok(r.status === 502 && d.kod === 'stt-trwaly', `brak środków OpenAI → kod stt-trwaly, przeglądarka przechodzi od razu (${r.status}, ${d.kod})`);
  ok(!/sk-|klucz-oa|quota/i.test(d.error || ''), 'komunikat bez klucza i surowej treści dostawcy');
  oaBrakSrodkow = false;

  // --- 8. nagranie w bazie wiedzy bez zmysłów: ten sam łańcuch (przepisz)
  wywolania.length = 0;
  const pr = await glos.przepisz(wlasciciel, Buffer.from('ID3 nagranie z lasu'), 'audio/mpeg', { pominZmysly: true, tryb: 'plik' });
  ok(pr.text === 'Hej, Cosmos, jaka jutro pogoda?' && pr.zrodlo === 'openai', `przepisz() bez zmysłów → OpenAI (${pr.zrodlo})`);
  ok(!wywolania.some((w) => w.url.startsWith('/zm/')), 'przepisz({pominZmysly}) nie pyta zmysłów');
  const zGosciem = await glos.przepisz(gosc, wav, 'audio/wav', { pominZmysly: true }).then(() => 'ok', (e) => e.kod);
  ok(zGosciem === 'brak', `gość bez przyznań: przepisz() nie sięga po klucz właściciela (${zGosciem})`);

  // --- 9–13: termin łańcucha, zerwanie klienta, 501, własny serwer 404, tryb „plik”
  /* Budżet 16 s, źródło domowe 5 s: 5 + 5 s na dom i jeszcze ponad 5 s (najkrótsza próba) na OpenAI.
     W produkcji 85 s i 25 s – ta sama arytmetyka. */
  const BUDZET = { COSMOS_GLOS_BUDZET_MS: '16000', COSMOS_GLOS_DOM_MS: '5000' };
  const postaw = async (g) => {
    const s9 = http.createServer((req, res) => (new URL(req.url, 'http://x').pathname === '/api/tts' ? g.handleTts(req, res) : g.handleStt(req, res)));
    await new Promise((rr) => s9.listen(0, '127.0.0.1', rr));
    return { s9, u: `http://127.0.0.1:${s9.address().port}` };
  };
  zmyslyZywe = true;
  zmyslySttTryb = 'wisi';
  const g9 = utworz({ SENSES_URL: `${A}/zm`, silniki, kto: () => ktoTeraz, sendJson, readBodyBuffer, readJson, STUDIO,
    env: { ...BUDZET, STT_BASE_URL: `${A}/wl-wisi/v1`, STT_LOKALNY: '1' } });
  const p9 = await postaw(g9);
  wywolania.length = 0;
  let t0 = Date.now();
  r = await fetch(`${p9.u}/api/stt?jezyk=pl&tryb=pytanie`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal: AbortSignal.timeout(30000) })
    .catch((e) => ({ status: 0, json: async () => ({ blad: e.message }) }));
  d = await r.json();
  let ms = Date.now() - t0;
  ok(r.status === 200 && d.zrodlo === 'openai' && ms < 16500, `9. wiszące zmysły i własny serwer w domu → OpenAI w terminie (${r.status}, ${d.zrodlo}, ${ms} ms, budżet 16 s)`);
  ok(wywolania.some((w) => w.url.startsWith('/zm/stt')) && wywolania.some((w) => w.url.startsWith('/wl-wisi/')), '9. oba źródła domowe dostały swoją szansę (po 5 s)');

  // 10. klient zrywa po 1 s – OpenAI nie dostaje nic, nawet gdy termin by pozwolił
  wywolania.length = 0;
  const ac10 = new AbortController();
  setTimeout(() => ac10.abort(), 1000);
  await fetch(`${p9.u}/api/stt?jezyk=pl&tryb=pytanie`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav, signal: ac10.signal }).catch(() => null);
  await new Promise((rr) => setTimeout(rr, 11000));
  ok(!wywolania.some((w) => w.url.startsWith('/oa/')), `10. klient odszedł w trakcie → OpenAI 0 zleceń (${wywolania.map((w) => w.url.split('?')[0]).join(', ')})`);
  elevenWolnoPada = true;
  wywolania.length = 0;
  const ac10b = new AbortController();
  setTimeout(() => ac10b.abort(), 1000);
  await fetch(`${p9.u}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Dzień dobry.' }), signal: ac10b.signal }).catch(() => null);
  await new Promise((rr) => setTimeout(rr, 3000));
  ok(wywolania.some((w) => w.url.startsWith('/el/')) && !wywolania.some((w) => w.url === '/oa/v1/audio/speech'), '10. czytanie: klient odszedł, ElevenLabs potem odmówił → OpenAI nie czyta');
  elevenWolnoPada = false;
  elevenWisi = true;
  t0 = Date.now();
  r = await fetch(`${p9.u}/api/tts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Dzień dobry.' }), signal: AbortSignal.timeout(30000) }).catch(() => ({ status: 0 }));
  ms = Date.now() - t0;
  ok(r.status === 502 && ms < 17000, `10. czytanie przy wiszącym ElevenLabs kończy się w terminie (${r.status}, ${ms} ms)`);
  elevenWisi = false;
  p9.s9.close();

  // 11. zmysły bez Whispera (501) + zły klucz OpenAI → stt-trwaly
  zmyslySttTryb = '501';
  oaZlyKlucz = true;
  const p11 = await postaw(utworz({ SENSES_URL: `${A}/zm`, silniki, kto: () => ktoTeraz, sendJson, readBodyBuffer, readJson, STUDIO, env: {} }));
  r = await fetch(`${p11.u}/api/stt?jezyk=pl&tryb=pytanie`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  d = await r.json();
  ok(r.status === 502 && d.kod === 'stt-trwaly', `11. zmysły 501 + klucz odrzucony → ${d.kod}`);
  oaZlyKlucz = false;
  zmyslySttTryb = 'ok';
  zmyslyZywe = false;
  p11.s9.close();

  // 12. własny serwer STT: 404 {detail} (speaches bez modelu) – zdanie o własnym serwerze
  const bezOpenAi = { ...silniki, dostep: () => ({ ok: false }) };
  const p12 = await postaw(utworz({ SENSES_URL: 'http://127.0.0.1:1', silniki: bezOpenAi, kto: () => ktoTeraz, sendJson, readBodyBuffer, readJson, STUDIO,
    env: { STT_BASE_URL: `${A}/wl-404/v1` } }));
  const dziennik = [];
  const blConsole = console.error;
  console.error = (...a) => { dziennik.push(a.join(' ')); };
  r = await fetch(`${p12.u}/api/stt?jezyk=pl&tryb=pytanie`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  d = await r.json();
  console.error = blConsole;
  ok(r.status === 502 && d.kod === 'stt-trwaly' && !/chmurze/.test(d.error || '') && /STT_MODEL/.test(d.error || ''), `12. własny serwer 404 → „${d.error}”`);
  ok(dziennik.some((l) => /not installed/.test(l)), '12. treść `detail` trafia do dziennika serwera');
  p12.s9.close();

  // 13. tryb „plik”: whisper-1, bez podpowiedzi, opus jako .ogg
  wywolania.length = 0;
  const pl13 = await glos.przepisz(wlasciciel, Buffer.from('OggS nagranie spotkania'), 'audio/opus', { pominZmysly: true, tryb: 'plik' });
  const w13 = wywolania.find((w) => w.url === '/oa/v1/audio/transcriptions');
  ok(pl13.zrodlo === 'openai' && w13 && /name="model"\r\n\r\nwhisper-1/.test(w13.tresc), '13. nagranie z bazy wiedzy idzie do whisper-1');
  ok(w13 && !/name="prompt"/.test(w13.tresc), '13. nagranie z bazy wiedzy bez podpowiedzi „Hej, Cosmos.”');
  ok(w13 && /filename="mowa\.ogg"/.test(w13.tresc) && /Content-Type: audio\/ogg/.test(w13.tresc), '13. audio/opus wysłane jako .ogg');
  wywolania.length = 0;
  await glos.przepisz(wlasciciel, wav, 'audio/wav', { pominZmysly: true, tryb: 'pytanie' });
  const w13b = wywolania.find((w) => w.url === '/oa/v1/audio/transcriptions');
  ok(w13b && /name="model"\r\n\r\ngpt-4o-mini-transcribe/.test(w13b.tresc), '13. rozmowa dalej idzie do szybkiego modelu');

  for (const w of wiszace) { try { w.destroy(); } catch { /* już zamknięte */ } }
  atrapa.close(); serwer.close(); serwer2.close();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nGŁOS SERWERA OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

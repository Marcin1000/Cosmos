/* Głos na serwerze: rozpoznawanie i czytanie z łańcuchem źródeł (lib/glos.js).
 *
 * Po co: tryb głosowy bez piszczenia mikrofonu działał tylko z Whisperem
 * w zmysłach. Bez komputera domowego telefon wracał do Web Speech API, a Android
 * kwituje dźwiękiem każdy start i koniec rozpoznawania. Teraz serwer ma dokąd
 * wysłać nagranie — i to musi być prawda w każdym z tych przypadków:
 *
 *   1. zmysły wyłączone + klucz OpenAI → rozpoznanie idzie do OpenAI, z językiem
 *      i podpowiedzią pisowni „Cosmos"; /api/config zgłasza sttChmura,
 *   2. nasłuch otoczenia (`tryb=nasluch`) NIGDY nie trafia do chmury,
 *   3. czytanie: ElevenLabs pierwsze (szybki model rozmowy), przy jego awarii
 *      OpenAI — a przy braku wszystkiego 502, żeby przeglądarka wzięła głos
 *      systemowy,
 *   4. gość bez prawa do OpenAI i Studia nie dostaje płatnego głosu właściciela,
 *   5. zmysły z Whisperem mają pierwszeństwo przed chmurą (lokalnie, za darmo),
 *   6. własny serwer rozpoznawania (STT_BASE_URL): w internecie nie dostaje
 *      nasłuchu otoczenia, a gość bez przyznań nie korzysta z niego na klucz
 *      właściciela. */
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
const atrapa = http.createServer((req, res) => {
  const cialo = [];
  req.on('data', (c) => cialo.push(c));
  req.on('end', () => {
    const tresc = Buffer.concat(cialo);
    wywolania.push({ url: req.url, auth: req.headers.authorization || req.headers['xi-api-key'] || '', tresc: tresc.toString('latin1') });
    if (req.url === '/oa/v1/audio/transcriptions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ text: 'Hej, Cosmos, jaka jutro pogoda?' }));
    }
    if (req.url === '/oa/v1/audio/speech') {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(Buffer.from('MP3-OPENAI'));
    }
    if (req.url.startsWith('/el/v1/text-to-speech/')) {
      if (elevenPada) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"detail":{"message":"quota"}}'); }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      return res.end(Buffer.from('MP3-ELEVEN'));
    }
    if (req.url === '/zm/health') {
      if (!zmyslyZywe) { res.writeHead(503); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ whisper: true, piper: true }));
    }
    if (req.url === '/zm/stt') {
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
  // pamięć stanu zmysłów trwa 30 s — nowy obiekt, żeby zobaczyć świeży stan
  const glos2 = utworz({ SENSES_URL: `${A}/zm`, silniki, kto: () => ktoTeraz, sendJson, readBodyBuffer, readJson, STUDIO, env: {} });
  const serwer2 = http.createServer((req, res) => glos2.handleStt(req, res));
  await new Promise((rr) => serwer2.listen(0, '127.0.0.1', rr));
  wywolania.length = 0;
  r = await fetch(`http://127.0.0.1:${serwer2.address().port}/api/stt?tryb=nasluch`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  d = await r.json();
  ok(r.status === 200 && d.zrodlo === 'zmysly' && d.text === 'z Whispera', `zmysły żyją → lokalny Whisper, także dla nasłuchu (${d.zrodlo})`);
  ok(!wywolania.some((w) => w.url.startsWith('/oa/')), 'przy żywych zmysłach nic nie poszło do chmury');
  /* Gość bez przyznanego „lokalnego GPU" nie zajmuje Whispera na komputerze
     właściciela — nawet gdy zmysły żyją. Z przyznaniem — tak. */
  ktoTeraz = gosc;
  wywolania.length = 0;
  r = await fetch(`http://127.0.0.1:${serwer2.address().port}/api/stt?jezyk=pl`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  ok(r.status === 502 && !wywolania.some((w) => w.url === '/zm/stt'), `gość bez zgody nie trafia do zmysłów właściciela (${r.status})`);
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
  r = await fetch(`${u4}?tryb=pytanie`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.alloc(26 * 1024 * 1024) }).catch(() => ({ status: 0 }));
  ok(r.status === 413 || r.status === 0, `nagranie ponad 25 MB odrzucone (${r.status})`);
  s4.close();

  atrapa.close(); serwer.close(); serwer2.close();
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nGŁOS SERWERA OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

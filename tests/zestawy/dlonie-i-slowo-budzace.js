/* Dłonie i palce, słowo budzące, otwieranie stron.

   Trzy uwagi Marcina z jednej rozmowy:
   – „Ile palców pokazuję?” → „Nie mogę określić liczby palców” (szkielet
     Kinecta ma dłoń jako jeden punkt),
   – „Hej Cosmos albo nic nie robi, albo łapie po długim czasie”,
   – „dobrze by było, żeby asystent otwierał strony, np. onet.pl”.

   Bez przeglądarki i bez sprzętu – funkcje wołane wprost, usługa zmysłów
   (prawdziwy service.py) pod FastAPI TestClient z udawanym MediaPipe:
     1. słowo budzące: przekręcenia nazwy, które pisze Whisper, budzą; zwykłe
        zdanie o kosmosie nie budzi; po słowie zostaje samo pytanie,
     2. adres do otwarcia: „onet.pl” → https://onet.pl/, a javascript:,
        data:, file: i adres z hasłem nie otwierają niczego,
     3. /dlonie: liczba i nazwy palców dla pięści, znaku V, trzech palców,
        otwartej dłoni i samego kciuka; gest po polsku; dwie dłonie z sumą
        w poprawnej odmianie; strona dłoni osoby, nie kamery,
     4. /stt: nasłuch słowa budzącego z narzuconym językiem i szybkim
        dekodowaniem, BEZ podpowiedzi (na szumie Whisper „słyszałby” ją
        i Cosmos budziłby się sam); pytanie bez zmian,
     5. serwer przekazuje usłudze tryb i język rozpoznawania.
*/
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
const { utworzMowe, SLOWO_BUDZACE } = require('../../public/mowa.js');
const { utworzProtokol } = require('../../public/protokol.js');
const { utworz: utworzGlos } = require('../../lib/glos.js');
const { sendJson, readBodyBuffer, readJson } = require('../../lib/rdzen.js');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

/* ---- 1. Słowo budzące ---- */
const BUDZI = ['Hej, Kosmos', 'Hej Cosmos!', 'Hej Cosmo, która godzina?', 'Hejka kosmos, co widzisz?',
  'Ej, Cosmos, ile palców pokazuję?', 'Okej Kosmos', 'Hey Cosmos', 'Cosmos, jaka jest pogoda?',
  'hej kosmosHej kosmos co widzisz', 'Halo, Kosmos!'];
const NIE_BUDZI = ['Oglądałem wczoraj film o kosmosie.', 'Kosmos jest ogromny i zimny', 'Hej, jak się masz?',
  'Mój kolega Kosma przyjdzie jutro', 'To był kosmiczny wieczór'];
for (const z of BUDZI) ok(SLOWO_BUDZACE.test(z), `1. budzi: „${z}”`);
for (const z of NIE_BUDZI) ok(!SLOWO_BUDZACE.test(z), `1. nie budzi: „${z}”`);
const { bezSlowaBudzacego } = utworzMowe({ WAKE_RE: SLOWO_BUDZACE });
const po = bezSlowaBudzacego('Hej, Kosmos, ile palców pokazuję?');
ok(/^ile palców pokazuję\?$/i.test(po), `1. po słowie budzącym zostaje samo pytanie („${po}”)`);

/* ---- 2. Adres do otwarcia ---- */
const { adresDoOtwarcia, czyOtworz } = utworzProtokol();
const ADRESY = [
  ['onet.pl', 'https://onet.pl/'], ['www.onet.pl/pogoda', 'https://www.onet.pl/pogoda'],
  ['https://www.youtube.com', 'https://www.youtube.com/'], ['<https://onet.pl>', 'https://onet.pl/'],
  ['onet.pl.', 'https://onet.pl/'], ['javascript:alert(1)', ''], ['data:text/html,<b>x</b>', ''],
  ['file:///etc/passwd', ''], ['https://ktos:haslo@onet.pl', ''], ['localhost', ''], ['otwórz onet', ''],
];
for (const [wej, oczek] of ADRESY) {
  const wyn = adresDoOtwarcia(wej);
  ok(wyn === oczek, `2. „${wej}” → „${wyn}”${oczek ? '' : ' (nie otwiera)'}`);
}
ok(czyOtworz('otwórz') && czyOtworz('Otworz') && czyOtworz('open') && !czyOtworz('notatka'), '2. typ akcji „otwórz”/„open” rozpoznany, inne nie');

function uruchom(argumenty) {
  return new Promise((gotowe) => {
    const p = spawn('python3', argumenty, { env: process.env });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const straz = setTimeout(() => p.kill(), 60000);
    p.on('close', (kod) => { clearTimeout(straz); gotowe({ kod, out: out.trim(), err: err.trim() }); });
  });
}

(async () => {
  /* ---- 3–4. Usługa zmysłów ---- */
  let fastapi = true;
  try { execFileSync('python3', ['-c', 'import fastapi, httpx, numpy']); } catch { fastapi = false; }
  if (!fastapi) console.log('POMINIĘTE 3–4: brak fastapi/httpx/numpy w python3');
  else {
    const u = await uruchom([path.join(__dirname, '..', 'atrapy', 'usluga_dlonie.py'), path.join(__dirname, '..', '..', 'senses')]);
    let w = { sceny: {} };
    try { w = JSON.parse(u.out.split('\n').pop()); } catch { console.log(u.err.split('\n').slice(-5).join('\n')); }
    const sc = w.sceny || {};
    const palce = (n) => ((sc[n] || {}).dlonie || []).map((d) => d.palce.length);
    ok(w.caps && w.caps.dlonie === true, '3. usługa zgłasza zdolność „dlonie”');
    ok(JSON.stringify(palce('piesc')) === '[0]' && /pięść/.test(sc.piesc.summary), `3. pięść: 0 palców („${(sc.piesc || {}).summary}”)`);
    ok(JSON.stringify(palce('v')) === '[2]' && /wskazujący, środkowy/.test(sc.v.summary) && /znak V/.test(sc.v.summary), `3. znak V: 2 palce z nazwami („${(sc.v || {}).summary}”)`);
    ok(JSON.stringify(palce('trzy')) === '[3]' && /3 palce/.test(sc.trzy.summary), `3. trzy palce bez gotowego gestu („${(sc.trzy || {}).summary}”)`);
    ok(JSON.stringify(palce('otwarta')) === '[5]' && /5 palców/.test(sc.otwarta.summary), `3. otwarta dłoń: 5 palców („${(sc.otwarta || {}).summary}”)`);
    ok(JSON.stringify(palce('kciuk')) === '[1]' && /1 palec \(kciuk\)/.test(sc.kciuk.summary), `3. sam kciuk: 1 palec („${(sc.kciuk || {}).summary}”)`);
    ok(/razem 7 palców/.test((sc.dwie || {}).summary || '') && /razem 3 palce/.test((sc.dwieTrzy || {}).summary || ''), `3. dwie dłonie: suma w poprawnej odmianie („${(sc.dwieTrzy || {}).summary}”)`);
    ok(((sc.dwie || {}).dlonie || []).map((d) => d.strona).join(',') === 'prawa,lewa', '3. strona dłoni osoby (kamera widzi ją odwrotnie)');
    ok(JSON.stringify((sc.v || {}).punktow) === '[21]', '3. 21 punktów dłoni do narysowania');
    ok((sc.pusto || {}).summary === 'nie widać dłoni', '3. bez dłoni: „nie widać dłoni”');
    const [nasluch, pytanie] = w.stt || [];
    ok(nasluch && nasluch.language === 'pl' && nasluch.beam_size === 1 && !('initial_prompt' in nasluch), `4. nasłuch: język pl, szybkie dekodowanie, bez podpowiedzi (${JSON.stringify(nasluch)})`);
    ok(pytanie && pytanie.language === null && !('beam_size' in pytanie), `4. pytanie: bez zmian (${JSON.stringify(pytanie)})`);
  }

  /* ---- 5. Serwer przekazuje tryb i język ---- */
  const wolane = [];
  const Z = {
    fetch: async (sciezka) => { wolane.push(sciezka); return new Response(JSON.stringify({ text: 'Hej Kosmos' }), { status: 200, headers: { 'content-type': 'application/json' } }); },
    zrodlo: () => 'agent',
    stanAgenta: () => ({ online: true, caps: { whisper: true } }),
  };
  const silniki = { dostep: () => ({ ok: false }), zmyslyDozwolone: () => true, studioDozwolone: () => false };
  const glos = utworzGlos({ silniki, kto: () => ({ id: 'wlasciciel', rola: 'wlasciciel' }), sendJson, readBodyBuffer, readJson, env: {}, STUDIO: {}, zmysly: Z });
  const srv = http.createServer((req, res) => glos.handleStt(req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const adres = `http://127.0.0.1:${srv.address().port}/api/stt`;
  for (const qs of ['?tryb=nasluch&jezyk=pl', '?jezyk=en', '?tryb=podglad&jezyk=pl']) {
    await fetch(adres + qs, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: Buffer.from('RIFF0000') });
  }
  srv.close();
  ok(/tryb=nasluch/.test(wolane[0] || '') && /jezyk=pl/.test(wolane[0] || ''), `5. nasłuch: usługa dostaje tryb i język (${wolane[0]})`);
  ok(/tryb=pytanie/.test(wolane[1] || '') && /jezyk=en/.test(wolane[1] || ''), `5. pytanie: usługa dostaje tryb i język (${wolane[1]})`);
  ok(/tryb=podglad/.test(wolane[2] || ''), `5. podgląd: usługa dostaje tryb (${wolane[2]})`);

  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nDŁONIE I SŁOWO BUDZĄCE OK');
  process.exit(fail.length ? 1 : 0);
})();

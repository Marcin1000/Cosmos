/* Głos Cosmosa po stronie serwera – rozpoznawanie mowy (/api/stt) i czytanie
 * na głos (/api/tts) z jednego miejsca, z łańcuchem źródeł.
 *
 * DLACZEGO TO ISTNIEJE. Tryb głosowy bez piszczenia mikrofonu (public/nasluch.js:
 * mikrofon otwarty raz na sesję, wypowiedzi wycinane po energii sygnału) był
 * dostępny tylko z Whisperem w zmysłach – czyli przy włączonym komputerze
 * domowym. Na serwerze bez niego telefon wracał do Web Speech API, a Android
 * kwituje dźwiękiem każde uruchomienie i zamknięcie rozpoznawania. Marcin
 * słyszał to jako „ciągłe podłączanie i odłączanie mikrofonu".
 *
 * Teraz dźwięk ma zawsze dokąd pójść:
 *
 *   rozpoznawanie:  zmysły (Whisper, lokalnie, za darmo)
 *                 → własny serwer zgodny z OpenAI (STT_BASE_URL – np. NIM,
 *                   speaches/faster-whisper-server na własnym GPU)
 *                 → OpenAI (gpt-4o-mini-transcribe) – kluczem, do którego
 *                   ta osoba ma prawo (własny, przyznany albo właściciela)
 *
 *   czytanie:      kolejność z GLOS_TTS (domyślnie: ElevenLabs → OpenAI →
 *                  Piper w zmysłach); na końcu przeglądarka sama sięga po głos
 *                  systemowy, gdy serwer odpowie 502.
 *
 * Źródła płatne idą przez te same uprawnienia co silniki (`lib/silniki.js`):
 * ElevenLabs tylko z prawem do Studia, OpenAI tylko z dostępem do silnika
 * OpenAI. Inaczej głos gościa płaciłby właściciel bez jego zgody.
 *
 * PRYWATNOŚĆ. Nasłuch słowa budzącego („Hej, Cosmos") słucha otoczenia bez
 * przerwy, więc tego dźwięku nie wysyłamy do chmury: `?tryb=nasluch` przyjmuje
 * tylko źródła lokalne. Do chmury trafia wyłącznie to, co ktoś świadomie mówi
 * do Cosmosa – po dotknięciu kuli albo w rozmowie, którą sam zaczął.
 */
'use strict';

const LOKALNE_STT = new Set(['zmysly', 'wlasny']);
const TEKST_TTS_MAX = 1200;      // jedna porcja czytania; klient dzieli dłuższe teksty sam

const { prywatnyAdres } = require('./pobieranie.js');

/** Czy adres usługi wskazuje na ten komputer albo sieć domową. */
function adresLokalny(adres) {
  let host;
  try { host = new URL(adres).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return false; }
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.ts.net') || host.endsWith('.lan')) return true;
  return require('node:net').isIP(host) ? prywatnyAdres(host) : false;
}

function utworz({ SENSES_URL, silniki, kto, sendJson, readBodyBuffer, readJson, env = process.env, STUDIO, zmysly: drogaZmyslow }) {
  /* Droga do zmysłów (lib/agent-zmyslow.js): własny komputer osoby albo dom
     właściciela za zgodą. Bez niej (testy) – wprost pod SENSES_URL. */
  const Z = drogaZmyslow || {
    fetch: (sciezka, init) => fetch(`${SENSES_URL}${sciezka}`, init),
    zrodlo: (u) => (SENSES_URL && silniki.zmyslyDozwolone(u) ? 'dom' : ''),
    stanAgenta: () => null,
  };
  const cfg = {
    sttBase: (env.STT_BASE_URL || '').replace(/\/+$/, ''),
    sttKey: env.STT_API_KEY || '',
    sttModel: env.STT_MODEL || 'whisper-1',
    /* Czy STT_BASE_URL stoi u siebie. Jawnie przez STT_LOKALNY=1/0, a bez
       tego – z adresu: localhost, sieć prywatna, Tailscale. Dawniej domyślnie
       „tak", więc nasłuch otoczenia szedł do chmury, gdy ktoś wpisał tu
       adres usługi w internecie. */
    sttLokalny: env.STT_LOKALNY === '1' ? true : env.STT_LOKALNY === '0' ? false
      : adresLokalny(env.STT_BASE_URL || ''),
    openaiSttModel: env.STT_OPENAI_MODEL || 'gpt-4o-mini-transcribe',
    openaiTtsModel: env.TTS_OPENAI_MODEL || 'gpt-4o-mini-tts',
    openaiTtsGlos: env.TTS_OPENAI_VOICE || 'coral',
    elevenModel: env.ELEVENLABS_GLOS_MODEL || 'eleven_flash_v2_5',
    kolejnoscTts: String(env.GLOS_TTS || 'elevenlabs,openai,zmysly')
      .split(',').map((s) => s.trim()).filter(Boolean),
  };

  /* --- stan zmysłów, krótko ważny ------------------------------------------
     Pytanie o /health przy każdej wypowiedzi kosztowałoby do półtorej sekundy
     na wyłączonym komputerze domowym (Tailscale nie odpowiada od razu, tylko
     po czasie). Pamiętamy wynik przez pół minuty. */
  let zmysly = { online: false, caps: {}, kiedy: 0 };
  /** Stan zmysłów TEJ osoby. Agent sam zgłasza stan co kilkanaście sekund,
   *  więc pytamy go tylko o pamięć; dom właściciela – /health, z pamięcią. */
  async function stanZmyslow(u = kto()) {
    const zrodlo = Z.zrodlo(u);
    if (zrodlo === 'agent') {
      const a = Z.stanAgenta(u && u.id) || {};
      return { online: Boolean(a.online), caps: a.caps || {}, zrodlo };
    }
    if (zrodlo !== 'dom') return { online: false, caps: {}, zrodlo };
    if (Date.now() - zmysly.kiedy < 30000) return zmysly;
    try {
      const r = await fetch(`${SENSES_URL}/health`, { signal: AbortSignal.timeout(1500) });
      const caps = r.ok ? await r.json() : {};
      zmysly = { online: r.ok, caps: caps || {}, kiedy: Date.now(), zrodlo };
    } catch {
      zmysly = { online: false, caps: {}, kiedy: Date.now(), zrodlo };
    }
    return zmysly;
  }
  function zapomnijZmysly() { zmysly = { online: false, caps: {}, kiedy: 0 }; }

  /* Własny serwer rozpoznawania należy do właściciela. Gość korzysta z niego
     tylko z prawem do silnika lokalnego – inaczej szedłby na jego klucz
     (STT_API_KEY) albo jego domowe GPU bez żadnej zgody. */
  const wlasnyDla = (u) => Boolean(cfg.sttBase) && (u?.rola === 'wlasciciel' || silniki.dostep('local', u).ok);

  function openaiDla(u) {
    const d = silniki.dostep('openai', u);
    return d.ok && d.ep && d.ep.apiKey ? d.ep : null;
  }
  const elevenDla = (u) => Boolean(STUDIO && STUDIO.eleven && STUDIO.eleven.key && silniki.studioDozwolone(u));

  /** Co z głosu działa w chmurze dla tej osoby – do /api/config. Zmysły
   *  zgłasza osobno /api/status, więc tu tylko to, co od nich niezależne. */
  function mozliwosci(u = kto()) {
    const sttChmura = (wlasnyDla(u) && !cfg.sttLokalny) || Boolean(openaiDla(u));
    let ttsChmura = '';
    for (const z of cfg.kolejnoscTts) {
      if (z === 'elevenlabs' && elevenDla(u)) { ttsChmura = 'elevenlabs'; break; }
      if (z === 'openai' && openaiDla(u)) { ttsChmura = 'openai'; break; }
    }
    return { sttChmura, sttLokalnyWlasny: wlasnyDla(u) && cfg.sttLokalny, ttsChmura };
  }

  // -------------------------------------------------------------------------
  // Rozpoznawanie
  // -------------------------------------------------------------------------

  /* Tryb i język jadą do usługi: przy nasłuchu słowa budzącego Whisper dostaje
     szybkie dekodowanie i narzucony język – krótki wycinek „hej kosmos” bywał
     rozpoznawany jako cokolwiek innego albo po kilku sekundach (Marcin: „albo
     nic nie robi, albo łapie po długim czasie”). Podpowiedzi przy nasłuchu
     nie ma (senses/service.py, /stt): na szumie Whisper ją „słyszy”. */
  async function sttZmysly(audio, typ, { jezyk = '', tryb = '' } = {}) {
    const qs = new URLSearchParams();
    if (jezyk) qs.set('jezyk', jezyk);
    if (tryb) qs.set('tryb', tryb);
    const r = await Z.fetch(`/stt${qs.toString() ? `?${qs}` : ''}`, {
      method: 'POST', headers: { 'Content-Type': typ }, body: audio,
      signal: AbortSignal.timeout(60000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `zmysły: HTTP ${r.status}`);
    return String(d.text || '');
  }

  /** Dowolny serwer zgodny z OpenAI: /audio/transcriptions, multipart. */
  async function sttOpenAiZgodny(base, klucz, model, audio, typ, jezyk, tryb = '') {
    const rozsz = /wav/.test(typ) ? 'wav' : /ogg/.test(typ) ? 'ogg' : /mp4|m4a|aac/.test(typ) ? 'm4a' : /mpeg|mp3/.test(typ) ? 'mp3' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([audio], { type: typ }), `mowa.${rozsz}`);
    form.append('model', model);
    form.append('response_format', 'json');
    if (jezyk) form.append('language', jezyk);
    /* Podpowiedź pisowni: bez niej „Cosmos" wraca jako „kosmos", „Kosmos"
       albo „Cosmo's", a słowo budzące i tak łapie oba, ale rozmowa zapisuje
       się z błędem w nazwie produktu. Przy nasłuchu słowa budzącego – nie:
       na szumie model „słyszy” samą podpowiedź i Cosmos budził się sam
       (tak samo jak w usłudze zmysłów). */
    if (tryb !== 'nasluch') form.append('prompt', jezyk === 'en' ? 'Hey Cosmos.' : 'Hej, Cosmos.');
    const headers = klucz ? { Authorization: `Bearer ${klucz}` } : {};
    const r = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST', headers, body: form, signal: AbortSignal.timeout(60000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d.error && (d.error.message || d.error)) || `HTTP ${r.status}`);
    return String(d.text || '');
  }

  async function handleStt(req, res) {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const jezyk = /^(pl|en)$/.test(q.get('jezyk') || '') ? q.get('jezyk') : '';
    /* Szkic słów w trakcie mówienia (tryb=podglad) wysyła całe dotychczasowe
       nagranie co ~1,4 s. Przez OpenAI to kilka płatnych transkrypcji na jedno
       zdanie – u zaproszonej osoby na klucz właściciela, bez jego wiedzy
       (zespół IT, runda 5). Szkic przez chmurę tylko na własny rachunek:
       właściciel albo własny klucz. Na kluczu przyznanym – tylko lokalnie;
       pytanie i tak przyjdzie całe po ciszy. */
    const podglad = q.get('tryb') === 'podglad';
    const tylkoLokalnie = q.get('tryb') === 'nasluch'
      || (podglad && silniki.dostep('openai', kto()).zrodlo === 'przyznany');
    const typ = String(req.headers['content-type'] || 'audio/webm').split(';')[0];
    let audio;
    // Limit przy CZYTANIU, nie po nim – 40 MB wczytywało się w całości, zanim padło 413.
    try { audio = await readBodyBuffer(req, 25 * 1024 * 1024); } catch (e) {
      return /too large/i.test(e.message)
        ? sendJson(res, 413, { error: 'Nagranie jest za długie (limit 25 MB).' })
        : sendJson(res, 400, { error: 'Nie udało się odczytać nagrania.' });
    }
    if (!audio || !audio.length) return sendJson(res, 400, { error: 'Puste nagranie.' });

    const u = kto();
    const proby = [];
    const z = await stanZmyslow(u);
    /* Zmysły pytamy zawsze, gdy żyją – nie tylko gdy zgłaszają Whispera. Deklaracja
       bywa nieaktualna (model doinstalowany bez restartu), a bez Whispera usługa
       i tak odpowie 501 i przejdziemy dalej. */
    const tryb = q.get('tryb') === 'nasluch' ? 'nasluch' : podglad ? 'podglad' : 'pytanie';
    if (z.online) proby.push(['zmysly', () => sttZmysly(audio, typ, { jezyk, tryb })]);
    if (wlasnyDla(u)) proby.push(['wlasny', () => sttOpenAiZgodny(cfg.sttBase, cfg.sttKey, cfg.sttModel, audio, typ, jezyk, tryb)]);
    const oa = openaiDla(u);
    if (oa) proby.push(['openai', () => sttOpenAiZgodny(oa.baseUrl, oa.apiKey, cfg.openaiSttModel, audio, typ, jezyk, tryb)]);

    const dozwolone = proby.filter(([nazwa]) => !tylkoLokalnie
      || (nazwa === 'zmysly') || (nazwa === 'wlasny' && cfg.sttLokalny));
    const bledy = [];
    let polaczenia = 0;
    for (const [nazwa, zrob] of dozwolone) {
      try {
        const text = (await zrob()).trim();
        res.setHeader('X-Glos-Zrodlo', nazwa);
        return sendJson(res, 200, { text, zrodlo: nazwa });
      } catch (err) {
        if (nazwa === 'zmysly') zapomnijZmysly();   // przy następnym razie zapytaj od nowa
        if (err.cause?.code || err.name === 'TimeoutError' || /fetch failed/.test(err.message)) polaczenia++;
        bledy.push(`${nazwa}: ${err.message}`);
      }
    }
    // Brak szkicu to nie błąd – przeglądarka przestaje o niego prosić.
    if (podglad && !dozwolone.length) return sendJson(res, 200, { text: '', bezPodgladu: true });
    if (!dozwolone.length) {
      return sendJson(res, 502, {
        error: tylkoLokalnie
          ? 'Nasłuch słowa budzącego potrzebuje lokalnego Whispera (usługa zmysłów).'
          : 'Rozpoznawanie mowy jest niedostępne: nie działa Whisper w zmysłach, a na serwerze nie ma klucza do rozpoznawania w chmurze (OpenAI albo STT_BASE_URL).',
        brak: true,
      });
    }
    console.error('Rozpoznawanie mowy nie powiodło się:', bledy.join(' · '));
    /* Wszystkie źródła padły na POŁĄCZENIU (komputer domowy zasnął w trakcie
       rozmowy): przeglądarka ma od razu przejść na własne rozpoznawanie, a nie
       czekać na trzecią porażkę (zespół IT, runda 5). Zdanie bez „Nie udało
       się rozpoznać mowy" – ten początek dokłada przeglądarka. */
    if (polaczenia === dozwolone.length) {
      return sendJson(res, 502, { kod: 'zmysly-offline', error: 'rozpoznawanie przestało odpowiadać (komputer ze zmysłami śpi albo nie ma sieci).' });
    }
    return sendJson(res, 502, { kod: 'stt-blad', error: 'usługa odpowiedziała błędem. Spróbuj jeszcze raz.' });
  }

  // -------------------------------------------------------------------------
  // Czytanie na głos
  // -------------------------------------------------------------------------

  async function ttsZmysly(tekst) {
    const r = await Z.fetch('/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: tekst }), signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`zmysły: HTTP ${r.status}`);
    return { typ: r.headers.get('content-type') || 'audio/wav', buf: Buffer.from(await r.arrayBuffer()) };
  }

  async function ttsEleven(tekst) {
    const e = STUDIO.eleven;
    const r = await fetch(`${e.base}/v1/text-to-speech/${encodeURIComponent(e.voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': e.key },
      body: JSON.stringify({ text: tekst, model_id: cfg.elevenModel }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const d = await r.json(); msg = (d.detail && (d.detail.message || d.detail)) || msg; } catch { /* nie-JSON */ }
      throw new Error(`ElevenLabs: ${msg}`);
    }
    return { typ: 'audio/mpeg', buf: Buffer.from(await r.arrayBuffer()) };
  }

  async function ttsOpenAi(ep, tekst, jezyk) {
    const r = await fetch(`${ep.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.apiKey}` },
      body: JSON.stringify({
        model: cfg.openaiTtsModel, voice: cfg.openaiTtsGlos, input: tekst, response_format: 'mp3',
        instructions: jezyk === 'en'
          ? 'Speak naturally and warmly, at a calm conversational pace.'
          : 'Mów po polsku, naturalnie i ciepło, w spokojnym tempie rozmowy. Poprawny polski akcent.',
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(`OpenAI: ${(d.error && d.error.message) || `HTTP ${r.status}`}`);
    }
    return { typ: 'audio/mpeg', buf: Buffer.from(await r.arrayBuffer()) };
  }

  async function handleTts(req, res) {
    let d;
    try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const tekst = String((d && d.text) || '').trim().slice(0, TEKST_TTS_MAX);
    if (!tekst) return sendJson(res, 400, { error: 'Brak tekstu do przeczytania.' });
    const jezyk = d && d.jezyk === 'en' ? 'en' : 'pl';
    const u = kto();
    const z = await stanZmyslow(u);

    const bledy = [];
    /* Zaproszona osoba z działającym Piperem na własnym komputerze czyta
       na nim – inaczej za każde zdanie płacił właściciel (OpenAI, ElevenLabs),
       choć darmowy głos stał obok (zespół IT, runda 6). */
    const kolejnosc = u && u.rola !== 'wlasciciel' && z.online && z.zrodlo === 'agent'
      ? ['zmysly', ...cfg.kolejnoscTts.filter((x) => x !== 'zmysly')]
      : cfg.kolejnoscTts;
    for (const zrodlo of kolejnosc) {
      let zrob = null;
      if (zrodlo === 'elevenlabs' && elevenDla(u)) zrob = () => ttsEleven(tekst);
      else if (zrodlo === 'openai') { const ep = openaiDla(u); if (ep) zrob = () => ttsOpenAi(ep, tekst, jezyk); }
      else if (zrodlo === 'zmysly' && z.online) zrob = () => ttsZmysly(tekst);
      if (!zrob) continue;
      try {
        const { typ, buf } = await zrob();
        res.writeHead(200, { 'Content-Type': typ, 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Glos-Zrodlo': zrodlo });
        return res.end(buf);
      } catch (err) {
        if (zrodlo === 'zmysly' && z.zrodlo === 'dom') zapomnijZmysly();
        bledy.push(err.message);
      }
    }
    if (bledy.length) console.error('Czytanie na głos nie powiodło się:', bledy.join(' · '));
    // 502 = „weź głos systemowy" – przeglądarka ma go zawsze.
    return sendJson(res, 502, { error: 'Brak głosu na serwerze – przeglądarka użyje głosu systemowego.', brak: true });
  }

  return { handleStt, handleTts, mozliwosci, stanZmyslow, LOKALNE_STT };
}

module.exports = { utworz, TEKST_TTS_MAX };

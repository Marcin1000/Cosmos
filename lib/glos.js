/* Głos Cosmosa po stronie serwera — rozpoznawanie mowy (/api/stt) i czytanie
 * na głos (/api/tts) z jednego miejsca, z łańcuchem źródeł.
 *
 * DLACZEGO TO ISTNIEJE. Tryb głosowy bez piszczenia mikrofonu (public/nasluch.js:
 * mikrofon otwarty raz na sesję, wypowiedzi wycinane po energii sygnału) był
 * dostępny tylko z Whisperem w zmysłach — czyli przy włączonym komputerze
 * domowym. Na serwerze bez niego telefon wracał do Web Speech API, a Android
 * kwituje dźwiękiem każde uruchomienie i zamknięcie rozpoznawania. Marcin
 * słyszał to jako „ciągłe podłączanie i odłączanie mikrofonu".
 *
 * Teraz dźwięk ma zawsze dokąd pójść:
 *
 *   rozpoznawanie:  zmysły (Whisper, lokalnie, za darmo)
 *                 → własny serwer zgodny z OpenAI (STT_BASE_URL — np. NIM,
 *                   speaches/faster-whisper-server na własnym GPU)
 *                 → OpenAI (gpt-4o-mini-transcribe) — kluczem, do którego
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
 * do Cosmosa — po dotknięciu kuli albo w rozmowie, którą sam zaczął.
 */
'use strict';

const LOKALNE_STT = new Set(['zmysly', 'wlasny']);
const TEKST_TTS_MAX = 1200;      // jedna porcja czytania; klient dzieli dłuższe teksty sam

function utworz({ SENSES_URL, silniki, kto, sendJson, readBodyBuffer, readJson, env = process.env, STUDIO }) {
  const cfg = {
    sttBase: (env.STT_BASE_URL || '').replace(/\/+$/, ''),
    sttKey: env.STT_API_KEY || '',
    sttModel: env.STT_MODEL || 'whisper-1',
    sttLokalny: env.STT_LOKALNY !== '0',          // czy STT_BASE_URL stoi u siebie (domyślnie tak)
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
  async function stanZmyslow() {
    if (!SENSES_URL) return zmysly;
    if (Date.now() - zmysly.kiedy < 30000) return zmysly;
    try {
      const r = await fetch(`${SENSES_URL}/health`, { signal: AbortSignal.timeout(1500) });
      const caps = r.ok ? await r.json() : {};
      zmysly = { online: r.ok, caps: caps || {}, kiedy: Date.now() };
    } catch {
      zmysly = { online: false, caps: {}, kiedy: Date.now() };
    }
    return zmysly;
  }
  function zapomnijZmysly() { zmysly = { online: false, caps: {}, kiedy: 0 }; }

  function openaiDla(u) {
    const d = silniki.dostep('openai', u);
    return d.ok && d.ep && d.ep.apiKey ? d.ep : null;
  }
  const elevenDla = (u) => Boolean(STUDIO && STUDIO.eleven && STUDIO.eleven.key && silniki.studioDozwolone(u));

  /** Co z głosu działa w chmurze dla tej osoby — do /api/config. Zmysły
   *  zgłasza osobno /api/status, więc tu tylko to, co od nich niezależne. */
  function mozliwosci(u = kto()) {
    const sttChmura = Boolean(cfg.sttBase) || Boolean(openaiDla(u));
    let ttsChmura = '';
    for (const z of cfg.kolejnoscTts) {
      if (z === 'elevenlabs' && elevenDla(u)) { ttsChmura = 'elevenlabs'; break; }
      if (z === 'openai' && openaiDla(u)) { ttsChmura = 'openai'; break; }
    }
    return { sttChmura, sttLokalnyWlasny: Boolean(cfg.sttBase) && cfg.sttLokalny, ttsChmura };
  }

  // -------------------------------------------------------------------------
  // Rozpoznawanie
  // -------------------------------------------------------------------------

  async function sttZmysly(audio, typ) {
    const r = await fetch(`${SENSES_URL}/stt`, {
      method: 'POST', headers: { 'Content-Type': typ }, body: audio,
      signal: AbortSignal.timeout(60000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `zmysły: HTTP ${r.status}`);
    return String(d.text || '');
  }

  /** Dowolny serwer zgodny z OpenAI: /audio/transcriptions, multipart. */
  async function sttOpenAiZgodny(base, klucz, model, audio, typ, jezyk) {
    const rozsz = /wav/.test(typ) ? 'wav' : /ogg/.test(typ) ? 'ogg' : /mp4|m4a|aac/.test(typ) ? 'm4a' : /mpeg|mp3/.test(typ) ? 'mp3' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([audio], { type: typ }), `mowa.${rozsz}`);
    form.append('model', model);
    form.append('response_format', 'json');
    if (jezyk) form.append('language', jezyk);
    /* Podpowiedź pisowni: bez niej „Cosmos" wraca jako „kosmos", „Kosmos"
       albo „Cosmo's", a słowo budzące i tak łapie oba, ale rozmowa zapisuje
       się z błędem w nazwie produktu. */
    form.append('prompt', jezyk === 'en' ? 'Hey Cosmos.' : 'Hej, Cosmos.');
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
    const tylkoLokalnie = q.get('tryb') === 'nasluch';
    const typ = String(req.headers['content-type'] || 'audio/webm').split(';')[0];
    let audio;
    try { audio = await readBodyBuffer(req); } catch { return sendJson(res, 400, { error: 'Nie udało się odczytać nagrania.' }); }
    if (!audio || !audio.length) return sendJson(res, 400, { error: 'Puste nagranie.' });
    if (audio.length > 25 * 1024 * 1024) return sendJson(res, 413, { error: 'Nagranie jest za długie (limit 25 MB).' });

    const u = kto();
    const proby = [];
    const z = await stanZmyslow();
    if (z.online && z.caps.whisper) proby.push(['zmysly', () => sttZmysly(audio, typ)]);
    if (cfg.sttBase) proby.push(['wlasny', () => sttOpenAiZgodny(cfg.sttBase, cfg.sttKey, cfg.sttModel, audio, typ, jezyk)]);
    const oa = openaiDla(u);
    if (oa) proby.push(['openai', () => sttOpenAiZgodny(oa.baseUrl, oa.apiKey, cfg.openaiSttModel, audio, typ, jezyk)]);

    const dozwolone = proby.filter(([nazwa]) => !tylkoLokalnie
      || (nazwa === 'zmysly') || (nazwa === 'wlasny' && cfg.sttLokalny));
    const bledy = [];
    for (const [nazwa, zrob] of dozwolone) {
      try {
        const text = (await zrob()).trim();
        res.setHeader('X-Glos-Zrodlo', nazwa);
        return sendJson(res, 200, { text, zrodlo: nazwa });
      } catch (err) {
        if (nazwa === 'zmysly') zapomnijZmysly();   // przy następnym razie zapytaj od nowa
        bledy.push(`${nazwa}: ${err.message}`);
      }
    }
    if (!dozwolone.length) {
      return sendJson(res, 502, {
        error: tylkoLokalnie
          ? 'Nasłuch słowa budzącego potrzebuje lokalnego Whispera (usługa zmysłów).'
          : 'Rozpoznawanie mowy jest niedostępne: nie działa Whisper w zmysłach, a na serwerze nie ma klucza do rozpoznawania w chmurze (OpenAI albo STT_BASE_URL).',
        brak: true,
      });
    }
    console.error('Rozpoznawanie mowy nie powiodło się:', bledy.join(' · '));
    return sendJson(res, 502, { error: 'Nie udało się rozpoznać mowy. Spróbuj jeszcze raz.' });
  }

  // -------------------------------------------------------------------------
  // Czytanie na głos
  // -------------------------------------------------------------------------

  async function ttsZmysly(tekst) {
    const r = await fetch(`${SENSES_URL}/tts`, {
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
    const z = await stanZmyslow();

    const bledy = [];
    for (const zrodlo of cfg.kolejnoscTts) {
      let zrob = null;
      if (zrodlo === 'elevenlabs' && elevenDla(u)) zrob = () => ttsEleven(tekst);
      else if (zrodlo === 'openai') { const ep = openaiDla(u); if (ep) zrob = () => ttsOpenAi(ep, tekst, jezyk); }
      else if (zrodlo === 'zmysly' && z.online && z.caps.piper) zrob = () => ttsZmysly(tekst);
      if (!zrob) continue;
      try {
        const { typ, buf } = await zrob();
        res.writeHead(200, { 'Content-Type': typ, 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Glos-Zrodlo': zrodlo });
        return res.end(buf);
      } catch (err) {
        if (zrodlo === 'zmysly') zapomnijZmysly();
        bledy.push(err.message);
      }
    }
    if (bledy.length) console.error('Czytanie na głos nie powiodło się:', bledy.join(' · '));
    // 502 = „weź głos systemowy" — przeglądarka ma go zawsze.
    return sendJson(res, 502, { error: 'Brak głosu na serwerze — przeglądarka użyje głosu systemowego.', brak: true });
  }

  return { handleStt, handleTts, mozliwosci, stanZmyslow, LOKALNE_STT };
}

module.exports = { utworz, TEKST_TTS_MAX };

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
const { bladTrwaly } = require('./rdzen.js');

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
  async function sttZmysly(audio, typ, { jezyk = '', tryb = '', sygnal } = {}) {
    const qs = new URLSearchParams();
    if (jezyk) qs.set('jezyk', jezyk);
    if (tryb) qs.set('tryb', tryb);
    const r = await Z.fetch(`/stt${qs.toString() ? `?${qs}` : ''}`, {
      method: 'POST', headers: { 'Content-Type': typ }, body: audio,
      signal: sygnal || AbortSignal.timeout(60000),
    });
    const d = await r.json().catch(() => ({}));
    // Status jedzie z błędem: 501 = w tych zmysłach nie ma Whispera (pomijamy je, to nie awaria).
    if (!r.ok) throw Object.assign(new Error(trescBledu(d) || `zmysły: HTTP ${r.status}`), { status: r.status });
    return String(d.text || '');
  }

  /* Treść błędu z odpowiedzi usługi: OpenAI ma `{error: {message}}`, a serwery na
     FastAPI (speaches, faster-whisper-server, nasze zmysły) – `{detail: …}`. Bez
     `detail` w dzienniku zostawało samo „HTTP 404” i nie było widać, że serwer
     nie zna modelu z STT_MODEL (zespół IT, runda 9). */
  function trescBledu(d) {
    if (!d || typeof d !== 'object') return '';
    if (d.error) return String((typeof d.error === 'object' && d.error.message) || (typeof d.error === 'string' ? d.error : JSON.stringify(d.error))).slice(0, 300);
    return '';
  }

  /* Rozszerzenie pliku dla usługi: OpenAI rozpoznaje format PO NAZWIE pliku.
     Opus z telefonu (audio/opus) to kontener Ogg – jako .webm dostawał odmowę. */
  function rozszerzenieAudio(typ) {
    return /wav/.test(typ) ? 'wav' : /ogg|opus/.test(typ) ? 'ogg' : /flac/.test(typ) ? 'flac'
      : /mp4|m4a|aac/.test(typ) ? 'm4a' : /mpeg|mp3/.test(typ) ? 'mp3' : 'webm';
  }

  /** Dowolny serwer zgodny z OpenAI: /audio/transcriptions, multipart. */
  async function sttOpenAiZgodny(base, klucz, model, audio, typ, jezyk, tryb = '', czasMs = 60000, sygnal = null) {
    const rozsz = rozszerzenieAudio(typ);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: /opus/.test(typ) ? 'audio/ogg' : typ }), `mowa.${rozsz}`);
    form.append('model', model);
    form.append('response_format', 'json');
    if (jezyk) form.append('language', jezyk);
    /* Podpowiedź pisowni: bez niej „Cosmos" wraca jako „kosmos", „Kosmos"
       albo „Cosmo's", a słowo budzące i tak łapie oba, ale rozmowa zapisuje
       się z błędem w nazwie produktu. Przy nasłuchu słowa budzącego – nie:
       na szumie model „słyszy” samą podpowiedź i Cosmos budził się sam
       (tak samo jak w usłudze zmysłów). Przy nagraniu z bazy wiedzy też nie:
       to wykład albo spotkanie, a nie rozmowa z Cosmosem – cisza na początku
       dawała „Hej, Cosmos.” w tekście (zespół IT, runda 9). */
    if (tryb !== 'nasluch' && tryb !== 'plik') form.append('prompt', jezyk === 'en' ? 'Hey Cosmos.' : 'Hej, Cosmos.');
    const headers = klucz ? { Authorization: `Bearer ${klucz}` } : {};
    const r = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST', headers, body: form,
      signal: sygnal ? AbortSignal.any([sygnal, AbortSignal.timeout(czasMs)]) : AbortSignal.timeout(czasMs),
    });
    const d = await r.json().catch(() => ({}));
    // Status i kod dostawcy jadą z błędem – po nich poznajemy błąd trwały (klucz, środki).
    if (!r.ok) {
      const tresc = trescBledu(d) || `HTTP ${r.status}`;
      throw Object.assign(new Error(tresc), { status: r.status, kodDostawcy: d.error && d.error.code });
    }
    return String(d.text || '');
  }

  const blad = (tresc, pola) => Object.assign(new Error(tresc), pola);

  /**
   * Łańcuch rozpoznawania dla osoby `u`: zmysły → własny serwer → OpenAI.
   * Jedno miejsce dla rozmowy (/api/stt) i dla nagrań w bazie wiedzy – dawniej
   * baza wiedzy znała tylko zmysły i bez komputera w domu nagranie zostawało
   * bez tekstu, choć rozmowa przepisywała je w chmurze (agencja, runda 8).
   *
   * @returns {Promise<{text: string, zrodlo: string}>}
   * @throws  Error z `kod`: 'brak' (żadnego źródła), 'zmysly-offline' (wszystkie
   *          padły na połączeniu), 'stt-trwaly' (zły klucz, brak środków –
   *          ponawianie nic nie da), 'stt-blad' (reszta)
   */
  async function przepisz(u, audio, typ, {
    jezyk = '', tryb = 'pytanie', tylkoLokalnie = false, pominZmysly = false, czasMs = 60000,
    budzetMs = 0, sygnal = null,
  } = {}) {
    /* Wspólny termin całego łańcucha. Dawniej każde źródło miało własne 60 s:
       uśpiony komputer w domu (zmysły i STT_BASE_URL w tej samej sieci) zjadał
       2 × 60 s, Cloudflare po 100 s oddawał stronę 524, a Cosmos i tak płacił
       potem OpenAI za transkrypcję, której nikt nie odebrał (zespół IT, runda 9).
       Z budżetem (rozmowa, /api/stt) źródło domowe dostaje najwyżej 25 s, a próba,
       na którą zostało mniej niż 5 s, w ogóle nie rusza. Baza wiedzy (w tle) –
       bez budżetu, jak dawniej. */
    const koniec = budzetMs ? Date.now() + budzetMs : Infinity;
    const DOM_MS = Number(env.COSMOS_GLOS_DOM_MS) || 25_000;
    const MIN_MS = 5_000;
    const zostalo = () => koniec - Date.now();
    const czasProby = (domowe) => Math.min(domowe && budzetMs ? DOM_MS : czasMs, zostalo());
    const sygnalProby = (ms) => (sygnal ? AbortSignal.any([sygnal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

    const proby = [];
    const z = pominZmysly ? { online: false } : await stanZmyslow(u);
    /* Zmysły pytamy zawsze, gdy żyją – nie tylko gdy zgłaszają Whispera. Deklaracja
       bywa nieaktualna (model doinstalowany bez restartu), a bez Whispera usługa
       i tak odpowie 501 i przejdziemy dalej. */
    if (z.online) proby.push(['zmysly', true, (ms) => sttZmysly(audio, typ, { jezyk, tryb, sygnal: sygnalProby(ms) })]);
    if (wlasnyDla(u)) proby.push(['wlasny', cfg.sttLokalny, (ms) => sttOpenAiZgodny(cfg.sttBase, cfg.sttKey, cfg.sttModel, audio, typ, jezyk, tryb, ms, sygnal)]);
    const oa = openaiDla(u);
    /* Nagranie z bazy wiedzy idzie do whisper-1: gpt-4o-(mini-)transcribe odrzuca
       nagrania dłuższe niż 1500 s i ucina tekst po ~2 tys. tokenów, a 25 MB opus
       z telefonu to ponad godzina (zespół IT, runda 9). Rozmowa – szybszy model. */
    const modelOpenAi = tryb === 'plik' ? (env.STT_OPENAI_MODEL_PLIK || 'whisper-1') : cfg.openaiSttModel;
    if (oa) proby.push(['openai', false, (ms) => sttOpenAiZgodny(oa.baseUrl, oa.apiKey, modelOpenAi, audio, typ, jezyk, tryb, ms, sygnal)]);

    const dozwolone = proby.filter(([nazwa]) => !tylkoLokalnie
      || (nazwa === 'zmysly') || (nazwa === 'wlasny' && cfg.sttLokalny));
    if (!dozwolone.length) throw blad('brak źródła rozpoznawania', { kod: 'brak' });
    const bledy = [];
    let polaczenia = 0;
    let trwale = 0;
    let pominiete = 0;
    const trwaleZrodla = [];
    for (const [nazwa, domowe, zrob] of dozwolone) {
      // Klient odszedł (albo Cloudflare zamknął połączenie) – nie wołamy już nikogo, zwłaszcza płatnej chmury.
      if (sygnal && sygnal.aborted) throw blad('klient się rozłączył', { kod: 'przerwane' });
      const ms = czasProby(domowe);
      if (ms < MIN_MS) { polaczenia++; bledy.push(`${nazwa}: pominięte – koniec czasu`); continue; }
      try {
        return { text: (await zrob(ms)).trim(), zrodlo: nazwa };
      } catch (err) {
        if (sygnal && sygnal.aborted) throw blad('klient się rozłączył', { kod: 'przerwane' });
        if (nazwa === 'zmysly') zapomnijZmysly();   // przy następnym razie zapytaj od nowa
        /* 501 ze zmysłów = nie ma w nich Whispera. To nie awaria, tylko brak tego
           źródła – inaczej zmysły bez Whispera + odrzucony klucz OpenAI dawały
           „stt-blad” i trzy zgubione wypowiedzi (agencja, runda 9). */
        if (nazwa === 'zmysly' && err.status === 501) pominiete++;
        else if (err.cause?.code || err.name === 'TimeoutError' || /fetch failed/.test(err.message)) polaczenia++;
        else if (err.status && bladTrwaly(err.status, `${err.kodDostawcy || ''} ${err.message}`)) { trwale++; trwaleZrodla.push(nazwa); }
        bledy.push(`${nazwa}: ${err.message}`);
      }
    }
    console.error('Rozpoznawanie mowy nie powiodło się:', bledy.join(' · '));
    // Same zmysły bez Whispera – to brak źródła, nie błąd do ponawiania.
    if (pominiete === dozwolone.length) throw blad(bledy.join(' · '), { kod: 'brak' });
    if (polaczenia && polaczenia + pominiete === dozwolone.length) throw blad(bledy.join(' · '), { kod: 'zmysly-offline' });
    /* Ostatnie źródło (chmura) padło na kluczu albo środkach, a wcześniejsze na
       połączeniu: ponawianie da to samo. Przeglądarka przechodzi od razu na
       własne rozpoznawanie, zamiast gubić trzy wypowiedzi (zespół IT, runda 8). */
    if (trwale && trwale + polaczenia + pominiete === dozwolone.length) {
      throw blad(bledy.join(' · '), { kod: 'stt-trwaly', trwaleZrodla });
    }
    throw blad(bledy.join(' · '), { kod: 'stt-blad' });
  }

  /** Sygnał zerwania, gdy klient (albo Cloudflare) zamknie połączenie przed odpowiedzią. */
  function sygnalKlienta(res) {
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(new Error('klient się rozłączył')); });
    return ac.signal;
  }
  /* Budżet rozmowy: przeglądarka czeka za Cloudflare'em najwyżej 100 s, a zasada
     z CLAUDE.md to ~90 s na każde żądanie, na które ktoś czeka. */
  const BUDZET_ROZMOWY_MS = Number(env.COSMOS_GLOS_BUDZET_MS) || 85_000;

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

    const tryb = q.get('tryb') === 'nasluch' ? 'nasluch' : podglad ? 'podglad' : 'pytanie';
    const sygnal = sygnalKlienta(res);
    try {
      const { text, zrodlo } = await przepisz(kto(), audio, typ, { jezyk, tryb, tylkoLokalnie, budzetMs: BUDZET_ROZMOWY_MS, sygnal });
      if (sygnal.aborted) return undefined;
      res.setHeader('X-Glos-Zrodlo', zrodlo);
      return sendJson(res, 200, { text, zrodlo });
    } catch (err) {
      // Nikt już nie czeka na odpowiedź – nie ma komu jej pisać.
      if (err.kod === 'przerwane' || sygnal.aborted) return undefined;
      // Brak szkicu to nie błąd – przeglądarka przestaje o niego prosić.
      if (err.kod === 'brak' && podglad) return sendJson(res, 200, { text: '', bezPodgladu: true });
      if (err.kod === 'brak') {
        return sendJson(res, 502, {
          error: tylkoLokalnie
            ? 'Nasłuch słowa budzącego potrzebuje lokalnego Whispera (usługa zmysłów).'
            : 'Rozpoznawanie mowy jest niedostępne: nie działa Whisper w zmysłach, a na serwerze nie ma klucza do rozpoznawania w chmurze (OpenAI albo STT_BASE_URL).',
          brak: true,
        });
      }
      /* Wszystkie źródła padły na POŁĄCZENIU (komputer domowy zasnął w trakcie
         rozmowy): przeglądarka ma od razu przejść na własne rozpoznawanie, a nie
         czekać na trzecią porażkę (zespół IT, runda 5). Zdanie bez „Nie udało
         się rozpoznać mowy" – ten początek dokłada przeglądarka. */
      if (err.kod === 'zmysly-offline') {
        return sendJson(res, 502, { kod: 'zmysly-offline', error: 'rozpoznawanie przestało odpowiadać (komputer ze zmysłami śpi albo nie ma sieci).' });
      }
      if (err.kod === 'stt-trwaly') {
        /* Padł trwale WŁASNY serwer rozpoznawania (np. speaches bez modelu z STT_MODEL
           – 404 „model not installed”), a nie chmura. Dawniej zdanie mówiło o kluczu
           w chmurze i właściciel szukał błędu nie tam (zespół IT, runda 9). Członek
           nie dostaje nazw zmiennych ani adresu. */
        const tylkoWlasny = (err.trwaleZrodla || []).length && err.trwaleZrodla.every((z) => z === 'wlasny');
        if (tylkoWlasny) {
          return sendJson(res, 502, {
            kod: 'stt-trwaly', zrodlo: 'wlasny',
            error: kto()?.rola === 'wlasciciel' || !kto()
              ? 'własny serwer rozpoznawania (STT_BASE_URL) nie zna modelu z STT_MODEL albo odrzuca klucz – przechodzę na rozpoznawanie w przeglądarce.'
              : 'serwer rozpoznawania mowy odrzuca nagrania – przechodzę na rozpoznawanie w przeglądarce.',
          });
        }
        return sendJson(res, 502, { kod: 'stt-trwaly', error: 'rozpoznawanie w chmurze odrzuca klucz albo skończyły się środki – przechodzę na rozpoznawanie w przeglądarce.' });
      }
      return sendJson(res, 502, { kod: 'stt-blad', error: 'usługa odpowiedziała błędem. Spróbuj jeszcze raz.' });
    }
  }

  // -------------------------------------------------------------------------
  // Czytanie na głos
  // -------------------------------------------------------------------------

  async function ttsZmysly(tekst, sygnal) {
    const r = await Z.fetch('/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: tekst }), signal: sygnal,
    });
    if (!r.ok) throw new Error(`zmysły: HTTP ${r.status}`);
    return { typ: r.headers.get('content-type') || 'audio/wav', buf: Buffer.from(await r.arrayBuffer()) };
  }

  async function ttsEleven(tekst, sygnal) {
    const e = STUDIO.eleven;
    const r = await fetch(`${e.base}/v1/text-to-speech/${encodeURIComponent(e.voice)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': e.key },
      body: JSON.stringify({ text: tekst, model_id: cfg.elevenModel }),
      signal: sygnal,
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const d = await r.json(); msg = (d.detail && (d.detail.message || d.detail)) || msg; } catch { /* nie-JSON */ }
      throw new Error(`ElevenLabs: ${msg}`);
    }
    return { typ: 'audio/mpeg', buf: Buffer.from(await r.arrayBuffer()) };
  }

  async function ttsOpenAi(ep, tekst, jezyk, sygnal) {
    const r = await fetch(`${ep.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ep.apiKey}` },
      body: JSON.stringify({
        model: cfg.openaiTtsModel, voice: cfg.openaiTtsGlos, input: tekst, response_format: 'mp3',
        instructions: jezyk === 'en'
          ? 'Speak naturally and warmly, at a calm conversational pace.'
          : 'Mów po polsku, naturalnie i ciepło, w spokojnym tempie rozmowy. Poprawny polski akcent.',
      }),
      signal: sygnal,
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
    /* Ten sam wspólny termin co przy rozpoznawaniu: trzy źródła po 60 s to
       3 minuty, a Cloudflare zamyka po 100 s. Klient odszedł – nie płacimy
       ElevenLabs ani OpenAI za zdanie, którego nikt nie usłyszy (zespół IT, runda 9). */
    const koniec = Date.now() + BUDZET_ROZMOWY_MS;
    const DOM_MS = Number(env.COSMOS_GLOS_DOM_MS) || 25_000;
    const klient = sygnalKlienta(res);

    const bledy = [];
    /* Zaproszona osoba z działającym Piperem na własnym komputerze czyta
       na nim – inaczej za każde zdanie płacił właściciel (OpenAI, ElevenLabs),
       choć darmowy głos stał obok (zespół IT, runda 6). */
    const kolejnosc = u && u.rola !== 'wlasciciel' && z.online && z.zrodlo === 'agent'
      ? ['zmysly', ...cfg.kolejnoscTts.filter((x) => x !== 'zmysly')]
      : cfg.kolejnoscTts;
    for (const zrodlo of kolejnosc) {
      let zrob = null;
      if (zrodlo === 'elevenlabs' && elevenDla(u)) zrob = (s) => ttsEleven(tekst, s);
      else if (zrodlo === 'openai') { const ep = openaiDla(u); if (ep) zrob = (s) => ttsOpenAi(ep, tekst, jezyk, s); }
      else if (zrodlo === 'zmysly' && z.online) zrob = (s) => ttsZmysly(tekst, s);
      if (!zrob) continue;
      if (klient.aborted) return undefined;
      const ms = Math.min(zrodlo === 'zmysly' ? DOM_MS : 60_000, koniec - Date.now());
      if (ms < 5000) { bledy.push(`${zrodlo}: pominięte – koniec czasu`); continue; }
      try {
        const { typ, buf } = await zrob(AbortSignal.any([klient, AbortSignal.timeout(ms)]));
        if (klient.aborted) return undefined;
        res.writeHead(200, { 'Content-Type': typ, 'Content-Length': buf.length, 'Cache-Control': 'no-store', 'X-Glos-Zrodlo': zrodlo });
        return res.end(buf);
      } catch (err) {
        if (klient.aborted) return undefined;
        if (zrodlo === 'zmysly' && z.zrodlo === 'dom') zapomnijZmysly();
        bledy.push(err.message);
      }
    }
    if (bledy.length) console.error('Czytanie na głos nie powiodło się:', bledy.join(' · '));
    // 502 = „weź głos systemowy" – przeglądarka ma go zawsze.
    return sendJson(res, 502, { error: 'Brak głosu na serwerze – przeglądarka użyje głosu systemowego.', brak: true });
  }

  return { handleStt, handleTts, mozliwosci, stanZmyslow, przepisz, LOKALNE_STT };
}

module.exports = { utworz, TEKST_TTS_MAX };

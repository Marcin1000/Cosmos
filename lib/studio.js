/* ============================================================
   Studio – generowanie mediów (OpenAI / Firefly / ElevenLabs / Seedance)

   Każdy wynik trafia do bazy wiedzy, żeby dało się do niego wrócić,
   i opcjonalnie do katalogu eksportu na dysku.
   ============================================================ */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { STUDIO, authHeaders, imageProviders, pickEndpoint, readJson, sendJson, studioTasks } = require('./rdzen.js');
const { parseModelResponse, llmComplete } = require('./model.js');
const { kto, czyWlasciciel } = require('./kontekst.js');
const { zmyslyDostepne, fetchZmyslow } = require('./agent-zmyslow.js');

/* Wstrzykiwane przez server.js – te elementy należą do innych dziedzin.
   Zamiast krzyżowych `require` (i pułapki cyklicznych zależności) serwer
   podaje je raz, przy starcie. */
/* `kbPliki` i `kbPozycje` to funkcje: baza wiedzy należy do bieżącej osoby,
   więc wartość wstrzyknięta przy starcie byłaby bazą wiedzy kogoś innego. */
let kbPliki, addEvent, kbAddFile, kbItemMeta, kbPozycje, zadania;
/* Budżet w złotówkach (lib/budzet.js), cennik usług (lib/cennik.js) i zapis
   zużycia (lib/konta.js). Brak (testy modułu) = bez pilnowania budżetu. */
let budzet = null, cennik = null, konta = null;
function polacz(z) {
  ({ kbPliki, addEvent, kbAddFile, kbItemMeta, kbPozycje, zadania } = z);
  budzet = z.budzet || null;
  cennik = z.cennik || null;
  konta = z.konta || null;
}

/* ---------------------------------------------------------------------------
   Budżet Studia. Klucze Studia (OpenAI obrazów, Firefly, ElevenLabs, Seedance)
   są zawsze kluczami WŁAŚCICIELA – członek korzysta z nich z przyznania
   „studio”. Dawniej szły poza budżetem w zł: członek po wyczerpaniu limitu dalej
   generował obrazy, storyboardy i wideo na rachunek właściciela (zespół IT,
   etap 5). Teraz: szacunek całej pracy z cennika usług → rezerwacja (odmowa =
   429 budzet-wyczerpany, jak czat) → po każdym wyniku koszt do zużycia osoby →
   rozliczenie rezerwacji na końcu zadania (także w tle – lib/zadania.js niesie
   kontekst osoby, a osobę i tak przypinamy przy starcie).
   --------------------------------------------------------------------------- */
const zrodloStudia = (u) => (!u || u.rola === 'wlasciciel' ? 'wlasciciel' : 'przyznany');
const kosztUslugi = (rodzaj, model, ilosc) => (cennik && typeof cennik.kosztUslugiZl === 'function'
  ? cennik.kosztUslugiZl(rodzaj, model, ilosc).zl : 0);

/**
 * Zarezerwuj budżet na pracę Studia. Oddaje obiekt rozliczenia albo – przy
 * wyczerpanym budżecie – `{ odmowa }` z gotową odpowiedzią 429.
 * @param {number} szacunekZl  koszt całej pracy (np. 4 warianty obrazu)
 */
function zarezerwujStudio(szacunekZl) {
  const u = kto();
  const rozl = { u, zrodlo: zrodloStudia(u), token: null, wydano: 0 };
  if (!budzet || !u || !u.id) return rozl;
  const naKluczuWlasciciela = ((konta && konta.NA_KLUCZU_WLASCICIELA) || ['wlasciciel', 'przyznany']).includes(rozl.zrodlo);
  const w = budzet.wyczerpany(u, { naKluczuWlasciciela });
  const r = w ? null : budzet.zarezerwuj(u, szacunekZl, { naKluczuWlasciciela });
  const odm = w || (r && !r.ok ? r : null);
  if (odm) {
    const okres = odm.okres === 'dzien' ? 'dzienny' : 'miesięczny';
    const blad = odm.limit === 'wlasciciel'
      ? `Wyczerpany ${okres} budżet na płatne modele, który ustawił właściciel – Studio (obrazy, dźwięk, wideo) też się do niego liczy. Poproś właściciela o większy limit.`
      : `Wyczerpany Twój ${okres} budżet na płatne modele (Ustawienia → Agenci) – Studio (obrazy, dźwięk, wideo) też się do niego liczy.`;
    return { odmowa: { kod: 'budzet-wyczerpany', error: blad, blad, zostalo: odm.zostalo || 0, okres: odm.okres, limit: odm.limit } };
  }
  rozl.token = r.token;
  return rozl;
}

/** Jeden płatny wynik gotowy – koszt do zużycia osoby (silnik 'openai' dla
 *  klucza OpenAI, 'studio' dla Firefly, ElevenLabs i Seedance). */
function zanotujStudio(rozl, { silnik, model, zl }) {
  if (!rozl || !konta || !rozl.u || !rozl.u.id) return;
  rozl.wydano += zl;
  try {
    konta.zanotujZuzycie(rozl.u.id, { silnik, zrodlo: rozl.zrodlo, model, zl });
  } catch (err) { console.error('Zużycie Studia nie zapisało się:', err.message); }
}

/** Koniec pracy (wynik albo błąd): rezerwacja zwolniona, wydatek już zapisany. */
function rozliczStudio(rozl) {
  if (rozl && rozl.token && budzet) budzet.rozlicz(rozl.token, rozl.wydano);
}

/* Kod HTTP z błędu: `kod` bywa słowem (odmowa budżetu z llmComplete –
   „budzet-wyczerpany”), a writeHead przyjmuje tylko liczbę. */
function kodHttp(err, domyslny = 502) {
  if (err && Number.isInteger(err.kod) && err.kod >= 400 && err.kod < 600) return err.kod;
  if (err && err.kod === 'budzet-wyczerpany') return 429;
  return domyslny;
}

const modelObrazu = (provider, size) => (provider === 'firefly' ? 'firefly' : `${STUDIO.openai.imageModel}@${size}`);
const silnikObrazu = (provider) => (provider === 'firefly' ? 'studio' : 'openai');

/* Generowanie potrafi trwać dłużej niż 100 s, po których Cloudflare zrywa
   żądanie (524). Praca idzie więc przez zadanie w tle (lib/zadania.js): zdąży
   – zwykła odpowiedź, jak dawniej; nie zdąży – 202 z numerem, który
   przeglądarka dopytuje. Walidacja zostaje PRZED zadaniem: zły prompt ma
   dostać 400 od razu, a nie numer zadania, które i tak padnie. */
async function wTle(res, rodzaj, opis, praca, rozl = null) {
  let z;
  try { z = zadania.zacznij(rodzaj, opis, praca); } catch (err) {
    // Zadanie nie ruszyło (np. za dużo naraz) – rezerwacja budżetu wraca od razu.
    rozliczStudio(rozl);
    return sendJson(res, err.kod || 500, { error: err.message });
  }
  return zadania.odpowiedz(res, z);
}

/** Błąd z kodem HTTP innym niż domyślne 502. */
function bladHttp(kod, wiadomosc) {
  const e = new Error(wiadomosc);
  e.kod = kod;
  return e;
}

// ---------------------------------------------------------------------------
// API: Studio – generowanie mediów (OpenAI / ElevenLabs / Seedance)
// Każdy wynik trafia do bazy wiedzy i (opcjonalnie) do folderu eksportu
// (STUDIO_EXPORT_DIR – np. folder projektu Adobe).
// ---------------------------------------------------------------------------

/* Folder eksportu jest folderem WŁAŚCICIELA (projekt Adobe na jego dysku).
   Wyniki członków szły tam razem z jego – widział cudze obrazy, a dwie osoby
   w tej samej sekundzie nadpisywały sobie plik. Członek ma swoje w bazie wiedzy. */
function exportToStudioDir(name, buf) {
  if (!STUDIO.exportDir || !czyWlasciciel()) return '';
  try {
    fs.mkdirSync(STUDIO.exportDir, { recursive: true });
    const p = path.join(STUDIO.exportDir, name);
    fs.writeFileSync(p, buf);
    return p;
  } catch (err) {
    console.error('Eksport nie powiódł się:', err.message);
    return '';
  }
}

function tsName(prefix, ext) {
  const t = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  return `${prefix}-${t}.${ext}`;
}

// --- Adobe Firefly: token IMS (server-to-server) z pamięcią podręczną ---

let fireflyTokenCache = { token: '', exp: 0 };

async function getFireflyToken() {
  if (fireflyTokenCache.token && Date.now() < fireflyTokenCache.exp) return fireflyTokenCache.token;
  const r = await fetch(`${STUDIO.firefly.imsUrl}/ims/token/v3`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: STUDIO.firefly.clientId,
      client_secret: STUDIO.firefly.clientSecret,
      scope: 'openid,AdobeID,firefly_api,ff_apis',
    }),
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) {
    throw new Error(d.error_description || d.error || 'Nie udało się pobrać tokenu Adobe IMS.');
  }
  fireflyTokenCache = {
    token: d.access_token,
    exp: Date.now() + Math.max(60, (d.expires_in || 3600) - 300) * 1000,
  };
  return d.access_token;
}

async function fireflyGenerateImage(prompt, size) {
  const token = await getFireflyToken();
  const dims = size === '1536x1024' ? { width: 2304, height: 1792 }
    : size === '1024x1536' ? { width: 1792, height: 2304 }
    : { width: 2048, height: 2048 };
  const r = await fetch(`${STUDIO.firefly.base}/v3/images/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-api-key': STUDIO.firefly.clientId,
    },
    body: JSON.stringify({ prompt, size: dims, numVariations: 1 }),
    signal: AbortSignal.timeout(180000),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || d.error_code || `HTTP ${r.status}`);
  const url = d.outputs?.[0]?.image?.url;
  if (!url) throw new Error('Firefly nie zwrócił obrazu.');
  return Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(120000) })).arrayBuffer());
}


// Wygeneruj jeden obraz (dowolny skonfigurowany silnik) → wpis w bazie wiedzy.
async function studioGenImage(prompt, size, provider, rozl = null) {
  const providers = imageProviders();
  const prov = providers.some((p) => p.id === provider) ? provider : providers[0]?.id;
  let buf; let engineLabel;
  if (prov === 'firefly') {
    buf = await fireflyGenerateImage(prompt, size); engineLabel = 'Adobe Firefly';
  } else {
    const body = { model: STUDIO.openai.imageModel, prompt, size, n: 1 };
    if (!STUDIO.openai.imageModel.startsWith('gpt-image')) body.response_format = 'b64_json';
    const r = await fetch(`${STUDIO.openai.base}/images/generations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STUDIO.openai.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    const resp = await r.json();
    if (!r.ok) throw new Error(resp.error?.message || `HTTP ${r.status}`);
    const first = resp.data?.[0] || {};
    if (first.b64_json) buf = Buffer.from(first.b64_json, 'base64');
    else if (first.url) buf = Buffer.from(await (await fetch(first.url, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
    else throw new Error('API nie zwróciło obrazu.');
    engineLabel = STUDIO.openai.imageModel;
  }
  zanotujStudio(rozl, { silnik: silnikObrazu(prov), model: modelObrazu(prov, size), zl: kosztUslugi('obraz', modelObrazu(prov, size), 1) });
  const name = tsName('obraz', 'png');
  const item = await kbAddFile(name, 'image/png', buf,
    `Grafika wygenerowana w Studiu (silnik: ${engineLabel}). Prompt: ${prompt}`);
  exportToStudioDir(name, buf);
  return { item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` };
}

async function handleStudio(req, res, pathname) {
  if (pathname === '/api/studio/providers' && req.method === 'GET') {
    return sendJson(res, 200, {
      image: imageProviders().length > 0,
      imageProviders: imageProviders(),
      speech: Boolean(STUDIO.eleven.key),
      video: Boolean(STUDIO.seedance.key),
      imageModel: STUDIO.openai.imageModel,
      voice: STUDIO.eleven.voice,
      videoModel: STUDIO.seedance.model,
      exportDir: czyWlasciciel() ? STUDIO.exportDir : null,
    });
  }

  // --- OBRAZ (OpenAI lub Adobe Firefly) ---
  if (pathname === '/api/studio/image' && req.method === 'POST') {
    const providers = imageProviders();
    if (!providers.length) {
      return sendJson(res, 400, {
        error: 'Brak silnika obrazów. Ustaw OPENAI_API_KEY albo FIREFLY_CLIENT_ID + FIREFLY_CLIENT_SECRET w .env.',
      });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const prompt = String(data.prompt || '').trim();
    if (!prompt) return sendJson(res, 400, { error: 'Puste pole prompt.' });
    const size = ['1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792']
      .includes(data.size) ? data.size : '1024x1024';
    const provider = providers.some((p) => p.id === data.provider) ? data.provider : providers[0].id;
    const count = Math.min(4, Math.max(1, parseInt(data.count, 10) || 1)); // liczba wariantów

    const genOne = async () => {
      if (provider === 'firefly') {
        return { buf: await fireflyGenerateImage(prompt, size), engineLabel: 'Adobe Firefly' };
      }
      const body = { model: STUDIO.openai.imageModel, prompt, size, n: 1 };
      if (!STUDIO.openai.imageModel.startsWith('gpt-image')) body.response_format = 'b64_json';
      const r = await fetch(`${STUDIO.openai.base}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STUDIO.openai.key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000),
      });
      const resp = await r.json();
      if (!r.ok) throw new Error(resp.error?.message || `HTTP ${r.status}`);
      const first = resp.data?.[0] || {};
      let buf;
      if (first.b64_json) buf = Buffer.from(first.b64_json, 'base64');
      else if (first.url) buf = Buffer.from(await (await fetch(first.url, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
      else throw new Error('API nie zwróciło obrazu.');
      return { buf, engineLabel: STUDIO.openai.imageModel };
    };

    const rozl = zarezerwujStudio(count * kosztUslugi('obraz', modelObrazu(provider, size), 1));
    if (rozl.odmowa) return sendJson(res, 429, rozl.odmowa);
    return wTle(res, 'obraz', prompt, async () => {
      try {
        const items = [];
        let engineLabel = '';
        for (let k = 0; k < count; k++) {
          const { buf, engineLabel: lbl } = await genOne();
          zanotujStudio(rozl, { silnik: silnikObrazu(provider), model: modelObrazu(provider, size), zl: kosztUslugi('obraz', modelObrazu(provider, size), 1) });
          engineLabel = lbl;
          const name = tsName('obraz', 'png');
          const item = await kbAddFile(name, 'image/png', buf,
            `Grafika wygenerowana w Studiu (silnik: ${lbl}). Prompt: ${prompt}`);
          exportToStudioDir(name, buf);
          items.push({ item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` });
        }
        addEvent('studio', `wygenerowano ${count > 1 ? count + ' warianty obrazu' : 'obraz'} (${engineLabel}): „${prompt.slice(0, 80)}”`);
        // zgodność wstecz: pierwszy obraz jako item/url (dla znacznika [OBRAZ:] w czacie)
        return { ok: true, provider, items, item: items[0].item, url: items[0].url };
      } catch (err) {
        throw bladHttp(kodHttp(err), `Generowanie obrazu nie powiodło się: ${err.message}`);
      } finally {
        rozliczStudio(rozl);
      }
    }, rozl);
  }

  // --- STORYBOARD (scena → ujęcia → obraz na ujęcie) ---
  if (pathname === '/api/studio/storyboard' && req.method === 'POST') {
    if (!imageProviders().length) {
      return sendJson(res, 400, { error: 'Brak silnika obrazów (OPENAI_API_KEY / Firefly).' });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const scene = String(data.scene || '').trim();
    if (!scene) return sendJson(res, 400, { error: 'Puste pole scene.' });
    const shots = Math.min(6, Math.max(2, parseInt(data.shots, 10) || 4));
    const size = data.size || '1536x1024';
    const providers = imageProviders();
    const provSb = providers.some((p) => p.id === data.provider) ? data.provider : providers[0].id;
    // Obrazy ujęć; opis ujęć (llmComplete) pilnuje osobno księgowy modeli w server.js.
    const rozl = zarezerwujStudio(shots * kosztUslugi('obraz', modelObrazu(provSb, size), 1));
    if (rozl.odmowa) return sendJson(res, 429, rozl.odmowa);
    return wTle(res, 'storyboard', scene, async () => {
      try {
        const raw = await llmComplete([
          { role: 'system', content: 'Jesteś reżyserem. Rozpisz scenę na ujęcia filmowe. ' +
            'Zwróć WYŁĄCZNIE tablicę JSON stringów – po jednym szczegółowym opisie kadru po angielsku na ujęcie, ' +
            'gotowym jako prompt do generatora obrazów. Bez komentarza, bez numeracji.' },
          { role: 'user', content: `Scena: ${scene}\nLiczba ujęć: ${shots}` },
        ], { maxTokens: 900 });
        let prompts;
        try {
          const m = raw.match(/\[[\s\S]*\]/);
          prompts = JSON.parse(m ? m[0] : raw);
        } catch {
          prompts = raw.split('\n').map((l) => l.replace(/^\s*[-*\d.)\]]+\s*/, '').trim()).filter(Boolean);
        }
        prompts = (prompts || []).filter((p) => typeof p === 'string' && p.trim()).slice(0, shots);
        if (!prompts.length) throw new Error('Model nie zwrócił opisów ujęć.');

        const frames = [];
        for (let i = 0; i < prompts.length; i++) {
          const img = await studioGenImage(prompts[i], size, data.provider, rozl);
          frames.push({ shot: i + 1, prompt: prompts[i], ...img });
        }
        addEvent('studio', `storyboard: „${scene.slice(0, 60)}" → ${frames.length} ujęć`);
        return { ok: true, scene, frames };
      } catch (err) {
        throw bladHttp(kodHttp(err), `Storyboard nie powiódł się: ${err.message}`);
      } finally {
        rozliczStudio(rozl);
      }
    }, rozl);
  }

  // --- INPAINTING (obraz z bazy + maska + prompt → OpenAI images/edit) ---
  if (pathname === '/api/studio/edit' && req.method === 'POST') {
    if (!STUDIO.openai.key) {
      return sendJson(res, 400, { error: 'Edycja obrazu wymaga OPENAI_API_KEY.' });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const prompt = String(data.prompt || '').trim();
    const imageId = String(data.imageId || '');
    if (!prompt || !imageId) return sendJson(res, 400, { error: 'Wymagane: imageId i prompt.' });
    let maskBuf = null;
    try { if (data.mask) maskBuf = Buffer.from(String(data.mask).split(',').pop(), 'base64'); } catch { /* brak maski */ }
    let srcBuf;
    try { srcBuf = fs.readFileSync(path.join(kbPliki(), imageId.replace(/[^a-z0-9]/gi, ''))); }
    catch { return sendJson(res, 404, { error: 'Nie znaleziono obrazu w bazie.' }); }

    // Rozmiar wyniku = rozmiar źródła, którego serwer nie zna – ostrożnie jak duży obraz.
    const modelEdycji = `${STUDIO.openai.imageModel}@auto`;
    const rozl = zarezerwujStudio(kosztUslugi('obraz', modelEdycji, 1));
    if (rozl.odmowa) return sendJson(res, 429, rozl.odmowa);
    return wTle(res, 'edycja', prompt, async () => {
      try {
        const form = new FormData();
        form.append('model', STUDIO.openai.imageModel);
        form.append('prompt', prompt);
        form.append('image', new Blob([srcBuf], { type: 'image/png' }), 'image.png');
        if (maskBuf) form.append('mask', new Blob([maskBuf], { type: 'image/png' }), 'mask.png');
        const r = await fetch(`${STUDIO.openai.base}/images/edits`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${STUDIO.openai.key}` },
          body: form,
          signal: AbortSignal.timeout(180000),
        });
        const resp = await r.json();
        if (!r.ok) throw new Error(resp.error?.message || `HTTP ${r.status}`);
        const first = resp.data?.[0] || {};
        let buf;
        if (first.b64_json) buf = Buffer.from(first.b64_json, 'base64');
        else if (first.url) buf = Buffer.from(await (await fetch(first.url, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
        else throw new Error('API nie zwróciło obrazu.');
        zanotujStudio(rozl, { silnik: 'openai', model: modelEdycji, zl: kosztUslugi('obraz', modelEdycji, 1) });
        const name = tsName('edycja', 'png');
        const item = await kbAddFile(name, 'image/png', buf, `Edycja obrazu (inpainting). Prompt: ${prompt}`);
        exportToStudioDir(name, buf);
        addEvent('studio', `edycja obrazu (inpainting): „${prompt.slice(0, 60)}"`);
        return { ok: true, item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` };
      } catch (err) {
        throw bladHttp(kodHttp(err), `Edycja obrazu nie powiodła się: ${err.message}`);
      } finally {
        rozliczStudio(rozl);
      }
    }, rozl);
  }

  // --- UPSCALE (przez usługę zmysłów, jeśli dostępny model Real-ESRGAN) ---
  if (pathname === '/api/studio/upscale' && req.method === 'POST') {
    // Real-ESRGAN liczy się w zmysłach: na własnym komputerze osoby albo za zgodą na domowym GPU właściciela.
    if (!zmyslyDostepne()) {
      return sendJson(res, 403, { error: 'Powiększanie działa w zmysłach – podłącz swój komputer w Ustawieniach → Zmysły.', kod: 'zmysly-niedostepne' });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const imageId = String(data.imageId || '').replace(/[^a-z0-9]/gi, '');
    let srcBuf;
    try { srcBuf = fs.readFileSync(path.join(kbPliki(), imageId)); }
    catch { return sendJson(res, 404, { error: 'Nie znaleziono obrazu.' }); }
    return wTle(res, 'powiekszenie', imageId, async () => {
      try {
        const r = await fetchZmyslow('/upscale', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: `data:image/png;base64,${srcBuf.toString('base64')}`, scale: data.scale || 4 }),
          signal: AbortSignal.timeout(180000),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          throw bladHttp(r.status, e.error || 'Upscale niedostępny – zainstaluj Real-ESRGAN w usłudze zmysłów (senses/README.md).');
        }
        const d = await r.json();
        const buf = Buffer.from(String(d.image).split(',').pop(), 'base64');
        const name = tsName('upscale', 'png');
        const item = await kbAddFile(name, 'image/png', buf, 'Obraz powiększony (upscale).');
        exportToStudioDir(name, buf);
        return { ok: true, item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` };
      } catch (err) {
        // Odmowa usługi zmysłów (z jej kodem) idzie dalej bez dopisku.
        if (err.kod) throw err;
        throw bladHttp(502, `Upscale niedostępny: ${err.message} (uruchom usługę zmysłów z Real-ESRGAN).`);
      }
    });
  }

  // --- DŹWIĘK (ElevenLabs) ---
  if (pathname === '/api/studio/speech' && req.method === 'POST') {
    if (!STUDIO.eleven.key) {
      return sendJson(res, 400, { error: 'Brak klucza ElevenLabs. Ustaw ELEVENLABS_API_KEY w .env.' });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const text = String(data.text || '').trim();
    if (!text) return sendJson(res, 400, { error: 'Puste pole text.' });
    const voice = String(data.voiceId || STUDIO.eleven.voice);

    const zlDzwieku = kosztUslugi('dzwiek', STUDIO.eleven.model, text.length);
    const rozl = zarezerwujStudio(zlDzwieku);
    if (rozl.odmowa) return sendJson(res, 429, rozl.odmowa);
    return wTle(res, 'dzwiek', text, async () => {
      try {
        const r = await fetch(`${STUDIO.eleven.base}/v1/text-to-speech/${encodeURIComponent(voice)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'xi-api-key': STUDIO.eleven.key },
          body: JSON.stringify({ text, model_id: STUDIO.eleven.model }),
          signal: AbortSignal.timeout(120000),
        });
        if (!r.ok) {
          let msg = `HTTP ${r.status}`;
          try { msg = (await r.json()).detail?.message || msg; } catch { /* ignore */ }
          throw new Error(msg);
        }
        const buf = Buffer.from(await r.arrayBuffer());
        zanotujStudio(rozl, { silnik: 'studio', model: STUDIO.eleven.model, zl: zlDzwieku });
        const name = tsName('glos', 'mp3');
        const item = await kbAddFile(name, 'audio/mpeg', buf,
          `Nagranie głosowe (ElevenLabs, głos: ${voice}). Tekst: ${text.slice(0, 800)}`);
        const exported = exportToStudioDir(name, buf);
        addEvent('studio', `wygenerowano dźwięk: „${text.slice(0, 60)}”`);
        return { ok: true, item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}`, exported };
      } catch (err) {
        throw bladHttp(kodHttp(err), `Generowanie dźwięku nie powiodło się: ${err.message}`);
      } finally {
        rozliczStudio(rozl);
      }
    }, rozl);
  }

  // --- WIDEO (Seedance przez API zgodne z BytePlus/Ark: zadania asynchroniczne) ---
  if (pathname === '/api/studio/video' && req.method === 'POST') {
    if (!STUDIO.seedance.key) {
      return sendJson(res, 400, { error: 'Brak klucza Seedance. Ustaw SEEDANCE_API_KEY w .env.' });
    }
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const prompt = String(data.prompt || '').trim();
    if (!prompt) return sendJson(res, 400, { error: 'Puste pole prompt.' });

    // Parametry w formacie komend tekstowych Ark (--resolution, --ratio, …)
    const duration = Math.min(15, Math.max(2, parseInt(data.duration, 10) || 5));
    const resolution = ['480p', '720p', '1080p'].includes(data.resolution) ? data.resolution : '720p';
    const ratio = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].includes(data.ratio)
      ? data.ratio : '16:9';
    let cmd = ` --resolution ${resolution} --ratio ${ratio} --duration ${duration}`;
    if (data.seed !== undefined && String(data.seed).trim() !== '' && Number.isInteger(Number(data.seed))) {
      cmd += ` --seed ${Number(data.seed)}`;
    }
    if (data.camerafixed === true) cmd += ' --camerafixed true';
    if (data.watermark === true) cmd += ' --watermark true';

    const content = [{ type: 'text', text: `${prompt}${cmd}` }];

    const frameFor = (id) => {
      const kbItem = kbPozycje().find((it) => it.id === id && /^image\//.test(it.mime || ''));
      if (!kbItem) return null;
      try {
        const buf = fs.readFileSync(path.join(kbPliki(), kbItem.id));
        return `data:${kbItem.mime};base64,${buf.toString('base64')}`;
      } catch { return null; }
    };

    // pierwsza/ostatnia klatka (i2v first–last frame; imageId = stara nazwa pola)
    const firstUrl = frameFor(data.firstFrameId || data.imageId);
    const lastUrl = frameFor(data.lastFrameId);
    if (lastUrl && !firstUrl) {
      return sendJson(res, 400, {
        error: 'Ostatnia klatka wymaga podania także pierwszej klatki (wymóg API Seedance).',
      });
    }
    if (firstUrl) {
      content.push({ type: 'image_url', image_url: { url: firstUrl }, role: 'first_frame' });
    }
    if (lastUrl) {
      content.push({ type: 'image_url', image_url: { url: lastUrl }, role: 'last_frame' });
    }

    /* Wideo liczymy przy PRZYJĘCIU zadania przez Seedance: gotowy film odbiera
       dopiero odpytywanie, którego może nie być (karta zamknięta), a dostawca
       i tak go policzy. Ostrożnie – jak cały cennik. */
    const modelWideo = `${STUDIO.seedance.model}@${resolution}`;
    const zlWideo = kosztUslugi('wideo', modelWideo, duration);
    const rozl = zarezerwujStudio(zlWideo);
    if (rozl.odmowa) return sendJson(res, 429, rozl.odmowa);
    try {
      const r = await fetch(`${STUDIO.seedance.base}/contents/generations/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${STUDIO.seedance.key}` },
        body: JSON.stringify({ model: STUDIO.seedance.model, content }),
        signal: AbortSignal.timeout(30000),
      });
      const resp = await r.json();
      if (!r.ok) throw new Error(resp.error?.message || resp.message || `HTTP ${r.status}`);
      const taskId = resp.id || resp.data?.id;
      if (!taskId) throw new Error('API nie zwróciło identyfikatora zadania.');
      zanotujStudio(rozl, { silnik: 'studio', model: modelWideo, zl: zlWideo });
      // Czyje to zadanie – status oddaje wideo i prompt tylko tej osobie.
      studioTasks.set(String(taskId), { prompt, osoba: kto().id });
      addEvent('studio', `rozpoczęto generowanie wideo: „${prompt.slice(0, 60)}”`);
      return sendJson(res, 200, { ok: true, taskId });
    } catch (err) {
      return sendJson(res, 502, { error: `Nie udało się zlecić wideo: ${err.message}` });
    } finally {
      rozliczStudio(rozl);
    }
  }

  if (pathname === '/api/studio/video/status' && req.method === 'GET') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
    /* Rejestr zadań jest wspólny dla serwera, a klucz Seedance – właściciela.
       Bez tego sprawdzenia członek ze Studiem, znając cudzy numer (np. ze
       zrzutu ekranu), dostawał cudze wideo z promptem do swojej bazy wiedzy,
       a dowolny numer odpytywał kluczem właściciela. Numer, którego rejestr
       nie zna (zadanie sprzed restartu), odpytać może tylko właściciel. */
    const zlecone = studioTasks.get(id);
    if (zlecone ? zlecone.osoba !== kto().id : !czyWlasciciel()) {
      return sendJson(res, 404, { error: 'Nie ma takiego zadania.' });
    }
    try {
      const r = await fetch(`${STUDIO.seedance.base}/contents/generations/tasks/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${STUDIO.seedance.key}` },
        signal: AbortSignal.timeout(20000),
      });
      const resp = await r.json();
      if (!r.ok) throw new Error(resp.error?.message || `HTTP ${r.status}`);
      const status = resp.status || resp.data?.status || 'running';

      if (['succeeded', 'success', 'completed'].includes(status)) {
        const videoUrl = resp.content?.video_url || resp.video_url ||
                         resp.data?.content?.video_url || resp.data?.video_url;
        if (!videoUrl) throw new Error('Zadanie ukończone, ale brak adresu wideo w odpowiedzi.');
        /* Pobranie gotowego filmu trwało w samym odpytaniu (do 300 s) – za
           tunelem kończyło się 524, a każde następne odpytanie pobierało go
           od nowa. Teraz pobiera zadanie w tle, raz; odpytania patrzą na nie. */
        const meta = studioTasks.get(id) || {};
        if (!meta.pobieranie) {
          // Trzy inne zadania osoby w toku – pobierzemy przy następnym odpytaniu.
          if (zadania.ilePracuje() >= zadania.naraz) return sendJson(res, 200, { status: 'running', pobieranie: true });
          meta.pobieranie = zadania.zacznij('wideo', meta.prompt, async () => {
            const buf = Buffer.from(await (await fetch(videoUrl, { signal: AbortSignal.timeout(300000) })).arrayBuffer());
            const name = tsName('wideo', 'mp4');
            const item = await kbAddFile(name, 'video/mp4', buf,
              `Wideo wygenerowane w Studiu (model: ${STUDIO.seedance.model}). Prompt: ${meta.prompt || ''}`);
            const exported = exportToStudioDir(name, buf);
            addEvent('studio', `ukończono wideo: „${(meta.prompt || '').slice(0, 60)}”`);
            return { item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}`, exported };
          });
          studioTasks.set(id, meta);
        }
        const z = meta.pobieranie;
        if (z.stan === 'pracuje') return sendJson(res, 200, { status: 'running', pobieranie: true });
        studioTasks.delete(id);
        if (z.stan === 'blad') return sendJson(res, 200, { status: 'failed', error: `Pobranie gotowego wideo nie powiodło się: ${z.dane.error}` });
        return sendJson(res, 200, { status: 'done', ...z.dane });
      }
      if (['failed', 'error', 'cancelled'].includes(status)) {
        studioTasks.delete(id);
        return sendJson(res, 200, { status: 'failed', error: resp.error?.message || 'Zadanie nie powiodło się.' });
      }
      return sendJson(res, 200, { status: 'running' });
    } catch (err) {
      return sendJson(res, 502, { error: `Sprawdzenie zadania nie powiodło się: ${err.message}` });
    }
  }

  res.writeHead(405);
  res.end();
}


module.exports = { handleStudio, polacz, tsName };

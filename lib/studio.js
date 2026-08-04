/* ============================================================
   Studio — generowanie mediów (OpenAI / Firefly / ElevenLabs / Seedance)

   Każdy wynik trafia do bazy wiedzy, żeby dało się do niego wrócić,
   i opcjonalnie do katalogu eksportu na dysku.
   ============================================================ */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { SENSES_URL, STUDIO, authHeaders, imageProviders, pickEndpoint, readJson, sendJson, studioTasks } = require('./rdzen.js');
const { parseModelResponse, llmComplete } = require('./model.js');

/* Wstrzykiwane przez server.js — te elementy należą do innych dziedzin.
   Zamiast krzyżowych `require` (i pułapki cyklicznych zależności) serwer
   podaje je raz, przy starcie. */
let KB_FILES, addEvent, kbAddFile, kbItemMeta, kbItems;
function polacz(z) {
  ({ KB_FILES, addEvent, kbAddFile, kbItemMeta, kbItems } = z);
}

// ---------------------------------------------------------------------------
// API: Studio — generowanie mediów (OpenAI / ElevenLabs / Seedance)
// Każdy wynik trafia do bazy wiedzy i (opcjonalnie) do folderu eksportu
// (STUDIO_EXPORT_DIR — np. folder projektu Adobe).
// ---------------------------------------------------------------------------

function exportToStudioDir(name, buf) {
  if (!STUDIO.exportDir) return '';
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
async function studioGenImage(prompt, size, provider) {
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
      exportDir: STUDIO.exportDir,
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

    try {
      const items = [];
      let engineLabel = '';
      for (let k = 0; k < count; k++) {
        const { buf, engineLabel: lbl } = await genOne();
        engineLabel = lbl;
        const name = tsName('obraz', 'png');
        const item = await kbAddFile(name, 'image/png', buf,
          `Grafika wygenerowana w Studiu (silnik: ${lbl}). Prompt: ${prompt}`);
        exportToStudioDir(name, buf);
        items.push({ item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` });
      }
      addEvent('studio', `wygenerowano ${count > 1 ? count + ' warianty obrazu' : 'obraz'} (${engineLabel}): „${prompt.slice(0, 80)}”`);
      // zgodność wstecz: pierwszy obraz jako item/url (dla znacznika [OBRAZ:] w czacie)
      return sendJson(res, 200, {
        ok: true, provider, items, item: items[0].item, url: items[0].url,
      });
    } catch (err) {
      return sendJson(res, 502, { error: `Generowanie obrazu nie powiodło się: ${err.message}` });
    }
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
    try {
      const raw = await llmComplete([
        { role: 'system', content: 'Jesteś reżyserem. Rozpisz scenę na ujęcia filmowe. ' +
          'Zwróć WYŁĄCZNIE tablicę JSON stringów — po jednym szczegółowym opisie kadru po angielsku na ujęcie, ' +
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
        const img = await studioGenImage(prompts[i], size, data.provider);
        frames.push({ shot: i + 1, prompt: prompts[i], ...img });
      }
      addEvent('studio', `storyboard: „${scene.slice(0, 60)}" → ${frames.length} ujęć`);
      return sendJson(res, 200, { ok: true, scene, frames });
    } catch (err) {
      return sendJson(res, 502, { error: `Storyboard nie powiódł się: ${err.message}` });
    }
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
    try { srcBuf = fs.readFileSync(path.join(KB_FILES, imageId.replace(/[^a-z0-9]/gi, ''))); }
    catch { return sendJson(res, 404, { error: 'Nie znaleziono obrazu w bazie.' }); }

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
      const name = tsName('edycja', 'png');
      const item = await kbAddFile(name, 'image/png', buf, `Edycja obrazu (inpainting). Prompt: ${prompt}`);
      exportToStudioDir(name, buf);
      addEvent('studio', `edycja obrazu (inpainting): „${prompt.slice(0, 60)}"`);
      return sendJson(res, 200, { ok: true, item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` });
    } catch (err) {
      return sendJson(res, 502, { error: `Edycja obrazu nie powiodła się: ${err.message}` });
    }
  }

  // --- UPSCALE (przez usługę zmysłów, jeśli dostępny model Real-ESRGAN) ---
  if (pathname === '/api/studio/upscale' && req.method === 'POST') {
    let data;
    try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const imageId = String(data.imageId || '').replace(/[^a-z0-9]/gi, '');
    let srcBuf;
    try { srcBuf = fs.readFileSync(path.join(KB_FILES, imageId)); }
    catch { return sendJson(res, 404, { error: 'Nie znaleziono obrazu.' }); }
    try {
      const r = await fetch(`${SENSES_URL}/upscale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: `data:image/png;base64,${srcBuf.toString('base64')}`, scale: data.scale || 4 }),
        signal: AbortSignal.timeout(180000),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        return sendJson(res, r.status, { error: e.error || 'Upscale niedostępny — zainstaluj Real-ESRGAN w usłudze zmysłów (senses/README.md).' });
      }
      const d = await r.json();
      const buf = Buffer.from(String(d.image).split(',').pop(), 'base64');
      const name = tsName('upscale', 'png');
      const item = await kbAddFile(name, 'image/png', buf, 'Obraz powiększony (upscale).');
      exportToStudioDir(name, buf);
      return sendJson(res, 200, { ok: true, item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}` });
    } catch (err) {
      return sendJson(res, 502, { error: `Upscale niedostępny: ${err.message} (uruchom usługę zmysłów z Real-ESRGAN).` });
    }
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
      const name = tsName('glos', 'mp3');
      const item = await kbAddFile(name, 'audio/mpeg', buf,
        `Nagranie głosowe (ElevenLabs, głos: ${voice}). Tekst: ${text.slice(0, 800)}`);
      const exported = exportToStudioDir(name, buf);
      addEvent('studio', `wygenerowano dźwięk: „${text.slice(0, 60)}”`);
      return sendJson(res, 200, { ok: true, item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}`, exported });
    } catch (err) {
      return sendJson(res, 502, { error: `Generowanie dźwięku nie powiodło się: ${err.message}` });
    }
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
      const kbItem = kbItems.find((it) => it.id === id && /^image\//.test(it.mime || ''));
      if (!kbItem) return null;
      try {
        const buf = fs.readFileSync(path.join(KB_FILES, kbItem.id));
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
      studioTasks.set(String(taskId), { prompt });
      addEvent('studio', `rozpoczęto generowanie wideo: „${prompt.slice(0, 60)}”`);
      return sendJson(res, 200, { ok: true, taskId });
    } catch (err) {
      return sendJson(res, 502, { error: `Nie udało się zlecić wideo: ${err.message}` });
    }
  }

  if (pathname === '/api/studio/video/status' && req.method === 'GET') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
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
        const buf = Buffer.from(await (await fetch(videoUrl, { signal: AbortSignal.timeout(300000) })).arrayBuffer());
        const meta = studioTasks.get(id) || {};
        const name = tsName('wideo', 'mp4');
        const item = await kbAddFile(name, 'video/mp4', buf,
          `Wideo wygenerowane w Studiu (model: ${STUDIO.seedance.model}). Prompt: ${meta.prompt || ''}`);
        const exported = exportToStudioDir(name, buf);
        studioTasks.delete(id);
        addEvent('studio', `ukończono wideo: „${(meta.prompt || '').slice(0, 60)}”`);
        return sendJson(res, 200, { status: 'done', item: kbItemMeta(item), url: `/api/kb/raw?id=${item.id}`, exported });
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

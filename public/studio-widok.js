/* ============================================================
   STUDIO – widok: obraz, szablony promptów, storyboard, edycja (inpainting),
   dźwięk i wideo

   Wydzielone z app.js (propozycja podziału zespołu IT: „studio-widok.js").
   Jak reszta modułów: zależności wchodzą przez fabrykę, bo app.js – ładowany
   jako ostatni – trzyma `$`, `el` i wspólne pomocniki. Długie generowanie
   wraca z serwera jako zadanie w tle (202); dopytuje je czekajNaZadanie
   z narzedzia.js.
   ============================================================ */

/**
 * @param {object} z
 * @param {Function} z.$             getElementById
 * @param {object}   z.el            elementy aplikacji (studioBtn, studioClose, studioModal)
 * @param {Function} z.t             tłumaczenia
 * @param {Function} z.escapeHtml    escape do szablonów HTML
 * @param {Function} z.readJsonSafe  odczyt JSON-a z odpowiedzi
 * @param {Function} z.loadJson      odczyt z localStorage
 * @param {Function} z.jedenNaRaz    przycisk zajęty, dopóki trwa płatne żądanie
 * @param {Function} z.czekajNaZadanie wynik zadania w tle (narzedzia.js)
 * @returns {{ openStudio: Function, zadanieStudia: Function }}
 */
function utworzStudioWidok(z) {
  const { $, el, t, escapeHtml, readJsonSafe, loadJson, jedenNaRaz, czekajNaZadanie } = z;

  function studioOut(section, html) {
    const out = $(`studio-${section}-out`);
    out.innerHTML = html;
    out.classList.add('show');
  }

  function studioNote(item, exported) {
    return `<span class="studio-note">✓ ${escapeHtml(t('st.zapisano', { n: item.name }))}` +
           (exported ? `<br>✓ ${escapeHtml(t('st.wyeksportowano', { n: exported }))}` : '') + '</span>';
  }

  async function openStudio() {
    el.studioModal.style.display = '';
    try {
      const res = await fetch('/api/studio/providers');
      const prov = await res.json();
      for (const [sec, on] of [['image', prov.image], ['speech', prov.speech], ['video', prov.video]]) {
        const box = $(`studio-sec-${sec}`);
        box.classList.toggle('disabled', !on);
        box.querySelector('.studio-off').style.display = on ? 'none' : '';
        /* Wyszarzenie samym CSS-em zostawiało przyciski klikalne z klawiatury –
           Enter nie robił nic i nic nie mówił. Wyłączamy je naprawdę. */
        box.querySelectorAll('button, input, select, textarea').forEach((x) => { x.disabled = !on; });
      }
      if (prov.voice) $('studio-speech-voice').placeholder = t('st.voicePhDefault', { v: prov.voice });
      // wybór silnika obrazów (OpenAI / Adobe Firefly), gdy jest więcej niż jeden
      const provSel = $('studio-image-provider');
      const imgProv = prov.imageProviders || [];
      if (imgProv.length > 1) {
        provSel.innerHTML = imgProv.map((p) =>
          `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join('');
        provSel.style.display = '';
      } else {
        provSel.style.display = 'none';
      }
      // obrazy z bazy wiedzy jako pierwsza / ostatnia klatka wideo
      const kb = await (await fetch('/api/kb')).json();
      const images = (kb.items || []).filter((i) => (i.mime || '').startsWith('image/'));
      const opts = images.map((i) =>
        `<option value="${escapeHtml(i.id)}">${escapeHtml(i.name)}</option>`).join('');
      $('studio-video-image').innerHTML =
        `<option value="">${t('st.frameNone')}</option>` + opts;
      $('studio-video-last').innerHTML =
        `<option value="">${t('st.lastNone')}</option>` + opts;
      $('studio-edit-img').innerHTML = `<option value="">${t('st.editPick')}</option>` + opts;
      // Klatka wybrana w Galerii. Wybór jest TRWAŁY: wcześniej kasowaliśmy go po
      // pierwszym otwarciu Studia, więc przy drugim wejściu pole było znów puste
      // i wyglądało to tak, jakby wybór nigdy się nie zapisał.
      const wanted = localStorage.getItem('cosmos.videoFrame') || '';
      if (wanted && images.some((i) => i.id === wanted)) {
        $('studio-video-image').value = wanted;
      } else if (wanted) {
        localStorage.removeItem('cosmos.videoFrame');   // obraz zniknął z bazy
      }
      renderPromptTemplates();
    } catch { /* sekcje zostają w stanie domyślnym */ }
  }

  el.studioBtn.addEventListener('click', openStudio);
  el.studioClose.addEventListener('click', () => { el.studioModal.style.display = 'none'; });
  el.studioModal.addEventListener('click', (e) => {
    if (e.target === el.studioModal) el.studioModal.style.display = 'none';
  });

  /* Studio: praca dłuższa niż ~75 s wraca jako zadanie w tle (202), które
     dopytujemy – czekajNaZadanie w narzedzia.js. Człowiek widzi, że trwa
     dłużej niż zwykle, i wie, że wynik i tak trafi do bazy wiedzy. */
  function zadanieStudia(gdzie) {
    return {
      pobierz: (...a) => fetch(...a), readJsonSafe, t,
      naPostep: (s) => {
        if (!gdzie) return;
        studioOut(gdzie, `<span class="studio-note"><span class="studio-spinner"></span>${escapeHtml(t('st.dluzej', { s: s.sekund || 0 }))}</span>`);
      },
    };
  }

  $('studio-image-go').addEventListener('click', jedenNaRaz(async () => {
    const prompt = $('studio-image-prompt').value.trim();
    if (!prompt) return;
    studioOut('image', `<span class="studio-note"><span class="studio-spinner"></span>${t('st.genImage')}</span>`);
    try {
      const res = await fetch('/api/studio/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          size: $('studio-image-size').value,
          count: Number($('studio-image-count').value) || 1,
          provider: $('studio-image-provider').value || undefined,
        }),
      });
      const d = await czekajNaZadanie(res, zadanieStudia('image'));
      const imgs = (d.items || [{ item: d.item, url: d.url }])
        .map((r) => `<img src="${escapeHtml(r.url)}" alt="wygenerowany obraz">`).join('');
      studioOut('image', imgs + studioNote(d.item, d.exported));
    } catch (err) {
      studioOut('image', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
    }
  }));

  // --- szablony promptów obrazu (localStorage) ---
  function loadPromptTemplates() {
    return loadJson('cosmos.promptTemplates', []);
  }
  function renderPromptTemplates() {
    const sel = $('studio-image-tpl');
    const tpls = loadPromptTemplates();
    sel.innerHTML = `<option value="">${t('st.tplSelect')}</option>` +
      tpls.map((tp, i) => `<option value="${i}">${escapeHtml(tp.name)}</option>`).join('');
  }
  $('studio-image-tpl').addEventListener('change', (e) => {
    const tpls = loadPromptTemplates();
    const tp = tpls[Number(e.target.value)];
    if (tp) { $('studio-image-prompt').value = tp.prompt; e.target.value = ''; }
  });
  $('studio-image-tpl-save').addEventListener('click', () => {
    const prompt = $('studio-image-prompt').value.trim();
    if (!prompt) return;
    const name = prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt;
    const chosen = window.prompt(t('st.tplNamePrompt'), name);
    if (chosen === null) return;
    const tpls = loadPromptTemplates();
    tpls.push({ name: (chosen.trim() || name).slice(0, 60), prompt });
    localStorage.setItem('cosmos.promptTemplates', JSON.stringify(tpls));
    renderPromptTemplates();
  });

  // --- Storyboard: scena → ujęcia → kadry ---
  $('studio-sb-go').addEventListener('click', jedenNaRaz(async () => {
    const scene = $('studio-sb-scene').value.trim();
    if (!scene) return;
    studioOut('sb', `<span class="studio-note"><span class="studio-spinner"></span>${t('st.genStoryboard')}</span>`);
    try {
      const res = await fetch('/api/studio/storyboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene, shots: Number($('studio-sb-shots').value) || 4,
          size: $('studio-image-size').value, provider: $('studio-image-provider').value || undefined,
        }),
      });
      const d = await czekajNaZadanie(res, zadanieStudia('sb'));
      studioOut('sb', d.frames.map((f) =>
        `<div class="sb-frame"><span class="sb-num">${f.shot}</span><img src="${escapeHtml(f.url)}" title="${escapeHtml(f.prompt)}"></div>`).join(''));
    } catch (err) {
      studioOut('sb', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
    }
  }));

  // --- Inpainting: malowanie maski na obrazie z bazy ---
  const editState = { imageId: null, paint: null, ctx: null, painting: false };

  async function loadEditImage(id) {
    editState.imageId = id;
    if (!id) { $('studio-edit-canvas-wrap').style.display = 'none'; return; }
    const canvas = $('studio-edit-canvas');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = `/api/kb/raw?id=${encodeURIComponent(id)}`; });
    canvas.width = img.naturalWidth || 1024;
    canvas.height = img.naturalHeight || 1024;
    editState.ctx = canvas.getContext('2d');
    editState.ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    editState.base = img;
    // offscreen do maski
    editState.paint = document.createElement('canvas');
    editState.paint.width = canvas.width; editState.paint.height = canvas.height;
    $('studio-edit-canvas-wrap').style.display = '';
  }

  function editRedraw() {
    const c = $('studio-edit-canvas'); const ctx = editState.ctx;
    ctx.clearRect(0, 0, c.width, c.height);
    if (editState.base) ctx.drawImage(editState.base, 0, 0, c.width, c.height);
    ctx.save();
    ctx.globalAlpha = 0.45; ctx.drawImage(editState.paint, 0, 0);
    ctx.restore();
  }

  function editPointerPos(e) {
    const c = $('studio-edit-canvas'); const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function editPaintAt(p) {
    const pc = editState.paint.getContext('2d');
    pc.fillStyle = '#ff3b6b';
    pc.beginPath();
    pc.arc(p.x, p.y, Math.max(12, editState.paint.width / 40), 0, Math.PI * 2);
    pc.fill();
    editRedraw();
  }
  (() => {
    const c = $('studio-edit-canvas');
    const down = (e) => { if (!editState.paint) return; editState.painting = true; editPaintAt(editPointerPos(e)); };
    const move = (e) => { if (editState.painting) editPaintAt(editPointerPos(e)); };
    const up = () => { editState.painting = false; };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  })();

  $('studio-edit-img').addEventListener('change', (e) => loadEditImage(e.target.value));
  $('studio-edit-clear').addEventListener('click', () => {
    if (editState.paint) { editState.paint.getContext('2d').clearRect(0, 0, editState.paint.width, editState.paint.height); editRedraw(); }
  });
  $('studio-edit-go').addEventListener('click', jedenNaRaz(async () => {
    if (!editState.imageId) { alert(t('st.editNoImg')); return; }
    const prompt = $('studio-edit-prompt').value.trim();
    if (!prompt) return;
    // maska: obszar zamalowany → przezroczysty (do edycji), reszta nieprzezroczysta (zachowana)
    const mask = document.createElement('canvas');
    mask.width = editState.paint.width; mask.height = editState.paint.height;
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#ffffff'; mctx.fillRect(0, 0, mask.width, mask.height);
    mctx.globalCompositeOperation = 'destination-out';
    mctx.drawImage(editState.paint, 0, 0);
    studioOut('edit', `<span class="studio-note"><span class="studio-spinner"></span>${t('st.genEdit')}</span>`);
    try {
      const res = await fetch('/api/studio/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: editState.imageId, prompt, mask: mask.toDataURL('image/png') }),
      });
      const d = await czekajNaZadanie(res, zadanieStudia('edit'));
      studioOut('edit', `<img src="${escapeHtml(d.url)}">` + studioNote(d.item, d.exported));
    } catch (err) {
      studioOut('edit', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
    }
  }));

  $('studio-speech-go').addEventListener('click', jedenNaRaz(async () => {
    const text = $('studio-speech-text').value.trim();
    if (!text) return;
    studioOut('speech', `<span class="studio-note"><span class="studio-spinner"></span>${t('st.genSound')}</span>`);
    try {
      const res = await fetch('/api/studio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId: $('studio-speech-voice').value.trim() || undefined }),
      });
      const d = await czekajNaZadanie(res, zadanieStudia('speech'));
      studioOut('speech', `<audio controls src="${escapeHtml(d.url)}"></audio>` + studioNote(d.item, d.exported));
    } catch (err) {
      studioOut('speech', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
    }
  }));

  $('studio-video-go').addEventListener('click', jedenNaRaz(async () => {
    const prompt = $('studio-video-prompt').value.trim();
    if (!prompt) return;
    studioOut('video', `<span class="studio-note"><span class="studio-spinner"></span>${t('st.genVideoTask')}</span>`);
    try {
      const res = await fetch('/api/studio/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          duration: Number($('studio-video-duration').value),
          resolution: $('studio-video-resolution').value,
          ratio: $('studio-video-ratio').value,
          seed: $('studio-video-seed').value.trim() || undefined,
          camerafixed: $('studio-video-camfix').checked || undefined,
          firstFrameId: $('studio-video-image').value || undefined,
          lastFrameId: $('studio-video-last').value || undefined,
        }),
      });
      const d = await readJsonSafe(res);
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);

      const started = Date.now();
      while (true) {
        await new Promise((r) => setTimeout(r, 5000));
        const min = Math.round((Date.now() - started) / 60000 * 10) / 10;
        studioOut('video', `<span class="studio-note"><span class="studio-spinner"></span>${t('st.genVideo', { min })}</span>`);
        const st = await (await fetch(`/api/studio/video/status?id=${encodeURIComponent(d.taskId)}`)).json();
        if (st.status === 'done') {
          studioOut('video', `<video controls src="${escapeHtml(st.url)}"></video>` + studioNote(st.item, st.exported));
          break;
        }
        if (st.status === 'failed' || st.error) {
          throw new Error(st.error || t('st.videoFailed'));
        }
        if (Date.now() - started > 20 * 60000) throw new Error(t('st.videoTimeout'));
      }
    } catch (err) {
      studioOut('video', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
    }
  }));

  return { openStudio, zadanieStudia };
}

if (typeof window !== 'undefined') window.utworzStudioWidok = utworzStudioWidok;
if (typeof module !== 'undefined') module.exports = { utworzStudioWidok };

/* ============================================================
   NAUKA – rozpoznawanie (przez zmysły), procedury, rutyny, asystent z bramką

   Panel „Nauka": wzorce do rozpoznawania z kamery, procedury nagrane
   w przeglądarce (Playwright po stronie serwera), rutyny o stałej porze
   i runner. Tryb auto działa wyłącznie dla procedur z samych odczytów –
   bramkę trzyma serwer (lib/nauka.js, automation/runner.js); tu jest tylko
   widok i potwierdzenia człowieka.

   Wydzielone z app.js (runda 3).
   ============================================================ */
function utworzNaukeWidok(z) {
  const { $, escapeHtml, readJsonSafe, getMedia } = z;

  const learnModal = $('learn-modal');
  let learnStream = null;
  let learnShot = null;         // dataURL zrobionego wzorca
  let procEditing = null;       // id edytowanej procedury (null = nowa)
  let procStepsData = [];       // robocza lista kroków

  function openLearn() {
    learnModal.style.display = '';
    switchLearnTab('recog');
    loadLessons();
    loadProcedures();
    loadRoutines();
    loadAutomationStatus();
  }
  async function loadAutomationStatus() {
    try {
      window.__automation = await (await fetch('/api/automation/status')).json();
    } catch { window.__automation = { available: false }; }
    const on = window.__automation && window.__automation.available;
    $('routine-auto-wrap').style.display = on ? '' : 'none';
    $('rec-box').style.display = on ? '' : 'none';
    updateRunAutoBtn();
  }
  function updateRunAutoBtn() {
    const on = window.__automation && window.__automation.available;
    const p = procEditing && (window.__procedures || []).find((x) => x.id === procEditing);
    $('proc-run-auto').style.display = (on && p && p.readOnly) ? '' : 'none';
  }
  function closeLearn() {
    learnModal.style.display = 'none';
    stopLearnCam();
  }
  function switchLearnTab(tab) {
    document.querySelectorAll('#learn-modal [data-learn-tab]').forEach((b) =>
      b.classList.toggle('active', b.dataset.learnTab === tab));
    $('learn-pane-recog').style.display = tab === 'recog' ? '' : 'none';
    $('learn-pane-proc').style.display = tab === 'proc' ? '' : 'none';
    $('learn-pane-routine').style.display = tab === 'routine' ? '' : 'none';
    $('learn-pane-ideas').style.display = tab === 'ideas' ? '' : 'none';
    if (tab === 'ideas') loadImprovements();
    if (tab !== 'recog') stopLearnCam();
  }

  // --- Pomysły / samodoskonalenie ---
  async function loadImprovements() {
    try {
      const { improvements } = await (await fetch('/api/improvements')).json();
      const box = $('imp-list');
      if (!improvements.length) { box.innerHTML = `<div class="field-hint">${t('imp.empty')}</div>`; return; }
      const badge = { nowy: t('imp.new'), zaakceptowany: t('imp.accepted'),
        odrzucony: t('imp.rejected'), zrobione: t('imp.done') };
      box.innerHTML = improvements.slice().reverse().map((i) =>
        `<div class="learn-item" data-id="${i.id}">` +
        `<div class="learn-item-main"><strong>${escapeHtml(i.text)}</strong>` +
        `<span class="learn-item-meta mono">${i.zrodlo === 'model' ? '✦ Cosmos' : t('imp.mine')} · ` +
        `${badge[i.status] || i.status}</span></div>` +
        (i.status === 'nowy'
          ? `<button class="btn-ghost imp-ok">${t('imp.accept')}</button>`
          : `<button class="btn-ghost imp-fin">${t('imp.markDone')}</button>`) +
        `<button class="icon-btn imp-del" title="✕">✕</button></div>`).join('');
      box.querySelectorAll('.learn-item').forEach((item) => {
        const id = item.dataset.id;
        const set = async (status) => {
          await fetch('/api/improvements', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, status }) });
          loadImprovements();
        };
        item.querySelector('.imp-ok')?.addEventListener('click', () => set('zaakceptowany'));
        item.querySelector('.imp-fin')?.addEventListener('click', () => set('zrobione'));
        item.querySelector('.imp-del').addEventListener('click', async () => {
          await fetch('/api/improvements?id=' + id, { method: 'DELETE' });
          loadImprovements();
        });
      });
    } catch { /* offline */ }
  }
  $('imp-suggest').addEventListener('click', async () => {
    const out = $('imp-out');
    out.style.display = ''; out.textContent = t('imp.thinking');
    $('imp-suggest').disabled = true;
    try {
      const r = await fetch('/api/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cosmos-Lang': getLang() },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      out.textContent = d.ok ? d.text : (d.message || t('imp.failed'));
    } catch { out.textContent = t('imp.failed'); }
    $('imp-suggest').disabled = false;
  });
  $('imp-caps').addEventListener('click', async () => {
    const out = $('imp-out');
    out.style.display = ''; out.textContent = t('imp.thinking');
    try {
      const d = await (await fetch('/api/capabilities')).json();
      out.textContent = d.opis || t('imp.failed');
    } catch { out.textContent = t('imp.failed'); }
  });
  $('imp-add').addEventListener('click', async () => {
    const text = $('imp-text').value.trim();
    if (!text) return;
    await fetch('/api/improvements', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }) });
    $('imp-text').value = '';
    $('imp-status').textContent = t('imp.added');
    loadImprovements();
  });

  $('learn-btn').addEventListener('click', openLearn);
  $('learn-close').addEventListener('click', closeLearn);
  learnModal.addEventListener('click', (e) => { if (e.target === learnModal) closeLearn(); });
  document.querySelectorAll('#learn-modal [data-learn-tab]').forEach((b) =>
    b.addEventListener('click', () => switchLearnTab(b.dataset.learnTab)));

  // --- Rozpoznawanie ---
  async function startLearnCam() {
    try {
      learnStream = await getMedia({ video: { width: { ideal: 1280 } } });
      const v = $('learn-video');
      v.srcObject = learnStream;
      v.style.display = '';
      $('learn-thumb').style.display = 'none';
      $('learn-shot-btn').disabled = false;
    } catch {
      $('learn-recog-status').textContent = t('camera.denied') || 'Brak dostępu do kamery.';
    }
  }
  function stopLearnCam() {
    if (learnStream) { learnStream.getTracks().forEach((tr) => tr.stop()); learnStream = null; }
    const v = $('learn-video'); if (v) v.style.display = 'none';
  }
  $('learn-cam-btn').addEventListener('click', () => { learnStream ? stopLearnCam() : startLearnCam(); });
  $('learn-shot-btn').addEventListener('click', () => {
    const v = $('learn-video');
    if (!v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    learnShot = c.toDataURL('image/jpeg', 0.85);
    const img = $('learn-thumb');
    img.src = learnShot; img.style.display = '';
    stopLearnCam();
  });
  $('learn-save').addEventListener('click', async () => {
    const label = $('learn-label').value.trim();
    if (!label) { $('learn-recog-status').textContent = t('learn.needLabel'); return; }
    /* Sama nazwa bez zdjęcia i bez opisu nic Cosmosa nie uczy, a pokazywało
       „Nauczono: klucz” (agencja, runda 5). */
    if (!learnShot && !$('learn-note').value.trim()) { $('learn-recog-status').textContent = t('learn.needShot'); return; }
    const body = {
      label, kind: $('learn-kind').value, note: $('learn-note').value.trim(),
      image: learnShot || null,
    };
    try {
      const r = await fetch('/api/lessons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || '');
      }
      $('learn-recog-status').textContent = t('learn.taught', { label });
      $('learn-label').value = ''; $('learn-note').value = ''; learnShot = null;
      $('learn-thumb').style.display = 'none';
      loadLessons();
      updateLearnBadge();
    } catch (err) {
      // Powód z serwera (np. pełny dysk), a nie samo „nie udało się”.
      $('learn-recog-status').textContent = [t('learn.teachErr'), err && err.message].filter(Boolean).join(' ');
    }
  });
  async function loadLessons() {
    try {
      const { lessons } = await (await fetch('/api/lessons')).json();
      const box = $('learn-lessons');
      if (!lessons.length) { box.innerHTML = `<div class="field-hint">${t('learn.lessonsEmpty')}</div>`; return; }
      const kindLabel = { object: t('learn.kindObject'), gesture: t('learn.kindGesture'), pose: t('learn.kindPose'), scene: t('learn.kindScene') };
      box.innerHTML = lessons.map((l) =>
        `<div class="learn-item" data-id="${l.id}">` +
        (l.thumbId ? `<img class="learn-item-thumb" src="/api/kb/raw?id=${l.thumbId}" alt="">` : `<div class="learn-item-thumb ph">✦</div>`) +
        `<div class="learn-item-main"><strong>${escapeHtml(l.label)}</strong>` +
        `<span class="learn-item-meta mono">${kindLabel[l.kind] || l.kind}${l.note ? ' · ' + escapeHtml(l.note) : ''}</span></div>` +
        `<button class="icon-btn learn-del" title="✕">✕</button></div>`).join('');
      box.querySelectorAll('.learn-del').forEach((b) => b.addEventListener('click', async () => {
        const item = b.closest('.learn-item');
        const label = item.querySelector('strong').textContent;
        if (!confirm(t('learn.delLesson', { label }))) return;
        await fetch('/api/lessons?id=' + item.dataset.id, { method: 'DELETE' });
        loadLessons(); updateLearnBadge();
      }));
    } catch { /* offline */ }
  }

  // --- Procedury ---
  const STEP_ACTIONS = ['open', 'click', 'type', 'read', 'wait', 'confirm', 'note'];
  function stepActionLabel(a) {
    return { open: t('learn.actOpen'), click: t('learn.actClick'), type: t('learn.actType'), read: t('learn.actRead'), wait: t('learn.actWait'), confirm: t('learn.actConfirm'), note: t('learn.actNote') }[a] || a;
  }
  function renderProcSteps() {
    const box = $('proc-steps');
    box.innerHTML = procStepsData.map((s, i) => {
      const opts = STEP_ACTIONS.map((a) => `<option value="${a}"${a === s.action ? ' selected' : ''}>${stepActionLabel(a)}</option>`).join('');
      const authable = s.action === 'type' || s.action === 'click';
      return `<div class="proc-step" data-i="${i}">` +
        `<div class="proc-step-top"><span class="proc-step-n mono">${i + 1}</span>` +
        `<select class="ps-action">${opts}</select>` +
        (authable ? `<label class="ps-sens"><input type="checkbox" class="ps-auth"${s.auth ? ' checked' : ''}> ${t('learn.stAuth')}</label>` : '') +
        `<label class="ps-sens"><input type="checkbox" class="ps-sensitive"${s.sensitive ? ' checked' : ''}> ${t('learn.stSensitive')}</label>` +
        `<button class="icon-btn ps-del" title="✕">✕</button></div>` +
        `<input class="ps-target" placeholder="${t('learn.stTarget')}" value="${escapeHtml(s.target || '')}">` +
        `<input class="ps-value" placeholder="${s.auth ? t('learn.stSecret') : t('learn.stValue')}" value="${escapeHtml(s.value || '')}">` +
        `<input class="ps-note" placeholder="${t('learn.stNote')}" value="${escapeHtml(s.note || '')}"></div>`;
    }).join('');
    box.querySelectorAll('.proc-step').forEach((el2) => {
      const i = Number(el2.dataset.i);
      el2.querySelector('.ps-action').addEventListener('change', (e) => { procStepsData[i].action = e.target.value; if (e.target.value === 'confirm') { procStepsData[i].sensitive = true; } renderProcSteps(); });
      const authBox = el2.querySelector('.ps-auth');
      if (authBox) authBox.addEventListener('change', (e) => { procStepsData[i].auth = e.target.checked; renderProcSteps(); });
      el2.querySelector('.ps-sensitive').addEventListener('change', (e) => { procStepsData[i].sensitive = e.target.checked; });
      el2.querySelector('.ps-target').addEventListener('input', (e) => { procStepsData[i].target = e.target.value; });
      el2.querySelector('.ps-value').addEventListener('input', (e) => { procStepsData[i].value = e.target.value; });
      el2.querySelector('.ps-note').addEventListener('input', (e) => { procStepsData[i].note = e.target.value; });
      el2.querySelector('.ps-del').addEventListener('click', () => { procStepsData.splice(i, 1); renderProcSteps(); });
    });
  }
  $('proc-add-step').addEventListener('click', () => { procStepsData.push({ action: 'open', target: '', value: '', note: '', sensitive: false }); renderProcSteps(); });
  function resetProcForm() {
    procEditing = null; procStepsData = [];
    $('proc-name').value = ''; $('proc-desc').value = '';
    $('proc-delete').style.display = 'none';
    renderProcSteps();
  }
  async function loadProcedures() {
    try {
      const { procedures } = await (await fetch('/api/procedures')).json();
      window.__procedures = procedures;
      const pick = $('proc-picker');
      pick.innerHTML = `<option value="">${t('learn.procNew')}</option>` +
        procedures.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
      pick.value = procEditing || '';
      const rp = $('routine-proc');
      rp.innerHTML = procedures.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
      updateLearnBadge();
      updateRunAutoBtn();
    } catch { /* offline */ }
  }
  async function runReadonly(procId, statusEl, resultsEl) {
    if (!window.__automation || !window.__automation.available) {
      if (statusEl) statusEl.textContent = t('learn.autoNoModule'); return null;
    }
    if (statusEl) statusEl.textContent = t('learn.autoRunning');
    try {
      const r = await fetch('/api/procedures/run-readonly', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: procId }),
      });
      const d = await readJsonSafe(r);
      if (!r.ok || !d.ok) {
        if (statusEl) {
          statusEl.textContent = d.error === 'not-readonly' ? t('learn.autoNotReadonly')
            : (d.error === 'no-secrets' || d.error === 'secret-missing') ? d.message
            : t('learn.autoErr', { e: d.reason || d.message || d.error || '?' });
        }
        return d;
      }
      if (statusEl) statusEl.textContent = t('learn.autoDone', { n: d.results.length });
      if (resultsEl) {
        resultsEl.innerHTML = `<div class="field-hint">${t('learn.autoResults')}</div>` +
          d.results.map((x) => `<div class="learn-item"><div class="learn-item-main"><strong>${escapeHtml(x.label)}</strong>` +
            `<span class="learn-item-meta">${escapeHtml(x.value)}</span></div></div>`).join('');
      }
      return d;
    } catch (e) { if (statusEl) statusEl.textContent = t('learn.autoErr', { e: String(e) }); return null; }
  }
  $('proc-run-auto').addEventListener('click', () => {
    if (!procEditing) return;
    runReadonly(procEditing, $('learn-proc-status'), $('proc-results'));
  });

  // --- Nagrywanie procedury ---
  let recPollTimer = null;
  $('rec-start').addEventListener('click', async () => {
    try {
      const r = await fetch('/api/procedures/record/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: $('rec-url').value.trim() }),
      });
      const d = await readJsonSafe(r);
      if (!r.ok) { $('rec-status').textContent = d.message || d.error || t('rec.startErr'); return; }
      $('rec-start').style.display = 'none';
      $('rec-stop').style.display = '';
      $('rec-status').textContent = t('rec.recording');
      if (!recPollTimer) recPollTimer = setInterval(refreshRecStatus, 3000);
    } catch { $('rec-status').textContent = t('rec.startErr'); }
  });
  $('rec-stop').addEventListener('click', async () => {
    $('rec-stop').disabled = true;
    try {
      const r = await fetch('/api/procedures/record/stop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      const d = await r.json();
      if (recPollTimer) { clearInterval(recPollTimer); recPollTimer = null; }
      $('rec-start').style.display = ''; $('rec-stop').style.display = 'none'; $('rec-stop').disabled = false;
      if (!d.ok || !d.id) { $('rec-status').textContent = d.message || t('rec.empty'); return; }
      $('rec-status').textContent = t('rec.saved', { n: d.steps.length });
      await loadProcedures();
      // wczytaj nagraną procedurę do edytora do przejrzenia
      procEditing = d.id; $('proc-picker').value = d.id;
      $('proc-name').value = d.name || ''; procStepsData = (d.steps || []).map((s) => ({ ...s }));
      $('proc-delete').style.display = ''; renderProcSteps(); updateRunAutoBtn();
    } catch { $('rec-status').textContent = t('rec.startErr'); $('rec-stop').disabled = false; }
  });
  async function refreshRecStatus() {
    try {
      const s = await (await fetch('/api/procedures/record/status')).json();
      if (!s.recording && recPollTimer) {
        // przeglądarka zamknięta ręcznie – pozwól zapisać przez „Zakończ"
        $('rec-status').textContent = t('rec.closed');
      }
    } catch { /* offline */ }
  }
  $('proc-picker').addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) { resetProcForm(); return; }
    const p = (window.__procedures || []).find((x) => x.id === id);
    if (!p) return;
    procEditing = id;
    $('proc-name').value = p.name; $('proc-desc').value = p.description || '';
    procStepsData = (p.steps || []).map((s) => ({ ...s }));
    $('proc-delete').style.display = '';
    $('proc-results').innerHTML = '';
    renderProcSteps();
    updateRunAutoBtn();
  });
  $('proc-save').addEventListener('click', async () => {
    const name = $('proc-name').value.trim();
    if (!name) { $('learn-proc-status').textContent = t('learn.needName'); return; }
    const body = { name, description: $('proc-desc').value.trim(), steps: procStepsData };
    const method = procEditing ? 'PUT' : 'POST';
    if (procEditing) body.id = procEditing;
    try {
      const r = await fetch('/api/procedures', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await readJsonSafe(r);
      if (!r.ok) throw 0;
      if (!procEditing && d.id) procEditing = d.id;
      $('learn-proc-status').textContent = t('learn.procSaved');
      loadProcedures();
    } catch { $('learn-proc-status').textContent = t('learn.teachErr'); }
  });
  $('proc-delete').addEventListener('click', async () => {
    if (!procEditing) return;
    const name = $('proc-name').value.trim();
    if (!confirm(t('learn.confirmDelProc', { name }))) return;
    await fetch('/api/procedures?id=' + procEditing, { method: 'DELETE' });
    $('learn-proc-status').textContent = t('learn.procDeleted');
    resetProcForm(); loadProcedures(); loadRoutines();
  });
  $('proc-run').addEventListener('click', () => {
    if (!procStepsData.length) return;
    runProcedure({ name: $('proc-name').value.trim() || '–', steps: procStepsData });
  });

  // --- Runner (asystent z bramką) ---
  function runProcedure(proc) {
    let step = 0;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    document.body.appendChild(overlay);
    function render() {
      if (step >= proc.steps.length) {
        overlay.innerHTML = `<div class="modal runner-modal"><div class="modal-body"><p class="runner-done">✓ ${t('learn.runDone')}</p>` +
          `<button class="btn-primary runner-close">${t('learn.runClose')}</button></div></div>`;
        overlay.querySelector('.runner-close').addEventListener('click', () => overlay.remove());
        return;
      }
      const s = proc.steps[step];
      const isLink = s.action === 'open' && /^https?:\/\//i.test(s.target);
      overlay.innerHTML =
        `<div class="modal runner-modal" role="dialog">` +
        `<div class="modal-header"><h2>${escapeHtml(t('learn.runnerTitle', { name: proc.name }))}</h2>` +
        `<button class="icon-btn runner-x">✕</button></div>` +
        `<div class="modal-body">` +
        `<div class="runner-progress mono">${t('learn.runStep', { i: step + 1, n: proc.steps.length })}</div>` +
        `<div class="runner-step${s.sensitive ? ' sensitive' : ''}">` +
        `<div class="runner-act">${stepActionLabel(s.action)}</div>` +
        (s.note ? `<div class="runner-note">${escapeHtml(s.note)}</div>` : '') +
        (s.target ? `<div class="runner-target mono">${escapeHtml(s.target)}</div>` : '') +
        (s.value ? `<div class="runner-value"><code>${escapeHtml(s.value)}</code> <button class="btn-ghost runner-copy">${t('learn.copyValue')}</button></div>` : '') +
        (s.sensitive ? `<label class="runner-confirm"><input type="checkbox" class="runner-ok"> ${t('learn.runConfirmSensitive')}</label>` : '') +
        `</div>` +
        `<div class="runner-btns">` +
        (isLink ? `<button class="btn-secondary runner-open">${t('learn.runOpenLink')}</button>` : '') +
        `<button class="btn-primary runner-next"${s.sensitive ? ' disabled' : ''}>${step + 1 >= proc.steps.length ? t('learn.runDone') : t('learn.runNext')}</button>` +
        `</div></div></div>`;
      overlay.querySelector('.runner-x').addEventListener('click', () => overlay.remove());
      const next = overlay.querySelector('.runner-next');
      const ok = overlay.querySelector('.runner-ok');
      if (ok) ok.addEventListener('change', () => { next.disabled = !ok.checked; });
      if (isLink) overlay.querySelector('.runner-open').addEventListener('click', () => window.open(s.target, '_blank', 'noopener'));
      const copy = overlay.querySelector('.runner-copy');
      if (copy) copy.addEventListener('click', () => { navigator.clipboard?.writeText(s.value); });
      next.addEventListener('click', () => { step++; render(); });
    }
    render();
  }

  // --- Rutyny ---
  function scheduleControls() {
    const type = $('routine-type').value;
    $('routine-time').style.display = (type === 'interval') ? 'none' : '';
    $('routine-mins').style.display = (type === 'interval') ? '' : 'none';
    $('routine-day').style.display = (type === 'weekly' || type === 'monthly') ? '' : 'none';
    const day = $('routine-day');
    if (type === 'weekly') {
      const names = t('weekdaysShort').split(' ');
      day.innerHTML = names.map((n, i) => `<option value="${i}">${n}</option>`).join('');
    } else if (type === 'monthly') {
      day.innerHTML = Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('');
    }
  }
  $('routine-type').addEventListener('change', scheduleControls);
  $('routine-auto').addEventListener('change', (e) => {
    if (e.target.checked && window.Notification && Notification.permission === 'default') Notification.requestPermission();
  });
  $('routine-add').addEventListener('click', async () => {
    const procId = $('routine-proc').value;
    if (!procId) { $('learn-routine-status').textContent = t('learn.needProc'); return; }
    const type = $('routine-type').value;
    const autoOn = window.__automation && window.__automation.available && $('routine-auto').checked;
    const body = { procedureId: procId, type, time: $('routine-time').value, day: Number($('routine-day').value || 0), everyMinutes: Number($('routine-mins').value || 60), mode: autoOn ? 'auto-read' : 'prepare' };
    try {
      const r = await fetch('/api/routines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw 0;
      $('learn-routine-status').textContent = t('learn.routineAdded');
      loadRoutines();
    } catch { $('learn-routine-status').textContent = t('learn.teachErr'); }
  });
  async function loadRoutines() {
    try {
      const { routines } = await (await fetch('/api/routines')).json();
      const box = $('routine-list');
      if (!routines.length) { box.innerHTML = `<div class="field-hint">${t('learn.routinesEmpty')}</div>`; return; }
      const freq = { daily: t('learn.freqDaily'), weekly: t('learn.freqWeekly'), monthly: t('learn.freqMonthly'), interval: t('learn.freqInterval') };
      box.innerHTML = routines.map((r) => {
        const sched = r.schedule.type === 'interval' ? `${freq.interval} (${r.schedule.everyMinutes})` : `${freq[r.schedule.type]} ${r.schedule.time}`;
        const autoTag = r.mode === 'auto-read' ? ' · auto' : '';
        return `<div class="learn-item" data-id="${r.id}">` +
          `<div class="learn-item-main"><strong>${escapeHtml(r.procedureName)}</strong>` +
          `<span class="learn-item-meta mono">${sched}${autoTag} · ${t('learn.nextRun', { when: new Date(r.nextRun).toLocaleString() })}</span></div>` +
          `<button class="btn-ghost r-toggle">${r.enabled ? t('learn.on') : t('learn.off')}</button>` +
          `<button class="btn-ghost r-run">${t('learn.runNow')}</button>` +
          `<button class="icon-btn r-del" title="✕">✕</button></div>`;
      }).join('');
      box.querySelectorAll('.learn-item').forEach((item) => {
        const id = item.dataset.id;
        const r = routines.find((x) => x.id === id);
        item.querySelector('.r-toggle').addEventListener('click', async () => {
          await fetch('/api/routines', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, enabled: !r.enabled }) });
          loadRoutines();
        });
        item.querySelector('.r-run').addEventListener('click', () => runRoutineNow(r));
        item.querySelector('.r-del').addEventListener('click', async () => {
          if (!confirm(t('learn.delRoutine'))) return;
          await fetch('/api/routines?id=' + id, { method: 'DELETE' });
          loadRoutines();
        });
      });
    } catch { /* offline */ }
  }
  function runRoutineNow(r) {
    const proc = (window.__procedures || []).find((p) => p.id === r.procedureId);
    if (proc) runProcedure(proc);
    fetch('/api/routines', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, pending: false }) });
  }

  // pastylka licznika przy „Nauka" – liczba oczekujących rutyn
  async function updateLearnBadge() {
    try {
      const { due } = await (await fetch('/api/routines/due')).json();
      const badge = $('learn-badge');
      if (due && due.length) { badge.textContent = due.length; badge.style.display = ''; }
      else { badge.textContent = ''; badge.style.display = 'none'; }
    } catch { /* offline */ }
  }
  // co minutę sprawdź, czy jakaś rutyna nie „dojrzała"
  let dueShownIds = new Set();
  async function pollDueRoutines() {
    try {
      const { due } = await (await fetch('/api/routines/due')).json();
      updateLearnBadge();
      for (const r of (due || [])) {
        if (dueShownIds.has(r.id)) continue;
        dueShownIds.add(r.id);
        const ack = () => fetch('/api/routines', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, pending: false }) });
        // Tryb auto (tylko odczyt): wykonaj w tle bez pytania, wynik jako powiadomienie
        if (r.mode === 'auto-read' && window.__automation && window.__automation.available) {
          const d = await runReadonly(r.procedureId, null, null);
          ack();
          if (d && d.ok) {
            const summary = d.results.map((x) => `${x.label}: ${x.value}`).join(' · ');
            if (window.Notification && Notification.permission === 'granted') {
              new Notification(r.procedureName, { body: summary.slice(0, 200) });
            }
          }
          continue;
        }
        if (confirm(t('learn.dueBody', { name: r.procedureName }))) {
          if (!window.__procedures) await loadProcedures();
          runRoutineNow(r);
        } else {
          ack();
        }
      }
    } catch { /* offline */ }
  }

  return { loadAutomationStatus, closeLearn, loadProcedures, runProcedure, scheduleControls, updateLearnBadge, pollDueRoutines };
}

if (typeof window !== 'undefined') window.utworzNaukeWidok = utworzNaukeWidok;
if (typeof module !== 'undefined') module.exports = { utworzNaukeWidok };

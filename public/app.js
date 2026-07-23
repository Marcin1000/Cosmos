/* ============================================================
   COSMOS — logika interfejsu
   ============================================================ */

'use strict';

// ----------------------------------------------------------------
// Stan aplikacji
// ----------------------------------------------------------------

const STORAGE_KEYS = {
  conversations: 'cosmos.conversations',
  settings: 'cosmos.settings',
  theme: 'cosmos.theme',
  endpoint: 'cosmos.endpoint',
};

const DEFAULT_SETTINGS = {
  modelCloud: '',       // puste = model z konfiguracji serwera
  modelLocal: '',
  systemPrompt: 'Jesteś pomocnym asystentem AI o imieniu Cosmos. Masz zmysły: możesz otrzymywać obrazy z kamery oraz zdarzenia z czujników (sekcja KONTEKST PERCEPCJI). Odpowiadasz po polsku, chyba że użytkownik pisze w innym języku.',
  temperature: 0.6,
  maxTokens: 2048,
  speak: false,
};

let conversations = loadJson(STORAGE_KEYS.conversations, []);
let settings = { ...DEFAULT_SETTINGS, ...loadJson(STORAGE_KEYS.settings, {}) };
let endpoint = localStorage.getItem(STORAGE_KEYS.endpoint) || 'cloud';
let activeId = null;
let serverConfig = { endpoints: { cloud: {}, local: {} } };
let abortController = null;
let isGenerating = false;
let pendingImages = []; // dataURL-e załączników czekających na wysłanie
let senses = { online: false, caps: {} }; // stan usługi percepcji (Python)
let mediaRecorder = null;
let speechRec = null;
let isRecording = false;
let cameraStream = null;

// ----------------------------------------------------------------
// Elementy DOM
// ----------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const el = {
  sidebar: $('sidebar'),
  conversations: $('conversations'),
  newChatBtn: $('new-chat-btn'),
  collapseBtn: $('collapse-btn'),
  expandBtn: $('expand-btn'),
  chatScroll: $('chat-scroll'),
  welcome: $('welcome'),
  welcomeModel: $('welcome-model'),
  messages: $('messages'),
  input: $('input'),
  sendBtn: $('send-btn'),
  stopBtn: $('stop-btn'),
  attachBtn: $('attach-btn'),
  fileInput: $('file-input'),
  attachments: $('attachments'),
  themeBtn: $('theme-btn'),
  themeLabel: $('theme-label'),
  themeIconDark: $('theme-icon-dark'),
  themeIconLight: $('theme-icon-light'),
  topbarModel: $('topbar-model'),
  tabCloud: $('tab-cloud'),
  tabLocal: $('tab-local'),
  statusCloud: $('status-cloud'),
  statusLocal: $('status-local'),
  statusSenses: $('status-senses'),
  micBtn: $('mic-btn'),
  cameraBtn: $('camera-btn'),
  cameraModal: $('camera-modal'),
  cameraClose: $('camera-close'),
  cameraCapture: $('camera-capture'),
  cameraVideo: $('camera-video'),
  ttsToggle: $('tts-toggle'),
  settingsBtn: $('settings-btn'),
  settingsModal: $('settings-modal'),
  settingsClose: $('settings-close'),
  settingsSave: $('settings-save'),
  settingsReset: $('settings-reset'),
  setModelCloud: $('set-model-cloud'),
  setModelLocal: $('set-model-local'),
  setSystem: $('set-system'),
  setTemp: $('set-temp'),
  tempValue: $('temp-value'),
  setMaxTokens: $('set-maxtokens'),
  fetchModelsCloud: $('fetch-models-cloud'),
  fetchModelsLocal: $('fetch-models-local'),
  modelSelectCloud: $('model-select-cloud'),
  modelSelectLocal: $('model-select-local'),
  configInfo: $('config-info'),
};

const AVATAR_SVG = '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="9" fill="currentColor" opacity="0.92"/><ellipse cx="24" cy="24" rx="20" ry="7.5" fill="none" stroke="currentColor" stroke-width="2.4" transform="rotate(-24 24 24)" opacity="0.55"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

// ----------------------------------------------------------------
// Narzędzia
// ----------------------------------------------------------------

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveConversations() {
  try {
    localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(conversations));
  } catch {
    // limit localStorage (zwykle 5 MB) — usuwamy najstarsze rozmowy z obrazami
    const trimmed = conversations.slice(0, Math.max(1, Math.floor(conversations.length / 2)));
    try {
      localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(trimmed));
      conversations = trimmed;
    } catch { /* poddajemy się — sesja działa dalej w pamięci */ }
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function activeConv() {
  return conversations.find((c) => c.id === activeId) || null;
}

function epConfig(name = endpoint) {
  return serverConfig.endpoints[name] || {};
}

function currentModel() {
  const override = endpoint === 'local' ? settings.modelLocal : settings.modelCloud;
  return override || epConfig().model || '';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// treść wiadomości: string albo { text, images: [dataURL] }
function msgText(m) {
  return typeof m.content === 'string' ? m.content : (m.content.text || '');
}
function msgImages(m) {
  return typeof m.content === 'string' ? [] : (m.content.images || []);
}

// ----------------------------------------------------------------
// Mini-renderer Markdown (bez zewnętrznych bibliotek)
// ----------------------------------------------------------------

function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

function renderMarkdown(text) {
  const lines = text.split('\n');
  const html = [];
  let i = 0;
  let para = [];
  let listStack = null; // 'ul' | 'ol'

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${renderInline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (listStack) { html.push(`</${listStack}>`); listStack = null; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // blok kodu ```
    const fence = line.match(/^```(\S*)\s*$/);
    if (fence) {
      flushPara(); closeList();
      const lang = fence[1] || '';
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
      i++;
      html.push(
        `<div class="code-block">` +
        `<div class="code-block-header"><span>${escapeHtml(lang || 'kod')}</span>` +
        `<button class="code-copy-btn" data-copy>${COPY_SVG}Kopiuj</button></div>` +
        `<pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`
      );
      continue;
    }

    // nagłówki
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushPara(); closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++; continue;
    }

    // pozioma linia
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara(); closeList();
      html.push('<hr>');
      i++; continue;
    }

    // cytat
    if (/^>\s?/.test(line)) {
      flushPara(); closeList();
      const quote = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      html.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }

    // tabela
    if (line.includes('|') && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushPara(); closeList();
      const splitRow = (row) =>
        row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const headers = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let table = '<table><thead><tr>';
      table += headers.map((h) => `<th>${renderInline(h)}</th>`).join('');
      table += '</tr></thead><tbody>';
      for (const row of rows) {
        table += '<tr>' + row.map((c) => `<td>${renderInline(c)}</td>`).join('') + '</tr>';
      }
      table += '</tbody></table>';
      html.push(table);
      continue;
    }

    // listy
    const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    const olMatch = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ulMatch || olMatch) {
      flushPara();
      const type = ulMatch ? 'ul' : 'ol';
      if (listStack !== type) { closeList(); html.push(`<${type}>`); listStack = type; }
      html.push(`<li>${renderInline((ulMatch || olMatch)[1])}</li>`);
      i++; continue;
    }

    // pusta linia
    if (line.trim() === '') {
      flushPara(); closeList();
      i++; continue;
    }

    para.push(line);
    i++;
  }

  flushPara(); closeList();
  return html.join('');
}

// ----------------------------------------------------------------
// Renderowanie rozmów i wiadomości
// ----------------------------------------------------------------

function renderSidebar() {
  el.conversations.innerHTML = '';
  for (const conv of conversations) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (conv.id === activeId ? ' active' : '');

    const title = document.createElement('button');
    title.className = 'conv-title';
    title.textContent = conv.title || 'Nowa rozmowa';
    title.title = conv.title || 'Nowa rozmowa';
    title.addEventListener('click', () => selectConversation(conv.id));

    const del = document.createElement('button');
    del.className = 'conv-delete';
    del.title = 'Usuń rozmowę';
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });

    item.append(title, del);
    el.conversations.appendChild(item);
  }
}

function imagesHtml(images) {
  if (!images.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'msg-images';
  for (const src of images) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'załącznik';
    wrap.appendChild(img);
  }
  return wrap;
}

function messageElement(m) {
  const role = m.role;
  const text = msgText(m);
  const images = msgImages(m);
  const isError = Boolean(m.error);

  const msg = document.createElement('div');
  msg.className = `msg msg-${role}` + (isError ? ' msg-error' : '');

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = AVATAR_SVG;
    msg.appendChild(avatar);
  }

  const body = document.createElement('div');
  body.className = 'msg-content' + (role === 'assistant' && !isError ? ' md' : '');

  if (role === 'user') {
    const imgs = imagesHtml(images);
    if (imgs) body.appendChild(imgs);
    if (text) body.appendChild(document.createTextNode(text));
    msg.appendChild(body);
    return msg;
  }

  if (isError) {
    body.textContent = text;
    msg.appendChild(body);
    return msg;
  }

  body.innerHTML = renderMarkdown(text);

  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-action-btn';
  copyBtn.innerHTML = COPY_SVG + ' Kopiuj';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = '✓ Skopiowano';
      setTimeout(() => { copyBtn.innerHTML = COPY_SVG + ' Kopiuj'; }, 1500);
    });
  });
  actions.appendChild(copyBtn);

  const col = document.createElement('div');
  col.style.flex = '1';
  col.style.minWidth = '0';
  col.append(body, actions);
  msg.appendChild(col);
  return msg;
}

function renderMessages() {
  const conv = activeConv();
  el.messages.innerHTML = '';
  const hasMessages = conv && conv.messages.length > 0;
  el.welcome.style.display = hasMessages ? 'none' : '';
  if (!hasMessages) return;

  for (const m of conv.messages) {
    el.messages.appendChild(messageElement(m));
  }
  scrollToBottom(true);
}

function scrollToBottom(force = false) {
  const sc = el.chatScroll;
  const nearBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
  if (force || nearBottom) sc.scrollTop = sc.scrollHeight;
}

// ----------------------------------------------------------------
// Operacje na rozmowach
// ----------------------------------------------------------------

function newConversation() {
  if (isGenerating) stopGeneration();
  activeId = null;
  renderSidebar();
  renderMessages();
  el.input.focus();
}

function selectConversation(id) {
  if (isGenerating) stopGeneration();
  activeId = id;
  renderSidebar();
  renderMessages();
}

function deleteConversation(id) {
  const conv = conversations.find((c) => c.id === id);
  const name = conv?.title || 'tę rozmowę';
  if (!confirm(`Usunąć „${name}”?`)) return;
  conversations = conversations.filter((c) => c.id !== id);
  saveConversations();
  if (activeId === id) {
    activeId = null;
    renderMessages();
  }
  renderSidebar();
}

function ensureConversation(firstUserText) {
  let conv = activeConv();
  if (!conv) {
    const base = firstUserText || 'Rozmowa z obrazem';
    conv = {
      id: uid(),
      title: base.slice(0, 48) + (base.length > 48 ? '…' : ''),
      messages: [],
      createdAt: Date.now(),
    };
    conversations.unshift(conv);
    activeId = conv.id;
  }
  return conv;
}

// ----------------------------------------------------------------
// Załączniki obrazów
// ----------------------------------------------------------------

function resizeImage(file, maxDim = 1024, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Nie udało się wczytać obrazu.')); };
    img.src = url;
  });
}

function renderAttachments() {
  el.attachments.innerHTML = '';
  pendingImages.forEach((src, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'attachment';
    const img = document.createElement('img');
    img.src = src;
    const rm = document.createElement('button');
    rm.className = 'attachment-remove';
    rm.textContent = '×';
    rm.title = 'Usuń załącznik';
    rm.addEventListener('click', () => {
      pendingImages.splice(idx, 1);
      renderAttachments();
      updateSendButton();
    });
    wrap.append(img, rm);
    el.attachments.appendChild(wrap);
  });
}

el.attachBtn.addEventListener('click', () => el.fileInput.click());

el.fileInput.addEventListener('change', async () => {
  for (const file of el.fileInput.files) {
    if (!file.type.startsWith('image/')) continue;
    if (pendingImages.length >= 4) { alert('Maksymalnie 4 obrazy na wiadomość.'); break; }
    try {
      pendingImages.push(await resizeImage(file));
    } catch (err) {
      alert(err.message);
    }
  }
  el.fileInput.value = '';
  renderAttachments();
  updateSendButton();
});

// wklejanie obrazów ze schowka
el.input.addEventListener('paste', async (e) => {
  const items = [...(e.clipboardData?.items || [])].filter((it) => it.type.startsWith('image/'));
  if (!items.length) return;
  e.preventDefault();
  for (const it of items) {
    if (pendingImages.length >= 4) break;
    const file = it.getAsFile();
    if (file) pendingImages.push(await resizeImage(file));
  }
  renderAttachments();
  updateSendButton();
});

// ----------------------------------------------------------------
// Wysyłanie wiadomości + streaming SSE
// ----------------------------------------------------------------

function toApiMessages(conv) {
  const api = [];
  if (settings.systemPrompt.trim()) {
    api.push({ role: 'system', content: settings.systemPrompt.trim() });
  }
  for (const m of conv.messages) {
    if (m.error) continue;
    const text = msgText(m);
    const images = msgImages(m);
    if (images.length) {
      const parts = images.map((src) => ({ type: 'image_url', image_url: { url: src } }));
      if (text) parts.push({ type: 'text', text });
      api.push({ role: m.role, content: parts });
    } else {
      api.push({ role: m.role, content: text });
    }
  }
  return api;
}

async function sendMessage() {
  const text = el.input.value.trim();
  if ((!text && !pendingImages.length) || isGenerating) return;

  const conv = ensureConversation(text);
  const content = pendingImages.length ? { text, images: [...pendingImages] } : text;
  conv.messages.push({ role: 'user', content });
  pendingImages = [];
  renderAttachments();
  saveConversations();

  el.input.value = '';
  autosizeInput();
  renderSidebar();
  renderMessages();

  await generate(conv);
}

async function generate(conv) {
  isGenerating = true;
  setGeneratingUI(true);

  const msg = document.createElement('div');
  msg.className = 'msg msg-assistant';
  msg.innerHTML = `<div class="msg-avatar">${AVATAR_SVG}</div>`;
  const body = document.createElement('div');
  body.className = 'msg-content md';
  body.innerHTML = '<span class="cursor-blink"></span>';
  msg.appendChild(body);
  el.messages.appendChild(msg);
  scrollToBottom(true);

  abortController = new AbortController();
  let acc = '';
  let renderQueued = false;

  const paint = () => {
    renderQueued = false;
    body.innerHTML = renderMarkdown(acc) + '<span class="cursor-blink"></span>';
    scrollToBottom();
  };
  const schedulePaint = () => {
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(paint);
    }
  };

  try {
    const modelOverride = endpoint === 'local' ? settings.modelLocal : settings.modelCloud;
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint,
        messages: toApiMessages(conv),
        model: modelOverride || undefined,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
      }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      let errText = `Błąd HTTP ${res.status}`;
      try {
        const data = await res.json();
        errText = data.error || errText;
      } catch { /* ignore */ }
      throw new Error(errText);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop();

      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta?.content
                       ?? json.choices?.[0]?.text
                       ?? '';
            if (delta) {
              acc += delta;
              schedulePaint();
            }
          } catch { /* niepełny fragment — pomijamy */ }
        }
      }
    }

    if (!acc) acc = '*(pusta odpowiedź modelu)*';
    conv.messages.push({ role: 'assistant', content: acc });
    saveConversations();
    if (settings.speak) speakText(acc);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (acc) {
        conv.messages.push({ role: 'assistant', content: acc });
        saveConversations();
      }
    } else {
      conv.messages.push({ role: 'assistant', content: `⚠ ${err.message}`, error: true });
      saveConversations();
    }
  } finally {
    isGenerating = false;
    abortController = null;
    setGeneratingUI(false);
    renderMessages();
    el.input.focus();
  }
}

function stopGeneration() {
  if (abortController) abortController.abort();
}

function setGeneratingUI(generating) {
  el.sendBtn.style.display = generating ? 'none' : '';
  el.stopBtn.style.display = generating ? '' : 'none';
  updateSendButton();
}

function updateSendButton() {
  el.sendBtn.disabled = (el.input.value.trim() === '' && pendingImages.length === 0) || isGenerating;
}

// ----------------------------------------------------------------
// Pole wprowadzania
// ----------------------------------------------------------------

function autosizeInput() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 220) + 'px';
}

el.input.addEventListener('input', () => {
  autosizeInput();
  updateSendButton();
});

el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

el.sendBtn.addEventListener('click', sendMessage);
el.stopBtn.addEventListener('click', stopGeneration);

// kopiowanie kodu (delegacja)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const code = btn.closest('.code-block')?.querySelector('code')?.textContent || '';
  navigator.clipboard.writeText(code).then(() => {
    const prev = btn.innerHTML;
    btn.innerHTML = '✓ Skopiowano';
    setTimeout(() => { btn.innerHTML = prev; }, 1500);
  });
});

// podpowiedzi na ekranie startowym
document.querySelectorAll('.suggestion').forEach((btn) => {
  btn.addEventListener('click', () => {
    el.input.value = btn.dataset.prompt;
    autosizeInput();
    updateSendButton();
    sendMessage();
  });
});

// ----------------------------------------------------------------
// Zmysły: mowa (TTS) — Piper przez senses, fallback: głos systemowy
// ----------------------------------------------------------------

function stripForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' (fragment kodu) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

let currentAudio = null;

async function speakText(text) {
  const clean = stripForSpeech(text);
  if (!clean) return;
  stopSpeaking();

  // 1. Piper (lokalny, naturalny głos) przez usługę zmysłów
  if (senses.online && senses.caps.piper) {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean }),
      });
      if (res.ok) {
        const blob = await res.blob();
        currentAudio = new Audio(URL.createObjectURL(blob));
        currentAudio.play();
        return;
      }
    } catch { /* fallback niżej */ }
  }

  // 2. Głos systemowy przeglądarki
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'pl-PL';
    const plVoice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('pl'));
    if (plVoice) u.voice = plVoice;
    speechSynthesis.speak(u);
  }
}

function stopSpeaking() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

el.ttsToggle.addEventListener('click', () => {
  settings.speak = !settings.speak;
  saveSettings();
  el.ttsToggle.classList.toggle('active', settings.speak);
  if (!settings.speak) stopSpeaking();
});

// ----------------------------------------------------------------
// Zmysły: słuch (STT) — Whisper przez senses, fallback: przeglądarka
// ----------------------------------------------------------------

function setRecordingUI(on) {
  isRecording = on;
  el.micBtn.classList.toggle('recording', on);
  el.micBtn.title = on ? 'Zatrzymaj nagrywanie' : 'Mów (dyktowanie)';
}

async function startWhisperRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    setRecordingUI(false);
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    el.input.placeholder = 'Rozpoznawanie mowy…';
    try {
      const res = await fetch('/api/stt', {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.text) {
        el.input.value = (el.input.value ? el.input.value + ' ' : '') + data.text;
        autosizeInput();
        updateSendButton();
      }
    } catch (err) {
      alert(`Rozpoznawanie mowy nie powiodło się:\n${err.message}`);
    } finally {
      el.input.placeholder = 'Napisz wiadomość…';
      el.input.focus();
    }
  };
  mediaRecorder.start();
  setRecordingUI(true);
}

function startBrowserRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Dyktowanie wymaga usługi Cosmos Senses (Whisper) albo przeglądarki Chrome/Edge.');
    return;
  }
  speechRec = new SR();
  speechRec.lang = 'pl-PL';
  speechRec.interimResults = false;
  speechRec.continuous = true;
  speechRec.onresult = (e) => {
    const text = [...e.results].slice(e.resultIndex).map((r) => r[0].transcript).join(' ').trim();
    if (text) {
      el.input.value = (el.input.value ? el.input.value + ' ' : '') + text;
      autosizeInput();
      updateSendButton();
    }
  };
  speechRec.onend = () => setRecordingUI(false);
  speechRec.onerror = () => setRecordingUI(false);
  speechRec.start();
  setRecordingUI(true);
}

el.micBtn.addEventListener('click', async () => {
  if (isRecording) {
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    if (speechRec) { speechRec.stop(); speechRec = null; }
    return;
  }
  stopSpeaking();
  if (senses.online && senses.caps.whisper) {
    try {
      await startWhisperRecording();
    } catch (err) {
      alert(`Brak dostępu do mikrofonu: ${err.message}`);
    }
  } else {
    startBrowserRecognition();
  }
});

// ----------------------------------------------------------------
// Zmysły: wzrok — zdjęcie z kamery (webcam / Kinect RGB)
// ----------------------------------------------------------------

async function openCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (err) {
    alert(`Brak dostępu do kamery: ${err.message}`);
    return;
  }
  el.cameraVideo.srcObject = cameraStream;
  el.cameraModal.style.display = '';
}

function closeCamera() {
  el.cameraModal.style.display = 'none';
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  el.cameraVideo.srcObject = null;
}

el.cameraBtn.addEventListener('click', openCamera);
el.cameraClose.addEventListener('click', closeCamera);
el.cameraModal.addEventListener('click', (e) => {
  if (e.target === el.cameraModal) closeCamera();
});

el.cameraCapture.addEventListener('click', () => {
  const video = el.cameraVideo;
  if (!video.videoWidth) return;
  const canvas = document.createElement('canvas');
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  if (pendingImages.length < 4) {
    pendingImages.push(canvas.toDataURL('image/jpeg', 0.85));
    renderAttachments();
    updateSendButton();
  }
  closeCamera();
  el.input.focus();
});

// ----------------------------------------------------------------
// Sidebar / motyw / endpoint
// ----------------------------------------------------------------

el.newChatBtn.addEventListener('click', newConversation);
el.collapseBtn.addEventListener('click', () => {
  el.sidebar.classList.add('collapsed');
  document.querySelector('.app').classList.add('sidebar-hidden');
});
el.expandBtn.addEventListener('click', () => {
  el.sidebar.classList.remove('collapsed');
  document.querySelector('.app').classList.remove('sidebar-hidden');
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEYS.theme, theme);
  const dark = theme === 'dark';
  el.themeIconDark.style.display = dark ? 'none' : '';
  el.themeIconLight.style.display = dark ? '' : 'none';
  el.themeLabel.textContent = dark ? 'Jasny motyw' : 'Ciemny motyw';
  document.querySelector('meta[name="theme-color"]')
    .setAttribute('content', dark ? '#05060a' : '#fbfbfd');
}

el.themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || 'dark');

function setEndpoint(name) {
  endpoint = name;
  localStorage.setItem(STORAGE_KEYS.endpoint, name);
  el.tabCloud.classList.toggle('active', name === 'cloud');
  el.tabLocal.classList.toggle('active', name === 'local');
  updateModelBadge();
}

el.tabCloud.addEventListener('click', () => setEndpoint('cloud'));
el.tabLocal.addEventListener('click', () => setEndpoint('local'));

// ----------------------------------------------------------------
// Ustawienia (modal)
// ----------------------------------------------------------------

function openSettings() {
  el.setModelCloud.value = settings.modelCloud;
  el.setModelLocal.value = settings.modelLocal;
  el.setSystem.value = settings.systemPrompt;
  el.setTemp.value = settings.temperature;
  el.tempValue.textContent = settings.temperature;
  el.setMaxTokens.value = settings.maxTokens;
  el.modelSelectCloud.style.display = 'none';
  el.modelSelectLocal.style.display = 'none';
  renderConfigInfo();
  el.settingsModal.style.display = '';
}

function closeSettings() {
  el.settingsModal.style.display = 'none';
}

function renderConfigInfo() {
  const c = epConfig('cloud');
  const l = epConfig('local');
  el.configInfo.innerHTML =
    `<strong>KONFIGURACJA SERWERA (.env)</strong><br>` +
    `chmura:  ${escapeHtml(c.baseUrl || '—')}<br>` +
    `         model: ${escapeHtml(c.model || '—')}${c.visionModel ? ` · wizyjny: ${escapeHtml(c.visionModel)}` : ''}<br>` +
    `         klucz API: ${c.hasApiKey ? 'ustawiony ✓' : 'BRAK — ustaw NVIDIA_API_KEY'}<br>` +
    `lokalny: ${escapeHtml(l.baseUrl || '—')}<br>` +
    `         model: ${escapeHtml(l.model || 'nie ustawiono — LOCAL_MODEL')}`;
}

el.settingsBtn.addEventListener('click', openSettings);
el.settingsClose.addEventListener('click', closeSettings);
el.settingsModal.addEventListener('click', (e) => {
  if (e.target === el.settingsModal) closeSettings();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && el.settingsModal.style.display !== 'none') closeSettings();
});

el.setTemp.addEventListener('input', () => {
  el.tempValue.textContent = el.setTemp.value;
});

el.settingsSave.addEventListener('click', () => {
  settings.modelCloud = el.setModelCloud.value.trim();
  settings.modelLocal = el.setModelLocal.value.trim();
  settings.systemPrompt = el.setSystem.value;
  settings.temperature = parseFloat(el.setTemp.value);
  settings.maxTokens = parseInt(el.setMaxTokens.value, 10) || DEFAULT_SETTINGS.maxTokens;
  saveSettings();
  updateModelBadge();
  closeSettings();
});

el.settingsReset.addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS };
  saveSettings();
  openSettings();
  updateModelBadge();
});

async function fetchModelsInto(epName, selectEl, btn) {
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Pobieranie…';
  try {
    const res = await fetch(`/api/models?endpoint=${epName}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const models = (data.data || []).map((m) => m.id).sort();
    if (!models.length) throw new Error('Endpoint nie zwrócił żadnych modeli.');
    selectEl.innerHTML =
      '<option value="">— wybierz model z listy —</option>' +
      models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    selectEl.style.display = '';
  } catch (err) {
    alert(`Nie udało się pobrać listy modeli:\n${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

el.fetchModelsCloud.addEventListener('click', () =>
  fetchModelsInto('cloud', el.modelSelectCloud, el.fetchModelsCloud));
el.fetchModelsLocal.addEventListener('click', () =>
  fetchModelsInto('local', el.modelSelectLocal, el.fetchModelsLocal));

el.modelSelectCloud.addEventListener('change', () => {
  if (el.modelSelectCloud.value) el.setModelCloud.value = el.modelSelectCloud.value;
});
el.modelSelectLocal.addEventListener('change', () => {
  if (el.modelSelectLocal.value) el.setModelLocal.value = el.modelSelectLocal.value;
});

// ----------------------------------------------------------------
// Status i konfiguracja serwera
// ----------------------------------------------------------------

function updateModelBadge() {
  const model = currentModel() || 'model nieustawiony';
  const label = endpoint === 'local' ? 'lokalnie' : 'chmura';
  el.topbarModel.textContent = `${model} · ${label}`;
  el.welcomeModel.textContent = model;
}

function setStatusRow(rowEl, online, extra) {
  const dot = rowEl.querySelector('.status-dot');
  const state = rowEl.querySelector('.status-state');
  dot.className = 'status-dot ' + (online === true ? 'ok' : online === 'warn' ? 'warn' : 'err');
  state.textContent = extra;
}

async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    const st = await res.json();
    const cloudCfg = epConfig('cloud');
    if (!cloudCfg.hasApiKey) {
      setStatusRow(el.statusCloud, 'warn', 'brak klucza');
    } else {
      setStatusRow(el.statusCloud, st.cloud?.online === true, st.cloud?.online ? 'online' : 'offline');
    }
    setStatusRow(el.statusLocal, st.local?.online === true, st.local?.online ? 'online' : 'offline');
    senses = { online: st.senses?.online === true, caps: st.senses?.caps || {} };
    if (senses.online) {
      const active = Object.entries(senses.caps).filter(([, v]) => v).map(([k]) => k);
      setStatusRow(el.statusSenses, true, active.length ? active.length + ' aktywne' : 'online');
      el.statusSenses.title = active.length ? 'Aktywne zmysły: ' + active.join(', ') : 'Usługa działa';
    } else {
      setStatusRow(el.statusSenses, 'warn', 'offline');
      el.statusSenses.title = 'Uruchom: python senses/service.py';
    }
  } catch {
    setStatusRow(el.statusCloud, false, '—');
    setStatusRow(el.statusLocal, false, '—');
    setStatusRow(el.statusSenses, false, '—');
  }
}

async function loadServerConfig() {
  try {
    const res = await fetch('/api/config');
    serverConfig = await res.json();
  } catch { /* serwer nieosiągalny — UI dalej działa */ }
  updateModelBadge();
  refreshStatus();
}

// ----------------------------------------------------------------
// PWA
// ----------------------------------------------------------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline dev */ });
  });
}

// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------

setEndpoint(endpoint);
el.ttsToggle.classList.toggle('active', Boolean(settings.speak));
renderSidebar();
renderMessages();
updateSendButton();
loadServerConfig();
setInterval(refreshStatus, 30000);
el.input.focus();

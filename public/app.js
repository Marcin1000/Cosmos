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
let voiceMode = false;        // tryb asystenta głosowego („Hej, Kosmos”)
let voiceState = 'off';       // wake | listening | thinking | speaking
let voiceWakeRec = null;
let voiceQueryRec = null;
let voiceCameraStream = null;
let voiceNoteMode = false;    // dyktowanie notatki do bazy wiedzy
let voiceNoteBuffer = [];
let kbSelected = new Set(loadJson('cosmos.kbSelected', []));
let kbRecorder = null;
let kbSpeechRec = null;
let kbRecording = false;

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
  endpointSwitch: $('endpoint-switch'),
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
  memoryList: $('memory-list'),
  memoryCount: $('memory-count'),
  voiceBtn: $('voice-btn'),
  voiceOverlay: $('voice-overlay'),
  voiceClose: $('voice-close'),
  voiceOrb: $('voice-orb'),
  voiceStatus: $('voice-status'),
  voiceTranscript: $('voice-transcript'),
  voiceAnswer: $('voice-answer'),
  voiceCameraWrap: $('voice-camera-wrap'),
  voiceCamera: $('voice-camera'),
  kbBtn: $('kb-btn'),
  kbBadge: $('kb-badge'),
  kbModal: $('kb-modal'),
  kbClose: $('kb-close'),
  kbUploadBtn: $('kb-upload-btn'),
  kbFileInput: $('kb-file-input'),
  kbRecordBtn: $('kb-record-btn'),
  kbUrl: $('kb-url'),
  kbAddLink: $('kb-add-link'),
  kbDrop: $('kb-drop'),
  kbStatus: $('kb-status'),
  kbList: $('kb-list'),
  studioBtn: $('studio-btn'),
  studioModal: $('studio-modal'),
  studioClose: $('studio-close'),
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
  const override = endpoint === 'local' ? settings.modelLocal
    : endpoint === 'cloud' ? settings.modelCloud : '';
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

  if (m.search) {
    msg.className = 'msg msg-search';
    msg.innerHTML =
      `<details class="search-results"><summary>🔍 Wyniki wyszukiwania: „${escapeHtml(m.searchQuery || '')}”</summary>` +
      `<pre>${escapeHtml(text)}</pre></details>`;
    return msg;
  }

  if (isError) {
    body.textContent = text;
    msg.appendChild(body);
    return msg;
  }

  if (role === 'user') {
    const imgs = imagesHtml(images);
    if (imgs) body.appendChild(imgs);
    if (text) body.appendChild(document.createTextNode(text));
    const col = document.createElement('div');
    col.className = 'user-col';
    col.append(body, messageActions(text, { copy: false }));
    msg.appendChild(col);
    return msg;
  }

  body.innerHTML = renderMarkdown(text);
  if (images.length) {
    const imgs = imagesHtml(images);
    body.prepend(imgs);
  }

  const col = document.createElement('div');
  col.style.flex = '1';
  col.style.minWidth = '0';
  col.append(body, messageActions(text, { copy: true }));
  msg.appendChild(col);
  return msg;
}

function messageActions(text, { copy }) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  if (copy) {
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
  }

  if (text.trim()) {
    const remBtn = document.createElement('button');
    remBtn.className = 'msg-action-btn';
    remBtn.innerHTML = '✦ Zapamiętaj';
    remBtn.addEventListener('click', async () => {
      remBtn.disabled = true;
      try {
        const res = await fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.trim() }),
        });
        if (!res.ok) throw new Error();
        remBtn.textContent = '✓ Zapamiętano';
      } catch {
        remBtn.textContent = '✗ Błąd zapisu';
        remBtn.disabled = false;
      }
    });
    actions.appendChild(remBtn);
  }

  return actions;
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
    if (images.length && m.role === 'user') {
      const parts = images.map((src) => ({ type: 'image_url', image_url: { url: src } }));
      if (text) parts.push({ type: 'text', text });
      api.push({ role: m.role, content: parts });
    } else {
      // obrazy w wiadomościach asystenta (np. wygenerowane w Studiu)
      // nie wracają do API — wysyłamy sam tekst
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

  await runGeneration(conv);
}

// jedno przejście streamingu — zwraca zebrany tekst odpowiedzi
async function streamOnce(conv) {
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
    const modelOverride = endpoint === 'local' ? settings.modelLocal
      : endpoint === 'cloud' ? settings.modelCloud : '';
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint,
        messages: toApiMessages(conv),
        model: modelOverride || undefined,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        kbSelected: [...kbSelected],
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
    return acc;
  } catch (err) {
    if (err.name === 'AbortError') {
      err.partial = acc;
    }
    throw err;
  }
}

async function webSearch(query) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (data.error && !data.results.length) {
      return `WYNIKI WYSZUKIWANIA („${query}”): błąd — ${data.error}\nOdpowiedz na podstawie własnej wiedzy i zaznacz, że nie udało się sprawdzić internetu.`;
    }
    if (!data.results.length) {
      return `WYNIKI WYSZUKIWANIA („${query}”): brak wyników.\nOdpowiedz na podstawie własnej wiedzy i zaznacz brak wyników.`;
    }
    const lines = data.results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`);
    return `WYNIKI WYSZUKIWANIA („${query}”):\n${lines.join('\n')}\n\n` +
           'Odpowiedz teraz na pytanie użytkownika na podstawie tych wyników i podaj źródła.';
  } catch (err) {
    return `WYNIKI WYSZUKIWANIA („${query}”): błąd sieci (${err.message}).`;
  }
}

const SEARCH_MARKER_RE = /\[SZUKAJ:\s*([^\]\n]+)\]/i;
const IMAGE_MARKER_RE = /\[OBRAZ:\s*([^\]\n]+)\]/i;

async function runGeneration(conv) {
  isGenerating = true;
  setGeneratingUI(true);
  if (voiceMode) setVoiceState('thinking');
  let finalText = '';

  try {
    for (let depth = 0; depth < 3; depth++) {
      const acc = await streamOnce(conv);
      const marker = acc.match(SEARCH_MARKER_RE);

      if (marker && depth < 2) {
        const q = marker[1].trim();
        const before = acc.replace(marker[0], '').trim();
        conv.messages.push({
          role: 'assistant',
          content: (before ? before + '\n\n' : '') + `🔍 *Szukam w internecie: „${q}”…*`,
        });
        saveConversations();
        renderMessages();
        if (voiceMode) {
          setVoiceState('speaking');
          await speakText('Sprawdzam w internecie.');
          setVoiceState('thinking');
        }
        const resultsText = await webSearch(q);
        conv.messages.push({ role: 'user', content: resultsText, search: true, searchQuery: q });
        saveConversations();
        renderMessages();
        continue;
      }

      const imgMarker = acc.match(IMAGE_MARKER_RE);
      if (imgMarker) {
        const prompt = imgMarker[1].trim();
        const before = acc.replace(imgMarker[0], '').trim();
        conv.messages.push({
          role: 'assistant',
          content: (before ? before + '\n\n' : '') + '🎨 *Generuję obraz…*',
        });
        saveConversations();
        renderMessages();
        if (voiceMode) {
          setVoiceState('speaking');
          await speakText('Generuję obraz.');
          setVoiceState('thinking');
        }
        try {
          const r = await fetch('/api/studio/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
          conv.messages.push({
            role: 'assistant',
            content: { text: 'Gotowe — obraz zapisany w Bazie wiedzy.', images: [d.url] },
          });
          finalText = 'Wygenerowałem obraz i zapisałem go w bazie wiedzy.';
        } catch (err) {
          conv.messages.push({
            role: 'assistant',
            content: `⚠ Generowanie obrazu nie powiodło się: ${err.message}`,
            error: true,
          });
          if (voiceMode) finalText = 'Nie udało się wygenerować obrazu.';
        }
        saveConversations();
        break;
      }

      finalText = acc || '*(pusta odpowiedź modelu)*';
      conv.messages.push({ role: 'assistant', content: finalText });
      saveConversations();
      break;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      if (err.partial) {
        conv.messages.push({ role: 'assistant', content: err.partial });
        saveConversations();
      }
    } else {
      conv.messages.push({ role: 'assistant', content: `⚠ ${err.message}`, error: true });
      saveConversations();
      if (voiceMode) finalText = 'Przepraszam, wystąpił błąd połączenia z modelem.';
    }
  } finally {
    isGenerating = false;
    abortController = null;
    setGeneratingUI(false);
    renderMessages();
    if (voiceMode) {
      if (finalText) {
        el.voiceAnswer.textContent = stripForSpeech(finalText);
        setVoiceState('speaking');
        await speakText(finalText);
      }
      if (voiceMode) startQueryListening(); // rozmowa trwa — pytanie uzupełniające bez wake word
    } else {
      if (settings.speak && finalText) speakText(finalText);
      el.input.focus();
    }
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
    .replace(/\[SZUKAJ:[^\]]*\]/gi, '')
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

// Zwraca Promise kończącą się wraz z końcem mówienia —
// tryb głosowy czeka, zanim znów zacznie słuchać (brak sprzężenia).
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
        await new Promise((resolve) => {
          currentAudio = new Audio(URL.createObjectURL(blob));
          currentAudio.onended = resolve;
          currentAudio.onerror = resolve;
          currentAudio.play().catch(resolve);
        });
        return;
      }
    } catch { /* fallback niżej */ }
  }

  // 2. Głos systemowy przeglądarki
  if ('speechSynthesis' in window) {
    await new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = 'pl-PL';
      const plVoice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('pl'));
      if (plVoice) u.voice = plVoice;
      u.onend = resolve;
      u.onerror = resolve;
      speechSynthesis.speak(u);
    });
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
// STUDIO — obraz (OpenAI) · dźwięk (ElevenLabs) · wideo (Seedance)
// ----------------------------------------------------------------

function studioOut(section, html) {
  const out = $(`studio-${section}-out`);
  out.innerHTML = html;
  out.classList.add('show');
}

function studioNote(item, exported) {
  return `<span class="studio-note">✓ zapisano w Bazie wiedzy: ${escapeHtml(item.name)}` +
         (exported ? `<br>✓ wyeksportowano: ${escapeHtml(exported)}` : '') + '</span>';
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
    }
    if (prov.voice) $('studio-speech-voice').placeholder = `voice ID (puste = ${prov.voice})`;
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
    // obrazy z bazy wiedzy jako pierwsza klatka wideo
    const kb = await (await fetch('/api/kb')).json();
    const sel = $('studio-video-image');
    sel.innerHTML = '<option value="">pierwsza klatka: brak (sam prompt)</option>' +
      (kb.items || []).filter((i) => (i.mime || '').startsWith('image/'))
        .map((i) => `<option value="${escapeHtml(i.id)}">klatka: ${escapeHtml(i.name)}</option>`).join('');
  } catch { /* sekcje zostają w stanie domyślnym */ }
}

el.studioBtn.addEventListener('click', openStudio);
el.studioClose.addEventListener('click', () => { el.studioModal.style.display = 'none'; });
el.studioModal.addEventListener('click', (e) => {
  if (e.target === el.studioModal) el.studioModal.style.display = 'none';
});

$('studio-image-go').addEventListener('click', async () => {
  const prompt = $('studio-image-prompt').value.trim();
  if (!prompt) return;
  studioOut('image', '<span class="studio-note"><span class="studio-spinner"></span>Generuję obraz…</span>');
  try {
    const res = await fetch('/api/studio/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        size: $('studio-image-size').value,
        provider: $('studio-image-provider').value || undefined,
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    studioOut('image', `<img src="${escapeHtml(d.url)}" alt="wygenerowany obraz">` + studioNote(d.item, d.exported));
  } catch (err) {
    studioOut('image', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
  }
});

$('studio-speech-go').addEventListener('click', async () => {
  const text = $('studio-speech-text').value.trim();
  if (!text) return;
  studioOut('speech', '<span class="studio-note"><span class="studio-spinner"></span>Generuję dźwięk…</span>');
  try {
    const res = await fetch('/api/studio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId: $('studio-speech-voice').value.trim() || undefined }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    studioOut('speech', `<audio controls src="${escapeHtml(d.url)}"></audio>` + studioNote(d.item, d.exported));
  } catch (err) {
    studioOut('speech', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
  }
});

$('studio-video-go').addEventListener('click', async () => {
  const prompt = $('studio-video-prompt').value.trim();
  if (!prompt) return;
  studioOut('video', '<span class="studio-note"><span class="studio-spinner"></span>Zlecam zadanie wideo…</span>');
  try {
    const res = await fetch('/api/studio/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        duration: Number($('studio-video-duration').value),
        imageId: $('studio-video-image').value || undefined,
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);

    const started = Date.now();
    while (true) {
      await new Promise((r) => setTimeout(r, 5000));
      const min = Math.round((Date.now() - started) / 60000 * 10) / 10;
      studioOut('video', `<span class="studio-note"><span class="studio-spinner"></span>Generuję wideo… (${min} min — to może potrwać kilka minut)</span>`);
      const st = await (await fetch(`/api/studio/video/status?id=${encodeURIComponent(d.taskId)}`)).json();
      if (st.status === 'done') {
        studioOut('video', `<video controls src="${escapeHtml(st.url)}"></video>` + studioNote(st.item, st.exported));
        break;
      }
      if (st.status === 'failed' || st.error) {
        throw new Error(st.error || 'Zadanie nie powiodło się.');
      }
      if (Date.now() - started > 20 * 60000) throw new Error('Przekroczono limit 20 minut oczekiwania.');
    }
  } catch (err) {
    studioOut('video', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
  }
});

// ----------------------------------------------------------------
// BAZA WIEDZY — pliki, linki, notatki głosowe
// ----------------------------------------------------------------

const KB_MAX_FILE = 50 * 1024 * 1024; // 50 MB na plik

function kbIcon(item) {
  if (item.type === 'link') return '🔗';
  if (item.type === 'note') return '📝';
  const mime = item.mime || '';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.startsWith('video/')) return '🎬';
  const ext = item.name.split('.').pop().toLowerCase();
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return '📊';
  if (['pdf'].includes(ext)) return '📕';
  if (['docx', 'doc', 'odt'].includes(ext)) return '📄';
  if (['pptx', 'ppt'].includes(ext)) return '📽️';
  return '📁';
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function saveKbSelected() {
  localStorage.setItem('cosmos.kbSelected', JSON.stringify([...kbSelected]));
  updateKbBadge();
}

function updateKbBadge() {
  el.kbBadge.textContent = kbSelected.size ? `(${kbSelected.size})` : '';
}

function kbSetStatus(text) {
  el.kbStatus.textContent = text || '';
}

async function loadKbList() {
  try {
    const res = await fetch('/api/kb');
    const data = await res.json();
    const items = data.items || [];

    // usuń z zaznaczenia pozycje, których już nie ma
    const ids = new Set(items.map((i) => i.id));
    let changed = false;
    for (const id of kbSelected) if (!ids.has(id)) { kbSelected.delete(id); changed = true; }
    if (changed) saveKbSelected();

    el.kbList.innerHTML = '';
    if (!items.length) {
      el.kbList.innerHTML = '<div class="kb-empty">Baza jest pusta — dodaj pliki, linki albo nagraj notatkę.</div>';
      return;
    }
    for (const item of [...items].reverse()) {
      const row = document.createElement('div');
      row.className = 'kb-item';

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.title = 'Dołączaj do rozmowy';
      check.checked = kbSelected.has(item.id);
      check.addEventListener('change', () => {
        if (check.checked) kbSelected.add(item.id);
        else kbSelected.delete(item.id);
        saveKbSelected();
      });

      const icon = document.createElement('span');
      icon.className = 'kb-item-icon';
      icon.textContent = kbIcon(item);

      const main = document.createElement('div');
      main.className = 'kb-item-main';
      const name = document.createElement('div');
      name.className = 'kb-item-name';
      if (item.type === 'link' && item.url) {
        name.innerHTML = `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.name)}</a>`;
      } else if (item.type === 'file') {
        name.innerHTML = `<a href="/api/kb/raw?id=${encodeURIComponent(item.id)}" target="_blank" rel="noopener">${escapeHtml(item.name)}</a>`;
      } else {
        name.textContent = item.name;
      }
      const meta = document.createElement('div');
      meta.className = 'kb-item-meta';
      const bits = [];
      if (item.size) bits.push(fmtSize(item.size));
      bits.push(new Date(item.time).toLocaleDateString('pl-PL'));
      bits.push(item.textChars ? `tekst: ${item.textChars} zn.` : 'bez tekstu');
      meta.textContent = bits.join(' · ');
      meta.title = item.preview || '';
      main.append(name, meta);

      const del = document.createElement('button');
      del.className = 'kb-item-del';
      del.textContent = '×';
      del.title = 'Usuń z bazy';
      del.addEventListener('click', async () => {
        if (!confirm(`Usunąć „${item.name}” z bazy wiedzy?`)) return;
        await fetch(`/api/kb?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
        kbSelected.delete(item.id);
        saveKbSelected();
        loadKbList();
      });

      row.append(check, icon, main, del);
      el.kbList.appendChild(row);
    }
  } catch {
    el.kbList.innerHTML = '<div class="kb-empty">Nie udało się wczytać bazy wiedzy.</div>';
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
    reader.onerror = () => reject(new Error('Nie udało się odczytać pliku.'));
    reader.readAsDataURL(file);
  });
}

async function kbUploadFiles(files) {
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    if (file.size > KB_MAX_FILE) {
      alert(`„${file.name}” jest większy niż 50 MB — pomijam.`);
      continue;
    }
    kbSetStatus(`Przetwarzam ${i + 1}/${list.length}: ${file.name}` +
      (/^(audio|video)/.test(file.type) ? ' (transkrypcja może chwilę potrwać)…' : '…'));
    try {
      const res = await fetch('/api/kb/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, mime: file.type, data: await fileToBase64(file) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (err) {
      alert(`Nie udało się dodać „${file.name}”:\n${err.message}`);
    }
  }
  kbSetStatus('');
  loadKbList();
}

async function kbAddLink() {
  const url = el.kbUrl.value.trim();
  if (!url) return;
  el.kbAddLink.disabled = true;
  kbSetStatus(`Pobieram stronę: ${url}…`);
  try {
    const res = await fetch('/api/kb/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    el.kbUrl.value = '';
  } catch (err) {
    alert(`Nie udało się dodać linku:\n${err.message}`);
  } finally {
    el.kbAddLink.disabled = false;
    kbSetStatus('');
    loadKbList();
  }
}

async function kbSaveNote(text) {
  const clean = (text || '').trim();
  if (!clean) return false;
  const res = await fetch('/api/kb/note', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: clean }),
  });
  loadKbList();
  return res.ok;
}

function setKbRecordingUI(on) {
  kbRecording = on;
  el.kbRecordBtn.classList.toggle('recording', on);
  el.kbRecordBtn.textContent = on ? '⏹ Zakończ i zapisz' : '🎙 Nagraj notatkę';
}

async function kbToggleRecording() {
  if (kbRecording) {
    if (kbRecorder?.state === 'recording') kbRecorder.stop();
    if (kbSpeechRec) { kbSpeechRec.stop(); }
    return;
  }
  // wariant 1: Whisper przez zmysły (nagranie audio)
  if (senses.online && senses.caps.whisper) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      kbRecorder = new MediaRecorder(stream);
      kbRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      kbRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setKbRecordingUI(false);
        kbSetStatus('Transkrybuję nagranie (Whisper)…');
        try {
          const blob = new Blob(chunks, { type: kbRecorder.mimeType || 'audio/webm' });
          const res = await fetch('/api/stt', {
            method: 'POST', headers: { 'Content-Type': blob.type }, body: blob,
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          if (data.text) await kbSaveNote(data.text);
          else alert('Nie rozpoznano mowy w nagraniu.');
        } catch (err) {
          alert(`Transkrypcja nie powiodła się:\n${err.message}`);
        } finally {
          kbSetStatus('');
        }
      };
      kbRecorder.start();
      setKbRecordingUI(true);
      kbSetStatus('Nagrywam… kliknij ⏹, aby zakończyć i zapisać.');
    } catch (err) {
      alert(`Brak dostępu do mikrofonu: ${err.message}`);
    }
    return;
  }
  // wariant 2: dyktowanie przeglądarki (Chrome/Edge)
  const SR = getSR();
  if (!SR) {
    alert('Nagrywanie notatki wymaga usługi Cosmos Senses (Whisper) albo przeglądarki Chrome/Edge.');
    return;
  }
  let acc = '';
  kbSpeechRec = new SR();
  kbSpeechRec.lang = 'pl-PL';
  kbSpeechRec.continuous = true;
  kbSpeechRec.interimResults = true;
  kbSpeechRec.onresult = (e) => {
    acc = [...e.results].filter((r) => r.isFinal).map((r) => r[0].transcript).join(' ');
    const interim = [...e.results].filter((r) => !r.isFinal).map((r) => r[0].transcript).join(' ');
    kbSetStatus('🎙 ' + (acc + ' ' + interim).trim().slice(-160));
  };
  kbSpeechRec.onend = async () => {
    kbSpeechRec = null;
    setKbRecordingUI(false);
    kbSetStatus('');
    if (acc.trim()) await kbSaveNote(acc);
  };
  kbSpeechRec.onerror = () => { /* onend zapisze, co się udało */ };
  kbSpeechRec.start();
  setKbRecordingUI(true);
}

el.kbBtn.addEventListener('click', () => {
  el.kbModal.style.display = '';
  loadKbList();
});
el.kbClose.addEventListener('click', () => { el.kbModal.style.display = 'none'; });
el.kbModal.addEventListener('click', (e) => {
  if (e.target === el.kbModal) el.kbModal.style.display = 'none';
});
el.kbUploadBtn.addEventListener('click', () => el.kbFileInput.click());
el.kbFileInput.addEventListener('change', () => {
  kbUploadFiles(el.kbFileInput.files);
  el.kbFileInput.value = '';
});
el.kbAddLink.addEventListener('click', kbAddLink);
el.kbUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') kbAddLink(); });
el.kbRecordBtn.addEventListener('click', kbToggleRecording);

for (const evt of ['dragover', 'dragenter']) {
  el.kbDrop.addEventListener(evt, (e) => { e.preventDefault(); el.kbDrop.classList.add('dragover'); });
}
for (const evt of ['dragleave', 'drop']) {
  el.kbDrop.addEventListener(evt, (e) => { e.preventDefault(); el.kbDrop.classList.remove('dragover'); });
}
el.kbDrop.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files?.length) kbUploadFiles(e.dataTransfer.files);
});

// ----------------------------------------------------------------
// ASYSTENT GŁOSOWY — „Hej, Kosmos” (jak Asystent Google)
// Wake word i rozmowa: Web Speech API (Chrome/Edge, także Android).
// ----------------------------------------------------------------

const WAKE_RE = /\b(hej|hey|ok(?:ej)?)[\s,.!]*(kosmos|cosmos)\b/i;
const END_RE = /\b(koniec|zako[nń]cz|do widzenia|dobranoc|stop)\b/i;
const VISUAL_RE = /\b(co (mam|trzymam|widzisz|to jest)|jak wygl[ąa]da|sp[oó]jrz|popatrz|zobacz|przyjrzyj|w r[ęe]ku|w d[łl]oni|przed kamer[ąa]|na biurku|w kadrze|rozpoznaj)\b/i;

function getSR() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setVoiceState(state) {
  voiceState = state;
  el.voiceOrb.className = 'voice-orb ' + state;
  el.voiceStatus.textContent = {
    wake: 'POWIEDZ „HEJ, KOSMOS”',
    listening: 'SŁUCHAM…',
    thinking: 'MYŚLĘ…',
    speaking: 'MÓWIĘ…',
  }[state] || '';
}

function chime(freq = 880) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch { /* dźwięk to tylko ozdoba */ }
}

function stopVoiceRecognizers() {
  for (const rec of [voiceWakeRec, voiceQueryRec]) {
    if (rec) {
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      try { rec.stop(); } catch { /* już zatrzymany */ }
    }
  }
  voiceWakeRec = null;
  voiceQueryRec = null;
}

async function enterVoiceMode() {
  const SR = getSR();
  if (!SR) {
    alert('Tryb głosowy wymaga przeglądarki Chrome lub Edge (Web Speech API).');
    return;
  }
  voiceMode = true;
  el.voiceOverlay.style.display = '';
  el.voiceTranscript.textContent = '';
  el.voiceAnswer.textContent = '';

  // kamera dla pytań „co widzisz / co mam w ręku” (cicha zgoda = brak wizji)
  try {
    voiceCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    el.voiceCamera.srcObject = voiceCameraStream;
    el.voiceCameraWrap.style.display = '';
  } catch { /* tryb głosowy działa też bez kamery */ }

  startWakeListening();
}

function exitVoiceMode() {
  voiceMode = false;
  voiceNoteMode = false;
  voiceNoteBuffer = [];
  stopVoiceRecognizers();
  stopSpeaking();
  el.voiceOverlay.style.display = 'none';
  if (voiceCameraStream) {
    voiceCameraStream.getTracks().forEach((t) => t.stop());
    voiceCameraStream = null;
  }
  el.voiceCamera.srcObject = null;
  el.voiceCameraWrap.style.display = 'none';
  setVoiceState('off');
}

function startWakeListening() {
  if (!voiceMode) return;
  stopVoiceRecognizers();
  setVoiceState('wake');
  el.voiceTranscript.textContent = '';

  const SR = getSR();
  const rec = new SR();
  voiceWakeRec = rec;
  rec.lang = 'pl-PL';
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (e) => {
    const latest = [...e.results].slice(-3).map((r) => r[0].transcript).join(' ');
    const match = latest.match(WAKE_RE);
    if (!match) return;
    // wszystko po „hej, kosmos” traktujemy od razu jako pytanie
    const after = latest.slice(latest.search(WAKE_RE) + match[0].length).trim();
    rec.onend = null;
    try { rec.stop(); } catch { /* ignorujemy */ }
    voiceWakeRec = null;
    chime(880);
    if (after.length > 5) handleVoiceQuery(after);
    else startQueryListening();
  };
  rec.onend = () => {
    // Chrome ucina sesję co ~60 s — wznawiamy nasłuch
    if (voiceMode && voiceState === 'wake') {
      setTimeout(() => { if (voiceMode && voiceState === 'wake') startWakeListening(); }, 300);
    }
  };
  rec.onerror = () => { /* onend zrobi restart */ };
  try { rec.start(); } catch { /* podwójny start — ignorujemy */ }
}

function startQueryListening() {
  if (!voiceMode) return;
  stopVoiceRecognizers();
  setVoiceState('listening');

  const SR = getSR();
  const rec = new SR();
  voiceQueryRec = rec;
  rec.lang = 'pl-PL';
  rec.continuous = false;
  rec.interimResults = true;

  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (const r of e.results) {
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    el.voiceTranscript.textContent = (finalText + ' ' + interim).trim();
  };
  rec.onend = () => {
    voiceQueryRec = null;
    if (!voiceMode) return;
    const text = finalText.trim();
    if (text) handleVoiceQuery(text);
    else startWakeListening(); // cisza — wracamy do nasłuchu wake word
  };
  rec.onerror = () => { /* onend obsłuży powrót */ };
  try { rec.start(); } catch { /* ignorujemy */ }
}

function captureVoiceFrame() {
  const video = el.voiceCamera;
  if (!voiceCameraStream || !video.videoWidth) return null;
  const canvas = document.createElement('canvas');
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const NOTE_START_RE = /\b(nowa notatka|nagraj notatk[ęe]|(zacznij|rozpocznij|start)\s+(nagrywanie|nagrywa[ćc]|notatk[ęe]|dyktowanie))\b/i;
const NOTE_STOP_RE = /\b((koniec|zako[nń]cz|stop|zapisz)\s+(notatk[ęei]|nagrywani[ae]|dyktowani[ae]))\b/i;

async function handleVoiceQuery(text) {
  el.voiceTranscript.textContent = text;

  // --- tryb dyktowania notatki do bazy wiedzy ---
  if (voiceNoteMode) {
    if (NOTE_STOP_RE.test(text)) {
      voiceNoteMode = false;
      const note = voiceNoteBuffer.join(' ').trim();
      voiceNoteBuffer = [];
      el.voiceAnswer.textContent = '';
      setVoiceState('speaking');
      if (note) {
        const ok = await kbSaveNote(note);
        await speakText(ok ? 'Zapisałem notatkę w bazie wiedzy.' : 'Nie udało się zapisać notatki.');
      } else {
        await speakText('Notatka była pusta, nic nie zapisałem.');
      }
      if (voiceMode) startQueryListening();
      return;
    }
    voiceNoteBuffer.push(text);
    el.voiceAnswer.textContent = '📝 ' + voiceNoteBuffer.join(' ').slice(-300);
    chime(660);
    if (voiceMode) startQueryListening();
    return;
  }

  if (NOTE_START_RE.test(text)) {
    voiceNoteMode = true;
    voiceNoteBuffer = [];
    el.voiceAnswer.textContent = '📝 Tryb notatki — mów, a zakończ słowami: „koniec notatki”.';
    setVoiceState('speaking');
    await speakText('Nagrywam notatkę. Zakończ słowami: koniec notatki.');
    if (voiceMode) startQueryListening();
    return;
  }

  if (END_RE.test(text) && text.length < 30) {
    setVoiceState('speaking');
    await speakText('Do usłyszenia.');
    if (voiceMode) startWakeListening();
    return;
  }

  // pytanie „wizualne” → dołącz klatkę z kamery (model wizyjny sam się dobierze)
  let frame = null;
  if (VISUAL_RE.test(text)) frame = captureVoiceFrame();

  const conv = ensureConversation(text);
  const content = frame ? { text, images: [frame] } : text;
  conv.messages.push({ role: 'user', content });
  saveConversations();
  renderSidebar();
  renderMessages();

  await runGeneration(conv); // po odpowiedzi wróci do słuchania (finally)
}

el.voiceBtn.addEventListener('click', enterVoiceMode);
el.voiceClose.addEventListener('click', exitVoiceMode);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && voiceMode) exitVoiceMode();
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

const ENDPOINT_TABS = {
  cloud: ['Chmura', '<svg viewBox="0 0 24 24"><path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 12.4 3.5 3.5 0 0 0 6.5 19z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
  local: ['Lokalnie', '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'],
  openai: ['OpenAI', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>'],
  claude: ['Claude', '<svg viewBox="0 0 24 24"><path d="M12 3l2.2 6.8H21l-5.4 4 2 6.9-5.6-4.2-5.6 4.2 2-6.9-5.4-4h6.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'],
};

function buildEndpointTabs() {
  el.endpointSwitch.innerHTML = '';
  const available = [];
  for (const key of Object.keys(ENDPOINT_TABS)) {
    const ep = serverConfig.endpoints?.[key];
    if (!ep) continue;
    if ((key === 'openai' || key === 'claude') && !ep.hasApiKey) continue;
    available.push(key);
    const btn = document.createElement('button');
    btn.className = 'endpoint-tab';
    btn.dataset.endpoint = key;
    btn.setAttribute('role', 'tab');
    btn.innerHTML = ENDPOINT_TABS[key][1] + ENDPOINT_TABS[key][0];
    btn.addEventListener('click', () => setEndpoint(key));
    el.endpointSwitch.appendChild(btn);
  }
  setEndpoint(available.includes(endpoint) ? endpoint : 'cloud');
}

function setEndpoint(name) {
  endpoint = name;
  localStorage.setItem(STORAGE_KEYS.endpoint, name);
  document.querySelectorAll('.endpoint-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.endpoint === name);
  });
  updateModelBadge();
}

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
  loadMemoryList();
  el.settingsModal.style.display = '';
}

async function loadMemoryList() {
  el.memoryList.innerHTML = '<span class="memory-empty">Ładowanie…</span>';
  try {
    const res = await fetch('/api/memory');
    const data = await res.json();
    const items = data.memories || [];
    el.memoryCount.textContent = items.length ? `(${items.length})` : '';
    if (!items.length) {
      el.memoryList.innerHTML = '<span class="memory-empty">Brak wpisów — użyj „✦ Zapamiętaj" pod dowolną wiadomością.</span>';
      return;
    }
    el.memoryList.innerHTML = '';
    for (const m of [...items].reverse()) {
      const row = document.createElement('div');
      row.className = 'memory-item';
      const txt = document.createElement('span');
      txt.className = 'memory-text';
      txt.textContent = m.text;
      txt.title = m.text;
      const del = document.createElement('button');
      del.className = 'memory-del';
      del.textContent = '×';
      del.title = 'Usuń wpis';
      del.addEventListener('click', async () => {
        await fetch(`/api/memory?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
        loadMemoryList();
      });
      row.append(txt, del);
      el.memoryList.appendChild(row);
    }
  } catch {
    el.memoryList.innerHTML = '<span class="memory-empty">Nie udało się wczytać pamięci.</span>';
  }
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
  const labels = { cloud: 'chmura', local: 'lokalnie', openai: 'OpenAI', claude: 'Claude' };
  el.topbarModel.textContent = `${model} · ${labels[endpoint] || endpoint}`;
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
  buildEndpointTabs();
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
updateKbBadge();
renderSidebar();
renderMessages();
updateSendButton();
loadServerConfig();
setInterval(refreshStatus, 30000);
el.input.focus();

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
  systemPrompt: '',
  temperature: 0.6,
  maxTokens: 2048,
  speak: false,
};

let conversations = [];          // INDEKS rozmów: [{id, title, createdAt, updatedAt}]
let activeConversation = null;   // pełna aktywna rozmowa {id, title, messages, …}
let settings = { ...DEFAULT_SETTINGS, ...loadJson(STORAGE_KEYS.settings, {}) };
let endpoint = localStorage.getItem(STORAGE_KEYS.endpoint) || 'cloud';
let activeId = null;
let serverConfig = { endpoints: { cloud: {}, local: {} } };
let abortController = null;
let isGenerating = false;
let pendingImages = []; // dataURL-e załączników czekających na wysłanie
let senses = { online: false, caps: {} }; // stan usługi percepcji (Python)
// Serwer nieosiągalny: interfejs pochodzi z pamięci podręcznej, więc wygląda
// sprawnie. Bez wyraźnego komunikatu awarię widać dopiero po wysłaniu wiadomości.
let serverReachable = true;
let mediaRecorder = null;
let speechRec = null;
let isRecording = false;
let cameraStream = null;
let voiceMode = false;        // tryb asystenta głosowego („Hej, Kosmos”)
let voiceState = 'off';       // wake | listening | thinking | speaking
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

// Zapis aktywnej rozmowy na serwer (data/conversations/) — wspólny dla
// wszystkich urządzeń. Zapis serwerowy jest debounce'owany; kopia w
// localStorage służy tylko jako podgląd offline, gdy serwer jest niedostępny.
let convSaveTimer = null;

function saveConversations() {
  if (!activeConversation) return;
  activeConversation.updatedAt = Date.now();

  // odśwież metadane w indeksie (pasek boczny) i wypłyń na górę
  const meta = {
    id: activeConversation.id,
    title: activeConversation.title,
    createdAt: activeConversation.createdAt,
    updatedAt: activeConversation.updatedAt,
  };
  const i = conversations.findIndex((c) => c.id === activeConversation.id);
  if (i >= 0) conversations[i] = meta; else conversations.unshift(meta);
  conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  renderSidebar();
  cacheConvIndex();

  try { localStorage.setItem('cosmos.conv.' + activeConversation.id, JSON.stringify(activeConversation)); } catch { /* limit */ }

  const snapshot = JSON.stringify(activeConversation);
  const id = activeConversation.id;
  clearTimeout(convSaveTimer);
  convSaveTimer = setTimeout(() => {
    fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: snapshot,
    }).catch(() => { /* offline — zostaje kopia w localStorage */ });
  }, 400);
}

function cacheConvIndex() {
  try { localStorage.setItem('cosmos.convIndex', JSON.stringify(conversations)); } catch { /* limit */ }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function activeConv() {
  return activeConversation;
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
  return typeof m.content === 'string' ? m.content : (m.content?.text || '');
}
function msgImages(m) {
  return typeof m.content === 'string' ? [] : (m.content?.images || []);
}

// ----------------------------------------------------------------
// Mini-renderer Markdown (bez zewnętrznych bibliotek)
// ----------------------------------------------------------------

/** Zamień gołe adresy w tekście na klikalne odnośniki.
 *
 * Model podaje źródła raz jako `[tekst](adres)`, a raz jako sam adres w zdaniu —
 * i ta druga postać zostawała martwym tekstem, którego nie dało się kliknąć.
 * Pracujemy na HTML-u po `renderInline`, więc omijamy to, co już jest wewnątrz
 * `<a>` i `<code>`: inaczej podlinkowalibyśmy adres w atrybucie href.
 */
function autoLink(html) {
  const skip = /<a\b[^>]*>[\s\S]*?<\/a>|<code>[\s\S]*?<\/code>/gi;
  const url = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+\.[a-z]{2,}[^\s<>"']*/gi;

  const linkify = (chunk) => chunk.replace(url, (m) => {
    // Znaki interpunkcyjne na końcu należą do zdania, nie do adresu.
    // Nawias zamykający zostawiamy tylko wtedy, gdy w adresie jest otwierający.
    let tail = '';
    let addr = m;
    for (;;) {
      const last = addr.slice(-1);
      if (/[.,;:!?…"']/.test(last)
          || (last === ')' && (addr.match(/\(/g) || []).length < (addr.match(/\)/g) || []).length)) {
        tail = last + tail;
        addr = addr.slice(0, -1);
        continue;
      }
      break;
    }
    if (!addr) return m;
    const href = addr.startsWith('www.') ? 'https://' + addr : addr;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${addr}</a>${tail}`;
  });

  let out = '';
  let last = 0;
  for (const m of html.matchAll(skip)) {
    out += linkify(html.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + linkify(html.slice(last));
}

function renderInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return autoLink(out);
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
        `<button class="code-copy-btn" data-copy>${COPY_SVG}${t('copy')}</button></div>` +
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

let convSearchQuery = '';

const SVG_PIN = '<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5zM12 14v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_RENAME = '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_TRASH = '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function renderSidebar() {
  el.conversations.innerHTML = '';
  const q = convSearchQuery.trim().toLowerCase();
  const list = q
    ? conversations.filter((c) => (c.title || '').toLowerCase().includes(q) || convContentMatchIds.has(c.id))
    : conversations;

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'conv-empty';
    empty.textContent = q ? t('noConvsFound') : '';
    el.conversations.appendChild(empty);
    return;
  }

  for (const conv of list) {
    const item = document.createElement('div');
    item.className = 'conv-item' + (conv.id === activeId ? ' active' : '');

    const title = document.createElement('button');
    title.className = 'conv-title';
    title.textContent = conv.title || t('newChatFallback');
    title.title = conv.title || t('newChatFallback');
    title.addEventListener('click', () => selectConversation(conv.id));

    const pin = document.createElement('button');
    pin.className = 'conv-action' + (conv.pinned ? ' pinned' : '');
    pin.title = conv.pinned ? t('unpin') : t('pin');
    pin.innerHTML = SVG_PIN;
    pin.addEventListener('click', (e) => { e.stopPropagation(); togglePin(conv.id, !conv.pinned); });

    const rename = document.createElement('button');
    rename.className = 'conv-action';
    rename.title = t('rename');
    rename.innerHTML = SVG_RENAME;
    rename.addEventListener('click', (e) => { e.stopPropagation(); renameConversation(conv.id, conv.title); });

    const del = document.createElement('button');
    del.className = 'conv-action danger';
    del.title = t('deleteConv');
    del.innerHTML = SVG_TRASH;
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteConversation(conv.id); });

    item.append(title, pin, rename, del);
    el.conversations.appendChild(item);
  }
}

async function togglePin(id, pinned) {
  const entry = conversations.find((c) => c.id === id);
  if (entry) entry.pinned = pinned;
  conversations.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  renderSidebar();
  cacheConvIndex();
  try {
    await fetch(`/api/conversations/meta?id=${encodeURIComponent(id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    });
  } catch { /* offline — indeks lokalny już zaktualizowany */ }
}

async function renameConversation(id, current) {
  const name = prompt(t('renamePrompt'), current || '');
  if (name === null) return;
  const title = name.trim();
  if (!title) return;
  const entry = conversations.find((c) => c.id === id);
  if (entry) entry.title = title;
  if (activeConversation && activeConversation.id === id) activeConversation.title = title;
  renderSidebar();
  cacheConvIndex();
  try {
    await fetch(`/api/conversations/meta?id=${encodeURIComponent(id)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  } catch { /* offline */ }
}

function imagesHtml(images) {
  if (!images.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'msg-images';
  for (const src of images) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = t('attachment');
    img.title = t('img.openHint');
    img.addEventListener('click', () => openImageViewer(src));
    wrap.appendChild(img);
  }
  return wrap;
}

/** Podgląd obrazu na pełnym ekranie, z pobieraniem.
 *
 * Miniatura w rozmowie ma kilkaset pikseli, a wygenerowana grafika bywa
 * kilka razy większa — bez tego okna nie dało się jej ani obejrzeć, ani zapisać.
 */
function openImageViewer(src) {
  const box = $('img-viewer');
  const img = $('img-viewer-img');
  img.src = src;
  box.style.display = '';
  imageViewerSrc = src;
}

function closeImageViewer() {
  $('img-viewer').style.display = 'none';
  $('img-viewer-img').removeAttribute('src');
  imageViewerSrc = '';
}

let imageViewerSrc = '';

/** Zapisz oglądany obraz na dysk — działa i dla dataURL, i dla adresu z serwera. */
async function downloadViewedImage() {
  if (!imageViewerSrc) return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  let href = imageViewerSrc;
  let revoke = '';
  if (!href.startsWith('data:')) {
    // Obraz z bazy wiedzy leci przez /api/kb/raw — `download` zadziała tylko
    // na tym samym pochodzeniu, więc pobieramy go i zapisujemy z pamięci.
    try {
      const blob = await (await fetch(imageViewerSrc)).blob();
      href = URL.createObjectURL(blob);
      revoke = href;
    } catch { /* zostaw oryginalny adres — przeglądarka otworzy go w karcie */ }
  }
  const a = document.createElement('a');
  a.href = href;
  a.download = `cosmos-${stamp}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 10000);
}

function messageElement(m, idx = -1) {
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

  if (m.role === 'action') {
    msg.className = 'msg msg-action-card';
    const done = m.done;
    const label = (m.actionType === 'zapamiętaj' || m.actionType === 'remember') ? t('remember')
      : (m.actionType === 'procedura' || m.actionType === 'procedure') ? t('learn.runProc')
      : (m.actionType === 'urządzenie' || m.actionType === 'device') ? t('dev.action')
      : (m.actionType === 'pomysł' || m.actionType === 'pomysl' || m.actionType === 'idea') ? t('imp.action')
      : t('kb.record');
    msg.innerHTML =
      `<div class="action-card">` +
      `<div class="action-card-body"><span class="action-card-type">⚡ ${escapeHtml(label)}</span>` +
      `<span class="action-card-text">${escapeHtml(m.actionText)}</span></div>` +
      (done
        ? `<span class="action-card-done">✓</span>`
        : `<div class="action-card-btns"><button class="btn-primary act-do">${t('actionDo')}</button>` +
          `<button class="btn-secondary act-skip">${t('actionSkip')}</button></div>`) +
      `</div>`;
    if (!done) {
      msg.querySelector('.act-do').addEventListener('click', () => runAction(m, msg));
      msg.querySelector('.act-skip').addEventListener('click', () => { m.done = 'skip'; saveConversations(); renderMessages(); });
    }
    return msg;
  }

  if (m.search) {
    msg.className = 'msg msg-search';
    msg.innerHTML =
      `<details class="search-results"><summary>${t('chat.searchResults', { q: escapeHtml(m.searchQuery || '') })}</summary>` +
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
    col.append(body, messageActions(text, { copy: false, role: 'user', idx }));
    msg.appendChild(col);
    return msg;
  }

  // Tok myślenia zapisany przy wiadomości — zwinięty, żeby nie przykrywał
  // odpowiedzi, ale dostępny, gdy chce się zobaczyć, czym model się zajmował.
  body.innerHTML = (m.think
    ? `<details class="think-block"><summary>${escapeHtml(t('think.done'))}</summary>`
      + `<pre>${escapeHtml(m.think)}</pre></details>`
    : '')
    + (m.note ? `<div class="model-note mono">${escapeHtml(m.note)}</div>` : '')
    + renderMarkdown(text);
  if (images.length) {
    const imgs = imagesHtml(images);
    body.prepend(imgs);
  }

  const col = document.createElement('div');
  col.style.flex = '1';
  col.style.minWidth = '0';
  col.append(body, messageActions(text, { copy: true, role: 'assistant', idx }));
  msg.appendChild(col);
  return msg;
}

function messageActions(text, { copy, role, idx = -1 }) {
  const actions = document.createElement('div');
  actions.className = 'msg-actions';

  if (copy) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.innerHTML = COPY_SVG + ' ' + t('copy');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = t('copied');
        setTimeout(() => { copyBtn.innerHTML = COPY_SVG + ' ' + t('copy'); }, 1500);
      });
    });
    actions.appendChild(copyBtn);
  }

  if (text.trim()) {
    const remBtn = document.createElement('button');
    remBtn.className = 'msg-action-btn';
    remBtn.innerHTML = t('remember');
    remBtn.addEventListener('click', async () => {
      remBtn.disabled = true;
      try {
        const res = await fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text.trim() }),
        });
        if (!res.ok) throw new Error();
        remBtn.textContent = t('remembered');
      } catch {
        remBtn.textContent = t('rememberErr');
        remBtn.disabled = false;
      }
    });
    actions.appendChild(remBtn);
  }

  // Regeneruj — dla wiadomości asystenta (usuwa ją i generuje na nowo)
  if (role === 'assistant' && idx >= 0) {
    const regen = document.createElement('button');
    regen.className = 'msg-action-btn';
    regen.innerHTML = '↻ ' + t('regenerate');
    regen.addEventListener('click', () => regenerateFrom(idx));
    actions.appendChild(regen);
  }

  // Edytuj — dla wiadomości użytkownika (wczytuje do pola, obcina dalej)
  if (role === 'user' && idx >= 0) {
    const edit = document.createElement('button');
    edit.className = 'msg-action-btn';
    edit.innerHTML = '✎ ' + t('editMsg');
    edit.addEventListener('click', () => editFrom(idx));
    actions.appendChild(edit);
  }

  return actions;
}

async function runAction(m, msgEl) {
  const btn = msgEl.querySelector('.act-do');
  if (btn) btn.disabled = true;
  try {
    if (m.actionType === 'pomysł' || m.actionType === 'pomysl' || m.actionType === 'idea') {
      await fetch('/api/improvements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: m.actionText, zrodlo: 'model' }),
      });
      m.done = true; saveConversations(); renderMessages();
      return;
    }
    if (m.actionType === 'urządzenie' || m.actionType === 'device') {
      const r = await fetch('/api/devices/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: (m.actionText || '').trim() }),
      });
      m.done = r.ok ? true : 'skip';
      saveConversations(); renderMessages();
      return;
    }
    if (m.actionType === 'procedura' || m.actionType === 'procedure') {
      if (!window.__procedures) await loadProcedures();
      const want = (m.actionText || '').trim().toLowerCase();
      const proc = (window.__procedures || []).find((p) => p.name.toLowerCase() === want)
        || (window.__procedures || []).find((p) => p.name.toLowerCase().includes(want));
      if (proc) runProcedure(proc);
      m.done = true; saveConversations(); renderMessages();
      return;
    }
    if (m.actionType === 'zapamiętaj' || m.actionType === 'remember') {
      await fetch('/api/memory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: m.actionText }) });
    } else {
      await fetch('/api/kb/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: m.actionText }) });
    }
    m.done = true;
    saveConversations();
    renderMessages();
  } catch {
    if (btn) btn.disabled = false;
  }
}

function regenerateFrom(idx) {
  const conv = activeConv();
  if (!conv || isGenerating) return;
  conv.messages = conv.messages.slice(0, idx); // usuń tę odpowiedź i wszystko po niej
  saveConversations();
  renderMessages();
  runGeneration(conv);
}

function editFrom(idx) {
  const conv = activeConv();
  if (!conv || isGenerating) return;
  const m = conv.messages[idx];
  if (!m) return;
  const text = msgText(m);
  const images = msgImages(m);
  conv.messages = conv.messages.slice(0, idx); // usuń tę wiadomość i wszystko po niej
  pendingImages = images.length ? [...images] : pendingImages;
  saveConversations();
  renderAttachments();
  renderMessages();
  el.input.value = text;
  autosizeInput();
  updateSendButton();
  el.input.focus();
}

function renderMessages() {
  const conv = activeConv();
  el.messages.innerHTML = '';
  const hasMessages = conv && conv.messages.length > 0;
  el.welcome.style.display = hasMessages ? 'none' : '';
  const exportBtn = $('export-btn');
  if (exportBtn) exportBtn.style.display = hasMessages ? '' : 'none';
  const sumBtn = $('summarize-btn');
  if (sumBtn) sumBtn.style.display = hasMessages ? '' : 'none';
  updateTokenEstimate();
  if (!hasMessages) return;

  conv.messages.forEach((m, idx) => {
    el.messages.appendChild(messageElement(m, idx));
  });
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

// Na wąskich ekranach panel boczny to nakładka — zwiń go po akcji nawigacyjnej.
function collapseSidebarOnMobile() {
  if (window.innerWidth <= 720) {
    el.sidebar.classList.add('collapsed');
    document.querySelector('.app').classList.add('sidebar-hidden');
  }
}

function newConversation() {
  if (isGenerating) stopGeneration();
  activeId = null;
  activeConversation = null;
  renderSidebar();
  renderMessages();
  collapseSidebarOnMobile();
  el.input.focus();
}

async function selectConversation(id) {
  if (isGenerating) stopGeneration();
  activeId = id;
  renderSidebar();
  collapseSidebarOnMobile();
  el.messages.innerHTML = '';
  el.welcome.style.display = 'none';
  try {
    const res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error();
    activeConversation = await res.json();
  } catch {
    activeConversation = loadJson('cosmos.conv.' + id, null); // podgląd offline
  }
  renderMessages();
}

function deleteConversation(id) {
  const conv = conversations.find((c) => c.id === id);
  const name = conv?.title || t('newChatFallback');
  if (!confirm(t('confirmDelConv', { name }))) return;
  conversations = conversations.filter((c) => c.id !== id);
  cacheConvIndex();
  fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  try { localStorage.removeItem('cosmos.conv.' + id); } catch { /* ignore */ }
  if (activeId === id) {
    activeId = null;
    activeConversation = null;
    renderMessages();
  }
  renderSidebar();
}

function ensureConversation(firstUserText) {
  if (!activeConversation) {
    const base = firstUserText || 'Rozmowa z obrazem';
    const now = Date.now();
    activeConversation = {
      id: uid(),
      title: base.slice(0, 48) + (base.length > 48 ? '…' : ''),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    activeId = activeConversation.id;
    conversations.unshift({
      id: activeConversation.id,
      title: activeConversation.title,
      createdAt: now,
      updatedAt: now,
    });
  }
  return activeConversation;
}

async function loadConversations() {
  try {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    conversations = data.conversations || [];
    cacheConvIndex();
    await migrateLegacyConversations();
  } catch {
    conversations = loadJson('cosmos.convIndex', []); // serwer offline
  }
  renderSidebar();
}

// Jednorazowa migracja rozmów ze starego localStorage na serwer.
async function migrateLegacyConversations() {
  if (localStorage.getItem('cosmos.migrated')) return;
  const legacy = loadJson(STORAGE_KEYS.conversations, []);
  for (const conv of legacy) {
    if (!conv || !conv.id) continue;
    try {
      await fetch(`/api/conversations?id=${encodeURIComponent(conv.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...conv, updatedAt: conv.updatedAt || conv.createdAt || Date.now() }),
      });
    } catch { /* pominąć — serwer offline, spróbujemy następnym razem */ }
  }
  if (legacy.length) {
    try {
      const res = await fetch('/api/conversations');
      conversations = (await res.json()).conversations || conversations;
      cacheConvIndex();
    } catch { /* ignore */ }
  }
  localStorage.setItem('cosmos.migrated', '1');
  try { localStorage.removeItem(STORAGE_KEYS.conversations); } catch { /* ignore */ }
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
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('cam.readErr'))); };
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
    rm.title = t('removeAttachment');
    rm.addEventListener('click', () => {
      pendingImages.splice(idx, 1);
      renderAttachments();
      updateSendButton();
    });
    wrap.append(img, rm);
    el.attachments.appendChild(wrap);
  });
  renderBlindModelWarning();
}

/** Ostrzeż, gdy do modelu bez wzroku dołączamy obraz.

   Serwer sam przełącza się na model wizyjny, ale tylko jeśli jest ustawiony
   (NEMOTRON_VISION_MODEL / LOCAL_VISION_MODEL). Bez niego zdjęcie poleci do
   modelu, który go nie zobaczy, a odpowiedź będzie zmyślona — lepiej powiedzieć
   o tym przed wysłaniem niż tłumaczyć potem, skąd wzięła się bzdura. */
function renderBlindModelWarning() {
  const old = $('blind-model-warn');
  if (old) old.remove();
  if (!pendingImages.length) return;
  const cfg = epConfig();
  const sees = typeof modelSeesImages === 'function' && modelSeesImages(currentModel());
  if (sees || cfg.visionModel) return;

  const note = document.createElement('div');
  note.id = 'blind-model-warn';
  note.className = 'model-info-warn';
  note.style.padding = '0 4px 6px';
  note.textContent = '⚠ ' + t('model.blindWarn');
  el.attachments.appendChild(note);
}

el.attachBtn.addEventListener('click', () => el.fileInput.click());

el.fileInput.addEventListener('change', async () => {
  for (const file of el.fileInput.files) {
    if (!file.type.startsWith('image/')) continue;
    if (pendingImages.length >= 4) { alert(t('cam.maxImages')); break; }
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
  const sysPrompt = settings.systemPrompt.trim() || t('systemPromptDefault');
  if (sysPrompt) {
    api.push({ role: 'system', content: sysPrompt });
  }
  for (const m of conv.messages) {
    if (m.error || m.role === 'action') continue;
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
  let think = '';
  let renderQueued = false;

  // Modele rozumujące (Nemotron 3, gpt-oss, R1) wysyłają tok myślenia w osobnym
  // polu `reasoning_content`. Bez tego ekran stoi pusty przez cały czas myślenia,
  // a gdy budżet tokenów skończy się w trakcie — zostaje pusta odpowiedź.
  // Pokazujemy myślenie na żywo, zwinięte, żeby było widać, że coś się dzieje.
  // Model rozumujący potrafi milczeć kilkadziesiąt sekund, a pusty dymek
  // z migającym kursorem wygląda jak zawieszenie. Licznik pokazuje, że praca
  // trwa — i ile już trwa.
  const started = Date.now();
  let waitNote = '';
  const waitTimer = setInterval(() => {
    if (acc || think) { clearInterval(waitTimer); waitNote = ''; return; }
    const s = Math.round((Date.now() - started) / 1000);
    waitNote = `<div class="wait-note mono">${escapeHtml(t('chat.stillWorking', { s }))}</div>`;
    schedulePaint();
  }, 1000);

  const paint = () => {
    renderQueued = false;
    const head = think
      ? `<details class="think-block"${acc ? '' : ' open'}>`
        + `<summary>${escapeHtml(t(acc ? 'think.done' : 'think.live'))}</summary>`
        + `<pre>${escapeHtml(think)}</pre></details>`
      : '';
    body.innerHTML = head + renderMarkdown(acc) + '<span class="cursor-blink"></span>' + waitNote;
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
        useSearch: settings.offline ? false : undefined,
      }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      let errText = `Błąd HTTP ${res.status}`;
      try {
        const data = await readJsonSafe(res);
        errText = data.error || errText;
      } catch { /* ignore */ }
      throw new Error(errText);
    }

    // Serwer mógł skierować zdjęcie do modelu wizyjnego. Podmiana za plecami
    // użytkownika byłaby nieuczciwa — mówimy, kto naprawdę odpowiedział.
    const swapped = res.headers.get('X-Cosmos-Model-Swapped-From');
    if (swapped) {
      const used = decodeURIComponent(res.headers.get('X-Cosmos-Model') || '');
      lastModelNote = t('model.swapped', { from: decodeURIComponent(swapped), to: used });
    } else {
      lastModelNote = '';
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
            const d = json.choices?.[0]?.delta || {};
            const delta = d.content ?? json.choices?.[0]?.text ?? '';
            // różni dostawcy nazywają to pole inaczej
            const reason = d.reasoning_content ?? d.reasoning ?? '';
            if (reason) {
              think += reason;
              schedulePaint();
            }
            if (delta) {
              acc += delta;
              schedulePaint();
            }
          } catch { /* niepełny fragment — pomijamy */ }
        }
      }
    }
    clearInterval(waitTimer);
    // Model, któremu budżet tokenów skończył się w trakcie myślenia, nie zdąży
    // nic napisać. Lepiej pokazać sam tok myślenia niż „pusta odpowiedź”.
    if (!acc.trim() && think.trim()) {
      lastReasoning = think.trim();
      lastThink = '';               // myślenie JEST odpowiedzią, nie dopiskiem
      return '';
    }
    lastReasoning = '';
    lastThink = think.trim();
    return acc;
  } catch (err) {
    clearInterval(waitTimer);
    if (err.name === 'AbortError') {
      err.partial = acc;
    }
    throw err;
  }
}

// Model, który faktycznie odpowiedział, gdy różni się od wybranego.
let lastModelNote = '';

// Tok myślenia z ostatniej tury — awaryjne źródło treści, gdy `content` był pusty.
let lastReasoning = '';
// Tok myślenia towarzyszący normalnej odpowiedzi. Trzymamy go przy wiadomości,
// żeby nie znikał po przerysowaniu listy, ale NIE wraca do modelu:
// `toApiMessages` czyta wyłącznie `content`.
let lastThink = '';

async function webSearch(query) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (data.error && !data.results.length) {
      return t('search.err', { q: query, e: data.error });
    }
    if (!data.results.length) {
      return t('search.none', { q: query });
    }
    // Treść strony (gdy serwer zdążył ją pobrać) jest tym, z czego model
    // faktycznie wyczyta odpowiedź — zajawka to zwykle sam opis serwisu.
    const lines = data.results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
      + (r.text ? `\n   TREŚĆ STRONY:\n   ${r.text.replace(/\n/g, '\n   ')}` : ''));
    return t('search.results', { q: query, lines: lines.join('\n') });
  } catch (err) {
    return t('search.netErr', { q: query, e: err.message });
  }
}

const SEARCH_MARKER_RE = /\[SZUKAJ:\s*([^\]\n]+)\]/i;

/** Usuń dyrektywę wyszukiwania z tekstu pokazywanego użytkownikowi.
 *  To polecenie dla modelu, nie treść odpowiedzi — nigdy nie ma trafić na ekran. */
function stripSearchMarker(s) {
  return String(s || '').replace(/\[SZUKAJ:[^\]]*\]/gi, '').trim();
}
const IMAGE_MARKER_RE = /\[OBRAZ:\s*([^\]\n]+)\]/i;
const ACTION_RE = /\[AKCJA:\s*([^|\]]+)\|\s*([^\]]+)\]/i;

async function runGeneration(conv) {
  isGenerating = true;
  setGeneratingUI(true);
  if (voiceMode) setVoiceState('thinking');
  let finalText = '';

  const MAX_SEARCHES = 3;
  try {
    for (let depth = 0; depth <= MAX_SEARCHES; depth++) {
      const acc = await streamOnce(conv);
      const marker = acc.match(SEARCH_MARKER_RE);

      // Ostatnia runda: model nadal chce szukać, ale limit wyczerpany. Zamiast
      // pokazać użytkownikowi surowe [SZUKAJ: …] — a tak działo się wcześniej —
      // każemy mu odpowiedzieć tym, co już zebrał.
      if (marker && depth === MAX_SEARCHES) {
        conv.messages.push({ role: 'user', content: t('search.enough'), search: true,
          searchQuery: marker[1].trim() });
        saveConversations();
        renderMessages();
        const last = await streamOnce(conv);
        finalText = stripSearchMarker(last) || lastReasoning || t('emptyReply');
        conv.messages.push({ role: 'assistant', content: finalText, think: lastThink, note: lastModelNote });
        saveConversations();
        break;
      }

      if (marker && depth < MAX_SEARCHES) {
        const q = marker[1].trim();
        const before = acc.replace(marker[0], '').trim();
        conv.messages.push({
          role: 'assistant',
          content: (before ? before + '\n\n' : '') + t('chat.searching', { q }),
        });
        saveConversations();
        renderMessages();
        if (voiceMode) {
          setVoiceState('speaking');
          await speakText(t('voice.searching'));
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
          content: (before ? before + '\n\n' : '') + t('chat.genImage'),
        });
        saveConversations();
        renderMessages();
        if (voiceMode) {
          setVoiceState('speaking');
          await speakText(t('voice.generatingImage'));
          setVoiceState('thinking');
        }
        try {
          const r = await fetch('/api/studio/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
          });
          const d = await readJsonSafe(r);
          if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
          conv.messages.push({
            role: 'assistant',
            content: { text: t('chat.imageSaved'), images: [d.url] },
          });
          finalText = t('chat.imageDone');
        } catch (err) {
          conv.messages.push({
            role: 'assistant',
            content: t('chat.imageErr', { msg: err.message }),
            error: true,
          });
          if (voiceMode) finalText = t('chat.imageErrVoice');
        }
        saveConversations();
        break;
      }

      // Pusta treść przy modelu rozumującym znaczy zwykle „budżet tokenów poszedł
      // na myślenie” — wtedy tok myślenia jest jedyną odpowiedzią, jaką mamy.
      finalText = stripSearchMarker(acc) || lastReasoning || t('emptyReply');
      const actMarker = finalText.match(ACTION_RE);
      if (actMarker) {
        const shown = finalText.replace(actMarker[0], '').trim();
        conv.messages.push({ role: 'assistant', content: shown || '…', think: lastThink, note: lastModelNote });
        conv.messages.push({ role: 'action', actionType: actMarker[1].trim().toLowerCase(), actionText: actMarker[2].trim() });
        finalText = shown;
      } else {
        conv.messages.push({ role: 'assistant', content: finalText, think: lastThink, note: lastModelNote });
      }
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
      if (voiceMode) finalText = t('voice.errReply');
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

/** Pokaż „dopracuj prompt", gdy jest co dopracowywać.
 *
 * Przy krótkich wiadomościach („dzięki", „tak") przepisywanie nie ma sensu,
 * a przycisk tylko zaśmieca pole — stąd próg długości.
 */
function updatePolishButton() {
  const btn = $('polish-btn');
  if (!btn) return;
  btn.hidden = el.input.value.trim().length < 25 || isGenerating;
}

/** Przepisz treść pola na precyzyjny prompt, z możliwością cofnięcia. */
let polishPrevious = '';
async function polishPrompt() {
  const btn = $('polish-btn');
  const raw = el.input.value.trim();
  if (!raw || btn.disabled) return;

  // Drugie kliknięcie po dopracowaniu przywraca oryginał — nikt nie chce
  // stracić własnych słów przez jedno kliknięcie.
  if (polishPrevious && raw !== polishPrevious) {
    el.input.value = polishPrevious;
    polishPrevious = '';
    btn.title = t('polish.btn');
    autosizeInput(); updateSendButton();
    return;
  }

  btn.disabled = true;
  const before = el.input.placeholder;
  el.input.placeholder = t('polish.working');
  try {
    const res = await fetch('/api/polish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cosmos-Lang': getLang() },
      body: JSON.stringify({ text: raw, endpoint, model: currentModel() || undefined }),
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
    polishPrevious = raw;
    el.input.value = data.text;
    btn.title = t('polish.undo');
    autosizeInput(); updateSendButton();
  } catch (err) {
    alert(t('polish.err') + ' ' + err.message);
  } finally {
    btn.disabled = false;
    el.input.placeholder = before;
    el.input.focus();
  }
}

function updateSendButton() {
  const empty = el.input.value.trim() === '' && pendingImages.length === 0;
  el.sendBtn.disabled = empty || isGenerating || !serverReachable;
  updatePolishButton();
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
  updateTokenEstimate();
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
    btn.innerHTML = t('copied');
    setTimeout(() => { btn.innerHTML = prev; }, 1500);
  });
});

// podpowiedzi na ekranie startowym
document.querySelectorAll('.suggestion').forEach((btn) => {
  btn.addEventListener('click', () => {
    el.input.value = t(btn.dataset.promptKey);
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
/** Odczytaj odpowiedź jako JSON, nie wywracając się na tym, co JSON-em nie jest.
 *
 * Gdy usługa zmysłów rzuci wyjątkiem, serwer potrafi oddać zwykły tekst
 * „Internal Server Error”. `res.json()` mówił wtedy „Unexpected token 'I' …
 * is not valid JSON” — komunikat, z którego użytkownik nie dowiaduje się
 * niczego o prawdziwej przyczynie. Tutaj oddajemy treść odpowiedzi.
 */
async function readJsonSafe(res) {
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    const short = body.trim().slice(0, 200) || `HTTP ${res.status}`;
    return { error: `HTTP ${res.status} — ${short}` };
  }
}

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
    const langPrefix = t('speechLang').slice(0, 2);
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith(langPrefix));
    speakSerial = {};                 // znacznik tej wypowiedzi
    const mine = speakSerial;
    for (const part of splitForSpeech(clean)) {
      if (speakSerial !== mine) return;   // ktoś przerwał albo zaczął nową
      await new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(part);
        u.lang = t('speechLang');
        if (voice) u.voice = voice;
        u.onend = resolve;
        u.onerror = resolve;
        speechSynthesis.speak(u);
      });
    }
  }
}

// Znacznik trwającej wypowiedzi — po przerwaniu kolejne kawałki mają nie ruszyć.
let speakSerial = null;

/** Potnij tekst na kawałki mieszczące się w jednej wypowiedzi.
 *
 * Chrome przerywa `speechSynthesis` po kilkunastu sekundach i reszta zdania
 * przepada — dlatego czytanie na głos urywało się w połowie. Tniemy po
 * granicach zdań, a bardzo długie zdania po przecinkach i spacjach, żeby nigdy
 * nie rozerwać słowa.
 */
function splitForSpeech(text, max = 180) {
  const out = [];
  // podział po końcach zdań, z zachowaniem znaku interpunkcyjnego
  for (let piece of String(text).split(/(?<=[.!?…])\s+|\n+/)) {
    piece = piece.trim();
    if (!piece) continue;
    while (piece.length > max) {
      const window = piece.slice(0, max);
      // najpierw przecinek, potem ostatnia spacja, w ostateczności twarde cięcie
      let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '));
      if (cut < max * 0.5) cut = window.lastIndexOf(' ');
      if (cut <= 0) cut = max;
      out.push(piece.slice(0, cut + 1).trim());
      piece = piece.slice(cut + 1).trim();
    }
    if (piece) out.push(piece);
  }
  return out.length ? out : [String(text)];
}

function stopSpeaking() {
  speakSerial = null;                 // zatrzymaj kolejne kawałki wypowiedzi
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

// ----------------------------------------------------------------
// Kamera i mikrofon: wymóg bezpiecznego kontekstu
// ----------------------------------------------------------------
//
// Przeglądarki udostępniają navigator.mediaDevices TYLKO w „bezpiecznym
// kontekście": po HTTPS albo na localhost. Przy wejściu po zwykłym HTTP na
// adres IP (typowe dla serwera na VPS w sieci Tailscale) całe API jest
// `undefined` — nie zablokowane, tylko nieobecne. Bez tego sprawdzenia
// użytkownik dostaje „Cannot read properties of undefined", co niczego
// nie tłumaczy.

function mediaApiAvailable() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/** Pobierz strumień albo rzuć wyjątkiem z czytelnym powodem. */
async function getMedia(constraints) {
  if (!mediaApiAvailable()) {
    throw new Error(window.isSecureContext ? t('media.noApi') : t('media.insecure'));
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

function setRecordingUI(on) {
  isRecording = on;
  el.micBtn.classList.toggle('recording', on);
  el.micBtn.title = on ? t('stopRecording') : t('speak');
}

/** Ograniczenia audio z uwzględnieniem wybranego mikrofonu.
 *
 * Domyślny mikrofon systemu rzadko jest tym, którego chcemy: przy Kinekcie
 * to zwykle wbudowany mikrofon laptopa, a przy słuchawkach — dopiero co
 * podłączone urządzenie. Wybór zapamiętujemy, bo zmienia się rzadko.
 */
function audioConstraints() {
  const id = localStorage.getItem('cosmos.micId') || '';
  return id ? { audio: { deviceId: { exact: id } } } : { audio: true };
}

async function startWhisperRecording() {
  let stream;
  try {
    stream = await getMedia(audioConstraints());
  } catch (err) {
    // Zapamiętany mikrofon mógł zostać odłączony — spróbuj domyślnego.
    if (localStorage.getItem('cosmos.micId')) {
      localStorage.removeItem('cosmos.micId');
      stream = await getMedia({ audio: true });
    } else {
      throw err;
    }
  }
  const chunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    setRecordingUI(false);
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    el.input.placeholder = t('chat.dictating');
    try {
      const res = await fetch('/api/stt', {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob,
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.text) {
        el.input.value = (el.input.value ? el.input.value + ' ' : '') + data.text;
        autosizeInput();
        updateSendButton();
      }
    } catch (err) {
      alert(t('chat.sttErr', { msg: err.message }));
    } finally {
      el.input.placeholder = t('inputPh');
      el.input.focus();
    }
  };
  mediaRecorder.start();
  setRecordingUI(true);
}

function startBrowserRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert(t('dictNoStt'));
    return;
  }
  // Chrome kończy sesję rozpoznawania sam — po pauzie w mówieniu i najpóźniej
  // po ~60 s — mimo `continuous = true`. Wcześniej gasiliśmy wtedy nagrywanie
  // i dyktowanie urywało się w połowie zdania. Teraz wznawiamy je tak długo,
  // aż użytkownik sam kliknie „stop”.
  dictationWanted = true;

  const makeRec = () => {
    const rec = new SR();
    rec.lang = t('speechLang');
    rec.interimResults = true;      // widać, że słucha, zanim padnie wynik
    rec.continuous = true;

    rec.onresult = (e) => {
      let finalText = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalText.trim()) {
        el.input.value = (el.input.value ? el.input.value + ' ' : '') + finalText.trim();
        autosizeInput();
        updateSendButton();
      }
      el.input.placeholder = interim.trim() || t('chat.listening');
    };

    rec.onend = () => {
      if (!dictationWanted) { setRecordingUI(false); el.input.placeholder = t('inputPh'); return; }
      // krótka przerwa, bo natychmiastowy start bywa odrzucany
      setTimeout(() => {
        if (!dictationWanted) return;
        try { speechRec = makeRec(); speechRec.start(); } catch { /* już wystartował */ }
      }, 250);
    };

    // „no-speech" i „aborted" to normalny koniec cyklu — onend wznowi nasłuch.
    // Realny błąd (brak zgody, brak sieci) kończy dyktowanie.
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      dictationWanted = false;
      setRecordingUI(false);
      el.input.placeholder = t('inputPh');
      if (e.error !== 'not-allowed') return;
      alert(t('dictDenied'));
    };
    return rec;
  };

  speechRec = makeRec();
  speechRec.start();
  setRecordingUI(true);
  el.input.placeholder = t('chat.listening');
}

// Czy użytkownik nadal chce dyktować (a nie: czy przeglądarka akurat słucha).
let dictationWanted = false;

el.micBtn.addEventListener('click', async () => {
  if (isRecording) {
    dictationWanted = false;          // dopiero to kończy nasłuch na dobre
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop();
    if (speechRec) { speechRec.stop(); speechRec = null; }
    setRecordingUI(false);
    el.input.placeholder = t('inputPh');
    return;
  }
  stopSpeaking();
  if (senses.online && senses.caps.whisper) {
    try {
      await startWhisperRecording();
    } catch (err) {
      alert(t('kb.micErr') + ' ' + err.message);
    }
  } else {
    startBrowserRecognition();
  }
});

// ----------------------------------------------------------------
// Zmysły: wzrok — zdjęcie z kamery (webcam / Kinect RGB)
// ----------------------------------------------------------------

/** Która kamera telefonu: „user" = przednia, „environment" = tylna.
 *  Zapamiętana, bo do fotografowania sprzętu prawie zawsze chce się tylna. */
let cameraFacing = localStorage.getItem('cosmos.cameraFacing') || 'environment';

function videoConstraints(facing) {
  // `ideal`, nie `exact` — na laptopie z jedną kamerą `exact` po prostu rzuca
  // błędem, a przy pierwszym otwarciu chcemy dostać tę jedyną, jaka jest.
  return { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: facing } } };
}

/** Weź strumień z konkretnego obiektywu — do PRZEŁĄCZANIA, nie do otwierania.
 *
 * Przy `ideal` przeglądarka ma prawo prośbę zignorować i oddać kamerę, która
 * już działa — i właśnie dlatego przełącznik przód/tył nic nie robił. Do zmiany
 * obiektywu trzeba `exact`. Gdyby telefon nie znał `facingMode` (zdarza się przy
 * kamerach zewnętrznych i na desktopie), wybieramy kolejne urządzenie z listy.
 */
async function getMediaFacing(facing) {
  try {
    return await getMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 },
      facingMode: { exact: facing } } });
  } catch (err) {
    if (err && err.name === 'NotAllowedError') throw err;
    const devs = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'videoinput');
    if (devs.length < 2) throw err;
    // po etykiecie, a gdy jej brak (bez zgody) — po prostu następne urządzenie
    const wantBack = facing === 'environment';
    const byLabel = devs.find((d) => {
      const l = (d.label || '').toLowerCase();
      return wantBack ? /back|rear|tyl|tył|environment/.test(l)
                      : /front|przod|przód|user|face/.test(l);
    });
    const pick = byLabel || devs[(devs.findIndex((d) => d.deviceId === currentCameraId) + 1) % devs.length];
    currentCameraId = pick.deviceId;
    return await getMedia({ video: { deviceId: { exact: pick.deviceId },
      width: { ideal: 1280 }, height: { ideal: 720 } } });
  }
}

let currentCameraId = '';

/** Czy urządzenie ma więcej niż jedną kamerę — tylko wtedy przełącznik ma sens. */
async function hasMultipleCameras() {
  if (!mediaApiAvailable() || !navigator.mediaDevices.enumerateDevices) return false;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'videoinput').length > 1;
  } catch { return false; }
}

async function openCamera() {
  try {
    cameraStream = await getMedia(videoConstraints(cameraFacing));
  } catch (err) {
    alert(`${t('cam.err')} ${err.message}`);
    return;
  }
  el.cameraVideo.srcObject = cameraStream;
  el.cameraModal.style.display = '';
  $('camera-flip').hidden = !(await hasMultipleCameras());
}

/** Przełącz przód/tył bez zamykania okna. */
/** Przełącz obiektyw. NAJPIERW zwolnij stary strumień.
 *
 * Telefon obsługuje jeden obiektyw naraz. Próba otwarcia drugiego, gdy pierwszy
 * jeszcze pracuje, kończy się „Could not start video source" — i dokładnie
 * dlatego przełącznik nie działał. Kolejność jest więc odwrotna niż podpowiada
 * ostrożność: zamykamy, otwieramy, a gdy nowy obiektyw zawiedzie — wracamy do
 * poprzedniego, żeby nie zostawić czarnego okna.
 */
async function swapStream(current, next, apply) {
  const prev = cameraFacing;
  if (current) current.getTracks().forEach((tr) => tr.stop());
  try {
    const stream = await getMediaFacing(next);
    cameraFacing = next;
    localStorage.setItem('cosmos.cameraFacing', next);
    apply(stream);
    return { ok: true, stream };
  } catch (err) {
    try {                                   // odzyskaj poprzedni widok
      const back = await getMediaFacing(prev);
      apply(back);
      return { ok: false, stream: back, error: err };
    } catch {
      apply(null);
      return { ok: false, stream: null, error: err };
    }
  }
}

async function flipCamera() {
  const next = cameraFacing === 'environment' ? 'user' : 'environment';
  const r = await swapStream(cameraStream, next, (s) => {
    cameraStream = s;
    el.cameraVideo.srcObject = s;
  });
  if (!r.ok) alert(`${t('cam.flipErr')} ${r.error.message}`);
}

function closeCamera() {
  el.cameraModal.style.display = 'none';
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  el.cameraVideo.srcObject = null;
}

$('img-viewer-close').addEventListener('click', closeImageViewer);
$('img-viewer-download').addEventListener('click', downloadViewedImage);
// kliknięcie w tło zamyka; kliknięcie w sam obraz albo pasek — nie
$('img-viewer').addEventListener('click', (e) => {
  if (e.target === $('img-viewer')) closeImageViewer();
});

el.cameraBtn.addEventListener('click', openCamera);
$('camera-flip').addEventListener('click', flipCamera);
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
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  if (pendingImages.length < 4) {
    pendingImages.push(dataUrl);
    renderAttachments();
    updateSendButton();
  }
  // Zdjęcie trafia też do bazy wiedzy, czyli do Galerii. Wcześniej żyło
  // wyłącznie jako załącznik rozmowy: po wysłaniu nie dało się do niego wrócić
  // ani go pobrać, a w Galerii nie było go w ogóle.
  saveShotToGallery(dataUrl);
  closeCamera();
  el.input.focus();
});

/** Zapisz zdjęcie w bazie wiedzy (widoczne w Galerii). Po cichu, w tle. */
async function saveShotToGallery(dataUrl) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  try {
    await fetch('/api/kb/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `zdjecie-${stamp}.jpg`,
        mime: 'image/jpeg',
        data: dataUrl.split(',')[1],
      }),
    });
  } catch { /* brak sieci — zdjęcie i tak jest w rozmowie */ }
}

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

$('studio-image-go').addEventListener('click', async () => {
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
    const d = await readJsonSafe(res);
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    const imgs = (d.items || [{ item: d.item, url: d.url }])
      .map((r) => `<img src="${escapeHtml(r.url)}" alt="wygenerowany obraz">`).join('');
    studioOut('image', imgs + studioNote(d.item, d.exported));
  } catch (err) {
    studioOut('image', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
  }
});

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
$('studio-sb-go').addEventListener('click', async () => {
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
    const d = await readJsonSafe(res);
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    studioOut('sb', d.frames.map((f) =>
      `<div class="sb-frame"><span class="sb-num">${f.shot}</span><img src="${escapeHtml(f.url)}" title="${escapeHtml(f.prompt)}"></div>`).join(''));
  } catch (err) {
    studioOut('sb', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
  }
});

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
$('studio-edit-go').addEventListener('click', async () => {
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
    const d = await readJsonSafe(res);
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    studioOut('edit', `<img src="${escapeHtml(d.url)}">` + studioNote(d.item, d.exported));
  } catch (err) {
    studioOut('edit', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
  }
});

// ----------------------------------------------------------------
// KAMERA NA ŻYWO — podgląd + detekcja YOLO + zdarzenia percepcji
// ----------------------------------------------------------------

let liveStream = null;
let liveTimer = null;
let livePrevObjects = '';
let liveLastObjects = [];
let liveLastAutoSnap = 0;

function updateLiveRec() {
  const rec = $('live-rec');
  if (rec) rec.style.display = (liveStream && settings.timeMachine) ? '' : 'none';
}

async function captureTimelineSnapshot() {
  const video = $('live-video');
  if (!video.videoWidth) return false;
  const cap = document.createElement('canvas');
  const scale = Math.min(1, 800 / video.videoWidth);
  cap.width = Math.round(video.videoWidth * scale);
  cap.height = Math.round(video.videoHeight * scale);
  cap.getContext('2d').drawImage(video, 0, 0, cap.width, cap.height);
  try {
    await fetch('/api/timeline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: cap.toDataURL('image/jpeg', 0.7), objects: [...new Set(liveLastObjects)] }),
    });
    return true;
  } catch { return false; }
}

function posLabel(cx, w) {
  const r = cx / w;
  return r < 0.34 ? t('posLeft') : r > 0.66 ? t('posRight') : t('posCenter');
}

// Kinect nie jest kamerą UVC, więc przeglądarka go nie widzi i getUserMedia
// nigdy go nie zwróci. Jego klatki pobieramy po HTTP z usługi zmysłów
// i pokazujemy w zwykłym <img> zamiast w <video>.
let liveSource = localStorage.getItem('cosmos.liveSource') || 'camera';
let liveImgTimer = null;

function liveIsKinect() { return liveSource.startsWith('kinect'); }

/** Element, z którego bierzemy piksele: <video> dla kamery, <img> dla Kinecta. */
function liveMedia() { return liveIsKinect() ? $('live-image') : $('live-video'); }

function liveMediaSize() {
  const el = liveMedia();
  return liveIsKinect()
    ? { w: el.naturalWidth, h: el.naturalHeight }
    : { w: el.videoWidth, h: el.videoHeight };
}

let liveStreaming = false;
const liveFps = 15;

function stopKinectStream() {
  liveStreaming = false;
  clearTimeout(liveImgTimer);
  liveImgTimer = null;
  const img = $('live-image');
  img.onload = img.onerror = null;
  img.removeAttribute('src');
}

/** Podłącz strumień MJPEG z Kinecta.
 *
 * Jedno połączenie zamiast żądania na klatkę. Przy drodze telefon → VPS →
 * Tailscale → komputer domowy sam obieg zjadał ćwierć sekundy, co dawało
 * 3–4 klatki na sekundę niezależnie od czujnika. W strumieniu klatki lecą
 * jedna za drugą, a przeglądarka odtwarza `multipart/x-mixed-replace`
 * natywnie w zwykłym <img>.
 *
 * Gdyby strumień padł (np. stara wersja usługi zmysłów), wracamy do
 * pojedynczych klatek — wolniej, ale działa.
 */
function startKinectStream() {
  const stream = liveSource === 'kinect-depth' ? 'depth' : 'color';
  const img = $('live-image');
  liveStreaming = true;
  let fellBack = false;

  const singleFrames = () => {
    fellBack = true;
    const next = (delay) => {
      if (!liveStreaming) return;
      liveImgTimer = setTimeout(() => {
        if (liveStreaming) img.src = `/api/kinect/frame?stream=${stream}&t=${Date.now()}`;
      }, delay);
    };
    img.onload = () => next(120);
    img.onerror = () => { $('live-status').textContent = t('live.kinectErr'); next(2000); };
    img.src = `/api/kinect/frame?stream=${stream}&t=${Date.now()}`;
  };

  img.onload = null;
  img.onerror = () => { if (!fellBack) singleFrames(); };
  img.src = `/api/kinect/stream?stream=${stream}&fps=${liveFps}&t=${Date.now()}`;
}

async function startLive() {
  $('live-source').value = liveSource;
  const video = $('live-video');
  const img = $('live-image');

  // Panel otwieramy ZAWSZE, zanim spróbujemy pobrać obraz. Inaczej przy
  // niedostępnej kamerze nie dałoby się dosięgnąć listy źródeł — a to właśnie
  // tam jest Kinect, który kamery przeglądarki w ogóle nie potrzebuje.
  $('live-panel').style.display = '';
  applyLiveExpanded();
  updateLiveRec();

  if (liveIsKinect()) {
    video.hidden = true;
    img.hidden = false;
    startKinectStream();
  } else {
    try {
      liveStream = await getMedia(videoConstraints(cameraFacing));
    } catch (err) {
      img.hidden = true;
      video.hidden = false;
      $('live-status').textContent = `${t('cam.err')} ${err.message}`;
      return;                       // panel zostaje otwarty — można zmienić źródło
    }
    img.hidden = true;
    video.hidden = false;
    video.srcObject = liveStream;
    await video.play().catch(() => {});
  }
  // Przełącznik przód/tył tylko przy kamerze przeglądarki i tylko wtedy,
  // gdy jest co przełączać. Kinect ma jeden obiektyw.
  $('live-flip').hidden = liveIsKinect() || !(await hasMultipleCameras());

  $('live-status').textContent = senses.online && senses.caps.yolo ? '…' : t('liveNoSenses');
  liveTimer = setInterval(liveDetect, 3000);
  setTimeout(liveDetect, 800);
}

function stopLive() {
  clearInterval(liveTimer); liveTimer = null;
  stopKinectStream();
  if (liveStream) { liveStream.getTracks().forEach((t) => t.stop()); liveStream = null; }
  $('live-video').srcObject = null;
  $('live-panel').style.display = 'none';
  livePrevObjects = '';
}

async function liveDetect() {
  const media = liveMedia();
  const { w, h } = liveMediaSize();
  if (!w || !h) return;
  const overlay = $('live-overlay');
  overlay.width = w;
  overlay.height = h;
  const octx = overlay.getContext('2d');
  octx.clearRect(0, 0, overlay.width, overlay.height);

  if (!(senses.online && senses.caps.yolo)) return; // sam podgląd bez detekcji

  const cap = document.createElement('canvas');
  cap.width = w; cap.height = h;
  cap.getContext('2d').drawImage(media, 0, 0);
  let data;
  try {
    const res = await fetch('/api/detect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: cap.toDataURL('image/jpeg', 0.7) }),
    });
    data = await readJsonSafe(res);
    if (!res.ok) throw new Error(data.error || 'detect');
  } catch { return; }

  const objs = data.objects || [];
  liveLastObjects = objs.map((o) => o.label);
  octx.strokeStyle = '#9db9ff'; octx.lineWidth = Math.max(2, overlay.width / 300);
  octx.font = `${Math.max(14, overlay.width / 40)}px sans-serif`; octx.fillStyle = '#9db9ff';
  for (const o of objs) {
    const [x1, y1, x2, y2] = o.box;
    octx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    octx.fillText(o.label, x1 + 4, Math.max(14, y1 - 4));
  }
  $('live-status').textContent = objs.length
    ? objs.map((o) => `${o.label} (${posLabel((o.box[0] + o.box[2]) / 2, overlay.width)})`).join(', ')
    : t('liveNothing');

  // zdarzenie percepcji z pozycją — tylko gdy zestaw obiektów się zmienił
  const sig = objs.map((o) => o.label).sort().join(',');
  if (sig && sig !== livePrevObjects) {
    livePrevObjects = sig;
    const withPos = objs.map((o) => `${o.label} (${posLabel((o.box[0] + o.box[2]) / 2, overlay.width)})`).join(', ');
    fetch('/api/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'kamera', summary: `widzę w kadrze: ${withPos}` }),
    }).catch(() => {});

    // Nauka: czy w kadrze jest coś, co Cosmos już zna?
    fetch('/api/lessons/match', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: liveLastObjects.join(', '), objects: liveLastObjects }),
    }).then((r) => r.json()).then((d) => {
      const known = (d.matches || []).map((m) => m.label);
      if (known.length) {
        $('live-status').textContent += ` · ✦ ${known.join(', ')}`;
        fetch('/api/events', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'nauka', summary: `rozpoznaję (nauczone): ${known.join(', ')}` }),
        }).catch(() => {});
      }
    }).catch(() => {});

    // Digital Time Machine: automatyczny zapis migawki przy zmianie sceny (min. 30 s)
    if (settings.timeMachine && Date.now() - liveLastAutoSnap > 30000) {
      liveLastAutoSnap = Date.now();
      captureTimelineSnapshot();
    }
  }
}

// O tym, czy panel jest otwarty, decyduje jego widoczność — nie obecność
// strumienia. Przy źródle Kinect strumienia z kamery nie ma wcale.
$('live-btn').addEventListener('click', () => {
  const open = $('live-panel').style.display !== 'none';
  open ? stopLive() : startLive();
});
$('live-close').addEventListener('click', stopLive);

// Powiększenie zapamiętujemy — kto raz chce duży podgląd, zwykle chce go zawsze.
function applyLiveExpanded() {
  const on = localStorage.getItem('cosmos.liveExpanded') === '1';
  $('live-panel').classList.toggle('expanded', on);
  $('live-expand').title = t(on ? 'live.shrink' : 'live.expand');
}
$('live-flip').addEventListener('click', async () => {
  const next = cameraFacing === 'environment' ? 'user' : 'environment';
  const video = $('live-video');
  const r = await swapStream(liveStream, next, (s) => {
    liveStream = s;
    video.srcObject = s;
    if (s) video.play().catch(() => {});
  });
  $('live-status').textContent = r.ok ? '…' : `${t('cam.err')} ${r.error.message}`;
});
$('live-expand').addEventListener('click', () => {
  const on = $('live-panel').classList.contains('expanded');
  localStorage.setItem('cosmos.liveExpanded', on ? '0' : '1');
  applyLiveExpanded();
});
$('live-source').addEventListener('change', async (e) => {
  liveSource = e.target.value;
  localStorage.setItem('cosmos.liveSource', liveSource);
  // Przełączenie źródła to zamknięcie jednego strumienia i otwarcie drugiego —
  // inaczej kamera zostałaby zajęta albo Kinect odpytywany w tle.
  const wasOpen = $('live-panel').style.display !== 'none';
  stopLive();
  if (wasOpen) await startLive();
});

// ręczna migawka do osi czasu (Digital Time Machine)
$('live-snapshot').addEventListener('click', async () => {
  const btn = $('live-snapshot'); const prev = btn.textContent;
  btn.disabled = true;
  const ok = await captureTimelineSnapshot();
  btn.textContent = ok ? t('tm.saved') : prev;
  setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1400);
});

// ----------------------------------------------------------------
// OŚ CZASU — Digital Time Machine
// ----------------------------------------------------------------

async function openTimeline() {
  $('timeline-modal').style.display = '';
  const list = $('timeline-list');
  list.innerHTML = `<div class="tl-empty">${t('loading')}</div>`;
  let snaps = [];
  try { snaps = (await (await fetch('/api/timeline')).json()).snapshots || []; } catch { /* offline */ }
  if (!snaps.length) { list.innerHTML = `<div class="tl-empty">${t('tm.empty')}</div>`; return; }
  list.innerHTML = '';
  for (const s of snaps.slice().reverse()) {
    const row = document.createElement('div');
    row.className = 'tl-item';
    const when = new Date(s.time).toLocaleString(getLang());
    const change = [];
    if (s.appeared?.length) change.push(`<span class="app">+ ${t('tm.appeared')}: ${escapeHtml(s.appeared.join(', '))}</span>`);
    if (s.disappeared?.length) change.push(`<span class="dis">− ${t('tm.disappeared')}: ${escapeHtml(s.disappeared.join(', '))}</span>`);
    row.innerHTML =
      (s.imageId ? `<img src="/api/kb/raw?id=${encodeURIComponent(s.imageId)}" loading="lazy">` : '') +
      `<div class="tl-body"><span class="tl-time">${escapeHtml(when)}</span>` +
      `<span class="tl-objects">${s.objects?.length ? escapeHtml(s.objects.join(', ')) : '—'}</span>` +
      (change.length ? `<span class="tl-change">${change.join(' · ')}</span>` : '') + `</div>` +
      `<button class="tl-del" data-del="${escapeHtml(s.id)}">✕</button>`;
    list.appendChild(row);
  }
  list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await fetch(`/api/timeline?id=${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' });
    openTimeline();
  }));
}
$('timeline-btn').addEventListener('click', openTimeline);
$('timeline-close').addEventListener('click', () => { $('timeline-modal').style.display = 'none'; });
$('timeline-modal').addEventListener('click', (e) => { if (e.target === $('timeline-modal')) $('timeline-modal').style.display = 'none'; });

// ----------------------------------------------------------------
// GALERIA — przegląd wygenerowanych mediów (z bazy wiedzy)
// ----------------------------------------------------------------

let galleryFilter = 'all';

async function openGallery() {
  $('gallery-modal').style.display = '';
  await renderGallery();
}
function closeGallery() { $('gallery-modal').style.display = 'none'; }

async function renderGallery() {
  const grid = $('gallery-grid');
  grid.innerHTML = `<div class="gallery-empty">${t('loading')}</div>`;
  let items = [];
  try {
    const d = await (await fetch('/api/kb')).json();
    items = (d.items || []).filter((i) => /^(image|audio|video)\//.test(i.mime || ''));
  } catch { /* offline */ }

  const kind = (m) => (m || '').split('/')[0];
  const filtered = galleryFilter === 'all' ? items : items.filter((i) => kind(i.mime) === galleryFilter);
  filtered.sort((a, b) => b.time - a.time);

  if (!filtered.length) {
    grid.innerHTML = `<div class="gallery-empty">${t('gallery.empty')}</div>`;
    return;
  }
  grid.innerHTML = '';
  for (const it of filtered) {
    const k = kind(it.mime);
    const url = `/api/kb/raw?id=${encodeURIComponent(it.id)}`;
    const cell = document.createElement('div');
    cell.className = 'gallery-cell';
    let media;
    if (k === 'image') media = `<img src="${url}" loading="lazy" alt="${escapeHtml(it.name)}">`;
    else if (k === 'video') media = `<video src="${url}" controls preload="metadata"></video>`;
    else media = `<div class="gallery-audio">🎵</div><audio src="${url}" controls></audio>`;

    // Widać, który obraz jest w tej chwili pierwszą klatką — bez tego jedynym
    // potwierdzeniem był ✓ znikający po sekundzie.
    const isFrame = localStorage.getItem('cosmos.videoFrame') === it.id;
    const frameBtn = k === 'image'
      ? `<button data-frame="${escapeHtml(it.id)}" class="${isFrame ? 'frame-on' : ''}" `
        + `title="${isFrame ? t('gallery.frameIs') : t('gallery.useFrame')}">🎬</button>` : '';
    const upBtn = k === 'image'
      ? `<button data-up="${escapeHtml(it.id)}" title="${t('gallery.upscale')}">⤢</button>` : '';
    cell.innerHTML =
      media +
      `<div class="gallery-meta" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</div>` +
      `<div class="gallery-actions">` +
      `<a href="${url}" download="${escapeHtml(it.name)}" style="flex:1"><button style="width:100%">${t('gallery.download')}</button></a>` +
      frameBtn + upBtn +
      `<button class="danger" data-del="${escapeHtml(it.id)}">✕</button>` +
      `</div>`;
    grid.appendChild(cell);
  }

  grid.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await fetch(`/api/kb?id=${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' });
    renderGallery();
  }));
  grid.querySelectorAll('[data-frame]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('cosmos.videoFrame', b.dataset.frame);
    renderGallery();          // odśwież oznaczenia — widać, który obraz jest wybrany
    galleryNote(t('gallery.frameSet'));
  }));
  grid.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', async () => {
    const prev = b.textContent; b.textContent = '…'; b.disabled = true;
    try {
      const r = await fetch('/api/studio/upscale', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: b.dataset.up }),
      });
      const d = await readJsonSafe(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      renderGallery();
    } catch (err) {
      alert(err.message);
      b.textContent = prev; b.disabled = false;
    }
  }));
}

/** Krótki komunikat w nagłówku Galerii — potwierdzenie, które nie znika po chwili. */
function galleryNote(text) {
  const n = $('gallery-note');
  if (!n) return;
  n.textContent = text;
  n.hidden = false;
  clearTimeout(galleryNote._t);
  galleryNote._t = setTimeout(() => { n.hidden = true; }, 4000);
}

$('gallery-btn').addEventListener('click', openGallery);
$('gallery-close').addEventListener('click', closeGallery);
$('gallery-modal').addEventListener('click', (e) => { if (e.target === $('gallery-modal')) closeGallery(); });
$('gallery-filters').addEventListener('click', (e) => {
  const btn = e.target.closest('.gallery-filter');
  if (!btn) return;
  galleryFilter = btn.dataset.filter;
  $('gallery-filters').querySelectorAll('.gallery-filter').forEach((f) => f.classList.toggle('active', f === btn));
  renderGallery();
});

$('studio-speech-go').addEventListener('click', async () => {
  const text = $('studio-speech-text').value.trim();
  if (!text) return;
  studioOut('speech', `<span class="studio-note"><span class="studio-spinner"></span>${t('st.genSound')}</span>`);
  try {
    const res = await fetch('/api/studio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId: $('studio-speech-voice').value.trim() || undefined }),
    });
    const d = await readJsonSafe(res);
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    studioOut('speech', `<audio controls src="${escapeHtml(d.url)}"></audio>` + studioNote(d.item, d.exported));
  } catch (err) {
    studioOut('speech', `<span class="studio-error">✗ ${escapeHtml(err.message)}</span>`);
  }
});

$('studio-video-go').addEventListener('click', async () => {
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
      el.kbList.innerHTML = `<div class="kb-empty">${t('kb.empty')}</div>`;
      return;
    }
    for (const item of [...items].reverse()) {
      const row = document.createElement('div');
      row.className = 'kb-item';

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.title = t('kb.include');
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
      bits.push(new Date(item.time).toLocaleDateString(getLang()));
      bits.push(item.textChars ? `tekst: ${item.textChars} zn.` : 'bez tekstu');
      meta.textContent = bits.join(' · ');
      meta.title = item.preview || '';
      main.append(name, meta);

      const del = document.createElement('button');
      del.className = 'kb-item-del';
      del.textContent = '×';
      del.title = t('kb.remove');
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
    el.kbList.innerHTML = `<div class="kb-empty">${t('kb.loadErr')}</div>`;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
    reader.onerror = () => reject(new Error(t('fileReadErr')));
    reader.readAsDataURL(file);
  });
}

async function kbUploadFiles(files) {
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    if (file.size > KB_MAX_FILE) {
      alert(t('kb.tooBig', { name: file.name }));
      continue;
    }
    kbSetStatus(t('kb.processing', { i: i + 1, n: list.length, name: file.name }) +
      (/^(audio|video)/.test(file.type) ? t('kb.transcribing') : '…'));
    try {
      const res = await fetch('/api/kb/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, mime: file.type, data: await fileToBase64(file) }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (err) {
      alert(t('kb.addErr', { name: file.name }) + '\n' + err.message);
    }
  }
  kbSetStatus('');
  loadKbList();
}

async function kbAddLink() {
  const url = el.kbUrl.value.trim();
  if (!url) return;
  el.kbAddLink.disabled = true;
  kbSetStatus(t('kb.fetchingPage', { url }));
  try {
    const res = await fetch('/api/kb/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await readJsonSafe(res);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    el.kbUrl.value = '';
  } catch (err) {
    alert(t('kb.linkErr') + '\n' + err.message);
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
  el.kbRecordBtn.textContent = on ? t('kb.recordStop') : t('kb.record');
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
      const stream = await getMedia(audioConstraints());
      const chunks = [];
      kbRecorder = new MediaRecorder(stream);
      kbRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      kbRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setKbRecordingUI(false);
        kbSetStatus(t('kb.transcribingNote'));
        try {
          const blob = new Blob(chunks, { type: kbRecorder.mimeType || 'audio/webm' });
          const res = await fetch('/api/stt', {
            method: 'POST', headers: { 'Content-Type': blob.type }, body: blob,
          });
          const data = await readJsonSafe(res);
          if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
          if (data.text) await kbSaveNote(data.text);
          else alert(t('kb.noSpeech'));
        } catch (err) {
          alert(t('kb.transcribeErr') + '\n' + err.message);
        } finally {
          kbSetStatus('');
        }
      };
      kbRecorder.start();
      setKbRecordingUI(true);
      kbSetStatus(t('kb.recording'));
    } catch (err) {
      alert(t('kb.micErr') + ' ' + err.message);
    }
    return;
  }
  // wariant 2: dyktowanie przeglądarki (Chrome/Edge)
  const SR = getSR();
  if (!SR) {
    alert(t('kb.noStt'));
    return;
  }
  let acc = '';
  kbSpeechRec = new SR();
  kbSpeechRec.lang = t('speechLang');
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
const END_RE = /\b(koniec|zako[nń]cz|do widzenia|dobranoc|stop|end|goodbye|bye|that's all)\b/i;
const VISUAL_RE = /\b(co (mam|trzymam|widzisz|to jest)|jak wygl[ąa]da|sp[oó]jrz|popatrz|zobacz|przyjrzyj|w r[ęe]ku|w d[łl]oni|przed kamer[ąa]|na biurku|w kadrze|rozpoznaj)\b/i;

function getSR() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setVoiceState(state) {
  voiceState = state;
  el.voiceOrb.className = 'voice-orb ' + state;
  el.voiceStatus.textContent = {
    wake: t('voice.wake'),
    listening: t('voice.listening'),
    thinking: t('voice.thinking'),
    speaking: t('voice.speaking'),
  }[state] || '';
}

// Jeden kontekst audio na całą stronę. Tworzenie i zamykanie go przy każdym
// sygnale przełączało wyjście dźwięku w Androidzie — słychać to było jako
// ciągłe „podłączanie i odłączanie” sprzętu w trakcie nasłuchu.
let audioCtx = null;

function chime(freq = 880) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
  } catch { /* dźwięk to tylko ozdoba */ }
}

/** Zatrzymaj rozpoznawanie na dobre — tylko przy wyjściu z trybu głosowego. */
function stopVoiceRecognizers() {
  clearTimeout(voiceSilence);
  voiceHeard = '';
  voiceDeaf = false;
  if (voiceRec) {
    voiceRec.onend = null;          // bez tego wznowiłby się sam
    voiceRec.onresult = null;
    voiceRec.onerror = null;
    try { voiceRec.stop(); } catch { /* już zatrzymany */ }
    voiceRec = null;
  }
}

async function enterVoiceMode() {
  const SR = getSR();
  if (!SR) {
    alert(t('voice.noSupport'));
    return;
  }
  voiceMode = true;
  el.voiceOverlay.style.display = '';
  el.voiceTranscript.textContent = '';
  el.voiceAnswer.textContent = '';

  // UWAGA — nie wolno tu trzymać własnego strumienia z mikrofonu.
  // Próbowałem tak wyciszyć sygnały podłączania sprzętu na Androidzie, ale
  // rozpoznawanie mowy korzysta z tego samego mikrofonu na wyłączność: przy
  // zajętym wejściu przestawało cokolwiek słyszeć, łącznie z „Hej, Kosmos”.
  // Działające rozpoznawanie jest ważniejsze niż cichszy telefon.

  // Kamera NIE włącza się sama. Wcześniej tak było i na telefonie podgląd
  // zasłaniał pół ekranu przy każdym nasłuchu — a wizji potrzeba tylko przy
  // pytaniach w rodzaju „co trzymam w ręku”. Teraz to świadome kliknięcie.
  if (localStorage.getItem('cosmos.voiceCam') === '1') await startVoiceCamera();
  updateVoiceCamButton();

  startWakeListening();
}

async function startVoiceCamera() {
  if (voiceCameraStream) return true;
  try {
    voiceCameraStream = await getMedia(videoConstraints(cameraFacing));
  } catch {
    return false;                     // tryb głosowy działa też bez kamery
  }
  el.voiceCamera.srcObject = voiceCameraStream;
  el.voiceCameraWrap.style.display = '';
  return true;
}

function stopVoiceCamera() {
  if (voiceCameraStream) {
    voiceCameraStream.getTracks().forEach((tr) => tr.stop());
    voiceCameraStream = null;
  }
  el.voiceCamera.srcObject = null;
  el.voiceCameraWrap.style.display = 'none';
}

function updateVoiceCamButton() {
  const on = Boolean(voiceCameraStream);
  const btn = $('voice-cam-btn');
  btn.classList.toggle('active', on);
  btn.title = t(on ? 'voice.camOff' : 'voice.camOn');
}

$('voice-cam-btn').addEventListener('click', async () => {
  if (voiceCameraStream) {
    stopVoiceCamera();
    localStorage.setItem('cosmos.voiceCam', '0');
  } else {
    const ok = await startVoiceCamera();
    localStorage.setItem('cosmos.voiceCam', ok ? '1' : '0');
    if (!ok) $('voice-status').textContent = t('voice.camFail');
  }
  updateVoiceCamButton();
});

function exitVoiceMode() {
  voiceMode = false;
  voiceNoteMode = false;
  voiceNoteBuffer = [];
  stopVoiceRecognizers();
  stopSpeaking();
  el.voiceOverlay.style.display = 'none';
  stopVoiceCamera();
  setVoiceState('off');
}

/* JEDEN rozpoznawacz na całą sesję głosową.
 *
 * Wcześniej nasłuch słowa budzącego i nasłuch pytania to były dwa osobne
 * obiekty, tworzone i niszczone przy każdym przejściu stanu. Każde takie
 * przejęcie mikrofonu Android sygnalizuje dźwiękiem — stąd „ciągłe podłączanie
 * i odłączanie". Teraz rozpoznawacz żyje od wejścia w tryb głosowy do wyjścia,
 * a zmienia się tylko to, jak interpretujemy wynik. Mikrofon jest przejmowany
 * raz, nie przy każdym zdaniu.
 *
 * Gdy Cosmos myśli albo mówi, wyników nie czytamy (`voiceDeaf`) — inaczej
 * usłyszałby własny głos i odpowiadał sam sobie. Rozpoznawacz zostaje wtedy
 * uruchomiony, ale głuchy, bo zatrzymanie go zwolniłoby mikrofon i wróciłby
 * dźwięk przy ponownym starcie.
 */
let voiceRec = null;          // jedyny rozpoznawacz sesji
let voiceDeaf = false;        // ignoruj wyniki (Cosmos myśli albo mówi)
let voiceHeard = '';          // złożone zdanie w trybie pytania
let voiceSilence = null;      // odliczanie ciszy po pytaniu

function startVoiceRecognizer() {
  if (!voiceMode || voiceRec) return;
  const SR = getSR();
  if (!SR) return;

  const rec = new SR();
  voiceRec = rec;
  rec.lang = t('speechLang');
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (e) => {
    if (!voiceMode || voiceDeaf) return;

    if (voiceState === 'wake') {
      const latest = [...e.results].slice(-3).map((r) => r[0].transcript).join(' ');
      const match = latest.match(WAKE_RE);
      if (!match) return;
      const after = latest.slice(latest.search(WAKE_RE) + match[0].length).trim();
      chime(880);
      if (after.length > 5) { askVoice(after); return; }
      voiceHeard = '';
      setVoiceState('listening');
      el.voiceTranscript.textContent = '';
      return;
    }

    if (voiceState !== 'listening') return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) voiceHeard += r[0].transcript;
      else interim += r[0].transcript;
    }
    el.voiceTranscript.textContent = (voiceHeard + ' ' + interim).trim();

    // Rozpoznawacz jest ciągły, więc sam nie zasygnalizuje końca pytania.
    // Kończymy po chwili ciszy od ostatniego usłyszanego słowa.
    clearTimeout(voiceSilence);
    voiceSilence = setTimeout(() => {
      if (!voiceMode || voiceState !== 'listening') return;
      const text = voiceHeard.trim();
      voiceHeard = '';
      if (text) askVoice(text);
      else backToWake();
    }, 1400);
  };

  // Chrome i tak utnie sesję po ~60 s — wznawiamy ten sam obiekt.
  rec.onend = () => {
    voiceRec = null;
    if (!voiceMode) return;
    setTimeout(() => { if (voiceMode) startVoiceRecognizer(); }, 250);
  };
  rec.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      voiceRec = null;
      el.voiceTranscript.textContent = t('voice.micDenied');
      voiceMode = false;
      return;
    }
    /* „no-speech" i „aborted" to normalny bieg rzeczy — onend wznowi */
  };

  try { rec.start(); } catch { /* już wystartował */ }
}

function backToWake() {
  if (!voiceMode) return;
  clearTimeout(voiceSilence);
  voiceHeard = '';
  voiceDeaf = false;
  setVoiceState('wake');
  el.voiceTranscript.textContent = '';
  startVoiceRecognizer();
}

/** Zadaj pytanie, nie słuchając własnej odpowiedzi. */
function askVoice(text) {
  clearTimeout(voiceSilence);
  voiceDeaf = true;
  handleVoiceQuery(text);
}

// Nazwy używane w pozostałej części pliku — zostawiamy je jako cienkie przejścia,
// żeby nie rozsypać wywołań rozsianych po trybie głosowym.
function startWakeListening() { backToWake(); }
function startQueryListening() {
  if (!voiceMode) return;
  voiceHeard = '';
  voiceDeaf = false;
  setVoiceState('listening');
  el.voiceTranscript.textContent = '';
  startVoiceRecognizer();
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

const NOTE_START_RE = /\b(nowa notatka|nagraj notatk[ęe]|(zacznij|rozpocznij|start)\s+(nagrywanie|nagrywa[ćc]|notatk[ęe]|dyktowanie)|new note|start (a )?note|start recording)\b/i;
const NOTE_STOP_RE = /\b((koniec|zako[nń]cz|stop|zapisz)\s+(notatk[ęei]|nagrywani[ae]|dyktowani[ae])|(end|stop|save)\s+(note|recording))\b/i;

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
        await speakText(ok ? t('voice.noteSaved') : t('voice.noteSaveErr'));
      } else {
        await speakText(t('voice.noteEmpty'));
      }
      if (voiceMode) startQueryListening();
      return;
    }
    voiceNoteBuffer.push(text);
    el.voiceAnswer.textContent = t('voice.notePrefix') + voiceNoteBuffer.join(' ').slice(-300);
    chime(660);
    if (voiceMode) startQueryListening();
    return;
  }

  if (NOTE_START_RE.test(text)) {
    voiceNoteMode = true;
    voiceNoteBuffer = [];
    el.voiceAnswer.textContent = t('voice.noteStart');
    setVoiceState('speaking');
    await speakText(t('voice.noteStartSpoken'));
    if (voiceMode) startQueryListening();
    return;
  }

  if (END_RE.test(text) && text.length < 30) {
    setVoiceState('speaking');
    await speakText(t('voice.bye'));
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

// ----------------------------------------------------------------
// Escape zamyka wierzchnią warstwę
// ----------------------------------------------------------------

// Każda nakładka zamyka się swoją funkcją, bo część z nich musi jeszcze
// posprzątać: zwolnić kamerę, zatrzymać detekcję, zapisać stan.
// Kolejność od wierzchu: to, co otwiera się na innych, jest wyżej.
const overlays = [
  // podgląd obrazu jest na samym wierzchu — otwiera się z galerii i z rozmowy
  { id: 'img-viewer', close: closeImageViewer },
  { open: () => voiceMode, close: exitVoiceMode },
  { id: 'camera-modal', close: closeCamera },
  { id: 'live-panel', close: stopLive },
  { id: 'gallery-modal', close: closeGallery },
  { id: 'timeline-modal', close: () => { $('timeline-modal').style.display = 'none'; } },
  { id: 'learn-modal', close: closeLearn },
  { id: 'kb-modal', close: () => { el.kbModal.style.display = 'none'; } },
  { id: 'studio-modal', close: () => { el.studioModal.style.display = 'none'; } },
  { id: 'settings-modal', close: closeSettings },
];

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const top = overlays.find((o) => (o.open ? o.open() : $(o.id).style.display !== 'none'));
  if (!top) return;
  e.preventDefault();
  top.close();
});

// ----------------------------------------------------------------
// Sidebar / motyw / endpoint
// ----------------------------------------------------------------

el.newChatBtn.addEventListener('click', newConversation);
function closeSidebar() {
  el.sidebar.classList.add('collapsed');
  document.querySelector('.app').classList.add('sidebar-hidden');
}
el.collapseBtn.addEventListener('click', closeSidebar);
el.expandBtn.addEventListener('click', () => {
  el.sidebar.classList.remove('collapsed');
  document.querySelector('.app').classList.remove('sidebar-hidden');
});
// na telefonie panel przykrywa czat — dotknięcie przyciemnionego tła go zamyka
$('sidebar-scrim').addEventListener('click', closeSidebar);
$('offline-retry').addEventListener('click', retryConnection);
// powrót sieci (np. Wi-Fi/Tailscale) — sprawdź od razu, nie czekaj 30 s
window.addEventListener('online', retryConnection);

// wyszukiwarka rozmów — po tytule (natychmiast) i po treści (z serwera)
let convContentMatchIds = new Set();
let convSearchTimer = null;
$('conv-search').addEventListener('input', (e) => {
  convSearchQuery = e.target.value;
  renderSidebar();
  clearTimeout(convSearchTimer);
  const q = convSearchQuery.trim();
  if (q.length < 2) { convContentMatchIds = new Set(); return; }
  convSearchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/conversations/search?q=${encodeURIComponent(q)}`);
      const d = await res.json();
      convContentMatchIds = new Set((d.results || []).map((r) => r.id));
      renderSidebar();
    } catch { /* offline — zostaje filtr po tytule */ }
  }, 300);
});

// eksport aktywnej rozmowy do Markdown
function exportConversation() {
  const conv = activeConv();
  if (!conv || !conv.messages.length) return;
  const lines = [`# ${conv.title || 'Cosmos'}`, ''];
  for (const m of conv.messages) {
    if (m.error) continue;
    const who = m.role === 'user' ? t('exportYou') : 'Cosmos';
    if (m.search) continue;
    lines.push(`**${who}:**`, '', msgText(m), '');
    const imgs = msgImages(m);
    if (imgs.length) lines.push(`_(${imgs.length} × ${t('attachment')})_`, '');
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (conv.title || 'cosmos').replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40).replace(/^-|-$/g, '') || 'cosmos';
  a.href = url;
  a.download = `${safe}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('export-btn').addEventListener('click', exportConversation);

// streszczenie aktywnej rozmowy → dopisane jako wiadomość asystenta
$('summarize-btn').addEventListener('click', async () => {
  const conv = activeConv();
  if (!conv || !conv.messages.length || isGenerating) return;
  const text = conv.messages.filter((m) => !m.error && !m.search)
    .map((m) => `${m.role === 'user' ? t('exportYou') : 'Cosmos'}: ${msgText(m)}`).join('\n');
  const btn = $('summarize-btn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/summarize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, endpoint, model: currentModel() || undefined }),
    });
    const d = await readJsonSafe(res);
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    conv.messages.push({ role: 'assistant', content: `**${t('summarize')}:**\n\n${d.summary}` });
    saveConversations();
    renderMessages();
    if (settings.speak) speakText(d.summary);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
});

// szacunkowy licznik tokenów w kontekście (~znaki/4)
function updateTokenEstimate() {
  const conv = activeConv();
  let chars = el.input.value.length + (settings.systemPrompt || '').length;
  if (conv) for (const m of conv.messages) chars += msgText(m).length;
  const est = Math.round(chars / 4);
  const node = $('token-estimate');
  if (node) node.textContent = est > 0 ? t('tokensCtx', { n: est }) : '';
}

// skróty klawiszowe
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') {           // Ctrl/Cmd+K — szukaj rozmów
    e.preventDefault();
    if (el.sidebar.classList.contains('collapsed')) el.expandBtn.click();
    $('conv-search').focus();
    $('conv-search').select();
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { // Ctrl/Cmd+Shift+O — nowa rozmowa
    e.preventDefault();
    newConversation();
  }
});

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEYS.theme, theme);
  const dark = theme === 'dark';
  el.themeIconDark.style.display = dark ? 'none' : '';
  el.themeIconLight.style.display = dark ? '' : 'none';
  el.themeLabel.textContent = dark ? t('themeLight') : t('themeDark');
  document.querySelector('meta[name="theme-color"]')
    .setAttribute('content', dark ? '#05060a' : '#fbfbfd');
}

el.themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || 'dark');

// przełącznik języka (PL ↔ EN)
el.langBtn = $('lang-btn');
el.langBtn.addEventListener('click', () => {
  setLang(getLang() === 'pl' ? 'en' : 'pl');
  // odśwież teksty budowane dynamicznie w JS
  applyTheme(document.documentElement.dataset.theme || 'dark');
  buildEndpointTabs();
  updateModelBadge();
  renderSidebar();
  renderMessages();
  refreshStatus();
});

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
    const label = key === 'cloud' ? t('tabCloud') : key === 'local' ? t('tabLocal') : ENDPOINT_TABS[key][0];
    btn.innerHTML = ENDPOINT_TABS[key][1] + label;
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
  refreshModelInfoBoxes();
  loadMicList();
  renderConfigInfo();
  loadMemoryList();
  fetch('/api/profile').then((r) => r.json()).then((d) => { $('set-profile').value = d.profile || ''; }).catch(() => {});
  $('set-offline').checked = Boolean(settings.offline);
  $('set-timemachine').checked = Boolean(settings.timeMachine);
  loadStats();
  loadTrainStats();
  loadDevices();
  $('brief-auto').checked = Boolean(settings.briefAuto);
  $('brief-time').value = settings.briefTime || '08:00';
  el.settingsModal.style.display = '';
}

async function loadStats() {
  try {
    const s = await (await fetch('/api/admin/stats')).json();
    const mb = (s.kbBytes / 1024 / 1024).toFixed(1);
    $('stats-info').innerHTML =
      `${t('stats.conv')}: ${s.conversations} · ${t('stats.mem')}: ${s.memories} · ` +
      `${t('stats.kb')}: ${s.kbItems} (${mb} MB)`;
  } catch { $('stats-info').textContent = '—'; }
}

async function loadMemoryList() {
  el.memoryList.innerHTML = `<span class="memory-empty">${t('loading')}</span>`;
  try {
    const res = await fetch('/api/memory');
    const data = await res.json();
    const items = data.memories || [];
    el.memoryCount.textContent = items.length ? `(${items.length})` : '';
    if (!items.length) {
      el.memoryList.innerHTML = `<span class="memory-empty">${t('set.memoryEmpty')}</span>`;
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
      del.title = t('kb.remove');
      del.addEventListener('click', async () => {
        await fetch(`/api/memory?id=${encodeURIComponent(m.id)}`, { method: 'DELETE' });
        loadMemoryList();
      });
      row.append(txt, del);
      el.memoryList.appendChild(row);
    }
  } catch {
    el.memoryList.innerHTML = `<span class="memory-empty">${t('set.memoryLoadErr')}</span>`;
  }
}

function closeSettings() {
  el.settingsModal.style.display = 'none';
}

function renderConfigInfo() {
  const c = epConfig('cloud');
  const l = epConfig('local');
  el.configInfo.innerHTML =
    `<strong>${t('set.cfgTitle')}</strong><br>` +
    `${t('cfg.cloud')}  ${escapeHtml(c.baseUrl || '—')}<br>` +
    `  ${t('cfg.model')} ${escapeHtml(c.model || '—')}${c.visionModel ? ` · ${t('cfg.vision')} ${escapeHtml(c.visionModel)}` : ''}<br>` +
    `  ${t('cfg.apiKey')} ${c.hasApiKey ? t('set.cfgKeySet') : t('set.cfgKeyMissing')}<br>` +
    `${t('cfg.local')}  ${escapeHtml(l.baseUrl || '—')}<br>` +
    `  ${t('cfg.model')} ${escapeHtml(l.model || t('set.cfgModelMissing'))}`;
}

el.settingsBtn.addEventListener('click', openSettings);
el.settingsClose.addEventListener('click', closeSettings);
el.settingsModal.addEventListener('click', (e) => {
  if (e.target === el.settingsModal) closeSettings();
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
  settings.offline = $('set-offline').checked;
  settings.timeMachine = $('set-timemachine').checked;
  saveSettings();
  updateLiveRec();
  // profil zapisywany na serwerze (wspólny dla urządzeń)
  fetch('/api/profile', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: $('set-profile').value }),
  }).catch(() => {});
  updateModelBadge();
  closeSettings();
});

// kopia zapasowa — pobieranie i przywracanie
$('backup-download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = '/api/backup';
  a.download = `cosmos-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});
// ---------------- Urządzenia (smart home) ----------------
async function loadDevices() {
  try {
    const { devices } = await (await fetch('/api/devices')).json();
    const box = $('dev-list');
    if (!devices.length) { box.innerHTML = `<div class="field-hint">${t('dev.empty')}</div>`; return; }
    box.innerHTML = devices.map((d) =>
      `<div class="learn-item" data-id="${d.id}">` +
      `<div class="learn-item-main"><strong>${escapeHtml(d.name)}</strong>` +
      `<span class="learn-item-meta mono">${d.method} ${escapeHtml(d.url)}</span></div>` +
      `<button class="btn-ghost dev-test">${t('dev.test')}</button>` +
      `<button class="icon-btn dev-del" title="✕">✕</button></div>`).join('');
    box.querySelectorAll('.learn-item').forEach((item) => {
      const id = item.dataset.id;
      item.querySelector('.dev-test').addEventListener('click', async () => {
        $('dev-status').textContent = t('dev.testing');
        try {
          const r = await fetch('/api/devices/run', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
          });
          const d = await r.json();
          $('dev-status').textContent = d.ok ? t('dev.ok') : t('dev.err', { e: d.reason || d.error || r.status });
        } catch { $('dev-status').textContent = t('dev.err', { e: '?' }); }
      });
      item.querySelector('.dev-del').addEventListener('click', async () => {
        await fetch('/api/devices?id=' + id, { method: 'DELETE' });
        loadDevices();
      });
    });
  } catch { /* offline */ }
}
$('dev-add').addEventListener('click', async () => {
  const name = $('dev-name').value.trim();
  const url = $('dev-url').value.trim();
  if (!name || !url) { $('dev-status').textContent = t('dev.need'); return; }
  try {
    const r = await fetch('/api/devices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url, method: $('dev-method').value, body: $('dev-body').value.trim() }),
    });
    const d = await readJsonSafe(r);
    if (!r.ok) { $('dev-status').textContent = d.error || t('dev.need'); return; }
    $('dev-name').value = ''; $('dev-url').value = ''; $('dev-body').value = '';
    $('dev-status').textContent = t('dev.added');
    loadDevices();
  } catch { $('dev-status').textContent = t('dev.err', { e: '?' }); }
});

// ---------------- Poranna odprawa ----------------
async function runBriefing(speak) {
  const out = $('brief-out');
  out.style.display = ''; out.textContent = t('brief.loading');
  try {
    const r = await fetch('/api/briefing', { headers: { 'X-Cosmos-Lang': getLang() } });
    const d = await r.json();
    out.textContent = d.text || t('brief.none');
    if (speak && d.text) speakText(d.text);
  } catch { out.textContent = t('brief.none'); }
}
$('brief-now').addEventListener('click', () => runBriefing(true));
$('brief-auto').addEventListener('change', (e) => {
  settings.briefAuto = e.target.checked; saveSettings();
});
$('brief-time').addEventListener('change', (e) => {
  settings.briefTime = e.target.value; saveSettings();
});
// sprawdzaj co minutę, czy nadeszła pora odprawy (gdy aplikacja jest otwarta)
let lastBriefDay = '';
setInterval(() => {
  if (!settings.briefAuto) return;
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const day = now.toDateString();
  if (hhmm === (settings.briefTime || '08:00') && lastBriefDay !== day) {
    lastBriefDay = day;
    runBriefing(true);
  }
}, 60000);

function downloadDataset(fmt) {
  const a = document.createElement('a');
  a.href = '/api/train/dataset?format=' + fmt;
  a.download = `cosmos-dataset-${fmt}-${new Date().toISOString().slice(0, 10)}.jsonl`;
  a.click();
}
$('train-export-chat').addEventListener('click', () => downloadDataset('chat'));
$('train-export-inst').addEventListener('click', () => downloadDataset('instruction'));
async function loadTrainStats() {
  try {
    const d = await (await fetch('/api/train/stats')).json();
    $('train-stats').textContent = t('train.count', { chat: d.chat, inst: d.instruction });
  } catch { /* offline */ }
  loadTrainEnv();
  refreshTrainStatus();
}
async function loadTrainEnv() {
  try {
    const e = await (await fetch('/api/train/env')).json();
    // pokaż sekcję „Dotrenuj" tylko, gdy da się to zrobić lokalnie (Python + skrypt)
    $('train-run').style.display = (e.python && e.script) ? '' : 'none';
    const parts = [];
    parts.push(`Python: ${e.python ? '✓' : '—'}`);
    parts.push(`Ollama: ${e.ollama ? '✓' : '—'}`);
    parts.push(t('train.envExamples', { n: e.examples }));
    if (!e.python) parts.push(t('train.needPython'));
    $('train-env').textContent = parts.join(' · ');
    $('train-start').disabled = !e.examples || e.busy;
  } catch { /* offline */ }
}
let trainPollTimer = null;
async function refreshTrainStatus() {
  try {
    const s = await (await fetch('/api/train/status')).json();
    const running = s.running;
    $('train-stop').style.display = running ? '' : 'none';
    $('train-start').style.display = running ? 'none' : '';
    const logEl = $('train-log');
    if (s.log && s.log.length) { logEl.style.display = ''; logEl.textContent = s.log.join('\n'); logEl.scrollTop = logEl.scrollHeight; }
    if (running && !trainPollTimer) {
      trainPollTimer = setInterval(refreshTrainStatus, 3000);
    } else if (!running && trainPollTimer) {
      clearInterval(trainPollTimer); trainPollTimer = null;
      loadTrainEnv(); loadTrainStats();
    }
  } catch { /* offline */ }
}
$('train-start').addEventListener('click', async () => {
  $('train-start').disabled = true;
  try {
    const r = await fetch('/api/train/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: $('train-model').value.trim(), ollamaName: $('train-ollama').value.trim() }),
    });
    const d = await readJsonSafe(r);
    if (!r.ok) { $('train-env').textContent = d.message || d.error || t('train.startErr'); $('train-start').disabled = false; return; }
    refreshTrainStatus();
  } catch { $('train-start').disabled = false; }
});
$('train-stop').addEventListener('click', async () => {
  await fetch('/api/train/stop', { method: 'POST' });
  refreshTrainStatus();
});
$('backup-restore-btn').addEventListener('click', () => $('backup-file').click());
$('backup-file').addEventListener('change', async () => {
  const file = $('backup-file').files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const res = await fetch('/api/backup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text,
    });
    const d = await readJsonSafe(res);
    if (!res.ok) throw new Error(d.error || '');
    alert(t('backupRestored', { n: d.restored }));
    await loadConversations();
    loadStats();
  } catch {
    alert(t('backupErr'));
  } finally {
    $('backup-file').value = '';
  }
});

el.settingsReset.addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS };
  saveSettings();
  openSettings();
  updateModelBadge();
});

// ----------------------------------------------------------------
// Opis wybranego modelu
// ----------------------------------------------------------------

/** Wypisz, do czego dany model się nadaje. Pusty identyfikator chowa ramkę. */
function renderModelInfo(boxEl, id) {
  const info = typeof modelInfo === 'function' ? modelInfo(id) : null;
  if (!id || !info) { boxEl.hidden = true; return; }

  const lang = getLang();
  const tags = (info.cechy || [])
    .map((c) => CECHA_OPIS[c])
    .filter(Boolean)
    .map((c) => `<span class="model-info-tag">${c.ikona} ${escapeHtml(c[lang] || c.pl)}</span>`);
  if (info.kontekst) {
    tags.push(`<span class="model-info-tag">📏 ${escapeHtml(info.kontekst)}</span>`);
  }

  const parts = [];
  if (info.zgadywane) {
    parts.push(`<div class="model-info-guess">${t('model.guessed')}</div>`);
  } else {
    parts.push(`<div class="model-info-name">${escapeHtml(info.nazwa)}</div>`);
    if (info.opis) parts.push(`<div>${escapeHtml(info.opis)}</div>`);
  }
  if (tags.length) parts.push(`<div class="model-info-tags">${tags.join('')}</div>`);
  if (info.mocne && info.mocne.length) {
    parts.push(`<div class="model-info-good">${t('model.bestFor')} `
      + escapeHtml(info.mocne.join(' · ')) + '</div>');
  }
  if (info.uwaga) parts.push(`<div class="model-info-warn">⚠ ${escapeHtml(info.uwaga)}</div>`);

  boxEl.innerHTML = parts.join('');
  boxEl.hidden = false;
}

/** Wypełnij listę mikrofonów.
 *
 * Nazwy urządzeń przeglądarka ujawnia dopiero po przyznaniu dostępu do audio —
 * wcześniej lista jest pusta albo bezimienna. Dlatego przy pierwszym otwarciu
 * prosimy o zgodę i od razu ją zwalniamy.
 */
async function loadMicList() {
  const sel = $('set-mic');
  if (!mediaApiAvailable()) {
    sel.innerHTML = `<option value="">${escapeHtml(t('set.micNoApi'))}</option>`;
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some((d) => d.kind === 'audioinput' && d.label)) {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((tr) => tr.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    const mics = devices.filter((d) => d.kind === 'audioinput');
    const saved = localStorage.getItem('cosmos.micId') || '';
    sel.innerHTML = `<option value="">${escapeHtml(t('set.micDefault'))}</option>`
      + mics.map((d, i) => `<option value="${escapeHtml(d.deviceId)}"${d.deviceId === saved ? ' selected' : ''}>`
        + escapeHtml(d.label || `${t('set.micUnnamed')} ${i + 1}`) + '</option>').join('');
  } catch (err) {
    sel.innerHTML = `<option value="">${escapeHtml(err.message)}</option>`;
  }
}

function refreshModelInfoBoxes() {
  renderModelInfo($('model-info-cloud'), el.setModelCloud.value.trim()
    || epConfig('cloud').model || '');
  renderModelInfo($('model-info-local'), el.setModelLocal.value.trim()
    || epConfig('local').model || '');
}

async function fetchModelsInto(epName, selectEl, btn) {
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = t('set.fetching');
  try {
    const res = await fetch(`/api/models?endpoint=${epName}`);
    const data = await readJsonSafe(res);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const models = (data.data || []).map((m) => m.id).sort();
    if (!models.length) throw new Error(t('set.noModels'));
    // Znane modele na górę i z etykietą — inaczej wybiera się z listy
    // kilkudziesięciu identyfikatorów, nie wiedząc, czym się różnią.
    const described = [];
    const rest = [];
    for (const m of models) {
      const info = typeof modelInfo === 'function' ? modelInfo(m) : null;
      (info && !info.zgadywane ? described : rest).push([m, info]);
    }
    // Natywny wybierak Androida to lista na cały ekran, w której każda pozycja
    // zawija się na tyle wierszy, ile trzeba. Pełny identyfikator PLUS nazwa
    // dawały po trzy wiersze na model i listę nie do przejrzenia. Na wąskim
    // ekranie pokazujemy więc samą nazwę (identyfikator i tak siedzi w value
    // i ląduje w polu tekstowym po wyborze).
    const narrow = window.matchMedia('(max-width: 720px)').matches;
    // Kilka różnych modeli może trafić na ten sam opis w katalogu („Lokalny
    // model wizyjny"). Sama nazwa byłaby wtedy nie do rozróżnienia, więc
    // policzmy powtórzenia i przy nich dołóżmy końcówkę identyfikatora.
    const nameCount = {};
    for (const [, info] of [...described, ...rest]) {
      if (info && !info.zgadywane) nameCount[info.nazwa] = (nameCount[info.nazwa] || 0) + 1;
    }
    const option = ([m, info]) => {
      const named = info && !info.zgadywane;
      const short = m.split('/').pop();
      let label;
      if (!named) label = narrow ? short : m;
      else if (!narrow) label = `${m} — ${info.nazwa}`;
      // Gdy nazwa się powtarza, i tak nic nie rozróżnia — pokazujemy wtedy sam
      // identyfikator (bez prefiksu dostawcy), bo to on jest tu informacją.
      else label = nameCount[info.nazwa] > 1 ? short : info.nazwa;
      return `<option value="${escapeHtml(m)}">${escapeHtml(label)}</option>`;
    };
    selectEl.innerHTML =
      `<option value="">${t('set.selectModel')}</option>`
      + (described.length ? `<optgroup label="${t('model.known')}">`
          + described.map(option).join('') + '</optgroup>' : '')
      + (rest.length ? `<optgroup label="${t('model.other')}">`
          + rest.map(option).join('') + '</optgroup>' : '');
    selectEl.style.display = '';
  } catch (err) {
    // Nie alert: przy modelu lokalnym komunikat ma kilka linijek podpowiedzi,
    // a systemowe okienko na telefonie ucina je i nie da się z nich skopiować.
    const box = $(epName === 'local' ? 'model-info-local' : 'model-info-cloud');
    box.hidden = false;
    box.innerHTML = `<div class="model-info-warn">⚠ ${escapeHtml(t('set.fetchErr'))}</div>`
      + `<pre class="model-info-err">${escapeHtml(err.message)}</pre>`;
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
  refreshModelInfoBoxes();
});
el.modelSelectLocal.addEventListener('change', () => {
  if (el.modelSelectLocal.value) el.setModelLocal.value = el.modelSelectLocal.value;
  refreshModelInfoBoxes();
});
// Także przy wpisywaniu z ręki — opis ma nadążać za tym, co widać w polu.
el.setModelCloud.addEventListener('input', refreshModelInfoBoxes);
$('set-mic').addEventListener('change', (e) => {
  localStorage.setItem('cosmos.micId', e.target.value);
});
$('mic-refresh').addEventListener('click', loadMicList);
$('polish-btn').addEventListener('click', polishPrompt);
el.setModelLocal.addEventListener('input', refreshModelInfoBoxes);

// ----------------------------------------------------------------
// Status i konfiguracja serwera
// ----------------------------------------------------------------

function updateModelBadge() {
  const model = currentModel() || t('chat.modelNotSet');
  const labels = { cloud: t('tabCloud'), local: t('tabLocal'), openai: 'OpenAI', claude: 'Claude' };
  el.topbarModel.textContent = `${model} · ${labels[endpoint] || endpoint}`;
  el.welcomeModel.textContent = model;
}

function setStatusRow(rowEl, online, extra) {
  const dot = rowEl.querySelector('.status-dot');
  const state = rowEl.querySelector('.status-state');
  dot.className = 'status-dot ' + (online === true ? 'ok' : online === 'warn' ? 'warn' : 'err');
  state.textContent = extra;
}

function setServerReachable(ok) {
  if (ok === serverReachable) return;
  serverReachable = ok;
  const bar = $('offline-bar');
  if (bar) bar.hidden = ok;
  updateSendButton();
}

async function retryConnection() {
  const btn = $('offline-retry');
  if (btn) { btn.disabled = true; btn.textContent = t('offline.retrying'); }
  await loadServerConfig();
  if (btn) { btn.disabled = false; btn.textContent = t('offline.retry'); }
}

async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    const st = await res.json();
    setServerReachable(true);
    const cloudCfg = epConfig('cloud');
    if (!cloudCfg.hasApiKey) {
      setStatusRow(el.statusCloud, 'warn', t('stat.noKey'));
    } else {
      setStatusRow(el.statusCloud, st.cloud?.online === true, st.cloud?.online ? t('stat.online') : t('stat.offline'));
    }
    setStatusRow(el.statusLocal, st.local?.online === true, st.local?.online ? t('stat.online') : t('stat.offline'));
    senses = { online: st.senses?.online === true, caps: st.senses?.caps || {} };
    if (senses.online) {
      const active = Object.entries(senses.caps).filter(([, v]) => v).map(([k]) => k);
      setStatusRow(el.statusSenses, true, active.length ? t('stat.active', { n: active.length }) : t('stat.online'));
      el.statusSenses.title = active.length ? t('stat.sensesTip', { list: active.join(', ') }) : t('stat.online');
    } else {
      setStatusRow(el.statusSenses, 'warn', t('stat.offline'));
      el.statusSenses.title = t('stat.sensesRun');
    }
  } catch {
    setStatusRow(el.statusCloud, false, '—');
    setStatusRow(el.statusLocal, false, '—');
    setStatusRow(el.statusSenses, false, '—');
    setServerReachable(false);
  }
}

async function loadServerConfig() {
  try {
    const res = await fetch('/api/config');
    serverConfig = await res.json();
    setServerReachable(true);
  } catch {
    // interfejs działa dalej z pamięci podręcznej — pasek u góry mówi o awarii
    setServerReachable(false);
  }
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
// Logowanie (gdy serwer wymaga hasła — np. na VPS)
// ----------------------------------------------------------------

async function checkAuth() {
  try {
    const res = await fetch('/api/auth');
    const d = await res.json();
    return d.required && !d.authed ? false : true;
  } catch {
    return true; // serwer nieosiągalny — nie blokuj UI (offline)
  }
}

function showLogin() {
  const overlay = $('login-overlay');
  overlay.style.display = '';
  // przełącznik języka działający jeszcze przed zalogowaniem
  $('login-lang').addEventListener('click', () => {
    setLang(getLang() === 'pl' ? 'en' : 'pl'); // setLang wywołuje applyI18n()
  });
  const form = $('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('login-error');
    err.textContent = '';
    $('login-submit').disabled = true;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('login-password').value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || t('login.failed'));
      }
      location.reload();
    } catch (ex) {
      err.textContent = ex.message;
      $('login-submit').disabled = false;
      $('login-password').select();
    }
  });
}

async function boot() {
  applyI18n();
  if (!(await checkAuth())) {
    showLogin();
    return; // nie inicjalizuj reszty, dopóki użytkownik się nie zaloguje
  }
  startApp();
}

function startApp() {
  applyI18n();
  collapseSidebarOnMobile(); // na telefonie zacznij z ukrytym panelem, widoczny czat
  setEndpoint(endpoint);
  el.ttsToggle.classList.toggle('active', Boolean(settings.speak));
  updateKbBadge();
  loadConversations();
  renderMessages();
  updateSendButton();
  loadServerConfig();
  setInterval(refreshStatus, 30000);
  // Nauka: harmonogram rutyn
  try { scheduleControls(); } catch { /* ignore */ }
  loadProcedures();
  loadAutomationStatus();
  updateLearnBadge();
  pollDueRoutines();
  setInterval(pollDueRoutines, 60000);
  el.input.focus();
}

// ----------------------------------------------------------------
// NAUKA — rozpoznawanie (przez zmysły), procedury, rutyny
// ----------------------------------------------------------------
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
  const body = {
    label, kind: $('learn-kind').value, note: $('learn-note').value.trim(),
    image: learnShot || null,
  };
  try {
    const r = await fetch('/api/lessons', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw 0;
    $('learn-recog-status').textContent = t('learn.taught', { label });
    $('learn-label').value = ''; $('learn-note').value = ''; learnShot = null;
    $('learn-thumb').style.display = 'none';
    loadLessons();
    updateLearnBadge();
  } catch { $('learn-recog-status').textContent = t('learn.teachErr'); }
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
      // przeglądarka zamknięta ręcznie — pozwól zapisać przez „Zakończ"
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
  runProcedure({ name: $('proc-name').value.trim() || '—', steps: procStepsData });
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
    const names = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
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
      const autoTag = r.mode === 'auto-read' ? ' · ⚡auto' : '';
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

// pastylka licznika przy „Nauka" — liczba oczekujących rutyn
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

// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------

boot();

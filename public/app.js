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
// Dokumenty czekające na wysłanie: { name, chars, text, truncated }. Trzymamy
// gotowy TEKST, nie plik — treść wyciąga serwer, zaraz po wybraniu pliku.
let pendingDocs = [];
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

/* Zapis z opóźnieniem — do pisania w płótnie. Zapisywanie przy każdym
   naciśnięciu klawisza słałoby na serwer kilkanaście żądań na sekundę. */
let zapisZaChwile = null;
function saveConversationsSoon(ms = 800) {
  clearTimeout(zapisZaChwile);
  zapisZaChwile = setTimeout(() => { zapisZaChwile = null; saveConversations(); }, ms);
}

function saveConversations() {
  clearTimeout(zapisZaChwile);
  zapisZaChwile = null;
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
// Zdjęcia znalezione w internecie — inna rzecz niż `images` (te są wgrane
// albo wygenerowane). Mają źródło, więc dają się kliknąć i sprawdzić.
function msgPhotos(m) {
  return typeof m.content === 'string' ? [] : (m.content?.photos || []);
}
// Wczytane dokumenty: na ekranie kafelek z nazwą, do modelu pełna treść.
function msgDocs(m) {
  return typeof m.content === 'string' ? [] : (m.content?.docs || []);
}
// Wynik uruchomienia programu: { stdout, stderr, wyniki, ms }.
function msgRun(m) {
  return typeof m.content === 'string' ? null : (m.content?.run || null);
}

/** Wszystkie załączniki tej rozmowy — program dostaje je jako pliki obok
 *  siebie, więc „policz sumę z tego arkusza" działa bez przeklejania danych. */
function zebranyMaterial(conv) {
  const pliki = [];
  for (const m of conv.messages) {
    for (const d of msgDocs(m)) {
      if (pliki.length < 8) pliki.push({ name: d.name, text: d.text });
    }
  }
  return pliki;
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

/* ============================ ARCHIWUM MATERIAŁU ============================ */

let archiwumOdpytywanie = null;

/** Pokaż stan archiwum i przyciski pasujące do tego stanu.
 *  Panel buduje się od zera przy każdym odświeżeniu — stanów jest pięć
 *  (nieskonfigurowany, niepołączony, połączony, indeksuje, błąd), a doklejanie
 *  i chowanie przycisków przy każdym z nich to prosta droga do panelu,
 *  w którym „Przerwij" zostaje po zakończonym indeksowaniu. */
async function odswiezArchiwum() {
  const stanEl = $('arch-state');
  const akcje = $('arch-actions');
  if (!stanEl) return;
  let d;
  try {
    d = await (await fetch('/api/onedrive/status')).json();
  } catch {
    stanEl.textContent = t('offline.title');
    akcje.innerHTML = '';
    return;
  }

  akcje.innerHTML = '';
  const przycisk = (etykieta, przy) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-secondary';
    b.textContent = etykieta;
    b.addEventListener('click', przy);
    akcje.appendChild(b);
    return b;
  };

  const indeks = d.indeksowanie;
  if (indeks && indeks.trwa) {
    stanEl.textContent = t('arch.indexing', { n: indeks.dodanych });
    przycisk(t('arch.stop'), async () => {
      await fetch('/api/onedrive/index', { method: 'DELETE' }).catch(() => {});
      odswiezArchiwum();
    });
    // Odpytujemy tylko w trakcie indeksowania i tylko jedną pętlą.
    clearTimeout(archiwumOdpytywanie);
    archiwumOdpytywanie = setTimeout(odswiezArchiwum, 3000);
    return;
  }
  clearTimeout(archiwumOdpytywanie);

  if (indeks && indeks.blad) {
    stanEl.textContent = t('arch.indexError', { msg: indeks.blad });
  } else if (!d.skonfigurowany) {
    stanEl.textContent = t('arch.notConfigured');
    return;                       // bez konfiguracji nie ma czego klikać
  } else if (!d.polaczony) {
    stanEl.textContent = t('arch.notConnected');
  } else {
    stanEl.textContent = d.wArchiwum
      ? t('arch.connected', { n: d.wArchiwum.toLocaleString() })
      : `${t('arch.notConnected').replace(/[^.]*$/, '')} ${t('arch.empty')}`.trim();
  }

  if (!d.polaczony) {
    przycisk(t('arch.connect'), async () => {
      const r = await fetch('/api/onedrive/login');
      const w = await readJsonSafe(r);
      if (w.url) window.open(w.url, '_blank', 'noopener');
      // Logowanie kończy się w innej karcie — sprawdzamy stan po powrocie.
      setTimeout(odswiezArchiwum, 4000);
    });
    return;
  }

  przycisk(t('arch.index'), async () => {
    await fetch('/api/onedrive/index', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).catch(() => {});
    odswiezArchiwum();
  });
  /* Dwa uzupełnienia indeksu, każde jedno żądanie NA PLIK — dlatego osobno
     od indeksowania i dlatego paczkami. Do tej pory dało się je uruchomić
     wyłącznie ręcznie curlem, co znaczy: nikt ich nigdy nie uruchomił. */
  if (d.wArchiwum) {
    przycisk(t('arch.lenses'), (e) => uzupelniajPaczkami({
      przycisk: e.currentTarget, adres: '/api/archive/lenses', ile: 100,
      etykieta: (w) => t('arch.lensesProgress', { ile: w.uzupelnione, zostalo: w.zostalo }),
      koniec: (suma) => t('arch.lensesDone', { ile: suma }),
    }));
    przycisk(t('arch.vision'), (e) => uzupelniajPaczkami({
      przycisk: e.currentTarget, adres: '/api/archive/vision', ile: 50,
      etykieta: (w) => t('arch.visionProgress', { ile: w.opisane, zostalo: w.zostalo }),
      koniec: (suma) => t('arch.visionDone', { ile: suma }),
    }));
    przycisk(t('arch.tele'), (e) => uzupelniajPaczkami({
      przycisk: e.currentTarget, adres: '/api/archive/telemetry', ile: 25,
      etykieta: (w) => t('arch.teleProgress', { ile: w.odczytane, zostalo: w.zostalo }),
      koniec: (suma) => t('arch.teleDone', { ile: suma }),
    }));
  }

  przycisk(t('arch.disconnect'), async () => {
    if (!confirm(t('arch.confirmDisconnect'))) return;
    await fetch('/api/onedrive/disconnect', { method: 'POST' }).catch(() => {});
    odswiezArchiwum();
  });
}

/* Długie zadanie w paczkach, sterowane z przeglądarki.
 *
 * Pętla siedzi TUTAJ, a nie na serwerze, i to jest przemyślane: zadanie na
 * dwa tysiące żądań, które startuje po jednym kliknięciu i nie ma jak
 * pokazać postępu ani się zatrzymać, kończy się tym, że po piętnastu minutach
 * ciszy człowiek restartuje serwer. Tu każde kliknięcie „Przerwij" działa
 * natychmiast, bo przerywa się między paczkami, a nie w środku zapisu. */
let paczkiPrzerwane = false;

async function uzupelniajPaczkami({ przycisk, adres, ile, etykieta, koniec }) {
  const stanEl = $('arch-state');
  const pierwotny = przycisk.textContent;
  if (przycisk.dataset.trwa === '1') { paczkiPrzerwane = true; return; }
  przycisk.dataset.trwa = '1';
  przycisk.textContent = t('arch.stop');
  paczkiPrzerwane = false;
  let suma = 0;
  let poprzednioZostalo = Infinity;
  try {
    for (;;) {
      const r = await fetch(adres, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ile }),
      });
      const w = await readJsonSafe(r);
      if (!r.ok) { stanEl.textContent = w.error || `HTTP ${r.status}`; return; }
      suma += Number(w.uzupelnione || w.opisane || w.odczytane || 0);
      stanEl.textContent = etykieta(w);
      // `sprawdzone === 0` znaczy „nie ma już czego brać" — bez tego warunku
      // pusta kolejka kręciłaby pętlę w nieskończoność.
      if (paczkiPrzerwane || !w.sprawdzone || !w.zostalo) break;
      /* KOLEJKA MUSI MALEĆ. Gdy każdy plik w paczce kończy się błędem — token
         OneDrive wygasł, zmysły padły w połowie — nic nie ubywa, a warunki
         wyżej są dalej spełnione. To była pętla bez końca waląca w serwer
         co sekundę. Brak postępu kończy zadanie z komunikatem, nie po cichu. */
      if (Number(w.zostalo) >= poprzednioZostalo) {
        stanEl.textContent = t('arch.batchStuck', {
          zostalo: w.zostalo, powod: (w.bledy || [])[0] || '—',
        });
        return;
      }
      poprzednioZostalo = Number(w.zostalo);
    }
    stanEl.textContent = koniec(suma);
  } catch (err) {
    stanEl.textContent = String(err.message);
  } finally {
    przycisk.dataset.trwa = '0';
    przycisk.textContent = pierwotny;
  }
}

/* ================================ PŁÓTNO ================================ */

$('canvas-close').addEventListener('click', () => { $('canvas').hidden = true; });
$('canvas-copy').addEventListener('click', () => {
  navigator.clipboard.writeText($('canvas-text').value).catch(() => {});
});
$('canvas-download').addEventListener('click', () => {
  const conv = activeConv();
  const nazwa = ((conv && conv.canvas && conv.canvas.title) || 'plotno')
    .replace(/[^\w\s.\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, '').trim() || 'plotno';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([$('canvas-text').value], { type: 'text/markdown' }));
  a.download = `${nazwa}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
});
/* Ręczne poprawki trafiają z powrotem do rozmowy. Bez tego model przy
   następnej zmianie szukałby fragmentu, którego już nie ma, i poprawka
   przepadałaby z komunikatem „nie znalazłem". */
$('canvas-text').addEventListener('input', () => {
  const conv = activeConv();
  if (conv && conv.canvas) {
    conv.canvas.text = $('canvas-text').value;
    odswiezMiarePlotna();
    saveConversationsSoon();
  }
});

/** Zastosuj poprawki w formacie SZUKAJ/ZAMIEŃ.
 *
 *  Model podaje fragment do znalezienia i jego nową wersję zamiast całego
 *  dokumentu. Fragment MUSI występować dokładnie raz — gdy trafia w dwa
 *  miejsca, nie wiadomo, które miał na myśli, i cicha podmiana pierwszego
 *  z brzegu potrafi zepsuć tekst tak, że nikt tego nie zauważy.
 */
function zastosujZmianePlotna(conv, blok) {
  if (!conv.canvas) return { ok: false, blad: t('canvas.noneYet') };
  const kawalki = [...blok.matchAll(
    /<<<<<<<\s*SZUKAJ\s*\n([\s\S]*?)\n?=======\s*\n([\s\S]*?)\n?>>>>>>>\s*ZAMIEŃ/g)];
  if (!kawalki.length) return { ok: false, blad: t('canvas.badPatch') };

  let tekst = conv.canvas.text;
  let ile = 0;
  for (const [, szukaj, zamien] of kawalki) {
    const pierwszy = tekst.indexOf(szukaj);
    if (pierwszy === -1) {
      return { ok: false, blad: t('canvas.notFound', { frag: szukaj.slice(0, 60) }) };
    }
    if (tekst.indexOf(szukaj, pierwszy + 1) !== -1) {
      return { ok: false, blad: t('canvas.ambiguous', { frag: szukaj.slice(0, 60) }) };
    }
    tekst = tekst.slice(0, pierwszy) + zamien + tekst.slice(pierwszy + szukaj.length);
    ile++;
  }
  conv.canvas.text = tekst;
  return { ok: true, ile };
}

/** Pokaż płótno bieżącej rozmowy (albo schowaj, gdy go nie ma). */
function pokazPlotno(conv) {
  const box = $('canvas');
  if (!conv || !conv.canvas) { box.hidden = true; return; }
  box.hidden = false;
  $('canvas-title').textContent = conv.canvas.title;
  $('canvas-text').value = conv.canvas.text;
  odswiezMiarePlotna();
}

function odswiezMiarePlotna() {
  const tekst = $('canvas-text').value;
  const slowa = tekst.trim() ? tekst.trim().split(/\s+/).length : 0;
  $('canvas-meta').textContent = t('canvas.meta', { w: slowa, c: tekst.length });
}

/** Wynik uruchomionego programu: co wypisał, jak długo to trwało i co narysował.
 *
 *  Czas wykonania jest tu celowo widoczny. „Policzone, nie zgadnięte" ma
 *  znaczenie tylko wtedy, gdy widać, że program naprawdę się wykonał.
 */
function runPanel(run) {
  const box = document.createElement('div');
  box.className = 'run-panel';

  const pasek = document.createElement('div');
  pasek.className = 'run-bar';
  pasek.textContent = run.przerwany
    ? t('run.timeout', { s: Math.round((run.limitMs || 10000) / 1000) })
    : t('run.done', { ms: run.ms || 0 });
  box.appendChild(pasek);

  if (run.stdout && run.stdout.trim()) {
    const out = document.createElement('pre');
    out.className = 'run-out';
    out.textContent = run.stdout.trim();
    box.appendChild(out);
  }
  if (run.stderr && run.stderr.trim()) {
    const err = document.createElement('pre');
    err.className = 'run-out run-err';
    err.textContent = run.stderr.trim();
    box.appendChild(err);
  }

  for (const plik of run.wyniki || []) {
    if (/\.svg$/i.test(plik.name)) {
      /* SVG wstawiamy jako obrazek z data-URI, nie przez innerHTML. Program
         pisze model, więc jego wyjście jest treścią niezaufaną — wstrzyknięte
         do DOM-u wykonałoby skrypt w kontekście Cosmosa. W <img> nie wykona. */
      const img = document.createElement('img');
      img.className = 'run-svg';
      img.alt = plik.name;
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(plik.text)));
      box.appendChild(img);
    } else {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'doc-chip';
      chip.textContent = `📄 ${plik.name}`;
      chip.addEventListener('click', () => openTextViewer(plik.name, plik.text));
      box.appendChild(chip);
    }
  }
  return box;
}

/** Siatka zdjęć znalezionych w internecie.
 *
 *  Miniatury lecą przez `/api/search/thumb`, a nie prosto z cudzego CDN-u:
 *  telefon nie łączy się wtedy z obcym hostem przy każdym wyniku, a zdjęcia
 *  działają też wtedy, gdy sieć ten CDN blokuje. Każdy kafelek prowadzi do
 *  strony źródłowej — zdjęcie z internetu bez źródła jest bezwartościowe.
 */
function photosGrid(photos) {
  const wrap = document.createElement('div');
  wrap.className = 'photo-grid';
  for (const p of photos) {
    const a = document.createElement('a');
    a.className = 'photo-tile';
    a.href = p.source || p.full || '#';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = [p.title, p.zrodlo, p.licencja].filter(Boolean).join(' · ');
    const img = document.createElement('img');
    /* Adres własny (np. z archiwum) bierzemy wprost — proxy miniatur jest
       od CUDZYCH hostów i tylko by tu przeszkadzało. */
    const wlasny = /^\//.test(p.thumb || '');
    img.src = wlasny ? p.thumb : `/api/search/thumb?u=${encodeURIComponent(p.thumb)}`;
    img.alt = p.title || t('photo.found');
    img.loading = 'lazy';

    /* Zdjęcie z archiwum otwiera się NA PEŁNYM EKRANIE w Cosmosie, a nie
       w nowej karcie: to własny plik Marcina, więc nie ma dokąd go „odesłać".
       Zdjęcia z internetu zostają odnośnikiem do źródła. */
    if (p.podglad) {
      a.href = '#';
      a.addEventListener('click', (e) => { e.preventDefault(); openImageViewer(p.podglad); });
    }

    /* Co się dzieje, gdy miniatura nie chce się wczytać.

       Kiedyś kafelek po prostu ZNIKAŁ. Brzmi rozsądnie („nie zostawiaj dziury
       w siatce"), a w praktyce to była najgorsza możliwa reakcja: gdy proxy
       odrzucało wszystkie miniatury, Cosmos pisał „znalazłem 8 zdjęć" i nie
       pokazywał ani jednego, bez śladu, co poszło nie tak. Dokładnie to
       zgłosił Marcin.

       Teraz próbujemy po kolei: przez proxy → prosto z serwera obrazka →
       a jak i to nie wyjdzie, zostaje widoczny kafelek z odnośnikiem. Zawsze
       widać tyle kafelków, ile zapowiedziała odpowiedź. */
    let probowanoWprost = wlasny;   // własnego adresu nie ma po co próbować drugi raz
    img.addEventListener('error', () => {
      if (!probowanoWprost && /^https:\/\//i.test(p.thumb || '')) {
        // Proxy odmówiło (nieznany host, przekroczony czas). Przeglądarka
        // może pobrać obrazek sama — dla niej to zwykły zewnętrzny zasób.
        probowanoWprost = true;
        img.src = p.thumb;
        return;
      }
      img.remove();
      a.classList.add('photo-tile-pusty');
      const info = document.createElement('span');
      info.className = 'photo-brak';
      info.textContent = t('photo.thumbFailed');
      a.prepend(info);
    });

    const cap = document.createElement('span');
    cap.className = 'photo-cap';
    // Skąd zdjęcie i na jakiej licencji — dla kogoś, kto montuje film, to nie
    // ozdobnik, tylko odpowiedź na pytanie „czy wolno mi tego użyć".
    let skad = p.zrodlo || '';
    if (!skad) { try { skad = new URL(p.source).hostname.replace(/^www\./, ''); } catch { skad = ''; } }
    cap.textContent = [skad, p.licencja].filter(Boolean).join(' · ') || p.title || '';
    a.append(img, cap);
    wrap.appendChild(a);
  }
  return wrap;
}

/** Podgląd obrazu na pełnym ekranie, z pobieraniem.
 *
 * Miniatura w rozmowie ma kilkaset pikseli, a wygenerowana grafika bywa
 * kilka razy większa — bez tego okna nie dało się jej ani obejrzeć, ani zapisać.
 */
/** Podgląd tekstu załącznika — bez biblioteki, bez zapisu, tylko do wglądu.
 *  Buduje się na żądanie i znika po zamknięciu: to okno pomocnicze, nie stan. */
function openTextViewer(nazwa, tekst) {
  const tlo = document.createElement('div');
  tlo.className = 'text-viewer';
  const okno = document.createElement('div');
  okno.className = 'text-viewer-box';
  const pasek = document.createElement('div');
  pasek.className = 'text-viewer-bar';
  const tytul = document.createElement('span');
  tytul.textContent = nazwa;
  const zamknij = document.createElement('button');
  zamknij.className = 'btn-secondary';
  zamknij.textContent = t('close');
  const tresc = document.createElement('pre');
  tresc.className = 'text-viewer-body';
  tresc.textContent = tekst;
  pasek.append(tytul, zamknij);
  okno.append(pasek, tresc);
  tlo.appendChild(okno);

  const usun = () => { tlo.remove(); document.removeEventListener('keydown', naEscape); };
  const naEscape = (e) => { if (e.key === 'Escape') usun(); };
  zamknij.addEventListener('click', usun);
  tlo.addEventListener('click', (e) => { if (e.target === tlo) usun(); });
  document.addEventListener('keydown', naEscape);
  document.body.appendChild(tlo);
}

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

  /* Tok myślenia zapisany przy wiadomości — zwinięty, żeby nie przykrywał
     odpowiedzi, ale dostępny, gdy chce się zobaczyć, czym model się zajmował.
     Wyjątek: gdy myślenie to WSZYSTKO, co przyszło (`samoMyslenie`), zwinięcie
     zostawia wiadomość złożoną z samego ostrzeżenia. Wtedy panel jest otwarty —
     jest jedyną treścią, jaką mamy, więc nie ma czego przykrywać. */
  body.innerHTML = (m.think
    ? `<details class="think-block"${m.samoMyslenie ? ' open' : ''}>`
      + `<summary>${escapeHtml(t('think.done'))}</summary>`
      + `<pre>${escapeHtml(m.think)}</pre></details>`
    : '')
    + (m.note ? `<div class="model-note mono">${escapeHtml(m.note)}</div>` : '')
    + renderMarkdown(text);
  if (images.length) {
    const imgs = imagesHtml(images);
    body.prepend(imgs);
  }
  const photos = msgPhotos(m);
  if (photos.length) body.appendChild(photosGrid(photos));
  const run = msgRun(m);
  if (run) body.appendChild(runPanel(run));
  const docs = msgDocs(m);
  if (docs.length) {
    const lista = document.createElement('div');
    lista.className = 'msg-docs';
    for (const d of docs) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'doc-chip';
      chip.textContent = `📄 ${d.name} · ${t('doc.chars', { n: (d.chars || 0).toLocaleString() })}`;
      chip.title = t('doc.peek');
      // Podgląd na żądanie: wysłaną treść trzeba móc sprawdzić, ale nie
      // kosztem zalania rozmowy ośmioma tysiącami znaków umowy.
      chip.addEventListener('click', () => openTextViewer(d.name, d.text));
      lista.appendChild(chip);
    }
    body.prepend(lista);
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
  // Płótno należy do rozmowy, więc przy przełączeniu musi się przełączyć —
  // inaczej przy nowej rozmowie zostaje na ekranie cudzy dokument.
  pokazPlotno(conv);
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
  pendingDocs.forEach((doc, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'attachment attachment-doc' + (doc.loading ? ' is-loading' : '');
    const label = document.createElement('span');
    label.className = 'attachment-doc-name';
    // Liczba znaków to jedyna uczciwa miara „ile z tego pliku model dostanie".
    label.textContent = doc.loading
      ? t('doc.reading', { name: doc.name })
      : `${doc.name} · ${t('doc.chars', { n: doc.chars.toLocaleString() })}${doc.truncated ? ' ✂' : ''}`;
    wrap.appendChild(label);
    if (!doc.loading) {
      const rm = document.createElement('button');
      rm.className = 'attachment-remove';
      rm.textContent = '×';
      rm.title = t('removeAttachment');
      rm.addEventListener('click', () => {
        pendingDocs.splice(idx, 1);
        renderAttachments();
        updateSendButton();
      });
      wrap.appendChild(rm);
    }
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
    if (file.type.startsWith('image/')) {
      if (pendingImages.length >= 4) { alert(t('cam.maxImages')); break; }
      try { pendingImages.push(await resizeImage(file)); }
      catch (err) { alert(err.message); }
      continue;
    }
    if (file.type.startsWith('video/')) {
      try { await wczytajWideo(file); }
      catch (err) { alert(err.message); }
      continue;
    }
    // Dokument: treść wyciąga serwer, przeglądarka dostaje gotowy tekst.
    if (pendingDocs.length >= 4) { alert(t('doc.max')); break; }
    await wczytajDokument(file);
  }
  el.fileInput.value = '';
  renderAttachments();
  updateSendButton();
});

/* ---- WIDEO: klatki kluczowe wyjęte W PRZEGLĄDARCE --------------------
   Pomysł z claude-video (z trendów GitHuba): model nie czyta wideo, model
   czyta KLATKI. Cała różnica jest w tym, gdzie się je wycina.

   Wysyłanie klipu na serwer odpada z arytmetyki: minuta z R6 II to 300-500 MB.
   Przez Tailscale z telefonu to kilka minut czekania, a potem dokładnie te same
   klatki, które przeglądarka potrafi wyjąć sama — <video> + <canvas> to
   dekoder sprzętowy, który i tak siedzi w każdym urządzeniu. Zero zależności,
   zero wysyłki, zero ffmpega na VPS-ie i działa przy wyłączonych zmysłach.

   Klatki bierzemy ze ŚRODKÓW równych odcinków, nie od zera: pierwsza klatka
   filmu to zwykle czarne pole albo klaps. */
const WIDEO_KLATEK = 4;
const WIDEO_SEEK_MS = 8000;

/* Czy przeglądarka w ogóle zna ten kodek?
 *
 * To nie jest pytanie akademickie akurat przy tym sprzęcie. Canon R6 II
 * nagrywa 4K w H.265/HEVC, a Chrome na Windowsie dekoduje HEVC tylko wtedy,
 * gdy system ma rozszerzenie od Microsoftu. Bez niego `<video>` po prostu
 * odmawia — i bez tego sprawdzenia dostajesz komunikat „ta przeglądarka nie
 * zna tego kodowania", z którego nie wynika ANI co jest nie tak, ani co
 * z tym zrobić. A rada jest bardzo konkretna: nagrywaj proxy w H.264 albo
 * doinstaluj rozszerzenie HEVC.
 */
function kodekZnany(file) {
  const v = document.createElement('video');
  if (!v.canPlayType) return true;                 // nie wiadomo — próbujemy
  if (v.canPlayType(file.type || '')) return true; // przeglądarka mówi „tak"
  return !/hevc|h\.?265|x265/i.test(file.type || '');
}

async function klatkiZWideo(file, ile) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'auto';
  v.muted = true;
  v.playsInline = true;
  v.src = url;
  const podejrzanyKodek = /\.(mov|mp4|m4v)$/i.test(file.name) && !kodekZnany(file);
  const nieczytelne = () => new Error(podejrzanyKodek
    ? t('video.hevc', { name: file.name })
    : t('video.unreadable', { name: file.name }));
  try {
    await new Promise((ok, zle) => {
      v.onloadedmetadata = () => ok();
      v.onerror = () => zle(nieczytelne());
      setTimeout(() => zle(nieczytelne()), WIDEO_SEEK_MS);
    });

    /* Długość bywa nieznana — pliki nagrywane strumieniowo (webm z przeglądarki,
       przerwany transfer) nie mają jej w nagłówku i `duration` to Infinity.
       Materiał z aparatu i drona zawsze ją ma, ale klip nagrany telefonem przez
       stronę WWW — niekoniecznie.

       Ratunek jest znany i tani: przewinięcie na absurdalnie odległy moment
       zmusza przeglądarkę do przejrzenia pliku do końca, po czym `duration`
       nagle jest znane. Brzmi jak sztuczka, bo jest sztuczką — ale różnica
       między jedną klatką a czterema jest realna. */
    if (!Number.isFinite(v.duration) || v.duration <= 0) {
      await new Promise((ok) => {
        let gotowe = false;
        const skoncz = () => { if (!gotowe) { gotowe = true; v.ondurationchange = null; ok(); } };
        v.ondurationchange = () => { if (Number.isFinite(v.duration)) skoncz(); };
        setTimeout(skoncz, 2000);
        try { v.currentTime = 1e6; } catch { skoncz(); }
      });
    }
    const dlugosc = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
    const momenty = dlugosc
      ? Array.from({ length: ile }, (_, i) => (dlugosc * (i + 0.5)) / ile)
      : [0];

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const klatki = [];
    for (const sekunda of momenty) {
      await new Promise((ok) => {
        let gotowe = false;
        const skoncz = () => { if (!gotowe) { gotowe = true; ok(); } };
        v.onseeked = skoncz;
        // Uszkodzone albo egzotyczne kodowanie potrafi nie dojechać do `seeked`
        // nigdy. Jedna klatka mniej jest lepsza niż zawieszony interfejs.
        setTimeout(skoncz, WIDEO_SEEK_MS);
        try { v.currentTime = sekunda; } catch { skoncz(); }
      });
      if (!v.videoWidth) continue;
      const skala = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
      canvas.width = Math.round(v.videoWidth * skala);
      canvas.height = Math.round(v.videoHeight * skala);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      klatki.push({ sekunda, obraz: canvas.toDataURL('image/jpeg', 0.85) });
    }
    return { klatki, dlugosc };
  } finally {
    v.onseeked = null;
    v.onerror = null;
    v.src = '';
    URL.revokeObjectURL(url);
  }
}

function czasMmSs(s) {
  const c = Math.max(0, Math.round(s));
  return `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;
}

/** Klip → klatki jako załączniki-obrazy + notatka, CO to właściwie jest.
 *  Bez notatki model dostaje cztery niepowiązane zdjęcia i opisuje je jak
 *  cztery różne sceny, zamiast czytać je jako jedno ujęcie w czasie. */
async function wczytajWideo(file) {
  const wolne = 4 - pendingImages.length;
  if (wolne <= 0) throw new Error(t('cam.maxImages'));
  const wpis = { name: file.name, chars: 0, text: '', loading: true };
  pendingDocs.push(wpis);
  renderAttachments();
  updateSendButton();
  try {
    const { klatki, dlugosc } = await klatkiZWideo(file, Math.min(WIDEO_KLATEK, wolne));
    if (!klatki.length) throw new Error(t('video.noFrames', { name: file.name }));
    for (const k of klatki) pendingImages.push(k.obraz);
    const opisKlatek = klatki.map((k, i) => `${i + 1}) ${czasMmSs(k.sekunda)}`).join(', ');
    const text = dlugosc
      ? t('video.note', { name: file.name, dlugosc: czasMmSs(dlugosc), ile: klatki.length, momenty: opisKlatek })
      : t('video.noteNoLen', { name: file.name, ile: klatki.length });
    Object.assign(wpis, { text, chars: text.length, loading: false });
  } catch (err) {
    pendingDocs.splice(pendingDocs.indexOf(wpis), 1);
    renderAttachments();
    updateSendButton();
    throw err;
  }
  renderAttachments();
  updateSendButton();
}

/** Wyślij plik do odczytania i zapamiętaj wynik jako załącznik rozmowy. */
async function wczytajDokument(file) {
  const wpis = { name: file.name, chars: 0, text: '', loading: true };
  pendingDocs.push(wpis);
  renderAttachments();
  updateSendButton();
  try {
    const r = await fetch('/api/document', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      body: file,
    });
    const d = await readJsonSafe(r);
    if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
    Object.assign(wpis, { chars: d.chars, text: d.text, truncated: d.truncated, loading: false });
  } catch (err) {
    // Plik, którego nie da się odczytać, znika z listy — ale z powodem.
    pendingDocs.splice(pendingDocs.indexOf(wpis), 1);
    alert(t('doc.failed', { name: file.name, msg: err.message }));
  }
  renderAttachments();
  updateSendButton();
}

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
  /* Bieżąca treść płótna idzie jako osobna wiadomość systemowa, ZAWSZE
     aktualna. Historia rozmowy zawiera stare wersje dokumentu; bez tego
     model poprawiałby fragment, który użytkownik zdążył już zmienić ręcznie. */
  if (conv.canvas && conv.canvas.text) {
    api.push({
      role: 'system',
      content: `PŁÓTNO — dokument otwarty obok rozmowy, tytuł „${conv.canvas.title}". `
        + 'To jest jego AKTUALNA treść (użytkownik mógł ją edytować ręcznie):\n'
        + '--- POCZĄTEK PŁÓTNA ---\n' + conv.canvas.text + '\n--- KONIEC PŁÓTNA ---',
    });
  }
  for (const m of conv.messages) {
    if (m.error || m.role === 'action') continue;
    let text = msgText(m);
    const images = msgImages(m);
    // Dokumenty doklejamy dopiero tutaj: w rozmowie widać kafelek z nazwą,
    // a model dostaje pełną treść z wyraźną ramką, żeby wiedział, co jest
    // załącznikiem, a co pytaniem użytkownika.
    const docs = msgDocs(m);
    if (docs.length) {
      const bloki = docs.map((d) => `--- ZAŁĄCZNIK: ${d.name}`
        + (d.truncated ? ' (przycięty)' : '') + ` ---\n${d.text}\n--- KONIEC: ${d.name} ---`);
      text = bloki.join('\n\n') + (text ? `\n\n${text}` : '');
    }
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
  const gotowe = pendingDocs.filter((d) => !d.loading);
  if ((!text && !pendingImages.length && !gotowe.length) || isGenerating) return;

  const conv = ensureConversation(text || (gotowe[0] && gotowe[0].name) || '');
  const content = (pendingImages.length || gotowe.length)
    ? {
        text,
        ...(pendingImages.length ? { images: [...pendingImages] } : {}),
        // Treść dokumentu trzymamy osobno od tekstu wiadomości: na ekranie ma
        // być kafelek „umowa.pdf · 8 412 znaków", a nie ośmiotysięczna ściana.
        ...(gotowe.length ? { docs: gotowe.map((d) => ({ name: d.name, chars: d.chars, text: d.text, truncated: d.truncated })) } : {}),
      }
    : text;
  conv.messages.push({ role: 'user', content });
  pendingImages = [];
  pendingDocs = [];
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
      let errText = t('httpErr', { status: res.status });
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
  return String(s || '')
    .replace(/\[SZUKAJ:[^\]]*\]/gi, '')
    .replace(/\[GRAFIKA:[^\]]*\]/gi, '')
    .replace(/\[PLAN:?[^\]]*\]/gi, '')
    .replace(/\[ARCHIWUM:?[^\]]*\]/gi, '')
    .trim();
}
/* ============ WYNIK ARCHIWUM → KONTEKST MODELU ============
   To jest miejsce, w którym Cosmos przez długi czas okłamywał sam siebie.

   Odpowiedź archiwum szła do modelu jako `JSON.stringify(dane).slice(0, 12000)`.
   Brzmi niewinnie, dopóki się nie policzy: sam adres jednej miniatury z OneDrive
   to 1248 znaków podpisanego tokenu, przy ~520 znakach reszty wpisu. Czyli
   z dwunastu tysięcy znaków mieściło się SZEŚĆ plików, a 71% tego, co czytał
   model, stanowiły adresy obrazków — których on nawet nie ogląda, bo w tym
   samym promptcie piszemy mu, że miniatury już pokazaliśmy człowiekowi.
   Do tego `slice` tnie napis w połowie JSON-a, więc model dostawał składniowo
   zepsuty dokument.

   Efekt na żywym archiwum: przy 59 421 plikach model widział sześć najnowszych
   (bo sortujemy od najnowszych — czyli akurat zrzuty ekranu z telefonu),
   dostawał polecenie „odpowiadaj na podstawie tych danych, nie zgaduj"
   i uczciwie meldował, że w archiwum nie ma zdjęć z aparatu. To nie była
   halucynacja. To był poprawny wniosek z próbki, którą sami mu podsunęliśmy.

   Dlatego: miniatury i identyfikatory wylatują, wpisy skracamy do pól, które
   naprawdę niosą treść, a na górze stoi jawne zdanie o tym, ILE tego jest
   i CZEGO model nie widzi. „Pokazuję 40 z 59 421" to zupełnie inna przesłanka
   niż „oto twoje archiwum". */
const ARCH_LIMIT_ZNAKOW = 12000;

function naKontekst(dane) {
  if (!dane || typeof dane !== 'object') return JSON.stringify(dane);
  if (!Array.isArray(dane.wyniki)) return JSON.stringify(dane, null, 1).slice(0, ARCH_LIMIT_ZNAKOW);

  const chude = dane.wyniki.map((w) => {
    const o = {};
    for (const [k, v] of Object.entries(w)) {
      // `miniatura` to 1,2 kB podpisanego adresu; `id` i `rozmiar` nic nie wnoszą.
      if (k === 'miniatura' || k === 'id' || k === 'rozmiar') continue;
      if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      o[k] = v;
    }
    return o;
  });

  /* Ile wpisów zmieści się w budżecie — liczone, a nie zgadywane. Bez
     miniatur wchodzi ich kilkadziesiąt zamiast sześciu. */
  let ile = chude.length;
  let tresc = '';
  while (ile > 0) {
    tresc = JSON.stringify({ ...dane, wyniki: chude.slice(0, ile) }, null, 1);
    if (tresc.length <= ARCH_LIMIT_ZNAKOW) break;
    ile = Math.floor(ile * 0.8);
  }

  const znaleziono = Number(dane.znaleziono) || 0;
  const naglowek = znaleziono > ile
    ? `UWAGA: widzisz ${ile} z ${znaleziono} pasujących plików, posortowane OD NAJNOWSZYCH. `
      + 'To jest PRÓBKA, nie całe archiwum — nie wyciągaj z niej wniosków o tym, czego '
      + 'w archiwum NIE MA. Jeśli chcesz wiedzieć, co tam jest w całości, poproś '
      + 'o zestawienie (grupuj=aparat, grupuj=rok, grupuj=temat) albo zawęź filtry.\n'
    : '';
  return naglowek + tresc.slice(0, ARCH_LIMIT_ZNAKOW);
}

const IMAGE_MARKER_RE = /\[OBRAZ:\s*([^\]\n]+)\]/i;
/* Znalezione zdjęcia to co innego niż wygenerowane. Bez tego znacznika model
   na „pokaż zdjęcia tych miejsc" odpowiadał „nie mam dostępu do wyszukiwania
   obrazów" i proponował wizje artystyczne zamiast prawdziwej Majorki. */
const PHOTO_MARKER_RE = /\[GRAFIKA:\s*([^\]\n]+)\]/i;
/* Kod do wykonania. Jedyne narzędzie zapisane blokiem, nie znacznikiem —
   program nie mieści się w jednej linii. */
const RUN_FENCE_RE = /```uruchom\s*\n([\s\S]*?)```/i;
/* Płótno: dokument obok rozmowy. Tworzenie i podmiana fragmentu to dwie różne
   rzeczy — przy scenariuszu na trzy tysiące słów przepisywanie całości przy
   każdej poprawce trwa minutę i za każdym razem coś się po drodze gubi. */
const CANVAS_NEW_RE = /```płótno(?::\s*([^\n]*))?\s*\n([\s\S]*?)```/i;
const CANVAS_PATCH_RE = /```płótno-zmiana\s*\n([\s\S]*?)```/i;
const ARCHIVE_RE = /\[ARCHIWUM:?\s*([^\]\n]*)\]/i;
const PLAN_RE = /\[PLAN:?\s*([^\]\n]*)\]/i;
const ACTION_RE = /\[AKCJA:\s*([^|\]]+)\|\s*([^\]]+)\]/i;

async function runGeneration(conv) {
  isGenerating = true;
  setGeneratingUI(true);
  if (voiceMode) setVoiceState('thinking');
  let finalText = '';

  const MAX_SEARCHES = 3;
  /* Zapytania do archiwum, które już poszły w tej turze. Model potrafi
     wywołać trzy razy DOKŁADNIE ten sam filtr i trzy razy dostać to samo
     zero — widać to było w rozmowie o Mazurach, gdzie „Przeszukuję Twoje
     archiwum…" pojawiło się kilka razy pod rząd bez zmiany parametrów.
     Limit głębokości tego nie łapie, bo formalnie to różne kroki. */
  const pytaniaArchiwum = new Set();
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
        // Ta sama zasada, co niżej: surowe rozumowanie nie jest odpowiedzią.
        const trescOstatnia = stripSearchMarker(last);
        let samoMyslenie = false;
        if (!trescOstatnia && lastReasoning) {
          lastThink = lastReasoning;
          finalText = t('budgetSpentOnThinking');
          samoMyslenie = true;
        } else finalText = trescOstatnia || t('emptyReply');
        conv.messages.push({ role: 'assistant', content: finalText, think: lastThink,
          note: lastModelNote, samoMyslenie });
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

      // Archiwum: pytania o WŁASNY materiał użytkownika.
      const archMarker = acc.match(ARCHIVE_RE);
      if (archMarker && depth < MAX_SEARCHES) {
        const q = new URLSearchParams();
        let grupuj = '';
        for (const kawalek of archMarker[1].trim().split(/\s+/)) {
          const i = kawalek.indexOf('=');
          if (i < 1) continue;
          const k = kawalek.slice(0, i);
          const v = kawalek.slice(i + 1);
          if (k === 'grupuj') grupuj = v; else q.set(k, v);
        }

        /* Ten sam filtr drugi raz nie przyniesie innej odpowiedzi. Zamiast
           pytać archiwum jeszcze raz, mówimy modelowi wprost, że się powtarza
           — bo inaczej wypala budżet tokenów na kółka i urywa odpowiedź
           w pół zdania. */
        const odcisk = `${grupuj}|${[...q.entries()].sort().map(([a, b]) => `${a}=${b}`).join('&')}`;
        if (pytaniaArchiwum.has(odcisk)) {
          conv.messages.push({
            role: 'user',
            content: 'UWAGA: to jest DOKŁADNIE to samo zapytanie do archiwum, które '
              + 'przed chwilą wykonałeś, i da ten sam wynik. Nie powtarzaj go. '
              + 'Albo zmień filtry (inny rok, `folder=` zamiast `miejsce=`, `grupuj=` '
              + 'zamiast listy plików), albo odpowiedz użytkownikowi tym, co już wiesz, '
              + 'i napisz wprost, czego nie udało się znaleźć.',
          });
          saveConversations();
          renderMessages();
          continue;
        }
        pytaniaArchiwum.add(odcisk);

        const before = stripSearchMarker(acc.replace(archMarker[0], ''));
        conv.messages.push({
          role: 'assistant',
          content: (before ? before + '\n\n' : '') + t('chat.searchingArchive'),
        });
        saveConversations();
        renderMessages();
        let dane;
        try {
          // Zestawienie liczbowe albo lista plików — to dwa różne pytania.
          const adres = grupuj
            ? `/api/archive/stats?pole=${encodeURIComponent(grupuj)}&${q}`
            : `/api/archive/search?limit=40&${q}`;
          const r = await fetch(adres);
          dane = await readJsonSafe(r);
          if (!r.ok) throw new Error(dane.error || `HTTP ${r.status}`);
        } catch (err) { dane = { error: err.message }; }

        /* PODGLĄDY, nie tylko opis słowami.
           Do tej pory wynik archiwum szedł wyłącznie do modelu jako tekst,
           więc na „pokaż zdjęcia z rana" Marcin dostawał listę nazw plików.
           Siatka miniatur była podpięta tylko pod wyszukiwanie w internecie.
           Miniatury lecą przez `/api/archive/thumb`, bo adresy z OneDrive
           wygasają i muszą być dociągane teraz, a nie przy indeksowaniu. */
        const pliki = (dane && Array.isArray(dane.wyniki)) ? dane.wyniki : [];
        const zPodgladem = pliki.filter((w) => w.zrodlo === 'onedrive').slice(0, 24);
        if (zPodgladem.length) {
          conv.messages.push({
            role: 'assistant',
            content: {
              text: '',
              photos: zPodgladem.map((w) => ({
                thumb: `/api/archive/thumb?id=${encodeURIComponent(w.id)}`,
                podglad: `/api/archive/thumb?id=${encodeURIComponent(w.id)}`,
                source: '',
                title: [w.nazwa, w.kiedy && w.kiedy.slice(0, 16).replace('T', ' ')]
                  .filter(Boolean).join(' · '),
                zrodlo: [w.poraDnia, w.swiatlo].filter(Boolean).join(' · '),
                licencja: w.ogniskowa ? `${w.ogniskowa} mm` : '',
              })),
            },
          });
          saveConversations();
          renderMessages();
        }

        conv.messages.push({
          role: 'user',
          content: 'WYNIK Z ARCHIWUM UŻYTKOWNIKA (jego własne pliki — odpowiadaj na '
            + 'podstawie tych danych, nie zgaduj; miniatury już pokazałem użytkownikowi, '
            + 'więc ich nie zapowiadaj ani nie opisuj plik po pliku):\n'
            + naKontekst(dane),
          search: true,
          searchQuery: t('chat.archiveQuery'),
        });
        saveConversations();
        renderMessages();
        continue;
      }

      // Plan zdjęciowy: pozycja Słońca i policzone nastawy dla miejsca użytkownika.
      const planMarker = acc.match(PLAN_RE);
      if (planMarker && depth < MAX_SEARCHES) {
        /* Dzielimy na `klucz=wartość`, ale wartość MOŻE mieć spacje —
           „obiektyw=24-70 f/2.8, 70-200 f/4" to jedna wartość, nie cztery
           parametry. Dzielenie po samych spacjach urywało ją na „24-70",
           przysłona przepadała i Cosmos liczył f/4 komuś, kto ma f/2.8:
           odpowiedź brzmiała sensownie i była nieprawdziwa. Tniemy więc tylko
           tam, gdzie po spacji zaczyna się kolejne `słowo=`. */
        const parametry = {};
        const ALIASY = { obiektywy: 'obiektyw', szklo: 'obiektyw', lens: 'obiektyw' };
        for (const kawalek of planMarker[1].trim().split(/\s+(?=[a-zA-Z_]+=)/)) {
          const i = kawalek.indexOf('=');
          if (i <= 0) continue;
          const k = kawalek.slice(0, i).trim().toLowerCase();
          const v = kawalek.slice(i + 1).trim();
          if (!v) continue;
          parametry[ALIASY[k] || k] = /^[\d.]+$/.test(v) ? Number(v) : v;
        }
        const before = stripSearchMarker(acc.replace(planMarker[0], ''));
        conv.messages.push({
          role: 'assistant',
          content: (before ? before + '\n\n' : '') + t('chat.planning'),
        });
        saveConversations();
        renderMessages();
        let plan;
        try {
          const r = await fetch('/api/plan', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(parametry),
          });
          plan = await readJsonSafe(r);
          if (!r.ok) throw new Error(plan.error || `HTTP ${r.status}`);
        } catch (err) {
          plan = { error: err.message };
        }
        conv.messages.push({
          role: 'user',
          content: 'DANE PLANU ZDJĘCIOWEGO (policzone dla lokalizacji użytkownika, '
            + 'użyj ich zamiast własnych szacunków):\n' + JSON.stringify(plan, null, 1),
          search: true,
          searchQuery: t('chat.planQuery'),
        });
        saveConversations();
        renderMessages();
        continue;
      }

      // Płótno: nowy dokument albo poprawka fragmentu w istniejącym.
      const nowePlotno = acc.match(CANVAS_NEW_RE);
      const zmianaPlotna = acc.match(CANVAS_PATCH_RE);
      if (nowePlotno || zmianaPlotna) {
        let opis;
        if (nowePlotno) {
          conv.canvas = {
            title: (nowePlotno[1] || '').trim() || t('canvas.untitled'),
            text: nowePlotno[2].replace(/\n$/, ''),
          };
          opis = t('canvas.created', { title: conv.canvas.title });
        } else {
          const wynik = zastosujZmianePlotna(conv, zmianaPlotna[1]);
          opis = wynik.ok
            ? t('canvas.patched', { n: wynik.ile })
            : t('canvas.patchFailed', { msg: wynik.blad });
        }
        const before = stripSearchMarker(acc.replace((nowePlotno || zmianaPlotna)[0], ''));
        conv.messages.push({ role: 'assistant', content: (before ? before + '\n\n' : '') + opis });
        saveConversations();
        renderMessages();
        pokazPlotno(conv);
        finalText = opis;
        break;
      }

      /* Kod sprawdzamy najpierw: wynik programu zwykle jest treścią odpowiedzi,
         a nie dodatkiem do niej. Pętla wraca potem do modelu, żeby ten
         zinterpretował liczby — inaczej użytkownik dostaje surowy stdout. */
      const kodMarker = acc.match(RUN_FENCE_RE);
      if (kodMarker && depth < MAX_SEARCHES) {
        const kod = kodMarker[1];
        const before = stripSearchMarker(acc.replace(kodMarker[0], ''));
        conv.messages.push({
          role: 'assistant',
          content: (before ? before + '\n\n' : '') + t('chat.running'),
          code: kod,
        });
        saveConversations();
        renderMessages();
        let wynik;
        try {
          const r = await fetch('/api/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Program dostaje treść załączników tej rozmowy jako pliki.
            body: JSON.stringify({ code: kod, files: zebranyMaterial(conv) }),
          });
          wynik = await readJsonSafe(r);
          if (!r.ok) throw new Error(wynik.error || `HTTP ${r.status}`);
        } catch (err) {
          wynik = { stdout: '', stderr: err.message, wyniki: [] };
        }
        const svg = (wynik.wyniki || []).filter((w) => /\.svg$/i.test(w.name));
        conv.messages.push({
          role: 'assistant',
          content: { text: '', run: wynik },
          ...(svg.length ? {} : {}),
        });
        // Model musi zobaczyć, co wyszło — bez tego skończyłoby się na stdout.
        conv.messages.push({
          role: 'user',
          content: t('chat.runResult', {
            out: (wynik.stdout || '(brak wyjścia)').slice(0, 6000),
            err: wynik.stderr ? `\nBŁĘDY:\n${wynik.stderr.slice(0, 2000)}` : '',
          }),
          search: true,
          searchQuery: t('chat.runQuery'),
        });
        saveConversations();
        renderMessages();
        continue;
      }

      /* Zdjęcia z internetu. Sprawdzane PRZED [OBRAZ:], bo gdy model wypisze
         oba, użytkownik prosił o zdjęcia — generowanie było jego drugim
         wyborem, nie pierwszym. */
      const fotoMarker = acc.match(PHOTO_MARKER_RE);
      if (fotoMarker) {
        // „Katedra; plaża; wioska" — jedna prośba, kilka zestawów zdjęć.
        const zapytania = fotoMarker[1].split(';')
          .map((s) => s.trim()).filter(Boolean).slice(0, 4);
        const before = stripSearchMarker(acc.replace(fotoMarker[0], ''));
        conv.messages.push({
          role: 'assistant',
          content: (before ? before + '\n\n' : '') + t('chat.findingPhotos', { q: zapytania.join(', ') }),
        });
        saveConversations();
        renderMessages();
        // Równolegle — inaczej trzy zapytania to trzy razy dłuższe czekanie.
        const zestawy = await Promise.all(zapytania.map(async (q) => {
          try {
            const r = await fetch(`/api/search/images?q=${encodeURIComponent(q)}`);
            const d = await readJsonSafe(r);
            return { q, photos: d.results || [], error: d.error || '' };
          } catch (err) { return { q, photos: [], error: err.message }; }
        }));
        const znalezione = zestawy.filter((z) => z.photos.length);
        if (znalezione.length) {
          for (const z of znalezione) {
            conv.messages.push({
              role: 'assistant',
              content: { text: zapytania.length > 1 ? z.q : '', photos: z.photos },
            });
          }
          finalText = t('chat.photosDone', { n: znalezione.reduce((s, z) => s + z.photos.length, 0) });
          saveConversations();
          break;
        }

        /* Nic nie znaleziono. Kiedyś kończyliśmy tutaj: użytkownik dostawał
           „nie znalazłem", a MODEL nie dowiadywał się o niczym. Rozmowa
           urywała się w pół kroku i następne zdanie użytkownika — choćby samo
           „Kraków" — trafiało w próżnię: model nie wiedział, że przed chwilą
           coś nie wyszło, ani czego dotyczyło. Wyglądało to jak zgłupienie.
           Teraz niepowodzenie wraca do modelu tak samo jak wynik wyszukiwania:
           może doprecyzować zapytanie albo uczciwie powiedzieć, co się stało. */
        const powod = zestawy.map((z) => z.error).filter(Boolean).join('; ');
        if (depth < MAX_SEARCHES) {
          conv.messages.push({
            role: 'user',
            content: `WYSZUKIWANIE GRAFIK NIE DAŁO WYNIKÓW dla: ${zapytania.join(', ')}.\n`
              + (powod ? `Powód techniczny: ${powod}\n` : '')
              + 'Nie powtarzaj tego samego zapytania. Jeśli było ogólnikowe albo '
              + 'brakowało w nim miejsca lub nazwy — spróbuj RAZ konkretniejszego. '
              + 'Jeśli zapytanie było już konkretne, nie szukaj ponownie: powiedz '
              + 'wprost, że nie udało się znaleźć zdjęć, podaj powód i zapytaj, '
              + 'czego dokładnie szukać.',
            search: true,
            searchQuery: t('chat.photosQuery'),
          });
          saveConversations();
          renderMessages();
          continue;
        }
        conv.messages.push({
          role: 'assistant',
          content: t('chat.photosNone', { msg: powod }),
          error: true,
        });
        finalText = t('chat.photosNoneVoice');
        saveConversations();
        break;
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

      /* Pusta treść przy modelu rozumującym znaczy „budżet tokenów poszedł
         w całości na myślenie”. Kiedyś wyrzucaliśmy wtedy surowy tok myślenia
         jako odpowiedź — i to było gorsze niż nic: rozumowanie jest po
         angielsku, urwane w połowie zdania i pokazuje deliberację, której
         użytkownik widzieć nie powinien. Teraz mówimy wprost, co się stało,
         a samo myślenie ląduje w zwijanym panelu, gdzie jego miejsce. */
      const trescOdpowiedzi = stripSearchMarker(acc);
      let mysliZamiastTresci = '';
      if (!trescOdpowiedzi && lastReasoning) {
        mysliZamiastTresci = lastReasoning;
        lastThink = lastReasoning;
        finalText = t('budgetSpentOnThinking');
      } else {
        finalText = trescOdpowiedzi || t('emptyReply');
      }
      const actMarker = finalText.match(ACTION_RE);
      if (actMarker) {
        const shown = finalText.replace(actMarker[0], '').trim();
        conv.messages.push({ role: 'assistant', content: shown || '…', think: lastThink, note: lastModelNote });
        conv.messages.push({ role: 'action', actionType: actMarker[1].trim().toLowerCase(), actionText: actMarker[2].trim() });
        finalText = shown;
      } else {
        conv.messages.push({ role: 'assistant', content: finalText, think: lastThink,
          note: lastModelNote, samoMyslenie: Boolean(mysliZamiastTresci) });
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
        // Zapamiętujemy, CO powiedzieliśmy — askVoice odrzuci to, gdyby
        // wróciło jako „pytanie" z mikrofonu.
        voiceOstatniaOdpowiedz = stripForSpeech(finalText);
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
let liveLastPose = 0;
let livePrevPose = '';

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
  // Plan pokazujemy tylko wtedy, gdy wiemy GDZIE — bez współrzędnych
  // nie ma z czego policzyć pozycji Słońca, a pusty panel myli.
  fetch('/api/location').then((r) => r.json())
    .then((d) => { $('plan-box').hidden = !(d.wspolrzedne && d.wspolrzedne.lat); })
    .catch(() => {});
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
  $('plan-box').hidden = true;
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
  // Postawę doklejamy przy KAŻDYM cyklu, nie tylko w chwili pomiaru —
  // inaczej następna detekcja nadpisuje status i sylwetka miga na ułamek
  // sekundy. Zmienia się wolno, więc ostatnia znana jest nadal prawdziwa.
  const ogon = livePrevPose ? ` · 🧍 ${livePrevPose}` : '';
  $('live-status').textContent = (objs.length
    ? objs.map((o) => `${o.label} (${posLabel((o.box[0] + o.box[2]) / 2, overlay.width)})`).join(', ')
    : t('liveNothing')) + ogon;

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

  // Sylwetka: postawa człowieka w kadrze. Doklejona do TEJ pętli, nie do
  // własnej — MediaPipe kosztuje, a i tak mamy już gotową klatkę. Pytamy
  // rzadziej niż o obiekty (co ~3 s), bo postawa zmienia się wolno.
  if (senses.caps.mediapipe && objs.some((o) => o.label === 'person')
      && Date.now() - liveLastPose > 3000) {
    liveLastPose = Date.now();
    try {
      const res = await fetch('/api/pose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: cap.toDataURL('image/jpeg', 0.7) }),
      });
      const poz = await readJsonSafe(res);
      if (res.ok && poz.present && poz.summary !== livePrevPose) {
        livePrevPose = poz.summary;
        $('live-status').textContent += ` · 🧍 ${poz.summary}`;
        // Człowiek wyszedł z kadru → przestajemy twierdzić, że stoi.
        // Do kontekstu rozmowy: model ma wiedzieć, czy stoisz, czy siedzisz.
        fetch('/api/events', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'sylwetka', summary: poz.summary }),
        }).catch(() => {});
      }
    } catch { /* zmysły offline albo brak MediaPipe */ }
  } else if (!objs.some((o) => o.label === 'person')) {
    livePrevPose = '';
  }

  odswiezPlan(cap);
}

/* ==================== PLAN ZDJĘCIOWY ==================== */

let planOstatnio = 0;
let planZajety = false;

/** Średnia jasność kadru (0–1) — pomiar sceny, nie zgadywanka z pory dnia.
 *  Próbkujemy co dziesiąty piksel: różnica w wyniku żadna, a koszt dziesięć
 *  razy mniejszy przy klatce co sekundę. */
function jasnoscKadru(canvas) {
  try {
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let suma = 0;
    let ile = 0;
    for (let i = 0; i < d.length; i += 40) {
      suma += (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
      ile++;
    }
    return ile ? suma / ile : null;
  } catch { return null; }
}

/** Odśwież plan zdjęciowy z bieżącego kadru. Rzadziej niż detekcja obiektów —
 *  światło zmienia się w minutach, nie w klatkach. */
async function odswiezPlan(cap) {
  const box = $('plan-box');
  if (!box || box.hidden) return;
  if (planZajety || Date.now() - planOstatnio < 8000) return;
  planZajety = true;
  planOstatnio = Date.now();
  try {
    const trybPola = $('plan-mode').value;
    const wideo = trybPola.startsWith('wideo');
    const dane = {
      sprzet: $('plan-gear').value,
      tryb: wideo ? 'wideo' : 'zdjecie',
      klatki: trybPola === 'wideo50' ? 50 : 25,
      // Puste = „weź z prognozy". Wybór ręczny wygrywa, bo stojąc na miejscu
      // widzisz niebo lepiej niż model pogodowy dla kwadratu kilometra.
      ...( $('plan-sky').value ? { zachmurzenie: $('plan-sky').value } : {} ),
      szerokosc: cap ? cap.width : 0,
      wysokosc: cap ? cap.height : 0,
    };
    const j = cap ? jasnoscKadru(cap) : null;
    if (j !== null) dane.jasnosc = j;
    const r = await fetch('/api/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dane),
    });
    const d = await readJsonSafe(r);
    if (!r.ok) {
      $('plan-shot').textContent = '—';
      $('plan-light').textContent = d.error || t('plan.needLocation');
      $('plan-why').textContent = '';
      return;
    }
    pokazPlan(d);
  } catch { /* offline — panel zostaje z poprzednim wynikiem */ } finally {
    planZajety = false;
  }
}

/* Wypisz policzony plan. `pre` to przedrostek identyfikatorów, bo plan
   pokazuje się w DWÓCH miejscach: pod podglądem kamery (`plan-*`, liczony
   z jasności bieżącej klatki) i w Plenerze (`fp-*`, liczony dla miejsca
   i godziny, bez kamery). Treść jest ta sama, więc kod też jest jeden —
   dwie kopie tej samej funkcji rozjechałyby się przy pierwszej poprawce. */
function pokazPlan(d, pre = 'plan') {
  const u = d.ustawienia;
  $(pre + '-shot').textContent = `${u.czas} · ${u.przyslona} · ISO ${u.iso}`;

  const czesci = [];
  if (d.kadr && d.kadr.uklad !== 'nieznany') czesci.push(`${d.kadr.uklad} ${d.kadr.proporcje}`);
  czesci.push(`${d.slonce.faza} (${d.slonce.wysokosc}°)`);
  // Pogoda tylko wtedy, gdy naprawdę przyszła z prognozy — przy wyborze
  // ręcznym powtarzanie tego, co użytkownik sam ustawił, jest szumem.
  if (d.pogoda) {
    czesci.push(`${d.pogoda.opis}`
      + (d.pogoda.temperatura !== null ? ` ${Math.round(d.pogoda.temperatura)}°C` : '')
      + (d.pogoda.opadyProc > 30 ? ` · opady ${d.pogoda.opadyProc}%` : ''));
  }
  const light = $(pre + '-light');
  light.textContent = czesci.join(' · ');

  /* Ile zostało czasu — to jedyna liczba, na którą patrzy się w terenie.
     Gdy złota godzina trwa TERAZ, mówimy to wprost zamiast pokazywać
     ujemne minuty do jej początku. */
  const zloty = d.slonce.doZlotejMin;
  const zachod = d.slonce.doZachoduMin;
  const czas = document.createElement('span');
  czas.className = 'plan-urgent';
  if (d.slonce.faza === 'złota godzina') {
    czas.textContent = ` · ${t('plan.goldenNow')}`
      + (zachod > 0 ? `, ${t('plan.toSunset', { n: zachod })}` : '');
  } else if (zloty > 0) {
    czas.textContent = ` · ${t('plan.toGolden', { n: zloty })}`;
  } else if (zachod > 0) {
    czas.textContent = ` · ${t('plan.toSunset', { n: zachod })}`;
  }
  if (czas.textContent) light.appendChild(czas);

  const why = $(pre + '-why');
  why.innerHTML = '';
  for (const p of u.powody) {
    const el = document.createElement('p');
    el.textContent = p;
    why.appendChild(el);
  }

  // Ostatnie POLICZONE nastawy — z nich bierze wartości przycisk „Ustaw w aparacie".
  planOstatnieUstawienia = u;
  odswiezAparat(u);
}

let planOstatnieUstawienia = null;

/* ---- APARAT PO WI-FI (Canon CCAPI) ------------------------------------
   Sedno nie jest w tym, że da się zdalnie zmienić ISO. Sedno jest w tym, że
   Cosmos przestaje mówić „ustaw 1/250, f/8, ISO 200", a zaczyna mówić „masz
   1/60, f/4, ISO 1600 — poprawiam". Do tego musi ZOBACZYĆ, co aparat ma
   naprawdę ustawione, i porównać z tym, co sam policzył dla tego światła.

   Wiersz pokazuje się dopiero, gdy aparat odpowiada. Martwy przycisk
   „Ustaw w aparacie" u kogoś, kto nigdy nie włączył CCAPI, byłby gorszy niż
   jego brak — obiecywałby coś, czego nie ma. */
let aparatStan = null;
let aparatSprawdzony = 0;
const APARAT_CACHE_MS = 30000;

async function odswiezAparat(policzone) {
  const wiersz = $('plan-camera');
  if (!wiersz) return;
  /* Wiersz aparatu mieszka w Plenerze. Odpytywanie go przy zamkniętym oknie
     to dwa żądania do aparatu co osiem sekund przez cały czas otwartego
     podglądu — do niczego, a aparat i tak zasypia po Wi-Fi. */
  if ($('plener-modal').style.display === 'none') return;

  if (Date.now() - aparatSprawdzony > APARAT_CACHE_MS) {
    aparatSprawdzony = Date.now();
    try { aparatStan = await (await fetch('/api/canon/status')).json(); }
    catch { aparatStan = null; }
  }
  if (!aparatStan || !aparatStan.online) {
    // Nieskonfigurowany aparat chowamy zupełnie; skonfigurowany, ale
    // niedostępny — pokazujemy z powodem, bo to stan do naprawienia.
    wiersz.hidden = !(aparatStan && aparatStan.skonfigurowany);
    if (!wiersz.hidden) {
      $('plan-camera-now').textContent = String((aparatStan && aparatStan.powod) || '').slice(0, 120);
      $('plan-camera-now').className = 'plan-camera-off';
      $('plan-camera-apply').hidden = true;
    }
    return;
  }

  wiersz.hidden = false;
  $('plan-camera-apply').hidden = false;
  try {
    const w = await (await fetch('/api/canon/settings')).json();
    const n = w.nastawy || {};
    const teraz = [n.czas, n.przyslona && `f/${String(n.przyslona).replace(/^f/i, '')}`,
      n.iso && `ISO ${n.iso}`].filter(Boolean).join(' · ') || '—';
    const el = $('plan-camera-now');
    el.className = '';
    el.textContent = `${aparatStan.model || t('plan.camera')}: ${teraz}`;
    /* Zgodność liczymy, a nie porównujemy napisy: „1/250" z aparatu i 0,004 s
       z planu to ta sama wartość zapisana inaczej. Różnica poniżej jednej
       trzeciej działki jest w praktyce nieodróżnialna na zdjęciu. */
    const l = w.liczby || {};
    if (policzone && l.iso && policzone.iso) {
      const dzialki = Math.abs(Math.log2(l.iso / policzone.iso));
      if (dzialki > 0.34) el.textContent += ` · ${t('plan.mismatch')}`;
    }
  } catch {
    $('plan-camera-now').textContent = t('plan.cameraErr');
    $('plan-camera-now').className = 'plan-camera-off';
  }
}

$('plan-camera-apply').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  const u = planOstatnieUstawienia;
  if (!u) return;
  b.disabled = true;
  const pierwotny = b.textContent;
  b.textContent = t('plan.applying');
  try {
    const r = await fetch('/api/canon/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        iso: u.iso ? String(u.iso) : '',
        // Aparat oczekuje swojego zapisu: „f4.0" i „1/250", nie liczb.
        przyslona: u.przyslona ? String(u.przyslona).replace('f/', 'f') : '',
        czas: u.czas || '',
      }),
    });
    const d = await readJsonSafe(r);
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    aparatSprawdzony = 0;
    await odswiezAparat(u);
  } catch (err) {
    $('plan-camera-now').textContent = t('plan.applyErr', { msg: err.message });
    $('plan-camera-now').className = 'plan-camera-off';
  } finally {
    b.disabled = false;
    b.textContent = pierwotny;
  }
});

/* Migawka. Świadomie TYLKO pod ludzkim palcem — model tego narzędzia nie
   dostaje. „Zrób zdjęcie, bo wygląda na dobry moment" jest dokładnie tą
   klasą decyzji, której maszyna nie powinna podejmować za człowieka
   trzymającego aparat. */
$('plan-camera-shutter').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  const pierwotny = b.textContent;
  try {
    const r = await fetch('/api/canon/shutter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const d = await readJsonSafe(r);
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    b.textContent = t('pl.shutterOk');
  } catch (err) {
    $('plan-camera-now').textContent = t('plan.applyErr', { msg: err.message });
    $('plan-camera-now').className = 'plan-camera-off';
  } finally {
    setTimeout(() => { b.textContent = pierwotny; b.disabled = false; }, 900);
  }
});

for (const id of ['plan-gear', 'plan-mode', 'plan-sky']) {
  const el = $(id);
  // Zmiana ustawienia ma dać odpowiedź od razu, a nie po ośmiu sekundach.
  if (el) el.addEventListener('change', () => { planOstatnio = 0; odswiezPlan(null); });
}

/* ============================== PLENER ==============================
   Foto i wideo jako jedno miejsce, a nie pięć.

   Powód wydzielenia jest rzeczowy, nie porządkowy. Te funkcje wyrosły
   przez ostatnie partie do rozmiaru osobnego programu, a mieszkały tak:
   sprzęt i archiwum w Ustawieniach, plan zdjęciowy w podpanelu podglądu
   kamery (czyli niedostępny bez włączonej kamery), aparat po Wi-Fi jako
   wiersz w tamtym podpanelu, ptaki w nakładce głosowej, a misja KMZ
   i karty ujęć — nigdzie. Te dwie ostatnie dało się uruchomić wyłącznie
   żądaniem HTTP albo przez model. To nie jest funkcja, której nie ma;
   to funkcja, o której nie sposób się dowiedzieć.

   Plan liczy się TU bez kamery: dla nazwy miejsca i dla wybranej godziny.
   To jest ta różnica, na której zależy najbardziej — „co zabrać w sobotę
   do Krakowa na 18:30" to inne pytanie niż „co ustawić w tej chwili”. */

function otworzPlener() {
  wczytajSprzet();
  odswiezArchiwum();
  $('plener-modal').style.display = '';
  // Aparat sprawdzamy przy otwarciu, nie w tle — patrz `odswiezAparat`.
  aparatSprawdzony = 0;
  odswiezAparat(planOstatnieUstawienia);
  /* Plan liczymy przy KAŻDYM otwarciu, nie tylko pierwszym. Puste okno
     z przyciskiem „Policz" kazałoby klikać po to, co i tak zawsze chcemy
     zobaczyć, a plan sprzed godziny jest już nieprawdą — Słońce się
     przesunęło, a to jest cała treść tego panelu. */
  liczPlanPlener();
}

function zamknijPlener() { $('plener-modal').style.display = 'none'; }

$('plener-btn').addEventListener('click', otworzPlener);
$('plener-close').addEventListener('click', zamknijPlener);
$('plener-modal').addEventListener('click', (e) => {
  if (e.target === $('plener-modal')) zamknijPlener();
});
$('set-open-plener').addEventListener('click', () => { closeSettings(); otworzPlener(); });

/* ---- sprzęt ---- */
$('gear-save').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  const stan = $('gear-status');
  b.disabled = true;
  stan.className = 'field-hint';
  try {
    await zapiszSprzet();
    stan.textContent = t('pl.gearSaved');
    setTimeout(() => { stan.textContent = ''; }, 2500);
    // Zestaw wpływa na ujęcia i na nastawy — plan po zapisie jest nieaktualny.
    liczPlanPlener();
  } catch (err) {
    // Nieudany zapis ZOSTAJE na ekranie — inaczej człowiek wychodzi
    // przekonany, że sprzęt jest wpisany, a plan liczy dla domyślnego korpusu.
    stan.className = 'field-hint plener-err';
    stan.textContent = t('pl.gearErr', { msg: err.message });
  } finally {
    b.disabled = false;
  }
});

/* ---- plan ---- */
let plenerZajety = false;
let plenerPonow = false;

async function liczPlanPlener() {
  /* Zajęte = przelicz PO powrocie, a nie „odpuść". Zwykłe `return` znaczyło,
     że przy szybkiej zmianie dwóch list na ekranie zostaje wynik dla pierwszej
     — i to bez żadnego znaku, że coś przepadło. */
  if (plenerZajety) { plenerPonow = true; return; }
  plenerZajety = true;
  const przycisk = $('fp-go');
  przycisk.disabled = true;
  try {
    const trybPola = $('fp-mode').value;
    const wideo = trybPola.startsWith('wideo');
    const dane = {
      tryb: wideo ? 'wideo' : 'zdjecie',
      klatki: trybPola === 'wideo50' ? 50 : 25,
    };
    // Puste pola znaczą „weź to, co zapisane" — i muszą NIE trafić do żądania,
    // bo pusty napis to dla serwera podana wartość, a nie jej brak.
    if ($('fp-gear').value) dane.sprzet = $('fp-gear').value;
    if ($('fp-sky').value) dane.zachmurzenie = $('fp-sky').value;
    if ($('fp-place').value.trim()) dane.miejsce = $('fp-place').value.trim();
    if ($('fp-topic').value.trim()) dane.temat = $('fp-topic').value.trim();
    if ($('fp-when').value) {
      const kiedy = new Date($('fp-when').value);
      if (!Number.isNaN(kiedy.getTime())) dane.kiedy = kiedy.toISOString();
    }
    const r = await fetch('/api/plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dane),
    });
    const d = await readJsonSafe(r);
    if (!r.ok) {
      $('fp-shot').textContent = '—';
      $('fp-light').textContent = d.error || t('plan.needLocation');
      $('fp-why').textContent = '';
      $('fp-shots').innerHTML = '';
      return;
    }
    pokazPlan(d, 'fp');
    pokazUjecia(d.ujecia);
    // Misja dostaje współrzędne z planu — przepisywanie ich z mapy do dwóch
    // pól to najprostszy sposób na literówkę w miejscu, w którym boli.
    /* Współrzędne misji idą za planem, chyba że wpisano je RĘCZNIE.

       Pierwsza wersja uzupełniała je tylko wtedy, gdy oba pola były puste —
       i to była cicha, groźna usterka. Panel liczy plan zaraz po otwarciu,
       jeszcze dla zapisanej lokalizacji, więc pola wypełniały się domem.
       Potem człowiek wpisywał „Zakopane", przeliczał plan — a w misji dalej
       siedziały współrzędne domu, bo pola nie były już puste. Wychodził
       z tego plik lotu nad zupełnie innym miejscem i nic tego nie zdradzało.
       W narzędziu, które steruje dronem, to najgorszy możliwy rodzaj błędu. */
    plenerWspolrzedne = d.wspolrzedne || null;
    plenerMiejsce = d.miejsce || null;
    if (plenerWspolrzedne && !misjaReczna) wstawWspolrzedne();
    opiszZrodloMisji();
  } catch {
    $('fp-light').textContent = t('offline.title');
  } finally {
    przycisk.disabled = false;
    plenerZajety = false;
    if (plenerPonow) { plenerPonow = false; liczPlanPlener(); }
  }
}

$('fp-go').addEventListener('click', liczPlanPlener);
$('fp-now').addEventListener('click', () => { $('fp-when').value = ''; liczPlanPlener(); });
for (const id of ['fp-gear', 'fp-mode', 'fp-sky']) {
  $(id).addEventListener('change', liczPlanPlener);
}
for (const id of ['fp-place', 'fp-topic']) {
  // Enter w polu tekstowym ma liczyć — inaczej trzeba sięgać po przycisk.
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') liczPlanPlener(); });
}
$('fp-when').addEventListener('change', liczPlanPlener);

/* Karty ujęć — lista pozycji do odhaczenia, z liczbami. POMINIĘTE pokazujemy
   równie wyraźnie: „nie masz czym" to inna informacja niż „nie ma na liście",
   a bez niej wygląda, jakby Cosmos o dronie zapomniał. */
/* Odhaczone ujęcia. Trzymane w przeglądarce, nie na serwerze, i to jest
   przemyślane: „nakręciłem" to stan JEDNEGO dnia zdjęciowego na JEDNYM
   urządzeniu, a nie fakt o Marcinie wart miejsca w pamięci Cosmosa.
   Klucz zawiera temat, więc powrót do tego samego planu wraca też do postępu,
   a zmiana tematu zaczyna listę od nowa. */
const KLUCZ_ODHACZONE = 'cosmos.ujecia.';
function odhaczone(temat) {
  try { return new Set(JSON.parse(localStorage.getItem(KLUCZ_ODHACZONE + temat) || '[]')); }
  catch { return new Set(); }
}
function zapiszOdhaczone(temat, zbior) {
  try { localStorage.setItem(KLUCZ_ODHACZONE + temat, JSON.stringify([...zbior])); }
  catch { /* prywatne okno albo pełny dysk — lista działa dalej, tylko bez pamięci */ }
}

function pokazUjecia(u) {
  const box = $('fp-shots');
  box.innerHTML = '';
  if (!u || !Array.isArray(u.ujecia) || !u.ujecia.length) return;

  const temat = ($('fp-topic').value.trim() || '—').toLowerCase().slice(0, 40);
  const zrobione = odhaczone(temat);

  const tytul = document.createElement('div');
  tytul.className = 'plener-shots-title';
  const licznik = document.createElement('span');
  const odswiezLicznik = () => {
    licznik.textContent = t('pl.shots', { n: u.ujecia.length })
      + (zrobione.size ? ` — ${t('pl.done', { n: zrobione.size })}` : '');
  };
  odswiezLicznik();
  const wyczysc = document.createElement('button');
  wyczysc.type = 'button';
  wyczysc.className = 'plener-clear';
  wyczysc.textContent = t('pl.clearTicks');
  wyczysc.addEventListener('click', () => {
    zrobione.clear();
    zapiszOdhaczone(temat, zrobione);
    pokazUjecia(u);
  });
  tytul.append(licznik, wyczysc);
  box.appendChild(tytul);

  for (const s of u.ujecia) {
    const kar = document.createElement('div');
    kar.className = 'plener-shot' + (zrobione.has(s.klucz) ? ' zrobione' : '');

    const glowa = document.createElement('div');
    glowa.className = 'plener-shot-head';
    /* Odhaczanie jest sensem listy — „lista do odhaczenia" bez sposobu
       odhaczenia byłaby obietnicą na wyrost. W terenie zaznacza się to
       palcem, na telefonie, więc pole leży w nagłówku karty. */
    const ptaszek = document.createElement('input');
    ptaszek.type = 'checkbox';
    ptaszek.className = 'plener-tick';
    ptaszek.checked = zrobione.has(s.klucz);
    ptaszek.setAttribute('aria-label', s.nazwa);
    ptaszek.addEventListener('change', () => {
      ptaszek.checked ? zrobione.add(s.klucz) : zrobione.delete(s.klucz);
      zapiszOdhaczone(temat, zrobione);
      kar.classList.toggle('zrobione', ptaszek.checked);
      odswiezLicznik();
    });
    const nazwa = document.createElement('span');
    nazwa.className = 'plener-shot-name';
    nazwa.textContent = s.nazwa;
    /* Rola ujęcia na wierzchu. Bez niej lista wygląda jak worek pomysłów
       i dopiero po chwili widać, że są w niej trzy otwarcia i zero zakończeń
       — co dokładnie się zdarzyło i dopiero człowiek to wyłapał. */
    const rola = document.createElement('span');
    rola.className = 'plener-shot-role rola-' + (s.rola || 'rozwiniecie');
    rola.textContent = s.rolaOpis || '';
    const liczby = document.createElement('span');
    liczby.className = 'plener-shot-nums mono';
    liczby.textContent = `${s.ogniskowa} mm · ${s.sekund[0]}-${s.sekund[1]} s`;
    glowa.append(ptaszek, nazwa, rola, liczby);

    const ruch = document.createElement('div');
    ruch.className = 'plener-shot-move';
    ruch.textContent = s.ruch + (s.naSzkle ? ` · ${s.naSzkle}` : '');

    const jak = document.createElement('div');
    jak.className = 'plener-shot-how';
    jak.textContent = s.jak;

    const poco = document.createElement('div');
    poco.className = 'plener-shot-why';
    poco.textContent = s.poCo;

    kar.append(glowa, ruch, jak, poco);
    box.appendChild(kar);
  }

  if (u.pominiete && u.pominiete.length) {
    const p = document.createElement('div');
    p.className = 'plener-skipped';
    p.textContent = t('pl.skipped') + ' '
      + u.pominiete.map((x) => `${x.nazwa} (${x.powod})`).join('; ');
    box.appendChild(p);
  }
}

/* ---- misja drona ---- */
let plenerWspolrzedne = null;
let plenerMiejsce = null;
let misjaReczna = false;

function wstawWspolrzedne() {
  if (!plenerWspolrzedne) return;
  $('mis-lat').value = Number(plenerWspolrzedne.lat).toFixed(5);
  $('mis-lon').value = Number(plenerWspolrzedne.lon).toFixed(5);
}

/* Skąd są te współrzędne — napisane wprost pod polami. Dwie liczby same
   z siebie nie mówią, czy to Zakopane, czy dom; a różnicy nie widać, dopóki
   dron nie stoi w polu. */
function opiszZrodloMisji() {
  const el = $('mis-skad');
  if (!el) return;
  if (misjaReczna) { el.textContent = t('pl.misManual'); el.className = 'field-hint plener-warn'; return; }
  el.className = 'field-hint';
  el.textContent = plenerWspolrzedne
    ? t('pl.misFromPlan', { miejsce: plenerMiejsce || `${Number(plenerWspolrzedne.lat).toFixed(3)}, ${Number(plenerWspolrzedne.lon).toFixed(3)}` })
    : '';
}

for (const id of ['mis-lat', 'mis-lon']) {
  // Ręczny wpis wygrywa z planem — ale tylko dopóki człowiek go nie cofnie.
  $(id).addEventListener('input', () => {
    misjaReczna = Boolean($('mis-lat').value || $('mis-lon').value);
    opiszZrodloMisji();
  });
}

$('mis-here').addEventListener('click', () => {
  misjaReczna = false;
  if (!plenerWspolrzedne) { liczPlanPlener(); return; }
  wstawWspolrzedne();
  opiszZrodloMisji();
});

/* ILE TO WŁAŚCIWIE LOTU — policzone PRZED pobraniem pliku.
 *
 * Pola „200 × 200, co 50 m" nie mówią nic o tym, czy to trzy minuty, czy
 * czterdzieści. A różnica jest zasadnicza: misja dłuższa niż jedna bateria
 * przerwie się w połowie, dron wróci do domu, a człowiek dowie się o tym
 * stojąc w polu. Liczba linii i długość trasy wychodzą z tych samych wzorów
 * co `siatka()` w lib/kmz.js — zestaw `plener` porównuje jedno z drugim,
 * żeby nie rozjechały się przy pierwszej poprawce. */
const MAVIC_MINUT = 18;      // realny zapas na misję, z rezerwą na powrót

function oszacujNalot() {
  const szer = Number($('mis-w').value) || 0;
  const dl = Number($('mis-l').value) || 0;
  const odstep = Number($('mis-odstep').value) || 0;
  const predkosc = Number($('mis-speed').value) || 0;
  if (!(szer > 0 && dl > 0 && odstep > 0 && predkosc > 0)) return null;
  const linii = Math.max(2, Math.ceil(szer / odstep) + 1);
  const metry = linii * dl + (linii - 1) * odstep;
  // +15% na zakręty i rozpędzanie — dron nie leci całej trasy z prędkością zadaną.
  const minuty = (metry / predkosc) * 1.15 / 60;
  return { linii, punktow: linii * 2, metry, minuty };
}

function pokazNalot() {
  const el = $('mis-lot');
  if (!el) return;
  const o = oszacujNalot();
  if (!o) { el.textContent = ''; return; }
  /* Separator dziesiętny z lokalizacji przeglądarki, nie na sztywno kropka.
     Pola współrzędnych (`type=number`) i tak pokazują polski przecinek, więc
     „1.20 km" tuż pod „49,29691" wyglądało jak dwie różne aplikacje. */
  const km = (o.metry / 1000).toLocaleString(undefined,
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const czesci = [t('pl.misLines', { n: o.linii, p: o.punktow }),
    t('pl.misDist', { km }),
    t('pl.misTime', { min: Math.round(o.minuty) })];
  el.className = 'field-hint';
  el.textContent = czesci.join(' · ');
  /* Dwa progi, oba twarde. 99 punktów to limit formatu WPML — powyżej plik
     i tak zostanie odrzucony, więc lepiej powiedzieć to teraz niż w polu. */
  if (o.punktow > 99) {
    el.className = 'field-hint plener-err';
    el.textContent += ' — ' + t('pl.misTooMany');
  } else if (o.minuty > MAVIC_MINUT) {
    el.className = 'field-hint plener-warn';
    el.textContent += ' — ' + t('pl.misTooLong', { min: MAVIC_MINUT });
  }
}

for (const id of ['mis-w', 'mis-l', 'mis-odstep', 'mis-speed']) {
  $(id).addEventListener('input', pokazNalot);
}
pokazNalot();

$('mis-go').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  const out = $('mis-out');
  const lat = Number($('mis-lat').value);
  const lon = Number($('mis-lon').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    out.textContent = t('pl.misNoCoords');
    out.className = 'plener-out mono plener-err';
    return;
  }
  b.disabled = true;
  out.className = 'plener-out mono';
  out.textContent = t('pl.misWorking');
  try {
    const r = await fetch('/api/plan/mission', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat, lon,
        szerokoscM: Number($('mis-w').value) || 200,
        dlugoscM: Number($('mis-l').value) || 200,
        odstepM: Number($('mis-odstep').value) || 50,
        kierunek: Number($('mis-kier').value) || 0,
        wysokosc: Number($('mis-alt').value) || 80,
        predkosc: Number($('mis-speed').value) || 6,
        nazwa: $('mis-name').value.trim() || 'misja',
      }),
    });
    if (!r.ok) {
      const d = await readJsonSafe(r);
      throw new Error(d.error || `HTTP ${r.status}`);
    }
    const blob = await r.blob();
    /* Pobranie przez tymczasowy odsyłacz: żądanie jest POST-em, więc zwykły
       link nie wystarczy, a otwarcie w nowej karcie zostawiłoby pustą kartę. */
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${($('mis-name').value.trim() || 'misja').replace(/[^\w-]+/g, '-')}.kmz`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    out.textContent = t('pl.misDone', { kb: (blob.size / 1024).toFixed(1) });
  } catch (err) {
    out.textContent = err.message;
    out.className = 'plener-out mono plener-err';
  } finally {
    b.disabled = false;
  }
});

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
        if (!confirm(t('kb.confirmDel', { name: item.name }))) return;
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
  clearTimeout(nasluchCisza);
  clearTimeout(odzyskiwanieMikrofonu);
  odzyskiwanieMikrofonu = null;
  nasluchAwarie = 0;
  voiceHeard = '';
  voiceDeaf = false;
  if (nasluch) { nasluch.stop(); nasluch = null; }
  if (voiceRec) {
    voiceRec.onend = null;          // bez tego wznowiłby się sam
    voiceRec.onresult = null;
    voiceRec.onerror = null;
    try { voiceRec.stop(); } catch { /* już zatrzymany */ }
    voiceRec = null;
  }
}

async function enterVoiceMode() {
  // Dwa silniki, dwa różne wymagania. Brak Web Speech API nie przekreśla
  // trybu głosowego, jeśli działa własny nasłuch z Whisperem — a to właśnie
  // przypadek Firefoksa i Safari, gdzie rozpoznawania mowy po prostu nie ma.
  if (!getSR() && !nasluchMozliwy()) {
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

/* ---- „Kto to śpiewa?" — BirdNET z nakładki głosowej -------------------
   Ptaka słychać dużo dalej, niż go widać, i to słuch decyduje, gdzie postawić
   statyw. Nagranie idzie bez „ulepszaczy" dźwięku i w pełnej częstotliwości:
   redukcja szumu w telefonie wycina dokładnie te ciche, wysokie tony, które
   są tu całą treścią. */
const PTAK_SEKUND = 8;
// Drugie kliknięcie w trakcie nagrania otwierałoby DRUGI strumień z tego samego
// mikrofonu. Część urządzeń po prostu odmawia, reszta oddaje cichsze nagranie.
let ptakTrwa = false;

async function rozpoznajPtaka() {
  if (ptakTrwa) return;
  if (!(window.NasluchWlasny && window.NasluchWlasny.dostepny())) {
    el.voiceAnswer.textContent = t('voice.birdNoAudio');
    return;
  }
  if (!(senses.online && senses.caps.birdnet)) {
    el.voiceAnswer.textContent = t('voice.birdNoSenses');
    return;
  }
  // Mikrofon jest zajęty przez nasłuch ciągły — zwalniamy go na czas nagrania
  // i wracamy do nasłuchu potem. Dwa strumienie z tego samego wejścia bywają
  // odrzucane, a na telefonie dają cichsze, gorsze nagranie.
  ptakTrwa = true;
  const bylNasluch = Boolean(nasluch);
  if (nasluch) { nasluch.stop(); nasluch = null; }
  stopSpeaking();
  setVoiceState('listening');
  el.voiceTranscript.textContent = '';

  try {
    let zostalo = PTAK_SEKUND;
    el.voiceAnswer.textContent = t('voice.birdRec', { s: zostalo });
    const tik = setInterval(() => {
      zostalo--;
      if (zostalo >= 0) el.voiceAnswer.textContent = t('voice.birdRec', { s: zostalo });
    }, 1000);
    let blob;
    try {
      blob = await window.NasluchWlasny.nagrajWav(PTAK_SEKUND * 1000, { czestotliwosc: 48000 });
    } finally {
      clearInterval(tik);
    }

    el.voiceAnswer.textContent = t('voice.birdThinking');
    const res = await fetch('/api/ptak', {
      method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: blob,
    });
    const dane = await readJsonSafe(res);
    if (!res.ok) throw new Error(dane.error || `HTTP ${res.status}`);

    const lista = Array.isArray(dane.gatunki) ? dane.gatunki : [];
    if (!lista.length) {
      el.voiceAnswer.textContent = t('voice.birdNone');
      setVoiceState('speaking');
      await speakText(t('voice.birdNone'));
    } else {
      const opis = lista
        .map((g) => `${g.nazwa || g.lacinska} — ${Math.round((g.pewnosc || 0) * 100)}%`)
        .join(' · ');
      el.voiceAnswer.textContent = opis;
      setVoiceState('speaking');
      const pierwszy = lista[0];
      await speakText(t('voice.birdFound', {
        nazwa: pierwszy.nazwa || pierwszy.lacinska,
        proc: Math.round((pierwszy.pewnosc || 0) * 100),
      }));
    }
  } catch (err) {
    el.voiceAnswer.textContent = t('voice.birdErr', { msg: err.message });
  } finally {
    ptakTrwa = false;
    if (voiceMode) {
      if (bylNasluch) backToWake();
      else setVoiceState('wake');
    }
  }
}

$('voice-bird-btn').addEventListener('click', rozpoznajPtaka);

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
/* Znacznik „to już przerobiliśmy”. Samo `voiceDeaf` nie wystarczało i to była
   przyczyna sprzężenia: rozpoznawacz jest CIĄGŁY, więc kiedy Cosmos mówi,
   dalej transkrybuje — tyle że my wyniki ignorujemy. Zostają jednak w
   `e.results`, a gałąź słowa budzącego czytała trzy OSTATNIE wyniki niezależnie
   od tego, czy były już widziane. Po skończonej wypowiedzi Cosmos odczytywał
   więc własne zdanie jako nowe polecenie i odpowiadał sam sobie w kółko.
   Teraz wszystko, co padło w czasie głuchoty, jest z góry oznaczone jako
   zużyte.

   Sam indeks to jednak za mało, bo NIE JEST STAŁYM PUNKTEM ODNIESIENIA.
   Rozpoznawacz potrafi zacząć numerować od zera bez `onend` — Chrome robi tak
   po dłuższej ciszy, a na Androidzie po każdej domkniętej wypowiedzi. Znacznik
   zostawał wtedy w górze, świeże wyniki wypadały poniżej niego i pytanie
   znikało bez śladu: transkrypcja pusta, cisza nie miała czego wysłać.
   Dlatego obok indeksu trzymamy ODCISK ostatniego zużytego wyniku. Jeśli lista
   nie urosła ponad znacznik, a tego wyniku już w niej nie ma — numeracja
   ruszyła od nowa i znacznik trzeba wyzerować. */
let voiceZuzyteDo = 0;
let voiceOdcisk = '';
// Co Cosmos ostatnio powiedział — druga zapora przed pętlą.
let voiceOstatniaOdpowiedz = '';

/* ---- DRUGI SILNIK NASŁUCHU: własny strumień + Whisper ----------------
   Cała gimnastyka powyżej (znaczniki zużycia, odciski wyników, wykrywanie
   restartu numeracji) istnieje dlatego, że Web Speech API nie da się
   wyciszyć ani zatrzymać bez zwolnienia mikrofonu. `public/nasluch.js`
   rozwiązuje to u źródła: mikrofon otwarty raz na całą sesję, wypowiedzi
   wycinane z sygnału po energii, tekst z Whispera. Wtedy „głuchy" znaczy
   naprawdę głuchy — próbki lecą do kosza i nie ma czego rozpoznać.

   Wymaga włączonych zmysłów, więc to WYBÓR, nie zamiennik. Przy wyłączonym
   komputerze domowym Cosmos wraca do Web Speech API bez pytania. */
let nasluch = null;            // instancja NasluchWlasny albo null
let nasluchCisza = null;       // powrót do nasłuchu słowa budzącego po ciszy
const NASLUCH_CISZA_MS = 9000;

function nasluchMozliwy() {
  return Boolean(window.NasluchWlasny && window.NasluchWlasny.dostepny()
    && senses.online && senses.caps.whisper);
}

/** 'whisper' albo 'przegladarka'. Wybór z Ustawień; `auto` bierze Whispera,
 *  gdy zmysły są pod ręką, bo to on rozwiązuje problem sprzężenia. */
function silnikNasluchu() {
  const wybor = localStorage.getItem('cosmos.sttEngine') || 'auto';
  if (wybor === 'przegladarka') return 'przegladarka';
  return nasluchMozliwy() ? 'whisper' : 'przegladarka';
}

/** Ograniczenia dla nasłuchu ciągłego. Echo cancellation jest tu KLUCZOWE:
 *  na telefonie głośnik gra wprost do mikrofonu i choć „głuchy" wyrzuca te
 *  próbki, po zakończeniu wypowiedzi Cosmosa ogon zdania potrafi jeszcze
 *  wpaść w otwarte okno. */
function nasluchOgraniczenia() {
  const id = localStorage.getItem('cosmos.micId') || '';
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  if (id) audio.deviceId = { exact: id };
  return { audio };
}

/* Ile razy pod rząd Whisper może zawieść, zanim wrócimy do przeglądarki.
   Jeden błąd to przypadek — GPU zajęte innym zadaniem, chwilowa dziura
   w Tailscale. Trzy pod rząd znaczą, że zmysłów po prostu nie ma, a wtedy
   trwanie przy Whisperze to skazanie trybu głosowego na milczenie. */
const NASLUCH_PROG_AWARII = 3;
let nasluchAwarie = 0;

function startNasluchWlasny() {
  if (nasluch) { nasluch.gluchy(voiceDeaf); return; }
  nasluch = window.NasluchWlasny.utworz({
    onWypowiedz: (tekst) => { nasluchAwarie = 0; wypowiedzZNasluchu(tekst); },
    onBlad: (err) => {
      // Awaria transkrypcji nie kończy trybu głosowego — następna wypowiedź
      // może się udać (zmysły wstają, GPU zwalnia się po innym zadaniu).
      el.voiceTranscript.textContent = t('voice.sttErr', { msg: err.message });
      if (++nasluchAwarie < NASLUCH_PROG_AWARII) return;
      /* Trzeci raz z rzędu. Przeglądarkowe rozpoznawanie jest gorsze, ale
         DZIAŁA — a Cosmos, który w kółko powtarza ten sam błąd, jest po
         prostu zepsuty. Zmiana jest jawna: człowiek musi wiedzieć, czemu
         nagle zmieniło się zachowanie. */
      nasluchAwarie = 0;
      localStorage.setItem('cosmos.sttEngine', 'przegladarka');
      if (nasluch) { nasluch.stop(); nasluch = null; }
      el.voiceTranscript.textContent = t('voice.sttFallback');
      if (voiceMode) startVoiceRecognizer();
    },
    onCisza: (powod) => zaradzGluchocie(powod),
  });
  nasluch.gluchy(voiceDeaf);
  nasluch.start(nasluchOgraniczenia()).catch(async (err) => {
    nasluch = null;
    /* Zapamiętany mikrofon mógł zostać odłączony — tak samo jak przy
       dyktowaniu, spróbuj domyślnego, zanim ogłosisz porażkę. */
    if (localStorage.getItem('cosmos.micId')) {
      localStorage.removeItem('cosmos.micId');
      startNasluchWlasny();
      return;
    }
    el.voiceTranscript.textContent = t('voice.micDenied', { msg: err.message });
    voiceMode = false;
  });
}

/* ---- CICHA GŁUCHOTA I CO Z NIĄ ZROBIĆ --------------------------------
   Najgorsza awaria trybu głosowego nie jest głośna: mikrofon przestaje dawać
   próbki, a ekran dalej pokazuje „SŁUCHAM…". Marcin mówi do telefonu i nie
   ma pojęcia, dlaczego nic się nie dzieje. `nasluch.js` wykrywa ten stan
   z trzech stron (stan kontekstu, zdarzenia ścieżki, licznik od ostatniej
   ramki) — tutaj jest odpowiedź na pytanie, co dalej.

   Najpierw PRÓBUJEMY ODZYSKAĆ, bo dwie z trzech przyczyn (uśpiony dźwięk po
   wygaszeniu ekranu, mikrofon oddany na czas rozmowy telefonicznej) mijają
   same i wystarczy wziąć wejście od nowa. Dopiero gdy to nie pomoże, mówimy
   wprost — jedna próba, nie pętla wznowień co dwie sekundy. */
let odzyskiwanieMikrofonu = null;

function zaradzGluchocie(powod) {
  if (!voiceMode || odzyskiwanieMikrofonu) return;
  el.voiceTranscript.textContent = t('voice.micLost', { powod });
  odzyskiwanieMikrofonu = setTimeout(async () => {
    odzyskiwanieMikrofonu = null;
    if (!voiceMode || !nasluch) return;
    if (nasluch.zywy()) { el.voiceTranscript.textContent = ''; return; }  // wróciło samo
    nasluch.stop();
    nasluch = null;
    startNasluchWlasny();
    // Dajemy nowemu wejściu chwilę i sprawdzamy, czy naprawdę żyje.
    setTimeout(() => {
      if (!voiceMode || !nasluch) return;
      if (nasluch.zywy()) el.voiceTranscript.textContent = '';
      else el.voiceTranscript.textContent = t('voice.micDead', { powod });
    }, 2500);
  }, 1500);
}

/** Gotowa wypowiedź z Whispera. W odróżnieniu od Web Speech API nie ma tu
 *  wyników cząstkowych ani odliczania ciszy — VAD już zdecydował, że zdanie
 *  się skończyło. */
function wypowiedzZNasluchu(tekst) {
  if (!voiceMode || voiceDeaf) return;

  if (voiceState === 'wake') {
    if (!WAKE_RE.test(tekst)) return;
    const po = bezSlowaBudzacego(tekst);
    chime(880);
    if (po.length > 5) { askVoice(po); return; }
    czekajNaPytanie();
    return;
  }

  if (voiceState !== 'listening') return;
  const czyste = bezSlowaBudzacego(tekst);
  if (!czyste) return;
  clearTimeout(nasluchCisza);
  el.voiceTranscript.textContent = czyste;
  askVoice(czyste);
}

/** Stan „słucham pytania" z własnym odliczaniem powrotu.
 *  Bez tego Cosmos zostawałby w nasłuchu pytania w nieskończoność, gdyby
 *  ktoś powiedział „Hej, Kosmos" i się rozmyślił. */
function czekajNaPytanie() {
  setVoiceState('listening');
  el.voiceTranscript.textContent = '';
  clearTimeout(nasluchCisza);
  nasluchCisza = setTimeout(() => {
    if (voiceMode && voiceState === 'listening') backToWake();
  }, NASLUCH_CISZA_MS);
}

/** Jedno miejsce na zmianę „czy reagujemy na to, co słychać".
 *  Przy własnym strumieniu to naprawdę wycisza wejście; przy Web Speech API
 *  zostaje starym znacznikiem, bo tam wyciszyć się nie da. */
function ustawGluchote(wlacz) {
  voiceDeaf = Boolean(wlacz);
  if (nasluch) nasluch.gluchy(voiceDeaf);
}

/** Uproszczona postać zdania — rozpoznawanie dopieszcza interpunkcję
 *  i wielkość liter jeszcze po tym, jak wynik uzna za ostateczny. */
function odciskWyniku(wyniki, indeks) {
  const r = wyniki && wyniki[indeks];
  return r && r[0] ? String(r[0].transcript).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
}

/** Zapamiętaj, że wszystko do `doIndeksu` już przerobiliśmy. */
function oznaczZuzyte(wyniki, doIndeksu) {
  voiceZuzyteDo = doIndeksu;
  voiceOdcisk = doIndeksu > 0 ? odciskWyniku(wyniki, doIndeksu - 1) : '';
}

/** Wytnij słowo budzące — wszystkie wystąpienia, nie tylko pierwsze. Przy
 *  ciągłym nasłuchu „Hej Kosmos" bywa rozpoznane kilka razy pod rząd. */
function bezSlowaBudzacego(tekst) {
  return String(tekst).replace(new RegExp(WAKE_RE.source, 'gi'), ' ')
    .replace(/\s{2,}/g, ' ').trim()
    /* Rozpoznawanie lubi rozbić „Hej Kosmos" na dwa wyniki, więc po wycięciu
       pełnej frazy zostaje sierotą samo „Hej". Ucinamy je tylko na POCZĄTKU
       i tylko wtedy, gdy coś po nim jest — w środku zdania to już treść. */
    .replace(/^(?:(?:hej|hey|ok(?:ej)?)[\s,.!]+)+(?=\S)/i, '');
}

/** Czy rozpoznawacz zaczął numerować wyniki od nowa? */
function wynikiOdNowa(wyniki) {
  if (!voiceZuzyteDo) return false;
  // Lista wciąż rośnie ponad znacznik → to ta sama sesja, tylko dłuższa.
  if (wyniki.length > voiceZuzyteDo) return false;
  return odciskWyniku(wyniki, voiceZuzyteDo - 1) !== voiceOdcisk;
}

function startVoiceRecognizer() {
  if (!voiceMode) return;
  if (silnikNasluchu() === 'whisper') { startNasluchWlasny(); return; }
  if (voiceRec) return;
  const SR = getSR();
  if (!SR) return;

  const rec = new SR();
  voiceRec = rec;
  rec.lang = t('speechLang');
  rec.continuous = true;
  rec.interimResults = true;

  rec.onresult = (e) => {
    if (!voiceMode) return;
    rec.__ostatniaDlugosc = e.results.length;
    rec.__ostatnieWyniki = e.results;
    // Zanim cokolwiek odczytamy: czy to jeszcze ta sama numeracja?
    if (wynikiOdNowa(e.results)) oznaczZuzyte(e.results, 0);
    if (voiceDeaf) {
      // Głuchy nie znaczy „nie słyszy" — znaczy „nie reaguje". Wszystko, co
      // wpadło w tym czasie (czyli głos samego Cosmosa), znika z rozważań.
      oznaczZuzyte(e.results, e.results.length);
      return;
    }

    if (voiceState === 'wake') {
      const swieze = [];
      for (let i = Math.max(0, voiceZuzyteDo); i < e.results.length; i++) {
        swieze.push(e.results[i][0].transcript);
      }
      const latest = swieze.join(' ');
      const match = latest.match(WAKE_RE);
      if (!match) return;
      // Wszystkie wystąpienia, nie tylko pierwsze: przy ciągłym nasłuchu
      // „Hej Kosmos" bywa rozpoznane kilka razy pod rząd i wcześniej lądowało
      // w treści pytania jako „HejHejHej kosmosHej kosmos Co widzisz".
      const after = bezSlowaBudzacego(latest);
      oznaczZuzyte(e.results, e.results.length);
      chime(880);
      if (after.length > 5) { askVoice(after); return; }
      voiceHeard = '';
      setVoiceState('listening');
      el.voiceTranscript.textContent = '';
      return;
    }

    if (voiceState !== 'listening') return;
    let interim = '';
    for (let i = Math.max(e.resultIndex, voiceZuzyteDo); i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) { voiceHeard += r[0].transcript; oznaczZuzyte(e.results, i + 1); }
      else interim += r[0].transcript;
    }
    el.voiceTranscript.textContent = (voiceHeard + ' ' + interim).trim();

    // Rozpoznawacz jest ciągły, więc sam nie zasygnalizuje końca pytania.
    // Kończymy po chwili ciszy od ostatniego usłyszanego słowa.
    clearTimeout(voiceSilence);
    voiceSilence = setTimeout(() => {
      if (!voiceMode || voiceState !== 'listening') return;
      /* Ostatnia zapora przed „HejHejHej kosmos Co widzisz": gdyby słowo
         budzące zdążyło wpaść do pytania — obojętne, czy przez opóźnione
         rozpoznanie, czy przez restart numeracji — tu i tak wypada. */
      const text = bezSlowaBudzacego(voiceHeard);
      voiceHeard = '';
      if (text) askVoice(text);
      else backToWake();
    }, 1400);
  };

  // Chrome i tak utnie sesję po ~60 s — wznawiamy ten sam obiekt.
  rec.onend = () => {
    voiceRec = null;
    // Nowa sesja zaczyna liczyć wyniki od zera, więc znacznik też musi.
    oznaczZuzyte(null, 0);
    if (!voiceMode) return;
    setTimeout(() => { if (voiceMode) startVoiceRecognizer(); }, 250);
  };
  rec.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      voiceRec = null;
      el.voiceTranscript.textContent = t('voice.micDenied', { msg: ev.error });
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
  clearTimeout(nasluchCisza);
  voiceHeard = '';
  if (voiceRec && voiceRec.__ostatniaDlugosc) {
    oznaczZuzyte(voiceRec.__ostatnieWyniki, voiceRec.__ostatniaDlugosc);
  }
  ustawGluchote(false);
  setVoiceState('wake');
  el.voiceTranscript.textContent = '';
  startVoiceRecognizer();
}

/** Zadaj pytanie, nie słuchając własnej odpowiedzi. */
function askVoice(text) {
  clearTimeout(voiceSilence);
  /* Druga zapora przed sprzężeniem. Znacznik zużycia załatwia typowy
     przypadek, ale rozpoznawanie bywa opóźnione i zdanie Cosmosa potrafi
     domknąć się już po odmilczeniu. Jeśli „pytanie" jest tym, co przed chwilą
     sam powiedział — nie odpowiadamy na własne słowa. */
  if (voiceOstatniaOdpowiedz && toSamoZdanie(text, voiceOstatniaOdpowiedz)) {
    backToWake();
    return;
  }
  ustawGluchote(true);
  handleVoiceQuery(text);
}

/** Czy dwa zdania to praktycznie to samo? Porównujemy zbiory słów, bo
 *  rozpoznawanie mowy gubi końcówki i interpunkcję. */
function toSamoZdanie(a, b) {
  const slowa = (x) => new Set(String(x).toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));
  const A = slowa(a);
  const B = slowa(b);
  if (A.size < 3) return false;                  // za krótkie, by wnioskować
  let wspolne = 0;
  for (const w of A) if (B.has(w)) wspolne++;
  return wspolne / A.size > 0.7;
}

// Nazwy używane w pozostałej części pliku — zostawiamy je jako cienkie przejścia,
// żeby nie rozsypać wywołań rozsianych po trybie głosowym.
function startWakeListening() { backToWake(); }
function startQueryListening() {
  if (!voiceMode) return;
  voiceHeard = '';
  // Wracamy do słuchania dopiero teraz — wszystko sprzed tej chwili to był
  // głos Cosmosa albo cisza, i nie może wrócić jako pytanie.
  if (voiceRec && voiceRec.__ostatniaDlugosc) {
    oznaczZuzyte(voiceRec.__ostatnieWyniki, voiceRec.__ostatniaDlugosc);
  }
  ustawGluchote(false);
  if (silnikNasluchu() === 'whisper') { startVoiceRecognizer(); czekajNaPytanie(); return; }
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
  { id: 'plener-modal', close: zamknijPlener },
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
  odswiezWyborNasluchu();
  renderConfigInfo();
  loadMemoryList();
  fetch('/api/profile').then((r) => r.json()).then((d) => { $('set-profile').value = d.profile || ''; }).catch(() => {});
  fetch('/api/location').then((r) => r.json()).then((d) => { $('set-location').value = d.location || ''; }).catch(() => {});
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
  // lokalizacja tak samo — używa jej też wyszukiwanie, nie tylko rozmowa
  fetch('/api/location', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: $('set-location').value }),
  }).catch(() => {});
  updateModelBadge();
  closeSettings();
});

/* Wykrycie lokalizacji: przeglądarka daje współrzędne, serwer zamienia je na
   nazwę. Współrzędne nie opuszczają Cosmosa inaczej niż przez ten jeden
   zapytanie — i tylko po kliknięciu, nigdy samo z siebie. */
$('set-location-detect').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const pole = $('set-location');
  if (!navigator.geolocation) {
    pole.placeholder = t('set.locationNoGps');
    return;
  }
  const dawny = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('set.locationWorking');
  try {
    const poz = await new Promise((ok, zle) => navigator.geolocation.getCurrentPosition(ok, zle, {
      enableHighAccuracy: false, timeout: 10000, maximumAge: 600000,
    }));
    const r = await fetch('/api/location/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: poz.coords.latitude, lon: poz.coords.longitude }),
    });
    const d = await r.json();
    if (d.location) pole.value = d.location;
    else pole.placeholder = d.error || t('set.locationFailed');
  } catch (err) {
    // Odmowa zgody to nie awaria — użytkownik zawsze może wpisać ręcznie.
    pole.placeholder = err && err.code === 1 ? t('set.locationDenied') : t('set.locationFailed');
  } finally {
    btn.disabled = false;
    btn.textContent = dawny;
  }
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
  /* Zestaw narzędzi zależy teraz od modelu. Gdyby to było niewidoczne,
     „dlaczego mały model nie umie szukać" byłoby zagadką bez odpowiedzi. */
  const poziom = typeof modelToolLevel === 'function' ? modelToolLevel(id) : 'pelny';
  if (poziom !== 'pelny') parts.push(`<div class="model-info-tools">${t(`model.tools.${poziom}`)}</div>`);
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

/** Sprawdź model NA ŻYWO: czy działa na tym koncie i czy czyta obrazy.
 *
 * Lista z `/v1/models` wypisuje wszystko, co dostawca hostuje — nie to, do czego
 * Twój klucz ma dostęp. Katalog opisów też tylko zgaduje po nazwie. Jedyna
 * pewna odpowiedź to spróbować, więc serwer wysyła najtańsze możliwe żądanie.
 */
async function checkOneModel(epName, model) {
  const res = await fetch('/api/models/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: epName, model }),
  });
  return readJsonSafe(res);
}

function renderCheckResult(box, r) {
  const lines = [];
  if (r.rozmowa) {
    lines.push(`<div class="check-ok">${escapeHtml(t('set.checkOkChat'))}</div>`);
    lines.push(r.obrazy
      ? `<div class="check-ok">${escapeHtml(t('set.checkOkVision'))}</div>`
      : `<div class="check-warn">${escapeHtml(t('set.checkNoVision'))}</div>`);
  } else {
    lines.push(`<div class="check-bad">${escapeHtml(t('set.checkFail'))}</div>`);
    if (r.podpowiedz) lines.push(`<div class="check-warn">${escapeHtml(r.podpowiedz)}</div>`);
    if (r.blad) lines.push(`<pre class="model-info-err">${escapeHtml(r.blad)}</pre>`);
  }
  box.hidden = false;
  box.innerHTML = lines.join('');
}

async function checkModelField(epName) {
  const input = epName === 'local' ? el.setModelLocal : el.setModelCloud;
  const sel = epName === 'local' ? el.modelSelectLocal : el.modelSelectCloud;
  const btn = $(`check-model-${epName}`);
  const box = $(`model-info-${epName}`);
  const model = (input.value.trim() || sel.value || epConfig(epName).model || '').trim();
  if (!model) { box.hidden = false; box.innerHTML = escapeHtml(t('set.checkNeedModel')); return; }

  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = t('set.checking');
  try {
    const r = await checkOneModel(epName, model);
    if (r.error && r.rozmowa === undefined) throw new Error(r.error);
    renderCheckResult(box, r);
  } catch (err) {
    box.hidden = false;
    box.innerHTML = `<div class="check-bad">${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

// Ostatni raport ze „Sprawdź wszystkie" — do skopiowania.
let lastCheckReport = '';

/** Sprawdź po kolei całą pobraną listę i oznacz pozycje w wybieraku.
 *  Po kolei, nie równolegle — inaczej dostawca odrzuci nas za nadmiar żądań. */
async function checkAllModels(epName) {
  const sel = epName === 'local' ? el.modelSelectLocal : el.modelSelectCloud;
  const box = $(`model-info-${epName}`);
  const opts = [...sel.options].filter((o) => o.value);
  if (!opts.length) return;

  const link = $(`check-all-${epName}`);
  if (link) link.disabled = true;
  let ok = 0; let vis = 0;
  const wzrok = []; const rozmowa = []; const brak = []; const niepewne = []; const inne = [];
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    box.hidden = false;
    box.innerHTML = escapeHtml(t('set.checkAllRun', { i: i + 1, n: opts.length, m: o.value }));
    let r;
    try { r = await checkOneModel(epName, o.value); } catch { r = { rozmowa: false }; }
    // Pięć stanów, nie dwa: „nie zdążył odpowiedzieć" i „to nie jest model do
    // rozmowy" to nie to samo, co „nie masz dostępu" — mieszanie ich kazałoby
    // odpuścić modele, które działają.
    const mark = r.rozmowa ? (r.obrazy ? '👁' : '✓')
      : r.inneZadanie ? '⚙' : r.niepewne ? '⏳' : '✗';
    if (r.rozmowa) ok++;
    if (r.obrazy) vis++;
    if (r.rozmowa) (r.obrazy ? wzrok : rozmowa).push(o.value);
    else if (r.inneZadanie) inne.push(o.value);
    else if (r.niepewne) niepewne.push(o.value);
    else brak.push(`${o.value} — ${r.blad || '—'}`);
    // Flaga `u` jest tu konieczna: 👁 to para surogatów, więc bez niej klasa
    // znaków obcięłaby tylko jej połowę i przy drugim przebiegu znaczki
    // zaczęłyby się nawarstwiać.
    o.textContent = `${mark} ${o.textContent.replace(/^[✗✓👁⏳⚙]\s*/u, '')}`;
    o.dataset.works = r.rozmowa ? '1' : '0';
  }

  // Wynik trzeba dać się wynieść na zewnątrz: przy stu pozycjach nikt nie
  // przepisze listy ręcznie, a znaczki w wybieraku znikają po odświeżeniu.
  const grupa = (tytul, lista) => [
    '',
    `=== ${tytul} (${lista.length}) ===`,
    ...(lista.length ? lista.map((m) => `  ${m}`) : ['  —']),
  ];
  lastCheckReport = [
    `${t('set.checkReportEngine')}: ${epName}`,
    t('set.checkSummary', { ok, n: opts.length, vis }),
    ...grupa(t('set.checkGroupVision'), wzrok),
    ...grupa(t('set.checkGroupChat'), rozmowa),
    ...grupa(t('set.checkGroupSlow'), niepewne),
    ...grupa(t('set.checkGroupOther'), inne),
    ...grupa(t('set.checkGroupNone'), brak),
  ].join('\n');

  box.innerHTML = `<div>${escapeHtml(t('set.checkSummary', { ok, n: opts.length, vis }))}</div>`
    + `<button type="button" class="btn-secondary check-all" id="copy-check-${epName}">`
    + `${escapeHtml(t('set.checkCopy'))}</button>`;
  $(`copy-check-${epName}`).addEventListener('click', (e) => copyCheckReport(e.currentTarget));
  if (link) link.disabled = false;
}

/** Skopiuj raport ze sprawdzenia do schowka.
 *  Na telefonie `navigator.clipboard` bywa niedostępny (stary WebView, brak
 *  HTTPS), więc jest zapasowa droga przez ukryte pole tekstowe. */
async function copyCheckReport(btn) {
  if (!lastCheckReport) return;
  const prev = btn.textContent;
  let done = false;
  try {
    await navigator.clipboard.writeText(lastCheckReport);
    done = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = lastCheckReport;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try { done = document.execCommand('copy'); } catch { done = false; }
    ta.remove();
  }
  btn.textContent = t(done ? 'set.checkCopied' : 'set.checkCopyFail');
  setTimeout(() => { btn.textContent = prev; }, 2500);
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

    // Dopiero po pobraniu listy ma sens sprawdzanie jej w całości.
    let all = $(`check-all-${epName}`);
    if (!all) {
      all = document.createElement('button');
      all.id = `check-all-${epName}`;
      all.className = 'btn-secondary check-all';
      all.type = 'button';
      all.addEventListener('click', () => checkAllModels(epName));
      selectEl.insertAdjacentElement('afterend', all);
    }
    all.textContent = t('set.checkAll');
    all.hidden = false;
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
$('set-stt').addEventListener('change', (e) => {
  localStorage.setItem('cosmos.sttEngine', e.target.value);
  odswiezWyborNasluchu();
});

/* Który silnik ZADZIAŁA, a nie który jest wybrany. To dwie różne rzeczy:
   „Własny strumień" przy wyłączonym komputerze domowym nie ma dokąd wysłać
   dźwięku i Cosmos po cichu wraca do przeglądarki. Milcząca zmiana zachowania
   to dokładnie ten rodzaj rzeczy, po której człowiek myśli, że coś zepsuł. */
/* Mój sprzęt. Do tej pory dało się go ustawić wyłącznie przez `/api/gear`
   curlem — czyli w praktyce wcale, a plan zdjęciowy liczył dla domyślnego
   korpusu i nie wiedział nic o dronie. */
async function wczytajSprzet() {
  try {
    const d = await (await fetch('/api/gear')).json();
    $('gear-body').value = d.korpus || '';
    $('gear-lenses').value = d.obiektywy || '';
    $('gear-extras').value = d.dodatki || '';
  } catch { /* offline — pola zostają puste, zapis i tak zadziała później */ }
}

/* Zapis pod przyciskiem, nie przy pisaniu — poprawka po obejrzeniu własnej
   roboty na zrzucie ekranu.

   Pierwsza wersja zapisywała sprzęt na bieżąco, z opóźnieniem. Działało, ale
   stworzyło w jednym oknie dwa różne modele zapisu: „Korpus", „Obiektywy"
   i „Reszta sprzętu" zapisywały się same, a stojące tuż obok „Profil"
   i „Lokalizacja" — dopiero po kliknięciu. Pola tekstowe zachowujące się
   inaczej niż sąsiednie pola tekstowe to nie wygoda, tylko zagadka.

   Po przeniesieniu sprzętu do Pleneru zostaje ta sama zasada, tylko własny
   przycisk: „Zapisz sprzęt". `/api/gear` i tak zawsze było osobną trasą —
   doklejenie go do przycisku Ustawień było wyłącznie skutkiem tego, że pola
   przypadkiem tam stały. */
/* Błąd LECI DALEJ, nie jest połykany. Dopóki zapis wisiał pod przyciskiem
   Ustawień razem z profilem i lokalizacją, ciche `catch` było spójne z resztą.
   Teraz sprzęt ma własny przycisk i własne potwierdzenie „Zapisane." — a to
   potwierdzenie po nieudanym żądaniu byłoby zwykłym kłamstwem. */
async function zapiszSprzet() {
  const r = await fetch('/api/gear', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      korpus: $('gear-body').value,
      obiektywy: $('gear-lenses').value,
      dodatki: $('gear-extras').value,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

function odswiezWyborNasluchu() {
  const sel = $('set-stt');
  sel.value = localStorage.getItem('cosmos.sttEngine') || 'auto';
  const silnik = silnikNasluchu() === 'whisper' ? t('set.sttWhisper') : t('set.sttBrowser');
  $('set-stt-now').textContent = t('set.sttNow', { silnik });
}
$('check-model-cloud').addEventListener('click', () => checkModelField('cloud'));
$('check-model-local').addEventListener('click', () => checkModelField('local'));
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
      /* Część zmysłów oddaje nie `true`, tylko NAZWĘ tego, co je obsługuje
         (np. dokumenty: "docling"). Dopisujemy ją, bo „dokumenty" i
         „dokumenty (docling)" to dwie różne jakości odczytu — z tym drugim
         Cosmos czyta skany i tabele, z pierwszym nie. */
      const active = Object.entries(senses.caps).filter(([, v]) => v)
        .map(([k, v]) => (typeof v === 'string' ? `${k} (${v})` : k));
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
// Strumień zdarzeń percepcji — kanał od serwera do okna
//
// Dotąd przeglądarka tylko WYSYŁAŁA zdarzenia i nigdy nie dowiadywała się,
// że coś się stało. „Hej, Kosmos" wykryte przez senses/wake_listener.py na
// domowym komputerze umierało w logu serwera — telefon w kieszeni nic o tym
// nie wiedział. Teraz nasłuchujemy.
// ----------------------------------------------------------------

let strumienZdarzen = null;
let zwlokaWznowienia = 1000;

/** Czy reagować na słowo aktywujące wykryte poza tą przeglądarką. */
const wakeZdalny = () => localStorage.getItem('cosmos.wakeZdalny') !== '0';

function pokazZdarzenie(z) {
  const pasek = $('event-flash');
  if (!pasek) return;
  // Nieznany typ zdarzenia (np. z własnego skryptu w senses/) nie ma
  // tłumaczenia — pokazujemy wtedy surową nazwę zamiast „undefined".
  const etykieta = maKlucz('event.' + z.type) ? t('event.' + z.type) : z.type;
  pasek.textContent = `${etykieta}: ${z.summary}`;
  pasek.hidden = false;
  clearTimeout(pokazZdarzenie._t);
  pokazZdarzenie._t = setTimeout(() => { pasek.hidden = true; }, 6000);
}

async function obsluzZdarzenie(z) {
  // Słowo aktywujące z innego urządzenia otwiera tryb głosowy tutaj.
  // Za zgodą: samoistnie włączający się mikrofon byłby nieprzyjemną
  // niespodzianką, więc da się to wyłączyć w Ustawieniach.
  if (z.type === 'wake' && wakeZdalny() && !voiceMode) {
    pokazZdarzenie(z);
    try { await enterVoiceMode(); } catch { /* brak zgody na mikrofon */ }
    return;
  }
  // Reszta tylko mignięciem — to kontekst, nie polecenie.
  if (['kamera', 'czujnik', 'sylwetka', 'urządzenie', 'rutyna'].includes(z.type)) pokazZdarzenie(z);
}

// Przełącznik w Ustawieniach — czytany przy otwarciu okna i zapisywany od razu.
const wakeCheckbox = $('set-wake-remote');
if (wakeCheckbox) {
  wakeCheckbox.checked = wakeZdalny();
  wakeCheckbox.addEventListener('change', () => {
    localStorage.setItem('cosmos.wakeZdalny', wakeCheckbox.checked ? '1' : '0');
  });
}

function sluchajZdarzen() {
  if (strumienZdarzen) return;
  try { strumienZdarzen = new EventSource('/api/events/stream'); }
  catch { return; }

  strumienZdarzen.addEventListener('zdarzenie', (e) => {
    zwlokaWznowienia = 1000;
    try { obsluzZdarzenie(JSON.parse(e.data)); } catch { /* zniekształcone */ }
  });

  strumienZdarzen.onerror = () => {
    // Serwer padł albo sieć znikła. Wznawiamy z rosnącą zwłoką — bez tego
    // telefon poza zasięgiem dobija serwer setkami prób na minutę.
    strumienZdarzen.close();
    strumienZdarzen = null;
    setTimeout(sluchajZdarzen, zwlokaWznowienia);
    zwlokaWznowienia = Math.min(zwlokaWznowienia * 2, 60000);
  };
}

// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------

boot();
sluchajZdarzen();

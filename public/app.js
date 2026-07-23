/* ============================================================
   Bear Chat — logika interfejsu
   ============================================================ */

'use strict';

// ----------------------------------------------------------------
// Stan aplikacji
// ----------------------------------------------------------------

const STORAGE_KEYS = {
  conversations: 'bear.conversations',
  settings: 'bear.settings',
  theme: 'bear.theme',
};

const DEFAULT_SETTINGS = {
  model: '',            // puste = model z konfiguracji serwera
  systemPrompt: 'Jesteś pomocnym asystentem AI. Odpowiadasz po polsku, chyba że użytkownik pisze w innym języku.',
  temperature: 0.6,
  maxTokens: 2048,
};

let conversations = loadJson(STORAGE_KEYS.conversations, []);
let settings = { ...DEFAULT_SETTINGS, ...loadJson(STORAGE_KEYS.settings, {}) };
let activeId = null;
let serverConfig = { model: '', baseUrl: '', hasApiKey: false };
let abortController = null;
let isGenerating = false;

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
  themeBtn: $('theme-btn'),
  themeLabel: $('theme-label'),
  themeIconDark: $('theme-icon-dark'),
  themeIconLight: $('theme-icon-light'),
  topbarModel: $('topbar-model'),
  statusDot: $('status-dot'),
  statusText: $('status-text'),
  // modal
  settingsBtn: $('settings-btn'),
  settingsModal: $('settings-modal'),
  settingsClose: $('settings-close'),
  settingsSave: $('settings-save'),
  settingsReset: $('settings-reset'),
  setModel: $('set-model'),
  setSystem: $('set-system'),
  setTemp: $('set-temp'),
  tempValue: $('temp-value'),
  setMaxTokens: $('set-maxtokens'),
  fetchModelsBtn: $('fetch-models-btn'),
  modelSelect: $('model-select'),
  configInfo: $('config-info'),
};

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
  localStorage.setItem(STORAGE_KEYS.conversations, JSON.stringify(conversations));
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

function currentModel() {
  return settings.model || serverConfig.model || '';
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
      i++; // pomiń zamykające ```
      html.push(
        `<div class="code-block">` +
        `<div class="code-block-header"><span>${escapeHtml(lang || 'kod')}</span>` +
        `<button class="code-copy-btn" data-copy>` +
        `<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2"/></svg>` +
        `Kopiuj</button></div>` +
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

    // tabela (wiersz z | oraz separator w kolejnej linii)
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
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv.id);
    });

    item.append(title, del);
    el.conversations.appendChild(item);
  }
}

function messageElement(role, content, isError = false) {
  const msg = document.createElement('div');
  msg.className = `msg msg-${role}` + (isError ? ' msg-error' : '');

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = '🐻';
    msg.appendChild(avatar);
  }

  const body = document.createElement('div');
  body.className = 'msg-content' + (role === 'assistant' && !isError ? ' md' : '');
  if (role === 'assistant' && !isError) body.innerHTML = renderMarkdown(content);
  else body.textContent = content;
  msg.appendChild(body);

  if (role === 'assistant' && !isError) {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-action-btn';
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2"/></svg> Kopiuj';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(content).then(() => {
        copyBtn.innerHTML = '✓ Skopiowano';
        setTimeout(() => {
          copyBtn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2"/></svg> Kopiuj';
        }, 1500);
      });
    });
    actions.appendChild(copyBtn);
    body.after(actions);
    // actions muszą być w kolumnie z treścią
    const col = document.createElement('div');
    col.style.flex = '1';
    col.style.minWidth = '0';
    col.append(body, actions);
    msg.appendChild(col);
  }

  return msg;
}

function renderMessages() {
  const conv = activeConv();
  el.messages.innerHTML = '';
  const hasMessages = conv && conv.messages.length > 0;
  el.welcome.style.display = hasMessages ? 'none' : '';
  if (!hasMessages) return;

  for (const m of conv.messages) {
    el.messages.appendChild(messageElement(m.role, m.content, m.error));
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
    conv = {
      id: uid(),
      title: firstUserText.slice(0, 48) + (firstUserText.length > 48 ? '…' : ''),
      messages: [],
      createdAt: Date.now(),
    };
    conversations.unshift(conv);
    activeId = conv.id;
  }
  return conv;
}

// ----------------------------------------------------------------
// Wysyłanie wiadomości + streaming SSE
// ----------------------------------------------------------------

async function sendMessage() {
  const text = el.input.value.trim();
  if (!text || isGenerating) return;

  const conv = ensureConversation(text);
  conv.messages.push({ role: 'user', content: text });
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

  // element odpowiedzi asystenta (streaming)
  const msg = document.createElement('div');
  msg.className = 'msg msg-assistant';
  msg.innerHTML = '<div class="msg-avatar">🐻</div>';
  const body = document.createElement('div');
  body.className = 'msg-content md';
  body.innerHTML = '<span class="cursor-blink"></span>';
  msg.appendChild(body);
  el.messages.appendChild(msg);
  scrollToBottom(true);

  const apiMessages = [];
  if (settings.systemPrompt.trim()) {
    apiMessages.push({ role: 'system', content: settings.systemPrompt.trim() });
  }
  for (const m of conv.messages) {
    if (!m.error) apiMessages.push({ role: m.role, content: m.content });
  }

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
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: apiMessages,
        model: settings.model || undefined,
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

    // parsowanie strumienia SSE (format OpenAI: data: {...}\n\n)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop(); // niepełny fragment zostaje w buforze

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
          } catch { /* niepełny/nieznany fragment — pomijamy */ }
        }
      }
    }

    if (!acc) acc = '*(pusta odpowiedź modelu)*';
    conv.messages.push({ role: 'assistant', content: acc });
    saveConversations();
  } catch (err) {
    if (err.name === 'AbortError') {
      if (acc) {
        conv.messages.push({ role: 'assistant', content: acc });
        saveConversations();
      }
    } else {
      conv.messages.push({ role: 'assistant', content: `⚠️ ${err.message}`, error: true });
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
  el.input.disabled = false;
  updateSendButton();
}

function updateSendButton() {
  el.sendBtn.disabled = el.input.value.trim() === '' || isGenerating;
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
// Sidebar / motyw
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
}

el.themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

applyTheme(localStorage.getItem(STORAGE_KEYS.theme) || 'dark');

// ----------------------------------------------------------------
// Ustawienia (modal)
// ----------------------------------------------------------------

function openSettings() {
  el.setModel.value = settings.model;
  el.setSystem.value = settings.systemPrompt;
  el.setTemp.value = settings.temperature;
  el.tempValue.textContent = settings.temperature;
  el.setMaxTokens.value = settings.maxTokens;
  el.modelSelect.style.display = 'none';
  renderConfigInfo();
  el.settingsModal.style.display = '';
}

function closeSettings() {
  el.settingsModal.style.display = 'none';
}

function renderConfigInfo() {
  el.configInfo.innerHTML =
    `<strong>Konfiguracja serwera</strong><br>` +
    `Endpoint: <code>${escapeHtml(serverConfig.baseUrl || '—')}</code><br>` +
    `Model domyślny: <code>${escapeHtml(serverConfig.model || '—')}</code><br>` +
    `Klucz API: ${serverConfig.hasApiKey
      ? '✅ ustawiony'
      : '⚠️ brak — ustaw <code>NVIDIA_API_KEY</code> w pliku <code>.env</code> i zrestartuj serwer'}`;
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
  settings.model = el.setModel.value.trim();
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

el.fetchModelsBtn.addEventListener('click', async () => {
  el.fetchModelsBtn.disabled = true;
  el.fetchModelsBtn.textContent = 'Pobieranie…';
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const models = (data.data || []).map((m) => m.id).sort();
    if (!models.length) throw new Error('Endpoint nie zwrócił żadnych modeli.');
    el.modelSelect.innerHTML =
      '<option value="">— wybierz model z listy —</option>' +
      models.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    el.modelSelect.style.display = '';
  } catch (err) {
    alert(`Nie udało się pobrać listy modeli:\n${err.message}`);
  } finally {
    el.fetchModelsBtn.disabled = false;
    el.fetchModelsBtn.textContent = 'Pobierz listę';
  }
});

el.modelSelect.addEventListener('change', () => {
  if (el.modelSelect.value) el.setModel.value = el.modelSelect.value;
});

// ----------------------------------------------------------------
// Status połączenia i konfiguracja serwera
// ----------------------------------------------------------------

function updateModelBadge() {
  const model = currentModel() || 'model nieustawiony';
  el.topbarModel.textContent = model;
  el.welcomeModel.textContent = model;
}

async function loadServerConfig() {
  try {
    const res = await fetch('/api/config');
    serverConfig = await res.json();
    updateModelBadge();
    if (serverConfig.hasApiKey || !serverConfig.baseUrl.includes('integrate.api.nvidia.com')) {
      el.statusDot.className = 'status-dot ok';
      el.statusText.textContent = `Połączono: ${new URL(serverConfig.baseUrl).host}`;
    } else {
      el.statusDot.className = 'status-dot warn';
      el.statusText.textContent = 'Brak klucza API (.env)';
    }
  } catch {
    el.statusDot.className = 'status-dot err';
    el.statusText.textContent = 'Brak połączenia z serwerem';
  }
}

// ----------------------------------------------------------------
// Start
// ----------------------------------------------------------------

renderSidebar();
renderMessages();
updateSendButton();
loadServerConfig();
el.input.focus();

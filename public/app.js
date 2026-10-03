/* ============================================================
   COSMOS – logika interfejsu
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
  modelOpenai: '',
  modelClaude: '',
  systemPrompt: '',
  temperature: 0.6,
  /* 2048 to było za mało na rzeczy, o które Marcin realnie prosi. Plan
     tygodniowej wycieczki w tabeli wyczerpywał budżet w połowie sekcji
     „Źródła" i odpowiedź kończyła się w środku adresu. Dokańczanie urwanych
     odpowiedzi to łata; sensowny domyślny budżet to profilaktyka. */
  maxTokens: 4096,
  speak: false,
  /* „Pytaj przed startem” (zespół agentów) żyje na serwerze – /api/zespol/ustawienia
     `potwierdzaj`. Stare `zespolPotwierdzaj: false` z przeglądarki czeka tu na
     jednorazową migrację (migrujPotwierdzaj). */
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
// gotowy TEKST, nie plik – treść wyciąga serwer, zaraz po wybraniu pliku.
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
  setSystem: $('set-system'),
  setTemp: $('set-temp'),
  tempValue: $('temp-value'),
  setMaxTokens: $('set-maxtokens'),
  configInfo: $('config-info'),
  memoryList: $('memory-list'),
  memoryCount: $('memory-count'),
  voiceBtn: $('voice-btn'),
  voiceOverlay: $('voice-overlay'),
  voiceClose: $('voice-close'),
  voiceOrb: $('voice-orb'),
  voiceHint: document.querySelector('.voice-hint'),
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

const AVATAR_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><use href="#znak-cosmos"/></svg>';
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

// Zapis aktywnej rozmowy na serwer (data/conversations/) – wspólny dla
// wszystkich urządzeń. Zapis serwerowy jest debounce'owany; kopia w
// localStorage służy tylko jako podgląd offline, gdy serwer jest niedostępny.
const convSaveTimers = new Map();

/* Zapis z opóźnieniem – do pisania w płótnie. Zapisywanie przy każdym
   naciśnięciu klawisza słałoby na serwer kilkanaście żądań na sekundę. */
let zapisZaChwile = null;
function saveConversationsSoon(ms = 800) {
  clearTimeout(zapisZaChwile);
  zapisZaChwile = setTimeout(() => { zapisZaChwile = null; saveConversations(); }, ms);
}

/** @param {boolean} natychmiast – pomiń 400 ms zwłoki i wyślij zapis od razu.
 *
 *  Zwłoka jest dobra przy pisaniu (jeden zapis zamiast dziesięciu), ale zła
 *  przed startem generowania: gdy karta zamknie się w tej ćwierci sekundy,
 *  serwer dokończy odpowiedź i nie będzie miał jej gdzie dopisać, bo plik
 *  rozmowy jeszcze nie istnieje. */
/* `c` – rozmowa do zapisu; domyślnie aktywna. Ścieżki błędu i przerwania
   dopisują do rozmowy, która w międzyczasie mogła przestać być aktywna –
   dawniej zapisywała się wtedy tylko nowa, a fragment w starej ginął
   (zespół IT, runda 5). */
function saveConversations(natychmiast = false, c = activeConversation) {
  if (c === activeConversation) { clearTimeout(zapisZaChwile); zapisZaChwile = null; }
  if (!c) return;
  c.updatedAt = Date.now();

  // odśwież metadane w indeksie (pasek boczny) i wypłyń na górę
  const i = conversations.findIndex((x) => x.id === c.id);
  const meta = {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    // Pinezka zostaje – nowa wiadomość w przypiętej rozmowie ją zdejmowała do odświeżenia strony.
    pinned: Boolean((i >= 0 && conversations[i].pinned) || c.pinned),
  };
  if (i >= 0) conversations[i] = meta; else conversations.unshift(meta);
  conversations.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  renderSidebar();
  cacheConvIndex();

  try { localStorage.setItem('cosmos.conv.' + c.id, JSON.stringify(doZapisu(c))); } catch { /* limit */ }

  const conv = c;
  const id = conv.id;
  // Zwłoka osobno dla każdej rozmowy: zapis jednej nie może skasować czekającego zapisu drugiej.
  clearTimeout(convSaveTimers.get(id));
  if (natychmiast) { convSaveTimers.delete(id); zapiszNaSerwerze(id, conv); }
  else convSaveTimers.set(id, setTimeout(() => { convSaveTimers.delete(id); zapiszNaSerwerze(id, conv); }, 400));
}

/* DWA URZĄDZENIA, JEDNA ROZMOWA. Zapis wysyłał cały dokument, a serwer go
   nadpisywał – telefon z nieaktualną kopią kasował wiadomości napisane
   w międzyczasie na komputerze. Teraz zapis mówi, na której wersji się opiera
   (`bazaUpdatedAt`); gdy serwer ma nowszą, odpowiada 409 z nią, a my scalamy
   i zapisujemy jeszcze raz. Zapisy jednej rozmowy idą po kolei, więc własne
   szybkie zapisy nie biorą się nawzajem za „cudze". */
const wersjaNaSerwerze = new Map();   // id rozmowy → updatedAt ostatniej znanej wersji z serwera
const zapisyWToku = new Map();        // id rozmowy → obietnica ostatniego zapisu

function zapiszNaSerwerze(id, conv, proba = 0) {
  const poprzedni = zapisyWToku.get(id) || Promise.resolve();
  const teraz = poprzedni.then(async () => {
    const baza = wersjaNaSerwerze.get(id);
    let r;
    try {
      r = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...doZapisu(conv), ...(baza ? { bazaUpdatedAt: baza } : {}) }),
      });
    } catch { oznaczNiezapisana(id, t('zapis.offline')); return; /* zostaje kopia w localStorage */ }
    const d = await readJsonSafe(r).catch(() => ({}));
    if (r.ok && d.meta) { wersjaNaSerwerze.set(id, d.meta.updatedAt); oznaczNiezapisana(id, null); return; }
    /* Pełny dysk, limit miejsca (507), błąd serwera: dawniej po cichu – a po
       odświeżeniu wersja z serwera wygrywała z kopią w przeglądarce i odpowiedź
       znikała (zespół IT, runda 5). Teraz pasek z przyczyną i ponowienie. */
    if (r.status === 507 || r.status >= 500) { oznaczNiezapisana(id, d.error || t('httpErr', { status: r.status })); return; }
    if (r.status === 409 && d.rozmowa && proba < 2) {
      const scalona = scalRozmowy(conv, d.rozmowa);
      wersjaNaSerwerze.set(id, d.rozmowa.updatedAt);
      if (activeConversation && activeConversation.id === id) {
        activeConversation.messages = scalona.messages;
        renderMessages({ przewin: sledzeDol });
      }
      try { localStorage.setItem('cosmos.conv.' + id, JSON.stringify(scalona)); } catch { /* limit */ }
      zapiszNaSerwerze(id, activeConversation && activeConversation.id === id ? activeConversation : scalona, proba + 1);
    }
  });
  zapisyWToku.set(id, teraz.catch(() => {}));
  return teraz;
}

/* NIEZAPISANE ROZMOWY. Lista w localStorage przeżywa odświeżenie: rozmowa,
   której zapis się nie udał, przy wczytaniu wygrywa kopią z przeglądarki,
   zamiast przegrać ze starszą wersją z serwera. */
const NIEZAPISANE_KLUCZ = 'cosmos.niezapisane';
const niezapisane = () => new Set(loadJson(NIEZAPISANE_KLUCZ, []));
function oznaczNiezapisana(id, powod) {
  const zbior = niezapisane();
  if (powod) zbior.add(id); else zbior.delete(id);
  try { localStorage.setItem(NIEZAPISANE_KLUCZ, JSON.stringify([...zbior])); } catch { /* prywatne okno */ }
  const pasek = $('zapis-bar');
  if (!pasek) return;
  if (powod) $('zapis-powod').textContent = powod;
  pasek.hidden = zbior.size === 0;
}
/** Ponów zapis wszystkich niezapisanych rozmów (z kopii w przeglądarce). */
function ponowNiezapisane() {
  for (const id of niezapisane()) {
    const c = activeConversation && activeConversation.id === id ? activeConversation : loadJson('cosmos.conv.' + id, null);
    if (c) zapiszNaSerwerze(id, c); else oznaczNiezapisana(id, null);
  }
}
// Najpierw powrót po odpowiedź porzuconą bez sieci, dopiero potem zapis kopii z przeglądarki.
window.addEventListener('online', () => { wrocPoOdpowiedz(); });
$('zapis-retry')?.addEventListener('click', ponowNiezapisane);
if (niezapisane().size) {
  const pasek = $('zapis-bar');
  if (pasek) { $('zapis-powod').textContent = t('zapis.poprzednio'); pasek.hidden = false; }
  setTimeout(ponowNiezapisane, 1500);
}

/* Powrót do karty (telefon wyjęty z kieszeni): świeża wersja aktywnej
   rozmowy, zanim ktoś zacznie pisać do nieaktualnej. */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !isGenerating && await wrocPoOdpowiedz()) return;
  if (document.visibilityState !== 'visible' || !activeId || isGenerating) return;
  const id = activeId;
  try {
    const r = serwerOdpowiedzial(await fetch(`/api/conversations?id=${encodeURIComponent(id)}`));
    if (!r.ok || activeId !== id || isGenerating) return;
    const zSerwera = naprawStareRuchyNarzedzi(await r.json());
    if ((zSerwera.updatedAt || 0) <= (wersjaNaSerwerze.get(id) || 0)) return;
    wersjaNaSerwerze.set(id, zSerwera.updatedAt);
    activeConversation = scalRozmowy(activeConversation || { messages: [] }, zSerwera);
    renderMessages({ przewin: sledzeDol });
  } catch { /* offline */ }
});

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

/* Model wybrany w Ustawieniach dla danego silnika – po jednym polu na silnik.
   Dawniej tylko NVIDIA i lokalny miały swoje pole, więc na OpenAI i Claude
   zostawał na zawsze model z .env i nie było jak go zmienić z aplikacji. */
const SILNIKI_Z_MODELEM = ['cloud', 'local', 'openai', 'claude'];
const POLE_MODELU = { cloud: 'modelCloud', local: 'modelLocal', openai: 'modelOpenai', claude: 'modelClaude' };
function nadpisanieModelu(ep = endpoint) {
  return (POLE_MODELU[ep] && settings[POLE_MODELU[ep]]) || '';
}

function currentModel() {
  return nadpisanieModelu() || epConfig().model || '';
}

/* Treść wiadomości i mini-renderer Markdown mieszkają w `public/tekst.js`
   – patrz nagłówek tamtego pliku. Wchodzi string, wychodzi string, więc
   dają się sprawdzić bez przeglądarki. */
const {
  escapeHtml, msgText, msgImages, msgPhotos, msgDalej, msgDocs, msgRun,
  zebranyMaterial, autoLink, renderInline, renderMarkdown,
} = utworzTekst({ t, COPY_SVG });

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
  } catch { /* offline – indeks lokalny już zaktualizowany */ }
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
 *  Panel buduje się od zera przy każdym odświeżeniu – stanów jest pięć
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
    stanEl.textContent = t(indeks.wznowione ? 'arch.indexingResumed' : 'arch.indexing', { n: indeks.dodanych });
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
    /* Sam licznik plików nie mówi, czy uzupełnianie się skończyło. Po kilku
       godzinach dociągania jedyną drogą było kliknięcie przycisku jeszcze raz
       i zobaczenie zera – czyli uruchomienie zadania, żeby dowiedzieć się,
       że nie ma go po co uruchamiać. */
    const pst = d.postep;
    stanEl.textContent = d.wArchiwum
      ? t('arch.connected', { n: d.wArchiwum.toLocaleString() })
        + (pst ? ' ' + t('arch.progress', {
          zDanymi: pst.zDanymi.toLocaleString(),
          zdjec: pst.zdjec.toLocaleString(),
          zostalo: pst.zostaloZdjec.toLocaleString(),
          klipy: pst.doTelemetrii.toLocaleString(),
        }) : '')
      : `${t('arch.notConnected').replace(/[^.]*$/, '')} ${t('arch.empty')}`.trim();
  }

  if (!d.polaczony) {
    przycisk(t('arch.connect'), async () => {
      const r = await fetch('/api/onedrive/login');
      const w = await readJsonSafe(r);
      if (w.url) window.open(w.url, '_blank', 'noopener');
      // Logowanie kończy się w innej karcie – sprawdzamy stan po powrocie.
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
  /* Dwa uzupełnienia indeksu, każde jedno żądanie NA PLIK – dlatego osobno
     od indeksowania i dlatego paczkami. Do tej pory dało się je uruchomić
     wyłącznie ręcznie curlem, co znaczy: nikt ich nigdy nie uruchomił. */
  if (d.wArchiwum) {
    /* Paczki większe, odkąd serwer bierze pliki po sześć naraz: przy setce
       połowa czasu szła na narzut samej paczki, a licznik na ekranie i tak
       odświeża się co kilkanaście sekund. */
    przycisk(t('arch.lenses'), (e) => uzupelniajPaczkami({
      przycisk: e.currentTarget, adres: '/api/archive/lenses', ile: 300,
      etykieta: (w) => t('arch.lensesProgress', { ile: w.uzupelnione, zostalo: w.zostalo }),
      koniec: (suma) => t('arch.lensesDone', { ile: suma }),
    }));
    /* Paczka po 200, nie po 50. Robotników jest kilkanaście i biorą z jednej
       kolejki, więc na końcu paczki część z nich stoi bezczynnie, czekając na
       ostatnie sztuki. Przy pięćdziesięciu plikach ten ogon to kilkanaście
       procent czasu; przy dwustu – kilka. Przy okazji rzadziej płacimy za
       zbudowanie kolejki po stronie serwera. */
    przycisk(t('arch.vision'), (e) => uzupelniajPaczkami({
      przycisk: e.currentTarget, adres: '/api/archive/vision', ile: 200,
      /* Rozbicie na etapy w widocznym miejscu. „1,63 s na zdjęcie" nie mówi,
         co poprawić – te same 1,63 s mogą być wolnym łączem do Microsoftu,
         wolnym łączem do domu albo zatkanym YOLO. RAW osobno od JPG-a, bo
         średnia z obu nie rozstrzyga, czy drogie są RAW-y, czy wszystko. */
      etykieta: (w) => t('arch.visionProgress', { ile: w.opisane, zostalo: w.zostalo })
        + (w.zParowania ? ' · ' + t('arch.visionPaired', { ile: w.zParowania }) : '')
        + (w.zdlawien ? ' · ' + t('arch.visionThrottled', { ile: w.zdlawien }) : '')
        + (w.czekanieS ? ' · ' + t('arch.visionWaited', { ile: w.czekanieS }) : '')
        + [['JPG', w.czasy], ['RAW', w.czasyRaw]]
          .filter(([, c]) => c && c.ile)
          .map(([rodzaj, c]) => ' · ' + t('arch.visionTimes', {
            rodzaj, ile: c.ile, adres: c.adres, pobranie: c.pobranie, yolo: c.yolo, kb: c.kb,
            // Ile obrazków wyjęliśmy z wnętrza pliku zamiast czekać na render.
            zPliku: c.zPliku ? t('arch.visionFromFile', { ile: c.zPliku }) : '',
          })).join('')
        + t('arch.visionPool', { n: w.rownolegle, dolPuli: w.dolPuli, sufitPuli: w.sufitPuli,
          szczytYolo: w.szczytYolo, srednioNaraz: w.srednioNaraz, naZadanie: w.naZadanie }),
      koniec: (suma) => t('arch.visionDone', { ile: suma }),
    }));
    przycisk(t('arch.tele'), (e) => uzupelniajPaczkami({
      przycisk: e.currentTarget, adres: '/api/archive/telemetry', ile: 100,
      etykieta: (w) => t('arch.teleProgress', { ile: w.odczytane, zostalo: w.zostalo }),
      /* „Odczytano z 0 klipów" nie mówi NIC o przyczynie – a przyczyny są trzy
         i wymagają różnych reakcji: pliki puste, zwykłe napisy zamiast
         telemetrii, albo wariant formatu, którego nie znamy. Dlatego przy
         zerowym wyniku pokazujemy próbkę odrzuconego pliku. */
      koniec: (suma, w) => (suma || !w || !w.probka
        ? t('arch.teleDone', { ile: suma, bez: (w && w.bezTelemetrii) || 0 })
        : t('arch.teleNone', { bez: w.bezTelemetrii || 0, probka: w.probka })),
    }));
  }

  przycisk(t('arch.disconnect'), async () => {
    if (!confirm(t('arch.confirmDisconnect'))) return;
    await fetch('/api/onedrive/disconnect', { method: 'POST' }).catch(() => {});
    odswiezArchiwum();
  });

  /* KASOWANIE MATERIAŁU JAKO OSOBNA DECYZJA.
     Wcześniej robiło to odłączenie konta – jednym kliknięciem, przy okazji
     czegoś zupełnie innego. Teraz odłączenie tylko rozłącza, a usunięcie
     wpisów trzeba wybrać świadomie i potwierdzić ostrzeżeniem mówiącym
     wprost, czego nie da się odzyskać. */
  przycisk(t('arch.forget'), async () => {
    if (!confirm(t('arch.confirmForget'))) return;
    await fetch('/api/archive/source?zrodlo=onedrive', { method: 'DELETE' }).catch(() => {});
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
  let bezPostepu = 0;
  let ostatni = null;          // ostatnia odpowiedź serwera – do komunikatu końcowego
  try {
    for (;;) {
      const r = await fetch(adres, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ile }),
      });
      const w = await readJsonSafe(r);
      ostatni = w;
      if (!r.ok) { stanEl.textContent = w.error || `HTTP ${r.status}`; return; }
      suma += Number(w.uzupelnione || w.opisane || w.odczytane || 0);
      stanEl.textContent = etykieta(w);
      // `sprawdzone === 0` znaczy „nie ma już czego brać" – bez tego warunku
      // pusta kolejka kręciłaby pętlę w nieskończoność.
      if (paczkiPrzerwane || !w.sprawdzone || !w.zostalo) break;
      /* KOLEJKA MUSI MALEĆ. Gdy każdy plik w paczce kończy się błędem – token
         OneDrive wygasł, zmysły padły w połowie – nic nie ubywa, a warunki
         wyżej są dalej spełnione. To była pętla bez końca waląca w serwer
         co sekundę. Brak postępu kończy zadanie z komunikatem, nie po cichu. */
      if (Number(w.zostalo) >= poprzednioZostalo) {
        /* …ale DŁAWIENIE to nie awaria. Microsoft odpowiada 429 i prosi
           o zwolnienie; poddanie się w tym miejscu było błędem – Marcin
           zobaczył „Przerwane: kolejka nie maleje. Powód: Graph 429" i musiał
           zaczynać od nowa. Odczekujemy i próbujemy dalej, coraz rzadziej.
           Dopiero gdy pięć podejść z rzędu nic nie da, uznajemy, że stoimy. */
        const dlawi = /429/.test((w.bledy || []).join(' ')) || Number(w.zdlawione) > 0;
        if (dlawi && bezPostepu < 5) {
          bezPostepu++;
          const czekaj = 15000 * bezPostepu;
          stanEl.textContent = t('arch.throttled', {
            zostalo: w.zostalo, sekund: Math.round(czekaj / 1000),
          });
          await new Promise((r) => setTimeout(r, czekaj));
          if (paczkiPrzerwane) break;
          continue;
        }
        stanEl.textContent = t('arch.batchStuck', {
          zostalo: w.zostalo, powod: (w.bledy || [])[0] || '–',
        });
        return;
      }
      bezPostepu = 0;
      poprzednioZostalo = Number(w.zostalo);
    }
    stanEl.textContent = koniec(suma, ostatni);
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
 *  dokumentu. Fragment MUSI występować dokładnie raz – gdy trafia w dwa
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

/* Ile miniatur dobiera jedno kliknięcie „pokaż kolejne". Zostaje tutaj,
   bo korzysta z niej i siatka, i rejestr narzędzi. */
const PORCJA_ARCHIWUM = 24;

/* Budowniczowie widoku (siatki, panele, podglądy) mieszkają
   w `public/widoki.js` – patrz nagłówek tamtego pliku. Tutaj zostaje
   samo podpięcie ich do stanu aplikacji. */
const {
  runPanel, photosGrid, pasekZdjec, stopkaArchiwum, naKafelek,
  openTextViewer, openImageViewer, przesunPodglad, closeImageViewer, downloadViewedImage,
} = utworzWidoki({
  t, readJsonSafe, saveConversations, renderMessages,
  msgPhotos, msgDalej, PORCJA_ARCHIWUM,
  /* Porażka miniatury zapamiętana w rozmowie – po odświeżeniu i na drugim
     urządzeniu kafel już nie wraca. W trakcie tury zapisze ją koniec tury. */
  zdjecieNiewczytane: () => { if (!isGenerating && activeConversation) saveConversationsSoon(1500); },
});

/* Nić rozmowy: każda odpowiedź pamięta, który silnik ją napisał, i nosi jego
   kolor – dokładnie tak, jak pokazuje to strona produktowa. */
function nazwaSilnika(klucz) {
  return klucz === 'cloud' ? 'NVIDIA' : klucz === 'local' ? t('silnik.local')
    : klucz === 'claude' ? 'Claude' : klucz === 'openai' ? 'OpenAI' : '';
}
function podpisSilnika(klucz, model, prowadzi = false) {
  const nazwa = nazwaSilnika(klucz);
  if (!nazwa) return null;
  const el = document.createElement('div');
  el.className = 'msg-silnik';
  el.textContent = nazwa;
  const krotki = String(model || '').split('/').pop();
  if (krotki) {
    const m = document.createElement('small');
    m.textContent = krotki;
    el.appendChild(m);
  }
  if (prowadzi) dopiszProwadzi(el);
  return el;
}
/** „· prowadzi” w podpisie odpowiedzi zespołu (na telefonie ukryte – blok i tak to mówi). */
function dopiszProwadzi(podpis) {
  if (!podpis || podpis.querySelector('.msg-silnik-prowadzi')) return;
  const s = document.createElement('span');
  s.className = 'msg-silnik-prowadzi';
  s.textContent = ` · ${t('ag.prowadzi')}`;
  (podpis.querySelector('small') || podpis).appendChild(s);
}
/* Silnik przypięty do TURY. Przełączenie zakładki w trakcie odpowiedzi
   podpisywało odpowiedź chmury jako „lokalny GPU", a kolejne rundy narzędzi
   szły już do innego silnika niż pierwsza. `runGeneration` ustawia go na
   starcie i zdejmuje na końcu. */
let znakTury = null;
const znakSilnika = () => znakTury || ({ silnik: endpoint, model: currentModel() || '' });

/* ============ ZDJĘCIA W ODPOWIEDZI – paski nad sekcjami (runda 10) ============
   Wiadomość z `zdjecia` (public/narzedzia.js) rysuje się RAZ: tekst Markdownem,
   a paski wstawiamy za nagłówkiem sekcji, pod którym stał znacznik (sekcja 0 –
   na samej górze, jak w ChatGPT). Tekst nie jest cięty, więc Kopiuj, Zapamiętaj,
   Regeneruj i eksport biorą całą odpowiedź.

   Paski PRZEŻYWAJĄ przebudowę rozmowy (it-plynnosc): każda przebudowa tworzyła
   od nowa 112 miniatur planu i telefon ściągał je wszystkie, a przyjście zdjęć
   jednego miejsca przebudowywało całą rozmowę. Teraz element paska z pamięci
   wraca na swoje miejsce, a grupa, która przyszła, podmienia tylko swój pasek. */
const elementyWiadomosci = new WeakMap();   // wiadomość → element .msg na ekranie
const paskiPamiec = new WeakMap();          // wiadomość → Map(sekcja → { klucz, el })
// Zdjęcia, które się nie wczytały (`niewczytane`), nie liczą się – pasek bez nich to inny pasek.
const kluczPaska = (grupy) => grupy.map((g) => {
  const fotki = (g.photos || []).filter((p) => p && !p.niewczytane);
  return `${g.q}|${g.stan}|${fotki.length}|${(fotki[0] || {}).thumb || ''}`;
}).join('§');
/** Stary zapis: zdjęcia z sieci jako osobna wiadomość { text: zapytanie, photos } (bez `dalej` – to archiwum). */
const zdjeciaZSieci = (m) => Boolean(m && m.role === 'assistant' && !m.search && m.content && typeof m.content === 'object'
  && Array.isArray(m.content.photos) && !m.content.dalej && !m.content.szukam && !m.content.run);
/** Pierwszy blok treści odpowiedzi – nad nim staje pasek sekcji 0. */
const pierwszyBlokTresci = (body) => [...body.children]
  .find((c) => !c.matches('details.think-block, .model-note, .msg-docs, .msg-images, .zdj-pasek')) || null;

/** Ostatnia tabela sekcji (od nagłówka – albo od początku – do następnego nagłówka) albo null. */
function tabelaSekcji(body, naglowek) {
  let tabela = null;
  for (let e = naglowek ? naglowek.nextElementSibling : body.firstElementChild; e; e = e.nextElementSibling) {
    if (/^H[1-4]$/.test(e.tagName)) break;
    if (e.tagName === 'TABLE') tabela = e;
  }
  return tabela;
}

function wstawPaski(body, m, zrodlo = m) {
  const grupy = Array.isArray(m.zdjecia) ? m.zdjecia : [];
  const naglowki = body.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4');
  // Nagłówek, którego nie ma (inny Markdown niż przy zapisie) – pasek na górę, nie w próżnię.
  const efektywna = (g) => { const n = Number(g.sekcja) || 0; return n > 0 && naglowki[n - 1] ? n : 0; };
  const poSekcjach = new Map();
  for (const g of [...grupy].sort((a, b) => (Number(a.po) || 0) - (Number(b.po) || 0))) {
    const n = efektywna(g);
    if (!poSekcjach.has(n)) poSekcjach.set(n, []);
    poSekcjach.get(n).push(g);
  }
  let pamiec = paskiPamiec.get(zrodlo);
  if (!pamiec) { pamiec = new Map(); paskiPamiec.set(zrodlo, pamiec); }
  const zostaja = new Set();
  for (const [n, gr] of [...poSekcjach].sort((a, b) => a[0] - b[0])) {
    const klucz = kluczPaska(gr);
    const zPamieci = pamiec.get(n);
    let pasek = zPamieci && zPamieci.klucz === klucz ? zPamieci.el : null;
    if (!pasek) {
      pasek = pasekZdjec(gr, grupy);
      if (pasek) { pasek.dataset.sekcja = String(n); pamiec.set(n, { klucz, el: pasek }); } else pamiec.delete(n);
    }
    const obecny = body.querySelector(`:scope > .zdj-pasek[data-sekcja="${n}"]`);
    if (!pasek) { if (obecny) obecny.remove(); continue; }
    zostaja.add(pasek);
    if (obecny === pasek) continue;
    if (obecny) obecny.replaceWith(pasek);
    else {
      /* Sekcja z tabelą (plan jako tabela, K5): pasek POD tabelą, nie nad nią –
         nad tabelą zdjęcia wszystkich dni stały przed planem, do którego należą
         (agencja-ux, runda 11, krok przejściowy przed wierszami zdjęć). */
      const tabela = tabelaSekcji(body, n > 0 ? naglowki[n - 1] : null);
      if (tabela) tabela.after(pasek);
      else if (n > 0) naglowki[n - 1].after(pasek);
      else body.insertBefore(pasek, pierwszyBlokTresci(body));
    }
  }
  for (const stary of body.querySelectorAll(':scope > .zdj-pasek')) if (!zostaja.has(stary)) stary.remove();
  /* Czego zabrakło – mówi Cosmos, bez rundy modelu. Dawniej robił to model
     w osobnej rundzie po zdjęciach („wisi w poszukiwaniu zdjęć”). */
  const stare = body.querySelector(':scope > .cosmos-uwagi');
  const uwagi = uwagiOdpowiedzi(m);
  if (stare) stare.remove();
  if (uwagi) {
    const przed = body.querySelector(':scope > .run-panel, :scope > .msg-bledu-akcje');
    body.insertBefore(uwagi, przed);
  }
}

function uwagiOdpowiedzi(m) {
  const grupy = Array.isArray(m.zdjecia) ? m.zdjecia : [];
  const nazwy = (lista) => lista.map((g) => g.etykieta || g.q).join(', ');
  const zdania = [];
  const brak = grupy.filter((g) => g.stan === 'brak');
  if (brak.length) {
    // Wyszukiwarki nie odpowiadają – to co innego niż „nie ma takich zdjęć”.
    const awaria = brak.every((g) => g.blad) && !grupy.some((g) => g.stan === 'gotowe');
    zdania.push(awaria ? t('chat.photosNoneErr') : t('photo.bezWynikow', { miejsca: nazwy(brak) }));
  }
  const pominiete = Array.isArray(m.zdjeciaPominiete) ? m.zdjeciaPominiete.filter(Boolean) : [];
  if (pominiete.length) zdania.push(t('photo.pominiete', { miejsca: pominiete.join(', ') }));
  // Odpowiedź-sierota: narzędzie (szukanie, plan, archiwum) miało ruszyć, gdy aplikacja była zamknięta.
  if (m.przerwaneNarzedzie) zdania.push(t('bieg.narzedzie'));
  if (!zdania.length) return null;
  const box = document.createElement('div');
  box.className = 'cosmos-uwagi';
  for (const zdanie of zdania) {
    const p = document.createElement('p');
    p.className = 'zdj-brak';
    p.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
    const tekst = document.createElement('span');
    tekst.textContent = zdanie;
    p.appendChild(tekst);
    box.appendChild(p);
  }
  return box;
}

/** Grupa zdjęć przyszła: podmień tylko paski tej wiadomości (bez przebudowy rozmowy). */
function odswiezPaski(w) {
  const msg = elementyWiadomosci.get(w);
  const body = msg && msg.isConnected ? msg.querySelector('.msg-content') : null;
  if (body) wstawPaski(body, w, w);
}

function messageElement(m, idx = -1, opcje = {}) {
  const role = m.role;
  const text = msgText(m);
  const images = msgImages(m);
  const isError = Boolean(m.error);

  const msg = document.createElement('div');
  msg.className = `msg msg-${role}` + (isError ? ' msg-error' : '') + (m.status ? ' msg-status' : '');
  if (idx >= 0) msg.dataset.idx = String(idx);

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.innerHTML = AVATAR_SVG;
    msg.appendChild(avatar);
    if (m.silnik) msg.dataset.silnik = m.silnik;
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
      : czyOtworz(m.actionType) ? t('open.action')
      : t('kb.record');
    msg.innerHTML =
      `<div class="action-card">` +
      `<div class="action-card-body"><span class="action-card-type ik ${czyOtworz(m.actionType) ? 'ik-link' : 'ik-blyskawica'}">${escapeHtml(label.replace(/^✦\s*/, ''))}</span>` +
      `<span class="action-card-text" title="${escapeHtml(m.actionText)}">${escapeHtml(m.actionText)}</span></div>` +
      (done
        ? `<span class="action-card-done">✓</span>`
        : `<div class="action-card-btns"><button class="btn-primary act-do">${t(czyOtworz(m.actionType) ? 'open.do' : 'actionDo')}</button>` +
          `<button class="btn-secondary act-skip">${t('actionSkip')}</button></div>`) +
      `</div>`;
    if (!done) {
      msg.querySelector('.act-do').addEventListener('click', () => runAction(m, msg));
      msg.querySelector('.act-skip').addEventListener('click', () => { m.done = 'skip'; saveConversations(); renderMessages(); });
    }
    return msg;
  }

  /* Notatki zespołu nie dostają własnego dymka – ich blok rysuje się
     w następnej odpowiedzi prowadzącego (renderMessages). */
  if (m.search && m.narzedzie === 'zespol') return null;
  // Polecenie dla modelu (K1) – „plan już policzony” na ekranie to kuchnia, nie treść.
  if (m.search && m.sterowanie) return null;

  if (m.search) {
    msg.className = 'msg msg-search';
    // Ikona zależna od narzędzia (plan – słońce zamiast lupy, agencja-ux, runda 11).
    if (m.narzedzie) msg.dataset.narzedzie = m.narzedzie;
    msg.innerHTML =
      `<details class="search-results"><summary>${m.narzedzie === 'plan' && podpisPlanu(text) ? escapeHtml(podpisPlanu(text))
        : (!m.narzedzie || m.narzedzie === 'szukaj')
        ? t('chat.searchResults', { q: escapeHtml(m.searchQuery || '') })
        : t('chat.toolResult', { n: t(`narzedzie.${m.narzedzie}`), q: escapeHtml(m.searchQuery || '') })}</summary>` +
      `<pre>${escapeHtml(text)}</pre></details>`;
    return msg;
  }

  if (isError) {
    body.textContent = text;
    // Zdanie serwera (z adresem – tylko u właściciela) zostaje w podpowiedzi, gdy na ekranie stoi tłumaczenie.
    if (m.szczegol) body.title = m.szczegol;
    // Zespół pracował, a prowadzący nie złożył odpowiedzi – wkład ról zostaje widoczny w karcie błędu.
    if (opcje.notatki) {
      msg.classList.add('msg-zespol-blad');
      body.prepend(blokZapisanegoZespolu(opcje.notatki));
    }
    msg.appendChild(body);
    // Błąd na końcu rozmowy – jedno kliknięcie zamiast przepisywania pytania.
    const conv = activeConv();
    if (idx >= 0 && conv && idx === conv.messages.length - 1) {
      /* Przyciski w jednym wierszu, „Wyślij przez Chmurę” PIERWSZY: przy
         uśpionym domu „Ponów” skończy się tym samym błędem. Ikony rysuje CSS
         (kropka silnika, maski SVG) – znaki ☁ ⚙ ↻ Android malował kolorowymi
         emoji (agencja, runda 9). */
      const akcje = document.createElement('div');
      akcje.className = 'msg-bledu-akcje';
      if (m.zapas === 'cloud') {
        const chmura = document.createElement('button');
        chmura.className = 'msg-action-btn msg-ponow msg-przez-chmure';
        chmura.textContent = t('chat.przezChmure');
        chmura.title = t('chat.przezChmureTytul');
        // Przełącza zakładkę na Chmurę jawnie – kolejne pytania też pójdą tam, co widać u góry.
        chmura.addEventListener('click', () => { setEndpoint('cloud'); regenerateFrom(idx); });
        akcje.appendChild(chmura);
      }
      const ponow = document.createElement('button');
      /* Błąd trwały (zły klucz, brak środków, model spoza rozmowy): „Ponów”
         zawsze skończy się tak samo – droga prowadzi do Ustawień. Limit budżetu
         od właściciela zmienia tylko on – wtedy zostaje sama „Chmura”. */
      if (m.budzet === 'wlasciciel') ponow.hidden = true;
      if (m.porzucony && m.bieg) {
        /* Bieg porzucony bez sieci: odpowiedź jest (albo zaraz będzie) na
           serwerze. „Ponów” pytało model od nowa – druga płatna tura za coś,
           co już zapłacone (it-plynnosc, runda 12). */
        ponow.className = 'msg-action-btn msg-ponow msg-pobierz ik ik-odswiez';
        ponow.textContent = t('chat.pobierzOdpowiedz');
        ponow.title = t('chat.pobierzOdpowiedzTytul');
        ponow.addEventListener('click', async () => {
          ponow.disabled = true;
          wrocOd = 0;                 // ręczna prośba – pełne okno ponowień od nowa
          wrocProba = 0;
          const wrocilo = await wrocPoOdpowiedz();
          if (!wrocilo && ponow.isConnected) ponow.disabled = false;
        });
      } else if (m.trwaly) {
        ponow.className = 'msg-action-btn msg-ponow ik ik-trybik';
        // Budżet w złotówkach ustawia się w Ustawienia → Agenci, nie w silnikach.
        ponow.textContent = t(m.budzet ? 'chat.doBudzetu' : 'chat.doUstawien');
        ponow.addEventListener('click', () => openSettings(m.budzet ? 'agenci' : 'silniki'));
      } else {
        ponow.className = 'msg-action-btn msg-ponow ik ik-odswiez';
        ponow.textContent = t('chat.ponow');
        ponow.addEventListener('click', () => regenerateFrom(idx));
      }
      akcje.appendChild(ponow);
      // Notatki są, zawiódł tylko prowadzący – „Złóż ponownie” pisze od nowa z tych samych notatek.
      if (opcje.notatki && String(opcje.notatki.m.content || '').trim()) {
        const zloz = document.createElement('button');
        zloz.className = 'msg-action-btn msg-ponow';
        zloz.textContent = t('ag.zlozPonownie');
        zloz.title = t('ag.regenerujTitle');
        zloz.addEventListener('click', () => zlozPonownie(opcje.notatki.idx));
        akcje.appendChild(zloz);
      }
      body.appendChild(akcje);
    }
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

  /* Tok myślenia zapisany przy wiadomości – zwinięty, żeby nie przykrywał
     odpowiedzi, ale dostępny, gdy chce się zobaczyć, czym model się zajmował.
     Wyjątek: gdy myślenie to WSZYSTKO, co przyszło (`samoMyslenie`), zwinięcie
     zostawia wiadomość złożoną z samego ostrzeżenia. Wtedy panel jest otwarty –
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
  // Siatka zostaje dla archiwum (z „pokaż kolejne”); zdjęcia z sieci stoją w paskach nad sekcjami.
  const photos = msgPhotos(m);
  if (photos.length) {
    body.appendChild(photosGrid(photos));
    const dalej = stopkaArchiwum(m);
    if (dalej) body.appendChild(dalej);
  }
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
      chip.classList.add('ik', 'ik-dokument');
  chip.textContent = `${d.name} · ${t('doc.chars', { n: (d.chars || 0).toLocaleString() })}`;
      chip.title = t('doc.peek');
      // Podgląd na żądanie: wysłaną treść trzeba móc sprawdzić, ale nie
      // kosztem zalania rozmowy ośmioma tysiącami znaków umowy.
      chip.addEventListener('click', () => openTextViewer(d.name, d.text));
      lista.appendChild(chip);
    }
    body.prepend(lista);
  }
  if ((Array.isArray(m.zdjecia) && m.zdjecia.length) || (m.zdjeciaPominiete || []).length || m.przerwaneNarzedzie) {
    wstawPaski(body, m, opcje.zrodlo || m);
  }

  const col = document.createElement('div');
  col.className = 'msg-kolumna';
  col.style.flex = '1';
  col.style.minWidth = '0';
  const podpis = !isError && podpisSilnika(m.silnik, m.model, Boolean(opcje.notatki));
  if (podpis) col.appendChild(podpis);
  // Blok „Zespół” z notatek tej tury – wewnątrz nici prowadzącego, pod podpisem.
  const stZespolu = opcje.notatki ? ZESPOL.stanZWiadomosci(opcje.notatki.m) : null;
  if (stZespolu) col.appendChild(blokZapisanegoZespolu(opcje.notatki, stZespolu));
  /* Przyciski tylko pod OSTATNIĄ wypowiedzią tury. Pasek postępu („Szukam…")
     i kroki pośrednie to nie odpowiedź – pięć „Regeneruj" pod jedną
     odpowiedzią i „Zapamiętaj" przy „Przeszukuję archiwum…" to szum. */
  const nastepna = idx >= 0 ? nastepnaWidoczna(activeConv()?.messages || [], idx) : null;
  const srodekTury = m.status || (nastepna && (nastepna.role === 'assistant'
    || (nastepna.role === 'user' && nastepna.search)));
  // Zastąpiona wersja (odpowiedź solo przed zespołem, szkic przed danymi) – na górze tej samej karty.
  col.append(...wersjePoprzednie(m));
  col.append(body);
  if (stZespolu) {
    const nota = zespolWidok.notaBezWkladu(stZespolu, () => ponowZespolem(opcje.notatki.idx, { sklad: ZESPOL.skladDoWyslania(stZespolu.role) }));
    if (nota) col.append(nota);
  }
  // Stara odpowiedź sklejona z kawałków: „Regeneruj” tnie od PIERWSZEGO kawałka, nie od ostatniego.
  if (!srodekTury) col.append(messageActions(text, { copy: true, role: 'assistant', idx: opcje.idxAkcji ?? idx, zespol: Boolean(stZespolu) || opcje.poZespole }));
  msg.appendChild(col);
  elementyWiadomosci.set(opcje.zrodlo || m, msg);
  return msg;
}

/** Ślad planu (K4): „Plan zdjęciowy · Taormina · 15 wrz 2027” z danych, które
 *  dostał model – zamiast „Plan zdjęciowy – dane dla modelu: plan zdjęciowy”. */
function podpisPlanu(tresc) {
  const i = String(tresc || '').indexOf('{');
  if (i < 0) return '';
  let d;
  try { d = JSON.parse(String(tresc).slice(i)); } catch { return ''; }
  const dane = d && d.dane && typeof d.dane === 'object' ? d.dane : d;
  if (!dane || typeof dane !== 'object' || dane.error) return '';
  const jezyk = getLang() === 'en' ? 'en-GB' : 'pl-PL';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dane.kiedy || ''));
  const dzien = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
    .toLocaleDateString(jezyk, { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\.$/, '') : '';
  return [t('ag.planLinia'), typeof dane.miejsce === 'string' && dane.miejsce ? dane.miejsce.slice(0, 80) : t('ag.planTutaj'), dzien]
    .filter(Boolean).join(' · ');
}

/** Poprzednie wersje odpowiedzi (K6) – zwinięta linijka na górze karty:
 *  kropka w kolorze STAREGO silnika, powód i „20:05 · 1 240 znaków”.
 *  Rozwinięta – stara treść przygaszona (agencja-ux, decyzja 4). */
function wersjePoprzednie(m) {
  const lista = Array.isArray(m.poprzednie) ? m.poprzednie.filter((p) => p && String(p.content || '').trim()) : [];
  return lista.map((p) => {
    const d = document.createElement('details');
    d.className = 'wersja-poprzednia';
    if (p.silnik) d.style.setProperty('--kw', `var(--k-${p.silnik === 'cloud' ? 'nvidia' : p.silnik})`);
    const s = document.createElement('summary');
    const kropka = document.createElement('span');
    kropka.className = 'kropka';
    const tytul = document.createElement('span');
    tytul.className = 'tytul';
    tytul.textContent = t(p.powod === 'bez-zespolu' ? 'wersja.bezZespolu' : p.powod === 'szkic' ? 'wersja.szkic' : 'wersja.poprzednia');
    const meta = document.createElement('span');
    meta.className = 'meta';
    const jezyk = getLang() === 'en' ? 'en-GB' : 'pl-PL';
    const czas = p.kiedy ? new Date(p.kiedy).toLocaleTimeString(jezyk, { hour: '2-digit', minute: '2-digit' }) : '';
    meta.textContent = [
      p.silnik ? nazwaSilnika(p.silnik) : '',
      p.powod === 'przerwana' ? t('wersja.przerwana') : '',
      czas,
      t('doc.chars', { n: String(p.content).length.toLocaleString(jezyk) }),
      typeof p.kosztZl === 'number' && p.kosztZl > 0 ? ZESPOL.kwotaZl(p.kosztZl, getLang()) : '',
    ].filter(Boolean).join(' · ');
    s.append(kropka, tytul, meta);
    const tresc = document.createElement('div');
    tresc.className = 'tresc md';
    tresc.innerHTML = renderMarkdown(stripSearchMarker(String(p.content)));
    d.append(s, tresc);
    return d;
  });
}

function messageActions(text, { copy, role, idx = -1, zespol = false }) {
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
    /* Ikony liniowe (maski SVG jak reszta interfejsu), nie znaki „✦ ✎ ↻” –
       miały inną grubość i linię bazową, a Android rysował je jako emoji
       (agencja-ux, runda 10; zrzut 3 Marcina). */
    const remBtn = document.createElement('button');
    remBtn.className = 'msg-action-btn ik ik-iskra';
    remBtn.textContent = t('remember');
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

  // Regeneruj – dla wiadomości asystenta (usuwa ją i generuje na nowo)
  if (role === 'assistant' && idx >= 0) {
    const regen = document.createElement('button');
    regen.className = 'msg-action-btn ik ik-odswiez';
    regen.textContent = t('regenerate');
    // Pod odpowiedzią zespołu „Regeneruj” pisze od nowa z tych samych notatek (bez drugiego zespołu).
    if (zespol) regen.title = t('ag.regenerujTitle');
    regen.addEventListener('click', () => regenerateFrom(idx));
    actions.appendChild(regen);
  }

  // Edytuj – dla wiadomości użytkownika (wczytuje do pola, obcina dalej)
  if (role === 'user' && idx >= 0) {
    const edit = document.createElement('button');
    edit.className = 'msg-action-btn ik ik-pedzel';
    edit.textContent = t('editMsg');
    edit.addEventListener('click', () => editFrom(idx));
    actions.appendChild(edit);
  }

  return actions;
}

/** Czy wolno otworzyć stronę bez kliknięcia (patrz domknijOdpowiedz). */
function mozeSamOtworzyc(conv, tekst) {
  const adres = adresDoOtwarcia(tekst);
  if (!adres || adresPrywatny(adres)) return false;
  // Parametry w adresie to kanał na dane osoby – taki adres tylko z kliknięciem.
  const u = new URL(adres);
  if (u.search || u.hash || u.username || u.password) return false;
  const tura = conv.messages.slice(conv.__turaOd || 0);
  if (tura.some((m) => m.role === 'user' && m.search)) return false;      // w turze był wynik narzędzia
  const pytanie = [...conv.messages.slice(0, conv.__turaOd || conv.messages.length)].reverse().find((m) => m.role === 'user' && !m.search);
  const tresc = bezOgonkowKlient(pytanie ? msgText(pytanie) : '');
  const host = u.hostname.replace(/^www\./, '');
  const rdzen = host.split('.').slice(-2, -1)[0] || host;
  return /(otworz|otwórz|wejdz|wejdź|odpal|uruchom|pokaz strone|pokaż stronę|open|go to)/.test(tresc)
    && (tresc.includes(host) || new RegExp(`(^|[^a-z0-9])${rdzen}([^a-z0-9]|$)`).test(tresc));
}

/** Otwórz stronę w nowej karcie. Zwraca true, gdy przeglądarka ją otworzyła
 *  (false: zablokowane okno albo adres, który nie jest stroną http/https). */
function otworzStrone(tekst) {
  const adres = adresDoOtwarcia(tekst);
  if (!adres) return false;
  /* Bez 'noopener' w trzecim argumencie: z nim window.open zawsze zwraca null
     i nie dałoby się odróżnić otwartej karty od zablokowanej. Odcinamy
     opener ręcznie – otwarta strona nie dostaje dostępu do Cosmosa. */
  const okno = window.open(adres, '_blank');
  if (!okno) return false;
  try { okno.opener = null; } catch { /* inna domena – i tak bez dostępu */ }
  return true;
}

async function runAction(m, msgEl) {
  const btn = msgEl.querySelector('.act-do');
  if (btn) btn.disabled = true;
  try {
    if (czyOtworz(m.actionType)) {
      if (otworzStrone(m.actionText)) { m.done = true; saveConversations(); renderMessages(); }
      else if (btn) btn.disabled = false;
      return;
    }
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
  // Usuń tę odpowiedź i wszystko po niej; pod błędem – całą turę po pytaniu (protokol.js).
  conv.messages = conv.messages.slice(0, granicaPonowienia(conv.messages, idx));
  saveConversations();
  renderMessages();
  runGeneration(conv);
}

// Edycja w toku: od której wiadomości zostanie ucięta historia przy wysłaniu.
let edycjaOd = null;
/* Tryb edycji był niewidoczny i bez wyjścia: „Edytuj”, wyczyszczenie pola
   i nowe pytanie kasowało po cichu poprzednie pytanie i odpowiedź (zespół IT,
   runda 5). Teraz pasek nad polem, „Anuluj”, Escape i puste pole kończą edycję. */
function pokazEdycje(tak) {
  const pasek = $('edycja-bar');
  if (pasek) pasek.hidden = !tak;
}
function anulujEdycje({ wyczysc = false } = {}) {
  if (!edycjaOd) return;
  edycjaOd = null;
  pokazEdycje(false);
  if (wyczysc) { el.input.value = ''; autosizeInput(); updateSendButton(); }
}
$('edycja-anuluj')?.addEventListener('click', () => { anulujEdycje({ wyczysc: true }); el.input.focus(); });
el.input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && edycjaOd) { e.preventDefault(); anulujEdycje({ wyczysc: true }); } });
el.input.addEventListener('input', () => { if (edycjaOd && !el.input.value.trim()) anulujEdycje(); });

function editFrom(idx) {
  const conv = activeConv();
  if (!conv || isGenerating) return;
  const m = conv.messages[idx];
  if (!m) return;
  const text = msgText(m);
  const images = msgImages(m);
  /* Historię tniemy dopiero przy WYSŁANIU poprawionej wiadomości. Cięcie
     przy samym kliknięciu „Edytuj" kasowało dalszą rozmowę od razu i na
     serwerze – kto się rozmyślił, tracił wszystko bez ostrzeżenia. */
  edycjaOd = { convId: conv.id, idx };
  pokazEdycje(true);
  pendingImages = images.length ? [...images] : pendingImages;
  renderAttachments();
  el.input.value = text;
  autosizeInput();
  updateSendButton();
  el.input.focus();
}

/* Wiersz „Zdjęcia z sieci – dane dla modelu” to kuchnia, nie treść. W starych
   rozmowach kończył odpowiedź (zrzut 4 Marcina), a pod nim nie było już ani
   Kopiuj, ani Regeneruj – wiersz uchodził za środek tury. */
const ukrytyWynikZdjec = (m) => Boolean(m && m.search && (m.narzedzie === 'grafiki' || m.sterowanie));
/** Następna wiadomość, którą widać na ekranie (bez ukrytych wierszy narzędzia zdjęć). */
function nastepnaWidoczna(wiadomosci, idx) {
  for (let i = idx + 1; i < wiadomosci.length; i++) {
    if (!ukrytyWynikZdjec(wiadomosci[i]) && !toSzkielet(wiadomosci[i])) return wiadomosci[i];
  }
  return null;
}

/** Rozmowa do wyświetlenia. Stary zapis planu pokrojonego siatkami (kawałki
 *  tekstu i osobne wiadomości { text: zapytanie, photos }) staje się JEDNĄ
 *  odpowiedzią z paskami – bez migracji zapisanych rozmów (runda 10). Model
 *  i tak dostawał te kawałki sklejone w jedną wypowiedź (toApiMessages).
 *  @returns {Array<{m: object, idx: number, idxAkcji?: number, zrodlo?: object}>} */
function jednostkiRozmowy(wiadomosci) {
  const wynik = [];
  const kawalek = (m) => Boolean(m && m.role === 'assistant' && !m.status && !m.error && !m.search && !m.komunikatCosmosa
    && !Array.isArray(m.zdjecia) && (typeof m.content === 'string' || zdjeciaZSieci(m)));
  for (let i = 0; i < wiadomosci.length; i++) {
    const m = wiadomosci[i];
    if (!kawalek(m)) { wynik.push({ m, idx: i }); continue; }
    const czlonkowie = [i];
    for (let j = i + 1; j < wiadomosci.length; j++) {
      if (ukrytyWynikZdjec(wiadomosci[j]) || toSzkielet(wiadomosci[j])) continue;
      if (!kawalek(wiadomosci[j])) break;
      czlonkowie.push(j);
    }
    if (!czlonkowie.some((k) => zdjeciaZSieci(wiadomosci[k]))) { wynik.push({ m, idx: i }); continue; }
    let tekst = '';
    const zdjecia = [];
    const pierwszaZ = (pole) => czlonkowie.map((k) => wiadomosci[k][pole]).find(Boolean);
    for (const k of czlonkowie) {
      const w = wiadomosci[k];
      if (zdjeciaZSieci(w)) {
        const q = String(w.content.text || '');
        zdjecia.push({ q, etykieta: q, po: tekst.length, photos: w.content.photos, stan: w.content.photos.length ? 'gotowe' : 'brak' });
        continue;
      }
      const c = String(w.content || '');
      if (c.trim()) tekst = tekst ? `${tekst}\n\n${c}` : c;
    }
    for (const g of zdjecia) g.sekcja = sekcjaWPozycji(tekst, g.po);
    const sklejona = {
      role: 'assistant', content: tekst, zdjecia,
      silnik: pierwszaZ('silnik'), model: pierwszaZ('model'), think: pierwszaZ('think'), note: pierwszaZ('note'),
    };
    const ostatni = czlonkowie[czlonkowie.length - 1];
    wynik.push({ m: sklejona, idx: ostatni, idxAkcji: i, zrodlo: m });
    i = ostatni;
  }
  return wynik;
}

/** Zdjęcia zapisane „do pobrania” (sierota z serwera, odświeżenie w fazie
 *  zdjęć) – dociągane po otwarciu rozmowy, bez modelu i bez kosztu. */
const dociagane = new WeakSet();
function dociagnijZdjecia(conv) {
  if (!conv || isGenerating) return;
  const doPobrania = conv.messages.filter((m) => Array.isArray(m.zdjecia) && !dociagane.has(m)
    && m.zdjecia.some((g) => g.stan === 'do-pobrania'));
  if (!doPobrania.length) return;
  // Po bieżącym zadaniu: renderMessages bywa wołane, zanim rejestr narzędzi powstanie.
  setTimeout(() => {
    const g = NARZEDZIA.find((n) => n.nazwa === 'grafiki');
    for (const m of doPobrania) {
      if (dociagane.has(m)) continue;
      dociagane.add(m);
      g.dociagnij(conv, m).finally(() => dociagane.delete(m));
    }
  }, 0);
}

/* Fokus klawiatury przeżywa przebudowę rozmowy: ta sama kontrolka tej samej
   wiadomości (data-idx). Dawniej `innerHTML = ''` zrzucał go na <body> i następny
   Tab zaczynał od góry strony (agencja-frontend, runda 11). */
function zapamietajFokus() {
  const a = document.activeElement;
  if (!a || a === el.messages || !el.messages.contains(a)) return null;
  const karta = a.closest('[data-idx]');
  if (!karta) return null;
  const sel = a.tagName.toLowerCase() + [...a.classList].map((k) => `.${CSS.escape(k)}`).join('');
  const n = [...karta.querySelectorAll(sel)].indexOf(a);
  return { idx: karta.dataset.idx, sel, n };
}
function przywrocFokus(f) {
  if (!f) return;
  const karta = el.messages.querySelector(`[data-idx="${f.idx}"]`);
  const cel = karta && karta.querySelectorAll(f.sel)[f.n];
  if (cel) cel.focus({ preventScroll: true });
}

/** Karta odpowiedzi, która właśnie się pisze (streamOnce): { el, conv } – do odłożenia z powrotem po przebudowie. */
let zywyDymek = null;

function renderMessages({ przewin = true } = {}) {
  const conv = activeConv();
  // Kto czyta wyżej, zostaje tam po przebudowie – bez tego innerHTML = '' ustawiał widok na samą górę.
  const byloScroll = el.chatScroll.scrollTop;
  // Płótno należy do rozmowy, więc przy przełączeniu musi się przełączyć –
  // inaczej przy nowej rozmowie zostaje na ekranie cudzy dokument.
  pokazPlotno(conv);
  const fokus = zapamietajFokus();
  el.messages.innerHTML = '';
  const hasMessages = conv && conv.messages.length > 0;
  el.welcome.style.display = hasMessages ? 'none' : '';
  const exportBtn = $('export-btn');
  if (exportBtn) exportBtn.style.display = hasMessages ? '' : 'none';
  const sumBtn = $('summarize-btn');
  if (sumBtn) sumBtn.style.display = hasMessages ? '' : 'none';
  updateTokenEstimate();
  if (!hasMessages) return;

  /* Notatki zespołu czekają na pierwszą odpowiedź prowadzącego (albo kartę
     błędu) swojej tury; bez odpowiedzi – własna karta z samym blokiem. */
  let notatki = null;
  let poZespole = false;
  jednostkiRozmowy(conv.messages).forEach(({ m, idx, idxAkcji, zrodlo }) => {
    // Szkielet siatki po przerwanym szukaniu – nic już na niego nie przyjdzie.
    if (toSzkielet(m) && !isGenerating) return;
    if (ukrytyWynikZdjec(m)) return;
    if (m.search && m.narzedzie === 'zespol') {
      if (notatki) el.messages.appendChild(kartaSamegoZespolu(notatki));
      notatki = { m, idx };
      poZespole = true;
      return;
    }
    if (m.role === 'user' && !m.search) {
      if (notatki) el.messages.appendChild(kartaSamegoZespolu(notatki));
      notatki = null;
      poZespole = false;
    }
    /* Prawdziwy wynik narzędzia albo pasek postępu, zanim prowadzący cokolwiek
       napisał (sam znacznik): blok zespołu staje PRZED nimi, we własnej karcie –
       tak jak szedł na żywo (zespół pracował pierwszy). Dawniej ślad planu
       stał nad blokiem (agencja-frontend, runda 11). */
    if (notatki && (m.status || m.search)) {
      el.messages.appendChild(kartaSamegoZespolu(notatki, { bezBledu: true }));
      notatki = null;
    }
    const dlaZespolu = notatki && m.role === 'assistant' && !m.status ? notatki : null;
    if (dlaZespolu) notatki = null;
    const e = messageElement(m, idx, { notatki: dlaZespolu, poZespole, idxAkcji, zrodlo });
    if (e) el.messages.appendChild(e);
  });
  if (notatki) el.messages.appendChild(kartaSamegoZespolu(notatki));
  /* Żywy dymek (streamOnce) nie należy do conv.messages, więc przebudowa
     w trakcie rundy (zapis z 409, wynik narzędzia, zmiana bloku) wyrzucała
     go z DOM-u: myślenie i tekst pisały się dalej do odłączonego elementu,
     a na ekranie było pusto do końca tury (agencja-frontend, runda 11, P2). */
  if (isGenerating && zywyDymek && zywyDymek.conv === conv && !zywyDymek.el.isConnected) el.messages.appendChild(zywyDymek.el);
  dolozPropozycjeZespolu(conv);
  dociagnijZdjecia(conv);
  przywrocFokus(fokus);
  if (przewin) scrollToBottom(true);
  else { el.chatScroll.scrollTop = byloScroll; ostatniScrollTop = byloScroll; }
}

/* Czy człowiek „jedzie" razem z odpowiedzią na dole rozmowy. Decydują
   o tym JEGO ruchy, nie odległość od dołu liczona po fakcie: gdy odpowiedź
   rośnie szybciej, niż da się przewinąć, odległość myli się w jedną stronę
   i widok zostaje w tyle na zawsze. W górę widok może pojechać tylko ręką
   człowieka – program przewija wyłącznie w dół – więc ruch w górę wyłącza
   jazdę, a powrót na sam dół ją włącza. */
let sledzeDol = true;
let ostatniScrollTop = 0;
const przyDole = () => {
  const sc = el.chatScroll;
  return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
};

function scrollToBottom(force = false) {
  const sc = el.chatScroll;
  if (force) sledzeDol = true;
  if (sledzeDol) sc.scrollTop = sc.scrollHeight;
  ostatniScrollTop = sc.scrollTop;
}

el.chatScroll.addEventListener('scroll', () => {
  const sc = el.chatScroll;
  /* Ruch w górę, który kończy się DOKŁADNIE na dole, to nie człowiek, tylko
     przeglądarka przycinająca przewinięcie po skurczeniu treści (zwinięty blok
     zespołu, zniknięty szkielet, zwinięte „Myślę…”). Dawniej wyłączało to
     jazdę na dole na resztę tury (it-plynnosc, runda 11). */
  const naSamymDole = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 2;
  if (sc.scrollTop < ostatniScrollTop - 4 && !naSamymDole) sledzeDol = false;
  else if (przyDole()) sledzeDol = true;
  ostatniScrollTop = sc.scrollTop;
}, { passive: true });
el.chatScroll.addEventListener('wheel', (e) => { if (e.deltaY < 0) sledzeDol = false; }, { passive: true });

// ----------------------------------------------------------------
// Operacje na rozmowach
// ----------------------------------------------------------------

// Na wąskich ekranach panel boczny to nakładka – zwiń go po akcji nawigacyjnej.
/* Ten sam warunek co blok szuflady w style.css – zmieniasz jeden, zmieniasz oba.
   Telefon w poziomie (740×313) ma szerokość komputera, ale panel stojący obok
   rozmowy zabierał mu 272 px i Ustawienia były poza ekranem (agencja, runda 9). */
const SZUFLADA = '(max-width: 720px), (orientation: landscape) and (max-height: 500px) and (pointer: coarse)';
function collapseSidebarOnMobile() {
  if (window.matchMedia(SZUFLADA).matches) {
    el.sidebar.classList.add('collapsed');
    document.querySelector('.app').classList.add('sidebar-hidden');
  }
}

/* PRZEŁĄCZENIE W TRAKCIE ODPOWIEDZI. Dawniej „Nowa rozmowa” i wybór innej
   rozmowy wołały stop – odpowiedź była ucinana po cichu, a po powrocie stało
   samo pytanie (zespół IT, runda 5). Teraz odchodzi tylko widz: serwer pisze
   dalej i sam zapisze odpowiedź w tamtej rozmowie (lib/biegi.js), a po powrocie
   podpinamy się do biegu i widać ją na żywo. */
const biegiWTle = new Map();   // id rozmowy → id biegu, od którego odszedł widz
let odlaczanie = false;
function odlaczOdBiegu() {
  const b = biegBiezacy;
  if (b && b.id && b.convId) biegiWTle.set(b.convId, b.id);
  odlaczanie = true;
  turaPrzerwana = true;           // kolejnych rund narzędzi ta karta już nie prowadzi
  zapamietajBieg(null);
  if (abortController) abortController.abort();
}

/** Po powrocie do rozmowy, od której odszedł widz: podepnij się do jej biegu. */
async function podepnijBiegWTle(id) {
  const biegId = biegiWTle.get(id);
  if (!biegId || isGenerating) return;
  biegiWTle.delete(id);
  let b = null;
  try {
    const r = await fetch('/api/chat/biegi');
    if (r.ok) b = ((await r.json()).biegi || []).find((x) => x.id === biegId) || null;
  } catch { return; }
  if (activeId !== id || !activeConversation) return;
  // Skończony i zapisany przez serwer – wersja z serwera (już wczytana) ma odpowiedź.
  if (!b || (!b.trwa && b.zapisany)) {
    if (b || !activeConversation.messages.some((m) => m.role === 'assistant' && !m.error)) {
      const r = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`).catch(() => null);
      if (r && r.ok && activeId === id) { activeConversation = naprawStareRuchyNarzedzi(await r.json()); renderMessages(); }
    }
    return;
  }
  await runGeneration(activeConversation, { bieg: biegId, od: 0 });
}

function newConversation() {
  if (isGenerating) odlaczOdBiegu();
  anulujEdycje();
  activeId = null;
  renderKolejka();
  zapamietajOstatnia(null);
  activeConversation = null;
  renderSidebar();
  renderMessages();
  collapseSidebarOnMobile();
  el.input.focus();
}

/* Rozmowy zapisane, zanim ruch narzędzia dostał flagę `search`, wciąż mają
   w środku dymek z pytaniem, którego nikt nie zadał. Poprawka w kodzie ich nie
   naprawi – siedzą już na dysku. Domykamy je przy wczytaniu; to zmiana tylko
   w wyglądzie, treść dalej idzie do modelu tak samo. */
const PREFIKSY_NARZEDZI = [
  'UWAGA: to jest DOKŁADNIE to samo zapytanie do archiwum',
  'WYNIK Z ARCHIWUM UŻYTKOWNIKA',
  'WYNIKI WYSZUKIWANIA',
  'WYSZUKIWANIE GRAFIK NIE DAŁO WYNIKÓW',
  'DANE PLANU ZDJĘCIOWEGO',
];
/* Szkielet siatki („szukam zdjęć”) żyje tylko w trakcie szukania. Zapisany
   wisiał po przerwaniu albo odświeżeniu na zawsze jako cztery szare pola
   (agencja, runda 7) – dlatego do zapisu idzie rozmowa bez nich. */
function toSzkielet(m) { return Boolean(m && m.content && typeof m.content === 'object' && m.content.szukam); }
/* Grupa zdjęć w drodze („szukam”) idzie do zapisu jako „do-pobrania”: karta
   ubita przez Androida w fazie zdjęć gubiła WSZYSTKIE zdjęcia tury, także te
   już pokazane (it-plynnosc, runda 10). Po powrocie brakujące dociągają się same. */
const wLocie = (m) => Array.isArray(m.zdjecia) && m.zdjecia.some((g) => g.stan === 'szukam');
function doZapisu(conv) {
  if (!conv.messages.some((m) => toSzkielet(m) || wLocie(m))) return conv;
  return {
    ...conv,
    messages: conv.messages.filter((m) => !toSzkielet(m)).map((m) => (wLocie(m)
      ? { ...m, zdjecia: m.zdjecia.map((g) => (g.stan === 'szukam' ? { ...g, stan: 'do-pobrania' } : g)) } : m)),
  };
}

function naprawStareRuchyNarzedzi(conv) {
  if (!conv?.messages) return conv;
  conv.messages = conv.messages.filter((m) => !toSzkielet(m));
  for (const m of conv.messages) {
    if (m.role !== 'user' || m.search || typeof m.content !== 'string') continue;
    if (PREFIKSY_NARZEDZI.some((p) => m.content.startsWith(p))) {
      m.search = true;
      m.searchQuery = m.searchQuery || t('chat.archiveQuery');
    }
  }
  return conv;
}

/* Ostatnio otwarta rozmowa – żeby zwykłe odświeżenie strony nie wyrzucało
   na ekran powitalny. Tylko na chwilę (pół godziny): kto wraca następnego
   dnia, zaczyna od czystej karty. Klucz `cosmos.conv.…` czyści konta.js przy
   zmianie osoby, więc nikt nie zobaczy cudzej rozmowy. */
const OSTATNIA_KLUCZ = 'cosmos.conv.ostatnia';
const OSTATNIA_WAZNA_MS = 30 * 60 * 1000;
function zapamietajOstatnia(id) {
  try {
    if (id) localStorage.setItem(OSTATNIA_KLUCZ, JSON.stringify({ id, kiedy: Date.now() }));
    else localStorage.removeItem(OSTATNIA_KLUCZ);
  } catch { /* prywatne okno */ }
}
async function przywrocOstatnia() {
  if (activeId) return;
  let z = null;
  try { z = JSON.parse(localStorage.getItem(OSTATNIA_KLUCZ) || 'null'); } catch { /* śmieci */ }
  if (!z || !z.id || Date.now() - (z.kiedy || 0) > OSTATNIA_WAZNA_MS) return;
  if (!conversations.some((c) => c.id === z.id)) return;
  await selectConversation(z.id);
}

async function selectConversation(id) {
  if (isGenerating && activeId !== id) odlaczOdBiegu();
  if (activeId !== id) anulujEdycje();
  activeId = id;
  renderKolejka();   // kolejka pokazuje pozycje TEJ rozmowy
  zapamietajOstatnia(id);
  renderSidebar();
  collapseSidebarOnMobile();
  /* Od razu kopia z przeglądarki, jeśli jest – bez pustego ekranu i skoku
     układu, gdy dojdzie wersja z serwera (na telefonie CLS do 1,17). */
  const kopia = naprawStareRuchyNarzedzi(loadJson('cosmos.conv.' + id, null));
  if (kopia) {
    activeConversation = kopia;
    renderMessages();
  } else {
    el.messages.innerHTML = '';
    el.welcome.style.display = 'none';
  }
  let zSerwera = null;
  try {
    const res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error();
    zSerwera = naprawStareRuchyNarzedzi(await res.json());
  } catch { /* offline – zostaje kopia */ }
  /* Człowiek mógł w tym czasie stuknąć inną rozmowę. Bez tego sprawdzenia
     panel podświetlał B, na ekranie stała A, a następna wiadomość zapisywała
     się w A – najwolniejsza odpowiedź wygrywała wyścig. */
  if (activeId !== id) return;
  if (!zSerwera) {
    if (!kopia) { activeConversation = null; renderMessages(); }
    else ruszKolejke();
    return;
  }
  const taSama = kopia && kopia.updatedAt === zSerwera.updatedAt
    && (kopia.messages || []).length === (zSerwera.messages || []).length;
  wersjaNaSerwerze.set(id, zSerwera.updatedAt);
  /* Kopia z przeglądarki, której zapis się nie udał, jest NOWSZA niż wersja
     z serwera – scalamy i zapisujemy jeszcze raz, zamiast ją zgubić. */
  if (kopia && niezapisane().has(id) && (kopia.updatedAt || 0) > (zSerwera.updatedAt || 0)) {
    activeConversation = scalRozmowy(kopia, zSerwera);
    renderMessages();
    zapiszNaSerwerze(id, activeConversation);
    ruszKolejke();
    return;
  }
  activeConversation = zSerwera;
  if (!taSama) renderMessages();
  if (biegiWTle.has(id)) { podepnijBiegWTle(id); return; }
  // Pytania wpisane w TEJ rozmowie, które czekały, aż do niej wrócisz.
  ruszKolejke();
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
    zapamietajOstatnia(null);
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
    zapamietajOstatnia(activeId);
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
    const res = serwerOdpowiedzial(await fetch('/api/conversations'));
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
  /* Rozmowy z czasów sprzed serwera należą do właściciela tego urządzenia.
     Gdyby migrację odpalił gość zalogowany na telefonie Marcina, wysłałaby
     cudze rozmowy na JEGO konto. */
  const ja = konta_.ja();
  if (ja && ja.rola !== 'wlasciciel') return;
  const legacy = loadJson(STORAGE_KEYS.conversations, []);
  for (const conv of legacy) {
    if (!conv || !conv.id) continue;
    try {
      await fetch(`/api/conversations?id=${encodeURIComponent(conv.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...conv, updatedAt: conv.updatedAt || conv.createdAt || Date.now() }),
      });
    } catch { /* pominąć – serwer offline, spróbujemy następnym razem */ }
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
   modelu, który go nie zobaczy, a odpowiedź będzie zmyślona – lepiej powiedzieć
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
  note.textContent = '⚠︎ ' + t('model.blindWarn');
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
   klatki, które przeglądarka potrafi wyjąć sama – <video> + <canvas> to
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
 * odmawia – i bez tego sprawdzenia dostajesz komunikat „ta przeglądarka nie
 * zna tego kodowania", z którego nie wynika ANI co jest nie tak, ani co
 * z tym zrobić. A rada jest bardzo konkretna: nagrywaj proxy w H.264 albo
 * doinstaluj rozszerzenie HEVC.
 */
function kodekZnany(file) {
  const v = document.createElement('video');
  if (!v.canPlayType) return true;                 // nie wiadomo – próbujemy
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

    /* Długość bywa nieznana – pliki nagrywane strumieniowo (webm z przeglądarki,
       przerwany transfer) nie mają jej w nagłówku i `duration` to Infinity.
       Materiał z aparatu i drona zawsze ją ma, ale klip nagrany telefonem przez
       stronę WWW – niekoniecznie.

       Ratunek jest znany i tani: przewinięcie na absurdalnie odległy moment
       zmusza przeglądarkę do przejrzenia pliku do końca, po czym `duration`
       nagle jest znane. Brzmi jak sztuczka, bo jest sztuczką – ale różnica
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
    // Plik, którego nie da się odczytać, znika z listy – ale z powodem.
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

/** Czy pytanie bieżącej tury niesie klatkę z kamery dołączoną automatycznie. */
function klatkaWTurze(conv) {
  const pytanie = [...conv.messages].reverse().find((m) => m.role === 'user' && !m.search);
  return Boolean(pytanie && pytanie.content && typeof pytanie.content === 'object' && pytanie.content.klatka);
}

/** Pytania, po których stoi SAM dymek błędu, a dalej już następne pytanie.
 *  Dymek błędu do modelu nie idzie, więc dwie wypowiedzi człowieka stawały
 *  obok siebie i serwer sklejał je w jedną: „A\n\nB”. Po czterech błędach
 *  w trybie głosowym model dostawał wszystkie cztery pytania naraz, a „Wyślij
 *  przez Chmurę” pod ostatnim wysyłało do chmury oba (agencja, runda 9).
 *  Człowiek, który po błędzie pyta dalej, pyta o to NOWE. Bieżące pytanie
 *  (granica) zostaje zawsze; pytanie z choćby urywkiem odpowiedzi – też. */
function pytaniaBezOdpowiedzi(wiadomosci, granica) {
  const wynik = new Set();
  const pytanie = (m) => m && m.role === 'user' && !m.search;
  for (let i = 0; i < wiadomosci.length; i++) {
    if (!pytanie(wiadomosci[i]) || i === granica) continue;
    let j = i + 1;
    let bledy = 0;
    while (j < wiadomosci.length && wiadomosci[j].error) { bledy++; j++; }
    if (bledy && pytanie(wiadomosci[j])) wynik.add(i);
  }
  return wynik;
}

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
      content: `PŁÓTNO – dokument otwarty obok rozmowy, tytuł „${conv.canvas.title}". `
        + 'To jest jego AKTUALNA treść (użytkownik mógł ją edytować ręcznie):\n'
        + '--- POCZĄTEK PŁÓTNA ---\n' + conv.canvas.text + '\n--- KONIEC PŁÓTNA ---',
    });
  }
  /* Granica bieżącej tury: ostatnia wiadomość człowieka (nie wynik narzędzia).
     Przed nią wyniki narzędzi skracamy do jednej linii, a obrazy zostają
     tylko w samej ostatniej wiadomości. Bez tego po czterech turach model
     dostawał 26 wiadomości, w tym siedem pełnych wyników wyszukiwania
     po ~6 tys. znaków, a zdjęcie z pierwszej tury kierowało każdą następną
     do modelu wizyjnego. */
  let granica = -1;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i];
    if (m.role === 'user' && !m.search) { granica = i; break; }
  }
  const bezOdpowiedzi = pytaniaBezOdpowiedzi(conv.messages, granica);
  conv.messages.forEach((m, i) => {
    // Gdzie w wysyłanej tablicy zaczyna się bieżąca tura – serwer przy małym
    // oknie modelu lokalnego wyrzuca tylko wiadomości sprzed niej.
    if (i === granica) api.turaOd = api.length;
    if (m.error || m.role === 'action' || m.status || m.komunikatCosmosa || toSzkielet(m)) return;
    if (bezOdpowiedzi.has(i)) return;
    // Zespół zatrzymany przed prowadzącym – wiadomość bez notatek jest tylko dla oczu.
    if (m.narzedzie === 'zespol' && !String(m.content || '').trim()) return;
    let text = msgText(m);
    /* ZDJĘCIA W HISTORII = WŁASNE ZNACZNIKI MODELU w miejscu, gdzie je postawił
       (runda 10). Dawniej ramka „(pokazano zdjęcia: …)” w jego wypowiedzi –
       słabe modele przepisywały ją na ekran (agencja-rozmowa, próba domk-echo).
       Znacznik powtórzony przez model to zwykłe wołanie narzędzia, nigdy tekst. */
    if (m.role === 'assistant' && Array.isArray(m.zdjecia) && m.zdjecia.length) text = zeZnacznikamiZdjec(text, m.zdjecia);
    // Stary zapis: osobna wiadomość ze zdjęciami (zapytanie w `text`) – też jako znacznik.
    else if (zdjeciaZSieci(m)) text = text ? `[GRAFIKA: ${text}]` : '';
    const images = i === granica ? msgImages(m) : [];
    if (i !== granica && msgImages(m).length && m.role === 'user') {
      text = `(tu użytkownik pokazał zdjęcie${msgImages(m).length > 1 ? 'a' : ''})` + (text ? `\n${text}` : '');
    }
    if (m.search && i < granica) {
      text = `(wcześniejszy wynik narzędzia: ${m.searchQuery || 'dane'} – już wykorzystany w odpowiedzi)`;
    }
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
      // nie wracają do API – wysyłamy sam tekst. Pustej wypowiedzi nie
      // wysyłamy wcale: część dostawców (Claude) ją odrzuca.
      if (!String(text || '').trim()) return;
      /* Kawałki jednej odpowiedzi (plan pokrojony siatkami zdjęć) to dla
         modelu JEDNA wypowiedź. Pięć wiadomości asystenta pod rząd część
         dostawców odrzuca, a reszta czyta je jak pięć osobnych odpowiedzi. */
      const poprzednia = api[api.length - 1];
      if (m.role === 'assistant' && poprzednia && poprzednia.role === 'assistant' && typeof poprzednia.content === 'string') {
        poprzednia.content += `\n\n${text}`;
        return;
      }
      api.push({ role: m.role, content: text });
    }
  });
  return api;
}

/* ============ KOLEJKA WIADOMOŚCI ============
   Do tej pory pole tekstowe było w trakcie odpowiedzi martwe: `sendMessage`
   wychodziło od razu przy `isGenerating`, a przycisk był wyszarzony. Myśl,
   która przyszła w trakcie czytania odpowiedzi, trzeba było albo trzymać
   w głowie, albo przerywać generowanie.

   Teraz wiadomość wysłana w trakcie ODCZEKUJE i idzie sama, gdy Cosmos
   skończy. Kolejka jest widoczna nad polem i da się z niej wyjąć wpis –
   „wyślę to za chwilę" musi być odwracalne, bo w połowie odpowiedzi często
   okazuje się, że pytanie było niepotrzebne. */
let kolejka = [];

/* Kolejka i niewysłany szkic przeżywają odświeżenie i ubicie aplikacji
   w tle (Android robi to bez pytania) – dawniej ginęły. Klucze pod
   `cosmos.conv.`, więc znikają przy zmianie osoby (konta.js). */
const KLUCZ_KOLEJKI = 'cosmos.conv.kolejka';
const KLUCZ_SZKICU = 'cosmos.conv.szkic';
function zapamietajKolejke() {
  try {
    if (kolejka.length) localStorage.setItem(KLUCZ_KOLEJKI, JSON.stringify(kolejka));
    else localStorage.removeItem(KLUCZ_KOLEJKI);
  } catch { /* za duża (zdjęcia) albo bez pamięci – zostaje w tej karcie */ }
}

/* Pozycja kolejki należy do rozmowy, w której ją wpisano. Dawniej po
   przełączeniu się na inną rozmowę pytanie szło tam, gdzie człowiek akurat
   był – do zupełnie innego wątku (zespół IT, płynność, runda 4). Pozycje
   bez rozmowy (zapisane przed tą zmianą) idą jak dawniej. */
const wTejRozmowie = (poz) => !poz.convId || poz.convId === activeId;

function renderKolejka() {
  zapamietajKolejke();
  const box = $('queue-box');
  if (!box) return;
  box.innerHTML = '';
  box.hidden = !kolejka.some(wTejRozmowie);
  if (box.hidden) return;
  for (const [i, poz] of kolejka.entries()) {
    if (!wTejRozmowie(poz)) continue;
    const el2 = document.createElement('div');
    el2.className = 'queue-item';
    const txt = document.createElement('span');
    txt.className = 'queue-text';
    // `poz.images` to LICZBA załączników, nie tablica – samo zdjęcie bez
    // podpisu musi się w kolejce czymś przedstawić, inaczej widać samo „…".
    txt.textContent = poz.text || (poz.images ? t('queue.image') : '…');
    const usun = document.createElement('button');
    usun.type = 'button';
    usun.className = 'queue-del';
    usun.textContent = '×';
    usun.title = t('queue.remove');
    usun.addEventListener('click', () => { kolejka.splice(i, 1); renderKolejka(); });
    el2.append(txt, usun);
    box.appendChild(el2);
  }
}

/** Po zakończeniu generowania – wyślij następną z kolejki. */
async function ruszKolejke() {
  if (isGenerating) return;
  const i = kolejka.findIndex(wTejRozmowie);
  if (i < 0) return;
  const [poz] = kolejka.splice(i, 1);
  renderKolejka();
  const conv = ensureConversation(poz.text || '');
  conv.messages.push({ role: 'user', content: poz.content });
  if (poz.zespol) zespolNaTure = { uruchom: true, przygotuj: true };
  saveConversations(true);          // patrz sendMessage – zaraz rusza generowanie
  renderSidebar();
  renderMessages();
  await runGeneration(conv);
  // Kolejka bywa dłuższa niż jedna pozycja – po tej odpowiedzi bierzemy następną.
  ruszKolejke();
}

async function sendMessage() {
  const text = el.input.value.trim();
  const gotowe = pendingDocs.filter((d) => !d.loading);
  if (!text && !pendingImages.length && !gotowe.length) return;

  /* Cosmos jeszcze mówi – bierzemy wiadomość do kolejki zamiast ją zgubić.
     Pole czyścimy tak samo jak przy zwykłym wysłaniu, żeby nie było
     wątpliwości, czy wiadomość „poszła". */
  if (isGenerating) {
    const content = (pendingImages.length || gotowe.length)
      ? {
          text,
          ...(pendingImages.length ? { images: [...pendingImages] } : {}),
          ...(gotowe.length ? { docs: gotowe.map((d) => ({ name: d.name, chars: d.chars, text: d.text, truncated: d.truncated })) } : {}),
        }
      : text;
    kolejka.push({ text, content, images: pendingImages.length, convId: activeId, ...(zespolWcisniety ? { zespol: true } : {}) });
    ustawPrzyciskZespolu(false);
    try { localStorage.removeItem(KLUCZ_SZKICU); } catch { /* bez pamięci */ }
    pendingImages = [];
    pendingDocs = [];
    renderAttachments();
    el.input.value = '';
    autosizeInput();
    updateSendButton();
    updateTokenEstimate();
    renderKolejka();
    return;
  }

  try { localStorage.removeItem(KLUCZ_SZKICU); } catch { /* bez pamięci */ }
  const conv = ensureConversation(text || (gotowe[0] && gotowe[0].name) || '');
  if (edycjaOd && edycjaOd.convId === conv.id) conv.messages = conv.messages.slice(0, edycjaOd.idx);
  edycjaOd = null;
  pokazEdycje(false);
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
  // Przycisk „Zespół” działa na jedną wiadomość – po wysłaniu wraca.
  if (zespolWcisniety) { zespolNaTure = { uruchom: true, przygotuj: true }; ustawPrzyciskZespolu(false); }
  pendingImages = [];
  pendingDocs = [];
  renderAttachments();
  // Bez zwłoki: za chwilę ruszy generowanie, które ma prawo przeżyć zamknięcie
  // karty – a serwer dopisze odpowiedź tylko do rozmowy, która już istnieje.
  saveConversations(true);

  el.input.value = '';
  autosizeInput();
  renderSidebar();
  renderMessages();

  await runGeneration(conv);
}

// jedno przejście streamingu – zwraca zebrany tekst odpowiedzi
/* ============ BIEG: ODPOWIEDŹ ŻYJE NA SERWERZE ============
   Marcin: „Jak wychodzę ze strony lub aplikacji (…) wszystko jest przerywane
   i jest napisane że connection error. Chciałbym żeby to działało też w tle."

   Serwer prowadzi odpowiedź do końca niezależnie od tego, czy przeglądarka
   patrzy (lib/biegi.js). Tutaj jest druga połowa: przeglądarka pamięta numer
   biegu i numer ostatniego odebranego zdarzenia, więc po zerwaniu Wi-Fi,
   zgaszeniu ekranu albo odświeżeniu strony wraca dokładnie w to miejsce.

   Nie ma tu ponawiania zapytania do modelu. Wracamy do TEJ SAMEJ odpowiedzi,
   nie prosimy o nową – druga odpowiedź na to samo pytanie kosztuje tokeny
   i bywa inna niż ta, którą użytkownik zdążył zobaczyć. */
const BIEG_KLUCZ = 'cosmos.bieg';
/** Klucz zdania do przeczytania na głos po błędzie czatu. */
/** Błąd silnika Lokalnie na ekran – po kodzie i rodzaju z serwera, w języku
 *  interfejsu. Serwer pisze po polsku (i z adresem domu dla właściciela), więc
 *  pod angielskim „Send via Cloud” stało polskie zdanie (agencja, runda 9).
 *  Inne błędy – zdanie serwera bez zmian. */
function bladSilnikaPoLudzku(err, zapasChmura) {
  const kod = err && err.kod;
  if (/^budzet/.test(kod || '') && !err.okres) {
    /* Bez okresu – odmowa w trakcie tury (prowadzący zespołu nie zmieścił się
       w budżecie, `koniec {kod}`): notatki ról już są w rozmowie. */
    return [t('chat.budzetBrak'), err.zespolNotatki ? t('chat.budzetNotatki') : '', zapasChmura ? t('chat.budzetChmura') : ''].filter(Boolean).join(' ');
  }
  if (/^budzet/.test(kod || '')) {
    return [t(err.okres === 'miesiac' ? 'chat.budzetMiesiac' : 'chat.budzetDzien'),
      t(err.limit === 'wlasciciel' ? 'chat.budzetWlasciciel' : 'chat.budzetWlasny'),
      zapasChmura ? t('chat.budzetChmura') : ''].filter(Boolean).join(' ');
  }
  if (kod !== 'lokalny-niedostepny' && kod !== 'zimny-start') return String((err && err.message) || '');
  const dalej = t(zapasChmura ? 'chat.lokWyslijChmura' : 'chat.lokPrzelaczChmura');
  if (kod === 'zimny-start') return t('chat.lokZimny', { dalej });
  if (konta_.ja()?.rola === 'czlonek') return t('chat.lokCzlonek');
  if (err.rodzaj === 'uspiony') return t('chat.lokUspiony', { dalej });
  if (err.rodzaj === 'odmowa' || err.rodzaj === 'brama') return t('chat.lokOdmowa', { dalej });
  return t('chat.lokInny', { dalej });
}

function glosBledu(err) {
  const kod = err && err.kod;
  // Z przyciskiem chmury na scenie zdanie mówi, co można zrobić (copywriter, runda 9).
  if (kod === 'lokalny-niedostepny' && err.zapasChmura) return 'voice.errConnChmura';
  if (kod === 'lokalny-niedostepny') return err.rodzaj === 'odmowa' ? 'voice.errOllama' : 'voice.errConn';
  if (kod === 'zimny-start') return 'voice.errColdStart';
  if (/^budzet/.test(kod || '')) return err.zapasChmura ? 'voice.errBudzetChmura' : 'voice.errBudzet';
  if (kod === 'klucz-dostawcy' || kod === 'brak-klucza') return 'voice.errKey';
  const m = String((err && err.message) || '');
  return /środk|kredyt|credit|billing|balance|insufficient|płatno/i.test(m) ? 'voice.errMoney'
    : /429|limit|przeciąż|rate|overloaded/i.test(m) ? 'voice.errLimit'
    : /401|403|klucz|api key/i.test(m) ? 'voice.errKey'
    : /komputer domowy|nie odpowiada|odrzuca połączenie|połącz|offline/i.test(m) ? 'voice.errConn'
    : 'voice.errReply';
}

const BIEG_PROB = 6;
// Jak długo wracamy do biegu po zerwanym połączeniu, zanim pokażemy błąd (bieg i tak zostaje zapamiętany).
const BIEG_PRZERWA_MS = 120000;

/* Licznik kosztu bieżącej tury (runGeneration): wszystkie wywołania modelu
   prowadzącego – runda 0, rundy kaskady, dokończenia po „length”. Przy turze
   zespołu suma trafia do stanu zespołu (stopka „cała odpowiedź”). */
let licznikKosztuTury = null;          // { zl, szac, zt }
function doliczKosztTury(zl, szacowany) {
  if (!licznikKosztuTury) return;
  licznikKosztuTury.zl = Math.round((licznikKosztuTury.zl + zl) * 10000) / 10000;
  if (szacowany) licznikKosztuTury.szac = true;
  if (licznikKosztuTury.zt) ZESPOL.kosztProwadzacego(licznikKosztuTury.zt.st, zl, szacowany);
}

let biegBiezacy = null;      // { id, convId, ostatnie }

function nowyBiegId() {
  const raw = (crypto.randomUUID && crypto.randomUUID())
    || (Math.random().toString(36).slice(2) + Date.now().toString(36));
  return String(raw).replace(/[^a-z0-9-]/gi, '').slice(0, 64);
}

function zapamietajBieg(b) {
  biegBiezacy = b;
  try {
    if (b) localStorage.setItem(BIEG_KLUCZ, JSON.stringify(b));
    else localStorage.removeItem(BIEG_KLUCZ);
  } catch { /* tryb prywatny – trudno, zostaje wznowienie w tej samej karcie */ }
}

const pauza = (ms) => new Promise((r) => setTimeout(r, ms));

/** Powiedz serwerowi, że odpowiedź dotarła i nie musi jej zapisywać awaryjnie. */
function potwierdzOdbior(id) {
  if (!id) return;
  fetch('/api/chat/odebrane', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bieg: id }),
    keepalive: true,      // ma dolecieć nawet gdy karta zamyka się w tej sekundzie
  }).catch(() => { /* nie doleciało – serwer zapisze sam, czyli bezpiecznie */ });
}

async function streamOnce(conv, opcje = {}) {
  const msg = document.createElement('div');
  msg.className = 'msg msg-assistant nowa';
  const ep = znakSilnika().silnik;
  msg.dataset.silnik = ep;
  msg.innerHTML = `<div class="msg-avatar">${AVATAR_SVG}</div>`;
  const body = document.createElement('div');
  body.className = 'msg-content md';
  body.innerHTML = '<span class="cursor-blink"></span>';
  const kolumna = document.createElement('div');
  kolumna.className = 'msg-kolumna';
  kolumna.style.flex = '1';
  kolumna.style.minWidth = '0';
  const podpis = podpisSilnika(ep, znakSilnika().model);
  if (podpis) kolumna.appendChild(podpis);
  kolumna.appendChild(body);
  msg.appendChild(kolumna);
  el.messages.appendChild(msg);
  zywyDymek = { el: msg, conv };
  /* Na dół wymuszenie tylko przy świeżo wysłanym pytaniu. Kolejna runda
     kaskady (po wyszukaniu, po planie) ściągała na sam dół kogoś, kto
     przewinął w górę i czytał – skok o 12 tys. px (it-plynnosc, runda 10). */
  scrollToBottom(opcje.nowaTura === true);

  abortController = new AbortController();
  let acc = '';
  let think = '';
  let renderQueued = false;

  // Modele rozumujące (Nemotron 3, gpt-oss, R1) wysyłają tok myślenia w osobnym
  // polu `reasoning_content`. Bez tego ekran stoi pusty przez cały czas myślenia,
  // a gdy budżet tokenów skończy się w trakcie – zostaje pusta odpowiedź.
  // Pokazujemy myślenie na żywo, zwinięte, żeby było widać, że coś się dzieje.
  // Model rozumujący potrafi milczeć kilkadziesiąt sekund, a pusty dymek
  // z migającym kursorem wygląda jak zawieszenie. Licznik pokazuje, że praca
  // trwa – i ile już trwa.
  /* Początek odliczania. W turze zespołu zerowany, gdy rusza prowadzący
     (zdarzenie `faza`) – „Myślę… 16 s” w pierwszej sekundzie myślenia liczyło
     czas ról (it-plynnosc, runda 11). */
  let started = Date.now();
  let waitNote = '';
  /* Zanim dostawca odpowie nagłówkami, model jeszcze nie „myśli”: łączymy
     się albo lokalny model ładuje się do pamięci karty (zimny start) – napis
     „model myśli… 45 s” był wtedy nieprawdą (zespół IT, runda 5). */
  let naglowkiPrzyszly = false;
  const zt = opcje.zespolTury || null;
  const tykniecie = () => {
    /* Treść płynie – licznik znika. Samo wyzerowanie notki bez odmalowania
       zostawiało na ekranie zamrożone „czekam na odpowiedź modelu… 23 s” obok
       „Myślę…” – to było „wisi” ze zrzutu 4 Marcina (runda 10). */
    if (rozdzielMyslenie(acc).tresc.trim()) { clearInterval(waitTimer); if (waitNote) { waitNote = ''; schedulePaint(); } return; }
    // Zespół pracuje: postęp pokazuje blok, „model myśli… 40 s” byłoby nieprawdą.
    if (zt && zt.st.role.length && zt.st.faza !== 'prowadzacy') { if (waitNote) { waitNote = ''; schedulePaint(); } return; }
    /* Samo myślenie (model rozumujący potrafi myśleć minutę z jednym kawałkiem
       w buforze dostawcy): licznik żyje w nagłówku myślenia – „Myślę… 31 s”. */
    if (think || rozdzielMyslenie(acc).think) { waitNote = ''; schedulePaint(); return; }
    const s = Math.round((Date.now() - started) / 1000);
    const klucz = naglowkiPrzyszly ? 'chat.stillWorking' : ep === 'local' ? 'chat.waitLocal' : 'chat.waitStart';
    /* 15 s czekania na lokalny model (zimny start, dom się budzi): wyjście do
       chmury już teraz, a nie dopiero po 90 s i błędzie (zespół IT, runda 9). */
    const chmura = ep === 'local' && !naglowkiPrzyszly && s >= 15 && epConfig('cloud').hasApiKey
      ? ` <button type="button" class="msg-action-btn msg-przez-chmure wait-przez-chmure">${escapeHtml(t('chat.przezChmure'))}</button>` : '';
    waitNote = `<div class="wait-note mono">${escapeHtml(t(klucz, { s }))}${chmura}</div>`;
    schedulePaint();
  };
  /* Jeden wiersz stanu od pierwszej chwili – „Łączę z modelem… 0 s”, potem ten
     sam zegar jako „Myślę… N s” (agencja-ux, decyzja 3B). Pierwsze tyknięcie
     od razu, nie po sekundzie pustego dymka z samotnym kursorem. */
  const waitTimer = setInterval(tykniecie, 1000);
  body.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.wait-przez-chmure')) przezChmureWTrakcie(conv);
  });

  /* Malowanie przebudowuje całą odpowiedź, więc kosztuje tym więcej, im jest
     dłuższa. Na telefonie długa odpowiedź zajmowała 78% wątku głównego,
     a pisanie w polu szło 3× wolniej. Odstęp między malowaniami rośnie z ich
     kosztem – wątek ma zawsze co najmniej tyle wolnego, ile zjadło malowanie. */
  let czasMalowania = 0;
  let ostatnieMalowanie = 0;
  const paskiStrumienia = {};   // pamięć szkieletów pasków tego strumienia (wstawPaski)
  const paint = () => {
    renderQueued = false;
    const t0 = performance.now();
    /* Myślenie z `<think>` w treści idzie do panelu myślenia, a znaczniki
       i ich urwane początki nie migają na ekranie w trakcie pisania. Panel
       myślenia jest zwinięty – rozumowanie bywa po angielsku i pełne
       deliberacji; kto chce, rozwinie. */
    const { think: thinkWTresci } = rozdzielMyslenie(acc);
    const widok = widokWToku(acc);
    const calyThink = [think, thinkWTresci].filter(Boolean).join('\n');
    const head = calyThink
      ? '<details class="think-block">'
        + `<summary>${escapeHtml(widok ? t('think.done') : t('think.liveCzas', { s: Math.round((Date.now() - started) / 1000) }))}</summary>`
        + `<pre>${escapeHtml(calyThink)}</pre></details>`
      : '';
    /* Wiersz stanu NAD treścią i nigdy obok „Myślę…” – dawniej notka z
       poprzedniego tyknięcia stała do sekundy razem z nagłówkiem myślenia
       (dwa wskaźniki naraz, agencja-frontend P1). */
    body.innerHTML = head + (calyThink ? '' : waitNote) + `<div class="strumien-tresc">${renderMarkdown(widok)}</div>`;
    const tresc = body.querySelector('.strumien-tresc');
    /* Szkielet paska zdjęć od chwili, gdy znacznik stanął pod nagłówkiem – nie
       dopiero po końcu odpowiedzi. Inaczej paski wyrastały nad tekstem, który
       ktoś właśnie czytał, i akapit uciekał o 800–1960 px (it-plynnosc). */
    if (/GRAFIKA/i.test(acc)) {
      const { zdjecia } = rozlozZdjecia(rozdzielMyslenie(acc).tresc);
      if (zdjecia.length) wstawPaski(tresc, { zdjecia: zdjecia.map((g) => ({ ...g, photos: [], stan: 'szukam' })) }, paskiStrumienia);
    }
    /* Kursor na końcu OSTATNIEGO zdania, nie w osobnej linii pod tekstem –
       jak na stronie produktowej. Szukamy ostatniego bloku tekstu (akapit,
       punkt listy, nagłówek); bloki kodu zostawiamy w spokoju. */
    const kursor = document.createElement('span');
    kursor.className = 'cursor-blink';
    const koniec = tresc.lastElementChild;
    const bloki = koniec && !/^(PRE|TABLE|DIV)$/.test(koniec.tagName)
      ? koniec.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6') : [];
    const cel = bloki.length ? bloki[bloki.length - 1] : (koniec && /^(P|H[1-6])$/.test(koniec.tagName) ? koniec : tresc);
    // Samotny kursor w pustej linii obok wiersza stanu wyglądał jak drugi wskaźnik.
    if (widok.trim() || !(calyThink || waitNote)) cel.appendChild(kursor);
    scrollToBottom();
    ostatnieMalowanie = performance.now();
    czasMalowania = ostatnieMalowanie - t0;
  };
  const schedulePaint = () => {
    if (renderQueued) return;
    renderQueued = true;
    const zostalo = Math.min(400, czasMalowania * 2) - (performance.now() - ostatnieMalowanie);
    if (zostalo > 0) setTimeout(() => requestAnimationFrame(paint), zostalo);
    else requestAnimationFrame(paint);
  };
  tykniecie();

  /* Podpięcie do biegu, który już trwa (po odświeżeniu strony), albo nowy
     bieg. W obu razach numer znamy PRZED wysłaniem żądania – inaczej zerwanie
     połączenia w pierwszej sekundzie zostawiłoby odpowiedź bez adresu. */
  lastFinish = '';
  const podpiecie = Boolean(opcje.bieg);
  const biegId = opcje.bieg || nowyBiegId();
  zapamietajBieg({ id: biegId, convId: conv.id, ostatnie: (Number(opcje.od) || 0) - 1 });

  try {
    const modelOverride = znakTury ? znakTury.nadpisanie : nadpisanieModelu(ep);
    const doModelu = podpiecie ? [] : toApiMessages(conv);
    let res = podpiecie
      ? await fetch(`/api/chat/bieg?id=${encodeURIComponent(biegId)}&od=${Number(opcje.od) || 0}`,
        { signal: abortController.signal })
      : await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: ep,
          // `dodatkowe` to dopisek na jedną turę, poza historią rozmowy –
          // służy dokańczaniu odpowiedzi uciętej limitem długości.
          messages: [...doModelu, ...(opcje.dodatkowe || [])],
          turaOd: doModelu.turaOd,
          // Obraz tej tury to klatka dołączona sama (tryb głosowy), nie zdjęcie od człowieka.
          klatkaKamery: klatkaWTurze(conv) || undefined,
          model: modelOverride || undefined,
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          kbSelected: [...kbSelected],
          useSearch: settings.offline ? false : undefined,
          // odpowiedź będzie czytana na głos – model ma mówić, nie pisać
          trybGlosowy: voiceMode || undefined,
          // Zespół agentów – tylko w pierwszym żądaniu tury (runGeneration), nigdy w dokończeniu i rundach kaskady.
          zespol: opcje.zespol || undefined,
          bieg: biegId,
          rozmowa: conv.id,
        }),
        signal: abortController.signal,
      });
    serwerOdpowiedzial(res);

    if (!res.ok) {
      let errText = t('httpErr', { status: res.status });
      let data = {};
      try {
        data = await readJsonSafe(res);
        // Budżet w złotówkach (429 budzet-wyczerpany) podaje powód w `blad`.
        errText = data.error || data.blad || errText;
      } catch { /* ignore */ }
      zapamietajBieg(null);
      /* Kod i „trwały" od serwera: głos wybiera zdanie po kodzie, a przy błędzie
         trwałym (zły klucz, brak środków, model, który nie rozmawia) zamiast
         „Ponów", który zawsze skończy się tak samo, jest droga do Ustawień. */
      throw Object.assign(new Error(errText), { kod: data.kod || '', rodzaj: data.rodzaj || '', trwaly: Boolean(data.trwaly), status: res.status,
        // Budżet w złotówkach: który limit (dzienny/miesięczny) i czyj (własny/od właściciela).
        ...(data.okres ? { okres: String(data.okres) } : {}), ...(data.limit ? { limit: String(data.limit) } : {}) });
    }

    naglowkiPrzyszly = true;
    // Serwer mógł skierować zdjęcie do modelu wizyjnego. Podmiana za plecami
    // użytkownika byłaby nieuczciwa – mówimy, kto naprawdę odpowiedział.
    const swapped = res.headers.get('X-Cosmos-Model-Swapped-From');
    const used = decodeURIComponent(res.headers.get('X-Cosmos-Model') || '');
    /* Podpis odpowiedzi i zapis w rozmowie – model, który NAPRAWDĘ odpowiedział.
       Po podmianie (zdjęcie → model wizyjny, członek → lista właściciela) podpis
       mówił o modelu wybranym (zespół IT, runda 5). */
    if (used && znakTury) znakTury.model = used;
    // Na silniku przyznanym przez właściciela członek dostaje model z jego listy.
    const spozaListy = res.headers.get('X-Cosmos-Model-Spoza-Listy');
    // Lokalny model z małym oknem: najstarsze wiadomości nie poszły do modelu – mówimy ile,
    // a gdy nie zmieściła się nawet bieżąca tura, że jej najdłuższa część jest skrócona.
    const [okno, przyciete, skrocone] = String(res.headers.get('X-Cosmos-Okno') || '').split(';').map(Number);
    lastModelNote = [
      spozaListy ? t('model.przyznany', { from: decodeURIComponent(spozaListy), to: used }) : '',
      swapped ? t('model.swapped', { from: decodeURIComponent(swapped), to: used }) : '',
      przyciete ? t('model.okno', { n: przyciete, okno }) : '',
      skrocone ? t('model.oknoSkrocone', { okno }) : '',
    ].filter(Boolean).join(' ');

    const decoder = new TextDecoder();
    let buffer = '';
    let koniecBiegu = false;      // serwer powiedział „to już wszystko"
    let bladBiegu = '';
    let trwalyBiegu = false;   // błąd trwały w strumieniu (zły klucz, brak środków) → „Ustawienia”, nie „Ponów”
    let kodBiegu = { kod: '' };
    let proby = 0;

    /* Jedno zdarzenie SSE. `id:` to numer nadany przez serwer – po nim wracamy
       we właściwe miejsce, więc wznowienie nie powtarza połowy zdania ani jej
       nie gubi. */
    const zjedzZdarzenie = (event) => {
      let typ = '';
      for (const line of event.split('\n')) {
        if (line.startsWith('id:')) {
          const n = Number(line.slice(3).trim());
          if (Number.isFinite(n) && biegBiezacy) biegBiezacy.ostatnie = n;
          continue;
        }
        if (line.startsWith('event:')) { typ = line.slice(6).trim(); continue; }
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        if (typ === 'koniec') {
          koniecBiegu = true;
          try {
            const k = JSON.parse(data);
            bladBiegu = k.blad || ''; trwalyBiegu = Boolean(k.trwaly);
            /* Kod błędu (np. budzet-wyczerpany prowadzącego zespołu) – zdanie
               w języku interfejsu i „Wyślij przez Chmurę”, jak przy 429 czatu. */
            kodBiegu = { kod: String(k.kod || ''), ...(k.okres ? { okres: String(k.okres) } : {}), ...(k.limit ? { limit: String(k.limit) } : {}) };
            /* Koszt tego wywołania (C2) – do JEDNEGO licznika tury: rundy kaskady
               i dokończenia też płacą, a stopka „cała odpowiedź” pokazywała tylko
               rundę 0 (~70% rachunku, it-modele-komercyjne, runda 11). */
            if (typeof k.kosztZl === 'number' && k.kosztZl > 0) doliczKosztTury(k.kosztZl, k.kosztSzacowany === true);
          } catch { /* bez szczegółów */ }
          continue;
        }
        /* Serwer nie pamięta początku tej odpowiedzi (bufor urwany limitem).
           Mówimy o tym wprost – pokazanie samego dalszego ciągu wyglądałoby
           jak odpowiedź, która zaczyna się w połowie zdania. */
        if (typ === 'luka') { acc += t('bieg.luka') + '\n\n'; schedulePaint(); continue; }
        // Zdarzenia zespołu (bez `choices`) – skład, role, faza prowadzącego.
        if (ZDARZENIA_ZESPOLU.has(typ)) {
          // Prowadzący rusza – jego licznik liczy od teraz, nie od startu ról.
          if (typ === 'faza') started = Date.now();
          if (zt) zespolZdarzenie(zt, typ, data, { kolumna, body, podpis });
          continue;
        }
        try {
          const json = JSON.parse(data);
          const d = json.choices?.[0]?.delta || {};
          /* Powód zakończenia. „length" znaczy: model NIE skończył zdania,
             tylko wyczerpał budżet tokenów. Przez długi czas nikt tego nie
             czytał i odpowiedź urywała się w pół adresu – Marcin dostał plan
             Majorki kończący się na „…wynajem-samochodu". */
          const powod = json.choices?.[0]?.finish_reason;
          if (powod) lastFinish = powod;
          const delta = d.content ?? json.choices?.[0]?.text ?? '';
          // różni dostawcy nazywają to pole inaczej
          const reason = d.reasoning_content ?? d.reasoning ?? '';
          // Pierwszy kawałek myślenia albo treści gasi wiersz czekania od razu, nie przy tyknięciu zegara.
          if (reason) {
            think += reason;
            waitNote = '';
            schedulePaint();
          }
          if (delta) {
            acc += delta;
            waitNote = '';
            schedulePaint();
          }
        } catch { /* niepełny fragment – pomijamy */ }
      }
    };

    /* Pętla przeżywania. Zerwane połączenie NIE jest tu błędem – jest
       normalnym stanem telefonu, który zgasił ekran. Wracamy do biegu od
       ostatniego numeru; poddajemy się dopiero, gdy serwer przestaje o nim
       wiedzieć albo gdy nie da się wrócić po kilku próbach. */
    petla: while (!koniecBiegu) {
      const reader = res.body.getReader();
      let rozlaczone = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop();
          for (const event of events) if (event.trim()) zjedzZdarzenie(event);
          if (koniecBiegu) break;
        }
      } catch (err) {
        if (abortController.signal.aborted) throw err;
        rozlaczone = true;
      }
      if (koniecBiegu) break;
      if (buffer.trim()) { zjedzZdarzenie(buffer); buffer = ''; }
      if (koniecBiegu) break;

      /* Strumień się skończył, a serwer nie powiedział „koniec”. Wracamy.
         Próby powrotu mają WŁASNĄ pętlę: nieudany fetch nie może wrócić do
         `getReader()` na starym, zablokowanym strumieniu – dawniej przerwa
         w Wi-Fi dłuższa niż pół sekundy kończyła się angielskim „Failed to
         execute 'getReader'…” zamiast wznowieniem (zespół IT, runda 5). */
      const przerwaOd = Date.now();
      for (;;) {
        /* Zerwane połączenie: próbujemy przez BIEG_PRZERWA_MS (czas, nie liczba
           prób – winda, tunel, przełączenie Wi-Fi→LTE trwają dłużej niż 6 prób
           w ~23 s). Potem bieg NIE jest zapominany: odpowiedź pisze się dalej na
           serwerze i wracamy po nią, gdy sieć wróci (it-plynnosc, runda 11). */
        ++proby;
        const przerwa = typeof window.COSMOS_PRZERWA_BIEGU_MS === 'number' ? window.COSMOS_PRZERWA_BIEGU_MS : BIEG_PRZERWA_MS;   // zestaw testów skraca
        if (rozlaczone ? (proby > 2 && Date.now() - przerwaOd > przerwa) : proby > BIEG_PROB) {
          if (rozlaczone) throw Object.assign(new Error(t('bieg.porzucony')), { porzucony: true });
          break petla;               // serwer bez biegów – kończymy po staremu
        }
        await pauza(Math.min(8000, 500 * 2 ** (proby - 1)));
        const od = (biegBiezacy?.ostatnie ?? -1) + 1;
        let wrot;
        try {
          wrot = serwerOdpowiedzial(await fetch(`/api/chat/bieg?id=${encodeURIComponent(biegId)}&od=${od}`,
            { signal: abortController.signal }));
        } catch (err) {
          if (abortController.signal.aborted) throw err;
          continue;                  // sieci nadal nie ma – próbujemy dalej
        }
        /* 404 = serwer już nie pamięta tego biegu. Przy podpięciu po odświeżeniu
           to zwykły koniec (odpowiedź wylądowała w rozmowie), przy zerwaniu
           w locie – utrata. W obu razach nie ma czego dalej czytać. */
        if (!wrot.ok) break petla;
        res = wrot;
        break;
      }
    }
    clearInterval(waitTimer);
    if (zywyDymek && zywyDymek.el === msg) zywyDymek = null;
    zapamietajBieg(null);
    /* „Mam tę odpowiedź." Bez tego serwer po dwudziestu sekundach dopisze ją
       do rozmowy jeszcze raz, bo z jego strony wygląda to jak odpowiedź, po
       którą nikt nie przyszedł. Zgadywanie po tym, czy gniazdo było otwarte,
       już próbowaliśmy – myliło się w obie strony. */
    potwierdzOdbior(biegId);
    if (bladBiegu) {
      // Napisany już fragment idzie razem z błędem – wyżej trafi do rozmowy.
      const e = new Error(bladBiegu);
      e.partial = rozdzielMyslenie(acc).tresc;
      if (trwalyBiegu) e.trwaly = true;
      if (kodBiegu.kod) Object.assign(e, kodBiegu, zt && zt.st.role.length ? { zespolNotatki: true } : {});
      throw e;
    }
    // Silnik właśnie odpowiedział – kropka plakietki nie może twierdzić, że go nie ma.
    zanotujKontakt(ep);
    // `<think>` w treści to myślenie, nie odpowiedź – i nie wolno z niego
    // wyławiać znaczników narzędzi.
    {
      const r = rozdzielMyslenie(acc);
      // Treść bez tagów ZAWSZE: pusty blok `<think>\n\n</think>` (Qwen3 bez
      // myślenia) nie przechodził warunku i tagi stały na ekranie (agencja, runda 5).
      if (r.think) think = [think, r.think].filter(Boolean).join('\n');
      acc = r.tresc;
    }
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
    if (zywyDymek && zywyDymek.el === msg) zywyDymek = null;
    /* K8: urywek i karta błędu niosą numer biegu – przy scalaniu z serwerem pełna
       odpowiedź-sierota tego biegu wygrywa z nimi (protokol.js, scalRozmowy). */
    if (!err.bieg && !podpiecie) err.bieg = biegId;
    // Porzucony po długiej przerwie w sieci: bieg zostaje – wznowPorzucony wróci po odpowiedź.
    if (!err.porzucony) zapamietajBieg(null);
    // Przerwanie i zerwanie też niosą to, co już przyszło.
    if (err.partial === undefined) err.partial = err.name === 'AbortError' ? acc : rozdzielMyslenie(acc).tresc;
    /* Brak sieci: przeglądarka mówi „Failed to fetch" po angielsku i nie mówi,
       co zrobić. Po ludzku i z radą. */
    if (err.name === 'TypeError' && /fetch|network|load failed/i.test(err.message || '')) {
      const poLudzku = new Error(t('chat.offlineSend'));
      poLudzku.partial = err.partial;
      poLudzku.bieg = err.bieg;
      throw poLudzku;
    }
    throw err;
  }
}

/* Prośba o zdjęcia w pytaniu tury (ostatnia wypowiedź człowieka, nie wynik narzędzia). */
const PROSBA_O_ZDJECIA = /(?<!\p{L})(zdj[eę]ci|zdjęć|fotk|fotografi[ei]|foto(?!graf)|photos?|pictures?|images?)/iu;
function prosiOZdjecia(conv) {
  const m = [...((conv && conv.messages) || [])].reverse().find((x) => x.role === 'user' && !x.search);
  if (!m) return false;
  const tekst = typeof m.content === 'string' ? m.content : (m.content && m.content.text) || '';
  return PROSBA_O_ZDJECIA.test(tekst);
}
/* Nagłówek dnia planu: „### Dzień 3 · Taormina · odpoczynek”, „## Day 2: Etna”.
   Nazwa miejsca to pierwszy człon po numerze; człon, który jest rodzajem dnia
   (odpoczynek, przyjazd), miejscem nie jest. */
const NAGLOWEK_DNIA = /^#{1,4}\s*(?:\*\*)?\s*(?:dzie[ńn]|day)\s*\d+\s*(?:\*\*)?\s*[·•:–\-|,.]\s*(.+)$/iu;
const NIE_MIEJSCE = /^(odpoczyn\p{L}*|relaks\p{L}*|przyjazd|wyjazd|powr[óo]t|przelot|podr[óo]ż\p{L}*|dzie[ńn] wolny|zwiedzanie|pla[żz]owanie|rest|relax\p{L}*|arrival|departure|travel\p{L}*|free day|sightseeing)$/iu;
function miejscaZNaglowkowDni(tekst) {
  const nazwy = [];
  const znane = new Set();
  for (const linia of String(tekst || '').split('\n')) {
    const m = linia.trim().match(NAGLOWEK_DNIA);
    if (!m) continue;
    const czlony = m[1].replace(/\*\*|__/g, '').split(/\s+[·•|–-]\s+|\s*[·•|(]\s*|\s*,\s+/)
      .map((x) => x.replace(/[.:;)]+$/, '').trim()).filter(Boolean);
    const nazwa = czlony.find((x) => !NIE_MIEJSCE.test(x) && x.length >= 2 && x.length <= 60);
    if (!nazwa || znane.has(bezOgonkowKlient(nazwa))) continue;
    znane.add(bezOgonkowKlient(nazwa));
    nazwy.push(nazwa);
    if (nazwy.length >= 8) break;
  }
  return nazwy;
}

/* Powrót do odpowiedzi, która powstawała, gdy strona była zamknięta.
   Wywoływane raz, przy starcie. Nie pyta o nic modelu – podpina się do tego,
   co serwer już policzył albo właśnie liczy. */
async function wznowBieg() {
  let zapis = null;
  try { zapis = JSON.parse(localStorage.getItem(BIEG_KLUCZ) || 'null'); } catch { /* śmieci */ }
  if (!zapis || !zapis.id) return;

  let dane;
  try {
    const r = serwerOdpowiedzial(await fetch('/api/chat/biegi'));
    if (!r.ok) return 'siec';
    dane = await r.json();
  } catch { return 'siec'; }          // serwer offline – wrocPoOdpowiedz spróbuje znowu

  const b = (dane.biegi || []).find((x) => x.id === zapis.id);
  /* Bieg skończył się, gdy nas nie było, a serwer zapisał już odpowiedź do
     rozmowy sam (lib/biegi.js) – nie ma czego dociągać. Skończony, ale jeszcze
     NIE zapisany (powrót do 20 s po końcu): podpinamy się i odbieramy całość.
     Dawniej na ekranie zostawało wtedy samo pytanie (zespół IT, runda 4). */
  if (!b || (!b.trwa && b.zapisany)) {
    zapamietajBieg(null);
    if (b && zapis.convId && activeId === zapis.convId) await selectConversation(zapis.convId);
    return;
  }

  const conv = zapis.convId && activeId === zapis.convId ? activeConversation : null;
  if (!conv) {
    // Rozmowa z biegiem nie jest tą otwartą – przełączamy się na nią.
    if (!zapis.convId) { zapamietajBieg(null); return; }
    await selectConversation(zapis.convId);
    if (!activeConversation) { zapamietajBieg(null); return; }
  }
  const cel = activeConversation;
  if (!cel) { zapamietajBieg(null); return; }
  /* Od zera, nie od zapamiętanego numeru. Po przeładowaniu ekran jest pusty,
     więc potrzebujemy CAŁEJ odpowiedzi – wznowienie od połowy pokazałoby
     wypowiedź zaczynającą się w środku zdania. Numer w zapisie służy tylko
     wznowieniu bez przeładowania (zerwane Wi-Fi), gdzie początek już jest
     narysowany, i tam siedzi w pamięci, nie w localStorage. */
  await runGeneration(cel, { bieg: zapis.id, od: 0 });
  return true;
}

/** Odpowiedź porzucona po długiej przerwie w sieci (karta została z urywkiem
 *  i błędem z `bieg`). Gdy bieg jeszcze trwa – urywek i błąd ustępują, a my
 *  podpinamy się od początku; gdy skończył i serwer go zapisał – bierzemy
 *  rozmowę z serwera (pełna odpowiedź wygrywa przy scalaniu, K8). Zwraca true,
 *  gdy coś zrobiło. Bez tego powrót sieci wysyłał urywek i nadpisywał nim
 *  pełną, zapłaconą odpowiedź (it-plynnosc, runda 11). */
let wznawiamPorzucony = false;
async function wznowPorzucony() {
  if (isGenerating || wznawiamPorzucony) return false;
  let zapis = null;
  try { zapis = JSON.parse(localStorage.getItem(BIEG_KLUCZ) || 'null'); } catch { /* śmieci */ }
  const conv = activeConversation;
  /* Bez zapisu w pamięci przeglądarki (inna karta, wyczyszczona pamięć) bieg
     zna sama karta błędu – „Pobierz odpowiedź” ma działać i wtedy. */
  if (conv && (!zapis || !zapis.id || zapis.convId !== conv.id)) {
    const karta = [...conv.messages].reverse().find((m) => m.error && m.porzucony && m.bieg);
    if (karta) zapis = { id: karta.bieg, convId: conv.id };
  }
  if (!zapis || !zapis.id || !conv || conv.id !== zapis.convId) return false;
  if (!conv.messages.some((m) => m.bieg === zapis.id && m.error)) return false;
  wznawiamPorzucony = true;
  try {
    let dane;
    try {
      const r = serwerOdpowiedzial(await fetch('/api/chat/biegi'));
      if (!r.ok) return 'siec';
      dane = await r.json();
    } catch { return 'siec'; }               // sieci jeszcze nie ma – wrocPoOdpowiedz ponowi
    if (isGenerating || activeConversation !== conv) return false;
    const b = (dane.biegi || []).find((x) => x.id === zapis.id);
    if (b && (b.trwa || !b.zapisany)) {
      conv.messages = conv.messages.filter((m) => m.bieg !== zapis.id);
      renderMessages({ przewin: sledzeDol });
      await runGeneration(conv, { bieg: zapis.id, od: 0 });
      return true;
    }
    zapamietajBieg(null);
    // Zapisany przez serwer: świeża rozmowa z serwera, scalona – pełna odpowiedź wypiera urywek.
    try {
      const r = serwerOdpowiedzial(await fetch(`/api/conversations?id=${encodeURIComponent(conv.id)}`));
      if (r.ok && activeConversation === conv && !isGenerating) {
        const zSerwera = naprawStareRuchyNarzedzi(await r.json());
        wersjaNaSerwerze.set(conv.id, zSerwera.updatedAt);
        activeConversation = scalRozmowy(conv, zSerwera);
        saveConversations(true, activeConversation);
        renderMessages({ przewin: sledzeDol });
        return true;
      }
      if (!r.ok) return 'siec';
    } catch { return 'siec'; }
    return false;
  } finally { wznawiamPorzucony = false; }
}

/** Powrót po odpowiedź, która czeka na serwerze (it-plynnosc, runda 12).
 *
 *  Jedna droga dla wszystkich okazji: start strony, powrót do karty
 *  (visibilitychange, pageshow), 'online' i serwer znów osiągalny. Dawniej
 *  każda z nich robiła JEDNO zapytanie, a telefon budzi stronę chwilę przed
 *  siecią – zapytanie padało i karta zostawała z „wrócę po nią” do następnej
 *  zmiany okna, choć pełna odpowiedź leżała gotowa na serwerze. Teraz porażka
 *  sieci ponawia się po 1, 2, 4, 8 s… przez około 30 s.
 *
 *  Kolejność: najpierw odpowiedź porzucona w tej karcie (urywek z kartą błędu),
 *  potem bieg sprzed przeładowania, na końcu zapis kopii z przeglądarki – kopia
 *  z urywkiem nie może wyprzedzić pełnej odpowiedzi. Zwraca true, gdy coś wróciło. */
const WROC_PONOW_MS = [1000, 2000, 4000, 8000, 15000];
const WROC_OKNO_MS = 30000;
let wrocTimer = null;
let wrocOd = 0;
let wrocProba = 0;
let wracam = false;
let biegPoStarcie = true;
const biegWOtwartej = () => {
  try { const z = JSON.parse(localStorage.getItem(BIEG_KLUCZ) || 'null'); return Boolean(z && z.id && z.convId && z.convId === activeId); } catch { return false; }
};
async function wrocPoOdpowiedz() {
  clearTimeout(wrocTimer);
  wrocTimer = null;
  if (wracam || isGenerating) return false;
  wracam = true;
  let wynik = false;
  try {
    wynik = await wznowPorzucony();
    /* Bieg sprzed przeładowania – przy starcie zawsze, później tylko w otwartej
       rozmowie: powrót do karty nie może przerzucić kogoś do innej rozmowy. */
    if (wynik !== true && wynik !== 'siec' && (biegPoStarcie || biegWOtwartej())) {
      wynik = (await wznowBieg()) || false;
      if (wynik !== 'siec') biegPoStarcie = false;
    }
  } catch { wynik = 'siec'; } finally { wracam = false; }
  if (wynik === 'siec') {
    if (!wrocOd) wrocOd = Date.now();
    if (Date.now() - wrocOd < WROC_OKNO_MS) {
      const zwloka = WROC_PONOW_MS[Math.min(wrocProba++, WROC_PONOW_MS.length - 1)];
      wrocTimer = setTimeout(wrocPoOdpowiedz, zwloka);
      return false;
    }
  }
  wrocOd = 0;
  wrocProba = 0;
  if (wynik !== 'siec') ponowNiezapisane();
  return wynik === true;
}

// Model, który faktycznie odpowiedział, gdy różni się od wybranego.
let lastModelNote = '';

/* Dlaczego model przestał pisać. „length" = wyczerpał budżet tokenów, czyli
   odpowiedź jest URWANA, a nie skończona. */
let lastFinish = '';

/** Dokończ odpowiedź uciętą limitem długości.
 *
 *  Marcin: „Wydaje mi się, że odpowiedź na końcu jest urwana. Nie chciałbym
 *  żeby odpowiedzi były urwane." Plan Majorki kończył się w połowie adresu
 *  źródła – model wyczerpał `max_tokens` na środku zdania, a Cosmos pokazywał
 *  ten kikut jak gotową odpowiedź.
 *
 *  Nie pytamy o odpowiedź od nowa: to kosztuje drugie tyle tokenów i daje
 *  INNY tekst niż ten, który użytkownik zdążył przeczytać. Prosimy o dalszy
 *  ciąg i doklejamy go do tego, co już jest.
 */
const DOPISKI_MAX = 3;
let dopiskiTury = 0;
async function dokoncz(conv, tekst) {
  /* Pusta treść przy „length" = cały budżet poszedł na myślenie. Drugie
     żądanie znaczyłoby drugi pełny przebieg myślenia i zwykle ten sam wynik. */
  if (!String(tekst || '').trim()) return tekst;
  let pelny = tekst;
  /* Licznik na całą TURĘ, nie na wywołanie: kaskada woła dokańczanie przed
     zdjęciami i przy domknięciu, a każde dokończenie wysyła całą dotychczasową
     odpowiedź. Jedno pytanie kosztowało do czterech pełnych przebiegów
     w każdej rundzie (zespół IT, runda 7). */
  for (; dopiskiTury < DOPISKI_MAX && lastFinish === 'length'; dopiskiTury++) {
    let ciag;
    /* Nieudane dokończenie (np. „prompt too long” przy małym oknie) nie może
       skasować tego, co już stoi na ekranie: błąd niesie napisany tekst,
       a obsługa błędu go zachowuje (zespół IT, runda 7). */
    try { ciag = await streamOnce(conv, {
      dodatkowe: [
        { role: 'assistant', content: pelny },
        { role: 'user', content: 'Twoja odpowiedź urwała się, bo skończył się '
          + 'budżet długości – nie dlatego, że skończyłeś. Kontynuuj DOKŁADNIE '
          + 'od miejsca, w którym przerwałeś: bez powtarzania napisanego, bez '
          + 'wstępu, bez przepraszania. Jeśli urwało się w połowie słowa albo '
          + 'adresu, dokończ to słowo. Doprowadź odpowiedź do końca.' },
      ],
    }); } catch (err) {
      // Człowiek przerwał – to nie awaria, obsługa przerwania zna napisany tekst.
      if (err.name === 'AbortError' || turaPrzerwana) { err.partial = doklejBezZakladki(pelny, err.partial || ''); throw err; }
      /* Dostawca padł w trakcie dokańczania (529, 500, za długi kontekst).
         Odpowiedź, którą człowiek już czyta, zostaje – z notą, że koniec się
         urwał. Dawniej znikała cała i zostawał dymek błędu, a „Ponów” płacił
         drugi raz za całość (zespół IT, runda 7). */
      pelny = doklejBezZakladki(pelny, err.partial || '');
      lastModelNote = [lastModelNote, t('model.dokonczenieUrwane')].filter(Boolean).join(' ');
      lastFinish = 'blad-dokonczenia';
      break;
    }
    if (!ciag.trim()) break;
    // Bez spacji: ciąg dalszy potrafi zacząć się w środku wyrazu. A często
    // zaczyna od powtórzenia ostatnich słów – tę zakładkę zdejmujemy.
    pelny = doklejBezZakladki(pelny, ciag);
  }
  return pelny;
}

// Tok myślenia z ostatniej tury – awaryjne źródło treści, gdy `content` był pusty.
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
    // faktycznie wyczyta odpowiedź – zajawka to zwykle sam opis serwisu.
    // Cudzy tekst z rozbrojonymi znacznikami – strona nie podsunie modelowi [AKCJA:] ani [SZUKAJ:].
    const lines = data.results.map((r, i) => rozbrojZnaczniki(
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
      + (r.text ? `\n   TREŚĆ STRONY:\n   ${r.text.replace(/\n/g, '\n   ')}` : '')));
    /* W trybie głosowym wynik NIE każe dopisywać sekcji „Źródła:” – jako
       najświeższa wiadomość wygrywał z instrukcją TRYB GŁOSOWY i lektor czytał
       „Źródła. IMGW.” (agencja, runda 6). */
    return t(voiceMode ? 'search.resultsGlos' : 'search.results', { q: query, lines: lines.join('\n') });
  } catch (err) {
    return t('search.netErr', { q: query, e: err.message });
  }
}

/* Znaczniki modelu i wynik archiwum → kontekst: `public/protokol.js`.
   Czysty tekst, bez DOM-u i bez stanu, więc daje się sprawdzić w Node
   – patrz nagłówek tamtego pliku. */
const {
  SEARCH_MARKER_RE, IMAGE_MARKER_RE, PHOTO_MARKER_RE, RUN_FENCE_RE,
  CANVAS_NEW_RE, CANVAS_PATCH_RE, ARCHIVE_RE, PLAN_RE, ACTION_RE,
  ZNACZNIKI, ARCH_LIMIT_ZNAKOW, stripSearchMarker, rozdzielMyslenie, widokWToku, wstawZnacznikiZdjec, naKontekst, bezOgonkowKlient,
  rozlozZdjecia, zeZnacznikamiZdjec, sekcjaWPozycji,
  scalRozmowy, granicaPonowienia, jednostkiNaGlos, bezZrodel, adresDoOtwarcia, czyOtworz, liczbyNaGlos,
  adresPrywatny, rozbrojZnaczniki,
} = utworzProtokol();

/* ============ ZESPÓŁ AGENTÓW ============
   Widok i czyste funkcje stanu: public/zespol-widok.js. Tu zostaje klej:
   zdarzenia biegu → blok w odpowiedzi, zapis notatek przed odpowiedzią
   prowadzącego, przycisk w polu wiadomości, propozycja pod odpowiedzią,
   bramka zgody przed startem, edytor modelu roli, Ustawienia → Agenci
   i kropki ról w trybie głosowym. Serwer: lib/zespol.js. */
const ZDARZENIA_ZESPOLU = new Set(['zespol', 'sklad', 'rola', 'faza']);
const zespolWidok = utworzZespolWidok({ t, renderMarkdown, widokWToku, nazwaSilnika, jezyk: () => getLang(), wlasneRole: () => wlasneRoleOsoby() });
const PLATNE_SILNIKI = ['openai', 'claude'];
let zespolNaTure = null;        // jednorazowa prośba o zespół dla następnej tury
let propozycjaZespolu = null;   // „Mogę to sprawdzić zespołem” pod ostatnią odpowiedzią (tylko w pamięci)
const cfgZespolu = () => (serverConfig && serverConfig.zespol) || {};
let ustawieniaZespolu = null;     // GET /api/zespol/ustawienia (z własnymi rolami, budżetem, „potwierdzaj”)
/** Własne role osoby (Ustawienia → Agenci) – z /api/zespol/ustawienia, pobieranych na starcie. */
const wlasneRoleOsoby = () => (ustawieniaZespolu && Array.isArray(ustawieniaZespolu.wlasneRole) ? ustawieniaZespolu.wlasneRole
  : Array.isArray(cfgZespolu().wlasneRole) ? cfgZespolu().wlasneRole : []);
/* „Pytaj przed startem” żyje na serwerze (pole `potwierdzaj`). Wyłączone
   w przeglądarce przed przenosinami czeka na jednorazową migrację – do tego
   czasu obowiązuje wartość z przeglądarki, żeby nic nie zaczęło pytać samo. */
function potwierdzajZespolu() {
  if (settings.zespolPotwierdzaj === false) return false;
  if (ustawieniaZespolu && typeof ustawieniaZespolu.potwierdzaj === 'boolean') return ustawieniaZespolu.potwierdzaj;
  if (typeof cfgZespolu().potwierdzaj === 'boolean') return cfgZespolu().potwierdzaj;
  return true;
}

/** Indeks ostatniej wypowiedzi człowieka (nie wyniku narzędzia) – początek tury. */
function granicaTury(conv) {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i];
    if (m.role === 'user' && !m.search) return i;
  }
  return 0;
}
/** Odcisk zapytania – ten sam, którym narzędzie szukania pilnuje powtórek (narzedzia.js). */
const odciskZapytania = (q) => bezOgonkowKlient(String(q || '')).toLowerCase().replace(/\s+/g, ' ');

/* Zgoda na chmurę przy lokalnym prowadzącym i „Nie teraz” pod propozycją –
   do końca ROZMOWY (w tej karcie przeglądarki), nie na zawsze. Stała zgoda
   jest w Ustawieniach → Agenci i żyje na serwerze. */
function zbiorSesji(klucz) {
  try { return new Set(JSON.parse(sessionStorage.getItem(klucz) || '[]')); } catch { return new Set(); }
}
function dopiszDoSesji(klucz, id) {
  const z = zbiorSesji(klucz);
  z.add(id);
  try { sessionStorage.setItem(klucz, JSON.stringify([...z].slice(-200))); } catch { /* bez pamięci – zostaje w tej stronie */ }
  (pamiecSesji[klucz] ||= new Set()).add(id);
}
const pamiecSesji = {};
const wSesji = (klucz, id) => Boolean(id) && (zbiorSesji(klucz).has(id) || Boolean(pamiecSesji[klucz] && pamiecSesji[klucz].has(id)));
const zgodaChmury = (conv) => Boolean(cfgZespolu().zgodaChmura) || wSesji('cosmos.zespol.zgoda', conv && conv.id);
const ustawZgode = (conv) => conv && dopiszDoSesji('cosmos.zespol.zgoda', conv.id);
const wyciszonyZespol = (conv) => wSesji('cosmos.zespol.cisza', conv && conv.id);

/** Modele wybrane w zakładkach silników – serwer dobiera z nich modele ról. */
function modeleZakladek() {
  const m = {};
  for (const s of SILNIKI_Z_MODELEM) {
    if (!serverConfig.endpoints || !serverConfig.endpoints[s]) continue;
    const id = nadpisanieModelu(s) || epConfig(s).model;
    if (id) m[s] = id;
  }
  return m;
}

/** Pole `zespol` dla pierwszego żądania tury (albo undefined). */
function zespolDoWyslania(conv, prosba) {
  const cfg = cfgZespolu();
  if (!cfg.dozwolony) return undefined;
  // „Bez agentów” (zgoda głosem: „nie” albo cisza) – ta tura bez zespołu, także bez planisty.
  if (prosba && prosba.bez) return undefined;
  const baza = { modele: modeleZakladek(), zgoda: { chmura: zgodaChmury(conv) || Boolean(prosba && prosba.zgoda) },
    // Fotograf: miejsce i czas z planu, gdy skład układa osoba (planista wtedy nie rusza).
    ...(prosba && prosba.miejsce ? { miejsce: prosba.miejsce } : {}), ...(prosba && prosba.kiedy ? { kiedy: prosba.kiedy } : {}) };
  // „Darmowe modele” (K5): serwer dobiera rolom z Auto tylko darmowe silniki.
  if (prosba && Array.isArray(prosba.sklad) && prosba.sklad.length) {
    return { ...baza, sklad: prosba.sklad, uruchom: true, ...(prosba.tylkoDarmowe ? { tylkoDarmowe: true } : {}) };
  }
  if (prosba && prosba.uruchom) return { ...baza, uruchom: true };
  /* Bez prośby – serwer sam decyduje (bramka 0 ms), czy pytanie warte jest
     zespołu: „Proponuj”, „Uruchamiaj sam”, a w każdym trybie poza wyłączonym
     – jawne „zrób to zespołem”. Wyciszona rozmowa nie płaci za planistę. */
  if (cfg.tryb === 'wylaczony' || wyciszonyZespol(conv)) return undefined;
  return { ...baza, auto: true };
}

/** Wiadomość notatek do rozmowy – raz na turę, przed odpowiedzią prowadzącego. */
function zapiszNotatkiTury(conv, zt, stan) {
  if (!zt || zt.zapisane) return;
  const w = ZESPOL.wiadomoscNotatek(zt.st);
  if (!w) return;
  zt.zapisane = true;
  conv.messages.push(w);
  if (zt.st.szukaj && stan) (stan.szukaj ||= new Set()).add(odciskZapytania(zt.st.szukaj));
  // C5: fotograf dostał policzony plan – [PLAN:] prowadzącego w tej turze nie liczy drugiego (narzedzia.js).
  if (zt.st.planPoliczony && stan) stan.planZespolu = true;
}

/** Zdarzenie zespołu z biegu → stan tury i blok w karcie odpowiedzi. */
function zespolZdarzenie(zt, typ, surowe, miejsce) {
  let d;
  try { d = JSON.parse(surowe); } catch { return; }
  const ogloszenia = ZESPOL.zjedzZdarzenieZespolu(zt.st, typ, d);
  if (typ === 'sklad' && d.propozycja) return;
  /* Tryb głosowy: rola w chmurze czeka na zgodę (lokalny prowadzący). Bramki
     nie ma czego kliknąć, więc bieg staje, ZANIM role ruszą, a Cosmos pyta
     głosem (pytajOZgodeWBiegu w runGeneration). */
  if (typ === 'sklad' && voiceMode && zt.st.wymagaZgody && !zt.zgodaGlos && !zgodaChmury(zt.conv)) {
    zt.zgodaGlos = { role: zt.st.role.map((r) => ({ ...r })), odrzucone: zt.st.odrzucone.slice(), silniki: zt.st.silnikiZaZgoda.slice(),
      miejsce: zt.st.miejsce, kiedy: zt.st.kiedy };
    stopGeneration();
    return;
  }
  /* Planista uznał, że zespół niepotrzebny (tryb „sam”) – odpowiada sam prowadzący.
     Zostaje tylko linijka roli, która czeka na zgodę na chmurę („Zgoda i ponów”). */
  if (zt.st.faza === 'bez-rol' && !ZESPOL.czekaNaZgode(zt.st)) { if (zt.ui) { zt.ui.el.remove(); zt.ui = null; } return; }
  if (!zt.ui) {
    zt.ui = zespolWidok.blokZespolu(zt.st, { zywy: true, naPomin: (r) => zespolAkcja('pomin', r), naScal: () => zespolAkcja('scal') });
    miejsce.kolumna.insertBefore(zt.ui.el, miejsce.body);
    dopiszProwadzi(miejsce.podpis);
    clearInterval(zt.tik);
    // Sekundy „pracuje · 12 s” płyną także wtedy, gdy rola milczy.
    zt.tik = setInterval(() => { if (zt.ui && zt.st.faza === 'role') zt.ui.odswiez(); }, 1000);
  }
  zt.ui.odswiez();
  // Kursor prowadzącego dopiero, gdy on pisze – w fazie ról postęp pokazuje blok.
  miejsce.body.hidden = zt.st.faza === 'planowanie' || zt.st.faza === 'role';
  for (const o of ogloszenia) zt.ui.oglos(zespolWidok.tekstOgloszenia(o, zt.st));
  if (typ === 'faza') zt.ui.zwin();
  glosZespolu(zt.st);
}

/** „Pomiń” roli i „Stop zespołu – odpowiedz sam” w trakcie biegu. */
function zespolAkcja(typ, r) {
  const bieg = biegBiezacy && biegBiezacy.id;
  if (!bieg) return;
  fetch(`/api/zespol/${typ === 'pomin' ? 'pomin' : 'scal'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bieg, ...(r ? { r } : {}) }),
  }).catch(() => { /* bieg już się skończył */ });
}

/** Tryb głosowy: kropki ról pod kulą i „ZESPÓŁ · 2 Z 3”; null = sprzątnij. */
function glosZespolu(st) {
  const nakladka = $('voice-overlay');
  const stary = nakladka && nakladka.querySelector('.voice-zespol');
  if (!voiceMode || !st || !st.role.length) { if (stary) stary.remove(); return; }
  const nowy = zespolWidok.kropkiGlosu(st);
  if (stary) stary.replaceWith(nowy);
  else nakladka.querySelector('.voice-fala')?.after(nowy);
  const status = zespolWidok.statusGlosu(st);
  if (status && el.voiceStatus.textContent !== status) el.voiceStatus.textContent = status;
}

/** Karta odpowiedzi (awatar, nić, podpis) bez treści – dla bloku bez odpowiedzi. */
function kartaOdpowiedzi(silnik, model, prowadzi = true) {
  const msg = document.createElement('div');
  msg.className = 'msg msg-assistant';
  if (silnik) msg.dataset.silnik = silnik;
  msg.innerHTML = `<div class="msg-avatar">${AVATAR_SVG}</div>`;
  const kolumna = document.createElement('div');
  kolumna.className = 'msg-kolumna';
  kolumna.style.flex = '1';
  kolumna.style.minWidth = '0';
  const podpis = podpisSilnika(silnik, model, prowadzi);
  if (podpis) kolumna.appendChild(podpis);
  msg.appendChild(kolumna);
  return { msg, kolumna };
}

/** Blok zapisanego zespołu (wynik) z akcjami po wyniku. */
function blokZapisanegoZespolu(notatki, st = ZESPOL.stanZWiadomosci(notatki.m)) {
  const blok = zespolWidok.blokZespolu(st, {
    zywy: false,
    naZmienSklad: () => zmienSkladTury(notatki.idx, st, blok.el),
    naZgodaIPonow: () => { ustawZgode(activeConv()); ponowZespolem(notatki.idx, { uruchom: true }); },
  });
  return blok.el;
}

/** Notatki bez odpowiedzi (restart w fazie ról, Stop) – karta z samym blokiem. */
function kartaSamegoZespolu(notatki, { bezBledu = false } = {}) {
  const st = ZESPOL.stanZWiadomosci(notatki.m);
  const p = st.prowadzacy || {};
  const { msg, kolumna } = kartaOdpowiedzi(p.silnik || '', p.model || '');
  kolumna.appendChild(blokZapisanegoZespolu(notatki, st));
  // `bezBledu`: prowadzący pisze dalej (po narzędziu) – to nie jest „nie złożył odpowiedzi”.
  if (!bezBledu && String(notatki.m.content || '').trim() && !isGenerating) {
    kolumna.appendChild(zespolWidok.bladScalenia(p.silnik || 'cloud', () => zlozPonownie(notatki.idx)));
  }
  return msg;
}

/** Nowa tura zespołu zamiast wszystkiego po pytaniu (jedno pytanie = jedna odpowiedź). */
function zespolOdPytania(conv, prosba) {
  if (!conv || isGenerating) return;
  /* Odpowiedź solo nie znika bez słowa (K6, runda 11): zwija się do „Odpowiedź
     bez zespołu” na górze karty odpowiedzi zespołu, a jej koszt wchodzi do
     „cała odpowiedź”. Dawniej o zastąpieniu mówił tylko dymek przycisku. */
  const od = granicaTury(conv) + 1;
  const solo = conv.messages.slice(od).filter((m) => m.role === 'assistant' && !m.status && !m.error
    && typeof m.content === 'string' && m.content.trim());
  zastapioneNaTure = solo.length ? {
    conv,
    usuniete: conv.messages.slice(od),
    kosztZl: solo.reduce((s, m) => s + (typeof m.kosztZl === 'number' ? m.kosztZl : 0), 0),
    poprzednie: solo.flatMap((m) => [...(Array.isArray(m.poprzednie) ? m.poprzednie : []),
      { content: m.content, silnik: m.silnik, model: m.model, powod: 'bez-zespolu', kosztZl: m.kosztZl, kiedy: m.kiedy }]),
  } : null;
  conv.messages = conv.messages.slice(0, od);
  propozycjaZespolu = null;
  zespolNaTure = prosba;
  saveConversations();
  renderMessages();
  runGeneration(conv);
}
/** Zespół od nowa od miejsca notatek (Ponów zespołem, Zgoda i ponów, Zmień skład). */
function ponowZespolem(notIdx, prosba) {
  const conv = activeConv();
  if (!conv || isGenerating) return;
  conv.messages = conv.messages.slice(0, notIdx);
  propozycjaZespolu = null;
  zespolNaTure = prosba;
  saveConversations();
  renderMessages();
  runGeneration(conv);
}
/** Prowadzący od nowa na tych samych notatkach – bez drugiego zespołu. */
function zlozPonownie(notIdx) {
  const conv = activeConv();
  if (!conv || isGenerating) return;
  conv.messages = conv.messages.slice(0, notIdx + 1);
  saveConversations();
  renderMessages();
  runGeneration(conv);
}

/** Klucze ról, które można dołożyć do składu (oko – tylko przy obrazie). */
function katalogRol(conv) {
  const pytanie = conv && conv.messages[granicaTury(conv)];
  const obraz = Boolean(pytanie && msgImages(pytanie).length);
  return [
    ...roleWbudowane().filter((k) => k !== 'oko' || obraz).map((klucz) => ({ klucz })),
    // Własne role osoby – „Dodaj rolę” pokazuje je z oznaczeniem „własna”.
    ...wlasneRoleOsoby().filter((r) => r && r.id && (!r.wymagaObrazu || obraz))
      .map((r) => ({ klucz: r.id, nazwa: r.nazwa, cel: r.cel, wlasna: true, wymagaObrazu: Boolean(r.wymagaObrazu) })),
  ];
}
/** Klucze ról z katalogu Cosmosa – bez własnych („w-…”), które serwer dopisuje do `config.zespol.role`. */
const roleWbudowane = () => (cfgZespolu().role || []).filter((k) => typeof k === 'string' && !/^w-/.test(k));

/** Czy skład ma rolę na płatnym silniku innym niż prowadzący (ustawienie „Pytaj przed startem”). */
const platnyInny = (role, prowadzacy) => potwierdzajZespolu()
  && (role || []).some((r) => !r.auto && PLATNE_SILNIKI.includes(r.silnik) && r.silnik !== (prowadzacy && prowadzacy.silnik));

/**
 * Skład do przejrzenia (bramka zgody, edycja) w miejscu elementu `zamiast`.
 * naWynik({sklad, zgoda, tylkoDarmowe?}) – Start albo „Tylko lokalnie”; naWynik(null) – „Bez agentów”.
 * `darmowe`, `skladDomyslny`, `kandydaci`, `szacunekProwadzacyZl` – z planu (K5), `wariant` – wymuszony start.
 */
function pokazPropozycje(zamiast, { conv, role, prowadzacy, lokalnie = null, szacunekZl, miejsce = '', kiedy = '', naWynik,
  darmowe = null, skladDomyslny = '', kandydaci = null, szacunekProwadzacyZl, wariant = '' }) {
  const mk = { ...(miejsce ? { miejsce } : {}), ...(kiedy ? { kiedy } : {}) };
  const pytajOZgode = prowadzacy.silnik === 'local' && !zgodaChmury(conv);
  const lokalnieDomyslnie = pytajOZgode && serverConfig.endpoints && serverConfig.endpoints.local
    ? role.map((r) => ({ ...r, silnik: 'local', model: r.silnik === 'local' ? r.model : prowadzacy.model, auto: false })) : null;
  const p = zespolWidok.propozycja({
    role, prowadzacy, pytajOZgode, lokalnie: lokalnie || lokalnieDomyslnie, szacunekZl,
    darmowe, skladDomyslny, kandydaci, szacunekProwadzacyZl, wariant,
    maxRol: cfgZespolu().maxRol || 3, katalog: katalogRol(conv),
    otworzEdytor: (r, btn, gotowe, dodatki) => otworzEdytorRoli(r, btn, gotowe, { dodatki }),
    naStart: ({ role: r, zgoda, tylkoDarmowe }) => {
      if (zgoda) ustawZgode(conv);
      naWynik({ sklad: ZESPOL.skladDoWyslania(r), zgoda, ...(tylkoDarmowe ? { tylkoDarmowe: true } : {}), ...mk });
    },
    naTylkoLokalnie: (r, { tylkoDarmowe } = {}) => naWynik({ sklad: ZESPOL.skladDoWyslania(r), ...(tylkoDarmowe ? { tylkoDarmowe: true } : {}), ...mk }),
    naBez: () => naWynik(null),
  });
  zamiast.replaceWith(p.el);
  requestAnimationFrame(() => p.el.scrollIntoView({ block: 'nearest' }));
  return p;
}

/** „Zmień skład” pod odpowiedzią zespołu: edycja w miejscu bloku, Start = nowy zespół. */
function zmienSkladTury(notIdx, st, blokEl) {
  const conv = activeConv();
  if (!conv || isGenerating || !blokEl.isConnected) return;
  const prowadzacy = st.prowadzacy || { silnik: endpoint, model: currentModel() };
  pokazPropozycje(blokEl, {
    conv, prowadzacy, miejsce: st.miejsce, kiedy: st.kiedy,
    // Poprawka po recenzji (fala 3) nie jest rolą składu – serwer dokłada ją sam.
    role: st.role.filter((r) => r.fala !== 3).map((r) => ({ rola: r.rola, zadanie: '', silnik: r.silnik, model: r.model, ...(r.wlasna ? { wlasna: true, nazwa: r.nazwa } : {}) })),
    naWynik: (w) => (w ? ponowZespolem(notIdx, w) : renderMessages({ przewin: false })),
  });
}

/**
 * Przycisk „Zespół”: skład przed startem, gdy może być potrzebna zgoda
 * (lokalny prowadzący, a rola w chmurze) albo potwierdzenie roli na innym
 * płatnym silniku. Plan idzie BEZ zgody – planista zostaje lokalny, a role
 * z chmury wracają jako `zamiast` z powodem `wymaga-zgody`.
 * Zwraca prośbę do zespolDoWyslania, null („Bez agentów”) albo 'stop'.
 */
async function bramkaZespolu(conv) {
  const cfg = cfgZespolu();
  const prowadzacy = { silnik: znakTury.silnik, model: znakTury.model };
  const silnikiOsoby = Object.keys(serverConfig.endpoints || {});
  const mozeChmura = prowadzacy.silnik === 'local' && !zgodaChmury(conv) && silnikiOsoby.some((s) => s !== 'local');
  const mozePlatny = potwierdzajZespolu() && silnikiOsoby.some((s) => PLATNE_SILNIKI.includes(s) && s !== prowadzacy.silnik);
  if (!cfg.dozwolony || (!mozeChmura && !mozePlatny)) return { uruchom: true };

  const { msg, kolumna } = kartaOdpowiedzi(prowadzacy.silnik, prowadzacy.model);
  const stDob = ZESPOL.nowyStanTury();
  stDob.faza = 'planowanie';
  const dobieranie = zespolWidok.blokZespolu(stDob, { zywy: true });
  kolumna.appendChild(dobieranie.el);
  el.messages.appendChild(msg);
  scrollToBottom(true);
  const ac = new AbortController();
  abortController = ac;
  try {
    let plan = null;
    try {
      const r = await fetch('/api/zespol/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ac.signal,
        body: JSON.stringify({
          messages: toApiMessages(conv), endpoint: prowadzacy.silnik, model: znakTury.nadpisanie || undefined,
          modele: modeleZakladek(), zgoda: { chmura: zgodaChmury(conv) }, trybGlosowy: voiceMode || undefined, jawna: true,
        }),
      });
      plan = r.ok ? await readJsonSafe(r) : null;
    } catch { if (ac.signal.aborted) return 'stop'; }
    if (ac.signal.aborted || turaPrzerwana) return 'stop';
    const role = plan && plan.sklad && Array.isArray(plan.sklad.role) ? plan.sklad.role : [];
    // Planu nie ma – serwer ułoży skład sam, w biegu.
    if (!role.length) return { uruchom: true };
    const zaZgoda = ZESPOL.wymagaZgodyZ(plan.wymagaZgody) ? ZESPOL.skladZaZgoda(role) : null;
    /* Skład startowy bez bramki: przy ustawieniu „Darmowe modele” – darmowy (K5).
       Darmowy wariant idzie na darmowe silniki, więc nie wymaga potwierdzenia płatnego. */
    const start = ZESPOL.skladStartowy(plan.sklad);
    const zDarmowe = start.tylkoDarmowe ? { tylkoDarmowe: true } : {};
    // Fotograf w składzie: miejsce i czas z planu idą razem ze składem.
    const mkPlanu = { ...(plan.sklad.miejsce ? { miejsce: String(plan.sklad.miejsce) } : {}), ...(plan.sklad.kiedy ? { kiedy: String(plan.sklad.kiedy) } : {}) };
    const pytajOZgode = Boolean(zaZgoda && ZESPOL.silnikiChmury(zaZgoda).length);
    /* Tryb głosowy: bramki nie ma czego kliknąć w wątku – pytanie o chmurę
       idzie głosem (i trzema przyciskami na scenie). O płatny silnik głos nie
       pyta osobno: o zespół poproszono tu wprost, a koszt stoi w bloku. */
    if (voiceMode) {
      if (!pytajOZgode) return { sklad: ZESPOL.skladDoWyslania(start.role), ...zDarmowe, ...mkPlanu };
      const w = await pytajOZgodeGlosem(ZESPOL.silnikiChmury(zaZgoda), zaZgoda);
      if (ac.signal.aborted || turaPrzerwana) return 'stop';
      if (w === 'tak') { ustawZgode(conv); return { sklad: ZESPOL.skladDoWyslania(zaZgoda), zgoda: true, ...mkPlanu }; }
      if (w === 'lokalnie') return { sklad: ZESPOL.skladDoWyslania(role), ...mkPlanu };
      return null;
    }
    if (!pytajOZgode && (start.wariant === 'darmowe' || !platnyInny(role, prowadzacy))) {
      return { sklad: ZESPOL.skladDoWyslania(start.role), ...zDarmowe, ...mkPlanu };
    }
    return await new Promise((ok) => {
      ac.signal.addEventListener('abort', () => ok('stop'), { once: true });
      pokazPropozycje(dobieranie.el, {
        conv, prowadzacy, role: zaZgoda || role, lokalnie: pytajOZgode ? role : null,
        // Szacunek planu dotyczy składu z planu; za zgodą (inne silniki) liczy się z ról.
        szacunekZl: zaZgoda ? undefined : plan.sklad.szacunekZl, ...mkPlanu,
        darmowe: plan.sklad.darmowe || null, skladDomyslny: plan.sklad.skladDomyslny || '',
        kandydaci: plan.sklad.kandydaci || null, szacunekProwadzacyZl: plan.sklad.szacunekProwadzacyZl,
        naWynik: (w) => ok(w),
      });
      scrollToBottom();
    });
  } finally {
    msg.remove();
    if (abortController === ac) abortController = null;
  }
}

/* ---- Zgoda GŁOSEM (U4) -------------------------------------------------
   W trybie głosowym wątku nikt nie ogląda, więc bramki zgody nie da się
   kliknąć. Gdy zespół chce użyć chmury przy lokalnym prowadzącym, Cosmos MÓWI
   pytanie, słucha odpowiedzi tym samym rozpoznawaniem mowy co zawsze
   (rozpoznajZgode w zespol-widok.js), a na scenie stoją też trzy przyciski.
   Dwie niejasne odpowiedzi albo 10 s ciszy = „bez agentów” – wtedy nic nie
   wychodzi z komputera. */
const ZGODA_GLOSEM_MS = 10000;
let zgodaGlosem = null;          // { odpowiedz(tekst), wybierz(w) } – gdy czekamy na odpowiedź

function pytajOZgodeGlosem(silniki, role) {
  return new Promise((gotowe) => {
    const panel = $('voice-zgoda');
    let timer = null;
    let sufit = 0;
    let niejasne = 0;
    let koniec = false;
    const zakoncz = (w) => {
      if (koniec) return;
      koniec = true;
      clearTimeout(timer);
      zgodaGlosem = null;
      if (panel) panel.hidden = true;
      el.voiceAnswer.textContent = '';
      glosZespolu(null);
      ustawGluchote(true);             // tura rusza dalej – Cosmos myśli, nie słucha
      if (voiceMode) setVoiceState('thinking');
      gotowe(['tak', 'lokalnie', 'nie'].includes(w) ? w : 'nie');
    };
    // 10 s na odpowiedź od końca pytania; trwająca mowa albo rozpoznawanie przesuwa termin (najwyżej o 8 s).
    const odliczaj = (ms = ZGODA_GLOSEM_MS) => {
      clearTimeout(timer);
      if (ms === ZGODA_GLOSEM_MS) sufit = Date.now() + ZGODA_GLOSEM_MS + 8000;
      timer = setTimeout(() => {
        if (typeof nasluchZajety === 'function' && nasluchZajety() && Date.now() < sufit) { odliczaj(400); return; }
        zakoncz('nie');
      }, ms);
    };
    let powiedziane = '';
    const mow = async (tekst) => {
      el.voiceAnswer.textContent = tekst;
      setVoiceState('speaking');
      powiedziane = stripForSpeech(tekst);
      voiceOstatniaOdpowiedz = powiedziane;
      await speakText(tekst);
      voiceKoniecMowienia = Date.now();
    };
    const sluchaj = () => {
      if (koniec) return;
      if (!voiceMode) { zakoncz('nie'); return; }
      startQueryListening();
      clearTimeout(nasluchCisza);      // koniec słuchania wyznacza pytanie o zgodę, nie zwykła cisza
      odliczaj();
    };
    zgodaGlosem = {
      odpowiedz(tekst) {
        /* Ogon własnego pytania z głośnika (tylko rozpoznawanie przeglądarki,
           tylko tuż po końcu mowy) – słuchamy dalej, bez liczenia jako
           niejasne. Zwykła zapora echa w askVoice tu nie działa: połykała
           odpowiedzi powtarzające słowa pytania („Tak, ale tylko lokalnie”). */
        const uslyszane = voicePoczatekWypowiedzi || Date.now();   // askVoice przychodzi 1,4 s ciszy później
        if (silnikNasluchu() === 'przegladarka'
          && ZESPOL.echoPytaniaZgody(tekst, powiedziane, uslyszane - voiceKoniecMowienia)) { sluchaj(); return; }
        el.voiceTranscript.classList.remove('podglad', 'komunikat');
        el.voiceTranscript.textContent = tekst;
        const w = ZESPOL.rozpoznajZgode(tekst, getLang() === 'en' ? 'en' : 'pl');
        if (w) { zakoncz(w); return; }
        if (++niejasne >= 2) { zakoncz('nie'); return; }
        clearTimeout(timer);
        mow(t('ag.glos.zgodaPowtorz')).then(sluchaj);
      },
      wybierz: zakoncz,
    };
    if (panel) panel.hidden = false;
    // Kropki proponowanych ról pod kulą – kto i na jakim silniku.
    glosZespolu({ faza: '', role: (role || []).map((r) => ({ ...r, stan: 'czeka' })) });
    const pytanie = t('ag.glos.zgodaPytanie', { silniki: silniki.map((x) => nazwaSilnika(x)).join(', ') });
    mow(pytanie).then(sluchaj);
  });
}

/**
 * Bieg zatrzymany na `sklad` z `wymagaZgody` (tryb głosowy) → pytanie głosem
 * i ta sama tura od nowa: „tak” – skład z chmurą (bez drugiego planisty, gdy
 * żadna rola nie odpadła), „tylko lokalnie” – skład z planu, „nie” – bez zespołu.
 */
async function pytajOZgodeWBiegu(conv, zg) {
  const zaZgoda = ZESPOL.skladZaZgoda(zg.role);
  const odpadly = zg.odrzucone.filter((o) => o.kod === 'wymaga-zgody');
  const mk = { ...(zg.miejsce ? { miejsce: zg.miejsce } : {}), ...(zg.kiedy ? { kiedy: zg.kiedy } : {}) };
  const silniki = [...new Set([...(zg.silniki || []), ...ZESPOL.silnikiChmury(zaZgoda), ...odpadly.map((o) => o.silnik).filter((x) => x && x !== 'local')])];
  const w = await pytajOZgodeGlosem(silniki.length ? silniki : ['cloud'], [...zaZgoda, ...odpadly.map((o) => ({ rola: o.rola, nazwa: o.nazwa, silnik: o.silnik || 'cloud' }))]);
  if (activeConv() !== conv) return;
  let prosba;
  if (w === 'tak') {
    ustawZgode(conv);
    prosba = odpadly.length ? { uruchom: true, zgoda: true } : { sklad: ZESPOL.skladDoWyslania(zaZgoda), zgoda: true, ...mk };
  } else if (w === 'lokalnie') {
    const lokalne = zg.role.filter((r) => r.silnik === 'local' || !ZESPOL.maPowod(r, 'wymaga-zgody'));
    prosba = lokalne.length ? { sklad: ZESPOL.skladDoWyslania(lokalne), ...mk } : { bez: true };
  } else prosba = { bez: true };
  zespolOdPytania(conv, prosba);
}

/** Cicha linijka „Mogę to sprawdzić zespołem” pod ostatnią odpowiedzią solo. */
function dolozPropozycjeZespolu(conv) {
  const p = propozycjaZespolu;
  if (!p || !conv || p.convId !== conv.id || isGenerating || wyciszonyZespol(conv)) return;
  const ost = conv.messages[conv.messages.length - 1];
  if (!ost || ost.role !== 'assistant' || ost.error || ost.status) return;
  const karty = el.messages.querySelectorAll('.msg-assistant');
  const kolumna = karty.length && karty[karty.length - 1].querySelector('.msg-kolumna');
  if (!kolumna) return;
  const prowadzacy = p.prowadzacy || { silnik: ost.silnik || endpoint, model: ost.model || currentModel() };
  const linijka = zespolWidok.sugestia(p, {
    naUruchom: () => uruchomPropozycje(conv, p, prowadzacy, false, linijka),
    naZmien: () => uruchomPropozycje(conv, p, prowadzacy, true, linijka),
    naUruchomDarmowo: () => uruchomPropozycje(conv, p, prowadzacy, false, linijka, 'darmowe'),
    naNieTeraz: () => { dopiszDoSesji('cosmos.zespol.cisza', conv.id); propozycjaZespolu = null; linijka.remove(); el.input.focus(); },
  });
  kolumna.insertBefore(linijka, kolumna.querySelector('.msg-actions'));
}

/** „Uruchom” = regeneracja TEJ odpowiedzi zespołem; „Zmień” – najpierw edycja składu. */
function uruchomPropozycje(conv, p, prowadzacy, edycja, linijka, wariant = '') {
  if (isGenerating) return;
  // Skład startowy jak w linijce (ustawienie „Darmowe modele”) albo wymuszony przez „Za 0 zł”.
  const start = wariant === 'darmowe' && p.darmowe
    ? { wariant: 'darmowe', role: ZESPOL.wariantDarmowy(p.darmowe).role, tylkoDarmowe: true } : ZESPOL.skladStartowy(p);
  const chmura = prowadzacy.silnik === 'local' && !zgodaChmury(conv) && ZESPOL.silnikiChmury(start.role).length > 0;
  if (!edycja && !chmura && (start.wariant === 'darmowe' || !platnyInny(start.role, prowadzacy))) {
    zespolOdPytania(conv, { sklad: ZESPOL.skladDoWyslania(start.role), ...(start.tylkoDarmowe ? { tylkoDarmowe: true } : {}),
      ...(p.miejsce ? { miejsce: p.miejsce } : {}), ...(p.kiedy ? { kiedy: p.kiedy } : {}) });
    return;
  }
  pokazPropozycje(linijka, {
    conv, prowadzacy, role: p.role.map((r) => ({ ...r })), szacunekZl: p.szacunekZl, miejsce: p.miejsce, kiedy: p.kiedy,
    darmowe: p.darmowe || null, skladDomyslny: p.skladDomyslny || '', kandydaci: p.kandydaci || null,
    szacunekProwadzacyZl: p.szacunekProwadzacyZl, wariant,
    naWynik: (w) => (w ? zespolOdPytania(conv, w) : renderMessages({ przewin: false })),
  });
}

/** Podpis modelu w edytorze: cechy z katalogu (models.js). */
function opisModelu(id, silnik) {
  const info = typeof modelInfo === 'function' ? modelInfo(id, silnik) : null;
  if (!info || !Array.isArray(info.cechy)) return '';
  const jezyk = getLang() === 'en' ? 'en' : 'pl';
  return info.cechy.map((c) => (CECHA_OPIS[c] ? CECHA_OPIS[c][jezyk] : '')).filter(Boolean).join(' · ');
}
/** Modele do wyboru, pogrupowane według silników tej osoby. */
function grupyModeli(r) {
  return SILNIKI_Z_MODELEM.filter((s) => serverConfig.endpoints && serverConfig.endpoints[s]).map((s) => {
    const ids = [nadpisanieModelu(s) || epConfig(s).model, r && r.silnik === s ? r.model : '', epConfig(s).visionModel,
      ...((listyModeli[s] && listyModeli[s].modele) || []).slice(0, 8)].filter(Boolean);
    return { silnik: s, modele: [...new Set(ids)].map((id) => ({ id, podpis: opisModelu(id, s) })) };
  });
}
/** Silniki, których członek nie ma (właściciel może je przyznać w panelu Dostęp). */
const bezDostepuSilniki = () => (konta_.ja()?.rola === 'czlonek'
  ? SILNIKI_Z_MODELEM.filter((s) => !(serverConfig.endpoints && serverConfig.endpoints[s])) : []);

function otworzEdytorRoli(r, btn, gotowe, { zUsun = true, wybrany, dodatki = null } = {}) {
  zespolWidok.edytor({
    tytul: zespolWidok.nazwaRoli(r),
    grupy: grupyModeli(r),
    wybrany: wybrany !== undefined ? wybrany : (r.auto || !r.model ? null : { silnik: r.silnik, model: r.model }),
    autoPodpis: r.model ? t('ag.re.autoTeraz', { model: `${nazwaSilnika(r.silnik)} ${String(r.model).split('/').pop()}` }) : '',
    bezDostepu: bezDostepuSilniki(), zUsun, kotwica: btn, gotowe,
    // K5: kandydaci z planu, model „polecany” i Auto = „najlepszy darmowy” w składzie darmowym.
    ...(dodatki ? { kandydaci: dodatki.kandydaci, polecany: dodatki.polecany, trybDarmowy: dodatki.trybDarmowy } : {}),
  });
}

// ---- przycisk „Zespół” w polu wiadomości (jednorazowy) ----
let zespolWcisniety = false;
function ustawPrzyciskZespolu(tak) {
  const b = $('zespol-btn');
  zespolWcisniety = Boolean(tak) && Boolean(b) && !b.hidden;
  if (!b) return;
  b.setAttribute('aria-pressed', String(zespolWcisniety));
  b.title = t(zespolWcisniety ? 'ag.btnOn' : 'ag.btn');
  el.input.placeholder = t(zespolWcisniety ? 'ag.inputPh' : 'inputPh');
}
function odswiezPrzyciskZespolu() {
  const b = $('zespol-btn');
  if (!b) return;
  const cfg = cfgZespolu();
  b.hidden = !cfg.dozwolony || cfg.tryb === 'wylaczony';
  if (b.hidden) ustawPrzyciskZespolu(false);
}
$('zespol-btn')?.addEventListener('click', () => { ustawPrzyciskZespolu(!zespolWcisniety); el.input.focus(); });

// ---- Ustawienia → Agenci ----
async function rysujUstawieniaZespolu(pobierz = true, { fokus = '' } = {}) {
  const box = $('ag-ustawienia');
  if (!box) return;
  let cfg = cfgZespolu();
  if (!cfg.dozwolony) { box.textContent = ''; kartyUstawien.odswiez(); return; }
  if (pobierz) {
    await Promise.all([pobierzUstawieniaZespolu(), odswiezStanBudzetu()]);
    cfg = cfgZespolu();
  }
  const us = ustawieniaZespolu || { tryb: cfg.tryb, maxRol: cfg.maxRol, zgodaChmura: cfg.zgodaChmura, role: {} };
  // Fokus zostaje na tym samym elemencie po przebudowie (radio, segment, rola, pole formularza).
  const a = document.activeElement;
  const cel = fokus || (a && box.contains(a) ? (a.name === 'ag-tryb' ? `input[value="${a.value}"]`
    : a.closest('.ag-segment') ? `.ag-segment button:nth-child(${[...a.parentNode.children].indexOf(a) + 1})`
      : a.dataset && a.dataset.pole ? `[data-pole="${a.dataset.pole}"]`
        : a.closest('.ag-wlasna') ? `.ag-wlasna[data-id="${a.closest('.ag-wlasna').dataset.id}"] .${a.classList.contains('ag-wl-usun') ? 'ag-wl-usun' : 'ag-wl-edytuj'}`
          : a.closest('.ag-rola') ? `.ag-rola[data-rola="${a.closest('.ag-rola').dataset.rola}"] button` : '') : '');
  box.textContent = '';
  box.append(zespolWidok.panelUstawien({
    us, sufit: cfg.maxRolSufit || 3, potwierdzaj: potwierdzajZespolu(),
    katalog: roleWbudowane(), bezDostepu: bezDostepuSilniki(), naZmiane: zmienUstawieniaZespolu,
    otworzEdytor: (klucz, btn, gotowe) => otworzEdytorRoli({ rola: klucz }, btn, gotowe, { zUsun: false, wybrany: (us.role || {})[klucz] || null }),
    wlasne: wlasneRoleOsoby(), budzet: us.budzetZl, stanBudzetu: cfg.budzet, kurs: cfg.kurs, cennik: cfg.cennik,
    odswiez: (o) => rysujUstawieniaZespolu(false, o || {}),
  }));
  // querySelector znajduje też WYŁĄCZONY przycisk (8 ról), a .focus() na nim nic nie robi – fokus spadał na <body>.
  const celEl = cel ? box.querySelector(cel) : null;
  if (cel) (celEl && !celEl.disabled ? celEl : (fokus ? box.querySelector('.ag-wl-dodaj:not([disabled]), .ag-wl-edytuj') : null))?.focus();
  kartyUstawien.odswiez();
}

/** Ustawienia zespołu osoby z serwera (własne role, budżet, „potwierdzaj”) + migracja „potwierdzaj”. */
async function pobierzUstawieniaZespolu() {
  if (!cfgZespolu().dozwolony) return;
  try {
    const r = await fetch('/api/zespol/ustawienia');
    if (r.ok) ustawieniaZespolu = (await r.json()).ustawienia || ustawieniaZespolu;
  } catch { /* offline – z konfiguracji */ }
  migrujPotwierdzaj();
}

/** Świeży stan budżetu (wydano dziś, zostało) – z /api/config, tylko część zespołu. */
async function odswiezStanBudzetu() {
  try {
    const r = await fetch('/api/config');
    if (!r.ok) return;
    const d = await r.json();
    if (d && d.zespol) serverConfig.zespol = { ...cfgZespolu(), ...d.zespol };
  } catch { /* offline – zostaje stan z startu */ }
}

/** Zapis w Ustawienia → Agenci. Zwraca {ok, error} – formularz własnej roli
 *  zostaje otwarty z powodem, gdy serwer odmówi. */
async function zmienUstawieniaZespolu(zmiana) {
  let wynik = { ok: false, error: '' };
  try {
    const r = await fetch('/api/zespol/ustawienia', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(zmiana) });
    const d = await readJsonSafe(r);
    if (r.ok && d.ustawienia) {
      ustawieniaZespolu = d.ustawienia;
      serverConfig.zespol = { ...cfgZespolu(), tryb: d.ustawienia.tryb, maxRol: d.ustawienia.maxRol, zgodaChmura: d.ustawienia.zgodaChmura,
        ...(typeof d.ustawienia.potwierdzaj === 'boolean' ? { potwierdzaj: d.ustawienia.potwierdzaj } : {}) };
      wynik = { ok: true };
      if ('potwierdzaj' in zmiana) {
        if (typeof d.ustawienia.potwierdzaj === 'boolean') { delete settings.zespolPotwierdzaj; saveSettings(); }
        // Serwer bez pola `potwierdzaj` (starsza wersja) – ustawienie zostaje w przeglądarce jak dawniej.
        else { settings.zespolPotwierdzaj = zmiana.potwierdzaj; saveSettings(); }
      }
    } else {
      // Stały kod od serwera → zdanie w języku interfejsu (serwer pisze po polsku).
      const PO_KODZIE = { 'za-duzo-rol': t('ag.wl.limit', { max: 8 }), 'rola-bez-nazwy': t('ag.wl.brakNazwy'), 'zle-role': t('ag.wl.zleRole'), 'budzet-zly': t('ag.bud.zly'),
        'nazwa-zajeta': t('ag.wl.nazwaZajeta') };
      wynik = { ok: false, kod: (d && d.kod) || '', error: PO_KODZIE[d && d.kod] || (d && (d.error || d.blad)) || t('httpErr', { status: r.status }) };
    }
  } catch {
    /* Bez sieci w przeglądarce zostaje tylko WYŁĄCZENIE (przeniesie je migracja
       po powrocie sieci). Włączenie `true` nic by nie dało – potwierdzajZespolu()
       honoruje z przeglądarki tylko `false` – więc go nie udajemy: panel mówi, że zapis się nie udał. */
    if ('potwierdzaj' in zmiana && zmiana.potwierdzaj === false) { settings.zespolPotwierdzaj = false; saveSettings(); }
    wynik = { ok: false, error: t('ag.wl.bladZapisu') };
  }
  if ('budzetZl' in zmiana && wynik.ok) await odswiezStanBudzetu();
  odswiezPrzyciskZespolu();
  // Po zapisie własnej roli fokus wraca na „Dodaj własną rolę” (element sprzed przebudowy już nie istnieje).
  const fokus = 'wlasneRole' in zmiana && wynik.ok ? '.ag-wl-dodaj:not([disabled])' : '';
  await rysujUstawieniaZespolu(false, { fokus });
  return wynik;
}

/* „Pytaj przed startem” przeniesione na serwer (etap 5). Kto wyłączył je
   w tej przeglądarce, wysyła to raz na serwer; potem obowiązuje serwer na
   każdym urządzeniu. Włączone (domyślne) nie wymaga przenosin. */
let migracjaPotwierdzaj = false;
function migrujPotwierdzaj() {
  if (migracjaPotwierdzaj || settings.zespolPotwierdzaj !== false || !ustawieniaZespolu) return;
  migracjaPotwierdzaj = true;
  zmienUstawieniaZespolu({ potwierdzaj: false }).finally(() => { migracjaPotwierdzaj = false; });
}

/* Wynik narzędzia wraca do modelu jako wiadomość użytkownika – bo tak wygląda
   protokół rozmowy – ale UŻYTKOWNIK niczego nie napisał. Jedyne, co odróżnia
   jedno od drugiego na ekranie, to flaga `search`: z nią mamy zwijany blok
   „Przeszukuję…", bez niej zwykły dymek z pytaniem, którego nikt nie zadał.
   Zapomniano jej raz i wyglądało to jak rozmowa wznawiająca się sama.
   Dlatego wszystkie ruchy narzędzi idą tędy i flagi nie da się pominąć. */
// Które narzędzie właśnie pracuje – żeby wynik archiwum nie był podpisany „Wyniki wyszukiwania".
let narzedzieTeraz = '';
function dodajWynikNarzedzia(conv, tresc, etykieta, opcje = {}) {
  /* `sterowanie` (K1): polecenie dla modelu („plan już policzony”, „to zapytanie
     już wyszukałeś”), a nie wynik dla człowieka – model je dostaje, ekran nie. */
  conv.messages.push({ role: 'user', content: tresc, search: true, searchQuery: etykieta, narzedzie: narzedzieTeraz || undefined,
    ...(opcje && opcje.sterowanie ? { sterowanie: true } : {}) });
  saveConversations();
  /* Wynik narzędzia nie ściąga na dół kogoś, kto przewinął w górę i czyta
     (it-plynnosc, runda 11) – na dół tylko ten, kto już tam jest. */
  renderMessages({ przewin: sledzeDol });
}

/* Rejestr narzędzi. Budowany RAZ, przy wczytaniu skryptu – zależności są
   stałe, a lista musi być ta sama dla każdej tury. Wszystko, co narzędzia
   potrafią, siedzi w `public/narzedzia.js`; tutaj zostaje sama pętla. */
const NARZEDZIA = utworzNarzedzia({
  t,
  saveConversations,
  /* Siatki zdjęć przychodzą jedna po drugiej. Domyślne „przewiń na dół”
     ściągało czytającego z połowy planu na koniec przy każdej z szesnastu
     (zespół IT, runda 7) – na dół tylko ten, kto już tam jest. */
  renderMessages: (o) => renderMessages({ przewin: sledzeDol, ...(o || {}) }),
  dodajWynikNarzedzia,
  stripSearchMarker,
  readJsonSafe,
  fetch: (...a) => fetch(...a),
  webSearch,
  naKafelek,
  naKontekst,
  bezOgonkowKlient,
  zebranyMaterial,
  zastosujZmianePlotna,
  pokazPlotno,
  /* Komunikat głosowy w trakcie czynności. W trybie pisanym nie ma go wcale,
     więc narzędzia nie muszą wiedzieć, czy tryb głosowy jest włączony. */
  async mowGlosem(tekst) {
    if (!voiceMode) return;
    setVoiceState('speaking');
    await speakText(tekst);
    setVoiceState('thinking');
  },
  PORCJA_ARCHIWUM,
  wstawTekstModelu,
  rozlozZdjecia,
  sekcjaWPozycji,
  znakSilnika,
  /* Zdjęcia w jednej odpowiedzi (runda 10): grupa, która przyszła, podmienia
     tylko swój pasek (bez przebudowy rozmowy – leniwe ładowanie i miejsce
     czytającego zostają), zapis po każdej grupie, „Zatrzymaj” przerywa
     pobieranie, a myślenie rundy trafia do wiadomości jak przy zwykłej odpowiedzi. */
  odswiezZdjecia: (w) => odswiezPaski(w),
  zapiszWkrotce: (c, teraz = false) => {
    if (teraz) saveConversations(true, c);
    else if (c === activeConversation) saveConversationsSoon();
    else saveConversations(false, c);
  },
  sygnal: () => (abortTury ? abortTury.signal : null),
  metaOdpowiedzi: () => ({ think: lastThink, note: lastModelNote }),
  WZORCE: {
    SZUKAJ: SEARCH_MARKER_RE,
    ARCHIWUM: ARCHIVE_RE,
    PLAN: PLAN_RE,
    PLOTNO_NOWE: CANVAS_NEW_RE,
    PLOTNO_ZMIANA: CANVAS_PATCH_RE,
    KOD: RUN_FENCE_RE,
    GRAFIKA: PHOTO_MARKER_RE,
    OBRAZ: IMAGE_MARKER_RE,
  },
});

/** Domknij turę odpowiedzią modelu – JEDNO miejsce dla wszystkich narzędzi.
 *
 *  Ta logika była wcześniej przepisana trzy razy: przy wyczerpaniu limitu
 *  wyszukiwań, przy wyczerpaniu limitu zdjęć i na końcu pętli. Dwie kopie
 *  ustawiały `samoMyslenie`, trzecia nie – więc model rozumujący, któremu
 *  budżet tokenów poszedł w całości na myślenie, po zdjęciach pokazywał
 *  surowe rozumowanie zamiast komunikatu. Nikt tego nie zgłosił, bo trzeba
 *  trafić w rzadki zbieg okoliczności; kopiowanie kodu samo w sobie
 *  wystarczyło, żeby te trzy ścieżki się rozjechały.
 *
 *  @param {object} conv rozmowa
 *  @param {string} surowe treść od modelu (może być urwana)
 *  @returns {string} tekst do wypowiedzenia głosem albo pusty
 */
/* JEDNO WEJŚCIE NA TEKST MODELU – i jedna zapora przed powtórką.

   Marcin dostał w jednej turze TRZY kopie planu Majorki. Model po każdym
   wyniku narzędzia przepisywał całość od nowa, a każda runda to osobna
   wiadomość w rozmowie. Instrukcja „dopisz tylko to, czego jeszcze nie
   napisałeś" pomaga, ale nie jest gwarancją – model bywa uparty, a użytkownik
   ogląda skutek.

   Dlatego przepisana odpowiedź nie ląduje obok poprzedniej, tylko JĄ
   ZASTĘPUJE. Nowa wersja jest z definicji pełniejsza (model zna już wynik
   narzędzia), więc podmiana niczego nie gubi – a rozmowa zostaje czytelna.
   Szukamy tylko wśród wypowiedzi z BIEŻĄCEJ tury: powtórzenie planu sprzed
   pół godziny jest odpowiedzią na nowe pytanie i ma prawo zostać. */
/** Cały tekst modelu z bieżącej tury, sklejony z kawałków. */
function tekstTury(conv, odKtorej = 0) {
  return conv.messages.slice(odKtorej)
    .filter((m) => m.role === 'assistant' && typeof m.content === 'string' && !m.status && !m.error)
    .map((m) => m.content).join('\n\n');
}

/* SZKIC NIE ZNIKA (R1, runda 11). Szkic to tekst postawiony przed znacznikiem
   w rundzie, po której model dostał „napisz gotową odpowiedź” (zdjęcia
   odłożone do wersji z danymi). Dawniej nie szedł na ekran wcale: człowiek
   czytał 1017 znaków planu, a po sekundzie miał pusty pasek „Liczę światło…”
   i odpowiedź płynącą od zera. Teraz szkic stoi do końca, a gotowa wersja go
   zastępuje – stara treść zwija się do „Poprzedniej wersji” w tej samej
   karcie (agencja-ux, decyzja 4), więc nic przeczytanego nie znika bez słowa. */
const szkiceTury = new WeakSet();

/** Zamień treść wiadomości `i` na nową wersję; widzianą starą odłóż do `poprzednie`.
 *  Wiadomość idzie na koniec rozmowy – tam, gdzie przed chwilą pisała się nowa
 *  wersja (żywy dymek), a nie nad paskami narzędzi, gdzie stał szkic. */
function zastapTekstModelu(conv, i, czysty, powod) {
  const m = conv.messages[i];
  const stara = String(m.content || '');
  szkiceTury.delete(m);
  /* Krótki wstęp („Sprawdzę jeszcze jedno.”) i dalszy ciąg tego samego tekstu
     to nie jest inna wersja – zwinięta linijka byłaby szumem. */
  const A = stara.trim();
  if (A.length >= 200 && !czysty.trim().startsWith(A)) {
    dodajPoprzednia(m, { content: stara, silnik: m.silnik, model: m.model, powod });
  }
  m.content = czysty;
  if (i !== conv.messages.length - 1) {
    conv.messages.splice(i, 1);
    conv.messages.push(m);
  }
  return m;
}

/** Dopisz poprzednią wersję odpowiedzi (K6): tylko do widoku i eksportu, nigdy do modelu. */
function dodajPoprzednia(m, { content, silnik, model, powod, kosztZl, kiedy }) {
  if (!String(content || '').trim()) return;
  m.poprzednie = [...(Array.isArray(m.poprzednie) ? m.poprzednie : []), {
    content: String(content), powod: powod || 'przepisana', kiedy: kiedy || Date.now(),
    ...(silnik ? { silnik } : {}), ...(model ? { model } : {}),
    ...(typeof kosztZl === 'number' && kosztZl > 0 ? { kosztZl } : {}),
  }];
}

function wstawTekstModelu(conv, tresc, odKtorej = 0) {
  const czysty = String(tresc || '');
  if (!czysty.trim()) return null;
  for (let i = conv.messages.length - 1; i >= odKtorej; i--) {
    const m = conv.messages[i];
    if (m.role !== 'assistant' || typeof m.content !== 'string') continue;
    if (szkiceTury.has(m)) return dolozZastapione(conv, zastapTekstModelu(conv, i, czysty, 'szkic'));
    if (przepisanie(m.content, czysty)) return dolozZastapione(conv, zastapTekstModelu(conv, i, czysty, 'przepisana'));
  }
  /* Przepisana CAŁOŚĆ tury, która wcześniej stała w kawałkach (plan pokrojony
     siatkami zdjęć). Żaden kawałek sam nie jest „tym samym tekstem", ale
     wszystkie razem – tak. Kawałki już są na ekranie, drugi plan nie. */
  if (tenSamTekst(tekstTury(conv, odKtorej), czysty)) return null;
  const wiadomosc = { role: 'assistant', content: czysty, kiedy: Date.now(), ...znakSilnika() };
  conv.messages.push(wiadomosc);
  return dolozZastapione(conv, wiadomosc);
}

/* Odpowiedź solo zastąpiona odpowiedzią zespołu („Odpowiedz zespołem”, „Za 0 zł”)
   czeka tu na pierwszą wypowiedź nowej tury – wiadomość powstaje dopiero
   w domknijOdpowiedz/wstawTekstModelu (K6, runda 11). */
let zastapioneNaTure = null;     // { conv, poprzednie: [...] }
function dolozZastapione(conv, m) {
  if (m && zastapioneNaTure && zastapioneNaTure.conv === conv) {
    for (const p of zastapioneNaTure.poprzednie) dodajPoprzednia(m, p);
    zastapioneNaTure = null;
  }
  return m;
}

async function domknijOdpowiedz(conv, surowe) {
  // Urwane w pół zdania to nie jest gotowa odpowiedź – dokańczamy.
  const pelne = await dokoncz(conv, surowe);
  /* Akcję szukamy w SUROWYM tekście: `stripSearchMarker` czyści też [AKCJA:],
     więc po nim karta do zatwierdzenia nie pojawiała się nigdy – model pisał
     „zapamiętam", a nic się nie działo. */
  const akcja = pelne.match(ACTION_RE);
  const tresc = stripSearchMarker(pelne);
  /* Pusta treść przy modelu rozumującym znaczy „budżet tokenów poszedł
     w całości na myślenie". Kiedyś wyrzucaliśmy wtedy surowy tok myślenia
     jako odpowiedź – gorsze niż nic: rozumowanie jest po angielsku, urwane
     i pokazuje deliberację, której użytkownik widzieć nie powinien. */
  /* Pusto, ale tura już coś pokazała (zdjęcia, wstęp przed narzędziem) –
     sami każemy modelowi „napisz domknięcie albo nic", więc „nic" jest
     poprawne i nie zasługuje na dopisek „(pusta odpowiedź modelu)". */
  if (!tresc && !akcja) {
    const tura = conv.messages.slice(conv.__turaOd || 0);
    const widac = (m) => m.role === 'assistant' && !m.status && !m.error
      && (msgText(m).trim() || (Array.isArray(m.zdjecia) && m.zdjecia.length) || (m.content && typeof m.content === 'object'
        && ((m.content.photos || []).length || (m.content.images || []).length)));
    if (tura.some(widac)) {
      saveConversations();
      return '';
    }
  }
  const samoMyslenie = !tresc && Boolean(lastReasoning);
  if (samoMyslenie) lastThink = lastReasoning;
  /* Pusto i „length", a toku myślenia brak: gpt-5 czy Claude 5 myślą PO CICHU
     (dostawca go nie oddaje) i zużyły cały budżet. „Pusta odpowiedź modelu"
     wyglądała na usterkę, a to kwestia jednego ustawienia. */
  const budzetPoCichu = !tresc && !lastReasoning && lastFinish === 'length';
  const finalText = samoMyslenie ? t('budgetSpentOnThinking')
    : budzetPoCichu ? t('budgetSpentSilently') : (tresc || t('emptyReply'));
  // Dostawca uciął odpowiedź filtrem treści – wygląda jak zwykła, więc mówimy to wprost.
  if (lastFinish === 'content_filter') lastModelNote = [lastModelNote, t('model.filtr')].filter(Boolean).join(' ');

  if (akcja) {
    const widoczne = tresc;
    const typ = akcja[1].trim().toLowerCase();
    conv.messages.push({ role: 'assistant', content: widoczne || '…',
      think: lastThink, note: lastModelNote, ...znakSilnika() });
    // „otwórz stronę” to też otwarcie – karta dostaje jeden typ, a więc właściwą obsługę.
    const karta = { role: 'action', actionType: czyOtworz(typ) ? 'otwórz' : typ, actionText: akcja[2].trim() };
    /* Otwarcie bez adresu („[AKCJA: otwórz | adres]” przepisane z instrukcji)
       dawało martwą kartę z przyciskiem, który nic nie robi. */
    if (czyOtworz(typ) && !adresDoOtwarcia(karta.actionText)) {
      saveConversations();
      return widoczne;
    }
    conv.messages.push(karta);
    /* „Otwórz onet.pl” – strona otwiera się od razu, bez zatwierdzania: to nic
       nie zapisuje i niczego nie wysyła. Przeglądarka może jednak zablokować
       okno otwierane bez kliknięcia – wtedy zostaje karta z „Otwórz”, a jej
       kliknięcie jest gestem, którego blokada nie dotyczy. */
    if (czyOtworz(typ)) {
      /* Sama otwiera się tylko strona, o którą człowiek poprosił W TEJ
         wiadomości (jej nazwa albo adres w pytaniu), gdy w turze nie było
         wyszukiwania ani czytania cudzych stron, i nigdy adres sieci domowej.
         Każdy inny przypadek – karta z „Otwórz”, jak pozostałe akcje. */
      const otwarte = mozeSamOtworzyc(conv, karta.actionText) && otworzStrone(karta.actionText);
      if (otwarte) karta.done = true;
      saveConversations();
      if (!voiceMode) return widoczne;
      return otwarte ? widoczne : `${widoczne || ''} ${t('open.clickOnScreen')}`.trim();
    }
    saveConversations();
    /* Akcja czeka na kliknięcie „Wykonaj”. W trybie głosowym słychać było samo
       „Zapiszę to.”, a bez kliknięcia nic się nie zapisywało (agencja, runda 5). */
    return voiceMode ? `${widoczne || ''} ${t('voice.confirmOnScreen')}`.trim() : widoczne;
  }
  const wiadomosc = wstawTekstModelu(conv, finalText, conv.__turaOd || 0);
  if (wiadomosc) {
    /* Komunikat Cosmosa („⚠︎ Model zużył cały budżet…”, „pusta odpowiedź”)
       nie jest wypowiedzią modelu. Dawniej wracał w historii jako jego
       własna odpowiedź, także do innego silnika (agencja, runda 5). */
    const komunikatCosmosa = !tresc;
    Object.assign(wiadomosc, { think: lastThink, note: lastModelNote, samoMyslenie, ...znakSilnika(),
      ...(komunikatCosmosa ? { komunikatCosmosa: true } : {}) });
  }
  saveConversations();
  return finalText;
}

async function runGeneration(conv, podpiecie = null) {
  pokazChmureWGlosie(false);
  isGenerating = true;
  turaPrzerwana = false;
  // Sygnał całej tury – „Zatrzymaj” przerywa też to, co dzieje się po strumieniu (zdjęcia).
  abortTury = new AbortController();
  dopiskiTury = 0;
  setGeneratingUI(true);
  if (voiceMode) setVoiceState('thinking');
  let finalText = '';

  const MAX_SEARCHES = 3;
  /* Pamięć jednej tury. Model potrafi wywołać trzy razy DOKŁADNIE ten sam
     filtr i trzy razy dostać to samo zero – widać to było w rozmowie
     o Mazurach, gdzie „Przeszukuję Twoje archiwum…" pojawiło się kilka razy
     pod rząd bez zmiany parametrów. Limit głębokości tego nie łapie, bo
     formalnie to różne kroki. To samo dotyczy zdjęć. */
  const stan = { archiwum: new Set(), grafiki: new Set(), plan: new Set(), archiwumZWynikiem: false, grafikiOdlozone: new Set() };
  // Od której wiadomości zaczyna się ta tura – dalej nie szuka zapora powtórek.
  conv.__turaOd = conv.messages.length;
  znakTury = {
    silnik: endpoint, model: currentModel() || '',
    nadpisanie: nadpisanieModelu(),
  };
  /* Zespół agentów w tej turze: prośba (przycisk, „Uruchom”, „Zmień skład”)
     jest jednorazowa; stan tury zbiera zdarzenia biegu. */
  const prosbaZespolu = zespolNaTure;
  zespolNaTure = null;
  propozycjaZespolu = null;
  const zt = { st: ZESPOL.nowyStanTury(), ui: null, zapisane: false, tik: null, conv, zgodaGlos: null };
  licznikKosztuTury = { zl: 0, szac: false, zt };
  // Odpowiedź solo zastąpiona tą turą była zapłacona – jej koszt idzie do „cała odpowiedź”.
  if (zastapioneNaTure && zastapioneNaTure.conv === conv && zastapioneNaTure.kosztZl > 0) ZESPOL.kosztZastapionej(zt.st, zastapioneNaTure.kosztZl);
  // Wyszukiwanie badacza już jest w notatkach – ten sam [SZUKAJ:] od prowadzącego dostaje „już wyszukałeś”.
  const notatkiTury = conv.messages.slice(granicaTury(conv)).find((m) => m.narzedzie === 'zespol');
  if (notatkiTury && notatkiTury.zespol && notatkiTury.zespol.szukaj) stan.szukaj = new Set([odciskZapytania(notatkiTury.zespol.szukaj)]);
  // Regeneruj na tych samych notatkach: plan fotografa dalej obowiązuje.
  if (notatkiTury && notatkiTury.zespol && notatkiTury.zespol.planPoliczony === true) stan.planZespolu = true;

  try {
    let zespolWyslij;
    if (!podpiecie && !notatkiTury) {
      let prosba = prosbaZespolu;
      if (prosba && prosba.przygotuj) prosba = await bramkaZespolu(conv);
      if (prosba === 'stop') turaPrzerwana = true;
      zespolWyslij = prosba === null && prosbaZespolu ? undefined : zespolDoWyslania(conv, prosba === 'stop' ? null : prosba);
    }
    if (zespolWyslij && (zespolWyslij.uruchom || zespolWyslij.sklad)) zt.st.faza = 'planowanie';
    for (let depth = 0; depth <= MAX_SEARCHES; depth++) {
      // „Zatrzymaj” w trakcie narzędzia: kolejnej płatnej rundy u modelu nie ma.
      if (turaPrzerwana) break;
      /* Podpięcie dotyczy WYŁĄCZNIE pierwszego przebiegu: wracamy do
         odpowiedzi, która już powstaje. Kolejne rundy pętli narzędzi to nowe
         zapytania do modelu i mają dostać własne biegi. Zespół też tylko tu. */
      let acc = await streamOnce(conv, depth === 0
        ? { ...(podpiecie || {}), zespol: podpiecie ? undefined : zespolWyslij, zespolTury: zt, nowaTura: true } : {});
      // Notatki zespołu PRZED odpowiedzią prowadzącego – jak wynik narzędzia.
      if (depth === 0) zapiszNotatkiTury(conv, zt, stan);
      const ostatnia = depth === MAX_SEARCHES;

      /* Które narzędzie zawołał model. Kolejność sprawdzania jest kolejnością
         na liście w `narzedzia.js` i tam też jest wyjaśniona. */
      let uzyte = null;
      let dop = null;
      for (const narzedzie of NARZEDZIA) {
        const m = narzedzie.dopasuj(acc);
        if (m) { uzyte = narzedzie; dop = m; break; }
      }
      /* Długi plan ze zdjęciami potrafi skończyć budżet tokenów w połowie –
         w rozmowie o Sycylii ucięło „Źródła” na „travelplanet.pl/przew”, a zdjęcia
         poszły dalej, jakby odpowiedź była cała. Zdjęcia rozcinają tekst na
         kawałki, więc dokończyć trzeba PRZED nimi, nie po. To samo bez
         narzędzia: urwany w pół znacznik („[GRAFIKA: Etn”) nie pasuje do
         niczego, a po dokończeniu staje się zwykłym wołaniem narzędzia –
         dlatego po dokończeniu sprawdzamy narzędzia od nowa. */
      if ((!uzyte || uzyte.nazwa === 'grafiki') && lastFinish === 'length' && !turaPrzerwana) {
        acc = await dokoncz(conv, acc);
        uzyte = null; dop = null;
        for (const narzedzie of NARZEDZIA) {
          const m = narzedzie.dopasuj(acc);
          if (m) { uzyte = narzedzie; dop = m; break; }
        }
      }

      if (!uzyte) {
        /* Model napisał gotową odpowiedź bez odłożonych zdjęć – dokładamy je
           sami pod nią, zamiast je zgubić. */
        let zapomniane = [...stan.grafikiOdlozone].filter((q) => !stan.grafiki.has(bezOgonkowKlient(q)));
        /* Człowiek prosił o zdjęcia, a model napisał plan bez ani jednego
           znacznika – Marcin dostawał zero zdjęć (agencja-rozmowa, runda 12,
           eksport 3). Miejsca bierzemy z nagłówków dni planu. */
        if (!zapomniane.length && !ostatnia && !stan.grafiki.size && prosiOZdjecia(conv)) {
          zapomniane = miejscaZNaglowkowDni(stripSearchMarker(acc));
        }
        if (zapomniane.length && !ostatnia) {
          /* Znaczniki stawiamy sami – pod akapitami, które mówią o danym
             miejscu – i puszczamy przez narzędzie zdjęć. Ono odtwarza układ:
             kawałek odpowiedzi, siatka pod nim, kolejny kawałek. */
          narzedzieTeraz = 'grafiki';
          const zZnacznikami = wstawZnacznikiZdjec(stripSearchMarker(acc), zapomniane.slice(0, 10));
          const g = NARZEDZIA.find((n) => n.nazwa === 'grafiki');
          const przed = conv.messages.length;
          await g.wykonaj({ acc: zZnacznikami, dop: g.dopasuj(zZnacznikami), conv, depth, ostatnia, przed: '', stan });
          stan.grafikiOdlozone.clear();
          // Zdjęć nie znaleziono – narzędzie nie wstawiło tekstu. Odpowiedź musi się pokazać i tak.
          const tekstJest = conv.messages.slice(przed).some((m) => m.role === 'assistant' && typeof m.content === 'string' && !m.status);
          finalText = tekstJest ? stripSearchMarker(acc) : await domknijOdpowiedz(conv, acc);
          break;
        }
        finalText = await domknijOdpowiedz(conv, acc);
        break;
      }

      /* Limit rund wyczerpany, a model wciąż sięga po narzędzie. Zamiast
         pokazać użytkownikowi surowy znacznik – a tak działo się kiedyś –
         mówimy modelowi, że ma dokończyć tekstem, i domykamy turę tą samą
         drogą co zawsze. */
      if (ostatnia && !uzyte.zawszeDozwolone) {
        /* Każde narzędzie dostaje komunikat o limicie – także archiwum, plan
           i kod. Bez niego tura kończyła się samą zapowiedzią („Teraz jeszcze
           Twoje archiwum.") i ciszą. */
        const limit = uzyte.gdyLimit ? uzyte.gdyLimit(dop) : {
          tresc: 'LIMIT NARZĘDZI W TEJ TURZE WYCZERPANY – nie używaj już żadnych znaczników. '
            + 'Dokończ teraz odpowiedź tekstem na podstawie tego, co już masz, a jeśli '
            + 'czegoś nie zdążyłeś sprawdzić, powiedz to jednym zdaniem.',
          etykieta: uzyte.nazwa,
          sterowanie: true,
        };
        narzedzieTeraz = uzyte.nazwa;
        // Tekst sprzed znacznika zostaje na ekranie – przebudowa nie może go zabrać (R1).
        const przedLimitem = stripSearchMarker(acc.replace(dop[0], ''));
        if (przedLimitem.trim()) {
          const w = wstawTekstModelu(conv, przedLimitem, conv.__turaOd || 0);
          if (w) Object.assign(w, { think: lastThink, note: lastModelNote, ...znakSilnika() });
        }
        dodajWynikNarzedzia(conv, limit.tresc, limit.etykieta, { sterowanie: limit.sterowanie === true });
        const ostatniaTresc = await streamOnce(conv);
        finalText = await domknijOdpowiedz(conv, ostatniaTresc);
        break;
      }

      /* DWA NARZĘDZIA W JEDNEJ ODPOWIEDZI – a wolno było tylko jedno.
         Marcin poprosił o plan Majorki „ze zdjęciami i grafikami". Model
         napisał plan, a pod nim [PLAN: …] ORAZ sześć [GRAFIKA: …]. Kaskada
         brała pierwsze pasujące narzędzie z listy – czyli plan – a wszystkie
         pozostałe znaczniki czyściła z tekstu i wyrzucała. Prośba o zdjęcia
         znikała bez śladu. Model, dostawszy dane planu, pisał całość od nowa
         (znowu ze znacznikami), plan znowu wygrywał, zdjęcia znowu przepadały
         – i tak aż do wyczerpania rund. Efekt: trzy kopie planu na ekranie
         i ani jednego zdjęcia.

         Zdjęcia dokładamy więc po narzędziu, które wygrało. Wtedy to ONE
         odtwarzają układ tekstu (kawałek planu, siatka pod nim), więc
         zwycięzcy odbieramy emisję tekstu – inaczej plan stałby na ekranie
         dwa razy. */
      const grafikiTez = uzyte.nazwa !== 'grafiki'
        ? NARZEDZIA.find((n) => n.nazwa === 'grafiki')
        : null;
      const dopGrafiki = grafikiTez && grafikiTez.dopasuj(acc);
      /* Tekst sprzed znacznika idzie na ekran ZAWSZE – także jako szkic przy
         odłożonych zdjęciach. Schowany dawał reset: 1017 znaków → pusty pasek
         i odpowiedź od zera (R1, runda 11). Gotowa wersja go zastąpi – patrz
         `szkiceTury` przy wstawTekstModelu. */
      const przedTekst = stripSearchMarker(acc.replace(dop[0], ''));

      narzedzieTeraz = uzyte.nazwa;
      const wynik = await uzyte.wykonaj({
        acc,
        dop,
        conv,
        depth,
        ostatnia,
        // Tekst modelu sprzed znacznika – WSZYSTKIE znaczniki wyczyszczone.
        przed: przedTekst,
        stan,
      });
      if (turaPrzerwana) break;

      if (wynik && wynik.akcja === 'koniec') {
        finalText = wynik.finalGlos || wynik.finalText || '';
        break;
      }

      /* Zdjęcia ODKŁADAMY do gotowej odpowiedzi. Rozłożone pod szkicem
         sprzed danych dawały dwa sprzeczne plany na ekranie: szkic z „6:40"
         pocięty zdjęciami i właściwy plan z „6:52" pod spodem. Model dostaje
         prośbę, żeby postawił znaczniki zdjęć pod punktami gotowej wersji –
         a gdy zapomni, dokładamy je sami na końcu tury. */
      if (dopGrafiki) {
        const WZ = new RegExp(PHOTO_MARKER_RE.source, 'gi');
        for (const g of acc.matchAll(WZ)) {
          for (const q of g[1].split(';').map((x) => x.trim()).filter(Boolean)) stan.grafikiOdlozone.add(q);
        }
        /* To, co stoi teraz w turze, jest szkicem: model napisze gotową wersję
           i ona go zastąpi (a szkic zwinie się do „Poprzedniej wersji”). */
        for (const m of conv.messages.slice(conv.__turaOd || 0)) {
          if (m.role === 'assistant' && typeof m.content === 'string' && !m.status && !m.error && m.content.trim()) szkiceTury.add(m);
        }
        narzedzieTeraz = 'grafiki';
        dodajWynikNarzedzia(conv,
          'ZDJĘCIA JESZCZE NIE POKAZANE. Napisz teraz gotową odpowiedź na podstawie danych powyżej '
          + 'i postaw [GRAFIKA: …] pod właściwymi punktami – tak jak w szkicu, ale w ostatecznej wersji. '
          + 'Nie powtarzaj szkicu.',
          t('chat.photosQuery'), { sterowanie: true });
      }
    }
  } catch (err) {
    if (err.name === 'AbortError' && odlaczanie) {
      /* Widz odszedł do innej rozmowy – odpowiedź pisze się dalej na serwerze
         i tam zostanie zapisana. Tu nic nie dopisujemy: fragment z notką
         „Zatrzymano” byłby nieprawdą. */
    } else if (err.name === 'AbortError' && zt.zgodaGlos) {
      /* Bieg stanął, żeby zapytać głosem o zgodę na chmurę – nic się jeszcze
         nie policzyło, więc nic nie zapisujemy (ani notatek, ani „Zatrzymano”). */
    } else if (err.name === 'AbortError') {
      zapiszNotatkiTury(conv, zt, stan);
      /* Przerwana odpowiedź też przechodzi przez czyszczenie znaczników.
         To jedyna droga, którą tekst z modelu trafiał na ekran surowy –
         a przerywa się najczęściej wtedy, gdy coś trwa za długo, czyli
         dokładnie w trakcie sięgania po narzędzie. */
      const czesc = stripSearchMarker(err.partial);
      if (czesc) {
        // Widać, że to przerwane, a nie cała odpowiedź (agencja, runda 5).
        conv.messages.push({ role: 'assistant', content: czesc, note: t('chat.stopped'), ...znakSilnika() });
        saveConversations(false, conv);
      }
    } else {
      /* Błąd w połowie odpowiedzi (dostawca przeciążony, zerwane połączenie):
         napisany fragment zostaje, a pod nim – co się stało. Dawniej znikał
         razem z błędem, choć bywał długi i kompletny w trzech czwartych. */
      zapiszNotatkiTury(conv, zt, stan);
      const czesc = stripSearchMarker(err.partial || '');
      const bieg = err.bieg ? { bieg: err.bieg } : {};
      if (czesc) conv.messages.push({ role: 'assistant', content: czesc, ...znakSilnika(), ...bieg });
      /* Komputer domowy nie odpowiada: pod błędem przycisk „Wyślij przez Chmurę”.
         Bez samoczynnego przełączania – chmura to inny koszt i inna prywatność,
         więc decyduje człowiek jednym kliknięciem (Marcin, runda 8). */
      // Zimny start też: model ładuje się minutami, a chmura odpowie od razu (zespół IT, runda 9).
      // Budżet na płatne modele wyczerpany (429): chmura NVIDIA nie liczy się do budżetu – to samo jednym kliknięciem.
      const budzet = /^budzet/.test(err.kod || '');
      // Lokalny nie odpowiedział na czat – kropka gaśnie od razu, nie po 30 s.
      if (['lokalny-niedostepny', 'zimny-start'].includes(err.kod)) oznaczNiedostepny(znakSilnika().silnik);
      const zapasChmura = (['lokalny-niedostepny', 'zimny-start'].includes(err.kod) || (budzet && endpoint !== 'cloud')) && epConfig('cloud').hasApiKey;
      const tekstBledu = bladSilnikaPoLudzku(err, zapasChmura);
      conv.messages.push({ role: 'assistant', content: `⚠︎ ${tekstBledu}`, error: true,
        // Budżet: zdanie klienta mówi wszystko, a zdanie serwera jest po polsku (w EN było polskim `title`).
        ...(tekstBledu !== err.message && !budzet ? { szczegol: err.message } : {}),
        ...(err.trwaly || budzet ? { trwaly: true } : {}), ...(budzet ? { budzet: err.limit === 'wlasciciel' ? 'wlasciciel' : 'wlasny' } : {}),
        ...(zapasChmura ? { zapas: 'cloud' } : {}), ...bieg,
        // Odpowiedź pisze się dalej na serwerze – karta dostaje „Pobierz odpowiedź”, nie płatne „Ponów”.
        ...(err.porzucony && err.bieg ? { porzucony: true } : {}) });
      saveConversations(false, conv);
      /* W trybie głosowym człowiek nie patrzy na ekran, więc zdanie ma
         powiedzieć, CO się stało. Dawniej brak środków, limit i uśpiony dom
         brzmiały identycznie: „błąd połączenia z modelem” (agencja, runda 5).
         Najpierw KOD od serwera – regexp po treści mówił „komputer chyba śpi”,
         gdy padła sama Ollama (zespół IT, runda 5). */
      if (voiceMode) {
        finalText = t(glosBledu({ ...err, message: err.message, zapasChmura }));
        pokazChmureWGlosie(zapasChmura);
      }
    }
  } finally {
    domknijKosztIZastapione(conv, zt);
    const odlaczony = odlaczanie;
    odlaczanie = false;
    isGenerating = false;
    abortController = null;
    abortTury = null;
    znakTury = null;
    clearInterval(zt.tik);
    glosZespolu(null);
    // „Proponuj, gdy warto”: linijka pod gotową odpowiedzią solo (nie zapisywana w rozmowie).
    if (zt.st.propozycja && !zt.st.role.length && !turaPrzerwana && !wyciszonyZespol(conv)) {
      propozycjaZespolu = { convId: conv.id, ...zt.st.propozycja };
    }
    setGeneratingUI(false);
    // Widz przeszedł do innej rozmowy: tamta ma swój zapis i swój ekran.
    if (odlaczony) {
      // To, co ta karta zdążyła dopisać (np. wynik narzędzia), zapisujemy w TAMTEJ rozmowie.
      if (conv !== activeConversation) saveConversations(true, conv);
      if (activeId && biegiWTle.has(activeId)) podepnijBiegWTle(activeId);
      return;
    }
    /* Zapis bez zwłoki. Przeglądarka właśnie potwierdziła serwerowi, że ma
       odpowiedź, więc awaryjna kopia po jego stronie już nie powstanie –
       te 400 ms zwłoki byłyby jedynym momentem, w którym gotowa odpowiedź
       nie istnieje nigdzie poza pamięcią karty. */
    saveConversations(true);
    /* Koniec odpowiedzi nie ściąga na dół kogoś, kto przewinął do początku,
       żeby czytać – tak było: 5600 px lotu w dół w chwili zakończenia. */
    renderMessages({ przewin: sledzeDol });
    oglosKoniecTury(conv);
    if (zt.zgodaGlos) {
      /* Pytanie o zgodę głosem, potem ta sama tura od nowa (z chmurą, lokalnie
         albo bez agentów). Kto w tej chwili wyszedł z głosu – dostaje zwykłą bramkę. */
      if (voiceMode) await pytajOZgodeWBiegu(conv, zt.zgodaGlos);
      else if (activeConv() === conv) zespolOdPytania(conv, { uruchom: true, przygotuj: true });
    } else if (voiceMode) {
      /* Tura ze zdjęciami: plan stoi w kawałkach między siatkami, a „finalText”
         to tylko domknięcie z ostatniej rundy – często puste. Głos milczał
         wtedy albo mówił samo „Miłej podróży!” (agencja, runda 7). Czytamy
         cały tekst tury i mówimy, że zdjęcia są na ekranie. */
      const tura = conv.messages.slice(conv.__turaOd || 0);
      if (tura.some((m) => msgPhotos(m).length || (Array.isArray(m.zdjecia) && m.zdjecia.some((g) => g.stan === 'gotowe')))) {
        finalText = [tekstTury(conv, conv.__turaOd || 0) || finalText, t('voice.photosOnScreen')].filter(Boolean).join('\n\n');
      }
      if (finalText) {
        el.voiceAnswer.textContent = stripForSpeech(finalText);
        setVoiceState('speaking');
        // Zapamiętujemy, CO powiedzieliśmy – askVoice odrzuci to, gdyby
        // wróciło jako „pytanie" z mikrofonu.
        voiceOstatniaOdpowiedz = stripForSpeech(finalText);
        await speakText(finalText);
        voiceKoniecMowienia = Date.now();
      }
      if (voiceMode) startQueryListening(); // rozmowa trwa – pytanie uzupełniające bez wake word
    } else {
      if (settings.speak && finalText) speakText(finalText);
      /* Fokus do pola tylko wtedy, gdy nie stał gdzie indziej. Kto czytał
         rozmowę klawiaturą (np. „Kopiuj” poprzedniej odpowiedzi), zostaje tam –
         dawniej koniec tury przerzucał go na dół (agencja-frontend, runda 11). */
      const a = document.activeElement;
      if (!a || a === document.body || a === el.input) el.input.focus();
      /* Kolejka rusza dopiero TU, po `isGenerating = false` i po odmalowaniu
         ekranu. W trybie głosowym jej nie ruszamy – tam rozmowa idzie
         mikrofonem i dorzucanie pisanych wiadomości mieszałoby dwa kanały. */
      ruszKolejke();
    }
  }
}

/** Koniec tury: koszt wszystkich wywołań do odpowiedzi i do notatek zespołu;
 *  odpowiedź solo, która nie znalazła nowej wypowiedzi (błąd, Stop), wraca. */
function domknijKosztIZastapione(conv, zt) {
  const tura = conv.messages.slice(conv.__turaOd || 0);
  const odp = [...tura].reverse().find((m) => m.role === 'assistant' && !m.status && !m.error && typeof m.content === 'string');
  if (licznikKosztuTury && licznikKosztuTury.zl > 0 && odp) {
    // Koszt tej odpowiedzi – gdy zespół ją kiedyś zastąpi, wejdzie do „cała odpowiedź”.
    odp.kosztZl = Math.round(((typeof odp.kosztZl === 'number' ? odp.kosztZl : 0) + licznikKosztuTury.zl) * 10000) / 10000;
  }
  const notatki = tura.find((m) => m.narzedzie === 'zespol' && m.zespol);
  if (notatki && zt) {
    const st = zt.st;
    if (typeof st.kosztProwadzacegoZl === 'number') notatki.zespol.kosztProwadzacegoZl = st.kosztProwadzacegoZl;
    if (st.kosztProwadzacegoSzac) notatki.zespol.kosztProwadzacegoSzac = true;
    if (typeof st.kosztZastapionejZl === 'number' && st.kosztZastapionejZl > 0) notatki.zespol.kosztZastapionejZl = st.kosztZastapionejZl;
  }
  licznikKosztuTury = null;
  const z = zastapioneNaTure;
  if (z && z.conv === conv) {
    zastapioneNaTure = null;
    if (odp) z.poprzednie.forEach((p) => dodajPoprzednia(odp, p));
    else {
      // Zespół nie napisał odpowiedzi – odpowiedź solo wraca na swoje miejsce (zaraz po pytaniu).
      const i = conv.messages.indexOf(tura[0]);
      conv.messages.splice(i < 0 ? conv.messages.length : i, 0, ...z.usuniete);
    }
  }
}

/* „Zatrzymaj” w trakcie narzędzia (wyszukiwanie, zdjęcia, plan) nic nie robiło:
   stop przerywał tylko strumień, a pętla narzędzi po wyniku od razu pytała
   model drugi raz, płatnie, o odpowiedź, której nikt już nie chciał
   (agencja, runda 5). Flaga tury zamyka pętlę po bieżącym kroku. */
let turaPrzerwana = false;
let abortTury = null;          // AbortController całej tury (runGeneration)
let voiceKoniecMowienia = 0;   // kiedy Cosmos skończył czytać odpowiedź (zapora echa)

/** „Wyślij przez Chmurę” w trakcie czekania na lokalny: zatrzymaj, przełącz
 *  zakładkę i wyślij TO SAMO pytanie do chmury (bez dubla w rozmowie). */
async function przezChmureWTrakcie(conv) {
  stopGeneration();
  for (let i = 0; i < 100 && isGenerating; i++) await new Promise((r) => setTimeout(r, 50));
  if (isGenerating || activeConv() !== conv) return;
  let ostatnie = -1;
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].role === 'user' && !conv.messages[i].search) { ostatnie = i; break; }
  }
  if (ostatnie < 0) return;
  setEndpoint('cloud');
  regenerateFrom(ostatnie + 1);
}

function stopGeneration() {
  turaPrzerwana = true;
  /* Odkąd zamknięcie karty NIE przerywa generowania, samo `abort()` w
     przeglądarce już nie wystarcza: rozłączyłoby tylko widza, a serwer
     spokojnie dokończyłby odpowiedź i zapisał ją do rozmowy. Stop musi
     dotrzeć tam, gdzie naprawdę trzymane jest połączenie z modelem. */
  const id = biegBiezacy?.id;
  if (id) {
    fetch('/api/chat/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bieg: id }),
    }).catch(() => { /* i tak zaraz przerwiemy po swojej stronie */ });
  }
  zapamietajBieg(null);
  if (abortController) abortController.abort();
  // Zdjęcia, które jeszcze nie przyszły, już nie przyjdą – tura kończy się od razu.
  if (abortTury) abortTury.abort();
}

/* CZYTNIK EKRANU W TURZE (P3, runda 11). #messages to region na żywo, a każda
   klatka strumienia i każda przebudowa „dodawały” węzły – czytnik dostawał
   ~180 razy więcej znaków, niż miała odpowiedź. Przez całą turę region jest
   `aria-busy`, a na końcu pada JEDNO zdanie w osobnym regionie statusu. */
function regionStatusu() {
  let r = document.getElementById('sr-odpowiedz');
  if (!r) {
    r = document.createElement('div');
    r.id = 'sr-odpowiedz';
    r.setAttribute('role', 'status');
    r.setAttribute('aria-live', 'polite');
    r.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;';
    document.body.appendChild(r);
  }
  return r;
}
function oglosKoniecTury(conv) {
  if (!conv || conv !== activeConv()) return;
  const ost = conv.messages[conv.messages.length - 1];
  const tekst = t(ost && ost.error ? 'chat.srBlad' : turaPrzerwana ? 'chat.srZatrzymana' : 'chat.srGotowa');
  const r = regionStatusu();
  r.textContent = '';
  setTimeout(() => { r.textContent = tekst; }, 50);
}

function setGeneratingUI(generating) {
  if (generating) el.messages.setAttribute('aria-busy', 'true');
  else el.messages.removeAttribute('aria-busy');
  el.sendBtn.style.display = generating ? 'none' : '';
  el.stopBtn.style.display = generating ? '' : 'none';
  updateSendButton();
}

/** Pokaż „dopracuj prompt", gdy jest co dopracowywać.
 *
 * Przy krótkich wiadomościach („dzięki", „tak") przepisywanie nie ma sensu,
 * a przycisk tylko zaśmieca pole – stąd próg długości.
 */
function updatePolishButton() {
  const btn = $('polish-btn');
  if (!btn) return;
  // Po dopracowaniu przycisk to „przywróć moją wersję" – nie może zniknąć
  // tylko dlatego, że model oddał krótszy tekst.
  btn.hidden = isGenerating || (!polishPrevious && el.input.value.trim().length < 25);
}

/** Przepisz treść pola na precyzyjny prompt, z możliwością cofnięcia. */
let polishPrevious = '';
async function polishPrompt() {
  const btn = $('polish-btn');
  const raw = el.input.value.trim();
  if (!raw || btn.disabled) return;

  // Drugie kliknięcie po dopracowaniu przywraca oryginał – nikt nie chce
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
  /* `isGenerating` NIE blokuje już wysyłania – wiadomość idzie do kolejki.
     Sam przycisk i tak jest w tym czasie schowany na rzecz „zatrzymaj"
     (patrz `setGeneratingUI`), ale Enter w polu działa dalej i to jest sedno:
     myśl, która przyszła w trakcie odpowiedzi, ma się dać zapisać od razu. */
  el.sendBtn.disabled = empty || !serverReachable;
  updatePolishButton();
}

// ----------------------------------------------------------------
// Pole wprowadzania
// ----------------------------------------------------------------

function autosizeInput() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 220) + 'px';
}

let zapisSzkicu = null;
el.input.addEventListener('input', () => {
  autosizeInput();
  updateSendButton();
  updateTokenEstimate();
  clearTimeout(zapisSzkicu);
  zapisSzkicu = setTimeout(() => {
    try {
      if (el.input.value.trim()) localStorage.setItem(KLUCZ_SZKICU, el.input.value);
      else localStorage.removeItem(KLUCZ_SZKICU);
    } catch { /* bez pamięci */ }
  }, 300);
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
    /* Wpisane zdanie wygrywa z podpowiedzią: dotknięcie (podpowiedzi są wtedy
       ukryte przez CSS, ale palec trafia w ich miejsce) nadpisywało tekst
       i od razu go wysyłało (agencja-ux, runda 11). */
    if (el.input.value.trim()) { el.input.focus(); return; }
    el.input.value = t(btn.dataset.promptKey);
    autosizeInput();
    updateSendButton();
    sendMessage();
  });
});

/* K7: klawiatura ekranowa na iOS. Safari ignoruje `interactive-widget`, więc
   okno się nie zmniejsza – o klawiaturze mówi dopiero visualViewport. Klasa
   `klawiatura` na <html> włącza te same reguły układu co niskie okno
   (style.css, powitanie przy klawiaturze). */
function ustawKlaseKlawiatury() {
  const vv = window.visualViewport;
  const jest = Boolean(vv) && vv.height < window.innerHeight - 120;
  document.documentElement.classList.toggle('klawiatura', jest);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', ustawKlaseKlawiatury);
  ustawKlaseKlawiatury();
}

// ----------------------------------------------------------------
// Zmysły: mowa (TTS) – Piper przez senses, fallback: głos systemowy
// ----------------------------------------------------------------

/** Tekst do czytania na głos – to, co brzmi jak mowa, a nie jak Markdown.
 *  Lektor czytał dotąd adresy stron znak po znaku, nazwy emoji, rozsypane
 *  tabele („Przysłona Czas ISO – – –") i urywał w pół zdania na 1200 znaku. */
function stripForSpeech(text) {
  let t = String(text || '');
  if (typeof rozdzielMyslenie === 'function') t = rozdzielMyslenie(t).tresc;   // <think> się nie czyta
  if (typeof stripSearchMarker === 'function') t = stripSearchMarker(t);   // wszystkie znaczniki narzędzi
  t = bezZrodel(t)   // źródeł się nie mówi – public/protokol.js
    .replace(/【[^】]*】/g, '')                                  // przypisy w stylu 【1†L1-L4】
    .replace(/\[\d+(?:[,–-]\s*\d+)*\](?!\()/g, '')              // przypisy [1], [2–3]
    .replace(/```[\s\S]*?```/g, ' (fragment kodu) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s)\]]+/g, '')                     // adresów się nie czyta
    .replace(/\(\s*[,;:]?\s*\)/g, '')                             // „( )" po wyciętym adresie
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}.*$/gm, '')               // linia oddzielająca w tabeli
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, w) => w.split('|').map((k) => k.trim()).filter(Boolean).join(', ') + '.')
    .replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/gm, '')           // punktory list
    .replace(/\p{Extended_Pictographic}\uFE0F?/gu, '')
    // „~1 h” to „około godziny” dla lektora (jednostkiNaGlos), nie znak do wycięcia.
    .replace(/~\s*(?=[−–-]?\d)/g, getLang() === 'en' ? 'about ' : 'około ')
    .replace(/[*_#>|~]/g, '');
  /* Nagłówek, punkt listy i wiersz tabeli to osobne myśli – bez kropki lektor
     czytał „Plan Świt o 6:41" jednym tchem. Każda linia bez znaku końca
     dostaje kropkę, dopiero potem sklejamy białe znaki. */
  t = t.split(/\n+/).map((l) => l.trim()).filter(Boolean)
    .map((l) => (/[.!?:;,…]$/.test(l) ? l : `${l}.`))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')          // „100 ." po wyciętym przypisie
    .trim();
  // „20 °C” → „20 stopni Celsjusza”; lektor czytał „degrisy” (public/protokol.js).
  t = jednostkiNaGlos(t, getLang());
  // „do 21 stopni” → „do dwudziestu jeden stopni”, „o 17:00” → „o siedemnastej” (public/protokol.js).
  if (getLang() !== 'en') t = liczbyNaGlos(t);
  /* Czytamy porcjami (porcjeGlosu), więc długość nie jest problemem techniczną
     – ale pięciominutowego monologu nikt nie słucha. Ucinamy na końcu zdania
     i MÓWIMY, że reszta jest na ekranie; dawniej cięcie było bez słowa. */
  const LIMIT_CZYTANIA = 2400;
  if (t.length > LIMIT_CZYTANIA) {
    const kawalek = t.slice(0, LIMIT_CZYTANIA);
    const koniec = Math.max(kawalek.lastIndexOf('. '), kawalek.lastIndexOf('! '), kawalek.lastIndexOf('? '));
    t = (koniec > 400 ? kawalek.slice(0, koniec + 1) : kawalek) + ' ' + (getLang() === 'en'
      ? 'The rest is on the screen.' : 'Resztę masz na ekranie.');
  }
  return t;
}

let currentAudio = null;

// Zwraca Promise kończącą się wraz z końcem mówienia –
// tryb głosowy czeka, zanim znów zacznie słuchać (brak sprzężenia).
/** Odczytaj odpowiedź jako JSON, nie wywracając się na tym, co JSON-em nie jest.
 *
 * Gdy usługa zmysłów rzuci wyjątkiem, serwer potrafi oddać zwykły tekst
 * „Internal Server Error”. `res.json()` mówił wtedy „Unexpected token 'I' …
 * is not valid JSON” – komunikat, z którego użytkownik nie dowiaduje się
 * niczego o prawdziwej przyczynie. Tutaj oddajemy treść odpowiedzi.
 */
async function readJsonSafe(res) {
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    /* Strona błędu Cloudflare'a (502 przy restarcie, 524 po 100 s ciszy) albo
       innego pośrednika to HTML – na ekranie lądował jako „HTTP 502 – <!DOCTYPE
       html>…". Człowiekowi mówimy, co się stało. */
    if (/^\s*</.test(body) || [502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527].includes(res.status)) {
      return { error: t(res.status === 524 ? 'err.bramkaCzas' : 'err.bramka', { status: res.status }) };
    }
    const short = body.trim().slice(0, 200) || `HTTP ${res.status}`;
    return { error: `HTTP ${res.status} – ${short}` };
  }
}

/** Czy serwer ma głos: Piper w zmysłach albo głos w chmurze (ElevenLabs, OpenAI). */
function ttsSerwera() {
  return Boolean((senses.online && senses.caps.piper) || serverConfig.glos?.ttsChmura);
}

/** Porcje do czytania głosem z serwera. Pierwsza krótka – żeby Cosmos zaczął
 *  mówić po ułamku sekundy, a nie po wygenerowaniu całej odpowiedzi – kolejne
 *  dłuższe, bo tam czas generowania chowa się pod czytaniem poprzedniej. */
function porcjeGlosu(tekst) {
  const zdania = splitForSpeech(tekst, 220);
  const porcje = [];
  let biezaca = '';
  for (const z of zdania) {
    const limit = porcje.length === 0 ? 160 : 600;
    if (biezaca && (biezaca + ' ' + z).length > limit) { porcje.push(biezaca); biezaca = z; }
    else biezaca = biezaca ? `${biezaca} ${z}` : z;
  }
  if (biezaca) porcje.push(biezaca);
  return porcje;
}

/** Zagraj nagranie i poczekaj na koniec – także gdy ktoś je przerwie.
 *  Bez `onpause` przerwane czytanie zostawiało wiszącą obietnicę, a tryb
 *  głosowy czekał na koniec wypowiedzi, która już nigdy się nie skończy. */
/** Zagraj nagranie; `false`, gdy przeglądarka nie pozwoliła go odtworzyć
 *  (telefon blokuje dźwięk bez świeżego dotknięcia). Dawniej porażka była
 *  cicha – liczyła się jako zagrana porcja i głos systemowy nie wchodził. */
function grajNagranie(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    let zagrane = false;
    const koniec = (wynik) => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve(wynik); };
    audio.onplaying = () => { zagrane = true; };
    audio.onended = () => koniec(true);
    audio.onerror = () => koniec(zagrane);
    audio.onpause = () => koniec(zagrane);
    audio.play().then(() => { zagrane = true; }, () => koniec(false));
  });
}

/* Telefon zablokował odtwarzanie (brak świeżego dotknięcia): kolejne /api/tts
   i tak nie zagrają, a każde pytanie czekało ~0,8 s na pełne nagranie przed
   głosem systemowym, drugą porcję pobierając na darmo – w płatnym TTS za
   pieniądze (zespół IT, runda 9). Do najbliższego dotknięcia albo klawisza
   od razu głos systemowy. */
let glosSerweraZablokowany = false;
for (const zd of ['pointerdown', 'keydown']) {
  document.addEventListener(zd, () => { glosSerweraZablokowany = false; }, { capture: true, passive: true });
}

async function speakText(text) {
  const clean = stripForSpeech(text);
  if (!clean) return;
  stopSpeaking();
  speakSerial = {};                   // znacznik tej wypowiedzi
  const mine = speakSerial;
  let doPrzeczytania = clean;         // co zostaje dla głosu systemowego

  // 1. Głos z serwera: ElevenLabs / OpenAI / Piper (kolejność ustawia serwer).
  if (ttsSerwera() && !glosSerweraZablokowany) {
    const porcje = porcjeGlosu(clean);
    /* Przerwanie ma działać też wtedy, gdy nagranie jeszcze się pobiera –
       dotknięcie kuli w „MÓWIĘ…" nie może czekać na odpowiedź serwera. */
    const przerwij = new AbortController();
    ttsPrzerwij = przerwij;
    const pobierz = (fragment) => fetch('/api/tts', {
      method: 'POST',
      signal: przerwij.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fragment, jezyk: getLang() === 'en' ? 'en' : 'pl' }),
    }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))));
    let nastepna = pobierz(porcje[0]);
    let zagrane = 0;
    for (let i = 0; i < porcje.length; i++) {
      let blob;
      try { blob = await nastepna; } catch { break; }
      if (speakSerial !== mine) return;
      // Następną porcję pobieramy, zanim ta się skończy – bez przerw między zdaniami.
      if (i + 1 < porcje.length) { nastepna = pobierz(porcje[i + 1]); nastepna.catch(() => {}); }
      if (!(await grajNagranie(blob))) {
        if (speakSerial !== mine) return;
        // Zablokowane: pobierana w tle następna porcja idzie do kosza, zanim zapłacimy za nią dalej.
        przerwij.abort();
        glosSerweraZablokowany = true;
        break;                          // niżej głos systemowy
      }
      zagrane++;
      if (speakSerial !== mine) return;
    }
    if (speakSerial !== mine) return;   // przerwane w trakcie pobierania: bez głosu zastępczego
    if (zagrane === porcje.length) return;
    // Urwało się w połowie – głos systemowy DOKAŃCZA, nie czyta od nowa.
    doPrzeczytania = porcje.slice(zagrane).join(' ');
  }

  // 2. Głos systemowy przeglądarki
  if ('speechSynthesis' in window) {
    const langPrefix = t('speechLang').slice(0, 2);
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith(langPrefix));
    for (const part of splitForSpeech(doPrzeczytania)) {
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

// Znacznik trwającej wypowiedzi – po przerwaniu kolejne kawałki mają nie ruszyć.
let speakSerial = null;

/** Potnij tekst na kawałki mieszczące się w jednej wypowiedzi.
 *
 * Chrome przerywa `speechSynthesis` po kilkunastu sekundach i reszta zdania
 * przepada – dlatego czytanie na głos urywało się w połowie. Tniemy po
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

let ttsPrzerwij = null;
function stopSpeaking() {
  speakSerial = null;                 // zatrzymaj kolejne kawałki wypowiedzi
  if (ttsPrzerwij) { ttsPrzerwij.abort(); ttsPrzerwij = null; }
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Głośnik w pasku: stan widać (przekreślenie, aria-pressed) i słychać w podpowiedzi. */
function pokazGlosnik() {
  const wl = Boolean(settings.speak);
  el.ttsToggle.classList.toggle('active', wl);
  el.ttsToggle.setAttribute('aria-pressed', String(wl));
  const opis = `${t('ttsRead')} – ${t(wl ? 'ttsStanWl' : 'ttsStanWyl')}`;
  el.ttsToggle.title = opis;
  el.ttsToggle.setAttribute('aria-label', t('ttsRead'));
  const wUstawieniach = $('set-speak');
  if (wUstawieniach) wUstawieniach.checked = wl;
}

el.ttsToggle.addEventListener('click', () => {
  settings.speak = !settings.speak;
  saveSettings();
  pokazGlosnik();
  if (!settings.speak) stopSpeaking();
});

// ----------------------------------------------------------------
// Zmysły: słuch (STT) – Whisper przez senses, fallback: przeglądarka
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Kamera i mikrofon: wymóg bezpiecznego kontekstu
// ----------------------------------------------------------------
//
// Przeglądarki udostępniają navigator.mediaDevices TYLKO w „bezpiecznym
// kontekście": po HTTPS albo na localhost. Przy wejściu po zwykłym HTTP na
// adres IP (typowe dla serwera na VPS w sieci Tailscale) całe API jest
// `undefined` – nie zablokowane, tylko nieobecne. Bez tego sprawdzenia
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
 * to zwykle wbudowany mikrofon laptopa, a przy słuchawkach – dopiero co
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
    // Zapamiętany mikrofon mógł zostać odłączony – spróbuj domyślnego.
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
      const res = await fetch(adresStt(), {
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
  // Chrome kończy sesję rozpoznawania sam – po pauzie w mówieniu i najpóźniej
  // po ~60 s – mimo `continuous = true`. Wcześniej gasiliśmy wtedy nagrywanie
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

    // „no-speech" i „aborted" to normalny koniec cyklu – onend wznowi nasłuch.
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
  if (sttSerwera() && window.MediaRecorder) {
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
// Zmysły: wzrok – zdjęcie z kamery (webcam / Kinect RGB)
// ----------------------------------------------------------------

/** Która kamera telefonu: „user" = przednia, „environment" = tylna.
 *  Zapamiętana, bo do fotografowania sprzętu prawie zawsze chce się tylna. */
let cameraFacing = localStorage.getItem('cosmos.cameraFacing') || 'environment';

function videoConstraints(facing) {
  // `ideal`, nie `exact` – na laptopie z jedną kamerą `exact` po prostu rzuca
  // błędem, a przy pierwszym otwarciu chcemy dostać tę jedyną, jaka jest.
  return { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: { ideal: facing } } };
}

/** Weź strumień z konkretnego obiektywu – do PRZEŁĄCZANIA, nie do otwierania.
 *
 * Przy `ideal` przeglądarka ma prawo prośbę zignorować i oddać kamerę, która
 * już działa – i właśnie dlatego przełącznik przód/tył nic nie robił. Do zmiany
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
    // po etykiecie, a gdy jej brak (bez zgody) – po prostu następne urządzenie
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

/** Czy urządzenie ma więcej niż jedną kamerę – tylko wtedy przełącznik ma sens. */
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
 * jeszcze pracuje, kończy się „Could not start video source" – i dokładnie
 * dlatego przełącznik nie działał. Kolejność jest więc odwrotna niż podpowiada
 * ostrożność: zamykamy, otwieramy, a gdy nowy obiektyw zawiedzie – wracamy do
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
// Zdjęcia z paska odpowiedzi: poprzednie / następne (klawiatura i palec – widoki.js).
$('img-viewer-prev')?.addEventListener('click', () => przesunPodglad(-1));
$('img-viewer-next')?.addEventListener('click', () => przesunPodglad(1));
// kliknięcie w tło zamyka; kliknięcie w sam obraz albo pasek – nie
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
  } catch { /* brak sieci – zdjęcie i tak jest w rozmowie */ }
}

// ----------------------------------------------------------------
// STUDIO – obraz (OpenAI) · dźwięk (ElevenLabs) · wideo (Seedance)
// ----------------------------------------------------------------

/** Pusty stan: ikona, zdanie i – gdy jest dokąd iść – przycisk.
 *  Sam szary tekst wyglądał jak błąd ładowania, a nie jak „jeszcze nic tu nie ma". */
function pustyStan(ikona, tekst, przycisk = '') {
  return `<div class="pusty-stan"><span class="ik ${ikona}" aria-hidden="true"></span>`
    + `<p>${escapeHtml(tekst)}</p>`
    + (przycisk ? `<button type="button" class="btn-secondary">${escapeHtml(przycisk)}</button>` : '')
    + '</div>';
}

/* Płatne generowanie: drugie kliknięcie w trakcie było drugim płatnym
   żądaniem u dostawcy (zmierzone: dwa kliknięcia = dwa generowania, także
   wideo – najdroższe). Przycisk jest zajęty, dopóki żądanie trwa. */
function jedenNaRaz(fn) {
  return async function (...argumenty) {
    if (this.disabled || this.getAttribute('aria-busy') === 'true') return undefined;
    this.disabled = true;
    this.setAttribute('aria-busy', 'true');
    try { return await fn.apply(this, argumenty); } finally {
      this.disabled = false;
      this.removeAttribute('aria-busy');
    }
  };
}

/* Widok Studia (obraz, storyboard, edycja, dźwięk, wideo) – public/studio-widok.js. */
const { openStudio, zadanieStudia } = utworzStudioWidok({
  $, el, t, escapeHtml, readJsonSafe, loadJson, jedenNaRaz, czekajNaZadanie,
});

// ----------------------------------------------------------------
// KAMERA NA ŻYWO – podgląd + detekcja YOLO + zdarzenia percepcji
// ----------------------------------------------------------------
/* Kamera na żywo: podgląd, detekcja, sylwetka – public/kamera.js. */
/** Własny gest rozpoznany w panelu kamery (public/gesty.js) → jego czynność.
 *  Każdy gest idzie też do kontekstu rozmowy – ze znaczeniem, które nadała mu
 *  osoba, więc model wie, co „dwa palce w górę” miały powiedzieć. */
function wykonajGest(g) {
  fetch('/api/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'dlonie', summary: `gest „${g.nazwa}”${g.znaczenie ? ` – ${g.znaczenie}` : ''}` }),
  }).catch(() => {});
  // Przewija się pojemnik rozmowy (el.chatScroll), nie sama lista wiadomości.
  /* Krok z WIDOCZNEJ części rozmowy: na telefonie panel kamery zasłania
     większość ekranu i krok 70% wysokości przewijał tekst, którego nikt nie
     widział (zespół IT, runda 7). */
  const krok = () => {
    const r = el.chatScroll.getBoundingClientRect();
    let dol = r.bottom;
    const panel = $('live-panel');
    if (panel && panel.style.display !== 'none') {
      const p = panel.getBoundingClientRect();
      const zachodzi = p.left < r.right && p.right > r.left && p.top < r.bottom && p.bottom > r.top;
      if (zachodzi && p.top > r.top) dol = Math.min(dol, p.top);
    }
    return Math.max(80, Math.round((dol - r.top) * 0.8));
  };
  /* Przewijanie rozmowy tylko w okienku kamery – na pełnym ekranie rozmowy
     nie widać, więc przewijałby się tekst, na który nikt nie patrzy (Marcin,
     runda 8). Zamiast tego pigułka na kadrze mówi, gdzie ten gest działa. */
  const panel = $('live-panel');
  const pelnyEkran = panel && panel.style.display !== 'none' && panel.dataset.tryb === 'pelny';
  if (pelnyEkran && (g.czynnosc === 'przewin-gora' || g.czynnosc === 'przewin-dol')) {
    ustawStatusKamery(t('gest.przewinWOkienku', { nazwa: g.nazwa }), $('live-wyjasnienie')?.textContent || '');
    return false;
  }
  switch (g.czynnosc) {
    case 'przewin-gora': el.chatScroll.scrollBy({ top: -krok(), behavior: 'smooth' }); break;
    case 'przewin-dol': el.chatScroll.scrollBy({ top: krok(), behavior: 'smooth' }); break;
    case 'migawka': $('live-snapshot').click(); break;
    case 'glos': if (voiceMode) exitVoiceMode(); else enterVoiceMode(); break;
    case 'stop':
      stopSpeaking();
      if (isGenerating) stopGeneration();
      break;
    case 'wyslij':
      if (!g.parametr) break;
      el.input.value = g.parametr;
      sendMessage();
      break;
    case 'otworz':
      // Okno bez kliknięcia przeglądarka potrafi zablokować – mówimy to, zamiast milczeć.
      if (!otworzStrone(g.parametr)) ustawStatusKamery(t('gest.otworzZablokowane', { nazwa: g.nazwa }));
      break;
    default: break;   // „znaczenie” – samo zdarzenie w kontekście
  }
}

const kamera_ = utworzKamere({
  settings: () => settings, senses: () => senses, cameraFacing: () => cameraFacing, odswiezPlan: () => odswiezPlan,
  $, readJsonSafe, getMedia, videoConstraints, hasMultipleCameras, swapStream,
  onGest: (g) => wykonajGest(g),
});
const { updateLiveRec, dopasujPanelKamery, startLive, stopLive, wstrzymajWykrywanie, klatkiKinecta, ustawStatusKamery } = kamera_;

/* Plan zdjęciowy, karty ujęć i misja drona mieszkają w `public/plener.js`
   – patrz nagłówek tamtego pliku. Wywołanie rejestruje nasłuchy przycisków,
   więc musi stać dokładnie tu, gdzie stał przeniesiony kod. */
/* Konta: zaproszenie, Twoje konto, Dostęp (public/konta.js). */
const konta_ = utworzKonta({ $, t, zmienJezyk: () => setLang(getLang() === 'pl' ? 'en' : 'pl') });
// Zmysły na komputerze osoby (Ustawienia → Zmysły) i samouczek pierwszego uruchomienia.
const zmyslyWidok_ = utworzZmyslyWidok({ $, t });
zmyslyWidok_.pilnuj();
const samouczek_ = utworzSamouczek({ $, t, zmysly: zmyslyWidok_ });

const { odswiezPlan, zamknijPlener } = utworzPlener({
  $, el, t, readJsonSafe, closeSettings, dopasujPanelKamery,
  odswiezArchiwum, wczytajSprzet, zapiszSprzet,
});

// ----------------------------------------------------------------
// OŚ CZASU – Digital Time Machine
// ----------------------------------------------------------------

async function openTimeline() {
  $('timeline-modal').style.display = '';
  const list = $('timeline-list');
  list.innerHTML = `<div class="tl-empty">${t('loading')}</div>`;
  let snaps = [];
  try { snaps = (await (await fetch('/api/timeline')).json()).snapshots || []; } catch { /* offline */ }
  if (!snaps.length) { list.innerHTML = pustyStan('ik-archiwum', t('tm.empty')); return; }
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
      `<span class="tl-objects">${s.objects?.length ? escapeHtml(s.objects.join(', ')) : '–'}</span>` +
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
// GALERIA – przegląd wygenerowanych mediów (z bazy wiedzy)
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
    grid.innerHTML = pustyStan('ik-obraz', t('gallery.empty'), t('gallery.doStudia'));
    grid.querySelector('.pusty-stan button')?.addEventListener('click', () => { closeGallery(); openStudio(); });
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
    else media = `<div class="gallery-audio ik ik-dzwiek" aria-hidden="true"></div><audio src="${url}" controls></audio>`;

    // Widać, który obraz jest w tej chwili pierwszą klatką – bez tego jedynym
    // potwierdzeniem był ✓ znikający po sekundzie.
    const isFrame = localStorage.getItem('cosmos.videoFrame') === it.id;
    const frameBtn = k === 'image'
      ? `<button data-frame="${escapeHtml(it.id)}" class="ik ik-klatki ${isFrame ? 'frame-on' : ''}" `
        + `title="${isFrame ? t('gallery.frameIs') : t('gallery.useFrame')}" aria-label="${isFrame ? t('gallery.frameIs') : t('gallery.useFrame')}"></button>` : '';
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
    renderGallery();          // odśwież oznaczenia – widać, który obraz jest wybrany
    galleryNote(t('gallery.frameSet'));
  }));
  grid.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', async () => {
    const prev = b.textContent; b.textContent = '…'; b.disabled = true;
    try {
      const r = await fetch('/api/studio/upscale', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: b.dataset.up }),
      });
      await czekajNaZadanie(r, zadanieStudia(null));
      renderGallery();
    } catch (err) {
      alert(err.message);
      b.textContent = prev; b.disabled = false;
    }
  }));
}

/** Krótki komunikat w nagłówku Galerii – potwierdzenie, które nie znika po chwili. */
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
  $('gallery-filters').querySelectorAll('.gallery-filter').forEach((f) => {
    f.classList.toggle('active', f === btn);
    f.setAttribute('aria-pressed', String(f === btn));
  });
  renderGallery();
});

// ----------------------------------------------------------------
// BAZA WIEDZY – pliki, linki, notatki głosowe
// ----------------------------------------------------------------

const KB_MAX_FILE = 50 * 1024 * 1024; // 50 MB na plik

/** Klasa ikony liniowej dla pozycji bazy wiedzy (style.css, `.ik-…`). */
function kbIcon(item) {
  if (item.type === 'link') return 'ik-link';
  if (item.type === 'note') return 'ik-notatka';
  const mime = item.mime || '';
  if (mime.startsWith('image/')) return 'ik-obraz';
  if (mime.startsWith('audio/')) return 'ik-dzwiek';
  if (mime.startsWith('video/')) return 'ik-wideo';
  const ext = item.name.split('.').pop().toLowerCase();
  if (['xlsx', 'xls', 'csv', 'ods'].includes(ext)) return 'ik-tabela';
  if (['pdf', 'docx', 'doc', 'odt', 'pptx', 'ppt', 'txt', 'md'].includes(ext)) return 'ik-dokument';
  return 'ik-folder';
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  // Przecinek po polsku („1,4 MB”), kropka po angielsku.
  return (bytes / 1024 / 1024).toLocaleString(getLang() === 'en' ? 'en-US' : 'pl-PL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' MB';
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
      el.kbList.innerHTML = pustyStan('ik-folder', t('kb.empty'));
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
        if (check.checked) { kbSelected.add(item.id); podgladDlaPozycji(item); }
        else kbSelected.delete(item.id);
        saveKbSelected();
      });

      const icon = document.createElement('span');
      icon.className = `kb-item-icon ik ${kbIcon(item)}`;
      icon.setAttribute('aria-hidden', 'true');

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
      bits.push(item.przetwarzanie ? t('kb.wTle')
        /* Tekst przycięty do 200 tys. znaków – mówimy to wprost, z pełną długością.
           „tekst: 200000 zn.” przy pliku na 1,5 mln wyglądało jak całość (zespół IT, runda 5). */
        : item.textPelny > item.textChars
          ? t('kb.charsCut', { n: item.textChars.toLocaleString(), z: item.textPelny.toLocaleString() })
          : item.textChars ? t('kb.chars', { n: item.textChars.toLocaleString() }) : t('kb.noText'));
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

// Wysyłka pliku do bazy wiedzy i podgląd obrazu dla modelu – public/wysylka.js.
const { wyslijPlikDoBazy, przygotujPodglad, podgladDlaPozycji } = utworzWysylke({ t });

async function kbUploadFiles(files) {
  const list = [...files];
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    if (file.size > KB_MAX_FILE) {
      alert(t('kb.tooBig', { name: file.name }));
      continue;
    }
    const przetwarzam = t('kb.processing', { i: i + 1, n: list.length, name: file.name }) +
      (/^(audio|video)/.test(file.type) ? t('kb.transcribing') : '…');
    kbSetStatus(t('kb.uploading', { i: i + 1, n: list.length, name: file.name, proc: 0 }));
    try {
      const d = await wyslijPlikDoBazy(file, (czesc) => {
        // Wysłane w całości – dalej serwer czyta tekst (albo przepisuje nagranie w tle).
        kbSetStatus(czesc >= 1 ? przetwarzam
          : t('kb.uploading', { i: i + 1, n: list.length, name: file.name, proc: Math.floor(czesc * 100) }));
      });
      if (d.item && /^image\//.test(file.type)) await przygotujPodglad(file, d.item.id).catch(() => false);
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
  // wariant 1: rozpoznawanie na serwerze (Whisper w zmysłach albo chmura)
  if (sttSerwera() && window.MediaRecorder) {
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
          const res = await fetch(adresStt(), {
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
    kbSetStatus((acc + ' ' + interim).trim().slice(-160));
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
// ASYSTENT GŁOSOWY – „Hej, Kosmos” (jak Asystent Google)
// Wake word i rozmowa: Web Speech API (Chrome/Edge, także Android).
// ----------------------------------------------------------------

// Wzorzec słowa budzącego i jego historia: public/mowa.js (SLOWO_BUDZACE).
const WAKE_RE = window.SLOWO_BUDZACE;

/* Czyste przekształcenia tekstu mowy – `public/mowa.js`. Tam mieszka też
   `doklej`, czyli scalanie kolejnych rozpoznań bez powtórzeń. */
const {
  doklej: doklejRozpoznane, odciskWyniku, bezSlowaBudzacego, toSamoZdanie,
  przepisanie, doklejBezZakladki, tenSamTekst,
} = utworzMowe({ WAKE_RE });
// Koniec rozmowy i pytania o obraz: public/mowa.js (KONIEC_ROZMOWY, PYTANIE_O_OBRAZ).
const END_RE = window.KONIEC_ROZMOWY;
/* „Ile palców pokazuję?” nie pasowało do żadnego słowa i klatka w ogóle nie
   szła. Stąd palce, gesty, dłonie i „pokazuję”. */
const VISUAL_RE = window.PYTANIE_O_OBRAZ;

function getSR() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function setVoiceState(state) {
  voiceState = state;
  el.voiceOrb.className = 'voice-orb ' + state;
  el.voiceOrb.dataset.podstan = '';
  el.voiceStatus.textContent = {
    wake: t('voice.wake'),
    listening: t('voice.listening'),
    thinking: t('voice.thinking'),
    speaking: t('voice.speaking'),
    push: t('voice.push'),
  }[state] || '';
  // W trybie „naciśnij" kula jest przyciskiem – musi to być widać i czuć.
  el.voiceOrb.style.cursor = 'pointer';
  /* Podpowiedź mówi, co działa TERAZ. Dawniej stopka zawsze obiecywała
     „Hej, Cosmos budzi asystenta", także w trybie rozmowy, w którym słowa
     budzącego nie ma (mowę rozpoznaje chmura, otoczenia nie słuchamy).
     Marcin: „nie wiem, czy mam kliknąć kulę, czy od razu mówić". */
  el.voiceHint.textContent = t(state === 'push' ? 'voice.hintPush'
    : state === 'speaking' ? 'voice.hintSpeaking'
    : trybRozmowy() ? 'voice.hintTalk' : 'voice.hint');
}

/* Podstan słuchania: „słyszę cię" (mowa wykryta), „rozpoznaję" (nagranie
   poszło do Whispera) albo nic (czekam). Bez tego ekran przez cały czas
   pokazywał „SŁUCHAM…" i nie było wiadomo, czy dźwięk w ogóle dochodzi. */
function ustawPodstan(podstan) {
  if (voiceState !== 'listening') return;
  el.voiceOrb.dataset.podstan = podstan;
  el.voiceStatus.textContent = t(podstan === 'slysze' ? 'voice.hearing'
    : podstan === 'rozpoznaje' ? 'voice.recognizing' : 'voice.listening');
}

/* Poziom głosu na kuli i słupkach – raz na klatkę, nie 47 razy na sekundę. */
let poziomRamka = 0;
let poziomTeraz = 0;
function pokazPoziom(p) {
  poziomTeraz = p;
  if (poziomRamka) return;
  poziomRamka = requestAnimationFrame(() => {
    poziomRamka = 0;
    el.voiceOverlay.style.setProperty('--poziom', poziomTeraz.toFixed(2));
  });
}

/** Szkic rozpoznanego tekstu w trakcie mówienia (podgląd z nasluch.js). */
function pokazPodglad(tekst) {
  if (!voiceMode || voiceState !== 'listening') return;
  el.voiceTranscript.textContent = bezSlowaBudzacego(tekst) || tekst;
  el.voiceTranscript.classList.remove('komunikat');
  el.voiceTranscript.classList.add('podglad');
  delete el.voiceTranscript.dataset.komunikat;
}

function bezPodgladu() {
  if (!el.voiceTranscript.classList.contains('podglad')) return;
  el.voiceTranscript.classList.remove('podglad', 'komunikat');
  el.voiceTranscript.textContent = '';
}

function nasluchZajety() {
  return Boolean(nasluch && (nasluch.wMowie() || nasluch.rozpoznaje()));
}

function zmianaMowy(start, wyslano) {
  if (!voiceMode || voiceState !== 'listening') return;
  ustawPodstan(start ? 'slysze' : wyslano ? 'rozpoznaje' : '');
}

function poRozpoznaniu() {
  if (!voiceMode || voiceState !== 'listening') return;
  bezPodgladu();
  if (!nasluchZajety()) ustawPodstan('');
}

/* ============ PISZCZĄCY MIKROFON ============
   Marcin: „cały czas ten mikrofon się włącza i odłącza wraz z tym irytującym
   dźwiękiem przyłączania i odłączania".

   To nie jest usterka Cosmosa – to Android. Chrome na telefonie nie obsługuje
   `continuous`: kończy sesję rozpoznawania po każdej wypowiedzi i po każdej
   ciszy, a każde uruchomienie i zamknięcie mikrofonu system kwituje
   dźwiękiem. Nasłuch słowa budzącego wymaga ciągłego słuchania, więc
   wznawiamy – i tak w kółko, co kilka sekund, także wtedy, gdy w pokoju
   nikogo nie ma.

   Nie da się tego wyłączyć od strony strony internetowej. Da się natomiast
   przestać się upierać: jeśli kilkanaście wznowień z rzędu nie przyniosło
   ANI JEDNEGO rozpoznanego słowa, nasłuch ciągły w tym przeglądarce po prostu
   nie działa. Wtedy zamiast piszczeć dalej, kula zamienia się w przycisk:
   jedno dotknięcie, jedna sesja, jeden dźwięk.

   Liczymy tylko wznowienia JAŁOWE. Rozmowa zeruje licznik, więc komuś, u kogo
   nasłuch działa (desktop, Whisper przez własny strumień), nic się nie zmienia. */
const WZNOWIEN_ZANIM_PRZYCISK = 12;
let wznowienJalowych = 0;

/** Rozpoznanie się udało – nasłuch ciągły w tej przeglądarce działa. */
function nasluchDziala() {
  wznowienJalowych = 0;
}

/** Przejdź na „naciśnij, aby mówić" i przestań wznawiać sesję. */
function nasluchNaPrzycisk() {
  wznowienJalowych = 0;
  /* Zapamiętane na stałe dla TEJ przeglądarki. Bez tego Marcin przy każdym
     wejściu w tryb głosowy słuchałby dwunastu piśnięć od nowa, zanim Cosmos
     ponownie dojdzie do tego samego wniosku. Zapis kasuje się sam, gdy
     pojawi się własny strumień z Whisperem – wtedy ciągły nasłuch działa
     i nie ma czego omijać. */
  try { localStorage.setItem('cosmos.nasluchPrzycisk', '1'); } catch { /* tryb prywatny */ }
  if (voiceRec) { try { voiceRec.abort(); } catch { /* już zamknięty */ } }
  voiceRec = null;
  setVoiceState('push');
  el.voiceTranscript.textContent = '';
}

/** Jedna sesja rozpoznawania pod palcem – bez wznawiania w kółko. */
function nasluchRaz() {
  if (!voiceMode) return;
  wznowienJalowych = 0;
  voiceHeard = '';
  el.voiceTranscript.textContent = '';
  if (silnikNasluchu() === 'whisper') { startQueryListening(); return; }
  setVoiceState('listening');
  startVoiceRecognizer();
}

// Jeden kontekst audio na całą stronę. Tworzenie i zamykanie go przy każdym
// sygnale przełączało wyjście dźwięku w Androidzie – słychać to było jako
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

/** Zatrzymaj rozpoznawanie na dobre – tylko przy wyjściu z trybu głosowego. */
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
    /* onend (zerowany wyżej) zerował znacznik zużytych wyników – bez tego po
       wyjściu i ponownym wejściu pierwsze zdanie identyczne z ostatnim
       zużytym („Hej Cosmos”) uchodziło za już obsłużone i przepadało. */
    oznaczZuzyte(null, 0);
  }
}

async function enterVoiceMode() {
  rozpoznajOdlozonePtaki();
  // Dwa silniki, dwa różne wymagania. Brak Web Speech API nie przekreśla
  // trybu głosowego, jeśli działa własny nasłuch z Whisperem – a to właśnie
  // przypadek Firefoksa i Safari, gdzie rozpoznawania mowy po prostu nie ma.
  if (!getSR() && !nasluchMozliwy()) {
    alert(t('voice.noSupport'));
    return;
  }
  voiceMode = true;
  el.voiceOverlay.style.display = '';
  el.voiceTranscript.textContent = '';
  el.voiceAnswer.textContent = '';
  /* Wybór silnika zależy od /api/config i /api/status. Otwarcie trybu,
     zanim przyszły, tworzyło SpeechRecognition (piszczenie), a po ich
     nadejściu startował drugi nasłuch obok pierwszego. Czekamy na nie,
     ale nie dłużej niż 4 s. */
  setVoiceState('thinking');
  // „MYŚLĘ…” przed pierwszym pytaniem było nieprawdą – Cosmos dopiero się przygotowuje.
  el.voiceStatus.textContent = t('voice.preparing');
  await Promise.race([gotowoscGlosu, pauza(4000)]);
  if (!voiceMode) return;
  silnikSesji = null;
  silnikSesji = silnikNasluchu();

  // UWAGA – nie wolno tu trzymać własnego strumienia z mikrofonu.
  // Próbowałem tak wyciszyć sygnały podłączania sprzętu na Androidzie, ale
  // rozpoznawanie mowy korzysta z tego samego mikrofonu na wyłączność: przy
  // zajętym wejściu przestawało cokolwiek słyszeć, łącznie z „Hej, Kosmos”.
  // Działające rozpoznawanie jest ważniejsze niż cichszy telefon.

  // Kamera NIE włącza się sama. Wcześniej tak było i na telefonie podgląd
  // zasłaniał pół ekranu przy każdym nasłuchu – a wizji potrzeba tylko przy
  // pytaniach w rodzaju „co trzymam w ręku”. Teraz to świadome kliknięcie.
  if (localStorage.getItem('cosmos.voiceCam') === '1') await startVoiceCamera();
  updateVoiceCamButton();

  /* Ta przeglądarka już raz pokazała, że nie utrzymuje ciągłego nasłuchu –
     nie każemy jej dowodzić tego drugi raz kosztem kolejnych kilkunastu
     piśnięć mikrofonu. Whisper przez własny strumień piszczeć nie musi,
     więc gdy jest dostępny, zapis przestaje obowiązywać i znika. */
  if (silnikNasluchu() === 'whisper') {
    try { localStorage.removeItem('cosmos.nasluchPrzycisk'); } catch { /* tryb prywatny */ }
    // Ktoś właśnie otworzył tryb głosowy – chce mówić, więc od razu słuchamy.
    if (trybRozmowy()) { startQueryListening(); return; }
  } else if (localStorage.getItem('cosmos.nasluchPrzycisk') === '1' || /Android/i.test(navigator.userAgent)) {
    /* Web Speech API na Androidzie piszczy przy każdym starcie i końcu sesji,
       a ciągłego nasłuchu i tak nie utrzyma. Zamiast kilkunastu piśnięć, zanim
       Cosmos sam to odkryje, od razu kula pod palcem: jedno dotknięcie, jedna
       sesja. */
    setVoiceState('push');
    return;
  }

  startWakeListening();
}

/* Kinect w trybie głosowym. Marcin: „przy asystencie głosowym nie można
   wrzucić podglądu z kamery” – przycisk znał tylko kamerę przeglądarki, a jego
   komputer ma wyłącznie Kinecta. Teraz: wybrany w panelu kamery Kinect, a przy
   kamerze przeglądarki, której nie ma – Kinect, jeśli zmysły go mają. */
let voiceKinectStop = null;

function kinectDostepny() {
  return Boolean(senses.online && senses.caps.kinect);
}

function startVoiceKinect() {
  const img = $('voice-kinect');
  el.voiceCamera.hidden = true;
  img.hidden = false;
  el.voiceCameraWrap.style.display = '';
  voiceKinectStop = klatkiKinecta(img, { stream: 'color', fps: 10 });
  return true;
}

async function startVoiceCamera() {
  if (voiceCameraStream || voiceKinectStop) return true;
  const zrodlo = localStorage.getItem('cosmos.liveSource') || 'camera';
  if (zrodlo.startsWith('kinect') && kinectDostepny()) return startVoiceKinect();
  let strumien;
  // Wyścig: tryb głosowy zamknięty w trakcie czekania na zgodę na kamerę.
  const bylGlosowy = voiceMode;
  const porzucony = () => bylGlosowy && !voiceMode;
  try {
    strumien = await getMedia(videoConstraints(cameraFacing));
  } catch {
    // Komputer bez kamery, za to z Kinectem – bierzemy Kinecta. Ale nie po
    // wyjściu z trybu głosowego w trakcie czekania na zgodę.
    if (!porzucony() && kinectDostepny()) return startVoiceKinect();
    return false;                     // tryb głosowy działa też bez kamery
  }
  /* Zgoda na kamerę przyszła, gdy trybu głosowego już nie było (albo kamera
     w nim zdążyła wstać drugą drogą). Bez tego kamera zostawała włączona
     w tle, z zapaloną diodą i bez podglądu (agencja, runda 7). */
  if (porzucony() || voiceCameraStream || voiceKinectStop) {
    strumien.getTracks().forEach((tr) => tr.stop());
    return Boolean(voiceCameraStream || voiceKinectStop);
  }
  voiceCameraStream = strumien;
  $('voice-kinect').hidden = true;
  el.voiceCamera.hidden = false;
  el.voiceCamera.srcObject = voiceCameraStream;
  el.voiceCameraWrap.style.display = '';
  return true;
}

function stopVoiceCamera() {
  if (voiceCameraStream) {
    voiceCameraStream.getTracks().forEach((tr) => tr.stop());
    voiceCameraStream = null;
  }
  if (voiceKinectStop) { voiceKinectStop(); voiceKinectStop = null; }
  const img = $('voice-kinect');
  if (img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
  img.removeAttribute('src');
  el.voiceCamera.srcObject = null;
  el.voiceCameraWrap.style.display = 'none';
}

function updateVoiceCamButton() {
  const on = Boolean(voiceCameraStream || voiceKinectStop);
  const btn = $('voice-cam-btn');
  btn.classList.toggle('active', on);
  btn.title = t(on ? 'voice.camOff' : 'voice.camOn');
  btn.setAttribute('aria-label', btn.title);
  btn.setAttribute('aria-pressed', String(on));
}

$('voice-cam-btn').addEventListener('click', async () => {
  if (voiceCameraStream || voiceKinectStop) {
    stopVoiceCamera();
    localStorage.setItem('cosmos.voiceCam', '0');
  } else {
    const ok = await startVoiceCamera();
    localStorage.setItem('cosmos.voiceCam', ok ? '1' : '0');
    if (!ok) $('voice-status').textContent = t('voice.camFail');
  }
  updateVoiceCamButton();
});

/* ---- „Kto to śpiewa?" – BirdNET z nakładki głosowej -------------------
   Ptaka słychać dużo dalej, niż go widać, i to słuch decyduje, gdzie postawić
   statyw. Nagranie idzie bez „ulepszaczy" dźwięku i w pełnej częstotliwości:
   redukcja szumu w telefonie wycina dokładnie te ciche, wysokie tony, które
   są tu całą treścią. */
const PTAK_SEKUND = 8;
// Drugie kliknięcie w trakcie nagrania otwierałoby DRUGI strumień z tego samego
// mikrofonu. Część urządzeń po prostu odmawia, reszta oddaje cichsze nagranie.
let ptakTrwa = false;
// Z /api/status: czy ptaki obsłuży KTÓREŚ źródło (także serwer, bez domu).
let stanPtakow = { dostepne: false, znany: false };
let ptakiPoStatusie = false;

/* KOLEJKA BEZ ZASIĘGU. W lesie nagranie jest, a internetu nie ma – dawniej
   przepadało. Teraz czeka w przeglądarce (IndexedDB) i rozpoznaje się samo,
   gdy sieć wróci. Po jednym: serwer odpowiada 429 na drugie nagranie tej
   samej osoby. Pamięć przeglądarki bywa niedostępna – wtedy po prostu mówimy,
   że trzeba połączenia.
   Nagranie należy do OSOBY (`kto`): na wspólnym telefonie nagranie Ani szło
   na konto Bartka, który zalogował się po niej (runda 9). Przy wylogowaniu
   i zmianie osoby baza znika w całości (konta.js, usunNagraniaPtakow) – dlatego
   każde połączenie zamykamy zaraz po transakcji, inaczej usuwanie bazy czeka. */
const ptakiOdlozone = {
  otworz() {
    return new Promise((ok, zle) => {
      const r = indexedDB.open('cosmos-ptaki', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('nagrania', { keyPath: 'id', autoIncrement: true });
      r.onsuccess = () => { const db = r.result; db.onversionchange = () => db.close(); ok(db); };
      r.onerror = () => zle(r.error);
    });
  },
  async transakcja(tryb, praca) {
    const db = await this.otworz();
    try {
      return await new Promise((ok, zle) => {
        const tx = db.transaction('nagrania', tryb);
        const wynik = praca(tx.objectStore('nagrania'));
        tx.oncomplete = () => ok(wynik && 'result' in wynik ? wynik.result : undefined);
        tx.onerror = () => zle(tx.error);
        tx.onabort = () => zle(tx.error);
      });
    } finally { db.close(); }
  },
  dodaj(blob, kto = kimJestem()) {
    return this.transakcja('readwrite', (s) => s.add({ blob, kiedy: Date.now(), kto: kto || null }));
  },
  async wszystkie() {
    return (await this.transakcja('readonly', (s) => s.getAll())) || [];
  },
  usun(id) {
    return this.transakcja('readwrite', (s) => s.delete(id)).catch(() => {});
  },
};
/** Id zalogowanej osoby (null, dopóki /api/auth nie odpowiedział). */
function kimJestem() { return konta_.ja()?.id || null; }

/** Opis wyniku BirdNET: ekran i głos osobno (nazwa po polsku, łacina drobnym drukiem). */
function opisPtakow(lista) {
  const pierwszy = lista[0];
  const proc = Math.round((pierwszy.pewnosc || 0) * 100);
  const nazwa = pierwszy.nazwa || pierwszy.lacinska;
  return {
    ekran: t('voice.birdFound', { nazwa, proc })
      + (lista.length > 1 ? ` · ${lista.slice(1).map((g) => `${g.nazwa || g.lacinska} ${Math.round((g.pewnosc || 0) * 100)}%`).join(' · ')}` : ''),
    glos: t('voice.birdFoundSpoken', { nazwa, proc }),
    nazwa, proc,
  };
}

async function wyslijPtaka(blob) {
  const res = await fetch('/api/ptak', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Cosmos-Jezyk': getLang() }, body: blob });
  const dane = await readJsonSafe(res);
  if (!res.ok) {
    throw Object.assign(new Error(dane.error || `HTTP ${res.status}`),
      { status: res.status, kod: dane.kod, poIlu: Number(res.headers.get('Retry-After')) || 0 });
  }
  return Array.isArray(dane.gatunki) ? dane.gatunki : [];
}

/* Które odpowiedzi serwera kończą los nagrania. Tylko błąd TREŚCI (zły plik,
   za duży, zły typ) – ponawianie nic nie da. Wszystko inne jest chwilowe:
   401 (sesja wygasła), 403 i 503 (BirdNET się rozgrzewa, restart), 429 (liczy
   się poprzednie), 502/504 (dom śpi, Cloudflare). Dawniej każde z nich
   kasowało nagranie z lasu na zawsze (zespół IT, runda 9). */
const PTAK_BLAD_TRESCI = [400, 413, 415, 422];
/** Błąd „na żywo”, po którym nagranie warto odłożyć, zamiast je zgubić. */
const ptakBladChwilowy = (err) => err instanceof TypeError || [502, 503, 504].includes(err.status) || err.kod === 'ptaki-chwilowo';

/** Zdanie dla błędu rozpoznawania ptaka – po kodzie, w języku interfejsu.
    Zdanie serwera jest po polsku (czyta je też MCP), więc na ekran nie idzie. */
function komunikatPtaka(err) {
  if (err.status === 501) return t(konta_.ja()?.rola === 'czlonek' ? 'voice.birdNotInstalledMember' : 'voice.birdNotInstalled');
  if (err.kod === 'ptaki-chwilowo') return t('voice.birdNoSenses');
  if (err.status === 403) return t('voice.birdNotForYou');
  if (err.status === 429 || err.kod === 'zajete') return t('voice.birdBusy');
  if (err.kod === 'kolejka-pelna') return t('voice.birdQueueFull');
  if (err.status === 413) return t('voice.birdTooBig');
  if (err.status >= 500) return t('voice.birdNoSenses');
  return t('voice.birdErr');
}

/** Rozpoznaj nagrania odłożone bez zasięgu – po jednym, gdy wróci sieć. */
let ptakiOdkladanie = false;
let ptakiPonowTimer = null;
async function rozpoznajOdlozonePtaki() {
  if (ptakiOdkladanie || !navigator.onLine) return;
  // Dopóki nie wiemy, KTO jest zalogowany, nic nie wysyłamy – nagranie mogłoby trafić do cudzej rozmowy.
  const ja = kimJestem();
  if (!ja) return;
  ptakiOdkladanie = true;
  try {
    const lista = await ptakiOdlozone.wszystkie().catch(() => []);
    // Rekordy sprzed rundy 9 nie mają `kto` – należą do osoby, która jest tu od tamtej pory (zmiana osoby czyści bazę).
    for (const w of lista.filter((x) => (x.kto || ja) === ja)) {
      const godzina = new Date(w.kiedy).toLocaleTimeString(getLang() === 'en' ? 'en-GB' : 'pl-PL', { hour: '2-digit', minute: '2-digit' });
      let gatunki;
      try { gatunki = await wyslijPtaka(w.blob); } catch (err) {
        if (err instanceof TypeError) break;          // sieć znowu zniknęła – spróbujemy później
        if (PTAK_BLAD_TRESCI.includes(err.status)) {  // błąd treści – ponawianie nie pomoże
          await ptakiOdlozone.usun(w.id);
          pokazKomunikatPtaka(t('voice.birdLaterErr', { godzina }));
          continue;
        }
        /* Chwilowe: nagranie zostaje, próbujemy później. Retry-After serwera
           mówi kiedy; bez niego pół minuty. Przy 401/403 czekamy na zdarzenie
           (logowanie, powrót do karty), nie na zegar. */
        if (![401, 403].includes(err.status)) {
          clearTimeout(ptakiPonowTimer);
          ptakiPonowTimer = setTimeout(rozpoznajOdlozonePtaki, Math.min(Math.max(err.poIlu || 30, 5), 300) * 1000);
        }
        break;
      }
      await ptakiOdlozone.usun(w.id);
      const tekst = gatunki.length
        ? t('voice.birdLater', { godzina, ...(({ nazwa, proc }) => ({ nazwa, proc }))(opisPtakow(gatunki)) })
        : t('voice.birdLaterNone', { godzina });
      pokazKomunikatPtaka(tekst);
    }
  } finally {
    ptakiOdkladanie = false;
  }
}
/** Wynik odłożonego nagrania: w trybie głosowym na scenie, poza nim w rozmowie. */
function pokazKomunikatPtaka(tekst) {
  if (voiceMode) { el.voiceAnswer.textContent = tekst; return; }
  if (!activeConversation) return;
  activeConversation.messages.push({ role: 'assistant', content: tekst, komunikatCosmosa: true, ...znakSilnika() });
  saveConversations();
  renderMessages({ przewin: sledzeDol });
}
/* Kolejka rusza nie tylko po `online` i w trybie głosowym: aplikacja
   otwarta już z zasięgiem (zdarzenia `online` nie będzie) rusza ją po
   pierwszym /api/status (refreshStatusWlasciwe), a telefon wyjęty z kieszeni
   – przy powrocie do karty. */
window.addEventListener('online', () => { rozpoznajOdlozonePtaki(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') rozpoznajOdlozonePtaki(); });

async function rozpoznajPtaka() {
  if (ptakTrwa) return;
  if (!(window.NasluchWlasny && window.NasluchWlasny.dostepny())) {
    el.voiceAnswer.textContent = t('voice.birdNoAudio');
    return;
  }
  /* Blokujemy tylko wtedy, gdy WIEMY, że ta osoba nie ma żadnej drogi do
     ptaków. Stan sprzed 30 s nie może odmawiać za serwer – nagranie idzie,
     a odpowiedź serwera mówi resztę (runda 8: przycisk odmawiał, zanim
     cokolwiek wysłał, choć serwer by rozpoznał). */
  if (stanPtakow.znany && !stanPtakow.dostepne && !(senses.online && senses.caps.birdnet) && senses.tylkoWlasciciel) {
    el.voiceAnswer.textContent = t('voice.birdNotForYou');
    return;
  }
  // Mikrofon jest zajęty przez nasłuch ciągły – zwalniamy go na czas nagrania
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
    const wolno = setTimeout(() => { el.voiceAnswer.textContent = t('voice.birdSlow'); }, 20000);
    let lista;
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      lista = await wyslijPtaka(blob);
    } catch (err) {
      clearTimeout(wolno);
      /* Brak sieci albo chwilowa niedostępność (dom śpi, BirdNET się rozgrzewa,
         kolejka pełna): nagranie czeka w przeglądarce i rozpozna się później.
         Dawniej 502/503/504 na żywo gubiło nagranie z lasu (zespół IT, runda 9). */
      if (ptakBladChwilowy(err)) {
        let odlozone = false;
        try { await ptakiOdlozone.dodaj(blob); odlozone = true; } catch { /* pamięć przeglądarki niedostępna */ }
        if (err instanceof TypeError) {
          el.voiceAnswer.textContent = t(odlozone ? 'voice.birdQueued' : 'voice.birdOffline');
        } else {
          console.warn('ptak:', err);
          el.voiceAnswer.title = err.message || '';
          el.voiceAnswer.textContent = `${komunikatPtaka(err)}${odlozone ? ` ${t('voice.birdKept')}` : ''}`;
          if (odlozone) {
            clearTimeout(ptakiPonowTimer);
            ptakiPonowTimer = setTimeout(rozpoznajOdlozonePtaki, Math.min(Math.max(err.poIlu || 30, 5), 300) * 1000);
          }
        }
        return;
      }
      throw err;
    }
    clearTimeout(wolno);
    if (!lista.length) {
      el.voiceAnswer.textContent = t('voice.birdNone');
      setVoiceState('speaking');
      await speakText(t('voice.birdNone'));
    } else {
      const opis = opisPtakow(lista);
      el.voiceAnswer.textContent = opis.ekran;
      el.voiceAnswer.title = lista.map((g) => g.lacinska).filter(Boolean).join(' · ');
      setVoiceState('speaking');
      await speakText(opis.glos);
    }
  } catch (err) {
    /* Bez surowych błędów („HTTP 502”) i bez polskich zdań serwera w angielskim
       interfejsie: zdanie po kodzie z i18n. Szczegół w podpowiedzi i w konsoli. */
    console.warn('ptak:', err);
    el.voiceAnswer.title = err.message || '';
    el.voiceAnswer.textContent = komunikatPtaka(err);
  } finally {
    ptakTrwa = false;
    if (voiceMode) {
      if (bylNasluch) backToWake();
      else setVoiceState('wake');
    }
  }
}

$('voice-bird-btn').addEventListener('click', rozpoznajPtaka);

/* Tryb głosowy przy uśpionym domu mówił „przełącz się na chmurę”, a na
   scenie nie było jak (agencja, runda 9). Przycisk pod odpowiedzią robi to
   samo co „Wyślij przez Chmurę” pod błędem – nadal jawne dotknięcie, nic
   nie przełącza się samo (Marcin, runda 8). */
function pokazChmureWGlosie(tak) {
  let b = $('voice-chmura');
  if (!tak) { if (b) b.hidden = true; return; }
  if (!b) {
    b = document.createElement('button');
    b.type = 'button';
    b.id = 'voice-chmura';
    b.className = 'voice-chmura msg-przez-chmure';
    b.addEventListener('click', () => {
      const conv = activeConv();
      const i = conv ? conv.messages.length - 1 : -1;
      b.hidden = true;
      if (!conv || !conv.messages[i] || conv.messages[i].zapas !== 'cloud') return;
      stopSpeaking();
      setEndpoint('cloud');
      regenerateFrom(i);
    });
    el.voiceAnswer.after(b);
  }
  b.textContent = t('chat.przezChmure');
  b.title = t('chat.przezChmureTytul');
  b.hidden = false;
}

function exitVoiceMode() {
  // Wyjście z głosu w trakcie pytania o zgodę = „bez agentów” (nic nie wychodzi do chmury).
  if (zgodaGlosem) zgodaGlosem.wybierz('nie');
  pokazChmureWGlosie(false);
  voiceMode = false;
  silnikSesji = null;
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
 * przejęcie mikrofonu Android sygnalizuje dźwiękiem – stąd „ciągłe podłączanie
 * i odłączanie". Teraz rozpoznawacz żyje od wejścia w tryb głosowy do wyjścia,
 * a zmienia się tylko to, jak interpretujemy wynik. Mikrofon jest przejmowany
 * raz, nie przy każdym zdaniu.
 *
 * Gdy Cosmos myśli albo mówi, wyników nie czytamy (`voiceDeaf`) – inaczej
 * usłyszałby własny głos i odpowiadał sam sobie. Rozpoznawacz zostaje wtedy
 * uruchomiony, ale głuchy, bo zatrzymanie go zwolniłoby mikrofon i wróciłby
 * dźwięk przy ponownym starcie.
 */
let voiceRec = null;          // jedyny rozpoznawacz sesji
let voiceDeaf = false;        // ignoruj wyniki (Cosmos myśli albo mówi)
let voiceHeard = '';          // złożone zdanie w trybie pytania
let voicePoczatekWypowiedzi = 0;   // kiedy przyszedł pierwszy wynik bieżącej wypowiedzi (echo pytania o zgodę)
/* Komunikat (błąd rozpoznawania, mikrofon wyciszony) stoi w tym samym polu co
   usłyszane słowa. Dotknięcie kuli w trakcie słuchania brało treść pola jako
   pytanie – i model odpowiadał na „Nie udało się rozpoznać mowy: …".
   Zapamiętujemy więc, co było komunikatem. */
function komunikatGlosu(tekst) {
  el.voiceTranscript.classList.remove('podglad');
  /* Komunikat nie w dymku pytania. Marcin zobaczył „Nie udało się rozpoznać
     mowy: HTTP 502” w miejscu swojej wypowiedzi i wyglądało to, jakby Cosmos
     wysłał ten błąd do modelu. Teraz to przygaszona linijka bez dymka. */
  el.voiceTranscript.classList.toggle('komunikat', Boolean(tekst));
  el.voiceTranscript.textContent = tekst;
  el.voiceTranscript.dataset.komunikat = tekst;
}
function usłyszaneWPolu() {
  const pole = el.voiceTranscript.textContent || '';
  // Szkic z podglądu nie jest pytaniem: ostateczny tekst przyjdzie z Whispera.
  if (el.voiceTranscript.classList.contains('podglad')) return '';
  return pole === el.voiceTranscript.dataset.komunikat ? '' : pole;
}
/* Silnik rozpoznawania ustalony RAZ na sesję głosową. Liczony przy każdym
   przejściu stanu potrafił zmienić zdanie w połowie (chwilowy brak zmysłów
   w /api/status) – i działały dwa nasłuchy naraz. */
let silnikSesji = null;
/* Serwer trzy razy z rzędu nie rozpoznał mowy. To stan TEJ sesji, nie wybór
   użytkownika – dawniej trafiał na stałe do Ustawień i po naprawie serwera
   Cosmos dalej piszczał Web Speech API. */
let sttSerweraPadl = false;
let voiceSilence = null;      // odliczanie ciszy po pytaniu
/* Znacznik „to już przerobiliśmy”. Samo `voiceDeaf` nie wystarczało i to była
   przyczyna sprzężenia: rozpoznawacz jest CIĄGŁY, więc kiedy Cosmos mówi,
   dalej transkrybuje – tyle że my wyniki ignorujemy. Zostają jednak w
   `e.results`, a gałąź słowa budzącego czytała trzy OSTATNIE wyniki niezależnie
   od tego, czy były już widziane. Po skończonej wypowiedzi Cosmos odczytywał
   więc własne zdanie jako nowe polecenie i odpowiadał sam sobie w kółko.
   Teraz wszystko, co padło w czasie głuchoty, jest z góry oznaczone jako
   zużyte.

   Sam indeks to jednak za mało, bo NIE JEST STAŁYM PUNKTEM ODNIESIENIA.
   Rozpoznawacz potrafi zacząć numerować od zera bez `onend` – Chrome robi tak
   po dłuższej ciszy, a na Androidzie po każdej domkniętej wypowiedzi. Znacznik
   zostawał wtedy w górze, świeże wyniki wypadały poniżej niego i pytanie
   znikało bez śladu: transkrypcja pusta, cisza nie miała czego wysłać.
   Dlatego obok indeksu trzymamy ODCISK ostatniego zużytego wyniku. Jeśli lista
   nie urosła ponad znacznik, a tego wyniku już w niej nie ma – numeracja
   ruszyła od nowa i znacznik trzeba wyzerować. */
let voiceZuzyteDo = 0;
let voiceOdcisk = '';
// Co Cosmos ostatnio powiedział – druga zapora przed pętlą.
let voiceOstatniaOdpowiedz = '';

/* ---- DRUGI SILNIK NASŁUCHU: własny strumień + Whisper ----------------
   Cała gimnastyka powyżej (znaczniki zużycia, odciski wyników, wykrywanie
   restartu numeracji) istnieje dlatego, że Web Speech API nie da się
   wyciszyć ani zatrzymać bez zwolnienia mikrofonu. `public/nasluch.js`
   rozwiązuje to u źródła: mikrofon otwarty raz na całą sesję, wypowiedzi
   wycinane z sygnału po energii, tekst z Whispera. Wtedy „głuchy" znaczy
   naprawdę głuchy – próbki lecą do kosza i nie ma czego rozpoznać.

   Wymaga włączonych zmysłów, więc to WYBÓR, nie zamiennik. Przy wyłączonym
   komputerze domowym Cosmos wraca do Web Speech API bez pytania. */
let nasluch = null;            // instancja NasluchWlasny albo null
let nasluchCisza = null;       // powrót do nasłuchu słowa budzącego po ciszy
const NASLUCH_CISZA_MS = 12000;

/* ---- GDZIE ROZPOZNAĆ MOWĘ -------------------------------------------
   Serwer ma łańcuch źródeł (lib/glos.js): Whisper w zmysłach, własny serwer
   rozpoznawania, OpenAI. Aplikacja pyta więc nie „czy działają zmysły", tylko
   „czy serwer w ogóle rozpozna mowę" – a lokalność sprawdza osobno, bo od niej
   zależy, czy wolno słuchać otoczenia w oczekiwaniu na „Hej, Cosmos". */
function sttLokalne() {
  return Boolean((senses.online && senses.caps.whisper) || serverConfig.glos?.sttLokalnyWlasny);
}
function sttSerwera() {
  return sttLokalne() || Boolean(serverConfig.glos?.sttChmura);
}
/** Adres rozpoznawania z językiem rozmowy i trybem (nasłuch otoczenia albo pytanie). */
function adresStt(tryb = 'pytanie') {
  return `/api/stt?jezyk=${getLang() === 'en' ? 'en' : 'pl'}&tryb=${tryb}`;
}
/** Tryb rozmowy: mowę rozpoznaje tylko chmura, więc bez nasłuchu otoczenia.
 *  Cosmos słucha od razu po otwarciu trybu głosowego i po każdej odpowiedzi,
 *  a po chwili ciszy czeka na dotknięcie kuli – tak jak asystenci w telefonach.
 *  Web Speech API (i jego piszczenie na Androidzie) nie jest wtedy potrzebne. */
function trybRozmowy() {
  return silnikNasluchu() === 'whisper' && !sttLokalne();
}

function nasluchMozliwy() {
  return Boolean(window.NasluchWlasny && window.NasluchWlasny.dostepny() && sttSerwera());
}

/** 'whisper' albo 'przegladarka'. Wybór z Ustawień; `auto` bierze Whispera,
 *  gdy zmysły są pod ręką, bo to on rozwiązuje problem sprzężenia. */
function silnikNasluchu() {
  if (voiceMode && silnikSesji) return silnikSesji;
  const wybor = localStorage.getItem('cosmos.sttEngine') || 'auto';
  if (wybor === 'przegladarka' || sttSerweraPadl) return 'przegladarka';
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
   Jeden błąd to przypadek – GPU zajęte innym zadaniem, chwilowa dziura
   w Tailscale. Trzy pod rząd znaczą, że zmysłów po prostu nie ma, a wtedy
   trwanie przy Whisperze to skazanie trybu głosowego na milczenie. */
const NASLUCH_PROG_AWARII = 3;
let nasluchAwarie = 0;

function startNasluchWlasny() {
  if (nasluch) { nasluch.gluchy(voiceDeaf); return; }
  nasluch = window.NasluchWlasny.utworz({
    adres: () => adresStt(voiceState === 'wake' ? 'nasluch' : 'pytanie'),
    // Przy nasłuchu słowa budzącego liczy się tylko najświeższa wypowiedź.
    jednaNaRaz: () => voiceState === 'wake',
    onWypowiedz: (tekst) => { nasluchAwarie = 0; wypowiedzZNasluchu(tekst); },
    onBlad: (err) => {
      // Awaria transkrypcji nie kończy trybu głosowego – następna wypowiedź
      // może się udać (zmysły wstają, GPU zwalnia się po innym zadaniu).
      /* Komputer domowy zasnął w trakcie rozmowy (serwer: „zmysly-offline”):
         przejście na przeglądarkę OD RAZU. Dawniej 10 s „Rozpoznaję…”, dwa
         błędy i zmiana dopiero po trzecim – pytanie przepadało (zespół IT, runda 5). */
      const offline = err.kod === 'zmysly-offline';
      /* Klucz odrzucony albo koniec środków (serwer: „stt-trwaly”) – ponawianie
         da to samo, więc też od razu, z własnym zdaniem (zespół IT, runda 8). */
      const trwaly = err.kod === 'stt-trwaly';
      if (!offline && !trwaly) {
        /* Przy nasłuchu słowa budzącego błąd dotyczy dźwięku z pokoju, o który
           nikt nie pytał – nie ma czego komunikować. Liczymy go tylko. */
        if (voiceState !== 'wake') {
          /* Po kodzie, w języku interfejsu: zdanie serwera jest po polsku
             i w EN wychodziło „Speech recognition failed: usługa odpowiedziała
             błędem…” (copywriter, runda 9). Nieznany błąd – zdanie serwera. */
          komunikatGlosu(err.kod === 'serwer-niedostepny' ? t('voice.sttServer')
            : err.kod === 'stt-blad' ? t('voice.sttBlad')
              : err.status === 413 ? t('voice.sttZaDlugie')
                : t('voice.sttErr', { msg: err.message }));
        }
        if (++nasluchAwarie < NASLUCH_PROG_AWARII) return;
      }
      /* Trzeci raz z rzędu. Przeglądarkowe rozpoznawanie jest gorsze, ale
         DZIAŁA – a Cosmos, który w kółko powtarza ten sam błąd, jest po
         prostu zepsuty. Zmiana jest jawna: człowiek musi wiedzieć, czemu
         nagle zmieniło się zachowanie. */
      nasluchAwarie = 0;
      sttSerweraPadl = true;
      silnikSesji = 'przegladarka';
      if (nasluch) { nasluch.stop(); nasluch = null; }
      const kluczZmiany = offline ? 'voice.sttOfflineSwitch'
        : trwaly ? (err.powod === 'budzet-wyczerpany' ? 'voice.sttBudzetSwitch'   // budżet na płatne modele, nie klucz
          : err.zrodlo === 'wlasny' ? 'voice.sttWlasnySwitch' : 'voice.sttKluczSwitch') : 'voice.sttFallback';
      komunikatGlosu(t(kluczZmiany));
      // Człowiek nie patrzy na ekran – zmianę mówimy głosem systemowym, krótko (także odrzucony klucz – README obiecuje „mówi dlaczego”).
      if ((offline || trwaly) && voiceMode && 'speechSynthesis' in window) {
        try {
          const u = new SpeechSynthesisUtterance(t(kluczZmiany));
          u.lang = getLang() === 'en' ? 'en-US' : 'pl-PL';
          speechSynthesis.speak(u);
        } catch { /* bez głosu systemowego zostaje napis */ }
      }
      /* Na Androidzie ciągłe Web Speech to piszczenie co kilka sekund –
         lepiej kula pod palcem: jedno dotknięcie, jedna sesja. */
      if (voiceMode) {
        if (/Android/i.test(navigator.userAgent)) setVoiceState('push');
        else startVoiceRecognizer();
      }
    },
    onCisza: (powod) => zaradzGluchocie(powod),
    onPoziom: pokazPoziom,
    /* Pytanie domyka dopiero ~1,3 s ciszy. Przy 700 ms zwykła pauza w środku
       zdania („jaka będzie… jutro pogoda”) wysyłała samo „jaka będzie”, a reszta
       szła do kosza, bo Cosmos już głuchł na czas odpowiedzi (agencja, runda 5).
       Nasłuch słowa budzącego zostaje przy 700 ms: tam liczy się szybkość. */
    ciszaMs: () => (voiceState === 'listening' ? 1300 : 700),
    onMowa: zmianaMowy,
    onPodglad: pokazPodglad,
    onRozpoznane: poRozpoznaniu,
    // Podgląd tylko dla pytania: nasłuchu otoczenia nie wysyłamy do chmury.
    podglad: () => voiceMode && voiceState === 'listening' && !voiceDeaf,
    adresPodgladu: () => adresStt('podglad'),
  });
  nasluch.gluchy(voiceDeaf);
  nasluch.start(nasluchOgraniczenia()).catch(async (err) => {
    nasluch = null;
    /* Zapamiętany mikrofon mógł zostać odłączony – tak samo jak przy
       dyktowaniu, spróbuj domyślnego, zanim ogłosisz porażkę. */
    if (localStorage.getItem('cosmos.micId')) {
      localStorage.removeItem('cosmos.micId');
      startNasluchWlasny();
      return;
    }
    komunikatGlosu(t('voice.micDenied', { msg: err.message }));
    // Nakładka zostaje żywa (Escape i ✕ działają), kula czeka na dotknięcie.
    if (voiceMode) setVoiceState('push');
  });
}

/* ---- CICHA GŁUCHOTA I CO Z NIĄ ZROBIĆ --------------------------------
   Najgorsza awaria trybu głosowego nie jest głośna: mikrofon przestaje dawać
   próbki, a ekran dalej pokazuje „SŁUCHAM…". Marcin mówi do telefonu i nie
   ma pojęcia, dlaczego nic się nie dzieje. `nasluch.js` wykrywa ten stan
   z trzech stron (stan kontekstu, zdarzenia ścieżki, licznik od ostatniej
   ramki) – tutaj jest odpowiedź na pytanie, co dalej.

   Najpierw PRÓBUJEMY ODZYSKAĆ, bo dwie z trzech przyczyn (uśpiony dźwięk po
   wygaszeniu ekranu, mikrofon oddany na czas rozmowy telefonicznej) mijają
   same i wystarczy wziąć wejście od nowa. Dopiero gdy to nie pomoże, mówimy
   wprost – jedna próba, nie pętla wznowień co dwie sekundy. */
let odzyskiwanieMikrofonu = null;

function zaradzGluchocie(powod) {
  if (!voiceMode || odzyskiwanieMikrofonu) return;
  komunikatGlosu(t('voice.micLost', { powod }));
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
      else komunikatGlosu(t('voice.micDead', { powod }));
    }, 2500);
  }, 1500);
}

/** Gotowa wypowiedź z Whispera. W odróżnieniu od Web Speech API nie ma tu
 *  wyników cząstkowych ani odliczania ciszy – VAD już zdecydował, że zdanie
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
  el.voiceTranscript.classList.remove('podglad', 'komunikat');
  el.voiceTranscript.textContent = czyste;
  askVoice(czyste);
}

/** Stan „słucham pytania" z własnym odliczaniem powrotu.
 *  Bez tego Cosmos zostawałby w nasłuchu pytania w nieskończoność, gdyby
 *  ktoś powiedział „Hej, Kosmos" i się rozmyślił. */
function czekajNaPytanie() {
  setVoiceState('listening');
  el.voiceTranscript.classList.remove('podglad', 'komunikat');
  el.voiceTranscript.textContent = '';
  czekajDalej();
}

/* Mikrofon nie zamyka się w połowie zdania. Dawniej termin mijał bez względu
   na to, co się działo: kto zaczął mówić w ósmej sekundzie, tracił zdanie
   i „mówię, a on nic nie robi". Teraz termin czeka, dopóki trwa mowa albo
   rozpoznawanie. Samego terminu mowa NIE przesuwa, bo wtedy szum w tle
   (wentylator, telewizor) trzymałby mikrofon otwarty bez końca. */
/* Twardy sufit: nawet przy ciągłym szumie (telewizor, wentylator, który VAD
   bierze za mowę) słuchanie kończy się najpóźniej 20 s po terminie. */
const NASLUCH_SUFIT_MS = 20000;
let nasluchSufit = 0;
function czekajDalej(ms = NASLUCH_CISZA_MS) {
  clearTimeout(nasluchCisza);
  if (ms === NASLUCH_CISZA_MS) nasluchSufit = Date.now() + NASLUCH_CISZA_MS + NASLUCH_SUFIT_MS;
  nasluchCisza = setTimeout(() => {
    if (!voiceMode || voiceState !== 'listening') return;
    if (nasluchZajety() && Date.now() < nasluchSufit) { czekajDalej(400); return; }
    backToWake();
  }, ms);
}

/** Jedno miejsce na zmianę „czy reagujemy na to, co słychać".
 *  Przy własnym strumieniu to naprawdę wycisza wejście; przy Web Speech API
 *  zostaje starym znacznikiem, bo tam wyciszyć się nie da. */
function ustawGluchote(wlacz) {
  voiceDeaf = Boolean(wlacz);
  if (nasluch) nasluch.gluchy(voiceDeaf);
}

/** Zapamiętaj, że wszystko do `doIndeksu` już przerobiliśmy. */
function oznaczZuzyte(wyniki, doIndeksu) {
  voiceZuzyteDo = doIndeksu;
  voiceOdcisk = doIndeksu > 0 ? odciskWyniku(wyniki, doIndeksu - 1) : '';
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
      // Głuchy nie znaczy „nie słyszy" – znaczy „nie reaguje". Wszystko, co
      // wpadło w tym czasie (czyli głos samego Cosmosa), znika z rozważań.
      oznaczZuzyte(e.results, e.results.length);
      return;
    }

    if (voiceState === 'wake') {
      /* To samo scalanie, co niżej: przy wznawianych sesjach słowo budzące
         wraca w kilku coraz dłuższych wersjach i gołe złączenie dawało
         „Hej kosmosHej kosmos Co widzisz". */
      let latest = '';
      for (let i = Math.max(0, voiceZuzyteDo); i < e.results.length; i++) {
        latest = doklejRozpoznane(latest, e.results[i][0].transcript);
      }
      /* PRYWATNOŚĆ. Dawniej samo „Hej, Cosmos” wysyłało do modelu to, co padło
         w pokoju PRZED nim („jutro pogoda”), bo sklejaliśmy wszystkie wyniki,
         a te bez słowa budzącego nie były oznaczane jako zużyte (agencja,
         runda 5). Wyniki ostateczne bez słowa budzącego zużywamy od razu,
         a pytaniem jest tylko tekst PO ostatnim słowie budzącym. */
      const wzorzec = new RegExp(WAKE_RE.source, WAKE_RE.flags.includes('g') ? WAKE_RE.flags : WAKE_RE.flags + 'g');
      let ostatnie = null;
      for (const m of latest.matchAll(wzorzec)) ostatnie = m;
      if (!ostatnie) {
        let k = Math.max(0, voiceZuzyteDo);
        while (k < e.results.length && e.results[k].isFinal) k++;
        if (k > voiceZuzyteDo) oznaczZuzyte(e.results, k);
        return;
      }
      const after = bezSlowaBudzacego(latest.slice(ostatnie.index + ostatnie[0].length).replace(/^[\s,.!?]+/, ''));
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
      /* SCALAMY, NIE DOKLEJAMY.
         Chrome na Androidzie nie obsługuje `continuous` – kończy sesję po
         każdej wypowiedzi i po każdej ciszy. Wznowiona sesja rozpoznaje od
         nowa audio, które częściowo już słyszeliśmy, więc gołe `+=` dawało
         „Jakiejakiejakie sąjakie są największe…". `doklejRozpoznane` widzi
         zakładkę i zostawia dłuższą wersję zamiast obu. */
      if (r.isFinal) {
        voiceHeard = doklejRozpoznane(voiceHeard, r[0].transcript);
        oznaczZuzyte(e.results, i + 1);
      } else {
        interim = doklejRozpoznane(interim, r[0].transcript);
      }
    }
    if (!voicePoczatekWypowiedzi) voicePoczatekWypowiedzi = Date.now();
    el.voiceTranscript.textContent = doklejRozpoznane(voiceHeard, interim);
    ustawPodstan('slysze');

    // Rozpoznawacz jest ciągły, więc sam nie zasygnalizuje końca pytania.
    // Kończymy po chwili ciszy od ostatniego usłyszanego słowa.
    clearTimeout(voiceSilence);
    voiceSilence = setTimeout(() => {
      if (!voiceMode || voiceState !== 'listening') return;
      /* Ostatnia zapora przed „HejHejHej kosmos Co widzisz": gdyby słowo
         budzące zdążyło wpaść do pytania – obojętne, czy przez opóźnione
         rozpoznanie, czy przez restart numeracji – tu i tak wypada. */
      const text = bezSlowaBudzacego(voiceHeard);
      voiceHeard = '';
      if (text) askVoice(text);
      else backToWake();
      voicePoczatekWypowiedzi = 0;
    }, 1400);
  };

  // Chrome i tak utnie sesję po ~60 s – wznawiamy ten sam obiekt.
  rec.onend = () => {
    voiceRec = null;
    // Nowa sesja zaczyna liczyć wyniki od zera, więc znacznik też musi.
    oznaczZuzyte(null, 0);
    if (!voiceMode) return;
    /* Sesja, która skończyła się bez ani jednego wyniku, była jałowa –
       czyli mikrofon piszczał po nic. Patrz komentarz przy
       WZNOWIEN_ZANIM_PRZYCISK. */
    if (!rec.__ostatniaDlugosc) wznowienJalowych++;
    else wznowienJalowych = 0;
    if (voiceState === 'push') return;
    /* Android: Chrome kończy sesję po każdej wypowiedzi i ciszy, a każde
       wznowienie to dźwięk mikrofonu. Po odpowiedzi było ich 11 w 60 s
       (agencja, runda 5). Jedna sesja: co usłyszała, idzie; nic, to kula. */
    if (/Android/i.test(navigator.userAgent)) {
      const tekst = bezSlowaBudzacego(voiceHeard);
      voiceHeard = '';
      clearTimeout(voiceSilence);
      if (voiceState === 'listening' && tekst) askVoice(tekst);
      else setVoiceState('push');
      voicePoczatekWypowiedzi = 0;
      return;
    }
    if (wznowienJalowych >= WZNOWIEN_ZANIM_PRZYCISK) { nasluchNaPrzycisk(); return; }
    setTimeout(() => { if (voiceMode && voiceState !== 'push') startVoiceRecognizer(); }, 250);
  };
  rec.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      voiceRec = null;
      komunikatGlosu(t('voice.micDenied', { msg: ev.error }));
      if (voiceMode) setVoiceState('push');
      return;
    }
    /* „no-speech" i „aborted" to normalny bieg rzeczy – onend wznowi */
  };

  try { rec.start(); } catch { /* już wystartował */ }
}

function backToWake() {
  if (!voiceMode) return;
  clearTimeout(voiceSilence);
  clearTimeout(nasluchCisza);
  voiceHeard = '';
  if (trybRozmowy()) {
    /* Bez lokalnego Whispera nie słuchamy otoczenia – mikrofon się zamyka
       (bez żadnego dźwięku: to zwykły strumień audio, nie rozpoznawanie
       przeglądarki), a kula czeka na dotknięcie. */
    if (nasluch) { nasluch.stop(); nasluch = null; }
    ustawGluchote(false);
    setVoiceState('push');
    el.voiceTranscript.textContent = '';
    return;
  }
  if (voiceRec && voiceRec.__ostatniaDlugosc) {
    oznaczZuzyte(voiceRec.__ostatnieWyniki, voiceRec.__ostatniaDlugosc);
  }
  ustawGluchote(false);
  // Android nie utrzyma nasłuchu słowa budzącego bez ciągłego piszczenia.
  if (/Android/i.test(navigator.userAgent) && silnikNasluchu() === 'przegladarka') {
    if (voiceRec) { try { voiceRec.abort(); } catch { /* już zamknięty */ } voiceRec = null; }
    setVoiceState('push');
    el.voiceTranscript.textContent = '';
    return;
  }
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
     sam powiedział – nie odpowiadamy na własne słowa. */
  /* Tylko przy rozpoznawaniu przeglądarki (jedyne, które słyszy własny głos
     Cosmosa) i tylko tuż po jego wypowiedzi. Dawniej zapora działała zawsze
     i połykała zwykłe dopytanie, które powtarza słowa z odpowiedzi: „A jutro
     będzie pogoda?” po „Jutro będzie ładna pogoda…” znikało bez śladu
     (agencja, runda 5). Własny strumień jest głuchy, gdy Cosmos mówi. */
  /* Odpowiedź na pytanie o zgodę omija tę zaporę: pytanie kończy się listą
     odpowiedzi, więc „Tak, ale tylko lokalnie” miało >70% jego słów i przepadało
     jako echo. Echo pytania o zgodę odsiewa węziej zgodaGlosem.odpowiedz. */
  if (zgodaGlosem) { ustawGluchote(true); handleVoiceQuery(text); return; }
  const echoMozliwe = silnikNasluchu() === 'przegladarka' && Date.now() - voiceKoniecMowienia < 4000;
  if (echoMozliwe && voiceOstatniaOdpowiedz && toSamoZdanie(text, voiceOstatniaOdpowiedz)) {
    backToWake();
    return;
  }
  ustawGluchote(true);
  handleVoiceQuery(text);
}


// Nazwy używane w pozostałej części pliku – zostawiamy je jako cienkie przejścia,
// żeby nie rozsypać wywołań rozsianych po trybie głosowym.
function startWakeListening() { backToWake(); }
function startQueryListening() {
  if (!voiceMode) return;
  voiceHeard = '';
  voicePoczatekWypowiedzi = 0;
  // Wracamy do słuchania dopiero teraz – wszystko sprzed tej chwili to był
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
  const kinect = $('voice-kinect');
  const zKinecta = Boolean(voiceKinectStop);
  const zrodlo = zKinecta ? kinect : el.voiceCamera;
  const w = zKinecta ? kinect.naturalWidth : zrodlo.videoWidth;
  const h = zKinecta ? kinect.naturalHeight : zrodlo.videoHeight;
  if ((!voiceCameraStream && !zKinecta) || !w) return null;
  const canvas = document.createElement('canvas');
  const maxDim = 1024;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(zrodlo, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Dłonie na klatce z pytania głosowego → zdarzenie w kontekście percepcji,
 *  zanim pytanie pójdzie do modelu. Bez tego model widział obraz (albo i nie –
 *  Nemotron nie jest wizyjny) i odpowiadał „nie mogę określić liczby palców”. */
async function dlonieNaKlatce(klatka) {
  if (!klatka || !(senses.online && senses.caps.dlonie)) return;
  try {
    const r = await fetch('/api/dlonie', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: klatka }), signal: AbortSignal.timeout(8000),
    });
    const d = await readJsonSafe(r);
    if (!r.ok || !d.summary) return;
    await fetch('/api/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'dlonie', summary: d.summary }),
    });
  } catch { /* bez dłoni pytanie i tak idzie */ }
}

const NOTE_START_RE = /\b(nowa notatka|nagraj notatk[ęe]|(zacznij|rozpocznij|start)\s+(nagrywanie|nagrywa[ćc]|notatk[ęe]|dyktowanie)|new note|start (a )?note|start recording)\b/i;
const NOTE_STOP_RE = /\b((koniec|zako[nń]cz|stop|zapisz)\s+(notatk[ęei]|nagrywani[ae]|dyktowani[ae])|(end|stop|save)\s+(note|recording))\b/i;

async function handleVoiceQuery(text) {
  /* Cosmos czeka na odpowiedź o zgodę na chmurę dla zespołu – to nie jest
     nowe pytanie (i nie przerywa tury, która na tę odpowiedź czeka). */
  if (zgodaGlosem) { zgodaGlosem.odpowiedz(text); return; }
  el.voiceTranscript.classList.remove('podglad', 'komunikat');
  el.voiceTranscript.textContent = text;
  /* Pytanie głosowe w trakcie pisanej odpowiedzi uruchamiało drugą generację
     obok pierwszej – obie lądowały w rozmowie na krzyż i obie były czytane. */
  if (isGenerating) {
    stopGeneration();
    for (let i = 0; i < 50 && isGenerating; i++) await pauza(100);
  }

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
  if (VISUAL_RE.test(text)) {
    frame = captureVoiceFrame();
    await dlonieNaKlatce(frame);
  }

  const conv = ensureConversation(text);
  const content = frame ? { text, images: [frame], klatka: true } : text;
  conv.messages.push({ role: 'user', content });
  saveConversations();
  renderSidebar();
  renderMessages();

  await runGeneration(conv); // po odpowiedzi wróci do słuchania (finally)
}

el.voiceBtn.addEventListener('click', enterVoiceMode);
// Trzy przyciski zgody na scenie (to samo co odpowiedź głosem).
$('voice-zgoda')?.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-zgoda]');
  if (b && zgodaGlosem) { stopSpeaking(); zgodaGlosem.wybierz(b.dataset.zgoda); }
});
el.voiceClose.addEventListener('click', exitVoiceMode);

/* Kula jest przyciskiem ZAWSZE, nie tylko po przejściu na „naciśnij".
   Nawet gdy nasłuch działa, czekanie na słowo budzące bywa wolniejsze niż
   dotknięcie ekranu – a w trybie „naciśnij" to jedyna droga do zadania
   pytania. Kolejne dotknięcie w trakcie słuchania kończy wypowiedź. */
el.voiceOrb.addEventListener('click', () => {
  if (!voiceMode) return;
  /* Dotknięcie w trakcie odpowiedzi przerywa ją i od razu słucha – jak
     w asystentach w telefonie. Dawniej kula była wtedy martwa i trzeba było
     wysłuchać całej odpowiedzi, żeby coś poprawić. Koniec czytania sam
     przełącza na słuchanie (runGeneration → startQueryListening). */
  if (voiceState === 'speaking') { stopSpeaking(); return; }
  if (voiceState === 'listening' && nasluch) {
    // Własny nasłuch: dotknięcie w trakcie mowy kończy wypowiedź od razu.
    if (nasluch.zakoncz() || nasluch.rozpoznaje()) return;
    clearTimeout(nasluchCisza);
    backToWake();
    return;
  }
  if (voiceState === 'listening') {
    const tekst = bezSlowaBudzacego(usłyszaneWPolu());
    clearTimeout(voiceSilence);
    voiceHeard = '';
    if (tekst) askVoice(tekst); else backToWake();
    return;
  }
  if (voiceState === 'thinking') return;
  nasluchRaz();
});

// ----------------------------------------------------------------
// Escape zamyka wierzchnią warstwę
// ----------------------------------------------------------------

// Każda nakładka zamyka się swoją funkcją, bo część z nich musi jeszcze
// posprzątać: zwolnić kamerę, zatrzymać detekcję, zapisać stan.
// Kolejność od wierzchu: to, co otwiera się na innych, jest wyżej.
const overlays = [
  // podgląd obrazu jest na samym wierzchu – otwiera się z galerii i z rozmowy
  { id: 'img-viewer', close: closeImageViewer },
  { open: () => voiceMode, close: exitVoiceMode },
  { id: 'camera-modal', close: closeCamera },
  /* Okienko kamery (tryb „mini”) nie jest modalne: nie przechwytuje Esc,
     gdy otwarte jest inne okno (Esc zamykał kamerę, a Ustawienia zostawały)
     ani gdy fokus jest poza nim (Esc w polu wiadomości zamykał kamerę) –
     obsługa na końcu listy niżej (agencja, runda 9). */
  { open: () => $('live-panel').style.display !== 'none' && $('live-panel').dataset.tryb !== 'mini', close: stopLive },
  { id: 'gallery-modal', close: closeGallery },
  { id: 'timeline-modal', close: () => { $('timeline-modal').style.display = 'none'; } },
  { id: 'learn-modal', close: () => closeLearn() },   // public/nauka-widok.js, powstaje niżej
  { id: 'kb-modal', close: () => { el.kbModal.style.display = 'none'; } },
  { id: 'studio-modal', close: () => { el.studioModal.style.display = 'none'; } },
  { id: 'plener-modal', close: zamknijPlener },
  { id: 'settings-modal', close: closeSettings },
];

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const top = overlays.find((o) => (o.open ? o.open() : $(o.id).style.display !== 'none'));
  if (top) {
    e.preventDefault();
    top.close();
    return;
  }
  // Okienko kamery zamyka Esc tylko wtedy, gdy człowiek jest w nim (fokus na jego przycisku).
  if ($('live-panel').style.display !== 'none' && $('live-panel').contains(document.activeElement)) {
    e.preventDefault();
    stopLive();
    return;
  }
  // Płótno nie jest nakładką (stoi obok rozmowy), ale Escape też je zamyka.
  if (!$('canvas').hidden && !el.input.matches(':focus')) { e.preventDefault(); $('canvas').hidden = true; }
});

/* ---- KARTY USTAWIEŃ -------------------------------------------------------
   Prawdziwe zakładki (wzorzec WAI-ARIA Tabs): widać tylko wybraną grupę.
   Dawniej karty przewijały jedną długą kolumnę, a bloki różnych grup były
   w HTML-u przeplecione – podświetlenie skakało „nie w kolejności”, a pod
   „Nasłuchem” stała „Instrukcja systemowa” (Marcin, runda 8). Karta bez
   żadnej widocznej sekcji (np. „Dom” u zaproszonej osoby) znika. Ostatnia
   karta zostaje zapamiętana na tym urządzeniu. */
const kartyUstawien = (() => {
  const modal = $('settings-modal');
  const cialo = modal && modal.querySelector('.modal-body');
  if (!cialo) return { odswiez() {}, pokaz() {} };
  const karty = [...cialo.querySelectorAll('.set-karty [role="tab"]')];
  const panel = (g) => $(`set-panel-${g}`);
  /* Widoczność liczona od sekcji w górę do panelu – panel może być w tej
     chwili ukryty, więc offsetParent nic tu nie powie. */
  const widoczna = (sekcja, p) => {
    for (let x = sekcja; x && x !== p; x = x.parentElement) if (getComputedStyle(x).display === 'none') return false;
    return true;
  };
  const maTresc = (g) => {
    const p = panel(g);
    return Boolean(p) && [...p.querySelectorAll('[data-karta]')].some((s) => widoczna(s, p));
  };
  let biezaca = null;
  /* Karta wybrana w TYM otwarciu (kliknięcie, klawiatura, openSettings('…')).
     Zapasowa – pokazana, bo wybrana jest jeszcze ukryta – nie jest wyborem:
     Konto odsłania się dopiero po /api/auth, a Ustawienia otwarte wcześniej
     startowały na „Zmysłach” i ZAPAMIĘTYWAŁY je na stałe (agencja, runda 9).
     Do pamięci urządzenia trafia tylko wybór człowieka. */
  let wybrana = null;
  function pokaz(g, { fokus = false, wybor = false, zapisz = false } = {}) {
    const k = karty.find((x) => x.dataset.cel === g && !x.hidden) || karty.find((x) => !x.hidden);
    if (!k) return;
    if (wybor) wybrana = g;
    biezaca = k.dataset.cel;
    for (const x of karty) {
      const tak = x === k;
      x.classList.toggle('aktywna', tak);
      x.setAttribute('aria-selected', String(tak));
      x.tabIndex = tak ? 0 : -1;
      const p = panel(x.dataset.cel);
      if (p) p.hidden = !tak;
    }
    cialo.scrollTop = 0;
    // Na telefonie pasek kart przewija się w bok – wybrana ma być w zasięgu.
    k.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (fokus) k.focus();
    if (zapisz && biezaca === g) { try { localStorage.setItem('cosmos.kartaUstawien', biezaca); } catch { /* bez pamięci */ } }
  }
  function odswiez() {
    for (const k of karty) k.hidden = !maTresc(k.dataset.cel);
    const zapamietana = (() => { try { return localStorage.getItem('cosmos.kartaUstawien'); } catch { return null; } })();
    const cel = wybrana || zapamietana || 'konto';
    const k = karty.find((x) => x.dataset.cel === cel);
    const b = karty.find((x) => x.dataset.cel === biezaca);
    // Cel właśnie się odsłonił, a stoi karta zastępcza – wracamy do celu.
    if (k && !k.hidden && biezaca !== cel) pokaz(cel);
    else if (!b || b.hidden) pokaz(cel);
  }
  for (const k of karty) {
    k.addEventListener('click', () => pokaz(k.dataset.cel, { wybor: true, zapisz: true }));
    k.addEventListener('keydown', (e) => {
      const widoczne = karty.filter((x) => !x.hidden);
      const i = widoczne.indexOf(k);
      const skok = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      let cel = null;
      if (skok) cel = widoczne[(i + skok + widoczne.length) % widoczne.length];
      else if (e.key === 'Home') cel = widoczne[0];
      else if (e.key === 'End') cel = widoczne[widoczne.length - 1];
      if (!cel) return;
      e.preventDefault();
      pokaz(cel.dataset.cel, { fokus: true, wybor: true, zapisz: true });
    });
  }
  new MutationObserver(() => {
    if (modal.style.display !== 'none') odswiez();
    else { wybrana = null; biezaca = null; }   // następne otwarcie zaczyna od zapamiętanej
  }).observe(modal, { attributes: true, attributeFilter: ['style'] });
  /* Sekcje Konta odsłaniają się dopiero po odpowiedzi serwera, a klasa roli
     (członek/właściciel) przychodzi później niż samo okno. */
  new MutationObserver((zmiany) => {
    if (modal.style.display === 'none') return;
    if (zmiany.some((z) => !z.target.closest('.set-karty') && !z.target.classList?.contains('set-panel'))) odswiez();
  }).observe(cialo, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  return { odswiez, pokaz };
})();

/* Przełączniki w Ustawieniach działają od razu – nie czekają na „Zapisz”. */
$('set-offline').addEventListener('change', (e) => { settings.offline = e.target.checked; saveSettings(); });
$('set-timemachine').addEventListener('change', (e) => { settings.timeMachine = e.target.checked; saveSettings(); updateLiveRec(); });
$('set-speak').addEventListener('change', (e) => {
  settings.speak = e.target.checked;
  saveSettings();
  pokazGlosnik();
  if (!settings.speak) stopSpeaking();
});

/* ---- FOKUS W NAKŁADKACH -------------------------------------------------
   Z klawiatury nakładki były nieużywalne: fokus nie wchodził do środka,
   Tab uciekał do rozmowy pod spodem (15–29 razy na 30), a po Escape nie
   wracał na przycisk, którym nakładkę otwarto. Zamiast łatać każdą z osobna:
   obserwujemy, która jest na wierzchu – reszta strony dostaje `inert`,
   fokus wchodzi do środka, a po zamknięciu wraca tam, skąd przyszedł. */
{
  /* Kamera jest modalna tylko na pełnym ekranie. W okienku (data-tryb="mini")
     stoi OBOK rozmowy: z pułapką fokusu blokowałaby pisanie i przewijanie,
     a gesty „przewiń” i „wyślij” działają właśnie wtedy (zespół IT, runda 7). */
  const elementy = ['img-viewer', 'voice-overlay', 'live-panel', 'camera-modal', 'gallery-modal',
    'timeline-modal', 'learn-modal', 'kb-modal', 'studio-modal', 'plener-modal', 'settings-modal']
    .map((id) => $(id)).filter(Boolean);
  const widoczna = (w) => w.style.display !== 'none' && !w.hidden && !(w.id === 'live-panel' && w.dataset.tryb === 'mini');
  const skad = new Map();
  let poprzednio = new Set();
  const FOKUSOWALNE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), '
    + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const przelicz = () => {
    const otwarte = elementy.filter(widoczna);
    const wierzch = otwarte[0] || null;          // kolejność tablicy = kolejność od wierzchu
    for (const dziecko of document.body.children) {
      if (dziecko.tagName === 'SCRIPT') continue;
      dziecko.inert = Boolean(wierzch) && dziecko !== wierzch;
    }
    for (const w of otwarte) {
      if (poprzednio.has(w)) continue;
      skad.set(w, document.activeElement);
      if (!w.getAttribute('role')) w.setAttribute('role', 'dialog');
      w.setAttribute('aria-modal', 'true');
      requestAnimationFrame(() => {
        if (w.contains(document.activeElement)) return;
        const cel = w.querySelector('[autofocus]') || w.querySelector(FOKUSOWALNE);
        if (cel) cel.focus({ preventScroll: true });
      });
    }
    for (const w of poprzednio) {
      if (otwarte.includes(w)) continue;
      const wroc = skad.get(w);
      skad.delete(w);
      if (!otwarte.length && wroc && document.contains(wroc) && typeof wroc.focus === 'function') wroc.focus({ preventScroll: true });
    }
    poprzednio = new Set(otwarte);
    // Okienko kamery to nie okno dialogowe – czytnik ekranu nie może go tak ogłaszać.
    const kam = $('live-panel');
    if (kam && !otwarte.includes(kam)) kam.removeAttribute('aria-modal');
    // Okienko to obszar strony obok rozmowy, pełny ekran – okno dialogowe.
    if (kam) kam.setAttribute('role', kam.dataset.tryb === 'mini' ? 'region' : 'dialog');
    /* Animacje powitania (zorza, gradient nagłówka) pod nakładką z rozmyciem
       tła wymuszały przeliczanie rozmycia co klatkę: Ustawienia 10 kl./s na
       komputerze, karty 2–4× wolniej (zespół IT, runda 9). Klasa na <html>
       pauzuje je w CSS, dopóki coś zasłania powitanie – także kamera na
       pełnym ekranie i tryb głosowy. */
    document.documentElement.classList.toggle('pod-nakladka', Boolean(wierzch));
  };
  const obserwator = new MutationObserver(przelicz);
  for (const w of elementy) obserwator.observe(w, { attributes: true, attributeFilter: ['style', 'hidden', 'data-tryb'] });
}

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
// na telefonie panel przykrywa czat – dotknięcie przyciemnionego tła go zamyka
$('sidebar-scrim').addEventListener('click', closeSidebar);
$('offline-retry').addEventListener('click', retryConnection);
// powrót sieci (np. Wi-Fi/Tailscale) – sprawdź od razu, nie czekaj 30 s
window.addEventListener('online', retryConnection);

// wyszukiwarka rozmów – po tytule (natychmiast) i po treści (z serwera)
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
    } catch { /* offline – zostaje filtr po tytule */ }
  }, 300);
});

// eksport aktywnej rozmowy do Markdown
function exportConversation() {
  const conv = activeConv();
  if (!conv || !conv.messages.length) return;
  const lines = [`# ${conv.title || 'Cosmos'}`, ''];
  // Stary plan pokrojony siatkami – jak na ekranie: jedna odpowiedź, jedna linia o zdjęciach.
  for (const { m } of jednostkiRozmowy(conv.messages)) {
    if (m.error) continue;
    const who = m.role === 'user' ? t('exportYou') : 'Cosmos';
    if (m.search) continue;
    /* WIADOMOŚĆ BEZ TREŚCI NIE MA CO ROBIĆ W ZAPISIE.
     *
     *  Siatka miniatur to wiadomość z pustym tekstem i listą zdjęć. Eksport
     *  wypisywał dla niej sam nagłówek „**Cosmos:**" i pustą linię – a zdjęć
     *  nie wspominał w ogóle. W przysłanych przez Marcina zapisach widać
     *  przez to puste dymki w miejscach, gdzie w rozmowie były zdjęcia:
     *  zapis wyglądał gorzej niż sama rozmowa i sugerował, że Cosmos
     *  odpowiedział niczym.
     *
     *  To jest o tyle istotne, że po tych plikach ocenia się jakość rozmów. */
    const tekst = msgText(m);
    const imgs = msgImages(m);
    const foty = msgPhotos(m);
    /* Zdjęcia z sieci: JEDNA linia na odpowiedź, z nazwami miejsc – zapis mówi,
       co było na zdjęciach, a nie „8 × zdjęcie w rozmowie” pod każdym punktem. */
    const grupy = (Array.isArray(m.zdjecia) ? m.zdjecia : []).filter((g) => g.stan === 'gotowe' && (g.photos || []).length);
    if (!tekst && !imgs.length && !foty.length && !grupy.length) continue;
    lines.push(`**${who}:**`, '');
    // Zastąpione wersje (K6) – jedna linijka bez treści, jak zwinięta na ekranie.
    for (const p of Array.isArray(m.poprzednie) ? m.poprzednie : []) {
      lines.push(`> _${t(p.powod === 'bez-zespolu' ? 'wersja.bezZespolu' : p.powod === 'szkic' ? 'wersja.szkic' : 'wersja.poprzednia')}`
        + ` (${t('doc.chars', { n: String(p.content || '').length })}) – ${t('wersja.zwinieta')}_`, '');
    }
    if (tekst) lines.push(tekst, '');
    if (grupy.length) {
      lines.push(`_(${t('export.zdjecia', { n: grupy.reduce((s, g) => s + g.photos.length, 0), miejsca: grupy.map((g) => g.etykieta || g.q).join(', ') })})_`, '');
    }
    // Miniatury z archiwum (własne pliki) – jak dotąd.
    if (foty.length) lines.push(`_(${t('export.photos', { n: foty.length })})_`, '');
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
  /* Pasek „streszczam…" W ROZMOWIE – dawniej nic nie mówiło, że coś trwa.
     I zapis do TEJ rozmowy, nawet gdy człowiek w międzyczasie przeszedł do
     innej: saveConversations zapisuje aktywną, więc streszczenie przepadało. */
  const pasek = { role: 'assistant', content: t('sum.working'), status: true };
  conv.messages.push(pasek);
  renderMessages({ przewin: sledzeDol });
  const utrwal = () => {
    if (activeConversation && activeConversation.id === conv.id) { saveConversations(); renderMessages({ przewin: sledzeDol }); return; }
    conv.updatedAt = Date.now();
    try { localStorage.setItem('cosmos.conv.' + conv.id, JSON.stringify(doZapisu(conv))); } catch { /* limit */ }
    zapiszNaSerwerze(conv.id, conv);
  };
  try {
    const res = await fetch('/api/summarize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, endpoint, model: currentModel() || undefined }),
    });
    const d = await readJsonSafe(res);
    if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
    Object.assign(pasek, { content: `**${t('summarize')}:**\n\n${d.summary}`, status: false, ...znakSilnika() });
    utrwal();
    if (settings.speak) speakText(d.summary);
  } catch (err) {
    Object.assign(pasek, { content: `⚠︎ ${t('sum.failed')}: ${err.message}`, status: false, error: true });
    utrwal();
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
  if (mod && e.key.toLowerCase() === 'k') {           // Ctrl/Cmd+K – szukaj rozmów
    e.preventDefault();
    if (el.sidebar.classList.contains('collapsed')) el.expandBtn.click();
    $('conv-search').focus();
    $('conv-search').select();
  } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { // Ctrl/Cmd+Shift+O – nowa rozmowa
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
  document.querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', dark ? '#111214' : '#F6F5F1'));
}

/* Bez zapisanego wyboru motyw idzie za systemem – tak jak strona produktowa.
   Ten sam wybór robi już skrypt w <head>, żeby nie mignęło złe tło. */
function motywDomyslny() {
  try {
    const zapisany = localStorage.getItem(STORAGE_KEYS.theme);
    if (zapisany === 'dark' || zapisany === 'light') return zapisany;
  } catch { /* tryb prywatny */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

el.themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

applyTheme(motywDomyslny());

// przełącznik języka (PL ↔ EN)
el.langBtn = $('lang-btn');
el.langBtn.addEventListener('click', () => {
  setLang(getLang() === 'pl' ? 'en' : 'pl');
  // odśwież teksty budowane dynamicznie w JS
  applyTheme(document.documentElement.dataset.theme || motywDomyslny());
  buildEndpointTabs();
  updateModelBadge();
  renderSidebar();
  renderMessages();
  refreshStatus();
  pokazGlosnik();
});

const ENDPOINT_TABS = {
  cloud: ['Chmura', '<svg viewBox="0 0 24 24"><path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 12.4 3.5 3.5 0 0 0 6.5 19z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
  local: ['Lokalnie', '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'],
  openai: ['OpenAI', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>'],
  claude: ['Claude', '<svg viewBox="0 0 24 24"><path d="M12 3l2.2 6.8H21l-5.4 4 2 6.9-5.6-4.2-5.6 4.2 2-6.9-5.4-4h6.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'],
};

/* Zakładki rysujemy od razu, z listy zapamiętanej przy poprzedniej wizycie,
   a po /api/config – z prawdziwej. Pusty przełącznik rósł po konfiguracji
   i cały czat skakał o 13,4 px (CLS 0,087 z samego tego skoku). */
function buildEndpointTabs(zPamieci = null) {
  el.endpointSwitch.innerHTML = '';
  const available = [];
  for (const key of Object.keys(ENDPOINT_TABS)) {
    if (zPamieci) {
      if (!zPamieci.includes(key)) continue;
    } else {
      const ep = serverConfig.endpoints?.[key];
      if (!ep) continue;
      if ((key === 'openai' || key === 'claude') && !ep.hasApiKey) continue;
    }
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
  if (!zPamieci) {
    try { localStorage.setItem('cosmos.zakladki', JSON.stringify(available)); } catch { /* bez pamięci */ }
  }
  setEndpoint(available.includes(endpoint) ? endpoint : 'cloud');
}

function setEndpoint(name) {
  if (typeof zamknijListeModeli === 'function') zamknijListeModeli();
  endpoint = name;
  localStorage.setItem(STORAGE_KEYS.endpoint, name);
  document.documentElement.dataset.silnik = name;   // kolor nici, obwódki pola i kropki modelu
  document.querySelectorAll('.endpoint-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.endpoint === name);
  });
  updateModelBadge();
  // Zakładka silnika, który ostatnio „nie odpowiadał” – sprawdzamy od razu, nie za 30 s.
  if (stanSilnikow[name] === 'offline' || stanSilnikow[name] === 'nieznany') odswiezStanGdyTrzeba(name);
}

// ----------------------------------------------------------------
// Ustawienia (modal)
// ----------------------------------------------------------------

/** Otwiera Ustawienia; `karta` (np. 'silniki') od razu na właściwej zakładce. */
function openSettings(karta) {
  konta_.odswiez().catch(() => { /* panel konta nie może zablokować Ustawień */ });
  for (const ep of SILNIKI_Z_MODELEM) $(`set-model-${ep}`).value = nadpisanieModelu(ep);
  el.setSystem.value = settings.systemPrompt;
  el.setTemp.value = settings.temperature;
  el.tempValue.textContent = settings.temperature;
  el.setMaxTokens.value = settings.maxTokens;
  for (const ep of SILNIKI_Z_MODELEM) $(`model-select-${ep}`).style.display = 'none';
  refreshModelInfoBoxes();
  loadMicList();
  odswiezWyborNasluchu();
  renderConfigInfo();
  rysujUstawieniaZespolu();
  loadMemoryList();
  fetch('/api/profile').then((r) => r.json()).then((d) => { $('set-profile').value = d.profile || ''; }).catch(() => {});
  komunikatLokalizacji('');
  fetch('/api/location').then((r) => r.json()).then((d) => { $('set-location').value = d.location || ''; }).catch(() => {});
  $('set-offline').checked = Boolean(settings.offline);
  $('set-timemachine').checked = Boolean(settings.timeMachine);
  loadStats();
  loadTrainStats();
  loadDevices();
  $('brief-auto').checked = Boolean(settings.briefAuto);
  $('brief-time').value = settings.briefTime || '08:00';
  el.settingsModal.style.display = '';
  if (typeof karta === 'string') kartyUstawien.pokaz(karta, { wybor: true });
  pokazWersje();
}

/* Wersja kodu i pamięci aplikacji – po wdrożeniu widać, czy telefon ma już
   nową (zespół IT, runda 8: po „git pull” nikt nie wiedział, co działa). */
async function pokazWersje() {
  const pole = $('set-wersja');
  if (!pole) return;
  // Wersja WCZYTANEGO kodu – konfiguracja z chwili otwarcia strony.
  const w = serverConfig.wersja || {};
  let naTymUrzadzeniu = '';
  try {
    const klucze = (await caches.keys()).filter((k) => /^cosmos-/.test(k));
    naTymUrzadzeniu = klucze.includes(w.pamiec) ? w.pamiec : (klucze[0] || '');
  } catch { /* bez pamięci PWA */ }
  let klucz = 'set.wersjaPamiec';
  if (naTymUrzadzeniu && w.pamiec && naTymUrzadzeniu !== w.pamiec) {
    /* Pamięć inna niż wczytany kod: albo starsza (telefon nie pobrał nowej),
       albo NOWSZA – service worker zaktualizował ją w tle, a karta ma jeszcze
       stary kod. Dawniej obie mówiły „starsza pamięć” z nazwą NOWEJ (agencja,
       runda 9). Rozstrzyga świeża konfiguracja serwera. */
    let teraz = '';
    try { teraz = ((await (await fetch('/api/config')).json()).wersja || {}).pamiec || ''; } catch { /* offline */ }
    klucz = teraz && naTymUrzadzeniu === teraz ? 'set.wersjaNowa' : 'set.wersjaStara';
  }
  pole.textContent = [
    w.commit ? t('set.wersja', { kod: w.commit }) : '',
    naTymUrzadzeniu ? t(klucz, { nazwa: naTymUrzadzeniu }) : '',
  ].filter(Boolean).join(' · ');
}

async function loadStats() {
  try {
    const s = await (await fetch('/api/admin/stats')).json();
    const mb = (s.kbBytes / 1024 / 1024).toFixed(1);
    $('stats-info').innerHTML =
      `${t('stats.conv')}: ${s.conversations} · ${t('stats.mem')}: ${s.memories} · ` +
      `${t('stats.kb')}: ${s.kbItems} (${mb} MB)`;
  } catch { $('stats-info').textContent = '–'; }
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
    `${t('cfg.cloud')}  ${escapeHtml(c.baseUrl || '–')}<br>` +
    `  ${t('cfg.model')} ${escapeHtml(c.model || '–')}${c.visionModel ? ` · ${t('cfg.vision')} ${escapeHtml(c.visionModel)}` : ''}<br>` +
    `  ${t('cfg.apiKey')} ${c.hasApiKey ? t('set.cfgKeySet') : t('set.cfgKeyMissing')}<br>` +
    `${t('cfg.local')}  ${escapeHtml(l.baseUrl || '–')}<br>` +
    `  ${t('cfg.model')} ${escapeHtml(l.model || t('set.cfgModelMissing'))}`;
}

el.settingsBtn.addEventListener('click', () => openSettings());
el.settingsClose.addEventListener('click', closeSettings);
el.settingsModal.addEventListener('click', (e) => {
  if (e.target === el.settingsModal) closeSettings();
});

el.setTemp.addEventListener('input', () => {
  el.tempValue.textContent = el.setTemp.value;
});

el.settingsSave.addEventListener('click', async () => {
  /* Otwarty formularz własnej roli zapisuje się najpierw. Dawniej „Zapisz”
     w stopce zamykało okno, a wpisana rola przepadała po odświeżeniu strony.
     Błąd (brak nazwy, odmowa serwera) – okno zostaje na karcie Agenci. */
  const rola = await zespolWidok.zapiszSzkicWlasnej();
  if (rola === false) {
    kartyUstawien.pokaz('agenci', { wybor: true });
    const box = $('ag-ustawienia');
    (box && (box.querySelector('.ag-wl-formularz [aria-invalid="true"]') || box.querySelector('.ag-wl-zapisz')))?.focus();
    return;
  }
  for (const ep of SILNIKI_Z_MODELEM) settings[POLE_MODELU[ep]] = $(`set-model-${ep}`).value.trim();
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
  // lokalizacja tak samo – używa jej też wyszukiwanie, nie tylko rozmowa
  fetch('/api/location', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: $('set-location').value }),
  }).catch(() => {});
  updateModelBadge();
  closeSettings();
});

/* Wykrycie lokalizacji: przeglądarka daje współrzędne, serwer zamienia je na
   nazwę. Współrzędne nie opuszczają Cosmosa inaczej niż przez ten jeden
   zapytanie – i tylko po kliknięciu, nigdy samo z siebie. */
/* Wynik ustalania lokalizacji POD polem, nie w placeholderze pustego pola:
   tam błąd był szary, po polsku także w EN i znikał po pierwszym znaku. */
function komunikatLokalizacji(tekst) {
  const m = $('set-location-msg');
  m.textContent = tekst || '';
  m.hidden = !tekst;
}

/* Nazwa wpisana ręcznie: serwer od razu szuka współrzędnych (bez nich Plener
   nie policzy światła) i mówimy, co wyszło. */
$('set-location').addEventListener('change', async (e) => {
  const nazwa = e.currentTarget.value.trim();
  if (!nazwa) { komunikatLokalizacji(''); return; }
  // Znak życia: wyszukiwarka miejsc potrafi milczeć kilka sekund.
  komunikatLokalizacji(t('set.locationSearching', { nazwa }));
  try {
    const r = await fetch('/api/location', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: nazwa }),
    });
    const d = await readJsonSafe(r);
    if (!r.ok) { komunikatLokalizacji(d.error || t('set.locationFailed')); return; }
    const w = d.wspolrzedne;
    /* Dwie różne przyczyny, dwie różne rady: wyszukiwarka miejsc nie odpowiada
       (spróbuj za chwilę albo „Wykryj”) albo nie zna takiej nazwy (zespół IT, runda 5). */
    komunikatLokalizacji(d.wspolrzedneNieznane
      ? t(d.powod === 'usluga' ? 'set.locationServiceDown' : 'set.locationNoCoords', { nazwa })
      : w ? t('set.locationFound', { lat: w.lat.toFixed(2), lon: w.lon.toFixed(2) }) : '');
  } catch { komunikatLokalizacji(t('set.locationFailed')); }
});

$('set-location-detect').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const pole = $('set-location');
  if (!navigator.geolocation) {
    komunikatLokalizacji(t('set.locationNoGps'));
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
    const d = await readJsonSafe(r);
    if (d.location) {
      pole.value = d.location;
      komunikatLokalizacji(d.bezNazwy ? t('set.locationNoName')
        : t('set.locationFound', { lat: Number(d.lat).toFixed(2), lon: Number(d.lon).toFixed(2) }));
    } else komunikatLokalizacji(d.error || t('set.locationFailed'));
  } catch (err) {
    // Odmowa zgody to nie awaria – użytkownik zawsze może wpisać ręcznie.
    komunikatLokalizacji(err && err.code === 1 ? t('set.locationDenied') : t('set.locationFailed'));
  } finally {
    btn.disabled = false;
    btn.textContent = dawny;
  }
});

// kopia zapasowa – pobieranie i przywracanie
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
    parts.push(`Python: ${e.python ? '✓' : '–'}`);
    parts.push(`Ollama: ${e.ollama ? '✓' : '–'}`);
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

/* „Przywróć domyślne” kasowało wszystko od razu, bez pytania, a stoi tuż obok
   „Zapisz” (agencja, runda 5). Pierwsze kliknięcie tylko pyta, drugie
   w ciągu 5 s kasuje. confirm() nie wchodzi w grę: na telefonie w PWA bywa
   zablokowany. */
let resetUzbrojony = null;
el.settingsReset.addEventListener('click', () => {
  const btn = el.settingsReset;
  if (!resetUzbrojony) {
    btn.dataset.tekst = btn.textContent;
    btn.textContent = t('set.resetConfirm');
    btn.classList.add('uzbrojony');
    resetUzbrojony = setTimeout(() => {
      resetUzbrojony = null;
      btn.textContent = btn.dataset.tekst;
      btn.classList.remove('uzbrojony');
    }, 5000);
    return;
  }
  clearTimeout(resetUzbrojony);
  resetUzbrojony = null;
  btn.textContent = btn.dataset.tekst;
  btn.classList.remove('uzbrojony');
  settings = { ...DEFAULT_SETTINGS };
  saveSettings();
  openSettings();
  updateModelBadge();
});

// ----------------------------------------------------------------
// Opis wybranego modelu
// ----------------------------------------------------------------

/** Wypisz, do czego dany model się nadaje. Pusty identyfikator chowa ramkę. */
function renderModelInfo(boxEl, id, silnik) {
  const info = typeof modelInfo === 'function' ? modelInfo(id, silnik) : null;
  if (!id || !info) { boxEl.hidden = true; return; }

  const lang = getLang();
  const tags = (info.cechy || [])
    .map((c) => CECHA_OPIS[c])
    .filter(Boolean)
    .map((c) => `<span class="model-info-tag ik ${c.ik}">${escapeHtml(c[lang] || c.pl)}</span>`);
  if (info.kontekst) {
    tags.push(`<span class="model-info-tag ik ik-linijka">${escapeHtml(info.kontekst)}</span>`);
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
  if (info.uwaga) parts.push(`<div class="model-info-warn">⚠︎ ${escapeHtml(info.uwaga)}</div>`);

  boxEl.innerHTML = parts.join('');
  boxEl.hidden = false;
}

/** Wypełnij listę mikrofonów.
 *
 * Nazwy urządzeń przeglądarka ujawnia dopiero po przyznaniu dostępu do audio –
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
    // Po ludzku i w języku interfejsu – surowe „Requested device not found” szło po angielsku.
    const klucz = /NotFound|DevicesNotFound|OverConstrained/.test(err.name) ? 'set.micNone'
      : /NotAllowed|Security|PermissionDenied/.test(err.name) ? 'set.micDenied' : 'set.micErr';
    sel.innerHTML = `<option value="">${escapeHtml(t(klucz))}</option>`;
    sel.title = err.message || '';
  }
}

/** Sprawdź model NA ŻYWO: czy działa na tym koncie i czy czyta obrazy.
 *
 * Lista z `/v1/models` wypisuje wszystko, co dostawca hostuje – nie to, do czego
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

/* Pewność wzroku z sondy: 'pewne' (nazwał kolor próbki), 'prawdopodobnie'
   (przyjął obraz, odpowiedź nic nie dowodzi), 'nie'. Stary serwer i zapisane
   wyniki mogą mieć samo `obrazy: true/false`. */
function wzrokSondy(r) {
  if (['pewne', 'prawdopodobnie', 'nie'].includes(r.obrazyPewnosc)) return r.obrazyPewnosc;
  if (['pewne', 'prawdopodobnie', 'nie'].includes(r.obrazy)) return r.obrazy;
  return r.obrazy ? 'pewne' : 'nie';
}

/* Znaczek pozycji w wybieraku: ten sam dla wyniku „na żywo” i zapisanego. */
function znakSprawdzenia(r) {
  if (!r.rozmowa) return r.inneZadanie ? '⚙' : r.niepewne ? '⏳' : '✗';
  const w = wzrokSondy(r);
  return w === 'pewne' ? '👁' : w === 'prawdopodobnie' ? '👁?' : '✓';
}
function oznaczOpcje(o, r) {
  // Flaga `u` jest tu konieczna: 👁 to para surogatów, więc bez niej klasa
  // znaków obcięłaby tylko jej połowę i przy drugim przebiegu znaczki
  // zaczęłyby się nawarstwiać.
  o.textContent = `${znakSprawdzenia(r)} ${o.textContent.replace(/^[✗✓👁⏳⚙]\??\s*/u, '')}`;
  o.dataset.works = r.rozmowa ? '1' : '0';
}

/* Wyniki zapisane na serwerze (data/konta/modele-sprawdzone.json) – znaczki
   w wybieraku zostają po odświeżeniu strony (zespół IT, runda 9). */
function oznaczZapisane(selectEl, sprawdzone) {
  if (!sprawdzone || typeof sprawdzone !== 'object') return;
  for (const o of selectEl.options) {
    const r = o.value && sprawdzone[o.value];
    if (!r) continue;
    oznaczOpcje(o, r);
    if (r.kiedy) o.title = t('set.checkedOn', { d: new Date(r.kiedy).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'pl-PL') });
  }
}

function renderCheckResult(box, r, ep = '') {
  const lines = [];
  if (r.rozmowa) {
    lines.push(`<div class="check-ok">${escapeHtml(t('set.checkOkChat'))}</div>`);
    const w = wzrokSondy(r);
    lines.push(w === 'pewne'
      ? `<div class="check-ok">${escapeHtml(t('set.checkOkVision'))}</div>`
      : w === 'prawdopodobnie'
        ? `<div class="check-warn">${escapeHtml(t('set.checkMaybeVision'))}</div>`
        : `<div class="check-warn">${escapeHtml(t('set.checkNoVision'))}</div>`);
  } else {
    /* Nagłówek wg RODZAJU porażki. „✗ niedostępny na Twoim koncie” stało przy
       zimnym starcie, zawieszonej Ollamie i limicie zapytań – a to żadna
       z tych rzeczy (zespół IT, runda 5). */
    const rodzaj = r.rodzaj || (r.siec ? 'siec' : r.niepewne ? 'czas' : 'odmowa');
    const naglowek = { siec: 'set.checkNoConn', czas: 'set.checkSlow', limit: 'set.checkLimit' }[rodzaj]
      || (ep === 'local' ? 'set.checkFailLocal' : 'set.checkFail');
    lines.push(`<div class="${rodzaj === 'odmowa' ? 'check-bad' : 'check-warn'}">${escapeHtml(t(naglowek))}</div>`);
    if (r.podpowiedz) lines.push(`<div class="check-warn">${escapeHtml(r.podpowiedz)}</div>`);
    if (r.blad) lines.push(`<pre class="model-info-err">${escapeHtml(r.blad)}</pre>`);
  }
  box.hidden = false;
  box.innerHTML = lines.join('');
}

async function checkModelField(epName) {
  const input = $(`set-model-${epName}`);
  const sel = $(`model-select-${epName}`);
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
    renderCheckResult(box, r, epName);
    // Ten sam znaczek w wybieraku, co po „Sprawdź wszystkie” (serwer go zapisał).
    const o = [...sel.options].find((x) => x.value === model);
    if (o && !r.siec) { oznaczOpcje(o, r); o.title = ''; }
  } catch (err) {
    box.hidden = false;
    box.innerHTML = `<div class="check-bad">${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

// Ostatni raport ze „Sprawdź wszystkie" – do skopiowania.
let lastCheckReport = '';

/** Sprawdź po kolei całą pobraną listę i oznacz pozycje w wybieraku.
 *  Po kolei, nie równolegle – inaczej dostawca odrzuci nas za nadmiar żądań. */
async function checkAllModels(epName) {
  const sel = $(`model-select-${epName}`);
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
    /* Brak połączenia z silnikiem dotyczy WSZYSTKICH modeli naraz. Dawniej
       „Sprawdź wszystkie” przy uśpionym domu szło przez całą listę (przy
       uśpionym komputerze ~3 min) i kończyło „Działa 0 z 21” (zespół IT, runda 5). */
    if (r.siec) {
      renderCheckResult(box, r, epName);
      if (link) link.disabled = false;
      return;
    }
    // Pięć stanów, nie dwa: „nie zdążył odpowiedzieć" i „to nie jest model do
    // rozmowy" to nie to samo, co „nie masz dostępu" – mieszanie ich kazałoby
    // odpuścić modele, które działają.
    const w = wzrokSondy(r);
    const widzi = r.rozmowa && w !== 'nie';
    if (r.rozmowa) ok++;
    if (widzi) vis++;
    if (r.rozmowa) {
      (widzi ? wzrok : rozmowa).push(w === 'prawdopodobnie' ? `${o.value} ${t('set.checkVisionUnsure')}` : o.value);
    } else if (r.inneZadanie) inne.push(o.value);
    else if (r.niepewne) niepewne.push(o.value);
    else brak.push(`${o.value} – ${r.blad || '–'}`);
    oznaczOpcje(o, r);
    o.title = '';
  }

  // Wynik trzeba dać się wynieść na zewnątrz: przy stu pozycjach nikt nie
  // przepisze listy ręcznie, a znaczki w wybieraku znikają po odświeżeniu.
  const grupa = (tytul, lista) => [
    '',
    `=== ${tytul} (${lista.length}) ===`,
    ...(lista.length ? lista.map((m) => `  ${m}`) : ['  –']),
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

  /* Lokalnie każda sonda ładowała model do pamięci karty – po całej liście
     zostawał tam ostatni sprawdzony, a model rozmowy czekał potem na
     przeładowanie (it-modele-open, runda 9). Rozgrzewamy model z zakładki. */
  const rozgrzany = epName === 'local' ? await rozgrzejModelZakladki(epName) : '';

  box.innerHTML = `<div>${escapeHtml(t('set.checkSummary', { ok, n: opts.length, vis }))}</div>`
    + (rozgrzany ? `<div class="check-ok">${escapeHtml(t('set.checkWarm', { m: rozgrzany }))}</div>` : '')
    + `<button type="button" class="btn-secondary check-all" id="copy-check-${epName}">`
    + `${escapeHtml(t('set.checkCopy'))}</button>`;
  $(`copy-check-${epName}`).addEventListener('click', (e) => copyCheckReport(e.currentTarget));
  if (link) link.disabled = false;
}

/** Poproś serwer o załadowanie modelu rozmowy (w tle). Zwraca jego nazwę,
 *  gdy prośba poszła, albo pusty tekst. */
async function rozgrzejModelZakladki(epName) {
  const model = nadpisanieModelu(epName) || epConfig(epName).model || '';
  if (!model) return '';
  try {
    const r = await fetch('/api/models/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: epName, model, rozgrzej: true }),
    });
    return r.ok ? model : '';
  } catch { return ''; }
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
  for (const ep of SILNIKI_Z_MODELEM) {
    renderModelInfo($(`model-info-${ep}`), $(`set-model-${ep}`).value.trim()
      || epConfig(ep).model || '', ep);
  }
}

async function fetchModelsInto(epName, selectEl, btn) {
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = t('set.fetching');
  try {
    const res = await fetch(`/api/models?endpoint=${epName}`);
    const data = await readJsonSafe(res);
    // `error` bywa obiektem dostawcy – dawniej na ekranie stało „[object Object]”.
    if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : (data.error?.message || `HTTP ${res.status}`));
    /* Modele do obrazów, mowy i embeddingów idą do osobnej grupy na końcu
       („Nie do rozmowy”). Na liście OpenAI dall-e-3 i whisper-1 stały między
       modelami czatu jak równe (agencja, runda 5). Zostają, bo „Sprawdź
       wszystkie” oznacza je ⚙ i to jest informacja. */
    const wszystkie = (data.data || []).map((m) => m.id).sort();
    const nieDoRozmowy = (m) => typeof modelNotForChat === 'function' && modelNotForChat(m);
    const models = wszystkie.filter((m) => !nieDoRozmowy(m));
    const inne = wszystkie.filter(nieDoRozmowy);
    if (!wszystkie.length) throw new Error(t('set.noModels'));
    // Znane modele na górę i z etykietą – inaczej wybiera się z listy
    // kilkudziesięciu identyfikatorów, nie wiedząc, czym się różnią.
    const described = [];
    const rest = [];
    for (const m of models) {
      const info = typeof modelInfo === 'function' ? modelInfo(m, epName) : null;
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
      else if (!narrow) label = `${m} – ${info.nazwa}`;
      // Gdy nazwa się powtarza, i tak nic nie rozróżnia – pokazujemy wtedy sam
      // identyfikator (bez prefiksu dostawcy), bo to on jest tu informacją.
      else label = nameCount[info.nazwa] > 1 ? short : info.nazwa;
      return `<option value="${escapeHtml(m)}">${escapeHtml(label)}</option>`;
    };
    selectEl.innerHTML =
      `<option value="">${t('set.selectModel')}</option>`
      + (described.length ? `<optgroup label="${t('model.known')}">`
          + described.map(option).join('') + '</optgroup>' : '')
      + (rest.length ? `<optgroup label="${t('model.other')}">`
          + rest.map(option).join('') + '</optgroup>' : '')
      + (inne.length ? `<optgroup label="${t('model.notChat')}">`
          + inne.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('') + '</optgroup>' : '');
    selectEl.style.display = '';
    oznaczZapisane(selectEl, data.sprawdzone);

    // Dopiero po pobraniu listy ma sens sprawdzanie jej w całości.
    let all = $(`check-all-${epName}`);
    if (!all) {
      all = document.createElement('button');
      all.id = `check-all-${epName}`;
      // Sprawdzanie modeli jest tylko dla właściciela (zaproszona osoba dostaje 403
      // i „Działa 0 z 7”, agencja, runda 5) – tak jak pojedyncze „Sprawdź”.
      all.className = 'btn-secondary check-all tylko-wlasciciel';
      all.type = 'button';
      all.addEventListener('click', () => checkAllModels(epName));
      selectEl.insertAdjacentElement('afterend', all);
    }
    all.textContent = t('set.checkAll');
    all.hidden = false;
  } catch (err) {
    // Nie alert: przy modelu lokalnym komunikat ma kilka linijek podpowiedzi,
    // a systemowe okienko na telefonie ucina je i nie da się z nich skopiować.
    const box = $(`model-info-${epName}`);
    box.hidden = false;
    box.innerHTML = `<div class="model-info-warn">⚠︎ ${escapeHtml(t('set.fetchErr'))}</div>`
      + `<pre class="model-info-err">${escapeHtml(err.message)}</pre>`;
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

for (const ep of SILNIKI_Z_MODELEM) {
  const pole = $(`set-model-${ep}`);
  const sel = $(`model-select-${ep}`);
  $(`fetch-models-${ep}`).addEventListener('click', (e) =>
    fetchModelsInto(ep, sel, e.currentTarget));
  sel.addEventListener('change', () => {
    if (sel.value) pole.value = sel.value;
    refreshModelInfoBoxes();
  });
  // Także przy wpisywaniu z ręki – opis ma nadążać za tym, co widać w polu.
  pole.addEventListener('input', refreshModelInfoBoxes);
}
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
   curlem – czyli w praktyce wcale, a plan zdjęciowy liczył dla domyślnego
   korpusu i nie wiedział nic o dronie. */
async function wczytajSprzet() {
  try {
    const d = await (await fetch('/api/gear')).json();
    $('gear-body').value = d.korpus || '';
    $('gear-lenses').value = d.obiektywy || '';
    $('gear-extras').value = d.dodatki || '';
  } catch { /* offline – pola zostają puste, zapis i tak zadziała później */ }
}

/* Zapis pod przyciskiem, nie przy pisaniu – poprawka po obejrzeniu własnej
   roboty na zrzucie ekranu.

   Pierwsza wersja zapisywała sprzęt na bieżąco, z opóźnieniem. Działało, ale
   stworzyło w jednym oknie dwa różne modele zapisu: „Korpus", „Obiektywy"
   i „Reszta sprzętu" zapisywały się same, a stojące tuż obok „Profil"
   i „Lokalizacja" – dopiero po kliknięciu. Pola tekstowe zachowujące się
   inaczej niż sąsiednie pola tekstowe to nie wygoda, tylko zagadka.

   Po przeniesieniu sprzętu do Pleneru zostaje ta sama zasada, tylko własny
   przycisk: „Zapisz sprzęt". `/api/gear` i tak zawsze było osobną trasą –
   doklejenie go do przycisku Ustawień było wyłącznie skutkiem tego, że pola
   przypadkiem tam stały. */
/* Błąd LECI DALEJ, nie jest połykany. Dopóki zapis wisiał pod przyciskiem
   Ustawień razem z profilem i lokalizacją, ciche `catch` było spójne z resztą.
   Teraz sprzęt ma własny przycisk i własne potwierdzenie „Zapisane." – a to
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
  const silnik = silnikNasluchu() === 'whisper'
    ? t(sttLokalne() ? 'set.sttZrodloLokalne' : 'set.sttZrodloChmura')
    : t('set.sttZrodloPrzegladarka');
  $('set-stt-now').textContent = t('set.sttNow', { silnik });
}
for (const ep of SILNIKI_Z_MODELEM) {
  $(`check-model-${ep}`).addEventListener('click', () => checkModelField(ep));
}
$('mic-refresh').addEventListener('click', loadMicList);
$('polish-btn').addEventListener('click', polishPrompt);

// ----------------------------------------------------------------
// Status i konfiguracja serwera
// ----------------------------------------------------------------

/* Stan silników z ostatniego /api/status. Kropka przy nazwie modelu miała
   kolor silnika nawet przy „Chmura NVIDIA – brak klucza" w panelu stanu –
   dwa sprzeczne sygnały. Teraz gaśnie, gdy silnik jest niedostępny. */
var stanSilnikow = {};   // var: updateModelBadge bywa wołane przed tą linią (start aplikacji)
/* Powód z /api/status (K1): „termin”, „klucz”, „odmowa”, „uspiony”, „http-404”.
   Kropka gaśnie TYLKO przy pewnym „offline” (online === false). „Nie wiadomo”
   (null – np. sprawdzenie nie zmieściło się w terminie) zostawia kolor silnika:
   zrzut 2 Marcina pokazywał szarą kropkę przy lokalnym, który właśnie
   odpowiadał (runda 10). */
var powodSilnikow = {};
/* Udana odpowiedź silnika – ostatni kontakt. Przez 2 minuty sprawdzenie co
   30 s nie obniża stanu do „offline” (inaczej kropka migałaby po każdym
   wolnym GET /models; it-plynnosc). */
var ostatniKontakt = {};
const KONTAKT_WAZNY_MS = 120000;
function zanotujKontakt(silnik) {
  if (!silnik) return;
  ostatniKontakt[silnik] = Date.now();
  if (stanSilnikow[silnik] !== 'ok') { stanSilnikow[silnik] = 'ok'; powodSilnikow[silnik] = ''; updateModelBadge(); }
}
function oznaczNiedostepny(silnik) {
  if (!silnik) return;
  ostatniKontakt[silnik] = 0;
  stanSilnikow[silnik] = 'offline';
  powodSilnikow[silnik] = '';
  updateModelBadge();
}
const POWODY_KROPKI = ['termin', 'klucz', 'odmowa', 'uspiony'];
// Termin sprawdzenia w /api/status: lokalny przez Tailscale dostaje dłużej (server.js).
const terminSprawdzenia = (silnik) => (silnik === 'local' ? 8 : 5);
function podpowiedzKropki(stan, powodSurowy, silnik) {
  // „http-404”, „http-502” … – serwer odpowiedział, ale nie tak, jak trzeba: dla człowieka „nie da się połączyć”.
  const powod = /^http-/.test(powodSurowy || '') ? 'odmowa' : powodSurowy;
  if (stan === 'bez-klucza') return t('stat.noKey');
  if (stan === 'brak-dostepu') return t('stat.notForYou');
  const zdanie = () => t(`stat.powod.${powod}`, { s: terminSprawdzenia(silnik) });
  if (stan === 'offline') return POWODY_KROPKI.includes(powod) ? zdanie() : t('stat.powod.inny');
  // Nie wiadomo (termin sprawdzenia) – kolor zostaje, ale mówimy, co się dzieje.
  if (stan === 'nieznany' && POWODY_KROPKI.includes(powod)) return zdanie();
  return '';
}

function updateModelBadge() {
  const model = currentModel() || t('chat.modelNotSet');
  const labels = { cloud: t('tabCloud'), local: t('tabLocal'), openai: 'OpenAI', claude: 'Claude' };
  el.topbarModel.textContent = `${model} · ${labels[endpoint] || endpoint}`;
  const stan = stanSilnikow[endpoint];
  const zgaszona = stan === 'bez-klucza' || stan === 'offline' || stan === 'brak-dostepu';
  el.topbarModel.classList.toggle('niedostepny', zgaszona);
  el.topbarModel.title = podpowiedzKropki(stan, powodSilnikow[endpoint], endpoint);
  // Kropka powitania z TEGO SAMEGO stanu – dwa sprzeczne sygnały na jednym ekranie (zrzut 2).
  const kropka = document.querySelector('.welcome-kropka');
  if (kropka) kropka.classList.toggle('niedostepny', zgaszona);
  el.welcomeModel.textContent = model;
  el.welcomeModel.title = model;   // na telefonie nazwa bywa ucięta wielokropkiem
}

/* Świeży stan przy powrocie do aplikacji i przy przełączeniu na silnik,
   który nie jest „ok” – nie częściej niż co 10 s: każde sprawdzenie odpytuje
   wszystkie silniki i trwa do kilku sekund (it-plynnosc). */
let ostatnieSprawdzenie = 0;
/* Tyknięcie co 30 s. Zaległe tyknięcie po odmrożeniu karty strzela w tej samej
   milisekundzie co visibilitychange – drugie /api/status naraz tylko dublowało
   porażkę (it-plynnosc, runda 12). */
function sprawdzStanCyklicznie() {
  if (Date.now() - ostatnieSprawdzenie >= 5000) refreshStatus();
}
function odswiezStanGdyTrzeba(silnik) {
  if (Date.now() - ostatnieSprawdzenie < 10000) return;
  if (silnik && stanSilnikow[silnik] === 'ok') return;
  refreshStatus();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  powrotZTla();
  odswiezStanGdyTrzeba();
});
// Strona odmrożona (Page Lifecycle) albo wyjęta z pamięci wstecz/dalej – też powrót z tła.
document.addEventListener('resume', powrotZTla);
window.addEventListener('pageshow', (e) => { if (e.persisted) { powrotZTla(); odswiezStanGdyTrzeba(); wrocPoOdpowiedz(); } });

/* WYBÓR MODELU Z PLAKIETKI. Model zmieniało się tylko w Ustawieniach → Silniki;
   plakietka w prawym górnym rogu pokazywała go, ale nic nie robiła (Marcin).
   Klik otwiera listę modeli BIEŻĄCEGO silnika – tej samej, co „Pobierz listę”
   (u członka przyciętej do modeli właściciela). Wybór to to samo nadpisanie
   co pole w Ustawieniach. Nazwy modeli przychodzą od dostawcy, więc do DOM-u
   idą przez textContent. */
const listyModeli = {};                 // silnik → { modele, kiedy }
const LISTA_MODELI_WAZNA_MS = 5 * 60 * 1000;
async function modeleSilnika(ep) {
  const z = listyModeli[ep];
  if (z && Date.now() - z.kiedy < LISTA_MODELI_WAZNA_MS) return z.modele;
  /* Błąd też pamiętamy (minutę): przy zawieszonej Ollamie każde otwarcie
     listy to było 15 s „Ładuję…” (zespół IT, runda 6). */
  if (z && z.blad && Date.now() - z.kiedy < 60000) throw new Error(z.blad);
  let res;
  let data;
  try {
    res = await fetch(`/api/models?endpoint=${encodeURIComponent(ep)}`);
    data = await readJsonSafe(res);
  } catch (err) { listyModeli[ep] = { blad: err.message, kiedy: Date.now() }; throw err; }
  if (!res.ok) {
    const blad = typeof data.error === 'string' ? data.error : (data.error?.message || `HTTP ${res.status}`);
    listyModeli[ep] = { blad, kiedy: Date.now() };
    throw new Error(blad);
  }
  const nieDoRozmowy = (m) => typeof modelNotAChatPartner === 'function' && modelNotAChatPartner(m);
  const modele = [...new Set((data.data || []).map((m) => m.id))].filter((m) => m && !nieDoRozmowy(m)).sort();
  listyModeli[ep] = { modele, kiedy: Date.now() };
  return modele;
}
function zamknijListeModeli() {
  const lista = $('model-lista');
  if (!lista || lista.hidden) return;
  lista.hidden = true;
  el.topbarModel.setAttribute('aria-expanded', 'false');
}
function wybierzModelZPlakietki(id) {
  const pole = POLE_MODELU[endpoint];
  if (!pole) return;
  settings[pole] = id;
  saveSettings();
  const polePanel = $(`set-model-${endpoint}`);
  if (polePanel) polePanel.value = id;
  updateModelBadge();
  zamknijListeModeli();
  el.input.focus();
}
function pozycjaListyModeli(tekst, podpis, wybrany, naKlik) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'model-opcja' + (wybrany ? ' wybrany' : '');
  b.setAttribute('role', 'option');
  b.setAttribute('aria-selected', wybrany ? 'true' : 'false');
  const n = document.createElement('span');
  n.className = 'model-opcja-nazwa';
  n.textContent = tekst;
  b.appendChild(n);
  if (podpis) {
    const p = document.createElement('span');
    p.className = 'model-opcja-podpis';
    p.textContent = podpis;
    b.appendChild(p);
  }
  b.addEventListener('click', naKlik);
  return b;
}
async function otworzListeModeli() {
  const lista = $('model-lista');
  if (!lista) return;
  if (!lista.hidden) { zamknijListeModeli(); return; }
  const ep = endpoint;
  lista.hidden = false;
  el.topbarModel.setAttribute('aria-expanded', 'true');
  const labels = { cloud: t('tabCloud'), local: t('tabLocal'), openai: 'OpenAI', claude: 'Claude' };
  const naglowek = document.createElement('div');
  naglowek.className = 'model-lista-glowa';
  naglowek.textContent = t('model.pickFor', { silnik: labels[ep] || ep });
  const ladowanie = document.createElement('div');
  ladowanie.className = 'model-lista-info';
  ladowanie.textContent = t('model.pickLoading');
  lista.replaceChildren(naglowek, ladowanie);
  let modele = [];
  let blad = '';
  try { modele = await modeleSilnika(ep); } catch (err) { blad = err.message; }
  if (lista.hidden || ep !== endpoint) return;   // zamknięta albo zmieniony silnik w międzyczasie
  const obecny = nadpisanieModelu(ep);
  const domyslny = epConfig(ep).model || '';
  const pozycje = [pozycjaListyModeli(t('model.pickDefault'), domyslny, !obecny, () => wybierzModelZPlakietki(''))];
  const wszystkie = obecny && !modele.includes(obecny) ? [obecny, ...modele] : modele;
  for (const m of wszystkie) {
    if (m === domyslny && !obecny) continue;       // jest już jako „domyślny”
    const info = typeof modelInfo === 'function' ? modelInfo(m, ep) : null;
    pozycje.push(pozycjaListyModeli(m, info && !info.zgadywane ? info.nazwa : '', m === obecny, () => wybierzModelZPlakietki(m)));
  }
  const dol = [];
  if (blad) {
    const e = document.createElement('div');
    e.className = 'model-lista-info blad';
    e.textContent = blad;
    dol.push(e);
  }
  const doUst = document.createElement('button');
  doUst.type = 'button';
  doUst.className = 'model-lista-ustawienia';
  doUst.textContent = t('model.pickSettings');
  doUst.addEventListener('click', () => { zamknijListeModeli(); openSettings('silniki'); });
  dol.push(doUst);
  lista.replaceChildren(naglowek, ...pozycje, ...dol);
  (lista.querySelector('.model-opcja.wybrany') || lista.querySelector('.model-opcja'))?.focus();
}
el.topbarModel.addEventListener('click', otworzListeModeli);
/* Strzałki po liście (role=listbox), Tab poza listę zamyka ją. */
$('model-lista')?.addEventListener('keydown', (e) => {
  const opcje = [...$('model-lista').querySelectorAll('.model-opcja')];
  const i = opcje.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = e.key === 'ArrowDown' ? Math.min(opcje.length - 1, i + 1) : Math.max(0, i - 1);
    opcje[n]?.focus();
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    (e.key === 'Home' ? opcje[0] : opcje[opcje.length - 1])?.focus();
  } else if (e.key === 'Tab') {
    zamknijListeModeli();
  }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#model-wybor')) zamknijListeModeli(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('model-lista')?.hidden) { zamknijListeModeli(); el.topbarModel.focus(); }
});

function setStatusRow(rowEl, online, extra) {
  const dot = rowEl.querySelector('.status-dot');
  const state = rowEl.querySelector('.status-state');
  dot.className = 'status-dot ' + (online === true ? 'ok' : online === 'warn' ? 'warn' : online === 'brak' ? 'brak' : 'err');
  state.textContent = extra;
}

function setServerReachable(ok) {
  if (ok === serverReachable) return;
  serverReachable = ok;
  const bar = $('offline-bar');
  if (bar) bar.hidden = ok;
  updateSendButton();
  /* Serwer wrócił – to pewniejszy znak niż zdarzenie 'online', które po
     zawieszeniu sieci w tle w ogóle nie przychodzi (navigator.onLine się nie
     zmienił). Po odpowiedź, która czeka na serwerze. */
  if (ok) wrocPoOdpowiedz();
}

async function retryConnection() {
  const btn = $('offline-retry');
  if (btn) { btn.disabled = true; btn.textContent = t('offline.retrying'); }
  await loadServerConfig();
  if (btn) { btn.disabled = false; btn.textContent = t('offline.retry'); }
}

/* Pierwsze /api/config i /api/status – od nich zależy, którym silnikiem
   rozpoznawać mowę. Tryb głosowy otwarty wcześniej czeka na tę obietnicę. */
let gotowyStatus = null;
let gotowyConfig = null;
const gotowoscGlosu = Promise.all([
  new Promise((r) => { gotowyStatus = r; }),
  new Promise((r) => { gotowyConfig = r; }),
]);

async function refreshStatus() {
  try { await refreshStatusWlasciwe(); } finally { gotowyStatus(); }
}

/* Tylko NAJNOWSZE sprawdzenie ma głos. /api/status odpytuje silniki i trwa
   do kilku sekund; starsze żądanie kończące się po nowszym, nieudanym,
   chowało pasek „Brak połączenia”, choć serwera już nie było (wyścig
   wyłapany przez pasek-offline pod obciążeniem baterii). */
let statusNr = 0;
/* O osiągalności decyduje żądanie WYSŁANE najpóźniej, nie to, które
   najpóźniej wróciło – dotyczy i statusu, i konfiguracji. */
let startOsiagalnosci = 0;
/* Jedna porażka to jeszcze nie „brak połączenia” (it-plynnosc, runda 12).
   Telefon po powrocie z tła budzi stronę chwilę przed siecią: pierwsze
   /api/status padało, pasek „Brak połączenia z serwerem Cosmosa” wisiał do
   następnego tyknięcia co 30 s, a Wyślij było zablokowane – Marcin: „kiedy
   zmieniam okno na telefonie, to rozłącza Cosmosa”. Teraz porażka ponawia
   sprawdzenie po 1, 2, 4 s…, pasek staje dopiero po 3 porażkach z rzędu albo
   po 8 s bez sukcesu, a przez 10 s po powrocie z tła nie staje wcale. */
const PONOW_STATUS_MS = [1000, 2000, 4000, 8000, 15000];
const LASKA_PO_TLE_MS = 10000;
let porazkiSerwera = 0;
let pierwszaPorazka = 0;
let ostatniaPorazka = -1000;
let laskaDo = 0;
let laskaTimer = null;
let ponowStatusTimer = null;
function zglosOsiagalnosc(ok, start) {
  if (start < startOsiagalnosci) return;
  startOsiagalnosci = start;
  if (ok) {
    porazkiSerwera = 0;
    pierwszaPorazka = 0;
    ostatniaPorazka = -1000;
    clearTimeout(ponowStatusTimer);
    ponowStatusTimer = null;
    setServerReachable(true);
    return;
  }
  const teraz = performance.now();
  // Konfiguracja i status padające w tej samej chwili to jedna porażka, nie dwie.
  if (teraz - ostatniaPorazka > 300) porazkiSerwera++;
  ostatniaPorazka = teraz;
  if (!pierwszaPorazka) pierwszaPorazka = teraz;
  ocenOsiagalnosc();
  if (!ponowStatusTimer) {
    // W oknie łaski gęściej – sieć wstaje zwykle w 1–3 s, a pasek ma zgasnąć, zanim ktoś go zobaczy.
    let zwloka = PONOW_STATUS_MS[Math.max(0, Math.min(porazkiSerwera - 1, PONOW_STATUS_MS.length - 1))];
    if (teraz < laskaDo) zwloka = Math.min(zwloka, 2000);
    ponowStatusTimer = setTimeout(() => { ponowStatusTimer = null; refreshStatus(); }, zwloka);
  }
}
/** Pasek i blokada Wyślij – dopiero gdy porażki to już seria, a nie mrugnięcie sieci. */
function ocenOsiagalnosc() {
  if (!porazkiSerwera) return;
  const teraz = performance.now();
  if (teraz < laskaDo) return;
  if (porazkiSerwera >= 3 || teraz - pierwszaPorazka > 8000) setServerReachable(false);
}
/** Każda odpowiedź własnego serwera (bieg czatu, rozmowy, strumień zdarzeń) dowodzi,
 *  że jest osiągalny. 5xx bywa odpowiedzią Cloudflare'a za padniętym serwerem – nie liczy się. */
function serwerOdpowiedzial(r) {
  if (!r || typeof r.status !== 'number' || r.status < 500) zglosOsiagalnosc(true, performance.now());
  return r;
}
/** Strona wraca z tła: okno łaski i JEDNO sprawdzenie stanu. */
function powrotZTla() {
  laskaDo = performance.now() + LASKA_PO_TLE_MS;
  porazkiSerwera = 0;
  pierwszaPorazka = 0;
  clearTimeout(laskaTimer);
  laskaTimer = setTimeout(ocenOsiagalnosc, LASKA_PO_TLE_MS + 50);
}
async function refreshStatusWlasciwe() {
  const nr = ++statusNr;
  const start = performance.now();
  ostatnieSprawdzenie = Date.now();
  try {
    const res = await fetch('/api/status');
    const st = await res.json();
    if (nr !== statusNr) return;
    zglosOsiagalnosc(true, start);
    const cloudCfg = epConfig('cloud');
    if (!cloudCfg.hasApiKey) {
      setStatusRow(el.statusCloud, 'warn', t('stat.noKey'));
    } else {
      setStatusRow(el.statusCloud, st.cloud?.online === true, st.cloud?.online ? t('stat.online') : t('stat.offline'));
    }
    /* Silnika bez dostępu nie ma w odpowiedzi. Zaproszona osoba widziała
       „Lokalny GPU offline”, choć działał, tylko nie dla niej (agencja, runda 5). */
    if (!st.local) setStatusRow(el.statusLocal, 'brak', t('stat.notForYou'));
    else setStatusRow(el.statusLocal, st.local.online === true, st.local.online ? t('stat.online') : t('stat.offline'));
    /* K1: true = żyje, false = na pewno nie, null = nie wiadomo (termin).
       Silnik, który odpowiedział w ostatnich 2 minutach, zostaje „ok”. */
    const stanZ = (silnik, s) => {
      const swiezy = Date.now() - (ostatniKontakt[silnik] || 0) < KONTAKT_WAZNY_MS;
      if (s?.online === true || swiezy) return 'ok';
      return s?.online === false ? 'offline' : 'nieznany';
    };
    const nowy = {
      cloud: cloudCfg.hasApiKey ? stanZ('cloud', st.cloud) : 'bez-klucza',
      // Członek bez przyznanego lokalnego: „niedostępne dla Ciebie”, nie „offline”.
      local: st.local ? stanZ('local', st.local) : 'brak-dostepu',
    };
    // OpenAI i Claude – gdy serwer je sprawdza; inaczej zostaje stan z ostatniej odpowiedzi czatu.
    for (const k of ['openai', 'claude']) if (st[k] && typeof st[k] === 'object') nowy[k] = stanZ(k, st[k]);
    stanSilnikow = { ...stanSilnikow, ...nowy };
    powodSilnikow = { ...powodSilnikow };
    for (const k of Object.keys(nowy)) powodSilnikow[k] = String((st[k] && st[k].powod) || '');
    updateModelBadge();
    // `tylkoWlasciciel`: zmysły działają, ale nie dla tej osoby – inne zdanie niż „komputer nie odpowiada”.
    senses = { online: st.senses?.online === true, caps: st.senses?.caps || {}, tylkoWlasciciel: st.senses?.tylkoWlasciciel === true, znany: true };
    // Ptaki mają własną drogę (komputer osoby → serwer → dom) – osobny stan.
    stanPtakow = { dostepne: st.ptaki?.ok === true, znany: Boolean(st.ptaki) };
    // Pierwszy status = serwer osiągalny: nagrania odłożone bez zasięgu ruszają bez otwierania trybu głosowego.
    if (!ptakiPoStatusie) { ptakiPoStatusie = true; rozpoznajOdlozonePtaki(); }
    /* Kinect to cecha komputera osoby (jej agent albo dom z przyznaniem), nie roli:
       opcje widać wtedy, gdy zmysły tej osoby go mają (zespół IT, runda 8). */
    for (const o of document.querySelectorAll('#live-source option[data-kinect]')) o.hidden = !kinectDostepny();
    kamera_.poprawZrodlo?.();
    if (senses.online) {
      /* Część zmysłów oddaje nie `true`, tylko NAZWĘ tego, co je obsługuje
         (np. dokumenty: "docling"). Dopisujemy ją, bo „dokumenty" i
         „dokumenty (docling)" to dwie różne jakości odczytu – z tym drugim
         Cosmos czyta skany i tabele, z pierwszym nie. */
      // `birdnet_gotowy` i podobne to stan zmysłu (model rozgrzany), nie osobny zmysł.
      const active = Object.entries(senses.caps).filter(([k, v]) => v && !/_gotowy$/.test(k))
        .map(([k, v]) => (typeof v === 'string' ? `${k} (${v})` : k));
      setStatusRow(el.statusSenses, true, active.length ? t('stat.active', { n: active.length }) : t('stat.online'));
      el.statusSenses.title = active.length ? t('stat.sensesTip', { list: active.join(', ') }) : t('stat.online');
    } else if (st.senses?.tylkoWlasciciel) {
      setStatusRow(el.statusSenses, 'brak', t('stat.notForYou'));
      el.statusSenses.title = t('stat.notForYouTip');
    } else {
      setStatusRow(el.statusSenses, 'warn', t('stat.offline'));
      el.statusSenses.title = t('stat.sensesRun');
    }
  } catch {
    zglosOsiagalnosc(false, start);
    // Pojedyncza porażka (albo okno łaski) – kropek nie gasimy, zanim zgaśnie serwer.
    if (nr !== statusNr || serverReachable) return;
    setStatusRow(el.statusCloud, false, '–');
    setStatusRow(el.statusLocal, false, '–');
    setStatusRow(el.statusSenses, false, '–');
  }
}

async function loadServerConfig() {
  // Nowy klucz albo nowe przyznanie = inna lista modeli pod plakietką.
  for (const k of Object.keys(listyModeli)) delete listyModeli[k];
  try { await loadServerConfigWlasciwe(); } finally { gotowyConfig(); }
}

async function loadServerConfigWlasciwe() {
  let mamy = false;
  const start = performance.now();
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    serverConfig = await res.json();
    zglosOsiagalnosc(true, start);
    mamy = true;
    /* Same nazwy modeli na drogę bez sieci: PWA otwarta offline pisała
       „Aktywny model: model nieustawiony”, choć model był ustawiony, a nie
       przyszła tylko konfiguracja (zespół IT, runda 5). */
    try {
      localStorage.setItem('cosmos.modeleSerwera', JSON.stringify(Object.fromEntries(Object.entries(serverConfig.endpoints || {})
        .map(([n, e]) => [n, { model: (e && e.model) || '' }]))));
    } catch { /* prywatne okno */ }
  } catch {
    // interfejs działa dalej z pamięci podręcznej – pasek u góry mówi o awarii
    zglosOsiagalnosc(false, start);
    const modele = loadJson('cosmos.modeleSerwera', null);
    if (modele && !Object.values(serverConfig.endpoints || {}).some((e) => e && e.model)) {
      serverConfig = { ...serverConfig, endpoints: { ...modele, ...Object.fromEntries(
        Object.entries(serverConfig.endpoints || {}).filter(([, e]) => e && Object.keys(e).length)) } };
    }
  }
  /* Bez konfiguracji zakładki zostają z pamięci. Dawniej jedno otwarcie bez
     sieci (albo w trakcie restartu) budowało zakładki z pustej konfiguracji,
     nadpisywało zapamiętaną listę i przestawiało silnik z Claude na NVIDIĘ
     na stałe (agencja, runda 5). */
  if (mamy) buildEndpointTabs();
  else buildEndpointTabs(loadJson('cosmos.zakladki', null) || ['cloud']);
  updateModelBadge();
  refreshStatus();
  odswiezPrzyciskZespolu();
  rysujUstawieniaZespolu(false);
  // Własne role (do „Dodaj rolę”) i „Pytaj przed startem” – od razu, nie dopiero po otwarciu Ustawień.
  pobierzUstawieniaZespolu().then(() => rysujUstawieniaZespolu(false));
}

// ----------------------------------------------------------------
// PWA
// ----------------------------------------------------------------

// Service worker i pasek „Jest nowa wersja” – public/pwa.js.
uruchomPwa({ t });

// ----------------------------------------------------------------
// Logowanie (gdy serwer wymaga hasła – np. na VPS)
// ----------------------------------------------------------------

async function checkAuth() {
  try {
    const res = await fetch('/api/auth');
    const d = await res.json();
    // Rola od razu: przyciski tylko dla właściciela nie mogą mignąć gościowi.
    konta_.zastosujRole(d.uzytkownik);
    /* ZMIANA OSOBY WYKRYTA DOPIERO TERAZ (sesja wygasła albo „Wyloguj
       pozostałe urządzenia”, potem logowanie formularzem): pamięć przeglądarki
       jest już wyczyszczona, ale ustawienia poprzedniej osoby siedzą w pamięci
       STRONY (`settings`, silnik, źródło kamery) – lektor Ani czytał odpowiedzi
       Bartka (agencja, runda 9). Jedno przeładowanie, zanim cokolwiek ruszy;
       po nim `cosmos.kto` już się zgadza, więc drugiego nie będzie. */
    if (konta_.pilnujWlascicielaPamieci(d.uzytkownik)) {
      await konta_.usunNagraniaPtakow();
      location.reload();
      return new Promise(() => {});
    }
    return d.required && !d.authed ? false : true;
  } catch {
    return true; // serwer nieosiągalny – nie blokuj UI (offline)
  }
}

/* SESJA WYGASŁA W TRAKCIE PRACY. Każde /api/* odpowiadało wtedy 401, a na
   ekranie stało „⚠ Wymagane logowanie.” z przyciskiem „Ponów”, który nigdy
   nie zadziała (agencja, runda 5). Pierwsza taka odpowiedź pokazuje ekran
   logowania; szkic w polu przeżywa przeładowanie po zalogowaniu. */
let sesjaWygaslaPokazana = false;
const fetchSurowy = window.fetch.bind(window);
window.fetch = async (...args) => {
  const res = await fetchSurowy(...args);
  if (res.status === 401 && !sesjaWygaslaPokazana) {
    let sciezka = '';
    try { sciezka = new URL(String(args[0]?.url || args[0] || ''), location.href).pathname; } catch { /* zły adres */ }
    /* Tylko 401 NASZEJ bramki (kod „niezalogowany”). 401 przepuszczone od
       dostawcy – zły klucz NVIDII – pokazywało każdemu „Sesja wygasła” przy
       każdej wiadomości (zespół IT, runda 5). Serwer już tak nie robi; to druga
       warstwa na każdą inną trasę, która kiedyś by się pomyliła. */
    const d = await res.clone().json().catch(() => ({}));
    if (d.kod && d.kod !== 'niezalogowany') return res;
    if (sciezka.startsWith('/api/') && !/^\/api\/(login|logout|auth)\b/.test(sciezka)) {
      sesjaWygaslaPokazana = true;
      showLogin();
      $('login-error').textContent = t('login.expired');
    }
  }
  return res;
};

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
        // Pusty login = właściciel (tak działało logowanie przed kontami).
        body: JSON.stringify({ login: $('login-login').value, password: $('login-password').value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(konta_.bladKonta(d, t('login.failed')));
      }
      /* Poprawne hasło, a ciastko nie przyjęte (Secure po zwykłym http):
         dawniej cichy powrót do pustego formularza (zespół IT, runda 5). */
      if (!(await konta_.ciastkoPrzyjete())) throw new Error(t('login.notHttps'));
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
  /* Link z zaproszeniem ma pierwszeństwo przed wszystkim innym – także przed
     sesją. Ktoś, kto dostał zaproszenie na urządzeniu, na którym jest już
     zalogowany właściciel, ma założyć SWOJE konto, a nie trafić na cudze. */
  const zaproszenie = konta_.tokenZaproszenia();
  if (zaproszenie) {
    konta_.pokazZaproszenie(zaproszenie);
    return;
  }
  if (!(await checkAuth())) {
    showLogin();
    return; // nie inicjalizuj reszty, dopóki użytkownik się nie zaloguje
  }
  startApp();
}

function startApp() {
  applyI18n();
  collapseSidebarOnMobile(); // na telefonie zacznij z ukrytym panelem, widoczny czat
  buildEndpointTabs(loadJson('cosmos.zakladki', null) || ['cloud']);
  setEndpoint(endpoint);
  pokazGlosnik();
  updateKbBadge();
  /* Najpierw lista rozmów, dopiero potem powrót do odpowiedzi, która
     powstawała w tle – wznowienie musi mieć do czego wrócić. */
  // Szkic i kolejka sprzed odświeżenia – kolejka rusza, gdy nic się nie liczy.
  try {
    const szkic = localStorage.getItem(KLUCZ_SZKICU);
    if (szkic && !el.input.value) { el.input.value = szkic; autosizeInput(); updateSendButton(); }
    const zapisana = JSON.parse(localStorage.getItem(KLUCZ_KOLEJKI) || '[]');
    if (Array.isArray(zapisana) && zapisana.length) { kolejka = zapisana; renderKolejka(); }
  } catch { /* bez pamięci */ }
  loadConversations().then(przywrocOstatnia).then(wrocPoOdpowiedz).then(() => ruszKolejke())
    .catch(() => { /* wznowienie nie może blokować startu */ });
  renderMessages();
  updateSendButton();
  loadServerConfig();
  setInterval(sprawdzStanCyklicznie, 30000);
  // Nauka: harmonogram rutyn
  try { scheduleControls(); } catch { /* ignore */ }
  loadProcedures();
  loadAutomationStatus();
  updateLearnBadge();
  pollDueRoutines();
  setInterval(pollDueRoutines, 60000);
  el.input.focus();
  /* Dopiero teraz panel boczny na telefonie może się pokazać – do tej chwili
     CSS trzyma go schowanego (.app:not(.gotowa)). Bez tego przy każdym
     starcie migał otwarty z przyciemnieniem przez ~0,4 s. */
  document.querySelector('.app').classList.add('gotowa');
  // Pierwsze wejście tej osoby: samouczek (imię, klucze, zmysły, telefon).
  samouczek_.wystartuj().catch(() => { /* samouczek nie może zablokować aplikacji */ });
  /* Konto i Zmysły wczytane zawczasu: otwarte Ustawienia rysują gotowy stan,
     zamiast dopisywać bloki po 150 ms (skok układu 0,85 na telefonie). */
  setTimeout(() => {
    konta_.odswiez().catch(() => {});
    zmyslyWidok_.odswiez().catch(() => {});
  }, 1500);
}

// ----------------------------------------------------------------
// NAUKA – rozpoznawanie (przez zmysły), procedury, rutyny: public/nauka-widok.js
// ----------------------------------------------------------------
const { loadAutomationStatus, closeLearn, loadProcedures, runProcedure, scheduleControls, updateLearnBadge, pollDueRoutines } = utworzNaukeWidok({
  $, escapeHtml, readJsonSafe, getMedia,
});

// ----------------------------------------------------------------
// Strumień zdarzeń percepcji – kanał od serwera do okna
//
// Dotąd przeglądarka tylko WYSYŁAŁA zdarzenia i nigdy nie dowiadywała się,
// że coś się stało. „Hej, Kosmos" wykryte przez senses/wake_listener.py na
// domowym komputerze umierało w logu serwera – telefon w kieszeni nic o tym
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
  // tłumaczenia – pokazujemy wtedy surową nazwę zamiast „undefined".
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
  /* Reszta tylko mignięciem – to kontekst, nie polecenie.
   *
   *  ALE NIE TO, CO I TAK WIDAĆ. Dymek istnieje po to, żeby przy ZAMKNIĘTYM
   *  podglądzie dowiedzieć się, że Cosmos kogoś zobaczył. Przy otwartym
   *  podglądzie ta sama treść stoi już pod obrazem, i to na stałe zamiast
   *  na sześć sekund – więc dymek tylko powtarzał ją drugi raz nad panelem.
   *  Marcin zapytał wprost, czy tak miało być; nie miało.
   *
   *  Czujniki, urządzenia i rutyny lecą dalej: ich w podglądzie nie widać. */
  const podgladOtwarty = $('live-panel') && $('live-panel').style.display !== 'none';
  const rozpoznania = ['kamera', 'sylwetka', 'dlonie'];
  if (podgladOtwarty && rozpoznania.includes(z.type)) return;
  /* Wyłączone „Rozpoznawanie” w panelu kamery wycisza WSZYSTKIE dymki
     rozpoznawania, nie tylko te z podglądu. Marcin wyłączył je i dalej co
     chwilę widział „w kadrze pojawiło się: chair” – to mówił obserwator
     kamery na jego komputerze (osobny program), a przycisk działał tylko na
     przeglądarkę. Zdarzenia dalej trafiają do kontekstu modelu; kto chce
     wyłączyć samo obserwowanie, ma przełącznik Obserwatora w Ustawieniach. */
  if (rozpoznania.includes(z.type) && localStorage.getItem('cosmos.liveRozpoznawanie') === '0') return;
  if ([...rozpoznania, 'czujnik', 'urządzenie', 'rutyna'].includes(z.type)) pokazZdarzenie(z);
}

// Przełącznik w Ustawieniach – czytany przy otwarciu okna i zapisywany od razu.
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

  /* Udane połączenie zeruje zwłokę. Dawniej robiło to dopiero zdarzenie –
     po serii restartów kanał, który już działał, wznawiał się potem co minutę. */
  strumienZdarzen.onopen = () => { zwlokaWznowienia = 1000; serwerOdpowiedzial(); };
  strumienZdarzen.addEventListener('zdarzenie', (e) => {
    zwlokaWznowienia = 1000;
    try { obsluzZdarzenie(JSON.parse(e.data)); } catch { /* zniekształcone */ }
  });

  strumienZdarzen.onerror = () => {
    // Serwer padł albo sieć znikła. Wznawiamy z rosnącą zwłoką – bez tego
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

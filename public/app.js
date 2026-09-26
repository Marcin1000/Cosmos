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
  /* 2048 to było za mało na rzeczy, o które Marcin realnie prosi. Plan
     tygodniowej wycieczki w tabeli wyczerpywał budżet w połowie sekcji
     „Źródła" i odpowiedź kończyła się w środku adresu. Dokańczanie urwanych
     odpowiedzi to łata; sensowny domyślny budżet to profilaktyka. */
  maxTokens: 4096,
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

/** @param {boolean} natychmiast — pomiń 400 ms zwłoki i wyślij zapis od razu.
 *
 *  Zwłoka jest dobra przy pisaniu (jeden zapis zamiast dziesięciu), ale zła
 *  przed startem generowania: gdy karta zamknie się w tej ćwierci sekundy,
 *  serwer dokończy odpowiedź i nie będzie miał jej gdzie dopisać, bo plik
 *  rozmowy jeszcze nie istnieje. */
function saveConversations(natychmiast = false) {
  clearTimeout(zapisZaChwile);
  zapisZaChwile = null;
  if (!activeConversation) return;
  activeConversation.updatedAt = Date.now();

  // odśwież metadane w indeksie (pasek boczny) i wypłyń na górę
  const i = conversations.findIndex((c) => c.id === activeConversation.id);
  const meta = {
    id: activeConversation.id,
    title: activeConversation.title,
    createdAt: activeConversation.createdAt,
    updatedAt: activeConversation.updatedAt,
    // Pinezka zostaje — nowa wiadomość w przypiętej rozmowie ją zdejmowała do odświeżenia strony.
    pinned: Boolean((i >= 0 && conversations[i].pinned) || activeConversation.pinned),
  };
  if (i >= 0) conversations[i] = meta; else conversations.unshift(meta);
  conversations.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
  renderSidebar();
  cacheConvIndex();

  try { localStorage.setItem('cosmos.conv.' + activeConversation.id, JSON.stringify(activeConversation)); } catch { /* limit */ }

  const conv = activeConversation;
  const id = conv.id;
  clearTimeout(convSaveTimer);
  if (natychmiast) zapiszNaSerwerze(id, conv);
  else convSaveTimer = setTimeout(() => zapiszNaSerwerze(id, conv), 400);
}

/* DWA URZĄDZENIA, JEDNA ROZMOWA. Zapis wysyłał cały dokument, a serwer go
   nadpisywał — telefon z nieaktualną kopią kasował wiadomości napisane
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
        body: JSON.stringify({ ...conv, ...(baza ? { bazaUpdatedAt: baza } : {}) }),
      });
    } catch { return; /* offline — zostaje kopia w localStorage */ }
    const d = await readJsonSafe(r).catch(() => ({}));
    if (r.ok && d.meta) { wersjaNaSerwerze.set(id, d.meta.updatedAt); return; }
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

/* Powrót do karty (telefon wyjęty z kieszeni): świeża wersja aktywnej
   rozmowy, zanim ktoś zacznie pisać do nieaktualnej. */
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !activeId || isGenerating) return;
  const id = activeId;
  try {
    const r = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`);
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

function currentModel() {
  const override = endpoint === 'local' ? settings.modelLocal
    : endpoint === 'cloud' ? settings.modelCloud : '';
  return override || epConfig().model || '';
}

/* Treść wiadomości i mini-renderer Markdown mieszkają w `public/tekst.js`
   — patrz nagłówek tamtego pliku. Wchodzi string, wychodzi string, więc
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
       i zobaczenie zera — czyli uruchomienie zadania, żeby dowiedzieć się,
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
       procent czasu; przy dwustu — kilka. Przy okazji rzadziej płacimy za
       zbudowanie kolejki po stronie serwera. */
    przycisk(t('arch.vision'), (e) => uzupelniajPaczkami({
      przycisk: e.currentTarget, adres: '/api/archive/vision', ile: 200,
      /* Rozbicie na etapy w widocznym miejscu. „1,63 s na zdjęcie" nie mówi,
         co poprawić — te same 1,63 s mogą być wolnym łączem do Microsoftu,
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
      /* „Odczytano z 0 klipów" nie mówi NIC o przyczynie — a przyczyny są trzy
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
     Wcześniej robiło to odłączenie konta — jednym kliknięciem, przy okazji
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
  let ostatni = null;          // ostatnia odpowiedź serwera — do komunikatu końcowego
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
      // `sprawdzone === 0` znaczy „nie ma już czego brać" — bez tego warunku
      // pusta kolejka kręciłaby pętlę w nieskończoność.
      if (paczkiPrzerwane || !w.sprawdzone || !w.zostalo) break;
      /* KOLEJKA MUSI MALEĆ. Gdy każdy plik w paczce kończy się błędem — token
         OneDrive wygasł, zmysły padły w połowie — nic nie ubywa, a warunki
         wyżej są dalej spełnione. To była pętla bez końca waląca w serwer
         co sekundę. Brak postępu kończy zadanie z komunikatem, nie po cichu. */
      if (Number(w.zostalo) >= poprzednioZostalo) {
        /* …ale DŁAWIENIE to nie awaria. Microsoft odpowiada 429 i prosi
           o zwolnienie; poddanie się w tym miejscu było błędem — Marcin
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
          zostalo: w.zostalo, powod: (w.bledy || [])[0] || '—',
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

/* Ile miniatur dobiera jedno kliknięcie „pokaż kolejne". Zostaje tutaj,
   bo korzysta z niej i siatka, i rejestr narzędzi. */
const PORCJA_ARCHIWUM = 24;

/* Budowniczowie widoku (siatki, panele, podglądy) mieszkają
   w `public/widoki.js` — patrz nagłówek tamtego pliku. Tutaj zostaje
   samo podpięcie ich do stanu aplikacji. */
const {
  runPanel, photosGrid, stopkaArchiwum, naKafelek,
  openTextViewer, openImageViewer, closeImageViewer, downloadViewedImage,
} = utworzWidoki({
  t, readJsonSafe, saveConversations, renderMessages,
  msgPhotos, msgDalej, PORCJA_ARCHIWUM,
});

/* Nić rozmowy: każda odpowiedź pamięta, który silnik ją napisał, i nosi jego
   kolor — dokładnie tak, jak pokazuje to strona produktowa. */
function nazwaSilnika(klucz) {
  return klucz === 'cloud' ? 'NVIDIA' : klucz === 'local' ? t('silnik.local')
    : klucz === 'claude' ? 'Claude' : klucz === 'openai' ? 'OpenAI' : '';
}
function podpisSilnika(klucz, model) {
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
  return el;
}
/* Silnik przypięty do TURY. Przełączenie zakładki w trakcie odpowiedzi
   podpisywało odpowiedź chmury jako „lokalny GPU", a kolejne rundy narzędzi
   szły już do innego silnika niż pierwsza. `runGeneration` ustawia go na
   starcie i zdejmuje na końcu. */
let znakTury = null;
const znakSilnika = () => znakTury || ({ silnik: endpoint, model: currentModel() || '' });

function messageElement(m, idx = -1) {
  const role = m.role;
  const text = msgText(m);
  const images = msgImages(m);
  const isError = Boolean(m.error);

  const msg = document.createElement('div');
  msg.className = `msg msg-${role}` + (isError ? ' msg-error' : '') + (m.status ? ' msg-status' : '');

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
      : t('kb.record');
    msg.innerHTML =
      `<div class="action-card">` +
      `<div class="action-card-body"><span class="action-card-type ik ik-blyskawica">${escapeHtml(label.replace(/^✦\s*/, ''))}</span>` +
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
      `<details class="search-results"><summary>${(!m.narzedzie || m.narzedzie === 'szukaj')
        ? t('chat.searchResults', { q: escapeHtml(m.searchQuery || '') })
        : t('chat.toolResult', { n: t(`narzedzie.${m.narzedzie}`), q: escapeHtml(m.searchQuery || '') })}</summary>` +
      `<pre>${escapeHtml(text)}</pre></details>`;
    return msg;
  }

  if (isError) {
    body.textContent = text;
    msg.appendChild(body);
    // Błąd na końcu rozmowy — jedno kliknięcie zamiast przepisywania pytania.
    const conv = activeConv();
    if (idx >= 0 && conv && idx === conv.messages.length - 1) {
      const ponow = document.createElement('button');
      ponow.className = 'msg-action-btn msg-ponow';
      ponow.textContent = '↻ ' + t('chat.ponow');
      ponow.addEventListener('click', () => regenerateFrom(idx));
      body.appendChild(ponow);
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

  const col = document.createElement('div');
  col.className = 'msg-kolumna';
  col.style.flex = '1';
  col.style.minWidth = '0';
  const podpis = !isError && podpisSilnika(m.silnik, m.model);
  if (podpis) col.appendChild(podpis);
  /* Przyciski tylko pod OSTATNIĄ wypowiedzią tury. Pasek postępu („Szukam…")
     i kroki pośrednie to nie odpowiedź — pięć „Regeneruj" pod jedną
     odpowiedzią i „Zapamiętaj" przy „Przeszukuję archiwum…" to szum. */
  const nastepna = idx >= 0 ? activeConv()?.messages[idx + 1] : null;
  const srodekTury = m.status || (nastepna && (nastepna.role === 'assistant'
    || (nastepna.role === 'user' && nastepna.search)));
  col.append(body);
  if (!srodekTury) col.append(messageActions(text, { copy: true, role: 'assistant', idx }));
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

// Edycja w toku: od której wiadomości zostanie ucięta historia przy wysłaniu.
let edycjaOd = null;

function editFrom(idx) {
  const conv = activeConv();
  if (!conv || isGenerating) return;
  const m = conv.messages[idx];
  if (!m) return;
  const text = msgText(m);
  const images = msgImages(m);
  /* Historię tniemy dopiero przy WYSŁANIU poprawionej wiadomości. Cięcie
     przy samym kliknięciu „Edytuj" kasowało dalszą rozmowę od razu i na
     serwerze — kto się rozmyślił, tracił wszystko bez ostrzeżenia. */
  edycjaOd = { convId: conv.id, idx };
  pendingImages = images.length ? [...images] : pendingImages;
  renderAttachments();
  el.input.value = text;
  autosizeInput();
  updateSendButton();
  el.input.focus();
}

function renderMessages({ przewin = true } = {}) {
  const conv = activeConv();
  // Kto czyta wyżej, zostaje tam po przebudowie — bez tego innerHTML = '' ustawiał widok na samą górę.
  const byloScroll = el.chatScroll.scrollTop;
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
  if (przewin) scrollToBottom(true);
  else { el.chatScroll.scrollTop = byloScroll; ostatniScrollTop = byloScroll; }
}

/* Czy człowiek „jedzie" razem z odpowiedzią na dole rozmowy. Decydują
   o tym JEGO ruchy, nie odległość od dołu liczona po fakcie: gdy odpowiedź
   rośnie szybciej, niż da się przewinąć, odległość myli się w jedną stronę
   i widok zostaje w tyle na zawsze. W górę widok może pojechać tylko ręką
   człowieka — program przewija wyłącznie w dół — więc ruch w górę wyłącza
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
  if (sc.scrollTop < ostatniScrollTop - 4) sledzeDol = false;
  else if (przyDole()) sledzeDol = true;
  ostatniScrollTop = sc.scrollTop;
}, { passive: true });
el.chatScroll.addEventListener('wheel', (e) => { if (e.deltaY < 0) sledzeDol = false; }, { passive: true });

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
  zapamietajOstatnia(null);
  activeConversation = null;
  renderSidebar();
  renderMessages();
  collapseSidebarOnMobile();
  el.input.focus();
}

/* Rozmowy zapisane, zanim ruch narzędzia dostał flagę `search`, wciąż mają
   w środku dymek z pytaniem, którego nikt nie zadał. Poprawka w kodzie ich nie
   naprawi — siedzą już na dysku. Domykamy je przy wczytaniu; to zmiana tylko
   w wyglądzie, treść dalej idzie do modelu tak samo. */
const PREFIKSY_NARZEDZI = [
  'UWAGA: to jest DOKŁADNIE to samo zapytanie do archiwum',
  'WYNIK Z ARCHIWUM UŻYTKOWNIKA',
  'WYNIKI WYSZUKIWANIA',
  'WYSZUKIWANIE GRAFIK NIE DAŁO WYNIKÓW',
  'DANE PLANU ZDJĘCIOWEGO',
];
function naprawStareRuchyNarzedzi(conv) {
  if (!conv?.messages) return conv;
  for (const m of conv.messages) {
    if (m.role !== 'user' || m.search || typeof m.content !== 'string') continue;
    if (PREFIKSY_NARZEDZI.some((p) => m.content.startsWith(p))) {
      m.search = true;
      m.searchQuery = m.searchQuery || t('chat.archiveQuery');
    }
  }
  return conv;
}

/* Ostatnio otwarta rozmowa — żeby zwykłe odświeżenie strony nie wyrzucało
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
  if (isGenerating) stopGeneration();
  activeId = id;
  zapamietajOstatnia(id);
  renderSidebar();
  collapseSidebarOnMobile();
  /* Od razu kopia z przeglądarki, jeśli jest — bez pustego ekranu i skoku
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
  } catch { /* offline — zostaje kopia */ }
  /* Człowiek mógł w tym czasie stuknąć inną rozmowę. Bez tego sprawdzenia
     panel podświetlał B, na ekranie stała A, a następna wiadomość zapisywała
     się w A — najwolniejsza odpowiedź wygrywała wyścig. */
  if (activeId !== id) return;
  if (!zSerwera) {
    if (!kopia) { activeConversation = null; renderMessages(); }
    return;
  }
  const taSama = kopia && kopia.updatedAt === zSerwera.updatedAt
    && (kopia.messages || []).length === (zSerwera.messages || []).length;
  wersjaNaSerwerze.set(id, zSerwera.updatedAt);
  activeConversation = zSerwera;
  if (!taSama) renderMessages();
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
  conv.messages.forEach((m, i) => {
    if (m.error || m.role === 'action' || m.status) return;
    let text = msgText(m);
    const images = i === granica ? msgImages(m) : [];
    if (i !== granica && msgImages(m).length && m.role === 'user') {
      text = `(tu użytkownik pokazał zdjęcie${msgImages(m).length > 1 ? 'a' : ''})` + (text ? `\n${text}` : '');
    }
    if (m.search && i < granica) {
      text = `(wcześniejszy wynik narzędzia: ${m.searchQuery || 'dane'} — już wykorzystany w odpowiedzi)`;
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
      // nie wracają do API — wysyłamy sam tekst. Pustej wypowiedzi nie
      // wysyłamy wcale: część dostawców (Claude) ją odrzuca.
      if (!String(text || '').trim()) return;
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
   skończy. Kolejka jest widoczna nad polem i da się z niej wyjąć wpis —
   „wyślę to za chwilę" musi być odwracalne, bo w połowie odpowiedzi często
   okazuje się, że pytanie było niepotrzebne. */
let kolejka = [];

/* Kolejka i niewysłany szkic przeżywają odświeżenie i ubicie aplikacji
   w tle (Android robi to bez pytania) — dawniej ginęły. Klucze pod
   `cosmos.conv.`, więc znikają przy zmianie osoby (konta.js). */
const KLUCZ_KOLEJKI = 'cosmos.conv.kolejka';
const KLUCZ_SZKICU = 'cosmos.conv.szkic';
function zapamietajKolejke() {
  try {
    if (kolejka.length) localStorage.setItem(KLUCZ_KOLEJKI, JSON.stringify(kolejka));
    else localStorage.removeItem(KLUCZ_KOLEJKI);
  } catch { /* za duża (zdjęcia) albo bez pamięci — zostaje w tej karcie */ }
}

function renderKolejka() {
  zapamietajKolejke();
  const box = $('queue-box');
  if (!box) return;
  box.innerHTML = '';
  box.hidden = !kolejka.length;
  if (!kolejka.length) return;
  for (const [i, poz] of kolejka.entries()) {
    const el2 = document.createElement('div');
    el2.className = 'queue-item';
    const txt = document.createElement('span');
    txt.className = 'queue-text';
    // `poz.images` to LICZBA załączników, nie tablica — samo zdjęcie bez
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

/** Po zakończeniu generowania — wyślij następną z kolejki. */
async function ruszKolejke() {
  if (isGenerating || !kolejka.length) return;
  const poz = kolejka.shift();
  renderKolejka();
  const conv = ensureConversation(poz.text || '');
  conv.messages.push({ role: 'user', content: poz.content });
  saveConversations(true);          // patrz sendMessage — zaraz rusza generowanie
  renderSidebar();
  renderMessages();
  await runGeneration(conv);
  // Kolejka bywa dłuższa niż jedna pozycja — po tej odpowiedzi bierzemy następną.
  ruszKolejke();
}

async function sendMessage() {
  const text = el.input.value.trim();
  const gotowe = pendingDocs.filter((d) => !d.loading);
  if (!text && !pendingImages.length && !gotowe.length) return;

  /* Cosmos jeszcze mówi — bierzemy wiadomość do kolejki zamiast ją zgubić.
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
    kolejka.push({ text, content, images: pendingImages.length });
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
  // Bez zwłoki: za chwilę ruszy generowanie, które ma prawo przeżyć zamknięcie
  // karty — a serwer dopisze odpowiedź tylko do rozmowy, która już istnieje.
  saveConversations(true);

  el.input.value = '';
  autosizeInput();
  renderSidebar();
  renderMessages();

  await runGeneration(conv);
}

// jedno przejście streamingu — zwraca zebrany tekst odpowiedzi
/* ============ BIEG: ODPOWIEDŹ ŻYJE NA SERWERZE ============
   Marcin: „Jak wychodzę ze strony lub aplikacji (…) wszystko jest przerywane
   i jest napisane że connection error. Chciałbym żeby to działało też w tle."

   Serwer prowadzi odpowiedź do końca niezależnie od tego, czy przeglądarka
   patrzy (lib/biegi.js). Tutaj jest druga połowa: przeglądarka pamięta numer
   biegu i numer ostatniego odebranego zdarzenia, więc po zerwaniu Wi-Fi,
   zgaszeniu ekranu albo odświeżeniu strony wraca dokładnie w to miejsce.

   Nie ma tu ponawiania zapytania do modelu. Wracamy do TEJ SAMEJ odpowiedzi,
   nie prosimy o nową — druga odpowiedź na to samo pytanie kosztuje tokeny
   i bywa inna niż ta, którą użytkownik zdążył zobaczyć. */
const BIEG_KLUCZ = 'cosmos.bieg';
const BIEG_PROB = 6;

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
  } catch { /* tryb prywatny — trudno, zostaje wznowienie w tej samej karcie */ }
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
  }).catch(() => { /* nie doleciało — serwer zapisze sam, czyli bezpiecznie */ });
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

  /* Malowanie przebudowuje całą odpowiedź, więc kosztuje tym więcej, im jest
     dłuższa. Na telefonie długa odpowiedź zajmowała 78% wątku głównego,
     a pisanie w polu szło 3× wolniej. Odstęp między malowaniami rośnie z ich
     kosztem — wątek ma zawsze co najmniej tyle wolnego, ile zjadło malowanie. */
  let czasMalowania = 0;
  let ostatnieMalowanie = 0;
  const paint = () => {
    renderQueued = false;
    const t0 = performance.now();
    /* Myślenie z `<think>` w treści idzie do panelu myślenia, a znaczniki
       i ich urwane początki nie migają na ekranie w trakcie pisania. Panel
       myślenia jest zwinięty — rozumowanie bywa po angielsku i pełne
       deliberacji; kto chce, rozwinie. */
    const { think: thinkWTresci } = rozdzielMyslenie(acc);
    const widok = widokWToku(acc);
    const calyThink = [think, thinkWTresci].filter(Boolean).join('\n');
    const head = calyThink
      ? '<details class="think-block">'
        + `<summary>${escapeHtml(t(widok ? 'think.done' : 'think.live'))}</summary>`
        + `<pre>${escapeHtml(calyThink)}</pre></details>`
      : '';
    body.innerHTML = head + `<div class="strumien-tresc">${renderMarkdown(widok)}</div>` + waitNote;
    /* Kursor na końcu OSTATNIEGO zdania, nie w osobnej linii pod tekstem —
       jak na stronie produktowej. Szukamy ostatniego bloku tekstu (akapit,
       punkt listy, nagłówek); bloki kodu zostawiamy w spokoju. */
    const tresc = body.querySelector('.strumien-tresc');
    const kursor = document.createElement('span');
    kursor.className = 'cursor-blink';
    const koniec = tresc.lastElementChild;
    const bloki = koniec && !/^(PRE|TABLE|DIV)$/.test(koniec.tagName)
      ? koniec.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6') : [];
    const cel = bloki.length ? bloki[bloki.length - 1] : (koniec && /^(P|H[1-6])$/.test(koniec.tagName) ? koniec : tresc);
    cel.appendChild(kursor);
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

  /* Podpięcie do biegu, który już trwa (po odświeżeniu strony), albo nowy
     bieg. W obu razach numer znamy PRZED wysłaniem żądania — inaczej zerwanie
     połączenia w pierwszej sekundzie zostawiłoby odpowiedź bez adresu. */
  lastFinish = '';
  const podpiecie = Boolean(opcje.bieg);
  const biegId = opcje.bieg || nowyBiegId();
  zapamietajBieg({ id: biegId, convId: conv.id, ostatnie: (Number(opcje.od) || 0) - 1 });

  try {
    const modelOverride = znakTury ? znakTury.nadpisanie
      : ep === 'local' ? settings.modelLocal : ep === 'cloud' ? settings.modelCloud : '';
    let res = podpiecie
      ? await fetch(`/api/chat/bieg?id=${encodeURIComponent(biegId)}&od=${Number(opcje.od) || 0}`,
        { signal: abortController.signal })
      : await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: ep,
          // `dodatkowe` to dopisek na jedną turę, poza historią rozmowy —
          // służy dokańczaniu odpowiedzi uciętej limitem długości.
          messages: [...toApiMessages(conv), ...(opcje.dodatkowe || [])],
          model: modelOverride || undefined,
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          kbSelected: [...kbSelected],
          useSearch: settings.offline ? false : undefined,
          // odpowiedź będzie czytana na głos — model ma mówić, nie pisać
          trybGlosowy: voiceMode || undefined,
          bieg: biegId,
          rozmowa: conv.id,
        }),
        signal: abortController.signal,
      });

    if (!res.ok) {
      let errText = t('httpErr', { status: res.status });
      try {
        const data = await readJsonSafe(res);
        errText = data.error || errText;
      } catch { /* ignore */ }
      zapamietajBieg(null);
      throw new Error(errText);
    }

    // Serwer mógł skierować zdjęcie do modelu wizyjnego. Podmiana za plecami
    // użytkownika byłaby nieuczciwa — mówimy, kto naprawdę odpowiedział.
    const swapped = res.headers.get('X-Cosmos-Model-Swapped-From');
    const used = decodeURIComponent(res.headers.get('X-Cosmos-Model') || '');
    // Na silniku przyznanym przez właściciela członek dostaje model z jego listy.
    const spozaListy = res.headers.get('X-Cosmos-Model-Spoza-Listy');
    // Lokalny model z małym oknem: najstarsze wiadomości nie poszły do modelu — mówimy ile.
    const [okno, przyciete] = String(res.headers.get('X-Cosmos-Okno') || '').split(';').map(Number);
    lastModelNote = [
      spozaListy ? t('model.przyznany', { from: decodeURIComponent(spozaListy), to: used }) : '',
      swapped ? t('model.swapped', { from: decodeURIComponent(swapped), to: used }) : '',
      przyciete ? t('model.okno', { n: przyciete, okno }) : '',
    ].filter(Boolean).join(' ');

    const decoder = new TextDecoder();
    let buffer = '';
    let koniecBiegu = false;      // serwer powiedział „to już wszystko"
    let bladBiegu = '';
    let proby = 0;

    /* Jedno zdarzenie SSE. `id:` to numer nadany przez serwer — po nim wracamy
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
          try { bladBiegu = JSON.parse(data).blad || ''; } catch { /* bez szczegółów */ }
          continue;
        }
        /* Serwer nie pamięta początku tej odpowiedzi (bufor urwany limitem).
           Mówimy o tym wprost — pokazanie samego dalszego ciągu wyglądałoby
           jak odpowiedź, która zaczyna się w połowie zdania. */
        if (typ === 'luka') { acc += t('bieg.luka') + '\n\n'; schedulePaint(); continue; }
        try {
          const json = JSON.parse(data);
          const d = json.choices?.[0]?.delta || {};
          /* Powód zakończenia. „length" znaczy: model NIE skończył zdania,
             tylko wyczerpał budżet tokenów. Przez długi czas nikt tego nie
             czytał i odpowiedź urywała się w pół adresu — Marcin dostał plan
             Majorki kończący się na „…wynajem-samochodu". */
          const powod = json.choices?.[0]?.finish_reason;
          if (powod) lastFinish = powod;
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
    };

    /* Pętla przeżywania. Zerwane połączenie NIE jest tu błędem — jest
       normalnym stanem telefonu, który zgasił ekran. Wracamy do biegu od
       ostatniego numeru; poddajemy się dopiero, gdy serwer przestaje o nim
       wiedzieć albo gdy nie da się wrócić po kilku próbach. */
    while (!koniecBiegu) {
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

      // Strumień się skończył, a serwer nie powiedział „koniec”. Wracamy.
      if (++proby > BIEG_PROB) {
        if (rozlaczone) throw new Error(t('bieg.zerwane'));
        break;                       // serwer bez biegów — kończymy po staremu
      }
      await pauza(Math.min(8000, 500 * 2 ** (proby - 1)));
      const od = (biegBiezacy?.ostatnie ?? -1) + 1;
      let wrot;
      try {
        wrot = await fetch(`/api/chat/bieg?id=${encodeURIComponent(biegId)}&od=${od}`,
          { signal: abortController.signal });
      } catch (err) {
        if (abortController.signal.aborted) throw err;
        continue;                    // sieci nadal nie ma — próbujemy dalej
      }
      /* 404 = serwer już nie pamięta tego biegu. Przy podpięciu po odświeżeniu
         to zwykły koniec (odpowiedź wylądowała w rozmowie), przy zerwaniu
         w locie — utrata. W obu razach nie ma czego dalej czytać. */
      if (!wrot.ok) break;
      res = wrot;
    }
    clearInterval(waitTimer);
    zapamietajBieg(null);
    /* „Mam tę odpowiedź." Bez tego serwer po dwudziestu sekundach dopisze ją
       do rozmowy jeszcze raz, bo z jego strony wygląda to jak odpowiedź, po
       którą nikt nie przyszedł. Zgadywanie po tym, czy gniazdo było otwarte,
       już próbowaliśmy — myliło się w obie strony. */
    potwierdzOdbior(biegId);
    if (bladBiegu) {
      // Napisany już fragment idzie razem z błędem — wyżej trafi do rozmowy.
      const e = new Error(bladBiegu);
      e.partial = rozdzielMyslenie(acc).tresc;
      throw e;
    }
    // `<think>` w treści to myślenie, nie odpowiedź — i nie wolno z niego
    // wyławiać znaczników narzędzi.
    {
      const r = rozdzielMyslenie(acc);
      if (r.think) { think = [think, r.think].filter(Boolean).join('\n'); acc = r.tresc; }
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
    zapamietajBieg(null);
    // Przerwanie i zerwanie też niosą to, co już przyszło.
    if (err.partial === undefined) err.partial = err.name === 'AbortError' ? acc : rozdzielMyslenie(acc).tresc;
    /* Brak sieci: przeglądarka mówi „Failed to fetch" po angielsku i nie mówi,
       co zrobić. Po ludzku i z radą. */
    if (err.name === 'TypeError' && /fetch|network|load failed/i.test(err.message || '')) {
      const poLudzku = new Error(t('chat.offlineSend'));
      poLudzku.partial = err.partial;
      throw poLudzku;
    }
    throw err;
  }
}

/* Powrót do odpowiedzi, która powstawała, gdy strona była zamknięta.
   Wywoływane raz, przy starcie. Nie pyta o nic modelu — podpina się do tego,
   co serwer już policzył albo właśnie liczy. */
async function wznowBieg() {
  let zapis = null;
  try { zapis = JSON.parse(localStorage.getItem(BIEG_KLUCZ) || 'null'); } catch { /* śmieci */ }
  if (!zapis || !zapis.id) return;

  let dane;
  try {
    const r = await fetch('/api/chat/biegi');
    if (!r.ok) return;
    dane = await r.json();
  } catch { return; }                 // serwer offline — wznowienie poczeka

  const b = (dane.biegi || []).find((x) => x.id === zapis.id);
  /* Bieg skończył się, gdy nas nie było. Serwer zapisał odpowiedź do rozmowy
     sam (lib/biegi.js), więc nie ma czego dociągać — wystarczy posprzątać
     znacznik, żeby nie próbować w nieskończoność. */
  if (!b || !b.trwa) { zapamietajBieg(null); return; }

  const conv = zapis.convId && activeId === zapis.convId ? activeConversation : null;
  if (!conv) {
    // Rozmowa z biegiem nie jest tą otwartą — przełączamy się na nią.
    if (!zapis.convId) { zapamietajBieg(null); return; }
    await selectConversation(zapis.convId);
    if (!activeConversation) { zapamietajBieg(null); return; }
  }
  const cel = activeConversation;
  if (!cel) { zapamietajBieg(null); return; }
  /* Od zera, nie od zapamiętanego numeru. Po przeładowaniu ekran jest pusty,
     więc potrzebujemy CAŁEJ odpowiedzi — wznowienie od połowy pokazałoby
     wypowiedź zaczynającą się w środku zdania. Numer w zapisie służy tylko
     wznowieniu bez przeładowania (zerwane Wi-Fi), gdzie początek już jest
     narysowany, i tam siedzi w pamięci, nie w localStorage. */
  await runGeneration(cel, { bieg: zapis.id, od: 0 });
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
 *  źródła — model wyczerpał `max_tokens` na środku zdania, a Cosmos pokazywał
 *  ten kikut jak gotową odpowiedź.
 *
 *  Nie pytamy o odpowiedź od nowa: to kosztuje drugie tyle tokenów i daje
 *  INNY tekst niż ten, który użytkownik zdążył przeczytać. Prosimy o dalszy
 *  ciąg i doklejamy go do tego, co już jest.
 */
const DOPISKI_MAX = 3;
async function dokoncz(conv, tekst) {
  /* Pusta treść przy „length" = cały budżet poszedł na myślenie. Drugie
     żądanie znaczyłoby drugi pełny przebieg myślenia i zwykle ten sam wynik. */
  if (!String(tekst || '').trim()) return tekst;
  let pelny = tekst;
  for (let i = 0; i < DOPISKI_MAX && lastFinish === 'length'; i++) {
    const ciag = await streamOnce(conv, {
      dodatkowe: [
        { role: 'assistant', content: pelny },
        { role: 'user', content: 'Twoja odpowiedź urwała się, bo skończył się '
          + 'budżet długości — nie dlatego, że skończyłeś. Kontynuuj DOKŁADNIE '
          + 'od miejsca, w którym przerwałeś: bez powtarzania napisanego, bez '
          + 'wstępu, bez przepraszania. Jeśli urwało się w połowie słowa albo '
          + 'adresu, dokończ to słowo. Doprowadź odpowiedź do końca.' },
      ],
    });
    if (!ciag.trim()) break;
    // Bez spacji: ciąg dalszy potrafi zacząć się w środku wyrazu. A często
    // zaczyna od powtórzenia ostatnich słów — tę zakładkę zdejmujemy.
    pelny = doklejBezZakladki(pelny, ciag);
  }
  return pelny;
}

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

/* Znaczniki modelu i wynik archiwum → kontekst: `public/protokol.js`.
   Czysty tekst, bez DOM-u i bez stanu, więc daje się sprawdzić w Node
   — patrz nagłówek tamtego pliku. */
const {
  SEARCH_MARKER_RE, IMAGE_MARKER_RE, PHOTO_MARKER_RE, RUN_FENCE_RE,
  CANVAS_NEW_RE, CANVAS_PATCH_RE, ARCHIVE_RE, PLAN_RE, ACTION_RE,
  ZNACZNIKI, ARCH_LIMIT_ZNAKOW, stripSearchMarker, rozdzielMyslenie, widokWToku, wstawZnacznikiZdjec, naKontekst, bezOgonkowKlient,
  scalRozmowy,
} = utworzProtokol();

/* Wynik narzędzia wraca do modelu jako wiadomość użytkownika — bo tak wygląda
   protokół rozmowy — ale UŻYTKOWNIK niczego nie napisał. Jedyne, co odróżnia
   jedno od drugiego na ekranie, to flaga `search`: z nią mamy zwijany blok
   „Przeszukuję…", bez niej zwykły dymek z pytaniem, którego nikt nie zadał.
   Zapomniano jej raz i wyglądało to jak rozmowa wznawiająca się sama.
   Dlatego wszystkie ruchy narzędzi idą tędy i flagi nie da się pominąć. */
// Które narzędzie właśnie pracuje — żeby wynik archiwum nie był podpisany „Wyniki wyszukiwania".
let narzedzieTeraz = '';
function dodajWynikNarzedzia(conv, tresc, etykieta) {
  conv.messages.push({ role: 'user', content: tresc, search: true, searchQuery: etykieta, narzedzie: narzedzieTeraz || undefined });
  saveConversations();
  renderMessages();
}

/* Rejestr narzędzi. Budowany RAZ, przy wczytaniu skryptu — zależności są
   stałe, a lista musi być ta sama dla każdej tury. Wszystko, co narzędzia
   potrafią, siedzi w `public/narzedzia.js`; tutaj zostaje sama pętla. */
const NARZEDZIA = utworzNarzedzia({
  t,
  saveConversations,
  renderMessages,
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
  znakSilnika,
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

/** Domknij turę odpowiedzią modelu — JEDNO miejsce dla wszystkich narzędzi.
 *
 *  Ta logika była wcześniej przepisana trzy razy: przy wyczerpaniu limitu
 *  wyszukiwań, przy wyczerpaniu limitu zdjęć i na końcu pętli. Dwie kopie
 *  ustawiały `samoMyslenie`, trzecia nie — więc model rozumujący, któremu
 *  budżet tokenów poszedł w całości na myślenie, po zdjęciach pokazywał
 *  surowe rozumowanie zamiast komunikatu. Nikt tego nie zgłosił, bo trzeba
 *  trafić w rzadki zbieg okoliczności; kopiowanie kodu samo w sobie
 *  wystarczyło, żeby te trzy ścieżki się rozjechały.
 *
 *  @param {object} conv rozmowa
 *  @param {string} surowe treść od modelu (może być urwana)
 *  @returns {string} tekst do wypowiedzenia głosem albo pusty
 */
/* JEDNO WEJŚCIE NA TEKST MODELU — i jedna zapora przed powtórką.

   Marcin dostał w jednej turze TRZY kopie planu Majorki. Model po każdym
   wyniku narzędzia przepisywał całość od nowa, a każda runda to osobna
   wiadomość w rozmowie. Instrukcja „dopisz tylko to, czego jeszcze nie
   napisałeś" pomaga, ale nie jest gwarancją — model bywa uparty, a użytkownik
   ogląda skutek.

   Dlatego przepisana odpowiedź nie ląduje obok poprzedniej, tylko JĄ
   ZASTĘPUJE. Nowa wersja jest z definicji pełniejsza (model zna już wynik
   narzędzia), więc podmiana niczego nie gubi — a rozmowa zostaje czytelna.
   Szukamy tylko wśród wypowiedzi z BIEŻĄCEJ tury: powtórzenie planu sprzed
   pół godziny jest odpowiedzią na nowe pytanie i ma prawo zostać. */
function wstawTekstModelu(conv, tresc, odKtorej = 0) {
  const czysty = String(tresc || '');
  if (!czysty.trim()) return null;
  for (let i = conv.messages.length - 1; i >= odKtorej; i--) {
    const m = conv.messages[i];
    if (m.role !== 'assistant' || typeof m.content !== 'string') continue;
    if (przepisanie(m.content, czysty)) {
      m.content = czysty;
      return m;
    }
  }
  const wiadomosc = { role: 'assistant', content: czysty, ...znakSilnika() };
  conv.messages.push(wiadomosc);
  return wiadomosc;
}

async function domknijOdpowiedz(conv, surowe) {
  // Urwane w pół zdania to nie jest gotowa odpowiedź — dokańczamy.
  const pelne = await dokoncz(conv, surowe);
  /* Akcję szukamy w SUROWYM tekście: `stripSearchMarker` czyści też [AKCJA:],
     więc po nim karta do zatwierdzenia nie pojawiała się nigdy — model pisał
     „zapamiętam", a nic się nie działo. */
  const akcja = pelne.match(ACTION_RE);
  const tresc = stripSearchMarker(pelne);
  /* Pusta treść przy modelu rozumującym znaczy „budżet tokenów poszedł
     w całości na myślenie". Kiedyś wyrzucaliśmy wtedy surowy tok myślenia
     jako odpowiedź — gorsze niż nic: rozumowanie jest po angielsku, urwane
     i pokazuje deliberację, której użytkownik widzieć nie powinien. */
  /* Pusto, ale tura już coś pokazała (zdjęcia, wstęp przed narzędziem) —
     sami każemy modelowi „napisz domknięcie albo nic", więc „nic" jest
     poprawne i nie zasługuje na dopisek „(pusta odpowiedź modelu)". */
  if (!tresc && !akcja) {
    const tura = conv.messages.slice(conv.__turaOd || 0);
    const widac = (m) => m.role === 'assistant' && !m.status && !m.error
      && (msgText(m).trim() || (m.content && typeof m.content === 'object'
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
  // Dostawca uciął odpowiedź filtrem treści — wygląda jak zwykła, więc mówimy to wprost.
  if (lastFinish === 'content_filter') lastModelNote = [lastModelNote, t('model.filtr')].filter(Boolean).join(' ');

  if (akcja) {
    const widoczne = tresc;
    conv.messages.push({ role: 'assistant', content: widoczne || '…',
      think: lastThink, note: lastModelNote, ...znakSilnika() });
    conv.messages.push({ role: 'action',
      actionType: akcja[1].trim().toLowerCase(), actionText: akcja[2].trim() });
    saveConversations();
    return widoczne;
  }
  const wiadomosc = wstawTekstModelu(conv, finalText, conv.__turaOd || 0);
  if (wiadomosc) Object.assign(wiadomosc, { think: lastThink, note: lastModelNote, samoMyslenie, ...znakSilnika() });
  saveConversations();
  return finalText;
}

async function runGeneration(conv, podpiecie = null) {
  isGenerating = true;
  setGeneratingUI(true);
  if (voiceMode) setVoiceState('thinking');
  let finalText = '';

  const MAX_SEARCHES = 3;
  /* Pamięć jednej tury. Model potrafi wywołać trzy razy DOKŁADNIE ten sam
     filtr i trzy razy dostać to samo zero — widać to było w rozmowie
     o Mazurach, gdzie „Przeszukuję Twoje archiwum…" pojawiło się kilka razy
     pod rząd bez zmiany parametrów. Limit głębokości tego nie łapie, bo
     formalnie to różne kroki. To samo dotyczy zdjęć. */
  const stan = { archiwum: new Set(), grafiki: new Set(), plan: new Set(), archiwumZWynikiem: false, grafikiOdlozone: new Set() };
  // Od której wiadomości zaczyna się ta tura — dalej nie szuka zapora powtórek.
  conv.__turaOd = conv.messages.length;
  znakTury = {
    silnik: endpoint, model: currentModel() || '',
    nadpisanie: endpoint === 'local' ? settings.modelLocal : endpoint === 'cloud' ? settings.modelCloud : '',
  };

  try {
    for (let depth = 0; depth <= MAX_SEARCHES; depth++) {
      /* Podpięcie dotyczy WYŁĄCZNIE pierwszego przebiegu: wracamy do
         odpowiedzi, która już powstaje. Kolejne rundy pętli narzędzi to nowe
         zapytania do modelu i mają dostać własne biegi. */
      const acc = await streamOnce(conv, depth === 0 && podpiecie ? podpiecie : {});
      const ostatnia = depth === MAX_SEARCHES;

      /* Które narzędzie zawołał model. Kolejność sprawdzania jest kolejnością
         na liście w `narzedzia.js` i tam też jest wyjaśniona. */
      let uzyte = null;
      let dop = null;
      for (const narzedzie of NARZEDZIA) {
        const m = narzedzie.dopasuj(acc);
        if (m) { uzyte = narzedzie; dop = m; break; }
      }

      if (!uzyte) {
        /* Model napisał gotową odpowiedź bez odłożonych zdjęć — dokładamy je
           sami pod nią, zamiast je zgubić. */
        const zapomniane = [...stan.grafikiOdlozone].filter((q) => !stan.grafiki.has(bezOgonkowKlient(q)));
        if (zapomniane.length && !ostatnia) {
          /* Znaczniki stawiamy sami — pod akapitami, które mówią o danym
             miejscu — i puszczamy przez narzędzie zdjęć. Ono odtwarza układ:
             kawałek odpowiedzi, siatka pod nim, kolejny kawałek. */
          narzedzieTeraz = 'grafiki';
          const zZnacznikami = wstawZnacznikiZdjec(stripSearchMarker(acc), zapomniane.slice(0, 10));
          const g = NARZEDZIA.find((n) => n.nazwa === 'grafiki');
          const przed = conv.messages.length;
          await g.wykonaj({ acc: zZnacznikami, dop: g.dopasuj(zZnacznikami), conv, depth, ostatnia, przed: '', stan });
          stan.grafikiOdlozone.clear();
          // Zdjęć nie znaleziono — narzędzie nie wstawiło tekstu. Odpowiedź musi się pokazać i tak.
          const tekstJest = conv.messages.slice(przed).some((m) => m.role === 'assistant' && typeof m.content === 'string' && !m.status);
          finalText = tekstJest ? stripSearchMarker(acc) : await domknijOdpowiedz(conv, acc);
          break;
        }
        finalText = await domknijOdpowiedz(conv, acc);
        break;
      }

      /* Limit rund wyczerpany, a model wciąż sięga po narzędzie. Zamiast
         pokazać użytkownikowi surowy znacznik — a tak działo się kiedyś —
         mówimy modelowi, że ma dokończyć tekstem, i domykamy turę tą samą
         drogą co zawsze. */
      if (ostatnia && !uzyte.zawszeDozwolone) {
        /* Każde narzędzie dostaje komunikat o limicie — także archiwum, plan
           i kod. Bez niego tura kończyła się samą zapowiedzią („Teraz jeszcze
           Twoje archiwum.") i ciszą. */
        const limit = uzyte.gdyLimit ? uzyte.gdyLimit(dop) : {
          tresc: 'LIMIT NARZĘDZI W TEJ TURZE WYCZERPANY — nie używaj już żadnych znaczników. '
            + 'Dokończ teraz odpowiedź tekstem na podstawie tego, co już masz, a jeśli '
            + 'czegoś nie zdążyłeś sprawdzić, powiedz to jednym zdaniem.',
          etykieta: uzyte.nazwa,
        };
        narzedzieTeraz = uzyte.nazwa;
        dodajWynikNarzedzia(conv, limit.tresc, limit.etykieta);
        const ostatniaTresc = await streamOnce(conv);
        finalText = await domknijOdpowiedz(conv, ostatniaTresc);
        break;
      }

      /* DWA NARZĘDZIA W JEDNEJ ODPOWIEDZI — a wolno było tylko jedno.
         Marcin poprosił o plan Majorki „ze zdjęciami i grafikami". Model
         napisał plan, a pod nim [PLAN: …] ORAZ sześć [GRAFIKA: …]. Kaskada
         brała pierwsze pasujące narzędzie z listy — czyli plan — a wszystkie
         pozostałe znaczniki czyściła z tekstu i wyrzucała. Prośba o zdjęcia
         znikała bez śladu. Model, dostawszy dane planu, pisał całość od nowa
         (znowu ze znacznikami), plan znowu wygrywał, zdjęcia znowu przepadały
         — i tak aż do wyczerpania rund. Efekt: trzy kopie planu na ekranie
         i ani jednego zdjęcia.

         Zdjęcia dokładamy więc po narzędziu, które wygrało. Wtedy to ONE
         odtwarzają układ tekstu (kawałek planu, siatka pod nim), więc
         zwycięzcy odbieramy emisję tekstu — inaczej plan stałby na ekranie
         dwa razy. */
      const grafikiTez = uzyte.nazwa !== 'grafiki'
        ? NARZEDZIA.find((n) => n.nazwa === 'grafiki')
        : null;
      const dopGrafiki = grafikiTez && grafikiTez.dopasuj(acc);
      const przedTekst = stripSearchMarker(acc.replace(dop[0], ''));
      // Szkic przy odłożonych zdjęciach nie idzie na ekran — patrz niżej.
      const przedDoPokazania = dopGrafiki ? '' : przedTekst;

      narzedzieTeraz = uzyte.nazwa;
      const wynik = await uzyte.wykonaj({
        acc,
        dop,
        conv,
        depth,
        ostatnia,
        // Tekst modelu sprzed znacznika — WSZYSTKIE znaczniki wyczyszczone.
        przed: przedDoPokazania,
        stan,
      });

      if (wynik && wynik.akcja === 'koniec') {
        finalText = wynik.finalGlos || wynik.finalText || '';
        break;
      }

      /* Zdjęcia ODKŁADAMY do gotowej odpowiedzi. Rozłożone pod szkicem
         sprzed danych dawały dwa sprzeczne plany na ekranie: szkic z „6:40"
         pocięty zdjęciami i właściwy plan z „6:52" pod spodem. Model dostaje
         prośbę, żeby postawił znaczniki zdjęć pod punktami gotowej wersji —
         a gdy zapomni, dokładamy je sami na końcu tury. */
      if (dopGrafiki) {
        const WZ = new RegExp(PHOTO_MARKER_RE.source, 'gi');
        for (const g of acc.matchAll(WZ)) {
          for (const q of g[1].split(';').map((x) => x.trim()).filter(Boolean)) stan.grafikiOdlozone.add(q);
        }
        narzedzieTeraz = 'grafiki';
        dodajWynikNarzedzia(conv,
          'ZDJĘCIA JESZCZE NIE POKAZANE. Napisz teraz gotową odpowiedź na podstawie danych powyżej '
          + 'i postaw [GRAFIKA: …] pod właściwymi punktami — tak jak w szkicu, ale w ostatecznej wersji. '
          + 'Nie powtarzaj szkicu.',
          t('chat.photosQuery'));
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      /* Przerwana odpowiedź też przechodzi przez czyszczenie znaczników.
         To jedyna droga, którą tekst z modelu trafiał na ekran surowy —
         a przerywa się najczęściej wtedy, gdy coś trwa za długo, czyli
         dokładnie w trakcie sięgania po narzędzie. */
      const czesc = stripSearchMarker(err.partial);
      if (czesc) {
        conv.messages.push({ role: 'assistant', content: czesc, ...znakSilnika() });
        saveConversations();
      }
    } else {
      /* Błąd w połowie odpowiedzi (dostawca przeciążony, zerwane połączenie):
         napisany fragment zostaje, a pod nim — co się stało. Dawniej znikał
         razem z błędem, choć bywał długi i kompletny w trzech czwartych. */
      const czesc = stripSearchMarker(err.partial || '');
      if (czesc) conv.messages.push({ role: 'assistant', content: czesc, ...znakSilnika() });
      conv.messages.push({ role: 'assistant', content: `⚠︎ ${err.message}`, error: true });
      saveConversations();
      if (voiceMode) finalText = t('voice.errReply');
    }
  } finally {
    isGenerating = false;
    abortController = null;
    znakTury = null;
    setGeneratingUI(false);
    /* Zapis bez zwłoki. Przeglądarka właśnie potwierdziła serwerowi, że ma
       odpowiedź, więc awaryjna kopia po jego stronie już nie powstanie —
       te 400 ms zwłoki byłyby jedynym momentem, w którym gotowa odpowiedź
       nie istnieje nigdzie poza pamięcią karty. */
    saveConversations(true);
    /* Koniec odpowiedzi nie ściąga na dół kogoś, kto przewinął do początku,
       żeby czytać — tak było: 5600 px lotu w dół w chwili zakończenia. */
    renderMessages({ przewin: sledzeDol });
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
      /* Kolejka rusza dopiero TU, po `isGenerating = false` i po odmalowaniu
         ekranu. W trybie głosowym jej nie ruszamy — tam rozmowa idzie
         mikrofonem i dorzucanie pisanych wiadomości mieszałoby dwa kanały. */
      ruszKolejke();
    }
  }
}

function stopGeneration() {
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
  // Po dopracowaniu przycisk to „przywróć moją wersję" — nie może zniknąć
  // tylko dlatego, że model oddał krótszy tekst.
  btn.hidden = isGenerating || (!polishPrevious && el.input.value.trim().length < 25);
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
  /* `isGenerating` NIE blokuje już wysyłania — wiadomość idzie do kolejki.
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
    el.input.value = t(btn.dataset.promptKey);
    autosizeInput();
    updateSendButton();
    sendMessage();
  });
});

// ----------------------------------------------------------------
// Zmysły: mowa (TTS) — Piper przez senses, fallback: głos systemowy
// ----------------------------------------------------------------

/** Tekst do czytania na głos — to, co brzmi jak mowa, a nie jak Markdown.
 *  Lektor czytał dotąd adresy stron znak po znaku, nazwy emoji, rozsypane
 *  tabele („Przysłona Czas ISO — — —") i urywał w pół zdania na 1200 znaku. */
function stripForSpeech(text) {
  let t = String(text || '');
  if (typeof rozdzielMyslenie === 'function') t = rozdzielMyslenie(t).tresc;   // <think> się nie czyta
  if (typeof stripSearchMarker === 'function') t = stripSearchMarker(t);   // wszystkie znaczniki narzędzi
  t = t
    // Sekcja źródeł to linki dla oka — lektor czytał je po kolei, adres po adresie.
    .replace(/\n[ \t]*(?:\*\*)?(?:Źródła|Zrodla|Sources)(?:\*\*)?:?[ \t]*\n[\s\S]*$/i, '')
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
    .replace(/[*_#>|~]/g, '');
  /* Nagłówek, punkt listy i wiersz tabeli to osobne myśli — bez kropki lektor
     czytał „Plan Świt o 6:41" jednym tchem. Każda linia bez znaku końca
     dostaje kropkę, dopiero potem sklejamy białe znaki. */
  t = t.split(/\n+/).map((l) => l.trim()).filter(Boolean)
    .map((l) => (/[.!?:;,…]$/.test(l) ? l : `${l}.`))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')          // „100 ." po wyciętym przypisie
    .trim();
  /* Czytamy porcjami (porcjeGlosu), więc długość nie jest problemem techniczną
     — ale pięciominutowego monologu nikt nie słucha. Ucinamy na końcu zdania
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

/** Czy serwer ma głos: Piper w zmysłach albo głos w chmurze (ElevenLabs, OpenAI). */
function ttsSerwera() {
  return Boolean((senses.online && senses.caps.piper) || serverConfig.glos?.ttsChmura);
}

/** Porcje do czytania głosem z serwera. Pierwsza krótka — żeby Cosmos zaczął
 *  mówić po ułamku sekundy, a nie po wygenerowaniu całej odpowiedzi — kolejne
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

/** Zagraj nagranie i poczekaj na koniec — także gdy ktoś je przerwie.
 *  Bez `onpause` przerwane czytanie zostawiało wiszącą obietnicę, a tryb
 *  głosowy czekał na koniec wypowiedzi, która już nigdy się nie skończy. */
function grajNagranie(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    const koniec = () => { URL.revokeObjectURL(url); if (currentAudio === audio) currentAudio = null; resolve(); };
    audio.onended = koniec;
    audio.onerror = koniec;
    audio.onpause = koniec;
    audio.play().catch(koniec);
  });
}

async function speakText(text) {
  const clean = stripForSpeech(text);
  if (!clean) return;
  stopSpeaking();
  speakSerial = {};                   // znacznik tej wypowiedzi
  const mine = speakSerial;

  // 1. Głos z serwera: ElevenLabs / OpenAI / Piper (kolejność ustawia serwer).
  if (ttsSerwera()) {
    const porcje = porcjeGlosu(clean);
    const pobierz = (fragment) => fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: fragment, jezyk: getLang() === 'en' ? 'en' : 'pl' }),
    }).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))));
    let nastepna = pobierz(porcje[0]);
    let zagrane = 0;
    for (let i = 0; i < porcje.length; i++) {
      let blob;
      try { blob = await nastepna; } catch { break; }
      if (speakSerial !== mine) return;
      // Następną porcję pobieramy, zanim ta się skończy — bez przerw między zdaniami.
      if (i + 1 < porcje.length) { nastepna = pobierz(porcje[i + 1]); nastepna.catch(() => {}); }
      await grajNagranie(blob);
      zagrane++;
      if (speakSerial !== mine) return;
    }
    if (zagrane === porcje.length) return;
    if (zagrane > 0) return;          // urwało się w połowie — nie czytamy od nowa innym głosem
  }

  // 2. Głos systemowy przeglądarki
  if ('speechSynthesis' in window) {
    const langPrefix = t('speechLang').slice(0, 2);
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith(langPrefix));
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

/** Pusty stan: ikona, zdanie i — gdy jest dokąd iść — przycisk.
 *  Sam szary tekst wyglądał jak błąd ładowania, a nie jak „jeszcze nic tu nie ma". */
function pustyStan(ikona, tekst, przycisk = '') {
  return `<div class="pusty-stan"><span class="ik ${ikona}" aria-hidden="true"></span>`
    + `<p>${escapeHtml(tekst)}</p>`
    + (przycisk ? `<button type="button" class="btn-secondary">${escapeHtml(przycisk)}</button>` : '')
    + '</div>';
}

/* Płatne generowanie: drugie kliknięcie w trakcie było drugim płatnym
   żądaniem u dostawcy (zmierzone: dwa kliknięcia = dwa generowania, także
   wideo — najdroższe). Przycisk jest zajęty, dopóki żądanie trwa. */
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

/* Widok Studia (obraz, storyboard, edycja, dźwięk, wideo) — public/studio-widok.js. */
const { openStudio, zadanieStudia } = utworzStudioWidok({
  $, el, t, escapeHtml, readJsonSafe, loadJson, jedenNaRaz, czekajNaZadanie,
});

// ----------------------------------------------------------------
// KAMERA NA ŻYWO — podgląd + detekcja YOLO + zdarzenia percepcji
// ----------------------------------------------------------------
/* Kamera na żywo: podgląd, detekcja, sylwetka — public/kamera.js. */
const { updateLiveRec, dopasujPanelKamery, startLive, stopLive, wstrzymajWykrywanie } = utworzKamere({
  settings: () => settings, senses: () => senses, cameraFacing: () => cameraFacing, odswiezPlan: () => odswiezPlan,
  $, readJsonSafe, getMedia, videoConstraints, hasMultipleCameras, swapStream,
});

/* Plan zdjęciowy, karty ujęć i misja drona mieszkają w `public/plener.js`
   — patrz nagłówek tamtego pliku. Wywołanie rejestruje nasłuchy przycisków,
   więc musi stać dokładnie tu, gdzie stał przeniesiony kod. */
/* Konta: zaproszenie, Twoje konto, Dostęp (public/konta.js). */
const konta_ = utworzKonta({ $, t, zmienJezyk: () => setLang(getLang() === 'pl' ? 'en' : 'pl') });

const { odswiezPlan, zamknijPlener } = utworzPlener({
  $, el, t, readJsonSafe, closeSettings, dopasujPanelKamery,
  odswiezArchiwum, wczytajSprzet, zapiszSprzet,
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

    // Widać, który obraz jest w tej chwili pierwszą klatką — bez tego jedynym
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
      await czekajNaZadanie(r, zadanieStudia(null));
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

// ----------------------------------------------------------------
// BAZA WIEDZY — pliki, linki, notatki głosowe
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
        : item.textChars ? t('kb.chars', { n: item.textChars }) : t('kb.noText'));
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

// Wysyłka pliku do bazy wiedzy i podgląd obrazu dla modelu — public/wysylka.js.
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
        // Wysłane w całości — dalej serwer czyta tekst (albo przepisuje nagranie w tle).
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
// ASYSTENT GŁOSOWY — „Hej, Kosmos” (jak Asystent Google)
// Wake word i rozmowa: Web Speech API (Chrome/Edge, także Android).
// ----------------------------------------------------------------

/* Bez `\b` po nazwie — i to jest poprawka po zrzucie Marcina.
   Przy sklejonych rozpoznaniach („Hej kosmosHej kosmos co widzisz") granica
   słowa po „kosmos" nie istniała, bo zaraz za nim stała litera. Wzorzec nie
   pasował do PIERWSZEGO wystąpienia i słowo budzące wjeżdżało w treść
   pytania. Rozluźnienie jest bezpieczne: żeby cokolwiek dopasować, trzeba
   i tak mieć przed nazwą „hej"/„ok". */
const WAKE_RE = /\b(hej|hey|ok(?:ej)?)[\s,.!]*(kosmos|cosmos)/i;

/* Czyste przekształcenia tekstu mowy — `public/mowa.js`. Tam mieszka też
   `doklej`, czyli scalanie kolejnych rozpoznań bez powtórzeń. */
const {
  doklej: doklejRozpoznane, odciskWyniku, bezSlowaBudzacego, toSamoZdanie,
  przepisanie, doklejBezZakladki,
} = utworzMowe({ WAKE_RE });
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
    push: t('voice.push'),
  }[state] || '';
  // W trybie „naciśnij" kula jest przyciskiem — musi to być widać i czuć.
  el.voiceOrb.style.cursor = 'pointer';
  el.voiceHint.textContent = t(state === 'push' ? 'voice.hintPush' : 'voice.hint');
}

/* ============ PISZCZĄCY MIKROFON ============
   Marcin: „cały czas ten mikrofon się włącza i odłącza wraz z tym irytującym
   dźwiękiem przyłączania i odłączania".

   To nie jest usterka Cosmosa — to Android. Chrome na telefonie nie obsługuje
   `continuous`: kończy sesję rozpoznawania po każdej wypowiedzi i po każdej
   ciszy, a każde uruchomienie i zamknięcie mikrofonu system kwituje
   dźwiękiem. Nasłuch słowa budzącego wymaga ciągłego słuchania, więc
   wznawiamy — i tak w kółko, co kilka sekund, także wtedy, gdy w pokoju
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

/** Rozpoznanie się udało — nasłuch ciągły w tej przeglądarce działa. */
function nasluchDziala() {
  wznowienJalowych = 0;
}

/** Przejdź na „naciśnij, aby mówić" i przestań wznawiać sesję. */
function nasluchNaPrzycisk() {
  wznowienJalowych = 0;
  /* Zapamiętane na stałe dla TEJ przeglądarki. Bez tego Marcin przy każdym
     wejściu w tryb głosowy słuchałby dwunastu piśnięć od nowa, zanim Cosmos
     ponownie dojdzie do tego samego wniosku. Zapis kasuje się sam, gdy
     pojawi się własny strumień z Whisperem — wtedy ciągły nasłuch działa
     i nie ma czego omijać. */
  try { localStorage.setItem('cosmos.nasluchPrzycisk', '1'); } catch { /* tryb prywatny */ }
  if (voiceRec) { try { voiceRec.abort(); } catch { /* już zamknięty */ } }
  voiceRec = null;
  setVoiceState('push');
  el.voiceTranscript.textContent = '';
}

/** Jedna sesja rozpoznawania pod palcem — bez wznawiania w kółko. */
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
  /* Wybór silnika zależy od /api/config i /api/status. Otwarcie trybu,
     zanim przyszły, tworzyło SpeechRecognition (piszczenie), a po ich
     nadejściu startował drugi nasłuch obok pierwszego. Czekamy na nie,
     ale nie dłużej niż 4 s. */
  setVoiceState('thinking');
  await Promise.race([gotowoscGlosu, pauza(4000)]);
  if (!voiceMode) return;
  silnikSesji = null;
  silnikSesji = silnikNasluchu();

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

  /* Ta przeglądarka już raz pokazała, że nie utrzymuje ciągłego nasłuchu —
     nie każemy jej dowodzić tego drugi raz kosztem kolejnych kilkunastu
     piśnięć mikrofonu. Whisper przez własny strumień piszczeć nie musi,
     więc gdy jest dostępny, zapis przestaje obowiązywać i znika. */
  if (silnikNasluchu() === 'whisper') {
    try { localStorage.removeItem('cosmos.nasluchPrzycisk'); } catch { /* tryb prywatny */ }
    // Ktoś właśnie otworzył tryb głosowy — chce mówić, więc od razu słuchamy.
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
/* Komunikat (błąd rozpoznawania, mikrofon wyciszony) stoi w tym samym polu co
   usłyszane słowa. Dotknięcie kuli w trakcie słuchania brało treść pola jako
   pytanie — i model odpowiadał na „Nie udało się rozpoznać mowy: …".
   Zapamiętujemy więc, co było komunikatem. */
function komunikatGlosu(tekst) {
  el.voiceTranscript.textContent = tekst;
  el.voiceTranscript.dataset.komunikat = tekst;
}
function usłyszaneWPolu() {
  const pole = el.voiceTranscript.textContent || '';
  return pole === el.voiceTranscript.dataset.komunikat ? '' : pole;
}
/* Silnik rozpoznawania ustalony RAZ na sesję głosową. Liczony przy każdym
   przejściu stanu potrafił zmienić zdanie w połowie (chwilowy brak zmysłów
   w /api/status) — i działały dwa nasłuchy naraz. */
let silnikSesji = null;
/* Serwer trzy razy z rzędu nie rozpoznał mowy. To stan TEJ sesji, nie wybór
   użytkownika — dawniej trafiał na stałe do Ustawień i po naprawie serwera
   Cosmos dalej piszczał Web Speech API. */
let sttSerweraPadl = false;
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

/* ---- GDZIE ROZPOZNAĆ MOWĘ -------------------------------------------
   Serwer ma łańcuch źródeł (lib/glos.js): Whisper w zmysłach, własny serwer
   rozpoznawania, OpenAI. Aplikacja pyta więc nie „czy działają zmysły", tylko
   „czy serwer w ogóle rozpozna mowę" — a lokalność sprawdza osobno, bo od niej
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
 *  a po chwili ciszy czeka na dotknięcie kuli — tak jak asystenci w telefonach.
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
   Jeden błąd to przypadek — GPU zajęte innym zadaniem, chwilowa dziura
   w Tailscale. Trzy pod rząd znaczą, że zmysłów po prostu nie ma, a wtedy
   trwanie przy Whisperze to skazanie trybu głosowego na milczenie. */
const NASLUCH_PROG_AWARII = 3;
let nasluchAwarie = 0;

function startNasluchWlasny() {
  if (nasluch) { nasluch.gluchy(voiceDeaf); return; }
  nasluch = window.NasluchWlasny.utworz({
    adres: () => adresStt(voiceState === 'wake' ? 'nasluch' : 'pytanie'),
    onWypowiedz: (tekst) => { nasluchAwarie = 0; wypowiedzZNasluchu(tekst); },
    onBlad: (err) => {
      // Awaria transkrypcji nie kończy trybu głosowego — następna wypowiedź
      // może się udać (zmysły wstają, GPU zwalnia się po innym zadaniu).
      komunikatGlosu(t('voice.sttErr', { msg: err.message }));
      if (++nasluchAwarie < NASLUCH_PROG_AWARII) return;
      /* Trzeci raz z rzędu. Przeglądarkowe rozpoznawanie jest gorsze, ale
         DZIAŁA — a Cosmos, który w kółko powtarza ten sam błąd, jest po
         prostu zepsuty. Zmiana jest jawna: człowiek musi wiedzieć, czemu
         nagle zmieniło się zachowanie. */
      nasluchAwarie = 0;
      sttSerweraPadl = true;
      silnikSesji = 'przegladarka';
      if (nasluch) { nasluch.stop(); nasluch = null; }
      komunikatGlosu(t('voice.sttFallback'));
      /* Na Androidzie ciągłe Web Speech to piszczenie co kilka sekund —
         lepiej kula pod palcem: jedno dotknięcie, jedna sesja. */
      if (voiceMode) {
        if (/Android/i.test(navigator.userAgent)) setVoiceState('push');
        else startVoiceRecognizer();
      }
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
   ramki) — tutaj jest odpowiedź na pytanie, co dalej.

   Najpierw PRÓBUJEMY ODZYSKAĆ, bo dwie z trzech przyczyn (uśpiony dźwięk po
   wygaszeniu ekranu, mikrofon oddany na czas rozmowy telefonicznej) mijają
   same i wystarczy wziąć wejście od nowa. Dopiero gdy to nie pomoże, mówimy
   wprost — jedna próba, nie pętla wznowień co dwie sekundy. */
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
      // Głuchy nie znaczy „nie słyszy" — znaczy „nie reaguje". Wszystko, co
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
      /* SCALAMY, NIE DOKLEJAMY.
         Chrome na Androidzie nie obsługuje `continuous` — kończy sesję po
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
    el.voiceTranscript.textContent = doklejRozpoznane(voiceHeard, interim);

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
    /* Sesja, która skończyła się bez ani jednego wyniku, była jałowa —
       czyli mikrofon piszczał po nic. Patrz komentarz przy
       WZNOWIEN_ZANIM_PRZYCISK. */
    if (!rec.__ostatniaDlugosc) wznowienJalowych++;
    else wznowienJalowych = 0;
    if (voiceState === 'push') return;
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
    /* „no-speech" i „aborted" to normalny bieg rzeczy — onend wznowi */
  };

  try { rec.start(); } catch { /* już wystartował */ }
}

function backToWake() {
  if (!voiceMode) return;
  clearTimeout(voiceSilence);
  clearTimeout(nasluchCisza);
  voiceHeard = '';
  if (trybRozmowy()) {
    /* Bez lokalnego Whispera nie słuchamy otoczenia — mikrofon się zamyka
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
  /* Pytanie głosowe w trakcie pisanej odpowiedzi uruchamiało drugą generację
     obok pierwszej — obie lądowały w rozmowie na krzyż i obie były czytane. */
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

/* Kula jest przyciskiem ZAWSZE, nie tylko po przejściu na „naciśnij".
   Nawet gdy nasłuch działa, czekanie na słowo budzące bywa wolniejsze niż
   dotknięcie ekranu — a w trybie „naciśnij" to jedyna droga do zadania
   pytania. Kolejne dotknięcie w trakcie słuchania kończy wypowiedź. */
el.voiceOrb.addEventListener('click', () => {
  if (!voiceMode) return;
  if (voiceState === 'listening') {
    const tekst = bezSlowaBudzacego(usłyszaneWPolu());
    clearTimeout(voiceSilence);
    voiceHeard = '';
    if (tekst) askVoice(tekst); else backToWake();
    return;
  }
  if (voiceState === 'thinking' || voiceState === 'speaking') return;
  nasluchRaz();
});

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
  // Płótno nie jest nakładką (stoi obok rozmowy), ale Escape też je zamyka.
  if (!$('canvas').hidden && !el.input.matches(':focus')) { e.preventDefault(); $('canvas').hidden = true; }
});

/* ---- KARTY USTAWIEŃ -------------------------------------------------------
   Ustawienia to ~20 bloków w jednej kolumnie. Karty u góry PRZEWIJAJĄ do grupy
   i podświetlają tę, w której jesteś — nic nie jest chowane, więc każde pole
   zostaje tam, gdzie było (i tak samo dostępne z klawiatury czy z testu).
   Karta bez widocznego bloku (np. „Dom" u zaproszonej osoby) znika. */
{
  const cialo = document.querySelector('#settings-modal .modal-body');
  const karty = cialo ? [...cialo.querySelectorAll('.set-karty [data-cel]')] : [];
  const widoczne = (g) => [...cialo.querySelectorAll(`[data-karta="${g}"]`)].filter((b) => b.offsetParent !== null);
  const zaznacz = (g) => karty.forEach((k) => {
    k.classList.toggle('aktywna', k.dataset.cel === g);
    k.setAttribute('aria-current', k.dataset.cel === g ? 'true' : 'false');
  });
  const odswiez = () => {
    for (const k of karty) k.hidden = !widoczne(k.dataset.cel).length;
    const pasek = cialo.querySelector('.set-karty');
    const odGory = cialo.getBoundingClientRect().top + (pasek ? pasek.offsetHeight : 0) + 24;
    /* Świeci grupa bloku, który czytasz — najniższego z tych, które minęły
       pasek. Grupy są w HTML-u przeplecione (głos między silnikami, pierwszy
       blok „Dane" przed „Domem"), więc dawne „ostatnia karta, której pierwszy
       blok minął górę" po kliknięciu „Dom" zapalało „Dane" — Dom nie świecił
       nigdy. */
    let biezaca = karty.find((k) => !k.hidden)?.dataset.cel;
    let najnizej = -Infinity;
    for (const b of cialo.querySelectorAll('[data-karta]')) {
      if (b.offsetParent === null) continue;
      const y = b.getBoundingClientRect().top;
      if (y <= odGory && y > najnizej) { najnizej = y; biezaca = b.dataset.karta; }
    }
    if (biezaca) zaznacz(biezaca);
  };
  for (const k of karty) {
    k.addEventListener('click', () => {
      const pierwszy = widoczne(k.dataset.cel)[0];
      if (!pierwszy) return;
      const pasek = cialo.querySelector('.set-karty');
      cialo.scrollTo({ top: pierwszy.offsetTop - (pasek ? pasek.offsetHeight + 8 : 0), behavior: 'smooth' });
      zaznacz(k.dataset.cel);
    });
  }
  if (cialo) {
    cialo.addEventListener('scroll', () => requestAnimationFrame(odswiez), { passive: true });
    new MutationObserver(() => { if ($('settings-modal').style.display !== 'none') requestAnimationFrame(odswiez); })
      .observe($('settings-modal'), { attributes: true, attributeFilter: ['style'] });
  }
}

/* ---- FOKUS W NAKŁADKACH -------------------------------------------------
   Z klawiatury nakładki były nieużywalne: fokus nie wchodził do środka,
   Tab uciekał do rozmowy pod spodem (15–29 razy na 30), a po Escape nie
   wracał na przycisk, którym nakładkę otwarto. Zamiast łatać każdą z osobna:
   obserwujemy, która jest na wierzchu — reszta strony dostaje `inert`,
   fokus wchodzi do środka, a po zamknięciu wraca tam, skąd przyszedł. */
{
  const elementy = ['img-viewer', 'voice-overlay', 'camera-modal', 'live-panel', 'gallery-modal',
    'timeline-modal', 'learn-modal', 'kb-modal', 'studio-modal', 'plener-modal', 'settings-modal']
    .map((id) => $(id)).filter(Boolean);
  const widoczna = (w) => w.style.display !== 'none' && !w.hidden;
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
  };
  const obserwator = new MutationObserver(przelicz);
  for (const w of elementy) obserwator.observe(w, { attributes: true, attributeFilter: ['style', 'hidden'] });
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
    /* WIADOMOŚĆ BEZ TREŚCI NIE MA CO ROBIĆ W ZAPISIE.
     *
     *  Siatka miniatur to wiadomość z pustym tekstem i listą zdjęć. Eksport
     *  wypisywał dla niej sam nagłówek „**Cosmos:**" i pustą linię — a zdjęć
     *  nie wspominał w ogóle. W przysłanych przez Marcina zapisach widać
     *  przez to puste dymki w miejscach, gdzie w rozmowie były zdjęcia:
     *  zapis wyglądał gorzej niż sama rozmowa i sugerował, że Cosmos
     *  odpowiedział niczym.
     *
     *  To jest o tyle istotne, że po tych plikach ocenia się jakość rozmów. */
    const tekst = msgText(m);
    const imgs = msgImages(m);
    const foty = msgPhotos(m);
    if (!tekst && !imgs.length && !foty.length) continue;
    lines.push(`**${who}:**`, '');
    if (tekst) lines.push(tekst, '');
    if (foty.length) {
      lines.push(`_(${t('export.photos', { n: foty.length })})_`, '');
    }
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
  /* Pasek „streszczam…" W ROZMOWIE — dawniej nic nie mówiło, że coś trwa.
     I zapis do TEJ rozmowy, nawet gdy człowiek w międzyczasie przeszedł do
     innej: saveConversations zapisuje aktywną, więc streszczenie przepadało. */
  const pasek = { role: 'assistant', content: t('sum.working'), status: true };
  conv.messages.push(pasek);
  renderMessages({ przewin: sledzeDol });
  const utrwal = () => {
    if (activeConversation && activeConversation.id === conv.id) { saveConversations(); renderMessages({ przewin: sledzeDol }); return; }
    conv.updatedAt = Date.now();
    try { localStorage.setItem('cosmos.conv.' + conv.id, JSON.stringify(conv)); } catch { /* limit */ }
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
  document.querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', dark ? '#111214' : '#F6F5F1'));
}

/* Bez zapisanego wyboru motyw idzie za systemem — tak jak strona produktowa.
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
});

const ENDPOINT_TABS = {
  cloud: ['Chmura', '<svg viewBox="0 0 24 24"><path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 12.4 3.5 3.5 0 0 0 6.5 19z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'],
  local: ['Lokalnie', '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>'],
  openai: ['OpenAI', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>'],
  claude: ['Claude', '<svg viewBox="0 0 24 24"><path d="M12 3l2.2 6.8H21l-5.4 4 2 6.9-5.6-4.2-5.6 4.2 2-6.9-5.4-4h6.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'],
};

/* Zakładki rysujemy od razu, z listy zapamiętanej przy poprzedniej wizycie,
   a po /api/config — z prawdziwej. Pusty przełącznik rósł po konfiguracji
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
  endpoint = name;
  localStorage.setItem(STORAGE_KEYS.endpoint, name);
  document.documentElement.dataset.silnik = name;   // kolor nici, obwódki pola i kropki modelu
  document.querySelectorAll('.endpoint-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.endpoint === name);
  });
  updateModelBadge();
}

// ----------------------------------------------------------------
// Ustawienia (modal)
// ----------------------------------------------------------------

function openSettings() {
  konta_.odswiez().catch(() => { /* panel konta nie może zablokować Ustawień */ });
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
    box.innerHTML = `<div class="model-info-warn">⚠︎ ${escapeHtml(t('set.fetchErr'))}</div>`
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
  const silnik = silnikNasluchu() === 'whisper'
    ? t(sttLokalne() ? 'set.sttZrodloLokalne' : 'set.sttZrodloChmura')
    : t('set.sttBrowser');
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

/* Stan silników z ostatniego /api/status. Kropka przy nazwie modelu miała
   kolor silnika nawet przy „Chmura NVIDIA — brak klucza" w panelu stanu —
   dwa sprzeczne sygnały. Teraz gaśnie, gdy silnik jest niedostępny. */
var stanSilnikow = {};   // var: updateModelBadge bywa wołane przed tą linią (start aplikacji)

function updateModelBadge() {
  const model = currentModel() || t('chat.modelNotSet');
  const labels = { cloud: t('tabCloud'), local: t('tabLocal'), openai: 'OpenAI', claude: 'Claude' };
  el.topbarModel.textContent = `${model} · ${labels[endpoint] || endpoint}`;
  const stan = stanSilnikow[endpoint];
  el.topbarModel.classList.toggle('niedostepny', stan === 'bez-klucza' || stan === 'offline');
  el.topbarModel.title = stan === 'bez-klucza' ? t('stat.noKey') : stan === 'offline' ? t('stat.offline') : '';
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

/* Pierwsze /api/config i /api/status — od nich zależy, którym silnikiem
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

async function refreshStatusWlasciwe() {
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
    stanSilnikow = {
      cloud: cloudCfg.hasApiKey ? (st.cloud?.online === true ? 'ok' : 'offline') : 'bez-klucza',
      local: st.local?.online === true ? 'ok' : 'offline',
    };
    updateModelBadge();
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
  try { await loadServerConfigWlasciwe(); } finally { gotowyConfig(); }
}

async function loadServerConfigWlasciwe() {
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

// Service worker i pasek „Jest nowa wersja” — public/pwa.js.
uruchomPwa({ t });

// ----------------------------------------------------------------
// Logowanie (gdy serwer wymaga hasła — np. na VPS)
// ----------------------------------------------------------------

async function checkAuth() {
  try {
    const res = await fetch('/api/auth');
    const d = await res.json();
    // Rola od razu: przyciski tylko dla właściciela nie mogą mignąć gościowi.
    konta_.zastosujRole(d.uzytkownik);
    konta_.pilnujWlascicielaPamieci(d.uzytkownik);
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
        // Pusty login = właściciel (tak działało logowanie przed kontami).
        body: JSON.stringify({ login: $('login-login').value, password: $('login-password').value }),
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
  /* Link z zaproszeniem ma pierwszeństwo przed wszystkim innym — także przed
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
  el.ttsToggle.classList.toggle('active', Boolean(settings.speak));
  updateKbBadge();
  /* Najpierw lista rozmów, dopiero potem powrót do odpowiedzi, która
     powstawała w tle — wznowienie musi mieć do czego wrócić. */
  // Szkic i kolejka sprzed odświeżenia — kolejka rusza, gdy nic się nie liczy.
  try {
    const szkic = localStorage.getItem(KLUCZ_SZKICU);
    if (szkic && !el.input.value) { el.input.value = szkic; autosizeInput(); updateSendButton(); }
    const zapisana = JSON.parse(localStorage.getItem(KLUCZ_KOLEJKI) || '[]');
    if (Array.isArray(zapisana) && zapisana.length) { kolejka = zapisana; renderKolejka(); }
  } catch { /* bez pamięci */ }
  loadConversations().then(przywrocOstatnia).then(wznowBieg).then(() => ruszKolejke())
    .catch(() => { /* wznowienie nie może blokować startu */ });
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
  /* Dopiero teraz panel boczny na telefonie może się pokazać — do tej chwili
     CSS trzyma go schowanego (.app:not(.gotowa)). Bez tego przy każdym
     starcie migał otwarty z przyciemnieniem przez ~0,4 s. */
  document.querySelector('.app').classList.add('gotowa');
}

// ----------------------------------------------------------------
// NAUKA — rozpoznawanie (przez zmysły), procedury, rutyny: public/nauka-widok.js
// ----------------------------------------------------------------
const { loadAutomationStatus, closeLearn, loadProcedures, runProcedure, scheduleControls, updateLearnBadge, pollDueRoutines } = utworzNaukeWidok({
  $, escapeHtml, readJsonSafe, getMedia,
});

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
  /* Reszta tylko mignięciem — to kontekst, nie polecenie.
   *
   *  ALE NIE TO, CO I TAK WIDAĆ. Dymek istnieje po to, żeby przy ZAMKNIĘTYM
   *  podglądzie dowiedzieć się, że Cosmos kogoś zobaczył. Przy otwartym
   *  podglądzie ta sama treść stoi już pod obrazem, i to na stałe zamiast
   *  na sześć sekund — więc dymek tylko powtarzał ją drugi raz nad panelem.
   *  Marcin zapytał wprost, czy tak miało być; nie miało.
   *
   *  Czujniki, urządzenia i rutyny lecą dalej: ich w podglądzie nie widać. */
  const podgladOtwarty = $('live-panel') && $('live-panel').style.display !== 'none';
  if (podgladOtwarty && (z.type === 'kamera' || z.type === 'sylwetka')) return;
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

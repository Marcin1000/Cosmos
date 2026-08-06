/* ============================================================
   Wspólny fundament testów Cosmosa

   Każdy zestaw dostaje WŁASNY serwer na własnym porcie. To nie jest
   nadgorliwość: przez długi czas testy dzieliły jeden serwer na porcie 3000
   i połowa „awarii" brała się z tego, że akurat wstał z inną konfiguracją —
   `blind-check` wymaga BRAKU modelu wizyjnego, `tabs-check` czterech kluczy
   API, `ui-test` atrapy oddającej bloki kodu. Bateria, która przy każdym
   przebiegu krzyczy na wilka, przestaje cokolwiek znaczyć.

   Wiedza o tym, czego który zestaw potrzebuje, siedzi w jednym miejscu:
   w tabeli SRODOWISKA. Zestaw pisze `await srodowisko('kinect')` i dostaje
   gotowy port.
   ============================================================ */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const KORZEN = path.resolve(__dirname, '..');
const ATRAPY = path.join(__dirname, 'atrapy');

/* Zrzuty ekranu z testów. Poza repozytorium (jest w .gitignore), ale
   w przewidywalnym miejscu — po nieudanym zestawie chce się na nie spojrzeć. */
const KATALOG_ZRZUTOW = path.join(__dirname, 'zrzuty');
fs.mkdirSync(KATALOG_ZRZUTOW, { recursive: true });

/* Chromium jest w obrazie, ale wersja paczki `playwright` bywa nowsza niż
   pobrane przeglądarki — wtedy domyślne `chromium.launch()` szuka katalogu,
   którego nie ma. Wskazujemy binarkę wprost. */
const CHROMIUM = process.env.COSMOS_CHROMIUM
  || ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
    .find((p) => fs.existsSync(p));

/** Czy w ogóle da się uruchomić testy przeglądarkowe. */
function maPrzegladarke() {
  try { require.resolve('playwright'); } catch { return false; }
  return Boolean(CHROMIUM);
}

async function przegladarka(opcje = {}) {
  const { chromium } = require('playwright');
  return chromium.launch({ executablePath: CHROMIUM, ...opcje });
}

// ---------------------------------------------------------------------------
// Uruchamianie procesów pomocniczych
// ---------------------------------------------------------------------------

const dzialajace = new Set();

function uruchom(cmd, args, opcje = {}) {
  const p = spawn(cmd, args, { stdio: 'ignore', detached: true, ...opcje });
  // Bez `unref` uchwyt do procesu potomnego trzyma pętlę zdarzeń i zestaw,
  // który skończył pracę, wisi aż do limitu czasu. Sprzątanie i tak robi
  // `posprzataj()` przypięte do zdarzenia `exit`.
  p.unref();
  dzialajace.add(p);
  return p;
}

function zabij(p) {
  if (!p) return;
  try { process.kill(-p.pid); } catch { /* już nie żyje */ }
  dzialajace.delete(p);
}

/** Poczekaj, aż adres zacznie odpowiadać. Zwraca `false` po wyczerpaniu prób. */
async function czekajNa(url, prob = 60, przerwa = 400) {
  for (let i = 0; i < prob; i++) {
    await new Promise((r) => setTimeout(r, przerwa));
    try { if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).status) return true; }
    catch { /* jeszcze wstaje */ }
  }
  return false;
}

/** Wstaw N gotowych rozmów do świeżego katalogu danych.
 *
 *  Odkąd każdy zestaw dostaje własny, pusty katalog, testy panelu bocznego
 *  („czy widać cztery rozmowy?", „czy da się dojechać do Zmysłów?") nie mają
 *  czego mierzyć. Wcześniej działały przypadkiem — na rozmowach nazbieranych
 *  przez poprzednie przebiegi. Teraz zasiew jest jawny i powtarzalny.
 */
function zasiejRozmowy(dataDir, ile) {
  const convDir = path.join(dataDir, 'conversations');
  fs.mkdirSync(convDir, { recursive: true });
  const indeks = [];
  for (let i = 0; i < ile; i++) {
    const id = `test${String(i).padStart(4, '0')}`;
    const czas = Date.now() - i * 60000;
    fs.writeFileSync(path.join(convDir, `${id}.json`), JSON.stringify({
      id,
      title: `Rozmowa testowa numer ${i + 1}`,
      createdAt: czas,
      updatedAt: czas,
      messages: [
        { role: 'user', content: `Pytanie ${i + 1}` },
        { role: 'assistant', content: `Odpowiedź ${i + 1}` },
      ],
    }));
    indeks.push({ id, title: `Rozmowa testowa numer ${i + 1}`, createdAt: czas, updatedAt: czas, pinned: false });
  }
  fs.writeFileSync(path.join(convDir, 'index.json'), JSON.stringify(indeks));
}

function serwerCosmosa(port, env = {}, rozmowy = 0) {
  // Osobny katalog danych na zestaw: inaczej testy dopisują sobie nawzajem
  // rozmowy i licznik „35 rozmów" rośnie z każdym przebiegiem.
  const dataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cosmos-test-'));
  if (rozmowy) zasiejRozmowy(dataDir, rozmowy);
  return uruchom('node', ['server.js'], {
    cwd: KORZEN,
    env: { ...process.env, PORT: String(port), COSMOS_DATA_DIR: dataDir, NVIDIA_API_KEY: 'test', ...env },
  });
}

const atrapaNode = (plik, port) => uruchom('node', [path.join(ATRAPY, plik)],
  { cwd: ATRAPY, env: { ...process.env, PORT: String(port) } });
const atrapaPy = (plik) => uruchom('python3', [path.join(ATRAPY, plik)], { cwd: ATRAPY });

// ---------------------------------------------------------------------------
// Katalog środowisk — jedyne miejsce, które wie, czego wymaga który zestaw
// ---------------------------------------------------------------------------

/* Porty, na których słuchają atrapy. Muszą być znane, bo stara atrapa
   z poprzedniego przebiegu odpowiada tak samo jak nowa — tylko starym
   kodem. Zdarzyło się naprawdę: test sylwetki widział `yolo: false`,
   bo odpowiadała atrapa sprzed dopisania /detect. */
const PORTY_ATRAP = {
  'mock-upstream.js': [9099, 9098],
  'fake_senses.py': [7060],
  'reasonmock.py': [7097],
  'mock-katalog.js': [7103],
  'mock-tempo.js': [7115],
  'mock-echo-systemu.js': [7116],
  'mock-grafiki.js': [7117],
  // atrapa Open-Meteo + Microsoft Graph tworzona wprost w zestawie
  'mockllm.py': [7099],
};

const SRODOWISKA = {
  // Atrapa oddająca bloki kodu, obrazy i wyniki wyszukiwania; dwa silniki.
  pelne: {
    port: 3401,
    atrapy: [['mock-upstream.js', null], ['fake_senses.py', null]],
    env: {
      LOCAL_API_KEY: 'test',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:9099/v1',
      LOCAL_BASE_URL: 'http://127.0.0.1:9098/v1',
      NEMOTRON_VISION_MODEL: 'cloud/nemotron-vl-test',
      LOCAL_MODEL: 'local/nemotron-3-test',
      SENSES_URL: 'http://127.0.0.1:7060',
    },
    // Panel boczny mierzy się na liście rozmów — pusty katalog nie ma czego pokazać.
    rozmowy: 12,
  },
  // To samo, ale BEZ modelu wizyjnego — ostrzeżenie o obrazach pojawia się
  // tylko wtedy, gdy Cosmos nie ma dokąd przekierować zdjęcia.
  bezWzroku: {
    port: 3402,
    atrapy: [['mock-upstream.js', null], ['fake_senses.py', null]],
    env: {
      LOCAL_API_KEY: 'test',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:9099/v1',
      LOCAL_BASE_URL: 'http://127.0.0.1:9098/v1',
      SENSES_URL: 'http://127.0.0.1:7060',
    },
  },
  // Cztery silniki — pasek zakładek ma się przewijać, nie rozpychać strony.
  czterySilniki: {
    port: 3403,
    atrapy: [['mock-upstream.js', null]],
    env: {
      LOCAL_API_KEY: 'test', OPENAI_API_KEY: 'test', ANTHROPIC_API_KEY: 'test',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:9099/v1',
      LOCAL_BASE_URL: 'http://127.0.0.1:9098/v1',
    },
  },
  // Model rozumujący: strumień z `reasoning_content`, pętla wyszukiwania,
  // pusta odpowiedź przy wyczerpanym budżecie myślenia.
  rozumujacy: {
    port: 3404,
    atrapy: [['reasonmock.py', null], ['fake_senses.py', null]],
    env: {
      NEMOTRON_BASE_URL: 'http://127.0.0.1:7097/v1',
      SENSES_URL: 'http://127.0.0.1:7060',
    },
  },
  // Katalog stu modeli, z których większość konto odrzuca.
  katalogModeli: {
    port: 3405,
    atrapy: [['mock-katalog.js', null]],
    env: { NEMOTRON_BASE_URL: 'http://127.0.0.1:7103/v1' },
  },
  // Modele o różnej płynności, w tym jeden kapryśny i jeden rozumujący —
  // do sprawdzenia, czy pomiar płynności nie kłamie.
  tempo: {
    port: 3408,
    atrapy: [['mock-tempo.js', null]],
    env: { NEMOTRON_BASE_URL: 'http://127.0.0.1:7115/v1' },
  },
  // Atrapa oddaje wiadomości systemowe jako treść — sprawdzamy, co model widzi.
  kontekst: {
    port: 3409,
    atrapy: [['mock-echo-systemu.js', null]],
    env: {
      NEMOTRON_BASE_URL: 'http://127.0.0.1:7116/v1',
      COSMOS_TZ: 'Europe/Warsaw',
      /* Atrapa przyjmuje połączenie na /health i milczy — tak zachowuje się
         uśpiony komputer domowy. Adres nieistniejący nie nadaje się: odbija
         się od proxy w 80 ms zamiast wisieć pełne 1,5 s. */
      SENSES_URL: 'http://127.0.0.1:7116',
      // Cache na zero, żeby KAŻDA wiadomość trafiała w moment odświeżenia.
      // Bez tego pomiar mierzyłby trafienie w cache, czyli nic.
      SENSES_CACHE_MS: '0',
    },
  },
  // Wyszukiwanie grafik: atrapa wszystkich trzech źródeł (DDG z żetonem vqd,
  // Commons, Openverse) plus miniatura przez proxy.
  grafiki: {
    port: 3410,
    // Echo systemu jest tu po to, żeby sprawdzić, czy model W OGÓLE wie
    // o nowym narzędziu — bez tego nadal odpowiadałby „nie umiem".
    atrapy: [['mock-grafiki.js', null], ['mock-echo-systemu.js', null]],
    env: {
      IMAGE_SEARCH_URL: 'http://127.0.0.1:7117/',
      COMMONS_API_URL: 'http://127.0.0.1:7117/commons',
      OPENVERSE_API_URL: 'http://127.0.0.1:7117/openverse',
      GEOCODE_SEARCH_URL: 'http://127.0.0.1:7117/geokoduj',
      NEMOTRON_BASE_URL: 'http://127.0.0.1:7116/v1',
    },
  },
  // Serwer bez atrap — do testów samego interfejsu (układ, Escape, motywy).
  goly: { port: 3406, atrapy: [], env: {} },
  // Zmysły podłączone, model nieistotny — Kinect, mowa, wykrywanie.
  zmysly: {
    port: 3407,
    atrapy: [['fake_senses.py', null]],
    env: { SENSES_URL: 'http://127.0.0.1:7060' },
  },
};

/** Zwolnij porty zajęte przez procesy z poprzednich przebiegów. */
async function zwolnijPorty(porty) {
  const { execSync } = require('child_process');
  let cos = false;
  for (const port of porty) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
      cos = true;
    } catch { continue; }        // wolny albo nie mówi po HTTP — zostawiamy
    try { execSync(`fuser -k ${port}/tcp 2>/dev/null`); } catch { /* brak fusera */ }
  }
  if (cos) await new Promise((r) => setTimeout(r, 700));
}

const wstale = new Map();

/** Postaw środowisko dla zestawu. Zwraca `{ port, adres, koniec }`. */
async function srodowisko(nazwa) {
  const cfg = SRODOWISKA[nazwa];
  if (!cfg) throw new Error(`Nieznane środowisko „${nazwa}". Znane: ${Object.keys(SRODOWISKA).join(', ')}`);
  if (wstale.has(nazwa)) return wstale.get(nazwa);

  const adres = `http://127.0.0.1:${cfg.port}`;

  /* Zajęty port to najgorszy możliwy błąd w baterii: nowy serwer pada po cichu
     na EADDRINUSE, a stary — z poprzedniego przebiegu i ze STARYM kodem —
     dalej odpowiada. Test zdaje albo pada z zupełnie nie tego powodu.
     Zdarzyło się naprawdę: nowa trasa dawała 404, choć istniała. */
  await zwolnijPorty([cfg.port]);

  // Atrapy też muszą być świeże — patrz komentarz przy PORTY_ATRAP.
  for (const [plik] of cfg.atrapy) await zwolnijPorty(PORTY_ATRAP[plik] || []);

  const procesy = [];
  for (const [plik] of cfg.atrapy) {
    procesy.push(plik.endsWith('.py') ? atrapaPy(plik) : atrapaNode(plik));
  }
  if (cfg.atrapy.length) await new Promise((r) => setTimeout(r, 1500));

  const srv = serwerCosmosa(cfg.port, cfg.env, cfg.rozmowy || 0);
  procesy.push(srv);
  if (!await czekajNa(adres)) {
    procesy.forEach(zabij);
    throw new Error(`Serwer testowy na ${cfg.port} nie wstał (środowisko „${nazwa}")`);
  }

  const wynik = { port: cfg.port, adres, koniec: () => procesy.forEach(zabij) };
  wstale.set(nazwa, wynik);
  return wynik;
}

/** Posprzątaj wszystko, co ten proces uruchomił. */
function posprzataj() {
  [...dzialajace].forEach(zabij);
  wstale.clear();
}
process.on('exit', posprzataj);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { posprzataj(); process.exit(130); });
}

// ---------------------------------------------------------------------------
// Zbieranie wyniku zestawu
// ---------------------------------------------------------------------------

/** Prosty zbieracz błędów: `zapisz` notuje, `zakoncz` drukuje werdykt. */
function wynik(tytul) {
  const bledy = [];
  return {
    zapisz: (t) => bledy.push(t),
    sprawdz: (warunek, t) => { if (!warunek) bledy.push(t); return warunek; },
    zakoncz() {
      posprzataj();
      console.log(bledy.length ? `\nDO POPRAWY:\n- ${bledy.join('\n- ')}` : `\n${tytul} OK`);
      process.exit(bledy.length ? 1 : 0);
    },
  };
}

module.exports = {
  KORZEN, ATRAPY, CHROMIUM, SRODOWISKA, KATALOG_ZRZUTOW,
  maPrzegladarke, przegladarka, srodowisko, posprzataj, czekajNa,
  uruchom, zabij, serwerCosmosa, zwolnijPorty, atrapaNode, atrapaPy, wynik, zasiejRozmowy,
};

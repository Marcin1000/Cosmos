# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Język repozytorium

Wszystko jest po polsku: komentarze, nazwy funkcji i zmiennych, komunikaty błędów,
dokumentacja, teksty commitów. Nowy kod pisz tak samo. Interfejs ma dwa języki (PL/EN),
ale kod mówi po polsku.

Wyjątek: `contentai/` — tam nazwy są mieszane (starsza warstwa angielska + nowsza polska),
patrz niżej.

## Dwa niezależne projekty w jednym repo

**Cosmos** (katalog główny) — osobiste środowisko AI: czat, percepcja, baza wiedzy, studio
mediów, nauka procedur. To jest właściwa treść tego repo.

**`contentai/`** — migawka odrębnego produktu (generator treści SEO). **Nie współdzieli
kodu z Cosmosem** i nie jest przez niego uruchamiana. Bieżący rozwój Content AI toczy się
w osobnym repozytorium `Marcin1000/ContentAI` (jest podpięte jako zdalne `contentai`);
kopia tutaj jest starsza — nie ma np. katalogu `serwer/`. **Nie rozwijaj Content AI w tym
repo** — zmiany trafiają do `Marcin1000/ContentAI`.

## Uruchamianie

```bash
cp .env.example .env
npm start                 # serwer + UI na http://localhost:3000
```

Rdzeń nie ma zależności npm — wystarczy Node ≥ 18. `npm install` pobiera tylko Electron
(aplikacja okienkowa) i opcjonalnie Playwright (automatyzacja web).

```bash
npm run desktop           # Electron; sam startuje serwer
npm run dist              # instalator .exe do dist/
```

Zmysły (opcjonalne, każdy osobno — Cosmos działa bez nich):

```bash
python senses/service.py          # port 7060: /stt /tts /detect /pose /extract /embed /upscale
python senses/watcher.py          # obserwator kamery → POST /api/events
python senses/kinect_watcher.py   # zmysł głębi (libfreenect)
```

**W repo nie ma testów ani lintera.** Zmiany weryfikuje się uruchomieniem serwera i UI.
Jeśli dodajesz weryfikację, dodaj też skrypt w `package.json` — dziś są tylko
`start`, `desktop`, `dist`.

## Architektura

### `server.js` — dyrygent (2,6 tys. linii, jeden plik, zero zależności)

Ręcznie pisany router na `node:http` (bez frameworka), sekcje oddzielone komentarzami
`// ---`. Kolejność w routerze ma znaczenie: `/api/auth`, `/api/login`, `/api/logout`
są przed bramką, a **każde inne `/api/*` przechodzi przez `isAuthed()`**.

Źródła inteligencji za wspólnym interfejsem OpenAI-compatible:

| Profil | Skąd | Konfiguracja |
|---|---|---|
| `cloud` | build.nvidia.com (Nemotron) | `NVIDIA_API_KEY`, `NEMOTRON_*` |
| `local` | Ollama / vLLM / NIM na GPU | `LOCAL_BASE_URL`, `LOCAL_MODEL` |
| `openai`, `claude` | komercyjne | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |

Dwa ostatnie **dopisują się do `ENDPOINTS` dopiero, gdy klucz jest ustawiony** — bez klucza
nie ma zakładki w UI. `pickEndpoint()` przy nieznanej nazwie schodzi na `cloud`.

### Sedno: składanie kontekstu w `handleChat()`

To jest miejsce, które robi z Cosmosa „jeden organizm", a nie czat obok narzędzi. Przed
wysłaniem do modelu doklejane są **dodatkowe wiadomości systemowe** (`extras`), każda
sterowana flagą w payloadzie (`useSenses`, `useSearch`, `useActions`, `useMemory`, `useKb`,
`useStudio`) — domyślnie włączone, wyłączane przez `false`:

- profil użytkownika (zawsze, gdy niepusty),
- KONTEKST PERCEPCJI — ostatnie zdarzenia ze zmysłów,
- PAMIĘĆ DŁUGOTRWAŁA — wpisy przywołane semantycznie (embeddingi bge-m3 przez zmysły;
  bez zmysłów — wyszukiwanie po słowach kluczowych),
- BAZA WIEDZY — pozycje zaznaczone przez użytkownika (zawsze) + fragmenty dobrane
  automatycznie z reszty,
- opisy narzędzi (patrz protokół tagów).

Obrazy z bazy wiedzy nie idą jako tekst — są wstrzykiwane jako `image_url` do **ostatniej
wiadomości użytkownika**, żeby zobaczył je model wizyjny.

### Protokół tagów — narzędzia bez function calling

Model nie ma tool-callingu; zamiast tego instrukcja systemowa każe mu zakończyć odpowiedź
osobną linią, a klient ją wychwytuje (`public/app.js`, ok. linii 1028):

| Tag | Znaczenie |
|---|---|
| `[SZUKAJ: zapytanie]` | wyszukiwanie w internecie (DuckDuckGo HTML, bez klucza) |
| `[OBRAZ: opis po angielsku]` | generowanie grafiki przez Studio |
| `[AKCJA: typ \| treść]` | zapamiętaj / notatka / procedura — **zawsze z zatwierdzeniem człowieka** |

Dodając narzędzie, zmieniasz dwa miejsca naraz: opis w `extras` (server.js) i wyrażenie
regularne + obsługę w `public/app.js`. Rozjechanie się ich to najczęstszy błąd w tym kodzie.

### Zmysły — proxy, nie zależność

`proxySenses()` przekazuje żądania do usługi Pythona pod `SENSES_URL` (domyślnie
`http://localhost:7060`). Gdy usługa nie odpowiada, endpoint zwraca **502 z instrukcją, jak
ją uruchomić** — a reszta aplikacji działa dalej. Każda funkcja korzystająca ze zmysłów ma
zapasową ścieżkę (Whisper → Web Speech API, Piper → głos systemowy, embeddingi → słowa
kluczowe). Trzymaj tę zasadę przy nowych funkcjach.

### Bramka trybu auto (`automation/runner.js`)

Procedury mogą działać automatycznie **tylko** gdy każdy krok jest odczytem
(`open`/`wait`/`read`/`click`) albo logowaniem z menedżera haseł (`type` z `auth`). Jeden
krok wrażliwy lub zmieniający stan → runner odmawia (`error: 'not-readonly'`) i odsyła do
ręcznego asystenta z potwierdzeniem. Ta reguła jest zdublowana w `server.js`
(`READONLY_ACTIONS`) i w runnerze — **przy zmianie popraw oba miejsca**.

Hasła z menedżera (`SECRETS_PROVIDER`) pobiera proces serwera i przekazuje runnerowi przez
stdin. Nigdy nie trafiają do procedury, plików ani do klienta.

### Dane

Wszystko w `data/` (gitignore) jako zwykłe pliki JSON: `memory.json`, `profile.txt`,
`timeline.json`, `lessons.json`, `procedures.json`, `routines.json`, `conversations/`
(jeden plik na rozmowę + lekki indeks metadanych), `kb/` (baza wiedzy), `train/`.
Bez bazy danych — przy tej skali wystarcza i nie wnosi zależności.

### Front-end — bez budowania

`public/index.html` ładuje `i18n.js` i `app.js` bezpośrednio tagami `<script>`. Nie ma
bundlera, transpilacji ani modułów ES — pliki lecą do przeglądarki takie, jakie są.

`public/i18n.js` trzyma **dwa równoległe słowniki** (`pl`, `en`); `t()` schodzi na polski,
gdy klucza brak w wybranym języku, a na końcu zwraca sam klucz. Nowy tekst wymaga wpisu
w obu — inaczej angielski interfejs po cichu wyświetli polskie zdanie. Tłumaczenie
elementów idzie po atrybutach `data-i18n`, `data-i18n-html`, `data-i18n-ph`.

**Service worker:** `public/sw.js` cache'uje statykę strategią cache-first i przy aktywacji
kasuje cache o innej nazwie niż `CACHE`. Po zmianie czegokolwiek w `STATIC_ASSETS`
(`app.js`, `style.css`, `i18n.js`, fonty, ikony) **podnieś wersję** w `const CACHE =
'cosmos-vNN'` — inaczej użytkownicy z zainstalowaną PWA dostaną starą wersję.

### Mostek MCP (`mcp/cosmos-mcp.js`)

Osobny proces stdio, który wystawia bazę wiedzy, pamięć, zdarzenia i Studio jako narzędzia
MCP (Cursor, Claude Desktop, Claude Code). To **klient HTTP Cosmosa**, nie część serwera —
wymaga działającego `npm start` i, przy włączonym logowaniu, `COSMOS_TOKEN` równego
`COSMOS_API_TOKEN` serwera.

### Uwierzytelnianie

Wyłączone, gdy nie ustawiono ani `COSMOS_PASSWORD`, ani `COSMOS_API_TOKEN` (tryb domowy).
Sesje są **w pamięci procesu** — restart serwera wylogowuje wszystkich. `COSMOS_API_TOKEN`
to stały token dla klientów programowych (mostek MCP, skrypty). Przy wystawieniu publicznie
ustaw też `COSMOS_COOKIE_SECURE=1`.

## Klucze i sekrety

Wszystkie klucze żyją w `.env` (gitignore). `.env.example` jest szablonem z pustymi
wartościami — **nie wpisuj tam prawdziwych kluczy**. Konfiguracja czytana jest własnym
`loadDotEnv()` w `server.js`, bez `dotenv`: zmienne środowiskowe mają pierwszeństwo przed
plikiem.

`/api/config` celowo zwraca konfigurację **bez kluczy** — sprawdź to przy dodawaniu nowych.

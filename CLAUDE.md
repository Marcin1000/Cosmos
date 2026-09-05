# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Język repozytorium

Wszystko jest po polsku: komentarze, nazwy funkcji i zmiennych, komunikaty błędów,
dokumentacja, teksty commitów. Nowy kod pisz tak samo. Interfejs ma dwa języki (PL/EN),
ale kod mówi po polsku.

Wyjątek: `contentai/` — tam nazwy są mieszane (starsza warstwa angielska + nowsza polska),
patrz niżej.

**Dwa pliki README, dwie role.** `README.md` jest po angielsku i jest wizytówką repozytorium
na GitHubie — architektura, po co hybryda, czego się nauczyliśmy. `README.pl.md` jest po
polsku i jest pełną instrukcją obsługi dla Marcina. Zmiana funkcji widocznej z zewnątrz
wymaga wpisu w obu.

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

## Testy i audyt

```bash
npm test                  # 90 zestawów + 9 selftestów Pythona, ~12 min
npm run test:szybkie      # tylko bez przeglądarki, ~30 s
npm test -- plener mowa   # zestawy, których nazwa zawiera te słowa
npm run audyt             # audyt repozytorium: martwe klucze i18n, sekrety, spójność dokumentacji
```

Kod wyjścia `0` znaczy „wszystko zdane". Szczegóły — jak napisać nowy zestaw, jakie są
gotowe środowiska, jakie słowa sterują atrapą modelu — są w **`tests/README.md`**. Przeczytaj
go, zanim dopiszesz test.

Dwie zasady wyniesione z tego repo boleśnie i obie kosztowały pół dnia diagnozy:

**Testuj gwarancję, nie brzmienie.** Zestaw, który sprawdza regexpem, czy w `public/app.js`
stoi konkretne zdanie, pada przy każdym przeniesieniu kodu do modułu — mimo że funkcja
działa bez zmian. Zdarzyło się to tu pięć razy. Wołaj funkcję i patrz na wynik.

**Nigdy `waitUntil: 'networkidle'`.** Cosmos trzyma otwarty `/api/events/stream`, więc
„cisza w sieci" nie nastąpi nigdy. Używaj `'load'` i czekaj jawnie (`waitForSelector`,
`waitForFunction`). Kiedyś te zestawy przechodziły przypadkiem; gdy przestały, padły
**34 naraz** na kodzie, którego nikt nie ruszał.

Zestawy przeglądarkowe potrzebują Playwrighta. Gdy jest zainstalowany globalnie, uruchamiaj
przez `NODE_PATH=/opt/node22/lib/node_modules npm test` — inaczej `require('playwright')`
nie trafi i uruchamiacz po cichu pominie 48 zestawów przeglądarkowych. Przed baterią ubij zostawione
serwery (`pkill -f 'node server.js'`) i **nie uruchamiaj dwóch baterii naraz** — walczą
o porty i dają fałszywe awarie.

## Architektura

Rozmiary, żeby wiedzieć, gdzie szukać: `server.js` 2,6 tys. linii, `lib/` 9,7 tys. w 24
modułach, `public/` 11,2 tys. w 10 skryptach. Zero zależności npm w rdzeniu — nadal.

### `server.js` — dyrygent (2,6 tys. linii, zero zależności)

Ręcznie pisany router na `node:http` (bez frameworka), sekcje oddzielone komentarzami
`// ---`. Kolejność w routerze ma znaczenie: `/api/auth`, `/api/login`, `/api/logout`
są przed bramką, a **każde inne `/api/*` przechodzi przez `isAuthed()`**.

Serwer sam już niewiele liczy — trzyma router, składanie kontekstu i strumieniowanie,
a resztę deleguje do `lib/`.

### `lib/` — dziedziny, każda osobno

Moduł eksportuje fabrykę `utworz…({zależności})` i oddaje obiekt z funkcjami. Zależności
wstrzykuje `server.js`, więc test może podstawić atrapę bez stawiania serwera — i tak
robi większość szybkich zestawów.

| Moduł | Za co odpowiada |
|---|---|
| `archiwum.js`, `archiwum-trasy.js` | indeks plików zdjęciowych, wyszukiwanie, stronicowanie |
| `ekspozycja.js`, `ujecia.js`, `tematy.js` | plan zdjęciowy: nastawy, kadry, katalog sprzętu |
| `instrukcje-narzedzi.js` | **wszystkie opisy narzędzi dla modelu** (dawniej `extras` w `server.js`) |
| `nauka.js` | procedury, bramka trybu auto |
| `pamiec.js`, `dokumenty.js`, `szukanie.js` | pamięć długotrwała, baza wiedzy, wyszukiwanie w sieci |
| `exif.js`, `raw-podglad.js`, `srt.js`, `kmz.js` | formaty plików, bez zależności zewnętrznych |
| `canon.js`, `onedrive.js`, `zorza.js`, `miejsca.js` | integracje zewnętrzne |

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
- ZESTAW SPRZĘTU (`blokSprzetu()`) — korpus, obiektywy, dodatki **wraz z zasadą, że nastawy
  mają się w nich mieścić**. Sama lista nie wystarczyła: model dalej pisał „f/2.8" komuś,
  kto ma wyłącznie f/4. Pilnuje tego zestaw `zestaw-sprzetu`, punkt 7,
- opisy narzędzi (patrz protokół tagów).

Obrazy z bazy wiedzy nie idą jako tekst — są wstrzykiwane jako `image_url` do **ostatniej
wiadomości użytkownika**, żeby zobaczył je model wizyjny.

### Protokół tagów — narzędzia bez function calling

Model nie ma tool-callingu; zamiast tego instrukcja systemowa każe mu napisać znacznik
w osobnej linii, a klient go wychwytuje:

| Tag | Znaczenie |
|---|---|
| `[SZUKAJ: zapytanie]` | wyszukiwanie w internecie (DuckDuckGo HTML, bez klucza) |
| `[GRAFIKA: A; B; C]` | zdjęcia miejsc z sieci — do dziesięciu znaczników, każdy pod punktem, którego dotyczy |
| `[OBRAZ: opis po angielsku]` | generowanie grafiki przez Studio |
| `[ARCHIWUM: grupuj=rok]` | własne archiwum zdjęć |
| `[PLAN: obiektyw=…]` | plan zdjęciowy — nastawy liczone z efemeryd i pogody |
| `[AKCJA: typ \| treść]` | zapamiętaj / notatka / procedura — **zawsze z zatwierdzeniem człowieka** |

Dodając narzędzie, zmieniasz **dwa miejsca naraz**: opis w `lib/instrukcje-narzedzi.js`
i wyrażenie regularne + obsługę w `public/narzedzia.js`. Rozjechanie się ich to najczęstszy
błąd w tym kodzie.

**Kaskada.** Jedna tura może uruchomić kilka narzędzi po kolei — `MAX_SEARCHES = 3`, czyli
do czterech rund. Zanim to powstało, model prosił o plan i o zdjęcia, a dostawał tylko plan;
przy ponownej prośbie generował plan od nowa i Marcin dostawał trzy plany i zero zdjęć.
Grafiki lecą **po** zwycięskim narzędziu, żeby zdjęcia trafiły pod gotowe punkty planu.

**Znaczniki nie mają prawa stanąć na ekranie** — ani w całości, ani urwane w połowie
(skończył się budżet tokenów, człowiek nacisnął „stop"), ani opakowane w ```blok```.
Czyści to `stripSearchMarker()` w `public/protokol.js`; pilnuje zestaw
`znaczniki-nie-wyciekaja`, który sprawdza też stronę odwrotną — że zwykły nawias
kwadratowy w zdaniu i odnośnik Markdown zostają nietknięte.

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
ręcznego asystenta z potwierdzeniem. Ta reguła jest zdublowana w `lib/nauka.js`
(`READONLY_ACTIONS`, ok. linii 347) i w `automation/runner.js` — **przy zmianie popraw oba
miejsca**.

Hasła z menedżera (`SECRETS_PROVIDER`) pobiera proces serwera i przekazuje runnerowi przez
stdin. Nigdy nie trafiają do procedury, plików ani do klienta.

### Dane

Wszystko w `data/` (gitignore) jako zwykłe pliki JSON: `memory.json`, `profile.txt`,
`timeline.json`, `lessons.json`, `procedures.json`, `routines.json`, `conversations/`
(jeden plik na rozmowę + lekki indeks metadanych), `kb/` (baza wiedzy), `train/`.
Bez bazy danych — przy tej skali wystarcza i nie wnosi zależności.

### Front-end — bez budowania

`public/index.html` ładuje skrypty bezpośrednio tagami `<script>`. Nie ma bundlera,
transpilacji ani modułów ES — pliki lecą do przeglądarki takie, jakie są.

Kolejność w `index.html` ma znaczenie: `app.js` jest **ostatni**, bo woła fabryki
z pozostałych.

| Plik | Za co odpowiada |
|---|---|
| `app.js` | rozmowa, strumieniowanie, stan aplikacji — nadal największy |
| `narzedzia.js` | obsługa znaczników i kaskada narzędzi |
| `widoki.js` | budowniczowie DOM-u: siatki wyników, kafelki, karty |
| `nasluch.js` | tryb głosowy, rozpoznawanie mowy, „naciśnij, aby mówić" |
| `mowa.js` | sklejanie i odsiewanie powtórzeń z rozpoznawania mowy — czysty tekst, zero DOM-u |
| `plener.js` | panel Pleneru: plan, kadry, wysyłka do aparatu |
| `tekst.js` | Markdown → HTML, bloki kodu, przycisk kopiowania |
| `protokol.js` | czyszczenie znaczników, nagłówki kontekstu — czyste funkcje |
| `models.js` | katalog modeli, zakładki silników |
| `i18n.js` | dwa słowniki (PL/EN) |

Moduły trzymają się wzorca dwustronnego, żeby ten sam plik działał w przeglądarce
i w `require()` z testu:

```js
if (typeof window !== 'undefined') window.utworzMowe = utworzMowe;
if (typeof module !== 'undefined') module.exports = { utworzMowe };
```

Dzięki temu zestaw sprawdzający np. sklejanie mowy woła funkcję wprost w Node, bez
przeglądarki i bez `page.evaluate`.

**Rozpoznawanie mowy na Androidzie.** Chrome **nie honoruje `continuous`** — kończy sesję
po każdej wypowiedzi i wznawia ją sam, rozpoznając przy tym nachodzące audio. Stąd
dublowany tekst i dźwięk włączania mikrofonu co kilka sekund. Odsiewanie powtórzeń siedzi
w `mowa.js`, a po `WZNOWIEN_ZANIM_PRZYCISK = 12` wznowieniach Cosmos przechodzi na „naciśnij,
aby mówić". Nie zakładaj, że `continuous` gdziekolwiek działa.

`public/i18n.js` trzyma **dwa równoległe słowniki** (`pl`, `en`); `t()` schodzi na polski,
gdy klucza brak w wybranym języku, a na końcu zwraca sam klucz. Nowy tekst wymaga wpisu
w obu — inaczej angielski interfejs po cichu wyświetli polskie zdanie. Tłumaczenie
elementów idzie po atrybutach `data-i18n`, `data-i18n-html`, `data-i18n-ph`.

**Service worker:** `public/sw.js` cache'uje statykę strategią cache-first i przy aktywacji
kasuje cache o innej nazwie niż `CACHE`. Po zmianie czegokolwiek w `STATIC_ASSETS`
**podnieś wersję** w `const CACHE = 'cosmos-vNN'` — inaczej użytkownicy z zainstalowaną PWA
dostaną starą wersję. **Nowy skrypt w `public/` to trzy miejsca naraz:** `index.html`
(tag `<script>`), `sw.js` (`STATIC_ASSETS`) i podniesiona wersja cache'a. Pominięcie
`sw.js` daje najgorszy możliwy objaw: działa u ciebie, nie działa na telefonie Marcina.

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

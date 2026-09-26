# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Język repozytorium

Wszystko jest po polsku: komentarze, nazwy funkcji i zmiennych, komunikaty błędów,
dokumentacja, teksty commitów. Nowy kod pisz tak samo. Interfejs ma dwa języki (PL/EN),
ale kod mówi po polsku.

**Bez długich myślników.** Nigdzie w repozytorium (kod, komentarze, teksty interfejsu,
dokumentacja, commity): zamiast „—” półpauza „–” albo przebudowane zdanie. Kod, który musi
rozpoznać długi myślnik w cudzym tekście (odpowiedź modelu, strona z sieci), zapisuje go
jako `\u2014`. Pilnuje tego audyt.

**Dwa pliki README, dwie role.** `README.md` jest po angielsku i jest wizytówką repozytorium
na GitHubie – architektura, po co hybryda, czego się nauczyliśmy. `README.pl.md` jest po
polsku i jest pełną instrukcją obsługi dla Marcina. Zmiana funkcji widocznej z zewnątrz
wymaga wpisu w obu.

## Jeden projekt, jedno repo

To repozytorium zawiera **wyłącznie Cosmosa** – osobiste środowisko AI: czat, percepcja,
baza wiedzy, studio mediów, plan zdjęciowy, nauka procedur.

Nie dokładaj tu innych projektów, nawet „tymczasowo". Repozytorium nosiło kiedyś nazwę
`Bear` i mieszkały w nim obok siebie trzy rzeczy: Cosmos, migawka Content AI i prototyp
serwisu dla klienta. Kosztowało to 137 MB, opis języka „HTML" zamiast JavaScriptu na
GitHubie i publiczny wgląd w cudze materiały handlowe. Wyczyszczenie wymagało przepisania
całej historii i **usunięcia repozytorium**, bo referencji pull requestów (`refs/pull/*`)
nie da się skasować inaczej – GitHub trzyma je na zawsze i żadne wymuszone wypchnięcie
ich nie rusza.

Stąd zasada: **obcy kod idzie do własnego repozytorium od pierwszego commita.** Cofnięcie
tego później jest nieproporcjonalnie drogie.

## Uruchamianie

```bash
cp .env.example .env
npm start                 # strona produktowa na http://localhost:3000, Cosmos pod /app
```

Rdzeń nie ma zależności npm – wystarczy Node ≥ 18. `npm install` pobiera tylko Electron
(aplikacja okienkowa) i opcjonalnie Playwright (automatyzacja web).

```bash
npm run desktop           # Electron; sam startuje serwer
npm run dist              # instalator .exe do dist/
```

Zmysły (opcjonalne, każdy osobno – Cosmos działa bez nich):

```bash
python senses/service.py          # port 7060: /stt /tts /detect /pose /extract /embed /upscale
python senses/watcher.py          # obserwator kamery → POST /api/events
python senses/kinect_watcher.py   # zmysł głębi (libfreenect)
```

## Testy i audyt

```bash
npm test                  # 120 zestawów + 9 selftestów Pythona, ~12 min
npm run test:szybkie      # tylko bez przeglądarki, ~30 s
npm test -- plener mowa   # zestawy, których nazwa zawiera te słowa
npm run audyt             # audyt repozytorium: martwe klucze i18n, sekrety, spójność dokumentacji
```

Kod wyjścia `0` znaczy „wszystko zdane". Szczegóły – jak napisać nowy zestaw, jakie są
gotowe środowiska, jakie słowa sterują atrapą modelu – są w **`tests/README.md`**. Przeczytaj
go, zanim dopiszesz test.

Dwie zasady wyniesione z tego repo boleśnie i obie kosztowały pół dnia diagnozy:

**Testuj gwarancję, nie brzmienie.** Zestaw, który sprawdza regexpem, czy w `public/app.js`
stoi konkretne zdanie, pada przy każdym przeniesieniu kodu do modułu – mimo że funkcja
działa bez zmian. Zdarzyło się to tu pięć razy. Wołaj funkcję i patrz na wynik.

**Nigdy `waitUntil: 'networkidle'`.** Cosmos trzyma otwarty `/api/events/stream`, więc
„cisza w sieci" nie nastąpi nigdy. Używaj `'load'` i czekaj jawnie (`waitForSelector`,
`waitForFunction`). Kiedyś te zestawy przechodziły przypadkiem; gdy przestały, padły
**34 naraz** na kodzie, którego nikt nie ruszał.

Zestawy przeglądarkowe potrzebują Playwrighta. Gdy jest zainstalowany globalnie, uruchamiaj
przez `NODE_PATH=/opt/node22/lib/node_modules npm test` – inaczej `require('playwright')`
nie trafi i uruchamiacz po cichu pominie 48 zestawów przeglądarkowych. Przed baterią ubij zostawione
serwery (`pkill -f 'node server.js'`) i **nie uruchamiaj dwóch baterii naraz** – walczą
o porty i dają fałszywe awarie.

## Zespoły agentów

Przeglądy i poprawki robią dwa zespoły agentów zdefiniowane w `.claude/agents/`:
**agencja** (`agencja-*`: UX/UI, frontend, backend, rozmowa, strona – projekt i frontend,
copywriter, wykonawca) i **zespół IT** (`it-*`: infrastruktura i Cloudflare, konta, modele
komercyjne, modele open source, płynność, backend). Wspólny protokół – tablica, porty, twarde
zasady i **przetrwanie limitu sesji** (dziennik roli, wznawianie z pamięcią, strażnik co
godzinę) – jest w **`docs/ZESPOLY.md`**. Przeczytaj go, zanim wypuścisz zespół.

## Architektura

Rozmiary, żeby wiedzieć, gdzie szukać: `server.js` 1,4 tys. linii, `lib/` 14,8 tys. w 47
modułach, `public/` 13,3 tys. w 17 skryptach. Zero zależności npm w rdzeniu – nadal.

### `server.js` – dyrygent (1,4 tys. linii, zero zależności)

Ręcznie pisany router na `node:http` (bez frameworka), sekcje oddzielone komentarzami
`// ---`. Kolejność w routerze ma znaczenie: `/api/auth`, `/api/login`, `/api/logout`
są przed bramką, a **każde inne `/api/*` przechodzi przez `isAuthed()`**.

Serwer sam już niewiele liczy – trzyma router, konfigurację i manifest zdolności,
a resztę deleguje do `lib/` (czat razem ze składaniem kontekstu: `lib/czat.js`).

### `lib/` – dziedziny, każda osobno

Moduł eksportuje fabrykę `utworz…({zależności})` i oddaje obiekt z funkcjami. Zależności
wstrzykuje `server.js`, więc test może podstawić atrapę bez stawiania serwera – i tak
robi większość szybkich zestawów.

| Moduł | Za co odpowiada |
|---|---|
| `archiwum.js`, `archiwum-trasy.js` | indeks plików zdjęciowych, wyszukiwanie, stronicowanie |
| `ekspozycja.js`, `ujecia.js`, `tematy.js` | plan zdjęciowy: nastawy, kadry, katalog sprzętu |
| `instrukcje-narzedzi.js` | **wszystkie opisy narzędzi dla modelu** (dawniej `extras` w `server.js`) |
| `kontekst.js`, `konta.js`, `silniki.js` | kto pyta, konta i sesje, kto może użyć którego silnika |
| `nauka.js` | procedury, bramka trybu auto |
| `pamiec.js`, `dokumenty.js`, `szukanie.js` | pamięć długotrwała, wyciąganie tekstu z dokumentów, wyszukiwanie w sieci |
| `baza-wiedzy.js` | baza wiedzy: pliki, linki, notatki, fragmenty z wektorami, podgląd obrazu dla modelu |
| `rozmowy.js` | historia rozmów: plik na rozmowę + indeks, dopisywanie odpowiedzi-sierot, kopia zapasowa |
| `czat.js` | `POST /api/chat`: składanie kontekstu, okno modelu lokalnego, wybór modelu, wysyłka, biegi – kroki jako osobne funkcje, czyste na poziomie modułu |
| `exif.js`, `raw-podglad.js`, `srt.js`, `kmz.js` | formaty plików, bez zależności zewnętrznych |
| `canon.js`, `onedrive.js`, `zorza.js`, `miejsca.js` | integracje zewnętrzne |
| `zadania.js` | praca dłuższa niż 100 s Cloudflare'a (Studio): czekanie do 75 s, potem 202 i dopytywanie |
| `miejsce.js` | limit miejsca na osobę, 507 przy pełnym dysku, `bladZapisu` |
| `statyka.js` | pliki statyczne, ETag, pamięć skompresowanych, **CSP aplikacji** |
| `plener-trasy.js` | plan zdjęciowy, misja drona (KMZ), Canon, zestaw sprzętu |
| `zmysly-proxy.js` | pośrednik do usługi zmysłów: ptak, wykrywanie, poza, Kinect |
| `os-czasu.js` | oś czasu migawek otoczenia |

Źródła inteligencji za wspólnym interfejsem OpenAI-compatible:

| Profil | Skąd | Konfiguracja |
|---|---|---|
| `cloud` | build.nvidia.com (Nemotron) | `NVIDIA_API_KEY`, `NEMOTRON_*` |
| `local` | Ollama / vLLM / NIM na GPU | `LOCAL_BASE_URL`, `LOCAL_MODEL` |
| `openai`, `claude` | komercyjne | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |

Dwa ostatnie **dopisują się do `ENDPOINTS` dopiero, gdy klucz jest ustawiony** – bez klucza
nie ma zakładki w UI. `pickEndpoint()` przy nieznanej nazwie schodzi na `cloud`.

### Sedno: składanie kontekstu w `lib/czat.js` (`zlozKontekst()`)

To jest miejsce, które robi z Cosmosa „jeden organizm", a nie czat obok narzędzi. Przed
wysłaniem do modelu doklejane są **dodatkowe wiadomości systemowe** (`extras`), każda
sterowana flagą w payloadzie (`useSenses`, `useSearch`, `useActions`, `useMemory`, `useKb`,
`useStudio`) – domyślnie włączone, wyłączane przez `false`:

- profil użytkownika (zawsze, gdy niepusty),
- KONTEKST PERCEPCJI – ostatnie zdarzenia ze zmysłów,
- PAMIĘĆ DŁUGOTRWAŁA – wpisy przywołane semantycznie (embeddingi bge-m3 przez zmysły;
  bez zmysłów – wyszukiwanie po słowach kluczowych). Wpis trzyma `wektory: {model: wektor}`
  dla dwóch dostawców naraz; czytaj i zapisuj je tylko przez `wektorDla` / `ustawWektor`
  z `lib/pamiec.js` (pamięć, baza wiedzy, wzorce nauki),
- BAZA WIEDZY – pozycje zaznaczone przez użytkownika (zawsze) + fragmenty dobrane
  automatycznie z reszty,
- ZESTAW SPRZĘTU (`blokSprzetu()`) – korpus, obiektywy, dodatki **wraz z zasadą, że nastawy
  mają się w nich mieścić**. Sama lista nie wystarczyła: model dalej pisał „f/2.8" komuś,
  kto ma wyłącznie f/4. Pilnuje tego zestaw `zestaw-sprzetu`, punkt 7,
- opisy narzędzi (patrz protokół tagów).

Obrazy z bazy wiedzy nie idą jako tekst – są wstrzykiwane jako `image_url` do **ostatniej
wiadomości użytkownika**, żeby zobaczył je model wizyjny. Idzie **podgląd** (`<id>.podglad`,
≤1568 px), nie oryginał – robi go przeglądarka (`public/wysylka.js`, `POST /api/kb/podglad`),
bo serwer nie ma dekodera obrazów. Bez podglądu oryginał idzie tylko do 3,5 MB
(`obrazDlaModelu()`); większy zostaje w domu, a model dostaje zdanie, że jest za duży.

**Za Cloudflare (100 s bez bajtu = strona 524)** obowiązują trzy rzeczy: biegi wysyłają
widzom puls `: puls` co 25 s (`lib/biegi.js`); `COSMOS_CISZA_MODELU_MS` przed nagłówkami
zostaje ≤ 95 s, bo przeglądarka nie ma wtedy jeszcze pulsu; każde żądanie, na które czeka
przeglądarka, mieści się w ~90 s (dłuższa praca – w tle, jak transkrypcja nagrania do
bazy wiedzy). Studio robi to przez `lib/zadania.js`: trasa czeka na wynik do 75 s,
potem odpowiada 202 z numerem zadania, a przeglądarka (`czekajNaZadanie`
w `public/narzedzia.js`) i mostek MCP dopytują `GET /api/zadania?id=…`. Nowa długa
praca w imieniu osoby idzie tą samą drogą. Modele myślące po cichu (gpt-5+, Claude 5) mają osobny limit do pierwszej
treści. Restart (SIGTERM) daje biegom do 20 s i zapisuje resztę w rozmowach.

Dla modelu lokalnego czat liczy **okno kontekstu** (`LOCAL_NUM_CTX`, dla Ollamy domyślnie
4096): przy małym oknie krótsza wersja instrukcji, najstarsze tury wypadają jawnie
(nagłówek `X-Cosmos-Okno`), limit odpowiedzi dopasowany do reszty.

### Protokół tagów – narzędzia bez function calling

Model nie ma tool-callingu; zamiast tego instrukcja systemowa każe mu napisać znacznik
w osobnej linii, a klient go wychwytuje:

| Tag | Znaczenie |
|---|---|
| `[SZUKAJ: zapytanie]` | wyszukiwanie w internecie (DuckDuckGo HTML, bez klucza) |
| `[GRAFIKA: A; B; C]` | zdjęcia miejsc z sieci – do dziesięciu znaczników, każdy pod punktem, którego dotyczy |
| `[OBRAZ: opis po angielsku]` | generowanie grafiki przez Studio |
| `[ARCHIWUM: grupuj=rok]` | własne archiwum zdjęć |
| `[PLAN: obiektyw=…]` | plan zdjęciowy – nastawy liczone z efemeryd i pogody |
| `[AKCJA: typ \| treść]` | zapamiętaj / notatka / procedura – **zawsze z zatwierdzeniem człowieka** |

Dodając narzędzie, zmieniasz **dwa miejsca naraz**: opis w `lib/instrukcje-narzedzi.js`
i wyrażenie regularne + obsługę w `public/narzedzia.js`. Rozjechanie się ich to najczęstszy
błąd w tym kodzie.

**Kaskada.** Jedna tura może uruchomić kilka narzędzi po kolei – `MAX_SEARCHES = 3`, czyli
do czterech rund. Zanim to powstało, model prosił o plan i o zdjęcia, a dostawał tylko plan;
przy ponownej prośbie generował plan od nowa i Marcin dostawał trzy plany i zero zdjęć.
Grafiki lecą **po** zwycięskim narzędziu, żeby zdjęcia trafiły pod gotowe punkty planu.

Wzorce znaczników są tolerancyjne (spacja po nawiasie, nawiasy i dwukropek pełnej
szerokości `【SZUKAJ：…】`, jak piszą małe modele lokalne i Qwen) – nowy znacznik buduj
funkcją `znacznik(nazwa)` w `public/protokol.js`, nie ręcznym regexpem.

**Znaczniki nie mają prawa stanąć na ekranie** – ani w całości, ani urwane w połowie
(skończył się budżet tokenów, człowiek nacisnął „stop"), ani opakowane w ```blok```.
Czyści to `stripSearchMarker()` w `public/protokol.js`; pilnuje zestaw
`znaczniki-nie-wyciekaja`, który sprawdza też stronę odwrotną – że zwykły nawias
kwadratowy w zdaniu i odnośnik Markdown zostają nietknięte.

### Zmysły – proxy, nie zależność

`proxySenses()` przekazuje żądania do usługi Pythona pod `SENSES_URL` (domyślnie
`http://localhost:7060`). Gdy usługa nie odpowiada, endpoint zwraca **502 z instrukcją, jak
ją uruchomić** – a reszta aplikacji działa dalej. Każda funkcja korzystająca ze zmysłów ma
zapasową ścieżkę (Whisper → Web Speech API, Piper → głos systemowy, embeddingi → słowa
kluczowe). Trzymaj tę zasadę przy nowych funkcjach.

### Bramka trybu auto (`automation/runner.js`)

Procedury mogą działać automatycznie **tylko** gdy każdy krok jest odczytem
(`open`/`wait`/`read`/`click`) albo logowaniem z menedżera haseł (`type` z `auth`). Jeden
krok wrażliwy lub zmieniający stan → runner odmawia (`error: 'not-readonly'`) i odsyła do
ręcznego asystenta z potwierdzeniem. Ta reguła jest zdublowana w `lib/nauka.js`
(`READONLY_ACTIONS`, ok. linii 347) i w `automation/runner.js` – **przy zmianie popraw oba
miejsca**.

Hasła z menedżera (`SECRETS_PROVIDER`) pobiera proces serwera i przekazuje runnerowi przez
stdin. Nigdy nie trafiają do procedury, plików ani do klienta.

### Wiele osób – kontekst użytkownika (przeczytaj, zanim dotkniesz danych)

Od września 2026 Cosmos ma konta: **właściciel** i **członkowie** zapraszani linkiem.
Każda osoba ma własne dane, a właściciel nie widzi cudzych treści (tylko konta i zużycie).
Instrukcja dla ludzi: `docs/DOSTEP.md`.

**Każde żądanie `/api/*` wykonuje się w imieniu osoby** – `server.js` ustala ją
w `ktoPyta()` i woła `wKontekscie(u, () => trasyApi(…))`. Kontekst (`AsyncLocalStorage`,
`lib/kontekst.js`) podąża za każdym `await`, timerem i pracą w tle.

Zasady, których nie wolno łamać:

1. **Nigdy `path.join(DATA_DIR, …)` dla danych osoby.** Używaj `stan(klucz, fabryka)`
   albo `naUzytkownika(klucz, fabryka)` z `lib/kontekst.js` – fabryka dostaje katalog
   bieżącej osoby. `DATA_DIR` wprost jest tylko dla rzeczy serwera (`konta/`).
2. **Brak kontekstu = wyjątek, nigdy wartość domyślna.** Jeśli coś rzuca
   `BrakKontekstu`, to znaczy, że kod biegnie poza żądaniem (timer, start serwera,
   `res.on('close')`). Napraw to jawnym `wKontekscie(u, …)` – nie „weź właściciela
   na wszelki wypadek". Cicha wartość domyślna pokazałaby dane jednej osoby drugiej
   i nic nie wyglądałoby na zepsute.
3. **Zdarzenia HTTP (`res.on('close')`, `req.on(…)`) NIE mają kontekstu żądania** –
   biegną w kontekście serwera. Stąd `lib/biegi.js` przypina osobę do biegu przy jego
   założeniu i zapisuje odpowiedź-sierotę jawnie w jej imieniu.
4. **Nie eksportuj stanu jako wartości** (`kbItems`, `userProfile`) do innych modułów –
   tylko jako funkcję. Wartość wstrzyknięta przy starcie to dane pierwszej osoby dla
   wszystkich.
5. **Nowa trasa działająca na serwerze albo w domu właściciela** (procesy, sprzęt
   w sieci lokalnej, adresy odpytywane przez serwer) → dopisz ją do `TYLKO_WLASCICIEL`
   w `server.js`. Ukrycie przycisku w interfejsie (`class="tylko-wlasciciel"`) to
   wygoda, nie zabezpieczenie.
6. **Wybór silnika idzie przez `pickEndpoint`**, który pyta strażnika z `lib/silniki.js`
   (przyznane uprawnienia, własne klucze). Nie czytaj `ENDPOINTS[nazwa]` wprost w nowym
   kodzie – ominąłbyś uprawnienia i płaciłby właściciel. Na silniku **przyznanym** model
   i `max_tokens` przechodzą przez `silniki.modelDozwolony` / `tokenyDozwolone` (lista
   właściciela, sufit) – nowe wywołanie modelu w imieniu osoby korzysta z nich (czat
   i `llmComplete` już to robią).
7. **Dane od innych osób (imiona, loginy) do DOM-u tylko przez `textContent`.**
   Panel Dostęp pokazuje właścicielowi imiona wpisane przez gości.
8. **Zmysły to domowe GPU właściciela** – każda droga do `SENSES_URL` w imieniu osoby
   sprawdza `silniki.zmyslyDozwolone()` (trasa → 403, wyciąganie tekstu → pusty wynik).
   Adres domu (`SENSES_URL`, `LOCAL_BASE_URL`) i ścieżki serwera nie trafiają do członka
   ani w `/api/config`, ani w komunikatach błędów.

Pilnują tego zestawy `izolacja-osob`, `konta-i-logowanie`, `konta-w-przegladarce`.

### Dane

Pliki serwera w `data/konta/` (konta, sesje jako skróty, zaproszenia – uprawnienia `0600`).
Dane każdej osoby w `data/uzytkownicy/<id>/` jako zwykłe pliki JSON: `memory.json`,
`profile.txt`, `timeline.json`, `lessons.json`, `procedures.json`, `routines.json`,
`conversations/` (jeden plik na rozmowę + lekki indeks metadanych), `kb/` (baza wiedzy),
`klucze.json` (własne klucze API). Właściciel ma stały identyfikator `wlasciciel`;
trening (`train/`) jest tylko u niego. Konto usunięte → dane do `data/usuniete/`, nie kosz.

Stary układ (wszystko wprost w `data/`) przenosi się sam przy starcie do katalogu
właściciela, z kopią `data/kopia-przed-kontami-*/` – patrz `migrujDoKont()` w `server.js`.
Testy czytające pliki z dysku pytają o ścieżkę `katalogOsoby(env)` z `tests/pomoc.js`.

Bez bazy danych – przy tej skali wystarcza i nie wnosi zależności. Ceną jest dyscyplina:

- **Odczyt JSON-a z danymi tylko przez `czytajJson`** (`lib/rdzen.js`), nigdy
  `try { JSON.parse } catch { return [] }`. Uszkodzony plik dawał pusty stan, a pierwszy
  zapis go nadpisywał – tak ginęli członkowie i pamięć. `czytajJson` odkłada kopię
  `*.uszkodzony-<czas>`, wraca do `.bak`, a przy `krytyczny` (konta) zatrzymuje start.
- **Zapis przez `zapiszAtomowo`.** `kopia: true` (poprzednia wersja jako `.bak`, twarde
  dowiązanie) dla danych nie do odtworzenia; `trwale: true` (fsync) tylko dla małych
  krytycznych plików – fsync stoi w pętli zdarzeń. Duże i częste zapisy – odroczone.
- **Nieudany zapis nie odpowiada „ok".** Funkcje `save*` (i `saveJsonFile`) nie rzucają,
  ale ZWRACAJĄ błąd (`null` = zapisane); trasa sprawdza wynik i odpowiada
  `bladZapisu(res, err)` – 507 przy pełnym dysku i przekroczonym limicie, 500 przy
  innym błędzie (`lib/miejsce.js`). Stan w pamięci zmieniaj dopiero po udanym zapisie.
  Nowy zapis pliku w imieniu osoby woła przedtem `miejsce_.sprawdz(bajty)` (limit
  `COSMOS_LIMIT_MB_OSOBY`); `kbAddFile` robi to za wszystkich, którzy idą przez bazę wiedzy.
- **Długie liczenie w żądaniu – porcjami.** Pętla zdarzeń jest jedna dla wszystkich
  osób: paczka 5000 wpisów archiwum liczona jednym ciągiem stawiała serwer na ~2 s,
  razem ze strumieniami czatu. Praca na tysiącach elementów oddaje pętlę co ~100 ms
  (`archiwum.dodajPorcjami`, `await new Promise(setImmediate)`); pilnuje tego
  `archiwum-bez-zamrozen`.

### Front-end – bez budowania

`public/index.html` ładuje skrypty bezpośrednio tagami `<script>`. Nie ma bundlera,
transpilacji ani modułów ES – pliki lecą do przeglądarki takie, jakie są.

**Aplikacja ma CSP** (`lib/statyka.js`): skrypty wyłącznie z naszego adresu plus skrypt
inline z `index.html`, którego skrót serwer liczy z pliku. Nie dodawaj atrybutów `on*=`,
linków `javascript:` ani `eval` – przeglądarka je zablokuje (zestaw `csp-aplikacji`).
Zapytania tylko do własnego adresu (`connect-src 'self'`); coś z zewnątrz = przez serwer.

Kolejność w `index.html` ma znaczenie: `app.js` jest **ostatni**, bo woła fabryki
z pozostałych.

| Plik | Za co odpowiada |
|---|---|
| `app.js` | rozmowa, strumieniowanie, stan aplikacji – nadal największy |
| `narzedzia.js` | obsługa znaczników i kaskada narzędzi |
| `widoki.js` | budowniczowie DOM-u: siatki wyników, kafelki, karty |
| `nasluch.js` | tryb głosowy, rozpoznawanie mowy, „naciśnij, aby mówić" |
| `mowa.js` | sklejanie i odsiewanie powtórzeń z rozpoznawania mowy – czysty tekst, zero DOM-u |
| `plener.js` | panel Pleneru: plan, kadry, wysyłka do aparatu |
| `tekst.js` | Markdown → HTML, bloki kodu, przycisk kopiowania |
| `protokol.js` | czyszczenie znaczników, nagłówki kontekstu – czyste funkcje |
| `konta.js` | zaproszenie, Twoje konto, panel Dostęp; czyszczenie pamięci przeglądarki przy zmianie osoby |
| `models.js` | katalog modeli, zakładki silników |
| `i18n.js` | dwa słowniki (PL/EN) |
| `studio-widok.js` | widok Studia: obraz, szablony, storyboard, edycja, dźwięk, wideo; zadania w tle |
| `pwa.js` | service worker i pasek „Jest nowa wersja” |
| `wysylka.js` | wysyłka pliku do bazy wiedzy z postępem; podgląd zdjęcia dla modelu |
| `kamera.js` | kamera na żywo: podgląd, Kinect, detekcja, sylwetka, dopasowanie panelu |
| `nauka-widok.js` | panel Nauka: rozpoznawanie, procedury, rutyny, runner z potwierdzeniem |
| `strona/` | strona produktowa pod `/` – osobna od aplikacji, własny CSS i skrypt |

Moduły trzymają się wzorca dwustronnego, żeby ten sam plik działał w przeglądarce
i w `require()` z testu:

```js
if (typeof window !== 'undefined') window.utworzMowe = utworzMowe;
if (typeof module !== 'undefined') module.exports = { utworzMowe };
```

Dzięki temu zestaw sprawdzający np. sklejanie mowy woła funkcję wprost w Node, bez
przeglądarki i bez `page.evaluate`.

**Rozpoznawanie mowy na Androidzie.** Chrome **nie honoruje `continuous`** – kończy sesję
po każdej wypowiedzi i wznawia ją sam, rozpoznając przy tym nachodzące audio. Stąd
dublowany tekst i dźwięk włączania mikrofonu co kilka sekund. Odsiewanie powtórzeń siedzi
w `mowa.js`, a po `WZNOWIEN_ZANIM_PRZYCISK = 12` wznowieniach Cosmos przechodzi na „naciśnij,
aby mówić". Nie zakładaj, że `continuous` gdziekolwiek działa.

`public/i18n.js` trzyma **dwa równoległe słowniki** (`pl`, `en`); `t()` schodzi na polski,
gdy klucza brak w wybranym języku, a na końcu zwraca sam klucz. Nowy tekst wymaga wpisu
w obu – inaczej angielski interfejs po cichu wyświetli polskie zdanie. Tłumaczenie
elementów idzie po atrybutach `data-i18n`, `data-i18n-html`, `data-i18n-ph`.

**Wygląd: kierunek „Jeden wątek”.** Aplikacja i strona produktowa to jeden świat:
te same tokeny kolorów (jasny `#F6F5F1` / ciemny `#111214`), te same czcionki
(`public/fonts/fonts.css` – jeden plik dla obu), motyw domyślnie jak w systemie. Kolor
mają tylko silniki: `--k-nvidia`, `--k-local`, `--k-claude`, `--k-openai`, a `--k-akt`
to silnik wybrany teraz (`data-silnik` na `<html>`, ustawia `setEndpoint()`). Każda
odpowiedź zapisuje `silnik` i `model` i rysuje się z paskiem („nicią”) i podpisem w jego
kolorze – nowe miejsce, które dopisuje odpowiedź do rozmowy, musi dołożyć
`...znakSilnika()`, inaczej wiadomość dostanie neutralną szarą kreskę.

**Service worker:** `public/sw.js` cache'uje statykę strategią cache-first i przy aktywacji
kasuje cache o innej nazwie niż `CACHE`. Po zmianie czegokolwiek w `STATIC_ASSETS`
**podnieś wersję** w `const CACHE = 'cosmos-vNN'` – inaczej użytkownicy z zainstalowaną PWA
dostaną starą wersję. **Nowy skrypt w `public/` to trzy miejsca naraz:** `index.html`
(tag `<script>`), `sw.js` (`STATIC_ASSETS`) i podniesiona wersja cache'a. Pominięcie
`sw.js` daje najgorszy możliwy objaw: działa u ciebie, nie działa na telefonie Marcina.

### Strona produktowa (`public/strona/`) i adres `/app`

`serveStatic()` oddaje pod `/` stronę produktową (`public/strona/index.html`), a pod
`/app` i `/app/` – aplikację (`public/index.html`). Dlatego **aplikacja ładuje swoje
pliki ścieżkami bezwzględnymi** (`/app.js`, `/style.css`, `/sw.js`) – względna ścieżka
spod `/app/` trafiłaby w `/app/app.js` i aplikacja wstałaby bez skryptów.

- Teksty strony: polskie w HTML-u (`data-t`), angielskie w słowniku `EN`
  w `strona.js`. Nowy tekst = wpis w obu; zestaw `strona-produktowa` sprawdza,
  że przełączenie na EN zmienia **każdy** tekst.
- Stary link `/#zaproszenie=…` przekierowuje skrypt w `<head>` strony – przed
  czymkolwiek innym. Nowe linki z panelu Dostęp mają już `/app#zaproszenie=…`.
- Service worker omija `/` i `/strona/` – strona ma przychodzić świeża.
- Sekcje poza pierwszym ekranem mają `content-visibility: auto` (telefon: pierwsze
  długie zadanie ~470 → ~280 ms przy CPU ×4). Skok do kotwicy działa dzięki
  `html:has(:target)`, który je wtedy włącza – nowa sekcja z animacją liczoną
  z geometrii toru (jak plener, przekrój) musi być z tego wyłączona.
- Liczby na stronie (zestawy testów) pilnuje audyt razem z README.
- Znak i ikony generuje `scripts/ikony.js` z jednego źródła. Pliki w `public/icons/`
  serwer oddaje jako niezmienne (rok w pamięci) – **nowy wygląd = nowa nazwa pliku**.
- Obrazy do README (`docs/obrazy/`) i grafiki do serwisów (`docs/grafiki/`) powstają
  skryptami, nie ręcznie: `scripts/zrzuty-readme.js` (prawdziwa aplikacja pod `/app`,
  dane testowe, strefa Europe/Warsaw) i `scripts/grafiki-marki.js` (banner, schemat,
  LinkedIn, GitHub, X; znak z `scripts/ikony.js`). Zmiana wyglądu aplikacji = ponowne
  uruchomienie obu, w tej kolejności.

### Mostek MCP (`mcp/cosmos-mcp.js`)

Osobny proces stdio, który wystawia bazę wiedzy, pamięć, zdarzenia i Studio jako narzędzia
MCP (Cursor, Claude Desktop, Claude Code). To **klient HTTP Cosmosa**, nie część serwera –
wymaga działającego `npm start` i, przy włączonym logowaniu, `COSMOS_TOKEN` równego
`COSMOS_API_TOKEN` serwera.

### Uwierzytelnianie

Tryb domowy (żadne konto nie ma hasła, brak `COSMOS_API_TOKEN`): jedna osoba, właściciel,
bez logowania. `COSMOS_PASSWORD` przy **pierwszym** starcie staje się hasłem konta
właściciela (login z `COSMOS_LOGIN`); potem hasło żyje w koncie (`lib/konta.js`, scrypt).
Sesje są na dysku jako skróty tokenów i przeżywają restart. Pusty login przy logowaniu =
właściciel. `COSMOS_API_TOKEN` działa w imieniu właściciela (mostek MCP, watcher zmysłów).
Limit: 5 pomyłek z adresu / 10 pod loginem → kwadrans przerwy; adres zza Cloudflare
z `CF-Connecting-IP`, ale tylko gdy połączenie przyszło z pętli zwrotnej. Zapomniane hasło:
`node scripts/konto.js haslo <login>` przy zatrzymanym serwerze. Przy wystawieniu
publicznie ustaw `COSMOS_COOKIE_SECURE=1`.

## Klucze i sekrety

Wszystkie klucze żyją w `.env` (gitignore). `.env.example` jest szablonem z pustymi
wartościami – **nie wpisuj tam prawdziwych kluczy**. Konfiguracja czytana jest własnym
`loadDotEnv()` w `server.js`, bez `dotenv`: zmienne środowiskowe mają pierwszeństwo przed
plikiem.

`/api/config` celowo zwraca konfigurację **bez kluczy** – sprawdź to przy dodawaniu nowych.

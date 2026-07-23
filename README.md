# ✦ COSMOS

Osobiste środowisko AI klasy premium — czysty, kosmiczny interfejs (IBM Plex) dla modeli
**NVIDIA Nemotron** i innych modeli open source. Działa **hybrydowo**: lokalnie na Twoim
GPU (np. RTX 3080) oraz przez chmurę NVIDIA — przełączasz jednym kliknięciem.

![Cosmos](docs/screenshot.png)

> ### 👉 Pierwszy raz? Zacznij tutaj:
> - **[docs/START-TUTAJ.md](docs/START-TUTAJ.md)** — instrukcja krok po kroku (instalacja
>   na komputerze i telefonie, prostym językiem).
> - **[docs/ANDROID-I-KOMPUTER.md](docs/ANDROID-I-KOMPUTER.md)** — czy komputer musi być
>   cały czas włączony? (odpowiedź + rozwiązania).
> - **[docs/VPS-SERWER-W-CHMURZE.md](docs/VPS-SERWER-W-CHMURZE.md)** — postaw Cosmosa
>   w chmurze (zawsze dostępny z telefonu i Surface), z RTX 3080 w domu na żądanie.
>
> Poniżej znajduje się dokumentacja techniczna każdego elementu.

## ✨ Funkcje

- 💬 Czat ze streamingiem odpowiedzi w czasie rzeczywistym (SSE)
- 🖼️ **Obsługa obrazów** — załącz lub wklej zdjęcie, odpowie model wizyjny (Nemotron VL i in.)
- ☁️ / 🖥️ **Tryb hybrydowy** — przełącznik Chmura NVIDIA ↔ lokalny GPU w pasku górnym
- 🛰️ Monitor statusu obu endpointów na żywo
- 🗂️ Wiele rozmów z historią, renderowanie Markdown, kopiowanie kodu
- 🔎 **Zarządzanie rozmowami**: wyszukiwarka (po tytule i treści), przypinanie, zmiana
  nazwy, eksport, regeneracja odpowiedzi, edycja własnej wiadomości, skróty klawiszowe
- 🧾 **Podsumowania rozmów**, licznik tokenów w kompozytorze, profil użytkownika
  doklejany do kontekstu każdej rozmowy
- ⚙️ Osobny wybór modelu dla chmury i dla GPU, system prompt, temperatura, limit tokenów
- 🌗 Motyw ciemny (kosmos) i jasny (sterylny), czcionki IBM Plex dołączone offline
- 🌍 **Dwa języki interfejsu — polski i angielski** (przełącznik w panelu bocznym
  i na ekranie logowania); język steruje też instrukcją systemową modelu
  i rozpoznawaniem/syntezą mowy
- 📸 **Panel kamery na żywo** z detekcją YOLO na podglądzie, zdarzeniami pozycji
  (po lewej / na środku / po prawej) i **wake-word „Hej, Kosmos"**
- 🎓 **Nauka** — uczysz Cosmosa rozpoznawania (pokaż w kamerze i nazwij),
  nagrywasz **procedury** (czynności krok po kroku) i planujesz je jako **rutyny**
  cykliczne; kroki wrażliwe (płatność, wysłanie) zawsze wymagają potwierdzenia.
  Opcjonalnie **automatyzacja web tylko-do-odczytu** (Playwright) wykonuje same
  bezpieczne odczyty (sprawdź cenę / saldo / status)
- 🕰️ **Digital Time Machine** (włączana w Ustawieniach) — automatyczny zapis migawek
  sceny do osi czasu, ze wskaźnikiem „REC"
- 💾 **Kopie zapasowe i statystyki** danych, **tryb offline**, uwierzytelnianie hasłem
- 🎓 **Eksport danych treningowych** (JSONL) + przykład **QLoRA** — dotrenuj własny model
  na swoich rozmowach i wepnij go z powrotem jako profil „Lokalnie" (`training/`)
- 📱 **Instalacja jako aplikacja**: Windows (PWA lub Electron + instalator .exe),
  Android (PWA), iOS/iPadOS (Safari) i macOS (Dock/PWA)

## 🚀 Szybki start (każdy system)

Wymagany tylko [Node.js ≥ 18](https://nodejs.org). Bez `npm install`, bez budowania.

```bash
git clone https://github.com/Marcin1000/Bear.git
cd Bear
cp .env.example .env    # Windows: copy .env.example .env
npm start               # otwórz http://localhost:3000
```

## 📲 Instalacja jako aplikacja

### Windows — wariant 1: PWA (najprostszy)

1. Uruchom serwer (`npm start`) i otwórz `http://localhost:3000` w **Chrome lub Edge**.
2. Kliknij ikonę **„Zainstaluj aplikację"** w pasku adresu (albo menu ⋯ → *Zainstaluj Cosmos*).
3. Cosmos pojawi się w menu Start jako osobna aplikacja z własnym oknem i ikoną.

### Windows — wariant 2: aplikacja natywna (Electron)

```bash
npm install        # jednorazowo (pobiera Electrona)
npm run desktop    # uruchamia Cosmos jako aplikację okienkową
npm run dist       # (opcjonalnie) buduje instalator .exe w katalogu dist/
```

Wariant Electron sam startuje serwer — nie musisz nic uruchamiać osobno.

### Android — PWA

1. Upewnij się, że telefon jest **w tej samej sieci Wi-Fi** co komputer z serwerem.
2. Sprawdź adres IP komputera (Windows: `ipconfig` → IPv4, np. `192.168.1.20`).
3. Na telefonie otwórz w Chrome: `http://192.168.1.20:3000`.
4. Menu ⋮ → **„Dodaj do ekranu głównego"** / **„Zainstaluj aplikację"**.

Cosmos działa wtedy jak natywna aplikacja (pełny ekran, własna ikona). Telefon łączy się
z serwerem na Twoim PC — tam jest klucz API i tam wykonuje się cała logika.

### iPhone / iPad — PWA (Safari)

Otwórz adres serwera w **Safari** → **Udostępnij** → **„Dodaj do ekranu początkowego"**.
Ikona i pasek stanu są przygotowane pod iOS.

### Mac — PWA (Safari / Chrome)

Safari (macOS Sonoma+): **Plik → Dodaj do Docka**. Chrome/Edge: ikona „Zainstaluj"
w pasku adresu. Cosmos trafia do Docka jako osobna aplikacja.

> 💡 Chcesz używać Cosmos poza domem? Wystaw serwer przez [Tailscale](https://tailscale.com)
> (darmowy VPN między Twoimi urządzeniami) — bez otwierania portów na routerze.

**Ikony aplikacji** są dołączone dla wszystkich platform: Windows/Android (192, 512,
maskable 192/512, SVG), iOS (`apple-touch-icon` 180, nieprzezroczysta), macOS Safari
(`mask-icon` do przypiętej karty) oraz 1024 px dla ekranów o wysokiej rozdzielczości.

## 🔌 Konfiguracja modeli (`.env`)

### Profil „Chmura" — NVIDIA build.nvidia.com

```ini
NVIDIA_API_KEY=nvapi-...            # klucz z build.nvidia.com (darmowa rejestracja)
NEMOTRON_BASE_URL=https://integrate.api.nvidia.com/v1
NEMOTRON_MODEL=nvidia/nemotron-nano-9b-v2   # podmień na wybrany model Nemotron
NEMOTRON_VISION_MODEL=              # model wizyjny (VL) do rozmów z obrazami
```

Dokładne identyfikatory modeli sprawdzisz w aplikacji: **Ustawienia → Pobierz listę**.

### Profil „Lokalnie" — Twój RTX 3080

Najprościej przez [Ollama](https://ollama.com) (Windows/Linux/macOS):

```bash
# po zainstalowaniu Ollama:
ollama pull nemotron-mini      # albo inny model z biblioteki Ollama
```

```ini
LOCAL_BASE_URL=http://localhost:11434/v1
LOCAL_MODEL=nemotron-mini
LOCAL_VISION_MODEL=qwen2.5vl   # lokalny model wizyjny (opcjonalnie)
```

Alternatywy dla Ollama: **vLLM** (`http://localhost:8000/v1`) albo kontener **NVIDIA NIM**.

> **Co zmieści się na RTX 3080 (10 GB)?** Modele do ~9–14 mld parametrów w kwantyzacji
> 4-bit (np. Nemotron Nano 9B, Qwen 7B/14B, Mistral 7B). Większe modele (49B+) używaj
> przez profil „Chmura".

## 🧠 Orkiestra — jeden byt, wiele zmysłów

Cosmos to nie czat + osobne narzędzia, tylko **jeden organizm**:

```
                        🖥 UI (przeglądarka / PWA / Electron)
                 mikrofon 🎤 · aparat 📷 · głos 🔊 · czat 💬
                                   │
                          ✦ COSMOS CORE (server.js)
              dyrygent: routing modeli + pamięć zdarzeń percepcji
                 │                  │                    │
        ☁ chmura NVIDIA      🖥 lokalny GPU        🐍 COSMOS SENSES (Python)
        Nemotron / VL        Ollama / vLLM         słuch  — Whisper (STT)
        (build.nvidia.com)   (RTX 3080)            głos   — Piper (TTS)
                                                   wzrok  — YOLO (detekcja)
                                                   ciało  — MediaPipe (pozy)
                                                   oczy²  — watcher.py (kamera 24/7)
```

**Jak zmysły współgrają z mózgiem:** obserwator kamery (`senses/watcher.py`) wykrywa
zmiany w otoczeniu i wysyła je do Cosmosa (`POST /api/events`). Serwer dokleja ostatnie
zdarzenia do **kontekstu każdej rozmowy** (sekcja „KONTEKST PERCEPCJI"), więc możesz
zapytać *„co się zmieniło w pokoju?"* — a Nemotron odpowie na podstawie prawdziwych
obserwacji, niezależnie od tego, czy działa lokalnie, czy w chmurze.

### 🎙️ Asystent głosowy — „Hej, Kosmos"

Kliknij ikonę fal dźwiękowych w pasku górnym — Cosmos przechodzi w tryb asystenta
głosowego (jak Asystent Google na Androidzie):

1. **Nasłuch**: orb oddycha, czekając na słowa **„Hej, Kosmos"** (możesz też od razu
   dokończyć: *„Hej, Kosmos, co mam w ręku?"*).
2. **Rozmowa**: po sygnale mówisz pytanie; odpowiedź jest czytana na głos, a Cosmos
   od razu słucha pytania uzupełniającego — rozmowa płynie bez powtarzania wake word.
   Cisza albo „koniec" wraca do nasłuchu.
3. **Wzrok**: przy pytaniach typu *„co mam w ręku?"*, *„co widzisz?"* Cosmos sam
   robi klatkę z kamery i wysyła ją do modelu wizyjnego (podgląd w rogu ekranu).
4. **Internet**: gdy pytasz np. *„jaki to telefon?"*, model może zarządzić
   wyszukiwanie — Cosmos mówi „Sprawdzam w internecie", pobiera wyniki
   (DuckDuckGo, bez klucza API) i odpowiada z podaniem źródeł.

Wymagania trybu głosowego: przeglądarka **Chrome lub Edge** (Web Speech API; działa
też w PWA na Androidzie). Rozpoznawanie wake word wymaga otwartej aplikacji.
Wyszukiwarkę można podmienić na własną (np. SearXNG): `SEARCH_URL` w `.env`.

### 📚 Baza wiedzy

Przycisk **„Baza wiedzy"** w panelu bocznym otwiera Twój prywatny magazyn materiałów
(`data/kb/` na serwerze):

- **Pliki dowolnego typu** (przycisk lub przeciągnij-upuść): dokumenty, PDF, Word,
  **Excel**, PowerPoint, grafiki, **audio i wideo**. Tekst jest wyciągany automatycznie
  (dokumenty — usługa zmysłów `/extract`; nagrania — transkrypcja Whisper; obrazy —
  opis detekcji YOLO, a przy użyciu w rozmowie trafiają do modelu wizyjnego).
- **Linki do stron** — Cosmos pobiera treść strony i indeksuje ją jak plik.
- **Notatki głosowe** — przycisk 🎙 w bazie (start/stop) albo **komendy głosowe**
  w trybie „Hej, Kosmos": powiedz *„nowa notatka"* / *„zacznij nagrywanie"*, dyktuj,
  zakończ słowami *„koniec notatki"* — transkrypcja ląduje w bazie.

**Użycie w rozmowie:** pozycje zaznaczone ☑ są **zawsze** dołączane do kontekstu
(„interesują mnie te konkretne pliki"), a z pozostałych Cosmos **sam przywołuje
pasujące fragmenty** (embeddingi bge-m3 albo słowa kluczowe, gdy zmysły są offline).
Licznik zaznaczonych pozycji widać na przycisku w panelu bocznym.

**W interfejsie:**
- 🎤 przycisk mikrofonu — dyktowanie: Whisper (lokalnie, przez Senses), a gdy usługa
  nie działa, rozpoznawanie wbudowane w Chrome/Edge,
- 🔊 przełącznik głosu (pasek górny) — odpowiedzi czytane przez Piper (naturalny polski
  głos, lokalnie), fallback: głos systemowy przeglądarki,
- 📷 przycisk aparatu — zdjęcie z kamery (webcam/Kinect RGB) prosto do rozmowy,
  analizowane przez model wizyjny,
- 🛰️ status „Zmysły" w panelu bocznym pokazuje, które zmysły są aktywne.

Instalacja zmysłów: **[senses/README.md](senses/README.md)** (każdy jest opcjonalny —
Cosmos działa też bez żadnego z nich).

### Pamięć długotrwała (RAG)

Pod każdą wiadomością jest przycisk **„✦ Zapamiętaj"** — zapisany fakt trafia do
`data/memory.json` na serwerze. Podczas rozmowy Cosmos **sam przywołuje pasujące
wpisy** (wyszukiwanie semantyczne przez embeddingi **bge-m3** z usługi zmysłów;
gdy zmysły są offline — wyszukiwanie po słowach kluczowych) i dokleja je do
kontekstu jako sekcję „PAMIĘĆ DŁUGOTRWAŁA". Wpisami zarządzasz w **Ustawieniach**.

### 🎓 Nauka — uczysz Cosmosa (przycisk „Nauka" w panelu bocznym)

Trzy zakładki, wszystkie z zasadą **człowiek w pętli** (nic nieodwracalnego nie dzieje się samo):

**1. Rozpoznawanie (przez zmysły).** Włącz kamerę, pokaż coś (klucz, gest, pozę), nazwij
i kliknij *Naucz*. Cosmos zapisuje wzorzec (etykieta + opis + miniatura + embedding) i od
tej pory **rozpoznaje to na żywo** w panelu kamery — dopisuje np. „✦ Mój klucz" do statusu
i melduje jako zdarzenie percepcji, więc możesz o tym rozmawiać. To nauka **przez przykład**,
lokalnie — nie dotrenowuje wag Nemotrona. Bez usługi zmysłów działa dopasowanie po słowach
kluczowych.

**2. Procedury (nauka czynności).** Rozpisz czynność (np. *„sprawdź rachunek za prąd"*) na
kroki: otwórz stronę, kliknij, wpisz, odczytaj, poczekaj, **potwierdź**, notatka. Kroki
oznaczone jako **wrażliwe** (płatność, wysłanie, potwierdzenie) w runnerze **zawsze** wymagają
Twojego kliknięcia — Cosmos nigdy nie zapłaci sam. Hasła i dane karty **nie są** zapisywane
w procedurze (wartość kroku możesz zostawić jako wskazówkę „z menedżera haseł"). Uruchomienie
prowadzi Cię krok po kroku (asystent z bramką), z przyciskiem otwarcia strony i kopiowaniem
wartości. Nemotron może sam zaproponować uruchomienie: *„odpal sprawdzenie rachunku"* →
`[AKCJA: procedura | nazwa]`, którą zatwierdzasz.

**3. Rutyny (cyklicznie).** Zaplanuj procedurę: codziennie / co tydzień / co miesiąc / co N
minut. O wyznaczonej porze Cosmos **przygotowuje** czynność i pyta, czy uruchomić (z bramką
na krokach wrażliwych). Licznik przy „Nauce" pokazuje, ile rutyn czeka.

**Automatyzacja web tylko-do-odczytu (opcjonalny moduł Playwright).** Dla procedur
zawierających wyłącznie kroki nie zmieniające stanu (otwórz / poczekaj / odczytaj /
nawigacja) pojawia się przycisk **„⚡ Uruchom auto (tylko odczyt)"** — Cosmos sam otwiera
stronę w prawdziwej przeglądarce i zwraca odczytane wartości (np. saldo z publicznej strony,
cena, status), a wynik trafia do kontekstu rozmowy. Rutyna z **trybem auto** zrobi to sama
o wyznaczonej porze i przyśle powiadomienie. **Twarda bramka:** jeśli procedura ma choć jeden
krok wrażliwy lub zmieniający stan (wpisywanie danych, potwierdzenie, płatność), moduł
odmawia i odsyła do ręcznego runnera z potwierdzeniem. Włączenie: `npm install playwright`
(szczegóły: **[automation/README.md](automation/README.md)**).

**Logowanie z menedżera haseł.** Aby auto‑odczyt działał też za logowaniem, krok możesz
oznaczyć jako **„logowanie"** i podać hasło jako odwołanie `{{secret:nazwa}}` — Cosmos
pobierze je z Twojego menedżera (Bitwarden / 1Password / pass / KeePassXC / zmienne
środowiskowe / własne polecenie) **w chwili uruchomienia**. Hasło **nigdy** nie trafia do
procedury, plików ani przeglądarki‑klienta; leci do runnera przez potok. Konfiguracja:
`SECRETS_PROVIDER` w `.env`. Logowanie jest dozwolone w trybie auto — ale każdy krok
płatności/wysłania/potwierdzenia i tak wraca do ręcznego runnera z bramką.

> **Bezpieczeństwo pieniędzy:** żadna rutyna nie wykonuje płatności automatycznie. Tryb auto
> obsługuje odczyt (i ewentualnie logowanie); kroki zmieniające stan zawsze wymagają Twojego
> potwierdzenia.

### 🎓 Trening własnego modelu (fine-tuning)

„Nauka" uczy **Cosmosa** (pamięć/umiejętności) — nie zmienia wag modelu. Jeśli chcesz
**wpisać** swój styl/domenę w wagi, możesz dotrenować własny model:

1. **Ustawienia → Dane treningowe → „Eksport JSONL (chat)"** — Twoje rozmowy jako zbiór
   treningowy (jedna rozmowa na linię; dostępny też format „instrukcje").
2. **`training/`** — gotowy skrypt **QLoRA** (Unsloth, pod jedno GPU jak RTX 3080) i przewodnik.
3. Po treningu wpinasz model z powrotem jako profil **„Lokalnie"** (przez Ollama/GGUF) —
   rozmawiasz z własnym modelem w tym samym UI. **Pętla:** używaj → zbierz dane → dotrenuj → wepnij.

Szczegóły, wybór modelu bazowego (Qwen/Llama/Nemotron) i wymagania sprzętowe:
**[training/README.md](training/README.md)**.

### Zmysł głębi — Kinect 360

`python senses/kinect_watcher.py` — czyta mapę głębi (libfreenect) i melduje:
obecność w zasięgu, ruch, dystans najbliższego obiektu. Działa równolegle
z `watcher.py` (Kinect RGB = zwykła kamera dla YOLO). Szczegóły: `senses/README.md`.

### Fotogrametria — Cosmos PhotoScan

`python senses/photoscan.py <folder-ze-zdjęciami>` — copilot ocenia zestaw
(liczba ujęć, ostrość, ekspozycja) i radzi po polsku, co poprawić, a gdy
zainstalowany jest **COLMAP** (CUDA na RTX 3080), buduje model 3D automatycznie
(`--dense` = gęsta chmura punktów `.ply` do Blendera/MeshLaba). Wynik skanu
trafia do Cosmosa jako zdarzenie.

### 🎨 Studio i silniki komercyjne (Twoje klucze API)

Po wpisaniu kluczy w `.env` Cosmos zyskuje dodatkowe moce (płacisz tylko za to,
czego użyjesz — środkami ze swoich kont):

- **OpenAI** (`OPENAI_API_KEY`) — nowa zakładka czatu **OpenAI** obok Chmura/Lokalnie
  oraz **generowanie obrazów** w Studiu (gpt-image-1). W rozmowie wystarczy poprosić:
  *„wygeneruj grafikę…"* — model użyje narzędzia `[OBRAZ:]` i obraz pojawi się w czacie.
- **Claude** (`ANTHROPIC_API_KEY`) — zakładka czatu **Claude** (przez warstwę
  zgodności Anthropic z API OpenAI). Świetny do pracy nad kodem.
- **ElevenLabs** (`ELEVENLABS_API_KEY`) — **Studio → Dźwięk**: naturalny lektor
  z dowolnego tekstu (mp3).
- **Seedance** (`SEEDANCE_API_KEY`) — **Studio → Wideo**: generowanie klipów
  z promptu, także **z wygenerowaną wcześniej grafiką jako pierwszą klatką**
  (wybierasz obraz z bazy wiedzy). Zadania są asynchroniczne — Cosmos sam
  odpytuje o status i pobiera gotowy plik.

**Wszystko spina baza wiedzy:** każdy wygenerowany obraz, dźwięk i wideo trafia
do niej automatycznie (z promptem jako opisem), więc możesz się do nich odnosić
w rozmowie i używać ich w kolejnych krokach (obraz z OpenAI → wideo w Seedance).

**Studio to więcej niż jeden przycisk „generuj":**
- **Warianty** — jednym poleceniem stwórz 1 / 2 / 4 wersje tego samego promptu.
- **Szablony promptów** — gotowe style (np. fotorealizm, plakat, ikona) doklejane
  do Twojego opisu jednym kliknięciem.
- **Storyboard** — rozpisz scenę na kadry i wygeneruj je seryjnie (przydatne przed
  klipem w Seedance).
- **Edycja / inpainting** — zamaluj fragment obrazu na płótnie i podmień tylko go.
- **Upscale** — powiększanie i wyostrzanie (Real-ESRGAN przez usługę zmysłów).
- **Galeria** — wszystkie wygenerowane materiały w jednym miejscu, z podglądem
  i ponownym użyciem w rozmowie lub jako pierwsza/ostatnia klatka wideo.

### 🎬 Adobe: Firefly + Creative Cloud

**Adobe Firefly** działa w Studiu jako drugi silnik obrazów (obok OpenAI —
wybierasz z listy przy generowaniu). Jak zdobyć dane dostępowe:

1. Wejdź na [developer.adobe.com/console](https://developer.adobe.com/console)
   i zaloguj się kontem Adobe.
2. *Create new project → Add API → Firefly Services → OAuth Server-to-Server*.
3. Skopiuj **Client ID** i **Client Secret** do `.env`
   (`FIREFLY_CLIENT_ID`, `FIREFLY_CLIENT_SECRET`).

Cosmos sam pobiera i odświeża token Adobe IMS. Uwaga: dostęp do Firefly API
bywa rozliczany osobno od subskrypcji Creative Cloud (kredyty generatywne /
plan Firefly Services) — sprawdź warunki w konsoli developerskiej.

**Aplikacje Creative Cloud (Premiere, Photoshop…):** ustaw `STUDIO_EXPORT_DIR`
w `.env` na folder swojego projektu (np. `C:\Projekty\Premiere\assets`) — każdy
plik ze Studia zapisze się tam automatycznie; w Premiere podpinasz folder
w Media Browser. (Adobe nie udostępnia publicznego API do zdalnego sterowania
aplikacjami desktopowymi, więc most działa przez pliki — standardowy,
niezawodny workflow.)

### 🖱️ Cursor (i inne narzędzia MCP)

Cosmos wystawia mostek **MCP** (`mcp/cosmos-mcp.js`) — agent w Cursorze może
przeszukiwać Twoją bazę wiedzy, czytać pamięć i zdarzenia percepcji, dopisywać
notatki i generować obrazy przez Studio. W Cursorze: *Settings → MCP → Add server*:

```json
{
  "mcpServers": {
    "cosmos": {
      "command": "node",
      "args": ["C:/sciezka/do/Bear/mcp/cosmos-mcp.js"],
      "env": { "COSMOS_URL": "http://localhost:3000" }
    }
  }
}
```

Ten sam wpis działa w Claude Desktop i Claude Code. Cosmos musi być uruchomiony.

### Pozostałe elementy orkiestry

| Zadanie | Narzędzie | Jak podłączyć |
|---|---|---|
| Widzenie (opis obrazu) | Nemotron VL (chmura) lub **Qwen2.5-VL** (Ollama) | `NEMOTRON_VISION_MODEL` / `LOCAL_VISION_MODEL` w `.env` |

## 🏗️ API serwera

| Endpoint | Metoda | Opis |
|---|---|---|
| `/api/chat` | POST | Rozmowa (tekst + obrazy) + kontekst percepcji i pamięci, strumień SSE |
| `/api/models?endpoint=` | GET | Lista modeli danego endpointu |
| `/api/status` | GET | Dostępność chmury, lokalnego GPU i zmysłów |
| `/api/config` | GET | Konfiguracja serwera (bez kluczy) |
| `/api/events` | POST/GET | Zdarzenia percepcji (od watcherów/czujników) |
| `/api/memory` | POST/GET/DELETE | Pamięć długotrwała (zapis, lista, usuwanie) |
| `/api/stt` `/api/tts` `/api/detect` `/api/pose` | POST | Proxy do zmysłów (Whisper/Piper/YOLO/MediaPipe) |
| `/api/lessons` `/api/lessons/match` | GET/POST/DELETE | Nauka: wzorce rozpoznawania i dopasowanie |
| `/api/procedures` | GET/POST/PUT/DELETE | Nauka: procedury (czynności krok po kroku) |
| `/api/routines` `/api/routines/due` | GET/POST/PUT/DELETE | Nauka: rutyny (harmonogram) i zadania do wykonania |
| `/api/automation/status` `/api/procedures/run-readonly` | GET / POST | Nauka: automatyzacja web tylko-do-odczytu (Playwright) |
| `/api/train/dataset?format=` `/api/train/stats` | GET | Eksport danych treningowych (JSONL: chat/instrukcje) i licznik przykładów |

## 💰 Koszty

- **Lokalnie (RTX 3080):** 0 zł za tokeny — płacisz tylko za prąd (~0,3–0,5 zł za godzinę
  intensywnego generowania).
- **Chmura NVIDIA (build.nvidia.com):** rejestracja darmowa, konto deweloperskie dostaje
  pulę darmowych zapytań; przy większym użyciu obowiązuje cennik NVIDIA. Do prototypowania
  zwykle wystarcza pula darmowa.
- **Aplikacja Cosmos:** open source, bez opłat; czcionki IBM Plex na licencji OFL.

## 🛠️ Rozwiązywanie problemów

| Problem | Rozwiązanie |
|---|---|
| „Brak klucza API dla chmury NVIDIA" | Uzupełnij `NVIDIA_API_KEY` w `.env` i zrestartuj serwer |
| „Nie udało się połączyć z lokalnym modelem" | Uruchom Ollama/vLLM; sprawdź `LOCAL_BASE_URL` |
| Lokalny status „offline" | Ollama nie działa lub inny port — `ollama serve` i sprawdź `.env` |
| Błąd 404 przy czacie | Zły identyfikator modelu — **Ustawienia → Pobierz listę** |
| Obraz bez odpowiedzi „wizyjnej" | Ustaw `NEMOTRON_VISION_MODEL` / `LOCAL_VISION_MODEL` na model VL |
| Telefon nie łączy się z serwerem | Ta sama sieć Wi-Fi + zapora Windows: zezwól Node.js na sieć prywatną |

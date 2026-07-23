# ✦ COSMOS

Osobiste środowisko AI klasy premium — czysty, kosmiczny interfejs (IBM Plex) dla modeli
**NVIDIA Nemotron** i innych modeli open source. Działa **hybrydowo**: lokalnie na Twoim
GPU (np. RTX 3080) oraz przez chmurę NVIDIA — przełączasz jednym kliknięciem.

![Cosmos](docs/screenshot.png)

## ✨ Funkcje

- 💬 Czat ze streamingiem odpowiedzi w czasie rzeczywistym (SSE)
- 🖼️ **Obsługa obrazów** — załącz lub wklej zdjęcie, odpowie model wizyjny (Nemotron VL i in.)
- ☁️ / 🖥️ **Tryb hybrydowy** — przełącznik Chmura NVIDIA ↔ lokalny GPU w pasku górnym
- 🛰️ Monitor statusu obu endpointów na żywo
- 🗂️ Wiele rozmów z historią, renderowanie Markdown, kopiowanie kodu
- ⚙️ Osobny wybór modelu dla chmury i dla GPU, system prompt, temperatura, limit tokenów
- 🌗 Motyw ciemny (kosmos) i jasny (sterylny), czcionki IBM Plex dołączone offline
- 📱 **Instalacja jako aplikacja**: Windows (PWA lub Electron + instalator .exe) i Android (PWA)

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

> 💡 Chcesz używać Cosmos poza domem? Wystaw serwer przez [Tailscale](https://tailscale.com)
> (darmowy VPN między Twoimi urządzeniami) — bez otwierania portów na routerze.

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

### Pozostałe elementy orkiestry

| Zadanie | Narzędzie | Jak podłączyć |
|---|---|---|
| Widzenie (opis obrazu) | Nemotron VL (chmura) lub **Qwen2.5-VL** (Ollama) | `NEMOTRON_VISION_MODEL` / `LOCAL_VISION_MODEL` w `.env` |
| Pamięć długoterminowa (RAG) | **bge-m3** | planowany moduł `senses/memory` |
| Fotogrametria | **COLMAP**, Meshroom | zdjęcia z Canona/Mavica → model 3D (workflow w docs) |

## 🏗️ API serwera

| Endpoint | Metoda | Opis |
|---|---|---|
| `/api/chat` | POST | Rozmowa (tekst + obrazy) + kontekst percepcji, strumień SSE |
| `/api/models?endpoint=` | GET | Lista modeli danego endpointu |
| `/api/status` | GET | Dostępność chmury, lokalnego GPU i zmysłów |
| `/api/config` | GET | Konfiguracja serwera (bez kluczy) |
| `/api/events` | POST/GET | Zdarzenia percepcji (od watchera/czujników) |
| `/api/stt` `/api/tts` `/api/detect` `/api/pose` | POST | Proxy do zmysłów (Whisper/Piper/YOLO/MediaPipe) |

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

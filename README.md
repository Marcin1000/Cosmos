# 🐻 Bear Chat — interfejs czatu dla NVIDIA Nemotron

Kompletne środowisko czatu z UI/UX w stylu ChatGPT / Claude, gotowe do podłączenia
modeli **NVIDIA Nemotron** (w tym Nemotron 3) przez dowolny endpoint zgodny
z API OpenAI — chmurowy lub lokalny.

**Zero zależności** — wystarczy Node.js ≥ 18. Bez `npm install`, bez budowania.

![Bear Chat](docs/screenshot.png)

## ✨ Funkcje

- 💬 Czat ze streamingiem odpowiedzi w czasie rzeczywistym (SSE)
- 🗂️ Wiele rozmów z historią zapisywaną w przeglądarce (localStorage)
- 📝 Renderowanie Markdown: bloki kodu z przyciskiem „Kopiuj”, tabele, listy, cytaty
- ⚙️ Panel ustawień: model, instrukcja systemowa, temperatura, limit tokenów
- 📋 Pobieranie listy dostępnych modeli bezpośrednio z endpointu
- 🌗 Motyw ciemny i jasny
- ⏹️ Zatrzymywanie generowania w trakcie
- 📱 Responsywny układ (desktop i mobile)

## 🚀 Szybki start

### 1. Sklonuj repozytorium

```bash
git clone https://github.com/marcin1000/bear.git
cd bear
```

### 2. Skonfiguruj połączenie z modelem

```bash
cp .env.example .env
```

Otwórz `.env` i uzupełnij wartości (szczegóły niżej).

### 3. Uruchom

```bash
npm start        # lub: node server.js
```

Otwórz **http://localhost:3000** w przeglądarce. Gotowe! 🎉

## 🔌 Podłączenie NVIDIA Nemotron

Serwer rozmawia z modelem przez standardowe API `POST /v1/chat/completions`
(format OpenAI), więc działa z każdym z poniższych wariantów.

### Wariant A — chmura NVIDIA (najprostszy, bez GPU)

1. Wejdź na **[build.nvidia.com](https://build.nvidia.com)** i załóż darmowe konto.
2. Wyszukaj model z rodziny **Nemotron** (np. Nemotron 3) i kliknij **Get API Key**.
3. W pliku `.env` ustaw:

```ini
NVIDIA_API_KEY=nvapi-...twój-klucz...
NEMOTRON_BASE_URL=https://integrate.api.nvidia.com/v1
NEMOTRON_MODEL=nvidia/nemotron-nano-9b-v2   # podmień na wybrany model
```

> 💡 Nie znasz dokładnego identyfikatora modelu? Uruchom aplikację, otwórz
> **Ustawienia → Pobierz listę** — zobaczysz wszystkie modele dostępne na Twoim
> kluczu i wybierzesz Nemotrona 3 z listy.

### Wariant B — lokalnie przez vLLM (własne GPU)

```bash
pip install vllm
vllm serve <model-nemotron-z-huggingface> --port 8000
```

W `.env`:

```ini
NEMOTRON_BASE_URL=http://localhost:8000/v1
NEMOTRON_MODEL=<model-nemotron-z-huggingface>
NVIDIA_API_KEY=
```

### Wariant C — lokalnie przez Ollama

```bash
ollama pull nemotron    # lub inny wariant nemotron-* z biblioteki Ollama
```

W `.env`:

```ini
NEMOTRON_BASE_URL=http://localhost:11434/v1
NEMOTRON_MODEL=nemotron
NVIDIA_API_KEY=
```

### Wariant D — kontener NVIDIA NIM (produkcyjnie, własna infrastruktura)

Uruchom kontener NIM z wybranym modelem Nemotron zgodnie z instrukcją na
[build.nvidia.com](https://build.nvidia.com) (zakładka „Deploy" przy modelu), a następnie:

```ini
NEMOTRON_BASE_URL=http://localhost:8000/v1
NEMOTRON_MODEL=<nazwa-modelu-w-nim>
```

## 🏗️ Architektura

```
przeglądarka (public/)                serwer (server.js)              model
┌────────────────────┐   POST /api/chat   ┌──────────────┐   /v1/chat/completions
│  index.html        │ ─────────────────▶ │  proxy + SSE │ ─────────────────────▶
│  app.js  style.css │ ◀───── stream ──── │  klucz API   │ ◀──── stream ────────
└────────────────────┘                    └──────────────┘   (NVIDIA / vLLM / …)
```

- **`server.js`** — serwer HTTP bez zależności: serwuje frontend, trzyma klucz API
  po stronie serwera (nigdy nie trafia do przeglądarki) i przekazuje strumień
  odpowiedzi 1:1 do UI.
- **`public/`** — frontend w czystym HTML/CSS/JS, bez frameworków i bez etapu
  budowania.

### Endpointy API

| Endpoint | Metoda | Opis |
|---|---|---|
| `/api/chat` | POST | Wysyła rozmowę do modelu, zwraca strumień SSE |
| `/api/models` | GET | Lista modeli dostępnych na endpointzie |
| `/api/config` | GET | Aktualna konfiguracja (bez klucza API) |

## ⚙️ Konfiguracja (`.env`)

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PORT` | `3000` | Port interfejsu |
| `NVIDIA_API_KEY` | — | Klucz API (dla chmury NVIDIA, `nvapi-...`) |
| `NEMOTRON_BASE_URL` | `https://integrate.api.nvidia.com/v1` | Endpoint zgodny z API OpenAI |
| `NEMOTRON_MODEL` | `nvidia/nemotron-nano-9b-v2` | Domyślny identyfikator modelu |

## 🛠️ Rozwiązywanie problemów

| Problem | Rozwiązanie |
|---|---|
| „Brak klucza API" | Skopiuj `.env.example` do `.env`, wklej klucz z build.nvidia.com i zrestartuj serwer |
| Błąd HTTP 401/403 | Klucz jest nieprawidłowy lub wygasł — wygeneruj nowy |
| Błąd HTTP 404 przy czacie | Zły identyfikator modelu — sprawdź go przez **Ustawienia → Pobierz listę** |
| „Nie udało się połączyć…" | Sprawdź, czy lokalny serwer modelu (vLLM/Ollama/NIM) działa i czy `NEMOTRON_BASE_URL` jest poprawny |
| Odpowiedzi ucinane | Zwiększ „Maks. tokenów odpowiedzi" w Ustawieniach |

# 🚀 Cosmos — instrukcja krok po kroku (zacznij tutaj)

Ten plik prowadzi Cię od zera do działającego Cosmosa — na komputerze i na telefonie.
Rób punkty po kolei. Nie musisz znać się na programowaniu; wszystko jest opisane
dokładnie, słowo po słowie.

> **Ile to zajmie?** Podstawowe uruchomienie (czat) — około 15 minut.
> Pełna wersja z głosem, wzrokiem i aplikacją na telefonie — około godziny.

---

## Co będziesz miał na końcu

- Własnego asystenta AI (jak ChatGPT) działającego na Twoim komputerze.
- Ten sam asystent na telefonie z Androidem, ze wspólną historią rozmów.
- Przełącznik: model lokalny (Twoja karta RTX 3080) albo chmura NVIDIA.
- Opcjonalnie: rozmowę głosem, „widzenie" przez kamerę, generowanie grafik,
  dźwięku i wideo, oraz bazę wiedzy na Twoje pliki.

---

## Zanim zaczniesz — jedna ważna rzecz

Cosmos składa się z **serwera** (działa na Twoim komputerze stacjonarnym) i
**aplikacji** (otwierasz ją w przeglądarce lub na telefonie). Aplikacja na telefonie
łączy się z serwerem na komputerze.

**To znaczy, że gdy komputer jest wyłączony, telefon nie ma się z czym połączyć.**
Szczegółowe wyjaśnienie i rozwiązania znajdziesz w pliku
**[ANDROID-I-KOMPUTER.md](ANDROID-I-KOMPUTER.md)** — przeczytaj go, bo to ważne dla
tego, jak będziesz używać Cosmosa na co dzień.

---

# CZĘŚĆ 1 — Podstawy (czat na komputerze)

## KROK 1 — Zainstaluj Node.js

Node.js to program, który uruchamia serwer Cosmosa.

1. Wejdź na **https://nodejs.org**
2. Kliknij duży zielony przycisk z napisem **„LTS"** (wersja zalecana).
3. Uruchom pobrany plik i klikaj **Dalej / Next** aż do końca (nic nie zmieniaj).
4. Sprawdź, czy się udało: naciśnij `Windows + R`, wpisz `cmd`, naciśnij Enter.
   W czarnym oknie wpisz:
   ```
   node --version
   ```
   Jeśli pokaże się coś w stylu `v22.14.0` — gotowe. (Musi być 18 lub wyżej.)

## KROK 2 — Pobierz Cosmos

**Najprościej (bez instalowania Gita):**
1. Wejdź na stronę repozytorium na GitHubie.
2. Kliknij zielony przycisk **„Code" → „Download ZIP"**.
3. Rozpakuj ZIP np. do `C:\Cosmos`.

**Albo przez Git** (jeśli masz zainstalowany):
```
git clone <adres-repozytorium> C:\Cosmos
```

Od teraz zakładam, że Cosmos jest w folderze `C:\Cosmos`.

## KROK 3 — Wpisz swoje klucze API

1. W folderze `C:\Cosmos` znajdź plik **`.env.example`**.
2. Skopiuj go i zmień nazwę kopii na **`.env`** (sama kropka i słowo env, bez nic więcej).
   - *Podpowiedź:* w oknie `cmd` w folderze Cosmosa możesz wpisać: `copy .env.example .env`
3. Otwórz `.env` Notatnikiem i uzupełnij to, czego chcesz używać. **Nic nie jest
   obowiązkowe poza jednym silnikiem AI.** Zacznij od chmury NVIDIA — jest darmowa
   na start:

   **Chmura NVIDIA (zalecane na początek):**
   - Wejdź na **https://build.nvidia.com**, załóż darmowe konto.
   - Wybierz model Nemotron, kliknij **„Get API Key"**, skopiuj klucz (zaczyna się od `nvapi-`).
   - W `.env` wpisz go po znaku `=`:
     ```
     NVIDIA_API_KEY=nvapi-tutaj-twój-klucz
     ```

   **Pozostałe klucze (opcjonalnie, gdy chcesz):**
   | Chcesz... | Wpisz w `.env` | Klucz zdobędziesz na |
   |---|---|---|
   | Czat na GPT + grafiki | `OPENAI_API_KEY=` | platform.openai.com |
   | Czat na Claude | `ANTHROPIC_API_KEY=` | console.anthropic.com |
   | Głos (lektor) | `ELEVENLABS_API_KEY=` | elevenlabs.io |
   | Wideo | `SEEDANCE_API_KEY=` i `SEEDANCE_MODEL=` | konsola BytePlus |
   | Grafiki Adobe | `FIREFLY_CLIENT_ID=` i `FIREFLY_CLIENT_SECRET=` | developer.adobe.com/console |

4. Zapisz plik (`Ctrl+S`) i zamknij.

> 🔒 **Bezpieczeństwo:** plik `.env` z Twoimi kluczami zostaje tylko na Twoim
> komputerze. Nigdy nie trafia do internetu ani na GitHub.

## KROK 4 — Uruchom Cosmos po raz pierwszy

1. Otwórz folder `C:\Cosmos` w oknie `cmd`:
   - Wejdź do folderu w Eksploratorze plików, kliknij pasek adresu, wpisz `cmd`, Enter.
2. Wpisz:
   ```
   npm start
   ```
3. Zobaczysz kilka linijek zaczynających się od `✦ Cosmos`. To znaczy, że działa.
4. Otwórz przeglądarkę (Chrome lub Edge) i wejdź na:
   ```
   http://localhost:3000
   ```
5. Powinieneś zobaczyć Cosmos. Napisz coś w polu na dole i naciśnij Enter. 🎉

> Aby zatrzymać serwer: w oknie `cmd` naciśnij `Ctrl + C`.
> Aby uruchomić ponownie: znów `npm start`.

---

# CZĘŚĆ 2 — Aplikacja na Windows

Masz dwie możliwości. **Wariant A jest prostszy — zacznij od niego.**

## Wariant A — jako aplikacja z przeglądarki (PWA)

1. Uruchom serwer (`npm start`) i otwórz `http://localhost:3000` w Chrome lub Edge.
2. Po prawej stronie paska adresu zobaczysz małą ikonę **„Zainstaluj"**
   (albo: menu ⋮ → *„Zainstaluj Cosmos…"*).
3. Kliknij ją. Cosmos pojawi się w menu Start jako osobna aplikacja z własną ikoną.

## Wariant B — prawdziwa aplikacja (Electron, z instalatorem)

W oknie `cmd` w folderze Cosmosa:
```
npm install
npm run desktop
```
Cosmos otworzy się we własnym oknie i **sam uruchomi serwer** — nie musisz osobno
wpisywać `npm start`.

Aby zbudować instalator `.exe` (do zainstalowania jak zwykłego programu):
```
npm run dist
```
Gotowy instalator znajdziesz w folderze `dist`.

---

# CZĘŚĆ 3 — Aplikacja na Androidzie

> ⚠️ **Najpierw przeczytaj [ANDROID-I-KOMPUTER.md](ANDROID-I-KOMPUTER.md)** — wyjaśnia,
> kiedy telefon zadziała, a kiedy nie (bo komputer musi być włączony).

Najkrótsza droga (gdy telefon i komputer są w tej samej sieci Wi-Fi):

1. Na komputerze sprawdź jego adres w sieci: w `cmd` wpisz `ipconfig`, znajdź
   **„Adres IPv4"** — coś jak `192.168.1.20`.
2. Uruchom serwer na komputerze (`npm start`).
3. Na telefonie otwórz w Chrome adres: `http://192.168.1.20:3000`
   (wpisz swój adres z punktu 1).
4. Menu ⋮ → **„Dodaj do ekranu głównego"**. Cosmos pojawi się jak zwykła aplikacja.

Żeby działało też poza domem — patrz [ANDROID-I-KOMPUTER.md](ANDROID-I-KOMPUTER.md)
(sekcja o Tailscale).

---

# CZĘŚĆ 3b — Aplikacja na iPhone / iPad (iOS, iPadOS)

1. Na iPhonie/iPadzie otwórz Cosmosa w przeglądarce **Safari** (nie Chrome — na iOS
   tylko Safari potrafi instalować aplikacje). Adres jak przy Androidzie:
   `http://ADRES-KOMPUTERA:3000` (ta sama sieć Wi-Fi), albo adres z Tailscale.
2. Dotknij ikony **Udostępnij** (kwadrat ze strzałką w górę).
3. Wybierz **„Dodaj do ekranu początkowego"**.
4. Cosmos pojawi się na ekranie z własną ikoną i będzie działał pełnoekranowo,
   jak natywna aplikacja.

> Ikona i pasek stanu są już przygotowane pod iOS — nie musisz nic ustawiać.

---

# CZĘŚĆ 3c — Aplikacja na Mac (macOS)

Na Macu z przeglądarką **Safari** (wersja z macOS Sonoma lub nowszą):
1. Otwórz Cosmosa: `http://localhost:3000` (jeśli serwer jest na tym Macu) albo
   adres komputera/serwera w sieci.
2. W menu górnym: **Plik → Dodaj do Docka** (lub przycisk **Udostępnij → Dodaj do Docka**).
3. Cosmos pojawi się w Docku jako osobna aplikacja z własnym oknem i ikoną.

W przeglądarce **Chrome/Edge** na Macu działa też zwykła instalacja PWA
(ikona „Zainstaluj" w pasku adresu) — tak samo jak na Windows.

---

# CZĘŚĆ 4 — Zmysły: głos, wzrok, pamięć (opcjonalnie)

To dodatkowa usługa w Pythonie. Bez niej Cosmos działa (czat, obrazy), ale nie ma
lokalnego rozpoznawania mowy, naturalnego głosu ani analizy obrazu na Twoim GPU.

## KROK 1 — Zainstaluj Pythona
1. Wejdź na **https://python.org/downloads**, pobierz najnowszą wersję.
2. **WAŻNE:** podczas instalacji zaznacz na dole okna
   **„Add Python to PATH"**, dopiero potem klikaj instaluj.

## KROK 2 — Zainstaluj zmysły
W oknie `cmd`:
```
cd C:\Cosmos\senses
python -m venv .venv
.venv\Scripts\activate
pip install fastapi uvicorn python-multipart
```
Teraz dołóż zmysły, których chcesz (każdy osobno, można pominąć niepotrzebne):
```
pip install faster-whisper        (słuch — rozpoznawanie mowy)
pip install ultralytics opencv-python   (wzrok — rozpoznawanie obiektów)
pip install sentence-transformers  (pamięć — inteligentne wyszukiwanie)
pip install pypdf python-docx openpyxl python-pptx   (czytanie dokumentów do bazy wiedzy)
```

## KROK 3 — Uruchom zmysły
```
python service.py
```
Zostaw to okno otwarte. W Cosmosie w panelu bocznym „Zmysły" zaświeci się na zielono.

> Pełne szczegóły (głos Piper, kamera 24/7, Kinect): **[../senses/README.md](../senses/README.md)**

---

# CZĘŚĆ 5 — Cursor (opcjonalnie)

Aby Twój edytor kodu Cursor widział bazę wiedzy i pamięć Cosmosa:

1. W Cursorze: *Settings → MCP → Add server*.
2. Wklej (podmieniając ścieżkę na swoją):
   ```json
   {
     "mcpServers": {
       "cosmos": {
         "command": "node",
         "args": ["C:/Cosmos/mcp/cosmos-mcp.js"],
         "env": { "COSMOS_URL": "http://localhost:3000" }
       }
     }
   }
   ```
3. Cosmos musi być uruchomiony (`npm start`).

---

# Codzienne używanie — najkrótsza ścieżka

1. Włącz komputer.
2. Uruchom Cosmos (`npm start` w folderze, albo aplikacja Electron sama startuje serwer).
3. (Opcjonalnie) w drugim oknie uruchom zmysły: `python service.py` w folderze `senses`.
4. Otwórz aplikację Cosmos na komputerze lub telefonie.

> 💡 Chcesz, żeby serwer startował sam po włączeniu komputera? Patrz
> [ANDROID-I-KOMPUTER.md](ANDROID-I-KOMPUTER.md) — sekcja „Automatyczny start".

---

# Co możesz robić w Cosmosie (przegląd)

Gdy już działa, masz do dyspozycji dużo więcej niż sam czat:

- **Rozmowy pod kontrolą** — wyszukiwarka rozmów (po tytule i treści), przypinanie
  ważnych, zmiana nazwy, eksport, regeneracja odpowiedzi i edycja własnej wiadomości.
- **Pamięć i wiedza** — przycisk „✦ Zapamiętaj" pod wiadomością, profil użytkownika
  (Ustawienia) doklejany do każdej rozmowy, podsumowania rozmów, licznik tokenów.
- **Baza wiedzy** — wrzucaj pliki, linki i notatki głosowe; zaznaczone pozycje
  Cosmos dokłada do kontekstu, z reszty sam przywołuje pasujące fragmenty.
- **Studio** — generowanie obrazów (OpenAI / Adobe Firefly) z wariantami, szablonami,
  storyboardem, edycją/inpaintingiem i upscalem; dźwięk (ElevenLabs); wideo (Seedance,
  także z pierwszej i ostatniej klatki). Wszystko ląduje w Galerii i bazie wiedzy.
- **Kamera na żywo** — panel z detekcją obiektów i trybem głosowym „Hej, Kosmos".
- **Nauka** (przycisk w panelu bocznym) — naucz Cosmosa rozpoznawania (pokaż w kamerze
  i nazwij), nagraj **procedury** (czynności krok po kroku, np. sprawdzenie rachunku)
  i zaplanuj je jako **rutyny** cykliczne. Kroki wrażliwe (płatność, wysłanie) zawsze
  wymagają Twojego potwierdzenia — Cosmos nigdy nie płaci sam.
- **Digital Time Machine** — włącz w Ustawieniach, a Cosmos zapisuje migawki sceny
  do osi czasu (wskaźnik „REC"); wyłączona domyślnie dla prywatności.
- **Kopie zapasowe, statystyki i tryb offline** — w Ustawieniach.

> Pełny opis każdej funkcji: **[../README.md](../README.md)**.

---

# Gdy coś nie działa

| Objaw | Co zrobić |
|---|---|
| `node` nie jest rozpoznawany | Zainstaluj Node.js (Krok 1) i uruchom `cmd` na nowo |
| „Brak klucza API dla chmury NVIDIA" | Uzupełnij `NVIDIA_API_KEY` w `.env`, zrestartuj `npm start` |
| Strona `localhost:3000` się nie otwiera | Sprawdź, czy okno `cmd` z `npm start` nadal działa |
| Telefon nie łączy się | Ten sam Wi-Fi? Dobry adres IP? Zapora Windows — zezwól Node.js na sieć prywatną |
| „Zmysły" na czerwono | Uruchom `python service.py` w folderze `senses` |
| Model wideo/obraz zwraca błąd | Sprawdź, czy klucz w `.env` jest poprawny i ma środki |
| Chcę zacząć od zera | Zatrzymaj serwer (`Ctrl+C`), usuń folder `data`, uruchom ponownie |

Nadal problem? Otwórz `README.md` w głównym folderze — jest tam pełna dokumentacja
techniczna każdego elementu.

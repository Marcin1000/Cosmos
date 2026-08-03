# ✦ Cosmos Senses — zmysły Cosmosa

Usługa percepcji w Pythonie. Daje Cosmosowi **słuch** (Whisper), **głos** (Piper),
**wzrok** (YOLO) i **pamięć semantyczną** (bge-m3). Wszystko działa lokalnie
na Twoim GPU — bez wysyłania dźwięku i obrazu do chmury.

> Ten plik to **pełna dokumentacja** zmysłów. Jeśli instalujesz Cosmosa od zera, prostszy
> przewodnik krok po kroku znajdziesz w **[../docs/START-TUTAJ.md](../docs/START-TUTAJ.md)**
> — CZĘŚĆ 5. Oba pliki opisują ten sam moduł; tutaj jest więcej szczegółów i wszystkie
> narzędzia sprzętowe.

## Co działa, a co nie — stan na dziś

Nie każdy moduł w tym folderze jest wpięty w interfejs Cosmosa. Poniższa tabela mówi
wprost, czego się spodziewać, żeby nie tracić czasu na instalowanie czegoś, co nie
zadziała na Twoim sprzęcie albo nie ma jeszcze odbiorcy po stronie aplikacji.

| Moduł / zmysł | Stan | Uwaga |
|---|---|---|
| Słuch — `/stt` (Whisper) | ✅ działa | przycisk mikrofonu w polu wiadomości |
| Głos — `/tts` (Piper) | ✅ działa | wymaga pobrania pliku głosu, patrz niżej |
| Wzrok — `/detect` (YOLO) | ✅ działa | przycisk kamery i podgląd na żywo |
| Pamięć — `/embed` (bge-m3) | ✅ działa | wyszukiwanie w bazie wiedzy |
| Dokumenty — `/extract` | ✅ działa | PDF/DOCX/XLSX/PPTX wrzucane do bazy wiedzy |
| Powiększanie — `/upscale` | ✅ działa | przycisk ⤢ w Galerii; dodatkowo `pip install realesrgan basicsr` |
| Sylwetka — `/pose` (MediaPipe) | ⚠️ endpoint działa, **nic go nie wywołuje** | dostępny przez API, ale żadna funkcja Cosmosa z niego nie korzysta |
| `watcher.py` — ciągła percepcja | ✅ działa | webcam, telefon, aparat — albo Kinect przez `CAMERA_SOURCE=kinect` |
| `wake_listener.py` — słowo aktywujące | ⚠️ niedokończony | zgłasza zdarzenie, ale nic go nie odbiera; brak polskiego słowa |
| `kinect_watcher.py` — głębia | ✅ działa | Windows przez SDK 1.8, Linux przez libfreenect |
| `kinect_win.py` — szkielet, RGB, głębia, silnik | ✅ działa | Windows; **cała funkcjonalność Kinecta 360** |
| `soundloc.py` — słuch przestrzenny | ✅ działa | macierz 4 mikrofonów Kinecta — patrz niżej |
| `photoscan.py`, `terrain.py`, `flightplan.py`, `lowlight.py`, `pantilt.py`, `tether.py` | ✅ narzędzia z wiersza poleceń | uruchamiane ręcznie, nie z interfejsu; wyniki trafiają do czatu jako zdarzenia |

Moduły oznaczone ⚠️ opisane są szczegółowo w swoich sekcjach — razem z tym,
czego dokładnie im brakuje.

**Gdzie to uruchomić?** Tam, gdzie masz kamerę, mikrofon i GPU — czyli na komputerze
domowym. Serwer Cosmosa może stać gdzie indziej (np. na VPS); wtedy w jego pliku `.env`
ustaw `SENSES_URL=http://<adres-Tailscale-komputera>:7060`. Gdy komputer jest wyłączony,
Cosmos działa dalej — po prostu bez lokalnej percepcji.

## Szybki start

```bat
cd /d C:\Cosmos\senses
python -m venv .venv
.venv\Scripts\activate
```
(Linux/macOS: `cd senses` i `source .venv/bin/activate`. Na Windowsie **nie pomijaj `/d`** —
samo `cd` nie przełącza dysku i po cichu zostawia Cię tam, gdzie byłeś.)

Dalej masz dwie drogi. **Wszystkie zmysły naraz** — najprościej, ~3 GB zależności:

```bash
pip install -r requirements.txt
```

(To pokrywa słuch, głos, wzrok, sylwetkę, pamięć, dokumenty i obserwatory. Dodatki
opisane niżej — słowo aktywujące, `/upscale`, głębia z Kinecta — mają własne komendy,
bo są rzadziej potrzebne albo wymagają czegoś spoza `pip`.)

Albo **wybiórczo**, tylko te zmysły, których chcesz (każdy jest niezależny):

```bash
pip install fastapi uvicorn python-multipart          # rdzeń — WYMAGANY
pip install faster-whisper                            # + słuch (rozpoznawanie mowy)
pip install piper-tts                                 # + głos (patrz niżej)
pip install ultralytics opencv-python                 # + wzrok (rozpoznawanie obiektów)
pip install mediapipe                                 # + sylwetka i gesty
pip install sentence-transformers                     # + pamięć (wyszukiwanie semantyczne)
pip install pypdf python-docx openpyxl python-pptx    # + czytanie dokumentów do bazy wiedzy
pip install requests numpy                            # + obserwatory (watcher, kinect, photoscan)
```

Uruchomienie:

```bash
python service.py                              # port 7060
```

Cosmos wykryje usługę automatycznie (status „Zmysły” w panelu bocznym).

## Głos Piper (polski)

```bash
pip install piper-tts
```

Potrzebne są **dwa pliki**: model `.onnx` (~60 MB) i jego opis `.onnx.json` (kilka kB).
Piper szuka opisu obok modelu, po nazwie modelu z doklejonym `.json` — dlatego
**podwójne rozszerzenie musi zostać**. Zapisany jako `pl_PL-darkman-medium.json`
(bez `.onnx` w środku) nie zostanie znaleziony.

Pobranie prosto z `cmd` (Windows 10/11 ma wbudowane `curl`):

```bat
cd /d C:\Cosmos\senses
mkdir voices
curl -L -o voices\pl_PL-darkman-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx
curl -L -o voices\pl_PL-darkman-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx.json
```

Sprawdź `dir voices` — `.onnx` ma ważyć kilkadziesiąt MB. Jeśli ma kilka kB, pobrała się
strona błędu; wejdź wtedy na https://huggingface.co/rhasspy/piper-voices/tree/main/pl/pl_PL
i pobierz pliki ręcznie. Struktura katalogów to `język / lokalizacja / głos / jakość`,
a w `pl_PL` znajdziesz też inne polskie głosy do wyboru.

Na koniec wskaż plik `.onnx` (nie folder, nie `.json`) zmienną `PIPER_VOICE`:

```bat
set PIPER_VOICE=C:\Cosmos\senses\voices\pl_PL-darkman-medium.onnx
python service.py
```

> ⚠️ `set` działa **tylko w tym oknie** — po jego zamknięciu głos znika. Aby ustawić
> na stałe: *Start → „zmienne środowiskowe" → Zmienne środowiskowe → Nowa*, nazwa
> `PIPER_VOICE`, wartość jak wyżej. Potem uruchom `service.py` w **nowym** oknie `cmd`;
> stare nie zna nowej zmiennej. (Linux/macOS: `export PIPER_VOICE=...`.)

Sukces poznasz po liście przy starcie: `→ aktywne zmysły: whisper, piper, ...`.
Zmienna musi być ustawiona **przed** startem usługi — jest sprawdzana raz, przy imporcie.

Bez Pipera Cosmos i tak mówi — używa wtedy głosu systemowego przeglądarki.

## Ciągła percepcja (obserwator kamery)

```bash
python watcher.py
```

Obserwuje kamerę, wykrywa obiekty i wysyła do Cosmosa **tylko zmiany**
(„w kadrze pojawiło się: person”). Cosmos dokleja je do kontekstu rozmowy —
możesz zapytać „co się zmieniło w pokoju?” i model odpowie na podstawie
prawdziwych obserwacji.

| Zmienna | Znaczenie |
|---|---|
| `COSMOS_URL` | adres serwera; **na VPS to nie jest `localhost`** |
| `COSMOS_TOKEN` | `COSMOS_API_TOKEN` z `.env` serwera — bez niego `/api/events` zwraca 401 |
| `CAMERA_SOURCE` | `auto` (zwykła kamera) albo `kinect` (Kinect 360 przez SDK 1.8) |
| `CAMERA_INDEX` | numer kamery przy `CAMERA_SOURCE=auto`, domyślnie `0` |
| `WATCH_INTERVAL` | sekundy między analizami, domyślnie `5` |

Obserwator działa na komputerze z kamerą, a serwer może stać gdzie indziej.
Wtedy trzeba mu podać jedno i drugie — adres i token:

```bat
set COSMOS_URL=http://100.101.102.103:3000
set COSMOS_TOKEN=twój-COSMOS_API_TOKEN
python watcher.py
```

To samo dotyczy `kinect_watcher.py`, `wake_listener.py` i pozostałych skryptów
zgłaszających zdarzenia. Bez tokena zdarzenia po cichu nie dolatują.

> ⚠️ **„Nie mogę otworzyć kamery 0" / „Camera index out of range"** — pod tym numerem
> nie ma kamery. Sprawdź, co widzi system:
> ```python
> python -c "import cv2; print([i for i in range(6) if cv2.VideoCapture(i).isOpened()])"
> ```
> Jeśli lista jest pusta, komputer nie ma żadnej kamery dostępnej dla OpenCV.
> **Masz Kinecta? Ustaw `CAMERA_SOURCE=kinect`** — nie jest kamerą UVC, więc na liście
> się nie pojawi, ale jego obraz RGB czytamy prosto z SDK (patrz sekcja o Kinekcie).
> Inne opcje: webcam, telefon jako kamera (Iriun, DroidCam), aparat przez
> *Canon EOS Webcam Utility*. Numer z listy podajesz w `CAMERA_INDEX`.

## Pamięć długotrwała (embeddingi)

```bash
pip install sentence-transformers
```

Domyślny model to **bge-m3** (~2 GB, bardzo dobre wielojęzyczne wyniki).
Lżejsza alternatywa (~120 MB): `set EMBED_MODEL=paraphrase-multilingual-MiniLM-L12-v2`.

Bez tego zmysłu pamięć w Cosmosie nadal działa — serwer ma dwa stopnie zapasowe:
najpierw **embeddingi z chmury NVIDII**, a gdy i tych nie ma (brak klucza albo
`EMBED_PROVIDER=senses`) — wyszukiwanie po słowach kluczowych. Kolejność ustawia
`EMBED_PROVIDER` w `.env` serwera; szczegóły w sekcji „Embeddingi" w
[README projektu](../README.md).

> ⚠️ Wektory z różnych modeli są nieporównywalne. Cosmos oznacza każdy wpis nazwą modelu
> i po zmianie (np. gdy raz liczyły się lokalnie, a raz w chmurze) przelicza je sam przy
> najbliższym pytaniu. Nic nie musisz robić — pierwsze zapytania bywają wolniejsze.

## Kinect 360 — wszystkie cztery czujniki

Kinect ma **kamerę RGB, czujnik głębi, cztery mikrofony i silnik pochylenia**.
Na Windowsie z zainstalowanym **Kinect for Windows SDK 1.8** działa to wszystko —
bez libfreenect, bez Zadiga, bez kompilatora.

| Czujnik | Czym się to obsługuje | Windows (SDK 1.8) | Linux (libfreenect) |
|---|---|---|---|
| Głębia — obecność, ruch, dystans | `kinect_watcher.py` | ✅ | ✅ |
| **Szkielet — 20 stawów, postawa, gesty** | `kinect_win.py skeleton` | ✅ | ❌ libfreenect tego nie ma |
| Kamera RGB dla YOLO | `watcher.py` z `CAMERA_SOURCE=kinect` | ✅ | ⚠️ wymaga mostka |
| 4 mikrofony — kierunek dźwięku | `soundloc.py` | ✅ | ✅ |
| Silnik pochylenia | `kinect_win.py tilt` | ✅ | ✅ |

### Skąd się to bierze

SDK 1.8 instaluje `Kinect10.dll` z **płaskim API w C** (funkcje `Nui*`). Moduł
`kinect_win.py` woła je przez `ctypes` — nie trzeba ani C#, ani C++. To ważne,
bo daje dostęp do **śledzenia szkieletu**, którego libfreenect nie oferuje
w ogóle: 20 stawów, z których liczymy postawę (stoi/siedzi), gesty
(ręka podniesiona, ręce rozłożone), pozycję w kadrze i odległość.

```bash
python kinect_win.py selftest     # sprawdza układ struktur i logikę, bez sprzętu
python kinect_win.py info         # czy czujnik jest widziany, jaki kąt, czy klatki idą
python kinect_win.py skeleton     # postawa i gesty na żywo
python kinect_win.py skeleton --report   # dodatkowo zgłaszaj do Cosmosa
python kinect_win.py depth        # statystyki mapy głębi
python kinect_win.py color -o kadr.png
python kinect_win.py tilt 10      # kąt pochylenia (-27..27°)
```

### Zmysł głębi w tle

```bash
python kinect_watcher.py
```

Sterownik wybiera się sam: na Windowsie SDK 1.8, na Linuksie libfreenect.
Wymusisz go zmienną `KINECT_BACKEND` (`win` albo `freenect`). Na Windowsie
skrypt dorzuca zdarzenia o sylwetce — wyłączysz je przez `KINECT_SKELETON=0`.

Wysyła do Cosmosa: obecność w zasięgu, początek i koniec ruchu, dystans
najbliższego obiektu oraz opis postawy („stoi, na wprost, 2,3 m, ręka prawa
podniesiona").

### Kinect jako kamera dla YOLO

Kinect **nie jest kamerą UVC** — OpenCV nigdy go nie zobaczy i `CAMERA_INDEX`
tu nie pomoże. Obraz RGB bierzemy z SDK:

```bat
set CAMERA_SOURCE=kinect
python watcher.py
```

To rozwiązuje typowy przypadek „komputer stacjonarny bez kamery": Kinect zastępuje
webcam, przy okazji dając 640×480 i podczerwień, która działa też po zmroku.

### Pułapka, na którą warto uważać przy własnych zmianach

SDK miesza dwie konwencje przekazywania klatek i różnicy nie widać, dopóki coś
nie sięgnie pod zły adres:

| Funkcja | Kto alokuje strukturę | Typ argumentu |
|---|---|---|
| `NuiImageStreamGetNextFrame` | **SDK** — zwraca adres swojej klatki | `NUI_IMAGE_FRAME **` |
| `NuiSkeletonGetNextFrame` | **my** — SDK tylko wypełnia | `NUI_SKELETON_FRAME *` |

Podanie pojedynczego wskaźnika tam, gdzie API chce podwójnego, kończy się tym,
że sterownik zapisuje 8 bajtów w nasz bufor, reszta zostaje wyzerowana, a przy
`ReleaseFrame` proces ginie bez śladu. Autotest pilnuje obu sygnatur.

### Zanim zadzwonisz po pomoc

- **Kinect 360 musi mieć własny zasilacz.** Sam kabel USB nie wystarcza — bez
  zasilania SDK zwraca `E_NUI_NOTPOWERED`, a dioda nie zapala się na zielono.
- **Python musi mieć tę samą bitowość co SDK** (64-bit do 64-bit), inaczej
  `Kinect10.dll` się nie załaduje.
- **Kinect Studio to nie tester czujnika** — służy do nagrywania strumieni z już
  działającej aplikacji i sam z siebie zawsze pokaże „Disconnected". Do sprawdzenia
  sprzętu użyj `python kinect_win.py info` albo Kinect Explorer z Developer Toolkit.
- **Nie mieszaj sterowników.** SDK 1.8 i libfreenect wykluczają się nawzajem —
  instalacja jednego odbiera dostęp drugiemu. Na Windowsie zostań przy SDK.

> ✅ **Sprawdzone na sprzęcie** (Kinect 360 + SDK 1.8 + Windows 11, Python 64-bit):
> głębia 640×480, obraz RGB 640×480, śledzenie szkieletu i silnik pochylenia.
> Przykładowy odczyt sylwetki: `stoi; na wprost; 2.0 m od czujnika; ręka prawa
> podniesiona`. Autotest (22 pozycje) pokrywa dodatkowo logikę bez czujnika.
>
> Gdyby coś nie działało, kolejność diagnostyki jest taka:
> `python kinect_win.py selftest` → `info` → `dump`. Ostatnie polecenie wypisuje
> surowy bufor klatki i samo wskazuje wskaźnik na teksturę.

## Fotogrametria — Cosmos PhotoScan

```bash
python photoscan.py C:\zdjecia\zamek           # analiza jakości + model 3D
python photoscan.py C:\zdjecia\zamek --dense   # + gęsta chmura punktów (.ply)
```

Cosmos ocenia zestaw zdjęć (liczba, ostrość, ekspozycja) i radzi, co dokręcić,
a jeśli w PATH jest **COLMAP** (https://colmap.github.io, wersja CUDA dla RTX),
buduje model automatycznie. Wynik zgłaszany jest do Cosmosa jako zdarzenie —
możesz zapytać w czacie „jak poszedł skan?".


## Słowo aktywujące — nasłuch w tle

`wake_listener.py` nasłuchuje mikrofonu **nawet przy zamkniętej przeglądarce** i po
wykryciu słowa aktywującego wysyła zdarzenie do Cosmosa.

> ⚠️ **Moduł niedokończony — przeczytaj, zanim go uruchomisz.** Dziś zdarzenie `wake`
> trafia wyłącznie do kontekstu percepcji (model dowie się przy następnej rozmowie,
> że o danej godzinie padło słowo aktywujące). **Nie otwiera trybu głosowego, nie
> zaczyna rozmowy i nic nie mówi** — brakuje kanału z serwera do przeglądarki, który
> by to uruchomił. Do rozmowy głosowej używaj trybu w przeglądarce (ikona fal
> dźwiękowych); działa po polsku, tyle że wymaga otwartej karty.
>
> Drugie ograniczenie: **openWakeWord nie ma polskiego „Hej Kosmos"**. Gotowe modele
> są angielskie (domyślnie `hey_jarvis`), więc budzisz się słowem po angielsku.
> Polski model trzeba wytrenować samodzielnie — openWakeWord daje do tego notatnik
> w Google Colab.

```bash
pip install openwakeword sounddevice numpy requests
python -c "import openwakeword.utils; openwakeword.utils.download_models()"   # raz
python wake_listener.py
```

Pobranie modeli jest osobnym krokiem — bez niego pierwsze uruchomienie kończy się
błędem. Mikrofon widziany przez Pythona sprawdzisz przez
`python -c "import sounddevice; print(sounddevice.query_devices())"` — szukasz pozycji
z niezerowym wejściem. Model zmienisz zmienną `WAKE_MODEL`.

## Analiza terenu — Cosmos Terrain

`terrain.py` zamienia model 3D z PhotoScana w pomiary (tylko numpy, zapis PNG własny):

```bash
python terrain.py selftest                                   # sprawdź poprawność obliczeń
python terrain.py sun model.ply --lat 52.23 --lon 21.01 --date 2026-06-21
python terrain.py shadow model.ply --lat .. --lon .. --time "2026-06-15 17:30"
python terrain.py view model.ply --eye 4.5                   # co widać z okna
python terrain.py volume halda.ply                           # kubatura
python terrain.py compare styczen.ply maj.ply                # zmiany w czasie
python terrain.py comfort model.ply --lat .. --lon .. --wind 270 --season lato
python terrain.py validate model.ply pomiary.csv --lat .. --lon ..
```

Wyniki mają sens **tylko dla modelu w metrach i zorientowanego na północ** (ENU).
Dla chmur bez georeferencji użyj `--scale`, `--north`, `--up`.

## Słuch przestrzenny — macierz mikrofonów Kinecta

**To jedyne zastosowanie Kinecta 360 na Windowsie, które działa bez budowania
sterowników.** Kinect for Windows SDK instaluje sterownik audio, dzięki któremu
macierz czterech mikrofonów widoczna jest jako **zwykłe 4-kanałowe wejście audio**.
Nie potrzeba do tego libfreenect ani niczego kompilować.

`soundloc.py` liczy z niej kierunek źródła dźwięku (GCC-PHAT + TDOA, z ograniczeniem
pasma i nadpróbkowaniem korelacji — bez tego przy kilkucentymetrowych odstępach
mikrofonów wynik jest bezużyteczny). Cosmos dostaje zdarzenia typu
„dźwięk po lewej (−35°)" — działa **w ciemności i poza kadrem kamery**.

```bash
pip install sounddevice
python soundloc.py --selftest         # sprawdź poprawność obliczeń, bez sprzętu
python soundloc.py --list-devices     # znajdź numer Kinecta
python soundloc.py --listen --device "Kinect"
python soundloc.py --wav nagranie.wav # analiza gotowego nagrania 4-kanałowego
```

`--list-devices` oznacza wejścia o czterech i więcej kanałach — Kinect pokaże się jako
„Microphone Array (Kinect USB Audio)" albo podobnie. Do `--device` podajesz numer
z listy albo fragment nazwy. Bez tej opcji moduł użyje domyślnego mikrofonu systemu,
który zwykle ma jeden kanał i kierunku nie policzy.

| Opcja | Znaczenie |
|---|---|
| `--channels` | liczba kanałów, domyślnie `4` (tyle ma Kinect 360) |
| `--gate` | próg głośności RMS, poniżej niego cisza jest pomijana |
| `--min-conf` | minimalna pewność wyniku, żeby zgłosić zdarzenie |
| `--window` | długość okna analizy w sekundach, domyślnie `0.5` |

## Planer lotu — Cosmos FlightPlan

`flightplan.py` liczy parametry przelotu z optyki (bez zależności):

```bash
python flightplan.py plan --altitude 50 --width 120 --length 80
python flightplan.py target --gsd 2.0        # jaka wysokość dla 2 cm/px
python flightplan.py matrix                  # macierz eksperymentu
```

## Granica widzenia — Cosmos LowLight

`lowlight.py` mierzy, przy jakim świetle detekcja przestaje działać:

```bash
python lowlight.py synth -o test             # seria testowa z szumem fotonowym
python lowlight.py measure folder --csv lux.csv
```

## Głowica pan/tilt — Ronin-S i inne

`pantilt.py` generuje wzorce ruchu i wysyła je do sterownika:

```bash
python pantilt.py selftest
python pantilt.py gigapano --span-h 180 --span-v 60 --fov-h 30 --fov-v 20
python pantilt.py scan --tilts -15,0,15      # skan wnętrza do fotogrametrii
```

Backendy: `sim` (podgląd, domyślny), `serial` (własny sterownik, np. Arduino/ESP),
`ronin` — **wymaga oficjalnego SDK DJI**, którego nie wolno dołączyć do repozytorium;
wzorce ruchu i punkt wejścia (`Head.goto`) są gotowe do podpięcia.

## Sterowanie aparatem — Cosmos Tether

`tether.py` steruje Canonem R6 II (i innymi) przez gPhoto2:

```bash
python tether.py selftest                    # logika bez aparatu
python tether.py info                        # wykryj aparat
python tether.py stack --frames 12           # focus stacking (makro)
python tether.py bracket --frames 5          # HDR
python tether.py watch --trigger ptak        # zdjęcie na zdarzenie percepcji
```

Wymaga `gphoto2` (Linux/macOS; na Windows przez WSL albo Canon EOS SDK).

> Protokoły badawcze wykorzystujące te narzędzia: **[../docs/BADANIA.md](../docs/BADANIA.md)**

## Endpointy

| Endpoint | Wejście | Wyjście |
|---|---|---|
| `GET /health` | — | które zmysły są aktywne |
| `POST /stt` | audio (webm/wav/ogg/mp3) | `{text, language}` |
| `POST /tts` | `{text}` | audio WAV |
| `POST /detect` | `{image: dataURL}` | `{objects[], summary}` |
| `POST /pose` | `{image: dataURL}` | `{present, summary}` |
| `POST /extract` | `{name: "plik.pdf", data: base64}` | `{text}` — PDF/DOCX/XLSX/PPTX do bazy wiedzy |
| `POST /upscale` | `{image: dataURL, scale: 4}` | `{image: dataURL}` — Real-ESRGAN |
| `POST /embed` | `{texts: [...]}` | `{vectors: [[...]]}` |

`/upscale` wymaga dodatkowo `pip install realesrgan basicsr` (i GPU dla sensownej
szybkości); bez tego zwraca 501 z podpowiedzią. Pozostałe endpointy odpowiadają
czytelnym błędem, gdy brakuje pakietu danego zmysłu — usługa startuje zawsze.

## Wydajność na RTX 3080

| Zmysł | Model | Uwagi |
|---|---|---|
| Whisper | `small` (domyślny) | transkrypcja szybsza niż czas rzeczywisty; `medium` dokładniejszy |
| YOLO | `yolo11n.pt` (domyślny) | ~1–3 ms/klatkę; `yolo11s/m` dokładniejsze |
| Piper | głos `medium` | synteza w ułamku sekundy, działa nawet na CPU |
| bge-m3 | embeddingi | ~2 GB w pamięci, kilkadziesiąt ms na fragment |
| MediaPipe | Pose | czas rzeczywisty na CPU (endpoint gotowy, nieużywany przez UI) |

Modele Whispera, YOLO i bge-m3 pobierają się **automatycznie** przy pierwszym użyciu.
Dwa wyjątki wymagają ręcznego kroku: **głos Pipera** (pobranie pliku `.onnx` i ustawienie
`PIPER_VOICE`) oraz **openWakeWord** (`openwakeword.utils.download_models()`).

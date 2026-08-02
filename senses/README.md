# ✦ Cosmos Senses — zmysły Cosmosa

Usługa percepcji w Pythonie. Daje Cosmosowi **słuch** (Whisper), **głos** (Piper),
**wzrok** (YOLO) i **rozumienie sylwetki** (MediaPipe). Wszystko działa lokalnie
na Twoim GPU — bez wysyłania dźwięku i obrazu do chmury.

> Ten plik to **pełna dokumentacja** zmysłów. Jeśli instalujesz Cosmosa od zera, prostszy
> przewodnik krok po kroku znajdziesz w **[../docs/START-TUTAJ.md](../docs/START-TUTAJ.md)**
> — CZĘŚĆ 5. Oba pliki opisują ten sam moduł; tutaj jest więcej szczegółów i wszystkie
> narzędzia sprzętowe.

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
| `CAMERA_INDEX` | numer kamery, domyślnie `0` |
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
> **Kinect 360 się tu nie liczy**: ze sterownikiem oficjalnego SDK nie jest zwykłą
> kamerą UVC i OpenCV go nie zobaczy (patrz „Zmysł głębi" niżej). Użyj webcama,
> telefonu jako kamery (Iriun, DroidCam) albo aparatu przez *Canon EOS Webcam Utility*.
> Numer z listy podajesz w `CAMERA_INDEX`.

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

## Zmysł głębi — Kinect 360

```bash
python kinect_watcher.py
```

Czyta mapę głębi przez **libfreenect** i wysyła do Cosmosa zdarzenia:
obecność w zasięgu, ruch, dystans najbliższego obiektu. Instalacja libfreenect:
https://github.com/OpenKinect/libfreenect (na Linuksie `sudo apt install freenect`).

> ⚠️ **Na Windowsie to droga przez mękę — i nie mieszaj sterowników.** Istnieją dwa
> niezależne stosy, które wykluczają się nawzajem:
>
> | Stos | Co daje | Czy działa z tym modułem |
> |---|---|---|
> | **Kinect for Windows SDK 1.8** (Microsoft) | oficjalny sterownik, Kinect Explorer, Kinect Studio | ❌ `kinect_watcher.py` go nie używa |
> | **libfreenect** (OpenKinect) | otwarty sterownik + moduł `freenect` dla Pythona | ✅ wymagany, ale na Windowsie trzeba go **samodzielnie zbudować** (CMake + Visual Studio + podmiana sterownika przez Zadig) |
>
> Zainstalowanie SDK 1.8 **odbiera** dostęp libfreenectowi i odwrotnie. Jeśli chcesz
> tylko sprawdzić, czy czujnik żyje, użyj **Kinect Explorer** z *Developer Toolkit
> Browser* (SDK 1.8) — **nie** Kinect Studio, które służy do nagrywania strumieni
> z już działającej aplikacji i samo z siebie nigdy nie połączy się z czujnikiem.
>
> Najmniej bolesna droga do zmysłu głębi to uruchomienie `kinect_watcher.py`
> na Linuksie (`sudo apt install freenect python3-freenect`) i wskazanie mu
> Cosmosa przez `COSMOS_URL` + `COSMOS_TOKEN`.

Kinect RGB **nie** jest widoczny jako zwykła kamera UVC — ani ze sterownikiem SDK,
ani z libfreenect. `watcher.py` (YOLO) i MediaPipe potrzebują osobnego webcama.

## Fotogrametria — Cosmos PhotoScan

```bash
python photoscan.py C:\zdjecia\zamek           # analiza jakości + model 3D
python photoscan.py C:\zdjecia\zamek --dense   # + gęsta chmura punktów (.ply)
```

Cosmos ocenia zestaw zdjęć (liczba, ostrość, ekspozycja) i radzi, co dokręcić,
a jeśli w PATH jest **COLMAP** (https://colmap.github.io, wersja CUDA dla RTX),
buduje model automatycznie. Wynik zgłaszany jest do Cosmosa jako zdarzenie —
możesz zapytać w czacie „jak poszedł skan?".


## Słowo aktywujące — „Hej, Kosmos" w tle

`wake_listener.py` nasłuchuje mikrofonu **nawet przy zamkniętej przeglądarce** i po
wykryciu słowa aktywującego wysyła zdarzenie do Cosmosa. Tryb głosowy w przeglądarce
(Web Speech) działa tylko przy otwartej karcie — ten moduł zdejmuje to ograniczenie.

```bash
pip install openwakeword sounddevice numpy requests
python wake_listener.py
```

Domyślnie używa gotowych modeli openWakeWord; własne „Hej Kosmos" trzeba wytrenować
(instrukcja w nagłówku pliku).

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

`soundloc.py` liczy kierunek źródła dźwięku z 4 mikrofonów (GCC-PHAT + TDOA,
z ograniczeniem pasma i nadpróbkowaniem korelacji — bez tego przy kilkucentymetrowych
odstępach mikrofonów wynik jest bezużyteczny).

```bash
python soundloc.py --selftest        # odtwarza zadane kierunki na syntetyku
python soundloc.py --wav nagranie.wav
python soundloc.py --listen          # nasłuch (wymaga: pip install sounddevice)
```

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
| MediaPipe | Pose | czas rzeczywisty na CPU |

Wszystkie modele pobierają się automatycznie przy pierwszym użyciu.

# ✦ Cosmos Senses — zmysły Cosmosa

Usługa percepcji w Pythonie. Daje Cosmosowi **słuch** (Whisper), **głos** (Piper),
**wzrok** (YOLO) i **rozumienie sylwetki** (MediaPipe). Wszystko działa lokalnie
na Twoim GPU — bez wysyłania dźwięku i obrazu do chmury.

## Szybki start

```bash
cd senses
python -m venv .venv
.venv\Scripts\activate            # Windows  (Linux/macOS: source .venv/bin/activate)
pip install fastapi uvicorn python-multipart   # rdzeń
pip install faster-whisper                     # + słuch
pip install ultralytics opencv-python          # + wzrok
pip install piper-tts                          # + głos (patrz niżej)
pip install mediapipe                          # + sylwetka/gesty

python service.py                              # port 7060
```

Cosmos wykryje usługę automatycznie (status „Zmysły” w panelu bocznym).
Każdy zmysł jest niezależny — zainstaluj tylko te, których potrzebujesz.

## Głos Piper (polski)

1. Pobierz polski głos z https://huggingface.co/rhasspy/piper-voices
   (np. `pl_PL-darkman-medium.onnx` + plik `.json`).
2. Ustaw zmienną środowiskową przed startem:

```bash
set PIPER_VOICE=C:\modele\pl_PL-darkman-medium.onnx    # Windows
python service.py
```

Bez Pipera Cosmos i tak mówi — używa wtedy głosu systemowego przeglądarki.

## Ciągła percepcja (obserwator kamery)

```bash
python watcher.py
```

Obserwuje kamerę (webcam albo Kinect widoczny jako kamera), wykrywa obiekty
i wysyła do Cosmosa **tylko zmiany** („w kadrze pojawiło się: person”).
Cosmos dokleja je do kontekstu rozmowy — możesz zapytać „co się zmieniło
w pokoju?” i model odpowie na podstawie prawdziwych obserwacji.

## Pamięć długotrwała (embeddingi)

```bash
pip install sentence-transformers
```

Domyślny model to **bge-m3** (~2 GB, bardzo dobre wielojęzyczne wyniki).
Lżejsza alternatywa (~120 MB): `set EMBED_MODEL=paraphrase-multilingual-MiniLM-L12-v2`.
Bez tego zmysłu pamięć w Cosmosie nadal działa — używa wtedy słów kluczowych.

## Zmysł głębi — Kinect 360

```bash
python kinect_watcher.py
```

Czyta mapę głębi przez **libfreenect** i wysyła do Cosmosa zdarzenia:
obecność w zasięgu, ruch, dystans najbliższego obiektu. Instalacja libfreenect:
https://github.com/OpenKinect/libfreenect (na Windows wymaga zbudowania;
na Linuksie `sudo apt install freenect`). Kinect RGB działa równolegle jako
zwykła kamera dla `watcher.py` (YOLO) i MediaPipe — głębia i obraz to dwa
niezależne zmysły z jednego urządzenia.

## Fotogrametria — Cosmos PhotoScan

```bash
python photoscan.py C:\zdjecia\zamek           # analiza jakości + model 3D
python photoscan.py C:\zdjecia\zamek --dense   # + gęsta chmura punktów (.ply)
```

Copilot ocenia zestaw zdjęć (liczba, ostrość, ekspozycja) i radzi, co dokręcić,
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
| `POST /embed` | `{texts: [...]}` | `{vectors: [[...]]}` |

## Wydajność na RTX 3080

| Zmysł | Model | Uwagi |
|---|---|---|
| Whisper | `small` (domyślny) | transkrypcja szybsza niż czas rzeczywisty; `medium` dokładniejszy |
| YOLO | `yolo11n.pt` (domyślny) | ~1–3 ms/klatkę; `yolo11s/m` dokładniejsze |
| Piper | głos `medium` | synteza w ułamku sekundy, działa nawet na CPU |
| MediaPipe | Pose | czas rzeczywisty na CPU |

Wszystkie modele pobierają się automatycznie przy pierwszym użyciu.

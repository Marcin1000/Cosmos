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

#!/usr/bin/env python3
"""
Cosmos Senses – usługa percepcji (zmysły Cosmosa).

Każdy zmysł jest OPCJONALNY: usługa startuje z tym, co masz zainstalowane,
a /health mówi Cosmosowi, które zmysły są dostępne.

    słuch    /stt     Whisper (faster-whisper)     pip install faster-whisper
    głos     /tts     Piper                        pip install piper-tts
    wzrok    /detect  YOLO (ultralytics)           pip install ultralytics
    ciało    /pose    MediaPipe (sylwetka)         pip install mediapipe
    dłonie   /dlonie  MediaPipe (palce, gesty)     pip install mediapipe
    ptaki    /ptak    BirdNET (gatunek z głosu)    pip install -r senses/requirements-ptaki.txt

Uruchomienie:
    pip install fastapi uvicorn python-multipart
    python senses/service.py            # port 7060

Konfiguracja przez zmienne środowiskowe:
    SENSES_PORT      port usługi (domyślnie 7060)
    WHISPER_MODEL    small | base | medium | large-v3   (domyślnie small)
    WHISPER_DEVICE   cuda | cpu                          (domyślnie auto)
    PIPER_VOICE      ścieżka do głosu .onnx, np. pl_PL-darkman-medium.onnx
    YOLO_MODEL       domyślnie yolo11n.pt (pobiera się automatycznie)
    COSMOS_ZMYSLY_TYLKO  np. "ptak" – usługa odpowiada tylko na te trasy i /health
                     (ptaki na serwerze: reszta zwraca 404)
    BIRDNET_ROZGRZEJ 0 wyłącza ładowanie BirdNET w tle przy starcie
"""

import base64
import io
import os
import tempfile
import threading
from datetime import datetime

import anyio
from fastapi import Body, FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
import uvicorn

app = FastAPI(title="Cosmos Senses")


@app.exception_handler(Exception)
async def any_error_as_json(request: Request, exc: Exception):
    """Każdy nieprzewidziany błąd wraca jako JSON.

    Domyślnie Starlette oddaje przy wyjątku zwykły tekst „Internal Server
    Error”. Przeglądarka próbuje czytać go jako JSON i pokazuje użytkownikowi
    „Unexpected token 'I' … is not valid JSON” – komunikat, z którego nie
    wynika absolutnie nic. Tutaj oddajemy typ i treść wyjątku, żeby w Cosmosie
    było widać prawdziwą przyczynę, a pełny ślad zostaje w oknie usługi.
    """
    import traceback
    traceback.print_exc()
    return JSONResponse(
        {"error": f"{type(exc).__name__}: {exc}", "gdzie": request.url.path},
        status_code=500,
    )

# ---------------------------------------------------------------------------
# Wykrywanie dostępnych zmysłów (leniwa inicjalizacja modeli)
# ---------------------------------------------------------------------------

CAPS = {"whisper": False, "piper": False, "yolo": False, "mediapipe": False, "dlonie": False,
        "embed": False, "upscale": False, "kinect": False, "birdnet": False,
        # Nie True/False, tylko NAZWA czytnika ("docling" / "markitdown") albo
        # False. Cosmos pokazuje ja w panelu zmyslow, bo to realna roznica
        # w jakosci odczytu, a nie tylko "jest / nie ma".
        "dokumenty": False}

# Kinect 360 przez oficjalne SDK (tylko Windows). Obraz z niego nie jest widoczny
# dla przeglądarki ani OpenCV – nie jest kamerą UVC – więc klatki muszą iść
# do Cosmosa tędy, przez HTTP.
try:
    import kinect_win
    CAPS["kinect"] = kinect_win.sensor_count() > 0
except Exception:
    pass

try:
    import faster_whisper  # noqa: F401
    CAPS["whisper"] = True
except ImportError:
    pass

try:
    import piper  # noqa: F401
    CAPS["piper"] = bool(os.environ.get("PIPER_VOICE"))
except ImportError:
    pass

try:
    import ultralytics  # noqa: F401
    CAPS["yolo"] = True
except ImportError:
    pass

try:
    import mediapipe
    # mediapipe od 0.10.30 nie ma `mp.solutions` – wtedy /pose idzie przez
    # Tasks API (PoseLandmarker). Stare 0.10.21 nie ma kół dla Pythona 3.13,
    # więc przypięcie do niego zostawiało Windowsa z nowym Pythonem bez ciała.
    CAPS["mediapipe"] = hasattr(mediapipe, "solutions") or hasattr(mediapipe, "tasks")
    # Dłonie i gesty idą zawsze przez Tasks API (GestureRecognizer) – jest od 0.10.0.
    from mediapipe.tasks.python import vision as _mp_vision  # noqa: F401
    CAPS["dlonie"] = hasattr(_mp_vision, "GestureRecognizer")
except Exception:
    pass

try:
    import sentence_transformers  # noqa: F401
    CAPS["embed"] = True
except ImportError:
    pass

try:
    import realesrgan  # noqa: F401
    CAPS["upscale"] = True
except ImportError:
    pass

# BirdNET – gatunek ptaka z nagrania. Dla kogoś, kto fotografuje żurawie,
# to nie ciekawostka: usłyszeć ptaka można znacznie dalej, niż go zobaczyć,
# a wiedza „to derkacz, siedzi w tej łące" decyduje, gdzie postawić statyw.
#
# Sam `import birdnetlib` nie wystarczał jako dowód: birdnetlib wczytuje
# interpreter TFLite dopiero w analyzer.py, więc usługa zgłaszała ptaki, a każde
# /ptak kończyło się 500. Dlatego CAPS["birdnet"] dopiero po imporcie
# interpretera (tflite-runtime albo ai-edge-litert przez zgodnosc_litert.py),
# a rozgrzewka w tle (_rozgrzej_birdnet) i tak sprawdza całość na nagraniu ciszy.
try:
    import zgodnosc_litert  # noqa: F401  (tflite_runtime ← ai_edge_litert, gdy trzeba)
except ImportError:
    pass
try:
    import birdnetlib  # noqa: F401
    import birdnetlib.analyzer  # noqa: F401  (tu wczytuje się interpreter TFLite)
    CAPS["birdnet"] = True
except Exception:  # noqa: BLE001 – zepsuty tflite (numpy 2 z tflite-runtime) rzuca nie tylko ImportError
    pass

_whisper_model = None
_piper_voice = None
_yolo_model = None
_embed_model = None
_birdnet = None


def _load_whisper(device: str):
    from faster_whisper import WhisperModel
    name = os.environ.get("WHISPER_MODEL", "small")
    compute = "int8" if device == "cpu" else "float16"
    return WhisperModel(name, device=device, compute_type=compute)


# Jedno ładowanie naraz. Rozgrzewka startuje w tle przy starcie usługi, a to
# dokładnie chwila, w której nasłuch „Hej, Cosmos” wysyła pierwsze wycinki –
# bez zamka każde /stt w trakcie ładowania ładowało własną kopię modelu
# (za pierwszym razem także pobierało ją z sieci; na GPU kilka kopii w VRAM).
_whisper_zamek = threading.Lock()
_whisper_na_cpu = False


def get_whisper():
    global _whisper_model, _whisper_na_cpu
    model = _whisper_model
    if model is not None:
        return model
    with _whisper_zamek:
        if _whisper_model is None:
            device = os.environ.get("WHISPER_DEVICE", "auto")
            try:
                _whisper_model = _load_whisper(device)
                _whisper_na_cpu = device == "cpu"
            except Exception:
                _whisper_model = _load_whisper("cpu")
                _whisper_na_cpu = True
        return _whisper_model


def whisper_to_cpu():
    """Przełącz Whispera na procesor i zwróć nowy model.

    Samo utworzenie modelu z device="auto" udaje się nawet bez bibliotek CUDA –
    CTranslate2 sięga po nie dopiero przy pierwszym przeliczeniu. Dlatego
    zabezpieczenie przy ładowaniu nic nie dawało: proces wywracał się w środku
    transkrypcji na „Library cublas64_12.dll is not found”. Ten przełącznik
    wołamy właśnie wtedy – raz, i zostajemy na procesorze do restartu usługi.
    Kilka /stt, które potknęły się na CUDA naraz, ładuje model procesora raz:
    kolejne czekają na zamku i dostają gotowy.
    """
    global _whisper_model, _whisper_na_cpu
    with _whisper_zamek:
        if _whisper_model is None or not _whisper_na_cpu:
            _whisper_model = _load_whisper("cpu")
            _whisper_na_cpu = True
        return _whisper_model


# Rozpoznajemy po treści: brakująca biblioteka CUDA/cuDNN, nie błąd samego audio.
def _is_cuda_runtime_error(e: Exception) -> bool:
    msg = str(e).lower()
    return any(k in msg for k in
               ("cublas", "cudnn", "cudart", "cuda driver", "no kernel image",
                "libcublas", "cuda runtime", "cuda_error"))


def get_piper():
    global _piper_voice
    if _piper_voice is None:
        from piper import PiperVoice
        _piper_voice = PiperVoice.load(os.environ["PIPER_VOICE"])
    return _piper_voice


def piper_wav(voice, text: str) -> bytes:
    """Zsyntezuj mowę do gotowego pliku WAV – niezależnie od wersji Pipera.

    Piper zmienił API. Do 1.2 `synthesize(text, wav_file)` zapisywał wprost do
    otwartego pliku wave. Od 1.3 `synthesize(text)` zwraca GENERATOR kawałków
    dźwięku, a stara postać jest nieobsługiwana. Wywołanie generatora bez
    iterowania po nim nie robi nic: plik wave zostawał bez parametrów i bez
    danych, a zamknięcie go rzucało „# channels not specified”. Tak właśnie
    padało czytanie na głos.

    Kolejność prób: `synthesize_wav` (jawne API 1.3), potem generator kawałków,
    na końcu stara sygnatura.
    """
    import wave

    def open_wav(buf, rate, width, channels):
        w = wave.open(buf, "wb")
        w.setnchannels(channels)
        w.setsampwidth(width)
        w.setframerate(rate)
        return w

    # 1.3+: gotowa metoda zapisu do pliku wave
    if hasattr(voice, "synthesize_wav"):
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            voice.synthesize_wav(text, w)
        return buf.getvalue()

    try:
        result = voice.synthesize(text)
    except TypeError:
        # ≤1.2: sygnatura wymaga otwartego pliku wave jako drugiego argumentu
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            voice.synthesize(text, w)
        return buf.getvalue()

    # 1.3+: generator kawałków dźwięku
    if hasattr(result, "__iter__") and not isinstance(result, (bytes, bytearray)):
        buf = io.BytesIO()
        w = None
        try:
            for chunk in result:
                raw = (getattr(chunk, "audio_int16_bytes", None)
                       or getattr(chunk, "audio_int16_array", None))
                if raw is None and isinstance(chunk, (bytes, bytearray)):
                    raw = chunk
                if raw is None:
                    continue
                if hasattr(raw, "tobytes"):
                    raw = raw.tobytes()
                if w is None:
                    w = open_wav(buf,
                                 getattr(chunk, "sample_rate", 22050),
                                 getattr(chunk, "sample_width", 2),
                                 getattr(chunk, "sample_channels", 1))
                w.writeframes(raw)
        finally:
            if w is not None:
                w.close()
        return buf.getvalue() if w is not None else b""

    if isinstance(result, (bytes, bytearray)):
        return bytes(result)

    # ≤1.2: zapis wprost do otwartego pliku wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        voice.synthesize(text, w)
    return buf.getvalue()


def get_yolo():
    global _yolo_model
    if _yolo_model is None:
        from ultralytics import YOLO
        _yolo_model = YOLO(os.environ.get("YOLO_MODEL", "yolo11n.pt"))
    return _yolo_model


def get_embedder():
    global _embed_model
    if _embed_model is None:
        from sentence_transformers import SentenceTransformer
        # bge-m3: bardzo dobre wielojęzyczne embeddingi (ok. 2 GB).
        # Lżejsza alternatywa: paraphrase-multilingual-MiniLM-L12-v2 (~120 MB).
        name = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")
        _embed_model = SentenceTransformer(name)
    return _embed_model


# Który mocniejszy czytnik dokumentów jest pod ręką (albo None).
CAPS_CZYTNIK = None
for _nazwa in ("docling", "markitdown"):
    try:
        __import__(_nazwa)
        CAPS_CZYTNIK = _nazwa
        CAPS["dokumenty"] = _nazwa
        break
    except ImportError:
        continue

_konwerter = None


def _extract_docling(name: str, data: bytes, ext: str):
    """Tekst przez docling/markitdown albo None, gdy się nie da.

    NIGDY nie rzuca. Cztery gałęzie niżej (pypdf, python-docx, openpyxl,
    python-pptx) są sprawdzone i mają działać dalej, gdy mocniejszy czytnik
    zawiedzie na konkretnym pliku – bo to jest DODATEK, a nie zamiennik.
    """
    if not CAPS_CZYTNIK:
        return None
    # Zwykły tekst nie potrzebuje modelu układu strony.
    if ext in ("txt", "md", "csv", "json", "xml", "log"):
        return None
    global _konwerter
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix="." + (ext or "bin"), delete=False) as f:
            f.write(data)
            tmp = f.name
        if CAPS_CZYTNIK == "docling":
            if _konwerter is None:
                from docling.document_converter import DocumentConverter
                _konwerter = DocumentConverter()
            return _konwerter.convert(tmp).document.export_to_markdown()
        if _konwerter is None:
            from markitdown import MarkItDown
            _konwerter = MarkItDown()
        return _konwerter.convert(tmp).text_content
    except Exception as e:
        print(f"  ⚠ {CAPS_CZYTNIK} nie poradzil sobie z {name} ({e}). "
              f"Wracam do wlasnego czytnika.", flush=True)
        return None
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass


def decode_image(payload: dict):
    """dataURL/base64 -> obraz OpenCV (numpy BGR)."""
    import cv2
    import numpy as np
    data = payload.get("image", "")
    if "," in data:  # data:image/jpeg;base64,....
        data = data.split(",", 1)[1]
    raw = base64.b64decode(data)
    arr = np.frombuffer(raw, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


# ---------------------------------------------------------------------------
# Tylko wybrane zmysły (COSMOS_ZMYSLY_TYLKO) – ptaki na serwerze
# ---------------------------------------------------------------------------
# Na VPS-ie ta sama usługa liczy wyłącznie ptaki (cosmos-ptaki.service,
# COSMOS_ZMYSLY_TYLKO=ptak). Wszystko spoza listy odpowiada 404, zanim dotknie
# czegokolwiek, a /health nie zgłasza innych zmysłów – nawet gdyby w venv
# przypadkiem leżał Whisper czy YOLO, Cosmos nie pośle tu nic poza nagraniem ptaka.
# Nazwa zmysłu → (trasa, klucz w CAPS).
ZMYSLY_TRASY = {
    "ptak": ("/ptak", "birdnet"),
    "stt": ("/stt", "whisper"),
    "tts": ("/tts", "piper"),
    "detect": ("/detect", "yolo"),
    "pose": ("/pose", "mediapipe"),
    "dlonie": ("/dlonie", "dlonie"),
    "embed": ("/embed", "embed"),
    "extract": ("/extract", "dokumenty"),
    "upscale": ("/upscale", "upscale"),
}
ZMYSLY_TYLKO = [s.strip().lower() for s in os.environ.get("COSMOS_ZMYSLY_TYLKO", "").split(",") if s.strip()]


class _TylkoWybraneTrasy:
    """Czysty pośrednik ASGI (nie BaseHTTPMiddleware – ten potrafi zjeść ciało
    żądania, a /ptak czyta nagranie z ciała w wątku)."""

    def __init__(self, app, dozwolone):
        self.app = app
        self.dozwolone = dozwolone

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http" and scope.get("path") not in self.dozwolone:
            odp = JSONResponse({"error": "Tej trasy ta usługa nie obsługuje."}, status_code=404)
            await odp(scope, receive, send)
            return
        await self.app(scope, receive, send)


if ZMYSLY_TYLKO:
    _nieznane = [s for s in ZMYSLY_TYLKO if s not in ZMYSLY_TRASY]
    if _nieznane:
        print(f"  ⚠ COSMOS_ZMYSLY_TYLKO: nieznane zmysły {', '.join(_nieznane)} (znane: {', '.join(ZMYSLY_TRASY)})",
              flush=True)
    _dozwolone_caps = {ZMYSLY_TRASY[s][1] for s in ZMYSLY_TYLKO if s in ZMYSLY_TRASY}
    for _k in CAPS:
        if _k not in _dozwolone_caps:
            CAPS[_k] = False
    app.add_middleware(_TylkoWybraneTrasy,
                       dozwolone={"/health"} | {ZMYSLY_TRASY[s][0] for s in ZMYSLY_TYLKO if s in ZMYSLY_TRASY})


# ---------------------------------------------------------------------------
# Endpointy
# ---------------------------------------------------------------------------

# `async`: odpowiada z pętli zdarzeń, nie z puli wątków. Wisząca trasa
# (zawieszony czujnik) zajmowała wszystkie wątki i /health milczało – agent
# i Cosmos brały wtedy zdrowe zmysły za wyłączone (zespół IT, runda 7).
@app.get("/health")
async def health():
    # `birdnet_gotowy`: model załadowany i sprawdzony na nagraniu (rozgrzewka albo
    # pierwsze /ptak). Do tej chwili Cosmos nie kieruje tu nagrań z serwera –
    # pierwsza analiza po instalacji potrafi trwać kilkadziesiąt sekund.
    return {**CAPS, "birdnet_gotowy": CAPS["birdnet"] is True and _birdnet_gotowy}


@app.post("/stt")
def stt(request: Request):
    """Audio (webm/ogg/wav/mp3) w body -> {"text": "..."}"""
    if not CAPS["whisper"]:
        return JSONResponse({"error": "Whisper niezainstalowany (pip install faster-whisper)."}, status_code=501)
    audio = anyio.from_thread.run(request.body)
    suffix = ".webm"
    ctype = request.headers.get("content-type", "")
    for ext in ("wav", "ogg", "mp3", "mp4", "m4a"):
        if ext in ctype:
            suffix = "." + ext
            break
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio)
        tmp = f.name
    # Tryb od Cosmosa: „nasluch” (słowo budzące), „podglad” (szkic w trakcie
    # mówienia) albo „pytanie”. Krótkie wycinki dostają narzucony język i szybkie
    # dekodowanie – wykrywanie języka na sekundzie nagrania myli się najczęściej,
    # a na słowo budzące czeka się po każdej wypowiedzi w pokoju. Podpowiedzi
    # („initial_prompt”) celowo nie ma: na szumie Whisper potrafi ją „usłyszeć”
    # i Cosmos budziłby się sam – przekręcenia nazwy łapie wzorzec w aplikacji.
    tryb = request.query_params.get("tryb", "")
    jezyk = request.query_params.get("jezyk", "")
    lang = os.environ.get("WHISPER_LANG") or None
    opcje = {"vad_filter": True}
    if tryb in ("nasluch", "podglad"):
        opcje["beam_size"] = 1
        # Bez tego faster-whisper przy niepewności i tak próbkuje kolejne
        # temperatury po kilku kandydatów – zjada zysk z beam_size=1
        # i sprzyja halucynacjom na szumie (zespół IT, runda 7).
        opcje["temperature"] = 0.0
        if not lang and jezyk in ("pl", "en"):
            lang = jezyk
    try:
        # `transcribe` zwraca leniwy generator – lista wymusza przeliczenie
        # TERAZ, wewnątrz try. Inaczej błąd CUDA wypadłby dopiero przy
        # składaniu tekstu, poza zasięgiem tego zabezpieczenia.
        try:
            segments, info = get_whisper().transcribe(tmp, language=lang, **opcje)
            segments = list(segments)
        except Exception as e:
            if not _is_cuda_runtime_error(e):
                raise
            print(f"  ⚠ Whisper: brak bibliotek CUDA ({e}). Przechodzę na procesor.", flush=True)
            segments, info = whisper_to_cpu().transcribe(tmp, language=lang, **opcje)
            segments = list(segments)
        # Pytanie: język wykrywany sam, a na 1–2 s nagrania myli się najczęściej.
        # Niepewny wynik – jeszcze raz w języku interfejsu.
        if (tryb == "pytanie" and not lang and jezyk in ("pl", "en")
                and getattr(info, "language", jezyk) != jezyk
                and float(getattr(info, "language_probability", 1.0) or 0) < 0.7):
            try:
                segments, info = get_whisper().transcribe(tmp, language=jezyk, **opcje)
                segments = list(segments)
            except Exception as e:
                if not _is_cuda_runtime_error(e):
                    raise
                segments, info = whisper_to_cpu().transcribe(tmp, language=jezyk, **opcje)
                segments = list(segments)
        text = " ".join(s.text.strip() for s in segments).strip()
        return {"text": text, "language": info.language}
    finally:
        os.unlink(tmp)


# --- ptaki: początek (blok czysty – selftest tests/atrapy/ptaki_zamek_test.py wykonuje go z atrapą birdnetlib)
# Jeden Analyzer na proces (model ~450 MB w pamięci), ale NIGDY dwie analizy
# naraz. Interpreter TFLite nie jest bezpieczny wielowątkowo, a Analyzer trzyma
# stan między nagraniami: `results` i `custom_species_list` (sito gatunków po
# położeniu). Bez zamka dwa /ptak naraz dawały 500 albo cudze gatunki, a nagranie
# bez współrzędnych po nagraniu z Biebrzy dostawało sito Biebrzy (zespół IT,
# runda 8). Zamek obejmuje ładowanie modelu, reset sita, analizę i odczyt wyników.
PTAK_ZAMEK = threading.Lock()
PTAK_CZEKAJ_S = 55  # dłużej nie czekamy na swoją kolej – Cosmos ma 60 s na całe zlecenie
_birdnet_gotowy = False


class PtakZajety(Exception):
    """Inne nagranie liczy się za długo – odpowiadamy 503, Cosmos spróbuje innego źródła."""


def _plik_nazw_pl():
    return os.environ.get("PTAKI_NAZWY_PL") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "nazwy_ptakow_pl.txt")


# Zapas, gdy pliku z nazwami nie ma (np. agent zmysłów ze starszym zestawem
# plików): najczęstsze polskie gatunki, łacina → nazwa jak w etykietach BirdNET.
NAZWY_PL_ZAPAS = {
    "Parus major": "bogatka", "Cyanistes caeruleus": "modraszka", "Periparus ater": "sosnówka",
    "Poecile palustris": "sikora uboga", "Aegithalos caudatus": "raniuszek", "Sitta europaea": "kowalik",
    "Certhia familiaris": "pełzacz leśny", "Erithacus rubecula": "rudzik", "Turdus merula": "kos",
    "Turdus philomelos": "śpiewak", "Fringilla coelebs": "zięba", "Chloris chloris": "dzwoniec",
    "Carduelis carduelis": "szczygieł", "Passer domesticus": "wróbel", "Sturnus vulgaris": "szpak",
    "Pica pica": "sroka", "Corvus cornix": "wrona siwa", "Garrulus glandarius": "sójka",
    "Dendrocopos major": "dzięcioł duży", "Dryocopus martius": "dzięcioł czarny",
    "Picus viridis": "dzięcioł zielony", "Sylvia atricapilla": "kapturka",
    "Phylloscopus collybita": "pierwiosnek", "Phylloscopus trochilus": "piecuszek",
    "Troglodytes troglodytes": "strzyżyk", "Luscinia megarhynchos": "słowik rdzawy",
    "Luscinia luscinia": "słowik szary", "Cuculus canorus": "kukułka", "Oriolus oriolus": "wilga",
    "Emberiza citrinella": "trznadel", "Alauda arvensis": "skowronek", "Hirundo rustica": "dymówka",
    "Motacilla alba": "pliszka siwa", "Phoenicurus ochruros": "kopciuszek",
    "Columba palumbus": "grzywacz", "Streptopelia decaocto": "sierpówka",
    "Acrocephalus scirpaceus": "trzcinniczek", "Crex crex": "derkacz", "Grus grus": "żuraw",
    "Vanellus vanellus": "czajka", "Gallinago gallinago": "kszyk", "Numenius arquata": "kulik wielki",
    "Botaurus stellaris": "bąk", "Ciconia ciconia": "bocian biały", "Anser anser": "gęgawa",
    "Cygnus olor": "łabędź niemy", "Anas platyrhynchos": "krzyżówka", "Buteo buteo": "myszołów",
    "Strix aluco": "puszczyk", "Bubo bubo": "puchacz",
}
_nazwy_pl = None


def nazwy_pl():
    """Łacina → polska nazwa. Plik to oficjalne etykiety BirdNET V2.4 po polsku
    (`Łacina_nazwa`, 6522 wiersze); bez niego – krótka lista wyżej."""
    global _nazwy_pl
    if _nazwy_pl is None:
        nazwy = dict(NAZWY_PL_ZAPAS)
        try:
            with open(_plik_nazw_pl(), encoding="utf-8") as f:
                for wiersz in f:
                    lac, _, pl = wiersz.strip().partition("_")
                    if lac and pl:
                        nazwy[lac] = pl
        except OSError:
            pass
        _nazwy_pl = nazwy
    return _nazwy_pl


def _wspolrzedna(tekst, granica):
    """Liczba z zakresu ±granica zaokrąglona do 0,1° (ok. 11 km) albo None.
    BirdNET i tak liczy sito z siatki zasięgów, a dokładna pozycja osoby nie
    musi leżeć w pamięci usługi (cache list gatunków po współrzędnych)."""
    try:
        x = float(tekst)
    except (TypeError, ValueError):
        return None
    if x != x or abs(x) > granica:  # NaN albo poza Ziemią
        return None
    return round(x, 1)


def wspolrzedne_z_zadania(zapytanie, naglowki):
    """(lat, lon) z nagłówków X-Cosmos-Lat / X-Cosmos-Lon, a gdy ich brak –
    z adresu (?lat=&lon=, jak dotąd). Ciało to samo nagranie, więc nagłówek
    jest jedynym miejscem poza adresem – a adres ląduje w logach pośredników."""
    lat = _wspolrzedna(naglowki.get("x-cosmos-lat"), 90)
    lon = _wspolrzedna(naglowki.get("x-cosmos-lon"), 180)
    if lat is None or lon is None:
        lat = _wspolrzedna(zapytanie.get("lat"), 90)
        lon = _wspolrzedna(zapytanie.get("lon"), 180)
    if lat is None or lon is None:
        return None, None
    return lat, lon


def analizuj_ptaka(sciezka, lat=None, lon=None, min_conf=0.25, jezyk="pl", data=None):
    """Nagranie z dysku → {"gatunki": [...], "wykryc", "zMiejscem"}. Rzuca przy błędzie."""
    global _birdnet, _birdnet_gotowy
    from birdnetlib import Recording
    from birdnetlib.analyzer import Analyzer
    if not PTAK_ZAMEK.acquire(timeout=PTAK_CZEKAJ_S):
        raise PtakZajety()
    try:
        if _birdnet is None:
            _birdnet = Analyzer()
        # Sito z poprzedniego nagrania nie może przejść na to. Przy współrzędnych
        # birdnetlib ustawi je od nowa (z własnej pamięci podręcznej), bez nich
        # zostaje puste – cały świat, jak na świeżym procesie.
        _birdnet.custom_species_list = []
        kwargs = {"min_conf": min_conf}
        z_miejscem = lat is not None and lon is not None
        if z_miejscem:
            kwargs.update(lat=lat, lon=lon, date=data or datetime.now())
        rec = Recording(_birdnet, sciezka, **kwargs)
        rec.analyze()
        wykrycia = list(rec.detections)  # odczyt też pod zamkiem – detections czyta stan Analyzera
        _birdnet_gotowy = True
    finally:
        PTAK_ZAMEK.release()

    pl = nazwy_pl() if jezyk == "pl" else {}
    gatunki = []
    for d in wykrycia:
        lac = d.get("scientific_name")
        en = d.get("common_name")
        gatunki.append({
            # `nazwa` i `lacinska` czyta aplikacja (app.js) – zostają; `nazwa`
            # jest teraz po polsku, angielska obok w `nazwaEn`.
            "nazwa": pl.get(lac) or en,
            "nazwaEn": en,
            "lacinska": lac,
            "pewnosc": round(float(d.get("confidence", 0)), 3),
            "odS": d.get("start_time"),
            "doS": d.get("end_time"),
        })
    # Ten sam ptak śpiewa zwykle w kilku oknach po 3 s. Zwracamy jedno
    # wystąpienie na gatunek – to, w którym był najpewniejszy.
    najlepsze = {}
    for g in gatunki:
        klucz = g["lacinska"] or g["nazwa"]
        if klucz not in najlepsze or g["pewnosc"] > najlepsze[klucz]["pewnosc"]:
            najlepsze[klucz] = g
    wynik = sorted(najlepsze.values(), key=lambda g: -g["pewnosc"])
    return {"gatunki": wynik[:5], "wykryc": len(gatunki), "zMiejscem": z_miejscem}


def _rozgrzej_birdnet():
    """Model, sito miejsca i (przy tflite-runtime) kompilacja numby – teraz, w tle,
    a nie przy pierwszym ptaku w lesie. Pierwsza analiza po instalacji trwała do
    34 s. Trzy sekundy ciszy przechodzą przez całą drogę: gdy tu coś pada
    (np. tflite-runtime z numpy 2), usługa przestaje zgłaszać ptaki zamiast
    oddawać 500 na każde nagranie."""
    import struct
    import time
    import wave
    fd, sciezka = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        with wave.open(sciezka, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(48000)
            w.writeframes(struct.pack("<h", 0) * 48000 * 3)
        t0 = time.time()
        analizuj_ptaka(sciezka, 52.2, 21.0)  # z miejscem – ładuje też model zasięgów
        analizuj_ptaka(sciezka)               # i bez – sito wraca do pustego
        print(f"  ✓ BirdNET gotowy ({time.time() - t0:.1f} s)", flush=True)
    except Exception as e:  # noqa: BLE001
        CAPS["birdnet"] = False
        print(f"  ⚠ BirdNET nie wstał przy starcie, ptaki wyłączone: {type(e).__name__}: {e}", flush=True)
    finally:
        try:
            os.unlink(sciezka)
        except OSError:
            pass
# --- ptaki: koniec


@app.post("/ptak")
def ptak(request: Request):
    """Nagranie (wav/mp3/flac) w body -> {"gatunki": [{...}]}  – BirdNET.

    MIEJSCE I DATA SĄ TU ISTOTNE, nie ozdobne. BirdNET zawęża listę do
    gatunków, które w danym tygodniu faktycznie występują pod danymi
    współrzędnymi – bez tego czajka z Biebrzy potrafi wyjść jako gatunek
    z Ameryki Południowej o podobnym głosie. Współrzędne przychodzą z
    Cosmosa (te same, których używa plan zdjęciowy) w nagłówkach
    X-Cosmos-Lat / X-Cosmos-Lon albo, jak dawniej, w ?lat=&lon=; bez nich
    analiza i tak się wykona, tylko szerszym sitem.

    Gatunek: `nazwa` po polsku (?jezyk=en albo X-Cosmos-Jezyk: en – po
    angielsku), `nazwaEn`, `lacinska`, `pewnosc`, `odS`, `doS`.
    """
    if not CAPS["birdnet"]:
        return JSONResponse(
            {"error": "BirdNET niedostępny (pip install -r senses/requirements-ptaki.txt)."},
            status_code=501,
        )
    audio = anyio.from_thread.run(request.body)
    if not audio:
        return JSONResponse({"error": "Puste nagranie."}, status_code=400)

    q = request.query_params
    lat, lon = wspolrzedne_z_zadania(q, request.headers)
    try:
        min_conf = float(q.get("min", 0.25))
    except ValueError:
        min_conf = 0.25
    jezyk = (q.get("jezyk") or request.headers.get("x-cosmos-jezyk") or "pl").lower()[:2]

    suffix = ".wav"
    ctype = request.headers.get("content-type", "")
    for ext in ("wav", "mp3", "flac", "ogg", "m4a"):
        if ext in ctype:
            suffix = "." + ext
            break
    # Plik 0600 w katalogu tymczasowym (na serwerze: PrivateTmp usługi), kasowany
    # zaraz po analizie – nagranie nie zostaje nigdzie.
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio)
        tmp = f.name
    try:
        return analizuj_ptaka(tmp, lat, lon, min_conf, jezyk)
    except PtakZajety:
        return JSONResponse({"error": "Rozpoznawanie ptaków jest zajęte – spróbuj za chwilę.",
                             "kod": "kolejka-pelna"}, status_code=503, headers={"Retry-After": "10"})
    except Exception as e:
        return JSONResponse({"error": f"BirdNET nie przeanalizował nagrania: {e}"},
                            status_code=500)
    finally:
        os.unlink(tmp)


@app.post("/tts")
def tts(payload: dict = Body(...)):
    """{"text": "..."} -> audio/wav"""
    if not CAPS["piper"]:
        return JSONResponse(
            {"error": "Piper niedostępny (pip install piper-tts + ustaw PIPER_VOICE na plik głosu .onnx)."},
            status_code=501,
        )
    text = (payload.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "Puste pole text."}, status_code=400)
    try:
        data = piper_wav(get_piper(), text)
    except Exception as e:
        return JSONResponse({"error": f"Piper nie zsyntezował mowy: {e}"}, status_code=500)
    if not data:
        return JSONResponse({"error": "Piper zwrócił pustą próbkę dźwięku."}, status_code=500)
    return Response(content=data, media_type="audio/wav")


# ROZPOZNAWANIE NIE MOŻE STAĆ NA PĘTLI ZDARZEŃ.
#
# Rozpoznawanie treści całego archiwum wysyła tu kilkanaście zdjęć naraz.
# Przy `async def` cała ta praca – dekodowanie base64 i sama detekcja –
# wykonuje się NA PĘTLI ZDARZEŃ uvicorna, więc żądania nie tylko ustawiają się
# w kolejce (to akurat w porządku, karta jest jedna), ale blokują też
# `/health`. Cosmos odpytuje `/health`, żeby wiedzieć, czy zmysły żyją – i
# w środku wielogodzinnego przebiegu dostawałby ciszę, po czym uznawał komputer
# domowy za wyłączony i przechodził na rozpoznawanie z przeglądarki.
#
# `def` bez `async` FastAPI odsyła do puli wątków: pętla zdarzeń zostaje wolna,
# `/health` odpowiada od razu. Ciało żądania FastAPI parsuje ZA NAS (stąd
# `payload: dict = Body(...)`), bo w funkcji bez `async` nie ma jak zaczekać na
# `request.json()`. Sama detekcja nadal idzie pojedynczo, bo model jest jeden
# i nie jest bezpieczny wielowątkowo – stąd zamek. Przy 220 ms na zdjęcie
# i 8 s czekania na miniaturę kolejka przed kartą nie jest wąskim gardłem.
YOLO_ZAMEK = threading.Lock()


# Ta sama zasada dotyczy /stt, /tts, /pose, /extract, /upscale, /embed i /ptak:
# pierwsze pobranie Whispera czy bge-m3 i długa transkrypcja trwają minuty,
# a przy `async def` /health milczało przez cały ten czas – agent zmysłów
# meldował „zmysły wyłączone” i Cosmos przełączał osobę na inny komputer
# (zespół IT, runda 6). Surowe ciało (nagranie) wczytujemy przez
# `anyio.from_thread.run(request.body)` – działa w wątku z puli FastAPI.


@app.post("/detect")
def detect(payload: dict = Body(...)):
    """{"image": dataURL} -> {"objects": [{label, conf, box}], "summary": "..."}"""
    if not CAPS["yolo"]:
        return JSONResponse({"error": "YOLO niezainstalowany (pip install ultralytics)."}, status_code=501)
    img = decode_image(payload)
    if img is None:
        return JSONResponse({"error": "Nie udało się odczytać obrazu."}, status_code=400)
    with YOLO_ZAMEK:
        results = get_yolo()(img, verbose=False)[0]
    objects = []
    for b in results.boxes:
        objects.append({
            "label": results.names[int(b.cls)],
            "conf": round(float(b.conf), 3),
            "box": [round(float(v)) for v in b.xyxy[0].tolist()],
        })
    labels = {}
    for o in objects:
        labels[o["label"]] = labels.get(o["label"], 0) + 1
    summary = ", ".join(f"{v}× {k}" for k, v in sorted(labels.items(), key=lambda x: -x[1])) or "brak wykrytych obiektów"
    return {"objects": objects, "summary": summary}


# Model sylwetki dla Tasks API – pobierany raz, przy pierwszej sylwetce.
POSE_MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
                  "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task")
_poza = None
_poza_zamek = threading.Lock()


# Pobieranie modeli – osobny zamek, nie zamek trasy: gdy model już leży na
# dysku, nikt tu nie czeka, a pobieranie nie blokuje rozpoznawania.
_modele_zamek = threading.Lock()
# Prawdziwe modele mają kilka MB (sylwetka ~5,8 MB, dłonie ~8,4 MB).
_MODEL_MIN_BAJTOW = 1_000_000


class ModelUszkodzony(Exception):
    """MediaPipe nie przyjął pliku modelu – plik skasowany, pobierze się od nowa."""


def _pobierz_model(url: str, plik: str) -> None:
    """Pobierz model do `plik` albo rzuć OSError i nie zostaw nic na dysku.

    Sprawdzamy, co przyszło, zanim plik stanie pod docelową nazwą: sieć hotelowa
    albo pośrednik potrafi oddać 200 ze stroną logowania, a taki plik
    zostawał na stałe i /dlonie padało aż do ręcznego skasowania katalogu.
    Plik .task to archiwum zip (z dwoma bajtami przed nagłówkiem, więc
    sprawdza je `zipfile.is_zipfile`, nie pierwsze bajty)."""
    import http.client
    import urllib.request
    import zipfile
    tmp = plik + ".tmp"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            dlugosc = (r.headers.get("Content-Length") or "").strip()
            with open(tmp, "wb") as f:
                while True:
                    kawalek = r.read(1 << 20)
                    if not kawalek:
                        break
                    f.write(kawalek)
        rozmiar = os.path.getsize(tmp)
        if dlugosc.isdigit() and int(dlugosc) != rozmiar:
            raise OSError(f"pobieranie przerwane ({rozmiar} z {dlugosc} bajtów)")
        if rozmiar < _MODEL_MIN_BAJTOW or not zipfile.is_zipfile(tmp):
            raise OSError("zamiast modelu przyszło coś innego (strona logowania sieci? pośrednik?)")
        os.replace(tmp, plik)
    except http.client.HTTPException as e:
        # IncompleteRead i podobne nie są OSError – trasa oddałaby 500.
        raise OSError(f"pobieranie przerwane ({type(e).__name__})") from e
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def _model_mediapipe(zmienna: str, nazwa: str, url: str) -> str:
    """Ścieżka do modelu .task: z zmiennej środowiskowej albo pobrany raz do
    ~/.cosmos/modele przy pierwszym użyciu. Nieudane pobranie = OSError."""
    wlasny = os.environ.get(zmienna)
    if wlasny:
        return wlasny
    katalog = os.path.join(os.environ.get("COSMOS_AGENT_DIR", os.path.join(os.path.expanduser("~"), ".cosmos")), "modele")
    plik = os.path.join(katalog, nazwa)
    if os.path.exists(plik):
        return plik
    with _modele_zamek:
        if not os.path.exists(plik):
            os.makedirs(katalog, exist_ok=True)
            _pobierz_model(url, plik)
    return plik


def _utworz_z_modelu(zmienna: str, plik: str, utworz):
    """`utworz()` rozpoznawacza z pliku modelu. Gdy MediaPipe pliku nie
    przyjmie, kasujemy go (tylko pobrany przez nas, nie wskazany zmienną)
    i rzucamy ModelUszkodzony – następna próba pobierze model od nowa."""
    try:
        return utworz()
    except Exception as e:
        if not os.environ.get(zmienna):
            try:
                os.remove(plik)
            except OSError:
                pass
        raise ModelUszkodzony(str(e)) from e


def _plik_modelu_pozy() -> str:
    return _model_mediapipe("POSE_MODEL", "pose_landmarker_lite.task", POSE_MODEL_URL)


def _punkty_sylwetki(rgb):
    """Punkty sylwetki (33, znormalizowane) albo None. Stare API albo Tasks."""
    global _poza
    import mediapipe as mp
    if hasattr(mp, "solutions"):
        with mp.solutions.pose.Pose(static_image_mode=True) as pose_model:
            res = pose_model.process(rgb)
        return res.pose_landmarks.landmark if res.pose_landmarks else None
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision
    # Model najpierw na dysk (bez zamka trasy), potem pod zamkiem rozpoznawacz.
    plik = _plik_modelu_pozy() if _poza is None else ""
    # PoseLandmarker nie jest bezpieczny dla wątków – jeden na proces, pod zamkiem.
    with _poza_zamek:
        if _poza is None:
            opcje = vision.PoseLandmarkerOptions(
                base_options=mp_tasks.BaseOptions(model_asset_path=plik),
                running_mode=vision.RunningMode.IMAGE, num_poses=1)
            _poza = _utworz_z_modelu("POSE_MODEL", plik,
                                     lambda: vision.PoseLandmarker.create_from_options(opcje))
        res = _poza.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    return res.pose_landmarks[0] if res.pose_landmarks else None


@app.post("/pose")
def pose(payload: dict = Body(...)):
    """{"image": dataURL} -> {"present": bool, "summary": "..."}"""
    if not CAPS["mediapipe"]:
        return JSONResponse({"error": "MediaPipe niezainstalowany (pip install mediapipe)."}, status_code=501)
    import cv2
    img = decode_image(payload)
    if img is None:
        return JSONResponse({"error": "Nie udało się odczytać obrazu."}, status_code=400)
    try:
        lm = _punkty_sylwetki(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    except OSError as e:
        return JSONResponse({"error": f"Nie udało się pobrać modelu sylwetki: {e}"}, status_code=503)
    except ModelUszkodzony:
        return JSONResponse({"error": "Model sylwetki był uszkodzony – skasowany, następna próba "
                                      "pobierze go od nowa."}, status_code=503)
    if not lm:
        return {"present": False, "summary": "nie widać sylwetki"}
    nose_y = lm[0].y
    hip_y = (lm[23].y + lm[24].y) / 2
    # `kod` dla przeglądarki (tłumaczy go przez t()), `summary` po polsku dla modelu.
    kod = "stoi" if (hip_y - nose_y) > 0.45 else "siedzi"
    posture = "stoi" if kod == "stoi" else "siedzi lub jest blisko kamery"
    return {"present": True, "kod": kod, "summary": f"widoczna sylwetka, osoba prawdopodobnie {posture}"}


# ---------------------------------------------------------------------------
# Dłonie, palce i gesty
# ---------------------------------------------------------------------------
#
# Szkielet Kinecta ma 20 stawów i dłoń jest w nim jednym punktem – model
# uczciwie odpowiadał „nie mogę określić liczby palców”. GestureRecognizer
# z MediaPipe daje 21 punktów na dłoń i gotowe gesty; palce liczymy sami
# z geometrii, bo gotowych gestów jest siedem, a palców da się pokazać
# dowolną kombinację.

GESTY_MODEL_URL = ("https://storage.googleapis.com/mediapipe-models/gesture_recognizer/"
                   "gesture_recognizer/float16/latest/gesture_recognizer.task")
GESTY = {
    "Closed_Fist": "pięść", "Open_Palm": "otwarta dłoń", "Pointing_Up": "palec wskazujący w górę",
    "Thumb_Up": "kciuk w górę", "Thumb_Down": "kciuk w dół", "Victory": "znak V",
    "ILoveYou": "znak „kocham cię” (kciuk, wskazujący i mały)",
}
PALCE = ("kciuk", "wskazujący", "środkowy", "serdeczny", "mały")
_gesty = None
_gesty_zamek = threading.Lock()


def _odl(a, b) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def palce_wyprostowane(p) -> list:
    """Które palce są wyprostowane. `p` = 21 punktów (x, y, z) w układzie
    MediaPipe (0 nadgarstek, 4 czubek kciuka, 8/12/16/20 czubki pozostałych).

    Odległości, nie kierunki: dłoń obrócona albo pokazana bokiem dalej się
    liczy, a „w górę ekranu” nie znaczy nic dla dłoni skierowanej w dół.
    Palec jest prosty, gdy czubek leży dalej od nadgarstka niż staw środkowy.
    Kciuk zgina się w inną stronę – porównujemy go z podstawą małego palca:
    schowany kciuk leży blisko niej, odstawiony daleko."""
    wynik = []
    if _odl(p[4], p[17]) > _odl(p[2], p[17]) * 1.25 and _odl(p[4], p[5]) > _odl(p[3], p[5]):
        wynik.append(PALCE[0])
    for i, (czubek, staw) in enumerate(((8, 6), (12, 10), (16, 14), (20, 18)), start=1):
        if _odl(p[0], p[czubek]) > _odl(p[0], p[staw]) * 1.1:
            wynik.append(PALCE[i])
    return wynik


def _palce_slowo(n: int) -> str:
    """1 palec, 2–4 palce, 5+ palców (i 0 palców)."""
    return "palec" if n == 1 else ("palce" if 2 <= n <= 4 else "palców")


def opis_dloni(dlonie: list) -> str:
    """Zdanie dla modelu i pod podglądem: „prawa dłoń: 2 palce (wskazujący,
    środkowy), znak V”. Pusto = nie widać dłoni."""
    czesci = []
    for d in dlonie:
        n = len(d["palce"])
        tekst = f"{d['strona']} dłoń: {n} {_palce_slowo(n)}"
        if d["palce"]:
            tekst += f" ({', '.join(d['palce'])})"
        if d.get("gest"):
            tekst += f", {d['gest']}"
        czesci.append(tekst)
    if len(dlonie) == 2:
        razem = sum(len(d["palce"]) for d in dlonie)
        czesci.append(f"razem {razem} {_palce_slowo(razem)}")
    return " · ".join(czesci)


@app.post("/dlonie")
def dlonie(payload: dict = Body(...)):
    """{"image": dataURL} -> {"dlonie": [{strona, palce, gest, punkty}], "summary": "..."}"""
    global _gesty
    if not CAPS["dlonie"]:
        return JSONResponse({"error": "Rozpoznawanie dłoni wymaga pakietu MediaPipe – w Cosmosie: Ustawienia → "
                                      "Zmysły → Pakiety zmysłów → „Sylwetka, dłonie i gesty”."}, status_code=501)
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_tasks
    from mediapipe.tasks.python import vision
    img = decode_image(payload)
    if img is None:
        return JSONResponse({"error": "Nie udało się odczytać obrazu."}, status_code=400)
    rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    try:
        # Model najpierw na dysk (bez zamka trasy), potem pod zamkiem rozpoznawacz.
        plik = _model_mediapipe("GESTY_MODEL", "gesture_recognizer.task", GESTY_MODEL_URL) if _gesty is None else ""
        with _gesty_zamek:
            if _gesty is None:
                opcje = vision.GestureRecognizerOptions(
                    base_options=mp_tasks.BaseOptions(model_asset_path=plik),
                    running_mode=vision.RunningMode.IMAGE, num_hands=2)
                _gesty = _utworz_z_modelu("GESTY_MODEL", plik,
                                          lambda: vision.GestureRecognizer.create_from_options(opcje))
            res = _gesty.recognize(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    except OSError as e:
        return JSONResponse({"error": f"Nie udało się pobrać modelu dłoni: {e}"}, status_code=503)
    except ModelUszkodzony:
        return JSONResponse({"error": "Model dłoni był uszkodzony – skasowany, następna próba "
                                      "pobierze go od nowa."}, status_code=503)
    wynik = []
    for i, punkty in enumerate(res.hand_landmarks or []):
        p = [(q.x, q.y, q.z) for q in punkty]
        # MediaPipe podaje stronę tak, jak widzi ją kamera (obraz nie jest
        # lustrem), a więc odwrotnie niż ta osoba: jej prawa dłoń to „Left”.
        strona_mp = res.handedness[i][0].category_name if res.handedness and i < len(res.handedness) else ""
        strona = {"Left": "prawa", "Right": "lewa"}.get(strona_mp, "")
        gest = ""
        if res.gestures and i < len(res.gestures) and res.gestures[i]:
            g = res.gestures[i][0]
            if g.category_name in GESTY and g.score >= 0.5:
                gest = GESTY[g.category_name]
        wynik.append({"strona": strona, "palce": palce_wyprostowane(p), "gest": gest,
                      "punkty": [[round(x, 4), round(y, 4)] for x, y, _ in p]})
    return {"dlonie": wynik, "summary": opis_dloni(wynik) or "nie widać dłoni"}


@app.post("/extract")
def extract(payload: dict = Body(...)):
    """{"name": "plik.xlsx", "data": base64} -> {"text": "..."}
    Wyciąga tekst z PDF/DOCX/XLSX/PPTX na potrzeby bazy wiedzy Cosmosa."""
    name = str(payload.get("name", ""))
    try:
        data = base64.b64decode(payload.get("data", ""))
    except Exception:
        return JSONResponse({"error": "Nieprawidłowe dane base64."}, status_code=400)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""

    # NAJPIERW MOCNIEJSZY CZYTNIK, jeśli jest zainstalowany.
    #
    # Z trendów: firecrawl/anydoc (97 formatów → Markdown) i doc7. Oba są
    # lepsze od czterech gałęzi niżej, ale anydoc to Rust z wiązaniami Node –
    # w rdzeniu Cosmosa złamałby zasadę zera zależności. Tutaj, w Pythonie,
    # wolno mieć prawdziwe biblioteki, więc bierzemy odpowiedniki z tego
    # samego świata: docling (IBM) albo markitdown (Microsoft).
    #
    # Różnica jest realna i widać ją na dwóch rzeczach, na których pypdf
    # przegrywa zawsze:
    #   • SKANY – docling ma OCR, pypdf oddaje pustą stronę bez słowa;
    #   • UKŁAD – tabela w PDF-ie to dla pypdf ciąg luźnych liczb, a dla
    #     doclinga tabela Markdown, którą model faktycznie przeczyta.
    #
    # Rozłożenie na kolumny w umowie działa tak samo: pypdf skleja dwie
    # kolumny w jedno zdanie bez sensu.
    lepszy = _extract_docling(name, data, ext)
    if lepszy:
        return {"text": lepszy[:200000], "czytnik": CAPS_CZYTNIK}

    try:
        if ext == "pdf":
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((page.extract_text() or "") for page in reader.pages)
        elif ext == "docx":
            import docx
            document = docx.Document(io.BytesIO(data))
            parts = [p.text for p in document.paragraphs]
            for table in document.tables:
                for row in table.rows:
                    parts.append(" | ".join(c.text for c in row.cells))
            text = "\n".join(parts)
        elif ext in ("xlsx", "xlsm"):
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
            lines = []
            for ws in wb.worksheets:
                lines.append(f"## Arkusz: {ws.title}")
                for row in ws.iter_rows(values_only=True):
                    cells = [str(c) for c in row if c is not None]
                    if cells:
                        lines.append(" | ".join(cells))
                    if len(lines) > 8000:
                        break
            text = "\n".join(lines)
        elif ext == "pptx":
            from pptx import Presentation
            pres = Presentation(io.BytesIO(data))
            parts = []
            for i, slide in enumerate(pres.slides, 1):
                parts.append(f"## Slajd {i}")
                for shape in slide.shapes:
                    if getattr(shape, "text", ""):
                        parts.append(shape.text)
            text = "\n".join(parts)
        else:
            text = data.decode("utf-8", errors="ignore")
        return {"text": text[:200000]}
    except ImportError as e:
        return JSONResponse(
            {"error": f"Brak biblioteki do formatu .{ext} – pip install {e.name}"},
            status_code=501,
        )
    except Exception as e:
        return JSONResponse({"error": f"Błąd ekstrakcji: {e}"}, status_code=400)


@app.post("/upscale")
def upscale(payload: dict = Body(...)):
    """{"image": dataURL, "scale": 4} -> {"image": dataURL} – powiększanie Real-ESRGAN.
    Opcjonalne: pip install realesrgan basicsr  (wymaga GPU dla sensownej szybkości)."""
    try:
        from realesrgan import RealESRGANer  # noqa: F401
        from basicsr.archs.rrdbnet_arch import RRDBNet
    except ImportError:
        return JSONResponse(
            {"error": "Upscale niedostępny – pip install realesrgan basicsr (senses/README.md)."},
            status_code=501,
        )
    import cv2
    import numpy as np
    img = decode_image(payload)
    if img is None:
        return JSONResponse({"error": "Nieprawidłowy obraz."}, status_code=400)
    scale = int(payload.get("scale", 4))
    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
    up = RealESRGANer(scale=4, model_path=os.environ.get("REALESRGAN_MODEL", "RealESRGAN_x4plus.pth"), model=model)
    out, _ = up.enhance(img, outscale=scale)
    ok, buf = cv2.imencode(".png", out)
    b64 = base64.b64encode(buf.tobytes()).decode()
    return {"image": f"data:image/png;base64,{b64}"}


# ---------------------------------------------------------------------------
# Kinect 360 – klatki po HTTP
# ---------------------------------------------------------------------------
#
# Przeglądarka nie widzi Kinecta (nie jest kamerą UVC), więc podgląd w Cosmosie
# nie może użyć getUserMedia. Zamiast tego serwujemy pojedyncze klatki JPEG,
# a interfejs odświeża je jak zwykły obrazek.

# Jedyny właściciel czujnika na tym komputerze. Kinect for Windows SDK 1.8
# oddaje czujnik jednemu procesowi (NuiInitialize w drugim kończy się
# „urządzenie w użyciu”), więc obserwator kamery i zmysł głębi, gdy działa ta
# usługa, biorą obraz, głębię i sylwetki stąd (/kinect/frame, /kinect/depth,
# /kinect/sylwetki), zamiast otwierać czujnik samemu i zabierać go podglądowi.

_kinect = None
_kinect_err = ""
# Odczyty z SDK nie są bezpieczne dla wątków, a trasy biegną w puli wątków.
_kinect_zamek = threading.Lock()


class KinectZajety(RuntimeError):
    """Czujnik zajęty dłużej niż 2 s – inna trasa wisi na nim (np. otwieranie)."""


class _ZamekKinecta:
    """`with _zamek_kinecta:` – jak zamek, ale czeka najwyżej 2 s. Zawieszone
    otwarcie czujnika pod zwykłym zamkiem zbierało za sobą wszystkie wątki
    usługi: 40 tras czekało, /dlonie i /stt przestawały odpowiadać, a SIGTERM
    nie kończył procesu (zespół IT, runda 7)."""
    def __enter__(self):
        if not _kinect_zamek.acquire(timeout=2):
            raise KinectZajety("czujnik zajęty – spróbuj za chwilę")
        return self

    def __exit__(self, *a):
        _kinect_zamek.release()
        return False


_zamek_kinecta = _ZamekKinecta()


def get_kinect():
    """Jedna instancja czujnika na cały proces – Kinect nie znosi dwóch naraz."""
    global _kinect, _kinect_err
    with _zamek_kinecta:
        if _kinect is None:
            import kinect_win
            k = kinect_win.Kinect(color=True, depth=True, skeleton=True)
            k.open()
            _kinect = k
            _kinect_err = ""
        return _kinect


def _zwolnij_kinect(e, k):
    """Czujnik mógł zostać odłączony – następne żądanie spróbuje otworzyć od nowa.

    `k` to czujnik, na którym był błąd. Zamykamy go tylko, gdy nadal jest
    bieżący: trzy trasy naraz (podgląd, obserwator, zmysł głębi) po chwilowym
    błędzie zamykały sobie nawzajem świeżo otwarte czujniki."""
    global _kinect, _kinect_err
    _kinect_err = str(e)
    if isinstance(e, KinectZajety):
        return                       # zajęty to nie zepsuty – czujnika nie zamykamy
    with _kinect_zamek:
        if _kinect is not k or k is None:
            return
        try:
            k.close()
        except Exception:
            pass
        _kinect = None


# Komunikaty bez słowa „Kinect”: przeglądarka dokleja przed nimi
# „Brak obrazu z Kinecta:”. `kod` – dla programów, które chcą rozpoznać błąd.
def _blad_kinecta(tekst: str, kod: str, status: int = 503):
    return JSONResponse({"error": tekst, "kod": kod}, status_code=status)


def _niedostepny(e):
    global _kinect_err
    _kinect_err = str(e)
    return _blad_kinecta(f"czujnik niedostępny ({e})", "kinect-niedostepny")


def _blad_odczytu(e, k):
    if isinstance(e, KinectZajety):
        return _blad_kinecta(str(e), "kinect-zajety")
    _zwolnij_kinect(e, k)
    return _blad_kinecta(f"błąd odczytu z czujnika ({e})", "kinect-blad-odczytu")


def _to_jpeg(img, quality: int = 80) -> bytes:
    import cv2
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("Nie udało się zakodować JPEG.")
    return buf.tobytes()


@app.get("/kinect/status")
def kinect_status():
    """Czy czujnik jest dostępny i co potrafi."""
    try:
        import kinect_win
    except Exception as e:
        return {"available": False, "reason": f"brak modułu kinect_win: {e}"}
    n = kinect_win.sensor_count()
    if n <= 0:
        return {"available": False, "reason": "nie widzę czujnika (zasilacz? sterownik SDK 1.8?)"}
    return {"available": True, "sensors": n, "streams": ["color", "depth"], "error": _kinect_err}


def _render(k, stream: str):
    """Klatka gotowa do zakodowania: obraz BGR albo pokolorowana mapa głębi.

    Głębia to milimetry – dla oka mapujemy zasięg 0,5–4 m na paletę. Zera, czyli
    „nie wiem" (cień podczerwieni, szkło, poza zasięgiem), zostają czarne, żeby
    nie udawały pomiaru, którego nie ma.
    """
    if stream == "depth":
        import cv2
        import numpy as np
        with _zamek_kinecta:
            frame = k.depth_frame()
        if frame is None:
            return None
        vis = np.clip((frame.astype(np.float32) - 500) / (4000 - 500), 0, 1)
        vis = (vis * 255).astype(np.uint8)
        vis = cv2.applyColorMap(vis, cv2.COLORMAP_TURBO)
        vis[frame == 0] = 0
        return vis
    with _zamek_kinecta:
        return k.color_frame()


@app.get("/kinect/stream")
def kinect_stream(stream: str = "color", fps: int = 15, quality: int = 70):
    """Ciągły strumień MJPEG.

    Pojedyncze klatki przez /kinect/frame znaczą jedno żądanie HTTP na klatkę.
    Przy drodze telefon → VPS → Tailscale → komputer domowy sam obieg zjada
    ćwierć sekundy, więc podgląd klatkuje niezależnie od tego, jak szybki jest
    czujnik. Tutaj połączenie jest jedno, a klatki lecą w nim jedna za drugą –
    przeglądarka odtwarza to natywnie w zwykłym <img>.
    """
    try:
        k = get_kinect()
    except Exception as e:
        return _niedostepny(e)
    try:
        import cv2  # noqa: F401
    except ImportError:
        return JSONResponse({"error": "Strumień wymaga: pip install opencv-python"},
                            status_code=501)

    delay = 1.0 / max(1, min(30, fps))
    q = max(20, min(95, quality))

    def frames():
        import time as _t
        while True:
            start = _t.time()
            try:
                img = _render(k, stream)
            except Exception:
                break                       # czujnik zniknął – zamknij strumień
            if img is not None:
                jpg = _to_jpeg(img, q)
                yield (b"--frame\r\nContent-Type: image/jpeg\r\n"
                       b"Content-Length: " + str(len(jpg)).encode() + b"\r\n\r\n"
                       + jpg + b"\r\n")
            left = delay - (_t.time() - start)
            if left > 0:
                _t.sleep(left)

    return StreamingResponse(frames(),
                             media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-store"})


@app.get("/kinect/frame")
def kinect_frame(stream: str = "color", quality: int = 80):
    """Pojedyncza klatka jako JPEG. `stream` = color albo depth."""
    try:
        k = get_kinect()
    except Exception as e:
        return _niedostepny(e)
    try:
        img = _render(k, stream)
        if img is None:
            return _blad_kinecta("czujnik nie podał klatki", "kinect-brak-klatki")
        return Response(content=_to_jpeg(img, max(20, min(95, quality))), media_type="image/jpeg",
                        headers={"Cache-Control": "no-store"})
    except ImportError:
        return JSONResponse({"error": "Podgląd wymaga: pip install opencv-python"},
                            status_code=501)
    except Exception as e:
        return _blad_odczytu(e, k)


@app.get("/kinect/depth")
def kinect_depth():
    """Surowa głębia w milimetrach: uint16 little-endian, wymiary w nagłówkach
    X-Szerokosc i X-Wysokosc. Dla zmysłu głębi (kinect_watcher.py)."""
    try:
        k = get_kinect()
    except Exception as e:
        return _niedostepny(e)
    try:
        import numpy as np
        with _zamek_kinecta:
            frame = k.depth_frame()
        if frame is None:
            return _blad_kinecta("czujnik nie podał klatki głębi", "kinect-brak-klatki")
        h, w = frame.shape[:2]
        return Response(content=frame.astype("<u2").tobytes(), media_type="application/octet-stream",
                        headers={"X-Szerokosc": str(w), "X-Wysokosc": str(h), "Cache-Control": "no-store"})
    except Exception as e:
        return _blad_odczytu(e, k)


@app.get("/kinect/sylwetki")
def kinect_sylwetki():
    """Śledzone sylwetki: {"sylwetki": [{id, stawy, opis}]}."""
    try:
        k = get_kinect()
    except Exception as e:
        return _niedostepny(e)
    try:
        with _zamek_kinecta:
            osoby = k.skeletons(timeout_ms=50)
        return {"sylwetki": osoby}
    except Exception as e:
        return _blad_odczytu(e, k)


@app.post("/embed")
def embed(payload: dict = Body(...)):
    """{"texts": ["...", ...]} -> {"vectors": [[...], ...]} (pamięć długotrwała)"""
    if not CAPS["embed"]:
        return JSONResponse({"error": "Embeddingi niedostępne (pip install sentence-transformers)."}, status_code=501)
    texts = payload.get("texts") or []
    if not isinstance(texts, list) or not texts:
        return JSONResponse({"error": "Pole texts (lista) jest wymagane."}, status_code=400)
    vectors = get_embedder().encode([str(t)[:4000] for t in texts], normalize_embeddings=True)
    # Nazwa modelu: Cosmos nie może mieszać wektorów dwóch różnych modeli
    # o tym samym wymiarze (komputer domowy i komputer osoby).
    return {"vectors": [v.tolist() for v in vectors], "model": os.environ.get("EMBED_MODEL", "BAAI/bge-m3")}


def _rozgrzej_whispera():
    """Załaduj Whispera od razu po starcie, w tle. Leniwe ładowanie przy
    pierwszym „Hej, Cosmos” kosztowało kilka do kilkunastu sekund – akurat
    wtedy, gdy ktoś czeka na odpowiedź."""
    try:
        model = get_whisper()
        # Samo załadowanie nie liczy nic na karcie – brak bibliotek CUDA
        # (cuBLAS) wychodził dopiero przy pierwszym „Hej, Cosmos”. Sekunda
        # ciszy przez cały model wykrywa to od razu i przechodzi na procesor.
        try:
            import numpy as np
            list(model.transcribe(np.zeros(16000, dtype=np.float32), language="pl", beam_size=1,
                                  vad_filter=False, temperature=0.0)[0])
        except Exception as e:
            if not _is_cuda_runtime_error(e):
                raise
            print(f"  ⚠ Whisper: brak bibliotek CUDA ({e}). Przechodzę na procesor.", flush=True)
            whisper_to_cpu()
        print("  ✓ Whisper załadowany", flush=True)
    except Exception as e:
        print(f"  ⚠ Whisper nie wstał przy starcie: {e}", flush=True)


if __name__ == "__main__":
    port = int(os.environ.get("SENSES_PORT", 7060))
    if CAPS["whisper"] and os.environ.get("WHISPER_ROZGRZEJ", "1") != "0":
        threading.Thread(target=_rozgrzej_whispera, daemon=True).start()
    if CAPS["birdnet"] and os.environ.get("BIRDNET_ROZGRZEJ", "1") != "0":
        threading.Thread(target=_rozgrzej_birdnet, daemon=True).start()
    active =", ".join(k for k, v in CAPS.items() if v) or "brak (zainstaluj zależności)"
    print(f"\n  ✦ Cosmos Senses – port {port}\n  → aktywne zmysły: {active}\n")
    # Agent zmysłów ustawia SENSES_HOST=127.0.0.1: zlecenia przychodzą przez niego,
    # więc usługa nie musi być widoczna w sieci lokalnej. Na serwerze (ptaki) –
    # obowiązkowo 127.0.0.1, patrz scripts/instaluj-ptaki.sh.
    # Bez logu dostępu: adres /ptak?lat=…&lon=… to pozycja osoby, a log trafia
    # do dziennika systemu (journald) na długo.
    uvicorn.run(app, host=os.environ.get("SENSES_HOST", "0.0.0.0"), port=port, log_level="warning",
                access_log=False)

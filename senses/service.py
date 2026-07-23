#!/usr/bin/env python3
"""
Cosmos Senses — usługa percepcji (zmysły Cosmosa).

Każdy zmysł jest OPCJONALNY: usługa startuje z tym, co masz zainstalowane,
a /health mówi Cosmosowi, które zmysły są dostępne.

    słuch    /stt     Whisper (faster-whisper)     pip install faster-whisper
    głos     /tts     Piper                        pip install piper-tts
    wzrok    /detect  YOLO (ultralytics)           pip install ultralytics
    ciało    /pose    MediaPipe (sylwetka/gesty)   pip install mediapipe

Uruchomienie:
    pip install fastapi uvicorn python-multipart
    python senses/service.py            # port 7060

Konfiguracja przez zmienne środowiskowe:
    SENSES_PORT      port usługi (domyślnie 7060)
    WHISPER_MODEL    small | base | medium | large-v3   (domyślnie small)
    WHISPER_DEVICE   cuda | cpu                          (domyślnie auto)
    PIPER_VOICE      ścieżka do głosu .onnx, np. pl_PL-darkman-medium.onnx
    YOLO_MODEL       domyślnie yolo11n.pt (pobiera się automatycznie)
"""

import base64
import io
import os
import tempfile

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
import uvicorn

app = FastAPI(title="Cosmos Senses")

# ---------------------------------------------------------------------------
# Wykrywanie dostępnych zmysłów (leniwa inicjalizacja modeli)
# ---------------------------------------------------------------------------

CAPS = {"whisper": False, "piper": False, "yolo": False, "mediapipe": False, "embed": False}

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
    import mediapipe  # noqa: F401
    CAPS["mediapipe"] = True
except ImportError:
    pass

try:
    import sentence_transformers  # noqa: F401
    CAPS["embed"] = True
except ImportError:
    pass

_whisper_model = None
_piper_voice = None
_yolo_model = None
_embed_model = None


def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        name = os.environ.get("WHISPER_MODEL", "small")
        device = os.environ.get("WHISPER_DEVICE", "auto")
        compute = "float16" if device != "cpu" else "int8"
        try:
            _whisper_model = WhisperModel(name, device=device, compute_type=compute)
        except Exception:
            _whisper_model = WhisperModel(name, device="cpu", compute_type="int8")
    return _whisper_model


def get_piper():
    global _piper_voice
    if _piper_voice is None:
        from piper import PiperVoice
        _piper_voice = PiperVoice.load(os.environ["PIPER_VOICE"])
    return _piper_voice


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
# Endpointy
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return CAPS


@app.post("/stt")
async def stt(request: Request):
    """Audio (webm/ogg/wav/mp3) w body -> {"text": "..."}"""
    if not CAPS["whisper"]:
        return JSONResponse({"error": "Whisper niezainstalowany (pip install faster-whisper)."}, status_code=501)
    audio = await request.body()
    suffix = ".webm"
    ctype = request.headers.get("content-type", "")
    for ext in ("wav", "ogg", "mp3", "mp4", "m4a"):
        if ext in ctype:
            suffix = "." + ext
            break
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
        f.write(audio)
        tmp = f.name
    try:
        segments, info = get_whisper().transcribe(tmp, language=os.environ.get("WHISPER_LANG") or None, vad_filter=True)
        text = " ".join(s.text.strip() for s in segments).strip()
        return {"text": text, "language": info.language}
    finally:
        os.unlink(tmp)


@app.post("/tts")
async def tts(request: Request):
    """{"text": "..."} -> audio/wav"""
    if not CAPS["piper"]:
        return JSONResponse(
            {"error": "Piper niedostępny (pip install piper-tts + ustaw PIPER_VOICE na plik głosu .onnx)."},
            status_code=501,
        )
    payload = await request.json()
    text = (payload.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "Puste pole text."}, status_code=400)
    import wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        get_piper().synthesize(text, wav_file)
    return Response(content=buf.getvalue(), media_type="audio/wav")


@app.post("/detect")
async def detect(request: Request):
    """{"image": dataURL} -> {"objects": [{label, conf, box}], "summary": "..."}"""
    if not CAPS["yolo"]:
        return JSONResponse({"error": "YOLO niezainstalowany (pip install ultralytics)."}, status_code=501)
    payload = await request.json()
    img = decode_image(payload)
    if img is None:
        return JSONResponse({"error": "Nie udało się zdekodować obrazu."}, status_code=400)
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


@app.post("/pose")
async def pose(request: Request):
    """{"image": dataURL} -> {"present": bool, "summary": "..."}"""
    if not CAPS["mediapipe"]:
        return JSONResponse({"error": "MediaPipe niezainstalowany (pip install mediapipe)."}, status_code=501)
    import cv2
    import mediapipe as mp
    payload = await request.json()
    img = decode_image(payload)
    if img is None:
        return JSONResponse({"error": "Nie udało się zdekodować obrazu."}, status_code=400)
    with mp.solutions.pose.Pose(static_image_mode=True) as pose_model:
        res = pose_model.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    if not res.pose_landmarks:
        return {"present": False, "summary": "nie widać sylwetki"}
    lm = res.pose_landmarks.landmark
    nose_y = lm[0].y
    hip_y = (lm[23].y + lm[24].y) / 2
    posture = "stoi" if (hip_y - nose_y) > 0.45 else "siedzi lub jest blisko kamery"
    return {"present": True, "summary": f"widoczna sylwetka, osoba prawdopodobnie {posture}"}


@app.post("/extract")
async def extract(request: Request):
    """{"name": "plik.xlsx", "data": base64} -> {"text": "..."}
    Wyciąga tekst z PDF/DOCX/XLSX/PPTX na potrzeby bazy wiedzy Cosmosa."""
    payload = await request.json()
    name = str(payload.get("name", ""))
    try:
        data = base64.b64decode(payload.get("data", ""))
    except Exception:
        return JSONResponse({"error": "Nieprawidłowe dane base64."}, status_code=400)
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""

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
            {"error": f"Brak biblioteki do formatu .{ext} — pip install {e.name}"},
            status_code=501,
        )
    except Exception as e:
        return JSONResponse({"error": f"Błąd ekstrakcji: {e}"}, status_code=400)


@app.post("/embed")
async def embed(request: Request):
    """{"texts": ["...", ...]} -> {"vectors": [[...], ...]} (pamięć długotrwała)"""
    if not CAPS["embed"]:
        return JSONResponse({"error": "Embeddingi niedostępne (pip install sentence-transformers)."}, status_code=501)
    payload = await request.json()
    texts = payload.get("texts") or []
    if not isinstance(texts, list) or not texts:
        return JSONResponse({"error": "Pole texts (lista) jest wymagane."}, status_code=400)
    vectors = get_embedder().encode([str(t)[:4000] for t in texts], normalize_embeddings=True)
    return {"vectors": [v.tolist() for v in vectors]}


if __name__ == "__main__":
    port = int(os.environ.get("SENSES_PORT", 7060))
    active = ", ".join(k for k, v in CAPS.items() if v) or "brak (zainstaluj zależności)"
    print(f"\n  ✦ Cosmos Senses — port {port}\n  → aktywne zmysły: {active}\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")

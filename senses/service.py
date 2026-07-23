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

CAPS = {"whisper": False, "piper": False, "yolo": False, "mediapipe": False}

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

_whisper_model = None
_piper_voice = None
_yolo_model = None


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


if __name__ == "__main__":
    port = int(os.environ.get("SENSES_PORT", 7060))
    active = ", ".join(k for k, v in CAPS.items() if v) or "brak (zainstaluj zależności)"
    print(f"\n  ✦ Cosmos Senses — port {port}\n  → aktywne zmysły: {active}\n")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")

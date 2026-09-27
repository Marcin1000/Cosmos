"""Atrapa dla zestawu dlonie-i-slowo-budzace: service.py pod FastAPI TestClient.

Udaje OpenCV, MediaPipe (GestureRecognizer podaje dłonie o znanym kształcie)
i faster-whisper (zapisuje, z jakimi opcjami go wołano). Wypisuje jeden
wiersz JSON z tym, co zobaczył. Argument: katalog senses/.
"""
import json
import os
import sys
import types

import numpy as np

cv2 = types.ModuleType("cv2")
cv2.IMREAD_COLOR = 1
cv2.COLOR_BGR2RGB = 1
cv2.imdecode = lambda arr, f: np.zeros((4, 4, 3), dtype=np.uint8)
cv2.cvtColor = lambda img, c: img
sys.modules["cv2"] = cv2

P = types.SimpleNamespace


def dlon(palce, kciuk):
    """21 punktów dłoni skierowanej palcami w górę kadru. `palce` = które
    z czterech (wskazujący..mały) są wyprostowane, `kciuk` = czy odstawiony."""
    p = [(0.5, 0.9, 0.0)] * 21
    p[1] = (0.42, 0.85, 0.0)
    p[2] = (0.36, 0.80, 0.0)
    p[3] = (0.31, 0.75, 0.0)
    p[4] = (0.25, 0.70, 0.0) if kciuk else (0.45, 0.72, 0.0)
    for i in range(4):
        x = 0.42 + 0.05 * i
        mcp, pip, dip, tip = 5 + 4 * i, 6 + 4 * i, 7 + 4 * i, 8 + 4 * i
        p[mcp] = (x, 0.70, 0.0)
        p[pip] = (x, 0.60, 0.0)
        if palce[i]:
            p[dip], p[tip] = (x, 0.53, 0.0), (x, 0.47, 0.0)
        else:
            p[dip], p[tip] = (x, 0.68, 0.0), (x, 0.72, 0.0)
    return [P(x=x, y=y, z=z) for x, y, z in p]


SCENY = {
    "piesc": [(dlon([0, 0, 0, 0], False), "Left", "Closed_Fist")],
    "v": [(dlon([1, 1, 0, 0], False), "Left", "Victory")],
    "trzy": [(dlon([1, 1, 1, 0], False), "Left", "None")],
    "otwarta": [(dlon([1, 1, 1, 1], True), "Left", "Open_Palm")],
    "kciuk": [(dlon([0, 0, 0, 0], True), "Left", "Thumb_Up")],
    "dwie": [(dlon([1, 1, 1, 1], True), "Left", "Open_Palm"), (dlon([1, 1, 0, 0], False), "Right", "Victory")],
    "dwieTrzy": [(dlon([1, 1, 0, 0], False), "Left", "Victory"), (dlon([1, 0, 0, 0], False), "Right", "Pointing_Up")],
    "pusto": [],
}
stan = {"scena": "pusto"}

mp = types.ModuleType("mediapipe")
tasks = types.ModuleType("mediapipe.tasks")
tpy = types.ModuleType("mediapipe.tasks.python")
vision = types.ModuleType("mediapipe.tasks.python.vision")
mp.tasks, tasks.python, tpy.vision = tasks, tpy, vision
tpy.BaseOptions = lambda model_asset_path: P(sciezka=model_asset_path)
vision.RunningMode = P(IMAGE="IMAGE")
vision.GestureRecognizerOptions = lambda **k: P(**k)
vision.PoseLandmarkerOptions = lambda **k: P(**k)


class GR:
    @staticmethod
    def create_from_options(o):
        return GR()

    def recognize(self, img):
        sc = SCENY[stan["scena"]]
        return P(hand_landmarks=[d for d, _, _ in sc],
                 handedness=[[P(category_name=h)] for _, h, _ in sc],
                 gestures=[[P(category_name=g, score=0.9)] for _, _, g in sc])


vision.GestureRecognizer = GR
mp.Image = lambda image_format, data: data
mp.ImageFormat = P(SRGB=1)
for n, m in {"mediapipe": mp, "mediapipe.tasks": tasks, "mediapipe.tasks.python": tpy,
             "mediapipe.tasks.python.vision": vision}.items():
    sys.modules[n] = m

wolania = []
fw = types.ModuleType("faster_whisper")


class WhisperModel:
    def __init__(self, *a, **k):
        pass

    def transcribe(self, plik, **opcje):
        wolania.append(opcje)
        return iter([P(text="Hej, Kosmos")]), P(language=opcje.get("language") or "pl")


fw.WhisperModel = WhisperModel
sys.modules["faster_whisper"] = fw

sys.path.insert(0, sys.argv[1])
os.environ["GESTY_MODEL"] = "/atrapa/gesture_recognizer.task"
import service  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

c = TestClient(service.app)
w = {"caps": {k: service.CAPS.get(k) for k in ("dlonie", "whisper")}, "sceny": {}}
for nazwa in SCENY:
    stan["scena"] = nazwa
    r = c.post("/dlonie", json={"image": "data:image/jpeg;base64,AAAA"})
    d = r.json()
    w["sceny"][nazwa] = {"status": r.status_code, "summary": d.get("summary"),
                         "dlonie": [{k: v for k, v in x.items() if k != "punkty"} for x in d.get("dlonie", [])],
                         "punktow": [len(x.get("punkty", [])) for x in d.get("dlonie", [])]}
for tryb in ("nasluch", "pytanie"):
    c.post(f"/stt?tryb={tryb}&jezyk=pl", content=b"RIFF0000", headers={"content-type": "audio/wav"})
w["stt"] = wolania
print(json.dumps(w, ensure_ascii=False))

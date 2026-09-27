"""Atrapa dla zestawu kinect-jeden-wlasciciel: service.py pod FastAPI TestClient,
z udawanym Kinectem (kinect_win), OpenCV i mediapipe >= 0.10.30 (tylko Tasks API).
Wypisuje jeden wiersz JSON z tym, co zobaczył. Argument: katalog senses/."""
import sys, types, os, json, threading, time
import numpy as np
cv2 = types.ModuleType("cv2")
cv2.IMREAD_COLOR = 1; cv2.IMWRITE_JPEG_QUALITY = 1; cv2.COLORMAP_TURBO = 1; cv2.COLOR_BGR2RGB = 1
cv2.imencode = lambda ext, img, *a: (True, np.frombuffer(b"\xff\xd8JPG", dtype=np.uint8))
cv2.imdecode = lambda arr, f: np.zeros((4, 4, 3), dtype=np.uint8)
cv2.cvtColor = lambda img, c: img
cv2.applyColorMap = lambda v, c: np.stack([v, v, v], -1)
sys.modules["cv2"] = cv2
otwarcia = []
naraz = {"teraz": 0, "max": 0}
class Kinect:
    def __init__(self, **k): otwarcia.append(k)
    def open(self): return self
    def close(self): pass
    def _odczyt(self, wynik):
        naraz["teraz"] += 1; naraz["max"] = max(naraz["max"], naraz["teraz"])
        time.sleep(0.02); naraz["teraz"] -= 1
        return wynik
    def color_frame(self, timeout_ms=1000): return self._odczyt(np.zeros((48, 64, 3), dtype=np.uint8))
    def depth_frame(self, timeout_ms=1000): return self._odczyt(np.arange(12, dtype=np.uint16).reshape(3, 4) + 1000)
    def skeletons(self, timeout_ms=1000): return self._odczyt([{"id": 5, "stawy": {"glowa": [0.0, 1.0, 2.0]}, "opis": {"postawa": "stoi"}}])
kw = types.ModuleType("kinect_win"); kw.Kinect = Kinect; kw.sensor_count = lambda: 1
sys.modules["kinect_win"] = kw
# mediapipe >= 0.10.30: bez solutions, tylko Tasks API
mp = types.ModuleType("mediapipe"); tasks = types.ModuleType("mediapipe.tasks")
tpy = types.ModuleType("mediapipe.tasks.python"); vision = types.ModuleType("mediapipe.tasks.python.vision")
mp.tasks = tasks; tasks.python = tpy; tpy.vision = vision
modele = []
class BaseOptions:
    def __init__(self, model_asset_path): modele.append(model_asset_path)
tpy.BaseOptions = BaseOptions
class PLO:
    def __init__(self, **k): self.k = k
vision.PoseLandmarkerOptions = PLO
vision.RunningMode = types.SimpleNamespace(IMAGE="IMAGE")
P = types.SimpleNamespace
class PL:
    @staticmethod
    def create_from_options(o): return PL()
    def detect(self, img):
        pts = [P(y=0.1) for _ in range(33)]; pts[23] = P(y=0.8); pts[24] = P(y=0.8)
        return P(pose_landmarks=[pts])
vision.PoseLandmarker = PL
mp.Image = lambda image_format, data: data
mp.ImageFormat = P(SRGB=1)
for n, m in {"mediapipe": mp, "mediapipe.tasks": tasks, "mediapipe.tasks.python": tpy, "mediapipe.tasks.python.vision": vision}.items():
    sys.modules[n] = m
sys.path.insert(0, sys.argv[1])
os.environ["POSE_MODEL"] = "/atrapa/pose_landmarker_lite.task"
import service
from fastapi.testclient import TestClient
c = TestClient(service.app)
w = {}
w["caps_ciało"] = service.CAPS["mediapipe"]
r = c.get("/kinect/depth")
w["glebia"] = [r.status_code, r.headers.get("x-szerokosc"), r.headers.get("x-wysokosc"),
               int(np.frombuffer(r.content, dtype="<u2")[11]) if r.status_code == 200 else None]
w["sylwetki"] = c.get("/kinect/sylwetki").json()
w["klatka"] = [c.get("/kinect/frame?stream=color").status_code, c.get("/kinect/frame?stream=depth").status_code]
# Wiele żądań naraz (podgląd + obserwator + zmysł głębi): jeden czujnik, odczyty po kolei.
ws = [threading.Thread(target=lambda s=s: c.get(s)) for s in ["/kinect/frame", "/kinect/depth", "/kinect/sylwetki"] * 4]
[t.start() for t in ws]; [t.join() for t in ws]
w["otwarcia"] = len(otwarcia); w["naraz_max"] = naraz["max"]
p = c.post("/pose", json={"image": "data:image/jpeg;base64,AAAA"})
w["poza"] = [p.status_code, p.json().get("summary", p.json().get("error"))]
w["model"] = modele
print(json.dumps(w, ensure_ascii=False))

#!/usr/bin/env python3
"""
Cosmos Watcher – ciągła percepcja otoczenia.

Obserwuje kamerę, wykrywa obiekty YOLO i wysyła do Cosmosa TYLKO ZMIANY
(pojawiło się / zniknęło). Źródłem obrazu może być zwykła kamera przez OpenCV
albo Kinect 360 – ten drugi nie jest kamerą UVC, więc obraz bierzemy z SDK
(CAMERA_SOURCE=kinect).
Cosmos dokleja te zdarzenia do kontekstu rozmowy – dzięki temu Nemotron
„wie”, co dzieje się w pokoju, zanim o cokolwiek zapytasz.

Uruchomienie (wymaga: pip install ultralytics opencv-python requests):
    python senses/watcher.py

Zmienne środowiskowe:
    COSMOS_URL      adres Cosmosa (domyślnie http://localhost:3000)
    COSMOS_TOKEN    COSMOS_API_TOKEN serwera – wymagany, gdy Cosmos ma hasło
    CAMERA_SOURCE   auto (domyślnie: zwykła kamera, a bez niej Kinect) | cv | kinect
    CAMERA_INDEX    numer kamery OpenCV (domyślnie 0)
    WATCH_INTERVAL  sekundy między analizami (domyślnie 5)
    YOLO_MODEL      domyślnie yolo11n.pt
"""

import os
import time

import cv2
import requests
from ultralytics import YOLO

COSMOS_URL = os.environ.get("COSMOS_URL", "http://localhost:3000").rstrip("/")
COSMOS_TOKEN = os.environ.get("COSMOS_TOKEN", "")
CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", 0))
INTERVAL = float(os.environ.get("WATCH_INTERVAL", 5))
CONF_MIN = 0.45


def _auth() -> dict:
    """Nagłówek logowania. Wymagany, gdy serwer ma ustawione COSMOS_API_TOKEN
    (czyli zawsze na VPS). Bez niego /api/events odpowiada 401."""
    return {"Authorization": f"Bearer {COSMOS_TOKEN}"} if COSMOS_TOKEN else {}


def send_event(summary: str, type_: str = "kamera") -> None:
    try:
        requests.post(f"{COSMOS_URL}/api/events", headers=_auth(),
                      json={"type": type_, "summary": summary}, timeout=5)
        print(f"→ {summary}")
    except requests.RequestException as e:
        print(f"! nie wysłano zdarzenia: {e}")


class BrakKamery(RuntimeError):
    """Zwykła kamera się nie otworzyła – przy CAMERA_SOURCE=auto próbujemy Kinecta."""


class CvCamera:
    """Zwykła kamera przez OpenCV (webcam, telefon, aparat jako webcam)."""

    def __init__(self, index: int):
        self._cap = cv2.VideoCapture(index)
        if not self._cap.isOpened():
            self._cap.release()
            raise BrakKamery(
                f"Nie mogę otworzyć kamery {index}.\n"
                "Sprawdź, co widzi system:\n"
                '  python -c "import cv2; print([i for i in range(6) '
                'if cv2.VideoCapture(i).isOpened()])"\n'
                "Pusta lista = brak zwykłej kamery. Kinect nie jest kamerą UVC – jego obraz\n"
                "bierzemy z SDK, ale tylko gdy czujnik jest podłączony (z zasilaczem)."
            )
        self.name = f"kamera {index}"

    def read(self):
        ok, frame = self._cap.read()
        return frame if ok else None

    def close(self):
        self._cap.release()


class KinectCamera:
    """Obraz RGB z Kinecta 360 przez Kinect for Windows SDK 1.8.

    Kinect nie jest kamerą UVC, więc OpenCV go nie zobaczy – ale SDK oddaje
    ten sam obraz 640×480, tylko inną drogą. Dla YOLO to bez różnicy.
    """

    def __init__(self):
        import kinect_win
        self._k = kinect_win.Kinect(color=True, depth=False, skeleton=False)
        self._k.open()
        self.name = "Kinect 360 (RGB przez SDK 1.8)"

    def read(self):
        return self._k.color_frame()

    def close(self):
        self._k.close()


def open_kinect():
    """Kinect z usługi zmysłów, gdy ona go trzyma; bez niej – wprost z SDK."""
    import kinect_usluga
    if kinect_usluga.przez_usluge():
        return kinect_usluga.KameraZUslugi()
    return KinectCamera()


def kinect_podlaczony() -> bool:
    try:
        import kinect_usluga
        if kinect_usluga.stan_uslugi()[1]:
            return True
        import kinect_win
        return kinect_win.sensor_count() > 0
    except Exception:
        return False


def open_camera():
    source = os.environ.get("CAMERA_SOURCE", "auto").lower()
    if source == "kinect":
        return open_kinect()
    if source in ("cv", "opencv"):
        return CvCamera(CAMERA_INDEX)
    if source == "auto":
        # Komputer bez zwykłej kamery, ale z Kinectem, to częsty układ –
        # wcześniej obserwator padał tu na „Camera index out of range”.
        try:
            return CvCamera(CAMERA_INDEX)
        except BrakKamery as e:
            if not kinect_podlaczony():
                raise SystemExit(str(e))
            print("Brak zwykłej kamery – biorę obraz z Kinecta.")
            return open_kinect()
    raise SystemExit(f"Nieznane CAMERA_SOURCE: {source} (dozwolone: auto, cv, kinect)")


def main() -> None:
    model = YOLO(os.environ.get("YOLO_MODEL", "yolo11n.pt"))
    cam = open_camera()

    print(f"✦ Cosmos Watcher – {cam.name}, analiza co {INTERVAL}s, cel: {COSMOS_URL}")
    send_event("obserwator kamery uruchomiony")

    try:
        _loop(model, cam)
    finally:
        cam.close()


def _loop(model, cam) -> None:
    prev: set[str] = set()
    while True:
        frame = cam.read()
        if frame is None:
            time.sleep(2)
            continue

        results = model(frame, verbose=False)[0]
        current = {results.names[int(b.cls)] for b in results.boxes if float(b.conf) >= CONF_MIN}

        appeared = current - prev
        disappeared = prev - current
        if appeared:
            send_event("w kadrze pojawiło się: " + ", ".join(sorted(appeared)))
        if disappeared:
            send_event("z kadru zniknęło: " + ", ".join(sorted(disappeared)))

        prev = current
        time.sleep(INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  Zatrzymano.")

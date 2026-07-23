#!/usr/bin/env python3
"""
Cosmos Watcher — ciągła percepcja otoczenia.

Obserwuje kamerę (webcam / Kinect RGB przez sterownik kamery), wykrywa
obiekty YOLO i wysyła do Cosmosa TYLKO ZMIANY (pojawiło się / zniknęło).
Cosmos dokleja te zdarzenia do kontekstu rozmowy — dzięki temu Nemotron
„wie”, co dzieje się w pokoju, zanim o cokolwiek zapytasz.

Uruchomienie (wymaga: pip install ultralytics opencv-python requests):
    python senses/watcher.py

Zmienne środowiskowe:
    COSMOS_URL      adres Cosmosa (domyślnie http://localhost:3000)
    CAMERA_INDEX    numer kamery (domyślnie 0)
    WATCH_INTERVAL  sekundy między analizami (domyślnie 5)
    YOLO_MODEL      domyślnie yolo11n.pt
"""

import os
import time

import cv2
import requests
from ultralytics import YOLO

COSMOS_URL = os.environ.get("COSMOS_URL", "http://localhost:3000").rstrip("/")
CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", 0))
INTERVAL = float(os.environ.get("WATCH_INTERVAL", 5))
CONF_MIN = 0.45


def send_event(summary: str, type_: str = "kamera") -> None:
    try:
        requests.post(f"{COSMOS_URL}/api/events",
                      json={"type": type_, "summary": summary}, timeout=5)
        print(f"→ {summary}")
    except requests.RequestException as e:
        print(f"! nie wysłano zdarzenia: {e}")


def main() -> None:
    model = YOLO(os.environ.get("YOLO_MODEL", "yolo11n.pt"))
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        raise SystemExit(f"Nie mogę otworzyć kamery {CAMERA_INDEX}.")

    print(f"✦ Cosmos Watcher — kamera {CAMERA_INDEX}, analiza co {INTERVAL}s, cel: {COSMOS_URL}")
    send_event("obserwator kamery uruchomiony")

    prev: set[str] = set()
    while True:
        ok, frame = cap.read()
        if not ok:
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
    main()

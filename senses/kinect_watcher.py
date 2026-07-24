#!/usr/bin/env python3
"""
Cosmos Kinect Watcher — zmysł głębi (Kinect 360).

Czyta mapę głębi z Kinecta przez sterownik libfreenect i wysyła do Cosmosa
zdarzenia o tym, co dzieje się w przestrzeni:
  • ktoś wszedł / wyszedł z zasięgu (obecność),
  • ruch w pomieszczeniu (start / koniec),
  • zmiana dystansu najbliższego obiektu.

Kinect RGB działa jak zwykła kamera — do obrazu użyj watcher.py (YOLO)
albo MediaPipe (sylwetka). Ten skrypt zajmuje się wyłącznie GŁĘBIĄ,
czyli tym, czego zwykła kamera nie widzi.

Wymagania:
    pip install freenect numpy requests
    (libfreenect: Windows — zbuduj wg https://github.com/OpenKinect/libfreenect,
     Linux — sudo apt install freenect; Kinect podłączony przez adapter zasilania)

Alternatywa na Windows: oficjalne Kinect SDK 1.8 daje szkielet, ale tylko
w C#/C++ — dlatego tu używamy libfreenect (głębia) + MediaPipe (szkielet z RGB).

Zmienne środowiskowe:
    COSMOS_URL      adres Cosmosa (domyślnie http://localhost:3000)
    WATCH_INTERVAL  sekundy między analizami (domyślnie 2)
"""

import os
import time

import numpy as np
import requests

try:
    import freenect
except ImportError:
    raise SystemExit(
        "Brak modułu freenect (libfreenect).\n"
        "Instrukcja: https://github.com/OpenKinect/libfreenect (sekcja Python wrapper).\n"
        "Do czasu instalacji możesz używać watcher.py (RGB + YOLO) — Kinect RGB "
        "jest widoczny jako zwykła kamera."
    )

COSMOS_URL = os.environ.get("COSMOS_URL", "http://localhost:3000").rstrip("/")
INTERVAL = float(os.environ.get("WATCH_INTERVAL", 2))

PRESENCE_MIN_MM = 500      # obecność liczymy w paśmie 0,5–3,5 m (zasięg Kinecta 360)
PRESENCE_MAX_MM = 3500
PRESENCE_FRACTION = 0.06   # >6% pikseli w paśmie -> ktoś/coś jest blisko
MOTION_THRESHOLD_MM = 25   # średnia zmiana głębi uznawana za ruch
NEAREST_DELTA_MM = 400     # raportuj zmianę najbliższego dystansu > 40 cm


def send_event(summary: str) -> None:
    try:
        requests.post(f"{COSMOS_URL}/api/events",
                      json={"type": "kinect", "summary": summary}, timeout=5)
        print(f"→ {summary}")
    except requests.RequestException as e:
        print(f"! nie wysłano zdarzenia: {e}")


def get_depth_mm() -> np.ndarray:
    depth, _ = freenect.sync_get_depth(format=freenect.DEPTH_MM)
    return depth.astype(np.int32)


def main() -> None:
    print(f"✦ Cosmos Kinect Watcher — analiza co {INTERVAL}s, cel: {COSMOS_URL}")
    send_event("czujnik głębi (Kinect) uruchomiony")

    prev_depth = None
    present = False
    moving = False
    last_nearest = None

    while True:
        try:
            depth = get_depth_mm()
        except Exception as e:  # Kinect odłączony / zajęty
            print(f"! błąd odczytu Kinecta: {e}")
            time.sleep(5)
            continue

        valid = depth[depth > 0]
        if valid.size == 0:
            time.sleep(INTERVAL)
            continue

        # 1. Obecność w zasięgu
        band = (depth > PRESENCE_MIN_MM) & (depth < PRESENCE_MAX_MM)
        fraction = band.mean()
        now_present = fraction > PRESENCE_FRACTION
        if now_present != present:
            send_event("ktoś (lub duży obiekt) pojawił się w zasięgu czujnika głębi"
                       if now_present else "zasięg czujnika głębi jest teraz pusty")
            present = now_present

        # 2. Ruch (różnica map głębi)
        if prev_depth is not None:
            both = (depth > 0) & (prev_depth > 0)
            if both.any():
                diff = np.abs(depth[both] - prev_depth[both]).mean()
                now_moving = diff > MOTION_THRESHOLD_MM
                if now_moving != moving:
                    send_event("wykryto ruch w pomieszczeniu" if now_moving
                               else "ruch ustał, otoczenie jest statyczne")
                    moving = now_moving
        prev_depth = depth

        # 3. Najbliższy obiekt (5. percentyl — odporny na szum)
        nearest = int(np.percentile(valid, 5))
        if last_nearest is None or abs(nearest - last_nearest) > NEAREST_DELTA_MM:
            send_event(f"najbliższy obiekt znajduje się ok. {nearest / 1000:.1f} m od czujnika")
            last_nearest = nearest

        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()

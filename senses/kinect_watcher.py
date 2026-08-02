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

Moduł sam wybiera sterownik — nie musisz nic ustawiać:
  • Windows → Kinect for Windows SDK 1.8 przez kinect_win.py (ctypes).
    Dodatkowo daje ŚLEDZENIE SZKIELETU: postawa (stoi/siedzi), gesty,
    pozycja w kadrze. libfreenect tego nie potrafi w ogóle.
  • Linux   → libfreenect (moduł `freenect`), sama głębia.

Wymagania:
    Windows: Kinect for Windows SDK 1.8 + pip install numpy requests
             (bez libfreenect, bez Zadiga, bez kompilatora)
    Linux:   sudo apt install freenect + pip install freenect numpy requests
    W obu przypadkach Kinect 360 musi mieć własny zasilacz — sam USB nie wystarcza.

Zmienne środowiskowe:
    COSMOS_URL      adres Cosmosa (domyślnie http://localhost:3000)
    COSMOS_TOKEN    COSMOS_API_TOKEN serwera — wymagany, gdy Cosmos ma hasło
    WATCH_INTERVAL  sekundy między analizami (domyślnie 2)
    KINECT_BACKEND  wymuś sterownik: auto (domyślnie) | win | freenect
    KINECT_SKELETON 0 wyłącza zdarzenia o postawie (Windows)
"""

import os
import time

import numpy as np
import requests

BACKEND = os.environ.get("KINECT_BACKEND", "auto").lower()
WANT_SKELETON = os.environ.get("KINECT_SKELETON", "1") != "0"

COSMOS_URL = os.environ.get("COSMOS_URL", "http://localhost:3000").rstrip("/")
COSMOS_TOKEN = os.environ.get("COSMOS_TOKEN", "")
INTERVAL = float(os.environ.get("WATCH_INTERVAL", 2))

PRESENCE_MIN_MM = 500      # obecność liczymy w paśmie 0,5–3,5 m (zasięg Kinecta 360)
PRESENCE_MAX_MM = 3500
PRESENCE_FRACTION = 0.06   # >6% pikseli w paśmie -> ktoś/coś jest blisko
MOTION_THRESHOLD_MM = 25   # średnia zmiana głębi uznawana za ruch
NEAREST_DELTA_MM = 400     # raportuj zmianę najbliższego dystansu > 40 cm


def _auth() -> dict:
    """Nagłówek logowania. Wymagany, gdy serwer ma ustawione COSMOS_API_TOKEN
    (czyli zawsze na VPS). Bez niego /api/events odpowiada 401."""
    return {"Authorization": f"Bearer {COSMOS_TOKEN}"} if COSMOS_TOKEN else {}


def send_event(summary: str) -> None:
    try:
        requests.post(f"{COSMOS_URL}/api/events", headers=_auth(),
                      json={"type": "kinect", "summary": summary}, timeout=5)
        print(f"→ {summary}")
    except requests.RequestException as e:
        print(f"! nie wysłano zdarzenia: {e}")


def _posture_line(opis: dict) -> str:
    """Jedno zdanie z opisu postawy. Puste, gdy nie ma czego powiedzieć."""
    parts = [opis.get("postawa"), opis.get("pozycja")]
    if opis.get("dystans_m") is not None:
        parts.append(f"{opis['dystans_m']:.1f} m")
    parts.extend(opis.get("gesty") or [])
    return ", ".join(p for p in parts if p)


# ---------------------------------------------------------------------------
# Wybór sterownika
# ---------------------------------------------------------------------------

class FreenectSource:
    """libfreenect — otwarty sterownik. Sama głębia, bez szkieletu."""

    name = "libfreenect"
    has_skeleton = False

    def __init__(self):
        import freenect
        self._fn = freenect

    def depth_mm(self):
        depth, _ = self._fn.sync_get_depth(format=self._fn.DEPTH_MM)
        return depth.astype(np.int32)

    def skeletons(self):
        return []

    def close(self):
        pass


class WinSdkSource:
    """Kinect for Windows SDK 1.8 przez ctypes. Głębia + szkielet."""

    name = "Kinect for Windows SDK 1.8"

    def __init__(self, skeleton=True):
        import kinect_win
        self._mod = kinect_win
        self._k = kinect_win.Kinect(color=False, depth=True, skeleton=skeleton)
        self._k.open()
        self.has_skeleton = skeleton

    def depth_mm(self):
        frame = self._k.depth_frame()
        if frame is None:
            raise RuntimeError("brak klatki głębi (przekroczony czas oczekiwania)")
        return frame.astype(np.int32)

    def skeletons(self):
        return self._k.skeletons(timeout_ms=50) if self.has_skeleton else []

    def close(self):
        self._k.close()


def open_source():
    """Wybierz sterownik: wymuszony przez KINECT_BACKEND albo pierwszy działający.

    Na Windowsie kolejność jest odwrotna do intuicji z Linuksa — najpierw SDK,
    bo jest już zainstalowane razem ze sterownikiem czujnika i daje szkielet,
    a libfreenect wymagałby podmiany sterownika i utraty SDK.
    """
    order = {"win": ["win"], "freenect": ["freenect"]}.get(
        BACKEND, ["win", "freenect"] if os.name == "nt" else ["freenect", "win"])

    problems = []
    for kind in order:
        try:
            return WinSdkSource(WANT_SKELETON) if kind == "win" else FreenectSource()
        except Exception as e:
            problems.append(f"  • {kind}: {e}")

    raise SystemExit(
        "Nie udało się otworzyć Kinecta żadnym sterownikiem:\n"
        + "\n".join(problems)
        + "\n\nWindows: zainstaluj Kinect for Windows SDK 1.8 —"
          "\n  https://www.microsoft.com/en-us/download/details.aspx?id=40278"
          "\n  Sprawdź:  python kinect_win.py info"
          "\nLinux:   sudo apt install freenect && pip install freenect"
          "\nW obu przypadkach Kinect 360 musi mieć podłączony własny zasilacz."
    )


def main() -> None:
    source = open_source()
    print(f"✦ Cosmos Kinect Watcher — sterownik: {source.name}")
    print(f"  Analiza co {INTERVAL}s, cel: {COSMOS_URL}")
    if source.has_skeleton:
        print("  Śledzenie sylwetki włączone (postawa, gesty, pozycja w kadrze).")
    send_event(f"czujnik głębi (Kinect) uruchomiony — {source.name}")

    try:
        _loop(source)
    finally:
        # Czujnik zostaje zajęty, dopóki go nie zwolnimy — bez tego kolejne
        # uruchomienie kończy się „urządzenie w użyciu".
        source.close()


def _loop(source) -> None:
    prev_depth = None
    present = False
    moving = False
    last_nearest = None
    last_posture = ""

    while True:
        try:
            depth = source.depth_mm()
        except Exception as e:  # Kinect odłączony / zajęty
            print(f"! błąd odczytu Kinecta: {e}")
            time.sleep(5)
            continue

        # 0. Sylwetka — najbogatsza informacja, gdy sterownik ją daje.
        #    Zgłaszamy tylko zmiany opisu, żeby nie zalewać kontekstu.
        for person in source.skeletons():
            line = person["opis"]
            summary = _posture_line(line)
            if summary and summary != last_posture:
                send_event(f"sylwetka: {summary}")
                last_posture = summary

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
    try:
        main()
    except KeyboardInterrupt:
        # Bez tego Ctrl+C zostawiłby czujnik zajęty i kolejny start by się nie udał.
        print("\n  Zatrzymano.")

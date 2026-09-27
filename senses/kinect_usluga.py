#!/usr/bin/env python3
"""
Kinect przez usługę zmysłów – dla obserwatora kamery i zmysłu głębi.

Kinect for Windows SDK 1.8 oddaje czujnik jednemu procesowi. Gdy
service.py (podgląd w Cosmosie), watcher.py (obraz dla YOLO) i
kinect_watcher.py (głębia i sylwetki) otwierały go każdy osobno, wygrywał
ten, który wstał pierwszy, a reszta dostawała „urządzenie w użyciu”:
podgląd był czarny, a obserwator padał.

Teraz czujnik ma jednego właściciela – usługę zmysłów – a pozostali biorą
z niej obraz (/kinect/frame), głębię (/kinect/depth) i sylwetki
(/kinect/sylwetki). Czujnik otwierają sami tylko wtedy, gdy usługi nie ma.

Zmienne środowiskowe:
    SENSES_PORT          port usługi zmysłów (domyślnie 7060)
    KINECT_PRZEZ_USLUGE  1 = usługa zmysłów jest włączona (ustawia agent),
                         więc czekaj na nią, zamiast zabierać jej czujnik
"""

import json
import os
import time
import urllib.error
import urllib.request

ADRES = f"http://127.0.0.1:{os.environ.get('SENSES_PORT', '7060')}"
# Usługa ładuje modele (Whisper, YOLO) i potrafi wstawać kilka minut.
CZEKAJ_S = float(os.environ.get("KINECT_CZEKAJ_S", 300))


def _pobierz(sciezka: str, czas: float = 5):
    """(status, nagłówki, ciało). Błąd sieci → (0, {}, opis)."""
    try:
        with urllib.request.urlopen(ADRES + sciezka, timeout=czas) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()
    except Exception as e:
        return 0, {}, str(e).encode("utf-8", "replace")


def _blad(cialo: bytes) -> str:
    try:
        return json.loads(cialo.decode("utf-8")).get("error") or ""
    except Exception:
        return cialo.decode("utf-8", "replace")[:200]


def stan_uslugi():
    """(czy_odpowiada, czy_ma_kinecta, powód)."""
    status, _, cialo = _pobierz("/kinect/status", 3)
    if status != 200:
        return False, False, _blad(cialo) or f"HTTP {status}"
    try:
        dane = json.loads(cialo.decode("utf-8"))
    except Exception:
        return True, False, "nieczytelna odpowiedź usługi"
    return True, bool(dane.get("available")), dane.get("reason") or ""


def przez_usluge(wypisz=print) -> bool:
    """Czy brać Kinecta z usługi zmysłów. Przy KINECT_PRZEZ_USLUGE=1 czeka na
    nią do CZEKAJ_S – otwarcie czujnika w tym czasie zabrałoby go podglądowi."""
    czekaj = os.environ.get("KINECT_PRZEZ_USLUGE") == "1"
    koniec = time.time() + (CZEKAJ_S if czekaj else 0)
    ostatnio = 0.0
    while True:
        odpowiada, ma, powod = stan_uslugi()
        if odpowiada:
            if not ma:
                wypisz(f"! usługa zmysłów nie widzi Kinecta: {powod}")
            return ma
        if time.time() >= koniec:
            if czekaj:
                wypisz("! usługa zmysłów nie wstała – otwieram Kinecta bezpośrednio")
            return False
        if time.time() - ostatnio > 60:
            wypisz("… czekam, aż wstanie usługa zmysłów (ona trzyma Kinecta)")
            ostatnio = time.time()
        time.sleep(3)


class KameraZUslugi:
    """Obraz RGB z Kinecta przez usługę zmysłów (dla watcher.py)."""

    name = "Kinect 360 (RGB przez usługę zmysłów)"

    def __init__(self):
        import cv2
        import numpy as np
        self._cv2, self._np = cv2, np
        self.ostatni_blad = ""

    def read(self):
        status, _, cialo = _pobierz("/kinect/frame?stream=color&quality=90")
        if status != 200:
            blad = _blad(cialo)
            if blad != self.ostatni_blad:
                print(f"! brak klatki z Kinecta: {blad}")
                self.ostatni_blad = blad
            return None
        self.ostatni_blad = ""
        return self._cv2.imdecode(self._np.frombuffer(cialo, dtype=self._np.uint8), self._cv2.IMREAD_COLOR)

    def close(self):
        pass


class GlebiaZUslugi:
    """Głębia i sylwetki z Kinecta przez usługę zmysłów (dla kinect_watcher.py)."""

    name = "Kinect przez usługę zmysłów"
    has_skeleton = True

    def __init__(self):
        import numpy as np
        self._np = np

    def depth_mm(self):
        status, naglowki, cialo = _pobierz("/kinect/depth")
        if status != 200:
            raise RuntimeError(_blad(cialo) or f"HTTP {status}")
        naglowki = {k.lower(): v for k, v in naglowki.items()}
        w, h = int(naglowki["x-szerokosc"]), int(naglowki["x-wysokosc"])
        return self._np.frombuffer(cialo, dtype="<u2").reshape(h, w).astype(self._np.int32)

    def skeletons(self):
        status, _, cialo = _pobierz("/kinect/sylwetki")
        if status != 200:
            return []
        try:
            return json.loads(cialo.decode("utf-8")).get("sylwetki") or []
        except Exception:
            return []

    def close(self):
        pass

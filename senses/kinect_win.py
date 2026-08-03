#!/usr/bin/env python3
"""
Cosmos Kinect Win — most do Kinecta 360 przez oficjalne Kinect for Windows SDK 1.8.

DLACZEGO TEN PLIK ISTNIEJE
    Przez długi czas zakładaliśmy, że SDK 1.8 jest dostępne wyłącznie z C#/C++,
    i kierowaliśmy użytkowników Windowsa do libfreenect — co wymaga budowania
    biblioteki, podmiany sterownika przez Zadig i utraty oficjalnego SDK.
    To było błędne. SDK instaluje `Kinect10.dll` z **płaskim API w C**
    (rodzina funkcji `Nui*`), które Python woła bezpośrednio przez ctypes.

    Co więcej, ta droga daje WIĘCEJ niż libfreenect:

      | Funkcja            | libfreenect | SDK 1.8 (ten moduł) |
      |--------------------|-------------|---------------------|
      | głębia             | tak         | tak                 |
      | obraz RGB          | tak         | tak                 |
      | ŚLEDZENIE SZKIELETU| NIE         | TAK — 20 stawów     |
      | silnik pochylenia  | tak         | tak                 |

    Szkielet to jedyny sposób, by Kinect „rejestrował ruchy" w sensie postawy
    i gestów, a nie samych plam głębi. libfreenect tego nie ma w ogóle.

WYMAGANIA
    • Windows z zainstalowanym Kinect for Windows SDK 1.8 (dioda Kinecta świeci
      na zielono = sterownik działa),
    • Python 64-bitowy zgodny z bitowością zainstalowanego SDK,
    • numpy.
    Nie potrzeba libfreenect, Zadiga ani kompilatora.

UŻYCIE
    python kinect_win.py selftest        # sprawdź układ struktur (bez sprzętu)
    python kinect_win.py info            # wykryj czujnik i wersję API
    python kinect_win.py depth           # podgląd tekstowy mapy głębi
    python kinect_win.py color -o kadr.png
    python kinect_win.py skeleton        # stawy i rozpoznana postawa na żywo
    python kinect_win.py tilt 10         # ustaw kąt pochylenia (-27..27 stopni)

UWAGA O TESTACH
    Logika czysto obliczeniowa (układ struktur, rozpoznawanie postawy, obróbka
    głębi) jest pokryta `selftest` i sprawdzana bez Kinecta. Sama rozmowa
    z `Kinect10.dll` z oczywistych powodów wymaga podłączonego czujnika.
"""
from __future__ import annotations

import argparse
import ctypes
import faulthandler
import math
import os
import sys
import time
from ctypes import (POINTER, byref, c_int, c_int32, c_uint, c_uint32, c_void_p,
                    c_float, c_ubyte)

# Błąd w wywołaniu do Kinect10.dll (zły typ argumentu, zły indeks w vtable)
# nie jest wyjątkiem Pythona — proces po prostu znika, bez śladu i bez kodu
# wyjścia. faulthandler zamienia to w ślad stosu wskazujący dokładne miejsce.
faulthandler.enable()

# Windows API: DWORD to zawsze 32 bity bez znaku, LONG to 32 bity ze znakiem.
# c_ulong/c_long idą za platformą (8 bajtów na Linuksie 64-bit), więc rozjechałyby
# układ struktur. Używamy szerokości stałych — autotest to weryfikuje.
DWORD = c_uint32
LONG = c_int32

def _dep_error(pakiety: str) -> str:
    """Komunikat o brakującej zależności.

    Gdy obok skryptu leży `.venv`, a Python działa poza nim, przyczyną prawie
    nigdy nie jest brak pakietu — tylko nieaktywowane środowisko. Sama rada
    „zainstaluj" prowadzi wtedy w ślepy zaułek: pakiet jest, dwa katalogi obok.
    """
    msg = f"Brak zależności: {pakiety}\nZainstaluj:  pip install {pakiety}"
    venv = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv")
    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    if os.path.isdir(venv) and not in_venv:
        msg = (f"Pakiet „{pakiety.split()[0]}” prawdopodobnie JEST zainstalowany — "
               "tylko nie w tym Pythonie.\n\n"
               "Obok skryptu jest środowisko .venv, ale nie zostało aktywowane.\n"
               "  Windows:      .venv\\Scripts\\activate\n"
               "  Linux/macOS:  source .venv/bin/activate\n\n"
               "Znak zachęty powinien zacząć się od (.venv). Potem uruchom skrypt ponownie.\n\n"
               f"Gdyby to nie pomogło:  pip install {pakiety}")
    return msg


try:
    import numpy as np
except ImportError:
    sys.exit(_dep_error("numpy"))

COSMOS_URL = os.environ.get("COSMOS_URL", "http://localhost:3000").rstrip("/")
COSMOS_TOKEN = os.environ.get("COSMOS_TOKEN", "")

# ---------------------------------------------------------------------------
# Stałe z NuiApi.h / NuiImageCamera.h / NuiSkeleton.h (SDK 1.8)
# ---------------------------------------------------------------------------

NUI_INITIALIZE_FLAG_USES_DEPTH_AND_PLAYER_INDEX = 0x00000001
NUI_INITIALIZE_FLAG_USES_COLOR = 0x00000002
NUI_INITIALIZE_FLAG_USES_SKELETON = 0x00000008
NUI_INITIALIZE_FLAG_USES_DEPTH = 0x00000020

NUI_IMAGE_TYPE_DEPTH_AND_PLAYER_INDEX = 0
NUI_IMAGE_TYPE_COLOR = 1
NUI_IMAGE_TYPE_DEPTH = 4

NUI_IMAGE_RESOLUTION_320x240 = 1
NUI_IMAGE_RESOLUTION_640x480 = 2

RESOLUTIONS = {
    NUI_IMAGE_RESOLUTION_320x240: (320, 240),
    NUI_IMAGE_RESOLUTION_640x480: (640, 480),
}

NUI_SKELETON_COUNT = 6
NUI_SKELETON_POSITION_COUNT = 20

# Kolejność stawów jest częścią API — indeks to znaczenie.
JOINTS = [
    "biodra_srodek", "kregoslup", "barki_srodek", "glowa",
    "bark_lewy", "lokiec_lewy", "nadgarstek_lewy", "dlon_lewa",
    "bark_prawy", "lokiec_prawy", "nadgarstek_prawy", "dlon_prawa",
    "biodro_lewe", "kolano_lewe", "kostka_lewa", "stopa_lewa",
    "biodro_prawe", "kolano_prawe", "kostka_prawa", "stopa_prawa",
]
J = {name: i for i, name in enumerate(JOINTS)}

TRACKING_NOT_TRACKED = 0
TRACKING_POSITION_ONLY = 1
TRACKING_TRACKED = 2

E_NUI_DEVICE_NOT_CONNECTED = 0x83010001
E_NUI_DEVICE_NOT_READY = 0x83010002
E_NUI_NOTPOWERED = 0x8301027C

HRESULT_NAMES = {
    E_NUI_DEVICE_NOT_CONNECTED: "Kinect niepodłączony (E_NUI_DEVICE_NOT_CONNECTED)",
    E_NUI_DEVICE_NOT_READY: "Kinect jeszcze się nie zgłosił (E_NUI_DEVICE_NOT_READY)",
    E_NUI_NOTPOWERED: "Brak zasilania z zasilacza (E_NUI_NOTPOWERED) — sam USB nie wystarcza",
}


# ---------------------------------------------------------------------------
# Struktury
# ---------------------------------------------------------------------------

class Vector4(ctypes.Structure):
    _fields_ = [("x", c_float), ("y", c_float), ("z", c_float), ("w", c_float)]


class NuiImageViewArea(ctypes.Structure):
    _fields_ = [("eDigitalZoom", c_int), ("lCenterX", LONG), ("lCenterY", LONG)]


class NuiImageFrame(ctypes.Structure):
    _fields_ = [
        ("liTimeStamp", ctypes.c_longlong),
        ("dwFrameNumber", DWORD),
        ("eImageType", c_int),
        ("eResolution", c_int),
        ("pFrameTexture", c_void_p),
        ("dwFrameFlags", DWORD),
        ("ViewArea", NuiImageViewArea),
    ]


class NuiLockedRect(ctypes.Structure):
    _fields_ = [("Pitch", c_int), ("size", c_int), ("pBits", POINTER(c_ubyte))]


class NuiSkeletonData(ctypes.Structure):
    _fields_ = [
        ("eTrackingState", c_int),
        ("dwTrackingID", DWORD),
        ("dwEnrollmentIndex", DWORD),
        ("dwUserIndex", DWORD),
        ("Position", Vector4),
        ("SkeletonPositions", Vector4 * NUI_SKELETON_POSITION_COUNT),
        ("eSkeletonPositionTrackingState", c_int * NUI_SKELETON_POSITION_COUNT),
        ("dwQualityFlags", DWORD),
    ]


class NuiSkeletonFrame(ctypes.Structure):
    _fields_ = [
        ("liTimeStamp", ctypes.c_longlong),
        ("dwFrameNumber", DWORD),
        ("dwFlags", DWORD),
        ("vFloorClipPlane", Vector4),
        ("vNormalToGravity", Vector4),
        ("SkeletonData", NuiSkeletonData * NUI_SKELETON_COUNT),
    ]


# ---------------------------------------------------------------------------
# Rozpoznawanie postawy — czysta matematyka, testowalna bez Kinecta
# ---------------------------------------------------------------------------

def joints_to_dict(positions, states=None) -> dict:
    """Zamień tablicę 20 pozycji na słownik nazwa → (x, y, z).

    Stawy nieśledzone (stan 0) pomijamy — lepiej nie wiedzieć, niż zgadywać
    na podstawie pozycji, której czujnik nie widzi.
    """
    out = {}
    for i, name in enumerate(JOINTS):
        if states is not None and states[i] == TRACKING_NOT_TRACKED:
            continue
        p = positions[i]
        out[name] = (float(p.x), float(p.y), float(p.z)) if hasattr(p, "x") else tuple(p)
    return out


def describe_posture(j: dict) -> dict:
    """Opisz postawę słowami, na podstawie wzajemnych położeń stawów.

    Układ współrzędnych Kinecta: X w prawo (z perspektywy czujnika), Y w górę,
    Z w głąb (od czujnika), wszystko w metrach.
    """
    out = {"postawa": None, "gesty": [], "dystans_m": None, "pozycja": None}

    hip = j.get("biodra_srodek")
    head = j.get("glowa")
    if hip:
        out["dystans_m"] = round(hip[2], 2)
        # Kąt widzenia Kinecta to ~57°, więc ±0,3 m na metr głębi to mniej więcej brzeg.
        x = hip[0]
        out["pozycja"] = "po lewej" if x < -0.35 else "po prawej" if x > 0.35 else "na wprost"

    # Stoi czy siedzi: różnica wysokości między biodrami a kolanami.
    knees = [j[k][1] for k in ("kolano_lewe", "kolano_prawe") if k in j]
    if hip and knees:
        drop = hip[1] - (sum(knees) / len(knees))
        out["postawa"] = "stoi" if drop > 0.30 else "siedzi"
    elif hip and head:
        out["postawa"] = "stoi" if (head[1] - hip[1]) > 0.55 else "siedzi"

    # Dłoń nad głową — najczytelniejszy gest, odporny na szum.
    if head:
        for side, key in (("lewa", "dlon_lewa"), ("prawa", "dlon_prawa")):
            if key in j and j[key][1] > head[1]:
                out["gesty"].append(f"ręka {side} podniesiona")

    # Ręce rozłożone: obie dłonie daleko w bok od kręgosłupa i mniej więcej na
    # jego wysokości (żeby nie mylić z rękami opuszczonymi wzdłuż ciała).
    spine = j.get("kregoslup") or hip
    if spine and "dlon_lewa" in j and "dlon_prawa" in j:
        lh, rh = j["dlon_lewa"], j["dlon_prawa"]
        spread = abs(lh[0] - spine[0]) > 0.45 and abs(rh[0] - spine[0]) > 0.45
        level = abs(lh[1] - spine[1]) < 0.35 and abs(rh[1] - spine[1]) < 0.35
        if spread and level:
            out["gesty"].append("ręce rozłożone")

    return out


def posture_summary(d: dict) -> str:
    """Jedno zdanie dla Cosmosa — takie, jakie powiedziałby człowiek."""
    parts = []
    if d.get("postawa"):
        parts.append(d["postawa"])
    if d.get("pozycja"):
        parts.append(d["pozycja"])
    if d.get("dystans_m") is not None:
        parts.append(f"{d['dystans_m']:.1f} m od czujnika")
    if d.get("gesty"):
        parts.append(", ".join(d["gesty"]))
    return "; ".join(parts) if parts else "sylwetka wykryta"


def depth_stats(depth_mm: np.ndarray, near: int = 500, far: int = 3500) -> dict:
    """Statystyki mapy głębi: obecność w paśmie i dystans najbliższego obiektu.

    Zera to „nie wiem" (cień podczerwieni, powierzchnia pochłaniająca) — muszą
    wypaść z liczenia, inaczej najbliższy obiekt zawsze wychodziłby na 0 mm.
    """
    valid = depth_mm[(depth_mm >= near) & (depth_mm <= far)]
    total = depth_mm.size or 1
    return {
        "udzial": round(float(valid.size) / total, 4),
        "najblizszy_mm": int(valid.min()) if valid.size else None,
        "mediana_mm": int(np.median(valid)) if valid.size else None,
    }


# ---------------------------------------------------------------------------
# Most do Kinect10.dll
# ---------------------------------------------------------------------------

def _hr_text(hr: int) -> str:
    hr &= 0xFFFFFFFF
    return HRESULT_NAMES.get(hr, f"HRESULT 0x{hr:08X}")


class KinectError(RuntimeError):
    pass


def _vtable_call(iface: int, index: int, restype, *argtypes):
    """Pobierz metodę z tablicy wirtualnej interfejsu COM.

    `INuiFrameTexture` jest interfejsem COM, więc bufor obrazu zdobywa się
    przez `LockRect` z jego vtable. Nie potrzeba do tego biblioteki COM —
    wystarczy odczytać wskaźnik z tablicy i zbudować prototyp funkcji.

    Zwracamy zwykły `c_int32`, a nie `ctypes.HRESULT`: ten drugi sam rzuca
    OSError przy błędnym kodzie, przez co zamiast czytelnego komunikatu
    dostalibyśmy ślad stosu w środku pętli pobierania klatek.
    """
    vtbl = ctypes.cast(iface, POINTER(POINTER(c_void_p))).contents
    proto = ctypes.WINFUNCTYPE(restype, c_void_p, *argtypes)
    return proto(vtbl[index])


def _out_struct(struct_type, slack: int = 512):
    """Bufor z zapasem na strukturę, którą wypełnia sterownik.

    Nagłówki SDK 1.8 odwzorowaliśmy z dokumentacji, nie z pliku na dysku.
    Gdyby prawdziwa struktura miała choć jedno pole więcej, sterownik zapisałby
    poza końcem naszej alokacji — a to nie jest cichy błąd, tylko uszkodzenie
    sterty (0xC0000374) i natychmiastowa śmierć procesu, bez szansy na obsługę.

    Zapas kilkuset bajtów kosztuje tyle co nic i usuwa całą tę klasę awarii:
    cokolwiek sterownik dopisze na końcu, trafia w pamięć, która jest nasza.
    Zwracamy `(bufor, wskaźnik)` — bufor musi żyć tak długo jak wskaźnik.
    """
    raw = ctypes.create_string_buffer(ctypes.sizeof(struct_type) + slack)
    return raw, ctypes.cast(raw, POINTER(struct_type))


def _declare(dll) -> None:
    """Opisz sygnatury funkcji SDK.

    Bez tego ctypes zgaduje: zwracany HRESULT bierze za `int`, a argumenty
    przekazuje po typie obiektu Pythona. Na 64-bitowym Windowsie uchwyt
    strumienia to 64-bitowy wskaźnik i przy zgadywaniu łatwo go obciąć —
    a obcięty uchwyt to nie błąd, tylko odczyt z przypadkowego adresu.
    """
    HANDLE = c_void_p
    sig = [
        ("NuiGetSensorCount", [POINTER(c_int)]),
        ("NuiInitialize", [DWORD]),
        ("NuiShutdown", []),
        ("NuiImageStreamOpen", [c_int, c_int, DWORD, DWORD, HANDLE, POINTER(HANDLE)]),
        ("NuiImageStreamGetNextFrame", [HANDLE, DWORD, POINTER(NuiImageFrame)]),
        ("NuiImageStreamReleaseFrame", [HANDLE, POINTER(NuiImageFrame)]),
        ("NuiSkeletonTrackingEnable", [HANDLE, DWORD]),
        ("NuiSkeletonGetNextFrame", [DWORD, POINTER(NuiSkeletonFrame)]),
        ("NuiCameraElevationGetAngle", [POINTER(LONG)]),
        ("NuiCameraElevationSetAngle", [LONG]),
    ]
    for name, argtypes in sig:
        fn = getattr(dll, name, None)
        if fn is None:
            continue
        fn.argtypes = argtypes
        fn.restype = None if name == "NuiShutdown" else c_int32


class Kinect:
    """Czujnik Kinect 360 przez SDK 1.8. Używaj jako menedżera kontekstu."""

    LOCK_RECT_INDEX = 5      # INuiFrameTexture::LockRect
    UNLOCK_RECT_INDEX = 7    # INuiFrameTexture::UnlockRect

    def __init__(self, color=True, depth=True, skeleton=True,
                 resolution=NUI_IMAGE_RESOLUTION_640x480):
        if os.name != "nt":
            raise KinectError(
                "Ten moduł działa tylko na Windowsie (Kinect10.dll z SDK 1.8).\n"
                "Na Linuksie użyj kinect_watcher.py z libfreenect."
            )
        try:
            self.dll = ctypes.WinDLL("Kinect10.dll")
        except OSError as e:
            raise KinectError(
                "Nie znalazłem Kinect10.dll — czy Kinect for Windows SDK 1.8 jest zainstalowane?\n"
                "Pobierz: https://www.microsoft.com/en-us/download/details.aspx?id=40278\n"
                "Sprawdź też, czy Python ma tę samą bitowość co SDK (64-bit do 64-bit).\n"
                f"Szczegóły: {e}"
            ) from e

        _declare(self.dll)

        self.want_color = color
        self.want_depth = depth
        self.want_skeleton = skeleton
        self.resolution = resolution
        self.width, self.height = RESOLUTIONS[resolution]
        self.last_error = 0
        self._color_stream = c_void_p()
        self._depth_stream = c_void_p()
        self._open = False

    # -- cykl życia -------------------------------------------------------

    def __enter__(self):
        self.open()
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def open(self):
        flags = 0
        if self.want_color:
            flags |= NUI_INITIALIZE_FLAG_USES_COLOR
        if self.want_skeleton:
            # Szkielet wymaga strumienia głębi z indeksem gracza.
            flags |= NUI_INITIALIZE_FLAG_USES_SKELETON
            flags |= NUI_INITIALIZE_FLAG_USES_DEPTH_AND_PLAYER_INDEX
        elif self.want_depth:
            flags |= NUI_INITIALIZE_FLAG_USES_DEPTH

        hr = self.dll.NuiInitialize(DWORD(flags))
        if hr != 0:
            raise KinectError(f"NuiInitialize nie powiodło się: {_hr_text(hr)}")
        self._open = True

        if self.want_color:
            hr = self.dll.NuiImageStreamOpen(
                c_int(NUI_IMAGE_TYPE_COLOR), c_int(self.resolution),
                DWORD(0), DWORD(2), c_void_p(None), byref(self._color_stream))
            if hr != 0:
                raise KinectError(f"Nie otworzyłem strumienia RGB: {_hr_text(hr)}")

        if self.want_depth or self.want_skeleton:
            image_type = (NUI_IMAGE_TYPE_DEPTH_AND_PLAYER_INDEX if self.want_skeleton
                          else NUI_IMAGE_TYPE_DEPTH)
            hr = self.dll.NuiImageStreamOpen(
                c_int(image_type), c_int(self.resolution),
                DWORD(0), DWORD(2), c_void_p(None), byref(self._depth_stream))
            if hr != 0:
                raise KinectError(f"Nie otworzyłem strumienia głębi: {_hr_text(hr)}")
            self._depth_has_player = self.want_skeleton

        if self.want_skeleton:
            hr = self.dll.NuiSkeletonTrackingEnable(c_void_p(None), DWORD(0))
            if hr != 0:
                raise KinectError(f"Nie włączyłem śledzenia szkieletu: {_hr_text(hr)}")
        return self

    def close(self):
        if self._open:
            self.dll.NuiShutdown()
            self._open = False

    # -- klatki -----------------------------------------------------------

    def _grab(self, stream, timeout_ms: int):
        """Pobierz klatkę i zwróć jej bufor jako kopię (bajty + krok).

        Ostatni kod błędu zapamiętujemy w `last_error` — bez tego „brak klatki"
        nie odróżnia czujnika, który się jeszcze rozgrzewa, od realnej awarii.
        """
        _keep, frame_p = _out_struct(NuiImageFrame)
        hr = self.dll.NuiImageStreamGetNextFrame(stream, DWORD(timeout_ms), frame_p)
        if hr != 0:
            self.last_error = hr
            return None
        frame = frame_p.contents
        try:
            texture = frame.pFrameTexture
            if not texture:
                self.last_error = 0
                return None
            lock = _vtable_call(texture, self.LOCK_RECT_INDEX, c_int32,
                                c_uint, POINTER(NuiLockedRect), c_void_p, DWORD)
            rect_keep, rect_p = _out_struct(NuiLockedRect)
            if lock(texture, 0, rect_p, None, 0) != 0:
                return None
            rect = rect_p.contents
            if rect.Pitch <= 0 or rect.size <= 0 or not rect.pBits:
                return None
            # Kopiujemy, bo bufor przestaje być nasz zaraz po UnlockRect.
            data = ctypes.string_at(rect.pBits, rect.size)
            unlock = _vtable_call(texture, self.UNLOCK_RECT_INDEX, c_int32, c_uint)
            unlock(texture, 0)
            del rect_keep
            return data, rect.Pitch
        finally:
            self.dll.NuiImageStreamReleaseFrame(stream, frame_p)

    def color_frame(self, timeout_ms: int = 1000):
        """Obraz RGB jako tablica (wysokość × szerokość × 3) w kolejności BGR.

        BGR, bo taką kolejność zakłada OpenCV — dzięki temu klatka trafia prosto
        do YOLO bez konwersji.
        """
        got = self._grab(self._color_stream, timeout_ms)
        if got is None:
            return None
        data, pitch = got
        arr = np.frombuffer(data, dtype=np.uint8)
        arr = arr[: self.height * pitch].reshape(self.height, pitch // 4, 4)
        return np.ascontiguousarray(arr[:, : self.width, :3])

    def depth_frame(self, timeout_ms: int = 1000):
        """Mapa głębi w milimetrach jako tablica (wysokość × szerokość), uint16.

        Zero oznacza „nie wiem": cień podczerwieni, szkło, powierzchnia
        pochłaniająca albo obiekt poza zasięgiem 0,8–4 m.
        """
        got = self._grab(self._depth_stream, timeout_ms)
        if got is None:
            return None
        data, pitch = got
        arr = np.frombuffer(data, dtype=np.uint16)
        arr = arr[: self.height * (pitch // 2)].reshape(self.height, pitch // 2)
        arr = arr[:, : self.width]
        if getattr(self, "_depth_has_player", False):
            # Przy strumieniu z indeksem gracza trzy najniższe bity to numer
            # osoby, a nie odległość — trzeba je odciąć.
            arr = arr >> 3
        return np.ascontiguousarray(arr)

    def skeletons(self, timeout_ms: int = 1000):
        """Lista śledzonych sylwetek: [{id, stawy, opis}]."""
        _keep, frame_p = _out_struct(NuiSkeletonFrame)
        hr = self.dll.NuiSkeletonGetNextFrame(DWORD(timeout_ms), frame_p)
        if hr != 0:
            self.last_error = hr
            return []
        frame = frame_p.contents
        found = []
        for i in range(NUI_SKELETON_COUNT):
            s = frame.SkeletonData[i]
            if s.eTrackingState != TRACKING_TRACKED:
                continue
            joints = joints_to_dict(s.SkeletonPositions, s.eSkeletonPositionTrackingState)
            found.append({
                "id": int(s.dwTrackingID),
                "stawy": joints,
                "opis": describe_posture(joints),
            })
        return found

    # -- silnik pochylenia -------------------------------------------------

    def tilt(self, degrees: int | None = None):
        """Odczytaj albo ustaw kąt pochylenia (-27..27°)."""
        if degrees is None:
            angle = LONG()
            hr = self.dll.NuiCameraElevationGetAngle(byref(angle))
            if hr != 0:
                raise KinectError(f"Nie odczytałem kąta: {_hr_text(hr)}")
            return int(angle.value)
        degrees = max(-27, min(27, int(degrees)))
        hr = self.dll.NuiCameraElevationSetAngle(LONG(degrees))
        if hr != 0:
            raise KinectError(f"Nie ustawiłem kąta: {_hr_text(hr)}")
        return degrees


def sensor_count() -> int:
    """Ile Kinectów widzi system. Zwraca -1, gdy nie ma SDK."""
    try:
        dll = ctypes.WinDLL("Kinect10.dll")
    except (OSError, AttributeError):
        return -1
    _declare(dll)
    count = c_int()
    if dll.NuiGetSensorCount(byref(count)) != 0:
        return 0
    return int(count.value)


# ---------------------------------------------------------------------------
# Zgłaszanie zdarzeń
# ---------------------------------------------------------------------------

def _auth() -> dict:
    return {"Authorization": f"Bearer {COSMOS_TOKEN}"} if COSMOS_TOKEN else {}


def send_event(summary: str, type_: str = "kinect") -> None:
    try:
        import requests
        requests.post(f"{COSMOS_URL}/api/events", headers=_auth(),
                      json={"type": type_, "summary": summary}, timeout=3)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Polecenia
# ---------------------------------------------------------------------------

def _try_frames(k, label: str, grab, settle_s: float = 4.0):
    """Poczekaj na pierwszą klatkę, raportując, co się dzieje.

    Po `NuiInitialize` czujnik potrzebuje chwili, zanim ruszą strumienie —
    pojedyncza próba z sekundowym limitem potrafi wypaść tuż przed tym momentem
    i skłamać, że klatek nie ma wcale.
    """
    deadline = time.time() + settle_s
    attempt = 0
    while time.time() < deadline:
        attempt += 1
        try:
            frame = grab()
        except Exception as e:                      # noqa: BLE001 — chcemy pokazać wszystko
            print(f"  {label:<9} BŁĄD: {type(e).__name__}: {e}")
            return None
        if frame is not None:
            print(f"  {label:<9} OK — {frame.shape} (próba {attempt})")
            return frame
        time.sleep(0.3)
    powod = _hr_text(k.last_error) if k.last_error else "limit czasu bez błędu"
    print(f"  {label:<9} brak klatki po {settle_s:.0f}s — {powod}")
    return None


def cmd_info() -> None:
    n = sensor_count()
    if n < 0:
        print("\n  ✗ Nie znalazłem Kinect10.dll.")
        print("    Zainstaluj Kinect for Windows SDK 1.8 albo sprawdź bitowość Pythona.\n")
        sys.exit(1)
    print(f"\n✦ Cosmos Kinect Win — czujników w systemie: {n}")
    if n == 0:
        print("  Podłącz Kinecta i upewnij się, że ma osobne zasilanie (sam USB nie wystarcza).\n")
        sys.exit(1)

    # Każdy etap osobno: gdyby coś się wysypało, widać dokładnie na czym.
    print("  Otwieram strumienie…", flush=True)
    k = Kinect()
    try:
        k.open()
        print(f"  Rozdzielczość strumieni: {k.width}×{k.height}")
        try:
            print(f"  Kąt pochylenia: {k.tilt()}°", flush=True)
        except KinectError as e:
            print(f"  Kąt pochylenia: nieodczytany ({e})", flush=True)

        _try_frames(k, "Głębia:", k.depth_frame)
        _try_frames(k, "Obraz:", k.color_frame)

        try:
            people = k.skeletons(timeout_ms=1000)
            print(f"  Szkielet: {len(people)} śledzonych sylwetek"
                  + ("" if people else " — stań 1,5–3 m przed czujnikiem"))
            for p in people:
                print(f"            [{p['id']}] {posture_summary(p['opis'])}")
        except Exception as e:                      # noqa: BLE001
            print(f"  Szkielet: BŁĄD: {type(e).__name__}: {e}")
    finally:
        k.close()
    print()


def cmd_depth(args) -> None:
    with Kinect(color=False, skeleton=False) as k:
        print("\n✦ Podgląd głębi. Ctrl+C kończy.\n")
        try:
            while True:
                d = k.depth_frame()
                if d is None:
                    time.sleep(0.1)
                    continue
                st = depth_stats(d)
                near = f"{st['najblizszy_mm']} mm" if st["najblizszy_mm"] else "—"
                print(f"  zajęte {st['udzial'] * 100:5.1f}%   najbliżej {near:>8}   "
                      f"mediana {st['mediana_mm'] or '—'} mm")
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n  Zatrzymano.\n")


def cmd_color(args) -> None:
    with Kinect(depth=False, skeleton=False) as k:
        frame = None
        for _ in range(30):          # pierwsze klatki bywają puste, zanim strumień ruszy
            frame = k.color_frame()
            if frame is not None:
                break
            time.sleep(0.1)
        if frame is None:
            sys.exit("Nie dostałem klatki z Kinecta.")
        try:
            import cv2
            cv2.imwrite(args.out, frame)
        except ImportError:
            sys.exit("Zapis PNG wymaga:  pip install opencv-python")
        print(f"\n  Zapisano {args.out} ({frame.shape[1]}×{frame.shape[0]})\n")


def cmd_skeleton(args) -> None:
    with Kinect(color=False) as k:
        print("\n✦ Śledzenie sylwetki. Stań 1,5–3 m przed czujnikiem. Ctrl+C kończy.\n")
        last = ""
        try:
            while True:
                people = k.skeletons()
                if not people:
                    time.sleep(args.interval)
                    continue
                for p in people:
                    line = posture_summary(p["opis"])
                    if line != last:
                        print(f"  [{p['id']}] {line}")
                        last = line
                        if args.report:
                            send_event(f"sylwetka: {line}", "sylwetka")
                time.sleep(args.interval)
        except KeyboardInterrupt:
            print("\n  Zatrzymano.\n")


def cmd_tilt(args) -> None:
    with Kinect(color=False, depth=False, skeleton=False) as k:
        print(f"\n  Kąt ustawiony na {k.tilt(args.degrees)}°\n")


def cmd_selftest() -> None:
    """Sprawdza to, co da się sprawdzić bez Kinecta: układ struktur i logikę."""
    print("\n✦ Cosmos Kinect Win — autotest\n")
    ok = True

    def check(label, got, want):
        nonlocal ok
        good = got == want
        ok = ok and good
        print(f"  {'OK ' if good else 'ZLE'} {label}: {got}" + ("" if good else f" (oczekiwano {want})"))

    # 1–3. Układ struktur musi zgadzać się co do bajta z nagłówkami SDK,
    # inaczej ctypes odczyta pola z przesunięciem i dostaniemy śmieci.
    check("1. sizeof(Vector4)", ctypes.sizeof(Vector4), 16)
    check("2. sizeof(NUI_SKELETON_DATA)", ctypes.sizeof(NuiSkeletonData), 436)
    expected_frame = 8 + 4 + 4 + 16 + 16 + 6 * 436
    check("3. sizeof(NUI_SKELETON_FRAME)", ctypes.sizeof(NuiSkeletonFrame), expected_frame)

    check("4. liczba stawów", len(JOINTS), NUI_SKELETON_POSITION_COUNT)

    # 5. Sylwetka stojąca na wprost, 2,5 m od czujnika.
    stoi = {
        "glowa": (0.0, 0.75, 2.5), "barki_srodek": (0.0, 0.55, 2.5),
        "kregoslup": (0.0, 0.25, 2.5), "biodra_srodek": (0.0, 0.0, 2.5),
        "kolano_lewe": (-0.1, -0.45, 2.5), "kolano_prawe": (0.1, -0.45, 2.5),
        "dlon_lewa": (-0.25, -0.2, 2.4), "dlon_prawa": (0.25, -0.2, 2.4),
    }
    d = describe_posture(stoi)
    print(f"  {'OK ' if d['postawa'] == 'stoi' else 'ZLE'} 5. postawa stojąca: {d['postawa']}")
    ok = ok and d["postawa"] == "stoi"
    print(f"  {'OK ' if d['dystans_m'] == 2.5 else 'ZLE'} 6. dystans: {d['dystans_m']} m")
    ok = ok and d["dystans_m"] == 2.5

    # 7. Ta sama osoba siedząca — kolana podjeżdżają do wysokości bioder.
    siedzi = dict(stoi)
    siedzi["kolano_lewe"] = (-0.1, -0.05, 2.3)
    siedzi["kolano_prawe"] = (0.1, -0.05, 2.3)
    d2 = describe_posture(siedzi)
    print(f"  {'OK ' if d2['postawa'] == 'siedzi' else 'ZLE'} 7. postawa siedząca: {d2['postawa']}")
    ok = ok and d2["postawa"] == "siedzi"

    # 8. Ręka nad głową.
    reka = dict(stoi)
    reka["dlon_prawa"] = (0.3, 0.95, 2.4)
    d3 = describe_posture(reka)
    has = any("prawa podniesiona" in g for g in d3["gesty"])
    print(f"  {'OK ' if has else 'ZLE'} 8. gest podniesionej ręki: {d3['gesty']}")
    ok = ok and has

    # 9. Ręce rozłożone na boki, na wysokości kręgosłupa.
    rozlozone = dict(stoi)
    rozlozone["dlon_lewa"] = (-0.75, 0.25, 2.5)
    rozlozone["dlon_prawa"] = (0.75, 0.25, 2.5)
    d4 = describe_posture(rozlozone)
    has = "ręce rozłożone" in d4["gesty"]
    print(f"  {'OK ' if has else 'ZLE'} 9. gest rozłożonych rąk: {d4['gesty']}")
    ok = ok and has

    # 10. Ręce opuszczone wzdłuż ciała NIE mogą uchodzić za rozłożone.
    d5 = describe_posture(stoi)
    no_false = "ręce rozłożone" not in d5["gesty"]
    print(f"  {'OK ' if no_false else 'ZLE'} 10. brak fałszywego alarmu przy rękach opuszczonych")
    ok = ok and no_false

    # 11. Pozycja w kadrze.
    lewo = dict(stoi)
    lewo["biodra_srodek"] = (-0.8, 0.0, 2.5)
    d6 = describe_posture(lewo)
    print(f"  {'OK ' if d6['pozycja'] == 'po lewej' else 'ZLE'} 11. pozycja w kadrze: {d6['pozycja']}")
    ok = ok and d6["pozycja"] == "po lewej"

    # 12. Zera w mapie głębi to „nie wiem", nie „0 mm" — inaczej najbliższy
    #     obiekt zawsze wychodziłby tuż przy obiektywie.
    depth = np.zeros((10, 10), dtype=np.uint16)
    depth[0, :5] = 1200
    depth[1, :] = 4000          # poza pasmem
    st = depth_stats(depth)
    good = st["najblizszy_mm"] == 1200 and st["udzial"] == 0.05
    print(f"  {'OK ' if good else 'ZLE'} 12. statystyki głębi: najbliżej {st['najblizszy_mm']} mm, "
          f"udział {st['udzial']}")
    ok = ok and good

    # 13. Sama pusta mapa nie może wywalić modułu.
    st2 = depth_stats(np.zeros((4, 4), dtype=np.uint16))
    good = st2["najblizszy_mm"] is None
    print(f"  {'OK ' if good else 'ZLE'} 13. pusta mapa głębi obsłużona bez błędu")
    ok = ok and good

    # 14. Nieśledzone stawy wypadają z opisu.
    positions = [type("P", (), {"x": 0.0, "y": 0.0, "z": 2.0})() for _ in JOINTS]
    states = [TRACKING_TRACKED] * len(JOINTS)
    states[J["dlon_lewa"]] = TRACKING_NOT_TRACKED
    jd = joints_to_dict(positions, states)
    good = "dlon_lewa" not in jd and len(jd) == len(JOINTS) - 1
    print(f"  {'OK ' if good else 'ZLE'} 14. nieśledzone stawy pominięte: {len(jd)}/{len(JOINTS)}")
    ok = ok and good

    # 15. Bufory dla struktur wypełnianych przez sterownik muszą mieć zapas —
    #     bez niego jedno dodatkowe pole w nagłówku SDK niszczy stertę procesu.
    for i, (typ, nazwa) in enumerate(((NuiImageFrame, "NUI_IMAGE_FRAME"),
                                      (NuiSkeletonFrame, "NUI_SKELETON_FRAME"),
                                      (NuiLockedRect, "NUI_LOCKED_RECT"))):
        buf, _ = _out_struct(typ)
        zapas = len(buf.raw) - ctypes.sizeof(typ)
        good = zapas >= 256
        ok = ok and good
        print(f"  {'OK ' if good else 'ZLE'} {15 + i}. zapas bufora {nazwa}: {zapas} B")

    # 16. Na Windowsie sprawdź jeszcze, czy DLL w ogóle jest.
    if os.name == "nt":
        n = sensor_count()
        print(f"  {'OK ' if n >= 0 else 'ZLE'} 18. Kinect10.dll: "
              + (f"znaleziona, czujników: {n}" if n >= 0 else "brak — zainstaluj SDK 1.8"))
    else:
        print("  --  18. Kinect10.dll: pominięte (nie Windows)")

    print("\n  " + ("✓ Wszystkie testy przeszły." if ok else "✗ Któryś test nie przeszedł."))
    sys.exit(0 if ok else 1)


def main() -> None:
    ap = argparse.ArgumentParser(description="Kinect 360 przez Kinect for Windows SDK 1.8.")
    sub = ap.add_subparsers(dest="cmd")

    sub.add_parser("selftest", help="sprawdź układ struktur i logikę bez sprzętu")
    sub.add_parser("info", help="wykryj czujnik i pokaż stan strumieni")

    p = sub.add_parser("depth", help="podgląd statystyk głębi")
    p.add_argument("--interval", type=float, default=1.0)

    p = sub.add_parser("color", help="zapisz klatkę RGB do pliku")
    p.add_argument("-o", "--out", default="kinect.png")

    p = sub.add_parser("skeleton", help="śledź sylwetkę i opisuj postawę")
    p.add_argument("--interval", type=float, default=0.5)
    p.add_argument("--report", action="store_true", help="zgłaszaj zmiany do Cosmosa")

    p = sub.add_parser("tilt", help="ustaw kąt pochylenia czujnika")
    p.add_argument("degrees", type=int)

    args = ap.parse_args()
    try:
        if args.cmd == "selftest":
            cmd_selftest()
        elif args.cmd == "info":
            cmd_info()
        elif args.cmd == "depth":
            cmd_depth(args)
        elif args.cmd == "color":
            cmd_color(args)
        elif args.cmd == "skeleton":
            cmd_skeleton(args)
        elif args.cmd == "tilt":
            cmd_tilt(args)
        else:
            ap.print_help()
    except KinectError as e:
        sys.exit(f"\n  ✗ {e}\n")


if __name__ == "__main__":
    main()

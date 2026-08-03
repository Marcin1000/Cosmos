#!/usr/bin/env python3
"""
Cosmos LowLight — gdzie jest granica widzenia Twoich kamer.

Eksperyment: przy jakim natężeniu światła detekcja obiektów przestaje działać?
Odpowiedź jest inna dla webcama, dla Canona R6 II i dla podczerwieni Kinecta —
a od niej zależy, którego czujnika użyć o której porze.

  measure — puść YOLO na serię zdjęć o znanym natężeniu światła → krzywa skuteczności
  synth   — wygeneruj serię testową (przyciemnianie + szum), żeby sprawdzić metodę
  selftest— sprawdź samą metodę bez zdjęć i bez YOLO

Wejście dla `measure`: folder ze zdjęciami + plik CSV `nazwa,lux`
(albo lux zapisany w nazwie pliku, np. `scena_120lx.jpg`).

Zależności: numpy; opcjonalnie ultralytics (YOLO) i opencv-python.
Bez YOLO moduł nadal policzy jasność i szum — czyli fizykę obrazu.
"""
from __future__ import annotations

import argparse
import csv
import math
import os
import re
import sys
from pathlib import Path

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

COSMOS_URL = os.environ.get("COSMOS_URL", "http://localhost:3000")
COSMOS_TOKEN = os.environ.get("COSMOS_TOKEN", "")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


def _auth() -> dict:
    """Nagłówek logowania. Wymagany, gdy serwer ma ustawione COSMOS_API_TOKEN
    (czyli zawsze na VPS). Bez niego /api/events odpowiada 401."""
    return {"Authorization": f"Bearer {COSMOS_TOKEN}"} if COSMOS_TOKEN else {}


def send_event(summary: str) -> None:
    try:
        import requests
        requests.post(f"{COSMOS_URL}/api/events", headers=_auth(),
                      json={"type": "badanie", "summary": summary}, timeout=3)
    except Exception:
        pass


def lux_from_name(name: str) -> float | None:
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*lx", name, re.IGNORECASE)
    return float(m.group(1).replace(",", ".")) if m else None


def image_stats(arr: np.ndarray) -> dict:
    """Jasność i szum — to, co realnie decyduje o wykrywalności."""
    g = arr.mean(axis=2) if arr.ndim == 3 else arr
    mean = float(g.mean())
    # szum: odchylenie różnic sąsiednich pikseli (odporne na treść obrazu)
    d = np.diff(g.astype(np.float64), axis=1)
    noise = float(np.std(d) / math.sqrt(2))
    snr = mean / noise if noise > 1e-6 else float("inf")
    return {"jasnosc": round(mean, 1), "szum": round(noise, 2),
            "snr_db": round(20 * math.log10(snr), 1) if snr != float("inf") else 99.0}


def load_image(path: Path) -> np.ndarray | None:
    try:
        import cv2
        img = cv2.imread(str(path))
        return None if img is None else img[:, :, ::-1]
    except ImportError:
        pass
    try:                                    # awaryjnie: tylko PNG przez własny czytnik
        import zlib, struct
        data = path.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        i, w, h, idat = 8, 0, 0, b""
        while i < len(data):
            ln = struct.unpack(">I", data[i:i + 4])[0]
            tag = data[i + 4:i + 8]
            if tag == b"IHDR":
                w, h = struct.unpack(">II", data[i + 8:i + 16])
            elif tag == b"IDAT":
                idat += data[i + 8:i + 8 + ln]
            i += 12 + ln
        raw = zlib.decompress(idat)
        out = np.zeros((h, w, 3), np.uint8)
        pos = 0
        for r in range(h):
            f = raw[pos]; pos += 1
            row = np.frombuffer(raw[pos:pos + w * 3], np.uint8).reshape(w, 3)
            pos += w * 3
            if f != 0:
                return None                 # filtry PNG nieobsługiwane w trybie awaryjnym
            out[r] = row
        return out
    except Exception:
        return None


def detect_count(path: Path, model) -> int:
    if model is None:
        return -1
    try:
        res = model(str(path), verbose=False)
        return int(sum(len(r.boxes) for r in res))
    except Exception:
        return -1


def load_yolo(name: str):
    try:
        from ultralytics import YOLO
        return YOLO(name)
    except Exception:
        return None


def cmd_measure(args) -> None:
    folder = Path(args.folder)
    images = sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    if not images:
        sys.exit(f"Brak zdjęć w {folder}")

    lux_map: dict[str, float] = {}
    if args.csv:
        with open(args.csv, encoding="utf-8") as f:
            for row in csv.reader(f):
                if len(row) >= 2 and not row[0].lower().startswith(("nazwa", "name", "#")):
                    try:
                        lux_map[row[0].strip()] = float(row[1].replace(",", "."))
                    except ValueError:
                        pass

    model = load_yolo(args.model)
    print(f"\n✦ Cosmos LowLight — {folder}  ({len(images)} zdjęć)")
    print(f"  YOLO: {'załadowane (' + args.model + ')' if model else 'niedostępne — liczę samą fizykę obrazu'}\n")
    print(f"  {'zdjęcie':<28} {'lux':>9} {'jasność':>8} {'SNR dB':>7} {'wykryć':>7}")
    print(f"  {'-'*28} {'-'*9} {'-'*8} {'-'*7} {'-'*7}")

    rows = []
    for p in images:
        arr = load_image(p)
        if arr is None:
            print(f"  {p.name:<28} {'—':>9} (nie mogę wczytać — zainstaluj opencv-python)")
            continue
        st = image_stats(arr)
        lux = lux_map.get(p.name, lux_from_name(p.name))
        n = detect_count(p, model)
        rows.append((lux, st, n))
        print(f"  {p.name:<28} {lux if lux is not None else '—':>9} "
              f"{st['jasnosc']:>8} {st['snr_db']:>7} {n if n >= 0 else '—':>7}")

    known = [(l, s, n) for l, s, n in rows if l is not None and n >= 0]
    if len(known) >= 3:
        known.sort(key=lambda x: x[0])
        best = max(n for _, _, n in known)
        limit = None
        for lux, _, n in known:
            if best and n >= 0.5 * best:
                limit = lux
                break
        print(f"\n  Najwięcej wykryć: {best} obiektów")
        if limit is not None:
            print(f"  Granica użyteczności (≥50% wykryć): około {limit} lx")
            print("  Poniżej tej wartości ta kamera przestaje być wiarygodna —")
            print("  przełącz się na czulszy aparat albo na podczerwień Kinecta.")
        send_event(f"badanie granicy widzenia: użyteczne do ~{limit} lx")
    elif rows:
        print("\n  Podaj natężenie światła (CSV albo '120lx' w nazwie pliku)")
        print("  i zainstaluj ultralytics, żeby wyznaczyć granicę wykrywalności.")


def cmd_synth(args) -> None:
    """Seria testowa: ta sama scena przy malejącym świetle (z realnym szumem)."""
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(3)
    h, w = 240, 320
    yy, xx = np.mgrid[0:h, 0:w]
    scene = (60 + 40 * np.sin(xx / 18.0) + 30 * np.cos(yy / 14.0)).astype(np.float64)
    scene[80:170, 110:210] = 200.0                       # jasny „obiekt" w kadrze

    print(f"\n✦ Cosmos LowLight — generuję serię testową w {out}")
    for lux in [float(x) for x in args.levels.split(",")]:
        gain = min(1.0, lux / 500.0)                     # 500 lx = pełna ekspozycja
        img = scene * gain
        # szum fotonowy rośnie, gdy światła ubywa
        img = img + rng.normal(0, max(0.5, 12.0 * (1.0 - gain)), img.shape)
        arr = np.clip(img, 0, 255).astype(np.uint8)
        rgb = np.stack([arr] * 3, axis=2)
        path = out / f"scena_{int(lux)}lx.png"
        write_png(path, rgb)
        st = image_stats(rgb)
        print(f"  {path.name:<22} jasność {st['jasnosc']:>6.1f}  SNR {st['snr_db']:>5.1f} dB")
    print(f"\n  Teraz: python senses/lowlight.py measure {out}")


def write_png(path: Path, rgb: np.ndarray) -> None:
    import struct, zlib
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[r].tobytes() for r in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    path.write_bytes(b"\x89PNG\r\n\x1a\n"
                     + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw, 6))
                     + chunk(b"IEND", b""))


def cmd_selftest(_args) -> None:
    print("\n✦ Cosmos LowLight — samotest\n")
    ok = True
    rng = np.random.default_rng(1)
    base = np.full((100, 100, 3), 120, dtype=np.float64)

    # 1) Jaśniejszy obraz ma większą jasność
    dark = np.clip(base * 0.2, 0, 255).astype(np.uint8)
    bright = np.clip(base * 1.0, 0, 255).astype(np.uint8)
    sd, sb = image_stats(dark), image_stats(bright)
    print(f"  1. Jasność: ciemny {sd['jasnosc']} < jasny {sb['jasnosc']}")
    ok &= sd["jasnosc"] < sb["jasnosc"]

    # 2) Więcej szumu = niższy SNR
    noisy = np.clip(base + rng.normal(0, 25, base.shape), 0, 255).astype(np.uint8)
    clean = np.clip(base + rng.normal(0, 2, base.shape), 0, 255).astype(np.uint8)
    sn, sc = image_stats(noisy), image_stats(clean)
    print(f"  2. SNR: zaszumiony {sn['snr_db']} dB < czysty {sc['snr_db']} dB")
    ok &= sn["snr_db"] < sc["snr_db"]

    # 3) Pomiar szumu zgodny z zadanym (jeden kanał — bez uśredniania RGB)
    flat = np.clip(np.full((200, 200), 128.0) + rng.normal(0, 10, (200, 200)), 0, 255).astype(np.uint8)
    est = image_stats(flat)["szum"]
    print(f"  3. Zmierzony szum (mono): {est:.2f} (zadano 10.0)")
    ok &= abs(est - 10.0) / 10.0 < 0.15

    # 3b) Na obrazie RGB mierzymy szum LUMINANCJI — z niezależnych kanałów
    #     wychodzi ~sigma/sqrt(3); to poprawna fizyka, nie błąd pomiaru.
    rgb3 = np.clip(np.full((200, 200, 3), 128.0) + rng.normal(0, 10, (200, 200, 3)), 0, 255).astype(np.uint8)
    est3 = image_stats(rgb3)["szum"]
    expect3 = 10.0 / math.sqrt(3)
    print(f"  3b. Szum luminancji z RGB: {est3:.2f} (oczekiwane {expect3:.2f} = 10/√3)")
    ok &= abs(est3 - expect3) / expect3 < 0.15

    # 4) Odczyt luksów z nazwy pliku
    print(f"  4. Lux z nazwy: 'scena_120lx.png' → {lux_from_name('scena_120lx.png')}, "
          f"'noc_0,5lx.jpg' → {lux_from_name('noc_0,5lx.jpg')}, "
          f"'bez.jpg' → {lux_from_name('bez.jpg')}")
    ok &= lux_from_name("scena_120lx.png") == 120.0
    ok &= lux_from_name("noc_0,5lx.jpg") == 0.5
    ok &= lux_from_name("bez.jpg") is None

    # 5) Zapis i ponowny odczyt PNG
    tmp = Path("_lowlight_selftest.png")
    write_png(tmp, np.full((16, 16, 3), 90, dtype=np.uint8))
    back = load_image(tmp)
    good = back is not None and abs(float(back.mean()) - 90) < 2
    print(f"  5. Zapis/odczyt PNG: {'OK' if good else 'BŁĄD'}")
    tmp.unlink(missing_ok=True)
    ok &= good

    print("\n  " + ("✓ Wszystkie testy przeszły." if ok else "✗ Któryś test nie przeszedł."))
    sys.exit(0 if ok else 1)


def main() -> None:
    ap = argparse.ArgumentParser(description="Granica widzenia kamer w słabym świetle.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("measure", help="zmierz krzywą wykrywalności na serii zdjęć")
    p.add_argument("folder")
    p.add_argument("--csv", help="plik nazwa,lux")
    p.add_argument("--model", default="yolov8n.pt")
    p.set_defaults(func=cmd_measure)

    p = sub.add_parser("synth", help="wygeneruj serię testową")
    p.add_argument("-o", "--out", default="lowlight-test")
    p.add_argument("--levels", default="500,200,100,50,20,10,5,2")
    p.set_defaults(func=cmd_synth)

    p = sub.add_parser("selftest", help="sprawdź metodę bez zdjęć")
    p.set_defaults(func=cmd_selftest)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

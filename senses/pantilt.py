#!/usr/bin/env python3
"""
Cosmos PanTilt — Ronin-S (i dowolna głowica) jako „szyja" Cosmosa.

Ronin to nie tylko stabilizator: to trzy silniki z enkoderami i IMU, czyli gotowa
głowica pan/tilt. Ten moduł liczy **wzorce ruchu** i wysyła je do sterownika:

  gigapano — siatka pozycji pokrywająca zadany obszar nieba/sceny z zakładką
  timelapse— powolny, równomierny najazd między dwoma punktami
  track    — krok korekcyjny, gdy YOLO wykryje obiekt poza środkiem kadru
  scan     — obrót 360° z kadrami do fotogrametrii wnętrza

Sterowniki (backend):
  sim    — nic nie porusza, tylko wypisuje ruchy (domyślny, do testów i podglądu)
  serial — wysyła proste komendy tekstowe „PAN <deg> TILT <deg>" po porcie szeregowym
           (pasuje do własnego sterownika, płytki Arduino/ESP z silnikami krokowymi)
  ronin  — DJI Ronin przez SDK/Bluetooth: WYMAGA oficjalnego SDK od DJI.
           Moduł przygotowuje komendy i punkt wejścia; samo połączenie trzeba
           dopiąć zgodnie z licencją i dokumentacją DJI (patrz senses/README.md).

Geometria wzorców jest w pełni policzalna — sprawdź: python pantilt.py selftest
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time

COSMOS_URL = os.environ.get("COSMOS_URL", "http://localhost:3000")
COSMOS_TOKEN = os.environ.get("COSMOS_TOKEN", "")


def _auth() -> dict:
    """Nagłówek logowania. Wymagany, gdy serwer ma ustawione COSMOS_API_TOKEN
    (czyli zawsze na VPS). Bez niego /api/events odpowiada 401."""
    return {"Authorization": f"Bearer {COSMOS_TOKEN}"} if COSMOS_TOKEN else {}


def send_event(summary: str) -> None:
    try:
        import requests
        requests.post(f"{COSMOS_URL}/api/events", headers=_auth(),
                      json={"type": "głowica", "summary": summary}, timeout=3)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Wzorce ruchu (czysta geometria — testowalna bez sprzętu)
# ---------------------------------------------------------------------------

def gigapano_grid(fov_h: float, fov_v: float, span_h: float, span_v: float,
                  overlap: float = 0.3) -> list[tuple[float, float]]:
    """Siatka pozycji (pan, tilt) pokrywająca span_h × span_v z zadaną zakładką.

    Zwraca pozycje wężykiem (boustrofedon), żeby głowica nie wracała na początek
    każdego rzędu — mniej ruchu, mniej drgań, krótszy czas.
    """
    if not (0 <= overlap < 0.95):
        raise ValueError("Zakładka musi być w przedziale 0–0.95")
    step_h = fov_h * (1 - overlap)
    step_v = fov_v * (1 - overlap)
    cols = max(1, math.ceil((span_h - fov_h) / step_h) + 1) if span_h > fov_h else 1
    rows = max(1, math.ceil((span_v - fov_v) / step_v) + 1) if span_v > fov_v else 1

    # Siatka bywa szersza niż zadany obszar (liczba kadrów jest całkowita) —
    # wyśrodkuj ją, żeby panorama nie była przekrzywiona na jedną stronę.
    real_h = fov_h + (cols - 1) * step_h
    real_v = fov_v + (rows - 1) * step_v
    start_h = -real_h / 2 + fov_h / 2
    start_v = -real_v / 2 + fov_v / 2

    positions = []
    for r in range(rows):
        tilt = start_v + r * step_v if rows > 1 else 0.0
        cols_range = range(cols) if r % 2 == 0 else range(cols - 1, -1, -1)
        for c in cols_range:
            pan = start_h + c * step_h if cols > 1 else 0.0
            positions.append((round(pan, 2), round(tilt, 2)))
    return positions


def timelapse_path(start: tuple[float, float], end: tuple[float, float],
                   shots: int) -> list[tuple[float, float]]:
    """Równomierny najazd — pozycje dla kolejnych klatek timelapse'u."""
    if shots < 2:
        return [start]
    return [(round(start[0] + (end[0] - start[0]) * i / (shots - 1), 3),
             round(start[1] + (end[1] - start[1]) * i / (shots - 1), 3))
            for i in range(shots)]


def track_step(box: tuple[float, float, float, float], frame_w: int, frame_h: int,
               fov_h: float, fov_v: float, gain: float = 0.5,
               deadzone: float = 0.08) -> tuple[float, float]:
    """Korekta (Δpan, Δtilt), żeby wyśrodkować wykryty obiekt.

    box: (x1, y1, x2, y2) w pikselach — prosto z YOLO.
    Martwa strefa zapobiega drganiu głowicy przy drobnych ruchach obiektu.
    """
    cx = (box[0] + box[2]) / 2.0
    cy = (box[1] + box[3]) / 2.0
    off_x = (cx - frame_w / 2.0) / (frame_w / 2.0)      # -1..1
    off_y = (cy - frame_h / 2.0) / (frame_h / 2.0)
    if abs(off_x) < deadzone:
        off_x = 0.0
    if abs(off_y) < deadzone:
        off_y = 0.0
    d_pan = off_x * (fov_h / 2.0) * gain
    d_tilt = -off_y * (fov_v / 2.0) * gain               # ekran w dół = tilt w dół
    return round(d_pan, 3), round(d_tilt, 3)


def room_scan(fov_h: float, tilts: list[float], overlap: float = 0.3
              ) -> list[tuple[float, float]]:
    """Pełny obrót 360° na kilku wysokościach — kadry do fotogrametrii wnętrza."""
    step = fov_h * (1 - overlap)
    n = max(1, math.ceil(360.0 / step))
    out = []
    for i, tilt in enumerate(tilts):
        rng = range(n) if i % 2 == 0 else range(n - 1, -1, -1)
        for k in rng:
            out.append((round(k * 360.0 / n, 2), float(tilt)))
    return out


# ---------------------------------------------------------------------------
# Sterowniki
# ---------------------------------------------------------------------------

class Head:
    def __init__(self, backend: str = "sim", port: str = "", settle: float = 0.6):
        self.backend = backend
        self.settle = settle
        self.pan = 0.0
        self.tilt = 0.0
        self.moves = 0
        self._ser = None
        if backend == "serial":
            try:
                import serial                                   # pyserial
                self._ser = serial.Serial(port, 115200, timeout=1)
            except ImportError:
                sys.exit("Backend 'serial' wymaga:  pip install pyserial")
            except Exception as e:
                sys.exit(f"Nie mogę otworzyć portu {port}: {e}")
        elif backend == "ronin":
            sys.exit(
                "Backend 'ronin' wymaga oficjalnego SDK DJI, którego nie można "
                "dołączyć do tego repozytorium.\n"
                "Podłącz go w funkcji Head.goto() — komendy i wzorce są już gotowe.\n"
                "Na razie użyj --backend sim (podgląd) albo serial (własny sterownik).")

    def goto(self, pan: float, tilt: float) -> None:
        self.pan, self.tilt = pan, tilt
        self.moves += 1
        if self.backend == "sim":
            print(f"    → pan {pan:+7.2f}°  tilt {tilt:+7.2f}°")
        elif self._ser:
            self._ser.write(f"PAN {pan:.2f} TILT {tilt:.2f}\n".encode())
            time.sleep(self.settle)

    def close(self) -> None:
        if self._ser:
            self._ser.close()


def run_positions(head: Head, positions: list[tuple[float, float]], label: str) -> None:
    print(f"\n  {label}: {len(positions)} pozycji")
    for pan, tilt in positions:
        head.goto(pan, tilt)
    print(f"  ✓ Wykonano {head.moves} ruchów.")
    send_event(f"głowica: {label.lower()} — {len(positions)} pozycji")


# ---------------------------------------------------------------------------
# Komendy
# ---------------------------------------------------------------------------

def cmd_gigapano(args) -> None:
    pos = gigapano_grid(args.fov_h, args.fov_v, args.span_h, args.span_v, args.overlap)
    print(f"\n✦ Cosmos PanTilt — gigapanorama {args.span_h}° × {args.span_v}°")
    print(f"  Pole widzenia obiektywu: {args.fov_h}° × {args.fov_v}°, zakładka {args.overlap * 100:.0f}%")
    head = Head(args.backend, args.port)
    run_positions(head, pos, "Gigapanorama")
    head.close()


def cmd_timelapse(args) -> None:
    pos = timelapse_path((args.from_pan, args.from_tilt), (args.to_pan, args.to_tilt), args.shots)
    total_min = args.shots * args.interval / 60.0
    print(f"\n✦ Cosmos PanTilt — motion timelapse")
    print(f"  {args.shots} klatek co {args.interval}s → {total_min:.1f} min nagrywania")
    head = Head(args.backend, args.port)
    print(f"\n  Ruch: {len(pos)} pozycji")
    for i, (pan, tilt) in enumerate(pos):
        head.goto(pan, tilt)
        if args.backend != "sim" and i < len(pos) - 1:
            time.sleep(args.interval)
    print(f"  ✓ Wykonano {head.moves} ruchów.")
    head.close()


def cmd_scan(args) -> None:
    tilts = [float(t) for t in args.tilts.split(",")]
    pos = room_scan(args.fov_h, tilts, args.overlap)
    print(f"\n✦ Cosmos PanTilt — skan pomieszczenia (360° × {len(tilts)} poziomy)")
    head = Head(args.backend, args.port)
    run_positions(head, pos, "Skan")
    head.close()
    print("  Potem:  python senses/photoscan.py <folder-ze-zdjęciami> --dense")


def cmd_selftest(_args) -> None:
    print("\n✦ Cosmos PanTilt — samotest\n")
    ok = True

    # 1) Gigapanorama pokrywa cały zadany obszar
    pos = gigapano_grid(fov_h=30, fov_v=20, span_h=120, span_v=60, overlap=0.3)
    pans = [p for p, _ in pos]
    tilts = [t for _, t in pos]
    covers_h = min(pans) - 15 <= -60 + 1 and max(pans) + 15 >= 60 - 1
    covers_v = min(tilts) - 10 <= -30 + 1 and max(tilts) + 10 >= 30 - 1
    print(f"  1. Gigapano 120°×60°: {len(pos)} pozycji, pan {min(pans):.0f}…{max(pans):.0f}°, "
          f"tilt {min(tilts):.0f}…{max(tilts):.0f}° — pokrycie {'OK' if covers_h and covers_v else 'BRAK'}")
    ok &= covers_h and covers_v

    # 1b) Siatka jest wyśrodkowana (panorama nie może być przekrzywiona)
    sym_h = abs(min(pans) + max(pans)) < 0.01
    sym_v = abs(min(tilts) + max(tilts)) < 0.01
    print(f"  1b. Symetria siatki: pan {min(pans):+.1f}/{max(pans):+.1f}, "
          f"tilt {min(tilts):+.1f}/{max(tilts):+.1f} — {'wyśrodkowana' if sym_h and sym_v else 'PRZEKRZYWIONA'}")
    ok &= sym_h and sym_v

    # 2) Zakładka rzeczywiście jest — sąsiednie kadry zachodzą na siebie
    row0 = sorted({p for p, t in pos if abs(t - tilts[0]) < 1e-6})
    gap = row0[1] - row0[0] if len(row0) > 1 else 0
    print(f"  2. Odstęp kadrów w rzędzie: {gap:.1f}° przy FOV 30° → zakładka "
          f"{(1 - gap / 30) * 100:.0f}% (oczekiwane 30%)")
    ok &= abs((1 - gap / 30) - 0.30) < 0.02

    # 3) Wężyk: kolejne rzędy idą w przeciwnych kierunkach
    rows_map = {}
    for p, t in pos:
        rows_map.setdefault(t, []).append(p)
    keys = sorted(rows_map)
    dir0 = rows_map[keys[0]][-1] > rows_map[keys[0]][0]
    dir1 = rows_map[keys[1]][-1] > rows_map[keys[1]][0] if len(keys) > 1 else not dir0
    print(f"  3. Wężyk (rzędy naprzemiennie): {'OK' if dir0 != dir1 else 'BŁĄD'}")
    ok &= dir0 != dir1

    # 4) Timelapse: równomierny i z dokładnymi końcami
    tl = timelapse_path((0, 0), (90, 30), 10)
    even = all(abs((tl[i + 1][0] - tl[i][0]) - 10.0) < 1e-6 for i in range(len(tl) - 1))
    print(f"  4. Timelapse 0→90° w 10 krokach: start {tl[0]}, koniec {tl[-1]}, "
          f"równomierny={even}")
    ok &= tl[0] == (0.0, 0.0) and tl[-1] == (90.0, 30.0) and even

    # 5) Śledzenie: obiekt po prawej → obrót w prawo; wyśrodkowany → bez ruchu
    right = track_step((1500, 500, 1700, 700), 1920, 1080, 60, 34)
    center = track_step((910, 510, 1010, 570), 1920, 1080, 60, 34)
    print(f"  5. Śledzenie: obiekt po prawej → Δpan {right[0]:+.2f}° (musi być >0), "
          f"wyśrodkowany → {center} (musi być 0,0)")
    ok &= right[0] > 0 and center == (0.0, 0.0)

    # 6) Obiekt wysoko w kadrze → tilt w górę (dodatni)
    up = track_step((900, 100, 1000, 200), 1920, 1080, 60, 34)
    print(f"  6. Obiekt u góry kadru → Δtilt {up[1]:+.2f}° (musi być >0)")
    ok &= up[1] > 0

    # 7) Skan pomieszczenia zamyka pełny obrót
    rs = room_scan(fov_h=60, tilts=[0, 20], overlap=0.3)
    per_level = len([1 for _, t in rs if t == 0])
    print(f"  7. Skan 360° przy FOV 60°: {per_level} pozycji na poziom "
          f"(potrzeba ≥ {math.ceil(360 / (60 * 0.7))})")
    ok &= per_level >= math.ceil(360 / (60 * 0.7))

    print("\n  " + ("✓ Wszystkie testy przeszły." if ok else "✗ Któryś test nie przeszedł."))
    sys.exit(0 if ok else 1)


def main() -> None:
    ap = argparse.ArgumentParser(description="Sterowanie głowicą pan/tilt (Ronin-S i inne).")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--backend", choices=["sim", "serial", "ronin"], default="sim")
        p.add_argument("--port", default="", help="port szeregowy dla backendu 'serial'")

    p = sub.add_parser("gigapano", help="siatka pozycji na wielką panoramę")
    common(p)
    p.add_argument("--fov-h", type=float, default=30, dest="fov_h", help="poziome pole widzenia obiektywu")
    p.add_argument("--fov-v", type=float, default=20, dest="fov_v")
    p.add_argument("--span-h", type=float, default=180, dest="span_h", help="szerokość panoramy w stopniach")
    p.add_argument("--span-v", type=float, default=60, dest="span_v")
    p.add_argument("--overlap", type=float, default=0.3)
    p.set_defaults(func=cmd_gigapano)

    p = sub.add_parser("timelapse", help="powolny najazd między dwoma punktami")
    common(p)
    p.add_argument("--from-pan", type=float, default=-30, dest="from_pan")
    p.add_argument("--from-tilt", type=float, default=0, dest="from_tilt")
    p.add_argument("--to-pan", type=float, default=30, dest="to_pan")
    p.add_argument("--to-tilt", type=float, default=10, dest="to_tilt")
    p.add_argument("--shots", type=int, default=120)
    p.add_argument("--interval", type=float, default=5.0, help="sekundy między klatkami")
    p.set_defaults(func=cmd_timelapse)

    p = sub.add_parser("scan", help="obrót 360° do fotogrametrii wnętrza")
    common(p)
    p.add_argument("--fov-h", type=float, default=60, dest="fov_h")
    p.add_argument("--tilts", default="-15,0,15", help="poziomy tilt, po przecinku")
    p.add_argument("--overlap", type=float, default=0.3)
    p.set_defaults(func=cmd_scan)

    p = sub.add_parser("selftest", help="sprawdź geometrię wzorców (bez sprzętu)")
    p.set_defaults(func=cmd_selftest)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

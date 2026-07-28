#!/usr/bin/env python3
"""
Cosmos FlightPlan — parametry lotu dronem pod fotogrametrię.

Odpowiada na pytania, które zadajesz PRZED każdym przelotem:
  • Na jakiej wysokości lecieć, żeby uzyskać zadaną dokładność?
  • Ile zdjęć zrobię i czy starczy baterii?
  • Jakie pokrycie ustawić dla terenu, a jakie dla elewacji?

Wszystko liczone z optyki — deterministycznie, bez zgadywania:
    GSD = (szerokość matrycy × wysokość × 100) / (ogniskowa × szerokość zdjęcia w px)

  plan     — parametry jednego lotu (wysokość → GSD, liczba zdjęć, czas)
  matrix   — macierz eksperymentu: wysokość × pokrycie (do badania jakości modelu)
  target   — odwrotnie: mam wymaganą dokładność, na jakiej wysokości lecieć?

Zależności: brak (czysta matematyka). Uruchom `--selftest`, by sprawdzić liczby.
"""
from __future__ import annotations

import argparse
import math
import sys

# Parametry aparatów. Mavic 3: matryca 4/3, 20 Mpx (5280×3956), ogniskowa 12,29 mm.
CAMERAS = {
    "mavic3": {"nazwa": "DJI Mavic 3 (Hasselblad 4/3)", "sensor_mm": 17.3,
               "focal_mm": 12.29, "px_w": 5280, "px_h": 3956, "speed_ms": 8.0,
               "battery_min": 46},
    "mavic3-tele": {"nazwa": "DJI Mavic 3 — teleobiektyw", "sensor_mm": 6.4,
                    "focal_mm": 24.0, "px_w": 4000, "px_h": 3000, "speed_ms": 6.0,
                    "battery_min": 46},
    "r6ii": {"nazwa": "Canon R6 II (pełna klatka, 24 mm)", "sensor_mm": 36.0,
             "focal_mm": 24.0, "px_w": 6000, "px_h": 4000, "speed_ms": 1.0,
             "battery_min": 120},
}

# Zalecane pokrycia dla różnych celów (przód, bok)
PRESETS = {
    "teren": (0.80, 0.70, "mapowanie terenu — siatka, aparat w dół"),
    "obiekt": (0.85, 0.80, "pojedynczy obiekt — orbita, aparat pod kątem"),
    "elewacja": (0.90, 0.80, "ściana/elewacja — lot pionowy, aparat poziomo"),
    "szybki": (0.70, 0.60, "szybki przegląd — mniej zdjęć, gorszy model"),
}


def gsd_cm(cam: dict, altitude_m: float) -> float:
    """Rozmiar piksela na ziemi w centymetrach."""
    return (cam["sensor_mm"] * altitude_m * 100.0) / (cam["focal_mm"] * cam["px_w"])


def altitude_for_gsd(cam: dict, gsd_target_cm: float) -> float:
    return (gsd_target_cm * cam["focal_mm"] * cam["px_w"]) / (cam["sensor_mm"] * 100.0)


def footprint_m(cam: dict, altitude_m: float) -> tuple[float, float]:
    g = gsd_cm(cam, altitude_m) / 100.0        # metry na piksel
    return g * cam["px_w"], g * cam["px_h"]


def plan(cam: dict, altitude_m: float, area_w: float, area_h: float,
         front: float, side: float) -> dict:
    fw, fh = footprint_m(cam, altitude_m)
    step_fwd = max(0.1, fh * (1.0 - front))
    step_side = max(0.1, fw * (1.0 - side))
    lines = max(1, math.ceil(area_w / step_side))
    per_line = max(1, math.ceil(area_h / step_fwd))
    photos = lines * per_line
    distance = lines * area_h + (lines - 1) * step_side
    flight_s = distance / max(0.1, cam["speed_ms"])
    return {
        "gsd_cm": round(gsd_cm(cam, altitude_m), 2),
        "kadr_m": (round(fw, 1), round(fh, 1)),
        "odstep_wzdluz_m": round(step_fwd, 1),
        "odstep_miedzy_liniami_m": round(step_side, 1),
        "linii": lines,
        "zdjec": photos,
        "dystans_m": round(distance),
        "czas_min": round(flight_s / 60.0, 1),
        "baterii": round(flight_s / 60.0 / (cam["battery_min"] * 0.7), 2),
    }


def cmd_plan(args) -> None:
    cam = CAMERAS[args.camera]
    front, side, opis = PRESETS[args.preset]
    if args.front is not None:
        front = args.front
    if args.side is not None:
        side = args.side
    p = plan(cam, args.altitude, args.width, args.length, front, side)

    print(f"\n✦ Cosmos FlightPlan — {cam['nazwa']}")
    print(f"  Cel: {opis}")
    print(f"  Teren: {args.width} × {args.length} m, wysokość lotu {args.altitude} m")
    print(f"\n  Rozdzielczość (GSD):   {p['gsd_cm']} cm/px")
    print(f"  Kadr na ziemi:         {p['kadr_m'][0]} × {p['kadr_m'][1]} m")
    print(f"  Pokrycie:              {front * 100:.0f}% wzdłuż, {side * 100:.0f}% w bok")
    print(f"  Odstęp między zdjęciami: {p['odstep_wzdluz_m']} m")
    print(f"  Odstęp między liniami:   {p['odstep_miedzy_liniami_m']} m")
    print(f"\n  Linii przelotu:        {p['linii']}")
    print(f"  Zdjęć do zrobienia:    {p['zdjec']}")
    print(f"  Dystans:               {p['dystans_m']} m")
    print(f"  Czas lotu:             {p['czas_min']} min")
    print(f"  Baterii (70% zapasu):  {p['baterii']}")
    if p["baterii"] > 1:
        print(f"  ⚠ Potrzebujesz {math.ceil(p['baterii'])} baterii albo mniejszego pokrycia.")
    if p["zdjec"] > 800:
        print(f"  ⚠ {p['zdjec']} zdjęć to długa rekonstrukcja — rozważ wyższy lot.")
    print(f"\n  Po locie:  python senses/photoscan.py <folder> --dense")


def cmd_target(args) -> None:
    cam = CAMERAS[args.camera]
    alt = altitude_for_gsd(cam, args.gsd)
    print(f"\n✦ Cosmos FlightPlan — wysokość dla zadanej dokładności")
    print(f"  Aparat: {cam['nazwa']}")
    print(f"  Chcesz {args.gsd} cm/px  →  leć na wysokości {alt:.1f} m")
    for g in (0.5, 1.0, 2.0, 3.0, 5.0):
        print(f"    {g:>4.1f} cm/px  →  {altitude_for_gsd(cam, g):6.1f} m")
    print("\n  Zasada: model 3D jest dokładny mniej więcej do 2–3× GSD.")
    print("  Do pomiaru kubatury z dokładnością ~5 cm celuj w GSD ok. 2 cm/px.")


def cmd_matrix(args) -> None:
    """Macierz eksperymentu — do badania „ile zdjęć naprawdę potrzeba"."""
    cam = CAMERAS[args.camera]
    print(f"\n✦ Cosmos FlightPlan — macierz eksperymentu ({cam['nazwa']})")
    print(f"  Teren {args.width} × {args.length} m\n")
    alts = [float(a) for a in args.altitudes.split(",")]
    fronts = [float(o) for o in args.overlaps.split(",")]
    print(f"  {'wys.':>6} {'pokr.':>6} {'GSD':>8} {'zdjęć':>7} {'czas':>7} {'baterii':>8}")
    print(f"  {'-'*6} {'-'*6} {'-'*8} {'-'*7} {'-'*7} {'-'*8}")
    for alt in alts:
        for fr in fronts:
            p = plan(cam, alt, args.width, args.length, fr, max(0.5, fr - 0.10))
            print(f"  {alt:>5.0f}m {fr * 100:>5.0f}% {p['gsd_cm']:>7.2f}cm "
                  f"{p['zdjec']:>7} {p['czas_min']:>6.1f}m {p['baterii']:>8.2f}")
    print("\n  Protokół badania: przeleć każdy wariant nad TYM SAMYM obiektem,")
    print("  zbuduj model (photoscan.py --dense) i zmierz znany wymiar taśmą.")
    print("  Wykres błąd(liczba zdjęć) powie Ci, kiedy przestać latać.")


def cmd_selftest() -> None:
    print("\n✦ Cosmos FlightPlan — samotest\n")
    ok = True
    cam = CAMERAS["mavic3"]

    # 1) GSD Mavica 3 z 50 m — wartość znana z dokumentacji (~1,33 cm/px)
    g = gsd_cm(cam, 50)
    print(f"  1. GSD Mavic 3 @ 50 m: {g:.3f} cm/px (oczekiwane ~1,33)")
    ok &= abs(g - 1.333) < 0.02

    # 2) Liniowość: podwójna wysokość = podwójny GSD
    print(f"  2. Liniowość: 100 m → {gsd_cm(cam, 100):.3f} cm/px (2× wartości z 50 m)")
    ok &= abs(gsd_cm(cam, 100) - 2 * g) < 1e-9

    # 3) Odwrotność: altitude_for_gsd(gsd(h)) == h
    h = altitude_for_gsd(cam, g)
    print(f"  3. Odwracalność: z {g:.3f} cm/px wychodzi {h:.2f} m (oczekiwane 50)")
    ok &= abs(h - 50.0) < 1e-6

    # 4) Kadr na ziemi z 50 m: 5280 px × 1,333 cm = ~70,4 m
    fw, fh = footprint_m(cam, 50)
    print(f"  4. Kadr @ 50 m: {fw:.1f} × {fh:.1f} m (oczekiwane ~70,4 × 52,7)")
    ok &= abs(fw - 70.4) < 1.0 and abs(fh - 52.7) < 1.0

    # 5) Więcej pokrycia = więcej zdjęć
    a = plan(cam, 50, 200, 200, 0.70, 0.60)["zdjec"]
    b = plan(cam, 50, 200, 200, 0.85, 0.80)["zdjec"]
    print(f"  5. Pokrycie 70/60% → {a} zdjęć, 85/80% → {b} zdjęć (musi rosnąć)")
    ok &= b > a

    # 6) Wyżej = mniej zdjęć
    lo = plan(cam, 30, 200, 200, 0.80, 0.70)["zdjec"]
    hi = plan(cam, 90, 200, 200, 0.80, 0.70)["zdjec"]
    print(f"  6. Z 30 m → {lo} zdjęć, z 90 m → {hi} zdjęć (musi maleć)")
    ok &= hi < lo

    print("\n  " + ("✓ Wszystkie testy przeszły." if ok else "✗ Któryś test nie przeszedł."))
    sys.exit(0 if ok else 1)


def main() -> None:
    ap = argparse.ArgumentParser(description="Parametry lotu dronem pod fotogrametrię.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def cam_arg(p):
        p.add_argument("--camera", choices=list(CAMERAS), default="mavic3")

    p = sub.add_parser("plan", help="parametry jednego lotu")
    cam_arg(p)
    p.add_argument("--altitude", type=float, default=50, help="wysokość lotu w metrach")
    p.add_argument("--width", type=float, default=100, help="szerokość terenu w metrach")
    p.add_argument("--length", type=float, default=100, help="długość terenu w metrach")
    p.add_argument("--preset", choices=list(PRESETS), default="teren")
    p.add_argument("--front", type=float, help="pokrycie wzdłuż (0–1), nadpisuje preset")
    p.add_argument("--side", type=float, help="pokrycie w bok (0–1), nadpisuje preset")
    p.set_defaults(func=cmd_plan)

    p = sub.add_parser("target", help="jaka wysokość dla zadanej dokładności")
    cam_arg(p)
    p.add_argument("--gsd", type=float, default=2.0, help="wymagane cm na piksel")
    p.set_defaults(func=cmd_target)

    p = sub.add_parser("matrix", help="macierz eksperymentu: wysokość × pokrycie")
    cam_arg(p)
    p.add_argument("--width", type=float, default=100)
    p.add_argument("--length", type=float, default=100)
    p.add_argument("--altitudes", default="30,50,70,90")
    p.add_argument("--overlaps", default="0.70,0.80,0.90")
    p.set_defaults(func=cmd_matrix)

    p = sub.add_parser("selftest", help="sprawdź poprawność obliczeń")
    p.set_defaults(func=lambda _a: cmd_selftest())

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

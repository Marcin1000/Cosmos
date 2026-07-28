#!/usr/bin/env python3
"""
Cosmos Tether — Canon R6 II (i inne) jako sterowany przyrząd.

Aparat podpięty kablem przestaje być „aparatem", a staje się urządzeniem
pomiarowym, którym Cosmos steruje:

  info    — co za aparat jest podłączony i jakie ma ustawienia
  shot    — pojedyncze zdjęcie (z pobraniem pliku)
  stack   — focus stacking: seria z przesuwaną ostrością → jeden ostry kadr
  bracket — bracketing ekspozycji (HDR, trudne kontrastowo wnętrza)
  watch   — wyzwalanie zdarzeniem: „zrób zdjęcie, gdy YOLO zobaczy ptaka"

Sterowanie przez **gPhoto2** (darmowe, Linux/macOS; na Windows przez WSL albo
Canon EOS SDK). Bez gPhoto2 moduł nie udaje, że działa — mówi wprost, czego brakuje.

Sprawdź logikę bez aparatu:  python tether.py selftest
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

COSMOS_URL = os.environ.get("COSMOS_URL", "http://localhost:3000")


def send_event(summary: str) -> None:
    try:
        import requests
        requests.post(f"{COSMOS_URL}/api/events",
                      json={"type": "aparat", "summary": summary}, timeout=3)
    except Exception:
        pass


def gphoto() -> str | None:
    return shutil.which("gphoto2")


def require_gphoto() -> str:
    g = gphoto()
    if not g:
        sys.exit(
            "Nie znaleziono gphoto2 — bez niego nie da się sterować aparatem.\n"
            "  Linux:  sudo apt install gphoto2\n"
            "  macOS:  brew install gphoto2\n"
            "  Windows: użyj WSL albo Canon EOS Utility / EOS SDK.\n"
            "Podłącz aparat kablem USB i ustaw go w tryb PC/PTP.")
    return g


# --- budowanie komend (testowalne bez sprzętu) ------------------------------

def cmd_capture(target: Path, keep_on_camera: bool = False) -> list[str]:
    args = ["gphoto2", "--capture-image-and-download", "--filename", str(target)]
    if keep_on_camera:
        args.append("--keep")
    return args


def cmd_set(param: str, value: str) -> list[str]:
    return ["gphoto2", "--set-config", f"{param}={value}"]


def cmd_focus_step(step: int) -> list[str]:
    """Przesunięcie ostrości. Dodatnie = dalej, ujemne = bliżej.
    gPhoto2 dla Canona przyjmuje wartości 'Near/Far' w trzech wielkościach kroku."""
    mag = min(3, max(1, abs(step)))
    direction = "Far" if step > 0 else "Near"
    return ["gphoto2", "--set-config", f"manualfocusdrive={direction} {mag}"]


def focus_plan(frames: int, step: int) -> list[int]:
    """Sekwencja kroków ostrości dla stackingu — od najbliższego do najdalszego."""
    if frames < 1:
        return []
    return [0] + [step] * (frames - 1)


def bracket_plan(base_ev: float, stops: float, frames: int) -> list[float]:
    """Symetryczna sekwencja ekspozycji wokół bazy (np. -2, -1, 0, +1, +2 EV)."""
    if frames < 1:
        return []
    if frames == 1:
        return [base_ev]
    half = (frames - 1) / 2.0
    return [round(base_ev + (i - half) * stops, 2) for i in range(frames)]


# --- komendy ----------------------------------------------------------------

def run(args_list: list[str], quiet: bool = False) -> tuple[int, str]:
    try:
        r = subprocess.run(args_list, capture_output=True, text=True, timeout=60)
        out = (r.stdout + r.stderr).strip()
        if not quiet and out:
            print("   ", out.splitlines()[0][:120])
        return r.returncode, out
    except subprocess.TimeoutExpired:
        return 1, "przekroczono czas oczekiwania"
    except Exception as e:
        return 1, str(e)


def cmd_info(_args) -> None:
    require_gphoto()
    print("\n✦ Cosmos Tether — podłączony aparat")
    code, out = run(["gphoto2", "--auto-detect"], quiet=True)
    print(out or "(brak odpowiedzi)")
    if code == 0:
        run(["gphoto2", "--summary"], quiet=True)


def cmd_shot(args) -> None:
    require_gphoto()
    out = Path(args.out or "zdjecia")
    out.mkdir(parents=True, exist_ok=True)
    target = out / f"cosmos-{time.strftime('%Y%m%d-%H%M%S')}.%C"
    print(f"\n✦ Cosmos Tether — zdjęcie → {target}")
    code, _ = run(cmd_capture(target))
    print("  ✓ Gotowe." if code == 0 else "  ✗ Nie udało się zrobić zdjęcia.")
    if code == 0:
        send_event("zrobiono zdjęcie aparatem (tethering)")


def cmd_stack(args) -> None:
    require_gphoto()
    out = Path(args.out or "focus-stack")
    out.mkdir(parents=True, exist_ok=True)
    plan = focus_plan(args.frames, args.step)
    print(f"\n✦ Cosmos Tether — focus stacking: {args.frames} klatek, krok {args.step}")
    print("  Ustaw aparat na ostrość ręczną i wyceluj na najbliższy punkt obiektu.\n")
    for i, step in enumerate(plan, 1):
        if step:
            run(cmd_focus_step(step), quiet=True)
            time.sleep(0.3)
        target = out / f"stack-{i:03d}.%C"
        print(f"  [{i}/{len(plan)}] zdjęcie…")
        run(cmd_capture(target), quiet=True)
    print(f"\n  ✓ {len(plan)} klatek w {out}")
    print("  Złóż je np. w Photoshopie (Auto-Blend Layers) albo w Heliconie.")
    send_event(f"focus stacking: {len(plan)} klatek")


def cmd_bracket(args) -> None:
    require_gphoto()
    out = Path(args.out or "bracket")
    out.mkdir(parents=True, exist_ok=True)
    evs = bracket_plan(0.0, args.stops, args.frames)
    print(f"\n✦ Cosmos Tether — bracketing: {evs} EV")
    for i, ev in enumerate(evs, 1):
        run(cmd_set("exposurecompensation", f"{ev}"), quiet=True)
        target = out / f"ev{ev:+.1f}-{i:02d}.%C"
        print(f"  [{i}/{len(evs)}] {ev:+.1f} EV…")
        run(cmd_capture(target), quiet=True)
    run(cmd_set("exposurecompensation", "0"), quiet=True)
    print(f"\n  ✓ {len(evs)} klatek w {out}")
    send_event(f"bracketing HDR: {len(evs)} klatek")


def cmd_watch(args) -> None:
    """Wyzwalanie zdarzeniem: pytamy Cosmosa o zdarzenia percepcji i robimy zdjęcie."""
    require_gphoto()
    try:
        import requests
    except ImportError:
        sys.exit("Tryb 'watch' wymaga:  pip install requests")
    out = Path(args.out or "wyzwalane")
    out.mkdir(parents=True, exist_ok=True)
    print(f"\n✦ Cosmos Tether — czekam na zdarzenie: „{args.trigger}”. Ctrl+C kończy.\n")
    seen = 0
    last_shot = 0.0
    try:
        while True:
            try:
                r = requests.get(f"{COSMOS_URL}/api/events", timeout=5)
                events = r.json().get("events", []) if r.ok else []
            except Exception:
                events = []
            hit = [e for e in events[-5:] if args.trigger.lower() in e.get("summary", "").lower()]
            if hit and time.time() - last_shot > args.cooldown:
                last_shot = time.time()
                seen += 1
                target = out / f"trigger-{seen:03d}-{time.strftime('%H%M%S')}.%C"
                print(f"  ✦ „{args.trigger}” wykryte → zdjęcie {seen}")
                run(cmd_capture(target), quiet=True)
            time.sleep(args.poll)
    except KeyboardInterrupt:
        print(f"\n  Zatrzymano. Zrobionych zdjęć: {seen}")


def cmd_selftest(_args) -> None:
    print("\n✦ Cosmos Tether — samotest (logika, bez aparatu)\n")
    ok = True

    c = cmd_capture(Path("/tmp/x.%C"))
    print(f"  1. Komenda zdjęcia: {' '.join(c[:2])} … {c[-1]}")
    ok &= "--capture-image-and-download" in c and c[-1] == "/tmp/x.%C"

    f_far, f_near = cmd_focus_step(2), cmd_focus_step(-3)
    print(f"  2. Ostrość dalej: {f_far[-1]}   bliżej: {f_near[-1]}")
    ok &= "Far 2" in f_far[-1] and "Near 3" in f_near[-1]

    print(f"  3. Krok ostrości poza zakresem (9) → {cmd_focus_step(9)[-1]} (ma być max 3)")
    ok &= "Far 3" in cmd_focus_step(9)[-1]

    fp = focus_plan(5, 2)
    print(f"  4. Plan stackingu 5 klatek: {fp} (pierwsza bez ruchu)")
    ok &= len(fp) == 5 and fp[0] == 0 and all(s == 2 for s in fp[1:])

    bp = bracket_plan(0.0, 1.0, 5)
    print(f"  5. Bracketing 5 klatek co 1 EV: {bp}")
    ok &= bp == [-2.0, -1.0, 0.0, 1.0, 2.0]

    bp3 = bracket_plan(0.0, 2.0, 3)
    print(f"  6. Bracketing 3 klatki co 2 EV: {bp3} (symetryczny wokół zera)")
    ok &= bp3 == [-2.0, 0.0, 2.0] and abs(sum(bp3)) < 1e-9

    print(f"  7. gphoto2 w systemie: {'jest' if gphoto() else 'brak (moduł powie o tym wprost)'}")

    print("\n  " + ("✓ Wszystkie testy przeszły." if ok else "✗ Któryś test nie przeszedł."))
    sys.exit(0 if ok else 1)


def main() -> None:
    ap = argparse.ArgumentParser(description="Sterowanie aparatem przez kabel (gPhoto2).")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("info", help="wykryj podłączony aparat")
    p.set_defaults(func=cmd_info)

    p = sub.add_parser("shot", help="pojedyncze zdjęcie")
    p.add_argument("-o", "--out")
    p.set_defaults(func=cmd_shot)

    p = sub.add_parser("stack", help="focus stacking (makro)")
    p.add_argument("--frames", type=int, default=12)
    p.add_argument("--step", type=int, default=2, help="wielkość kroku ostrości 1–3")
    p.add_argument("-o", "--out")
    p.set_defaults(func=cmd_stack)

    p = sub.add_parser("bracket", help="bracketing ekspozycji (HDR)")
    p.add_argument("--frames", type=int, default=5)
    p.add_argument("--stops", type=float, default=1.0)
    p.add_argument("-o", "--out")
    p.set_defaults(func=cmd_bracket)

    p = sub.add_parser("watch", help="zdjęcie, gdy Cosmos wykryje zdarzenie")
    p.add_argument("--trigger", default="ptak", help="fragment opisu zdarzenia")
    p.add_argument("--poll", type=float, default=3.0)
    p.add_argument("--cooldown", type=float, default=20.0)
    p.add_argument("-o", "--out")
    p.set_defaults(func=cmd_watch)

    p = sub.add_parser("selftest", help="sprawdź logikę bez aparatu")
    p.set_defaults(func=cmd_selftest)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

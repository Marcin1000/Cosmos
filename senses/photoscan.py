#!/usr/bin/env python3
"""
Cosmos PhotoScan — fotogrametria z copilotem jakości.

Etap 1 (zawsze): analizuje zestaw zdjęć (z Canona R6 II / Mavica 3) i mówi
po polsku, czy nadaje się na dobry model 3D — liczba ujęć, ostrość,
ekspozycja — oraz co poprawić.

Etap 2 (jeśli zainstalowany COLMAP): buduje model 3D automatycznie
(rzadka chmura punktów; z flagą --dense także gęsta chmura .ply).

Użycie:
    python senses/photoscan.py C:\\zdjecia\\zamek
    python senses/photoscan.py C:\\zdjecia\\zamek --dense
    python senses/photoscan.py C:\\zdjecia\\zamek -o C:\\skany\\zamek

COLMAP: pobierz z https://colmap.github.io (wersja CUDA dla RTX 3080)
i dodaj do PATH albo wskaż flagą --colmap "C:\\COLMAP\\colmap.bat".

Wynik trafia też do Cosmosa jako zdarzenie (COSMOS_URL, domyślnie
http://localhost:3000) — możesz potem zapytać w czacie o wynik skanu.
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
BLUR_THRESHOLD = 60.0   # wariancja Laplace'a poniżej tej wartości = nieostre
DARK_THRESHOLD = 45     # średnia jasność
BRIGHT_THRESHOLD = 215


def send_event(summary: str) -> None:
    if not HAS_REQUESTS:
        return
    url = os.environ.get("COSMOS_URL", "http://localhost:3000").rstrip("/")
    # Nagłówek logowania — wymagany, gdy serwer ma COSMOS_API_TOKEN (czyli na VPS).
    token = os.environ.get("COSMOS_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        requests.post(f"{url}/api/events", headers=headers,
                      json={"type": "fotogrametria", "summary": summary}, timeout=5)
    except requests.RequestException:
        pass


def analyze(folder: Path):
    images = sorted(p for p in folder.iterdir() if p.suffix.lower() in IMAGE_EXTS)
    print(f"\n✦ Cosmos PhotoScan — analiza: {folder}")
    print(f"  Zdjęć: {len(images)}")

    if not images:
        print("  ✗ Brak zdjęć w folderze.")
        return images, False

    advice = []
    if len(images) < 30:
        advice.append(f"Masz {len(images)} zdjęć — do dobrego modelu potrzeba zwykle 50–150. "
                      "Rób zdjęcia co 10–15° wokół obiektu, z 60–80% pokryciem między kadrami.")
    elif len(images) < 60:
        advice.append("Dobra liczba na prosty obiekt. Przy budynkach celuj w 100+ (dwa okrążenia: "
                      "z poziomu i z góry — tu świetnie sprawdzi się Mavic).")

    blurry, dark, bright = [], [], []
    if HAS_CV2:
        for p in images:
            img = cv2.imread(str(p))
            if img is None:
                continue
            small = cv2.resize(img, (960, int(img.shape[0] * 960 / img.shape[1])))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            sharp = cv2.Laplacian(gray, cv2.CV_64F).var()
            mean = float(np.mean(gray))
            if sharp < BLUR_THRESHOLD:
                blurry.append(p.name)
            if mean < DARK_THRESHOLD:
                dark.append(p.name)
            elif mean > BRIGHT_THRESHOLD:
                bright.append(p.name)

        if blurry:
            advice.append(f"Nieostre ({len(blurry)}): " + ", ".join(blurry[:8]) +
                          (" …" if len(blurry) > 8 else "") + " — powtórz te ujęcia (krótszy czas migawki).")
        if dark:
            advice.append(f"Zbyt ciemne ({len(dark)}): " + ", ".join(dark[:5]) +
                          (" …" if len(dark) > 5 else ""))
        if bright:
            advice.append(f"Prześwietlone ({len(bright)}): " + ", ".join(bright[:5]) +
                          (" …" if len(bright) > 5 else ""))
        ok = len(images) - len(blurry)
        print(f"  Ostrych: {ok}/{len(images)}")
    else:
        advice.append("(Zainstaluj opencv-python, aby sprawdzić ostrość i ekspozycję: pip install opencv-python)")

    if not advice:
        advice.append("Zestaw wygląda bardzo dobrze — można budować model.")

    print("\n  Copilot:")
    for a in advice:
        print(f"  • {a}")

    usable = len(images) >= 20 and (not HAS_CV2 or (len(images) - len(blurry)) >= 20)
    return images, usable


def find_colmap(explicit: str | None) -> str | None:
    if explicit:
        return explicit if Path(explicit).exists() else None
    return shutil.which("colmap")


def run(cmd: list[str]) -> None:
    print(f"\n  $ {' '.join(cmd[:4])} …")
    subprocess.run(cmd, check=True)


def reconstruct(colmap: str, folder: Path, out: Path, dense: bool) -> None:
    out.mkdir(parents=True, exist_ok=True)
    db = out / "database.db"
    sparse = out / "sparse"
    sparse.mkdir(exist_ok=True)

    run([colmap, "feature_extractor", "--database_path", str(db),
         "--image_path", str(folder), "--ImageReader.single_camera", "1"])
    run([colmap, "exhaustive_matcher", "--database_path", str(db)])
    run([colmap, "mapper", "--database_path", str(db),
         "--image_path", str(folder), "--output_path", str(sparse)])
    print(f"\n  ✓ Rzadka chmura punktów: {sparse}")

    if dense:
        dense_dir = out / "dense"
        run([colmap, "image_undistorter", "--image_path", str(folder),
             "--input_path", str(sparse / "0"), "--output_path", str(dense_dir)])
        run([colmap, "patch_match_stereo", "--workspace_path", str(dense_dir)])
        ply = dense_dir / "fused.ply"
        run([colmap, "stereo_fusion", "--workspace_path", str(dense_dir),
             "--output_path", str(ply)])
        print(f"\n  ✓ Gęsta chmura punktów: {ply}")
        print("    Otwórz w MeshLab / CloudCompare / Blenderze.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Fotogrametria z copilotem jakości (COLMAP).")
    ap.add_argument("folder", help="folder ze zdjęciami")
    ap.add_argument("-o", "--output", help="folder wynikowy (domyślnie <folder>/cosmos-scan)")
    ap.add_argument("--dense", action="store_true", help="buduj też gęstą chmurę punktów (dłużej, wymaga CUDA)")
    ap.add_argument("--colmap", help="ścieżka do colmap/colmap.bat, jeśli nie ma go w PATH")
    args = ap.parse_args()

    folder = Path(args.folder).expanduser().resolve()
    if not folder.is_dir():
        sys.exit(f"Folder nie istnieje: {folder}")

    images, usable = analyze(folder)
    if not images:
        sys.exit(1)

    colmap = find_colmap(args.colmap)
    if not colmap:
        print("\n  COLMAP nie znaleziony — wykonano tylko analizę jakości.")
        print("  Pobierz: https://colmap.github.io (wersja CUDA), dodaj do PATH i uruchom ponownie.")
        send_event(f"analiza zestawu zdjęć ({folder.name}): {len(images)} ujęć, "
                   f"{'nadaje się' if usable else 'wymaga poprawek'} do rekonstrukcji 3D")
        return

    if not usable:
        print("\n  ⚠ Zestaw słaby — rekonstrukcja może się nie powieść. Kontynuuję mimo to…")

    out = Path(args.output).resolve() if args.output else folder / "cosmos-scan"
    try:
        reconstruct(colmap, folder, out, args.dense)
    except subprocess.CalledProcessError as e:
        send_event(f"rekonstrukcja 3D ({folder.name}) nie powiodła się na etapie: {e.cmd[1]}")
        sys.exit(f"\n  ✗ COLMAP zakończył się błędem na etapie {e.cmd[1]}.")

    send_event(f"ukończono skan 3D „{folder.name}”: {len(images)} zdjęć, wynik w {out}")
    print(f"\n  ✦ Gotowe. Wyniki: {out}")


if __name__ == "__main__":
    main()

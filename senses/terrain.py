#!/usr/bin/env python3
"""
Cosmos Terrain — analiza terenu z chmury punktów (dron + fotogrametria).

Bierze model 3D zbudowany przez `photoscan.py` (COLMAP, plik .ply) i liczy
rzeczy, które da się policzyć **deterministycznie** — bez AI, bez internetu:

  sun      — nasłonecznienie: ile godzin bezpośredniego słońca dostaje każdy
             metr kwadratowy w danym dniu (mapa PNG + statystyki)
  shadow   — cień o konkretnej godzinie (np. „15 czerwca o 17:30")
  view     — analiza widoku (viewshed): co widać z danego punktu i wysokości
  volume   — objętość i wysokości (pryzma materiału, wysokość drzewa/budynku)
  compare  — porównanie dwóch skanów w czasie (co przybyło / ubyło)

WAŻNE — układ współrzędnych:
  COLMAP bez georeferencji daje układ **umowny** (nie metry, nie północ).
  Żeby wyniki były prawdziwe, model musi być w ENU: X=wschód, Y=północ,
  Z=góra, w metrach. Najprościej: uruchom `photoscan.py --geo`, który wyrówna
  model po GPS-ie ze zdjęć z drona. Albo podaj ręcznie --scale i --north.

Zależności: tylko numpy (jest już w senses/requirements.txt).
Zapis PNG robimy sami (zlib) — bez matplotlib i bez PIL.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import numpy as np
except ImportError:
    sys.exit("Brak numpy. Zainstaluj:  pip install numpy")

COSMOS_URL = os.environ.get("COSMOS_URL", "http://localhost:3000")


def send_event(summary: str) -> None:
    """Zgłoś wynik do Cosmosa (opcjonalnie — brak serwera nic nie psuje)."""
    try:
        import requests
        requests.post(f"{COSMOS_URL}/api/events",
                      json={"type": "teren", "summary": summary}, timeout=3)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Pozycja słońca — algorytm NOAA (czysta astronomia, offline)
# ---------------------------------------------------------------------------

def julian_day(dt: datetime) -> float:
    dt = dt.astimezone(timezone.utc)
    y, m = dt.year, dt.month
    d = dt.day + (dt.hour + dt.minute / 60 + dt.second / 3600) / 24
    if m <= 2:
        y -= 1
        m += 12
    a = y // 100
    b = 2 - a + a // 4
    return int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + d + b - 1524.5


def solar_position(lat: float, lon: float, dt: datetime) -> tuple[float, float]:
    """Zwraca (azymut °, wysokość °). Azymut liczony od północy, zgodnie z ruchem
    wskazówek zegara (90° = wschód, 180° = południe)."""
    dt = dt.astimezone(timezone.utc)
    t = (julian_day(dt) - 2451545.0) / 36525.0

    l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360.0
    m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    mr = math.radians(m)
    c = (math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t))
         + math.sin(2 * mr) * (0.019993 - 0.000101 * t)
         + math.sin(3 * mr) * 0.000289)
    true_long = l0 + c
    omega = 125.04 - 1934.136 * t
    app_long = true_long - 0.00569 - 0.00478 * math.sin(math.radians(omega))

    secs = 21.448 - t * (46.8150 + t * (0.00059 - t * 0.001813))
    e0 = 23.0 + (26.0 + secs / 60.0) / 60.0
    ecorr = e0 + 0.00256 * math.cos(math.radians(omega))

    decl = math.degrees(math.asin(math.sin(math.radians(ecorr))
                                  * math.sin(math.radians(app_long))))

    yy = math.tan(math.radians(ecorr / 2)) ** 2
    l0r = math.radians(l0)
    eot = 4 * math.degrees(
        yy * math.sin(2 * l0r) - 2 * e * math.sin(mr)
        + 4 * e * yy * math.sin(mr) * math.cos(2 * l0r)
        - 0.5 * yy * yy * math.sin(4 * l0r) - 1.25 * e * e * math.sin(2 * mr))

    minutes = dt.hour * 60 + dt.minute + dt.second / 60
    tst = (minutes + eot + 4 * lon) % 1440
    ha = tst / 4 - 180
    if ha < -180:
        ha += 360

    latr, declr, har = math.radians(lat), math.radians(decl), math.radians(ha)
    cosz = math.sin(latr) * math.sin(declr) + math.cos(latr) * math.cos(declr) * math.cos(har)
    cosz = max(-1.0, min(1.0, cosz))
    zenith = math.degrees(math.acos(cosz))
    elev = 90.0 - zenith

    # refrakcja atmosferyczna (przy horyzoncie słońce „widać wyżej")
    if -1 < elev < 85:
        te = math.tan(math.radians(elev))
        if elev > 5:
            r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5
        elif elev > -0.575:
            r = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)))
        else:
            r = -20.774 / te
        elev += r / 3600.0

    denom = math.cos(latr) * math.sin(math.radians(zenith))
    if abs(denom) > 1e-6:
        arg = (math.sin(latr) * math.cos(math.radians(zenith)) - math.sin(declr)) / denom
        az = math.degrees(math.acos(max(-1.0, min(1.0, arg))))
        az = (az + 180) % 360 if ha > 0 else (540 - az) % 360
    else:
        az = 180.0 if lat > 0 else 0.0
    return az, elev


# ---------------------------------------------------------------------------
# Wczytywanie chmury punktów (.ply — ascii i binary_little_endian)
# ---------------------------------------------------------------------------

_PLY_T = {"float": "f4", "float32": "f4", "double": "f8", "float64": "f8",
          "uchar": "u1", "uint8": "u1", "char": "i1", "int8": "i1",
          "ushort": "u2", "uint16": "u2", "short": "i2", "int16": "i2",
          "uint": "u4", "uint32": "u4", "int": "i4", "int32": "i4"}


def load_ply(path: Path) -> np.ndarray:
    """Zwraca tablicę Nx3 (x, y, z)."""
    with open(path, "rb") as f:
        if f.readline().strip() != b"ply":
            raise ValueError("To nie jest plik PLY.")
        fmt, count, props, in_vertex = None, 0, [], False
        while True:
            line = f.readline()
            if not line:
                raise ValueError("Uszkodzony nagłówek PLY.")
            parts = line.strip().split()
            if not parts:
                continue
            key = parts[0]
            if key == b"format":
                fmt = parts[1].decode()
            elif key == b"element":
                in_vertex = parts[1] == b"vertex"
                if in_vertex:
                    count = int(parts[2])
            elif key == b"property" and in_vertex:
                if parts[1] == b"list":
                    continue
                props.append((parts[2].decode(), parts[1].decode()))
            elif key == b"end_header":
                break

        names = [p[0] for p in props]
        for axis in ("x", "y", "z"):
            if axis not in names:
                raise ValueError("Chmura punktów nie ma współrzędnych x/y/z.")

        if fmt == "ascii":
            data = np.loadtxt(f, max_rows=count, ndmin=2)
            idx = [names.index(a) for a in ("x", "y", "z")]
            return data[:, idx].astype(np.float64)

        endian = "<" if "little" in (fmt or "") else ">"
        dtype = np.dtype([(n, endian + _PLY_T.get(t, "f4")) for n, t in props])
        arr = np.frombuffer(f.read(count * dtype.itemsize), dtype=dtype, count=count)
        return np.stack([arr["x"], arr["y"], arr["z"]], axis=1).astype(np.float64)


def transform_points(pts: np.ndarray, scale: float, north_deg: float,
                     up: str) -> np.ndarray:
    """Doprowadza chmurę do układu ENU (X=wschód, Y=północ, Z=góra, metry)."""
    p = pts.copy()
    if up == "y":                      # zamiana osi: Y w górę -> Z w górę
        p = np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1)
    elif up == "-z":
        p = np.stack([p[:, 0], -p[:, 1], -p[:, 2]], axis=1)
    if scale != 1.0:
        p *= scale
    if north_deg:                      # obrót w poziomie tak, by +Y była północą
        a = math.radians(north_deg)
        ca, sa = math.cos(a), math.sin(a)
        x, y = p[:, 0].copy(), p[:, 1].copy()
        p[:, 0] = ca * x - sa * y
        p[:, 1] = sa * x + ca * y
    return p


# ---------------------------------------------------------------------------
# Model powierzchni (DSM) — siatka wysokości
# ---------------------------------------------------------------------------

class DSM:
    """Rastrowa mapa wysokości. grid[row, col]; row 0 = najdalej na północ."""

    def __init__(self, grid: np.ndarray, cell: float, x0: float, y1: float):
        self.grid = grid
        self.cell = cell
        self.x0 = x0     # zachodnia krawędź
        self.y1 = y1     # północna krawędź

    @classmethod
    def from_points(cls, pts: np.ndarray, cell: float,
                    percentile: float = 100.0) -> "DSM":
        x, y, z = pts[:, 0], pts[:, 1], pts[:, 2]
        x0, x1 = float(x.min()), float(x.max())
        y0, y1 = float(y.min()), float(y.max())
        w = max(1, int(math.ceil((x1 - x0) / cell)))
        h = max(1, int(math.ceil((y1 - y0) / cell)))
        if w * h > 4_000_000:
            raise ValueError(f"Siatka {w}x{h} za duża — zwiększ --cell.")

        col = np.clip(((x - x0) / cell).astype(np.int64), 0, w - 1)
        row = np.clip(((y1 - y) / cell).astype(np.int64), 0, h - 1)
        flat = row * w + col

        grid = np.full(w * h, -np.inf)
        if percentile >= 100.0:
            np.maximum.at(grid, flat, z)          # powierzchnia = najwyższy punkt
        else:                                      # odporność na odstające punkty
            order = np.argsort(z)
            np.maximum.at(grid, flat[order[:int(len(order) * percentile / 100)]],
                          z[order[:int(len(order) * percentile / 100)]])
        grid = grid.reshape(h, w)
        return cls(cls._fill_holes(grid), cell, x0, y1)

    @staticmethod
    def _fill_holes(grid: np.ndarray, rounds: int = 6) -> np.ndarray:
        """Dziury (brak punktów) wypełnia średnią z sąsiadów."""
        g = grid.copy()
        for _ in range(rounds):
            empty = ~np.isfinite(g)
            if not empty.any():
                break
            acc = np.zeros_like(g)
            cnt = np.zeros_like(g)
            for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                s = shift2d(g, dr, dc, np.nan)
                ok = np.isfinite(s)
                acc[ok] += s[ok]
                cnt[ok] += 1
            fill = empty & (cnt > 0)
            g[fill] = acc[fill] / cnt[fill]
        g[~np.isfinite(g)] = np.nanmin(g[np.isfinite(g)]) if np.isfinite(g).any() else 0.0
        return g

    @property
    def shape(self):
        return self.grid.shape

    def stats(self) -> dict:
        h, w = self.shape
        return {"kolumny": w, "wiersze": h, "rozdzielczosc_m": self.cell,
                "obszar_m2": round(w * h * self.cell ** 2, 1),
                "wys_min_m": round(float(self.grid.min()), 2),
                "wys_max_m": round(float(self.grid.max()), 2)}


def shift2d(a: np.ndarray, dr: int, dc: int, fill: float) -> np.ndarray:
    """Przesunięcie tablicy o (dr, dc) z wypełnieniem brzegu."""
    out = np.full_like(a, fill, dtype=np.float64)
    h, w = a.shape
    if abs(dr) >= h or abs(dc) >= w:
        return out
    src_r = slice(max(0, -dr), h - max(0, dr))
    dst_r = slice(max(0, dr), h - max(0, -dr))
    src_c = slice(max(0, -dc), w - max(0, dc))
    dst_c = slice(max(0, dc), w - max(0, -dc))
    out[dst_r, dst_c] = a[src_r, src_c]
    return out


# ---------------------------------------------------------------------------
# Cień i nasłonecznienie
# ---------------------------------------------------------------------------

def shadow_mask(dsm: DSM, azimuth: float, elevation: float,
                max_dist: float = 300.0) -> np.ndarray:
    """True = punkt zacieniony (coś zasłania słońce). Marsz promienia po siatce."""
    if elevation <= 0:
        return np.ones(dsm.shape, dtype=bool)

    az = math.radians(azimuth)
    de, dn = math.sin(az), math.cos(az)          # składowe kierunku DO słońca
    tan_e = math.tan(math.radians(elevation))
    steps = max(1, int(max_dist / dsm.cell))

    blocked = np.zeros(dsm.shape, dtype=bool)
    for k in range(1, steps + 1):
        d = k * dsm.cell
        # Chcemy podejrzeć komórkę oddaloną o k kroków W STRONĘ słońca:
        #   kolumna +k*de (wschód), wiersz -k*dn (północ).
        # shift2d daje out[r,c] = a[r-dr, c-dc], więc znaki są odwrotne.
        dr = int(round(k * dn))
        dc = int(round(-k * de))
        if dc == 0 and dr == 0:
            continue
        neigh = shift2d(dsm.grid, dr, dc, -np.inf)
        blocked |= neigh > dsm.grid + d * tan_e
    return blocked


def slope_aspect(dsm: DSM) -> tuple[np.ndarray, np.ndarray]:
    """Nachylenie i ekspozycja stoku (radiany, azymut od północy)."""
    dz_dc = (shift2d(dsm.grid, 0, -1, np.nan) - shift2d(dsm.grid, 0, 1, np.nan)) / (2 * dsm.cell)
    dz_dr = (shift2d(dsm.grid, -1, 0, np.nan) - shift2d(dsm.grid, 1, 0, np.nan)) / (2 * dsm.cell)
    dz_dx = np.nan_to_num(dz_dc)                 # wschód
    dz_dy = np.nan_to_num(-dz_dr)                # północ
    slope = np.arctan(np.hypot(dz_dx, dz_dy))
    aspect = (np.degrees(np.arctan2(-dz_dx, -dz_dy))) % 360
    return slope, aspect


def sun_lit(dsm: DSM, azimuth: float, elevation: float, max_dist: float,
            use_slope: bool = True) -> np.ndarray:
    """True = powierzchnia oświetlona bezpośrednio (nie w cieniu i zwrócona do słońca)."""
    lit = ~shadow_mask(dsm, azimuth, elevation, max_dist)
    if use_slope and elevation > 0:
        slope, aspect = slope_aspect(dsm)
        z = math.radians(90 - elevation)
        cos_inc = (np.cos(slope) * math.cos(z)
                   + np.sin(slope) * math.sin(z)
                   * np.cos(np.radians(azimuth) - np.radians(aspect)))
        lit &= cos_inc > 0
    return lit


def insolation(dsm: DSM, lat: float, lon: float, day: datetime,
               step_min: int, max_dist: float) -> tuple[np.ndarray, dict]:
    """Mapa godzin bezpośredniego słońca w ciągu dnia."""
    hours = np.zeros(dsm.shape, dtype=np.float32)
    t = day.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
    frac = step_min / 60.0
    samples, first_sun, last_sun, peak = 0, None, None, -90.0
    for _ in range(int(24 * 60 / step_min)):
        az, el = solar_position(lat, lon, t)
        if el > 0:
            samples += 1
            peak = max(peak, el)
            first_sun = first_sun or t
            last_sun = t
            hours += sun_lit(dsm, az, el, max_dist).astype(np.float32) * frac
        t += timedelta(minutes=step_min)
    meta = {
        "dzien": day.strftime("%Y-%m-%d"),
        "dlugosc_dnia_h": round(samples * frac, 2),
        "wschod_utc": first_sun.strftime("%H:%M") if first_sun else "—",
        "zachod_utc": last_sun.strftime("%H:%M") if last_sun else "—",
        "maks_wysokosc_slonca_deg": round(peak, 1),
        "srednio_godzin_slonca": round(float(hours.mean()), 2),
        "maks_godzin_slonca": round(float(hours.max()), 2),
        "udzial_pow_min_6h_proc": round(float((hours >= 6).mean() * 100), 1),
    }
    return hours, meta


# ---------------------------------------------------------------------------
# Widoczność (viewshed)
# ---------------------------------------------------------------------------

def viewshed(dsm: DSM, row: int, col: int, eye_h: float,
             max_dist: float, target_h: float = 0.0) -> np.ndarray:
    """True = widoczne z punktu (row, col) na wysokości eye_h nad terenem."""
    h, w = dsm.shape
    eye_z = float(dsm.grid[row, col]) + eye_h
    rr, cc = np.mgrid[0:h, 0:w]
    dx = (cc - col) * dsm.cell
    dy = (row - rr) * dsm.cell
    dist = np.hypot(dx, dy)
    with np.errstate(divide="ignore", invalid="ignore"):
        need = (dsm.grid + target_h - eye_z) / np.where(dist == 0, np.nan, dist)

    visible = np.zeros((h, w), dtype=bool)
    visible[row, col] = True
    steps = max(1, int(max_dist / dsm.cell))
    # dla każdego kierunku (1° siatka) marsz na zewnątrz z rosnącym horyzontem
    for deg in range(0, 360):
        a = math.radians(deg)
        de, dn = math.sin(a), math.cos(a)
        horizon = -np.inf
        for k in range(1, steps + 1):
            r = int(round(row - k * dn))
            c = int(round(col + k * de))
            if not (0 <= r < h and 0 <= c < w):
                break
            ang = need[r, c]
            if not np.isfinite(ang):
                continue
            if ang >= horizon:
                visible[r, c] = True
                horizon = ang
    return visible


# ---------------------------------------------------------------------------
# Zapis PNG (bez zewnętrznych bibliotek)
# ---------------------------------------------------------------------------

def _chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path: Path, rgb: np.ndarray) -> None:
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[r].tobytes() for r in range(h))
    png = (b"\x89PNG\r\n\x1a\n"
           + _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + _chunk(b"IDAT", zlib.compress(raw, 6))
           + _chunk(b"IEND", b""))
    path.write_bytes(png)


_SUN_STOPS = [(0.00, (24, 28, 48)), (0.25, (48, 70, 130)), (0.50, (120, 140, 170)),
              (0.75, (240, 200, 90)), (1.00, (255, 244, 200))]
_DIFF_STOPS = [(0.0, (200, 70, 60)), (0.5, (28, 30, 38)), (1.0, (80, 190, 130))]


def colorize(values: np.ndarray, vmin: float, vmax: float, stops) -> np.ndarray:
    t = np.clip((values - vmin) / (vmax - vmin if vmax > vmin else 1.0), 0, 1)
    out = np.zeros(values.shape + (3,), dtype=np.uint8)
    for i in range(len(stops) - 1):
        a, ca = stops[i]
        b, cb = stops[i + 1]
        m = (t >= a) & (t <= b)
        if not m.any():
            continue
        f = ((t[m] - a) / (b - a))[:, None]
        out[m] = (np.array(ca) * (1 - f) + np.array(cb) * f).astype(np.uint8)
    return out


def save_map(path: Path, values: np.ndarray, vmin: float, vmax: float,
             stops=_SUN_STOPS) -> None:
    write_png(path, colorize(values, vmin, vmax, stops))


# ---------------------------------------------------------------------------
# Komendy
# ---------------------------------------------------------------------------

def build_dsm(args) -> DSM:
    pts = load_ply(Path(args.cloud))
    pts = transform_points(pts, args.scale, args.north, args.up)
    dsm = DSM.from_points(pts, args.cell)
    s = dsm.stats()
    print(f"  Model: {s['kolumny']}x{s['wiersze']} komórek po {s['rozdzielczosc_m']} m "
          f"(~{s['obszar_m2']} m²), wysokości {s['wys_min_m']}–{s['wys_max_m']} m")
    return dsm


def cmd_sun(args) -> None:
    print(f"\n✦ Cosmos Terrain — nasłonecznienie ({args.date})")
    dsm = build_dsm(args)
    day = datetime.strptime(args.date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    hours, meta = insolation(dsm, args.lat, args.lon, day, args.step, args.max_dist)

    out = Path(args.out or Path(args.cloud).with_name("naslonecznienie"))
    out.mkdir(parents=True, exist_ok=True)
    save_map(out / f"godziny-slonca-{args.date}.png", hours, 0, max(1.0, float(hours.max())))
    (out / f"naslonecznienie-{args.date}.json").write_text(
        json.dumps({"lokalizacja": {"lat": args.lat, "lon": args.lon},
                    "model": dsm.stats(), **meta}, ensure_ascii=False, indent=2),
        encoding="utf-8")

    print(f"\n  Długość dnia:        {meta['dlugosc_dnia_h']} h "
          f"({meta['wschod_utc']}–{meta['zachod_utc']} UTC)")
    print(f"  Maks. wysokość słońca: {meta['maks_wysokosc_slonca_deg']}°")
    print(f"  Średnio słońca:      {meta['srednio_godzin_slonca']} h")
    print(f"  Najlepsze miejsce:   {meta['maks_godzin_slonca']} h")
    print(f"  Powierzchnia ≥6 h:   {meta['udzial_pow_min_6h_proc']}%  "
          f"(próg dla warzywnika i paneli PV)")
    print(f"\n  ✓ Mapa i dane: {out}")
    send_event(f"nasłonecznienie {args.date}: średnio {meta['srednio_godzin_slonca']} h, "
               f"{meta['udzial_pow_min_6h_proc']}% terenu ma ≥6 h słońca")


def cmd_shadow(args) -> None:
    when = datetime.strptime(args.time, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    az, el = solar_position(args.lat, args.lon, when)
    print(f"\n✦ Cosmos Terrain — cień: {args.time} UTC")
    print(f"  Słońce: azymut {az:.1f}°, wysokość {el:.1f}°"
          + ("  (poniżej horyzontu — całość w cieniu)" if el <= 0 else ""))
    dsm = build_dsm(args)
    lit = sun_lit(dsm, az, el, args.max_dist)
    out = Path(args.out or Path(args.cloud).with_name("naslonecznienie"))
    out.mkdir(parents=True, exist_ok=True)
    name = when.strftime("cien-%Y-%m-%d-%H%M.png")
    save_map(out / name, lit.astype(np.float32), 0, 1)
    pct = float(lit.mean()) * 100
    print(f"  Oświetlone: {pct:.1f}% powierzchni")
    print(f"  ✓ {out / name}")
    send_event(f"cień {args.time}: oświetlone {pct:.0f}% terenu "
               f"(słońce {az:.0f}°/{el:.0f}°)")


def cmd_view(args) -> None:
    print("\n✦ Cosmos Terrain — analiza widoku")
    dsm = build_dsm(args)
    h, w = dsm.shape
    row = h // 2 if args.row is None else args.row
    col = w // 2 if args.col is None else args.col
    vis = viewshed(dsm, row, col, args.eye, args.max_dist, args.target)
    out = Path(args.out or Path(args.cloud).with_name("naslonecznienie"))
    out.mkdir(parents=True, exist_ok=True)
    save_map(out / "widocznosc.png", vis.astype(np.float32), 0, 1)
    pct = float(vis.mean()) * 100
    print(f"  Punkt obserwacji: wiersz {row}, kolumna {col}, oko {args.eye} m nad terenem")
    print(f"  Widoczne: {pct:.1f}% obszaru")
    print(f"  ✓ {out / 'widocznosc.png'}")
    send_event(f"analiza widoku: z wysokości {args.eye} m widać {pct:.0f}% obszaru")


def cmd_volume(args) -> None:
    print("\n✦ Cosmos Terrain — objętość i wysokości")
    dsm = build_dsm(args)
    base = args.base if args.base is not None else float(np.percentile(dsm.grid, 5))
    above = np.clip(dsm.grid - base, 0, None)
    vol = float(above.sum()) * dsm.cell ** 2
    print(f"  Poziom odniesienia:  {base:.2f} m "
          + ("(podany)" if args.base is not None else "(5. percentyl = grunt)"))
    print(f"  Objętość ponad nim:  {vol:,.1f} m³".replace(",", " "))
    print(f"  Najwyższy punkt:     {float(above.max()):.2f} m nad poziomem")
    print(f"  Powierzchnia:        {float((above > 0.1).sum()) * dsm.cell ** 2:,.1f} m²"
          .replace(",", " "))
    send_event(f"pomiar z modelu 3D: objętość {vol:.0f} m³, "
               f"wysokość maks. {float(above.max()):.1f} m")


def cmd_compare(args) -> None:
    print("\n✦ Cosmos Terrain — porównanie skanów w czasie")
    a_pts = transform_points(load_ply(Path(args.cloud)), args.scale, args.north, args.up)
    b_pts = transform_points(load_ply(Path(args.cloud_b)), args.scale, args.north, args.up)
    a = DSM.from_points(a_pts, args.cell)
    b = DSM.from_points(b_pts, args.cell)
    h = min(a.shape[0], b.shape[0])
    w = min(a.shape[1], b.shape[1])
    diff = b.grid[:h, :w] - a.grid[:h, :w]

    out = Path(args.out or Path(args.cloud).with_name("naslonecznienie"))
    out.mkdir(parents=True, exist_ok=True)
    lim = max(0.1, float(np.percentile(np.abs(diff), 98)))
    save_map(out / "zmiany.png", np.clip(diff, -lim, lim), -lim, lim, _DIFF_STOPS)

    cell2 = a.cell ** 2
    gained = float(np.clip(diff, 0, None).sum()) * cell2
    lost = float(np.clip(-diff, 0, None).sum()) * cell2
    thr = args.threshold
    print(f"  Przybyło:  {gained:,.1f} m³".replace(",", " "))
    print(f"  Ubyło:     {lost:,.1f} m³".replace(",", " "))
    print(f"  Bilans:    {gained - lost:+,.1f} m³".replace(",", " "))
    print(f"  Zmiany >{thr} m obejmują {float((np.abs(diff) > thr).mean()) * 100:.1f}% obszaru")
    print(f"  ✓ Mapa zmian: {out / 'zmiany.png'}  (zielone = przybyło, czerwone = ubyło)")
    send_event(f"porównanie skanów: +{gained:.0f} m³ / -{lost:.0f} m³ "
               f"(bilans {gained - lost:+.0f} m³)")


# ---------------------------------------------------------------------------
# Samotest — sprawdza astronomię i kierunek cienia (bez plików)
# ---------------------------------------------------------------------------

def cmd_selftest(_args) -> None:
    print("\n✦ Cosmos Terrain — samotest\n")
    ok = True

    # 1) Południe słoneczne w Warszawie w przesileniu letnim
    lat, lon = 52.23, 21.01
    best_el, best_t = -90, None
    t = datetime(2026, 6, 21, tzinfo=timezone.utc)
    for _ in range(24 * 12):
        az, el = solar_position(lat, lon, t)
        if el > best_el:
            best_el, best_t, best_az = el, t, az
        t += timedelta(minutes=5)
    expect_el = 90 - lat + 23.44
    d_el = abs(best_el - expect_el)
    d_az = abs(best_az - 180)
    print(f"  1. Przesilenie, Warszawa: maks. wysokość {best_el:.2f}° "
          f"(oczekiwane ~{expect_el:.2f}°, różnica {d_el:.2f}°)")
    print(f"     Górowanie o {best_t.strftime('%H:%M')} UTC, azymut {best_az:.1f}° "
          f"(oczekiwane ~180° = południe)")
    ok &= d_el < 1.0 and d_az < 2.0

    # 2) Równonoc: wschód ~90°, zachód ~270°
    t = datetime(2026, 3, 20, tzinfo=timezone.utc)
    rise_az = set_az = None
    prev = None
    for _ in range(24 * 60):
        az, el = solar_position(lat, lon, t)
        if prev is not None:
            if prev <= 0 < el:
                rise_az = az
            if prev > 0 >= el:
                set_az = az
        prev = el
        t += timedelta(minutes=1)
    print(f"  2. Równonoc: wschód azymut {rise_az:.1f}° (~90°), "
          f"zachód {set_az:.1f}° (~270°)")
    ok &= abs(rise_az - 90) < 2.0 and abs(set_az - 270) < 2.0

    # 3) Kierunek cienia: słup na płaskim terenie, słońce dokładnie na wschodzie
    n = 61
    grid = np.zeros((n, n))
    grid[30, 30] = 10.0                       # słup 10 m w środku
    dsm = DSM(grid, 1.0, 0.0, float(n))
    sh = shadow_mask(dsm, azimuth=90.0, elevation=30.0, max_dist=40.0)
    west, east = sh[30, 20], sh[30, 40]       # kolumny rosną na wschód
    print(f"  3. Słońce na wschodzie: cień na zachód od słupa = {west}, "
          f"na wschód = {east}  (oczekiwane: True / False)")
    ok &= bool(west) and not bool(east)

    # 4) Słońce na południu -> cień na północ (wiersze rosną na południe)
    sh = shadow_mask(dsm, azimuth=180.0, elevation=30.0, max_dist=40.0)
    north, south = sh[20, 30], sh[40, 30]
    print(f"  4. Słońce na południu: cień na północ = {north}, "
          f"na południe = {south}  (oczekiwane: True / False)")
    ok &= bool(north) and not bool(south)

    # 5) Objętość: sześcian 10x10x2 m na płaskim gruncie = 200 m³
    grid = np.zeros((40, 40))
    grid[10:20, 10:20] = 2.0
    dsm = DSM(grid, 1.0, 0.0, 40.0)
    vol = float(np.clip(dsm.grid - 0.0, 0, None).sum()) * dsm.cell ** 2
    print(f"  5. Objętość bryły 10×10×2 m: {vol:.1f} m³ (oczekiwane 200.0)")
    ok &= abs(vol - 200.0) < 0.01

    # 6) Zapis PNG
    tmp = Path("_terrain_selftest.png")
    save_map(tmp, np.linspace(0, 1, 64).reshape(8, 8), 0, 1)
    good = tmp.exists() and tmp.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    tmp.unlink(missing_ok=True)
    print(f"  6. Zapis PNG: {'OK' if good else 'BŁĄD'}")
    ok &= good

    print("\n  " + ("✓ Wszystkie testy przeszły." if ok else "✗ Któryś test nie przeszedł."))
    sys.exit(0 if ok else 1)


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Cosmos Terrain — nasłonecznienie, cień, widok, objętość, zmiany.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, cloud=True):
        if cloud:
            p.add_argument("cloud", help="plik .ply z photoscan.py (--dense)")
        p.add_argument("--cell", type=float, default=0.5, help="rozdzielczość siatki w metrach (0.5)")
        p.add_argument("--scale", type=float, default=1.0, help="przelicznik na metry, gdy model nie jest georeferencjonowany")
        p.add_argument("--north", type=float, default=0.0, help="obrót w stopniach, by +Y wskazywała północ")
        p.add_argument("--up", choices=["z", "y", "-z"], default="z", help="która oś jest pionem (domyślnie z)")
        p.add_argument("--max-dist", type=float, default=300.0, dest="max_dist", help="zasięg sprawdzania przeszkód w metrach")
        p.add_argument("-o", "--out", help="folder wynikowy")

    p = sub.add_parser("sun", help="mapa godzin słońca w danym dniu")
    common(p)
    p.add_argument("--lat", type=float, required=True, help="szerokość geograficzna")
    p.add_argument("--lon", type=float, required=True, help="długość geograficzna")
    p.add_argument("--date", default=datetime.now().strftime("%Y-%m-%d"), help="dzień RRRR-MM-DD")
    p.add_argument("--step", type=int, default=20, help="krok czasowy w minutach (20)")
    p.set_defaults(func=cmd_sun)

    p = sub.add_parser("shadow", help="cień o konkretnej godzinie")
    common(p)
    p.add_argument("--lat", type=float, required=True)
    p.add_argument("--lon", type=float, required=True)
    p.add_argument("--time", required=True, help='"RRRR-MM-DD GG:MM" (UTC)')
    p.set_defaults(func=cmd_shadow)

    p = sub.add_parser("view", help="co widać z punktu (viewshed)")
    common(p)
    p.add_argument("--row", type=int, help="wiersz punktu obserwacji (domyślnie środek)")
    p.add_argument("--col", type=int, help="kolumna punktu obserwacji (domyślnie środek)")
    p.add_argument("--eye", type=float, default=1.7, help="wysokość oczu nad terenem (1.7 m)")
    p.add_argument("--target", type=float, default=0.0, help="wysokość celu (np. 2 m dla okna)")
    p.set_defaults(func=cmd_view)

    p = sub.add_parser("volume", help="objętość i wysokości")
    common(p)
    p.add_argument("--base", type=float, help="poziom odniesienia w metrach (domyślnie grunt)")
    p.set_defaults(func=cmd_volume)

    p = sub.add_parser("compare", help="porównaj dwa skany")
    common(p)
    p.add_argument("cloud_b", help="drugi (nowszy) plik .ply")
    p.add_argument("--threshold", type=float, default=0.2, help="próg istotnej zmiany w metrach")
    p.set_defaults(func=cmd_compare)

    p = sub.add_parser("selftest", help="sprawdź poprawność obliczeń (bez plików)")
    p.set_defaults(func=cmd_selftest)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

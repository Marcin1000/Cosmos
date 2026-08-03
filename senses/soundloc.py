#!/usr/bin/env python3
"""
Cosmos SoundLoc — słuch przestrzenny z macierzy mikrofonów Kinecta 360.

Kinect ma **cztery mikrofony** ustawione w linii. Z różnicy czasu dotarcia
dźwięku do poszczególnych mikrofonów (TDOA) da się policzyć **kierunek źródła**:
„coś spadło po lewej", „ktoś mówi od strony drzwi".

Cosmos ma już świadomość pozycji z kamery (po lewej / na środku / po prawej).
Ten moduł daje mu to samo dla dźwięku — także w całkowitej ciemności i poza kadrem.

Metoda: GCC-PHAT (uogólniona korelacja wzajemna z wyrównaniem fazowym) dla każdej
pary mikrofonów + interpolacja paraboliczna dla dokładności poniżej próbki,
a na końcu najmniejsze kwadraty po wszystkich parach. To standard w akustyce,
nie heurystyka.

Użycie:
    python soundloc.py --selftest                  # sprawdź poprawność (bez sprzętu)
    python soundloc.py --wav nagranie4kanaly.wav   # policz kierunek z pliku
    python soundloc.py --listen                    # nasłuch na żywo (wymaga sounddevice)

Zależności: numpy (obowiązkowo), sounddevice (tylko do nasłuchu na żywo).
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import wave
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
SPEED_OF_SOUND = 343.0          # m/s przy 20 °C

# Pozycje mikrofonów Kinecta 360 na osi poziomej, w metrach względem środka.
# Macierz jest liniowa — stąd liczymy azymut, nie pełny kierunek 3D.
KINECT_MICS = np.array([-0.113, -0.036, 0.076, 0.113])


def _auth() -> dict:
    """Nagłówek logowania. Wymagany, gdy serwer ma ustawione COSMOS_API_TOKEN
    (czyli zawsze na VPS). Bez niego /api/events odpowiada 401."""
    return {"Authorization": f"Bearer {COSMOS_TOKEN}"} if COSMOS_TOKEN else {}


def send_event(summary: str) -> None:
    try:
        import requests
        requests.post(f"{COSMOS_URL}/api/events", headers=_auth(),
                      json={"type": "słuch", "summary": summary}, timeout=3)
    except Exception:
        pass


def gcc_phat(a: np.ndarray, b: np.ndarray, fs: int, max_tau: float | None = None,
             interp: int = 16, fmin: float = 200.0, fmax: float | None = None
             ) -> tuple[float, float]:
    """Opóźnienie sygnału a względem b w sekundach + pewność (0–1).

    Dwie rzeczy są tu kluczowe i wynikają z fizyki problemu:
      • **Ograniczenie pasma** — PHAT dzieli przez moduł widma, więc w pasmach
        bez energii wzmacnia sam szum numeryczny. Liczymy tylko tam, gdzie
        sygnał realnie jest (domyślnie 200 Hz – 0,45·fs).
      • **Nadpróbkowanie korelacji** — mikrofony Kinecta dzieli kilka centymetrów,
        więc opóźnienia to ułamki próbki. Zero-padding widma daje interpolację
        sinc w czasie i rozdzielczość 1/interp próbki.
    """
    n = 1
    while n < len(a) + len(b):
        n *= 2
    A = np.fft.rfft(a, n=n)
    B = np.fft.rfft(b, n=n)
    R = A * np.conj(B)
    mag = np.abs(R)
    mag[mag < 1e-12] = 1e-12
    R = R / mag                                   # PHAT: normalizacja fazowa

    freqs = np.fft.rfftfreq(n, d=1.0 / fs)
    hi = fmax if fmax is not None else 0.45 * fs
    R = R * ((freqs >= fmin) & (freqs <= hi))

    m = n * interp
    cc = np.fft.irfft(R, n=m)                     # nadpróbkowana korelacja
    cc = np.concatenate((cc[-(m // 2):], cc[:m // 2 + 1]))
    center = m // 2

    limit = center
    if max_tau is not None:
        limit = min(center, int(math.ceil(max_tau * fs * interp)) + interp)
    window = cc[center - limit: center + limit + 1]
    peak = int(np.argmax(np.abs(window)))

    # interpolacja paraboliczna — jeszcze poniżej kroku nadpróbkowania
    shift = 0.0
    if 0 < peak < len(window) - 1:
        y0, y1, y2 = window[peak - 1], window[peak], window[peak + 1]
        den = y0 - 2 * y1 + y2
        if abs(den) > 1e-12:
            shift = 0.5 * (y0 - y2) / den

    delay_samples = ((peak - limit) + shift) / interp
    total = float(np.sum(np.abs(window))) or 1.0
    confidence = float(np.abs(window[peak]) / total * len(window))
    return delay_samples / fs, min(1.0, confidence)


def direction_from_channels(chans: np.ndarray, fs: int,
                            mics: np.ndarray = KINECT_MICS) -> dict:
    """chans: tablica (kanały × próbki). Zwraca azymut i pewność.

    Azymut: 0° = wprost przed macierzą, wartości ujemne = w lewo, dodatnie = w prawo.
    """
    nch = chans.shape[0]
    if nch < 2:
        raise ValueError("Potrzebne co najmniej 2 kanały.")
    mics = mics[:nch]

    rows, rhs, confs = [], [], []
    for i in range(nch):
        for j in range(i + 1, nch):
            dx = mics[i] - mics[j]
            if abs(dx) < 1e-6:
                continue
            max_tau = abs(dx) / SPEED_OF_SOUND
            tau, conf = gcc_phat(chans[i], chans[j], fs, max_tau=max_tau * 1.2)
            # tau = -dx * sin(theta) / c   →   sin(theta) = -tau * c / dx
            rows.append([dx])
            rhs.append(-tau * SPEED_OF_SOUND)
            confs.append(conf)

    A = np.array(rows)
    b = np.array(rhs)
    sin_theta, *_ = np.linalg.lstsq(A, b, rcond=None)
    s = float(np.clip(sin_theta[0], -1.0, 1.0))
    azimuth = math.degrees(math.asin(s))
    return {
        "azymut_deg": round(azimuth, 1),
        "kierunek": describe(azimuth),
        "pewnosc": round(float(np.mean(confs)), 3),
        "par_mikrofonow": len(rows),
    }


def describe(az: float) -> str:
    if az < -50:
        return "daleko po lewej"
    if az < -15:
        return "po lewej"
    if az <= 15:
        return "na wprost"
    if az <= 50:
        return "po prawej"
    return "daleko po prawej"


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as w:
        fs = w.getframerate()
        nch = w.getnchannels()
        width = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    dtype = {1: np.int8, 2: np.int16, 4: np.int32}.get(width)
    if dtype is None:
        raise ValueError(f"Nieobsługiwana szerokość próbki: {width} bajtów")
    data = np.frombuffer(raw, dtype=dtype).astype(np.float64)
    data = data.reshape(-1, nch).T
    peak = np.max(np.abs(data)) or 1.0
    return data / peak, fs


def cmd_wav(path: Path) -> None:
    chans, fs = read_wav(path)
    print(f"\n✦ Cosmos SoundLoc — {path.name}")
    print(f"  Kanałów: {chans.shape[0]}, próbkowanie: {fs} Hz, "
          f"długość: {chans.shape[1] / fs:.2f} s")
    res = direction_from_channels(chans, fs)
    print(f"  Kierunek źródła: {res['azymut_deg']:+.1f}°  → {res['kierunek']}")
    print(f"  Pewność: {res['pewnosc']:.2f} (z {res['par_mikrofonow']} par mikrofonów)")
    send_event(f"słyszę dźwięk {res['kierunek']} ({res['azymut_deg']:+.0f}°)")


def cmd_list_devices() -> None:
    """Wypisz wejścia audio. Macierz Kinecta widać jako urządzenie 4-kanałowe."""
    try:
        import sounddevice as sd
    except ImportError:
        sys.exit("Wymaga:  pip install sounddevice")
    print("\n  #  kan.  nazwa")
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] > 0:
            mark = " ← macierz mikrofonów?" if d["max_input_channels"] >= 4 else ""
            print(f"  {i:<3}{d['max_input_channels']:<5} {d['name']}{mark}")
    print("\n  Numer podaj przez --device, np.:  python soundloc.py --listen --device 3\n")


def resolve_device(spec):
    """Numer urządzenia albo fragment nazwy (np. 'Kinect'). Puste = domyślne."""
    if not spec:
        return None
    try:
        return int(spec)
    except ValueError:
        pass
    import sounddevice as sd
    matches = [i for i, d in enumerate(sd.query_devices())
               if d["max_input_channels"] > 0 and spec.lower() in d["name"].lower()]
    if not matches:
        sys.exit(f"Nie znalazłem wejścia audio pasującego do „{spec}”. "
                 f"Lista:  python soundloc.py --list-devices")
    return matches[0]


def cmd_listen(args) -> None:
    try:
        import sounddevice as sd
    except ImportError:
        sys.exit("Nasłuch na żywo wymaga:  pip install sounddevice")
    fs = args.rate
    block = int(fs * args.window)
    device = resolve_device(args.device)
    name = sd.query_devices(device)["name"] if device is not None else "domyślne wejście"
    print(f"\n✦ Cosmos SoundLoc — nasłuch ({args.channels} kanałów, {fs} Hz)")
    print(f"  Urządzenie: {name}. Ctrl+C kończy.\n")
    try:
        while True:
            rec = sd.rec(block, samplerate=fs, channels=args.channels,
                         device=device, dtype="float64")
            sd.wait()
            chans = rec.T
            level = float(np.sqrt(np.mean(chans ** 2)))
            if level < args.gate:
                continue
            res = direction_from_channels(chans, fs)
            if res["pewnosc"] < args.min_conf:
                continue
            print(f"  {res['azymut_deg']:+6.1f}°  {res['kierunek']:<18} "
                  f"pewność {res['pewnosc']:.2f}  poziom {level:.3f}")
            send_event(f"dźwięk {res['kierunek']} ({res['azymut_deg']:+.0f}°)")
    except KeyboardInterrupt:
        print("\n  Zatrzymano.")


def cmd_selftest() -> None:
    """Sprawdza estymator na sygnale syntetycznym o ZNANYM kierunku."""
    print("\n✦ Cosmos SoundLoc — samotest\n")
    fs = 16000
    dur = 0.5
    rng = np.random.default_rng(7)
    n = int(fs * dur)
    # szerokopasmowy sygnał (jak uderzenie/upadek) — lekko wygładzony, ale
    # z realną energią w całym paśmie roboczym estymatora
    base = rng.normal(0, 1, n)
    kernel = np.hanning(5) / np.sum(np.hanning(5))
    base = np.convolve(base, kernel, mode="same")

    ok = True
    print("  Odtwarzanie znanych kierunków z syntetycznych opóźnień:")
    for truth in (-60.0, -30.0, -10.0, 0.0, 10.0, 30.0, 60.0):
        s = math.sin(math.radians(truth))
        chans = []
        for x in KINECT_MICS:
            delay_s = -x * s / SPEED_OF_SOUND       # ten sam model, co w estymatorze
            shift = delay_s * fs
            # przesunięcie w dziedzinie częstotliwości = dokładne, ułamkowe opóźnienie
            spec = np.fft.rfft(base)
            freqs = np.fft.rfftfreq(len(base))
            spec = spec * np.exp(-2j * math.pi * freqs * shift)
            chans.append(np.fft.irfft(spec, n=len(base)))
        res = direction_from_channels(np.array(chans), fs)
        err = abs(res["azymut_deg"] - truth)
        good = err < 3.0
        ok &= good
        print(f"    zadano {truth:+6.1f}°  →  wykryto {res['azymut_deg']:+6.1f}°  "
              f"(błąd {err:4.1f}°)  {'OK' if good else 'BŁĄD'}")

    # przypadek realistyczny: niezależny szum w każdym mikrofonie (SNR ≈ 10 dB)
    print("\n  Z szumem mikrofonów (SNR ≈ 10 dB) — tak będzie w praktyce:")
    errs = []
    for truth in (-45.0, -20.0, 0.0, 20.0, 45.0):
        s = math.sin(math.radians(truth))
        chans = []
        for x in KINECT_MICS:
            shift = (-x * s / SPEED_OF_SOUND) * fs
            spec = np.fft.rfft(base)
            freqs = np.fft.rfftfreq(len(base))
            ch = np.fft.irfft(spec * np.exp(-2j * math.pi * freqs * shift), n=len(base))
            ch = ch + rng.normal(0, np.std(base) * 0.316, len(ch))   # 10 dB SNR
            chans.append(ch)
        res = direction_from_channels(np.array(chans), fs)
        err = abs(res["azymut_deg"] - truth)
        errs.append(err)
        print(f"    zadano {truth:+6.1f}°  →  wykryto {res['azymut_deg']:+6.1f}°  (błąd {err:4.1f}°)")
    mean_err = sum(errs) / len(errs)
    print(f"    średni błąd przy szumie: {mean_err:.1f}°  (próg akceptacji: 5°)")
    ok &= mean_err < 5.0

    # opis słowny
    print(f"\n  Opis kierunku: -70°→„{describe(-70)}", f"0°→„{describe(0)}",
          f"40°→„{describe(40)}")
    ok &= describe(-70) == "daleko po lewej" and describe(0) == "na wprost"

    # cisza / brak sygnału nie może wywalić programu
    try:
        direction_from_channels(np.zeros((4, 1000)), fs)
        print("  Sygnał zerowy: obsłużony bez błędu — OK")
    except Exception as e:                                    # pragma: no cover
        print(f"  Sygnał zerowy: WYJĄTEK {e}")
        ok = False

    print("\n  " + ("✓ Wszystkie testy przeszły." if ok else "✗ Któryś test nie przeszedł."))
    sys.exit(0 if ok else 1)


def main() -> None:
    ap = argparse.ArgumentParser(description="Kierunek źródła dźwięku z macierzy mikrofonów.")
    ap.add_argument("--selftest", action="store_true", help="sprawdź poprawność bez sprzętu")
    ap.add_argument("--wav", help="plik WAV wielokanałowy (np. z Kinecta)")
    ap.add_argument("--listen", action="store_true", help="nasłuch na żywo")
    ap.add_argument("--list-devices", action="store_true", dest="list_devices",
                    help="wypisz wejścia audio i ich numery")
    ap.add_argument("--device", help="numer wejścia albo fragment nazwy, np. 'Kinect'")
    ap.add_argument("--channels", type=int, default=4,
                    help="liczba kanałów; macierz Kinecta 360 ma 4")
    ap.add_argument("--rate", type=int, default=16000)
    ap.add_argument("--window", type=float, default=0.5, help="okno analizy w sekundach")
    ap.add_argument("--gate", type=float, default=0.01, help="próg głośności (RMS)")
    ap.add_argument("--min-conf", type=float, default=0.15, dest="min_conf")
    args = ap.parse_args()

    if args.selftest:
        cmd_selftest()
    elif args.list_devices:
        cmd_list_devices()
    elif args.wav:
        cmd_wav(Path(args.wav))
    elif args.listen:
        cmd_listen(args)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()

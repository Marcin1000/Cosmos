#!/usr/bin/env python3
"""
Cosmos Wake Listener — lokalne słowo aktywujące „Hej, Kosmos".

Nasłuchuje mikrofonu w tle (nawet gdy przeglądarka jest zamknięta) i po
wykryciu słowa aktywującego wysyła zdarzenie do Cosmosa. Dzięki temu
asystent może „budzić się" bez otwartej karty — inaczej niż wbudowane
w przeglądarkę Web Speech API, które działa tylko przy otwartym Cosmosie.

Wymagania:
    pip install openwakeword sounddevice numpy requests

Uruchomienie:
    python senses/wake_listener.py

Zmienne środowiskowe:
    COSMOS_URL   adres Cosmosa (domyślnie http://localhost:3000)
    COSMOS_TOKEN COSMOS_API_TOKEN serwera — wymagany, gdy Cosmos ma hasło
    WAKE_MODEL   nazwa modelu słowa aktywującego (domyślnie 'hey_jarvis' —
                 openWakeWord ma gotowe modele; własne „Hej Kosmos" możesz
                 wytrenować wg dokumentacji openWakeWord)

Uwaga: openWakeWord nie ma gotowego polskiego „Hej Kosmos" — do czasu
własnego modelu użyj gotowego (np. 'hey_jarvis') albo trybu głosowego
w przeglądarce (przycisk fal dźwiękowych w Cosmosie).
"""

import os
import time

import numpy as np
import requests

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
    import sounddevice as sd
    from openwakeword.model import Model
except ImportError:
    raise SystemExit(
        _dep_error("openwakeword sounddevice numpy requests")
    )

COSMOS_URL = os.environ.get("COSMOS_URL", "http://localhost:3000").rstrip("/")
COSMOS_TOKEN = os.environ.get("COSMOS_TOKEN", "")
WAKE_MODEL = os.environ.get("WAKE_MODEL", "hey_jarvis")
SAMPLE_RATE = 16000
CHUNK = 1280  # 80 ms przy 16 kHz


def _auth() -> dict:
    """Nagłówek logowania. Wymagany, gdy serwer ma ustawione COSMOS_API_TOKEN
    (czyli zawsze na VPS). Bez niego /api/events odpowiada 401."""
    return {"Authorization": f"Bearer {COSMOS_TOKEN}"} if COSMOS_TOKEN else {}


def notify():
    try:
        requests.post(f"{COSMOS_URL}/api/events", headers=_auth(),
                      json={"type": "wake", "summary": "wykryto słowo aktywujące — asystent gotowy"},
                      timeout=5)
        print("→ wake!")
    except requests.RequestException as e:
        print(f"! nie wysłano zdarzenia: {e}")


def main():
    model = Model(wakeword_models=[WAKE_MODEL])
    print(f"✦ Cosmos Wake Listener — model '{WAKE_MODEL}', cel: {COSMOS_URL}")
    print("  Nasłuchuję… (Ctrl+C aby zakończyć)")
    last = 0.0
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=CHUNK) as stream:
        while True:
            audio, _ = stream.read(CHUNK)
            preds = model.predict(np.frombuffer(audio, dtype=np.int16))
            for name, score in preds.items():
                if score > 0.5 and time.time() - last > 3:  # próg + odstęp 3 s
                    last = time.time()
                    print(f"  [{name}] {score:.2f}")
                    notify()


if __name__ == "__main__":
    main()

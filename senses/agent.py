#!/usr/bin/env python3
"""
Cosmos – agent zmysłów na Twoim komputerze.

Łączy ten komputer z Twoim kontem w Cosmosie, żeby rozpoznawanie mowy
(Whisper), wykrywanie obiektów, sylwetka, Kinect i wyciąganie tekstu liczyły
się na TWOIM sprzęcie – nie na cudzym.

Wszystkim sterujesz z aplikacji (Ustawienia → Zmysły): włączanie
i wyłączanie zmysłów, obserwatora kamery i Kinecta, instalacja pakietów,
aktualizacja. Wiersz poleceń jest potrzebny raz – do pierwszego połączenia,
a i to polecenie podaje Ci aplikacja.

    python agent.py --serwer https://cosmosai.live --kod 123456 --autostart --w-tle

Połączenie jest WYCHODZĄCE (agent sam pyta serwer o zlecenia), więc nie
trzeba przekierowywać portów ani stawiać VPN-a. Usługa zmysłów słucha tylko
na 127.0.0.1 – z sieci nikt się do niej nie dobierze.

Tylko biblioteka standardowa Pythona (3.9+). Pakiety zmysłów (Whisper,
YOLO…) instalują się do osobnego środowiska w ~/.cosmos/venv – przyciskiem
w aplikacji.

Inne polecenia:
    python agent.py --odlacz        zapomnij połączenie i usuń autostart
    python agent.py --stan          pokaż, z kim jest połączony
"""

import argparse
import base64
import hashlib
import json
import os
import platform
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

KATALOG = Path(os.environ.get("COSMOS_AGENT_DIR", Path.home() / ".cosmos"))
KONFIG = KATALOG / "agent.json"
PLIKI = KATALOG / "senses"
LOGI = KATALOG / "logi"
VENV = KATALOG / "venv"
GLOSY = KATALOG / "glosy"
PORT_ZMYSLOW = int(os.environ.get("SENSES_PORT", 7060))
PORT_ZAMKA = int(os.environ.get("COSMOS_AGENT_LOCK_PORT", 7069))
TETNO_S = 10

# Ścieżki usługi zmysłów, które agent przekaże dalej. Nic spoza tej listy.
DOZWOLONE = ("/health", "/stt", "/tts", "/detect", "/pose", "/extract", "/embed", "/upscale", "/ptak", "/kinect/")

# Składnik → skrypt. Nazwy muszą się zgadzać z SKLADNIKI w lib/agent-zmyslow.js.
SKLADNIKI = {
    "zmysly": "service.py",
    "obserwator": "watcher.py",
    "kinect": "kinect_watcher.py",
}

# Pakiety instalowane przyciskiem. Agent nie wykona pip dla niczego spoza tej listy.
PAKIETY = {
    "rdzen": (["fastapi", "uvicorn", "python-multipart", "numpy", "requests"], "fastapi"),
    "dokumenty": (["pypdf", "python-docx", "openpyxl", "python-pptx"], "pypdf"),
    "sluch": (["faster-whisper"], "faster_whisper"),
    "glos": (["piper-tts"], "piper"),
    "wzrok": (["ultralytics", "opencv-python"], "ultralytics"),
    "cialo": (["mediapipe"], "mediapipe"),
    "pamiec": (["sentence-transformers"], "sentence_transformers"),
}

# Polski głos dla Piper – pobierany razem z pakietem „glos”.
GLOS_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx"

WINDOWS = os.name == "nt"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- konfiguracja

def czytaj_konfig():
    try:
        return json.loads(KONFIG.read_text(encoding="utf-8"))
    except Exception:
        return {}


def zapisz_konfig(k):
    KATALOG.mkdir(parents=True, exist_ok=True)
    tmp = KONFIG.with_suffix(".tmp")
    tmp.write_text(json.dumps(k, indent=2), encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, KONFIG)


# ------------------------------------------------------------------------ HTTP

def zapytanie(serwer, sciezka, metoda="GET", dane=None, token="", czas=30, surowe=False):
    naglowki = {"User-Agent": "cosmos-agent"}
    cialo = None
    if dane is not None:
        cialo = json.dumps(dane).encode("utf-8")
        naglowki["Content-Type"] = "application/json"
    if token:
        naglowki["Authorization"] = "Bearer " + token
    req = urllib.request.Request(serwer + sciezka, data=cialo, method=metoda, headers=naglowki)
    with urllib.request.urlopen(req, timeout=czas) as r:
        tresc = r.read()
        if surowe:
            return r.status, tresc
        return r.status, (json.loads(tresc.decode("utf-8")) if tresc else {})


# --------------------------------------------------------------------- python

def python_venv():
    p = VENV / ("Scripts/python.exe" if WINDOWS else "bin/python")
    return str(p) if p.exists() else ""


def python_skladnikow():
    """Python, którym startują zmysły: z venv, gdy jest, inaczej ten sam co agent."""
    return python_venv() or sys.executable


def zainstalowane():
    """Które pakiety są w środowisku zmysłów (sprawdzane w nim, nie w agencie)."""
    moduly = {nazwa: modul for nazwa, (_, modul) in PAKIETY.items()}
    kod = ("import importlib.util, json, sys; m = json.loads(sys.argv[1]); "
           "print(json.dumps({k: bool(importlib.util.find_spec(v)) for k, v in m.items()}))")
    try:
        out = subprocess.run([python_skladnikow(), "-c", kod, json.dumps(moduly)],
                             capture_output=True, text=True, timeout=60, **bez_okna())
        return json.loads(out.stdout.strip() or "{}")
    except Exception:
        return {k: False for k in PAKIETY}


def ogon_logu(nazwa, linii=6):
    """Ostatnie linie dziennika składnika – żeby w aplikacji było widać, czemu padł."""
    try:
        with open(LOGI / f"{nazwa}.log", "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - 4000))
            return "\n".join(f.read().decode("utf-8", "replace").splitlines()[-linii:])[:1200]
    except OSError:
        return ""


def bez_okna():
    """Na Windowsie podprocesy bez migającego okna konsoli."""
    if WINDOWS:
        return {"creationflags": 0x08000000}  # CREATE_NO_WINDOW
    return {}


# ------------------------------------------------------------------ składniki

class Skladniki:
    def __init__(self, agent):
        self.agent = agent
        self.procesy = {}
        self.starty = {}
        self.zamek = threading.Lock()

    def dziala(self, nazwa):
        p = self.procesy.get(nazwa)
        return bool(p and p.poll() is None)

    def stan(self):
        wynik = {}
        for nazwa, skrypt in SKLADNIKI.items():
            p = self.procesy.get(nazwa)
            wynik[nazwa] = {
                "dziala": self.dziala(nazwa),
                "jest": (PLIKI / skrypt).exists(),
                "kodWyjscia": None if (not p or p.poll() is None) else p.returncode,
            }
            if wynik[nazwa]["kodWyjscia"] not in (None, 0):
                wynik[nazwa]["log"] = ogon_logu(nazwa)
        return wynik

    def uruchom(self, nazwa):
        with self.zamek:
            if self.dziala(nazwa):
                return
            skrypt = PLIKI / SKLADNIKI[nazwa]
            if not skrypt.exists():
                log(f"brak {skrypt.name} – pobieram pliki")
                self.agent.aktualizuj_pliki()
            LOGI.mkdir(parents=True, exist_ok=True)
            env = dict(os.environ)
            env.update({
                "PYTHONIOENCODING": "utf-8",
                "SENSES_HOST": "127.0.0.1",
                "SENSES_PORT": str(PORT_ZMYSLOW),
                "COSMOS_URL": self.agent.serwer,
                "COSMOS_TOKEN": self.agent.token,
            })
            glos = next(iter(sorted(GLOSY.glob("*.onnx"))), None) if GLOSY.exists() else None
            if glos and not env.get("PIPER_VOICE"):
                env["PIPER_VOICE"] = str(glos)
            self.starty[nazwa] = time.time()
            plik_logu = open(LOGI / f"{nazwa}.log", "ab")
            self.procesy[nazwa] = subprocess.Popen(
                [python_skladnikow(), str(skrypt)], cwd=str(PLIKI), env=env,
                stdout=plik_logu, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, **bez_okna())
            log(f"włączono: {nazwa}")

    def zatrzymaj(self, nazwa):
        with self.zamek:
            p = self.procesy.pop(nazwa, None)
            if not p or p.poll() is not None:
                return
            p.terminate()
            try:
                p.wait(timeout=8)
            except subprocess.TimeoutExpired:
                p.kill()
            log(f"wyłączono: {nazwa}")

    def uzgodnij(self, chce):
        for nazwa in SKLADNIKI:
            # Składnik, który padł zaraz po starcie (brak pakietu, brak kamery),
            # nie jest wznawiany co tętno – najwyżej raz na minutę.
            if chce.get(nazwa) and not self.dziala(nazwa) and nazwa in self.procesy \
                    and time.time() - self.starty.get(nazwa, 0) < 60:
                continue
            if chce.get(nazwa) and not self.dziala(nazwa):
                try:
                    self.uruchom(nazwa)
                except Exception as e:
                    log(f"nie udało się włączyć {nazwa}: {e}")
            elif not chce.get(nazwa) and self.dziala(nazwa):
                self.zatrzymaj(nazwa)

    def zatrzymaj_wszystko(self):
        for nazwa in list(self.procesy):
            self.zatrzymaj(nazwa)


# ---------------------------------------------------------------------- agent

class Agent:
    def __init__(self, konfig):
        self.serwer = konfig["serwer"].rstrip("/")
        self.token = konfig["token"]
        self.konfig = konfig
        self.skladniki = Skladniki(self)
        self.chce = konfig.get("chce", {})
        self.pakiety = {}
        self.instalacja = None
        self.koniec = threading.Event()
        self.budzik = threading.Event()
        self.wersja = ""
        self.robotnicy = threading.Semaphore(4)

    # --- stan dla serwera
    def zdrowie(self):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT_ZMYSLOW}/health", timeout=2) as r:
                return True, json.loads(r.read().decode("utf-8") or "{}")
        except Exception:
            return False, {}

    def wyslij_stan(self):
        online, caps = self.zdrowie()
        dane = {
            "online": online, "caps": caps, "wersja": self.wersja,
            "skladniki": self.skladniki.stan(), "pakiety": self.pakiety,
            "instalacja": self.instalacja, "system": f"{platform.system()} {platform.release()}"[:40],
            "autostart": autostart_jest(),
        }
        _, odp = zapytanie(self.serwer, "/api/agent/stan", "POST", dane, self.token, czas=15)
        chce = odp.get("chce")
        if isinstance(chce, dict) and chce != self.chce:
            self.chce = chce
            self.konfig["chce"] = chce
            zapisz_konfig(self.konfig)
        self.skladniki.uzgodnij(self.chce)
        return odp

    def tetno(self):
        while not self.koniec.is_set():
            # Ponowne sparowanie (nowy kod przy działającym agencie) zapisuje nowy
            # token – działający agent przełącza się na niego sam.
            if czytaj_konfig().get("token") not in (None, self.token):
                self.restart()
            try:
                self.wyslij_stan()
            except urllib.error.HTTPError as e:
                if e.code in (401, 410):
                    log("Serwer nie zna już tego komputera – sparuj go ponownie kodem z Ustawień.")
                    self.koniec.set()
                    break
            except Exception as e:
                log(f"stan: {e}")
            self.budzik.wait(TETNO_S)
            self.budzik.clear()

    # --- zlecenia
    def petla(self):
        przerwa = 1
        while not self.koniec.is_set():
            try:
                status, odp = zapytanie(self.serwer, "/api/agent/czekaj", token=self.token, czas=40)
                przerwa = 1
                if status == 204 or not odp:
                    continue
                zad = odp.get("zadanie")
                if zad:
                    self.robotnicy.acquire()
                    threading.Thread(target=self.wykonaj, args=(zad,), daemon=True).start()
            except urllib.error.HTTPError as e:
                if e.code in (401, 410):
                    log("Serwer nie zna już tego komputera – sparuj go ponownie kodem z Ustawień.")
                    self.koniec.set()
                    break
                time.sleep(przerwa)
                przerwa = min(przerwa * 2, 30)
            except Exception:
                # Brak sieci, serwer w restarcie – czekamy coraz dłużej, do pół minuty.
                time.sleep(przerwa)
                przerwa = min(przerwa * 2, 30)

    def wykonaj(self, zad):
        try:
            if zad.get("sterowanie"):
                self.steruj(zad)
            else:
                self.przekaz(zad)
        except Exception as e:
            log(f"zlecenie: {e}")
        finally:
            self.robotnicy.release()

    def przekaz(self, zad):
        """Zlecenie zmysłów: wywołaj lokalną usługę i odeślij wynik."""
        sciezka = str(zad.get("sciezka", ""))
        if not sciezka.startswith(DOZWOLONE):
            return self.odeslij(zad["id"], 403, "application/json", json.dumps({"error": "Ścieżka niedozwolona."}).encode())
        cialo = base64.b64decode(zad.get("cialo") or "") or None
        req = urllib.request.Request(f"http://127.0.0.1:{PORT_ZMYSLOW}{sciezka}", data=cialo,
                                     method=zad.get("metoda", "GET"), headers=zad.get("naglowki") or {})
        try:
            with urllib.request.urlopen(req, timeout=900) as r:
                return self.odeslij(zad["id"], r.status, r.headers.get("content-type", ""), r.read())
        except urllib.error.HTTPError as e:
            return self.odeslij(zad["id"], e.code, e.headers.get("content-type", ""), e.read())
        except Exception:
            blad = {"error": "Zmysły na tym komputerze są wyłączone – włącz je w Ustawieniach → Zmysły."}
            return self.odeslij(zad["id"], 503, "application/json", json.dumps(blad).encode())

    def odeslij(self, id_, status, typ, tresc):
        dane = {"status": status, "typ": typ or "application/octet-stream", "cialo": base64.b64encode(tresc or b"").decode()}
        try:
            zapytanie(self.serwer, f"/api/agent/wynik?id={id_}", "POST", dane, self.token, czas=120)
        except Exception as e:
            log(f"wynik: {e}")

    def steruj(self, zad):
        polecenie = zad.get("polecenie")
        if polecenie == "uzgodnij":
            chce = zad.get("chce") or {}
            self.chce = {k: bool(chce.get(k)) for k in SKLADNIKI}
            self.konfig["chce"] = self.chce
            zapisz_konfig(self.konfig)
            self.skladniki.uzgodnij(self.chce)
        elif polecenie == "instaluj":
            self.instaluj([p for p in zad.get("pakiety") or [] if p in PAKIETY])
        elif polecenie == "aktualizuj":
            if self.aktualizuj_pliki():
                self.restart()
        elif polecenie == "autostart":
            if zad.get("wlacz", True):
                autostart_wlacz()
            else:
                autostart_wylacz()
        self.budzik.set()

    # --- instalacja pakietów
    def instaluj(self, pakiety):
        if not pakiety or (self.instalacja and self.instalacja.get("trwa")):
            return
        self.instalacja = {"trwa": True, "pakiety": pakiety, "ok": None, "log": "", "od": int(time.time())}
        self.budzik.set()
        ostatnie = []

        def dopisz(linia):
            ostatnie.append(linia.rstrip()[:200])
            del ostatnie[:-12]
            self.instalacja["log"] = "\n".join(ostatnie)

        try:
            if not python_venv():
                dopisz("Tworzę środowisko ~/.cosmos/venv…")
                # --system-site-packages: pakiety zainstalowane wcześniej ręcznie
                # (torch z CUDA, freenect) zostają widoczne dla zmysłów.
                subprocess.run([sys.executable, "-m", "venv", "--system-site-packages", str(VENV)], check=True,
                               capture_output=True, text=True, **bez_okna())
            py = python_venv()
            lista = []
            for p in ["rdzen"] + [p for p in pakiety if p != "rdzen"]:
                lista += PAKIETY[p][0]
            dopisz("pip install " + " ".join(lista))
            proc = subprocess.Popen([py, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check"] + lista,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                    encoding="utf-8", errors="replace", **bez_okna())
            ile = 0
            for linia in proc.stdout:
                dopisz(linia)
                ile += 1
                if ile % 5 == 0:
                    self.budzik.set()
            ok = proc.wait() == 0
            if ok and "glos" in pakiety:
                self.pobierz_glos(dopisz)
            self.instalacja.update({"trwa": False, "ok": ok})
            if not ok:
                self.instalacja["blad"] = "pip zakończył się błędem – szczegóły w dzienniku niżej."
        except subprocess.CalledProcessError as e:
            dopisz(e.stderr or str(e))
            self.instalacja.update({"trwa": False, "ok": False,
                                    "blad": "Nie udało się utworzyć środowiska Pythona (Debian/Ubuntu: sudo apt install python3-venv)."})
        except Exception as e:
            self.instalacja.update({"trwa": False, "ok": False, "blad": str(e)[:200]})
        self.pakiety = zainstalowane()
        # Nowe pakiety działają dopiero po ponownym starcie zmysłów.
        if self.skladniki.dziala("zmysly"):
            self.skladniki.zatrzymaj("zmysly")
            self.skladniki.uzgodnij(self.chce)
        self.budzik.set()

    def pobierz_glos(self, dopisz):
        GLOSY.mkdir(parents=True, exist_ok=True)
        for rozsz in ("", ".json"):
            cel = GLOSY / ("pl_PL-darkman-medium.onnx" + rozsz)
            if cel.exists():
                continue
            dopisz(f"pobieram głos {cel.name}…")
            try:
                urllib.request.urlretrieve(GLOS_URL + rozsz, str(cel) + ".tmp")
                os.replace(str(cel) + ".tmp", cel)
            except Exception as e:
                dopisz(f"głos: {e}")

    # --- pliki
    def aktualizuj_pliki(self):
        """Dociągnij pliki zmysłów, które różnią się od serwera. True = zmienił się agent."""
        PLIKI.mkdir(parents=True, exist_ok=True)
        _, odp = zapytanie(self.serwer, "/api/agent/pliki", token=self.token)
        zmieniony_agent = False
        for f in odp.get("pliki", []):
            nazwa = os.path.basename(str(f.get("nazwa", "")))
            if nazwa != f.get("nazwa") or not nazwa:
                continue
            cel = Path(__file__).resolve() if nazwa == "agent.py" else PLIKI / nazwa
            try:
                obecny = hashlib.sha256(cel.read_bytes()).hexdigest()
            except OSError:
                obecny = ""
            if obecny == f.get("sha256"):
                continue
            _, tresc = zapytanie(self.serwer, f"/api/agent/plik?nazwa={nazwa}", token=self.token, surowe=True, czas=60)
            if hashlib.sha256(tresc).hexdigest() != f.get("sha256"):
                log(f"{nazwa}: skrót się nie zgadza – pomijam")
                continue
            tmp = cel.with_suffix(cel.suffix + ".tmp")
            tmp.write_bytes(tresc)
            os.replace(tmp, cel)
            log(f"zaktualizowano {nazwa}")
            zmieniony_agent = zmieniony_agent or nazwa == "agent.py"
        self.wersja = wersja_wlasna()
        return zmieniony_agent

    def restart(self):
        log("nowa wersja agenta – uruchamiam ponownie")
        self.skladniki.zatrzymaj_wszystko()
        zwolnij_zamek()
        if WINDOWS:
            # os.execv na Windowsie nie podmienia procesu, tylko startuje nowy
            # obok – robimy to jawnie i kończymy ten.
            uruchom_w_tle()
            os._exit(0)
        os.execv(sys.executable, [sys.executable, str(Path(__file__).resolve())])

    def start(self):
        self.wersja = wersja_wlasna()
        try:
            self.aktualizuj_pliki()
        except Exception as e:
            log(f"pliki: {e}")
        self.pakiety = zainstalowane()
        threading.Thread(target=self.tetno, daemon=True).start()
        log(f"połączono z {self.serwer} – czekam na zlecenia")
        try:
            self.petla()
        finally:
            self.skladniki.zatrzymaj_wszystko()


def wersja_wlasna():
    try:
        return hashlib.sha256(Path(__file__).resolve().read_bytes()).hexdigest()[:12]
    except OSError:
        return ""


# ------------------------------------------------------------------ autostart

def _pythonw():
    if WINDOWS:
        w = Path(sys.executable).with_name("pythonw.exe")
        if w.exists():
            return str(w)
    return sys.executable


def _plik_autostartu():
    if WINDOWS:
        return Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs/Startup/cosmos-agent.vbs"
    if sys.platform == "darwin":
        return Path.home() / "Library/LaunchAgents/live.cosmosai.agent.plist"
    return Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "autostart/cosmos-agent.desktop"


def autostart_jest():
    return _plik_autostartu().exists()


def autostart_wlacz():
    plik = _plik_autostartu()
    plik.parent.mkdir(parents=True, exist_ok=True)
    agent = str(Path(__file__).resolve())
    if WINDOWS:
        # VBScript uruchamia agenta bez okna konsoli.
        plik.write_text(f'CreateObject("WScript.Shell").Run """{_pythonw()}"" ""{agent}""", 0, False\r\n', encoding="utf-16")
    elif sys.platform == "darwin":
        plik.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>live.cosmosai.agent</string>
<key>ProgramArguments</key><array><string>{sys.executable}</string><string>{agent}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
""", encoding="utf-8")
    else:
        plik.write_text(f"""[Desktop Entry]
Type=Application
Name=Cosmos – agent zmysłów
Exec="{sys.executable}" "{agent}"
X-GNOME-Autostart-enabled=true
NoDisplay=true
""", encoding="utf-8")
    log(f"autostart: {plik}")


def autostart_wylacz():
    try:
        _plik_autostartu().unlink()
    except FileNotFoundError:
        pass


# ------------------------------------------------------------------- w tle

_zamek = None


def zajmij_zamek():
    """Jeden agent na komputer: zajęty port pętli zwrotnej = już działa."""
    global _zamek
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", PORT_ZAMKA))
        s.listen(1)
    except OSError:
        s.close()
        return False
    _zamek = s
    return True


def zwolnij_zamek():
    global _zamek
    if _zamek:
        _zamek.close()
        _zamek = None


def uruchom_w_tle():
    """Odłącz się od terminala – okno można zamknąć, agent działa dalej."""
    LOGI.mkdir(parents=True, exist_ok=True)
    wyjscie = open(LOGI / "agent.log", "ab")
    polecenie = [_pythonw(), str(Path(__file__).resolve())]
    if WINDOWS:
        subprocess.Popen(polecenie, stdout=wyjscie, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         creationflags=0x00000008 | 0x00000200 | 0x08000000)  # DETACHED | NEW_GROUP | NO_WINDOW
    else:
        subprocess.Popen(polecenie, stdout=wyjscie, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         start_new_session=True)


# ------------------------------------------------------------------------ main

def paruj(serwer, kod):
    nazwa = socket.gethostname()[:60] or "komputer"
    try:
        _, odp = zapytanie(serwer, "/api/agent/paruj", "POST", {"kod": kod, "nazwa": nazwa})
    except urllib.error.HTTPError as e:
        try:
            blad = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            blad = ""
        sys.exit(f"Cosmos: nie udało się połączyć (HTTP {e.code}). {blad}")
    except Exception as e:
        sys.exit(f"Cosmos: serwer {serwer} nie odpowiada ({e}).")
    k = czytaj_konfig()
    k.update({"serwer": serwer, "token": odp["token"], "id": odp.get("id"), "osoba": odp.get("osoba", "")})
    zapisz_konfig(k)
    print(f"Cosmos: ten komputer ({nazwa}) jest teraz połączony z kontem {odp.get('osoba') or ''}.".replace("  ", " "))
    return k


def main():
    ap = argparse.ArgumentParser(description="Cosmos – agent zmysłów na Twoim komputerze.")
    ap.add_argument("--serwer", help="adres Cosmosa, np. https://cosmosai.live")
    ap.add_argument("--kod", help="6-cyfrowy kod z Ustawień → Zmysły")
    ap.add_argument("--autostart", action="store_true", help="uruchamiaj agenta razem z systemem")
    ap.add_argument("--w-tle", action="store_true", help="po połączeniu działaj w tle (okno można zamknąć)")
    ap.add_argument("--odlacz", action="store_true", help="zapomnij połączenie i usuń autostart")
    ap.add_argument("--stan", action="store_true", help="pokaż, z kim jest połączony")
    a = ap.parse_args()

    if a.odlacz:
        autostart_wylacz()
        try:
            KONFIG.unlink()
        except FileNotFoundError:
            pass
        print("Cosmos: odłączono. Usuń też ten komputer w Ustawieniach → Zmysły.")
        return
    if a.stan:
        k = czytaj_konfig()
        print(json.dumps({"serwer": k.get("serwer"), "osoba": k.get("osoba"), "autostart": autostart_jest()}, indent=2, ensure_ascii=False))
        return

    k = czytaj_konfig()
    if a.kod:
        if not a.serwer:
            sys.exit("Cosmos: podaj też --serwer (adres Twojego Cosmosa).")
        k = paruj(a.serwer.rstrip("/"), a.kod)
    if not k.get("token") or not k.get("serwer"):
        sys.exit("Cosmos: ten komputer nie jest połączony. Wygeneruj kod w Ustawieniach → Zmysły.")
    if a.autostart:
        autostart_wlacz()
    if a.w_tle:
        uruchom_w_tle()
        print("Cosmos: agent działa w tle. Możesz zamknąć to okno – resztą sterujesz z aplikacji.")
        return

    if not zajmij_zamek():
        log("agent już działa na tym komputerze")
        return
    agent = Agent(k)

    def zakoncz(*_):
        agent.koniec.set()
        agent.skladniki.zatrzymaj_wszystko()
        sys.exit(0)

    signal.signal(signal.SIGTERM, zakoncz)
    signal.signal(signal.SIGINT, zakoncz)
    agent.start()


if __name__ == "__main__":
    main()

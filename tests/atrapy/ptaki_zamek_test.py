"""Selftest ptaków w senses/service.py – bez birdnetlib i bez modelu.

Gwarancje (zespół IT, runda 8 – na VPS-ie jedna usługa liczy ptaki wszystkich osób):
  1. Dwie osoby naraz, różne nagrania i położenia: każda dostaje SWÓJ wynik,
     żadnej 500 (wspólny Analyzer i interpreter TFLite nie są wielowątkowe).
  2. Nagranie bez współrzędnych po nagraniu z nimi nie dostaje cudzego sita.
  3. `nazwa` po polsku, obok `nazwaEn` i `lacinska`; jezyk=en – po angielsku.
  4. Współrzędne z nagłówka mają pierwszeństwo przed adresem, zaokrąglone do 0,1°.
  5. Zamek zajęty dłużej niż PTAK_CZEKAJ_S → PtakZajety (trasa odda 503).

Atrapa birdnetlib odtwarza to, co w prawdziwej bibliotece robi kłopot:
wyniki i sito trzymane w Analyzerze między nagraniami, sito czytane dopiero
przy odczycie `detections`, a interpreter rzuca przy dwóch analizach naraz
(prawdziwy komunikat TFLite). Blok ptaków bierzemy prosto z service.py
(znaczniki „ptaki: początek/koniec”) – bez FastAPI.

    python3 tests/atrapy/ptaki_zamek_test.py [ścieżka/do/service.py]
"""
import os
import sys
import tempfile
import threading
import time
import types
from datetime import datetime

TU = os.path.dirname(os.path.abspath(__file__))
SERWIS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(TU, "..", "..", "senses", "service.py")

# ------------------------------------------------------------ atrapa birdnetlib
# Nagranie to plik tekstowy: pierwsza linia = łacińska nazwa gatunku, który „śpiewa”.
ETYKIETY = {
    "Strix aluco": "Tawny Owl",
    "Parus major": "Great Tit",
    "Poecile atricapillus": "Black-capped Chickadee",
}
# Sito po położeniu: w Polsce (lat > 50) nie ma sikory jasnoskrzydłej, w Ameryce – puszczyka i bogatki.
SITO_PL = ["Strix aluco_Tawny Owl", "Parus major_Great Tit"]
SITO_US = ["Poecile atricapillus_Black-capped Chickadee"]


class Analyzer:
    def __init__(self):
        self.results = []
        self.custom_species_list = []
        self._w_toku = False

    def analyze_recording(self, rec):
        if rec.lat and rec.lon:
            self.custom_species_list = SITO_PL if rec.lat > 50 else SITO_US
        if self._w_toku:
            raise RuntimeError("There is at least 1 reference to internal data in the interpreter")
        self._w_toku = True
        try:
            with open(rec.path, encoding="utf-8") as f:
                lac = f.readline().strip()
            self.results = []
            for okno in range(3):
                time.sleep(0.004)  # „inferencja” – okno wyścigu jak przy invoke()
                self.results.append({"scientific_name": lac, "common_name": ETYKIETY[lac],
                                     "confidence": 0.9 - okno * 0.1,
                                     "start_time": okno * 3.0, "end_time": okno * 3.0 + 3})
        finally:
            self._w_toku = False


class Recording:
    def __init__(self, analyzer, path, min_conf=0.25, lat=None, lon=None, date=None):
        self.analyzer, self.path, self.lat, self.lon = analyzer, path, lat, lon

    def analyze(self):
        self.analyzer.analyze_recording(self)

    @property
    def detections(self):
        # Jak birdnetlib: sito z Analyzera czytane przy odczycie, nie przy analizie.
        # Odczyt trwa (prawdziwy przechodzi po wszystkich oknach) – kto czyta
        # poza zamkiem, dostaje wyniki następnej osoby.
        sito = self.analyzer.custom_species_list
        time.sleep(0.003)
        return [d for d in self.analyzer.results
                if not sito or f"{d['scientific_name']}_{d['common_name']}" in sito]


mod = types.ModuleType("birdnetlib")
mod.Recording = Recording
mod_an = types.ModuleType("birdnetlib.analyzer")
mod_an.Analyzer = Analyzer
mod.analyzer = mod_an
sys.modules["birdnetlib"] = mod
sys.modules["birdnetlib.analyzer"] = mod_an

# ------------------------------------------------------------ blok z service.py
zrodlo = open(SERWIS, encoding="utf-8").read()
start = zrodlo.index("# --- ptaki: początek")
koniec = zrodlo.index("# --- ptaki: koniec")
ns = {"os": os, "threading": threading, "tempfile": tempfile, "datetime": datetime,
      "CAPS": {"birdnet": True}, "_birdnet": None, "__file__": os.path.abspath(SERWIS)}
exec(compile(zrodlo[start:koniec], SERWIS, "exec"), ns)

bledy = []


def sprawdz(warunek, opis):
    if not warunek:
        bledy.append(opis)
        print("  ✗", opis)


def nagranie(lac):
    fd, p = tempfile.mkstemp(suffix=".wav")
    os.write(fd, (lac + "\n").encode())
    os.close(fd)
    return p


PUSZCZYK, SIKORA_US = nagranie("Strix aluco"), nagranie("Poecile atricapillus")
analizuj = ns["analizuj_ptaka"]


def lacinskie(w):
    return [g["lacinska"] for g in w["gatunki"]]


try:
    # 2. Sito nie przechodzi na następne nagranie.
    swiezy = lacinskie(analizuj(SIKORA_US))
    analizuj(PUSZCZYK, 53.3, 22.6)  # Biebrza: sito bez sikory jasnoskrzydłej
    po_biebrzy = lacinskie(analizuj(SIKORA_US))
    sprawdz(swiezy == ["Poecile atricapillus"], f"świeży wynik bez miejsca: {swiezy}")
    sprawdz(po_biebrzy == swiezy, f"bez miejsca po Biebrzy: {po_biebrzy} (powinno {swiezy})")

    # 1. Wiele osób naraz: puszczyk w Polsce i sikora w Ameryce / bez miejsca.
    wyniki = []
    zapis = threading.Lock()

    def osoba(plik, lat, lon, oczek):
        try:
            w = analizuj(plik, lat, lon)
            ok = lacinskie(w) == oczek and w["zMiejscem"] == (lat is not None)
            with zapis:
                wyniki.append(ok or f"{lacinskie(w)} != {oczek}")
        except Exception as e:  # noqa: BLE001
            with zapis:
                wyniki.append(f"{type(e).__name__}: {e}")

    watki = []
    for i in range(15):
        watki.append(threading.Thread(target=osoba, args=(PUSZCZYK, 52.2, 21.0, ["Strix aluco"])))
        watki.append(threading.Thread(target=osoba, args=(SIKORA_US, 40.7, -74.0, ["Poecile atricapillus"])))
        watki.append(threading.Thread(target=osoba, args=(SIKORA_US, None, None, ["Poecile atricapillus"])))
    for t in watki:
        t.start()
    for t in watki:
        t.join()
    zle = [w for w in wyniki if w is not True]
    sprawdz(len(wyniki) == 45 and not zle,
            f"45 analiz naraz – złych {len(zle)}: {sorted(set(map(str, zle)))[:3]}")

    # 3. Nazwy.
    w = analizuj(PUSZCZYK)["gatunki"][0]
    sprawdz(w["nazwa"] == "puszczyk" and w["nazwaEn"] == "Tawny Owl" and w["lacinska"] == "Strix aluco",
            f"polska nazwa: {w}")
    sprawdz({"nazwa", "lacinska", "pewnosc", "odS", "doS"} <= set(w), f"pola czytane przez app.js: {sorted(w)}")
    sprawdz(analizuj(PUSZCZYK, jezyk="en")["gatunki"][0]["nazwa"] == "Tawny Owl", "jezyk=en")
    sprawdz(ns["nazwy_pl"]().get("Parus major") == "bogatka", "nazwy z pliku albo zapasu")
    sprawdz(len(ns["nazwy_pl"]()) > 6000, f"plik nazwy_ptakow_pl.txt wczytany ({len(ns['nazwy_pl']())} nazw)")

    # 4. Współrzędne.
    wz = ns["wspolrzedne_z_zadania"]
    sprawdz(wz({"lat": "52.123456", "lon": "21.0199"}, {}) == (52.1, 21.0), "adres, zaokrąglenie do 0,1°")
    sprawdz(wz({"lat": "1", "lon": "1"}, {"x-cosmos-lat": "53.349", "x-cosmos-lon": "22.61"}) == (53.3, 22.6),
            "nagłówek ma pierwszeństwo")
    sprawdz(wz({"lat": "95", "lon": "21"}, {}) == (None, None), "szerokość poza Ziemią → brak")
    sprawdz(wz({"lat": "nan", "lon": "21"}, {}) == (None, None), "NaN → brak")
    sprawdz(wz({"lat": "52"}, {}) == (None, None), "sama szerokość → brak")

    # 5. Zajęty zamek.
    ns["PTAK_CZEKAJ_S"] = 0.2
    ns["PTAK_ZAMEK"].acquire()
    try:
        analizuj(PUSZCZYK)
        sprawdz(False, "zajęty zamek powinien dać PtakZajety")
    except ns["PtakZajety"]:
        pass
    finally:
        ns["PTAK_ZAMEK"].release()
finally:
    os.unlink(PUSZCZYK)
    os.unlink(SIKORA_US)

if bledy:
    print(f"PADŁO {len(bledy)}")
    sys.exit(1)
print("ptaki: zamek, sito, nazwy, współrzędne – OK")

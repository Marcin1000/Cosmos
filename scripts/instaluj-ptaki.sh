#!/usr/bin/env bash
# Rozpoznawanie ptaków (BirdNET) na samym serwerze – bez komputera w domu.
#
#   sudo bash /opt/cosmos/scripts/instaluj-ptaki.sh
#
# Co robi: sprawdza pamięć i dysk, zakłada venv w /opt/cosmos-ptaki (POZA repo –
# `git pull` go nie rusza), instaluje senses/requirements-ptaki.txt, rozgrzewa
# model, zakłada usługę cosmos-ptaki (ta sama senses/service.py, tylko trasa
# /ptak, tylko 127.0.0.1:7061), dopisuje PTAKI_URL do .env i restartuje Cosmosa.
# Ponowne uruchomienie = aktualizacja pakietów (np. po zmianie requirements-ptaki.txt).
#
# Próba bez roota i bez systemd (np. w kontenerze):
#   BEZ_SYSTEMD=1 PREFIKS=/tmp/ptaki PORT_PTAKOW=7061 bash scripts/instaluj-ptaki.sh
# – instaluje, rozgrzewa, stawia usługę na chwilę jako zwykły proces, sprawdza
# /health, /ptak i białą listę tras, po czym ją zatrzymuje.
#
# Zmienne: COSMOS (katalog Cosmosa, domyślnie ten, w którym leży skrypt),
# PREFIKS (/opt/cosmos-ptaki), PORT_PTAKOW (7061), PYTHON (python3),
# BEZ_SYSTEMD, POMIN_SPRAWDZENIE_PAMIECI=1 (na własne ryzyko).
#
# Dla testów: `TYLKO_FUNKCJE=1 source scripts/instaluj-ptaki.sh` tylko definiuje
# funkcje (np. dopisz_ptaki_url) i wraca – nic nie instaluje.
set -euo pipefail

# Krok 5: PTAKI_URL do .env. Plik zapisany bez końcowej nowej linii (VS Code,
# Notatnik, WinSCP) sklejał się z nią: „COSMOS_COOKIE_SECURE=1PTAKI_URL=…” –
# ciasteczka traciły Secure, a Cosmos nie widział ptaków, choć skrypt pisał
# „Gotowe” (zespół IT, runda 9). Drugie uruchomienie nie dubluje linii.
dopisz_ptaki_url() {
  local plik=$1 port=$2
  if [ ! -f "$plik" ]; then
    echo "Uwaga: brak $plik – dopisz ręcznie PTAKI_URL=http://127.0.0.1:$port"
    return 0
  fi
  if grep -q '^PTAKI_URL=' "$plik"; then
    grep -q "^PTAKI_URL=http://127.0.0.1:$port\$" "$plik" \
      || echo "Uwaga: w .env jest już inne PTAKI_URL – zostawiam je (sprawdź: grep PTAKI_URL $plik)."
    return 0
  fi
  if [ -s "$plik" ] && [ -n "$(tail -c1 "$plik")" ]; then echo >> "$plik"; fi
  echo "PTAKI_URL=http://127.0.0.1:$port" >> "$plik"
  echo "Dopisano PTAKI_URL do $plik"
}

if [ -n "${TYLKO_FUNKCJE:-}" ]; then return 0 2>/dev/null || exit 0; fi

COSMOS=${COSMOS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
PREFIKS=${PREFIKS:-/opt/cosmos-ptaki}
PORT_PTAKOW=${PORT_PTAKOW:-7061}
PYTHON=${PYTHON:-python3}
USLUGA=cosmos-ptaki
WYMAGANA_PAMIEC_MB=700
WYMAGANY_DYSK_MB=1500

blad() { echo "BŁĄD: $*" >&2; exit 1; }
krok() { echo; echo "== $*"; }

[ -f "$COSMOS/senses/service.py" ] || blad "nie widzę $COSMOS/senses/service.py – ustaw COSMOS=/ścieżka/do/cosmos"
if [ -z "${BEZ_SYSTEMD:-}" ] && [ "$(id -u)" -ne 0 ]; then
  blad "uruchom przez sudo (zakłada usługę systemd). Próba bez roota: BEZ_SYSTEMD=1"
fi

# ---------------------------------------------------------------- 1. zasoby
# Model zostaje w pamięci (ok. 540 MB po pierwszym nagraniu), więc najpierw
# sprawdzamy, czy starczy miejsca obok działającego Cosmosa.
krok "1/5 Pamięć i dysk"
DOSTEPNE_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
mkdir -p "$(dirname "$PREFIKS")"
WOLNE_DYSK_MB=$(df -Pm "$(dirname "$PREFIKS")" | awk 'NR==2 {print $4}')
echo "Pamięć dostępna: ${DOSTEPNE_MB} MB, dysk wolny: ${WOLNE_DYSK_MB} MB, rdzenie: $(nproc)"
DZIALA_JUZ=""
if [ -z "${BEZ_SYSTEMD:-}" ] && systemctl is-active --quiet "$USLUGA" 2>/dev/null; then DZIALA_JUZ=1; fi
if [ -n "$DZIALA_JUZ" ]; then
  echo "Usługa $USLUGA już działa – to aktualizacja, jej pamięć jest już policzona."
  # Zatrzymana na czas aktualizacji: rozgrzewka (krok 3) stawia drugi BirdNET, a dwa
  # naraz (ok. 540 + 510 MB) na VPS-ie z 700 MB wolnego to OOM albo swap. Przy okazji
  # pip nie podmienia plików pod działającym procesem. Krok 4 i tak ją uruchamia.
  systemctl stop "$USLUGA"
elif [ -z "${POMIN_SPRAWDZENIE_PAMIECI:-}" ] && [ "$DOSTEPNE_MB" -lt "$WYMAGANA_PAMIEC_MB" ]; then
  blad "za mało pamięci: ${DOSTEPNE_MB} MB dostępnej, potrzeba co najmniej ${WYMAGANA_PAMIEC_MB} MB przy działającym Cosmosie.
Weź większy plan VPS (albo dodaj 1 GB swapu) i spróbuj jeszcze raz."
fi
if [ ! -d "$PREFIKS/venv" ] && [ "$WOLNE_DYSK_MB" -lt "$WYMAGANY_DYSK_MB" ]; then
  blad "za mało miejsca na dysku: ${WOLNE_DYSK_MB} MB, potrzeba ${WYMAGANY_DYSK_MB} MB."
fi

# ---------------------------------------------------------------- 2. Python i pakiety
krok "2/5 Python i pakiety (pierwszy raz: ~150 MB do pobrania, 1–3 min)"
if [ -z "${BEZ_SYSTEMD:-}" ] && command -v apt-get >/dev/null; then
  # python3-venv: Debian i Ubuntu nie mają venv w samym python3.
  # ffmpeg: tylko dla nagrań innych niż WAV (m4a/ogg); aplikacja wysyła WAV – bez zaleceń.
  # apt-get update: po tygodniach listy pakietów są stare i łatany ffmpeg dawał 404.
  DEBIAN_FRONTEND=noninteractive apt-get update -q >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends python3-venv ffmpeg >/dev/null
fi
command -v "$PYTHON" >/dev/null || blad "brak $PYTHON (Debian/Ubuntu: sudo apt install python3 python3-venv)"
"$PYTHON" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 14) else 1)' \
  || blad "BirdNET potrzebuje Pythona 3.10–3.14, a jest $("$PYTHON" -V 2>&1)"
echo "Python: $("$PYTHON" -V 2>&1)"
T0=$(date +%s)
[ -x "$PREFIKS/venv/bin/python" ] || "$PYTHON" -m venv "$PREFIKS/venv"
"$PREFIKS/venv/bin/pip" install -q --disable-pip-version-check --upgrade pip
"$PREFIKS/venv/bin/pip" install -q --disable-pip-version-check --upgrade -r "$COSMOS/senses/requirements-ptaki.txt"
mkdir -p "$PREFIKS/numba"
echo "Pakiety gotowe w $(( $(date +%s) - T0 )) s, venv: $(du -sm "$PREFIKS/venv" | cut -f1) MB"

# ---------------------------------------------------------------- 3. rozgrzewka
# Pierwsza analiza w świeżym venv potrafi trwać kilkadziesiąt sekund (ładowanie
# modelu, przy starszym zestawie kompilacja numby) – niech stanie się teraz.
krok "3/5 Rozgrzewka BirdNET"
COSMOS="$COSMOS" NUMBA_CACHE_DIR="$PREFIKS/numba" "$PREFIKS/venv/bin/python" - <<'PY'
import os, struct, sys, tempfile, time, wave
sys.path.insert(0, os.path.join(os.environ["COSMOS"], "senses"))
import zgodnosc_litert
print(f"Interpreter: {zgodnosc_litert.ZRODLO}")
import io, contextlib
from birdnetlib import Recording
from birdnetlib.analyzer import Analyzer
fd, p = tempfile.mkstemp(suffix=".wav"); os.close(fd)
with wave.open(p, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
    w.writeframes(struct.pack("<h", 0) * 48000 * 3)
t = time.time()
with contextlib.redirect_stdout(io.StringIO()):  # birdnetlib gada przy każdym kroku
    Recording(Analyzer(), p, lat=52.2, lon=21.0, min_conf=0.25).analyze()
os.unlink(p)
print(f"BirdNET działa, rozgrzewka {time.time() - t:.1f} s")
PY

# ---------------------------------------------------------------- próba bez systemd
if [ -n "${BEZ_SYSTEMD:-}" ]; then
  krok "BEZ_SYSTEMD – próba usługi jako zwykły proces na 127.0.0.1:$PORT_PTAKOW"
  LOG="$PREFIKS/proba-uslugi.log"
  SENSES_HOST=127.0.0.1 SENSES_PORT="$PORT_PTAKOW" COSMOS_ZMYSLY_TYLKO=ptak \
    NUMBA_CACHE_DIR="$PREFIKS/numba" OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
    "$PREFIKS/venv/bin/python" "$COSMOS/senses/service.py" > "$LOG" 2>&1 &
  PID=$!
  trap 'kill $PID 2>/dev/null || true' EXIT
  T0=$(date +%s)
  for _ in $(seq 1 120); do
    curl -fs "http://127.0.0.1:$PORT_PTAKOW/health" 2>/dev/null | grep -q '"birdnet_gotowy":true' && break
    sleep 0.5
  done
  echo "Od startu do birdnet_gotowy: $(( $(date +%s) - T0 )) s"
  curl -fs "http://127.0.0.1:$PORT_PTAKOW/health" | grep -q '"birdnet_gotowy":true' \
    || blad "usługa nie zgłasza gotowości – log: $LOG"
  "$PREFIKS/venv/bin/python" - "$PORT_PTAKOW" <<'PY'
import io, struct, sys, time, urllib.request, urllib.error, wave
port = sys.argv[1]
b = io.BytesIO()
with wave.open(b, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000)
    w.writeframes(struct.pack("<h", 0) * 48000 * 8)  # 8 s jak w aplikacji
t = time.time()
r = urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/ptak", data=b.getvalue(),
    headers={"Content-Type": "audio/wav", "X-Cosmos-Lat": "52.2", "X-Cosmos-Lon": "21.0"}), timeout=60)
print(f"/ptak (8 s ciszy): {r.status} w {time.time() - t:.2f} s, {r.read()[:80]!r}")
try:
    urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/stt", data=b"x"), timeout=5)
    sys.exit("BŁĄD: /stt odpowiada – biała lista nie działa")
except urllib.error.HTTPError as e:
    assert e.code == 404, e.code
    print("/stt: 404 (biała lista działa)")
PY
  echo "RSS usługi: $(( $(awk '/VmRSS/ {print $2}' /proc/$PID/status) / 1024 )) MB"
  echo "Próba udana. Usługa zatrzymana (BEZ_SYSTEMD)."
  exit 0
fi

# ---------------------------------------------------------------- 4. usługa systemd
krok "4/5 Usługa $USLUGA"
UZYTKOWNIK=$(systemctl show -p User --value cosmos 2>/dev/null || true)
UZYTKOWNIK=${UZYTKOWNIK:-root}
chown -R "$UZYTKOWNIK" "$PREFIKS/numba"
# SENSES_HOST=127.0.0.1 OBOWIĄZKOWO: service.py domyślnie słucha na 0.0.0.0,
# a instrukcja VPS-a zostawia zaporę dostawcy wyłączoną – /ptak byłby otwarty
# na świat bez logowania. Cosmos woła usługę po pętli zwrotnej.
cat > /etc/systemd/system/$USLUGA.service <<UNIT
[Unit]
Description=Cosmos – rozpoznawanie ptaków (BirdNET)
After=network.target
# Restart i zatrzymanie Cosmosa obejmują też ptaki (nowy service.py po git pull).
PartOf=cosmos.service
StartLimitIntervalSec=0

[Service]
User=$UZYTKOWNIK
WorkingDirectory=$COSMOS
Environment=SENSES_HOST=127.0.0.1
Environment=SENSES_PORT=$PORT_PTAKOW
Environment=COSMOS_ZMYSLY_TYLKO=ptak
Environment=NUMBA_CACHE_DIR=$PREFIKS/numba
Environment=OMP_NUM_THREADS=1
Environment=OPENBLAS_NUM_THREADS=1
ExecStart=$PREFIKS/venv/bin/python $COSMOS/senses/service.py
Restart=always
RestartSec=5
# Model ok. 540 MB; ponad limit systemd ubija usługę, a nie Cosmosa.
MemoryMax=900M
# Pętla zdarzeń Cosmosa ma pierwszeństwo przy 1–2 rdzeniach.
Nice=10
CPUWeight=50
UMask=0077
NoNewPrivileges=true
# Nagrania w prywatnym /tmp usługi, kasowane zaraz po analizie.
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only

[Install]
WantedBy=multi-user.target cosmos.service
UNIT
systemctl daemon-reload
systemctl enable "$USLUGA" >/dev/null 2>&1
systemctl restart "$USLUGA"

# ---------------------------------------------------------------- 5. Cosmos
krok "5/5 Adres dla Cosmosa i sprawdzenie"
dopisz_ptaki_url "$COSMOS/.env" "$PORT_PTAKOW"
if systemctl cat cosmos >/dev/null 2>&1; then systemctl restart cosmos; fi

for _ in $(seq 1 60); do
  curl -fs "http://127.0.0.1:$PORT_PTAKOW/health" 2>/dev/null | grep -q '"birdnet_gotowy":true' && break
  sleep 1
done
if curl -fs "http://127.0.0.1:$PORT_PTAKOW/health" | grep -q '"birdnet_gotowy":true'; then
  echo "Gotowe: ptaki rozpoznaje ten serwer (port $PORT_PTAKOW, tylko 127.0.0.1)."
  echo "Stan: systemctl status $USLUGA    Dziennik: journalctl -u $USLUGA -n 50"
else
  blad "usługa nie zgłasza gotowości BirdNET – zobacz: journalctl -u $USLUGA -n 50"
fi

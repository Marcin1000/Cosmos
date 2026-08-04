#!/usr/bin/env bash
# Sprawdza po kolei każdy model z listy dostawcy i wypisuje tabelę:
# które naprawdę działają na Twoim koncie i które czytają obrazy.
#
# To samo robi przycisk „Sprawdź wszystkie z listy" w Ustawieniach — ta wersja
# przydaje się wtedy, gdy wynik trzeba komuś wysłać albo zapisać do pliku.
#
#   ./scripts/sprawdz-modele.sh                 # chmura, serwer lokalny
#   ./scripts/sprawdz-modele.sh local           # silnik lokalny (Ollama)
#   ./scripts/sprawdz-modele.sh cloud > wynik.txt
#
# Hasło bierzemy z .env — dzięki temu nie trafia do historii poleceń.
# (Wpisane ręcznie w wierszu poleceń zostawiłoby ślad w ~/.bash_history,
#  a hasło z wykrzyknikiem dodatkowo rozbija się o rozwijanie historii basha.)

set -u

EP="${1:-cloud}"
BASE="${COSMOS_URL:-http://localhost:3000}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COOKIE="$(mktemp)"
trap 'rm -f "$COOKIE"' EXIT

command -v curl >/dev/null || { echo "Brak curl."; exit 1; }

# --- logowanie (tylko jeśli serwer go wymaga) ---
AUTH="$(curl -s --max-time 10 "$BASE/api/auth")" || {
  echo "Nie mogę się połączyć z $BASE — czy Cosmos działa? (systemctl status cosmos)"; exit 1; }

if [[ "$AUTH" == *'"required":true'* ]]; then
  PASS=""
  [[ -f "$DIR/.env" ]] && PASS="$(grep -m1 '^COSMOS_PASSWORD=' "$DIR/.env" | cut -d= -f2-)"
  if [[ -z "$PASS" ]]; then
    echo "Serwer wymaga logowania, a nie znalazłem COSMOS_PASSWORD w $DIR/.env"
    read -r -s -p "Hasło do Cosmosa: " PASS; echo
  fi
  # Hasło idzie wejściem standardowym, nie argumentem: argumenty procesu widać
  # w `ps` dla innych użytkowników maszyny, treść potoku już nie.
  OUT="$(printf '{"password":"%s"}' "$PASS" \
    | curl -s --max-time 10 -c "$COOKIE" -X POST "$BASE/api/login" \
      -H 'Content-Type: application/json' --data-binary @-)"
  unset PASS
  [[ "$OUT" == *'"ok":true'* ]] || { echo "Logowanie odrzucone: $OUT"; exit 1; }
fi

# --- lista modeli ---
LIST="$(curl -s --max-time 30 -b "$COOKIE" "$BASE/api/models?endpoint=$EP")"
MODELS="$(printf '%s' "$LIST" | grep -o '"id":"[^"]*"' | cut -d'"' -f4 | sort -u)"
N="$(printf '%s\n' "$MODELS" | grep -c . || true)"

if [[ "$N" -eq 0 ]]; then
  echo "Nie dostałem listy modeli dla silnika „$EP”."
  echo "Odpowiedź serwera: ${LIST:0:300}"
  exit 1
fi

echo "Silnik: $EP — modeli na liście: $N"
echo "Sprawdzam po kolei (nie równolegle — inaczej dostawca odrzuci nas za nadmiar żądań)."
echo

OK=0; VIS=0; BAD=0; I=0
DZIALA=(); WZROK=(); NIEDZIALA=()

while IFS= read -r M; do
  [[ -z "$M" ]] && continue
  I=$((I + 1))
  printf '\r  %d/%d  %-60.60s' "$I" "$N" "$M" >&2
  R="$(curl -s --max-time 90 -b "$COOKIE" -X POST "$BASE/api/models/check" \
        -H 'Content-Type: application/json' \
        --data-raw "{\"endpoint\":\"$EP\",\"model\":\"$M\"}")"
  if [[ "$R" == *'"rozmowa":true'* ]]; then
    OK=$((OK + 1))
    if [[ "$R" == *'"obrazy":true'* ]]; then
      VIS=$((VIS + 1)); WZROK+=("$M")
    else
      DZIALA+=("$M")
    fi
  else
    BAD=$((BAD + 1))
    POWOD="$(printf '%s' "$R" | grep -o '"blad":"[^"]*"' | cut -d'"' -f4 | head -c 120)"
    NIEDZIALA+=("$M — ${POWOD:-brak odpowiedzi}")
  fi
done <<< "$MODELS"

printf '\r%*s\r' 70 '' >&2

echo "=== ROZMOWA + OBRAZY ($VIS) ==="
printf '  %s\n' "${WZROK[@]:-（brak）}"
echo
echo "=== SAMA ROZMOWA ($((OK - VIS))) ==="
printf '  %s\n' "${DZIALA[@]:-（brak）}"
echo
echo "=== NIEDOSTĘPNE ($BAD) ==="
printf '  %s\n' "${NIEDZIALA[@]:-（brak）}"
echo
echo "Podsumowanie: działa $OK z $N, obrazy czyta $VIS."

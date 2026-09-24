# Cosmos dla kilku osób — domena, zaproszenia, zmysły

Ten dokument prowadzi przez trzy rzeczy: przeniesienie Cosmosa na własną domenę
przez Cloudflare, zapraszanie ludzi oraz to, co zaproszona osoba musi (i czego
nie musi) zrobić po swojej stronie.

---

## Jak to działa

Cosmos ma **konta**. Ty jesteś **właścicielem**, a osoby, które zaprosisz, są
**członkami**.

| | Właściciel | Członek |
|---|---|---|
| Rozmowy, pamięć, profil, baza wiedzy, archiwum, sprzęt | własne | **własne** — nikt inny ich nie widzi, Ty też nie |
| Chmura NVIDIA | ✓ | ✓ |
| OpenAI, Claude, lokalny GPU, Studio | ✓ | gdy **przyznasz** w panelu Dostęp **albo** gdy osoba wpisze **własny klucz** (wtedy płaci sama) |
| Mikrofon, głos, kamera w przeglądarce | ✓ | ✓ — bez instalowania czegokolwiek |
| Kinect, aparat Canon, urządzenia domowe, poranna odprawa | ✓ | ✗ — to sprzęt w **Twoim** domu |
| Wykonywanie kodu, trening modelu, automatyzacja stron | ✓ | ✗ — działają **na serwerze**, obok kluczy i danych wszystkich |
| Zapraszanie ludzi | ✓ | ✗ |

**Co widzisz o innych:** konto, ostatnią wizytę i liczbę wiadomości. Nie
widzisz rozmów, pamięci ani bazy wiedzy innych osób — tak zdecydowałeś
i tak jest zbudowane: panel Dostęp po prostu nie ma skąd ich wziąć.

**Twoje dotychczasowe dane** przy pierwszym starcie nowej wersji same
przeniosą się na Twoje konto (`data/uzytkownicy/wlasciciel/`). Kopia sprzed
przeniesienia zostaje obok, w `data/kopia-przed-kontami-<data>/`.

---

## Krok 1 — ustaw login i hasło właściciela

Na VPS-ie, w `/opt/cosmos/.env`:

```
COSMOS_PASSWORD=twoje-dotychczasowe-haslo
COSMOS_LOGIN=marcin
COSMOS_NAZWA=Marcin
COSMOS_COOKIE_SECURE=1
```

`COSMOS_PASSWORD` działa **tylko przy pierwszym starcie**: staje się hasłem
Twojego konta. Potem hasło zmieniasz w **Ustawienia → Twoje konto**.

Na ekranie logowania możesz zostawić pole *Login* puste — wtedy logujesz się
Ty. Stare skrypty i mostek MCP działają bez zmian.

---

## Krok 2 — Cloudflare Tunnel na `cosmosai.live`

Tunel sprawia, że VPS **nie wystawia żadnego portu do internetu**. To
`cloudflared` na serwerze łączy się z Cloudflare, a nie odwrotnie. HTTPS
załatwia Cloudflare, a adres IP serwera pozostaje ukryty.

### 2a. W panelu Cloudflare (przeglądarka)

1. **dash.cloudflare.com** → z lewej **Zero Trust** (przy pierwszym wejściu
   wybierz darmowy plan *Free*).
2. **Networks → Tunnels → Create a tunnel** → typ **Cloudflared** → nazwa
   `cosmos` → **Save tunnel**.
3. Wybierz system **Debian** i architekturę **64-bit**. Cloudflare pokaże
   polecenia — interesuje Cię **ostatnie**, zaczynające się od
   `sudo cloudflared service install eyJ…`. Skopiuj je w całości.

### 2b. Na VPS-ie

```
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
sudo cloudflared service install eyJ...TWÓJ-TOKEN...
sudo systemctl status cloudflared --no-pager | head -5
```

Ma pokazać `active (running)`, a w panelu Cloudflare tunel zmieni status na
**Healthy**.

### 2c. Z powrotem w panelu

**Next** → zakładka **Public Hostname** → **Add a public hostname**:

| Pole | Wartość |
|---|---|
| Subdomain | *(puste)* |
| Domain | `cosmosai.live` |
| Service → Type | `HTTP` |
| Service → URL | `localhost:3000` |

**Save**. Po minucie `https://cosmosai.live` pokaże stronę produktową,
a `https://cosmosai.live/app` — ekran logowania.

### 2d. Uruchom ponownie Cosmosa

```
cd /opt/cosmos && git pull && sudo systemctl restart cosmos
sudo journalctl -u cosmos -n 30 --no-pager | grep -E "Logowanie|Migracja|kopia"
```

Szukaj linii `Logowanie: WŁĄCZONE — kont: 1, login właściciela: marcin`.

**Tailscale zostaje** — to Twoje tylne wejście, gdyby coś się stało z tunelem.

---

## Krok 3 — zaproś kogoś

1. **Ustawienia** → blok **Dostęp** → wpisz imię → **Zaproś**.
2. Pojawi się link. Na telefonie **Wyślij…** otworzy WhatsApp, SMS i resztę;
   na komputerze — **Kopiuj link**.
3. Link **działa raz i wygasa po 7 dniach**. Kto otworzy go pierwszy, ten
   zakłada konto — dlatego wysyłaj go tylko tej jednej osobie.

Przy każdej osobie masz przełączniki **lokalny GPU / OpenAI / Claude /
Studio**. Włączone — ta osoba korzysta z nich na Twoich kluczach. Wyłączone —
nie ma ich, chyba że wpisze własny klucz.

**Wyloguj wszędzie** zamyka wszystkie sesje tej osoby (np. zgubiony telefon).
**Usuń konto** odbiera dostęp od razu, a dane tej osoby trafiają do
`data/usuniete/` na serwerze — nie znikają.

---

## Co musi zrobić osoba zaproszona

**Minimum — dwie minuty:**

1. Otworzyć link.
2. Wpisać login i hasło → **Dołącz**.
3. Na telefonie: menu przeglądarki → **Dodaj do ekranu głównego**. Cosmos
   działa wtedy jak aplikacja. Dodawaj z adresu `cosmosai.live/app` — pod
   samym `cosmosai.live` stoi strona produktowa.

To wszystko. Czat, wyszukiwanie w sieci, plan zdjęciowy, baza wiedzy, galeria,
**mikrofon, głos i kamera z przeglądarki** działają od razu, bez instalowania
czegokolwiek.

**Opcjonalnie:**

- **Ustawienia → Twoje konto → Własne klucze API** — kto ma swój klucz OpenAI
  albo Anthropic, wpisuje go tutaj; zakładka silnika pojawi się od razu,
  a płaci ta osoba. Klucz widzi tylko serwer; w przeglądarce zostają cztery
  ostatnie znaki.
- **Ustawienia → profil** — kilka zdań o sobie („fotografuję góry, wolę
  krótkie odpowiedzi"). Cosmos będzie to brał pod uwagę w każdej rozmowie.
- **Plener → sprzęt** — korpus i obiektywy, jeśli ktoś fotografuje. Plan
  zdjęciowy liczy wtedy nastawy pod jego szkła, a nie pod Twoje.

### Zmysły u osoby zaproszonej

| Zmysł | Co trzeba zrobić |
|---|---|
| Mikrofon, dyktowanie, „naciśnij, aby mówić" | nic — przeglądarka |
| Czytanie na głos | nic — głos systemu |
| Kamera (zdjęcie do rozmowy, tryb głosowy z kamerą) | nic — przeglądarka zapyta o zgodę |
| Kinect, YOLO na żywo, Whisper na własnej karcie | **jeszcze nie** — patrz niżej |

Zaawansowane zmysły (Kinect, wykrywanie obiektów na żywo, Whisper na GPU)
działają dziś **tylko u właściciela**, bo usługa zmysłów łączy się
z serwerem jako Ty. Następny etap to **agent zmysłów** dla każdej osoby:
program na jej komputerze, który sam łączy się z `cosmosai.live`, paruje się
6-cyfrowym kodem z Ustawień i wysyła zdarzenia tylko na jej konto. Nie trzeba
będzie przekierowywać portów ani stawiać VPN-a.

---

## Gdy coś nie działa

| Objaw | Co zrobić |
|---|---|
| Zapomniałem hasła | `sudo systemctl stop cosmos && cd /opt/cosmos && node scripts/konto.js haslo marcin && sudo systemctl start cosmos` |
| „Za dużo nieudanych prób. Spróbuj ponownie za N min." | Pięć pomyłek z jednego adresu → kwadrans przerwy. Z innego adresu (np. telefon na LTE zamiast Wi-Fi) da się wejść od razu. |
| „To zaproszenie wygasło albo zostało już użyte" | Wystaw nowe. Stare linki nie wracają — serwer trzyma tylko skrót tokenu, więc nawet Ty nie odtworzysz starego linku. |
| Osoba nie widzi zakładki Claude / OpenAI | Włącz jej przełącznik w panelu Dostęp albo niech wpisze własny klucz. |
| Po aktualizacji telefon pokazuje starą wersję | Odśwież dwa razy (pierwsze pobiera nowy service worker, drugie go włącza). |
| `cosmosai.live` pokazuje błąd 502 | Tunel działa, ale Cosmos nie: `sudo systemctl status cosmos --no-pager`. |
| `cosmosai.live` pokazuje błąd 1033 | Nie działa tunel: `sudo systemctl restart cloudflared`. |
| Lista kont z wiersza poleceń | `node scripts/konto.js lista` |

---

## Bezpieczeństwo — co jest zrobione

- **Hasła** — `scrypt` z solą; nigdy jawnie, ani w plikach, ani w logach.
- **Sesje** — na dysku jako skróty tokenów. Przeżywają restart serwera, ale
  wyciek pliku `data/konta/sesje.json` nie daje nikomu działającej sesji.
  Pliki kont mają uprawnienia `0600`.
- **Blokada** — 5 pomyłek z jednego adresu albo 10 pod jednym loginem →
  kwadrans przerwy. Za tunelem adres bierzemy z `CF-Connecting-IP`, ale ufamy
  mu **tylko** wtedy, gdy połączenie przyszło z tej samej maszyny.
- **Zaproszenia** — jednorazowe, ważne 7 dni. Token siedzi po `#` w linku,
  więc nie trafia do logów serwera ani Cloudflare.
- **Izolacja** — każde żądanie wykonuje się w imieniu konkretnej osoby
  (`lib/kontekst.js`). Próba sięgnięcia do danych bez ustalonej osoby kończy
  się błędem, a nie cichym dostępem do czegokolwiek wspólnego.
- **Obce strony** — ciastko `SameSite=Lax` i dodatkowo odrzucanie żądań
  zmieniających dane, gdy nagłówek `Origin` wskazuje inną domenę.
- **Nagłówki** — `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`.
  Kod aplikacji idzie z `Cache-Control: no-cache`, więc Cloudflare nie
  podsunie starej wersji po aktualizacji.

Testy, które tego pilnują: `konta-i-logowanie`, `izolacja-osob`,
`konta-w-przegladarce`.

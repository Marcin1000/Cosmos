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
COSMOS_HOST=127.0.0.1
```

`COSMOS_HOST=127.0.0.1` sprawia, że Cosmos słucha **tylko na samym VPS-ie**.
Tunel łączy się lokalnie, więc działa jak dotąd — a `http://<IP-VPS>:3000`
przestaje odpowiadać. Bez tego port 3000 był osiągalny z internetu wprost:
po zwykłym HTTP (hasło jawnym tekstem), z pominięciem Cloudflare. Dla
pewności włącz też zaporę — zostaw tylko SSH:

```
sudo ufw allow OpenSSH && sudo ufw enable
```

Tailscale jako tylne wejście działa dalej przez `tailscale serve --bg 3000`
(adres `https://<nazwa-vps>.<tailnet>.ts.net`) — sam adres `100.x.y.z:3000`
przy `COSMOS_HOST=127.0.0.1` już nie odpowie.

To samo dotyczy wszystkiego, co łączy się z VPS-em pod `http://100.x.y.z:3000`:
obserwatora kamery w domu (`COSMOS_URL` w `senses/watcher.py`) i mostka MCP
(`COSMOS_URL` w konfiguracji Claude Desktop / Cursora). Zmień im adres na ten
z `tailscale serve` albo na `https://cosmosai.live` — inaczej zdarzenia z kamery
przestaną dochodzić, a nic tego głośno nie zgłosi. Połączenia w drugą stronę
(VPS → Ollama i zmysły na domowym PC) działają bez zmian.

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

W ustawieniach dodatkowych (*Additional application settings → HTTP Settings*)
**nie ustawiaj `HTTP Host Header`**. Cosmos porównuje nagłówek `Host`
z `Origin`, żeby odrzucać żądania z cudzych stron; gdy tunel podmieni `Host`
na `localhost`, ta kontrola się wyłącza i zostaje sama ochrona ciastka.

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

Na Twoich kluczach osoba dostaje **model z `.env`** (i jego wizyjny) — nie
dowolny z cennika. Inne modele dopuszczasz w `.env`:
`COSMOS_MODELE_PRZYZNANE=gpt-4o-mini,claude-haiku-4-5`. Długość jednej
odpowiedzi ma sufit `COSMOS_MAX_TOKENS_CZLONKA` (domyślnie 8192). Z własnym
kluczem osoba wybiera, co chce — płaci sama.

Każda osoba ma też **limit miejsca na dysku** — baza wiedzy, wyniki Studia
i rozmowy: `COSMOS_LIMIT_MB_OSOBY` (domyślnie 500 MB). Po przekroczeniu zapis
odpowiada czytelnym błędem, a nie „zapisano". W panelu Dostęp przy każdej
osobie widać, ile zajmuje, a nad listą — ile zostało miejsca na dysku serwera
(poniżej 5% napis robi się czerwony). Twoje konto limitu nie ma, chyba że
ustawisz `COSMOS_LIMIT_MB_WLASCICIELA`.

**Lokalny GPU** to też **zmysły** na Twoim komputerze: Whisper, czytanie
głosem Piper, wykrywanie obiektów, wyciąganie tekstu z PDF-ów, powiększanie
obrazów. Bez tego przełącznika osoba ma mikrofon, głos i kamerę
z przeglądarki, a Twój komputer nie pracuje dla niej.

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
| Mikrofon, dyktowanie, „naciśnij, aby mówić" | nic — przeglądarka; z przełącznikiem **lokalny GPU** — Whisper na Twoim komputerze |
| Czytanie na głos | nic — głos systemu; z przełącznikiem **lokalny GPU** — Piper |
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
| Po aktualizacji telefon pokazuje starą wersję | Na dole pojawia się „Jest nowa wersja Cosmosa. Odśwież" — kliknij. Nie pojawiło się? Przełącz się na chwilę do innej aplikacji i wróć (wtedy Cosmos sprawdza wersję) albo odśwież dwa razy. |
| Po ustawieniu `COSMOS_HOST=127.0.0.1` obserwator kamery albo mostek MCP milczą | Łączą się jeszcze pod `http://100.x.y.z:3000`. Zmień im `COSMOS_URL` na adres z `tailscale serve` albo `https://cosmosai.live`. |
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
  mu **tylko** wtedy, gdy połączenie przyszło z tej samej maszyny. Adresy IPv6
  liczymy po całej sieci `/64` — łącze domowe ma ich 2⁶⁴, więc zmiana adresu
  co pięć prób nic nie daje.
- **Zaproszenia** — jednorazowe, ważne 7 dni. Token siedzi po `#` w linku,
  więc nie trafia do logów serwera ani Cloudflare.
- **Izolacja** — każde żądanie wykonuje się w imieniu konkretnej osoby
  (`lib/kontekst.js`). Próba sięgnięcia do danych bez ustalonej osoby kończy
  się błędem, a nie cichym dostępem do czegokolwiek wspólnego.
- **Obce strony** — ciastko `SameSite=Lax` i dodatkowo odrzucanie żądań
  zmieniających dane, gdy nagłówek `Origin` wskazuje inną domenę. Dotyczy to
  też logowania i zaproszeń: cudza strona nie zaloguje Twojej przeglądarki
  na swoje konto.
- **Obrazy z cudzych serwerów** (miniatury wyszukiwania, OneDrive) — tylko
  PNG, JPEG, GIF, WebP, AVIF, z nagłówkami `nosniff` i `sandbox`. SVG może
  zawierać skrypt, więc nie przechodzi.
- **Dane na dysku** — uszkodzony plik (zanik zasilania, ręczna edycja) nie
  daje po cichu pustego stanu: obok zostaje kopia `*.uszkodzony-<czas>`,
  a Cosmos wraca do poprzedniej wersji z `.bak`. Przy uszkodzonym pliku kont
  bez kopii serwer **nie wstaje** — zamiast wstać bez członków.
- **Nagłówki** — `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`.
  Kod aplikacji idzie z `Cache-Control: no-cache`, więc Cloudflare nie
  podsunie starej wersji po aktualizacji.

Testy, które tego pilnują: `konta-i-logowanie`, `izolacja-osob`,
`konta-w-przegladarce`.

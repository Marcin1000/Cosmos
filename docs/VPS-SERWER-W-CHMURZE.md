# ☁️ Cosmos na serwerze w chmurze (VPS) — zawsze dostępny

Ten przewodnik stawia Cosmosa tak, jak ustaliliśmy:
- **VPS w chmurze** = zawsze włączony rdzeń (serwer + Twoje dane), dostępny z telefonu,
  Surface Pro i skądkolwiek.
- **Komputer stacjonarny z RTX 3080** = mózg lokalny, używany z domu, gdy go włączysz.
- **Surface Pro / telefon** = klienci, którzy łączą się z VPS.

```
   Telefon · Surface Pro · dowolne miejsce
                  │  (szyfrowany tunel Tailscale)
                  ▼
        VPS — ZAWSZE WŁĄCZONY
        serwer Cosmos + dane (rozmowy, pamięć, baza wiedzy)
          │                                    │
          │ chmura AI (zawsze)                 │ Tailscale (gdy PC w domu włączony)
          ▼                                    ▼
   NVIDIA / OpenAI / Claude          Stacjonarny RTX 3080 (Ollama)
```

> ⚠️ **Zasada numer jeden:** serwer wystawiony do internetu **musi** mieć ustawione
> hasło (`COSMOS_PASSWORD`). Bez tego każdy, kto pozna adres, użyje Twoich kluczy API
> (Twoje pieniądze) i przeczyta Twoje dane. Ten przewodnik ustawia hasło w kroku 4.

---

## Co będziesz potrzebował

- Konto u dostawcy VPS (np. Hetzner, DigitalOcean, Mikr.us, OVH). Wystarczy najtańszy
  plan: 1–2 rdzenie, 2 GB RAM, ~20 GB dysku. Koszt: kilkanaście–kilkadziesiąt zł/mies.
- Konto **Tailscale** (darmowe) — łączy VPS, telefon i komputer w prywatną sieć.
- Około 30–40 minut.

> **Dlaczego Tailscale, a nie publiczny adres?** Bo to najprostsza i najbezpieczniejsza
> droga: nie otwierasz żadnych portów na świat, nie potrzebujesz domeny ani certyfikatów,
> a mimo to masz dostęp z każdego miejsca. VPS jest widoczny tylko dla Twoich urządzeń.
> (Wariant z publiczną domeną i HTTPS opisuję na końcu, jako alternatywę.)

---

## KROK 1 — Załóż VPS

1. U dostawcy utwórz nowy serwer z systemem **Ubuntu 24.04 LTS**.
2. Zapisz jego adres IP i hasło do użytkownika `root` (albo skonfiguruj klucz SSH).
3. Połącz się z serwerem z komputera (w `cmd` na Windows):
   ```
   ssh root@ADRES-IP-SERWERA
   ```

## KROK 2 — Zainstaluj Node.js i Gita na VPS

Po zalogowaniu na serwer wklej:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version
```

## KROK 3 — Pobierz Cosmosa na VPS

```bash
git clone <adres-repozytorium> /opt/cosmos
cd /opt/cosmos
```

## KROK 4 — Ustaw konfigurację i HASŁO

```bash
cp .env.example .env
nano .env
```
Uzupełnij **koniecznie**:
```ini
# HASŁO do logowania w przeglądarce — WYMAGANE na VPS!
COSMOS_PASSWORD=wybierz-dlugie-trudne-haslo

# Stały token dla Cursora/MCP (wygeneruj losowy ciąg, same litery i cyfry)
COSMOS_API_TOKEN=wklej-tu-losowy-ciag-znakow

# Chmura NVIDIA (mózg dostępny 24/7 z VPS)
NVIDIA_API_KEY=nvapi-twój-klucz

# pozostałe klucze (OpenAI, ElevenLabs, Seedance, Firefly) — wedle potrzeb
```
Zapisz: `Ctrl+O`, Enter, `Ctrl+X`.

> 🔑 Losowy token wygenerujesz na serwerze poleceniem:
> `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`

## KROK 5 — Połącz VPS z Tailscale

Na VPS:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
Pojawi się link — otwórz go w przeglądarce i zaloguj na swoje konto Tailscale.
Zapisz adres, który VPS dostanie (np. `100.101.102.103`) — to pod nim będziesz się łączyć.

## KROK 6 — Uruchom Cosmosa jako usługę (żeby działał zawsze)

Tworzymy usługę systemową, która startuje sama i wstaje po restarcie serwera:
```bash
sudo tee /etc/systemd/system/cosmos.service > /dev/null <<'EOF'
[Unit]
Description=Cosmos
After=network.target

[Service]
WorkingDirectory=/opt/cosmos
ExecStart=/usr/bin/node server.js
Restart=always
User=root
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable cosmos
sudo systemctl start cosmos
sudo systemctl status cosmos
```
Jeśli widzisz `active (running)` — Cosmos działa i będzie działał zawsze.

## KROK 7 — Wejdź z telefonu i Surface Pro

1. Zainstaluj **Tailscale** na telefonie i na Surface Pro, zaloguj tym samym kontem.
2. Otwórz w przeglądarce: `http://100.101.102.103:3000` (adres VPS z Tailscale).
3. Pojawi się ekran logowania Cosmosa — wpisz `COSMOS_PASSWORD`.
4. Zainstaluj jako aplikację (menu przeglądarki → „Zainstaluj" / „Dodaj do ekranu
   głównego"). Gotowe — masz Cosmosa zawsze pod ręką. 🎉

---

## KROK 8 — Podłącz domowy komputer z RTX 3080

Aby z VPS korzystać z lokalnego modelu na Twojej karcie (gdy komputer jest włączony):

**Na komputerze stacjonarnym (Windows):**
1. Zainstaluj **Ollama** (https://ollama.com) i pobierz model, np.:
   ```
   ollama pull nemotron-mini
   ```
2. Zainstaluj **Tailscale** na tym komputerze, zaloguj tym samym kontem. Zapisz jego
   adres Tailscale (np. `100.88.88.88`).
3. Pozwól Ollamie słuchać w sieci Tailscale — ustaw zmienną środowiskową
   `OLLAMA_HOST=0.0.0.0` (w Windows: Zmienne środowiskowe → nowa zmienna) i uruchom
   Ollamę ponownie.

**Na VPS** — w pliku `.env` wpisz adres domowego komputera:
```ini
LOCAL_BASE_URL=http://100.88.88.88:11434/v1
LOCAL_MODEL=nemotron-mini
```
Zrestartuj usługę: `sudo systemctl restart cosmos`.

**Efekt:**
- Gdy komputer w domu jest **włączony** → w Cosmosie przełącznik „Lokalnie" świeci na
  zielono, rozmowy idą na Twoją RTX 3080 (za darmo, prywatnie).
- Gdy komputer jest **wyłączony** → „Lokalnie" pokazuje offline, używasz zakładki
  „Chmura" (NVIDIA/OpenAI/Claude). Cosmos działa dalej, bez przerwy.

> To samo dotyczy zmysłów (Whisper, generowanie obrazów lokalnie): jeśli chcesz ich
> używać, uruchom `senses/service.py` na domowym komputerze i w `.env` na VPS ustaw
> `SENSES_URL=http://100.88.88.88:7060`. Gdy komputer śpi, Cosmos używa zapasowo
> rozpoznawania mowy z przeglądarki, a wyszukiwanie w bazie wiedzy przechodzi na
> tryb słów kluczowych. Nic się nie psuje — po prostu część funkcji czeka na PC.

---

## Cursor z VPS

W konfiguracji MCP Cursora dodaj token i adres VPS:
```json
{
  "mcpServers": {
    "cosmos": {
      "command": "node",
      "args": ["C:/sciezka/do/Bear/mcp/cosmos-mcp.js"],
      "env": {
        "COSMOS_URL": "http://100.101.102.103:3000",
        "COSMOS_TOKEN": "ten-sam-token-co-COSMOS_API_TOKEN-w-env"
      }
    }
  }
}
```

---

## Aktualizacja Cosmosa na VPS

Gdy pojawią się zmiany w kodzie:
```bash
cd /opt/cosmos
git pull
sudo systemctl restart cosmos
```

---

## Alternatywa: publiczna domena + HTTPS (bez Tailscale)

Jeśli wolisz zwykły adres `https://cosmos.twojadomena.pl` zamiast adresu Tailscale:

1. Skieruj domenę na IP VPS (rekord A w panelu domeny).
2. Zainstaluj Caddy (automatyczny, darmowy certyfikat HTTPS):
   ```bash
   sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt update && sudo apt install caddy
   ```
3. Ustaw Caddy jako pośrednika:
   ```bash
   echo 'cosmos.twojadomena.pl {
       reverse_proxy localhost:3000
   }' | sudo tee /etc/caddy/Caddyfile
   sudo systemctl restart caddy
   ```
4. W `.env` dodaj `COSMOS_COOKIE_SECURE=1` (cookie tylko po HTTPS) i zrestartuj Cosmosa.

Caddy sam pobierze certyfikat. Od teraz wchodzisz pod `https://cosmos.twojadomena.pl`.
Hasło (`COSMOS_PASSWORD`) jest tu jeszcze ważniejsze — adres jest publiczny.

---

## Bezpieczeństwo — podsumowanie

- ✅ **Zawsze** ustaw `COSMOS_PASSWORD` na serwerze dostępnym z internetu.
- ✅ Używaj długiego, unikalnego hasła (nie tego samego co gdzie indziej).
- ✅ Token `COSMOS_API_TOKEN` traktuj jak hasło — nie wklejaj go publicznie.
- ✅ Tailscale = brak otwartych portów na świat (najbezpieczniej).
- ✅ Klucze API są tylko w `.env` na VPS — nie trafiają do przeglądarki ani do repozytorium.
- ✅ Regularnie rób `git pull` i restart, żeby mieć poprawki.

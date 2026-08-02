# 🚀 Cosmos — jedna instrukcja od zera do działania (zacznij tutaj)

Ten plik prowadzi Cię od zera do działającego Cosmosa — na komputerze, telefonie
i Surface Pro. Rób punkty po kolei. Nie musisz znać się na programowaniu; wszystko
jest opisane słowo po słowie.

> **Ile to zajmie?** Podstawowe uruchomienie (czat) — około 15 minut.
> Pełna wersja z głosem, wzrokiem i aplikacją na telefonie — około godziny.
> Wariant „zawsze dostępny" w chmurze — dodatkowe 30–40 minut.

---

## Co będziesz miał na końcu

- Własnego asystenta AI (jak ChatGPT), ale **prywatnego** — Twoje dane, Twoje klucze.
- Ten sam asystent na telefonie z Androidem, iPhonie, Macu i Surface Pro — ze **wspólną
  historią rozmów**.
- Przełącznik: model lokalny (Twoja karta RTX 3080) albo chmura (NVIDIA / OpenAI / Claude).
- Opcjonalnie: rozmowę głosem, „widzenie" przez kamerę, generowanie grafik, dźwięku
  i wideo, bazę wiedzy na Twoje pliki, naukę procedur i trening własnego modelu.

---

# ⚠️ NAJPIERW: wybierz, gdzie ma stać serwer

To **najważniejsza decyzja** i od niej zależy wszystko dalej. Przeczytaj tę sekcję,
zanim zaczniesz cokolwiek instalować.

Cosmos składa się z dwóch części:
- **serwer** — mózg-dyrygent: trzyma Twoje dane (rozmowy, pamięć, bazę wiedzy) i klucze API,
- **aplikacja** — to, co widzisz (przeglądarka / ikona na telefonie / okno na Windows).

Aplikacja zawsze łączy się z serwerem. **Cosmos działa dokładnie wtedy, kiedy działa
jego serwer.** Dlatego to, gdzie postawisz serwer, decyduje o tym, kiedy masz dostęp:

| | **Ścieżka A** — serwer na Twoim komputerze | **Ścieżka B** — serwer w chmurze (VPS) |
|---|---|---|
| Kiedy działa | tylko gdy komputer jest **włączony** | **zawsze**, 24/7 |
| Koszt | 0 zł (tylko prąd) | ~kilkanaście–kilkadziesiąt zł/mies. |
| Gdzie są Twoje dane | u Ciebie na dysku (maksymalna prywatność) | na wynajętym serwerze |
| Dostęp poza domem | przez Tailscale (gdy PC włączony) | z każdego miejsca |
| Lokalna RTX 3080 | natychmiast | gdy włączysz domowy PC (przez Tailscale) |
| Dla kogo | start, nauka, maksymalna prywatność | „chcę Cosmosa zawsze pod ręką" |

### Moja rekomendacja

- **Zacznij od Ścieżki A.** Jest darmowa, prosta i pozwala poznać Cosmosa. Jeśli
  komputer jest włączony wtedy, kiedy chcesz z niego korzystać — to Ci wystarczy.
- **Przejdź na Ścieżkę B**, gdy poczujesz, że chcesz mieć Cosmosa dostępnego z telefonu
  także wtedy, gdy komputer jest wyłączony (bo np. nie chcesz trzymać PC włączonego
  całą dobę — to i koszt prądu, i zużycie sprzętu).
- **Wariant pośredni (mini-PC)** — opisany w [Części 2C](#część-2c--wariant-pośredni-mały-komputer-247).
  Serwer i dane na małym, cichym urządzeniu włączonym 24/7 u Ciebie w domu; duży komputer
  z RTX budzisz tylko do liczenia. Najlepszy balans prywatności, kosztu i wygody.

> **Dobra wiadomość:** ścieżki nie są na zawsze. Możesz zacząć od A, a później przenieść
> wszystko na VPS — dane przenosisz kopią zapasową (Ustawienia → Pobierz kopię, potem
> Przywróć z pliku na nowym serwerze).

**Jak czytać dalej:**
1. **Część 1** — podstawy (robią ją WSZYSCY, niezależnie od ścieżki).
2. Potem **Część 2** (Ścieżka A) **albo Część 3** (Ścieżka B) — tylko jedną z nich.
3. Dalej Części 4–7 — wspólne dla obu ścieżek.

---

# CZĘŚĆ 1 — Podstawy (dla wszystkich)

## KROK 1 — Zainstaluj Node.js

Node.js to program, który uruchamia serwer Cosmosa.

1. Wejdź na **https://nodejs.org**
2. Kliknij duży zielony przycisk z napisem **„LTS"** (wersja zalecana).
3. Uruchom pobrany plik i klikaj **Dalej / Next** aż do końca (nic nie zmieniaj).
4. Sprawdź, czy się udało: naciśnij `Windows + R`, wpisz `cmd`, naciśnij Enter.
   W czarnym oknie wpisz:
   ```
   node --version
   ```
   Jeśli pokaże się coś w stylu `v22.14.0` — gotowe. (Musi być 18 lub wyżej.)

## KROK 2 — Pobierz Cosmos

**Najprościej (bez instalowania Gita):**
1. Wejdź na stronę repozytorium na GitHubie.
2. Kliknij zielony przycisk **„Code" → „Download ZIP"**.
3. Rozpakuj ZIP np. do `C:\Cosmos`.

**Albo przez Git** (jeśli masz zainstalowany):
```
git clone <adres-repozytorium> C:\Cosmos
```

Od teraz zakładam, że Cosmos jest w folderze `C:\Cosmos`.

## KROK 3 — Wpisz swoje klucze API

1. W folderze `C:\Cosmos` znajdź plik **`.env.example`**.
2. Skopiuj go i zmień nazwę kopii na **`.env`** (sama kropka i słowo env, bez nic więcej).
   - *Podpowiedź:* w oknie `cmd` w folderze Cosmosa możesz wpisać: `copy .env.example .env`
3. Otwórz `.env` Notatnikiem i uzupełnij to, czego chcesz używać. **Nic nie jest
   obowiązkowe poza jednym silnikiem AI.** Zacznij od chmury NVIDIA — jest darmowa
   na start:

   **Chmura NVIDIA (zalecane na początek):**
   - Wejdź na **https://build.nvidia.com**, załóż darmowe konto.
   - Wybierz model Nemotron, kliknij **„Get API Key"**, skopiuj klucz (zaczyna się od `nvapi-`).
   - W `.env` wpisz go po znaku `=`:
     ```
     NVIDIA_API_KEY=nvapi-tutaj-twój-klucz
     ```

   **Pozostałe klucze (opcjonalnie, gdy chcesz):**
   | Chcesz... | Wpisz w `.env` | Klucz zdobędziesz na |
   |---|---|---|
   | Czat na GPT + grafiki | `OPENAI_API_KEY=` | platform.openai.com |
   | Czat na Claude | `ANTHROPIC_API_KEY=` | console.anthropic.com |
   | Głos (lektor) | `ELEVENLABS_API_KEY=` | elevenlabs.io |
   | Wideo | `SEEDANCE_API_KEY=` i `SEEDANCE_MODEL=` | konsola BytePlus |
   | Grafiki Adobe | `FIREFLY_CLIENT_ID=` i `FIREFLY_CLIENT_SECRET=` | developer.adobe.com/console |

4. Zapisz plik (`Ctrl+S`) i zamknij.

> 🔒 **Bezpieczeństwo:** plik `.env` z Twoimi kluczami zostaje tylko tam, gdzie stoi
> serwer. Nigdy nie trafia do przeglądarki ani na GitHub.

### Który model Nemotron wybrać?

Na start **nie musisz nic wybierać** — zostaw domyślny i wróć tutaj później.
Gdy zechcesz dobrać świadomie:

| Do czego | Model | Dlaczego |
|---|---|---|
| **Czat w chmurze** (codziennie) | `nemotron-3-super-120b-a12b` | Najlepszy stosunek jakości do szybkości; kontekst 1M, mocny w rozumowaniu. Darmowy endpoint |
| Czat w chmurze (maksimum) | `nemotron-3-ultra-550b-a55b` | Flagowiec — wolniejszy, ale najlepszy w trudnych zadaniach |
| **Wzrok w chmurze** | `nemotron-3-nano-omni-30b-a3b-reasoning` | Omni-modalny: obrazy, **wideo**, mowa i tekst. Idealny do kamery i „co mam w ręku?" |
| **Model lokalny** (RTX 3080) | `nemotron-nano-9b-v2` | W 4-bit ~6 GB — mieści się w 10 GB z zapasem |
| Lokalny wzrok | `llama-3.1-nemotron-nano-vl-8b-v1` | 8B, zmieści się obok modelu tekstowego |

**⚠️ Uwaga na pułapkę:** `nemotron-3-nano-30b-a3b` reklamuje się jako „tylko 3 mld
aktywnych parametrów", ale architektura MoE oszczędza **obliczenia, nie pamięć** —
wszystkie 30 mld musi zmieścić się w karcie (~16–18 GB). **Na RTX 3080 nie wejdzie.**
Tak samo `super-120b` i `ultra-550b` — te tylko przez chmurę.

**Po polsku:** im większy model, tym lepsza polszczyzna. Dlatego sensowny podział to
**chmura do pisania i rozumowania, model lokalny do rzeczy prywatnych i pracy bez
internetu** — czyli dokładnie ten hybrydowy układ, który daje Cosmos.

> 💡 **Nie przepisuj nazw ręcznie.** W aplikacji: **Ustawienia → „Pobierz listę"**
> pobiera prawdziwe identyfikatory prosto z endpointu i wypełnia listę wyboru.
> Nazwa w katalogu na build.nvidia.com bywa inna niż ciąg używany w API.

**Warto dołożyć później** (opcjonalnie): `llama-nemotron-embed-1b-v2` — embeddingi
w 26 językach, w tym polskim, do bazy wiedzy; `llama-nemotron-rerank-1b-v2` —
poprawia trafność wyszukiwania; `nemotron-ocr-v2` — OCR do skanów i PDF-ów.

## KROK 4 — Uruchom Cosmos po raz pierwszy

1. Otwórz folder `C:\Cosmos` w oknie `cmd`:
   - Wejdź do folderu w Eksploratorze plików, kliknij pasek adresu, wpisz `cmd`, Enter.
2. Wpisz:
   ```
   npm start
   ```
3. Zobaczysz kilka linijek zaczynających się od `✦ Cosmos`. To znaczy, że działa.
4. Otwórz przeglądarkę (Chrome lub Edge) i wejdź na:
   ```
   http://localhost:3000
   ```
5. Powinieneś zobaczyć Cosmos. Napisz coś w polu na dole i naciśnij Enter. 🎉

> Aby zatrzymać serwer: w oknie `cmd` naciśnij `Ctrl + C`. Aby uruchomić ponownie: `npm start`.

✅ **Cosmos działa.** Teraz wybierz swoją ścieżkę: **Część 2** (serwer u Ciebie)
albo **Część 3** (serwer w chmurze).

---

# CZĘŚĆ 2 — ŚCIEŻKA A: serwer na Twoim komputerze

Wybierasz ją, jeśli chcesz zacząć bez kosztów i trzymać wszystkie dane u siebie.

## Część 2A — Prawda o włączonym komputerze (przeczytaj)

**Gdy komputer z serwerem jest wyłączony, telefon nie ma się z czym połączyć.**
To zasadnicza różnica między Cosmosem a ChatGPT:

- **ChatGPT** działa w centrach danych OpenAI włączonych 24 godziny na dobę.
- **Cosmos** to Twój prywatny system — „centrum danych" to Twój komputer. Jest włączony
  wtedy, kiedy Ty go włączysz.

To **cena suwerenności**: Twoje dane, modele i klucze są u Ciebie, nikt inny ich nie
widzi — ale to Ty odpowiadasz za to, żeby serwer działał.

Na komputerze działają trzy rzeczy naraz:
1. **Mózg lokalny** — modele AI na Twojej RTX 3080 (bez komputera = brak karty).
2. **Twoje dane** — rozmowy, pamięć, baza wiedzy (folder `data` na dysku).
3. **Serwer** — pośrednik, przez który telefon rozmawia z modelami i sięga po dane.

Telefon nie ma ani Twojej karty graficznej, ani Twoich plików. On tylko wyświetla
i wysyła pytania do komputera.

**Co działa, gdy komputer jest wyłączony:**

| Na telefonie | Komputer włączony | Komputer wyłączony |
|---|---|---|
| Otwarcie aplikacji Cosmos | ✅ | ✅ (sama aplikacja jest zapamiętana) |
| Podejrzenie ostatnio otwartych rozmów | ✅ | ✅ (kopia offline, tylko do czytania) |
| Nowa rozmowa / odpowiedź AI | ✅ | ❌ |
| Dostęp do pełnej historii i bazy wiedzy | ✅ | ❌ |
| Głos, generowanie grafik/wideo | ✅ | ❌ |

## Część 2B — Automatyczny start serwera (Windows)

Żeby nie wpisywać `npm start` za każdym razem:

1. W folderze `C:\Cosmos` utwórz plik tekstowy **`start-cosmos.bat`** o treści:
   ```bat
   cd /d C:\Cosmos
   npm start
   ```
2. Naciśnij `Windows + R`, wpisz `shell:startup`, Enter — otworzy się folder „Autostart".
3. Wrzuć do niego skrót do `start-cosmos.bat`.

Od teraz serwer uruchomi się sam przy każdym włączeniu komputera.

> Chcesz, żeby serwer działał, nawet gdy nikt nie jest zalogowany (np. na mini-PC)?
> Użyj darmowego narzędzia **NSSM**, które uruchamia Cosmos jako usługę Windows w tle.

## Część 2C — Wariant pośredni: mały komputer 24/7

Najlepszy kompromis między kosztem prądu a wygodą, **bez oddawania danych w chmurę**:

- Weź tani mini-PC (albo stary laptop) i uruchom na nim **tylko serwer Cosmosa**
  (jest lekki — nie potrzebuje mocnej karty).
- Twoje rozmowy, pamięć i baza wiedzy leżą na tym małym, cichym urządzeniu włączonym 24/7.
- Do rozmów używa **chmury** (NVIDIA / OpenAI / Claude) — tam jest moc obliczeniowa.
- Duży komputer z RTX 3080 włączasz **tylko wtedy**, gdy chcesz liczyć lokalnie.

To wzorzec „mały mózg zawsze czuwa, wielki mózg budzi się na żądanie". Mini PC pobiera
kilka watów — prąd to grosze miesięcznie. Konfiguracja jak w Części 1 + autostart (2B).

## Część 2D — Budzenie komputera zdalnie (Wake-on-LAN)

Komputer śpi (nie zużywa prądu), a gdy chcesz go użyć, „budzisz" go z telefonu:

- Włącz **Wake-on-LAN** w BIOS komputera i w ustawieniach karty sieciowej Windows.
- Na telefonie zainstaluj aplikację typu „Wake on LAN".
- Efekt: klikasz w telefonie, komputer budzi się w kilkanaście sekund, Cosmos działa.
- Działa najlepiej w sieci domowej; poza domem wymaga dodatkowej konfiguracji.

## Część 2E — Dostęp poza domem (Tailscale)

Domyślnie telefon łączy się z komputerem tylko w tej samej sieci Wi-Fi. Żeby mieć dostęp
z dowolnego miejsca **bez otwierania portów na routerze**:

1. Załóż darmowe konto na **https://tailscale.com**.
2. Zainstaluj Tailscale na komputerze **i** na telefonie, zaloguj się tym samym kontem.
3. Tailscale nada komputerowi stały prywatny adres (np. `100.x.x.x`).
4. Na telefonie otwieraj Cosmos pod tym adresem: `http://100.x.x.x:3000`.

To prywatny, szyfrowany tunel tylko między Twoimi urządzeniami. Nikt z zewnątrz nie ma
dostępu. (Komputer i tak musi być włączony — Tailscale tylko łączy, nie budzi.)

> 🔒 Jeśli wystawiasz Cosmosa gdziekolwiek poza `localhost`, ustaw hasło
> `COSMOS_PASSWORD` w `.env` (patrz Część 3, KROK 4 — zasada jest ta sama).

➡️ Teraz przejdź do **Części 4** (aplikacje na urządzeniach).

---

# CZĘŚĆ 3 — ŚCIEŻKA B: serwer w chmurze (VPS), zawsze dostępny

Wybierasz ją, jeśli chcesz mieć Cosmosa dostępnego **zawsze** — także gdy Twój komputer
jest wyłączony. Układ docelowy:

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
> (Twoje pieniądze) i przeczyta Twoje dane. Ustawiamy je w KROKU 4.

### Zanim zaczniesz: dwa komputery, dwa zestawy komend

Od tego miejsca pracujesz **na dwóch maszynach naraz** i to najczęstsze źródło pomyłek:
komenda linuksowa wklejona w okno Windowsa kończy się błędem, który wygląda groźniej,
niż jest. Zawsze patrz na **znak zachęty** — on mówi, gdzie jesteś:

| Znak zachęty | Gdzie jesteś | Co tam działa |
|---|---|---|
| `C:\...>` lub `D:\Cosmos>` | Twój komputer (Windows) | `git pull`, `python service.py`, `ollama`, `ssh` |
| `root@nazwa-serwera:~#` | VPS (Linux) | `sudo`, `systemctl`, `nano`, `apt`, `curl`, `git pull` |

Dopóki widzisz literę dysku i ukośniki w tył — jesteś u siebie, `sudo` i `systemctl`
nie zadziałają. Na VPS przechodzisz komendą `ssh root@ADRES`, a wracasz przez `exit`.

> Windows 11 ma własne `sudo`, wyłączone domyślnie. Gdy zobaczysz *„Sudo is disabled on
> this machine"*, **nie włączaj go** — to nie jest to samo narzędzie i nie naprawi
> niczego w Cosmosie. Komunikat znaczy tylko tyle, że jesteś w złym oknie.

**Co będziesz potrzebował:**
- Konto u dostawcy VPS (rekomendacja niżej) — **2 GB RAM i 40 GB dysku**.
- Konto **Tailscale** (darmowe) — łączy VPS, telefon i komputer w prywatną sieć.
- Około 30–40 minut.

### Którego dostawcę VPS wybrać?

**Najpierw zrozum, czego Cosmos naprawdę potrzebuje.** Nie potrzebuje mocy obliczeniowej —
modele liczą się w chmurze NVIDII albo na Twoim RTX w domu. VPS uruchamia tylko serwer
Node.js i trzyma dane, co zajmuje ~200 MB RAM. **Krytyczny jest dysk**, bo baza wiedzy
przechowuje pliki: nagrania, audio, grafiki ze Studia, migawki z osi czasu.
**Bierz 40 GB, nie 20** — 20 GB skończy się po kilku dłuższych nagraniach.

| Dostawca | Cena orientacyjnie | Zalety | Wady |
|---|---|---|---|
| **Hetzner** ⭐ | ~7,4 €/mies (~31 zł) z VAT za 2 vCPU / 4 GB / 40 GB | Bezkonkurencyjny stosunek ceny do zasobów w Europie. Norymberga = ~25 ms z Polski. Rozliczenie godzinowe, snapshoty | Nowe konta bywają weryfikowane dokumentem. Faktura unijna (reverse charge), nie polska |
| **Mikr.us** | ~15–25 zł/mies | Polska firma, **polska faktura i wsparcie po polsku**, prosty panel | Mniejsze zasoby, współdzielone — sprawdź rozmiar dysku w planie |
| **OVH** | ~20–25 zł/mies | **Serwerownia w Warszawie**, polska faktura VAT | Panel nieprzyjemny, wsparcie bywa wolne |
| **DigitalOcean** | ~6 $/mies (~24 zł) | Najlepsza dokumentacja i UX | Drożej za te same zasoby, rozliczenie w USD |

**Moja rekomendacja: Hetzner CX23** (albo aktualny odpowiednik z linii CX — nazwy zmieniają
się co rok, szukaj **2 vCPU / 4 GB / 40 GB** w zakładce *Shared Cost-Optimized*).
Za ~31 zł miesięcznie dostajesz dwa razy więcej niż u konkurencji, a lokalizacja
w Niemczech jest z Polski praktycznie nieodczuwalna przy czacie.

**Ustawienia w kalkulatorze Hetznera — na co uważać:**

| Opcja | Wybierz | Dlaczego |
|---|---|---|
| Zakładka | **Shared Cost-Optimized** (linia CX) | Cosmos nie potrzebuje dedykowanego CPU |
| VCPU | **Intel/AMD**, 2 rdzenie | ⚠️ **nie bierz Ampere (ARM)** — Chromium dla automatyzacji web jest tam kłopotliwy. Oszczędność 3 € nie jest tego warta |
| Availability Zone | NBG1 lub FSN1 (Niemcy) | Obie ~25 ms z Polski. Helsinki też zadziała |
| Adres IP | ⚠️ **Primary IPv4**, nie „IPv6 only" | **To najczęstszy błąd.** Serwer bez IPv4 jest niewidoczny z LTE w telefonie, hoteli i wielu polskich sieci. Kosztuje ~0,60 €/mies i oszczędza godziny szukania przyczyny |
| Expected Traffic | zostaw jak jest | 20 TB jest w cenie, zużyjesz ułamek procenta |

> **Jeden wyjątek:** jeśli prowadzisz działalność i potrzebujesz **polskiej faktury VAT**
> do kosztów, weź **OVH** (Warszawa) albo **Mikr.us**. To jedyny powód, dla którego
> odradzałbym Hetznera.

**Czego nie kupować:** planu z 1 GB RAM (zabraknie zapasu przy imporcie do bazy wiedzy),
dodatkowych rdzeni (nic nie dadzą — model liczy się gdzie indziej) ani „VPS z GPU"
(kosztuje kilkanaście razy więcej, a masz RTX 3080 w domu).

> 💡 Zacznij od najmniejszego sensownego planu. RAM i CPU zwykle powiększysz później
> jednym kliknięciem; **dysk też, ale tylko w górę i bez powrotu** — dlatego od razu 40 GB.

**Włącz backupy** u dostawcy (zwykle +20% ceny, ~6 zł). Przy Twoich rozmowach i bazie
wiedzy warte tych pieniędzy.

> **Dlaczego Tailscale, a nie publiczny adres?** Nie otwierasz żadnych portów na świat,
> nie potrzebujesz domeny ani certyfikatów, a masz dostęp z każdego miejsca. VPS jest
> widoczny tylko dla Twoich urządzeń. (Wariant z domeną i HTTPS — na końcu tej części.)

## KROK 1 — Załóż VPS

1. U dostawcy utwórz nowy serwer z systemem **Ubuntu 24.04 LTS**.
   - Zaznacz **Primary IPv4** (patrz tabela wyżej — bez tego nie wejdziesz z telefonu).
   - Zaznacz **backupy** (+20% ceny). Przy Twojej bazie wiedzy warte tych pieniędzy.
   - Firewall dostawcy możesz zostawić wyłączony — dostęp zamykamy przez Tailscale w KROKU 5.
2. Zapisz jego adres IP i hasło do użytkownika `root` (albo skonfiguruj klucz SSH).
3. Połącz się z serwerem z komputera (w `cmd` na Windows):
   ```
   ssh root@ADRES-IP-SERWERA
   ```

## KROK 2 — Zainstaluj Node.js i Gita na VPS

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

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```
Pojawi się link — otwórz go w przeglądarce i zaloguj na swoje konto Tailscale.
Zapisz adres, który VPS dostanie (np. `100.101.102.103`) — pod nim będziesz się łączyć.

## KROK 6 — Uruchom Cosmosa jako usługę (żeby działał zawsze)

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
4. Zainstaluj jako aplikację (szczegóły w **Części 4**). Gotowe. 🎉

## KROK 8 — Podłącz domowy komputer z RTX 3080

Aby z VPS korzystać z lokalnego modelu na Twojej karcie (gdy komputer jest włączony):

**Na komputerze stacjonarnym (Windows):**
1. Zainstaluj **Ollama** (https://ollama.com) i pobierz model:
   ```
   ollama pull rwxproject/nemotron-nano-9b-v2-q4_k_m
   ```
   Szczegóły wyboru wersji — w ramce niżej.
2. Zainstaluj **Tailscale** na tym komputerze, zaloguj tym samym kontem. Zapisz jego
   adres Tailscale (np. `100.88.88.88`).
3. Pozwól Ollamie słuchać w sieci Tailscale. Domyślnie przyjmuje połączenia tylko
   z tego samego komputera, więc VPS by się nie dobił.

   Windows: **Start → „zmienne środowiskowe" → Zmienne środowiskowe → Nowa** (w górnej
   sekcji „Zmienne użytkownika"). W okienku są dwa pola:

   | Pole | Wpisz |
   |---|---|
   | Nazwa zmiennej | `OLLAMA_HOST` |
   | Wartość zmiennej | `0.0.0.0` |

   Znaku `=` **nie wpisujesz** — pola są już rozdzieleniem. Zatwierdź **OK** we wszystkich
   trzech okienkach, inaczej zmiana się nie zapisze.

4. **Zamknij Ollamę całkowicie i uruchom ponownie.** Zmienne działają tylko dla programów
   uruchomionych po ich ustawieniu, a Ollama siedzi w tle: prawy dolny róg ekranu →
   strzałka „pokaż ukryte ikony" → prawy przycisk na ikonie lamy → **Quit Ollama**.
   Potem uruchom ją z menu Start. Gdy Zapora Windows zapyta o zgodę — zaznacz
   **sieci prywatne**.

> 🔒 `0.0.0.0` znaczy „słuchaj na wszystkich kartach sieciowych", więc z modelu może
> skorzystać też ktoś podłączony do Twojego domowego Wi-Fi (z internetu nikt nie wejdzie).
> Aby zawęzić dostęp wyłącznie do Tailscale, wpisz zamiast tego adres z portem, np.
> `100.88.88.88:11434` — minusem jest konieczność poprawki, gdyby adres się zmienił.

**Sprawdź, czy VPS widzi Ollamę** — na VPS wpisz (podstaw swój adres Tailscale):
```bash
curl http://100.88.88.88:11434/api/tags
```
Powinna wrócić lista modeli w formacie JSON. Jeśli widzisz „connection refused", to znaczy,
że Ollama nie została zrestartowana po ustawieniu `OLLAMA_HOST` albo blokuje ją Zapora
Windows.

**Na VPS** — w pliku `.env` wpisz adres domowego komputera:
```ini
LOCAL_BASE_URL=http://100.88.88.88:11434/v1
LOCAL_MODEL=rwxproject/nemotron-nano-9b-v2-q4_k_m
```
Zrestartuj usługę: `sudo systemctl restart cosmos`.

### Którą wersję modelu pobrać do Ollamy?

Szukając `nemotron-nano-9b-v2` na ollama.com zobaczysz kilkanaście pozycji z **ukośnikiem
i nazwą użytkownika** (`rwxproject/…`). To normalne: nie ma oficjalnego wpisu w bibliotece
Ollamy, są tylko konwersje społeczności. Końcówka nazwy to stopień kompresji wag —
im mocniejsza, tym mniej VRAM-u, ale i gorsza jakość.

| Wersja | ~VRAM | Na RTX 3080 (10 GB) |
|---|---|---|
| `q2_k` / `q3_k_m` | 3,5–4,5 GB | ❌ zmieszczą się, ale jakość po polsku wyraźnie spada |
| **`q4_k_m`** | **~5,5 GB** | ✅ **zalecane** — złoty środek, zostaje zapas na kontekst |
| `q5_k_m` | ~6,4 GB | ✅ minimalnie lepszy; spróbuj, gdy `q4_k_m` działa dobrze |
| `q8_0` | ~9,5 GB | ❌ zapcha kartę, zabraknie pamięci na rozmowę |
| `f16` / `f32` | 18–36 GB | ❌ tylko na kartę serwerową |

Omijaj warianty z dopiskiem `-japanese` (dotrenowany pod japoński) oraz `-virtuoso`
(cudzy eksperymentalny merge o nieznanej zawartości).

> ⚠️ **Sprawdź model zaraz po pobraniu.** Konwersje społeczności bywają bez szablonu
> rozmowy, a wtedy model odpowiada bełkotem albo gada sam ze sobą:
> ```
> ollama run rwxproject/nemotron-nano-9b-v2-q4_k_m "Napisz dwa zdania o Warszawie."
> ```
> Jeśli odpowiedź jest bez sensu, weź konwersję z Hugging Face (Ollama pobiera ją wprost):
> ```
> ollama pull hf.co/bartowski/nvidia_NVIDIA-Nemotron-Nano-9B-v2-GGUF:Q4_K_M
> ```
> Gdyby ta nazwa się nie zgadzała, wyszukaj na huggingface.co „Nemotron-Nano-9B-v2 GGUF"
> i weź plik `Q4_K_M`. Do `.env` wpisz **dokładnie** tę nazwę, którą pobrałeś.

> 💡 Nemotron Nano to hybryda Transformer-Mamba — zużywa znacznie mniej pamięci na długi
> kontekst niż zwykły transformer. Zapas po `q4_k_m` wystarczy na bardzo długie rozmowy.

**Słabsza karta niż RTX 3080?** Weź `nemotron-mini` (4B) z oficjalnej biblioteki —
`ollama pull nemotron-mini`. Zmieści się na 6 GB VRAM.

**Efekt:**
- Gdy komputer w domu jest **włączony** → przełącznik „Lokalnie" świeci na zielono,
  rozmowy idą na Twoją RTX 3080 (za darmo, prywatnie).
- Gdy komputer jest **wyłączony** → „Lokalnie" pokazuje offline, używasz zakładki
  „Chmura". Cosmos działa dalej, bez przerwy.

## KROK 9 — Wskaż serwerowi zmysły na domowym komputerze

**Pomiń ten krok, jeśli nie instalujesz zmysłów** (CZĘŚĆ 5 — mikrofon, kamera, pamięć
semantyczna). Jeśli je instalujesz, zrób go — inaczej wskaźnik „Zmysły" **zostanie
czerwony na zawsze**, mimo że usługa na Twoim komputerze działa poprawnie.

Powód jest ten sam co przy Ollamie: domyślnie serwer szuka zmysłów pod `localhost:7060`,
a dla VPS-a `localhost` to on sam. Zmysły chodzą na komputerze z kamerą i GPU, więc
trzeba podać jego adres Tailscale — ten sam, którego użyłeś w KROKU 8.

**1. Na domowym komputerze** uruchom zmysły (szczegóły: CZĘŚĆ 5):
```
cd /d C:\Cosmos\senses
.venv\Scripts\activate
python service.py
```
Zostaw to okno otwarte. Wypisze `✦ Cosmos Senses — port 7060` i listę aktywnych zmysłów.

**2. Na VPS** sprawdź, czy dochodzi (podstaw swój adres Tailscale):
```bash
curl http://100.88.88.88:7060/health
```
Powinna wrócić lista zmysłów w JSON-ie. „Connection refused" oznacza Zaporę Windows —
zamknij `service.py`, uruchom ponownie i zezwól Pythonowi na **sieci prywatne**.
Sam Tailscale jest sprawny, skoro Ollama działa; Zapora przyznaje pozwolenia osobno
każdemu programowi, a Python prosi o nie dopiero teraz.

**3. Na VPS** dopisz adres do `.env`:
```bash
nano /opt/cosmos/.env
```
```ini
SENSES_URL=http://100.88.88.88:7060
```
Zapis: `Ctrl+O`, `Enter`, wyjście: `Ctrl+X`. Potem `sudo systemctl restart cosmos`.

Odśwież przeglądarkę — po maksymalnie 30 sekundach „Zmysły" zapalą się na zielono
z liczbą aktywnych.

> Gdy komputer śpi, Cosmos używa zapasowo rozpoznawania mowy z przeglądarki, a bazy
> wiedzy szuka przez embeddingi z chmury. Nic się nie psuje — część funkcji po prostu
> czeka na PC.

### Baza wiedzy działająca zawsze (embeddingi z chmury)

Wyszukiwanie semantyczne w bazie wiedzy domyślnie liczy się na Twoim GPU (model bge-m3
w zmysłach). Na VPS-ie z wyłączonym komputerem domowym oznaczałoby to zejście do
prostego szukania po słowach kluczowych.

**Cosmos radzi sobie z tym sam.** Domyślne ustawienie `EMBED_PROVIDER=auto` działa tak:

- komputer domowy **włączony** → embeddingi liczą się lokalnie (za darmo i prywatnie),
- komputer **wyłączony** → Cosmos automatycznie przechodzi na **darmowy endpoint NVIDII**
  (`llama-nemotron-embed-1b-v2`, 26 języków z polskim).

Nie musisz nic ustawiać — wystarczy, że masz `NVIDIA_API_KEY`. Jeśli VPS w ogóle nie ma
łączyć się z domowym GPU, możesz wymusić chmurę na stałe: `EMBED_PROVIDER=nvidia`.

> **Dlaczego to bezpieczne:** wektory z różnych modeli mają inny wymiar i znaczenie, więc
> ich mieszanie dałoby bezsensowne wyniki. Cosmos znakuje każdy zapisany wektor modelem,
> który go policzył, i przy zmianie **automatycznie przelicza** wpisy. Przy dużej bazie
> pierwsze zapytania po zmianie mogą być nieco wolniejsze — potem wszystko wraca do normy.
>
> Sprawdzisz aktualny stan w **Ustawieniach → statystyki** albo pytając Cosmosa
> „pokaż, co potrafisz" (Nauka → Pomysły).

## Aktualizacja Cosmosa na VPS

```bash
cd /opt/cosmos
git pull
sudo systemctl restart cosmos
```

## Alternatywa: publiczna domena + HTTPS (bez Tailscale)

Jeśli wolisz zwykły adres `https://cosmos.twojadomena.pl`:

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

Caddy sam pobierze certyfikat. Hasło (`COSMOS_PASSWORD`) jest tu jeszcze ważniejsze —
adres jest publiczny.

➡️ Teraz przejdź do **Części 4** (aplikacje na urządzeniach).

---

# CZĘŚĆ 4 — Zainstaluj jako aplikację (obie ścieżki)

Wszędzie poniżej **ADRES-SERWERA** to:
- Ścieżka A: `localhost:3000` (na tym komputerze) albo `192.168.x.x:3000` (w sieci Wi-Fi),
  albo adres Tailscale `100.x.x.x:3000` (poza domem),
- Ścieżka B: adres VPS z Tailscale, np. `100.101.102.103:3000` (albo Twoja domena).

## Windows — wariant 1: PWA (najprostszy)

1. Otwórz `http://ADRES-SERWERA` w **Chrome lub Edge**.
2. Po prawej stronie paska adresu zobaczysz ikonę **„Zainstaluj"**
   (albo: menu ⋮ → *„Zainstaluj Cosmos…"*).
3. Kliknij ją. Cosmos pojawi się w menu Start jako osobna aplikacja z własną ikoną.

Działa tak samo na **Surface Pro**.

## Windows — wariant 2: aplikacja natywna (Electron)

Tylko dla Ścieżki A (serwer na tym samym komputerze). W oknie `cmd` w folderze Cosmosa:
```
npm install
npm run desktop
```
Cosmos otworzy się we własnym oknie i **sam uruchomi serwer** — nie musisz osobno
wpisywać `npm start`.

Aby zbudować instalator `.exe`:
```
npm run dist
```
Gotowy instalator znajdziesz w folderze `dist`.

## Android

1. Upewnij się, że masz dostęp do serwera (ta sama sieć Wi-Fi — Ścieżka A, albo
   Tailscale / VPS — Ścieżka B).
   - Adres komputera w sieci sprawdzisz tak: w `cmd` wpisz `ipconfig`, znajdź
     **„Adres IPv4"** — coś jak `192.168.1.20`.
2. Na telefonie otwórz w Chrome: `http://ADRES-SERWERA`
3. Menu ⋮ → **„Dodaj do ekranu głównego"** / **„Zainstaluj aplikację"**.

Cosmos działa wtedy jak natywna aplikacja (pełny ekran, własna ikona).

## iPhone / iPad (iOS, iPadOS)

1. Otwórz Cosmosa w przeglądarce **Safari** (na iOS tylko Safari potrafi instalować
   aplikacje): `http://ADRES-SERWERA`
2. Dotknij ikony **Udostępnij** (kwadrat ze strzałką w górę).
3. Wybierz **„Dodaj do ekranu początkowego"**.

> Ikona i pasek stanu są już przygotowane pod iOS — nie musisz nic ustawiać.

## Mac (macOS)

Safari (macOS Sonoma lub nowszy): otwórz `http://ADRES-SERWERA`, potem w menu górnym
**Plik → Dodaj do Docka**. W Chrome/Edge działa zwykła instalacja PWA (ikona
„Zainstaluj" w pasku adresu).

**Ikony aplikacji** są dołączone dla wszystkich platform: Windows/Android (192, 512,
maskable), iOS (`apple-touch-icon` 180), macOS Safari (`mask-icon`) oraz 1024 px.

---

# CZĘŚĆ 5 — Zmysły: głos, wzrok, pamięć (opcjonalnie)

To dodatkowa usługa w Pythonie. Bez niej Cosmos działa (czat, obrazy), ale nie ma
lokalnego rozpoznawania mowy, naturalnego głosu ani analizy obrazu na Twoim GPU.

> **Gdzie to uruchomić?** Tam, gdzie jest kamera, mikrofon i GPU — czyli na Twoim
> komputerze z RTX 3080 (nawet jeśli serwer stoi na VPS; wtedy patrz Część 3, KROK 8).

## KROK 1 — Zainstaluj Pythona
1. Wejdź na **https://python.org/downloads**, pobierz najnowszą wersję.
2. **WAŻNE:** podczas instalacji zaznacz na dole okna **„Add Python to PATH"**,
   dopiero potem klikaj instaluj.

## KROK 2 — Zainstaluj zmysły
W oknie `cmd`:
```
cd /d C:\Cosmos\senses
python -m venv .venv
.venv\Scripts\activate
pip install fastapi uvicorn python-multipart
```

> ⚠️ **Trzymasz Cosmosa na innym dysku niż `C:`?** Podmień ścieżkę, ale **nie pomijaj `/d`** —
> samo `cd D:\Cosmos\senses` po cichu **nie przełączy dysku** i zostaniesz tam, gdzie byłeś,
> bez żadnego komunikatu o błędzie. Ukośniki na Windowsie są w tył (`\`), nie `//`.
>
> Po każdym `cd` zerknij, czy znak zachęty kończy się na `\senses`. Jeśli nie —
> sprawdź, gdzie naprawdę leży projekt: `dir C:\Cosmos` albo `dir D:\Cosmos`.
Teraz zmysły. Najprościej **wszystkie naraz** (~3 GB, jedna komenda):
```
pip install -r requirements.txt
```

Albo **wybiórczo**, jeśli wolisz oszczędzić miejsce — każdy zmysł jest niezależny
i można pominąć niepotrzebne:
```
pip install faster-whisper        (słuch — rozpoznawanie mowy)
pip install piper-tts             (głos — naturalna synteza mowy po polsku)
pip install ultralytics opencv-python   (wzrok — rozpoznawanie obiektów)
pip install mediapipe             (sylwetka i gesty)
pip install sentence-transformers  (pamięć — inteligentne wyszukiwanie)
pip install pypdf python-docx openpyxl python-pptx   (czytanie dokumentów do bazy wiedzy)
pip install requests numpy        (obserwatory: kamera 24/7, Kinect, fotogrametria)
pip install sounddevice           (słuch przestrzenny z macierzy mikrofonów Kinecta)
```

> 🔊 **Sam `piper-tts` nie wystarczy do naturalnego głosu** — trzeba jeszcze pobrać plik
> polskiego głosu i wskazać go zmienną `PIPER_VOICE`. Bez tego zmysł „piper" pozostanie
> nieaktywny, a Cosmos będzie mówił głosem systemowym przeglądarki. Komplet komend:
> [../senses/README.md](../senses/README.md) — sekcja „Głos Piper (polski)".

## KROK 3 — Uruchom zmysły
W tym samym oknie `cmd` (musisz być w folderze `senses`, z aktywnym `(.venv)` z przodu):
```
python service.py
```
Zostaw to okno otwarte. W Cosmosie w panelu bocznym „Zmysły" zaświeci się na zielono.

> ⚠️ **Serwer na VPS (Ścieżka B)? Zielone nie zaświeci się samo.** Serwer szuka zmysłów
> pod `localhost:7060`, czyli u siebie, a one działają na tym komputerze. Trzeba mu podać
> adres — patrz **CZĘŚĆ 3, KROK 9**. Przy Ścieżce A (serwer na tym samym komputerze)
> nie musisz nic robić.

> **„can't open file … service.py: No such file or directory"** — nie jesteś w folderze
> `senses`. Wróć do ostrzeżenia w KROKU 2: najczęściej winne jest `cd` bez `/d`.
> Sprawdź `dir service.py` — jeśli plik się nie wypisze, jesteś w złym miejscu.

**Przy kolejnym uruchomieniu komputera** wystarczą trzy linijki (podmień literę dysku,
jeśli trzeba):
```
cd /d C:\Cosmos\senses
.venv\Scripts\activate
python service.py
```
Jeśli środowisko `.venv` powstało gdzie indziej (np. w folderze użytkownika), aktywuj je
pełną ścieżką, np. `C:\Users\"Twoja Nazwa"\.venv\Scripts\activate`. Cudzysłowy są
potrzebne, gdy nazwa folderu zawiera spację.

> **Pełna dokumentacja zmysłów: [../senses/README.md](../senses/README.md)** — pobranie
> polskiego głosu Piper, kamera 24/7, głębia z Kinecta, nasłuch słowa aktywującego,
> fotogrametria, analiza terenu i nasłonecznienia, planer lotu drona, sterowanie
> aparatem przez gPhoto2, słuch przestrzenny, głowica pan/tilt oraz spis endpointów.

---

# CZĘŚĆ 6 — Cursor i inne narzędzia MCP (opcjonalnie)

Aby Twój edytor kodu Cursor widział bazę wiedzy i pamięć Cosmosa:

1. W Cursorze: *Settings → MCP → Add server*.
2. Wklej (podmieniając ścieżkę i adres na swoje):
   ```json
   {
     "mcpServers": {
       "cosmos": {
         "command": "node",
         "args": ["C:/Cosmos/mcp/cosmos-mcp.js"],
         "env": {
           "COSMOS_URL": "http://localhost:3000",
           "COSMOS_TOKEN": "ten-sam-token-co-COSMOS_API_TOKEN-w-env"
         }
       }
     }
   }
   ```
   - Ścieżka A: `COSMOS_URL` to `http://localhost:3000`; `COSMOS_TOKEN` możesz pominąć,
     jeśli nie ustawiałeś hasła.
   - Ścieżka B: `COSMOS_URL` to adres VPS, a `COSMOS_TOKEN` jest **wymagany**.
3. Cosmos musi być uruchomiony.

Ten sam wpis działa w Claude Desktop i Claude Code.

---

# CZĘŚĆ 7 — Co możesz robić w Cosmosie (przegląd)

Gdy już działa, masz do dyspozycji dużo więcej niż sam czat:

- **Rozmowy pod kontrolą** — wyszukiwarka rozmów (po tytule i treści), przypinanie
  ważnych, zmiana nazwy, eksport, regeneracja odpowiedzi i edycja własnej wiadomości.
- **Pamięć i wiedza** — przycisk „✦ Zapamiętaj" pod wiadomością, profil użytkownika
  (Ustawienia) doklejany do każdej rozmowy, podsumowania rozmów, licznik tokenów.
- **Baza wiedzy** — wrzucaj pliki, linki i notatki głosowe; zaznaczone pozycje
  Cosmos dokłada do kontekstu, z reszty sam przywołuje pasujące fragmenty.
- **Studio** — generowanie obrazów (OpenAI / Adobe Firefly) z wariantami, szablonami,
  storyboardem, edycją/inpaintingiem i upscalem; dźwięk (ElevenLabs); wideo (Seedance,
  także z pierwszej i ostatniej klatki). Wszystko ląduje w Galerii i bazie wiedzy.
- **Kamera na żywo** — panel z detekcją obiektów, oraz tryb głosowy uruchamiany
  przyciskiem fal dźwiękowych (rozmowa po polsku przy otwartej karcie; nasłuch słowa
  aktywującego w tle jest jeszcze niedokończony — patrz `senses/README.md`).
- **Nauka** (przycisk w panelu bocznym) — naucz Cosmosa rozpoznawania (pokaż w kamerze
  i nazwij), **nagraj procedury** z ekranu (klikasz i wpisujesz, a Cosmos zapisuje kroki)
  i zaplanuj je jako **rutyny** cykliczne. Kroki wrażliwe (płatność, wysłanie) zawsze
  wymagają Twojego potwierdzenia — Cosmos nigdy nie płaci sam.
- **Digital Time Machine** — włącz w Ustawieniach, a Cosmos zapisuje migawki sceny
  do osi czasu (wskaźnik „REC"); wyłączona domyślnie dla prywatności.
- **Kopie zapasowe, statystyki i tryb offline** — w Ustawieniach.
- **Trening własnego modelu** (dla zaawansowanych) — w Ustawieniach wyeksportujesz swoje
  rozmowy jako dane treningowe (JSONL) albo klikniesz **„🎓 Dotrenuj teraz"**;
  w `training/` jest skrypt QLoRA i przewodnik, jak wpiąć model jako profil „Lokalnie".

> Pełny opis każdej funkcji: **[../README.md](../README.md)**.

---

# Codzienne używanie

**Ścieżka A (serwer u Ciebie):**
1. Włącz komputer (serwer wstanie sam, jeśli ustawiłeś autostart — Część 2B).
2. (Opcjonalnie) uruchom zmysły: `python service.py` w folderze `senses`.
3. Otwórz aplikację Cosmos na komputerze lub telefonie.

**Ścieżka B (VPS):**
1. Otwórz aplikację Cosmos — działa zawsze, nic nie musisz włączać.
2. Chcesz liczyć na RTX 3080? Włącz domowy komputer (Ollama + Tailscale) i przełącz
   w Cosmosie na „Lokalnie".

---

# Bezpieczeństwo — krótka lista

- ✅ **Zawsze** ustaw `COSMOS_PASSWORD`, jeśli serwer jest dostępny z internetu (VPS).
- ✅ Używaj długiego, unikalnego hasła (nie tego samego co gdzie indziej).
- ✅ Token `COSMOS_API_TOKEN` traktuj jak hasło — nie wklejaj go publicznie.
- ✅ Tailscale = brak otwartych portów na świat (najbezpieczniej).
- ✅ Klucze API są tylko w `.env` na serwerze — nie trafiają do przeglądarki ani do repozytorium.
- ✅ Rób kopie zapasowe (Ustawienia → Pobierz kopię) i aktualizuj (`git pull` + restart).

---

# Gdy coś nie działa

| Objaw | Co zrobić |
|---|---|
| `node` nie jest rozpoznawany | Zainstaluj Node.js (Część 1, Krok 1) i uruchom `cmd` na nowo |
| „Brak klucza API dla chmury NVIDIA" | Uzupełnij `NVIDIA_API_KEY` w `.env` i zrestartuj serwer |
| Strona `localhost:3000` się nie otwiera | Sprawdź, czy okno `cmd` z `npm start` nadal działa |
| Telefon nie łączy się (Ścieżka A) | Ten sam Wi-Fi? Dobry adres IP? Zapora Windows — zezwól Node.js na sieć prywatną |
| Telefon nie łączy się (Ścieżka B) | Tailscale włączony na telefonie i VPS? `sudo systemctl status cosmos` pokazuje `active (running)`? |
| Ekran logowania nie przyjmuje hasła | Sprawdź `COSMOS_PASSWORD` w `.env` na serwerze i zrestartuj (`sudo systemctl restart cosmos`) |
| „Lokalnie" pokazuje offline | Uruchom Ollamę; przy VPS sprawdź `LOCAL_BASE_URL` (adres Tailscale) i `OLLAMA_HOST=0.0.0.0` |
| „Zmysły" na czerwono | Uruchom `python service.py` w folderze `senses`. Jeśli działa, a wskaźnik dalej czerwony i serwer stoi na VPS — brakuje `SENSES_URL`, patrz CZĘŚĆ 3, KROK 9 |
| `sudo`/`systemctl`: „Sudo is disabled on this machine" | Jesteś w oknie Windowsa, nie na VPS. Najpierw `ssh root@ADRES` — patrz tabelka znaków zachęty w CZĘŚCI 3 |
| Błąd 404 przy czacie | Zły identyfikator modelu — **Ustawienia → Pobierz listę** |
| Model wideo/obraz zwraca błąd | Sprawdź, czy klucz w `.env` jest poprawny i ma środki |
| Chcę zacząć od zera | Zatrzymaj serwer, usuń folder `data`, uruchom ponownie |

Nadal problem? Otwórz `README.md` w głównym folderze — jest tam pełna dokumentacja
techniczna każdego elementu.

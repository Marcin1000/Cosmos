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

   Po dodaniu klucza OpenAI albo Anthropic w pasku górnym Cosmosa pojawi się **nowa
   zakładka silnika**. Który dokładnie model ma za nią stać, ustawiasz osobno:
   `OPENAI_MODEL=` (domyślnie `gpt-4o`) i `CLAUDE_MODEL=`. Jeśli zakładka zwraca błąd
   404, ten identyfikator nie istnieje na Twoim koncie — sprawdź listę przez
   **Ustawienia → Pobierz listę**.

4. Zapisz plik (`Ctrl+S`) i zamknij.

> 🔒 **Bezpieczeństwo:** plik `.env` z Twoimi kluczami zostaje tylko tam, gdzie stoi
> serwer. Nigdy nie trafia do przeglądarki ani na GitHub.

### Który model Nemotron wybrać?

Na start **nie musisz nic wybierać** — zostaw domyślny i wróć tutaj później.
Gdy zechcesz dobrać świadomie:

| Do czego | Model | Dlaczego |
|---|---|---|
| **Czat w chmurze** (domyślny) | `nemotron-3-ultra-550b-a55b` | 55 mld aktywnych = najlepsza polszczyzna. Odpowiada w 2,5–3,6 s, zawsze 3/3 prób |
| Czat, gdy wolisz tempo od polszczyzny | `nemotron-3-super-120b-a12b` | Zwykle 1,3 s, raz na kilka razy 4,4 s. Kontekst 1M, ale tylko 12 mld aktywnych |
| **Wzrok w chmurze** | `nemotron-3-nano-omni-30b-a3b-reasoning` | Omni-modalny: obrazy, **wideo**, mowa i tekst. Idealny do kamery i „co mam w ręku?" |
| **Model lokalny** (RTX 3080) | `nemotron-nano-9b-v2` | W 4-bit ~6 GB — mieści się w 10 GB z zapasem |
| Lokalny wzrok | `llama-3.1-nemotron-nano-vl-8b-v1` | 8B, zmieści się obok modelu tekstowego |

**⚠️ Uwaga na pułapkę:** `nemotron-3-nano-30b-a3b` reklamuje się jako „tylko 3 mld
aktywnych parametrów", ale architektura MoE oszczędza **obliczenia, nie pamięć** —
wszystkie 30 mld musi zmieścić się w karcie (~16–18 GB). **Na RTX 3080 nie wejdzie.**
Tak samo `super-120b` i `ultra-550b` — te tylko przez chmurę.

**⚠️ Druga pułapka:** na liście modeli zobaczysz `nemoguard`, `safety-guard`
i `topic-control`. To **klasyfikatory bezpieczeństwa** — odpowiadają słowem
„safe" w jedną dziesiątą sekundy, więc wyglądają na najszybsze modele w całej
stawce. Rozmowy z nimi nie da się przeprowadzić. Cosmos oznacza je w sprawdzeniu
modeli jako ⚙ **inne przeznaczenie**; nie ustawiaj ich jako modelu czatu.

**Po polsku:** im większy model, tym lepsza polszczyzna. Dlatego sensowny podział to
**chmura do pisania i rozumowania, model lokalny do rzeczy prywatnych i pracy bez
internetu** — czyli dokładnie ten hybrydowy układ, który daje Cosmos.

> 💡 **Nie przepisuj nazw ręcznie.** W aplikacji: **Ustawienia → „Pobierz listę"**
> pobiera prawdziwe identyfikatory prosto z endpointu i wypełnia listę wyboru.
> Nazwa w katalogu na build.nvidia.com bywa inna niż ciąg używany w API.
>
> Pod polem wyboru Cosmos pokazuje **opis wybranego modelu**: do czego się nadaje,
> czy widzi obrazy, czy potrafi rozumować, jaki ma kontekst i na co uważać. Rozpoznane
> modele są w liście na górze, z czytelną nazwą obok identyfikatora. Katalog opisów
> siedzi w `public/models.js` — możesz go rozszerzać o własne wpisy.

**Warto dołożyć później** (opcjonalnie): `llama-nemotron-embed-1b-v2` — embeddingi
w 26 językach, w tym polskim, do bazy wiedzy; `llama-nemotron-rerank-1b-v2` —
poprawia trafność wyszukiwania; `nemotron-ocr-v2` — OCR do skanów i PDF-ów.

### Czy muszę pobrać wszystkie modele?

Nie — i przy chmurze nie da się nawet tego zrobić. Trzy różne sytuacje, które
łatwo pomylić:

| Skąd model | Czy coś się pobiera | Co decyduje, czy zadziała |
|---|---|---|
| **Chmura NVIDIA** (zakładka „Chmura") | **Nic.** Model stoi na serwerach NVIDII, Cosmos tylko wysyła tam zapytanie | Czy Twój klucz ma do niego dostęp. „Pobierz listę" pokazuje wszystko, co NVIDIA hostuje, a nie to, co masz włączone |
| **OpenAI / Anthropic** (zakładki po dodaniu klucza) | Nic — tak samo zdalnie | Czy Twoje konto ma dostęp do tego identyfikatora |
| **Lokalny (RTX 3080)** | **Tak** — model musi być na dysku domowego komputera | `ollama pull <model>` i czy zmieści się w 10 GB VRAM |

Praktyczny wniosek:

1. **W chmurze niczego nie pobierasz.** Wystarczy wybrać model i pisać. Jeśli
   któryś odmawia („Function … Not found for account"), to nie usterka Cosmosa —
   ten model po prostu nie jest włączony na Twoim koncie NVIDII.
2. **Żeby nie zgadywać, które działają**, kliknij **Ustawienia → Sprawdź wszystkie
   z listy**. Cosmos przejdzie po całej liście najtańszymi możliwymi żądaniami
   (po jednym tokenie) i oznaczy każdą pozycję: `✗` niedostępny, `✓` rozmawia,
   `👁` rozmawia i czyta obrazy. To zajmuje chwilę i kosztuje tyle co nic.
3. **Lokalnie pobierasz tylko to, czego naprawdę używasz.** Lista lokalna pokazuje
   wyłącznie modele, które już masz — bo tak działa Ollama. Nowy dokładasz komendą
   w `cmd` **na komputerze z RTX**:
   ```
   ollama pull nemotron-nano-9b-v2
   ollama list
   ```
   Na RTX 3080 (10 GB) mieści się mniej więcej **jeden model 7–9B w 4-bit naraz**
   (~6 GB) — ewentualnie mały model wizyjny 8B obok. Pobieranie kilkunastu
   modeli „na zapas" zapcha dysk i nic nie da: i tak w danej chwili pracuje jeden.
4. **Rozsądny zestaw na start:** jeden model tekstowy w chmurze (do pisania
   i rozumowania), jeden wizyjny w chmurze (do zdjęć), jeden lokalny 9B
   (do rzeczy prywatnych i pracy bez internetu). Reszta na żądanie.

> 💡 Jeśli chcesz, żeby **zdjęcia** zawsze trafiały do modelu wizyjnego, a rozmowa
> zostawała przy Twoim ulubionym — ustaw `NEMOTRON_VISION_MODEL` (chmura) albo
> `LOCAL_VISION_MODEL` (lokalnie) w `.env`. Cosmos przekieruje wtedy same obrazy
> i uczciwie napisze pod odpowiedzią, który model ją napisał.

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

## Aktualizacja Cosmosa

> **Najpierw ustal, co gdzie stoi.** Cosmos to dwie niezależne części i aktualizuje
> się je osobno:
>
> | Zmiana w plikach | Gdzie zaktualizować | Co zrestartować |
> |---|---|---|
> | `server.js`, `public/*` (interfejs, czat, wyszukiwanie) | tam, gdzie działa serwer — VPS albo komputer domowy | serwer Cosmosa |
> | `senses/*` (zmysły, Kinect) | zawsze na komputerze z kamerą i GPU | `python service.py` |
> | `*.md` | nigdzie — to sama dokumentacja | nic |
>
> Przy Ścieżce B (serwer na VPS, zmysły na komputerze domowym) prawie każda
> aktualizacja wymaga **obu** kroków.

### Serwer na VPS (Linux)

```bash
cd /opt/cosmos
git pull
sudo systemctl restart cosmos
```

### Serwer albo zmysły na Windowsie

**Masz Gita:**
```
cd /d D:\Cosmos
git pull
```

> ⚠️ **„Your local changes to the following files would be overwritten by merge"**
> — Git odmawia, bo któryś plik w folderze różni się od wersji z repozytorium.
> Najczęstsza przyczyna: pobranie pojedynczego pliku przez `curl` (patrz niżej)
> zamiast aktualizacji Gitem. Jeśli **nie wprowadzałeś własnych zmian w kodzie**,
> wyrzuć lokalne wersje i pobierz czyste:
> ```
> git checkout -- senses/
> git pull
> ```
> Chcesz najpierw zobaczyć, co się różni? `git diff --stat`. A jeśli jednak coś
> swojego tam masz — `git stash`, potem `git pull`, potem `git stash pop`.

**Nie masz Gita** — dwie możliwości.

*Jednorazowo zainstaluj Gita* (potem wystarczy `git pull`): pobierz z
[git-scm.com/download/win](https://git-scm.com/download/win), zainstaluj z domyślnymi
opcjami i **otwórz `cmd` na nowo** — bez tego Windows nie zobaczy nowego polecenia.

*Albo pobierz same zmienione pliki* — `curl` jest w Windowsie od wersji 10, nic nie
trzeba instalować. Podmień `ADRES-REPO` na swój (`https://raw.githubusercontent.com/<użytkownik>/<repo>/<gałąź>`):
```
cd /d D:\Cosmos\senses
curl -L -o service.py ADRES-REPO/senses/service.py
```
> To rozwiązanie doraźne: pobrany plik przestaje zgadzać się z Gitem i **następny
> `git pull` odmówi działania** (patrz ostrzeżenie wyżej). Jeśli aktualizujesz
> częściej niż raz, zainstaluj Gita — wyjdzie taniej.

> ⚠️ **Po aktualizacji serwera odśwież stronę z pominięciem pamięci podręcznej**
> (`Ctrl+F5` na komputerze). W aplikacji PWA na telefonie zamknij ją całkowicie
> i otwórz ponownie — nowa wersja wchodzi dopiero wtedy.

### Co zrobić po aktualizacji

1. Sprawdź, czy serwer wstał: otwórz Cosmosa i zobacz wskaźniki w panelu bocznym.
2. Jeśli aktualizowałeś zmysły — okno z `python service.py` musi być uruchomione
   **na nowo**; stary proces działa dalej ze starym kodem.

## ⚠️ Kamera i mikrofon wymagają HTTPS

To zaskakuje każdego przy Ścieżce B, więc lepiej wiedzieć od razu.

Przeglądarki udostępniają kamerę i mikrofon **wyłącznie w „bezpiecznym kontekście"**:
po HTTPS albo na `localhost`. Wchodząc po zwykłym `http://100.x.x.x:3000` **nie masz
zablokowanego dostępu — po prostu tego API nie ma.** Nie działają wtedy:

| Funkcja | Przy `http://` na adres IP |
|---|---|
| Dyktowanie (ikona mikrofonu) | ❌ |
| Wybór mikrofonu w Ustawieniach | ❌ (lista pusta — przeglądarka nie widzi urządzeń) |
| Zdjęcie z kamery (ikona aparatu) | ❌ |
| Panel „Kamera na żywo" — kamera przeglądarki | ❌ |
| Tryb głosowy | ❌ |
| Nauka → „Pokaż" (uczenie z kamery) | ❌ |
| **Panel na żywo — źródło Kinect** | ✅ **działa** |
| **✦ Dopracowanie promptu** | ✅ **działa** (wpisany tekst, bez mikrofonu) |
| Czat, baza wiedzy, Studio, wszystko inne | ✅ |

**Kinect jest wyjątkiem**, bo jego klatki nie idą przez przeglądarkę, tylko przez usługę
zmysłów. Jeśli masz Kinecta, wybierz go w panelu jako źródło i podgląd zadziała mimo HTTP.

### Jak włączyć HTTPS w sieci Tailscale (najprościej)

Tailscale wystawia darmowy, prawdziwy certyfikat dla nazwy Twojej maszyny w tailnecie —
bez własnej domeny i bez otwierania portów:

```bash
sudo tailscale cert --help          # sprawdź nazwę swojej maszyny w tailnecie
sudo tailscale serve --bg 3000
```

`tailscale serve` postawi HTTPS przed Cosmosem. Adres zmieni się z
`http://100.x.x.x:3000` na `https://nazwa-maszyny.twoj-tailnet.ts.net` — i pod nim
kamera oraz mikrofon zaczną działać. W `.env` dodaj wtedy `COSMOS_COOKIE_SECURE=1`
i zrestartuj usługę.

> Po zmianie adresu **zainstaluj PWA na nowo** — stara wskazuje na poprzedni adres.

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
- **Plener** — wszystko, czym się kręci naprawdę, w jednym oknie: mój sprzęt (korpus,
  obiektywy, reszta), plan zdjęciowy liczony dla dowolnego MIEJSCA i dowolnej GODZINY
  (bez włączonej kamery), lista ujęć do nakręcenia dobrana do tematu i do sprzętu,
  aparat Canon po Wi-Fi (podgląd nastaw, „Ustaw w aparacie", zdalna migawka),
  misja waypointowa dla drona do pobrania jako `.kmz` i archiwum materiału
  (OneDrive: indeksowanie, obiektywy z EXIF-u, opisy obrazem, telemetria klipów).
  Studio generuje obraz — Plener pomaga go nakręcić.
- **Kamera na żywo** — panel z detekcją obiektów, przyciskiem powiększenia (podgląd na
  środku ekranu), przełącznikiem przód/tył na telefonie i wyborem źródła: kamera
  przeglądarki albo Kinect (obraz / głębia).
  Obok tryb głosowy uruchamiany przyciskiem fal dźwiękowych (rozmowa po polsku przy
  otwartej karcie; nasłuch słowa aktywującego w tle jest jeszcze niedokończony —
  patrz `senses/README.md`).
- **Tryb głosowy ma dwa silniki nasłuchu** (Ustawienia → „Nasłuch w trybie
  głosowym"). *Własny strumień + Whisper* otwiera mikrofon RAZ na całą rozmowę
  i sam wycina wypowiedzi z sygnału — znika sygnał podłączania sprzętu na
  Androidzie, słyszenie samego siebie i pętle. Wymaga zmysłów z Whisperem;
  bez nich Cosmos wraca do rozpoznawania przeglądarki i pisze o tym pod polem
  wyboru. W nakładce głosowej jest też przycisk 🐦: 8 s nagrania i gatunek
  ptaka z BirdNET-a, czytany na głos.
- **Dyktowanie i dopracowanie promptu** — mikrofon 🎤 zamienia mowę na tekst, a którym
  mikrofonem — wybierasz w Ustawieniach (macierz Kinecta, Galaxy Buds, telefon,
  laptop). Przycisk ✦ obok przepisuje podyktowaną wypowiedź na precyzyjny prompt:
  wycina wypełniacze i powtórzenia, a wymagania układa w listę. Drugie kliknięcie
  przywraca Twoją wersję, więc nic nie tracisz.
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
| „Nie udało się pobrać listy modeli … fetch failed" | Ten sam powód: Ollama nie odpowiada pod adresem z `LOCAL_BASE_URL`. Komunikat pod polem wypisuje teraz konkretne przyczyny i polecenie `curl` do sprawdzenia |
| W trybie głosowym na telefonie słychać ciągłe podłączanie sprzętu | Naprawione — Cosmos trzyma teraz mikrofon otwarty przez całą sesję zamiast przejmować go przy każdym pytaniu |
| „Pokaż ujęcia znad jeziora" nie znajduje żadnych KLIPÓW | Wideo nie ma metadanych — telemetria leży w pliku `.SRT` obok nagrania. Włącz napisy w DJI Fly przed lotem, wgraj oba pliki do OneDrive, a potem Plener → Archiwum materiału → „Wczytaj telemetrię klipów". Stare klipy nagrane bez napisów nie mają czego oddać |
| `node scripts/zorza.js` pokazuje „Wpisów prognozy: 0" | Skrypt mówi osobno o każdym źródle, a gdy któreś odpowie pustką — **sam pokazuje surową treść** (kod HTTP, typ, kształt, pierwsze wiersze), więc nie trzeba niczego dopytywać `curl`-em. `✗ SWPC 403/404` = NOAA nie przepuszcza żądań z tego serwera. `⚠ tablica, 0 pozycji` = produkt naprawdę pusty po stronie NOAA. `⚠ pozycje są, ale ich nie rozpoznaliśmy` albo `obiekt zamiast tablicy` = zmienił się kształt danych; wklej mi te wiersze. Samo Kp bieżące wystarcza do werdyktu „czy TERAZ", ale nie „czy dziś w nocy", i skrypt to wypisuje |
| Nie mogę znaleźć sprzętu ani archiwum w Ustawieniach | Przeniosły się do **Pleneru** (panel boczny, nad Nauką) razem z planem zdjęciowym, aparatem po Wi-Fi i misją drona. W Ustawieniach został przycisk „📷 Otwórz Plener" |
| Plan zdjęciowy pisze „Nie znam Twoich współrzędnych" | Nie musisz nic ustawiać na stałe: wpisz nazwę miejsca w polu **Miejsce** w Plenerze („Zakopane", „Kraków, Polska"). Zapisanie lokalizacji na stałe jest w Ustawieniach, przycisk „📍 Wykryj" |
| DJI Fly nie chce zaimportować pliku `.kmz` | Ten format nie przeszedł jeszcze przez prawdziwego drona — jest zbudowany według dokumentacji WPML i sprawdzony niezależnym parserem, ale to nie to samo. Najprościej pobrać `.kmz` **na telefonie**, w przeglądarce z Cosmosem — trafia do „Pobrane" i DJI Fly widzi go w imporcie misji. Z komputera przenieś plik kablem. **Pierwszy lot z importu rób nad pustym polem, z ręką na drążkach.** Jeśli aplikacja odrzuci plik, napisz mi, co dokładnie pokazała — poprawię strukturę |
| Cosmos nie widzi aparatu po Wi-Fi | Po kolei: firmware R6 II musi być 1.7.0+, CCAPI trzeba raz aktywować narzędziem Canona, a `CANON_CCAPI_URL` w `.env` musi wskazywać adres z menu aparatu razem z portem 8080. Aparat usypia Wi-Fi po kilku minutach — to nie awaria. I najważniejsze: Cosmos na VPS-ie nie dosięgnie aparatu w domu, bo to inna sieć |
| Cosmos w trybie głosowym słyszy sam siebie i odpowiada w kółko | Przełącz Ustawienia → „Nasłuch w trybie głosowym" na *Własny strumień + Whisper* (wymaga uruchomionych zmysłów). Wtedy mikrofon jest naprawdę wyciszany na czas mówienia, a nie tylko ignorowany |
| Tryb głosowy pokazuje „SŁUCHAM…", ale nic nie słyszy | Cosmos sam to wykrywa i próbuje odzyskać mikrofon. Trzy typowe przyczyny: wygaszony ekran (Android usypia dźwięk), rozmowa przychodząca albo inna aplikacja, która zabrała mikrofon, oraz odłączone słuchawki. Gdy odzyskanie się nie uda, napisze wprost, co zrobić |
| Whisper w trybie głosowym co chwilę zgłasza błąd | Po trzech nieudanych próbach z rzędu Cosmos sam wraca do rozpoznawania przeglądarki i pisze o tym. Zwykle znaczy to, że komputer domowy się wyłączył — po jego włączeniu przestaw z powrotem w Ustawieniach |
| Klip z R6 II nie chce się wczytać do rozmowy | To najpewniej H.265/HEVC — tak nagrywa R6 II w 4K, a Chrome na Windowsie dekoduje go tylko z rozszerzeniem „HEVC Video Extensions". Cosmos rozpoznaje ten przypadek i mówi o nim wprost. Alternatywa: wrzuć plik proxy w H.264 |
| W trybie głosowym włącza się kamera i zasłania ekran | Już się nie włącza sama. Podgląd włączasz ikoną kamery w prawym górnym rogu okna głosowego; wybór jest zapamiętywany |
| „Zmysły" na czerwono | Uruchom `python service.py` w folderze `senses`. Jeśli działa, a wskaźnik dalej czerwony i serwer stoi na VPS — brakuje `SENSES_URL`, patrz CZĘŚĆ 3, KROK 9 |
| `sudo`/`systemctl`: „Sudo is disabled on this machine" | Jesteś w oknie Windowsa, nie na VPS. Najpierw `ssh root@ADRES` — patrz tabelka znaków zachęty w CZĘŚCI 3 |
| „Brak dostępu do kamery: Cannot read properties of undefined" | Kamera i mikrofon działają tylko po HTTPS albo na `localhost`. Wejdź przez `https://` (patrz CZĘŚĆ 3) albo — mając Kinecta — wybierz go jako źródło obrazu |
| **Model odpowiada bardzo wolno** | Sprawdź, jaki model masz w **Ustawieniach → Model — chmura NVIDIA**. Ustawienie z przeglądarki jest ważniejsze niż `.env`, więc możesz mieć wybrany duży model, choć w `.env` stoi mały. Nemotron 3 Ultra 550B jest najwolniejszy z rodziny — do codziennych pytań weź Nano 9B albo Super. Puste pole = model z `.env` |
| Nad odpowiedzią widać „🧠 Myślę…" i długo nic więcej | Tak działa model rozumujący: najpierw myśli, potem pisze. Wcześniej ten czas wyglądał na zawieszenie, bo ekran był pusty. Kliknij blok, żeby zobaczyć tok myślenia |
| „(pusta odpowiedź modelu)" | Model rozumujący zużył cały budżet na myślenie i nie zdążył napisać odpowiedzi. Zwiększ **Maks. tokenów odpowiedzi** (np. na 4096) albo wybierz szybszy model. Cosmos pokaże wtedy przynajmniej tok myślenia zamiast pustki |
| Model szuka w internecie w kółko i nic nie znajduje | Serwer pobiera teraz treść dwóch pierwszych stron z wyników, nie same linki, a po wyczerpaniu limitu rund każe modelowi odpowiedzieć tym, co ma. Jeśli wciąż się to zdarza, strona źródłowa najpewniej ładuje dane skryptem — poproś o konkretne źródło |
| „Model oddał odpowiedź, której nie da się odczytać (HTTP 404). Początek: 404 page not found" | Ten identyfikator modelu nie istnieje pod danym adresem. Komunikat podaje w nawiasie kwadratowym, który silnik i jaki model poleciał. Najczęściej to **nieaktualny wpis `NEMOTRON_MODEL` w `.env`** — NVIDIA zmienia identyfikatory (np. `nvidia/nemotron-nano-9b-v2` → `nvidia/nvidia-nemotron-nano-9b-v2`). Sprawdź aktualną nazwę przez **Ustawienia → Pobierz listę** i popraw `.env` na serwerze |
| „Unexpected non-whitespace character after JSON" / „is not valid JSON" | Dostawca modelu oddał coś, co nie jest zwykłym JSON-em — najczęściej strumień zdarzeń mimo prośby o całość, albo stronę błędu od proxy. Cosmos radzi sobie teraz z jednym i drugim, a gdy naprawdę nie da się odczytać, pokazuje początek odpowiedzi zamiast komunikatu o JSON-ie |
| Model odpowiada „nie mam dostępu do żadnego zdjęcia", choć zdjęcie wysłałeś | Ten model nie odczytuje obrazów — Cosmos wysyłał je mimo to. Ustaw `NEMOTRON_VISION_MODEL` (dla chmury) albo `LOCAL_VISION_MODEL` w `.env`: Cosmos będzie wtedy sam kierował same zdjęcia do modelu wizyjnego, a rozmowę zostawi wybranemu. Pod odpowiedzią zobaczysz, który model odpowiedział |
| „Model … nie odczytuje obrazów, a … nie ustawiono modelu wizyjnego" | Dokładnie to samo, tylko Cosmos zatrzymuje teraz żądanie zamiast wysyłać je na darmo. Albo wybierz model oznaczony „widzi obrazy", albo ustaw wizyjny w `.env` |
| „Function … Not found for account …" | Model jest w katalogu NVIDII, ale nie na Twoim koncie. „Pobierz listę" pokazuje wszystko, co NVIDIA wystawia — nie wszystko musi być dla Ciebie włączone. Kliknij **Ustawienia → Sprawdź wszystkie z listy**: Cosmos przejdzie po całej liście i oznaczy `✗` te, których nie masz, `✓` te, które rozmawiają, i `👁` te, które czytają też obrazy. Wtedy wybierasz świadomie, a nie na chybił trafił |
| Nie wiem, który model wybrać — połowa nie działa | **Ustawienia → Sprawdź wszystkie z listy**. Jedno sprawdzenie to jeden token, więc to praktycznie darmowe. Znaczki zostają przy pozycjach do końca sesji |
| Chcę zapisać albo komuś wysłać wynik sprawdzenia | Po przejściu listy pojawia się **📋 Kopiuj wynik** — cały raport ląduje w schowku. Bez przeglądarki: na serwerze `cd /opt/cosmos && ./scripts/sprawdz-modele.sh cloud > wynik.txt` |
| Przy modelu jest `⏳` zamiast `✓` albo `✗` | Model nie odpowiedział na czas mimo ponownej próby — u dostawcy wstaje z zimnego startu. To nie znaczy, że nie działa. Sprawdź go pojedynczo przyciskiem **Sprawdź** obok pola modelu; drugie podejście zwykle wchodzi |
| Przy modelu jest `⚙` | Ten model nie służy do rozmowy — to embeddingi, przeszukiwanie albo OCR. Odpowiada „404", bo nie ma końcówki czatu, a nie dlatego, że nie masz dostępu. Część z nich Cosmos wykorzystuje sam (baza wiedzy) |
| Pola w Ustawieniach są rozjechane, strzałki list tuż przy krawędzi | Naprawione. Lista mikrofonów potrafiła wystawać kilkaset pikseli poza okno (długie nazwy urządzeń Bluetooth), wybieraki dostały własną strzałkę z odstępem od obrysu, a pole godziny przestało być białe w ciemnym motywie |
| Model lokalny: „404" albo „model not found" | Tego modelu nie ma jeszcze na dysku domowego komputera. Komunikat podaje gotową komendę — uruchom ją w cmd **na komputerze z RTX**, np. `ollama pull qwen2.5:7b`. Na RTX 3080 (10 GB) zmieści się mniej więcej jeden model 7–9B w kwantyzacji 4-bit naraz |
| Zdjęcie zrobione w Cosmosie nie pojawia się w Galerii | Naprawione — zdjęcie z przycisku aparatu trafia teraz i do wiadomości, i do bazy wiedzy, więc widać je w Galerii i da się pobrać |
| „Nie udało się przełączyć kamery: Could not start video source" | Naprawione. Telefon obsługuje jeden obiektyw naraz, a Cosmos otwierał nowy przed zwolnieniem starego. Teraz najpierw zwalnia, a gdy nowy zawiedzie — wraca do poprzedniego |
| W trybie głosowym mikrofon podłącza się i odłącza w kółko, a Cosmos nic nie słyszy | Naprawione, i była to moja wcześniejsza poprawka: trzymałem otwarty strumień z mikrofonu, żeby wyciszyć sygnały Androida, a to odbierało mikrofon rozpoznawaniu mowy. Teraz rozpoznawacz jest jeden na całą sesję i to on ma mikrofon |
| Kliknięcie w grafikę w rozmowie nic nie robi | Naprawione — obraz otwiera się na pełnym ekranie, z przyciskiem pobierania. Zamykasz Escape'em, krzyżykiem albo kliknięciem w tło |
| „Użyj jako pierwsza klatka wideo" nie zapisuje się | Naprawione. Wybór przepadał po pierwszym otwarciu Studia; teraz jest trwały, a wybrany obraz ma w Galerii podświetlony przycisk 🎬 |
| „Upscale niedostępny — pip install realesrgan basicsr" | To nie błąd, tylko brakujący dodatek. Zainstaluj go **na komputerze ze zmysłami**: `pip install realesrgan basicsr` w folderze `senses` z aktywnym `(.venv)`, potem uruchom `service.py` na nowo |
| Linki ze źródeł prowadzą do „Oops, there was an error" na duckduckgo.com | To były reklamy wyszukiwarki, nie prawdziwe wyniki. Po aktualizacji Cosmos je odrzuca i nie podaje jako źródeł |
| Dyktowanie urywa się w połowie zdania | Naprawione. Chrome kończył sesję rozpoznawania po pauzie w mówieniu, a Cosmos to akceptował. Teraz nasłuch wznawia się sam, aż klikniesz mikrofon ponownie |
| „Rozpoznawanie mowy nie powiodło się: Unexpected token 'I'…" | Usługa zmysłów zwróciła błąd zwykłym tekstem. Sprawdź okno z `python service.py` — tam jest prawdziwa przyczyna. Po aktualizacji Cosmos pokazuje ją wprost zamiast komunikatu o JSON-ie |
| Dyktowanie nie działa, w oknie zmysłów `Library cublas64_12.dll is not found` | Whisper próbował liczyć na karcie graficznej bez bibliotek CUDA. Po aktualizacji sam przechodzi na procesor (wolniej, ale działa). Chcesz GPU? Doinstaluj cuBLAS i cuDNN dla CUDA 12 albo ustaw `WHISPER_DEVICE=cpu` w `.env`, żeby nie próbował |
| Czytanie na głos urywa się w połowie | Naprawione. Chrome przerywa mowę po kilkunastu sekundach — Cosmos czyta teraz zdaniami, jedno po drugim |
| W oknie zmysłów `wave.Error: # channels not specified` przy czytaniu | Nowy Piper zmienił API i stary sposób zapisu dawał pusty plik. Zaktualizuj zmysły |
| Streszczenie rozmowy nic nie zwraca | Naprawione — było tą samą przyczyną co puste odpowiedzi. Zaktualizuj Cosmosa (`git pull` + restart) |
| Lista mikrofonów w Ustawieniach jest pusta | To samo ograniczenie co przy kamerze: przeglądarka pokazuje urządzenia dopiero po HTTPS albo na `localhost`. Po wejściu przez `https://` kliknij „Odśwież" obok listy |
| Mikrofon z listy przestał działać (odłączone słuchawki) | Cosmos sam wróci do domyślnego mikrofonu przy pierwszym nagraniu. Żeby wybrać nowy — Ustawienia → „Odśwież" |
| ✦ „Dopracuj prompt": „Brak klucza API dla chmury NVIDIA" | Przepisywanie idzie przez ten sam model co czat. Uzupełnij `NVIDIA_API_KEY` albo przełącz się na „Lokalnie" (Ollama musi działać) |
| Podgląd z Kinecta zatrzymuje się po chwili | Sprawdź okno z `python service.py` — przy zerwanym strumieniu Cosmos przechodzi na pojedyncze klatki, więc obraz zwalnia zamiast zniknąć |
| „Brak numpy" / „Brak zależności", choć instalowałeś | Nie aktywowałeś środowiska. Znak zachęty musi zaczynać się od `(.venv)` — wpisz `.venv\Scripts\activate` w folderze `senses` |
| Błąd 404 przy czacie | Zły identyfikator modelu — **Ustawienia → Pobierz listę** |
| Model wideo/obraz zwraca błąd | Sprawdź, czy klucz w `.env` jest poprawny i ma środki |
| Chcę zacząć od zera | Zatrzymaj serwer, usuń folder `data`, uruchom ponownie |

Nadal problem? Otwórz `README.md` w głównym folderze — jest tam pełna dokumentacja
techniczna każdego elementu.

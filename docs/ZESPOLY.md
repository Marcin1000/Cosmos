# Zespoły agentów — agencja i zespół IT

Cosmos jest przeglądany i poprawiany przez dwa zespoły agentów Claude Code. Ich role są
zdefiniowane w `.claude/agents/` (każdy plik to jedna rola), a ten dokument jest ich
wspólnym protokołem: jak pracują, jak się ze sobą porozumiewają i jak **przeżywają limit
sesji**, który potrafi przerwać pracę w pół zdania.

| Zespół | Role (`.claude/agents/`) | Do czego |
|---|---|---|
| **Agencja** | `agencja-ux`, `agencja-frontend`, `agencja-backend`, `agencja-rozmowa`, `agencja-strona-projekt`, `agencja-strona-frontend`, `agencja-copywriter`, `agencja-wykonawca` | wygląd i działanie aplikacji w kierunku „Jeden wątek", strona produktowa, teksty, płynność rozmowy |
| **Zespół IT** | `it-infra`, `it-konta`, `it-modele-komercyjne`, `it-modele-open`, `it-plynnosc`, `it-backend` | całość w produkcji: Cloudflare, serwer, konta i dostęp publiczny, modele komercyjne i open source, płynność, obciążenie |

Role przeglądowe **nie zmieniają repozytorium** — opisują poprawki. Wdraża koordynator
(główna sesja) albo `agencja-wykonawca` z jawnie przydzielonymi plikami.

## Katalog roboczy i tablica

Koordynator zakłada katalog zespołu (domyślnie `/tmp/cosmos-zespoly/<zespół>/`, w sesji
w chmurze — w scratchpadzie) i podaje go każdej roli w pierwszej wiadomości jako `AG`.

- `AG/tablica.md` — wspólna tablica. Tylko dopisujemy (`cat >> … <<'EOF'`), nigdy nie
  nadpisujemy. Wpis: `## [ROLA → ROLA|WSZYSCY] [krytyczny/wysoki/średni/niski] tytuł` +
  dowód (skrypt, plik:linia, wynik) + propozycja. Odpowiedź: `## [ADRESAT → NADAWCA] PRZYJĘTE: …`.
  Pytanie: `## [ROLA → ROLA] PYTANIE: …`.
- `AG/<rola>/` — skrypty, atrapy, notatki roli.
- `AG/<rola>/DZIENNIK.md` — stan pracy roli (patrz niżej).
- `AG/ZESPOL.md` — rejestr koordynatora: rola, identyfikator agenta, stan.
- `AG/zrzuty/` — wspólne zrzuty ekranu (`rola-widok-motyw-szerokość.png`).

Współpraca: tablicę czytasz na starcie i co ~15 minut; sprawa z cudzego obszaru to wpis
„→ ROLA", a nie diagnoza w cudzym kodzie; przed wpisem sprawdzasz, czy go już nie ma;
atrapy i skrypty pożyczasz od innych ról zamiast pisać własne.

## Przetrwanie limitu (obowiązkowe)

Limit sesji przerywa agenta bez ostrzeżenia. Praca ma to przeżyć:

1. **Dziennik po każdym kroku.** `AG/<rola>/DZIENNIK.md` nadpisujesz w całości po każdym
   zakończonym sprawdzeniu (co ~5–10 wywołań narzędzi). Sekcje:
   - `STAN:` pracuje / SKOŃCZONE,
   - `ZROBIONE:` co sprawdzone, z wynikiem jednym zdaniem,
   - `USTALENIA:` priorytet, dowód (ścieżka skryptu), propozycja poprawki — zalążek raportu,
   - `DALEJ:` kolejne kroki w kolejności; pierwszy = od czego zaczniesz po wznowieniu,
   - `PROCESY:` PID, port i polecenie startu wszystkiego, co masz uruchomione.
2. **Ustalenia na tablicę od razu**, nie na końcu. Raport, którego nikt nie zdążył napisać,
   nie istnieje.
3. **Po wznowieniu** czytasz swój dziennik i tablicę, sprawdzasz procesy (`kill -0 PID`),
   stawiasz brakujące i kontynuujesz od `DALEJ`. Nie powtarzasz `ZROBIONE`.
4. **Oszczędzasz limit**: najpierw sprawdzenia o najwyższym ryzyku; krótkie wyjścia
   (`| head -40`, `grep`, `tail -20`); pliki fragmentami; bez wypisywania całych logów i JSON-ów.
5. **Koniec**: `STAN: SKOŃCZONE` w dzienniku i raport końcowy jako ostatnia wiadomość.

### Po stronie koordynatora

- Każdą rolę powołuje z jej plikiem z `.claude/agents/`, katalogiem `AG` i portami; zapisuje
  identyfikator w `AG/ZESPOL.md`.
- **Strażnik**: przed wypuszczeniem zespołu zakłada zadanie cykliczne (co godzinę) budzące
  sesję koordynatora. Strażnik czyta rejestr i wznawia role, które padły na limicie —
  `SendMessage` na identyfikator agenta („Limit się odnowił — kontynuuj od DALEJ w swoim
  DZIENNIK.md"). Wznowiony agent wraca z pełną pamięcią. Gdy wznowienie się nie uda, nowy
  agent tej roli zaczyna od dziennika. Gdy limit trafi też koordynatora, pierwsze wywołanie
  strażnika po odnowieniu robi to samo.
- Gdy wszystkie role skończą: scalenie tablicy i raportów w jedną listę, wdrożenie, pełna
  bateria testów, master tylko po zielonej baterii, raport dla Marcina — i usunięcie strażnika.
- Dwa zespoły naraz zużywają limit dwa razy szybciej; lepiej jeden po drugim.

## Twarde zasady dla ról przeglądowych

- Nie zmieniasz plików w repozytorium (żadnych edycji, commitów, `git checkout`/`stash`).
- Nie uruchamiasz `npm test` ani zestawów z `tests/zestawy/` — zwalniają porty wspólnych
  atrap i wywracają pracę innych. Własne skrypty Playwright — tak.
- Zabijasz tylko własne procesy (`kill <pid>`); nigdy `pkill -f` ani `fuser -k` (`pkill -f`
  z wzorcem pasującym do polecenia zabija własną powłokę).
- Wspólne atrapy stawia koordynator i ich nie zabijasz: `tests/atrapy/mock-upstream.js`
  (9099 chmura / 9098 lokalny), `fake_senses.py` (7060), `mock-search.js` (9097),
  `mock-grafiki.js` (7117). Własne atrapy — tylko na portach swojej roli.
- Playwright: `NODE_PATH=/opt/node22/lib/node_modules`, Chromium z `/opt/pw-browsers/chromium`,
  `waitUntil: 'load'` (nigdy `networkidle`), `serviceWorkers: 'block'` przy świeżym kodzie.
- Szczegóły zewnętrznych API (OpenAI, Anthropic, NVIDIA, Ollama, vLLM, Cloudflare) oznaczasz:
  pewne (dokumentacja, kod) czy z pamięci.
- Wszystko po polsku.

## Serwer do sprawdzania

```bash
cd /home/user/Bear && mkdir -p $AG/<rola>/dane && \
COSMOS_DATA_DIR=$AG/<rola>/dane PORT=<PORT> LOCAL_API_KEY=test NVIDIA_API_KEY=test \
NEMOTRON_BASE_URL=http://127.0.0.1:9099/v1 LOCAL_BASE_URL=http://127.0.0.1:9098/v1 \
NEMOTRON_VISION_MODEL=cloud/nemotron-vl-test LOCAL_MODEL=local/nemotron-3-test \
SENSES_URL=http://127.0.0.1:7060 SEARCH_URL=http://127.0.0.1:9097/ \
IMAGE_SEARCH_URL=http://127.0.0.1:7117/ COMMONS_API_URL=http://127.0.0.1:7117/commons \
OPENVERSE_API_URL=http://127.0.0.1:7117/openverse GEOCODE_SEARCH_URL=http://127.0.0.1:7117/geokoduj \
SEARXNG_URL=http://127.0.0.1:7117/searxng POBIERANIE_ZAUFANE=127.0.0.1,localhost \
nohup node server.js > $AG/<rola>/serwer.log 2>&1 & echo $!
```

Tryb z kontami (jak produkcja): dodaj `COSMOS_PASSWORD=… COSMOS_LOGIN=wlasciciel`
i — za proxy HTTPS — `COSMOS_COOKIE_SECURE=1`. Aplikacja: `http://127.0.0.1:<PORT>/app`,
strona produktowa: `http://127.0.0.1:<PORT>/`.

## Porty

| Rola | Serwery | Własne atrapy |
|---|---|---|
| agencja-ux / frontend / backend / rozmowa | 3611 / 3612 / 3613 / 3614 (+10, +20 na warianty) | backend 7650–7659, rozmowa 7660–7669 |
| agencja-strona-projekt / strona-frontend | 3621 / 3622 (+10) | — |
| agencja-copywriter / wykonawca | 3623 / 3721–3722 | — |
| it-infra / konta / modele-komercyjne / modele-open / plynnosc / backend | 3811 / 3812 / 3813 / 3814 / 3815 / 3816 (+10, +20) | 7810–7819 / 7820–7829 / 7830–7839 / 7840–7849 / 7850–7859 / 7860–7869 |

## Raport końcowy (ostatnia wiadomość roli)

Ustalenia wg priorytetu: `[priorytet] tytuł — dowód — konkretna poprawka (zarys kodu,
plik:linia)`. Osobno **POTWIERDZONE** (odtworzone) i **PODEJRZENIA**. Na końcu krótko:
co sprawdzone i działa. Przed końcem zabijasz swoje procesy.

## Kontekst produkcji (dla obu zespołów)

VPS z Debianem, `/opt/cosmos`, systemd `cosmos.service` (port 3000 na 127.0.0.1),
Cloudflare Tunnel → `cosmosai.live` (`/` strona produktowa, `/app` aplikacja). Właściciel
i zaproszone osoby logują się przez stronę. Silniki: chmura NVIDIA (Nemotron), lokalny GPU
w domu przez Tailscale (Ollama/vLLM), OpenAI, Claude (warstwa zgodna z OpenAI), zmysły
(Python) w domu. Aktualizacja: `cd /opt/cosmos && git pull && sudo systemctl restart cosmos`.

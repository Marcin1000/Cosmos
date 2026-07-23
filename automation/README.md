# 🌐 Cosmos — automatyzacja web (TYLKO DO ODCZYTU)

Ten opcjonalny moduł pozwala Cosmosowi **wykonać sam** nauczoną procedurę
w prawdziwej przeglądarce (Playwright) — ale **wyłącznie** kroki, które nic nie
zmieniają: `open` (otwórz stronę), `wait` (poczekaj), `read` (odczytaj element),
`click` (nawigacja). Świetne do: sprawdzania cen, sald na publicznych stronach,
statusów, dostępności, godzin — czyli „sprawdź coś" bez ryzyka.

## Twarda bramka bezpieczeństwa

Moduł **odmawia** wykonania, jeśli procedura zawiera choć jeden krok:
- oznaczony jako **wrażliwy** (płatność, wysłanie, potwierdzenie), albo
- zmieniający stan: `type` (wpisywanie), `confirm`.

W takim wypadku Cosmos każe użyć **ręcznego runnera z potwierdzeniem** (w panelu
„Nauka"). Hasła i dane karty nigdy nie są zapisywane w procedurze, więc ten moduł
z założenia obsługuje strony **bez logowania danymi wrażliwymi**.

## Instalacja

Rdzeń Cosmosa działa bez tego modułu. Aby go włączyć:

```bash
npm install playwright        # w katalogu głównym projektu
npx playwright install chromium   # pobiera przeglądarkę (jednorazowo)
```

Po instalacji w panelu **Nauka → Procedury** pojawi się przycisk
**„⚡ Uruchom auto (tylko odczyt)"** dla procedur, które się kwalifikują,
a przy rutynach — opcja **„Tryb auto"**.

> Jeśli używasz przeglądarki z niestandardowej lokalizacji, ustaw
> `PLAYWRIGHT_EXECUTABLE_PATH` w `.env` na ścieżkę do pliku wykonywalnego Chromium.

## Jak to działa

- Serwer sprawdza kwalifikowalność procedury (`/api/automation/status`,
  `/api/procedures/run-readonly`) i **dopiero wtedy** uruchamia `runner.js`
  jako osobny proces, przekazując kroki przez stdin.
- `runner.js` otwiera Chromium, wykonuje kroki tylko-do-odczytu i zwraca wynik
  (odczytane wartości) w formacie JSON.
- Wynik trafia do Cosmosa jako zdarzenie percepcji, więc możesz o nim rozmawiać
  (np. *„ile mam do zapłaty według ostatniego sprawdzenia?"*).

## Logowanie z menedżera haseł

Aby auto‑odczyt działał też **za logowaniem** (np. panel klienta), procedura może
mieć kroki **„logowanie"** (`auth`): wpisanie loginu i hasła oraz klik „Zaloguj".
Zasady:

- Zaznacz w kroku `type`/`click` opcję **„logowanie (menedżer haseł)"**.
- W polu wartości hasła wpisz **odwołanie**, nie samo hasło: `{{secret:bank_pw}}`.
  Login (nie‑tajny) możesz wpisać wprost.
- Hasła **nigdy** nie ma w procedurze. Serwer pobiera je z menedżera **w chwili
  uruchomienia** i podaje runnerowi przez potok (stdin) — nie przez dysk, nie
  przez argumenty procesu, nie do przeglądarki‑klienta. Wartości nie są logowane.
- Logowanie jest dozwolone w trybie auto, ale **każdy** krok wrażliwy lub
  zmieniający stan poza logowaniem (płatność, wysłanie, potwierdzenie) nadal
  wraca do ręcznego runnera z bramką.

Skonfiguruj menedżer w `.env` (`SECRETS_PROVIDER` + ewentualne pola):
Bitwarden (`bw`), 1Password (`op`), `pass`, KeePassXC (`keepassxc-cli`), zmienne
środowiskowe (`env`) albo własne polecenie (`command`). Szczegóły i przykłady —
w `.env.example`.

> **Nienadzorowane rutyny + logowanie:** vault musi być odblokowany w momencie
> uruchomienia (np. `BW_SESSION` w środowisku serwera). Dla rutyn cyklicznych na
> VPS rozważ dedykowany, ograniczony dostęp tylko do potrzebnych pozycji.

## Rutyny w trybie auto

Rutyna z włączonym **trybem auto** i procedurą tylko-do-odczytu wykona się sama
o wyznaczonej porze (przeglądarka w tle), a wynik dostaniesz jako powiadomienie —
bez pytania. Procedury z krokami wrażliwymi **zawsze** wracają do trybu
„przygotuj i potwierdź", niezależnie od ustawień rutyny.

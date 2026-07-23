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

## Rutyny w trybie auto

Rutyna z włączonym **trybem auto** i procedurą tylko-do-odczytu wykona się sama
o wyznaczonej porze (przeglądarka w tle), a wynik dostaniesz jako powiadomienie —
bez pytania. Procedury z krokami wrażliwymi **zawsze** wracają do trybu
„przygotuj i potwierdź", niezależnie od ustawień rutyny.

# Testy Cosmosa

```bash
npm test                    # wszystko (71 zestawów + 9 selftestów Pythona, ~12 min)
npm run test:szybkie        # tylko bez przeglądarki (~30 s)
npm test -- kinect zdjec    # zestawy, których nazwa zawiera te słowa
npm test -- --lista         # co jest do uruchomienia
```

Kod wyjścia `0` znaczy „wszystko zdane”. Po nieudanym zestawie uruchamiacz
drukuje ostatnie kilkanaście linii jego wyjścia.

## Dlaczego każdy zestaw ma własny serwer

Przez długi czas testy dzieliły jeden serwer na porcie 3000 i połowa „awarii”
brała się z tego, że akurat wstał z inną konfiguracją niż potrzebna. To nie jest
teoria — tak padały:

| Zestaw | Czego wymaga | Co się działo bez tego |
|---|---|---|
| `ostrzezenie-o-obrazach` | **braku** `NEMOTRON_VISION_MODEL` | Cosmos poprawnie przekierowywał zdjęcie i ostrzeżenie się nie pojawiało |
| `zakladki-silnikow` | czterech kluczy API | widać było 2 zakładki zamiast 4 |
| `przeglad-ogolny` | atrapy oddającej bloki kodu | czekał w nieskończoność na `.code-block` |
| `panel-boczny` | istniejących rozmów | pusta lista nie ma czego przewijać |

Bateria, która przy każdym przebiegu podaje fałszywe alarmy, przestaje cokolwiek
znaczyć. Dlatego wiedza o wymaganiach siedzi teraz w **jednym** miejscu —
w tabeli `SRODOWISKA` w `pomoc.js`.

## Jak napisać nowy zestaw

```js
const { srodowisko, przegladarka } = require('../pomoc');

(async () => {
  const env = await srodowisko('pelne');   // stawia serwer i atrapy
  const b = await przegladarka();
  const p = await b.newPage();
  await p.goto(env.adres);

  // …mierz…

  await b.close();
  env.koniec();
  process.exit(ok ? 0 : 1);
})();
```

Dostępne środowiska (`pomoc.js` → `SRODOWISKA`):

| Nazwa | Co daje |
|---|---|
| `pelne` | dwa silniki, model wizyjny, zmysły, 12 zasianych rozmów |
| `bezWzroku` | to samo, ale bez modelu wizyjnego |
| `czterySilniki` | NVIDIA + lokalny + OpenAI + Anthropic |
| `rozumujacy` | strumień z `reasoning_content`, pętla wyszukiwania |
| `katalogModeli` | lista modeli, z których większość konto odrzuca |
| `tempo` | modele o różnej płynności, w tym jeden kapryśny i jeden rozumujący |
| `kontekst` | atrapa oddaje wiadomości systemowe jako treść — widać, co model dostaje |
| `grafiki` | wyszukiwanie grafik, geokodowanie, SWPC (zorza) |
| `aparat` | Canon po CCAPI + geokodowanie — droga „policz plan → wyślij do aparatu” |
| `zmysly` | Kinect, mowa, wykrywanie — bez modelu |
| `tlo` | praca w tle — jak `pelne`, ale z krótkim `COSMOS_BIEG_SIEROTA_MS` |
| `goly` | sam serwer, żadnych atrap |

### Umowy z atrapą `mock-upstream`

Słowo w pytaniu zmienia zachowanie atrapy — to jedyny sposób, żeby zestaw
ustawił sytuację, której inaczej nie da się wywołać:

| Słowo w pytaniu | Co robi atrapa |
|---|---|
| `powoli` | rozciąga strumień na kilkanaście sekund — bez tego nie istnieje „w trakcie odpowiedzi” i nie ma czego kolejkować |
| `jaki to telefon` | oddaje `[SZUKAJ: …]` — uruchamia pętlę wyszukiwania |
| `wygeneruj grafikę` | oddaje `[OBRAZ: …]` |
| `zapamiętaj` | oddaje `[AKCJA: zapamiętaj \| …]` |

Zestaw, który potrzebuje czegoś innego, stawia serwer sam (`serwerCosmosa`) —
tak robią `sprawdzanie-modeli` i `redakcja-danych`.

## Katalog danych

Każdy serwer testowy dostaje świeży `COSMOS_DATA_DIR` w katalogu tymczasowym.
Bez tego każdy przebieg dopisywał rozmowy do prawdziwych danych i liczniki
rosły z przebiegu na przebieg (doszliśmy do 55).

## Zrzuty ekranu

Lądują w `tests/zrzuty/` (poza repozytorium). Przydają się, gdy zestaw układu
padnie i trzeba zobaczyć, co właściwie się rozjechało.

## Przeglądarka

Zestawy oznaczone 🌐 wymagają `playwright` i Chromium. Gdy ich nie ma,
uruchamiacz je pomija z ostrzeżeniem zamiast udawać awarię. Ścieżkę do binarki
można wskazać przez `COSMOS_CHROMIUM`.

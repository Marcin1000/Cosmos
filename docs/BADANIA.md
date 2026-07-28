# 🔬 Cosmos — protokoły badawcze

Sześć eksperymentów z **mierzalnym wynikiem**. Każdy ma gotowe narzędzie w repo,
jasny protokół i kryterium sukcesu. To nie są zabawy — to sposób, żeby wiedzieć,
a nie zgadywać.

> Zasada wspólna: **zapisz wynik**. Wrzuć raport do bazy wiedzy Cosmosa —
> za rok będziesz wiedział, dlaczego robisz coś tak, a nie inaczej.

---

## 1. Czy mapa nasłonecznienia mówi prawdę?

**Pytanie:** czy model zacienienia zgadza się z rzeczywistością, a ile dokłada
światło rozproszone z nieba?

**Potrzebujesz:** telefonu z czujnikiem światła (dowolna aplikacja „luksomierz"),
modelu 3D działki, jednego pogodnego dnia.

**Protokół:**
1. Zbuduj model: `python senses/photoscan.py <zdjęcia> --dense`
2. Wybierz 5 punktów: 2 zawsze słoneczne, 2 zacienione, 1 graniczny.
   Zapisz ich pozycję w siatce (wiersz, kolumna — z mapy PNG).
3. Co 2 godziny (8:00–16:00) zmierz lux w każdym punkcie. To 25 pomiarów.
4. Zapisz CSV: `czas,wiersz,kolumna,lux`
5. Uruchom:
   ```bash
   python senses/terrain.py validate model.ply pomiary.csv \
       --lat TWOJA --lon TWOJA --date RRRR-MM-DD
   ```

**Wynik:** procent zgodności + oszacowanie światła rozproszonego.
**Kryterium sukcesu:** zgodność ≥ 85%. Poniżej — sprawdź orientację modelu
(`--north`) i skalę.

**Co z tym zrobisz:** jeśli w cieniu jest np. 9000 lx, to grządka „bez słońca"
wcale nie jest ciemna. Do planowania ogrodu i paneli to realna różnica.

---

## 2. Ile zdjęć naprawdę potrzeba do fotogrametrii?

**Pytanie:** kiedy przestać latać? Każde dodatkowe zdjęcie kosztuje baterię
i godziny rekonstrukcji.

**Potrzebujesz:** obiektu o znanym wymiarze (zmierz taśmą!), drona, cierpliwości.

**Protokół:**
1. Zaplanuj lot: `python senses/flightplan.py matrix --width 60 --length 60`
2. Zrób jeden przelot z **dużym zapasem** (np. 200 zdjęć, pokrycie 85%).
3. Zbuduj modele z podzbiorów: 30, 50, 80, 120, 200 zdjęć
   (kopiuj co n-te zdjęcie do osobnych folderów).
4. Dla każdego modelu zmierz ten sam wymiar:
   `python senses/terrain.py volume model.ply` albo odczyt z chmury punktów.
5. Wykres: błąd (cm) w funkcji liczby zdjęć.

**Wynik:** własna krzywa jakości.
**Kryterium sukcesu:** znajdujesz „kolano" — punkt, po którym błąd przestaje
maleć. To Twoja optymalna liczba zdjęć.

---

## 3. Granica widzenia w ciemności

**Pytanie:** przy jakim świetle każda z Twoich kamer przestaje być użyteczna
dla detekcji obiektów?

**Potrzebujesz:** webcama, R6 II, Kinecta (IR), luksomierza, ściemnianej sceny.

**Protokół:**
1. Ustaw scenę z kilkoma obiektami (osoba, krzesło, kubek) i **nie ruszaj jej**.
2. Zmniejszaj światło stopniowo: 500, 200, 100, 50, 20, 10, 5, 2 lx.
   Przy każdym poziomie: zmierz lux i zrób zdjęcie **każdą** kamerą.
3. Nazwij pliki z natężeniem, np. `webcam_50lx.jpg`, `r6_50lx.jpg`.
4. Dla każdej kamery osobno:
   ```bash
   python senses/lowlight.py measure folder-webcam
   python senses/lowlight.py measure folder-r6
   ```

**Wynik:** dla każdej kamery — granica lx, poniżej której detekcja spada
poniżej połowy skuteczności, plus krzywa SNR.
**Kryterium sukcesu:** trzy różne progi — i wiesz, którego czujnika użyć o zmierzchu.

> Metodę możesz sprawdzić bez sprzętu: `python senses/lowlight.py synth`
> generuje serię testową z realnym szumem fotonowym.

---

## 4. Słuch przestrzenny z macierzy Kinecta

**Pytanie:** z jaką dokładnością da się wskazać kierunek dźwięku i jak ta
dokładność zależy od kąta oraz odległości?

**Potrzebujesz:** Kinecta 360 (4 mikrofony), źródła dźwięku (klaśnięcie, głośnik),
taśmy mierniczej i kątomierza.

**Protokół:**
1. Sprawdź samą metodę: `python senses/soundloc.py --selftest`
   (na syntetycznych opóźnieniach błąd powinien być poniżej 1°).
2. Ustaw Kinecta na statywie. Wyznacz na podłodze kąty −60°, −30°, 0°, +30°, +60°
   w odległościach 1 m, 2 m, 4 m.
3. W każdym punkcie klaśnij 5 razy, nagrywając 4-kanałowo.
4. `python senses/soundloc.py --wav nagranie.wav` dla każdego pliku.
5. Tabela: błąd średni i rozrzut w funkcji kąta i odległości.

**Wynik:** mapa dokładności Twojego zestawu.
**Kryterium sukcesu:** błąd < 10° do 2 m przy kątach do ±45°. Przy krawędziach
(±60° i więcej) macierz liniowa naturalnie traci rozdzielczość — to fizyka, nie usterka.

---

## 5. Macierz parametrów lotu

**Pytanie:** który zestaw wysokość × pokrycie daje najlepszy model przy
najkrótszym locie?

**Protokół:**
1. Wygeneruj macierz:
   ```bash
   python senses/flightplan.py matrix --altitudes 30,50,70,90 --overlaps 0.70,0.80,0.90
   ```
2. Wybierz obiekt referencyjny (jak w badaniu 2).
3. Przeleć **każdy** wariant nad tym samym obiektem, tego samego dnia,
   przy podobnym świetle (to ważne — światło wpływa na dopasowanie punktów).
4. Zbuduj modele, zmierz błąd, zapisz też czas rekonstrukcji.
5. Wykres: błąd vs czas lotu, z zaznaczonym czasem obliczeń.

**Wynik:** Twoja własna tabela „co ustawić do czego".
**Kryterium sukcesu:** potrafisz wskazać jeden wariant domyślny do map terenu
i jeden do pojedynczych obiektów.

---

## 6. Komfort termiczny bez kamery termalnej

**Pytanie:** czy da się przewidzieć, gdzie na działce będzie przyjemnie,
łącząc dwa modele geometryczne?

**Potrzebujesz:** modelu 3D, dwóch termometrów, wietrznego dnia.

**Protokół:**
1. Policz mapę komfortu:
   ```bash
   python senses/terrain.py comfort model.ply --lat X --lon Y \
       --date RRRR-MM-DD --wind 270 --season lato
   ```
2. Odczytaj z wyniku miejsce **najlepsze** i **najgorsze**.
3. Postaw w obu termometry (w cieniu osłonki, 1,5 m nad ziemią).
4. Notuj temperaturę co godzinę przez dzień.

**Wynik:** różnica temperatur między miejscami wskazanymi przez model.
**Kryterium sukcesu:** różnica ≥ 2 °C w przewidzianym kierunku. Wtedy model
ma wartość praktyczną przy wyborze miejsca na taras.

---

## Jak to zapisywać

Dla każdego badania załóż jedną notatkę w bazie wiedzy Cosmosa:
**data, warunki, sprzęt, surowe dane, wynik, wniosek**. Po kilku miesiącach
Cosmos będzie umiał odpowiedzieć na pytanie *„jakie ustawienia lotu dawały
najlepsze wyniki?"* — bo Ty mu to zmierzyłeś.

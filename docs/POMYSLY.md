# 💡 Cosmos — pomysły na wykorzystanie

Zbiór pomysłów: od rzeczy, które zrobisz dziś wieczorem, po projekty badawcze.
Nie traktuj tego jak listy zadań — to **ściana warsztatu**. Większość narzędzi wisi
i czeka; wartość polega na tym, że gdy czegoś potrzebujesz, ono jest i jest Twoje.

**Legenda:**
- ✅ **działa dziś** — masz to w Cosmosie, wystarczy użyć
- 🔧 **wymaga dopisania** — pomysł opiera się na tym, co mamy, ale potrzebuje nowego modułu
- 💰 **kosztuje** — zużywa środki z Twoich kluczy API albo wynajętego GPU

---

# CZĘŚĆ I — Praca: wideo i klienci

**1. Przeszukiwalne archiwum wszystkiego, co nagrałeś** ✅
Wrzucasz nagrania do bazy wiedzy → Whisper transkrybuje → pytasz *„w którym pliku klient
mówił o deadline'ie?"*. Zamiast przewijać 20 godzin materiału — odpowiedź ze źródłem.
Najbardziej niedoceniana funkcja tego systemu.

**2. Storyboard w minuty** ✅💰
Studio → opisujesz scenę → model rozpisuje ujęcia → generuje kadr do każdego.
Moodboard do pitchu, zanim ruszysz w teren.

**3. Assety lądują same w Premiere** ✅
`STUDIO_EXPORT_DIR` ustawiony na folder projektu — każda grafika, lektor i wideo
pojawia się w Media Browser bez przeciągania plików.

**4. Scratch VO przed nagraniem lektora** ✅💰
ElevenLabs czyta skrypt → montujesz na tym rytm → dopiero potem nagrywasz człowieka.
Oszczędza jedną pełną rundę poprawek.

**5. Upscale archiwum** ✅
Real-ESRGAN — materiały sprzed lat wracają do użytku w dzisiejszej rozdzielczości.

**6. Pamięć o klientach** ✅
Umowy, briefy, stawki w bazie wiedzy → *„jaką stawkę dawałem klientowi X rok temu?"*

**7. Rutyny operacyjne** ✅
Comiesięczne sprawdzenie statusów/rachunków (automatyzacja tylko-do-odczytu),
przygotowane podsumowanie. Płacisz Ty — jednym kliknięciem.

---

# CZĘŚĆ II — Dron + aparat: pomiary i analiza

Tu Cosmos przestaje być asystentem, a staje się **przyrządem pomiarowym**.
Podstawa jest już w repo: `senses/photoscan.py` → COLMAP → gęsta chmura punktów `.ply`.

> ⚖️ Zanim polecisz: przestrzegaj przepisów dla dronów (rejestracja operatora, strefy
> zakazane, zgoda właściciela terenu, RODO przy nagrywaniu ludzi). Analiza jest legalna;
> lot bywa regulowany.

> ✅ **Narzędzie jest już w repo:** `senses/terrain.py` — komendy `sun`, `shadow`,
> `view`, `volume`, `compare`. Sprawdź poprawność obliczeń: `python terrain.py selftest`.

## 🌞 Nasłonecznienie działki — flagowy projekt ✅

**To jest realna analiza inżynierska, nie zgadywanie.** Fizyka jest po Twojej stronie:
pozycja słońca (azymut + wysokość) jest **deterministyczna** — liczy się ją ze
współrzędnych, daty i godziny (algorytm NOAA), offline, bez AI i bez API.

**Jak to zrobić — dwie komendy:**

```bash
# 1. Zbuduj model 3D z przelotu dronem (siatka zdjęć, ~70–80% pokrycia)
python senses/photoscan.py C:\zdjecia\dzialka --dense

# 2. Policz nasłonecznienie dla swojej lokalizacji i daty
python senses/terrain.py sun C:\zdjecia\dzialka\cosmos-scan\dense\fused.ply \
    --lat 52.23 --lon 21.01 --date 2026-06-21
```

Dostajesz mapę PNG (godziny słońca na każdy metr) + plik JSON ze statystykami:
długość dnia, maksymalna wysokość słońca, średnia liczba godzin i **jaki procent terenu
ma ponad 6 godzin** — to próg dla warzywnika i opłacalności paneli PV.

Pod spodem: pozycja słońca liczona algorytmem NOAA (czysta astronomia, offline),
chmura punktów zamieniana na mapę wysokości, a potem dla każdego metra i każdego
kroku czasowego sprawdzenie, czy promień do słońca jest przez coś zasłonięty.

**Co z tego realnie masz:**
- 🏡 **Gdzie postawić dom / taras** — który narożnik ma poranne słońce, a który zachodnie
- ☀️ **Gdzie i czy opłacają się panele PV** — ile godzin słońca ma dach latem i zimą,
  ile zabiera sąsiedzkie drzewo
- 🌱 **Plan ogrodu** — które grządki mają wymagane 6h+ słońca, a gdzie sadzić cień-lubiące
- 🌳 **Wycinka z sensem** — symulujesz „co się zmieni, jeśli usunę to jedno drzewo"
- 💧 **Bonus z tego samego modelu**: spadki terenu → gdzie spływa i zbiera się woda

**Bądź świadomy ograniczeń (to je czyni wiarygodnym):**
- Liczysz **promieniowanie bezpośrednie**; pełny bilans wymaga jeszcze światła rozproszonego
  z nieba (współczynnik widoczności nieba — dopisywalne w drugim kroku).
- **Drzewa liściaste** w chmurze punktów są „pełne". Zimą tracą liście → model zawyży
  zacienienie. Rozwiązanie: dwa skany (z liśćmi i bez) i dwa scenariusze.
- Geometria daje **potencjał** — rzeczywiste kWh to potencjał × lokalne dane o zachmurzeniu.

**Walidacja (i tu robi się naukowo):** zrób zdjęcie z drona o znanej godzinie i porównaj
prawdziwe cienie z tymi wyliczonymi przez model. Zgodność = masz dowód, że narzędzie działa.
To jest ten krok, który odróżnia zabawkę od przyrządu.

## 🎬 „Sun scouting" — ta sama technologia dla filmowca ✅

Ten sam model 3D lokacji + pozycja słońca = **odpowiedź na pytanie, o której godzinie
światło będzie tam, gdzie chcesz**:

- *„15 czerwca o której słońce schowa się za tym budynkiem?"*
- *„O której złota godzina oświetli tę ścianę od frontu?"*
- *„Czy w listopadzie o 14:00 ta uliczka będzie jeszcze w słońcu?"*

```bash
python senses/terrain.py shadow model.ply --lat 52.23 --lon 21.01 --time "2026-06-15 17:30"
```

Aplikacje typu Sun Seeker robią to na płaskim modelu. Ty robisz to na **swoim skanie
prawdziwej lokacji z prawdziwymi drzewami**. To jest przewaga, której nie kupisz.

## 👁 Analiza widoku — co widać, i kto widzi Ciebie ✅

```bash
python senses/terrain.py view model.ply --eye 4.5   # okno na piętrze
```

Z tego samego modelu: **co zobaczysz z okna na pierwszym piętrze**, zanim je wybudujesz.
Odwrotnie też działa — ustaw punkt obserwacji na tarasie sąsiada i sprawdź, **czy widzi
Twój ogród**. Do tego: gdzie postawić maszt/antenę, żeby miała czystą linię widzenia.

## 📦 Objętość i zmiany w czasie ✅

```bash
python senses/terrain.py volume haldа.ply                 # kubatura pryzmy
python senses/terrain.py compare styczen.ply czerwiec.ply # co przybyło / ubyło
```

Pomiar kubatury pryzmy kruszywa albo wykopu (realna usługa dla firm budowlanych)
i porównanie dwóch przelotów: postęp budowy, erozja skarpy, przyrost roślinności,
zaleganie śniegu. Dostajesz mapę zmian (zielone = przybyło, czerwone = ubyło)
i bilans w metrach sześciennych.

## Pozostałe pomiary z drona

| Pomysł | Status | O co chodzi |
|---|---|---|
| **Dendrometria** | 🔧 | Z modelu 3D: wysokość drzew i średnica koron → wycena drzewostanu, ocena zagrożenia (które drzewo sięgnie dachu przy wywrocie) |
| **Spływ wody i podtopienia** | 🔧 | Z mapy wysokości: gdzie woda spływa i gdzie się zbiera po ulewie. Kluczowe przy kupnie działki i projekcie drenażu |
| **Zaleganie śniegu i sople** | 🔧 | Połączenie zacienienia z nachyleniem dachu → gdzie śnieg zostaje najdłużej i gdzie rosną sople |
| **Osłona od wiatru** | 🔧 | Z modelu: gdzie jest zacisznie (taras, ogród, miejsce na nasadzenia) |
| **Mapa hałasu** | 🔧 | Spacer po działce z telefonem/mikrofonem + zapis poziomu dźwięku → gdzie jest cicho. Bezcenne przy zakupie działki przy drodze |
| **Zasięg Wi-Fi / LTE** | 🔧 | Ten sam spacer, tylko mierzysz sygnał → gdzie postawić access point albo wzmacniacz |
| **Nocne niebo** | 🔧 | Długie ekspozycje + mapa zaświetlenia → gdzie ustawić teleskop albo kręcić astro-timelapse |
| **Inwentaryzacja** | ✅🔧 | YOLO liczy drzewa, auta, panele; z fotogrametrii mierzysz wysokości |
| **Inspekcja dachu/elewacji** | ✅ | Naucz Cosmosa (przez „Naukę") jak wygląda pęknięta dachówka czy odparzony tynk → potem tylko pokazujesz zdjęcia |
| **Dokumentacja zabytku** | ✅ | Fotogrametria obiektu → archiwalny model 3D. Wartość rośnie z czasem |
| **Wskaźniki roślinności** | 🔧 | ⚠️ **Uczciwie:** NDVI wymaga kanału podczerwonego (Mavic 3 **Multispectral**). Zwykłym Mavikiem policzysz indeksy z kanałów RGB (VARI, ExG) — słabsze, ale realne i publikowane |
| **Termowizja** | ❌ | Wymaga Mavica 3T. Bez kamery termalnej nie da się — nie próbuj tego udawać |

---

# CZĘŚĆ II½ — Materiał filmowy i zdjęciowy: rzeczy, które robią się same

**1. Auto-katalog całego materiału** ✅🔧
YOLO przechodzi po Twoim archiwum i taguje każdy klip: czy to dron, wywiad, b-roll,
ile osób w kadrze, jakie obiekty. Do tego transkrypcja Whisper. Efekt: **biblioteka,
którą przeszukujesz zdaniem** — *„ujęcia z drona nad wodą, bez ludzi"* — zamiast
klikania po folderach. Podstawa (detekcja + transkrypcja + baza wiedzy) już działa;
brakuje wsadowego przelotu po katalogu.

**2. Culling zdjęć w minutę** ✅
`photoscan.py` **już liczy** ostrość i ekspozycję każdego zdjęcia. Puść to na sesję
zdjęciową, nie tylko na fotogrametrię — dostajesz listę ujęć nieostrych i prześwietlonych,
zanim otworzysz Lightrooma.

**3. Timelapse budowy z powtarzalnych przelotów** 🔧
Ten sam plan lotu co miesiąc → zdjęcia z tych samych punktów → wyrównane wideo
postępu prac. Klient dostaje film „od wykopu do kluczy", którego nikt inny nie ma.

**4. Druga para oczu do kadru** ✅💰
Model wizyjny ocenia kompozycję Twoich ujęć (linie, balans, horyzont, światło).
Nie po to, żeby Cię zastąpił — po to, żeby złapać to, co przeoczyłeś przy 300 kadrach.

**5. Zabezpieczenie sprzętu przed wyjazdem** ✅
Naucz go swojego sprzętu przez „Naukę", rozłóż wszystko na stole, pokaż kamerze:
*„czego brakuje?"*. Najprostsza rzecz z tej listy i chyba najczęściej używana.

---

# CZĘŚĆ II¾ — Z tego da się zrobić usługę

Poniższe nie są fantazją — to nisze, w których **ludzie płacą**, a Ty masz już
i sprzęt, i narzędzia. Wszystkie opierają się na tym samym łańcuchu: przelot → model 3D
→ analiza → raport PDF/mapa.

| Usługa | Dla kogo | Dlaczego Ty |
|---|---|---|
| **Analiza nasłonecznienia działki** | kupujący działkę, architekci, inwestorzy | Nikt im tego nie policzy na *ich* drzewach i *ich* sąsiadach. Raport: mapy dla czerwca i grudnia + wnioski |
| **Dobór i wycena paneli PV** | właściciele domów, instalatorzy | Instalator sprzedaje panele; Ty sprzedajesz **niezależną ocenę**, ile ten dach realnie da i co zabiera drzewo sąsiada |
| **Dokumentacja postępu budowy** | wykonawcy, inwestorzy, banki | Comiesięczny przelot + porównanie + kubatura. Abonament, nie zlecenie jednorazowe |
| **Pomiar hałd i wykopów** | firmy budowlane, kruszywa | `terrain.py volume` — pomiar w kilkanaście minut zamiast geodety na pół dnia |
| **Skany 3D obiektów** | architekci, nieruchomości, konserwatorzy | Model 3D + wizualizacja; przy zabytkach wartość archiwalna rośnie z każdym rokiem |
| **Sun scouting dla produkcji** | ekipy filmowe, fotografowie ślubni | „O której słońce wejdzie w tę uliczkę 12 sierpnia" — na skanie prawdziwej lokacji |

> Zacznij od jednej: **nasłonecznienie działki**. Zrób ją najpierw dla siebie albo
> znajomego, zbuduj z tego wzorzec raportu — i masz gotowy produkt do pokazania.

---

# CZĘŚĆ III — Kierunek badawczy

Rzeczy, w których jesteś **badaczem**, a nie użytkownikiem. Wszystkie mają wspólną cechę:
mierzalny wynik.

**1. Twój prywatny benchmark modeli** ✅💰
Masz w jednym interfejsie Nemotron (chmura), model lokalny, GPT i Claude. Zbuduj zestaw
20–30 **swoich** realnych zadań (streszcz brief, napisz opis YouTube, przeanalizuj kadr)
i przepuść przez każdy silnik. Oceniaj na ślepo. Wynik: wiesz, **który model jest lepszy
dla Ciebie** — a nie który wygrywa w cudzych rankingach.

**2. Czy fine-tuning naprawdę pomaga?** ✅💰
Masz komplet: eksport datasetu → „Dotrenuj" → model lokalny. Zrób uczciwy eksperyment:
wytrenuj LoRA na swoich rozmowach, przygotuj 20 zadań testowych, oceń **na ślepo**
odpowiedzi modelu bazowego vs dotrenowanego. Większość ludzi tego nie mierzy — po prostu
zakłada, że pomogło.

**3. Jakość przywoływania z bazy wiedzy (RAG)** ✅
Zadaj 30 pytań, do których znasz właściwe źródło. Sprawdź, ile razy Cosmos przywołał
prawidłowy fragment (embeddingi bge-m3 vs tryb słów kluczowych). Wynik mówi Ci, czy
warto trzymać włączone zmysły.

**4. Fenologia — kalendarz przyrody z kamery** ✅🔧
Kamera 24/7 na drzewo/ogród + codzienna migawka do osi czasu. Po roku masz własny zbiór:
kiedy pojawiły się liście, kiedy przyleciały ptaki, jak pogoda przesunęła sezon.
To jest prawdziwa nauka obywatelska — i świetny materiał na timelapse.

**5. Dokładność fotogrametrii** 🔧
Zmierz obiekt taśmą, potem zeskanuj dronem i porównaj z modelem. Ustal **realny błąd**
swojego zestawu (w cm). Bez tego żaden pomiar z modelu nie ma wiarygodności.

**6. Kinect vs fotogrametria** ✅🔧
Ten sam obiekt zmierzony czujnikiem głębi i ze zdjęć. Gdzie każda metoda wygrywa,
gdzie się sypie (połysk, ciemność, cienkie elementy).

---

# CZĘŚĆ IV — Jarvis: obecność, nie czat

Różnica między „mam asystenta AI" a „mam Jarvisa" polega na **inicjatywie i obecności** —
system wie, co się dzieje, i odzywa się pierwszy.

**Co masz już dziś** ✅
- Wake word „Hej, Kosmos" — rozmowa bez klikania
- Kamera na żywo z rozpoznawaniem obiektów i **świadomością pozycji** („po lewej / na środku")
- Pamięć długotrwała + profil — pamięta Ciebie między rozmowami
- Oś czasu (Time Machine) — *„co się zmieniło w studiu od wczoraj?"*
- Rutyny — odzywa się o wyznaczonej porze
- Akcje za zgodą — proponuje, Ty zatwierdzasz

**Pomysły do złożenia z tych klocków:**

**1. Poranna odprawa** ✅
**Gotowe.** Ustawienia → „Poranna odprawa": Cosmos pobiera pogodę (open-meteo, bez klucza),
wydarzenia z kalendarza (`.ics`), czekające rutyny i ostatnie zdarzenia, streszcza to
modelem i **czyta na głos**. Możesz odpalić ręcznie albo ustawić godzinę.
Konfiguracja: `BRIEFING_LAT`, `BRIEFING_LON`, opcjonalnie `CALENDAR_ICS` w `.env`.

**2. Sterowanie światłem i sprzętem** ✅
**Gotowe.** Ustawienia → „Urządzenia": dodajesz cokolwiek, co przyjmuje HTTP
(Home Assistant, Shelly, Hue, Tasmota). Potem w rozmowie: *„przygaś światło"* →
Cosmos proponuje `[AKCJA: urządzenie | …]`, Ty zatwierdzasz jednym kliknięciem.
Nic nie dzieje się bez Twojej zgody.

**3. Sceny: „nagrywam" / „wychodzę"** 🔧
Kilka urządzeń naraz jednym poleceniem: *„tryb nagrywania"* = światło kluczowe,
gaśnie górne, wyłączony dzwonek. *„Wychodzę"* = wszystko gaśnie + podsumowanie dnia.
Mechanizm urządzeń już jest — brakuje grupowania w sceny.

**4. Powitanie przy biurku** 🔧
Kamera wykrywa, że usiadłeś → Cosmos wita się i melduje stan („zmysły online,
2 rutyny czekają"). Krótko, bez gadulstwa.

**5. Strażnik studia** 🔧
Kamera + oś czasu: powiadom, gdy w studiu **coś zniknie albo się pojawi** pod Twoją
nieobecność. Wykrywanie zmian już działa — brakuje reguły „powiadom, gdy…".

**3. Checklista sprzętu przed wyjazdem** ✅
Naucz go rozpoznawać *Twoje* rzeczy (obiektywy, akumulatory, filtry ND, nadajniki).
Rozkładasz sprzęt, pokazujesz kamerze, pytasz: *„czego brakuje?"*.
**To dziś najlepszy sposób, żeby poczuć, że to Twój system.**

**4. „Co mam w ręku?"** ✅
Ręce zajęte sprzętem — pytasz głosem, patrzy kamerą, szuka w internecie, odpowiada.

**5. Dziennik studia** ✅
Notatki głosowe („nowa notatka") lądują w bazie wiedzy z transkrypcją. Po miesiącu
masz przeszukiwalny dziennik pracy, którego nikt nie musiał pisać.

**6. Sterowanie domem/studiem** 🔧
Największa luka do prawdziwego Jarvisa. Cosmos **nie steruje** dziś żadnym sprzętem.
Do dopisania: mostek HTTP/MQTT (Home Assistant, Shelly, Philips Hue) jako nowy typ
akcji — *„Kosmos, przygasz światło i włącz klucz"*. Wzorzec akcji za zgodą już mamy,
więc to raczej dołożenie modułu niż przebudowa.

**7. Proaktywne alerty** 🔧
Rutyna coś wykryje (skończył się render, spadła cena, przyszła płatność) → powiadomienie
push zamiast czekania, aż zapytasz.

---

# CZĘŚĆ V — Stan modułów

**Dopisane i przetestowane** (te pozycje były wcześniej na liście braków):

| Moduł | Co daje | Gdzie |
|---|---|---|
| ✅ **Kalkulator słońca i cieni** | Nasłonecznienie działki, sun scouting, plan PV i ogrodu | `senses/terrain.py sun` / `shadow` |
| ✅ **Analiza widoku (viewshed)** | Co widać z okna; czy sąsiad widzi taras; lokalizacja masztu | `senses/terrain.py view` |
| ✅ **Pomiary z modelu 3D** | Kubatura pryzm i wykopów, wysokości obiektów | `senses/terrain.py volume` |
| ✅ **Porównywarka skanów w czasie** | Postęp budowy, erozja, przyrost roślinności | `senses/terrain.py compare` |
| ✅ **Mostek do urządzeń (HTTP)** | Sterowanie światłem i sprzętem z rozmowy, za zgodą | Ustawienia → Urządzenia |
| ✅ **Poranna odprawa** | Pogoda + kalendarz + zadania, streszczone i czytane na głos | Ustawienia → Poranna odprawa |
| ✅ **Kalendarz** | Wydarzenia na dziś w odprawie (przez `.ics`, bez OAuth) | `CALENDAR_ICS` w `.env` |

**Nadal do zrobienia** — uczciwie, wraz z powodem:

| Moduł | Odblokowuje | Dlaczego jeszcze nie |
|---|---|---|
| **Powiadomienia push (Web Push)** | Alerty, gdy aplikacja jest zamknięta | Wymaga kluczy VAPID i obsługi w service workerze — dziś powiadomienia działają tylko przy otwartej aplikacji |
| **Sceny urządzeń** | „tryb nagrywania", „wychodzę" — kilka urządzeń naraz | Drobne rozszerzenie mostka: grupa zamiast pojedynczego urządzenia |
| **Reguły „powiadom, gdy…"** | Strażnik studia, alerty ze zmian w otoczeniu | Potrzebny prosty silnik reguł na zdarzeniach |
| **Wsadowe tagowanie archiwum** | Auto-katalog całego materiału filmowego | Detekcja i transkrypcja są — brakuje przelotu po katalogu i zapisu tagów |
| **Poczta (OAuth)** | Odprawa z pocztą | Świadomie odłożone: OAuth + przechowywanie tokenów to poważny temat prywatnościowy; kalendarz przez `.ics` daje 80% wartości bez tego |
| **MQTT** | Urządzenia bez HTTP API | Mostek HTTP pokrywa Home Assistant, Shelly, Hue i Tasmotę — MQTT dopiero gdy trafisz na sprzęt bez REST-a |

---

# Od czego zacząć (moja rada)

Nie rzucaj się na wszystko. **Trzy rzeczy na ten tydzień:**

1. **Wrzuć do bazy wiedzy instrukcje sprzętu i 2–3 stare briefy.** 20 minut, natychmiastowy efekt.
2. **Ustaw `STUDIO_EXPORT_DIR` na aktywny projekt w Premiere.** Zero wysiłku, stały zysk.
3. **Naucz go pięciu przedmiotów ze swojego sprzętu** i zrób jedną checklistę przed wyjazdem.

**A gdy zechcesz projekt z prawdziwego zdarzenia** — bierz **nasłonecznienie działki**.
Narzędzie jest gotowe i przetestowane; potrzebujesz tylko jednego przelotu dronem:

```bash
python senses/terrain.py selftest                  # sprawdź, że liczy poprawnie
python senses/photoscan.py <folder-ze-zdjęciami> --dense
python senses/terrain.py sun <...>/fused.ply --lat TWOJA --lon TWOJA --date 2026-06-21
python senses/terrain.py sun <...>/fused.ply --lat TWOJA --lon TWOJA --date 2026-12-21
```

Dwie mapy — czerwiec i grudzień — i już widzisz o tej działce więcej niż jej właściciel.
To pomysł, który łączy Twój sprzęt, Twoje umiejętności i realną wartość: najpierw
dla siebie, a gdy zechcesz — jako usługa dla innych.

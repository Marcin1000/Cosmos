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

## 🌞 Nasłonecznienie działki — flagowy projekt 🔧

**To jest realna analiza inżynierska, nie zgadywanie.** Fizyka jest po Twojej stronie:
pozycja słońca (azymut + wysokość) jest **deterministyczna** — liczy się ją ze
współrzędnych, daty i godziny (algorytm NOAA), offline, bez AI i bez API.

**Jak to działa — cztery kroki:**

1. **Skan terenu** ✅ — oblatujesz działkę Mavikiem (siatka zdjęć, ~70–80% pokrycia),
   `photoscan.py --dense` buduje chmurę punktów **wraz z drzewami, budynkami i rzeźbą terenu**.
2. **Współrzędne** ✅ — szerokość i długość geograficzną Cosmos odczyta z EXIF-u zdjęć
   z drona (GPS jest w każdym pliku).
3. **Pozycja słońca** 🔧 — dla każdej godziny każdego dnia roku liczysz azymut i wysokość
   słońca dla tej lokalizacji.
4. **Rzut cienia** 🔧 — chmurę punktów zamieniasz w mapę wysokości (DSM), a potem dla
   każdego metra kwadratowego sprawdzasz, czy promień w stronę słońca jest przez coś
   zasłonięty. Sumujesz po dniu/sezonie → **mapa godzin bezpośredniego słońca**.

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

## 🎬 „Sun scouting" — ta sama technologia dla filmowca 🔧

Ten sam model 3D lokacji + pozycja słońca = **odpowiedź na pytanie, o której godzinie
światło będzie tam, gdzie chcesz**:

- *„15 czerwca o której słońce schowa się za tym budynkiem?"*
- *„O której złota godzina oświetli tę ścianę od frontu?"*
- *„Czy w listopadzie o 14:00 ta uliczka będzie jeszcze w słońcu?"*

Aplikacje typu Sun Seeker robią to na płaskim modelu. Ty robisz to na **swoim skanie
prawdziwej lokacji z prawdziwymi drzewami**. To jest przewaga, której nie kupisz.

## Pozostałe pomiary z drona

| Pomysł | Status | O co chodzi |
|---|---|---|
| **Zmiany w czasie** | 🔧 | Ten sam przelot co miesiąc → porównanie: postęp budowy, erozja, przyrost roślinności, zaleganie śniegu. To „Time Machine" wyniesiona na zewnątrz |
| **Objętość hałd** | 🔧 | Z modelu 3D liczysz kubaturę pryzmy piasku/kruszywa/ziemi. Realna usługa komercyjna |
| **Inwentaryzacja** | ✅🔧 | YOLO liczy drzewa, auta, panele; z fotogrametrii mierzysz wysokości |
| **Inspekcja dachu/elewacji** | ✅ | Naucz Cosmosa (przez „Naukę") jak wygląda pęknięta dachówka czy odparzony tynk → potem tylko pokazujesz zdjęcia |
| **Dokumentacja zabytku** | ✅ | Fotogrametria obiektu → archiwalny model 3D. Wartość rośnie z czasem |
| **Wskaźniki roślinności** | 🔧 | ⚠️ **Uczciwie:** NDVI wymaga kanału podczerwonego (Mavic 3 **Multispectral**). Zwykłym Mavikiem policzysz indeksy z kanałów RGB (VARI, ExG) — słabsze, ale realne i publikowane |
| **Termowizja** | ❌ | Wymaga Mavica 3T. Bez kamery termalnej nie da się — nie próbuj tego udawać |

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

**1. Poranna odprawa** 🔧
Rutyna o 8:00: Cosmos zbiera pogodę, plan dnia i statusy, streszcza i **czyta na głos**
(Piper), gdy wchodzisz do studia. Klasyczny jarvisowy moment.

**2. Powitanie przy biurku** 🔧
Kamera wykrywa, że usiadłeś → Cosmos wita się i melduje stan („zmysły online,
2 rutyny czekają"). Krótko, bez gadulstwa.

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

# CZĘŚĆ V — Co dopisać, żeby to odblokować

Uczciwa lista rzeczy, których dziś **nie ma**, uszeregowana wg tego, ile dają w stosunku
do pracy:

| Moduł | Odblokowuje | Skala pracy |
|---|---|---|
| **Kalkulator słońca + cieni** (DSM z chmury punktów + pozycja słońca) | Nasłonecznienie działki, sun scouting, plan PV, plan ogrodu | średnia — jeden skrypt Pythona |
| **Porównywarka skanów w czasie** | Postęp budowy, erozja, przyrost roślinności | mała–średnia |
| **Mostek do smart home (MQTT/HTTP)** | Prawdziwy „Jarvis" — sterowanie światłem, sprzętem | mała (wzorzec akcji już jest) |
| **Powiadomienia push z rutyn** | Proaktywność zamiast odpytywania | mała |
| **Pomiary z modelu 3D (objętość, wysokość)** | Usługi komercyjne dla firm | średnia |
| **Kalendarz / poczta** | Poranna odprawa z prawdziwym planem dnia | średnia (OAuth) |

---

# Od czego zacząć (moja rada)

Nie rzucaj się na wszystko. **Trzy rzeczy na ten tydzień:**

1. **Wrzuć do bazy wiedzy instrukcje sprzętu i 2–3 stare briefy.** 20 minut, natychmiastowy efekt.
2. **Ustaw `STUDIO_EXPORT_DIR` na aktywny projekt w Premiere.** Zero wysiłku, stały zysk.
3. **Naucz go pięciu przedmiotów ze swojego sprzętu** i zrób jedną checklistę przed wyjazdem.

**A gdy zechcesz projekt z prawdziwego zdarzenia** — bierz **nasłonecznienie działki**.
Masz do niego wszystko oprócz jednego skryptu: drona, fotogrametrię, GPU i model 3D.
To pomysł, który łączy Twój sprzęt, Twoje umiejętności i realną wartość — dla Ciebie,
a gdybyś chciał, także jako usługa dla innych.

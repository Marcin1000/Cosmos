# 🗺️ Cosmos — roadmapa funkcji

Lista wszystkich pomysłów do wdrożenia, budowanych **partiami** — każda partia
jest w pełni działająca i przetestowana, zanim ruszy następna. `[x]` = gotowe,
`[ ]` = zaplanowane.

---

## ✅ Partia 1 — codzienny komfort rozmów (GOTOWE)

- [x] **Wyszukiwarka rozmów** — pole nad listą, filtruje po tytule (Ctrl/Cmd+K)
- [x] **Zmiana nazwy rozmowy** — ikona ✎ na liście
- [x] **Przypinanie rozmów** — ulubione na górze, znak 📌
- [x] **Eksport rozmowy do Markdown** — przycisk w pasku górnym
- [x] **Regeneruj odpowiedź** — pod wiadomością asystenta
- [x] **Edytuj i wyślij ponownie** — pod wiadomością użytkownika
- [x] **Skróty klawiszowe** — Ctrl/Cmd+K (szukaj), Ctrl/Cmd+Shift+O (nowa rozmowa)

## ✅ Partia 2 — Studio i biblioteka mediów (rdzeń GOTOWE)

- [x] **Galeria wyników Studio** — miniatury wszystkich wygenerowanych mediów
  (obraz/dźwięk/wideo) z filtrowaniem, pobieraniem, usuwaniem i „użyj jako klatka wideo"
- [x] **Warianty obrazu** — generowanie ×1 / ×2 / ×4 naraz, wyniki w siatce
- [x] **Szablony promptów** — zapis i wywołanie zapisanych stylów w Studiu

### ✅ Partia 2b — zaawansowana obróbka (GOTOWE)
- [x] **Storyboard AI** — scena → model rozpisuje ujęcia → obraz na każde ujęcie
- [x] **Edycja przez maskowanie (inpainting)** — malowanie maski na płótnie + OpenAI images/edit
- [x] **Upscale obrazu** — przycisk w galerii → usługa zmysłów (Real-ESRGAN, opcjonalny model)
- [x] **Warianty jako kolejka** — generowanie ×1/×2/×4 (kolejka wsadowa w rdzeniu Partii 2)

## ✅ Partia 3 — wiedza i pamięć (GOTOWE)

- [x] **Cytowanie źródeł** — model dostaje instrukcję podawania `[źródło: nazwa]` przy użyciu bazy wiedzy
- [x] **Wyszukiwanie po treści rozmów** — skan plików po stronie serwera, wpięte w wyszukiwarkę
- [x] **Automatyczne streszczenia** — przycisk „Streść rozmowę" w pasku górnym
- [x] **Pamięć profilowa** — trwały profil (Ustawienia) wstrzykiwany do każdej rozmowy, zapisany na serwerze (cross-device)
- [x] **Wskaźnik tokenów** — szacunkowy licznik kontekstu przy polu wiadomości
- [ ] **Foldery / tagi rozmów** — do rozważenia; obecnie mamy wyszukiwarkę + przypinanie, co pokrywa większość potrzeb

## ✅ Partia 4 — percepcja i robotyka (GOTOWE / scaffold)

- [x] **Panel podglądu kamery na żywo** — pływające okno z obrazem + nakładką detekcji
  YOLO; działa na kamerze telefonu i komputera
- [x] **Pamięć przestrzenna** — detekcja z pozycją (po lewej/na środku/po prawej) trafia
  jako zdarzenie percepcji do kontekstu → model odpowiada „gdzie coś jest"
- [~] **Wake-word lokalny** — `senses/wake_listener.py` (openWakeWord) nasłuchuje bez
  otwartej karty i zgłasza zdarzenie, ale **nic go po stronie przeglądarki nie odbiera**:
  tryb głosowy się nie otwiera. Do dokończenia brakuje kanału serwer → przeglądarka
  (SSE albo Web Push). Dodatkowo openWakeWord nie ma polskiego „Hej Kosmos" —
  własny model trzeba wytrenować
- [x] **Kinect 360 w pełni** — `senses/kinect_win.py` mostkuje Kinect for Windows
  SDK 1.8 przez ctypes: głębia, obraz RGB, **śledzenie szkieletu (20 stawów)** i silnik
  pochylenia. Wcześniej zakładaliśmy, że SDK jest dostępne tylko z C#/C++, i kierowaliśmy
  na libfreenect — który wymaga budowania i nie ma szkieletu w ogóle. `watcher.py`
  przyjmuje Kinecta jako źródło obrazu (`CAMERA_SOURCE=kinect`), `kinect_watcher.py`
  sam wybiera sterownik. **Potwierdzone na sprzęcie**: głębia, RGB, szkielet
  i silnik pochylenia działają na Kinekcie 360 z SDK 1.8 pod Windows 11
- [~] **Integracja z Mavic 3** — pokryta przez `senses/photoscan.py`: zdjęcia z lotu →
  model 3D (COLMAP). Sterowanie lotem z PC jest ograniczone przez DJI (patrz analiza wcześniej)
- [ ] **Sterowanie gestami** — wymaga biblioteki MediaPipe w przeglądarce (zewnętrzna,
  do rozważenia offline); alternatywnie gesty z endpointu /pose usługi zmysłów

## ✅ Partia 5 — platforma i infrastruktura (GOTOWE / częściowo)

- [x] **Kopie zapasowe** — pobieranie całej kopii (rozmowy + pamięć + profil) do pliku JSON
  i przywracanie z pliku (Ustawienia → Kopia zapasowa)
- [x] **Panel statystyk** — liczba rozmów, wpisów pamięci, pozycji bazy wiedzy i rozmiar
  (Ustawienia); status silników i usług już w panelu bocznym
- [x] **Pełny tryb offline** — przełącznik wyłączający wyszukiwanie w internecie; z modelem
  lokalnym + lokalnymi zmysłami Cosmos działa bez sieci (PWA cache’uje interfejs)
- [ ] **Streaming głosu (WebRTC)** — tryb głosowy już działa (Web Speech); pełny WebRTC do
  serwerowego STT to osobny, duży projekt infrastrukturalny
- [ ] **Profile / wielu użytkowników** — obecnie logowanie jednym hasłem + profil osobisty;
  konta wielu użytkowników to osobny moduł

## ✅ Partia 6 — kierunki ambitne (GOTOWE / fundament)

- [x] **Digital Time Machine** — migawki otoczenia (obraz + wykryte obiekty) na osi czasu
  z automatycznymi różnicami (co się pojawiło / zniknęło); migawka z panelu kamery na żywo
- [x] **Agent wykonujący zadania** — model proponuje akcje `[AKCJA: typ | treść]`, a Ty je
  zatwierdzasz jednym kliknięciem (zapamiętaj / notatka). Fundament „human-in-the-loop"
  gotowy; kolejne, bardziej wrażliwe akcje (pliki, przeglądarka) można dokładać w tym wzorcu
- [~] **Uniwersalny agent eksploracyjny** — zrealizowany architektonicznie: jeden mózg
  (Nemotron) + wiele „ciał" i zmysłów zgłaszających zdarzenia do wspólnego kontekstu
  (kamera, Kinect, watchery, dron przez PhotoScan). Rozbudowa = kolejne „ciała" w tym samym modelu zdarzeń

## ✅ Partia 7 — Nauka (GOTOWE / fundament)

Uczenie Cosmosa — trzy filary, wszystkie z zasadą „człowiek w pętli":

- [x] **Rozpoznawanie przez zmysły** — pokazujesz coś w kamerze i nazywasz (obiekt / gest /
  poza / scena); Cosmos zapisuje wzorzec (etykieta + opis + miniatura + embedding) i później
  rozpoznaje to na żywo w panelu kamery. Nauka przez przykład, lokalnie — nie zmienia wag
  modelu. Bez usługi zmysłów działa wariant na słowach kluczowych.
  Endpointy: `/api/lessons`, `/api/lessons/match`.
- [x] **Procedury (nauka czynności)** — budujesz czynność jako listę kroków (otwórz / kliknij /
  wpisz / odczytaj / poczekaj / potwierdź / notatka). Kroki **wrażliwe** (płatność, wysłanie,
  potwierdzenie) są oznaczane i **zawsze** wymagają Twojego kliknięcia w runnerze. Hasła/dane
  karty nie są zapisywane. Endpointy: `/api/procedures`. Nemotron może zaproponować
  uruchomienie procedury przez `[AKCJA: procedura | nazwa]`.
- [x] **Nagrywanie procedury z ekranu** — „🔴 Nagraj procedurę" otwiera przeglądarkę na
  maszynie z serwerem; Twoje kliknięcia, wpisywany tekst i nawigacja są zapisywane jako
  semantyczne kroki (stabilne selektory, nie współrzędne). Po „Zakończ" procedura zapisuje
  się i jest gotowa do odtworzenia oraz wyboru w rutynach. Hasła → krok „logowanie" z
  `{{secret:...}}`; przyciski „Zapłać/Wyślij" → automatycznie wrażliwe. Wymaga Playwright +
  ekranu (desktop, nie bezgłowy VPS). Endpointy: `/api/procedures/record/{start,stop,status}`.
- [x] **Rutyny (cykliczne odpalanie)** — harmonogram (codziennie / co tydzień / co miesiąc /
  co N minut) dla procedury. Scheduler na serwerze zgłasza, że nadszedł czas (nic
  nieodwracalnego nie dzieje się samo); interfejs proponuje uruchomienie z bramką
  potwierdzeń. Endpointy: `/api/routines`, `/api/routines/due`.
- [x] **Automatyczne odtwarzanie web — TYLKO DO ODCZYTU (Playwright)** — opcjonalny moduł
  `automation/runner.js`: Cosmos sam wykonuje kroki nie zmieniające stanu (open/wait/read/
  click) w prawdziwej przeglądarce i zwraca odczytane wartości. Twarda bramka: każdy krok
  wrażliwy lub zmieniający stan (type/confirm) jest odrzucany. Rutyny mają „tryb auto" dla
  procedur do odczytu. Endpointy: `/api/automation/status`, `/api/procedures/run-readonly`.
- [x] **Logowanie z menedżera haseł** — kroki „auth" (type/click) pobierają sekret przez
  `{{secret:nazwa}}` z Bitwarden / 1Password / pass / KeePassXC / env / własnego polecenia,
  w locie po stronie serwera (nigdy w procedurze ani w przeglądarce-kliencie). Dzięki temu
  auto-odczyt działa też za logowaniem. Endpoint: `/api/automation/status` (pole `secrets`).
- [x] **Eksport danych treningowych + przykład QLoRA** — Ustawienia → „Dane treningowe"
  eksportują rozmowy do JSONL (format chat lub instrukcje); `training/` zawiera gotowy
  skrypt QLoRA (Unsloth) i przewodnik, jak dotrenować własny model i wpiąć go z powrotem
  jako profil „Lokalnie" (przez Ollama/GGUF). Endpointy: `/api/train/dataset`, `/api/train/stats`.
- [x] **Przycisk „Dotrenuj" w aplikacji** — Ustawienia uruchamiają trening QLoRA lokalnie
  jednym kliknięciem: serwer wykrywa wymagania (Python/Ollama), odpala skrypt w tle
  z podglądem logu na żywo i po sukcesie sam rejestruje model w Ollamie (`ollama create`).
  Endpointy: `/api/train/env`, `/api/train/start`, `/api/train/status`, `/api/train/stop`.
- [ ] **Automatyczne odtwarzanie web ZMIENIAJĄCE STAN (płatność/wysłanie)** — świadomie
  odłożone: kroki wrażliwe (confirm/płatność) pozostają w ręcznym runnerze z bramką.
- [ ] **Automatyzacja aplikacji desktop** — świadomie odłożone: wymaga natywnej automatyzacji
  systemowej poza przeglądarką (osobne narzędzia/uprawnienia).


## ✅ Partia 8 — Teren, urządzenia i odprawa (GOTOWE)

- [x] **Analiza terenu z drona** — `senses/terrain.py`: nasłonecznienie (mapa godzin słońca
  w dniu), cień o konkretnej godzinie („sun scouting"), analiza widoku (viewshed), pomiar
  objętości/wysokości i porównanie dwóch skanów w czasie. Pozycja słońca liczona
  algorytmem NOAA offline; zapis PNG bez zewnętrznych bibliotek; `selftest` weryfikuje
  astronomię, kierunki cieni i objętość.
- [x] **Mostek do urządzeń (smart home)** — dowolny sprzęt sterowany przez HTTP
  (Home Assistant, Shelly, Hue, Tasmota) w Ustawieniach; model może zaproponować użycie
  przez `[AKCJA: urządzenie | nazwa]`, wykonanie zawsze za zgodą użytkownika.
  Endpointy: `/api/devices`, `/api/devices/run`.
- [x] **Poranna odprawa** — pogoda (open-meteo, bez klucza), kalendarz z pliku/adresu
  `.ics`, czekające rutyny i ostatnie zdarzenia; streszczenie modelem i czytanie na głos.
  Endpoint: `/api/briefing`. Konfiguracja: `BRIEFING_LAT`, `BRIEFING_LON`, `CALENDAR_ICS`.
- [ ] **Powiadomienia push (Web Push/VAPID)** — dziś powiadomienia działają przy otwartej
  aplikacji; tło wymaga kluczy VAPID i obsługi w service workerze.
- [ ] **Sceny urządzeń i reguły „powiadom, gdy…"** — rozszerzenia mostka i zdarzeń.


## ✅ Partia 9 — Samoświadomość i samodoskonalenie (GOTOWE)

- [x] **Manifest zdolności** — Cosmos wie, czym jest i co REALNIE potrafi w tej chwili:
  manifest generowany z żywego stanu (dostępne mózgi, zmysły online, klucze Studia, liczba
  rozmów/faktów/wzorców/procedur/rutyn/urządzeń, obecność modułów terenu i treningu) jest
  wstrzykiwany do kontekstu każdej rozmowy. Model nie obiecuje rzeczy niedostępnych —
  wymienia je wraz z instrukcją, jak je włączyć. Endpoint: `/api/capabilities`.
- [x] **Propozycje własnych zastosowań** — „✨ Co jeszcze możesz dla mnie zrobić?"
  (Nauka → Pomysły): model dostaje swój manifest, profil użytkownika, tematy ostatnich
  rozmów i zawartość bazy wiedzy, po czym proponuje konkretne, szyte na miarę zastosowania
  wraz z krokami wdrożenia. Endpoint: `/api/suggest`.
- [x] **Backlog usprawnień z akceptacją** — pomysły (własne i od modelu) trafiają na listę
  ze statusami nowy → zaakceptowany → zrobione. Model może zaproponować usprawnienie
  w rozmowie przez `[AKCJA: pomysł | opis]`, ale zapis następuje dopiero po Twoim
  kliknięciu. Endpoint: `/api/improvements`.
- [ ] **Automatyczne wdrażanie zaakceptowanych pomysłów** — świadomie odłożone: tworzenie
  procedur/rutyn z opisu wymaga precyzji, której nie chcemy zgadywać; dziś akceptacja
  oznacza wpis na listę, a wykonanie prowadzisz sam (często jednym poleceniem w czacie).


## ✅ Partia 10 — Narzędzia badawcze i sprzęt (GOTOWE)

- [x] **Walidacja nasłonecznienia** — `terrain.py validate`: porównanie mapy z pomiarem
  luksomierza, procent zgodności i oszacowanie światła rozproszonego z nieba.
- [x] **Komfort termiczny** — `terrain.py comfort`: nasłonecznienie + osłona od wiatru
  (model osłony liczony jak cień, ale „światłem" jest wiatr), osobne kryteria dla lata i zimy.
- [x] **Słuch przestrzenny** — `senses/soundloc.py`: kierunek źródła dźwięku z macierzy
  4 mikrofonów Kinecta (GCC-PHAT z ograniczeniem pasma i nadpróbkowaniem korelacji).
  Samotest odtwarza zadane kierunki z błędem 0,0° także przy SNR 10 dB.
- [x] **Planer lotu** — `senses/flightplan.py`: GSD, kadr, liczba zdjęć, czas i baterie;
  tryb `matrix` generuje macierz eksperymentu wysokość × pokrycie.
- [x] **Granica widzenia** — `senses/lowlight.py`: krzywa wykrywalności w funkcji luksów,
  pomiar jasności i szumu; `synth` generuje serię testową z szumem fotonowym.
- [x] **Głowica pan/tilt** — `senses/pantilt.py`: wzorce ruchu (gigapanorama wężykiem,
  motion timelapse, śledzenie obiektu z YOLO, skan 360°) + backendy sim/serial.
- [x] **Tethering aparatu** — `senses/tether.py`: focus stacking, bracketing HDR,
  zdjęcie wyzwalane zdarzeniem percepcji; przez gPhoto2, z jasnym komunikatem przy braku.
- [x] **Protokoły badawcze** — `docs/BADANIA.md`: dla każdego eksperymentu procedura,
  kryterium sukcesu i sposób zapisu wyników.
- [ ] **Backend `ronin`** — wymaga oficjalnego SDK DJI, którego nie można dołączyć do
  repozytorium; wzorce ruchu i punkt wejścia są gotowe, brakuje samego połączenia.


## ✅ Partia 11 — Embeddingi z chmury (GOTOWE)

- [x] **Embeddingi z chmury NVIDII jako zapas** — `EMBED_PROVIDER=auto` (domyślnie):
  najpierw zmysły (bge-m3 lokalnie, za darmo i prywatnie), a gdy komputer domowy jest
  wyłączony — darmowy endpoint NVIDII (`llama-nemotron-embed-1b-v2`, 26 języków z polskim).
  Dzięki temu wyszukiwanie semantyczne w bazie wiedzy działa w pełni także z VPS-a.
  Tryby: `auto` | `senses` | `nvidia` | `off`.
- [x] **Ochrona przed mieszaniem modeli** — każdy zapisany wektor jest znakowany modelem,
  który go policzył (`embModel`). Wektory z różnych modeli mają inny wymiar i znaczenie,
  więc nigdy nie są porównywane; niezgodne są wykrywane i **automatycznie przeliczane**
  (pamięć i wzorce od razu, fragmenty bazy wiedzy w tle, partiami po 40).
- [x] **Widoczność stanu** — aktywny dostawca embeddingów w `/api/status` i w manifeście
  zdolności; brak embeddingów zgłaszany razem z podpowiedzią, jak je włączyć.
- [x] **`input_type`** — modele wyszukiwawcze rozróżniają pytanie od dokumentu; Cosmos
  wysyła `query`/`passage`, a gdy model tego pola nie przyjmuje, ponawia bez niego.

---

## ✅ Partia 12 — dopracowanie po testach na telefonie (GOTOWE)

Nie planowana z góry — wynikła z używania Cosmosa na Androidzie i z Kinectem.

- [x] **Podgląd Kinecta w MJPEG** — jedno połączenie zamiast żądania na klatkę;
      wcześniej sam obieg telefon → VPS → dom zjadał ćwierć sekundy na klatkę
- [x] **Powiększanie podglądu** — panel na środku ekranu, szerokość ograniczona
      także wysokością okna, żeby przy 4:3 nie było czarnych pasów
- [x] **Wybór mikrofonu** — macierz Kinecta, słuchawki, telefon; z powrotem do
      domyślnego, gdy zapamiętane urządzenie zniknie
- [x] **Dopracowanie promptu** — `POST /api/polish` przepisuje podyktowany tekst;
      idzie tam sama treść pola, bez historii rozmowy
- [x] **Modele rozumujące** — `reasoning_content` pokazywany na żywo i używany,
      gdy model zużyje cały budżet na myślenie (to samo psuło streszczenia)
- [x] **Wyszukiwanie z treścią stron** — model dostaje tekst dwóch pierwszych
      trafień, nie same linki; dyrektywa `[SZUKAJ:]` nigdy nie trafia na ekran
- [x] **Zgodność z modelami rozumującymi OpenAI** — przy odmowie `max_tokens`
      /`temperature` serwer ponawia z `max_completion_tokens`
- [x] **Tryb głosowy bez niespodzianek** — kamera pod przyciskiem, nie sama;
      mikrofon trzymany przez sesję, żeby Android nie sygnalizował go w kółko
- [x] **Kamera przód/tył** — w zdjęciu do wiadomości i w podglądzie na żywo
- [x] **Panel boczny na telefonie** — stopka ze scrollem, lista rozmów z
      gwarantowanym minimum, przyciski rozmowy widoczne bez najechania

## ✅ Partia 13 — naprawy z realnego użycia (GOTOWE)

Wszystkie z konkretnego zgłoszenia albo z logu usługi zmysłów — żadna nie była
planowana z góry.

- [x] **Głos Pipera** — nowe API (1.3+) zwraca generator zamiast pisać do pliku
      wave; obsłużone trzy warianty API, bo wersje różnią się nieodwracalnie
- [x] **Whisper bez bibliotek CUDA** — przejście na procesor w miejscu, w którym
      błąd naprawdę wypada (pierwsze przeliczenie), nie przy ładowaniu modelu
- [x] **Błędy zmysłów jako JSON** — Starlette oddawał „Internal Server Error"
      zwykłym tekstem, a przeglądarka pokazywała komunikat o składni JSON
- [x] **Dyktowanie bez urywania** — Chrome kończy sesję po pauzie w mówieniu;
      nasłuch wznawia się aż do kliknięcia „stop"
- [x] **Czytanie długiego tekstu** — Chrome przerywa mowę po kilkunastu sekundach,
      więc tekst jest cięty po zdaniach i czytany kawałek po kawałku
- [x] **Kamera przód/tył** — `facingMode: exact`, bo `ideal` przeglądarka
      może zignorować; awaryjnie wybór drugiej kamery z listy urządzeń
- [x] **Panel boczny na telefonie** — jeden obszar przewijania zamiast dwóch
- [x] **Lista modeli na telefonie** — krótkie etykiety, identyfikator tylko tam,
      gdzie nazwy się powtarzają
- [x] **Reklamy wyszukiwarki odrzucane** — `duckduckgo.com/y.js?ad_domain=…`
      trafiały do odpowiedzi jako źródła i kończyły się stroną błędu
- [x] **Podgląd obrazu** — pełny ekran z pobieraniem, otwierany kliknięciem
- [x] **Pierwsza klatka wideo** — wybór trwały, wcześniej znikał po pierwszym
      otwarciu Studia
- [x] **Licznik czekania** — model rozumujący potrafi milczeć kilkadziesiąt
      sekund, a pusty dymek wyglądał jak zawieszenie
- [x] **Klikalne gołe adresy** — źródła podawane bez składni markdown
- [x] **Odczyt odpowiedzi modelu** — strumień mimo `stream: false` i sklejone
      obiekty JSON; przy nieczytelnej odpowiedzi widać jej początek i status
- [x] **Model z Ustawień w funkcjach pomocniczych** — dopracowanie promptu
      i streszczenie szły do modelu z `.env`, nie do wybranego; przy nieaktualnym
      wpisie dawało to 404, choć sam czat działał

## ✅ Partia 14 — tryb głosowy i kamera na telefonie (GOTOWE)

- [x] **Jeden rozpoznawacz mowy na sesję** — zamiast tworzenia nowego przy każdym
      przejściu nasłuch → pytanie → odpowiedź. Każde przejęcie mikrofonu Android
      sygnalizuje dźwiękiem; teraz zdarza się raz, nie przy każdym zdaniu
- [x] **Cofnięcie trzymania mikrofonu** — próba wyciszenia tych sygnałów przez
      otwarty strumień `getUserMedia` odbierała mikrofon rozpoznawaniu mowy
      i tryb głosowy przestawał cokolwiek słyszeć
- [x] **Przełączanie kamery** — najpierw zwolnij stary obiektyw, potem otwórz nowy;
      telefon obsługuje jeden naraz i inaczej odpowiada „Could not start video source"
- [x] **Przycisk przełączania kamery** — przeniesiony obok zamknięcia (wcześniej
      `space-between` wypychał go na środek nagłówka) i czytelna ikona dwóch strzałek

## ✅ Partia 15 — zdjęcia trafiają tam, gdzie ktoś je odczyta (GOTOWE)

- [x] **Kierowanie zdjęć do modelu wizyjnego** — decyduje to, czy WYBRANY model
      umie patrzeć, a nie to, czy użytkownik czegokolwiek nie wybrał. Wcześniej
      podmiana działała wyłącznie przy pustym polu modelu, czyli prawie nigdy
- [x] **Katalog modeli wspólny z serwerem** — `public/models.js` eksportuje się
      i dla przeglądarki, i dla Node; jedno miejsce wiedzy o tym, co widzi obrazy
- [x] **Uczciwość wobec użytkownika** — pod odpowiedzią widać, że na zdjęcie
      odpowiedział inny model niż wybrany (nagłówek `X-Cosmos-Model`)
- [x] **Czytelna odmowa zamiast bezużytecznej odpowiedzi** — bez modelu wizyjnego
      żądanie ze zdjęciem jest zatrzymywane z wyjaśnieniem, co ustawić
- [x] **Modele spoza katalogu** — gdy dostawca odrzuci obraz błędem 400, komunikat
      mówi to samo, co przy modelach znanych, zamiast „Błąd modelu (HTTP 400)"
- [x] **Zdjęcie z aparatu w Galerii** — trafia i do wiadomości, i do bazy wiedzy;
      wcześniej po wysłaniu nie dało się do niego wrócić ani go pobrać

## ✅ Partia 16 — wiadomo, który model działa (GOTOWE)

Problem: lista modeli u dostawcy pokazuje **wszystko, co dostawca hostuje**, a nie
to, do czego Twój klucz ma dostęp. Katalog opisów też tylko zgaduje po nazwie, czy
model widzi obrazy. Skutek: wybór modelu był losowaniem, a odpowiedź „Function …
Not found for account" przychodziła dopiero po wysłaniu pytania.

- [x] **`POST /api/models/check`** — dwie najtańsze możliwe sondy (`max_tokens: 1`):
      jedna tekstowa, jedna z obrazkiem 1×1. Zwraca `{rozmowa, obrazy, blad,
      podpowiedz}`. Wzrok sprawdzany tylko wtedy, gdy rozmowa działa — inaczej
      dublowalibyśmy ten sam błąd dostępu i obciążali limit
- [x] **Przycisk „Sprawdź"** obok pola modelu — natychmiastowa odpowiedź o modelu,
      który właśnie rozważasz
- [x] **„Sprawdź wszystkie z listy"** — przechodzi całą listę **po kolei** (nie
      równolegle, bo dostawca odrzuciłby nas za nadmiar żądań) i oznacza pozycje:
      `✗` niedostępny, `✓` rozmawia, `👁` rozmawia i czyta obrazy; na końcu
      podsumowanie „Działa N z M"
- [x] **Podpowiedź zamiast samego kodu błędu** — lokalny 404 podaje gotową komendę
      `ollama pull <model>`, chmurowy tłumaczy, że rzecz jest w uprawnieniach konta,
      a nie w Cosmosie
- [x] **Limity czasu na wszystkich żądaniach wychodzących** — pobieranie grafiki
      z odpowiedzi dostawcy i token Firefly potrafiły wisieć bez końca
- [x] **„📋 Kopiuj wynik"** — przy stu pozycjach nikt nie przepisze listy ręcznie,
      a znaczki w wybieraku znikają po odświeżeniu strony. Raport dzieli modele
      na trzy grupy i zachowuje powód odmowy. Droga zapasowa przez ukryte pole
      tekstowe, bo na starym WebView Androida `navigator.clipboard` nie istnieje
- [x] **`scripts/sprawdz-modele.sh`** — to samo z wiersza poleceń, gdy wynik ma
      trafić do pliku. Hasło czyta z `.env` i podaje wejściem standardowym:
      w historii poleceń nie zostaje, w `ps` też nie widać

## ✅ Partia 17 — poprawki z pierwszego prawdziwego przebiegu (GOTOWE)

Pierwszy przebieg „Sprawdź wszystkie" na koncie Marcina (102 modele) pokazał
trzy błędy w moim własnym sprawdzaniu i potwierdził dwa problemy w interfejsie.

- [x] **Identyfikator konta nie wychodzi z serwera** — NVIDIA wpisuje go
      w odmowę („Not found for account '…'"), a przycisk kopiowania wrzucał
      całość do schowka. `scrubSecrets()` czyści też komunikaty w czacie, bo
      stamtąd trafiały na zrzuty ekranu
- [x] **Zimny start ≠ brak dostępu** — 13 modeli (w tym llama-3.3-70b) było
      raportowanych jako niedostępne tylko dlatego, że nie zdążyły odpowiedzieć
      w 30 s. Limit podniesiony do 75 s, jedna ponowna próba, a wynik trafia do
      osobnej kategorii `⏳` zamiast do worka „niedostępne"
- [x] **Embeddingi, OCR i przeszukiwanie mają własną kategorię `⚙`** — nie mają
      końcówki `/chat/completions`, więc odpowiadały „404 page not found”, co
      wyglądało na brak dostępu. Cosmos sam z nich korzysta (baza wiedzy).
      Nie są już nawet odpytywane
- [x] **Katalog opisów uzupełniony o wszystkie 26 działających modeli** —
      z polskimi opisami i zgodnością wzroku sprawdzoną wobec pomiaru, nie
      wobec nazwy
- [x] **Lista mikrofonów wystawała poza okno** — nazwy urządzeń Bluetooth mają
      po 80 znaków, a `select` w wierszu flex nie miał `min-width: 0`; na
      telefonie wychodził 497 px poza ramkę
- [x] **Strzałki wybieraków tuż przy obrysie** — własna strzałka rysowana
      gradientami, z odstępem, jednakowa w Ustawieniach, Studiu i Nauce
- [x] **Pole godziny białe w ciemnym motywie** — brakowało `color-scheme`,
      więc przeglądarka rysowała własną kontrolkę w jasnym schemacie

## ✅ Partia 18 — audyt, który nie krzyczy na wilka (GOTOWE)

Pełny przegląd wykazał trzy „problemy”, z których **wszystkie trzy okazały się
wadami samego audytu**, nie kodu. Skrypt, który przy każdym przebiegu podaje
fałszywe alarmy, przestaje być użyteczny — więc najpierw naprawiliśmy narzędzie.

- [x] **`scripts/audyt.js`** — dwanaście kontroli statycznych w repozytorium,
      nie w plikach tymczasowych; kod wyjścia 0 znaczy „zero problemów”
- [x] **Cztery fałszywe alarmy usunięte** — ścieżki będące fragmentem adresu URL,
      przykłady składni w cudzysłowach odwrotnych, ścieżki względne kontra
      bezwzględne w cache service workera, oraz liczenie limitów czasu zamiast
      patrzenia w kontekst wywołania
- [x] **Zmienne zmysłów sprawdzane wobec `senses/README.md`** — chodzą na innej
      maszynie niż serwer i mają własną konfigurację
- [x] **Trzy prawdziwe luki w tłumaczeniach** znalezione przy okazji: potwierdzenie
      usunięcia z bazy wiedzy miało gotowe tłumaczenie, którego kod nie używał;
      „Błąd HTTP" był wpisany po polsku na sztywno; skróty dni tygodnia
      („Nd Pn Wt Śr") widział też użytkownik anglojęzyczny
- [x] **`blind-check.js` i `tabs-check.js` stawiają własny serwer** — wymagały
      innej konfiguracji niż reszta baterii i padały przy każdym pełnym przebiegu
      z powodu atrap, nie kodu
- [x] **`vision_test.js` używa identyfikatora spoza katalogu** — po dopisaniu
      modeli Meta do katalogu jego dotychczasowy przypadek testowy przestał
      badać to, co miał badać (Cosmos zaczął go poprawnie przekierowywać)

## ✅ Partia 19 — łatanie słabości (GOTOWE)

Trzy rzeczy, które sam wskazałem jako słabe strony przy ocenie Cosmosa.

**1. Testy w repozytorium.** 24 zestawy żyły w katalogu tymczasowym sesji —
gdyby przepadł, przepadłaby cała sieć bezpieczeństwa. Teraz `npm test`:
39 zestawów + 9 selftestów Pythona, każdy z własnym serwerem, portem
i świeżym katalogiem danych. Szczegóły: `tests/README.md`.

**2. Podział serwera na moduły.** 3729 → 2217 linii; siedem modułów w `lib/`.
Zależności były wyliczane, nie zgadywane. Ujawniło to dwie pułapki:
kolekcje podmieniane przy usuwaniu (`x = x.filter(...)`) muszą wychodzić
jako funkcje odczytujące, a `DATA_DIR` musiał trafić do rdzenia, bo moduły
liczą z niego ścieżki już w chwili wczytania.

**3. Funkcje bez odbiorcy — podłączone.**
- [x] **Kanał zdarzeń od serwera do okna** (`GET /api/events/stream`, SSE).
      Dotąd przeglądarka tylko WYSYŁAŁA zdarzenia; „Hej, Kosmos" wykryte
      przez `senses/wake_listener.py` na domowym komputerze umierało w logu.
      Teraz otwiera tryb głosowy na telefonie — z przełącznikiem
      w Ustawieniach, bo mikrofon włączający się bez kliknięcia to
      niespodzianka, na którą trzeba się zgodzić
- [x] **`/api/pose` ma odbiorcę** — postawa człowieka doklejona do pętli
      detekcji (gotowa klatka, pytanie co ~3 s, bo postawa zmienia się wolno);
      widać ją w panelu i trafia do kontekstu rozmowy
- [x] **Mignięcie o zdarzeniu** — czujnik, kamera, urządzenie albo rutyna
      dają znać w oknie, nie tylko w dzienniku serwera

**Audyt zyskał rozruch próbny.** Statyczna analiza przepuściła odwołanie do
`events.length` po wydzieleniu modułu zdarzeń — regex nie miał szans. Audyt
uruchamia teraz serwer i puka we wszystkie 33 trasy GET; 500 to wywrotka,
502 to poprawna odpowiedź „usługa poniżej nie działa". Tak wyszedł
`rutyny is not defined` w porannej odprawie.

**Bateria wyłapała po drodze pięć regresji z refaktoru** — dokładnie po to
powstała. A dwukrotnie okazało się, że sam fundament testów kłamie: stary
serwer i stara atrapa z poprzedniego przebiegu odpowiadały nowym testom.
Teraz zajęty port jest sprzątany albo zgłaszany, nigdy przemilczany.

## ✅ Partia 20 — płynność (GOTOWE)

„Żeby używanie Cosmosa sprawiało przyjemność". Zaczęliśmy od pomiaru, nie od
przeczuć — i pomiar wskazał co innego, niż się spodziewałem.

- [x] **Pamięć nie blokuje rozmowy** — największy hamulec. `searchMemory`
      czekało do 5 s na embedding zapytania, a gdy wpisy miały wektory
      z innego modelu, doliczało przeliczenie WSZYSTKICH z limitem 60 s.
      Wszystko w ścieżce żądania, zanim model dostał prompt.
      Zmierzone: **5,1 s ciszy przed każdą wiadomością**. Po poprawce
      (budżet 1,2 s + przeliczanie w tle + bezpiecznik): **0,0 s**
- [x] **To samo w rozpoznawaniu z kamery** — `matchLessons` leci z pętli
      detekcji kilka razy na sekundę; 5 s czekania zamrażało podgląd
- [x] **Budżety wyszukiwania** — 12 s + 7 s dawało do 57 s przy trzech
      rundach; teraz 8 s + 5 s
- [x] **`scripts/plynnosc.js`** — pomiar czasu do pierwszego znaku, tempa
      pisania i całości, per model, z oceną „nadaje się do rozmowy / do zadań
      w tle". Mediana z trzech prób, bez pamięci i manifestu
- [x] **Sprawdzone, czego NIE trzeba ruszać** — narzut własny serwera to 8 ms,
      a przemalowanie dymka przy 20 tys. znaków 7,8 ms (budżet klatki: 16 ms).
      Zmierzone zamiast „zoptymalizowane na wszelki wypadek"

**Trzy błędy wyszły przy okazji, wszystkie z podziału na moduły:**
`addEvent` niezaimportowane w wyszukiwaniu (i opisane jako „sprawdź
połączenie z internetem"), `modelInfo` niezaimportowane w `blindToImages` —
połknięte przez `try/catch`, przez co **każdy model wyglądał na widzący**,
oraz trzy testy skrobiące źródło regexem zamiast importować.

**Audyt widzi teraz błędy ukryte w HTTP 200** — `addEvent is not defined`
przechodził jako poprawna odpowiedź z komunikatem w treści. Trasy wymagające
parametru dostają go, bo inaczej kończyły się na walidacji, nie dochodząc do
właściwego kodu.

## ✅ Partia 21 — pomiar, który nie kłamie (GOTOWE)

Pierwszy przebieg `plynnosc.js` na żywym koncie ujawnił, że **narzędzie jest
niewiarygodne**: dwa uruchomienia pod rząd wskazały zupełnie inne modele jako
najlepsze. `nemotron-3-super-120b` raz 0,5 s (`✦`), raz 5,8 s (`✗`).
`mistral-nemotron` raz 0,4 s, raz brak odpowiedzi w 120 s.

- [x] **Wszystkie próby, nie do pierwszego błędu** — jedna wpadka przerywała
      pomiar i model dostawał ocenę zależną od tego, w którą sekundę trafiliśmy
- [x] **Ocena uwzględnia niezawodność** — model odpowiadający raz na trzy
      próby nie jest „znakomity", choćby robił to w 0,1 s. Lista sortuje się
      najpierw po liczbie udanych prób
- [x] **Modele rozumujące przestały być „pustą odpowiedzią"** — przy 160
      tokenach cały budżet szedł na myślenie. Limit podniesiony do 700,
      a sam tok myślenia liczy się jako widoczna aktywność
- [x] **Widać rozrzut** — `2/3` przy pozycji i ostrzeżenie `⚡do X s`, gdy
      najgorsza próba jest trzykrotnie wolniejsza od mediany
- [x] **Osobna sekcja „odpowiadają, ale nie zawsze"** — bo to nie to samo,
      co „nie działa"

**Audyt: po podziale na moduły przestał widzieć `process.env` w `lib/`** —
na serwerze Marcina wypisał 24 poprawne zmienne jako martwe. Skanuje teraz
cały kod serwerowy, nie tylko `server.js`.

## ✅ Partia 22 — pomiar znosi rzeczywistość (GOTOWE)

Trzeci przebieg był już spójny, ale pokazał trzy rzeczy, które psuły samo
używanie narzędzia — nie liczby, tylko robotę wokół nich.

- [x] **Koniec paska postępu** — pasek pisał po `stderr` „tylko gdy to terminal",
      a na terminalu Marcina `stderr` **jest** terminalem, więc nazwa modelu
      wsiąkała w tabelę i zostawiała ~20 pustych linii. Pasek zniknął całkiem:
      tabela rośnie wiersz po wierszu i to wystarcza za postęp
- [x] **Myślenie osobno od odpowiedzi** — kolumny `ruch` (pierwszy znak
      czegokolwiek) i `treść` (pierwsze słowo odpowiedzi) rozjeżdżają się przy
      modelach rozumujących nawet dziesięciokrotnie. Ocena patrzy na `treść`,
      bo to na nią czeka człowiek, a znacznik `🧠myśli X s` mówi, dlaczego
- [x] **Wynik przeżywa zerwane SSH** — czwarty przebieg Marcina zginął na
      `client_loop: send disconnect` po ~40 modelach i nie zostało nic. Każdy
      wiersz leci od razu do `PLYNNOSC_PLIK` (domyślnie
      `/tmp/plynnosc-ostatni.txt`), a nagłówek skryptu podaje wariant z `nohup`
- [x] **Domyślne modele dobrane po czasie całości, nie po pierwszym znaku** —
      `llama-3.3-nemotron-super-49b-v1` rusza w 0,3 s, ale kończy w 4,7 s,
      bo długo myśli. `nemotron-3-ultra-550b-a55b` rusza w 0,6 s i kończy
      w 3,1 s — przy 550 mld parametrów. To on jest teraz domyślny
- [x] **Trzy „puste odpowiedzi" z drugiego przebiegu to była nasza usterka** —
      `ultra-550b`, `nano-omni` i `nano-9b-v2` przy 700 tokenach robią 3/3
      i siedzą w czołówce. README mówi to wprost, żeby nikt (łącznie ze mną)
      nie odziedziczył błędnego wniosku

## ✅ Partia 23 — ranking przestał polecać klasyfikatory (GOTOWE)

Pierwszy pełny przebieg, który dobiegł końca (103 modele, przez `nohup`),
pokazał, że tabela jest już wiarygodna, ale **podpowiedź pod nią prowadzi
prosto w maliny**.

- [x] **Klasyfikatory bezpieczeństwa wypadły z „najlepszych do rozmowy"** —
      `nemoguard`, `safety-guard`, `topic-control` odsyłają słowo „safe"
      w 0,1 s, więc wygrywały każdy wyścig na szybkość i zajmowały trzy
      z sześciu miejsc na podium. Kto by posłuchał, ustawiłby sobie jako
      główny model coś, co umie odpowiedzieć wyłącznie „bezpieczne /
      niebezpieczne". Nowa kategoria `modelNotAChatPartner()` obejmuje też
      tłumaczy (`riva-translate`) i modele badawcze (`ising-calibration`)
- [x] **Nie znikają po cichu** — trafiają do sekcji „poza rankingiem"
      z wyjaśnieniem, a w tabeli dostają dopisek `⚙ nie rozmówca`. Pytanie
      „gdzie się podział mój najszybszy model" ma odpowiedź w tym samym
      wydruku
- [x] **Ranking liczy się po całości odpowiedzi, nie po pierwszym znaku** —
      ocena patrzyła już na treść, sortowanie nie. `super-120b` dostawał `✦`
      przy 1,2 s całości i wypadał poza szóstkę, przegrywając z modelami,
      które ruszały wcześniej, a kończyły siedmiokrotnie później
- [x] **Model, który raz nie odpowiedział, przestał być liczony dwa razy** —
      wcześniej trafiał i na listę „nierównych", i na „męczące"
- [x] **`genrm` dopisane do modeli bez końcówki czatu** — generatywne modele
      oceny odpowiedzi nie są rozmówcami

**Sprostowanie do własnego uzasadnienia.** Odradzałem `super-120b` jako
„szybki, ale nieprzewidywalny", powołując się na jego 6,9 s. Ten pomiar
pochodził jednak sprzed podniesienia limitu do 700 tokenów — model spalał
budżet na myślenie, więc **nie był porównywalny z resztą i nie powinien był
trafić do uzasadnienia**. Trzy porównywalne przebiegi dają: super 4,4 · 1,2 ·
1,3 s, ultra 3,1 · 2,5 · 3,6 s. Super jest przeciętnie ponad dwa razy
szybszy; ultra bardziej przewidywalny i ma 55 mld aktywnych parametrów wobec
12 mld, co po polsku słychać. Ultra zostaje domyślny **dla jakości języka,
nie dla równości** — a README pokazuje teraz oba przebiegi obok siebie
i podaje jedną linijkę do przełączenia, zamiast rozstrzygać za czytelnika.

## ✅ Partia 24 — Cosmos wie, który dziś i gdzie jesteś (GOTOWE)

Prawdziwa rozmowa („znajdź, gdzie naprawię klimatyzację w okolicy") pokazała
trzy luki naraz. Wszystkie były w tym, co Cosmos **mówi** modelowi — nie
w modelu.

- [x] **Data i godzina w każdej rozmowie** — dotąd nie było ich w promptcie
      w ogóle. Model zna świat do końca swojego treningu, więc na „co dziś?"
      nie odpowiadał „nie wiem", tylko podawał konkretną złą datę. Strefa
      z `COSMOS_TZ` (domyślnie `Europe/Warsaw`), bo serwer stoi w UTC
- [x] **Lokalizacja domowa** — nowe pole w Ustawieniach plus przycisk
      **📍 Wykryj**: przeglądarka podaje współrzędne, serwer zamienia je na
      nazwę miejscowości. Zamiana idzie **przez Cosmos, nie przez
      przeglądarkę** — telefon nie łączy się z obcym hostem, a my podajemy
      uczciwy User-Agent, którego Nominatim wymaga. `GEOCODE_URL=off`
      wyłącza to całkiem, wpisać ręcznie można zawsze
- [x] **Instrukcja wyszukiwania przewiduje „brakuje mi jednej informacji"** —
      dotąd mówiła tylko „gdy pytanie wymaga aktualnych danych, dodaj
      `[SZUKAJ:]`". Przy pytaniu o coś w okolicy bez znanego miasta model
      kręcił się w kółko przez **cztery ekrany toku myślenia**: „mam szukać
      czy zapytać? instrukcja każe szukać, ale nie mam czego". Teraz wie, że
      dopytanie jednym zdaniem to poprawne zachowanie, nie złamanie zasady
- [x] **Koniec odpowiedzi typu „oto lista katalogów"** — na pytanie
      o warsztat wyszukiwarka zwróciła same agregatory (Fixly, Cylex, PKT),
      a model uczciwie je wypisał. Uczciwie, ale bezużytecznie — to samo dałby
      Google. Prompt każe teraz podać konkretne firmy z adresem i telefonem,
      a gdy w wynikach są wyłącznie katalogi — powiedzieć to wprost
- [x] **Atrapa, która oddaje wiadomości systemowe jako treść** — zestaw
      sprawdza, co model NAPRAWDĘ widzi, zamiast wnioskować z kodu serwera.
      Osiem sprawdzeń, zweryfikowane przez cofnięcie poprawki

**Rozpoznawanie zdjęć potwierdzone na żywym zdjęciu.** Puszka Pringles
Buffalo Wings na stole piknikowym, osoba w tle: model trafił markę, smak,
rodzaj stołu, kolor koszulki, kierunek spojrzenia i otoczenie. Zadziałało
też automatyczne przełączenie — `ultra-550b` nie widzi obrazów, więc zdjęcie
poszło do `nano-omni` i Cosmos o tym powiedział. Jedyny błąd był językowy:
model nazwał puszkę „słońceżerką", słowem, które nie istnieje. To ograniczenie
`nano-omni` (3 mld aktywnych parametrów), nie usterka Cosmosa — do sprawdzenia
`nemotron-nano-12b-v2-vl`, który ma 12 mld i w pomiarze jest równie szybki.

## ✅ Partia 25 — zdjęcia z internetu i koniec czekania na uśpiony komputer (GOTOWE)

- [x] **Wyszukiwanie grafik `[GRAFIKA:]`** — Cosmos umiał obraz WYGENEROWAĆ,
      ale nie umiał żadnego ZNALEŹĆ. Na „poproszę zdjęcia tych miejsc" model
      odpowiadał uczciwie „nie mam dostępu do wyszukiwania obrazów"
      i proponował wizje artystyczne zamiast prawdziwej Majorki. Teraz szuka
      naprawdę, kilka zapytań naraz (`[GRAFIKA: Katedra; plaża; wioska]`),
      równolegle
- [x] **Prompt rozróżnia „znajdź" od „wygeneruj"** — bez tego model traktował
      prośbę o zdjęcia jako zamówienie na rysunek
- [x] **Miniatury przez serwer, nie prosto z cudzego CDN-u** — telefon nie
      łączy się z obcym hostem przy każdym wyniku. Proxy jest wąskie:
      tylko https, tylko znane hosty, tylko treść będąca obrazem, z limitem
      rozmiaru. Trzy sprawdzenia w baterii pilnują, żeby nie dało się przez
      nie zajrzeć w sieć lokalną serwera
- [x] **Każdy kafelek prowadzi do źródła** — zdjęcie z internetu bez źródła
      jest bezwartościowe

**Znaleziona przy okazji sekunda i pół na każdej wiadomości.** Stan zmysłów
był odpytywany co minutę, a manifest zdolności — czekający na ten fetch —
jest awaitowany PRZED wysłaniem pytania do modelu. Komputer domowy bywa
wyłączony, więc raz na minutę pierwsza wiadomość płaciła **1,5 s ciszy**,
zanim model w ogóle dostał pytanie. Odświeżanie poszło w tło, tak jak
wcześniej pamięć długotrwała: **1510 ms → 7 ms**, zmierzone w obie strony.

Zasada jest już trzecia z rzędu ta sama i warto ją zapisać wprost:
**nic, co jest tylko dodatkiem do odpowiedzi, nie może wstrzymywać samej
odpowiedzi.** Dotyczyło to pamięci, embeddingów, a teraz manifestu.

**Domyślny model to teraz `super-120b`, nie `ultra-550b`** — trzy przebiegi
dały super 4,4 · 1,2 · 1,3 s wobec ultra 3,1 · 2,5 · 3,6 s. Przeciętnie ponad
dwa razy szybciej, a różnicę w polszczyźnie widać dopiero w dłuższych
tekstach. Do pisania scenariuszy zostaje Ultra, do rozmowy Super.

## ✅ Partia 26 — Cosmos czyta dokumenty (GOTOWE)

Pierwszy krok programu „ma umieć to, co ChatGPT i Claude". Największa dziura
była tutaj: **wczytanie umowy z telefonu nie działało nigdy.**

Kod do wyciągania tekstu z PDF-ów i Office'a istniał, ale siedział w usłudze
zmysłów na komputerze domowym — a ten komputer zwykle jest wyłączony.

- [x] **Czytniki w Node, bez ani jednej zewnętrznej biblioteki** —
      `lib/dokumenty.js`. DOCX, XLSX i PPTX to archiwa ZIP z XML-em w środku,
      a ZIP-a rozpakuje `zlib` ze standardowej biblioteki. PDF: strumienie
      FlateDecode i operatory `Tj`/`TJ`
- [x] **Zmysły zostały jako zapas, nie jako warunek** — najpierw próbuje sam
      serwer, do zmysłów idą tylko skany (OCR) i formaty, których nie umiemy
      (`doc`, `xls`, `odt`)
- [x] **Załącznik do rozmowy, nie tylko do bazy wiedzy** — spinacz przyjmuje
      teraz dokumenty. Na ekranie kafelek „umowa.pdf · 8 412 znaków",
      do modelu pełna treść w wyraźnej ramce. Kliknięcie kafelka pokazuje,
      co dokładnie model dostał — bez tego „wczytałem plik" trzeba brać
      na wiarę

Trzy pułapki, które wyszły dopiero na próbnych plikach:

- **Tabela w DOCX rozsypywała się na pionowy słupek.** Komórka zawiera akapit,
  więc zamiana `</w:p>` na nowy wiersz przed obsługą `</w:tc>` rozbijała każdą
  komórkę na osobną linię. Kolejność podmian ma tu znaczenie.
- **W PDF-ie słowa się skleiły** — „Sprzedawca:Marcin". Odstępy między słowami
  PDF robi liczbami w `[(a) -300 (b)] TJ`, a nie spacjami. Wartości poniżej
  −100 tysięcznych firetu to teraz spacja.
- **Krótka faktura była brana za skan** i szła niepotrzebnie do OCR. Skanu nie
  poznaje się po długości tekstu, tylko po proporcji: setki kilobajtów na
  stronę przy zerowej treści.

## ✅ Partia 27 — narzędzia dobierane pod model (GOTOWE)

Drugi krok programu. Załatwia dwie rzeczy naraz — „możliwości per model"
i „ma być szybciej" — bo to okazał się ten sam problem.

**Zmierzone:** każdy model dostawał ten sam prompt systemowy na **1351
tokenów**, zanim użytkownik napisał słowo. Także model 4-miliardowy, który
żadnego z opisanych narzędzi nie umie użyć — a znacznik `[SZUKAJ:]`
wypisałby wprost na ekran.

| Poziom | Kto | Prompt |
|---|---|---|
| `pelny` | model z cechą „narzędzia" **oraz każdy nieznany** | 1351 tok. |
| `zwiezly` | znany model bez tej cechy | **442 tok.** (−67%) |
| `rozmowa` | mały i szybki, bez rozumowania | **142 tok.** (−89%) |

- [x] **Duże modele nie tracą nic** — to nie jest oszczędzanie na jakości.
      Osobne sprawdzenie pilnuje, że pełny poziom nadal ma wyszukiwanie,
      grafiki, regułę o brakującym mieście, datę i manifest
- [x] **Średni poziom SKRACA, nie odbiera** — `[SZUKAJ:]` i `[GRAFIKA:]`
      zostają, znika rozwlekły opis niuansów
- [x] **Model nieznany dostaje pełny zestaw** — ta sama zasada, co przy
      wzroku: lepiej dać możliwość czemuś, czego nie znamy, niż odebrać ją
      po cichu na podstawie domysłu z nazwy
- [x] **Widać to w Ustawieniach** — przy wyborze modelu pojawia się
      wyjaśnienie „narzędzia skrócone" albo „bez narzędzi". Niewidoczna
      zmiana zachowania byłaby pułapką: „czemu mały model nie umie szukać"
      nie miałoby odpowiedzi
- [x] **Data i miejsce zostają na każdym poziomie** — to fakty o świecie,
      nie narzędzia

## ✅ Partia 28 — liczenie na danych (GOTOWE)

Trzeci krok programu, odpowiednik „Code Interpreter". Model pisze program
w bloku ```` ```uruchom ````, Cosmos go wykonuje i oddaje wyjście z powrotem
do rozmowy. Na „ile wyszło razem w tym arkuszu" dostajesz **liczbę policzoną,
nie oszacowaną** — a czas wykonania jest widoczny, żeby było wiadomo, że
program naprawdę się wykonał.

- [x] **Program widzi załączniki rozmowy jako pliki** — `fs.readFileSync('dane.csv')`
      działa wprost. To domyka partię 26: wczytany arkusz można teraz policzyć,
      a nie tylko przeczytać
- [x] **Wykres jako czysty SVG** — zapisany `wykres.svg` pokazuje się w rozmowie.
      Wstawiany jako `<img src="data:...">`, nie przez `innerHTML`: program
      pisze model, więc jego wyjście jest treścią niezaufaną
- [x] **Tylko dla modeli poziomu „pełny"** — mniejszy model i tak nie napisze
      poprawnego programu, a blok kodu wypisany w rozmowie zamiast wykonania
      jest gorszy niż brak narzędzia

**Czym to NIE jest.** Nie piaskownicą. Model uprawnień Node blokuje pliki
serwera i podprocesy — i bateria to sprawdza — ale **sieci nie obejmuje**.
Dlatego liczy się to, co da się zagwarantować:

| Granica | Sprawdzenie w baterii |
|---|---|
| pliki serwera (`/etc/passwd`) | `ERR_ACCESS_DENIED` |
| zapis poza katalogiem roboczym | `ERR_ACCESS_DENIED` |
| podprocesy (`child_process`) | `ERR_ACCESS_DENIED` |
| **klucze API** | do procesu trafia wyłącznie `PATH` |
| nieskończona pętla | ubita po 10 s |

Najważniejszy z tych wierszy to klucze: `NVIDIA_API_KEY` siedzi w zmiennych
środowiskowych, a program pisze model. Do procesu potomnego nie trafia nic
poza `PATH`, i osobne sprawdzenie próbuje ten klucz stamtąd wyciągnąć.

Całość wyłącza `CODE_EXEC=off`.

## ✅ Partia 29 — płótno (GOTOWE)

Czwarty krok programu, odpowiednik Canvas/Artifacts. Dłuższy tekst —
scenariusz, opis filmu, plan zdjęć — trafia do panelu obok rozmowy, a nie
w strumień czatu. Dla twórcy wideo to teksty, które się **redaguje**, a nie
czyta raz.

- [x] **Poprawki fragmentami, nie przepisywanie całości** — to jest cała
      wartość tej partii. Model podaje blok `SZUKAJ`/`ZAMIEŃ` zamiast trzech
      tysięcy słów od nowa: sekunda zamiast minuty i nic nie gubi się po drodze
- [x] **Dwuznaczny fragment jest ODRZUCANY** — gdy szukany tekst występuje
      dwa razy, nie wiadomo, który model miał na myśli. Cicha podmiana
      pierwszego z brzegu potrafi zepsuć dokument tak, że nikt tego nie
      zauważy, a to jest tekst, nad którym ktoś pracuje godzinami
- [x] **Można pisać ręcznie** — a bieżąca treść idzie do modelu przy każdej
      wiadomości jako osobna wiadomość systemowa. Bez tego model przy
      następnej poprawce szukałby fragmentu, który użytkownik zdążył już
      zmienić
- [x] **Płótno należy do rozmowy** — przy przełączeniu znika, żeby przy nowej
      rozmowie nie został na ekranie cudzy dokument
- [x] **Na telefonie pełny ekran** — panel na 46% szerokości przy 360 px dawał
      kolumnę, w której nie da się przeczytać zdania
- [x] **Zapis z opóźnieniem** — pisanie w płótnie słałoby inaczej kilkanaście
      żądań na sekundę

Płótno, jak liczenie na danych, dostają tylko modele poziomu „pełny".

## ✅ Partia 30 — asystent planu zdjęciowego (GOTOWE)

**Pierwszy wyróżnik: to, czego nie zrobi żaden asystent w chmurze.** ChatGPT
nie wie, gdzie stoisz, która jest u Ciebie godzina ani jaki masz sprzęt —
więc na „jakie ustawienia" odpowiada ogólnikami o złotej godzinie. Cosmos zna
wszystko troje i podaje liczby.

- [x] **Pozycja Słońca liczona, nie zgadywana** — `lib/slonce.js`, algorytm
      NOAA, bez bibliotek (zamknięty wzór, nie długi ogon). Do zdjęć liczy się
      nie „która godzina", tylko jak wysoko stoi Słońce: ta sama 18:00
      w czerwcu i w grudniu to różnica sześciu działek
- [x] **Kadr poziomo czy pionowo** — rozpoznawany z proporcji podglądu
      (9:16, 16:9, 4:3…), tak jak prosiłeś
- [x] **Czas, przysłona, ISO pod konkretny sprzęt** — profile Canona R6 II,
      Mavica 3 i telefonu. Wideo ma czas ZABLOKOWANY regułą 180°; ustępuje
      przysłona i ISO, nigdy płynność ruchu
- [x] **Druga baza wzmocnienia** — R6 II przy ISO 800 szumi MNIEJ niż przy
      640. Cosmos to podpowiada, bo w menu aparatu tego nie widać
- [x] **Pomiar z kamery telefonu koryguje rachunek** — model nie wie, czy
      stoisz w cieniu budynku. Średnia jasność kadru wchodzi do EV z wagą 0,6
- [x] **Ile zostało minut** — do złotej godziny albo do zachodu. W terenie to
      jedyna liczba, na którą naprawdę się patrzy

Trzy błędy złapane przez testy, każdy wart osobnej wzmianki:

- **Odwrócony znak różnicy EV.** Przy Słońcu w zenicie Cosmos radził „weź
  statyw", zamiast „załóż filtr ND" — czyli dokładnie odwrotnie. Teraz osobne
  sprawdzenie pilnuje, żeby przy prześwietleniu nigdy nie padło słowo „statyw".
- **`Number(null)` to zero, nie NaN.** Bez zapisanej lokalizacji endpoint
  liczył światło dla punktu 0°N 0°E na Atlantyku i oddawał to jako poprawną
  odpowiedź. Teraz odmawia i mówi, czego brakuje.
- **Dwie sprzeczne diagnozy naraz** — „potrzebny ND" i „potrzebny statyw"
  w tym samym bloku. Zostało jedno zdanie z liczbą działek.

Testy sprawdzają liczby wobec faktów **spoza naszego kodu**: astronomicznych
godzin wschodu i zachodu pod Warszawą (4:16 i 21:00 w przesilenie letnie),
wysokości Słońca w południe (61,4° latem, 13,6° zimą) i reguły „słoneczne 16".

## ✅ Partia 31 — poprawki z realnego użycia archiwum i głosu (GOTOWE)

Cztery rozmowy Marcina odsłoniły sześć usterek, z których żadnej nie wyłapałby
test sprawdzający, czy kod robi to, co kod robi.

- [x] **OneDrive nie pobierał EXIF-u ani GPS-u** — 2106 plików z czerwca,
      wszystkie z `lat`, `lon` i `swiatlo` na `null`. Przy jednoczesnym
      `$expand` Microsoft Graph oddaje tylko okrojony, domyślny zestaw
      właściwości; facety `photo` i `location` trzeba wymienić w `$select`
      z nazwy. Bez tego indeks wygląda na kompletny i nie jest
- [x] **Zdjęcia bez GPS-u nie wypadają już z filtra pory światła** — liczy
      się ją wtedy dla domu użytkownika, a wpis dostaje
      `swiatloPrzyblizone: true`. Zmiana lokalizacji przelicza całe archiwum
- [x] **Zestawienia podają POKRYCIE danych** — „6 zdjęć 50 mm w tym roku"
      brzmi jak fakt, a przy 2100 plikach bez zapisanej ogniskowej jest
      rozmiarem luki w metadanych. Odpowiedź niesie teraz `zDanymi`
      i `bezDanych`, a prompt każe to zgłaszać zamiast podawać wynik jak fakt
- [x] **Surowy tok myślenia przestał wyciekać jako odpowiedź** — awaryjne
      „pokaż myślenie, gdy nie ma treści" miało sens przy modelach, którym
      kończy się budżet, ale w praktyce wyrzucało na ekran angielskie
      rozumowanie urwane w połowie zdania. Teraz pada jedno zdanie, co się
      stało i co zmienić, a myślenie ląduje w zwijanym panelu
- [x] **Cosmos przestał twierdzić, że spełnia nieistniejącą prośbę** —
      „Przysłona f/2.8 zostaje, bo o głębię ostrości prosiłeś", podczas gdy
      przysłonę narzucił sobie sam model. Prompt mówi teraz wprost, żeby nie
      podawać `glebia` z własnej inicjatywy: wymusza mocny filtr ND i psuje
      resztę doboru

**Tryb głosowy: koniec sprzężenia.** Cosmos odpowiadał na własne słowa —
„jeśli potrzebujesz czegoś jeszcze, daj znać" wracało jako pytanie i pętla
się zamykała. Osobno słowo budzące dublowało się w transkrypcji
(„HejHejHej kosmosHej kosmos Co widzisz").

Mechanizm: rozpoznawacz jest CIĄGŁY, więc gdy Cosmos mówi, dalej transkrybuje —
tylko wyniki ignorujemy. Zostają jednak w `e.results`, a gałąź słowa budzącego
czytała trzy OSTATNIE wyniki niezależnie od tego, czy były już widziane.

- [x] **Znacznik zużycia** — wszystko, co padło w czasie głuchoty, jest z góry
      oznaczone jako przerobione i nie może wrócić jako pytanie
- [x] **Druga zapora** — pytanie pokrywające się w ponad 70% ze zdaniem, które
      Cosmos przed chwilą wypowiedział, jest odrzucane. Rozpoznawanie bywa
      opóźnione i zdanie potrafi domknąć się już po odmilczeniu
- [x] **Słowo budzące usuwane ze WSZYSTKICH wystąpień**, nie tylko z pierwszego

Zestaw `glos-bez-sprzezenia` odtwarza dokładnie ten scenariusz i został
sprawdzony przez cofnięcie poprawki — bez niej wypada.

**Domknięcie: znacznik zużycia zjadał własne pytania.** Pełna bateria pokazała
to, czego nowy zestaw nie mógł złapać — zapora przed echem działała za dobrze
i tłumiła też prawdziwe pytania. Zestaw `tryb-glosowy` wypadł na „pytanie nie
trafiło do transkrypcji" i „cisza nie zakończyła pytania".

Przyczyna była w założeniu, nie w kodzie: **znacznik oparty na samym indeksie
nie potrafi się cofnąć.** Raz podniesiony, przepuszcza tylko wyniki o indeksie
wyższym. Jeśli lista wyników nie urośnie ponad znacznik — bo rozpoznawacz podał
kolejną wypowiedź jako nową listę od zera — świeże pytanie wypada poniżej
i znika bez śladu.

Czy przeglądarka Marcina naprawdę tak robi, tego nie sprawdziłem i nie twierdzę
— specyfikacja Web Speech API tego nie rozstrzyga, a Androida nie mam pod ręką.
Sprawdzone jest co innego i wystarczy: zestaw `tryb-glosowy` podaje każdą
wypowiedź jako osobną listę i po poprawce ochrony przed echem **cały wsad
użytkownika przepadał**. Znacznik, który nie umie się cofnąć, jest wadą sam
w sobie — niezależnie od tego, która przeglądarka go do tego zmusi.

- [x] **Znacznik ma teraz ODCISK** ostatniego zużytego wyniku obok indeksu.
      Jeśli lista nie urosła ponad znacznik, a tego wyniku już w niej nie ma —
      numeracja ruszyła od nowa i znacznik wraca do zera. Rosnąca lista (ta
      sama sesja) nie uruchamia zerowania, więc echo nadal jest tłumione
- [x] **Słowo budzące wycinane także z gotowego pytania** — obojętne, czy
      wsiąkło przez opóźnione rozpoznanie, czy przez restart numeracji
- [x] **Sierota po słowie budzącym** — rozpoznawanie lubi rozbić „Hej Kosmos"
      na dwa wyniki, więc po wycięciu frazy zostawało samo „Hej". Ucinamy je
      tylko na początku i tylko wtedy, gdy coś po nim jest

**Drugie domknięcie: myślenie schowane za kliknięciem.** Ta sama bateria
wyłożyła też poprawkę „tok myślenia nie jest odpowiedzią". Rozumowanie
przestało udawać odpowiedź — słusznie — ale trafiało do panelu ZWINIĘTEGO, więc
przy modelu, który przepalił cały budżet na myślenie, na ekranie zostawało samo
ostrzeżenie i nic więcej. Panel jest teraz otwarty dokładnie wtedy, gdy myślenie
jest jedyną treścią wiadomości: nie ma czego przykrywać. Przy normalnej
odpowiedzi zostaje zwinięty, tak jak był.

Morał na przyszłość, ten sam co zwykle: nowe zestawy sprawdzały, czy zapora
tłumi echo i czy rozumowanie nie udaje odpowiedzi. Jedno i drugie potwierdziły.
Że zapora tłumi przy okazji prawdziwe pytania, a rozumowanie znika za
kliknięciem — pokazała dopiero **stara** bateria. Poprawka celuje w to, co
zgłoszone; skutki uboczne łapie tylko całość. Dlatego po każdej poprawce leci
cała bateria, nie sam nowy zestaw.

## ✅ Partia 32 — luki, przez które Cosmos „głupiał" (GOTOWE)

Dwa zgłoszenia Marcina: „nie pokazuje zdjęć, które wyszukał" oraz „napisałem,
jakich obiektywów użyję, i zgłupiał, nie umiał odpowiedzieć". Wyglądały na
dwie niezwiązane usterki. Mają jedną przyczynę:

> **Narzędzie nie miało gdzie przyjąć tego, co powiedział człowiek — albo nie
> miało co zrobić, gdy coś poszło nie tak.**

To nie są usterki do załatania po kolei. To jest klasa błędu, więc i poprawka
jest dla całej klasy.

### Obiektywy — parametr, którego nie było

Cosmos znał tylko KORPUS, a listę przysłon miał przypisaną do korpusu. To jest
bez sensu: przysłona jest cechą szkła. Gdy Marcin napisał, czego użyje, model
nie miał gdzie tego odłożyć — gubił informację albo odpowiadał od rzeczy.

- [x] **Parser zapisu obiektywu** — „RF 24-70mm f/2.8L IS USM", „24-70 f2.8",
      „50mm 1.8", „18-135 f/3.5-5.6", „Sigma 18-35 1.8", „EF 24-105 1:4",
      „RF 100-500mm F4.5-7.1". Katalog nazwanych szkieł jest tylko wygodą —
      sedno to parser, bo obejmuje każdy obiektyw, także nieznany
- [x] **Zoomy ze zmienną jasnością** — przy 500 mm szkło f/4.5-7.1 ma f/7.1,
      nie f/4.5. Obiecywanie tego pierwszego to półtorej działki błędu
- [x] **Przysłony bierzemy z obiektywu, nie z korpusu** — koniec doradzania
      f/1.4 komuś, kto ma zoom f/4. Sprawdzone liczbowo: ten sam zmierzch daje
      ISO 200 na f/1.8 i ISO 800 na f/4, czyli dokładnie dwie działki różnicy
- [x] **Kilka obiektywów naraz** — „mam 24-70 f/2.8 i 70-200 f/4"; Cosmos
      wybiera szkło pod ogniskową, a gdy żadne nie sięga, mówi to wprost

Osobno pułapka po stronie przeglądarki: parametry `[PLAN:]` dzieliły się po
spacjach, a „24-70 f/2.8" spację ma. Wartość urywała się na „24-70", przysłona
przepadała i Cosmos liczył f/4 komuś, kto ma f/2.8 — **odpowiedź brzmiała
sensownie i była nieprawdziwa**.

### Miejsce podane nazwą

Ta sama luka, inne narzędzie. Cosmos umiał zamienić współrzędne na nazwę, ale
nie odwrotnie. Na „w sobotę kręcę w Krakowie" model musiał zgadnąć szerokość
i długość z pamięci — a złota godzina policzona dla złego punktu wygląda
równie wiarygodnie jak policzona dla dobrego.

- [x] **`miejsce=Kraków`** w `[PLAN:]`; zamianę robi serwer przez Nominatim,
      z pamięcią podręczną i kolejką (regulamin: najwyżej jedno zapytanie na
      sekundę). Nieznana nazwa daje jasną odmowę, nie cichy wynik dla domu

### Grafiki — jedno źródło to była wada konstrukcyjna

Wyszukiwanie obrazów stało na DuckDuckGo, i to na skrobanym ze strony żetonie
`vqd`. Zależność od czegoś, czego nikt nam nie obiecał: format już się zmieniał,
a adresom centrów danych łatwo odmówić. Gdy odmawiał — Cosmos pisał „szukam
zdjęć" i nie pokazywał nic.

- [x] **Trzy źródła odpytywane równolegle** — DuckDuckGo (najszerszy zasięg),
      Wikimedia Commons i Openverse (prawdziwe API, bez żetonów, materiał na
      jasnych licencjach). Równolegle, nie po kolei: koszt to jeden najwolniejszy
      strzał, a nie trzy przeterminowania jedno po drugim
- [x] **Wyniki przeplatane, nie sklejane** — inaczej DuckDuckGo zajmowałby
      wszystkie osiem miejsc i materiał na jasnej licencji nie pokazałby się
      nigdy. Przy okazji awarię jednego źródła widać od razu
- [x] **Licencja i źródło przy każdym zdjęciu** — dla kogoś, kto montuje film,
      „czy wolno mi tego użyć" to nie ozdobnik
- [x] **`node scripts/grafiki.js`** — sprawdza, które źródła działają Z TEGO
      SERWERA. Tego pytania nie da się rozstrzygnąć znikąd indziej

### Dwie ciche awarie, przez które „nie było zdjęć"

- [x] **Kafelek bez miniatury już nie znika.** Kod usuwał go, żeby „nie
      zostawiać dziury w siatce" — i gdy proxy odrzucało wszystkie miniatury,
      Cosmos pisał „znalazłem 8 zdjęć" nad pustym miejscem. Teraz próbuje po
      kolei: przez proxy → prosto z serwera obrazka → widoczny kafelek
      z odnośnikiem. Zawsze widać tyle kafelków, ile zapowiedziała odpowiedź
- [x] **Nieudane szukanie wraca do MODELU**, nie tylko do użytkownika.
      Wcześniej pętla narzędzi kończyła się w tym miejscu: człowiek widział
      „nie znalazłem", a model nie dowiadywał się o niczym. Następne zdanie —
      choćby samo „Kraków" — trafiało w próżnię, bo model nie wiedział, że
      przed chwilą coś nie wyszło. **To było właśnie to „zgłupiał".** Teraz
      może doprecyzować zapytanie albo uczciwie powiedzieć, co się stało

### Zestaw `scenariusze` — łapanie usterek przed zgłoszeniem

Marcin poprosił, żeby przewidywać problemy, zanim się pojawią. Nowy zestaw nie
bada pojedynczych funkcji, tylko cztery KLASY sytuacji: człowiek podaje coś,
czego kontrakt nie przewiduje · wartość spoza listy · brak danych do policzenia ·
usługa zewnętrzna odmawia. Do tego śmieci na wejściu HTTP.

Reguła wspólna, sprawdzana w każdym z szesnastu przypadków: **Cosmos ma
odpowiedzieć i powiedzieć, czego zabrakło.** Nie wolno mu milczeć, wywalić się
ani — najgorsze — podać wyniku, który wygląda poprawnie, a policzony jest nie
dla tego, o co pytano. Zestaw wyłapał od razu jedną taką: nieznany korpus
wpadał po cichu w Canona R6 II, choć sufit ISO i zapas ze stabilizacji są inne.

### Audyt potrafił po cichu sprawdzić NIE TEN kod

Znalezione przy okazji, przez ściganie jednej uwagi, którą łatwo było machnąć
ręką: „w logu rozruchu jest słowo «error»". Okazała się wierzchołkiem czegoś
poważniejszego.

Sekcja „Rozruch próbny" uruchamia serwer na porcie 3499 i puka we wszystkie
trasy. Sprzątanie po sobie robiła jednym `process.kill(-pid)` — a to czasem nie
wystarczało i serwer zostawał. Przy NASTĘPNYM audycie nowy proces padał na
`EADDRINUSE`… i audyt **i tak meldował „✓ serwer wstaje"**, bo pukał w stary
serwer z poprzedniego przebiegu. Sprawdzał więc kod sprzed poprawek i nie mówił
o tym ani słowa. Jedynym śladem była ta jedna niewinna uwaga.

- [x] **Port sprawdzany PRZED startem** — zajęty port to teraz błąd audytu,
      nie cicha zamiana serwera na cudzy
- [x] **Sprzątanie musi się udać** — SIGTERM, potem SIGKILL, do grupy i do
      samego procesu, z czekaniem aż port faktycznie zwolniony. Nieudane
      zamknięcie jest zgłaszane jako problem
- [x] **Uwaga o „error" pokazuje teraz TREŚĆ linii**, a nie sam fakt, że słowo
      padło — bo to właśnie brak treści kazał ją zignorować

Morał, wart zapamiętania osobno: **narzędzie do wykrywania usterek, które samo
może po cichu skłamać, jest gorsze niż jego brak** — bo zielony wynik zamyka
temat. Uwagi audytu warto ścigać do końca, nawet te wyglądające na kosmetykę.

## ✅ Partia 33 — CO fotografujesz, KIEDY i GDZIE (GOTOWE)

Marcin zapytał, czy „pokaż zdjęcia, które wykonałem rano i wieczorem
w Krakowie" zadziała. Nie działało, z pięciu niezależnych powodów. Przy okazji
doszły dwa jego warunki: temat zdjęcia ma wpływać na plan, a sprzęt ma być
dowolny, „bo zawsze mogę go zmienić".

### Jeden słownik tematów, dwa zastosowania

`lib/tematy.js` odpowiada na dwa pytania naraz — „jak to fotografować"
i „które pliki są z tej kategorii". Gdyby słowniki były dwa, rozjechałyby się
przy pierwszej zmianie.

- [x] **22 kategorie**: ptaki w locie, dzikie i domowe zwierzęta, wyścig,
      pojazdy statycznie, ulica, portret, sesja, ludzie w ruchu, koncert, mecz,
      ślub, wydarzenia rodzinne, krajobraz, góry, las, morze, jezioro,
      kanion i klify, architektura, gwiazdy, makro
- [x] **Lista jest OTWARTA** — to był warunek postawiony wprost. „Pociągi
      towarowe" dostają neutralne nastawy i zdanie „tego tematu nie mam
      w słowniku", a nie odmowę
- [x] **Temat steruje nastawami**: 1/1600 s i 300-600 mm na ptaka w locie,
      f/8 na krajobraz, otwarcie na portret. Do tego rada praktyczna, która
      zwykle jest cenniejsza niż liczby — „ekspozycja pod suknię, cienie
      podnosisz później", „reguła 500", „polaryzator ODEJMUJE odbicie"
- [x] **Kategorie w archiwum z nazw folderów** — OneDrive nie ma tagów, ale
      „Wesele Kasi" i „Ptaki Biebrza" to gotowa klasyfikacja, tylko zapisana
      po ludzku. Plus obiekty z YOLO, gdy zmysły działają

Dopasowanie po fragmencie okazało się za luźne i dało dwa absurdy: „robię
ZDJĘCIA rowerów" trafiało w koncert (w środku słowa „zdjęcia" siedzi „dj"),
a „wyścig motocykli" w sesję statyczną. Teraz dopasowujemy do POCZĄTKU słowa,
rdzenie trzyliterowe wymagają trafienia dokładnego („tort" na urodzinach
przestał być torem wyścigowym), a słowa przesądzające biją dłuższe ogólniejsze.

### Dowolny sprzęt

- [x] **Klasy zamiast katalogu**: dron / telefon / pełna klatka / APS-C,
      rozpoznawane po nazwie („Sony A7 IV", „DJI Air 3", „Fujifilm X-T5").
      Z klasy bierzemy sufit ISO, zapas ze stabilizacji i mnożnik ogniskowej
- [x] **Mnożnik naprawdę użyty** — na APS-C 200 mm kadruje jak 300 mm i tak
      samo szybko widać poruszenie, więc czas z drgań liczy się po przeliczeniu
- [x] Podstawienie klasy jest **powiedziane wprost**, nie milczące

### Pora dnia, miejsce, podglądy

- [x] **`poraDnia` = rano / południe / wieczór / noc**, liczona z KĄTA
      GODZINNEGO. Kusiło, żeby patrzeć na azymut (wschód = rano), ale to działa
      tylko na półkuli północnej — a Marcin lata po świecie. Filtr przyjmuje
      kilka wartości naraz, bo tak brzmi prawdziwe pytanie: „rano i wieczorem"
- [x] **`miejsce=Kraków` w archiwum** — nazwa na współrzędne, a promień
      z obwiedni Nominatim: miasto dostaje 25 km, region jak Mazury
      kilkadziesiąt. Jeden sztywny promień gubiłby albo region, albo miasto
- [x] **Miniatury dociągane W CHWILI PYTANIA** (`/api/archive/thumb`).
      Adresy z Microsoft Graph są podpisane i WYGASAJĄ — zapisane przy
      indeksowaniu byłyby martwe dokładnie wtedy, gdy mają się pokazać
- [x] **Archiwum wreszcie POKAZUJE zdjęcia**, a nie tylko o nich pisze. Siatka
      miniatur była podpięta wyłącznie pod wyszukiwanie w internecie; wynik
      z archiwum szedł do modelu jako tekst i Marcin dostawał listę nazw
- [x] **Klik otwiera pełny ekran w Cosmosie** — to własny plik, więc nie ma
      dokąd go „odsyłać" nową kartą

### Dwa błędy złapane po drodze, oba przez sprawdzenie z rzeczywistością

- [x] **EV nocy było zawyżone o ponad SIEDEM działek.** Tabela mówiła +1 dla
      nocy bezksiężycowej. Kontrola: rozgwieżdżone niebo fotografuje się 20 s
      przy f/2.8 i ISO 3200, co daje EV = −6,4. Każda nocna porada była nie ta
- [x] **Ekspozycji dłuższej niż sekunda nie dało się WYRAZIĆ.** Czas był
      zawsze ułamkiem, więc na gwiazdy Cosmos radził 1/30 s zamiast 20 s.
      Teraz zdjęcia nocne wydłużają czas zamiast dobijać ISO, z granicą
      z reguły 500. Kontrola: 24 mm f/2.8 → 20 s ISO 3200, czyli dokładnie to,
      co się w praktyce ustawia

Trzecia rzecz, tym razem bez poprawki, bo się nie da: **Microsoft Graph nie
oddaje modelu obiektywu.** Facet `photo` ma korpus, czas, ISO i ogniskową,
`LensModel` z EXIF-u nie przychodzi. Zostawiamy `null` zamiast zgadywać po
ogniskowej — grupowanie po obiektywie pokaże wtedy niskie pokrycie, czyli
powie prawdę zamiast oddać pustą listę jako fakt.

## ✅ Partia 34 — podział server.js (GOTOWE)

Audyt od kilku partii powtarzał to samo: `server.js` przekroczył próg 2600
linii i doszedł do 2858. Warunek Marcina brzmiał krótko: „tylko tutaj nic nie
może się zepsuć".

Wyszły trzy podsystemy o czystych granicach:

- [x] **`lib/pamiec.js`** (259 linii) — pamięć długotrwała i embeddingi.
      Najbardziej naturalna granica w całym pliku: to jest podsystem, nie
      zbiór funkcji
- [x] **`lib/nagrywanie.js`** — nagrywanie procedur Playwrightem
- [x] **`lib/pomysly.js`** — backlog usprawnień, które Cosmos proponuje sam
      sobie do akceptacji

Wszystkie trzy dostają zależności przez `utworz()`, tak jak `archiwum`
i `onedrive` — nie sięgają po globalne stany serwera. **2858 → 2500 linii.**

### Czego `node --check` nie widzi

Podział wyglądał na udany po każdym kroku: składnia poprawna, serwer wstawał.
A jednak siedem razy pod rząd okazywało się, że coś jest zepsute — tylko widać
to dopiero po wywołaniu konkretnej trasy:

- granice bloków wyznaczone „na oko" po numerach linii wciągnęły do modułów
  **cudzy kod**: `handleKb` i obsługa treningu trafiły do nagrywania,
  a `handlePolish` do pomysłów
- `__dirname` po przeniesieniu do `lib/` zaczął wskazywać inny katalog —
  nagrywarka startowałaby w złym miejscu
- sześć nazw zostało bez definicji: `kbItems`, `capabilityText`, `genId`,
  `sanitizeStep`, `saveProcedures`, `dodajProcedure`

Każdą z nich wyłapał test dymny na żywym serwerze, jedną po drugiej. To jest
metoda działająca, ale kosztowna — stąd:

- [x] **Nowa kontrola w audycie: „nazwa wołana w module bez definicji".**
      Wycina napisy i komentarze, zbiera definicje lokalne, parametry
      i destrukturyzacje, a potem sprawdza WYWOŁANIA (`nazwa(`). Wywołań
      nie da się pomylić ze zmienną pętli, więc fałszywych alarmów praktycznie
      nie ma

Nowa kontrola od razu znalazła ósmą usterkę, tym razem NIE z podziału:
**`tsName` wołane w `lib/nauka.js`, a definiowane w `lib/studio.js`** i nigdzie
niewstrzykiwane. Zapis wzorca nauki z kamery wywaliłby się na `tsName is not
defined`. Leżało to tam od wcześniejszej partii i nie wyszło ani w baterii,
ani w rozruchu próbnym — trzeba by kliknąć dokładnie tę jedną ścieżkę.

Sama kontrola wymagała trzech podejść i to jest osobna lekcja:

1. wycinanie napisów wyrażeniem regularnym **rozjechało się na literałach
   wzorców z cudzysłowem w środku** (`/vqd=["']([^"']+)/`) — parser połknął
   pół pliku razem z definicjami i zgłosił dziesięć nieistniejących usterek
2. czytanie surowego źródła utonęło w polskiej prozie: „wyświetlenie (patrz
   niżej)" wygląda dla wzorca jak wywołanie funkcji — sto dziesięć alarmów
3. dopiero mały automat stanowy, który odróżnia napis od wzorca, dał wynik
   czysty: **zero fałszywych alarmów, jedna prawdziwa usterka**

Trzydzieści linijek automatu zamiast jednego wyrażenia regularnego to koszt
mniejszy niż jeden fałszywy alarm, który uczy ignorować całe narzędzie.

Morał jest ten sam co przy porcie audytu: **poprawna składnia nie znaczy
działający kod**, a przy przenoszeniu kodu między plikami różnica między
jednym a drugim jest właśnie tam, gdzie mieszkają usterki.

## ✅ Partia 35 — SearXNG i EXIF przez `Range` (GOTOWE)

Z przeglądu pięciu list „awesome" i trendów GitHuba wyszły dwie rzeczy warte
zrobienia od razu. Obie zamykają problemy, które sami sobie zostawiliśmy.

### SearXNG — własna metawyszukiwarka jako pierwsze źródło

- [x] **Grafiki i strony** idą najpierw przez `SEARXNG_URL`, gdy operator go
      ustawi. Bez ustawienia nic się nie zmienia — źródło po prostu nie istnieje
- [x] **Awaria SearXNG nie kończy sprawy** — Cosmos spada do DuckDuckGo przy
      stronach i do Commons/Openverse przy grafikach
- [x] Komunikat 403 mówi wprost, co poprawić: świeży SearXNG ma wyłączone
      wyjście JSON i trzeba dopisać `- json` do `search.formats`. To najczęstsza
      pomyłka przy stawianiu i szkoda, żeby wyglądała jak awaria sieci

Uczciwie o granicach: **to nie znosi blokad.** SearXNG na tym samym VPS-ie
wychodzi z tego samego adresu IP i też może dostać captchę. Przewaga jest inna
i trwalsza — utrzymywaniem kilkunastu silników i nadążaniem za zmianami ich
formatów zajmuje się projekt z pięcioletnią historią, a nie nasze trzy scrapery.
To jest dokładnie zasada Marcina: brać z zewnątrz to, co ktoś już utrzymuje,
i nie gubić przy tym swojej tożsamości. Cosmos zostaje interfejsem i logiką.

### Obiektyw z OneDrive — luka, o której powiedziałem, że jest nie do zasypania

Twierdziłem, że modelu obiektywu nie da się wyciągnąć, bo facet `photo`
w Microsoft Graph go nie zawiera. Pierwsza część jest prawdą, wniosek był
przedwczesny: **EXIF siedzi w pierwszych kilkudziesięciu kilobajtach pliku,
a Graph obsługuje nagłówek `Range`.**

- [x] `dociagnijExif()` pobiera **128 KB zamiast całego pliku** i czyta je
      naszym `lib/exif.js`, który tag `0xa434` zna od Partii 27
- [x] Osobna trasa `/api/archive/lenses` uzupełnia obiektyw paczkami, bo to
      jedno żądanie na plik — za dużo, żeby robić przy każdym indeksowaniu
- [x] **Zero nowych zależności.** Przy 2100 zdjęciach to ~250 MB jednorazowo
      zamiast kilkunastu gigabajtów

Morał wart zapamiętania: „usługa tego nie oddaje" i „tego nie da się zdobyć"
to dwa różne zdania, a ja podałem pierwsze jako drugie.

### Z przeglądu list — co zostało odnotowane, a nie zrobione

- **Silero VAD** i **huggingface/speech-to-speech** — realna naprawa trybu
  głosowego: własny strumień audio zamiast Web Speech API. Znika wtedy dźwięk
  mikrofonu, słyszenie samego siebie i pętle naraz
- **Immich** (110 tys. ★) — wyszukiwanie semantyczne zdjęć przez CLIP. Wart
  podejścia, nie całego stosu: to Docker z Postgresem i kontenerem ML
- **sqlite-vec** — wektory bez serwera, gdy pamięć przerośnie liczenie w JS
- **BirdNET-Analyzer** — gatunek ptaka z dźwięku; dla kogoś, kto fotografuje
  żurawie, to nie ciekawostka
- **SolarHam / NOAA SWPC** (z awesome-astrophotography) — dane o aktywności
  geomagnetycznej. Zorza w Polsce bywa i jest do przewidzenia; pasuje do
  planu zdjęciowego tak samo jak pogoda
- **OpenCut**, **claude-video** (z trendów) — montaż i czytanie wideo
- **ExifTool / Exiv2** (z awesome-OpenSourcePhotography) — potwierdzają, że
  `LensModel` to standardowy tag; naszego czytnika nie trzeba zastępować

## 🎉 Wszystkie partie z roadmapy zrealizowane
Pozostałe pojedyncze punkty oznaczone `[ ]` (foldery/tagi, sterowanie gestami,
streaming WebRTC, konta wielu użytkowników, automatyczne odtwarzanie web/desktop)
to świadomie odłożone rozszerzenia wymagające zewnętrznych bibliotek/infrastruktury
— opisane przy swoich partiach.

---

> Kolejność partii można zmieniać. Napisz, którą chcesz jako następną, a zbuduję
> ją w całości i oznaczę tutaj jako gotową.

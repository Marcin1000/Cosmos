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

## ✅ Partia 36 — zorza polarna z danych NOAA (GOTOWE)

Z listy awesome-astrophotography: **SolarHam** i dane **NOAA SWPC**. Zorzę
w Polsce widać kilka razy w roku, jest do przewidzenia z kilkunastu godzin
wyprzedzeniem, a przegapienie jej boli. Pasuje do planu zdjęciowego dokładnie
tak jak pogoda — i tak samo jest tylko DODATKIEM, który nie może go zablokować.

- [x] **Bieżące Kp i prognoza na trzy doby** z NOAA — publicznie, bez klucza
- [x] **Próg Kp policzony dla MIEJSCA**, nie ogólny. To jest sedno: „Kp 7" nic
      nie znaczy bez odpowiedzi na pytanie „a gdzie stoisz". W Tromsø zorza
      jest przy Kp 0, w Zakopanem trzeba Kp 8
- [x] **Pytamy tylko po zmroku** — przy Słońcu wysoko odpowiedź jest znana
      z góry i byłoby to marnowanie sekundy przy każdym planie
- [x] Awaria NOAA nie zabiera ustawień ekspozycji; sprawdzone w `scenariusze`
- [x] `node scripts/zorza.js` — diagnostyka z serwera, jak przy grafikach

### Liczba, którą trzeba było skorygować

Pierwsza wersja przyjmowała, że łunę nad horyzontem widać **8° poniżej** owalu
zorzowego. Wychodziło z tego, że w Gdańsku zorza jest przy **Kp 3** — a Kp 3 to
spokojny dzień, w którym nikt w Polsce niczego nie widzi.

Kontrola z rzeczywistości: w Polsce zorzę widać przy Kp 6-7, a wielką burzę
z maja 2024 (Kp 8-9) widziano w całym kraju. Po zmianie zapasu na 4° progi
wychodzą **Gdańsk 5 · Warszawa 6 · Kraków 7 · Zakopane 8** — i to się zgadza.

Osobno przyznane wprost w kodzie i w odpowiedzi: szerokość geomagnetyczną
liczymy przybliżeniem DIPOLOWYM, a tablice „Kp → granica owalu" opierają się
na szerokości SKORYGOWANEJ, która dla Polski wypada o 2-3° niżej. Próg jest
więc lekko optymistyczny i Cosmos tego nie ukrywa.

### Czego NIE potwierdziłem

Kształtu odpowiedzi NOAA nie sprawdziłem na żywym API — kontener testowy ma
zablokowane wyjście, więc atrapa jest zbudowana z dokumentacji. Sprawdza to,
czy Cosmos POPRAWNIE CZYTA taki kształt (a to niebanalne: bieżące Kp to lista
obiektów, prognoza — lista TABLIC z wierszem nagłówka). Czy prawdziwe API
oddaje dokładnie to, rozstrzyga dopiero `node scripts/zorza.js` na serwerze.

## ✅ Partia 37 — reszta z przeglądu list (GOTOWE)

Partia 35 zamknęła dwie rzeczy z przeglądu i wypisała resztę jako „odnotowane,
a nie zrobione". Marcin przypomniał, że prosił o WDROŻENIE, i miał rację.
Tu jest reszta — z jednym zastrzeżeniem, które trzeba powiedzieć wprost:
**żadnego z tych projektów nie wciągamy w całości.** Immich to Docker z
Postgresem i kontenerem ML, BirdNET to TensorFlow. Bierzemy z nich POMYSŁ
i realizujemy go częściami, które już mamy — to ta sama zasada, dla której
SearXNG jest dobrym wyborem, a pisanie własnego scrapera nie było.

### Nasłuch własnym strumieniem — realna naprawa trybu głosowego

To był największy dług. Marcin zgłaszał trzy rzeczy naraz: mikrofon ciągle
się włącza i wyłącza, Cosmos słyszy sam siebie, i wpada w pętlę. Łataliśmy to
w Partii 31 znacznikami zużycia i odciskami wyników — działało, ale było
obchodzeniem cudzego automatu. Wszystkie trzy objawy mają jedną przyczynę:
**Web Speech API nie da się wyciszyć bez zwolnienia mikrofonu.**

- [x] `public/nasluch.js` — mikrofon otwierany RAZ na całą sesję głosową.
      Nic go nie przejmuje, więc Android nie ma czego sygnalizować dźwiękiem
- [x] Wypowiedzi wycinane z sygnału po energii, z ruchomym progiem szumu tła
      (szybko w dół, wolno w górę — jeden przejeżdżający samochód nie może
      ogłuchnąć Cosmosa na kilka minut)
- [x] **„Głuchy" znaczy naprawdę głuchy**: gdy Cosmos mówi, próbki lecą do
      kosza. Nie ma czego rozpoznać, więc pętla jest NIEMOŻLIWA, a nie tylko
      mało prawdopodobna. Zestaw `nasluch-wlasny` sprawdza to osobnym testem
- [x] Przedbieg 320 ms, żeby nie ginęła pierwsza głoska — „Kosmos" zaczyna
      się od cichego „k", a próg przekracza dopiero samogłoska
- [x] Wybór silnika w Ustawieniach, z pokazaniem, który DZIAŁA (a nie tylko
      który jest wybrany) — przy wyłączonych zmysłach Cosmos wraca do
      przeglądarki i musi to powiedzieć

To pomysł z **Silero VAD** i **huggingface/speech-to-speech**, sprowadzony do
zera zależności. Silero jest mądrzejsze — sieć neuronowa odróżnia mowę od
trzaśnięcia drzwiami — ale wymagałoby ONNX w przeglądarce. Przy włączonych
zmysłach sam Whisper i tak przepuszcza nagranie przez własny VAD.

**Wymaga Whispera w zmysłach**, więc to jest WYBÓR silnika, nie zamiennik.
I ma swoją cenę, powiedzianą wprost w Ustawieniach: pytanie leci na komputer
domowy i wraca, więc odpowiedź zaczyna się o sekundę-dwie później niż przy
rozpoznawaniu w przeglądarce. Za to nie trzeba zgadywać, czy Cosmos właśnie
usłyszał sam siebie.

#### Liczba, którą trzeba było skorygować (znów)

Pierwsza wersja odrzucała za krótkie wypowiedzi, mierząc długość CAŁEJ zebranej
paczki. A w paczce siedzi też przedbieg i 700 ms ciszy domykającej — razem
ponad sekunda. Stuknięcie w biurko trwające 0,13 s wychodziło więc na
„wypowiedź długą na 1,2 s" i szło do Whispera. Test 6a wyłapał to od razu;
teraz liczymy ramki, w których NAPRAWDĘ coś było słychać.

### Co widać na zdjęciu — to, co daje Immich, bez stosu Immicha

Materiał z OneDrive nie ma o sobie ŻADNEJ informacji o treści: Microsoft Graph
oddaje datę, aparat i GPS. Kategorie tematyczne zgadujemy z nazw folderów, więc
„Wesele Kasi" działa, a „IMG_4471.JPG" nie mówi nic — a takich jest większość.

- [x] `/api/archive/vision` — YOLO ze zmysłów ogląda **miniaturę**, nie plik.
      Detekcja na 800 px daje ten sam wynik co na 40 megapikselach, a ściąga
      kilkadziesiąt kilobajtów zamiast dwudziestu megabajtów
- [x] Wykryte obiekty wpadają w kategoryzację tematyczną SAME, przy zapisie
      wpisu — „pokaż zdjęcia z psem" zaczyna działać bez drugiego przejścia
- [x] Próg pewności 0,45, wyżej niż w podglądzie na żywo. Przy podglądzie
      fałszywy alarm mija po klatce; tutaj zapisuje się w indeksie na stałe
- [x] Pole `obejrzane` osobno od `obiekty`. Bez tego rozróżnienia krajobraz,
      na którym YOLO słusznie nie widzi nic z 80 klas, wracałby do kolejki
      w nieskończoność i paczka mieliłaby w kółko te same pliki
- [x] **Przyciski w Ustawieniach** — dla tego i dla obiektywów z Partii 35.
      Do tej pory dało się je uruchomić wyłącznie curlem, co znaczy: nikt ich
      nigdy nie uruchomił. Pętla po paczkach siedzi w przeglądarce, więc widać
      postęp i „Przerwij" działa natychmiast

Czego NIE robimy: **CLIP-a i wyszukiwania semantycznego po wektorach.** Immich
robi to lepiej, ale za cenę drugiej bazy danych obok naszej. Nasze wektory
(**sqlite-vec** z listy) mają sens dopiero, gdy liczenie kosinusa w JS przestanie
wyrabiać — przy dwóch tysiącach wpisów jest do tego bardzo daleko.

### Ptak z dźwięku — BirdNET

Ptaka słychać znacznie dalej, niż go widać, i to słuch decyduje, gdzie postawić
statyw. Dla kogoś, kto fotografuje żurawie, to nie ciekawostka.

- [x] `senses/service.py` → `/ptak`, `CAPS["birdnet"]` (opcjonalna zależność,
      jak wszystkie pozostałe zmysły)
- [x] Przycisk 🐦 w nakładce głosowej: 8 s nagrania, wynik czytany na głos
- [x] Nagranie **bez „ulepszaczy"** i w pełnej częstotliwości — redukcja szumu
      w telefonie wycina dokładnie te ciche, wysokie tony, które są tu całą
      treścią, a przy 16 kHz próbkowania połowa gatunków traci to, po czym się
      je rozpoznaje
- [x] **Współrzędne dokłada serwer**, nie przeglądarka. BirdNET zawęża listę do
      gatunków, które w danym tygodniu naprawdę występują pod tymi
      współrzędnymi — bez tego czajka z Biebrzy potrafi wyjść jako gatunek
      z Ameryki Południowej o podobnym głosie

### Czytanie wideo — klatki wycinane w przeglądarce

Pomysł z **claude-video** (z trendów). Model nie czyta wideo, model czyta
KLATKI — cała różnica jest w tym, gdzie się je wycina.

- [x] Klip wrzucony do rozmowy → cztery klatki ze środków równych odcinków
      (nie od zera: pierwsza klatka filmu to zwykle czarne pole albo klaps)
- [x] Do tego notatka, CO to jest. Bez niej model dostaje cztery niepowiązane
      zdjęcia i opisuje je jak cztery różne sceny
- [x] Zero wysyłki: minuta z R6 II to 300-500 MB, a `<video>` + `<canvas>` to
      dekoder sprzętowy, który i tak siedzi w każdym urządzeniu. Działa też
      przy wyłączonych zmysłach i bez ffmpega na VPS-ie

### Podział server.js — drugi raz

Plik znów przebił 2600 linii. Wyszło `lib/archiwum-trasy.js` (242 linie):
sześć tras jednego indeksu plus dwa pomocniki, których nie używa nic poza nimi.
Zależności przez `utworz()`, tak jak przy poprzednim podziale — i tak jak wtedy
pilnuje tego kontrola „wołane, ale niezdefiniowane" ze `scripts/audyt.js`,
bo osiem usterek z Partii 34 przeszło `node --check` bez mrugnięcia.

### Karty ujęć — video-shotcraft po swojemu

Z trendów: **video-shotcraft** (4 tys. ★), sto kilkadziesiąt „kart przepisów"
na ujęcia. Sam zapisałem wtedy, że to TREŚĆ, nie kod, i że asystent planu
mógłby z niej czerpać w trybie wideo.

Nie kopiujemy cudzej listy — po pierwsze to czyjaś praca, po drugie karty
pisane pod produkcję filmową („crane down over the crowd") są bezużyteczne dla
człowieka, który stoi sam z gimbalem i jednym korpusem. Bierzemy POMYSŁ: plan
ujęć to lista do odhaczenia z konkretnymi liczbami, nie akapit o kompozycji.

- [x] `lib/ujecia.js` — 15 kart, 22 zestawy tematyczne. Każda karta ma
      ogniskową, ruch kamery, czas trwania i jedno zdanie „po co to jest"
- [x] **Zestaw zależy od TEMATU** — tego samego słownika z `lib/tematy.js`,
      którym przeszukujemy archiwum. Wesele to nie wyścig
- [x] **Ujęcia są filtrowane przez SPRZĘT**, a POMINIĘTE oddajemy osobno,
      z powodem. „Nie ma na liście" i „nie masz drona" to dla kogoś, kto
      planuje sobotę, dwie zupełnie różne informacje
- [x] **Ogniskowa policzona dla TWOJEGO szkła**, nie ze środka teoretycznego
      zakresu: ujęcie ustalające chce 14-35 mm, a z 24-105 wychodzi 30 mm —
      bo poniżej 24 mm nie masz czym
- [x] Kolejność jest kolejnością KRĘCENIA, nie montażu. Ustalające najpierw,
      bo światło z niego ucieka najszybciej; detale zrobisz o każdej porze
- [x] Tylko przy `tryb=wideo`. Przy zdjęciu pytanie brzmi „jakie nastawy",
      nie „co nakręcić"

Przy okazji zamknięta luka, która była tu od początku: **sprzęt dostał wreszcie
pola w Ustawieniach.** Do tej pory `/api/gear` dało się ustawić wyłącznie
curlem, czyli w praktyce nikt tego nie zrobił — plan liczył dla domyślnego
korpusu i nie wiedział nic o dronie. Doszło trzecie pole, „reszta sprzętu",
bo dron i gimbal nie wpływają na ekspozycję, ale przesądzają o ujęciach.

### Czytanie dokumentów — anydoc i doc7, w wersji pythonowej

**firecrawl/anydoc** (11 tys. ★ w pięć dni) i **doc7** robią jedno: 97 formatów
→ Markdown, z rozumieniem układu strony. Sam napisałem, że anydoc łamie zasadę
zera zależności w rdzeniu i musiałby wylądować w `senses/`. Tam właśnie ląduje
— tyle że jako odpowiednik z pythonowego świata, bo anydoc to Rust z wiązaniami
Node, a strefa zmysłów jest pythonowa.

- [x] `/extract` próbuje najpierw **docling** (IBM) albo **markitdown**
      (Microsoft), jeśli któryś jest zainstalowany
- [x] Różnica jest realna na dwóch rzeczach, na których pypdf przegrywa
      zawsze: **skany** (docling ma OCR, pypdf oddaje pustą stronę bez słowa)
      i **układ** (tabela w PDF-ie to dla pypdf ciąg luźnych liczb, a dla
      doclinga tabela Markdown, którą model przeczyta)
- [x] Awaria mocniejszego czytnika NIE kończy sprawy — cztery sprawdzone
      gałęzie (pypdf, python-docx, openpyxl, python-pptx) zostają jako zapas
      i przejmują robotę bez słowa do użytkownika
- [x] Panel zmysłów pokazuje **nazwę** czytnika, nie samo „jest": „dokumenty
      (docling)" i „dokumenty" to dwie różne jakości odczytu

### Trzy awarie, na które nie chciałem czekać

Standardowa prośba Marcina: przewidzieć problemy, zanim się pojawią. W nowym
trybie głosowym widzę trzy realne i wszystkie na jego sprzęcie.

**Cicha głuchota.** Najgorsza awaria tego modułu nie jest głośna — mikrofon
przestaje dawać próbki, a ekran dalej pokazuje „SŁUCHAM…". Człowiek mówi do
telefonu i nie rozumie, czemu nic się nie dzieje. Trzy drogi do tego stanu,
żadna nie rzuca wyjątkiem: wygaszony ekran usypia AudioContext, rozmowa
przychodząca zabiera mikrofon, odłączone słuchawki kończą ścieżkę.

- [x] Pilnowane z trzech stron naraz: stan kontekstu, zdarzenia `ended`/`mute`
      na ścieżce oraz — bo tamte potrafią milczeć — licznik czasu od ostatniej
      ramki (2,5 s to ponad sto przegapionych ramek, na pewno awaria)
- [x] Najpierw PRÓBA ODZYSKANIA, bo dwie z trzech przyczyn mijają same
      i wystarczy wziąć wejście od nowa. Dopiero potem komunikat — jedna
      próba, nie pętla wznowień co dwie sekundy
- [x] Zgłoszenie RAZ na epizod. Ten sam komunikat powtarzany w kółko jest
      równie bezużyteczny jak jego brak

**Whisper w kółko odmawia.** Jeden błąd to przypadek — GPU zajęte, dziura
w Tailscale. Trzy pod rząd znaczą, że zmysłów nie ma, a trwanie przy nich
skazuje tryb głosowy na milczenie. Po trzeciej awarii Cosmos wraca do
rozpoznawania przeglądarki i MÓWI o tym: milcząca zmiana zachowania to
dokładnie ten rodzaj rzeczy, po której człowiek myśli, że coś zepsuł.

**H.265 z R6 II.** Canon nagrywa 4K w HEVC, a Chrome na Windowsie dekoduje go
tylko z rozszerzeniem od Microsoftu. Bez rozpoznania tego przypadku komunikat
brzmiałby „ta przeglądarka nie zna tego kodowania" — prawda, z której nic nie
wynika. Teraz Cosmos nazywa kodek po imieniu i podaje dwa wyjścia: proxy
w H.264 albo doinstalowanie rozszerzenia.

Wszystkie trzy mają testy. Sekcja 9 zestawu `nasluch-wlasny` wyzwala każdą
z dróg do głuchoty osobno i sprawdza też rzecz nieoczywistą: że po powrocie
dźwięku KOLEJNA awaria znów zostanie zgłoszona.

### Czego z listy świadomie nie robimy

- **OpenCut** — montaż wideo. Zapisałem wtedy „Ty montujesz filmy, więc to nie
  jest ciekawostka" i to prawda, ale wniosek jest inny: OpenCut to KOMPLETNA
  aplikacja webowa, alternatywa dla CapCuta. Wbudowanie jej w Cosmosa znaczy
  utrzymywanie drugiego programu w środku pierwszego, a Marcin i tak montuje
  w Premiere. Wartość z tej strony bierzemy inaczej i już ją mamy: karty ujęć
  mówią, CO nakręcić, a czytanie klipu mówi, co na nagraniu wyszło
- **sqlite-vec** — sam napisałem: „przy 2 tys. wpisów w porządku, przy 100 tys.
  już nie". Dziś jest tych wpisów około dwóch tysięcy. Doszłaby natywna
  biblioteka npm w rdzeniu — dokładnie to, czego zasada zabrania — żeby
  rozwiązać problem, którego nie ma. Próg jest konkretny: gdy pamięć
  długotrwała przekroczy kilkadziesiąt tysięcy wpisów
- **Immich w całości** — Docker z Postgresem i osobnym kontenerem ML, druga
  baza obok naszej. Wartość (wyszukiwanie po TREŚCI zdjęcia) bierzemy wyżej,
  częściami, które już mamy
- **ExifTool / Exiv2** — potwierdziły tylko, że `LensModel` to standardowy tag.
  Naszego czytnika nie trzeba zastępować

## ✅ Partia 38 — audyt całości: co znalazłem, patrząc, a nie uruchamiając (GOTOWE)

Marcin poprosił o skrupulatny przegląd wszystkiego: UI, UX i backendu. Sam
`scripts/audyt.js` pokazywał **0 problemów** — i to jest dokładnie powód, dla
którego trzeba było spojrzeć własnymi oczami. Narzędzie sprawdza to, o co je
zapytano; nie sprawdza tego, o czym nikt nie pomyślał.

### Trzy usterki, których narzędzie nie widziało

**Placeholder wyświetlany dosłownie.** Na zrzucie ekranu z trybu głosowego
stało: `Brak dostępu do mikrofonu: {msg}`. Klucz istnieje, tłumaczenie
istnieje, parytet PL/EN pełny — po prostu nikt nie przekazał danych. Żadna
z dotychczasowych kontroli nie mogła tego złapać, bo wszystkie sprawdzały
OBECNOŚĆ tekstu, nie jego kompletność. Jedna instancja na 80 kluczy
z placeholderem, ale klasa realna, więc doszła kontrola stała.

**Dwa modele zapisu w jednym oknie.** Dodane w Partii 37 pola sprzętu
zapisywały się same, z opóźnieniem, a stojące tuż obok „Profil"
i „Lokalizacja" — dopiero po kliknięciu „Zapisz". Trzy pola tekstowe
zachowujące się inaczej niż dwa sąsiednie pola tekstowe to nie jest wygoda,
tylko zagadka. Sprzęt trafił pod przycisk, jak reszta. Mikrofon zostaje przy
zapisie natychmiastowym: lista rozwijana czyta się jako wybór dokonany
w chwili kliknięcia, a pole tekstowe jako brudnopis.

**Zapis, który potrafi zniszczyć dane.** `writeFileSync` nie jest
niepodzielny — najpierw obcina plik do zera, potem dopisuje treść. Restart
usługi w złym momencie zostawia plik pusty. Przy `archiwum.json` zauważyłem to
od razu i zrobiłem tam zapis przez plik tymczasowy, a reszta została po
staremu — i to była niespójność po ZŁEJ stronie. Indeks zdjęć odbudowuje się
jednym kliknięciem „Indeksuj teraz"; rozmowy, pamięć długotrwała i baza wiedzy
nie odbudowują się wcale.

- [x] `zapiszAtomowo()` w rdzeniu, użyte w jedenastu miejscach: rozmowy,
      indeks rozmów, baza wiedzy, pamięć, oś czasu, profil, lokalizacja,
      sprzęt, poświadczenia OneDrive i przywracanie kopii zapasowej
- [x] Tryb dostępu ustawiany NA PLIKU TYMCZASOWYM. Token OneDrive zapisany
      najpierw jawnie, a obcięty do 0600 sekundę później, jest przez tę
      sekundę do odczytania przez każdego na maszynie
- [x] Zestaw `zapis-nie-gubi-danych` MODELUJE awarię („proces zginął po
      obcięciu, przed dopisaniem") i pokazuje obie strony obok siebie:
      przy zapisie wprost zostaje 0 z 54 bajtów, przy atomowym — 54 z 54

### Dwa miejsca, w których audyt kłamał

To gorsze niż usterka w kodzie, bo podważa zaufanie do wszystkiego, co
narzędzie mówi.

- [x] **Trasy przeniesione do modułów zniknęły spod kontroli.** Audyt szukał
      ich tylko w `server.js`. Zauważyłem po liczbie: 52 trasy przed podziałem
      archiwum, 45 po nim. Po poprawce widocznych 85, sprawdzanych rozruchem 58
- [x] **Klucze budowane dynamicznie liczone jako martwe.** `t('event.' + typ)`
      ożywia wszystkie `event.*`, a lista „bez użycia" podawała je do
      skasowania. 34 → 28, i teraz tej liście można ufać na tyle, żeby coś
      z niej usunąć

### Wydajność zmierzona, nie oszacowana

Archiwum przy **2100 wpisach** — tyle Marcin ma naprawdę:

| Operacja | Czas |
|---|---|
| filtr pory dnia | 0,5 ms |
| zestawienie po ogniskowej | 0,8 ms |
| filtr promieniowy (25 km) | 0,7 ms |
| jednorazowe zaindeksowanie całości | 683 ms |
| rozmiar indeksu w pamięci | 896 kB |

To jest też odpowiedź na pytanie o **sqlite-vec**, którego świadomie nie
wdrożyliśmy. Zapytania idą poniżej milisekundy, a liczenie w JS ma zapas
rzędu wielkości. Baza wektorowa rozwiązywałaby tu problem, którego nie ma.

### Co sprawdziłem i było dobre

Ścieżki plików (brak przejścia w górę drzewa — `startsWith` po `path.join`,
identyfikatory z bazy wiedzy generowane po stronie serwera), limit rozmiaru
ciała żądania, sprzątanie po strumieniu zdarzeń (interwał i słuchacz zwalniane
przy zamknięciu i przy błędzie), ograniczenia wzrostu danych (zdarzenia, oś
czasu), zero pustych `catch` bez wyjaśnienia, brak przepełnień poziomych na
telefonie, brak błędów JS w konsoli.

## ✅ Partia 39 — DJI i Canon: cztery rzeczy z przeglądu repozytoriów (GOTOWE)

Marcin przysłał kilkadziesiąt zrzutów z repozytoriami wokół DJI i poprosił
o przeszukanie reszty, w tym Canona. Jedno ustalenie przestawiło całą listę:

**Konsumenckiego Mavica 3 nie da się sterować programowo.** DJI nie wyda dla
niego Mobile SDK — v5 obsługuje wyłącznie serię Enterprise. To przekreśla
`HeyMavic`, `mavicmini`, `CustomSDKMavicMini`, `DJIWindowsSDK`,
`mavic-air-tracking-control`, `Mavic-Missions` i resztę tej rodziny. Dobra
wiadomość: kieruje uwagę na PLIKI, które dron już zapisuje — a tam leżała
największa dziura w Cosmosie.

### Telemetria klipów — koniec z archiwum, które nie zna wideo

O zdjęciach Cosmos wiedział wszystko. O klipach nie wiedział NIC, bo Microsoft
Graph oddaje dla wideo samą datę i rozmiar. „Pokaż ujęcia znad jeziora
o zachodzie" dotyczyło więc wyłącznie fotografii — i nikt tego nie zauważył,
bo brak wyników wygląda jak brak materiału.

Tymczasem Mavic 3 zapisuje obok każdego nagrania plik `.SRT`, a w nim DLA
KAŻDEJ KLATKI: ISO, czas, przysłonę, korektę ekspozycji, ogniskową, GPS
i dwie wysokości. Zestaw pól jest dokładnie taki, jak kolumny naszego indeksu.

- [x] `lib/srt.js` — oba formaty (nowy z nawiasami, stary `GPS(lon,lat,alt)`),
      zero zależności, jak `lib/exif.js`
- [x] Z tysiąca klatek robimy JEDEN wpis plus ślad lotu w rozdzielczości
      sekundowej. Klip minutowy to 1800 klatek; wszystkie w indeksie
      rozsadziłyby go i nic nie dały
- [x] `/api/archive/telemetry` paczkami, jak obiektywy i rozpoznawanie treści
- [x] **Klip dostaje porę światła tak samo jak zdjęcie** — to jest cała
      wartość: nagrania wpadają do tych samych pytań co fotografie

Dwie pułapki, które trzeba było ominąć. `Shutter:60` w starym formacie znaczy
**1/60 s, nie 60 sekund** — wzięte dosłownie dałoby minutową ekspozycję
z lecącego drona. A `GPS(lon,lat,alt)` ma **długość PIERWSZĄ**, odwrotnie niż
podpowiada nazwa; zamiana miejscami przenosi materiał z Biebrzy do Somalii
i nikt tego nie zauważy, dopóki nie spojrzy na mapę.

#### Liczba, którą trzeba było poprawić

Pierwsza wersja liczyła długość klipu jako liczbę klatek podzieloną przez 30.
Mavic 3 nagrywa też 24, 25, 48, 50 i 120 kl./s, więc dwuminutowy materiał
w 60 kl./s wychodził na cztery minuty. Znacznik czasu SubRip jest w pliku
wprost i nie trzeba niczego zakładać.

### Dane lotu ze zdjęć — XMP, którego EXIF nie ma

DJI wpisuje wysokość nad punktem startu i kąty gimbala do **XMP**, czyli
drugiego segmentu APP1 obok EXIF-u. Nasz czytnik znał tylko ten pierwszy.

- [x] `czytajXmpDrona()` w `lib/exif.js` — oba zapisy DJI (atrybut i znacznik)
- [x] Czytane **za darmo**, przy okazji dociągania obiektywu: to ten sam
      pobrany kawałek pliku, drugi przebieg po dwóch tysiącach zdjęć byłby
      marnotrawstwem
- [x] Poprawka przy okazji: zdjęcie z drona nigdy nie ma obiektywu, więc
      wracało do kolejki przy każdym przebiegu. Licznik „zostało" nie zszedłby
      nigdy do zera

### Canon CCAPI — R6 II jako urządzenie, nie temat rozmowy

**Potwierdzone: firmware 1.7.0 do R6 Mark II dodaje Camera Control API.**
REST po HTTP, JSON, przez Wi-Fi — czyli zero zależności, samo `fetch`.

To jest naprawa czegoś, co leżało odłogiem. `senses/tether.py` steruje
aparatem przez gPhoto2 po kablu, a to na Windowsie wymaga WSL — więc
w praktyce nigdy nie ruszyło.

- [x] `lib/canon.js` + trzy trasy: stan, nastawy, migawka
- [x] **Ścieżek nie zaszywamy.** CCAPI ma kilka wersji i każdy model wystawia
      inny podzbiór; pytamy `GET /ccapi`, aparat sam mówi, co potrafi
- [x] Wartość spoza listy `ability` nie leci do aparatu — komunikat mówi,
      co aparat przyjmie, zamiast oddawać „Invalid parameter"
- [x] W panelu planu: nastawy z aparatu obok policzonych, ze znacznikiem
      „≠ policzone" i przyciskiem „Ustaw w aparacie"
- [x] **Autofokus przy zdalnym strzale domyślnie WYŁĄCZONY.** Aparat na
      statywie z ręczną ostrością (astro, makro, stacking) przeostrzyłby się
      przy każdym zdjęciu i cała seria byłaby do wyrzucenia

Granica powiedziana wprost w kodzie, w `.env.example` i w komunikacie błędu:
to działa tylko wtedy, gdy Cosmos i aparat są w tej samej sieci. Serwer na
VPS-ie nie dosięgnie aparatu stojącego w domu.

### Misja waypointowa — plik KMZ dla drona

`senses/flightplan.py` liczył wysokość, pokrycie i liczbę zdjęć, ale nie umiał
oddać tego dronowi. Plan zostawał liczbą na ekranie do ręcznego przepisania.

- [x] `lib/kmz.js` — WPML w dwóch plikach (`wpmz/template.kml`,
      `wpmz/waylines.wpml`) spakowanych **własnym zapisem ZIP**. Node ma
      `zlib.crc32`, reszta nagłówka to kilkanaście liczb; biblioteka do
      spakowania dwóch plików tekstowych byłaby zależnością większą niż problem
- [x] Siatka nalotu układana „wężem" — powrót na początek każdej linii to
      przelot na pusto, przy dziesięciu liniach po 300 m trzy kilometry
      baterii wyrzucone
- [x] Bzdury odrzucane PRZED lotem, nie na lotnisku: jeden punkt, sto punktów,
      900 m wysokości, 40 m/s
- [x] Plik sprawdzany **cudzą implementacją** — Pythonowym `zipfile`
      i parserem XML. Własnym kodem potwierdzilibyśmy tylko, że umiemy
      odczytać to, co sami zapisaliśmy

### Czego NIE potwierdziłem

**Ani jeden wygenerowany KMZ nie przeszedł przez prawdziwego drona.**
Struktura WPML jest odtworzona z dokumentacji i otwartych generatorów;
kontener jest zweryfikowany, semantyka nie. Do tego na KONSUMENCKIM Mavicu 3
nie ma oficjalnej drogi wgrania własnego KMZ — trzeba utworzyć w DJI Fly
zastępczą misję i podmienić jej plik. Działa, ale jest obejściem.

CCAPI nie widziało prawdziwego aparatu — atrapa jest zbudowana z dokumentacji.
Telemetria SRT nie widziała pliku z prawdziwej karty.

### Czego świadomie nie robimy

- **Wszystko wokół M3T/M3M** (Thermogram, IRMapper, `m3m_radcal`,
  `metashape_ortho`, `harpia`, datasety termiczne) — to osprzęt, którego
  Marcin nie ma. Jakaś jedna trzecia przysłanych zrzutów
- **FreeFCC-USB, dji-mavic-fcc** — zdejmowanie ograniczeń mocy nadajnika.
  W UE wychodzi poza dopuszczalne CE
- **Odblokowywanie baterii, DroneID przez SDR, modele w Simulinku i Webots,
  klony stron DJI** — szum
- **MMT** (154★) — dobre narzędzie do porządkowania plików, ale nakłada się
  na istniejącą ścieżkę do OneDrive, zamiast dokładać
- **Nakładka telemetryczna na wideo** (dronetrace, GPStitch, OVRLEY) — to
  renderowanie ffmpegiem. Cosmos oddaje dane, obraz robi się w Premierze

## ✅ Partia 40 — Plener: foto i wideo dostają własne miejsce (GOTOWE)

Pytanie Marcina było krótkie: *„skoro te funkcjonalności foto/wideo to duża
partia, to może trzeba wydzielić osobną pozycję w menu tylko na to?"*.
Zanim odpowiedziałem, policzyłem, gdzie te funkcje właściwie są:

| Funkcja | Gdzie mieszkała | Kiedy widoczna |
|---|---|---|
| sprzęt (korpus, obiektywy, dodatki) | Ustawienia, między mikrofonem a profilem | zawsze |
| plan zdjęciowy | podpanel **wewnątrz podglądu kamery** | tylko przy włączonej kamerze i znanej lokalizacji |
| aparat po Wi-Fi | wiersz w tamtym podpanelu | jw. |
| archiwum materiału | Ustawienia | zawsze |
| rozpoznawanie ptaków | nakładka trybu głosowego | tylko w trybie głosowym |
| **misja KMZ** | — | **nigdzie** |
| **karty ujęć** | — | **nigdzie** |

Dwie ostatnie pozycje rozstrzygnęły sprawę. `/api/plan/mission` i `lib/ujecia.js`
były zbudowane, przetestowane i całkowicie nieosiągalne z interfejsu: misję dało
się pobrać wyłącznie żądaniem HTTP, a listę ujęć zobaczyć tylko wtedy, gdy model
sam zdecydował się użyć narzędzia `[PLAN:]`. Bateria tego nie łapała, bo trasy
odpowiadały — więc wszystko „działało".

- [x] **Nowa pozycja „Plener"** w panelu bocznym, tuż nad Nauką. Stoi obok Studia
      świadomie: w Studiu obraz się **generuje**, w Plenerze się go **kręci**
- [x] **Plan zdjęciowy bez kamery** — dla nazwy MIEJSCA i wybranej GODZINY.
      To nie jest przeniesione pole, tylko nowa zdolność: „co zabrać w sobotę
      do Krakowa na 18:30" wcześniej nie miało w interfejsie odpowiedzi
- [x] **Karty ujęć na ekranie** — z ogniskową, ruchem kamery i czasem trwania,
      plus lista pominiętych z powodem („wymaga drona"). Każdą pozycję da się
      **odhaczyć** i postęp przeżywa przeliczenie planu — bez tego „lista do
      odhaczenia" byłaby obietnicą na wyrost. Stan siedzi w przeglądarce, bo
      „nakręciłem" to fakt o jednym dniu zdjęciowym, a nie o Marcinie
- [x] **Misja waypointowa z formularza** — siatka nalotu → plik `.kmz` do pobrania
- [x] **Aparat po Wi-Fi** przeniesiony z podglądu kamery; doszła zdalna migawka
      (świadomie tylko pod ludzkim palcem — model tego narzędzia nie dostaje)
- [x] **Sprzęt i archiwum** przeprowadzone z Ustawień; w Ustawieniach został
      drogowskaz, bo szukanie ich tam jest odruchem po miesiącach
- [x] `tests/zestawy/plener.js` — sprawdza całą drogę z interfejsu, w tym
      pobrany KMZ **cudzą implementacją** (`zipfile` + parser XML)

### Błąd wyłapany przy okazji: reguła 180° zaokrąglana do drabinki zdjęciowej

Test interfejsu pokazał „1/60" tam, gdzie przy 25 kl./s ma być 1/50 — czas wideo
przechodził przez `najblizszy(CZASY, …)`, czyli przez klasyczną drabinkę czasów
aparatu, w której pięćdziesiątki nie ma. Dwa skutki, oba realne:

1. reguła 180° przestawała być regułą — 1/60 przy 25 kl./s to kąt 150°,
2. **pod polską siecią 50 Hz** świetlówki i LED-y migoczą 100 razy na sekundę,
   więc 1/50 i 1/100 są czasami bezpiecznymi, a 1/60 daje przewijające się pasy
   w każdej hali, kościele i biurze.

W trybie filmowym aparat oferuje pełną drabinkę wideo, więc nie ma czego
zaokrąglać. Czas jest teraz dokładnie `1/(2×klatki)`, a przy klatkażach, które
nie dzielą się na 50 (np. 60 kl./s), plan sam ostrzega o migotaniu.

## ✅ Partia 41 — dwa narzędzia, które nie umiały powiedzieć prawdy (GOTOWE)

Pierwsze uruchomienie Pleneru na serwerze Marcina wyciągnęło dwie usterki
tej samej rodziny: narzędzie diagnostyczne oddające wynik, z którego nie
da się wyciągnąć wniosku.

### Audyt przy ustawionym haśle sprawdzał dokładnie nic

Serwer próbny czyta `.env`, więc na maszynie z `COSMOS_PASSWORD` wszystkie
trasy oddawały 401. Audyt liczył to jako sukces („✓ 63 trasy bez wywrotki"),
bo 401 to nie 500 — czyli przepuściłby dowolną wywrotkę za bramką.
Jednocześnie strumień zdarzeń dostawał to samo 401 i szedł do PROBLEMÓW.
Naraz krzyk o poprawnym zachowaniu i cisza o niesprawdzonym kodzie.

- [x] serwer próbny dostaje WŁASNE, losowe hasło — audyt zachowuje się
      tak samo u każdego, niezależnie od `.env`
- [x] bramka sprawdzana NA ŻYWO, a nie tylko czytana z kodu: 401 bez sesji,
      401 przy złym haśle, ciastko przy dobrym
- [x] 401 na trasach jest od teraz USTERKĄ z nazwy („audyt stracił sesję —
      rozruch próbny nic nie sprawdził"), nigdy cichym „przeszło"

### Prognoza zorzy: adres odpowiadał, danych nie było

`Kp teraz` przychodziło, prognoza wychodziła pusta — i nie było jak odróżnić
„NOAA nie odpowiada" od „zmienił się kształt danych" od „naprawdę pusto".
Cisza była odziedziczona po bibliotece, która połyka błędy CELOWO (zorza to
dodatek i nie może blokować planu) — ale narzędzie diagnostyczne nie ma
prawa być ciche.

- [x] `scripts/zorza.js` pyta oba źródła osobno, a przy pustce **sam pokazuje
      surową odpowiedź**: kod HTTP, typ treści, kształt i pierwsze wiersze
- [x] werdykt oparty na połowie danych jest oznaczony — „brak" z samego
      bieżącego Kp znaczy „nie ma TERAZ", a nie „nie będzie dziś w nocy"
- [x] domyślne współrzędne z zapisanej lokalizacji, nie z Warszawy na sztywno
- [x] **czytnik prognozy przestał zakładać układ kolumn.** Rozpoznaje pola
      po treści (znacznik czasu wygląda jak data, Kp jest liczbą 0-9), więc
      przeżyje brak nagłówka, przestawione kolumny i obiekty zamiast tablic.
      Wiersz nagłówka odpada sam, bo nie spełnia żadnego z warunków
- [x] `tests/zestawy/zorza-ksztalty.js` — te same dane w czterech układach
      mają dać ten sam wynik; pusto ma zostać pusto

Po poprawce prognoza ruszyła u Marcina od pierwszego uruchomienia: 8 wpisów,
szczyt Kp 3,33. **Oba źródła zorzy działają na żywo** — to zamyka ostatnią
otwartą pozycję z Partii 36.

- [x] Skrypt wypisuje KSZTAŁT odpowiedzi także wtedy, gdy wszystko działa
      (`· tablica obiektów (8; time_tag, kp, observed)`). Czytnik odporny na
      kilka układów naraz jest dobry, ale skutecznie zasłania odpowiedź na
      pytanie „a jak to wygląda naprawdę" — a bez niej atrapa w testach
      zbudowana na złym założeniu utrwala pomyłkę na lata

### Co NOAA naprawdę oddaje — potwierdzone i wpisane do atrap

Wydruk z serwera Marcina rozstrzygnął pytanie, którego nie dało się rozstrzygnąć
z tego kontenera (403 na oba adresy):

| Produkt | Kształt |
|---|---|
| `planetary_k_index_1m.json` | tablica obiektów (358) — `time_tag, kp_index, estimated_kp, kp` |
| `noaa-planetary-k-index-forecast.json` | tablica obiektów (81) — `time_tag, kp, observed, noaa_scale` |

Czyli **tablica obiektów**, a nie tablica tablic z wierszem nagłówka, jak
zakładałem. To wyjaśnia pierwotną usterkę do końca: czytnik brał `w[0]` i `w[1]`
z obiektu, dostawał `undefined`, prognoza wychodziła pusta.

- [x] `mock-grafiki.js` oddaje teraz TEN kształt — atrapa i NOAA mówią wreszcie
      tym samym językiem. Stary układ został pod osobnym adresem, bo raz już
      nas zaskoczyli
- [x] W atrapie bieżącego Kp pole `kp` jest napisem z literą („4P", „7M"),
      tak jak w prawdziwym produkcie — pułapka na wypadek, gdyby ktoś
      przestawił odczyt z `kp_index` na `kp` i dostał NaN
- [x] Sprawdzenie „prognoza Kp pusta" w `scenariusze` wreszcie coś znaczy:
      wcześniej atrapa i czytnik zgadzały się ze sobą i przechodziło zawsze

⚠ To nadal nie gwarantuje, że układ nie zmieni się jutro — dlatego czytnik
rozpoznaje pola po treści, a nie po pozycji.

## ✅ Partia 42 — dwie uwagi Marcina do gotowej listy ujęć (GOTOWE)

Marcin obejrzał pierwszy prawdziwy plan na góry i zgłosił dwie rzeczy. Obie
były usterkami i obie da się zobaczyć wyłącznie patrząc na WYNIK — z kodu
żadna nie wygląda podejrzanie.

### „Przelot dronem, a wskazane 24-105 f/4 — to obiektyw na Canonie"

Dobór szkła szedł po JEDNEJ liście dla wszystkich ujęć, więc kadr z Mavica
dostawał obiektyw od korpusu. Liczba 24 mm nawet się zgadzała, bo tyle wyszło
z przycięcia zakresu ujęcia do 24-105 — czyli sprawdzanie samej ogniskowej
tego by NIE złapało. Przy innym zestawie wyszłoby cokolwiek.

Rada oparta na sprzęcie, którego nie da się zamontować, podważa całą resztę
listy: skoro to nieprawda, to co jeszcze?

- [x] `OPTYKA_DRONOW` — Mavic 3 to Hasselblad 24 mm f/2.8 + tele 162 mm f/4.4,
      Mavic 2 to 28 mm, Mini/Air 24 mm f/1.7
- [x] Ujęcia z `potrzebuje: ['dron']` liczą się na optyce DRONA; naziemne dalej
      na obiektywach korpusu
- [x] Nieznany dron mówi wprost, że zakłada („kamera drona (zakładam ok. 24 mm)"),
      zamiast podawać ogniskową jak pewnik
- [x] Pominięcie z powodu mówi teraz, CO dron ma („a DJI Mavic 3 ma 24 mm i 162 mm")

### „Nie daje ujęć kończących, a na liście są też kilka otwarć"

W całym katalogu nie było ANI JEDNEJ karty domykającej. Zestaw na góry dawał
ujęcie ustalające i przelot z odsłonięciem — oba otwarcia — i kończył się
detalem. Materiał zmontowany z takiej listy zaczyna się dwa razy i nie kończy
wcale.

- [x] Cztery nowe karty domykające: **wyjście z kadru**, **odjazd na koniec**,
      **ostatni kadr, który sam gaśnie**, **wznos na koniec** (dron)
- [x] `rola` przy każdej karcie (otwarcie / rozwinięcie / domknięcie), widoczna
      w interfejsie jako plakietka — bez niej lista wygląda jak worek pomysłów
- [x] Wszystkie 22 zestawy dostały domknięcie; lista wychodzi POSORTOWANA
      otwarcie → rozwinięcie → domknięcie
- [x] Gdy domknięcie z zestawu wypadnie przez brak sprzętu (na górach wymagało
      drona), `planUjec` dokłada zastępcze, które niczego nie wymaga —
      **lista bez zakończenia nie jest dopuszczalnym wynikiem**
- [x] „Kadr z góry prosto w dół" przeklasyfikowany z otwarcia na rozwinięcie:
      abstrakcyjny kadr nie mówi widzowi, GDZIE jest, a od tego jest otwarcie.
      To on robił zestawy z trzema otwarciami
- [x] `karty-ujec` sprawdza teraz strukturę wszystkich 22 zestawów w dwóch
      wariantach sprzętu: min. jedno domknięcie, maks. dwa otwarcia

### Trzecia usterka z tych samych zrzutów: misja nad złym miejscem

Na zrzucie Marcina plan był policzony dla **Zakopanego**, a w misji drona
stały współrzędne **52,012 / 20,902 — czyli domu**. Cicho, bez żadnego znaku.

Mechanizm: panel liczy plan zaraz po otwarciu, jeszcze dla zapisanej
lokalizacji, i wtedy wypełnia pola misji. Warunek brzmiał „uzupełnij, gdy oba
pola są puste" — więc po wpisaniu „Zakopane" i przeliczeniu planu pola już
puste nie były i zostawały z domem. Wychodził z tego plik lotu nad zupełnie
innym miejscem. W narzędziu, które steruje dronem, to najgorszy możliwy
rodzaj błędu: wynik wygląda poprawnie i jest nieprawdziwy.

- [x] Współrzędne misji idą za planem przy KAŻDYM przeliczeniu, chyba że
      wpisano je ręcznie — ręczny wpis dalej wygrywa, bo trzeba móc polecieć
      nad miejscem innym niż to, dla którego liczy się światło
- [x] Pod polami stoi teraz podpis, SKĄD są: „Współrzędne z planu: Kraków"
      albo ostrzeżenie, że wpisano je ręcznie. Dwie liczby same z siebie nie
      mówią, czy to Zakopane, czy dom
- [x] `📍 Z planu` wraca do miejsca z planu i kasuje oznaczenie ręcznego wpisu
- [x] Zestaw `plener` odtwarza dokładnie tę ścieżkę — i **sprawdziłem, że
      wywala się na starym kodzie** (52,0247 zamiast 50,06). Warunkiem
      koniecznym jest zapisana lokalizacja w danych testowych; bez niej
      pierwsze przeliczenie kończy się błędem, pola zostają puste i test
      przechodzi nawet na zepsutym kodzie

### Czego jeszcze nie mówiła misja, a powinna

Patrząc na ten sam ekran z Zakopanem doszły dwie rzeczy, o które nikt nie
pytał, ale które przy locie w Tatrach mają znaczenie:

- [x] **Wysokość jest względem PUNKTU STARTU, nie terenu.** Plik zapisuje
      `relativeToStartPoint`, więc 80 m nad miejscem startu w dolinie to
      80 m nad doliną, a nie nad zboczem, które w tę trasę wchodzi.
      Ostrzeżenie stoi teraz wprost przy formularzu
- [x] **Ile to właściwie lotu** — „5 linii (10 punktów) · trasa 1,20 km ·
      ok. 4 min lotu", liczone na żywo przy zmianie parametrów. Pola
      „200 × 200, co 50 m" nie mówią, czy to trzy minuty, czy czterdzieści,
      a misja dłuższa niż bateria przerwie się w połowie i dron wróci do domu
- [x] Dwa twarde progi: powyżej 99 punktów (limit formatu WPML) i powyżej
      18 min lotu (bateria z rezerwą) formularz mówi o tym PRZED pobraniem
- [x] Zestaw `plener` porównuje oszacowanie z przeglądarki z tym, co naprawdę
      generuje `siatka()` — dwa niezależne kawałki kodu, które łatwo rozjechać

Sprawdzone przy okazji i NIEbędące usterką: przecinek dziesiętny w polach
(„52,01216") to polskie formatowanie pola `type=number`. `value` oddaje
`52.01216` z kropką, pobranie `.kmz` działa w locale `pl-PL`.

### Przy okazji, ze zrzutu ekranu: „70-200 f/4 f/4"

Nazwa obiektywu z `rozpoznajObiektywy` zawiera już jasność, a kod doklejał
drugą. Widoczne gołym okiem, niewidoczne dla wszystkich ówczesnych sprawdzeń.

## ✅ Partia 43 — archiwum na 59 421 plikach: cztery przyczyny jednej porażki (GOTOWE)

Marcin zapytał „pokaż zdjęcia, które zrobiłem w tym roku na Mazurach".
Cosmos przez kilkanaście wywołań narzędzia nie znalazł nic, a na koniec
orzekł, że w archiwum **nie ma zdjęć z aparatu — same zrzuty ekranu**.
Nieprawda; Canon leżał w indeksie od początku.

Najważniejsze w tej partii jest to, czego NIE było: **halucynacji**. Model
dostał polecenie „odpowiadaj na podstawie tych danych, nie zgaduj" i zrobił
dokładnie to. Wnioski były poprawne — przesłanki nie.

### 1. Do modelu szło sześć plików z pięćdziesięciu dziewięciu tysięcy

Wynik archiwum leciał jako `JSON.stringify(dane).slice(0, 12000)`. Sam adres
jednej miniatury z OneDrive to **1248 znaków** podpisanego tokenu, przy ~520
znakach reszty wpisu. Rachunek: w budżecie mieściło się **6 plików**, a **71%**
tego, co czytał model, stanowiły adresy obrazków — których nawet nie ogląda,
bo w tym samym promptcie piszemy mu, że miniatury pokazaliśmy już człowiekowi.
`slice` do tego ucinał napis w połowie JSON-a, więc dokument był składniowo
zepsuty.

Ponieważ sortujemy od najnowszych, tych sześć plików to zawsze były ostatnie
zrzuty ekranu z telefonu.

- [x] `naKontekst()` wycina miniatury, identyfikatory i puste pola, i dopasowuje
      liczbę wpisów do budżetu zamiast ciąć napis na ślepo
- [x] Na górze stoi zdanie **„widzisz N z 59 421, to jest PRÓBKA"** wraz
      z zakazem wnioskowania z niej o tym, czego w archiwum nie ma
- [x] Zmierzone: **8 wpisów z niepoprawnym JSON-em → 40 wpisów, poprawny JSON,
      o 30% krótszy kontekst**

### 2. Folderów nie dało się przeszukiwać, choć ścieżki są w indeksie

`sciezka` zapisywana od zawsze, filtry tekstowe obejmowały aparat, obiektyw,
miejsce i nazwę. Marcin porządkuje materiał katalogami („Mazury 2026",
„Zdjęcia Mazury 2024 Dron") i to jest jego prawdziwy indeks.

- [x] Filtr `folder=` porównujący fragment ścieżki bez ogonków i wielkości
      liter — „zdjecia mazury" trafia w „/Zdjęcia Mazury 2024 Dron/"
- [x] Model dostał instrukcję: **gdy człowiek mówi o folderze, użyj `folder=`,
      a nie `miejsce=`**

### 3. Zdjęcia z Canona nie miały się czym przedstawić

Microsoft Graph czyta metadane z JPEG-ów, ale CR2/CR3 nie rusza — facet `photo`
przychodzi pusty. Dociąganie EXIF-u istniało i działało, tylko z przeczytanego
pliku zapisywało **wyłącznie obiektyw**, wyrzucając datę, aparat, ISO, przysłonę,
czas, ogniskową i GPS. Każde zdjęcie z R6 II miało więc `aparat: null` i datę
**wgrania** zamiast daty zrobienia — w wynikach nie do odróżnienia od zrzutu
ekranu.

- [x] Backfill zapisuje wszystko, co przeczytał; dane z pliku wygrywają z tym,
      co dał Graph
- [x] Znacznik `exifCzytany` — bez niego pliki bez obiektywu (RAW-y, skany)
      wracały do kolejki w nieskończoność i paczka mieliła w kółko te same
- [x] Przycisk nazywa się teraz **„Dociągnij dane z plików"**, bo to robi

### 4. „Mazury" to dla Nominatim wieś w obwodzie lwowskim

Geokodowanie szło bez preferencji kraju, więc pierwszym wynikiem na świecie
była Мазури (49,82 N 23,04 E), promień 5 km. Marcin trzy razy potwierdzał
„chodzi o Polskę" i trzy razy dostawał to samo, bo do Nominatim leciało samo
słowo „Mazury".

- [x] `GEOCODE_COUNTRY` (domyślnie `pl`): pytamy najpierw w kraju użytkownika,
      a gdy tam nic nie ma — ponownie globalnie, żeby „Toskania" dalej działała

### 5. Model pytał archiwum w kółko tym samym filtrem

- [x] Powtórzone zapytanie nie idzie do serwera; model dostaje wprost „to jest
      to samo pytanie, zmień filtry albo odpowiedz tym, co wiesz". Kręcenie się
      w kółko wypalało budżet tokenów i **urywało odpowiedź w pół zdania** —
      stąd obcięte wypowiedzi na zrzutach

⚠ Czego ta partia NIE naprawia: pracy w tle. Zamknięcie karty nadal przerywa
generowanie („connection error"), bo odpowiedź żyje w strumieniu SSE do
przeglądarki. To osobna zmiana architektoniczna, opisana Marcinowi wcześniej.

## ✅ Partia 44 — kolejka wiadomości i rozmowa, która wznawiała się sama (GOTOWE)

Dwie uwagi z jednej rozmowy Marcina.

### Pisanie w trakcie odpowiedzi

Do tej pory pole tekstowe było w czasie generowania martwe: `sendMessage`
wychodziło od razu przy `isGenerating`. Myśl, która przyszła w połowie
czytania, trzeba było trzymać w głowie albo przerywać odpowiedź.

- [x] Wiadomość napisana w trakcie ląduje w **widocznej** kolejce nad polem —
      nie „gdzieś", tylko na ekranie, z treścią
- [x] Rusza sama po zakończeniu odpowiedzi, w kolejności napisania
- [x] Da się ją **wyjąć** przed wysłaniem; w połowie odpowiedzi często okazuje
      się, że pytanie było niepotrzebne
- [x] W trybie głosowym kolejka nie rusza — tam rozmowa idzie mikrofonem
      i mieszanie dwóch kanałów wprowadzałoby chaos

### „Bez napisania przeze mnie kolejnej wiadomości Cosmos sam się wznawiał"

Znaleziona przyczyna, nie hipoteza. Wynik narzędzia wraca do modelu jako
wiadomość z rolą `user` — taki jest protokół rozmowy. Na ekranie odróżnia je
**jedynie** flaga `search`: z nią rysuje się zwijany blok „Przeszukuję…", bez
niej zwykły dymek użytkownika. Jedna gałąź jej nie ustawiała — ta dopisana
w Partii 43, odcinająca powtórzone zapytanie do archiwum. Efekt: w rozmowie
pojawiało się długie pytanie, którego Marcin nie napisał, a model grzecznie na
nie odpowiadał. Wiadomość szła też na dysk, więc wracała przy każdym wczytaniu
rozmowy.

- [x] Wszystkie ruchy narzędzi (wyszukiwarka, archiwum, plan, uruchamianie
      kodu, grafiki) idą jedną furtką `dodajWynikNarzedzia`, która flagi
      pominąć nie potrafi
- [x] Zestaw pilnuje, żeby nikt jej nie obszedł: w `runGeneration` nie może
      zostać ani jedna surowa wstawka `role: 'user'` (przed poprawką było 7)
- [x] Rozmowy zapisane wcześniej naprawiają się przy wczytaniu — dymek chowa
      się do zwijanego bloku

## ✅ Partia 45 — praca w tle: odpowiedź przestaje mieszkać w karcie (GOTOWE)

Marcin: „Jak wychodzę ze strony lub aplikacji zainstalowanej czy to na
desktopie czy na mobile to wszystko jest przerywane i jest napisane że
connection error. Chciałbym żeby to działało wszystko też w tle jak Claude."

### Przyczyna okazała się inna, niż wyglądała

Podejrzenie padło na jedną linię w trasie czatu:

```js
req.on('close', () => abort.abort());
```

Wygląda jak dokładny opis usterki: przeglądarka się rozłącza, serwer przerywa
żądanie do modelu. **Pomiar to obalił.** `readJson(req)` na początku funkcji
wyczerpuje strumień żądania, więc `close` leci od razu po wczytaniu korpusu —
w chwili podpinania uchwytu `req.closed` jest już `true` i nie ma czego złapać.
Sonda: klient zrywa połączenie po 1,2 s, a odpowiedź rośnie dalej
(184 → 384 → 584 → 612 znaków) i kończy się normalnie. **Ta linia nigdy nie
działała.**

Prawdziwa przyczyna była prostsza i gorsza: odpowiedź istniała **wyłącznie
w przeglądarce**. Serwer czytał ją od modelu do końca, dopisywał do gniazda,
którego nikt już nie słuchał, i wyrzucał — nigdzie jej nie zapisując. Zamknięta
karta znaczyła: model policzył swoje, zapłaciliśmy za tokeny, wyniku nie ma
i nie będzie. „Connection error" był tylko tym, co z tego widać.

### Bieg — odpowiedź należy do serwera

- [x] `lib/biegi.js`: trwająca odpowiedź to **bieg**. Przeglądarka jest widzem,
      nie właścicielem; odejście widza nie jest poleceniem przerwania
- [x] Każde zdarzenie SSE dostaje numer (`id:`), więc powrót zaczyna się
      dokładnie tam, gdzie się skończyło — bez powtórzonego pół zdania i bez luki
- [x] `/api/chat/bieg?id=&od=` — powrót z dowolnego urządzenia, także po
      odświeżeniu strony; `/api/chat/biegi` mówi, czy jest do czego wracać
- [x] Odpowiedź, po którą nikt nie wrócił, serwer **sam dopisuje do rozmowy**
- [x] Zerwane Wi-Fi w trakcie: przeglądarka wraca sama, z narastającą przerwą,
      do sześciu prób — bez pytania modelu drugi raz
- [x] Stop dolatuje do serwera (`/api/chat/stop`). Odkąd rozłączenie nie
      przerywa generowania, przerwanie musi być świadome

### Kto zapisuje — zgadywanie się nie sprawdziło

Pierwsza wersja rozstrzygała to po tym, czy w chwili końca był podłączony widz.
Gniazdo po przeładowanej stronie potrafi jeszcze chwilę żyć: serwer widział
widza, którego już nie było, odpuszczał zapis awaryjny i odpowiedź przepadała
mimo całej maszynerii.

- [x] Przeglądarka mówi wprost `/api/chat/odebrane`. Brak potwierdzenia znaczy
      „nikt jej nie ma" i wtedy zapisuje serwer. Zero dubli, zero zgubionych

### Zestaw `praca-w-tle` — mierzy to, co robił Marcin

Zadaje pytanie, **zamyka kartę** w połowie odpowiedzi, czyta plik rozmowy
z dysku serwera. Potem to samo z przeładowaniem strony w trakcie. Każdy punkt
sprawdzony przez zepsucie kodu:

| Wyłączone | Co zgłasza zestaw |
|---|---|
| pole `bieg` w żądaniu | „odpowiedź przepadła po zamknięciu karty" |
| wznowienie po starcie | „przeglądarka nie podpięła się do trwającego biegu" |
| `/api/chat/stop` | „Stop nie dotarł do serwera — odpowiedź rosła dalej" |

Odróżnienie „przeglądarka wróciła i dociągnęła" od „serwer zapisał sierotę"
idzie po znaczniku `bieg` w wiadomości — bez tego zestaw przechodziłby także
wtedy, gdyby wznowienia w ogóle nie było.

⚠ Czego to nadal NIE robi: pętli narzędzi w tle. `[SZUKAJ:]`, `[ARCHIWUM:]`
i `[PLAN:]` rozwija przeglądarka. Karta zamknięta dokładnie w połowie
wyszukiwania zapisze więc turę modelu sprzed wyszukania, a nie odpowiedź po
nim. Przeniesienie całej pętli na serwer to osobna, dużo większa zmiana.

## ✅ Partia 46 — nazwy ujęć nachodziły na plakietki na telefonie (GOTOWE)

Marcin, ze zrzutu z Galaxy S25: „Teksty w ujęciach wchodzą na siebie".
„przebitka" leżała na plakietce ROZWINIĘCIE, „wyjście z kadru" na DOMKNIĘCIE.

Nagłówek karty ujęcia to `flex`: ptaszek, nazwa, rola, liczby. Nazwa miała
`flex: 1; min-width: 0`, więc mogła się skurczyć **poniżej własnego
najdłuższego słowa** — a słowo nie ma gdzie się złamać. Zmierzone na 360 px:
pudełko nazwy „upływ czasu w kadrze" miało **22 px szerokości i 86 px
wysokości** (cztery linie), a napis wylewał się w prawo, na plakietkę.

- [x] Rola i liczby jako jedna grupa `.plener-shot-meta` — schodzą do drugiej
      linii razem, zamiast wypychać nazwę do zera
- [x] `min-width: 7em` zamiast `0` i `overflow-wrap: anywhere` na nazwę
- [x] `margin-left: auto` zamiast `justify-content: space-between` — przy
      zawijaniu `space-between` odklejał nazwę od ptaszka, do którego należy

### Pierwsza wersja sprawdzenia nie wykrywała niczego

Zestaw porównywał `getBoundingClientRect()` elementów nagłówka i na starym,
zepsutym kodzie meldował „nachodzeń: 0". Bo usterka polegała właśnie na tym,
że **pudełka się nie stykały** — wylewał się z nich napis. Prostokąty pudełek
mówiły, że wszystko jest w porządku, a na ekranie jedno leżało na drugim.

- [x] Mierzymy `Range.getClientRects()`, czyli prostokąty samych linii tekstu
      — to, co widać. Na starym kodzie zestaw zgłasza:
      „spłaszczony plan teleobiektywem × rozwinięcie (26×13 px)"

## ✅ Partia 47 — zdjęcia leżały obok planu zamiast w nim (GOTOWE)

Marcin poprosił o plan tygodniowej wycieczki na Majorkę, a potem „ze zdjęciami
proszę". Dostał osiem zdjęć **jednej** katedry, pod nimi wiszący komunikat
„🖼️ Szukam zdjęć: Katedra La Seu Palma de Mallorca…" — i ciszę. Sześć
pozostałych dni planu nie doczekało się niczego.

Cztery osobne przyczyny, cztery osobne poprawki.

### 1. Komunikat o trwającej czynności nigdy się nie kończył

„Szukam zdjęć…" był zwykłą wiadomością asystenta. Zdjęcia dochodziły pod nią
i zostawało zapewnienie, że Cosmos właśnie ich szuka.

- [x] Po znalezieniu wiadomość jest PRZEPISYWANA na „🖼️ Zdjęcia: …"
- [x] To samo przy wyszukiwaniu w internecie: „Szukam…" → „Szukane…"

### 2. Po pokazaniu zdjęć pętla się kończyła

W gałęzi grafik stało `break`. Model nie miał już jak powiedzieć, co to za
miejsca — zdjęcia lądowały obok planu, nieprzypisane do żadnego dnia.

- [x] Głos wraca do modelu: dostaje listę pokazanych zestawów z poleceniem
      „przypisz je do miejsc z planu, a o resztę przystanków poproś JEDNYM
      znacznikiem"
- [x] Hamulec `pytaniaGrafik` — powtórzona prośba o te same zdjęcia zostaje
      odcięta, tak jak w archiwum. Bez tego jedna katedra zjadłaby wszystkie
      rundy

### 3. Model prosił o jedno miejsce z siedmiu i to zapowiadał

Napisał „oto propozycje zapytań o zdjęcia… po ich wykonaniu otrzymasz
fotografie", jakby znacznik był propozycją do zatwierdzenia.

- [x] Prompt: przy planie, liście miejsc albo trasie — wszystkie kluczowe
      punkty w JEDNYM znaczniku, do czterech. „Jedno miejsce z siedmiu to nie
      jest odpowiedź na »ze zdjęciami proszę«"
- [x] Prompt: nie zapowiadaj wyszukiwania, po prostu dodaj znacznik

### 4. Źródła w formacie, w który nie da się kliknąć

Model wypisywał `【1†L1-L4】`. Instrukcja mówiła „podaj źródła" i nie mówiła jak,
a adresy miał w wynikach.

- [x] Format podany wprost: sekcja „Źródła:" i linki markdown `[tytuł](adres)`,
      po jednej w wierszu; `[1]` i `【1†L1-L4】` wymienione jako zakazane
- [x] Zasada dotyczy KAŻDEGO tematu, nie tylko podróży: ilekroć odpowiedź
      opiera się na wynikach z internetu. Gdy model odpowiada z własnej wiedzy
      — ma to napisać wprost, a nie wymyślać źródła

Nowy zestaw `zdjecia-w-planie` przechodzi całą tę drogę na atrapie modelu,
która zachowuje się jak prawdziwa: prosi o grafiki, próbuje poprosić o te same
jeszcze raz, po odcięciu dopisuje tekst. Na starym kodzie zgłasza wszystkie
trzy usterki z ekranu Marcina naraz.

## ✅ Partia 48 — urwane odpowiedzi i zdjęcia bez podglądu (GOTOWE)

Dwa zgłoszenia z tej samej rozmowy o Majorce.

### „Nie chciałbym żeby odpowiedzi były urwane"

Plan tygodniowej wycieczki kończył się w środku adresu:

```
[Majorka: 31 atrakcji…](https://www.gancarczyk.com/majorka-atrakcje-wynajem-samochodu
```

To nie była awaria sieci. Model wyczerpał `max_tokens` i zamknął strumień
z `finish_reason: "length"` — powiedział wprost „nie skończyłem". **Nikt tego
pola nie czytał**, więc kikut lądował w rozmowie jak gotowa odpowiedź.

- [x] Powód zakończenia jest czytany. Przy `length` Cosmos prosi o dalszy
      ciąg (do trzech dopisków) i **dokleja go bez spacji** — urwany adres
      musi się skleić w jeden link, a nie w dwa kawałki
- [x] Nie pytamy o odpowiedź od nowa: to drugie tyle tokenów i INNY tekst niż
      ten, który użytkownik zdążył przeczytać
- [x] Prośba o dokończenie idzie poza historią rozmowy — nie zostaje w niej
      jako pytanie, którego nikt nie zadał
- [x] Domyślny budżet z 2048 na **4096** tokenów. Dociąganie to łata;
      za ciasny domyślny limit to przyczyna
- [x] Gdy skończy się limit rund na zdjęcia, ostatnia runda ma dać TEKST.
      Wcześniej rozmowa kończyła się na „🖼️ Zdjęcia: Andratx, Fornalutx…"
      i ciszy — plan urywał się bez zdania domykającego

### „Chciałbym kliknąć zdjęcie i zobaczyć je większe"

Kliknięcie w kafelek wyrzucało od razu na obcą stronę w nowej karcie. Nie dało
się nawet obejrzeć zdjęcia.

- [x] Kliknięcie otwiera podgląd **w Cosmosie**, w pełnej rozdzielczości
      (`full`), z powrotem do miniatury, gdy obcy host odmówi
- [x] W pasku podglądu przycisk „przejdź do źródła"
- [x] Podpis: tytuł, serwis i licencja. Przy Wikimedia Commons to nie ozdoba,
      tylko warunek legalnego użycia
- [x] `href` kafelka zostaje prawdziwy, więc Ctrl+klik i „otwórz w nowej
      karcie" dalej prowadzą do źródła — nie zamieniamy jednego ograniczenia
      na drugie

Nowy zestaw `urwana-odpowiedz` sprawdza sklejenie po ODNOŚNIKU, nie po tekście:
tylko doklejenie bez spacji daje poprawny `href`. Na starym kodzie zgłasza
„adres nie skleił się w całość" i pokazuje kikut `…majorka-atrakcje-wynajem`.

## ✅ Partia 49 — „strasznie wolno to idzie": tempo archiwum (GOTOWE)

Marcin po pierwszej paczce dociągania danych z plików: licznik 71 → 96
uzupełnionych, 55 tysięcy w kolejce. „Chyba potrwa parę dni. Strasznie wolno to
idzie, a jeszcze trzeba zrobić rozpoznanie treści i wczytać telemetrię klipów."

Zmierzone, nie wywnioskowane. Trzy przyczyny, dwie nie tam, gdzie się ich
szukało.

### 1. Zapis indeksu blokował cały serwer na 5 sekund

`writeFileSync` na indeksie **97,8 MB** trwał **5,2 s** i zatrzymywał pętlę
zdarzeń — w tym czasie serwer nie obsługiwał ŻADNEGO żądania. Zapis był
odkładany o sekundę, więc przy dociąganiu stał dłużej, niż pracował.

- [x] Zapis asynchroniczny (`fs.promises`), nakładające się składane w jeden
- [x] Odstęp z 1 s na 3 s (`COSMOS_ARCHIWUM_ZAPIS_MS`)

### 2. Siedemdziesiąt megabajtów adresów, których nikt nie czyta

Z 98 MB indeksu **70 MB stanowiły adresy miniatur z OneDrive** — po 1,2 kB
podpisanego adresu na plik. Przeglądarka nigdy z nich nie korzystała: podgląd
idzie przez `/api/archive/thumb?id=`, bo adresy Microsoftu wygasają po
godzinie. Przepisywaliśmy je przy każdym zapisie za darmo.

- [x] `miniatura` nie trafia już do indeksu, a stare wpisy czyszczą się przy
      wczytaniu — indeks chudnie przy pierwszym restarcie
- [x] Zmierzone: **1720 → 472 bajty na wpis**, zapis **5,2 s → 0,4 s**

### 3. Pliki szły JEDEN PO DRUGIM

Każdy plik to jedno żądanie zakresu do Microsoftu. Sekwencyjnie opóźnienie
łącza sumuje się tyle razy, ile jest plików — przy 56 tysiącach to godziny
czystego czekania przy zerowym obciążeniu procesora.

- [x] Sześciu robotników z jednej kolejki (`ONEDRIVE_RUWNOLEGLE`), tak samo
      przy EXIF-ie i przy telemetrii klipów
- [x] Paczki większe: 100 → 300 (EXIF), 25 → 100 (telemetria)
- [x] Zmierzone na atrapie z opóźnieniem 50 ms: **3735 ms → 539 ms** na 60
      plików, szczyt równoległych żądań 1 → 6

### Czego przyczyną NIE było

`indexOf` w `dodaj()` — wygląda na koszt kwadratowy po liczbie wpisów
i było pierwszym podejrzanym. Zmierzone: **132 ms na 500 aktualizacji
z końca 59-tysięcznej tablicy**. Gdybym poszedł za intuicją zamiast za
pomiarem, przepisałbym niewłaściwą rzecz i tempo zostałoby takie samo.

Nowy zestaw `tempo-archiwum` mierzy wszystkie trzy: bajty na wpis, tyknięcia
pętli zdarzeń podczas zapisu i szczyt równoległych żądań. Na starym kodzie
zgłasza cztery usterki naraz.

## ✅ Partia 50 — dwie usterki z jednego przyspieszenia (GOTOWE)

Przyspieszenie archiwum z Partii 49 przyniosło u Marcina dwie awarie pod rząd.
Obie warto zapisać, bo obie miały tę samą wadę procesu.

### 1. Serwer nie wstawał po aktualizacji

„Coś się zepsuło. Tailscale mam connected. Nie działa i na desktop ani na
mobile." Czyszczenie adresów miniatur ze starych indeksów stało NAD
definicjami: `zapiszWkrotce()` sięgało po `zapisZaplanowany` i `ZAPIS_MS`
z martwej strefy `let`/`const`, więc moduł rzucał `ReferenceError`.

Bateria świeciła 83/83, bo **warunek zapala się wyłącznie na indeksie
zapisanym przez starszą wersję**, a wszystkie zestawy budowały archiwum od
zera. Napisałem migrację i nie sprawdziłem jej na niczym, co wymaga migracji.

- [x] Blok przeniesiony pod definicje
- [x] `tempo-archiwum` punkt 4: pisze plik indeksu RĘCZNIE, tak jak zapisała
      go poprzednia wersja, i sprawdza wczytanie, kompletność, wyczyszczenie
      i zapis na dysk

### 2. „Przerwane: kolejka nie maleje. Powód: Graph 429"

Sześć równoległych żądań przekroczyło to, co przyjmuje konto Marcina. Graph
odpowiadał 429 — a to nie awaria, tylko prośba o zwolnienie, z nagłówkiem
`Retry-After` mówiącym na ile. Leciało jako zwykły błąd, więc cała paczka
trzystu plików przepadała, kolejka nie malała i przeglądarka słusznie
zatrzymywała zadanie.

- [x] Wspólny hamulec w `lib/onedrive.js`: 429/503/509 → odczekaj tyle, ile
      każe `Retry-After` (bez nagłówka: 5, 10, 20, 40 s) i powtórz to samo
      żądanie. Przerwa jest WSPÓLNA dla wszystkich robotników — gdyby każdy
      odczekiwał osobno, pozostali waliliby dalej w zamknięte drzwi
- [x] Domyślnie cztery naraz zamiast sześciu
- [x] Panel mówi „Microsoft każe zwolnić (429), czekam N s i próbuję dalej",
      zamiast kończyć zadanie. Poddajemy się dopiero po pięciu podejściach
      bez postępu
- [x] `tempo-archiwum` punkt 5: prawdziwy serwer HTTP udający Graph odbija
      trzy pierwsze żądania z `Retry-After: 1`. Bez hamulca zestaw zgłasza
      cztery usterki naraz

### Wspólny wniosek

Obie usterki żyły w miejscach, których żaden zestaw nie odwiedzał: w przejściu
ze starego stanu i w odpowiedzi, której atrapy nigdy nie dawały. Szybkość
zmierzyłem rzetelnie i to była dobra robota — ale mierzyłem tylko drogę,
którą sam wybrałem.

## ✅ Partia 51 — pusty plik, ślepy panel (GOTOWE)

### Cztery puste pliki zatrzymały 56 tysięcy

„Przerwane: kolejka nie maleje (4 do zrobienia). Powód: Graph 416". `416`
(„Requested Range Not Satisfiable") dostajemy dla plików **pustych**: prosimy
o bajty 0-N, a w pliku nie ma ani jednego. To samo `404` i `410` — plik
skasowany między indeksowaniem a odczytem.

- [x] `404`, `410`, `416` znaczą „tego pliku nigdy nie przeczytasz": zwracamy
      pusto zamiast rzucać, wpis dostaje znacznik „sprawdzony", kolejka rusza
- [x] Bez ponawiania — czekanie na odpowiedź, która znaczy „nigdy", to
      35 sekund straty na plik

### „Telemetria odczytana z 0 klipów" nie mówiło nic

A przyczyny są trzy i wymagają różnych reakcji: pliki puste, zwykłe napisy
zamiast telemetrii, albo wariant formatu DJI, którego czytnik nie zna.

- [x] Komunikat podaje liczbę plików bez telemetrii, a przy zerowym wyniku
      pokazuje **początek pierwszego odrzuconego pliku** — jedyna droga, żeby
      odróżnić te trzy przypadki bez zgadywania

### Panel nie umiał powiedzieć, czy praca się skończyła

Po kilku godzinach dociągania stan brzmiał „W archiwum: 59 421 plików" i tyle.
Żeby dowiedzieć się, czy coś zostało, trzeba było **kliknąć przycisk** — czyli
uruchomić zadanie po to, by się przekonać, że nie ma go po co uruchamiać.

- [x] `/api/onedrive/status` oddaje postęp; panel pisze „Dane z plików: 56 003
      z 59 421 zdjęć (zostało 0) · telemetria do wczytania: 0 klipów"
- [x] Liczone jednym przebiegiem, bez czterech kopii indeksu na każde otwarcie

## ✅ Partia 52 — „wiem, że mam te zdjęcia" (GOTOWE)

Marcin, po zakończeniu dociągania danych: „Pokaż ujęcia z zachodu słońca
z Mazur" → cztery rundy „nie udało się znaleźć". Potem „zdjęcia z Mazur do 14"
→ zero. Potem „po 14" → 804 pliki, wszystkie wieczorne. Napisał: „wiem, kiedy
robiłem zdjęcia na Mazurach (…) jest dużo więcej zdjęć wykonanych przed
południem i po południu".

Miał rację. Archiwum go okłamało z **trzech niezależnych powodów**.

### 1. Nie było filtra po zegarze

Istniały `od`/`do` (konkretne daty z godziną) i `poraDnia`. `poraDnia` wygląda
jak odpowiedź na „przed 14", ale liczy się z **położenia Słońca**: zdjęcie
z 14:27 ma `poraDnia: wieczor`, bo Słońce jest już na zachód od południa.
Model, pytany o zegarek, sięgał po astronomię i dostawał wynik wyglądający na
prawdziwy.

- [x] `godzinaOd=` / `godzinaDo=` — godzina zegarowa 0–23, górna granica
      wyłączna („do 14" = przed czternastą). Rozumie też „14:30"
- [x] Instrukcja mówi wprost: **zegar to nie pora dnia**, i że filtrowanie
      pytania o zegar przez `poraDnia` daje odpowiedź, która wygląda na
      prawdziwą i nie jest

### 2. `miejsce=Mazury` nie mogło zadziałać

Ten filtr zamienia nazwę na współrzędne i filtruje po promieniu — a zdjęcia
z lustrzanki nie mają GPS. 804 pliki leżały w katalogu „/Mazury 2026/"
i były niewidoczne dla zapytania o miejsce. Model przez cztery rundy
tłumaczył, że folder nazywa się pewnie inaczej. **Nie nazywał się.**

- [x] Zero wyników po `miejsce=` + trafienie tej samej nazwy w ścieżkach =
      wynik niesie `zamiastMiejsca`: „804 pliki mają »Mazury« w ścieżce,
      powtórz z `folder=`". Przy poprawnym wyniku podpowiedzi nie ma
- [x] Instrukcja: gdy dostaniesz `zamiastMiejsca`, to jest gotowa odpowiedź —
      nie tłumacz użytkownikowi, że pewnie nazwał folder inaczej

### 3. `przeliczSwiatlo()` naprawiał połowę rachunku

Znalezione przy pisaniu zestawu, nie w zgłoszeniu. Po ustawieniu lokalizacji
funkcja przeliczała `swiatlo` dla plików bez GPS — ale **nie** `poraDnia`,
liczone z tego samego położenia Słońca. Kto ustawił dom PO zindeksowaniu,
dostawał indeks z wypełnioną fazą światła i pustą porą dnia, więc
`poraDnia=rano` cicho zwracało zero.

- [x] Oba pola odświeżają się razem

### Zestaw, który najpierw nic nie mierzył

Punkt 2 przechodził, pokazując `poraDnia: null` dla wszystkich wpisów —
bo w teście nie było ustawionego domu. Guard `>= 18` nie miał czego sprawdzać
i test świecił na zielono, nie mierząc niczego. Dopiero odtworzenie sytuacji
z serwera Marcina (dom ustawiony, GPS brak) pokazało prawdę: **14:15 → wieczor**.
Przy okazji wyszła usterka nr 3.

## ✅ Partia 53 — rozpoznawanie treści też szło po jednym (GOTOWE)

Marcin, po uruchomieniu: „schodzi po 30 w ciągu około 36 sekund", przy
55 206 w kolejce. To osiemnaście godzin.

Przy EXIF-ie i telemetrii zrównoleglenie już było — rozpoznawanie treści
zostało sekwencyjne, a jest najdroższe z całej trójki: **trzy kolejki po sieci
na każde zdjęcie** (adres miniatury z Graph, pobranie miniatury, wysyłka do
YOLO na komputer domowy przez Tailscale). Sekwencyjnie sumują się wszystkie
trzy, a procesor VPS-a stoi bezczynnie.

- [x] Pula trzech robotników (`YOLO_RUWNOLEGLE`), nie czterech jak przy
      EXIF-ie: na końcu stoi **jedna karta graficzna**, więc nie ma sensu
      ustawiać przed nią długiej kolejki. Zysk bierze się z tego, że
      pobieranie następnej miniatury dzieje się w tle rozpoznawania
      poprzedniej
- [x] Plik, którego nie udało się przerobić, NIE dostaje znacznika
      `obejrzane` — awaria sieci nie może cicho wykreślić zdjęcia z kolejki
      na zawsze. Zestaw sprawdza to wprost, na atrapie, w której wszystko pada

Zmierzone na atrapie: szczyt równoległych żądań **1 → 3**, ten sam zestaw
zdjęć w **930 ms → 325 ms**.

## ✅ Partia 54 — RAW i JPG to jedno zdjęcie (GOTOWE)

Zrównoleglenie z partii 53 pomogło, ale za mało: **30 zdjęć w ~36 s**, potem
**184 w 5 minut**. Zamiast zgadywać, gdzie ucieka czas, wstawiliśmy trzy
stopery — po jednym na etap — i pierwsza paczka odpowiedziała sama:

```
adres 628 ms · pobranie 6805 ms (99 kB) · YOLO 220 ms · 3 naraz
```

**89% czasu to pobranie 99 kilobajtów.** To nie jest wolne łącze: dociąganie
EXIF-u brało 128 kB na plik przy ~500 kB/s z tego samego VPS-a. To Microsoft
**generuje podgląd u siebie**, bo w pliku CR3 nie ma gotowej miniatury
w rozmiarze „large". Karta graficzna w domu stała w tym czasie na 18% i 46 °C.

A Marcin fotografuje w RAW+JPEG, więc obok `3B9A4860.CR3` leży
`3B9A4860.JPG` — ten sam kadr, ta sama sekunda, ten sam folder.

- [x] Kolejka rozpoznawania grupuje pliki w KADRY i pyta o **najtańszy** plik
      w kadrze (JPG/PNG/HEIC przed CR3/CR2/NEF/SRW/ARW/DNG). Etykiety dostaje
      całe rodzeństwo, z jednego rozpoznania
- [x] Gdy tańszy plik padnie (404, zniknął), próbujemy kolejnego z tego
      samego kadru — jeden zepsuty plik nie kasuje pary
- [x] Bliźniak obejrzany WCZEŚNIEJ oddaje etykiety za darmo, bez żądania.
      U Marcina kilkanaście tysięcy plików przeszło rozpoznanie, zanim
      parowanie w ogóle powstało
- [x] `/api/archive/thumb` idzie tą samą drogą: kafelek z RAW-em w panelu
      archiwum i w siatce zdjęć w rozmowie ładuje się przez JPG-owego
      bliźniaka
- [x] Pula podniesiona z trzech robotników do **dwunastu** (`YOLO_RUWNOLEGLE`,
      górny limit 32). Pierwotna obawa — „na końcu stoi jedna karta graficzna"
      — okazała się nietrafiona: karta dostaje 220 ms pracy na osiem sekund
      czekania
- [x] Panel pokazuje zysk i hamulec wprost: „… · N z pary RAW+JPG · Graph
      prosił o zwolnienie N× · na żądanie: …". Licznik dławień jest po to, żeby
      `YOLO_RUWNOLEGLE` dało się ustawiać z odczytu, a nie na wyczucie
- [x] Limit czasu na pobranie miniatury 20 → 30 s. Przerwane pobranie to nie
      tylko strata tej pracy: plik wraca do kolejki i Microsoft generuje
      podgląd DRUGI raz
- [x] `/detect` w zmysłach zdjęte z pętli zdarzeń (`def` zamiast `async def`
      + zamek na modelu). Przy kilkunastu zdjęciach naraz `async` blokowałby
      też `/health`, a Cosmos uznawał wtedy komputer domowy za wyłączony

### Pierwsza wersja klucza znalazła ZERO par

Grupowanie szło po pełnej ścieżce bez rozszerzenia. Na atrapie działało,
u Marcina nie znalazło **ani jednej pary** — w panelu nie pojawiło się „N
z pary" ani razu. Powód podał on sam:

> „Z reguły pracowałem na RAW, dlatego jest tylko kilka folderów, gdzie RAW
> i JPG tego samego zdjęcia są obecne. Dodatkowo nieraz robiłem tak, że
> rozdzielałem jpg i raw w dwóch folderach, albo jpg trafiały do podfolderu
> z jpg w folderze zawierającym pliki RAW. RAW-y też mogą mieć różne formaty:
> cr3, cr2 i też samsungowy oraz nikonowy."

Klucz to teraz **nazwa pliku + sekunda zdjęcia** (`archiwum.rodzenstwo`).
Przetrwa każde z tych ułożeń i nie obchodzi go rozszerzenie RAW-a. Sekunda
jest w kluczu, bo licznik w aparacie się przewija (`DSC_0001` z dwóch
wyjazdów); nazwa jest, bo seria z Canona ma kilka klatek w tej samej sekundzie.
Obie pułapki są w zestawie.

Do tego jedna rzecz, której nie widać z zewnątrz: indeks kadrów unieważnia się
nie tylko przy zmianie liczby wpisów, ale i przy zmianie daty na wpisie
istniejącym — bo do RAW-ów Graph wpisuje datę WGRANIA, a dopiero „Dociągnij
dane z plików" podmienia ją na datę zrobienia zdjęcia (punkt 8c).

Zmierzone na atrapie (`tempo-archiwum` 8, 8b, 8c) — cztery układy Marcina
naraz plus obie pułapki: **11 → 8 żądań**, o RAW z pary **4 → 0**, etykiety
z obejrzanego bliźniaka za darmo. Na kluczu po ścieżce ten sam zestaw znajduje
1 parę z 4 — czyli dokładnie to, co Marcin zobaczył u siebie.

## ✅ Partia 55 — zapis indeksu zamrażał serwer co trzy sekundy (GOTOWE)

Tej usterki nie zgłosił żaden komunikat. Znalazła ją arytmetyka.

Po podniesieniu puli do dwunastu tempo wzrosło z 253 do 383 zdjęć na pięć
minut — ale rachunek się nie spinał. Dwunastu robotników przy zmierzonych
6,1 s na żądanie powinno dawać **1,95 żądania na sekundę**; wychodziło
**1,07**. Czterdzieści pięć procent czasu ginęło poza mierzonymi etapami.

Zmierzone lokalnie na archiwum wielkości Marcinowego (57 728 wpisów, 28 MB):

```
JSON.stringify (blokuje): 497 ms
pełny zapisz(): 877 ms, pętla zdarzeń zablokowana ~650 ms
```

Zapis był asynchroniczny — ale `JSON.stringify` już nie. Przy stałym odstępie
trzech sekund serwer zamierał **co trzecią sekundę na dwie trzecie sekundy**.
W tym czasie dwanaście pobrań stało w miejscu, a stopery tykały dalej, więc
pomiar `pobranie` sam się zawyżał: te „8 s na miniaturę" to po części był
nasz własny zapis.

- [x] Odstęp zapisu dobiera się do jego kosztu: dwudziestokrotność ostatniego
      zapisu, czyli najwyżej **5% czasu na zapisywanie**. Małe archiwum
      zapisuje się jak dotąd, Marcinowe co kilkanaście sekund
      (`COSMOS_ARCHIWUM_ZAPIS_MS` to teraz podłoga, nie stała)
- [x] Cosmos dopisuje indeks **przed zamknięciem** (SIGTERM/SIGINT). Bez tego
      dłuższy odstęp oznaczałby, że `systemctl restart` w środku pracy
      wyrzuca do kosza wszystko od ostatniego zapisu
- [x] Paczka rozpoznawania 50 → **200 plików**. Przy kilkunastu robotnikach
      ogon paczki (część puli stoi, czekając na ostatnie sztuki) to przy
      pięćdziesięciu kilkanaście procent czasu, przy dwustu — kilka
- [x] Pula 12 → **24**: przez pięć paczek po dwanaście Graph nie poprosił
      o zwolnienie ani razu, więc zapas był
- [x] Panel pokazuje `sprawność N%` i `realnie N ms/żądanie` — czyli dokładnie
      ten rachunek, który wykrył usterkę, na stałe i na widoku

Zmierzone na atrapie (`tempo-archiwum` punkt 9): przy ciągłym oznaczaniu
plików pętla zdarzeń stoi **65% → 1-2%** czasu.

### Czego pomiar NIE potwierdził

Że drogie są RAW-y. Pobrania w kolejnych paczkach: 2257 ms (71 kB), 5371 ms
(127 kB), 3644 ms (85 kB), 7772 ms (**38 kB**), 7959 ms (**32 kB**) — czas nie
ma nic wspólnego z rozmiarem, a najwolniejsze były najmniejsze pliki. Do tego
diagnostyka pokazała, że RAW-y to tylko 19% żądań, więc gdyby to one kosztowały
osiem sekund, średnia wyszłaby dwa razy niższa niż wychodziła. Panel liczy
teraz `pobranie` **osobno dla RAW-a i osobno dla JPG-a**; dopóki nie ma tego
odczytu, hipoteza „to koszt generowania podglądu z RAW-a" pozostaje
nierozstrzygnięta.

### Co pokazała diagnostyka archiwum

`scripts/pary-w-archiwum.js` na prawdziwym archiwum: 57 728 zdjęć, z tego
**JPG 42 527**, CR3 6786, CR2 6180, DNG 870, JPEG 809, PNG 444, TIF 78, NEF 34.
Par: 7638 kadrów (16%). Czyli intuicja „archiwum głównie RAW-owe" była
nietrafiona — i dlatego samo parowanie mogło dać najwyżej kilkanaście procent,
a resztę musiała dać równoległość i usunięcie zamrożeń.

## ✅ Partia 56 — RAW jednak drogi, a dwadzieścia cztery to za dużo (GOTOWE)

Rozdzielenie pomiaru na RAW i JPG rozstrzygnęło spór z poprzedniej partii —
**na moją niekorzyść**. Odczyty z pięciu paczek:

| | JPG | RAW |
|---|---|---|
| pobranie | 764–1529 ms | 7408–8210 ms |

Czyli hipoteza „Graph generuje podgląd z RAW-a u siebie i to jest ten koszt"
była trafna, a moje późniejsze wątpliwości — nie. Wątpliwości brały się stąd,
że średnia z obu typów wyglądała na jednolicie wysoką; przy 19% RAW-ów
w kolejce po prostu nie dało się tego rozdzielić bez osobnych stoperów.

Drugie odkrycie było mniej przyjemne: przy dwudziestu czterech robotnikach
Graph zaczął prosić o zwolnienie (dwie paczki z pięciu), a kara okazała się
kosztowna. Panel pokazał `adres 20415 ms` i `adres 17150 ms` — to nie był
zamulony Microsoft, tylko **nasza własna kara wliczona w czas etapu**.
Przerwa po 429 jest wspólna dla całej puli, więc kilkanaście sekund kary
zatrzymuje wszystkich naraz.

- [x] Przestój na karze liczony OSOBNO od etapu (`onedrive.czekano()`),
      bo inaczej pomiar wskazuje winnego po drugiej stronie zamiast u nas
- [x] Pula 24 → **16**: powyżej zysk z kolejnego robotnika zjada kara za to,
      że jest
- [x] Licznik `szczytYolo` — ile rozpoznań stoi jednocześnie w kolejce do
      karty. Bez niego nie da się odróżnić „karta wyrabia" od „karta jest
      wąskim gardłem, a my dokładamy robotników na darmo"

Tempo mimo dławień: **985 zdjęć w 5,5 minuty (2,98/s)** wobec 1,28/s na
dwunastu i 0,84/s na sześciu. Od pierwszego pomiaru w tej sprawie
(30 zdjęć w 36 s, czyli 0,83/s) to **3,6 raza szybciej**.

## ✅ Partia 57 — właściwa liczba robotników nie jest stała (GOTOWE)

Po zejściu z 24 na 16 tempo **spadło do 0,73 zdjęcia na sekundę** — poniżej
stanu sprzed wszystkich poprawek. To nie było pogorszenie kodu, tylko wejście
kolejki w inny fragment archiwum, i dopiero rozdzielone stopery to pokazały:

```
paczka „JPG-owa":  JPG ×96  pobranie 1957 ms · RAW ×16  pobranie 13031 ms
paczka „RAW-owa":  JPG ×9   pobranie  629 ms · RAW ×111 pobranie 14101 ms
                   Graph prosił o zwolnienie 4× · przestój na karze
```

Pierwsze paczki mieliły zrzuty ekranu i zdjęcia z telefonu; teraz weszły
w foldery z CR3. **Dla RAW-a to Microsoft musi wygenerować podgląd i to
JEMU kończą się zasoby** — stąd 429 dokładnie tam, gdzie RAW-ów jest dużo.
Przy okazji widać, że dokładanie robotników wtedy nie pomaga, tylko szkodzi:
pobranie RAW-a wzrosło z 8 s do 13-14 s.

Gorsze było zachowanie PO karze. Przerwa jest wspólna dla całej puli, więc
po jej końcu wszystkich szesnastu ruszało w tej samej milisekundzie i od razu
zbierało kolejne 429. Stado biegnące na tę samą ścianę.

- [x] Pula **schodzi sama**: przy dławieniu połowa dopuszczalnej
      równoległości (nie mniej niż dwa), po dwudziestu udanych żądaniach
      dokładamy po jednym z powrotem, aż do pułapu. `YOLO_RUWNOLEGLE` jest
      teraz sufitem, nie wartością do zgadywania
- [x] Start robotników rozsunięty w czasie, żeby pierwsza fala też nie szła ławą
- [x] Panel pokazuje `pula 16→4` — do ilu trzeba było zejść w tej paczce
- [x] Przestój na karze liczony **zegarowo**, nie jako suma po robotnikach.
      Pierwsza wersja pokazała „przestój 890 s" w paczce trwającej dwie
      i pół minuty: prawdziwe arytmetycznie, bezużyteczne w odbiorze

`tempo-archiwum` 8d: przy atrapie odbijającej co drugie żądanie pula schodzi
**16 → 2** i nie gubi ani jednego pliku (40 z 40). Bez połowienia zostaje na 16.

### Co z tego wynika dla RAW-ów

Ścieżka „poproś Graph o miniaturę" dla RAW-a kosztuje 8-14 s i **nie da się
tego obejść równoległością**, bo to obciążenie po stronie Microsoftu. Realne
wyjście to wyciągnąć podgląd JPEG zaszyty w samym pliku RAW przez żądanie
zakresowe — tak jak już robimy z EXIF-em, który schodzi w ~250 ms na 128 kB.
To osobna partia i wymaga czytnika struktury CR3/CR2/NEF; do tego czasu
RAW-y bez JPG-owego bliźniaka pozostają wąskim gardłem.

## ✅ Partia 58 — podgląd wyjęty z pliku RAW zamiast renderowany (GOTOWE)

Adaptacyjna pula z poprzedniej partii zadziałała (16→4 przy dławieniu,
16→16 bez), ale tempo spadło do **0,38 zdjęcia na sekundę**, bo kolejka
weszła w folder prawie czysto RAW-owy: 103 RAW-y na 11 JPG-ów, potem 108 na 5.

I wtedy pomiar powiedział rzecz rozstrzygającą: `pobranie` RAW-a wynosiło
**11,5 s przy puli 4 i 11,5 s przy puli 16**. Czyli to nie jest problem
przepustowości ani równoległości po naszej stronie — to koszt renderowania
podglądu z RAW-a po stronie Microsoftu. Tej ściany nie da się obejść niczym,
co robimy z liczbą robotników. `szczyt YOLO 3` przy puli 16 potwierdzał:
karta graficzna stała bezczynnie.

Ale każdy aparat zapisuje gotowy podgląd JPEG **wewnątrz** pliku RAW — to
z niego korzysta ekranik z tyłu korpusu. Graph obsługuje `Range`, tą samą
drogą od dawna dociągamy EXIF i wiadomo, że jest szybka.

- [x] `lib/raw-podglad.js` — czytnik dwóch rodzin formatów, zero zależności:
      **TIFF-owe** (CR2 6180 plików, DNG 870, NEF 34, TIF 78) po tagach IFD,
      z przejściem przez SubIFD-y; **ISO-BMFF** (CR3 6786) po pudełkach,
      z `PRVW` wewnątrz `moov`
- [x] Bierzemy WIĘKSZY podgląd, nie pierwszy z brzegu — każdy RAW ma obok
      właściwego podglądu miniaturkę 160×120, na której nie ma czego
      rozpoznawać, a wynik zapisałby się w indeksie na stałe
- [x] Wielopaskowy zapis przy kompresji JPEG jest ODRZUCANY: to właściwe dane
      RAW pocięte na kafelki, nie podgląd
- [x] `onedrive.kawalekPliku(id, od, ile)` — dowolny zakres bajtów, z obsługą
      serwera, który zignoruje `Range` i przyśle całość
- [x] **Powrót do miniatury z Graph przy CZYMKOLWIEK nieoczekiwanym.** To nie
      jest uprzejmość wobec dziwnych plików, tylko warunek, pod którym w ogóle
      warto było ten czytnik pisać: gorzej niż było być nie może

Zestaw `podglad-z-rawa` (nowy, 8 punktów): pliki składane bajt po bajcie, bo
prawdziwego CR3 w repozytorium nie ma i nie będzie. Najważniejszy punkt jest
szósty — siedem plików, których czytnik nie rozumie (pusty, obcięty, losowe
bajty, TIFF bez podglądu, BMFF bez `moov`), i **zero zgadywania** na nich.
Punkt ósmy sprawdza całą drogę: dla CR3 i CR2 o miniaturę nie pytamy wcale,
dla pliku bez podglądu pytamy jak dotąd i nic nie przepada.

Panel pokazuje `RAW ×103 (z pliku 103)`, więc od razu widać, którą drogą
poszły obrazki.

## ✅ Partia 59 — regulacja, która resetowała się co paczkę (GOTOWE)

Czytnik podglądu z RAW-a zadziałał: kolejka spadła z 32 134 do 15 740,
a `pobranie` wynosi teraz **182-222 ms** zamiast 11 500 ms. Ale Marcin opisał
to, co zostało, jednym zdaniem, które od razu wskazało usterkę:

> „w ciągu 60 sekund potrafi zejść prawie 1000, ale później czeka dość sporo
> czasu, czyli leci to takimi falami"

Panel potwierdzał co do liczby: cztery paczki `pula 16→16` po kilkanaście
sekund, a piąta `pula 16→8` z **przestojem 264 s**.

Dwa błędy, oba moje, oba w regulacji z poprzedniej partii:

1. **`dozwolone` żyło wewnątrz obsługi żądania.** Każda paczka zaczynała od
   pełnego gazu, dostawała po łapach i zapominała. Regulacja, która resetuje
   się co paczkę, nie jest regulacją.
2. **Powrót „+1 po dwudziestu udanych"** przy dziewięciu żądaniach na sekundę
   znaczył powrót na pełną prędkość w dwie sekundy. Zejście o połowę i powrót
   w dwie sekundy to nie jest tłumienie — to dokładnie ta fala.

- [x] Stan puli przeżywa paczkę (poza obsługą żądania)
- [x] Powrót rozłożony w CZASIE, nie w liczbie żądań: najwyżej +1 na
      piętnaście sekund (`YOLO_WZROST_MS`)
- [x] `adres` bez doliczonej kary — panel pokazywał „adres 16083 ms" dla
      zwykłego JPG-a, co kieruje szukanie winy na Microsoft, podczas gdy to
      była nasza własna pauza. `graf()` przyjmuje teraz obiekt pomiaru
      i oddaje, ile to konkretne żądanie przestało

`tempo-archiwum` 8e: druga paczka po tej samej atrapie startuje z `16→2`,
a nie z `16→16`. Przy przywróconym resecie zestaw pada dokładnie na tym.

### Gdzie teraz jest czas

Po tej partii `pobranie` przestało być tematem (182-222 ms). Zostaje `adres`
— jedno wywołanie Graph na zdjęcie po adres miniatury, 769-831 ms — i to ono
jest zasobem, którego Microsoft pilnuje limitem. Kolejnym krokiem, gdyby
zaszła potrzeba, jest `POST /$batch`: do dwudziestu zapytań o adres w jednym
obiegu.

## ✅ Partia 60 — trzy testy, które mierzyły obciążenie maszyny (GOTOWE)

Wyszło przy okazji: bateria padała raz na kilka przebiegów, za każdym razem
gdzie indziej. Uruchamiana pojedynczo — zawsze zielona. To najgorszy możliwy
stan baterii, bo uczy ignorowania czerwonego.

Trzy różne przyczyny, wszystkie tego samego rodzaju: **test mierzył, jak
zajęta jest maszyna, zamiast jak zachowuje się kod.**

1. **Dwa środowiska dzieliły jeden port atrapy.** `kontekst` i `grafiki`
   stawiały atrapę echa systemu na 7116, a sprzątanie portów przed startem
   środowiska zabija to, co na nim stoi. Drugie środowisko czekało potem
   1,5 s na własną atrapę — i w tym oknie żądanie pierwszego wracało błędem
   połączenia zamiast treścią promptu. Padał `plan-zdjeciowy` albo
   `szukanie-grafik`, zależnie od tego, kto kogo ubił.
   Naprawione: atrapa czyta port z otoczenia (`grafiki` dostaje 7118),
   a sprzątanie zwalnia tylko port podany we wpisie. Mechanizm przekazania
   portu istniał w `atrapaNode(plik, port)` od dawna — po prostu nikt go
   nie wołał z drugim argumentem
2. **`tempo-archiwum` punkt 4 spał 3600 ms** przy odstępie zapisu 3000 ms.
   Sześćset milisekund zapasu wystarcza samotnie, nie wystarcza pod
   obciążeniem. Teraz czeka NA WARUNEK, do dziesięciu sekund
3. **`tempo-archiwum` punkt 9 porównywał tyknięcia zegara do teoretycznych
   600.** Pod obciążeniem baterii pokazywał „32% zablokowane" przy zdrowym
   kodzie. Teraz mierzy najpierw ten sam przebieg BEZ archiwum i porównuje
   do niego — obciążenie skraca się po obu stronach. Rozdzielenie zostało
   ostre: **1% wobec 63%** na kodzie sprzed poprawki zapisu

Sprawdzone sześcioma pełnymi przebiegami baterii: trzy przed poprawkami
(dwa pady), trzy po (42/42, 42/42, 42/42).

## ✅ Partia 61 — regulacja musi PAMIĘTAĆ, gdzie jest ściana (GOTOWE)

Pamięć między paczkami pomogła, ale nie rozwiązała sprawy. Marcin:
„około 4 minut przestoju pomiędzy falami". Panel, paczka po paczce:

```
pula 16→16 · sprawność 62% · realnie 114 ms/żądanie   (szybko)
pula 16→16 · sprawność 61% · realnie 113 ms/żądanie   (szybko)
pula 16→16 · sprawność 60% · realnie 113 ms/żądanie   (szybko)
pula 16→4  · sprawność  3% · realnie 2278 ms/żądanie · przestój na karze 248 s
pula 16→10 · sprawność 40% · realnie 158 ms/żądanie   (wraca w górę)
```

Widać cały cykl: rozpęd, ściana, kara, powrót — i znowu. Powód: po dławieniu
pula wracała do **pułapu z `.env`**, czyli tam, gdzie już raz dostała.
Regulacja, która nie pamięta, na czym się przewróciła, będzie się przewracać
w kółko.

Kary nie da się skrócić — jej długość podaje Microsoft w `Retry-After`
i wynosi tu około czterech minut postoju CAŁEJ puli, bo przerwa jest wspólna.
Jedyne wyjście to jej nie wywoływać.

- [x] Pula zapamiętuje **ścianę**: poziom, przy którym Graph powiedział dość.
      Powrót idzie do ściany, nie do pułapu z `.env`
- [x] Ściana też odtaje, ale dziesięć razy wolniej niż sama pula
      (`YOLO_SUFIT_MS`) — jedno dławienie z gorszej godziny nie może
      zabetonować pesymizmu do końca przebiegu
- [x] Panel pokazuje `pula 16→4, ściana 7` — czyli i bieżący stan,
      i to, czego regulacja się nauczyła

`tempo-archiwum` 8f: atrapa dławi, gdy naraz leci więcej niż sześć żądań.
Po sześciu paczkach ściana schodzi z 16 do 7, a w trzech ostatnich paczkach
jest **zero dławień**. Bez pamięci o ścianie ten sam zestaw kończy ze ścianą
na 16.

### Przy okazji, znowu: test, który mierzył zajętość maszyny

Punkt 9 skakał między 1% a 35% bez żadnej zmiany w kodzie. Wsypanie
dwudziestu tysięcy wpisów planowało zapis, który wpadał raz w okno
odniesienia, raz w okno właściwe. Teraz zestaw czeka, aż plik przestanie się
zmieniać — to jest warunek „nie ma zaległych zapisów", a nie zgadywanka
o długości odstępu.

## ✅ Partia 62 — rozpoznawanie treści przerobione do końca (GOTOWE)

Marcin: „Dobra teraz jest stabilnie. Doszło tak do zera. Więc już wszystko
zostało przerobione." Ponowne kliknięcie oddaje „rozpoznana na 0 zdjęciach"
— kolejka pusta. **Cały materiał z OneDrive ma rozpoznaną treść.**

Regulacja zbiegła do `ściana 3` i tam została, bez ani jednego przestoju
na karze. Tyle akurat przyjmuje konto Marcina i to jest odpowiedź, której
przez cały ten czas szukaliśmy — nie dało się jej odgadnąć, dało się ją
tylko zmierzyć.

Droga, w skrócie i w liczbach:

| krok | tempo | co było wąskim gardłem |
|---|---|---|
| stan wyjściowy | 0,83/s | wszystko po kolei, jedno żądanie naraz |
| pula 3 → 6 | 1,28/s | czekanie na Microsoft, zrównoleglone |
| zapis indeksu przestał zamrażać serwer | 2,98/s | `JSON.stringify` 28 MB co 3 s |
| podgląd wyjęty z pliku RAW | — | Graph renderował podgląd z CR3 po 11,5 s |
| pula pamięta ścianę | stabilnie do zera | powrót na pełny gaz prosto w karę |

- [x] Ostatnia poprawka pomiaru: zamiast „sprawność N%" panel pokazuje
      **„średnio N naraz"** — ilu robotników naprawdę pracowało. Procent
      liczył się względem pułapu z `.env`, więc przy ścianie 3 i pułapie 16
      maksimum możliwe wynosiło 19%: pokazane „12%" wyglądało na katastrofę,
      a było dwiema trzecimi tego, co się dało. Liczba robotników porównuje
      się wprost z sąsiednim „pula 16→3, ściana 3", procent wymagał
      mianownika, którego nikt nie widział

### Co z tego wynika na przyszłość

Kolejny przebieg (po dowgraniu nowych zdjęć) zacznie od ściany 3 i będzie
próbował wyżej co dziesięć minut. Gdyby Microsoft kiedyś poluzował, sam się
o tym dowie; gdyby zacisnął — zejdzie niżej bez pytania.

## ✅ Partia 63 — audyt UI/UX panelu kamery (GOTOWE)

Marcin, patrząc na panel kamery w telefonie: „Zastanawia mnie ten dolny panel
z wyborem sprzętu, klatkarza itd. Nie wiem, czy tak to miało być. (…) przy
włączonych zmysłach i kinekcie nad oknem kamery pojawia się opis słowny co
widzi kinect. Też nie wiem, czy to jest potrzebne i czy musi być w tym miejscu."

Obie wątpliwości trafiły w usterki, nie w decyzje projektowe.

### 1. Pudełko nastaw było MARTWE przy wyłączonych zmysłach

`odswiezPlan()` stało w `liveDetect()` **pod** wyjściem „brak YOLO". Przy
wyłączonym komputerze domowym pudełko było widoczne (bo lokalizacja ustawiona)
i pokazywało w kółko myślnik — trzy listy rozwijane i kreska pod nimi.
Tymczasem do policzenia ekspozycji karta graficzna nie jest potrzebna w ogóle:
wystarczy położenie Słońca (liczy serwer) i jasność klatki (liczy przeglądarka).

- [x] Nastawy liczą się niezależnie od zmysłów

### 2. Trzy listy rozwijane bez tytułu i z uciętymi napisami

Nie było nic, co by mówiło, czego te listy dotyczą — stąd pytanie „czy tak to
miało być". Do tego `display:flex` wciskał trzy pola w szerokość telefonu
i napisy się ucinały: Marcin widział „🌤 Z pro" i nie miał jak się domyślić,
że to zachmurzenie.

- [x] Tytuł „NASTAWY NA TEN KADR" — inny niż w Plenerze („Plan zdjęciowy"),
      bo i rzecz jest inna: tam liczy się dla miejsca i godziny, tu dla
      jasności kadru, na który patrzysz
- [x] Siatka `auto-fit minmax(120px, 1fr)` zamiast rzędu — pola zawijają się
      do dwóch wierszy, zamiast skracać napisy. Tak samo robi to Plener

### 3. Opis nad oknem kamery był DRUGĄ KOPIĄ tego samego

Dymek zdarzeń percepcji istnieje po to, żeby przy ZAMKNIĘTYM podglądzie
dowiedzieć się, że Cosmos kogoś zobaczył. Przy otwartym ta sama treść stoi już
pod obrazem — i to na stałe, a nie na sześć sekund. Na zrzucie Marcina widać
jedno i drugie naraz: „Sylwetka: widoczna sylwetka, osoba prawdopodobnie stoi"
w dymku i „person (po lewej) · 🧍 widoczna sylwetka…" pod obrazem.

- [x] Dymek milczy dla zdarzeń `kamera` i `sylwetka`, gdy podgląd jest otwarty.
      Czujniki, urządzenia i rutyny lecą dalej — ich w podglądzie nie widać
- [x] Przy zmianie postawy linijka pod obrazem podmienia ogon, zamiast go
      doklejać. Doklejanie dawało przez ułamek sekundy dwie postawy naraz

`nowe-panele-ux` 6b i 6c sprawdzają tytuł, brak ucięć i milczenie dymka przy
otwartym podglądzie — oraz to, że przy zamkniętym dymek nadal działa.

### 4. Pudełko nastaw zwinięte do jednej linijki

Marcin, po zobaczeniu pomiaru: „faktycznie zabiera sporo miejsca". Panel
kamery zajmuje na telefonie 743 z 844 px ekranu, a rozwinięte pudełko to
ponad jedna trzecia panelu.

- [x] `<details>`, nie własny przełącznik — klawiatura, czytnik ekranu
      i „znajdź na stronie" działają wtedy same z siebie
- [x] W zwiniętym pasku zostaje to, po co się tu patrzy: `1/50 · f/5.6 · ISO 100`.
      Listy i uzasadnienie o jedno dotknięcie dalej
- [x] Stan zapamiętany (`cosmos.planRozwiniete`), domyślnie zwinięte
- [x] Rozwinięcie liczy plan OD RAZU — bez tego świeżo otwarte pudełko
      pokazywałoby poprzedni wynik nawet przez osiem sekund
- [x] Tytuł znika ze zwiniętego paska, GDY są już liczby. Panel ma stałe
      ~290 px, a nastawy zajmują z tego dwie trzecie — tytuł wychodził wtedy
      jako „NASTAWY…", czyli gorzej niż wcale. Liczby ekspozycji same mówią,
      czym są; pełna nazwa zostaje w `title` i dla czytnika ekranu, a wraca
      na widok, gdy wyniku jeszcze nie ma i po rozwinięciu

Zmierzone: **266 px → 42 px**, panel kamery **743 → 512 px** na telefonie.

### Test, który mierzył niewyświetlany element

Przy okazji wyszło, że zamknięte `<details>` w Chromium chowa treść przez
`content-visibility`, a nie `display:none`: `offsetParent` zostaje ustawiony,
a `getBoundingClientRect()` oddaje 131×35 px dla listy, której nie widać.
Pomocnik `wystaje()` pomijał elementy po `offsetParent`, więc po zwinięciu
mierzyłby coś nierysowanego i zawsze świeciłby na zielono. Teraz używa
`checkVisibility()`.

### Audyt sam podawał fałszywy alarm

Lista „klucze bez użycia" wymieniała **25** pozycji, z czego pięć jest w pełni
używanych: regexp nie znał wariantu `data-i18n-html` ani atrybutu
`data-prompt-key`. Skasowanie ich zabrałoby objaśnienia z bazy wiedzy, z nauki
procedur i treść czterech przycisków startowych. Po poprawce lista ma 19 pozycji
i wszystkie są prawdziwe. Fałszywy alarm w audycie jest gorszy niż brak
kontroli, bo wygląda na wynik pomiaru.

- [x] Wykrywanie martwych tłumaczeń zna wszystkie warianty atrybutu

## ✅ Partia 64 — panel kamery nie mieścił się na ekranie (GOTOWE)

Marcin, po zwinięciu pudełka nastaw: „Nie mieści mi się to teraz na ekranie.
W obu przypadkach nie mogę też scrollować w dół lub w górę." Na zrzutach
z telefonu i z desktopa widać ucięty nagłówek „KAMERA NA ŻYWO" u góry
i ucięty przycisk migawki na dole.

Trzy przyczyny, każda osobna:

### 1. Wysokość liczona ze STAŁEJ

Szerokość panelu w trybie powiększonym wynikała z
`calc((100dvh - 220px) * 4 / 3)`, gdzie 220 px miało pokryć „nagłówek, wybór
źródła, status i przycisk". Odjęcie „tyle, ile zwykle zajmuje reszta" jest
zawsze o jedną zmianę do tyłu — a doszły dwie: pudełko nastaw i status, który
przy wyłączonych zmysłach ma trzy wiersze.

- [x] Panel to kolumna elastyczna z `max-height: calc(100dvh - 40px)`.
      Paski biorą tyle, ile potrzebują, a **szerokość** panelu liczy się
      z dostępnej wysokości i zmierzonej proporcji obrazu (`--live-chrome`,
      `--live-arn`). Obraz nie kurczy się w pionie — kurczenie łamałoby
      proporcję, czyli dawało albo obcięty kadr, albo czarne pasy.
      Cokolwiek jeszcze tu dołożymy, zmieści się samo

### 2. Nie było jak przewinąć

`.live-panel` miał `overflow: hidden`, więc treść, która nie zmieściła się
w oknie, po prostu znikała za krawędzią.

- [x] Wszystko pod obrazem siedzi w `.live-body` z `overflow-y: auto`

### 3. Czarne pasy z nieprawdziwej proporcji

Scena miała wpisane na stałe `aspect-ratio: 4/3`, a kamera Marcina jest 16:9 —
jedna czwarta wysokości panelu szła na czarne pasy, i to wtedy, gdy panelu
i tak brakowało miejsca.

- [x] Proporcję ustawia kod z WYMIARÓW STRUMIENIA (`--live-ar`), które i tak
      odczytujemy w każdej pętli podglądu. 4:3 zostaje jako wartość przed
      pierwszą klatką i dla Kinecta, który taki właśnie jest

Nowy zestaw `panel-kamery-miesci`: cztery okna (390×640, 390×844, 1440×700,
1440×900) × pięć stanów (zwinięte, rozwinięte, powiększone, kadr pionowy 9:16
powiększony i w rogu) = **20 przypadków**. Nie sprawdza żadnej konkretnej liczby
pikseli, tylko własność, która ma być prawdziwa zawsze: panel mieści się w oknie,
nagłówek jest widoczny, a do przycisku migawki da się dojechać — albo jest
w panelu, albo treść się przewija. Na starym układzie pierwszy przypadek pada:
„mieści się: false, nagłówek ucięty".

## ✅ Partia 65 — archiwum „raz a porządnie" (GOTOWE)

Marcin po pierwszym poważnym użyciu archiwum przysłał trzy zapisy rozmów
i listę tego, co nie działa: „Tam jest szereg problemów i bugów. Chcę się
wszystkich pozbyć, wykluczyć lub naprawić."

### 1. Nie dało się obejrzeć całego wyniku

„Chciałbym móc przejrzeć wszystkie np. zdjęcia z wyszukania, a nie mieć
informacje typu »pokazałem Ci 20, ale jest 311«."

Trasa przyjmowała `limit`, ale nie umiała pominąć początku listy, więc każde
zapytanie oddawało ten sam jej kawałek. Do 311. pliku nie dało się dojść inaczej
niż zawężaniem filtrów aż do skutku — a do zdjęcia bez wyróżniającej cechy nie
dało się dojść w ogóle.

Sedno naprawy jest podziałem ról, nie większym limitem: **model** dostaje próbkę
i ma prawo jej nie przekraczać (kontekst kosztuje), **człowiek** dostaje przycisk
pod siatką i dochodzi nim do ostatniego pliku.

- [x] `/api/archive/search` przyjmuje `pomin=` i oddaje `zostalo`.
      Parametr nie nazywa się `od`, bo `od` znaczy „od tej daty" — pierwsza
      wersja użyła właśnie `od` i zestaw natychmiast to złapał: `od=24` wpadało
      do filtra dat, druga porcja wracała pusta, co wyglądałoby na koniec wyników
- [x] Pasek „pokazane 24 z 311" z przyciskiem po następną porcję
- [x] Nagłówek dla modelu mówi wprost, że **próbka ogranicza jego, a nie
      użytkownika** — bez tego dalej przepraszałby za limit

### 2. „Nie idzie od najnowszych"

„Nie idzie od najnowszych zdjęć, bo pokazuje zdjęcia gór z 2022 roku."

Sortowanie było poprawne. Kłamała data. Microsoft Graph wypełnia
`photo.takenDateTime` dla JPEG-ów, ale dla RAW-ów Canona już nie — spadaliśmy
wtedy na `createdDateTime`, czyli **moment wgrania pliku do chmury**. Zdjęcie
zrobione w 2022 i wgrane w 2026 uczciwie lądowało na szczycie listy.

- [x] Pole `dataZrodlo` (`exif` / `nazwa` / `plik`) — bez niego nie da się
      odróżnić momentu zrobienia zdjęcia od momentu wgrania
- [x] Data czytana z NAZWY pliku, gdy EXIF-u brak: `20220814_153012.jpg`,
      `PXL_…`, `Screenshot_…`, `2022-08-14 15.30.12.jpg` (tak nazywa OneDrive
      wysyłki z telefonu). Nic nie kosztuje, a ratuje właśnie te pliki, które
      mają najbardziej bezużyteczną datę systemową

### 3. Ponowne indeksowanie kasowało całą pracę

To nie wyszło z użycia, tylko z czytania kodu przy okazji punktu 2 — i jest
najgroźniejszą rzeczą z całej listy, bo niszczy dane nieodwracalnie i widać
to dopiero po fakcie.

`dodaj()` podmieniało znany wpis **w całości**. Dla nowego pliku poprawne, dla
znanego katastrofalne: jedno kliknięcie „indeksuj OneDrive" po dograniu nowej
sesji — czyli czynność normalna i oczekiwana — kasowało `obejrzane`, `obiekty`,
`obiektyw`, dane lotu i poprawione daty. 55 tysięcy plików przemielonych
rozpoznawaniem treści i osobny przebieg po EXIF: do powtórzenia, bez jednego
ostrzeżenia, przy indeksowaniu wyglądającym na udane, bo liczba plików się zgadza.

- [x] `scal()` — listowanie z Grapha wygrywa tam, gdzie faktycznie coś niesie;
      pola z późniejszych przebiegów przeżywają, dopóki nowy wpis ich nie wypełni
- [x] Data porównywana po ŹRÓDLE (exif > nazwa > plik), bo Graph zawsze poda
      jakąś. Przy równym źródle wygrywa nowsze — inaczej ochrona danych
      zamieniłaby się w zamrażarkę i poprawki z Lightrooma nigdy by nie weszły
- [x] Wpisy sprzed wprowadzenia `dataZrodlo` czytane po `exifCzytany`, inaczej
      pierwsze przeindeksowanie cofnęłoby daty właśnie tym 55 tysiącom plików

### 4. Wykluczanie folderu i nazwa aparatu

„Zdjęcia najnowsze z wyłączeniem folderu Mazury 2026 i tak pokazuje zdjęcia
z tego folderu." Filtrów było dwadzieścia i **ani jednego odejmującego** —
model układał zapytanie bez wykluczenia i pisał, że folder pominął. Bywało to
prawdą przez przypadek.

„Widzę na OneDrive, że mój canon to tak naprawdę u niego EOS R6 Mark II."
EXIF zapisuje `Canon EOS R6m2`, OneDrive pokazuje `EOS R6 Mark II` —
dopasowanie całą frazą znaczyło, że naturalne `aparat=Canon R6` nie trafiało
w NIC, bo taki ciąg nie występuje nigdzie.

- [x] `bezFolderu=` z listą po przecinku („oprócz Mazur i Krakowa" to jedno pytanie)
- [x] `aparat`, `obiektyw`, `miejsce`, `nazwa` dopasowywane PO SŁOWACH

### 5. Znaczniki wyciekały na ekran

W zapisie rozmowy stało gołe `[ARCHIWUM: grupuj=rok]`, a niżej pusty blok kodu.
Czyszczenie istniało, ale zakładało, że model zawsze napisze znacznik w całości
i poza płotem. Nie zawsze pisze: kończy się budżet tokenów (znacznik bez
domykającego `]`) albo opakowuje polecenie w ```blok``` (po usunięciu zostaje
pusty płot). Do tego przerwana odpowiedź szła na ekran zupełnie bez czyszczenia
— a urywa się najczęściej właśnie w trakcie sięgania po narzędzie.

- [x] Wzorzec na znacznik urwany **na końcu tekstu** — i tylko tam, żeby nie
      zjadać nawiasów i odnośników ze środka zdania
- [x] Płot, w którym po usunięciu znacznika nie zostało nic, znika razem z nim
- [x] `err.partial` też przechodzi przez czyszczenie

### 6. Kamera: duży podgląd, a pod nim wąski pasek

„Okno podglądu jest duże, a pod nim małe okienko przesuwalne. To nie wygląda
dobrze i nie jest użyteczne."

Dwie przyczyny. Pierwsza: pomiar zjadał własny ogon — `--live-chrome` liczyło się
z **już ściśniętej** dolnej części, więc wychodziło, że paski są niskie, więc
obrazowi wolno być duży, więc dół musi się ścisnąć jeszcze bardziej. Układ
zastygał dokładnie w tym, co Marcin opisał. Druga: w jednej kolumnie obraz
i nastawy dzielą tę samą wysokość i konkurują o nią — zmierzone przy 1440×700
dawało obraz **189 px** pod 470 px sterowania, czyli „powiększenie" pokazywało
obraz mniejszy niż panel w rogu.

- [x] Pomiar dolicza `scrollHeight - clientHeight`, czyli to, co już nie mieści
      się w dolnej części — dopiero POTRZEBA jest właściwą liczbą
- [x] Sufit na wysokość obrazu na wypadek, gdy szerokość dobiła do dolnej
      granicy (kadr pionowy 9:16 dzieli szerokość przez 0,5625)
- [x] Na ekranie ≥ 900 px powiększony panel ma **dwie kolumny**: obraz z lewej,
      nastawy z prawej. Konkurencja o wysokość znika, rosną oba naraz —
      przy 1440×700 obraz 189 px → **567 px**
- [x] Pomiar powtarza się, dopóki liczba się zmienia (do trzech rund) — przy
      przejściu między układem jedno- i dwukolumnowym jedno przejście mierzy
      stan sprzed przebudowy

### Zestaw, który był zielony przy zepsutym układzie

`panel-kamery-miesci` przepuszczał ten stan bez słowa, bo pytał tylko „czy panel
się mieści" i „czy da się dojechać do migawki" — a na jedno i drugie ściśnięty
pasek przewijania odpowiada TAK. Zielony zestaw przy układzie, który użytkownik
nazwał zepsutym, jest gorszy niż brak zestawu: daje spokój bez pokrycia.

- [x] Dołożona własność o **kolejności ustępowania**: gdy brakuje miejsca,
      najpierw kurczy się obraz, a dopiero gdy zszedł do minimum, wolno zwinąć
      dół w pasek. Dół przewijający się przy dużym obrazie to usterka, nawet
      jeśli wszystko „się mieści"

Trzy nowe zestawy: `przegladanie-wynikow` (311 plików, przejście wszystkich
porcji, porządek przez cały wynik), `data-i-ponowne-indeksowanie` (data z nazwy,
scalanie, wpisy sprzed `dataZrodlo`), `znaczniki-nie-wyciekaja` (13 przypadków
czyszczenia, w tym pięć sprawdzających, czego ruszać NIE WOLNO).

## ✅ Partia 66 — czarne pasy na telefonie (GOTOWE)

Marcin, po wdrożeniu partii 65: „na desktopie wygląda dobrze, ale na mobile
to cały czas nie wygląda dobrze". Na zrzutach wąski pasek obrazu pośrodku
i czarne pasy zajmujące 68% szerokości panelu.

### Dwie fałszywe diagnozy po drodze

Obie warto zapisać, bo obie brzmiały sensownie.

**Pierwsza:** proporcja się nie ustawia, bo `liveMediaSize()` wisi wyłącznie
w pętli `liveDetect()`, a status na zrzucie mówi wprost, że rozpoznawanie nie
działa. Napisany na to zestaw **przeszedł na starym kodzie** — `liveDetect`
chodzi na timerze niezależnie od YOLO i proporcję ustawia.

**Druga:** Android podaje `videoWidth/videoHeight` poziomo mimo pionowego
kadru. Pomiar geometrii z prawdziwych rozmiarów okna Marcina to wykluczył:
proporcja była ustawiona poprawnie na 9:16.

### Co było naprawdę

**1. Sufit wysokości sceny — dołożony dzień wcześniej w partii 65.** Kadr 9:16
dzieli dostępną wysokość przez 0,5625, więc wyliczona szerokość panelu spadała
poniżej dolnej granicy 200 px. Granica ją podnosiła, scena chciała być wyższa
niż zostało miejsca, i ścinał ją sufit — **łamiąc proporcję**. Zamiana
`object-fit` z `cover` na `contain`, też z partii 65, sprawiła że rozjazd
przestał być przycinany i zrobił się widoczny.

Dobieranie dolnej granicy (200 → 150 → 110) naprawiało jeden przypadek i psuło
inny — znak, że zły jest model, nie liczba.

- [x] Sufit usunięty. Jedna zasada bez wyjątków: **scena zawsze ma kształt
      kadru**, a wielkość bierze z szerokości panelu. Gdy miejsca zabraknie
      nawet przy najwęższym panelu, ustępuje dolna część i to ona się przewija
- [x] `object-fit: cover` wraca do małego podglądu jako zabezpieczenie —
      nie dlatego, że ładniejszy, tylko dlatego, że **inaczej się psuje**:
      przy rozjeździe traci brzegi kadru, a nie cały panel

**2. Status na osiem linijek.** Zmierzone na wąskim telefonie: 144 px
komunikatu o wyłączonym rozpoznawaniu przy panelu wysokim na 441 px. Jedna
trzecia panelu na instrukcję do przeczytania raz w życiu.

- [x] Dwie linijki z rozwijaniem na dotknięcie, jak pudełko nastaw. Wszystkie
      komunikaty idą przez `ustawStatusKamery()`, bo „czy się mieści" da się
      sprawdzić dopiero po wstawieniu tekstu. Chrome spadł z 291 px do 201 px

**3. Panel liczony pod pustsze pudełko.** Rozwinięcie nastaw przelicza panel
natychmiast, a `odswiezPlan()` dopełnia treść dopiero po odpowiedzi serwera.
Panel zastygał policzony pod pudełko o kilka wierszy niższe i treść wystawała
o 50 px — to jest ta „mała przesuwalna ramka" widoczna także na desktopie.

- [x] `pokazPlan()` przelicza panel po wpisaniu treści
- [x] Pomiar zbiega się w sześciu rundach zamiast trzech

Efekt na oknie 390×844 z kadrem pionowym: obraz **196 px → 615 px**,
czarne pasy **68% → 0%**.

### Zestaw znowu był zielony przy zepsutym układzie

`panel-kamery-miesci` pilnował wysokości i przewijania, ale nigdy KSZTAŁTU —
więc przepuszczał pasek obrazu w czarnej ramce bez słowa. Drugi raz z rzędu
ten sam wzorzec: zestaw sprawdzał to, co łatwo zmierzyć, a nie to, na co
użytkownik patrzy.

- [x] Asercja o proporcji sceny (rozjazd > 5% = czarne pasy)
- [x] Asercja o kolejności ustępowania przepisana z progu wziętego z sufitu
      („obraz > 260 px") na zasadę: **dół wolno przewijać dopiero wtedy, gdy
      panel dobił do swojej dolnej granicy** i nie ma już czym ustąpić
- [x] Czekanie na USTABILIZOWANIE układu zamiast `waitForTimeout(400)` —
      stały czas łapał panel w połowie zbieżności i zgłaszał usterkę,
      której w gotowym układzie nie ma
- [x] Timer podglądu zatrzymywany przed wymuszeniem kadru pionowego, bo
      inaczej `liveDetect` cofał proporcję w trakcie pomiaru

Nowy zestaw `proporcja-bez-zmyslow`: podgląd przy WYŁĄCZONYCH zmysłach, czyli
w sytuacji Marcina z telefonu przy zgaszonym komputerze domowym.

## 🎉 Wszystkie partie z roadmapy zrealizowane
Pozostałe pojedyncze punkty oznaczone `[ ]` (foldery/tagi, sterowanie gestami,
streaming WebRTC, konta wielu użytkowników, automatyczne odtwarzanie web/desktop)
to świadomie odłożone rozszerzenia wymagające zewnętrznych bibliotek/infrastruktury
— opisane przy swoich partiach.

---

> Kolejność partii można zmieniać. Napisz, którą chcesz jako następną, a zbuduję
> ją w całości i oznaczę tutaj jako gotową.

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

## 🎉 Wszystkie partie z roadmapy zrealizowane
Pozostałe pojedyncze punkty oznaczone `[ ]` (foldery/tagi, sterowanie gestami,
streaming WebRTC, konta wielu użytkowników, automatyczne odtwarzanie web/desktop)
to świadomie odłożone rozszerzenia wymagające zewnętrznych bibliotek/infrastruktury
— opisane przy swoich partiach.

---

> Kolejność partii można zmieniać. Napisz, którą chcesz jako następną, a zbuduję
> ją w całości i oznaczę tutaj jako gotową.

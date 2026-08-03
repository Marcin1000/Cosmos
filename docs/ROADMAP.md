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

## 🎉 Wszystkie partie z roadmapy zrealizowane
Pozostałe pojedyncze punkty oznaczone `[ ]` (foldery/tagi, sterowanie gestami,
streaming WebRTC, konta wielu użytkowników, automatyczne odtwarzanie web/desktop)
to świadomie odłożone rozszerzenia wymagające zewnętrznych bibliotek/infrastruktury
— opisane przy swoich partiach.

---

> Kolejność partii można zmieniać. Napisz, którą chcesz jako następną, a zbuduję
> ją w całości i oznaczę tutaj jako gotową.

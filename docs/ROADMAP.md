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
- [x] **Wake-word lokalny** — `senses/wake_listener.py` (openWakeWord); nasłuch mikrofonu
  bez otwartej karty (własny model „Hej Kosmos" do wytrenowania — patrz plik)
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
- [x] **Procedury (nauka czynności)** — nagrywasz czynność jako listę kroków (otwórz / kliknij /
  wpisz / odczytaj / poczekaj / potwierdź / notatka). Kroki **wrażliwe** (płatność, wysłanie,
  potwierdzenie) są oznaczane i **zawsze** wymagają Twojego kliknięcia w runnerze. Hasła/dane
  karty nie są zapisywane. Endpointy: `/api/procedures`. Nemotron może zaproponować
  uruchomienie procedury przez `[AKCJA: procedura | nazwa]`.
- [x] **Rutyny (cykliczne odpalanie)** — harmonogram (codziennie / co tydzień / co miesiąc /
  co N minut) dla procedury. Scheduler na serwerze zgłasza, że nadszedł czas (nic
  nieodwracalnego nie dzieje się samo); interfejs proponuje uruchomienie z bramką
  potwierdzeń. Endpointy: `/api/routines`, `/api/routines/due`.
- [ ] **Automatyczne odtwarzanie web (Playwright)** — świadomie odłożone: pełne bezobsługowe
  odtwarzanie kroków w przeglądarce jako osobny, opcjonalny moduł wykonawczy z twardą bramką
  przed każdym krokiem wrażliwym. Obecnie runner prowadzi krok po kroku (asystent z bramką).
- [ ] **Automatyzacja aplikacji desktop** — świadomie odłożone: wymaga natywnej automatyzacji
  systemowej poza przeglądarką (osobne narzędzia/uprawnienia).

---

## 🎉 Wszystkie partie z roadmapy zrealizowane
Pozostałe pojedyncze punkty oznaczone `[ ]` (foldery/tagi, sterowanie gestami,
streaming WebRTC, konta wielu użytkowników, automatyczne odtwarzanie web/desktop)
to świadomie odłożone rozszerzenia wymagające zewnętrznych bibliotek/infrastruktury
— opisane przy swoich partiach.

---

> Kolejność partii można zmieniać. Napisz, którą chcesz jako następną, a zbuduję
> ją w całości i oznaczę tutaj jako gotową.

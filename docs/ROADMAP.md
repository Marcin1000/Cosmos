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

### Partia 2b — zaawansowana obróbka (wymaga dodatkowej pracy/usług)
- [ ] **Upscale obrazu** — wymaga osobnego modelu powiększającego (np. Real-ESRGAN
  w usłudze zmysłów) — OpenAI/Firefly nie mają prostego endpointu upscale
- [ ] **Edycja przez maskowanie (inpainting)** — UI do rysowania maski + endpoint
  images/edit; dedykowana pod-partia
- [ ] **Storyboard AI** — model generuje sekwencję kadrów → wsadowe generowanie klatek
- [ ] **Kolejka zadań Studio** — seria generacji ze śledzeniem postępu

## 🔜 Partia 3 — wiedza i pamięć

- [ ] **Cytowanie źródeł** — odpowiedź pokazuje plik/fragment z bazy wiedzy
- [ ] **Wyszukiwanie po treści rozmów** (nie tylko tytule)
- [ ] **Automatyczne streszczenia** dokumentów i długich rozmów
- [ ] **Foldery / tagi rozmów**
- [ ] **Pamięć profilowa** — Cosmos uczy się preferencji (sprzęt, styl, projekty)
- [ ] **Wskaźnik kosztu/tokenów** przy modelach z chmury

## 🔜 Partia 4 — percepcja i robotyka

- [ ] **Panel podglądu kamery na żywo** obok czatu z nakładką detekcji
- [ ] **Wake-word lokalny** (openWakeWord/Porcupine) — „Hej, Kosmos" bez otwartej karty
- [ ] **Sterowanie gestami** (MediaPipe)
- [ ] **Pamięć przestrzenna** — „gdzie zostawiłem telefon?" na bazie Kinecta
- [ ] **Integracja z Mavic 3** — import zdjęć z lotu → model 3D

## 🔜 Partia 5 — platforma i infrastruktura

- [ ] **Kopie zapasowe** danych (auto-eksport na dysk/chmurę)
- [ ] **Panel administracyjny** — statystyki, status usług, koszty
- [ ] **Streaming głosu w czasie rzeczywistym** (WebRTC)
- [ ] **Profile / wielu użytkowników** (opcjonalne)
- [ ] **Pełny tryb offline** na RTX bez internetu

## 🔭 Partia 6 — kierunki ambitne

- [ ] **Digital Time Machine** — codzienny skan otoczenia, przeglądanie zmian w czasie
- [ ] **Agent wykonujący zadania** — realne kroki (pliki, przeglądarka) z akceptacją
- [ ] **Uniwersalny agent eksploracyjny** — jeden mózg, wiele „ciał"

---

> Kolejność partii można zmieniać. Napisz, którą chcesz jako następną, a zbuduję
> ją w całości i oznaczę tutaj jako gotową.

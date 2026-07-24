# 🎓 Cosmos — trening własnego modelu (fine-tuning)

Ten katalog to **opcjonalny** dodatek: pozwala dotrenować własny model na Twoich
rozmowach z Cosmosa i wpiąć go z powrotem jako profil **„Lokalnie"**. To osobny
proces — rdzeń Cosmosa działa bez niczego stąd.

> **Najpierw zrozum różnicę.** Funkcja „Nauka" w Cosmosie uczy **Cosmosa**
> (pamięć, wzorce, procedury) — **nie zmienia wag modelu**. Dopiero fine-tuning
> opisany tutaj **wpisuje** styl/domenę w wagi. Do wiedzy o faktach zwykle lepszy
> jest RAG (baza wiedzy), który już masz — dotrenowuj, gdy potrzebujesz spójnego
> **stylu, formatu lub zachowania**, których prompt nie daje.

---

## Kiedy to ma sens (i na czym)

| Cel | Metoda | Sprzęt |
|---|---|---|
| Styl/format/domena | **QLoRA** (ten skrypt) | RTX 3080 (model ~7B, 4-bit) |
| Mocniejsza adaptacja | pełny fine-tuning | chmura A100/H100 (~60–80 GB VRAM) |
| Model od zera | pre-training | ❌ nierealne indywidualnie |
| Wiedza o faktach | RAG / profil | już w Cosmosie, bez treningu |

Na **RTX 3080 (10 GB)** realny jest **QLoRA** modelu do ~7–9 mld parametrów w 4-bit.
Większe (13B+) — dołóż offloading albo wynajmij GPU (RunPod / Vast.ai / Lambda,
~0,5–2 $/h za konsumenckie, ~1,5–4 $/h za A100).

---

## Krok po kroku

### 1. Wyeksportuj dane z Cosmosa
W aplikacji: **Ustawienia → Dane treningowe → „Eksport JSONL (chat)"**.
Dostaniesz plik `cosmos-dataset-chat-RRRR-MM-DD.jsonl` — po jednej rozmowie na
linię, w formacie czatu (`messages[]`). Do LoRA wystarczą setki dobrych
przykładów; **jakość > ilość**. (Format „instrukcje" to pary `instruction/output`
— pod trenery, które tego oczekują.)

### 2. Zainstaluj narzędzia (Linux lub WSL2 z CUDA — zalecane)
```bash
pip install "unsloth[cu121] @ git+https://github.com/unslothai/unsloth.git"
```
[Unsloth](https://github.com/unslothai/unsloth) jest najszybszy i najoszczędniejszy
na jedno GPU. Alternatywa bez Unsloth: `pip install transformers peft trl bitsandbytes datasets accelerate`.

### 3. Odpal trening
```bash
python qlora_example.py \
  --data cosmos-dataset-chat-2026-07-23.jsonl \
  --model unsloth/Qwen2.5-7B-Instruct-bnb-4bit \
  --epochs 2 --gguf
```
Trening małego zbioru to zwykle kilka–kilkanaście minut na RTX 3080.

### 4. Wepnij model z powrotem do Cosmosa
Z flagą `--gguf` skrypt zapisze model w `cosmos-model-gguf/`. Zaimportuj do Ollamy:
```bash
ollama create cosmos-ft -f ./cosmos-model-gguf/Modelfile
```
W `.env` Cosmosa ustaw:
```ini
LOCAL_BASE_URL=http://localhost:11434/v1
LOCAL_MODEL=cosmos-ft
```
Przełącz w Cosmosie na profil **„Lokalnie"** — rozmawiasz z własnym, dotrenowanym
modelem, w tym samym interfejsie. **Pętla się domyka:** używasz → zbierasz dane →
dotrenowujesz → wpinasz lokalnie.

---

## Model bazowy — co wybrać

- **Qwen2.5 7B**, **Llama 3.1 8B**, **Mistral 7B** — sprawdzone, dużo wariantów 4-bit na Hugging Face.
- **Nemotron** (spójnie z Cosmosem): modele Nemotron są na Hugging Face; do
  fine-tuningu NVIDIA daje też framework **NeMo / NeMo Customizer** (LoRA na
  infrastrukturze NVIDII). Największe warianty trenuj w chmurze, nie na 3080.

---

## LoRA w chmurze na *większym* modelu (gdy 3080 to za mało)

Gdy lokalny model ~7B okaże się za słaby, **nie rób pełnego fine-tuningu** — to drogo
i daje marginalny zysk. Złoty środek to **QLoRA/LoRA na większym modelu** (np. 70B)
na wynajętym GPU. To ten **sam skrypt**, tylko na mocniejszej maszynie na kilka godzin.

**Ile to kosztuje (orientacyjnie):**

| GPU | Chmura „community" (RunPod/Vast/Lambda) | Hyperscaler |
|---|---|---|
| A100 80 GB | ~1,2–2,0 $/h | ~3–4 $/h |
| H100 | ~2–3,5 $/h | ~8–12 $/h |

QLoRA 70B to zwykle kilka godzin → **~10–30 $ za przebieg** na community A100/H100.
(Pełny fine-tuning byłby kilkukrotnie droższy i bardziej skomplikowany — pomiń go.)

**Krok po kroku:**

1. **Wyeksportuj dane** w Cosmosie (Ustawienia → Dane treningowe → „Eksport JSONL (chat)")
   i skopiuj plik na wynajętą maszynę (`scp` albo upload w panelu dostawcy).
2. **Wynajmij GPU** (RunPod / Vast.ai / Lambda) — wybierz obraz z CUDA/PyTorch,
   A100 80 GB (7B–13B QLoRA) lub H100 (30B–70B QLoRA).
3. **Na maszynie:**
   ```bash
   git clone <adres-repo-Cosmos> && cd Bear/training
   pip install "unsloth[cu121] @ git+https://github.com/unslothai/unsloth.git"
   python qlora_example.py --data <twoj-plik>.jsonl \
     --model unsloth/Meta-Llama-3.1-70B-Instruct-bnb-4bit --epochs 2 --gguf
   ```
4. **Pobierz wynik** (`cosmos-model-gguf/`) na swój komputer, zaimportuj do Ollamy
   (`ollama create cosmos-ft -f Modelfile`) i wpnij jako profil „Lokalnie" — jak wyżej.
5. **Wyłącz maszynę** zaraz po pobraniu — płacisz za każdą godzinę.

> **Prywatność:** dane rozmów trafiają na wynajętą maszynę na czas treningu. Wybieraj
> zaufanych dostawców, usuwaj pliki i wyłączaj instancję po zakończeniu. Sekrety/hasła
> i tak nie są częścią eksportu.

**Alternatywa bez wynajmu GPU:** zarządzane fine-tuning API (OpenAI, NVIDIA NeMo
Customizer, Together, Fireworks) — płacisz za tokeny treningu + hosting modelu;
prościej, ale koszt jest cykliczny i dane idą do dostawcy.

## Uwaga o prywatności
Eksport zawiera treść Twoich rozmów. Trzymaj plik JSONL i wytrenowany model
lokalnie; jeśli wynajmujesz GPU w chmurze, pamiętaj, że dane trafiają na tę maszynę
na czas treningu. Sekrety/hasła nie są częścią rozmów, więc nie trafiają do zbioru.

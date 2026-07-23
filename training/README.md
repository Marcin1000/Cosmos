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

## Uwaga o prywatności
Eksport zawiera treść Twoich rozmów. Trzymaj plik JSONL i wytrenowany model
lokalnie; jeśli wynajmujesz GPU w chmurze, pamiętaj, że dane trafiają na tę maszynę
na czas treningu. Sekrety/hasła nie są częścią rozmów, więc nie trafiają do zbioru.

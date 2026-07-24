#!/usr/bin/env python3
"""
Cosmos — przykładowy fine-tuning QLoRA na Twoich rozmowach.

To NIE jest część serwera Cosmosa — to osobny, opcjonalny skrypt, który
dotrenowuje mały model (LoRA/QLoRA) na zbiorze wyeksportowanym z Cosmosa
(Ustawienia → Dane treningowe → „Eksport JSONL (chat)").

Zaprojektowany pod jedno GPU (np. RTX 3080, 10 GB). Używa Unsloth, jeśli jest
zainstalowany (najszybciej, najmniej VRAM), a w innym wypadku podpowiada, jak
zainstalować. Wynik: adapter LoRA + opcjonalny eksport do GGUF pod Ollama,
którego wpinasz w Cosmosie jako profil „Lokalnie".

Instalacja (Linux/WSL z CUDA — zalecane):
    pip install "unsloth[cu121] @ git+https://github.com/unslothai/unsloth.git"
    #  (alternatywa bez Unsloth: pip install transformers peft trl bitsandbytes datasets accelerate)

Użycie:
    python qlora_example.py --data cosmos-dataset-chat-2026-07-23.jsonl \
        --model unsloth/Qwen2.5-7B-Instruct-bnb-4bit --epochs 2

Po treningu (eksport do Ollamy):
    # skrypt zapisze GGUF w ./cosmos-model-gguf/ — potem:
    ollama create cosmos-ft -f ./cosmos-model-gguf/Modelfile
    # w .env Cosmosa:  LOCAL_MODEL=cosmos-ft
"""
import argparse
import json
import os
import sys


def load_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    if not rows:
        sys.exit(f"Zbiór {path} jest pusty. Wyeksportuj więcej rozmów z Cosmosa.")
    print(f"Wczytano {len(rows)} przykładów z {path}")
    return rows


def main():
    ap = argparse.ArgumentParser(description="Cosmos QLoRA fine-tune")
    ap.add_argument("--data", required=True, help="plik JSONL z Cosmosa (format chat)")
    ap.add_argument("--model", default="unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
                    help="model bazowy w 4-bit (HF). Dla Nemotron patrz README.")
    ap.add_argument("--out", default="cosmos-lora", help="katalog na adapter LoRA")
    ap.add_argument("--epochs", type=int, default=2)
    ap.add_argument("--max-seq", type=int, default=2048)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--gguf", action="store_true", help="dodatkowo wyeksportuj GGUF pod Ollama")
    args = ap.parse_args()

    try:
        from unsloth import FastLanguageModel
        from unsloth.chat_templates import get_chat_template
    except ImportError:
        sys.exit(
            "Brak Unsloth. Zainstaluj:\n"
            '  pip install "unsloth[cu121] @ git+https://github.com/unslothai/unsloth.git"\n'
            "Alternatywa (ręcznie): transformers + peft + trl + bitsandbytes + datasets."
        )

    from datasets import Dataset
    from trl import SFTTrainer
    from transformers import TrainingArguments

    rows = load_jsonl(args.data)
    if "messages" not in rows[0]:
        sys.exit("Ten skrypt oczekuje formatu 'chat' (messages[]). "
                 "Użyj eksportu „chat” z Cosmosa.")

    # 1) model bazowy w 4-bit (QLoRA)
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=args.max_seq,
        load_in_4bit=True,
    )
    tokenizer = get_chat_template(tokenizer, chat_template="chatml")

    # 2) doczep adaptery LoRA (uczą się tylko one — reszta zamrożona)
    model = FastLanguageModel.get_peft_model(
        model, r=16, lora_alpha=16, lora_dropout=0,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth",
    )

    def fmt(ex):
        return {"text": tokenizer.apply_chat_template(
            ex["messages"], tokenize=False, add_generation_prompt=False)}

    ds = Dataset.from_list(rows).map(fmt)

    # 3) trening
    trainer = SFTTrainer(
        model=model, tokenizer=tokenizer, train_dataset=ds,
        dataset_text_field="text", max_seq_length=args.max_seq,
        args=TrainingArguments(
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            warmup_steps=5,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            fp16=not FastLanguageModel.is_bfloat16_supported(),
            bf16=FastLanguageModel.is_bfloat16_supported(),
            logging_steps=1,
            optim="adamw_8bit",
            output_dir="outputs",
        ),
    )
    trainer.train()

    # 4) zapis adaptera
    model.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    print(f"\n✓ Adapter LoRA zapisany w: {args.out}")

    # 5) opcjonalny eksport do GGUF pod Ollama
    if args.gguf:
        out_gguf = "cosmos-model-gguf"
        model.save_pretrained_gguf(out_gguf, tokenizer, quantization_method="q4_k_m")
        modelfile = os.path.join(out_gguf, "Modelfile")
        if not os.path.exists(modelfile):
            gguf = next((f for f in os.listdir(out_gguf) if f.endswith(".gguf")), None)
            if gguf:
                with open(modelfile, "w", encoding="utf-8") as f:
                    f.write(f"FROM ./{gguf}\n")
        print(f"✓ GGUF w: {out_gguf}  →  ollama create cosmos-ft -f {out_gguf}/Modelfile")


if __name__ == "__main__":
    main()

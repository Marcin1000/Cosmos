"""Odtwórz awarię z komputera Marcina: model tworzy się bez problemu,
a dopiero transkrypcja wywala się na braku cublas64_12.dll."""
import sys, types, io, os, tempfile

src = open("/home/user/Bear/senses/service.py", encoding="utf-8").read()
start = src.index("def _load_whisper")
end = src.index("\ndef get_piper")
ns = {"os": os}
exec(src[start:end], ns)

calls = {"gpu": 0, "cpu": 0}

class Info: language = "pl"

class FakeModel:
    def __init__(self, device): self.device = device
    def transcribe(self, path, language=None, vad_filter=False):
        if self.device != "cpu":
            # generator, więc błąd wypada dopiero przy iteracji — dokładnie jak
            # w faster-whisper; to dlatego stare zabezpieczenie nie działało
            def gen():
                raise RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")
                yield
            return gen(), Info()
        seg = types.SimpleNamespace(text=" dzien dobry ")
        return iter([seg]), Info()

def fake_load(device):
    calls["cpu" if device == "cpu" else "gpu"] += 1
    return FakeModel(device)

ns["_load_whisper"] = fake_load
ns["_whisper_model"] = None

# odtwórz ciało endpointu /stt (część z fallbackiem)
get_whisper, whisper_to_cpu, is_cuda = ns["get_whisper"], ns["whisper_to_cpu"], ns["_is_cuda_runtime_error"]

fail = []
try:
    segments, info = get_whisper().transcribe("x", language=None, vad_filter=True)
    segments = list(segments)
except Exception as e:
    if not is_cuda(e):
        fail.append("błąd CUDA nierozpoznany: " + str(e))
    else:
        print(f"  1. wykryto brak CUDA: {str(e)[:52]}…")
        segments, info = whisper_to_cpu().transcribe("x", language=None, vad_filter=True)
        segments = list(segments)

text = " ".join(s.text.strip() for s in segments).strip()
print(f"  2. po przejsciu na procesor: {text!r}, jezyk={info.language}")
print(f"  3. ładowań: GPU={calls['gpu']}, CPU={calls['cpu']}")
if text != "dzien dobry": fail.append("brak transkrypcji po fallbacku")
if calls["cpu"] != 1: fail.append("nie przełączono na procesor dokładnie raz")

# błąd niezwiązany z CUDA nie może być połykany
for msg, want in [("Invalid audio format", False), ("cuDNN library not found", True),
                  ("CUDA runtime error", True), ("file not found", False)]:
    got = is_cuda(RuntimeError(msg))
    if got != want: fail.append(f"zla klasyfikacja {msg!r}: {got}")
print(f"  4. rozpoznawanie błędów CUDA vs zwykłych: {'OK' if not any('klasyfik' in f for f in fail) else 'BŁĄD'}")

print("\nBŁĘDY: " + "; ".join(fail) if fail else "\nWHISPER — PRZEJŚCIE NA PROCESOR OK")
sys.exit(1 if fail else 0)

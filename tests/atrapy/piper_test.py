"""Sprawdź piper_wav() na trzech wersjach API Pipera — bez instalowania Pipera."""
import io, sys, wave, importlib.util

spec = importlib.util.spec_from_file_location("svc", "/home/user/Bear/senses/service.py")
# service.py przy imporcie próbuje ładować modele; interesuje nas jedna funkcja,
# więc wyciągamy jej źródło zamiast wykonywać cały moduł.
src = open("/home/user/Bear/senses/service.py", encoding="utf-8").read()
start = src.index("def piper_wav")
end = src.index("\ndef get_yolo")
ns = {"io": io}
exec(src[start:end], ns)
piper_wav = ns["piper_wav"]

PCM = b"\x01\x02" * 8000          # 8000 ramek 16-bit mono


class Chunk:
    sample_rate, sample_width, sample_channels = 22050, 2, 1
    def __init__(self, b): self.audio_int16_bytes = b


class NewApiWav:
    """piper 1.3 z synthesize_wav()"""
    def synthesize_wav(self, text, wav_file):
        wav_file.setnchannels(1); wav_file.setsampwidth(2); wav_file.setframerate(22050)
        wav_file.writeframes(PCM)


class NewApiGen:
    """piper 1.3 — synthesize() zwraca generator kawałków"""
    def synthesize(self, text):
        yield Chunk(PCM[:8000])
        yield Chunk(PCM[8000:])


class OldApi:
    """piper ≤1.2 — synthesize(text, wav_file)"""
    def synthesize(self, text, wav_file=None):
        if wav_file is None:
            raise TypeError("synthesize() wymaga wav_file")
        wav_file.setnchannels(1); wav_file.setsampwidth(2); wav_file.setframerate(22050)
        wav_file.writeframes(PCM)


class Broken:
    """zwraca pusty generator — tak wyglądała awaria u użytkownika"""
    def synthesize(self, text):
        return iter(())


fail = []
for name, voice, expect in [("piper 1.3 (synthesize_wav)", NewApiWav(), True),
                            ("piper 1.3 (generator)", NewApiGen(), True),
                            ("piper ≤1.2 (stare API)", OldApi(), True),
                            ("uszkodzony (pusty wynik)", Broken(), False)]:
    try:
        data = piper_wav(voice, "test")
    except Exception as e:
        print(f"  {name:32} WYJĄTEK: {type(e).__name__}: {e}")
        fail.append(name)
        continue
    if not data:
        print(f"  {name:32} pusty wynik" + ("  (oczekiwane)" if not expect else "  ← BŁĄD"))
        if expect: fail.append(name)
        continue
    with wave.open(io.BytesIO(data), "rb") as w:
        print(f"  {name:32} {len(data)} B, {w.getnchannels()} kanał, "
              f"{w.getframerate()} Hz, {w.getnframes()} ramek")
        if w.getnframes() != 8000: fail.append(name + " (zła liczba ramek)")

print("\nBŁĘDY: " + "; ".join(fail) if fail else "\nPIPER — WSZYSTKIE WERSJE API OK")
sys.exit(1 if fail else 0)

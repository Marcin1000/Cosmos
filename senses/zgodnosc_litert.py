"""Zgodność BirdNET z nowszym Pythonem: ai-edge-litert w miejsce tflite-runtime.

birdnetlib (analyzer.py) importuje interpreter TFLite tylko na dwa sposoby:
`tflite_runtime.interpreter` albo `tensorflow.lite`. tflite-runtime nie ma kół
dla Pythona 3.12+ (ostatnie 2.14.0 kończy się na 3.11) i wymaga numpy<2,
a pełny tensorflow to ~600 MB. Jego następca, ai-edge-litert (Google), ma koła
dla 3.10–3.14 i numpy 2 – i ten sam interfejs `Interpreter`.

Import tego modułu PRZED `import birdnetlib` rejestruje ai_edge_litert pod nazwą
tflite_runtime, gdy prawdziwego tflite_runtime nie ma. Gdy jest – nic nie robi.

    python senses/zgodnosc_litert.py     # powie, którego interpretera użyje BirdNET
"""
import sys
import types

ZRODLO = None  # "tflite-runtime" | "ai-edge-litert" | None (żadnego – zostaje tensorflow albo nic)

try:
    import tflite_runtime.interpreter  # noqa: F401
    ZRODLO = "tflite-runtime"
except ImportError:
    try:
        from ai_edge_litert import interpreter as _interpreter
    except ImportError:
        _interpreter = None
    if _interpreter is not None:
        _pakiet = types.ModuleType("tflite_runtime")
        _pakiet.interpreter = _interpreter
        sys.modules["tflite_runtime"] = _pakiet
        sys.modules["tflite_runtime.interpreter"] = _interpreter
        ZRODLO = "ai-edge-litert"


if __name__ == "__main__":
    print(f"Interpreter dla BirdNET: {ZRODLO or 'brak (zainstaluj ai-edge-litert)'}")

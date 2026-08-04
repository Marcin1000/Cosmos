"""Atrapa modelu ROZUMUJĄCEGO — odtwarza zachowania z ekranów Marcina.

Tryby wybierane treścią ostatniej wiadomości użytkownika:
  „pusto”   → cały budżet idzie w reasoning_content, content zostaje pusty
  „szukaj”  → w kółko prosi o [SZUKAJ: …], nigdy nie odpowiada sam z siebie
  inaczej   → normalna odpowiedź poprzedzona myśleniem
"""
import http.server, json, time

def sse(obj):
    return b"data: " + json.dumps(obj).encode() + b"\n\n"

def delta(**kw):
    return {"choices": [{"index": 0, "delta": kw}]}

class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        msgs = req.get("messages", [])
        user = ""
        for m in reversed(msgs):
            if m.get("role") == "user":
                user = m.get("content") if isinstance(m.get("content"), str) else ""
                break
        limit = "LIMIT WYSZUKIWAŃ" in user or "SEARCH LIMIT" in user
        results = "WYNIKI WYSZUKIWANIA" in user or "SEARCH RESULTS" in user

        if not req.get("stream"):
            # ścieżka niestrumieniowa (streszczenie, dopracowanie promptu)
            if "pusto" in user:
                body = {"choices": [{"message": {
                    "content": "",
                    "reasoning_content": "Rozważam punkty rozmowy: temat A, temat B."},
                    "finish_reason": "length"}]}
            else:
                body = {"choices": [{"message": {"content": "Streszczenie: punkt 1, punkt 2."}}]}
            b = json.dumps(body).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

        def send(chunks):
            for c in chunks:
                self.wfile.write(c); self.wfile.flush(); time.sleep(0.02)
            self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()

        if "pusto" in user:
            # cały budżet w myśleniu — dokładnie to dawało „(pusta odpowiedź modelu)”
            send([sse(delta(reasoning_content="Zastanawiam się nad ceną butów. ")),
                  sse(delta(reasoning_content="Musiałbym sprawdzić w sklepach. ")),
                  sse(delta(reasoning_content="Brakuje mi danych o modelu."))])
        elif limit:
            send([sse(delta(reasoning_content="Limit wyczerpany, odpowiadam. ")),
                  sse(delta(content="W Warszawie jest teraz 7 stopni (IMGW)."))])
        elif "szukaj" in user or results:
            send([sse(delta(reasoning_content="Potrzebuję świeżych danych. ")),
                  sse(delta(content='[SZUKAJ: "temperatura Warszawa teraz"]'))])
        else:
            send([sse(delta(reasoning_content="Krótkie pytanie, znam odpowiedź. ")),
                  sse(delta(content="Odpowiedź modelu."))])

    def do_GET(self):
        b = b'{"data":[{"id":"nvidia/nemotron-3-ultra-550b"}]}'
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", 7097), H).serve_forever()

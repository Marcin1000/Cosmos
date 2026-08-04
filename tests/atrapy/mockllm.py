"""Atrapa endpointu zgodnego z OpenAI — do sprawdzenia ścieżki /api/polish."""
import http.server, json
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n) or b"{}")
        user = next((m["content"] for m in req.get("messages", []) if m["role"] == "user"), "")
        out = "Zbuduj responsywną stronę internetową.\n\nWymagania:\n- estetyczny wygląd\n- szybkie ładowanie\n- poprawne działanie na telefonie\n\n[echo]" + user[:40]
        body = json.dumps({"choices": [{"message": {"content": out}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        # realistyczne, DŁUGIE identyfikatory — o nie rozbijała się lista na telefonie
        ids = ["nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
               "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1",
               "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
               "nvidia/nemotron-nano-9b-v2",
               "nvidia/nemotron-3-ultra-550b",
               "meta/llama-3.3-70b-instruct"]
        body = json.dumps({"data": [{"id": i} for i in ids]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", 7099), H).serve_forever()

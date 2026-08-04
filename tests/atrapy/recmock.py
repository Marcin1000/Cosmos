"""Atrapa modelu, która zapisuje otrzymane instrukcje — do sprawdzenia języka."""
import http.server, json
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        with open("rec.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(req, ensure_ascii=False) + "\n")
        b = json.dumps({"choices": [{"message": {"content": "gotowe"}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        b = b'{"data":[]}'
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", 7098), H).serve_forever()

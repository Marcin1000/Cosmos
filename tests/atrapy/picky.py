"""Atrapa dostawcy, który — jak modele rozumujące OpenAI — odrzuca
max_tokens i własną temperaturę. Sprawdza, czy serwer ponawia poprawnie."""
import http.server, json

seen = []
class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        seen.append(req)
        with open("picky.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps({k: v for k, v in req.items() if k != "messages"}) + "\n")
        bad = []
        if "max_tokens" in req:
            bad.append("Unsupported parameter: 'max_tokens' is not supported with this model. "
                       "Use 'max_completion_tokens' instead.")
        if "temperature" in req and req["temperature"] != 1:
            bad.append("Unsupported value: 'temperature' does not support 0.6 with this model.")
        if bad:
            b = json.dumps({"error": {"message": " ".join(bad), "type": "invalid_request_error"}}).encode()
            self.send_response(400)
        else:
            b = (b'data: ' + json.dumps({"choices": [{"delta": {"content": "Dziala po poprawce."}}]}).encode()
                 + b'\n\ndata: [DONE]\n\n')
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(b))); self.end_headers()
            self.wfile.write(b); return
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        b = b'{"data":[]}'
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass

http.server.ThreadingHTTPServer(("127.0.0.1", 7095), H).serve_forever()

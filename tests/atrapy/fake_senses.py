"""Atrapa usługi zmysłów: serwuje klatki „Kinecta", żeby przetestować całą drogę
   Python → serwer Cosmosa → przeglądarka bez podłączonego czujnika."""
import http.server, json, struct, zlib

def png(w, h, rgb):
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c))
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/kinect/status"):
            body = json.dumps({"available": True, "sensors": 1,
                               "streams": ["color", "depth"]}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
        elif self.path.startswith("/kinect/stream"):
            depth = "stream=depth" in self.path
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=kosmos")
            self.end_headers()
            try:
                for i in range(40):
                    # każda klatka inna — inaczej test „czy się odświeża" nic nie mierzy
                    base = (20, 80, 200) if depth else (200, 120, 40)
                    frame = png(64, 48, ((base[0] + i * 5) % 256, base[1], base[2]))
                    self.wfile.write(b"--kosmos\r\nContent-Type: image/png\r\n"
                                     + b"Content-Length: " + str(len(frame)).encode()
                                     + b"\r\n\r\n" + frame + b"\r\n")
                    self.wfile.flush()
                    import time; time.sleep(0.2)
            except Exception:
                pass
            return
        elif self.path.startswith("/kinect/frame"):
            depth = "stream=depth" in self.path
            body = png(64, 48, (20, 80, 200) if depth else (200, 120, 40))
            self.send_response(200); self.send_header("Content-Type", "image/png")
        elif self.path.startswith("/health"):
            body = json.dumps({"whisper": False, "yolo": True, "mediapipe": True,
                               "kinect": True}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
        else:
            self.send_response(404); body = b"{}"
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        self.rfile.read(n)
        if self.path.startswith("/detect"):
            body = json.dumps({"objects": [
                {"label": "person", "box": [10, 10, 40, 40], "conf": 0.9}]}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
        elif self.path.startswith("/pose"):
            body = json.dumps({"present": True,
                               "summary": "widoczna sylwetka, osoba prawdopodobnie stoi"}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
        elif self.path.startswith("/stt"):
            body = json.dumps({"text": "To jest test dyktowania przez Whisper.",
                               "language": "pl"}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
        elif self.path.startswith("/tts"):
            body = b"RIFF" + b"\x00" * 40 + b"\x00" * 1600
            self.send_response(200); self.send_header("Content-Type", "audio/wav")
        else:
            body = b"{}"; self.send_response(404)
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a): pass

http.server.ThreadingHTTPServer(("127.0.0.1", 7060), H).serve_forever()

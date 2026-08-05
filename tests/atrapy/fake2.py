"""Atrapa zmysłów z obsługą strumienia MJPEG."""
import http.server, json, struct, zlib, time

def png(w, h, rgb):
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c))
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))

class H(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_GET(self):
        if self.path.startswith("/kinect/stream"):
            depth = "stream=depth" in self.path
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            try:
                for i in range(40):
                    body = png(64, 48, (20, 80, 200) if depth else (200, 120, i % 200))
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                     + str(len(body)).encode() + b"\r\n\r\n" + body + b"\r\n")
                    self.wfile.flush(); time.sleep(0.07)
            except Exception:
                pass
            return
        if self.path.startswith("/kinect/status"):
            body = json.dumps({"available": True, "sensors": 1}).encode(); ct = "application/json"
        elif self.path.startswith("/kinect/frame"):
            body = png(64, 48, (20, 80, 200) if "depth" in self.path else (200, 120, 40)); ct = "image/png"
        elif self.path.startswith("/health"):
            body = json.dumps({"kinect": True}).encode(); ct = "application/json"
        else:
            self.send_response(404); self.send_header("Content-Length", "2"); self.end_headers()
            self.wfile.write(b"{}"); return
        self.send_response(200); self.send_header("Content-Type", ct)
        self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass

http.server.ThreadingHTTPServer(("127.0.0.1", 7060), H).serve_forever()

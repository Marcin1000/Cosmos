/* Kinect ma jednego właściciela – usługę zmysłów.

   Zgłoszenie Marcina (Windows 11, Kinect 360, bez zwykłej kamery): obserwator
   „Nie udało się uruchomić” z przyczyną „Nie widać Kinecta”, choć Kinect
   działał, a podgląd Kinecta w Cosmosie czarny. Kinect for Windows SDK 1.8
   oddaje czujnik jednemu procesowi: zmysł głębi otwierał go pierwszy, więc
   usługa zmysłów (podgląd) dostawała „urządzenie w użyciu”, a obserwator
   szukał zwykłej kamery, której nie ma.

   Bez Kinecta i bez przeglądarki – usługę zmysłów udaje serwer HTTP w Node,
   a moduły Pythona (cv2, ultralytics, requests) zastępują atrapy:
     1. przyczyna upadku w Ustawieniach: dziennik obserwatora z prawdziwego
        zgłoszenia → „kamera”, nie „Kinect”; prawdziwy błąd Kinecta → „Kinect”,
     2. obserwator bez zwykłej kamery bierze obraz Kinecta z usługi zmysłów,
     3. zmysł głębi bierze głębię i sylwetki z usługi, zamiast otwierać czujnik,
     4. przy KINECT_PRZEZ_USLUGE=1 czeka na usługę, która wstaje później,
        a bez tej zmiennej i bez usługi nie czeka,
     5. agent: zmysły włączone po obserwatorze → obserwator startuje od nowa
        z KINECT_PRZEZ_USLUGE=1 (inaczej trzymałby czujnik sam),
     6. usługa zmysłów (prawdziwy service.py pod FastAPI TestClient, udawany
        czujnik): surowa głębia i sylwetki, czujnik otwarty RAZ na dwanaście
        żądań naraz, odczyty z niego po kolei, nigdy dwa jednocześnie,
     7. ciało na mediapipe bez `solutions` (0.10.30+, jedyne z kołami dla
        Pythona 3.13): /pose działa przez Tasks API zamiast 501,
     8. agent trzyma stałe połączenia z serwerem (Marcin: podgląd Kinecta
        „strasznie poklatkowy” – każda klatka to trzy zapytania i każde
        otwierało nowe połączenie HTTPS): kolejne zapytania z różnych wątków
        idą jednym połączeniem, zamknięte przez serwer otwiera się samo,
        a błąd HTTP dalej jest wyjątkiem z czytelną treścią,
     9. zlecenie bez ciała (klatka Kinecta) nie czeka na potwierdzenie:
        wynik wraca, zanim serwer odpowie na /cialo.
*/
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { utworzZmyslyWidok } = require('../../public/zmysly-widok.js');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const SENSES = path.join(__dirname, '..', '..', 'senses');

/* ---- 1. Przyczyna upadku ---- */
const SLOWNIK = { 'zm.why.camera': 'KAMERA', 'zm.why.kinect': 'KINECT', 'zm.why.module': 'MODUŁ {modul}', 'zm.why.port': 'PORT', 'zm.why.other': 'INNE' };
const { dlaczego } = utworzZmyslyWidok({ $: () => null, t: (k) => SLOWNIK[k] || k });
const LOG_ZGLOSZENIA = '[ERROR:0@2.094] global obsensor_uvc_stream_channel.cpp:163 cv::obsensor::getStreamChannelGroup Camera index out of range\n'
  + 'Nie mogę otworzyć kamery 0.\nSprawdź, co widzi system:\n  python -c "import cv2; print([i for i in range(6) if cv2.VideoCapture(i).isOpened()])"\n'
  + 'Pusta lista = brak kamery dla OpenCV. Masz Kinecta? Ustaw CAMERA_SOURCE=kinect\n– Kinect nie jest kamerą UVC, ale jego obraz RGB czyta kinect_win.py.';
ok(dlaczego(LOG_ZGLOSZENIA) === 'KAMERA', `1. dziennik obserwatora ze zgłoszenia → kamera („${dlaczego(LOG_ZGLOSZENIA)}”)`);
const LOG_KINECTA = 'Nie udało się otworzyć Kinecta żadnym sterownikiem:\n  • win: NuiInitialize nie powiodło się: urządzenie w użyciu';
ok(dlaczego(LOG_KINECTA) === 'KINECT', `1. prawdziwy błąd Kinecta → Kinect („${dlaczego(LOG_KINECTA)}”)`);
ok(dlaczego("ModuleNotFoundError: No module named 'ultralytics'") === 'MODUŁ ultralytics', '1. brakujący pakiet nazwany po imieniu');

/* ---- Atrapa usługi zmysłów ---- */
function atrapaUslugi(port) {
  const zapytania = [];
  const srv = http.createServer((req, res) => {
    zapytania.push(req.url);
    const p = req.url.split('?')[0];
    if (p === '/kinect/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"available":true,"sensors":1}'); }
    if (p === '/kinect/frame') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 1, 2, 3])); }
    if (p === '/kinect/depth') {
      const b = Buffer.alloc(4 * 3 * 2);
      for (let i = 0; i < 12; i++) b.writeUInt16LE(1000 + i, i * 2);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Szerokosc': '4', 'X-Wysokosc': '3' });
      return res.end(b);
    }
    if (p === '/kinect/sylwetki') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"sylwetki":[{"id":7,"stawy":{},"opis":{"postawa":"stoi"}}]}'); }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ srv, zapytania })));
}

// Atrapy modułów, których nie ma w środowisku testów (i nie są tu potrzebne).
const ATRAPY = `
import sys, types
cv2 = types.ModuleType("cv2")
class _Cap:
    def __init__(self, i): pass
    def isOpened(self): return False
    def release(self): pass
cv2.VideoCapture = _Cap
cv2.IMREAD_COLOR = 1
cv2.imdecode = lambda buf, flag: ("klatka", len(buf))
sys.modules["cv2"] = cv2
u = types.ModuleType("ultralytics"); u.YOLO = object; sys.modules["ultralytics"] = u
rq = types.ModuleType("requests"); rq.post = lambda *a, **k: None
class _E(Exception): pass
rq.RequestException = _E; sys.modules["requests"] = rq
kw = types.ModuleType("kinect_win")
def _nie(*a, **k): raise RuntimeError("czujnik otwarty wprost – a miał być z usługi")
kw.Kinect = _nie; kw.sensor_count = lambda: 1
sys.modules["kinect_win"] = kw
sys.path.insert(0, ${JSON.stringify(SENSES)})
`;

// Asynchronicznie: atrapa usługi żyje w tym samym procesie, spawnSync by ją zamroził.
function uruchom(argumenty, env) {
  return new Promise((gotowe) => {
    const p = spawn('python3', argumenty, { env: { ...process.env, ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const straz = setTimeout(() => p.kill(), 60000);
    p.on('close', (kod) => { clearTimeout(straz); gotowe({ kod, out: out.trim(), err: err.trim() }); });
  });
}
const python = (kod, env) => uruchom(['-c', ATRAPY + kod], env);

(async () => {
  let numpy = true;
  try { execFileSync('python3', ['-c', 'import numpy']); } catch { numpy = false; }
  const PORT = 7461;
  const env = { SENSES_PORT: String(PORT), KINECT_CZEKAJ_S: '15', KINECT_PRZEZ_USLUGE: '0', CAMERA_SOURCE: 'auto' };
  const { srv, zapytania } = await atrapaUslugi(PORT);
  try {
    /* ---- 2. Obserwator bez kamery → Kinect z usługi ---- */
    if (!numpy) console.log('POMINIĘTE 2–4: brak numpy w python3');
    else {
      const r = await python('import watcher\ncam = watcher.open_camera()\nprint(type(cam).__name__)\nprint(cam.read())', env);
      const [klasa, klatka] = r.out.split('\n').slice(-2);
      ok(klasa === 'KameraZUslugi', `2. obserwator bez zwykłej kamery bierze Kinecta z usługi (${klasa || r.err.split('\n').pop()})`);
      ok(/klatka/.test(klatka || '') && zapytania.some((u) => u.startsWith('/kinect/frame')), '2. klatka przychodzi z /kinect/frame usługi');

      /* ---- 3. Zmysł głębi przez usługę ---- */
      const g = await python('import kinect_watcher\ns = kinect_watcher.open_source()\nd = s.depth_mm()\nprint(type(s).__name__, d.shape, int(d[2][3]), s.skeletons()[0]["id"])', env);
      ok(g.out.endsWith('GlebiaZUslugi (3, 4) 1011 7'), `3. zmysł głębi: głębia i sylwetki z usługi, czujnik nieotwierany („${g.out || g.err.split('\n').pop()}”)`);

      /* ---- 4. Czekanie na usługę ---- */
      srv.close();
      await new Promise((r) => setTimeout(r, 200));
      const bez = await python('import time, kinect_usluga\nt = time.time()\nprint(kinect_usluga.przez_usluge(lambda *a: None), round(time.time() - t))', env);
      ok(bez.out === 'False 0', `4. bez usługi i bez KINECT_PRZEZ_USLUGE nie czeka („${bez.out || bez.err}”)`);
      setTimeout(() => atrapaUslugi(PORT).then((a) => { global.drugi = a.srv; }), 4000);
      const cz = await python('import time, kinect_usluga\nt = time.time()\nprint(kinect_usluga.przez_usluge(lambda *a: None), time.time() - t > 3)', { ...env, KINECT_PRZEZ_USLUGE: '1' });
      ok(cz.out === 'True True', `4. z KINECT_PRZEZ_USLUGE=1 czeka na usługę, która wstaje później („${cz.out || cz.err}”)`);
    }

    /* ---- 5. Agent przestawia obserwatora, gdy włączono zmysły ---- */
    const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-kinect-'));
    const pliki = path.join(kat, 'senses');
    fs.mkdirSync(pliki, { recursive: true });
    const skrypt = 'import os, time\nopen(os.path.join(os.environ["COSMOS_AGENT_DIR"], "env-" + os.path.basename(__file__) + ".txt"), "a").write(os.environ.get("KINECT_PRZEZ_USLUGE", "?") + "\\n")\ntime.sleep(60)\n';
    for (const f of ['service.py', 'watcher.py', 'kinect_watcher.py']) fs.writeFileSync(path.join(pliki, f), skrypt);
    const a = await uruchom(['-c', `
import sys, time
sys.path.insert(0, ${JSON.stringify(SENSES)})
import agent
agent.zmysly_odpowiadaja = lambda: (False, {})
class A: pass
ag = A(); ag.serwer = "http://127.0.0.1:1"; ag.token = "t"; ag.chce = {"obserwator": True}
import threading; ag.budzik = threading.Event()
s = agent.Skladniki(ag)
s.uzgodnij(ag.chce)
time.sleep(1.5)
ag.chce = {"obserwator": True, "zmysly": True}
s.uzgodnij(ag.chce)
time.sleep(1.5)
s.zatrzymaj_wszystko()
`], { COSMOS_AGENT_DIR: kat, SENSES_PORT: '7462' });
    let zapis = '';
    try { zapis = fs.readFileSync(path.join(kat, 'env-watcher.py.txt'), 'utf-8').trim().split('\n').join(','); } catch { /* brak */ }
    ok(zapis === '0,1', `5. obserwator: start bez zmysłów (0), po włączeniu zmysłów od nowa przez usługę (1) → „${zapis || (a.err || '').split('\n').slice(-2).join(' ')}”`);
    fs.rmSync(kat, { recursive: true, force: true });

    /* ---- 6–7. Usługa zmysłów ---- */
    let fastapi = true;
    try { execFileSync('python3', ['-c', 'import fastapi, httpx, numpy']); } catch { fastapi = false; }
    if (!fastapi) console.log('POMINIĘTE 6–7: brak fastapi/httpx/numpy w python3');
    else {
      const u = await uruchom([path.join(__dirname, '..', 'atrapy', 'usluga_kinect.py'), SENSES], {});
      let w = {};
      try { w = JSON.parse(u.out.split('\n').pop()); } catch { console.log(u.err.split('\n').slice(-5).join('\n')); }
      ok(JSON.stringify(w.glebia) === '[200,"4","3",1011]', `6. /kinect/depth: surowe milimetry z wymiarami (${JSON.stringify(w.glebia)})`);
      ok(w.sylwetki && w.sylwetki.sylwetki && w.sylwetki.sylwetki[0].id === 5, '6. /kinect/sylwetki oddaje śledzone osoby');
      ok(w.otwarcia === 1, `6. czujnik otwarty raz na wszystkie żądania (${w.otwarcia})`);
      ok(w.naraz_max === 1, `6. odczyty z czujnika po kolei, nigdy dwa naraz (najwięcej naraz: ${w.naraz_max})`);
      ok(w['caps_ciało'] === true, '7. mediapipe bez `solutions` zgłaszany jako działające ciało');
      ok(w.poza && w.poza[0] === 200 && /stoi/.test(w.poza[1]), `7. /pose przez Tasks API (${JSON.stringify(w.poza)})`);
      ok(w.model && w.model[0] === '/atrapa/pose_landmarker_lite.task', '7. model sylwetki z POSE_MODEL');
    }

    /* ---- 8–9. Stałe połączenia agenta, potwierdzenie obok ---- */
    const P2 = 7463;
    const gniazda = [];
    let cialoSkonczone = 0, wynikPrzyszedl = 0;
    const serwerAgenta = http.createServer((req, res) => {
      const g = req.socket.__sciezki || (req.socket.__sciezki = [], gniazda.push(req.socket.__sciezki), req.socket.__sciezki);
      const p = req.url.split('?')[0];
      g.push(p);
      if (p === '/ping') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
      if (p === '/blad') { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"nie ma takiego zlecenia"}'); }
      if (p === '/kinect/frame') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 9])); }
      if (p === '/api/agent/cialo') {
        return setTimeout(() => { cialoSkonczone = Date.now(); res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(); }, 800);
      }
      if (p === '/api/agent/wynik') {
        req.resume();
        return req.on('end', () => { wynikPrzyszedl = Date.now(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
      }
      res.writeHead(404); res.end();
    });
    serwerAgenta.keepAliveTimeout = 300;   // bezczynne połączenie zamyka serwer (Node dokłada do tego ~1 s) – agent ma to przeżyć
    await new Promise((r) => serwerAgenta.listen(P2, '127.0.0.1', r));
    const ag = await uruchom(['-c', `
import sys, json, time, threading
sys.path.insert(0, ${JSON.stringify(SENSES)})
import agent
S = "http://127.0.0.1:${P2}"
for i in range(10):
    t = threading.Thread(target=lambda: agent.zapytanie(S, "/ping")); t.start(); t.join()
time.sleep(2.0)
po_przerwie = agent.zapytanie(S, "/ping")[1].get("ok")
try:
    agent.zapytanie(S, "/blad"); blad = None
except agent.urllib.error.HTTPError as e:
    blad = [e.code, json.loads(e.read())["error"]]
a = object.__new__(agent.Agent)
a.serwer, a.token = S, "t"
a.krotkie, a.dlugie = threading.Semaphore(4), threading.Semaphore(2)
a.pule = {"/kinect/": threading.Semaphore(2)}
a.przekaz({"id": "z1", "metoda": "GET", "sciezka": "/kinect/frame?stream=color", "naglowki": {}, "dlugosc": 0})
time.sleep(1.2)
print(json.dumps({"po_przerwie": po_przerwie, "blad": blad}, ensure_ascii=False))
`], { SENSES_PORT: String(P2), COSMOS_AGENT_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pol-')) });
    serwerAgenta.close();
    let w8 = {};
    try { w8 = JSON.parse(ag.out.split('\n').pop()); } catch { console.log(ag.err.split('\n').slice(-4).join('\n')); }
    const zPingiem = gniazda.filter((g) => g.includes('/ping'));
    const najwiecejNaJednym = Math.max(0, ...zPingiem.map((g) => g.filter((x) => x === '/ping').length));
    ok(najwiecejNaJednym >= 10, `8. dziesięć zapytań z różnych wątków jednym połączeniem (najwięcej na jednym: ${najwiecejNaJednym}, połączeń: ${zPingiem.length})`);
    ok(w8.po_przerwie === true && zPingiem.length === 2, `8. połączenie zamknięte przez serwer otwiera się samo (${w8.po_przerwie}, połączeń z zapytaniami: ${zPingiem.length})`);
    ok(JSON.stringify(w8.blad) === '[404,"nie ma takiego zlecenia"]', `8. błąd HTTP to wyjątek z treścią (${JSON.stringify(w8.blad)})`);
    ok(wynikPrzyszedl && cialoSkonczone && wynikPrzyszedl < cialoSkonczone, `9. zlecenie bez ciała: wynik wrócił ${wynikPrzyszedl && cialoSkonczone ? cialoSkonczone - wynikPrzyszedl : '?'} ms przed odpowiedzią na /cialo`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    srv.close();
    if (global.drugi) global.drugi.close();
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nKINECT, JEDEN WŁAŚCICIEL OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Atrapa usługi ptaków na serwerze (senses/service.py z COSMOS_ZMYSLY_TYLKO=ptak).

   Kontrakt jak prawdziwa usługa: GET /health, POST /ptak (surowe nagranie w ciele),
   inne trasy – 404 (biała lista). Dokłada tylko to, czego test potrzebuje, żeby
   sprawdzić GWARANCJE, a nie brzmienie:
   - `skrot` w odpowiedzi = sha1 nagrania, które dotarło. Każdy klient wie, co
     wysłał, więc od razu widać pomieszanie wyników między osobami;
   - GET /licznik – ile razy wołano każdą trasę (biała lista: /detect, /stt…
     przy samym źródle „serwer” mają dać 0) i co przyszło w ostatnim /ptak
     (adres, współrzędne, skąd – test prywatności: współrzędne nie w adresie).

   Uruchomienie:  node tests/atrapy/mock-ptaki.js 7061 [tryb]
   Tryby (argument, zmienna TRYB, na żywo GET /tryb?ustaw=…, albo ?tryb= w /ptak):
     ok          – od razu gatunek (bogatka)
     wolny       – odpowiedź po OPOZNIENIE_MS (domyślnie 3000; ?ms= w /ptak)
     brak        – /health birdnet:false, /ptak 503 (usługa bez BirdNET-u)
     500         – /ptak 500 z domową ścieżką Windows w treści (test: członek jej nie widzi)
     rozgrzewka  – /health birdnet_gotowy:false, /ptak 503 z Retry-After
   GET /licznik?zeruj=1 – zeruje liczniki. */
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.argv[2] || process.env.PORT || 7061);
let tryb = process.argv[3] || process.env.TRYB || 'ok';
const OPOZNIENIE_MS = Number(process.env.OPOZNIENIE_MS || 3000);
const TRYBY = new Set(['ok', 'wolny', 'brak', '500', 'rozgrzewka']);

let licznik = { trasy: {}, ptak: 0, health: 0, ostatnie: null };
const zeruj = () => { licznik = { trasy: {}, ptak: 0, health: 0, ostatnie: null }; };

const json = (res, kod, obj, naglowki = {}) => {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(kod, { 'Content-Type': 'application/json', 'Content-Length': b.length, ...naglowki });
  res.end(b);
};

// Jak service.py: nagłówek ma pierwszeństwo, potem adres; zaokrąglenie do 0,1°.
const liczba = (x, granica) => {
  if (x === undefined || x === null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) && Math.abs(n) <= granica ? Math.round(n * 10) / 10 : null;
};
function wspolrzedne(req, q) {
  const zNaglowka = [liczba(req.headers['x-cosmos-lat'], 90), liczba(req.headers['x-cosmos-lon'], 180)];
  if (zNaglowka[0] !== null && zNaglowka[1] !== null) return { lat: zNaglowka[0], lon: zNaglowka[1], skad: 'naglowek' };
  const zAdresu = [liczba(q.get('lat'), 90), liczba(q.get('lon'), 180)];
  if (zAdresu[0] !== null && zAdresu[1] !== null) return { lat: zAdresu[0], lon: zAdresu[1], skad: 'adres' };
  return { lat: null, lon: null, skad: null };
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  licznik.trasy[u.pathname] = (licznik.trasy[u.pathname] || 0) + 1;
  const kawalki = [];
  req.on('data', (c) => kawalki.push(c));
  req.on('end', () => {
    const cialo = Buffer.concat(kawalki);

    if (req.method === 'GET' && u.pathname === '/licznik') {
      const kopia = JSON.parse(JSON.stringify(licznik));
      if (u.searchParams.get('zeruj')) zeruj();
      return json(res, 200, kopia);
    }
    if (req.method === 'GET' && u.pathname === '/tryb') {
      const nowy = u.searchParams.get('ustaw');
      if (nowy && TRYBY.has(nowy)) tryb = nowy;
      return json(res, 200, { tryb });
    }
    if (req.method === 'GET' && u.pathname === '/health') {
      licznik.health++;
      return json(res, 200, {
        whisper: false, piper: false, yolo: false, mediapipe: false, dlonie: false, embed: false,
        upscale: false, kinect: false, dokumenty: false,
        birdnet: tryb !== 'brak', birdnet_gotowy: tryb !== 'brak' && tryb !== 'rozgrzewka',
      });
    }
    if (req.method === 'POST' && u.pathname === '/ptak') {
      licznik.ptak++;
      const w = wspolrzedne(req, u.searchParams);
      licznik.ostatnie = { adres: req.url, ...w, bajty: cialo.length, jezyk: u.searchParams.get('jezyk') || req.headers['x-cosmos-jezyk'] || null };
      const t = u.searchParams.get('tryb') || tryb;
      if (t === 'brak') return json(res, 503, { error: 'BirdNET niedostępny.', kod: 'ptaki-niedostepne' });
      if (t === 'rozgrzewka') return json(res, 503, { error: 'BirdNET się rozgrzewa.', kod: 'kolejka-pelna' }, { 'Retry-After': '10' });
      if (t === '500') {
        return json(res, 500, { error: 'BirdNET nie przeanalizował nagrania: [Errno 2] No such file or directory: '
          + "'C:\\Users\\Marcin\\AppData\\Local\\Temp\\tmpk3j2.wav'", gdzie: '/ptak' });
      }
      if (!cialo.length) return json(res, 400, { error: 'Puste nagranie.' });
      const odpowiedz = () => {
        const en = (u.searchParams.get('jezyk') || req.headers['x-cosmos-jezyk'] || 'pl').startsWith('en');
        json(res, 200, {
          gatunki: [{ nazwa: en ? 'Great Tit' : 'bogatka', nazwaEn: 'Great Tit', lacinska: 'Parus major',
            pewnosc: 0.91, odS: 0, doS: 3 }],
          wykryc: 2,
          zMiejscem: w.lat !== null,
          skrot: crypto.createHash('sha1').update(cialo).digest('hex'),
        });
      };
      if (t === 'wolny') {
        const ms = Number(u.searchParams.get('ms')) || OPOZNIENIE_MS;
        const zegar = setTimeout(odpowiedz, ms);
        res.on('close', () => clearTimeout(zegar));
        return;
      }
      return odpowiedz();
    }
    return json(res, 404, { error: 'Tej trasy ta usługa nie obsługuje.' });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`atrapa ptaków na ${PORT}, tryb ${tryb}`));

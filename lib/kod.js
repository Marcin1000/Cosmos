/* ============================================================
   Liczenie na danych — odpowiednik „Code Interpreter"

   Model pisze kawałek JavaScriptu, Cosmos go uruchamia i oddaje wynik
   z powrotem do rozmowy. Dzięki temu na pytanie „ile wyszło razem w tym
   arkuszu" nie dostajesz oszacowania, tylko liczbę — policzoną, nie
   zgadniętą.

   ⚠ CZEGO TO NIE JEST
   To NIE jest twarda piaskownica. Model uprawnień Node blokuje dostęp do
   plików poza katalogiem roboczym oraz uruchamianie podprocesów, i to
   sprawdzamy w baterii. Ale SIECI nie obejmuje: kod, który dostanie się tutaj,
   może wykonać żądanie HTTP. Dlatego:
     • do procesu nie trafia ŻADNA zmienna środowiskowa (klucze API zostają
       po tej stronie),
     • katalog roboczy jest tymczasowy i kasowany po wykonaniu,
     • jest twardy limit czasu i rozmiaru wyjścia,
     • całość wyłącza się jednym `CODE_EXEC=off`.
   Przy prywatnym serwerze jednego użytkownika to rozsądny kompromis, ale
   nazywanie tego piaskownicą byłoby nieuczciwe.
   ============================================================ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WLACZONE = (process.env.CODE_EXEC || 'on') !== 'off';
const LIMIT_MS = Number(process.env.CODE_TIMEOUT_MS || 10000);
const LIMIT_WYJSCIA = Number(process.env.CODE_MAX_OUTPUT || 20000);
const LIMIT_PAMIECI_MB = Number(process.env.CODE_MAX_MEMORY_MB || 256);
// Plik wynikowy większy niż to nie wróci do rozmowy — wykres SVG mieści się
// z zapasem, a przypadkowy zrzut gigabajta danych nie zapcha przeglądarki.
const LIMIT_PLIKU = Number(process.env.CODE_MAX_FILE || 400000);

/** Uruchom kod w tymczasowym katalogu z danymi wejściowymi.
 *  @param {string} kod           JavaScript do wykonania
 *  @param {Array}  pliki         [{ name, text }] — dane widoczne dla kodu
 *  @returns {{ stdout, stderr, wyniki, ms, przerwany }}
 */
async function uruchomKod(kod, pliki = []) {
  if (!WLACZONE) {
    return { stdout: '', stderr: 'Wykonywanie kodu jest wyłączone (CODE_EXEC=off).', wyniki: [], ms: 0 };
  }
  const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-kod-'));
  const start = Date.now();
  try {
    fs.writeFileSync(path.join(katalog, 'program.js'), kod);
    // Załączniki z rozmowy lądują obok programu, żeby dało się je wczytać
    // przez zwykłe `fs.readFileSync('dane.csv', 'utf8')`.
    const wejscia = [];
    for (const p of pliki) {
      const bezpieczna = String(p.name || 'dane').replace(/[^\w.\-]/g, '_').slice(0, 80);
      fs.writeFileSync(path.join(katalog, bezpieczna), String(p.text || ''));
      wejscia.push(bezpieczna);
    }

    const wynik = await new Promise((resolve) => {
      const proc = spawn(process.execPath, [
        '--permission',
        `--allow-fs-read=${katalog}`,
        `--allow-fs-write=${katalog}`,
        `--max-old-space-size=${LIMIT_PAMIECI_MB}`,
        'program.js',
      ], {
        cwd: katalog,
        // Pusty env to najważniejsza linijka w tym pliku: klucze API są
        // w zmiennych środowiskowych, a kod pisze model.
        env: { PATH: '/usr/bin:/bin', NODE_OPTIONS: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let out = '';
      let err = '';
      let przerwany = false;
      const stoper = setTimeout(() => { przerwany = true; proc.kill('SIGKILL'); }, LIMIT_MS);

      proc.stdout.on('data', (c) => {
        if (out.length < LIMIT_WYJSCIA) out += c.toString();
      });
      proc.stderr.on('data', (c) => {
        if (err.length < LIMIT_WYJSCIA) err += c.toString();
      });
      proc.on('error', (e) => {
        clearTimeout(stoper);
        resolve({ stdout: '', stderr: `Nie udało się uruchomić: ${e.message}`, przerwany: false });
      });
      proc.on('close', () => {
        clearTimeout(stoper);
        resolve({ stdout: out, stderr: err, przerwany });
      });
    });

    // Co kod zostawił po sobie — wykresy, tabele, cokolwiek zapisał.
    const wyniki = [];
    for (const nazwa of fs.readdirSync(katalog)) {
      if (nazwa === 'program.js' || wejscia.includes(nazwa)) continue;
      const pelna = path.join(katalog, nazwa);
      try {
        const stat = fs.statSync(pelna);
        if (!stat.isFile() || stat.size > LIMIT_PLIKU) continue;
        wyniki.push({ name: nazwa, text: fs.readFileSync(pelna, 'utf8') });
      } catch { /* plik zniknął albo nie jest tekstem — pomijamy */ }
    }

    return {
      stdout: wynik.stdout.slice(0, LIMIT_WYJSCIA),
      stderr: wynik.stderr.slice(0, LIMIT_WYJSCIA),
      wyniki,
      ms: Date.now() - start,
      przerwany: wynik.przerwany,
      limitMs: LIMIT_MS,
    };
  } finally {
    try { fs.rmSync(katalog, { recursive: true, force: true }); } catch { /* i tak w /tmp */ }
  }
}

module.exports = { uruchomKod, WLACZONE, LIMIT_MS };

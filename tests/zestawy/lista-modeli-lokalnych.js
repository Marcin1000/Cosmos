/* „Pobierz listę" przy modelu lokalnym: komunikat mówi, CO się stało.

   Zgłoszenie Marcina ze zrzutem: „fetch failed" i trzy podpowiedzi naraz,
   z których żadna nie była pewna. Są dwie różne sytuacje i każda ma inne
   lekarstwo:
     1. Komputer jest w sieci, ale na porcie Ollamy nic nie słucha (odmowa
        połączenia) → uruchom Ollamę albo ustaw OLLAMA_HOST.
     2. Komputera nie ma w sieci (cisza, brak trasy) → obudź go, sprawdź
        Tailscale. Tu podpowiedź o OLLAMA_HOST tylko myli.
*/
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { czekajNa } = require('../pomoc');

const KORZEN = path.resolve(__dirname, '..', '..');

async function zapytaj(port, localUrl) {
  const srv = spawn('node', ['server.js'], {
    cwd: KORZEN, stdio: 'ignore', detached: true,
    env: { ...process.env, PORT: String(port), LOCAL_BASE_URL: localUrl,
      COSMOS_DATA_DIR: path.join(os.tmpdir(), `cosmos-lml-${port}-${Date.now()}`) },
  });
  try {
    await czekajNa(`http://127.0.0.1:${port}/api/config`);
    const r = await fetch(`http://127.0.0.1:${port}/api/models?endpoint=local`,
      { signal: AbortSignal.timeout(30000) });
    return { status: r.status, error: String((await r.json()).error || '') };
  } finally {
    try { process.kill(-srv.pid); } catch { /* już nie żyje */ }
  }
}

(async () => {
  const fail = [];

  // 1. Port, na którym nic nie nasłuchuje: odmowa połączenia.
  const a = await zapytaj(3471, 'http://127.0.0.1:7122/v1');
  console.log(`1. odmowa → HTTP ${a.status}: ${a.error.split('\n')[0]}`);
  if (a.status !== 502) fail.push(`odmowa: HTTP ${a.status} zamiast 502`);
  if (!/Ollama nie przyjmuje/.test(a.error)) fail.push('odmowa połączenia nie mówi, że to Ollama nie przyjmuje połączeń');
  if (!/OLLAMA_HOST/.test(a.error)) fail.push('przy odmowie brak podpowiedzi o OLLAMA_HOST');
  if (/uśpiony/.test(a.error)) fail.push('przy odmowie podpowiedź o uśpionym komputerze myli');

  /* 2. Cisza: połączenie przyjęte, odpowiedź nie przychodzi nigdy. Tak wygląda
        uśpiony komputer za Tailscale; adres spoza sieci w piaskownicy testów
        dostaje od razu odmowę, więc ciszę robimy sami. */
  const cisza = net.createServer(() => { /* trzymaj połączenie, nic nie mów */ });
  await new Promise((r) => cisza.listen(7123, r));
  const b = await zapytaj(3472, 'http://127.0.0.1:7123/v1');
  cisza.close();
  console.log(`2. brak komputera → HTTP ${b.status}: ${b.error.split('\n')[0]}`);
  if (b.status !== 502) fail.push(`brak komputera: HTTP ${b.status} zamiast 502`);
  if (!/nie odpowiada/.test(b.error)) fail.push('brak komputera nie mówi, że komputer nie odpowiada');
  if (/OLLAMA_HOST/.test(b.error)) fail.push('przy braku komputera podpowiedź o OLLAMA_HOST myli');
  if (/fetch failed/.test(a.error + b.error)) fail.push('surowe „fetch failed" nadal wycieka');

  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nLISTA MODELI LOKALNYCH OK');
  process.exit(fail.length ? 1 : 0);
})();

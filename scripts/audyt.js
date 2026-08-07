// Pełny audyt Cosmosa — statyczny. Każda kontrola mówi, co sprawdza i co znalazła.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const R = path.resolve(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const ist = (f) => fs.existsSync(path.join(R, f));
const problemy = [];
const uwagi = [];
let nr = 0;
const sekcja = (t) => console.log(`\n${String(++nr).padStart(2, '0')}. ${t}`);
const ok = (t) => console.log(`    ✓ ${t}`);
const zle = (t) => { console.log(`    ✗ ${t}`); problemy.push(t); };
const hmm = (t) => { console.log(`    · ${t}`); uwagi.push(t); };

const server = rd('server.js');
const app = rd('public/app.js');
const html = rd('public/index.html');
const css = rd('public/style.css');
const i18nSrc = rd('public/i18n.js');
const models = rd('public/models.js');
const readme = rd('README.md');
const start = rd('docs/START-TUTAJ.md');
const roadmap = rd('docs/ROADMAP.md');
const envEx = rd('.env.example');

// ---------------------------------------------------------------- 1 składnia
sekcja('Składnia');
try {
  execSync('node --check server.js && node --check public/app.js && node --check public/i18n.js '
    + '&& node --check public/models.js && node --check public/sw.js', { cwd: R });
  ok('pliki JavaScript parsują się bez błędu');
} catch { zle('błąd składni w JavaScripcie'); }
try {
  const py = fs.readdirSync(path.join(R, 'senses')).filter((f) => f.endsWith('.py'));
  for (const f of py) execSync(`python3 -c "import ast;ast.parse(open('senses/${f}',encoding='utf-8').read())"`, { cwd: R });
  ok(`pliki Pythona parsują się bez błędu (${py.length})`);
} catch (e) { zle('błąd składni w Pythonie: ' + e.message.split('\n')[0]); }
try {
  for (const f of fs.readdirSync(path.join(R, 'scripts'))) {
    if (f.endsWith('.sh')) execSync(`bash -n scripts/${f}`, { cwd: R });
  }
  ok('skrypty powłoki parsują się bez błędu');
} catch { zle('błąd składni w skrypcie powłoki'); }
const nawiasy = (css.match(/{/g) || []).length === (css.match(/}/g) || []).length;
nawiasy ? ok('nawiasy CSS się bilansują') : zle('rozjazd nawiasów w CSS');

// ---------------------------------------------------------------- 2 i18n
sekcja('Tłumaczenia');
const czesci = i18nSrc.split(/\n\s*en:\s*{/);
const klucze = (s) => [...new Set((s.match(/^\s*'[^']+':/gm) || []).map((x) => x.trim().slice(1, -2)))];
const pl = klucze(czesci[0]); const en = klucze(czesci[1] || '');
const tylkoPL = pl.filter((k) => !en.includes(k));
const tylkoEN = en.filter((k) => !pl.includes(k));
console.log(`    PL ${pl.length} · EN ${en.length}`);
(tylkoPL.length || tylkoEN.length)
  ? zle(`brak parytetu: tylko PL [${tylkoPL}] tylko EN [${tylkoEN}]`)
  : ok('parytet PL/EN pełny');
const wszystkie = new Set([...pl, ...en]);
const uzyteApp = [...new Set([...app.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]))];
const uzyteHtml = [...new Set([...html.matchAll(/data-i18n(?:-ph|-aria|-title)?="([^"]+)"/g)].map((m) => m[1]))];
// Klucz zakończony kropką to prefiks budowany z danych (`t('event.' + typ)`),
// a nie brakujące tłumaczenie. Kod ma dla nich zapasową etykietę.
const braki = [...uzyteApp, ...uzyteHtml].filter((k) => !wszystkie.has(k) && !k.endsWith('.'));
braki.length ? zle('klucze bez tłumaczenia: ' + braki.join(', ')) : ok(`wszystkie użyte klucze mają tłumaczenie (${uzyteApp.length} + ${uzyteHtml.length})`);
const nieuzyte = [...wszystkie].filter((k) => !uzyteApp.includes(k) && !uzyteHtml.includes(k)
  && !app.includes(`'${k}'`) && !app.includes(`\`${k}\``));
nieuzyte.length ? hmm(`klucze bez użycia (${nieuzyte.length}): ${nieuzyte.slice(0, 8).join(', ')}${nieuzyte.length > 8 ? '…' : ''}`)
  : ok('brak osieroconych tłumaczeń');

// ---------------------------------------------------------------- 3 DOM
sekcja('Zgodność kodu z HTML-em');
const maId = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const tworzone = new Set([
  ...[...app.matchAll(/\.id\s*=\s*[`'"]([^`'"]+)/g)].map((m) => m[1]),
  ...[...app.matchAll(/id="([a-z-]+-\$\{[^}]+\})"/g)].map((m) => m[1]),
]);
const dynamicznePrefiksy = [...tworzone].map((x) => x.replace(/\$\{[^}]+\}/, ''));
const uzyteId = [...new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))];
const brakId = uzyteId.filter((id) => !maId.has(id) && !tworzone.has(id)
  && !dynamicznePrefiksy.some((p) => id.startsWith(p)));
brakId.length ? zle('$(id) bez odpowiednika w HTML: ' + brakId.join(', '))
  : ok(`wszystkie ${uzyteId.length} identyfikatorów istnieją (${tworzone.size} tworzonych w locie)`);
const idList = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const dubl = [...new Set(idList.filter((v, i) => idList.indexOf(v) !== i))];
dubl.length ? zle('powtórzone id w HTML: ' + dubl.join(', ')) : ok('brak powtórzonych identyfikatorów');
const otw = (html.match(/<(div|section|aside|main|form|select|button|label|pre|table)\b/g) || []).length;
const zam = (html.match(/<\/(div|section|aside|main|form|select|button|label|pre|table)>/g) || []).length;
otw === zam ? ok(`znaczniki się domykają (${otw})`) : zle(`rozjazd znaczników: ${otw} otwarć, ${zam} zamknięć`);

// ---------------------------------------------------------------- 4 API
sekcja('Trasy serwera');
const trasy = [...new Set([...server.matchAll(/p === '([^']+)'/g)].map((m) => m[1]))];
const prefiksy = [...new Set([...server.matchAll(/p\.startsWith\('([^']+)'\)/g)].map((m) => m[1]))];
const wolane = [...new Set([...(app + html).matchAll(/['"`](\/api\/[a-zA-Z0-9\/_-]+)/g)].map((m) => m[1]))];
const sieroty = wolane.filter((c) => !trasy.includes(c) && !prefiksy.some((p) => c.startsWith(p))
  && !trasy.some((r) => c.startsWith(r + '/')));
sieroty.length ? zle('klient woła nieistniejące trasy: ' + sieroty.join(', '))
  : ok(`${wolane.length} wywołań klienta ma pokrycie w ${trasy.length} trasach`);
const dokTrasy = readme + start;
const nieudok = trasy.filter((r) => r.startsWith('/api/') && !dokTrasy.includes(r));
nieudok.length ? zle('trasy nieopisane w dokumentacji: ' + nieudok.join(', ')) : ok('każda trasa /api/ jest opisana');

// ---------------------------------------------------------------- 5 .env
sekcja('Zmienne środowiskowe');
/* Po podziale na moduły większość `process.env` przeniosła się do lib/ —
   skanowanie samego server.js kazało audytowi uznać 24 poprawne zmienne za
   martwe. Czytamy CAŁY kod serwerowy. */
const kod = server + rd('senses/service.py')
  + fs.readdirSync(path.join(R, 'lib')).filter((f) => f.endsWith('.js')).map((f) => rd(`lib/${f}`)).join('\n')
  + fs.readdirSync(path.join(R, 'scripts')).filter((f) => f.endsWith('.js')).map((f) => rd(`scripts/${f}`)).join('\n');
const uzyteEnv = [...new Set([
  ...[...kod.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]),
  ...[...kod.matchAll(/os\.environ\.get\("([A-Z0-9_]+)"/g)].map((m) => m[1]),
])].sort();
const wPrzykladzie = new Set([...envEx.matchAll(/^#?\s*([A-Z0-9_]+)=/gm)].map((m) => m[1]));
// Zmysły chodzą na innej maszynie niż serwer i mają własną konfigurację —
// ich zmienne opisuje senses/README.md, nie .env.example serwera.
const dokZmyslow = rd('senses/README.md');
const brakEnv = uzyteEnv.filter((v) => !wPrzykladzie.has(v) && !dokZmyslow.includes(v));
const tylkoZmysly = uzyteEnv.filter((v) => !wPrzykladzie.has(v) && dokZmyslow.includes(v));
brakEnv.length ? zle('nigdzie nieopisane: ' + brakEnv.join(', '))
  : ok(`${uzyteEnv.length} zmiennych, wszystkie opisane (${tylkoZmysly.length} w senses/README.md)`);
const zbedne = [...wPrzykladzie].filter((v) => !uzyteEnv.includes(v) && !kod.includes(v));
zbedne.length ? hmm('w .env.example, nieużywane wprost: ' + zbedne.join(', ')) : ok('brak martwych wpisów w .env.example');

// ---------------------------------------------------------------- 6 dokumentacja
sekcja('Dokumentacja — odwołania do plików');
const doki = { 'README.md': readme, 'docs/START-TUTAJ.md': start, 'docs/ROADMAP.md': roadmap };
const zleSciezki = [];
for (const [f, tekst] of Object.entries(doki)) {
  for (const m of tekst.matchAll(/\b((?:senses|docs|public|scripts|automation|training|mcp)\/[A-Za-z0-9_.\/-]+\.[a-z]{2,4})/g)) {
    // „public/caddy/stable/gpg.key" to kawałek adresu https://dl.cloudsmith.io/…,
    // nie ścieżka w repozytorium — patrzymy, co stoi tuż przed dopasowaniem.
    const przed = tekst.slice(Math.max(0, m.index - 40), m.index);
    if (/https?:\/\/\S*$/.test(przed)) continue;
    if (!ist(m[1])) zleSciezki.push(`${f} → ${m[1]}`);
  }
}
zleSciezki.length ? zle('odwołania do nieistniejących plików:\n       ' + [...new Set(zleSciezki)].join('\n       '))
  : ok('każdy wymieniony plik istnieje');
const zleLinki = [];
for (const [f, tekst] of Object.entries(doki)) {
  for (const m of tekst.matchAll(/\]\((?!https?:|#|mailto:)([^)]+)\)/g)) {
    // `[nazwa](adres)` w cudzysłowach odwrotnych to przykład składni, nie link.
    const wiersz = tekst.slice(tekst.lastIndexOf('\n', m.index) + 1,
      tekst.indexOf('\n', m.index) === -1 ? tekst.length : tekst.indexOf('\n', m.index));
    const doMiejsca = wiersz.slice(0, m.index - (tekst.lastIndexOf('\n', m.index) + 1));
    if ((doMiejsca.match(/`/g) || []).length % 2 === 1) continue;
    const p = path.resolve(path.dirname(path.join(R, f)), m[1].split('#')[0]);
    if (!fs.existsSync(p)) zleLinki.push(`${f} → ${m[1]}`);
  }
}
zleLinki.length ? zle('martwe linki: ' + zleLinki.join(', ')) : ok('linki wewnętrzne prowadzą do istniejących plików');

// ---------------------------------------------------------------- 7 komendy
sekcja('Komendy z dokumentacji');
const zleFlagi = [];
for (const [f, tekst] of Object.entries(doki)) {
  for (const m of tekst.matchAll(/python3?\s+(senses\/[a-z_]+\.py)((?:\s+[a-z-]+)*(?:\s+--?[a-z-]+(?:\s+[^\s\\`\n]+)?)*)/g)) {
    if (!ist(m[1])) { zleFlagi.push(`${f}: brak ${m[1]}`); continue; }
    const src = rd(m[1]);
    for (const fl of (m[2].match(/--[a-z-]+/g) || [])) {
      if (!src.includes(fl.replace(/^--/, ''))) zleFlagi.push(`${f}: ${m[1]} nie zna ${fl}`);
    }
  }
}
zleFlagi.length ? zle('nierozpoznane przełączniki: ' + [...new Set(zleFlagi)].join('; ')) : ok('przełączniki w komendach są rozpoznawane');
for (const [f, tekst] of Object.entries(doki)) {
  for (const m of tekst.matchAll(/\.\/(scripts\/[a-z-]+\.sh)/g)) {
    if (!ist(m[1])) zle(`${f} odsyła do nieistniejącego ${m[1]}`);
    else if (!(fs.statSync(path.join(R, m[1])).mode & 0o111)) zle(`${m[1]} nie jest wykonywalny, a dokumentacja każe go uruchamiać`);
  }
}
ok('skrypty z dokumentacji istnieją i są wykonywalne');

// ---------------------------------------------------------------- 8 SW
sekcja('Service worker i PWA');
const sw = rd('public/sw.js');
const wersja = (sw.match(/cosmos-v(\d+)/) || [])[1];
const zasoby = [...sw.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]).filter((a) => a !== '/' && !a.startsWith('/api'));
const brakZas = zasoby.filter((a) => !ist('public' + a));
console.log(`    cache: cosmos-v${wersja}, zasobów: ${zasoby.length}`);
brakZas.length ? zle('zasoby w cache bez pliku: ' + brakZas.join(', ')) : ok('wszystkie zasoby z cache istnieją');
const manifest = JSON.parse(rd('public/manifest.webmanifest'));
const ikony = (manifest.icons || []).map((i) => i.src).filter((s) => !s.startsWith('data:'));
const brakIkon = ikony.filter((i) => !ist('public/' + i.replace(/^\//, '')));
brakIkon.length ? zle('manifest wskazuje brakujące ikony: ' + brakIkon.join(', ')) : ok('ikony z manifestu istnieją');
const skryptyHtml = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const style = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
const brakZasob = [...skryptyHtml, ...style].filter((s) => !s.startsWith('http')
  && !ist('public/' + s.replace(/^\//, '').split('?')[0]));
brakZasob.length ? zle('HTML ładuje nieistniejące pliki: ' + brakZasob.join(', ')) : ok('HTML ładuje wyłącznie istniejące pliki');
// HTML odwołuje się względnie („app.js"), service worker bezwzględnie („/app.js").
const norm = (p) => '/' + p.replace(/^\//, '').split('?')[0];
const nieWCache = [...skryptyHtml, ...style].filter((s) => !s.startsWith('http')
  && !zasoby.map(norm).includes(norm(s)));
nieWCache.length ? hmm('poza cache offline: ' + nieWCache.join(', ')) : ok('wszystko, co ładuje HTML, jest w cache offline');

// ---------------------------------------------------------------- 9 bezpieczeństwo
sekcja('Bezpieczeństwo i prywatność');
try { execSync('git check-ignore -q .env', { cwd: R }); ok('.env poza repozytorium'); }
catch { zle('.env NIE jest ignorowany'); }
try { execSync('git check-ignore -q data', { cwd: R }); ok('data/ poza repozytorium'); }
catch { zle('data/ NIE jest ignorowane'); }
const sledzone = execSync('git ls-files', { cwd: R }).toString().split('\n');
const wrazliwe = sledzone.filter((f) => /^\.env$|^data\//.test(f));
wrazliwe.length ? zle('wrażliwe pliki w repo: ' + wrazliwe.join(', ')) : ok('brak wrażliwych plików w historii');
const cfg = server.slice(server.indexOf('function handleConfig'), server.indexOf('function handleConfig') + 2500);
/apiKey\s*:\s*(ep\.apiKey|process\.env)/.test(cfg) ? zle('/api/config oddaje klucz API') : ok('/api/config oddaje tylko hasApiKey');
const scrubUzyte = (server.match(/scrubSecrets\(/g) || []).length;
scrubUzyte >= 4 ? ok(`redakcja danych konta w ${scrubUzyte - 1} miejscach`) : zle('redakcja danych konta niekompletna');
/p\.startsWith\('\/api\/'\) && !isAuthed/.test(server) ? ok('każda trasa /api/ za logowaniem, gdy hasło ustawione')
  : zle('brak globalnej bramki logowania na /api/');
// Liczenie wystąpień kłamie — limit bywa w obiekcie opcji kilka linii wyżej.
// Patrzymy w okno wokół każdego wywołania.
const linie = server.split('\n');
const bezLimitu = [];
linie.forEach((l, i) => {
  if (!/\bfetch\(/.test(l) || /^\s*(\/\/|\*)/.test(l)) return;
  const okno = linie.slice(Math.max(0, i - 8), i + 9).join('\n');
  if (!/signal\s*:/.test(okno)) bezLimitu.push(`linia ${i + 1}`);
});
const ileFetch = linie.filter((l) => /\bfetch\(/.test(l) && !/^\s*(\/\/|\*)/.test(l)).length;
bezLimitu.length ? hmm(`żądania bez limitu czasu: ${bezLimitu.join(', ')}`)
  : ok(`wszystkie ${ileFetch} żądań wychodzących ma limit czasu`);

// ---------------------------------------------------------------- 10 katalog modeli
sekcja('Katalog modeli a rzeczywistość');
const { modelInfo, modelSeesImages, modelNotForChat } = require(path.join(R, 'public/models.js'));
const POMIAR_WZROK = ['nvidia/llama-3.1-nemotron-nano-vl-8b-v1', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'nvidia/nemotron-nano-12b-v2-vl', 'deepseek-ai/deepseek-v4-pro', 'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-90b-vision-instruct', 'nvidia/ising-calibration-1.5-31b', 'openai/gpt-oss-20b',
  'thinkingmachines/inkling'];
const POMIAR_TEKST = ['nvidia/nemotron-3-nano-30b-a3b', 'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-mini-4b-instruct', 'nvidia/nvidia-nemotron-nano-9b-v2',
  'meta/llama-3.1-8b-instruct', 'meta/llama-3.2-1b-instruct', 'minimaxai/minimax-m3',
  'nvidia/llama-3.1-nemoguard-8b-content-safety', 'nvidia/llama-3.1-nemoguard-8b-topic-control',
  'nvidia/llama-3.1-nemotron-safety-guard-8b-v3', 'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/llama-3.3-nemotron-super-49b-v1.5', 'nvidia/nemotron-3.5-content-safety',
  'nvidia/riva-translate-4b-instruct-v1.1', 'nvidia/riva-translate-4b-instruct-v2', 'openai/gpt-oss-120b'];
const POMIAR_INNE = ['nvidia/llama-nemotron-embed-1b-v2', 'nvidia/nv-embedqa-e5-v5', 'nvidia/nvclip',
  'nvidia/nemotron-parse', 'nvidia/nemoretriever-parse', 'nvidia/nemotron-4-340b-reward'];
let bezOpisu = 0; let rozjazd = 0;
for (const m of [...POMIAR_WZROK, ...POMIAR_TEKST]) {
  const i = modelInfo(m);
  if (!i || i.zgadywane) { bezOpisu++; hmm(`bez wpisu w katalogu: ${m}`); }
  if (modelSeesImages(m) !== POMIAR_WZROK.includes(m)) { rozjazd++; zle(`rozjazd wzroku: ${m}`); }
}
bezOpisu === 0 ? ok(`wszystkie ${POMIAR_WZROK.length + POMIAR_TEKST.length} działających modeli ma opis`) : null;
rozjazd === 0 ? ok('cecha „widzi obrazy" zgadza się z pomiarem co do modelu') : null;
const zleInne = POMIAR_INNE.filter((m) => !modelNotForChat(m));
zleInne.length ? zle('nierozpoznane jako „inne przeznaczenie": ' + zleInne.join(', '))
  : ok(`${POMIAR_INNE.length} modeli nie-do-rozmowy rozpoznanych po nazwie`);
const falszywe = [...POMIAR_WZROK, ...POMIAR_TEKST].filter((m) => modelNotForChat(m));
falszywe.length ? zle('działający model wzięty za nie-do-rozmowy: ' + falszywe.join(', '))
  : ok('żaden działający model nie wpadł omyłkowo do „innego przeznaczenia"');

// ---------------------------------------------------------------- 11 spójność wersji
sekcja('Spójność wersji i konfiguracji');
const pkg = JSON.parse(rd('package.json'));
console.log(`    package.json: ${pkg.name} ${pkg.version}, zależności: ${Object.keys(pkg.dependencies || {}).length}`);
Object.keys(pkg.dependencies || {}).length === 0 ? ok('zero zależności produkcyjnych — tak jak zakładaliśmy')
  : hmm('pojawiły się zależności: ' + Object.keys(pkg.dependencies).join(', '));
const wersjeWDok = [...new Set([...(readme + start).matchAll(/cosmos-v(\d+)/g)].map((m) => m[1]))];
wersjeWDok.length && !wersjeWDok.includes(wersja)
  ? hmm(`dokumentacja wspomina cosmos-v${wersjeWDok.join('/')}, w kodzie v${wersja}`)
  : ok('numer cache nie jest zapisany na sztywno w dokumentacji');
const domyslnyModel = (envEx.match(/^NEMOTRON_MODEL=(.+)$/m) || [])[1];
const domyslnyWzrok = (envEx.match(/^NEMOTRON_VISION_MODEL=(.+)$/m) || [])[1];
console.log(`    .env.example → model: ${domyslnyModel}`);
console.log(`    .env.example → wizyjny: ${domyslnyWzrok || '(pusty)'}`);
POMIAR_TEKST.includes(domyslnyModel) ? ok('domyślny model rozmowy jest wśród potwierdzonych')
  : zle(`domyślny model ${domyslnyModel} nie jest wśród potwierdzonych`);
POMIAR_WZROK.includes(domyslnyWzrok) ? ok('domyślny model wizyjny jest wśród potwierdzonych')
  : zle(`domyślny model wizyjny „${domyslnyWzrok}" nie jest wśród potwierdzonych`);

// ------------------------------------------------------------- 11b moduły
sekcja('Podział na moduły');
const moduly = fs.readdirSync(path.join(R, 'lib')).filter((f) => f.endsWith('.js'));
const liniiSerwer = server.split('\n').length;
let liniiLib = 0;
for (const m of moduly) liniiLib += rd(`lib/${m}`).split('\n').length;
console.log(`    server.js ${liniiSerwer} linii + ${moduly.length} modułów (${liniiLib} linii)`);
liniiSerwer < 2600 ? ok('serwer zszedł poniżej 2600 linii')
  : hmm(`server.js ma ${liniiSerwer} linii — czas na kolejny podział`);
// Żaden identyfikator z modułu nie może być używany bez importu — inaczej
// serwer wywala się dopiero przy starcie, a nie przy sprawdzeniu.
const glowa = server.slice(0, server.indexOf('// ----', 2500));
/* Z treści usuwamy NAPISY i komentarze, zanim poszukamy w niej symboli.
   Bez tego sprawdzenie zgłaszało nieistniejące usterki: `poraDnia` widziało
   w treści promptu opisującego parametry narzędzia, a `TEMATY` — w polskim
   zdaniu „OSTATNIE TEMATY ROZMÓW". Fałszywy alarm w narzędziu do wykrywania
   usterek kosztuje tyle samo czasu co prawdziwy, a uczy go ignorować. */
const bezNapisow = (kod) => kod
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  .replace(/'(?:\\.|[^'\\])*'/g, "''")
  .replace(/"(?:\\.|[^"\\])*"/g, '""')
  .replace(/`(?:\\.|[^`\\])*`/g, '``');
const ogon = bezNapisow(server.slice(glowa.length));
const bezImportu = [];
for (const m of moduly) {
  let mod; try { mod = require(path.join(R, 'lib', m)); } catch (e) { zle(`lib/${m} nie daje się wczytać: ${e.message}`); continue; }
  for (const k of Object.keys(mod)) {
    if (k === 'polacz') continue;
    if (new RegExp(`\\b${k}\\b`).test(ogon) && !new RegExp(`\\b${k}\\b`).test(glowa)) bezImportu.push(`${m}:${k}`);
  }
}
bezImportu.length ? zle('używane bez importu: ' + bezImportu.join(', '))
  : ok('każdy symbol z modułów jest zaimportowany');
// Tablice podmieniane w module nie mogą wychodzić jako tablice — serwer
// dostałby kopię wiązania i po pierwszym usunięciu widziałby stary stan.
const pulapki = [];
for (const m of moduly) {
  const src = rd(`lib/${m}`);
  const eks = (src.match(/module\.exports = \{([\s\S]*?)\}/) || ['', ''])[1];
  for (const mm of src.matchAll(/^\s*([a-zA-Z_$][\w$]*) = \1\.filter\(/gm)) {
    // Liczy się TYLKO skrócona własność (`lessons,`), a nie wystąpienie
    // wewnątrz funkcji odczytującej (`wzorce: () => lessons`) — ta druga
    // postać jest właśnie poprawką, nie pułapką.
    if (new RegExp(`(^|[{,])\\s*${mm[1]}\\s*[,}]`).test(eks)) pulapki.push(`${m}:${mm[1]}`);
  }
}
pulapki.length ? zle('podmieniane tablice wystawione wprost (kopia wiązania): ' + pulapki.join(', '))
  : ok('podmieniane kolekcje wychodzą jako funkcje, nie tablice');

// ------------------------------------------------------- 12b rozruch próbny
sekcja('Rozruch próbny');
/* Statyczna analiza nie wyłapie odwołania do symbolu, który po podziale na
   moduły przestał istnieć — próbowałem regexem i przepuścił `events.length`.
   Jedyna pewna metoda to uruchomić serwer i zapukać we wszystkie trasy.
   Trwa kilka sekund i wyklucza całą tę klasę błędów. */
const { execFileSync, spawn: spawnProc } = require('child_process');
const os = require('os');
const net = require('node:net');
const PORT_PROBY = 3499;

/** Czy ktoś już siedzi na tym porcie? */
function portZajety(port) {
  return new Promise((gotowe) => {
    const s = net.connect({ host: '127.0.0.1', port });
    const koniec = (odp) => { s.destroy(); gotowe(odp); };
    s.once('connect', () => koniec(true));
    s.once('error', () => koniec(false));
    setTimeout(() => koniec(false), 700);
  });
}

const tmpDane = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-audyt-'));

(async () => {
  /* Zanim cokolwiek uruchomimy: port MUSI być wolny.
     To nie jest ostrożność na wyrost, tylko poprawka po realnej wpadce. Audyt
     zostawiał po sobie serwer (samo `kill(-pid)` czasem nie wystarczało), więc
     przy następnym uruchomieniu nowy proces padał na EADDRINUSE — a audyt
     i tak meldował „✓ serwer wstaje", bo pukał w STARY serwer z poprzedniego
     przebiegu. Czyli sprawdzał nie ten kod, co trzeba, i o niczym nie mówił.
     Narzędzie do wykrywania usterek, które samo może po cichu skłamać, jest
     gorsze niż jego brak. */
  if (await portZajety(PORT_PROBY)) {
    zle(`port ${PORT_PROBY} jest zajęty — rozruch próbny pukałby w cudzy serwer. `
      + `Zamknij go (np. pkill -f "node server.js") i powtórz audyt.`);
    podsumuj();
    return;
  }

  const proba = spawnProc('node', ['server.js'], {
    cwd: R, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: { ...process.env, PORT: String(PORT_PROBY), COSMOS_DATA_DIR: tmpDane, NVIDIA_API_KEY: 'test' },
  });
  let logRozruchu = '';
  proba.stdout.on('data', (d) => { logRozruchu += d; });
  proba.stderr.on('data', (d) => { logRozruchu += d; });

  /** Ubij serwer NA PEWNO — grupę i sam proces, aż port zwolniony. */
  async function ubijProbny() {
    for (const sygnal of ['SIGTERM', 'SIGKILL']) {
      try { process.kill(-proba.pid, sygnal); } catch { /* grupa już nie żyje */ }
      try { process.kill(proba.pid, sygnal); } catch { /* proces już nie żyje */ }
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (!(await portZajety(PORT_PROBY))) return true;
      }
    }
    return !(await portZajety(PORT_PROBY));
  }

  const adres = `http://127.0.0.1:${PORT_PROBY}`;
  let wstal = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { await fetch(adres, { signal: AbortSignal.timeout(1000) }); wstal = true; break; } catch { /* wstaje */ }
  }
  if (!wstal) {
    zle('serwer nie wstał: ' + logRozruchu.trim().split('\n').slice(-3).join(' | '));
  } else {
    ok('serwer wstaje');
    // GET-y bez skutków ubocznych — pukamy we wszystko, co się da
    const doSprawdzenia = trasy.filter((t) => t.startsWith('/api/')
      && !/login|logout|chat|polish|stream|studio|record|train|run/.test(t));
    const padly = [];
    const niedostepne = [];
    /* Trasy, które bez parametru kończą się na walidacji i nigdy nie dochodzą
       do właściwego kodu. Bez tego `/api/search` przechodził audyt, mając
       w środku `addEvent is not defined`. */
    const PARAMETRY = {
      '/api/search': '?q=pogoda',
      '/api/models': '?endpoint=cloud',
      '/api/conversations/search': '?q=test',
      '/api/kinect/frame': '?stream=color',
    };
    for (const t of doSprawdzenia) {
      try {
        const r = await fetch(adres + t + (PARAMETRY[t] || ''), { signal: AbortSignal.timeout(12000) });
        // 502 znaczy „usługa poniżej nie odpowiada" — w środowisku audytu nie
        // ma ani modelu, ani zmysłów, więc to poprawna odpowiedź, nie usterka.
        // 500 to już nasza wywrotka i takich szukamy (tak wyszło `rutyny is
        // not defined` po podziale na moduły).
        if (r.status === 500) padly.push(`${t} → 500`);
        else if (r.status === 502) niedostepne.push(t.replace('/api/', ''));
        else if (r.status === 200) {
          /* Błąd w kodzie potrafi wyjść jako HTTP 200 z komunikatem w treści —
             tak przeszedł `addEvent is not defined` w wyszukiwaniu, opisany
             na dodatek jako „sprawdź połączenie z internetem". */
          const tresc = (await r.text()).slice(0, 2000);
          if (/is not defined|is not a function|Cannot read propert|undefined is not/.test(tresc)) {
            padly.push(`${t} → 200, ale w treści błąd kodu: `
              + (tresc.match(/[A-Za-z_$][\w$]* is not (?:defined|a function)/) || ['?'])[0]);
          }
        }
      } catch (e) { padly.push(`${t} → ${e.message}`); }
    }
    padly.length ? zle('trasy wywracają się (HTTP 500): ' + padly.join(', '))
      : ok(`${doSprawdzenia.length} tras bez wywrotki`
        + (niedostepne.length ? ` (${niedostepne.join(', ')} → 502: brak usługi, spodziewane)` : ''));
    // strumień zdarzeń osobno — nie kończy się sam
    try {
      const r = await fetch(adres + '/api/events/stream', { signal: AbortSignal.timeout(3000) });
      r.status === 200 && /event-stream/.test(r.headers.get('content-type') || '')
        ? ok('strumień zdarzeń odpowiada') : zle(`strumień zdarzeń: HTTP ${r.status}`);
      r.body.cancel().catch(() => {});
    } catch (e) { zle('strumień zdarzeń: ' + e.message); }
    if (/Error|error:/i.test(logRozruchu)) {
      hmm('w logu rozruchu jest słowo „error": '
        + (logRozruchu.match(/^.*(?:Error|error:).*$/mi) || [''])[0].trim().slice(0, 120));
    }
  }
  // Sprzątanie musi się UDAĆ, inaczej następny audyt bada nie ten serwer.
  if (!(await ubijProbny())) {
    zle(`nie udało się zamknąć serwera próbnego na porcie ${PORT_PROBY} — `
      + 'następny audyt sprawdziłby jego, a nie świeży kod');
  }
  fs.rmSync(tmpDane, { recursive: true, force: true });
  podsumuj();
})();

function podsumuj() {
// ---------------------------------------------------------------- 12 pozostałości
sekcja('Pozostałości i higiena');
const smieci = [];
for (const [f, t] of Object.entries({ 'server.js': server, 'public/app.js': app, 'public/models.js': models })) {
  for (const m of t.matchAll(/\b(TODO|FIXME|XXX|HACK)\b/g)) smieci.push(`${f}: ${m[1]}`);
}
smieci.length ? hmm('znaczniki do dokończenia: ' + smieci.join(', ')) : ok('brak TODO/FIXME w kodzie produkcyjnym');
const debugi = (app.match(/console\.log\(/g) || []).length;
debugi ? hmm(`console.log w app.js: ${debugi}`) : ok('brak wydruków diagnostycznych w kliencie');
const nieczyste = execSync('git status --porcelain', { cwd: R }).toString().trim();
nieczyste ? hmm('niezacommitowane zmiany:\n       ' + nieczyste.split('\n').join('\n       ')
) : ok('drzewo robocze czyste');

// ---------------------------------------------------------------- podsumowanie
console.log('\n' + '='.repeat(66));
console.log(`WYNIK: ${problemy.length} problemów, ${uwagi.length} uwag`);
if (problemy.length) { console.log('\nPROBLEMY:'); problemy.forEach((p) => console.log('  ✗ ' + p)); }
if (uwagi.length) { console.log('\nUWAGI (do świadomej decyzji, nie usterki):'); uwagi.forEach((u) => console.log('  · ' + u)); }
process.exit(problemy.length ? 1 : 0);
}

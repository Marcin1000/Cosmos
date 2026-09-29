/* Instalator ptaków na serwerze (scripts/instaluj-ptaki.sh) – bez sieci, bez
   systemd, w kilka sekund.

   Zespół IT (runda 9): .env zapisany bez końcowej nowej linii (VS Code, Notatnik,
   WinSCP) sklejał się z dopisywanym PTAKI_URL – „COSMOS_COOKIE_SECURE=1PTAKI_URL=…”.
   Ciasteczka traciły Secure, Cosmos nie widział ptaków, a skrypt pisał „Gotowe”.
   Przy aktualizacji rozgrzewka stawiała drugi BirdNET obok działającego (OOM na
   małym VPS-ie), a apt-get bez update dawał 404 na starych listach.

     1. krok 5 (dopisz_ptaki_url) na .env bez końcowego „\n”: ostatni klucz
        nietknięty, PTAKI_URL czytany przez prawdziwy loadDotEnv,
     2. drugie uruchomienie nie dubluje linii; .env z „\n” nie dostaje pustej linii,
     3. inne PTAKI_URL zostaje, brak .env → podpowiedź, bez tworzenia pliku,
     4. `TYLKO_FUNKCJE=1 source` niczego nie instaluje,
     5. aktualizacja (usługa działa): `systemctl stop` PRZED pakietami,
        `apt-get update` przed `apt-get install` – na atrapach systemctl/apt-get
        w PATH (tylko jako root; bez roota punkt pominięty). */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const KORZEN = path.join(__dirname, '..', '..');
const SKRYPT = path.join(KORZEN, 'scripts', 'instaluj-ptaki.sh');
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-instalator-'));
const dopisz = (plik, port = '7061') => spawnSync('bash', ['-c', `TYLKO_FUNKCJE=1 source "${SKRYPT}" && dopisz_ptaki_url "$1" "$2"`, '_', plik, port],
  { encoding: 'utf8', timeout: 10000 });
/** Co zobaczy Cosmos: prawdziwy loadDotEnv z lib/rdzen.js w osobnym procesie. */
const czytaj = (plik, klucze) => JSON.parse(spawnSync(process.execPath, ['-e', `
  const r = require(${JSON.stringify(path.join(KORZEN, 'lib', 'rdzen.js'))});
  const k = ${JSON.stringify(klucze)};
  for (const x of k) delete process.env[x];
  r.loadDotEnv(${JSON.stringify(plik)});
  console.log(JSON.stringify(Object.fromEntries(k.map((x) => [x, process.env[x]]))));
`], { encoding: 'utf8', timeout: 10000 }).stdout.trim().split('\n').pop());

try {
  /* ---- 1. bez końcowej nowej linii ---- */
  const env1 = path.join(tmp, 'env1');
  fs.writeFileSync(env1, 'ZESTAW_KLUCZ=x\nZESTAW_COOKIE_SECURE=1');
  const w1 = dopisz(env1);
  const k1 = czytaj(env1, ['ZESTAW_KLUCZ', 'ZESTAW_COOKIE_SECURE', 'PTAKI_URL']);
  ok(w1.status === 0 && /Dopisano/.test(w1.stdout), `1. krok 5 kończy się dobrze (${w1.status}) ${w1.stderr.trim()}`);
  ok(k1.ZESTAW_COOKIE_SECURE === '1', `1. ostatni klucz .env nietknięty (${JSON.stringify(k1.ZESTAW_COOKIE_SECURE)})`);
  ok(k1.PTAKI_URL === 'http://127.0.0.1:7061', `1. Cosmos widzi PTAKI_URL (${JSON.stringify(k1.PTAKI_URL)})`);

  /* ---- 2. bez dubla, bez pustej linii ---- */
  dopisz(env1);
  const linie = fs.readFileSync(env1, 'utf8').split('\n');
  ok(linie.filter((l) => l.startsWith('PTAKI_URL=')).length === 1, '2. drugie uruchomienie nie dubluje PTAKI_URL');
  const env2 = path.join(tmp, 'env2');
  fs.writeFileSync(env2, 'A=1\n');
  dopisz(env2);
  ok(fs.readFileSync(env2, 'utf8') === 'A=1\nPTAKI_URL=http://127.0.0.1:7061\n', `2. .env z „\\n” bez pustej linii (${JSON.stringify(fs.readFileSync(env2, 'utf8'))})`);
  const env3 = path.join(tmp, 'env3');
  fs.writeFileSync(env3, '');
  dopisz(env3);
  ok(fs.readFileSync(env3, 'utf8') === 'PTAKI_URL=http://127.0.0.1:7061\n', '2. pusty .env dostaje samą linię');

  /* ---- 3. inne PTAKI_URL, brak .env ---- */
  const env4 = path.join(tmp, 'env4');
  fs.writeFileSync(env4, 'PTAKI_URL=http://127.0.0.1:9999\n');
  const w4 = dopisz(env4);
  ok(fs.readFileSync(env4, 'utf8') === 'PTAKI_URL=http://127.0.0.1:9999\n' && /inne PTAKI_URL/.test(w4.stdout), '3. inne PTAKI_URL zostaje, z uwagą');
  const brak = path.join(tmp, 'nie-ma');
  const w5 = dopisz(brak);
  ok(!fs.existsSync(brak) && /dopisz ręcznie/.test(w5.stdout), '3. brak .env → podpowiedź, pliku nie tworzy');

  /* ---- 4. samo źródło niczego nie instaluje ---- */
  const w6 = spawnSync('bash', ['-c', `TYLKO_FUNKCJE=1 source "${SKRYPT}"; echo KONIEC`], { encoding: 'utf8', timeout: 10000 });
  ok(w6.status === 0 && w6.stdout.trim() === 'KONIEC', `4. TYLKO_FUNKCJE=1 source: bez kroków instalacji (${JSON.stringify(w6.stdout.slice(0, 60))})`);

  /* ---- 5. aktualizacja: stop przed pakietami, apt-get update przed install ---- */
  if (process.getuid && process.getuid() === 0) {
    const bin = path.join(tmp, 'bin');
    const dziennik = path.join(tmp, 'wywolania.log');
    fs.mkdirSync(bin);
    const atrapa = (nazwa, kod = 0) => fs.writeFileSync(path.join(bin, nazwa),
      `#!/bin/sh\necho "${nazwa} $*" >> "${dziennik}"\nexit ${kod}\n`, { mode: 0o755 });
    atrapa('systemctl');          // is-active → 0: usługa działa, to aktualizacja
    atrapa('apt-get');
    atrapa('python-atrapa', 1);   // test wersji Pythona pada – dalej skrypt nie idzie
    const w7 = spawnSync('bash', [SKRYPT], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PREFIKS: path.join(tmp, 'prefiks'), PYTHON: 'python-atrapa', COSMOS: KORZEN, BEZ_SYSTEMD: '' },
    });
    const log = fs.existsSync(dziennik) ? fs.readFileSync(dziennik, 'utf8').split('\n').filter(Boolean) : [];
    const stop = log.findIndex((l) => l === 'systemctl stop cosmos-ptaki');
    const upd = log.findIndex((l) => /^apt-get update/.test(l));
    const inst = log.findIndex((l) => /^apt-get install/.test(l));
    ok(stop >= 0 && (inst < 0 || stop < inst), `5. aktualizacja: usługa zatrzymana przed pakietami (${log.join(' | ')})`);
    ok(upd >= 0 && inst > upd, '5. apt-get update przed apt-get install');
    ok(/BirdNET potrzebuje Pythona/.test(w7.stderr), '5. skrypt doszedł do sprawdzenia Pythona (atrapa)');
  } else {
    console.log('–   5. pominięte (bez roota)');
  }
} catch (e) {
  fail.push(`wyjątek: ${e.message}`);
  console.error(e);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nINSTALATOR PTAKÓW OK');
process.exit(fail.length ? 1 : 0);

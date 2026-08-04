#!/usr/bin/env node
/* ============================================================
   Bateria testów Cosmosa

     npm test                    — wszystko
     npm test -- szybkie         — tylko to, co nie potrzebuje przeglądarki
     npm test -- kinect zdjec    — zestawy, których nazwa zawiera te słowa
     npm test -- --lista         — co w ogóle jest do uruchomienia

   Każdy zestaw to osobny proces z własnym serwerem i własnym katalogiem
   danych. Wolniej niż jeden wspólny serwer, ale wynik znaczy to, co znaczy:
   „zestaw padł" oznacza usterkę w kodzie, a nie to, że akurat wstała nie ta
   atrapa co trzeba.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { maPrzegladarke, CHROMIUM } = require('./pomoc');

const ZESTAWY = path.join(__dirname, 'zestawy');
const LIMIT_MS = Number(process.env.COSMOS_TEST_TIMEOUT || 300000);

/* Zestawy sterujące przeglądarką są wolniejsze i wymagają Chromium.
   Rozpoznajemy je po treści, nie po nazwie — nazwa kłamie przy pierwszej
   zmianie. */
const potrzebujePrzegladarki = (plik) =>
  /przegladarka\(|require\('playwright'\)/.test(fs.readFileSync(plik, 'utf8'));

function zebrane() {
  return fs.readdirSync(ZESTAWY).filter((f) => f.endsWith('.js')).sort()
    .map((f) => ({
      nazwa: f.replace(/\.js$/, ''),
      sciezka: path.join(ZESTAWY, f),
      wolny: potrzebujePrzegladarki(path.join(ZESTAWY, f)),
    }));
}

function uruchomZestaw(z) {
  return new Promise((resolve) => {
    const start = Date.now();
    const p = spawn('node', [z.sciezka], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
    let wyjscie = '';
    p.stdout.on('data', (d) => { wyjscie += d; });
    p.stderr.on('data', (d) => { wyjscie += d; });
    const budzik = setTimeout(() => {
      wyjscie += `\n[przerwane po ${LIMIT_MS / 1000} s]`;
      try { p.kill('SIGKILL'); } catch { /* już nie żyje */ }
    }, LIMIT_MS);
    p.on('close', (kod) => {
      clearTimeout(budzik);
      resolve({ ...z, kod, wyjscie, czas: Date.now() - start });
    });
  });
}

// -------------------------------------------------------------- pythonowe
function selftestyPythona() {
  const wyniki = [];
  const senses = path.join(__dirname, '..', 'senses');
  for (const f of fs.readdirSync(senses).filter((x) => x.endsWith('.py'))) {
    const src = fs.readFileSync(path.join(senses, f), 'utf8');
    if (!/def cmd_selftest|['"]selftest['"]/.test(src)) continue;
    const nazwa = `senses/${f}`;
    try {
      const out = execSync(`python3 ${nazwa} selftest 2>&1`, { cwd: path.join(__dirname, '..'), timeout: 120000 }).toString();
      wyniki.push({ nazwa, kod: /przesz|passed|✓/i.test(out) ? 0 : 1, wyjscie: out.trim().split('\n').pop() });
    } catch (e) {
      wyniki.push({ nazwa, kod: 1, wyjscie: (e.stdout || e.message || '').toString().trim().split('\n').pop() });
    }
  }
  for (const f of ['piper_test.py', 'whisper_test.py']) {
    const p = path.join(__dirname, 'atrapy', f);
    if (!fs.existsSync(p)) continue;
    try {
      const out = execSync(`python3 ${p} 2>&1`, { cwd: path.join(__dirname, 'atrapy'), timeout: 120000 }).toString();
      wyniki.push({ nazwa: `atrapy/${f}`, kod: /OK$/m.test(out) ? 0 : 1, wyjscie: out.trim().split('\n').pop() });
    } catch (e) {
      wyniki.push({ nazwa: `atrapy/${f}`, kod: 1, wyjscie: (e.stdout || e.message || '').toString().trim().split('\n').pop() });
    }
  }
  return wyniki;
}

// -------------------------------------------------------------------- main
(async () => {
  const arg = process.argv.slice(2);
  let lista = zebrane();

  if (arg.includes('--lista')) {
    console.log(`Zestawów: ${lista.length}\n`);
    for (const z of lista) console.log(`  ${z.wolny ? '🌐' : '  '} ${z.nazwa}`);
    console.log('\n🌐 = wymaga przeglądarki (wolniejsze)');
    return;
  }

  const tylkoSzybkie = arg.includes('szybkie');
  const wzorce = arg.filter((a) => !a.startsWith('--') && a !== 'szybkie');
  if (tylkoSzybkie) lista = lista.filter((z) => !z.wolny);
  if (wzorce.length) lista = lista.filter((z) => wzorce.some((w) => z.nazwa.includes(w)));

  if (!maPrzegladarke() && lista.some((z) => z.wolny)) {
    console.log('⚠  Brak Chromium albo pakietu playwright — pomijam zestawy przeglądarkowe.');
    console.log('   Zainstaluj: npm install --save-dev playwright   (przeglądarka: ' + (CHROMIUM || 'nie znaleziono') + ')\n');
    lista = lista.filter((z) => !z.wolny);
  }

  console.log(`Uruchamiam ${lista.length} zestawów\n`);
  const wyniki = [];
  for (const z of lista) {
    process.stdout.write(`  ${z.wolny ? '🌐' : '  '} ${z.nazwa.padEnd(30)}`);
    const w = await uruchomZestaw(z);
    wyniki.push(w);
    const ostatnia = w.wyjscie.trim().split('\n').filter(Boolean).pop() || '';
    console.log(`${w.kod === 0 ? '✓' : '✗'}  ${(w.czas / 1000).toFixed(1)}s  ${ostatnia.slice(0, 46)}`);
  }

  let py = [];
  if (!wzorce.length) {
    console.log('\nSelftesty Pythona:');
    py = selftestyPythona();
    for (const w of py) console.log(`     ${w.nazwa.padEnd(30)}${w.kod === 0 ? '✓' : '✗'}  ${w.wyjscie.slice(0, 46)}`);
  }

  const padly = [...wyniki, ...py].filter((w) => w.kod !== 0);
  console.log('\n' + '='.repeat(70));
  console.log(`WYNIK: ${wyniki.length + py.length - padly.length} zdanych, ${padly.length} niezdanych`);
  for (const w of padly) {
    console.log(`\n──── ${w.nazwa} ────`);
    console.log(w.wyjscie.trim().split('\n').slice(-14).join('\n'));
  }
  process.exit(padly.length ? 1 : 0);
})();

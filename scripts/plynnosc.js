#!/usr/bin/env node
/* ============================================================
   Płynność modeli — który nadaje się do rozmowy, a który do czekania

   „Działa" i „da się z tego korzystać" to dwie różne rzeczy. Model, który
   odpowiada poprawnie, ale pierwszy znak pokazuje po ośmiu sekundach, jest
   w rozmowie nie do zniesienia — a tego nie widać w liście modeli.

   Mierzymy trzy liczby na model, każdą trzy razy (bierzemy MEDIANĘ, bo
   pojedynczy pomiar łapie zimny start i kłamie):

     • pierwszy znak  — ile trwa cisza, zanim cokolwiek się pojawi.
                        To decyduje o wrażeniu „odpowiada od razu".
     • tempo pisania  — znaków na sekundę po ruszeniu. Poniżej ~20 zn./s
                        czyta się wolniej, niż model pisze — i to widać.
     • całość         — do ostatniego znaku krótkiej odpowiedzi.

     ./scripts/plynnosc.js                    # wszystkie działające modele
     ./scripts/plynnosc.js cloud              # tylko chmura
     ./scripts/plynnosc.js local              # tylko lokalny
     ./scripts/plynnosc.js cloud nemotron     # tylko pasujące nazwą
     ./scripts/plynnosc.js cloud > wynik.txt  # do pliku

   Kosztuje tyle, co kilkanaście krótkich wiadomości.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const KORZEN = path.resolve(__dirname, '..');
const ADRES = process.env.COSMOS_URL || 'http://localhost:3000';
const POWTORZENIA = Number(process.env.PLYNNOSC_PROBY || 3);
const PYTANIE = 'Napisz jednym zdaniem, czym jest fotografia poklatkowa.';

let ciasteczko = '';

async function zaloguj() {
  let auth;
  try {
    auth = await (await fetch(`${ADRES}/api/auth`, { signal: AbortSignal.timeout(8000) })).json();
  } catch {
    console.error(`Nie mogę się połączyć z ${ADRES} — czy Cosmos działa?`);
    process.exit(1);
  }
  if (!auth.required) return;

  let haslo = '';
  const envFile = path.join(KORZEN, '.env');
  if (fs.existsSync(envFile) && fs.statSync(envFile).isFile()) {
    const m = fs.readFileSync(envFile, 'utf8').match(/^COSMOS_PASSWORD=(.*)$/m);
    if (m) haslo = m[1].trim();
  }
  if (!haslo) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    haslo = await new Promise((r) => rl.question('Hasło do Cosmosa: ', (a) => { rl.close(); r(a); }));
  }
  const r = await fetch(`${ADRES}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: haslo }),
  });
  if (!r.ok) { console.error('Logowanie odrzucone.'); process.exit(1); }
  ciasteczko = (r.headers.get('set-cookie') || '').split(';')[0];
}

const naglowki = () => ({ 'Content-Type': 'application/json', ...(ciasteczko ? { Cookie: ciasteczko } : {}) });

/** Jeden przebieg: ile do pierwszego znaku, ile znaków, ile trwało. */
async function jedenPomiar(endpoint, model) {
  const t0 = Date.now();
  let pierwszy = 0;
  let znaki = 0;
  let blad = '';
  try {
    const r = await fetch(`${ADRES}/api/chat`, {
      method: 'POST', headers: naglowki(),
      body: JSON.stringify({
        endpoint, model,
        messages: [{ role: 'user', content: PYTANIE }],
        // Mierzymy sam model, nie okoliczności: bez pamięci, bazy wiedzy,
        // manifestu i zmysłów. Inaczej porównywalibyśmy stan Cosmosa,
        // a nie modele między sobą.
        useCapabilities: false, useMemory: false, useSenses: false, useStudio: false,
        max_tokens: 160,
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      return { blad: (j.error || `HTTP ${r.status}`).slice(0, 90) };
    }
    const czytnik = r.body.getReader();
    const dek = new TextDecoder();
    for (;;) {
      const { value, done } = await czytnik.read();
      if (done) break;
      const kawalek = dek.decode(value, { stream: true });
      for (const linia of kawalek.split('\n')) {
        if (!linia.startsWith('data: ') || linia.includes('[DONE]')) continue;
        try {
          const d = JSON.parse(linia.slice(6)).choices?.[0]?.delta || {};
          const tekst = d.content || '';
          // Tok myślenia też liczy się jako „coś się dzieje" — użytkownik
          // widzi ruch na ekranie i to jest właśnie różnica między
          // „myśli" a „zawiesiło się".
          const widoczne = tekst || d.reasoning_content || d.reasoning || '';
          if (widoczne && !pierwszy) pierwszy = Date.now() - t0;
          znaki += tekst.length;
        } catch { /* niepełna ramka */ }
      }
    }
  } catch (e) {
    blad = /timeout|abort/i.test(e.message) ? 'przekroczony czas (120 s)' : e.message.slice(0, 90);
  }
  const calosc = Date.now() - t0;
  if (blad) return { blad };
  if (!znaki) return { blad: 'pusta odpowiedź' };
  return { pierwszy, calosc, znaki, tempo: Math.round(znaki / Math.max(0.1, (calosc - pierwszy) / 1000)) };
}

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function ocena(pierwszy, tempo) {
  if (pierwszy <= 1200 && tempo >= 30) return ['✦', 'znakomita — jak rozmowa'];
  if (pierwszy <= 2500 && tempo >= 18) return ['✓', 'dobra — nie przeszkadza'];
  if (pierwszy <= 5000) return ['~', 'znośna — czuć czekanie'];
  return ['✗', 'męcząca — do zadań w tle, nie do rozmowy'];
}

(async () => {
  const arg = process.argv.slice(2);
  const silniki = arg.filter((a) => a === 'cloud' || a === 'local');
  const wzorce = arg.filter((a) => a !== 'cloud' && a !== 'local');
  await zaloguj();

  const doZbadania = [];
  for (const ep of (silniki.length ? silniki : ['cloud', 'local'])) {
    let lista;
    try {
      const d = await (await fetch(`${ADRES}/api/models?endpoint=${ep}`, { headers: naglowki() })).json();
      lista = (d.data || []).map((m) => m.id).sort();
    } catch { continue; }
    if (!lista || !lista.length) continue;
    for (const m of lista) {
      if (wzorce.length && !wzorce.some((w) => m.includes(w))) continue;
      doZbadania.push([ep, m]);
    }
  }

  if (!doZbadania.length) {
    console.error('Nie znalazłem modeli do zbadania. Sprawdź, czy silnik odpowiada.');
    process.exit(1);
  }

  console.log(`Płynność — ${doZbadania.length} modeli, po ${POWTORZENIA} próby, mediana.`);
  console.log('Bez pamięci, bazy wiedzy i manifestu — mierzymy modele, nie okoliczności.\n');
  console.log('  pierwszy znak · tempo · całość   model');
  console.log('  ' + '─'.repeat(66));

  const wyniki = [];
  for (const [ep, model] of doZbadania) {
    if (process.stderr.isTTY) process.stderr.write(`  … ${model}\r`);
    const próby = [];
    let blad = '';
    for (let i = 0; i < POWTORZENIA; i++) {
      const w = await jedenPomiar(ep, model);
      if (w.blad) { blad = w.blad; break; }
      próby.push(w);
    }
    if (process.stderr.isTTY) process.stderr.write(' '.repeat(72) + '\r');
    if (blad) {
      console.log(`  ${'—'.padStart(13)} · ${'—'.padStart(5)} · ${'—'.padStart(6)}   ✗ ${model}`);
      console.log(`  ${' '.repeat(32)}${blad}`);
      wyniki.push({ ep, model, blad });
      continue;
    }
    const p = mediana(próby.map((x) => x.pierwszy));
    const tempo = mediana(próby.map((x) => x.tempo));
    const c = mediana(próby.map((x) => x.calosc));
    const [znak, opis] = ocena(p, tempo);
    console.log(`  ${(p / 1000).toFixed(1).padStart(9)} s · ${String(tempo).padStart(3)}/s · `
      + `${(c / 1000).toFixed(1).padStart(4)} s   ${znak} ${model}`);
    wyniki.push({ ep, model, pierwszy: p, tempo, calosc: c, znak, opis });
  }

  const dobre = wyniki.filter((w) => !w.blad).sort((a, b) => a.pierwszy - b.pierwszy);
  console.log('\n' + '─'.repeat(70));
  if (dobre.length) {
    console.log('Najlepsze do rozmowy (najkrótsza cisza przed pierwszym znakiem):');
    for (const w of dobre.slice(0, 5)) {
      console.log(`  ${w.znak} ${w.model}`);
      console.log(`      ${(w.pierwszy / 1000).toFixed(1)} s do pierwszego znaku, ${w.tempo} zn./s — ${w.opis}`);
    }
    const meczace = dobre.filter((w) => w.znak === '✗');
    if (meczace.length) {
      console.log(`\nDo zadań w tle, nie do rozmowy (${meczace.length}): `
        + meczace.map((w) => w.model.split('/').pop()).join(', '));
    }
  }
  const padly = wyniki.filter((w) => w.blad);
  if (padly.length) console.log(`\nNie odpowiedziały (${padly.length}): ` + padly.map((w) => w.model).join(', '));
  console.log('\nPodpowiedź: model z górnej piątki ustaw jako główny do rozmowy,');
  console.log('a wolniejszy, ale mocniejszy — wybieraj świadomie do trudnych zadań.');
})();

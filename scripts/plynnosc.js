#!/usr/bin/env node
/* ============================================================
   Płynność modeli — który nadaje się do rozmowy, a który do czekania

   „Działa" i „da się z tego korzystać" to dwie różne rzeczy. Model, który
   odpowiada poprawnie, ale pierwszy znak pokazuje po ośmiu sekundach, jest
   w rozmowie nie do zniesienia — a tego nie widać w liście modeli.

   Mierzymy trzy liczby na model, każdą trzy razy (bierzemy MEDIANĘ, bo
   pojedynczy pomiar łapie zimny start i kłamie):

     • ruch    — ile trwa cisza, zanim cokolwiek dotrze. Przy modelach
                 rozumujących to często sam tok myślenia, nie odpowiedź.
     • treść   — pierwsze słowo właściwej odpowiedzi. Na to czeka człowiek,
                 więc ocena patrzy tutaj, a nie na „ruch".
     • tempo   — znaków na sekundę po ruszeniu. Poniżej ~20 zn./s czyta się
                 wolniej, niż model pisze — i to widać.
     • całość  — do ostatniego znaku krótkiej odpowiedzi.

   Gdy „treść" mocno odstaje od „ruchu", wiersz dostaje znacznik 🧠myśli X s.

     ./scripts/plynnosc.js                    # wszystkie działające modele
     ./scripts/plynnosc.js cloud              # tylko chmura
     ./scripts/plynnosc.js local              # tylko lokalny
     ./scripts/plynnosc.js cloud nemotron     # tylko pasujące nazwą
     ./scripts/plynnosc.js cloud > wynik.txt  # do pliku

   Kosztuje tyle, co kilkanaście krótkich wiadomości.

   ⚠ Pełny przebieg (100+ modeli) trwa kilkanaście minut i potrafi przeżyć
   zerwanie połączenia SSH. Puść go tak, żeby żył bez Ciebie:

     nohup ./scripts/plynnosc.js cloud > /tmp/plynnosc.txt 2>&1 &
     tail -f /tmp/plynnosc.txt          # podglądaj; Ctrl+C wychodzi z podglądu

   Wynik i tak jest dopisywany na bieżąco do pliku wskazanego przez
   PLYNNOSC_PLIK (domyślnie /tmp/plynnosc-ostatni.txt), więc po zerwanym
   połączeniu nie tracisz tego, co już zmierzone.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const KORZEN = path.resolve(__dirname, '..');
const { modelNotAChatPartner } = require('../public/models.js');
const ADRES = process.env.COSMOS_URL || 'http://localhost:3000';
const POWTORZENIA = Number(process.env.PLYNNOSC_PROBY || 3);
const PYTANIE = 'Napisz jednym zdaniem, czym jest fotografia poklatkowa.';
/* Modele rozumujące zużywają budżet na myślenie i przy 160 tokenach nie
   zdążą nic napisać — wychodziło z tego „pusta odpowiedź" przy modelach,
   które działają bez zarzutu. */
const MAX_TOKENOW = Number(process.env.PLYNNOSC_TOKENY || 700);

/* Zapis na bieżąco. Przebieg 103 modeli trwa kilkanaście minut i realnie
   zdarzyło się, że SSH padło w połowie — cała praca poszła w gwizdek. */
const PLIK = process.env.PLYNNOSC_PLIK || '/tmp/plynnosc-ostatni.txt';
function zapisz(linia) {
  console.log(linia);
  try { fs.appendFileSync(PLIK, linia + '\n'); } catch { /* brak prawa zapisu */ }
}

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
  let myslenie = 0;
  let doTresci = 0;
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
        max_tokens: MAX_TOKENOW,
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
          // Osobno: kiedy pojawiła się TREŚĆ, a nie sam tok myślenia.
          // Przy modelu rozumującym to dwie różne chwile i dwa różne
          // doświadczenia — „coś się dzieje" kontra „mam odpowiedź".
          if (tekst && !doTresci) doTresci = Date.now() - t0;
          znaki += tekst.length;
          myslenie += (d.reasoning_content || d.reasoning || '').length;
        } catch { /* niepełna ramka */ }
      }
    }
  } catch (e) {
    blad = /timeout|abort/i.test(e.message) ? 'przekroczony czas (120 s)' : e.message.slice(0, 90);
  }
  const calosc = Date.now() - t0;
  if (blad) return { blad };
  if (!znaki && !myslenie) return { blad: 'pusta odpowiedź' };
  // Sam tok myślenia bez treści — model działa, ale nie zmieścił się
  // w budżecie. Dla płynności to i tak „coś się dzieje na ekranie".
  if (!znaki) return { pierwszy, doTresci: 0, calosc, znaki: myslenie, tylkoMyslenie: true,
    tempo: Math.round(myslenie / Math.max(0.1, (calosc - pierwszy) / 1000)) };
  return { pierwszy, doTresci: doTresci || pierwszy, calosc, znaki,
    tempo: Math.round(znaki / Math.max(0.1, (calosc - (doTresci || pierwszy)) / 1000)) };
}

const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/* Ocena łączy szybkość Z NIEZAWODNOŚCIĄ. Model, który raz odpowiada
   w 0,1 s, a dwa razy nie odpowiada wcale, jest w rozmowie gorszy niż
   spokojne 2 s za każdym razem — bo nie wiesz, czego się spodziewać.
   Pierwsza wersja tego skryptu tego nie widziała i przy dwóch przebiegach
   wskazywała zupełnie inne modele jako najlepsze. */
function ocena(pierwszy, tempo, udane, wszystkich, najgorszy) {
  const pewny = udane === wszystkich;
  const stabilny = !najgorszy || najgorszy <= Math.max(2500, pierwszy * 3);
  if (udane * 2 < wszystkich) return ['✗', `zawodny — odpowiedział ${udane} z ${wszystkich} razy`];
  if (!pewny) return ['~', `nierówny — ${udane} z ${wszystkich} prób, reszta bez odpowiedzi`];
  if (!stabilny) return ['~', `nierówny — raz ${(pierwszy / 1000).toFixed(1)} s, raz ${(najgorszy / 1000).toFixed(1)} s`];
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

  try { fs.writeFileSync(PLIK, `Pomiar z ${new Date().toLocaleString('pl-PL')}\n`); } catch { /* bez pliku */ }
  console.log(`Płynność — ${doZbadania.length} modeli, po ${POWTORZENIA} próby, mediana.`);
  console.log(`Wynik dopisywany na bieżąco do ${PLIK} — przeżyje zerwane połączenie.`);
  console.log('Bez pamięci, bazy wiedzy i manifestu — mierzymy modele, nie okoliczności.\n');
  console.log('  ruch · treść ·   tempo · całość · udane   model');
  console.log('  ' + '─'.repeat(72));

  const wyniki = [];
  for (const [ep, model] of doZbadania) {

    /* Wszystkie próby, nie do pierwszego błędu. Darmowy endpoint NVIDII
       potrafi raz odpowiedzieć w 0,4 s, a raz w ogóle — przerywanie na
       pierwszej wpadce dawało wynik zależny od tego, w której sekundzie
       akurat trafiliśmy. Dwa przebiegi tego samego pomiaru pokazywały
       zupełnie inne modele jako najlepsze. */
    const próby = [];
    const bledy = [];
    for (let i = 0; i < POWTORZENIA; i++) {
      const w = await jedenPomiar(ep, model);
      if (w.blad) bledy.push(w.blad); else próby.push(w);
    }
    const blad = próby.length ? '' : (bledy[0] || 'brak odpowiedzi');

    if (blad) {
      zapisz(`  ${'—'.padStart(13)} · ${'—'.padStart(5)} · ${'—'.padStart(6)}   ✗ ${model}`);
      zapisz(`  ${' '.repeat(32)}${blad}`);
      wyniki.push({ ep, model, blad });
      continue;
    }
    const p = mediana(próby.map((x) => x.pierwszy));
    const tresc = mediana(próby.map((x) => x.doTresci || x.pierwszy));
    const tempo = mediana(próby.map((x) => x.tempo));
    const c = mediana(próby.map((x) => x.calosc));
    const najgorszy = Math.max(...próby.map((x) => x.pierwszy));
    const udane = próby.length;
    const [znak, opis] = ocena(tresc, tempo, udane, POWTORZENIA, najgorszy);
    const rozrzut = udane > 1 && najgorszy > p * 3 ? ` ⚡do ${(najgorszy / 1000).toFixed(1)}s` : '';
    // Model rozumujący zaczyna od myślenia; treść przychodzi później.
    // Bez tej kolumny „0,1 s" wyglądało jak błyskawiczna odpowiedź, a było
    // błyskawicznym „…myślę".
    const mysli = tresc > p * 1.5 ? ` 🧠myśli ${((tresc - p) / 1000).toFixed(1)}s` : '';
    // Klasyfikator odpowie „safe" w 0,1 s i bez tej adnotacji wygląda
    // w tabeli jak najlepszy rozmówca w stawce.
    const specjalista = modelNotAChatPartner(model);
    const rola = specjalista ? ' ⚙ nie rozmówca' : '';
    zapisz(`  ${(p / 1000).toFixed(1).padStart(6)} s · ${(tresc / 1000).toFixed(1).padStart(5)} s · `
      + `${String(tempo).padStart(3)}/s · ${(c / 1000).toFixed(1).padStart(5)} s · ${udane}/${POWTORZENIA}`
      + `   ${znak} ${model}${rozrzut}${mysli}${rola}`);
    if (bledy.length) zapisz(`  ${' '.repeat(38)}${bledy.length}× ${bledy[0].slice(0, 60)}`);
    wyniki.push({ ep, model, pierwszy: p, tresc, tempo, calosc: c, znak, opis, udane, najgorszy, bledy: bledy.length, specjalista });
  }

  /* Sortujemy po niezawodności, POTEM po CAŁOŚCI odpowiedzi — nie po
     pierwszym znaku. Ocena patrzy już na treść, więc ranking liczony po
     pierwszym znaku był z nią niespójny: super-120b dostawał ✦ przy 1,2 s
     całości i wypadał poza szóstkę, przegrywając z modelami, które szybciej
     zaczynały i wolniej kończyły. */
  const dobre = wyniki.filter((w) => !w.blad)
    .sort((a, b) => (b.udane - a.udane) || (a.calosc - b.calosc));
  const rozmowni = dobre.filter((w) => !w.specjalista);
  console.log('\n' + '─'.repeat(70));
  if (rozmowni.length) {
    const pewne = rozmowni.filter((w) => w.znak === '✦' || w.znak === '✓');
    console.log(pewne.length
      ? 'Najlepsze do rozmowy — szybkie ORAZ odpowiadające za każdym razem:'
      : 'Żaden model nie odpowiedział pewnie we wszystkich próbach. Najbliżej:');
    for (const w of (pewne.length ? pewne : rozmowni).slice(0, 6)) {
      console.log(`  ${w.znak} ${w.model}`);
      const ogon = w.tresc > w.pierwszy * 1.5
        ? ` (ruch po ${(w.pierwszy / 1000).toFixed(1)} s, potem myśli)` : '';
      console.log(`      treść po ${(w.tresc / 1000).toFixed(1)} s${ogon}, `
        + `całość ${(w.calosc / 1000).toFixed(1)} s, `
        + `${w.tempo} zn./s, ${w.udane}/${POWTORZENIA} prób — ${w.opis}`);
    }
  }
  if (dobre.length) {
    /* Chwiejne mają pierwszeństwo przed „męczącymi" — model, który
       odpowiedział raz na trzy próby, trafiał wcześniej na obie listy.
       Specjaliści mają własną sekcję i nie powtarzają się tutaj: to, że
       klasyfikator bywa nierówny, nikomu niczego nie ułatwia. */
    const chwiejne = rozmowni.filter((w) => w.udane < POWTORZENIA);
    if (chwiejne.length) {
      console.log(`\nOdpowiadają, ale nie zawsze (${chwiejne.length}) — darmowy endpoint bywa przeciążony:`);
      console.log('  ' + chwiejne.map((w) => `${w.model.split('/').pop()} (${w.udane}/${POWTORZENIA})`).join(', '));
    }
    const meczace = rozmowni.filter((w) => w.znak === '✗' && w.udane === POWTORZENIA);
    if (meczace.length) {
      console.log(`\nDo zadań w tle, nie do rozmowy (${meczace.length}): `
        + meczace.map((w) => w.model.split('/').pop()).join(', '));
    }
    /* Wypisujemy je jawnie, żeby „gdzie się podział mój najszybszy model"
       miało odpowiedź w tym samym wydruku, a nie w kodzie. */
    const specjalisci = dobre.filter((w) => w.specjalista);
    if (specjalisci.length) {
      console.log(`\nPoza rankingiem (${specjalisci.length}) — odpowiadają, ale nie są rozmówcami`);
      console.log('(klasyfikatory bezpieczeństwa, tłumacze, embeddingi, modele badawcze):');
      console.log('  ' + specjalisci.map((w) => w.model.split('/').pop()).join(', '));
    }
  }
  const padly = wyniki.filter((w) => w.blad);
  if (padly.length) console.log(`\nNie odpowiedziały (${padly.length}): ` + padly.map((w) => w.model).join(', '));
  console.log('\nPodpowiedź: wybieraj z górnej listy — te odpowiadają szybko I za każdym razem.');
  console.log('Darmowy endpoint NVIDII bywa przeciążony, więc pojedynczy przebieg kłamie;');
  console.log('przy ważnej decyzji puść pomiar dwa razy o różnych porach dnia.');
})();

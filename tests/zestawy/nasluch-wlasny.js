/* Nasłuch własnym strumieniem — sprawdzenie tego, co naprawdę boli.

   Marcin zgłosił trzy rzeczy z realnego użycia trybu głosowego: mikrofon
   ciągle się włącza i wyłącza, Cosmos słyszy sam siebie i wpada w pętlę.
   `public/nasluch.js` naprawia to inaczej niż dotychczasowe łatki: nie obchodzi
   Web Speech API, tylko go nie używa. Mikrofon jest otwarty raz, a „głuchy"
   znaczy naprawdę głuchy.

   Ten zestaw nie potrzebuje przeglądarki. Moduł jest zwykłym IIFE na `window`,
   więc podstawiamy własny `window` z atrapą WebAudio i sterujemy nim ramka po
   ramce. Dzięki temu da się sprawdzić rzeczy, których w przeglądarce nie
   sprawdzisz bez mówienia do mikrofonu:

     · czy cisza NIC nie wysyła (inaczej Whisper mieli szum całą dobę),
     · czy podczas mówienia Cosmosa nie wychodzi ANI JEDNO żądanie — to jest
       dowód, że pętla sprzężenia jest niemożliwa, a nie tylko mało prawdopodobna,
     · czy pierwsza głoska nie ginie (przedbieg),
     · czy przepróbkowanie faktycznie tłumi aliasing, a nie tylko tak twierdzi
       komentarz w kodzie.
*/
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAMKA = 1024;
const CZESTOTLIWOSC_WE = 48000;
const MS_RAMKI = (RAMKA / CZESTOTLIWOSC_WE) * 1000;   // 21,33 ms

/** Świeże środowisko modułu: własny `window`, atrapa WebAudio, atrapa fetch. */
function zaladuj({ odpowiedzSTT = { text: 'test' }, statusSTT = 200 } = {}) {
  const zadania = [];        // każde wywołanie /api/stt

  let procesor = null;
  class AtrapaCtx {
    constructor() {
      this.sampleRate = CZESTOTLIWOSC_WE;
      this.state = 'running';
      this.destination = {};
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor(n) {
      procesor = { bufferSize: n, onaudioprocess: null, connect() {}, disconnect() {} };
      return procesor;
    }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); }
    close() {}
  }

  const window = {
    AudioContext: AtrapaCtx,
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
      },
    },
    Blob,
    DataView,
    Float32Array,
    Int16Array,
    ArrayBuffer,
    Math,
    setTimeout,
    clearTimeout,
    fetch: async (adres, opcje) => {
      zadania.push({ adres, opcje });
      return {
        ok: statusSTT === 200,
        status: statusSTT,
        json: async () => odpowiedzSTT,
      };
    },
  };
  window.window = window;
  // Moduł woła `navigator.mediaDevices` bez przedrostka — w przeglądarce to
  // pole `window`, tutaj musi być globalne w kontekście skryptu.
  const kontekst = vm.createContext(Object.assign({ console, Blob, TextEncoder }, window, { window }));
  const kod = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'nasluch.js'), 'utf8');
  vm.runInContext(kod, kontekst);
  return { API: kontekst.window.NasluchWlasny, zadania, proc: () => procesor };
}

const pauza = () => new Promise((r) => setImmediate(r));

/** Ramka szumu o zadanej amplitudzie. Szum, nie sinus: energia jest wtedy
 *  rozłożona jak w mowie, a nie skupiona w jednym prążku. */
function ramkaSzumu(amplituda) {
  const f = new Float32Array(RAMKA);
  for (let i = 0; i < RAMKA; i++) f[i] = (Math.random() * 2 - 1) * amplituda;
  return f;
}

function podaj(proc, ramki) {
  for (const r of ramki) {
    proc.onaudioprocess({ inputBuffer: { length: r.length, getChannelData: () => r } });
  }
}

const cisza = (ile) => Array.from({ length: ile }, () => ramkaSzumu(0.0008));
const mowa = (ile) => Array.from({ length: ile }, () => ramkaSzumu(0.30));

/** Ile sekund dźwięku niesie plik WAV (mono, 16 bitów). */
async function sekundyWav(blob) {
  const buf = Buffer.from(await blob.arrayBuffer());
  const rate = buf.readUInt32LE(24);
  const bajtow = buf.readUInt32LE(40);
  return bajtow / 2 / rate;
}

(async () => {
  const fail = [];

  // ---------------------------------------------------------------
  // 1. Nagłówek WAV — czy to w ogóle jest plik, który ktoś odczyta
  // ---------------------------------------------------------------
  {
    const { API } = zaladuj();
    const pcm = new Int16Array(1600);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(Math.sin(i / 5) * 10000);
    const buf = Buffer.from(await API.wav(pcm, 16000).arrayBuffer());
    const pola = {
      RIFF: buf.toString('ascii', 0, 4),
      WAVE: buf.toString('ascii', 8, 12),
      fmt: buf.toString('ascii', 12, 16),
      format: buf.readUInt16LE(20),
      kanaly: buf.readUInt16LE(22),
      rate: buf.readUInt32LE(24),
      naSekunde: buf.readUInt32LE(28),
      bity: buf.readUInt16LE(34),
      data: buf.toString('ascii', 36, 40),
      dlugoscData: buf.readUInt32LE(40),
      calosc: buf.length,
    };
    const oczekiwane = {
      RIFF: 'RIFF', WAVE: 'WAVE', fmt: 'fmt ', format: 1, kanaly: 1,
      rate: 16000, naSekunde: 32000, bity: 16, data: 'data',
      dlugoscData: 3200, calosc: 3244,
    };
    for (const [k, v] of Object.entries(oczekiwane)) {
      if (pola[k] !== v) fail.push(`WAV: pole ${k} = ${pola[k]}, oczekiwane ${v}`);
    }
    // Pierwsza próbka musi wrócić taka, jaka weszła — inaczej gubimy dźwięk
    // na samym zapisie, a nie w rozpoznawaniu.
    if (buf.readInt16LE(44) !== pcm[0]) fail.push('WAV: pierwsza próbka nie zgadza się z wejściem');
    console.log(`1. nagłówek WAV: ${oczekiwane.calosc} B, ${pola.rate} Hz, ${pola.bity} bit, mono`);
  }

  // ---------------------------------------------------------------
  // 2. Przeprόbkowanie: długość, brak przesterowania, TŁUMIENIE ALIASINGU
  // ---------------------------------------------------------------
  {
    const { API } = zaladuj();

    const stala = new Float32Array(4800).fill(0.5);
    const wynik = API.przeprobkuj(stala, 48000, 16000);
    if (wynik.length !== 1600) fail.push(`przeprόbkowanie: ${wynik.length} próbek zamiast 1600`);
    if (Math.abs(wynik[100] - 0.5 * 0x7fff) > 2) fail.push('przeprόbkowanie: stała amplituda się zmieniła');

    // Pełna skala nie może przekroczyć zakresu int16 — przester słychać
    // jako trzask i psuje rozpoznawanie bardziej niż cichy sygnał.
    const gorne = API.przeprobkuj(new Float32Array(300).fill(1.5), 48000, 16000);
    const dolne = API.przeprobkuj(new Float32Array(300).fill(-1.5), 48000, 16000);
    if (gorne[10] !== 32767 || dolne[10] !== -32768) {
      fail.push(`przeprόbkowanie: brak obcięcia do int16 (${gorne[10]}, ${dolne[10]})`);
    }

    /* Sedno: ton 12 kHz przy 48 kHz. Po zejściu na 16 kHz jest POWYŻEJ
       częstotliwości Nyquista, więc naiwne branie co trzeciej próbki zawinie
       go do pasma jako 4 kHz o PEŁNEJ amplitudzie — czyli świst w środku
       mowy. Uśrednianie okna działa jak filtr dolnoprzepustowy i musi go
       wyraźnie stłumić. Jeśli ten test kiedyś padnie, znaczy że ktoś
       „zoptymalizował" przeprόbkowanie na wybieranie próbek. */
    const N = 4800;
    const ton = new Float32Array(N);
    for (let i = 0; i < N; i++) ton[i] = Math.sin(2 * Math.PI * 12000 * (i / 48000));
    const przezSrednia = API.przeprobkuj(ton, 48000, 16000);
    const naiwne = new Int16Array(N / 3);
    for (let i = 0; i < naiwne.length; i++) naiwne[i] = Math.round(ton[i * 3] * 0x7fff);
    const rms = (a) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i] * a[i];
      return Math.sqrt(s / a.length);
    };
    const stosunek = rms(przezSrednia) / rms(naiwne);
    console.log(`2. aliasing 12 kHz → 16 kHz: uśrednianie daje ${(stosunek * 100).toFixed(0)}% `
      + 'energii tego, co wybieranie próbek');
    if (!(stosunek < 0.6)) {
      fail.push(`przeprόbkowanie nie tłumi aliasingu (stosunek ${stosunek.toFixed(2)}, ma być < 0,6)`);
    }
  }

  // ---------------------------------------------------------------
  // 3. Cisza nie wysyła nic
  // ---------------------------------------------------------------
  {
    const { API, zadania, proc } = zaladuj();
    const n = API.utworz({});
    await n.start();
    podaj(proc(), cisza(120));            // ponad 2,5 s ciszy
    await pauza();
    console.log(`3. 2,5 s ciszy → ${zadania.length} żądań do Whispera`);
    if (zadania.length) fail.push(`cisza wysłała ${zadania.length} nagrań — Whisper mieliłby szum bez końca`);
    n.stop();
  }

  // ---------------------------------------------------------------
  // 4. Wypowiedź: jedno żądanie, poprawny typ, sensowna długość
  // ---------------------------------------------------------------
  {
    const { API, zadania, proc } = zaladuj({ odpowiedzSTT: { text: 'hej kosmos' } });
    const uslyszane = [];
    const n = API.utworz({ onWypowiedz: (x) => uslyszane.push(x) });
    await n.start();
    podaj(proc(), [...cisza(10), ...mowa(30), ...cisza(40)]);
    await pauza();
    console.log(`4. 0,64 s mowy + cisza → ${zadania.length} żądanie, tekst: ${JSON.stringify(uslyszane)}`);
    if (zadania.length !== 1) fail.push(`wypowiedź dała ${zadania.length} żądań zamiast 1`);
    if (uslyszane.length !== 1 || uslyszane[0] !== 'hej kosmos') {
      fail.push(`tekst z Whispera nie dotarł: ${JSON.stringify(uslyszane)}`);
    }
    if (zadania[0]) {
      if (zadania[0].adres !== '/api/stt') fail.push(`zły adres: ${zadania[0].adres}`);
      if (zadania[0].opcje.headers['Content-Type'] !== 'audio/wav') {
        fail.push('nagranie wysłane bez nagłówka audio/wav — Whisper zgadywałby format');
      }
      const s = await sekundyWav(zadania[0].opcje.body);
      // Głośna część to 30 ramek ≈ 0,64 s; z przedbiegiem i ogonem ciszy
      // całość ma być dłuższa, ale nie absurdalnie.
      if (!(s > 0.7 && s < 2.5)) fail.push(`długość nagrania ${s.toFixed(2)} s poza sensownym zakresem`);
    }
    n.stop();
  }

  // ---------------------------------------------------------------
  // 5. GŁUCHY — dowód, że pętla sprzężenia jest niemożliwa
  // ---------------------------------------------------------------
  {
    const { API, zadania, proc } = zaladuj();
    const n = API.utworz({});
    await n.start();
    n.gluchy(true);
    // Cosmos „mówi" — to jego własny głos wraca do mikrofonu.
    podaj(proc(), [...mowa(60), ...cisza(40)]);
    await pauza();
    const wGluchocie = zadania.length;
    // …i przestaje mówić. Teraz pytanie użytkownika ma dojść.
    n.gluchy(false);
    podaj(proc(), [...cisza(5), ...mowa(30), ...cisza(40)]);
    await pauza();
    console.log(`5. w trakcie mówienia Cosmosa: ${wGluchocie} żądań · po wyciszeniu: ${zadania.length - wGluchocie}`);
    if (wGluchocie !== 0) fail.push(`SPRZĘŻENIE: ${wGluchocie} nagrań wysłanych, gdy Cosmos mówił`);
    if (zadania.length - wGluchocie !== 1) {
      fail.push(`po wyciszeniu przeszło ${zadania.length - wGluchocie} wypowiedzi zamiast 1`);
    }
    n.stop();
  }

  // ---------------------------------------------------------------
  // 6. Kaszlnięcie odpada, ale długi monolog domyka się sam
  // ---------------------------------------------------------------
  {
    const { API, zadania, proc } = zaladuj();
    const n = API.utworz({});
    await n.start();
    podaj(proc(), [...cisza(5), ...mowa(6), ...cisza(40)]);   // ~128 ms mowy
    await pauza();
    console.log(`6a. 0,13 s hałasu (stuknięcie) → ${zadania.length} żądań`);
    if (zadania.length) fail.push('krótkie stuknięcie poszło do Whispera jako wypowiedź');
    n.stop();

    const drugi = zaladuj();
    const m = drugi.API.utworz({});
    await m.start();
    // Nieprzerwany hałas dłuższy niż limit — nie ma ciszy, która by go domknęła.
    podaj(drugi.proc(), mowa(Math.ceil(16000 / MS_RAMKI)));
    await pauza();
    console.log(`6b. 16 s nieprzerwanego dźwięku → ${drugi.zadania.length} żądań (limit domyka sam)`);
    if (drugi.zadania.length < 1) fail.push('ciągły dźwięk rósł w nieskończoność — limit maxMowyMs nie zadziałał');
    if (drugi.zadania[0]) {
      const s = await sekundyWav(drugi.zadania[0].opcje.body);
      if (s > 16) fail.push(`nagranie ${s.toFixed(1)} s przekroczyło limit 15 s`);
    }
    m.stop();
  }

  // ---------------------------------------------------------------
  // 7. Przedbieg — pierwsza głoska nie ginie
  // ---------------------------------------------------------------
  {
    const bez = zaladuj();
    const a = bez.API.utworz({ przedbiegMs: 0 });
    await a.start();
    podaj(bez.proc(), [...cisza(20), ...mowa(25), ...cisza(40)]);
    await pauza();

    const z = zaladuj();
    const b = z.API.utworz({ przedbiegMs: 320 });
    await b.start();
    podaj(z.proc(), [...cisza(20), ...mowa(25), ...cisza(40)]);
    await pauza();

    if (!bez.zadania[0] || !z.zadania[0]) {
      fail.push('przedbieg: brak nagrania do porównania');
    } else {
      const sBez = await sekundyWav(bez.zadania[0].opcje.body);
      const sZ = await sekundyWav(z.zadania[0].opcje.body);
      const roznica = sZ - sBez;
      console.log(`7. przedbieg: ${sBez.toFixed(2)} s bez → ${sZ.toFixed(2)} s z (+${(roznica * 1000).toFixed(0)} ms)`);
      // Przedbieg trzyma ostatnie ~320 ms, ale w krokach po jednej ramce
      // (21 ms), więc dokładnej wartości nie ma sensu wymagać.
      if (!(roznica > 0.2 && roznica < 0.45)) {
        fail.push(`przedbieg dodał ${(roznica * 1000).toFixed(0)} ms zamiast około 320 ms`);
      }
    }
    a.stop(); b.stop();
  }

  // ---------------------------------------------------------------
  // 8. Whisper oddał śmieć albo błąd — nic nie leci dalej, nic nie wybucha
  // ---------------------------------------------------------------
  {
    for (const [opis, odp] of [['pusty tekst', { text: '' }], ['sama interpunkcja', { text: '. . .' }]]) {
      const { API, proc } = zaladuj({ odpowiedzSTT: odp });
      const uslyszane = [];
      const n = API.utworz({ onWypowiedz: (x) => uslyszane.push(x) });
      await n.start();
      podaj(proc(), [...cisza(5), ...mowa(30), ...cisza(40)]);
      await pauza();
      if (uslyszane.length) fail.push(`„${opis}" z Whispera potraktowane jako pytanie: ${JSON.stringify(uslyszane)}`);
      n.stop();
    }

    const { API, proc } = zaladuj({ statusSTT: 501, odpowiedzSTT: { error: 'Whisper niezainstalowany' } });
    const bledy = [];
    const n = API.utworz({ onBlad: (e) => bledy.push(e.message) });
    await n.start();
    podaj(proc(), [...cisza(5), ...mowa(30), ...cisza(40)]);
    await pauza();
    console.log(`8. Whisper 501 → onBlad: ${JSON.stringify(bledy)}`);
    if (bledy.length !== 1) fail.push(`błąd zmysłów nie dotarł do interfejsu (${bledy.length} zgłoszeń)`);
    if (bledy[0] && !/Whisper/.test(bledy[0])) fail.push(`komunikat nic nie tłumaczy: ${bledy[0]}`);
    // Najważniejsze: nasłuch DALEJ ŻYJE. Awaria jednej transkrypcji nie może
    // kończyć trybu głosowego — zmysły mogą wstać za chwilę.
    if (!n.dziala()) fail.push('po błędzie transkrypcji nasłuch się wyłączył');
    n.stop();
    if (n.dziala()) fail.push('stop() nie zatrzymał nasłuchu');
  }

  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nNASŁUCH WŁASNY OK');
  process.exit(fail.length ? 1 : 0);
})();

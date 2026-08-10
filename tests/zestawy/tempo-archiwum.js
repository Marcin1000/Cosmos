/* Ile realnie trwa uzupełnianie archiwum na 59 tysiącach plików.

   Marcin, po pierwszej paczce: „To dociąganie danych z plików przy takiej
   dużej liczbie plików chyba potrwa parę dni. Strasznie wolno to idzie."
   Licznik szedł 71 → 96 uzupełnionych, przy 55 tysiącach w kolejce.

   Zmierzone przyczyny — obie zaskakujące, obie NIE tam, gdzie się ich szukało:

     1. `writeFileSync` na indeksie 97,8 MB trwał 5,2 s i BLOKOWAŁ pętlę
        zdarzeń. Zapis był odkładany o sekundę, więc przy dociąganiu serwer
        stał dłużej, niż pracował — i nie obsługiwał w tym czasie niczego.
     2. 70 z 98 MB tego pliku to były adresy miniatur z OneDrive: po 1,2 kB
        podpisanego adresu na plik, przepisywane przy każdym zapisie. Nikt ich
        nie czyta — przeglądarka bierze podgląd z `/api/archive/thumb`, bo te
        adresy i tak wygasają po godzinie.

   Czego NIE było przyczyną, choć wyglądało: `indexOf` w `dodaj()`. Wygląda na
   kwadrat po liczbie wpisów, a zmierzone daje 132 ms na 500 aktualizacji
   z końca tablicy. Zgadywanie zaprowadziłoby w złe miejsce.

   Trzecia zmiana to sieć: dociąganie szło plik po pliku, a każdy plik to jedno
   żądanie do Microsoftu. Tutaj sprawdzamy, że idzie ich kilka naraz.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');

const fail = [];
const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'tempo-arch-'));
const archiwum = require('../../lib/archiwum.js').utworz(katalog);

// --- 1. Indeks nie puchnie od adresów, których nikt nie czyta --------------
const N = 20000;
const wpisy = [];
for (let i = 0; i < N; i++) {
  wpisy.push({
    id: `onedrive:${i}`, zrodlo: 'onedrive', typ: 'zdjecie',
    nazwa: `3B9A${1000 + i}.CR3`,
    sciezka: `/Zdjęcia/Mazury 2026/3B9A${1000 + i}.CR3`,
    kiedy: '2026-06-21T10:00:00.000Z',
    // Tak wygląda podpisany adres miniatury z Graph: ~1,2 kB na plik.
    miniatura: 'https://public.bl.files.1drv.com/' + 'x'.repeat(1200),
  });
}
archiwum.dodaj(wpisy);
const zPamieci = JSON.stringify(archiwum.szukaj({ zrodlo: 'onedrive' }));
const naPlik = Buffer.byteLength(zPamieci) / N;
console.log(`1. bajtów indeksu na plik: ${Math.round(naPlik)}`);
if (/1drv\.com/.test(zPamieci)) {
  fail.push('adresy miniatur wróciły do indeksu — 1,2 kB na plik za coś, czego nikt nie czyta');
}
if (naPlik > 700) fail.push(`${Math.round(naPlik)} B na wpis to za dużo — indeks znowu puchnie`);

(async () => {
  // --- 2. Zapis nie blokuje pętli zdarzeń ---------------------------------
  /* Sam czas zapisu to nie wszystko. Pytanie brzmi: czy w tym czasie serwer
     może cokolwiek obsłużyć. Liczymy tyknięcia zegara — przy zapisie
     synchronicznym nie ma ani jednego. */
  let tykniecia = 0;
  const zegar = setInterval(() => { tykniecia++; }, 5);
  const start = Date.now();
  await archiwum.zapisz();
  const trwal = Date.now() - start;
  clearInterval(zegar);
  const rozmiar = fs.statSync(path.join(katalog, 'archiwum.json')).size;
  console.log(`2. zapis ${(rozmiar / 1048576).toFixed(1)} MB trwał ${trwal} ms, `
    + `pętla zdarzeń tyknęła ${tykniecia} razy`);
  if (trwal > 40 && tykniecia === 0) {
    fail.push('zapis blokuje pętlę zdarzeń — w tym czasie serwer nie obsługuje żądań');
  }

  // --- 3. Dociąganie EXIF-u idzie RÓWNOLEGLE ------------------------------
  /* Atrapa OneDrive z opóźnieniem 50 ms na plik. Sekwencyjnie 60 plików = 3 s;
     przy sześciu naraz — około pół sekundy. Mierzymy też szczyt jednoczesnych
     żądań, bo sam czas dałoby się poprawić przypadkiem. */
  let teraz = 0;
  let szczyt = 0;
  const onedrive = {
    polaczony: () => true,
    dociagnijExif: async () => {
      teraz++; szczyt = Math.max(szczyt, teraz);
      await new Promise((r) => setTimeout(r, 50));
      teraz--;
      return { aparat: 'Canon EOS R6m2', obiektyw: 'RF24-105mm F4 L IS USM' };
    },
  };
  const trasy = require('../../lib/archiwum-trasy.js').utworz({
    archiwum,
    onedrive,
    SENSES_URL: '',
    sendJson: (res, kod, dane) => { res.kod = kod; res.dane = dane; },
    readJson: async () => ({ ile: 60 }),
    addEvent: () => {},
    sensesState: () => ({}),
    wspolrzedneMiejsca: async () => null,
  });

  const res = {};
  const t = Date.now();
  await trasy.handleArchiwum({ method: 'POST', url: '/api/archive/lenses' }, res, '/api/archive/lenses');
  const czas = Date.now() - t;
  console.log(`3. 60 plików po 50 ms: ${czas} ms, szczyt równoległych żądań: ${szczyt}`);
  console.log(`   wynik: uzupełnione ${res.dane && res.dane.uzupelnione}, zostało ${res.dane && res.dane.zostalo}`);
  if (szczyt < 2) fail.push('dociąganie idzie plik po pliku — opóźnienie łącza sumuje się 56 tysięcy razy');
  if (czas > 1500) fail.push(`60 plików po 50 ms zajęło ${czas} ms — to tempo sekwencyjne`);
  if (!res.dane || res.dane.uzupelnione !== 60) {
    fail.push(`uzupełniono ${res.dane && res.dane.uzupelnione} z 60 — równoległość gubi pliki`);
  }

  /* Kolejka MUSI maleć — inaczej pętla paczek w przeglądarce kręci się bez
     końca. To już raz się zdarzyło, przy plikach bez obiektywu. */
  if (!res.dane || res.dane.zostalo !== N - 60) {
    fail.push(`w kolejce zostało ${res.dane && res.dane.zostalo}, spodziewane ${N - 60}`);
  }

  fs.rmSync(katalog, { recursive: true, force: true });
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nTEMPO ARCHIWUM OK');
  process.exit(fail.length ? 1 : 0);
})();

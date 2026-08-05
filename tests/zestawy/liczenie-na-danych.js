/* Odpowiednik „Code Interpreter": model pisze program, Cosmos go wykonuje,
   a odpowiedź opiera się na policzonej liczbie, nie na oszacowaniu.

   Połowa tego zestawu to GRANICE, nie funkcje. Kod pisze model, więc trzeba
   wiedzieć — i wiedzieć w sposób sprawdzalny — czego ten kod NIE MOŻE zrobić:
   sięgnąć po pliki serwera, odpalić podproces, zobaczyć klucze API, wisieć
   w nieskończoność. To, czego nie sprawdzamy (sieć), jest opisane wprost
   w nagłówku lib/kod.js — bo nieuczciwe byłoby nazywać to piaskownicą. */
const { srodowisko } = require('../pomoc');
const { uruchomKod } = require('../../lib/kod.js');

(async () => {
  const fail = [];

  // 1. liczy na załączonych danych
  const dane = [{ name: 'sprzedaz.csv', text: 'miesiac;kwota\nstyczen;12000\nluty;9500\nmarzec;14300' }];
  let r = await uruchomKod(
    "const fs=require('fs');\n"
    + "const l=fs.readFileSync('sprzedaz.csv','utf8').trim().split('\\n').slice(1);\n"
    + "console.log('SUMA', l.reduce((s,x)=>s+Number(x.split(';')[1]),0));", dane);
  console.log(`1. liczenie na CSV → ${JSON.stringify(r.stdout.trim())} (${r.ms} ms)`);
  if (!/SUMA 35800/.test(r.stdout)) fail.push('nie policzył sumy z załącznika');

  // 2. plik wynikowy wraca do rozmowy
  r = await uruchomKod("require('fs').writeFileSync('wykres.svg','<svg width=\"10\"></svg>')");
  console.log(`2. plik wynikowy → ${r.wyniki.map((w) => w.name).join(', ') || 'BRAK'}`);
  if (!r.wyniki.some((w) => w.name === 'wykres.svg')) fail.push('nie oddał zapisanego pliku');

  // --- granice ---

  // 3. pliki serwera poza katalogiem roboczym
  r = await uruchomKod("require('fs').readFileSync('/etc/passwd','utf8')");
  console.log(`3. odczyt /etc/passwd → ${/ERR_ACCESS_DENIED/.test(r.stderr) ? 'zablokowany' : 'PRZESZEDŁ'}`);
  if (!/ERR_ACCESS_DENIED/.test(r.stderr)) fail.push('kod czyta pliki serwera');

  // 4. zapis poza katalogiem roboczym
  r = await uruchomKod("require('fs').writeFileSync('/tmp/cosmos-wyciek.txt','x')");
  console.log(`4. zapis do /tmp → ${/ERR_ACCESS_DENIED/.test(r.stderr) ? 'zablokowany' : 'PRZESZEDŁ'}`);
  if (!/ERR_ACCESS_DENIED/.test(r.stderr)) fail.push('kod pisze poza swoim katalogiem');

  // 5. podprocesy
  r = await uruchomKod("require('child_process').execSync('id')");
  console.log(`5. podproces → ${/ERR_ACCESS_DENIED/.test(r.stderr) ? 'zablokowany' : 'PRZESZEDŁ'}`);
  if (!/ERR_ACCESS_DENIED/.test(r.stderr)) fail.push('kod uruchamia podprocesy');

  /* 6. Klucze API. To jest najważniejsze sprawdzenie w całym zestawie:
     NVIDIA_API_KEY siedzi w zmiennych środowiskowych serwera, a program
     pisze model. Do procesu potomnego nie może trafić nic poza PATH. */
  process.env.NVIDIA_API_KEY = 'nvapi-TAJNY-KLUCZ-TESTOWY';
  r = await uruchomKod("console.log(JSON.stringify(process.env))");
  console.log(`6. zmienne środowiskowe widoczne dla kodu: ${r.stdout.trim().slice(0, 90)}`);
  if (/nvapi-TAJNY/.test(r.stdout)) fail.push('KLUCZ API WYCIEKA do kodu pisanego przez model');
  if (/NVIDIA_API_KEY/.test(r.stdout)) fail.push('nazwy kluczy widoczne dla kodu');

  // 7. pętla nieskończona kończy się limitem, nie zawieszeniem serwera
  const t0 = Date.now();
  r = await uruchomKod('while (true) {}');
  const ile = Date.now() - t0;
  console.log(`7. pętla nieskończona → przerwana po ${ile} ms (przerwany=${r.przerwany})`);
  if (!r.przerwany) fail.push('nieskończona pętla nie została przerwana');
  if (ile > 15000) fail.push('limit czasu nie działa — serwer wisiałby');

  // 8. błąd w kodzie wraca jako komunikat, nie jako wywrotka Cosmosa
  r = await uruchomKod('nieistniejacaFunkcja()');
  console.log(`8. błąd w kodzie → ${r.stderr.split('\n').find((l) => /Error/.test(l)) || 'BRAK'}`);
  if (!/ReferenceError/.test(r.stderr)) fail.push('błąd programu nie wraca do rozmowy');

  // --- przez API i prompt ---
  const env = await srodowisko('kontekst');

  const api = await fetch(`${env.adres}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: "console.log(2+2)", files: [] }),
  });
  const wynik = await api.json();
  console.log(`9. /api/run → HTTP ${api.status}, wyjście ${JSON.stringify(wynik.stdout)}`);
  if (api.status !== 200 || !/4/.test(wynik.stdout || '')) fail.push('API nie uruchamia kodu');

  const pusty = await fetch(`${env.adres}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: '   ' }),
  });
  console.log(`10. pusty kod → HTTP ${pusty.status}`);
  if (pusty.status !== 400) fail.push('pusty kod nie został odrzucony');

  // 11. duży model wie o narzędziu, mały nie dostaje bloku, którego nie użyje
  const promptDla = async (model) => {
    const res = await fetch(`${env.adres}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'cloud', model, messages: [{ role: 'user', content: 'x' }] }),
    });
    return res.text();
  };
  const duzy = await promptDla('nvidia/nemotron-3-super-120b-a12b');
  const maly = await promptDla('nvidia/nemotron-mini-4b-instruct');
  console.log(`11. instrukcja „uruchom": duży ${/```uruchom/.test(duzy) ? 'ma' : 'BRAK'}, `
    + `mały ${/```uruchom/.test(maly) ? 'MA (źle)' : 'nie ma'}`);
  if (!/LICZENIE NA DANYCH/.test(duzy)) fail.push('duży model nie wie, że umie liczyć');
  if (/LICZENIE NA DANYCH/.test(maly)) fail.push('mały model dostał narzędzie, którego nie użyje');

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nLICZENIE NA DANYCH OK');
  process.exit(fail.length ? 1 : 0);
})();

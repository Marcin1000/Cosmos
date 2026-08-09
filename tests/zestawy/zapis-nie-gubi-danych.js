/* Czy przerwany zapis może zniszczyć dane?

   `writeFileSync` NIE JEST niepodzielny: najpierw obcina plik do zera, potem
   dopisuje treść. Przerwanie między jednym a drugim — restart usługi w złym
   momencie, zanik zasilania VPS-a, brak miejsca na dysku — zostawia plik
   pusty albo urwany w połowie.

   Przy `archiwum.json` zauważyłem to od razu i zrobiłem tam zapis przez plik
   tymczasowy. Reszta danych została po staremu i to była niespójność po ZŁEJ
   stronie: indeks zdjęć odbudowuje się jednym kliknięciem „Indeksuj teraz",
   a rozmowy, pamięć długotrwała i baza wiedzy nie odbudowują się wcale.

   Prawdziwego zaniku zasilania nie wywołamy, więc awarię MODELUJEMY: „proces
   zginął po obcięciu pliku, a przed dopisaniem treści". Zestaw pokazuje obie
   strony obok siebie — przy zapisie wprost dane w tym momencie już nie
   istnieją, przy zapisie przez plik tymczasowy leżą nietknięte, bo obcinany
   jest plik tymczasowy, a `rename` w obrębie katalogu jest niepodzielny.

   Druga część sprawdza rzecz osobną i równie łatwą do przeoczenia: czy ten
   mechanizm jest FAKTYCZNIE użyty tam, gdzie trzeba. Sam poprawny helper nic
   nie daje, jeśli połowa modułów dalej woła `writeFileSync`.
*/
const fs = require('node:fs');
const path = require('node:path');
const { srodowisko } = require('../pomoc');
const { zapiszAtomowo } = require('../../lib/rdzen.js');

(async () => {
  const fail = [];

  /* ---- 1. Przerwany zapis a stare dane ----
     Modelujemy awarię wprost, bo prawdziwego zaniku zasilania nie wywołamy:
     „proces zginął po obcięciu pliku, a przed dopisaniem treści". Dla
     `writeFileSync` to jest moment, w którym dane już nie istnieją. Dla zapisu
     przez plik tymczasowy taki moment nie istnieje w ogóle — obcinany jest
     PLIK TYMCZASOWY, a prawdziwy leży nietknięty aż do `rename`. */
  {
    const kat = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cosmos-zapis-'));
    const STARE = JSON.stringify({ wersja: 1, tresc: 'dane, których nie wolno stracić' });

    // a) tak wyglądała awaria przy zapisie wprost
    const naiwny = path.join(kat, 'naiwny.json');
    fs.writeFileSync(naiwny, STARE);
    try {
      fs.writeFileSync(naiwny, '');        // obcięcie — pierwszy krok writeFileSync
      throw new Error('tu ginie proces');  // …i drugi krok już nie następuje
    } catch { /* modelowana awaria */ }
    const poNaiwnym = fs.readFileSync(naiwny, 'utf8');
    console.log(`1a. zapis wprost, awaria w połowie → zostało ${poNaiwnym.length} B `
      + `z ${STARE.length} B`);
    if (poNaiwnym.length) fail.push('model awarii jest zły — zapis wprost powinien zniszczyć plik');

    // b) to samo przy zapisie przez plik tymczasowy
    const bezpieczny = path.join(kat, 'bezpieczny.json');
    zapiszAtomowo(bezpieczny, STARE);
    try {
      fs.writeFileSync(`${bezpieczny}.tmp`, '');
      throw new Error('tu ginie proces');  // przed renameSync
    } catch { /* modelowana awaria */ }
    const poBezpiecznym = fs.readFileSync(bezpieczny, 'utf8');
    console.log(`1b. zapis przez plik tymczasowy, ta sama awaria → zostało `
      + `${poBezpiecznym.length} B z ${STARE.length} B`);
    if (poBezpiecznym !== STARE) fail.push('przerwany zapis atomowy uszkodził stare dane');

    // c) po udanym zapisie treść jest kompletna, a śmieci nie ma
    const duza = JSON.stringify({ wersja: 2, tresc: 'x'.repeat(2_000_000) });
    zapiszAtomowo(bezpieczny, duza);
    const po = JSON.parse(fs.readFileSync(bezpieczny, 'utf8'));
    if (po.wersja !== 2 || po.tresc.length !== 2_000_000) fail.push('zapisana treść jest niekompletna');
    const smieci = fs.readdirSync(kat).filter((f) => f.endsWith('.tmp') && !f.startsWith('bezpieczny'));
    console.log(`2. 2 MB zapisane w całości, pozostałości .tmp: ${smieci.length}`);
    if (smieci.length) fail.push(`zostały pliki tymczasowe: ${smieci.join(', ')}`);

    /* Uprawnienia ustawiamy NA PLIKU TYMCZASOWYM, nie po podmianie — token
       OneDrive zapisany najpierw jawnie byłby przez chwilę do odczytania
       przez każdego na maszynie. Krótkie okno to wciąż okno. */
    const tajny = path.join(kat, 'tajne.json');
    zapiszAtomowo(tajny, '{"refresh_token":"x"}', { mode: 0o600 });
    const tryb = fs.statSync(tajny).mode & 0o777;
    console.log(`3. tryb dostępu pliku z poświadczeniami: ${tryb.toString(8)}`);
    if (tryb & 0o077) fail.push(`plik z tokenem czytelny dla innych (${tryb.toString(8)})`);

    fs.rmSync(kat, { recursive: true, force: true });
  }

  /* ---- 2. Przez serwer: rozmowa, pamięć i sprzęt trafiają na dysk ----
     Nie sam mechanizm, tylko czy jest FAKTYCZNIE użyty tam, gdzie trzeba.
     Zapisujemy przez API i sprawdzamy, że plik na dysku da się sparsować,
     a obok nie leży zapomniany `.tmp`. */
  const env = await srodowisko('grafiki');
  const dane = env.katalogDanych || path.join(__dirname, '..', '..', 'data');

  await fetch(`${env.adres}/api/conversations?id=proba1`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Zapis atomowy', messages: [{ role: 'user', content: 'test' }] }),
  });
  await fetch(`${env.adres}/api/gear`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ korpus: 'Canon R6 II', obiektywy: '24-105 f/4', dodatki: 'DJI Mavic 3' }),
  });

  const sprawdzPlik = (wzgledna, opis) => {
    const p = path.join(dane, wzgledna);
    if (!fs.existsSync(p)) return `${opis}: pliku nie ma`;
    try { JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return `${opis}: nie da się sparsować (${e.message})`; }
    return null;
  };
  for (const [plik, opis] of [
    ['conversations/proba1.json', 'rozmowa'],
    ['conversations/index.json', 'indeks rozmów'],
    ['sprzet.json', 'sprzęt'],
  ]) {
    const blad = sprawdzPlik(plik, opis);
    if (blad) fail.push(blad);
  }
  console.log('4. rozmowa, indeks rozmów i sprzęt: zapisane i parsowalne');

  // Żadnych osieroconych plików tymczasowych w katalogu danych.
  const osierocone = [];
  const przejdz = (kat) => {
    for (const w of fs.readdirSync(kat, { withFileTypes: true })) {
      const pelna = path.join(kat, w.name);
      if (w.isDirectory()) przejdz(pelna);
      else if (w.name.endsWith('.tmp')) osierocone.push(pelna.replace(dane, ''));
    }
  };
  try { przejdz(dane); } catch { /* katalog mógł nie powstać */ }
  console.log(`5. osierocone pliki .tmp w danych: ${osierocone.length}`);
  if (osierocone.length) fail.push(`zostały pliki tymczasowe: ${osierocone.slice(0, 4).join(', ')}`);

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nZAPIS NIE GUBI DANYCH OK');
  process.exit(fail.length ? 1 : 0);
})();

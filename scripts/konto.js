#!/usr/bin/env node
/* Konta z wiersza poleceń – na wypadek, gdy do interfejsu nie da się wejść.

     node scripts/konto.js lista             kto ma konto
     node scripts/konto.js haslo <login>     nowe hasło (pyta, nie widać go w historii)

   Najczęstszy powód użycia: zapomniane hasło właściciela. `COSMOS_PASSWORD`
   w .env działa tylko przy pierwszym starcie, więc jego zmiana już nic nie da.

   SERWER MUSI BYĆ ZATRZYMANY. Cosmos trzyma listę kont w pamięci i przy
   najbliższym zapisie (np. ktoś się zaloguje) nadpisałby plik swoją wersją –
   nowe hasło zniknęłoby bez śladu. Dlatego skrypt sprawdza, czy serwer
   odpowiada, i odmawia, dopóki działa:

     sudo systemctl stop cosmos
     node scripts/konto.js haslo marcin
     sudo systemctl start cosmos
*/
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
require('../lib/rdzen.js'); // wczytuje .env (COSMOS_DATA_DIR, PORT)
const konta = require('../lib/konta.js');

const [, , polecenie, login] = process.argv;
const PORT = Number(process.env.PORT || 3000);

/* Wspólny bufor wejścia. Z potoku (`printf 'a\nb\n' | …`) oba wiersze przychodzą
   jednym kawałkiem – gdyby każde pytanie czytało osobno, drugie czekałoby
   w nieskończoność na dane, które już przyszły, a skrypt kończyłby się po
   cichu, bez zmiany hasła i bez słowa. */
let bufor = '';
const czekajacy = [];
let nasluchuje = false;
function oddajLinie() {
  while (czekajacy.length) {
    const i = bufor.search(/[\r\n]/);
    if (i < 0) return;
    const linia = bufor.slice(0, i);
    bufor = bufor.slice(bufor[i] === '\r' && bufor[i + 1] === '\n' ? i + 2 : i + 1);
    czekajacy.shift()(linia);
  }
}
function zapytajUkryte(pytanie) {
  process.stdout.write(pytanie);
  const wejscie = process.stdin;
  if (!nasluchuje) {
    nasluchuje = true;
    if (wejscie.isTTY) wejscie.setRawMode(true);
    wejscie.setEncoding('utf8');
    wejscie.on('data', (z) => {
      for (const c of z) {
        if (c === '\u0003') process.exit(130);                             // Ctrl+C
        if (c === '\u007f') { bufor = bufor.slice(0, -1); continue; }      // Backspace
        bufor += c;
      }
      oddajLinie();
    });
    wejscie.on('end', () => { if (czekajacy.length) { console.error('\nBrak danych na wejściu – nic nie zmieniono.'); process.exit(1); } });
  }
  wejscie.resume();
  return new Promise((gotowe) => {
    czekajacy.push((linia) => {
      process.stdout.write('\n');
      if (!czekajacy.length) { if (wejscie.isTTY) wejscie.setRawMode(false); wejscie.pause(); }
      gotowe(linia);
    });
    oddajLinie();
  });
}

async function serwerDziala() {
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/auth`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch { return false; }
}

(async () => {
  if (polecenie === 'lista') {
    const lista = konta.wszyscy();
    if (!lista.length) return console.log('Nie ma jeszcze żadnego konta (serwer założy konto właściciela przy starcie).');
    for (const u of lista) {
      console.log(`${u.login.padEnd(20)} ${u.rola.padEnd(11)} ${u.maHaslo ? 'hasło ustawione' : 'BEZ HASŁA'}  „${u.nazwa}"`);
    }
    return;
  }
  if (polecenie === 'haslo' && login) {
    if (await serwerDziala() && !process.argv.includes('--wymus')) {
      console.error(`Cosmos działa na porcie ${PORT}. Zatrzymaj go najpierw – inaczej nadpisze nowe hasło:\n`
        + '  sudo systemctl stop cosmos\n'
        + `  node scripts/konto.js haslo ${login}\n`
        + '  sudo systemctl start cosmos');
      process.exit(1);
    }
    const u = konta.poLoginie(login);
    if (!u) {
      console.error(`Nie ma konta „${login}". Dostępne: ${konta.wszyscy().map((x) => x.login).join(', ') || '(brak)'}`);
      process.exit(1);
    }
    const nowe = await zapytajUkryte(`Nowe hasło dla ${u.login} (min. ${konta.MIN_HASLO} znaków): `);
    const powtorz = await zapytajUkryte('Powtórz: ');
    if (nowe !== powtorz) { console.error('Hasła się różnią – nic nie zmieniono.'); process.exit(1); }
    try {
      await konta.ustawHaslo(u.id, nowe);
      const ile = konta.usunSesjeUzytkownika(u.id);
      console.log(`Hasło zmienione. Wylogowano urządzeń: ${ile}. Uruchom Cosmosa: sudo systemctl start cosmos`);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    return;
  }
  console.log('Użycie:\n  node scripts/konto.js lista\n  node scripts/konto.js haslo <login>');
  process.exit(polecenie ? 1 : 0);
})();

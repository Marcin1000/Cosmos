/* Odpowiedź przeżywa zamknięcie karty.

   Marcin: „Jak wychodzę ze strony lub aplikacji zainstalowanej czy to na
   desktopie czy na mobile to wszystko jest przerywane i jest napisane że
   connection error. Chciałbym żeby to działało wszystko też w tle jak Claude."

   Ten zestaw nie sprawdza, czy w kodzie jest napisane słowo „bieg". Sprawdza
   dokładnie to, co robił Marcin: zadaje pytanie, ZAMYKA kartę w połowie
   odpowiedzi i patrzy, czy odpowiedź istnieje.

   Trzy rzeczy, każda z osobna wystarczająca, żeby uznać funkcję za zepsutą:

     1. Zamknięcie karty nie przerywa czytania od modelu. Bieg kończy się sam.
     2. Odpowiedź, po którą nikt nie wrócił, ląduje w PLIKU ROZMOWY — inaczej
        „praca w tle" znaczy tylko tyle, że serwer grzał procesor.
     3. Powrót na stronę podpina się do trwającej odpowiedzi i dociąga ją do
        końca, zamiast pytać model drugi raz.

   Plus rzecz, o którą łatwo się potknąć przy takiej zmianie: przycisk Stop.
   Odkąd rozłączenie NIE przerywa generowania, przerwanie musi jawnie dolecieć
   do serwera — inaczej Stop tylko chowa kursor, a odpowiedź i tak dopisuje się
   do rozmowy.
*/
const fs = require('fs');
const path = require('path');
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

const spij = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const fail = [];
  const env = await srodowisko('tlo');
  const b = await przegladarka();

  /* Rozmowa czytana wprost z dysku serwera. Odpowiedź „w tle" musi być
     widoczna właśnie tam — to jedyne miejsce, które przeżywa zamkniętą kartę. */
  const zPliku = (id) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(env.katalogDanych, 'conversations', `${id}.json`), 'utf8'));
    } catch { return null; }
  };
  const ostatniaOdpowiedz = (id) => {
    const c = zPliku(id);
    if (!c) return null;
    const a = [...(c.messages || [])].reverse().find((m) => m.role === 'assistant');
    return a ? (typeof a.content === 'string' ? a.content : (a.content?.text || '')) : null;
  };

  // --- 1. Zadaj pytanie i ZAMKNIJ kartę w połowie odpowiedzi ---------------
  let pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await pg.goto(env.adres, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  await pg.fill('#input', 'pytanie w tle powoli');   // „powoli" = atrapa ciągnie kilka sekund
  await pg.press('#input', 'Enter');
  await pg.waitForTimeout(1200);

  const stan = await pg.evaluate(() => ({
    generuje: document.getElementById('stop-btn').style.display !== 'none',
    conv: window.localStorage.getItem('cosmos.bieg'),
    id: document.querySelectorAll('.msg-assistant').length,
  }));
  const zapisBiegu = stan.conv ? JSON.parse(stan.conv) : null;
  console.log(`1. generuje: ${stan.generuje}, zapamiętany bieg: ${zapisBiegu ? zapisBiegu.id.slice(0, 8) + '…' : 'BRAK'}`);
  if (!stan.generuje) fail.push('nie zaczęło generować — reszta zestawu nie ma czego mierzyć');
  if (!zapisBiegu || !zapisBiegu.id) {
    fail.push('przeglądarka nie zapamiętała numeru biegu — nie ma po czym wrócić');
  }
  const rozmowaId = zapisBiegu?.convId;

  const wTrakcie = ostatniaOdpowiedz(rozmowaId);
  console.log(`   odpowiedź w pliku PRZED zamknięciem karty: ${wTrakcie === null ? 'brak (dobrze)' : 'JEST'}`);

  await pg.close();                                   // ← to właśnie robił Marcin
  console.log('   karta zamknięta w połowie odpowiedzi');

  // --- 2. Serwer kończy sam i zapisuje odpowiedź --------------------------
  /* SIEROTA_MS w środowisku testowym jest skrócone (patrz env poniżej), więc
     nie czekamy tu pół minuty. */
  let wPliku = null;
  for (let i = 0; i < 40 && !wPliku; i++) {
    await spij(500);
    wPliku = ostatniaOdpowiedz(rozmowaId);
  }
  console.log(`2. odpowiedź zapisana bez udziału przeglądarki: ${wPliku ? `tak, ${wPliku.length} znaków` : 'NIE'}`);
  if (!wPliku) {
    fail.push('odpowiedź przepadła po zamknięciu karty — serwer nie dopisał jej do rozmowy');
  } else if (!/powoli/i.test(wPliku)) {
    fail.push(`zapisano coś innego niż odpowiedź modelu: „${wPliku.slice(0, 60)}"`);
  }

  // Żadnych dubli: jedna odpowiedź, nie dwie.
  const conv = zPliku(rozmowaId);
  const odpowiedzi = (conv?.messages || []).filter((m) => m.role === 'assistant');
  console.log(`   odpowiedzi asystenta w rozmowie: ${odpowiedzi.length}`);
  if (odpowiedzi.length > 1) {
    fail.push(`${odpowiedzi.length} odpowiedzi na jedno pytanie — zapis awaryjny dubluje treść`);
  }
  // Tę akurat MA zapisać serwer — przeglądarki już nie było.
  if (odpowiedzi.length && !odpowiedzi[0].bieg) {
    fail.push('odpowiedź w pliku nie pochodzi z zapisu awaryjnego — zestaw mierzy co innego, niż myśli');
  }

  // --- 3. Powrót na stronę widzi odpowiedź --------------------------------
  pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push(e.message));
  await pg.goto(env.adres, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(1500);
  await pg.evaluate((id) => window.localStorage.setItem('cosmos.lastConv', id), rozmowaId);
  // wejście w rozmowę z paska bocznego
  const weszlo = await pg.evaluate(async (id) => {
    const fn = window.selectConversation;
    if (typeof fn === 'function') { await fn(id); return true; }
    const el = document.querySelector(`.conv-item[data-id="${id}"]`);
    if (el) { el.click(); return true; }
    return false;
  }, rozmowaId);
  await pg.waitForTimeout(800);
  const naEkranie = await pg.evaluate(() =>
    [...document.querySelectorAll('.msg-assistant .msg-content')].map((e) => e.textContent.trim()));
  console.log(`3. po powrocie (wejście w rozmowę: ${weszlo}) widać ${naEkranie.length} odpowiedzi`);
  if (!naEkranie.some((x) => /powoli/i.test(x))) {
    fail.push('po powrocie na stronę odpowiedzi nie widać w rozmowie');
  }

  // --- 3b. Powrót do odpowiedzi, która WCIĄŻ TRWA -------------------------
  /* Punkt 3 sprawdzał odpowiedź już skończoną. Tu jest sytuacja trudniejsza
     i częstsza: telefon gasi ekran, strona się przeładowuje, a model jest
     w połowie zdania. Przeglądarka ma się podpiąć do TEJ SAMEJ odpowiedzi,
     a nie zapytać modelu drugi raz — druga odpowiedź kosztuje tokeny i bywa
     inna niż ta, którą użytkownik zdążył zobaczyć. */
  await pg.evaluate(() => { const b2 = document.getElementById('new-chat-btn'); if (b2) b2.click(); });
  await pg.waitForTimeout(400);
  await pg.fill('#input', 'pytanie z przeładowaniem powoli');
  await pg.press('#input', 'Enter');
  await pg.waitForTimeout(1200);
  const przedPrzeladowaniem = await pg.evaluate(() => {
    const s = window.localStorage.getItem('cosmos.bieg');
    return s ? JSON.parse(s) : null;
  });
  console.log(`3b. przeładowanie w trakcie; odebrane zdarzenia: ${przedPrzeladowaniem?.ostatnie ?? '—'}`);
  await pg.reload({ waitUntil: 'networkidle' });
  /* Czekamy na ODPOWIEDŹ W PLIKU, nie na zniknięcie kursora. Po przeładowaniu
     bez wznowienia kursor gaśnie od razu i zestaw zdążyłby zajrzeć do pliku
     przed zapisem awaryjnym serwera — czyli zobaczyłby „nic" i pokazał
     nieprawdziwą przyczynę. Zapis awaryjny ma prawo się spóźnić i musi zdążyć,
     bo to on odróżnia jedną awarię od drugiej. */
  for (let i = 0; i < 40; i++) {
    await pg.waitForTimeout(500);
    const c = przedPrzeladowaniem?.convId ? zPliku(przedPrzeladowaniem.convId) : null;
    if ((c?.messages || []).some((m) => m.role === 'assistant')) break;
  }
  await pg.waitForTimeout(1500);
  const poPrzeladowaniu = przedPrzeladowaniem?.convId ? zPliku(przedPrzeladowaniem.convId) : null;
  const odpowiedzi3b = (poPrzeladowaniu?.messages || []).filter((m) => m.role === 'assistant');
  const tresc3b = odpowiedzi3b.map((m) => (typeof m.content === 'string' ? m.content : '')).join('');
  /* KTO zapisał tę odpowiedź. To jedyna rzecz, która odróżnia „przeglądarka
     wróciła i dociągnęła" od „serwer zapisał sierotę, bo nikt nie wrócił" —
     bez tego rozróżnienia zestaw przechodziłby także wtedy, gdyby wznowienia
     w ogóle nie było. Znacznik `bieg` wstawia wyłącznie zapis awaryjny. */
  const ktoZapisal = odpowiedzi3b.some((m) => m.bieg) ? 'serwer (sierota)' : 'przeglądarka';
  console.log(`    po przeładowaniu: ${odpowiedzi3b.length} odpowiedzi, ${tresc3b.length} znaków, zapisał: ${ktoZapisal}`);
  if (odpowiedzi3b.length !== 1) {
    fail.push(`po przeładowaniu ${odpowiedzi3b.length} odpowiedzi zamiast jednej — bieg nie został podjęty`);
  }
  if (ktoZapisal !== 'przeglądarka') {
    fail.push('po przeładowaniu odpowiedź zapisał serwer awaryjnie — przeglądarka nie podpięła się do trwającego biegu');
  }
  /* Pełna odpowiedź atrapy ma ponad 600 znaków. Podpięcie, które dociąga tylko
     końcówkę albo gubi początek, da wyraźnie mniej — i to jest usterka, bo
     użytkownik zobaczy odpowiedź zaczynającą się w połowie zdania. */
  if (tresc3b.length < 600) {
    fail.push(`po przeładowaniu odpowiedź ma ${tresc3b.length} znaków zamiast pełnych ~611`);
  }

  // --- 4. Stop naprawdę przerywa ------------------------------------------
  /* Najłatwiejsza rzecz do zepsucia przy tej zmianie: Stop chowa kursor
     w przeglądarce, a serwer spokojnie dokańcza i dopisuje odpowiedź. */
  await pg.evaluate(() => { const b2 = document.getElementById('new-chat-btn'); if (b2) b2.click(); });
  await pg.waitForTimeout(400);
  await pg.fill('#input', 'drugie pytanie powoli');
  await pg.press('#input', 'Enter');
  await pg.waitForTimeout(1500);
  const drugi = await pg.evaluate(() => {
    const s = window.localStorage.getItem('cosmos.bieg');
    return s ? JSON.parse(s) : null;
  });
  await pg.click('#stop-btn');
  await pg.waitForTimeout(1200);
  const poStopie = drugi?.convId ? ostatniaOdpowiedz(drugi.convId) : null;
  const dlugoscPoStopie = poStopie ? poStopie.length : 0;
  await spij(4000);                       // gdyby serwer dalej czytał — dopisze
  const pozniej = drugi?.convId ? ostatniaOdpowiedz(drugi.convId) : null;
  console.log(`4. po Stopie: ${dlugoscPoStopie} znaków, cztery sekundy później: ${pozniej ? pozniej.length : 0}`);
  if (pozniej && dlugoscPoStopie && pozniejDluzsze(pozniej, dlugoscPoStopie)) {
    fail.push('Stop nie dotarł do serwera — odpowiedź rosła dalej po przerwaniu');
  }

  console.log(`5. błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  if (bledy.length) fail.push(`błędy JS: ${bledy.join(' | ')}`);

  await b.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPRACA W TLE OK');
  process.exit(fail.length ? 1 : 0);
})();

function pozniejDluzsze(tekst, byloZnakow) {
  return tekst.length > byloZnakow + 20;
}

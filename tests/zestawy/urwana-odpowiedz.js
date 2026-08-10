/* Odpowiedź urwana budżetem tokenów ma zostać DOKOŃCZONA.

   Marcin, o planie Majorki: „Wydaje mi się, że odpowiedź na końcu jest
   urwana. Nie chciałbym żeby odpowiedzi były urwane." I rzeczywiście —
   sekcja „Źródła:" kończyła się w środku adresu:

       [Majorka: 31 atrakcji…](https://www.gancarczyk.com/majorka-atrakcje-
       zwiedzanie-wynajem-samochodu

   To nie była awaria sieci ani błąd modelu. Model wyczerpał `max_tokens`
   i zakończył strumień z `finish_reason: "length"` — czyli powiedział wprost
   „nie skończyłem". Nikt tego pola nie czytał, więc kikut lądował w rozmowie
   jak gotowa odpowiedź.

   Sprawdzamy dwie rzeczy:
     1. Powód zakończenia jest CZYTANY, a urwana odpowiedź dociągana dalej.
     2. Sklejenie jest bezszwowe — „…wynajem-samochodu)" ma być jednym
        adresem, a nie dwoma kawałkami z dziurą albo spacją w środku.
*/
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

(async () => {
  const fail = [];
  const env = await srodowisko('pelne');
  const b = await przegladarka();
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push(e.message));
  await pg.goto(env.adres, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);

  await pg.fill('#input', 'daj plan, odpowiedź urwana');
  await pg.press('#input', 'Enter');
  for (let i = 0; i < 40; i++) {
    await pg.waitForTimeout(500);
    const trwa = await pg.evaluate(() => document.getElementById('stop-btn').style.display !== 'none');
    if (!trwa && i > 2) break;
  }
  await pg.waitForTimeout(500);

  const tresc = await pg.evaluate(() => {
    const w = [...document.querySelectorAll('.msg-assistant .msg-content')];
    return w.length ? w[w.length - 1].textContent.trim() : '';
  });
  console.log(`1. odpowiedź na ekranie: „${tresc.slice(0, 120)}"`);

  if (!/Gotowe\./.test(tresc)) fail.push('brakuje dalszego ciągu odpowiedzi — dociąganie nie zadziałało');

  /* Kikut kończył się w środku adresu, więc markdown w ogóle nie zamykał
     linku. Sprawdzamy ODNOŚNIK, nie tekst: tylko sklejony bez spacji adres
     da poprawny `href`. Gdyby dalszy ciąg doklejono ze spacją, „…wynajem-"
     i „samochodu)" rozjechałyby się na dwa kawałki i link by nie powstał. */
  const linki = await pg.evaluate(() =>
    [...document.querySelectorAll('.msg-assistant .msg-content a[href]')].map((a) => a.getAttribute('href')));
  console.log(`   odnośniki w odpowiedzi: ${JSON.stringify(linki)}`);
  const caly = linki.some((h) => /majorka-atrakcje-wynajem-samochodu$/.test(h || ''));
  if (!caly) {
    fail.push(`adres nie skleił się w całość — odnośniki: ${JSON.stringify(linki)}`);
  }

  /* Jedna wypowiedź, nie dwie. Dociąganie ma dawać JEDNĄ odpowiedź, a nie
     dwa dymki, z których pierwszy urywa się w pół słowa. */
  const ile = await pg.evaluate(() => document.querySelectorAll('.msg-assistant').length);
  console.log(`2. dymków odpowiedzi: ${ile}`);
  if (ile !== 1) fail.push(`${ile} dymki zamiast jednego — dociągnięty fragment nie został sklejony`);

  /* Instrukcja kontynuacji nie może zostać w rozmowie jako pytanie
     użytkownika — to ruch wewnętrzny, tak samo jak wyniki narzędzi. */
  const udajace = await pg.evaluate(() =>
    [...document.querySelectorAll('.msg-user .msg-content')]
      .map((e) => e.textContent).filter((x) => /Kontynuuj DOKŁADNIE/.test(x)).length);
  console.log(`3. instrukcji kontynuacji widocznych jako pytanie: ${udajace}`);
  if (udajace) fail.push('prośba o dokończenie pokazała się jako wiadomość użytkownika');

  /* Domyślny budżet. 2048 tokenów było za mało na rzeczy, o które Marcin
     realnie prosi — dociąganie to łata, a nie powód, żeby zostawić za ciasny
     domyślny limit. */
  const budzet = await pg.evaluate(() => {
    const el = document.getElementById('set-maxtokens');
    return el ? Number(el.value) : 0;
  });
  console.log(`4. domyślny budżet odpowiedzi: ${budzet} tokenów`);
  if (budzet < 4096) fail.push(`domyślny limit ${budzet} tokenów — za ciasny na plan czy scenariusz`);

  console.log(`5. błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  if (bledy.length) fail.push(`błędy JS: ${bledy.join(' | ')}`);

  await b.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nURWANA ODPOWIEDŹ OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Plener — foto i wideo jako jedno okno.

   Ten zestaw nie sprawdza „czy panel się otwiera". Sprawdza jedną rzecz,
   dla której panel w ogóle powstał: czy KAŻDA funkcja foto/wideo ma teraz
   drogę z interfejsu.

   Do tej pory było tak: sprzęt i archiwum w Ustawieniach, plan zdjęciowy
   w podpanelu podglądu kamery (czyli niedostępny bez włączonej kamery),
   aparat po Wi-Fi jako wiersz w tamtym podpanelu, a misja KMZ i karty ujęć
   — NIGDZIE. Te dwie dało się uruchomić wyłącznie żądaniem HTTP albo przez
   model, który sam zdecydował się użyć narzędzia. Funkcja, o której nie
   sposób się dowiedzieć, jest w praktyce funkcją, której nie ma, a bateria
   testów tego nie łapała: trasy odpowiadały, więc wszystko „działało".

   Stąd cztery sprawdzenia i każde odpowiada na inne pytanie:

     1. czy sprzęt zapisuje się i wraca (a nie tylko wygląda na zapisany),
     2. czy plan liczy się BEZ KAMERY, dla nazwy miejsca i wybranej godziny
        — to jest ta nowa zdolność, nie samo przeniesienie pola,
     3. czy karty ujęć docierają do ekranu z liczbami i z powodem pominięcia,
     4. czy misja daje PRAWDZIWY plik — sprawdzony cudzą implementacją,
        nie naszym własnym czytnikiem.

   Piąte sprawdzenie jest przeciwne w duchu: czy przeprowadzka niczego nie
   urwała po drodze. Ustawienia mają teraz ODSYŁAĆ do Pleneru, a nie milczeć.
*/
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { srodowisko, przegladarka, maPrzegladarke, KATALOG_ZRZUTOW } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

(async () => {
  const fail = [];
  const env = await srodowisko('grafiki');
  const b = await przegladarka();
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push(e.message));
  /* ZAPISANA LOKALIZACJA jest tu warunkiem koniecznym, nie ozdobą.
     Bez niej pierwsze, automatyczne przeliczenie planu przy otwarciu panelu
     kończy się błędem „nie znam współrzędnych" i pola misji zostają puste —
     a wtedy sprawdzenie z punktu 4 przechodzi nawet na zepsutym kodzie.
     Usterka, którą Marcin zobaczył na zrzucie ekranu, ujawnia się WYŁĄCZNIE
     wtedy, gdy jest zapisane miejsce inne niż to wpisane w planie. */
  await fetch(`${env.adres}/api/location`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: 'Złotokłos, mazowieckie', lat: 52.0247, lon: 20.9019 }),
  });

  await pg.goto(env.adres, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);

  /* ---- 0. Pozycja w menu istnieje i otwiera okno ---- */
  const etykieta = await pg.textContent('#plener-btn');
  console.log(`0. pozycja w menu: „${(etykieta || '').trim()}"`);
  if (!/Plener/.test(etykieta || '')) fail.push('brak pozycji „Plener" w panelu bocznym');
  await pg.click('#plener-btn');
  await pg.waitForTimeout(600);
  const otwarte = await pg.evaluate(() => document.getElementById('plener-modal').style.display !== 'none');
  if (!otwarte) fail.push('Plener się nie otworzył');

  /* ---- 1. Sprzęt: zapis i powrót ----
     Sprawdzamy przez `/api/gear`, a nie przez zawartość pól — pole pokazuje
     to, co samo w siebie wpisaliśmy, i potwierdziłoby zapis, którego nie ma. */
  await pg.fill('#gear-body', 'Canon R6 Mark II');
  await pg.fill('#gear-lenses', '24-105 f/4, 70-200 f/4, 50 f/1.8');
  // Celowo BEZ drona — w kroku 3 sprawdzamy, że go dopisanie coś zmienia.
  await pg.fill('#gear-extras', 'Ronin-S, statyw');
  await pg.click('#gear-save');
  await pg.waitForTimeout(900);
  const zapisany = await (await fetch(`${env.adres}/api/gear`)).json();
  console.log(`1. sprzęt na serwerze: ${zapisany.korpus} | ${zapisany.obiektywy} | ${zapisany.dodatki}`);
  if (!/R6 Mark II/.test(zapisany.korpus || '')) fail.push('korpus nie doszedł na serwer');
  if (!/70-200/.test(zapisany.obiektywy || '')) fail.push('obiektywy nie doszły na serwer');
  if (!/Ronin/.test(zapisany.dodatki || '')) fail.push('reszta sprzętu nie doszła na serwer');

  const potwierdzenie = await pg.textContent('#gear-status');
  console.log(`   potwierdzenie na ekranie: „${(potwierdzenie || '').trim()}"`);
  if (!(potwierdzenie || '').trim()) fail.push('zapis sprzętu nie powiedział człowiekowi, że się udał');

  /* 1b. Zapis, który się NIE UDAŁ, nie może wyglądać jak udany.
     Potwierdzenie „Zapisane." po odrzuconym żądaniu jest gorsze niż brak
     potwierdzenia: człowiek wychodzi przekonany, że sprzęt jest wpisany,
     a plan dalej liczy dla domyślnego korpusu. Blokujemy trasę w przeglądarce
     — serwer zostaje nietknięty, więc reszta zestawu działa normalnie. */
  await pg.route('**/api/gear', (trasa) => (trasa.request().method() === 'PUT'
    ? trasa.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"atrapa"}' })
    : trasa.continue()));
  await pg.fill('#gear-body', 'wpis, który nie ma prawa dojść');
  await pg.click('#gear-save');
  await pg.waitForTimeout(800);
  const poBledzie = (await pg.textContent('#gear-status') || '').trim();
  console.log(`1b. zapis odrzucony przez serwer → „${poBledzie}"`);
  if (/Zapisane|Saved/.test(poBledzie)) fail.push('nieudany zapis sprzętu udaje udany');
  if (!poBledzie) fail.push('nieudany zapis sprzętu nie zostawił żadnego śladu');
  await pg.unroute('**/api/gear');
  await pg.fill('#gear-body', 'Canon R6 Mark II');
  await pg.click('#gear-save');
  await pg.waitForTimeout(800);

  /* ---- 2. Plan BEZ KAMERY, dla miejsca i godziny ----
     To jest sedno wydzielenia. Wcześniej plan liczył się wyłącznie z podglądu
     kamery i wyłącznie dla „tu i teraz”; „co zabrać w sobotę do Krakowa na
     18:30" było pytaniem bez odpowiedzi w interfejsie. */
  const policz = async () => {
    await pg.click('#fp-go');
    await pg.waitForTimeout(1500);
    return {
      nastawy: (await pg.textContent('#fp-shot') || '').trim(),
      swiatlo: (await pg.textContent('#fp-light') || '').trim(),
    };
  };

  await pg.fill('#fp-place', 'Kraków');
  await pg.selectOption('#fp-mode', 'wideo');
  await pg.fill('#fp-topic', 'góry');
  await pg.fill('#fp-when', '2026-06-21T10:00');
  const dzien = await policz();
  console.log(`2. Kraków, 21.06 10:00 → „${dzien.nastawy}"`);
  console.log(`   światło: „${dzien.swiatlo.slice(0, 110)}"`);

  await pg.fill('#fp-when', '2026-06-21T20:15');
  const wieczor = await policz();
  console.log(`   Kraków, 21.06 20:15 → „${wieczor.nastawy}"`);
  console.log(`   światło: „${wieczor.swiatlo.slice(0, 110)}"`);

  if (!/1\/\d+/.test(dzien.nastawy)) fail.push(`plan nie podał czasu naświetlania: „${dzien.nastawy}"`);
  if (!/ISO/.test(dzien.nastawy)) fail.push('plan nie podał ISO');
  // 25 kl./s przy regule 180° to 1/50 — wideo musi dać inne liczby niż zdjęcie.
  if (!/1\/50/.test(dzien.nastawy)) fail.push(`przy 25 kl./s reguła 180° daje 1/50, jest „${dzien.nastawy}"`);
  /* Sedno: dwie RÓŻNE godziny mają dać dwa różne stany światła. Gdyby pole
     „kiedy" nie docierało do serwera, oba przebiegi policzyłyby „teraz"
     i wyszłyby identyczne — a taki błąd nie rzuca się w oczy na ekranie,
     bo obie odpowiedzi wyglądają rozsądnie. */
  const faza = (s) => (s.match(/^[^·(]+/) || [''])[0].trim();
  console.log(`   fazy: „${faza(dzien.swiatlo)}" vs „${faza(wieczor.swiatlo)}"`);
  if (faza(dzien.swiatlo) === faza(wieczor.swiatlo)) {
    fail.push('rano i wieczorem to samo światło — podana godzina nie dotarła do serwera');
  }
  if (!/wysoko|dzień|południe|złot|niebiesk|zmierzch|zachod|noc/i.test(dzien.swiatlo)) {
    fail.push(`plan nie nazwał fazy światła: „${dzien.swiatlo}"`);
  }

  /* ---- 3. Karty ujęć na ekranie, z filtrem sprzętowym ---- */
  const czytajUjecia = () => pg.evaluate(() => {
    const karty = [...document.querySelectorAll('.plener-shot')].map((k) => ({
      nazwa: k.querySelector('.plener-shot-name').textContent,
      liczby: k.querySelector('.plener-shot-nums').textContent,
    }));
    const pom = document.querySelector('.plener-skipped');
    return { karty, pominiete: pom ? pom.textContent : '' };
  });

  const bezDrona = await czytajUjecia();
  console.log(`3. ujęć na ekranie (bez drona): ${bezDrona.karty.length}`);
  for (const k of bezDrona.karty.slice(0, 4)) console.log(`   • ${k.nazwa} — ${k.liczby}`);
  if (!bezDrona.karty.length) fail.push('karty ujęć nie dotarły do ekranu — nadal są tylko w API');
  // Karta bez liczb to porada, nie plan. O to całe `lib/ujecia.js` chodziło.
  const bezLiczb = bezDrona.karty.filter((k) => !/\d+\s*mm/.test(k.liczby));
  if (bezLiczb.length) fail.push(`karty bez ogniskowej: ${bezLiczb.map((k) => k.nazwa).join(', ')}`);

  /* W górach bez drona ujęcia z powietrza MUSZĄ wypaść — i musi paść powód.
     „Nie ma na liście" i „nie masz czym" to dla planującego dzień dwie
     zupełnie różne informacje, a bez tej drugiej wygląda, jakby Cosmos
     o dronie po prostu zapomniał. */
  console.log(`   pominięte: „${bezDrona.pominiete.slice(0, 140)}"`);
  if (!/wymaga drona/.test(bezDrona.pominiete)) {
    fail.push('brak drona w zestawie nie został wytłumaczony na liście pominiętych');
  }

  /* 3b. Odhaczanie. „Lista do odhaczenia" bez sposobu odhaczenia byłaby
     obietnicą na wyrost, a postęp musi PRZEŻYĆ przeliczenie planu — w terenie
     przelicza się co chwilę, bo światło idzie. */
  await pg.locator('.plener-tick').first().check();
  await pg.waitForTimeout(200);
  const poOdhaczeniu = await pg.evaluate(() => ({
    przekreslone: document.querySelectorAll('.plener-shot.zrobione').length,
    licznik: document.querySelector('.plener-shots-title').textContent,
  }));
  console.log(`3b. odhaczone: ${poOdhaczeniu.przekreslone}, nagłówek: „${poOdhaczeniu.licznik.trim()}"`);
  if (!poOdhaczeniu.przekreslone) fail.push('odhaczenie ujęcia nic nie zmieniło na liście');
  if (!/odhaczone|ticked/.test(poOdhaczeniu.licznik)) fail.push('nagłówek nie liczy odhaczonych');

  await pg.click('#fp-go');
  await pg.waitForTimeout(1500);
  const poPrzeliczeniu = await pg.evaluate(() => document.querySelectorAll('.plener-shot.zrobione').length);
  console.log(`   po ponownym przeliczeniu planu odhaczone nadal: ${poPrzeliczeniu}`);
  if (!poPrzeliczeniu) fail.push('przeliczenie planu skasowało odhaczone ujęcia');

  // Dopisanie drona ma tę listę ZMIENIĆ — inaczej filtr jest ozdobą.
  await pg.fill('#gear-extras', 'DJI Mavic 3, Ronin-S, statyw');
  await pg.click('#gear-save');
  await pg.waitForTimeout(1600);
  const zDronem = await czytajUjecia();
  console.log(`   po dopisaniu Mavica: ${zDronem.karty.length} ujęć `
    + `(+${zDronem.karty.length - bezDrona.karty.length})`);
  if (zDronem.karty.length <= bezDrona.karty.length) {
    fail.push('dopisanie drona nie odblokowało żadnego ujęcia — filtr sprzętowy nie działa z panelu');
  }

  /* ---- 4. Misja drona → prawdziwy plik ----

     NAJPIERW najgroźniejsza pułapka, którą Marcin złapał na zrzucie ekranu.
     Panel liczy plan zaraz po otwarciu, dla zapisanej lokalizacji, i wtedy
     wypełnia pola misji. Potem człowiek wpisuje inne miejsce i przelicza —
     a w misji zostają STARE współrzędne. Wychodzi plik lotu nad zupełnie
     innym miejscem i nic tego nie zdradza.

     Odtwarzamy dokładnie tę ścieżkę: plan dla Krakowa policzony wyżej to już
     drugie przeliczenie w tym oknie, bo pierwsze poszło automatycznie przy
     otwarciu. Współrzędne w misji MUSZĄ pokazywać Kraków. */
  const misjaTeraz = {
    lat: await pg.inputValue('#mis-lat'),
    lon: await pg.inputValue('#mis-lon'),
    skad: (await pg.textContent('#mis-skad') || '').trim(),
  };
  console.log(`4. współrzędne misji po zmianie miejsca: ${misjaTeraz.lat}, ${misjaTeraz.lon}`);
  console.log(`   podpis pod polami: „${misjaTeraz.skad}"`);
  if (Math.abs(Number(misjaTeraz.lat) - 50.0614) > 0.01) {
    fail.push(`misja trzyma współrzędne sprzed zmiany miejsca: ${misjaTeraz.lat} zamiast 50.06`);
  }
  if (!/Krak/i.test(misjaTeraz.skad)) {
    fail.push(`podpis pod współrzędnymi nie mówi, skąd są: „${misjaTeraz.skad}"`);
  }

  /* Ręczny wpis musi WYGRAĆ z planem — inaczej nie da się polecieć nad
     miejscem innym niż to, dla którego liczy się światło. I musi być
     oznaczony, żeby nie wyglądał jak wynik planu. */
  await pg.fill('#mis-lat', '53.50000');
  await pg.waitForTimeout(200);
  await pg.click('#fp-go');
  await pg.waitForTimeout(1500);
  const poRecznym = {
    lat: await pg.inputValue('#mis-lat'),
    skad: (await pg.textContent('#mis-skad') || '').trim(),
  };
  console.log(`4b. po ręcznym wpisie i przeliczeniu planu: ${poRecznym.lat} — „${poRecznym.skad.slice(0, 60)}"`);
  if (Number(poRecznym.lat) !== 53.5) fail.push('przeliczenie planu nadpisało ręcznie wpisane współrzędne');
  if (!/ręcznie|hand/i.test(poRecznym.skad)) fail.push('ręczny wpis nie jest oznaczony');

  await pg.click('#mis-here');            // powrót do współrzędnych z planu
  await pg.waitForTimeout(400);
  const lat = await pg.inputValue('#mis-lat');
  const lon = await pg.inputValue('#mis-lon');
  console.log(`4c. „📍 Z planu" przywraca: ${lat}, ${lon}`);
  if (Math.abs(Number(lat) - 50.0614) > 0.01) fail.push(`„Z planu" wstawiło złą szerokość: ${lat}`);

  await pg.fill('#mis-name', 'Wawel nalot');
  await pg.fill('#mis-w', '200');
  await pg.fill('#mis-l', '300');
  await pg.fill('#mis-odstep', '50');
  const pobranie = pg.waitForEvent('download', { timeout: 15000 });
  await pg.click('#mis-go');
  let plik = '';
  try {
    const d = await pobranie;
    plik = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plener-')), d.suggestedFilename());
    await d.saveAs(plik);
  } catch (e) {
    fail.push(`misja się nie pobrała: ${e.message}`);
  }

  if (plik) {
    console.log(`   pobrano: ${path.basename(plik)}, ${(fs.statSync(plik).size / 1024).toFixed(1)} kB`);
    if (!/\.kmz$/.test(plik)) fail.push(`plik ma złe rozszerzenie: ${path.basename(plik)}`);
    /* Sprawdzamy CUDZĄ implementacją. Własnym czytnikiem dałoby się
       potwierdzić wyłącznie to, że umiemy odczytać to, co sami zapisaliśmy. */
    let kontrola = '';
    try {
      kontrola = execFileSync('python3', ['-c', `
import zipfile, xml.etree.ElementTree as ET
z = zipfile.ZipFile(${JSON.stringify(plik)})
assert z.testzip() is None, 'CRC nie zgadza sie'
assert z.namelist() == ['wpmz/template.kml', 'wpmz/waylines.wpml'], z.namelist()
k = ET.fromstring(z.read('wpmz/waylines.wpml'))
n = len(k.findall('.//{http://www.opengis.net/kml/2.2}Placemark'))
print('ZIP OK, punktow: %d' % n)
`], { encoding: 'utf8' }).trim();
    } catch (e) {
      kontrola = 'BŁĄD: ' + String(e.stderr || e.message).trim().split('\n').pop();
    }
    console.log(`   kontrola cudzą implementacją → ${kontrola}`);
    if (!/ZIP OK/.test(kontrola)) fail.push(`pobrany plik nie jest poprawnym KMZ: ${kontrola}`);
    // Pas 200 m przy odstępie 50 m to 5 linii, czyli 10 punktów.
    if (!/punktow: 10/.test(kontrola)) fail.push(`siatka z formularza dała złą liczbę punktów: ${kontrola}`);
    fs.rmSync(path.dirname(plik), { recursive: true, force: true });
  }

  const komunikat = (await pg.textContent('#mis-out') || '').trim();
  console.log(`   komunikat: „${komunikat}"`);
  if (!komunikat) fail.push('pobranie misji nie zostawiło żadnego śladu na ekranie');

  /* ---- 5. Aparat: brak konfiguracji nie zostawia martwego przycisku ----
     CANON_CCAPI_URL nie jest tu ustawione, więc wiersz ma być SCHOWANY.
     Widoczny przycisk „Ustaw w aparacie" u kogoś, kto nigdy nie włączył
     CCAPI, obiecywałby coś, czego nie ma. */
  /* Pytamy o to, co WIDAĆ, a nie o wartość właściwości `hidden`. Pierwsza
     wersja tego sprawdzenia czytała `w.hidden` i przechodziła — a na zrzucie
     ekranu wiersz stał jak gdyby nigdy nic, bo `.plan-camera { display: flex }`
     pokonuje regułę przeglądarki `[hidden] { display: none }`. Test, który
     potwierdza stan właściwości zamiast stanu ekranu, jest gorszy niż brak
     testu: daje spokój tam, gdzie usterka jest widoczna gołym okiem. */
  const aparat = await pg.evaluate(() => {
    const w = document.getElementById('plan-camera');
    const r = w.getBoundingClientRect();
    return {
      atrybut: w.hidden,
      naEkranie: r.width > 0 && r.height > 0 && getComputedStyle(w).display !== 'none',
    };
  });
  console.log(`5. aparat nieskonfigurowany → hidden=${aparat.atrybut}, widoczny=${aparat.naEkranie}`);
  if (!aparat.atrybut) fail.push('wiersz aparatu nie dostał atrybutu hidden mimo braku CANON_CCAPI_URL');
  if (aparat.naEkranie) fail.push('wiersz aparatu WIDAĆ mimo atrybutu hidden — CSS pokonuje [hidden]');

  /* A skoro już o tym mowa: żaden element z `hidden` w całym oknie nie ma
     prawa się rysować. To sprawdzenie klasowe, nie punktowe — bo błąd był
     klasowy i wróciłby przy następnym `display: flex`. */
  const widoczneMimoHidden = await pg.evaluate(() => [...document.querySelectorAll('[hidden]')]
    .filter((e) => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none')
    .map((e) => e.id || e.className || e.tagName)
    .slice(0, 8));
  console.log(`   elementy z hidden, które mimo to widać: ${widoczneMimoHidden.length ? widoczneMimoHidden.join(', ') : 'brak'}`);
  if (widoczneMimoHidden.length) fail.push(`hidden nie działa na: ${widoczneMimoHidden.join(', ')}`);
  // Podpowiedź, JAK go włączyć, ma zostać widoczna — inaczej nikt się nie dowie.
  const podpowiedz = await pg.textContent('#pl-sec-camera .field-hint');
  if (!/CANON_CCAPI_URL/.test(podpowiedz || '')) {
    fail.push('sekcja aparatu nie mówi, co ustawić, żeby zadziałał');
  }

  /* ---- 6. Archiwum przyjechało razem z resztą ---- */
  const arch = await pg.textContent('#arch-state');
  console.log(`6. archiwum w Plenerze: „${(arch || '').slice(0, 70)}"`);
  if (!arch || arch === '…') fail.push('panel archiwum nie pokazał stanu po przeprowadzce');

  await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/plener-1280.png`, fullPage: true });

  /* ---- 7. Ustawienia ODSYŁAJĄ, a nie milczą ----
     Sprzęt stał w Ustawieniach przez wiele miesięcy. Szukanie go tam jest
     odruchem i przeprowadzka bez drogowskazu wygląda jak usunięcie funkcji. */
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(300);
  await pg.click('#settings-btn');
  await pg.waitForTimeout(600);
  const wUstawieniach = await pg.evaluate(() => ({
    staryKorpus: Boolean(document.getElementById('set-body')),
    odsylacz: Boolean(document.getElementById('set-open-plener')),
  }));
  console.log(`7. Ustawienia: stare pole sprzętu ${wUstawieniach.staryKorpus ? 'ZOSTAŁO' : 'usunięte'}, `
    + `odsyłacz do Pleneru ${wUstawieniach.odsylacz ? 'jest' : 'BRAK'}`);
  if (wUstawieniach.staryKorpus) fail.push('sprzęt jest w dwóch miejscach naraz — dwa źródła prawdy');
  if (!wUstawieniach.odsylacz) fail.push('Ustawienia nie mówią, dokąd przeniósł się sprzęt');

  // Odsyłacz ma DZIAŁAĆ, a nie tylko istnieć.
  await pg.click('#set-open-plener');
  await pg.waitForTimeout(600);
  const przeskok = await pg.evaluate(() => ({
    plener: document.getElementById('plener-modal').style.display !== 'none',
    ustawienia: document.getElementById('settings-modal').style.display !== 'none',
  }));
  console.log(`   po kliknięciu: Plener ${przeskok.plener ? 'otwarty' : 'ZAMKNIĘTY'}, `
    + `Ustawienia ${przeskok.ustawienia ? 'NADAL OTWARTE' : 'zamknięte'}`);
  if (!przeskok.plener) fail.push('odsyłacz z Ustawień nie otwiera Pleneru');
  if (przeskok.ustawienia) fail.push('Ustawienia zostały otwarte pod Plenerem — dwa okna na sobie');

  console.log(`8. błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  if (bledy.length) fail.push(`błędy JS: ${bledy.join(' | ')}`);

  await b.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPLENER OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Zdjęcia znalezione w internecie – w TEJ SAMEJ odpowiedzi i bez kolejnej rundy modelu.

   Marcin poprosił o plan tygodniowej wycieczki na Majorkę, a potem „ze
   zdjęciami proszę". Dostał osiem zdjęć jednej katedry, komunikat
   „🖼️ Szukam zdjęć…" wiszący POD gotowymi zdjęciami – i ciszę.

   Runda 10 (zgłoszenia 3 i 4): „agenci działają, na koniec rozmowy wisi
   w poszukiwaniu zdjęć” i „zdjęcia jak w ChatGPT – w poziomym scrollu, a nie
   w oddzielnej odpowiedzi”. Po zdjęciach model dostawał jeszcze jedną rundę
   („ZDJĘCIA POKAZANE… napisz domknięcie albo nic”) – model myślący myślał nad
   nią pół minuty. Tę rundę usunęliśmy: dawny punkt 3 („po zdjęciach model
   dostaje głos”) pilnował właśnie usterki i jest teraz ODWRÓCONY.

     1. „Szukam zdjęć…” nie zostaje na ekranie, a paski mówią, czego dotyczą.
     2. Zdjęcia obu miejsc są – w jednej odpowiedzi, w paskach nad treścią.
     3. Po zdjęciach ZERO zapytań do modelu; pod odpowiedzią Kopiuj/Regeneruj,
        żadnego wiersza „dane dla modelu” na końcu.
     4. Jedno miejsce – jeden zestaw zdjęć (bez powtórki).
     5. Wynik narzędzia nie udaje pytania użytkownika.
     6. Kliknięcie w zdjęcie otwiera podgląd, a nie obcą stronę; strzałka →
        idzie do następnego zdjęcia.
*/
const { srodowisko, przegladarka, maPrzegladarke, KATALOG_ZRZUTOW } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

(async () => {
  const fail = [];
  const env = await srodowisko('grafikiWRozmowie');
  const b = await przegladarka();
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push(e.message));
  /* Atrapa grafik oddaje miniatury 1×1 – pasek odrzuca takie (piksel śledzący,
     ikonka), więc podstawiamy prawdziwą miniaturę 192×192. */
  const miniatura = require('fs').readFileSync(require('path').join(__dirname, '../../public/icons/cosmos-192.png'));
  await pg.route('**/api/search/thumb?*', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: miniatura }));
  await pg.goto(env.adres + '/app', { waitUntil: 'load' });
  await pg.waitForTimeout(600);

  let doModelu = 0;
  pg.on('request', (r) => { if (/\/api\/chat$/.test(r.url()) && r.method() === 'POST') doModelu++; });
  await pg.fill('#input', 'pokaż zdjęcia miejsc z planu');
  await pg.press('#input', 'Enter');

  for (let i = 0; i < 60; i++) {
    await pg.waitForTimeout(500);
    const trwa = await pg.evaluate(() => document.getElementById('stop-btn').style.display !== 'none');
    if (!trwa && i > 3) break;
  }
  await pg.waitForTimeout(800);

  const ekran = await pg.evaluate(() => ({
    teksty: [...document.querySelectorAll('.msg-assistant .msg-content')].map((e) => e.textContent.trim()),
    odpowiedzi: document.querySelectorAll('.msg-assistant').length,
    paski: [...document.querySelectorAll('.zdj-pasek')].map((p) => p.getAttribute('aria-label') || ''),
    etykiety: [...document.querySelectorAll('.zdj-etykieta')].map((e) => e.textContent.trim()),
    zdjecia: document.querySelectorAll('.zdj-kafel img').length,
    wToku: document.querySelectorAll('.zdj-pasek[aria-busy="true"], .zdj-kafel.szkielet').length,
    wiersze: [...document.querySelectorAll('.msg-search')].map((e) => e.textContent.trim()),
    akcjePodZdjeciami: [...document.querySelectorAll('.msg-assistant')].filter((m) => m.querySelector('.zdj-pasek'))
      .some((m) => m.querySelector('.msg-actions')),
  }));

  /* ---- 1. „Szukam zdjęć…" nie może zostać na ekranie ---- */
  const wiszace = ekran.teksty.filter((x) => /Szukam zdjęć/i.test(x));
  console.log(`1. komunikatów „Szukam zdjęć…" na ekranie: ${wiszace.length}, pasków w toku: ${ekran.wToku}`);
  if (wiszace.length || ekran.wToku) {
    fail.push('„Szukam zdjęć…" / szkielet wisi po znalezieniu zdjęć – stan w toku się nie domyka');
  }
  // Czego zdjęcia dotyczą – MUSI być widać: etykieta miejsca na pasku (dawniej podpis nad siatką).
  console.log(`   paski: ${ekran.paski.join(' | ') || 'BRAK'}; etykiety: ${ekran.etykiety.join(', ')}`);
  if (!ekran.etykiety.length) fail.push('po znalezieniu zdjęć nie ma żadnej informacji, czego dotyczą');

  /* ---- 2. Zdjęcia są, i to obu miejsc – w jednej odpowiedzi ---- */
  console.log(`2. zdjęć na ekranie: ${ekran.zdjecia}, odpowiedzi Cosmosa: ${ekran.odpowiedzi}`);
  if (ekran.zdjecia < 2) fail.push('zdjęcia nie dotarły na ekran');
  const oba = ['Katedra La Seu', 'Es Trenc'].filter((m) => ekran.etykiety.some((x) => x.includes(m)));
  console.log(`   miejsca na paskach: ${oba.join(', ') || 'żadne'}`);
  if (oba.length < 2) {
    fail.push(`z dwóch miejsc w prośbie na ekranie jest ${oba.length} – model dostał zdjęcia jednego`);
  }
  if (ekran.odpowiedzi !== 1) fail.push(`zdjęcia rozbiły odpowiedź na ${ekran.odpowiedzi} wiadomości – mają stać w jednej`);

  /* ---- 3. Po zdjęciach NIE MA kolejnej rundy modelu ----
     Dawniej: „ZDJĘCIA POKAZANE… napisz domknięcie albo nic” i druga runda –
     „wisi w poszukiwaniu zdjęć” ze zrzutu 4 Marcina. */
  console.log(`3. zapytań do modelu w turze: ${doModelu}; wiersze narzędzi: ${ekran.wiersze.length}; akcje pod odpowiedzią ze zdjęciami: ${ekran.akcjePodZdjeciami}`);
  if (doModelu !== 1) fail.push(`po zdjęciach model dostał kolejną rundę (zapytań: ${doModelu}) – to jest „wisi po zdjęciach”`);
  if (ekran.wiersze.some((x) => /Zdjęcia z sieci|grafik/i.test(x))) fail.push('na końcu odpowiedzi stoi wiersz „dane dla modelu” o zdjęciach');
  if (!ekran.akcjePodZdjeciami) fail.push('pod odpowiedzią ze zdjęciami nie ma Kopiuj/Zapamiętaj/Regeneruj');

  /* ---- 4. Powtórka odcięta: jeden zestaw zdjęć katedry, nie dwa ---- */
  const katedra = ekran.etykiety.filter((x) => x.trim() === 'Katedra La Seu Palma').length;
  console.log(`4. zestawów zdjęć tej samej katedry: ${katedra}`);
  if (katedra > 1) fail.push('te same zdjęcia pokazane dwa razy – odcinanie powtórek nie działa');

  /* ---- 5. Ruchy narzędzi nie udają pytań użytkownika ---- */
  const udajacePytania = await pg.evaluate(() =>
    [...document.querySelectorAll('.msg-user .msg-content')]
      .map((e) => e.textContent.trim())
      .filter((x) => /ZDJĘCIA POKAZANE|ZDJĘCIA TYCH MIEJSC|WYNIKI WYSZUKIWANIA/.test(x)));
  console.log(`5. ruchów narzędzi udających pytania użytkownika: ${udajacePytania.length}`);
  if (udajacePytania.length) fail.push('wynik narzędzia narysował się jako wiadomość użytkownika');

  /* ---- 6. Kliknięcie w zdjęcie otwiera podgląd, a nie obcą stronę ----
     Marcin: „lepiej by było gdybym mógł je kliknąć żeby się rozwinęły
     w większym ekranie z wyższą rozdzielczością i wtedy z możliwością
     przejścia do źródła – bo teraz jak klikam na zdjęcie to automatycznie
     przechodzę do linka z tym zdjęciem w kolejnej zakładce". */
  const kartPrzed = pg.context().pages().length;
  await pg.click('.zdj-kafel');
  await pg.waitForTimeout(400);
  const podglad = await pg.evaluate(() => {
    const box = document.getElementById('img-viewer');
    const img = document.getElementById('img-viewer-img');
    const zrodlo = document.getElementById('img-viewer-source');
    const podpis = document.getElementById('img-viewer-caption');
    return {
      widoczny: Boolean(box) && box.style.display !== 'none',
      src: img ? img.getAttribute('src') : '',
      zrodloWidoczne: Boolean(zrodlo) && !zrodlo.hidden,
      zrodloAdres: zrodlo ? zrodlo.getAttribute('href') : '',
      podpis: podpis && !podpis.hidden ? podpis.textContent.trim() : '',
    };
  });
  const kartPo = pg.context().pages().length;
  console.log(`6. po kliknięciu w zdjęcie: podgląd ${podglad.widoczny ? 'otwarty' : 'ZAMKNIĘTY'}, `
    + `nowych kart ${kartPo - kartPrzed}`);
  console.log(`   źródło: ${podglad.zrodloWidoczne ? podglad.zrodloAdres : 'BRAK'}`);
  console.log(`   podpis: „${podglad.podpis}"`);
  if (!podglad.widoczny) fail.push('kliknięcie w zdjęcie nie otwiera podglądu w Cosmosie');
  if (kartPo > kartPrzed) fail.push('kliknięcie w zdjęcie wyrzuca na obcą stronę w nowej karcie');
  if (!podglad.src) fail.push('podgląd otwarty bez obrazu');
  if (!podglad.zrodloWidoczne || !/^https?:/.test(podglad.zrodloAdres || '')) {
    fail.push('z podglądu nie da się przejść do źródła zdjęcia');
  }
  /* Podpis to nie ozdoba: przy zdjęciach z Commons nazwa serwisu i licencja
     są warunkiem legalnego użycia. */
  if (!podglad.podpis) fail.push('podgląd nie mówi, skąd jest zdjęcie ani na jakiej licencji');

  // Kilka zdjęć – strzałka prowadzi do następnego, licznik mówi, które to z ilu.
  const licznikPrzed = await pg.evaluate(() => document.getElementById('img-viewer-licznik').textContent);
  await pg.keyboard.press('ArrowRight');
  await pg.waitForTimeout(250);
  const licznikPo = await pg.evaluate(() => document.getElementById('img-viewer-licznik').textContent);
  console.log(`   licznik podglądu: „${licznikPrzed}” → strzałka → „${licznikPo}”`);
  if (!/1\D+\d/.test(licznikPrzed) || !/2\D+\d/.test(licznikPo)) fail.push('w podglądzie nie da się przejść do następnego zdjęcia (strzałka →)');
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(300);
  const poEscape = await pg.evaluate(() => document.getElementById('img-viewer').style.display !== 'none');
  console.log(`   Escape zamyka podgląd: ${poEscape ? 'NIE' : 'tak'}`);
  if (poEscape) fail.push('Escape nie zamyka podglądu zdjęcia');

  /* Instrukcje w promptcie (format źródeł, „jednym znacznikiem") sprawdza
     zestaw `szukanie-grafik` – tam stoi atrapa oddająca wiadomości systemowe
     jako treść, czyli jedyne miejsce, w którym widać, co model naprawdę
     dostaje. Tutaj mamy atrapę udającą model, nie echo. */

  await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/zdjecia-w-planie.png`, fullPage: true });
  console.log(`7. błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  if (bledy.length) fail.push(`błędy JS: ${bledy.join(' | ')}`);

  await b.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nZDJĘCIA W PLANIE OK');
  process.exit(fail.length ? 1 : 0);
})();

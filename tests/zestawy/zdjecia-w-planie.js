/* Zdjęcia znalezione w internecie mają WRÓCIĆ do rozmowy, a nie zawisnąć obok.

   Marcin poprosił o plan tygodniowej wycieczki na Majorkę, a potem „ze
   zdjęciami proszę". Dostał osiem zdjęć jednej katedry, komunikat
   „🖼️ Szukam zdjęć: Katedra La Seu Palma de Mallorca…" wiszący POD gotowymi
   zdjęciami — i ciszę. Pozostałe sześć dni planu nie doczekało się niczego,
   a zdjęcia nie zostały przypisane do żadnego przystanku.

   Trzy osobne usterki, trzy osobne sprawdzenia:

     1. Komunikat o trwającej czynności musi się DOMKNĄĆ. „Szukam…" pod
        gotowymi zdjęciami to informacja nieprawdziwa.
     2. Po pokazaniu zdjęć głos wraca do MODELU. Wcześniej pętla kończyła się
        tutaj (`break`) i model nie miał już jak powiedzieć, co to za miejsca.
     3. Powtórzona prośba o te same zdjęcia zostaje odcięta — inaczej model
        potrafi zjeść wszystkie rundy na jednej katedrze.

   Czwarta rzecz, z tej samej rozmowy: źródła. Model wypisywał „【1†L1-L4】",
   czyli zapis, w który nie da się kliknąć. Instrukcja musi podawać format.
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
  await pg.goto(env.adres, { waitUntil: 'load' });
  await pg.waitForTimeout(600);

  await pg.fill('#input', 'pokaż zdjęcia miejsc z planu');
  await pg.press('#input', 'Enter');

  // Trzy tury modelu plus dwa wyszukiwania — dajemy na to spokojnie czasu.
  for (let i = 0; i < 60; i++) {
    await pg.waitForTimeout(500);
    const trwa = await pg.evaluate(() => document.getElementById('stop-btn').style.display !== 'none');
    if (!trwa && i > 3) break;
  }
  await pg.waitForTimeout(800);

  const ekran = await pg.evaluate(() => ({
    teksty: [...document.querySelectorAll('.msg-assistant .msg-content')].map((e) => e.textContent.trim()),
    siatki: document.querySelectorAll('.photo-grid, .msg-photos').length,
    zdjecia: document.querySelectorAll('.msg-assistant img').length,
    ruchy: [...document.querySelectorAll('.msg-search')].length,
  }));

  /* ---- 1. „Szukam zdjęć…" nie może zostać na ekranie ---- */
  const wiszace = ekran.teksty.filter((x) => /Szukam zdjęć/i.test(x));
  console.log(`1. komunikatów „Szukam zdjęć…" na ekranie: ${wiszace.length}`);
  if (wiszace.length) {
    fail.push('„Szukam zdjęć…" wisi po znalezieniu zdjęć — komunikat o trwającej czynności się nie domyka');
  }
  /* Czego zdjęcia dotyczą — MUSI być widać. Kiedyś mówił o tym jeden zbiorczy
     komunikat („🖼️ Zdjęcia: Katedra La Seu, Es Trenc") nad wszystkimi siatkami
     naraz. Zniknął razem z galerią na końcu odpowiedzi: teraz każda siatka
     stoi pod swoim punktem planu i ma WŁASNY podpis. Gwarancja jest ta sama,
     nośnik inny — więc i sprawdzenie musi patrzeć na nośnik, który istnieje. */
  const podpisy = await pg.evaluate(() => [...document.querySelectorAll('.msg-assistant')]
    .filter((m) => m.querySelector('.photo-grid, .msg-photos'))
    .map((m) => (m.textContent || '').trim().slice(0, 60))
    .filter(Boolean));
  console.log(`   podpisów nad siatkami: ${podpisy.length} — ${podpisy.join(' | ') || 'BRAK'}`);
  if (!podpisy.length) fail.push('po znalezieniu zdjęć nie ma żadnej informacji, czego dotyczą');

  /* ---- 2. Zdjęcia są, i to obu miejsc ---- */
  console.log(`2. zdjęć na ekranie: ${ekran.zdjecia}, zestawów: ${ekran.siatki}`);
  if (ekran.zdjecia < 2) fail.push('zdjęcia nie dotarły na ekran');
  const oba = ['Katedra La Seu', 'Es Trenc'].filter((m) => ekran.teksty.some((x) => x.includes(m)));
  console.log(`   miejsca wymienione na ekranie: ${oba.join(', ') || 'żadne'}`);
  if (oba.length < 2) {
    fail.push(`z dwóch miejsc w prośbie na ekranie jest ${oba.length} — model dostał zdjęcia jednego`);
  }

  /* ---- 3. Model DOKOŃCZYŁ odpowiedź po zdjęciach ----
     To jest sedno zgłoszenia: zdjęcia bez słowa komentarza leżą obok planu
     zamiast być do niego przypisane. */
  const ostatni = ekran.teksty[ekran.teksty.length - 1] || '';
  console.log(`3. ostatnia wypowiedź Cosmosa: „${ostatni.slice(0, 80)}"`);
  if (!/Dzień 1/.test(ostatni)) {
    fail.push('po pokazaniu zdjęć model nie dostał głosu — zdjęcia zostały bez przypisania do planu');
  }

  /* ---- 4. Powtórka odcięta: jeden zestaw zdjęć katedry, nie dwa ---- */
  const katedra = ekran.teksty.filter((x) => x.trim() === 'Katedra La Seu Palma').length;
  console.log(`4. zestawów zdjęć tej samej katedry: ${katedra}`);
  if (katedra > 1) fail.push('te same zdjęcia pokazane dwa razy — odcinanie powtórek nie działa');

  /* ---- 5. Ruchy narzędzi siedzą w zwijanym bloku ----
     Wynik narzędzia z rolą `user` bez flagi `search` rysuje się jako pytanie,
     którego nikt nie zadał — to była osobna usterka i nie chcemy jej z powrotem. */
  const udajacePytania = await pg.evaluate(() =>
    [...document.querySelectorAll('.msg-user .msg-content')]
      .map((e) => e.textContent.trim())
      .filter((x) => /ZDJĘCIA POKAZANE|ZDJĘCIA TYCH MIEJSC|WYNIKI WYSZUKIWANIA/.test(x)));
  console.log(`5. ruchów narzędzi udających pytania użytkownika: ${udajacePytania.length}`);
  if (udajacePytania.length) fail.push('wynik narzędzia narysował się jako wiadomość użytkownika');

  /* ---- 6. Kliknięcie w zdjęcie otwiera podgląd, a nie obcą stronę ----
     Marcin: „lepiej by było gdybym mógł je kliknąć żeby się rozwinęły
     w większym ekranie z wyższą rozdzielczością i wtedy z możliwością
     przejścia do źródła — bo teraz jak klikam na zdjęcie to automatycznie
     przechodzę do linka z tym zdjęciem w kolejnej zakładce". */
  const kartPrzed = pg.context().pages().length;
  await pg.click('.photo-tile');
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

  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(300);
  const poEscape = await pg.evaluate(() => document.getElementById('img-viewer').style.display !== 'none');
  console.log(`   Escape zamyka podgląd: ${poEscape ? 'NIE' : 'tak'}`);
  if (poEscape) fail.push('Escape nie zamyka podglądu zdjęcia');

  /* Instrukcje w promptcie (format źródeł, „jednym znacznikiem") sprawdza
     zestaw `szukanie-grafik` — tam stoi atrapa oddająca wiadomości systemowe
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

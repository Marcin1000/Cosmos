/* Tryb głosowy słyszał sam siebie.

   Z rozmowy Marcina: Cosmos odpowiedział „jeśli potrzebujesz czegoś jeszcze,
   daj znać", po czym ta sama fraza wróciła jako JEGO PYTANIE i odpowiedział
   na nią ponownie. Osobno słowo budzące dublowało się w transkrypcji:
   „HejHejHej kosmosHej kosmos Co widzisz".

   Mechanizm: rozpoznawacz jest CIĄGŁY, więc kiedy Cosmos mówi, dalej
   transkrybuje — tyle że wyniki ignorujemy (`voiceDeaf`). Zostają jednak
   w `e.results`, a gałąź słowa budzącego czytała trzy OSTATNIE wyniki
   niezależnie od tego, czy były już widziane. Po skończonej wypowiedzi
   Cosmos odczytywał więc własne zdanie jako nowe polecenie.

   Testujemy to na sztucznym zdarzeniu `onresult` — prawdziwego mikrofonu
   w przeglądarce testowej nie ma, a i tak chodzi o logikę, nie o akustykę. */
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

/** Zbuduj obiekt udający zdarzenie SpeechRecognition. */
const ZDARZENIE = `(function (zdania, odIndeksu) {
  const wyniki = zdania.map((t) => { const r = [{ transcript: t }]; r.isFinal = true; return r; });
  wyniki.resultIndex = odIndeksu;
  return { results: Object.assign(wyniki, { length: wyniki.length }), resultIndex: odIndeksu };
})`;

(async () => {
  const env = await srodowisko('kontekst');
  const fail = [];
  const br = await przegladarka();
  const pg = await (await br.newContext()).newPage();
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push(e.message));
  await pg.goto(env.adres, { waitUntil: 'load' });
  await pg.waitForTimeout(400);

  /* Podstawiamy atrapę rozpoznawacza pod `getSR`, a potem uruchamiamy PRAWDZIWY
     `startVoiceRecognizer()`. Dzięki temu testujemy handler, który naprawdę
     działa w aplikacji, a nie jego kopię przepisaną do testu. */
  await pg.evaluate(`
    window.__zdarzenie = ${ZDARZENIE};
    window.__zadane = [];
    getSR = function () {
      return function () {
        return { lang: '', continuous: false, interimResults: false,
          start() {}, stop() {}, abort() {} };
      };
    };
    handleVoiceQuery = (t) => { window.__zadane.push(t); };
    voiceMode = true;
    voiceRec = null;
    startVoiceRecognizer();
    window.__onresult = (e) => voiceRec.onresult(e);
  `);
  const maHandler = await pg.evaluate(() => Boolean(voiceRec && voiceRec.onresult));
  if (!maHandler) {
    console.log('DO POPRAWY:\n- nie udało się podpiąć atrapy rozpoznawacza');
    await br.close(); env.koniec(); process.exit(1);
  }

  /* 1. Zwykłe wybudzenie: „Hej Kosmos, co widzisz" ma dać czyste pytanie,
     bez powtórzonego słowa budzącego. */
  await pg.evaluate(() => {
    voiceState = 'wake';
    voiceDeaf = false;
    voiceZuzyteDo = 0;
    const e = window.__zdarzenie(['Hej Kosmos', 'Hej Kosmos co widzisz w pokoju'], 0);
    voiceRec.__ostatniaDlugosc = e.results.length;
    window.__onresult(e);
  });
  let zadane = await pg.evaluate(() => window.__zadane);
  console.log(`1. wybudzenie → pytanie: „${zadane[0] || '(brak)'}"`);
  if (!zadane.length) fail.push('nie rozpoznał słowa budzącego');
  else {
    if (/hej\s*kosmos/i.test(zadane[0])) fail.push(`słowo budzące zostało w pytaniu: „${zadane[0]}"`);
    if (!/co widzisz/i.test(zadane[0])) fail.push(`zgubił treść pytania: „${zadane[0]}"`);
  }

  /* 2. SEDNO: Cosmos mówi, mikrofon to słyszy, a po zakończeniu wypowiedzi
     jego własne zdanie NIE MOŻE wrócić jako nowe pytanie. */
  await pg.evaluate(() => {
    window.__zadane = [];
    voiceState = 'wake';
    voiceZuzyteDo = 0;
    voiceRec.__ostatniaDlugosc = 0;

    // Cosmos zaczyna mówić: głuchniemy.
    voiceDeaf = true;
    const wTrakcie = window.__zdarzenie(
      ['Hej Kosmos', 'jeśli potrzebujesz czegoś jeszcze daj znać'], 0);
    voiceRec.__ostatniaDlugosc = wTrakcie.results.length;
    window.__onresult(wTrakcie);      // mikrofon słyszy własny głos Cosmosa

    // Wypowiedź skończona — wracamy do nasłuchu.
    startQueryListening();
    voiceState = 'wake';
    // Rozpoznawacz dosyła to samo, co już nagrał (typowe opóźnienie).
    window.__onresult(wTrakcie);
  });
  zadane = await pg.evaluate(() => window.__zadane);
  console.log(`2. po własnej wypowiedzi zadano pytań: ${zadane.length}`
    + (zadane.length ? ` → „${zadane[0]}"` : ''));
  if (zadane.length) fail.push(`SPRZĘŻENIE: Cosmos odpowiedział na własne słowa („${zadane[0]}")`);

  /* 3. Druga zapora: nawet gdy zdanie przejdzie przez znacznik (opóźnione
     rozpoznanie), askVoice ma odrzucić pytanie identyczne z odpowiedzią. */
  const odrzucone = await pg.evaluate(() => {
    window.__zadane = [];
    voiceState = 'wake';
    voiceDeaf = false;
    voiceOstatniaOdpowiedz = 'Dobrze, dam znać jeśli będę potrzebował czegoś jeszcze';
    askVoice('dobrze dam znać jeśli będę potrzebował czegoś jeszcze');
    return window.__zadane.length;
  });
  console.log(`3. echo własnej odpowiedzi przez askVoice → zadano: ${odrzucone}`);
  if (odrzucone) fail.push('askVoice przyjął zdanie identyczne z własną odpowiedzią');

  // 4. ale prawdziwe, inne pytanie ma przejść
  const przeszlo = await pg.evaluate(() => {
    window.__zadane = [];
    voiceOstatniaOdpowiedz = 'Dobrze, dam znać jeśli będę potrzebował czegoś jeszcze';
    askVoice('policz ile mam zdjęć z czerwca');
    return window.__zadane.length;
  });
  console.log(`4. normalne pytanie → zadano: ${przeszlo}`);
  if (!przeszlo) fail.push('zapora przed echem blokuje normalne pytania');

  // 5. porównywanie zdań nie może uznawać wszystkiego za echo
  const pary = await pg.evaluate(() => ({
    identyczne: toSamoZdanie('daj znać jeśli coś jeszcze', 'daj znać jeśli coś jeszcze'),
    rozne: toSamoZdanie('policz zdjęcia z czerwca', 'daj znać jeśli coś jeszcze'),
    krotkie: toSamoZdanie('tak', 'tak'),
  }));
  console.log(`5. porównanie zdań: identyczne=${pary.identyczne}, różne=${pary.rozne}, krótkie=${pary.krotkie}`);
  if (!pary.identyczne) fail.push('nie rozpoznaje identycznego zdania');
  if (pary.rozne) fail.push('uznaje różne zdania za echo — blokowałby normalne pytania');
  if (pary.krotkie) fail.push('blokuje krótkie odpowiedzi w rodzaju „tak"');

  /* 6. Druga strona tego samego medalu. Znacznik zużycia to INDEKS, a indeks
     nie jest stałym punktem odniesienia: rozpoznawacz potrafi zacząć numerować
     od zera bez `onend` (Chrome po dłuższej ciszy, Android po każdej domkniętej
     wypowiedzi). Pierwsza wersja zapory tego nie przewidywała i pytanie zadane
     zaraz po słowie budzącym wypadało poniżej znacznika — transkrypcja pusta,
     cisza nie miała czego wysłać. Zapora ma tłumić echo, nie własne pytania. */
  const poRestarcie = await pg.evaluate(() => {
    window.__zadane = [];
    voiceState = 'wake';
    voiceDeaf = false;
    oznaczZuzyte(null, 0);

    const budzenie = window.__zdarzenie(['hej kosmos'], 0);
    voiceRec.__ostatniaDlugosc = 1;
    window.__onresult(budzenie);
    const stanPoBudzeniu = voiceState;

    // Nowa lista, znów od indeksu 0 — dla kodu wygląda jak „nic nowego".
    const pytanie = window.__zdarzenie(['policz zdjęcia z czerwca'], 0);
    window.__onresult(pytanie);
    return { stanPoBudzeniu, transkrypcja: el.voiceTranscript.textContent, uslyszane: voiceHeard };
  });
  console.log(`6. po restarcie numeracji: stan=${poRestarcie.stanPoBudzeniu}, `
    + `transkrypcja=„${poRestarcie.transkrypcja}"`);
  if (poRestarcie.stanPoBudzeniu !== 'listening') fail.push('słowo budzące nie przełączyło w słuchanie');
  if (!/czerwca/.test(poRestarcie.uslyszane)) {
    fail.push('pytanie po restarcie numeracji przepadło — znacznik zużycia połknął świeży wynik');
  }

  /* 7. …a przy okazji słowo budzące nie może wsiąknąć w treść pytania. */
  const czyste = await pg.evaluate(() => bezSlowaBudzacego('Hej Hej kosmos Hej kosmos co widzisz'));
  console.log(`7. czyszczenie słowa budzącego → „${czyste}"`);
  if (/kosmos/i.test(czyste)) fail.push(`słowo budzące zostaje w treści: „${czyste}"`);
  if (!/co widzisz/.test(czyste)) fail.push(`czyszczenie zjadło pytanie: „${czyste}"`);
  if (/^hej/i.test(czyste)) fail.push(`sierota po słowie budzącym zostaje na początku: „${czyste}"`);
  // ale „hej" w środku zdania to już zwykłe słowo
  const wSrodku = await pg.evaluate(() => bezSlowaBudzacego('napisz mail zaczynający się od hej'));
  if (!/od hej$/.test(wSrodku)) fail.push(`ucina „hej" w środku zdania: „${wSrodku}"`);

  console.log(`8. błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  if (bledy.length) fail.push(`błędy JS: ${bledy.join(' | ')}`);

  await br.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nGŁOS BEZ SPRZĘŻENIA OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Jednostki czytane słowami, z polską odmianą.

   Zgłoszenie Marcina: „Stopnie Celsjusza czyta »degrisy« zamiast Celsjusza”.
   Lektor dostawał tekst dla oka („20 °C”) i każdy silnik mowy radził sobie
   z tym po swojemu: ElevenLabs po angielsku, Piper pomijał znak.

   1. Funkcja w Node: odmiana (1 stopień, 2 stopnie, 5 stopni, 20,5 stopnia),
      zakresy, minus, procenty, prędkość, zapis fotograficzny, skróty;
      zwykły tekst, daty i godziny bez zakresu bez zmian.
   2. W przeglądarce: tekst, który naprawdę idzie do lektora (stripForSpeech),
      ma już słowa zamiast znaków – po polsku i po angielsku, także plan
      zdjęciowy (f/, czas naświetlania, EV, zakres godzin, m, h, min).
*/
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { utworzProtokol } = require('../../public/protokol.js');
const { przegladarka, maPrzegladarke, czekajNa } = require('../pomoc');

const { jednostkiNaGlos } = utworzProtokol();
const fail = [];
const sprawdz = (wej, oczekiwane, jezyk = 'pl') => {
  const wyj = jednostkiNaGlos(wej, jezyk);
  const ok = wyj === oczekiwane;
  console.log(`${ok ? 'OK ' : 'ŹLE'} „${wej}” → „${wyj}”`);
  if (!ok) fail.push(`„${wej}”: „${wyj}” zamiast „${oczekiwane}”`);
};

sprawdz('Jutro 20 °C.', 'Jutro 20 stopni Celsjusza.');
sprawdz('Rano 1°C, w dzień 22 °C, wieczorem 20,5 °C.',
  'Rano 1 stopień Celsjusza, w dzień 22 stopnie Celsjusza, wieczorem 20,5 stopnia Celsjusza.');
sprawdz('W nocy -4 °C, a na szczycie −12 °C.', 'W nocy minus 4 stopnie Celsjusza, a na szczycie minus 12 stopni Celsjusza.');
sprawdz('Będzie 10–20 °C.', 'Będzie od 10 do 20 stopni Celsjusza.');
sprawdz('Od 10-20 °C.', 'Od 10 do 20 stopni Celsjusza.');
sprawdz('Szansa opadów 30%, wiatr 15 km/h.', 'Szansa opadów 30 procent, wiatr 15 kilometrów na godzinę.');
sprawdz('Azymut 103°, obiektyw 50 mm, 1013 hPa.', 'Azymut 103 stopnie, obiektyw 50 milimetrów, 1013 hektopaskali.');
sprawdz('Wiatr 12 m/s, 13 km do schroniska.', 'Wiatr 12 metrów na sekundę, 13 kilometrów do schroniska.');
// Tego nie wolno ruszyć: daty, godziny bez zakresu, słowa bez liczby, wideo „4K”.
sprawdz('2026-10-02, 07:24, km dalej, 100 procent, min. dwie osoby.', '2026-10-02, 07:24, km dalej, 100 procent, min. dwie osoby.');
sprawdz('Nagraj 4K 25p, 12.10.2026 o 18:05, COVID-19, 10 – 20 osób, 2 są tu.', 'Nagraj 4K 25p, 12.10.2026 o 18:05, COVID-19, 10 – 20 osób, 2 są tu.');
sprawdz('Zwykłe zdanie bez liczb, Ok. Dobrze.', 'Zwykłe zdanie bez liczb, Ok. Dobrze.');
sprawdz('It will be 20 °C and 1 °C at night, 30% rain.', 'It will be 20 degrees Celsius and 1 degree Celsius at night, 30 percent rain.', 'en');

/* Zapis fotograficzny (runda 5): plan zdjęciowy szedł do lektora jak dla oka –
   „f łamane przez dwa kropka osiem”, „es”, „em”, „ha”. Dawniej ten zestaw
   WYMAGAŁ, żeby „f/2.8, 1/250 s” zostało nietknięte. */
sprawdz('f/2.8, 1/250 s', 'f 2,8, 1/250 sekundy');
sprawdz('f/2.8, 1/250 s', 'f 2.8, 1/250 of a second', 'en');
sprawdz('Nocne niebo: f/2.8, 20 s, ISO 3200, EV −0,7. Dzień: f/8, 1/125 s, +1 EV.',
  'Nocne niebo: f 2,8, 20 sekund, ISO 3200, EV minus 0,7. Dzień: f 8, 1/125 sekundy, plus 1 EV.');
sprawdz('Przewyższenie 450 m, 1 km, czas 1 h 20 min, 2 l wody, 0,5 s, 1 s, 3 min.',
  'Przewyższenie 450 metrów, 1 kilometr, czas 1 godzina 20 minut, 2 litry wody, 0,5 sekundy, 1 sekunda, 3 minuty.');
sprawdz('Climb 450 m, 1 h 20 min, 1 s.', 'Climb 450 metres, 1 hour 20 minutes, 1 second.', 'en');
sprawdz('Balans 5600 K, plik 3,5 MB, 1568 px, 22 MB, 120 m n.p.m.',
  'Balans 5600 kelwinów, plik 3,5 megabajta, 1568 pikseli, 22 megabajty, 120 metrów nad poziomem morza.');
sprawdz('Złota godzina 6:41–7:25, niebieska od 17:48-18:31.', 'Złota godzina od 6:41 do 7:25, niebieska od 17:48 do 18:31.');
sprawdz('Golden hour 6:41–7:25.', 'Golden hour from 6:41 to 7:25.', 'en');
sprawdz('Ekspozycja 10–15 min.', 'Ekspozycja od 10 do 15 minut.');
// Minus zapisany półpauzą (tak piszą modele i polska typografia) ginął.
sprawdz('W nocy do –2 °C, rano –1°.', 'W nocy do minus 2 stopnie Celsjusza, rano minus 1 stopień.');
sprawdz('Dojście ~20 min, zejście ~1 h, ≈ 3 km, ± 10 zł.', 'Dojście około 20 minut, zejście około 1 godzina, około 3 kilometry, plus minus 10 zł.');
sprawdz('Walk ~20 min, ≈ 3 km, ± 2 °C.', 'Walk about 20 minutes, about 3 kilometres, plus or minus 2 degrees Celsius.', 'en');
// Skróty: Piper i głos systemowy czytały je literami („en pe”, „te jot”).
sprawdz('Np. ok. 2 godz. przed świtem, tj. o godz. 5:10, m.in. Wawel, kopce itp. Potem temp. 3 °C.',
  'Na przykład około 2 godziny przed świtem, to jest o godzinie 5:10, między innymi Wawel, kopce i tak dalej. Potem temperatura 3 stopnie Celsjusza.');
sprawdz('Wyjście trwa 2 godz. Potem od godz. 6 do godz. 9.', 'Wyjście trwa 2 godziny. Potem od godziny 6 do godziny 9.');
sprawdz('Bring layers, e.g. a fleece, i.e. warm.', 'Bring layers, for example a fleece, that is warm.', 'en');
sprawdz('Rock & roll, R&D.', 'Rock i roll, R i D.');
sprawdz('Rock & roll.', 'Rock and roll.', 'en');
sprawdz('2× szybciej.', '2 razy szybciej.');
// Resztki po tym, co wyciął stripForSpeech: selektor wariantu po „⚠︎” i wiszące „Szczegóły:”.
sprawdz('Uwaga\uFE0E budżet. Tak\uFE0F.', 'Uwaga budżet. Tak.');
sprawdz('Nastawy gotowe. Szczegóły:', 'Nastawy gotowe.');
sprawdz('Plan: świt o 6:41.', 'Plan: świt o 6:41.');

(async () => {
  if (!maPrzegladarke()) {
    console.log('\nPOMINIĘTE (część przeglądarkowa): brak Chromium');
  } else {
    const port = 3474;
    const srv = spawn('node', ['server.js'], {
      cwd: path.resolve(__dirname, '..', '..'), stdio: 'ignore', detached: true,
      env: { ...process.env, PORT: String(port), COSMOS_DATA_DIR: path.join(os.tmpdir(), `cosmos-cj-${Date.now()}`) },
    });
    try {
      await czekajNa(`http://127.0.0.1:${port}/api/config`);
      const b = await przegladarka();
      const pg = await b.newPage();
      await pg.goto(`http://127.0.0.1:${port}/app`, { waitUntil: 'load' });
      await pg.waitForFunction(() => typeof stripForSpeech === 'function');
      const pl = await pg.evaluate(() => stripForSpeech('**Jutro** w Złotokłosie do 20 °C, szansa opadów 40%.'));
      console.log(`\n2. do lektora (PL): „${pl}”`);
      if (!/20 stopni Celsjusza/.test(pl) || !/40 procent/.test(pl)) fail.push(`lektor dostaje „${pl}”`);
      if (/°|%/.test(pl)) fail.push('do lektora nadal idą znaki ° albo %');
      const plan = await pg.evaluate(() => stripForSpeech('**Nastawy:** f/2.8, 1/250 s, ISO 3200, EV −0,7.\n- Złota godzina 6:41–7:25\n- przewyższenie 450 m, 1 h 20 min'));
      console.log(`   plan do lektora (PL): „${plan}”`);
      if (/\/\d|\d\s*(?:s|m|h|min)\b|−|–/.test(plan.replace(/1\/250 sekundy/, ''))) fail.push(`plan do lektora z zapisem dla oka: „${plan}”`);
      const en = await pg.evaluate(() => { setLang('en'); return stripForSpeech('Up to 20 °C tomorrow.'); });
      console.log(`   do lektora (EN): „${en}”`);
      if (!/20 degrees Celsius/.test(en)) fail.push(`angielski lektor dostaje „${en}”`);
      await b.close();
    } finally {
      try { process.kill(-srv.pid); } catch { /* już nie żyje */ }
    }
  }
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nCZYTANIE JEDNOSTEK OK');
  process.exit(fail.length ? 1 : 0);
})();

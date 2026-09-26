/* Jednostki czytane słowami, z polską odmianą.

   Zgłoszenie Marcina: „Stopnie Celsjusza czyta »degrisy« zamiast Celsjusza”.
   Lektor dostawał tekst dla oka („20 °C”) i każdy silnik mowy radził sobie
   z tym po swojemu: ElevenLabs po angielsku, Piper pomijał znak.

   1. Funkcja w Node: odmiana (1 stopień, 2 stopnie, 5 stopni, 20,5 stopnia),
      zakresy, minus, procenty, prędkość; zwykły tekst bez zmian.
   2. W przeglądarce: tekst, który naprawdę idzie do lektora (stripForSpeech),
      ma już słowa zamiast znaków — po polsku i po angielsku.
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
// Tego nie wolno ruszyć: daty, godziny, przysłona, czas naświetlania, słowa.
sprawdz('f/2.8, 1/250 s, 2026-10-02, 07:24, km dalej, 100 procent.', 'f/2.8, 1/250 s, 2026-10-02, 07:24, km dalej, 100 procent.');
sprawdz('It will be 20 °C and 1 °C at night, 30% rain.', 'It will be 20 degrees Celsius and 1 degree Celsius at night, 30 percent rain.', 'en');

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

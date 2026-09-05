/* Płótno — dokument obok rozmowy, odpowiednik Canvas/Artifacts.
   Dla twórcy wideo: scenariusze i opisy, czyli teksty, które się REDAGUJE,
   a nie czyta raz.

   Cała wartość siedzi w poprawkach fragmentami. Model przepisujący przy
   każdej zmianie trzy tysiące słów jest wolny i za każdym razem coś gubi po
   drodze. Dlatego większość sprawdzeń dotyczy silnika SZUKAJ/ZAMIEŃ — w tym
   przypadków, w których MUSI odmówić. */
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

(async () => {
  const env = await srodowisko('kontekst');
  const fail = [];

  // 1. instrukcja dociera do dużego modelu, mały jej nie dostaje
  const promptDla = async (model) => {
    const r = await fetch(`${env.adres}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'cloud', model, messages: [{ role: 'user', content: 'x' }] }),
    });
    return r.text();
  };
  const duzy = await promptDla('nvidia/nemotron-3-super-120b-a12b');
  const maly = await promptDla('nvidia/nemotron-mini-4b-instruct');
  console.log(`1. instrukcja płótna: duży ${/PŁÓTNO/.test(duzy) ? 'ma' : 'BRAK'}, `
    + `mały ${/PŁÓTNO/.test(maly) ? 'MA (źle)' : 'nie ma'}`);
  if (!/NARZĘDZIE — PŁÓTNO/.test(duzy)) fail.push('duży model nie wie o płótnie');
  if (!/SZUKAJ/.test(duzy)) fail.push('brak instrukcji o poprawkach fragmentami');
  if (/NARZĘDZIE — PŁÓTNO/.test(maly)) fail.push('mały model dostał płótno');

  // --- silnik poprawek, sprawdzany w przeglądarce (tam żyje) ---
  const br = await przegladarka();
  const pg = await (await br.newContext()).newPage();
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push(e.message));
  await pg.goto(env.adres, { waitUntil: 'load' });

  const zmiana = (tekst, blok) => pg.evaluate(([t0, b]) => {
    const conv = { canvas: { title: 'T', text: t0 } };
    const wynik = window.__test_zastosuj(conv, b);
    return { wynik, tekst: conv.canvas.text };
  }, [tekst, blok]);

  // most do funkcji wewnętrznej — inaczej trzeba by ją eksportować tylko dla testu
  await pg.evaluate(() => { window.__test_zastosuj = zastosujZmianePlotna; });

  const SCENA = 'UJĘCIE 1\nDron wznosi się nad lasem.\n\nUJĘCIE 2\nZbliżenie na twarz.';

  // 2. zwykła podmiana
  let r = await zmiana(SCENA, '<<<<<<< SZUKAJ\nZbliżenie na twarz.\n=======\nZbliżenie na dłonie.\n>>>>>>> ZAMIEŃ');
  console.log(`2. podmiana → ok=${r.wynik.ok}, tekst zawiera „dłonie": ${/dłonie/.test(r.tekst)}`);
  if (!r.wynik.ok || !/dłonie/.test(r.tekst)) fail.push('zwykła podmiana nie zadziałała');
  if (/twarz/.test(r.tekst)) fail.push('stary fragment został w tekście');

  // 3. dwie poprawki naraz
  r = await zmiana(SCENA,
    '<<<<<<< SZUKAJ\nUJĘCIE 1\n=======\nSCENA 1\n>>>>>>> ZAMIEŃ\n'
    + '<<<<<<< SZUKAJ\nUJĘCIE 2\n=======\nSCENA 2\n>>>>>>> ZAMIEŃ');
  console.log(`3. dwie poprawki → ${r.wynik.ile} zmian`);
  if (r.wynik.ile !== 2) fail.push('nie naniósł obu poprawek naraz');

  /* 4. Fragment występujący DWA RAZY musi zostać odrzucony. Cicha podmiana
     pierwszego z brzegu potrafi zepsuć tekst tak, że nikt tego nie zauważy —
     a to jest dokument, nad którym ktoś pracuje godzinami. */
  r = await zmiana('Ala ma kota.\nAla ma psa.',
    '<<<<<<< SZUKAJ\nAla\n=======\nOla\n>>>>>>> ZAMIEŃ');
  console.log(`4. fragment dwuznaczny → ok=${r.wynik.ok} (${r.wynik.blad || ''})`);
  if (r.wynik.ok) fail.push('podmienił dwuznaczny fragment zamiast odmówić');
  if (r.tekst !== 'Ala ma kota.\nAla ma psa.') fail.push('tekst został ruszony mimo odmowy');

  // 5. fragment, którego nie ma
  r = await zmiana(SCENA, '<<<<<<< SZUKAJ\nUJĘCIE 9\n=======\nX\n>>>>>>> ZAMIEŃ');
  console.log(`5. fragment nieistniejący → ok=${r.wynik.ok}`);
  if (r.wynik.ok) fail.push('udał, że naniósł nieistniejący fragment');
  if (r.tekst !== SCENA) fail.push('tekst zmieniony mimo nieudanej poprawki');

  // 6. zła postać bloku
  r = await zmiana(SCENA, 'jakieś bzdury bez znaczników');
  console.log(`6. zła postać poprawki → ok=${r.wynik.ok}`);
  if (r.wynik.ok) fail.push('przyjął poprawkę bez bloku SZUKAJ/ZAMIEŃ');

  // 7. panel: ukryty bez płótna, widoczny z płótnem, znika po przełączeniu
  const widoczne = async () => pg.evaluate(() => !document.getElementById('canvas').hidden);
  console.log(`7. panel bez płótna widoczny: ${await widoczne()}`);
  if (await widoczne()) fail.push('panel płótna widoczny, choć nie ma dokumentu');

  await pg.evaluate(() => {
    const c = activeConv() || { messages: [] };
    c.canvas = { title: 'Scenariusz', text: 'treść' };
    pokazPlotno(c);
  });
  console.log(`8. panel z płótnem widoczny: ${await widoczne()}`);
  if (!await widoczne()) fail.push('panel nie pokazał się mimo dokumentu');
  const tytul = await pg.evaluate(() => document.getElementById('canvas-title').textContent);
  if (tytul !== 'Scenariusz') fail.push('zły tytuł w panelu');

  await pg.evaluate(() => pokazPlotno(null));
  console.log(`9. po przełączeniu rozmowy panel widoczny: ${await widoczne()}`);
  if (await widoczne()) fail.push('płótno zostało na ekranie po zmianie rozmowy');

  console.log(`10. błędy JS: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  if (bledy.length) fail.push('błędy JavaScriptu w interfejsie');

  await br.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPŁÓTNO OK');
  process.exit(fail.length ? 1 : 0);
})();

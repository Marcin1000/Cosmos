/* Zestaw sprzętu zapisany raz, używany zawsze.

   Marcin podał swoje szkła w rozmowie: 24-105 f/4, 70-200 f/4, 50 f/1.8.
   Nie ma powodu, żeby wpisywał je przy każdym pytaniu, ani żeby model je
   zgadywał — to są dane DLA NARZĘDZIA, nie tekst dla modelu, więc mieszkają
   osobno od profilu.

   Sprawdzamy dwie rzeczy, bo obie mogą zawieść niezależnie: że zapis jest
   używany, gdy w pytaniu nie padło żadne szkło, ORAZ że szkło podane wprost
   zawsze wygrywa — sprzęt bywa pożyczony, a jedno zdanie w czacie jest
   świeższe niż ustawienie sprzed miesiąca. */
const { srodowisko } = require('../pomoc');
(async () => {
  const env = await srodowisko('grafiki');
  const fail = [];
  // zapis zestawu
  const put = await fetch(`${env.adres}/api/gear`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ korpus: 'canon-r6ii', obiektywy: '24-105 f/4, 70-200 f/4, 50 f/1.8' }) });
  console.log('1. zapis zestawu → HTTP', put.status);
  const get = await (await fetch(`${env.adres}/api/gear`)).json();
  console.log('2. odczyt →', JSON.stringify(get));
  if (get.obiektywy !== '24-105 f/4, 70-200 f/4, 50 f/1.8') fail.push('zestaw nie został zapisany');

  // plan BEZ podania obiektywu — ma wziąć zapisany zestaw
  const r = await (await fetch(`${env.adres}/api/plan`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: 50.06, lon: 19.94, kiedy: '2026-06-21T10:00', tryb: 'zdjecie', temat: 'mecz' }) })).json();
  const powod = (r.ustawienia.powody || []).find((x) => /Liczę dla/.test(x)) || '';
  console.log('3. plan bez podanego szkła →', r.ustawienia.czas, r.ustawienia.przyslona, '|', powod.slice(0, 60));
  if (!/70-200/.test(powod)) fail.push('plan nie użył zapisanego zestawu');

  // podanie szkła w pytaniu MUSI wygrać z zapisem
  const r2 = await (await fetch(`${env.adres}/api/plan`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: 50.06, lon: 19.94, kiedy: '2026-06-21T10:00', tryb: 'zdjecie', temat: 'mecz', obiektyw: '300mm f/2.8' }) })).json();
  const powod2 = (r2.ustawienia.powody || []).find((x) => /Liczę dla/.test(x)) || '';
  console.log('4. szkło podane w pytaniu →', powod2.slice(0, 60));
  if (!/300/.test(powod2)) fail.push('pożyczone szkło z pytania nie wygrało z zapisem w Ustawieniach');

  /* 5. Korpus wpisany PO LUDZKU trafia we własny wpis katalogowy.
     Pole „Korpus" w Plenerze to pole tekstowe, więc Marcin wpisze tam
     „Canon R6 Mark II", a nie klucz `canon-r6ii`. Do niedawna kończyło się
     to komunikatem „Nie mam tego w katalogu" o aparacie, który stoi
     w katalogu pierwszy — i cichą utratą działki stabilizacji oraz drugiego
     zakresu wzmocnienia (ISO 800), czyli dokładnie tych liczb, dla których
     wpis katalogowy istnieje. */
  const { rozpoznajSprzet } = require('../../lib/ekspozycja.js');
  const zapisy = [
    ['Canon R6 Mark II', 'Canon R6 Mark II', false],
    ['EOS R6 II', 'Canon R6 Mark II', false],
    ['r6m2', 'Canon R6 Mark II', false],
    ['canon-r6ii', 'Canon R6 Mark II', false],
    ['DJI Mavic 3', 'DJI Mavic 3', false],
    ['Mavic 3 Pro', 'DJI Mavic 3', false],
    // Mini 3 ma matrycę 1/1.3", nie 4/3 — nie wolno mu podstawić Mavica 3.
    ['DJI Mini 3', null, true],
    // R6 pierwszej generacji to inny aparat i ma zostać zgadywany.
    ['Canon R6', null, true],
  ];
  const zle = [];
  for (const [wpis, oczekiwana, zgadywany] of zapisy) {
    const r = rozpoznajSprzet(wpis);
    const ok = r.zgadywany === zgadywany && (!oczekiwana || r.nazwa === oczekiwana);
    if (!ok) zle.push(`„${wpis}" → ${r.nazwa} (zgadywany: ${r.zgadywany})`);
  }
  console.log(`5. rozpoznanie korpusu z pola tekstowego: ${zapisy.length - zle.length}/${zapisy.length}`);
  if (zle.length) fail.push('źle rozpoznany sprzęt: ' + zle.join('; '));

  // Ta sama droga przez HTTP — pole z Pleneru leci prosto do `/api/plan`.
  await fetch(`${env.adres}/api/gear`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ korpus: 'Canon R6 Mark II', obiektywy: '24-105 f/4' }) });
  const r3 = await (await fetch(`${env.adres}/api/plan`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: 50.06, lon: 19.94, kiedy: '2026-06-21T10:00', tryb: 'zdjecie' }) })).json();
  const nieznany = (r3.ustawienia.powody || []).some((x) => /Nie mam .* w katalogu/.test(x));
  console.log(`6. „Canon R6 Mark II" z pola tekstowego → „nie mam w katalogu": ${nieznany}`);
  if (nieznany) fail.push('własny aparat Marcina nie trafił we własny wpis katalogowy');

  /* --- 7. SPRZĘT MA DOCIERAĆ TAKŻE DO MODELU ----------------------------
     Do tej pory znało go wyłącznie narzędzie planu. Model, pisząc nastawy
     z własnej wiedzy — a robi tak przy każdym „jak to ustawić", które nie
     uruchamia narzędzia — nie wiedział, co użytkownik ma w torbie.

     Marcin dostał w planie na Majorkę „f/2.8" przy pięciu różnych ujęciach,
     mając wyłącznie f/4 i jeden stały f/1.8. Rada, której nie da się
     wykonać, jest gorsza od braku rady: wygląda wiarygodnie, a orientujesz
     się dopiero na miejscu.

     Atrapa tego środowiska oddaje w treści odpowiedzi to, co dostała
     w wiadomościach systemowych — więc czytamy dokładnie to, co widzi model. */
  await fetch(`${env.adres}/api/gear`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      korpus: 'Canon R6 Mark II',
      obiektywy: 'RF 24-105 f/4, RF 70-200 f/4, RF 50 f/1.8',
      dodatki: 'DJI Mavic 3, Ronin-S',
    }) });
  const prompt = await (await fetch(`${env.adres}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', messages: [{ role: 'user', content: 'jak ustawić aparat' }] }),
  })).text();

  const maSzkla = /24-105 f\/4/.test(prompt) && /50 f\/1\.8/.test(prompt);
  const maKorpus = /Canon R6 Mark II/.test(prompt);
  const maDodatki = /Mavic 3/.test(prompt);
  const maZasade = /nie proponuj[\s\S]{0,80}przysłony jaśniejszej/i.test(prompt);
  console.log(`7. w prompcie modelu: korpus ${maKorpus ? 'jest' : 'BRAK'}, `
    + `obiektywy ${maSzkla ? 'są' : 'BRAK'}, dodatki ${maDodatki ? 'są' : 'BRAK'}, `
    + `zasada o przysłonie ${maZasade ? 'jest' : 'BRAK'}`);
  if (!maKorpus) fail.push('model nie dostaje korpusu użytkownika');
  if (!maSzkla) fail.push('model nie dostaje listy obiektywów — będzie zgadywał przysłonę');
  if (!maDodatki) fail.push('model nie dostaje dodatków (dron, gimbal) — zaproponuje ujęcia bez sprzętu');
  if (!maZasade) {
    fail.push('prompt podaje sprzęt, ale nie mówi, że nastawy mają się w nim mieścić — '
      + 'sama lista nie powstrzymała modelu przed „f/2.8" przy obiektywach f/4');
  }

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nZESTAW SPRZĘTU OK');
  process.exit(fail.length ? 1 : 0);
})();

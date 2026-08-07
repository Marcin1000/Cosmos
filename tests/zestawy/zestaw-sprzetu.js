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

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nZESTAW SPRZĘTU OK');
  process.exit(fail.length ? 1 : 0);
})();

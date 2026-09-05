/* Asystent planu zdjęciowego — wyróżnik Cosmosa.
   ChatGPT nie wie, gdzie stoisz, która jest u Ciebie godzina ani jaki masz
   sprzęt, więc na „jakie ustawienia" odpowiada ogólnikami. Tutaj są liczby.

   A skoro liczby, to muszą się ZGADZAĆ. Ten zestaw sprawdza je wobec faktów
   niezależnych od naszego kodu: astronomicznych godzin wschodu i zachodu pod
   Warszawą oraz reguły „słoneczne 16", którą zna każdy fotograf. */
const { srodowisko } = require('../pomoc');
const { swiatloDnia, pozycjaSlonca } = require('../../lib/slonce.js');
const { evZeSlonca, dobierz, orientacja, evZPomiaru } = require('../../lib/ekspozycja.js');

// Piaseczno, mazowieckie
const LAT = 52.2297;
const LON = 21.0122;
const hhmm = (d) => (d ? d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }) : '—');

(async () => {
  const fail = [];

  /* 1. Wschód i zachód w przesilenie letnie. Wartości astronomiczne dla tej
     szerokości to ok. 4:15 i 21:00 czasu lokalnego. Tolerancja 5 minut —
     dokładniej nie potrzebujemy, mniej dokładnie byłoby już zgadywaniem. */
  const lato = swiatloDnia(new Date('2026-06-21T12:00:00Z'), LAT, LON);
  const minuty = (d) => Number(hhmm(d).split(':')[0]) * 60 + Number(hhmm(d).split(':')[1]);
  console.log(`1. przesilenie letnie: wschód ${hhmm(lato.wschod)}, zachód ${hhmm(lato.zachod)}`);
  if (Math.abs(minuty(lato.wschod) - (4 * 60 + 15)) > 5) fail.push('zły wschód w przesilenie letnie');
  if (Math.abs(minuty(lato.zachod) - (21 * 60 + 0)) > 5) fail.push('zły zachód w przesilenie letnie');

  // 2. zima musi być wyraźnie krótsza — łapie pomylony znak deklinacji
  const zima = swiatloDnia(new Date('2026-12-21T12:00:00Z'), LAT, LON);
  const dlugosc = (s) => (s.zachod - s.wschod) / 3600000;
  console.log(`2. długość dnia: lato ${dlugosc(lato).toFixed(1)} h, zima ${dlugosc(zima).toFixed(1)} h`);
  if (dlugosc(lato) < 16 || dlugosc(lato) > 17.5) fail.push('zła długość dnia w lecie');
  if (dlugosc(zima) > 8.5 || dlugosc(zima) < 7) fail.push('zła długość dnia w zimie');

  // 3. Słońce w południe: latem wysoko, zimą nisko (61° i 14° dla tej szerokości)
  const poludnieLato = pozycjaSlonca(new Date('2026-06-21T10:30:00Z'), LAT, LON).wysokosc;
  const poludnieZima = pozycjaSlonca(new Date('2026-12-21T11:30:00Z'), LAT, LON).wysokosc;
  console.log(`3. Słońce w południe: lato ${poludnieLato.toFixed(1)}°, zima ${poludnieZima.toFixed(1)}°`);
  if (Math.abs(poludnieLato - 61.4) > 1.5) fail.push('zła wysokość Słońca w południe latem');
  if (Math.abs(poludnieZima - 14.6) > 1.5) fail.push('zła wysokość Słońca w południe zimą');

  // 4. faza światła nazwana poprawnie
  const zlota = swiatloDnia(new Date('2026-06-21T18:20:00Z'), LAT, LON);
  console.log(`4. 20:20 czasu lokalnego → ${zlota.faza} (${zlota.teraz.wysokosc}°)`);
  if (zlota.faza !== 'złota godzina') fail.push('nie rozpoznał złotej godziny');

  /* 5. Reguła „słoneczne 16": w pełnym słońcu poprawna ekspozycja to f/16
     przy czasie 1/ISO. To jest fakt spoza naszego kodu — jeśli nasz EV się
     z nim nie zgadza, wszystkie nastawy będą przesunięte. */
  const evPelneSlonce = evZeSlonca(60, 'bezchmurnie');
  console.log(`5. EV w pełnym słońcu: ${evPelneSlonce.toFixed(1)} (reguła 16 mówi ~15)`);
  if (Math.abs(evPelneSlonce - 15) > 0.8) fail.push('EV pełnego słońca odbiega od reguły „słoneczne 16"');

  /* 6. Wideo: czas ZAWSZE z reguły 180°, niezależnie od światła — i DOKŁADNIE
     1/(2×klatki), bez zaokrąglania do drabinki zdjęciowej.

     Ten test do niedawna sam wymuszał błąd: oczekiwał 1/60 przy 25 kl./s
     i 1/125 przy 50, bo tyle dawało zaokrąglenie do klasycznych czasów
     aparatu. Tyle że 1/60 przy 25 kl./s to kąt 150°, a nie 180 — i, co gorsze
     pod polską siecią 50 Hz, to czas, przy którym świetlówki i LED-y dają
     przewijające się pasy. W trybie filmowym aparat oferuje 1/50 i 1/100,
     więc nie ma czego zaokrąglać. Wykrył to zestaw `plener`, sprawdzający
     to samo od strony interfejsu. */
  for (const [klatki, oczekiwany] of [[24, '1/48'], [25, '1/50'], [50, '1/100'], [60, '1/120']]) {
    const r = dobierz(evZeSlonca(40), { sprzet: 'canon-r6ii', tryb: 'wideo', klatki });
    if (r.czas !== oczekiwany) fail.push(`wideo ${klatki} kl./s dało ${r.czas}, oczekiwano ${oczekiwany}`);
  }
  // 1/60 przy 60 kl./s nie jest wielokrotnością 1/100 — ma paść ostrzeżenie o migotaniu.
  const swietlowki = dobierz(evZeSlonca(40), { sprzet: 'canon-r6ii', tryb: 'wideo', klatki: 60 });
  console.log(`6a. wideo 60 kl./s → ${swietlowki.czas}, ostrzeżenie o 50 Hz: `
    + `${swietlowki.powody.some((p) => /50 Hz/.test(p))}`);
  if (!swietlowki.powody.some((p) => /50 Hz/.test(p))) {
    fail.push('60 kl./s bez ostrzeżenia o migotaniu pod siecią 50 Hz');
  }
  if (dobierz(evZeSlonca(40), { sprzet: 'canon-r6ii', tryb: 'wideo', klatki: 25 })
    .powody.some((p) => /50 Hz/.test(p))) {
    fail.push('25 kl./s straszy migotaniem, choć 1/50 jest właśnie czasem bezpiecznym');
  }

  const ciemno = dobierz(evZeSlonca(-10), { sprzet: 'canon-r6ii', tryb: 'wideo', klatki: 25 });
  console.log(`6. wideo 25 kl./s po ciemku → ${ciemno.czas} (czas nie może się zmienić)`);
  if (ciemno.czas !== '1/50') fail.push('po ciemku złamał regułę 180° zamiast podnieść ISO');
  if (ciemno.iso <= 100) fail.push('po ciemku nie podniósł ISO');

  /* 7. Południe + wideo = PRZEŚWIETLENIE, czyli filtr ND. To był realny błąd:
     pierwsza wersja miała odwrócony znak i przy Słońcu w zenicie radziła
     „weź statyw", zamiast „załóż ND". */
  const poludnie = dobierz(evZeSlonca(60), { sprzet: 'canon-r6ii', tryb: 'wideo', klatki: 25 });
  console.log(`7. południe, wideo → ${poludnie.czas} ${poludnie.przyslona} ISO ${poludnie.iso}, `
    + `różnica ${poludnie.roznicaEV} EV`);
  if (poludnie.roznicaEV <= 0) fail.push('nie wykrył prześwietlenia w pełnym słońcu');
  if (!poludnie.powody.some((p) => /ND/.test(p))) fail.push('nie zaproponował filtra ND');
  if (poludnie.powody.some((p) => /statyw|jaśniejszy obiektyw/.test(p))) {
    fail.push('przy prześwietleniu radzi statyw — znak różnicy znowu odwrócony');
  }

  // 8. po ciemku odwrotnie: brakuje światła, ND byłby bez sensu
  const noc = dobierz(evZeSlonca(-14), { sprzet: 'canon-r6ii', tryb: 'zdjecie', ogniskowa: 35 });
  console.log(`8. noc, zdjęcie → ${noc.czas} ${noc.przyslona} ISO ${noc.iso}, różnica ${noc.roznicaEV} EV`);
  if (noc.powody.some((p) => /ND/.test(p))) fail.push('po ciemku proponuje filtr ND');

  // 9. orientacja kadru — o to prosił Marcin wprost
  const pion = orientacja(1080, 1920);
  const poziom = orientacja(1920, 1080);
  console.log(`9. kadr: ${pion.uklad} ${pion.proporcje} / ${poziom.uklad} ${poziom.proporcje}`);
  if (pion.uklad !== 'pionowo' || pion.proporcje !== '9:16') fail.push('nie rozpoznał kadru pionowego');
  if (poziom.uklad !== 'poziomo' || poziom.proporcje !== '16:9') fail.push('nie rozpoznał kadru poziomego');

  // 10. pomiar jasności z telefonu przekłada się na EV
  const evJasno = evZPomiaru(0.45, { iso: 100, czasS: 1 / 500, przyslona: 1.8 });
  const evCiemno = evZPomiaru(0.45, { iso: 3200, czasS: 1 / 30, przyslona: 1.8 });
  console.log(`10. EV z pomiaru: jasno ${evJasno.toFixed(1)}, ciemno ${evCiemno.toFixed(1)}`);
  if (evJasno <= evCiemno) fail.push('pomiar jasności daje odwrotny kierunek');

  // --- przez API ---
  const env = await srodowisko('kontekst');

  const bezMiejsca = await fetch(`${env.adres}/api/plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  console.log(`11. bez lokalizacji → HTTP ${bezMiejsca.status}`);
  if (bezMiejsca.status !== 400) fail.push('bez współrzędnych nie tłumaczy, czego brakuje');

  await fetch(`${env.adres}/api/location`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: 'Piaseczno, mazowieckie', lat: LAT, lon: LON }),
  });
  const zapisane = await (await fetch(`${env.adres}/api/location`)).json();
  console.log(`12. współrzędne zapisane: ${JSON.stringify(zapisane.wspolrzedne)}`);
  if (!zapisane.wspolrzedne || Math.abs(zapisane.wspolrzedne.lat - LAT) > 0.001) {
    fail.push('współrzędne nie przeżyły zapisu');
  }

  const r = await fetch(`${env.adres}/api/plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kiedy: '2026-06-21T18:20:00Z', sprzet: 'canon-r6ii', tryb: 'wideo', klatki: 25, szerokosc: 1080, wysokosc: 1920 }),
  });
  const d = await r.json();
  console.log(`13. /api/plan → ${d.slonce.faza}, kadr ${d.kadr.uklad}, `
    + `${d.ustawienia.czas} ${d.ustawienia.przyslona} ISO ${d.ustawienia.iso}`);
  if (d.slonce.faza !== 'złota godzina') fail.push('API zgubiło fazę światła');
  if (d.kadr.uklad !== 'pionowo') fail.push('API zgubiło orientację kadru');
  if (typeof d.slonce.doZachoduMin !== 'number') fail.push('brak czasu do zachodu');

  // 14. model wie o narzędziu (i mały nadal go nie dostaje)
  const prompt = await (await fetch(`${env.adres}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', model: 'nvidia/nemotron-3-super-120b-a12b', messages: [{ role: 'user', content: 'x' }] }),
  })).text();
  console.log(`14. instrukcja [PLAN:] w promptcie: ${/PLAN ZDJĘCIOWY/.test(prompt) ? 'jest' : 'BRAK'}`);
  if (!/PLAN ZDJĘCIOWY/.test(prompt)) fail.push('model nie wie o planie zdjęciowym');
  if (!/NIE zgaduj tych liczb/.test(prompt)) fail.push('nic nie powstrzymuje modelu przed zgadywaniem godzin');

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPLAN ZDJĘCIOWY OK');
  process.exit(fail.length ? 1 : 0);
})();

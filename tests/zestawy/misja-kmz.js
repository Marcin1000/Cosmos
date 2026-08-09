/* Misja waypointowa dla DJI — plik KMZ w formacie WPML.

   `senses/flightplan.py` liczy wysokość, pokrycie i liczbę zdjęć, ale nie
   umiał oddać tego dronowi: plan zostawał liczbą na ekranie, którą trzeba
   było ręcznie przepisać na waypointy. KMZ zamyka tę pętlę.

   Ten zestaw sprawdza rzeczy, które da się rozstrzygnąć bez drona — i mówi
   wprost, czego nie da się:

     1. czy to JEST poprawny ZIP z poprawnym XML-em w środku (weryfikacja
        niezależną implementacją, nie naszą własną),
     2. czy geometria siatki się zgadza — liczba linii i długość trasy
        policzone z zewnątrz,
     3. czy bzdurne parametry są odrzucane PRZED lotem, a nie na lotnisku.

   ⚠ Czego ten zestaw NIE dowodzi: że DJI Fly ten plik przyjmie. Struktura
   WPML jest odtworzona z dokumentacji i otwartych generatorów, ale przez
   prawdziwego drona nie przeszła. Rozstrzygnie to import i podniesienie
   maszyny — i dopóki to nie nastąpi, nie wolno tego podawać jako pewnika.
*/
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { misjaKmz, siatka } = require('../../lib/kmz.js');

/** Odległość w metrach — do sprawdzenia geometrii siatki z zewnątrz. */
function metry(a, b) {
  const R = 6371000;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

(async () => {
  const fail = [];

  /* ---- 1. Geometria siatki, sprawdzona liczbami ----
     Pas 200 m szeroki z odstępem 50 m to 5 linii (0, 50, 100, 150, 200),
     czyli 10 punktów — po dwa końce na linię. */
  const p = siatka({ lat: 53.5, lon: 22.6, szerokoscM: 200, dlugoscM: 300, odstepM: 50 });
  console.log(`1. pas 200×300 m, odstęp 50 m → ${p.length} punktów`);
  if (p.length !== 10) fail.push(`siatka dała ${p.length} punktów zamiast 10`);

  // Długość pierwszej linii musi wyjść 300 m — to sprawdza całą trygonometrię.
  const linia = metry(p[0], p[1]);
  console.log(`2. długość pierwszej linii: ${linia.toFixed(0)} m (oczekiwane 300)`);
  if (Math.abs(linia - 300) > 5) fail.push(`linia ma ${linia.toFixed(0)} m zamiast 300`);

  // Odstęp między liniami: koniec pierwszej i początek drugiej dzieli 50 m.
  const odstep = metry(p[1], p[2]);
  console.log(`3. odstęp między liniami: ${odstep.toFixed(0)} m (oczekiwane 50)`);
  if (Math.abs(odstep - 50) > 3) fail.push(`odstęp ${odstep.toFixed(0)} m zamiast 50`);

  /* „Wąż": co druga linia w przeciwną stronę. Bez tego powrót na początek
     każdej linii to przelot na pusto — przy dziesięciu liniach po 300 m
     trzy kilometry baterii wyrzucone. */
  /* Przy kierunku 0 linie biegną wschód-zachód, więc wzdłuż nich zmienia się
     DŁUGOŚĆ, nie szerokość. Pierwsza wersja tego sprawdzenia patrzyła na `lat`
     i zawsze widziała zero — czyli nie sprawdzała niczego. */
  const kierunek1 = p[1].lon - p[0].lon;
  const kierunek2 = p[3].lon - p[2].lon;
  console.log(`4. druga linia w przeciwną stronę: ${kierunek1 * kierunek2 < 0}`);
  if (kierunek1 * kierunek2 >= 0) fail.push('linie idą w tę samą stronę — brak „węża", bateria marnowana');

  /* Obrót siatki. Przy kierunku 90° linie mają biec z południa na północ,
     czyli różnica długości geograficznej wzdłuż linii ma zniknąć. */
  const obrocona = siatka({ lat: 53.5, lon: 22.6, szerokoscM: 100, dlugoscM: 200, odstepM: 50, kierunek: 90 });
  const wzdluzLat = Math.abs(obrocona[1].lat - obrocona[0].lat);
  const wzdluzLon = Math.abs(obrocona[1].lon - obrocona[0].lon);
  console.log(`5. siatka obrócona o 90° → wzdłuż linii Δlat ${wzdluzLat.toFixed(5)}, Δlon ${wzdluzLon.toFixed(5)}`);
  if (wzdluzLat < wzdluzLon) fail.push('obrót o 90° nie zmienił kierunku linii');

  /* ---- 2. Czy to jest prawdziwy ZIP z prawdziwym XML-em ----
     Sprawdzamy CUDZĄ implementacją — Pythonowym `zipfile` i parserem XML.
     Własnym kodem dałoby się potwierdzić wyłącznie to, że umiemy odczytać
     to, co sami zapisaliśmy, a to nie jest żaden dowód. */
  const kmz = misjaKmz(p, { wysokosc: 80, predkosc: 6, nazwa: 'Biebrza — nalot' });
  const plik = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kmz-')), 'misja.kmz');
  fs.writeFileSync(plik, kmz);
  console.log(`6. KMZ: ${(kmz.length / 1024).toFixed(1)} kB`);

  let sprawdzenie = '';
  try {
    sprawdzenie = execFileSync('python3', ['-c', `
import zipfile, xml.etree.ElementTree as ET, sys
z = zipfile.ZipFile(${JSON.stringify(plik)})
assert z.testzip() is None, 'CRC nie zgadza sie'
nazwy = z.namelist()
assert nazwy == ['wpmz/template.kml', 'wpmz/waylines.wpml'], nazwy
punktow = 0
for n in nazwy:
    korzen = ET.fromstring(z.read(n))
    punktow = len(korzen.findall('.//{http://www.opengis.net/kml/2.2}Placemark'))
    assert punktow > 0, n + ': brak punktow'
print('ZIP OK, XML OK, punktow: %d' % punktow)
`], { encoding: 'utf8' }).trim();
  } catch (e) {
    sprawdzenie = 'BŁĄD: ' + String(e.stderr || e.message).trim().split('\n').pop();
  }
  console.log(`7. weryfikacja cudzą implementacją → ${sprawdzenie}`);
  if (!/ZIP OK/.test(sprawdzenie)) fail.push(`plik nie przechodzi kontroli: ${sprawdzenie}`);
  if (!/punktow: 10/.test(sprawdzenie)) fail.push('liczba punktów w pliku nie zgadza się z misją');

  const tekst = kmz.toString('latin1');
  for (const [czego, wzorzec] of [
    ['wysokość względem punktu startu', /relativeToStartPoint/],
    ['układ WGS84', /WGS84/],
    ['akcja „zrób zdjęcie"', /takePhoto/],
    ['powrót do domu po locie', /<wpml:finishAction>goHome</],
    ['zadana wysokość 80 m', /<wpml:executeHeight>80</],
    ['zadana prędkość 6 m\/s', /<wpml:autoFlightSpeed>6</],
  ]) {
    if (!wzorzec.test(tekst)) fail.push(`w pliku brakuje: ${czego}`);
  }
  console.log('8. treść misji: wysokość względna, WGS84, zdjęcia w punktach, powrót do domu');

  /* Numeracja punktów MUSI być ciągła od zera — dziura jest dla aplikacji
     błędem pliku, nie brakiem punktu. */
  const indeksy = [...tekst.matchAll(/<wpml:index>(\d+)</g)].map((m) => Number(m[1]));
  const wSzablonie = indeksy.slice(0, indeksy.length / 2);
  const ciagla = wSzablonie.every((n, i) => n === i);
  console.log(`9. numeracja punktów ciągła od zera: ${ciagla} (${wSzablonie.join(',')})`);
  if (!ciagla) fail.push(`numeracja punktów z dziurą: ${wSzablonie.join(',')}`);

  /* ---- 3. Bzdury odrzucane PRZED lotem ---- */
  const odmowy = [];
  for (const [opis, wywolaj] of [
    ['jeden punkt', () => misjaKmz([{ lat: 53.5, lon: 22.6 }])],
    ['sto punktów', () => misjaKmz(Array.from({ length: 100 }, () => ({ lat: 53.5, lon: 22.6 })))],
    ['wysokość 900 m', () => misjaKmz(p, { wysokosc: 900 })],
    ['prędkość 40 m/s', () => misjaKmz(p, { predkosc: 40 })],
    ['odstęp zero', () => siatka({ lat: 53.5, lon: 22.6, szerokoscM: 100, dlugoscM: 100, odstepM: 0 })],
  ]) {
    try { wywolaj(); odmowy.push(`${opis}: PRZESZŁO`); }
    catch (e) { odmowy.push(`${opis}: „${e.message.slice(0, 45)}"`); }
  }
  console.log('10. odrzucone przed lotem:\n    ' + odmowy.join('\n    '));
  const przeszly = odmowy.filter((o) => /PRZESZŁO/.test(o));
  if (przeszly.length) fail.push(`bzdurne parametry przeszły: ${przeszly.join('; ')}`);

  // Punkty bez współrzędnych wypadają, zamiast trafić do pliku jako NaN.
  const zeSmieciem = misjaKmz([...p, { lat: null, lon: 'x' }, {}]);
  const ilePunktow = (zeSmieciem.toString('latin1').match(/<wpml:index>/g) || []).length / 2;
  console.log(`11. dwa uszkodzone punkty dorzucone do dziesięciu → w pliku ${ilePunktow}`);
  if (ilePunktow !== 10) fail.push(`uszkodzone punkty trafiły do misji (${ilePunktow} zamiast 10)`);

  fs.rmSync(path.dirname(plik), { recursive: true, force: true });
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nMISJA KMZ OK');
  process.exit(fail.length ? 1 : 0);
})();

/* „Pokaż zdjęcia, które wykonałem rano i wieczorem w Krakowie."

   Marcin zapytał wprost, czy to zadziała — i odpowiedź brzmiała „nie", z pięciu
   niezależnych powodów. Ten zestaw pilnuje każdego z nich osobno, bo każdy
   mógł zawieść sam:

     1. PORA DNIA nie istniała. Filtr światła ma „złotą godzinę", ale rano
        i wieczorem to ta sama wartość — prośby nie dało się wyrazić.
     2. MIEJSCE po nazwie nie działało: indeks trzyma współrzędne, nie nazwy,
        więc „w Krakowie" nie miało się o co zaczepić.
     3. TEMAT („ptaki", „ślub", „góry") nie był nigdzie zapisany.
     4. MINIATURY z OneDrive wygasają — zapisane przy indeksowaniu byłyby
        martwe w chwili pytania.
     5. Archiwum w ogóle nie POKAZYWAŁO zdjęć, tylko o nich pisało.

   Do tego drugie pytanie Marcina: temat ma wpływać na plan zdjęciowy, a sprzęt
   ma być dowolny, bo „zawsze mogę go zmienić".
*/
const { srodowisko } = require('../pomoc');
const { rozpoznajTemat } = require('../../lib/tematy.js');
const { dobierz, evZeSlonca, rozpoznajSprzet } = require('../../lib/ekspozycja.js');
const { pozycjaSlonca, poraDnia } = require('../../lib/slonce.js');

(async () => {
  const env = await srodowisko('grafiki');
  const fail = [];

  /* ---- 1. Pora dnia liczona z kąta godzinnego ----
     Kontrola z zewnątrz: południe słoneczne w Warszawie 21 czerwca wypada
     12:38 czasu lokalnego (długość 21,01°E plus równanie czasu), więc 11:00
     musi być „rano", a 16:00 „wieczorem". */
  const W = [52.23, 21.01];
  const kiedy = (utc) => {
    const p = pozycjaSlonca(new Date(utc), ...W);
    return poraDnia(p.wysokosc, p.kat);
  };
  const pory = {
    '07:00': kiedy('2026-06-21T05:00:00Z'),
    '11:00': kiedy('2026-06-21T09:00:00Z'),
    '13:00': kiedy('2026-06-21T11:00:00Z'),
    '16:00': kiedy('2026-06-21T14:00:00Z'),
    '23:30': kiedy('2026-06-21T21:30:00Z'),
  };
  console.log('1. pora dnia (Warszawa, 21 VI):', JSON.stringify(pory));
  if (pory['07:00'] !== 'rano' || pory['11:00'] !== 'rano') fail.push('przedpołudnie nie jest „rano"');
  if (pory['13:00'] !== 'poludnie') fail.push('godzina wokół górowania nie jest „południem"');
  if (pory['16:00'] !== 'wieczor') fail.push('popołudnie nie jest „wieczorem"');
  if (pory['23:30'] !== 'noc') fail.push('środek nocy nie jest „nocą"');

  /* ---- 2. Archiwum: pora dnia + temat + miejsce po nazwie ---- */
  const wpisy = [
    { id: 'onedrive:1', zrodlo: 'onedrive', nazwa: 'wawel-rano.jpg', sciezka: '/Krakow 2026/wawel-rano.jpg',
      typ: 'zdjecie', kiedy: '2026-06-21T06:30:00', lat: 50.054, lon: 19.935, ogniskowa: 24 },
    { id: 'onedrive:2', zrodlo: 'onedrive', nazwa: 'wawel-wieczor.jpg', sciezka: '/Krakow 2026/wawel-wieczor.jpg',
      typ: 'zdjecie', kiedy: '2026-06-21T20:30:00', lat: 50.058, lon: 19.938, ogniskowa: 50 },
    { id: 'onedrive:3', zrodlo: 'onedrive', nazwa: 'rynek-poludnie.jpg', sciezka: '/Krakow 2026/rynek-poludnie.jpg',
      typ: 'zdjecie', kiedy: '2026-06-21T13:00:00', lat: 50.062, lon: 19.937 },
    { id: 'onedrive:4', zrodlo: 'onedrive', nazwa: 'ptaki.jpg', sciezka: '/Ptaki Biebrza/ptaki.jpg',
      typ: 'zdjecie', kiedy: '2026-05-10T06:00:00', lat: 53.5, lon: 22.6 },
    { id: 'onedrive:5', zrodlo: 'onedrive', nazwa: 'wesele.jpg', sciezka: '/Wesele Kasi/wesele.jpg',
      typ: 'zdjecie', kiedy: '2026-08-01T19:00:00', lat: 52.0, lon: 21.0 },
  ];
  await fetch(`${env.adres}/api/archive/add`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wpisy }),
  });

  const szukaj = async (q) => {
    const r = await fetch(`${env.adres}/api/archive/search?${new URLSearchParams(q)}`);
    return r.json();
  };

  const ranoWieczor = await szukaj({ poraDnia: 'rano,wieczor' });
  const nazwy = (d) => (d.wyniki || []).map((w) => w.nazwa).sort().join(', ');
  console.log(`2. poraDnia=rano,wieczor → ${ranoWieczor.znaleziono}: ${nazwy(ranoWieczor)}`);
  if (ranoWieczor.znaleziono !== 4) fail.push(`rano+wieczór dało ${ranoWieczor.znaleziono} zamiast 4`);
  if (/poludnie/.test(nazwy(ranoWieczor))) fail.push('do „rano i wieczorem" wpadło zdjęcie z południa');

  // SEDNO PYTANIA MARCINA: pora dnia ZAWĘŻONA miejscem podanym z nazwy.
  const wKrakowie = await szukaj({ poraDnia: 'rano,wieczor', miejsce: 'Kraków' });
  console.log(`3. to samo + miejsce=Kraków → ${wKrakowie.znaleziono}: ${nazwy(wKrakowie)}`);
  console.log(`   rozpoznane miejsce: ${JSON.stringify(wKrakowie.miejsceZNazwy)}`);
  if (!wKrakowie.miejsceZNazwy) fail.push('nazwa miejsca nie została zamieniona na współrzędne');
  if (wKrakowie.znaleziono !== 2) fail.push(`Kraków rano+wieczór dał ${wKrakowie.znaleziono} zamiast 2`);
  if (/ptaki|wesele/.test(nazwy(wKrakowie))) fail.push('promień wokół Krakowa wciągnął materiał z innych miejsc');

  const nieznane = await szukaj({ miejsce: 'Wólka Zmyślona Nieistniejąca' });
  console.log(`4. nieznane miejsce → przyznaje się: ${Boolean(nieznane.miejsceNieznane)}`);
  if (!nieznane.miejsceNieznane) fail.push('nieznana nazwa miejsca przemilczana — wynik wygląda na kompletny');

  const ptaki = await szukaj({ temat: 'ptaki-w-locie,slub' });
  console.log(`5. temat=ptaki-w-locie,slub → ${ptaki.znaleziono}: ${nazwy(ptaki)}`);
  if (ptaki.znaleziono !== 2) fail.push(`filtr tematu dał ${ptaki.znaleziono} zamiast 2`);

  const grupy = await (await fetch(`${env.adres}/api/archive/stats?pole=temat`)).json();
  console.log(`6. grupowanie po temacie: ${JSON.stringify((grupy.grupy || []).map((g) => g.wartosc))}`);
  if (!(grupy.grupy || []).some((g) => g.wartosc === 'slub')) fail.push('brak grupowania po temacie');

  /* ---- 3. Miniatury: trasa istnieje i uczciwie mówi, gdy nie ma OneDrive ---- */
  const mini = await fetch(`${env.adres}/api/archive/thumb?id=${encodeURIComponent('onedrive:1')}`);
  const miniD = await mini.json().catch(() => ({}));
  console.log(`7. miniatura bez połączonego OneDrive → HTTP ${mini.status} „${(miniD.error || '').slice(0, 40)}"`);
  if (mini.status === 500) fail.push('trasa miniatur wywraca serwer');
  if (mini.status === 200) fail.push('miniatura oddana mimo braku połączenia z OneDrive');
  const zlyId = await fetch(`${env.adres}/api/archive/thumb?id=cokolwiek`);
  if (zlyId.status !== 400) fail.push('trasa miniatur nie sprawdza identyfikatora');

  /* ---- 3b. CO WIDAĆ na zdjęciu — to, co daje Immich, bez stosu Immicha ----
     Zdjęcie z OneDrive nie ma o sobie żadnej informacji o treści: Graph oddaje
     datę, aparat i GPS. Kategorie zgadujemy z nazw folderów, więc „Wesele Kasi"
     działa, a „IMG_4471.JPG" nie mówi nic. Wykryte obiekty muszą tę lukę
     domykać — i muszą wpadać do kategorii SAME, bez drugiego przejścia. */
  await fetch(`${env.adres}/api/archive/add`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wpisy: [{
        id: 'onedrive:6', zrodlo: 'onedrive', nazwa: 'IMG_4471.JPG',
        sciezka: '/Zdjecia/2026/IMG_4471.JPG', typ: 'zdjecie',
        kiedy: '2026-07-04T10:00:00', obiekty: ['dog', 'person'], obejrzane: true,
      }],
    }),
  });
  const psy = await szukaj({ temat: 'zwierzeta-domowe' });
  console.log(`7b. „IMG_4471.JPG" + obiekt „dog" → temat: ${nazwy(psy) || 'BRAK'}`);
  if (!/IMG_4471/.test(nazwy(psy))) {
    fail.push('obiekty z YOLO nie trafiły do kategorii — „pokaż zdjęcia z psem" nie zadziała');
  }

  /* ---- 3c. Telemetria klipów i dane lotu ze zdjęć ----
     Do tej pory Cosmos wiedział o klipach tyle, co Microsoft Graph, czyli
     datę i rozmiar. Telemetria z pliku .SRT wypełnia GPS, nastawy i wysokość,
     więc nagrania zaczynają wpadać do tych samych pytań co zdjęcia. */
  await fetch(`${env.adres}/api/archive/add`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wpisy: [{
        id: 'onedrive:7', zrodlo: 'onedrive', nazwa: 'DJI_0042.MP4',
        sciezka: '/Mazury 2026/DJI_0042.MP4', typ: 'wideo',
        kiedy: '2026-07-10T20:40:00', lat: 53.77, lon: 21.60,
        iso: 400, przyslona: 2.8, ogniskowa: 24,
        lot: { sekund: 42.5, wysokoscMin: 20, wysokoscMax: 88, dystansM: 410, punktow: 43 },
      }, {
        id: 'onedrive:8', zrodlo: 'onedrive', nazwa: 'DJI_0100.JPG',
        sciezka: '/Mazury 2026/DJI_0100.JPG', typ: 'zdjecie',
        kiedy: '2026-07-10T20:45:00', lat: 53.78, lon: 21.61,
        dron: { wysokoscWzgl: 62.4, gimbalPochylenie: -90, gimbalObrot: 12.3 },
      }],
    }),
  });
  const klipy = await szukaj({ typ: 'wideo' });
  const klip = (klipy.wyniki || []).find((w) => w.nazwa === 'DJI_0042.MP4');
  console.log(`7d. klip z telemetrią → ${klip && klip.lot
    ? `${klip.lot.sekund} s, ${klip.lot.wysokoscMin}-${klip.lot.wysokoscMax} m, `
      + `${klip.lot.dystansM} m, światło: ${klip.swiatlo}` : 'BRAK'}`);
  if (!klip || !klip.lot) fail.push('podsumowanie lotu nie przetrwało zapisu do indeksu');
  /* SEDNO: klip z GPS-em i czasem dostaje porę światła tak samo jak zdjęcie.
     To jest cała wartość telemetrii — „pokaż ujęcia znad jeziora o zachodzie"
     przestaje dotyczyć wyłącznie fotografii. */
  if (klip && !klip.swiatlo) fail.push('klip nie dostał pory światła mimo GPS-u i czasu');

  const zLotu = await szukaj({ poraDnia: 'wieczor' });
  console.log(`7e. wieczorne o zmierzchu, w tym wideo: `
    + `${(zLotu.wyniki || []).filter((w) => w.typ === 'wideo').length} klipów`);
  if (!(zLotu.wyniki || []).some((w) => w.typ === 'wideo')) {
    fail.push('klip nie wpadł do filtra pory dnia — telemetria nie dotarła do liczenia Słońca');
  }

  const zDronem = (await szukaj({ typ: 'zdjecie' })).wyniki
    .find((w) => w.nazwa === 'DJI_0100.JPG');
  console.log(`7f. zdjęcie z drona → wysokość ${zDronem && zDronem.dron
    ? `${zDronem.dron.wysokoscWzgl} m, gimbal ${zDronem.dron.gimbalPochylenie}°` : 'BRAK'}`);
  if (!zDronem || !zDronem.dron || zDronem.dron.wysokoscWzgl !== 62.4) {
    fail.push('dane lotu z XMP nie przetrwały zapisu do indeksu');
  }

  const wizja = await fetch(`${env.adres}/api/archive/vision`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const wizjaD = await wizja.json().catch(() => ({}));
  console.log(`7c. rozpoznawanie treści bez OneDrive → HTTP ${wizja.status} „${(wizjaD.error || '').slice(0, 45)}"`);
  if (wizja.status === 500) fail.push('trasa rozpoznawania treści wywraca serwer');
  if (wizja.status === 200) fail.push('treść „rozpoznana" mimo braku połączenia z OneDrive');
  if (!/OneDrive|zmys/i.test(wizjaD.error || '')) {
    fail.push('komunikat rozpoznawania treści nie mówi, czego brakuje');
  }

  /* ---- 4. Temat steruje planem zdjęciowym ---- */
  const dzien = evZeSlonca(10);
  const nastawy = (op) => {
    const r = dobierz(dzien, { tryb: 'zdjecie', ...op });
    return `${r.czas} ${r.przyslona} ISO ${r.iso}`;
  };
  const gory = nastawy({ temat: 'góry', obiektyw: '24-70 f/2.8' });
  const portret = nastawy({ temat: 'portret', obiektyw: '85mm f/1.8' });
  const ptakiN = dobierz(dzien, { tryb: 'zdjecie', temat: 'ptaki w locie', obiektyw: 'RF 100-500 f/4.5-7.1' });
  console.log(`8. góry: ${gory} · portret: ${portret} · ptaki: ${ptakiN.czas} ${ptakiN.przyslona} ISO ${ptakiN.iso}`);
  // Krajobraz przy f/22 to dyfrakcja, portret przy f/11 to zero oddzielenia tła.
  if (!/f\/(8|11)$/.test(gory.split(' ')[1])) fail.push(`krajobraz dostał ${gory.split(' ')[1]}, a ma być f/8-f/11`);
  if (Number(portret.split(' ')[1].replace('f/', '')) > 2.8) fail.push(`portret dostał ${portret.split(' ')[1]} — brak oddzielenia od tła`);
  if (Number(String(ptakiN.czas).replace('1/', '')) < 1600) fail.push(`ptaki w locie dostały ${ptakiN.czas} — za długo`);
  if (!ptakiN.powody.some((x) => /AF-C|śledzenie/i.test(x))) fail.push('brak rady praktycznej do tematu');

  /* Nierozpoznany temat NIE jest błędem — lista jest otwarta z założenia. */
  const dziwny = dobierz(dzien, { tryb: 'zdjecie', temat: 'pociągi towarowe', obiektyw: '24-70 f/2.8' });
  console.log(`9. temat spoza listy → ${dziwny.czas} ${dziwny.przyslona} ISO ${dziwny.iso}`);
  if (!dziwny.iso) fail.push('nieznany temat wywraca dobór');
  if (!dziwny.powody.some((x) => /nie mam w słowniku/i.test(x))) {
    fail.push('nieznany temat przemilczany — użytkownik nie wie, że Cosmos zgadywał');
  }

  /* ---- 5. Dowolny sprzęt ---- */
  const sprzety = ['Sony A7 IV', 'DJI Air 3', 'Fujifilm X-T5', 'iPhone 15 Pro', 'jakiś stary aparat'];
  const klasy = sprzety.map((n) => `${n}→${rozpoznajSprzet(n).klasa || 'katalog'}`);
  console.log(`10. rozpoznanie sprzętu: ${klasy.join(', ')}`);
  if (rozpoznajSprzet('DJI Air 3').klasa !== 'dron') fail.push('dron nierozpoznany');
  if (rozpoznajSprzet('Fujifilm X-T5').klasa !== 'aparat-aps-c') fail.push('APS-C nierozpoznany');
  if (rozpoznajSprzet('Sony A7 IV').klasa !== 'aparat-pelna-klatka') fail.push('pełna klatka nierozpoznana');
  const obcy = dobierz(dzien, { tryb: 'zdjecie', sprzet: 'Sony A7 IV', temat: 'portret', obiektyw: '85mm f/1.8' });
  if (!obcy.powody.some((x) => /nie mam .* w katalogu/i.test(x))) {
    fail.push('nieznany korpus podstawiony po cichu');
  }

  /* ---- 6. Gwiazdy: czas w SEKUNDACH i poprawne EV nocy ----
     Kontrola z praktyki: rozgwieżdżone niebo to około 20 s przy f/2.8
     i ISO 3200. Tabela EV miała tu kiedyś +1 zamiast −6 i wszystkie nocne
     porady były zawyżone o ponad siedem działek. */
  const noc = dobierz(evZeSlonca(-18), { tryb: 'zdjecie', temat: 'mleczna droga', obiektyw: '24-70 f/2.8', ogniskowa: 24 });
  console.log(`11. gwiazdy 24 mm → ${noc.czas} ${noc.przyslona} ISO ${noc.iso}`);
  if (!/\bs$/.test(noc.czas)) fail.push(`nocna ekspozycja podana jako ${noc.czas} — powinna być w sekundach`);
  const sekundy = Number(String(noc.czas).replace(' s', ''));
  if (!(sekundy >= 10 && sekundy <= 25)) fail.push(`${noc.czas} przy 24 mm łamie regułę 500 albo jest bez sensu`);
  if (noc.iso < 1600) fail.push(`ISO ${noc.iso} na gwiazdy jest za niskie — EV nocy znów zawyżone`);

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nTEMATY I ARCHIWUM OK');
  process.exit(fail.length ? 1 : 0);
})();

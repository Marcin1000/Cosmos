/* ============================================================
   Misja waypointowa dla DJI — plik KMZ w formacie WPML

   `senses/flightplan.py` liczy już wszystko, czego potrzeba przed przelotem:
   wysokość dla zadanego GSD, pokrycie, liczbę zdjęć, czas lotu. Nie umiał
   tylko jednego — ODDAĆ TEGO DRONOWI. Plan zostawał liczbą na ekranie, którą
   trzeba było ręcznie przepisać na waypointy w aplikacji.

   KMZ zamyka tę pętlę. To zwykły ZIP z dwoma plikami XML w środku:

       wpmz/template.kml    — misja (szablon, WPML 1.0.2)
       wpmz/waylines.wpml   — trasa do wykonania (WPML 1.0.6)

   ZIP piszemy sami, metodą „store" (bez kompresji). Node ma `zlib.crc32`
   od wersji 22, a suma kontrolna to jedyne, czego brakowało — reszta
   nagłówka ZIP to kilkanaście liczb w ustalonej kolejności. Biblioteka do
   spakowania dwóch plików tekstowych byłaby zależnością większą niż problem.

   ⚠ CZEGO NIE POTWIERDZIŁEM, i mówię to wprost w kodzie, żeby nie zginęło:
   struktura WPML jest odtworzona z dokumentacji i z otwartych generatorów,
   ale ANI JEDEN wygenerowany tu plik nie przeszedł jeszcze przez prawdziwego
   drona. Rozstrzygnie to dopiero import w aplikacji i podniesienie maszyny.

   ⚠ DRUGA RZECZ, ważniejsza. Na KONSUMENCKIM Mavicu 3 nie ma oficjalnej drogi
   wgrania własnego KMZ. Trzeba w DJI Fly utworzyć zastępczą misję waypointową,
   a potem podmienić jej plik w katalogu `waypoint` na urządzeniu. To działa
   (robią tak DJI-KMZ-Injector i podobne), ale jest obejściem i DJI może je
   zamknąć dowolną aktualizacją. Wersje Enterprise z DJI Pilot 2 importują KMZ
   normalnie.
   ============================================================ */

const zlib = require('node:zlib');

/** ZIP bez kompresji. Dwa pliki XML po kilka kilobajtów — pakowanie ich
 *  oszczędziłoby tyle, co nic, a metoda „store" jest czytelna dla wszystkiego,
 *  co potrafi otworzyć ZIP-a. */
function zipuj(pliki) {
  const lokalne = [];
  const centralne = [];
  let offset = 0;

  for (const { nazwa, tresc } of pliki) {
    const dane = Buffer.from(tresc, 'utf8');
    const nazwaBuf = Buffer.from(nazwa, 'utf8');
    const crc = zlib.crc32(dane);

    const naglowek = Buffer.alloc(30);
    naglowek.writeUInt32LE(0x04034b50, 0);   // podpis nagłówka lokalnego
    naglowek.writeUInt16LE(20, 4);           // wymagana wersja (2.0)
    naglowek.writeUInt16LE(0x0800, 6);       // flaga: nazwy w UTF-8
    naglowek.writeUInt16LE(0, 8);            // metoda 0 = bez kompresji
    naglowek.writeUInt16LE(0, 10);           // czas — nieistotny, zerujemy
    naglowek.writeUInt16LE(0x21, 12);        // data — 1 stycznia 1980
    naglowek.writeUInt32LE(crc, 14);
    naglowek.writeUInt32LE(dane.length, 18);
    naglowek.writeUInt32LE(dane.length, 22);
    naglowek.writeUInt16LE(nazwaBuf.length, 26);
    naglowek.writeUInt16LE(0, 28);
    lokalne.push(naglowek, nazwaBuf, dane);

    const centralny = Buffer.alloc(46);
    centralny.writeUInt32LE(0x02014b50, 0);  // podpis katalogu centralnego
    centralny.writeUInt16LE(20, 4);          // wersja twórcy
    centralny.writeUInt16LE(20, 6);          // wersja wymagana
    centralny.writeUInt16LE(0x0800, 8);
    centralny.writeUInt16LE(0, 10);
    centralny.writeUInt16LE(0, 12);
    centralny.writeUInt16LE(0x21, 14);
    centralny.writeUInt32LE(crc, 16);
    centralny.writeUInt32LE(dane.length, 20);
    centralny.writeUInt32LE(dane.length, 24);
    centralny.writeUInt16LE(nazwaBuf.length, 28);
    centralny.writeUInt32LE(offset, 42);
    centralne.push(centralny, nazwaBuf);

    offset += naglowek.length + nazwaBuf.length + dane.length;
  }

  const katalog = Buffer.concat(centralne);
  const koniec = Buffer.alloc(22);
  koniec.writeUInt32LE(0x06054b50, 0);
  koniec.writeUInt16LE(pliki.length, 8);
  koniec.writeUInt16LE(pliki.length, 10);
  koniec.writeUInt32LE(katalog.length, 12);
  koniec.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokalne, katalog, koniec]);
}

const esc = (s) => String(s).replace(/[&<>]/g, (z) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[z]));

/** Jeden punkt trasy. `wpml:index` liczony od zera i MUSI być ciągły —
 *  dziura w numeracji jest dla aplikacji błędem pliku, nie brakiem punktu. */
function punktXml(p, i, { wysokosc, predkosc, zdjecie }) {
  const h = Number.isFinite(p.wysokosc) ? p.wysokosc : wysokosc;
  /* Akcja „zrób zdjęcie" wisi przy punkcie, nie przy misji. Przy nalocie
     fotogrametrycznym to jedyny sposób, żeby zdjęcia powstały dokładnie tam,
     gdzie policzyliśmy pokrycie — wyzwalanie co N sekund rozjeżdża się przy
     każdym podmuchu wiatru. */
  const akcja = zdjecie ? `
      <wpml:actionGroup>
        <wpml:actionGroupId>${i}</wpml:actionGroupId>
        <wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex>
        <wpml:actionGroupEndIndex>${i}</wpml:actionGroupEndIndex>
        <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
        <wpml:actionTrigger>
          <wpml:actionTriggerType>reachPoint</wpml:actionTriggerType>
        </wpml:actionTrigger>
        <wpml:action>
          <wpml:actionId>0</wpml:actionId>
          <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
          <wpml:actionActuatorFuncParam>
            <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
          </wpml:actionActuatorFuncParam>
        </wpml:action>
      </wpml:actionGroup>` : '';

  return `    <Placemark>
      <Point><coordinates>${p.lon.toFixed(8)},${p.lat.toFixed(8)}</coordinates></Point>
      <wpml:index>${i}</wpml:index>
      <wpml:executeHeight>${h}</wpml:executeHeight>
      <wpml:waypointSpeed>${predcheck(p.predkosc, predkosc)}</wpml:waypointSpeed>
      <wpml:waypointHeadingParam>
        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
      </wpml:waypointHeadingParam>
      <wpml:waypointTurnParam>
        <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>
        <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
      </wpml:waypointTurnParam>
      <wpml:useStraightLine>1</wpml:useStraightLine>${akcja}
    </Placemark>`;
}

function predcheck(wlasna, domyslna) {
  return Number.isFinite(wlasna) && wlasna > 0 ? wlasna : domyslna;
}

function dokument(punkty, o, { szablon }) {
  const { wysokosc, predkosc, zdjecie, poLocie, nazwa } = o;
  /* Wysokość liczona OD PUNKTU STARTU, nie od poziomu morza. Przy `EGM96`
     te same liczby znaczyłyby wysokość nad geoidą i dron nad Zakopanem
     poleciałby osiemset metrów pod ziemię. */
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.${szablon ? '2' : '6'}">
<Document>
  <wpml:author>Cosmos</wpml:author>
  <wpml:createTime>${Date.now()}</wpml:createTime>
  <wpml:updateTime>${Date.now()}</wpml:updateTime>
  <wpml:missionConfig>
    <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
    <wpml:finishAction>${poLocie}</wpml:finishAction>
    <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
    <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
    <wpml:globalTransitionalSpeed>${predkosc}</wpml:globalTransitionalSpeed>
  </wpml:missionConfig>
  <Folder>
    <name>${esc(nazwa)}</name>
    <wpml:templateType>waypoint</wpml:templateType>
    <wpml:templateId>0</wpml:templateId>
    <wpml:waylineId>0</wpml:waylineId>
    <wpml:autoFlightSpeed>${predkosc}</wpml:autoFlightSpeed>
    <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
    <wpml:waylineCoordinateSysParam>
      <wpml:coordinateMode>WGS84</wpml:coordinateMode>
      <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
    </wpml:waylineCoordinateSysParam>
${punkty.map((p, i) => punktXml(p, i, { wysokosc, predkosc, zdjecie })).join('\n')}
  </Folder>
</Document>
</kml>`;
}

const PO_LOCIE = new Set(['goHome', 'autoLand', 'gotoFirstWaypoint', 'noAction']);

/**
 * Misja waypointowa → gotowy plik KMZ.
 *
 * @param {Array<{lat:number, lon:number, wysokosc?:number, predkosc?:number}>} punkty
 * @param {object} [o]
 * @param {number} [o.wysokosc=50]  wysokość nad punktem startu, metry
 * @param {number} [o.predkosc=8]   prędkość przelotowa, m/s
 * @param {boolean} [o.zdjecie=true] zrobić zdjęcie w każdym punkcie
 * @param {string} [o.poLocie='goHome'] co po ostatnim punkcie
 * @param {string} [o.nazwa='Misja Cosmos']
 * @returns {Buffer} zawartość pliku .kmz
 */
function misjaKmz(punkty, o = {}) {
  const lista = (punkty || []).filter((p) => Number.isFinite(p && p.lat) && Number.isFinite(p.lon));
  /* Dwa punkty to minimum, żeby w ogóle była trasa. Jeden punkt to nie jest
     „krótka misja", tylko plik, który aplikacja odrzuci — lepiej powiedzieć
     to tutaj niż na lotnisku. */
  if (lista.length < 2) throw new Error('Misja potrzebuje co najmniej dwóch punktów.');
  if (lista.length > 99) throw new Error('DJI Fly przyjmuje najwyżej 99 punktów w misji.');

  const wysokosc = Number.isFinite(o.wysokosc) ? o.wysokosc : 50;
  if (wysokosc < 5 || wysokosc > 500) {
    throw new Error(`Wysokość ${wysokosc} m jest poza sensownym zakresem 5-500 m.`);
  }
  const predkosc = Number.isFinite(o.predkosc) ? o.predkosc : 8;
  if (predkosc < 1 || predkosc > 15) {
    throw new Error(`Prędkość ${predkosc} m/s jest poza zakresem 1-15 m/s.`);
  }
  const poLocie = PO_LOCIE.has(o.poLocie) ? o.poLocie : 'goHome';
  const ustawienia = {
    wysokosc, predkosc, poLocie,
    zdjecie: o.zdjecie !== false,
    nazwa: String(o.nazwa || 'Misja Cosmos').slice(0, 80),
  };

  return zipuj([
    { nazwa: 'wpmz/template.kml', tresc: dokument(lista, ustawienia, { szablon: true }) },
    { nazwa: 'wpmz/waylines.wpml', tresc: dokument(lista, ustawienia, { szablon: false }) },
  ]);
}

/** Siatka nalotu nad prostokątem — „węża" tam i z powrotem.
 *
 *  Odstęp między liniami przychodzi z `senses/flightplan.py`, bo to on liczy
 *  ślad kadru na ziemi i pokrycie. Tutaj jest tylko geometria: ile linii i
 *  gdzie je poprowadzić.
 *
 *  Linie układamy naprzemiennie („wąż"), bo powrót na początek każdej linii
 *  to przelot na pusto — przy dziesięciu liniach po 200 m to dwa kilometry
 *  baterii wyrzucone.
 */
function siatka({ lat, lon, szerokoscM, dlugoscM, odstepM, kierunek = 0 }) {
  if (!(odstepM > 0)) throw new Error('Odstęp między liniami musi być dodatni.');
  const linii = Math.max(2, Math.ceil(szerokoscM / odstepM) + 1);
  const r = Math.PI / 180;
  // Metry na stopień — długość zależy od szerokości geograficznej.
  const mNaStopienLat = 111320;
  const mNaStopienLon = 111320 * Math.cos(lat * r);
  const kr = kierunek * r;

  const punkty = [];
  for (let i = 0; i < linii; i++) {
    const bok = i * odstepM - szerokoscM / 2;
    const konce = [-dlugoscM / 2, dlugoscM / 2];
    // Co druga linia w przeciwną stronę — stąd „wąż".
    if (i % 2) konce.reverse();
    for (const wzdluz of konce) {
      // Obrót układu o `kierunek`: wzdłuż linii i w poprzek.
      const dx = wzdluz * Math.cos(kr) - bok * Math.sin(kr);
      const dy = wzdluz * Math.sin(kr) + bok * Math.cos(kr);
      punkty.push({
        lat: lat + dy / mNaStopienLat,
        lon: lon + dx / mNaStopienLon,
      });
    }
  }
  return punkty;
}

module.exports = { misjaKmz, siatka, zipuj };

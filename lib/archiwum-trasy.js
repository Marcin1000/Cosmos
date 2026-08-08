/* ============================================================
   Trasy archiwum materialu - /api/archive/*

   Wydzielone z server.js, gdy plik znow przekroczyl prog 2600 linii. To jest
   spojna calosc: szesc tras czytajacych i uzupelniajacych jeden indeks, plus
   dwa pomocniki, ktorych nie uzywa nic poza nimi.

   Zaleznosci wchodza przez `utworz()`, nie przez stan globalny serwera - ta
   sama zasada, co przy `lib/nagrywanie.js` i `lib/pomysly.js`. Przy poprzednim
   podziale osiem usterek przeszlo `node --check`, bo skladnia byla poprawna,
   a nazwy nie istnialy. Dlatego kontrola "wolane, ale niezdefiniowane"
   ze `scripts/audyt.js` pilnuje tego pliku tak samo jak pozostalych.
   ============================================================ */

/**
 * @param {object} z
 * @param {object} z.archiwum   indeks materialu (lib/archiwum.js)
 * @param {object} z.onedrive   klient Microsoft Graph (lib/onedrive.js)
 * @param {string} z.SENSES_URL adres uslugi percepcji
 * @param {Function} z.sendJson  odpowiedz HTTP
 * @param {Function} z.readJson  odczyt ciala zadania
 * @param {Function} z.addEvent  dziennik zdarzen
 * @param {Function} z.sensesState stan zmyslow (moze oddac obiekt albo obietnice)
 * @param {Function} z.wspolrzedneMiejsca nazwa miejsca -> wspolrzedne (lib/miejsca.js)
 */
function utworz({ archiwum, onedrive, SENSES_URL, sendJson, readJson, addEvent,
  sensesState, wspolrzedneMiejsca }) {
  /* Archiwum materiału. Indeks jest pasywny — źródła (OneDrive, dysk przez
     zmysły) wpychają wpisy, a zapytania działają nawet wtedy, gdy te źródła
     są offline. Dlatego „ile klipów 50 mm w tym roku" odpowie z telefonu
     w terenie przy wyłączonym komputerze domowym. */
  async function handleArchiwum(req, res, p) {
    if (p === '/api/archive/add' && req.method === 'POST') {
      let d;
      try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      if (!Array.isArray(d.wpisy)) return sendJson(res, 400, { error: 'Brak tablicy `wpisy`.' });
      if (d.wpisy.length > 5000) return sendJson(res, 413, { error: 'Najwyżej 5000 wpisów naraz.' });
      const wynik = archiwum.dodaj(d.wpisy);
      if (wynik.dodanych) addEvent('archiwum', `zindeksowano ${wynik.dodanych} plików (razem ${wynik.razem})`);
      return sendJson(res, 200, wynik);
    }
    if (p === '/api/archive/search' && req.method === 'GET') {
      const q = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      const limit = Math.min(Number(q.limit) || 40, 200);
      const dodatki = await miejsceNaPromien(q);
      const wyniki = archiwum.szukaj(q);
      return sendJson(res, 200, { znaleziono: wyniki.length, wyniki: wyniki.slice(0, limit), ...dodatki });
    }
    /* Miniatura pliku z archiwum — dociągana W CHWILI PYTANIA, nie z indeksu.
       Microsoft Graph oddaje podpisane adresy, które WYGASAJĄ. Zapisane przy
       indeksowaniu byłyby martwe w momencie, gdy Marcin o nie pyta — a to
       właśnie wtedy mają się pokazać. Poza tym adres idzie przez nas, więc
       przeglądarka nie potrzebuje żadnych poświadczeń do OneDrive. */
    if (p === '/api/archive/thumb' && req.method === 'GET') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id') || '';
      if (!id.startsWith('onedrive:')) return sendJson(res, 400, { error: 'Zły identyfikator.' });
      if (!onedrive.polaczony()) return sendJson(res, 503, { error: 'OneDrive niepołączony.' });
      try {
        const el = await onedrive.graf(`/me/drive/items/${encodeURIComponent(id.slice(9))}`
          + '/thumbnails/0/large');
        if (!el || !el.url) return sendJson(res, 404, { error: 'Brak miniatury.' });
        const r = await fetch(el.url, { signal: AbortSignal.timeout(15000) });
        const typ = r.headers.get('content-type') || '';
        if (!r.ok || !/^image\//i.test(typ)) return sendJson(res, 502, { error: 'To nie jest obraz.' });
        const buf = Buffer.from(await r.arrayBuffer());
        res.writeHead(200, {
          'Content-Type': typ,
          'Content-Length': buf.length,
          // Krótko, bo sam adres u Microsoftu i tak wygasa.
          'Cache-Control': 'private, max-age=600',
        });
        return res.end(buf);
      } catch (err) {
        return sendJson(res, 502, { error: `Nie udało się pobrać miniatury: ${err.message}` });
      }
    }
    if (p === '/api/archive/stats' && req.method === 'GET') {
      const q = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
      if (!q.pole) return sendJson(res, 200, archiwum.podsumowanie());
      const wynik = archiwum.zestawienie(q.pole, q);
      if (!wynik) return sendJson(res, 400, { error: `Nie umiem grupować po „${q.pole}".` });
      return sendJson(res, 200, { pole: q.pole, ...wynik });
    }
    /* Dociągnięcie OBIEKTYWU do wpisów z OneDrive.
       Osobno od indeksowania, bo kosztuje jedno żądanie HTTP na plik — przy
       dwóch tysiącach zdjęć to dwa tysiące żądań. Robimy je paczkami, żeby
       dało się przerwać i wznowić, i tylko dla wpisów, którym obiektywu brakuje. */
    if (p === '/api/archive/lenses' && req.method === 'POST') {
      if (!onedrive.polaczony()) return sendJson(res, 503, { error: 'OneDrive niepołączony.' });
      let d = {};
      try { d = await readJson(req); } catch { /* domyślne */ }
      const paczka = Math.min(Math.max(Number(d.ile) || 100, 1), 500);

      const doZrobienia = archiwum.szukaj({ zrodlo: 'onedrive', typ: 'zdjecie' })
        .filter((w) => !w.obiektyw).slice(0, paczka);

      let uzupelnione = 0;
      let bezExifu = 0;
      const bledy = [];
      for (const w of doZrobienia) {
        try {
          const exif = await onedrive.dociagnijExif(String(w.id).replace(/^onedrive:/, ''));
          if (exif && exif.obiektyw) {
            archiwum.dodaj([{ ...w, obiektyw: exif.obiektyw }]);
            uzupelnione++;
          } else bezExifu++;
        } catch (err) {
          if (bledy.length < 3) bledy.push(String(err.message).slice(0, 80));
        }
      }
      const zostalo = archiwum.szukaj({ zrodlo: 'onedrive', typ: 'zdjecie' })
        .filter((w) => !w.obiektyw).length;
      if (uzupelnione) addEvent('archiwum', `obiektyw dociągnięty do ${uzupelnione} zdjęć`);
      return sendJson(res, 200, {
        sprawdzone: doZrobienia.length, uzupelnione, bezExifu, zostalo, bledy,
      });
    }

    /* CO WIDAĆ na zdjęciu z OneDrive — YOLO po miniaturze.
       To jest ta część Immicha, która ma tu sens. Immich robi wyszukiwanie
       semantyczne zdjęć modelem CLIP i to naprawdę działa, ale kosztuje Dockera
       z Postgresem, kontener ML i drugą bazę obok naszej — cały równoległy stos
       dla jednej funkcji. Tymczasem materiał z OneDrive nie ma o sobie ŻADNEJ
       informacji o treści: Microsoft Graph oddaje datę, aparat i GPS, i tyle.
       Kategorie tematyczne zgadujemy z nazw folderów, więc „Wesele Kasi" działa,
       a „IMG_4471.JPG" nie mówi nic.

       Wystarczy podać zdjęcie oczom, które już mamy. YOLO ze zmysłów rozpoznaje
       80 klas obiektów (osoba, pies, ptak, koń, samochód, motocykl, łódź...) —
       dokładnie ten poziom, na którym pyta się o własne archiwum. Idzie po
       MINIATURZE, nie po pliku: detekcja na 800 px daje ten sam wynik co na
       40 megapikselach, a ściąga kilkadziesiąt kilobajtów zamiast dwudziestu
       megabajtów. Wypełnione `obiekty` wpadają potem w kategoryzację tematyczną
       przy zapisie wpisu, więc „pokaż zdjęcia z psem" zaczyna działać samo. */
    if (p === '/api/archive/vision' && req.method === 'POST') {
      if (!onedrive.polaczony()) return sendJson(res, 503, { error: 'OneDrive niepołączony.' });
      const zmysly = await sensesState();
      if (!(zmysly.online && zmysly.caps && zmysly.caps.yolo)) {
        return sendJson(res, 503, {
          error: 'Rozpoznawanie treści wymaga zmysłów z YOLO. Uruchom je na komputerze '
               + 'domowym: python senses/service.py (pip install ultralytics).',
        });
      }
      let d = {};
      try { d = await readJson(req); } catch { /* domyślne */ }
      const paczka = Math.min(Math.max(Number(d.ile) || 50, 1), 300);

      const brakuje = () => archiwum.szukaj({ zrodlo: 'onedrive', typ: 'zdjecie' })
        .filter((w) => !w.obejrzane);
      const doZrobienia = brakuje().slice(0, paczka);

      let opisane = 0;
      let pusteKadry = 0;
      const bledy = [];
      for (const w of doZrobienia) {
        try {
          const obiekty = await obiektyZMiniatury(String(w.id).replace(/^onedrive:/, ''));
          /* `obejrzane` stawiamy TAKŻE gdy nic nie znaleziono. Bez tego zdjęcia
             krajobrazu — na których YOLO słusznie nie widzi żadnego z 80
             obiektów — wracałyby do kolejki przy każdym przebiegu i paczka
             mieliłaby w kółko te same pliki, nigdy nie docierając do reszty. */
          archiwum.dodaj([{ ...w, obiekty, obejrzane: true }]);
          if (obiekty.length) opisane++; else pusteKadry++;
        } catch (err) {
          if (bledy.length < 3) bledy.push(String(err.message).slice(0, 100));
        }
      }
      const zostalo = brakuje().length;
      if (opisane) addEvent('archiwum', `treść rozpoznana na ${opisane} zdjęciach`);
      return sendJson(res, 200, {
        sprawdzone: doZrobienia.length, opisane, pusteKadry, zostalo, bledy,
      });
    }

    if (p === '/api/archive/source' && req.method === 'DELETE') {
      const zrodlo = new URL(req.url, 'http://localhost').searchParams.get('zrodlo') || '';
      if (!zrodlo) return sendJson(res, 400, { error: 'Podaj `zrodlo`.' });
      return sendJson(res, 200, { usunieto: archiwum.usunZrodlo(zrodlo) });
    }
    return sendJson(res, 404, { error: 'Nieznana trasa archiwum.' });
  }

  /* Miniatura z OneDrive → lista obiektów wykrytych przez YOLO.
   *
   *  Próg pewności jest tu WYŻSZY niż w podglądzie na żywo (0,45 zamiast
   *  domyślnego). Przy podglądzie fałszywy alarm mija po klatce; tutaj zapisuje
   *  się w indeksie na stałe i wystarczy, żeby zdjęcie z lasu wpadło na zawsze
   *  do kategorii „zwierzęta dzikie", bo cień w krzakach przez pół sekundy
   *  przypominał psa. */
  const YOLO_PROG = Number(process.env.ARCHIVE_VISION_MIN_CONF || 0.45);

  async function obiektyZMiniatury(idPliku) {
    const el = await onedrive.graf(`/me/drive/items/${encodeURIComponent(idPliku)}`
      + '/thumbnails/0/large');
    if (!el || !el.url) throw new Error('Brak miniatury.');
    const r = await fetch(el.url, { signal: AbortSignal.timeout(20000) });
    const typ = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\//i.test(typ)) throw new Error(`Miniatura: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());

    const odp = await fetch(`${SENSES_URL}/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: `data:${typ};base64,${buf.toString('base64')}` }),
      signal: AbortSignal.timeout(60000),
    });
    if (!odp.ok) throw new Error(`Zmysły: HTTP ${odp.status}`);
    const dane = await odp.json();
    const etykiety = (dane.objects || [])
      .filter((o) => Number(o.conf) >= YOLO_PROG)
      .map((o) => String(o.label));
    // Bez powtórzeń: „12× person" na zdjęciu z wesela to wciąż jedna informacja,
    // a indeks trzyma najwyżej 20 obiektów na wpis.
    return [...new Set(etykiety)];
  }

  /* „Pokaż zdjęcia z Krakowa" — nazwa miejsca na filtr promieniowy.
   *
   *  Indeks trzyma współrzędne, nie nazwy: Microsoft Graph oddaje lat/lon
   *  i tyle. Dopóki tego nie było, pytanie o miasto nie miało jak zadziałać —
   *  pole `miejsce` dla materiału z OneDrive jest zawsze puste.
   *
   *  Promień dobieramy do tego, CZYM jest miejsce. „Kraków" to punkt i 25 km
   *  wystarczy z zapasem; „Mazury" albo „Bieszczady" to region rozciągnięty na
   *  dziesiątki kilometrów i ten sam promień uciąłby większość materiału.
   *  Nominatim podaje obwiednię (`boundingbox`), więc bierzemy ją zamiast
   *  zgadywać — a gdy jej nie ma, zostaje rozsądne 25 km.
   */
  async function miejsceNaPromien(q) {
    if (!q.miejsce || (q.lat && q.lon)) return {};
    const m = await wspolrzedneMiejsca(String(q.miejsce));
    if (!m) return { miejsceNieznane: String(q.miejsce).slice(0, 80) };
    q.lat = m.lat;
    q.lon = m.lon;
    if (!q.promienKm) q.promienKm = m.promienKm || 25;
    delete q.miejsce;              // dalej filtruje już promień, nie tekst
    return { miejsceZNazwy: { nazwa: m.nazwa, lat: m.lat, lon: m.lon, promienKm: q.promienKm } };
  }
  return { handleArchiwum, miejsceNaPromien, obiektyZMiniatury };
}

module.exports = { utworz };

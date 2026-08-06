/* ============================================================
   Archiwum materiału — indeks zdjęć i klipów

   Wyróżnik, którego chmurowy asystent nie zrobi: ChatGPT nie ma Twoich
   plików i nigdy nie będzie miał, bo nikt nie wrzuci dwóch terabajtów do
   okna czatu. Cosmos stoi na Twoim serwerze, więc dla niego to naturalne.

   Indeks jest PASYWNY: sam niczego nie skanuje. Źródła (OneDrive przez
   Microsoft Graph, dysk lokalny przez zmysły) wpychają do niego wpisy.
   Dzięki temu dołożenie trzeciego źródła nie wymaga ruszania zapytań,
   a zapytania działają, gdy źródła są offline — indeks mieszka na VPS-ie,
   więc „ile klipów 50 mm w tym roku" odpowie z telefonu w terenie
   przy wyłączonym komputerze domowym.

   Najciekawsze filtrowanie to PORA ŚWIATŁA. Mając czas i GPS zdjęcia,
   liczymy, jak wysoko stało wtedy Słońce — i „pokaż ujęcia z zachodu"
   przestaje być zgadywaniem po godzinie w nazwie pliku.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const { fazaSwiatla, pozycjaSlonca } = require('./slonce.js');

const POLA_LICZBOWE = ['ogniskowa', 'przyslona', 'iso', 'rozmiar', 'czasS'];

const STREFA = process.env.COSMOS_TZ || 'Europe/Warsaw';

/** Czas ścienny bez strefy (tak zapisuje go aparat) → moment bezwzględny.
 *
 *  Pierwsza wersja odtwarzała strefę z DŁUGOŚCI GEOGRAFICZNEJ — przy 20,9°E
 *  wychodziło UTC+1,39. Tymczasem w Polsce latem obowiązuje UTC+2, więc błąd
 *  sięgał 37 minut i zdjęcie ze złotej godziny lądowało po zachodzie Słońca.
 *  Czas urzędowy nie wynika z południka.
 *
 *  Bierzemy więc strefę z konfiguracji (COSMOS_TZ) — zegar aparatu jest
 *  ustawiony na czas domowy. `toLocaleString` sam uwzględnia zmianę czasu,
 *  więc zdjęcia z lipca i ze stycznia liczą się poprawnie bez tablicy DST.
 */
function lokalnyNaUtc(naiwneISO) {
  const jakUtc = new Date(`${naiwneISO}Z`);
  if (Number.isNaN(jakUtc.getTime())) return null;
  try {
    // „sv-SE" daje format zbliżony do ISO, bez kombinowania z parsowaniem.
    const wStrefie = new Date(`${jakUtc.toLocaleString('sv-SE', { timeZone: STREFA }).replace(' ', 'T')}Z`);
    if (Number.isNaN(wStrefie.getTime())) return jakUtc;
    return new Date(jakUtc.getTime() + (jakUtc.getTime() - wStrefie.getTime()));
  } catch {
    return jakUtc;                     // nieznana strefa — lepiej UTC niż nic
  }
}

function utworz(katalogDanych) {
  const PLIK = path.join(katalogDanych, 'archiwum.json');
  /* Zapasowe współrzędne — dom użytkownika. Większość zdjęć nie ma GPS-u
     (aparaty bez modułu, wyłączona lokalizacja w telefonie, OneDrive
     czyszczący metadane), a bez współrzędnych pora światła jest `null`
     i cały filtr „pokaż ujęcia z zachodu" nie ma czego zwrócić. Lepiej
     policzyć ją dla domu i OZNACZYĆ jako przybliżoną, niż nie policzyć
     wcale i udawać, że w archiwum nie ma zdjęć o zachodzie. */
  let domyslneWspolrzedne = null;
  let wpisy = [];
  let poId = new Map();

  try {
    const surowe = JSON.parse(fs.readFileSync(PLIK, 'utf8'));
    if (Array.isArray(surowe)) wpisy = surowe;
  } catch { /* brak indeksu — pierwszy raz */ }
  przebuduj();

  function przebuduj() {
    poId = new Map(wpisy.map((w) => [w.id, w]));
  }

  let zapisZaplanowany = null;
  /* Zapis zbiorczy. Indeksowanie wrzuca wpisy paczkami po kilkaset; zapis
     przy każdej z nich to przy 200 tys. plików kilkaset przepisań całego
     pliku. Odkładamy o sekundę i zapisujemy raz. */
  function zapiszWkrotce() {
    if (zapisZaplanowany) return;
    zapisZaplanowany = setTimeout(() => { zapisZaplanowany = null; zapisz(); }, 1000);
    if (zapisZaplanowany.unref) zapisZaplanowany.unref();
  }

  function zapisz() {
    try {
      fs.mkdirSync(katalogDanych, { recursive: true });
      // Przez plik tymczasowy: przerwany zapis nie może zostawić indeksu
      // w połowie, bo wtedy tracisz cały katalog przy jednym restarcie.
      const tmp = `${PLIK}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(wpisy));
      fs.renameSync(tmp, PLIK);
    } catch (err) {
      console.error('Nie udało się zapisać archiwum:', err.message);
    }
  }

  /** Dołóż paczkę wpisów. Ten sam `id` nadpisuje — powtórne indeksowanie
   *  tego samego katalogu ma odświeżać, nie mnożyć. */
  function dodaj(nowe) {
    let dodanych = 0;
    let odswiezonych = 0;
    for (const w of nowe || []) {
      if (!w || !w.id) continue;
      const wpis = znormalizuj(w);
      if (poId.has(wpis.id)) {
        const i = wpisy.indexOf(poId.get(wpis.id));
        wpisy[i] = wpis;
        odswiezonych++;
      } else {
        wpisy.push(wpis);
        dodanych++;
      }
      poId.set(wpis.id, wpis);
    }
    if (dodanych || odswiezonych) zapiszWkrotce();
    return { dodanych, odswiezonych, razem: wpisy.length };
  }

  function znormalizuj(w) {
    const out = {
      id: String(w.id).slice(0, 400),
      zrodlo: w.zrodlo === 'onedrive' ? 'onedrive' : 'dysk',
      nazwa: String(w.nazwa || '').slice(0, 300),
      sciezka: String(w.sciezka || '').slice(0, 600),
      typ: w.typ === 'wideo' ? 'wideo' : 'zdjecie',
      kiedy: w.kiedy || null,
      aparat: w.aparat || null,
      obiektyw: w.obiektyw || null,
      lat: Number.isFinite(w.lat) ? w.lat : null,
      lon: Number.isFinite(w.lon) ? w.lon : null,
      miejsce: w.miejsce || null,
      obiekty: Array.isArray(w.obiekty) ? w.obiekty.slice(0, 20).map(String) : [],
      miniatura: w.miniatura || null,
    };
    for (const pole of POLA_LICZBOWE) {
      out[pole] = Number.isFinite(w[pole]) ? w[pole] : null;
    }
    /* Pora światła liczona RAZ, przy dodaniu. Zapytanie „pokaż ujęcia
       z zachodu" ma być filtrem po polu, a nie liczeniem pozycji Słońca
       dla dwustu tysięcy wpisów przy każdym pytaniu. */
    out.swiatlo = poraSwiatla(out);
    // Bez GPS-u pora światła jest policzona dla domu — musi to być widać,
    // inaczej zdjęcie z Hiszpanii dostanie polską godzinę zachodu bez słowa.
    out.swiatloPrzyblizone = Boolean(out.swiatlo && out.lat === null);
    return out;
  }

  function poraSwiatla(w) {
    if (!w.kiedy) return null;
    const lat = w.lat !== null ? w.lat : (domyslneWspolrzedne && domyslneWspolrzedne.lat);
    const lon = w.lon !== null ? w.lon : (domyslneWspolrzedne && domyslneWspolrzedne.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const utc = lokalnyNaUtc(w.kiedy);
    if (!utc) return null;
    try {
      return fazaSwiatla(pozycjaSlonca(utc, lat, lon).wysokosc);
    } catch { return null; }
  }

  /** Odległość w kilometrach — do „co mam z tego miejsca". */
  function odleglosc(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /** Filtrowanie. Każdy warunek jest opcjonalny; brak warunków = wszystko. */
  function szukaj(f = {}) {
    let out = wpisy;
    const ma = (x) => x !== undefined && x !== null && x !== '';

    if (ma(f.rok)) out = out.filter((w) => w.kiedy && w.kiedy.startsWith(String(f.rok)));
    if (ma(f.miesiac)) {
      const mm = String(f.miesiac).padStart(2, '0');
      out = out.filter((w) => w.kiedy && w.kiedy.slice(5, 7) === mm);
    }
    if (ma(f.od)) out = out.filter((w) => w.kiedy && w.kiedy >= f.od);
    if (ma(f.do)) out = out.filter((w) => w.kiedy && w.kiedy <= f.do);
    if (ma(f.typ)) out = out.filter((w) => w.typ === f.typ);
    if (ma(f.zrodlo)) out = out.filter((w) => w.zrodlo === f.zrodlo);
    if (ma(f.swiatlo)) out = out.filter((w) => w.swiatlo === f.swiatlo);

    // Teksty dopasowujemy fragmentem: „R6" ma znaleźć „Canon EOS R6m2".
    for (const pole of ['aparat', 'obiektyw', 'miejsce', 'nazwa']) {
      if (ma(f[pole])) {
        const igla = String(f[pole]).toLowerCase();
        out = out.filter((w) => (w[pole] || '').toLowerCase().includes(igla));
      }
    }
    if (ma(f.obiekt)) {
      const igla = String(f.obiekt).toLowerCase();
      out = out.filter((w) => w.obiekty.some((o) => o.toLowerCase().includes(igla)));
    }
    for (const [pole, min, max] of [
      ['ogniskowa', f.ogniskowaOd, f.ogniskowaDo],
      ['iso', f.isoOd, f.isoDo],
      ['przyslona', f.przyslonaOd, f.przyslonaDo],
    ]) {
      if (ma(min)) out = out.filter((w) => w[pole] !== null && w[pole] >= Number(min));
      if (ma(max)) out = out.filter((w) => w[pole] !== null && w[pole] <= Number(max));
    }
    if (ma(f.ogniskowa)) out = out.filter((w) => w.ogniskowa === Number(f.ogniskowa));

    if (ma(f.lat) && ma(f.lon)) {
      const promien = Number(f.promienKm) || 1;
      out = out.filter((w) => w.lat !== null
        && odleglosc(Number(f.lat), Number(f.lon), w.lat, w.lon) <= promien);
    }

    // Najnowsze pierwsze — przy przeglądaniu materiału to jedyny sensowny domyślny porządek.
    return [...out].sort((a, b) => String(b.kiedy || '').localeCompare(String(a.kiedy || '')));
  }

  /** Zestawienie liczbowe: ile czego, pogrupowane po dowolnym polu. */
  function zestawienie(pole, filtr = {}) {
    const dozwolone = ['aparat', 'obiektyw', 'ogniskowa', 'iso', 'przyslona',
      'typ', 'zrodlo', 'swiatlo', 'rok', 'miesiac', 'miejsce'];
    if (!dozwolone.includes(pole)) return null;
    const grupy = new Map();
    for (const w of szukaj(filtr)) {
      let klucz;
      if (pole === 'rok') klucz = w.kiedy ? w.kiedy.slice(0, 4) : null;
      else if (pole === 'miesiac') klucz = w.kiedy ? w.kiedy.slice(0, 7) : null;
      else klucz = w[pole];
      if (klucz === null || klucz === undefined || klucz === '') klucz = '(brak danych)';
      grupy.set(String(klucz), (grupy.get(String(klucz)) || 0) + 1);
    }
    const lista = [...grupy.entries()]
      .map(([wartosc, ile]) => ({ wartosc, ile }))
      .sort((a, b) => b.ile - a.ile);
    /* Pokrycie danych. „6 zdjęć 50 mm w tym roku" brzmi jak fakt, a bywa
       artefaktem: gdy 2100 z 2106 plików nie ma zapisanej ogniskowej, to nie
       jest odpowiedź, tylko rozmiar luki w metadanych. Liczba musi jechać
       razem z wynikiem, bo model sam się nie domyśli, że powinien zapytać. */
    const brak = lista.find((g) => g.wartosc === '(brak danych)');
    const razem = lista.reduce((sum, g) => sum + g.ile, 0);
    return {
      grupy: lista,
      razem,
      zDanymi: razem - (brak ? brak.ile : 0),
      bezDanych: brak ? brak.ile : 0,
    };
  }

  function podsumowanie() {
    const zDatami = wpisy.filter((w) => w.kiedy).map((w) => w.kiedy).sort();
    return {
      wpisow: wpisy.length,
      zdjec: wpisy.filter((w) => w.typ === 'zdjecie').length,
      wideo: wpisy.filter((w) => w.typ === 'wideo').length,
      zGps: wpisy.filter((w) => w.lat !== null).length,
      zrodla: [...new Set(wpisy.map((w) => w.zrodlo))],
      najstarsze: zDatami[0] || null,
      najnowsze: zDatami[zDatami.length - 1] || null,
    };
  }

  function usunZrodlo(zrodlo) {
    const przed = wpisy.length;
    wpisy = wpisy.filter((w) => w.zrodlo !== zrodlo);
    przebuduj();
    zapiszWkrotce();
    return przed - wpisy.length;
  }

  /** Ustaw dom — wywoływane przy starcie i po zmianie lokalizacji. */
  function ustawDom(wspolrzedne) {
    domyslneWspolrzedne = wspolrzedne && Number.isFinite(wspolrzedne.lat) ? wspolrzedne : null;
  }

  /** Przelicz pory światła jeszcze raz — po ustawieniu domu wpisy bez GPS-u
   *  mają nagle z czego je policzyć, a były zapisane jako `null`. */
  function przeliczSwiatlo() {
    let zmienionych = 0;
    for (const w of wpisy) {
      const nowe = poraSwiatla(w);
      if (nowe !== w.swiatlo) {
        w.swiatlo = nowe;
        w.swiatloPrzyblizone = Boolean(nowe && w.lat === null);
        zmienionych++;
      }
    }
    if (zmienionych) zapiszWkrotce();
    return zmienionych;
  }

  return { dodaj, szukaj, zestawienie, podsumowanie, usunZrodlo, zapisz,
    ustawDom, przeliczSwiatlo, ile: () => wpisy.length, poraSwiatla };
}

module.exports = { utworz, lokalnyNaUtc };

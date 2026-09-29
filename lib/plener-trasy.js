/* ============================================================
   Plener – plan zdjęciowy, misja drona, aparat Canon, zestaw sprzętu

   Wydzielone z server.js (propozycja podziału zespołu IT, krok 4). Wszystko,
   co liczy światło, nastawy i ujęcia dla konkretnego miejsca i sprzętu –
   i to, co tę wiedzę oddaje dalej: dronowi (plik KMZ) i aparatowi (CCAPI).
   Stan osoby (zapisany sprzęt, lokalizacja) wyłącznie przez U() wołane
   W FUNKCJI – nigdy wartość przy starcie (zasada 4 z CLAUDE.md).
   ============================================================ */

const path = require('node:path');
const { swiatloDnia, zaIleMinut } = require('./slonce.js');
const { evZeSlonca, dobierz, evZPomiaru, orientacja, rozpoznajObiektywy } = require('./ekspozycja.js');
const { pogodaDla, strefaDla } = require('./pogoda.js');
const { wspolrzedneMiejsca } = require('./miejsca.js');
const { prognozaZorzy } = require('./zorza.js');
const { rozpoznajTemat } = require('./tematy.js');
const { planUjec, optykaDrona } = require('./ujecia.js');
const canon = require('./canon.js');
const { misjaKmz, siatka } = require('./kmz.js');
const { zapiszAtomowo } = require('./rdzen.js');
const { zapiszLubBlad } = require('./miejsce.js');

/**
 * @param {object} z
 * @param {Function} z.U         stan bieżącej osoby (lib/stan-osoby.js)
 * @param {Function} z.readJson  odczyt JSON-a z żądania
 * @param {Function} z.sendJson  odpowiedź JSON
 * @param {Function} z.addEvent  dziennik zdarzeń
 * @param {Function} z.bladZapisu odpowiedź na nieudany zapis (507/500)
 */
/** „HH:MM” w strefie MIEJSCA (albo procesu = strefa właściciela, lib/rdzen.js). */
function hhmm(d, strefa) {
  if (!d) return null;
  try { return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', ...(strefa ? { timeZone: strefa } : {}) }); } catch {
    return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }
}
function godzinyLokalne(sw, strefa, teraz = new Date()) {
  const zakres = (z) => (z && z.od && z.do ? `${hhmm(z.od, strefa)}–${hhmm(z.do, strefa)}` : null);
  return {
    strefa: strefa || process.env.TZ || null,
    teraz: hhmm(teraz, strefa),
    wschod: hhmm(sw.wschod, strefa),
    zachod: hhmm(sw.zachod, strefa),
    zlotaRano: zakres(sw.zlotaRano),
    zlotaWieczor: zakres(sw.zlotaWieczor),
    niebieskaWieczor: zakres(sw.niebieskaWieczor),
  };
}

/** Przesunięcie strefy względem UTC (ms) w danej chwili. */
function przesuniecieStrefy(chwilaMs, strefa) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: strefa, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const c = Object.fromEntries(f.formatToParts(new Date(chwilaMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+c.year, +c.month - 1, +c.day, +c.hour, +c.minute, +c.second) - chwilaMs;
}

/** „2026-10-02T19:00” bez strefy = 19:00 w strefie MIEJSCA. Z oznaczeniem
 *  strefy (Z, +02:00) albo bez znanej strefy miejsca – jak dotąd. */
function chwilaWStrefie(tekst, strefa) {
  const s = String(tekst || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!strefa || !m) return new Date(s);
  const naiwna = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0));
  let wynik = naiwna - przesuniecieStrefy(naiwna, strefa);
  wynik = naiwna - przesuniecieStrefy(wynik, strefa);   // druga iteracja: zmiana czasu tego dnia
  return new Date(wynik);
}

/* EV₁₀₀ typowego pokoju przy lampach wieczorem (salon, biurko): 5–6.
   Przy f/4 i 1/50 s to ISO 1600–3200, czyli tyle, ile naprawdę trzeba. */
const EV_WNETRZA = 5.5;

/* Nagłówek danych planu dla modelu – jak po znaczniku [PLAN:] (public/narzedzia.js). */
const NAGLOWEK_PLANU = 'DANE PLANU ZDJĘCIOWEGO (policzone przez Cosmosa dla miejsca i sprzętu użytkownika – '
  + 'użyj ich zamiast własnych szacunków):\n';

function utworz({ U, readJson, sendJson, addEvent, bladZapisu }) {
  /* SPRZĘT użytkownika – domyślny zestaw do planu zdjęciowego.
   *
   * Osobno od profilu, bo profil jest wolnym tekstem DLA MODELU, a to są dane
   * DLA NARZĘDZIA: z nich liczy się przysłona i ogniskowa. Marcin podał swój
   * zestaw raz („24-105 f/4, 70-200 f/4, 50 f/1.8") i nie ma powodu, żeby
   * wpisywał go przy każdym pytaniu – a model nie ma powodu go zgadywać.
   *
   * Podanie obiektywu w rozmowie ZAWSZE wygrywa z tym zapisem: sprzęt bywa
   * pożyczony, a jedno zdanie w czacie jest świeższe niż ustawienie sprzed
   * miesiąca.
   */
  const SPRZET_FILE = () => path.join(U().katalog, 'sprzet.json');
  function saveSprzet(dane) {
    const sprzet = {
      korpus: String((dane && dane.korpus) || '').slice(0, 120),
      obiektywy: String((dane && dane.obiektywy) || '').slice(0, 400),
      /* Dron, gimbal, statyw, slider. Osobne pole, bo to NIE jest optyka –
         nie wpływa na ekspozycję, ale przesądza, których ujęć da się w ogóle
         nakręcić. Wpisywane jak człowiek mówi: „Mavic 3, Ronin-S, statyw". */
      dodatki: String((dane && dane.dodatki) || '').slice(0, 300),
    };
    // Pamięć zmienia się dopiero po udanym zapisie – inaczej po błędzie pokazywałaby coś, czego nie ma na dysku.
    const blad = zapiszLubBlad('sprzętu', () => zapiszAtomowo(SPRZET_FILE(), JSON.stringify(sprzet)));
    if (!blad) U().sprzet = sprzet;
    return blad;
  }

  /* Asystent planu zdjęciowego – to, czego nie ma żaden asystent w chmurze.
     ChatGPT nie wie, gdzie stoisz, która jest u Ciebie godzina ani jaki masz
     sprzęt. Cosmos wie wszystko troje, więc może policzyć konkretne nastawy
     zamiast opowiadać ogólniki o „złotej godzinie". */

  /* Plan liczony jako FUNKCJA – ta sama dla trasy /api/plan (znacznik [PLAN:]
     i panel Pleneru) i dla fotografa w zespole agentów (lib/zespol.js), który
     dostaje liczby policzone przez Cosmosa zamiast zgadywać godziny. Biegnie
     w kontekście osoby (U(): jej sprzęt, lokalizacja). Oddaje
     { ok: true, dane } albo { ok: false, powod, blad, miejsceNieznane? };
     `dane` to dokładnie ciało odpowiedzi trasy. */
  async function liczPlan(d, signal) {
    /* Współrzędne: z żądania (telefon w terenie) albo zapisane w Ustawieniach.
       `Number(null)` to ZERO, nie NaN – pierwsza wersja przy braku lokalizacji
       liczyła więc światło dla punktu 0°N 0°E na Atlantyku i oddawała to jako
       poprawną odpowiedź. Stąd jawne sprawdzenie „czy w ogóle jest wartość". */
    /* Nazwa miejsca ma pierwszeństwo przed zapisaną lokalizacją, bo znaczy
       „planuję zdjęcia TAM", a nie „stoję tutaj". Kiedyś takiego parametru nie
       było wcale: na „w sobotę kręcę w Krakowie" model musiał zgadnąć
       współrzędne z pamięci albo zignorować miejsce – a złota godzina policzona
       dla złego punktu wygląda tak samo wiarygodnie jak dla dobrego. */
    let zNazwy = null;
    let miejsceNieznane = '';
    if (d.miejsce && !(Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lon)))) {
      zNazwy = await wspolrzedneMiejsca(String(d.miejsce), { signal });
      // Tura porzucona w trakcie geokodowania – nie liczymy dalej (null to tu „przerwane”, nie „nie ma miejsca”).
      if (!zNazwy && signal && signal.aborted) return { ok: false, powod: 'przerwane', blad: 'Przerwane.' };
      if (!zNazwy) miejsceNieznane = String(d.miejsce).slice(0, 80);
    }

    /* Nieznane miejsce NIE spada na zapisaną lokalizację. Dawniej plan dla
       „Palma de Mallorca” przy chwilowej awarii wyszukiwarki miejsc liczył się
       po cichu dla Krakowa i wyglądał tak samo wiarygodnie (agencja, runda 5).
       Teraz 400 z prośbą o krótszą nazwę; model spróbuje jeszcze raz. */
    const zapis = miejsceNieznane ? {} : (U().wspolrzedne || {});
    const surowyLat = d.lat ?? (zNazwy && zNazwy.lat) ?? zapis.lat;
    const surowyLon = d.lon ?? (zNazwy && zNazwy.lon) ?? zapis.lon;
    const lat = surowyLat === null || surowyLat === undefined ? NaN : Number(surowyLat);
    const lon = surowyLon === null || surowyLon === undefined ? NaN : Number(surowyLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return {
        ok: false,
        powod: miejsceNieznane ? 'miejsce-nieznane' : 'brak-lokalizacji',
        // dla interfejsu: człowiek dostaje własny, przetłumaczony komunikat
        ...(miejsceNieznane ? { miejsceNieznane } : {}),
        blad: miejsceNieznane
          /* Komunikat mówi MODELOWI, co ma zrobić dalej – bo to on go czyta
             jako pierwszy. Bez tego przy „Cala d'Or, Hotel Barceló Ponent Beach"
             model dwa razy prosił Marcina o lokalizację, którą już dostał,
             zamiast spróbować samej nazwy miejscowości. Pytanie użytkownika
             o coś, co da się wywnioskować z jego poprzedniego zdania, jest
             najgorszą możliwą reakcją. */
          ? `Nie udało się ustalić współrzędnych miejsca „${miejsceNieznane}". `
            + 'SPRÓBUJ JESZCZE RAZ z samą nazwą miejscowości lub regionu, bez hotelu, '
            + 'plaży i ulicy (np. „Palma" zamiast „Palma, Hotel Barceló Ponent Beach"). '
            + 'Dopiero gdy i to nie zadziała, zapytaj użytkownika – i nie pytaj go '
            + 'o miejsce, które już podał.'
          /* Komunikat musi podać drogę, którą da się przejść STĄD. „Podaj lat
             i lon w żądaniu" to instrukcja dla programisty, a nie dla człowieka
             patrzącego na panel – a tuż nad tym napisem jest pole „Miejsce",
             w które wystarczy wpisać nazwę. */
          : 'Nie znam Twoich współrzędnych. Wpisz nazwę miejsca w polu „Miejsce" '
            + '(Plener → Plan zdjęciowy) albo ustaw lokalizację na stałe '
            + 'w Ustawieniach przyciskiem „📍 Wykryj".',
      };
    }

    /* Strefa MIEJSCA, nie serwera: „jutro 19:00 w Reykjavíku” to 19:00 tam.
       Z prognozy Open-Meteo (ta sama odpowiedź, więc bez dodatkowego pytania
       przy pogodzie z pamięci). Bez niej – strefa właściciela i jawne zdanie. */
    const wlasnaStrefa = zNazwy || d.lat !== undefined;
    // Bez `kiedy` strefa jest potrzebna tylko do podpisu godzin – dociągamy ją
    // po pogodzie (z pamięci), żeby wnętrze nie czekało na zawieszoną usługę.
    let strefa = wlasnaStrefa && d.kiedy ? await strefaDla(lat, lon) : null;
    const kiedy = d.kiedy ? chwilaWStrefie(d.kiedy, strefa) : new Date();
    if (Number.isNaN(kiedy.getTime())) return { ok: false, powod: 'zla-data', blad: 'Zła data.' };

    const swiatlo = swiatloDnia(kiedy, lat, lon);
    const jasnoscWstepna = Number(d.jasnosc);
    const wnetrzeWstepnie = d.zachmurzenie === 'wnetrze'
      || (Number.isFinite(jasnoscWstepna) && jasnoscWstepna >= 0.2 && swiatlo.teraz.wysokosc < -6);

    /* Zachmurzenie: z prognozy, chyba że użytkownik wybrał je ręcznie w panelu.
       Ręczny wybór wygrywa – stoisz na miejscu i widzisz niebo lepiej niż
       model pogodowy dla kwadratu kilometra. */
    /* Pogoda i zorza lecą RÓWNOLEGLE i obie są tylko dodatkiem – żadna nie może
       wstrzymać planu. Zorzy nie pytamy w biały dzień: przy Słońcu wysoko nad
       horyzontem odpowiedź jest znana z góry i byłoby to marnowanie sekundy. */
    /* We wnętrzu ani pogoda, ani zorza nic nie zmieniają – a zawieszona usługa
       kazała czekać 7 s na każde odświeżenie nastaw (zespół IT, runda 5). */
    const ciemnoBedzie = swiatlo.teraz.wysokosc < 6 && !wnetrzeWstepnie;
    const [pogoda, zorza] = await Promise.all([
      (d.zachmurzenie || wnetrzeWstepnie) ? Promise.resolve(null) : pogodaDla(lat, lon, kiedy),
      ciemnoBedzie ? prognozaZorzy(lat, lon).catch(() => null) : Promise.resolve(null),
    ]);
    if (wlasnaStrefa && !strefa && (pogoda || (zNazwy && !wnetrzeWstepnie))) strefa = await strefaDla(lat, lon);
    const zachmurzenie = (d.zachmurzenie !== 'wnetrze' && d.zachmurzenie)
      || (pogoda && pogoda.zachmurzenie) || 'bezchmurnie';

    /* EV liczymy ze Słońca, a gdy przeglądarka zmierzyła jasność podglądu –
       korygujemy pomiarem. Model nie wie, czy stoisz w cieniu budynku. */
    let ev = evZeSlonca(swiatlo.teraz.wysokosc, zachmurzenie);
    let zrodloEv = 'pozycja Słońca';
    /* WNĘTRZE. Zgłoszenie Marcina ze zrzutem: laptop w salonie wieczorem,
       Słońce 29° pod horyzontem (EV −6) i „ISO 12800” dla oświetlonego pokoju,
       bo pomiar z kamery szedł średnią ze Słońcem. Kamera laptopa sama
       dobiera ekspozycję, więc jasność obrazu nie mówi, ile jest światła –
       ale NOCĄ normalnie jasny obraz znaczy jedno: światło sztuczne. Wtedy,
       albo gdy ktoś wybrał „W pomieszczeniu”, liczymy dla wnętrza: z pomiaru,
       jeśli przeglądarka podała prawdziwą ekspozycję kamery, inaczej z typowego
       EV oświetlonego pokoju. */
    const jasnosc = jasnoscWstepna;
    const wnetrze = wnetrzeWstepnie;
    if (wnetrze) {
      ev = (Number.isFinite(jasnosc) && d.pomiar) ? evZPomiaru(jasnosc, d.pomiar) : EV_WNETRZA;
      zrodloEv = d.pomiar ? 'pomiar z kamery (wnętrze)' : 'typowe oświetlone wnętrze';
    } else if (Number.isFinite(jasnosc) && d.pomiar) {
      /* Tylko z PRAWDZIWĄ ekspozycją kamery. Bez niej jasność kadru nic nie
         mówi (kamera laptopa sama się doświetla), a średnia ze Słońcem dawała
         w dzień w pokoju nastawy o ~5 działek za ciemne (agencja, runda 5).
         Wnętrze w dzień: opcja „W pomieszczeniu”. */
      const zmierzony = evZPomiaru(jasnosc, d.pomiar || {});
      // Ufamy pomiarowi, ale nie bezgranicznie: telefon potrafi się pomylić
      // przy mocnym kontraście, więc bierzemy średnią ważoną.
      ev = ev * 0.4 + zmierzony * 0.6;
      zrodloEv = 'pomiar z kamery + pozycja Słońca';
    }

    /* Obiektywy przychodzą tak, jak je człowiek napisał („24-70 f/2.8 i 70-200 f/4”),
       bo wpisuje je Marcin w rozmowie, a nie formularz. Rozbiciem zajmuje się
       `rozpoznajObiektywy`; gdy nic nie da się odczytać, `dobierz` po prostu
       liczy jak dawniej – dla korpusu. */
    /* Gdy w pytaniu nie padł żaden obiektyw, bierzemy zestaw zapisany
       w Plenerze. Podanie szkła wprost zawsze wygrywa. */
    const zPytania = Array.isArray(d.obiektyw)
      ? d.obiektyw.flatMap((x) => rozpoznajObiektywy(String(x)))
      : rozpoznajObiektywy(d.obiektyw || '');
    const zUstawien = zPytania.length ? [] : rozpoznajObiektywy(U().sprzet.obiektywy || '');
    const szkla = zPytania.length ? zPytania : zUstawien;
    const nieRozpoznane = (d.obiektyw && !zPytania.length) ? String(d.obiektyw).slice(0, 120) : '';

    const ustawienia = dobierz(ev, {
      sprzet: d.sprzet || U().sprzet.korpus || undefined, tryb: d.tryb, klatki: d.klatki,
      ogniskowa: d.ogniskowa, ruch: d.ruch, glebia: d.glebia,
      obiektyw: szkla, temat: d.temat,
    });
    /* Bez prognozy niebo jest ZAŁOŻENIEM, nie faktem. Model przekazywał
       „bezchmurnie” jako prognozę (agencja, runda 5). */
    const bezPrognozy = !pogoda && !d.zachmurzenie && !wnetrze;
    if (bezPrognozy) {
      ustawienia.powody.push('Nie mam prognozy pogody dla tej chwili, więc liczę jak dla bezchmurnego '
        + 'nieba. Przy chmurach dołóż 1–2 działki światła (dłuższy czas albo wyższe ISO).');
    }
    if (wlasnaStrefa && !strefa && zNazwy) {
      ustawienia.powody.push(`Nie udało się ustalić strefy czasu dla „${zNazwy.nazwa}”, więc godziny podaję `
        + `w strefie ${process.env.TZ || 'serwera'}. Jeśli to inna strefa niż tam, przelicz je.`);
    }
    if (nieRozpoznane) {
      ustawienia.powody.unshift(`Nie udało się odczytać obiektywu z „${nieRozpoznane}”, więc liczone dla samego `
        + 'korpusu. Podaj ogniskową i jasność, np. „24-70 f/2.8”, a obliczenie uwzględni to szkło.');
    }

    /* LISTA UJĘĆ – tylko przy wideo, bo tylko tam ma sens. Przy zdjęciu pytanie
       brzmi „jakie nastawy", a przy filmie „co w ogóle nakręcić, żeby dało się
       to potem zmontować" – i to jest pytanie, na które nikt nie odpowiada
       liczbami. Lista jest przefiltrowana przez SPRZĘT: bez drona nie ma ujęć
       z góry, a POMINIĘTE oddajemy osobno, bo „nie ma na liście" i „nie masz
       czym" to dla planującego dzień dwie różne informacje. */
    const ujecia = d.tryb === 'zdjecie' ? null : planUjec({
      temat: (rozpoznajTemat(d.temat || '') || {}).klucz,
      obiektywy: szkla,
      /* Optyka drona osobno od obiektywów korpusu. Bez tego kadr z Mavica
         dostawał szkło od Canona – rada oparta na sprzęcie, którego nie da
         się zamontować, podważa całą resztę listy. */
      optykaDrona: optykaDrona(sprzetTekst(d)),
      dron: /dron|mavic|dji|air\s?\d|mini\s?\d/i.test(sprzetTekst(d)),
      gimbal: /gimbal|ronin|crane|osmo|ibis|stabiliz/i.test(sprzetTekst(d)),
      statyw: !/bez statyw/i.test(sprzetTekst(d)),
      slider: /slider|wózek|dolly/i.test(sprzetTekst(d)),
    });

    const kadr = orientacja(Number(d.szerokosc), Number(d.wysokosc));
    const czas = (x) => (x ? x.toISOString() : null);

    return { ok: true, dane: {
      // Gdy liczymy dla PODANEGO miejsca, to jego nazwa jest tu istotna –
      // inaczej odpowiedź mówiłaby o domu, a liczby dotyczyły Krakowa.
      miejsce: (zNazwy && zNazwy.nazwa) || U().location || null,
      miejsceZNazwy: Boolean(zNazwy),
      // Na kiedy liczony plan: „złota godzina TERAZ” tylko dla planu na teraz.
      kiedy: kiedy.toISOString(),
      wspolrzedne: { lat, lon },
      slonce: {
        wysokosc: swiatlo.teraz.wysokosc,
        azymut: swiatlo.teraz.azymut,
        faza: swiatlo.faza,
        wschod: czas(swiatlo.wschod),
        zachod: czas(swiatlo.zachod),
        zlotaRano: swiatlo.zlotaRano && { od: czas(swiatlo.zlotaRano.od), do: czas(swiatlo.zlotaRano.do) },
        zlotaWieczor: swiatlo.zlotaWieczor && { od: czas(swiatlo.zlotaWieczor.od), do: czas(swiatlo.zlotaWieczor.do) },
        niebieskaWieczor: swiatlo.niebieskaWieczor
          && { od: czas(swiatlo.niebieskaWieczor.od), do: czas(swiatlo.niebieskaWieczor.do) },
        // Ile zostało realnego czasu na ujęcie – to jest liczba, na którą się patrzy.
        doZlotejMin: zaIleMinut(swiatlo.zlotaWieczor && swiatlo.zlotaWieczor.od, kiedy),
        doZachoduMin: zaIleMinut(swiatlo.zachod, kiedy),
        /* Godziny czytelne dla człowieka, w strefie właściciela. Pola wyżej są
           w UTC (…Z) i model przepisywał je dosłownie: „zachód 16:31”, gdy
           w Krakowie było 18:31 (agencja, runda 5). */
        lokalnie: godzinyLokalne(swiatlo, strefa),
      },
      kadr,
      zrodloEv,
      wnetrze,
      pogoda,
      zorza,
      zachmurzenie: wnetrze ? 'wnętrze (niebo bez znaczenia)' : bezPrognozy ? 'nieznane (liczone jak bezchmurnie)' : zachmurzenie,
      ustawienia,
      ujecia,
    } };
  }

  async function handlePlanZdjeciowy(req, res) {
    let d;
    try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const w = await liczPlan(d || {});
    if (w.ok) return sendJson(res, 200, w.dane);
    // Te same ciała 400 co zawsze: przeglądarka rozpoznaje brak miejsca po polach.
    if (w.powod === 'zla-data') return sendJson(res, 400, { error: w.blad });
    return sendJson(res, 400, { ...(w.miejsceNieznane ? { miejsceNieznane: w.miejsceNieznane } : { brakLokalizacji: true }), error: w.blad });
  }

  /** Plan dla zespołu agentów: pola jak w /api/plan (`typ` = `tryb`), a do
   *  tego `tekst` – te same dane, które model dostaje po znaczniku [PLAN:] –
   *  i `tekstDlaRoli` dla fotografa, ODCHUDZONY (planDlaRoli). `signal`
   *  przerywa czekanie na geokoder (porzucona tura nie wisi w kolejce
   *  Nominatim przed innymi osobami – it-backend, dokładki). */
  async function policzPlan(wejscie, { signal } = {}) {
    const d = wejscie && typeof wejscie === 'object' ? { ...wejscie } : {};
    if (d.tryb === undefined && d.typ !== undefined) d.tryb = d.typ;
    const w = await liczPlan(d, signal);
    if (!w.ok) return w;
    return { ok: true, dane: w.dane, tekst: NAGLOWEK_PLANU + JSON.stringify(w.dane, null, 1),
      tekstDlaRoli: NAGLOWEK_PLANU + JSON.stringify(planDlaRoli(w.dane), null, 1) };
  }

  /* Plan dla roli: bez pól UTC („…Z” – mały model przepisywał je dosłownie,
     zachód 16:20 zamiast 18:20), godziny tylko czasu miejsca, `chwila` – dla
     której chwili są nastawy, lista ujęć tylko przy wideo. ~5000 → ~1500
     znaków (agencja-rozmowa, dokładki). */
  function planDlaRoli(dane) {
    const s = dane.slonce || {};
    const lok = s.lokalnie || {};
    let chwila = null;
    try {
      chwila = new Date(dane.kiedy).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        ...(lok.strefa ? { timeZone: lok.strefa } : {}) });
    } catch { chwila = hhmm(new Date(dane.kiedy)); }
    const z = dane.zorza;
    return {
      miejsce: dane.miejsce,
      wspolrzedne: dane.wspolrzedne,
      chwila: `${chwila}${s.faza ? ` (${s.faza})` : ''} – dla tej chwili policzone są „ustawienia” i położenie Słońca`,
      godziny: { strefa: lok.strefa, wschod: lok.wschod, zachod: lok.zachod, zlotaRano: lok.zlotaRano, zlotaWieczor: lok.zlotaWieczor,
        niebieskaWieczor: lok.niebieskaWieczor },
      slonce: { wysokosc: s.wysokosc, azymut: s.azymut, faza: s.faza, doZlotejMin: s.doZlotejMin, doZachoduMin: s.doZachoduMin },
      zachmurzenie: dane.zachmurzenie,
      ...(dane.pogoda ? { pogoda: dane.pogoda } : {}),
      ...(z ? { zorza: { kpTeraz: z.kpTeraz, kpSzczyt: z.szczyt ? z.szczyt.kp : null, szansa: z.szansa, uwaga: z.uwaga } } : {}),
      ...(dane.wnetrze ? { wnetrze: true } : {}),
      zrodloEv: dane.zrodloEv,
      ustawienia: dane.ustawienia,
      ...(dane.ujecia ? { ujecia: dane.ujecia } : {}),
    };
  }

  /* Wszystko, co użytkownik napisał o sprzęcie, w jednym worku – dodatki
   * (dron, gimbal, statyw) wpisuje się raz w Plenerze albo rzuca w zdaniu
   * „lecę z Mavikiem", a nie wypełnia formularza z polami wyboru. */
  function sprzetTekst(d) {
    return [d.sprzet, d.dodatki, U().sprzet.korpus, U().sprzet.dodatki]
      .filter(Boolean).join(' ');
  }

  async function handlePlener(req, res, p) {
    if (p === '/api/plan' && req.method === 'POST') return await handlePlanZdjeciowy(req, res);
    /* CANON CCAPI – aparat jako urządzenie, nie tylko temat rozmowy.
       Trzy trasy, bo tyle wystarczy: co tam stoi, co ma ustawione, i zmień to.
       Wyzwalanie migawki jest osobno i celowo nie ma go w podpowiedziach dla
       modelu – zdjęcie ma robić człowiek, a nie model, któremu wydawało się,
       że to dobry moment. */
    /* MISJA WAYPOINTOWA → plik KMZ. `senses/flightplan.py` liczy już wysokość,
       pokrycie i liczbę zdjęć; tu domykamy pętlę i oddajemy to dronowi.
       Odpowiedź jest PLIKIEM, nie JSON-em – trafia prosto do pobrania. */
    if (p === '/api/plan/mission' && req.method === 'POST') {
      let d;
      try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      try {
        const punkty = Array.isArray(d.punkty) && d.punkty.length
          ? d.punkty
          : siatka({
            lat: Number(d.lat), lon: Number(d.lon),
            szerokoscM: Number(d.szerokoscM) || 200,
            dlugoscM: Number(d.dlugoscM) || 200,
            odstepM: Number(d.odstepM) || 50,
            kierunek: Number(d.kierunek) || 0,
          });
        const buf = misjaKmz(punkty, d);
        const nazwa = String(d.nazwa || 'misja').replace(/[^\w-]+/g, '-').slice(0, 40);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.google-earth.kmz',
          'Content-Length': buf.length,
          'Content-Disposition': `attachment; filename="${nazwa}.kmz"`,
        });
        addEvent('plan', `misja waypointowa: ${punkty.length} punktów`);
        return res.end(buf);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (p === '/api/canon/status' && req.method === 'GET') {
      return sendJson(res, 200, await canon.stan());
    }
    if (p === '/api/canon/settings') {
      if (!canon.skonfigurowany()) {
        return sendJson(res, 503, { error: 'Nie ustawiono CANON_CCAPI_URL – patrz .env.example.' });
      }
      try {
        if (req.method === 'GET') {
          const w = await canon.nastawy();
          return sendJson(res, 200, { ...w, liczby: canon.naLiczby(w.nastawy) });
        }
        if (req.method === 'PUT') {
          const d = await readJson(req);
          const zmiany = [];
          /* Kolejność ma znaczenie: najpierw ISO, potem przysłona, na końcu
             czas. Aparat sam koryguje pozostałe nastawy pod tę, którą właśnie
             zmieniono, więc ustawienie czasu jako ostatniego zostawia go
             takim, jakiego chcieliśmy. */
          for (const nazwa of ['iso', 'przyslona', 'czas']) {
            if (d[nazwa] === undefined || d[nazwa] === null || d[nazwa] === '') continue;
            zmiany.push(await canon.ustaw(nazwa, d[nazwa]));
          }
          if (!zmiany.length) return sendJson(res, 400, { error: 'Nie podano żadnej nastawy.' });
          addEvent('aparat', `nastawy zmienione: ${zmiany.map((z) => `${z.nazwa}=${z.wartosc}`).join(', ')}`);
          return sendJson(res, 200, { ok: true, zmiany });
        }
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }
    if (p === '/api/canon/shutter' && req.method === 'POST') {
      if (!canon.skonfigurowany()) {
        return sendJson(res, 503, { error: 'Nie ustawiono CANON_CCAPI_URL – patrz .env.example.' });
      }
      let d = {};
      try { d = await readJson(req); } catch { /* domyślne */ }
      try {
        const w = await canon.migawka({ af: d.af === true });
        addEvent('aparat', 'migawka wyzwolona zdalnie');
        return sendJson(res, 200, w);
      } catch (err) {
        return sendJson(res, 502, { error: err.message });
      }
    }

    if (p === '/api/gear') {
      if (req.method === 'GET') return sendJson(res, 200, U().sprzet);
      if (req.method === 'PUT') {
        let dane;
        try { dane = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
        const blad = saveSprzet(dane);
        if (blad) return bladZapisu(res, blad);
        return sendJson(res, 200, { ok: true, ...U().sprzet });
      }
    }
    res.writeHead(405);
    res.end();
  }

  return { handlePlener, saveSprzet, policzPlan };
}

module.exports = { utworz };

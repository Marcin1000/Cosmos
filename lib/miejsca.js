/* ============================================================
   Nazwa miejsca → współrzędne

   Cosmos umiał tylko zamianę W DRUGĄ STRONĘ: ze współrzędnych z telefonu
   robił „Piaseczno". Nie umiał natomiast nic zrobić z tym, co człowiek
   naprawdę mówi: „w sobotę kręcę w Krakowie".

   Skutek był taki sam jak przy brakującym parametrze obiektywu – narzędzie
   nie miało gdzie przyjąć podanej informacji. Model musiał sam wymyślić
   szerokość i długość geograficzną z pamięci albo zignorować miejsce.
   Jedno i drugie kończy się źle: złota godzina policzona dla złego punktu
   wygląda równie wiarygodnie jak policzona dla dobrego.

   Współrzędne bierzemy z Nominatim (OpenStreetMap). Ich regulamin wymaga
   uczciwego User-Agenta i najwyżej jednego zapytania na sekundę – stąd
   pamięć podręczna i kolejka. Nazwy miejsc nie zmieniają się z godziny na
   godzinę, więc cache jest tu darmowym zyskiem, nie kompromisem.
   ============================================================ */

const SZUKAJ_URL = process.env.GEOCODE_SEARCH_URL
  || 'https://nominatim.openstreetmap.org/search';
const CZAS_MS = Number(process.env.GEOCODE_TIMEOUT_MS || 6000);
const UA = 'Cosmos/2.0 (prywatny asystent osobisty)';
/* Kraj, w którym szukamy NAJPIERW. Puste = od razu globalnie. */
const KRAJ = (process.env.GEOCODE_COUNTRY ?? 'pl').trim().toLowerCase();

// Nazwa → { lat, lon, nazwa } albo null. Trzymamy też negatywne odpowiedzi:
// „Wólka Nienazwana" nie zacznie nagle istnieć, a każde pytanie kosztuje.
const pamiec = new Map();
const PAMIEC_MAX = 200;
/* Klasy obiektów OSM, które są MIEJSCEM do planu albo archiwum (zapytanie
   krajowe – patrz pytaj()). Ulica, sklep, restauracja, hotel (tourism) – nie. */
const KLASY_MIEJSC = new Set(['place', 'boundary', 'natural', 'waterway', 'landuse', 'historic', 'mountain_pass']);
/* Klasa „place” obejmuje też pojedynczy adres (type house). „Sycylia” w Polsce
   to „Posmakuj Sycylii, 32” – adres lokalu, dla którego policzył się plan
   zdjęciowy wyjazdu na Sycylię (Marcin, runda 12). Adres i budynek to nie miejsce. */
const TYPY_NIE_MIEJSCA = new Set(['house', 'houses', 'building', 'address', 'plot', 'yes']);

/* Nominatim prosi o najwyżej jedno zapytanie na sekundę. Kolejkujemy je
   jedno za drugim zamiast wysyłać równolegle – to jest warunek korzystania
   z darmowej usługi, a nie nasza ostrożność. */
let ostatnie = 0;
let lancuch = Promise.resolve();
/* Błąd, który NIE jest winą usługi (bezpiecznik już zadziałał, wołający się
   wycofał) – nie przedłuża bezpiecznika i nie trafia do pamięci. */
class Wycofane extends Error {}
function poKolei(fn, signal) {
  const wynik = lancuch.then(async () => {
    /* Zapytania, które czekały w łańcuchu, gdy usługa padła: bezpiecznik
       sprawdzamy PRZED każdym, nie tylko przy wejściu – inaczej K-ta osoba
       czekała 6·K s na geokoder, o którym już wiadomo, że milczy (it-backend,
       dokładki: fotograf ruszał po 6, 12, 15 s). Porzucone też nie pytają. */
    if (uslugaNiedostepna()) throw new Wycofane('bezpiecznik');
    if (signal && signal.aborted) throw new Wycofane('przerwane');
    const odstep = 1100 - (Date.now() - ostatnie);
    if (odstep > 0) await new Promise((r) => setTimeout(r, odstep));
    if (uslugaNiedostepna()) throw new Wycofane('bezpiecznik');
    if (signal && signal.aborted) throw new Wycofane('przerwane');
    ostatnie = Date.now();
    return fn();
  });
  // Łańcuch nie może się urwać na błędzie jednego zapytania.
  lancuch = wynik.then(() => {}, () => {});
  return wynik;
}

/**
 * Znajdź współrzędne miejsca po nazwie.
 *
 * Zwraca `{ lat, lon, nazwa }` albo `null` – nigdy nie rzuca. Wołający
 * (plan zdjęciowy) ma działać dalej także wtedy, gdy usługa nie odpowiada:
 * lepiej policzyć dla znanej lokalizacji domowej i powiedzieć o tym wprost,
 * niż nie odpowiedzieć wcale.
 */
/* BEZPIECZNIK. Kolejka jest jedna dla wszystkich osób, a każde zapytanie do
   niedziałającej usługi czeka do 6 s: trzy osoby naraz dostawały odpowiedź po
   6, 12 i 18 s, a kilkanaście zapytań w kolejce kończyło się stroną 524
   Cloudflare'a (zespół IT, runda 5). Po odmowie usługi przez minutę nie pytamy
   wcale – `uslugaNiedostepna()` mówi wołającemu, że null znaczy „usługa
   milczy", a nie „nie ma takiego miejsca". */
const BEZPIECZNIK_MS = Number(process.env.GEOCODE_BEZPIECZNIK_MS) || 60_000;
let awariaDo = 0;
const uslugaNiedostepna = () => Date.now() < awariaDo;

/** `signal` (opcjonalny) – wołający się wycofał (tura zespołu zatrzymana,
 *  termin planu): zapytanie nie czeka dalej w kolejce i nie idzie do sieci. */
async function wspolrzedneMiejsca(nazwa, { signal } = {}) {
  const pytanie = String(nazwa || '').trim().slice(0, 120);
  if (pytanie.length < 2) return null;
  if (SZUKAJ_URL === 'off') return null;

  const klucz = pytanie.toLowerCase();
  if (pamiec.has(klucz)) return pamiec.get(klucz);
  if (uslugaNiedostepna()) return null;

  const zapamietaj = (co) => {
    if (pamiec.size >= PAMIEC_MAX) pamiec.delete(pamiec.keys().next().value);
    pamiec.set(klucz, co);
    return co;
  };

  /* NAJPIERW SZUKAMY W KRAJU UŻYTKOWNIKA.
     Nominatim sortuje globalnie po ważności, więc na „Mazury" pierwszym
     wynikiem na świecie jest wieś Мазури w obwodzie lwowskim. Cosmos liczył
     dla niej promień 5 km i uczciwie meldował „w archiwum nie ma zdjęć z tego
     miejsca" – Marcin dopytywał trzy razy, potwierdzał „chodzi o Polskę",
     a odpowiedź się nie zmieniała, bo do Nominatim leciało samo „Mazury".

     Zapytanie idzie więc dwa razy: najpierw ograniczone do kraju, potem –
     jeśli nic nie ma – bez ograniczenia. Dzięki temu „Zakopane" i „Mazury"
     trafiają w Polskę, a „Toskania" i „Lofoty" dalej działają. */
  /* Aktualnie sprawdzana wersja frazy – patrz „stopniowe upraszczanie" niżej.
     Zaczyna od pełnej, bo doprecyzowanie zwykle pomaga. */
  let pytanieBiezace = pytanie;
  async function pytaj(kraj) {
    /* W kraju – kilka wyników i tylko miejsca (miejscowość, region, jezioro,
       góra), nie dowolny obiekt: „Palermo” w Polsce to pizzeria albo ulica,
       a plan zdjęciowy liczył się dla niej zamiast dla Sycylii (agencja-backend,
       runda 11). Nominatim w jsonv2 podaje klasę w polu `category` (w json –
       `class`). Wynik bez klasy (inna usługa, atrapa) – przyjmujemy jak dawniej. */
    const p = new URLSearchParams({
      q: pytanieBiezace, format: 'jsonv2', limit: kraj ? '5' : '1', 'accept-language': 'pl',
    });
    if (kraj) p.set('countrycodes', kraj);
    const r = await poKolei(() => fetch(`${SZUKAJ_URL}?${p}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(CZAS_MS)]) : AbortSignal.timeout(CZAS_MS),
    }), signal);
    /* Odmowa usługi (429 za dużo zapytań, 403, 5xx) to NIE „nie ma takiego
       miejsca”. Dawniej wracało null, a null lądował w pamięci jako wynik:
       „Nie znalazłem miejsca Zakopane” aż do restartu serwera (agencja,
       runda 5). Rzucamy, więc niżej trafia w gałąź „nie zapamiętuj”. */
    if (!r.ok) throw new Error(`geokoder odpowiedział ${r.status}`);
    const d = await r.json();
    if (!Array.isArray(d)) return null;
    if (!kraj) return d[0] || null;
    return d.find((w) => {
      const klasa = w && (w.category ?? w.class);
      if (w && (TYPY_NIE_MIEJSCA.has(String(w.type || '')) || TYPY_NIE_MIEJSCA.has(String(w.addresstype || '')))) return false;
      return klasa === undefined || KLASY_MIEJSC.has(String(klasa));
    }) || null;
  }

  /* STOPNIOWE UPRASZCZANIE FRAZY.
   *
   *  Marcin poprosił o plan zdjęciowy na Majorce i podał „Cala d'Or, Hotel
   *  Barceló Ponent Beach". Geokoder nie zna nazw hoteli, więc na całą frazę
   *  nie oddał nic – a plan policzył się dla zapisanej lokalizacji w Polsce
   *  i wyszły nastawy na złotą godzinę o dwie strefy czasowe za daleko.
   *  Model dwa razy poprosił o lokalizację, którą już dostał.
   *
   *  Człowiek pisze miejsce tak, jak je nazywa, a nie tak, jak indeksuje je
   *  baza: dokleja hotel, plażę, nazwę wyspy, w dowolnej kolejności. Skoro
   *  jedna próba nie wystarcza, próbujemy kilku – odcinając kolejno człony
   *  od końca, a potem od początku. „Cala d'Or, Hotel Barceló Ponent Beach"
   *  daje wtedy „Cala d'Or" i trafia.
   *
   *  Trzy kandydatury, nie wszystkie możliwe: każda to osobne zapytanie
   *  z odstępem sekundy (wymóg Nominatim), a przy pierwszym trafieniu
   *  i tak kończymy. Pełna frazа idzie pierwsza, więc „Kraków, Polska"
   *  – gdzie doprecyzowanie POMAGA – działa jak dotąd. */
  const czlony = pytanie.split(',').map((x) => x.trim()).filter(Boolean);
  const kandydaci = [pytanie];
  if (czlony.length > 1) {
    kandydaci.push(czlony.slice(0, -1).join(', '));   // bez ostatniego członu
    kandydaci.push(czlony.slice(1).join(', '));       // bez pierwszego członu
  }
  const doSprawdzenia = [...new Set(kandydaci.map((x) => x.trim()).filter((x) => x.length >= 2))]
    .slice(0, 3);

  try {
    let t = null;
    for (const kandydat of doSprawdzenia) {
      pytanieBiezace = kandydat;
      t = (KRAJ ? await pytaj(KRAJ) : null) || await pytaj(null);
      if (t) break;
    }
    if (!t) return zapamietaj(null);
    const lat = Number(t.lat);
    const lon = Number(t.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return zapamietaj(null);
    /* Promień z obwiedni miejsca. „Kraków" to punkt, „Mazury" to region na
       kilkadziesiąt kilometrów – ten sam promień dla obu uciąłby większość
       materiału z regionu albo wciągnął pół województwa przy mieście.
       Nominatim podaje `boundingbox` [poludnie, polnoc, zachod, wschod]. */
    let promienKm = null;
    const bb = Array.isArray(t.boundingbox) ? t.boundingbox.map(Number) : null;
    if (bb && bb.length === 4 && bb.every(Number.isFinite)) {
      const wysokoscKm = Math.abs(bb[1] - bb[0]) * 111;
      const szerokoscKm = Math.abs(bb[3] - bb[2]) * 111 * Math.cos(lat * Math.PI / 180);
      // Połowa przekątnej obwiedni, z sensownymi widełkami.
      promienKm = Math.round(Math.max(5, Math.min(150,
        Math.sqrt(wysokoscKm ** 2 + szerokoscKm ** 2) / 2)));
    }
    return zapamietaj({
      lat: Number(lat.toFixed(5)),
      lon: Number(lon.toFixed(5)),
      promienKm,
      // `display_name` bywa bardzo długie („Kraków, województwo małopolskie,
      // Polska, …”) – bierzemy dwa pierwsze człony, resztę ucinamy.
      nazwa: String(t.display_name || pytanie).split(',').slice(0, 2).join(',').trim(),
    });
  } catch (err) {
    // Brak sieci albo przekroczony czas. NIE zapamiętujemy – usługa może
    // wrócić za minutę, a negatywny wpis zostałby z nami na długo.
    // Wycofanie wołającego (albo już działający bezpiecznik) to nie awaria usługi.
    if (!(err instanceof Wycofane) && !(signal && signal.aborted)) awariaDo = Date.now() + BEZPIECZNIK_MS;
    return null;
  }
}

/** Jak wspolrzedneMiejsca, ale mówi też, DLACZEGO nie ma wyniku:
 *  { wynik, powod: '' | 'brak' | 'usluga' }. */
async function szukajMiejsca(nazwa) {
  const wynik = await wspolrzedneMiejsca(nazwa);
  if (wynik) return { wynik, powod: '' };
  return { wynik: null, powod: uslugaNiedostepna() ? 'usluga' : 'brak' };
}

module.exports = { wspolrzedneMiejsca, szukajMiejsca, uslugaNiedostepna, _pamiec: pamiec,
  _zresetujBezpiecznik: () => { awariaDo = 0; } };

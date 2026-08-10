/* ============================================================
   Nazwa miejsca → współrzędne

   Cosmos umiał tylko zamianę W DRUGĄ STRONĘ: ze współrzędnych z telefonu
   robił „Złotokłos". Nie umiał natomiast nic zrobić z tym, co człowiek
   naprawdę mówi: „w sobotę kręcę w Krakowie".

   Skutek był taki sam jak przy brakującym parametrze obiektywu — narzędzie
   nie miało gdzie przyjąć podanej informacji. Model musiał sam wymyślić
   szerokość i długość geograficzną z pamięci albo zignorować miejsce.
   Jedno i drugie kończy się źle: złota godzina policzona dla złego punktu
   wygląda równie wiarygodnie jak policzona dla dobrego.

   Współrzędne bierzemy z Nominatim (OpenStreetMap). Ich regulamin wymaga
   uczciwego User-Agenta i najwyżej jednego zapytania na sekundę — stąd
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

/* Nominatim prosi o najwyżej jedno zapytanie na sekundę. Kolejkujemy je
   jedno za drugim zamiast wysyłać równolegle — to jest warunek korzystania
   z darmowej usługi, a nie nasza ostrożność. */
let ostatnie = 0;
let lancuch = Promise.resolve();
function poKolei(fn) {
  const wynik = lancuch.then(async () => {
    const odstep = 1100 - (Date.now() - ostatnie);
    if (odstep > 0) await new Promise((r) => setTimeout(r, odstep));
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
 * Zwraca `{ lat, lon, nazwa }` albo `null` — nigdy nie rzuca. Wołający
 * (plan zdjęciowy) ma działać dalej także wtedy, gdy usługa nie odpowiada:
 * lepiej policzyć dla znanej lokalizacji domowej i powiedzieć o tym wprost,
 * niż nie odpowiedzieć wcale.
 */
async function wspolrzedneMiejsca(nazwa) {
  const pytanie = String(nazwa || '').trim().slice(0, 120);
  if (pytanie.length < 2) return null;
  if (SZUKAJ_URL === 'off') return null;

  const klucz = pytanie.toLowerCase();
  if (pamiec.has(klucz)) return pamiec.get(klucz);

  const zapamietaj = (co) => {
    if (pamiec.size >= PAMIEC_MAX) pamiec.delete(pamiec.keys().next().value);
    pamiec.set(klucz, co);
    return co;
  };

  /* NAJPIERW SZUKAMY W KRAJU UŻYTKOWNIKA.
     Nominatim sortuje globalnie po ważności, więc na „Mazury" pierwszym
     wynikiem na świecie jest wieś Мазури w obwodzie lwowskim. Cosmos liczył
     dla niej promień 5 km i uczciwie meldował „w archiwum nie ma zdjęć z tego
     miejsca" — Marcin dopytywał trzy razy, potwierdzał „chodzi o Polskę",
     a odpowiedź się nie zmieniała, bo do Nominatim leciało samo „Mazury".

     Zapytanie idzie więc dwa razy: najpierw ograniczone do kraju, potem —
     jeśli nic nie ma — bez ograniczenia. Dzięki temu „Zakopane" i „Mazury"
     trafiają w Polskę, a „Toskania" i „Lofoty" dalej działają. */
  async function pytaj(kraj) {
    const p = new URLSearchParams({
      q: pytanie, format: 'jsonv2', limit: '1', 'accept-language': 'pl',
    });
    if (kraj) p.set('countrycodes', kraj);
    const r = await poKolei(() => fetch(`${SZUKAJ_URL}?${p}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(CZAS_MS),
    }));
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d) ? d[0] || null : null;
  }

  try {
    const t = (KRAJ ? await pytaj(KRAJ) : null) || await pytaj(null);
    if (!t) return zapamietaj(null);
    const lat = Number(t.lat);
    const lon = Number(t.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return zapamietaj(null);
    /* Promień z obwiedni miejsca. „Kraków" to punkt, „Mazury" to region na
       kilkadziesiąt kilometrów — ten sam promień dla obu uciąłby większość
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
      // Polska, …”) — bierzemy dwa pierwsze człony, resztę ucinamy.
      nazwa: String(t.display_name || pytanie).split(',').slice(0, 2).join(',').trim(),
    });
  } catch {
    // Brak sieci albo przekroczony czas. NIE zapamiętujemy — usługa może
    // wrócić za minutę, a negatywny wpis zostałby z nami na długo.
    return null;
  }
}

module.exports = { wspolrzedneMiejsca, _pamiec: pamiec };

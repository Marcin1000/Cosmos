/* ============================================================
   Canon CCAPI — R6 II jako urządzenie, którym Cosmos steruje

   Aparat Marcina od firmware'u 1.7.0 wystawia **Camera Control API**: zwykły
   REST po HTTP, przez Wi-Fi, z odpowiedziami w JSON-ie. Dla Cosmosa to
   idealne dopasowanie — ZERO ZALEŻNOŚCI, samo `fetch`.

   Dlaczego to jest naprawa, a nie kolejna funkcja. Mamy już `senses/tether.py`,
   który steruje aparatem przez gPhoto2 po kablu USB. Tyle że gPhoto2 na
   Windowsie wymaga WSL, a Marcin pracuje na Windowsie — więc ten moduł
   w praktyce nigdy nie ruszył. CCAPI omija to całkowicie: rozmawia z nim
   Node, bez zmysłów, bez Pythona, bez kabla.

   Co z tego wynika w rozmowie: Cosmos przestaje mówić „ustaw 1/250, f/8,
   ISO 200" i zaczyna mówić „masz teraz 1/60, f/4, ISO 1600 — poprawiam".
   Różnica między poradą a działaniem.

   ŚCIEŻEK NIE ZASZYWAMY NA SZTYWNO. CCAPI istnieje w kilku wersjach
   (`ver100`, `ver110`, `ver120`…) i każdy model wystawia inny podzbiór.
   Zaszyte `\/ccapi\/ver100\/shooting\/settings\/iso` działałoby na jednym
   aparacie, a na innym dawało 404, którego nikt by nie zrozumiał. Zamiast
   tego pytamy `GET /ccapi` — korzeń oddaje SPIS obsługiwanych ścieżek — i po
   nim szukamy. Aparat sam mówi, co potrafi.

   GRANICA, KTÓRĄ TRZEBA POWIEDZIEĆ WPROST: to działa tylko wtedy, gdy Cosmos
   i aparat są w tej samej sieci. Serwer na VPS-ie nie dosięgnie aparatu
   stojącego w domu na biurku — Wi-Fi aparatu to sieć lokalna, a nie coś,
   do czego da się wejść z internetu. Czyli: Cosmos uruchomiony na laptopie
   w domu — tak; Cosmos na VPS-ie — nie, i mówi o tym zamiast milczeć.
   ============================================================ */

const ADRES = (process.env.CANON_CCAPI_URL || '').replace(/\/+$/, '');
const LIMIT_MS = Number(process.env.CANON_TIMEOUT_MS || 6000);

function skonfigurowany() {
  return Boolean(ADRES);
}

async function zapytaj(sciezka, { metoda = 'GET', dane = null, limitMs = LIMIT_MS } = {}) {
  const r = await fetch(`${ADRES}${sciezka}`, {
    method: metoda,
    headers: dane ? { 'Content-Type': 'application/json' } : undefined,
    body: dane ? JSON.stringify(dane) : undefined,
    signal: AbortSignal.timeout(limitMs),
  });
  const tekst = await r.text();
  let tresc = null;
  try { tresc = tekst ? JSON.parse(tekst) : null; } catch { tresc = { surowe: tekst.slice(0, 300) }; }
  if (!r.ok) {
    /* CCAPI oddaje sensowne komunikaty w polu `message` — przekazujemy je
       dalej zamiast gołego numeru. „Device busy" mówi człowiekowi znacznie
       więcej niż „HTTP 503". */
    const powod = (tresc && (tresc.message || tresc.error)) || `HTTP ${r.status}`;
    const err = new Error(String(powod));
    err.status = r.status;
    throw err;
  }
  return tresc;
}

/* Spis ścieżek, które ten konkretny aparat obsługuje. Trzymamy go krótko
   w pamięci: między jednym pytaniem a drugim nie zmienia się nigdy, ale po
   przełączeniu aparatu w inny tryb — owszem. */
let spis = { kiedy: 0, sciezki: [] };
const SPIS_WAZNY_MS = 60_000;

async function sciezki() {
  if (Date.now() - spis.kiedy < SPIS_WAZNY_MS && spis.sciezki.length) return spis.sciezki;
  const korzen = await zapytaj('/ccapi');
  /* Odpowiedź to obiekt: { "ver100": [ { path, get, post, put, delete }, ... ],
     "ver110": [...] }. Spłaszczamy do samych ścieżek — wersja nas nie
     interesuje, interesuje nas, czy dana funkcja w ogóle istnieje. */
  const out = [];
  for (const lista of Object.values(korzen || {})) {
    if (!Array.isArray(lista)) continue;
    for (const wpis of lista) if (wpis && wpis.path) out.push(String(wpis.path));
  }
  spis = { kiedy: Date.now(), sciezki: out };
  return out;
}

/** Znajdź ścieżkę kończącą się na `koncowka` (np. `shooting/settings/iso`).
 *  Zwraca `null`, gdy aparat jej nie wystawia — i to jest normalna odpowiedź,
 *  nie awaria: w trybie filmowania część nastaw znika. */
async function znajdz(koncowka) {
  const wszystkie = await sciezki();
  const pasuje = wszystkie.filter((s) => s.endsWith(koncowka));
  if (!pasuje.length) return null;
  // Przy kilku wersjach bierzemy najnowszą — sortowanie po nazwie wystarcza,
  // bo `ver120` > `ver110` > `ver100` także alfabetycznie.
  return pasuje.sort()[pasuje.length - 1];
}

/** Kto tam w ogóle jest po drugiej stronie. */
async function informacje() {
  const s = await znajdz('deviceinformation');
  if (!s) throw new Error('Aparat nie wystawia informacji o urządzeniu.');
  const d = await zapytaj(s);
  return {
    model: d.productname || d.manufacturer || null,
    numer: d.serialnumber || null,
    firmware: d.firmwareversion || null,
  };
}

/* Nastawy, które nas interesują, i ich nazwy po ludzku. CCAPI używa skrótów
   z żargonu Canona: `av` to przysłona (aperture value), `tv` czas (time
   value). Nie tłumaczymy ich w kodzie na siłę, bo w dokumentacji aparatu
   i tak są pod tymi nazwami — tłumaczymy dopiero na wyjściu. */
const NASTAWY = {
  iso: 'shooting/settings/iso',
  przyslona: 'shooting/settings/av',
  czas: 'shooting/settings/tv',
  balansBieli: 'shooting/settings/wb',
  trybEkspozycji: 'shooting/settings/shootingmodedial',
};

/**
 * Bieżące nastawy aparatu.
 *
 * Każdą pobieramy OSOBNO i awaria jednej nie kasuje pozostałych. Gdy aparat
 * stoi w trybie automatycznym, przysłona bywa niedostępna do odczytu — i to
 * jest informacja, a nie powód, żeby nie pokazać ISO.
 */
async function nastawy() {
  const out = {};
  const bledy = {};
  for (const [nazwa, koncowka] of Object.entries(NASTAWY)) {
    try {
      const s = await znajdz(koncowka);
      if (!s) { bledy[nazwa] = 'aparat nie wystawia tej nastawy w tym trybie'; continue; }
      const d = await zapytaj(s);
      out[nazwa] = d && d.value !== undefined ? d.value : d;
      // `ability` to lista dopuszczalnych wartości — bez niej nie da się
      // sensownie zaproponować zmiany, bo aparat przyjmuje tylko swoje.
      if (d && Array.isArray(d.ability)) out[`${nazwa}Mozliwe`] = d.ability;
    } catch (err) {
      bledy[nazwa] = err.message;
    }
  }
  return { nastawy: out, bledy: Object.keys(bledy).length ? bledy : null };
}

/**
 * Ustaw jedną nastawę.
 *
 * Sprawdzamy wartość przeciw liście `ability` ZANIM ją wyślemy. Aparat i tak
 * odrzuci nieswoją, ale jego komunikat („Invalid parameter") nie mówi, co
 * wolno — a lista wolnych wartości jest tuż obok i można ją pokazać.
 */
async function ustaw(nazwa, wartosc) {
  const koncowka = NASTAWY[nazwa];
  if (!koncowka) throw new Error(`Nie znam nastawy „${nazwa}".`);
  const s = await znajdz(koncowka);
  if (!s) throw new Error(`Aparat nie pozwala teraz zmienić: ${nazwa}.`);

  const teraz = await zapytaj(s);
  const mozliwe = teraz && Array.isArray(teraz.ability) ? teraz.ability : null;
  const chciana = String(wartosc);
  if (mozliwe && !mozliwe.includes(chciana)) {
    throw new Error(`„${chciana}" nie jest dostępne. Aparat przyjmie: ${mozliwe.join(', ')}`);
  }
  await zapytaj(s, { metoda: 'PUT', dane: { value: chciana } });
  return { nazwa, wartosc: chciana, poprzednia: teraz ? teraz.value : null };
}

/**
 * Wyzwól migawkę.
 *
 * `af` domyślnie WYŁĄCZONY. Autofokus przed zdjęciem wygląda na uprzejmość,
 * ale przy zdalnym wyzwalaniu jest pułapką: aparat na statywie z ustawioną
 * ręcznie ostrością (astro, makro, focus stacking) przy każdym strzale
 * przeostrzyłby się na coś innego i seria byłaby do wyrzucenia.
 */
async function migawka({ af = false } = {}) {
  const s = await znajdz('shooting/control/shutterbutton');
  if (!s) throw new Error('Aparat nie pozwala teraz wyzwolić migawki (sprawdź tryb i kartę).');
  await zapytaj(s, { metoda: 'POST', dane: { af: Boolean(af) }, limitMs: Math.max(LIMIT_MS, 15000) });
  return { ok: true, af: Boolean(af) };
}

/**
 * Stan połączenia — do panelu, bez rzucania wyjątkami.
 * Zawsze oddaje obiekt: „nie ma aparatu" to normalny stan, nie błąd.
 */
async function stan() {
  if (!skonfigurowany()) {
    return { skonfigurowany: false, online: false,
      powod: 'Nie ustawiono CANON_CCAPI_URL — patrz .env.example.' };
  }
  try {
    const info = await informacje();
    return { skonfigurowany: true, online: true, ...info };
  } catch (err) {
    return {
      skonfigurowany: true,
      online: false,
      /* Najczęstsza przyczyna nie jest oczywista: aparat usypia Wi-Fi po
         kilku minutach bezczynności, a serwer na VPS-ie nie widzi sieci
         domowej w ogóle. Mówimy o obu, bo komunikat „fetch failed" nie
         podpowiada niczego. */
      powod: `Aparat nie odpowiada pod ${ADRES}: ${err.message}. `
        + 'Sprawdź, czy Wi-Fi w aparacie jest włączone (usypia je po kilku minutach) '
        + 'i czy Cosmos działa w tej samej sieci co aparat.',
    };
  }
}

/** Przysłona i czas w zapisie CCAPI („f4.0", „1/250") → liczby Cosmosa.
 *  Potrzebne, żeby porównać to, co aparat MA USTAWIONE, z tym, co plan
 *  zdjęciowy POLICZYŁ — bez tego byłyby to dwa nieporównywalne światy. */
function naLiczby(n) {
  const out = { iso: null, przyslona: null, czasS: null };
  if (!n) return out;
  const iso = Number(String(n.iso || '').replace(/[^\d]/g, ''));
  if (Number.isFinite(iso) && iso > 0) out.iso = iso;
  const av = Number(String(n.przyslona || '').replace(/^f/i, '').replace(',', '.'));
  if (Number.isFinite(av) && av > 0) out.przyslona = av;
  const tv = String(n.czas || '').trim();
  const ulamek = tv.match(/^1\/([\d.]+)$/);
  if (ulamek) out.czasS = 1 / Number(ulamek[1]);
  else {
    // Długie czasy Canon zapisuje z sekundnikiem: „4"" albo „0"3".
    const sek = Number(tv.replace(/["']/g, '').replace(',', '.'));
    if (Number.isFinite(sek) && sek > 0) out.czasS = sek;
  }
  return out;
}

/** Zapomnij spis ścieżek. Aparat wystawia inny zestaw w każdym trybie —
 *  po przekręceniu pokrętła bufor sprzed minuty opisuje już nieprawdę. */
function zapomnij() {
  spis = { kiedy: 0, sciezki: [] };
}

module.exports = { skonfigurowany, stan, informacje, nastawy, ustaw, migawka,
  naLiczby, zapomnij, NASTAWY };

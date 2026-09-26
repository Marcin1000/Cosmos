/* ============================================================
   Zadania w tle – praca dłuższa niż cierpliwość Cloudflare

   Cloudflare zrywa żądanie, na które serwer nie odpowie w 100 s, i pokazuje
   swoją stronę 524. Studio generowało wszystko w jednym żądaniu: obraz gpt-image
   w wysokiej jakości trwa minutę-dwie, cztery warianty po kolei do kilku minut,
   storyboard to model plus do sześciu obrazów. Za tunelem kończyło się to 524,
   choć serwer liczył dalej i zapisywał wynik do bazy wiedzy – człowiek widział
   błąd, płacił za obraz i nie wiedział, że go ma.

   Teraz trasa ZACZYNA zadanie i czeka na nie do CZEKAJ_MS:
     – zdąży (zwykły przypadek): odpowiada jak dawniej, tym samym kształtem,
       więc mostek MCP i starsze karty działają bez zmian,
     – nie zdąży: odpowiada 202 z numerem zadania, a przeglądarka dopytuje
       GET /api/zadania?id=…, aż praca się skończy.

   Praca biegnie niezależnie od połączenia. Telefon, który w międzyczasie uśpił
   kartę, dostanie wynik po powrocie – dopóki zadanie jest w pamięci (TRZYMAJ_MS).

   Zadanie należy do osoby, która je zaczęła: cudzy numer daje 404, tak samo
   jak nieistniejący. Kontekst osoby (AsyncLocalStorage) idzie za pracą sam,
   bo zadanie rusza w obsłudze żądania.
   ============================================================ */

const { ktoWymagany } = require('./kontekst.js');
const { genId, sendJson } = require('./rdzen.js');

/* 75 s, nie 95: do czasu pracy dochodzi odczyt żądania, zapis do bazy wiedzy
   i droga przez tunel – a 524 przychodzi po 100 s od WYSŁANIA żądania. */
const CZEKAJ_MS = Number(process.env.COSMOS_CZEKAJ_NA_ZADANIE_MS) || 75_000;

/** Ile zakończone zadanie czeka na odbiór. */
const TRZYMAJ_MS = Number(process.env.COSMOS_ZADANIE_TTL_MS) || 60 * 60_000;

/** Ile zadań jednej osoby może pracować naraz. Studio płaci za każde wywołanie,
 *  a 202 zwalnia przycisk – bez limitu dało się zlecić dziesiątki obrazów. */
const NARAZ = Number(process.env.COSMOS_ZADANIA_NARAZ) || 3;

/** Twardy sufit pamięci: najstarsze zakończone wypadają pierwsze. */
const MAKS_W_PAMIECI = 500;

class ZaDuzoZadan extends Error {
  constructor(ile) {
    super(`Pracuje już ${ile} zadań Studia naraz – poczekaj, aż któreś się skończy.`);
    this.kod = 429;
  }
}

function utworzZadania({ czekajMs = CZEKAJ_MS, trzymajMs = TRZYMAJ_MS, naraz = NARAZ } = {}) {
  const zadania = new Map(); // id → zadanie

  function sprzatnij() {
    if (zadania.size <= MAKS_W_PAMIECI) return;
    for (const [id, z] of zadania) {
      if (z.stan !== 'pracuje') zadania.delete(id);
      if (zadania.size <= MAKS_W_PAMIECI) break;
    }
  }

  /** Ile zadań bieżącej osoby jeszcze pracuje. */
  function ilePracuje() {
    const osoba = ktoWymagany('zadania w tle').id;
    let ile = 0;
    for (const z of zadania.values()) if (z.osoba === osoba && z.stan === 'pracuje') ile++;
    return ile;
  }

  /** Zacznij pracę w imieniu bieżącej osoby. `praca` zwraca dane odpowiedzi
   *  (jak dla 200) albo rzuca błąd – z polem `kod`, gdy to nie ma być 502. */
  function zacznij(rodzaj, opis, praca) {
    const osoba = ktoWymagany('zadanie w tle').id;
    if (ilePracuje() >= naraz) throw new ZaDuzoZadan(naraz);

    const z = {
      id: genId(), osoba, rodzaj, opis: String(opis || '').slice(0, 200),
      stan: 'pracuje', kod: 0, dane: null, od: Date.now(), do: 0,
    };
    z.obietnica = (async () => {
      try {
        z.dane = await praca();
        z.kod = 200;
        z.stan = 'gotowe';
      } catch (err) {
        z.kod = err.kod || 502;
        z.dane = { error: err.message };
        z.stan = 'blad';
      }
      z.do = Date.now();
      setTimeout(() => zadania.delete(z.id), trzymajMs).unref();
    })();
    zadania.set(z.id, z);
    sprzatnij();
    return z;
  }

  /** Odpowiedz na żądanie, które zaczęło zadanie: wynikiem, jeśli zdąży,
   *  albo 202 z numerem do dopytywania. */
  async function odpowiedz(res, z) {
    let czasomierz;
    const zdazylo = await Promise.race([
      z.obietnica.then(() => true),
      new Promise((ok) => { czasomierz = setTimeout(() => ok(false), czekajMs); }),
    ]);
    clearTimeout(czasomierz);
    if (zdazylo) {
      // Odebrane od razu – nikt już o nie nie zapyta.
      zadania.delete(z.id);
      return sendJson(res, z.kod, z.dane);
    }
    return sendJson(res, 202, { ok: true, zadanie: z.id, rodzaj: z.rodzaj, stan: 'pracuje', sekund: Math.round((Date.now() - z.od) / 1000) });
  }

  /** Zadanie bieżącej osoby albo nic – cudze wygląda jak nieistniejące. */
  function wez(id) {
    const z = zadania.get(String(id || ''));
    return z && z.osoba === ktoWymagany('zadanie w tle').id ? z : null;
  }

  /** GET /api/zadania?id=… */
  function obsluzStan(req, res) {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const z = wez(id);
    if (!z) {
      return sendJson(res, 404, { error: 'Nie ma takiego zadania – mogło się skończyć dawno temu albo serwer uruchomiono ponownie.' });
    }
    if (z.stan === 'pracuje') {
      return sendJson(res, 200, { stan: 'pracuje', rodzaj: z.rodzaj, sekund: Math.round((Date.now() - z.od) / 1000) });
    }
    zadania.delete(z.id);
    if (z.stan === 'blad') return sendJson(res, 200, { stan: 'blad', error: z.dane.error, kod: z.kod });
    return sendJson(res, 200, { stan: 'gotowe', wynik: z.dane });
  }

  /** Ile zadań pracuje – wszystkich osób. Zamknięcie serwera daje im czas, jak biegom czatu. */
  function ileWszystkich() {
    let ile = 0;
    for (const z of zadania.values()) if (z.stan === 'pracuje') ile++;
    return ile;
  }

  return { zacznij, odpowiedz, wez, obsluzStan, ilePracuje, ileWszystkich, czekajMs, naraz };
}

module.exports = { utworzZadania, ZaDuzoZadan };

/* Konta po stronie przeglądarki – trzy rzeczy, których nie widać w teście
   serwera, a które decydują o prywatności na wspólnym telefonie.

   1. LINK Z ZAPROSZENIEM. Token siedzi we fragmencie po `#`, więc nie trafia
      do logów serwera ani Cloudflare. Rozpoznajemy tylko dokładny kształt –
      przypadkowy `#zaproszenie` w adresie nie może otwierać ekranu dołączania.

   2. PAMIĘĆ PODRĘCZNA ROZMÓW. Przeglądarka trzyma kopie rozmów do pracy bez
      sieci. Marcin wylogowuje się na telefonie, loguje się ktoś z rodziny –
      przy pierwszym zaniku sieci zobaczyłby rozmowy Marcina. Kopia musi
      znikać przy zmianie osoby, a ustawienia urządzenia (język) zostawać.

   3. IMIĘ GOŚCIA W PANELU WŁAŚCICIELA. Imię wpisuje zaproszona osoba, a czyta
      je właściciel. Gdyby panel składał wiersze przez `innerHTML`, imię
      `<img src=x onerror=…>` wykonałoby kod w sesji właściciela. Sprawdzamy
      na atrapie DOM-u, że żaden węzeł panelu nie ma treści HTML, a imię
      stoi w nim jako zwykły tekst.
*/
const path = require('node:path');
const { zainstalujDom, Element } = require(path.join(__dirname, '..', 'atrapy', 'maly-dom.js'));
const { utworzKonta } = require(path.join(__dirname, '..', '..', 'public', 'konta.js'));

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const t = (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k);

function magazyn(poczatek = {}) {
  const m = new Map(Object.entries(poczatek));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    klucze: () => [...m.keys()].sort(),
  };
}

(async () => {
  const dom = zainstalujDom();
  const elementy = new Map();
  const $ = (id) => { if (!elementy.has(id)) elementy.set(id, new Element('div')); return elementy.get(id); };
  const k = utworzKonta({ $, t });

  // --- 1. Link z zaproszeniem ---------------------------------------------
  const TOKEN = 'Ab3_dE-fGhIjKlMnOpQrStUv';
  ok(k.tokenZaproszenia(`#zaproszenie=${TOKEN}`) === TOKEN, 'poprawny link → token');
  ok(k.tokenZaproszenia('#zaproszenie=krotki') === '', 'za krótki token nie otwiera ekranu dołączania');
  ok(k.tokenZaproszenia(`#inne=${TOKEN}`) === '', 'inny fragment nie otwiera ekranu dołączania');
  ok(k.tokenZaproszenia(`#zaproszenie=${TOKEN}<script>`) === '', 'znaki spoza alfabetu tokenu – odrzucone');

  // --- 2. Pamięć podręczna rozmów ---------------------------------------------
  const m = magazyn({
    'cosmos.conv.abc': '{"title":"rozmowa Marcina"}', 'cosmos.convIndex': '[{"id":"abc"}]',
    'cosmos.kbSelected': '["x"]', 'cosmos.lang': 'pl', 'cosmos.micId': 'kinect',
  });
  ok(k.pilnujWlascicielaPamieci({ id: 'wlasciciel' }, m) === false, 'pierwsze logowanie niczego nie czyści');
  ok(m.getItem('cosmos.conv.abc') !== null, 'kopia właściciela zostaje, dopóki loguje się właściciel');
  ok(k.pilnujWlascicielaPamieci({ id: 'wlasciciel' }, m) === false, 'ponowne logowanie tej samej osoby niczego nie czyści');
  ok(k.pilnujWlascicielaPamieci({ id: 'u-ania' }, m) === true, 'logowanie innej osoby wykryte');
  ok(m.getItem('cosmos.conv.abc') === null && m.getItem('cosmos.convIndex') === null,
    'po zmianie osoby kopia rozmów poprzedniej zniknęła');
  ok(m.getItem('cosmos.kbSelected') === null, 'zaznaczenia w bazie wiedzy poprzedniej osoby też zniknęły');
  ok(m.getItem('cosmos.lang') === 'pl' && m.getItem('cosmos.micId') === 'kinect',
    'ustawienia urządzenia (język, mikrofon) zostały');
  ok(m.getItem('cosmos.kto') === 'u-ania', 'przeglądarka pamięta, czyja jest teraz kopia');

  // --- 3. Imię gościa w panelu właściciela --------------------------------------
  const ZLE_IMIE = '<img src=x onerror="fetch(\'/api/konta/uzytkownik?id=wlasciciel\',{method:\'DELETE\'})">';
  global.location = { origin: 'https://cosmosai.live', pathname: '/', hash: '' };
  global.navigator = {};
  global.fetch = async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url).startsWith('/api/konta') ? {
      logowanie: true,
      silnikiSerwera: { local: false, openai: true, claude: false, studio: false },
      uzytkownicy: [
        { id: 'wlasciciel', login: 'marcin', nazwa: 'Marcin', rola: 'wlasciciel', zuzycie: {} },
        { id: 'u-1', login: 'gosc', nazwa: ZLE_IMIE, rola: 'czlonek', silniki: { openai: false }, zuzycie: { wiadomosci: 3 } },
      ],
      zaproszenia: [{ id: 'z1', nazwa: ZLE_IMIE, wygasa: Date.now() + 1e6 }],
    } : {}),
  });
  k.zastosujRole({ id: 'wlasciciel', rola: 'wlasciciel' });
  await k.odswiezDostep();
  const lista = $('dostep-lista');
  const zapr = $('dostep-zaproszenia');
  const htmlGdziekolwiek = (el) => Boolean(el._html) || el.children.some(htmlGdziekolwiek);
  ok(lista.children.length === 2, `panel pokazuje obie osoby (${lista.children.length})`);
  ok(!htmlGdziekolwiek(lista) && !htmlGdziekolwiek(zapr), 'żaden węzeł panelu Dostęp nie ma treści HTML – wszystko przez textContent');
  ok(lista.textContent.includes(ZLE_IMIE), 'imię gościa stoi w panelu jako zwykły tekst, znak po znaku');
  ok(zapr.textContent.includes(ZLE_IMIE), 'imię z zaproszenia też jako tekst');
  const przelaczniki = lista.children[1].poKlasie('osoba-silnik');
  ok(przelaczniki.length === 4, 'członek ma cztery przełączniki silników');

  // Członek nie widzi panelu Dostęp
  k.zastosujRole({ id: 'u-1', rola: 'czlonek' });
  await k.odswiezDostep();
  ok($('dostep-blok').hidden === true, 'członkowi panel Dostęp się nie pokazuje');
  ok(dom.dokument.body.classList.contains('rola-czlonek'), 'rola członka oznaczona na <body> (ukrywa elementy właściciela)');

  dom.odinstaluj();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKONTA W PRZEGLĄDARCE OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

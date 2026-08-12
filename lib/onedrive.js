/* ============================================================
   OneDrive — źródło materiału do archiwum

   Dlaczego akurat OneDrive, a nie tylko dysk domowy: tam trafia większość
   zdjęć Marcina (2 TB), a indeks budowany z chmury mieszka na VPS-ie. Dzięki
   temu „ile klipów 50 mm w tym roku" odpowiada z telefonu w terenie, przy
   wyłączonym komputerze domowym.

   Microsoft Graph oddaje metadane zdjęcia (aparat, nastawy, GPS) i miniaturę
   BEZ pobierania oryginału. Przy dwóch terabajtach to różnica między
   indeksowaniem w minutach a w tygodniach.

   Token odświeżający zapisujemy na dysku serwera — to sekret równoważny
   dostępowi do plików, więc plik dostaje prawa 0600 i nigdy nie wychodzi
   do przeglądarki.
   ============================================================ */

const fs = require('node:fs');
const { zapiszAtomowo } = require('./rdzen.js');
const path = require('node:path');
const { czytajExif, czytajXmpDrona } = require('./exif.js');

const AUTORYZACJA = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const GRAF = 'https://graph.microsoft.com/v1.0';
// `offline_access` jest tu kluczowe: bez niego dostajemy token na godzinę
// i indeksowanie trzeba by autoryzować od nowa przy każdym uruchomieniu.
const ZAKRES = 'Files.Read offline_access';

/* Pola, o które PYTAMY WPROST.
   Bez `$select` Graph przy jednoczesnym `$expand` oddaje tylko domyślny,
   okrojony zestaw właściwości — i właśnie dlatego pierwsze indeksowanie
   2106 plików dało wszystkie `lat`, `lon` i `swiatlo` puste. Facety `photo`
   i `location` trzeba wymienić z nazwy, inaczej po prostu nie przychodzą,
   a indeks wygląda na kompletny i nie jest. */
const POLA = ['id', 'name', 'size', 'folder', 'file', 'image', 'photo',
  'location', 'parentReference', 'fileSystemInfo', 'createdDateTime'].join(',');
const ZAPYTANIE = `$top=200&$select=${POLA}&$expand=thumbnails($select=small)`;

/* Ile początku pliku wystarczy na EXIF. 128 KB mieści segment APP1 nawet
   z podglądem miniaturki; przy plikach Canona bywa ~60 KB. */
const POCZATEK_PLIKU_B = Number(process.env.ONEDRIVE_EXIF_BYTES || 131072);

const OBRAZY = /\.(jpe?g|png|heic|heif|tiff?|dng|cr2|cr3|arw|nef|raf)$/i;
const FILMY = /\.(mp4|mov|m4v|avi|mkv|mts|m2ts|webm)$/i;
// Telemetria DJI leży obok klipu jako osobny plik o tej samej nazwie.
const TELEMETRIA = /\.srt$/i;

/** Data zrobienia zdjęcia wyczytana z NAZWY pliku.
 *
 *  Aparaty numerują (`IMG_4821.CR3`) i tu nie ma czego szukać, ale telefony
 *  i OneDrive datują — a to właśnie te pliki mają najczęściej bezużyteczną
 *  datę systemową. Rozpoznajemy trzy zapisy, które realnie występują
 *  u Marcina:
 *      20220814_153012.jpg          Samsung, także IMG_/VID_/PXL_ z przodu
 *      Screenshot_20220814-153012   zrzuty z Androida
 *      2022-08-14 15.30.12.jpg      tak nazywa OneDrive wysyłki z telefonu
 *
 *  Zwracamy czas ŚCIENNY, bez strefy — reszta Cosmosa tak trzyma czas
 *  zdjęcia (patrz lib/exif.js), a data z nazwy jest z definicji lokalna.
 *
 *  Zakres roku 1990–2099 i pełna walidacja składników są tu po to, żeby
 *  `DSC_20231245_996100.jpg` albo numer seryjny nie zostały wzięte za datę:
 *  wpis z fałszywą datą jest gorszy niż wpis bez daty, bo wchodzi
 *  do sortowania i do filtrów `rok=`.
 *
 *  @param {string} nazwa nazwa pliku
 *  @returns {string|null} `RRRR-MM-DDTHH:MM:SS` albo null
 */
function dataZNazwy(nazwa) {
  const m = String(nazwa).match(
    /(19[9]\d|20\d\d)[-.]?(\d{2})[-.]?(\d{2})[ _T-](\d{2})[-.:]?(\d{2})[-.:]?(\d{2})/,
  );
  if (!m) return null;
  const [, r, mi, d, g, min, s] = m;
  const nr = (x) => Number(x);
  if (nr(mi) < 1 || nr(mi) > 12 || nr(d) < 1 || nr(d) > 31) return null;
  if (nr(g) > 23 || nr(min) > 59 || nr(s) > 59) return null;
  // Data z przyszłości znaczy, że trafiliśmy w coś, co datą nie jest.
  const kiedy = `${r}-${mi}-${d}T${g}:${min}:${s}`;
  if (kiedy > new Date(Date.now() + 86400000).toISOString().slice(0, 19)) return null;
  return kiedy;
}

function utworz({ katalogDanych, clientId, clientSecret, redirectUri }) {
  const PLIK = path.join(katalogDanych, 'onedrive.json');
  let stan = null;
  try { stan = JSON.parse(fs.readFileSync(PLIK, 'utf8')); } catch { /* niepołączone */ }

  const skonfigurowany = () => Boolean(clientId && clientSecret && redirectUri);
  const polaczony = () => Boolean(stan && stan.refresh_token);

  function zapisz() {
    try {
      zapiszAtomowo(PLIK, JSON.stringify(stan), { mode: 0o600 });
    } catch (err) {
      console.error('Nie udało się zapisać poświadczeń OneDrive:', err.message);
    }
  }

  /** Adres, pod który wysyłamy użytkownika, żeby zalogował się u Microsoftu. */
  function adresLogowania(stanCsrf) {
    const q = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: ZAKRES,
      state: stanCsrf,
    });
    return `${AUTORYZACJA}?${q}`;
  }

  async function wymienNaToken(pola) {
    const r = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        ...pola,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Komunikat Microsoftu bywa jedyną wskazówką, co źle w rejestracji —
      // szkoda go gubić, ale opis potrafi mieć kilka kilobajtów.
      throw new Error(d.error_description ? String(d.error_description).slice(0, 300)
        : `Microsoft odpowiedział ${r.status}`);
    }
    stan = {
      refresh_token: d.refresh_token || (stan && stan.refresh_token),
      access_token: d.access_token,
      wygasa: Date.now() + (Number(d.expires_in || 3600) - 120) * 1000,
      od: (stan && stan.od) || Date.now(),
    };
    zapisz();
    return stan;
  }

  const polacz = (code) => wymienNaToken({ code, grant_type: 'authorization_code' });

  async function token() {
    if (!polaczony()) throw new Error('OneDrive niepołączony.');
    if (stan.access_token && Date.now() < stan.wygasa) return stan.access_token;
    await wymienNaToken({ refresh_token: stan.refresh_token, grant_type: 'refresh_token' });
    return stan.access_token;
  }

  /* ============ HAMULEC NA DŁAWIENIE (429) ============
     Microsoft Graph przy nadmiarze żądań odpowiada 429 i podaje w nagłówku
     `Retry-After`, ile sekund odczekać. To nie jest awaria — to prośba
     o zwolnienie, i jedyna poprawna reakcja jest taka: odczekać i spróbować
     ponownie TYM SAMYM żądaniem.

     Marcin zobaczył „Przerwane: kolejka nie maleje (50963 do zrobienia).
     Powód: Graph 429" — bo 429 leciało jako zwykły błąd, cała paczka trzystu
     plików przepadała, kolejka nie malała i przeglądarka słusznie zatrzymywała
     zadanie. Sześć równoległych żądań okazało się ponad to, co jego konto
     przyjmuje.

     Przerwa jest WSPÓLNA dla wszystkich robotników. Gdyby każdy odczekiwał
     osobno, pozostałych pięciu waliłoby dalej w zamknięte drzwi i Graph
     przedłużałby karę. */
  let przerwaDo = 0;
  let dlawien = 0;
  /* Ile łącznie przeczekaliśmy na prośbę Graph. Bez tego licznika czekanie
     wliczało się w czas pobierania adresu miniatury i pomiar kłamał: przy
     dwudziestu czterech robotnikach panel pokazał „adres 20415 ms", co
     wyglądało jak zamulony Microsoft, a było naszą własną karą za zbyt
     szybkie pytanie. Etap i kara to dwie różne rzeczy i mają się liczyć
     osobno. */
  let czekanoMs = 0;
  let pauzaOd = 0;
  const zdlawienia = () => dlawien;
  const czekano = () => czekanoMs;

  function zatrzymajNa(sekund) {
    const ile = Math.min(Math.max(Number(sekund) || 10, 1), 300);
    const teraz = Date.now();
    // Początek NOWEJ pauzy — kolejne 429 w trakcie trwającej tylko ją wydłużają.
    if (przerwaDo <= teraz) pauzaOd = teraz;
    przerwaDo = Math.max(przerwaDo, teraz + ile * 1000);
    dlawien++;
  }

  /** Odczekaj wspólną pauzę. Zwraca, ILE TO ŻĄDANIE przestało — żeby
   *  wywołujący mógł odjąć karę od czasu etapu. Bez tego panel pokazywał
   *  „adres 16083 ms" dla zwykłego JPG-a i wyglądało to na zamulony Graph,
   *  a było naszą karą doliczoną do pomiaru. */
  async function poczekajNaOkno(sygnal) {
    const wejscie = Date.now();
    for (;;) {
      const zostalo = przerwaDo - Date.now();
      /* Liczymy CZAS ZEGAROWY pauzy, nie sumę czekań robotników. Pierwsza
         wersja sumowała po robotnikach i przy szesnastu wyszło „przestój
         890 s" w paczce, która trwała dwie i pół minuty — liczba prawdziwa
         arytmetycznie i bezużyteczna w odbiorze. Zamyka ją ten, kto pierwszy
         zobaczy koniec pauzy. */
      if (zostalo <= 0 || (sygnal && sygnal.przerwane)) {
        if (pauzaOd) { czekanoMs += Date.now() - pauzaOd; pauzaOd = 0; }
        return Date.now() - wejscie;
      }
      await new Promise((r) => setTimeout(r, Math.min(zostalo, 1000)));
    }
  }

  /** Żądanie do Graph z poszanowaniem `Retry-After`.
   *
   *  `zbudujOpcje` jest funkcją, a nie obiektem, bo token może w międzyczasie
   *  wygasnąć — przy odczekiwaniu trzydziestu sekund to realne.
   */
  const PROB_DLAWIENIA = Math.min(Math.max(Number(process.env.ONEDRIVE_PROBY) || 4, 0), 10);
  async function zadanieGraf(url, zbudujOpcje, pomiar = null) {
    for (let proba = 0; ; proba++) {
      const kara = await poczekajNaOkno();
      if (pomiar) pomiar.czekano = (pomiar.czekano || 0) + kara;
      const r = await fetch(url, await zbudujOpcje());
      // 429 = za szybko, 503/509 = chwilowo niedostępne. Wszystkie trzy
      // znaczą „spróbuj później", a nie „nie da się".
      if (r.status !== 429 && r.status !== 503 && r.status !== 509) return r;
      if (proba >= PROB_DLAWIENIA) return r;
      const naglowek = Number(r.headers.get('retry-after'));
      // Bez nagłówka rośniemy sami: 5, 10, 20, 40 s.
      zatrzymajNa(Number.isFinite(naglowek) && naglowek > 0 ? naglowek : 5 * 2 ** proba);
    }
  }

  /* Odpowiedzi, po których nie ma sensu wracać do TEGO pliku — nigdy.
   *
   *  416 („Requested Range Not Satisfiable") dostajemy dla plików PUSTYCH:
   *  prosimy o bajty 0-7999999, a w pliku nie ma ani jednego. 404 i 410 to
   *  plik skasowany albo przeniesiony między indeksowaniem a odczytem.
   *
   *  Traktowanie ich jak zwykłego błędu zablokowało Marcinowi całą kolejkę:
   *  „Przerwane: kolejka nie maleje (4 do zrobienia). Powód: Graph 416".
   *  Cztery puste pliki .SRT potrafiły zatrzymać zadanie, bo wpis nigdy nie
   *  dostawał znacznika „sprawdzony" i wracał w każdej paczce.
   *
   *  Ponawianie tu nie pomaga: to znaczy „nigdy", a nie „później". Zwracamy
   *  „pusto" zamiast rzucać — wywołujący oznaczy plik jako przerobiony
   *  i kolejka ruszy dalej. */
  const BEZNADZIEJNE = new Set([404, 410, 416]);

  async function graf(sciezka, pomiar = null) {
    const url = sciezka.startsWith('http') ? sciezka : `${GRAF}${sciezka}`;
    const r = await zadanieGraf(url, async () => ({
      headers: { Authorization: `Bearer ${await token()}` },
      signal: AbortSignal.timeout(30000),
    }), pomiar);
    if (!r.ok) {
      const tresc = await r.text().catch(() => '');
      throw new Error(`Graph ${r.status}: ${tresc.slice(0, 200)}`);
    }
    return r.json();
  }

  /** Zamień pozycję z Graph na wpis archiwum. `null` = to nie jest materiał. */
  function naWpis(el) {
    const nazwa = el.name || '';
    const jestObraz = OBRAZY.test(nazwa);
    const jestFilm = FILMY.test(nazwa);
    if (!jestObraz && !jestFilm) return null;

    const foto = el.photo || {};
    const gps = el.location || {};
    /* Graph oddaje `takenDateTime` w UTC z „Z". Reszta Cosmosa trzyma czas
       zdjęcia jako lokalny czas ścienny (patrz lib/exif.js), więc obcinamy
       strefę i traktujemy jak wszystkie inne — inaczej te same zdjęcia
       z OneDrive i z dysku wpadałyby do różnych pór światła. */
    /* SKĄD JEST DATA — bo trzy źródła znaczą trzy różne rzeczy.
     *
     *  Marcin: „nie idzie od najnowszych zdjęć, bo pokazuje zdjęcia gór
     *  z 2022 roku". Sortowanie było poprawne; kłamała data. Graph wypełnia
     *  `photo.takenDateTime` dla JPEG-ów, ale dla RAW-ów (CR2/CR3/NEF) już
     *  nie — a wtedy spadaliśmy na `createdDateTime`, czyli na moment, w którym
     *  plik trafił do OneDrive'a. Zdjęcie z gór zrobione w 2022 i wgrane
     *  w 2026 wyglądało więc na najnowsze w całym archiwum i uczciwie lądowało
     *  na górze listy.
     *
     *  Kolejność zaufania: EXIF → data z NAZWY pliku → data pliku. Nazwa jest
     *  lepsza od daty pliku, bo `20220814_153012.jpg`, `PXL_20220814_…`
     *  i `2022-08-14 15.30.12.jpg` (tak nazywa OneDrive wysyłki z telefonu)
     *  niosą moment zrobienia zdjęcia, a nie moment wysyłki. Do tego nic nie
     *  kosztują — żadnego żądania więcej.
     *
     *  `dataZrodlo` zostaje w indeksie, żeby dało się odróżnić „14 czerwca
     *  o 19:12" od „gdzieś w 2026" i nie podawać drugiego jako pierwsze. */
    const zNazwy = dataZNazwy(nazwa);
    let dataZrodlo = 'exif';
    let kiedySurowe = foto.takenDateTime;
    if (!kiedySurowe && zNazwy) { kiedySurowe = zNazwy; dataZrodlo = 'nazwa'; }
    if (!kiedySurowe) {
      kiedySurowe = el.fileSystemInfo?.createdDateTime || el.createdDateTime;
      dataZrodlo = 'plik';
    }
    const kiedy = kiedySurowe ? String(kiedySurowe).replace(/(\.\d+)?Z?$/, '').slice(0, 19) : null;
    if (!kiedy) dataZrodlo = null;

    return {
      id: `onedrive:${el.id}`,
      zrodlo: 'onedrive',
      nazwa,
      sciezka: (el.parentReference && el.parentReference.path
        ? String(el.parentReference.path).replace(/^\/drive\/root:/, '') : '') + `/${nazwa}`,
      typ: jestFilm ? 'wideo' : 'zdjecie',
      rozmiar: Number(el.size) || null,
      kiedy,
      dataZrodlo,
      aparat: [foto.cameraMake, foto.cameraModel].filter(Boolean).join(' ').trim() || null,
      /* Obiektywu NIE MA w tym miejscu i nie będzie: facet `photo` w Microsoft
         Graph podaje korpus, czas, przysłonę, ISO i ogniskową — `LensModel`
         nie przychodzi. Ale to nie znaczy, że jest nieosiągalny: EXIF siedzi
         w pierwszych kilkudziesięciu kilobajtach pliku, a Graph obsługuje
         `Range`. Dociąga go osobny przebieg (`dociagnijExif`), bo kosztuje
         jedno żądanie na plik — za dużo, żeby robić to przy każdym
         indeksowaniu, za mało, żeby z tego rezygnować. */
      obiektyw: null,
      ogniskowa: Number.isFinite(foto.focalLength) ? Math.round(foto.focalLength) : null,
      przyslona: Number.isFinite(foto.fNumber) ? Number(foto.fNumber.toFixed(1)) : null,
      czasS: Number.isFinite(foto.exposureNumerator) && Number.isFinite(foto.exposureDenominator)
        ? foto.exposureNumerator / foto.exposureDenominator : null,
      iso: Number.isFinite(foto.iso) ? foto.iso : null,
      lat: Number.isFinite(gps.latitude) ? Number(gps.latitude.toFixed(6)) : null,
      lon: Number.isFinite(gps.longitude) ? Number(gps.longitude.toFixed(6)) : null,
      szerokosc: el.image && el.image.width ? el.image.width : null,
      wysokosc: el.image && el.image.height ? el.image.height : null,
      miniatura: (el.thumbnails && el.thumbnails[0] && el.thumbnails[0].small
        && el.thumbnails[0].small.url) || null,
      /* Identyfikator pliku .SRT leżącego obok klipu — wypełniany dopiero
         w `indeksuj()`, bo tu widzimy jeden element, a telemetria to SĄSIAD
         w tym samym katalogu. Bez tego pola nie dałoby się później dociągnąć
         telemetrii paczkami: trzeba by przejść cały dysk jeszcze raz tylko
         po to, żeby dowiedzieć się, które klipy ją w ogóle mają. */
      srtId: null,
    };
  }

  /** Przejdź po całym dysku i oddawaj paczki wpisów przez `naPaczke`.
   *
   *  Graph stronicuje po ~200 pozycji, a 2 TB to dziesiątki tysięcy plików —
   *  dlatego oddajemy paczkami, zamiast zbierać wszystko w pamięci i wysyłać
   *  na końcu. Przerwane indeksowanie zostawia wtedy to, co zdążyło przejść.
   */
  async function indeksuj(naPaczke, { folder = '', limit = 100000, sygnal } = {}) {
    const korzen = folder
      ? `/me/drive/root:/${encodeURI(folder.replace(/^\/+/, ''))}:/children`
      : '/me/drive/root/children';
    const doOdwiedzenia = [`${korzen}?${ZAPYTANIE}`];
    let przejrzanych = 0;
    let dodanych = 0;

    while (doOdwiedzenia.length && dodanych < limit) {
      if (sygnal && sygnal.przerwane) break;
      const strona = await graf(doOdwiedzenia.shift());
      const paczka = [];
      /* Telemetria DJI to OSOBNY PLIK obok klipu: `DJI_0042.MP4` i
         `DJI_0042.SRT`. Zbieramy je z tej samej strony wyników, bo Graph
         oddaje zawartość katalogu razem — szukanie sąsiada osobnym zapytaniem
         na plik byłoby drugim przejściem po całym dysku. */
      const telemetrie = new Map();
      for (const el of strona.value || []) {
        if (!el.folder && TELEMETRIA.test(el.name || '')) {
          telemetrie.set(String(el.name).replace(/\.[^.]+$/, '').toLowerCase(), el.id);
        }
      }
      for (const el of strona.value || []) {
        przejrzanych++;
        if (el.folder) {
          // Podkatalogi na koniec kolejki — przechodzimy wszerz, więc
          // pierwsze wyniki pojawiają się od razu, a nie po najgłębszej gałęzi.
          doOdwiedzenia.push(`/me/drive/items/${el.id}/children?${ZAPYTANIE}`);
          continue;
        }
        const wpis = naWpis(el);
        if (!wpis) continue;
        if (wpis.typ === 'wideo') {
          const bez = String(el.name).replace(/\.[^.]+$/, '').toLowerCase();
          wpis.srtId = telemetrie.get(bez) || null;
        }
        paczka.push(wpis);
      }
      if (paczka.length) {
        await naPaczke(paczka);
        dodanych += paczka.length;
      }
      if (strona['@odata.nextLink']) doOdwiedzenia.push(strona['@odata.nextLink']);
    }
    return { przejrzanych, dodanych };
  }

  /* Doczytaj EXIF z POCZĄTKU pliku, bez pobierania całości.
   *
   *  Microsoft Graph nie oddaje modelu obiektywu — facet `photo` ma korpus,
   *  czas, ISO i ogniskową, `LensModel` nie przychodzi. Przez chwilę uznałem
   *  to za lukę nie do zasypania, ale EXIF siedzi w pierwszych kilkudziesięciu
   *  kilobajtach JPEG-a, a Graph obsługuje nagłówek `Range`.
   *
   *  Czyli: 128 KB zamiast ośmiu megabajtów. Przy dwóch tysiącach zdjęć to
   *  ~250 MB jednorazowo zamiast kilkunastu gigabajtów — i żadnej nowej
   *  biblioteki, bo `lib/exif.js` już zna tag 0xa434.
   */
  async function dociagnijExif(id, bajtow = POCZATEK_PLIKU_B) {
    const r = await zadanieGraf(
      `${GRAF}/me/drive/items/${encodeURIComponent(id)}/content`,
      async () => ({
        headers: { Authorization: `Bearer ${await token()}`, Range: `bytes=0-${bajtow - 1}` },
        signal: AbortSignal.timeout(20000),
      }));
    // 206 = kawałek (o to prosiliśmy), 200 = serwer zignorował Range i dał całość.
    if (BEZNADZIEJNE.has(r.status)) return null;
    if (r.status !== 206 && r.status !== 200) throw new Error(`Graph ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    /* Przy okazji XMP — za DARMO, bo to ten sam pobrany kawałek pliku.
       DJI trzyma tam wysokość nad punktem startu i kąty gimbala, których
       w EXIF-ie nie ma wcale. Drugi przebieg po dwóch tysiącach plików tylko
       po to byłby marnotrawstwem, skoro dane leżą w buforze, który już mamy. */
    const exif = czytajExif(buf);
    const dron = czytajXmpDrona(buf);
    if (!exif && !dron) return null;
    return { ...(exif || {}), dron };
  }

  /** Dowolny kawałek pliku po `Range`. Ta sama droga co przy EXIF-ie, tylko
   *  bez z góry ustalonego zakresu — bo podgląd zaszyty w RAW-ie leży pod
   *  adresem, którego dowiadujemy się dopiero z początku pliku.
   *
   *  Zwraca `null` dla odpowiedzi znaczących „nigdy" (404/410/416), żeby
   *  wywołujący mógł spokojnie wrócić do miniatury z Graph. */
  async function kawalekPliku(id, od, ile) {
    const poczatek = Math.max(0, Number(od) || 0);
    const dlugosc = Math.min(Math.max(Number(ile) || 0, 1), 8_000_000);
    const r = await zadanieGraf(
      `${GRAF}/me/drive/items/${encodeURIComponent(id)}/content`,
      async () => ({
        headers: {
          Authorization: `Bearer ${await token()}`,
          Range: `bytes=${poczatek}-${poczatek + dlugosc - 1}`,
        },
        signal: AbortSignal.timeout(30000),
      }));
    if (BEZNADZIEJNE.has(r.status)) return null;
    if (r.status !== 206 && r.status !== 200) throw new Error(`Graph ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    /* 200 znaczy, że serwer zignorował `Range` i przysłał CAŁY plik. Wtedy
       sami odcinamy żądany kawałek — inaczej dla RAW-a dostalibyśmy
       dwadzieścia pięć megabajtów tam, gdzie prosiliśmy o sto kilobajtów. */
    if (r.status === 200 && poczatek + dlugosc <= buf.length) {
      return buf.subarray(poczatek, poczatek + dlugosc);
    }
    return buf;
  }

  /* Pobierz CAŁY plik telemetrii — tu, w odróżnieniu od EXIF-u, nie ma czego
   *  obcinać. Klip minutowy ma około 1800 wpisów po ~180 bajtów, czyli jakieś
   *  300 KB; przy dwustu klipach to 60 MB jednorazowo. Ograniczenie i tak
   *  stawiamy, bo plik z uszkodzonej karty potrafi mieć dowolny rozmiar,
   *  a jego wczytanie w całości do pamięci serwera nikomu nie służy. */
  const SRT_MAX_B = Number(process.env.ONEDRIVE_SRT_BYTES || 8_000_000);

  async function dociagnijSrt(id) {
    const r = await zadanieGraf(
      `${GRAF}/me/drive/items/${encodeURIComponent(id)}/content`,
      async () => ({
        headers: { Authorization: `Bearer ${await token()}`, Range: `bytes=0-${SRT_MAX_B - 1}` },
        signal: AbortSignal.timeout(30000),
      }));
    if (BEZNADZIEJNE.has(r.status)) return '';
    if (r.status !== 206 && r.status !== 200) throw new Error(`Graph ${r.status}`);
    return Buffer.from(await r.arrayBuffer()).toString('utf8');
  }

  function rozlacz() {
    stan = null;
    try { fs.unlinkSync(PLIK); } catch { /* nie było czego kasować */ }
  }

  return {
    skonfigurowany, polaczony, adresLogowania, polacz, indeksuj, rozlacz, graf, dociagnijExif,
    dociagnijSrt, kawalekPliku,
    // Ile razy Graph kazał zwolnić. Panel archiwum mówi o tym wprost, zamiast
    // udawać, że nic się nie stało — inaczej wolniejsze tempo wygląda na usterkę.
    zdlawienia,
    czekano,
    // Do panelu: kiedy połączono, bez ujawniania samego tokenu.
    stanPolaczenia: () => (polaczony() ? { od: stan.od } : null),
  };
}

module.exports = { utworz, OBRAZY, FILMY, dataZNazwy };

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

  async function graf(sciezka) {
    const t = await token();
    const r = await fetch(sciezka.startsWith('http') ? sciezka : `${GRAF}${sciezka}`, {
      headers: { Authorization: `Bearer ${t}` },
      signal: AbortSignal.timeout(30000),
    });
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
    const kiedySurowe = foto.takenDateTime || el.fileSystemInfo?.createdDateTime || el.createdDateTime;
    const kiedy = kiedySurowe ? String(kiedySurowe).replace(/(\.\d+)?Z?$/, '').slice(0, 19) : null;

    return {
      id: `onedrive:${el.id}`,
      zrodlo: 'onedrive',
      nazwa,
      sciezka: (el.parentReference && el.parentReference.path
        ? String(el.parentReference.path).replace(/^\/drive\/root:/, '') : '') + `/${nazwa}`,
      typ: jestFilm ? 'wideo' : 'zdjecie',
      rozmiar: Number(el.size) || null,
      kiedy,
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
    const t = await token();
    const r = await fetch(`${GRAF}/me/drive/items/${encodeURIComponent(id)}/content`, {
      headers: { Authorization: `Bearer ${t}`, Range: `bytes=0-${bajtow - 1}` },
      signal: AbortSignal.timeout(20000),
    });
    // 206 = kawałek (o to prosiliśmy), 200 = serwer zignorował Range i dał całość.
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

  /* Pobierz CAŁY plik telemetrii — tu, w odróżnieniu od EXIF-u, nie ma czego
   *  obcinać. Klip minutowy ma około 1800 wpisów po ~180 bajtów, czyli jakieś
   *  300 KB; przy dwustu klipach to 60 MB jednorazowo. Ograniczenie i tak
   *  stawiamy, bo plik z uszkodzonej karty potrafi mieć dowolny rozmiar,
   *  a jego wczytanie w całości do pamięci serwera nikomu nie służy. */
  const SRT_MAX_B = Number(process.env.ONEDRIVE_SRT_BYTES || 8_000_000);

  async function dociagnijSrt(id) {
    const t = await token();
    const r = await fetch(`${GRAF}/me/drive/items/${encodeURIComponent(id)}/content`, {
      headers: { Authorization: `Bearer ${t}`, Range: `bytes=0-${SRT_MAX_B - 1}` },
      signal: AbortSignal.timeout(30000),
    });
    if (r.status !== 206 && r.status !== 200) throw new Error(`Graph ${r.status}`);
    return Buffer.from(await r.arrayBuffer()).toString('utf8');
  }

  function rozlacz() {
    stan = null;
    try { fs.unlinkSync(PLIK); } catch { /* nie było czego kasować */ }
  }

  return {
    skonfigurowany, polaczony, adresLogowania, polacz, indeksuj, rozlacz, graf, dociagnijExif,
    dociagnijSrt,
    // Do panelu: kiedy połączono, bez ujawniania samego tokenu.
    stanPolaczenia: () => (polaczony() ? { od: stan.od } : null),
  };
}

module.exports = { utworz, OBRAZY, FILMY };

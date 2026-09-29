/* ============================================================
   Cosmos – wiedza o modelach: co który model umie i który wziąć do roli

   Katalog (`public/models.js`) zgaduje z nazwy, do czego model się nadaje.
   Zespół agentów potrzebuje czegoś pewniejszego: rola „oko” u ślepego modelu
   opisze zdjęcie z wyobraźni, a rola przydzielona modelowi, do którego klucz
   nie ma dostępu, padnie w środku tury. Dlatego umiejętności składamy
   z czterech źródeł w kolejności pewności:

     1. sonda „Sprawdź” (to, co naprawdę odpowiedziało na TYM koncie),
     2. capabilities dostawcy (natywne /v1/models Claude'a),
     3. katalog,
     4. domysł z nazwy.

   Wyniki sond i capabilities to wiedza o MODELU na kluczu właściciela, nie
   dana osoby – jeden plik serwera `data/konta/modele-sprawdzone.json`, bez
   adresów i kluczy (zespół IT, runda 9: it-modele-open, it-konta,
   it-modele-komercyjne).

   Czyste funkcje (`umiejetnosci`, `dobierzModel`, `normalizujClaude`,
   `ocenSondeWzroku`) nie dotykają dysku – test woła je wprost. Rejestr
   (`utworzRejestrModeli`) dostaje ścieżkę pliku i pomocników zapisu
   z zewnątrz, jak każdy moduł w lib/.
   ============================================================ */

const {
  modelInfo, modelNotAChatPartner, POZIOMY,
} = require('../public/models.js');

const DZIEN_MS = 24 * 3600 * 1000;
/* Sonda sprzed tygodnia mówi już mniej niż katalog: dostawca zmienia listę
   modeli, konto zmienia poziom. Po tym czasie wpis zostaje w pliku (i na
   liście w Ustawieniach), ale decyzje wracają do katalogu. */
const WAZNOSC_SONDY_MS = 7 * DZIEN_MS;
const MAX_WPISOW = 2000;
const OBRAZY = ['pewne', 'prawdopodobnie', 'nie'];

/* ---------------------------------------------------------------
   Sonda wzroku: obrazek 8×8 w jednym kolorze i pytanie o kolor.

   Dawniej sonda wysyłała obrazek 1×1 z „hi”: przyjęcie żądania brało się za
   dowód wzroku, a dostawca potrafi obraz po prostu zignorować – gpt-oss-20b
   dostał tak cechę „widzi obrazy”, której nie ma (zespół IT, runda 9).
   --------------------------------------------------------------- */

/* PNG 8×8 jednolicie czerwony (RGB 220,30,30), złożony raz przy wczytaniu
   modułu – bez zależności i bez pliku w repozytorium. */
function pngJednolity(szer, wys, [r, g, b]) {
  const zlib = require('node:zlib');
  const crcTab = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTab[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xFFFFFFFF;
    for (const bajt of buf) c = crcTab[(c ^ bajt) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const kawalek = (typ, dane) => {
    const dl = Buffer.alloc(4); dl.writeUInt32BE(dane.length);
    const td = Buffer.concat([Buffer.from(typ, 'ascii'), dane]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([dl, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(szer, 0); ihdr.writeUInt32BE(wys, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const wiersz = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: szer }, () => [r, g, b]).flat())]);
  const surowe = Buffer.concat(Array.from({ length: wys }, () => wiersz));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    kawalek('IHDR', ihdr), kawalek('IDAT', zlib.deflateSync(surowe)), kawalek('IEND', Buffer.alloc(0)),
  ]);
}
const PNG_SONDY_WZROKU = `data:image/png;base64,${pngJednolity(8, 8, [220, 30, 30]).toString('base64')}`;
const PYTANIE_SONDY_WZROKU = 'What colour is this image? Answer with one English word.';
const KOLOR_SONDY = /\b(red|reddish|crimson|scarlet)\b|czerwon/i;

/** Ocena odpowiedzi sondy wzroku.
 *  'pewne'          – model nazwał kolor, więc obraz widział,
 *  'prawdopodobnie' – dostawca przyjął obraz, ale odpowiedź nic nie dowodzi
 *                     (pusta: budżet zjadło myślenie) – a katalog mówi „widzi”,
 *  'nie'            – odmowa obrazu albo odpowiedź bez koloru u modelu, którego
 *                     katalog za widzący nie uważa (typowy objaw ignorowania). */
function ocenSondeWzroku({ ok, tekst }, id, silnik) {
  if (!ok) return 'nie';
  const t = String(tekst || '');
  if (KOLOR_SONDY.test(t)) return 'pewne';
  const info = modelInfo(id, silnik);
  const katalogWidzi = Boolean(info && info.cechy.includes('wizja'));
  if (!t.trim()) return katalogWidzi || !info || info.zgadywane ? 'prawdopodobnie' : 'nie';
  return katalogWidzi ? 'prawdopodobnie' : 'nie';
}

/* ---------------------------------------------------------------
   Capabilities Claude'a z natywnego /v1/models (pewne: dokumentacja
   Models API – max_input_tokens, max_tokens, capabilities.*.supported).
   --------------------------------------------------------------- */

/** Jeden obiekt modelu z /v1/models Anthropic → {okno, maxWyjscie, wizja,
 *  myslenie, wysilek}. Brak pola = null („nie wiadomo”), nie false. */
function normalizujClaude(m) {
  if (!m || typeof m !== 'object') return null;
  const liczba = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const tak = (v) => (v && typeof v === 'object' && typeof v.supported === 'boolean' ? v.supported : null);
  const c = m.capabilities && typeof m.capabilities === 'object' ? m.capabilities : {};
  const wynik = {
    okno: liczba(m.max_input_tokens),
    maxWyjscie: liczba(m.max_tokens),
    wizja: tak(c.image_input),
    myslenie: tak(c.thinking),
    wysilek: tak(c.effort),
  };
  return Object.values(wynik).some((v) => v !== null) ? wynik : null;
}

/* ---------------------------------------------------------------
   Umiejętności modelu
   --------------------------------------------------------------- */

/** Co model umie – z najpewniejszego dostępnego źródła.
 *  `sprawdzenie` – wpis sondy {rozmowa, obrazy, czas, kiedy} (świeży, patrz
 *  rejestr), `dostawca` – wynik normalizujClaude. Zwraca też `pewnosc`:
 *  skąd wzięła się każda odpowiedź ('sonda' | 'dostawca' | 'katalog' | 'nazwa'). */
function umiejetnosci(id, silnik, { sprawdzenie = null, dostawca = null } = {}) {
  const info = id ? modelInfo(id, silnik) : null;
  const znany = Boolean(info && !info.zgadywane);
  const zKatalogu = znany ? 'katalog' : 'nazwa';
  const cecha = (c) => Boolean(info && info.cechy.includes(c));
  const pewnosc = {};

  let rozmowa;
  if (sprawdzenie && typeof sprawdzenie.rozmowa === 'boolean') {
    rozmowa = sprawdzenie.rozmowa; pewnosc.rozmowa = 'sonda';
  } else {
    rozmowa = !modelNotAChatPartner(id || ''); pewnosc.rozmowa = zKatalogu;
  }

  let wizja; let wizjaPewnosc;
  const obrazy = sprawdzenie && OBRAZY.includes(sprawdzenie.obrazy) ? sprawdzenie.obrazy : null;
  if (obrazy === 'pewne' || obrazy === 'nie') {
    wizja = obrazy === 'pewne'; wizjaPewnosc = 'sonda';
  } else if (dostawca && typeof dostawca.wizja === 'boolean') {
    wizja = dostawca.wizja; wizjaPewnosc = 'dostawca';
  } else if (obrazy === 'prawdopodobnie') {
    wizja = true; wizjaPewnosc = 'prawdopodobnie';
  } else {
    wizja = cecha('wizja'); wizjaPewnosc = zKatalogu;
  }
  pewnosc.wizja = wizjaPewnosc;

  let rozumowanie = cecha('rozumowanie'); pewnosc.rozumowanie = zKatalogu;
  if (dostawca && typeof dostawca.myslenie === 'boolean') {
    rozumowanie = dostawca.myslenie; pewnosc.rozumowanie = 'dostawca';
  }

  return {
    rozmowa,
    wizja,
    kod: cecha('kod'),
    rozumowanie,
    szybki: cecha('szybki'),
    polski: cecha('polski'),
    narzedzia: cecha('narzędzia'),
    myslenie: (info && info.myslenie) || null,
    poziom: (info && info.poziom) || null,
    vramGb: (info && info.vramGb) || null,
    okno: (dostawca && dostawca.okno) || null,
    maxWyjscie: (dostawca && dostawca.maxWyjscie) || null,
    czas: sprawdzenie && Number.isFinite(sprawdzenie.czas) ? sprawdzenie.czas : null,
    sprawdzony: Boolean(sprawdzenie && sprawdzenie.rozmowa === true),
    pewnosc,
  };
}

/* ---------------------------------------------------------------
   Role zespołu i dobór modelu
   --------------------------------------------------------------- */

/* Katalog ról MVP (KONCEPCJA-AGENCI): czego rola WYMAGA (bez tego model
   odpada) i co woli (punkty). `mysli` – czy rola może myśleć: analityk,
   programista i recenzent tak; reszta szybko, bez myślenia. */
const ROLE = {
  badacz: { wymaga: [], woli: ['polski', 'szybki', 'narzedzia'], mysli: false },
  // Fotograf przepisuje liczby policzone przez Cosmosa i układa z nich kolejność – bez myślenia.
  fotograf: { wymaga: [], woli: ['polski', 'rozumowanie'], mysli: false },
  sprzetowiec: { wymaga: [], woli: ['polski', 'rozumowanie'], mysli: false },
  programista: { wymaga: [], woli: ['kod', 'rozumowanie'], mysli: true },
  oko: { wymaga: ['wizja'], woli: ['polski'], mysli: false },
  analityk: { wymaga: [], woli: ['rozumowanie', 'polski'], mysli: true },
  recenzent: { wymaga: [], woli: ['rozumowanie', 'polski'], mysli: true },
};

/* Własna rola osoby (Ustawienia → Agenci): cechy, które zaznaczyła, to
   „woli”; „wymaga obrazu” to twarde „wymaga: wizja”; „rozumowanie” pozwala
   roli myśleć. Kształt jak wpis ROLE – ocenKandydata przyjmuje jedno i drugie. */
const CECHY_WLASNE = ['kod', 'wizja', 'rozumowanie', 'szybki', 'polski'];
function profilWlasnejRoli({ cechy = [], wymagaObrazu = false } = {}) {
  const woli = [...new Set((Array.isArray(cechy) ? cechy : []).filter((c) => CECHY_WLASNE.includes(c)))];
  return { wymaga: wymagaObrazu ? ['wizja'] : [], woli: woli.length ? woli : ['polski'], mysli: woli.includes('rozumowanie') };
}

/* Silniki, na których płaci się za token – tu automat nie bierze modelu
   droższego (wyższego poziomu) niż prowadzący (it-modele-komercyjne, D7). */
const PLATNE = new Set(['openai', 'claude']);

const poziomNr = (p) => (p ? POZIOMY.indexOf(p) : -1);

/** Punkty kandydata do roli; null = odpada. Czysta funkcja – test i dobór
 *  widzą to samo. */
function ocenKandydata(rola, k, { prowadzacy = null, glosowy = false } = {}) {
  // Klucz roli z ROLE albo gotowy profil (własna rola – profilWlasnejRoli).
  const r = rola && typeof rola === 'object' ? rola : (Object.hasOwn(ROLE, rola) ? ROLE[rola] : null);
  if (!r || !k || !k.id) return null;
  const u = k.umiejetnosci || umiejetnosci(k.id, k.silnik, { sprawdzenie: k.sprawdzenie, dostawca: k.dostawca });
  if (!u.rozmowa) return null;
  for (const w of r.wymaga) if (!u[w]) return null;
  const tenSam = Boolean(prowadzacy && prowadzacy.id === k.id && prowadzacy.silnik === k.silnik);

  if (prowadzacy && !tenSam && PLATNE.has(k.silnik)) {
    const up = umiejetnosci(prowadzacy.id, prowadzacy.silnik);
    const a = poziomNr(u.poziom); const b = poziomNr(up.poziom);
    if (a >= 0 && b >= 0 && a > b) return null;
  }

  let punkty = 0;
  for (const w of r.woli) if (u[w]) punkty += 3;
  if (u.sprawdzony) punkty += 2;
  if (r.wymaga.includes('wizja')) {
    if (u.pewnosc.wizja === 'sonda' || u.pewnosc.wizja === 'dostawca') punkty += 2;
    if (u.pewnosc.wizja === 'prawdopodobnie' || u.pewnosc.wizja === 'nazwa') punkty -= 2;
  }
  /* Pomocnik na innym modelu niż prowadzący nie zjada mu limitu minutowego
     (it-modele-komercyjne: prowadzący dostawał 429) – ale lokalnie odwrotnie:
     inny model to przeładowanie pamięci karty, 6–14 s (it-modele-open). */
  if (prowadzacy && !tenSam) {
    punkty += k.silnik === 'local' && prowadzacy.silnik === 'local' ? -4 : 1;
  }
  if (u.myslenie === 'zawsze' && !r.mysli) punkty -= 3;
  if (glosowy) {
    if (u.szybki) punkty += 3;
    if (u.myslenie === 'zawsze') punkty -= 5;
  }
  return punkty;
}

/** Najlepszy kandydat do roli albo null. `kandydaci` = [{id, silnik,
 *  sprawdzenie?, dostawca?, umiejetnosci?}] – WYŁĄCZNIE modele, na które
 *  osoba ma zgodę (pulę liczy strażnik, nie ta funkcja). Remis: kolejność
 *  na liście (pierwszy = zwykle model z zakładki). */
function dobierzModel(rola, kandydaci, opcje = {}) {
  let najlepszy = null; let wynik = -Infinity;
  for (const k of kandydaci || []) {
    const p = ocenKandydata(rola, k, opcje);
    if (p !== null && p > wynik) { najlepszy = k; wynik = p; }
  }
  return najlepszy;
}

/* ---------------------------------------------------------------
   Rejestr: sondy i capabilities w jednym pliku serwera
   --------------------------------------------------------------- */

/** `plik` – ścieżka (data/konta/modele-sprawdzone.json), `czytajJson`
 *  i `zapiszAtomowo` z lib/rdzen.js. Zapisy zwracają błąd (null = zapisane),
 *  stan w pamięci zmienia się dopiero po udanym zapisie. */
function utworzRejestrModeli(opcje) {
  const { plik, czytajJson, zapiszAtomowo } = opcje;
  const teraz = opcje.teraz || Date.now;
  let stan = null;
  const wczytaj = () => {
    if (!stan) {
      const d = czytajJson(plik, null);
      stan = {
        sprawdzone: d && typeof d.sprawdzone === 'object' && d.sprawdzone ? d.sprawdzone : {},
        dostawcy: d && typeof d.dostawcy === 'object' && d.dostawcy ? d.dostawcy : {},
      };
    }
    return stan;
  };
  const klucz = (silnik, model) => `${silnik}|${model}`;
  const przytnij = (mapa) => {
    const k = Object.keys(mapa);
    if (k.length <= MAX_WPISOW) return mapa;
    k.sort((a, b) => (mapa[b].kiedy || 0) - (mapa[a].kiedy || 0));
    return Object.fromEntries(k.slice(0, MAX_WPISOW).map((x) => [x, mapa[x]]));
  };
  const zapisz = (nowy) => {
    try {
      zapiszAtomowo(plik, JSON.stringify({ v: 1, ...nowy }, null, 1), { mode: 0o600 });
    } catch (err) {
      return err;
    }
    stan = nowy;
    return null;
  };

  /** Zapis wyniku sondy – z BIAŁEJ LISTY pól: żadnego baseUrl, klucza ani
   *  treści błędu dostawcy (tam bywa identyfikator konta). */
  function zapiszSprawdzenie({ silnik, model, rozmowa, obrazy, czas }) {
    if (!silnik || !model) return new Error('brak silnika albo modelu');
    const s = wczytaj();
    const wpis = {
      silnik: String(silnik).slice(0, 40),
      model: String(model).slice(0, 200),
      rozmowa: rozmowa === true,
      obrazy: OBRAZY.includes(obrazy) ? obrazy : 'nie',
      czas: Number.isFinite(czas) ? Math.round(czas) : null,
      kiedy: teraz(),
    };
    return zapisz({ ...s, sprawdzone: przytnij({ ...s.sprawdzone, [klucz(wpis.silnik, wpis.model)]: wpis }) });
  }

  /** Wpis sondy; domyślnie tylko świeży (do decyzji). `wszystkie: true` –
   *  także stary (do pokazania w Ustawieniach z datą). */
  function sprawdzenie(silnik, model, { wszystkie = false } = {}) {
    const w = wczytaj().sprawdzone[klucz(silnik, model)];
    if (!w) return null;
    if (!wszystkie && teraz() - (w.kiedy || 0) > WAZNOSC_SONDY_MS) return null;
    return w;
  }

  /** Wszystkie sondy silnika – do znaczków na liście modeli. */
  function sprawdzenia(silnik) {
    return Object.values(wczytaj().sprawdzone).filter((w) => w.silnik === silnik);
  }

  /** Capabilities całej listy modeli jednego dostawcy naraz (jeden zapis). */
  function zapiszDostawce(silnik, modele) {
    const s = wczytaj();
    const dostawcy = { ...s.dostawcy };
    let zmiana = false;
    for (const m of modele || []) {
      const n = normalizujClaude(m);
      if (!n || !m.id) continue;
      const k = klucz(silnik, String(m.id).slice(0, 200));
      const stary = dostawcy[k];
      if (stary && JSON.stringify({ ...stary, kiedy: 0 }) === JSON.stringify({ ...n, kiedy: 0 })) continue;
      dostawcy[k] = { ...n, kiedy: teraz() };
      zmiana = true;
    }
    return zmiana ? zapisz({ ...s, dostawcy: przytnij(dostawcy) }) : null;
  }

  function dostawca(silnik, model) {
    const w = wczytaj().dostawcy[klucz(silnik, model)];
    if (!w) return null;
    const { kiedy, ...reszta } = w;
    return reszta;
  }

  /** Umiejętności modelu ze wszystkiego, co rejestr wie. */
  function umiejetnosciModelu(id, silnik) {
    return umiejetnosci(id, silnik, { sprawdzenie: sprawdzenie(silnik, id), dostawca: dostawca(silnik, id) });
  }

  return { zapiszSprawdzenie, sprawdzenie, sprawdzenia, zapiszDostawce, dostawca, umiejetnosciModelu };
}

module.exports = {
  umiejetnosci, dobierzModel, ocenKandydata, ROLE, profilWlasnejRoli, normalizujClaude, utworzRejestrModeli,
  ocenSondeWzroku, PNG_SONDY_WZROKU, PYTANIE_SONDY_WZROKU, WAZNOSC_SONDY_MS, OBRAZY,
};

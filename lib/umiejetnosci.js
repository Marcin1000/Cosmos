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
  // Wpis katalogu z cechami z pamięci (`pewne: false`) – pewniejszy niż nazwa, mniej pewny niż pomiar.
  const zKatalogu = znany ? (info.pewne === false ? 'pamiec' : 'katalog') : 'nazwa';
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
    // Sposób myślenia nieznany: model spoza katalogu, zgadnięty z nazwy albo wpis z pamięci bez pola `myslenie`.
    myslenieNieznane: !(info && info.myslenie) && (!znany || info.pewne === false),
    wolny: Boolean(info && info.wolny),
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
   droższego (wyższego poziomu i wyższej ceny) niż prowadzący (it-modele-komercyjne, D7). */
const PLATNE = new Set(['openai', 'claude']);

const poziomNr = (p) => (p ? POZIOMY.indexOf(p) : -1);

/* Zalecane darmowe modele na rolę (build.nvidia.com) – kolejność = preferencja.
   Runda 11 (it-modele-open): NVIDIA wycofała 26.08.2026 sześć modeli z dawnej
   listy (Super 49B v1.5, Nemotron 3 Nano 30B, Qwen3 Coder 480B, gpt-oss-120b,
   Nano 12B v2 VL, Llama 4 Maverick – HTTP 410 „end of life”) i każda tura
   „Za 0 zł” schodziła na zapas. Lista to następcy z pamięci i z models.dev –
   dostępność na koncie NIEPEWNA, dlatego zalecany model trafia do puli
   dopiero po świeżej udanej sondzie (sondujZalecane w server.js przy starcie
   i raz na dobę; lib/zespol.js pulaDarmowa). Recenzent zaczyna od innej
   rodziny niż Nemotron, żeby nie przepuszczał jego pomyłek. */
const ZALECANE_DARMOWE = {
  badacz: ['google/gemma-4-31b-it', 'mistralai/mistral-medium-3-instruct', 'nvidia/nemotron-3-super-120b-a12b'],
  fotograf: ['nvidia/nemotron-3-super-120b-a12b', 'google/gemma-4-31b-it'],
  sprzetowiec: ['nvidia/nemotron-3-super-120b-a12b', 'google/gemma-4-31b-it'],
  programista: ['deepseek-ai/deepseek-v4.1-flash', 'moonshotai/kimi-k3', 'nvidia/nemotron-3-super-120b-a12b'],
  oko: ['nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'google/gemma-4-31b-it'],
  analityk: ['nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/nemotron-3-super-120b-a12b', 'deepseek-ai/deepseek-v4.1-flash'],
  recenzent: ['deepseek-ai/deepseek-v4.1-flash', 'google/gemma-4-31b-it', 'moonshotai/kimi-k3'],
};
const PREMIA_ZALECENIA = [4, 2, 1];

/** Czy odmowa dostawcy mówi coś o MODELU na stałe: 410 (wycofany) albo 404
 *  z treścią o modelu („end of life”, „Not found for account”, Ollama „model …
 *  not found”). Gołe 404 bez takiej treści to częściej zły adres niż model –
 *  nie zapisujemy go jako awarii modelu. Czysta funkcja (zespół, test). */
function awariaModelu(status, tresc = '') {
  if (status === 410) return true;
  if (status !== 404) return false;
  return /end of life|no longer available|not found for account|does not exist|deprecat|decommission|retired|model[^.\n]{0,80}not found|not found[^.\n]{0,40}model|function '[^']*': not found/i
    .test(String(tresc || ''));
}

/* Rodzina modelu – do recenzenta: model z tej samej rodziny co autorzy notatek
   ma te same ślepe plamy („Syrakuzy na zachodzie” Nemotron przepuści
   u Nemotrona – agencja-rozmowa). Kolejność: „llama-3.3-nemotron” to Nemotron,
   gpt-oss to OpenAI jak GPT. */
const RODZINY = [
  ['nemotron', /nemotron/], ['claude', /claude/], ['openai', /(^|\/)(gpt|o\d)([-.:]|$)|gpt-oss|chatgpt/], ['qwen', /qwen|qwq/],
  ['deepseek', /deepseek/], ['glm', /glm/], ['kimi', /kimi|moonshot/], ['gemma', /gemma/], ['llama', /llama/],
  ['mistral', /mistral|mixtral|codestral|devstral/], ['minimax', /minimax/], ['phi', /(^|\/)phi/],
];
function rodzinaModelu(id) {
  const k = String(id || '').toLowerCase();
  const r = RODZINY.find(([, re]) => re.test(k));
  return r ? r[0] : (k.split('/').pop().split(/[:\-_.]/)[0] || k);
}

/** Punkty kandydata do roli; null = odpada. Czysta funkcja – test i dobór
 *  widzą to samo.
 *  `tylkoDarmowe` – wariant „Darmowe modele”: płatny silnik odpada, liczą się
 *  zalecenia na rolę; `rodzinyNotatek` – rodziny autorów notatek (recenzent
 *  z innej dostaje premię); `cena(id, silnik)` – cena modelu (cennik) do
 *  zapory „nie droższy niż płatny prowadzący”. */
function ocenKandydata(rola, k, { prowadzacy = null, glosowy = false, tylkoDarmowe = false, rodzinyNotatek = null, cena = null } = {}) {
  // Klucz roli z ROLE albo gotowy profil (własna rola – profilWlasnejRoli).
  const r = rola && typeof rola === 'object' ? rola : (Object.hasOwn(ROLE, rola) ? ROLE[rola] : null);
  if (!r || !k || !k.id) return null;
  if (tylkoDarmowe && PLATNE.has(k.silnik)) return null;
  const u = k.umiejetnosci || umiejetnosci(k.id, k.silnik, { sprawdzenie: k.sprawdzenie, dostawca: k.dostawca });
  if (!u.rozmowa) return null;
  for (const w of r.wymaga) if (!u[w]) return null;
  const tenSam = Boolean(prowadzacy && prowadzacy.id === k.id && prowadzacy.silnik === k.silnik);

  /* Zapora: płatny pomocnik nie wyższego poziomu niż prowadzący, a przy
     płatnym prowadzącym – też nie droższy od niego (sam poziom przepuszczał
     Sonneta przy gpt-4o, bo oba „pelny” – it-backend, runda 10). Przy
     darmowym prowadzącym płatny kosztuje więcej zawsze: wygrywa tylko
     przewagą cech, bo darmowy ma premię niżej. */
  if (prowadzacy && !tenSam && PLATNE.has(k.silnik)) {
    const up = umiejetnosci(prowadzacy.id, prowadzacy.silnik);
    const a = poziomNr(u.poziom); const b = poziomNr(up.poziom);
    if (a >= 0 && b >= 0 && a > b) return null;
    if (PLATNE.has(prowadzacy.silnik) && typeof cena === 'function') {
      const ck = cena(k.id, k.silnik); const cp = cena(prowadzacy.id, prowadzacy.silnik);
      if (Number.isFinite(ck) && Number.isFinite(cp) && ck > cp * 1.001) return null;
    }
  }

  let punkty = 0;
  for (const w of r.woli) if (u[w]) punkty += 3;
  /* Premia za udaną sondę tylko dla darmowych: tam sonda mówi, czy model
     w ogóle jest na koncie (NVIDIA wycofuje i bramkuje). Płatny model z listy
     dostawcy i tak działa – +2 za „Sprawdź” przerzucało wszystkie role na
     Sonneta tylko dlatego, że ktoś go sprawdził (it-modele-komercyjne, runda 11). */
  if (u.sprawdzony && !PLATNE.has(k.silnik) && tylkoDarmowe) punkty += 2;
  if (r.wymaga.includes('wizja')) {
    if (u.pewnosc.wizja === 'sonda' || u.pewnosc.wizja === 'dostawca') punkty += 2;
    if (['prawdopodobnie', 'nazwa', 'pamiec'].includes(u.pewnosc.wizja)) punkty -= 2;
  }
  /* Remis rozstrzyga koszt: darmowy silnik (chmura NVIDIA, lokalny GPU) +1.
     Dawniej +1 dostawał każdy model inny niż prowadzący – przy darmowym
     prowadzącym to płatne Claude/OpenAI wygrywały remis (zrzut 3 Marcina:
     analityk i recenzent na Sonnecie za 0,26 zł). Płatny wygrywa już tylko
     przewagą cech (it-backend, it-modele-open – runda 10). */
  /* Runda 12 (Marcin): skład proponowany to NAJLEPIEJ dopasowany – płatny może
     wygrać cechami, a darmowy jest osobnym wariantem do wyboru w bramce. Premie
     za darmowość (+1 i +2 za sondę) działały też w proponowanym i po pierwszej
     sondzie każda propozycja była darmowa, więc bramka z wyborem znikała.
     W proponowanym remis rozstrzyga cena (taniejPierwszy). */
  if (!PLATNE.has(k.silnik) && tylkoDarmowe) punkty += 1;
  // Lokalnie inny model niż prowadzący to przeładowanie pamięci karty, 6–14 s (it-modele-open).
  if (prowadzacy && !tenSam && k.silnik === 'local' && prowadzacy.silnik === 'local') punkty -= 4;
  // Wolny albo zawodny (Ultra): rola ma 90 s i 45 s ciszy; sonda z wolną odpowiedzią na tym koncie – też.
  if (u.wolny) punkty -= r.mysli ? 2 : 4;
  if (u.czas && u.czas > 8000) punkty -= 2;
  if (tylkoDarmowe) {
    const lista = Object.hasOwn(ZALECANE_DARMOWE, rola) ? ZALECANE_DARMOWE[rola] : [];
    const i = lista.indexOf(k.id);
    if (i >= 0) punkty += PREMIA_ZALECENIA[i] || 1;
  }
  if (Array.isArray(rodzinyNotatek) && rodzinyNotatek.length && !rodzinyNotatek.includes(rodzinaModelu(k.id))) punkty += 2;
  if (u.myslenie === 'zawsze' && !r.mysli) punkty -= 3;
  if (glosowy) {
    if (u.szybki) punkty += 3;
    if (u.myslenie === 'zawsze') punkty -= 5;
    if (u.wolny) punkty -= 5;
  }
  return punkty;
}

/** Kandydaci do roli od najlepszego: [{k, punkty}] (odpadli pominięci).
 *  Remis: kolejność na liście. Do edytora roli („polecany”, modele z propozycji). */
function rankingModeli(rola, kandydaci, opcje = {}) {
  return (kandydaci || []).map((k, i) => ({ k, i, punkty: ocenKandydata(rola, k, opcje) }))
    .filter((x) => x.punkty !== null).sort((a, b) => b.punkty - a.punkty || taniejPierwszy(a.k, b.k, opcje.cena) || a.i - b.i)
    .map(({ k, punkty }) => ({ k, punkty }));
}

/** Remis punktów: tańszy model pierwszy (cena z cennika; darmowy silnik = 0).
 *  0, gdy ceny nie znamy – rozstrzyga wtedy kolejność na liście. */
function taniejPierwszy(a, b, cena) {
  if (typeof cena !== 'function') return 0;
  const c = (k) => (PLATNE.has(k.silnik) ? cena(k.id, k.silnik) : 0);
  const ca = c(a); const cb = c(b);
  return Number.isFinite(ca) && Number.isFinite(cb) ? ca - cb : 0;
}

/** Najlepszy kandydat do roli albo null. `kandydaci` = [{id, silnik,
 *  sprawdzenie?, dostawca?, umiejetnosci?}] – WYŁĄCZNIE modele, na które
 *  osoba ma zgodę (pulę liczy strażnik, nie ta funkcja). Remis: kolejność
 *  na liście (pierwszy = zwykle model z zakładki). */
function dobierzModel(rola, kandydaci, opcje = {}) {
  let najlepszy = null; let wynik = -Infinity;
  for (const k of kandydaci || []) {
    const p = ocenKandydata(rola, k, opcje);
    // Remis – tańszy (it-modele-komercyjne, runda 11); bez cen – pierwszy na liście.
    if (p !== null && (p > wynik || (p === wynik && najlepszy && taniejPierwszy(k, najlepszy, opcje.cena) < 0))) { najlepszy = k; wynik = p; }
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

  /** PAMIĘĆ AWARII (it-modele-open, runda 11). Rola, której model odpowiedział
   *  410 „end of life” albo 404 „not found for account”, zapisuje to jak
   *  nieudana sonda – następny zespół go nie wybierze, aż „Sprawdź” (albo
   *  sonda zalecanych) powie inaczej albo minie WAZNOSC_SONDY_MS. Wcześniej
   *  dwie tury z rzędu dostawały ten sam skład i te same trzy awarie. */
  function zapiszAwarie({ silnik, model }) {
    if (!silnik || !model) return new Error('brak silnika albo modelu');
    return zapiszSprawdzenie({ silnik, model, rozmowa: false, obrazy: 'nie', czas: null });
  }

  return { zapiszSprawdzenie, sprawdzenie, sprawdzenia, zapiszDostawce, dostawca, umiejetnosciModelu, zapiszAwarie };
}

module.exports = {
  umiejetnosci, dobierzModel, ocenKandydata, rankingModeli, rodzinaModelu, ZALECANE_DARMOWE, PLATNE, ROLE, profilWlasnejRoli, awariaModelu,
  normalizujClaude, utworzRejestrModeli, ocenSondeWzroku, PNG_SONDY_WZROKU, PYTANIE_SONDY_WZROKU, WAZNOSC_SONDY_MS, OBRAZY,
};

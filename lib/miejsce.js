/* ============================================================
   Miejsce na dysku — limit na osobę i uczciwy błąd, gdy dysk jest pełny

   Zespół IT zapchał dane testowego serwera do zera (tmpfs 8 MB) i zobaczył
   dwie rzeczy naraz:
     — pamięć, profil, sprzęt, lokalizacja i baza wiedzy odpowiadały
       `{ ok: true }`, choć na dysku nic się nie zmieniło. Funkcje zapisu
       łapały błąd, pisały go do dziennika i szły dalej — restart = cicha
       utrata wszystkiego, co „zapisano" od zapełnienia dysku;
     — nic nie pilnowało, ile miejsca zajmuje jedna osoba. Zaproszony gość
       mógł wgrać do bazy wiedzy dowolnie dużo plików po 128 MB i zapchać
       VPS-a wszystkim, łącznie z właścicielem.

   Stąd dwie zasady:
     1. Zapis, który się nie udał, zwraca błąd, a trasa odpowiada 507 („brak
        miejsca") albo 500 — nigdy „ok". Funkcje zapisu NIE rzucają (wołają je
        też timery, gdzie wyjątek wywróciłby proces) — ZWRACAJĄ błąd.
     2. Pliki osoby (baza wiedzy, wyniki Studia, rozmowy) mieszczą się w jej
        limicie: COSMOS_LIMIT_MB_OSOBY dla zaproszonych, dla właściciela bez
        limitu, chyba że ustawi COSMOS_LIMIT_MB_WLASCICIELA.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const { ktoWymagany, katalogDla, czyWlasciciel } = require('./kontekst.js');

const MB = 1024 * 1024;
const LIMIT_OSOBY = (Number(process.env.COSMOS_LIMIT_MB_OSOBY) || 500) * MB;
const LIMIT_WLASCICIELA = (Number(process.env.COSMOS_LIMIT_MB_WLASCICIELA) || 0) * MB; // 0 = bez limitu

/* Liczenie katalogu to przejście po wszystkich plikach osoby — przy tysiącach
   pozycji w bazie wiedzy nie chcemy go przy każdym zapisie. Wynik żyje minutę,
   a każdy udany zapis dolicza swoje bajty od razu (dolicz), więc seria plików
   w tej minucie nie prześlizgnie się obok limitu. */
const WAZNOSC_MS = 60_000;

class BrakMiejsca extends Error {
  constructor(wiadomosc) {
    super(wiadomosc);
    this.name = 'BrakMiejsca';
    this.kod = 507;
  }
}

const DYSK_PELNY = new Set(['ENOSPC', 'EDQUOT']);

/** Czy to błąd „dysk pełny" albo „limit osoby". */
function toBrakMiejsca(err) {
  return Boolean(err && (err.kod === 507 || DYSK_PELNY.has(err.code)));
}

/** Błąd zapisu → BrakMiejsca, jeśli to pełny dysk; inny błąd bez zmian. */
function zBleduDysku(err) {
  if (!err || err instanceof BrakMiejsca || !DYSK_PELNY.has(err.code)) return err;
  return new BrakMiejsca('Brak miejsca na dysku serwera — nie zapisano. Właściciel musi zwolnić miejsce na VPS-ie.');
}

/** Kod i treść odpowiedzi dla człowieka. Pełny dysk i limit osoby → 507. */
function bladDlaCzlowieka(err) {
  const e = zBleduDysku(err);
  if (toBrakMiejsca(e)) return { kod: 507, error: e.message };
  // Błąd z kodem to zdanie napisane dla człowieka — przechodzi dalej.
  if (e && e.kod >= 400 && e.kod < 600) return { kod: e.kod, error: `Błąd serwera: ${e.message}` };
  /* Zwykły wyjątek niesie ścieżki serwera (katalogi osób, instalacja) — do
     dziennika, nie do przeglądarki. Dawniej GET /%00 bez logowania oddawał
     pełną ścieżkę instalacji (zespół IT, runda 4). */
  console.error('Błąd serwera:', e && e.stack ? e.stack : e);
  return { kod: 500, error: 'Błąd serwera — szczegóły są w dzienniku serwera.' };
}

/** Zapis, który nie rzuca: `null` = zapisane, błąd = nie (i wpis w dzienniku).
 *  Dla funkcji save*, które woła też praca w tle — tam wyjątek wywróciłby proces. */
function zapiszLubBlad(opis, fn) {
  try { fn(); return null; } catch (err) {
    console.error(`Nie udało się zapisać ${opis}:`, err.message);
    return err;
  }
}

/** Odpowiedz na nieudany zapis: 507 przy braku miejsca, 500 przy innym błędzie. */
function odpowiedzBledemZapisu(res, sendJson, err) {
  const { kod, error } = bladDlaCzlowieka(err);
  // Kod systemowy (EACCES, EROFS), bez komunikatu — ten niesie ścieżkę katalogu osoby.
  if (kod !== 507) console.error('Nie udało się zapisać:', err.message);
  return sendJson(res, kod, { error: kod === 507 ? error : `Nie udało się zapisać (${err.code || 'błąd dysku serwera'}).` });
}

async function policzKatalog(katalog) {
  let suma = 0;
  let wpisy;
  try { wpisy = await fs.promises.readdir(katalog, { withFileTypes: true }); } catch { return 0; }
  for (const w of wpisy) {
    const p = path.join(katalog, w.name);
    if (w.isDirectory()) suma += await policzKatalog(p);
    else if (w.isFile()) {
      try { suma += (await fs.promises.stat(p)).size; } catch { /* zniknął w trakcie */ }
    }
  }
  return suma;
}

const pamiec = new Map(); // id osoby → { bajty, kiedy, liczenie }

/** Ile bajtów zajmują dane osoby (z pamięci, jeśli świeże). */
async function zajete(u = ktoWymagany('miejsce na dysku')) {
  const w = pamiec.get(u.id);
  if (w && w.kiedy && Date.now() - w.kiedy < WAZNOSC_MS) return w.bajty;
  if (w && w.liczenie) return w.liczenie;
  // katalogDla, nie katalogUzytkownika: liczenie nie zakłada katalogu komuś, kto jeszcze nic nie ma.
  const liczenie = policzKatalog(katalogDla(u.id)).then((bajty) => {
    pamiec.set(u.id, { bajty, kiedy: Date.now(), liczenie: null });
    return bajty;
  });
  pamiec.set(u.id, { bajty: w ? w.bajty : 0, kiedy: 0, liczenie });
  return liczenie;
}

function limitDla(u) {
  return czyWlasciciel(u) ? LIMIT_WLASCICIELA : LIMIT_OSOBY;
}

// Po polsku: „0,6 MB”, nie „0.6 MB” — komunikat czyta człowiek.
const naMb = (b) => String(Math.round(b / MB * 10) / 10).replace('.', ',');

/** Przed zapisem `ile` bajtów w imieniu bieżącej osoby. Za dużo → BrakMiejsca (507). */
async function sprawdz(ile) {
  const u = ktoWymagany('miejsce na dysku');
  const limit = limitDla(u);
  if (!limit) return;
  const juz = await zajete(u);
  if (juz + ile > limit) {
    throw new BrakMiejsca(`Twoje miejsce na serwerze się skończyło (zajęte ${naMb(juz)} MB z ${naMb(limit)} MB, `
      + `ten plik to ${naMb(ile)} MB). Usuń coś z bazy wiedzy albo poproś właściciela o większy limit.`);
  }
}

/** Po udanym zapisie: dolicz bajty do zapamiętanego stanu. */
function dolicz(ile, u = ktoWymagany('miejsce na dysku')) {
  const w = pamiec.get(u.id);
  if (w && w.kiedy) w.bajty = Math.max(0, w.bajty + ile);
}

/** Stan dla panelu: zajęte i limit w bajtach (limit 0 = bez limitu). */
async function stanMiejsca(u = ktoWymagany('miejsce na dysku')) {
  return { zajete: await zajete(u), limit: limitDla(u) };
}

/** Wolne miejsce na dysku serwera (dla właściciela). */
function wolneNaDysku(katalog) {
  try {
    const s = fs.statfsSync(katalog);
    return { wolne: s.bavail * s.bsize, calosc: s.blocks * s.bsize };
  } catch { return null; }
}

module.exports = {
  BrakMiejsca, toBrakMiejsca, zBleduDysku, bladDlaCzlowieka, odpowiedzBledemZapisu, zapiszLubBlad,
  sprawdz, dolicz, zajete, stanMiejsca, wolneNaDysku, limitDla,
};

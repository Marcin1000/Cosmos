/* ============================================================
   Własne gesty – zapis wzorców KAŻDEJ OSOBY OSOBNO

   Wzorzec (palce, kształt dłoni, ruch) liczy przeglądarka z nagrania
   (public/gesty.js), rozpoznaje też ona – serwer tylko przechowuje listę
   i pilnuje, żeby nie przyszło nic spoza umowy: czynność z zamkniętej listy,
   liczby skończone, teksty przycięte. Parametr czynności „otwórz” musi być
   adresem http(s) – inaczej gest byłby drogą do uruchomienia czegokolwiek.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const { genId, readJson, saveJsonFile, sendJson, czytajJson } = require('./rdzen.js');
const miejsce_ = require('./miejsce.js');
const { stan } = require('./kontekst.js');
const { PALCE_GESTU, RUCHY, CZYNNOSCI } = require('../public/gesty.js');
const { adresPrywatny } = require('../public/protokol.js').utworzProtokol();

const MAX_GESTOW = 30;

function G() {
  return stan('gesty', (katalog) => {
    const plik = path.join(katalog, 'gesty.json');
    return { plik, lista: czytajJson(plik, []) };
  });
}

/* Pola tekstowe tylko jako napisy. `String(obiekt)` rzucało przy
   {"nazwa": {"toString": 1}} i trasa oddawała 500 zamiast 400. */
const tekst = (v) => (typeof v === 'string' ? v : '');

/* Każdy błąd niesie `kod` obok zdania po polsku – przeglądarka tłumaczy
   po kodzie (`gest.blad.<kod>`), a `error` zostaje dla starszych klientów. */
const blad = (kod, error) => [null, { kod, error }];

/** Gest z żądania po sprawdzeniu albo [null, {kod, error}]. */
function oczysc(d) {
  const nazwa = tekst(d.nazwa).trim().slice(0, 40);
  if (!nazwa) return blad('brakNazwy', 'Podaj nazwę gestu.');
  const czynnosc = CZYNNOSCI.includes(d.czynnosc) ? d.czynnosc : null;
  if (!czynnosc) return blad('czynnosc', 'Nieznana czynność gestu.');
  const ksztalt = Array.isArray(d.ksztalt) && d.ksztalt.length === 42 && d.ksztalt.every((v) => Number.isFinite(v) && Math.abs(v) < 20)
    ? d.ksztalt.map((v) => Math.round(v * 1000) / 1000) : null;
  if (!ksztalt) return blad('brakNagrania', 'Brak nagrania dłoni – nagraj gest jeszcze raz.');
  const palce = PALCE_GESTU.filter((p) => Array.isArray(d.palce) && d.palce.includes(p));
  const ruch = RUCHY.includes(d.ruch) ? d.ruch : 'brak';
  let parametr = tekst(d.parametr).trim().slice(0, 300);
  if (czynnosc === 'otworz') {
    let adres = parametr;
    if (adres && !/^https?:\/\//i.test(adres)) adres = `https://${adres}`;
    try {
      const u = new URL(adres);
      /* Bez sieci domowej i bez hasła w adresie: gest z „192.168.1.1/cgi-bin/reboot”
         albo „0x7f000001” (= 127.0.0.1) otwierałby router czy sam Cosmos
         jednym ruchem dłoni (zespół IT, runda 7). */
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || u.username || u.password || adresPrywatny(u.href)) throw new Error();
      parametr = u.href;
    } catch { return blad('adres', 'Czynność „Otwórz stronę” potrzebuje publicznego adresu strony (np. onet.pl), nie adresu z sieci domowej.'); }
  }
  if (czynnosc === 'wyslij' && !parametr) {
    return blad('tekst', 'Czynność „Wyślij tekst do Cosmosa” potrzebuje tekstu – wpisz go w polu obok.');
  }
  return [{
    id: typeof d.id === 'string' && /^[\w-]{1,40}$/.test(d.id) ? d.id : genId(),
    nazwa, czynnosc, parametr,
    znaczenie: tekst(d.znaczenie).trim().slice(0, 200),
    palce, ruch, ksztalt,
  }, null];
}

/** Zapis listy w imieniu bieżącej osoby: limit miejsca, potem plik.
 *  `null` = zapisane; inaczej odpowiedź z błędem już wysłana (true). */
async function zapiszListe(res, lista) {
  const tresc = JSON.stringify(lista, null, 2);
  let bylo = 0;
  try { bylo = fs.statSync(G().plik).size; } catch { /* pierwszy gest */ }
  // Przyrost, nie całość: usunięcie albo poprawka gestu przy pełnym limicie ma przejść.
  const przyrost = Buffer.byteLength(tresc) - bylo;
  if (przyrost > 0) {
    try { await miejsce_.sprawdz(przyrost); } catch (err) {
      miejsce_.odpowiedzBledemZapisu(res, sendJson, err);
      return true;
    }
  }
  const bladZapisu = saveJsonFile(G().plik, lista);
  if (bladZapisu) {
    miejsce_.odpowiedzBledemZapisu(res, sendJson, bladZapisu);
    return true;
  }
  miejsce_.dolicz(przyrost);
  return null;
}

async function handleGesty(req, res) {
  if (req.method === 'GET') return sendJson(res, 200, { gesty: G().lista });
  if (req.method === 'POST') {
    let d; try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const [gest, powod] = oczysc(d && typeof d === 'object' ? d : {});
    if (!gest) return sendJson(res, 400, powod);
    const lista = G().lista.slice();
    const i = lista.findIndex((g) => g.id === gest.id);
    if (i >= 0) lista[i] = gest;
    else if (lista.length >= MAX_GESTOW) {
      return sendJson(res, 400, { kod: 'limit', error: `Najwyżej ${MAX_GESTOW} gestów – usuń któryś.` });
    } else lista.push(gest);
    // Stan w pamięci dopiero po udanym zapisie.
    if (await zapiszListe(res, lista)) return;
    G().lista = lista;
    return sendJson(res, 200, { ok: true, gest });
  }
  if (req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const lista = G().lista.filter((g) => g.id !== id);
    if (lista.length === G().lista.length) return sendJson(res, 200, { ok: true });
    if (await zapiszListe(res, lista)) return;
    G().lista = lista;
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405); res.end();
}

module.exports = { handleGesty, oczysc, MAX_GESTOW };

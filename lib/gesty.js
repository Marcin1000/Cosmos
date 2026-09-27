/* ============================================================
   Własne gesty – zapis wzorców KAŻDEJ OSOBY OSOBNO

   Wzorzec (palce, kształt dłoni, ruch) liczy przeglądarka z nagrania
   (public/gesty.js), rozpoznaje też ona – serwer tylko przechowuje listę
   i pilnuje, żeby nie przyszło nic spoza umowy: czynność z zamkniętej listy,
   liczby skończone, teksty przycięte. Parametr czynności „otwórz” musi być
   adresem http(s) – inaczej gest byłby drogą do uruchomienia czegokolwiek.
   ============================================================ */

const path = require('node:path');
const { genId, readJson, saveJsonFile, sendJson, czytajJson } = require('./rdzen.js');
const { odpowiedzBledemZapisu } = require('./miejsce.js');
const { stan } = require('./kontekst.js');
const { PALCE_GESTU, RUCHY, CZYNNOSCI } = require('../public/gesty.js');

const MAX_GESTOW = 30;

function G() {
  return stan('gesty', (katalog) => {
    const plik = path.join(katalog, 'gesty.json');
    return { plik, lista: czytajJson(plik, []) };
  });
}

/** Gest z żądania po sprawdzeniu albo [null, powód]. */
function oczysc(d) {
  const nazwa = String(d.nazwa || '').trim().slice(0, 40);
  if (!nazwa) return [null, 'Podaj nazwę gestu.'];
  const czynnosc = CZYNNOSCI.includes(d.czynnosc) ? d.czynnosc : null;
  if (!czynnosc) return [null, 'Nieznana czynność gestu.'];
  const ksztalt = Array.isArray(d.ksztalt) && d.ksztalt.length === 42 && d.ksztalt.every((v) => Number.isFinite(v) && Math.abs(v) < 20)
    ? d.ksztalt.map((v) => Math.round(v * 1000) / 1000) : null;
  if (!ksztalt) return [null, 'Brak nagrania dłoni – nagraj gest jeszcze raz.'];
  const palce = PALCE_GESTU.filter((p) => Array.isArray(d.palce) && d.palce.includes(p));
  const ruch = RUCHY.includes(d.ruch) ? d.ruch : 'brak';
  let parametr = String(d.parametr || '').trim().slice(0, 300);
  if (czynnosc === 'otworz') {
    let adres = parametr;
    if (adres && !/^https?:\/\//i.test(adres)) adres = `https://${adres}`;
    try {
      const u = new URL(adres);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw new Error();
      parametr = u.href;
    } catch { return [null, 'Czynność „otwórz stronę” potrzebuje adresu strony (np. onet.pl).']; }
  }
  if (czynnosc === 'wyslij' && !parametr) return [null, 'Czynność „wyślij do Cosmosa” potrzebuje tekstu.'];
  return [{
    id: typeof d.id === 'string' && /^[\w-]{1,40}$/.test(d.id) ? d.id : genId(),
    nazwa, czynnosc, parametr,
    znaczenie: String(d.znaczenie || '').trim().slice(0, 200),
    palce, ruch, ksztalt,
  }, ''];
}

async function handleGesty(req, res) {
  if (req.method === 'GET') return sendJson(res, 200, { gesty: G().lista });
  if (req.method === 'POST') {
    let d; try { d = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
    const [gest, powod] = oczysc(d || {});
    if (!gest) return sendJson(res, 400, { error: powod });
    const lista = G().lista.slice();
    const i = lista.findIndex((g) => g.id === gest.id);
    if (i >= 0) lista[i] = gest;
    else if (lista.length >= MAX_GESTOW) return sendJson(res, 400, { error: `Najwyżej ${MAX_GESTOW} gestów – usuń któryś.` });
    else lista.push(gest);
    // Stan w pamięci dopiero po udanym zapisie.
    const blad = saveJsonFile(G().plik, lista);
    if (blad) return odpowiedzBledemZapisu(res, sendJson, blad);
    G().lista = lista;
    return sendJson(res, 200, { ok: true, gest });
  }
  if (req.method === 'DELETE') {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    const lista = G().lista.filter((g) => g.id !== id);
    const blad = saveJsonFile(G().plik, lista);
    if (blad) return odpowiedzBledemZapisu(res, sendJson, blad);
    G().lista = lista;
    return sendJson(res, 200, { ok: true });
  }
  res.writeHead(405); res.end();
}

module.exports = { handleGesty, oczysc, MAX_GESTOW };

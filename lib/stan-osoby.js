/* ============================================================
   Stan osoby — to, co dawniej było zmiennymi modułu w server.js

   Indeks rozmów, profil, lokalizacja, sprzęt, baza wiedzy, oś czasu: przed
   kontami każda z tych rzeczy była zmienną ładowaną raz przy starcie, czyli
   w praktyce „stanem jedynej osoby". Teraz to pola obiektu należącego do
   BIEŻĄCEJ osoby (lib/kontekst.js), ładowanego leniwie z jej katalogu przy
   pierwszym jej żądaniu.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const { stan } = require('./kontekst.js');
const { czytajJson } = require('./rdzen.js');
const { kompaktujWektory } = require('./pamiec.js');

/* STAN OSOBY. Wszystko, co dawniej było zmienną modułu ładowaną raz przy
   starcie — indeks rozmów, profil, lokalizacja, sprzęt, baza wiedzy, oś
   czasu — jest teraz polem obiektu należącego do bieżącej osoby. Ładowane
   leniwie, przy pierwszym jej żądaniu, z jej katalogu. */
function czytajTekst(plik) { try { return fs.readFileSync(plik, 'utf8'); } catch { return ''; } }
// Uszkodzony plik nie może dać po cichu pustego stanu — patrz czytajJson (lib/rdzen.js).
const czytajJsonLub = (plik, domyslnie) => czytajJson(plik, domyslnie);

/** Indeks rozmów — a gdy go brak albo był uszkodzony, a pliki rozmów są na
 *  dysku, odbudowany z nich. Inaczej 21 rozmów leżało na dysku niewidocznych,
 *  a pierwszy zapis utrwalał indeks z jedną. */
function indeksRozmow(katalog) {
  const plik = path.join(katalog, 'conversations', 'index.json');
  const indeks = czytajJsonLub(plik, null);
  if (Array.isArray(indeks) && indeks.length) return indeks;
  let pliki = [];
  try { pliki = fs.readdirSync(path.dirname(plik)).filter((f) => /^[a-z0-9]+\.json$/i.test(f) && f !== 'index.json'); } catch { return indeks || []; }
  if (!pliki.length) return indeks || [];
  const odbudowany = [];
  for (const f of pliki) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(path.dirname(plik), f), 'utf8'));
      if (!c || !c.id) continue;
      odbudowany.push({ id: c.id, title: c.title || '', createdAt: c.createdAt || 0, updatedAt: c.updatedAt || c.createdAt || 0,
        ...(c.pinned ? { pinned: true } : {}) });
    } catch { /* pojedynczy uszkodzony plik rozmowy pomijamy */ }
  }
  odbudowany.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  if (odbudowany.length) console.error(`  Indeks rozmów odbudowany z plików: ${odbudowany.length} (${katalog}).`);
  return odbudowany;
}
function stanOsoby(BRIEFING) {
  return stan('serwer', (katalog, u) => {
    let wspolrzedne = czytajJsonLub(path.join(katalog, 'location.json'), null);
    /* Zapas z odprawy porannej (BRIEFING_LAT) jest ustawieniem serwera,
       czyli właściciela — nie wolno go podsunąć gościowi jako jego domu. */
    if (!wspolrzedne && u.rola === 'wlasciciel' && BRIEFING.lat && BRIEFING.lon) {
      wspolrzedne = { lat: Number(BRIEFING.lat), lon: Number(BRIEFING.lon) };
    }
    return {
      katalog,
      convIndex: indeksRozmow(katalog),
      sprzet: { korpus: '', obiektywy: '', dodatki: '',
        ...czytajJsonLub(path.join(katalog, 'sprzet.json'), {}) },
      profile: czytajTekst(path.join(katalog, 'profile.txt')),
      location: czytajTekst(path.join(katalog, 'location.txt')),
      wspolrzedne,
      // Wektory z tablic liczb → napisy f32 (lib/pamiec.js) — indeks skurczy się przy zapisie.
      kbItems: kompaktujWektory(czytajJsonLub(path.join(katalog, 'kb', 'index.json'), [])),
      timeline: czytajJsonLub(path.join(katalog, 'timeline.json'), []),
      indeksowanie: null,   // { przejrzanych, dodanych, trwa, blad, sygnal }
      reembedBusy: false,
    };
  });
}

module.exports = { stanOsoby };

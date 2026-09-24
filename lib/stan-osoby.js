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

/* STAN OSOBY. Wszystko, co dawniej było zmienną modułu ładowaną raz przy
   starcie — indeks rozmów, profil, lokalizacja, sprzęt, baza wiedzy, oś
   czasu — jest teraz polem obiektu należącego do bieżącej osoby. Ładowane
   leniwie, przy pierwszym jej żądaniu, z jej katalogu. */
function czytajTekst(plik) { try { return fs.readFileSync(plik, 'utf8'); } catch { return ''; } }
function czytajJsonLub(plik, domyslnie) {
  try { return JSON.parse(fs.readFileSync(plik, 'utf8')); } catch { return domyslnie; }
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
      convIndex: czytajJsonLub(path.join(katalog, 'conversations', 'index.json'), []),
      sprzet: { korpus: '', obiektywy: '', dodatki: '',
        ...czytajJsonLub(path.join(katalog, 'sprzet.json'), {}) },
      profile: czytajTekst(path.join(katalog, 'profile.txt')),
      location: czytajTekst(path.join(katalog, 'location.txt')),
      wspolrzedne,
      kbItems: czytajJsonLub(path.join(katalog, 'kb', 'index.json'), []),
      timeline: czytajJsonLub(path.join(katalog, 'timeline.json'), []),
      indeksowanie: null,   // { przejrzanych, dodanych, trwa, blad, sygnal }
      reembedBusy: false,
    };
  });
}

module.exports = { stanOsoby };

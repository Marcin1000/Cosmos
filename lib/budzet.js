/* ============================================================
   Budżet w złotówkach – ile osoba może jeszcze wydać na płatne modele

   Dwa limity, każdy dzienny i miesięczny (0 = bez limitu), trzymane w koncie
   osoby (lib/konta.js):
     – od właściciela (`budzetZl`, tylko członek) – wydatki na KLUCZACH
       WŁAŚCICIELA (przyznany Claude, OpenAI),
     – własny (`wlasnyBudzetZl`, każda osoba, Ustawienia → Agenci) – wszystko
       płatne, co osoba uruchamia, także na własnym kluczu.
   Obowiązuje najciaśniejszy z tych, które dotyczą danego wywołania.

   Wydane złotówki zapisuje WYŁĄCZNIE `konta.zanotujZuzycie` (z `usage`
   dostawcy i cennika). Tu dochodzą REZERWACJE: zespół agentów rusza kilka
   płatnych ról naraz (Promise.all), a sprawdzenie „czy jeszcze mieści się
   w budżecie” bez rezerwacji przepuściłoby wszystkie, bo żadna jeszcze nic
   nie wydała (zespół IT, runda 9: 6 składów przy budżecie na 4 – wszystkie
   przechodziły). `zarezerwuj` jest synchroniczne: sprawdza i odkłada kwotę
   w jednym kroku pętli zdarzeń, więc następna rola widzi już tę rezerwację.

   Kolejność dla jednego płatnego wywołania:
     zarezerwuj(u, szacunek) → wywołanie → konta.zanotujZuzycie(…) → rozlicz(token)
   Wywołanie, które nie ruszyło: zwolnij(token). Rezerwacja bez rozliczenia
   (wyjątek w orkiestratorze) wygasa po REZERWACJA_MS.

   Konto czytane świeżo przy każdym pytaniu – limit zmieniony przez
   właściciela działa od następnej rezerwacji, nie od następnego logowania.
   ============================================================ */

const crypto = require('node:crypto');

const REZERWACJA_MS = 15 * 60 * 1000;
const zl4 = (x) => Math.round((Number(x) || 0) * 1e4) / 1e4;
const dzisiajLokalnie = () => new Date().toLocaleDateString('sv-SE');

/**
 * @param {object} o
 * @param {object} o.konta   lib/konta.js (limityBudzetu, wydaneZl, ustawBudzet, NA_KLUCZU_WLASCICIELA)
 * @param {object} o.cennik  lib/cennik.js (kurs – do widoku)
 */
function utworzBudzet({ konta, cennik }) {
  /** token → { uid, kwota, naKluczuWlasciciela, dzien, kiedy } */
  const rezerwacje = new Map();

  function sprzatnij() {
    const teraz = Date.now();
    for (const [t, r] of rezerwacje) if (teraz - r.kiedy > REZERWACJA_MS) rezerwacje.delete(t);
  }

  /** Zarezerwowane, jeszcze nierozliczone kwoty osoby: dziś / w miesiącu,
   *  wszystkie i tylko na kluczach właściciela. */
  function zarezerwowane(uid) {
    sprzatnij();
    const dzis = dzisiajLokalnie();
    const w = { dzis: { wszystko: 0, wlasciciel: 0 }, miesiac: { wszystko: 0, wlasciciel: 0 } };
    for (const r of rezerwacje.values()) {
      if (r.uid !== uid || r.dzien.slice(0, 7) !== dzis.slice(0, 7)) continue;
      w.miesiac.wszystko += r.kwota;
      if (r.naKluczuWlasciciela) w.miesiac.wlasciciel += r.kwota;
      if (r.dzien === dzis) {
        w.dzis.wszystko += r.kwota;
        if (r.naKluczuWlasciciela) w.dzis.wlasciciel += r.kwota;
      }
    }
    return w;
  }

  /* Limity, które dotyczą wywołania: `naKluczuWlasciciela` undefined = wszystkie
     (widok „ile mi zostało”), true = oba, false = tylko własny. Każdy wpis:
     { limit: 'wlasny'|'wlasciciel', okres: 'dzien'|'miesiac', kwota, wydano, rez }. */
  function progi(u, { naKluczuWlasciciela } = {}) {
    const l = konta.limityBudzetu(u && u.id);
    if (!l) return { progi: [], wydane: null, rez: null };
    const wydane = konta.wydaneZl(u.id);
    const rez = zarezerwowane(u.id);
    const wynik = [];
    const dodaj = (limit, zakres, limity) => {
      for (const [okres, klucz] of [['dzien', 'dzis'], ['miesiac', 'miesiac']]) {
        const kwota = limity[okres];
        if (!(kwota > 0)) continue;
        const wydano = zakres === 'wszystko' ? wydane[klucz].wlasciciel + wydane[klucz].wlasny : wydane[klucz].wlasciciel;
        wynik.push({ limit, okres, kwota, wydano: zl4(wydano), rez: zl4(rez[klucz][zakres]) });
      }
    };
    dodaj('wlasny', 'wszystko', l.wlasny);
    if (l.odWlasciciela && naKluczuWlasciciela !== false) dodaj('wlasciciel', 'wlasciciel', l.odWlasciciela);
    return { progi: wynik, wydane, rez };
  }

  const zostalo = (p) => zl4(p.kwota - p.wydano - p.rez);

  /** Ile osoba jeszcze może wydać – najciaśniejszy z limitów, osobno dzień i miesiąc. */
  function stan(u, opcje = {}) {
    const { progi: lista, wydane, rez } = progi(u, opcje);
    const najciasniejszy = (okres) => lista.filter((p) => p.okres === okres)
      .reduce((a, p) => (!a || zostalo(p) < zostalo(a) ? p : a), null);
    const d = najciasniejszy('dzien');
    const m = najciasniejszy('miesiac');
    /* „Wydano” = ZAWSZE wszystko płatne tej osoby (na obu rodzajach kluczy),
       dziś i w miesiącu z tego samego zakresu. Dawniej przy limicie liczyło
       się w zakresie tego limitu (tylko klucze właściciela), bez limitu –
       wszystko: członek z limitem tylko miesięcznym widział „wydano dziś
       51 zł, w tym miesiącu 4 zł” (zespół IT, etap 5). Kwoty w zakresie
       limitu właściciela – osobno, do paska tego limitu. */
    const wszystko = (klucz) => (wydane ? zl4(wydane[klucz].wlasciciel + wydane[klucz].wlasny) : 0);
    const naKluczu = (klucz) => (wydane ? zl4(wydane[klucz].wlasciciel) : 0);
    const wynik = {
      dzien: d ? d.kwota : 0,
      miesiac: m ? m.kwota : 0,
      wydanoDzis: wszystko('dzis'),
      wydanoMiesiac: wszystko('miesiac'),
      // Wydane na kluczach właściciela (przyznany Claude, OpenAI) – limit od właściciela liczy tylko te.
      wydanoNaKluczuWlascicielaDzis: naKluczu('dzis'),
      wydanoNaKluczuWlascicielaMiesiac: naKluczu('miesiac'),
      // Ile z „wydano” liczy najciaśniejszy limit danego okresu (null – bez limitu).
      wydanoWLimicieDzis: d ? d.wydano : null,
      wydanoWLimicieMiesiac: m ? m.wydano : null,
      zarezerwowano: rez ? zl4(rez.miesiac.wszystko) : 0,
      zostaloDzis: d ? Math.max(0, zostalo(d)) : null,
      zostaloMiesiac: m ? Math.max(0, zostalo(m)) : null,
      limit: { dzien: d ? d.limit : null, miesiac: m ? m.limit : null },
    };
    wynik.wyczerpany = (d !== null && zostalo(d) <= 0) || (m !== null && zostalo(m) <= 0);
    return wynik;
  }

  /** Czy limit już się skończył (zwykły czat pyta przed płatnym silnikiem).
   *  null – można; inaczej { kod, okres, limit, zostalo: 0 }. */
  function wyczerpany(u, opcje = {}) {
    const p = progi(u, opcje).progi.find((x) => zostalo(x) <= 0);
    return p ? { kod: p.okres === 'dzien' ? 'budzet-dzienny' : 'budzet-miesieczny', okres: p.okres, limit: p.limit, zostalo: 0 } : null;
  }

  /** Zarezerwuj szacunek przed płatnym wywołaniem – synchronicznie.
   *
   *  `przytnij: true` (zwykły czat, wywołania pomocnicze): szacunek bierze
   *  pełne `max_tokens` i myślenie, więc bywa większy niż cały mały limit –
   *  członek z 0,50 zł nie napisałby wtedy ani słowa na płatnym silniku. Gdy
   *  szacunek się nie mieści, ale osoba nie ma żadnej innej rezerwacji
   *  i limit nie jest wyczerpany, rezerwujemy RESZTĘ limitu: jedno wywołanie
   *  naraz przechodzi (może przekroczyć limit najwyżej o siebie), a każde
   *  równoległe dostaje odmowę, bo reszta jest już zajęta. */
  function zarezerwuj(u, kwotaZl, { naKluczuWlasciciela = false, przytnij = false } = {}) {
    let kwota = Math.max(0, zl4(kwotaZl));
    if (!u || !u.id) throw new Error('budzet.zarezerwuj: brak osoby');
    if (kwota > 0) {
      const lista = progi(u, { naKluczuWlasciciela: Boolean(naKluczuWlasciciela) }).progi;
      let za = lista
        .filter((p) => p.wydano + p.rez + kwota > p.kwota + 1e-9)
        .sort((a, b) => zostalo(a) - zostalo(b))[0];
      if (za && przytnij && lista.every((p) => p.rez <= 0 && zostalo(p) > 0)) {
        kwota = Math.min(...lista.map(zostalo));
        za = null;
      }
      if (za) {
        return { ok: false, kod: za.okres === 'dzien' ? 'budzet-dzienny' : 'budzet-miesieczny',
          okres: za.okres, limit: za.limit, zostalo: Math.max(0, zostalo(za)) };
      }
    }
    const token = crypto.randomBytes(9).toString('base64url');
    rezerwacje.set(token, { uid: u.id, kwota, naKluczuWlasciciela: Boolean(naKluczuWlasciciela), dzien: dzisiajLokalnie(), kiedy: Date.now() });
    return { ok: true, token };
  }

  /** Zwolnij rezerwację po wywołaniu. Wydatek zapisał już konta.zanotujZuzycie –
   *  `kosztZl` wraca tylko dla porównania z szacunkiem. */
  function rozlicz(token, kosztZl) {
    const r = rezerwacje.get(token);
    rezerwacje.delete(token);
    return { szacunek: r ? r.kwota : 0, kosztZl: zl4(kosztZl) };
  }

  function zwolnij(token) { return rezerwacje.delete(token); }

  /** Limity osoby: własny i od właściciela (null u właściciela). */
  const limity = (u) => konta.limityBudzetu(u && u.id) || { wlasny: { dzien: 0, miesiac: 0 }, odWlasciciela: null };

  /** Własny limit osoby (Ustawienia → Agenci). null = zapisane, inaczej błąd
   *  (`kod` 400 – zła kwota; inny – błąd zapisu dla bladZapisu). */
  function ustawWlasny(u, dane) {
    const w = konta.ustawBudzet(u && u.id, dane, { wlasny: true });
    return w.blad || null;
  }

  return { stan, wyczerpany, zarezerwuj, rozlicz, zwolnij, limity, ustawWlasny, kurs: () => cennik.kurs(),
    // dla testów
    _rezerwacji: () => rezerwacje.size };
}

module.exports = { utworzBudzet, REZERWACJA_MS };

/* ============================================================
   Zespół agentów – orkiestrator jednej tury (w JEDNYM biegu)

   Prowadzący to model z zakładki. Do trudnego pytania zaprasza pomocników
   (role z katalogu w lib/zespol-plan.js), każdy na modelu, który serwer
   przydziela z tego, na co osoba ma zgodę; ich notatki idą do prowadzącego
   jako cudzy tekst, a on pisze JEDNĄ odpowiedź. Przebieg:

     0. bieg zakładany OD RAZU – nagłówki i puls 25 s przed planistą
        (tura zespołu trwa 10–60 s, Cloudflare zrywa po 100 s ciszy),
     1. planista (krótkie wywołanie, tani model bez myślenia, ≤ 20 s) albo
        skład od osoby; porażka planisty → skład z heurystyki,
     2. strażnik składu: uprawnienia, przyznanie „zespol”, prywatność
        (lokalny prowadzący + chmura tylko za zgodą), lista modeli
        właściciela, sufit tokenów – każda zamiana z `zamiast` i `powod`,
     3. role: fala 1 równolegle (lokalnie po kolei – przydział), recenzent
        w fali 2 na notatkach; zegary roli ruszają PO wyjściu z kolejki,
     4. prowadzący: te same kroki co zwykły czat (lib/czat.js), notatki
        w ostatniej wypowiedzi człowieka,
     5. zapis: notatki jak wynik narzędzia + odpowiedź, jednym zapisem.

   Zdarzenia w biegu (bez klucza `choices` – stary klient ich nie widzi):
     event: zespol {v, faza:'planowanie'|'odmowa', kod?, powod?}
     event: sklad  {v, zrodlo, prowadzacy, role:[…], odrzucone:[…], daneWyjdaDo, propozycja?,
                    szacunekZl? (cała tura), szacunekProwadzacyZl?,
                    skladDomyslny ('proponowany'|'darmowy'), tylkoDarmowe? (tura na samych darmowych),
                    darmowe? {role, odrzucone, szacunekZl?, prowadzacyPlatny} – wariant „Darmowe
                    modele” z tego samego planu (K5, runda 10), kandydaci? {rola: [{silnik, model, darmowy}]}}
     event: rola   {r, stan, d?, ms?, blad?, kod?, urwane?, zapas?, kolejka?}
     event: faza   {faza:'prowadzacy', t, notatki, kosztZl?, planPoliczony?}
   potem zwykłe bloki prowadzącego i `event: koniec`.

   Prototypy: agencja-backend (zespol-proto.js), it-backend (zespol.js –
   Przydział, wykonajRole), it-konta (straznik-zespolu.js, paczka-roli.js),
   agencja-rozmowa (orkiestra.js). Runda 9.

   Twarda zasada: każde wywołanie modelu idzie w imieniu JAWNEJ osoby –
   silniki.dostepDla(nazwa, u), nigdy strażnik bez osoby (audyt tego
   pilnuje). Konto czytamy świeżo przed każdą rolą: odebrane
   przyznanie działa od następnej roli.
   ============================================================ */

const path = require('node:path');
const { zapytajModel, ustawMyslenie, blindToImages, cichoMysli, czytajUsage, sposobMyslenia, rodzinaClaude } = require('./model.js');
const { sendJson, readJson, zapiszAtomowo, czytajJson } = require('./rdzen.js');
const { kto, ktoWymagany, stanDla, BrakKontekstu } = require('./kontekst.js');
const silniki = require('./silniki.js');
const plan_ = require('./zespol-plan.js');
const { blokWkladowZespolu, blokSprzetu, NAGLOWEK_NOTATEK } = require('./instrukcje-narzedzi.js');
const { tekstPytania, ostatniaMaObraz, bezObrazow, zObrazemWidzisz, przytnijDoOkna, zegarCiszy, szacujTokeny,
  rozpoznajBladStrumienia, oknoLokalneDla } = require('./czat.js');
const { modelToolLevel } = require('../public/models.js');
const { rozdzielMyslenie, stripSearchMarker } = require('../public/protokol.js').utworzProtokol();

const env = (k, d) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
const LIMITY = {
  maxRolCzlonka: env('COSMOS_ZESPOL_MAX_ROL', 3),
  maxRolWlasciciela: env('COSMOS_ZESPOL_MAX_ROL_WLASCICIELA', 5),
  bezpiecznikRol: 6,                                         // także dla właściciela
  maxRolLokalnie: 2,                                         // jeden GPU: role idą po kolei
  naDobe: env('COSMOS_ZESPOL_NA_DOBE', 40),                  // tury zespołu członka na dobę
  naraz: { czlonek: 1, wlasciciel: 2 },
  terminPlanistyMs: env('COSMOS_ZESPOL_TERMIN_PLANISTY_MS', 20_000),
  // Głos: każdą sekundę ciszy słychać – planista krócej (też „tylko plan” przed pytaniem o zgodę).
  terminPlanistyGlosMs: env('COSMOS_ZESPOL_TERMIN_PLANISTY_GLOS_MS', 8_000),
  // Plan zdjęciowy dla fotografa (efemerydy, pogoda) – jak wyszukiwanie badacza, przed startem roli.
  terminPlanuMs: env('COSMOS_ZESPOL_TERMIN_PLANU_MS', 15_000),
  // W głosie każdą sekundę słychać, a faza ról ma 45 s – plan krócej (it-backend: 15 s to 1/3 fazy).
  terminPlanuGlosMs: env('COSMOS_ZESPOL_TERMIN_PLANU_GLOS_MS', 6_000),
  // Fala 3 (poprawka kodu po recenzji) tylko, gdy do końca fazy ról zostało co najmniej tyle.
  minNaPoprawkeMs: env('COSMOS_ZESPOL_MIN_NA_POPRAWKE_MS', 20_000),
  terminRoliMs: env('COSMOS_ZESPOL_TERMIN_ROLI_MS', 90_000),
  ciszaRoliMs: env('COSMOS_ZESPOL_CISZA_MS', 45_000),
  terminFazyMs: env('COSMOS_ZESPOL_TERMIN_FAZY_MS', 120_000),
  terminFazyGlosMs: env('COSMOS_ZESPOL_TERMIN_FAZY_GLOS_MS', 45_000),
  // Zapas na modelu prowadzącego tylko, gdy do końca fazy zostało tyle (15 s przy fazie 120 s).
  get zapasGdyZostaloMs() { return Math.min(15_000, Math.round(this.terminFazyMs / 4)); },
  zlewkaMs: env('COSMOS_ZESPOL_ZLEWKA_MS', 250),
  // Głos: skład czeka na zgodę na chmurę – bieg stoi (bez ról) do Stop przeglądarki, najwyżej tyle.
  czekajNaZgodeMs: env('COSMOS_ZESPOL_CZEKAJ_NA_ZGODE_MS', 60_000),
  terminSzukaniaMs: 10_000,
  maxZnakowWkladu: 8000,
  maxTokenowPlanisty: 600,
};
/* Kto dostanie dane tury – dla człowieka, bez adresów. Dom (lokalny GPU) to
   nie „wyjście” danych. */
const DOSTAWCA = { cloud: 'NVIDIA', openai: 'OpenAI', claude: 'Anthropic' };
const SILNIKI = ['cloud', 'local', 'openai', 'claude'];
const KONCOWE = new Set(['gotowa', 'niedokonczona', 'urwana', 'blad', 'przerwana', 'pominieta']);
const nazwaSilnika = (s) => (SILNIKI.includes(s) ? s : 'cloud');
// Ustawienie „Jaki skład proponować” (K5).
const SKLADY_DOMYSLNE = ['proponowany', 'darmowy'];
const { rankingModeli, rodzinaModelu, ZALECANE_DARMOWE, WAZNOSC_SONDY_MS, umiejetnosci: umiejetnosciModelu } = require('./umiejetnosci.js');

/**
 * @param {object} z
 * @param {object}   z.czat          obiekt z lib/czat.js (zlozKontekst, wybierzModel, wyslijDoDostawcy, pompujDoBiegu …)
 * @param {object}   z.biegi         lib/biegi.js
 * @param {object}   z.konta         lib/konta.js (znajdz – świeże konto, zanotujZuzycie)
 * @param {Function} z.U             stan bieżącej osoby (sprzęt)
 * @param {Function} z.terazTekst    data i godzina
 * @param {Function} z.szukajTekstu  lib/szukanie.js – wyszukiwanie dla badacza
 * @param {object}   z.rejestrModeli lib/umiejetnosci.js (umiejetnosciModelu) albo null
 * @param {Function} z.czyZamykanie  SIGTERM: żadnych nowych płatnych wywołań
 * @param {Function} z.bladZapisu    507/500 przy nieudanym zapisie
 * @param {object}   z.przydzial     lib/przydzial.js (domyślnie wspólny)
 * @param {Function} z.log           metryki bez treści
 * @param {object}   z.cennik        lib/cennik.js (szacujZl, kosztZl, darmowy, kurs) – brak: bez kwot
 * @param {object}   z.budzet        lib/budzet.js (stan, zarezerwuj, rozlicz, zwolnij) – brak: budżet nie blokuje
 * @param {Function} z.policzPlan    lib/plener-trasy.js – plan zdjęciowy dla fotografa; brak: fotograf mówi NIEPEWNE
 */
function utworz(z) {
  const { czat, biegi, konta, U } = z;
  const terazTekst = z.terazTekst || (() => new Date().toISOString());
  const szukajTekstu = z.szukajTekstu || null;
  const rejestrModeli = z.rejestrModeli || null;
  const czyZamykanie = z.czyZamykanie || (() => false);
  const bladZapisu = z.bladZapisu || null;
  const przydzial = z.przydzial || require('./przydzial.js').wspolny;
  const log = z.log || ((o) => console.log(`ZESPÓŁ ${JSON.stringify(o)}`));
  const scrubSecrets = z.scrubSecrets || ((t) => t);
  const cennik = z.cennik || null;
  const budzet = z.budzet || null;
  const policzPlan = typeof z.policzPlan === 'function' ? z.policzPlan : null;

  /* Ile zespołów trwa – na osobę (jeden naraz u członka, dwa u właściciela)
     i ile ich było dziś (limit dobowy członka; wspólny klucz NVIDIA ma limit
     zapytań na minutę dla wszystkich). W pamięci – restart zeruje licznik. */
  const AKTYWNE = new Map();
  const DZIS = new Map();
  const dzien = () => new Date().toLocaleDateString('sv-SE');
  const ileDzis = (id) => { const d = DZIS.get(id); return d && d.dzien === dzien() ? d.n : 0; };
  const policzDzis = (id) => DZIS.set(id, { dzien: dzien(), n: ileDzis(id) + 1 });

  // -------------------------------------------------------------------------
  // Budżet w złotówkach (lib/cennik.js + lib/budzet.js – paczka K)
  // -------------------------------------------------------------------------

  /* Zasada: rezerwacja PRZED płatnym wywołaniem (synchronicznie – role idą
     przez Promise.all i nie mogą razem przekroczyć limitu), rozliczenie PO
     nim kosztem z `usage` (bez usage – szacunkiem, z flagą). Brak modułów
     (starsza wersja, test) = kwot nie ma, budżet nie blokuje. Wyjątek
     w cudzym module nie wywraca tury – ale BrakKontekstu tak (błąd programu). */
  const PLATNE_DOMYSLNIE = new Set(['openai', 'claude']);
  const zaokr = (x) => Math.round(x * 10000) / 10000;
  const bezpiecznie = (fn, zapas) => { try { return fn(); } catch (err) { if (err instanceof BrakKontekstu) throw err; return zapas; } };
  const platny = (s) => bezpiecznie(() => (cennik && typeof cennik.darmowy === 'function' ? !cennik.darmowy(s) : PLATNE_DOMYSLNIE.has(s)),
    PLATNE_DOMYSLNIE.has(s));
  const naKluczuWlasciciela = (zrodlo) => zrodlo === 'wlasciciel' || zrodlo === 'przyznany';
  const kwota = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? zaokr(Number(v)) : 0);
  /* `myslenie: false` – rola bez myślenia (ustawMyslenie wyłącza), cennik nie
     dolicza ukrytego rozumowania; undefined – cennik liczy je dla modeli myślących. */
  const szacujZl = (model, silnik, we, wy, myslenie) => (cennik && platny(silnik)
    ? kwota(bezpiecznie(() => cennik.szacujZl(model, silnik, { we: Math.round(we), wy: Math.round(wy), ...(myslenie === false ? { myslenie: false } : {}) }), 0)) : 0);
  const kosztZl = (model, silnik, we, wy) => (cennik && platny(silnik)
    ? kwota(bezpiecznie(() => cennik.kosztZl(model, silnik, { we: Math.round(we), wy: Math.round(wy) }), 0)) : 0);
  /** Rezerwacja na budżecie osoby. { ok, token } – token null = nic nie zarezerwowano. */
  function zarezerwuj(u, zl, zrodlo) {
    if (!budzet || !(zl > 0)) return { ok: true, token: null };
    const r = bezpiecznie(() => budzet.zarezerwuj(u, zl, { naKluczuWlasciciela: naKluczuWlasciciela(zrodlo) }), null);
    return r && typeof r === 'object' && typeof r.ok === 'boolean' ? r : { ok: true, token: null };
  }
  const rozlicz = (token, zl) => { if (budzet && token) bezpiecznie(() => budzet.rozlicz(token, zl), null); };
  const zwolnijRez = (token) => { if (budzet && token) bezpiecznie(() => budzet.zwolnij(token), null); };
  /** Czy osoba ma limit wyczerpany (dowolny: dzienny albo miesięczny, ustawiony). */
  function budzetWyczerpany(u) {
    if (!budzet) return false;
    const st = bezpiecznie(() => budzet.stan(u), null);
    if (!st || typeof st !== 'object') return false;
    if (typeof st.wyczerpany === 'boolean') return st.wyczerpany;
    const zero = (limit, zostalo) => Number(limit) > 0 && typeof zostalo === 'number' && zostalo <= 0;
    return zero(st.dzien, st.zostaloDzis) || zero(st.miesiac, st.zostaloMiesiac);
  }
  /** Zużycie z kosztem – `model` i `zl` dla lib/budzet.js (paczka K). */
  function notujZuzycie(u, { silnik, zrodlo, model, we = 0, wy = 0, zl = 0 }) {
    try {
      konta.zanotujZuzycie(u.id, { silnik, zrodlo, we, wy, model, ...(cennik ? { zl } : {}) });
    } catch { /* licznik nie psuje tury */ }
  }

  // -------------------------------------------------------------------------
  // Ustawienia osoby – na serwerze (telefon i komputer muszą się zgadzać)
  // -------------------------------------------------------------------------

  // Jawna osoba, nie „bieżąca”: ustawienia czyta też budżet (paczka K) w imieniu u.
  const US = (u) => stanDla(u, 'zespol-ustawienia', (katalog) => {
    const plik = path.join(katalog, 'zespol.json');
    return { plik, dane: czytajJson(plik, {}) || {} };
  });
  const maxRolOsoby = (u) => Math.min(LIMITY.bezpiecznikRol, u && u.rola === 'wlasciciel' ? LIMITY.maxRolWlasciciela : LIMITY.maxRolCzlonka);
  const zlotowki = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

  /** Własne role z pliku – druga walidacja (plik mógł ktoś poprawić ręcznie). */
  function wlasneZPliku(lista) {
    if (!Array.isArray(lista)) return [];
    const w = plan_.walidujWlasneRole(lista.filter((r) => r && plan_.czyWlasna(r.id)).slice(0, plan_.MAX_WLASNYCH), lista);
    return w.ok ? w.role : [];
  }

  /** Ustawienia po walidacji – z wartościami domyślnymi. */
  function ustawienia(u = ktoWymagany('ustawienia zespołu')) {
    const d = US(u).dane || {};
    const max = maxRolOsoby(u);
    const wlasneRole = wlasneZPliku(d.wlasneRole);
    const katalog = plan_.katalogOsoby(wlasneRole);
    const role = {};
    for (const [k, v] of Object.entries(d.role && typeof d.role === 'object' ? d.role : {})) {
      if (!Object.hasOwn(katalog, k) || !v || typeof v !== 'object' || !SILNIKI.includes(v.silnik)) continue;
      role[k] = { silnik: v.silnik, model: typeof v.model === 'string' ? v.model.slice(0, 200) : '' };
    }
    // Własny limit w zł żyje w koncie osoby (lib/budzet.js – paczka K), nie w pliku zespołu.
    const lim = budzet && typeof budzet.limity === 'function' ? bezpiecznie(() => budzet.limity(u), null) : null;
    const b = lim && lim.wlasny && typeof lim.wlasny === 'object' ? lim.wlasny : {};
    return {
      tryb: plan_.TRYBY.includes(d.tryb) ? d.tryb : 'proponuj',
      maxRol: Math.max(1, Math.min(max, Number.isInteger(d.maxRol) ? d.maxRol : 3)),
      zgodaChmura: d.zgodaChmura === true,
      // „Pytaj przed startem” – domyślnie tak (płatny silnik inny niż prowadzący, zgoda na chmurę).
      potwierdzaj: d.potwierdzaj !== false,
      /* „Jaki skład proponować” (K5): 'proponowany' – najmocniejszy model do roli,
         także płatny; 'darmowy' – sama chmura NVIDIA i lokalny GPU. Od niego
         startuje bramka i tryb „Uruchamiaj sam”. */
      skladDomyslny: SKLADY_DOMYSLNE.includes(d.skladDomyslny) ? d.skladDomyslny : 'proponowany',
      budzetZl: { dzien: zlotowki(b.dzien), miesiac: zlotowki(b.miesiac) },
      role,
      wlasneRole,
    };
  }

  /** Katalog ról tej osoby (role Cosmosa + jej własne). */
  const katalogDla = (u) => plan_.katalogOsoby(ustawienia(u).wlasneRole);

  /** Zapis ustawień z BIAŁEJ LISTY pól; silnik roli tylko z dostępnych osobie.
   *  { ustawienia } | { blad } (zapis) | { odmowa: {kod, error} } (400). */
  function zapiszUstawienia(dane, u = ktoWymagany('ustawienia zespołu')) {
    const obecne = ustawienia(u);
    const nowe = { ...obecne };
    if (plan_.TRYBY.includes(dane.tryb)) nowe.tryb = dane.tryb;
    if (Number.isInteger(dane.maxRol)) nowe.maxRol = Math.max(1, Math.min(maxRolOsoby(u), dane.maxRol));
    if (typeof dane.zgodaChmura === 'boolean') nowe.zgodaChmura = dane.zgodaChmura;
    if (typeof dane.potwierdzaj === 'boolean') nowe.potwierdzaj = dane.potwierdzaj;
    if (SKLADY_DOMYSLNE.includes(dane.skladDomyslny)) nowe.skladDomyslny = dane.skladDomyslny;
    if (dane.wlasneRole !== undefined) {
      // Nowa albo przemianowana rola nie może się nazywać jak rola Cosmosa (400 `nazwa-zajeta`).
      const w = plan_.walidujWlasneRole(dane.wlasneRole, obecne.wlasneRole, { sprawdzNazwy: true });
      if (!w.ok) return { odmowa: { kod: w.kod, error: w.blad } };
      nowe.wlasneRole = w.role;
    }
    /* Własny limit w zł – zapis w koncie (lib/budzet.js). NAJPIERW, bo może
       odmówić (zła kwota): wtedy nie zapisujemy nic, osoba nie dostaje
       połowy zmian. */
    if (dane.budzetZl && typeof dane.budzetZl === 'object' && budzet && typeof budzet.ustawWlasny === 'function') {
      const err = budzet.ustawWlasny(u, dane.budzetZl);
      if (err) {
        if (err.kod === 400) return { odmowa: { kod: 'budzet-zly', error: String(err.message || 'Zła kwota budżetu.') } };
        return { blad: err };
      }
    }
    delete nowe.budzetZl;
    const katalog = plan_.katalogOsoby(nowe.wlasneRole);
    if (dane.role && typeof dane.role === 'object') {
      const role = {};
      for (const [k, v] of Object.entries(dane.role)) {
        if (!Object.hasOwn(katalog, k) || !v || typeof v !== 'object' || v === 'auto') continue;
        if (!SILNIKI.includes(v.silnik) || !silniki.dostepDla(v.silnik, u).ok) continue;
        role[k] = { silnik: v.silnik, model: typeof v.model === 'string' ? v.model.slice(0, 200) : '' };
      }
      nowe.role = role;
    } else {
      // Usunięta własna rola nie zostawia po sobie wyboru modelu.
      nowe.role = Object.fromEntries(Object.entries(nowe.role).filter(([k]) => Object.hasOwn(katalog, k)));
    }
    const us = US(u);
    try {
      zapiszAtomowo(us.plik, JSON.stringify(nowe));
    } catch (err) { return { blad: err }; }
    us.dane = nowe;
    return { ustawienia: ustawienia(u) };
  }

  /** Obiekt `zespol` do /api/config – bez sekretów i bez adresów. */
  function doKonfiguracji() {
    const u = kto();
    if (!u) return { dozwolony: false };
    const us = ustawienia(u);
    // `budzet` (stan) i `kurs` dokłada server.js (paczka K) – tu tylko to, co należy do zespołu.
    return {
      dozwolony: process.env.COSMOS_ZESPOL !== '0',
      przyznany: silniki.zespolDozwolony(u),
      tryb: us.tryb, maxRol: us.maxRol, maxRolSufit: maxRolOsoby(u), zgodaChmura: us.zgodaChmura,
      potwierdzaj: us.potwierdzaj, budzetZl: us.budzetZl, skladDomyslny: us.skladDomyslny,
      role: Object.keys(plan_.katalogOsoby(us.wlasneRole)),
    };
  }

  // -------------------------------------------------------------------------
  // Pula modeli i strażnik składu
  // -------------------------------------------------------------------------

  /* Silnik, który naprawdę da się użyć: chmura NVIDIA bez klucza oddaje
     „Brak klucza API”, lokalny bez modelu – nic (it-konta, D7). */
  const uzywalny = (nazwa, ep) => (nazwa === 'cloud' ? Boolean(ep.apiKey) || !String(ep.baseUrl || '').includes('integrate.api.nvidia.com')
    : nazwa === 'local' ? Boolean(ep.model) : true);

  /** Czy rola na silniku `s` jest dla osoby `u` dozwolona. '' = tak, inaczej kod odmowy. */
  function odmowaSilnika(s, d, u, { prowadzacy, zgodaChmura }) {
    if (!d.ok) return 'uprawnienia';
    if (!uzywalny(s, d.ep)) return 'niedostepny';
    /* Przyznanie „zespol”: bez niego role nie liczą się na kluczach i GPU
       właściciela – członek ma zespół na chmurze wspólnej i własnych kluczach. */
    if (d.zrodlo === 'przyznany' && !silniki.zespolDozwolony(u)) return 'zespol-nie-przyznany';
    if (prowadzacy === 'local' && s !== 'local' && !zgodaChmura) return 'wymaga-zgody';
    return '';
  }

  /** Pula kandydatów dla doboru modelu: silniki osoby × (model zakładki, model
   *  wizyjny, lista właściciela dla przyznanych). Tylko to, na co osoba ma
   *  zgodę – kandydat spoza uprawnień nie istnieje. */
  function pulaKandydatow(u, { prowadzacy, zgodaChmura, modele = {} }) {
    const pula = [];
    for (const s of SILNIKI) {
      const d = silniki.dostepDla(s, u);
      if (odmowaSilnika(s, d, u, { prowadzacy: prowadzacy.silnik, zgodaChmura })) continue;
      const g = silniki.granice(s, u);
      const wybrany = typeof modele[s] === 'string' && modele[s].trim() ? modele[s].trim().slice(0, 200) : '';
      const ids = [...new Set([s === prowadzacy.silnik ? prowadzacy.model : '', wybrany, d.ep.model, d.ep.visionModel, ...((g && g.modele) || [])]
        .filter(Boolean))];
      for (const id of ids) {
        const { model } = silniki.modelDozwolony(s, id, u);
        if (!model || pula.some((k) => k.id === model && k.silnik === s)) continue;
        pula.push({ id: model, silnik: s, zrodlo: d.zrodlo,
          umiejetnosci: rejestrModeli ? rejestrModeli.umiejetnosciModelu(model, s) : undefined });
      }
    }
    return pula;
  }

  /** Pula wariantu „Darmowe modele” (K5, Z2): darmowe silniki z puli osoby
   *  + modele chmury NVIDIA ze świeżą udaną sondą „Sprawdź” + zalecane na
   *  role (ZALECANE_DARMOWE). Dziś pula chmury to 1–2 modele z .env i zakładki,
   *  więc „najlepiej dopasowany darmowy” nie miał z czego wybierać
   *  (it-modele-open). Na silniku przyznanym z listą właściciela – tylko modele
   *  z tej listy; model, którego konto nie ma, odrzuca sonda (rozmowa=false). */
  function pulaDarmowa(u, { prowadzacy, zgodaChmura, modele = {} }) {
    const pula = pulaKandydatow(u, { prowadzacy, zgodaChmura, modele }).filter((k) => !platny(k.silnik));
    const d = silniki.dostepDla('cloud', u);
    if (platny('cloud') || odmowaSilnika('cloud', d, u, { prowadzacy: prowadzacy.silnik, zgodaChmura })) return pula;
    const sondy = rejestrModeli && typeof rejestrModeli.sprawdzenia === 'function'
      ? bezpiecznie(() => rejestrModeli.sprawdzenia('cloud'), []).filter((w) => w && w.rozmowa === true && typeof w.model === 'string'
        && Date.now() - (Number(w.kiedy) || 0) <= WAZNOSC_SONDY_MS).map((w) => w.model) : [];
    for (const id of [...new Set([...sondy, ...Object.values(ZALECANE_DARMOWE).flat()])]) {
      const m = silniki.modelDozwolony('cloud', id, u);
      if (m.model !== id || pula.some((k) => k.id === id && k.silnik === 'cloud')) continue;
      pula.push({ id, silnik: 'cloud', zrodlo: d.zrodlo, umiejetnosci: rejestrModeli ? rejestrModeli.umiejetnosciModelu(id, 'cloud') : undefined });
    }
    return pula;
  }

  /** Cena modelu do zapory „nie droższy niż płatny prowadzący” – USD za milion
   *  tokenów (wejście + 4 × wyjście, jak typowa rola); null = cennika brak. */
  const cenaModelu = (id, silnik) => {
    if (!cennik || typeof cennik.ceny !== 'function') return null;
    const c = bezpiecznie(() => cennik.ceny(id, silnik), null);
    return c && Number.isFinite(c.we) && Number.isFinite(c.wy) ? c.we + 4 * c.wy : null;
  };

  /** Limit tokenów roli. Model, którego sposobu myślenia nie znamy (spoza
   *  katalogu, zgadnięty z nazwy, wpis z pamięci bez `myslenie`), dostaje
   *  budżet jak myślący, a w roli bez myślenia co najmniej 1500 – GLM-4.7 czy
   *  Kimi myślą domyślnie i przy 572 tokenach zostawiały pustą notatkę
   *  (it-modele-open, runda 10). `mysli` – czy rola w tej turze myśli. */
  function limitRoli(rola, model, mysli, katalog = plan_.KATALOG) {
    const nieznane = !sposobMyslenia(model) && umiejetnosciModelu(model, '').myslenieNieznane;
    const limit = plan_.maxTokenowRoli(rola, mysli && (Boolean(sposobMyslenia(model)) || nieznane), katalog);
    return nieznane ? Math.max(limit, 1500) : limit;
  }
  /** Czy rola myśli w tej turze: z katalogu, a w wariancie darmowym tylko
   *  analityk – trzy myślące role naraz na darmowej chmurze dochodziły do
   *  terminu roli (agencja-rozmowa, runda 10). */
  const mysliWTurze = (rola, katalog, tylkoDarmowe) => plan_.mysliRola(rola, katalog) && (!tylkoDarmowe || rola === 'analityk');

  /** Model planisty: najszybszy NIEMYŚLĄCY z puli, najlepiej na silniku
   *  prowadzącego; poziom ≠ 'rozmowa'. Brak → null (skład z heurystyki). */
  function modelPlanisty(pula, prowadzacy) {
    const dobre = pula.filter((k) => !cichoMysli({ anthropic: k.silnik === 'claude' }, k.id) && sposobMyslenia(k.id) !== 'zawsze'
      && modelToolLevel(k.id) !== 'rozmowa');
    const szybki = (k) => Boolean(k.umiejetnosci ? k.umiejetnosci.szybki : false);
    const kolejnosc = [
      (k) => k.silnik === prowadzacy.silnik && k.id === prowadzacy.model,
      (k) => k.silnik === prowadzacy.silnik && szybki(k),
      (k) => k.silnik === prowadzacy.silnik,
      (k) => szybki(k),
      () => true,
    ];
    for (const f of kolejnosc) { const k = dobre.find(f); if (k) return k; }
    return null;
  }

  /**
   * Strażnik składu. Każda rola: silnik zaproponowany → silnik prowadzącego →
   * chmura wspólna (→ lokalny GPU, gdy płatnego nie puścił budżet). Nigdy
   * cicho: zmiana ma `zamiast` {silnik, model} i `powod` (kody po przecinku).
   * Synchronicznie, przed startem czegokolwiek – także rezerwacje budżetu:
   * role idą potem przez Promise.all i razem nie mogą przekroczyć limitu.
   * `rezerwuj: false` (sam plan, propozycja) – rezerwacje na sucho, zwolnione
   * przed powrotem.
   */
  function rozstrzygnij(u, role, { prowadzacy, zgodaChmura, maxRol, katalog = plan_.KATALOG, szacunek = null, rezerwuj = false, tylkoDarmowe = false }) {
    const wynik = [];
    const odrzucone = [];
    const naSucho = [];
    let lokalnych = 0;
    role.forEach((p, i) => {
      const def = katalog[p.rola];
      const r = { r: `r${i + 1}`, rola: p.rola, nazwa: def.nazwa.pl, zadanie: p.zadanie || def.zadanieDomyslne, fala: def.fala,
        ...(def.wlasna ? { wlasna: true } : {}) };
      if (wynik.length >= maxRol) { odrzucone.push({ rola: p.rola, kod: 'limit-rol', powod: `najwyżej ${plan_.ileRol(maxRol)}` }); return; }
      // Wariant darmowy: recenzent z tej samej rodziny co prowadzący i autorzy – pominięty już przy doborze.
      if (p.pominieta) { odrzucone.push({ rola: p.rola, kod: p.pominieta, powod: p.pominieta }); return; }
      const proponowany = { silnik: SILNIKI.includes(p.silnik) ? p.silnik : prowadzacy.silnik, model: p.model || '' };
      const kolejka = [...new Set([proponowany.silnik, prowadzacy.silnik, 'cloud', 'local'])];
      const powody = [];
      let wybrany = null;
      for (const s of kolejka) {
        /* „Darmowe modele” (K5): płatny silnik nie wchodzi – ani zaproponowany,
           ani prowadzącego jako zastępstwo. Rola bez darmowego miejsca odpada
           z kodem `tylko-darmowe`, zamiast po cichu kosztować. */
        if (tylkoDarmowe && platny(s)) { powody.push('tylko-darmowe'); continue; }
        // Lokalny GPU spoza propozycji i prowadzącego – tylko jako darmowy zapas po odmowie budżetu (i w wariancie darmowym).
        if (s === 'local' && s !== proponowany.silnik && s !== prowadzacy.silnik && !powody.includes('budzet') && !tylkoDarmowe) continue;
        const d = silniki.dostepDla(s, u);
        const kod = odmowaSilnika(s, d, u, { prowadzacy: prowadzacy.silnik, zgodaChmura });
        if (kod) { powody.push(kod); continue; }
        if (s === 'local' && lokalnych >= LIMITY.maxRolLokalnie) { powody.push('limit-lokalny'); continue; }
        let chce = s === proponowany.silnik && proponowany.model ? proponowany.model
          : s === prowadzacy.silnik ? prowadzacy.model : d.ep.model;
        // Rola patrząca na obraz u ślepego modelu opisałaby zdjęcie z wyobraźni – model wizyjny silnika albo następny silnik.
        if (plan_.wymagaObrazu(p.rola, katalog) && blindToImages(chce)) {
          if (d.ep.visionModel) chce = d.ep.visionModel;
          else { powody.push('brak-wzroku'); continue; }
        }
        const m = silniki.modelDozwolony(s, chce, u);
        if (!m.model) { powody.push('brak-modelu'); continue; }
        const zl = szacunek ? szacunek(p.rola, m.model, s) : 0;
        let token = null;
        if (zl > 0) {
          const rez = zarezerwuj(u, zl, d.zrodlo);
          if (!rez.ok) { powody.push('budzet'); continue; }
          token = rez.token || null;
        }
        wybrany = { silnik: s, model: m.model, zrodlo: d.zrodlo, spozaListy: m.zamiast, zl, token };
        break;
      }
      if (!wybrany) {
        const kod = powody.includes('wymaga-zgody') ? 'wymaga-zgody' : powody.includes('budzet') ? 'budzet'
          : powody.includes('tylko-darmowe') && powody.every((x) => x === 'tylko-darmowe' || x === 'niedostepny') ? 'tylko-darmowe'
            : powody[powody.length - 1] || 'uprawnienia';
        odrzucone.push({ rola: p.rola, silnik: proponowany.silnik, kod, powod: powody.join(','), ...(def.wlasna ? { wlasna: true, nazwa: def.nazwa.pl } : {}) });
        return;
      }
      if (wybrany.silnik === 'local') lokalnych++;
      Object.assign(r, { silnik: wybrany.silnik, model: wybrany.model, zrodlo: wybrany.zrodlo, dlaczego: p.dlaczego || '' });
      if (proponowany.model && (wybrany.silnik !== proponowany.silnik || wybrany.model !== proponowany.model)) {
        r.zamiast = { silnik: proponowany.silnik, model: proponowany.model };
      } else if (wybrany.silnik !== proponowany.silnik) {
        r.zamiast = { silnik: proponowany.silnik, model: '' };
      }
      if (powody.length || wybrany.spozaListy) r.powod = [...new Set([...powody, wybrany.spozaListy ? 'lista-wlasciciela' : ''])].filter(Boolean).join(',');
      if (szacunek) r.szacunekZl = wybrany.zl;
      if (wybrany.token) { if (rezerwuj) r.rezerwacja = wybrany.token; else naSucho.push(wybrany.token); }
      wynik.push(r);
    });
    // Druga fala (recenzent, własna z falą 2) nigdy sama – bez fali 1 nie ma czego sprawdzać.
    if (wynik.length && wynik.every((r) => plan_.drugaFala(r.rola, katalog))) {
      for (const r of wynik.splice(0)) {
        if (r.rezerwacja) zwolnijRez(r.rezerwacja);
        odrzucone.push({ rola: r.rola, kod: 'sam-recenzent', powod: 'recenzent nigdy sam' });
      }
    }
    for (const t of naSucho) zwolnijRez(t);
    return { role: wynik, odrzucone };
  }

  /** Model do roli: wybór osoby w składzie → ustawienia osoby → dobór po
   *  umiejętnościach (własna rola – po swoich cechach) → prowadzący.
   *  Strażnik i tak ma ostatnie słowo. */
  function propozycjaModelu(p, { pula, prowadzacy, us, glosowy, katalog = plan_.KATALOG, tylkoDarmowe = false, rodzinyNotatek = null }) {
    // Wybór osoby i przypięcie z Ustawień – w wariancie darmowym tylko, gdy nic nie kosztują.
    if (p.silnik && SILNIKI.includes(p.silnik) && !(tylkoDarmowe && platny(p.silnik))) return { silnik: p.silnik, model: p.model || '', dlaczego: 'wybór osoby' };
    const zUst = us.role[p.rola];
    if (zUst && !(tylkoDarmowe && platny(zUst.silnik))) return { silnik: zUst.silnik, model: zUst.model || '', dlaczego: 'ustawienia' };
    const { dobierzModel, profilWlasnejRoli } = require('./umiejetnosci.js');
    const def = katalog[p.rola];
    const profil = def && def.wlasna ? profilWlasnejRoli(def) : p.rola;
    const k = dobierzModel(profil, pula, { prowadzacy: { id: prowadzacy.model, silnik: prowadzacy.silnik }, glosowy, tylkoDarmowe, rodzinyNotatek,
      cena: cenaModelu });
    if (k) return { silnik: k.silnik, model: k.id, dlaczego: k.id === prowadzacy.model && k.silnik === prowadzacy.silnik ? 'ten sam model' : 'dopasowanie' };
    // Brak darmowego kandydata przy płatnym prowadzącym – chmura z domyślnym modelem (strażnik zdecyduje dalej).
    if (tylkoDarmowe && platny(prowadzacy.silnik)) return { silnik: 'cloud', model: '', dlaczego: 'darmowy' };
    return { silnik: prowadzacy.silnik, model: prowadzacy.model, dlaczego: 'ten sam model' };
  }

  /**
   * Modele ról jednego wariantu składu. W wariancie darmowym recenzent
   * dobierany na końcu: z innej rodziny niż prowadzący i autorzy notatek
   * fali 1 (ta sama rodzina ma te same ślepe plamy – agencja-rozmowa), a bez
   * takiego modelu – pominięty (`pominieta: 'rodzina'`, jedno wywołanie
   * i 20–40 s mniej zamiast udawania zespołu).
   */
  function modeleWariantu(u, plan, { pula, prowadzacy, us, glosowy, katalog, tylkoDarmowe = false }) {
    const o = { pula, prowadzacy, us, glosowy, katalog, tylkoDarmowe };
    const wybranyPrzezOsobe = (p) => (p.silnik && SILNIKI.includes(p.silnik) && !(tylkoDarmowe && platny(p.silnik)))
      || (us.role[p.rola] && !(tylkoDarmowe && platny(us.role[p.rola].silnik)));
    const recenzentDoDobrania = (p) => tylkoDarmowe && p.rola === 'recenzent' && !wybranyPrzezOsobe(p);
    const wynik = plan.map((p) => (recenzentDoDobrania(p) ? null : { ...p, ...propozycjaModelu(p, o) }));
    if (!wynik.includes(null)) return wynik;
    const modelSilnika = (s) => { const d = silniki.dostepDla(s, u); return (d && d.ep && d.ep.model) || ''; };
    const rodziny = [...new Set([rodzinaModelu(prowadzacy.model),
      ...wynik.filter(Boolean).filter((r) => !plan_.drugaFala(r.rola, katalog)).map((r) => rodzinaModelu(r.model || modelSilnika(r.silnik)))])];
    const pulaInnych = pula.filter((k) => !rodziny.includes(rodzinaModelu(k.id)));
    return wynik.map((r, i) => {
      if (r) return r;
      const p = plan[i];
      const { dobierzModel } = require('./umiejetnosci.js');
      const k = dobierzModel(p.rola, pulaInnych, { prowadzacy: { id: prowadzacy.model, silnik: prowadzacy.silnik }, glosowy, tylkoDarmowe, rodzinyNotatek: rodziny });
      return k ? { ...p, silnik: k.silnik, model: k.id, dlaczego: 'inna rodzina' } : { ...p, pominieta: 'rodzina' };
    });
  }

  // -------------------------------------------------------------------------
  // Planista
  // -------------------------------------------------------------------------

  /** Planista: krótko, bez myślenia, stałe max_tokens (nie „Maks. tokenów”
   *  osoby – urwany JSON). Zwraca tekst albo '' (porażka = heurystyka).
   *  Płatny planista liczy się do budżetu: rezerwacja przed, koszt po. */
  async function zapytajPlaniste(u, kandydat, wiadomosci, signal, { terminMs = LIMITY.terminPlanistyMs, rezerwacja = null, szacunekZl = 0 } = {}) {
    const d = silniki.dostepDla(kandydat.silnik, u);
    let koszt = 0;
    const rozliczPlaniste = () => { if (rezerwacja) { if (koszt > 0) rozlicz(rezerwacja, koszt); else zwolnijRez(rezerwacja); } };
    if (!d.ok) { rozliczPlaniste(); return { tekst: '', blad: 'uprawnienia' }; }
    if (czyZamykanie()) { rozliczPlaniste(); return { tekst: '', blad: 'aktualizacja' }; }
    const miejsce = przydzial.dla(d.ep, kandydat.silnik, kandydat.id).zajmijOdRazu(u.id, kandydat.id);
    const t0 = Date.now();
    let wyslane = false;
    try {
      const body = ustawMyslenie({
        model: kandydat.id, messages: wiadomosci, temperature: 0.2, stream: false,
        max_tokens: silniki.tokenyDozwolone(kandydat.silnik, LIMITY.maxTokenowPlanisty, u),
      }, kandydat.id, false);
      wyslane = true;
      const r = await zapytajModel(d.ep, body, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(terminMs)]),
        ponowienia: 1, ponowienia429: 0, sufit: silniki.granice(kandydat.silnik, u)?.maxTokens, lokalny: kandydat.silnik === 'local',
      });
      if (r.status === 429) przydzial.dla(d.ep, kandydat.silnik, kandydat.id).zglos429();
      if (!r.ok) { r.body?.cancel().catch(() => {}); return { tekst: '', blad: `HTTP ${r.status}` }; }
      miejsce.przyjete();
      const j = await r.json().catch(() => null);
      const u2 = j && j.usage;
      const we = Number(u2?.prompt_tokens) || 0; const wy = Number(u2?.completion_tokens) || 0;
      koszt = u2 ? kosztZl(kandydat.id, kandydat.silnik, we, wy) : szacunekZl;
      notujZuzycie(u, { silnik: kandydat.silnik, zrodlo: d.zrodlo, model: kandydat.id, we, wy, zl: koszt });
      const m = j && j.choices && j.choices[0] && j.choices[0].message;
      return { tekst: String((m && m.content) || ''), ms: Date.now() - t0, kosztZl: koszt };
    } catch (err) {
      const blad = signal.aborted ? 'przerwane' : /timeout|abort/i.test(String(err && (err.name || err.message))) ? 'termin' : 'siec';
      /* Termin albo Stop PO wysłaniu: żądanie bez strumienia dostawca zwykle
         i tak dokańcza i liczy – co najmniej szacunek (it-modele-komercyjne).
         Błąd sieci (połączenie nie doszło) – nic nie poszło, 0. */
      if (wyslane && blad !== 'siec' && szacunekZl > 0 && !(koszt > 0)) {
        koszt = szacunekZl;
        notujZuzycie(u, { silnik: kandydat.silnik, zrodlo: d.zrodlo, model: kandydat.id, zl: koszt });
      }
      return { tekst: '', blad, ...(koszt > 0 ? { kosztZl: koszt } : {}) };
    } finally { miejsce(); rozliczPlaniste(); }
  }

  /** Ile tokenów wejścia dostanie rola – zgrubnie, do szacunku kosztu
   *  PRZED startem (wyniki, notatki i plan jeszcze nie istnieją). DANE PLANU
   *  fotografa mają ~1500 tokenów (it-modele-komercyjne: 900 zaniżało). */
  function szacunekWejscia(katalog, { pytanie, poprzednie, sprzetTok }) {
    const baza = szacujTokeny(String(pytanie || '').slice(0, 6000)) + szacujTokeny(poprzednie || '') + 450;
    return (rola) => {
      const def = katalog[rola] || {};
      const k = def.kontekst || [];
      return baza + (def.wlasna ? szacujTokeny(def.instrukcja || '') : 150)
        + (k.includes('wyniki') ? 2500 : 0) + (k.includes('plan') ? 1500 : 0) + (k.includes('sprzet') ? sprzetTok : 0)
        + (k.includes('obraz') ? 1600 : 0) + (k.includes('notatki') ? 2400 : 0);
    };
  }

  /** Skład tury: od osoby, od planisty albo z heurystyki – po strażniku.
   *  Z tego samego planu (bez drugiego planisty) liczy też wariant „Darmowe
   *  modele” (K5) – gdy główny skład ma rolę na płatnym silniku.
   *  `zKandydatami` – do edytora roli: najlepsze modele na rolę z obu pul. */
  async function ulozSklad(u, { payload, prowadzacy, jawna, signal, pytanie, maObraz, maSprzet, us, zgodaChmury, rezerwuj = false, zKandydatami = false }) {
    const zz = payload.zespol && typeof payload.zespol === 'object' ? payload.zespol : {};
    const glosowy = payload.trybGlosowy === true;
    const katalog = plan_.katalogOsoby(us.wlasneRole);
    const modele = zz.modele && typeof zz.modele === 'object' ? zz.modele : {};
    const zSkladem = Array.isArray(zz.sklad) && zz.sklad.length > 0;
    /* Tryb darmowy (K5): jawne `tylkoDarmowe: true` z przeglądarki (wariant
       wybrany w bramce, „Za 0 zł”) albo ustawienie osoby „Darmowe modele”.
       Jawne `false` („Proponowany” w bramce) wygrywa z ustawieniem. Ściśle –
       strażnik nie wpuszcza płatnego silnika – gdy skład wybrano darmowy albo
       układa go serwer; przy składzie od osoby ustawienie dotyczy tylko ról na „Auto”. */
    const trybDarmowy = zz.tylkoDarmowe === true || (zz.tylkoDarmowe !== false && us.skladDomyslny === 'darmowy');
    const scisle = zz.tylkoDarmowe === true || (trybDarmowy && !zSkladem);
    const pula = pulaKandydatow(u, { prowadzacy, zgodaChmura: zgodaChmury, modele });
    /* Modele ról proponujemy tak, jakby zgoda była: czego osoba nie pozwoliła
       wysłać do chmury, strażnik i tak przeniesie lokalnie – z `zamiast`
       i powodem `wymaga-zgody`, więc wiadomo, o co zapytać (bramka zgody,
       pytanie głosem). Sam dobór modelu nic nigdzie nie wysyła; planista
       zostaje na puli ze zgodą. */
    const bezZgody = prowadzacy.silnik === 'local' && !zgodaChmury;
    const pulaPropozycji = bezZgody ? pulaKandydatow(u, { prowadzacy, zgodaChmura: true, modele }) : pula;
    let pulaD = null;
    const pulaDarmowaPropozycji = () => (pulaD || (pulaD = pulaDarmowa(u, { prowadzacy, zgodaChmura: bezZgody ? true : zgodaChmury, modele })));
    const dozwolone = plan_.widoczneRole({ maObraz, maSprzet, katalog });
    const maxRol = Math.min(us.maxRol, maxRolOsoby(u));
    const br = plan_.bramka(pytanie, { maObraz, maSprzet, tryb: 'sam', trybGlosowy: glosowy });
    let plan = null; let uwagi = []; let zrodlo = '';
    let planista = null; let kosztPlanistyZl = 0;
    if (zSkladem) {
      // Skład od osoby: tylko klucz roli, zadanie i wybór modelu – instrukcja zawsze z katalogu (własna – z ustawień osoby).
      const surowe = zz.sklad.slice(0, LIMITY.bezpiecznikRol).map((x) => ({
        rola: x && x.rola, zadanie: typeof (x && x.zadanie) === 'string' ? x.zadanie.slice(0, 1000) : '',
      }));
      const w = plan_.parsujPlan(JSON.stringify({ zespol: true, role: surowe }), { maObraz, jawna: true, maxRol, katalog, dozwolone });
      plan = w.ok ? w.plan : null; uwagi = w.uwagi; zrodlo = 'osoba';
      if (plan) {
        for (const r of plan.role) {
          const x = zz.sklad.find((s) => s && plan_.idRoli(s.rola, katalog) === r.rola) || {};
          if (SILNIKI.includes(x.silnik)) { r.silnik = x.silnik; r.model = typeof x.model === 'string' ? x.model.slice(0, 200) : ''; }
          // „Auto – najlepszy darmowy” z edytora roli (wariant darmowy zmieniony ręcznie).
          else if (x.tylkoDarmowe === true) r.tylkoDarmowe = true;
        }
        plan.szukaj = plan_.czysteZdanie(zz.szukaj || pytanie, 150);
        plan.miejsce = plan_.czysteZdanie(zz.miejsce, 80);
        plan.kiedy = typeof zz.kiedy === 'string' ? plan_.poprawnaChwila(zz.kiedy) : '';
        if (typeof zz.kiedy === 'string' && zz.kiedy.trim() && !plan.kiedy) plan.kiedyBledne = zz.kiedy.trim().slice(0, 40);
      }
    } else {
      // Tryb darmowy – planista też darmowy (inaczej „0 zł” kłamie o pierwszym wywołaniu tury).
      const pulaPlanisty = scisle ? pula.filter((k) => !platny(k.silnik)) : pula;
      planista = modelPlanisty(pulaPlanisty, prowadzacy);
      if (planista) {
        const wiad = plan_.promptPlanisty({ pytanie, maObraz, maSprzet, teraz: terazTekst(), poprzednie: plan_.skrotRozmowy(payload.messages, 300),
          jawna, maxRol, katalog, role: dozwolone });
        // Płatny planista liczy się do budżetu; odmowa – najszybszy darmowy z puli.
        let szacPl = 0; let rezPl = null;
        if (platny(planista.silnik)) {
          szacPl = szacujZl(planista.id, planista.silnik, wiad.reduce((a, m) => a + szacujTokeny(m.content), 0), LIMITY.maxTokenowPlanisty, false);
          const rez = zarezerwuj(u, szacPl, planista.zrodlo);
          if (!rez.ok) {
            uwagi.push('planista: budżet – darmowy model');
            planista = modelPlanisty(pula.filter((k) => !platny(k.silnik)), prowadzacy);
            szacPl = 0;
          } else rezPl = rez.token || null;
        }
        if (planista) {
          const terminMs = glosowy ? Math.min(LIMITY.terminPlanistyMs, LIMITY.terminPlanistyGlosMs) : LIMITY.terminPlanistyMs;
          const odp = await zapytajPlaniste(u, planista, wiad, signal, { terminMs, rezerwacja: rezPl, szacunekZl: szacPl });
          kosztPlanistyZl = odp.kosztZl || 0;
          if (odp.tekst) {
            const w = plan_.parsujPlan(odp.tekst, { maObraz, jawna, maxRol, katalog, dozwolone });
            uwagi = [...uwagi, ...w.uwagi];
            if (w.ok) { plan = w.plan; zrodlo = 'plan'; }
          } else uwagi.push(`planista: ${odp.blad || 'pusto'}`);
        } else uwagi.push('brak darmowego modelu planisty');
      } else uwagi.push(scisle ? 'brak darmowego modelu planisty' : 'brak modelu planisty');
      /* Porażka planisty przy jawnej prośbie – skład z heurystyki (zespół
         ma ruszyć). Bez prośby (tryb „sam”, „Proponuj”) porażka = bez zespołu:
         nie uruchamiamy kilku płatnych wywołań na zgadywanie. */
      if (jawna && (!plan || !plan.zespol)) {
        plan = plan_.zapasowyPlan(pytanie, br, { dozwolone, maObraz, jawna, maxRol });
        zrodlo = 'heurystyka';
      }
    }
    const pusty = { role: [], odrzucone: [], zrodlo: zrodlo || 'plan', uwagi, szukaj: '', miejsce: '', kiedy: '', planista, kosztPlanistyZl, katalog,
      tylkoDarmowe: scisle };
    if (!plan || !plan.zespol) return pusty;
    const opcjeWariantu = { prowadzacy, us, glosowy, katalog };
    const zModelami = scisle
      ? modeleWariantu(u, plan.role, { ...opcjeWariantu, pula: pulaDarmowaPropozycji(), tylkoDarmowe: true })
      : plan.role.map((p) => {
        // Rola na „Auto” przy ustawieniu „Darmowe modele” albo z „Auto – najlepszy darmowy” – z puli darmowej.
        const darmowo = p.tylkoDarmowe === true || (trybDarmowy && !p.silnik);
        const m = propozycjaModelu(p, { ...opcjeWariantu, pula: darmowo ? pulaDarmowaPropozycji() : pulaPropozycji, tylkoDarmowe: darmowo });
        return { ...p, silnik: m.silnik, model: m.model, dlaczego: m.dlaczego };
      });
    // Szacunek kosztu roli: wejście zgrubnie, wyjście = stały limit roli (ostrożnie – z górą).
    const sprzetTok = maSprzet ? szacujTokeny(blokSprzetu(U().sprzet).content) : 0;
    const weRoli = szacunekWejscia(katalog, { pytanie, poprzednie: plan_.skrotRozmowy(payload.messages, 400), sprzetTok });
    const wyRoli = (rola, model, darmowo = scisle) => limitRoli(rola, model, mysliWTurze(rola, katalog, darmowo), katalog);
    /* Rola bez myślenia (ustawMyslenie je wyłącza) – cennik nie dolicza ukrytego
       rozumowania. Claude 5 myśli zawsze (wyłączenie = 400 u Anthropic), więc
       tam myślenie liczy się i w roli „bez myślenia” (it-modele-komercyjne). */
    const myslenieRoli = (rola, model, darmowo = scisle) => (mysliWTurze(rola, katalog, darmowo) || (rodzinaClaude(model) || {}).mysliSam ? undefined : false);
    const szacunek = cennik ? (rola, model, silnik) => szacujZl(model, silnik, weRoli(rola), wyRoli(rola, model), myslenieRoli(rola, model)) : null;
    const s = rozstrzygnij(u, zModelami, { prowadzacy, zgodaChmura: zgodaChmury, maxRol, katalog, szacunek, rezerwuj, tylkoDarmowe: scisle });
    for (const r of s.role) { r.weSzac = weRoli(r.rola); r.wySzac = wyRoli(r.rola, r.model); r.myslenieSzac = myslenieRoli(r.rola, r.model); }
    let szacunekZl = 0; let szacunekProwadzacyZl = 0;
    if (cennik) {
      szacunekZl = s.role.reduce((a, r) => a + (r.szacunekZl || 0), 0);
      // Możliwa fala 3: programista poprawia kod po recenzji – jeszcze jedno wywołanie jego modelu.
      const prog = s.role.find((r) => r.rola === 'programista');
      if (prog && s.role.some((r) => r.rola === 'recenzent')) {
        const wyP = limitPoprawki(prog.wySzac, prog.wySzac * 3);
        szacunekZl += szacujZl(prog.model, prog.silnik, prog.weSzac + 2 * prog.wySzac + 300, wyP, prog.myslenieSzac);
      }
      /* C6: szacunek to CAŁA tura – planista (już policzony) + role +
         prowadzący. Prowadzący bywa najdroższy (pełna rozmowa + notatki ról),
         a stopka i bramka pokazywały ~1/3 rachunku (it-konta, it-modele-komercyjne). */
      if (s.role.length) szacunekProwadzacyZl = szacunekProwadzacego(u, prowadzacy, payload, s.role);
      szacunekZl = zaokr(szacunekZl + szacunekProwadzacyZl + (kosztPlanistyZl || 0));
    }
    /* Wariant „Darmowe modele” (K5, Z3) – synchronicznie z tego samego planu,
       tylko gdy główny skład ma płatną rolę (wybór między dwoma darmowymi nie
       ma sensu). Strażnik jak w turze, rezerwacje na sucho. Kwota = cała tura:
       przy płatnym prowadzącym jego koszt (nigdy fałszywe „0 zł”). */
    let darmowe = null;
    if (!scisle && s.role.some((r) => platny(r.silnik))) {
      const zD = modeleWariantu(u, plan.role, { ...opcjeWariantu, pula: pulaDarmowaPropozycji(), tylkoDarmowe: true });
      const sD = rozstrzygnij(u, zD, { prowadzacy, zgodaChmura: zgodaChmury, maxRol, katalog, szacunek, rezerwuj: false, tylkoDarmowe: true });
      for (const r of sD.role) { r.weSzac = weRoli(r.rola); r.wySzac = wyRoli(r.rola, r.model, true); r.myslenieSzac = myslenieRoli(r.rola, r.model, true); }
      const odcisk = (lista) => lista.map((r) => `${r.rola}|${r.silnik}|${r.model}`).join(';');
      if (sD.role.length && odcisk(sD.role) !== odcisk(s.role)) {
        const prowD = cennik && sD.role.length ? szacunekProwadzacego(u, prowadzacy, payload, sD.role) : 0;
        darmowe = { ...sD, prowadzacyPlatny: platny(prowadzacy.silnik),
          ...(cennik ? { szacunekZl: zaokr(sD.role.reduce((a, r) => a + (r.szacunekZl || 0), 0) + prowD + (kosztPlanistyZl || 0)), szacunekProwadzacyZl: prowD } : {}) };
      }
    }
    return { ...s, zrodlo, uwagi, szukaj: plan.szukaj || '', miejsce: plan.miejsce || '', kiedy: plan.kiedy || '',
      ...(plan.kiedyBledne ? { kiedyBledne: plan.kiedyBledne } : {}), planista,
      kosztPlanistyZl, ...(cennik ? { szacunekZl, szacunekProwadzacyZl } : {}), katalog, tylkoDarmowe: scisle,
      ...(darmowe ? { darmowe } : {}),
      ...(zKandydatami ? { kandydaci: kandydaciRol(plan.role, { pula: pulaPropozycji, pulaDarmowa: pulaDarmowaPropozycji(), prowadzacy, glosowy, katalog }) } : {}) };
  }

  /** Modele do edytora roli (Z6): po 4 najlepsze z puli propozycji i z puli
   *  darmowej, bez powtórzeń – edytor pokazywał po jednym modelu na silnik. */
  function kandydaciRol(role, { pula, pulaDarmowa: pulaD, prowadzacy, glosowy, katalog }) {
    const { profilWlasnejRoli } = require('./umiejetnosci.js');
    const wynik = {};
    const prow = { id: prowadzacy.model, silnik: prowadzacy.silnik };
    for (const p of role) {
      const def = katalog[p.rola];
      const profil = def && def.wlasna ? profilWlasnejRoli(def) : p.rola;
      const lista = [...rankingModeli(profil, pula, { prowadzacy: prow, glosowy, cena: cenaModelu }).slice(0, 4),
        ...rankingModeli(profil, pulaD, { prowadzacy: prow, glosowy, tylkoDarmowe: true }).slice(0, 4)];
      const bylo = new Set();
      wynik[p.rola] = lista.filter(({ k }) => { const x = `${k.silnik}|${k.id}`; if (bylo.has(x)) return false; bylo.add(x); return true; })
        .map(({ k }) => ({ silnik: k.silnik, model: k.id, darmowy: !platny(k.silnik) }));
    }
    return wynik;
  }

  /** Szacunek prowadzącego PRZED turą: rozmowa + instrukcje (~1500) + notatki
   *  ról (każda najwyżej ~2000 tokenów) na wejściu, limit odpowiedzi na wyjściu. */
  function szacunekProwadzacego(u, prowadzacy, payload, role) {
    if (!cennik || !platny(prowadzacy.silnik)) return 0;
    const rozmowa = (Array.isArray(payload.messages) ? payload.messages : []).reduce((a, m) => a + szacujTokeny(m && m.content), 0);
    const notatki = role.filter((r) => r.fala !== 3).reduce((a, r) => a + Math.min(r.wySzac || 1300, 2000) + 60, 200);
    const wy = bezpiecznie(() => silniki.tokenyDozwolone(prowadzacy.silnik, Number.isInteger(payload.max_tokens) ? payload.max_tokens : 2048, u), 2048);
    return szacujZl(prowadzacy.model, prowadzacy.silnik, rozmowa + 1500 + notatki, wy);
  }

  /** Limit tokenów poprawki kodu: cały kod jeszcze raz + zmiany (±1,6 × kod
   *  + 400), co najmniej limit fali 1, najwyżej tyle, ile zmieści wkład. */
  function limitPoprawki(wyFali1, tokenyKodu) {
    const sufit = Math.ceil(LIMITY.maxZnakowWkladu / 3) + 400;
    return Math.max(wyFali1, Math.min(Math.ceil(tokenyKodu * 1.6) + 400, sufit));
  }

  /** Czego brakuje do lepszego składu: zgody na chmurę przy lokalnym
   *  prowadzącym. Dostawcy i silniki, do których poszłyby dane ZA zgodą. */
  function zgodaDlaSkladu(s) {
    const silnikiZg = [...new Set([
      ...s.role.filter((r) => /wymaga-zgody/.test(r.powod || '') && r.zamiast).map((r) => r.zamiast.silnik),
      ...s.odrzucone.filter((o) => o.kod === 'wymaga-zgody' && o.silnik).map((o) => o.silnik),
    ].filter((x) => x && x !== 'local'))];
    if (!silnikiZg.length && !s.odrzucone.some((o) => o.kod === 'wymaga-zgody')) return null;
    return { silniki: silnikiZg, daneWyjdaDo: [...new Set(silnikiZg.map((x) => DOSTAWCA[x]).filter(Boolean))] };
  }

  /** Rola do zdarzenia `sklad` i do odpowiedzi /api/zespol/plan – bez rezerwacji i szacunków wejścia. */
  const rolaDoKlienta = (r) => ({ r: r.r, rola: r.rola, nazwa: r.nazwa, zadanie: r.zadanie, silnik: r.silnik, model: r.model, zrodlo: r.zrodlo,
    fala: r.fala, ...(r.wlasna ? { wlasna: true } : {}), ...(r.dlaczego ? { dlaczego: r.dlaczego } : {}), ...(r.zamiast ? { zamiast: r.zamiast } : {}),
    ...(r.powod ? { powod: r.powod } : {}), ...(typeof r.szacunekZl === 'number' ? { szacunekZl: r.szacunekZl } : {}) });
  const odrzuconaDoKlienta = (o) => ({ rola: o.rola, kod: o.kod, ...(o.silnik ? { silnik: o.silnik } : {}), ...(o.wlasna ? { wlasna: true, nazwa: o.nazwa } : {}) });
  /** Wariant „Darmowe modele” do klienta (K5): role jak `role`, odrzucone, kwota całej tury, czy prowadzący płatny. */
  const wariantDoKlienta = (w) => ({ role: w.role.map(rolaDoKlienta), odrzucone: w.odrzucone.map(odrzuconaDoKlienta), prowadzacyPlatny: w.prowadzacyPlatny === true,
    ...(typeof w.szacunekZl === 'number' ? { szacunekZl: w.szacunekZl, szacunekProwadzacyZl: w.szacunekProwadzacyZl || 0 } : {}) });
  /** Pola K5 wspólne dla planu i zdarzenia `sklad`: wariant darmowy, ustawienie osoby, tryb darmowy tury. */
  const polaWariantow = (s, us) => ({
    skladDomyslny: us.skladDomyslny,
    ...(s.tylkoDarmowe ? { tylkoDarmowe: true } : {}),
    ...(s.darmowe ? { darmowe: wariantDoKlienta(s.darmowe) } : {}),
    ...(s.kandydaci ? { kandydaci: s.kandydaci } : {}),
  });

  // -------------------------------------------------------------------------
  // Strumień roli
  // -------------------------------------------------------------------------

  /** Czyta strumień chat/completions. onDelta(tekst), pilnuj() – zegar ciszy.
   *  NIE rzuca: przerwanie (Stop, Pomiń, Scal, termin, cisza, zerwane gniazdo)
   *  wraca jako `przerwane` razem z liczbą znaków, które zdążyły przyjść –
   *  dostawca liczy wejście i to, co wygenerował do przerwania, więc koszt
   *  trzeba zaksięgować także wtedy (it-backend, dokładki: przerwana rola = 0 zł). */
  async function czytajStrumien(upstream, { onDelta, pilnuj }) {
    const dekoder = new TextDecoder();
    let ogon = ''; let koniec = false; let dlugosc = false; let blad = null; let usage = null; let bylaTresc = false; let mysli = false;
    let znakow = 0; let przerwane = null; let done = false;
    const zjedz = (blok) => {
      if (!blok.trim()) return;
      const u = czytajUsage(blok);
      if (u) usage = u;
      const b = rozpoznajBladStrumienia(blok);
      if (b) { blad = b; return; }
      for (const linia of blok.split('\n')) {
        if (!linia.startsWith('data:')) continue;
        const d = linia.slice(5).trim();
        if (!d) continue;
        if (d === '[DONE]') { koniec = true; done = true; continue; }
        let j;
        try { j = JSON.parse(d); } catch { continue; }
        const w = (j.choices && j.choices[0]) || {};
        if (w.finish_reason) { koniec = true; if (w.finish_reason === 'length') dlugosc = true; }
        const t = (w.delta && w.delta.content) ?? w.text ?? '';
        const r = (w.delta && (w.delta.reasoning_content ?? w.delta.reasoning)) || '';
        if (r) { mysli = true; bylaTresc = true; znakow += String(r).length; }
        if (t) { bylaTresc = true; znakow += String(t).length; onDelta(t); }
      }
    };
    try {
      for await (const chunk of upstream.body) {
        pilnuj();
        ogon = (ogon + dekoder.decode(chunk, { stream: true })).replace(/\r\n|\r(?!$)/g, '\n');
        const bloki = ogon.split('\n\n');
        ogon = bloki.pop();
        for (const b of bloki) { zjedz(b); if (blad || done) break; }
        /* K4: `[DONE]` to koniec wkładu – nie czekamy, aż dostawca zamknie
           połączenie. Pośrednik, który trzyma gniazdo otwarte, dawał roli
           termin ciszy (45 s) albo „nie zdążyła” mimo pełnej notatki
           (it-backend, runda 10). Wyjście z pętli zwalnia i anuluje strumień. */
        if (blad || done) { upstream.body?.cancel?.().catch(() => {}); break; }
      }
      if (!blad && !done && ogon.trim()) zjedz(ogon);
    } catch (err) {
      if (err instanceof BrakKontekstu) throw err;
      przerwane = err || new Error('przerwane');
    }
    return { koniec, dlugosc, blad, usage, bylaTresc, mysli, znakow, przerwane };
  }

  /** Koszt wywołania roli – do wkładu i do bieżącej rezerwacji (ostatniej). */
  function naKoszt(rola, w, zl) {
    w.kosztZl = zaokr((w.kosztZl || 0) + zl);
    const rez = rola.rez && rola.rez[rola.rez.length - 1];
    if (rez) rez.koszt = zaokr(rez.koszt + zl);
  }
  /** Rezerwacje roli: z kosztem – rozlicz, bez – zwolnij. Raz (drugie wołanie nic nie robi). */
  function rozliczRole(rola) {
    for (const rez of rola.rez || []) {
      if (rez.rozliczone) continue;
      rez.rozliczone = true;
      if (!rez.token) continue;
      if (rez.koszt > 0) rozlicz(rez.token, rez.koszt); else zwolnijRez(rez.token);
    }
  }

  /** Zapasowy model roli: prowadzący. W turze „Darmowe modele” z płatnym
   *  prowadzącym zapas NIE idzie na niego (to byłby cichy wydatek, o który
   *  osoba nie prosiła) – tylko na domyślny model chmury NVIDIA; brak – bez zapasu. */
  function zapasRoli(rola, t) {
    const p = t.prowadzacy;
    if (!p) return null;
    let cel = { silnik: p.silnik, model: p.model };
    if (t.tylkoDarmowe && platny(p.silnik)) {
      const d = silniki.dostepDla('cloud', t.u);
      if (platny('cloud') || !d.ok || !uzywalny('cloud', d.ep) || !d.ep.model) return null;
      cel = { silnik: 'cloud', model: d.ep.model };
    }
    return cel.silnik !== rola.silnik || cel.model !== rola.model ? cel : null;
  }

  /**
   * Jedna rola. NIGDY nie rzuca (poza BrakKontekstu – to błąd programu, nie
   * awaria dostawcy). Kolejka → wywołanie → ciche ponowienie → zapas na
   * modelu prowadzącego → „nie dotarło”.
   */
  async function wykonajRole(rola, t) {
    const { u, tura, emit } = t;
    const w = rola.wynik;
    const ac = new AbortController();
    rola.przerwij = (powod) => ac.abort(powod);
    const odTury = () => ac.abort(tura.signal.reason || { kod: 'stop' });
    const odFazy = () => ac.abort(t.faza.signal.reason || { kod: 'scal' });
    tura.signal.addEventListener('abort', odTury, { once: true });
    t.faza.signal.addEventListener('abort', odFazy, { once: true });
    if (tura.signal.aborted) odTury();
    if (t.faza.signal.aborted) odFazy();
    const t0 = Date.now();
    let bufor = ''; let zlewka = null;
    const splucz = () => { clearTimeout(zlewka); zlewka = null; if (bufor) { emit('rola', { r: rola.r, d: bufor }); bufor = ''; } };
    const ustawStan = (stan, dodatki = {}) => { w.stan = stan; emit('rola', { r: rola.r, stan, ...dodatki }); };
    const proby = [{ silnik: rola.silnik, model: rola.model }];
    // Fala 3 (poprawka kodu) – tylko ten sam model: nie wyszło, zostaje kod z fali 1.
    const zapas = zapasRoli(rola, t);
    if (zapas && !t.zapasZakazany && !rola.bezZapasu) proby.push({ ...zapas, zapas: true });
    let ostatniBlad = '';
    let kodBledu = '';
    try {
      /* Rezerwacja ze składu mogła się zestarzeć: recenzent rusza PO fali 1,
         która już wydała (z usage – często więcej niż szacunek), a obok może
         trwać druga tura tej osoby. Odnawiamy ją przed startem; odmowa =
         rola pominięta z kodem `budzet`, bez wywołania. */
      const pierwsza = rola.rez && rola.rez[0];
      if (budzet && pierwsza && !pierwsza.rozliczone && pierwsza.koszt === 0 && rola.szacunekZl > 0) {
        zwolnijRez(pierwsza.token);
        const nowa = zarezerwuj(u, rola.szacunekZl, rola.zrodlo);
        if (!nowa.ok) {
          pierwsza.rozliczone = true;
          w.stan = 'pominieta'; w.blad = 'Budżet w zł się skończył – rola pominięta.'; w.kod = 'budzet';
          return w;
        }
        pierwsza.token = nowa.token || null;
      }
      if (rola.dane.przedStartem) await rola.dane.przedStartem(ac.signal);
      for (let p = 0; p < proby.length; p++) {
        const proba = proby[p];
        if (proba.zapas) {
          if (w.tresc || t.faza.koniec - Date.now() < LIMITY.zapasGdyZostaloMs || ac.signal.aborted) break;
          w.zapas = { silnik: proba.silnik, model: proba.model, zamiast: { silnik: w.silnik, model: w.model } };
          w.silnik = proba.silnik; w.model = proba.model;
          ustawStan('zapas', { silnik: proba.silnik, model: proba.model, blad: ostatniBlad });
        }
        if (czyZamykanie()) { kodBledu = 'aktualizacja'; ostatniBlad = 'Serwer się aktualizuje – rola nie ruszyła.'; break; }
        // Świeże konto: odebrane przyznanie albo usunięte konto działa od tej roli.
        const konto = konta.znajdz(u.id);
        if (!konto) { kodBledu = 'uprawnienia'; ostatniBlad = 'Konto zostało usunięte.'; break; }
        const d = silniki.dostepDla(proba.silnik, konto);
        const odm = odmowaSilnika(proba.silnik, d, konto, { prowadzacy: t.prowadzacy.silnik, zgodaChmura: t.zgodaChmury });
        if (odm) { kodBledu = 'uprawnienia'; ostatniBlad = 'Brak zgody na ten silnik.'; continue; }
        /* Budżet: pierwsza próba ma rezerwację ze składu. Zapas na PŁATNYM
           modelu prowadzącego to nowy wydatek – osobna rezerwacja; odmowa =
           bez zapasu (rola kończy się dotychczasowym błędem). */
        if (proba.zapas && platny(proba.silnik)) {
          const zl = szacujZl(proba.model, proba.silnik, rola.weSzac || 1500, rola.wySzac || 1300, rola.myslenieSzac);
          if (zl > 0) {
            const rez = zarezerwuj(konto, zl, d.zrodlo);
            if (!rez.ok) { kodBledu = 'budzet'; ostatniBlad = 'Budżet nie pozwala na zapasowy model.'; break; }
            if (rez.token) (rola.rez || (rola.rez = [])).push({ token: rez.token, koszt: 0 });
          }
        }
        const kubelek = przydzial.dla(d.ep, proba.silnik, proba.model);
        const wynik = await jednaProba({ rola, t, w, d, konto, kubelek, model: proba.model, silnik: proba.silnik, ac, ustawStan,
          onDelta: (txt) => {
            if (!w.pierwszaMs) { w.pierwszaMs = Date.now() - t0; ustawStan('pisze'); }
            if (w.tresc.length < LIMITY.maxZnakowWkladu) { w.tresc += txt; bufor += txt; }
            if (!zlewka) zlewka = setTimeout(splucz, LIMITY.zlewkaMs);
          } });
        if (wynik.koniec) return w;
        ostatniBlad = wynik.blad || ostatniBlad; kodBledu = wynik.kod || kodBledu;
        if (wynik.bezZapasu) break;
      }
      splucz();
      if (tura.signal.aborted) { w.stan = 'przerwana'; w.blad = ''; kodBledu = 'zatrzymana'; }
      else if (ac.signal.aborted && (ac.signal.reason && ac.signal.reason.kod) === 'pominieta') { w.stan = 'pominieta'; w.blad = 'Pominięta.'; kodBledu = 'pominieta'; }
      else if (ac.signal.aborted && (ac.signal.reason && ac.signal.reason.kod) === 'scal') {
        w.stan = w.tresc ? 'niedokonczona' : 'przerwana'; w.blad = 'Prowadzący scalił bez niej.'; kodBledu = 'scalono';
      } else { w.stan = w.tresc ? 'niedokonczona' : 'blad'; w.blad = ostatniBlad || 'Rola nie odpowiedziała.'; }
      w.kod = kodBledu || w.kod || 'inny';
      return w;
    } catch (err) {
      if (err instanceof BrakKontekstu) throw err;
      w.stan = w.tresc ? 'niedokonczona' : 'blad';
      w.blad = `Rola nie odpowiedziała (${String(err && err.message || err).slice(0, 80)}).`;
      w.kod = 'inny';
      return w;
    } finally {
      splucz();
      tura.signal.removeEventListener('abort', odTury);
      t.faza.signal.removeEventListener('abort', odFazy);
      w.ms = Date.now() - t0;
      rozliczRole(rola);
      emit('rola', { r: rola.r, stan: w.stan, ms: w.ms, znakow: w.tresc.length,
        ...(w.blad ? { blad: w.blad, kod: w.kod } : {}), ...(w.urwane ? { urwane: true } : {}),
        ...(w.zapas ? { zapas: { silnik: w.zapas.silnik, model: w.zapas.model } } : {}),
        ...(cennik ? { kosztZl: zaokr(w.kosztZl || 0) } : {}), ...(w.kosztSzacowany ? { kosztSzacowany: true } : {}) });
      log({ t: 'rola', osoba: u.id, bieg: t.biegId, rola: rola.wlasna ? 'wlasna' : rola.rola, silnik: w.silnik, model: w.model, stan: w.stan, ms: w.ms,
        pierwszaMs: w.pierwszaMs || 0, kolejkaMs: w.kolejkaMs || 0, we: w.we || 0, wy: w.wy || 0, ...(w.kod ? { kod: w.kod } : {}),
        ...(w.kosztZl ? { zl: zaokr(w.kosztZl) } : {}) });
    }
  }

  /** Jedno podejście roli do jednego modelu (z kolejką, zegarami, 429 i cichym ponowieniem).
   *  Zwraca { koniec: true } gdy rola skończona (stan ustawiony), inaczej { blad, kod, bezZapasu }. */
  async function jednaProba({ rola, t, w, d, konto, kubelek, model, silnik, ac, ustawStan, onDelta }) {
    const { u } = t;
    let ponownieWKolejce = false;
    for (let cicheP = 0; cicheP < 2; cicheP++) {
      const tk = Date.now();
      if (kubelek.pelny() || kubelek.czekajacych()) ustawStan('czeka', { kolejka: kubelek.czekajacych() + 1 });
      let zwolnij;
      try {
        zwolnij = await kubelek.zajmij(u.id, ac.signal, model);
      } catch { return { blad: '', kod: '', bezZapasu: true }; }
      w.kolejkaMs = (w.kolejkaMs || 0) + (Date.now() - tk);
      // Po kolejce kontekst MUSI być nadal tej osoby (it-konta: pętla-pracownik go gubiła).
      if ((kto() || {}).id !== u.id) { zwolnij(); throw new BrakKontekstu(`rola ${rola.r} po kolejce`); }
      if (czyZamykanie()) { zwolnij(); return { blad: 'Serwer się aktualizuje – rola nie ruszyła.', kod: 'aktualizacja', bezZapasu: true }; }
      // Zegary ruszają PO wyjściu z kolejki – czekanie to nie cisza modelu.
      const termin = Math.max(1000, Math.min(LIMITY.terminRoliMs, t.faza.koniec - Date.now()));
      const zegarAc = new AbortController();
      let cisza = false; let terminMinal = false;
      const zegarT = setTimeout(() => { terminMinal = true; zegarAc.abort({ kod: 'termin' }); }, termin);
      let zegarC = null;
      const pilnuj = () => { clearTimeout(zegarC); zegarC = setTimeout(() => { cisza = true; zegarAc.abort({ kod: 'cisza' }); }, LIMITY.ciszaRoliMs); };
      pilnuj();
      ustawStan('pracuje', { silnik, model });
      try {
        const katalog = t.katalog || plan_.KATALOG;
        const def = katalog[rola.rola] || plan_.KATALOG.analityk;
        // Wariant darmowy: myśli tylko analityk (mysliWTurze).
        const mysli = mysliWTurze(rola.rola, katalog, t.tylkoDarmowe === true);
        let body = {
          model, messages: rola.wiadomosci(model), temperature: def.temperatura, stream: true,
          stream_options: { include_usage: true },
          // Poprawka kodu ma limit z długości kodu (poprawkaKodu) – cały kod jeszcze raz nie mieścił się w limicie fali 1.
          max_tokens: silniki.tokenyDozwolone(silnik, rola.maxTokenow || limitRoli(rola.rola, model, mysli, katalog), konto),
        };
        // Role domyślnie nie myślą (szybciej, taniej); analityk, programista i recenzent – jak model chce.
        if (!mysli) body = ustawMyslenie(body, model, false);
        if (blindToImages(model)) body.messages = bezObrazow(body.messages);
        const r = await zapytajModel(d.ep, body, {
          signal: AbortSignal.any([ac.signal, zegarAc.signal]), ponowienia: 1, ponowienia429: 0,
          sufit: silniki.granice(silnik, konto)?.maxTokens, lokalny: silnik === 'local',
        });
        if (r.status === 429) {
          kubelek.zglos429();
          r.body?.cancel().catch(() => {});
          zwolnij();
          if (!ponownieWKolejce) {
            // Limit dostawcy: rola RAZ z powrotem do kolejki (zegary stoją), potem zapas.
            ponownieWKolejce = true; cicheP--;
            continue;
          }
          return { blad: 'Limit zapytań u dostawcy.', kod: 'limit-dostawcy' };
        }
        if (!r.ok) {
          const tresc = await r.text().catch(() => '');
          zwolnij();
          return { blad: `Dostawca odmówił (HTTP ${r.status}).`, kod: 'niedostepny', tresc: tresc.slice(0, 120) };
        }
        zwolnij.przyjete();
        const wynik = await czytajStrumien(r, { onDelta, pilnuj });
        zwolnij();
        if (wynik.usage) {
          w.we = wynik.usage.we; w.wy = wynik.usage.wy;
        }
        /* Koszt wywołania – po 200 OK ZAWSZE, także gdy strumień przerwano
           (Stop, Pomiń, Scal, termin, cisza, zerwanie): dostawca liczy wejście
           i to, co wygenerował do przerwania (w modelach myślących – głównie
           ukryte rozumowanie). Z `usage`, a bez niego szacunek: wejście roli
           + ~3 znaki na token tego, co przyszło + myślenie modelu (z flagą).
           Wyjątek: dostawca sam zgłosił błąd, zanim cokolwiek napisał
           (przeciążenie) – takiej odpowiedzi nie liczy. */
        let zl = 0;
        if (wynik.usage) zl = kosztZl(model, silnik, wynik.usage.we || 0, wynik.usage.wy || 0);
        else if (!(wynik.blad && !wynik.bylaTresc)) {
          zl = szacujZl(model, silnik, rola.weSzac || 1500, Math.ceil((wynik.znakow || 0) / 3), rola.myslenieSzac);
          if (zl > 0) w.kosztSzacowany = true;
        }
        if (zl > 0) naKoszt(rola, w, zl);
        notujZuzycie(u, { silnik, zrodlo: d.zrodlo, model, we: (wynik.usage && wynik.usage.we) || 0, wy: (wynik.usage && wynik.usage.wy) || 0, zl });
        // Przerwanie obsługuje `catch` niżej (termin, cisza, Stop, zerwane gniazdo) – koszt już zaksięgowany.
        if (wynik.przerwane) throw wynik.przerwane;
        // Błąd dostawcy przed pierwszym słowem – jedno ciche ponowienie (jak pompujDoBiegu).
        if (wynik.blad && !wynik.bylaTresc && cicheP === 0 && !ac.signal.aborted) {
          await new Promise((ok) => setTimeout(ok, 700));
          continue;
        }
        if (wynik.blad) {
          if (w.tresc) { ustawStan('niedokonczona'); w.blad = 'Dostawca przerwał wkład w trakcie.'; w.kod = 'niedostepny'; w.urwane = true; return { koniec: true }; }
          return { blad: 'Dostawca przerwał, zanim coś napisał.', kod: 'niedostepny' };
        }
        const czysta = rozdzielMyslenie(w.tresc).tresc.trim();
        /* Budżet zjedzony przez myślenie: `length` i żadnej treści poza
           rozważaniami – to nie jest wkład (it-modele-open, formaty). */
        if (wynik.dlugosc && !czysta) {
          w.tresc = '';
          return { blad: 'Model zużył budżet na myślenie i nie napisał wkładu.', kod: 'inny', bezZapasu: false };
        }
        /* Limit tokenów w połowie wkładu: blok pokazuje „urwane”. Poprawka kodu
           (fala 3) urwana na limicie to niedomknięty kod – do prowadzącego
           idzie wtedy pełny kod z fali 1 (it-modele-komercyjne, dokładki). */
        if (wynik.dlugosc) {
          w.urwane = true;
          if (rola.fala === 3) {
            w.stan = 'urwana'; w.blad = 'Poprawka nie zmieściła się w limicie tokenów – zostaje kod z fali 1.'; w.kod = 'inny';
            return { koniec: true };
          }
        }
        if (!wynik.koniec) { w.urwane = true; w.stan = 'urwana'; w.blad = 'Model urwał wkład w połowie.'; w.kod = 'inny'; return { koniec: true }; }
        w.stan = 'gotowa';
        return { koniec: true };
      } catch (err) {
        zwolnij();
        if (err instanceof BrakKontekstu) throw err;
        if (terminMinal || cisza) {
          w.stan = w.tresc ? 'niedokonczona' : 'blad';
          w.blad = terminMinal ? `Rola nie zdążyła w ${Math.round(termin / 1000)} s.` : `Model roli zamilkł na ${Math.round(LIMITY.ciszaRoliMs / 1000)} s.`;
          w.kod = terminMinal ? 'termin' : 'czas';
          if (w.tresc) w.urwane = true;
          return { koniec: true };            // bez zapasu: czas już zużyty
        }
        if (ac.signal.aborted) return { blad: '', kod: '', bezZapasu: true };
        // Zerwane gniazdo przed treścią – jedno ciche ponowienie.
        if (!w.tresc && cicheP === 0) { await new Promise((ok) => setTimeout(ok, 700)); continue; }
        if (w.tresc) { w.stan = 'niedokonczona'; w.urwane = true; w.blad = 'Połączenie zerwało się w trakcie wkładu.'; w.kod = 'niedostepny'; return { koniec: true }; }
        return { blad: 'Połączenie z dostawcą nie doszło.', kod: 'niedostepny' };
      } finally { clearTimeout(zegarT); clearTimeout(zegarC); }
    }
    return { blad: 'Dostawca przerwał, zanim coś napisał.', kod: 'niedostepny' };
  }

  // -------------------------------------------------------------------------
  // Zapis i notatki
  // -------------------------------------------------------------------------

  const domknij = (w) => (KONCOWE.has(w.stan) ? w.stan : w.tresc ? 'niedokonczona' : 'przerwana');

  /** Notatki dla prowadzącego z bieżących wkładów, w budżecie znaków na rolę.
   *  Programista z udaną poprawką (fala 3) – do prowadzącego idzie wersja
   *  poprawiona; nieudana poprawka nic nie psuje (zostaje kod z fali 1).
   *  Fotograf bez notatki, ale z policzonym planem – prowadzący dostaje plan. */
  function tekstNotatek(stanT, { naRole = 6000 } = {}) {
    const katalog = stanT.katalog || plan_.KATALOG;
    const wklady = []; const niedostepne = [];
    let poprawionoKod = false;
    let planWNotatkach = false;
    for (const rola of stanT.role) {
      if (rola.fala === 3) continue;
      let w = rola.wynik; let nazwa = rola.nazwa;
      if (rola.rola === 'programista') {
        const pop = stanT.role.find((x) => x.fala === 3 && x.poprawkaZ === rola.r && x.wynik.stan === 'gotowa' && x.wynik.tresc);
        /* Poprawka zastępuje kod z fali 1 tylko PEŁNA (domknięty blok, bez
           „reszta bez zmian”, ≥ 60% długości) i tylko gdy zmieści się
           w notatce – przycięta w połowie byłaby gorsza niż pełny kod z fali 1. */
        const czysta = (x) => rozdzielMyslenie(String(x || '')).tresc.trim();
        const miesciSie = pop && (czysta(pop.wynik.tresc).length <= naRole || czysta(rola.wynik.tresc).length > naRole);
        if (pop && miesciSie && plan_.pelnaPoprawka(czysta(rola.wynik.tresc), czysta(pop.wynik.tresc))) {
          w = pop.wynik; nazwa = `${rola.nazwa} (kod poprawiony po recenzji)`; poprawionoKod = true;
        }
      }
      const stanW = domknij(w);
      const notatka = w.tresc ? plan_.oczyscNotatke(w.tresc, naRole) : '';
      if (plan_.drugaFala(rola.rola, katalog) && notatka && plan_.bezUwag(notatka)) continue;
      if (notatka) {
        wklady.push({ nazwa, model: w.model, tekst: notatka, niedokonczona: stanW !== 'gotowa' });
        if (rola.rola === 'fotograf' && stanT.plan && stanT.plan.ok) planWNotatkach = true;
      } else if (rola.rola === 'fotograf' && stanT.plan && stanT.plan.ok && stanT.plan.tekst) {
        // Liczby policzył Cosmos – nie przepadają razem z notatką fotografa.
        wklady.push({ nazwa: 'Plan zdjęciowy (policzony przez Cosmosa)', model: 'Cosmos',
          tekst: plan_.oczyscNotatke(stanT.plan.tekst, Math.min(naRole, 4000)), niedokonczona: false });
        planWNotatkach = true;
        niedostepne.push({ nazwa: rola.nazwa, powod: w.blad || (stanW === 'przerwana' ? 'przerwana' : 'brak wkładu') });
      } else niedostepne.push({ nazwa: rola.nazwa, powod: w.blad || (stanW === 'przerwana' ? 'przerwana' : 'brak wkładu') });
    }
    return blokWkladowZespolu({ wklady, niedostepne, trybGlosowy: stanT.glosowy, kod: stanT.role.some((r) => r.rola === 'programista' && r.wynik.tresc),
      szukano: stanT.szukano || '', planWNotatkach, poprawionoKod });
  }

  /** Koszt tury zespołu: role + planista (bez prowadzącego – to zwykła odpowiedź). */
  const kosztTury = (stanT) => zaokr(stanT.role.reduce((a, r) => a + (r.wynik.kosztZl || 0), 0) + (stanT.kosztPlanistyZl || 0));

  /** Wiadomość notatek do pliku rozmowy – jak wynik narzędzia. Stany DOMKNIĘTE
   *  synchronicznie (restart). null, gdy żadna rola nie ruszyła. */
  function wiadomoscNotatek(stanT, biegId) {
    if (!stanT.role.length) return null;
    const content = stanT.notatki || tekstNotatek(stanT);
    return {
      role: 'user', search: true, narzedzie: 'zespol',
      searchQuery: `praca zespołu: ${stanT.role.filter((r) => r.fala !== 3).map((r) => r.nazwa).join(', ')}`,
      content,
      zespol: {
        v: 1, zrodlo: stanT.zrodlo, prowadzacy: stanT.prowadzacy,
        wklady: stanT.role.map((rola) => {
          const w = rola.wynik;
          return {
            r: rola.r, rola: rola.rola, nazwa: rola.nazwa, silnik: w.silnik, model: w.model, zrodlo: rola.zrodlo,
            fala: rola.fala || 1, ...(rola.poprawkaZ ? { poprawkaZ: rola.poprawkaZ } : {}), ...(rola.wlasna ? { wlasna: true } : {}),
            stan: domknij(w),
            tresc: stripSearchMarker(rozdzielMyslenie(String(w.tresc || '')).tresc).slice(0, LIMITY.maxZnakowWkladu),
            ms: w.ms || (Date.now() - stanT.start),
            ...(w.blad || !KONCOWE.has(w.stan) ? { blad: w.blad || 'przerwane' } : {}),
            ...(w.urwane ? { urwane: true } : {}),
            ...(rola.zamiast ? { zamiast: rola.zamiast } : {}),
            ...(w.zapas ? { zapas: { silnik: w.zapas.silnik, model: w.zapas.model } } : {}),
            ...(cennik ? { kosztZl: zaokr(w.kosztZl || 0) } : {}),
          };
        }),
        czas: { role: stanT.czasRol || (Date.now() - stanT.start), calosc: Date.now() - stanT.start },
        daneWyjdaDo: stanT.daneWyjdaDo,
        ...(stanT.tylkoDarmowe ? { tylkoDarmowe: true } : {}),
        ...(stanT.plan ? { plan: { ok: stanT.plan.ok, miejsce: stanT.plan.miejsce || '', kiedy: stanT.plan.kiedy || '' } } : {}),
        ...(cennik ? { kosztZl: kosztTury(stanT) } : {}),
      },
      bieg: `${biegId}:zespol`,
    };
  }

  // -------------------------------------------------------------------------
  // Decyzja: zespół, propozycja czy zwykła odpowiedź
  // -------------------------------------------------------------------------

  /** Tura ma już notatki („Regeneruj” pod odpowiedzią zespołu) – zespół nie rusza drugi raz. */
  const maNotatki = (wiadomosci) => {
    const ost = [...(wiadomosci || [])].reverse().find((m) => m && m.role === 'user');
    const t = ost ? (typeof ost.content === 'string' ? ost.content : (ost.content || []).map((p) => (p && p.text) || '').join(' ')) : '';
    return t.trimStart().startsWith(NAGLOWEK_NOTATEK);
  };

  /** 'zespol' | 'propozycja' | '' – synchronicznie, przed czymkolwiek. */
  function rozpoznaj(payload) {
    const zz = payload && payload.zespol;
    if (!zz || typeof zz !== 'object' || process.env.COSMOS_ZESPOL === '0') return '';
    if (maNotatki(payload.messages)) return '';
    if ((Array.isArray(zz.sklad) && zz.sklad.length) || zz.uruchom === true) return 'zespol';
    if (zz.auto !== true) return '';
    const us = ustawienia();
    const br = plan_.bramka(tekstPytania(payload.messages), {
      maObraz: ostatniaMaObraz(payload.messages), maSprzet: Boolean(blokSprzetu(U().sprzet)),
      tryb: us.tryb, trybGlosowy: payload.trybGlosowy === true,
    });
    if (br.decyzja === 'jawna') return 'zespol';
    if (br.decyzja === 'planista') return us.tryb === 'sam' ? 'zespol' : us.tryb === 'proponuj' ? 'propozycja' : '';
    return '';
  }

  // -------------------------------------------------------------------------
  // Tura
  // -------------------------------------------------------------------------

  /** Tura zespołu w biegu. Zwraca po założeniu biegu – praca biegnie dalej. */
  async function tura({ res, payload, ep, biegId, wazny }) {
    const u0 = ktoWymagany('zespół');
    const u = konta.znajdz(u0.id) || u0;
    const wl = u.rola === 'wlasciciel';
    const trwa = AKTYWNE.get(u.id) || 0;
    if (trwa >= (wl ? LIMITY.naraz.wlasciciel : LIMITY.naraz.czlonek)) {
      return sendJson(res, 409, { kod: 'zespol-zajety',
        error: 'Zespół już pracuje nad innym pytaniem – poczekaj, aż skończy, albo zatrzymaj go.' });
    }
    const silnik = nazwaSilnika(payload.endpoint);
    /* Z5: z obrazem w pytaniu prowadzący zostaje na modelu TEKSTOWYM (planista,
       dobór ról, strażnik); obraz ogląda rola „oko”, a jej opis idzie do
       prowadzącego. Dawniej model wizyjny przejmował całą turę (12B VL pisał
       odpowiedź po polsku), a lokalny prowadzący bez LOCAL_VISION_MODEL
       dostawał 400, choć oko mogło pójść na chmurę za zgodą (it-modele-open). */
    const wybor = czat.wybierzModel(payload, ep, false);
    if (wybor.blad) return sendJson(res, ...wybor.blad);
    const prowadzacy = { silnik, model: wybor.model };
    const glosowy = payload.trybGlosowy === true;
    const us = ustawienia(u);
    const zz = payload.zespol || {};
    const zgodaChmury = (zz.zgoda && zz.zgoda.chmura === true) || us.zgodaChmura;
    const pytanie = tekstPytania(payload.messages);
    const maObraz = ostatniaMaObraz(payload.messages);
    const maSprzet = Boolean(blokSprzetu(U().sprzet));
    /* Jawna prośba (przycisk, skład od osoby, „zrób to zespołem”) – planista
       musi dać co najmniej dwie role. Tryb „sam” bez prośby – planista może
       uznać, że zespół niepotrzebny, i wtedy odpowiada sam prowadzący. */
    const jawna = zz.uruchom === true || (Array.isArray(zz.sklad) && zz.sklad.length > 0)
      || plan_.bramka(pytanie, { tryb: 'prosba' }).decyzja === 'jawna';
    /* Płatny prowadzący przy wyczerpanym budżecie – ta sama odmowa co zwykły
       czat (429 budzet-wyczerpany, przeglądarka proponuje darmową Chmurę),
       zanim cokolwiek ruszy. Próbna rezerwacja grosza, od razu zwolniona:
       budżet sam wie, który limit dotyczy klucza (właściciela czy własnego). */
    if (budzet && platny(silnik) && typeof budzet.wyczerpany === 'function') {
      const w = bezpiecznie(() => budzet.wyczerpany(u, { naKluczuWlasciciela: naKluczuWlasciciela(silniki.dostepDla(silnik, u).zrodlo) }), null);
      if (w) {
        const okres = w.okres === 'dzien' ? 'dzienny' : 'miesięczny';
        const blad = w.limit === 'wlasciciel'
          ? `Wyczerpany ${okres} budżet na płatne modele, który ustawił właściciel. Wyślij przez Chmurę (bez opłat) albo poproś właściciela o większy limit.`
          : `Wyczerpany Twój ${okres} budżet na płatne modele (Ustawienia → Agenci). Wyślij przez Chmurę (bez opłat) albo zmień limit.`;
        return sendJson(res, 429, { kod: 'budzet-wyczerpany', error: blad, blad, zostalo: 0, okres: w.okres, limit: w.limit });
      }
    }
    const turaAc = new AbortController();
    const fazaAc = new AbortController();
    const start = Date.now();
    const stanT = {
      start, faza: 'planowanie', zrodlo: '', prowadzacy, role: [], notatki: '', daneWyjdaDo: [], glosowy, szukano: '', czasRol: 0,
      katalog: plan_.katalogOsoby(us.wlasneRole), plan: null, kosztPlanistyZl: 0,
    };
    const bieg = biegi.zacznij({
      id: biegId, rozmowaId: typeof payload.rozmowa === 'string' ? payload.rozmowa : '', model: wybor.model, silnik,
      podmienionyZ: wybor.swappedFrom, spozaListy: wybor.modelSpozaListy,
      zespol: {
        get faza() { return stanT.faza; }, get role() { return stanT.role; },
        doZapisu: () => wiadomoscNotatek(stanT, biegId),
        pomin: (r) => { const x = stanT.role.find((y) => y.r === r); if (!x || !x.przerwij || KONCOWE.has(x.wynik.stan)) return false; x.przerwij({ kod: 'pominieta' }); return true; },
        scal: () => { if (stanT.faza !== 'role' || fazaAc.signal.aborted) return false; fazaAc.abort({ kod: 'scal' }); return true; },
        zwolnij: () => { for (const r of stanT.role) r.wynik.tresc = ''; stanT.notatki = ''; },
      },
    });
    bieg.przerwij = () => turaAc.abort({ kod: 'stop' });
    biegi.podepnij(biegId, 0, res, { wazny });
    AKTYWNE.set(u.id, trwa + 1);
    const emit = (typ, dane) => { if (!bieg.koniec) biegi.dopiszZdarzenie(bieg, typ, dane); };
    praca({ bieg, u, payload, ep, prowadzacy, glosowy, us, zgodaChmury, pytanie, maObraz, maSprzet, turaAc, fazaAc, stanT, emit, wybor, biegId, jawna })
      .catch((err) => {
        console.error('Zespół:', err && err.message);
        biegi.zakoncz(bieg, err instanceof BrakKontekstu ? 'Zespół przerwany: błąd kontekstu osoby.' : `Zespół przerwany: ${String(err && err.message).slice(0, 120)}`);
      })
      .finally(() => {
        const n = (AKTYWNE.get(u.id) || 1) - 1;
        if (n) AKTYWNE.set(u.id, n); else AKTYWNE.delete(u.id);
      });
    return undefined;
  }

  /** Czy zespół w ogóle rusza: limit dobowy członka, wyczerpany budżet.
   *  { kod: '' } – rusza; inaczej kod i zdanie dla człowieka. */
  function odmowaTury(u, { prowadzacy, zgodaChmury }) {
    if (u.rola !== 'wlasciciel' && ileDzis(u.id) >= LIMITY.naDobe) {
      return { kod: 'limit-dobowy', powod: `Na dziś wykorzystano limit pracy zespołem (${LIMITY.naDobe}). Odpowie sam prowadzący.` };
    }
    /* Wyczerpany budżet: zespół rusza tylko na darmowych silnikach (Chmura
       wspólna, lokalny GPU) – płatne role przeniesie strażnik. Nie ma
       darmowych – nie ma zespołu. */
    if (budzetWyczerpany(u) && !pulaKandydatow(u, { prowadzacy, zgodaChmura: zgodaChmury }).some((x) => !platny(x.silnik))) {
      return { kod: 'budzet-wyczerpany', powod: 'Budżet na płatne modele jest wyczerpany. Odpowie sam prowadzący.' };
    }
    return { kod: '', powod: '' };
  }

  /* Rezerwacje budżetu ról (ze składu i z fali 3) rozliczamy w roli; to,
     co zostało (rola nie ruszyła: Stop, scalenie, recenzent bez notatek),
     zwalnia `finally` – niezależnie od tego, jak tura się skończyła. */
  async function praca(k) {
    k.doRozliczenia = [];
    try { return await przebieg(k); } finally { for (const r of k.doRozliczenia) rozliczRole(r); }
  }

  /* Tryb planu: zdjęcie, chyba że pytanie mówi o filmie. Domyślne „wideo”
     z lib/ekspozycja.js dawało fotografowi 1/50 s z reguły 180° i listę ujęć
     filmowych na pytanie o zdjęcia złotej godziny (agencja-rozmowa). */
  const O_FILMIE = /(?<!\p{L})(wideo\p{L}*|video\p{L}*|film\p{L}*|kręc\p{L}*|krec\p{L}*|nakręc\p{L}*|nakrec\p{L}*|nagra\p{L}*|footage|timelaps\p{L}*|vlog\p{L}*)/iu;
  const trybPlanu = (pytanie) => (O_FILMIE.test(String(pytanie || '')) ? 'wideo' : 'zdjecie');
  /* Pora dnia z pytania – gdy planista dał samą datę, plan liczymy na tę
     chwilę światła, nie na południe (nastawy są dla JEDNEJ chwili). */
  const PORA = [
    { re: /(?<!\p{L})(niebiesk\p{L}* godzin\p{L}*|blue hour)/iu, pole: (s, rano) => (rano ? null : s.niebieskaWieczor && s.niebieskaWieczor.od) },
    { re: /(?<!\p{L})(złot\p{L}* godzin\p{L}*|zlot\p{L}* godzin\p{L}*|golden hour|wsch[oó]d\p{L}*|zach[oó]d\p{L}*|świt\p{L}*|świc\p{L}*|sunrise|sunset|zmierzch\p{L}*)/iu,
      pole: (s, rano) => (rano ? s.zlotaRano && s.zlotaRano.od : s.zlotaWieczor && s.zlotaWieczor.od) },
  ];
  const RANO = /(?<!\p{L})(ran\p{L}*|wsch[oó]d\p{L}*|świt\p{L}*|świc\p{L}*|sunrise|morning)/iu;
  /** Powód braku planu – krótko, DLA ROLI (fotograf nie wykona „spróbuj jeszcze raz”). */
  function powodDlaRoli(w) {
    const p = w && w.powod;
    if (p === 'brak-lokalizacji') return 'użytkownik nie podał miejsca i nie ma zapisanej lokalizacji';
    if (p === 'miejsce-nieznane') return `nie znaleziono miejsca „${plan_.czysteZdanie(w.miejsceNieznane || '', 60)}”`;
    if (p === 'zla-data') return 'nieczytelna data';
    if (typeof p === 'string' && p && !/[A-ZĄĆĘŁŃÓŚŹŻ]{4}/.test(p)) return plan_.czysteZdanie(p, 120);
    return 'planu nie udało się policzyć';
  }

  /** Plan zdjęciowy dla fotografa – policzony przez Cosmosa w imieniu osoby,
   *  ≤ 15 s (w głosie ~6 s). Tryb z pytania, chwila światła z pory dnia. */
  async function policzPlanTury({ miejsce = '', kiedy = '', kiedyBledne = '', pytanie = '', glosowy = false } = {}, signal) {
    if (!policzPlan) return { ok: false, powod: 'plan zdjęciowy jest na tym serwerze niedostępny' };
    // Zła data od planisty – brak planu, nie plan po cichu na teraz albo na przeliczoną datę.
    if (kiedyBledne) return { ok: false, powod: `nieczytelna data „${plan_.czysteZdanie(kiedyBledne, 40)}”` };
    const terminMs = glosowy ? Math.min(LIMITY.terminPlanuMs, LIMITY.terminPlanuGlosMs) : LIMITY.terminPlanuMs;
    const sg = AbortSignal.any([signal, AbortSignal.timeout(terminMs)]);
    const tryb = trybPlanu(pytanie);
    const licz = (k) => Promise.race([
      Promise.resolve().then(() => policzPlan({ ...(miejsce ? { miejsce } : {}), ...(k ? { kiedy: k } : {}), tryb }, { signal: sg })),
      new Promise((ok) => {
        const koniec = () => ok({ ok: false, powod: `plan nie zdążył w ${Math.round(terminMs / 1000)} s` });
        if (sg.aborted) koniec(); else sg.addEventListener('abort', koniec, { once: true });
      }),
    ]);
    try {
      let w = await licz(kiedy);
      // Sama data + pytanie o porę światła: drugie liczenie na początek tej pory (geokoder i pogoda z pamięci).
      if (w && w.ok === true && w.dane && w.dane.slonce && (!kiedy || /^\d{4}-\d{2}-\d{2}$/.test(kiedy))) {
        const pora = PORA.find((x) => x.re.test(pytanie));
        const chwila = pora && pora.pole(w.dane.slonce, RANO.test(pytanie));
        if (chwila) {
          // Minuta po progu: na samym progu faza Słońca wypada jeszcze poprzednia („miękkie światło”).
          const w2 = await licz(new Date(Date.parse(chwila) + 60_000).toISOString());
          if (w2 && w2.ok === true) w = w2;
        }
      }
      // Rola dostaje plan odchudzony (godziny czasu miejsca, bez pól UTC); starszy policzPlan – pełny.
      const tekst = w && w.ok === true ? (typeof w.tekstDlaRoli === 'string' && w.tekstDlaRoli.trim() ? w.tekstDlaRoli : w.tekst) : '';
      if (typeof tekst === 'string' && tekst.trim()) return { ok: true, tekst: tekst.slice(0, 6000), tryb };
      return { ok: false, powod: powodDlaRoli(w) };
    } catch (err) {
      if (err instanceof BrakKontekstu) throw err;
      return { ok: false, powod: 'planu nie udało się policzyć' };
    }
  }

  /**
   * Fala 3 – poprawka kodu po recenzji. Warunki: w składzie programista
   * i recenzent, programista oddał kod, recenzent napisał uwagi (nie „BEZ
   * UWAG”), do końca fazy ról zostało ≥ minNaPoprawkeMs. Ten sam model co
   * programista, JEDNA runda, bez zapasu. Nowa rola `<r>p` ogłasza się
   * pierwszym zdarzeniem `rola` (rola, fala: 3, poprawkaZ, silnik, model).
   */
  async function poprawkaKodu(k, t) {
    const { stanT, turaAc, fazaAc, u, biegId } = k;
    const prog = stanT.role.find((r) => r.rola === 'programista' && r.fala === 1);
    const rec = stanT.role.find((r) => r.rola === 'recenzent');
    if (!prog || !rec || !prog.wynik.tresc || !rec.wynik.tresc) return;
    // Osoba pominęła programistę albo recenzenta – nie poprawiamy za nią.
    if (['pominieta', 'przerwana'].includes(prog.wynik.stan) || ['pominieta', 'przerwana'].includes(rec.wynik.stan)) return;
    const uwagi = plan_.oczyscNotatke(rec.wynik.tresc, 3000);
    if (!uwagi || plan_.bezUwag(uwagi)) return;
    if (turaAc.signal.aborted || fazaAc.signal.aborted || czyZamykanie()) return;
    const zostalo = t.faza.koniec - Date.now();
    if (zostalo < LIMITY.minNaPoprawkeMs) { log({ t: 'poprawka', osoba: u.id, bieg: biegId, kod: 'brak-czasu', zostaloMs: zostalo }); return; }
    /* Programista sam nie zdążył (termin) albo pisał dłużej, niż zostało fazy –
       płatna poprawka i tak zostałaby ucięta scaleniem i poszła do kosza
       (it-backend, dokładki). Czas w kolejce się nie liczy. */
    const czasProg = Math.max(0, (prog.wynik.ms || 0) - (prog.wynik.kolejkaMs || 0));
    if (prog.wynik.kod === 'termin' || czasProg > zostalo) {
      log({ t: 'poprawka', osoba: u.id, bieg: biegId, kod: 'brak-czasu', zostaloMs: zostalo, programistaMs: czasProg });
      return;
    }
    const konto = konta.znajdz(u.id);
    if (!konto) return;
    const { silnik, model } = prog.wynik;
    const d = silniki.dostepDla(silnik, konto);
    if (!d.ok) return;
    const wy1 = prog.wySzac || limitRoli('programista', model, mysliWTurze('programista', t.katalog || plan_.KATALOG, t.tylkoDarmowe === true));
    // Cały kod jeszcze raz: limit z długości kodu z fali 1, nie ten sam co fala 1 (poprawka urywała się na `length`).
    const wy = limitPoprawki(wy1, szacujTokeny(rozdzielMyslenie(String(prog.wynik.tresc || '')).tresc));
    const we = (prog.weSzac || 1500) + szacujTokeny(prog.wynik.tresc) + szacujTokeny(rec.wynik.tresc) + 300;
    const r = `${prog.r}p`;
    const pop = {
      r, rola: 'programista', nazwa: prog.nazwa, zadanie: 'Poprawić kod według uwag recenzenta', fala: 3, poprawkaZ: prog.r,
      silnik, model, zrodlo: d.zrodlo, bezZapasu: true, weSzac: we, wySzac: wy, maxTokenow: wy, myslenieSzac: prog.myslenieSzac, rez: [],
      wynik: { r, rola: 'programista', nazwa: prog.nazwa, silnik, model, stan: 'czeka', tresc: '', ms: 0 },
      dane: {},
    };
    const zl = szacujZl(model, silnik, we, wy, prog.myslenieSzac);
    pop.szacunekZl = zl;
    if (zl > 0) {
      const rez = zarezerwuj(konto, zl, d.zrodlo);
      if (!rez.ok) { log({ t: 'poprawka', osoba: u.id, bieg: biegId, kod: 'budzet' }); return; }
      if (rez.token) pop.rez.push({ token: rez.token, koszt: 0 });
    }
    pop.wiadomosci = (m) => plan_.promptPoprawki(prog.wiadomosci(m), prog.wynik.tresc, rec.wynik.tresc);
    stanT.role.push(pop);
    k.doRozliczenia.push(pop);
    t.emit('rola', { r, rola: 'programista', nazwa: pop.nazwa, zadanie: pop.zadanie, fala: 3, poprawkaZ: prog.r, silnik, model, zrodlo: d.zrodlo,
      stan: 'czeka', ...(cennik ? { szacunekZl: zl } : {}) });
    await wykonajRole(pop, t);
  }

  async function przebieg(k) {
    const { bieg, u, payload, ep, prowadzacy, glosowy, us, zgodaChmury, pytanie, maObraz, maSprzet, turaAc, fazaAc, stanT, emit, wybor, biegId } = k;
    const start = stanT.start;
    // Kontekst prowadzącego składa się RÓWNOLEGLE z planistą i rolami (embeddingi, baza wiedzy).
    const kontekstP = czat.zlozKontekst(payload, ep);
    kontekstP.catch(() => {});
    const { kod: odmowa, powod: powodOdmowy } = odmowaTury(u, { prowadzacy, zgodaChmury });
    let sklad = { role: [], odrzucone: [], zrodlo: '', uwagi: [], szukaj: '', miejsce: '', kiedy: '', katalog: stanT.katalog };
    if (odmowa) {
      emit('zespol', { v: 1, faza: 'odmowa', kod: odmowa, powod: powodOdmowy });
    } else {
      emit('zespol', { v: 1, faza: 'planowanie' });
      sklad = await ulozSklad(u, { payload, prowadzacy, jawna: k.jawna, signal: turaAc.signal, pytanie, maObraz, maSprzet, us, zgodaChmury, rezerwuj: true });
      for (const r of sklad.role) { r.rez = r.rezerwacja ? [{ token: r.rezerwacja, koszt: 0 }] : []; k.doRozliczenia.push(r); }
      stanT.kosztPlanistyZl = sklad.kosztPlanistyZl || 0;
    }
    if (turaAc.signal.aborted) return biegi.zakoncz(bieg, '');
    const katalog = sklad.katalog || stanT.katalog;
    stanT.katalog = katalog;
    const daneWyjdaDo = [...new Set([...sklad.role.map((r) => DOSTAWCA[r.silnik]),
      sklad.planista ? DOSTAWCA[sklad.planista.silnik] : '', DOSTAWCA[prowadzacy.silnik]].filter(Boolean))];
    stanT.zrodlo = sklad.zrodlo; stanT.daneWyjdaDo = daneWyjdaDo;
    stanT.tylkoDarmowe = sklad.tylkoDarmowe === true;
    // Paczka roli z BIAŁEJ LISTY: pytanie, zadanie, skrót rozmowy, czas + dane z katalogu roli.
    const sprzetTekst = maSprzet ? blokSprzetu(U().sprzet).content : '';
    const obraz = maObraz ? pierwszyObraz(payload.messages) : null;
    const wspolne = { pytanie, teraz: terazTekst(), poprzednie: plan_.skrotRozmowy(payload.messages, 400) };
    const wyniki = { tekst: '' };
    // Plan zdjęciowy trafia TYLKO do fotografa (i do notatek prowadzącego, gdy fotograf zawiedzie).
    const planDane = { tekst: '', powod: '' };
    stanT.role = sklad.role.map((r) => {
      const rola = {
        ...r,
        wynik: { r: r.r, rola: r.rola, nazwa: r.nazwa, silnik: r.silnik, model: r.model, stan: 'czeka', tresc: '', ms: 0 },
        dane: {},
      };
      rola.wiadomosci = () => plan_.promptRoli(r.rola, {
        ...wspolne, zadanie: r.zadanie, katalog,
        dane: { wyniki: wyniki.tekst, sprzet: sprzetTekst, plan: r.rola === 'fotograf' ? planDane.tekst : '', planPowod: r.rola === 'fotograf' ? planDane.powod : '' },
        notatki: r.fala === 2 ? stanT.role.filter((x) => x.fala === 1 && x.wynik.tresc).map((x) => ({ nazwa: x.nazwa, tekst: plan_.oczyscNotatke(x.wynik.tresc, 3000) })) : [],
        obraz: plan_.wymagaObrazu(r.rola, katalog) ? obraz : null,
      });
      return rola;
    });
    const zgoda = zgodaDlaSkladu(sklad);
    const fotograf = stanT.role.find((r) => r.rola === 'fotograf');
    emit('sklad', {
      v: 1, zrodlo: sklad.zrodlo, prowadzacy,
      role: stanT.role.map(rolaDoKlienta),
      odrzucone: sklad.odrzucone.map(odrzuconaDoKlienta),
      daneWyjdaDo,
      ...(stanT.role.some((r) => r.rola === 'badacz') ? { szukaj: sklad.szukaj || plan_.czysteZdanie(pytanie, 150) } : {}),
      ...(fotograf ? { miejsce: sklad.miejsce || '', kiedy: sklad.kiedy || '' } : {}),
      ...(typeof sklad.szacunekZl === 'number' ? { szacunekZl: sklad.szacunekZl, szacunekProwadzacyZl: sklad.szacunekProwadzacyZl || 0 } : {}),
      /* Lokalny prowadzący bez zgody, a skład chciał chmury – role poszły
         lokalnie (albo odpadły); przeglądarka pyta o zgodę (także głosem). */
      ...(zgoda ? { wymagaZgody: true, daneWyjdaDoZaZgoda: zgoda.daneWyjdaDo, silnikiZaZgoda: zgoda.silniki } : {}),
      ...polaWariantow(sklad, us),
    });
    log({ t: 'sklad', osoba: u.id, bieg: biegId, zrodlo: sklad.zrodlo, rol: stanT.role.length, odrzuconych: sklad.odrzucone.length,
      uwagi: (sklad.uwagi || []).length, ms: Date.now() - start });

    /* Z8: tryb głosowy i skład czeka na zgodę na chmurę – przeglądarka staje
       na `sklad`, pyta głosem i zaczyna turę od nowa. Nie ruszamy ŻADNEJ roli
       (także lokalnych – zajęłyby GPU i poszły do kosza, agencja-frontend),
       tylko czekamy na Stop; po terminie bieg kończy się bez odpowiedzi.
       Role nie ruszyły, więc nie ma czego zapisać ani rozliczać. */
    if (glosowy && zgoda && stanT.role.length) {
      for (const r of sklad.role) rozliczRole(r);
      stanT.role = [];
      await new Promise((ok) => {
        const tm = setTimeout(ok, LIMITY.czekajNaZgodeMs);
        tm.unref?.();
        if (turaAc.signal.aborted) ok(); else turaAc.signal.addEventListener('abort', () => { clearTimeout(tm); ok(); }, { once: true });
      });
      log({ t: 'zgoda-glos', osoba: u.id, bieg: biegId, stop: turaAc.signal.aborted });
      return biegi.zakoncz(bieg, turaAc.signal.aborted ? '' : 'Czekałem na zgodę na chmurę – zapytaj jeszcze raz.');
    }

    if (stanT.role.length) {
      policzDzis(u.id);
      stanT.faza = 'role';
      const faza = { signal: fazaAc.signal, koniec: start + (glosowy ? LIMITY.terminFazyGlosMs : LIMITY.terminFazyMs) };
      const terminFazy = setTimeout(() => fazaAc.abort({ kod: 'scal' }), Math.max(0, faza.koniec - Date.now()));
      terminFazy.unref?.();
      // Badacz szuka po stronie serwera – jeden wynik dla roli i prowadzącego.
      const badacz = stanT.role.find((r) => r.rola === 'badacz');
      if (badacz) {
        const q = sklad.szukaj || plan_.czysteZdanie(pytanie, 150);
        stanT.szukano = q;
        badacz.dane.przedStartem = async (signal) => {
          if (!szukajTekstu) { wyniki.tekst = ''; return; }
          const sg = AbortSignal.any([signal, AbortSignal.timeout(LIMITY.terminSzukaniaMs)]);
          const odp = await Promise.race([
            szukajTekstu(q, { signal: sg }).catch(() => null),
            new Promise((ok) => { const tm = setTimeout(() => ok(null), LIMITY.terminSzukaniaMs); tm.unref?.(); sg.addEventListener('abort', () => ok(null), { once: true }); }),
          ]);
          wyniki.tekst = formatujWyniki(odp);
        };
      }
      // Fotograf – plan liczy Cosmos (obok wyszukiwania badacza, przed startem roli, w imieniu osoby).
      if (fotograf) {
        stanT.plan = { ok: false, miejsce: sklad.miejsce || '', kiedy: sklad.kiedy || '', tekst: '' };
        fotograf.dane.przedStartem = async (signal) => {
          const p = await policzPlanTury({ miejsce: sklad.miejsce, kiedy: sklad.kiedy, kiedyBledne: sklad.kiedyBledne, pytanie, glosowy }, signal);
          planDane.tekst = p.ok ? p.tekst : ''; planDane.powod = p.ok ? '' : p.powod;
          Object.assign(stanT.plan, { ok: p.ok, tekst: p.ok ? p.tekst : '' });
        };
      }
      const t = { u, tura: { signal: turaAc.signal }, faza, emit, prowadzacy, zgodaChmury, biegId, zapasZakazany: false, katalog,
        tylkoDarmowe: stanT.tylkoDarmowe };
      const fala1 = stanT.role.filter((r) => r.fala !== 2);
      await Promise.all(fala1.map((r) => wykonajRole(r, t)));
      const fala2 = stanT.role.filter((r) => r.fala === 2);
      for (const r of fala2) {
        if (!fala1.some((x) => x.wynik.tresc)) {
          // Bez notatek fali 1 recenzent nie ma czego sprawdzać – nie wołamy modelu.
          Object.assign(r.wynik, { stan: 'pominieta', blad: 'Nie było czego sprawdzić.', kod: 'pominieta' });
          emit('rola', { r: r.r, stan: 'pominieta', ms: 0, blad: r.wynik.blad, kod: 'pominieta', ...(cennik ? { kosztZl: 0 } : {}) });
          continue;
        }
        await wykonajRole(r, t);
      }
      await poprawkaKodu(k, t);
      clearTimeout(terminFazy);
      stanT.czasRol = Date.now() - start;
    }
    if (turaAc.signal.aborted) return biegi.zakoncz(bieg, '');
    if (czyZamykanie()) {
      return biegi.zakoncz(bieg, 'Serwer się aktualizuje – notatki zespołu są zapisane, zapytaj jeszcze raz o odpowiedź.');
    }

    // ------------------------------------------------------------------ prowadzący
    stanT.faza = 'prowadzacy';
    const kontekst = await kontekstP;
    let naRole = 6000;
    const oknoLokalne = kontekst.oknoLokalne || (silnikLokalny(prowadzacy) ? oknoLokalneDla(ep) : 0);
    if (oknoLokalne && stanT.role.length) {
      const zajete = kontekst.messages.reduce((a, m) => a + szacujTokeny(m.content), 0);
      naRole = plan_.budzetNotatek({ okno: oknoLokalne, zajete, naOdpowiedz: 1024, ileRol: stanT.role.length }).naRole;
    }
    stanT.notatki = stanT.role.length ? tekstNotatek(stanT, { naRole }) : '';
    /* C5: fotograf dostał policzony plan – przeglądarka blokuje wtedy [PLAN:]
       prowadzącego w tej turze (drugi plan mimo zdania w notatkach). */
    emit('faza', { faza: 'prowadzacy', t: Date.now() - start, ...(stanT.notatki ? { notatki: stanT.notatki } : {}),
      ...(stanT.plan && stanT.plan.ok ? { planPoliczony: true } : {}),
      ...(cennik && stanT.role.length ? { kosztZl: kosztTury(stanT) } : {}) });
    const wiadomosci = stanT.notatki ? [...kontekst.messages, { role: 'user', content: stanT.notatki }] : kontekst.messages;
    const maObrazK = ostatniaMaObraz(wiadomosci);
    /* Z5: rola „oko” opisała obraz – prowadzący zostaje tekstowy i dostaje
       opis zamiast obrazu. Obrazy z bazy wiedzy (oko ich nie widziało) albo
       oko bez notatki – jak dawniej: model wizyjny prowadzącego. */
    const przezOko = maObrazK && !kontekst.obrazowZBazy && okoOpisalo(stanT);
    const wybor2 = czat.wybierzModel(payload, ep, przezOko ? false : maObrazK);
    if (wybor2.blad) return biegi.zakoncz(bieg, String((wybor2.blad[1] && wybor2.blad[1].error) || 'Prowadzący: brak modelu.'));
    const zObrazem = maObrazK && !wybor2.bezObrazow && !przezOko;
    const zNotka = przezOko ? obrazOpisanyPrzezOko(wiadomosci) : wybor2.bezObrazow ? bezObrazow(wiadomosci)
      : zObrazem ? zObrazemWidzisz(wiadomosci, { klatkaKamery: payload.klatkaKamery, obrazowZBazy: kontekst.obrazowZBazy }) : wiadomosci;
    const chronOd = kontekst.chronOd + (zNotka.length - kontekst.messages.length) - (stanT.notatki ? 1 : 0);
    const { wiadomosci: doWyslania, limitZOkna } = przytnijDoOkna(zNotka, oknoLokalne, payload.max_tokens, Math.max(0, chronOd));
    const body = {
      model: wybor2.model, messages: doWyslania,
      temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.6,
      max_tokens: silniki.tokenyDozwolone(prowadzacy.silnik, limitZOkna || (Number.isInteger(payload.max_tokens) ? payload.max_tokens : 2048), u),
      top_p: typeof payload.top_p === 'number' ? payload.top_p : 0.95,
      stream: true, stream_options: { include_usage: true },
    };
    // `model` – koszt prowadzącego w zł liczy lib/czat.js (pompujDoBiegu → zanotujZuzycie) z cennika.
    const zuzycie = { id: u.id, silnik: prowadzacy.silnik, zrodlo: silniki.dostepDla(prowadzacy.silnik, u).zrodlo, model: wybor2.model,
      szacunekWe: doWyslania.reduce((a, m) => a + szacujTokeny(m.content), 0) };
    /* Budżet: prowadzący to zwykle NAJDROŻSZE wywołanie tury (pełna rozmowa
       + notatki ról), a szedł bez rezerwacji – role mieściły się w limicie,
       prowadzący go przebijał (it-konta: 13,33 zł przy limicie 11,70 zł).
       Rezerwacja przed wysłaniem (szacunek z tego, co naprawdę pójdzie);
       rozliczenie w pompujDoBiegu (kontrakt C1), zwolnienie na każdej
       ścieżce błędu. Odmowa – koniec tury, notatki zespołu zostają. */
    let rezProwadzacego = null;
    if (platny(prowadzacy.silnik)) {
      const zlP = szacujZl(wybor2.model, prowadzacy.silnik, zuzycie.szacunekWe, body.max_tokens);
      const rez = zarezerwuj(u, zlP, zuzycie.zrodlo);
      if (!rez.ok) {
        log({ t: 'prowadzacy', osoba: u.id, bieg: biegId, kod: 'budzet', szacunekZl: zlP });
        return biegi.zakoncz(bieg, 'Budżet na płatne modele nie wystarczy na odpowiedź prowadzącego. Notatki zespołu są zapisane – '
          + 'wyślij pytanie jeszcze raz przez Chmurę (bez opłat) albo zmień limit.', { kod: 'budzet-wyczerpany' });
      }
      rezProwadzacego = rez.token || null;
    }
    const kubelek = przydzial.dla(ep, prowadzacy.silnik, wybor2.model);
    const miejsce = kubelek.zajmijOdRazu(u.id, wybor2.model);   // prowadzący nie czeka w kolejce
    const zegar = zegarCiszy(turaAc);
    zegar.pilnuj();
    let wynik;
    try {
      wynik = await czat.wyslijDoDostawcy({ ep, body, abort: turaAc, payload, maObraz: zObrazem, swappedFrom: wybor2.swappedFrom });
    } catch (err) {
      zegar.stop(); miejsce(); zwolnijRez(rezProwadzacego);
      if (turaAc.signal.aborted && !zegar.cisza) return biegi.zakoncz(bieg, '');
      return biegi.zakoncz(bieg, zegar.cisza ? 'Prowadzący nie odpowiedział w czasie. Notatki zespołu są zapisane – naciśnij „Ponów”.'
        : `Prowadzący: nie udało się połączyć (${String(err && err.message).slice(0, 80)}).`);
    }
    const { upstream, model } = wynik;
    if (upstream.status === 429) kubelek.zglos429();
    if (!upstream.ok) {
      zegar.stop(); miejsce(); zwolnijRez(rezProwadzacego);
      const tresc = await upstream.text().catch(() => '');
      let komunikat = '';
      try { const j = JSON.parse(tresc); komunikat = String(j?.error?.message || j?.error || j?.message || '').slice(0, 160); } catch { /* nie JSON */ }
      return biegi.zakoncz(bieg, `Prowadzący nie odpowiedział (HTTP ${upstream.status}). Notatki zespołu są zapisane. ${scrubSecrets(komunikat)}`.trim());
    }
    const t0p = Date.now();
    try {
      await czat.pompujDoBiegu(bieg, upstream, {
        ep, model, payload, abort: turaAc, zegar, zuzycie, miejsce, rezerwacja: rezProwadzacego,
        ponow: async () => (await czat.wyslijDoDostawcy({ ep, body: { ...body, model }, abort: turaAc, payload, maObraz: zObrazem, swappedFrom: wybor2.swappedFrom })).upstream,
      });
    } finally {
      /* pompujDoBiegu rozlicza rezerwację sam (C1); to tylko siatka – rozlicz
         i zwolnij w lib/budzet.js są idempotentne, wydatek zapisał już
         zanotujZuzycie. Nic nie zostaje zarezerwowane po turze. */
      zwolnijRez(rezProwadzacego);
    }
    log({ t: 'tura', osoba: u.id, bieg: biegId, rol: stanT.role.length, ms: Date.now() - start, prowadzacyMs: Date.now() - t0p,
      stany: stanT.role.map((r) => r.wynik.stan).join(',') });
    return undefined;
  }

  const silnikLokalny = (p) => p.silnik === 'local';

  /** Czy rola patrząca na obraz (oko, własna „wymaga obrazu”) oddała opis. */
  const okoOpisalo = (stanT) => stanT.role.some((r) => r.fala !== 3 && plan_.wymagaObrazu(r.rola, stanT.katalog || plan_.KATALOG)
    && rozdzielMyslenie(String(r.wynik.tresc || '')).tresc.trim().length > 0);

  /** Wiadomości prowadzącego bez obrazów + zdanie, skąd wie, co na nich jest
   *  (Z5). Sam tekst części z obrazem zostaje; system idzie na początek
   *  (lib/model.js i tak skleja wszystkie wiadomości system w jedną). */
  function obrazOpisanyPrzezOko(wiadomosci) {
    const bez = wiadomosci.map((m) => (Array.isArray(m.content) && m.content.some((p) => p && p.type === 'image_url')
      ? { ...m, content: m.content.filter((p) => p && p.type !== 'image_url').map((p) => (p && p.text) || '').join('\n') || '(pytanie bez tekstu)' }
      : m));
    const i = bez.findIndex((m) => m.role !== 'system');
    bez.splice(i < 0 ? bez.length : i, 0, { role: 'system', content: 'Do tego pytania dołączono obraz. Obejrzała go rola zespołu „Oko” – '
      + 'jej opis jest w NOTATKACH ZESPOŁU. Ty obrazu nie dostajesz: odpowiadaj na podstawie tego opisu i nie dopowiadaj szczegółów, '
      + 'których w nim nie ma. Nie pisz, że nie widzisz obrazu – po prostu korzystaj z opisu.' });
    return bez;
  }

  /** Pierwszy obraz z ostatniej wypowiedzi człowieka (dla roli „oko”). */
  function pierwszyObraz(wiadomosci) {
    const ost = [...(wiadomosci || [])].reverse().find((m) => m && m.role === 'user' && Array.isArray(m.content));
    const p = ost && ost.content.find((x) => x && x.type === 'image_url');
    const url = p && (typeof p.image_url === 'string' ? p.image_url : p.image_url && p.image_url.url);
    return typeof url === 'string' && url.startsWith('data:image/') ? url : null;
  }

  /** Wyniki wyszukiwania dla badacza – tytuł, adres, zajawka, początek treści strony. */
  function formatujWyniki(odp) {
    if (!odp || !Array.isArray(odp.results) || !odp.results.length) return '';
    return odp.results.slice(0, 5).map((r, i) => `${i + 1}. ${String(r.title || '').slice(0, 160)} (${String(r.url || '').slice(0, 300)})\n`
      + `${String(r.snippet || '').slice(0, 300)}${r.text ? `\n${String(r.text).slice(0, 1500)}` : ''}`).join('\n\n');
  }

  // -------------------------------------------------------------------------
  // Tryb „Proponuj”: planista obok zwykłej odpowiedzi
  // -------------------------------------------------------------------------

  function propozycja(payload, { ep, model }) {
    const u = ktoWymagany('propozycja zespołu');
    const ac = new AbortController();
    const prowadzacy = { silnik: nazwaSilnika(payload.endpoint), model: model || ep.model };
    const us = ustawienia(u);
    const zz = payload.zespol || {};
    const obietnica = ulozSklad(u, {
      // „Proponuj”: oba składy (proponowany + `darmowe`), wybór domyślny robi linijka pod odpowiedzią (skladDomyslny).
      payload: { ...payload, zespol: { modele: zz.modele, tylkoDarmowe: false } }, prowadzacy, jawna: false, signal: ac.signal,
      pytanie: tekstPytania(payload.messages), maObraz: ostatniaMaObraz(payload.messages), maSprzet: Boolean(blokSprzetu(U().sprzet)),
      us, zgodaChmury: (zz.zgoda && zz.zgoda.chmura === true) || us.zgodaChmura, zKandydatami: true,
    }).catch(() => null);
    return {
      async dopisz(bieg) {
        const tm = setTimeout(() => ac.abort({ kod: 'termin' }), 3000);
        const s = await Promise.race([obietnica, new Promise((ok) => { ac.signal.addEventListener('abort', () => ok(null), { once: true }); })]);
        clearTimeout(tm);
        if (!s || !s.role.length) return;
        const zgoda = zgodaDlaSkladu(s);
        biegi.dopiszZdarzenie(bieg, 'sklad', {
          v: 1, propozycja: true, zrodlo: s.zrodlo, prowadzacy,
          role: s.role.map(rolaDoKlienta),
          odrzucone: s.odrzucone.map(odrzuconaDoKlienta),
          daneWyjdaDo: [...new Set(s.role.map((r) => DOSTAWCA[r.silnik]).filter(Boolean))],
          ...(s.role.some((r) => r.rola === 'fotograf') ? { miejsce: s.miejsce || '', kiedy: s.kiedy || '' } : {}),
          ...(typeof s.szacunekZl === 'number' ? { szacunekZl: s.szacunekZl, szacunekProwadzacyZl: s.szacunekProwadzacyZl || 0 } : {}),
          ...(zgoda ? { wymagaZgody: true, daneWyjdaDoZaZgoda: zgoda.daneWyjdaDo, silnikiZaZgoda: zgoda.silniki } : {}),
          ...polaWariantow(s, us),
        });
      },
    };
  }

  // -------------------------------------------------------------------------
  // Trasy /api/zespol/*
  // -------------------------------------------------------------------------

  async function obsluz(req, res, p) {
    const u = ktoWymagany('trasy zespołu');
    if (p === '/api/zespol/katalog' && req.method === 'GET') {
      // Role Cosmosa + własne TEJ osoby (bez instrukcji – tę widać tylko w jej ustawieniach).
      return sendJson(res, 200, { role: plan_.katalogDlaKlienta(ustawienia(u).wlasneRole), maxRol: maxRolOsoby(u), tryby: plan_.TRYBY,
        maxWlasnych: plan_.MAX_WLASNYCH, cechyWlasnych: plan_.CECHY_WLASNYCH });
    }
    if (p === '/api/zespol/ustawienia' && req.method === 'GET') return sendJson(res, 200, { ustawienia: ustawienia(u) });
    if (p === '/api/zespol/ustawienia' && req.method === 'POST') {
      let dane;
      try { dane = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const w = zapiszUstawienia(dane && typeof dane === 'object' ? dane : {}, u);
      if (w.odmowa) return sendJson(res, 400, w.odmowa);
      if (w.blad) return bladZapisu ? bladZapisu(res, w.blad) : sendJson(res, 500, { error: 'Zapis ustawień nie powiódł się.' });
      return sendJson(res, 200, { ok: true, ustawienia: w.ustawienia });
    }
    if (p === '/api/zespol/plan' && req.method === 'POST') {
      let dane;
      try { dane = await readJson(req, 16 * 1024 * 1024); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const wiadomosci = Array.isArray(dane.messages) ? dane.messages
        : typeof dane.pytanie === 'string' ? [{ role: 'user', content: dane.pytanie.slice(0, 8000) }] : null;
      if (!wiadomosci) return sendJson(res, 400, { error: 'Brak pytania.' });
      const konto = konta.znajdz(u.id) || u;
      const silnik = nazwaSilnika(dane.endpoint);
      const d = silniki.dostepDla(silnik, konto);
      if (!d.ok) return sendJson(res, 403, { error: d.powod, kod: 'silnik-niedostepny' });
      const payload = { messages: wiadomosci, endpoint: silnik, model: typeof dane.model === 'string' ? dane.model : '',
        trybGlosowy: dane.trybGlosowy === true,
        zespol: { modele: dane.modele, zgoda: dane.zgoda, sklad: dane.sklad, miejsce: dane.miejsce, kiedy: dane.kiedy,
          /* Plan dla bramki liczy OBA składy (proponowany + `darmowe`), a ustawienie
             osoby idzie jako `skladDomyslny` – przeglądarka sama zaznacza wariant. */
          tylkoDarmowe: dane.tylkoDarmowe === true } };
      // Z5: skład planujemy na modelu tekstowym prowadzącego (obraz ogląda rola „oko”) – jak w turze.
      const wybor = czat.wybierzModel(payload, d.ep, false);
      if (wybor.blad) return sendJson(res, ...wybor.blad);
      const prowadzacy = { silnik, model: wybor.model };
      const us = ustawienia(konto);
      const zgoda = (dane.zgoda && dane.zgoda.chmura === true) || us.zgodaChmura;
      const ac = new AbortController();
      const s = await ulozSklad(konto, { payload, prowadzacy, jawna: dane.jawna !== false, signal: ac.signal, pytanie: tekstPytania(wiadomosci),
        maObraz: ostatniaMaObraz(wiadomosci), maSprzet: Boolean(blokSprzetu(U().sprzet)), us, zgodaChmury: zgoda, zKandydatami: true });
      /* Czego brakuje do lepszego składu: zgody na chmurę przy lokalnym
         prowadzącym (także w głosie – przeglądarka pyta wtedy na głos). */
      const zg = zgodaDlaSkladu(s);
      return sendJson(res, 200, {
        sklad: {
          zrodlo: s.zrodlo, prowadzacy,
          role: s.role.map(rolaDoKlienta),
          odrzucone: s.odrzucone.map(odrzuconaDoKlienta),
          daneWyjdaDo: [...new Set([...s.role.map((r) => DOSTAWCA[r.silnik]), DOSTAWCA[prowadzacy.silnik]].filter(Boolean))],
          szukaj: s.role.some((r) => r.rola === 'badacz') ? s.szukaj : '',
          ...(s.role.some((r) => r.rola === 'fotograf') ? { miejsce: s.miejsce || '', kiedy: s.kiedy || '' } : {}),
          ...(typeof s.szacunekZl === 'number' ? { szacunekZl: s.szacunekZl, szacunekProwadzacyZl: s.szacunekProwadzacyZl || 0 } : {}),
          ...polaWariantow(s, us),
        },
        wymagaZgody: zg ? 'chmura' : null,
        ...(zg ? { daneWyjdaDoZaZgoda: zg.daneWyjdaDo, silnikiZaZgoda: zg.silniki } : {}),
        ...(cennik ? { kosztPlanistyZl: s.kosztPlanistyZl || 0 } : {}),
      });
    }
    if ((p === '/api/zespol/pomin' || p === '/api/zespol/scal') && req.method === 'POST') {
      let dane = {};
      try { dane = await readJson(req); } catch { /* pusty korpus */ }
      const b = biegi.daj(String(dane.bieg || ''));
      if (!b || !b.zespol || b.koniec) return sendJson(res, 404, { error: 'Ta tura zespołu już się nie liczy.' });
      const ok = p === '/api/zespol/pomin' ? b.zespol.pomin(String(dane.r || '')) : b.zespol.scal();
      return sendJson(res, 200, { ok });
    }
    return sendJson(res, 404, { error: 'Nieznana trasa zespołu.' });
  }

  return {
    rozpoznaj, tura, propozycja, obsluz, ustawienia, zapiszUstawienia, doKonfiguracji, katalogDla,
    // dla testów
    rozstrzygnij, pulaKandydatow, modelPlanisty, wiadomoscNotatek, tekstNotatek, odmowaTury, AKTYWNE, LIMITY, limitPoprawki,
    pulaDarmowa, modeleWariantu, zapasRoli, limitRoli, ulozSklad, czytajStrumien, obrazOpisanyPrzezOko,
  };
}

module.exports = { utworz, LIMITY, DOSTAWCA, SKLADY_DOMYSLNE };

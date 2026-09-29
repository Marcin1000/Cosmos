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
     event: sklad  {v, zrodlo, prowadzacy, role:[…], odrzucone:[…], daneWyjdaDo, propozycja?}
     event: rola   {r, stan, d?, ms?, blad?, kod?, urwane?, zapas?, kolejka?}
     event: faza   {faza:'prowadzacy', t, notatki}
   potem zwykłe bloki prowadzącego i `event: koniec`.

   Prototypy: agencja-backend (zespol-proto.js), it-backend (zespol.js –
   Przydział, wykonajRole), it-konta (straznik-zespolu.js, paczka-roli.js),
   agencja-rozmowa (orkiestra.js). Runda 9.

   Twarda zasada: każde wywołanie modelu idzie w imieniu JAWNEJ osoby –
   silniki.dostepDla(nazwa, u), nigdy pickEndpoint ani dostep() bez osoby
   (audyt tego pilnuje). Konto czytamy świeżo przed każdą rolą: odebrane
   przyznanie działa od następnej roli.
   ============================================================ */

const path = require('node:path');
const { zapytajModel, ustawMyslenie, blindToImages, cichoMysli, czytajUsage, sposobMyslenia } = require('./model.js');
const { sendJson, readJson, zapiszAtomowo, czytajJson } = require('./rdzen.js');
const { kto, ktoWymagany, stan, BrakKontekstu } = require('./kontekst.js');
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
  terminRoliMs: env('COSMOS_ZESPOL_TERMIN_ROLI_MS', 90_000),
  ciszaRoliMs: env('COSMOS_ZESPOL_CISZA_MS', 45_000),
  terminFazyMs: env('COSMOS_ZESPOL_TERMIN_FAZY_MS', 120_000),
  terminFazyGlosMs: env('COSMOS_ZESPOL_TERMIN_FAZY_GLOS_MS', 45_000),
  // Zapas na modelu prowadzącego tylko, gdy do końca fazy zostało tyle (15 s przy fazie 120 s).
  get zapasGdyZostaloMs() { return Math.min(15_000, Math.round(this.terminFazyMs / 4)); },
  zlewkaMs: env('COSMOS_ZESPOL_ZLEWKA_MS', 250),
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
 */
function utworz(z) {
  const {
    czat, biegi, konta, U, terazTekst = () => new Date().toISOString(), szukajTekstu = null, rejestrModeli = null,
    czyZamykanie = () => false, bladZapisu = null, przydzial = require('./przydzial.js').wspolny,
    log = (o) => console.log(`ZESPÓŁ ${JSON.stringify(o)}`), scrubSecrets = (t) => t,
  } = z;

  /* Ile zespołów trwa – na osobę (jeden naraz u członka, dwa u właściciela)
     i ile ich było dziś (limit dobowy członka; wspólny klucz NVIDIA ma limit
     zapytań na minutę dla wszystkich). W pamięci – restart zeruje licznik. */
  const AKTYWNE = new Map();
  const DZIS = new Map();
  const dzien = () => new Date().toLocaleDateString('sv-SE');
  const ileDzis = (id) => { const d = DZIS.get(id); return d && d.dzien === dzien() ? d.n : 0; };
  const policzDzis = (id) => DZIS.set(id, { dzien: dzien(), n: ileDzis(id) + 1 });

  // -------------------------------------------------------------------------
  // Ustawienia osoby – na serwerze (telefon i komputer muszą się zgadzać)
  // -------------------------------------------------------------------------

  const US = () => stan('zespol-ustawienia', (katalog) => {
    const plik = path.join(katalog, 'zespol.json');
    return { plik, dane: czytajJson(plik, {}) || {} };
  });
  const maxRolOsoby = (u) => Math.min(LIMITY.bezpiecznikRol, u && u.rola === 'wlasciciel' ? LIMITY.maxRolWlasciciela : LIMITY.maxRolCzlonka);

  /** Ustawienia po walidacji – z wartościami domyślnymi. */
  function ustawienia(u = ktoWymagany('ustawienia zespołu')) {
    const d = US().dane || {};
    const max = maxRolOsoby(u);
    const role = {};
    for (const [k, v] of Object.entries(d.role && typeof d.role === 'object' ? d.role : {})) {
      if (!plan_.KATALOG[k] || !v || typeof v !== 'object' || !SILNIKI.includes(v.silnik)) continue;
      role[k] = { silnik: v.silnik, model: typeof v.model === 'string' ? v.model.slice(0, 200) : '' };
    }
    return {
      tryb: plan_.TRYBY.includes(d.tryb) ? d.tryb : 'proponuj',
      maxRol: Math.max(1, Math.min(max, Number.isInteger(d.maxRol) ? d.maxRol : 3)),
      zgodaChmura: d.zgodaChmura === true,
      role,
    };
  }

  /** Zapis ustawień z BIAŁEJ LISTY pól; silnik roli tylko z dostępnych osobie. */
  function zapiszUstawienia(dane, u = ktoWymagany('ustawienia zespołu')) {
    const obecne = ustawienia(u);
    const nowe = { ...obecne };
    if (plan_.TRYBY.includes(dane.tryb)) nowe.tryb = dane.tryb;
    if (Number.isInteger(dane.maxRol)) nowe.maxRol = Math.max(1, Math.min(maxRolOsoby(u), dane.maxRol));
    if (typeof dane.zgodaChmura === 'boolean') nowe.zgodaChmura = dane.zgodaChmura;
    if (dane.role && typeof dane.role === 'object') {
      const role = {};
      for (const [k, v] of Object.entries(dane.role)) {
        if (!plan_.KATALOG[k] || !v || typeof v !== 'object' || v === 'auto') continue;
        if (!SILNIKI.includes(v.silnik) || !silniki.dostepDla(v.silnik, u).ok) continue;
        role[k] = { silnik: v.silnik, model: typeof v.model === 'string' ? v.model.slice(0, 200) : '' };
      }
      nowe.role = role;
    }
    const us = US();
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
    return {
      dozwolony: process.env.COSMOS_ZESPOL !== '0',
      przyznany: silniki.zespolDozwolony(u),
      tryb: us.tryb, maxRol: us.maxRol, maxRolSufit: maxRolOsoby(u), zgodaChmura: us.zgodaChmura,
      role: plan_.ID_ROL,
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
   * chmura wspólna. Nigdy cicho: zmiana ma `zamiast` {silnik, model} i `powod`
   * (kod). Synchronicznie, przed startem czegokolwiek.
   */
  function rozstrzygnij(u, role, { prowadzacy, zgodaChmura, maxRol }) {
    const wynik = [];
    const odrzucone = [];
    let lokalnych = 0;
    role.forEach((p, i) => {
      const def = plan_.KATALOG[p.rola];
      const r = { r: `r${i + 1}`, rola: p.rola, nazwa: def.nazwa.pl, zadanie: p.zadanie || def.zadanieDomyslne, fala: def.fala };
      if (wynik.length >= maxRol) { odrzucone.push({ rola: p.rola, kod: 'limit-rol', powod: `najwyżej ${maxRol} role` }); return; }
      const proponowany = { silnik: SILNIKI.includes(p.silnik) ? p.silnik : prowadzacy.silnik, model: p.model || '' };
      const kolejka = [...new Set([proponowany.silnik, prowadzacy.silnik, 'cloud'])];
      const powody = [];
      let wybrany = null;
      for (const s of kolejka) {
        const d = silniki.dostepDla(s, u);
        const kod = odmowaSilnika(s, d, u, { prowadzacy: prowadzacy.silnik, zgodaChmura });
        if (kod) { powody.push(kod); continue; }
        if (s === 'local' && lokalnych >= LIMITY.maxRolLokalnie) { powody.push('limit-lokalny'); continue; }
        let chce = s === proponowany.silnik && proponowany.model ? proponowany.model
          : s === prowadzacy.silnik ? prowadzacy.model : d.ep.model;
        // Oko u ślepego modelu opisałoby zdjęcie z wyobraźni – model wizyjny silnika albo następny silnik.
        if (p.rola === 'oko' && blindToImages(chce)) {
          if (d.ep.visionModel) chce = d.ep.visionModel;
          else { powody.push('brak-wzroku'); continue; }
        }
        const m = silniki.modelDozwolony(s, chce, u);
        if (!m.model) { powody.push('brak-modelu'); continue; }
        wybrany = { silnik: s, model: m.model, zrodlo: d.zrodlo, spozaListy: m.zamiast };
        break;
      }
      if (!wybrany) {
        const kod = powody.includes('wymaga-zgody') ? 'wymaga-zgody' : powody[powody.length - 1] || 'uprawnienia';
        odrzucone.push({ rola: p.rola, silnik: proponowany.silnik, kod, powod: powody.join(',') });
        return;
      }
      if (wybrany.silnik === 'local') lokalnych++;
      Object.assign(r, { silnik: wybrany.silnik, model: wybrany.model, zrodlo: wybrany.zrodlo, dlaczego: p.dlaczego || '' });
      if (proponowany.model && (wybrany.silnik !== proponowany.silnik || wybrany.model !== proponowany.model)) {
        r.zamiast = { silnik: proponowany.silnik, model: proponowany.model };
      } else if (wybrany.silnik !== proponowany.silnik) {
        r.zamiast = { silnik: proponowany.silnik, model: '' };
      }
      if (powody.length || wybrany.spozaListy) r.powod = [...powody, wybrany.spozaListy ? 'lista-wlasciciela' : ''].filter(Boolean).join(',');
      wynik.push(r);
    });
    // Recenzent nigdy sam – bez fali 1 nie ma czego recenzować.
    if (wynik.length && wynik.every((r) => r.rola === 'recenzent')) {
      for (const r of wynik.splice(0)) odrzucone.push({ rola: r.rola, kod: 'sam-recenzent', powod: 'recenzent nigdy sam' });
    }
    return { role: wynik, odrzucone };
  }

  /** Model do roli: wybór osoby w składzie → ustawienia osoby → dobór po
   *  umiejętnościach → prowadzący. Strażnik i tak ma ostatnie słowo. */
  function propozycjaModelu(p, { pula, prowadzacy, us, glosowy }) {
    if (p.silnik && SILNIKI.includes(p.silnik)) return { silnik: p.silnik, model: p.model || '', dlaczego: 'wybór osoby' };
    const zUst = us.role[p.rola];
    if (zUst) return { silnik: zUst.silnik, model: zUst.model || '', dlaczego: 'ustawienia' };
    const { dobierzModel } = require('./umiejetnosci.js');
    const k = dobierzModel(p.rola, pula, { prowadzacy: { id: prowadzacy.model, silnik: prowadzacy.silnik }, glosowy });
    if (k) return { silnik: k.silnik, model: k.id, dlaczego: k.id === prowadzacy.model && k.silnik === prowadzacy.silnik ? 'ten sam model' : 'dopasowanie' };
    return { silnik: prowadzacy.silnik, model: prowadzacy.model, dlaczego: 'ten sam model' };
  }

  // -------------------------------------------------------------------------
  // Planista
  // -------------------------------------------------------------------------

  /** Planista: krótko, bez myślenia, stałe max_tokens (nie „Maks. tokenów”
   *  osoby – urwany JSON). Zwraca tekst albo '' (porażka = heurystyka). */
  async function zapytajPlaniste(u, kandydat, wiadomosci, signal) {
    const d = silniki.dostepDla(kandydat.silnik, u);
    if (!d.ok) return { tekst: '', blad: 'uprawnienia' };
    if (czyZamykanie()) return { tekst: '', blad: 'aktualizacja' };
    const miejsce = przydzial.dla(d.ep, kandydat.silnik, kandydat.id).zajmijOdRazu(u.id, kandydat.id);
    const t0 = Date.now();
    try {
      const body = ustawMyslenie({
        model: kandydat.id, messages: wiadomosci, temperature: 0.2, stream: false,
        max_tokens: silniki.tokenyDozwolone(kandydat.silnik, LIMITY.maxTokenowPlanisty, u),
      }, kandydat.id, false);
      const r = await zapytajModel(d.ep, body, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(LIMITY.terminPlanistyMs)]),
        ponowienia: 1, ponowienia429: 0, sufit: silniki.granice(kandydat.silnik, u)?.maxTokens, lokalny: kandydat.silnik === 'local',
      });
      if (r.status === 429) przydzial.dla(d.ep, kandydat.silnik, kandydat.id).zglos429();
      if (!r.ok) { r.body?.cancel().catch(() => {}); return { tekst: '', blad: `HTTP ${r.status}` }; }
      miejsce.przyjete();
      const j = await r.json().catch(() => null);
      const u2 = j && j.usage;
      try {
        konta.zanotujZuzycie(u.id, { silnik: kandydat.silnik, zrodlo: d.zrodlo,
          we: Number(u2?.prompt_tokens) || 0, wy: Number(u2?.completion_tokens) || 0 });
      } catch { /* licznik nie psuje tury */ }
      const m = j && j.choices && j.choices[0] && j.choices[0].message;
      return { tekst: String((m && m.content) || ''), ms: Date.now() - t0 };
    } catch (err) {
      return { tekst: '', blad: signal.aborted ? 'przerwane' : /timeout|abort/i.test(String(err && (err.name || err.message))) ? 'termin' : 'siec' };
    } finally { miejsce(); }
  }

  /** Skład tury: od osoby, od planisty albo z heurystyki – po strażniku. */
  async function ulozSklad(u, { payload, prowadzacy, jawna, signal, pytanie, maObraz, maSprzet, us, zgodaChmury }) {
    const zz = payload.zespol && typeof payload.zespol === 'object' ? payload.zespol : {};
    const glosowy = payload.trybGlosowy === true;
    const pula = pulaKandydatow(u, { prowadzacy, zgodaChmura: zgodaChmury, modele: zz.modele && typeof zz.modele === 'object' ? zz.modele : {} });
    const dozwolone = plan_.widoczneRole({ maObraz, maSprzet });
    const maxRol = Math.min(us.maxRol, maxRolOsoby(u));
    const br = plan_.bramka(pytanie, { maObraz, maSprzet, tryb: 'sam', trybGlosowy: glosowy });
    let plan = null; let uwagi = []; let zrodlo = '';
    let planista = null;
    if (Array.isArray(zz.sklad) && zz.sklad.length) {
      // Skład od osoby: tylko klucz roli, zadanie i wybór modelu – instrukcja zawsze z katalogu.
      const surowe = zz.sklad.slice(0, LIMITY.bezpiecznikRol).map((x) => ({
        rola: x && x.rola, zadanie: typeof (x && x.zadanie) === 'string' ? x.zadanie.slice(0, 1000) : '',
      }));
      const w = plan_.parsujPlan(JSON.stringify({ zespol: true, role: surowe }), { maObraz, jawna: true, maxRol, dozwolone });
      plan = w.ok ? w.plan : null; uwagi = w.uwagi; zrodlo = 'osoba';
      if (plan) {
        for (const r of plan.role) {
          const x = zz.sklad.find((s) => s && plan_.idRoli(s.rola) === r.rola) || {};
          if (SILNIKI.includes(x.silnik)) { r.silnik = x.silnik; r.model = typeof x.model === 'string' ? x.model.slice(0, 200) : ''; }
        }
        plan.szukaj = plan_.czysteZdanie(zz.szukaj || pytanie, 150);
      }
    } else {
      planista = modelPlanisty(pula, prowadzacy);
      if (planista) {
        const wiad = plan_.promptPlanisty({ pytanie, maObraz, maSprzet, teraz: terazTekst(), poprzednie: plan_.skrotRozmowy(payload.messages, 300),
          jawna, maxRol, role: dozwolone });
        const odp = await zapytajPlaniste(u, planista, wiad, signal);
        if (odp.tekst) {
          const w = plan_.parsujPlan(odp.tekst, { maObraz, jawna, maxRol, dozwolone });
          uwagi = w.uwagi;
          if (w.ok) { plan = w.plan; zrodlo = 'plan'; }
        } else uwagi.push(`planista: ${odp.blad || 'pusto'}`);
      } else uwagi.push('brak modelu planisty');
      /* Porażka planisty przy jawnej prośbie – skład z heurystyki (zespół
         ma ruszyć). Bez prośby (tryb „sam”, „Proponuj”) porażka = bez zespołu:
         nie uruchamiamy kilku płatnych wywołań na zgadywanie. */
      if (jawna && (!plan || !plan.zespol)) {
        plan = plan_.zapasowyPlan(pytanie, br, { dozwolone, maObraz, jawna, maxRol });
        zrodlo = 'heurystyka';
      }
    }
    if (!plan || !plan.zespol) return { role: [], odrzucone: [], zrodlo: zrodlo || 'plan', uwagi, szukaj: '', planista };
    const zModelami = plan.role.map((p) => {
      const m = propozycjaModelu(p, { pula, prowadzacy, us, glosowy });
      return { ...p, silnik: m.silnik, model: m.model, dlaczego: m.dlaczego };
    });
    const s = rozstrzygnij(u, zModelami, { prowadzacy, zgodaChmura: zgodaChmury, maxRol });
    return { ...s, zrodlo, uwagi, szukaj: plan.szukaj || '', planista };
  }

  // -------------------------------------------------------------------------
  // Strumień roli
  // -------------------------------------------------------------------------

  /** Czyta strumień chat/completions. onDelta(tekst), pilnuj() – zegar ciszy. */
  async function czytajStrumien(upstream, { onDelta, pilnuj }) {
    const dekoder = new TextDecoder();
    let ogon = ''; let koniec = false; let dlugosc = false; let blad = null; let usage = null; let bylaTresc = false; let mysli = false;
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
        if (d === '[DONE]') { koniec = true; continue; }
        let j;
        try { j = JSON.parse(d); } catch { continue; }
        const w = (j.choices && j.choices[0]) || {};
        if (w.finish_reason) { koniec = true; if (w.finish_reason === 'length') dlugosc = true; }
        const t = (w.delta && w.delta.content) ?? w.text ?? '';
        const r = (w.delta && (w.delta.reasoning_content ?? w.delta.reasoning)) || '';
        if (r) { mysli = true; bylaTresc = true; }
        if (t) { bylaTresc = true; onDelta(t); }
      }
    };
    for await (const chunk of upstream.body) {
      pilnuj();
      ogon = (ogon + dekoder.decode(chunk, { stream: true })).replace(/\r\n|\r(?!$)/g, '\n');
      const bloki = ogon.split('\n\n');
      ogon = bloki.pop();
      for (const b of bloki) { zjedz(b); if (blad) break; }
      if (blad) { upstream.body?.cancel?.().catch(() => {}); break; }
    }
    if (!blad && ogon.trim()) zjedz(ogon);
    return { koniec, dlugosc, blad, usage, bylaTresc, mysli };
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
    if (t.prowadzacy && (t.prowadzacy.silnik !== rola.silnik || t.prowadzacy.model !== rola.model) && !t.zapasZakazany) {
      proby.push({ silnik: t.prowadzacy.silnik, model: t.prowadzacy.model, zapas: true });
    }
    let ostatniBlad = '';
    let kodBledu = '';
    try {
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
      emit('rola', { r: rola.r, stan: w.stan, ms: w.ms, znakow: w.tresc.length,
        ...(w.blad ? { blad: w.blad, kod: w.kod } : {}), ...(w.urwane ? { urwane: true } : {}),
        ...(w.zapas ? { zapas: { silnik: w.zapas.silnik, model: w.zapas.model } } : {}) });
      log({ t: 'rola', osoba: u.id, bieg: t.biegId, rola: rola.rola, silnik: w.silnik, model: w.model, stan: w.stan, ms: w.ms,
        pierwszaMs: w.pierwszaMs || 0, kolejkaMs: w.kolejkaMs || 0, we: w.we || 0, wy: w.wy || 0, ...(w.kod ? { kod: w.kod } : {}) });
    }
  }

  /** Jedno podejście roli do jednego modelu (z kolejką, zegarami, 429 i cichym ponowieniem).
   *  Zwraca { koniec: true } gdy rola skończona (stan ustawiony), inaczej { blad, kod, bezZapasu }. */
  async function jednaProba({ rola, t, w, d, konto, kubelek, model, silnik, ac, ustawStan, onDelta }) {
    const { u } = t;
    let ponownieWKolejce = false;
    for (let cicheP = 0; cicheP < 2; cicheP++) {
      const tk = Date.now();
      if (kubelek.zajete >= kubelek.limit || kubelek.czekajacych()) ustawStan('czeka', { kolejka: kubelek.czekajacych() + 1 });
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
        const mysli = plan_.mysliRola(rola.rola);
        let body = {
          model, messages: rola.wiadomosci(model), temperature: plan_.KATALOG[rola.rola].temperatura, stream: true,
          stream_options: { include_usage: true },
          max_tokens: silniki.tokenyDozwolone(silnik, plan_.maxTokenowRoli(rola.rola, mysli && Boolean(sposobMyslenia(model))), konto),
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
        try {
          konta.zanotujZuzycie(u.id, { silnik, zrodlo: d.zrodlo, we: (wynik.usage && wynik.usage.we) || 0, wy: (wynik.usage && wynik.usage.wy) || 0 });
        } catch { /* licznik nie psuje tury */ }
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

  /** Notatki dla prowadzącego z bieżących wkładów, w budżecie znaków na rolę. */
  function tekstNotatek(stanT, { naRole = 6000 } = {}) {
    const wklady = []; const niedostepne = [];
    for (const rola of stanT.role) {
      const w = rola.wynik;
      const stanW = domknij(w);
      const notatka = w.tresc ? plan_.oczyscNotatke(w.tresc, naRole) : '';
      if (rola.rola === 'recenzent' && notatka && plan_.bezUwag(notatka)) continue;
      if (notatka) wklady.push({ nazwa: rola.nazwa, model: w.model, tekst: notatka, niedokonczona: stanW !== 'gotowa' });
      else niedostepne.push({ nazwa: rola.nazwa, powod: w.blad || (stanW === 'przerwana' ? 'przerwana' : 'brak wkładu') });
    }
    return blokWkladowZespolu({ wklady, niedostepne, trybGlosowy: stanT.glosowy, kod: stanT.role.some((r) => r.rola === 'programista' && r.wynik.tresc),
      szukano: stanT.szukano || '' });
  }

  /** Wiadomość notatek do pliku rozmowy – jak wynik narzędzia. Stany DOMKNIĘTE
   *  synchronicznie (restart). null, gdy żadna rola nie ruszyła. */
  function wiadomoscNotatek(stanT, biegId) {
    if (!stanT.role.length) return null;
    const content = stanT.notatki || tekstNotatek(stanT);
    return {
      role: 'user', search: true, narzedzie: 'zespol',
      searchQuery: `praca zespołu: ${stanT.role.map((r) => r.nazwa).join(', ')}`,
      content,
      zespol: {
        v: 1, zrodlo: stanT.zrodlo, prowadzacy: stanT.prowadzacy,
        wklady: stanT.role.map((rola) => {
          const w = rola.wynik;
          return {
            r: rola.r, rola: rola.rola, nazwa: rola.nazwa, silnik: w.silnik, model: w.model, zrodlo: rola.zrodlo,
            stan: domknij(w),
            tresc: stripSearchMarker(rozdzielMyslenie(String(w.tresc || '')).tresc).slice(0, LIMITY.maxZnakowWkladu),
            ms: w.ms || (Date.now() - stanT.start),
            ...(w.blad || !KONCOWE.has(w.stan) ? { blad: w.blad || 'przerwane' } : {}),
            ...(w.urwane ? { urwane: true } : {}),
            ...(rola.zamiast ? { zamiast: rola.zamiast } : {}),
            ...(w.zapas ? { zapas: { silnik: w.zapas.silnik, model: w.zapas.model } } : {}),
          };
        }),
        czas: { role: stanT.czasRol || (Date.now() - stanT.start), calosc: Date.now() - stanT.start },
        daneWyjdaDo: stanT.daneWyjdaDo,
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
    const wybor = czat.wybierzModel(payload, ep, ostatniaMaObraz(payload.messages));
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
    const turaAc = new AbortController();
    const fazaAc = new AbortController();
    const start = Date.now();
    const stanT = {
      start, faza: 'planowanie', zrodlo: '', prowadzacy, role: [], notatki: '', daneWyjdaDo: [], glosowy, szukano: '', czasRol: 0,
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

  async function praca(k) {
    const { bieg, u, payload, ep, prowadzacy, glosowy, us, zgodaChmury, pytanie, maObraz, maSprzet, turaAc, fazaAc, stanT, emit, wybor, biegId } = k;
    const start = stanT.start;
    // Kontekst prowadzącego składa się RÓWNOLEGLE z planistą i rolami (embeddingi, baza wiedzy).
    const kontekstP = czat.zlozKontekst(payload, ep);
    kontekstP.catch(() => {});
    let odmowa = '';
    if (u.rola !== 'wlasciciel' && ileDzis(u.id) >= LIMITY.naDobe) odmowa = 'limit-dobowy';
    let sklad = { role: [], odrzucone: [], zrodlo: '', uwagi: [], szukaj: '' };
    if (odmowa) {
      emit('zespol', { v: 1, faza: 'odmowa', kod: odmowa, powod: `Na dziś wykorzystano limit pracy zespołem (${LIMITY.naDobe}). Odpowie sam prowadzący.` });
    } else {
      emit('zespol', { v: 1, faza: 'planowanie' });
      sklad = await ulozSklad(u, { payload, prowadzacy, jawna: k.jawna, signal: turaAc.signal, pytanie, maObraz, maSprzet, us, zgodaChmury });
    }
    if (turaAc.signal.aborted) return biegi.zakoncz(bieg, '');
    const daneWyjdaDo = [...new Set([...sklad.role.map((r) => DOSTAWCA[r.silnik]),
      sklad.planista ? DOSTAWCA[sklad.planista.silnik] : '', DOSTAWCA[prowadzacy.silnik]].filter(Boolean))];
    stanT.zrodlo = sklad.zrodlo; stanT.daneWyjdaDo = daneWyjdaDo;
    // Paczka roli z BIAŁEJ LISTY: pytanie, zadanie, skrót rozmowy, czas + dane z katalogu roli.
    const sprzetTekst = maSprzet ? blokSprzetu(U().sprzet).content : '';
    const obraz = maObraz ? pierwszyObraz(payload.messages) : null;
    const wspolne = { pytanie, teraz: terazTekst(), poprzednie: plan_.skrotRozmowy(payload.messages, 400) };
    const wyniki = { tekst: '' };
    stanT.role = sklad.role.map((r) => {
      const rola = {
        ...r,
        wynik: { r: r.r, rola: r.rola, nazwa: r.nazwa, silnik: r.silnik, model: r.model, stan: 'czeka', tresc: '', ms: 0 },
        dane: {},
      };
      rola.wiadomosci = () => plan_.promptRoli(r.rola, {
        ...wspolne, zadanie: r.zadanie,
        dane: { wyniki: wyniki.tekst, sprzet: sprzetTekst },
        notatki: r.fala === 2 ? stanT.role.filter((x) => x.fala === 1 && x.wynik.tresc).map((x) => ({ nazwa: x.nazwa, tekst: plan_.oczyscNotatke(x.wynik.tresc, 3000) })) : [],
        obraz: r.rola === 'oko' ? obraz : null,
      });
      return rola;
    });
    emit('sklad', {
      v: 1, zrodlo: sklad.zrodlo, prowadzacy,
      role: stanT.role.map((r) => ({ r: r.r, rola: r.rola, nazwa: r.nazwa, zadanie: r.zadanie, silnik: r.silnik, model: r.model, zrodlo: r.zrodlo,
        fala: r.fala, ...(r.dlaczego ? { dlaczego: r.dlaczego } : {}), ...(r.zamiast ? { zamiast: r.zamiast } : {}), ...(r.powod ? { powod: r.powod } : {}) })),
      odrzucone: sklad.odrzucone.map((o) => ({ rola: o.rola, kod: o.kod, ...(o.silnik ? { silnik: o.silnik } : {}) })),
      daneWyjdaDo,
      ...(stanT.role.some((r) => r.rola === 'badacz') ? { szukaj: sklad.szukaj || plan_.czysteZdanie(pytanie, 150) } : {}),
    });
    log({ t: 'sklad', osoba: u.id, bieg: biegId, zrodlo: sklad.zrodlo, rol: stanT.role.length, odrzuconych: sklad.odrzucone.length,
      uwagi: (sklad.uwagi || []).length, ms: Date.now() - start });

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
      const t = { u, tura: { signal: turaAc.signal }, faza, emit, prowadzacy, zgodaChmury, biegId, zapasZakazany: false };
      const fala1 = stanT.role.filter((r) => r.fala !== 2);
      await Promise.all(fala1.map((r) => wykonajRole(r, t)));
      const fala2 = stanT.role.filter((r) => r.fala === 2);
      for (const r of fala2) {
        if (!fala1.some((x) => x.wynik.tresc)) {
          // Bez notatek fali 1 recenzent nie ma czego sprawdzać – nie wołamy modelu.
          Object.assign(r.wynik, { stan: 'pominieta', blad: 'Nie było czego sprawdzić.', kod: 'pominieta' });
          emit('rola', { r: r.r, stan: 'pominieta', ms: 0, blad: r.wynik.blad, kod: 'pominieta' });
          continue;
        }
        await wykonajRole(r, t);
      }
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
    emit('faza', { faza: 'prowadzacy', t: Date.now() - start, ...(stanT.notatki ? { notatki: stanT.notatki } : {}) });
    const wiadomosci = stanT.notatki ? [...kontekst.messages, { role: 'user', content: stanT.notatki }] : kontekst.messages;
    const maObrazK = ostatniaMaObraz(wiadomosci);
    const wybor2 = czat.wybierzModel(payload, ep, maObrazK);
    if (wybor2.blad) return biegi.zakoncz(bieg, String((wybor2.blad[1] && wybor2.blad[1].error) || 'Prowadzący: brak modelu.'));
    const zObrazem = maObrazK && !wybor2.bezObrazow;
    const zNotka = wybor2.bezObrazow ? bezObrazow(wiadomosci)
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
    const zuzycie = { id: u.id, silnik: prowadzacy.silnik, zrodlo: silniki.dostepDla(prowadzacy.silnik, u).zrodlo };
    const kubelek = przydzial.dla(ep, prowadzacy.silnik, wybor2.model);
    const miejsce = kubelek.zajmijOdRazu(u.id, wybor2.model);   // prowadzący nie czeka w kolejce
    const zegar = zegarCiszy(turaAc);
    zegar.pilnuj();
    let wynik;
    try {
      wynik = await czat.wyslijDoDostawcy({ ep, body, abort: turaAc, payload, maObraz: zObrazem, swappedFrom: wybor2.swappedFrom });
    } catch (err) {
      zegar.stop(); miejsce();
      if (turaAc.signal.aborted && !zegar.cisza) return biegi.zakoncz(bieg, '');
      return biegi.zakoncz(bieg, zegar.cisza ? 'Prowadzący nie odpowiedział w czasie. Notatki zespołu są zapisane – naciśnij „Ponów”.'
        : `Prowadzący: nie udało się połączyć (${String(err && err.message).slice(0, 80)}).`);
    }
    const { upstream, model } = wynik;
    if (upstream.status === 429) kubelek.zglos429();
    if (!upstream.ok) {
      zegar.stop(); miejsce();
      const tresc = await upstream.text().catch(() => '');
      let komunikat = '';
      try { const j = JSON.parse(tresc); komunikat = String(j?.error?.message || j?.error || j?.message || '').slice(0, 160); } catch { /* nie JSON */ }
      return biegi.zakoncz(bieg, `Prowadzący nie odpowiedział (HTTP ${upstream.status}). Notatki zespołu są zapisane. ${scrubSecrets(komunikat)}`.trim());
    }
    const t0p = Date.now();
    await czat.pompujDoBiegu(bieg, upstream, {
      ep, model, payload, abort: turaAc, zegar, zuzycie, miejsce,
      ponow: async () => (await czat.wyslijDoDostawcy({ ep, body: { ...body, model }, abort: turaAc, payload, maObraz: zObrazem, swappedFrom: wybor2.swappedFrom })).upstream,
    });
    log({ t: 'tura', osoba: u.id, bieg: biegId, rol: stanT.role.length, ms: Date.now() - start, prowadzacyMs: Date.now() - t0p,
      stany: stanT.role.map((r) => r.wynik.stan).join(',') });
    return undefined;
  }

  const silnikLokalny = (p) => p.silnik === 'local';

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
      payload: { ...payload, zespol: { modele: zz.modele } }, prowadzacy, jawna: false, signal: ac.signal,
      pytanie: tekstPytania(payload.messages), maObraz: ostatniaMaObraz(payload.messages), maSprzet: Boolean(blokSprzetu(U().sprzet)),
      us, zgodaChmury: (zz.zgoda && zz.zgoda.chmura === true) || us.zgodaChmura,
    }).catch(() => null);
    return {
      async dopisz(bieg) {
        const tm = setTimeout(() => ac.abort({ kod: 'termin' }), 3000);
        const s = await Promise.race([obietnica, new Promise((ok) => { ac.signal.addEventListener('abort', () => ok(null), { once: true }); })]);
        clearTimeout(tm);
        if (!s || !s.role.length) return;
        biegi.dopiszZdarzenie(bieg, 'sklad', {
          v: 1, propozycja: true, zrodlo: s.zrodlo, prowadzacy,
          role: s.role.map((r) => ({ r: r.r, rola: r.rola, nazwa: r.nazwa, zadanie: r.zadanie, silnik: r.silnik, model: r.model, zrodlo: r.zrodlo,
            ...(r.zamiast ? { zamiast: r.zamiast } : {}) })),
          odrzucone: s.odrzucone.map((o) => ({ rola: o.rola, kod: o.kod })),
          daneWyjdaDo: [...new Set(s.role.map((r) => DOSTAWCA[r.silnik]).filter(Boolean))],
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
      return sendJson(res, 200, { role: plan_.katalogDlaKlienta(), maxRol: maxRolOsoby(u), tryby: plan_.TRYBY });
    }
    if (p === '/api/zespol/ustawienia' && req.method === 'GET') return sendJson(res, 200, { ustawienia: ustawienia(u) });
    if (p === '/api/zespol/ustawienia' && req.method === 'POST') {
      let dane;
      try { dane = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const w = zapiszUstawienia(dane && typeof dane === 'object' ? dane : {}, u);
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
        trybGlosowy: dane.trybGlosowy === true, zespol: { modele: dane.modele, zgoda: dane.zgoda, sklad: dane.sklad } };
      const wybor = czat.wybierzModel(payload, d.ep, ostatniaMaObraz(wiadomosci));
      if (wybor.blad) return sendJson(res, ...wybor.blad);
      const prowadzacy = { silnik, model: wybor.model };
      const us = ustawienia(konto);
      const zgoda = (dane.zgoda && dane.zgoda.chmura === true) || us.zgodaChmura;
      const ac = new AbortController();
      const s = await ulozSklad(konto, { payload, prowadzacy, jawna: dane.jawna !== false, signal: ac.signal, pytanie: tekstPytania(wiadomosci),
        maObraz: ostatniaMaObraz(wiadomosci), maSprzet: Boolean(blokSprzetu(U().sprzet)), us, zgodaChmury: zgoda });
      // Czego brakuje do lepszego składu: zgody na chmurę przy lokalnym prowadzącym.
      const wymagaZgody = s.odrzucone.some((o) => o.kod === 'wymaga-zgody') || s.role.some((r) => /wymaga-zgody/.test(r.powod || ''))
        ? 'chmura' : null;
      return sendJson(res, 200, {
        sklad: {
          zrodlo: s.zrodlo, prowadzacy,
          role: s.role.map((r) => ({ r: r.r, rola: r.rola, nazwa: r.nazwa, zadanie: r.zadanie, silnik: r.silnik, model: r.model, zrodlo: r.zrodlo,
            ...(r.dlaczego ? { dlaczego: r.dlaczego } : {}), ...(r.zamiast ? { zamiast: r.zamiast } : {}), ...(r.powod ? { powod: r.powod } : {}) })),
          odrzucone: s.odrzucone.map((o) => ({ rola: o.rola, kod: o.kod, ...(o.silnik ? { silnik: o.silnik } : {}) })),
          daneWyjdaDo: [...new Set([...s.role.map((r) => DOSTAWCA[r.silnik]), DOSTAWCA[prowadzacy.silnik]].filter(Boolean))],
          szukaj: s.role.some((r) => r.rola === 'badacz') ? s.szukaj : '',
        },
        wymagaZgody,
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
    rozpoznaj, tura, propozycja, obsluz, ustawienia, zapiszUstawienia, doKonfiguracji,
    // dla testów
    rozstrzygnij, pulaKandydatow, modelPlanisty, wiadomoscNotatek, tekstNotatek, AKTYWNE, LIMITY,
  };
}

module.exports = { utworz, LIMITY, DOSTAWCA };

/* ============================================================
   ZESPÓŁ AGENTÓW – widok w przeglądarce

   Zespół nie jest osobnym czatem ani stosem kart. To JEDNA odpowiedź
   prowadzącego (jego nić, jego podpis), a w niej zwijany blok „Zespół”:
   każda rola to gałąź odchodząca od nici, z kropką w kolorze SWOJEGO
   silnika i nazwą silnika napisaną obok (kolor nie jest jedynym nośnikiem).
   Wygląd i stany: makiety agencji (runda 9), kontrakt zdarzeń – lib/zespol.js.

   Plik ma dwie warstwy:
     1. czyste funkcje stanu (bez DOM-u) – reduktor zdarzeń biegu
        (`zespol`, `sklad`, `rola`, `faza`), wiadomość notatek do zapisu,
        stan z zapisanej wiadomości, skład do wysłania; sprawdzane w Node,
     2. budowniczowie DOM-u – blok w odpowiedzi, propozycja z bramką zgody,
        cicha linijka „Mogę to sprawdzić zespołem”, edytor modelu roli,
        karta Ustawienia → Agenci, kropki ról w trybie głosowym.

   Teksty od modeli i nazwy (wkłady ról, nazwy modeli) idą do DOM-u tylko
   przez textContent albo przez renderMarkdown (ten sam, który rysuje
   odpowiedź i sam ucieka HTML). Żadnych atrybutów on*= – aplikacja ma CSP.
   ============================================================ */

const SILNIKI_ZESPOLU = ['cloud', 'local', 'openai', 'claude'];
const KONCOWE_STANY_ROLI = new Set(['gotowa', 'niedokonczona', 'urwana', 'blad', 'przerwana', 'pominieta']);
/* Kod odrzucenia z serwera → klucz linijki pod blokiem. */
const ODRZUCONE_KLUCZ = {
  'wymaga-zgody': 'ag.odrzuconeZgoda',
  uprawnienia: 'ag.odrzuconeUprawnienia',
  'zespol-nie-przyznany': 'ag.odrzuconeUprawnienia',
  niedostepny: 'ag.odrzuconeUprawnienia',
  'limit-rol': 'ag.odrzuconeLimit',
  'limit-lokalny': 'ag.odrzuconeLimit',
};

/** Stan roli od serwera → stan wiersza (atrybut data-stan i klucz `ag.stan.*`). */
function stanWidoku(stan) {
  switch (stan) {
    case 'pracuje': case 'pisze': case 'zapas': return 'pracuje';
    case 'gotowa': case 'niedokonczona': case 'urwana': return 'gotowe';
    case 'blad': return 'blad';
    case 'pominieta': return 'pominieta';
    case 'przerwana': return 'zatrzymana';
    default: return 'czeka';
  }
}

const silnikZespolu = (s) => (SILNIKI_ZESPOLU.includes(s) ? s : 'cloud');
const napis = (x, max = 400) => (typeof x === 'string' ? x.slice(0, max) : '');

/** Pusty stan tury zespołu. */
function nowyStanTury(teraz = Date.now()) {
  return {
    faza: '', start: teraz, zrodlo: '', prowadzacy: null, role: [], odrzucone: [], daneWyjdaDo: [],
    szukaj: '', notatki: '', czasRol: 0, czasFazy: 0, odmowa: null, propozycja: null, bylSklad: false,
  };
}

function roleZDanych(lista) {
  return (Array.isArray(lista) ? lista : []).filter((r) => r && typeof r === 'object').slice(0, 8).map((r, i) => ({
    r: napis(r.r, 20) || `r${i + 1}`,
    rola: napis(r.rola, 40),
    nazwa: napis(r.nazwa, 60),
    zadanie: napis(r.zadanie, 1000),
    silnik: silnikZespolu(r.silnik),
    model: napis(r.model, 200),
    ...(r.zamiast && typeof r.zamiast === 'object' ? { zamiast: { silnik: silnikZespolu(r.zamiast.silnik), model: napis(r.zamiast.model, 200) } } : {}),
    ...(typeof r.powod === 'string' ? { powod: r.powod.slice(0, 200) } : {}),
  }));
}

function odrzuconeZDanych(lista) {
  return (Array.isArray(lista) ? lista : []).filter((o) => o && typeof o === 'object').slice(0, 8)
    .map((o) => ({ rola: napis(o.rola, 40), kod: napis(o.kod, 40), ...(o.silnik ? { silnik: silnikZespolu(o.silnik) } : {}) }));
}

/**
 * Jedno zdarzenie biegu → stan tury. Czyste: zmienia tylko `st`.
 * Zwraca ogłoszenia dla czytnika ekranu: [{klucz, ...dane}] – najwyżej
 * jedno na start, jedno na koniec każdej roli i jedno na scalanie.
 */
function zjedzZdarzenieZespolu(st, typ, d, teraz = Date.now()) {
  const ogl = [];
  if (!st || !d || typeof d !== 'object') return ogl;
  if (typ === 'zespol') {
    if (d.faza === 'planowanie' && !st.faza) st.faza = 'planowanie';
    if (d.faza === 'odmowa') { st.odmowa = { kod: napis(d.kod, 40), powod: napis(d.powod, 300) }; st.faza = 'odmowa'; }
    return ogl;
  }
  if (typ === 'sklad') {
    /* Propozycja („Proponuj, gdy warto”) przychodzi pod gotową odpowiedzią
       solo – to nie jest praca zespołu, tylko linijka pod odpowiedzią. */
    if (d.propozycja) {
      const role = roleZDanych(d.role);
      st.propozycja = role.length ? {
        role, odrzucone: odrzuconeZDanych(d.odrzucone),
        prowadzacy: d.prowadzacy && typeof d.prowadzacy === 'object' ? { silnik: silnikZespolu(d.prowadzacy.silnik), model: napis(d.prowadzacy.model, 200) } : null,
        daneWyjdaDo: Array.isArray(d.daneWyjdaDo) ? d.daneWyjdaDo.map((x) => napis(x, 40)) : [],
      } : null;
      return ogl;
    }
    st.bylSklad = true;
    st.zrodlo = napis(d.zrodlo, 20);
    if (d.prowadzacy && typeof d.prowadzacy === 'object') st.prowadzacy = { silnik: silnikZespolu(d.prowadzacy.silnik), model: napis(d.prowadzacy.model, 200) };
    st.role = roleZDanych(d.role).map((r) => ({ ...r, stan: 'czeka', tresc: '', ms: 0, start: 0 }));
    st.odrzucone = odrzuconeZDanych(d.odrzucone);
    st.daneWyjdaDo = Array.isArray(d.daneWyjdaDo) ? d.daneWyjdaDo.map((x) => napis(x, 40)) : [];
    st.szukaj = napis(d.szukaj, 300);
    if (st.role.length) {
      st.faza = 'role';
      ogl.push({ klucz: 'ag.sr.start', role: st.role.map((r) => r.rola) });
    } else if (st.faza === 'planowanie') st.faza = 'bez-rol';
    return ogl;
  }
  if (typ === 'rola') {
    const r = st.role.find((x) => x.r === d.r);
    if (!r) return ogl;
    if (typeof d.d === 'string' && d.d) {
      r.tresc += d.d;
      if (r.stan === 'czeka' || r.stan === 'pracuje') r.stan = 'pisze';
      if (!r.start) r.start = teraz;
    }
    if (typeof d.stan === 'string' && d.stan) {
      const byl = stanWidoku(r.stan);
      if (d.stan === 'zapas') {
        // Rola padła na swoim modelu – druga próba na modelu prowadzącego.
        r.zapas = { silnik: silnikZespolu(d.silnik || r.silnik), model: napis(d.model || r.model, 200), po: { silnik: r.silnik, model: r.model } };
        if (d.silnik) r.silnik = silnikZespolu(d.silnik);
        if (d.model) r.model = napis(d.model, 200);
        r.tresc = '';
        r.start = teraz;
      }
      if ((d.stan === 'pracuje' || d.stan === 'pisze') && !r.start) r.start = teraz;
      if (d.stan === 'pracuje' && d.model && !r.zapas) { r.silnik = silnikZespolu(d.silnik || r.silnik); r.model = napis(d.model, 200); }
      r.stan = d.stan;
      if (Number.isFinite(d.ms)) r.ms = d.ms;
      if (typeof d.blad === 'string') r.blad = d.blad.slice(0, 300);
      if (typeof d.kod === 'string') r.kod = d.kod.slice(0, 40);
      if (d.urwane) r.urwane = true;
      const jest = stanWidoku(r.stan);
      if (KONCOWE_STANY_ROLI.has(r.stan) && byl !== jest) {
        const gotowe = st.role.filter((x) => KONCOWE_STANY_ROLI.has(x.stan)).length;
        ogl.push(jest === 'gotowe' ? { klucz: 'ag.sr.gotowa', rola: r.rola, g: gotowe, n: st.role.length }
          : { klucz: 'ag.sr.blad', rola: r.rola, stan: jest });
      }
    }
    return ogl;
  }
  if (typ === 'faza' && d.faza === 'prowadzacy') {
    st.faza = 'prowadzacy';
    st.notatki = typeof d.notatki === 'string' ? d.notatki : '';
    st.czasRol = Number.isFinite(d.t) ? d.t : teraz - st.start;
    st.czasFazy = teraz;
    // Role, które nie doszły do końca, zanim prowadzący ruszył – już nie pracują.
    for (const r of st.role) if (!KONCOWE_STANY_ROLI.has(r.stan)) r.stan = r.tresc ? 'niedokonczona' : 'przerwana';
    if (st.role.length) ogl.push({ klucz: 'ag.sr.sklada' });
  }
  return ogl;
}

/** Rola odrzucona tylko z braku zgody na chmurę – do „Zgoda i ponów”. */
const czekaNaZgode = (st) => st.odrzucone.some((o) => o.kod === 'wymaga-zgody');

/** Ile ról skończyło (gotowe, błąd, pominięta…). */
const ileSkonczonych = (st) => st.role.filter((r) => KONCOWE_STANY_ROLI.has(r.stan)).length;

/**
 * Wiadomość notatek do rozmowy – jak wynik narzędzia, PRZED odpowiedzią
 * prowadzącego. `content` to DOKŁADNIE tekst serwera z `event: faza`
 * (runda 1 i rundy kaskady widzą te same notatki). Bez notatek (Stop w fazie
 * ról, błąd przed prowadzącym) content jest pusty – toApiMessages jej nie
 * wysyła, a blok zostaje na ekranie. null, gdy zespół nie ruszył.
 */
function wiadomoscNotatek(st, teraz = Date.now()) {
  if (!st || (!st.role.length && !czekaNaZgode(st))) return null;
  return {
    role: 'user', search: true, narzedzie: 'zespol',
    searchQuery: `praca zespołu: ${st.role.map((r) => r.nazwa || r.rola).join(', ') || 'bez ról'}`,
    content: st.notatki || '',
    zespol: {
      v: 1, zrodlo: st.zrodlo, prowadzacy: st.prowadzacy,
      wklady: st.role.map((r) => ({
        r: r.r, rola: r.rola, nazwa: r.nazwa, silnik: r.silnik, model: r.model,
        stan: KONCOWE_STANY_ROLI.has(r.stan) ? r.stan : (r.tresc ? 'niedokonczona' : 'przerwana'),
        tresc: r.tresc.slice(0, 8000), ms: r.ms || (r.start ? teraz - r.start : 0),
        ...(r.blad ? { blad: r.blad } : {}), ...(r.urwane ? { urwane: true } : {}),
        ...(r.zamiast ? { zamiast: r.zamiast } : {}), ...(r.zapas ? { zapas: r.zapas } : {}),
      })),
      odrzucone: st.odrzucone,
      czas: { role: st.czasRol || (teraz - st.start), calosc: teraz - st.start },
      daneWyjdaDo: st.daneWyjdaDo,
      ...(st.szukaj ? { szukaj: st.szukaj } : {}),
    },
  };
}

/** Stan widoku z zapisanej wiadomości notatek (także z zapisu sieroty serwera). */
function stanZWiadomosci(m) {
  const z = m && m.zespol && typeof m.zespol === 'object' ? m.zespol : {};
  const st = nowyStanTury(0);
  st.faza = 'koniec';
  st.zrodlo = napis(z.zrodlo, 20);
  if (z.prowadzacy && typeof z.prowadzacy === 'object') st.prowadzacy = { silnik: silnikZespolu(z.prowadzacy.silnik), model: napis(z.prowadzacy.model, 200) };
  st.role = (Array.isArray(z.wklady) ? z.wklady : []).filter((w) => w && typeof w === 'object').slice(0, 8).map((w, i) => ({
    r: napis(w.r, 20) || `r${i + 1}`, rola: napis(w.rola, 40), nazwa: napis(w.nazwa, 60), silnik: silnikZespolu(w.silnik),
    model: napis(w.model, 200), stan: napis(w.stan, 20) || 'gotowa', tresc: napis(w.tresc, 8000), ms: Number(w.ms) || 0, start: 0,
    ...(w.blad ? { blad: napis(w.blad, 300) } : {}), ...(w.urwane ? { urwane: true } : {}),
    ...(w.zamiast && typeof w.zamiast === 'object' ? { zamiast: { silnik: silnikZespolu(w.zamiast.silnik), model: napis(w.zamiast.model, 200) } } : {}),
    ...(w.zapas && typeof w.zapas === 'object' ? { zapas: {
      silnik: silnikZespolu(w.zapas.silnik), model: napis(w.zapas.model, 200),
      ...(w.zapas.po && typeof w.zapas.po === 'object' ? { po: { silnik: silnikZespolu(w.zapas.po.silnik), model: napis(w.zapas.po.model, 200) } } : {}),
    } } : {}),
  }));
  st.odrzucone = odrzuconeZDanych(z.odrzucone);
  st.daneWyjdaDo = Array.isArray(z.daneWyjdaDo) ? z.daneWyjdaDo.map((x) => napis(x, 40)) : [];
  st.szukaj = napis(z.szukaj, 300);
  st.czasRol = z.czas && Number(z.czas.role) || 0;
  st.notatki = typeof m.content === 'string' ? m.content : '';
  return st;
}

/** Role bez wkładu (do noty „Bez wkładu: …”). */
const roleBezWkladu = (st) => st.role.filter((r) => !String(r.tresc || '').trim() && KONCOWE_STANY_ROLI.has(r.stan));

/** Skład do wysłania w `/api/chat` – tylko klucz roli, zadanie i wybór modelu
 *  (instrukcję roli serwer bierze z katalogu). */
function skladDoWyslania(role) {
  return (role || []).filter((r) => r && r.rola).map((r) => ({
    rola: r.rola,
    ...(r.zadanie ? { zadanie: String(r.zadanie).slice(0, 1000) } : {}),
    ...(r.auto ? {} : r.silnik ? { silnik: r.silnik, model: r.model || '' } : {}),
  }));
}

/** Silniki poza domem, na które skład wyśle rozmowę (do bramki zgody). */
function silnikiChmury(role) {
  return [...new Set((role || []).map((r) => r.silnik).filter((s) => s && s !== 'local'))];
}

/**
 * Plan z `/api/zespol/plan` przy lokalnym prowadzącym bez zgody: serwer
 * przeniósł role z chmury na lokalny (`zamiast` + powód `wymaga-zgody`).
 * Bramka pokazuje skład, jaki byłby ZA zgodą, a „Tylko lokalnie” – ten z planu.
 */
function skladZaZgoda(role) {
  return (role || []).map((r) => (r.zamiast && /wymaga-zgody/.test(r.powod || '') && r.zamiast.silnik !== 'local'
    ? { ...r, silnik: r.zamiast.silnik, model: r.zamiast.model || '', zamiast: undefined, powod: undefined, wymagaZgody: true }
    : { ...r }));
}

/** Tura ma już notatki zespołu – „Regeneruj” i rundy kaskady nie wołają go drugi raz. */
function turaMaNotatki(wiadomosci, odKtorej = 0) {
  return (wiadomosci || []).slice(odKtorej).some((m) => m && m.narzedzie === 'zespol');
}

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

/**
 * @param {object} z
 * @param {Function} z.t               i18n
 * @param {Function} z.renderMarkdown  Markdown → bezpieczny HTML (tekst.js)
 * @param {Function} z.widokWToku      treść w toku bez znaczników i <think> (protokol.js)
 * @param {Function} z.nazwaSilnika    'cloud' → „NVIDIA” …
 */
function utworzZespolWidok(z) {
  const { t, renderMarkdown, widokWToku, nazwaSilnika } = z;
  const doc = () => document;
  let licznik = 0;

  const IK = {
    zespol: '<svg class="zespol-ikona" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19.5c0-3.3 2.4-5.6 5.5-5.6s5.5 2.3 5.5 5.6"/><path d="M15.2 4.9a3.2 3.2 0 0 1 0 6.2"/><path d="M17.3 14.2c2 .7 3.2 2.6 3.2 5.3"/></svg>',
    chev: '<svg class="zespol-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    chmura: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5"/><path d="M12 12v8M9 15l3-3 3 3"/></svg>',
    klodka: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };

  /** Element z atrybutami i dziećmi (napisy jako węzły tekstowe). */
  function h(tag, atrybuty = {}, ...dzieci) {
    const e = doc().createElement(tag);
    for (const [k, v] of Object.entries(atrybuty || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'klasa') e.className = v;
      else if (k === 'tekst') e.textContent = v;
      else if (k === 'ikona') e.innerHTML = v;          // wyłącznie stałe SVG z IK
      else if (k === 'styl') e.setAttribute('style', v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const d of dzieci) if (d !== null && d !== undefined && d !== false) e.append(d);
    return e;
  }
  const przycisk = (klasa, tekst, na, atr = {}) => {
    const b = h('button', { type: 'button', klasa, tekst, ...atr });
    if (na) b.addEventListener('click', na);
    return b;
  };

  const nazwaRoli = (r) => {
    const k = `ag.rola.${r.rola}`;
    const s = t('ag.rola.' + r.rola);
    return s && s !== k ? s : (r.nazwa || r.rola || '?');
  };
  const krotkiModel = (m) => String(m || '').split('/').pop();
  const ileRol = (n) => (n === 1 ? t('ag.role1') : t('ag.roleN', { n }));
  const sekundy = (ms) => Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const kolorSilnika = (s) => `var(--k-${s === 'cloud' ? 'nvidia' : s})`;

  function tekstStanu(r, teraz) {
    const w = stanWidoku(r.stan);
    if (w === 'pracuje') return t('ag.stan.pracuje', { s: sekundy(teraz - (r.start || teraz)) });
    if (w === 'gotowe') return t('ag.stan.gotowe', { s: sekundy(r.ms) });
    return t('ag.stan.' + w);
  }
  /** Zdanie dla człowieka, czemu rola nie dała wkładu – z kodu, nie ze zdania serwera (PL). */
  function powodRoli(r) {
    if (!r.blad && !r.kod) return '';
    const kod = r.kod || '';
    if (kod === 'termin' || kod === 'czas') return t('ag.bladCzas', { s: sekundy(r.ms) });
    if (kod === 'uprawnienia') return t('ag.bladUprawnienia');
    if (kod === 'niedostepny' || kod === 'limit-dostawcy') return t('ag.bladNiedostepny');
    if (kod === 'pominieta' || kod === 'zatrzymana' || kod === 'scalono') return '';
    return r.stan === 'blad' ? t('ag.bladNiedostepny') : '';
  }

  // -------------------------------------------------------------------------
  // Blok „Zespół” w odpowiedzi prowadzącego
  // -------------------------------------------------------------------------

  /**
   * @param {object} st stan tury (nowyStanTury / stanZWiadomosci)
   * @param {object} o
   * @param {boolean} o.zywy       praca w toku (Pomiń, Stop zespołu, podgląd)
   * @param {Function} o.naPomin   (r) => void
   * @param {Function} o.naScal    () => void
   * @param {Function} o.naZmienSklad () => void
   * @param {Function} o.naZgodaIPonow () => void
   * @returns {{el, odswiez, zwin, tik, oglos, zniszcz}}
   */
  function blokZespolu(st, o = {}) {
    const id = `zespol-${++licznik}`;
    const sekcja = h('section', { klasa: 'zespol', 'aria-live': 'off', 'aria-label': t('ag.zespol'), 'data-otwarty': o.zywy ? 'true' : 'false' });
    if (st.prowadzacy) sekcja.style.setProperty('--k', kolorSilnika(st.prowadzacy.silnik));
    const sr = h('p', { klasa: 'zespol-sr', role: 'status' });
    let otwarty = Boolean(o.zywy);
    let dotkniety = false;
    const otwarteRole = new Set();
    const wiersze = new Map();       // r → {li, …}
    let glowa = null; let lista = null; let stopka = null; let dodatki = null;
    let klatka = 0;

    function ustawOtwarty(tak) {
      otwarty = tak;
      sekcja.dataset.otwarty = String(tak);
      if (glowa && glowa.tagName === 'BUTTON') {
        glowa.setAttribute('aria-expanded', String(tak));
        glowa.title = t(tak ? 'ag.ukryj' : 'ag.pokaz');
      }
      maluj();
    }

    function zbudujGlowe() {
      const przyciskGlowy = st.role.length > 0;
      glowa = przyciskGlowy
        ? h('button', { type: 'button', klasa: 'zespol-glowa', 'aria-expanded': String(otwarty), 'aria-controls': `${id}-role`, title: t(otwarty ? 'ag.ukryj' : 'ag.pokaz') })
        : h('div', { klasa: 'zespol-glowa' });
      if (przyciskGlowy) glowa.addEventListener('click', () => { dotkniety = true; ustawOtwarty(!otwarty); });
      return glowa;
    }

    function wierszRoli(r, i) {
      const li = h('li', { klasa: 'rola nowa', 'data-r': r.r, 'data-rola': r.rola, styl: `--i:${i}` });
      li.addEventListener('animationend', () => li.classList.remove('nowa'), { once: true });
      const kropka = h('span', { klasa: 'rola-kropka', 'aria-hidden': 'true' });
      const wiersz = h('button', { type: 'button', klasa: 'rola-wiersz', 'aria-expanded': 'false', 'aria-controls': `${id}-${r.r}` });
      const nazwa = h('span', { klasa: 'rola-nazwa' });
      const model = h('span', { klasa: 'rola-model' });
      const silnik = h('span', { klasa: 'rola-silnik' });
      const modelTxt = doc().createTextNode('');
      model.append(silnik, modelTxt);
      const stanEl = h('span', { klasa: 'rola-stan' });
      wiersz.append(nazwa, model, stanEl);
      wiersz.addEventListener('click', () => {
        dotkniety = true;
        if (otwarteRole.has(r.r)) otwarteRole.delete(r.r); else otwarteRole.add(r.r);
        maluj();
      });
      const uwaga = h('div', { klasa: 'rola-uwaga' });
      const podglad = h('div', { klasa: 'rola-podglad', 'aria-hidden': 'true' });
      const blad = h('div', { klasa: 'rola-blad' });
      const akcje = h('div', { klasa: 'rola-akcje' });
      const tresc = h('div', { klasa: 'rola-tresc md', id: `${id}-${r.r}` });
      li.append(kropka, wiersz, uwaga, podglad, blad, akcje, tresc);
      const w = { li, wiersz, nazwa, silnik, modelTxt, stanEl, uwaga, podglad, blad, akcje, tresc, trescZrodlo: null };
      wiersze.set(r.r, w);
      return li;
    }

    function malujWiersz(r, w, teraz) {
      const ws = stanWidoku(r.stan);
      w.li.dataset.silnik = r.silnik;
      w.li.dataset.stan = ws;
      const nazwa = nazwaRoli(r);
      if (w.nazwa.textContent !== nazwa) w.nazwa.textContent = nazwa;
      const sil = nazwaSilnika(r.silnik);
      if (w.silnik.textContent !== sil) w.silnik.textContent = sil;
      const m = krotkiModel(r.model);
      if (w.modelTxt.data !== m) w.modelTxt.data = m;
      const stanTxt = tekstStanu(r, teraz);
      if (w.stanEl.textContent !== stanTxt) w.stanEl.textContent = stanTxt;
      w.wiersz.title = r.zadanie || '';
      w.wiersz.setAttribute('aria-label', `${t('ag.pokazWklad', { rola: nazwa })} · ${sil} ${m} · ${stanTxt}`);
      // Zastępstwo z planu albo zapas po awarii – osobna linijka.
      const uwaga = r.zapas && r.zapas.po && r.zapas.po.model ? t('ag.zapasPo', { model: krotkiModel(r.zapas.po.model) })
        : r.zamiast && r.zamiast.model && r.zamiast.model !== r.model ? t('ag.zamiast', { model: krotkiModel(r.zamiast.model) })
          : r.zamiast && r.zamiast.silnik !== r.silnik ? t('ag.zamiast', { model: nazwaSilnika(r.zamiast.silnik) }) : '';
      w.uwaga.textContent = uwaga;
      w.uwaga.hidden = !uwaga;
      const otwartaRola = otwarteRole.has(r.r);
      w.wiersz.setAttribute('aria-expanded', String(otwartaRola));
      // Podgląd na żywo: jedna linijka, tylko pisząca rola, tylko gdy wiersz zwinięty.
      const pisze = o.zywy && otwarty && ws === 'pracuje' && r.tresc && !otwartaRola;
      if (pisze) {
        const ogon = widokWToku(r.tresc).replace(/\s+/g, ' ').trim().slice(-220);
        if (w.podglad.textContent !== ogon) w.podglad.textContent = ogon;
      }
      w.podglad.hidden = !pisze;
      const powod = ws === 'blad' || ws === 'pominieta' || r.urwane ? powodRoli(r) : '';
      w.blad.textContent = powod;
      w.blad.hidden = !powod;
      // Akcje w trakcie: „Pomiń” dla roli, która jeszcze nie skończyła.
      // Serwer pomija tylko rolę, która już ruszyła (czekająca fala 2 nie ma czego przerwać).
      const pominDozwolone = o.zywy && o.naPomin && st.faza === 'role' && ws === 'pracuje';
      if (pominDozwolone && !w.akcje.firstChild) {
        w.akcje.append(przycisk('', t('ag.pomin'), () => { w.akcje.textContent = ''; o.naPomin(r.r); }, { 'aria-label': `${t('ag.pomin')}: ${nazwa}` }));
      } else if (!pominDozwolone && w.akcje.firstChild) w.akcje.textContent = '';
      w.akcje.hidden = !w.akcje.firstChild;
      // Pełny wkład po rozwinięciu (Markdown – ten sam, co w odpowiedzi).
      w.tresc.hidden = !otwartaRola;
      if (otwartaRola) {
        const zrodlo = widokWToku(r.tresc || '');
        if (w.trescZrodlo !== zrodlo) {
          w.trescZrodlo = zrodlo;
          w.tresc.innerHTML = zrodlo.trim() ? renderMarkdown(zrodlo) : '';
          if (!zrodlo.trim()) w.tresc.textContent = powodRoli(r) || t('ag.stan.' + ws);
        }
      }
    }

    function malujGlowe(teraz) {
      if (!glowa) return;
      const n = st.role.length;
      const dobieranie = !n && (st.faza === 'planowanie' || st.faza === '');
      sekcja.dataset.stan = dobieranie ? 'dobieranie' : o.zywy && st.faza !== 'koniec' ? 'praca'
        : st.role.some((r) => stanWidoku(r.stan) === 'blad') ? 'blad' : 'wynik';
      glowa.textContent = '';
      if (dobieranie) {
        glowa.append(h('span', { klasa: 'zespol-tytul zespol-dobieram', tekst: t('ag.dobieram') }));
        return;
      }
      if (!n) return;
      const glowaWnetrze = doc().createElement('span');
      glowaWnetrze.innerHTML = IK.zespol;
      glowa.append(glowaWnetrze.firstChild);
      glowa.append(h('span', { klasa: 'zespol-tytul', tekst: `${t('ag.zespol')} · ${ileRol(n)}` }));
      const kropki = h('span', { klasa: 'zespol-kropki', 'aria-hidden': 'true' });
      for (const r of st.role) kropki.append(h('i', { styl: `--k:${kolorSilnika(r.silnik)}` }));
      glowa.append(kropki);
      glowa.append(h('span', { klasa: 'zespol-kto', tekst: st.role.map(nazwaRoli).join(', ') }));
      const czas = o.zywy && st.faza === 'role'
        ? t('ag.postep', { g: ileSkonczonych(st), n, s: sekundy(teraz - st.start) })
        : o.zywy && st.faza === 'prowadzacy' ? t('ag.postep', { g: ileSkonczonych(st), n, s: sekundy(st.czasRol) })
          : `${sekundy(st.czasRol)} s`;
      glowa.append(h('span', { klasa: 'zespol-czas', tekst: czas }));
      const chev = doc().createElement('span');
      chev.innerHTML = IK.chev;
      glowa.append(chev.firstChild);
    }

    function malujDodatki() {
      if (!dodatki) return;
      dodatki.textContent = '';
      // Role odrzucone przed startem (auto: brak zgody, uprawnień, limitu).
      for (const x of st.odrzucone) {
        const klucz = ODRZUCONE_KLUCZ[x.kod];
        if (!klucz) continue;
        const wiersz = h('div', { klasa: 'zespol-odrzucone' },
          h('span', { tekst: t(klucz, { rola: nazwaRoli(x), silnik: nazwaSilnika(x.silnik || 'cloud') }) }));
        if (x.kod === 'wymaga-zgody' && o.naZgodaIPonow) wiersz.append(przycisk('zespol-link', t('ag.zgodaIPonow'), () => o.naZgodaIPonow()));
        dodatki.append(wiersz);
      }
      if (st.odmowa) dodatki.append(h('p', { klasa: 'zespol-nota', tekst: t('ag.odmowaLimit') }));
      dodatki.hidden = !dodatki.firstChild;
    }

    function malujStopke() {
      if (!stopka) return;
      stopka.textContent = '';
      if (o.zywy && st.faza === 'role' && o.naScal) {
        stopka.append(przycisk('zespol-link', t('ag.stopZespolu'), (e) => { e.currentTarget.disabled = true; o.naScal(); }));
      } else if (!o.zywy && st.role.length && o.naZmienSklad) {
        stopka.append(przycisk('zespol-link', t('ag.zmienSklad'), () => o.naZmienSklad()));
      }
      stopka.hidden = !stopka.firstChild;
    }

    function maluj() {
      klatka = 0;
      const teraz = Date.now();
      // Wiersze dochodzą, gdy przyjdzie skład (blok powstaje przy „planowaniu”).
      if (st.role.length && lista && lista.childElementCount !== st.role.length) {
        lista.textContent = ''; wiersze.clear();
        st.role.forEach((r, i) => lista.append(wierszRoli(r, i)));
        if (glowa && glowa.tagName !== 'BUTTON') { const nowa = zbudujGlowe(); sekcja.replaceChild(nowa, sekcja.querySelector('.zespol-glowa')); }
      }
      malujGlowe(teraz);
      // Stany wierszy zawsze (zwinięty blok też ma aktualne dane); tekst podglądu – tylko w otwartym.
      for (const r of st.role) { const w = wiersze.get(r.r); if (w) malujWiersz(r, w, teraz); }
      malujDodatki();
      malujStopke();
    }

    sekcja.append(sr, zbudujGlowe());
    lista = h('ol', { klasa: 'zespol-role', id: `${id}-role` });
    dodatki = h('div', { klasa: 'zespol-dodatki' });
    stopka = h('div', { klasa: 'zespol-stopka zespol-stopka-cicha' });
    sekcja.append(lista, dodatki, stopka);
    maluj();

    return {
      el: sekcja,
      /** Po zdarzeniu – malowanie najwyżej raz na klatkę (delty ról co 250 ms). */
      odswiez() {
        if (klatka) return;
        klatka = (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout)(maluj);
      },
      maluj,
      /** Prowadzący zaczyna pisać: blok zwija się do jednej linii, chyba że człowiek go dotknął. */
      zwin() { if (!dotkniety) ustawOtwarty(false); else maluj(); },
      oglos(tekst) { sr.textContent = ''; setTimeout(() => { sr.textContent = tekst; }, 30); },
      zakoncz() { o.zywy = false; maluj(); },
      get otwarty() { return otwarty; },
    };
  }

  /** Ogłoszenie z reduktora → zdanie dla czytnika ekranu. */
  function tekstOgloszenia(o, st) {
    const nazwa = (klucz) => nazwaRoli({ rola: klucz });
    if (o.klucz === 'ag.sr.start') return t('ag.sr.start', { role: o.role.map(nazwa).join(', ') });
    if (o.klucz === 'ag.sr.gotowa') return t('ag.sr.gotowa', { rola: nazwa(o.rola), g: o.g, n: o.n });
    if (o.klucz === 'ag.sr.blad') return t('ag.sr.blad', { rola: nazwa(o.rola), powod: t('ag.stan.' + o.stan) });
    if (o.klucz === 'ag.sr.sklada') return t('ag.sr.sklada', { silnik: nazwaSilnika((st.prowadzacy || {}).silnik || 'cloud') });
    return '';
  }

  /** Nota pod odpowiedzią: „Bez wkładu: Recenzent. Ponów zespołem”. */
  function notaBezWkladu(st, naPonow) {
    // Pominięta ręcznie, scalona na prośbę, zatrzymana – to decyzja człowieka, nie awaria.
    const bez = roleBezWkladu(st).filter((r) => r.stan !== 'pominieta' && !['pominieta', 'scalono', 'zatrzymana'].includes(r.kod));
    if (!bez.length) return null;
    const p = h('p', { klasa: 'zespol-nota', tekst: t('ag.bezWkladu', { role: bez.map(nazwaRoli).join(', ') }) });
    if (naPonow) p.append(przycisk('zespol-link', t('ag.ponowZespolem'), naPonow));
    return p;
  }

  /** Prowadzący nie złożył odpowiedzi – wkład zostaje, jedna akcja. */
  function bladScalenia(silnik, naZloz) {
    const d = h('div', { klasa: 'zespol-blad-scalenia' }, h('span', { tekst: t('ag.bladScalenia', { silnik: nazwaSilnika(silnik) }) }));
    if (naZloz) d.append(przycisk('zespol-link', t('ag.zlozPonownie'), naZloz));
    return d;
  }

  // -------------------------------------------------------------------------
  // „Proponuj, gdy warto” – cicha linijka pod odpowiedzią solo
  // -------------------------------------------------------------------------

  function sugestia(prop, { naUruchom, naZmien, naNieTeraz }) {
    const d = h('div', { klasa: 'zespol-sugestia', role: 'group', 'aria-label': t('ag.sugestia') });
    const ik = doc().createElement('span');
    ik.innerHTML = IK.zespol;
    d.append(ik.firstChild, h('span', { tekst: t('ag.sugestia') }));
    for (const r of prop.role) {
      d.append(h('span', { klasa: 'kto', styl: `--k:${kolorSilnika(r.silnik)}` }, h('i'), `${nazwaRoli(r)} · ${nazwaSilnika(r.silnik)}`));
    }
    d.append(przycisk('zespol-link zespol-uruchom', t('ag.uruchom'), naUruchom, { title: t('ag.uruchomTitle') }));
    d.append(przycisk('zespol-link zespol-zmien', t('ag.zmien'), naZmien));
    d.append(przycisk('zamknij', '', naNieTeraz, { 'aria-label': t('ag.nieTeraz'), title: t('ag.nieTeraz'), ikona: IK.x }));
    return d;
  }

  // -------------------------------------------------------------------------
  // Propozycja składu przed startem (bramka zgody + edycja)
  // -------------------------------------------------------------------------

  /**
   * @param {object} p
   * @param {Array}  p.role          [{rola, zadanie, silnik, model, auto?}]
   * @param {object} p.prowadzacy    {silnik, model}
   * @param {boolean} p.pytajOZgode  prowadzący lokalny i brak zgody na rozmowę
   * @param {Array}  p.lokalnie      skład „Tylko lokalnie” (z planu) albo null
   * @param {number} p.maxRol
   * @param {Array}  p.katalog       [{klucz, wymagaObrazu}]
   * @param {Function} p.otworzEdytor (rola, przycisk, gotowe) => void
   * @param {Function} p.naStart     ({role, zgoda}) => void
   * @param {Function} p.naTylkoLokalnie (role) => void
   * @param {Function} p.naBez       () => void
   */
  function propozycja(p) {
    let role = p.role.map((r, i) => ({ ...r, r: r.r || `p${i + 1}` }));
    const sekcja = h('section', { klasa: 'zespol', 'data-stan': 'propozycja', 'data-otwarty': 'true', 'aria-label': t('ag.zespol'), 'aria-live': 'off' });
    const sr = h('p', { klasa: 'zespol-sr', role: 'status' });
    const glowa = h('div', { klasa: 'zespol-glowa' });
    const lista = h('ol', { klasa: 'zespol-role' });
    const stopka = h('div', { klasa: 'zespol-stopka' });
    sekcja.append(sr, glowa, lista, stopka);

    function maluj() {
      glowa.textContent = '';
      const ik = doc().createElement('span');
      ik.innerHTML = IK.zespol;
      glowa.append(ik.firstChild, h('span', { klasa: 'zespol-tytul', tekst: `${t('ag.zespol')} · ${ileRol(role.length)}` }));
      const kropki = h('span', { klasa: 'zespol-kropki', 'aria-hidden': 'true' });
      for (const r of role) kropki.append(h('i', { styl: `--k:${kolorSilnika(r.silnik)}` }));
      glowa.append(kropki);
      lista.textContent = '';
      role.forEach((r) => {
        const nazwa = nazwaRoli(r);
        const li = h('li', { klasa: 'rola', 'data-r': r.r, 'data-rola': r.rola, 'data-silnik': r.silnik, 'data-stan': 'czeka' });
        const btn = h('button', { type: 'button', klasa: 'rola-model-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
          'aria-label': `${t('ag.zmienModel', { rola: nazwa })}: ${nazwaSilnika(r.silnik)} ${krotkiModel(r.model)}` },
        h('span', { klasa: 'rola-silnik', tekst: nazwaSilnika(r.silnik) }), krotkiModel(r.model) || t('ag.set.auto'));
        btn.addEventListener('click', () => {
          btn.setAttribute('aria-expanded', 'true');
          p.otworzEdytor(r, btn, (wybor) => {
            btn.setAttribute('aria-expanded', 'false');
            if (!wybor) return;
            if (wybor.usun) { role = role.filter((x) => x !== r); maluj(); return; }
            Object.assign(r, wybor.auto ? { auto: true } : { auto: false, silnik: wybor.silnik, model: wybor.model });
            maluj();
          });
        });
        const wiersz = h('div', { klasa: 'rola-wiersz', title: r.zadanie || '' },
          h('span', { klasa: 'rola-nazwa', tekst: nazwa }), btn,
          przycisk('rola-usun', '', () => { role = role.filter((x) => x !== r); maluj(); }, { 'aria-label': t('ag.usun', { rola: nazwa }), ikona: IK.x }));
        li.append(h('span', { klasa: 'rola-kropka', 'aria-hidden': 'true' }), wiersz);
        lista.append(li);
      });
      stopka.textContent = '';
      // Dodaj rolę – z katalogu, bez powtórzeń, do limitu.
      const wolne = (p.katalog || []).filter((k) => !role.some((r) => r.rola === k.klucz));
      if (wolne.length && role.length < p.maxRol) {
        const dodaj = h('button', { type: 'button', klasa: 'zespol-dodaj', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
        dodaj.innerHTML = IK.plus;
        dodaj.append(t('ag.dodaj'));
        const menu = h('div', { klasa: 'zespol-dodaj-menu', role: 'menu', hidden: true });
        for (const k of wolne) {
          menu.append(przycisk('zespol-dodaj-opcja', nazwaRoli({ rola: k.klucz }), () => {
            role.push({ rola: k.klucz, zadanie: '', silnik: p.prowadzacy.silnik, model: p.prowadzacy.model, auto: true, r: `p${Date.now()}` });
            maluj();
          }, { role: 'menuitem' }));
        }
        dodaj.addEventListener('click', () => { menu.hidden = !menu.hidden; dodaj.setAttribute('aria-expanded', String(!menu.hidden)); });
        stopka.append(dodaj, menu);
      }
      const chmura = silnikiChmury(role.filter((r) => !r.auto));
      const zgodaPotrzebna = p.pytajOZgode && chmura.length > 0;
      if (zgodaPotrzebna) {
        const zg = h('div', { klasa: 'zespol-zgoda' });
        zg.innerHTML = IK.chmura;
        const tekst = h('div');
        // Zdanie z pogrubieniem ze słownika (stały tekst), nazwy silników – ze stałej listy.
        tekst.innerHTML = t('ag.zgodaChmura', { silniki: chmura.map((s) => nazwaSilnika(s)).join(', ') });
        tekst.append(h('small', { tekst: t('ag.zgodaPamietam') }));
        zg.append(tekst);
        stopka.append(zg);
      }
      const przyciski = h('div', { klasa: 'zespol-przyciski' });
      przyciski.append(przycisk('btn-ghost', t('ag.bez'), () => p.naBez()));
      if (zgodaPotrzebna && p.lokalnie) przyciski.append(przycisk('btn-secondary', t('ag.tylkoLokalnie'), () => p.naTylkoLokalnie(p.lokalnie)));
      const start = przycisk('btn-primary', t('ag.start'), () => p.naStart({ role, zgoda: zgodaPotrzebna }));
      start.disabled = !role.length;
      przyciski.append(start);
      stopka.append(przyciski);
    }
    maluj();
    setTimeout(() => { sr.textContent = t('ag.sr.czeka'); }, 60);
    return { el: sekcja, get role() { return role; } };
  }

  // -------------------------------------------------------------------------
  // Edytor modelu roli – okienko przy przycisku (komputer), arkusz od dołu (telefon)
  // -------------------------------------------------------------------------

  /**
   * @param {object} e
   * @param {string} e.tytul
   * @param {Array}  e.grupy         [{silnik, modele:[{id, podpis}]}]
   * @param {object} e.wybrany       {silnik, model} albo null (Auto)
   * @param {string} e.autoPodpis
   * @param {Array}  e.bezDostepu    silniki, których osoba nie ma (członek)
   * @param {boolean} e.zUsun
   * @param {HTMLElement} e.kotwica
   * @param {Function} e.gotowe      (wybor|null) => void
   */
  function edytor(e) {
    for (const stary of doc().querySelectorAll('.rola-edytor, .re-tlo')) stary.remove();
    const tlo = h('div', { klasa: 're-tlo' });
    const okno = h('div', { klasa: 'rola-edytor', role: 'dialog', 'aria-modal': 'true', 'aria-label': e.tytul });
    const zamknij = (wybor) => {
      okno.remove(); tlo.remove();
      doc().removeEventListener('keydown', klawisz, true);
      doc().removeEventListener('pointerdown', poza, true);
      if (e.kotwica && e.kotwica.isConnected) e.kotwica.focus();
      e.gotowe(wybor || null);
    };
    const klawisz = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); zamknij(null); } };
    const poza = (ev) => { if (!okno.contains(ev.target) && ev.target !== e.kotwica) zamknij(null); };
    const glowa = h('div', { klasa: 're-glowa' }, h('h4', { tekst: e.tytul }),
      przycisk('icon-btn', '', () => zamknij(null), { 'aria-label': t('ag.re.zamknij'), ikona: IK.x }));
    const lista = h('div', { klasa: 're-lista', role: 'listbox', 'aria-label': t('ag.re.model') }, h('div', { klasa: 'model-lista-glowa', tekst: t('ag.re.model') }));
    let wybor = e.wybrany ? { ...e.wybrany } : { auto: true };
    const opcja = (nazwa, podpis, zaznaczona, na, auto = false) => {
      const b = h('button', { type: 'button', klasa: `model-opcja${zaznaczona ? ' wybrany' : ''}`, role: 'option', 'aria-selected': String(zaznaczona) },
        h('span', { klasa: `model-opcja-nazwa${auto ? ' auto' : ''}`, tekst: nazwa }), h('span', { klasa: 'model-opcja-podpis', tekst: podpis || '' }));
      b.addEventListener('click', () => {
        for (const x of lista.querySelectorAll('.model-opcja')) { x.classList.remove('wybrany'); x.setAttribute('aria-selected', 'false'); }
        b.classList.add('wybrany'); b.setAttribute('aria-selected', 'true');
        na();
      });
      return b;
    };
    lista.append(opcja(t('ag.re.auto'), e.autoPodpis || '', !e.wybrany, () => { wybor = { auto: true }; }, true));
    for (const g of e.grupy) {
      if (!g.modele.length) continue;
      lista.append(h('div', { klasa: 're-grupa', 'data-silnik': g.silnik, tekst: nazwaSilnika(g.silnik) }));
      const kontener = h('div', { 'data-silnik': g.silnik });
      for (const m of g.modele) {
        const zazn = Boolean(e.wybrany && e.wybrany.silnik === g.silnik && e.wybrany.model === m.id);
        kontener.append(opcja(m.id, m.podpis, zazn, () => { wybor = { silnik: g.silnik, model: m.id }; }));
      }
      lista.append(kontener);
    }
    if (e.bezDostepu && e.bezDostepu.length) {
      const brak = h('div', { klasa: 're-brak' });
      brak.innerHTML = IK.klodka;
      brak.append(h('span', { tekst: t('ag.re.brak', { silniki: e.bezDostepu.map(nazwaSilnika).join(', ') }) }));
      lista.append(brak);
    }
    const stopka = h('div', { klasa: 're-stopka' });
    if (e.zUsun) stopka.append(przycisk('re-usun', t('ag.re.usun'), () => zamknij({ usun: true })));
    stopka.append(przycisk('btn-primary', t('ag.re.gotowe'), () => zamknij(wybor)));
    okno.append(glowa, lista, stopka);
    doc().body.append(tlo, okno);
    // Komputer: okienko przy przycisku; telefon (≤ 600 px) – arkusz od dołu (CSS).
    if (e.kotwica && window.innerWidth > 600) {
      const r = e.kotwica.getBoundingClientRect();
      okno.style.position = 'fixed';
      okno.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - okno.offsetWidth - 12))}px`;
      const dol = r.bottom + 6;
      okno.style.top = `${Math.max(12, dol + okno.offsetHeight > window.innerHeight - 12 ? r.top - okno.offsetHeight - 6 : dol)}px`;
    }
    doc().addEventListener('keydown', klawisz, true);
    setTimeout(() => doc().addEventListener('pointerdown', poza, true), 0);
    (lista.querySelector('.model-opcja.wybrany') || lista.querySelector('.model-opcja'))?.focus();
    return { el: okno, zamknij };
  }

  // -------------------------------------------------------------------------
  // Ustawienia → Agenci
  // -------------------------------------------------------------------------

  /**
   * @param {object} k
   * @param {object} k.us          {tryb, maxRol, zgodaChmura, role}
   * @param {number} k.sufit       maxRolSufit
   * @param {boolean} k.potwierdzaj
   * @param {Array}  k.katalog     klucze ról
   * @param {Array}  k.bezDostepu  silniki bez dostępu (członek)
   * @param {Function} k.naZmiane  (zmiana) => void  – {tryb}|{maxRol}|{zgodaChmura}|{role}|{potwierdzaj}
   * @param {Function} k.otworzEdytor (rolaKlucz, przycisk, gotowe)
   */
  function panelUstawien(k) {
    const kontener = h('div', { klasa: 'ag-panel' });
    const trybSekcja = h('section', { klasa: 'set-sekcja field', 'data-karta': 'agenci' },
      h('h3', { tekst: t('ag.set.h') }), h('p', { klasa: 'set-sekcja-opis', tekst: t('ag.set.opis') }));
    const fs = h('fieldset', { klasa: 'ag-tryby' }, h('legend', { klasa: 'field-hint ag-legenda', tekst: t('ag.set.kiedy') }));
    for (const tryb of ['wylaczony', 'prosba', 'proponuj', 'sam']) {
      const input = h('input', { type: 'radio', name: 'ag-tryb', value: tryb });
      input.checked = k.us.tryb === tryb;
      input.addEventListener('change', () => { if (input.checked) k.naZmiane({ tryb }); });
      const tytul = h('span', { tekst: t('ag.set.tryb.' + tryb) });
      if (tryb === 'proponuj') tytul.append(h('span', { klasa: 'domyslne', tekst: t('ag.set.domyslne') }));
      fs.append(h('label', { klasa: 'ag-tryb' }, input, h('span', { klasa: 'kolko', 'aria-hidden': 'true' }),
        h('span', { klasa: 'set-wiersz-tekst' }, tytul, h('span', { klasa: 'field-hint', tekst: t('ag.set.tryb.' + tryb + 'Hint') }))));
    }
    trybSekcja.append(fs, h('p', { klasa: 'field-hint ag-glos-nota', tekst: t('ag.set.glosNota') }));

    const przel = (klucz, kluczHint, wlaczony, na) => {
      const input = h('input', { type: 'checkbox' });
      input.checked = wlaczony;
      input.addEventListener('change', () => na(input.checked));
      return h('label', { klasa: 'set-wiersz zm-przelacznik' },
        h('span', { klasa: 'set-wiersz-tekst' }, h('span', { tekst: t(klucz) }), h('span', { klasa: 'field-hint', tekst: t(kluczHint) })),
        input, h('span', { klasa: 'zm-suwak', 'aria-hidden': 'true' }));
    };
    const startSekcja = h('section', { klasa: 'set-sekcja field', 'data-karta': 'agenci' }, h('h3', { tekst: t('ag.set.start.h') }),
      przel('ag.set.potwierdzaj', 'ag.set.potwierdzajHint', k.potwierdzaj, (v) => k.naZmiane({ potwierdzaj: v })),
      przel('ag.set.zgodaStala', 'ag.set.zgodaStalaHint', k.us.zgodaChmura, (v) => k.naZmiane({ zgodaChmura: v })));
    const segment = h('span', { klasa: 'ag-segment', role: 'group', 'aria-label': t('ag.set.maks') });
    for (let n = 2; n <= Math.max(2, Math.min(4, k.sufit)); n++) {
      const b = przycisk('', String(n), () => k.naZmiane({ maxRol: n }), { 'aria-pressed': String(k.us.maxRol === n) });
      segment.append(b);
    }
    startSekcja.append(h('div', { klasa: 'set-wiersz' },
      h('span', { klasa: 'set-wiersz-tekst' }, h('span', { tekst: t('ag.set.maks') }), h('span', { klasa: 'field-hint', tekst: t('ag.set.maksHint') })), segment));

    const roleSekcja = h('section', { klasa: 'set-sekcja field', 'data-karta': 'agenci' },
      h('h3', { tekst: t('ag.set.role.h') }), h('p', { klasa: 'set-sekcja-opis', tekst: t('ag.set.role.opis') }));
    const ul = h('ul', { klasa: 'ag-role' });
    for (const klucz of k.katalog) {
      const przyp = k.us.role && k.us.role[klucz];
      const btn = h('button', { type: 'button', klasa: `rola-model-btn${przyp ? '' : ' auto'}`, 'aria-haspopup': 'listbox',
        'aria-label': `${t('ag.zmienModel', { rola: nazwaRoli({ rola: klucz }) })}: ${przyp ? `${nazwaSilnika(przyp.silnik)} ${przyp.model}` : t('ag.set.auto')}`,
        ...(przyp ? { 'data-silnik': przyp.silnik } : {}) });
      if (przyp) btn.append(h('i'), krotkiModel(przyp.model) || nazwaSilnika(przyp.silnik));
      else btn.append(t('ag.set.auto'));
      btn.addEventListener('click', () => k.otworzEdytor(klucz, btn, (wybor) => {
        if (!wybor) return;
        const role = { ...(k.us.role || {}) };
        if (wybor.auto) delete role[klucz]; else role[klucz] = { silnik: wybor.silnik, model: wybor.model };
        k.naZmiane({ role });
      }));
      ul.append(h('li', { klasa: 'ag-rola', 'data-rola': klucz },
        h('span', { klasa: 'set-wiersz-tekst' }, h('span', { tekst: nazwaRoli({ rola: klucz }) }), h('span', { klasa: 'field-hint', tekst: t('ag.rola.' + klucz + '.opis') })),
        btn));
    }
    roleSekcja.append(ul);
    if (k.bezDostepu && k.bezDostepu.length) {
      const brak = h('div', { klasa: 're-brak ag-brak' });
      brak.innerHTML = IK.klodka;
      brak.append(h('span', { tekst: t('ag.re.brak', { silniki: k.bezDostepu.map(nazwaSilnika).join(', ') }) }));
      roleSekcja.append(brak);
    }
    kontener.append(trybSekcja, startSekcja, roleSekcja);
    return kontener;
  }

  // -------------------------------------------------------------------------
  // Tryb głosowy: kropki ról pod kulą, status „ZESPÓŁ · 2 Z 3”
  // -------------------------------------------------------------------------

  function kropkiGlosu(st) {
    const d = h('div', { klasa: 'voice-zespol', role: 'group', 'aria-label': t('ag.zespol') });
    for (const r of st.role) {
      const ws = stanWidoku(r.stan);
      d.append(h('span', { klasa: 'vz-rola', 'data-silnik': r.silnik, 'data-stan': ws === 'gotowe' ? 'gotowe' : ws === 'pracuje' ? 'pracuje' : 'czeka' },
        h('i'), nazwaRoli(r)));
    }
    return d;
  }
  function statusGlosu(st) {
    if (st.faza === 'prowadzacy') return t('ag.glos.sklada');
    if (st.faza === 'role') return t('ag.glos.pracuje', { g: ileSkonczonych(st), n: st.role.length });
    return '';
  }

  return {
    blokZespolu, tekstOgloszenia, notaBezWkladu, bladScalenia, sugestia, propozycja, edytor, panelUstawien,
    kropkiGlosu, statusGlosu, nazwaRoli, ikonaZespolu: IK.zespol,
  };
}

const CZYSTE_ZESPOLU = {
  stanWidoku, nowyStanTury, zjedzZdarzenieZespolu, wiadomoscNotatek, stanZWiadomosci, roleBezWkladu,
  skladDoWyslania, silnikiChmury, skladZaZgoda, turaMaNotatki, ileSkonczonych, czekaNaZgode, KONCOWE_STANY_ROLI, SILNIKI_ZESPOLU,
};

if (typeof window !== 'undefined') Object.assign(window, { utworzZespolWidok, ZESPOL: CZYSTE_ZESPOLU });
if (typeof module !== 'undefined') module.exports = { utworzZespolWidok, ...CZYSTE_ZESPOLU };

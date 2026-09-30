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
  budzet: 'ag.odrzuconeBudzet',
  'budzet-dzienny': 'ag.odrzuconeBudzet',
  'budzet-miesieczny': 'ag.odrzuconeBudzet',
  'budzet-wyczerpany': 'ag.odrzuconeBudzet',
  // Wariant „Darmowe modele” (K5): rola bez darmowego silnika.
  'tylko-darmowe': 'ag.odrzuconeDarmowe',
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
/** Kwota w zł z serwera (liczba ≥ 0) albo undefined. */
const kwota = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x * 10000) / 10000 : undefined);
/* Płatne silniki – cennik liczy tylko je (NVIDIA w chmurze i lokalny GPU: 0 zł). */
const PLATNE_ZESPOLU = ['openai', 'claude'];
/** Najwięcej ról w jednym stanie: sufit właściciela 5 + poprawka programisty (fala 3) + zapas. */
const MAX_ROL_WIDOKU = 10;

/** Rola WŁASNA osoby: id „w-…” nadaje serwer, nazwę i instrukcję – człowiek
 *  (Ustawienia → Agenci). Nazwa idzie na ekran tylko przez textContent. */
const czyWlasnaRola = (r) => Boolean(r && (r.wlasna === true || /^w-/.test(String(r.rola || r.klucz || ''))));

/** Pola kosztu i fali, które przechodzą bez zmian przez zdarzenia, zapis i odczyt. */
function dodatkiRoli(r) {
  const o = {};
  if (r.wlasna === true || czyWlasnaRola(r)) o.wlasna = true;
  if (r.fala === 1 || r.fala === 2 || r.fala === 3) o.fala = r.fala;
  if (r.fala === 3 && typeof r.poprawkaZ === 'string') o.poprawkaZ = r.poprawkaZ.slice(0, 20);
  if (kwota(r.szacunekZl) !== undefined) o.szacunekZl = kwota(r.szacunekZl);
  if (kwota(r.kosztZl) !== undefined) o.kosztZl = kwota(r.kosztZl);
  if (r.kosztSzacowany === true) o.kosztSzacowany = true;
  return o;
}
/** `powod` z serwera bywa listą kodów po przecinku („budzet,wymaga-zgody”). */
const maPowod = (r, kod) => String((r && r.powod) || '').split(',').map((x) => x.trim()).includes(kod);
/** Miejsce i czas planu dla fotografa – idą z powrotem ze składem od osoby. */
const miejsceIKiedy = (d) => ({ ...(typeof d.miejsce === 'string' && d.miejsce ? { miejsce: d.miejsce.slice(0, 120) } : {}),
  ...(typeof d.kiedy === 'string' && d.kiedy ? { kiedy: d.kiedy.slice(0, 60) } : {}) });

/** Pusty stan tury zespołu. */
function nowyStanTury(teraz = Date.now()) {
  return {
    faza: '', start: teraz, zrodlo: '', prowadzacy: null, role: [], odrzucone: [], daneWyjdaDo: [],
    szukaj: '', notatki: '', czasRol: 0, czasFazy: 0, odmowa: null, propozycja: null, bylSklad: false,
    wymagaZgody: false, silnikiZaZgoda: [], szacunekZl: undefined, kosztZl: undefined, miejsce: '', kiedy: '',
  };
}

function roleZDanych(lista) {
  return (Array.isArray(lista) ? lista : []).filter((r) => r && typeof r === 'object').slice(0, MAX_ROL_WIDOKU).map((r, i) => ({
    r: napis(r.r, 20) || `r${i + 1}`,
    rola: napis(r.rola, 40),
    nazwa: napis(r.nazwa, 60),
    zadanie: napis(r.zadanie, 1000),
    silnik: silnikZespolu(r.silnik),
    model: napis(r.model, 200),
    ...(r.zamiast && typeof r.zamiast === 'object' ? { zamiast: { silnik: silnikZespolu(r.zamiast.silnik), model: napis(r.zamiast.model, 200) } } : {}),
    ...(typeof r.powod === 'string' ? { powod: r.powod.slice(0, 200) } : {}),
    ...dodatkiRoli(r),
  }));
}

function odrzuconeZDanych(lista) {
  return (Array.isArray(lista) ? lista : []).filter((o) => o && typeof o === 'object').slice(0, MAX_ROL_WIDOKU)
    .map((o) => ({ rola: napis(o.rola, 40), kod: napis(o.kod, 40), ...(o.silnik ? { silnik: silnikZespolu(o.silnik) } : {}),
      ...(typeof o.nazwa === 'string' ? { nazwa: napis(o.nazwa, 60) } : {}) }));
}

/** `wymagaZgody` z serwera: true albo 'chmura' (trasa planu), fałsz – wszystko inne. */
const wymagaZgodyZ = (x) => x === true || x === 'chmura';

/* ---------------------------------------------------------------------------
   Skład „Darmowe modele” (K5, runda 10). Serwer liczy z tego samego planu drugi
   wariant – te same role na chmurze NVIDIA i lokalnym GPU – i oddaje go obok
   proponowanego: `darmowe: {role, odrzucone, szacunekZl, prowadzacyPlatny}`,
   `skladDomyslny` (ustawienie osoby) i `kandydaci` (modele do edytora roli).
   --------------------------------------------------------------------------- */

/** Wariant darmowy z serwera → {role, odrzucone, prowadzacyPlatny, szacunekZl?, szacunekProwadzacyZl?} albo null. */
function wariantDarmowy(d) {
  if (!d || typeof d !== 'object') return null;
  const role = roleZDanych(d.role);
  if (!role.length) return null;
  return {
    role, odrzucone: odrzuconeZDanych(d.odrzucone), prowadzacyPlatny: d.prowadzacyPlatny === true,
    ...(kwota(d.szacunekZl) !== undefined ? { szacunekZl: kwota(d.szacunekZl) } : {}),
    ...(kwota(d.szacunekProwadzacyZl) !== undefined ? { szacunekProwadzacyZl: kwota(d.szacunekProwadzacyZl) } : {}),
  };
}

/** Modele do edytora roli z serwera: {rola: [{silnik, model, darmowy}]} – tylko znane silniki, najwyżej 8 na rolę. */
function kandydaciZDanych(d) {
  if (!d || typeof d !== 'object') return null;
  const wynik = {};
  for (const [rola, lista] of Object.entries(d).slice(0, MAX_ROL_WIDOKU)) {
    if (!Array.isArray(lista)) continue;
    const ok = lista.filter((k) => k && SILNIKI_ZESPOLU.includes(k.silnik) && typeof k.model === 'string' && k.model).slice(0, 8)
      .map((k) => ({ silnik: k.silnik, model: napis(k.model, 200), darmowy: !PLATNE_ZESPOLU.includes(k.silnik) }));
    if (ok.length) wynik[napis(rola, 40)] = ok;
  }
  return Object.keys(wynik).length ? wynik : null;
}

/**
 * Skład, od którego startuje bramka albo linijka „Mogę to sprawdzić zespołem”:
 * przy ustawieniu „Darmowe modele” i istniejącym wariancie darmowym – darmowy,
 * inaczej proponowany. `sklad` – `plan.sklad` z /api/zespol/plan albo stan
 * propozycji z reduktora (oba mają role, darmowe, skladDomyslny, szacunekZl).
 * @returns {{wariant: 'proponowany'|'darmowe', role: Array, szacunekZl: (number|undefined), tylkoDarmowe: boolean}}
 */
function skladStartowy(sklad) {
  const s = sklad && typeof sklad === 'object' ? sklad : {};
  const darmowe = wariantDarmowy(s.darmowe);
  if (s.skladDomyslny === 'darmowy' && darmowe) {
    return { wariant: 'darmowe', role: darmowe.role, odrzucone: darmowe.odrzucone, szacunekZl: darmowe.szacunekZl, tylkoDarmowe: true };
  }
  return { wariant: 'proponowany', role: roleZDanych(s.role), odrzucone: odrzuconeZDanych(s.odrzucone), szacunekZl: kwota(s.szacunekZl),
    tylkoDarmowe: s.tylkoDarmowe === true };
}

/** Wszystkie role na modelu prowadzącego – „zespół” to jeden model w kilku czapkach. */
const jedenModel = (role, prowadzacy) => Boolean(prowadzacy && (role || []).length
  && role.every((r) => r && r.silnik === prowadzacy.silnik && r.model === prowadzacy.model));

/** „0 zł” tylko, gdy CAŁA tura nic nie kosztuje (copywriter, agencja-ux): kwota 0 albo brak cennika przy darmowym prowadzącym. */
const zeroZl = (w) => Boolean(w && (w.szacunekZl === 0 || (w.szacunekZl === undefined && !w.prowadzacyPlatny)));

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
      const darmowe = wariantDarmowy(d.darmowe);
      const kandydaci = kandydaciZDanych(d.kandydaci);
      st.propozycja = role.length ? {
        role, odrzucone: odrzuconeZDanych(d.odrzucone),
        prowadzacy: d.prowadzacy && typeof d.prowadzacy === 'object' ? { silnik: silnikZespolu(d.prowadzacy.silnik), model: napis(d.prowadzacy.model, 200) } : null,
        daneWyjdaDo: Array.isArray(d.daneWyjdaDo) ? d.daneWyjdaDo.map((x) => napis(x, 40)) : [],
        ...(kwota(d.szacunekZl) !== undefined ? { szacunekZl: kwota(d.szacunekZl) } : {}),
        ...(kwota(d.szacunekProwadzacyZl) !== undefined ? { szacunekProwadzacyZl: kwota(d.szacunekProwadzacyZl) } : {}),
        // K5: wariant darmowy i ustawienie osoby – linijka pokazuje skład startowy (skladStartowy).
        ...(darmowe ? { darmowe } : {}), ...(d.skladDomyslny === 'darmowy' ? { skladDomyslny: 'darmowy' } : {}),
        ...(kandydaci ? { kandydaci } : {}),
        ...miejsceIKiedy(d),
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
    // Tryb głosowy: rola w chmurze przy lokalnym prowadzącym czeka na zgodę (pytanie głosem).
    st.wymagaZgody = wymagaZgodyZ(d.wymagaZgody);
    // Silniki, na które skład poszedłby za zgodą (do pytania głosem): tylko znane nazwy.
    st.silnikiZaZgoda = Array.isArray(d.silnikiZaZgoda) ? [...new Set(d.silnikiZaZgoda.filter((x) => SILNIKI_ZESPOLU.includes(x) && x !== 'local'))] : [];
    st.szacunekZl = kwota(d.szacunekZl);
    // Tura na samych darmowych modelach (K5) – strażnik nie wpuścił płatnego silnika.
    st.tylkoDarmowe = d.tylkoDarmowe === true;
    Object.assign(st, { miejsce: '', kiedy: '' }, miejsceIKiedy(d));
    if (st.role.length) {
      st.faza = 'role';
      ogl.push({ klucz: 'ag.sr.start', role: st.role.map((r) => r.rola) });
    } else if (st.faza === 'planowanie') st.faza = 'bez-rol';
    return ogl;
  }
  if (typ === 'rola') {
    let r = st.role.find((x) => x.r === d.r);
    /* Fala 3 – poprawka kodu po recenzji: nowa rola, której nie było w składzie.
       Serwer zapowiada ją pierwszym zdarzeniem z `fala:3` i `poprawkaZ`
       (r programisty); wiersz staje na końcu, pod recenzentem. */
    if (!r && d.fala === 3 && typeof d.r === 'string' && d.r && st.role.some((x) => x.r === d.poprawkaZ) && st.role.length < MAX_ROL_WIDOKU) {
      const zrodlo = st.role.find((x) => x.r === d.poprawkaZ);
      r = { ...roleZDanych([{ ...d, rola: d.rola || zrodlo.rola, nazwa: d.nazwa || zrodlo.nazwa, silnik: d.silnik || zrodlo.silnik, model: d.model || zrodlo.model }])[0],
        stan: 'czeka', tresc: '', ms: 0, start: 0 };
      st.role.push(r);
    }
    if (!r) return ogl;
    if (kwota(d.kosztZl) !== undefined) r.kosztZl = kwota(d.kosztZl);
    if (d.kosztSzacowany === true) r.kosztSzacowany = true;
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
      /* Poprawka po recenzji (fala 3) to druga runda tej samej roli – bez
         osobnego ogłoszenia; „N z M” liczy skład (czytnik nie słyszy „3 z 3”
         po „2 z 2”). Jej koniec i tak ogłasza „Zespół skończył”. */
      if (KONCOWE_STANY_ROLI.has(r.stan) && byl !== jest && r.fala !== 3) {
        const sklad = skladBezPoprawki(st);
        const gotowe = sklad.filter((x) => KONCOWE_STANY_ROLI.has(x.stan)).length;
        ogl.push(jest === 'gotowe' ? { klucz: 'ag.sr.gotowa', rola: r.rola, g: gotowe, n: sklad.length }
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
    if (kwota(d.kosztZl) !== undefined) st.kosztZl = kwota(d.kosztZl);
    // C5: fotograf dostał policzony plan – [PLAN:] prowadzącego nie liczy drugiego (narzedzia.js).
    if (d.planPoliczony === true) st.planPoliczony = true;
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
/** Role składu – bez poprawki po recenzji (fala 3, druga runda programisty). */
const skladBezPoprawki = (st) => st.role.filter((r) => r.fala !== 3);

/** Koszt odpowiedzi prowadzącego (zdarzenie `koniec`, C2) – do „cała odpowiedź”. */
function kosztProwadzacego(st, zl, szacowany = false) {
  if (!st || kwota(zl) === undefined) return;
  st.kosztProwadzacegoZl = kwota(zl);
  if (szacowany) st.kosztProwadzacegoSzac = true;
}
/** Czy koszt tury to (choć w części) szacunek – wtedy „ok.”. */
const kosztSzacowany = (st) => Boolean(st.kosztProwadzacegoSzac || st.role.some((r) => r.kosztSzacowany));
/** Cała odpowiedź: role + planista (faza) + prowadzący; undefined, gdy nic nie wiadomo. */
function kosztCaly(st) {
  const r = kosztTury(st);
  const p = kwota(st.kosztProwadzacegoZl);
  if (r === undefined && p === undefined) return undefined;
  return kwota((r || 0) + (p || 0));
}

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
    // Poprawka (fala 3) to nie osobna rola – następna tura widziała „Programista, Recenzent, Programista”.
    searchQuery: `praca zespołu: ${skladBezPoprawki(st).map((r) => r.nazwa || r.rola).join(', ') || 'bez ról'}`,
    content: st.notatki || '',
    zespol: {
      v: 1, zrodlo: st.zrodlo, prowadzacy: st.prowadzacy,
      wklady: st.role.map((r) => ({
        r: r.r, rola: r.rola, nazwa: r.nazwa, silnik: r.silnik, model: r.model,
        stan: KONCOWE_STANY_ROLI.has(r.stan) ? r.stan : (r.tresc ? 'niedokonczona' : 'przerwana'),
        tresc: r.tresc.slice(0, 8000), ms: r.ms || (r.start ? teraz - r.start : 0),
        ...(r.blad ? { blad: r.blad } : {}), ...(r.urwane ? { urwane: true } : {}), ...(r.kod ? { kod: r.kod } : {}),
        ...(r.zamiast ? { zamiast: r.zamiast } : {}), ...(r.powod ? { powod: r.powod } : {}), ...(r.zapas ? { zapas: r.zapas } : {}),
        ...dodatkiRoli(r),
      })),
      odrzucone: st.odrzucone,
      czas: { role: st.czasRol || (teraz - st.start), calosc: teraz - st.start },
      daneWyjdaDo: st.daneWyjdaDo,
      ...(st.szukaj ? { szukaj: st.szukaj } : {}),
      ...(kosztTury(st) !== undefined ? { kosztZl: kosztTury(st) } : {}),
      ...(kwota(st.kosztProwadzacegoZl) !== undefined ? { kosztProwadzacegoZl: kwota(st.kosztProwadzacegoZl) } : {}),
      ...(st.kosztProwadzacegoSzac ? { kosztProwadzacegoSzac: true } : {}),
      ...(st.planPoliczony ? { planPoliczony: true } : {}),
      ...(st.tylkoDarmowe ? { tylkoDarmowe: true } : {}),
      ...miejsceIKiedy(st),
    },
  };
}

/** Koszt ról tury w zł: z `faza.kosztZl`, a bez niego – suma kosztów ról (undefined, gdy nic nie wiadomo). */
function kosztTury(st) {
  if (kwota(st.kosztZl) !== undefined) return kwota(st.kosztZl);
  const znane = st.role.filter((r) => kwota(r.kosztZl) !== undefined);
  return znane.length ? kwota(znane.reduce((s, r) => s + r.kosztZl, 0)) : undefined;
}

/** Stan widoku z zapisanej wiadomości notatek (także z zapisu sieroty serwera). */
function stanZWiadomosci(m) {
  const z = m && m.zespol && typeof m.zespol === 'object' ? m.zespol : {};
  const st = nowyStanTury(0);
  st.faza = 'koniec';
  st.zrodlo = napis(z.zrodlo, 20);
  if (z.prowadzacy && typeof z.prowadzacy === 'object') st.prowadzacy = { silnik: silnikZespolu(z.prowadzacy.silnik), model: napis(z.prowadzacy.model, 200) };
  st.role = (Array.isArray(z.wklady) ? z.wklady : []).filter((w) => w && typeof w === 'object').slice(0, MAX_ROL_WIDOKU).map((w, i) => ({
    r: napis(w.r, 20) || `r${i + 1}`, rola: napis(w.rola, 40), nazwa: napis(w.nazwa, 60), silnik: silnikZespolu(w.silnik),
    model: napis(w.model, 200), stan: napis(w.stan, 20) || 'gotowa', tresc: napis(w.tresc, 8000), ms: Number(w.ms) || 0, start: 0,
    ...(w.blad ? { blad: napis(w.blad, 300) } : {}), ...(w.urwane ? { urwane: true } : {}),
    ...(typeof w.kod === 'string' && w.kod ? { kod: napis(w.kod, 40) } : {}), ...(typeof w.powod === 'string' ? { powod: napis(w.powod, 200) } : {}),
    ...dodatkiRoli(w),
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
  st.kosztZl = kwota(z.kosztZl);
  if (kwota(z.kosztProwadzacegoZl) !== undefined) st.kosztProwadzacegoZl = kwota(z.kosztProwadzacegoZl);
  if (z.kosztProwadzacegoSzac === true) st.kosztProwadzacegoSzac = true;
  if (z.planPoliczony === true) st.planPoliczony = true;
  if (z.tylkoDarmowe === true) st.tylkoDarmowe = true;
  Object.assign(st, miejsceIKiedy(z));
  return st;
}

/** Role bez wkładu (do noty „Bez wkładu: …”). */
const roleBezWkladu = (st) => st.role.filter((r) => !String(r.tresc || '').trim() && KONCOWE_STANY_ROLI.has(r.stan));

/** Skład do wysłania w `/api/chat` – tylko klucz roli, zadanie i wybór modelu
 *  (instrukcję roli serwer bierze z katalogu). */
function skladDoWyslania(role) {
  // Poprawka po recenzji (fala 3) nie jest rolą do wyboru – serwer dokłada ją sam.
  return (role || []).filter((r) => r && r.rola && r.fala !== 3).map((r) => ({
    rola: r.rola,
    ...(r.zadanie ? { zadanie: String(r.zadanie).slice(0, 1000) } : {}),
    // „Auto – najlepszy darmowy” (edytor w wariancie darmowym): serwer dobiera tylko spośród darmowych.
    ...(r.auto ? (r.autoDarmowy ? { tylkoDarmowe: true } : {}) : r.silnik ? { silnik: r.silnik, model: r.model || '' } : {}),
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
  return (role || []).map((r) => (r.zamiast && maPowod(r, 'wymaga-zgody') && r.zamiast.silnik !== 'local'
    ? { ...r, silnik: r.zamiast.silnik, model: r.zamiast.model || '', zamiast: undefined, powod: undefined, wymagaZgody: true,
      // Szacunek z planu dotyczył silnika lokalnego (0 zł); za zgodą koszt płatnego silnika jest nieznany.
      szacunekZl: PLATNE_ZESPOLU.includes(r.zamiast.silnik) ? undefined : 0 }
    : { ...r }));
}

/** Tura ma już notatki zespołu – „Regeneruj” i rundy kaskady nie wołają go drugi raz. */
function turaMaNotatki(wiadomosci, odKtorej = 0) {
  return (wiadomosci || []).slice(odKtorej).some((m) => m && m.narzedzie === 'zespol');
}

/* ---------------------------------------------------------------------------
   Zgoda GŁOSEM (tryb głosowy): Cosmos pyta „Powiedz tak, tylko lokalnie albo
   bez agentów”, a to, co rozpozna mowa, trafia tutaj. Odpowiedź bywa krótka
   i niechlujna („No dobra.”, „Tak, ale tylko lokalnie”, „Nie, dzięki”), więc
   kolejność ma znaczenie:
     1. „lokalnie” wygrywa ze wszystkim („tak, ale lokalnie”, „nie, u mnie”) –
        to wybór, przy którym nic nie wychodzi z komputera;
     2. zwroty zgody, w których pada „nie” („nie ma sprawy”, „czemu nie”);
     2a. przeczenie w dowolnym miejscu zdania – nigdy „tak” (ZGODA_PRZECZENIE);
     3. odmowa („nie”, „bez agentów”) przed zgodą („tak, bez agentów” = nie);
     4. zgoda.
   Niejasne (także długie zdanie – to raczej nowe pytanie niż odpowiedź) → ''.
   Polskie „no” to potakiwanie („no dobra”), nie angielskie „no” – dlatego
   każdy język ma własne wzorce. Tekst jest bez ogonków i interpunkcji.
   --------------------------------------------------------------------------- */
const ZGODA_WZORCE = {
  pl: {
    lokalnie: /(?:^| )(?:lokaln\p{L}*|na (?:moim |tym |swoim )?(?:komputerze|kompie)|u mnie|w domu|bez chmury|nie (?:do|w|na) chmur\p{L}*|bez wysylania|offline|domow\p{L}*)(?= |$)/u,
    takZNie: /^(?:no |a |tak )?(?:nie ma sprawy|nie ma problemu|czemu nie|dlaczego nie|nie widze przeszkod|bez problemu)(?= |$)/u,
    nie: /^(?:no |a )?(?:nie|nie nie|nie dziekuje|nie dzieki|nie trzeba|nie chce|nie teraz|anuluj|stop|zrezygnuj|rezygnuje|odpusc|daj spokoj)(?= |$)|(?:^| )(?:bez (?:agentow|agenta|zespolu|pomocnikow|nikogo)|(?:odpowiedz|zrob to) sam\p{L}*|sam odpowiedz|niech odpowie sam)(?= |$)/u,
    tak: /^(?:no |a |to )?(?:tak(?! (?:naprawde|samo|jak|czy|czy siak))|jasne|pewnie|dobra|dobrze|okej|ok|okay|zgoda|zgadzam sie|oczywiscie|smialo|mozesz|mozna|startuj|start|rusz|ruszaj|dawaj|wysylaj|wyslij|niech bedzie|prosze|poprosze|yes)(?= |$)|(?:^| )(?:uzyj chmury|w chmurze|przez chmure|chmura|do chmury)(?= |$)/u,
  },
  en: {
    lokalnie: /(?:^| )(?:local\p{L}*|on (?:my|this) (?:computer|machine|pc)|at home|no cloud|not (?:to|in) the cloud|without (?:the )?cloud|offline|keep it (?:here|local))(?= |$)/u,
    takZNie: /^(?:no problem|why not|no worries)(?= |$)/u,
    nie: /^(?:no|nope|nah|no thanks|no thank you|not now|cancel|stop|never mind|dont)(?= |$)|(?:^| )(?:without (?:the )?(?:agents|team)|no (?:agents|team)|(?:answer|do it) (?:yourself|alone|on your own))(?= |$)/u,
    tak: /^(?:yes|yeah|yep|yup|sure|ok|okay|go|go ahead|start|do it|alright|all right|fine|of course|please|please do|absolutely(?! not)|sounds good)(?= |$)|(?:^| )(?:use the cloud|the cloud|cloud is fine)(?= |$)/u,
  },
};

/* Przeczenie GDZIEKOLWIEK w zdaniu („Ja nie chcę do chmury”, „W chmurze nie”,
   „Never the cloud”) nigdy nie daje „tak” – zgoda wychodzi z domu z danymi,
   więc wątpliwość rozstrzyga się na korzyść komputera osoby. Odmowa z chmurą
   w zdaniu = „tylko lokalnie”, inne przeczenie = odmowa albo dopytanie. */
const ZGODA_PRZECZENIE = {
  pl: /(?:^| )(?:nie|nigdy|zadn\p{L}*|bez)(?= |$)/u,
  en: /(?:^| )(?:no|not|dont|never|nope|nah|off|without)(?= |$)/u,
};

/* ---------------------------------------------------------------------------
   Złotówki: kwoty w formacie języka interfejsu (pl-PL „0,12 zł”, en-GB
   „PLN 0.12”). Grosz to najmniejsza sensowna kwota – mniej to „poniżej 0,01 zł”,
   a nie „0,00 zł”, które wyglądałoby jak darmo.
   --------------------------------------------------------------------------- */
function kwotaZl(zl, jezyk = 'pl') {
  const n = Number(zl);
  if (typeof zl !== 'number' || !Number.isFinite(n) || n < 0) return '';
  const f = (x) => new Intl.NumberFormat(jezyk === 'en' ? 'en-GB' : 'pl-PL',
    { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
  return n > 0 && n < 0.005 ? `${jezyk === 'en' ? 'under' : 'poniżej'} ${f(0.01)}` : f(n);
}

/**
 * Szacunek kosztu składu przed startem (zł) albo null, gdy nieznany:
 * rola z szacunkiem serwera liczy się nim, rola na darmowym silniku – zerem,
 * a rola na płatnym bez szacunku (zmieniona w edytorze, „Auto”) – nieznana.
 */
function szacunekSkladu(role) {
  let suma = 0;
  for (const r of role || []) {
    if (!r) continue;
    if (kwota(r.szacunekZl) !== undefined) { suma += r.szacunekZl; continue; }
    if (r.auto || PLATNE_ZESPOLU.includes(r.silnik)) return null;
  }
  return kwota(suma);
}

/** Tekst mowy bez ogonków, wielkich liter i interpunkcji („Tak, ale…” → „tak ale”). */
function goloMowy(tekst) {
  return String(tekst || '').replace(/[łŁ]/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * Echo pytania o zgodę: rozpoznawanie przeglądarki słyszy głośnik i potrafi
 * oddać OGON pytania już po odmilczeniu („…do końca tej rozmowy”). Echem jest
 * tylko dosłowne zakończenie pytania, które przyszło tuż po jego końcu –
 * odpowiedź człowieka, która powtarza słowa pytania („Tak, ale tylko
 * lokalnie”), echem nie jest, bo pytanie się nią nie kończy.
 * @param {string} tekst    rozpoznana wypowiedź
 * @param {string} pytanie  to, co Cosmos właśnie powiedział
 * @param {number} poKoncuMs ile ms minęło od końca mowy Cosmosa
 */
function echoPytaniaZgody(tekst, pytanie, poKoncuMs) {
  if (!(poKoncuMs >= 0 && poKoncuMs < ECHO_ZGODY_MS)) return false;
  const t = goloMowy(tekst);
  const p = goloMowy(pytanie);
  return Boolean(t && p) && (p === t || p.endsWith(` ${t}`));
}
const ECHO_ZGODY_MS = 1200;

/** Tekst z rozpoznawania mowy → 'tak' | 'lokalnie' | 'nie' | '' (niejasne). */
function rozpoznajZgode(tekst, jezyk = 'pl') {
  const j = jezyk === 'en' ? 'en' : 'pl';
  const w = ZGODA_WZORCE[j];
  const t = goloMowy(tekst);
  if (!t || t.length > 80 || t.split(' ').length > 10) return '';
  if (w.lokalnie.test(t)) return 'lokalnie';
  if (w.takZNie.test(t)) return 'tak';
  if (ZGODA_PRZECZENIE[j].test(t)) return /chmur|cloud/.test(t) ? 'lokalnie' : (w.nie.test(t) ? 'nie' : '');
  if (w.nie.test(t)) return 'nie';
  if (w.tak.test(t)) return 'tak';
  return '';
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
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/></svg>',
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

  const jezyk = () => (typeof z.jezyk === 'function' && z.jezyk() === 'en' ? 'en' : 'pl');
  const zl = (x) => kwotaZl(x, jezyk());
  /** Własna rola osoby po id – z jej listy (świeża nazwa), inaczej nazwa ze zdarzenia. */
  const wlasna = (id) => (typeof z.wlasneRole === 'function' ? z.wlasneRole() || [] : []).find((x) => x && x.id === id) || null;
  const nazwaRoli = (r) => {
    if (czyWlasnaRola(r)) {
      const w = wlasna(r.rola || r.klucz);
      return (w && w.nazwa) || r.nazwa || t('ag.wl.bezNazwy');
    }
    const k = `ag.rola.${r.rola}`;
    const s = t('ag.rola.' + r.rola);
    return s && s !== k ? s : (r.nazwa || r.rola || '?');
  };
  /** Nazwa wiersza: poprawka po recenzji (fala 3) to „Programista – poprawka po recenzji”. */
  const nazwaWiersza = (r) => (r.fala === 3 ? t('ag.poprawka', { rola: nazwaRoli(r) }) : nazwaRoli(r));
  /** Znacznik „własna” przy nazwie roli (kolor nie jest jedynym nośnikiem – słowo). */
  const znakWlasnej = () => h('span', { klasa: 'rola-wlasna', tekst: t('ag.wlasna') });
  const krotkiModel = (m) => String(m || '').split('/').pop();
  // 1 rola, 2–4 role (ale 12–14 ról), 5+ ról.
  const ileRol = (n) => (n === 1 ? t('ag.role1')
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? t('ag.roleN', { n }) : t('ag.roleWiele', { n }));
  /* Kwota z „ok.”, gdy to szacunek – ale nie „ok. poniżej 0,01 zł”. `klucz` ma
     dwie wersje: z „ok.” (klucz) i bez (kluczDokladny). */
  const zlOk = (kw, szac, klucz = 'ag.okZl', kluczDokladny = '') => {
    const tekst = zl(kw);
    if (szac && kw >= 0.005) return t(klucz, { zl: tekst });
    return kluczDokladny ? t(kluczDokladny, { zl: tekst }) : tekst;
  };
  const sekundy = (ms) => Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const kolorSilnika = (s) => `var(--k-${s === 'cloud' ? 'nvidia' : s})`;

  function tekstStanu(r, teraz) {
    const w = stanWidoku(r.stan);
    if (w === 'pracuje') return t('ag.stan.pracuje', { s: sekundy(teraz - (r.start || teraz)) });
    if (w === 'gotowe') return t('ag.stan.gotowe', { s: sekundy(r.ms) });
    return t('ag.stan.' + w);
  }
  /** Podpis modelu spoza list silników (kandydat z propozycji): cechy z katalogu (models.js), w Node – pusto. */
  const opisModeluZ = (id, silnik) => {
    if (typeof modelInfo !== 'function' || typeof CECHA_OPIS === 'undefined') return '';
    const info = modelInfo(id, silnik);
    if (!info || !Array.isArray(info.cechy)) return '';
    return info.cechy.map((c) => (CECHA_OPIS[c] ? CECHA_OPIS[c][jezyk()] : '')).filter(Boolean).join(' · ');
  };
  /** Rola pominięta w wariancie darmowym, bo nie ma modelu z innej rodziny: „Recenzent: pominięta – …”. */
  const tekstRodziny = (x) => `${nazwaRoli(x)}: ${t('ag.pominietaRodzina')}`;
  /** Twarde spacje po jednoliterowych słowach w długim zdaniu (i18n.js; w Node go nie ma). */
  const polskieSpacje = (tekst) => (jezyk() === 'pl' && typeof twardeSpacje === 'function' ? twardeSpacje(tekst) : tekst);

  /** Zdanie dla człowieka, czemu rola nie dała wkładu – z kodu, nie ze zdania serwera (PL). */
  function powodRoli(r) {
    if (!r.blad && !r.kod) return '';
    const kod = r.kod || '';
    if (kod === 'termin' || kod === 'czas') return t('ag.bladCzas', { s: sekundy(r.ms) });
    if (kod === 'uprawnienia') return t('ag.bladUprawnienia');
    // Darmowa chmura NVIDIA ma limit zapytań na minutę – 429 mówi to wprost (K5).
    if (kod === 'limit-dostawcy' && r.silnik === 'cloud') return t('ag.bladLimitDarmowy');
    if (kod === 'niedostepny' || kod === 'limit-dostawcy') return t('ag.bladNiedostepny');
    if (/^budzet/.test(kod)) return t('ag.bladBudzet');
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
      const li = h('li', { klasa: 'rola nowa', 'data-r': r.r, 'data-rola': r.rola, styl: `--i:${i}`,
        ...(r.fala === 3 ? { 'data-fala': '3' } : {}), ...(czyWlasnaRola(r) ? { 'data-wlasna': 'true' } : {}) });
      li.addEventListener('animationend', () => li.classList.remove('nowa'), { once: true });
      const kropka = h('span', { klasa: 'rola-kropka', 'aria-hidden': 'true' });
      const wiersz = h('button', { type: 'button', klasa: 'rola-wiersz', 'aria-expanded': 'false', 'aria-controls': `${id}-${r.r}` });
      const nazwa = h('span', { klasa: 'rola-nazwa' });
      const nazwaTxt = doc().createTextNode('');
      nazwa.append(nazwaTxt);
      /* Poprawka po recenzji: pełny dopisek w wierszu, krótki w pigułce
         (telefon w poziomie) – inaczej cztery role nie mieszczą się w rzędzie. */
      if (r.fala === 3) {
        nazwa.append(h('span', { klasa: 'rola-dopisek dlugi', tekst: ` – ${t('ag.poprawkaDopisek')}` }),
          h('span', { klasa: 'rola-dopisek krotki', tekst: ` – ${t('ag.poprawkaKrotko')}` }));
      }
      if (czyWlasnaRola(r)) nazwa.append(znakWlasnej());
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
      const w = { li, wiersz, nazwa, nazwaTxt, silnik, modelTxt, stanEl, uwaga, podglad, blad, akcje, tresc, trescZrodlo: null };
      wiersze.set(r.r, w);
      return li;
    }

    function malujWiersz(r, w, teraz) {
      const ws = stanWidoku(r.stan);
      w.li.dataset.silnik = r.silnik;
      w.li.dataset.stan = ws;
      const nazwa = nazwaWiersza(r);
      const nazwaRdzen = nazwaRoli(r);
      if (w.nazwaTxt.data !== nazwaRdzen) w.nazwaTxt.data = nazwaRdzen;
      const sil = nazwaSilnika(r.silnik);
      if (w.silnik.textContent !== sil) w.silnik.textContent = sil;
      const m = krotkiModel(r.model);
      if (w.modelTxt.data !== m) w.modelTxt.data = m;
      const stanTxt = tekstStanu(r, teraz);
      if (w.stanEl.textContent !== stanTxt) w.stanEl.textContent = stanTxt;
      w.wiersz.title = r.zadanie || '';
      const koszt = kwota(r.kosztZl) > 0 ? ` · ${zl(r.kosztZl)}` : '';
      w.wiersz.setAttribute('aria-label', `${t('ag.pokazWklad', { rola: nazwa })}${czyWlasnaRola(r) ? ` (${t('ag.wlasna')})` : ''} · ${sil} ${m} · ${stanTxt}${koszt}`);
      // Zastępstwo z planu albo zapas po awarii – osobna linijka; budżet mówi, czemu tańszy silnik.
      const kluczZamiast = maPowod(r, 'budzet') ? 'ag.zamiastBudzet' : 'ag.zamiast';
      const uwaga = r.zapas && r.zapas.po && r.zapas.po.model ? t('ag.zapasPo', { model: krotkiModel(r.zapas.po.model) })
        : r.zamiast && r.zamiast.model && r.zamiast.model !== r.model ? t(kluczZamiast, { model: krotkiModel(r.zamiast.model) })
          : r.zamiast && r.zamiast.silnik !== r.silnik ? t(kluczZamiast, { model: nazwaSilnika(r.zamiast.silnik) }) : '';
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
      // Poprawka po recenzji (fala 3) to druga runda tej samej roli – nie liczy się jako osobna rola w nagłówku.
      const skladRol = st.role.filter((r) => r.fala !== 3);
      glowa.append(h('span', { klasa: 'zespol-tytul', tekst: `${t('ag.zespol')} · ${ileRol(skladRol.length)}` }));
      const kropki = h('span', { klasa: 'zespol-kropki', 'aria-hidden': 'true' });
      for (const r of skladRol) kropki.append(h('i', { styl: `--k:${kolorSilnika(r.silnik)}` }));
      glowa.append(kropki);
      glowa.append(h('span', { klasa: 'zespol-kto', tekst: skladRol.map(nazwaRoli).join(', ') }));
      /* Postęp liczy skład (jak tytuł); poprawka po recenzji w toku – słowem:
         „3 z 3 · poprawka · 34 s”, nie „3 z 4”, które sugerowało czwartą rolę. */
      const gS = ileSkonczonych({ role: skladRol });
      const f3 = st.role.some((r) => r.fala === 3 && stanWidoku(r.stan) === 'pracuje');
      const postep = (s) => t('ag.postep', { g: gS, n: skladRol.length, s }).replace(/( · )/, f3 ? ` · ${t('ag.poprawkaKrotko')} · ` : '$1');
      const czas = o.zywy && st.faza === 'role' ? postep(sekundy(teraz - st.start))
        : o.zywy && st.faza === 'prowadzacy' ? postep(sekundy(st.czasRol))
          : `${sekundy(st.czasRol)} s`;
      const czasEl = h('span', { klasa: 'zespol-czas', tekst: czas });
      // Koszt po wyniku – w zwiniętym bloku jedna kwota: cała odpowiedź (z „ok.” przy szacunku).
      const koszt = !o.zywy || st.faza === 'koniec' ? kosztCaly(st) : undefined;
      if (koszt > 0) czasEl.append(h('span', { klasa: 'zespol-koszt-glowa', tekst: ` · ${zlOk(koszt, kosztSzacowany(st))}` }));
      glowa.append(czasEl);
      const chev = doc().createElement('span');
      chev.innerHTML = IK.chev;
      glowa.append(chev.firstChild);
    }

    function malujDodatki() {
      if (!dodatki) return;
      dodatki.textContent = '';
      // Role odrzucone przed startem (auto: brak zgody, uprawnień, limitu).
      for (const x of st.odrzucone) {
        // Recenzent pominięty w wariancie darmowym (ta sama rodzina co autorzy) – powód słowami.
        if (x.kod === 'rodzina') { dodatki.append(h('div', { klasa: 'zespol-odrzucone' }, h('span', { tekst: tekstRodziny(x) }))); continue; }
        const klucz = ODRZUCONE_KLUCZ[x.kod];
        if (!klucz) continue;
        const wiersz = h('div', { klasa: 'zespol-odrzucone' },
          h('span', { tekst: t(klucz, { rola: nazwaRoli(x), silnik: nazwaSilnika(x.silnik || 'cloud') }) }));
        if (x.kod === 'wymaga-zgody' && o.naZgodaIPonow) wiersz.append(przycisk('zespol-link', t('ag.zgodaIPonow'), () => o.naZgodaIPonow()));
        dodatki.append(wiersz);
      }
      if (st.odmowa) dodatki.append(h('p', { klasa: 'zespol-nota', tekst: t(/^budzet/.test(st.odmowa.kod) ? 'ag.odmowaBudzet' : 'ag.odmowaLimit') }));
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
      /* Stopka: „koszt ról: X · cała odpowiedź: Y” (Y = role + planista +
         prowadzący, C2). Na telefonie mieści się tylko całość – część z rolami
         chowa CSS. Prowadzący za darmo (Chmura) – samo „koszt ról”. Bez
         `usage` od dostawcy kwota jest szacunkiem – „ok.”. */
      const koszt = !o.zywy ? kosztTury(st) : undefined;
      const cala = !o.zywy ? kosztCaly(st) : undefined;
      const szacowany = kosztSzacowany(st);
      const zRola = st.role.some((r) => r.kosztSzacowany);
      if (cala > 0 && kwota(st.kosztProwadzacegoZl) > 0) {
        const el = h('span', { klasa: 'zespol-koszt', title: t('ag.kosztTitle') });
        el.append(h('span', { klasa: 'zespol-koszt-podzial', tekst: `${zlOk(koszt || 0, zRola, 'ag.kosztOk', 'ag.koszt')} · ` }),
          h('span', { tekst: zlOk(cala, szacowany, 'ag.kosztCalaOk', 'ag.kosztCala') }));
        el.setAttribute('aria-label', el.textContent);
        stopka.append(el);
      } else if (koszt > 0) stopka.append(h('span', { klasa: 'zespol-koszt', title: t('ag.kosztTitle'), tekst: zlOk(koszt, zRola, 'ag.kosztOk', 'ag.koszt') }));
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
    // Z roli w składzie – własna rola ma nazwę od osoby, nie ze słownika.
    const nazwa = (klucz) => nazwaRoli((st && st.role.find((r) => r.rola === klucz)) || { rola: klucz });
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

  function sugestia(prop, { naUruchom, naZmien, naNieTeraz, naUruchomDarmowo }) {
    const d = h('div', { klasa: 'zespol-sugestia', role: 'group', 'aria-label': t('ag.sugestia') });
    const ik = doc().createElement('span');
    ik.innerHTML = IK.zespol;
    d.append(ik.firstChild, h('span', { tekst: t('ag.sugestia') }));
    // Skład startowy: przy ustawieniu „Darmowe modele” – darmowy (K5); „Uruchom” w app.js bierze ten sam (skladStartowy).
    const start = skladStartowy(prop);
    for (const r of start.role) {
      d.append(h('span', { klasa: 'kto', styl: `--k:${kolorSilnika(r.silnik)}` }, h('i'), `${nazwaRoli(r)} · ${nazwaSilnika(r.silnik)}`,
        czyWlasnaRola(r) ? znakWlasnej() : null));
    }
    // Szacunek tylko, gdy coś kosztuje (płatny silnik); darmowy skład – bez kwoty.
    const szac = kwota(start.szacunekZl) !== undefined ? start.szacunekZl : szacunekSkladu(start.role);
    if (szac > 0) d.append(h('span', { klasa: 'zespol-szacunek', title: t('ag.szacunekTitle'), tekst: zlOk(szac, true, 'ag.szacunek', 'ag.szacunekDokladny') }));
    d.append(przycisk('zespol-link zespol-uruchom', t('ag.uruchom'), naUruchom, { title: t('ag.uruchomTitle') }));
    /* „Za 0 zł” – ten sam zespół na darmowych modelach, tylko gdy proponowany
       kosztuje, a darmowy naprawdę nie (prowadzący też darmowy – copywriter). */
    const darmowe = wariantDarmowy(prop.darmowe);
    if (naUruchomDarmowo && start.wariant === 'proponowany' && darmowe && szac > 0 && zeroZl(darmowe)) {
      d.append(przycisk('zespol-link zespol-darmowo', t('ag.uruchomDarmowo'), naUruchomDarmowo, { title: t('ag.uruchomDarmowoTitle') }));
    }
    d.append(przycisk('zespol-link zespol-zmien', t('ag.zmien'), naZmien));
    d.append(przycisk('zamknij', '', naNieTeraz, { 'aria-label': t('ag.nieTeraz'), title: t('ag.nieTeraz'), ikona: IK.x }));
    return d;
  }

  // -------------------------------------------------------------------------
  // Propozycja składu przed startem (bramka zgody + edycja)
  // -------------------------------------------------------------------------

  /**
   * @param {object} p
   * @param {Array}  p.role          skład proponowany [{rola, zadanie, silnik, model, auto?}]
   * @param {object} p.darmowe       wariant „Darmowe modele” z serwera (K5: plan.sklad.darmowe) albo null
   * @param {string} p.skladDomyslny 'darmowy' – bramka startuje od darmowego (ustawienie osoby)
   * @param {string} p.wariant       wymuszony wariant startowy ('proponowany'|'darmowe'), np. po „Za 0 zł”
   * @param {object} p.kandydaci     {rola: [{silnik, model, darmowy}]} – modele do edytora roli (plan.sklad.kandydaci)
   * @param {number} p.szacunekProwadzacyZl koszt prowadzącego – kwota po ręcznej zmianie składu
   * @param {object} p.prowadzacy    {silnik, model}
   * @param {boolean} p.pytajOZgode  prowadzący lokalny i brak zgody na rozmowę
   * @param {Array}  p.lokalnie      skład „Tylko lokalnie” (z planu) albo null
   * @param {number} p.maxRol
   * @param {Array}  p.katalog       [{klucz, wymagaObrazu}]
   * @param {Function} p.otworzEdytor (rola, przycisk, gotowe, dodatki) => void – `dodatki`
   *                   ({kandydaci, polecany, trybDarmowy}) idą do edytor() bez zmian
   * @param {Function} p.naStart     ({role, zgoda, tylkoDarmowe}) => void
   * @param {Function} p.naTylkoLokalnie (role, {tylkoDarmowe}) => void
   * @param {Function} p.naBez       () => void
   */
  function propozycja(p) {
    const numeruj = (lista) => (lista || []).map((r, i) => ({ ...r, r: r.r || `p${i + 1}` }));
    const kopia = (lista) => lista.map((r) => ({ ...r }));
    const darmowe = wariantDarmowy(p.darmowe);
    const kandydaci = kandydaciZDanych(p.kandydaci) || {};
    /* Dwa gotowe składy (K5, makieta agencja-ux). Przy lokalnym prowadzącym
       bez zgody serwer przeniósł role darmowe z chmury na lokalny – bramka
       pokazuje darmowy skład ZA zgodą, a „Tylko lokalnie” – ten z planu
       (tak samo jak proponowany: skladZaZgoda robi app.js). */
    const warianty = {
      proponowany: { role: numeruj(p.role), szacunekZl: kwota(p.szacunekZl), szacunekProwadzacyZl: kwota(p.szacunekProwadzacyZl),
        lokalnie: p.lokalnie || null, odrzucone: [] },
      ...(darmowe ? { darmowe: { ...darmowe, role: numeruj(p.pytajOZgode ? skladZaZgoda(darmowe.role) : darmowe.role),
        lokalnie: p.pytajOZgode ? kopia(darmowe.role) : null } } : {}),
    };
    const segment = Boolean(warianty.darmowe);
    // 'proponowany' | 'darmowe' | 'wlasny' (skład ruszony ręcznie – oba pola bez zaznaczenia).
    let wariant = segment && (p.wariant === 'darmowe' || (p.wariant !== 'proponowany' && p.skladDomyslny === 'darmowy')) ? 'darmowe' : 'proponowany';
    let ostatni = wariant;           // gotowy skład, z którego wziął się obecny (po ręcznej zmianie też)
    let role = kopia(warianty[wariant].role);
    let zmienione = new Set();       // pigułki do mignięcia po przełączeniu składu
    // Skład zmieniony w edytorze – szacunek całości z planu przestaje pasować.
    let zmieniony = false;
    const sekcja = h('section', { klasa: 'zespol', 'data-stan': 'propozycja', 'data-otwarty': 'true', 'aria-label': t('ag.zespol'), 'aria-live': 'off' });
    const sr = h('p', { klasa: 'zespol-sr', role: 'status' });
    const glowa = h('div', { klasa: 'zespol-glowa' });
    const wybor = segment ? h('div', { klasa: 'zespol-warianty', role: 'radiogroup', 'aria-label': t('ag.wariant.grupa') }) : null;
    const lista = h('ol', { klasa: 'zespol-role' });
    const uwaga = h('div', { klasa: 'zespol-uwaga-blok' });
    const stopka = h('div', { klasa: 'zespol-stopka' });
    sekcja.append(sr, glowa, ...(wybor ? [wybor] : []), lista, uwaga, stopka);

    const recznaZmiana = () => { zmieniony = true; if (segment) wariant = 'wlasny'; };
    function ustawWariant(w, fokus = true) {
      if (!warianty[w] || w === wariant) return;
      const poprzednie = role;
      role = kopia(warianty[w].role);
      zmienione = new Set(role.map((r, i) => (poprzednie[i] && (poprzednie[i].silnik !== r.silnik || poprzednie[i].model !== r.model) ? i : -1)).filter((i) => i >= 0));
      wariant = w; ostatni = w; zmieniony = false;
      maluj();
      if (fokus && wybor) wybor.querySelector(`[data-wariant="${w}"]`)?.focus();
    }
    /** Kwota gotowego składu w polu segmentu: „ok. 0,26 zł” albo „0 zł” (tylko gdy cała tura = 0). */
    const kwotaWariantu = (w) => {
      const x = warianty[w];
      if (w === 'darmowe' && zeroZl(x)) return t('ag.zeroZl');
      if (x.szacunekZl > 0) return zlOk(x.szacunekZl, true, 'ag.okZl');
      return x.szacunekZl === 0 ? t('ag.zeroZl') : '';
    };
    function malujWybor() {
      if (!wybor) return;
      wybor.textContent = '';
      for (const w of ['proponowany', 'darmowe']) {
        const zazn = wariant === w;
        const skupiony = zazn || (wariant === 'wlasny' && w === ostatni);
        const b = h('button', { type: 'button', klasa: 'zespol-wariant', role: 'radio', 'aria-checked': String(zazn), 'data-wariant': w,
          tabindex: skupiony ? '0' : '-1' });
        const opis = h('span');
        const kropki = h('span', { klasa: 'zespol-wariant-kropki', 'aria-hidden': 'true' });
        for (const r of warianty[w].role) kropki.append(h('i', { styl: `--k:${kolorSilnika(r.silnik)}` }));
        opis.append(kropki, kwotaWariantu(w));
        b.append(h('b', { tekst: t(w === 'darmowe' ? 'ag.wariant.darmowe' : 'ag.wariant.proponowany') }), opis);
        b.addEventListener('click', () => ustawWariant(w));
        wybor.append(b);
      }
    }
    // Strzałki przełączają jak w natywnym radio (dwa pola – „następne” to drugie).
    if (wybor) {
      wybor.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const teraz = wariant === 'wlasny' ? ostatni : wariant;
        ustawWariant(teraz === 'darmowe' ? 'proponowany' : 'darmowe');
      });
    }
    function malujUwage() {
      uwaga.textContent = '';
      if (wariant !== 'darmowe') { uwaga.hidden = true; return; }
      const w = warianty.darmowe;
      // Uczciwe zdanie o jakości – informacja, nie ostrzeżenie (bez bursztynu); „jeden model” zamiast udawania zespołu.
      const p1 = h('p', { klasa: 'zespol-uwaga' });
      p1.innerHTML = IK.info;
      const tekst = h('span', { tekst: polskieSpacje(t(jedenModel(role, p.prowadzacy) ? 'ag.darmowe.jedenModel' : 'ag.darmowe.opis')) });
      if (w.prowadzacyPlatny) tekst.append(h('small', { tekst: t('ag.darmowe.prowadzacyPlatny', { silnik: nazwaSilnika(p.prowadzacy.silnik) }) }));
      p1.append(tekst);
      uwaga.append(p1);
      for (const x of w.odrzucone) {
        if (x.kod === 'rodzina') uwaga.append(h('div', { klasa: 'zespol-odrzucone' }, h('span', { tekst: tekstRodziny(x) })));
        else if (x.kod === 'tylko-darmowe') uwaga.append(h('div', { klasa: 'zespol-odrzucone' }, h('span', { tekst: t('ag.odrzuconeDarmowe', { rola: nazwaRoli(x), silnik: nazwaSilnika(x.silnik || 'cloud') }) })));
      }
      uwaga.hidden = false;
    }

    function maluj() {
      glowa.textContent = '';
      const ik = doc().createElement('span');
      ik.innerHTML = IK.zespol;
      glowa.append(ik.firstChild, h('span', { klasa: 'zespol-tytul', tekst: `${t('ag.zespol')} · ${ileRol(role.length)}` }));
      const kropki = h('span', { klasa: 'zespol-kropki', 'aria-hidden': 'true' });
      for (const r of role) kropki.append(h('i', { styl: `--k:${kolorSilnika(r.silnik)}` }));
      glowa.append(kropki);
      malujWybor();
      lista.textContent = '';
      role.forEach((r, i) => {
        const nazwa = nazwaRoli(r);
        const li = h('li', { klasa: 'rola', 'data-r': r.r, 'data-rola': r.rola, 'data-silnik': r.silnik, 'data-stan': 'czeka' });
        const btn = h('button', { type: 'button', klasa: `rola-model-btn${zmienione.has(i) ? ' zmieniony' : ''}`, 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
          'aria-label': `${t('ag.zmienModel', { rola: nazwa })}: ${nazwaSilnika(r.silnik)} ${krotkiModel(r.model)}` },
        h('span', { klasa: 'rola-silnik', tekst: nazwaSilnika(r.silnik) }), krotkiModel(r.model) || t('ag.set.auto'));
        btn.addEventListener('click', () => {
          btn.setAttribute('aria-expanded', 'true');
          const zGotowego = (warianty[ostatni] || warianty.proponowany).role.find((x) => x.rola === r.rola);
          const trybDarmowy = wariant === 'darmowe' || (wariant === 'wlasny' && ostatni === 'darmowe');
          p.otworzEdytor(r, btn, (w) => {
            btn.setAttribute('aria-expanded', 'false');
            if (!w) return;
            if (w.usun) { role = role.filter((x) => x !== r); recznaZmiana(); maluj(); return; }
            const przed = `${r.auto ? 'auto' : `${r.silnik}|${r.model}`}|${Boolean(r.autoDarmowy)}`;
            // Inny model = inna cena; darmowy silnik i „najlepszy darmowy” to pewne 0 zł.
            Object.assign(r, w.auto ? { auto: true, autoDarmowy: w.tylkoDarmowe === true, szacunekZl: w.tylkoDarmowe === true ? 0 : undefined }
              : { auto: false, autoDarmowy: false, silnik: w.silnik, model: w.model, szacunekZl: PLATNE_ZESPOLU.includes(w.silnik) ? undefined : 0 });
            if (`${r.auto ? 'auto' : `${r.silnik}|${r.model}`}|${Boolean(r.autoDarmowy)}` !== przed) recznaZmiana();
            maluj();
          }, {
            kandydaci: kandydaci[r.rola] || [],
            polecany: zGotowego && zGotowego.model ? { silnik: zGotowego.silnik, model: zGotowego.model } : null,
            trybDarmowy,
          });
        });
        const wiersz = h('div', { klasa: 'rola-wiersz', title: r.zadanie || '' },
          h('span', { klasa: 'rola-nazwa', tekst: nazwa }, czyWlasnaRola(r) ? znakWlasnej() : null), btn,
          przycisk('rola-usun', '', () => { recznaZmiana(); role = role.filter((x) => x !== r); maluj(); }, { 'aria-label': t('ag.usun', { rola: nazwa }), ikona: IK.x }));
        if (czyWlasnaRola(r)) li.dataset.wlasna = 'true';
        li.append(h('span', { klasa: 'rola-kropka', 'aria-hidden': 'true' }), wiersz);
        lista.append(li);
      });
      zmienione = new Set();
      malujUwage();
      stopka.textContent = '';
      // Dodaj rolę – z katalogu, bez powtórzeń, do limitu.
      const wolne = (p.katalog || []).filter((k) => !role.some((r) => r.rola === k.klucz));
      if (wolne.length && role.length < p.maxRol) {
        const dodaj = h('button', { type: 'button', klasa: 'zespol-dodaj', 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
        dodaj.innerHTML = IK.plus;
        dodaj.append(t('ag.dodaj'));
        const menu = h('div', { klasa: 'zespol-dodaj-menu', role: 'menu', hidden: true });
        // Najpierw role z katalogu, potem własne osoby – z oznaczeniem „własna”.
        for (const k of [...wolne.filter((x) => !czyWlasnaRola(x)), ...wolne.filter((x) => czyWlasnaRola(x))]) {
          const wl = czyWlasnaRola(k);
          const opcja = przycisk(`zespol-dodaj-opcja${wl ? ' wlasna' : ''}`, nazwaRoli({ rola: k.klucz, nazwa: k.nazwa }), () => {
            // Nowa rola w składzie darmowym dobiera się tylko spośród darmowych (0 zł pewne).
            const darmowo = wariant === 'darmowe' || (wariant === 'wlasny' && ostatni === 'darmowe');
            recznaZmiana();
            role.push({ rola: k.klucz, zadanie: '', silnik: p.prowadzacy.silnik, model: p.prowadzacy.model, auto: true, r: `p${Date.now()}`,
              ...(darmowo ? { autoDarmowy: true, szacunekZl: 0 } : {}), ...(wl ? { wlasna: true, nazwa: napis(k.nazwa, 60) } : {}) });
            maluj();
          }, { role: 'menuitem', ...(wl ? { title: k.cel || '' } : {}) });
          if (wl) opcja.append(znakWlasnej());
          menu.append(opcja);
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
      /* Kwota: przy dwóch gotowych składach stoi w segmencie (makieta UX);
         w stopce tylko bez segmentu albo po ręcznej zmianie – wtedy role
         + prowadzący (cała odpowiedź, ag.szacunekTitle), nie same role. */
      if (!segment || wariant === 'wlasny') {
        const gotowy = warianty[ostatni] || warianty.proponowany;
        const zRol = szacunekSkladu(role);
        const prow = kwota(gotowy.szacunekProwadzacyZl) !== undefined ? gotowy.szacunekProwadzacyZl : kwota(p.szacunekProwadzacyZl) || 0;
        const szac = !zmieniony && kwota(gotowy.szacunekZl) !== undefined ? gotowy.szacunekZl : zRol === null ? null : kwota(zRol + prow);
        if (szac > 0) stopka.append(h('span', { klasa: 'zespol-szacunek', title: t('ag.szacunekTitle'), tekst: zlOk(szac, true, 'ag.szacunek', 'ag.szacunekDokladny') }));
      }
      const przyciski = h('div', { klasa: 'zespol-przyciski' });
      przyciski.append(przycisk('btn-ghost', t('ag.bez'), () => p.naBez()));
      const lokalnie = (warianty[ostatni] || warianty.proponowany).lokalnie;
      if (zgodaPotrzebna && lokalnie) przyciski.append(przycisk('btn-secondary', t('ag.tylkoLokalnie'), () => p.naTylkoLokalnie(lokalnie, { tylkoDarmowe: ostatni === 'darmowe' })));
      const start = przycisk('btn-primary', t('ag.start'), () => p.naStart({ role, zgoda: zgodaPotrzebna, tylkoDarmowe: wariant === 'darmowe' }));
      start.disabled = !role.length;
      przyciski.append(start);
      stopka.append(przyciski);
    }
    maluj();
    setTimeout(() => { sr.textContent = t('ag.sr.czeka'); }, 60);
    return { el: sekcja, get role() { return role; }, get wariant() { return wariant; } };
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
   * @param {Function} e.gotowe      (wybor|null) => void – Auto w składzie darmowym: {auto:true, tylkoDarmowe:true}
   * @param {Array}  e.kandydaci     modele z propozycji dla tej roli [{silnik, model, darmowy}] (K5) – na górze grup
   * @param {object} e.polecany      {silnik, model} – model, który dobór dał tej roli (znacznik „polecany”)
   * @param {boolean} e.trybDarmowy  skład „Darmowe modele”: Auto = „najlepszy darmowy”
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
    /* Okno modalne trzyma fokus: Tab z ostatniego przycisku wraca na pierwszy,
       Shift+Tab z pierwszego – na ostatni. Dawniej Tab wychodził do schowanego
       panelu bocznego (agencja-frontend, runda 10). */
    const fokusowalne = () => [...okno.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((x) => x.offsetParent !== null || x === doc().activeElement);
    const klawisz = (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); zamknij(null); return; }
      if (ev.key !== 'Tab') return;
      const lista = fokusowalne();
      if (!lista.length) return;
      const pierwszy = lista[0]; const ostatni = lista[lista.length - 1];
      const a = doc().activeElement;
      if (!okno.contains(a)) { ev.preventDefault(); (ev.shiftKey ? ostatni : pierwszy).focus(); return; }
      if (ev.shiftKey && a === pierwszy) { ev.preventDefault(); ostatni.focus(); } else if (!ev.shiftKey && a === ostatni) { ev.preventDefault(); pierwszy.focus(); }
    };
    const poza = (ev) => { if (!okno.contains(ev.target) && ev.target !== e.kotwica) zamknij(null); };
    const glowa = h('div', { klasa: 're-glowa' }, h('h4', { tekst: e.tytul }),
      przycisk('icon-btn', '', () => zamknij(null), { 'aria-label': t('ag.re.zamknij'), ikona: IK.x }));
    const lista = h('div', { klasa: 're-lista', role: 'listbox', 'aria-label': t('ag.re.model') }, h('div', { klasa: 'model-lista-glowa', tekst: t('ag.re.model') }));
    const auto = e.trybDarmowy ? { auto: true, tylkoDarmowe: true } : { auto: true };
    let wybor = e.wybrany ? { ...e.wybrany } : { ...auto };
    const opcja = (nazwa, podpis, zaznaczona, na, czyAuto = false, polecany = false) => {
      const nazwaEl = h('span', { klasa: `model-opcja-nazwa${czyAuto ? ' auto' : ''}`, tekst: nazwa });
      // „polecany” – model, który dobór Cosmosa dał tej roli (słowo, nie kolor).
      if (polecany) nazwaEl.append(h('span', { klasa: 're-polecany', tekst: t('ag.re.polecany') }));
      const b = h('button', { type: 'button', klasa: `model-opcja${zaznaczona ? ' wybrany' : ''}`, role: 'option', 'aria-selected': String(zaznaczona) },
        nazwaEl, h('span', { klasa: 'model-opcja-podpis', tekst: podpis || '' }));
      b.addEventListener('click', () => {
        for (const x of lista.querySelectorAll('.model-opcja')) { x.classList.remove('wybrany'); x.setAttribute('aria-selected', 'false'); }
        b.classList.add('wybrany'); b.setAttribute('aria-selected', 'true');
        na();
      });
      return b;
    };
    lista.append(opcja(t(e.trybDarmowy ? 'ag.re.autoDarmowy' : 'ag.re.auto'), e.autoPodpis || '', !e.wybrany, () => { wybor = { ...auto }; }, true));
    /* Modele z propozycji (K5) na górze swojej grupy – dawniej edytor miał po
       jednym modelu na silnik i darmowego analityka nie dało się wybrać ręcznie. */
    const grupy = (e.grupy || []).map((g) => ({ silnik: g.silnik, modele: [...g.modele] }));
    for (const k of [...(e.kandydaci || [])].reverse()) {
      if (!k || !SILNIKI_ZESPOLU.includes(k.silnik) || !k.model) continue;
      let g = grupy.find((x) => x.silnik === k.silnik);
      if (!g) { g = { silnik: k.silnik, modele: [] }; grupy.push(g); }
      const i = g.modele.findIndex((m) => m.id === k.model);
      const m = i >= 0 ? g.modele.splice(i, 1)[0] : { id: k.model, podpis: opisModeluZ(k.model, k.silnik) };
      g.modele.unshift(m);
    }
    grupy.sort((a, b) => SILNIKI_ZESPOLU.indexOf(a.silnik) - SILNIKI_ZESPOLU.indexOf(b.silnik));
    for (const g of grupy) {
      if (!g.modele.length) continue;
      // Przy nazwie silnika: „bez opłat” / „płatny” – dziś trzeba było wiedzieć, że OpenAI i Claude kosztują.
      lista.append(h('div', { klasa: 're-grupa', 'data-silnik': g.silnik }, nazwaSilnika(g.silnik),
        h('span', { klasa: 're-cena', tekst: t(PLATNE_ZESPOLU.includes(g.silnik) ? 'ag.re.platny' : 'ag.re.bezOplat') })));
      const kontener = h('div', { 'data-silnik': g.silnik });
      for (const m of g.modele) {
        const zazn = Boolean(e.wybrany && e.wybrany.silnik === g.silnik && e.wybrany.model === m.id);
        const pol = Boolean(e.polecany && e.polecany.silnik === g.silnik && e.polecany.model === m.id);
        kontener.append(opcja(m.id, m.podpis, zazn, () => { wybor = { silnik: g.silnik, model: m.id }; }, false, pol));
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
   * @param {Function} k.naZmiane  (zmiana) => void  – {tryb}|{maxRol}|{zgodaChmura}|{role}|{potwierdzaj}|{skladDomyslny}
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

    const przel = (klucz, kluczHint, wlaczony, na, pole = '') => {
      const input = h('input', { type: 'checkbox', ...(pole ? { 'data-przel': pole } : {}) });
      input.checked = wlaczony;
      input.addEventListener('change', () => na(input.checked));
      return h('label', { klasa: 'set-wiersz zm-przelacznik' },
        h('span', { klasa: 'set-wiersz-tekst' }, h('span', { tekst: t(klucz) }), h('span', { klasa: 'field-hint', tekst: t(kluczHint) })),
        input, h('span', { klasa: 'zm-suwak', 'aria-hidden': 'true' }));
    };
    /* Zapis przełącznika się nie udał (bez sieci, błąd serwera) – mówimy to
       pod przełącznikami. Dawniej „Pytaj przed startem” wracało na OFF bez
       słowa i nie obowiązywało ani teraz, ani po powrocie sieci. */
    const zapiszPrzelacznik = async (zmiana) => {
      const w = await k.naZmiane(zmiana);
      const nowy = w && w.ok === false ? (w.error || t('ag.wl.bladZapisu')) : '';
      if (nowy !== bladStartu) { bladStartu = nowy; k.odswiez && k.odswiez({ fokus: `[data-przel="${Object.keys(zmiana)[0]}"]` }); }
    };
    const startSekcja = h('section', { klasa: 'set-sekcja field', 'data-karta': 'agenci' }, h('h3', { tekst: t('ag.set.start.h') }),
      przel('ag.set.potwierdzaj', 'ag.set.potwierdzajHint', k.potwierdzaj, (v) => zapiszPrzelacznik({ potwierdzaj: v }), 'potwierdzaj'),
      przel('ag.set.zgodaStala', 'ag.set.zgodaStalaHint', k.us.zgodaChmura, (v) => zapiszPrzelacznik({ zgodaChmura: v }), 'zgodaChmura'));
    if (bladStartu) startSekcja.append(h('p', { klasa: 'ag-start-blad', role: 'alert', tekst: bladStartu }));
    const segment = h('span', { klasa: 'ag-segment', role: 'group', 'aria-label': t('ag.set.maks') });
    for (let n = 2; n <= Math.max(2, Math.min(4, k.sufit)); n++) {
      const b = przycisk('', String(n), () => k.naZmiane({ maxRol: n }), { 'aria-pressed': String(k.us.maxRol === n) });
      segment.append(b);
    }
    startSekcja.append(h('div', { klasa: 'set-wiersz' },
      h('span', { klasa: 'set-wiersz-tekst' }, h('span', { tekst: t('ag.set.maks') }), h('span', { klasa: 'field-hint', tekst: t('ag.set.maksHint') })), segment));

    /* „Jaki skład proponować” (K5): od tego startuje bramka i tryb „Uruchamiaj
       sam”; przy „Darmowe modele” Auto dobiera tylko darmowe. Dla osoby, która
       wyłączyła „Pytaj przed startem”, to jedyna droga do 0 zł (agencja-frontend). */
    const skladH = h('h3', { id: 'ag-sklad-h', tekst: t('ag.set.sklad.h') });
    const skladSekcja = h('section', { klasa: 'set-sekcja field ag-sklad-sekcja', 'data-karta': 'agenci' },
      skladH, h('p', { klasa: 'set-sekcja-opis', tekst: t('ag.set.sklad.opis') }));
    const fsSklad = h('fieldset', { klasa: 'ag-tryby ag-sklady', 'aria-labelledby': 'ag-sklad-h' });
    for (const w of ['proponowany', 'darmowy']) {
      // data-pole – app.js oddaje fokus temu samemu polu po przebudowie panelu.
      const input = h('input', { type: 'radio', name: 'ag-sklad', value: w, 'data-pole': `sklad-${w}` });
      input.checked = (k.us.skladDomyslny === 'darmowy' ? 'darmowy' : 'proponowany') === w;
      input.addEventListener('change', () => { if (input.checked) k.naZmiane({ skladDomyslny: w }); });
      const klucz = w === 'darmowy' ? 'ag.set.sklad.darmowe' : 'ag.set.sklad.proponowany';
      const tytul = h('span', { tekst: t(klucz) });
      if (w === 'proponowany') tytul.append(h('span', { klasa: 'domyslne', tekst: t('ag.set.domyslne') }));
      fsSklad.append(h('label', { klasa: 'ag-tryb' }, input, h('span', { klasa: 'kolko', 'aria-hidden': 'true' }),
        h('span', { klasa: 'set-wiersz-tekst' }, tytul, h('span', { klasa: 'field-hint', tekst: t(`${klucz}Hint`) }))));
    }
    skladSekcja.append(fsSklad);

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
    const budzetSekcja = k.budzet || k.stanBudzetu ? sekcjaBudzetu(k) : null;
    kontener.append(trybSekcja, startSekcja, ...(budzetSekcja ? [budzetSekcja] : []), skladSekcja, roleSekcja, sekcjaWlasnychRol(k));
    return kontener;
  }

  // ---- Budżet w złotówkach (U5) ----------------------------------------------
  /** Liczba zł z pola (przecinek albo kropka); null = niepoprawna. */
  const zlZPola = (v) => {
    const s = String(v || '').trim().replace(/\s|zł|pln/gi, '').replace(',', '.');
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
  };

  // Odmowa zapisu limitu (zła kwota) – zostaje pod polami po przebudowie panelu.
  let bladBudzetu = '';
  // Nieudany zapis przełącznika w „Start zespołu” – zostaje pod nimi do następnej udanej zmiany.
  let bladStartu = '';
  let zapisanyTimer = null;
  function sekcjaBudzetu(k) {
    const us = k.budzet || { dzien: 0, miesiac: 0 };
    const sb = k.stanBudzetu || {};
    const sekcja = h('section', { klasa: 'set-sekcja field ag-budzet-sekcja', 'data-karta': 'agenci' },
      h('h3', { tekst: t('ag.bud.h') }), h('p', { klasa: 'set-sekcja-opis', tekst: t('ag.bud.opis') }));
    const pola = h('div', { klasa: 'ag-budzet' });
    /* Powód odmowy WIDOCZNY pod polami (role=alert). Sama czerwona ramka
       i `title` nic nie mówiły na telefonie. Zła kwota z przeglądarki nie
       przebudowuje panelu – wpisane „abc” i fokus zostają. */
    const blad = h('p', { klasa: 'ag-budzet-blad', id: 'ag-budzet-blad', role: 'alert', tekst: bladBudzetu });
    blad.hidden = !bladBudzetu;
    // „Budżet zapisany.” przy polach (nie gdzieś na górze karty); znika po chwili.
    const zapisany = h('p', { klasa: 'set-stan ag-budzet-zapisany', role: 'status' });
    const pole = (klucz, etykieta) => {
      const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', 'data-pole': `budzet-${klucz}`,
        'aria-describedby': `ag-budzet-stan${bladBudzetu ? ' ag-budzet-blad' : ''}`, placeholder: '0' });
      input.value = us[klucz] > 0 ? String(us[klucz]).replace('.', jezyk() === 'en' ? '.' : ',') : '';
      input.addEventListener('change', async () => {
        const n = zlZPola(input.value);
        if (n === null) {
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', 'ag-budzet-stan ag-budzet-blad');
          blad.textContent = t('ag.bud.zly'); blad.hidden = false;
          return;
        }
        input.removeAttribute('aria-invalid');
        bladBudzetu = '';
        /* Tylko zmieniony klucz – serwer scala. Dawniej szło {dzien, miesiac}
           ze stanu z chwili rysowania: drugie pole zapisane przed odpowiedzią
           na pierwsze wysyłało STARĄ wartość pierwszego i kasowało ją. */
        const w = await k.naZmiane({ budzetZl: { [klucz]: n } });
        if (w && w.ok === false) { bladBudzetu = w.error || t('ag.bud.zly'); k.odswiez && k.odswiez({ fokus: `[data-pole="budzet-${klucz}"]` }); return; }
        // Panel przebudował się po zapisie – napis wstawiamy do nowego.
        const nowy = typeof document !== 'undefined' && document.querySelector('.ag-budzet-zapisany');
        if (nowy) {
          nowy.textContent = t('acc.budzetZapisany');
          clearTimeout(zapisanyTimer);
          zapisanyTimer = setTimeout(() => { nowy.textContent = ''; }, 3000);
        }
      });
      return h('label', { klasa: 'field ag-budzet-pole' }, h('span', { klasa: 'field-label', tekst: etykieta }),
        h('span', { klasa: 'ag-budzet-wejscie' }, input, h('span', { klasa: 'ag-budzet-zl', 'aria-hidden': 'true', tekst: jezyk() === 'en' ? 'PLN' : 'zł' })));
    };
    pola.append(pole('dzien', t('ag.bud.dzien')), pole('miesiac', t('ag.bud.miesiac')));
    sekcja.append(pola, blad, zapisany);
    const stan = [];
    if (kwota(sb.wydanoDzis) !== undefined) stan.push(t('ag.bud.wydanoDzis', { zl: zl(sb.wydanoDzis) }));
    if (kwota(sb.wydanoMiesiac) !== undefined) stan.push(t('ag.bud.wydanoMiesiac', { zl: zl(sb.wydanoMiesiac) }));
    if (sb.dzien > 0 && typeof sb.zostaloDzis === 'number') stan.push(t('ag.bud.zostaloDzis', { zl: zl(Math.max(0, sb.zostaloDzis)) }));
    if (sb.miesiac > 0 && typeof sb.zostaloMiesiac === 'number') stan.push(t('ag.bud.zostaloMiesiac', { zl: zl(Math.max(0, sb.zostaloMiesiac)) }));
    sekcja.append(h('p', { klasa: 'set-stan ag-budzet-stan', id: 'ag-budzet-stan', tekst: stan.join(' · ') }));
    // Limit właściciela ciaśniejszy niż własny – członek widzi, skąd bierze się „zostało” (dzienny i miesięczny osobno).
    const odWlasciciela = (okres) => (sb.limit && typeof sb.limit === 'object' ? sb.limit[okres] === 'wlasciciel'
      : sb[okres] > 0 && !(us[okres] > 0 && us[okres] <= sb[okres]));
    if (sb.dzien > 0 && odWlasciciela('dzien')) sekcja.append(h('p', { klasa: 'field-hint', tekst: t('ag.bud.odWlasciciela', { zl: zl(sb.dzien) }) }));
    if (sb.miesiac > 0 && odWlasciciela('miesiac')) sekcja.append(h('p', { klasa: 'field-hint', tekst: t('ag.bud.odWlascicielaMiesiac', { zl: zl(sb.miesiac) }) }));
    if (typeof k.kurs === 'number' && k.kurs > 0) {
      sekcja.append(h('p', { klasa: 'field-hint', tekst: t('ag.bud.kurs', { kurs: new Intl.NumberFormat(jezyk() === 'en' ? 'en-GB' : 'pl-PL', { minimumFractionDigits: 2 }).format(k.kurs) }) }));
    }
    // Ceny zgadnięte (model spoza cennika, cennik z pamięci) – jedna linijka, gdy serwer o tym mówi.
    // Pole z serwera (/api/config zespol.cennik): { openai, claude, saZgadniete } – daty cenników, bez cen;
    // właścicielowi może dojść lista `zgadniete: [{ model }]`.
    const cn = k.cennik && typeof k.cennik === 'object' ? k.cennik : null;
    const zgadniete = cn ? (Array.isArray(cn.zgadniete) ? cn.zgadniete : []).map((x) => String((x && x.model) || '')).filter(Boolean) : [];
    if (cn && (cn.saZgadniete || zgadniete.length)) {
      const data = typeof cn.openai === 'string' ? cn.openai : cn.openai && typeof cn.openai.stan === 'string' ? cn.openai.stan : '';
      const modele = [...new Set(zgadniete)].slice(0, 3).join(', ');
      sekcja.append(h('p', { klasa: 'field-hint ag-budzet-cennik',
        tekst: t(modele ? 'ag.bud.cennikZgadniety' : 'ag.bud.cennikZgadnietyOgolnie', { modele, data: data || '?' }) }));
    }
    return sekcja;
  }

  // ---- Własne role (U1) --------------------------------------------------------
  const CECHY_ROLI = ['kod', 'wizja', 'rozumowanie', 'szybki', 'polski'];
  const MAX_WLASNYCH = 8;
  /* Szkic formularza trwa między przebudowami panelu (zmiana trybu, zapis
     innego pola) – inaczej wpisana instrukcja znikałaby po każdym kliknięciu. */
  let szkicWlasnej = null;
  // Zapis otwartego formularza (dla globalnego „Zapisz” w stopce Ustawień) – Promise<boolean>.
  let zapiszSzkicAkt = null;

  function sekcjaWlasnychRol(k) {
    const lista = Array.isArray(k.wlasne) ? k.wlasne.slice(0, MAX_WLASNYCH) : [];
    const sekcja = h('section', { klasa: 'set-sekcja field ag-wlasne-sekcja', 'data-karta': 'agenci' });
    sekcja.append(h('div', { klasa: 'ag-wl-glowa' }, h('h3', { tekst: t('ag.wl.h') }),
      h('span', { klasa: 'ag-wl-licznik', tekst: t('ag.wl.licznik', { n: lista.length, max: MAX_WLASNYCH }) })));
    sekcja.append(h('p', { klasa: 'set-sekcja-opis', tekst: t('ag.wl.opis') }));
    const ul = h('ul', { klasa: 'ag-role ag-wlasne' });
    for (const r of lista) {
      if (szkicWlasnej && szkicWlasnej.id === r.id) { ul.append(h('li', { klasa: 'ag-wl-edytowana' }, formularzWlasnej(k, lista))); continue; }
      const opis = [r.cel, (r.cechy || []).filter((c) => CECHY_ROLI.includes(c)).map((c) => t('ag.wl.cecha.' + c)).join(', '),
        r.fala === 2 ? t('ag.wl.fala2Krotko') : '', r.wymagaObrazu ? t('ag.wl.obrazKrotko') : ''].filter(Boolean).join(' · ');
      const edytuj = przycisk('zespol-link ag-wl-edytuj', t('ag.wl.edytuj'), () => {
        szkicWlasnej = { id: r.id, nazwa: r.nazwa || '', cel: r.cel || '', instrukcja: r.instrukcja || '', cechy: [...(r.cechy || [])],
          fala: r.fala === 2 ? 2 : 1, wymagaObrazu: Boolean(r.wymagaObrazu), blad: '' };
        k.odswiez && k.odswiez({ fokus: '[data-pole="nazwa"]' });
      }, { 'aria-label': t('ag.wl.edytujRole', { nazwa: r.nazwa || '' }) });
      const usun = przycisk('zespol-link ag-wl-usun', t('ag.wl.usun'), async () => {
        if (typeof confirm === 'function' && !confirm(t('ag.wl.usunPotwierdz', { nazwa: r.nazwa || '' }))) return;
        const w = await k.naZmiane({ wlasneRole: lista.filter((x) => x !== r).map(doZapisu) });
        if (w && w.ok === false) { szkicWlasnej = null; k.odswiez && k.odswiez(); }
      }, { 'aria-label': t('ag.wl.usunRole', { nazwa: r.nazwa || '' }) });
      ul.append(h('li', { klasa: 'ag-rola ag-wlasna', 'data-id': r.id || '' },
        h('span', { klasa: 'set-wiersz-tekst' }, h('span', { klasa: 'ag-wl-nazwa' }, h('span', { tekst: r.nazwa || '' }), znakWlasnej()),
          h('span', { klasa: 'field-hint', tekst: opis })),
        h('span', { klasa: 'ag-wl-akcje' }, edytuj, usun)));
    }
    if (ul.firstChild) sekcja.append(ul);
    if (szkicWlasnej && !szkicWlasnej.id) sekcja.append(formularzWlasnej(k, lista));
    else if (!szkicWlasnej && lista.length >= MAX_WLASNYCH) {
      // Limit: zdanie zamiast wyszarzonego przycisku z powodem w `title` (dotyk go nie pokaże).
      sekcja.append(h('p', { klasa: 'field-hint ag-wl-pelne', tekst: t('ag.wl.limitPelny', { max: MAX_WLASNYCH }) }));
    } else if (!szkicWlasnej) {
      const dodaj = h('button', { type: 'button', klasa: 'zespol-dodaj ag-wl-dodaj' });
      dodaj.innerHTML = IK.plus;
      dodaj.append(t('ag.wl.dodaj'));
      dodaj.addEventListener('click', () => {
        szkicWlasnej = { id: null, nazwa: '', cel: '', instrukcja: '', cechy: [], fala: 1, wymagaObrazu: false, blad: '' };
        k.odswiez && k.odswiez({ fokus: '[data-pole="nazwa"]' });
      });
      sekcja.append(dodaj);
    }
    return sekcja;
  }

  /** Rola do zapisu: tylko pola z kontraktu (id nadaje serwer nowej roli). */
  const doZapisu = (r) => ({
    ...(r.id ? { id: r.id } : {}), nazwa: String(r.nazwa || '').trim().slice(0, 40), cel: String(r.cel || '').trim().slice(0, 120),
    instrukcja: String(r.instrukcja || '').trim().slice(0, 1500), cechy: (r.cechy || []).filter((c) => CECHY_ROLI.includes(c)),
    fala: r.fala === 2 ? 2 : 1, wymagaObrazu: Boolean(r.wymagaObrazu),
  });

  function formularzWlasnej(k, lista) {
    const sz = szkicWlasnej;
    const f = h('div', { klasa: 'ag-wl-formularz', role: 'group', 'aria-label': t(sz.id ? 'ag.wl.edycja' : 'ag.wl.nowa') });
    const idP = (x) => `ag-wl-${x}`;
    const tekstowe = (pole, max, wielo) => {
      const el = h(wielo ? 'textarea' : 'input', { id: idP(pole), 'data-pole': pole, maxlength: String(max),
        ...(wielo ? { rows: '5' } : { type: 'text', autocomplete: 'off' }), 'aria-describedby': `${idP(pole)}-hint` });
      el.value = sz[pole] || '';
      return el;
    };
    const blad = h('p', { klasa: 'ag-wl-blad', role: 'alert', tekst: sz.blad || '' });
    blad.hidden = !sz.blad;
    const nazwa = tekstowe('nazwa', 40);
    const cel = tekstowe('cel', 120);
    const instr = tekstowe('instrukcja', 1500, true);
    const licznikInstr = h('span', { klasa: 'field-hint ag-wl-licz', id: `${idP('instrukcja')}-hint` });
    const liczI = () => { licznikInstr.textContent = t('ag.wl.znaki', { n: instr.value.length, max: 1500 }); };
    liczI();
    // Powód odmowy znika, gdy człowiek zaczyna poprawiać (nie wisi nad wpisaną już nazwą).
    const bezBledu = () => {
      if (!sz.blad) return;
      sz.blad = ''; sz.bladPole = ''; blad.textContent = ''; blad.hidden = true;
      for (const x of [nazwa, instr]) { x.removeAttribute('aria-invalid'); x.setAttribute('aria-describedby', `${x.id}-hint`); }
    };
    nazwa.addEventListener('input', () => { sz.nazwa = nazwa.value; bezBledu(); });
    cel.addEventListener('input', () => { sz.cel = cel.value; });
    instr.addEventListener('input', () => { sz.instrukcja = instr.value; liczI(); bezBledu(); });
    const wiersz = (pole, el, podpowiedz) => h('div', { klasa: 'field' },
      h('label', { klasa: 'field-label', for: idP(pole), tekst: t('ag.wl.pole.' + pole) }), el,
      podpowiedz || h('span', { klasa: 'field-hint', id: `${idP(pole)}-hint`, tekst: t('ag.wl.pole.' + pole + 'Hint') }));
    f.append(wiersz('nazwa', nazwa), wiersz('cel', cel), wiersz('instrukcja', instr, licznikInstr));
    blad.id = idP('blad');
    /* Brak nazwy albo instrukcji: powód POD polem, którego dotyczy (na dole
       przycisków byłby ~450 px niżej, poza ekranem), pole oznaczone dla
       czytnika. Odmowa serwera (walidacja, limit, dysk) zostaje przy
       przyciskach – tam jest wzrok po kliknięciu. */
    const oznaczPole = (pole) => {
      const el = pole === 'nazwa' ? nazwa : instr;
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', `${blad.id} ${el.id}-hint`);
      el.closest('.field').append(blad);
      return el;
    };
    // Cechy – po nich Cosmos dobiera model roli („Auto”).
    const cechy = h('fieldset', { klasa: 'ag-wl-cechy' }, h('legend', { klasa: 'field-label', tekst: t('ag.wl.pole.cechy') }));
    for (const c of CECHY_ROLI) {
      const box = h('input', { type: 'checkbox', value: c, 'data-pole': `cecha-${c}` });
      box.checked = sz.cechy.includes(c);
      box.addEventListener('change', () => { sz.cechy = box.checked ? [...new Set([...sz.cechy, c])] : sz.cechy.filter((x) => x !== c); });
      cechy.append(h('label', { klasa: 'ag-wl-cecha' }, box, h('span', { tekst: t('ag.wl.cecha.' + c) })));
    }
    cechy.append(h('span', { klasa: 'field-hint', tekst: t('ag.wl.pole.cechyHint') }));
    const fala = h('fieldset', { klasa: 'ag-wl-fala' }, h('legend', { klasa: 'field-label', tekst: t('ag.wl.pole.fala') }));
    for (const [n, klucz, podpowiedz] of [[1, 'ag.wl.fala1', 'ag.wl.fala1Hint'], [2, 'ag.wl.fala2', 'ag.wl.fala2Hint']]) {
      const r = h('input', { type: 'radio', name: 'ag-wl-fala', value: String(n), 'data-pole': `fala-${n}` });
      r.checked = sz.fala === n;
      r.addEventListener('change', () => { if (r.checked) sz.fala = n; });
      fala.append(h('label', { klasa: 'ag-wl-cecha' }, r, h('span', { klasa: 'set-wiersz-tekst' },
        h('span', { tekst: t(klucz) }), h('span', { klasa: 'field-hint', tekst: t(podpowiedz) }))));
    }
    const obraz = h('input', { type: 'checkbox', 'data-pole': 'wymagaObrazu' });
    obraz.checked = sz.wymagaObrazu;
    obraz.addEventListener('change', () => { sz.wymagaObrazu = obraz.checked; });
    const obrazEt = h('label', { klasa: 'ag-wl-cecha ag-wl-obraz' }, obraz, h('span', { klasa: 'set-wiersz-tekst' },
      h('span', { tekst: t('ag.wl.pole.obraz') }), h('span', { klasa: 'field-hint', tekst: t('ag.wl.pole.obrazHint') })));
    // „Anuluj” edycji wraca na „Edytuj” tej roli; nowej – na „Dodaj” (przy 8 rolach wyłączone – wtedy zapas w app.js).
    const anuluj = przycisk('btn-ghost', t('ag.wl.anuluj'), () => {
      const id = sz.id;
      szkicWlasnej = null;
      k.odswiez && k.odswiez({ fokus: id ? `.ag-wlasna[data-id="${id}"] .ag-wl-edytuj` : '.ag-wl-dodaj:not([disabled])' });
    });
    const zapiszSzkic = async () => {
      const gotowa = doZapisu(sz);
      const brak = !gotowa.nazwa ? 'nazwa' : !gotowa.instrukcja ? 'instrukcja' : '';
      if (brak) {
        sz.blad = t(brak === 'nazwa' ? 'ag.wl.brakNazwy' : 'ag.wl.brakInstrukcji');
        sz.bladPole = brak;
        blad.textContent = sz.blad; blad.hidden = false;
        oznaczPole(brak).focus();
        return false;
      }
      zapisz.disabled = true;
      const nowa = sz.id ? lista.map((x) => (x.id === sz.id ? { ...gotowa, id: sz.id } : doZapisu(x))) : [...lista.map(doZapisu), gotowa];
      const kopia = szkicWlasnej;
      szkicWlasnej = null;
      const w = await k.naZmiane({ wlasneRole: nowa });
      if (w && w.ok === false) {
        // Serwer odmówił (walidacja, limit, dysk) – szkic wraca z powodem.
        // Nazwa roli Cosmosa (Z7, `nazwa-zajeta`) – powód pod polem nazwy; inne odmowy – przy przyciskach.
        const podNazwa = w.kod === 'nazwa-zajeta';
        szkicWlasnej = { ...kopia, blad: w.error || t('ag.wl.bladZapisu'), bladPole: podNazwa ? 'nazwa' : '' };
        k.odswiez && k.odswiez({ fokus: podNazwa ? '[data-pole="nazwa"]' : '.ag-wl-zapisz' });
        return false;
      }
      return true;
    };
    const zapisz = przycisk('btn-primary ag-wl-zapisz', t('ag.wl.zapisz'), () => { zapiszSzkic(); });
    zapiszSzkicAkt = zapiszSzkic;
    f.append(cechy, fala, obrazEt, blad, h('div', { klasa: 'ag-wl-przyciski' }, anuluj, zapisz));
    if (sz.blad && sz.bladPole) oznaczPole(sz.bladPole);
    return f;
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
    if (st.faza === 'role') return t('ag.glos.pracuje', { g: ileSkonczonych({ role: skladBezPoprawki(st) }), n: skladBezPoprawki(st).length });
    return '';
  }

  return {
    blokZespolu, tekstOgloszenia, notaBezWkladu, bladScalenia, sugestia, propozycja, edytor, panelUstawien,
    kropkiGlosu, statusGlosu, nazwaRoli, ikonaZespolu: IK.zespol,
    /** Globalne „Zapisz”: otwarty formularz własnej roli zapisuje się najpierw.
     *  null – nie było szkicu; true – zapisany; false – błąd (okno ma zostać). */
    zapiszSzkicWlasnej: async () => (szkicWlasnej && zapiszSzkicAkt ? zapiszSzkicAkt() : null),
  };
}

const CZYSTE_ZESPOLU = {
  stanWidoku, nowyStanTury, zjedzZdarzenieZespolu, wiadomoscNotatek, stanZWiadomosci, roleBezWkladu,
  skladDoWyslania, silnikiChmury, skladZaZgoda, turaMaNotatki, ileSkonczonych, czekaNaZgode, KONCOWE_STANY_ROLI, SILNIKI_ZESPOLU,
  kosztProwadzacego, kosztCaly, kosztSzacowany, skladBezPoprawki,
  rozpoznajZgode, echoPytaniaZgody, kwotaZl, szacunekSkladu, czyWlasnaRola, kosztTury, wymagaZgodyZ, maPowod, PLATNE_ZESPOLU,
  wariantDarmowy, kandydaciZDanych, skladStartowy, jedenModel, zeroZl,
};

if (typeof window !== 'undefined') Object.assign(window, { utworzZespolWidok, ZESPOL: CZYSTE_ZESPOLU });
if (typeof module !== 'undefined') module.exports = { utworzZespolWidok, ...CZYSTE_ZESPOLU };

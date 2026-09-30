/* ============================================================
   PROTOKÓŁ – znaczniki modelu i wynik archiwum jako kontekst

   Dwie rzeczy, obie czysto tekstowe, obie w samym środku jakości rozmowy:

   1. ZNACZNIKI. Model prosi o narzędzie, pisząc `[ARCHIWUM: …]` w treści
      odpowiedzi. To polecenie, nie zdanie do przeczytania – musi zniknąć
      z ekranu, także wtedy, gdy zostało urwane w połowie.
   2. KONTEKST. Odpowiedź archiwum trzeba zmieścić w budżecie znaków tak,
      żeby model wiedział, ILE tego jest i CZEGO nie widzi.

   Wydzielone z `app.js`, bo to najczęściej poprawiana logika w całym
   projekcie – i przez długi czas jedyna droga do jej sprawdzenia wiodła
   przez wycinanie fragmentu pliku regexpem i `eval`. Zestaw
   `archiwum-po-folderach` robił dokładnie to: szukał `const ARCH_LIMIT_ZNAKOW`
   i `const IMAGE_MARKER_RE`, brał tekst pomiędzy nimi i wykonywał go.
   Działało do pierwszej przeprowadzki.

   Tutaj nic nie sięga po DOM ani po stan aplikacji – wchodzą dane, wychodzi
   napis. Da się to wywołać w Node i sprawdzić naprawdę.
   ============================================================ */

/**
 * Zbuduj zestaw funkcji protokołu.
 *
 * @param {object} [z] zależności (żadna nie jest wymagana – moduł jest czysty)
 * @returns {object} znaczniki i budowanie kontekstu
 */
function utworzProtokol() {
  /* Znacznik po tolerancyjnemu: małe modele lokalne piszą „[ SZUKAJ: …]"
     ze spacją, a Qwen – nawiasy i dwukropek pełnej szerokości („【SZUKAJ：…】").
     Dotąd takie polecenie lądowało na ekranie, a narzędzie nie ruszało.
     Dwukropek zostaje obowiązkowy i odnośnik Markdown dalej jest odnośnikiem:
     „[Szukaj w Google](…)" czy „[Plan B]" w zdaniu nie mogą niczego odpalić. */
  const OTW = '[\\[【]\\s*';
  const DWUKROPEK = '\\s*[:：]\\s*';
  const TRESC = '[^\\]】\\n]';
  const ZAM = '\\s*[\\]】]';
  const znacznik = (nazwa, grupa = `(${TRESC}+?)`) => new RegExp(`${OTW}${nazwa}${DWUKROPEK}${grupa}${ZAM}(?!\\()`, 'i');

  /* „[SEARCH: …]” – Qwen i Llama przy angielskiej rozmowie tłumaczą nazwę
     znacznika. Stało to na ekranie, a wyszukiwanie nie ruszało (agencja-rozmowa,
     runda 5). To samo polecenie, więc i to samo narzędzie. */
  const SEARCH_MARKER_RE = znacznik('(?:SZUKAJ|SEARCH)');

  /** Usuń dyrektywę wyszukiwania z tekstu pokazywanego użytkownikowi.
   *  To polecenie dla modelu, nie treść odpowiedzi – nigdy nie ma trafić na ekran.
   *
   *  Marcin przysłał zapis rozmowy, w którym na ekranie stało gołe
   *  `[ARCHIWUM: grupuj=rok]`, a kawałek niżej wisiał pusty blok kodu. Dwie
   *  dziury, obie w tym samym miejscu:
   *
   *  1. ZNACZNIK URWANY. Model potrafi skończyć wypowiedź w połowie znacznika
   *     – bo skończył mu się budżet tokenów albo Marcin nacisnął „stop".
   *     Bez domykającego `]` żaden z wzorców nie pasował i polecenie dla modelu
   *     zostawało na ekranie jako treść odpowiedzi.
   *
   *  2. PUSTY PŁOT. Model lubi opakowywać znacznik w ```blok```. Usunięcie
   *     samego znacznika zostawiało wtedy parę płotków bez zawartości –
   *     na ekranie pusta ramka bez wyjaśnienia, skąd się wzięła.
   *
   *  Kolejność ma znaczenie: najpierw znika znacznik, potem sprzątamy płoty,
   *  które przez to opustoszały.
   */
  const ZNACZNIKI = ['SZUKAJ', 'SEARCH', 'GRAFIKA', 'PLAN', 'ARCHIWUM', 'OBRAZ', 'AKCJA'];

  /* Nagłówki bloku notatek zespołu (lib/instrukcje-narzedzi.js bierze je stąd –
     jedno źródło dla tego, co idzie do prowadzącego, i tego, co czyścimy z ekranu). */
  const NAGLOWKI_ZESPOLU = { notatki: 'NOTATKI ZESPOŁU', wklady: 'ZESPÓŁ – WKŁADY', nieDotarlo: 'NIE DOTARŁO' };

  /* RUSZTOWANIE, KTÓRE MODEL POTRAFI PRZEPISAĆ DO ODPOWIEDZI (runda 10).
     Słabe modele naśladują format tego, co dostały: ramkę historii
     „(pokazano zdjęcia: Taormina)”, znaczniki `<wklad rola=…>` i nagłówek
     „NOTATKI ZESPOŁU – materiał roboczy…” (agencja-rozmowa, próby domk-echo
     i wklad-echo). Czyścimy tylko linie, które w CAŁOŚCI są taką ramką –
     nawias w środku zdania zostaje. */
  const RAMKA_HISTORII = /^[ \t]*\((?:pokazano zdjęcia|wcześniejszy wynik narzędzia|tu użytkownik pokazał zdjęci)[^)\n]*\)[ \t]*$/gim;
  const NAGLOWEK_ZESPOLU_RE = new RegExp(`^[ \\t]*(?:${Object.values(NAGLOWKI_ZESPOLU).join('|')})\\b[^\\n]*(?:\\n|$)`, 'gm');
  function bezRusztowania(tekst) {
    return tekst
      .replace(/<\/?wklad\b[^>\n]*>/gi, '')
      .replace(RAMKA_HISTORII, '')
      .replace(NAGLOWEK_ZESPOLU_RE, '');
  }

  function stripSearchMarker(s) {
    let out = bezRusztowania(String(s || ''));
    const przed = out;
    /* Wywołanie narzędzia w formacie modeli z function callingiem
       (`<tool_call>{"name": …}</tool_call>` – Qwen, Hermes). Cosmos go nie
       wykonuje, a stało na ekranie jako JSON. Urwane na końcu też znika. */
    out = out.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)|<\/tool_call>/gi, '');
    // Akcja z odnośnikiem Markdown w treści – ogólny wzorzec niżej urwałby ją na „]” linku.
    out = out.replace(new RegExp(`${OTW}AKCJA${DWUKROPEK}(?:${LINK_MD}|${TRESC})*?${LINK_MD}(?:${LINK_MD}|${TRESC})*${ZAM}`, 'gi'), '');
    for (const z of ZNACZNIKI) {
      /* Znacznik = nazwa, a zaraz po niej „:" albo „]" – i NIGDY odnośnik
         Markdown. Z dwukropkiem opcjonalnym „[Planty](…)", „[Archiwum
         Narodowe](…)" czy „[Obrazy Moneta](…)" znikały z odpowiedzi,
         a „[Archiwum…](…)" odpalało do tego narzędzie archiwum. */
      out = out.replace(new RegExp(`${OTW}${z}(?:${DWUKROPEK}${TRESC}*)?${ZAM}(?!\\()`, 'gi'), '');
      /* Bez dwukropka („[SZUKAJ pogoda Kraków]”) – słabe modele gubią go.
         Tylko nazwa WIELKIMI literami: „[Plan B]” czy „[Obraz Moneta]”
         w zdaniu to zwykły tekst i ma zostać. Samo czyszczenie ekranu –
         narzędzie rusza dalej tylko z dwukropkiem. */
      out = out.replace(new RegExp(`${OTW}${z}\\s+${TRESC}+?${ZAM}(?!\\()`, 'g'), '');
      /* Urwany na końcu tekstu – i TYLKO na końcu, i tylko z dwukropkiem.
         W środku wypowiedzi otwarty nawias kwadratowy to zwykły nawias,
         a „[Plan B" na końcu zdania nie jest poleceniem. */
      out = out.replace(new RegExp(`${OTW}${z}${DWUKROPEK}${TRESC}*$`, 'i'), '');
    }
    /* Znacznik zapisany jako punkt listy („Sprawdzę:\n- [SZUKAJ: …]”)
       zostawiał gołą kreskę albo „2.”. Tylko gdy coś wycięliśmy – samotny
       punktor w tekście bez znaczników to nie nasza sprawa. */
    if (out !== przed) {
      out = out.split('\n').filter((l) => !/^[ \t]*(?:[-*+•]|\d{1,3}[.)])[ \t]*$/.test(l))
        .join('\n').replace(/\n{3,}/g, '\n\n');
    }
    // Płot, w którym po usunięciu znacznika nie zostało nic prócz białych znaków.
    out = out.replace(/```[a-zA-Z-]*\s*```/g, '')
      // **[SZUKAJ: …]** zostawiało „****", a `[SZUKAJ: …]` – „``"
      .replace(/\*\*\s*\*\*|(?<![`\w])``(?!`)/g, '');
    // Płot urwany razem ze znacznikiem: nieparzysta liczba płotów, ostatni pusty.
    if (((out.match(/```/g) || []).length % 2) === 1) out = out.replace(/```[a-zA-Z-]*\s*$/, '');
    return out.trim();
  }

  /** Rozdziel treść modelu na myślenie i odpowiedź.
   *  vLLM bez parsera rozumowania, Nemotron z „detailed thinking on" i starsze
   *  Ollamy piszą `<think>…</think>` wprost w treści. Zostawione tam stało na
   *  ekranie – a znaczniki z rozważań („czy użyć [SZUKAJ: …]?") odpalały
   *  narzędzia w pętli. Działa też na urwanym `<think>` w trakcie strumienia. */
  function rozdzielMyslenie(acc) {
    let think = '';
    let wejscie = String(acc || '');
    // samo zamknięcie bez otwarcia (otwarcie siedziało w szablonie czatu, np. R1/QwQ)
    const z = wejscie.search(/<\/think>/i);
    if (z >= 0 && !/<think>/i.test(wejscie.slice(0, z))) { think = wejscie.slice(0, z); wejscie = wejscie.slice(z + 8); }
    const tresc = wejscie.replace(/<think>([\s\S]*?)(<\/think>|$)/gi, (_, w) => { think += w; return ''; });
    return { think: think.trim(), tresc: tresc.replace(/^\s+/, '') };
  }

  /** Tekst do pokazania W TRAKCIE strumienia: bez znaczników, bez urwanego
   *  „[SZU" i bez `<think>`. Surowy tekst na żywo pokazywał „[GRAFIKA: Wawe…"
   *  przez ułamek sekundy przy każdym narzędziu. */
  function widokWToku(acc) {
    let t = stripSearchMarker(rozdzielMyslenie(acc).tresc);
    const m = t.match(/[[【]\s*([A-ZĄĆĘŁŃÓŚŹŻ]{0,8})$/i);
    if (m && ZNACZNIKI.some((zn) => zn.startsWith(m[1].toUpperCase()))) t = t.slice(0, m.index);
    // Urwany początek „<tool_call>” też nie mignie na ekranie.
    const ogon = t.match(/<[a-z_]{0,9}$/i);
    if (ogon && '<tool_call>'.startsWith(ogon[0].toLowerCase())) t = t.slice(0, ogon.index);
    return t.replace(/<\/?t?h?i?n?k?$/i, '');
  }

  /** Wstaw znaczniki zdjęć pod akapitami, których dotyczą.
   *  Model poproszony o zdjęcia do gotowego planu potrafi napisać plan bez
   *  znaczników. Wtedy sami decydujemy, gdzie je postawić: pod akapitem, który
   *  najwięcej mówi o danym miejscu (słowa zapytania w akapicie), a gdy żaden
   *  nic nie mówi – na końcu. Zdjęcia katedry pod punktem o katedrze, nie
   *  zbiorczo pod całą odpowiedzią. */
  function wstawZnacznikiZdjec(tekst, zapytania) {
    const bloki = String(tekst || '').split(/\n{2,}/);
    const slowa = (x) => bezOgonkowKlient(x).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter((w) => w.length >= 4);
    const doBloku = new Map();
    const wBlokach = bloki.map((b) => new Set(slowa(b)));
    const pasuje = (w, x) => w.has(x) || [...w].some((y) => y.startsWith(x.slice(0, 5)));
    for (const q of zapytania) {
      const szukane = slowa(q);
      /* Wagi: pierwsze słowo zapytania to zwykle samo miejsce („Wawel"
         w „Wawel Kraków") – liczy się podwójnie; słowo obecne w wielu
         akapitach (nazwa miasta w nagłówku planu) – mniej. */
      const waga = szukane.map((x, j) => (j === 0 ? 2 : 1) / Math.max(1, wBlokach.filter((w) => pasuje(w, x)).length));
      let najlepszy = bloki.length - 1;
      let wynik = 0;
      wBlokach.forEach((w, i) => {
        const trafien = szukane.reduce((suma, x, j) => suma + (pasuje(w, x) ? waga[j] : 0), 0);
        if (trafien > wynik) { wynik = trafien; najlepszy = i; }
      });
      if (!doBloku.has(najlepszy)) doBloku.set(najlepszy, []);
      doBloku.get(najlepszy).push(q);
    }
    return bloki.map((b, i) => (doBloku.has(i) ? `${b}\n[GRAFIKA: ${doBloku.get(i).join('; ')}]` : b)).join('\n\n');
  }

  /* ============ ZDJĘCIA W JEDNEJ ODPOWIEDZI (runda 10) ============
     Plan ze znacznikami [GRAFIKA:] był krojony na kawałki: tekst dnia, osobna
     wiadomość ze zdjęciami, kolejny kawałek. Marcin: „grafiki powinny być
     serwowane jak w ChatGPT, w poziomym scrollu, a nie w oddzielnej
     odpowiedzi zawsze pod sobą”. Teraz tekst zostaje JEDEN, a przy każdym
     zapytaniu zapisujemy, gdzie stał znacznik (`po`) i w której sekcji
     (`sekcja` = liczba nagłówków przed nim) – z tego widok stawia pasek nad
     treścią sekcji, a historia dla modelu wstawia znacznik z powrotem.

     Ta sama funkcja liczy to w przeglądarce (narzędzie grafik) i na serwerze
     (odpowiedź-sierota, lib/biegi.js) – inaczej zdjęcia z telefonu, który
     zgasł w trakcie, stawałyby w innych miejscach niż te z otwartej karty. */
  const MAX_ZNACZNIKOW_ZDJEC = 16;
  const MAX_ZAPYTAN_ZDJEC = 24;
  const ZAPYTAN_NA_ZNACZNIK = 4;
  const NAGLOWEK_MD = /^#{1,4}\s+/;          // to samo, co renderMarkdown rysuje jako h1–h4
  const PLOT_MD = /^```/;

  /** Ile nagłówków Markdown stoi w `tekst` przed pozycją `po` – poza blokami
   *  kodu i cytatami (renderMarkdown rysuje je inaczej). */
  function sekcjaWPozycji(tekst, po) {
    let wKodzie = false;
    let ile = 0;
    let pozycja = 0;
    for (const linia of String(tekst || '').split('\n')) {
      if (pozycja >= po) break;
      if (PLOT_MD.test(linia)) wKodzie = !wKodzie;
      else if (!wKodzie && NAGLOWEK_MD.test(linia)) ile++;
      pozycja += linia.length + 1;
    }
    return ile;
  }

  /**
   * Rozłóż odpowiedź ze znacznikami zdjęć na czysty tekst i miejsca zdjęć.
   *
   * @param {string} surowe tekst modelu (bez `<think>`)
   * @returns {{ tresc: string, zdjecia: Array<{q: string, etykieta: string, po: number, sekcja: number}>, pominiete: string[] }}
   */
  function rozlozZdjecia(surowe) {
    const WZ = new RegExp(PHOTO_MARKER_RE.source, 'gi');
    const ZNAK = (n) => `${n}`;
    const grupy = [];            // numer znacznika → zapytania
    const pominiete = [];
    const widziane = new Set();
    let zapytan = 0;
    let znacznikow = 0;
    const linie = [];
    for (const linia of String(surowe || '').split('\n')) {
      const trafienia = [...linia.matchAll(WZ)];
      if (!trafienia.length) { linie.push(linia); continue; }
      /* Co zostaje z linii bez znacznika. Sam punktor („- [GRAFIKA: …]”) albo
         pogrubienie wokół znacznika – linia wypada. Tekst obok znacznika
         („Wieczór nad Isola Bella [GRAFIKA: Isola Bella]”) – zostaje,
         a zdjęcia stają za tą linią. */
      const reszta = linia.replace(WZ, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, '');
      if (!/^[ \t]*(?:[-*+•]|\d{1,3}[.)])?[ \t]*[*_`]*[ \t]*$/.test(reszta)) linie.push(reszta);
      for (const t of trafienia) {
        const numer = grupy.length;
        const wziete = [];
        for (const q of t[1].split(/[;；]/).map((x) => x.trim()).filter(Boolean)) {
          const klucz = bezOgonkowKlient(q);
          if (widziane.has(klucz)) continue;         // ta sama rzecz drugi raz w jednej odpowiedzi
          widziane.add(klucz);
          if (znacznikow >= MAX_ZNACZNIKOW_ZDJEC || zapytan >= MAX_ZAPYTAN_ZDJEC || wziete.length >= ZAPYTAN_NA_ZNACZNIK) {
            pominiete.push(q);
            continue;
          }
          wziete.push(q);
          zapytan++;
        }
        if (wziete.length) znacznikow++;
        grupy.push(wziete);
        linie.push(ZNAK(numer));
      }
    }
    /* Znacznik opakowany w ```blok``` (modele to lubią): po wycięciu zostaje
       płot bez treści – wypada razem ze znacznikiem. */
    const tylkoZnaki = /^(?:\d+|[ \t]*)$/;
    for (let i = 0; i < linie.length; i++) {
      if (!PLOT_MD.test(linie[i])) continue;
      let j = i + 1;
      while (j < linie.length && !/^```\s*$/.test(linie[j]) && tylkoZnaki.test(linie[j])) j++;
      if (j < linie.length && j > i + 1 && /^```\s*$/.test(linie[j])) { linie[i] = ''; linie[j] = ''; i = j; }
    }
    // Pozostałe znaczniki (np. [PLAN:] w tej samej odpowiedzi) i rusztowanie – wspólnym czyszczeniem.
    const czyste = stripSearchMarker(linie.join('\n'));
    const wynik = [];
    const kotwice = [];          // [numer znacznika, indeks linii w wyniku]
    for (const linia of czyste.split('\n')) {
      const m = linia.match(/^(\d+)$/);
      if (m) { kotwice.push([Number(m[1]), wynik.length]); continue; }
      const czysta = linia.replace(/\d+/g, '');
      // Puste linie bez powtórek – po wycięciu znaczników zostawały dziury.
      if (!czysta.trim() && (!wynik.length || !wynik[wynik.length - 1].trim())) continue;
      wynik.push(czysta);
    }
    while (wynik.length && !wynik[wynik.length - 1].trim()) wynik.pop();
    const tresc = wynik.join('\n');
    const poczatki = [];
    let suma = 0;
    for (const l of wynik) { poczatki.push(suma); suma += l.length + 1; }
    const zdjecia = [];
    for (const [numer, linia] of kotwice) {
      const po = linia < poczatki.length ? poczatki[linia] : tresc.length;
      const sekcja = sekcjaWPozycji(tresc, po);
      for (const q of grupy[numer] || []) zdjecia.push({ q, etykieta: q, po, sekcja });
    }
    return { tresc, zdjecia, pominiete };
  }

  /** Tekst z powrotem ZE znacznikami – dla modelu w historii rozmowy.
   *  Model widzi własny protokół w miejscu, gdzie go postawił, a nie ramkę
   *  „(pokazano zdjęcia: …)”, którą słabe modele przepisywały na ekran. */
  function zeZnacznikamiZdjec(tresc, zdjecia) {
    let tekst = String(tresc || '');
    const poMiejscu = new Map();
    for (const g of zdjecia || []) {
      if (!g || !g.q) continue;
      const po = Math.max(0, Math.min(tekst.length, Number(g.po) || 0));
      if (!poMiejscu.has(po)) poMiejscu.set(po, []);
      poMiejscu.get(po).push(g.q);
    }
    for (const po of [...poMiejscu.keys()].sort((a, b) => b - a)) {
      const przed = tekst.slice(0, po);
      const znacznik = `[GRAFIKA: ${poMiejscu.get(po).join('; ')}]`;
      tekst = przed + (przed && !przed.endsWith('\n') ? '\n' : '') + znacznik + '\n' + tekst.slice(po);
    }
    return tekst.replace(/\n+$/, '');
  }

  /* ============ WYNIK ARCHIWUM → KONTEKST MODELU ============
     To jest miejsce, w którym Cosmos przez długi czas okłamywał sam siebie.

     Odpowiedź archiwum szła do modelu jako `JSON.stringify(dane).slice(0, 12000)`.
     Brzmi niewinnie, dopóki się nie policzy: sam adres jednej miniatury z OneDrive
     to 1248 znaków podpisanego tokenu, przy ~520 znakach reszty wpisu. Czyli
     z dwunastu tysięcy znaków mieściło się SZEŚĆ plików, a 71% tego, co czytał
     model, stanowiły adresy obrazków – których on nawet nie ogląda, bo w tym
     samym promptcie piszemy mu, że miniatury już pokazaliśmy człowiekowi.
     Do tego `slice` tnie napis w połowie JSON-a, więc model dostawał składniowo
     zepsuty dokument.

     Efekt na żywym archiwum: przy 59 421 plikach model widział sześć najnowszych
     (bo sortujemy od najnowszych – czyli akurat zrzuty ekranu z telefonu),
     dostawał polecenie „odpowiadaj na podstawie tych danych, nie zgaduj"
     i uczciwie meldował, że w archiwum nie ma zdjęć z aparatu. To nie była
     halucynacja. To był poprawny wniosek z próbki, którą sami mu podsunęliśmy.

     Dlatego: miniatury i identyfikatory wylatują, wpisy skracamy do pól, które
     naprawdę niosą treść, a na górze stoi jawne zdanie o tym, ILE tego jest
     i CZEGO model nie widzi. „Pokazuję 40 z 59 421" to zupełnie inna przesłanka
     niż „oto twoje archiwum". */
  const ARCH_LIMIT_ZNAKOW = 12000;

  function naKontekst(dane) {
    if (!dane || typeof dane !== 'object') return JSON.stringify(dane);
    if (!Array.isArray(dane.wyniki)) return JSON.stringify(dane, null, 1).slice(0, ARCH_LIMIT_ZNAKOW);

    const chude = dane.wyniki.map((w) => {
      const o = {};
      for (const [k, v] of Object.entries(w)) {
        // `miniatura` to 1,2 kB podpisanego adresu; `id` i `rozmiar` nic nie wnoszą.
        if (k === 'miniatura' || k === 'id' || k === 'rozmiar') continue;
        if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
        /* O ŹRÓDLE DATY MÓWIMY TYLKO WTEDY, GDY JEST SŁABE.
           `exif` i `nazwa` niosą moment zrobienia zdjęcia i nie ma o czym
           wspominać – powtarzanie tego przy każdym z kilkudziesięciu wpisów
           to czysty koszt kontekstu. `plik` znaczy „to jest data WGRANIA do
           chmury, nie data zdjęcia", a to model musi wiedzieć, zanim poda ją
           człowiekowi jako fakt. Zamieniamy więc na czytelną flagę. */
        if (k === 'dataZrodlo') {
          if (v === 'plik') o.dataNiepewna = 'to data wgrania pliku, nie zrobienia zdjęcia';
          continue;
        }
        o[k] = v;
      }
      return o;
    });

    /* Ile wpisów zmieści się w budżecie – liczone, a nie zgadywane. Bez
       miniatur wchodzi ich kilkadziesiąt zamiast sześciu. */
    let ile = chude.length;
    let tresc = '';
    while (ile > 0) {
      tresc = JSON.stringify({ ...dane, wyniki: chude.slice(0, ile) }, null, 1);
      if (tresc.length <= ARCH_LIMIT_ZNAKOW) break;
      ile = Math.floor(ile * 0.8);
    }

    const znaleziono = Number(dane.znaleziono) || 0;
    const naglowek = znaleziono > ile
      ? `UWAGA: widzisz ${ile} z ${znaleziono} pasujących plików, posortowane OD NAJNOWSZYCH. `
        + 'To jest PRÓBKA, nie całe archiwum – nie wyciągaj z niej wniosków o tym, czego '
        + 'w archiwum NIE MA. Jeśli chcesz wiedzieć, co tam jest w całości, poproś '
        + 'o zestawienie (grupuj=aparat, grupuj=rok, grupuj=temat) albo zawęź filtry.\n'
        + 'LIMIT DOTYCZY CIEBIE, NIE UŻYTKOWNIKA. On widzi wszystkie miniatury '
        + `i sam dojdzie do ostatniego z ${znaleziono} plików. Nie pisz mu więc, `
        + 'że pokazujesz tylko część, nie przepraszaj za limit, nie proponuj '
        + 'zawężenia, i nie tłumacz, jak działa przeglądanie '
        + `– napisz po prostu, ile ich jest (${znaleziono}).\n`
      : '';
    return naglowek + tresc.slice(0, ARCH_LIMIT_ZNAKOW);
  }

  const IMAGE_MARKER_RE = znacznik('OBRAZ');
  /* Znalezione zdjęcia to co innego niż wygenerowane. Bez tego znacznika model
     na „pokaż zdjęcia tych miejsc" odpowiadał „nie mam dostępu do wyszukiwania
     obrazów" i proponował wizje artystyczne zamiast prawdziwej Majorki. */
  const PHOTO_MARKER_RE = znacznik('GRAFIKA');
  /* Kod do wykonania. Jedyne narzędzie zapisane blokiem, nie znacznikiem –
     program nie mieści się w jednej linii. */
  const RUN_FENCE_RE = /```uruchom\s*\n([\s\S]*?)```/i;
  /* Płótno: dokument obok rozmowy. Tworzenie i podmiana fragmentu to dwie różne
     rzeczy – przy scenariuszu na trzy tysiące słów przepisywanie całości przy
     każdej poprawce trwa minutę i za każdym razem coś się po drodze gubi. */
  const CANVAS_NEW_RE = /```płótno(?::\s*([^\n]*))?\s*\n([\s\S]*?)```/i;
  const CANVAS_PATCH_RE = /```płótno-zmiana\s*\n([\s\S]*?)```/i;
  // Dwukropek obowiązkowy i nigdy odnośnik – „[Archiwum Narodowe](…)" to link.
  const ARCHIVE_RE = znacznik('ARCHIWUM', `(${TRESC}*?)`);
  const PLAN_RE = znacznik('PLAN', `(${TRESC}*?)`);
  /* Formy akcji z małych modeli (zespół IT, runda 7): kreska pełnej szerokości
     „｜”, dwukropek albo półpauza zamiast „|”, a w treści odnośnik Markdown
     „[onet.pl](https://onet.pl)”. Dawniej akcja się nie wykonywała, a znacznik
     i tak znikał – człowiek dostawał pustą odpowiedź. */
  const LINK_MD = '\\[[^\\]\\n]*\\]\\([^)\\n]*\\)';
  const ACTION_RE = new RegExp(`${OTW}AKCJA${DWUKROPEK}([^|｜\\]】:：–\\n]+?)\\s*(?:[|｜:：–]|\\s-\\s)\\s*((?:${LINK_MD}|${TRESC})+?)${ZAM}`, 'i');

  /* „Katedra La Seu" i „katedra la seu" to to samo pytanie o zdjęcia. Bez
     ujednolicenia model prosiłby o tę samą rzecz raz po raz, tylko inaczej
     zapisaną, i wypalał limit rund na jednym budynku. */
  function bezOgonkowKlient(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ł/gi, 'l').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Od której wiadomości uciąć rozmowę przy „Ponów"/„Regeneruj" pod wiadomością
   *  `idx`. Zwykle od niej samej. Pod BŁĘDEM – od razu za pytaniem człowieka:
   *  błąd, który przyszedł po fragmencie odpowiedzi, zostawiał ten fragment
   *  jako ostatnią wiadomość, a Claude 4.6+/5 odrzuca to kodem 400 („does not
   *  support assistant message prefill") – „Ponów" nie działało nigdy, a na
   *  OpenAI zostawały dwie wiadomości asystenta (zespół IT, runda 4). */
  function granicaPonowienia(wiadomosci, idx) {
    const m = wiadomosci[idx];
    if (!m || !m.error) return idx;
    for (let i = idx - 1; i >= 0; i--) {
      if (wiadomosci[i].role === 'user' && !wiadomosci[i].search) return i + 1;
    }
    return idx;
  }

  /** Scal: wspólny początek, potem to, co dopisał serwer (inne urządzenie),
   *  potem to, co dopisano tutaj. Wyjątek: odpowiedź zapisana przez serwer
   *  awaryjnie (`bieg` – nikt jej wtedy nie odebrał) ustępuje odpowiedzi,
   *  którą ta karta ma u siebie – inaczej ta sama odpowiedź stałaby dwa razy. */
  function scalRozmowy(tutaj, serwer) {
    const podpis = (m) => JSON.stringify([m.role, m.content]);
    const a = tutaj.messages || [];
    const b = serwer.messages || [];
    let wspolne = 0;
    while (wspolne < a.length && wspolne < b.length && podpis(a[wspolne]) === podpis(b[wspolne])) wspolne++;
    const zSerwera = new Set(b.map(podpis));
    const tutajPo = a.slice(wspolne).filter((m) => !zSerwera.has(podpis(m)));
    const mamSwojaOdpowiedz = tutajPo.some((m) => m.role === 'assistant');
    const serwerPo = b.slice(wspolne).filter((m) => !(m.bieg && mamSwojaOdpowiedz));
    return { ...serwer, ...tutaj, messages: [...b.slice(0, wspolne), ...serwerPo, ...tutajPo] };
  }

  /* JEDNOSTKI NA GŁOS. Lektor dostaje tekst dla oka: „20 °C”, „12%”, „15 km/h”.
     ElevenLabs czytał „°C” po angielsku („degrisy”), a Piper i głos systemowy
     pomijali znak albo czytali go literami (zgłoszenie Marcina). Zamieniamy
     jednostki na słowa z polską odmianą: 1 stopień, 2 stopnie, 5 stopni,
     20,5 stopnia. Tylko tuż po liczbie, żeby nie ruszać zwykłego tekstu.

     Runda 5 (agencja: frontend, rozmowa, copywriter): tak samo zapis
     fotograficzny i jednostki z planu zdjęciowego, który jest rdzeniem Cosmosa
     i najczęściej czytaną rzeczą w terenie. „f/2.8, 1/250 s, 20 s, 450 m,
     1 h 20 min, 6:41–7:25” szło literami: „f łamane przez dwa kropka osiem”,
     „es”, „em”, „ha”. Do tego skróty („np.”, „ok. 2 godz.”), minus zapisany
     półpauzą („–2 °C” gubił minus), „~”, „≈”, „±” i „&”. */
  // Koniec jednostki: nie litera i nie cyfra. `\b` w JS nie zna polskich liter
  // („2 są” – po „s” stoi „ą”, dla `\b` to granica słowa).
  const KONIEC = '(?![\\p{L}\\p{N}])';
  const JEDNOSTKI_PL = [
    // [wzorzec jednostki, [1, 2–4, 5+, ułamek], dopisek, najmniej cyfr w liczbie]
    [/°\s*C/, ['stopień', 'stopnie', 'stopni', 'stopnia'], ' Celsjusza'],
    [/°\s*F/, ['stopień', 'stopnie', 'stopni', 'stopnia'], ' Fahrenheita'],
    [/°/, ['stopień', 'stopnie', 'stopni', 'stopnia'], ''],
    [/km\/h/, ['kilometr', 'kilometry', 'kilometrów', 'kilometra'], ' na godzinę'],
    [/m\/s/, ['metr', 'metry', 'metrów', 'metra'], ' na sekundę'],
    [/hPa/, ['hektopaskal', 'hektopaskale', 'hektopaskali', 'hektopaskala'], ''],
    [/mm/, ['milimetr', 'milimetry', 'milimetrów', 'milimetra'], ''],
    [/cm/, ['centymetr', 'centymetry', 'centymetrów', 'centymetra'], ''],
    [/km/, ['kilometr', 'kilometry', 'kilometrów', 'kilometra'], ''],
    [/m/, ['metr', 'metry', 'metrów', 'metra'], ''],
    [/%/, ['procent', 'procent', 'procent', 'procent'], ''],
    [/min/, ['minuta', 'minuty', 'minut', 'minuty'], ''],
    [/(?:h|godz\.)/, ['godzina', 'godziny', 'godzin', 'godziny'], ''],
    [/s/, ['sekunda', 'sekundy', 'sekund', 'sekundy'], ''],
    [/l/, ['litr', 'litry', 'litrów', 'litra'], ''],
    [/kg/, ['kilogram', 'kilogramy', 'kilogramów', 'kilograma'], ''],
    [/kB/, ['kilobajt', 'kilobajty', 'kilobajtów', 'kilobajta'], ''],
    [/MB/, ['megabajt', 'megabajty', 'megabajtów', 'megabajta'], ''],
    [/GB/, ['gigabajt', 'gigabajty', 'gigabajtów', 'gigabajta'], ''],
    [/px/, ['piksel', 'piksele', 'pikseli', 'piksela'], ''],
    // Kelwiny tylko od czterech cyfr: „5600 K” to barwa światła, „4K” to wideo.
    [/K/, ['kelwin', 'kelwiny', 'kelwinów', 'kelwina'], '', 4],
  ];
  const JEDNOSTKI_EN = [
    [/°\s*C/, ['degree', 'degrees'], ' Celsius'],
    [/°\s*F/, ['degree', 'degrees'], ' Fahrenheit'],
    [/°/, ['degree', 'degrees'], ''],
    [/km\/h/, ['kilometre', 'kilometres'], ' per hour'],
    [/m\/s/, ['metre', 'metres'], ' per second'],
    [/hPa/, ['hectopascal', 'hectopascals'], ''],
    [/mm/, ['millimetre', 'millimetres'], ''],
    [/cm/, ['centimetre', 'centimetres'], ''],
    [/km/, ['kilometre', 'kilometres'], ''],
    [/m/, ['metre', 'metres'], ''],
    [/%/, ['percent', 'percent'], ''],
    [/min/, ['minute', 'minutes'], ''],
    [/(?:h|godz\.)/, ['hour', 'hours'], ''],
    [/s/, ['second', 'seconds'], ''],
    [/l/, ['litre', 'litres'], ''],
    [/kg/, ['kilogram', 'kilograms'], ''],
    [/kB/, ['kilobyte', 'kilobytes'], ''],
    [/MB/, ['megabyte', 'megabytes'], ''],
    [/GB/, ['gigabyte', 'gigabytes'], ''],
    [/px/, ['pixel', 'pixels'], ''],
    [/K/, ['kelvin', 'kelvins'], '', 4],
  ];
  // Jednostki, po których „10–20” to zakres („od 10 do 20 minut”).
  const JEDNOSTKA_ZAKRESU = `(?:${JEDNOSTKI_PL.map(([w]) => w.source).join('|')})${KONIEC}`;

  /* Skróty. Kropka skrótu bywa zarazem końcem zdania („…i tak dalej. Potem”):
     przy skrótach, które zamykają zdanie, kropka zostaje, gdy po niej nic nie
     ma albo zaczyna się nowe zdanie. „m.in. Wawel” to środek zdania. */
  const SKROTY = [
    // [wzorzec (bez kropki końcowej), po polsku, po angielsku, może zamykać zdanie]
    [/m\.in/, 'między innymi', 'among others'],
    [/n\.p\.m/, 'nad poziomem morza', 'above sea level', true],
    [/np/, 'na przykład', 'for example'],
    [/tj/, 'to jest', 'that is'],
    [/itp/, 'i tak dalej', 'and so on', true],
    [/itd/, 'i tak dalej', 'and so on', true],
    [/temp/, 'temperatura', 'temperature'],
    [/e\.g/, 'na przykład', 'for example'],
    [/i\.e/, 'to jest', 'that is'],
    // „ok.” tylko przed liczbą – „Ok.” na początku zdania to „okej”.
    [/ok(?=\.\s*\d)/, 'około', 'about'],
    // „godz.” bez liczby przed nim; po liczbie to jednostka (tabela wyżej).
    [/o\s+godz/, 'o godzinie', 'at'],
    [/(?:od|z)\s+godz/, 'od godziny', 'from'],
    [/do\s+godz/, 'do godziny', 'until'],
    [/w\s+godz/, 'w godzinach', 'between'],
    [/godz(?=\.\s*\d)/, 'godzina', 'hour'],
  ];

  function formaPl(liczba, [jeden, kilka, wiele, ulamek]) {
    if (/[.,]/.test(liczba)) return ulamek;
    const n = Math.abs(parseInt(liczba, 10));
    if (n === 1) return jeden;
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return kilka;
    return wiele;
  }
  // Wzorzec „kilka” dla formaPl: czy liczba bierze formę 2–4 („dwa, trzy, cztery stopnie”).
  const KILKA = ['jeden', 'kilka', 'wiele', 'ulamek'];
  // Przyimki, po których zakres nie dostaje „od”: „o 6:55 do 7:10”, „za 2 do 3 minut”.
  const PRZYIMEK_BEZ_OD = /^(?:o|za|po|przez|na|w|we|z|ze|co|at|in|for|by|within|after)\s+$/i;
  // Czy w tym miejscu kończy się zdanie (reszta pusta albo od wielkiej litery).
  const koniecZdania = (reszta) => /^\s*(?:$|\p{Lu})/u.test(reszta);

  function jednostkiNaGlos(tekst, jezyk = 'pl') {
    const en = jezyk === 'en';
    let t = String(tekst || '');
    // Selektor wariantu (U+FE0E/FE0F) zostaje po wyciętym „⚠︎” – niewidoczny, ale lektor go dostaje.
    t = t.replace(/[︎️]/g, '');

    for (const [wzor, pl, ang, zamyka] of SKROTY) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${wzor.source}\\.`, 'giu');
      t = t.replace(re, (cale, ...r) => {
        const offset = r[r.length - 2];
        const calosc = r[r.length - 1];
        let slowo = en ? ang : pl;
        if (/^\p{Lu}/u.test(cale)) slowo = slowo[0].toUpperCase() + slowo.slice(1);
        return slowo + (zamyka && koniecZdania(calosc.slice(offset + cale.length)) ? '.' : '');
      });
    }

    // „~20 min”, „≈ 3 h” → „około”; „± 10 zł” → „plus minus”.
    t = t.replace(/~\s*(?=[−–-]?\d)/g, en ? 'about ' : 'około ')
      .replace(/\s*≈\s*/g, (m, i) => (i === 0 ? '' : ' ') + (en ? 'about ' : 'około '))
      .replace(/\s*±\s*/g, (m, i) => (i === 0 ? '' : ' ') + (en ? 'plus or minus ' : 'plus minus '));

    // Przysłona: „f/2.8” → „f 2,8” (po polsku przecinek, inaczej „dwa kropka osiem”).
    t = t.replace(/(?<![\p{L}\p{N}/])f\s*\/\s*(\d+)(?:[.,](\d+))?/gu,
      (_, c, u) => `f ${c}${u ? (en ? '.' : ',') + u : ''}`);
    // Czas naświetlania: „1/250 s” → „1/250 sekundy”.
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}/])(\\d+)\\/(\\d+)\\s*s${KONIEC}`, 'gu'),
      (_, a, b) => `${a}/${b} ${en ? 'of a second' : 'sekundy'}`);

    const odDo = (slowo, a, b) => {
      const maOd = /^(?:od|from)\s+$/i.test(slowo);   // „od 10–20 °C” nie dostaje drugiego „od”
      // „około 8–9 °C” → „około ośmiu do dziewięciu”, nie „około od ośmiu do dziewięciu” (runda 8).
      const przyblizenie = /^(?:około|ok\.|about|around)\s+$/i.test(slowo);
      /* Po innym przyimku drugiego nie dokładamy: „o 6:55–7:10” to „o szóstej
         pięćdziesiąt pięć do siódmej dziesięć”, nie „o od szóstej…”; „wzrośnie
         o 2–3 °C”, „za 2–3 min”, „na 3–5 dni” tak samo (runda 9). */
      const przyimek = PRZYIMEK_BEZ_OD.test(slowo);
      return `${slowo}${maOd || przyblizenie || przyimek ? '' : (en ? 'from ' : 'od ')}${a} ${en ? 'to' : 'do'} ${b}`;
    };
    /* Minus w działaniu: „10 − 4 = 6” to „dziesięć minus cztery”, nie zakres
       (runda 9). Znak minus (U+2212) ze spacjami z obu stron jest działaniem;
       bez spacji („8−9 °C”) – łącznikiem zakresu jak niżej. */
    t = t.replace(/(\d)[ \u00a0]+\u2212[ \u00a0]+(?=\d)/g, '$1 minus ');
    /* Łącznik zakresu to nie tylko „-” i „–”: modele piszą też łącznik
       niełamiący (U+2011), minus (U+2212) i kreskę cyfrową (U+2012). Z nimi
       zakres nie był rozpoznany i lektor czytał „około ośmiu-9 stopni”
       (Marcin, runda 8). Minus po łączniku to drugi koniec ujemny („-3‑-1”). */
    t = t.replace(/(\d)\s*[\u2010\u2011\u2012\u2212]\s*(?=[\u2212-]?\d)/g, '$1–');
    /* Zakres po „około”: „około 8–9 stopni” → „około 8 do 9 stopni” (odmienia
       liczbyNaGlos). Także na końcu zdania i przed przecinkiem – „Około 8–9.”
       to dokładnie kształt odpowiedzi w trybie głosowym, a reguła z rundy 8
       wymagała słowa po zakresie i lektor czytał „Około ośmiu–9.” (runda 9).
       Po polsku zakres kończący się na 2–4 przed zwykłym rzeczownikiem zostaje
       dla liczbyNaGlos: rzeczownik stoi wtedy w mianowniku („około 2–3
       godziny”), więc „około dwóch do trzech godziny” byłoby błędem. */
    t = t.replace(/(?<![\p{L}])((?:około|ok\.|about|around)\s+)(\d+(?:[.,]\d+)?)\s*[–-]\s*(\d+(?:[.,]\d+)?)(?=(\s+\p{L})|\s*[.,;:!?()…]|\s*$)/giu,
      (cale, slowo, a, b, zaSlowem, offset, calosc) => {
        if (!en && zaSlowem && formaPl(b, KILKA) === KILKA[1]
          && !new RegExp(`^\\s*${JEDNOSTKA_ZAKRESU}`, 'u').test(calosc.slice(offset + cale.length))) return cale;
        return odDo(slowo, a, b);
      });
    // Zakres godzin „6:41–7:25”: „od 6:41 do 7:25”.
    t = t.replace(/(\p{L}+\s+)?(?<![\p{N}:])(\d{1,2}:\d{2})\s*[–\u2014-]\s*(\d{1,2}:\d{2})(?![\p{N}:])/gu,
      (_, slowo = '', a, b) => odDo(slowo, a, b));
    /* Zakres „10–20 °C”: „od 10 do 20 stopni”, a nie „10 20 stopni”. Końce
       mogą być ujemne („-3–-1 °C” → „od minus 3 do minus 1”); minus przed
       pierwszym tylko po spacji, nawiasie albo na początku (runda 9). */
    t = t.replace(new RegExp(`(\\p{L}+\\s+)?(?<![\\p{N}.,:/])((?:(?<=^|[\\s(])[\\u2212–-])?\\d+(?:[.,]\\d+)?)\\s*[–-]\\s*([\\u2212-]?\\d+(?:[.,]\\d+)?)(?=\\s*${JEDNOSTKA_ZAKRESU})`, 'gu'),
      (_, slowo = '', a, b) => odDo(slowo, a, b));

    /* Minus i plus przed liczbą: „EV −0,7”, „do –2 °C” (półpauza – tak piszą
       modele i polska typografia), „+1 EV”. Tylko po spacji, nawiasie albo na
       początku i nie po liczbie: „10 – 20 osób” to nie minus, „COVID-19” też. */
    t = t.replace(/(?<=^|[\s(])(?<!\p{N}\s*)[−–-](?=\d)/gu, 'minus ')
      .replace(/(?<=^|[\s(])(?<!\p{N}\s*)\+(?=\d)/gu, 'plus ');

    for (const [wzor, formy, dopisek, cyfr = 1] of (en ? JEDNOSTKI_EN : JEDNOSTKI_PL)) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}.,:/])(\\d{${cyfr},}(?:[.,]\\d+)?)\\s*${wzor.source}${KONIEC}`, 'gu');
      t = t.replace(re, (cale, liczba, offset, calosc) => {
        /* Po przyimku z dopełniaczem jednostka też idzie w dopełniaczu: „do 2 °C”
           to „do dwóch stopni”, nie „do dwóch stopnie”; „około 21–24 °C” – drugi
           koniec stoi po „do”. Liczebnik odmienia potem liczbyNaGlos (krok 4),
           ale formę jednostki trzeba wybrać tutaj (runda 9). */
        const poPrzyimku = !en && !/[.,]/.test(liczba) && PO_PRZYIMKU_DOP.test(calosc.slice(Math.max(0, offset - 30), offset));
        const slowo = en ? (liczba === '1' ? formy[0] : formy[1])
          : poPrzyimku ? (liczba === '1' ? formy[3] : formy[2]) : formaPl(liczba, formy);
        // „2 godz. Potem” – kropka skrótu była też końcem zdania.
        const kropka = cale.endsWith('.') && koniecZdania(calosc.slice(offset + cale.length)) ? '.' : '';
        return `${liczba} ${slowo}${dopisek}${kropka}`;
      });
    }

    // „2× szybciej” → „2 razy”.
    t = t.replace(/(\d)\s*×/g, `$1 ${en ? 'times' : 'razy'}`);
    // „rock & roll”, „R&D” → „i” / „and”.
    t = t.replace(/\s*&\s*/g, en ? ' and ' : ' i ');
    /* Wiszący podpis na końcu: „…przed świtem. Szczegóły:” – adres, który stał
       za dwukropkiem, wyciął stripForSpeech, a lektor czytał samo „Szczegóły”. */
    t = t.replace(/([.!?…])\s+[^.!?…:]{1,40}:\s*$/u, '$1');
    return t.replace(/ {2,}/g, ' ');
  }

  /* ---- LICZBY SŁOWAMI, W DOBRYM PRZYPADKU ---------------------------------
     Marcin: „w trybie głosowym należy poprawić odmianę liczb, bo teraz mówi je
     w ogóle ich nie odmieniając”. Każdy lektor (Piper, ElevenLabs, OpenAI) czyta
     cyfry w mianowniku: „do dwadzieścia jeden stopni”, „o siedemnaście zero
     zero”, „dwanaście września”, „dwa godziny”. Tu zamieniamy je na słowa tam,
     gdzie przypadek da się ustalić pewnie – po przyimku, przy godzinie, dacie
     i roku, i przed rzeczownikiem rodzaju żeńskiego. Reszta zostaje cyframi:
     w mianowniku lektor i tak przeczyta ją dobrze, a zgadywanie przypadku
     w ciemno psułoby więcej, niż naprawia. */
  const L_JEDN = { m: ['zero', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'],
    d: ['zera', 'jednego', 'dwóch', 'trzech', 'czterech', 'pięciu', 'sześciu', 'siedmiu', 'ośmiu', 'dziewięciu'] };
  const L_NAST = { m: ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'],
    d: ['dziesięciu', 'jedenastu', 'dwunastu', 'trzynastu', 'czternastu', 'piętnastu', 'szesnastu', 'siedemnastu', 'osiemnastu', 'dziewiętnastu'] };
  const L_DZIES = { m: ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'],
    d: ['', '', 'dwudziestu', 'trzydziestu', 'czterdziestu', 'pięćdziesięciu', 'sześćdziesięciu', 'siedemdziesięciu', 'osiemdziesięciu', 'dziewięćdziesięciu'] };
  const L_SETKI = { m: ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'],
    d: ['', 'stu', 'dwustu', 'trzystu', 'czterystu', 'pięciuset', 'sześciuset', 'siedmiuset', 'ośmiuset', 'dziewięciuset'] };
  // Liczebniki porządkowe, rodzaj męski, dopełniacz: „dwunastego”, „dwudziestego”.
  const P_JEDN = ['', 'pierwszego', 'drugiego', 'trzeciego', 'czwartego', 'piątego', 'szóstego', 'siódmego', 'ósmego', 'dziewiątego'];
  const P_NAST = ['dziesiątego', 'jedenastego', 'dwunastego', 'trzynastego', 'czternastego', 'piętnastego', 'szesnastego', 'siedemnastego', 'osiemnastego', 'dziewiętnastego'];
  const P_DZIES = ['', '', 'dwudziestego', 'trzydziestego', 'czterdziestego', 'pięćdziesiątego', 'sześćdziesiątego', 'siedemdziesiątego', 'osiemdziesiątego', 'dziewięćdziesiątego'];
  const P_SETKI = ['', 'setnego', 'dwusetnego', 'trzechsetnego', 'czterechsetnego', 'pięćsetnego', 'sześćsetnego', 'siedemsetnego', 'osiemsetnego', 'dziewięćsetnego'];
  // Godziny: liczebnik porządkowy, rodzaj żeński („siedemnasta”).
  const GODZINY = ['zero', 'pierwsza', 'druga', 'trzecia', 'czwarta', 'piąta', 'szósta', 'siódma', 'ósma', 'dziewiąta',
    'dziesiąta', 'jedenasta', 'dwunasta', 'trzynasta', 'czternasta', 'piętnasta', 'szesnasta', 'siedemnasta', 'osiemnasta',
    'dziewiętnasta', 'dwudziesta', 'dwudziesta pierwsza', 'dwudziesta druga', 'dwudziesta trzecia', 'dwudziesta czwarta'];
  const MIESIACE = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
  const MIESIACE_MSC = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu'];
  const MIES_SKROT = { sty: 0, lut: 1, mar: 2, kwi: 3, maj: 4, cze: 5, lip: 6, sie: 7, wrz: 8, 'paź': 9, paz: 9, lis: 10, gru: 11 };

  /** 1..999 słownie; `p` = 'm' (mianownik) albo 'd' (dopełniacz). */
  function doTysiaca(n, p, zenski) {
    const s = Math.floor(n / 100), r = n % 100, dz = Math.floor(r / 10), j = r % 10;
    const cz = [];
    if (s) cz.push(L_SETKI[p][s]);
    if (r >= 10 && r < 20) cz.push(L_NAST[p][r - 10]);
    else {
      if (dz) cz.push(L_DZIES[p][dz]);
      if (j) {
        let w = L_JEDN[p][j];
        if (j === 1 && n !== 1) w = 'jeden';                 // „dwudziestu jeden”, nie „dwudziestu jednego”
        else if (j === 1 && zenski && p === 'm') w = 'jedna';
        if (j === 2 && zenski && p === 'm') w = 'dwie';
        cz.push(w);
      }
    }
    return cz.join(' ');
  }

  /** Liczba całkowita 0..999 999 słownie albo null (większej nie ruszamy). */
  function liczbaSlownie(n, p = 'm', zenski = false) {
    if (!Number.isInteger(n) || n < 0 || n >= 1e6) return null;
    if (n === 0) return L_JEDN[p][0];
    const t = Math.floor(n / 1000), r = n % 1000;
    const cz = [];
    if (t === 1) cz.push(p === 'm' ? 'tysiąc' : 'tysiąca');
    else if (t) {
      const j = t % 10, dz = Math.floor((t % 100) / 10);
      cz.push(doTysiaca(t, p, false), p === 'd' ? 'tysięcy' : (j >= 2 && j <= 4 && dz !== 1 ? 'tysiące' : 'tysięcy'));
    }
    if (r) cz.push(doTysiaca(r, p, zenski));
    return cz.join(' ');
  }

  /** 1..99 porządkowo, rodzaj męski, dopełniacz („dwudziestego siódmego”). */
  function porzadkowyDop(n) {
    if (n < 10) return P_JEDN[n];
    if (n < 20) return P_NAST[n - 10];
    return [P_DZIES[Math.floor(n / 10)], P_JEDN[n % 10]].filter(Boolean).join(' ');
  }

  /** Rok 1000..2999 porządkowo w dopełniaczu: „dwa tysiące dwudziestego siódmego”. */
  function rokSlownie(y) {
    const th = Math.floor(y / 1000), r = y % 1000, s = Math.floor(r / 100), dj = r % 100;
    if (!r) return th === 2 ? 'dwutysięcznego' : 'tysięcznego';
    const cz = [th === 2 ? 'dwa tysiące' : 'tysiąc'];
    if (!dj) cz.push(P_SETKI[s]);
    else {
      if (s) cz.push(L_SETKI.m[s]);
      cz.push(porzadkowyDop(dj));
    }
    return cz.join(' ');
  }

  /** Godzina słownie: mianownik („siedemnasta”), dopełniacz/miejscownik
   *  („siedemnastej”) albo narzędnik („siedemnastą”). */
  function godzinaSlownie(h, przypadek) {
    const w = GODZINY[h];
    if (!h || przypadek === 'm') return w;
    return w.split(' ').map((s) => (przypadek === 'n'
      ? s.replace(/a$/, 'ą')
      : s.replace(/ga$/, 'giej').replace(/cia$/, 'ciej').replace(/a$/, 'ej'))).join(' ');
  }
  function minutySlownie(mm) {
    if (mm === 0) return '';
    return mm < 10 ? `zero ${L_JEDN.m[mm]}` : liczbaSlownie(mm, 'm');
  }

  const PRZYIMKI_DOP = '(?:od|do|około|ok\\.|koło|powyżej|poniżej|bez|dla|wśród|spośród|zamiast|blisko|niespełna|u)';
  const ZENSKIE = '(?:godzin|minut|sekund|osob|osób|dob|noc|złotów|sztuk|wycieczk|atrakcj|plaż|gwiazdk|klatk|stacj|ulic|lini|kaw|szklank|łyżk|porcj|butelk|tabletk|stron|książk|lekcj|częśc|wersj|opcj|propozycj|restauracj|wysp|tras|rzecz|kobiet|córk|mil|nagrod|dzielnic|wiosk|miejscowośc|ścieżk|drog|trasy)';

  // Tekst kończący się przyimkiem z dopełniaczem (jednostkiNaGlos: „do 2 °C” → „stopni”).
  const PO_PRZYIMKU_DOP = new RegExp(`(?:^|[^\\p{L}])${PRZYIMKI_DOP}\\s+(?:minus\\s+)?$`, 'iu');

  // Odstęp tysięcy („36 000”, „1 500 zł”) – taka liczba to jedna liczba, nie „trzydzieści sześć” i „000”.
  const NIE_TYSIACE = '(?![ \\u00a0\\u202f]\\d{3}(?!\\d))';

  function liczbyNaGlos(tekst) {
    let t = String(tekst || '');
    const bezCyfry = '(?<![\\p{L}\\p{N}.,:/]|\\d[ \\u00a0\\u202f])';

    // 1. Godziny „17:30”, z przypadkiem od słowa przed nimi. „1:25 000” to skala mapy, nie godzina.
    t = t.replace(new RegExp(`(?:(\\p{L}+\\.?)\\s+)?${bezCyfry}([01]?\\d|2[0-4]):([0-5]\\d)(?![\\p{N}:])${NIE_TYSIACE}`, 'gu'), (cale, slowo, h, m, offset, calosc) => {
      const s = (slowo || '').toLowerCase();
      // „między 7:00 a 9:00” – drugi koniec po „a” też w narzędniku.
      const poMiedzy = s === 'a' && /(?:po)?między\s+\S+(?:\s+\S+)?\s*$/i.test(calosc.slice(Math.max(0, offset - 40), offset));
      const przypadek = /^(o|po)$/.test(s) ? 'dm' : /^(od|do|około|ok\.|koło)$/.test(s) ? 'dm'
        : (/^(przed|między|pomiędzy|nad)$/.test(s) || poMiedzy) ? 'n' : 'm';
      const godz = godzinaSlownie(Number(h), przypadek === 'dm' ? 'd' : przypadek);
      const min = minutySlownie(Number(m));
      return `${slowo ? `${slowo} ` : ''}${godz}${min ? ` ${min}` : ''}`;
    });

    // 1b. Godziny bez dwukropka w zakresie: „czynne od 9 do 17.” → „od dziewiątej do siedemnastej”.
    //     Tylko gdy po zakresie nie stoi jednostka ani rzeczownik („od 9 do 17 stopni” zostaje liczbą).
    t = t.replace(/(^|[^\p{L}])([Oo]d)\s+([01]?\d|2[0-4])\s+do\s+([01]?\d|2[0-4])(?=\s*(?:[.,;:!?)]|$|godz|h(?!\p{L})))/gu,
      (_, przed, od, a, b2) => `${przed}${od} ${godzinaSlownie(Number(a), 'd')} do ${godzinaSlownie(Number(b2), 'd')}`);

    // 2. Rok: „2027 r.”, „2027 roku”, „2019–2023 roku”, „od 2019 do 2023 r.”, „września 2027”.
    t = t.replace(new RegExp(`${bezCyfry}([12]\\d{3})\\s*(?:[–-]|\\s+do\\s+)\\s*([12]\\d{3})\\s*(?:r\\.|roku\\b)`, 'gu'),
      (_, a, b2) => `${rokSlownie(Number(a))} do ${rokSlownie(Number(b2))} roku`);
    t = t.replace(new RegExp(`${bezCyfry}([12]\\d{3})\\s*(?:r\\.|roku\\b)`, 'gu'), (_, y) => `${rokSlownie(Number(y))} roku`);
    t = t.replace(new RegExp(`(${MIESIACE.join('|')}|${MIESIACE_MSC.join('|')})\\s+([12]\\d{3})(?![\\p{N}])`, 'gu'), (_, mies, y) => `${mies} ${rokSlownie(Number(y))}`);

    /* 2b. Zakres dat „12–14 września”, „od 12 do 14 września” → „od dwunastego
       do czternastego września”. Bez tego krok 3 widział tylko drugi dzień
       („12–czternastego września”), a krok 4 brał „od 12” za liczebnik główny
       („od dwunastu do czternastego”) (runda 9). */
    t = t.replace(new RegExp(`(?:(^|[^\\p{L}])([Oo]d)\\s+|${bezCyfry})([1-9]|[12]\\d|3[01])\\s*(?:[–-]|\\s+do\\s+)\\s*([1-9]|[12]\\d|3[01])\\s+(${MIESIACE.join('|')}|(?:${Object.keys(MIES_SKROT).join('|')})(?![\\p{L}]))(\\.?)`, 'gu'),
      (cale, przed, od, a, b2, mies, kropka, offset, calosc) => {
        const klucz = mies.toLowerCase();
        const pelny = klucz in MIES_SKROT ? MIESIACE[MIES_SKROT[klucz]] : mies;
        const zostaw = kropka && (klucz in MIES_SKROT ? !/^\s*[\p{Ll},;:]/u.test(calosc.slice(offset + cale.length)) : true);
        return `${przed || ''}${od || 'od'} ${porzadkowyDop(Number(a))} do ${porzadkowyDop(Number(b2))} ${pelny}${zostaw ? '.' : ''}`;
      });

    /* 2c. Ogólny zakres „A–B słowo” (liczby całkowite, rosnąco): lektor czytał
       „Zostań 3–5 dni” jako „trzy pięć dni”. Po polsku rzeczownik zgadza się
       z drugą liczbą: przy 5+ stoi w dopełniaczu („3–5 dni”) i wystarcza „od
       trzech do pięciu dni” (odmienia krok 4); przy 2–4 stoi w mianowniku
       („2–3 godziny”) i czytamy go tak, jak mówi się na głos: „dwie, trzy
       godziny”. Po przyimku (około, o, za, na…) bez „od”. Wynik meczu („2–1”),
       lata i „8–9 tys.” zostają (runda 9). */
    t = t.replace(new RegExp(`(^|[^\\p{L}])(?:(\\p{L}+\\.?)\\s+)?${bezCyfry}(\\d{1,3})–(\\d{1,3})(?=(\\s+\\p{L}+)|\\s*[.,;:!?()…]|\\s*$)`, 'gu'),
      (cale, przed, slowo = '', a, b2, zaSlowem = '') => {
        const x = Number(a), y = Number(b2);
        const rzecz = zaSlowem.trim();
        if (!(x < y) || /^(?:tys|mln|mld|milion|miliard|z|ze|w|we|i|a|o|na|do|po|za)$/iu.test(rzecz)) return cale;
        const poSlowie = slowo ? `${slowo} ` : '';
        if (rzecz && formaPl(b2, KILKA) === KILKA[1]) {
          const zenski = new RegExp(`^${ZENSKIE}\\p{L}*[yie]$`, 'iu').test(rzecz);
          return `${przed}${poSlowie}${liczbaSlownie(x, 'm', zenski)}, ${liczbaSlownie(y, 'm', zenski)}`;
        }
        const bezOd = /^(?:od|około|ok\.|koło)$/i.test(slowo) || PRZYIMEK_BEZ_OD.test(poSlowie);
        return `${przed}${poSlowie}${bezOd ? '' : 'od '}${a} do ${b2}`;
      });

    // 3. Data „12 września”, „6 wrz” → „dwunastego września”.
    t = t.replace(new RegExp(`${bezCyfry}([1-9]|[12]\\d|3[01])\\s+(${MIESIACE.join('|')}|(?:${Object.keys(MIES_SKROT).join('|')})(?![\\p{L}]))(\\.?)`, 'gu'),
      (_, d, mies, kropka, offset, calosc) => {
        const klucz = mies.toLowerCase();
        const pelny = klucz in MIES_SKROT ? MIESIACE[MIES_SKROT[klucz]] : mies;
        // Kropka po skrócie („wrz.”) zostaje tylko wtedy, gdy kończyła też zdanie.
        const dalej = calosc.slice(offset + _.length);
        const zostaw = kropka && (klucz in MIES_SKROT ? !/^\s*[\p{Ll},;:]/u.test(dalej) : true);
        return `${porzadkowyDop(Number(d))} ${pelny}${zostaw ? '.' : ''}`;
      });

    // 4. Po przyimku z dopełniaczem: „do 21 stopni” → „do dwudziestu jeden stopni”.
    //    Liczba z częścią ułamkową („do 2,5 km”) zostaje – nie zgadujemy.
    //    „ok. 3 tysiące” – liczba przed „tysiące/mln” to część większej liczby, nie ruszamy.
    t = t.replace(new RegExp(`(^|[^\\p{L}])(${PRZYIMKI_DOP})\\s+(minus\\s+)?(\\d{1,6})(?![\\p{N}.,:/]?\\d)(?![.,:]\\d)${NIE_TYSIACE}(?!\\s*(?:tys|mln|mld|milion|miliard))`, 'giu'),
      (cale, przed, przyimek, minus = '', n, offset, calosc) => {
        const x = Number(n);
        // „do minus 2 °C” → „do minus dwóch stopni” (runda 9).
        if (minus) { const sl = liczbaSlownie(x, 'd'); return sl ? `${przed}${przyimek} minus ${sl}` : cale; }
        const dalej = calosc.slice(offset + cale.length);
        const slowoDalej = (dalej.match(/^\s+(\p{L}+)/u) || [])[1] || '';
        // Rok po przyimku („działa od 2019”) – porządkowo, gdy nie stoi za nim rzeczownik.
        if (x >= 1900 && x <= 2099 && !slowoDalej) return `${przed}${przyimek} ${rokSlownie(x)}`;
        // „około 2 godziny” – rzeczownik w mianowniku: przyimek nie rządzi, zostawiamy krokowi 5.
        if (new RegExp(`^${ZENSKIE}\\p{L}*[ye]$`, 'iu').test(slowoDalej) && /^(około|ok\.)$/i.test(przyimek)) return cale;
        // „dla 1 osoby” → „dla jednej osoby”.
        if (x === 1 && new RegExp(`^${ZENSKIE}`, 'iu').test(slowoDalej)) return `${przed}${przyimek} jednej`;
        const slowo = liczbaSlownie(x, 'd');
        return slowo ? `${przed}${przyimek} ${slowo}` : cale;
      });

    // 5. Rodzaj żeński, przypadek z końcówki rzeczownika:
    //    „2 godziny” → „dwie”, „1 osoba” → „jedna”, „za 1 minutę” → „jedną”,
    //    „po 2 godzinach” → „dwóch”, „z 2 osobami” → „dwiema”. Nieznana końcówka – cyfra zostaje.
    t = t.replace(new RegExp(`${bezCyfry}(\\d{1,6})${NIE_TYSIACE}(?=\\s+(${ZENSKIE}\\p{L}*))`, 'giu'), (cale, n, rzecz) => {
      const x = Number(n);
      const j = x % 10, dz = Math.floor((x % 100) / 10);
      const r = rzecz.toLowerCase();
      if (x === 1) {
        if (/[ęą]$/.test(r)) return 'jedną';
        if (/a$/.test(r) || /^(noc|rzecz|część|miejscowość)$/.test(r)) return 'jedna';
        return cale;
      }
      if (!(j === 2 && dz !== 1)) return cale;
      if (x === 2 && /ach$/.test(r)) return 'dwóch';
      if (x === 2 && /ami$/.test(r)) return 'dwiema';
      if (x === 2 && /om$/.test(r)) return 'dwóm';
      if (/[yie]$/.test(r)) return liczbaSlownie(x, 'm', true) || cale;
      return cale;
    });
    return t;
  }

  /* Źródła w trybie głosowym nie są mówione (Marcin, runda 5). Modele piszą
     je na dziesięć sposobów: „**Źródła:**” z listą, „### Źródła”, „*Źródło:
     …*”, „(długi myślnik) Źródła: a, b”, „[źródło: plik]” (format, którego sam Cosmos
     wymaga przy bazie wiedzy), „Według wyników wyszukiwania, …”, „According
     to the Met Office, …”. Dawniej przechodziło 19 z 41 realnych odpowiedzi,
     a zwykłe „Z sieci rybackich wyciągnięto…” traciło początek (agencja,
     runda 6). Tylko formy jednoznaczne; „według mnie” i „zgodnie z planem”
     zostają. */
  const NAGLOWEK_ZRODEL = '(?:Źródła|Źródło|Zrodla|Sources?|References|Bibliografia|Przypisy|Odnośniki)';
  const LINIA_ODNOSNIKA = String.raw`[ \t]*(?:[-*•]|\d+[.)])?[ \t]*\*?(?:\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/\S+|[\w-]+(?:\.[\w-]+)+\S*)[^\n]*`;
  const duza = (_, przed, litera) => przed + litera.toUpperCase();
  function bezZrodel(tekst) {
    return String(tekst || '')
      // 1. Sekcja: nagłówek w dowolnym stroju (**, ###, *, myślnik) + kolejne linie-odnośniki.
      .replace(new RegExp(String.raw`(^|\n)[ \t]*(?:[#>*_\u2014–-]+[ \t]*)*${NAGLOWEK_ZRODEL}(?:[*_]+)?[ \t]*:?[ \t]*(?:[*_]+)?[ \t]*(?:\n|$)(?:${LINIA_ODNOSNIKA}(?:\n|$)|[ \t]*\n)*`, 'gi'), '$1')
      // 2. Linia „Źródło: …” (też kursywą, po myślniku) i zdanie „Źródła: …” na końcu akapitu.
      .replace(new RegExp(String.raw`(^|[.!?][ \t]+)[ \t]*(?:[\u2014–-][ \t]*)?[*_]*${NAGLOWEK_ZRODEL}[*_]*[ \t]*:[^\n]*`, 'gim'), '$1')
      // „… – źródło: pogoda.onet.pl” w środku linii.
      .replace(/[ \t]*[\u2014–-][ \t]*(?:źródło|źródła|source)[ \t]*:[^\n]*/gi, '')
      // 3. „[źródło: nazwa]”, „(źródło: …)”, „[pogoda.onet.pl]”, przypis „[^1]”.
      .replace(/\s*[[(](?:źródło|źródła|source|sources|via)\s*:[^\])\n]*[\])]/gi, '')
      .replace(/\s*\[(?:\^\d+|(?:[\w-]+\.)+[a-z]{2,}[^\]\s]*)\](?!\()/gi, '')
      .replace(/\s*\((?:[\w-]+\.)+(?:pl|com|org|net|eu|gov|edu|info|io|uk|de)(?:\/[^)\s]*)?\)/gi, '')
      // 4. Wstępy źródłowe na początku zdania – tylko formy jednoznaczne.
      .replace(/(^|[.!?]\s+)(?:Według|Wg|Zgodnie z|Na podstawie)\s+(?:(?:serwis|stron|portal)\p{L}*\s+)?(?:[\w-]+\.)+[a-z]{2,}\S*?[,:]?\s+(\p{L})/giu, duza)
      .replace(/(^|[.!?]\s+)(?:Według|Wg|Zgodnie z)\s+(?:(?:wynik\p{L}*|informacj\p{L}*|dany\p{L}*)\s+)?(?:wyszukiwa\p{L}*|stron\p{L}*|serwis\p{L}*|internet\p{L}*|sieci|źród\p{L}*|IMGW|prognoz\p{L}* \p{Lu}\p{L}*)[^,.!?\n]{0,40}?[, ]\s*(\p{L})/giu, duza)
      .replace(/(^|[.!?]\s+)(?:Znalazłem|Znalazłam|Sprawdziłem|Sprawdziłam) (?:w sieci|w internecie|online)(?:,\s*że|,)?\s*(\p{L})/giu, duza)
      .replace(/(^|[.!?]\s+)(?:Z|Na podstawie) (?:informacji|danych|wyników)(?: wyszukiwania)? (?:na|ze?|w) \S+(?: \S+)?(?: wynika)?,\s*(?:że\s+)?(\p{L})/giu, duza)
      .replace(/(^|[.!?]\s+)(?:According to|Per|Based on)\s+(?:the\s+)?(?:search\p{L}*|results?|(?:official\s+)?(?:web)?site|web\b|online|sources?|Met Office|BBC|[\w-]+\.[a-z]{2,}\S*)[^,.!?\n]{0,40},\s*(\p{L})/giu, duza)
      .replace(/(^|[.!?]\s+)I found (?:online|on the web)(?: that)?\s*(\p{L})/giu, duza)
      .replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, '');
  }

  /** Adres z akcji „otwórz” albo '' , gdy to nie jest strona do otwarcia.
   *
   *  Model pisze różnie: „onet.pl”, „www.onet.pl/pogoda”, „https://onet.pl”,
   *  „<https://onet.pl>”, czasem ze spacją albo kropką na końcu. Otwieramy
   *  wyłącznie http(s) – `javascript:`, `data:` czy `file:` z odpowiedzi modelu
   *  (albo z wstrzykniętej strony, którą przeczytał) nie mogą niczego uruchomić. */
  function adresDoOtwarcia(tekst) {
    let a = String(tekst || '').trim();
    // Odnośnik Markdown: „[onet.pl](https://onet.pl)” – adresem jest to, co w nawiasie.
    const link = a.match(/^\[[^\]]*\]\(([^)\s]+)\)$/);
    if (link) a = link[1];
    // Adres w cudzysłowie albo w `kodzie`.
    a = a.replace(/^[„“"'`«]+|[”“"'`»]+$/g, '').trim();
    a = a.replace(/^<|>$/g, '').replace(/[.,;:!?\]]+$/, '').trim();
    /* Nawias zamykający na końcu zdejmujemy tylko wtedy, gdy nie ma pary –
       „…/wiki/Etna_(vulcano)” to cały adres, „(onet.pl)” to nawias zdania. */
    if (/^\(.*\)$/.test(a)) a = a.slice(1, -1);                 // cały adres w nawiasie: „(onet.pl)”
    while (a.endsWith(')') && (a.match(/\(/g) || []).length < (a.match(/\)/g) || []).length) a = a.slice(0, -1);
    while (a.startsWith('(') && (a.match(/\(/g) || []).length > (a.match(/\)/g) || []).length) a = a.slice(1);
    if (!a || /\s/.test(a)) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(a) && !/^https?:\/\//i.test(a)) return '';
    if (!/^https?:\/\//i.test(a)) a = `https://${a.replace(/^\/+/, '')}`;
    try {
      const u = new URL(a);
      // Nazwa hosta tylko z liter, cyfr, kropek i kresek (URL sam zamienia polskie litery na punycode).
      if (!/^https?:$/.test(u.protocol) || !/\./.test(u.hostname) || !/^[a-z0-9.-]+$/i.test(u.hostname.replace(/^\[.*\]$/, 'ipv6')) || u.username || u.password) return '';
      return u.href;
    } catch { return ''; }
  }
  /** Czy adres prowadzi do sieci domowej albo samego komputera – takich nigdy
   *  nie otwieramy bez kliknięcia (router, panel NAS-a, sam Cosmos). */
  function adresPrywatny(adres) {
    let u;
    try { u = new URL(adres); } catch { return true; }
    const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!h.includes('.') || /\.(local|lan|internal|home|localhost)$/.test(h) || h === 'localhost') return true;
    if (h.includes(':')) return true;                                 // IPv6 – zawsze przez kartę
    const ip = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);        // URL sam zamienia 2130706433 na 127.0.0.1
    return Boolean(ip);                                               // adres IP zamiast nazwy – przez kartę
  }

  /** Rozbrój znaczniki narzędzi w CUDZYM tekście (wyniki wyszukiwania, treść
   *  stron), zanim trafi do modelu. Strona z „[AKCJA: otwórz | …/login]”
   *  w treści podsuwała modelowi polecenie, które mógł powtórzyć – i Cosmos
   *  otwierał kartę bez prośby człowieka (agencja, runda 7). */
  function rozbrojZnaczniki(tekst) {
    return String(tekst || '').replace(/[[【]\s*(SZUKAJ|SEARCH|GRAFIKA|PLAN|ARCHIWUM|OBRAZ|AKCJA)(\s*[:：])/gi, '($1$2');
  }

  // „otwórz stronę”, „open page” – typ zaczynający się od słowa „otwórz” też jest otwarciem.
  const czyOtworz = (typ) => /^(otw[oó]rz|open)(?!\p{L})/iu.test(String(typ || '').trim());

  return {
    liczbyNaGlos,
    liczbaSlownie,
    adresDoOtwarcia,
    adresPrywatny,
    rozbrojZnaczniki,
    czyOtworz,
    SEARCH_MARKER_RE,
    IMAGE_MARKER_RE,
    PHOTO_MARKER_RE,
    RUN_FENCE_RE,
    CANVAS_NEW_RE,
    CANVAS_PATCH_RE,
    ARCHIVE_RE,
    PLAN_RE,
    ACTION_RE,
    ZNACZNIKI,
    ARCH_LIMIT_ZNAKOW,
    stripSearchMarker,
    wstawZnacznikiZdjec,
    rozlozZdjecia,
    zeZnacznikamiZdjec,
    sekcjaWPozycji,
    NAGLOWKI_ZESPOLU,
    rozdzielMyslenie,
    widokWToku,
    naKontekst,
    bezOgonkowKlient,
    scalRozmowy,
    granicaPonowienia,
    jednostkiNaGlos,
    bezZrodel,
  };
}

if (typeof window !== 'undefined') window.utworzProtokol = utworzProtokol;
if (typeof module !== 'undefined') module.exports = { utworzProtokol };

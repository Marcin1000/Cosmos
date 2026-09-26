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

  const SEARCH_MARKER_RE = znacznik('SZUKAJ');

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
  const ZNACZNIKI = ['SZUKAJ', 'GRAFIKA', 'PLAN', 'ARCHIWUM', 'OBRAZ', 'AKCJA'];

  function stripSearchMarker(s) {
    let out = String(s || '');
    for (const z of ZNACZNIKI) {
      /* Znacznik = nazwa, a zaraz po niej „:" albo „]" – i NIGDY odnośnik
         Markdown. Z dwukropkiem opcjonalnym „[Planty](…)", „[Archiwum
         Narodowe](…)" czy „[Obrazy Moneta](…)" znikały z odpowiedzi,
         a „[Archiwum…](…)" odpalało do tego narzędzie archiwum. */
      out = out.replace(new RegExp(`${OTW}${z}(?:${DWUKROPEK}${TRESC}*)?${ZAM}(?!\\()`, 'gi'), '');
      /* Urwany na końcu tekstu – i TYLKO na końcu, i tylko z dwukropkiem.
         W środku wypowiedzi otwarty nawias kwadratowy to zwykły nawias,
         a „[Plan B" na końcu zdania nie jest poleceniem. */
      out = out.replace(new RegExp(`${OTW}${z}${DWUKROPEK}${TRESC}*$`, 'i'), '');
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
  const ACTION_RE = new RegExp(`${OTW}AKCJA${DWUKROPEK}([^|\\]】]+)\\|\\s*([^\\]】]+?)${ZAM}`, 'i');

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
     20,5 stopnia. Tylko tuż po liczbie, żeby nie ruszać zwykłego tekstu. */
  const JEDNOSTKI_PL = [
    // [wzorzec jednostki, [1, 2–4, 5+, ułamek], dopisek]
    [/°\s*C\b/, ['stopień', 'stopnie', 'stopni', 'stopnia'], ' Celsjusza'],
    [/°\s*F\b/, ['stopień', 'stopnie', 'stopni', 'stopnia'], ' Fahrenheita'],
    [/°/, ['stopień', 'stopnie', 'stopni', 'stopnia'], ''],
    [/km\/h\b/, ['kilometr', 'kilometry', 'kilometrów', 'kilometra'], ' na godzinę'],
    [/m\/s\b/, ['metr', 'metry', 'metrów', 'metra'], ' na sekundę'],
    [/hPa\b/, ['hektopaskal', 'hektopaskale', 'hektopaskali', 'hektopaskala'], ''],
    [/mm\b/, ['milimetr', 'milimetry', 'milimetrów', 'milimetra'], ''],
    [/km\b/, ['kilometr', 'kilometry', 'kilometrów', 'kilometra'], ''],
    [/%/, ['procent', 'procent', 'procent', 'procent'], ''],
  ];
  const JEDNOSTKI_EN = [
    [/°\s*C\b/, ['degree', 'degrees'], ' Celsius'],
    [/°\s*F\b/, ['degree', 'degrees'], ' Fahrenheit'],
    [/°/, ['degree', 'degrees'], ''],
    [/km\/h\b/, ['kilometre', 'kilometres'], ' per hour'],
    [/m\/s\b/, ['metre', 'metres'], ' per second'],
    [/hPa\b/, ['hectopascal', 'hectopascals'], ''],
    [/mm\b/, ['millimetre', 'millimetres'], ''],
    [/km\b/, ['kilometre', 'kilometres'], ''],
    [/%/, ['percent', 'percent'], ''],
  ];
  function formaPl(liczba, [jeden, kilka, wiele, ulamek]) {
    if (/[.,]/.test(liczba)) return ulamek;
    const n = Math.abs(parseInt(liczba, 10));
    if (n === 1) return jeden;
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) return kilka;
    return wiele;
  }
  function jednostkiNaGlos(tekst, jezyk = 'pl') {
    const en = jezyk === 'en';
    let t = String(tekst || '');
    // Zakres „10–20 °C”: „od 10 do 20 stopni”, a nie „10 20 stopni”.
    t = t.replace(/(\p{L}+\s+)?(\d+(?:[.,]\d+)?)\s*[–-]\s*(\d+(?:[.,]\d+)?)(?=\s*(?:°|%|km\/h|m\/s|hPa|mm\b|km\b))/gu,
      (_, slowo = '', a, b) => {
        const maOd = /^(?:od|from)\s+$/i.test(slowo);   // „od 10–20 °C” nie dostaje drugiego „od”
        return `${slowo}${maOd ? '' : (en ? 'from ' : 'od ')}${a} ${en ? 'to' : 'do'} ${b}`;
      });
    for (const [wzor, formy, dopisek] of (en ? JEDNOSTKI_EN : JEDNOSTKI_PL)) {
      const re = new RegExp(`([−-]?)(\\d+(?:[.,]\\d+)?)\\s*${wzor.source}`, 'g');
      t = t.replace(re, (_, znak, liczba) => {
        const minus = znak ? 'minus ' : '';
        const slowo = en ? (liczba === '1' ? formy[0] : formy[1]) : formaPl(liczba, formy);
        return `${minus}${liczba} ${slowo}${dopisek}`;
      });
    }
    return t;
  }

  return {
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
    rozdzielMyslenie,
    widokWToku,
    naKontekst,
    bezOgonkowKlient,
    scalRozmowy,
    granicaPonowienia,
    jednostkiNaGlos,
  };
}

if (typeof window !== 'undefined') window.utworzProtokol = utworzProtokol;
if (typeof module !== 'undefined') module.exports = { utworzProtokol };

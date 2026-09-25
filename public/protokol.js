/* ============================================================
   PROTOKÓŁ — znaczniki modelu i wynik archiwum jako kontekst

   Dwie rzeczy, obie czysto tekstowe, obie w samym środku jakości rozmowy:

   1. ZNACZNIKI. Model prosi o narzędzie, pisząc `[ARCHIWUM: …]` w treści
      odpowiedzi. To polecenie, nie zdanie do przeczytania — musi zniknąć
      z ekranu, także wtedy, gdy zostało urwane w połowie.
   2. KONTEKST. Odpowiedź archiwum trzeba zmieścić w budżecie znaków tak,
      żeby model wiedział, ILE tego jest i CZEGO nie widzi.

   Wydzielone z `app.js`, bo to najczęściej poprawiana logika w całym
   projekcie — i przez długi czas jedyna droga do jej sprawdzenia wiodła
   przez wycinanie fragmentu pliku regexpem i `eval`. Zestaw
   `archiwum-po-folderach` robił dokładnie to: szukał `const ARCH_LIMIT_ZNAKOW`
   i `const IMAGE_MARKER_RE`, brał tekst pomiędzy nimi i wykonywał go.
   Działało do pierwszej przeprowadzki.

   Tutaj nic nie sięga po DOM ani po stan aplikacji — wchodzą dane, wychodzi
   napis. Da się to wywołać w Node i sprawdzić naprawdę.
   ============================================================ */

/**
 * Zbuduj zestaw funkcji protokołu.
 *
 * @param {object} [z] zależności (żadna nie jest wymagana — moduł jest czysty)
 * @returns {object} znaczniki i budowanie kontekstu
 */
function utworzProtokol() {
  const SEARCH_MARKER_RE = /\[SZUKAJ:\s*([^\]\n]+)\]/i;

  /** Usuń dyrektywę wyszukiwania z tekstu pokazywanego użytkownikowi.
   *  To polecenie dla modelu, nie treść odpowiedzi — nigdy nie ma trafić na ekran.
   *
   *  Marcin przysłał zapis rozmowy, w którym na ekranie stało gołe
   *  `[ARCHIWUM: grupuj=rok]`, a kawałek niżej wisiał pusty blok kodu. Dwie
   *  dziury, obie w tym samym miejscu:
   *
   *  1. ZNACZNIK URWANY. Model potrafi skończyć wypowiedź w połowie znacznika
   *     — bo skończył mu się budżet tokenów albo Marcin nacisnął „stop".
   *     Bez domykającego `]` żaden z wzorców nie pasował i polecenie dla modelu
   *     zostawało na ekranie jako treść odpowiedzi.
   *
   *  2. PUSTY PŁOT. Model lubi opakowywać znacznik w ```blok```. Usunięcie
   *     samego znacznika zostawiało wtedy parę płotków bez zawartości —
   *     na ekranie pusta ramka bez wyjaśnienia, skąd się wzięła.
   *
   *  Kolejność ma znaczenie: najpierw znika znacznik, potem sprzątamy płoty,
   *  które przez to opustoszały.
   */
  const ZNACZNIKI = ['SZUKAJ', 'GRAFIKA', 'PLAN', 'ARCHIWUM', 'OBRAZ', 'AKCJA'];

  function stripSearchMarker(s) {
    let out = String(s || '');
    for (const z of ZNACZNIKI) {
      /* Znacznik = nazwa, a zaraz po niej „:" albo „]" — i NIGDY odnośnik
         Markdown. Z dwukropkiem opcjonalnym „[Planty](…)", „[Archiwum
         Narodowe](…)" czy „[Obrazy Moneta](…)" znikały z odpowiedzi,
         a „[Archiwum…](…)" odpalało do tego narzędzie archiwum. */
      out = out.replace(new RegExp(`\\[${z}(?:\\s*:[^\\]\\n]*)?\\](?!\\()`, 'gi'), '');
      /* Urwany na końcu tekstu — i TYLKO na końcu, i tylko z dwukropkiem.
         W środku wypowiedzi otwarty nawias kwadratowy to zwykły nawias,
         a „[Plan B" na końcu zdania nie jest poleceniem. */
      out = out.replace(new RegExp(`\\[${z}\\s*:[^\\]\\n]*$`, 'i'), '');
    }
    // Płot, w którym po usunięciu znacznika nie zostało nic prócz białych znaków.
    out = out.replace(/```[a-zA-Z-]*\s*```/g, '')
      // **[SZUKAJ: …]** zostawiało „****", a `[SZUKAJ: …]` — „``"
      .replace(/\*\*\s*\*\*|(?<![`\w])``(?!`)/g, '');
    // Płot urwany razem ze znacznikiem: nieparzysta liczba płotów, ostatni pusty.
    if (((out.match(/```/g) || []).length % 2) === 1) out = out.replace(/```[a-zA-Z-]*\s*$/, '');
    return out.trim();
  }

  /** Rozdziel treść modelu na myślenie i odpowiedź.
   *  vLLM bez parsera rozumowania, Nemotron z „detailed thinking on" i starsze
   *  Ollamy piszą `<think>…</think>` wprost w treści. Zostawione tam stało na
   *  ekranie — a znaczniki z rozważań („czy użyć [SZUKAJ: …]?") odpalały
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
    const m = t.match(/\[([A-ZĄĆĘŁŃÓŚŹŻ]{0,8})$/i);
    if (m && ZNACZNIKI.some((zn) => zn.startsWith(m[1].toUpperCase()))) t = t.slice(0, m.index);
    return t.replace(/<\/?t?h?i?n?k?$/i, '');
  }

  /* ============ WYNIK ARCHIWUM → KONTEKST MODELU ============
     To jest miejsce, w którym Cosmos przez długi czas okłamywał sam siebie.

     Odpowiedź archiwum szła do modelu jako `JSON.stringify(dane).slice(0, 12000)`.
     Brzmi niewinnie, dopóki się nie policzy: sam adres jednej miniatury z OneDrive
     to 1248 znaków podpisanego tokenu, przy ~520 znakach reszty wpisu. Czyli
     z dwunastu tysięcy znaków mieściło się SZEŚĆ plików, a 71% tego, co czytał
     model, stanowiły adresy obrazków — których on nawet nie ogląda, bo w tym
     samym promptcie piszemy mu, że miniatury już pokazaliśmy człowiekowi.
     Do tego `slice` tnie napis w połowie JSON-a, więc model dostawał składniowo
     zepsuty dokument.

     Efekt na żywym archiwum: przy 59 421 plikach model widział sześć najnowszych
     (bo sortujemy od najnowszych — czyli akurat zrzuty ekranu z telefonu),
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
           wspominać — powtarzanie tego przy każdym z kilkudziesięciu wpisów
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

    /* Ile wpisów zmieści się w budżecie — liczone, a nie zgadywane. Bez
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
        + 'To jest PRÓBKA, nie całe archiwum — nie wyciągaj z niej wniosków o tym, czego '
        + 'w archiwum NIE MA. Jeśli chcesz wiedzieć, co tam jest w całości, poproś '
        + 'o zestawienie (grupuj=aparat, grupuj=rok, grupuj=temat) albo zawęź filtry.\n'
        + 'LIMIT DOTYCZY CIEBIE, NIE UŻYTKOWNIKA. On widzi wszystkie miniatury '
        + `i sam dojdzie do ostatniego z ${znaleziono} plików. Nie pisz mu więc, `
        + 'że pokazujesz tylko część, nie przepraszaj za limit, nie proponuj '
        + 'zawężenia, i nie tłumacz, jak działa przeglądanie '
        + `— napisz po prostu, ile ich jest (${znaleziono}).\n`
      : '';
    return naglowek + tresc.slice(0, ARCH_LIMIT_ZNAKOW);
  }

  const IMAGE_MARKER_RE = /\[OBRAZ:\s*([^\]\n]+)\]/i;
  /* Znalezione zdjęcia to co innego niż wygenerowane. Bez tego znacznika model
     na „pokaż zdjęcia tych miejsc" odpowiadał „nie mam dostępu do wyszukiwania
     obrazów" i proponował wizje artystyczne zamiast prawdziwej Majorki. */
  const PHOTO_MARKER_RE = /\[GRAFIKA:\s*([^\]\n]+)\]/i;
  /* Kod do wykonania. Jedyne narzędzie zapisane blokiem, nie znacznikiem —
     program nie mieści się w jednej linii. */
  const RUN_FENCE_RE = /```uruchom\s*\n([\s\S]*?)```/i;
  /* Płótno: dokument obok rozmowy. Tworzenie i podmiana fragmentu to dwie różne
     rzeczy — przy scenariuszu na trzy tysiące słów przepisywanie całości przy
     każdej poprawce trwa minutę i za każdym razem coś się po drodze gubi. */
  const CANVAS_NEW_RE = /```płótno(?::\s*([^\n]*))?\s*\n([\s\S]*?)```/i;
  const CANVAS_PATCH_RE = /```płótno-zmiana\s*\n([\s\S]*?)```/i;
  // Dwukropek obowiązkowy i nigdy odnośnik — „[Archiwum Narodowe](…)" to link.
  const ARCHIVE_RE = /\[ARCHIWUM:\s*([^\]\n]*)\](?!\()/i;
  const PLAN_RE = /\[PLAN:\s*([^\]\n]*)\](?!\()/i;
  const ACTION_RE = /\[AKCJA:\s*([^|\]]+)\|\s*([^\]]+)\]/i;

  /* „Katedra La Seu" i „katedra la seu" to to samo pytanie o zdjęcia. Bez
     ujednolicenia model prosiłby o tę samą rzecz raz po raz, tylko inaczej
     zapisaną, i wypalał limit rund na jednym budynku. */
  function bezOgonkowKlient(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ł/gi, 'l').toLowerCase().replace(/\s+/g, ' ').trim();
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
    rozdzielMyslenie,
    widokWToku,
    naKontekst,
    bezOgonkowKlient,
  };
}

if (typeof window !== 'undefined') window.utworzProtokol = utworzProtokol;
if (typeof module !== 'undefined') module.exports = { utworzProtokol };

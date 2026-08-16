/* ============================================================
   MOWA — tekst wchodzi, tekst wychodzi

   Cztery przekształcenia napisów, wszystkie w samym środku trybu głosowego
   i wszystkie do tej pory nie do sprawdzenia inaczej niż przez Chromium.

   Powód wydzielenia jest konkretny. Marcin przysłał zrzut, na którym jego
   pytanie „Jakie są największe atrakcje na Majorce" wyglądało tak:

     Jakiejakiejakie sąjakie są największejakie są największejakie są
     największejakie są największe atrakcjejakie są największe atrakcje…

   To nie jest usterka rozpoznawania mowy. Chrome na Androidzie **nie
   obsługuje `continuous`** — kończy sesję po każdej wypowiedzi i po każdej
   ciszy. My ją wznawiamy, a nowa sesja zaczyna rozpoznawać od nowa audio,
   które częściowo już słyszeliśmy. Poprzedni kod robił wtedy `voiceHeard +=`
   i skleja­ł kolejne, coraz dłuższe wersje TEGO SAMEGO zdania — bez spacji,
   bo sklejał gołym plusem.

   `doklej` rozwiązuje to raz dla wszystkich silników: nie dokleja tego, co
   już jest, tylko SCALA po zachodzących na siebie słowach.
   ============================================================ */

/**
 * Zbuduj zestaw przekształceń mowy.
 *
 * @param {object} z zależności
 * @param {RegExp} z.WAKE_RE wzorzec słowa budzącego
 * @returns {object} czyste funkcje tekstowe trybu głosowego
 */
function utworzMowe(z) {
  const { WAKE_RE } = z;

  /** Zapis bez ozdobników — do porównywania, nigdy do pokazania.
   *
   *  OGONKI LECĄ RAZEM Z INTERPUNKCJĄ i to nie jest drobiazg. Rozpoznawanie
   *  mowy oddaje najpierw „pokaz", a chwilę później poprawia na „pokaż" —
   *  ta sama wypowiedź, dwa zapisy. Porównanie z ogonkami nie widziało tu
   *  żadnej zakładki i zostawiało oba słowa obok siebie. */
  const golo = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

  /**
   * Dołóż nowy kawałek rozpoznania tak, żeby nie powtórzyć tego, co już jest.
   *
   * Rozpoznawanie mowy oddaje ten sam fragment wielokrotnie, w coraz
   * dokładniejszej postaci — a po wznowieniu sesji zaczyna od nowa od audio,
   * które częściowo już słyszeliśmy. Zwykłe doklejanie daje wtedy
   * „Jakiejakiejakie sąjakie są największe…".
   *
   * Cztery przypadki, w tej kolejności:
   *   1. nowy zawiera w sobie cały dotychczasowy → jest jego lepszą wersją,
   *   2. dotychczasowy zawiera już cały nowy     → nowy nic nie wnosi,
   *   3. koniec dotychczasowego = początek nowego → sklejamy po zakładce,
   *   4. nic wspólnego → to nowe zdanie, dopisujemy ze spacją.
   *
   * @param {string} dotychczas co już usłyszeliśmy
   * @param {string} nowy świeży fragment od rozpoznawacza
   * @returns {string} scalona wypowiedź
   */
  function doklej(dotychczas, nowy) {
    const stary = String(dotychczas || '').trim();
    const swiezy = String(nowy || '').trim();
    if (!swiezy) return stary;
    if (!stary) return swiezy;

    const a = golo(stary);
    const b = golo(swiezy);
    if (!a) return swiezy;
    if (!b) return stary;

    if (b.startsWith(a)) return swiezy;              // 1. dokładniejsza wersja
    if (a.includes(b)) return stary;                 // 2. już to mamy

    // 3. Zakładka liczona w SŁOWACH, nie w znakach — inaczej „na Majorce"
    //    i „nam" dawałyby fałszywe trafienie na wspólnym „na".
    const slowaA = a.split(' ');
    const slowaB = b.split(' ');
    const widoczneB = swiezy.split(/\s+/);
    const max = Math.min(slowaA.length, slowaB.length);
    for (let n = max; n > 0; n--) {
      if (slowaA.slice(-n).join(' ') === slowaB.slice(0, n).join(' ')) {
        const reszta = widoczneB.slice(n).join(' ').trim();
        return reszta ? `${stary} ${reszta}` : stary;
      }
    }
    return `${stary} ${swiezy}`;                     // 4. nowe zdanie
  }

  /** Uproszczona postać zdania — rozpoznawanie dopieszcza interpunkcję
   *  i wielkość liter jeszcze po tym, jak wynik uzna za ostateczny. */
  function odciskWyniku(wyniki, indeks) {
    const r = wyniki && wyniki[indeks];
    return r && r[0] ? String(r[0].transcript).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '';
  }

  /** Wytnij słowo budzące — wszystkie wystąpienia, nie tylko pierwsze. Przy
   *  ciągłym nasłuchu „Hej Kosmos" bywa rozpoznane kilka razy pod rząd. */
  function bezSlowaBudzacego(tekst) {
    const wejscie = String(tekst);
    const bylo = new RegExp(WAKE_RE.source, 'i').test(wejscie);
    let out = wejscie.replace(new RegExp(WAKE_RE.source, 'gi'), ' ')
      .replace(/\s{2,}/g, ' ').trim();

    /* Sieroty po wyciętej frazie — ale TYLKO wtedy, gdy fraza naprawdę tu
       była. Rozpoznawanie lubi rozbić „Hej Kosmos" na dwa wyniki albo skleić
       je bez spacji („Hej kosmosHej kosmos co widzisz"); wtedy granica słowa
       nie istnieje, wzorzec łapie jedno wystąpienie, a drugie zostaje
       w kawałkach. Warunek `bylo` jest tu istotny: bez niego pytanie
       „Kosmos jest wielki, prawda?" straciłoby pierwsze słowo. */
    out = out.replace(/^(?:(?:hej|hey|ok(?:ej)?)[\s,.!]+)+(?=\S)/i, '');
    if (bylo) {
      out = out.replace(/^(?:(?:hej|hey|ok(?:ej)?|kosmos|cosmos)[\s,.!]*)+(?=\S)/i, '');
    }
    /* I na koniec interpunkcja, która została po wyciętej frazie.
       „hej, kosmos! pokaż zdjęcia" dawało pytanie „! pokaż zdjęcia" —
       model dostawał wykrzyknik jako pierwszy znak wypowiedzi. */
    return out.replace(/^[\s,.!?;:–—-]+/, '').trim();
  }

  /** Czy dwa zdania to praktycznie to samo? Porównujemy zbiory słów, bo
   *  rozpoznawanie mowy gubi końcówki i interpunkcję. */
  function toSamoZdanie(a, b) {
    const slowa = (x) => new Set(golo(x).split(' ').filter((w) => w.length > 2));
    const A = slowa(a);
    const B = slowa(b);
    if (A.size < 3) return false;                  // za krótkie, by wnioskować
    let wspolne = 0;
    for (const w of A) if (B.has(w)) wspolne++;
    return wspolne / A.size > 0.7;
  }

  /**
   * Czy druga wypowiedź to praktycznie przepisana pierwsza?
   *
   * Marcin dostał w jednej turze TRZY kopie tego samego planu Majorki.
   * Model po każdym wyniku narzędzia pisał całość od nowa, a każda runda to
   * osobna wiadomość — więc na ekranie rosła sterta prawie identycznych
   * tabel. Instrukcja „nie przepisuj" pomaga, ale nie jest gwarancją;
   * to jest zapora po stronie Cosmosa.
   *
   * Liczymy pokrycie WORKA SŁÓW w obie strony i wymagamy wysokiego progu
   * oraz realnej długości. Krótkie wypowiedzi zostawiamy w spokoju: „tak"
   * po „tak" bywa sensowne, a dwa akapity o tych samych filtrach ND to już
   * przepisana odpowiedź.
   *
   * @param {string} a wcześniejsza wypowiedź
   * @param {string} b nowa wypowiedź
   * @param {number} [prog] wymagane pokrycie w obie strony
   * @returns {boolean}
   */
  function tenSamTekst(a, b, prog = 0.85) {
    const A = golo(a);
    const B = golo(b);
    // Poniżej dwustu znaków powtórzenie bywa treścią, nie usterką.
    if (A.length < 200 || B.length < 200) return false;
    const zbior = (x) => new Set(x.split(' ').filter((w) => w.length > 3));
    const sa = zbior(A);
    const sb = zbior(B);
    if (sa.size < 20 || sb.size < 20) return false;
    let wspolne = 0;
    for (const w of sa) if (sb.has(w)) wspolne++;
    return wspolne / sa.size >= prog && wspolne / sb.size >= prog;
  }

  return { doklej, odciskWyniku, bezSlowaBudzacego, toSamoZdanie, tenSamTekst, golo };
}

if (typeof window !== 'undefined') window.utworzMowe = utworzMowe;
if (typeof module !== 'undefined') module.exports = { utworzMowe };

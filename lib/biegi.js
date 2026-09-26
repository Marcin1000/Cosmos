/* ============================================================
   Biegi — odpowiedź, która żyje na serwerze, a nie w karcie przeglądarki

   Marcin: „Jak wychodzę ze strony lub aplikacji zainstalowanej czy to na
   desktopie czy na mobile to wszystko jest przerywane i jest napisane że
   connection error. Chciałbym żeby to działało wszystko też w tle jak Claude."

   Pierwsze podejrzenie padło na `req.on('close', () => abort.abort())` w trasie
   czatu. Pomiar je obalił: `readJson(req)` wyczerpuje strumień żądania, więc
   `close` leci od razu po wczytaniu korpusu i uchwyt podpinany kilkadziesiąt
   linii dalej nigdy się nie odzywa. Sonda — klient zrywa połączenie po 1,2 s,
   a odpowiedź rośnie dalej (184 → 612 znaków) i kończy się normalnie.

   Prawdziwa przyczyna była prostsza i gorsza: odpowiedź istniała wyłącznie
   w przeglądarce. Serwer czytał ją od modelu do końca, dopisywał do gniazda,
   którego nikt już nie słuchał, i wyrzucał — nigdzie jej nie zapisując. Karta
   zamknięta w połowie odpowiedzi znaczyła więc: model policzył swoje, my
   zapłaciliśmy za tokeny, a wyniku nie ma i nie będzie. „Connection error" był
   tylko tym, co z tego widać na ekranie.

   Tutaj odwracamy właścicielstwo. Bieg to trwająca odpowiedź modelu, która
   należy do SERWERA. Przeglądarka jest tylko widzem: podłącza się, odłącza,
   wraca po pięciu minutach z innego urządzenia i dostaje wszystko od miejsca,
   w którym skończyła.

   Trzy rzeczy, które to musi robić, żeby było czymś więcej niż buforem:

     1. Zerwanie połączenia NIE przerywa czytania od modelu. Bieg czyta dalej
        do końca, choćby nikt nie patrzył.
     2. Da się podpiąć od dowolnego miejsca. Każde zdarzenie SSE dostaje numer
        (`id:`), a wracający klient mówi „mam do 137, dawaj resztę". To jest
        zwykły mechanizm SSE, nie nasz wynalazek.
     3. Odpowiedź, której nikt nie odebrał, NIE ginie. Gdy bieg kończy się bez
        widza, tekst trafia do pliku rozmowy — inaczej „działa w tle" znaczyłoby
        tylko tyle, że serwer grzeje procesor na darmo.

   Czego biegi NIE robią: nie prowadzą pętli narzędzi. [SZUKAJ:], [ARCHIWUM:],
   [PLAN:] rozwija przeglądarka i tak zostaje. Zamknięcie karty w połowie
   wyszukiwania zapisze więc odpowiedź modelu z prośbą o wyszukiwanie, a nie
   wynik po wyszukaniu. Przeniesienie całej pętli na serwer to osobna, dużo
   większa zmiana; tutaj zależy nam na tym, żeby zgaszony ekran telefonu
   przestał kasować pracę.
   ============================================================ */

/** Ile trzymamy zakończony bieg, zanim zniknie z pamięci. */
const TTL_MS = Number(process.env.COSMOS_BIEG_TTL_MS) || 15 * 60 * 1000;

/** Ile czekamy po zakończeniu biegu bez widza, zanim zapiszemy sami.
 *
 *  Nie zero: przeglądarka, która właśnie traci sieć na sekundę, wróci
 *  i dokończy rozmowę po swojemu (z pętlą narzędzi, tytułem, kolejką).
 *  Zapis awaryjny jest dla przypadku „nikt nie wrócił", nie dla mrugnięcia. */
const SIEROTA_MS = Number(process.env.COSMOS_BIEG_SIEROTA_MS) || 20000;

/** Górny limit zapamiętanych zdarzeń jednego biegu.
 *
 *  Bez niego długa odpowiedź modelu rozumującego (tok myślenia idzie tym samym
 *  strumieniem) trzyma w pamięci serwera kilkanaście megabajtów na rozmowę.
 *  Po przekroczeniu limitu przestajemy zapamiętywać do odtworzenia — bieg dalej
 *  leci na żywo do podłączonych widzów, traci tylko możliwość przewinięcia od
 *  początku. Lepsze niż VPS bez pamięci. */
const MAX_ZDARZEN = Number(process.env.COSMOS_BIEG_MAX_ZDARZEN) || 20000;

/* Puls do widzów trwającego biegu. Cloudflare zrywa połączenie po 100 s bez
   jednego bajtu, a model, który myśli po cichu (gpt-5, Claude 5 przez warstwę
   zgodną), potrafi milczeć dłużej. Komentarz SSE („: puls") przeglądarka
   pomija, a bramka widzi ruch. Kanał zdarzeń robi to samo od dawna. */
const PULS_MS = Number(process.env.COSMOS_PULS_MS) || 25000;

/* Bieg żyje dłużej niż żądanie, które go założyło, a jego zapis awaryjny
   odpala się z timera uzbrojonego w obsłudze `res.on('close')` — czyli
   w kontekście serwera HTTP, NIE żądania. Tam nie ma użytkownika. Dlatego
   bieg zapamiętuje swojego właściciela przy założeniu i każdy zapis robi
   jawnie w jego imieniu. Bez tego odpowiedź-sierota rzucałaby „brak
   kontekstu", a `try/catch` wokół zapisu połknąłby to po cichu. */
const { kto, wKontekscie } = require('./kontekst.js');

const { stripSearchMarker, rozdzielMyslenie, ZNACZNIKI } = require('../public/protokol.js').utworzProtokol();

function utworz({ zapiszOdpowiedz } = {}) {
  /** „osoba:id" → bieg.
   *  Identyfikator biegu nadaje PRZEGLĄDARKA. Gdyby był jedynym kluczem,
   *  jedna osoba mogłaby — podając cudzy identyfikator — nadpisać w rejestrze
   *  bieg innej. Z osobą w kluczu te same cyfry u dwóch osób to po prostu
   *  dwa różne biegi. */
  const biegi = new Map();
  const klucz = (id) => `${(kto() || {}).id || ''}:${id}`;

  function sprzatnij() {
    const teraz = Date.now();
    for (const [id, b] of biegi) {
      if (b.koniec && teraz - b.koniec > TTL_MS) biegi.delete(id);
    }
  }

  /** Załóż bieg. Zwraca uchwyt, przez który trasa czatu go karmi. */
  function zacznij({ id, rozmowaId, model, silnik, podmienionyZ, spozaListy }) {
    sprzatnij();
    const b = {
      id,
      uzytkownik: kto(),
      rozmowaId: rozmowaId || '',
      model: model || '',
      silnik: silnik || '',
      podmienionyZ: podmienionyZ || '',
      spozaListy: spozaListy || '',   // model zamieniony na listę właściciela (silnik przyznany)
      zdarzenia: [],          // surowe bloki SSE, w kolejności
      urwanyBufor: false,     // przekroczono MAX_ZDARZEN — nie da się odtworzyć od zera
      tekst: '',              // sama treść odpowiedzi (bez toku myślenia)
      start: Date.now(),
      koniec: 0,
      blad: '',
      widzowie: new Set(),
      ostatniWidz: Date.now(),
      timerSieroty: null,
      puls: null,
    };
    b.puls = setInterval(() => {
      for (const w of b.widzowie) {
        try { w.write(': puls\n\n'); } catch { b.widzowie.delete(w); }
      }
    }, PULS_MS);
    if (b.puls.unref) b.puls.unref();
    biegi.set(klucz(id), b);
    return b;
  }

  /** Dopisz jeden blok SSE i rozeszlij go widzom. */
  function dopisz(b, blok) {
    if (!b || b.koniec) return;
    const nr = b.zdarzenia.length;
    if (b.zdarzenia.length < MAX_ZDARZEN) b.zdarzenia.push(blok);
    else b.urwanyBufor = true;
    b.tekst += trescZBloku(blok);
    const ramka = `id: ${nr}\n${blok}\n\n`;
    for (const w of b.widzowie) {
      try { w.write(ramka); } catch { b.widzowie.delete(w); }
    }
  }

  /** Zamknij bieg. `blad` niepuste = skończył się awarią. */
  function zakoncz(b, blad = '') {
    if (!b || b.koniec) return;
    b.koniec = Date.now();
    b.blad = blad;
    clearInterval(b.puls);
    const ramka = `event: koniec\ndata: ${JSON.stringify({ blad })}\n\n`;
    for (const w of b.widzowie) {
      try { w.write(ramka); w.end(); } catch { /* widz zniknął */ }
    }
    b.widzowie.clear();
    zaplanujZapisSieroty(b);
  }

  /* Kto zapisuje odpowiedź.
   *
   *  Pierwsza wersja zgadywała: „jeśli w chwili końca był podłączony widz, to
   *  znaczy, że przeglądarka ją ma". Zgadywanie okazało się fałszywe w obie
   *  strony. Gniazdo po przeładowanej stronie potrafi jeszcze chwilę żyć —
   *  serwer widział widza, którego już nie było, i odpuszczał zapis awaryjny;
   *  odpowiedź przepadała mimo całej tej maszynerii (złapane w zestawie
   *  praca-w-tle, punkt 3b).
   *
   *  Teraz nie zgadujemy. Przeglądarka, która odebrała odpowiedź i zapisała ją
   *  u siebie, mówi to wprost (`potwierdz`). Brak potwierdzenia znaczy „nikt
   *  jej nie ma" i wtedy zapisujemy sami. */
  function potwierdz(id) {
    const b = moj(biegi.get(klucz(id)));
    if (!b) return false;
    b.zapisany = true;
    clearTimeout(b.timerSieroty);
    return true;
  }

  /* Odpowiedź, po którą nikt nie wrócił. Bez tego „praca w tle" kończyłaby się
     tym, że serwer doczytał do końca i wyrzucił wynik do kosza. */
  function zaplanujZapisSieroty(b) {
    if (!zapiszOdpowiedz || !b.rozmowaId || b.zapisany) return;
    clearTimeout(b.timerSieroty);
    b.timerSieroty = setTimeout(() => zapiszSierote(b), SIEROTA_MS);
    // Serwer ma prawo się zamknąć, nie czekając na ten zegar.
    if (b.timerSieroty.unref) b.timerSieroty.unref();
  }

  function zapiszSierote(b, { mimoWidzow = false } = {}) {
    if (!zapiszOdpowiedz || !b.rozmowaId) return;
    {
      if (b.zapisany || (b.widzowie.size && !mimoWidzow)) return;
      const surowe = b.tekst.trim();
      if (!surowe && !b.blad) return;
      /* Sierota idzie do pliku rozmowy tak, jak zobaczy ją człowiek: bez
         znaczników i bez <think>, z silnikiem (nić w jego kolorze). Znacznik
         znaczy, że model sięgał po narzędzie, a narzędzia prowadzi
         przeglądarka — której już nie było. Mówimy to wprost. */
      const czysta = stripSearchMarker(rozdzielMyslenie(surowe).tresc);
      const bylNarzedzie = ZNACZNIKI.some((z) => new RegExp(`\\[${z}\\s*:`, 'i').test(surowe));
      const tresc = bylNarzedzie
        ? [czysta, 'Tu miało zadziałać narzędzie (wyszukiwanie, archiwum albo plan), ale strona była zamknięta. Zapytaj jeszcze raz.'].filter(Boolean).join('\n\n')
        : czysta;
      /* Awaria w połowie (dostawca przeciążony, restart serwera): napisany
         fragment ZOSTAJE, a pod nim — co się stało. Dawniej sam komunikat
         o błędzie zastępował całą, często długą, część odpowiedzi. */
      const tekstBledu = b.blad ? `⚠ ${b.blad}` : '';
      try {
        const zapis = () => zapiszOdpowiedz(b.rozmowaId, {
          role: 'assistant',
          content: [tresc, tekstBledu].filter(Boolean).join('\n\n'),
          ...(tresc ? { silnik: b.silnik, model: b.model } : { error: true }),
          ...(bylNarzedzie ? { przerwaneNarzedzie: true } : {}),
          bieg: b.id,
        });
        if (b.uzytkownik) wKontekscie(b.uzytkownik, zapis); else zapis();
        b.zapisany = true;
      } catch { /* zapis awaryjny nie może wywrócić serwera */ }
    }
  }

  /** Ile biegów trwa — wszystkich osób. Zamknięcie serwera czeka, aż spadnie do zera. */
  const aktywne = () => [...biegi.values()].filter((b) => !b.koniec).length;

  /** Zamknięcie serwera: trwające biegi kończymy z powodem, a odpowiedzi,
   *  których nikt nie potwierdził, zapisujemy OD RAZU — bez czekania
   *  SIEROTA_MS, bo za chwilę procesu nie będzie. Dawniej restart w trakcie
   *  odpowiedzi kasował ją w całości (proces kończył się w 10 ms). */
  function zapiszWszystkoTeraz(powod) {
    for (const b of biegi.values()) {
      if (!b.koniec) { b.przerwij?.(); zakoncz(b, powod); }
      clearTimeout(b.timerSieroty);
      zapiszSierote(b, { mimoWidzow: true });
    }
  }

  /** Podłącz widza. `od` = numer pierwszego zdarzenia, którego jeszcze nie ma. */
  function podepnij(id, od, res) {
    const b = moj(biegi.get(klucz(id)));
    if (!b) return false;
    clearTimeout(b.timerSieroty);
    b.ostatniWidz = Date.now();

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Cosmos-Model': encodeURIComponent(b.model || ''),
      ...(b.podmienionyZ ? { 'X-Cosmos-Model-Swapped-From': encodeURIComponent(b.podmienionyZ) } : {}),
      ...(b.spozaListy ? { 'X-Cosmos-Model-Spoza-Listy': encodeURIComponent(b.spozaListy) } : {}),
    });

    /* Klient prosi o zdarzenia, których już nie mamy (bufor urwany limitem).
       Uczciwiej powiedzieć to wprost, niż podać dalszy ciąg i udawać, że to
       całość — użytkownik zobaczyłby odpowiedź bez początku. */
    const start = Math.max(0, Number(od) || 0);
    if (b.urwanyBufor && start === 0) {
      res.write(`event: luka\ndata: ${JSON.stringify({ powod: 'bufor' })}\n\n`);
    }
    for (let i = start; i < b.zdarzenia.length; i++) {
      res.write(`id: ${i}\n${b.zdarzenia[i]}\n\n`);
    }
    if (b.koniec) {
      res.write(`event: koniec\ndata: ${JSON.stringify({ blad: b.blad })}\n\n`);
      res.end();
      /* Oddaliśmy całość, ale to jeszcze nie znaczy, że dotarła. Zapis awaryjny
         zostaje uzbrojony aż do potwierdzenia. */
      zaplanujZapisSieroty(b);
      return true;
    }
    b.widzowie.add(res);
    res.on('close', () => {
      b.widzowie.delete(res);
      b.ostatniWidz = Date.now();
      if (b.koniec) zaplanujZapisSieroty(b);
    });
    return true;
  }

  /** Co się teraz dzieje — do wznowienia po odświeżeniu strony. */
  function lista() {
    sprzatnij();
    return [...biegi.values()].filter((b) => moj(b)).map((b) => ({
      id: b.id,
      rozmowaId: b.rozmowaId,
      trwa: !b.koniec,
      blad: b.blad,
      zdarzen: b.zdarzenia.length,
      znakow: b.tekst.length,
      start: b.start,
      koniec: b.koniec,
    }));
  }

  /* Bieg innej osoby dla pytającego NIE ISTNIEJE — nie „jest zabroniony".
     Identyfikatory są losowe, ale odpowiedź 403 zamiast 404 potwierdzałaby,
     że pod tym numerem coś się liczy. */
  function moj(b) {
    if (!b) return null;
    const u = kto();
    if (!b.uzytkownik || !u) return b.uzytkownik || u ? null : b;
    return b.uzytkownik.id === u.id ? b : null;
  }
  const daj = (id) => moj(biegi.get(klucz(id)));

  return { zacznij, dopisz, zakoncz, podepnij, potwierdz, lista, daj, aktywne, zapiszWszystkoTeraz,
    TTL_MS, SIEROTA_MS, MAX_ZDARZEN, PULS_MS };
}

/** Wyłuskaj z bloku SSE samą treść odpowiedzi (bez `reasoning_content`).
 *
 *  Serwer musi znać tekst, bo to on zapisuje odpowiedź, po którą nikt nie
 *  wrócił. Tok myślenia świadomie pomijamy: to nie jest odpowiedź, a wklejony
 *  do rozmowy wygląda jak bełkot po angielsku urwany w pół zdania. */
function trescZBloku(blok) {
  let out = '';
  for (const linia of String(blok).split('\n')) {
    if (!linia.startsWith('data:')) continue;
    const dane = linia.slice(5).trim();
    if (!dane || dane === '[DONE]') continue;
    try {
      const j = JSON.parse(dane);
      const w = j.choices?.[0];
      out += w?.delta?.content ?? w?.text ?? '';
    } catch { /* niepełny fragment */ }
  }
  return out;
}

module.exports = { utworz, trescZBloku, TTL_MS, SIEROTA_MS, MAX_ZDARZEN, PULS_MS };

/* ============================================================
   NARZĘDZIA MODELU – jedno miejsce na jedno narzędzie

   Do tej pory cała kaskada siedziała w `runGeneration()` w app.js: 535 linii
   jednej funkcji, w której po kolei sprawdzano wyszukiwanie, archiwum, plan
   zdjęciowy, płótno, uruchamianie kodu, grafiki i generowanie obrazu. Każde
   nowe narzędzie ją wydłużało, a wspólne fragmenty były przepisywane z ręki.

   Co z tego wynikało – nie teoretycznie, tylko realnie:

     • Gałąź wyszukiwania usuwała znacznik przez `replace(marker[0], '')`,
       czyli TYLKO pierwszy. Gałąź archiwum używała pełnego czyszczenia.
       Nikt nie zauważył różnicy, dopóki model nie napisał dziesięciu zapytań
       naraz i dziewięć nie stanęło użytkownikowi na ekranie.

     • Obsługa „limit rund wyczerpany" była napisana TRZY RAZY. W dwóch
       kopiach ustawiano `samoMyslenie`, w trzeciej nie – więc przy zdjęciach
       model rozumujący, któremu budżet poszedł na myślenie, pokazywał surowe
       rozumowanie zamiast komunikatu.

     • Nic z tego nie dawało się przetestować bez przeglądarki, bo funkcja
       czytała i zapisywała kilkanaście zmiennych modułowych app.js.

   Dlatego: każde narzędzie to obiekt z tym samym kontraktem, a zależności
   wchodzą przez `utworzNarzedzia({...})` – tak jak w `lib/`. Moduł nie zna
   ani DOM-u, ani stanu app.js, więc zestaw testów uruchamia go w Node
   z atrapami i sprawdza ZACHOWANIE, a nie treść pliku.

   KONTRAKT JEDNEGO NARZĘDZIA
   --------------------------
   nazwa            identyfikator do dziennika i testów
   dopasuj(acc)     zwraca wynik `match` albo null
   zawszeDozwolone  true = wolno uruchomić także w ostatniej rundzie
                    (dotyczy narzędzi KOŃCZĄCYCH turę: płótno, zdjęcia, obraz)
   gdyLimit(dop)    { tresc, etykieta, sterowanie } – co powiedzieć modelowi, gdy
                    rund już nie ma. Samo dokończenie odpowiedzi robi wywołujący,
                    w jednym miejscu dla wszystkich narzędzi.
   wykonaj(k)       robi robotę; zwraca { akcja: 'dalej' | 'koniec', finalText? }
                    'koniec' z `finalText` = tekst odpowiedzi JUŻ stoi w rozmowie
                    (także gdy narzędzie okazało się zbędne – kontrakt K2)

   Wynik narzędzia, który jest tylko poleceniem dla modelu („to zapytanie już
   wyszukałeś”), idzie przez `dodajWynikNarzedzia(conv, tresc, etykieta,
   { sterowanie: true })` – widok go nie rysuje (kontrakt K1).

   `k` to kontekst jednego wywołania:
     { acc, dop, conv, depth, ostatnia, przed, stan }
   gdzie `przed` to tekst modelu sprzed znacznika (już wyczyszczony),
   a `stan` przechowuje pamięć tury (powtórzone zapytania).
   ============================================================ */

/**
 * Wynik pracy Studia, która na serwerze może trwać dłużej niż 100 s.
 *
 * Cloudflare zrywa żądanie bez odpowiedzi po 100 s (strona 524), więc serwer
 * czeka na generowanie najwyżej ~75 s. Zdąży – odpowiada wynikiem jak zawsze.
 * Nie zdąży – odpowiada 202 z numerem zadania, a tu dopytujemy
 * GET /api/zadania?id=…, aż praca się skończy (lib/zadania.js).
 *
 * @param {Response} odp odpowiedź na żądanie, które zaczęło pracę
 * @param {object} o
 * @param {Function} o.pobierz fetch
 * @param {Function} o.readJsonSafe bezpieczny odczyt JSON
 * @param {Function} o.t tłumaczenia
 * @param {Function} [o.naPostep] wołane przy każdym „jeszcze pracuje" ({ sekund })
 * @param {Function} [o.spij] czekanie (podmieniane w testach)
 * @returns {Promise<object>} dane jak z szybkiej ścieżki; błąd rzuca
 */
async function czekajNaZadanie(odp, { pobierz, readJsonSafe, t, naPostep, spij, coIleMs = 2500, maksMs = 20 * 60_000 }) {
  const d = await readJsonSafe(odp);
  if (!(odp.status === 202 && d.zadanie)) {
    if (!odp.ok) throw new Error(d.error || `HTTP ${odp.status}`);
    return d;
  }
  const czekaj = spij || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const start = Date.now();
  let pomylek = 0;
  // Od razu po 202 – człowiek czekał już ~75 s i ma się dowiedzieć, co się dzieje.
  if (naPostep) naPostep({ sekund: d.sekund || 0 });
  while (Date.now() - start < maksMs) {
    await czekaj(coIleMs);
    let r;
    // Chwilowy brak sieci (telefon w windzie) to nie koniec zadania – dopytamy za chwilę.
    try { r = await pobierz(`/api/zadania?id=${encodeURIComponent(d.zadanie)}`); } catch {
      if (++pomylek > 40) throw new Error(t('zadanie.bezSieci'));
      continue;
    }
    const s = await readJsonSafe(r);
    if (r.status === 404) throw new Error(t('zadanie.zgubione'));
    if (!r.ok) {
      if (++pomylek > 40) throw new Error(s.error || `HTTP ${r.status}`);
      continue;
    }
    pomylek = 0;
    if (s.stan === 'gotowe') return s.wynik || {};
    if (s.stan === 'blad') throw new Error(s.error || t('zadanie.nieudane'));
    if (naPostep) naPostep(s);
  }
  throw new Error(t('zadanie.zaDlugo'));
}

/**
 * Zbuduj listę narzędzi. Kolejność na liście = kolejność sprawdzania.
 *
 * @param {object} z zależności
 * @param {Function} z.t tłumaczenia
 * @param {Function} z.saveConversations zapis rozmów
 * @param {Function} z.renderMessages odmalowanie rozmowy
 * @param {Function} z.dodajWynikNarzedzia wynik narzędzia → wiadomość dla modelu
 * @param {Function} z.stripSearchMarker czyszczenie znaczników z tekstu
 * @param {Function} z.readJsonSafe bezpieczny odczyt JSON z odpowiedzi
 * @param {Function} z.fetch pobieranie (wstrzykiwane, żeby dało się je podmienić)
 * @param {Function} z.webSearch wyszukiwanie w internecie
 * @param {Function} z.naKafelek wpis archiwum → kafelek siatki
 * @param {Function} z.naKontekst wynik archiwum → tekst dla modelu
 * @param {Function} z.bezOgonkowKlient normalizacja napisów
 * @param {Function} z.zebranyMaterial załączniki rozmowy dla programu
 * @param {Function} z.zastosujZmianePlotna nałożenie poprawki na płótno
 * @param {Function} z.pokazPlotno otwarcie płótna
 * @param {Function} z.mowGlosem komunikat głosowy w trakcie czynności (może być pusty)
 * @param {number}   z.PORCJA_ARCHIWUM ile miniatur w porcji
 * @param {object}   z.WZORCE wyrażenia rozpoznające znaczniki
 * @param {Function} z.wstawTekstModelu tekst modelu do rozmowy, z zaporą przed powtórką
 * @param {Function} z.rozlozZdjecia tekst ze znacznikami zdjęć → tekst + miejsca (protokol.js)
 * @param {Function} z.sekcjaWPozycji ile nagłówków stoi przed pozycją (protokol.js)
 * @param {Function} [z.odswiezZdjecia] (wiadomość, grupa) – podmień tylko pasek tej grupy
 * @param {Function} [z.zapiszWkrotce] (rozmowa) – zapis z krótką zwłoką (po każdej grupie zdjęć)
 * @param {Function} [z.sygnal] () → AbortSignal tury – „Zatrzymaj” przerywa pobieranie zdjęć
 * @param {Function} [z.metaOdpowiedzi] () → { think, note } rundy, która napisała odpowiedź
 * @param {Function} [z.jezyk] () → 'pl' | 'en' – język interfejsu (domyślnie `getLang` z i18n.js)
 * @returns {Array<object>} narzędzia w kolejności sprawdzania
 */
function utworzNarzedzia(z) {
  const {
    t, saveConversations, renderMessages, dodajWynikNarzedzia,
    stripSearchMarker, readJsonSafe, fetch: pobierz, webSearch,
    naKafelek, naKontekst, bezOgonkowKlient, zebranyMaterial,
    zastosujZmianePlotna, pokazPlotno, mowGlosem, PORCJA_ARCHIWUM, WZORCE,
    wstawTekstModelu, rozlozZdjecia, sekcjaWPozycji,
    // silnik tury – pasek postępu dostaje kropkę w jego kolorze (opcjonalne w testach)
    znakSilnika = null,
    // zdjęcia w jednej odpowiedzi: podmiana jednego paska, zapis po grupie, Stop, myślenie rundy
    odswiezZdjecia = null, zapiszWkrotce = null, sygnal = null, metaOdpowiedzi = null,
  } = z;
  /* Wyszukiwanie zapisane po swojemu (bez dwukropka, `<tool_call>`, `<TOOLCALL>`)
     – protokol.js. W przeglądarce `utworzProtokol` jest globalny (protokol.js
     ładuje się przed tym plikiem), test może podać funkcję wprost. */
  /* Język interfejsu – w przeglądarce `getLang` z i18n.js, test może podać `z.jezyk`. */
  const jezyk = typeof z.jezyk === 'function' ? z.jezyk
    : () => (typeof getLang === 'function' ? getLang() : 'pl');

  /** Czy w bieżącej turze (od ostatniej wypowiedzi człowieka) zespół z badaczem
   *  już szukał – notatki zespołu niosą wtedy `zespol.szukaj`. */
  function zespolSzukal(conv) {
    const w = (conv && conv.messages) || [];
    for (let i = w.length - 1; i >= 0; i--) {
      const m = w[i];
      if (!m) continue;
      if (m.narzedzie === 'zespol' && m.zespol && m.zespol.szukaj) return true;
      if (m.role === 'user' && !m.search) return false;
    }
    return false;
  }

  const natywneSzukanie = z.natywneSzukanie
    || (typeof utworzProtokol === 'function' ? utworzProtokol().natywneSzukanie : null);

  /* Wiadomość „trwa czynność", którą trzeba będzie PRZEPISAĆ, gdy czynność
     się skończy. Wisiała kiedyś w rozmowie na zawsze jako „Szukam zdjęć…"
     – pod nią gotowe zdjęcia, a nad nimi zapewnienie, że Cosmos ich szuka. */
  function zapowiedz(conv, przed, tekst) {
    /* Tekst modelu i pasek postępu to DWIE różne wiadomości.
       Wcześniej były jedną: `przed + status`. Przy kilku rundach w turze model
       przepisywał całą odpowiedź od nowa, a każda runda dokładała kolejną
       kopię – Marcin dostał w ten sposób trzy identyczne plany Majorki.
       Rozdzielone, tekst przechodzi przez zaporę `wstawTekstModelu`, która
       przepisaną wersję PODMIENIA zamiast dokładać. */
    /* Sama zapowiedź („Aby przygotować…, potrzebuję aktualnych informacji”) nie jest
       odpowiedzią – pasek „Szukam…” mówi to samo; nie stawiamy jej jako osobnej
       karty (runda 11, R5). Tekst z treścią (akapity, lista, tabela) – jak dawniej. */
    if (przed && !tylkoZapowiedz(przed)) wstawTekstModelu(conv, przed, conv.__turaOd || 0);
    // `status` – pasek postępu, nie wypowiedź: nie wraca do modelu jako jego
    // własne słowa i nie dostaje przycisków „Zapamiętaj" / „Regeneruj".
    const wiadomosc = { role: 'assistant', content: tekst, status: true, ...(znakSilnika ? znakSilnika() : {}) };
    conv.messages.push(wiadomosc);
    saveConversations();
    renderMessages();
    return {
      wiadomosc,
      domknij(nowyTekst) { wiadomosc.content = nowyTekst; },
    };
  }

  /** `klucz=wartość` rozdzielone spacjami, ale WARTOŚĆ MOŻE MIEĆ SPACJE.
   *
   *  „obiektyw=24-70 f/2.8, 70-200 f/4" to jedna wartość, nie cztery
   *  parametry. Dzielenie po samych spacjach urywało ją na „24-70",
   *  przysłona przepadała i Cosmos liczył f/4 komuś, kto ma f/2.8 –
   *  odpowiedź brzmiała sensownie i była nieprawdziwa. Tniemy więc tylko
   *  tam, gdzie po spacji zaczyna się kolejne `słowo=`.
   *
   *  @param {string} tekst treść znacznika
   *  @param {RegExp} granica wzorzec początku kolejnego klucza
   *  @returns {Array<[string, string]>} pary klucz-wartość, w kolejności
   */
  function pary(tekst, granica = /\s+(?=[a-zA-Z]+=)/) {
    const out = [];
    for (const kawalek of String(tekst || '').trim().split(granica)) {
      const i = kawalek.indexOf('=');
      if (i < 1) continue;
      const k = kawalek.slice(0, i).trim();
      const v = kawalek.slice(i + 1).trim();
      if (v) out.push([k, v]);
    }
    return out;
  }

  /** Pobierz JSON i nigdy nie rzucaj – błąd wraca jako `{ error }`,
   *  bo model ma się dowiedzieć, że nie wyszło, a nie zostać bez odpowiedzi. */
  async function jsonem(adres, opcje) {
    try {
      const r = await pobierz(adres, opcje);
      const d = await readJsonSafe(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d;
    } catch (err) {
      return { error: err.message };
    }
  }

  /** Jak `jsonem`, ale dla Studia: praca dłuższa niż ~75 s wraca jako numer
   *  zadania, które dopytujemy aż do wyniku (`czekajNaZadanie`). */
  async function zeStudia(adres, opcje) {
    try {
      return await czekajNaZadanie(await pobierz(adres, opcje), { pobierz, readJsonSafe, t });
    } catch (err) {
      return { error: err.message };
    }
  }

  /* ============ NARZĘDZIE ZBĘDNE W TURZE (runda 11, R1, kontrakt K2) ============
     Prowadzący zespołu napisał całą odpowiedź, a na końcu [PLAN:] – choć plan
     policzył już fotograf. Kaskada mówiła modelowi „plan już policzony, dokończ”
     i zamawiała drugą rundę: tekst pierwszej znikał z ekranu, model pisał (i liczył
     za) całość drugi raz, często inaczej (Marcin: „odpowiedź resetuje się i pisze
     od nowa”). To samo przy powtórzonym wyszukaniu, archiwum i planie.
     Teraz: gdy przed zbędnym znacznikiem stoi GOTOWA odpowiedź, znacznik wypada,
     tekst zostaje jako odpowiedź tury i tura się kończy – bez drugiej rundy. */

  /** Gotowa odpowiedź, a nie zapowiedź „sprawdzę…”: długa albo z nagłówkiem/tabelą. */
  function jestOdpowiedzia(tekst) {
    const s = String(tekst || '').trim();
    return s.length >= 400 || (s.length >= 160 && /^#{1,4}\s|^\s*\|.*\|/m.test(s));
  }

  /** Sama zapowiedź czynności („Sprawdzę…”, „Aby przygotować plan, potrzebuję…”). */
  function tylkoZapowiedz(tekst) {
    const s = String(tekst || '').trim();
    return s.length < 320 && !/\n\s*\n/.test(s) && !/^#{1,4}\s|^\s*(?:[-*•|]|\d{1,3}[.)])/m.test(s)
      && /(?<!\p{L})(?:potrzebuj|sprawdz|wyszuk|poszuk|zajrz|przygotuj|let me|i'll check|i will check)\p{L}*/iu.test(s);
  }

  /** Tekst modelu sprzed znacznika – ze WSZYSTKICH znaczników wyczyszczony.
   *  `k.przed` bywa pusty (app.js nie pokazuje szkicu, gdy w odpowiedzi są zdjęcia). */
  const tekstPrzed = (k) => stripSearchMarker(String(k.acc || '').replace(k.dop[0], ''));

  /** Polecenie dla modelu (nie wynik dla człowieka) – kontrakt K1: `sterowanie: true`,
   *  widok go nie rysuje. Tekst sprzed znacznika, jeśli coś niesie, zostaje na
   *  ekranie i w historii – druga runda go widzi i nie pisze wszystkiego od nowa. */
  function sterowanie(k, tresc, etykieta) {
    const przed = tekstPrzed(k);
    if (przed && !tylkoZapowiedz(przed)) {
      const w = wstawTekstModelu(k.conv, przed, k.conv.__turaOd || 0);
      if (w && znakSilnika && !w.silnik) Object.assign(w, znakSilnika());
    }
    dodajWynikNarzedzia(k.conv, tresc, etykieta, { sterowanie: true });
    return { akcja: 'dalej' };
  }

  /** K2: znacznik zbędny, przed nim gotowa odpowiedź → `{ akcja: 'koniec', finalText }`.
   *  Zwraca null, gdy tekst przed znacznikiem odpowiedzią nie jest (wtedy runda idzie dalej). */
  async function zakonczTekstem(k) {
    const bezZnacznika = String(k.acc || '').replace(k.dop[0], '');
    const tekst = stripSearchMarker(bezZnacznika);
    if (!jestOdpowiedzia(tekst)) return null;
    /* W tej samej odpowiedzi są zdjęcia – idą przez narzędzie zdjęć: ono stawia
       tekst i paski w jednej wiadomości i samo kończy turę. */
    const dopZdjec = WZORCE.GRAFIKA && bezZnacznika.match(WZORCE.GRAFIKA);
    if (dopZdjec) return grafiki.wykonaj({ ...k, acc: bezZnacznika, dop: dopZdjec, przed: '' });
    const w = wstawTekstModelu(k.conv, tekst, k.conv.__turaOd || 0);
    if (w) {
      if (znakSilnika && !w.silnik) Object.assign(w, znakSilnika());
      const meta = metaOdpowiedzi ? metaOdpowiedzi() : null;
      if (meta) for (const [klucz, wartosc] of Object.entries(meta)) if (wartosc) w[klucz] = wartosc;
    }
    saveConversations();
    renderMessages();
    return { akcja: 'koniec', finalText: tekst };
  }

  /* ---------------------------------------------------------------- */

  const szukaj = {
    nazwa: 'szukaj',
    /* Słaby model napisał „[SZUKAJ pogoda]” albo natywne `<tool_call>` – dawniej
       znikało z ekranu, a zostawała sama obietnica „Sprawdzę.” (runda 11). */
    dopasuj: (acc) => acc.match(WZORCE.SZUKAJ) || (natywneSzukanie ? natywneSzukanie(acc) : null),
    gdyLimit: (dop) => ({ tresc: t('search.enough'), etykieta: dop[1].trim(), sterowanie: true }),
    async wykonaj(k) {
      const q = k.dop[1].trim();
      /* To samo zapytanie drugi raz w tej turze. Model potrafił zawołać
         identyczne [SZUKAJ:] trzy razy, a na ekranie stały trzy te same
         „Wyniki wyszukiwania” (agencja, runda 5). Plan, archiwum i zdjęcia
         miały tę zaporę, wyszukiwanie nie. */
      const odcisk = bezOgonkowKlient(q).toLowerCase().replace(/\s+/g, ' ');
      if (!k.stan.szukaj) k.stan.szukaj = new Set();
      if (k.stan.szukaj.has(odcisk)) {
        return (await zakonczTekstem(k)) || sterowanie(k,
          'TO ZAPYTANIE JUŻ WYSZUKAŁEŚ W TEJ TURZE i masz wyniki wyżej. Nie szukaj go '
          + 'ponownie: odpowiedz na ich podstawie albo zapytaj o coś innego.',
          q);
      }
      /* Zespół z badaczem już szukał w tej turze (runda 12, agencja-rozmowa):
         prowadzący dopisywał drugie, inne zapytanie – zwykle po angielsku – i druga
         runda dostawała wyniki z ostatnim zdaniem „Odpowiedz teraz… na podstawie
         tych wyników”, które przykrywało zasady zespołu (zdjęcia, plan). Serwer
         zdejmuje prowadzącemu opis [SZUKAJ:]; to jest siatka na model, który i tak go napisze. */
      if (zespolSzukal(k.conv)) {
        return (await zakonczTekstem(k)) || sterowanie(k,
          'WYSZUKIWANIE W TEJ TURZE ZROBIŁ JUŻ ZESPÓŁ – wyniki są w notatkach. Nie szukaj ponownie: '
          + 'odpowiedz z notatek, a czego w nich brak, powiedz jednym zdaniem.',
          q);
      }
      k.stan.szukaj.add(odcisk);
      /* ILE ICH BYŁO. Model, który poprosił o dziesięć wyszukań, a dostał
         jedno, pisze potem odpowiedź tak, jakby miał wszystkie dziesięć –
         i tak powstał plan Majorki z godzinami otwarcia atrakcji, których
         nikt nie sprawdził. Musi wiedzieć, ile z jego zapytań poszło. */
      const ile = (k.acc.match(/[[【]\s*SZUKAJ\s*[:：]/gi) || []).length;   // tolerancyjnie, jak protokol.js
      const pasek = zapowiedz(k.conv, k.przed, t('chat.searching', { q }));
      await mowGlosem(t('voice.searching'));
      const wyniki = await webSearch(q);
      pasek.domknij(t('chat.searched', { q }));
      const uwaga = ile > 1
        ? `\n\nUWAGA: w tej turze poprosiłeś o ${ile} wyszukań, a wykonane zostało `
          + 'TYLKO to jedno. Pozostałych nikt nie sprawdził i nie masz ich wyników. '
          + 'Nie pisz o nich tak, jakbyś je miał – jedno wyszukanie na turę. '
          + 'Jeśli reszta jest potrzebna, poproś o kolejne pojedynczo.'
        : '';
      /* „Możesz jakieś inne zdjęcia wyszukać?” → model zawołał [SZUKAJ:
         zdjęcia Palermo; zdjęcia Etna; …] i odpowiedział, że zdjęć nie ma.
         Wyszukiwanie tekstu zdjęć nie pokazuje – mówimy mu, czego użyć. */
      const oZdjecia = /(?<!\p{L})(zdj[eę]ci|zdjęć|fotografi|foto|obraz(y|ów)|grafik|photos?|images?|pictures?)/iu.test(q)
        ? '\n\nUWAGA: to wyszukiwanie TEKSTU – zdjęć nie pokazuje. Jeśli użytkownik chce zdjęć, '
          + 'wstaw w osobnej linii [GRAFIKA: nazwa miejsca] – osobny znacznik na każde miejsce, przy „inne zdjęcia” z innym ujęciem.'
        : '';
      /* Wyniki bywają angielskie, a „Odpowiedz teraz…” to ostatnie słowo przed
         odpowiedzią – „Syracuse” i „Valley of the Temples” szły wprost do polskiego
         tekstu (runda 12). Przypomnienie stoi na samym końcu. */
      const nazwyPl = jezyk() === 'pl'
        ? '\n\nNazwy miejsc pisz po polsku, gdy polska forma istnieje (Syrakuzy, Katania, Dolina Świątyń, Teatr Grecki) – nie przepisuj angielskich z wyników.'
        : '';
      dodajWynikNarzedzia(k.conv, wyniki + uwaga + oZdjecia + nazwyPl, q);
      return { akcja: 'dalej' };
    },
  };

  const archiwum = {
    nazwa: 'archiwum',
    dopasuj: (acc) => acc.match(WZORCE.ARCHIWUM),
    async wykonaj(k) {
      const q = new URLSearchParams();
      let grupuj = '';
      for (const [klucz, wartosc] of pary(k.dop[1])) {
        if (klucz === 'grupuj') grupuj = wartosc; else q.set(klucz, wartosc);
      }

      /* Ten sam filtr drugi raz nie przyniesie innej odpowiedzi. Zamiast
         pytać archiwum jeszcze raz, mówimy modelowi wprost, że się powtarza
         – bo inaczej wypala budżet tokenów na kółka i urywa odpowiedź
         w pół zdania. */
      /* DRUGIE PYTANIE PO UDANYM PIERWSZYM – najczęstsza przyczyna tego,
         co Marcin nazwał „rozpoczynają kolejne wznawiania odpowiedzi
         samoczynnie".

         W zapisie rozmowy „Pokaż zdjęcia z Mazur" widać jedno pytanie,
         DWA przeszukania archiwum i dwie prawie identyczne odpowiedzi.
         Odcinanie powtórzeń poniżej tego nie łapało, bo łapie wyłącznie
         filtry IDENTYCZNE, a model za drugim razem zmienił drobiazg.

         Zasada jest prosta: jeśli pierwsze zapytanie coś znalazło, model ma
         dane i drugie mu nie pomoże – ma odpowiedzieć. Jeśli pierwsze dało
         zero, drugie jest sensowne (inny rok, `folder=` zamiast `miejsce=`)
         i wolno je zadać. Rozróżnienie idzie więc po WYNIKU, nie po liczbie
         wywołań. */
      if (k.stan.archiwumZWynikiem) {
        return (await zakonczTekstem(k)) || sterowanie(k,
          'MASZ JUŻ WYNIK Z ARCHIWUM w tej turze i on odpowiada na pytanie '
          + 'użytkownika. Nie odpytuj archiwum drugi raz – napisz odpowiedź '
          + 'na podstawie tego, co dostałeś powyżej. Kolejne zapytanie tylko '
          + 'wydłuża czekanie i kończy się drugą, prawie taką samą odpowiedzią.',
          t('chat.archiveQuery'));
      }

      const odcisk = `${grupuj}|${[...q.entries()].sort().map(([a, b]) => `${a}=${b}`).join('&')}`;
      if (k.stan.archiwum.has(odcisk)) {
        return (await zakonczTekstem(k)) || sterowanie(k,
          'UWAGA: to jest DOKŁADNIE to samo zapytanie do archiwum, które przed '
          + 'chwilą wykonałeś, i da ten sam wynik. Nie powtarzaj go. Albo zmień '
          + 'filtry, albo odpowiedz tym, co już wiesz, i napisz wprost, czego '
          + 'nie udało się znaleźć.',
          t('chat.archiveQuery'));
      }
      k.stan.archiwum.add(odcisk);

      const pasek = zapowiedz(k.conv, k.przed, t('chat.searchingArchive'));
      // Zestawienie liczbowe albo lista plików – to dwa różne pytania.
      const dane = await jsonem(grupuj
        ? `/api/archive/stats?pole=${encodeURIComponent(grupuj)}&${q}`
        : `/api/archive/search?limit=${PORCJA_ARCHIWUM}&${q}`);
      /* Pasek się domyka – „Przeszukuję…" zostawało w rozmowie na zawsze,
         także nad gotową odpowiedzią. */
      pasek.domknij(dane.error ? t('chat.archiveFail') : t('chat.archiveDone', {
        n: Number(dane.znaleziono) || (dane.wyniki || []).length || (dane.grupy || []).length || 0 }));

      /* PODGLĄDY, nie tylko opis słowami. Wynik archiwum szedł kiedyś
         wyłącznie do modelu jako tekst, więc na „pokaż zdjęcia z rana"
         Marcin dostawał listę nazw plików. */
      const pliki = Array.isArray(dane.wyniki) ? dane.wyniki : [];
      /* „Coś znalazłem" to także zestawienie liczbowe – ono również jest
         odpowiedzią i po nim drugie pytanie jest zbędne. */
      if (pliki.length || (dane.grupy && dane.grupy.length) || Number(dane.znaleziono) > 0) {
        k.stan.archiwumZWynikiem = true;
      }
      const zPodgladem = pliki.filter((w) => w.zrodlo === 'onedrive');
      if (zPodgladem.length) {
        k.conv.messages.push({
          role: 'assistant',
          content: {
            text: '',
            photos: zPodgladem.map(naKafelek),
            /* Zapamiętane zapytanie dla przycisku pod siatką. Bez `limit`
               i bez `pomin` – te dokleja stopka, bo tylko ona wie, ile
               już pokazano. */
            dalej: {
              q: q.toString(),
              pomin: pliki.length,
              razem: Number(dane.znaleziono) || pliki.length,
            },
          },
        });
        saveConversations();
        renderMessages();
      }

      dodajWynikNarzedzia(k.conv,
        'WYNIK Z ARCHIWUM UŻYTKOWNIKA (jego własne pliki – odpowiadaj na podstawie '
        + 'tych danych, nie zgaduj; miniatury już pokazałem użytkownikowi, więc ich '
        + 'nie zapowiadaj ani nie opisuj plik po pliku):\n' + naKontekst(dane),
        t('chat.archiveQuery'));
      return { akcja: 'dalej' };
    },
  };

  const plan = {
    nazwa: 'plan',
    dopasuj: (acc) => acc.match(WZORCE.PLAN),
    async wykonaj(k) {
      const ALIASY = { obiektywy: 'obiektyw', szklo: 'obiektyw', lens: 'obiektyw' };
      const parametry = {};
      for (const [klucz, wartosc] of pary(k.dop[1], /\s+(?=[a-zA-Z_]+=)/)) {
        const nazwa = ALIASY[klucz.toLowerCase()] || klucz.toLowerCase();
        parametry[nazwa] = /^[\d.]+$/.test(wartosc) ? Number(wartosc) : wartosc;
      }
      /* TEN SAM PLAN LICZONY W KÓŁKO.
         W rozmowie o Majorce model poprosił o plan dla Es Trenc, dostał dane,
         przepisał CAŁY plan od nowa i poprosił jeszcze raz – o dokładnie to
         samo miejsce. I jeszcze raz. Trzy identyczne obliczenia i trzy kopie
         planu na ekranie, bo każda runda to nowa wypowiedź modelu.

         Archiwum i grafiki miały tę zaporę od dawna, plan nie miał. */
      /* Plan policzył już fotograf zespołu (C5, `faza.planPoliczony`) – drugi
         plan z innymi godzinami i nastawami pod notatkami byłby sprzeczny.
         Jedyną zaporą było zdanie w notatkach, a słaby prowadzący i tak pisał
         [PLAN:] (agencja-rozmowa, etap 5). */
      /* Runda 11 (K2): gdy przed znacznikiem stoi już cała odpowiedź, znacznik
         wypada i tura się kończy – druga runda pisała wszystko od nowa. */
      if (k.stan.planZespolu) {
        return (await zakonczTekstem(k)) || sterowanie(k,
          'PLAN JEST JUŻ POLICZONY w notatkach fotografa wyżej. Nie licz go drugi raz – '
          + 'godziny i nastawy przepisz z notatki i dokończ odpowiedź.',
          t('chat.planQuery'));
      }
      const odcisk = bezOgonkowKlient(JSON.stringify(parametry));
      if (k.stan.plan.has(odcisk)) {
        return (await zakonczTekstem(k)) || sterowanie(k,
          'TEN PLAN JUŻ POLICZYŁEŚ W TEJ TURZE i masz jego dane wyżej. Nie proś '
          + 'o niego ponownie i NIE PRZEPISUJ całej odpowiedzi od nowa – dopisz '
          + 'tylko to, czego jeszcze nie napisałeś, albo zakończ.',
          t('chat.planQuery'));
      }
      k.stan.plan.add(odcisk);

      const pasek = zapowiedz(k.conv, k.przed, t('chat.planning'));
      const wynik = await jsonem('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parametry),
      });
      // „Liczę…" pod gotowym planem to nieprawda – domykamy pasek.
      pasek.domknij(t('chat.planned'));
      dodajWynikNarzedzia(k.conv,
        'DANE PLANU ZDJĘCIOWEGO (policzone dla lokalizacji użytkownika, użyj ich '
        + 'zamiast własnych szacunków):\n' + JSON.stringify(wynik, null, 1),
        t('chat.planQuery'));
      return { akcja: 'dalej' };
    },
  };

  const plotno = {
    nazwa: 'plotno',
    // Kończy turę, więc wolno mu działać także w ostatniej rundzie.
    zawszeDozwolone: true,
    dopasuj: (acc) => acc.match(WZORCE.PLOTNO_NOWE) || acc.match(WZORCE.PLOTNO_ZMIANA),
    async wykonaj(k) {
      const nowe = k.acc.match(WZORCE.PLOTNO_NOWE);
      let opis;
      if (nowe) {
        k.conv.canvas = {
          title: (nowe[1] || '').trim() || t('canvas.untitled'),
          text: nowe[2].replace(/\n$/, ''),
        };
        opis = t('canvas.created', { title: k.conv.canvas.title });
      } else {
        const wynik = zastosujZmianePlotna(k.conv, k.dop[1]);
        opis = wynik.ok
          ? t('canvas.patched', { n: wynik.ile })
          : t('canvas.patchFailed', { msg: wynik.blad });
      }
      k.conv.messages.push({
        role: 'assistant',
        content: (k.przed ? k.przed + '\n\n' : '') + opis,
      });
      saveConversations();
      renderMessages();
      pokazPlotno(k.conv);
      return { akcja: 'koniec', finalText: opis };
    },
  };

  const kod = {
    nazwa: 'kod',
    dopasuj: (acc) => acc.match(WZORCE.KOD),
    async wykonaj(k) {
      const program = k.dop[1];
      const zPrzed = k.przed ? k.przed + '\n\n' : '';
      const wiadomoscKodu = { role: 'assistant', content: zPrzed + t('chat.running'), code: program };
      k.conv.messages.push(wiadomoscKodu);
      saveConversations();
      renderMessages();
      let wynik = await jsonem('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Program dostaje treść załączników tej rozmowy jako pliki.
        body: JSON.stringify({ code: program, files: zebranyMaterial(k.conv) }),
      });
      // „Liczę…" nad gotowym wynikiem wyglądało, jakby program wciąż pracował.
      wiadomoscKodu.content = zPrzed + t(wynik.error ? 'chat.runFail' : 'chat.runDone');
      if (wynik.error) wynik = { stdout: '', stderr: wynik.error, wyniki: [] };
      k.conv.messages.push({ role: 'assistant', content: { text: '', run: wynik } });
      // Model musi zobaczyć, co wyszło – bez tego skończyłoby się na stdout.
      dodajWynikNarzedzia(k.conv, t('chat.runResult', {
        out: (wynik.stdout || '(brak wyjścia)').slice(0, 6000),
        err: wynik.stderr ? `\nBŁĘDY:\n${wynik.stderr.slice(0, 2000)}` : '',
      }), t('chat.runQuery'));
      return { akcja: 'dalej' };
    },
  };

  /* ============ ZDJĘCIA Z SIECI – W TEJ SAMEJ ODPOWIEDZI (runda 10) ============
     Przez długi czas plan ze znacznikami był krojony: kawałek tekstu, osobna
     wiadomość ze zdjęciami, kolejny kawałek – i na koniec jeszcze jedna runda
     modelu z „ZDJĘCIA POKAZANE… napisz domknięcie albo nic”. Marcin: „na
     koniec rozmowy wisi w poszukiwaniu zdjęć” – model myślący potrafił myśleć
     pół minuty nad CAŁYM planem, żeby napisać „Miłej podróży!” albo nic,
     a zaproszenie „poproś o brakujące” wciągało go w pętlę (przepisany plan,
     pięć zapytań). Do tego Kopiuj/Zapamiętaj/Regeneruj działały na ostatnim
     kawałku, a nie na planie.

     Teraz: JEDNA wiadomość z całym tekstem i listą `zdjecia` (gdzie stał
     znacznik i w której sekcji), zdjęcia dochodzą w pasku nad sekcją,
     a tura się KOŃCZY – bez rundy modelu po zdjęciach. Czego nie znaleziono
     albo co się nie zmieściło, mówi sam Cosmos pod odpowiedzią. Model
     dowie się o zdjęciach z historii: w następnej turze zobaczy własne
     znaczniki w miejscach, gdzie je postawił (app.js, toApiMessages). */

  /** Czy człowiek prosi teraz o INNE zdjęcia (wtedy pamięć rozmowy nie wystarczy). */
  function prosiOInne(conv) {
    const pytanie = [...conv.messages].reverse().find((m) => m && m.role === 'user' && !m.search);
    const tekst = pytanie ? (typeof pytanie.content === 'string' ? pytanie.content : (pytanie.content && pytanie.content.text) || '') : '';
    return /(?<!\p{L})(inn\p{L}*|więcej|wiecej|kolejn\p{L}*|nowe|nowych|other|more|different|another)(?!\p{L})/iu.test(tekst);
  }

  /** Zdjęcia, które rozmowa już pokazała – i te same zapytania z wynikami. */
  function pamiecZdjec(conv, pomin) {
    const pokazane = new Set();
    const zapytania = new Map();
    for (const w of conv.messages) {
      if (!w || w === pomin) continue;
      // Stary zapis: osobna wiadomość { text: zapytanie, photos } (bez `dalej` – to archiwum).
      const stare = w.content && typeof w.content === 'object' && !w.content.dalej ? (w.content.photos || []) : [];
      for (const f of stare) pokazane.add(f.full || f.thumb);
      if (stare.length && w.content.text) zapytania.set(bezOgonkowKlient(w.content.text), stare);
      for (const g of Array.isArray(w.zdjecia) ? w.zdjecia : []) {
        for (const f of g.photos || []) pokazane.add(f.full || f.thumb);
        if ((g.photos || []).length) zapytania.set(bezOgonkowKlient(g.q), g.photos);
      }
    }
    return { pokazane, zapytania };
  }

  /**
   * Pobierz zdjęcia grup jednej wiadomości – najwyżej cztery zapytania naraz.
   * Każda grupa, gdy przyjdzie, podmienia TYLKO swój pasek (`odswiezZdjecia`)
   * i trafia do zapisu – odświeżenie strony w tej fazie nie gubi już
   * pokazanych zdjęć (it-plynnosc, runda 10).
   */
  async function pobierzGrupy(conv, w, grupy) {
    const syg = typeof sygnal === 'function' ? sygnal() : null;
    const { pokazane, zapytania } = pamiecZdjec(conv, w);
    const inne = prosiOInne(conv);
    /* Dwadzieścia cztery zapytania z jednej odpowiedzi to było 144 równoległe
       żądania z serwera: Brave odrzucał 23 z 24, a pięć osób naraz stawiało
       pętlę zdarzeń (zespół IT, runda 7). */
    const NARAZ = 4;
    let wolne = NARAZ;
    const kolejka = [];
    const wezMiejsce = () => (wolne > 0 ? (wolne--, Promise.resolve()) : new Promise((r) => kolejka.push(r)));
    const oddajMiejsce = () => { const nast = kolejka.shift(); if (nast) nast(); else wolne++; };
    const odswiez = (g) => {
      if (odswiezZdjecia) odswiezZdjecia(w, g); else renderMessages();
      if (zapiszWkrotce) zapiszWkrotce(conv); else saveConversations();
    };
    await Promise.all(grupy.map(async (g) => {
      await wezMiejsce();
      try {
        /* „Zatrzymaj”: kolejnych zapytań już nie ma, a to, co przyszło, zostaje.
           Dawniej Stop czekał 18 s, aż dojdzie ostatnie z czternastu zapytań. */
        if (syg && syg.aborted) { g.stan = 'przerwane'; odswiez(g); return; }
        /* To samo miejsce, które rozmowa już pokazała (model przepisał plan
           po „zmień dzień 3” z tymi samymi znacznikami) – te same zdjęcia,
           bez sieci. Chyba że człowiek prosi właśnie o inne. */
        const znane = !inne && zapytania.get(bezOgonkowKlient(g.q));
        if (znane) { g.photos = znane.slice(0, 8); g.stan = 'gotowe'; odswiez(g); return; }
        const d = await jsonem(`/api/search/images?q=${encodeURIComponent(g.q)}&ile=16`, syg ? { signal: syg } : undefined);
        if (syg && syg.aborted && !(d.results || []).length) { g.stan = 'przerwane'; odswiez(g); return; }
        // „Możesz wyszukać jakieś inne?” dawało te same osiem – bierzemy dalsze wyniki.
        const wyniki = d.results || [];
        const nowe = wyniki.filter((f) => !pokazane.has(f.full || f.thumb));
        g.photos = (nowe.length ? nowe : wyniki).slice(0, 8);
        g.stan = g.photos.length ? 'gotowe' : 'brak';
        if (!g.photos.length && d.error) g.blad = true; else delete g.blad;
        odswiez(g);
      } finally { oddajMiejsce(); }
    }));
    saveConversations();
  }

  const grafiki = {
    nazwa: 'grafiki',
    /* Kończy turę (bez rundy modelu po zdjęciach), więc wolno jej działać także
       w ostatniej rundzie. Wcześniej gotowa wersja planu ze zdjęciami, która
       wypadła w ostatniej rundzie, była wyrzucana w całości i model pisał
       drugi plan „bez zdjęć” (agencja-rozmowa, runda 10). */
    zawszeDozwolone: true,
    dopasuj: (acc) => acc.match(WZORCE.GRAFIKA),
    async wykonaj(k) {
      const { tresc, zdjecia, pominiete } = rozlozZdjecia(k.acc);
      const turaOd = k.conv.__turaOd || 0;
      /* Miejsca, których zdjęcia już stoją w tej turze – drugi raz te same
         to dla człowieka po prostu usterka. */
      const nowe = zdjecia.filter((g) => !k.stan.grafiki.has(bezOgonkowKlient(g.q)));

      /* Tekst przez zaporę przed powtórką: odpowiedź, która przepisuje wstęp
         z wcześniejszej rundy (np. przed [SZUKAJ:]), PODMIENIA go zamiast
         stawać obok. Gdy cała tura już jest na ekranie – zdjęcia idą do
         ostatniej wypowiedzi, a tekst drugi raz nie wchodzi. */
      let w = tresc.trim() ? wstawTekstModelu(k.conv, tresc, turaOd) : null;
      if (!w && tresc.trim()) {
        w = [...k.conv.messages.slice(turaOd)].reverse()
          .find((m) => m.role === 'assistant' && typeof m.content === 'string' && !m.status && !m.error) || null;
      }
      if (!w) {
        w = { role: 'assistant', content: tresc, ...(znakSilnika ? znakSilnika() : {}) };
        k.conv.messages.push(w);
      }
      if (znakSilnika && !w.silnik) Object.assign(w, znakSilnika());
      // Myślenie i notka o modelu z tej rundy – jak przy zwykłej odpowiedzi (domknijOdpowiedz).
      const meta = metaOdpowiedzi ? metaOdpowiedzi() : null;
      if (meta) for (const [klucz, wartosc] of Object.entries(meta)) if (wartosc) w[klucz] = wartosc;
      /* Pozycje liczone względem `tresc`. Gdy zdjęcia trafiają do wypowiedzi
         o innym brzmieniu (cała tura już stała), stają na jej końcu. */
      const tenSam = w.content === tresc;
      const koniec = String(w.content || '').length;
      const grupy = nowe.map((g) => ({
        q: g.q, etykieta: g.etykieta,
        po: tenSam ? g.po : koniec,
        sekcja: tenSam ? g.sekcja : sekcjaWPozycji(w.content, koniec),
        photos: [], stan: 'szukam',
      }));
      if (grupy.length) w.zdjecia = [...(Array.isArray(w.zdjecia) ? w.zdjecia : []), ...grupy];
      if (pominiete.length) w.zdjeciaPominiete = [...(w.zdjeciaPominiete || []), ...pominiete];
      for (const g of grupy) k.stan.grafiki.add(bezOgonkowKlient(g.q));
      saveConversations();
      renderMessages();
      if (grupy.length) await pobierzGrupy(k.conv, w, grupy);
      return { akcja: 'koniec', finalText: String(w.content || ''), zdjecia: grupy.some((g) => g.stan === 'gotowe') };
    },
    /** Zdjęcia zapisane jako „do pobrania” (odpowiedź-sierota z serwera,
     *  odświeżenie strony w fazie zdjęć) – dociągane po otwarciu rozmowy,
     *  bez modelu i bez kosztu. */
    async dociagnij(conv, w) {
      const grupy = (Array.isArray(w.zdjecia) ? w.zdjecia : []).filter((g) => g.stan === 'do-pobrania');
      if (!grupy.length) return false;
      for (const g of grupy) g.stan = 'szukam';
      await pobierzGrupy(conv, w, grupy);
      return true;
    },
  };

  const obraz = {
    nazwa: 'obraz',
    // Kończy turę, więc wolno mu działać także w ostatniej rundzie.
    zawszeDozwolone: true,
    dopasuj: (acc) => acc.match(WZORCE.OBRAZ),
    async wykonaj(k) {
      const pasek = zapowiedz(k.conv, k.przed, t('chat.genImage'));
      await mowGlosem(t('voice.generatingImage'));
      const d = await zeStudia('/api/studio/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: k.dop[1].trim() }),
      });
      // „Generuję obraz…" stało dotąd także nad komunikatem o błędzie.
      pasek.domknij(t(d.error ? 'chat.genImageFail' : 'chat.genImageDone'));
      if (d.error) {
        k.conv.messages.push({
          role: 'assistant',
          content: t('chat.imageErr', { msg: d.error }),
          error: true,
        });
        saveConversations();
        return { akcja: 'koniec', finalText: '', finalGlos: t('chat.imageErrVoice') };
      }
      k.conv.messages.push({
        role: 'assistant',
        content: { text: t('chat.imageSaved'), images: [d.url] },
      });
      saveConversations();
      return { akcja: 'koniec', finalText: t('chat.imageDone') };
    },
  };

  /* KOLEJNOŚĆ MA ZNACZENIE i nie jest przypadkowa:
     – kod przed grafikami, bo wynik programu zwykle JEST odpowiedzią,
     – grafiki przed obrazem, bo gdy model wypisze oba, użytkownik prosił
       o zdjęcia; generowanie było jego drugim wyborem, nie pierwszym. */
  return [szukaj, archiwum, plan, plotno, kod, grafiki, obraz];
}

if (typeof window !== 'undefined') Object.assign(window, { utworzNarzedzia, czekajNaZadanie });
if (typeof module !== 'undefined') module.exports = { utworzNarzedzia, czekajNaZadanie };

/* ============================================================
   NARZĘDZIA MODELU — jedno miejsce na jedno narzędzie

   Do tej pory cała kaskada siedziała w `runGeneration()` w app.js: 535 linii
   jednej funkcji, w której po kolei sprawdzano wyszukiwanie, archiwum, plan
   zdjęciowy, płótno, uruchamianie kodu, grafiki i generowanie obrazu. Każde
   nowe narzędzie ją wydłużało, a wspólne fragmenty były przepisywane z ręki.

   Co z tego wynikało — nie teoretycznie, tylko realnie:

     • Gałąź wyszukiwania usuwała znacznik przez `replace(marker[0], '')`,
       czyli TYLKO pierwszy. Gałąź archiwum używała pełnego czyszczenia.
       Nikt nie zauważył różnicy, dopóki model nie napisał dziesięciu zapytań
       naraz i dziewięć nie stanęło użytkownikowi na ekranie.

     • Obsługa „limit rund wyczerpany" była napisana TRZY RAZY. W dwóch
       kopiach ustawiano `samoMyslenie`, w trzeciej nie — więc przy zdjęciach
       model rozumujący, któremu budżet poszedł na myślenie, pokazywał surowe
       rozumowanie zamiast komunikatu.

     • Nic z tego nie dawało się przetestować bez przeglądarki, bo funkcja
       czytała i zapisywała kilkanaście zmiennych modułowych app.js.

   Dlatego: każde narzędzie to obiekt z tym samym kontraktem, a zależności
   wchodzą przez `utworzNarzedzia({...})` — tak jak w `lib/`. Moduł nie zna
   ani DOM-u, ani stanu app.js, więc zestaw testów uruchamia go w Node
   z atrapami i sprawdza ZACHOWANIE, a nie treść pliku.

   KONTRAKT JEDNEGO NARZĘDZIA
   --------------------------
   nazwa            identyfikator do dziennika i testów
   dopasuj(acc)     zwraca wynik `match` albo null
   zawszeDozwolone  true = wolno uruchomić także w ostatniej rundzie
                    (dotyczy narzędzi KOŃCZĄCYCH turę: płótno, obraz)
   gdyLimit(dop)    { tresc, etykieta } — co powiedzieć modelowi, gdy rund
                    już nie ma. Samo dokończenie odpowiedzi robi wywołujący,
                    w jednym miejscu dla wszystkich narzędzi.
   wykonaj(k)       robi robotę; zwraca { akcja: 'dalej' | 'koniec', finalText? }

   `k` to kontekst jednego wywołania:
     { acc, dop, conv, depth, ostatnia, przed, stan }
   gdzie `przed` to tekst modelu sprzed znacznika (już wyczyszczony),
   a `stan` przechowuje pamięć tury (powtórzone zapytania).
   ============================================================ */

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
 * @returns {Array<object>} narzędzia w kolejności sprawdzania
 */
function utworzNarzedzia(z) {
  const {
    t, saveConversations, renderMessages, dodajWynikNarzedzia,
    stripSearchMarker, readJsonSafe, fetch: pobierz, webSearch,
    naKafelek, naKontekst, bezOgonkowKlient, zebranyMaterial,
    zastosujZmianePlotna, pokazPlotno, mowGlosem, PORCJA_ARCHIWUM, WZORCE,
  } = z;

  /* Wiadomość „trwa czynność", którą trzeba będzie PRZEPISAĆ, gdy czynność
     się skończy. Wisiała kiedyś w rozmowie na zawsze jako „Szukam zdjęć…"
     — pod nią gotowe zdjęcia, a nad nimi zapewnienie, że Cosmos ich szuka. */
  function zapowiedz(conv, przed, tekst) {
    const wiadomosc = {
      role: 'assistant',
      content: (przed ? przed + '\n\n' : '') + tekst,
    };
    conv.messages.push(wiadomosc);
    saveConversations();
    renderMessages();
    return {
      wiadomosc,
      domknij(nowyTekst) {
        wiadomosc.content = (przed ? przed + '\n\n' : '') + nowyTekst;
      },
    };
  }

  /** `klucz=wartość` rozdzielone spacjami, ale WARTOŚĆ MOŻE MIEĆ SPACJE.
   *
   *  „obiektyw=24-70 f/2.8, 70-200 f/4" to jedna wartość, nie cztery
   *  parametry. Dzielenie po samych spacjach urywało ją na „24-70",
   *  przysłona przepadała i Cosmos liczył f/4 komuś, kto ma f/2.8 —
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

  /** Pobierz JSON i nigdy nie rzucaj — błąd wraca jako `{ error }`,
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

  /* ---------------------------------------------------------------- */

  const szukaj = {
    nazwa: 'szukaj',
    dopasuj: (acc) => acc.match(WZORCE.SZUKAJ),
    gdyLimit: (dop) => ({ tresc: t('search.enough'), etykieta: dop[1].trim() }),
    async wykonaj(k) {
      const q = k.dop[1].trim();
      /* ILE ICH BYŁO. Model, który poprosił o dziesięć wyszukań, a dostał
         jedno, pisze potem odpowiedź tak, jakby miał wszystkie dziesięć —
         i tak powstał plan Majorki z godzinami otwarcia atrakcji, których
         nikt nie sprawdził. Musi wiedzieć, ile z jego zapytań poszło. */
      const ile = (k.acc.match(/\[SZUKAJ:/gi) || []).length;
      const pasek = zapowiedz(k.conv, k.przed, t('chat.searching', { q }));
      await mowGlosem(t('voice.searching'));
      const wyniki = await webSearch(q);
      pasek.domknij(t('chat.searched', { q }));
      const uwaga = ile > 1
        ? `\n\nUWAGA: w tej turze poprosiłeś o ${ile} wyszukań, a wykonane zostało `
          + 'TYLKO to jedno. Pozostałych nikt nie sprawdził i nie masz ich wyników. '
          + 'Nie pisz o nich tak, jakbyś je miał — jedno wyszukanie na turę. '
          + 'Jeśli reszta jest potrzebna, poproś o kolejne pojedynczo.'
        : '';
      dodajWynikNarzedzia(k.conv, wyniki + uwaga, q);
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
         — bo inaczej wypala budżet tokenów na kółka i urywa odpowiedź
         w pół zdania. */
      /* DRUGIE PYTANIE PO UDANYM PIERWSZYM — najczęstsza przyczyna tego,
         co Marcin nazwał „rozpoczynają kolejne wznawiania odpowiedzi
         samoczynnie".

         W zapisie rozmowy „Pokaż zdjęcia z Mazur" widać jedno pytanie,
         DWA przeszukania archiwum i dwie prawie identyczne odpowiedzi.
         Odcinanie powtórzeń poniżej tego nie łapało, bo łapie wyłącznie
         filtry IDENTYCZNE, a model za drugim razem zmienił drobiazg.

         Zasada jest prosta: jeśli pierwsze zapytanie coś znalazło, model ma
         dane i drugie mu nie pomoże — ma odpowiedzieć. Jeśli pierwsze dało
         zero, drugie jest sensowne (inny rok, `folder=` zamiast `miejsce=`)
         i wolno je zadać. Rozróżnienie idzie więc po WYNIKU, nie po liczbie
         wywołań. */
      if (k.stan.archiwumZWynikiem) {
        dodajWynikNarzedzia(k.conv,
          'MASZ JUŻ WYNIK Z ARCHIWUM w tej turze i on odpowiada na pytanie '
          + 'użytkownika. Nie odpytuj archiwum drugi raz — napisz odpowiedź '
          + 'na podstawie tego, co dostałeś powyżej. Kolejne zapytanie tylko '
          + 'wydłuża czekanie i kończy się drugą, prawie taką samą odpowiedzią.',
          t('chat.archiveQuery'));
        return { akcja: 'dalej' };
      }

      const odcisk = `${grupuj}|${[...q.entries()].sort().map(([a, b]) => `${a}=${b}`).join('&')}`;
      if (k.stan.archiwum.has(odcisk)) {
        dodajWynikNarzedzia(k.conv,
          'UWAGA: to jest DOKŁADNIE to samo zapytanie do archiwum, które przed '
          + 'chwilą wykonałeś, i da ten sam wynik. Nie powtarzaj go. Albo zmień '
          + 'filtry, albo odpowiedz tym, co już wiesz, i napisz wprost, czego '
          + 'nie udało się znaleźć.',
          t('chat.archiveQuery'));
        return { akcja: 'dalej' };
      }
      k.stan.archiwum.add(odcisk);

      zapowiedz(k.conv, k.przed, t('chat.searchingArchive'));
      // Zestawienie liczbowe albo lista plików — to dwa różne pytania.
      const dane = await jsonem(grupuj
        ? `/api/archive/stats?pole=${encodeURIComponent(grupuj)}&${q}`
        : `/api/archive/search?limit=${PORCJA_ARCHIWUM}&${q}`);

      /* PODGLĄDY, nie tylko opis słowami. Wynik archiwum szedł kiedyś
         wyłącznie do modelu jako tekst, więc na „pokaż zdjęcia z rana"
         Marcin dostawał listę nazw plików. */
      const pliki = Array.isArray(dane.wyniki) ? dane.wyniki : [];
      /* „Coś znalazłem" to także zestawienie liczbowe — ono również jest
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
               i bez `pomin` — te dokleja stopka, bo tylko ona wie, ile
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
        'WYNIK Z ARCHIWUM UŻYTKOWNIKA (jego własne pliki — odpowiadaj na podstawie '
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
      zapowiedz(k.conv, k.przed, t('chat.planning'));
      const wynik = await jsonem('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parametry),
      });
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
      k.conv.messages.push({
        role: 'assistant',
        content: (k.przed ? k.przed + '\n\n' : '') + t('chat.running'),
        code: program,
      });
      saveConversations();
      renderMessages();
      let wynik = await jsonem('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Program dostaje treść załączników tej rozmowy jako pliki.
        body: JSON.stringify({ code: program, files: zebranyMaterial(k.conv) }),
      });
      if (wynik.error) wynik = { stdout: '', stderr: wynik.error, wyniki: [] };
      k.conv.messages.push({ role: 'assistant', content: { text: '', run: wynik } });
      // Model musi zobaczyć, co wyszło — bez tego skończyłoby się na stdout.
      dodajWynikNarzedzia(k.conv, t('chat.runResult', {
        out: (wynik.stdout || '(brak wyjścia)').slice(0, 6000),
        err: wynik.stderr ? `\nBŁĘDY:\n${wynik.stderr.slice(0, 2000)}` : '',
      }), t('chat.runQuery'));
      return { akcja: 'dalej' };
    },
  };

  const grafiki = {
    nazwa: 'grafiki',
    dopasuj: (acc) => acc.match(WZORCE.GRAFIKA),
    /* Limit rund wyczerpany, a model wciąż prosi o zdjęcia. Tak skończyła się
       rozmowa o Majorce: ostatnią rzeczą na ekranie było „🖼️ Zdjęcia:
       Andratx, Fornalutx…" i cisza — plan urwał się w połowie. */
    gdyLimit: () => ({
      tresc: 'LIMIT WYSZUKIWAŃ ZDJĘĆ WYCZERPANY — nie dostaniesz już kolejnych. '
        + 'Nie używaj więcej [GRAFIKA:]. Dokończ teraz odpowiedź tekstem: domknij '
        + 'plan i napisz wprost, dla których miejsc zdjęć nie pokazałeś, żeby '
        + 'użytkownik mógł o nie poprosić osobno.',
      etykieta: t('chat.photosQuery'),
    }),
    async wykonaj(k) {
      // „Katedra; plaża; wioska" — jedna prośba, kilka zestawów zdjęć.
      const wszystkie = k.dop[1].split(';').map((s) => s.trim()).filter(Boolean).slice(0, 4);
      /* Miejsca, których zdjęcia już wiszą wyżej w tej turze. Model po
         dostaniu wyniku lubi poprosić o to samo jeszcze raz — a drugi raz
         te same zdjęcia to dla użytkownika po prostu usterka. */
      const zapytania = wszystkie.filter((q) => !k.stan.grafiki.has(bezOgonkowKlient(q)));
      if (!zapytania.length) {
        dodajWynikNarzedzia(k.conv,
          `ZDJĘCIA TYCH MIEJSC JUŻ POKAZAŁEŚ: ${wszystkie.join(', ')}. Nie proś o nie `
          + 'ponownie. Albo poproś o INNE miejsca z planu, albo dokończ odpowiedź tekstem.',
          t('chat.photosQuery'));
        return { akcja: 'dalej' };
      }

      const pasek = zapowiedz(k.conv, k.przed,
        t('chat.findingPhotos', { q: zapytania.join(', ') }));
      // Równolegle — inaczej trzy zapytania to trzy razy dłuższe czekanie.
      const zestawy = await Promise.all(zapytania.map(async (q) => {
        const d = await jsonem(`/api/search/images?q=${encodeURIComponent(q)}`);
        return { q, photos: d.results || [], error: d.error || '' };
      }));
      const znalezione = zestawy.filter((s) => s.photos.length);

      if (!znalezione.length) {
        /* Niepowodzenie wraca do modelu tak samo jak wynik. Kiedyś kończyliśmy
           tutaj: użytkownik dostawał „nie znalazłem", a model nie dowiadywał
           się o niczym — i następne zdanie użytkownika trafiało w próżnię. */
        const powod = zestawy.map((s) => s.error).filter(Boolean).join('; ');
        pasek.domknij(t('chat.photosNone', { msg: powod }));
        dodajWynikNarzedzia(k.conv,
          `WYSZUKIWANIE GRAFIK NIE DAŁO WYNIKÓW dla: ${zapytania.join(', ')}.\n`
          + (powod ? `Powód techniczny: ${powod}\n` : '')
          + 'Nie powtarzaj tego samego zapytania. Jeśli było ogólnikowe — spróbuj RAZ '
          + 'konkretniejszego. Jeśli było już konkretne, nie szukaj ponownie: powiedz '
          + 'wprost, że nie udało się znaleźć zdjęć, i zapytaj, czego dokładnie szukać.',
          t('chat.photosQuery'));
        return { akcja: 'dalej' };
      }

      pasek.domknij(t('chat.photosFound', { q: znalezione.map((s) => s.q).join(', ') }));
      for (const s of znalezione) {
        k.conv.messages.push({
          role: 'assistant',
          content: { text: zapytania.length > 1 ? s.q : '', photos: s.photos },
        });
      }
      for (const s of znalezione) k.stan.grafiki.add(bezOgonkowKlient(s.q));
      saveConversations();
      renderMessages();

      const bezWynikow = zapytania.filter((q) => !znalezione.some((s) => s.q === q));
      dodajWynikNarzedzia(k.conv,
        'ZDJĘCIA POKAZANE UŻYTKOWNIKOWI (już je widzi — nie opisuj ich po kolei '
        + 'i nie zapowiadaj):\n'
        + znalezione.map((s) => `• ${s.q} — ${s.photos.length} szt.`).join('\n')
        + (bezWynikow.length ? `\nBEZ WYNIKÓW: ${bezWynikow.join(', ')}` : '')
        + '\n\nDokończ teraz odpowiedź: przypisz te zdjęcia do miejsc z planu '
        + 'jednym–dwoma zdaniami na miejsce. Jeśli plan ma jeszcze inne przystanki '
        + 'bez zdjęć, poproś o nie JEDNYM znacznikiem [GRAFIKA: a; b; c] — nie po '
        + 'jednym na raz. Nie proś ponownie o to, co już masz powyżej.',
        t('chat.photosQuery'));
      return { akcja: 'dalej' };
    },
  };

  const obraz = {
    nazwa: 'obraz',
    // Kończy turę, więc wolno mu działać także w ostatniej rundzie.
    zawszeDozwolone: true,
    dopasuj: (acc) => acc.match(WZORCE.OBRAZ),
    async wykonaj(k) {
      zapowiedz(k.conv, k.przed, t('chat.genImage'));
      await mowGlosem(t('voice.generatingImage'));
      const d = await jsonem('/api/studio/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: k.dop[1].trim() }),
      });
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
     — kod przed grafikami, bo wynik programu zwykle JEST odpowiedzią,
     — grafiki przed obrazem, bo gdy model wypisze oba, użytkownik prosił
       o zdjęcia; generowanie było jego drugim wyborem, nie pierwszym. */
  return [szukaj, archiwum, plan, plotno, kod, grafiki, obraz];
}

if (typeof window !== 'undefined') window.utworzNarzedzia = utworzNarzedzia;
if (typeof module !== 'undefined') module.exports = { utworzNarzedzia };

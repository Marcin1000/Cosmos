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
 * @param {Function} z.wstawTekstModelu tekst modelu do rozmowy, z zaporą przed powtórką
 * @returns {Array<object>} narzędzia w kolejności sprawdzania
 */
function utworzNarzedzia(z) {
  const {
    t, saveConversations, renderMessages, dodajWynikNarzedzia,
    stripSearchMarker, readJsonSafe, fetch: pobierz, webSearch,
    naKafelek, naKontekst, bezOgonkowKlient, zebranyMaterial,
    zastosujZmianePlotna, pokazPlotno, mowGlosem, PORCJA_ARCHIWUM, WZORCE,
    wstawTekstModelu,
  } = z;

  /* Wiadomość „trwa czynność", którą trzeba będzie PRZEPISAĆ, gdy czynność
     się skończy. Wisiała kiedyś w rozmowie na zawsze jako „Szukam zdjęć…"
     — pod nią gotowe zdjęcia, a nad nimi zapewnienie, że Cosmos ich szuka. */
  function zapowiedz(conv, przed, tekst) {
    /* Tekst modelu i pasek postępu to DWIE różne wiadomości.
       Wcześniej były jedną: `przed + status`. Przy kilku rundach w turze model
       przepisywał całą odpowiedź od nowa, a każda runda dokładała kolejną
       kopię — Marcin dostał w ten sposób trzy identyczne plany Majorki.
       Rozdzielone, tekst przechodzi przez zaporę `wstawTekstModelu`, która
       przepisaną wersję PODMIENIA zamiast dokładać. */
    if (przed) wstawTekstModelu(conv, przed, conv.__turaOd || 0);
    const wiadomosc = { role: 'assistant', content: tekst };
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
      /* TEN SAM PLAN LICZONY W KÓŁKO.
         W rozmowie o Majorce model poprosił o plan dla Es Trenc, dostał dane,
         przepisał CAŁY plan od nowa i poprosił jeszcze raz — o dokładnie to
         samo miejsce. I jeszcze raz. Trzy identyczne obliczenia i trzy kopie
         planu na ekranie, bo każda runda to nowa wypowiedź modelu.

         Archiwum i grafiki miały tę zaporę od dawna, plan nie miał. */
      const odcisk = bezOgonkowKlient(JSON.stringify(parametry));
      if (k.stan.plan.has(odcisk)) {
        dodajWynikNarzedzia(k.conv,
          'TEN PLAN JUŻ POLICZYŁEŚ W TEJ TURZE i masz jego dane wyżej. Nie proś '
          + 'o niego ponownie i NIE PRZEPISUJ całej odpowiedzi od nowa — dopisz '
          + 'tylko to, czego jeszcze nie napisałeś, albo zakończ.',
          t('chat.planQuery'));
        return { akcja: 'dalej' };
      }
      k.stan.plan.add(odcisk);

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
      /* ZDJĘCIA STOJĄ TAM, GDZIE MODEL JE POSTAWIŁ.

         Marcin o planie na Majorkę: „te zdjęcia powinny być pod konkretnym
         dniem, a nie najpierw cały plan, a później same zdjęcia, bo traci się
         nawiązanie do konkretnych punktów w planie". Miał rację — i nie był to
         problem modelu, tylko tego narzędzia. Braliśmy PIERWSZY znacznik,
         resztę odpowiedzi zlepialiśmy w jedną wiadomość, a siatki dokładaliśmy
         hurtem na końcu. Stąd brała się też pusta sekcja „Propozycje zdjęć":
         nagłówek zostawał, a znaczniki pod nim znikały bez śladu.

         Teraz czytamy WSZYSTKIE znaczniki razem z ich miejscem w tekście
         i odtwarzamy kolejność: kawałek planu, siatka pod nim, kolejny
         kawałek, kolejna siatka. Wszystko w jednej rundzie, bo limit wynosi
         cztery rundy na całą turę — przy rundzie na dzień siedmiodniowy plan
         urwałby się w środę. */
      const WZ = new RegExp(WZORCE.GRAFIKA.source, 'gi');
      const segmenty = [];
      let odKad = 0;
      let m = null;
      while ((m = WZ.exec(k.acc)) !== null) {
        segmenty.push({
          tekst: k.acc.slice(odKad, m.index),
          zapytania: m[1].split(';').map((x) => x.trim()).filter(Boolean).slice(0, 4),
        });
        odKad = m.index + m[0].length;
        // Sześć siatek na turę. Więcej to już nie plan, tylko album.
        if (segmenty.length >= 6) break;
      }
      const ogon = k.acc.slice(odKad);

      /* Miejsca, których zdjęcia już wiszą wyżej w tej turze. Model po
         dostaniu wyniku lubi poprosić o to samo jeszcze raz — a drugi raz
         te same zdjęcia to dla użytkownika po prostu usterka. */
      const wszystkie = [];
      for (const seg of segmenty) {
        seg.zapytania = seg.zapytania.filter((q) => {
          const klucz = bezOgonkowKlient(q);
          if (k.stan.grafiki.has(klucz) || wszystkie.some((x) => bezOgonkowKlient(x) === klucz)) {
            return false;
          }
          wszystkie.push(q);
          return true;
        });
      }
      if (!wszystkie.length) {
        dodajWynikNarzedzia(k.conv,
          'ZDJĘCIA TYCH MIEJSC JUŻ POKAZAŁEŚ. Nie proś o nie ponownie. Albo poproś '
          + 'o INNE miejsca z planu, albo dokończ odpowiedź tekstem.',
          t('chat.photosQuery'));
        return { akcja: 'dalej' };
      }

      const pasek = zapowiedz(k.conv, k.przed,
        t('chat.findingPhotos', { q: wszystkie.join(', ') }));
      // Równolegle — inaczej trzy zapytania to trzy razy dłuższe czekanie.
      const zestawy = await Promise.all(wszystkie.map(async (q) => {
        const d = await jsonem(`/api/search/images?q=${encodeURIComponent(q)}`);
        return { q, photos: d.results || [], error: d.error || '' };
      }));
      const znalezione = zestawy.filter((x) => x.photos.length);

      if (!znalezione.length) {
        /* Niepowodzenie wraca do modelu tak samo jak wynik. Kiedyś kończyliśmy
           tutaj: użytkownik dostawał „nie znalazłem", a model nie dowiadywał
           się o niczym — i następne zdanie użytkownika trafiało w próżnię. */
        const powod = zestawy.map((x) => x.error).filter(Boolean).join('; ');
        pasek.domknij(t('chat.photosNone', { msg: powod }));
        dodajWynikNarzedzia(k.conv,
          `WYSZUKIWANIE GRAFIK NIE DAŁO WYNIKÓW dla: ${wszystkie.join(', ')}.\n`
          + (powod ? `Powód techniczny: ${powod}\n` : '')
          + 'Nie powtarzaj tego samego zapytania. Jeśli było ogólnikowe — spróbuj RAZ '
          + 'konkretniejszego. Jeśli było już konkretne, nie szukaj ponownie: powiedz '
          + 'wprost, że nie udało się znaleźć zdjęć, i zapytaj, czego dokładnie szukać.',
          t('chat.photosQuery'));
        return { akcja: 'dalej' };
      }

      /* Pasek postępu znika, a na jego miejsce wchodzi ODTWORZONA kolejność.
         Usuwamy go z rozmowy zamiast przepisywać, bo teraz w to miejsce
         wchodzi nie jedna wiadomość, tylko cały przeplot. */
      const gdzie = k.conv.messages.indexOf(pasek.wiadomosc);
      if (gdzie >= 0) k.conv.messages.splice(gdzie, 1);

      const poZapytaniu = new Map(znalezione.map((x) => [bezOgonkowKlient(x.q), x]));
      const dodajTekst = (tresc) => {
        const czysty = stripSearchMarker(tresc);
        if (czysty) wstawTekstModelu(k.conv, czysty, k.conv.__turaOd || 0);
      };
      for (const seg of segmenty) {
        dodajTekst(seg.tekst);
        for (const q of seg.zapytania) {
          const znalezisko = poZapytaniu.get(bezOgonkowKlient(q));
          if (!znalezisko) continue;
          /* Podpis nad siatką zostaje ZAWSZE, także przy jednym zestawie.
             To on wiąże zdjęcia z punktem planu, pod którym stoją. */
          k.conv.messages.push({
            role: 'assistant',
            content: { text: znalezisko.q, photos: znalezisko.photos },
          });
        }
      }
      dodajTekst(ogon);

      for (const x of znalezione) k.stan.grafiki.add(bezOgonkowKlient(x.q));
      saveConversations();
      renderMessages();

      const bezWynikow = wszystkie.filter((q) => !poZapytaniu.has(bezOgonkowKlient(q)));
      dodajWynikNarzedzia(k.conv,
        'ZDJĘCIA POKAZANE UŻYTKOWNIKOWI, KAŻDE POD SWOIM PUNKTEM PLANU (już je '
        + 'widzi — nie opisuj ich po kolei, nie przypisuj ich jeszcze raz do dni '
        + 'i nie rób z tego osobnej listy na końcu):\n'
        + znalezione.map((x) => `• ${x.q} — ${x.photos.length} szt.`).join('\n')
        + (bezWynikow.length ? `\nBEZ WYNIKÓW: ${bezWynikow.join(', ')}` : '')
        + '\n\nJeśli odpowiedź jest kompletna — napisz krótkie domknięcie albo nic. '
        + 'Jeśli w planie zostały przystanki bez zdjęć, poproś o nie JEDNYM '
        + 'znacznikiem [GRAFIKA: a; b; c]. Nie proś ponownie o to, co już masz powyżej.',
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

/* ============================================================
   INSTRUKCJE NARZĘDZI DLA MODELU

   Ten plik zawiera WYŁĄCZNIE tekst, który dostaje model: opisy narzędzi,
   składnię znaczników i zasady ich używania. Żadnej logiki poza decyzją
   „czy to narzędzie jest w tej rozmowie dostępne".

   Wyjęte z `handleChat()` w server.js, gdzie stanowiło jedną trzecią
   siedmiuset linii jednej funkcji. Powód nie jest kosmetyczny.

   Marcin, po przeczytaniu zapisów swoich rozmów: „modele piszą do mnie
   z odpowiedziami, o które nie prosiłem lub wymyślają jakieś swoje". Kiedy
   zajrzałem w zapisy, połowa cytatów okazała się MOIMI zdaniami z tych
   instrukcji, oddanymi użytkownikowi dosłownie — nazwy pól, składnia
   filtrów, nazwy paneli. Ta sekcja rosła przy każdej naprawie i była
   jedynym elementem systemu, którego nic nie mierzyło, bo siedziała
   w środku funkcji obsługującej żądanie HTTP.

   Teraz jest osobną, czystą funkcją: zestaw testów składa prawdziwy
   kontekst i sprawdza go — zamiast szukać fraz regexpem po server.js.
   ============================================================ */

/**
 * Zbuduj bloki instrukcji narzędzi dla jednej rozmowy.
 *
 * @param {object} z zależności i stan rozmowy
 * @param {object} z.payload treść żądania (przełączniki `use*`)
 * @param {boolean} z.krotko tryb skrócony (mały model, mały budżet)
 * @param {boolean} z.bezNarzedzi model, który narzędzi nie obsłuży
 * @param {object} z.archiwum indeks materiału (potrzebne `ile()`)
 * @param {object|null} z.userWspolrzedne zapisana lokalizacja użytkownika
 * @param {Function} z.procedury wyuczone procedury
 * @param {Function} z.urzadzenia urządzenia domowe
 * @param {Function} z.imageProviders dostawcy generowania obrazu
 * @param {boolean} z.KOD_WLACZONY czy wykonywanie kodu jest dostępne
 * @param {string} z.capabilityText opis możliwości środowiska
 * @returns {Array<{role: string, content: string}>} bloki do dopisania
 */
function zbudujInstrukcje(z) {
  const {
    payload, krotko, bezNarzedzi, archiwum, userWspolrzedne,
    procedury, urzadzenia, imageProviders, KOD_WLACZONY, capabilityText,
  } = z;
  const extras = [];

    if (payload.useSearch !== false && !bezNarzedzi) {
      extras.push({
        role: 'system',
        content: krotko
          ? 'NARZĘDZIE — INTERNET: gdy potrzebujesz aktualnych informacji, zakończ '
            + 'odpowiedź osobną linią: [SZUKAJ: zapytanie]. Dostaniesz wyniki i odpowiesz '
            + 'na ich podstawie. Gdy brakuje Ci miasta — zapytaj o nie zamiast szukać.'
          :
          'NARZĘDZIE — WYSZUKIWANIE W INTERNECIE: gdy pytanie wymaga aktualnych lub zewnętrznych ' +
          'informacji (modele urządzeń, ceny, specyfikacje, wiadomości, fakty, których nie znasz), ' +
          'NIE zgaduj — zakończ swoją odpowiedź osobną linią dokładnie w formacie: [SZUKAJ: zapytanie]. ' +
          'Otrzymasz wtedy wiadomość „WYNIKI WYSZUKIWANIA” i na jej podstawie udzielisz pełnej ' +
          'odpowiedzi. Gdy znasz odpowiedź lub pytanie dotyczy rozmowy/obrazu, ' +
          'odpowiadaj normalnie, bez [SZUKAJ:].\n' +
          /* „Podaj źródła" bez podanego formatu kończyło się zapisem „【1†L1-L4】",
             w który nie da się kliknąć i który nikomu nic nie mówi. */
          'ŹRÓDŁA: ilekroć odpowiadasz na podstawie wyników z internetu — nieważne, ' +
          'czy chodzi o pogodę, sprzęt, przepisy czy plan podróży — zakończ ' +
          'odpowiedź sekcją „Źródła:" i wypisz strony jako linki markdown ' +
          '[tytuł](adres), po jednej w wierszu. Nie używaj zapisów typu [1] ani ' +
          '【1†L1-L4】. Gdy odpowiadasz z własnej wiedzy, bez wyszukiwania, nie ' +
          'wymyślaj źródeł — napisz wprost, że to Twoja wiedza, i zaproponuj sprawdzenie.\n' +
          /* Bez tej zasady model przy „znajdź coś w okolicy" bez znanej lokalizacji
             kręcił się w kółko: „mam szukać czy zapytać? instrukcja każe szukać,
             ale nie mam czego". Cztery ekrany rozważań, zero odpowiedzi. */
          'GDY BRAKUJE CI JEDNEJ INFORMACJI do sensownego wyszukania (najczęściej miasta), ' +
          'a nie masz jej ani w profilu, ani w lokalizacji użytkownika — po prostu zapytaj o nią ' +
          'jednym zdaniem i NIE dodawaj [SZUKAJ:]. To poprawne zachowanie, nie złamanie zasady; ' +
          'nie roztrząsaj go w myślach.\n' +
          'GDY SZUKASZ LOKALNEJ USŁUGI (warsztat, lekarz, sklep): w odpowiedzi podaj konkretne ' +
          'firmy z adresem i telefonem, jeśli są w wynikach. Sama lista katalogów typu PKT czy ' +
          'PanoramaFirm to słaba odpowiedź — użytkownik znalazłby ją sam. Jeśli w wynikach są ' +
          'wyłącznie katalogi, powiedz to wprost i zaproponuj węższe zapytanie.',
      });
    }

    /* Archiwum materiału — drugi wyróżnik. Model w chmurze nie ma Twoich
       plików, więc na „ile klipów 50 mm w tym roku" nie odpowie nigdy. */
    if (payload.useArchive !== false && !krotko && archiwum.ile() > 0) {
      extras.push({
        role: 'system',
        content:
          'NARZĘDZIE — ARCHIWUM MATERIAŁU: użytkownik ma zindeksowane '
          + `${archiwum.ile()} własnych zdjęć i klipów (aparat, obiektyw, ogniskowa, `
          + 'przysłona, czas, ISO, data, GPS). Gdy pyta o SWÓJ materiał — „ile klipów '
          + 'nakręciłem 50 mm", „pokaż ujęcia z czerwca o zachodzie", „mam coś z tego '
          + 'miejsca" — zakończ odpowiedź osobną linią: [ARCHIWUM: filtry].\n'
          + 'Filtry (wszystkie opcjonalne, oddzielone spacjami):\n'
          + '  folder=Mazury 2026 (FRAGMENT ŚCIEŻKI albo nazwy katalogu — bez wielkości '
          + 'liter i bez ogonków; „mazury" znajdzie też „/Zdjęcia Mazury 2024 Dron/”) ·\n'
          + '  bezFolderu=Mazury 2026 (WYKLUCZENIE — „pokaż najnowsze OPRÓCZ tych '
          + 'z Mazur". Kilka nazw po przecinku. Bez tego filtra nie da się niczego '
          + 'pominąć: nie zakładaj, że wynik sam ominie folder, o którym nie pytałeś) ·\n'
          + '  rok=2026 · miesiac=06 · typ=zdjecie|wideo · aparat=R6 · obiektyw=RF50 ·\n'
          + '  (aparat i obiektyw dopasowują się PO SŁOWACH: „canon r6" trafia '
          + 'i w „Canon EOS R6m2" z EXIF-u, i w „EOS R6 Mark II" z OneDrive) ·\n'
          + '  ogniskowa=50 · ogniskowaOd=24 ogniskowaDo=70 · isoOd=1600 · przyslonaDo=2.8 ·\n'
          + '  swiatlo=złota godzina|niebieska godzina|ostre światło|zmierzch|noc ·\n'
          + '  poraDnia=rano|poludnie|wieczor|noc (można kilka po przecinku: „rano,wieczor") ·\n'
          + '  godzinaOd=6 godzinaDo=14 (GODZINA NA ZEGARZE, 0-23; „do 14" znaczy '
          + 'przed czternastą) ·\n'
          + '  miejsce=Kraków (nazwa miejsca albo regionu — Cosmos sam zamieni ją na '
          + 'współrzędne i dobierze promień; NIE podawaj lat/lon z pamięci) ·\n'
          + '  temat=ptaki-w-locie|zwierzeta-dzikie|zwierzeta-domowe|wyscig|pojazdy-statycznie|\n'
          + '    ulica|portret|sesja-moda|ludzie-w-ruchu|koncert|mecz|slub|wydarzenie-rodzinne|\n'
          + '    krajobraz|gory|las|woda-wybrzeze|jezioro|kanion-klif|architektura|noc-gwiazdy|makro\n'
          + '    (można kilka po przecinku) ·\n'
          + '  obiekt=person · grupuj=ogniskowa|aparat|rok|miesiac|obiektyw|swiatlo|poraDnia|temat\n'
          + 'ZEGAR TO NIE PORA DNIA. Gdy pytanie brzmi „przed 14", „po 14", „rano do '
          + 'dziesiątej" — użyj `godzinaOd=`/`godzinaDo=`. Pole `poraDnia` liczy się '
          + 'z POŁOŻENIA SŁOŃCA, nie z zegarka: zdjęcie z 14:27 ma `poraDnia=wieczor`, '
          + 'bo Słońce jest już na zachód od południa. Filtrowanie pytania o zegar '
          + 'przez `poraDnia` daje odpowiedź, która wygląda na prawdziwą i nie jest.\n'
          + 'MIEJSCE DZIAŁA PO GPS. `miejsce=` zamienia nazwę na współrzędne i filtruje '
          + 'po promieniu — więc dla plików BEZ GPS (a tak jest z większością zdjęć '
          + 'z lustrzanki) nie znajdzie nic, nawet gdy nazwa miejsca jest w ścieżce. '
          + 'Gdy wynik ma pole `zamiastMiejsca`, to jest gotowa odpowiedź: powtórz '
          + 'zapytanie z `folder=` zamiast `miejsce=`. Nie tłumacz wtedy użytkownikowi, '
          + 'że pewnie nazwał folder inaczej — właśnie dostałeś informację, że nie.\n'
          + 'PORA DNIA to co innego niż PORA ŚWIATŁA: złota godzina bywa rano i wieczorem, '
          + 'więc „zdjęcia z rana i z wieczora" to poraDnia=rano,wieczor, a nie swiatlo=.\n'
          + 'TEMAT jest zgadywany z nazw folderów i plików, więc bywa niepełny — przy '
          + 'niskim pokryciu powiedz to wprost, zamiast podawać liczbę jak fakt.\n'
          + 'Z `grupuj` dostaniesz zestawienie liczbowe zamiast listy plików — tego '
          + 'używaj przy pytaniach „ile" i „najczęściej".\n'
          + 'Pora światła jest policzona z pozycji Słońca nad miejscem zdjęcia, '
          + 'nie zgadnięta z godziny. Gdy zdjęcie nie ma GPS-u, liczy się ją dla domu '
          + 'użytkownika, a wpis dostaje `swiatloPrzyblizone: true` — wtedy powiedz, '
          + 'że to przybliżenie.\n'
          + 'GDY UŻYTKOWNIK MÓWI O FOLDERZE — użyj `folder=`, a NIE `miejsce=`. '
          + 'To on porządkuje materiał katalogami i nazwa katalogu jest pewniejsza '
          + 'niż GPS, którego w plikach zwykle nie ma.\n'
          + 'LISTA PLIKÓW TO PRÓBKA, NIE CAŁE ARCHIWUM. Dostajesz kilkadziesiąt '
          + 'najnowszych wpisów i jest to napisane w nagłówku wyniku. NIGDY nie '
          + 'wnioskuj z niej o tym, czego w archiwum NIE MA („same zrzuty ekranu”, '
          + '„brak zdjęć z aparatu”) — na to jest `grupuj`, który liczy CAŁOŚĆ. '
          + 'Gdy szukasz materiału z aparatu, a widzisz same telefony, zrób '
          + '[ARCHIWUM: grupuj=aparat …] zamiast orzekać.\n'
          + 'LIMIT DOTYCZY CIEBIE, NIE UŻYTKOWNIKA. On widzi wszystkie miniatury '
          + 'i sam dochodzi do końca wyniku. Nie pisz więc „pokazuję tylko 20 z 311”, '
          + 'nie przepraszaj za limit, nie proponuj zawężenia „żeby się zmieściło” '
          + 'i nie tłumacz, jak działa przeglądanie. Podaj liczbę znalezionych '
          + 'plików i odpowiedz na pytanie.\n'
          + 'NIE POWTARZAJ TEGO SAMEGO ZAPYTANIA. Jeśli filtr dał zero, zmień go '
          + '(inny rok, `folder=` zamiast `miejsce=`, szerszy zakres) albo powiedz '
          + 'wprost, czego nie znalazłeś. Kolejne identyczne wywołanie da to samo zero.\n'
          + 'DATA BYWA NIEPEWNA. Wpis z polem `dataNiepewna` ma datę wgrania pliku, '
          + 'nie datę zrobienia zdjęcia. Nie podawaj wtedy dnia ani godziny jako '
          + 'faktu — napisz po ludzku, że ta data pochodzi z pliku, nie z aparatu. '
          + 'Nazwy pola ani powodu technicznego NIE wymieniaj (patrz „JAK ODPOWIADASZ").\n'
          + 'ZAWSZE PATRZ NA POKRYCIE DANYCH. Zestawienie oddaje `zDanymi` i `bezDanych`. '
          + 'Gdy większość plików nie ma wypełnionego pola, liczba NIE JEST odpowiedzią '
          + 'na pytanie „ile” — jest rozmiarem luki w metadanych. Powiedz to wprost, '
          + 'zamiast podawać wynik jak fakt.',
      });
    }

    /* Plan zdjęciowy — wyróżnik Cosmosa. Model w chmurze nie wie, gdzie stoisz
       ani jaki masz sprzęt, więc na „jakie ustawienia" odpowiada ogólnikami.
       Tutaj są konkretne liczby, policzone z pozycji Słońca nad Twoim miejscem. */
    if (payload.usePlan !== false && !krotko && userWspolrzedne) {
      extras.push({
        role: 'system',
        content:
          'NARZĘDZIE — PLAN ZDJĘCIOWY: gdy pytanie dotyczy ustawień aparatu, światła, '
          + 'złotej godziny, wschodu/zachodu albo „kiedy najlepiej kręcić", zakończ '
          + 'odpowiedź osobną linią: [PLAN: parametry]. Parametry oddzielaj spacjami, '
          + 'wszystkie są opcjonalne:\n'
          + '  tryb=wideo|zdjecie · klatki=25 · sprzet=canon-r6ii|mavic-3|telefon · '
          + 'ogniskowa=50 · ruch=statyczne|spacer|szybkie · glebia=2.8 · '
          + 'obiektyw=24-70 f/2.8 (można kilka po przecinku: „24-70 f/2.8, 70-200 f/4”) · '
          + 'temat=CO fotografuje (ptaki w locie, jelenie, wyścig motocykli, portret, '
          + 'koncert, ślub, góry, las, jezioro, klify, gwiazdy… — pisz WŁASNYMI SŁOWAMI, '
          + 'lista jest otwarta; z tego wychodzą czas migawki, ogniskowa i przysłona) · '
          + '(glebia PODAWAJ TYLKO wtedy, gdy użytkownik wprost prosił o określoną '
          + 'głębię ostrości — narzucona z własnej inicjatywy wymusza mocny filtr ND '
          + 'i psuje resztę doboru) · '
          + 'zachmurzenie=bezchmurnie|lekkie|pochmurno|deszcz · kiedy=2026-06-21T19:30 · '
          + 'miejsce=Kraków (gdy zdjęcia planowane są GDZIE INDZIEJ niż lokalizacja '
          + 'użytkownika — Cosmos sam zamieni nazwę na współrzędne; NIE zgaduj lat/lon '
          + 'z pamięci) · lat=52.02 lon=20.90 (gdy znasz je dokładnie)\n'
          + 'ZACHMURZENIE POMIŃ, chyba że użytkownik sam je poda — bez niego Cosmos '
          + 'bierze prognozę pogody dla tego miejsca i tej godziny.\n'
          + 'Przykład: [PLAN: tryb=wideo klatki=25 sprzet=canon-r6ii]\n'
          + 'LISTA UJĘĆ: przy `tryb=wideo` dostajesz pole `ujecia` — gotowy zestaw ujęć '
          + 'dobrany do TEMATU i przefiltrowany przez posiadany sprzęt, każde z ogniskową, '
          + 'ruchem kamery i czasem trwania. Podaj je jako listę do odhaczenia w kolejności '
          + 'KRĘCENIA, nie przepisuj jako opowieści. Pole `ujecia.pominiete` mówi, czego NIE '
          + 'da się nakręcić tym sprzętem i dlaczego — POWIEDZ O TYM WPROST. Przemilczenie '
          + 'wygląda, jakby Cosmos o tych ujęciach zapomniał, a nie jakby ich świadomie nie '
          + 'proponował.\n'
          + 'ZORZA: przy Słońcu poniżej horyzontu dostajesz też pole `zorza` — bieżące Kp '
          + 'z NOAA, prognozę i PRÓG Kp dla tego miejsca. „Kp 7" samo w sobie nic nie znaczy: '
          + 'porównaj je z `progNadHoryzontem`. Gdy `szansa` to „brak", powiedz wprost, '
          + 'że zorzy nie będzie, zamiast owijać. Zawsze dodaj, że zasłoni ją zachmurzenie '
          + 'i Księżyc, a patrzeć trzeba na PÓŁNOC.\n'
          + 'Dostaniesz pozycję Słońca, prognozę, godziny złotej i niebieskiej oraz policzone '
          + 'czas/przysłonę/ISO. NIE zgaduj tych liczb sam — Twoja wiedza nie obejmuje '
          + 'dzisiejszej daty ani miejsca, w którym stoi użytkownik.',
      });
    }

    /* Płótno — długi tekst obok rozmowy. Kluczowa jest DRUGA połowa instrukcji:
       bez niej model przy każdej poprawce przepisuje cały dokument, co przy
       scenariuszu na trzy tysiące słów trwa minutę i za każdym razem coś gubi. */
    if (payload.useCanvas !== false && !krotko) {
      extras.push({
        role: 'system',
        content:
          'NARZĘDZIE — PŁÓTNO (dokument obok rozmowy): gdy użytkownik prosi o dłuższy '
          + 'tekst do dalszej pracy — scenariusz, opis filmu, artykuł, plan, dłuższy kod — '
          + 'nie wypisuj go w rozmowie. Otwórz płótno:\n'
          + '```płótno: Tytuł dokumentu\n(cała treść)\n```\n'
          + 'POPRAWKI RÓB FRAGMENTAMI, nigdy nie przepisuj całości:\n'
          + '```płótno-zmiana\n<<<<<<< SZUKAJ\n(dokładny fragment obecnej treści)\n'
          + '=======\n(nowa wersja tego fragmentu)\n>>>>>>> ZAMIEŃ\n```\n'
          + 'Fragment w SZUKAJ musi występować w płótnie DOKŁADNIE RAZ i być przepisany '
          + 'znak w znak. Gdy trafia w dwa miejsca albo nie trafia wcale, zmiana zostanie '
          + 'odrzucona — weź wtedy dłuższy, jednoznaczny fragment. Możesz podać kilka '
          + 'bloków SZUKAJ/ZAMIEŃ naraz.\n'
          + 'Aktualną treść płótna dostajesz w każdej wiadomości — użytkownik mógł ją '
          + 'zmienić ręcznie, więc opieraj się na niej, a nie na tym, co sam napisałeś '
          + 'wcześniej. Krótkie odpowiedzi zostawiaj w rozmowie; płótno jest do tego, '
          + 'co się redaguje.',
      });
    }

    /* Liczenie na danych. Tylko dla modeli poziomu „pełny": mniejsze i tak nie
       napiszą poprawnego programu, a blok kodu wypisany w rozmowie zamiast
       wykonania jest gorszy niż brak narzędzia. */
    if (KOD_WLACZONY && payload.useCode !== false && !krotko) {
      extras.push({
        role: 'system',
        content:
          'NARZĘDZIE — LICZENIE NA DANYCH: gdy pytanie wymaga policzenia, przetworzenia '
          + 'albo zestawienia danych (sumy, średnie, sortowanie, porównania, wykres), '
          + 'NIE licz w pamięci — napisz program i zakończ nim odpowiedź:\n'
          + '```uruchom\n// JavaScript (Node). Wypisz wynik przez console.log\n```\n'
          + 'Program dostanie treść załączników z rozmowy jako pliki w katalogu roboczym '
          + '(np. `fs.readFileSync(\'dane.csv\', \'utf8\')`). Otrzymasz z powrotem to, co '
          + 'wypisał, i dopiero wtedy udzielisz odpowiedzi.\n'
          + 'Możesz zapisać plik wynikowy — `wykres.svg` zostanie pokazany w rozmowie. '
          + 'Wykres rysuj jako czysty SVG, bez bibliotek: żadnej nie ma i `npm install` '
          + 'nie zadziała. Dostępna jest wyłącznie standardowa biblioteka Node.\n'
          + 'Program nie ma dostępu do internetu ani do plików serwera i ma '
          + `${Math.round((Number(process.env.CODE_TIMEOUT_MS || 10000)) / 1000)} sekund na wykonanie.`,
      });
    }

    if (payload.useActions !== false && !bezNarzedzi) {
      const procList = procedury().length
        ? ' Nauczone procedury (możesz zaproponować ich uruchomienie): ' +
          procedury().map((pr) => `"${pr.name}"`).join(', ') +
          '. Aby uruchomić procedurę, użyj [AKCJA: procedura | dokładna nazwa]. ' +
          'Uruchomienie tylko przygotowuje kroki — każdy krok wrażliwy (płatność, wysłanie) ' +
          'i tak wymaga osobnego potwierdzenia użytkownika.'
        : '';
      const devList = urzadzenia().length
        ? ' Podłączone urządzenia (światło, sprzęt, scena): ' +
          urzadzenia().map((d) => `"${d.name}"`).join(', ') +
          '. Aby użyć urządzenia, napisz [AKCJA: urządzenie | dokładna nazwa]. ' +
          'Użytkownik zatwierdza jednym kliknięciem.'
        : '';
      extras.push({
        role: 'system',
        content:
          'NARZĘDZIE — AKCJE (za zgodą użytkownika): gdy użytkownik prosi o zapisanie lub ' +
          'zapamiętanie czegoś, zakończ odpowiedź osobną linią w formacie ' +
          '[AKCJA: typ | treść]. Dozwolone typy: "zapamiętaj" (trwały fakt do pamięci), ' +
          '"notatka" (notatka do bazy wiedzy), "pomysł" (propozycja usprawnienia siebie — ' +
          'nowa umiejętność, procedura, rutyna lub zastosowanie; trafia do listy do akceptacji)' +
          (procList ? ', "procedura" (uruchom nauczoną czynność)' : '') +
          (devList ? ', "urządzenie" (użyj podłączonego urządzenia)' : '') +
          '. Użytkownik ręcznie zatwierdzi akcję. Nie używaj [AKCJA:] w innych sytuacjach. ' +
          'Gdy zauważysz, że mógłbyś się czegoś nauczyć albo coś zautomatyzować dla ' +
          'użytkownika — zaproponuj to przez [AKCJA: pomysł | konkretny opis].' +
          procList + devList,
      });
    }

    if (imageProviders().length && payload.useStudio !== false && !bezNarzedzi) {
      extras.push({
        role: 'system',
        content:
          'NARZĘDZIE — GENEROWANIE OBRAZÓW: gdy użytkownik prosi o wygenerowanie grafiki, obrazu, ' +
          'ilustracji lub loga, odpowiedz krótko i zakończ osobną linią dokładnie w formacie: ' +
          '[OBRAZ: szczegółowy opis sceny po angielsku]. Obraz zostanie wygenerowany i pokazany. ' +
          'Nie używaj [OBRAZ:] w innych sytuacjach.',
      });
    }

    if (payload.useSearch !== false && !bezNarzedzi) {
      extras.push({
        role: 'system',
        content: krotko
          ? 'NARZĘDZIE — ZDJĘCIA Z INTERNETU: gdy użytkownik chce zobaczyć, jak coś '
            + 'naprawdę wygląda, zakończ odpowiedź osobną linią: [GRAFIKA: zapytanie]. '
            + 'To prawdziwe zdjęcia; [OBRAZ:] to rysunek tworzony przez AI — nie myl ich.'
          :
          /* Cosmos umiał obraz wygenerować, ale nie umiał żadnego ZNALEŹĆ.
             Na „pokaż zdjęcia tych miejsc" model odpowiadał uczciwie „nie mam
             dostępu do wyszukiwania obrazów" i proponował wizje artystyczne
             zamiast prawdziwej Majorki. */
          'NARZĘDZIE — WYSZUKIWANIE GRAFIK: gdy użytkownik chce ZOBACZYĆ, jak coś ' +
          'naprawdę wygląda (miejsce, zabytek, produkt, osoba, sprzęt), zakończ odpowiedź ' +
          'osobną linią dokładnie w formacie: [GRAFIKA: zapytanie]. Zdjęcia zostaną ' +
          'znalezione w internecie i pokazane pod Twoją odpowiedzią.\n' +
          'RÓŻNICA MIĘDZY NARZĘDZIAMI: [GRAFIKA:] to prawdziwe zdjęcia z internetu — ' +
          'używaj jej, gdy pada słowo „zdjęcia", „jak wygląda", „pokaż". [OBRAZ:] to ' +
          'rysunek tworzony przez AI — tylko gdy użytkownik prosi o wygenerowanie, ' +
          'narysowanie albo wymyślenie grafiki. Na prośbę o zdjęcia prawdziwego miejsca ' +
          'NIE proponuj wizji artystycznych — po prostu użyj [GRAFIKA:].\n' +
          'Możesz poprosić o grafiki dla kilku rzeczy naraz, oddzielając je średnikiem: ' +
          '[GRAFIKA: Katedra La Seu Palma; plaża Es Trenc; Valldemossa]. Nie pytaj ' +
          'użytkownika, które z wymienionych miejsc chce zobaczyć — pokaż kilka najlepszych.\n' +
          /* Marcin poprosił „ze zdjęciami proszę" do siedmiodniowego planu Majorki
             i dostał osiem zdjęć jednej katedry. Model potraktował znacznik jak
             zapowiedź („oto propozycje zapytań o zdjęcia") i wysłał jedno miejsce
             z siedmiu. Obie te rzeczy trzeba powiedzieć wprost. */
          /* Marcin o planie na Majorkę: „te zdjęcia powinny być pod konkretnym
             dniem, a nie najpierw cały plan, a później same zdjęcia, bo traci
             się nawiązanie do konkretnych punktów w planie". Klient umie już
             wstawić siatkę dokładnie tam, gdzie stoi znacznik — pozostaje
             powiedzieć modelowi, żeby stawiał go w dobrym miejscu. */
          'GDY PROŚBA DOTYCZY PLANU, LISTY MIEJSC ALBO TRASY — wstaw znacznik ' +
          'BEZPOŚREDNIO POD PUNKTEM, KTÓREGO DOTYCZY, a nie na końcu odpowiedzi. ' +
          'Piszesz dzień drugi o Palmie → zaraz pod nim [GRAFIKA: Katedra La Seu ' +
          'Palma]. Piszesz dzień trzeci o Valldemossie → pod nim własny znacznik. ' +
          'Zdjęcia staną dokładnie tam, gdzie postawisz znacznik, więc plan czyta ' +
          'się dalej jako całość. Zbiorcza galeria na końcu odrywa zdjęcia od ' +
          'punktów, których dotyczą.\n' +
          'Znaczników może być kilka w jednej odpowiedzi (do sześciu). W jednym ' +
          'łącz średnikiem tylko to, co dotyczy TEGO SAMEGO punktu planu.\n' +
          'NIE ZAPOWIADAJ WYSZUKIWANIA i NIE RÓB SEKCJI „propozycje zdjęć". ' +
          'Nagłówek, pod którym są same znaczniki, zostaje na ekranie pusty — ' +
          'użytkownik widzi tytuł i nic pod nim. Po prostu wstaw znacznik ' +
          'w tekście planu.\n' +
          /* Marcin: „zdjęcia się nie pokazywały, a jak podałem mu, że Kraków, to
             zgłupiał". Samo doprecyzowanie jest najzwyklejszą rzeczą w rozmowie,
             a model traktował je jak nowy, niezrozumiały temat. */
          'ZAPYTANIE MA BYĆ KONKRETNE: „rynek" nie znajdzie nic sensownego, ' +
          '„Rynek Główny Kraków" znajdzie. Dodawaj miejsce, nazwę własną albo kontekst ' +
          'z rozmowy.\n' +
          'GDY UŻYTKOWNIK DOPOWIADA jedno słowo albo nazwę (np. samo „Kraków”) po tym, ' +
          'jak prosił o zdjęcia — to jest DOPRECYZOWANIE POPRZEDNIEJ PROŚBY, nie nowy ' +
          'temat i nie pytanie o miasto. Połącz to z tym, o co prosił wcześniej, ' +
          'i po prostu poszukaj jeszcze raz.',
      });
    }

  return extras;
}

/**
 * Blok o sprzęcie użytkownika — albo `null`, gdy nic nie zapisano.
 *
 * Do Partii 72 sprzęt znało WYŁĄCZNIE narzędzie planu zdjęciowego. Model,
 * pisząc nastawy z własnej wiedzy — a robi tak przy każdym „jak to ustawić",
 * które nie uruchamia narzędzia — nie miał pojęcia, co użytkownik ma w torbie.
 * Marcin dostał w planie na Majorkę „f/2.8" przy pięciu różnych ujęciach,
 * mając wyłącznie obiektywy f/4 i jeden stały f/1.8. Rada, której nie da się
 * wykonać, jest gorsza od braku rady: wygląda wiarygodnie, a orientujesz się
 * dopiero na miejscu.
 *
 * Zapis jest krótki celowo — to nie wykład o ekspozycji, tylko lista tego,
 * co fizycznie istnieje, plus jedna twarda zasada.
 *
 * @param {{korpus?: string, obiektywy?: string, dodatki?: string}} sprzet
 * @returns {{role: string, content: string}|null}
 */
function blokSprzetu(sprzet) {
  const s = sprzet || {};
  const opis = [
    s.korpus && `Korpus: ${s.korpus}`,
    s.obiektywy && `Obiektywy: ${s.obiektywy}`,
    s.dodatki && `Dodatki: ${s.dodatki}`,
  ].filter(Boolean);
  if (!opis.length) return null;
  return {
    role: 'system',
    content: 'SPRZĘT UŻYTKOWNIKA — to jest CAŁY jego sprzęt:\n'
      + opis.join('\n') + '\n'
      + 'Podając nastawy, trzymaj się tego, co da się nimi ustawić. Nie proponuj '
      + 'przysłony jaśniejszej niż najjaśniejsza z jego optyki na danej ogniskowej, '
      + 'ani ogniskowej, której nie ma. Jeśli ujęcie wymaga sprzętu, którego nie ma '
      + '— powiedz to wprost jednym zdaniem i podaj, co da się zrobić tym, co ma. '
      + 'Sprzęt podany w rozmowie jest świeższy niż ten zapis i ma pierwszeństwo.',
  };
}

module.exports = { zbudujInstrukcje, blokSprzetu };

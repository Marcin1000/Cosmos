/* Kaskada narzędzi modelu – sprawdzana ZACHOWANIEM, nie treścią pliku.

   Do tej pory cała kaskada siedziała w `runGeneration()`: 535 linii jednej
   funkcji czytającej kilkanaście zmiennych modułowych app.js. Nie dało się
   jej uruchomić inaczej niż w przeglądarce, z prawdziwym modelem, więc
   sprawdzaliśmy ją regexpami po źródle – a taki test łapie usunięcie linii
   i nic poza tym. Marcin nazwał to wprost: „za dużo testów sprawdza tekst
   źródła, nie zachowanie".

   Po rozbiciu na `public/narzedzia.js` zależności wchodzą przez fabrykę,
   więc moduł uruchamia się w Node z atrapami i można mu zadać pytania,
   na które regexp nie odpowie:

     – czy znacznik na pewno zniknie z tego, co zobaczy człowiek,
     – czy powtórzone zapytanie zostanie odcięte,
     – czy model dowie się, że z dziesięciu wyszukań poszło jedno,
     – czy narzędzia kończące turę robią to, a pozostałe oddają głos dalej.

   Każdy z tych punktów odpowiada usterce, która NAPRAWDĘ trafiła do Marcina.
*/
const path = require('node:path');
const { utworzNarzedzia } = require(path.join(__dirname, '..', '..', 'public', 'narzedzia.js'));
const { utworzMowe } = require(path.join(__dirname, '..', '..', 'public', 'mowa.js'));

const { tenSamTekst, przepisanie } = utworzMowe({ WAKE_RE: /\bhej kosmos/i });

const fail = [];

/* Wzorce znaczników i czyszczenie – PRAWDZIWE, z public/protokol.js, tak jak
   w app.js. Dawniej test trzymał własną kopię „z ręki" i dlatego nie mógł
   zauważyć, że protokół nie rozpoznaje „【SZUKAJ：…】" z modelu Qwen. */
const protokol = require(path.join(__dirname, '..', '..', 'public', 'protokol.js')).utworzProtokol();
const WZORCE = {
  SZUKAJ: protokol.SEARCH_MARKER_RE,
  ARCHIWUM: protokol.ARCHIVE_RE,
  PLAN: protokol.PLAN_RE,
  PLOTNO_NOWE: protokol.CANVAS_NEW_RE,
  PLOTNO_ZMIANA: protokol.CANVAS_PATCH_RE,
  KOD: protokol.RUN_FENCE_RE,
  GRAFIKA: protokol.PHOTO_MARKER_RE,
  OBRAZ: protokol.IMAGE_MARKER_RE,
};

/** Świeży zestaw narzędzi z atrapami. Każdy przypadek dostaje własny,
 *  żeby jeden nie widział śladów po drugim. */
function stanowisko({ odpowiedzi = {}, opoznienieMs = 0, sygnal = null, znakSilnika = null, metaOdpowiedzi = null } = {}) {
  const dziennik = { doModelu: [], wiadomosci: [], adresy: [], glos: [], odswiezenia: 0 };
  const conv = { messages: [] };

  const narzedzia = utworzNarzedzia({
    t: (klucz, v) => (v ? `${klucz}(${Object.values(v).join(',')})` : klucz),
    saveConversations: () => {},
    renderMessages: () => {},
    dodajWynikNarzedzia: (c, tresc, etykieta, opcje) => {
      // Czwarty argument (kontrakt K1): `sterowanie` = polecenie dla modelu, widok go nie rysuje.
      const ster = Boolean(opcje && opcje.sterowanie);
      dziennik.doModelu.push({ tresc, etykieta, sterowanie: ster });
      c.messages.push({ role: 'user', content: tresc, search: true, ...(ster ? { sterowanie: true } : {}) });
    },
    stripSearchMarker: protokol.stripSearchMarker,
    readJsonSafe: async (r) => r.json(),
    fetch: async (adres, opcje) => {
      dziennik.adresy.push(String(adres));
      // Wolna sieć i „Zatrzymaj”: przerwane żądanie rzuca AbortError, jak prawdziwy fetch.
      const przerwij = () => Object.assign(new Error('przerwano'), { name: 'AbortError' });
      if (opcje && opcje.signal && opcje.signal.aborted) throw przerwij();
      if (opoznienieMs) {
        await new Promise((ok, zle) => {
          const tm = setTimeout(ok, opoznienieMs);
          if (opcje && opcje.signal) opcje.signal.addEventListener('abort', () => { clearTimeout(tm); zle(przerwij()); });
        });
      }
      // `__status` w odpowiedzi atrapy = inny kod HTTP (np. 202 z numerem zadania).
      const { __status: kod = 200, ...dane } = odpowiedzi[Object.keys(odpowiedzi).find((k) => String(adres).includes(k))]
        || { };
      return { ok: kod >= 200 && kod < 300, status: kod, json: async () => dane };
    },
    webSearch: async (q) => `WYNIKI DLA: ${q}`,
    naKafelek: (w) => ({ thumb: w.id, title: w.nazwa }),
    naKontekst: (d) => JSON.stringify(d),
    bezOgonkowKlient: (x) => String(x || '').toLowerCase().trim(),
    zebranyMaterial: () => [],
    zastosujZmianePlotna: () => ({ ok: true, ile: 1 }),
    pokazPlotno: () => {},
    mowGlosem: async (x) => { dziennik.glos.push(x); },
    PORCJA_ARCHIWUM: 24,
    /* PRAWDZIWA zapora przed powtórzoną odpowiedzią, nie atrapa. To ona
       zdecyduje, czy przepisany przez model plan podmieni poprzedni, czy
       stanie obok niego jako druga kopia – a właśnie tego pilnujemy. */
    wstawTekstModelu: (conv, tresc, odKtorej = 0) => {
      const czysty = String(tresc || '');
      if (!czysty.trim()) return null;
      for (let i = conv.messages.length - 1; i >= odKtorej; i--) {
        const m = conv.messages[i];
        if (m.role !== 'assistant' || typeof m.content !== 'string') continue;
        // Ta sama reguła co wstawTekstModelu w app.js: przepisanie = ten sam tekst albo ten sam początek.
        if (przepisanie(m.content, czysty)) { m.content = czysty; return m; }
      }
      // Cała tura już stoi (jak w app.js) – drugi raz ten sam tekst nie wchodzi.
      const tura = conv.messages.slice(odKtorej).filter((m) => m.role === 'assistant' && typeof m.content === 'string' && !m.status)
        .map((m) => m.content).join('\n\n');
      if (tenSamTekst(tura, czysty)) return null;
      const w = { role: 'assistant', content: czysty };
      conv.messages.push(w);
      return w;
    },
    WZORCE,
    // Zdjęcia w jednej odpowiedzi – PRAWDZIWE funkcje protokołu, jak w app.js.
    rozlozZdjecia: protokol.rozlozZdjecia,
    sekcjaWPozycji: protokol.sekcjaWPozycji,
    odswiezZdjecia: () => { dziennik.odswiezenia++; },
    sygnal: sygnal ? () => sygnal : null,
    znakSilnika,
    metaOdpowiedzi,
  });

  const poNazwie = Object.fromEntries(narzedzia.map((n) => [n.nazwa, n]));
  return { narzedzia, poNazwie, conv, dziennik };
}

/** Uruchom narzędzie tak, jak robi to pętla w app.js. */
async function uruchom(st, nazwa, acc, stan) {
  const n = st.poNazwie[nazwa];
  const dop = n.dopasuj(acc);
  if (!dop) return null;
  return n.wykonaj({
    acc,
    dop,
    conv: st.conv,
    depth: 0,
    ostatnia: false,
    przed: acc.replace(dop[0], '').replace(/\[[A-ZŻ]+:?[^\]]*\]/gi, '').trim(),
    stan: stan || { archiwum: new Set(), grafiki: new Set(), plan: new Set() },
  });
}

(async () => {
  /* --- 1. Każde narzędzie rozpoznaje SWÓJ znacznik i tylko swój ---------- */
  {
    const st = stanowisko();
    const PROBKI = [
      ['szukaj', '[SZUKAJ: pogoda Mazury]'],
      ['archiwum', '[ARCHIWUM: folder=Mazury 2026]'],
      ['plan', '[PLAN: obiektyw=24-105 f/4]'],
      ['kod', '```uruchom\nprint(1)\n```'],
      ['grafiki', '[GRAFIKA: Katedra La Seu]'],
      ['obraz', '[OBRAZ: kot w kapeluszu]'],
      ['plotno', '```płótno: Tytuł\ntreść\n```'],
    ];
    for (const [nazwa, tekst] of PROBKI) {
      const trafione = st.narzedzia.filter((n) => n.dopasuj(tekst)).map((n) => n.nazwa);
      const ok = trafione[0] === nazwa;
      if (!ok) fail.push(`„${tekst.slice(0, 24)}…" trafiło w [${trafione}], a miało w ${nazwa}`);
    }
    console.log(`1. rozpoznawanie znaczników: ${PROBKI.length} próbek`);
  }

  /* --- 2. ZNACZNIK NIE MA PRAWA ZOSTAĆ NA EKRANIE -----------------------
     To jest usterka z zapisu rozmowy o Majorce: model napisał dziesięć
     zapytań, wykonaliśmy pierwsze, a dziewięć pozostałych stanęło
     użytkownikowi jako treść odpowiedzi. Gałąź wyszukiwania usuwała wtedy
     jedno wystąpienie zamiast wszystkich. */
  {
    const st = stanowisko();
    const acc = 'Sprawdzę to.\n[SZUKAJ: aaa]\n[SZUKAJ: bbb]\n[SZUKAJ: ccc]';
    await uruchom(st, 'szukaj', acc);
    const naEkranie = st.conv.messages
      .filter((m) => m.role === 'assistant')
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');
    const zostalo = (naEkranie.match(/\[SZUKAJ:/gi) || []).length;
    console.log(`2. po trzech znacznikach na ekranie zostało: ${zostalo}`);
    if (zostalo) fail.push(`${zostalo} znaczników [SZUKAJ:] zostało w treści dla użytkownika`);

    /* I druga połowa tej samej usterki: model musi WIEDZIEĆ, że z trzech
       zapytań poszło jedno. Bez tego pisze odpowiedź tak, jakby miał
       wszystkie – stąd plan Majorki z godzinami otwarcia atrakcji,
       których nikt nie sprawdził. */
    const doModelu = st.dziennik.doModelu.map((x) => x.tresc).join('\n');
    const maUwage = /3 wyszukań|TYLKO to jedno/.test(doModelu);
    console.log(`   model wie, że wykonano jedno z trzech: ${maUwage}`);
    if (!maUwage) fail.push('model nie dowiaduje się, że pozostałe wyszukania nie poszły');
  }

  /* --- 2b. Znacznik ZE SPACJĄ albo w nawiasach pełnej szerokości ---------
     Małe modele lokalne piszą „[ SZUKAJ: …]", Qwen – „【SZUKAJ：…】". Dotąd
     polecenie stało na ekranie, a wyszukiwanie nie ruszało. */
  {
    const st = stanowisko();
    const acc = 'Sprawdzę prognozę.\n【SZUKAJ：pogoda Kraków jutro】';
    const trafione = st.narzedzia.filter((n) => n.dopasuj(acc)).map((n) => n.nazwa);
    await uruchom(st, 'szukaj', acc);
    const naEkranie = st.conv.messages.filter((m) => m.role === 'assistant')
      .map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const zapytanie = st.dziennik.doModelu.map((x) => x.tresc).join('\n');
    console.log(`2b. „【SZUKAJ：…】" → narzędzie: ${trafione[0] || 'żadne'}, na ekranie znacznik: ${/SZUKAJ/.test(naEkranie)}`);
    if (trafione[0] !== 'szukaj') fail.push(`znacznik pełnej szerokości nie uruchomił wyszukiwania (${trafione})`);
    if (!/pogoda Kraków jutro/.test(zapytanie)) fail.push('wyszukanie nie dostało treści zapytania ze znacznika pełnej szerokości');
    if (/SZUKAJ|【|】/.test(naEkranie)) fail.push('znacznik pełnej szerokości został na ekranie');
    const zeSpacja = stanowisko();
    if (!zeSpacja.narzedzia.some((n) => n.nazwa === 'szukaj' && n.dopasuj('[ SZUKAJ: pogoda ]'))) fail.push('„[ SZUKAJ: … ]" ze spacją nie rozpoznany');
    if (zeSpacja.narzedzia.some((n) => n.dopasuj('Zobacz [Szukaj w Google](https://google.com) i [Plan B].'))) {
      fail.push('odnośnik Markdown albo zwykły nawias w zdaniu odpalił narzędzie');
    }
  }

  /* --- 2c. Pasek „w toku" domyka się po narzędziu -----------------------
     „Przeszukuję archiwum…", „Generuję obraz…" i „Liczę…" zostawały
     w rozmowie na zawsze – także nad gotową odpowiedzią i nad błędem. */
  {
    const wToku = ['chat.searchingArchive', 'chat.genImage', 'chat.running'];
    const zostaly = (st) => st.conv.messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .filter((c) => wToku.includes(c.trim()));   // atrapa `t` oddaje sam klucz
    const stA = stanowisko({ odpowiedzi: { '/api/archive/search': { znaleziono: 3, wyniki: [] } } });
    await uruchom(stA, 'archiwum', '[ARCHIWUM: rok=2025]');
    const stO = stanowisko({ odpowiedzi: { '/api/studio/image': { error: 'brak klucza' } } });
    await uruchom(stO, 'obraz', '[OBRAZ: a red fox]');
    const stK = stanowisko({ odpowiedzi: { '/api/run': { stdout: '4', stderr: '', wyniki: [] } } });
    await uruchom(stK, 'kod', '```uruchom\nprint(2+2)\n```');
    const razem = [...zostaly(stA), ...zostaly(stO), ...zostaly(stK)];
    console.log(`2c. pasków „w toku" po archiwum, obrazie (z błędem) i kodzie: ${razem.length}`);
    if (razem.length) fail.push(`paski „w toku" zostały w rozmowie: ${razem.join(' | ')}`);
  }

  /* --- 3. Powtórzone zapytanie do archiwum jest odcinane ----------------- */
  {
    const st = stanowisko({ odpowiedzi: { '/api/archive/search': { znaleziono: 0, wyniki: [] } } });
    const stan = { archiwum: new Set(), grafiki: new Set(), plan: new Set() };
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury 2026]', stan);
    const poPierwszym = st.dziennik.adresy.length;
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury 2026]', stan);
    const poDrugim = st.dziennik.adresy.length;
    console.log(`3. zapytań do archiwum po dwóch identycznych wywołaniach: ${poDrugim}`);
    if (poDrugim !== poPierwszym) {
      fail.push('powtórzone zapytanie do archiwum poszło drugi raz – hamulec nie działa');
    }
    const ostatnie = st.dziennik.doModelu[st.dziennik.doModelu.length - 1].tresc;
    if (!/DOKŁADNIE to samo/.test(ostatnie)) {
      fail.push('model nie dostaje informacji, że się powtórzył');
    }
    /* Ale INNY filtr musi przejść – inaczej hamulec blokowałby pracę. */
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Kraków]', stan);
    if (st.dziennik.adresy.length === poDrugim) {
      fail.push('inny filtr też został zablokowany – hamulec jest za szeroki');
    }
  }

  /* --- 4. Wykluczenie folderu dociera do zapytania -----------------------
     Marcin: „kiedy piszę, że chcę zobaczyć zdjęcia oprócz jakiegoś folderu,
     to i tak wrzuca mi zdjęcia z tego folderu". Filtr `bezFolderu=` działa
     w archiwum, ale musi jeszcze DOJŚĆ z treści znacznika do adresu –
     a wartość ma spację w środku, co rozbijało parsowanie. */
  {
    const st = stanowisko({ odpowiedzi: { '/api/archive/search': { znaleziono: 5, wyniki: [] } } });
    await uruchom(st, 'archiwum', '[ARCHIWUM: bezFolderu=Mazury 2026 typ=zdjecie]');
    const adres = st.dziennik.adresy[0] || '';
    const maWykluczenie = /bezFolderu=Mazury\+2026|bezFolderu=Mazury%202026/.test(adres);
    const maTyp = /typ=zdjecie/.test(adres);
    console.log(`4. adres zapytania: ${adres.slice(0, 90)}`);
    if (!maWykluczenie) fail.push('`bezFolderu=Mazury 2026` nie dotarło w całości do zapytania');
    if (!maTyp) fail.push('drugi filtr po wartości ze spacją przepadł');
  }

  /* --- 4b. Siatka miniatur zapamiętuje, czym dobrać następną porcję -----
     Bez `dalej` przycisk „pokaż kolejne" nie ma czego powtórzyć i wynik
     kończy się na pierwszych 24 plikach z 311. Sprawdzamy TREŚĆ wiadomości,
     a nie obecność pola w źródle – poprzednia wersja tego sprawdzenia była
     regexpem po app.js i padła przy przeniesieniu kaskady do osobnego pliku,
     mimo że pole powstawało bez zmian. */
  {
    const st = stanowisko({
      odpowiedzi: {
        '/api/archive/search': {
          znaleziono: 311,
          wyniki: [{ id: 'onedrive:a', nazwa: 'a.CR3', zrodlo: 'onedrive' },
            { id: 'onedrive:b', nazwa: 'b.CR3', zrodlo: 'onedrive' }],
        },
      },
    });
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury 2026]');
    const siatka = st.conv.messages.find((m) => m.content && m.content.photos);
    const d = siatka && siatka.content.dalej;
    console.log(`4b. siatka: ${siatka ? siatka.content.photos.length : 0} miniatur, `
      + `dalej=${d ? `pomin ${d.pomin} z ${d.razem}` : 'BRAK'}`);
    if (!siatka) fail.push('archiwum nie dołożyło siatki miniatur mimo plików z OneDrive');
    else if (!d) fail.push('siatka nie zapamiętała zapytania – przycisk „pokaż kolejne" nie zadziała');
    else {
      if (d.razem !== 311) fail.push(`dalej.razem=${d.razem}, a znaleziono 311`);
      if (d.pomin !== 2) fail.push(`dalej.pomin=${d.pomin}, a oddano 2 pliki`);
      if (!/folder=/.test(d.q)) fail.push('dalej.q nie zawiera filtrów – kolejna porcja byłaby inna');
      if (/limit=|pomin=/.test(d.q)) {
        fail.push('dalej.q zawiera limit albo pomin – stopka dokleja je sama i wyszłoby podwójnie');
      }
    }
  }

  /* --- 4c. DRUGIE PYTANIE PO UDANYM PIERWSZYM JEST ODCINANE -------------
     Marcin: „rozpoczynają kolejne wznawiania odpowiedzi samoczynnie".
     W zapisie „Pokaż zdjęcia z Mazur" widać jedno pytanie, DWA przeszukania
     archiwum i dwie prawie identyczne odpowiedzi. Odcinanie powtórzeń tego
     nie łapało, bo łapie wyłącznie filtry identyczne, a model za drugim
     razem zmienił drobiazg. */
  {
    const st = stanowisko({
      odpowiedzi: {
        '/api/archive/search': {
          znaleziono: 316,
          wyniki: [{ id: 'onedrive:a', nazwa: 'a.CR3', zrodlo: 'onedrive' }],
        },
      },
    });
    const stan = { archiwum: new Set(), grafiki: new Set(), plan: new Set(), archiwumZWynikiem: false };
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury 2026]', stan);
    const poPierwszym = st.dziennik.adresy.length;
    // INNY filtr, ale pierwszy już coś znalazł – drugie pytanie jest zbędne.
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury 2026 typ=zdjecie]', stan);
    console.log(`4c. po udanym pierwszym: zapytań ${st.dziennik.adresy.length} `
      + `(po pierwszym było ${poPierwszym})`);
    if (st.dziennik.adresy.length !== poPierwszym) {
      fail.push('drugie zapytanie po udanym pierwszym poszło mimo wszystko – '
        + 'użytkownik dostanie dwie prawie identyczne odpowiedzi');
    }
    const ostatnie = st.dziennik.doModelu[st.dziennik.doModelu.length - 1].tresc;
    if (!/MASZ JUŻ WYNIK/.test(ostatnie)) {
      fail.push('model nie dostaje informacji, że ma już dane i ma odpowiedzieć');
    }
  }

  /* --- 4d. ...ALE PO PUSTYM WYNIKU DRUGIE PYTANIE JEST SENSOWNE ---------
     Gdy pierwszy filtr dał zero, drugi bywa właściwą reakcją – inny rok,
     `folder=` zamiast `miejsce=`. Hamulec, który blokowałby i to, zamieniłby
     jedną usterkę na drugą. */
  {
    const st = stanowisko({ odpowiedzi: { '/api/archive/search': { znaleziono: 0, wyniki: [] } } });
    const stan = { archiwum: new Set(), grafiki: new Set(), plan: new Set(), archiwumZWynikiem: false };
    await uruchom(st, 'archiwum', '[ARCHIWUM: miejsce=Mazury]', stan);
    const poPierwszym = st.dziennik.adresy.length;
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury]', stan);
    console.log(`4d. po pustym pierwszym: zapytań ${st.dziennik.adresy.length}`);
    if (st.dziennik.adresy.length <= poPierwszym) {
      fail.push('po pustym wyniku drugie zapytanie zostało zablokowane – '
        + 'hamulec jest za szeroki i odcina sensowną poprawkę filtra');
    }
  }

  /* --- 5. Narzędzia kończące turę kończą ją, reszta oddaje głos ---------- */
  {
    const st = stanowisko({ odpowiedzi: { '/api/studio/image': { url: '/x.png' } } });
    const wynikObraz = await uruchom(st, 'obraz', '[OBRAZ: kot]');
    const wynikSzukaj = await uruchom(st, 'szukaj', '[SZUKAJ: cokolwiek]');
    console.log(`5. obraz → ${wynikObraz.akcja}, szukaj → ${wynikSzukaj.akcja}`);
    if (wynikObraz.akcja !== 'koniec') fail.push('generowanie obrazu nie kończy tury');
    if (wynikSzukaj.akcja !== 'dalej') fail.push('wyszukiwanie kończy turę zamiast oddać głos modelowi');
    if (!st.poNazwie.obraz.zawszeDozwolone) {
      fail.push('obraz nie jest oznaczony jako dozwolony w ostatniej rundzie – '
        + 'model straciłby możliwość dokończenia turą kończącą');
    }
    if (st.poNazwie.szukaj.zawszeDozwolone) {
      fail.push('wyszukiwanie jest oznaczone jako zawsze dozwolone – pętla nie miałaby końca');
    }
    /* Runda 10: zdjęcia KOŃCZĄ turę. Po nich model dostawał „ZDJĘCIA POKAZANE…
       napisz domknięcie albo nic” i myślał pół minuty nad całym planem – to było
       „wisi w poszukiwaniu zdjęć” ze zrzutu 4 Marcina. Po zdjęciach: zero
       wiadomości dla modelu i `koniec`; wolno im też działać w ostatniej rundzie
       (gotowy plan ze zdjęciami nie może przepaść na limicie). */
    const stG = stanowisko({ odpowiedzi: { '/api/search/images': { results: [{ thumb: '/a', full: '/a1' }] } } });
    const wynikG = await uruchom(stG, 'grafiki', 'Plan.\n[GRAFIKA: Wawel]');
    console.log(`5. grafiki → ${wynikG && wynikG.akcja}, wiadomości dla modelu po zdjęciach: ${stG.dziennik.doModelu.length}`);
    if (!wynikG || wynikG.akcja !== 'koniec') fail.push('zdjęcia nie kończą tury – po nich znowu pójdzie runda modelu');
    if (stG.dziennik.doModelu.length) fail.push(`po zdjęciach model dostaje wynik narzędzia („${stG.dziennik.doModelu[0].tresc.slice(0, 40)}…”) – to zaproszenie do kolejnej rundy`);
    if (!stG.poNazwie.grafiki.zawszeDozwolone) fail.push('zdjęcia nie są dozwolone w ostatniej rundzie – gotowy plan ze zdjęciami przepadłby na limicie');
  }

  /* --- 5b. Obraz, który generuje się dłużej, niż Cloudflare czeka --------
     Serwer odpowiada wtedy 202 z numerem zadania (lib/zadania.js). Znacznik
     [OBRAZ:] w czacie ma dopytać /api/zadania i wstawić gotowy obraz – a nie
     pokazać „brak obrazu", bo pierwsza odpowiedź nie miała adresu. */
  {
    const st = stanowisko({ odpowiedzi: {
      '/api/studio/image': { __status: 202, ok: true, zadanie: 'z-1', stan: 'pracuje' },
      '/api/zadania': { stan: 'gotowe', wynik: { url: '/api/kb/raw?id=z-tla' } },
    } });
    const w = await uruchom(st, 'obraz', '[OBRAZ: kot o zmierzchu]');
    const obraz = st.conv.messages.find((m) => m.content && Array.isArray(m.content.images));
    const dopytal = st.dziennik.adresy.some((a) => a.includes('/api/zadania?id=z-1'));
    console.log(`5b. obraz z zadania w tle → ${obraz ? obraz.content.images[0] : 'brak'}, dopytał: ${dopytal}`);
    if (!dopytal) fail.push('[OBRAZ:] po odpowiedzi 202 nie dopytuje zadania w tle');
    if (!obraz || obraz.content.images[0] !== '/api/kb/raw?id=z-tla') {
      fail.push('[OBRAZ:] po odpowiedzi 202 nie wstawia obrazu z zadania w tle');
    }
    if (!w || w.akcja !== 'koniec') fail.push('[OBRAZ:] z zadania w tle nie kończy tury');
  }

  /* --- 6. Błąd sieci nie przerywa tury, tylko wraca do modelu ------------
     Model ma się dowiedzieć, że nie wyszło. Wyjątek rzucony z narzędzia
     zabiłby całą turę i użytkownik zobaczyłby gołe „⚠ Failed to fetch". */
  {
    const st = stanowisko();
    st.dziennik.adresy.length = 0;
    const narzedzia = utworzNarzedzia({
      t: (k) => k,
      saveConversations: () => {},
      renderMessages: () => {},
      dodajWynikNarzedzia: (c, tresc) => st.dziennik.doModelu.push({ tresc }),
      stripSearchMarker: (x) => x,
      readJsonSafe: async (r) => r.json(),
      fetch: async () => { throw new Error('sieć padła'); },
      webSearch: async () => '',
      naKafelek: (w) => w,
      naKontekst: (d) => JSON.stringify(d),
      bezOgonkowKlient: (x) => x,
      zebranyMaterial: () => [],
      zastosujZmianePlotna: () => ({ ok: true, ile: 1 }),
      pokazPlotno: () => {},
      mowGlosem: async () => {},
      PORCJA_ARCHIWUM: 24,
    /* PRAWDZIWA zapora przed powtórzoną odpowiedzią, nie atrapa. To ona
       zdecyduje, czy przepisany przez model plan podmieni poprzedni, czy
       stanie obok niego jako druga kopia – a właśnie tego pilnujemy. */
    wstawTekstModelu: (conv, tresc, odKtorej = 0) => {
      const czysty = String(tresc || '');
      if (!czysty.trim()) return null;
      for (let i = conv.messages.length - 1; i >= odKtorej; i--) {
        const m = conv.messages[i];
        if (m.role !== 'assistant' || typeof m.content !== 'string') continue;
        // Ta sama reguła co wstawTekstModelu w app.js: przepisanie = ten sam tekst albo ten sam początek.
        if (przepisanie(m.content, czysty)) { m.content = czysty; return m; }
      }
      const w = { role: 'assistant', content: czysty };
      conv.messages.push(w);
      return w;
    },
      WZORCE,
    });
    const planNarzedzie = narzedzia.find((n) => n.nazwa === 'plan');
    let rzucil = false;
    try {
      await planNarzedzie.wykonaj({
        acc: '[PLAN: obiektyw=50]', dop: planNarzedzie.dopasuj('[PLAN: obiektyw=50]'),
        conv: { messages: [] }, depth: 0, ostatnia: false, przed: '',
        stan: { archiwum: new Set(), grafiki: new Set(), plan: new Set() },
      });
    } catch { rzucil = true; }
    const ostatnie = st.dziennik.doModelu[st.dziennik.doModelu.length - 1];
    console.log(`6. przy padniętej sieci narzędzie rzuciło wyjątkiem: ${rzucil}`);
    if (rzucil) fail.push('narzędzie rzuca wyjątkiem przy błędzie sieci – zabija całą turę');
    if (!ostatnie || !/sieć padła/.test(ostatnie.tresc)) {
      fail.push('model nie dowiaduje się o błędzie sieci');
    }
  }

  /* --- 7. Wartość z przecinkami i spacjami przeżywa parsowanie -----------
     „obiektyw=24-70 f/2.8, 70-200 f/4" to JEDNA wartość. Dzielenie po
     spacjach urywało ją na „24-70", przysłona przepadała i Cosmos liczył
     f/4 komuś, kto ma f/2.8. */
  {
    const st = stanowisko({ odpowiedzi: { '/api/plan': { ok: true } } });
    await uruchom(st, 'plan', '[PLAN: obiektyw=24-70 f/2.8, 70-200 f/4 temat=portret]');
    const doModelu = st.dziennik.doModelu.map((x) => x.tresc).join();
    console.log(`7. plan wywołany, wynik trafił do modelu: ${/DANE PLANU/.test(doModelu)}`);
    if (!/DANE PLANU/.test(doModelu)) fail.push('wynik planu nie trafił do modelu');
  }

    /* --- 9. DWA NARZĘDZIA W JEDNEJ ODPOWIEDZI -----------------------------
     Rozmowa o Majorce, zapis przysłany przez Marcina. Model napisał plan,
     a pod nim [PLAN: …] ORAZ sześć [GRAFIKA: …]. Kaskada brała pierwsze
     pasujące narzędzie z listy – plan – a pozostałe znaczniki czyściła
     i wyrzucała. Prośba o zdjęcia znikała bez śladu; Marcin: „nie wyrzuca
     żadnych zdjęć nigdzie".

     Tu sprawdzamy obie strony naraz: że plan się policzył ORAZ że zdjęcia
     dotarły – od rundy 10 w JEDNEJ wiadomości (tekst + `zdjecia` z miejscem
     znacznika), każda grupa przy swoim punkcie. */
  {
    const st = stanowisko({
      odpowiedzi: {
        '/api/plan': { slonce: { faza: 'złota godzina' }, ustawienia: { czas: '1/250' } },
        '/api/search/images': { results: [{ thumb: '/a', title: 'x', source: 'https://e.pl' }] },
      },
    });
    const stan = { archiwum: new Set(), grafiki: new Set(), plan: new Set() };
    const acc = 'Plan wycieczki.\n\nDzień 2 – Palma.\n[GRAFIKA: Katedra La Seu]\n'
      + 'Dzień 6 – Es Trenc.\n[GRAFIKA: plaża Es Trenc]\n[PLAN: miejsce=Es Trenc]';

    const dopPlan = st.poNazwie.plan.dopasuj(acc);
    await st.poNazwie.plan.wykonaj({
      acc, dop: dopPlan, conv: st.conv, depth: 0, ostatnia: false, przed: '', stan,
    });
    const dopGraf = st.poNazwie.grafiki.dopasuj(acc);
    await st.poNazwie.grafiki.wykonaj({
      acc, dop: dopGraf, conv: st.conv, depth: 0, ostatnia: false, przed: '', stan,
    });

    const odpowiedzi = st.conv.messages.filter((m) => m.role === 'assistant' && !m.status);
    const w = odpowiedzi.find((m) => Array.isArray(m.zdjecia)) || { zdjecia: [], content: '' };
    const grupy = w.zdjecia.map((g) => `${g.q}:${g.stan}`);
    console.log(`9. plan + grafiki w jednej odpowiedzi → wiadomości: ${odpowiedzi.length}, grupy: ${grupy.join(', ') || 'brak'}`);
    if (w.zdjecia.filter((g) => g.stan === 'gotowe').length !== 2) {
      fail.push(`z dwóch znaczników [GRAFIKA:] są ${w.zdjecia.length} grupy zdjęć – `
        + 'prośba o zdjęcia ginie, gdy w tej samej odpowiedzi jest inne narzędzie');
    }
    if (odpowiedzi.length !== 1) fail.push(`odpowiedź rozpadła się na ${odpowiedzi.length} wiadomości – Kopiuj i Regeneruj złapią kawałek`);

    /* Kolejność i miejsce: zdjęcia Katedry po tekście dnia 2, przed dniem 6. */
    const [g1, g2] = w.zdjecia;
    const przed = (g) => String(w.content).slice(0, g ? g.po : 0);
    if (!g1 || !g2 || g1.q !== 'Katedra La Seu' || !/Dzień 2/.test(przed(g1)) || /Dzień 6/.test(przed(g1)) || !/Dzień 6/.test(przed(g2))) {
      fail.push('grupy zdjęć nie stoją przy punktach, pod którymi model postawił znaczniki');
    }

    // Znacznik nie ma prawa zostać w treści dla człowieka.
    const naEkranie = st.conv.messages
      .filter((m) => m.role === 'assistant' && typeof m.content === 'string')
      .map((m) => m.content).join('\n');
    if (/\[(GRAFIKA|PLAN):/i.test(naEkranie)) {
      fail.push('znacznik został w treści pokazanej użytkownikowi');
    }
  }

  /* --- 10. TEN SAM PLAN LICZONY DRUGI RAZ -------------------------------
     Z tego samego zapisu: model po dostaniu danych planu przepisywał całą
     odpowiedź i prosił o plan JESZCZE RAZ, dla tego samego miejsca. Trzy
     rundy, trzy identyczne obliczenia, trzy kopie planu na ekranie. */
  {
    const st = stanowisko({ odpowiedzi: { '/api/plan': { ustawienia: { czas: '1/250' } } } });
    const stan = { archiwum: new Set(), grafiki: new Set(), plan: new Set() };
    await uruchom(st, 'plan', '[PLAN: miejsce=Es Trenc]', stan);
    const poPierwszym = st.dziennik.adresy.filter((a) => a.includes('/api/plan')).length;
    await uruchom(st, 'plan', '[PLAN: miejsce=Es Trenc]', stan);
    const poDrugim = st.dziennik.adresy.filter((a) => a.includes('/api/plan')).length;
    console.log(`10. obliczeń planu po dwóch identycznych prośbach: ${poDrugim}`);
    if (poDrugim !== poPierwszym) {
      fail.push('ten sam plan liczony drugi raz – model dostanie te same dane '
        + 'i przepisze całą odpowiedź od nowa');
    }
    const doModelu = st.dziennik.doModelu.map((x) => x.tresc).join('\n');
    if (!/JUŻ POLICZYŁEŚ/.test(doModelu)) {
      fail.push('model nie dowiaduje się, że ten plan już ma');
    }
    if (!/NIE PRZEPISUJ/.test(doModelu)) {
      fail.push('model nie dostaje zakazu przepisywania całej odpowiedzi od nowa');
    }
  }

  /* --- 11. PRZEPISANA ODPOWIEDŹ PODMIENIA, NIE DOKŁADA ------------------
     Ostatnia zapora: nawet gdy model mimo wszystko przepisze plan, na
     ekranie ma zostać JEDNA kopia. */
  {
    const st = stanowisko();
    const plan = 'Plan wycieczki na Majorkę. Dzień pierwszy przyjazd i spacer po plaży '
      + 'Ponent o zachodzie słońca. Dzień drugi Palma, katedra La Seu i zamek Bellver '
      + 'w porannym świetle. Dzień trzeci Sant Elm oraz rejs na wyspę Dragonera. '
      + 'Dzień czwarty przylądek Formentor i latarnia morska. Zabierz filtr '
      + 'polaryzacyjny oraz statyw do dłuższych ekspozycji.';
    const planPoprawiony = plan + ' Statyw jest niezbędny przy wschodach.';
    st.conv.__turaOd = 0;
    const dep = st.narzedzia; // tylko po to, żeby nie było nieużywanej zmiennej
    void dep;
    // Ta sama droga, którą chodzi tekst modelu w kaskadzie.
    const wstaw = (tresc) => {
      const czysty = String(tresc || '');
      for (let i = st.conv.messages.length - 1; i >= 0; i--) {
        const m = st.conv.messages[i];
        if (m.role !== 'assistant' || typeof m.content !== 'string') continue;
        if (tenSamTekst(m.content, czysty)) { m.content = czysty; return; }
      }
      st.conv.messages.push({ role: 'assistant', content: czysty });
    };
    wstaw(plan);
    wstaw(planPoprawiony);
    wstaw(planPoprawiony);
    const kopie = st.conv.messages.filter((m) => m.role === 'assistant').length;
    console.log(`11. po trzykrotnym przepisaniu planu kopii na ekranie: ${kopie}`);
    if (kopie !== 1) fail.push(`przepisany plan zostawił ${kopie} kopie zamiast jednej`);
    if (st.conv.messages[0].content !== planPoprawiony) {
      fail.push('podmiana zostawiła starszą, uboższą wersję zamiast najnowszej');
    }
    // A zupełnie inna odpowiedź ma stanąć obok, nie podmienić poprzedniej.
    wstaw('Zupełnie inna odpowiedź o czymś innym: ustawienia aparatu do zdjęć '
      + 'nocnych, gwiazdy, droga mleczna, statyw, wężyk spustowy, długi czas '
      + 'naświetlania, wysokie ISO oraz jasny obiektyw szerokokątny na pełną klatkę.');
    const poObcej = st.conv.messages.filter((m) => m.role === 'assistant').length;
    console.log(`   po dołożeniu innej odpowiedzi: ${poObcej}`);
    if (poObcej !== 2) fail.push('zapora zjadła odpowiedź, która była naprawdę inna');
  }

    /* --- 12. UKŁAD, O KTÓRY POPROSIŁ MARCIN -------------------------------
     „Chciałbym żeby działało tak, żeby od razu było: Dzień 1, Plan, Zdjęcia,
     potem Dzień 2, Plan, Zdjęcia itd.” – i od rundy 10: „jak w ChatGPT,
     w poziomym scrollu”, a nie w osobnych wiadomościach. Gwarancje:
       a) plan stoi RAZ, w jednej wiadomości – bez krojenia,
       b) każda grupa zdjęć ma miejsce (`po`) za tekstem SWOJEGO dnia, a przy
          nagłówkach Markdown – numer sekcji, nad którą stanie pasek,
       c) po wyciętym znaczniku nie zostaje pusty punkt listy.

     Ośmiodniowy plan, każdy dzień ze swoim znacznikiem zapisanym tak, jak
     robi to model: jako punkt listy. */
  for (const naglowki of [false, true]) {
    const st = stanowisko({
      odpowiedzi: { '/api/search/images': { results: [{ thumb: '/a', title: 'x', source: 'https://e.pl' }] } },
    });
    const stan = { archiwum: new Set(), grafiki: new Set(), plan: new Set() };
    const dni = ['Santa Ponsa zachód', 'plaża Ponent', 'Valldemossa klasztor',
      'Western Water Park', 'Katedra La Seu', 'Cap de Formentor',
      'jaskinie Drach', 'taras hotelowy'];
    const tytul = (i) => (naglowki ? `### Dzień ${i + 1}` : `**Dzień ${i + 1}**`);
    const acc = dni.map((q, i) => `${tytul(i)}\n`
      + `- Zwiedzanie i zdjęcia.\n`
      + `- **Ustawienia:** 24-105 mm f/4, ISO 200, 1/125 s.\n`
      + `- [GRAFIKA: ${q}]\n`).join('\n')
      + '\n### Nastawy aparatu – podsumowanie\nTabela na końcu.';

    const dop = st.poNazwie.grafiki.dopasuj(acc);
    await st.poNazwie.grafiki.wykonaj({
      acc, dop, conv: st.conv, depth: 0, ostatnia: false,
      przed: acc.replace(/\[GRAFIKA:[^\]]*\]/gi, '').trim(), stan,
    });

    const odpowiedzi = st.conv.messages.filter((m) => m.role === 'assistant');
    const w = odpowiedzi[0] || { content: '', zdjecia: [] };
    const tekst = String(w.content);
    const grupy = w.zdjecia || [];
    console.log(`12${naglowki ? 'b (nagłówki ###)' : 'a (dni pogrubione)'}. plan ośmiodniowy → wiadomości: ${odpowiedzi.length}, grup zdjęć: ${grupy.length}, sekcje: ${grupy.map((g) => g.sekcja).join(',')}`);
    if (odpowiedzi.length !== 1) fail.push(`12. plan rozpadł się na ${odpowiedzi.length} wiadomości zamiast jednej`);
    if (grupy.length !== dni.length) fail.push(`12. z ${dni.length} dni jest ${grupy.length} grup zdjęć`);
    // (a) plan raz
    if ((tekst.match(/Dzień 1\b/g) || []).length !== 1) fail.push('12. plan stoi w odpowiedzi więcej niż raz');
    // (b) grupa za tekstem swojego dnia, przed następnym
    const zle = grupy.filter((g, i) => {
      const przed = tekst.slice(0, g.po);
      return g.q !== dni[i] || !przed.includes(`Dzień ${i + 1}`) || przed.includes(`Dzień ${i + 2}`);
    });
    if (zle.length) fail.push(`12. zdjęcia nie stoją przy swoim dniu: ${zle.map((g) => g.q).join(', ')}`);
    const sekcjeOk = grupy.every((g, i) => g.sekcja === (naglowki ? i + 1 : 0));
    if (!sekcjeOk) fail.push(`12. zła sekcja paska (${grupy.map((g) => g.sekcja).join(',')}) – przy nagłówkach pasek ma stanąć nad swoim dniem, bez nagłówków – na górze`);
    // (c) puste punkty
    if (/^[ \t]*[-*•][ \t]*$/m.test(tekst)) fail.push('12. pusty punkt listy po wyciętym znaczniku');
    if (!/Nastawy aparatu[\s\S]*Tabela na końcu\.$/.test(tekst)) fail.push('12. podsumowanie z końca planu zniknęło albo nie stoi na końcu');
  }

  /* --- ZDJĘCIA ODŁOŻONE, A MODEL ZAPOMNIAŁ ZNACZNIKÓW -------------------
     Zdjęcia czekają na gotową odpowiedź (app.js). Gdy model napisze ją bez
     [GRAFIKA:], Cosmos stawia znaczniki sam – pod akapitem o danym miejscu,
     nie pod nagłówkiem, w którym przypadkiem pada nazwa miasta. */
  {
    const { wstawZnacznikiZdjec } = require(path.join(__dirname, '..', '..', 'public', 'protokol.js')).utworzProtokol();
    const plan = 'Plan na sobotę w Krakowie (z policzonym światłem):\n\n'
      + '**Rano – Wawel.** Złota godzina 6:52, katedra od strony Wisły.\n\n'
      + '**Wieczór – Kazimierz.** Niebieska godzina, statyw przy ulicy Szerokiej.\n\nMiłego dnia.';
    const wynik = wstawZnacznikiZdjec(plan, ['Wawel Kraków', 'Kazimierz Kraków ulica Szeroka']);
    const bloki = wynik.split('\n\n');
    const gdzie = (q) => bloki.findIndex((b) => b.includes(`[GRAFIKA: ${q}]`));
    console.log(`12. znaczniki postawione sami: Wawel → akapit ${gdzie('Wawel Kraków')}, Kazimierz → ${gdzie('Kazimierz Kraków ulica Szeroka')}`);
    if (!/Wawel\./.test(bloki[gdzie('Wawel Kraków')] || '')) fail.push('zdjęcia Wawelu nie stoją pod akapitem o Wawelu');
    if (!/Kazimierz\./.test(bloki[gdzie('Kazimierz Kraków ulica Szeroka')] || '')) fail.push('zdjęcia Kazimierza nie stoją pod akapitem o Kazimierzu');
    if (wynik.replace(/\n\[GRAFIKA: [^\]]*\]/g, '') !== plan) fail.push('wstawianie znaczników zmieniło treść odpowiedzi');
  }

  /* --- 13. Tekst nie ginie i nie staje drugi raz ---------------------------
     Agencja, runda 7: kawałki planu z tym samym początkiem nadpisywały się
     nawzajem, a przepisany od nowa plan stawał drugi raz. Od rundy 10 tekst
     jest jeden, ale gwarancje zostają: (a) nic z tekstu nie znika, (b) plan
     przepisany przez model w tej samej turze nie staje drugi raz, a zdjęcia
     nowego miejsca dochodzą do istniejącej odpowiedzi. */
  {
    const st = stanowisko({ odpowiedzi: { '/api/search/images': { results: [{ thumb: 't1', full: 'f1' }, { thumb: 't2', full: 'f2' }] } } });
    const wstep = 'Dzień zaczynamy o świcie przy katedrze, zanim zjadą się autokary z turystami, a światło '
      + 'jest jeszcze miękkie i złote; statyw rozstawiamy po zachodniej stronie placu, przy fontannie.';
    const acc = `${wstep} Potem targ Ballarò i ulica Maqueda.\n[GRAFIKA: Katedra Palermo]\n`
      + `${wstep} Potem Monreale i widok na Conca d'Oro.\n[GRAFIKA: Monreale]\nMiłej podróży.`;
    await uruchom(st, 'grafiki', acc);
    const teksty = st.conv.messages.filter((m) => m.role === 'assistant' && typeof m.content === 'string').map((m) => m.content);
    console.log(`13a. akapity z tym samym początkiem → ${teksty.length} wypowiedzi tekstu`);
    if (!teksty.some((x) => /Ballarò/.test(x)) || !teksty.some((x) => /Monreale i widok/.test(x))) {
      fail.push('akapit z tym samym początkiem zniknął z odpowiedzi');
    }

    const dzien = (n, miejsce) => `**Dzień ${n} – ${miejsce}.** Rano spacer po starym mieście, w południe przerwa na granitę `
      + `w kawiarni przy placu, po południu punkt widokowy nad zatoką i zachód słońca z tarasu. Wieczorem kolacja w trattorii.`;
    const st2 = stanowisko({ odpowiedzi: { '/api/search/images': { results: [{ thumb: 'x1', full: 'y1' }] } } });
    const pierwszy = `${dzien(1, 'Palermo')}\n[GRAFIKA: Palermo]\n${dzien(2, 'Cefalù')}\n[GRAFIKA: Cefalù]\n${dzien(3, 'Taormina')}`;
    const stan = { archiwum: new Set(), grafiki: new Set(), plan: new Set() };
    await uruchom(st2, 'grafiki', pierwszy, stan);
    const ileTekstu = () => st2.conv.messages.filter((m) => m.role === 'assistant' && typeof m.content === 'string').length;
    const przed = ileTekstu();
    const przepisany = `${dzien(1, 'Palermo')}\n${dzien(2, 'Cefalù')}\n${dzien(3, 'Taormina')}\n[GRAFIKA: Taormina teatr grecki]`;
    await uruchom(st2, 'grafiki', przepisany, stan);
    const grupy = st2.conv.messages.flatMap((m) => (Array.isArray(m.zdjecia) ? m.zdjecia : [])).filter((g) => (g.photos || []).length).length;
    console.log(`13b. plan przepisany od nowa → tekstu ${przed} → ${ileTekstu()}, grup ze zdjęciami ${grupy}`);
    if (ileTekstu() !== przed) fail.push('przepisany od nowa plan stanął w rozmowie drugi raz');
    if (grupy !== 3) fail.push(`zdjęcia nowego miejsca nie doszły do istniejącej odpowiedzi (grup: ${grupy})`);
  }

  /* --- 14. rozlozZdjecia i historia ze znacznikami ------------------------
     Ta sama funkcja liczy miejsca zdjęć w przeglądarce i na serwerze (sierota,
     lib/biegi.js). Historia dla modelu wstawia jego WŁASNE znaczniki w te
     miejsca – zamiast ramki „(pokazano zdjęcia: …)”, którą słabe modele
     przepisywały na ekran. */
  {
    const surowe = 'Wstęp.\n\n### Dzień 1 – Taormina\n- Spacer.\n- [GRAFIKA: Taormina]\n\n```\n[GRAFIKA: Isola Bella]\n```\n### Dzień 2\nKoniec [GRAFIKA: Etna; Etna] i dalej.';
    const r = protokol.rozlozZdjecia(surowe);
    const opis = r.zdjecia.map((g) => `${g.q}@s${g.sekcja}`).join(', ');
    console.log(`14. rozlozZdjecia → ${opis}; tekst ${JSON.stringify(r.tresc).slice(0, 80)}…`);
    if (/GRAFIKA|```/.test(r.tresc)) fail.push('14. po rozłożeniu w tekście został znacznik albo pusty płot');
    if (opis !== 'Taormina@s1, Isola Bella@s1, Etna@s2') fail.push(`14. złe grupy albo sekcje: ${opis}`);
    if (!/Koniec i dalej\./.test(r.tresc)) fail.push('14. tekst obok znacznika w środku zdania zniknął');
    const zPowrotem = protokol.zeZnacznikamiZdjec(r.tresc, r.zdjecia);
    const powtorne = protokol.rozlozZdjecia(zPowrotem);
    if (powtorne.tresc !== r.tresc || powtorne.zdjecia.map((g) => `${g.q}@${g.po}`).join() !== r.zdjecia.map((g) => `${g.q}@${g.po}`).join()) {
      fail.push('14. historia ze znacznikami nie odtwarza tych samych miejsc – model zobaczy inną odpowiedź niż ta na ekranie');
    }
    const dlugi = Array.from({ length: 18 }, (_, i) => `Punkt ${i + 1}.\n[GRAFIKA: Miejsce ${i + 1}]`).join('\n');
    const r18 = protokol.rozlozZdjecia(dlugi);
    if (r18.zdjecia.length !== 16 || r18.pominiete.join() !== 'Miejsce 17,Miejsce 18') fail.push(`14. limit 16 znaczników: grup ${r18.zdjecia.length}, pominięte ${r18.pominiete.join()}`);
  }

  /* --- 15. „Zatrzymaj” w trakcie szukania zdjęć ---------------------------
     Dawniej Stop czekał 18 s, aż dojdzie ostatnie z czternastu zapytań. Teraz
     sygnał tury przerywa pobieranie: zapytania w toku padają, kolejnych nie ma,
     a tekst odpowiedzi zostaje. */
  {
    const ctrl = new AbortController();
    const st = stanowisko({ odpowiedzi: { '/api/search/images': { results: [{ thumb: '/a', full: '/a1' }] } }, opoznienieMs: 400, sygnal: ctrl.signal });
    const acc = Array.from({ length: 10 }, (_, i) => `Dzień ${i + 1}.\n[GRAFIKA: Miejsce ${i + 1}]`).join('\n');
    const start = Date.now();
    const praca = uruchom(st, 'grafiki', acc);
    setTimeout(() => ctrl.abort(), 100);
    const wynik = await praca;
    const czas = Date.now() - start;
    const w = st.conv.messages.find((m) => Array.isArray(m.zdjecia)) || { zdjecia: [] };
    const zapytan = st.dziennik.adresy.filter((a) => a.includes('/api/search/images')).length;
    console.log(`15. Stop przy 10 miejscach → koniec po ${czas} ms, zapytań ${zapytan}, stany: ${[...new Set(w.zdjecia.map((g) => g.stan))].join(',')}`);
    if (czas > 1000) fail.push(`15. „Zatrzymaj” nie przerywa szukania zdjęć (${czas} ms)`);
    if (zapytan > 4) fail.push(`15. po „Zatrzymaj” poszły kolejne zapytania o zdjęcia (${zapytan})`);
    if (!w.zdjecia.length || w.zdjecia.some((g) => g.stan !== 'przerwane')) fail.push('15. grupy po „Zatrzymaj” nie są oznaczone jako przerwane – szkielet wisiałby na zawsze');
    if (!/Dzień 10/.test(String(w.content))) fail.push('15. po „Zatrzymaj” zniknął tekst odpowiedzi');
    if (!wynik || wynik.akcja !== 'koniec') fail.push('15. po „Zatrzymaj” narzędzie nie kończy tury');
  }

  /* --- 16. Te same miejsca drugi raz: pamięć rozmowy, a na prośbę o inne – inne zdjęcia ---
     „Zmień dzień 3” – model przepisuje plan z tymi samymi znacznikami: te same
     zdjęcia, bez sieci. „Pokaż inne zdjęcia” – dalsze wyniki, których nie było. */
  {
    const wyniki = Array.from({ length: 16 }, (_, i) => ({ thumb: `/t${i}`, full: `/f${i}` }));
    const st = stanowisko({ odpowiedzi: { '/api/search/images': { results: wyniki } } });
    await uruchom(st, 'grafiki', 'Plan.\n[GRAFIKA: Wawel]');
    const pierwsze = st.conv.messages.find((m) => Array.isArray(m.zdjecia)).zdjecia[0].photos.map((f) => f.full).join();
    st.conv.messages.push({ role: 'user', content: 'Zmień dzień 3 na Kazimierz' });
    const zapytaniaPrzed = st.dziennik.adresy.length;
    await uruchom(st, 'grafiki', 'Plan zmieniony.\n[GRAFIKA: Wawel]');
    const drugie = st.conv.messages.filter((m) => Array.isArray(m.zdjecia)).pop().zdjecia[0].photos.map((f) => f.full).join();
    const bezSieci = st.dziennik.adresy.length === zapytaniaPrzed;
    st.conv.messages.push({ role: 'user', content: 'Pokaż inne zdjęcia Wawelu' });
    await uruchom(st, 'grafiki', 'Proszę.\n[GRAFIKA: Wawel]');
    const trzecie = st.conv.messages.filter((m) => Array.isArray(m.zdjecia)).pop().zdjecia[0].photos.map((f) => f.full);
    console.log(`16. to samo miejsce: z pamięci ${bezSieci && drugie === pierwsze ? 'tak' : 'NIE'}; „inne zdjęcia”: ${trzecie.slice(0, 2).join(',')}…`);
    if (!bezSieci || drugie !== pierwsze) fail.push('16. to samo miejsce w przepisanym planie idzie do sieci i daje inne zdjęcia');
    if (trzecie.some((f) => pierwsze.split(',').includes(f))) fail.push('16. „pokaż inne zdjęcia” daje zdjęcia, które już były');
  }

  /* --- 17. „Do pobrania” – zdjęcia dochodzą bez modelu -----------------------
     Odpowiedź-sierota (telefon zgaszony w trakcie planu) albo odświeżenie
     w fazie zdjęć zapisują grupy jako „do-pobrania”; po otwarciu rozmowy
     przeglądarka dociąga je sama. */
  {
    const st = stanowisko({ odpowiedzi: { '/api/search/images': { results: [{ thumb: '/a', full: '/a1' }] } } });
    const w = { role: 'assistant', content: 'Plan.', zdjecia: [{ q: 'Etna', etykieta: 'Etna', po: 5, sekcja: 0, photos: [], stan: 'do-pobrania' }] };
    st.conv.messages.push(w);
    const bylo = await st.poNazwie.grafiki.dociagnij(st.conv, w);
    console.log(`17. dociągnięcie „do-pobrania” → ${w.zdjecia[0].stan}, ${w.zdjecia[0].photos.length} zdjęć, zapytań do modelu: ${st.dziennik.doModelu.length}`);
    if (!bylo || w.zdjecia[0].stan !== 'gotowe' || !w.zdjecia[0].photos.length) fail.push('17. zdjęcia „do pobrania” nie dochodzą po otwarciu rozmowy');
    if (st.dziennik.doModelu.length) fail.push('17. dociąganie zdjęć zawołało model');
  }

  /* --- 18. NARZĘDZIE ZBĘDNE PO GOTOWEJ ODPOWIEDZI KOŃCZY TURĘ (runda 11, R1, K2) ---
     Prowadzący zespołu napisał cały plan, a na końcu [PLAN:], choć plan policzył
     już fotograf. Kaskada zamawiała drugą rundę: tekst znikał z ekranu, model
     pisał i liczył całość drugi raz („odpowiedź resetuje się”). Teraz znacznik
     wypada, tekst zostaje odpowiedzią tury, drugiej rundy nie ma. */
  {
    const ODPOWIEDZ = '### Dzień 1 · Taormina · zwiedzanie\n'
      + 'Rano Teatro Greco, zanim przyjdą wycieczki; po południu spacer Corso Umberto i zejście do Isola Bella. '
      + 'Wieczorem złota godzina nad zatoką – najlepszy kadr z tarasu przy Piazza IX Aprile.\n'
      + '- Światło: złota godzina 18:33–19:08, niebieska do 19:35.\n'
      + '- Aparat: 24-105 f/4, statyw, ISO 100, f/8, czas z pomiaru; filtr ND przy morzu.\n\n'
      + '### Dzień 2 · Etna · odpoczynek\n'
      + 'Wjazd kolejką na Montagnola, krótki spacer po kraterach Silvestri, wieczorem powrót do Taorminy.\n'
      + '- Światło: miękkie po 17:00, mgła na szczycie rano.\n'
      + '- Aparat: szeroki kąt, polaryzator, zapasowa bateria – zimno na wysokości.';
    const stanT = (dod = {}) => ({ archiwum: new Set(), grafiki: new Set(), plan: new Set(), ...dod });
    const asystent = (st) => st.conv.messages.filter((m) => m.role === 'assistant' && typeof m.content === 'string' && !m.status);

    // a) plan policzony przez fotografa + gotowa odpowiedź → koniec, bez /api/plan, bez polecenia dla modelu
    {
      const st = stanowisko({ znakSilnika: () => ({ silnik: 'claude', model: 'claude-sonnet-5' }), metaOdpowiedzi: () => ({ think: 'MYŚL', note: '' }) });
      const w = await uruchom(st, 'plan', `${ODPOWIEDZ}\n\n[PLAN: miejsce=Taormina kiedy=2027-09-15]`, stanT({ planZespolu: true }));
      const odp = asystent(st);
      console.log(`18a. plan zespołu + gotowa odpowiedź → ${w && w.akcja}, wiadomości asystenta: ${odp.length}, do modelu: ${st.dziennik.doModelu.length}`);
      if (!w || w.akcja !== 'koniec') fail.push('18a. zbędny [PLAN:] po gotowej odpowiedzi nie kończy tury – druga runda napisze wszystko od nowa');
      if (st.dziennik.adresy.some((a) => a.includes('/api/plan'))) fail.push('18a. plan policzony drugi raz mimo planu fotografa');
      if (st.dziennik.doModelu.length) fail.push('18a. model dostał polecenie – czyli będzie druga runda');
      if (odp.length !== 1 || !/Teatro Greco/.test(odp[0].content) || /\[PLAN/i.test(odp[0].content)) fail.push('18a. gotowa odpowiedź nie stoi w rozmowie (albo stoi ze znacznikiem)');
      if (w && (/\[PLAN/i.test(w.finalText) || !/Etna/.test(w.finalText))) fail.push('18a. finalText ze znacznikiem albo bez treści odpowiedzi');
      if (odp[0] && (odp[0].silnik !== 'claude' || odp[0].think !== 'MYŚL')) fail.push('18a. odpowiedź bez znaku silnika albo myślenia rundy');
    }
    // b) sama zapowiedź przed znacznikiem → runda idzie dalej, polecenie z `sterowanie`, zapowiedź nie staje się kartą
    {
      const st = stanowisko();
      const w = await uruchom(st, 'plan', 'Sprawdzę jeszcze plan.\n[PLAN: miejsce=Taormina]', stanT({ planZespolu: true }));
      console.log(`18b. sama zapowiedź → ${w && w.akcja}, sterowanie: ${st.dziennik.doModelu.map((x) => x.sterowanie).join()}`);
      if (!w || w.akcja !== 'dalej') fail.push('18b. przy samej zapowiedzi tura nie idzie dalej – odpowiedzi nie byłoby wcale');
      if (!st.dziennik.doModelu.length || !st.dziennik.doModelu.every((x) => x.sterowanie)) fail.push('18b. polecenie „plan już policzony” bez `sterowanie: true` (K1) – stanie na ekranie');
      if (asystent(st).length) fail.push('18b. zapowiedź „Sprawdzę…” stała się osobną kartą');
    }
    // c) szkic z treścią, ale nie pełna odpowiedź → zostaje w rozmowie (druga runda go widzi), runda dalej
    {
      const st = stanowisko();
      const szkic = 'Taormina we wrześniu to dobry wybór: ciepłe morze, mniej ludzi niż w sierpniu, długie złote godziny nad zatoką.';
      const w = await uruchom(st, 'plan', `${szkic}\n[PLAN: miejsce=Taormina]`, stanT({ planZespolu: true }));
      const odp = asystent(st);
      if (!w || w.akcja !== 'dalej' || odp.length !== 1 || !/ciepłe morze/.test(odp[0].content)) fail.push('18c. szkic sprzed zbędnego znacznika znika – druga runda pisze bez niego');
    }
    // d) gotowa odpowiedź + [PLAN:] + [GRAFIKA:] → zdjęcia w tej samej wiadomości, tura kończy się
    {
      const st = stanowisko({ odpowiedzi: { '/api/search/images': { results: [{ thumb: '/t', full: '/f' }] } } });
      const acc = ODPOWIEDZ.replace('### Dzień 2', '[GRAFIKA: Teatro Greco Taormina]\n\n### Dzień 2') + '\n[PLAN: miejsce=Taormina]';
      const w = await uruchom(st, 'plan', acc, stanT({ planZespolu: true }));
      const odp = asystent(st);
      const zdj = odp[0] && odp[0].zdjecia;
      console.log(`18d. z [GRAFIKA:] → ${w && w.akcja}, grup zdjęć: ${(zdj || []).length}`);
      if (!w || w.akcja !== 'koniec' || odp.length !== 1 || !zdj || zdj[0].q !== 'Teatro Greco Taormina') fail.push('18d. zbędny [PLAN:] z [GRAFIKA:] – zdjęcia nie trafiają do gotowej odpowiedzi albo tura idzie dalej');
      if (st.dziennik.adresy.some((a) => a.includes('/api/plan'))) fail.push('18d. plan policzony drugi raz');
      if (odp[0] && /\[(PLAN|GRAFIKA)/i.test(odp[0].content)) fail.push('18d. znacznik na ekranie');
    }
    // e) powtórzone wyszukanie / archiwum / plan po gotowej odpowiedzi → koniec
    {
      const st = stanowisko();
      const stan = stanT({ szukaj: new Set(['pogoda taormina']) });
      const w = await uruchom(st, 'szukaj', `${ODPOWIEDZ}\n[SZUKAJ: pogoda Taormina]`, stan);
      if (!w || w.akcja !== 'koniec' || st.dziennik.doModelu.length) fail.push('18e. powtórzone [SZUKAJ:] po gotowej odpowiedzi zamawia drugą rundę');
      const st2 = stanowisko();
      const w2 = await uruchom(st2, 'archiwum', `${ODPOWIEDZ}\n[ARCHIWUM: rok=2024]`, stanT({ archiwumZWynikiem: true }));
      if (!w2 || w2.akcja !== 'koniec' || st2.dziennik.adresy.length) fail.push('18e. drugie [ARCHIWUM:] po gotowej odpowiedzi zamawia drugą rundę');
      const st3 = stanowisko({ odpowiedzi: { '/api/plan': { ok: true } } });
      const stan3 = stanT();
      await uruchom(st3, 'plan', '[PLAN: miejsce=Taormina]', stan3);
      const w3 = await uruchom(st3, 'plan', `${ODPOWIEDZ}\n[PLAN: miejsce=Taormina]`, stan3);
      if (!w3 || w3.akcja !== 'koniec' || st3.dziennik.adresy.filter((a) => a.includes('/api/plan')).length !== 1) fail.push('18e. powtórzony [PLAN:] po gotowej odpowiedzi zamawia drugą rundę');
    }
    // f) K1: każde polecenie-sterowanie ma `sterowanie: true`, a prawdziwy wynik narzędzia – nie
    {
      const st = stanowisko({ odpowiedzi: { '/api/plan': { ok: true }, '/api/archive': { wyniki: [{ id: 1 }], znaleziono: 1 } } });
      const stan = stanT();
      await uruchom(st, 'szukaj', '[SZUKAJ: Etna]', stan);
      await uruchom(st, 'szukaj', '[SZUKAJ: Etna]', stan);
      await uruchom(st, 'archiwum', '[ARCHIWUM: rok=2024]', stan);
      await uruchom(st, 'archiwum', '[ARCHIWUM: rok=2023]', stan);
      await uruchom(st, 'plan', '[PLAN: miejsce=Etna]', stan);
      await uruchom(st, 'plan', '[PLAN: miejsce=Etna]', stan);
      const ster = st.dziennik.doModelu.map((x) => `${x.sterowanie ? 'S' : 'W'}`).join('');
      console.log(`18f. kolejność wyników (W – wynik, S – sterowanie): ${ster}`);
      if (ster !== 'WSWSWS') fail.push(`18f. flaga \`sterowanie\` nie odróżnia poleceń od wyników (${ster}, oczekiwane WSWSWS)`);
      if (!st.poNazwie.szukaj.gdyLimit(['', 'x']).sterowanie) fail.push('18f. komunikat o limicie rund bez `sterowanie`');
    }
    // g) R5: sama zapowiedź przed wyszukaniem nie staje się osobną kartą; tekst z treścią – tak
    {
      const st = stanowisko();
      await uruchom(st, 'szukaj', 'Aby przygotować plan, potrzebuję aktualnych informacji o godzinach otwarcia.\n[SZUKAJ: Teatro Greco godziny]');
      const st2 = stanowisko();
      await uruchom(st2, 'szukaj', 'Teatro Greco to najlepszy punkt widokowy w Taorminie.\n\nGodziny otwarcia zmieniają się sezonowo.\n[SZUKAJ: Teatro Greco godziny]');
      console.log(`18g. kart tekstu: zapowiedź ${asystent(st).length}, treść ${asystent(st2).length}`);
      if (asystent(st).length) fail.push('18g. zapowiedź „potrzebuję aktualnych informacji” stoi jako osobna karta nad paskiem „Szukam…”');
      if (asystent(st2).length !== 1) fail.push('18g. tekst z treścią przed wyszukaniem zniknął');
    }
  }

  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKASKADA NARZĘDZI OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Kaskada narzędzi modelu — sprawdzana ZACHOWANIEM, nie treścią pliku.

   Do tej pory cała kaskada siedziała w `runGeneration()`: 535 linii jednej
   funkcji czytającej kilkanaście zmiennych modułowych app.js. Nie dało się
   jej uruchomić inaczej niż w przeglądarce, z prawdziwym modelem, więc
   sprawdzaliśmy ją regexpami po źródle — a taki test łapie usunięcie linii
   i nic poza tym. Marcin nazwał to wprost: „za dużo testów sprawdza tekst
   źródła, nie zachowanie".

   Po rozbiciu na `public/narzedzia.js` zależności wchodzą przez fabrykę,
   więc moduł uruchamia się w Node z atrapami i można mu zadać pytania,
   na które regexp nie odpowie:

     — czy znacznik na pewno zniknie z tego, co zobaczy człowiek,
     — czy powtórzone zapytanie zostanie odcięte,
     — czy model dowie się, że z dziesięciu wyszukań poszło jedno,
     — czy narzędzia kończące turę robią to, a pozostałe oddają głos dalej.

   Każdy z tych punktów odpowiada usterce, która NAPRAWDĘ trafiła do Marcina.
*/
const path = require('node:path');
const { utworzNarzedzia } = require(path.join(__dirname, '..', '..', 'public', 'narzedzia.js'));

const fail = [];

/* Wzorce znaczników — te same, co w app.js. Trzymamy je tu z ręki, bo
   przepisanie ich z pliku regexpem byłoby dokładnie tym testem po źródle,
   od którego uciekamy. */
const WZORCE = {
  SZUKAJ: /\[SZUKAJ:\s*([^\]\n]+)\]/i,
  ARCHIWUM: /\[ARCHIWUM:?\s*([^\]\n]*)\]/i,
  PLAN: /\[PLAN:?\s*([^\]\n]*)\]/i,
  PLOTNO_NOWE: /```płótno(?::\s*([^\n]*))?\s*\n([\s\S]*?)```/i,
  PLOTNO_ZMIANA: /```płótno-zmiana\s*\n([\s\S]*?)```/i,
  KOD: /```uruchom\s*\n([\s\S]*?)```/i,
  GRAFIKA: /\[GRAFIKA:\s*([^\]\n]+)\]/i,
  OBRAZ: /\[OBRAZ:\s*([^\]\n]+)\]/i,
};

/** Świeży zestaw narzędzi z atrapami. Każdy przypadek dostaje własny,
 *  żeby jeden nie widział śladów po drugim. */
function stanowisko({ odpowiedzi = {} } = {}) {
  const dziennik = { doModelu: [], wiadomosci: [], adresy: [], glos: [] };
  const conv = { messages: [] };

  const narzedzia = utworzNarzedzia({
    t: (klucz, v) => (v ? `${klucz}(${Object.values(v).join(',')})` : klucz),
    saveConversations: () => {},
    renderMessages: () => {},
    dodajWynikNarzedzia: (c, tresc, etykieta) => {
      dziennik.doModelu.push({ tresc, etykieta });
      c.messages.push({ role: 'user', content: tresc, search: true });
    },
    /* Prawdziwe czyszczenie znaczników byłoby kopią z app.js, a kopia
       rozjeżdża się po cichu. Tu wystarczy coś, co usuwa WSZYSTKIE — bo
       sprawdzamy, czy kaskada w ogóle je przez to przepuszcza. */
    stripSearchMarker: (x) => String(x || '')
      .replace(/\[(SZUKAJ|ARCHIWUM|PLAN|GRAFIKA|OBRAZ):?[^\]]*\]/gi, '').trim(),
    readJsonSafe: async (r) => r.json(),
    fetch: async (adres) => {
      dziennik.adresy.push(String(adres));
      const dane = odpowiedzi[Object.keys(odpowiedzi).find((k) => String(adres).includes(k))]
        || { };
      return { ok: true, status: 200, json: async () => dane };
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
    WZORCE,
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
    stan: stan || { archiwum: new Set(), grafiki: new Set() },
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
       wszystkie — stąd plan Majorki z godzinami otwarcia atrakcji,
       których nikt nie sprawdził. */
    const doModelu = st.dziennik.doModelu.map((x) => x.tresc).join('\n');
    const maUwage = /3 wyszukań|TYLKO to jedno/.test(doModelu);
    console.log(`   model wie, że wykonano jedno z trzech: ${maUwage}`);
    if (!maUwage) fail.push('model nie dowiaduje się, że pozostałe wyszukania nie poszły');
  }

  /* --- 3. Powtórzone zapytanie do archiwum jest odcinane ----------------- */
  {
    const st = stanowisko({ odpowiedzi: { '/api/archive/search': { znaleziono: 0, wyniki: [] } } });
    const stan = { archiwum: new Set(), grafiki: new Set() };
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury 2026]', stan);
    const poPierwszym = st.dziennik.adresy.length;
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury 2026]', stan);
    const poDrugim = st.dziennik.adresy.length;
    console.log(`3. zapytań do archiwum po dwóch identycznych wywołaniach: ${poDrugim}`);
    if (poDrugim !== poPierwszym) {
      fail.push('powtórzone zapytanie do archiwum poszło drugi raz — hamulec nie działa');
    }
    const ostatnie = st.dziennik.doModelu[st.dziennik.doModelu.length - 1].tresc;
    if (!/DOKŁADNIE to samo/.test(ostatnie)) {
      fail.push('model nie dostaje informacji, że się powtórzył');
    }
    /* Ale INNY filtr musi przejść — inaczej hamulec blokowałby pracę. */
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Kraków]', stan);
    if (st.dziennik.adresy.length === poDrugim) {
      fail.push('inny filtr też został zablokowany — hamulec jest za szeroki');
    }
  }

  /* --- 4. Wykluczenie folderu dociera do zapytania -----------------------
     Marcin: „kiedy piszę, że chcę zobaczyć zdjęcia oprócz jakiegoś folderu,
     to i tak wrzuca mi zdjęcia z tego folderu". Filtr `bezFolderu=` działa
     w archiwum, ale musi jeszcze DOJŚĆ z treści znacznika do adresu —
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
     a nie obecność pola w źródle — poprzednia wersja tego sprawdzenia była
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
    else if (!d) fail.push('siatka nie zapamiętała zapytania — przycisk „pokaż kolejne" nie zadziała');
    else {
      if (d.razem !== 311) fail.push(`dalej.razem=${d.razem}, a znaleziono 311`);
      if (d.pomin !== 2) fail.push(`dalej.pomin=${d.pomin}, a oddano 2 pliki`);
      if (!/folder=/.test(d.q)) fail.push('dalej.q nie zawiera filtrów — kolejna porcja byłaby inna');
      if (/limit=|pomin=/.test(d.q)) {
        fail.push('dalej.q zawiera limit albo pomin — stopka dokleja je sama i wyszłoby podwójnie');
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
    const stan = { archiwum: new Set(), grafiki: new Set(), archiwumZWynikiem: false };
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury 2026]', stan);
    const poPierwszym = st.dziennik.adresy.length;
    // INNY filtr, ale pierwszy już coś znalazł — drugie pytanie jest zbędne.
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury 2026 typ=zdjecie]', stan);
    console.log(`4c. po udanym pierwszym: zapytań ${st.dziennik.adresy.length} `
      + `(po pierwszym było ${poPierwszym})`);
    if (st.dziennik.adresy.length !== poPierwszym) {
      fail.push('drugie zapytanie po udanym pierwszym poszło mimo wszystko — '
        + 'użytkownik dostanie dwie prawie identyczne odpowiedzi');
    }
    const ostatnie = st.dziennik.doModelu[st.dziennik.doModelu.length - 1].tresc;
    if (!/MASZ JUŻ WYNIK/.test(ostatnie)) {
      fail.push('model nie dostaje informacji, że ma już dane i ma odpowiedzieć');
    }
  }

  /* --- 4d. ...ALE PO PUSTYM WYNIKU DRUGIE PYTANIE JEST SENSOWNE ---------
     Gdy pierwszy filtr dał zero, drugi bywa właściwą reakcją — inny rok,
     `folder=` zamiast `miejsce=`. Hamulec, który blokowałby i to, zamieniłby
     jedną usterkę na drugą. */
  {
    const st = stanowisko({ odpowiedzi: { '/api/archive/search': { znaleziono: 0, wyniki: [] } } });
    const stan = { archiwum: new Set(), grafiki: new Set(), archiwumZWynikiem: false };
    await uruchom(st, 'archiwum', '[ARCHIWUM: miejsce=Mazury]', stan);
    const poPierwszym = st.dziennik.adresy.length;
    await uruchom(st, 'archiwum', '[ARCHIWUM: folder=Mazury]', stan);
    console.log(`4d. po pustym pierwszym: zapytań ${st.dziennik.adresy.length}`);
    if (st.dziennik.adresy.length <= poPierwszym) {
      fail.push('po pustym wyniku drugie zapytanie zostało zablokowane — '
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
      fail.push('obraz nie jest oznaczony jako dozwolony w ostatniej rundzie — '
        + 'model straciłby możliwość dokończenia turą kończącą');
    }
    if (st.poNazwie.szukaj.zawszeDozwolone) {
      fail.push('wyszukiwanie jest oznaczone jako zawsze dozwolone — pętla nie miałaby końca');
    }
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
      WZORCE,
    });
    const planNarzedzie = narzedzia.find((n) => n.nazwa === 'plan');
    let rzucil = false;
    try {
      await planNarzedzie.wykonaj({
        acc: '[PLAN: obiektyw=50]', dop: planNarzedzie.dopasuj('[PLAN: obiektyw=50]'),
        conv: { messages: [] }, depth: 0, ostatnia: false, przed: '',
        stan: { archiwum: new Set(), grafiki: new Set() },
      });
    } catch { rzucil = true; }
    const ostatnie = st.dziennik.doModelu[st.dziennik.doModelu.length - 1];
    console.log(`6. przy padniętej sieci narzędzie rzuciło wyjątkiem: ${rzucil}`);
    if (rzucil) fail.push('narzędzie rzuca wyjątkiem przy błędzie sieci — zabija całą turę');
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

  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKASKADA NARZĘDZI OK');
  process.exit(fail.length ? 1 : 0);
})();

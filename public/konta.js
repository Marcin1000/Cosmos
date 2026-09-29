/* ============================================================
   Konta w przeglądarce: zaproszenie, Twoje konto, Dostęp

   Trzy ekrany, jedna zasada: wszystko, co przyszło od INNEJ osoby – imię,
   login – trafia na ekran przez `textContent`, nigdy przez `innerHTML`.
   Panel Dostęp pokazuje właścicielowi imiona wpisane przez zaproszonych.
   Gość, który jako imię podałby `<img src=x onerror=…>`, przy `innerHTML`
   wykonałby kod w sesji WŁAŚCICIELA – z jego uprawnieniami.

   Wzorzec dwustronny: ten sam plik działa w przeglądarce i w `require()`
   z testu (patrz CLAUDE.md, „Front-end – bez budowania").
   ============================================================ */

/** zmienJezyk – przełącza PL↔EN i odświeża teksty (formularz zaproszenia). */
function utworzKonta({ $, t, zmienJezyk }) {
  let ja = null;
  let kontaSerwera = null;

  async function zadaj(sciezka, { metoda = 'GET', dane, naglowki = {} } = {}) {
    const r = await fetch(sciezka, {
      method: metoda,
      headers: { 'Content-Type': 'application/json', ...naglowki },
      body: dane === undefined ? undefined : JSON.stringify(dane),
    });
    let json = {};
    try { json = await r.json(); } catch { /* pusta odpowiedź */ }
    return { ok: r.ok, kod: r.status, json };
  }

  /* Rola decyduje o tym, co widać. Ukrywanie w interfejsie to wygoda, nie
     zabezpieczenie – serwer i tak odmawia (TYLKO_WLASCICIEL w server.js).
     Ale przycisk, który zawsze kończy się „tylko dla właściciela", to zły
     interfejs. */
  function zastosujRole(u) {
    ja = u || null;
    const czlonek = Boolean(ja && ja.rola !== 'wlasciciel');
    if (typeof document !== 'undefined') document.body.classList.toggle('rola-czlonek', czlonek);
  }

  /* Kopie rozmów do pracy bez sieci należą do KONKRETNEJ osoby. Na wspólnym
     telefonie – Marcin się wylogowuje, loguje się ktoś z rodziny – stara kopia
     pokazałaby się nowej osobie przy pierwszym zaniku sieci. Dlatego
     przeglądarka pamięta, czyja jest kopia, i czyści ją przy zmianie osoby
     i przy wylogowaniu. Ustawienia urządzenia (język, mikrofon) zostają. */
  // `cosmos.zakladki` też: zakładki silników zależą od osoby (przyznania właściciela).
  /* Wspólny telefon: instrukcja systemowa Ani (dane o zdrowiu) zostawała po
     wylogowaniu i szła w każdym żądaniu Bartka (zespół IT, runda 5). Stąd też
     kadry, klatka wideo, bieg w toku, niezapisane rozmowy – a z ustawień
     pola OSOBY (instrukcja, modele); ustawienia urządzenia zostają. */
  const PAMIEC_OSOBY = [/^cosmos\.conv\./, /^cosmos\.convIndex$/, /^cosmos\.kbSelected$/, /^cosmos\.promptTemplates$/,
    /^cosmos\.zakladki$/, /^cosmos\.ujecia\./, /^cosmos\.videoFrame$/, /^cosmos\.bieg$/, /^cosmos\.conversations$/,
    /^cosmos\.niezapisane$/, /^cosmos\.modeleSerwera$/,
    // Źródło kamery to cecha osoby i JEJ komputera – „Kinect” właściciela nie może zostać dla gościa (runda 8).
    /^cosmos\.liveSource$/,
    /* Kamera w trybie głosowym: włączona przez Anię włączała się Bartkowi przy
       pierwszym trybie głosowym, choć on jej nie włączał (zespół IT, runda 9).
       `cosmos.sttEngine` zostaje – to cecha urządzenia (jak mikrofon), nie osoby. */
    /^cosmos\.voiceCam$/];

  /* Nagrania ptaków odłożone bez zasięgu (IndexedDB `cosmos-ptaki`, app.js)
     też są osoby: po wylogowaniu Ani szły na konto Bartka (zespół IT, runda 9).
     Kasujemy całą bazę; aplikacja zamyka połączenia po każdej transakcji,
     a gdyby jakieś wisiało – nie czekamy dłużej niż sekundę. */
  function usunNagraniaPtakow() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(false);
    return new Promise((ok) => {
      const koniec = setTimeout(() => ok(false), 1000);
      try {
        const r = indexedDB.deleteDatabase('cosmos-ptaki');
        r.onsuccess = () => { clearTimeout(koniec); ok(true); };
        r.onerror = () => { clearTimeout(koniec); ok(false); };
      } catch { clearTimeout(koniec); ok(false); }
    });
  }
  /* `speak`: na wspólnym telefonie odpowiedzi NASTĘPNEJ osoby czytałyby się na głos
     (np. w pociągu), choć ona tego nie włączała (zespół IT, runda 8). */
  /* `zespolPotwierdzaj`: wyłączone „Pytaj przed startem” czeka w przeglądarce na
     przenosiny na serwer (app.js, migrujPotwierdzaj) – nie może trafić na konto następnej osoby. */
  const USTAWIENIA_OSOBY = /^(systemPrompt|model[A-Z]\w*|speak|zespolPotwierdzaj)$/;
  function wyczyscPamiecOsoby(magazyn = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!magazyn) return 0;
    const klucze = [];
    for (let i = 0; i < magazyn.length; i++) klucze.push(magazyn.key(i));
    const doUsuniecia = klucze.filter((k) => k && PAMIEC_OSOBY.some((w) => w.test(k)));
    for (const k of doUsuniecia) magazyn.removeItem(k);
    // Prawdziwa pamięć przeglądarki (nie atrapa z testu) – razem z nią nagrania ptaków.
    if (typeof localStorage !== 'undefined' && magazyn === localStorage) usunNagraniaPtakow();
    try {
      const ust = JSON.parse(magazyn.getItem('cosmos.settings') || 'null');
      if (ust && typeof ust === 'object') {
        for (const k of Object.keys(ust)) if (USTAWIENIA_OSOBY.test(k)) delete ust[k];
        magazyn.setItem('cosmos.settings', JSON.stringify(ust));
      }
    } catch { /* uszkodzone ustawienia – zostają domyślne */ }
    return doUsuniecia.length;
  }

  /* Stały kod błędu od serwera → zdanie w języku osoby. Gość z angielskim
     interfejsem dostawał polskie „Hasło musi mieć co najmniej 8 znaków"
     (zespół IT, runda 5). Nieznany kod – tekst serwera. */
  const BLEDY_KONT = {
    'zle-haslo': 'login.failed', 'za-duzo-prob': 'login.tooMany', 'zaproszenie-wygaslo': 'inv.expired',
    'login-zajety': 'inv.loginTaken', 'login-krotki': 'inv.loginShort', 'haslo-krotkie': 'inv.passShort',
    'haslo-dlugie': 'inv.passLong', 'stare-haslo': 'acc.oldPassWrong',
  };
  function bladKonta(json, zapas) {
    const klucz = json && BLEDY_KONT[json.kod];
    if (klucz) return t(klucz, { n: json.minut || 15, min: 8 });
    return (json && json.error) || zapas;
  }
  function pilnujWlascicielaPamieci(u, magazyn = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!magazyn || !u) return false;
    let poprzedni = null;
    try { poprzedni = magazyn.getItem('cosmos.kto'); } catch { return false; }
    const zmiana = Boolean(poprzedni && poprzedni !== u.id);
    if (zmiana) wyczyscPamiecOsoby(magazyn);
    try { magazyn.setItem('cosmos.kto', u.id); } catch { /* prywatne okno */ }
    return zmiana;
  }

  /* Pierwsza LITERA albo cyfra, nie pierwszy znak: imię „<b>Tomek" dawało
     w kółku „<". Litery spoza łaciny też się liczą (\p{L}). */
  const inicjal = (u) => {
    const m = String((u && (u.nazwa || u.login)) || '').match(/[\p{L}\p{N}]/u);
    return m ? m[0].toUpperCase() : '?';
  };

  // ------------------------------------------------------------------
  // Zaproszenie: /#zaproszenie=TOKEN
  // ------------------------------------------------------------------

  function tokenZaproszenia(hash = (typeof location !== 'undefined' ? location.hash : '')) {
    const m = String(hash || '').match(/^#zaproszenie=([A-Za-z0-9_-]{16,})$/);
    return m ? m[1] : '';
  }

  /* Ciastko sesji z flagą Secure (COSMOS_COOKIE_SECURE=1) przeglądarka odrzuca
     po zwykłym http – poprawne hasło kończyło się cichym powrotem do pustego
     formularza (zespół IT, runda 5). Pytamy serwer, czy nas już zna. */
  async function ciastkoPrzyjete() {
    try {
      const r = await fetch('/api/auth');
      const d = await r.json();
      return d.authed !== false;
    } catch { return true; }   // nie wiemy – przeładowanie pokaże
  }

  async function pokazZaproszenie(token) {
    const nakladka = $('invite-overlay');
    const blad = $('invite-error');
    nakladka.style.display = '';
    let opis = () => {};
    /* Język odgadnięty z przeglądarki może być zły (telefon służbowy po
       angielsku) – jeden klik na przełączenie, bez szukania ustawień. */
    const przelacz = $('invite-lang');
    if (przelacz && zmienJezyk) przelacz.addEventListener('click', () => { zmienJezyk(); opis(); });
    // Token w nagłówku, nie w adresie – adresy lądują w logach po drodze.
    const r = await zadaj('/api/zaproszenie', { naglowki: { 'X-Cosmos-Zaproszenie': token } });
    if (!r.ok) {
      $('invite-sub').textContent = bladKonta(r.json, t('inv.expired'));
      for (const id of ['invite-name', 'invite-login', 'invite-pass', 'invite-pass2', 'invite-submit']) $(id).hidden = true;
      return;
    }
    // Zdanie z imieniem składa skrypt, więc po zmianie języka trzeba je złożyć od nowa.
    /* Link do nowego hasła (wystawiony przez właściciela) – ten sam formularz,
       ale bez imienia i loginu: konto już jest. */
    const reset = Boolean(r.json.reset);
    opis = () => {
      $('invite-sub').textContent = reset
        ? t('inv.resetSub', { login: r.json.login || '' })
        : r.json.zapraszajacy
          ? t('inv.subFrom', { kto: r.json.zapraszajacy })
          : t('inv.sub');
    };
    opis();
    $('invite-name').value = r.json.nazwa || '';
    $('invite-login').value = reset ? (r.json.login || '') : (r.json.proponowanyLogin || '');
    if (reset) for (const id of ['invite-name', 'invite-login']) $(id).hidden = true;
    $('invite-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      blad.textContent = '';
      if ($('invite-pass').value !== $('invite-pass2').value) {
        blad.textContent = t('inv.mismatch');
        return;
      }
      $('invite-submit').disabled = true;
      const w = await zadaj('/api/zaproszenie', { metoda: 'POST', dane: {
        token, nazwa: $('invite-name').value, login: $('invite-login').value, haslo: $('invite-pass').value,
      } });
      if (!w.ok) {
        blad.textContent = bladKonta(w.json, t('login.failed'));
        $('invite-submit').disabled = false;
        return;
      }
      /* Czyścimy fragment ZANIM przeładujemy: token w historii przeglądarki
         jest już zużyty, ale nie ma powodu, żeby wisiał w pasku adresu. */
      history.replaceState(null, '', location.pathname);
      if (!(await ciastkoPrzyjete())) { blad.textContent = t('login.notHttps'); $('invite-submit').disabled = false; return; }
      location.reload();
    });
  }

  // ------------------------------------------------------------------
  // Twoje konto
  // ------------------------------------------------------------------

  function komunikat(tekst, blad = false) {
    const k = $('konto-komunikat');
    if (!k) return;
    k.textContent = tekst || '';
    k.classList.toggle('blad', Boolean(blad));
  }

  /** Rozmiar w MB albo GB, w języku interfejsu. */
  function rozmiar(bajty) {
    const jezyk = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang === 'en') ? 'en-GB' : 'pl-PL';
    const mb = (bajty || 0) / 1048576;
    return mb >= 1024
      ? `${(mb / 1024).toLocaleString(jezyk, { maximumFractionDigits: 1 })} GB`
      : `${mb.toLocaleString(jezyk, { maximumFractionDigits: 1 })} MB`;
  }

  async function odswiezKonto() {
    const r = await zadaj('/api/konto');
    if (!r.ok) return;
    const u = r.json.uzytkownik;
    zastosujRole(u);
    $('konto-blok').hidden = false;
    $('konto-avatar').textContent = inicjal(u);
    $('konto-nazwa-widok').textContent = u.nazwa || u.login;
    $('konto-login').textContent = u.login;
    $('konto-rola').textContent = u.rola === 'wlasciciel' ? t('acc.roleOwner') : t('acc.roleMember');
    // Zajęte miejsce – przy limicie z limitem, żeby pełny dysk nie był niespodzianką.
    const m = r.json.miejsce;
    $('konto-miejsce').textContent = m ? ` · ${m.limit
      ? t('acc.diskOf', { zajete: rozmiar(m.zajete), limit: rozmiar(m.limit) })
      : t('acc.disk', { zajete: rozmiar(m.zajete) })}` : '';
    $('konto-nazwa').value = u.nazwa || '';
    /* Tryb domowy: nie ma logowania, więc nie ma czego wylogować ani zmieniać.
       Zmiana hasła zostaje – to właśnie nią właściciel włącza logowanie. */
    $('konto-wyloguj').hidden = !r.json.logowanie;
    $('konto-wyloguj-wszedzie').hidden = !r.json.logowanie;
    $('konto-haslo-stare').hidden = !u.maHaslo;
    // Pole modelu tylko dla silnika, którego ta osoba może użyć (klucz serwera,
    // przyznany albo własny) – inne pole prowadziłoby do „Pobierz listę” bez szans.
    const ma = (nazwa) => (r.json.silniki || []).some((s) => s.nazwa === nazwa);
    document.body.classList.toggle('bez-lokalnego', !ma('local'));
    document.body.classList.toggle('bez-openai', !ma('openai'));
    document.body.classList.toggle('bez-claude', !ma('claude'));
    const k = r.json.klucze || {};
    $('konto-klucz-openai').placeholder = k.openai ? t('acc.keySet', { koncowka: k.openai }) : t('acc.keyOpenai');
    $('konto-klucz-claude').placeholder = k.claude ? t('acc.keySet', { koncowka: k.claude }) : t('acc.keyClaude');
  }

  async function zapiszKlucz(nazwa) {
    const pole = $(`konto-klucz-${nazwa}`);
    const r = await zadaj('/api/konto/klucze', { metoda: 'PUT', dane: { nazwa, klucz: pole.value } });
    if (!r.ok) return komunikat(r.json.error, true);
    pole.value = '';
    komunikat(r.json.klucze[nazwa] ? t('acc.keySaved') : t('acc.keyRemoved'));
    await odswiezKonto();
    // Zakładki silników zależą od kluczy – przeładuj konfigurację.
    if (typeof window !== 'undefined' && typeof window.loadServerConfig === 'function') window.loadServerConfig();
  }

  // ------------------------------------------------------------------
  // Dostęp (właściciel)
  // ------------------------------------------------------------------

  function kiedy(ms) {
    if (!ms) return t('acc.never');
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 2) return t('acc.now');
    if (min < 60) return t('acc.minAgo', { n: min });
    const godz = Math.round(min / 60);
    if (godz < 36) return t('acc.hAgo', { n: godz });
    return data(ms);
  }

  /* Data w języku INTERFEJSU, nie systemu. `toLocaleDateString()` bez
     argumentu bierze ustawienia systemu, więc na komputerze po angielsku
     polski interfejs pokazywał „10/1/2026". */
  const data = (ms) => new Date(ms).toLocaleDateString(
    (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang === 'en') ? 'en-GB' : 'pl-PL');

  function element(tag, klasa, tekst) {
    const e = document.createElement(tag);
    if (klasa) e.className = klasa;
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  }

  const SILNIKI = [
    ['local', 'acc.engLocal'], ['openai', 'acc.engOpenai'], ['claude', 'acc.engClaude'], ['studio', 'acc.engStudio'],
    ['szukanie', 'acc.engSzukanie'], ['ptaki', 'acc.engPtaki'], ['zespol', 'acc.engZespol'],
  ];

  function wierszOsoby(u) {
    const w = element('div', 'osoba');
    const glowa = element('div', 'osoba-glowa');
    glowa.append(element('span', 'konto-avatar maly', inicjal(u)));
    const opis = element('div', 'osoba-opis');
    opis.append(element('div', 'osoba-nazwa', u.nazwa || u.login));
    const z = u.zuzycie || {};
    opis.append(element('div', 'osoba-meta mono',
      `${u.login} · ${u.rola === 'wlasciciel' ? t('acc.roleOwner') : t('acc.roleMember')} · `
      + `${t('acc.lastSeen')}: ${kiedy(u.ostatnio)} · ${t('acc.messages', { n: z.wiadomosci || 0, dzis: z.dzisiaj || 0 })}`
      + (u.miejsce ? ` · ${t('acc.disk', { zajete: rozmiar(u.miejsce.zajete) })}` : '')));
    // Zużycie silników z ostatnich 30 dni (tylko Twoje klucze i GPU – własnych kluczy
    // osoby serwer tu nie pokazuje). Bez treści i bez nazw ról agentów.
    const sil = (z.silniki && z.silniki.dni30) || {};
    const linie = Object.entries(sil).filter(([, v]) => v && v.wywolan)
      .map(([nazwa, v]) => t('acc.zuzycieSilnika', { silnik: nazwa, n: v.wywolan, tok: Math.round(((v.we || 0) + (v.wy || 0)) / 1000) }));
    if (linie.length) opis.append(element('div', 'osoba-meta mono', linie.join(' · ')));
    // Złotówki na Twoich kluczach (OpenAI, Claude) – z cennika, dziś i w tym miesiącu.
    const wydane = wydaneZl(z.zl);
    if (wydane) opis.append(element('div', 'osoba-meta mono osoba-zl', t('acc.zuzycieZl', { dzis: zl(wydane.dzis), miesiac: zl(wydane.miesiac) })));
    glowa.append(opis);
    w.append(glowa);
    if (u.rola === 'wlasciciel') return w;

    const przelaczniki = element('div', 'osoba-silniki');
    const serwer = (kontaSerwera && kontaSerwera.silnikiSerwera) || {};
    for (const [nazwa, klucz] of SILNIKI) {
      const et = element('label', 'osoba-silnik');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(u.silniki && u.silniki[nazwa]);
      // Silnik, którego serwer nie ma, nie da się przyznać – nie udawajmy, że się da.
      box.disabled = !serwer[nazwa];
      if (!serwer[nazwa]) et.title = t('acc.engMissing');
      box.addEventListener('change', async () => {
        const r = await zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: u.id, silniki: { [nazwa]: box.checked } } });
        if (!r.ok) { box.checked = !box.checked; komunikat(r.json.error, true); }
      });
      et.append(box, element('span', '', t(klucz)));
      przelaczniki.append(et);
    }
    w.append(przelaczniki);
    w.append(budzetOsoby(u));

    const akcje = element('div', 'field-row osoba-akcje');
    const wyloguj = element('button', 'btn-ghost', t('acc.logoutUser'));
    wyloguj.type = 'button';
    wyloguj.addEventListener('click', async () => {
      const r = await zadaj('/api/konta/wyloguj', { metoda: 'POST', dane: { id: u.id } });
      komunikat(r.ok ? t('acc.loggedOutN', { n: r.json.wylogowano }) : r.json.error, !r.ok);
      odswiezDostep();
    });
    const usun = element('button', 'btn-ghost niebezpieczny', t('acc.remove'));
    usun.type = 'button';
    usun.addEventListener('click', async () => {
      if (!confirm(t('acc.removeConfirm', { kto: u.nazwa || u.login }))) return;
      const r = await zadaj(`/api/konta/uzytkownik?id=${encodeURIComponent(u.id)}`, { metoda: 'DELETE' });
      komunikat(r.ok ? t('acc.removed') : r.json.error, !r.ok);
      odswiezDostep();
    });
    /* Zapomniane hasło członka: jednorazowy link na 24 h (zespół IT, runda 5).
       Dawniej jedyną drogą było usunięcie konta, czyli wyniesienie rozmów. */
    const haslo = element('button', 'btn-ghost', t('acc.newPassLink'));
    haslo.type = 'button';
    haslo.addEventListener('click', async () => {
      const r = await zadaj('/api/konta/nowe-haslo', { metoda: 'POST', dane: { id: u.id } });
      if (!r.ok) return komunikat(r.json.error, true);
      $('dostep-link-pole').value = `${location.origin}${r.json.sciezka}`;
      $('dostep-link').hidden = false;
      $('dostep-udostepnij').hidden = !(typeof navigator !== 'undefined' && navigator.share);
      komunikat(t('acc.newPassReady', { kto: u.nazwa || u.login }));
    });
    akcje.append(haslo, wyloguj, usun);
    w.append(akcje);
    return w;
  }

  /* ---- Budżet członka w złotówkach (etap 5) ----
     Limit wydatków osoby na KLUCZACH WŁAŚCICIELA (przyznany OpenAI/Claude,
     zespół). Własnych kluczy osoby nie dotyczy – za nie płaci ona sama. */
  const jezykEn = () => typeof document !== 'undefined' && document.documentElement && document.documentElement.lang === 'en';
  function zl(x) {
    const n = Number(x) || 0;
    if (typeof window !== 'undefined' && window.ZESPOL && window.ZESPOL.kwotaZl) return window.ZESPOL.kwotaZl(n, jezykEn() ? 'en' : 'pl');
    return `${n.toFixed(2)} zł`;
  }
  /** {dzis, miesiac} z `zuzycie.zl` (albo z jego części „wlasciciel”) – null, gdy serwer nic nie liczy. */
  function wydaneZl(z) {
    if (!z || typeof z !== 'object') return null;
    const w = z.zrodla && z.zrodla.wlasciciel && typeof z.zrodla.wlasciciel === 'object' ? z.zrodla.wlasciciel : z;
    const dzis = Number(w.dzis);
    const miesiac = Number(w.miesiac);
    if (!Number.isFinite(dzis) && !Number.isFinite(miesiac)) return null;
    return { dzis: Number.isFinite(dzis) ? dzis : 0, miesiac: Number.isFinite(miesiac) ? miesiac : 0 };
  }
  /** Liczba zł z pola (przecinek albo kropka); null – niepoprawna. */
  function zlZPola(v) {
    const s = String(v || '').trim().replace(/\s|zł|pln/gi, '').replace(',', '.');
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
  }
  function budzetOsoby(u) {
    const b = u.budzetZl && typeof u.budzetZl === 'object' ? u.budzetZl : { dzien: 0, miesiac: 0 };
    const blok = element('div', 'osoba-budzet');
    blok.append(element('span', 'osoba-budzet-tytul', t('acc.budzet')));
    const pola = element('div', 'osoba-budzet-pola');
    const pole = (klucz, podpis) => {
      const et = element('label', 'osoba-budzet-pole');
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.dataset.pole = `budzet-${klucz}`;
      input.placeholder = '0';
      input.value = b[klucz] > 0 ? String(b[klucz]).replace('.', jezykEn() ? '.' : ',') : '';
      input.setAttribute('aria-label', `${t('acc.budzet')}: ${podpis} – ${u.nazwa || u.login}`);
      input.addEventListener('change', async () => {
        const n = zlZPola(input.value);
        if (n === null) { input.setAttribute('aria-invalid', 'true'); return; }
        input.removeAttribute('aria-invalid');
        const nowy = { dzien: b.dzien || 0, miesiac: b.miesiac || 0, [klucz]: n };
        const r = await zadaj('/api/konta/budzet', { metoda: 'PUT', dane: { id: u.id, ...nowy } });
        if (!r.ok) { komunikat(r.json.error || r.json.blad || t('httpErr', { status: r.kod }), true); return; }
        Object.assign(b, nowy);
        u.budzetZl = b;
        komunikat(t('acc.budzetZapisany'));
      });
      et.append(input, element('span', '', podpis));
      return et;
    };
    pola.append(pole('dzien', t('acc.budzetDzien')), pole('miesiac', t('acc.budzetMiesiac')));
    blok.append(pola, element('span', 'field-hint', t('acc.budzetHint')));
    return blok;
  }

  function wierszZaproszenia(z) {
    const w = element('div', 'osoba zaproszenie');
    const opis = element('div', 'osoba-opis');
    opis.append(element('div', 'osoba-nazwa', `✉ ${z.nazwa || t('acc.noName')}`));
    opis.append(element('div', 'osoba-meta mono', t('acc.expires', { data: data(z.wygasa) })));
    const cofnij = element('button', 'btn-ghost', t('acc.revoke'));
    cofnij.type = 'button';
    cofnij.addEventListener('click', async () => {
      await zadaj(`/api/konta/zaproszenia?id=${encodeURIComponent(z.id)}`, { metoda: 'DELETE' });
      odswiezDostep();
    });
    w.append(opis, cofnij);
    return w;
  }

  async function odswiezDostep() {
    const blok = $('dostep-blok');
    if (!ja || ja.rola !== 'wlasciciel') { blok.hidden = true; return; }
    const r = await zadaj('/api/konta');
    if (!r.ok) { blok.hidden = true; return; }
    kontaSerwera = r.json;
    blok.hidden = false;
    $('dostep-bez-hasla').hidden = r.json.logowanie;
    $('dostep-zapros').disabled = !r.json.logowanie;
    /* Wolne miejsce na dysku VPS-a. Pełny dysk to „nic się nie zapisze"
       dla wszystkich naraz – lepiej zobaczyć to tu niż po fakcie. */
    const d = r.json.dysk;
    const dysk = $('dostep-dysk');
    if (d && d.calosc) {
      const malo = d.wolne / d.calosc < 0.05;
      dysk.textContent = t(malo ? 'acc.serverDiskLow' : 'acc.serverDisk', { wolne: rozmiar(d.wolne), calosc: rozmiar(d.calosc) });
      dysk.classList.toggle('blad', malo);
      dysk.hidden = false;
    } else dysk.hidden = true;
    const lista = $('dostep-lista');
    lista.replaceChildren(...r.json.uzytkownicy.map(wierszOsoby));
    const zap = $('dostep-zaproszenia');
    zap.replaceChildren(...r.json.zaproszenia.map(wierszZaproszenia));
  }

  async function zapros() {
    const r = await zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: $('dostep-nazwa').value } });
    if (!r.ok) return komunikat(r.json.error, true);
    const link = `${location.origin}${r.json.sciezka}`;
    $('dostep-link-pole').value = link;
    $('dostep-link').hidden = false;
    // „Wyślij…" otwiera arkusz udostępniania telefonu (WhatsApp, SMS). Na
    // komputerze go zwykle nie ma – wtedy przycisk znika, zostaje „Kopiuj".
    $('dostep-udostepnij').hidden = !(typeof navigator !== 'undefined' && navigator.share);
    $('dostep-nazwa').value = '';
    odswiezDostep();
  }

  // ------------------------------------------------------------------

  let podpiete = false;
  function podepnij() {
    if (podpiete) return;
    podpiete = true;
    $('konto-wyloguj').addEventListener('click', async () => {
      await zadaj('/api/logout', { metoda: 'POST' });
      try { wyczyscPamiecOsoby(); localStorage.removeItem('cosmos.kto'); } catch { /* */ }
      // Przeładowanie przerwałoby usuwanie bazy w pół – czekamy na nie.
      await usunNagraniaPtakow();
      location.reload();
    });
    $('konto-wyloguj-wszedzie').addEventListener('click', async () => {
      const r = await zadaj('/api/konto/wyloguj-wszedzie', { metoda: 'POST' });
      komunikat(r.ok ? t('acc.loggedOutN', { n: r.json.wylogowano }) : r.json.error, !r.ok);
    });
    $('konto-nazwa-zapisz').addEventListener('click', async () => {
      const r = await zadaj('/api/konto', { metoda: 'PUT', dane: { nazwa: $('konto-nazwa').value } });
      komunikat(r.ok ? t('acc.saved') : r.json.error, !r.ok);
      odswiezKonto();
    });
    $('konto-haslo-zapisz').addEventListener('click', async () => {
      const r = await zadaj('/api/konto/haslo', { metoda: 'POST',
        dane: { stare: $('konto-haslo-stare').value, nowe: $('konto-haslo-nowe').value } });
      if (!r.ok) return komunikat(bladKonta(r.json, r.json.error), true);
      $('konto-haslo-stare').value = '';
      $('konto-haslo-nowe').value = '';
      komunikat(t('acc.passChanged', { n: r.json.wylogowano || 0 }));
      odswiezKonto();
      odswiezDostep();
    });
    $('konto-klucz-openai-zapisz').addEventListener('click', () => zapiszKlucz('openai'));
    $('konto-klucz-claude-zapisz').addEventListener('click', () => zapiszKlucz('claude'));
    $('dostep-zapros').addEventListener('click', zapros);
    $('dostep-nazwa').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); zapros(); } });
    $('dostep-kopiuj').addEventListener('click', async () => {
      const pole = $('dostep-link-pole');
      try { await navigator.clipboard.writeText(pole.value); komunikat(t('acc.copied')); }
      catch { pole.select(); document.execCommand('copy'); komunikat(t('acc.copied')); }
    });
    /* Messenger (Meta): na telefonie aplikacja przyjmuje link wprost
       (fb-messenger://share). Na komputerze Meta nie pozwala wstawić treści
       z zewnątrz bez własnej aplikacji Facebooka – kopiujemy link i otwieramy
       messenger.com, a komunikat mówi, żeby go wkleić. */
    $('dostep-messenger').addEventListener('click', async () => {
      const link = $('dostep-link-pole').value;
      if (!link) return;
      const info = $('dostep-messenger-info');
      const powiedz = (klucz) => { if (info) { info.hidden = false; info.textContent = t(klucz); } else komunikat(t(klucz)); };
      const kopiuj = async () => {
        try { await navigator.clipboard.writeText(link); } catch { $('dostep-link-pole').select(); document.execCommand('copy'); }
      };
      if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        /* Najpierw schowek i zdanie przy przycisku: bez aplikacji Messenger
           link fb-messenger:// nie robi nic i dawniej nic nie mówił. */
        await kopiuj();
        powiedz('acc.messengerMobile');
        location.href = `fb-messenger://share/?link=${encodeURIComponent(link)}`;
        return;
      }
      // Okno otwieramy od razu w geście kliknięcia – po `await` Safari blokuje je jako wyskakujące.
      window.open('https://www.messenger.com/', '_blank', 'noopener');
      await kopiuj();
      powiedz('acc.messengerPaste');
    });
    $('dostep-udostepnij').addEventListener('click', async () => {
      try {
        await navigator.share({ title: 'Cosmos', text: t('acc.shareText'), url: $('dostep-link-pole').value });
      } catch { /* anulowane – nic się nie stało */ }
    });
  }

  async function odswiez() {
    podepnij();
    await odswiezKonto();
    await odswiezDostep();
  }

  return { tokenZaproszenia, pokazZaproszenie, zastosujRole, odswiez, odswiezKonto, odswiezDostep,
    wyczyscPamiecOsoby, pilnujWlascicielaPamieci, usunNagraniaPtakow, bladKonta, ciastkoPrzyjete, ja: () => ja };
}

if (typeof window !== 'undefined') window.utworzKonta = utworzKonta;
if (typeof module !== 'undefined') module.exports = { utworzKonta };

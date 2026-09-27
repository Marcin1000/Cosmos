/* ============================================================
   Samouczek pierwszego uruchomienia

   Pierwsze wejście do Cosmosa prowadzi krok po kroku: imię, silniki
   i własne klucze API, zmysły na własnym komputerze, Cosmos na ekranie
   telefonu. Każdy krok można pominąć, cały samouczek też – i wrócić do
   niego w Ustawieniach → Konto.

   Serwer pamięta, że osoba go przeszła (POST /api/konto/samouczek), więc
   drugi telefon czy komputer już o niego nie pyta.

   Pod automatem (Playwright: navigator.webdriver) samouczek NIE wyskakuje
   sam – inaczej nakładka przykryłaby aplikację w każdym zestawie
   przeglądarkowym i na zrzutach do README. Zestaw `samouczek` woła
   `pokaz()` jawnie.
   ============================================================ */

function utworzSamouczek({ $, t, zmysly }) {
  let instalacjaPwa = null;
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); instalacjaPwa = e; });
  }

  const el = (tag, klasa, tekst) => {
    const e = document.createElement(tag);
    if (klasa) e.className = klasa;
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  };
  const przycisk = (klasa, tekst) => { const b = el('button', klasa, tekst); b.type = 'button'; return b; };

  async function zadaj(sciezka, { metoda = 'GET', dane } = {}) {
    const r = await fetch(sciezka, {
      method: metoda, headers: { 'Content-Type': 'application/json' },
      body: dane === undefined ? undefined : JSON.stringify(dane),
    });
    let json = {};
    try { json = await r.json(); } catch { /* pusta odpowiedź */ }
    return { ok: r.ok, kod: r.status, json };
  }

  const NAZWY_SILNIKOW = { cloud: 'NVIDIA', local: 'GPU', openai: 'OpenAI', claude: 'Claude' };
  const naTelefonie = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse) and (max-width: 720px)').matches;
  /** Imię, którym można się zwrócić – nie login techniczny w rodzaju „wlasciciel”. */
  function prawdziweImie(konto) {
    const u = (konto && konto.uzytkownik) || {};
    const n = String(u.nazwa || '').trim();
    const bezOgonkow = n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
    return n && n !== u.login && bezOgonkow !== 'wlasciciel' ? n : '';
  }

  /* ---- kroki: każdy buduje swoją treść i mówi, co robi „Dalej” ---- */
  const KROKI = [
    {
      id: 'witaj',
      rysuj(ctx) {
        const imie = prawdziweImie(ctx.konto);
        return [
          el('h2', 'sm-tytul', imie ? t('sm.hiName').replace('{imie}', imie) : t('sm.hi')),
          el('p', 'sm-lead', t('sm.intro')),
          el('p', 'field-hint', t('sm.introSkip')),
        ];
      },
    },
    {
      id: 'imie',
      // Imię podane minutę wcześniej w formularzu zaproszenia – nie pytamy drugi raz.
      pomin: (ctx) => Boolean(prawdziweImie(ctx.konto)),
      rysuj(ctx) {
        const pole = el('input', 'sm-pole');
        pole.type = 'text';
        pole.id = 'sm-imie';
        pole.autocomplete = 'name';
        pole.value = (ctx.konto.uzytkownik && ctx.konto.uzytkownik.nazwa) || '';
        pole.placeholder = t('sm.namePh');
        ctx.dalej = async () => {
          const nazwa = pole.value.trim();
          if (nazwa && nazwa !== (ctx.konto.uzytkownik || {}).nazwa) await zadaj('/api/konto', { metoda: 'PUT', dane: { nazwa } });
        };
        return [el('h2', 'sm-tytul', t('sm.nameTitle')), el('p', 'sm-lead', t('sm.nameLead')), pole];
      },
    },
    {
      id: 'klucze',
      rysuj(ctx) {
        const silniki = (ctx.konto.silniki || []).map((s) => NAZWY_SILNIKOW[s.nazwa] || s.nazwa);
        const tresc = [el('h2', 'sm-tytul', t('sm.keysTitle'))];
        tresc.push(el('p', 'sm-lead', silniki.length
          ? t('sm.keysHave').replace('{lista}', silniki.join(', '))
          : t('sm.keysNone')));
        tresc.push(el('p', 'field-hint', t('sm.keysWhy')));
        const pola = {};
        for (const [nazwa, ph] of [['openai', 'acc.keyOpenai'], ['claude', 'acc.keyClaude']]) {
          const p = el('input', 'sm-pole mono');
          p.type = 'password';
          p.autocomplete = 'off';
          p.id = `sm-klucz-${nazwa}`;
          p.placeholder = (ctx.konto.klucze || {})[nazwa] ? `${t(ph)} · ${ctx.konto.klucze[nazwa]}` : t(ph);
          pola[nazwa] = p;
          tresc.push(p);
        }
        let zapisanoKlucz = false;
        const blad = el('p', 'field-hint konto-komunikat', '');
        blad.setAttribute('role', 'status');
        tresc.push(blad);
        ctx.dalej = async () => {
          for (const [nazwa, p] of Object.entries(pola)) {
            if (!p.value.trim()) continue;
            const r = await zadaj('/api/konto/klucze', { metoda: 'PUT', dane: { nazwa, klucz: p.value.trim() } });
            if (!r.ok) { blad.textContent = r.json.error || t('sm.keyFail'); return false; }
            p.value = '';
            zapisanoKlucz = true;
          }
          // Zakładka nowego silnika od razu, bez przeładowania strony.
          if (zapisanoKlucz && typeof loadServerConfig === 'function') loadServerConfig();
          return true;
        };
        return tresc;
      },
    },
    {
      id: 'zmysly',
      rysuj(ctx) {
        const miejsce = el('div', 'sm-kreator');
        const tresc = [el('h2', 'sm-tytul', t('sm.sensesTitle')), el('p', 'sm-lead', t('sm.sensesLead'))];
        const lista = el('ul', 'sm-punkty');
        for (const k of ['sm.sensesP1', 'sm.sensesP2', 'sm.sensesP3']) lista.append(el('li', '', t(k)));
        tresc.push(lista);
        /* Na telefonie polecenia terminala nikt nie wklei – zamiast kreatora
           jedno zdanie, gdzie to zrobić (agencja, runda 6). */
        if (naTelefonie()) {
          tresc.push(el('p', 'sm-lead', t('sm.phone.senses').replace('{adres}', `${location.origin}/app`)));
          return tresc;
        }
        tresc.push(miejsce, el('p', 'field-hint', t('sm.sensesLater')));
        ctx.drugorzedneDalej = true;   // „Później”, dopóki komputer się nie połączy
        if (zmysly) zmysly.kreator(miejsce, () => { ctx.polaczono = true; ctx.drugorzedneDalej = false; ctx.odswiezStopke(); });
        return tresc;
      },
    },
    {
      id: 'telefon',
      rysuj() {
        const tresc = [el('h2', 'sm-tytul', t('sm.phoneTitle')), el('p', 'sm-lead', t('sm.phoneLead'))];
        const zainstalowana = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
        if (zainstalowana) {
          tresc.push(el('p', 'field-hint zm-ok', t('sm.phoneDone')));
        } else if (instalacjaPwa) {
          const b = przycisk('btn-primary', t('sm.phoneInstall'));
          b.addEventListener('click', async () => { instalacjaPwa.prompt(); instalacjaPwa = null; b.disabled = true; });
          tresc.push(b);
        }
        if (!naTelefonie()) tresc.push(el('p', 'sm-lead mono', t('sm.phoneOpen').replace('{adres}', `${location.origin}/app`)));
        const lista = el('ul', 'sm-punkty');
        lista.append(el('li', '', t('sm.phoneAndroid')), el('li', '', t('sm.phoneIos')));
        tresc.push(lista);
        return tresc;
      },
    },
    {
      id: 'gotowe',
      rysuj(ctx) {
        return [
          el('h2', 'sm-tytul', t('sm.doneTitle')),
          el('p', 'sm-lead', ctx.polaczono ? t('sm.doneSenses') : t('sm.doneLead')),
          el('p', 'field-hint', t('sm.doneAgain')),
        ];
      },
    },
  ];

  let nakladka = null;
  let skadFokus = null;

  async function zakoncz(pominiety) {
    await zadaj('/api/konto/samouczek', { metoda: 'POST', dane: { pominiety } }).catch(() => {});
    if (nakladka) { nakladka.remove(); nakladka = null; }
    const app = document.querySelector('.app');
    if (app) app.inert = false;
    // Fokus wraca tam, skąd samouczek otwarto (albo do pola wiadomości).
    const cel = skadFokus && skadFokus.isConnected ? skadFokus : $('input');
    if (cel) cel.focus();
  }

  async function pokaz() {
    if (nakladka) return;
    skadFokus = document.activeElement;
    const konto = (await zadaj('/api/konto').catch(() => ({ json: {} }))).json || {};
    const ctx = { konto, dalej: null, polaczono: false, drugorzedneDalej: false, odswiezStopke: () => {} };
    const kroki = KROKI.filter((k) => !(k.pomin && k.pomin(ctx)));
    let nr = 0;

    nakladka = el('div', 'modal-overlay sm-nakladka');
    nakladka.id = 'samouczek';
    const okno = el('div', 'modal sm-okno');
    okno.setAttribute('role', 'dialog');
    okno.setAttribute('aria-modal', 'true');
    okno.setAttribute('aria-labelledby', 'sm-tytul-biezacy');
    const kropki = el('div', 'sm-kropki');
    const pasek = el('div', 'sm-pasek');
    pasek.setAttribute('aria-hidden', 'true');
    const licznik = el('span', 'sm-licznik');
    kropki.append(pasek, licznik);
    const cialo = el('div', 'sm-cialo');
    const stopka = el('div', 'sm-stopka');
    const pomin = przycisk('btn-ghost sm-pomin', '');
    const wstecz = przycisk('btn-secondary sm-wstecz', t('sm.back'));
    const dalej = przycisk('btn-primary sm-dalej', '');
    stopka.append(pomin, el('span', 'sm-odstep'), wstecz, dalej);
    okno.append(kropki, cialo, stopka);
    nakladka.append(okno);
    document.body.append(nakladka);
    /* Aplikacja pod spodem niedostępna dla klawiatury i czytnika – dawniej
       Tab uciekał z samouczka do rozmowy (agencja, runda 6). */
    const app = document.querySelector('.app');
    if (app) app.inert = true;

    function odswiezStopke() {
      const ostatni = nr === kroki.length - 1;
      dalej.textContent = nr === 0 ? t('sm.start') : ostatni ? t('sm.finish')
        : ctx.drugorzedneDalej ? t('sm.later') : t('sm.next');
      dalej.className = ctx.drugorzedneDalej && !ostatni ? 'btn-secondary sm-dalej' : 'btn-primary sm-dalej';
    }
    ctx.odswiezStopke = odswiezStopke;

    function rysuj() {
      const krok = kroki[nr];
      ctx.dalej = null;
      ctx.drugorzedneDalej = false;
      cialo.replaceChildren(...krok.rysuj(ctx));
      const tytul = cialo.querySelector('.sm-tytul');
      if (tytul) tytul.id = 'sm-tytul-biezacy';
      cialo.dataset.krok = krok.id;
      pasek.replaceChildren(...kroki.map((_, i) => el('span', i === nr ? 'aktywna' : i < nr ? 'za' : '')));
      licznik.textContent = t('sm.step').replace('{n}', nr + 1).replace('{z}', kroki.length);
      const ostatni = nr === kroki.length - 1;
      wstecz.hidden = nr === 0 || ostatni;
      pomin.textContent = nr === 0 ? t('sm.skipAll') : t('sm.skipStep');
      pomin.hidden = ostatni;
      odswiezStopke();
      const pierwszePole = cialo.querySelector('input');
      (pierwszePole || dalej).focus();
    }

    dalej.addEventListener('click', async () => {
      if (ctx.dalej) {
        dalej.disabled = true;
        const wynik = await ctx.dalej().catch(() => false);
        dalej.disabled = false;
        if (wynik === false) return;
      }
      if (nr === kroki.length - 1) return zakoncz(false);
      nr++;
      rysuj();
    });
    wstecz.addEventListener('click', () => { if (nr > 0) { nr--; rysuj(); } });
    pomin.addEventListener('click', () => {
      if (nr === 0) return zakoncz(true);
      nr++;
      rysuj();
    });
    // Nasłuch na całej nakładce: klik w tło zostawiał fokus na body i Escape nie działał.
    nakladka.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); zakoncz(true); return; }
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); dalej.click(); return; }
      if (e.key !== 'Tab') return;
      const dostepne = [...okno.querySelectorAll('button, input, a[href], summary, [tabindex]:not([tabindex="-1"])')]
        .filter((x) => !x.disabled && !x.hidden && x.offsetParent !== null);
      if (!dostepne.length) return;
      const pierwszy = dostepne[0];
      const ostatni = dostepne[dostepne.length - 1];
      if (e.shiftKey && (document.activeElement === pierwszy || !okno.contains(document.activeElement))) { e.preventDefault(); ostatni.focus(); }
      else if (!e.shiftKey && (document.activeElement === ostatni || !okno.contains(document.activeElement))) { e.preventDefault(); pierwszy.focus(); }
    });
    rysuj();
  }

  /** Po starcie aplikacji: pokaż, jeśli ta osoba jeszcze go nie widziała. */
  async function wystartuj() {
    const b = $('konto-samouczek');
    if (b) b.addEventListener('click', () => { if (typeof closeSettings === 'function') closeSettings(); pokaz(); });
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    const konto = (await zadaj('/api/konto').catch(() => ({ ok: false, json: {} })));
    if (konto.ok && !konto.json.samouczek) pokaz();
  }

  return { pokaz, wystartuj, KROKI, prawdziweImie };
}

if (typeof window !== 'undefined') window.utworzSamouczek = utworzSamouczek;
if (typeof module !== 'undefined') module.exports = { utworzSamouczek };

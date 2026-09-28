/* ============================================================
   Zmysły na moim komputerze – Ustawienia → Zmysły

   Każda osoba może podłączyć SWÓJ komputer (lib/agent-zmyslow.js,
   senses/agent.py). Tutaj:
     – kreator podłączenia: jedno polecenie do wklejenia, a potem aplikacja
       sama zauważa, że komputer się połączył,
     – lista komputerów z przełącznikami: Zmysły, Obserwator kamery, Kinect.
       Przełącznik uruchamia i zatrzymuje program NA komputerze osoby –
       bez wiersza poleceń,
     – instalacja pakietów, aktualizacja, autostart, odłączenie.

   Lista odświeża się co 4 s, ale przerysowuje TYLKO wtedy, gdy stan się
   zmienił, i nigdy pod palcami: dawniej co 4 s znikały zaznaczone pakiety
   i fokus klawiatury, a czytnik ekranu czytał całą kartę od nowa
   (agencja i zespół IT, runda 6).

   Nazwę komputera podaje agent (nazwa hosta), dziennik – program na
   komputerze osoby: wszystko na ekran przez `textContent`.

   Kreator jest osobną funkcją, bo używa go też samouczek pierwszego
   uruchomienia (public/samouczek.js).
   ============================================================ */

function utworzZmyslyWidok({ $, t }) {
  const SKLADNIKI = ['zmysly', 'obserwator', 'kinect'];
  const PAKIETY = ['rdzen', 'dokumenty', 'sluch', 'wzrok', 'cialo', 'pamiec', 'glos'];
  const ZALECANE = ['rdzen', 'dokumenty', 'sluch', 'wzrok'];
  const CAPS = { whisper: 'Whisper', piper: 'Piper', yolo: 'YOLO', pose: 'MediaPipe', mediapipe: 'MediaPipe',
    embed: 'bge-m3', kinect: 'Kinect', birdnet: 'BirdNET', upscale: 'Real-ESRGAN' };

  const el = (tag, klasa, tekst) => {
    const e = document.createElement(tag);
    if (klasa) e.className = klasa;
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  };
  const przycisk = (klasa, tekst) => { const b = el('button', klasa, tekst); b.type = 'button'; return b; };
  const jezyk = () => (typeof getLang === 'function' ? getLang() : 'pl');
  const godzina = (ms) => new Date(ms).toLocaleTimeString(jezyk() === 'en' ? 'en-GB' : 'pl-PL', { hour: '2-digit', minute: '2-digit' });
  const naTelefonie = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse) and (max-width: 720px)').matches;

  async function zadaj(sciezka, { metoda = 'GET', dane } = {}) {
    const r = await fetch(sciezka, {
      method: metoda, headers: { 'Content-Type': 'application/json' },
      body: dane === undefined ? undefined : JSON.stringify(dane),
    });
    let json = {};
    try { json = await r.json(); } catch { /* pusta odpowiedź */ }
    return { ok: r.ok, kod: r.status, json };
  }

  const systemPrzegladarki = () => (/Windows/i.test(navigator.userAgent) ? 'win' : 'sh');

  /** Polecenie do wklejenia – z adresem, pod którym przeglądarka widzi Cosmosa,
   *  i DŁUGIM kodem (6 cyfr dałoby się zgadnąć, długiego nie). */
  function polecenie(system, kod) {
    const adres = location.origin;
    return system === 'win'
      ? `irm "${adres}/api/agent/instaluj.ps1?kod=${kod}" | iex`
      : `curl -fsSL "${adres}/api/agent/instaluj.sh?kod=${kod}" | sh`;
  }

  /* ---------------------------------------------------------- kreator --- */

  /**
   * Kreator podłączenia komputera w podanym kontenerze.
   * @param {HTMLElement} kontener
   * @param {Function} [poPolaczeniu] woła się z komputerem, gdy się połączy
   */
  function kreator(kontener, poPolaczeniu) {
    let czekanie = null;
    kontener.replaceChildren();
    const start = przycisk('btn-primary zm-podlacz', t('zm.connect'));
    const cialo = el('div', 'zm-kroki');
    cialo.hidden = true;
    kontener.append(start, cialo);

    function zwin(drugorzedny) {
      clearInterval(czekanie);
      cialo.hidden = true;
      start.hidden = false;
      start.disabled = false;
      start.className = drugorzedny ? 'btn-secondary zm-podlacz' : 'btn-primary zm-podlacz';
    }

    async function pokaz() {
      start.disabled = true;
      const przed = new Set(((await zadaj('/api/agent/lista')).json.agenci || []).map((a) => a.id));
      const r = await zadaj('/api/agent/kod', { metoda: 'POST' });
      start.disabled = false;
      if (!r.ok || !r.json.kod) {
        cialo.hidden = false;
        cialo.replaceChildren(el('p', 'field-hint konto-komunikat', r.json.error || t('zm.codeFail')));
        return;
      }
      const { kod, dlugi, wygasa } = r.json;
      let system = systemPrzegladarki();
      start.hidden = true;
      cialo.hidden = false;

      const przelacznik = el('div', 'zm-system');
      przelacznik.setAttribute('role', 'group');
      przelacznik.setAttribute('aria-label', t('zm.systemAria'));
      const bWin = przycisk('', 'Windows');
      const bSh = przycisk('', 'macOS / Linux');
      przelacznik.append(bWin, bSh);

      const krok1 = el('li');
      const krok2 = el('li');
      const krok3 = el('li');
      const pole = el('code', 'zm-polecenie mono');
      const kopiuj = przycisk('btn-secondary zm-kopiuj', t('zm.copy'));
      const wiersz = el('div', 'zm-polecenie-wiersz');
      wiersz.append(pole, kopiuj);
      const stan = el('p', 'zm-czekam', '');
      stan.setAttribute('role', 'status');
      const lista = el('ol', 'zm-lista-krokow');
      lista.append(krok1, krok2, krok3);

      const recznie = el('details', 'zm-recznie');
      const recznieTxt = el('p', 'field-hint', '');
      const recznieKod = el('code', 'zm-polecenie mono', '');
      recznie.append(el('summary', '', t('zm.manual')), recznieTxt, recznieKod);

      const wstep = el('p', 'field-hint', t(naTelefonie() ? 'zm.onPhone' : 'zm.onComputer').replace('{adres}', `${location.origin}/app`));
      cialo.replaceChildren(wstep, przelacznik, lista, stan, recznie);

      function rysuj() {
        bWin.classList.toggle('aktywna', system === 'win');
        bSh.classList.toggle('aktywna', system !== 'win');
        bWin.setAttribute('aria-pressed', String(system === 'win'));
        bSh.setAttribute('aria-pressed', String(system !== 'win'));
        krok1.textContent = t(system === 'win' ? 'zm.step1win' : 'zm.step1sh');
        krok2.replaceChildren(el('span', '', t('zm.step2')), wiersz);
        pole.textContent = polecenie(system, dlugi || kod);
        krok3.textContent = t('zm.step3');
        recznieTxt.textContent = t('zm.manualHint').replace('{adres}', location.origin);
        recznieKod.textContent = `${system === 'win' ? 'python' : 'python3'} agent.py --serwer ${location.origin} --kod ${kod} --autostart --w-tle`;
      }
      bWin.addEventListener('click', () => { system = 'win'; rysuj(); });
      bSh.addEventListener('click', () => { system = 'sh'; rysuj(); });
      kopiuj.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(pole.textContent); kopiuj.textContent = t('zm.copied'); }
        catch { const zakres = document.createRange(); zakres.selectNodeContents(pole); getSelection().removeAllRanges(); getSelection().addRange(zakres); }
        setTimeout(() => { kopiuj.textContent = t('zm.copy'); }, 2000);
      });
      rysuj();

      stan.textContent = t('zm.waiting').replace('{kod}', kod).replace('{czas}', godzina(wygasa));
      clearInterval(czekanie);
      czekanie = setInterval(async () => {
        if (!kontener.isConnected) { clearInterval(czekanie); return; }
        if (Date.now() > wygasa) {
          // Wygasły kod: polecenie chowamy – skopiowane i tak by nie zadziałało.
          zwin(false);
          cialo.hidden = false;
          cialo.replaceChildren(el('p', 'field-hint', t('zm.expired')));
          return;
        }
        // Nie pytamy, gdy nikt nie patrzy (karta w tle, zamknięte Ustawienia).
        if (document.hidden || kontener.offsetParent === null) return;
        const l = (await zadaj('/api/agent/lista').catch(() => ({ json: {} }))).json.agenci || [];
        const nowy = l.find((a) => !przed.has(a.id));
        if (!nowy) return;
        zwin(true);
        start.textContent = t('zm.connectAnother');
        const gotowe = el('p', 'zm-czekam zm-ok', t('zm.connected').replace('{nazwa}', nowy.nazwa));
        gotowe.setAttribute('role', 'status');
        cialo.hidden = false;
        cialo.replaceChildren(gotowe);
        if (poPolaczeniu) poPolaczeniu(nowy);
        odswiez(true);
      }, 2000);
    }
    start.addEventListener('click', () => { pokaz().catch(() => { start.disabled = false; }); });
    return { pokaz };
  }

  /* ------------------------------------------------------ lista komputerów --- */

  /** Jedno ludzkie zdanie nad dziennikiem – surowy traceback nic nie mówi. */
  function dlaczego(log) {
    const l = String(log || '');
    if (/address already in use|Errno 98|10048|Only one usage of each socket/i.test(l)) return t('zm.why.port');
    const brak = /No module named ['"]?([\w.]+)/.exec(l);
    if (brak) return t('zm.why.module').replace('{modul}', brak[1]);
    // Kamera przed Kinectem: podpowiedź w dzienniku obserwatora wspomina
    // Kinecta, choć padła zwykła kamera – wcześniej wychodziło „Nie widać Kinecta”.
    if (/Nie mogę otworzyć kamery|Camera index out of range|VideoCapture|cannot open camera/i.test(l)) return t('zm.why.camera');
    if (/otworzyć Kinecta|NuiInitialize|sync_get_depth|Kinect.*(niedostępny|nie widzę)|KinectError/i.test(l)) return t('zm.why.kinect');
    return t('zm.why.other');
  }

  function opisSkladnika(a, k) {
    const s = (a.skladniki || {})[k] || {};
    const chce = Boolean((a.chce || {})[k]);
    /* Niepołączony: stan wiersza pusty – przełącznik sam mówi wł./wył., a co to
       znaczy, mówi JEDEN baner na górze karty (dawniej „Włączy się, gdy komputer
       się połączy” pod każdym przełącznikiem, runda 8). */
    if (!a.online) return { tekst: '', klasa: '' };
    if (!chce) return { tekst: t('zm.st.off'), klasa: '' };
    if (s.zewnetrzny) return { tekst: t('zm.st.external'), klasa: 'zm-ok' };
    if (s.dziala) {
      if (k === 'zmysly' && !a.zmyslyDzialaja) return { tekst: t('zm.st.starting'), klasa: 'zm-trwa' };
      return { tekst: t('zm.st.on'), klasa: 'zm-ok' };
    }
    if (s.kodWyjscia !== null && s.kodWyjscia !== undefined) return { tekst: t('zm.st.failed'), klasa: 'zm-zle', log: s.log };
    return { tekst: t('zm.st.starting'), klasa: 'zm-trwa' };
  }

  function kartaKomputera(a) {
    const karta = el('div', `zm-komputer${a.online ? '' : ' offline'}`);
    karta.dataset.id = a.id;
    const glowa = el('div', 'zm-glowa');
    const kropka = el('span', `zm-kropka${a.online ? ' on' : ''}`);
    kropka.setAttribute('aria-hidden', 'true');
    const nazwa = el('strong', 'zm-nazwa', a.nazwa);
    const meta = el('span', 'zm-meta mono', [a.system, a.online ? t('zm.online') : t('zm.offline')].filter(Boolean).join(' · '));
    glowa.append(kropka, nazwa, meta);
    karta.append(glowa);
    if (!a.online) karta.append(el('p', 'zm-baner zm-offline-zdanie', t(a.uspiony ? 'zm.asleep' : 'zm.offlineHint')));

    const caps = Object.entries(a.caps || {}).filter(([k, v]) => v === true && !/_gotowy$/.test(k))
      .map(([k]) => (k === 'extract' ? t('zm.cap.extract') : CAPS[k] || k));
    if (a.online && a.zmyslyDzialaja && caps.length) {
      karta.append(el('p', 'field-hint zm-caps', `${t('zm.caps')} ${[...new Set(caps)].join(', ')}`));
    }

    const pakiety = a.pakiety || {};
    const ilePakietow = PAKIETY.filter((p) => pakiety[p]).length;
    const trwa = Boolean(a.instalacja && a.instalacja.trwa);
    if (a.online && !pakiety.rdzen && !trwa && !a.zmyslyDzialaja) {
      const baner = el('div', 'zm-baner');
      baner.append(el('span', '', t('zm.noPackages')));
      const b = przycisk('btn-primary', t('zm.installRecommended'));
      b.addEventListener('click', () => polecenieAgenta(a.id, { polecenie: 'instaluj', pakiety: ZALECANE }, b));
      baner.append(b);
      karta.append(baner);
    }

    const skl = el('div', 'zm-skladniki');
    for (const k of SKLADNIKI) {
      const opis = opisSkladnika(a, k);
      const wiersz = el('div', 'zm-skladnik');
      const etykieta = el('label', 'zm-przelacznik');
      const pole = el('input');
      pole.type = 'checkbox';
      pole.checked = Boolean((a.chce || {})[k]);
      pole.disabled = !a.online;
      pole.dataset.skladnik = k;
      pole.addEventListener('change', async () => {
        pole.disabled = true;
        ostatniZapis = Date.now();
        await zadaj(`/api/agent/ustaw?id=${encodeURIComponent(a.id)}`, { metoda: 'POST', dane: { chce: { [k]: pole.checked } } });
        ostatniZapis = Date.now();
        pole.disabled = false;
        setTimeout(() => odswiez(true), 700);
      });
      // Krótka nazwa w jednym wierszu, co robi – drobnym drukiem pod spodem.
      const tekst = el('span', 'zm-etykieta');
      tekst.append(el('span', '', t(`zm.s.${k}`)), el('span', 'zm-opis', t(`zm.s.${k}Opis`)));
      etykieta.append(pole, el('span', 'zm-suwak'), tekst);
      wiersz.append(etykieta);
      if (opis.tekst) wiersz.append(el('span', `zm-stan ${opis.klasa}`, opis.tekst));
      skl.append(wiersz);
      if (opis.log) {
        skl.append(el('p', 'field-hint zm-zle zm-dlaczego', dlaczego(opis.log)));
        const d = el('details', 'zm-log');
        d.dataset.klucz = `log-${k}`;
        d.append(el('summary', '', t('zm.showLog')), el('pre', 'mono', opis.log));
        skl.append(d);
      }
    }
    karta.append(skl);

    // Pakiety: zainstalowane zaznaczone i zablokowane, reszta do wyboru.
    const dp = el('details', 'zm-pakiety');
    dp.dataset.klucz = 'pakiety';
    if (trwa) dp.open = true;
    dp.append(el('summary', '', t('zm.packages').replace('{n}', ilePakietow).replace('{z}', PAKIETY.length)));
    const lp = el('div', 'zm-pakiety-lista');
    const inst = przycisk('btn-secondary', t('zm.install'));
    for (const p of PAKIETY) {
      const lab = el('label', 'zm-pakiet');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.value = p;
      cb.dataset.pakiet = p;
      cb.checked = Boolean(pakiety[p]);
      cb.disabled = Boolean(pakiety[p]) || !a.online || trwa;
      cb.addEventListener('change', () => { inst.disabled = !lp.querySelector('input:checked:not(:disabled)'); });
      lab.append(cb, el('span', '', t(`zm.p.${p}`)));
      if (pakiety[p]) lab.append(el('span', 'zm-ok', ' ✓'));
      lp.append(lab);
    }
    inst.disabled = true;
    inst.addEventListener('click', () => {
      const wybrane = [...lp.querySelectorAll('input:checked:not(:disabled)')].map((x) => x.value);
      if (wybrane.length) polecenieAgenta(a.id, { polecenie: 'instaluj', pakiety: wybrane }, inst);
    });
    dp.append(lp, inst);
    if (a.instalacja) {
      const i = a.instalacja;
      const naglowek = i.trwa ? t('zm.installing')
        : i.ok ? t(i.przeladowano ? 'zm.installed' : 'zm.installedOff')
          : (i.blad || t('zm.installFailed'));
      dp.append(el('p', `field-hint ${i.trwa ? 'zm-trwa' : i.ok ? 'zm-ok' : 'zm-zle'}`, naglowek));
      for (const o of i.ostrzezenia || []) dp.append(el('p', 'field-hint zm-trwa', o));
      if (i.log) dp.append(el('pre', 'zm-log-pre mono', i.log));
    }
    karta.append(dp);

    const stopka = el('div', 'field-row zm-stopka');
    if (a.nieaktualny && a.online) {
      const akt = przycisk('btn-secondary', t('zm.update'));
      akt.addEventListener('click', () => polecenieAgenta(a.id, { polecenie: 'aktualizuj' }, akt));
      stopka.append(akt);
    }
    // Autostart to taki sam przełącznik jak składniki – dawniej pole wyboru
    // rozjeżdżało się na pół wiersza (runda 8, zrzut 20).
    const auto = el('div', 'zm-skladnik zm-auto');
    const autoLab = el('label', 'zm-przelacznik');
    const autoCb = el('input');
    autoCb.type = 'checkbox';
    autoCb.checked = Boolean(a.autostart);
    autoCb.disabled = !a.online;
    autoCb.dataset.autostart = '1';
    autoCb.addEventListener('change', () => polecenieAgenta(a.id, { polecenie: 'autostart', wlacz: autoCb.checked }));
    const autoTekst = el('span', 'zm-etykieta');
    autoTekst.append(el('span', '', t('zm.autostart')), el('span', 'zm-opis', t('zm.autostartOpis')));
    autoLab.append(autoCb, el('span', 'zm-suwak'), autoTekst);
    auto.append(autoLab);
    skl.append(auto);
    const odlacz = przycisk('btn-ghost zm-odlacz', t('zm.disconnect'));
    odlacz.addEventListener('click', async () => {
      if (!confirm(t('zm.disconnectConfirm').replace('{nazwa}', a.nazwa))) return;
      await zadaj(`/api/agent?id=${encodeURIComponent(a.id)}`, { metoda: 'DELETE' });
      odswiez(true);
    });
    stopka.append(odlacz);
    karta.append(stopka);
    return karta;
  }

  /** Polecenie do agenta; przycisk blokuje się od razu – dwuklik dawał dwie instalacje. */
  async function polecenieAgenta(id, dane, przyciskZrodlowy) {
    if (przyciskZrodlowy) przyciskZrodlowy.disabled = true;
    ostatniZapis = Date.now();
    await zadaj(`/api/agent/polecenie?id=${encodeURIComponent(id)}`, { metoda: 'POST', dane });
    ostatniZapis = Date.now();
    setTimeout(() => odswiez(true), 900);
  }

  /* Skąd są teraz zmysły – jedno zdanie nad listą (jedyne ogłaszane czytnikowi). */
  function zdanieZrodla(zrodlo, ile) {
    if (zrodlo === 'agent') return t('zm.src.agent');
    if (zrodlo === 'dom') return t(document.body.classList.contains('rola-czlonek') ? 'zm.src.owner' : 'zm.src.home');
    return ile ? t('zm.src.offline') : t('zm.src.none');
  }

  let ostatniStan = '';
  let ostatniZapis = 0;
  /** @param {boolean} [wymus] przerysuj nawet bez zmian (po własnym działaniu) */
  async function odswiez(wymus = false) {
    const lista = $('zm-lista');
    if (!lista) return;
    const wyslano = Date.now();
    const r = await zadaj('/api/agent/lista').catch(() => null);
    if (!r || !r.ok) return;
    // Odpowiedź sprzed ostatniego kliknięcia przestawiłaby przełącznik z powrotem.
    if (wyslano < ostatniZapis) return;
    const stan = JSON.stringify(r.json);
    if (!wymus && stan === ostatniStan) return;
    // Pod palcami nie przerysowujemy: fokus na przełączniku, polu albo przycisku w liście.
    const aktywny = document.activeElement;
    const wLiscie = Boolean(aktywny && aktywny !== document.body && lista.contains(aktywny));
    if (!wymus && wLiscie && aktywny.matches('input,button,summary')) return;
    ostatniStan = stan;

    const otwarte = new Set([...lista.querySelectorAll('details[open]')]
      .map((d) => `${d.closest('.zm-komputer')?.dataset.id}:${d.dataset.klucz}`));
    const zaznaczone = new Set([...lista.querySelectorAll('input[data-pakiet]:checked:not(:disabled)')]
      .map((c) => `${c.closest('.zm-komputer')?.dataset.id}:${c.dataset.pakiet}`));
    const fokus = wLiscie ? { id: aktywny.closest('.zm-komputer')?.dataset.id, skladnik: aktywny.dataset.skladnik,
      pakiet: aktywny.dataset.pakiet, autostart: aktywny.dataset.autostart } : null;

    const agenci = r.json.agenci || [];
    let zrodlo = lista.querySelector('.zm-zrodlo');
    const tekstZrodla = zdanieZrodla(r.json.zrodlo, agenci.length);
    if (!zrodlo) {
      zrodlo = el('p', 'field-hint zm-zrodlo');
      zrodlo.setAttribute('role', 'status');
    }
    if (zrodlo.textContent !== tekstZrodla) zrodlo.textContent = tekstZrodla;
    lista.replaceChildren(zrodlo, ...agenci.map(kartaKomputera));

    for (const d of lista.querySelectorAll('details')) {
      if (otwarte.has(`${d.closest('.zm-komputer')?.dataset.id}:${d.dataset.klucz}`)) d.open = true;
    }
    for (const c of lista.querySelectorAll('input[data-pakiet]:not(:disabled)')) {
      if (zaznaczone.has(`${c.closest('.zm-komputer')?.dataset.id}:${c.dataset.pakiet}`)) {
        c.checked = true;
        c.dispatchEvent(new Event('change'));
      }
    }
    if (fokus && fokus.id) {
      const karta = [...lista.querySelectorAll('.zm-komputer')].find((x) => x.dataset.id === fokus.id);
      const cel = karta && (fokus.skladnik ? karta.querySelector(`[data-skladnik="${fokus.skladnik}"]`)
        : fokus.pakiet ? karta.querySelector(`[data-pakiet="${fokus.pakiet}"]`)
          : fokus.autostart ? karta.querySelector('[data-autostart]') : null);
      if (cel) cel.focus({ preventScroll: true });
    }

    const k = $('zm-kreator');
    if (k && !k.childElementCount) kreator(k);
    const przyciskPodlacz = k && k.querySelector('.zm-podlacz');
    if (przyciskPodlacz && !przyciskPodlacz.hidden) {
      przyciskPodlacz.textContent = t(agenci.length ? 'zm.connectAnother' : 'zm.connect');
      przyciskPodlacz.className = agenci.length ? 'btn-secondary zm-podlacz' : 'btn-primary zm-podlacz';
    }
  }

  /* Odświeżanie tylko przy otwartych Ustawieniach – co 4 s, żeby przełącznik
     i instalacja pokazywały stan komputera prawie na żywo. */
  let zegar = null;
  function pilnuj() {
    const modal = $('settings-modal');
    if (!modal) return;
    const przelicz = () => {
      const otwarte = modal.style.display !== 'none';
      if (otwarte && !zegar) { odswiez(); zegar = setInterval(() => { if (!document.hidden) odswiez(); }, 4000); }
      if (!otwarte && zegar) { clearInterval(zegar); zegar = null; }
    };
    new MutationObserver(przelicz).observe(modal, { attributes: true, attributeFilter: ['style'] });
    przelicz();
  }

  return { kreator, odswiez, pilnuj, polecenie, dlaczego };
}

if (typeof window !== 'undefined') window.utworzZmyslyWidok = utworzZmyslyWidok;
if (typeof module !== 'undefined') module.exports = { utworzZmyslyWidok };

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
    embed: 'bge-m3', kinect: 'Kinect', extract: 'dokumenty', birdnet: 'BirdNET', upscale: 'Real-ESRGAN' };

  const el = (tag, klasa, tekst) => {
    const e = document.createElement(tag);
    if (klasa) e.className = klasa;
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  };

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

  /** Polecenie do wklejenia – z adresem, pod którym przeglądarka widzi Cosmosa. */
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
   * @param {Function} [poPolaczeniu] woła się z nazwą komputera, gdy się połączy
   */
  function kreator(kontener, poPolaczeniu) {
    let czekanie = null;
    kontener.replaceChildren();
    const start = el('button', 'btn-primary zm-podlacz', t('zm.connect'));
    start.type = 'button';
    const cialo = el('div', 'zm-kroki');
    cialo.hidden = true;
    kontener.append(start, cialo);

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
      const { kod, wygasa } = r.json;
      let system = systemPrzegladarki();
      start.hidden = true;
      cialo.hidden = false;

      const przelacznik = el('div', 'zm-system');
      przelacznik.setAttribute('role', 'group');
      przelacznik.setAttribute('aria-label', t('zm.systemAria'));
      const bWin = el('button', '', 'Windows');
      const bSh = el('button', '', 'macOS / Linux');
      for (const b of [bWin, bSh]) b.type = 'button';
      przelacznik.append(bWin, bSh);

      const krok1 = el('li');
      const krok2 = el('li');
      const krok3 = el('li');
      const pole = el('code', 'zm-polecenie mono');
      const kopiuj = el('button', 'btn-secondary zm-kopiuj', t('zm.copy'));
      kopiuj.type = 'button';
      const wiersz = el('div', 'zm-polecenie-wiersz');
      wiersz.append(pole, kopiuj);
      const stan = el('p', 'zm-czekam', '');
      stan.setAttribute('role', 'status');
      const lista = el('ol', 'zm-lista-krokow');
      lista.append(krok1, krok2, krok3);

      const recznie = el('details', 'zm-recznie');
      const recznieTyt = el('summary', '', t('zm.manual'));
      const recznieTxt = el('p', 'field-hint', '');
      const recznieKod = el('code', 'zm-polecenie mono', '');
      recznie.append(recznieTyt, recznieTxt, recznieKod);

      const naKomputerze = el('p', 'field-hint', t('zm.onComputer'));
      cialo.replaceChildren(naKomputerze, przelacznik, lista, stan, recznie);

      function rysuj() {
        bWin.classList.toggle('aktywna', system === 'win');
        bSh.classList.toggle('aktywna', system !== 'win');
        bWin.setAttribute('aria-pressed', String(system === 'win'));
        bSh.setAttribute('aria-pressed', String(system !== 'win'));
        krok1.textContent = t(system === 'win' ? 'zm.step1win' : 'zm.step1sh');
        krok2.replaceChildren(el('span', '', t('zm.step2')), wiersz);
        pole.textContent = polecenie(system, kod);
        krok3.textContent = t('zm.step3');
        recznieTxt.textContent = t('zm.manualHint');
        recznieKod.textContent = `python agent.py --serwer ${location.origin} --kod ${kod} --autostart --w-tle`;
      }
      bWin.addEventListener('click', () => { system = 'win'; rysuj(); });
      bSh.addEventListener('click', () => { system = 'sh'; rysuj(); });
      kopiuj.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(pole.textContent); kopiuj.textContent = t('zm.copied'); }
        catch { const zakres = document.createRange(); zakres.selectNodeContents(pole); getSelection().removeAllRanges(); getSelection().addRange(zakres); }
        setTimeout(() => { kopiuj.textContent = t('zm.copy'); }, 2000);
      });
      rysuj();

      const doKiedy = new Date(wygasa).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      stan.textContent = t('zm.waiting').replace('{kod}', kod).replace('{czas}', doKiedy);
      clearInterval(czekanie);
      czekanie = setInterval(async () => {
        if (!kontener.isConnected || Date.now() > wygasa) {
          clearInterval(czekanie);
          if (kontener.isConnected) { stan.textContent = t('zm.expired'); start.hidden = false; }
          return;
        }
        const l = (await zadaj('/api/agent/lista').catch(() => ({ json: {} }))).json.agenci || [];
        const nowy = l.find((a) => !przed.has(a.id));
        if (!nowy) return;
        clearInterval(czekanie);
        stan.textContent = t('zm.connected').replace('{nazwa}', nowy.nazwa);
        stan.classList.add('zm-ok');
        if (poPolaczeniu) poPolaczeniu(nowy);
        odswiez();
      }, 2000);
    }
    start.addEventListener('click', () => { pokaz().catch(() => { start.disabled = false; }); });
    return { pokaz };
  }

  /* ------------------------------------------------------ lista komputerów --- */

  function opisSkladnika(a, k) {
    const s = (a.skladniki || {})[k] || {};
    const chce = Boolean((a.chce || {})[k]);
    if (!a.online) return { tekst: chce ? t('zm.st.offlineOn') : t('zm.st.off'), klasa: '' };
    if (!chce) return { tekst: t('zm.st.off'), klasa: '' };
    if (s.dziala) {
      if (k === 'zmysly' && !a.zmyslyDzialaja) return { tekst: t('zm.st.starting'), klasa: 'zm-trwa' };
      return { tekst: t('zm.st.on'), klasa: 'zm-ok' };
    }
    if (s.kodWyjscia !== null && s.kodWyjscia !== undefined) return { tekst: t('zm.st.failed'), klasa: 'zm-zle', log: s.log };
    return { tekst: t('zm.st.starting'), klasa: 'zm-trwa' };
  }

  function kartaKomputera(a) {
    const karta = el('div', 'zm-komputer');
    karta.dataset.id = a.id;
    const glowa = el('div', 'zm-glowa');
    const kropka = el('span', `zm-kropka${a.online ? ' on' : ''}`);
    kropka.setAttribute('aria-hidden', 'true');
    const nazwa = el('strong', 'zm-nazwa', a.nazwa);
    const meta = el('span', 'zm-meta mono', [a.system, a.online ? t('zm.online') : t('zm.offline')].filter(Boolean).join(' · '));
    glowa.append(kropka, nazwa, meta);
    karta.append(glowa);

    const caps = Object.entries(a.caps || {}).filter(([, v]) => v === true).map(([k]) => CAPS[k] || k);
    if (a.online && a.zmyslyDzialaja && caps.length) {
      karta.append(el('p', 'field-hint zm-caps', `${t('zm.caps')} ${[...new Set(caps)].join(', ')}`));
    }

    const pakiety = a.pakiety || {};
    const ilePakietow = PAKIETY.filter((p) => pakiety[p]).length;
    const trwa = a.instalacja && a.instalacja.trwa;
    if (a.online && !pakiety.rdzen && !trwa && !a.zmyslyDzialaja) {
      const baner = el('div', 'zm-baner');
      baner.append(el('span', '', t('zm.noPackages')));
      const b = el('button', 'btn-primary', t('zm.installRecommended'));
      b.type = 'button';
      b.addEventListener('click', () => polecenieAgenta(a.id, { polecenie: 'instaluj', pakiety: ZALECANE }));
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
        await zadaj(`/api/agent/ustaw?id=${encodeURIComponent(a.id)}`, { metoda: 'POST', dane: { chce: { [k]: pole.checked } } });
        setTimeout(odswiez, 600);
      });
      etykieta.append(pole, el('span', 'zm-suwak'), el('span', 'zm-etykieta', t(`zm.s.${k}`)));
      const stan = el('span', `zm-stan ${opis.klasa}`, opis.tekst);
      wiersz.append(etykieta, stan);
      skl.append(wiersz);
      if (opis.log) {
        const d = el('details', 'zm-log');
        d.append(el('summary', '', t('zm.showLog')), el('pre', 'mono', opis.log));
        skl.append(d);
      }
    }
    karta.append(skl);

    // Pakiety: zainstalowane zaznaczone i zablokowane, reszta do wyboru.
    const dp = el('details', 'zm-pakiety');
    if (trwa) dp.open = true;
    dp.append(el('summary', '', t('zm.packages').replace('{n}', ilePakietow).replace('{z}', PAKIETY.length)));
    const lp = el('div', 'zm-pakiety-lista');
    for (const p of PAKIETY) {
      const lab = el('label', 'zm-pakiet');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.value = p;
      cb.checked = Boolean(pakiety[p]);
      cb.disabled = Boolean(pakiety[p]) || !a.online || trwa;
      lab.append(cb, el('span', '', t(`zm.p.${p}`)));
      if (pakiety[p]) lab.append(el('span', 'zm-ok', ' ✓'));
      lp.append(lab);
    }
    const inst = el('button', 'btn-secondary', t('zm.install'));
    inst.type = 'button';
    inst.disabled = !a.online || trwa;
    inst.addEventListener('click', () => {
      const wybrane = [...lp.querySelectorAll('input:checked:not(:disabled)')].map((x) => x.value);
      if (wybrane.length) polecenieAgenta(a.id, { polecenie: 'instaluj', pakiety: wybrane });
    });
    dp.append(lp, inst);
    if (a.instalacja) {
      const i = a.instalacja;
      const naglowek = i.trwa ? t('zm.installing') : i.ok ? t('zm.installed') : (i.blad || t('zm.installFailed'));
      dp.append(el('p', `field-hint ${i.trwa ? 'zm-trwa' : i.ok ? 'zm-ok' : 'zm-zle'}`, naglowek));
      if (i.log) dp.append(el('pre', 'zm-log-pre mono', i.log));
    }
    karta.append(dp);

    const stopka = el('div', 'field-row zm-stopka');
    if (a.nieaktualny && a.online) {
      const akt = el('button', 'btn-secondary', t('zm.update'));
      akt.type = 'button';
      akt.addEventListener('click', () => polecenieAgenta(a.id, { polecenie: 'aktualizuj' }));
      stopka.append(akt);
    }
    const auto = el('label', 'ps-sens zm-auto');
    const autoCb = el('input');
    autoCb.type = 'checkbox';
    autoCb.checked = Boolean(a.autostart);
    autoCb.disabled = !a.online;
    autoCb.addEventListener('change', () => polecenieAgenta(a.id, { polecenie: 'autostart', wlacz: autoCb.checked }));
    auto.append(autoCb, el('span', '', ` ${t('zm.autostart')}`));
    const odlacz = el('button', 'btn-ghost', t('zm.disconnect'));
    odlacz.type = 'button';
    odlacz.addEventListener('click', async () => {
      if (!confirm(t('zm.disconnectConfirm').replace('{nazwa}', a.nazwa))) return;
      await zadaj(`/api/agent?id=${encodeURIComponent(a.id)}`, { metoda: 'DELETE' });
      odswiez();
    });
    stopka.append(auto, odlacz);
    karta.append(stopka);
    return karta;
  }

  async function polecenieAgenta(id, dane) {
    await zadaj(`/api/agent/polecenie?id=${encodeURIComponent(id)}`, { metoda: 'POST', dane });
    setTimeout(odswiez, 800);
  }

  /* Skąd są teraz zmysły – jedno zdanie nad listą. */
  function zdanieZrodla(zrodlo, ile) {
    if (zrodlo === 'agent') return t('zm.src.agent');
    if (zrodlo === 'dom') return t(document.body.classList.contains('rola-czlonek') ? 'zm.src.owner' : 'zm.src.home');
    return ile ? t('zm.src.offline') : t('zm.src.none');
  }

  let otwarteSzczegoly = new Set();
  async function odswiez() {
    const lista = $('zm-lista');
    if (!lista) return;
    const r = await zadaj('/api/agent/lista').catch(() => null);
    if (!r || !r.ok) return;
    // Rozwinięte „Pakiety” i dzienniki zostają rozwinięte po odświeżeniu.
    otwarteSzczegoly = new Set([...lista.querySelectorAll('details[open]')].map((d) => `${d.closest('.zm-komputer')?.dataset.id}:${d.className}`));
    const agenci = r.json.agenci || [];
    const zrodlo = el('p', 'field-hint zm-zrodlo', zdanieZrodla(r.json.zrodlo, agenci.length));
    lista.replaceChildren(zrodlo, ...agenci.map(kartaKomputera));
    for (const d of lista.querySelectorAll('details')) {
      if (otwarteSzczegoly.has(`${d.closest('.zm-komputer')?.dataset.id}:${d.className}`)) d.open = true;
    }
    const k = $('zm-kreator');
    if (k && !k.childElementCount) kreator(k);
    const przycisk = k && k.querySelector('.zm-podlacz');
    if (przycisk) przycisk.textContent = t(agenci.length ? 'zm.connectAnother' : 'zm.connect');
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

  return { kreator, odswiez, pilnuj, polecenie };
}

if (typeof window !== 'undefined') window.utworzZmyslyWidok = utworzZmyslyWidok;
if (typeof module !== 'undefined') module.exports = { utworzZmyslyWidok };

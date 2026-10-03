/* ============================================================
   BUDOWNICZOWIE WIDOKU – dane wchodzą, element DOM wychodzi

   Wydzielone z `app.js`, który przy 7697 liniach był największym plikiem
   projektu i miejscem, gdzie mieszkało wszystko naraz: stan, zapisy,
   obsługa zdarzeń i budowanie DOM-u.

   Podział idzie po jednej granicy i tylko po niej: TU są funkcje, które
   dostają dane i oddają gotowy element, nie sięgając po stan aplikacji.
   Siatka miniatur, panel wyniku programu, podglądy obrazu i tekstu.
   Wszystko, co czyta albo zmienia stan rozmowy, zostaje w `app.js`.

   Dzięki temu granica jest sprawdzalna, a nie umowna: gdyby któraś z tych
   funkcji zaczęła sięgać po `conv` albo `settings`, nie miałaby skąd –
   moduł ich nie dostaje.
   ============================================================ */

/**
 * Zbuduj zestaw budowniczych widoku.
 *
 * @param {object} z zależności
 * @param {Function} z.t tłumaczenia
 * @param {Function} z.readJsonSafe bezpieczny odczyt JSON
 * @param {Function} z.saveConversations zapis rozmów (po dobraniu miniatur)
 * @param {Function} z.renderMessages odmalowanie rozmowy
 * @param {Function} z.msgPhotos zdjęcia z wiadomości
 * @param {Function} z.msgDalej stan stronicowania wyniku archiwum
 * @param {number}   z.PORCJA_ARCHIWUM ile miniatur dobiera jedno kliknięcie
 * @param {Function} [z.zdjecieNiewczytane] kafel paska odpadł (`p.niewczytane`) – zapisz rozmowę
 * @returns {object} { runPanel, photosGrid, pasekZdjec, stopkaArchiwum, naKafelek,
 *                     openTextViewer, openImageViewer, przesunPodglad, closeImageViewer }
 */
function utworzWidoki(z) {
  const {
    t, readJsonSafe, saveConversations, renderMessages,
    msgPhotos, msgDalej, PORCJA_ARCHIWUM,
    zdjecieNiewczytane = () => {},
  } = z;

  /** Wynik uruchomionego programu: co wypisał, jak długo to trwało i co narysował.
   *
   *  Czas wykonania jest tu celowo widoczny. „Policzone, nie zgadnięte" ma
   *  znaczenie tylko wtedy, gdy widać, że program naprawdę się wykonał.
   */
  function runPanel(run) {
    const box = document.createElement('div');
    box.className = 'run-panel';

    const pasek = document.createElement('div');
    pasek.className = 'run-bar';
    pasek.textContent = run.przerwany
      ? t('run.timeout', { s: Math.round((run.limitMs || 10000) / 1000) })
      : t('run.done', { ms: run.ms || 0 });
    box.appendChild(pasek);

    if (run.stdout && run.stdout.trim()) {
      const out = document.createElement('pre');
      out.className = 'run-out';
      out.textContent = run.stdout.trim();
      box.appendChild(out);
    }
    if (run.stderr && run.stderr.trim()) {
      const err = document.createElement('pre');
      err.className = 'run-out run-err';
      err.textContent = run.stderr.trim();
      box.appendChild(err);
    }

    for (const plik of run.wyniki || []) {
      if (/\.svg$/i.test(plik.name)) {
        /* SVG wstawiamy jako obrazek z data-URI, nie przez innerHTML. Program
           pisze model, więc jego wyjście jest treścią niezaufaną – wstrzyknięte
           do DOM-u wykonałoby skrypt w kontekście Cosmosa. W <img> nie wykona. */
        const img = document.createElement('img');
        img.className = 'run-svg';
        img.alt = plik.name;
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(plik.text)));
        box.appendChild(img);
      } else {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'doc-chip ik ik-dokument';
        chip.textContent = plik.name;
        chip.addEventListener('click', () => openTextViewer(plik.name, plik.text));
        box.appendChild(chip);
      }
    }
    return box;
  }

  /** Siatka zdjęć znalezionych w internecie.
   *
   *  Miniatury lecą przez `/api/search/thumb`, a nie prosto z cudzego CDN-u:
   *  telefon nie łączy się wtedy z obcym hostem przy każdym wyniku, a zdjęcia
   *  działają też wtedy, gdy sieć ten CDN blokuje. Każdy kafelek prowadzi do
   *  strony źródłowej – zdjęcie z internetu bez źródła jest bezwartościowe.
   */
  function photosGrid(photos) {
    const wrap = document.createElement('div');
    wrap.className = 'photo-grid';
    /* Link na ekranie tylko http(s) albo własna ścieżka – adres z wyników
       cudzej wyszukiwarki (`javascript:`, `data:`) nie trafia do `href`. */
    const bezpiecznyLink = (u) => (typeof u === 'string' && (/^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u)) ? u : '');
    for (const p of photos) {
      const a = document.createElement('a');
      a.className = 'photo-tile';
      const zrodloStrony = typeof p.source === 'string' && /^https?:\/\//i.test(p.source) ? p.source : '';
      a.href = zrodloStrony || bezpiecznyLink(p.full) || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = [p.title, p.zrodlo, p.licencja].filter(Boolean).join(' · ');
      const img = document.createElement('img');
      /* Adres własny (np. z archiwum) bierzemy wprost – proxy miniatur jest
         od CUDZYCH hostów i tylko by tu przeszkadzało. Tylko „/ścieżka”:
         „//obcy.host/…” to adres obcego hosta i ominąłby proxy. */
      const wlasny = /^\/(?!\/)/.test(p.thumb || '');
      img.src = wlasny ? p.thumb : `/api/search/thumb?u=${encodeURIComponent(p.thumb)}`;
      img.alt = p.title || t('photo.found');
      img.loading = 'lazy';

      /* Kliknięcie otwiera podgląd W COSMOSIE, nie nową kartę.
         Marcin: „lepiej by było gdybym mógł je kliknąć żeby się rozwinęły
         w większym ekranie z wyższą rozdzielczością i wtedy z możliwością
         przejścia do źródła". Wcześniej kliknięcie wyrzucało od razu na obcą
         stronę i nie dawało nawet obejrzeć zdjęcia.

         `href` zostaje prawdziwy, więc środkowy przycisk myszy, Ctrl+klik
         i „otwórz w nowej karcie" dalej prowadzą do źródła – odbieranie tego
         byłoby zamianą jednego ograniczenia na drugie. */
      a.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        openImageViewer(p.podglad || p.full || p.thumb, {
          zapas: p.podglad ? '' : (wlasny ? p.thumb : `/api/search/thumb?u=${encodeURIComponent(p.thumb)}`),
          zrodlo: p.podglad ? '' : zrodloStrony,
          tytul: p.title || '',
          opis: [p.zrodlo, p.licencja].filter(Boolean).join(' · '),
        });
      });

      /* Co się dzieje, gdy miniatura nie chce się wczytać.

         Kiedyś kafelek po prostu ZNIKAŁ. Brzmi rozsądnie („nie zostawiaj dziury
         w siatce"), a w praktyce to była najgorsza możliwa reakcja: gdy proxy
         odrzucało wszystkie miniatury, Cosmos pisał „znalazłem 8 zdjęć" i nie
         pokazywał ani jednego, bez śladu, co poszło nie tak. Dokładnie to
         zgłosił Marcin.

         Teraz próbujemy po kolei: przez proxy → prosto z serwera obrazka →
         a jak i to nie wyjdzie, zostaje widoczny kafelek z odnośnikiem. Zawsze
         widać tyle kafelków, ile zapowiedziała odpowiedź. */
      let probowanoWprost = wlasny;   // własnego adresu nie ma po co próbować drugi raz
      img.addEventListener('error', () => {
        if (!probowanoWprost && /^https:\/\//i.test(p.thumb || '')) {
          // Proxy odmówiło (nieznany host, przekroczony czas). Przeglądarka
          // może pobrać obrazek sama – dla niej to zwykły zewnętrzny zasób.
          probowanoWprost = true;
          img.src = p.thumb;
          return;
        }
        img.remove();
        a.classList.add('photo-tile-pusty');
        const info = document.createElement('span');
        info.className = 'photo-brak';
        info.textContent = t('photo.thumbFailed');
        a.prepend(info);
      });

      const cap = document.createElement('span');
      cap.className = 'photo-cap';
      // Skąd zdjęcie i na jakiej licencji – dla kogoś, kto montuje film, to nie
      // ozdobnik, tylko odpowiedź na pytanie „czy wolno mi tego użyć".
      let skad = p.zrodlo || '';
      if (!skad) { try { skad = new URL(p.source).hostname.replace(/^www\./, ''); } catch { skad = ''; } }
      cap.textContent = [skad, p.licencja].filter(Boolean).join(' · ') || p.title || '';
      a.append(img, cap);
      wrap.appendChild(a);
    }
    return wrap;
  }

  /* ============ PASEK ZDJĘĆ NAD SEKCJĄ ODPOWIEDZI (runda 10) ============
     Zamiast siatki 2×4 w osobnej wiadomości pod każdym punktem planu (577 px
     na miejsce, 62% wysokości rozmowy na telefonie) – poziomy pasek nad
     treścią sekcji, której dotyczy, jak w ChatGPT (projekt agencja-ux,
     makieta-karuzeli.html). Etykieta miejsca tylko na pierwszym kaflu,
     źródło i licencja pod kursorem i w podglądzie.

     Pamięć i sieć (it-plynnosc): pierwsze trzy kafle paska ładują się
     natywnie leniwie, dalsze dopiero, gdy pasek przewinie się w ich stronę
     (jeden IntersectionObserver na pasek, `root` = tor). Bez tego telefon
     ściągał od razu 72 ze 112 miniatur planu. */
  const IK_ZDJ = {
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.2"/></svg>',
    lewo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    prawo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  };
  const linkBezpieczny = (u) => (typeof u === 'string' && (/^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u)) ? u : '');
  const stronaZrodla = (p) => (typeof p.source === 'string' && /^https?:\/\//i.test(p.source) ? p.source : '');
  const hostZdjecia = (p) => {
    if (p.zrodlo) return p.zrodlo;
    try { return new URL(p.source).hostname.replace(/^www\./, ''); } catch { return ''; }
  };
  const miniatura = (p) => (/^\/(?!\/)/.test(p.thumb || '') ? p.thumb : `/api/search/thumb?u=${encodeURIComponent(p.thumb || '')}`);

  /* Zdjęcie, które się nie wczytało albo okazało się ikonką, logo czy banerem,
     nie wraca: `p.niewczytane` zostaje w rozmowie (zapis), a pasek i podgląd je
     pomijają. Marcin: „nie pokazujmy zdjęć, których nie można wczytać”. */
  const widoczne = (g) => (g.photos || []).filter((p) => p && !p.niewczytane);
  /* Miniatura za mała na zdjęcie miejsca (piksel śledzący, „brak obrazka”,
     ikonka) albo o proporcjach banera – to nie jest zdjęcie miejsca. */
  const MIN_SZER = 100;
  const MIN_WYS = 75;
  const MAX_PROPORCJA = 3;
  const nieZdjecie = (img) => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return false;               // SVG bez wymiarów – rozstrzyga serwer
    return w < MIN_SZER || h < MIN_WYS || w / h > MAX_PROPORCJA || h / w > MAX_PROPORCJA;
  };

  /** Wszystkie zdjęcia odpowiedzi w kolejności pasków – podgląd przewija przez całość. */
  function zdjeciaOdpowiedzi(grupy) {
    const lista = [];
    for (const g of grupy) {
      if (g.stan !== 'gotowe') continue;
      const fotki = widoczne(g);
      fotki.forEach((p, i) => lista.push({ p, g, i: i + 1, n: fotki.length }));
    }
    return lista;
  }

  /**
   * Pasek jednej sekcji.
   *
   * @param {Array<object>} grupy grupy tej sekcji (`zdjecia` wiadomości, kolejność `po`)
   * @param {Array<object>} wszystkie wszystkie grupy odpowiedzi – dla podglądu
   * @returns {HTMLElement|null} `.zdj-pasek` albo null, gdy nie ma czego pokazać
   */
  function pasekZdjec(grupy, wszystkie = grupy) {
    const gotowe = grupy.filter((g) => g.stan === 'gotowe' && widoczne(g).length);
    const czekaja = grupy.filter((g) => g.stan === 'szukam' || g.stan === 'do-pobrania');
    if (!gotowe.length && !czekaja.length) return null;
    const pasek = document.createElement('div');
    pasek.className = 'zdj-pasek';
    const tor = document.createElement('div');
    tor.className = 'zdj-tor';
    const miejsca = gotowe.map((g) => g.etykieta || g.q);
    if (gotowe.length) {
      pasek.setAttribute('role', 'region');
      pasek.setAttribute('aria-label', t('photo.pasekMiejsca', { miejsca: miejsca.join(', ') }));
    } else {
      pasek.setAttribute('role', 'status');
      pasek.setAttribute('aria-label', t('chat.photosLoading'));
    }
    if (czekaja.length) pasek.setAttribute('aria-busy', 'true');
    for (const g of grupy) {
      if (g.stan === 'szukam' || g.stan === 'do-pobrania') {
        // Szkielet w wymiarach kafli – tekst pod paskiem nie skacze, gdy przyjdą zdjęcia.
        for (let i = 0; i < 3; i++) {
          const s = document.createElement('span');
          s.className = 'zdj-kafel szkielet';
          s.setAttribute('aria-hidden', 'true');
          tor.appendChild(s);
        }
        continue;
      }
      if (g.stan !== 'gotowe') continue;
      const etykieta = g.etykieta || g.q || '';
      const gi = String(grupy.indexOf(g));
      const fotki = widoczne(g);
      fotki.forEach((p, i) => {
        const a = document.createElement('a');
        a.className = 'zdj-kafel';
        a.dataset.grupa = gi;
        const zrodlo = stronaZrodla(p);
        a.href = zrodlo || linkBezpieczny(p.full) || '#';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        const host = hostZdjecia(p);
        a.title = [etykieta, host, p.licencja].filter(Boolean).join(' · ');
        if (i === 0) {
          a.dataset.miejsceStart = '';
          a.setAttribute('aria-label', t('photo.etykietaAria', { miejsce: etykieta, n: fotki.length }));
        }
        const img = document.createElement('img');
        img.alt = etykieta || p.title || t('photo.found');
        img.width = 208;
        img.height = 156;
        img.decoding = 'async';
        const adres = miniatura(p);
        if (tor.children.length < 3) { img.loading = 'lazy'; img.src = adres; } else img.dataset.src = adres;
        let wprost = /^\/(?!\/)/.test(p.thumb || '');
        img.addEventListener('error', () => {
          // Proxy odmówiło – przeglądarka może pobrać obrazek sama; dopiero potem kafel odpada.
          if (!wprost && /^https:\/\//i.test(p.thumb || '')) { wprost = true; img.src = p.thumb; return; }
          odrzucKafel(a, p);
        });
        img.addEventListener('load', () => { if (nieZdjecie(img)) odrzucKafel(a, p); });
        a.appendChild(img);
        if (host) {
          const chip = document.createElement('span');
          chip.className = 'zdj-zrodlo';
          chip.textContent = host;
          a.appendChild(chip);
        }
        if (i === 0 && etykieta) {
          const et = document.createElement('span');
          et.className = 'zdj-etykieta';
          et.innerHTML = IK_ZDJ.pin;
          const b = document.createElement('b');
          b.textContent = etykieta;
          et.appendChild(b);
          a.appendChild(et);
        }
        a.addEventListener('click', (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          /* Lista liczona przy kliknięciu: pasek przeżywa przebudowę rozmowy,
             a w tym czasie mogły dojść zdjęcia innych sekcji. */
          const lista = zdjeciaOdpowiedzi(wszystkie);
          otworzZdjeciaOdpowiedzi(lista, Math.max(0, lista.findIndex((x) => x.p === p)));
        });
        tor.appendChild(a);
      });
    }
    const krok = (kier) => tor.scrollBy({ left: kier * Math.max(120, tor.clientWidth - 60),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const strzalka = (klasa, ikona, klucz, kier) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `zdj-strzalka ${klasa}`;
      b.innerHTML = ikona;
      b.setAttribute('aria-label', t(klucz));
      b.tabIndex = -1;      // strzałki są dla myszy; klawiatura ma ←/→ na kaflach
      b.addEventListener('click', () => krok(kier));
      return b;
    };
    pasek.append(tor, strzalka('wstecz', IK_ZDJ.lewo, 'photo.wstecz', -1), strzalka('dalej', IK_ZDJ.prawo, 'photo.dalej', 1));
    const stan = () => {
      pasek.toggleAttribute('data-wstecz', tor.scrollLeft > 4);
      pasek.toggleAttribute('data-dalej', tor.scrollLeft + tor.clientWidth < tor.scrollWidth - 4);
    };
    tor.addEventListener('scroll', stan, { passive: true });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(stan).observe(tor);
    // Jeden przystanek Tab na pasek, ←/→ Home/End między kaflami.
    [...tor.querySelectorAll('a.zdj-kafel')].forEach((k, i) => k.setAttribute('tabindex', i === 0 ? '0' : '-1'));
    tor.addEventListener('keydown', (e) => {
      // Liczone przy naciśnięciu – kafle, które się nie wczytały, w międzyczasie odpadły.
      const kafle = [...tor.querySelectorAll('a.zdj-kafel')];
      const i = kafle.indexOf(document.activeElement);
      if (i < 0) return;
      const cel = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: kafle.length - 1 }[e.key];
      if (cel === undefined || !kafle[cel]) return;
      e.preventDefault();
      kafle[i].setAttribute('tabindex', '-1');
      kafle[cel].setAttribute('tabindex', '0');
      kafle[cel].focus({ preventScroll: true });
      kafle[cel].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    /** Kafel, który się nie wczytał albo nie jest zdjęciem miejsca – znika.
     *  Etykieta miejsca przechodzi na następny kafel tej samej grupy; miejsce
     *  bez żadnego kafla znika z opisu paska, a pasek bez kafli – cały. */
    function odrzucKafel(a, p) {
      if (!a.isConnected && !a.parentNode) return;
      if (!p.niewczytane) { p.niewczytane = true; zdjecieNiewczytane(p); }
      const nastepny = [...tor.querySelectorAll(`a.zdj-kafel[data-grupa="${a.dataset.grupa}"]`)].find((k) => k !== a) || null;
      if (a.hasAttribute('data-miejsce-start') && nastepny) {
        nastepny.dataset.miejsceStart = '';
        const et = a.querySelector('.zdj-etykieta');
        if (et) nastepny.appendChild(et);
        const g = grupy[Number(a.dataset.grupa)];
        const n = tor.querySelectorAll(`a.zdj-kafel[data-grupa="${a.dataset.grupa}"]`).length - 1;
        if (g) nastepny.setAttribute('aria-label', t('photo.etykietaAria', { miejsce: g.etykieta || g.q || '', n }));
      }
      const mialFokus = a.getAttribute('tabindex') === '0';
      const zFokusem = document.activeElement === a;
      a.remove();
      const kafle = [...tor.querySelectorAll('a.zdj-kafel')];
      if (!kafle.length && !tor.querySelector('.szkielet')) { pasek.remove(); return; }
      if (mialFokus && kafle[0]) {
        kafle[0].setAttribute('tabindex', '0');
        if (zFokusem) kafle[0].focus({ preventScroll: true });
      }
      const zostaly = gotowe.filter((g) => tor.querySelector(`a.zdj-kafel[data-grupa="${grupy.indexOf(g)}"]`));
      if (zostaly.length) pasek.setAttribute('aria-label', t('photo.pasekMiejsca', { miejsca: zostaly.map((g) => g.etykieta || g.q).join(', ') }));
      stan();
    }
    const odlozone = tor.querySelectorAll('img[data-src]');
    if (odlozone.length) {
      const wczytaj = (img) => { img.src = img.dataset.src; img.removeAttribute('data-src'); };
      if (typeof IntersectionObserver !== 'undefined') {
        const io = new IntersectionObserver((wpisy) => {
          for (const w of wpisy) if (w.isIntersecting) { wczytaj(w.target); io.unobserve(w.target); }
        }, { root: tor, rootMargin: '0px 50% 0px 0px' });
        odlozone.forEach((img) => io.observe(img));
      } else odlozone.forEach(wczytaj);
    }
    return pasek;
  }

  /** Podgląd przez wszystkie zdjęcia odpowiedzi, od `nr`. */
  function otworzZdjeciaOdpowiedzi(lista, nr) {
    const wpisy = lista.map(({ p, g, i, n }) => {
      const zrodlo = stronaZrodla(p);
      return {
        src: p.podglad || linkBezpieczny(p.full) || miniatura(p),
        zapas: p.podglad ? '' : miniatura(p),
        zrodlo: p.podglad ? '' : zrodlo,
        tytul: p.title || '',
        opis: [hostZdjecia(p), p.licencja].filter(Boolean).join(' · '),
        miejsce: g.etykieta || g.q || '',
        i, n,
      };
    });
    if (!wpisy.length) return;
    openImageViewer(wpisy[nr].src, { ...wpisy[nr], lista: wpisy, indeks: nr });
  }

  /* Ile miniatur dobieramy jednym kliknięciem. Każda to osobne zapytanie do
     OneDrive w chwili wyświetlenia, więc porcja jest kompromisem: za mała każe
     klikać bez końca, za duża zamraża telefon na kilkanaście sekund. */

  /** Pasek pod siatką: „24 z 311" i przycisk po następną porcję.
   *
   *  Marcin: „chciałbym móc przejrzeć wszystkie zdjęcia z wyszukania, a nie
   *  mieć informację typu »pokazałem Ci 20, ale jest 311«". Model tego nie
   *  załatwi – on dostaje próbkę tekstową i ma rację, że jej nie przekracza.
   *  Przeglądanie całości to zadanie dla przeglądarki, nie dla rozmowy.
   */
  function stopkaArchiwum(m) {
    const d = msgDalej(m);
    if (!d || !d.razem) return null;
    const pokazane = msgPhotos(m).length;
    const pasek = document.createElement('div');
    pasek.className = 'arch-dalej';

    const licznik = document.createElement('span');
    licznik.className = 'arch-dalej-licznik mono';
    licznik.textContent = t('arch.counter', { n: pokazane, z: d.razem });
    pasek.appendChild(licznik);

    if (d.pomin >= d.razem) return pasek;   // wszystko już na ekranie – sam licznik

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-secondary arch-dalej-btn';
    const zostalo = d.razem - d.pomin;
    btn.textContent = t('arch.more', { n: Math.min(PORCJA_ARCHIWUM, zostalo) });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = t('arch.loading');
      try {
        const r = await fetch(`/api/archive/search?limit=${PORCJA_ARCHIWUM}&pomin=${d.pomin}&${d.q}`);
        const dane = await readJsonSafe(r);
        if (!r.ok) throw new Error(dane.error || `HTTP ${r.status}`);
        const nowe = (Array.isArray(dane.wyniki) ? dane.wyniki : []).filter((w) => w.zrodlo === 'onedrive');
        const kafelki = nowe.map(naKafelek);
        m.content.photos = msgPhotos(m).concat(kafelki);
        /* Przesuwamy się o CAŁĄ oddaną stronę, nie o liczbę kafelków. Pliki
           spoza OneDrive'a (te z dysku, bez miniatury) odpadają przy filtrze,
           a gdyby licznik szedł za kafelkami, każde kliknięcie wracałoby po
           te same pliki i przycisk kręciłby się w miejscu. */
        d.pomin += (Array.isArray(dane.wyniki) ? dane.wyniki.length : 0);
        d.razem = Number(dane.znaleziono) || d.razem;
        saveConversations();

        /* DOPISUJEMY KAFELKI, ZAMIAST PRZERYSOWAĆ CAŁĄ ROZMOWĘ.
           `renderMessages()` kończy się wymuszonym zjazdem na sam dół, więc
           każde kliknięcie „pokaż kolejne" wyrzucałoby Marcina spod siatki,
           którą właśnie ogląda – a im dłużej by przeglądał, tym dalej od niej.
           Przy przeglądaniu trzystu zdjęć to jest różnica między narzędziem
           a udręką. */
        const siatka = pasek.previousElementSibling;
        const swieze = photosGrid(kafelki);
        if (siatka && siatka.classList.contains('photo-grid')) {
          while (swieze.firstChild) siatka.appendChild(swieze.firstChild);
          pasek.replaceWith(stopkaArchiwum(m));
        } else {
          // Siatki nie ma tam, gdzie się jej spodziewamy – wtedy lepiej
          // przerysować i stracić pozycję, niż nie pokazać dobranych zdjęć.
          renderMessages();
        }
      } catch (err) {
        btn.disabled = false;
        btn.textContent = t('arch.moreErr', { e: err.message });
      }
    });
    pasek.appendChild(btn);
    return pasek;
  }

  /** Wpis z archiwum → kafelek siatki. Jedno miejsce, bo używa tego i pierwsza
   *  porcja, i każda dobrana potem – rozjechanie się tych dwóch dawałoby
   *  kafelki bez podpisów w połowie siatki. */
  function naKafelek(w) {
    const adres = `/api/archive/thumb?id=${encodeURIComponent(w.id)}`;
    return {
      thumb: adres,
      podglad: adres,
      source: '',
      title: [w.nazwa, w.kiedy && w.kiedy.slice(0, 16).replace('T', ' ')].filter(Boolean).join(' · '),
      zrodlo: [w.poraDnia, w.swiatlo].filter(Boolean).join(' · '),
      licencja: w.ogniskowa ? `${w.ogniskowa} mm` : '',
    };
  }

  /** Podgląd obrazu na pełnym ekranie, z pobieraniem.
   *
   * Miniatura w rozmowie ma kilkaset pikseli, a wygenerowana grafika bywa
   * kilka razy większa – bez tego okna nie dało się jej ani obejrzeć, ani zapisać.
   */
  /** Podgląd tekstu załącznika – bez biblioteki, bez zapisu, tylko do wglądu.
   *  Buduje się na żądanie i znika po zamknięciu: to okno pomocnicze, nie stan. */
  function openTextViewer(nazwa, tekst) {
    const tlo = document.createElement('div');
    tlo.className = 'text-viewer';
    const okno = document.createElement('div');
    okno.className = 'text-viewer-box';
    const pasek = document.createElement('div');
    pasek.className = 'text-viewer-bar';
    const tytul = document.createElement('span');
    tytul.textContent = nazwa;
    const zamknij = document.createElement('button');
    zamknij.className = 'btn-secondary';
    zamknij.textContent = t('close');
    const tresc = document.createElement('pre');
    tresc.className = 'text-viewer-body';
    tresc.textContent = tekst;
    pasek.append(tytul, zamknij);
    okno.append(pasek, tresc);
    tlo.appendChild(okno);

    const usun = () => { tlo.remove(); document.removeEventListener('keydown', naEscape); };
    const naEscape = (e) => { if (e.key === 'Escape') usun(); };
    zamknij.addEventListener('click', usun);
    tlo.addEventListener('click', (e) => { if (e.target === tlo) usun(); });
    document.addEventListener('keydown', naEscape);
    document.body.appendChild(tlo);
  }

  /** Podgląd na pełnym ekranie.
   *
   *  @param {string} src   adres obrazu w najlepszej dostępnej rozdzielczości
   *  @param {object} opcje `zapas` – czym podmienić, gdy `src` się nie wczyta
   *                        (pełny plik bywa na hoście, który odmawia);
   *                        `zrodlo` – strona, z której zdjęcie pochodzi;
   *                        `tytul`, `opis` – podpis pod obrazem
   */
  /* LISTA W PODGLĄDZIE (runda 10): zdjęcia z paska odpowiedzi oglądane jedno
     po drugim – strzałki, ←/→, przesunięcie palcem. Pełny plik wczytujemy
     tylko dla bieżącego i sąsiednich (it-plynnosc: podgląd „przez wszystko”
     ściągał jednym dotknięciem 112 oryginałów, 42 MB). */
  let listaPodgladu = null;
  let indeksPodgladu = 0;

  function openImageViewer(src, opcje = {}) {
    const box = $('img-viewer');
    const img = $('img-viewer-img');
    const zrodlo = $('img-viewer-source');
    const podpis = $('img-viewer-caption');

    /* Pełny plik idzie z obcego hosta i czasem nie dojedzie – wtedy zamiast
       pustego czarnego ekranu pokazujemy to, co już było widać w siatce. */
    img.onerror = null;
    if (opcje.zapas && opcje.zapas !== src) {
      img.onerror = () => { img.onerror = null; img.src = opcje.zapas; imageViewerSrc = opcje.zapas; };
    }
    img.src = src;
    img.alt = opcje.tytul || opcje.miejsce || '';

    if (zrodlo) {
      zrodlo.hidden = !opcje.zrodlo;
      if (opcje.zrodlo) zrodlo.href = opcje.zrodlo;
    }
    if (podpis) {
      const tekst = [opcje.tytul, opcje.opis].filter(Boolean).join(' · ');
      podpis.textContent = tekst;
      podpis.hidden = !tekst;
    }

    listaPodgladu = Array.isArray(opcje.lista) ? opcje.lista : null;
    indeksPodgladu = Number(opcje.indeks) || 0;
    const gdzie = $('img-viewer-gdzie');
    if (gdzie) {
      gdzie.hidden = !(listaPodgladu && opcje.miejsce);
      if (!gdzie.hidden) {
        $('img-viewer-miejsce').textContent = opcje.miejsce;
        $('img-viewer-licznik').textContent = t('photo.licznik', { i: opcje.i || 1, n: opcje.n || 1 });
      }
    }
    for (const [id, kier] of [['img-viewer-prev', -1], ['img-viewer-next', 1]]) {
      const b = $(id);
      if (b) b.hidden = !listaPodgladu || !listaPodgladu[indeksPodgladu + kier];
    }
    // Sąsiedzi naprzód – przesunięcie nie czeka na sieć, a dalsze zdjęcia nie ruszają.
    if (listaPodgladu) {
      for (const kier of [-1, 1]) {
        const s = listaPodgladu[indeksPodgladu + kier];
        if (s && s.src) { const wstepne = new Image(); wstepne.decoding = 'async'; wstepne.src = s.src; }
      }
    }

    box.style.display = '';
    imageViewerSrc = src;
  }

  /** Następne / poprzednie zdjęcie listy w podglądzie. */
  function przesunPodglad(kier) {
    if (!listaPodgladu) return false;
    const nowy = indeksPodgladu + kier;
    const w = listaPodgladu[nowy];
    if (!w) return false;
    openImageViewer(w.src, { ...w, lista: listaPodgladu, indeks: nowy });
    return true;
  }

  function closeImageViewer() {
    $('img-viewer').style.display = 'none';
    const img = $('img-viewer-img');
    img.onerror = null;
    img.removeAttribute('src');
    const zrodlo = $('img-viewer-source');
    if (zrodlo) zrodlo.hidden = true;
    const podpis = $('img-viewer-caption');
    if (podpis) { podpis.textContent = ''; podpis.hidden = true; }
    const gdzie = $('img-viewer-gdzie');
    if (gdzie) gdzie.hidden = true;
    for (const id of ['img-viewer-prev', 'img-viewer-next']) { const b = $(id); if (b) b.hidden = true; }
    listaPodgladu = null;
    imageViewerSrc = '';
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    const otwarty = () => { const box = $('img-viewer'); return Boolean(box && box.style.display !== 'none' && listaPodgladu); };
    document.addEventListener('keydown', (e) => {
      if (!otwarty()) return;
      if (e.key === 'ArrowRight' && przesunPodglad(1)) e.preventDefault();
      if (e.key === 'ArrowLeft' && przesunPodglad(-1)) e.preventDefault();
    });
    let dotyk = null;
    document.addEventListener('touchstart', (e) => {
      if (!otwarty() || e.touches.length !== 1) { dotyk = null; return; }
      dotyk = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!dotyk || !otwarty()) return;
      const k = e.changedTouches[0];
      const dx = k.clientX - dotyk.x;
      const dy = k.clientY - dotyk.y;
      dotyk = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) przesunPodglad(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  let imageViewerSrc = '';

  /** Zapisz oglądany obraz na dysk – działa i dla dataURL, i dla adresu z serwera. */
  async function downloadViewedImage() {
    if (!imageViewerSrc) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    let href = imageViewerSrc;
    let revoke = '';
    if (!href.startsWith('data:')) {
      // Obraz z bazy wiedzy leci przez /api/kb/raw – `download` zadziała tylko
      // na tym samym pochodzeniu, więc pobieramy go i zapisujemy z pamięci.
      try {
        const blob = await (await fetch(imageViewerSrc)).blob();
        href = URL.createObjectURL(blob);
        revoke = href;
      } catch { /* zostaw oryginalny adres – przeglądarka otworzy go w karcie */ }
    }
    const a = document.createElement('a');
    a.href = href;
    a.download = `cosmos-${stamp}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 10000);
  }

  return {
    runPanel,
    photosGrid,
    pasekZdjec,
    przesunPodglad,
    stopkaArchiwum,
    naKafelek,
    openTextViewer,
    openImageViewer,
    closeImageViewer,
    downloadViewedImage,
  };
}

if (typeof window !== 'undefined') window.utworzWidoki = utworzWidoki;
if (typeof module !== 'undefined') module.exports = { utworzWidoki };

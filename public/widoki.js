/* ============================================================
   BUDOWNICZOWIE WIDOKU — dane wchodzą, element DOM wychodzi

   Wydzielone z `app.js`, który przy 7697 liniach był największym plikiem
   projektu i miejscem, gdzie mieszkało wszystko naraz: stan, zapisy,
   obsługa zdarzeń i budowanie DOM-u.

   Podział idzie po jednej granicy i tylko po niej: TU są funkcje, które
   dostają dane i oddają gotowy element, nie sięgając po stan aplikacji.
   Siatka miniatur, panel wyniku programu, podglądy obrazu i tekstu.
   Wszystko, co czyta albo zmienia stan rozmowy, zostaje w `app.js`.

   Dzięki temu granica jest sprawdzalna, a nie umowna: gdyby któraś z tych
   funkcji zaczęła sięgać po `conv` albo `settings`, nie miałaby skąd —
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
 * @returns {object} { runPanel, photosGrid, stopkaArchiwum, naKafelek,
 *                     openTextViewer, openImageViewer, closeImageViewer }
 */
function utworzWidoki(z) {
  const {
    t, readJsonSafe, saveConversations, renderMessages,
    msgPhotos, msgDalej, PORCJA_ARCHIWUM,
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
           pisze model, więc jego wyjście jest treścią niezaufaną — wstrzyknięte
           do DOM-u wykonałoby skrypt w kontekście Cosmosa. W <img> nie wykona. */
        const img = document.createElement('img');
        img.className = 'run-svg';
        img.alt = plik.name;
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(plik.text)));
        box.appendChild(img);
      } else {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'doc-chip';
        chip.textContent = `📄 ${plik.name}`;
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
   *  strony źródłowej — zdjęcie z internetu bez źródła jest bezwartościowe.
   */
  function photosGrid(photos) {
    const wrap = document.createElement('div');
    wrap.className = 'photo-grid';
    for (const p of photos) {
      const a = document.createElement('a');
      a.className = 'photo-tile';
      a.href = p.source || p.full || '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = [p.title, p.zrodlo, p.licencja].filter(Boolean).join(' · ');
      const img = document.createElement('img');
      /* Adres własny (np. z archiwum) bierzemy wprost — proxy miniatur jest
         od CUDZYCH hostów i tylko by tu przeszkadzało. */
      const wlasny = /^\//.test(p.thumb || '');
      img.src = wlasny ? p.thumb : `/api/search/thumb?u=${encodeURIComponent(p.thumb)}`;
      img.alt = p.title || t('photo.found');
      img.loading = 'lazy';

      /* Kliknięcie otwiera podgląd W COSMOSIE, nie nową kartę.
         Marcin: „lepiej by było gdybym mógł je kliknąć żeby się rozwinęły
         w większym ekranie z wyższą rozdzielczością i wtedy z możliwością
         przejścia do źródła". Wcześniej kliknięcie wyrzucało od razu na obcą
         stronę i nie dawało nawet obejrzeć zdjęcia.

         `href` zostaje prawdziwy, więc środkowy przycisk myszy, Ctrl+klik
         i „otwórz w nowej karcie" dalej prowadzą do źródła — odbieranie tego
         byłoby zamianą jednego ograniczenia na drugie. */
      a.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        openImageViewer(p.podglad || p.full || p.thumb, {
          zapas: p.podglad ? '' : (wlasny ? p.thumb : `/api/search/thumb?u=${encodeURIComponent(p.thumb)}`),
          zrodlo: p.podglad ? '' : (p.source || ''),
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
          // może pobrać obrazek sama — dla niej to zwykły zewnętrzny zasób.
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
      // Skąd zdjęcie i na jakiej licencji — dla kogoś, kto montuje film, to nie
      // ozdobnik, tylko odpowiedź na pytanie „czy wolno mi tego użyć".
      let skad = p.zrodlo || '';
      if (!skad) { try { skad = new URL(p.source).hostname.replace(/^www\./, ''); } catch { skad = ''; } }
      cap.textContent = [skad, p.licencja].filter(Boolean).join(' · ') || p.title || '';
      a.append(img, cap);
      wrap.appendChild(a);
    }
    return wrap;
  }

  /* Ile miniatur dobieramy jednym kliknięciem. Każda to osobne zapytanie do
     OneDrive w chwili wyświetlenia, więc porcja jest kompromisem: za mała każe
     klikać bez końca, za duża zamraża telefon na kilkanaście sekund. */

  /** Pasek pod siatką: „24 z 311" i przycisk po następną porcję.
   *
   *  Marcin: „chciałbym móc przejrzeć wszystkie zdjęcia z wyszukania, a nie
   *  mieć informację typu »pokazałem Ci 20, ale jest 311«". Model tego nie
   *  załatwi — on dostaje próbkę tekstową i ma rację, że jej nie przekracza.
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

    if (d.pomin >= d.razem) return pasek;   // wszystko już na ekranie — sam licznik

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
           którą właśnie ogląda — a im dłużej by przeglądał, tym dalej od niej.
           Przy przeglądaniu trzystu zdjęć to jest różnica między narzędziem
           a udręką. */
        const siatka = pasek.previousElementSibling;
        const swieze = photosGrid(kafelki);
        if (siatka && siatka.classList.contains('photo-grid')) {
          while (swieze.firstChild) siatka.appendChild(swieze.firstChild);
          pasek.replaceWith(stopkaArchiwum(m));
        } else {
          // Siatki nie ma tam, gdzie się jej spodziewamy — wtedy lepiej
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
   *  porcja, i każda dobrana potem — rozjechanie się tych dwóch dawałoby
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
   * kilka razy większa — bez tego okna nie dało się jej ani obejrzeć, ani zapisać.
   */
  /** Podgląd tekstu załącznika — bez biblioteki, bez zapisu, tylko do wglądu.
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
   *  @param {object} opcje `zapas` — czym podmienić, gdy `src` się nie wczyta
   *                        (pełny plik bywa na hoście, który odmawia);
   *                        `zrodlo` — strona, z której zdjęcie pochodzi;
   *                        `tytul`, `opis` — podpis pod obrazem
   */
  function openImageViewer(src, opcje = {}) {
    const box = $('img-viewer');
    const img = $('img-viewer-img');
    const zrodlo = $('img-viewer-source');
    const podpis = $('img-viewer-caption');

    /* Pełny plik idzie z obcego hosta i czasem nie dojedzie — wtedy zamiast
       pustego czarnego ekranu pokazujemy to, co już było widać w siatce. */
    img.onerror = null;
    if (opcje.zapas && opcje.zapas !== src) {
      img.onerror = () => { img.onerror = null; img.src = opcje.zapas; imageViewerSrc = opcje.zapas; };
    }
    img.src = src;
    img.alt = opcje.tytul || '';

    if (zrodlo) {
      zrodlo.hidden = !opcje.zrodlo;
      if (opcje.zrodlo) zrodlo.href = opcje.zrodlo;
    }
    if (podpis) {
      const tekst = [opcje.tytul, opcje.opis].filter(Boolean).join(' · ');
      podpis.textContent = tekst;
      podpis.hidden = !tekst;
    }

    box.style.display = '';
    imageViewerSrc = src;
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
    imageViewerSrc = '';
  }

  let imageViewerSrc = '';

  /** Zapisz oglądany obraz na dysk — działa i dla dataURL, i dla adresu z serwera. */
  async function downloadViewedImage() {
    if (!imageViewerSrc) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    let href = imageViewerSrc;
    let revoke = '';
    if (!href.startsWith('data:')) {
      // Obraz z bazy wiedzy leci przez /api/kb/raw — `download` zadziała tylko
      // na tym samym pochodzeniu, więc pobieramy go i zapisujemy z pamięci.
      try {
        const blob = await (await fetch(imageViewerSrc)).blob();
        href = URL.createObjectURL(blob);
        revoke = href;
      } catch { /* zostaw oryginalny adres — przeglądarka otworzy go w karcie */ }
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

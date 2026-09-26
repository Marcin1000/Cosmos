/* ============================================================
   KAMERA NA ŻYWO – podgląd, detekcja YOLO, sylwetka, zdarzenia percepcji

   Źródło: kamera przeglądarki (<video>) albo Kinect przez zmysły (<img>,
   klatki po HTTP – Kinect nie jest kamerą UVC). Co kilka sekund klatka idzie
   do /api/senses/detect, a zmiana sceny – do strumienia zdarzeń, z którego
   czat bierze KONTEKST PERCEPCJI. Panel dopasowuje proporcję do strumienia.

   Wydzielone z app.js (runda 3). `settings`, `senses` i `cameraFacing` app.js
   przypisuje na nowo, więc przychodzą jako funkcje – wartość z chwili startu
   byłaby nieaktualna.
   ============================================================ */
function utworzKamere(z) {
  const {
    settings, senses, cameraFacing, odswiezPlan,   // funkcje zwracające bieżącą wartość
    $, readJsonSafe, getMedia, videoConstraints, hasMultipleCameras, swapStream,
  } = z;

  let liveStream = null;
  let liveTimer = null;
  let livePrevObjects = '';
  let liveLastObjects = [];
  let liveLastAutoSnap = 0;
  let liveLastPose = 0;
  let livePrevPose = '';

  function updateLiveRec() {
    const rec = $('live-rec');
    if (rec) rec.style.display = (liveStream && settings().timeMachine) ? '' : 'none';
  }

  async function captureTimelineSnapshot() {
    const video = $('live-video');
    if (!video.videoWidth) return false;
    const cap = document.createElement('canvas');
    const scale = Math.min(1, 800 / video.videoWidth);
    cap.width = Math.round(video.videoWidth * scale);
    cap.height = Math.round(video.videoHeight * scale);
    cap.getContext('2d').drawImage(video, 0, 0, cap.width, cap.height);
    try {
      await fetch('/api/timeline', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: cap.toDataURL('image/jpeg', 0.7), objects: [...new Set(liveLastObjects)] }),
      });
      return true;
    } catch { return false; }
  }

  function posLabel(cx, w) {
    const r = cx / w;
    return r < 0.34 ? t('posLeft') : r > 0.66 ? t('posRight') : t('posCenter');
  }

  // Kinect nie jest kamerą UVC, więc przeglądarka go nie widzi i getUserMedia
  // nigdy go nie zwróci. Jego klatki pobieramy po HTTP z usługi zmysłów
  // i pokazujemy w zwykłym <img> zamiast w <video>.
  let liveSource = localStorage.getItem('cosmos.liveSource') || 'camera';
  let liveImgTimer = null;

  function liveIsKinect() { return liveSource.startsWith('kinect'); }

  /** Element, z którego bierzemy piksele: <video> dla kamery, <img> dla Kinecta. */
  function liveMedia() { return liveIsKinect() ? $('live-image') : $('live-video'); }

  function liveMediaSize() {
    const el = liveMedia();
    const r = liveIsKinect()
      ? { w: el.naturalWidth, h: el.naturalHeight }
      : { w: el.videoWidth, h: el.videoHeight };
    /* Skoro i tak znamy wymiary strumienia, niech scena ma JEGO proporcję.
       Wpisane na stałe 4:3 przy kamerze 16:9 dawało czarne pasy nad i pod
       kadrem – u Marcina jedna czwarta wysokości panelu zmarnowana, i to
       wtedy, gdy panel i tak nie mieścił się na ekranie. */
    if (r.w > 0 && r.h > 0) {
      const panel = $('live-panel');
      if (panel) {
        panel.style.setProperty('--live-ar', `${r.w} / ${r.h}`);
        panel.style.setProperty('--live-arn', String(r.w / r.h));
      }
    }
    dopasujPanelKamery();
    return r;
  }

  /** Podaj CSS-owi ZMIERZONĄ wysokość wszystkiego poza obrazem.
   *
   *  Szerokość powiększonego panelu liczy się z dostępnej wysokości, więc
   *  trzeba wiedzieć, ile tej wysokości zabierają paski: nagłówek, wybór
   *  źródła, status, pudełko nastaw i przycisk migawki. Wcześniej stała tam
   *  liczba 220 wpisana w CSS – i zestarzała się przy pierwszej nowej rzeczy
   *  w panelu. Zmierzone nie starzeje się nigdy.
   *
   *  Pomiar jest sprzężony: szerokość zależy od wysokości pasków, a wysokość
   *  pasków od szerokości (status się zawija). Nie rozwiązujemy tego układu –
   *  po prostu mierzymy ponownie przy każdej zmianie, a że zmiany są rzadkie
   *  i drobne, dochodzi do swojego miejsca po jednym, najwyżej dwóch krokach.
   */
  function dopasujPanelKamery(krok) {
    const runda = typeof krok === 'number' ? krok : 0;   // z `resize` przychodzi Event
    const panel = $('live-panel');
    const scena = $('live-stage');
    const dol = $('live-body');
    if (!panel || !scena || panel.style.display === 'none') return;
    const przed = panel.style.getPropertyValue('--live-chrome');
    let paski = panel.getBoundingClientRect().height - scena.getBoundingClientRect().height;
    /* DOLICZ TO, CO JUŻ NIE MIEŚCI SIĘ W DOLNEJ CZĘŚCI.
     *
     *  Bez tego pomiar zjadał własny ogon. `.live-body` kurczy się i przewija,
     *  więc gdy panel dobijał do wysokości okna, mierzyliśmy dół JUŻ ŚCIŚNIĘTY.
     *  Wychodziło z tego, że paski są niskie, więc obrazowi wolno być duży,
     *  więc dół musi się ścisnąć jeszcze bardziej – i układ zastygał dokładnie
     *  w tym, co Marcin opisał: „okno podglądu jest duże, a pod nim małe
     *  okienko przesuwalne. To nie wygląda dobrze i nie jest użyteczne".
     *
     *  `scrollHeight - clientHeight` to wysokość schowana za paskiem przewijania,
     *  czyli różnica między tym, ile dół ZAJMUJE, a ile POTRZEBUJE. Dopiero
     *  potrzeba jest właściwą liczbą do liczenia szerokości panelu. */
    if (dol) paski += Math.max(0, dol.scrollHeight - dol.clientHeight);
    if (paski > 0) panel.style.setProperty('--live-chrome', `${Math.round(paski)}px`);

    /* Osobno to, co leży NAD obrazem: nagłówek i wybór źródła. W układzie
       dwukolumnowym (powiększony panel na szerokim ekranie) tylko te dwa paski
       zabierają obrazowi wysokość – reszta stoi w kolumnie obok. Liczenie tam
       z pełnego `--live-chrome` ścinałoby obraz o wysokość czegoś, co go już
       nie dotyka. */
    let gora = 0;
    for (const el of panel.querySelectorAll('.live-head, .live-source')) {
      gora += el.getBoundingClientRect().height;
    }
    if (gora > 0) panel.style.setProperty('--live-chrome-gora', `${Math.round(gora)}px`);

    /* JEDEN POMIAR NIE WYSTARCZA, gdy układ zmienia się skokowo.
     *
     *  Szerokość zależy od wysokości pasków, a wysokość pasków od szerokości
     *  (status i opisy się zawijają). Przy drobnej zmianie jedno przejście
     *  trafia dostatecznie blisko, ale przy przejściu między układem
     *  jedno- i dwukolumnowym skacze wszystko naraz: dolna część przenosi się
     *  spod obrazu na bok albo z powrotem. Pierwsza runda mierzy wtedy stan
     *  sprzed przebudowy i panel zastyga w połowie drogi – złapał to zestaw
     *  `panel-kamery-miesci` na zwinięciu powiększonego panelu z powrotem
     *  do rogu.
     *
     *  Więc powtarzamy, dopóki liczba się zmienia. Zbieżne jest to dlatego,
     *  że każda kolejna runda startuje z układu bliższego docelowemu; limit
     *  rund jest bezpiecznikiem na wypadek układu, który oscyluje.
     *
     *  Rund jest sześć, nie trzy. Przy trzech zestaw złapał układ zatrzymany
     *  w pół drogi: panel 1440×700 z rozwiniętymi nastawami kończył z dolną
     *  częścią wystającą o 50 px, choć miał jeszcze 111 px szerokości do
     *  oddania. Każda runda zwęża panel, przez co tekst zawija się na więcej
     *  wierszy i paski rosną – a więc trzeba jeszcze jednej rundy. Sześć
     *  wystarcza z zapasem, a kosztuje kilka klatek przy zdarzeniu, które
     *  zdarza się przy otwarciu panelu i przy zmianie rozmiaru okna. */
    if (runda < 6 && panel.style.getPropertyValue('--live-chrome') !== przed) {
      requestAnimationFrame(() => dopasujPanelKamery(runda + 1));
    }
  }
  window.addEventListener('resize', dopasujPanelKamery);

  /* Aktualna treść paska statusu. Trzymana w zmiennej, a nie odczytywana
     z DOM-u, bo pasek bywa UKRYTY – a wtedy `textContent` mówiłby o elemencie,
     którego nikt nie widzi. Dokładanie sylwetki i rozpoznanych rzeczy dopisuje
     się do tej wartości. */
  let statusKamery = '';

  /** Ustaw pasek statusu pod obrazem i to, co chowa się pod ⓘ w nagłówku.
   *
   *  PODZIAŁ JEST NA STAN I NA WYJAŚNIENIE, nie na krótkie i długie.
   *  W pasku stoi to, co zmienia się na bieżąco i po co się na niego patrzy –
   *  „person po lewej", „nic nie wykryto". Wyjaśnienia w rodzaju „uruchom
   *  `python service.py` na komputerze z GPU" to instrukcja do przeczytania
   *  raz w życiu; wisząc nad podglądem zabierała jedną trzecią panelu
   *  na telefonie. Idzie więc pod ⓘ w rogu nagłówka, gdzie nie kosztuje
   *  ani jednej linijki.
   *
   *  Pusty `tekst` UKRYWA pasek zamiast zostawiać pustą ramkę z obramowaniem.
   *
   *  @param {string} tekst  bieżący stan; pusty = pasek znika
   *  @param {string} [szczegoly] wyjaśnienie chowane pod ⓘ; puste = ⓘ znika
   */
  function ustawStatusKamery(tekst, szczegoly = '') {
    statusKamery = String(tekst || '');
    const el = $('live-status');
    if (el) {
      el.textContent = statusKamery;
      el.hidden = !statusKamery;
    }
    const info = $('live-info');
    const dymek = $('live-info-box');
    if (info && dymek) {
      info.hidden = !szczegoly;
      dymek.textContent = szczegoly;
      if (!szczegoly) pokazDymekKamery(false);
    }
    dopasujPanelKamery();
  }

  /** Status „nic się jeszcze nie wydarzyło" – jeden dla wszystkich miejsc,
   *  które go potrzebują.
   *
   *  Wcześniej każde z nich pisało `'…'` z ręki, także przełącznik przód/tył.
   *  Wielokropek znaczy „czekam na pierwsze rozpoznanie" i ma sens WYŁĄCZNIE
   *  przy działających zmysłach. Przy wyłączonych nie miał go co nadpisać,
   *  więc po przełączeniu kamery zostawał na stałe pasek z samą kropką
   *  i kreską obramowania nad nią. Marcin: „przy zmianie kamer pojawia się
   *  dziwna kreska pod podglądem i później nie znika".
   */
  function ustawStatusSpoczynkowy() {
    const zmyslyDzialaja = senses().online && senses().caps.yolo;
    ustawStatusKamery(zmyslyDzialaja ? '…' : '', zmyslyDzialaja ? '' : t('liveNoSenses'));
  }

  /** Pokaż albo schowaj dymek ⓘ. Dymek leży NAD treścią panelu, więc jego
   *  pojawienie się niczego nie przesuwa – o to w tej zmianie chodziło. */
  function pokazDymekKamery(widoczny) {
    const info = $('live-info');
    const dymek = $('live-info-box');
    if (!info || !dymek) return;
    dymek.hidden = !widoczny;
    info.setAttribute('aria-expanded', widoczny ? 'true' : 'false');
    info.classList.toggle('aktywny', widoczny);
  }

  {
    const info = $('live-info');
    const dymek = $('live-info-box');
    if (info && dymek) {
      /* Dotknięcie PRZEŁĄCZA na stałe, najechanie tylko podgląda.
         Na telefonie nie ma najeżdżania, więc samo `:hover` zostawiłoby
         treść nieosiągalną; na desktopie samo klikanie byłoby zbędnym
         krokiem, skoro kursor i tak tam jest. Dlatego oba, a `przypiety`
         pilnuje, żeby zjechanie kursorem nie zamknęło czegoś, co użytkownik
         otworzył celowo. */
      let przypiety = false;
      info.addEventListener('click', (e) => {
        e.stopPropagation();
        /* Przełączamy WŁASNY stan, a nie widoczność dymka. Pierwsza wersja
           czytała `dymek.hidden` – i wywracała się na tym, że kliknięcie myszą
           poprzedza `mouseenter`, który dymek już pokazał. Klik odczytywał więc
           „otwarty" i natychmiast go zamykał. Na telefonie działałoby (nie ma
           najeżdżania), na myszy nie – czyli usterka widoczna tylko na jednym
           z dwóch sposobów obsługi. */
        przypiety = !przypiety;
        pokazDymekKamery(przypiety);
      });
      info.addEventListener('mouseenter', () => pokazDymekKamery(true));
      info.addEventListener('mouseleave', () => { if (!przypiety) pokazDymekKamery(false); });
      // Kliknięcie gdziekolwiek indziej zamyka – tak jak każdy inny dymek.
      document.addEventListener('click', () => {
        if (!przypiety) return;
        przypiety = false;
        pokazDymekKamery(false);
      });
      dymek.addEventListener('click', (e) => e.stopPropagation());
      info.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        przypiety = false;
        pokazDymekKamery(false);
      });
    }
  }

  /* Wymiary strumienia bywają gotowe dopiero po chwili od podłączenia, więc
     poza pomiarem przy starcie podglądu słuchamy też zdarzeń samych elementów.
     Rejestracja jest JEDNORAZOWA, przy wczytaniu skryptu, a nie przy każdym
     otwarciu panelu – inaczej przy trzecim włączeniu kamery ten sam pomiar
     wisiałby na trzech nasłuchach naraz.

     `addEventListener`, nie `img.onload =`: pole `onload` obrazka należy do
     pętli pojedynczych klatek Kinecta i podmiana rozbiłaby jej awaryjny tryb. */
  for (const [id, zdarzenie] of [['live-video', 'loadedmetadata'], ['live-image', 'load']]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(zdarzenie, () => liveMediaSize());
  }

  let liveStreaming = false;
  const liveFps = 15;

  function stopKinectStream() {
    liveStreaming = false;
    clearTimeout(liveImgTimer);
    liveImgTimer = null;
    const img = $('live-image');
    img.onload = img.onerror = null;
    img.removeAttribute('src');
  }

  /** Podłącz strumień MJPEG z Kinecta.
   *
   * Jedno połączenie zamiast żądania na klatkę. Przy drodze telefon → VPS →
   * Tailscale → komputer domowy sam obieg zjadał ćwierć sekundy, co dawało
   * 3–4 klatki na sekundę niezależnie od czujnika. W strumieniu klatki lecą
   * jedna za drugą, a przeglądarka odtwarza `multipart/x-mixed-replace`
   * natywnie w zwykłym <img>.
   *
   * Gdyby strumień padł (np. stara wersja usługi zmysłów), wracamy do
   * pojedynczych klatek – wolniej, ale działa.
   */
  function startKinectStream() {
    const stream = liveSource === 'kinect-depth' ? 'depth' : 'color';
    const img = $('live-image');
    liveStreaming = true;
    let fellBack = false;

    const singleFrames = () => {
      fellBack = true;
      const next = (delay) => {
        if (!liveStreaming) return;
        liveImgTimer = setTimeout(() => {
          if (liveStreaming) img.src = `/api/kinect/frame?stream=${stream}&t=${Date.now()}`;
        }, delay);
      };
      img.onload = () => next(120);
      img.onerror = () => { ustawStatusKamery(t('live.kinectErr')); next(2000); };
      img.src = `/api/kinect/frame?stream=${stream}&t=${Date.now()}`;
    };

    img.onload = null;
    img.onerror = () => { if (!fellBack) singleFrames(); };
    img.src = `/api/kinect/stream?stream=${stream}&fps=${liveFps}&t=${Date.now()}`;
  }

  async function startLive() {
    $('live-source').value = liveSource;
    const video = $('live-video');
    const img = $('live-image');

    // Panel otwieramy ZAWSZE, zanim spróbujemy pobrać obraz. Inaczej przy
    // niedostępnej kamerze nie dałoby się dosięgnąć listy źródeł – a to właśnie
    // tam jest Kinect, który kamery przeglądarki w ogóle nie potrzebuje.
    $('live-panel').style.display = '';
    // Plan pokazujemy tylko wtedy, gdy wiemy GDZIE – bez współrzędnych
    // nie ma z czego policzyć pozycji Słońca, a pusty panel myli.
    fetch('/api/location').then((r) => r.json())
      .then((d) => { $('plan-box').hidden = !(d.wspolrzedne && d.wspolrzedne.lat); })
      .catch(() => {});
    applyLiveExpanded();
    updateLiveRec();

    if (liveIsKinect()) {
      video.hidden = true;
      img.hidden = false;
      startKinectStream();
    } else {
      try {
        liveStream = await getMedia(videoConstraints(cameraFacing()));
      } catch (err) {
        img.hidden = true;
        video.hidden = false;
        ustawStatusKamery(`${t('cam.err')} ${err.message}`);
        return;                       // panel zostaje otwarty – można zmienić źródło
      }
      img.hidden = true;
      video.hidden = false;
      video.srcObject = liveStream;
      await video.play().catch(() => {});
    }
    /* PROPORCJĘ SCENY USTAWIAMY OD RAZU, NIE DOPIERO PRZY ROZPOZNAWANIU.
     *
     *  `liveMediaSize()` – jedyne miejsce, które czyta wymiary strumienia
     *  i podaje je CSS-owi – wisiało wyłącznie w pętli `liveDetect()`.
     *  A `liveDetect()` ma co robić tylko wtedy, gdy działają zmysły z YOLO.
     *  Przy wyłączonym komputerze domowym scena zostawała więc na domyślnym
     *  4:3, choć telefon podaje kadr 9:16 – i cały podgląd kurczył się do
     *  paska pośrodku, obłożonego czarnymi pasami z obu stron. Marcin:
     *  „na mobile to cały czas nie wygląda dobrze".
     *
     *  Wymiary bywają gotowe dopiero po chwili, dlatego i teraz, i na
     *  `loadedmetadata` (wideo) albo `load` (klatka z Kinecta). Sam podgląd
     *  z rozpoznawaniem nie ma nic wspólnego i nie ma prawa od niego zależeć. */
    liveMediaSize();
    // Przełącznik przód/tył tylko przy kamerze przeglądarki i tylko wtedy,
    // gdy jest co przełączać. Kinect ma jeden obiektyw.
    $('live-flip').hidden = liveIsKinect() || !(await hasMultipleCameras());

    ustawStatusSpoczynkowy();
    liveTimer = setInterval(liveDetect, 3000);
    setTimeout(liveDetect, 800);
  }

  function stopLive() {
    clearInterval(liveTimer); liveTimer = null;
    stopKinectStream();
    if (liveStream) { liveStream.getTracks().forEach((t) => t.stop()); liveStream = null; }
    $('live-video').srcObject = null;
    $('live-panel').style.display = 'none';
    $('plan-box').hidden = true;
    // Dymek ⓘ nie może przetrwać zamknięcia panelu – przy następnym otwarciu
    // wisiałby otwarty nad obrazem, opisując stan sprzed kilku godzin.
    ustawStatusKamery('');
    livePrevObjects = '';
  }

  async function liveDetect() {
    const media = liveMedia();
    const { w, h } = liveMediaSize();
    if (!w || !h) return;
    const overlay = $('live-overlay');
    overlay.width = w;
    overlay.height = h;
    const octx = overlay.getContext('2d');
    octx.clearRect(0, 0, overlay.width, overlay.height);

    const cap = document.createElement('canvas');
    cap.width = w; cap.height = h;
    cap.getContext('2d').drawImage(media, 0, 0);

    /* NASTAWY LICZĄ SIĘ BEZ ZMYSŁÓW. Wcześniej ten blok stał POD wyjściem
       „brak YOLO", więc przy wyłączonym komputerze domowym plan nigdy się nie
       wypełniał: pudełko było widoczne (bo lokalizacja ustawiona) i pokazywało
       w kółko myślnik. Marcin zobaczył trzy listy rozwijane i kreskę pod nimi,
       i słusznie zapytał, czy tak miało być.
       Do policzenia ekspozycji wystarczy położenie Słońca i jasność KLATKI –
       jedno liczy serwer, drugie przeglądarka. Karta graficzna w domu nie ma
       z tym nic wspólnego. */
    odswiezPlan()(cap);   // getter: plener powstaje w app.js po kamerze

    if (!(senses().online && senses().caps.yolo)) return; // sam podgląd bez detekcji

    let data;
    try {
      const res = await fetch('/api/detect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: cap.toDataURL('image/jpeg', 0.7) }),
      });
      data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data.error || 'detect');
    } catch { return; }

    const objs = data.objects || [];
    liveLastObjects = objs.map((o) => o.label);
    octx.strokeStyle = '#9db9ff'; octx.lineWidth = Math.max(2, overlay.width / 300);
    octx.font = `${Math.max(14, overlay.width / 40)}px sans-serif`; octx.fillStyle = '#9db9ff';
    for (const o of objs) {
      const [x1, y1, x2, y2] = o.box;
      octx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      octx.fillText(o.label, x1 + 4, Math.max(14, y1 - 4));
    }
    // Postawę doklejamy przy KAŻDYM cyklu, nie tylko w chwili pomiaru –
    // inaczej następna detekcja nadpisuje status i sylwetka miga na ułamek
    // sekundy. Zmienia się wolno, więc ostatnia znana jest nadal prawdziwa.
    const ogon = livePrevPose ? ` · ${t('live.sylwetka')} ${livePrevPose}` : '';
    ustawStatusKamery((objs.length
      ? objs.map((o) => `${o.label} (${posLabel((o.box[0] + o.box[2]) / 2, overlay.width)})`).join(', ')
      : t('liveNothing')) + ogon);

    // zdarzenie percepcji z pozycją – tylko gdy zestaw obiektów się zmienił
    const sig = objs.map((o) => o.label).sort().join(',');
    if (sig && sig !== livePrevObjects) {
      livePrevObjects = sig;
      const withPos = objs.map((o) => `${o.label} (${posLabel((o.box[0] + o.box[2]) / 2, overlay.width)})`).join(', ');
      fetch('/api/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'kamera', summary: `widzę w kadrze: ${withPos}` }),
      }).catch(() => {});

      // Nauka: czy w kadrze jest coś, co Cosmos już zna?
      fetch('/api/lessons/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: liveLastObjects.join(', '), objects: liveLastObjects }),
      }).then((r) => r.json()).then((d) => {
        const known = (d.matches || []).map((m) => m.label);
        if (known.length) {
          ustawStatusKamery(`${statusKamery} · ✦ ${known.join(', ')}`);
          fetch('/api/events', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'nauka', summary: `rozpoznaję (nauczone): ${known.join(', ')}` }),
          }).catch(() => {});
        }
      }).catch(() => {});

      // Digital Time Machine: automatyczny zapis migawki przy zmianie sceny (min. 30 s)
      if (settings().timeMachine && Date.now() - liveLastAutoSnap > 30000) {
        liveLastAutoSnap = Date.now();
        captureTimelineSnapshot();
      }
    }

    // Sylwetka: postawa człowieka w kadrze. Doklejona do TEJ pętli, nie do
    // własnej – MediaPipe kosztuje, a i tak mamy już gotową klatkę. Pytamy
    // rzadziej niż o obiekty (co ~3 s), bo postawa zmienia się wolno.
    if (senses().caps.mediapipe && objs.some((o) => o.label === 'person')
        && Date.now() - liveLastPose > 3000) {
      liveLastPose = Date.now();
      try {
        const res = await fetch('/api/pose', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: cap.toDataURL('image/jpeg', 0.7) }),
        });
        const poz = await readJsonSafe(res);
        if (res.ok && poz.present && poz.summary !== livePrevPose) {
          /* Podmieniamy ogon, nie doklejamy. Doklejanie dawało w chwili ZMIANY
             postawy linijkę z dwiema: starą (wpisaną wyżej jako `ogon`) i nową.
             Widać to było przez ułamek sekundy i wyglądało jak usterka
             rozpoznawania, a było usterką składania napisu. */
          const znacznik = ` · ${t('live.sylwetka')} `;
          const bezOgona = statusKamery.includes(znacznik) ? statusKamery.slice(0, statusKamery.indexOf(znacznik)) : statusKamery;
          livePrevPose = poz.summary;
          ustawStatusKamery(`${bezOgona}${znacznik}${poz.summary}`);
          // Człowiek wyszedł z kadru → przestajemy twierdzić, że stoi.
          // Do kontekstu rozmowy: model ma wiedzieć, czy stoisz, czy siedzisz.
          fetch('/api/events', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'sylwetka', summary: poz.summary }),
          }).catch(() => {});
        }
      } catch { /* zmysły offline albo brak MediaPipe */ }
    } else if (!objs.some((o) => o.label === 'person')) {
      livePrevPose = '';
    }
  }

  // O tym, czy panel jest otwarty, decyduje jego widoczność – nie obecność
  // strumienia. Przy źródle Kinect strumienia z kamery nie ma wcale.
  $('live-btn').addEventListener('click', () => {
    const open = $('live-panel').style.display !== 'none';
    open ? stopLive() : startLive();
  });
  $('live-close').addEventListener('click', stopLive);

  // Powiększenie zapamiętujemy – kto raz chce duży podgląd, zwykle chce go zawsze.
  function applyLiveExpanded() {
    const on = localStorage.getItem('cosmos.liveExpanded') === '1';
    $('live-panel').classList.toggle('expanded', on);
    $('live-expand').title = t(on ? 'live.shrink' : 'live.expand');
    // Powiększenie zmienia szerokość, ta zmienia zawijanie statusu, a to
    // wysokość pasków – czyli dokładnie liczbę, z której liczy się szerokość.
    dopasujPanelKamery();
  }
  $('live-flip').addEventListener('click', async () => {
    const next = cameraFacing() === 'environment' ? 'user' : 'environment';
    const video = $('live-video');
    const r = await swapStream(liveStream, next, (s) => {
      liveStream = s;
      video.srcObject = s;
      if (s) video.play().catch(() => {});
    });
    if (r.ok) ustawStatusSpoczynkowy();
    else ustawStatusKamery(`${t('cam.err')} ${r.error.message}`);
  });
  $('live-expand').addEventListener('click', () => {
    const on = $('live-panel').classList.contains('expanded');
    localStorage.setItem('cosmos.liveExpanded', on ? '0' : '1');
    applyLiveExpanded();
  });
  $('live-source').addEventListener('change', async (e) => {
    liveSource = e.target.value;
    localStorage.setItem('cosmos.liveSource', liveSource);
    // Przełączenie źródła to zamknięcie jednego strumienia i otwarcie drugiego –
    // inaczej kamera zostałaby zajęta albo Kinect odpytywany w tle.
    const wasOpen = $('live-panel').style.display !== 'none';
    stopLive();
    if (wasOpen) await startLive();
  });

  /** Zatrzymaj cykliczne wykrywanie (YOLO co 3 s), zostawiając podgląd.
   *  Dla pomiarów układu: każdy takt wpisuje proporcję prawdziwego strumienia. */
  function wstrzymajWykrywanie() { clearInterval(liveTimer); liveTimer = null; }

  // ręczna migawka do osi czasu (Digital Time Machine)
  $('live-snapshot').addEventListener('click', async () => {
    const btn = $('live-snapshot'); const prev = btn.textContent;
    btn.disabled = true;
    const ok = await captureTimelineSnapshot();
    btn.textContent = ok ? t('tm.saved') : prev;
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1400);
  });

  return { updateLiveRec, dopasujPanelKamery, startLive, stopLive, wstrzymajWykrywanie };
}

if (typeof window !== 'undefined') window.utworzKamere = utworzKamere;
if (typeof module !== 'undefined') module.exports = { utworzKamere };

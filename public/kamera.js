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
  // Rozpoznany własny gest → czynność (app.js). Bez niej gest tylko się pokazuje.
  const onGest = z.onGest || (() => {});
  const G = window.utworzGesty ? window.utworzGesty() : null;

  let liveStream = null;
  let liveTimer = null;
  let livePrevObjects = '';
  let liveLastObjects = [];
  let liveLastAutoSnap = 0;
  let liveLastPose = 0;
  let livePrevPose = '';
  let livePoseKod = '';          // „stoi” / „siedzi” z usługi – do tłumaczenia przez t()
  /* Dłonie mają własną, szybszą pętlę niż obiekty: gest trwa sekundę,
     a pętla YOLO chodzi co 3 s i przegapiała go w całości. */
  let dlonieTimer = null;
  let dlonieWToku = false;
  let liveDlonie = '';          // opis pod obrazem („prawa dłoń: 2 palce…”)
  let dloniePoprzedni = '';     // kandydat – zdarzenie idzie, gdy powtórzy się dwa razy
  let dlonieWyslane = '';       // co ostatnio poszło do kontekstu modelu
  let liveObiekty = '';         // część opisu z rozpoznanych obiektów

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

  /** Opis pod obrazem złożony z trzech części: obiekty, sylwetka, dłonie.
   *  Każda pętla podmienia swoją część, zamiast nadpisywać cudze. */
  function zlozStatus() {
    // Dłonie pierwsze: zmieniają się najszybciej i to na nie patrzy ktoś, kto pokazuje gest.
    const czesci = [];
    if (liveDlonie) czesci.push(`${t('live.dlonie')} ${liveDlonie}`);
    czesci.push(liveObiekty);
    if (livePrevPose) czesci.push(`${t('live.sylwetka')} ${livePoseKod ? t(`live.poza.${livePoseKod}`) : livePrevPose}`);
    ustawStatusKamery(czesci.filter(Boolean).join(' · '));
  }

  function posLabel(cx, w) {
    const r = cx / w;
    return r < 0.34 ? t('posLeft') : r > 0.66 ? t('posRight') : t('posCenter');
  }

  // Kinect nie jest kamerą UVC, więc przeglądarka go nie widzi i getUserMedia
  // nigdy go nie zwróci. Jego klatki pobieramy po HTTP z usługi zmysłów
  // i pokazujemy w zwykłym <img> zamiast w <video>.
  let liveSource = localStorage.getItem('cosmos.liveSource') || 'camera';
  /* Rozpoznawanie (ramki YOLO, sylwetka, zdarzenia „widzę w kadrze”) da się
     wyłączyć: czasem chcesz sam obraz. Wyłączone nie wysyła też klatek do
     zmysłów, więc podgląd przez agenta ma cały obieg dla siebie. */
  let liveRozpoznawanie = localStorage.getItem('cosmos.liveRozpoznawanie') !== '0';
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
    // Ile od dołu ekranu zajmuje pole wiadomości – na telefonie panel stoi nad nim (style.css).
    const pole = $('composer');
    if (pole) {
      const odDolu = Math.max(0, window.innerHeight - pole.getBoundingClientRect().top);
      document.documentElement.style.setProperty('--composer-h', `${Math.round(odDolu)}px`);
    }
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
    /* Rozwinięte „Własne gesty” to formularz na chwilę – ma się przewinąć
       w dolnej części, a nie ścisnąć obraz do znaczka pocztowego, na którym
       nie widać dłoni, którą właśnie się nagrywa (agencja, runda 7). */
    const gesty = $('live-gesty');
    const naGesty = gesty && gesty.open ? gesty.getBoundingClientRect().height : 0;
    if (dol) paski += Math.max(0, dol.scrollHeight - dol.clientHeight - naGesty);
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
    // „…” znaczy „rozpoznaję, zaraz coś napiszę” – przy wyłączonym rozpoznawaniu
    // nic nie przyjdzie, więc samotny wielokropek wisiał pod obrazem bez końca.
    const zmyslyDzialaja = senses().online && senses().caps.yolo && liveRozpoznawanie;
    // Członek bez zgody na zmysły: komputer działa, tylko nie dla niego (zespół IT, runda 5).
    ustawStatusKamery(zmyslyDzialaja ? '…' : '', zmyslyDzialaja || (liveRozpoznawanie === false && senses().online) ? '' : t(senses().tylkoWlasciciel ? 'liveNotForYou' : 'liveNoSenses'));
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

  let bladKinecta = '';
  let pokolenieKinecta = 0;   // stara pętla klatek po zmianie źródła nie może ruszyć nowej

  function stopKinectStream() {
    liveStreaming = false;
    pokolenieKinecta++;
    zatrzymajKlatki();
    clearTimeout(liveImgTimer);
    liveImgTimer = null;
    bladKinecta = '';
    const img = $('live-image');
    img.onload = img.onerror = null;
    img.style.visibility = '';
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
  /** Błąd kamery przeglądarki po ludzku. „Requested device not found” znaczy:
   *  ta przeglądarka nie widzi żadnej kamery – a Kinect jest na liście wyżej. */
  function bladKamery(err) {
    if (err && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) return t('cam.notFound');
    return `${t('cam.err')} ${err && err.message}`;
  }

  /** Klatki Kinecta pojedynczo, przez fetch – gdy strumienia nie ma (agent
   *  zmysłów). Wspólne dla panelu kamery i trybu głosowego.
   *
   *  Przez agenta każda klatka to pełny obieg telefon → serwer → komputer
   *  z Kinectem → serwer → telefon. Jedna klatka naraz, a potem jeszcze stała
   *  przerwa, dawały podgląd „strasznie poklatkowy”. Teraz W_DRODZE klatek leci
   *  równolegle, przerwy dopełniają tylko do limitu fps, a spóźniona klatka
   *  (starsza niż pokazana) idzie do kosza. Przez fetch, nie img.src: przy
   *  błędzie widać PRZYCZYNĘ z usługi zmysłów, a nie ikonę zepsutego obrazka. */
  function klatkiKinecta(img, { stream = 'color', fps = 15, aktualne: zewn = () => true, onOk = () => {}, onBlad = () => {} } = {}) {
    const W_DRODZE = 2;
    let dziala = true;
    let adresKlatki = null;
    let wyslane = 0;
    let pokazana = 0;
    const aktualne = () => dziala && zewn();
    const odstep = (1000 / fps) * W_DRODZE;
    const petla = async () => {
      if (!aktualne()) return;
      const nr = ++wyslane;
      const start = performance.now();
      let przerwa;
      try {
        /* Limit 4 s: zawieszony obieg do zmysłów trzymał obraz 15 s bez znaku,
           a potem kończył się angielskim „operation was aborted” (runda 7). */
        let r;
        try {
          r = await fetch(`/api/kinect/frame?stream=${stream}&quality=70&t=${Date.now()}`, { signal: AbortSignal.timeout(4000) });
        } catch (e) {
          throw new Error(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? t('live.obrazWstrzymany') : String((e && e.message) || e));
        }
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `HTTP ${r.status}`);
        }
        const url = URL.createObjectURL(await r.blob());
        if (!aktualne() || nr < pokazana) { URL.revokeObjectURL(url); }
        else {
          pokazana = nr;
          img.src = url;
          img.style.visibility = '';
          if (adresKlatki) URL.revokeObjectURL(adresKlatki);
          adresKlatki = url;
          onOk();
        }
        przerwa = Math.max(0, odstep - (performance.now() - start));
      } catch (e) {
        if (!aktualne()) return;
        img.style.visibility = 'hidden';   // bez ikony zepsutego obrazka
        onBlad(e);
        przerwa = 2000;
      }
      if (aktualne()) setTimeout(petla, przerwa);
    };
    for (let i = 0; i < W_DRODZE; i++) setTimeout(petla, i * (odstep / W_DRODZE));
    // Zatrzymanie zwalnia też ostatnią pokazaną klatkę – każde zamknięcie panelu zostawiało jeden blob.
    return () => { dziala = false; if (adresKlatki) { URL.revokeObjectURL(adresKlatki); adresKlatki = null; } };
  }

  let zatrzymajKlatki = () => {};

  function startKinectStream() {
    const stream = liveSource === 'kinect-depth' ? 'depth' : 'color';
    const img = $('live-image');
    liveStreaming = true;
    const moje = ++pokolenieKinecta;
    const aktualne = () => liveStreaming && moje === pokolenieKinecta;
    let fellBack = false;

    /* Klatki przez fetch, nie przez img.src: przy błędzie widać PRZYCZYNĘ
       z usługi zmysłów („urządzenie w użyciu”, „agent nie odpowiada”), a nie
       samą ikonę zepsutego obrazka i zgadywanie. */
    const singleFrames = () => {
      fellBack = true;
      img.onload = img.onerror = null;
      const stop = klatkiKinecta(img, {
        stream, fps: liveFps, aktualne,
        onOk: () => { if (bladKinecta) { bladKinecta = ''; ustawStatusSpoczynkowy(); } },
        onBlad: (e) => {
          bladKinecta = `${t('live.kinectErr')} ${e.message}`;
          ustawStatusKamery(bladKinecta);
        },
      });
      zatrzymajKlatki = stop;
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
        ustawStatusKamery(bladKamery(err));
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
    startDlonie();
  }

  function stopLive() {
    clearInterval(liveTimer); liveTimer = null;
    stopDlonie();
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

  /* Detekcja co 3 s, ale nigdy dwie naraz: wolne YOLO (15 s na klatkę)
     nakładało zlecenia, zajmowało całą pulę agenta i zatrzymywało podgląd
     Kinecta i dłonie do zera klatek (zespół IT, runda 7). */
  let detekcjaWToku = false;
  async function liveDetect() {
    if (detekcjaWToku) return;
    detekcjaWToku = true;
    try { await liveDetectKrok(); } finally { detekcjaWToku = false; }
  }
  async function liveDetectKrok() {
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

    if (!liveRozpoznawanie) return;   // sam podgląd i nastawy, bez ramek

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
    if (!liveRozpoznawanie) return;   // wyłączone w trakcie – nie rysuj spóźnionych ramek

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
    liveObiekty = objs.length
      ? objs.map((o) => `${o.label} (${posLabel((o.box[0] + o.box[2]) / 2, overlay.width)})`).join(', ')
      : t('liveNothing');
    zlozStatus();

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
          livePrevPose = poz.summary;
          livePoseKod = poz.kod === 'stoi' || poz.kod === 'siedzi' ? poz.kod : '';
          zlozStatus();
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

  /** Połączenia punktów dłoni (MediaPipe, 21 punktów): kciuk, cztery palce
   *  i łuk dłoni. Rysujemy je, żeby było widać, CO Cosmos policzył. */
  const KOSCI_DLONI = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
    [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
    [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

  function dlonieMozliwe() {
    return liveRozpoznawanie && liveSource !== 'kinect-depth'   // na mapie głębi dłoni nie znajdzie
      && senses().online && senses().caps.dlonie;
  }

  /* Opis pod podglądem w języku interfejsu. Serwer oddaje zdanie po polsku
     (idzie do modelu); po angielsku składamy je tu z palców i strony dłoni. */
  function opisDloni(dlonie, poPolsku) {
    if (!G || typeof getLang !== 'function' || getLang() === 'pl') return String(poPolsku || '');
    return dlonie.map((dl) => {
      const strona = dl.strona ? `${t(`gest.strona.${dl.strona}`)}: ` : '';
      return strona + G.opisWzorca({ palce: dl.palce || [] }, t);
    }).join('; ');
  }

  function wyczyscDlonie() {
    const c = $('live-dlonie');
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    liveDlonie = '';
    dloniePoprzedni = '';
  }

  async function liveDlonieKrok() {
    if (dlonieWToku || !dlonieMozliwe()) return;
    const media = liveMedia();
    const { w, h } = liveMediaSize();
    if (!w || !h) return;
    dlonieWToku = true;
    try {
      /* Klatka zmniejszona do 640 px dłuższego boku, na jednym płótnie.
         Pełne 1280×720 co 350 ms to było ok. 1,1 MB/s w każdą stronę przez
         Cloudflare i 3 s zablokowanego wątku na 20 s na telefonie (zespół IT,
         runda 7). Punkty dłoni wracają w ułamkach kadru, więc skala nie ma
         znaczenia dla rysowania ani gestów. */
      const skala = Math.min(1, 640 / Math.max(w, h));
      const cap = plotnoDloni || (plotnoDloni = document.createElement('canvas'));
      cap.width = Math.round(w * skala); cap.height = Math.round(h * skala);
      cap.getContext('2d').drawImage(media, 0, 0, cap.width, cap.height);
      const res = await fetch('/api/dlonie', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: cap.toDataURL('image/jpeg', 0.75) }),
        signal: AbortSignal.timeout(8000),
      });
      const d = await readJsonSafe(res);
      // 501 = w zmysłach nie ma MediaPipe: pętla staje, zamiast pytać co 350 ms bez końca.
      if (res.status === 501) { bledyDloni = -1; return; }
      if (!res.ok) { bledyDloni++; return; }
      bledyDloni = 0;
      if (!dlonieMozliwe()) return;
      const dlonie = d.dlonie || [];
      const c = $('live-dlonie');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#f2b36b'; ctx.fillStyle = '#f2b36b';
      ctx.lineWidth = Math.max(2, w / 320);
      for (const dl of dlonie) {
        const p = (dl.punkty || []).map(([x, y]) => [x * w, y * h]);
        if (p.length !== 21) continue;
        ctx.beginPath();
        for (const [a, b] of KOSCI_DLONI) { ctx.moveTo(p[a][0], p[a][1]); ctx.lineTo(p[b][0], p[b][1]); }
        ctx.stroke();
        for (const [x, y] of p) { ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, w / 260), 0, Math.PI * 2); ctx.fill(); }
      }
      liveDlonie = dlonie.length ? opisDloni(dlonie, d.summary) : '';
      zlozStatus();
      // Do kontekstu modelu tylko opis, który utrzymał się dwa odczyty z rzędu –
      // dłoń w ruchu daje po drodze przypadkowe liczby palców.
      const opis = (dlonie.length ? String(d.summary || '') : '') || (dlonieWyslane ? 'dłoni już nie widać' : '');
      if (opis && opis === dloniePoprzedni && opis !== dlonieWyslane) {
        dlonieWyslane = dlonie.length ? opis : '';
        fetch('/api/events', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'dlonie', summary: opis }),
        }).catch(() => {});
      }
      dloniePoprzedni = opis;
      probkaGestu(dlonie[0]);
    } catch { bledyDloni++; /* zmysły chwilowo niedostępne – następny krok spróbuje znowu, rzadziej */ }
    finally { dlonieWToku = false; }
  }

  /* ---- WŁASNE GESTY -------------------------------------------------
     Ta sama pętla dłoni karmi nagrywanie i rozpoznawanie. Przy zapisanych
     gestach (i w czasie nagrywania) chodzi co 350 ms zamiast co 1,2 s – ruch
     dłoni w górę trwa sekundę i przy rzadkich odczytach zostawałby jednym
     punktem. Bez gestów – rzadko, bo każdy odczyt przez agenta to obieg
     przez serwer. */
  let wzorceGestow = [];
  let oknoGestow = [];          // ostatnie ~2,5 s próbek pierwszej dłoni
  let nagrywanieGestu = null;   // { do, probki, gotowe }
  let ostatniGest = 0;
  let nagranyWzorzec = null;
  /* Układ palców gestu nieruchomego, który właśnie zadziałał. Dłoń trzymana
     dalej w tym samym układzie odpalała go co dwie sekundy – „wyślij” szedł
     do Cosmosa pięć razy (agencja, runda 7). Gest wraca, gdy dłoń zniknie
     albo zmieni układ palców. */
  let rozbrojonyUklad = null;
  let pokolenieDloni = 0;

  /** Kończy nagrywanie z tym, co jest – pętla dłoni stanęła albo minął czas. */
  function zakonczNagrywanie() {
    if (!nagrywanieGestu) return;
    const n = nagrywanieGestu;
    nagrywanieGestu = null;
    clearTimeout(n.straznik);
    n.gotowe(n.probki);
  }

  function probkaGestu(dlon) {
    if (!G) return;
    const teraz = Date.now();
    const probka = dlon ? { t: teraz, palce: dlon.palce || [], punkty: dlon.punkty || [] } : { t: teraz };
    if (nagrywanieGestu) {
      nagrywanieGestu.probki.push(probka);
      if (teraz >= nagrywanieGestu.do) zakonczNagrywanie();
      return;
    }
    if (!wzorceGestow.length) return;
    if (rozbrojonyUklad !== null) {
      if (!dlon || G.kluczPalcow(dlon.palce) !== rozbrojonyUklad) rozbrojonyUklad = null;
      else return;
    }
    oknoGestow.push(probka);
    oknoGestow = oknoGestow.filter((p) => teraz - p.t <= 2500);
    // Po rozpoznaniu dwie sekundy przerwy – jeden gest, jedna czynność.
    if (teraz - ostatniGest < 2000) return;
    const gest = G.dopasuj(wzorceGestow, oknoGestow);
    if (!gest) return;
    ostatniGest = teraz;
    oknoGestow = [];
    if (!gest.ruch || gest.ruch === 'brak') rozbrojonyUklad = G.kluczPalcow(gest.palce);
    ustawStatusKamery(`✋ ${gest.nazwa}`);
    onGest(gest);
  }

  let plotnoDloni = null;
  let bledyDloni = 0;           // kolejne błędy z rzędu; -1 = brak MediaPipe, pętla stoi
  function odstepDloni() {
    const zwykly = nagrywanieGestu || wzorceGestow.length ? 350 : 1200;
    // Po błędach rosnący odstęp (do 15 s): padające MediaPipe nie może dostawać zleceń co 350 ms.
    return bledyDloni > 0 ? Math.min(15000, zwykly * 2 ** Math.min(bledyDloni, 6)) : zwykly;
  }
  function startDlonie() {
    clearTimeout(dlonieTimer);
    /* Pokolenie pętli: krok w locie (czeka na /api/dlonie) po ponownym starcie
       zakładał drugi zegar i pętle szły dwie naraz – dwa razy więcej odczytów
       i ten sam gest rozpoznany podwójnie. */
    const moje = ++pokolenieDloni;
    bledyDloni = 0;
    const krok = async () => {
      const start = performance.now();
      await liveDlonieKrok();
      if (bledyDloni < 0) return;
      /* Odstęp liczony od POCZĄTKU kroku: „350 ms” po obiegu do zmysłów
         dawało naprawdę 650–740 ms i ruch dłoni łapał się jednym punktem. */
      const reszta = Math.max(50, odstepDloni() - (performance.now() - start));
      if (moje === pokolenieDloni && dlonieTimer !== null) dlonieTimer = setTimeout(krok, reszta);
    };
    dlonieTimer = setTimeout(krok, odstepDloni());
    wczytajGesty();
  }
  function stopDlonie() {
    clearTimeout(dlonieTimer);
    dlonieTimer = null;
    pokolenieDloni++;
    oknoGestow = [];
    rozbrojonyUklad = null;
    // Nagrywanie w toku kończy się tym, co zdążyło przyjść – przycisk nie zostaje wyszarzony na zawsze.
    zakonczNagrywanie();
    wyczyscDlonie();
  }

  async function wczytajGesty() {
    try {
      const r = await fetch('/api/gesty');
      const d = await readJsonSafe(r);
      if (r.ok) { wzorceGestow = d.gesty || []; pokazGesty(); }
    } catch { /* bez listy gesty po prostu nie działają */ }
  }

  const krotkiAdres = (adres) => { try { return new URL(adres).hostname.replace(/^www\./, ''); } catch { return String(adres || ''); } };

  function pokazGesty() {
    const lista = $('gesty-lista');
    if (!lista) return;
    lista.replaceChildren();
    for (const g of wzorceGestow) {
      const li = document.createElement('li');
      const nazwa = document.createElement('strong');
      nazwa.className = 'gest-nazwa';
      nazwa.textContent = g.nazwa;
      nazwa.title = g.nazwa;                           // nazwę wpisał człowiek – tylko textContent
      const opis = document.createElement('span');
      opis.className = 'gest-opis';
      const parametr = g.czynnosc === 'otworz' ? krotkiAdres(g.parametr) : g.parametr;
      opis.textContent = `${G.opisWzorca(g, t)} → ${t(`gest.cz.${g.czynnosc}`)}${parametr ? `: ${parametr}` : ''}`;
      opis.title = opis.textContent;
      const usun = document.createElement('button');
      usun.type = 'button';
      usun.className = 'icon-btn gest-usun';
      usun.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      usun.setAttribute('aria-label', t('gest.usun', { nazwa: g.nazwa }));
      usun.addEventListener('click', async () => {
        usun.disabled = true;
        const r = await fetch(`/api/gesty?id=${encodeURIComponent(g.id)}`, { method: 'DELETE' }).catch(() => null);
        if (!r || !r.ok) { usun.disabled = false; return; }
        await wczytajGesty();
        // Fokus nie ginie razem z usuniętym wierszem: następny przycisk usuwania albo nazwa nowego gestu.
        (lista.querySelector('.gest-usun') || $('gest-nazwa'))?.focus();
      });
      li.append(nazwa, opis, usun);
      lista.appendChild(li);
    }
  }

  function stanGestu(tekst) { const e = $('gest-stan'); if (e) e.textContent = tekst; }
  const pauzaMs = (ms) => new Promise((r) => setTimeout(r, ms));

  $('live-gesty')?.addEventListener('toggle', () => {
    dopasujPanelKamery();
    if ($('live-gesty').open) $('live-gesty').scrollIntoView({ block: 'nearest' });
  });

  $('gest-czynnosc')?.addEventListener('change', () => {
    const cz = $('gest-czynnosc').value;
    const pole = $('gest-parametr');
    pole.hidden = !(cz === 'wyslij' || cz === 'otworz');
    pole.placeholder = t(cz === 'otworz' ? 'gest.parametrAdres' : 'gest.parametrTekst');
    pole.setAttribute('aria-label', pole.placeholder);
  });

  $('gest-nagraj')?.addEventListener('click', async () => {
    const przycisk = $('gest-nagraj');
    if (!G || !dlonieMozliwe() || $('live-panel').style.display === 'none') {
      stanGestu(t('gest.niemozliwe'));
      return;
    }
    przycisk.disabled = true;
    $('gest-zapisz').disabled = true;
    nagranyWzorzec = null;
    for (const n of [3, 2, 1]) { stanGestu(t('gest.odliczanie', { n })); await pauzaMs(1000); }
    stanGestu(t('gest.pokazuj'));
    if (!dlonieMozliwe() || $('live-panel').style.display === 'none') {
      stanGestu(t('gest.niemozliwe')); przycisk.disabled = false; return;
    }
    const probki = await new Promise((gotowe) => {
      nagrywanieGestu = { do: Date.now() + 2500, probki: [], gotowe };
      // Zapas na wypadek, gdyby odczyty przestały przychodzić (zmysły padły w trakcie).
      nagrywanieGestu.straznik = setTimeout(zakonczNagrywanie, 4500);
    });
    przycisk.disabled = false;
    const w = G.wzorzecZNagrania(probki);
    if (!w) { stanGestu(t('gest.bezDloni')); return; }
    nagranyWzorzec = w;
    stanGestu(t('gest.nagrany', { opis: G.opisWzorca(w, t) }));
    $('gest-zapisz').disabled = false;
  });

  $('gest-zapisz')?.addEventListener('click', async () => {
    if (!nagranyWzorzec) return;
    const przycisk = $('gest-zapisz');
    przycisk.disabled = true;
    const r = await fetch('/api/gesty', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nazwa: $('gest-nazwa').value, czynnosc: $('gest-czynnosc').value,
        parametr: $('gest-parametr').value, znaczenie: $('gest-znaczenie').value, ...nagranyWzorzec,
      }),
    }).catch(() => null);
    const d = r ? await readJsonSafe(r) : {};
    if (!r || !r.ok) {
      // Kod błędu z serwera tłumaczymy; zdanie serwera zostaje zapasem (507, nowe kody).
      const kody = ['brakNazwy', 'czynnosc', 'brakNagrania', 'adres', 'tekst', 'limit'];
      stanGestu(kody.includes(d.kod) ? t(`gest.blad.${d.kod}`) : (d.error || t('gest.bladZapisu')));
      przycisk.disabled = false;
      return;
    }
    nagranyWzorzec = null;
    for (const id of ['gest-nazwa', 'gest-parametr', 'gest-znaczenie']) $(id).value = '';
    stanGestu(t('gest.zapisany', { nazwa: d.gest.nazwa }));
    await wczytajGesty();
  });

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
    else ustawStatusKamery(bladKamery(r.error));
  });
  $('live-expand').addEventListener('click', () => {
    const on = $('live-panel').classList.contains('expanded');
    localStorage.setItem('cosmos.liveExpanded', on ? '0' : '1');
    applyLiveExpanded();
  });
  function pokazRozpoznawanie() {
    $('live-rozpoznawanie').setAttribute('aria-pressed', String(liveRozpoznawanie));
  }
  pokazRozpoznawanie();
  $('live-rozpoznawanie').addEventListener('click', () => {
    liveRozpoznawanie = !liveRozpoznawanie;
    try { localStorage.setItem('cosmos.liveRozpoznawanie', liveRozpoznawanie ? '1' : '0'); } catch { /* tryb prywatny */ }
    pokazRozpoznawanie();
    if (liveRozpoznawanie) {
      if ($('live-panel').style.display !== 'none') setTimeout(liveDetect, 50);
      return;
    }
    // Wyłączone: ramki i opis znikają od razu, nie przy następnym cyklu.
    const overlay = $('live-overlay');
    overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    livePrevObjects = '';
    livePrevPose = '';
    liveLastObjects = [];
    liveObiekty = '';
    wyczyscDlonie();
    if (!bladKinecta) ustawStatusSpoczynkowy();
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
  function wstrzymajWykrywanie() { clearInterval(liveTimer); liveTimer = null; stopDlonie(); }

  // ręczna migawka do osi czasu (Digital Time Machine)
  $('live-snapshot').addEventListener('click', async () => {
    const btn = $('live-snapshot'); const prev = btn.textContent;
    btn.disabled = true;
    const ok = await captureTimelineSnapshot();
    btn.textContent = ok ? t('tm.saved') : prev;
    setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 1400);
  });

  return { updateLiveRec, dopasujPanelKamery, startLive, stopLive, wstrzymajWykrywanie, klatkiKinecta, ustawStatusKamery };
}

if (typeof window !== 'undefined') window.utworzKamere = utworzKamere;
if (typeof module !== 'undefined') module.exports = { utworzKamere };

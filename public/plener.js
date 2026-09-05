/* ============================================================
   PLENER — plan zdjęciowy, karty ujęć, misja drona

   Największa jedna rzecz, jaka mieszkała w `app.js`: siedemset linii
   liczenia światła, nastaw aparatu, kart ujęć i planowania nalotu drona.
   To jest ta część Cosmosa, której nie ma żaden asystent w chmurze —
   ChatGPT nie wie, gdzie stoisz, która jest u Ciebie godzina ani co masz
   w plecaku.

   Moduł jest ZAMKNIĘTY: cały jego stan (ostatni policzony plan, stan
   aparatu, współrzędne pleneru, odhaczone ujęcia) mieszka w środku i nikt
   z zewnątrz go nie widzi. Na zewnątrz wychodzą dwie funkcje, bo tyle
   naprawdę woła reszta aplikacji: `odswiezPlan` (kaskada narzędzi, gdy
   model prosi o plan) i `zamknijPlener` (klawisz Escape).

   Nasłuchy przycisków rejestrują się przy wywołaniu `utworzPlener()` —
   dokładnie w tym samym miejscu i momencie, w którym rejestrowały się
   wcześniej jako kod na poziomie pliku.
   ============================================================ */

/**
 * Zbuduj obsługę pleneru i planu zdjęciowego.
 *
 * @param {object} z zależności
 * @param {Function} z.$ pobranie elementu po identyfikatorze
 * @param {object}   z.el podręczne uchwyty do elementów
 * @param {Function} z.t tłumaczenia
 * @param {Function} z.readJsonSafe bezpieczny odczyt JSON z odpowiedzi
 * @param {Function} z.closeSettings zamknięcie Ustawień (przejście do pleneru)
 * @param {Function} z.dopasujPanelKamery przeliczenie układu panelu kamery
 * @param {Function} z.odswiezArchiwum odświeżenie panelu archiwum
 * @param {Function} z.wczytajSprzet wczytanie zestawu sprzętu
 * @param {Function} z.zapiszSprzet zapis zestawu sprzętu
 * @returns {{odswiezPlan: Function, zamknijPlener: Function}}
 */
function utworzPlener(z) {
  const {
    $, el, t, readJsonSafe, closeSettings, dopasujPanelKamery,
    odswiezArchiwum, wczytajSprzet, zapiszSprzet,
  } = z;

  /* ==================== PLAN ZDJĘCIOWY ==================== */

  let planOstatnio = 0;
  let planZajety = false;

  /** Średnia jasność kadru (0–1) — pomiar sceny, nie zgadywanka z pory dnia.
   *  Próbkujemy co dziesiąty piksel: różnica w wyniku żadna, a koszt dziesięć
   *  razy mniejszy przy klatce co sekundę. */
  function jasnoscKadru(canvas) {
    try {
      const g = canvas.getContext('2d', { willReadFrequently: true });
      const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
      let suma = 0;
      let ile = 0;
      for (let i = 0; i < d.length; i += 40) {
        suma += (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
        ile++;
      }
      return ile ? suma / ile : null;
    } catch { return null; }
  }

  /** Odśwież plan zdjęciowy z bieżącego kadru. Rzadziej niż detekcja obiektów —
   *  światło zmienia się w minutach, nie w klatkach. */
  async function odswiezPlan(cap) {
    const box = $('plan-box');
    if (!box || box.hidden) return;
    if (planZajety || Date.now() - planOstatnio < 8000) return;
    planZajety = true;
    planOstatnio = Date.now();
    try {
      const trybPola = $('plan-mode').value;
      const wideo = trybPola.startsWith('wideo');
      const dane = {
        sprzet: $('plan-gear').value,
        tryb: wideo ? 'wideo' : 'zdjecie',
        klatki: trybPola === 'wideo50' ? 50 : 25,
        // Puste = „weź z prognozy". Wybór ręczny wygrywa, bo stojąc na miejscu
        // widzisz niebo lepiej niż model pogodowy dla kwadratu kilometra.
        ...( $('plan-sky').value ? { zachmurzenie: $('plan-sky').value } : {} ),
        szerokosc: cap ? cap.width : 0,
        wysokosc: cap ? cap.height : 0,
      };
      const j = cap ? jasnoscKadru(cap) : null;
      if (j !== null) dane.jasnosc = j;
      const r = await fetch('/api/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dane),
      });
      const d = await readJsonSafe(r);
      /* `ma-wynik` decyduje, czy zwinięty pasek pokazuje tytuł, czy same
         nastawy — patrz komentarz w style.css przy `.plan-box.ma-wynik`.
         Bez wyniku tytuł zostaje, bo sam myślnik nic nie mówi. */
      if (!r.ok) {
        box.classList.remove('ma-wynik');   // znów sam myślnik → tytuł wraca
        $('plan-shot').textContent = '—';
        $('plan-light').textContent = d.error || t('plan.needLocation');
        $('plan-why').textContent = '';
        return;
      }
      pokazPlan(d);
    } catch { /* offline — panel zostaje z poprzednim wynikiem */ } finally {
      planZajety = false;
    }
  }

  /* Wypisz policzony plan. `pre` to przedrostek identyfikatorów, bo plan
     pokazuje się w DWÓCH miejscach: pod podglądem kamery (`plan-*`, liczony
     z jasności bieżącej klatki) i w Plenerze (`fp-*`, liczony dla miejsca
     i godziny, bez kamery). Treść jest ta sama, więc kod też jest jeden —
     dwie kopie tej samej funkcji rozjechałyby się przy pierwszej poprawce. */
  function pokazPlan(d, pre = 'plan') {
    const u = d.ustawienia;
    $(pre + '-shot').textContent = `${u.czas} · ${u.przyslona} · ISO ${u.iso}`;
    /* „Jest wynik" należy do PLANU, nie do jednego wywołania. Stąd tutaj,
       a nie w `odswiezPlan`: pudełko przy kamerze chowa wtedy tytuł ze
       zwiniętego paska, bo liczby mówią same za siebie i nie ma po co ich
       ściskać (patrz `.plan-box.ma-wynik` w style.css). */
    if (pre === 'plan') { const b = $('plan-box'); if (b) b.classList.add('ma-wynik'); }

    const czesci = [];
    /* Układ kadru przychodził z serwera po polsku i tak też lądował na
       ekranie — także przy interfejsie po angielsku. Tłumaczymy go tutaj,
       bo to jedyne miejsce, w którym ta wartość jest pokazywana. */
    if (d.kadr && d.kadr.uklad !== 'nieznany') {
      const uklad = t(`frame.${d.kadr.uklad}`);
      czesci.push(`${uklad.startsWith('frame.') ? d.kadr.uklad : uklad} ${d.kadr.proporcje}`);
    }
    czesci.push(`${d.slonce.faza} (${d.slonce.wysokosc}°)`);
    // Pogoda tylko wtedy, gdy naprawdę przyszła z prognozy — przy wyborze
    // ręcznym powtarzanie tego, co użytkownik sam ustawił, jest szumem.
    if (d.pogoda) {
      czesci.push(`${d.pogoda.opis}`
        + (d.pogoda.temperatura !== null ? ` ${Math.round(d.pogoda.temperatura)}°C` : '')
        + (d.pogoda.opadyProc > 30 ? ` · opady ${d.pogoda.opadyProc}%` : ''));
    }
    const light = $(pre + '-light');
    light.textContent = czesci.join(' · ');

    /* Ile zostało czasu — to jedyna liczba, na którą patrzy się w terenie.
       Gdy złota godzina trwa TERAZ, mówimy to wprost zamiast pokazywać
       ujemne minuty do jej początku. */
    const zloty = d.slonce.doZlotejMin;
    const zachod = d.slonce.doZachoduMin;
    const czas = document.createElement('span');
    czas.className = 'plan-urgent';
    if (d.slonce.faza === 'złota godzina') {
      czas.textContent = ` · ${t('plan.goldenNow')}`
        + (zachod > 0 ? `, ${t('plan.toSunset', { n: zachod })}` : '');
    } else if (zloty > 0) {
      czas.textContent = ` · ${t('plan.toGolden', { n: zloty })}`;
    } else if (zachod > 0) {
      czas.textContent = ` · ${t('plan.toSunset', { n: zachod })}`;
    }
    if (czas.textContent) light.appendChild(czas);

    const why = $(pre + '-why');
    why.innerHTML = '';
    for (const p of u.powody) {
      const el = document.createElement('p');
      el.textContent = p;
      why.appendChild(el);
    }

    // Ostatnie POLICZONE nastawy — z nich bierze wartości przycisk „Ustaw w aparacie".
    planOstatnieUstawienia = u;
    odswiezAparat(u);

    /* PANEL PRZELICZAMY PO WPISANIU TREŚCI, nie tylko po rozwinięciu pudełka.
     *
     *  Rozwinięcie nastaw woła `dopasujPanelKamery()` od razu — i to za wcześnie.
     *  Pudełko jest wtedy jeszcze puste, bo `odswiezPlan()` dolicza światło,
     *  czas do złotej godziny i uzasadnienia dopiero po odpowiedzi z serwera.
     *  Panel wychodził więc policzony pod pudełko o kilka wierszy niższe, niż
     *  będzie za moment, i dopisane linijki wystawały poza niego.
     *
     *  Zmierzone na oknie 1440×700: panel zastygał przy 311 px szerokości
     *  z 50 px treści poza kadrem, choć miał się zwęzić do 200 px i zmieścić
     *  wszystko. Zestaw `panel-kamery-miesci` widział to jako „małe okienko
     *  przesuwalne pod dużym podglądem" i miał rację. */
    if (pre === 'plan') dopasujPanelKamery();
  }

  let planOstatnieUstawienia = null;

  /* ---- APARAT PO WI-FI (Canon CCAPI) ------------------------------------
     Sedno nie jest w tym, że da się zdalnie zmienić ISO. Sedno jest w tym, że
     Cosmos przestaje mówić „ustaw 1/250, f/8, ISO 200", a zaczyna mówić „masz
     1/60, f/4, ISO 1600 — poprawiam". Do tego musi ZOBACZYĆ, co aparat ma
     naprawdę ustawione, i porównać z tym, co sam policzył dla tego światła.

     Wiersz pokazuje się dopiero, gdy aparat odpowiada. Martwy przycisk
     „Ustaw w aparacie" u kogoś, kto nigdy nie włączył CCAPI, byłby gorszy niż
     jego brak — obiecywałby coś, czego nie ma. */
  let aparatStan = null;
  let aparatSprawdzony = 0;
  const APARAT_CACHE_MS = 30000;

  async function odswiezAparat(policzone) {
    const wiersz = $('plan-camera');
    if (!wiersz) return;
    /* Wiersz aparatu mieszka w Plenerze. Odpytywanie go przy zamkniętym oknie
       to dwa żądania do aparatu co osiem sekund przez cały czas otwartego
       podglądu — do niczego, a aparat i tak zasypia po Wi-Fi. */
    if ($('plener-modal').style.display === 'none') return;

    if (Date.now() - aparatSprawdzony > APARAT_CACHE_MS) {
      aparatSprawdzony = Date.now();
      try { aparatStan = await (await fetch('/api/canon/status')).json(); }
      catch { aparatStan = null; }
    }
    if (!aparatStan || !aparatStan.online) {
      // Nieskonfigurowany aparat chowamy zupełnie; skonfigurowany, ale
      // niedostępny — pokazujemy z powodem, bo to stan do naprawienia.
      wiersz.hidden = !(aparatStan && aparatStan.skonfigurowany);
      if (!wiersz.hidden) {
        $('plan-camera-now').textContent = String((aparatStan && aparatStan.powod) || '').slice(0, 120);
        $('plan-camera-now').className = 'plan-camera-off';
        $('plan-camera-apply').hidden = true;
      }
      return;
    }

    wiersz.hidden = false;
    $('plan-camera-apply').hidden = false;
    try {
      const w = await (await fetch('/api/canon/settings')).json();
      const n = w.nastawy || {};
      const teraz = [n.czas, n.przyslona && `f/${String(n.przyslona).replace(/^f/i, '')}`,
        n.iso && `ISO ${n.iso}`].filter(Boolean).join(' · ') || '—';
      /* APARAT, KTÓRY NIE UMIE PODAĆ NASTAW, NIE PRZYJMIE ICH TEŻ.
         Stan aparatu odpytujemy najwyżej raz na trzydzieści sekund, żeby nie
         dobijać go po Wi-Fi — ale to znaczy, że przez pół minuty po zaśnięciu
         `online` jest jeszcze prawdą. W tym czasie panel pokazywał
         „Canon EOS R6m2: —" i CZYNNY przycisk „Ustaw w aparacie", który mógł
         tylko zawieść. R6 II usypia Wi-Fi po kilku minutach bezczynności,
         więc to nie jest przypadek brzegowy, tylko codzienność w plenerze.
         Brak wszystkich trzech nastaw traktujemy więc jak zniknięcie aparatu
         i od razu unieważniamy zapamiętany stan. */
      if (!n.czas && !n.przyslona && !n.iso) {
        aparatSprawdzony = 0;
        aparatStan = null;
        $('plan-camera-now').textContent = t('plan.cameraErr');
        $('plan-camera-now').className = 'plan-camera-off';
        $('plan-camera-apply').hidden = true;
        return;
      }
      const el = $('plan-camera-now');
      el.className = '';
      el.textContent = `${aparatStan.model || t('plan.camera')}: ${teraz}`;
      /* Zgodność liczymy, a nie porównujemy napisy: „1/250" z aparatu i 0,004 s
         z planu to ta sama wartość zapisana inaczej. Różnica poniżej jednej
         trzeciej działki jest w praktyce nieodróżnialna na zdjęciu. */
      const l = w.liczby || {};
      if (policzone && l.iso && policzone.iso) {
        const dzialki = Math.abs(Math.log2(l.iso / policzone.iso));
        if (dzialki > 0.34) el.textContent += ` · ${t('plan.mismatch')}`;
      }
    } catch {
      $('plan-camera-now').textContent = t('plan.cameraErr');
      $('plan-camera-now').className = 'plan-camera-off';
    }
  }

  $('plan-camera-apply').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const u = planOstatnieUstawienia;
    if (!u) return;
    b.disabled = true;
    const pierwotny = b.textContent;
    b.textContent = t('plan.applying');
    try {
      const r = await fetch('/api/canon/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iso: u.iso ? String(u.iso) : '',
          // Aparat oczekuje swojego zapisu: „f4.0" i „1/250", nie liczb.
          przyslona: u.przyslona ? String(u.przyslona).replace('f/', 'f') : '',
          czas: u.czas || '',
        }),
      });
      const d = await readJsonSafe(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      aparatSprawdzony = 0;
      await odswiezAparat(u);
    } catch (err) {
      $('plan-camera-now').textContent = t('plan.applyErr', { msg: err.message });
      $('plan-camera-now').className = 'plan-camera-off';
    } finally {
      b.disabled = false;
      b.textContent = pierwotny;
    }
  });

  /* Migawka. Świadomie TYLKO pod ludzkim palcem — model tego narzędzia nie
     dostaje. „Zrób zdjęcie, bo wygląda na dobry moment" jest dokładnie tą
     klasą decyzji, której maszyna nie powinna podejmować za człowieka
     trzymającego aparat. */
  $('plan-camera-shutter').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    const pierwotny = b.textContent;
    try {
      const r = await fetch('/api/canon/shutter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const d = await readJsonSafe(r);
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      b.textContent = t('pl.shutterOk');
    } catch (err) {
      $('plan-camera-now').textContent = t('plan.applyErr', { msg: err.message });
      $('plan-camera-now').className = 'plan-camera-off';
    } finally {
      setTimeout(() => { b.textContent = pierwotny; b.disabled = false; }, 900);
    }
  });

  for (const id of ['plan-gear', 'plan-mode', 'plan-sky']) {
    const el = $(id);
    // Zmiana ustawienia ma dać odpowiedź od razu, a nie po ośmiu sekundach.
    if (el) el.addEventListener('change', () => { planOstatnio = 0; odswiezPlan(null); });
  }

  /* Pudełko nastaw pamięta, czy je rozwinąłeś. Domyślnie zwinięte, bo panel
     kamery zajmuje na telefonie 743 z 844 px ekranu, a rozwinięte pudełko to
     ponad jedna trzecia tego panelu. Kto raz je rozwinie, ten najwyraźniej
     chce je mieć otwarte — i nie musi tego klikać przy każdym uruchomieniu. */
  const PLAN_ROZWINIETE = 'cosmos.planRozwiniete';
  {
    const box = $('plan-box');
    if (box) {
      box.open = localStorage.getItem(PLAN_ROZWINIETE) === '1';
      box.addEventListener('toggle', () => {
        localStorage.setItem(PLAN_ROZWINIETE, box.open ? '1' : '0');
        /* Po rozwinięciu licz od razu. Bez tego świeżo otwarte pudełko
           pokazywałoby poprzedni wynik nawet przez osiem sekund, a przy
           wyłączonych zmysłach — myślnik do końca świata, bo pętla podglądu
           odświeża plan tylko z klatki. */
        if (box.open) { planOstatnio = 0; odswiezPlan(null); }
        // Paski zmieniły wysokość → panel ma się przeliczyć od razu, a nie
        // dopiero przy następnej klatce podglądu.
        dopasujPanelKamery();
      });
    }
  }

  /* ============================== PLENER ==============================
     Foto i wideo jako jedno miejsce, a nie pięć.

     Powód wydzielenia jest rzeczowy, nie porządkowy. Te funkcje wyrosły
     przez ostatnie partie do rozmiaru osobnego programu, a mieszkały tak:
     sprzęt i archiwum w Ustawieniach, plan zdjęciowy w podpanelu podglądu
     kamery (czyli niedostępny bez włączonej kamery), aparat po Wi-Fi jako
     wiersz w tamtym podpanelu, ptaki w nakładce głosowej, a misja KMZ
     i karty ujęć — nigdzie. Te dwie ostatnie dało się uruchomić wyłącznie
     żądaniem HTTP albo przez model. To nie jest funkcja, której nie ma;
     to funkcja, o której nie sposób się dowiedzieć.

     Plan liczy się TU bez kamery: dla nazwy miejsca i dla wybranej godziny.
     To jest ta różnica, na której zależy najbardziej — „co zabrać w sobotę
     do Krakowa na 18:30" to inne pytanie niż „co ustawić w tej chwili”. */

  function otworzPlener() {
    wczytajSprzet();
    odswiezArchiwum();
    $('plener-modal').style.display = '';
    // Aparat sprawdzamy przy otwarciu, nie w tle — patrz `odswiezAparat`.
    aparatSprawdzony = 0;
    odswiezAparat(planOstatnieUstawienia);
    /* Plan liczymy przy KAŻDYM otwarciu, nie tylko pierwszym. Puste okno
       z przyciskiem „Policz" kazałoby klikać po to, co i tak zawsze chcemy
       zobaczyć, a plan sprzed godziny jest już nieprawdą — Słońce się
       przesunęło, a to jest cała treść tego panelu. */
    liczPlanPlener();
  }

  function zamknijPlener() { $('plener-modal').style.display = 'none'; }

  $('plener-btn').addEventListener('click', otworzPlener);
  $('plener-close').addEventListener('click', zamknijPlener);
  $('plener-modal').addEventListener('click', (e) => {
    if (e.target === $('plener-modal')) zamknijPlener();
  });
  $('set-open-plener').addEventListener('click', () => { closeSettings(); otworzPlener(); });

  /* ---- sprzęt ---- */
  $('gear-save').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const stan = $('gear-status');
    b.disabled = true;
    stan.className = 'field-hint';
    try {
      await zapiszSprzet();
      stan.textContent = t('pl.gearSaved');
      setTimeout(() => { stan.textContent = ''; }, 2500);
      // Zestaw wpływa na ujęcia i na nastawy — plan po zapisie jest nieaktualny.
      liczPlanPlener();
    } catch (err) {
      // Nieudany zapis ZOSTAJE na ekranie — inaczej człowiek wychodzi
      // przekonany, że sprzęt jest wpisany, a plan liczy dla domyślnego korpusu.
      stan.className = 'field-hint plener-err';
      stan.textContent = t('pl.gearErr', { msg: err.message });
    } finally {
      b.disabled = false;
    }
  });

  /* ---- plan ---- */
  let plenerZajety = false;
  let plenerPonow = false;

  async function liczPlanPlener() {
    /* Zajęte = przelicz PO powrocie, a nie „odpuść". Zwykłe `return` znaczyło,
       że przy szybkiej zmianie dwóch list na ekranie zostaje wynik dla pierwszej
       — i to bez żadnego znaku, że coś przepadło. */
    if (plenerZajety) { plenerPonow = true; return; }
    plenerZajety = true;
    const przycisk = $('fp-go');
    przycisk.disabled = true;
    try {
      const trybPola = $('fp-mode').value;
      const wideo = trybPola.startsWith('wideo');
      const dane = {
        tryb: wideo ? 'wideo' : 'zdjecie',
        klatki: trybPola === 'wideo50' ? 50 : 25,
      };
      // Puste pola znaczą „weź to, co zapisane" — i muszą NIE trafić do żądania,
      // bo pusty napis to dla serwera podana wartość, a nie jej brak.
      if ($('fp-gear').value) dane.sprzet = $('fp-gear').value;
      if ($('fp-sky').value) dane.zachmurzenie = $('fp-sky').value;
      if ($('fp-place').value.trim()) dane.miejsce = $('fp-place').value.trim();
      if ($('fp-topic').value.trim()) dane.temat = $('fp-topic').value.trim();
      if ($('fp-when').value) {
        const kiedy = new Date($('fp-when').value);
        if (!Number.isNaN(kiedy.getTime())) dane.kiedy = kiedy.toISOString();
      }
      const r = await fetch('/api/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dane),
      });
      const d = await readJsonSafe(r);
      if (!r.ok) {
        $('fp-shot').textContent = '—';
        $('fp-light').textContent = d.error || t('plan.needLocation');
        $('fp-why').textContent = '';
        $('fp-shots').innerHTML = '';
        return;
      }
      pokazPlan(d, 'fp');
      pokazUjecia(d.ujecia);
      // Misja dostaje współrzędne z planu — przepisywanie ich z mapy do dwóch
      // pól to najprostszy sposób na literówkę w miejscu, w którym boli.
      /* Współrzędne misji idą za planem, chyba że wpisano je RĘCZNIE.

         Pierwsza wersja uzupełniała je tylko wtedy, gdy oba pola były puste —
         i to była cicha, groźna usterka. Panel liczy plan zaraz po otwarciu,
         jeszcze dla zapisanej lokalizacji, więc pola wypełniały się domem.
         Potem człowiek wpisywał „Zakopane", przeliczał plan — a w misji dalej
         siedziały współrzędne domu, bo pola nie były już puste. Wychodził
         z tego plik lotu nad zupełnie innym miejscem i nic tego nie zdradzało.
         W narzędziu, które steruje dronem, to najgorszy możliwy rodzaj błędu. */
      plenerWspolrzedne = d.wspolrzedne || null;
      plenerMiejsce = d.miejsce || null;
      if (plenerWspolrzedne && !misjaReczna) wstawWspolrzedne();
      opiszZrodloMisji();
    } catch {
      $('fp-light').textContent = t('offline.title');
    } finally {
      przycisk.disabled = false;
      plenerZajety = false;
      if (plenerPonow) { plenerPonow = false; liczPlanPlener(); }
    }
  }

  $('fp-go').addEventListener('click', liczPlanPlener);
  $('fp-now').addEventListener('click', () => { $('fp-when').value = ''; liczPlanPlener(); });
  for (const id of ['fp-gear', 'fp-mode', 'fp-sky']) {
    $(id).addEventListener('change', liczPlanPlener);
  }
  for (const id of ['fp-place', 'fp-topic']) {
    // Enter w polu tekstowym ma liczyć — inaczej trzeba sięgać po przycisk.
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') liczPlanPlener(); });
  }
  $('fp-when').addEventListener('change', liczPlanPlener);

  /* Karty ujęć — lista pozycji do odhaczenia, z liczbami. POMINIĘTE pokazujemy
     równie wyraźnie: „nie masz czym" to inna informacja niż „nie ma na liście",
     a bez niej wygląda, jakby Cosmos o dronie zapomniał. */
  /* Odhaczone ujęcia. Trzymane w przeglądarce, nie na serwerze, i to jest
     przemyślane: „nakręciłem" to stan JEDNEGO dnia zdjęciowego na JEDNYM
     urządzeniu, a nie fakt o Marcinie wart miejsca w pamięci Cosmosa.
     Klucz zawiera temat, więc powrót do tego samego planu wraca też do postępu,
     a zmiana tematu zaczyna listę od nowa. */
  const KLUCZ_ODHACZONE = 'cosmos.ujecia.';
  function odhaczone(temat) {
    try { return new Set(JSON.parse(localStorage.getItem(KLUCZ_ODHACZONE + temat) || '[]')); }
    catch { return new Set(); }
  }
  function zapiszOdhaczone(temat, zbior) {
    try { localStorage.setItem(KLUCZ_ODHACZONE + temat, JSON.stringify([...zbior])); }
    catch { /* prywatne okno albo pełny dysk — lista działa dalej, tylko bez pamięci */ }
  }

  function pokazUjecia(u) {
    const box = $('fp-shots');
    box.innerHTML = '';
    if (!u || !Array.isArray(u.ujecia) || !u.ujecia.length) return;

    const temat = ($('fp-topic').value.trim() || '—').toLowerCase().slice(0, 40);
    const zrobione = odhaczone(temat);

    const tytul = document.createElement('div');
    tytul.className = 'plener-shots-title';
    const licznik = document.createElement('span');
    const odswiezLicznik = () => {
      licznik.textContent = t('pl.shots', { n: u.ujecia.length })
        + (zrobione.size ? ` — ${t('pl.done', { n: zrobione.size })}` : '');
    };
    odswiezLicznik();
    const wyczysc = document.createElement('button');
    wyczysc.type = 'button';
    wyczysc.className = 'plener-clear';
    wyczysc.textContent = t('pl.clearTicks');
    wyczysc.addEventListener('click', () => {
      zrobione.clear();
      zapiszOdhaczone(temat, zrobione);
      pokazUjecia(u);
    });
    tytul.append(licznik, wyczysc);
    box.appendChild(tytul);

    for (const s of u.ujecia) {
      const kar = document.createElement('div');
      kar.className = 'plener-shot' + (zrobione.has(s.klucz) ? ' zrobione' : '');

      const glowa = document.createElement('div');
      glowa.className = 'plener-shot-head';
      /* Odhaczanie jest sensem listy — „lista do odhaczenia" bez sposobu
         odhaczenia byłaby obietnicą na wyrost. W terenie zaznacza się to
         palcem, na telefonie, więc pole leży w nagłówku karty. */
      const ptaszek = document.createElement('input');
      ptaszek.type = 'checkbox';
      ptaszek.className = 'plener-tick';
      ptaszek.checked = zrobione.has(s.klucz);
      ptaszek.setAttribute('aria-label', s.nazwa);
      ptaszek.addEventListener('change', () => {
        ptaszek.checked ? zrobione.add(s.klucz) : zrobione.delete(s.klucz);
        zapiszOdhaczone(temat, zrobione);
        kar.classList.toggle('zrobione', ptaszek.checked);
        odswiezLicznik();
      });
      const nazwa = document.createElement('span');
      nazwa.className = 'plener-shot-name';
      nazwa.textContent = s.nazwa;
      /* Rola ujęcia na wierzchu. Bez niej lista wygląda jak worek pomysłów
         i dopiero po chwili widać, że są w niej trzy otwarcia i zero zakończeń
         — co dokładnie się zdarzyło i dopiero człowiek to wyłapał. */
      const rola = document.createElement('span');
      rola.className = 'plener-shot-role rola-' + (s.rola || 'rozwiniecie');
      rola.textContent = s.rolaOpis || '';
      const liczby = document.createElement('span');
      liczby.className = 'plener-shot-nums mono';
      liczby.textContent = `${s.ogniskowa} mm · ${s.sekund[0]}-${s.sekund[1]} s`;
      /* Rola i liczby jako JEDNA grupa. Osobno, w zwykłym `flex-wrap`, nazwa
         ujęcia mogła się skurczyć poniżej własnego słowa i „przebitka" wchodziła
         na plakietkę ROZWINIĘCIE — widać to było na telefonie. Zgrupowane
         przenoszą się do drugiej linii razem i nazwa dostaje całą pierwszą. */
      const meta = document.createElement('span');
      meta.className = 'plener-shot-meta';
      meta.append(rola, liczby);
      glowa.append(ptaszek, nazwa, meta);

      const ruch = document.createElement('div');
      ruch.className = 'plener-shot-move';
      ruch.textContent = s.ruch + (s.naSzkle ? ` · ${s.naSzkle}` : '');

      const jak = document.createElement('div');
      jak.className = 'plener-shot-how';
      jak.textContent = s.jak;

      const poco = document.createElement('div');
      poco.className = 'plener-shot-why';
      poco.textContent = s.poCo;

      kar.append(glowa, ruch, jak, poco);
      box.appendChild(kar);
    }

    if (u.pominiete && u.pominiete.length) {
      const p = document.createElement('div');
      p.className = 'plener-skipped';
      p.textContent = t('pl.skipped') + ' '
        + u.pominiete.map((x) => `${x.nazwa} (${x.powod})`).join('; ');
      box.appendChild(p);
    }
  }

  /* ---- misja drona ---- */
  let plenerWspolrzedne = null;
  let plenerMiejsce = null;
  let misjaReczna = false;

  function wstawWspolrzedne() {
    if (!plenerWspolrzedne) return;
    $('mis-lat').value = Number(plenerWspolrzedne.lat).toFixed(5);
    $('mis-lon').value = Number(plenerWspolrzedne.lon).toFixed(5);
  }

  /* Skąd są te współrzędne — napisane wprost pod polami. Dwie liczby same
     z siebie nie mówią, czy to Zakopane, czy dom; a różnicy nie widać, dopóki
     dron nie stoi w polu. */
  function opiszZrodloMisji() {
    const el = $('mis-skad');
    if (!el) return;
    if (misjaReczna) { el.textContent = t('pl.misManual'); el.className = 'field-hint plener-warn'; return; }
    el.className = 'field-hint';
    el.textContent = plenerWspolrzedne
      ? t('pl.misFromPlan', { miejsce: plenerMiejsce || `${Number(plenerWspolrzedne.lat).toFixed(3)}, ${Number(plenerWspolrzedne.lon).toFixed(3)}` })
      : '';
  }

  for (const id of ['mis-lat', 'mis-lon']) {
    // Ręczny wpis wygrywa z planem — ale tylko dopóki człowiek go nie cofnie.
    $(id).addEventListener('input', () => {
      misjaReczna = Boolean($('mis-lat').value || $('mis-lon').value);
      opiszZrodloMisji();
    });
  }

  $('mis-here').addEventListener('click', () => {
    misjaReczna = false;
    if (!plenerWspolrzedne) { liczPlanPlener(); return; }
    wstawWspolrzedne();
    opiszZrodloMisji();
  });

  /* ILE TO WŁAŚCIWIE LOTU — policzone PRZED pobraniem pliku.
   *
   * Pola „200 × 200, co 50 m" nie mówią nic o tym, czy to trzy minuty, czy
   * czterdzieści. A różnica jest zasadnicza: misja dłuższa niż jedna bateria
   * przerwie się w połowie, dron wróci do domu, a człowiek dowie się o tym
   * stojąc w polu. Liczba linii i długość trasy wychodzą z tych samych wzorów
   * co `siatka()` w lib/kmz.js — zestaw `plener` porównuje jedno z drugim,
   * żeby nie rozjechały się przy pierwszej poprawce. */
  const MAVIC_MINUT = 18;      // realny zapas na misję, z rezerwą na powrót

  function oszacujNalot() {
    const szer = Number($('mis-w').value) || 0;
    const dl = Number($('mis-l').value) || 0;
    const odstep = Number($('mis-odstep').value) || 0;
    const predkosc = Number($('mis-speed').value) || 0;
    if (!(szer > 0 && dl > 0 && odstep > 0 && predkosc > 0)) return null;
    const linii = Math.max(2, Math.ceil(szer / odstep) + 1);
    const metry = linii * dl + (linii - 1) * odstep;
    // +15% na zakręty i rozpędzanie — dron nie leci całej trasy z prędkością zadaną.
    const minuty = (metry / predkosc) * 1.15 / 60;
    return { linii, punktow: linii * 2, metry, minuty };
  }

  function pokazNalot() {
    const el = $('mis-lot');
    if (!el) return;
    const o = oszacujNalot();
    if (!o) { el.textContent = ''; return; }
    /* Separator dziesiętny z lokalizacji przeglądarki, nie na sztywno kropka.
       Pola współrzędnych (`type=number`) i tak pokazują polski przecinek, więc
       „1.20 km" tuż pod „49,29691" wyglądało jak dwie różne aplikacje. */
    const km = (o.metry / 1000).toLocaleString(undefined,
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const czesci = [t('pl.misLines', { n: o.linii, p: o.punktow }),
      t('pl.misDist', { km }),
      t('pl.misTime', { min: Math.round(o.minuty) })];
    el.className = 'field-hint';
    el.textContent = czesci.join(' · ');
    /* Dwa progi, oba twarde. 99 punktów to limit formatu WPML — powyżej plik
       i tak zostanie odrzucony, więc lepiej powiedzieć to teraz niż w polu. */
    if (o.punktow > 99) {
      el.className = 'field-hint plener-err';
      el.textContent += ' — ' + t('pl.misTooMany');
    } else if (o.minuty > MAVIC_MINUT) {
      el.className = 'field-hint plener-warn';
      el.textContent += ' — ' + t('pl.misTooLong', { min: MAVIC_MINUT });
    }
  }

  for (const id of ['mis-w', 'mis-l', 'mis-odstep', 'mis-speed']) {
    $(id).addEventListener('input', pokazNalot);
  }
  pokazNalot();

  $('mis-go').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const out = $('mis-out');
    const lat = Number($('mis-lat').value);
    const lon = Number($('mis-lon').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      out.textContent = t('pl.misNoCoords');
      out.className = 'plener-out mono plener-err';
      return;
    }
    b.disabled = true;
    out.className = 'plener-out mono';
    out.textContent = t('pl.misWorking');
    try {
      const r = await fetch('/api/plan/mission', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat, lon,
          szerokoscM: Number($('mis-w').value) || 200,
          dlugoscM: Number($('mis-l').value) || 200,
          odstepM: Number($('mis-odstep').value) || 50,
          kierunek: Number($('mis-kier').value) || 0,
          wysokosc: Number($('mis-alt').value) || 80,
          predkosc: Number($('mis-speed').value) || 6,
          nazwa: $('mis-name').value.trim() || 'misja',
        }),
      });
      if (!r.ok) {
        const d = await readJsonSafe(r);
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      /* Pobranie przez tymczasowy odsyłacz: żądanie jest POST-em, więc zwykły
         link nie wystarczy, a otwarcie w nowej karcie zostawiłoby pustą kartę. */
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${($('mis-name').value.trim() || 'misja').replace(/[^\w-]+/g, '-')}.kmz`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      out.textContent = t('pl.misDone', { kb: (blob.size / 1024).toFixed(1) });
    } catch (err) {
      out.textContent = err.message;
      out.className = 'plener-out mono plener-err';
    } finally {
      b.disabled = false;
    }
  });

  return { odswiezPlan, zamknijPlener };
}

if (typeof window !== 'undefined') window.utworzPlener = utworzPlener;
if (typeof module !== 'undefined') module.exports = { utworzPlener };

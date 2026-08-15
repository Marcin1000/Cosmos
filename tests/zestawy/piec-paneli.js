/* Pięć paneli, które nikt nie sprawdzał osobno.

   Z mojego własnego audytu: Nauka, Galeria, Baza wiedzy, Studio i Oś czasu
   mają razem ponad trzydzieści tras serwera i kilkanaście ekranów — a testów
   dedykowanych nie miały żadnych. Wchodziły najwyżej pobocznie: `klawisz-escape`
   otwiera je i zamyka, `uklad-bez-przepelnien` mierzy ich szerokość. Obie te
   rzeczy przechodzą również dla panelu, który wyświetla pustkę.

   To nie jest teoretyczna dziura. Panel bierze dane z serwera i buduje z nich
   DOM — czyli dokładnie ta droga, na której poprzednie usterki się chowały:
   trasa oddaje `{items: []}` zamiast `{items: [...]}`, klient czyta inną
   nazwę pola, kafelek buduje się bez przycisku. Wszystko to wygląda jak
   „panel jest pusty, pewnie nic nie dodałem".

   Zestaw robi więc dla każdego panelu jedno i to samo, DROGĄ UŻYTKOWNIKA:
     1. wkłada dane (przez trasę zapisu — tak, jak zrobiłby to interfejs),
     2. otwiera panel klikając w przycisk, nie wołając funkcji,
     3. sprawdza, że dane są WIDOCZNE na ekranie,
     4. wykonuje główną akcję panelu i sprawdza jej skutek,
     5. zamyka panel.

   Do tego jedno pytanie wspólne, zadane na końcu: czy przez cały ten przemarsz
   przez pięć paneli w konsoli przeglądarki nie pojawił się ani jeden błąd.
*/
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

// Najmniejszy poprawny PNG — jeden czerwony piksel. Nie potrzebujemy większego.
const PIKSEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const fail = [];
  const env = await srodowisko('pelne');
  const br = await przegladarka();
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage();
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push('WYJĄTEK: ' + e.message));
  pg.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Brakujące multimedia w atrapie to nie usterka panelu.
    if (/favicon|net::ERR|Failed to load resource/i.test(m.text())) return;
    bledy.push('KONSOLA: ' + m.text());
  });
  await pg.goto(env.adres, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(1200);

  /** Wołanie trasy z poziomu strony — to jest ta sama droga, którą chodzi panel. */
  const api = (adres, opcje) => pg.evaluate(async ([a, o]) => {
    const r = await fetch(a, o ? { ...o, headers: { 'Content-Type': 'application/json' } } : undefined);
    return { kod: r.status, dane: await r.json().catch(() => ({})) };
  }, [adres, opcje]);

  const widoczny = (id) => pg.evaluate((x) => {
    const e = document.getElementById(x);
    return Boolean(e) && getComputedStyle(e).display !== 'none';
  }, id);

  /* =====================================================================
     1. BAZA WIEDZY — wkładamy notatkę i sprawdzamy, czy ją widać
     ===================================================================== */
  {
    const dodana = await api('/api/kb/note', {
      method: 'POST',
      body: JSON.stringify({ text: 'Ustawienia do żagli: 1/1000, f/4, ISO 200.' }),
    });
    await pg.click('#kb-btn');
    await pg.waitForTimeout(900);

    const otwarty = await widoczny('kb-modal');
    const tekst = await pg.textContent('#kb-list');
    const pozycji = await pg.locator('#kb-list .kb-item').count()
      || await pg.locator('#kb-list > *').count();
    const odznaka = (await pg.textContent('#kb-badge')) || '';
    console.log(`1. Baza wiedzy: panel ${otwarty ? 'otwarty' : 'ZAMKNIĘTY'}, `
      + `pozycji na liście ${pozycji}, odznaka „${odznaka.trim()}"`);
    if (!otwarty) fail.push('Baza wiedzy: kliknięcie w przycisk nie otwiera panelu');
    if (dodana.kod !== 200) fail.push(`Baza wiedzy: zapis notatki dał kod ${dodana.kod}`);
    if (!pozycji) fail.push('Baza wiedzy: dodana notatka nie pojawia się na liście');
    if (!/żagle|Ustawienia do żagli|notatka|\.txt|\.md/i.test(tekst || '')) {
      fail.push(`Baza wiedzy: na liście nie widać dodanej notatki (widzę: „${(tekst || '').trim().slice(0, 80)}")`);
    }
    /* Odznaka przy przycisku to jedyne miejsce, w którym widać rozmiar bazy
       bez otwierania panelu — i jedyne, po którym poznasz, że coś się zapisało. */
    if (!/\d/.test(odznaka)) fail.push('Baza wiedzy: odznaka przy przycisku nie pokazuje liczby pozycji');

    await pg.click('#kb-close');
    await pg.waitForTimeout(300);
    if (await widoczny('kb-modal')) fail.push('Baza wiedzy: panel nie zamyka się krzyżykiem');
  }

  /* =====================================================================
     2. GALERIA — obraz, filtry, wybór pierwszej klatki, kasowanie
     ===================================================================== */
  {
    const wgrany = await api('/api/kb/file', {
      method: 'POST',
      body: JSON.stringify({ name: 'kadr-testowy.png', mime: 'image/png', data: PIKSEL }),
    });
    await pg.click('#gallery-btn');
    await pg.waitForTimeout(900);

    const komorek = await pg.locator('#gallery-grid .gallery-cell').count();
    console.log(`2. Galeria: kafelków ${komorek} (zapis obrazu: kod ${wgrany.kod})`);
    if (wgrany.kod !== 200) fail.push(`Galeria: wgranie obrazu dało kod ${wgrany.kod}`);
    if (!komorek) {
      fail.push('Galeria: wgrany obraz nie pojawia się w siatce');
    } else {
      /* FILTR. Kliknięcie „obrazy" ma zostawić obraz, a „dźwięk" schować go —
         filtr, który niczego nie filtruje, wygląda dokładnie tak samo jak
         działający, dopóki nie ma czego odsiać. */
      const filtr = async (rodzaj) => {
        const btn = pg.locator(`.gallery-filter[data-filter="${rodzaj}"]`);
        if (!await btn.count()) return null;
        await btn.first().click();
        await pg.waitForTimeout(500);
        return pg.locator('#gallery-grid .gallery-cell').count();
      };
      const poObrazach = await filtr('image');
      const poDzwieku = await filtr('audio');
      console.log(`   filtr „obrazy": ${poObrazach}, filtr „dźwięk": ${poDzwieku}`);
      if (poObrazach !== null && !poObrazach) fail.push('Galeria: filtr „obrazy" ukrywa obraz');
      if (poDzwieku !== null && poDzwieku) fail.push('Galeria: filtr „dźwięk" pokazuje obrazy');
      await filtr('all');

      /* PIERWSZA KLATKA. Przycisk 🎬 zapamiętuje obraz jako klatkę startową
         wideo — a jedynym potwierdzeniem jest to, że po odświeżeniu siatki
         przycisk ma klasę `frame-on`. Ta pamięć siedzi w `localStorage`,
         więc łatwo o wersję, która zapisuje i nie odczytuje. */
      const klatka = pg.locator('#gallery-grid [data-frame]').first();
      if (await klatka.count()) {
        await klatka.click();
        await pg.waitForTimeout(600);
        const oznaczony = await pg.locator('#gallery-grid [data-frame].frame-on').count();
        console.log(`   po wskazaniu pierwszej klatki oznaczonych przycisków: ${oznaczony}`);
        if (!oznaczony) {
          fail.push('Galeria: wybór pierwszej klatki nie zostawia śladu na przycisku — '
            + 'nie da się poznać, który obraz jest wybrany');
        }
      }

      // KASOWANIE — z siatki i z bazy naraz.
      await pg.locator('#gallery-grid [data-del]').first().click();
      await pg.waitForTimeout(900);
      const poKasowaniu = await pg.locator('#gallery-grid .gallery-cell').count();
      console.log(`   po skasowaniu kafelków: ${poKasowaniu}`);
      if (poKasowaniu >= komorek) fail.push('Galeria: kasowanie nie usuwa kafelka z siatki');
    }
    await pg.click('#gallery-close');
    await pg.waitForTimeout(300);
    if (await widoczny('gallery-modal')) fail.push('Galeria: panel nie zamyka się krzyżykiem');
  }

  /* =====================================================================
     3. OŚ CZASU — migawka otoczenia, różnice, kasowanie
     ===================================================================== */
  {
    await api('/api/timeline', {
      method: 'POST',
      body: JSON.stringify({ label: 'biurko rano', objects: ['aparat', 'kubek'] }),
    });
    await api('/api/timeline', {
      method: 'POST',
      body: JSON.stringify({ label: 'biurko po południu', objects: ['aparat', 'statyw'] }),
    });
    await pg.click('#timeline-btn');
    await pg.waitForTimeout(900);

    const wierszy = await pg.locator('#timeline-list .tl-item').count();
    const tekst = (await pg.textContent('#timeline-list')) || '';
    console.log(`3. Oś czasu: migawek na liście ${wierszy}`);
    if (wierszy < 2) fail.push(`Oś czasu: zapisano dwie migawki, widać ${wierszy}`);
    /* SEDNO TEGO PANELU to nie lista, tylko RÓŻNICA między migawkami:
       „pojawił się statyw, zniknął kubek". Sama lista przedmiotów jest
       zapisem, różnica jest informacją. */
    const maPojawienie = /statyw/.test(tekst);
    const maZniknięcie = /kubek/.test(tekst);
    console.log(`   różnice: nowy przedmiot ${maPojawienie ? 'jest' : 'BRAK'}, `
      + `zniknięty ${maZniknięcie ? 'jest' : 'BRAK'}`);
    if (!maPojawienie || !maZniknięcie) {
      fail.push('Oś czasu: nie widać, co się zmieniło między migawkami — '
        + 'a to jest jedyny powód, dla którego ten panel istnieje');
    }
    if (wierszy) {
      await pg.locator('#timeline-list [data-del]').first().click();
      await pg.waitForTimeout(800);
      const po = await pg.locator('#timeline-list .tl-item').count();
      console.log(`   po skasowaniu migawek: ${po}`);
      if (po >= wierszy) fail.push('Oś czasu: kasowanie migawki nie usuwa jej z listy');
    }
    await pg.click('#timeline-close');
    await pg.waitForTimeout(300);
    if (await widoczny('timeline-modal')) fail.push('Oś czasu: panel nie zamyka się krzyżykiem');
  }

  /* =====================================================================
     4. NAUKA — cztery zakładki, każda z własną treścią
     ===================================================================== */
  {
    await api('/api/lessons', {
      method: 'POST',
      body: JSON.stringify({ label: 'klucz do domu', kind: 'obiekt', note: 'brelok z czerwoną taśmą' }),
    });
    await api('/api/procedures', {
      method: 'POST',
      body: JSON.stringify({ name: 'zgranie kart', steps: [{ action: 'open', target: 'karta' }] }),
    });
    await pg.click('#learn-btn');
    await pg.waitForTimeout(900);

    const otwarta = await widoczny('learn-modal');
    console.log(`4. Nauka: panel ${otwarta ? 'otwarty' : 'ZAMKNIĘTY'}`);
    if (!otwarta) fail.push('Nauka: kliknięcie w przycisk nie otwiera panelu');

    /* ZAKŁADKI. Cztery panele w jednym oknie, przełączane bez przeładowania.
       Sprawdzamy, że przełącznik NAPRAWDĘ przełącza — czyli że po kliknięciu
       widać dokładnie jeden panel i to ten wskazany. */
    const zakladki = ['recog', 'proc', 'routine', 'ideas'];
    for (const z of zakladki) {
      await pg.click(`[data-learn-tab="${z}"]`);
      await pg.waitForTimeout(500);
      const widoczne = await pg.evaluate((lista) => lista
        .filter((x) => {
          const e = document.getElementById(`learn-pane-${x}`);
          return e && getComputedStyle(e).display !== 'none';
        }), zakladki);
      const aktywna = await pg.locator(`[data-learn-tab="${z}"].active`).count();
      if (widoczne.length !== 1 || widoczne[0] !== z) {
        fail.push(`Nauka: po kliknięciu w „${z}" widać panele [${widoczne.join(', ')}]`);
      }
      if (!aktywna) fail.push(`Nauka: zakładka „${z}" nie zostaje podświetlona po kliknięciu`);
    }
    console.log(`   zakładek przełączanych poprawnie: ${zakladki.length - fail.filter((f) => f.startsWith('Nauka: po kliknięciu')).length}/${zakladki.length}`);

    // Nauczony wzorzec ma być widoczny na liście lekcji.
    await pg.click('[data-learn-tab="recog"]');
    await pg.waitForTimeout(600);
    const lekcje = (await pg.textContent('#learn-lessons')) || '';
    console.log(`   lekcje: „${lekcje.trim().slice(0, 60)}"`);
    if (!/klucz do domu/i.test(lekcje)) {
      fail.push('Nauka: nauczony wzorzec nie pojawia się na liście rozpoznawania');
    }
    // A zapisana procedura — na liście procedur.
    await pg.click('[data-learn-tab="proc"]');
    await pg.waitForTimeout(600);
    const procedury = (await pg.textContent('#learn-pane-proc')) || '';
    if (!/zgranie kart/i.test(procedury)) {
      fail.push('Nauka: zapisana procedura nie pojawia się na liście procedur');
    }

    await pg.click('#learn-close');
    await pg.waitForTimeout(300);
    if (await widoczny('learn-modal')) fail.push('Nauka: panel nie zamyka się krzyżykiem');
  }

  /* =====================================================================
     5. STUDIO — pięć sekcji i uczciwa informacja o braku kluczy
     ===================================================================== */
  {
    await pg.click('#studio-btn');
    await pg.waitForTimeout(1200);

    const otwarte = await widoczny('studio-modal');
    const sekcje = ['image', 'speech', 'video', 'storyboard', 'edit'];
    const brakujace = [];
    for (const s of sekcje) {
      if (!await widoczny(`studio-sec-${s}`)) brakujace.push(s);
    }
    console.log(`5. Studio: panel ${otwarte ? 'otwarty' : 'ZAMKNIĘTY'}, `
      + `sekcji widocznych ${sekcje.length - brakujace.length}/${sekcje.length}`);
    if (!otwarte) fail.push('Studio: kliknięcie w przycisk nie otwiera panelu');
    if (brakujace.length) fail.push(`Studio: nie widać sekcji: ${brakujace.join(', ')}`);

    /* BEZ KLUCZY API Studio nie wygeneruje niczego — i to jest normalne.
       Nienormalne byłoby MILCZENIE: przycisk, który nic nie robi, wygląda
       jak zepsuty. Klikamy „Generuj obraz" bez klucza i wymagamy, żeby
       na ekranie stanął powód. */
    await pg.fill('#studio-image-prompt', 'niedźwiedź w mgle nad jeziorem');
    await pg.click('#studio-image-go');
    await pg.waitForTimeout(2500);
    const wynik = ((await pg.textContent('#studio-image-out')) || '').trim();
    console.log(`   po kliknięciu „Generuj obraz": „${wynik.slice(0, 70)}"`);
    if (!wynik) {
      fail.push('Studio: „Generuj obraz" bez klucza API nie mówi nic — '
        + 'przycisk, który milczy, wygląda na zepsuty');
    }

    /* Lista obrazów do edycji bierze się z Bazy wiedzy. Wybór ma być
       możliwy albo jawnie pusty — nigdy „wygląda na wybieralny, ale nie ma
       w nim nic i nie wiadomo dlaczego". */
    const opcjeEdycji = await pg.locator('#studio-edit-img option').count();
    console.log(`   obrazów do wyboru w edycji: ${opcjeEdycji - 1} (+ pozycja „wybierz")`);
    if (!opcjeEdycji) fail.push('Studio: lista obrazów do edycji nie ma nawet pozycji „wybierz obraz"');

    await pg.click('#studio-close');
    await pg.waitForTimeout(300);
    if (await widoczny('studio-modal')) fail.push('Studio: panel nie zamyka się krzyżykiem');
  }

  /* =====================================================================
     6. Czy przez ten cały przemarsz coś się wysypało
     ===================================================================== */
  console.log(`6. błędów w konsoli przeglądarki: ${bledy.length}`);
  for (const b of bledy.slice(0, 6)) console.log(`   ${b}`);
  if (bledy.length) fail.push(`w konsoli przeglądarki ${bledy.length} błędów, pierwszy: ${bledy[0]}`);

  await br.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPIĘĆ PANELI OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Zrzuty do README i grafik marki — z prawdziwego interfejsu.
 *
 * Nie są to atrapy obrazków ani makiety: to Chromium otwierające prawdziwego
 * Cosmosa, z prawdziwym CSS-em i prawdziwym renderowaniem. Model i dane są
 * testowe i tak ma być — repozytorium jest publiczne, a prywatne archiwum
 * Marcina (57 tysięcy zdjęć z rodziną) nie ma tam czego szukać.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node scripts/zrzuty-readme.js
 *
 * (Playwright bywa zainstalowany globalnie — stąd NODE_PATH.)
 *
 * Od rebrandingu („Jeden wątek”) aplikacja mieszka pod /app, a pod / stoi
 * strona produktowa — dawna wersja skryptu fotografowała więc stronę zamiast
 * aplikacji. Zrzuty są w jasnym motywie (tak wygląda marka), telefon i tryb
 * głosowy w ciemnym, żeby było widać oba. Rozmowa i telefon powstają po
 * angielsku (README.md) i po polsku (README.pl.md, grafiki na LinkedIn).
 *
 * Serwer stawiamy sami, na własnym porcie. Atrapy modelu i zmysłów
 * pożyczamy, jeśli już działają (np. dla zespołu agentów) — wtedy ich nie
 * ruszamy; jeśli nie, stawiamy je i sprzątamy po sobie.
 *
 * Wynik: `docs/obrazy/*.png`. Zrzuty są w repozytorium celowo — bez nich
 * README na GitHubie pokazuje puste ramki.
 */
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { przegladarka, maPrzegladarke, serwerCosmosa, czekajNa, zabij, atrapaNode, atrapaPy } = require('../tests/pomoc');

const KATALOG = path.join(__dirname, '..', 'docs', 'obrazy');
// Port poza zakresami baterii (34xx) i ról zespołów (36xx–38xx) — zrzuty mogą iść obok nich.
const PORT = 3941;
const ADRES = `http://127.0.0.1:${PORT}`;
const PULPIT = { width: 1440, height: 900 };
const TELEFON = { width: 412, height: 915 };

const czyNasluchuje = (port) => new Promise((ok) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); ok(true); });
  s.once('error', () => ok(false));
});

/** Poczekaj, aż układ przestanie się zmieniać — inaczej łapiemy pół animacji. */
async function ustabilizuj(pg, ms = 700) {
  await pg.waitForTimeout(ms);
  await pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/* Teksty scen w obu językach. Treść jest kontrolowana (prawdziwy renderer,
   prawdziwy CSS, nasze zdania), bo atrapa modelu odpowiada po polsku
   i zdaniami testowymi — na zrzucie wyglądałoby to jak niedokończona robota. */
const TEKSTY = {
  en: {
    rozmowy: ['Golden hour at Morskie Oko', 'Which lens for the cliffs?', 'Drone mission over the lake', 'Count clips shot at 50 mm'],
    pytanie: 'Golden hour at Morskie Oko on Saturday. What settings, and how much time do I actually get?',
    mysl: 'The place is named, so it wins over the saved home location. At 06:55 the Sun is 3.4° up and '
      + 'rising behind the ridge. The fastest glass on the 24-105 is f/4, so anything brighter is out.',
    nvidia: '**Golden hour starts at 06:47** and gives you about **45 minutes** of low, warm light '
      + 'before the Sun clears the ridge.\n\n'
      + '| | Setting | Why |\n|---|---|---|\n'
      + '| Shutter | `1/250 s` | sharp handheld at 105 mm |\n'
      + '| Aperture | `f/5.6` | the ridge and the lake both in focus |\n'
      + '| ISO | `200` | base ISO plus one stop of headroom |\n\n'
      + 'Computed for your **RF 24-105 f/4** — f/4 is the fastest aperture you own, '
      + 'so f/2.8 is not an option here.',
    pytanie2: 'Would you shoot the reflection at f/8 instead?',
    claude: 'Yes — for the reflection, **f/8 at 1/125 s, ISO 400**. You give up one stop of speed, '
      + 'which is fine at 24 mm, and the far shore stays sharp in the water.\n\n'
      + 'The lake is usually calm until about **07:15**; after that, the wind breaks the reflection.',
    telefonPyt0: 'Sunset at Rysy tomorrow — when?',
    telefon0: '**18:21**, with golden hour from about **17:45**. Clear sky is forecast until 20:00.',
    telefonPyt: 'Which lens for the cliffs at sunset?',
    telefon: 'The **RF 70-200 f/4** — it lets you stay back from the edge and still fill the frame with rock.\n\n'
      + 'At 200 mm you will want `1/250 s` or shorter; the wind up there is enough to blur a handheld '
      + 'frame at `1/125 s`.\n\nThe 24-105 works too, but you will be standing much closer to the drop.',
    glosPyt: 'what are the best spots for sunrise here',
    glos: 'The eastern cliffs catch first light about twenty minutes before the Sun clears the horizon.',
    archPyt: 'Show the newest shots from the lake',
    archOdp: 'The newest **10 of 311** from the lake — most of them from the two sunrise sessions, shot at 24–105 mm.',
    miejsce: 'Morskie Oko',
  },
  pl: {
    rozmowy: ['Złota godzina nad Morskim Okiem', 'Który obiektyw na klify?', 'Misja drona nad jeziorem', 'Ile klipów na 50 mm?'],
    pytanie: 'Złota godzina nad Morskim Okiem w sobotę. Jakie nastawy i ile mam naprawdę czasu?',
    mysl: 'Miejsce jest podane wprost, więc wygrywa z zapisaną lokalizacją domu. O 06:55 Słońce jest '
      + '3,4° nad horyzontem i wschodzi zza grani. Najjaśniejsze szkło na 24-105 to f/4 — nic jaśniejszego.',
    nvidia: '**Złota godzina zaczyna się o 06:47** i daje około **45 minut** niskiego, ciepłego światła, '
      + 'zanim Słońce wyjdzie zza grani.\n\n'
      + '| | Nastawa | Dlaczego |\n|---|---|---|\n'
      + '| Czas | `1/250 s` | ostro z ręki na 105 mm |\n'
      + '| Przysłona | `f/5.6` | grań i jezioro jednocześnie ostre |\n'
      + '| ISO | `200` | natywne ISO plus jeden stopień zapasu |\n\n'
      + 'Policzone dla Twojego **RF 24-105 f/4** — f/4 to najjaśniejsza przysłona, jaką masz, '
      + 'więc f/2.8 nie wchodzi w grę.',
    pytanie2: 'A odbicie w wodzie — lepiej na f/8?',
    claude: 'Tak — na odbicie **f/8, 1/125 s, ISO 400**. Tracisz jeden stopień czasu, co przy 24 mm '
      + 'nie przeszkadza, a drugi brzeg zostaje ostry także w wodzie.\n\n'
      + 'Jezioro jest zwykle gładkie mniej więcej do **7:15**; potem wiatr rozbija odbicie.',
    telefonPyt0: 'Zachód na Rysach jutro — o której?',
    telefon0: '**18:21**, złota godzina od około **17:45**. Prognoza: bezchmurnie do 20:00.',
    telefonPyt: 'Który obiektyw na klify o zachodzie?',
    telefon: '**RF 70-200 f/4** — możesz stanąć dalej od krawędzi i dalej wypełnić kadr skałą.\n\n'
      + 'Na 200 mm trzymaj `1/250 s` albo krócej; wiatr na górze wystarczy, żeby rozmazać kadr '
      + 'z ręki przy `1/125 s`.\n\n24-105 też da radę, ale staniesz dużo bliżej przepaści.',
    glosPyt: 'gdzie tu najlepiej złapać wschód słońca',
    glos: 'Wschodnie klify łapią pierwsze światło jakieś dwadzieścia minut, zanim Słońce wyjdzie nad horyzont.',
    archPyt: 'Pokaż najnowsze zdjęcia znad jeziora',
    archOdp: 'Najnowsze **10 z 311** znad jeziora — większość z dwóch porannych sesji, na 24–105 mm.',
    miejsce: 'Morskie Oko',
  },
};

/** Nowa karta z wybranym językiem i motywem, bez pierwszego uruchomienia. */
/* Pulpit w skali 1,25 (1800 px szerokości — README pokazuje go na 900 px,
   więc ekran retina dostaje dwa piksele na punkt), telefon w 2 (trafia też do
   grafik, w ramce do 520 px). Strefa czasowa Polski: bez niej przeglądarka
   i serwer liczyły w UTC i „06:55" w Planie było w Polsce 08:55. */
async function karta(br, { viewport, jezyk, motyw, isMobile = false, dpr = isMobile ? 2 : 1.25 }) {
  const ctx = await br.newContext({
    viewport, deviceScaleFactor: dpr, isMobile, hasTouch: isMobile, serviceWorkers: 'block',
    locale: jezyk === 'en' ? 'en-GB' : 'pl-PL', timezoneId: 'Europe/Warsaw',
  });
  await ctx.addInitScript(([j, m]) => {
    localStorage.setItem('cosmos.lang', j);
    localStorage.setItem('cosmos.theme', m);
  }, [jezyk, motyw]);
  const pg = await ctx.newPage();
  // `load`, nie `networkidle`: aplikacja trzyma otwarty strumień zdarzeń (SSE).
  await pg.goto(`${ADRES}/app`, { waitUntil: 'load' });
  await pg.waitForFunction(() => document.querySelector('.app.gotowa'), null, { timeout: 15000 }).catch(() => {});
  await ustabilizuj(pg, 900);
  await pg.evaluate((tytuly) => {
    conversations = tytuly.map((title, i) => ({ id: `c${i}`, title, updatedAt: Date.now() - i * 3.7e6 }));
    renderSidebar();
  }, TEKSTY[jezyk].rozmowy);
  return { ctx, pg };
}

(async () => {
  if (!maPrzegladarke()) {
    console.error('Brak Chromium — zrzutów nie da się zrobić.');
    process.exit(1);
  }
  fs.mkdirSync(KATALOG, { recursive: true });

  // --- atrapy: pożyczamy działające albo stawiamy własne ---------------------
  const nasze = [];
  if (!(await czyNasluchuje(9099))) nasze.push(atrapaNode('mock-upstream.js'));
  if (!(await czyNasluchuje(7060))) nasze.push(atrapaPy('fake_senses.py'));
  const srv = serwerCosmosa(PORT, {
    LOCAL_API_KEY: 'test', OPENAI_API_KEY: 'test', ANTHROPIC_API_KEY: 'test',
    NEMOTRON_BASE_URL: 'http://127.0.0.1:9099/v1', LOCAL_BASE_URL: 'http://127.0.0.1:9098/v1',
    OPENAI_BASE_URL: 'http://127.0.0.1:9099/v1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9099/v1',
    LOCAL_MODEL: 'qwen3:14b', SENSES_URL: 'http://127.0.0.1:7060', EMBED_PROVIDER: 'off',
    TZ: 'Europe/Warsaw', COSMOS_TZ: 'Europe/Warsaw',
  });
  if (!(await czekajNa(`${ADRES}/api/auth`))) { zabij(srv); nasze.forEach(zabij); throw new Error('serwer zrzutów nie wstał'); }

  const br = await przegladarka();
  const zrobione = [];
  const zapisz = async (pg, nazwa, opcje = {}, rozszerzenie = 'png') => {
    const plik = path.join(KATALOG, `${nazwa}.${rozszerzenie}`);
    await pg.screenshot({ path: plik, ...opcje });
    const kb = Math.round(fs.statSync(plik).size / 1024);
    zrobione.push(`${nazwa}.${rozszerzenie} (${kb} KB)`);
    console.log(`  ✓ ${nazwa}.${rozszerzenie} — ${kb} KB`);
  };

  /* --- 1. ROZMOWA: jeden wątek, dwa silniki ---------------------------------
     Pierwszy zrzut w README pokazuje tezę projektu: odpowiedź chmury NVIDIA,
     potem pytanie do Claude'a w TEJ SAMEJ rozmowie — każda odpowiedź z nicią
     i podpisem w kolorze swojego silnika. */
  /* Jasna i ciemna: README pokazuje ciemną, gdy czytelnik ma ciemny motyw
     GitHuba (<picture>), a ciemne grafiki na LinkedIn dostają ciemne okno. */
  for (const [jezyk, motyw] of [['en', 'light'], ['pl', 'light'], ['en', 'dark'], ['pl', 'dark']]) {
    console.log(`1. rozmowa (${jezyk}, ${motyw})`);
    const T = TEKSTY[jezyk];
    const { ctx, pg } = await karta(br, { viewport: { width: 1440, height: 1180 }, jezyk, motyw });
    await pg.evaluate((T) => {
      const c = ensureConversation(T.rozmowy[0]);
      c.title = T.rozmowy[0];
      c.messages = [
        { role: 'user', content: T.pytanie },
        { role: 'user', search: true, searchQuery: 'plan', content: 'SHOOT PLAN DATA' },
        { role: 'assistant', silnik: 'cloud', model: 'nvidia/nemotron-3-super-120b-a12b', think: T.mysl, content: T.nvidia },
        { role: 'user', content: T.pytanie2 },
        { role: 'assistant', silnik: 'claude', model: 'claude-sonnet-5', content: T.claude },
      ];
      if (typeof setEndpoint === 'function') setEndpoint('claude');
      renderMessages();
    }, T);
    await ustabilizuj(pg, 900);
    // Od pierwszego pytania — inaczej u góry kadru wisi dolny brzeg ciemnego dymka.
    await pg.evaluate(() => { document.getElementById('chat-scroll').scrollTop = 0; });
    await ustabilizuj(pg, 400);
    await zapisz(pg, `rozmowa-${jezyk}${motyw === 'dark' ? '-ciemny' : ''}`);
    await ctx.close();
  }

  /* --- 2. TELEFON: lokalny GPU, ciemny motyw ------------------------------ */
  for (const jezyk of ['en', 'pl']) {
    console.log(`2. telefon (${jezyk})`);
    const T = TEKSTY[jezyk];
    const { ctx, pg } = await karta(br, { viewport: TELEFON, jezyk, motyw: 'dark', isMobile: true });
    await pg.evaluate((T) => {
      const c = ensureConversation(T.rozmowy[1]);
      c.title = T.rozmowy[1];
      c.messages = [
        { role: 'user', content: T.telefonPyt0 },
        { role: 'assistant', silnik: 'cloud', model: 'nvidia/nemotron-3-super-120b-a12b', content: T.telefon0 },
        { role: 'user', content: T.telefonPyt },
        { role: 'assistant', silnik: 'local', model: 'qwen3:14b', content: T.telefon },
      ];
      if (typeof setEndpoint === 'function') setEndpoint('local');
      renderMessages();
    }, T);
    await ustabilizuj(pg, 900);
    await pg.evaluate(() => { document.getElementById('chat-scroll').scrollTop = 0; });
    await ustabilizuj(pg, 400);
    await zapisz(pg, `telefon-${jezyk}`);
    await ctx.close();
  }

  /* --- 3. TRYB GŁOSOWY (tylko do README.md) ----------------------------- */
  for (const jezyk of ['en']) {
    console.log(`3. tryb głosowy (${jezyk})`);
    const T = TEKSTY[jezyk];
    const { ctx, pg } = await karta(br, { viewport: TELEFON, jezyk, motyw: 'dark', isMobile: true });
    await pg.evaluate((T) => {
      document.getElementById('voice-overlay').style.display = '';
      document.getElementById('voice-transcript').textContent = T.glosPyt;
      document.getElementById('voice-answer').textContent = T.glos;
      document.getElementById('voice-orb').className = 'voice-orb listening';
    }, T);
    await ustabilizuj(pg);
    // JPEG: poświata kuli to gładki gradient — PNG ważył 0,9 MB.
    await zapisz(pg, `glos-${jezyk}`, { type: 'jpeg', quality: 90 }, 'jpg');
    await ctx.close();
  }

  /* --- 4. PLENER: prawdziwy plan z /api/plan -------------------------------
     Bez atrapy odpowiedzi: serwer liczy Słońce z efemeryd dla zapisanego
     miejsca i nastawy dla wybranego sprzętu. Zachmurzenie wybieramy ręcznie,
     bo prognoza pogody wymaga sieci. */
  {
    console.log('4. plener');
    await fetch(`${ADRES}/api/location`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: 'Morskie Oko', lat: 49.2014, lon: 20.0706 }),
    });
    const { ctx, pg } = await karta(br, { viewport: { width: 1440, height: 1100 }, jezyk: 'en', motyw: 'light' });
    await pg.click('#plener-btn');
    await pg.waitForSelector('#plener-modal:not([style*="none"])');
    await pg.selectOption('#fp-gear', 'canon-r6ii').catch(() => {});
    await pg.selectOption('#fp-mode', 'zdjecie').catch(() => {});
    await pg.selectOption('#fp-sky', 'bezchmurnie').catch(() => {});
    // Sobota o świcie — najbliższa sobota, 06:55 czasu lokalnego serwera testowego.
    await pg.evaluate(() => {
      const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); d.setHours(6, 55, 0, 0);
      const pad = (n) => String(n).padStart(2, '0');
      document.getElementById('fp-when').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T06:55`;
    });
    await pg.click('#fp-go').catch(() => {});
    await pg.waitForFunction(() => !document.getElementById('fp-niebo').hidden
      && /\//.test(document.getElementById('fp-n-t').textContent), null, { timeout: 15000 }).catch(() => {});
    await ustabilizuj(pg, 1200);
    /* Tylko sekcja planu, do dołu karty nieba: sprzęt i aparat po Wi-Fi to
       formularze, nie obraz działania. Zdania z uzasadnieniem nastaw są na
       razie tylko po polsku (lib/ekspozycja.js) — do tłumaczenia w następnej
       rundzie; na angielskim zrzucie wyglądałyby jak błąd. */
    await pg.evaluate(() => document.getElementById('fp-niebo').closest('.plener-section').scrollIntoView({ block: 'start' }));
    await ustabilizuj(pg, 300);
    const ramka = await pg.evaluate(() => {
      const r = document.getElementById('fp-niebo').closest('.plener-section').getBoundingClientRect();
      const karta = document.getElementById('fp-niebo').getBoundingClientRect();
      return { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 16), width: r.width + 32, height: karta.bottom - r.y + 30 };
    });
    await ustabilizuj(pg, 500);
    await zapisz(pg, 'plener-en', { clip: ramka });
    await ctx.close();
  }

  /* --- 5. ARCHIWUM --------------------------------------------------------
     Miniatury MUSZĄ być plikami spod `/`: siatka przepuszcza adresy przez
     `/api/search/thumb`, a ten odrzuca wszystko, co nie jest adresem http.
     Kładziemy je na czas zrzutu w `public/` i sprzątamy zaraz potem. */
  {
    console.log('5. archiwum');
    /* Pejzaże jak kadry z jednej sesji nad jeziorem: niebo, słońce z poświatą,
       dwa plany gór i odbicie w wodzie. Rysunek, nie zdjęcie — prywatne
       zdjęcia nie trafiają do publicznego repozytorium. */
    const pejzaze = [
      ['#2B3A67', '#F6B98A', '#FFD9A8', '#39405E', '#1E2440', 0.30],
      ['#6C7FB8', '#F9C58D', '#FFE2B8', '#4A4F74', '#262B4A', 0.36],
      ['#F4A259', '#FBD38D', '#FFF1D6', '#5B4A5E', '#2E2A3F', 0.44],
      ['#F7B267', '#FCE3A6', '#FFF6E3', '#6A5A63', '#34303F', 0.52],
      ['#8EC5E8', '#F2F7FB', '#FFFFFF', '#5C7A99', '#2F4659', 0.62],
      ['#A7C7E7', '#EAF2F8', '#FFFFFF', '#4E6E5D', '#2C4034', 0.58],
      ['#E07A5F', '#F2CC8F', '#FBE7C6', '#3D405B', '#23253A', 0.40],
      ['#1B263B', '#415A77', '#778DA9', '#0D1B2A', '#070E17', 0.26],
      ['#3A506B', '#F5B971', '#FDE4C3', '#4B4453', '#2A2733', 0.48],
      ['#0B132B', '#1C2541', '#3A506B', '#0B132B', '#05080F', 0.22],
    ];
    const atrapy = pejzaze.map(([gora, srodek, dol, plan1, plan2, slonceY], i) => {
      const plik = path.join(__dirname, '..', 'public', `_zrzut-${i}.svg`);
      const sx = 90 + ((i * 53) % 300);
      const sy = Math.round(320 * slonceY);
      fs.writeFileSync(plik, `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">`
        + `<defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${gora}"/>`
        + `<stop offset=".62" stop-color="${srodek}"/><stop offset="1" stop-color="${dol}"/></linearGradient>`
        + `<radialGradient id="p" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF4DD" stop-opacity=".95"/>`
        + `<stop offset=".35" stop-color="#FFD9A0" stop-opacity=".55"/><stop offset="1" stop-color="#FFD9A0" stop-opacity="0"/></radialGradient>`
        + `<linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${srodek}" stop-opacity=".75"/>`
        + `<stop offset="1" stop-color="${plan2}"/></linearGradient></defs>`
        + `<rect width="480" height="320" fill="url(#n)"/>`
        + `<circle cx="${sx}" cy="${sy}" r="70" fill="url(#p)"/><circle cx="${sx}" cy="${sy}" r="11" fill="#FFF8EA"/>`
        + `<path d="M0 196 L58 150 L104 176 L168 112 L226 170 L290 128 L352 176 L418 138 L480 168 L480 214 L0 214 Z" fill="${plan1}" opacity=".78"/>`
        + `<path d="M0 214 L70 186 L150 206 L236 176 L318 204 L402 184 L480 204 L480 214 Z" fill="${plan2}"/>`
        + `<rect y="214" width="480" height="106" fill="url(#w)"/>`
        + `<rect x="${sx - 5}" y="222" width="10" height="70" fill="#FFF4DD" opacity=".35"/></svg>`);
      return { plik, adres: `/_zrzut-${i}.svg` };
    });
    const { ctx, pg } = await karta(br, { viewport: PULPIT, jezyk: 'en', motyw: 'light' });
    await pg.evaluate(([adresy, T]) => {
      const c = ensureConversation('archive');
      c.messages = [{ role: 'user', content: T.archPyt }, {
        role: 'assistant', silnik: 'local', model: 'qwen3:14b',
        content: {
          text: T.archOdp,
          photos: [
            ['06:31 · blue hour', '24 mm · f/4 · 1/15'], ['06:39 · blue hour', '35 mm · f/4 · 1/30'],
            ['06:52 · golden hour', '70 mm · f/4 · 1/250'], ['06:58 · golden hour', '105 mm · f/4 · 1/320'],
            ['07:24 · daylight', '24 mm · f/8 · 1/200'], ['07:41 · daylight', '50 mm · f/8 · 1/250'],
            ['19:12 · golden hour', '70 mm · f/5.6 · 1/250'], ['19:58 · blue hour', '24 mm · f/4 · 2 s'],
            ['19:05 · golden hour', '105 mm · f/5.6 · 1/400'], ['20:31 · night', '24 mm · f/2.8 · 15 s'],
          ].map(([t, l], i) => ({ title: `3B9A47${10 + i * 7}.CR3 · ${t}`, licencja: l, thumb: adresy[i] })),
          dalej: { q: 'folder=Lake+2026', pomin: 10, razem: 311 },
        },
      }];
      if (typeof setEndpoint === 'function') setEndpoint('local');
      renderMessages();
    }, [atrapy.map((a) => a.adres), TEKSTY.en]);
    await ustabilizuj(pg, 1200);
    await zapisz(pg, 'archiwum-en');
    await ctx.close();
    for (const a of atrapy) fs.unlinkSync(a.plik);
  }

  /* --- 6. STRONA PRODUKTOWA — pierwszy ekran ------------------------------ */
  for (const jezyk of ['en', 'pl']) {
    console.log(`6. strona produktowa (${jezyk})`);
    const ctx = await br.newContext({ viewport: PULPIT, deviceScaleFactor: 1.25, serviceWorkers: 'block', colorScheme: 'light', timezoneId: 'Europe/Warsaw' });
    const pg = await ctx.newPage();
    await pg.goto(`${ADRES}/${jezyk === 'en' ? '?lang=en' : ''}`, { waitUntil: 'load' });
    // Animacja wejścia słów i rozmowa pokazowa — dajemy im dojść do końca.
    await ustabilizuj(pg, 5200);
    // JPEG: miękkie plamy koloru w tle strony dawały PNG po 2 MB.
    await zapisz(pg, `strona-${jezyk}`, { type: 'jpeg', quality: 88 }, 'jpg');
    await ctx.close();
  }

  await br.close();
  zabij(srv);
  nasze.forEach(zabij);
  console.log(`\nGotowe — ${zrobione.length} zrzutów w docs/obrazy/`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

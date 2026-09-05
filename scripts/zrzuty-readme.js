/* Zrzuty do README — z prawdziwego interfejsu, po angielsku.
 *
 * Nie są to atrapy obrazków ani makiety: to Chromium otwierające prawdziwego
 * Cosmosa, z prawdziwym CSS-em i prawdziwym renderowaniem. Model i dane są
 * testowe i tak ma być — repozytorium jest publiczne, a prywatne archiwum
 * Marcina (57 tysięcy zdjęć z rodziną) nie ma tam czego szukać.
 *
 * Język przestawiamy na angielski PRZED wczytaniem strony, bo interfejs ma
 * pełny parytet tłumaczeń (643 klucze PL = 643 EN) i README jest po angielsku.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node scripts/zrzuty-readme.js
 *
 * (Playwright bywa zainstalowany globalnie — stąd NODE_PATH.)
 *
 * Wynik ląduje w `docs/obrazy/`. Zrzuty są w repozytorium celowo — bez nich
 * README na GitHubie pokazuje puste ramki.
 */
const fs = require('node:fs');
const path = require('node:path');
const { srodowisko, przegladarka, maPrzegladarke } = require('../tests/pomoc');

const KATALOG = path.join(__dirname, '..', 'docs', 'obrazy');
const PULPIT = { width: 1440, height: 900 };
const TELEFON = { width: 412, height: 915 };

/** Poczekaj, aż układ przestanie się zmieniać — inaczej łapiemy pół animacji. */
async function ustabilizuj(pg, ms = 700) {
  await pg.waitForTimeout(ms);
  await pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Nowa karta z angielskim interfejsem i bez pierwszego uruchomienia. */
async function karta(br, env, viewport) {
  const ctx = await br.newContext({ viewport, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    localStorage.setItem('cosmos.lang', 'en');
    localStorage.setItem('cosmos.theme', 'dark');
  });
  const pg = await ctx.newPage();
  /* `domcontentloaded`, nie `networkidle`. Cosmos trzyma otwarty strumień
     zdarzeń (SSE), więc sieć nigdy się nie „uspokaja" i czekanie kończy się
     wyłącznie przekroczeniem czasu. */
  await pg.goto(env.adres, { waitUntil: 'domcontentloaded' });
  await ustabilizuj(pg, 1200);

  /* Środowisko testowe zasiewa rozmowy o polskich tytułach („Rozmowa testowa
     numer 1"), a atrapa modelu odpowiada po polsku. Na zrzucie do angielskiego
     README wyglądałoby to jak niedokończona robota, więc scenę budujemy sami:
     prawdziwy renderer, prawdziwy CSS, kontrolowana treść. */
  await pg.evaluate(() => {
    conversations = [
      { id: 'c1', title: 'Sunset shoot — Mallorca', updatedAt: Date.now() },
      { id: 'c2', title: 'Which lens for the cliffs?', updatedAt: Date.now() - 3.6e6 },
      { id: 'c3', title: 'Drone mission over the lake', updatedAt: Date.now() - 9e6 },
      { id: 'c4', title: 'Count clips shot at 50 mm', updatedAt: Date.now() - 8.6e7 },
    ];
    renderSidebar();
  });
  return { ctx, pg };
}

(async () => {
  if (!maPrzegladarke()) {
    console.error('Brak Chromium — zrzutów nie da się zrobić.');
    process.exit(1);
  }
  fs.mkdirSync(KATALOG, { recursive: true });

  const env = await srodowisko('pelne');
  const br = await przegladarka();
  const zrobione = [];
  const zapisz = async (pg, nazwa, opcje = {}) => {
    const plik = path.join(KATALOG, `${nazwa}.png`);
    await pg.screenshot({ path: plik, ...opcje });
    const kb = Math.round(fs.statSync(plik).size / 1024);
    zrobione.push(`${nazwa}.png (${kb} KB)`);
    console.log(`  ✓ ${nazwa}.png — ${kb} KB`);
  };

  /* --- 1. ROZMOWA Z NARZĘDZIEM ------------------------------------------
     Pierwszy zrzut w README musi pokazywać system PRZY PRACY, nie pusty
     ekran powitalny. Poprzedni zrzut w repozytorium pokazywał właśnie pustkę
     — i był przez to gorszy niż żaden. */
  console.log('1. rozmowa z wyszukiwaniem');
  {
    const { ctx, pg } = await karta(br, env, PULPIT);
    await pg.evaluate(() => {
      const c = ensureConversation('Sunset shoot — Mallorca');
      c.title = 'Sunset shoot — Mallorca';
      c.messages = [
        { role: 'user', content: 'Golden hour at Cala d\u2019Or tomorrow. '
          + 'What settings, and how much time do I actually get?' },
        { role: 'user', search: true, searchQuery: 'shoot plan',
          content: 'SHOOT PLAN DATA (computed for the requested place)' },
        { role: 'assistant', think: 'The place is given explicitly, so it wins over the '
          + 'saved home location. Sun elevation is 4.1 degrees, so golden hour has already '
          + 'started. Fastest glass on the 24-105 is f/4, so f/5.6 is reachable.',
          content: '**Golden hour is already running** \u2014 it ends at 20:34, so you have '
          + '**34 minutes** of usable light.\n\n'
          + '| | Setting | Why |\n|---|---|---|\n'
          + '| Shutter | `1/250 s` | freezes a walking subject |\n'
          + '| Aperture | `f/5.6` | family scene, and there is light to spare |\n'
          + '| ISO | `200` | base ISO plus one stop of headroom |\n\n'
          + 'Computed for your **RF 24-105 f/4** at 35 mm \u2014 f/4 is the fastest '
          + 'aperture you own at that focal length, so anything brighter is not an option.\n\n'
          + '```python\n# Sun elevation drives the whole plan\nev = 12.4  # measured\n'
          + 'shutter, aperture, iso = expose(ev, lens="RF 24-105 f/4")\n```\n\n'
          + 'Sources: [sunrise-sunset.org](https://sunrise-sunset.org)' },
      ];
      renderMessages();
    });
    await ustabilizuj(pg, 900);
    await zapisz(pg, '01-chat');
    await ctx.close();
  }

  /* --- 2. PRZEŁĄCZNIK SILNIKÓW ------------------------------------------
     Sedno tezy „hybrid": cztery silniki w jednym pasku, przełączane jednym
     kliknięciem. To jest zdjęcie, które tłumaczy architekturę bez słów. */
  console.log('2. przełącznik silników');
  {
    const { ctx, pg } = await karta(br, env, PULPIT);
    await zapisz(pg, '02-engines', {
      clip: { x: 0, y: 0, width: PULPIT.width, height: 120 },
    });
    await ctx.close();
  }

  /* --- 3. PLAN ZDJĘCIOWY -------------------------------------------------
     Rzecz, której nie ma żaden asystent w chmurze: policzone światło
     i nastawy dla konkretnego miejsca i konkretnego sprzętu. */
  console.log('3. plan zdjęciowy');
  {
    const { ctx, pg } = await karta(br, env, PULPIT);
    await pg.route('**/api/plan', (trasa) => trasa.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        miejsce: 'Cala d’Or, Mallorca',
        miejsceZNazwy: true,
        wspolrzedne: { lat: 39.3776, lon: 3.2333 },
        slonce: {
          wysokosc: 4.1, azymut: 271, faza: 'golden hour',
          doZlotejMin: -5, doZachoduMin: 34,
        },
        kadr: { uklad: 'poziomo', proporcje: '3:2' },  // klient przetłumaczy
        pogoda: { opis: 'clear', temperatura: 24.1, opadyProc: 0 },
        ustawienia: {
          sprzet: 'Canon R6 Mark II', tryb: 'zdjecie',
          czas: '1/250', przyslona: 'f/5.6', iso: 200, ev: 12.4,
          powody: [
            'Computed for RF 24-105 f/4 at 35 mm — f/4 is the fastest you have.',
            '1/250 s freezes a walking subject.',
            'f/5.6 for a family scene; there is light to spare for it.',
          ],
        },
      }),
    }));
    await pg.evaluate(() => {
      document.getElementById('live-panel').style.display = '';
      const box = document.getElementById('plan-box');
      box.hidden = false;
      box.open = true;
    });
    await pg.selectOption('#plan-mode', { index: 1 }).catch(() => {});
    await pg.waitForFunction(
      () => /1\/250/.test(document.getElementById('plan-shot')?.textContent || ''),
      null, { timeout: 8000 },
    ).catch(() => {});
    await ustabilizuj(pg);
    /* Kadrujemy SAM PANEL NASTAW, nie całe okno kamery. W headless Chromium
       nie ma z czego wziąć obrazu, więc podgląd to czarny prostokąt — na
       zrzucie do README wyglądałby jak zepsuty element, a nie jak brak
       kamery w środowisku testowym. */
    const ramka = await pg.evaluate(() => {
      const r = document.getElementById('plan-box').getBoundingClientRect();
      return { x: Math.max(0, r.x - 14), y: Math.max(0, r.y - 14),
        width: r.width + 28, height: r.height + 28 };
    });
    await zapisz(pg, '03-shoot-plan', { clip: ramka });
    await ctx.close();
  }

  /* --- 4. ARCHIWUM ------------------------------------------------------
     Siatka miniatur z podpisami: pora dnia, światło, ogniskowa. Pokazuje,
     że indeks niesie treść, a nie same nazwy plików. */
  console.log('4. archiwum');
  {
    /* Miniatury MUSZĄ być plikami serwowanymi spod `/`. Siatka przepuszcza
       adresy zewnętrzne przez `/api/search/thumb`, a ten — słusznie — odrzuca
       wszystko, co nie jest adresem http. Data URI kończyło się więc czterema
       kafelkami „thumbnail unavailable". Kładziemy je na czas zrzutu
       w `public/` i sprzątamy zaraz potem. */
    const atrapy = ['#2b3a63,#7d92d6', '#3a2b4f,#a37fd6', '#1f4a44,#68c2b0', '#4f3a2b,#d6a97f']
      .map((para, i) => {
        const [a, b] = para.split(',');
        const plik = path.join(__dirname, '..', 'public', `_zrzut-${i}.svg`);
        fs.writeFileSync(plik, `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="214">`
          + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
          + `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>`
          + `</linearGradient></defs><rect width="320" height="214" fill="url(#g)"/>`
          + `<circle cx="252" cy="52" r="26" fill="#ffffff" opacity="0.22"/>`
          + `<path d="M0 168 L96 116 L168 152 L248 104 L320 140 L320 214 L0 214 Z" `
          + `fill="#000000" opacity="0.28"/></svg>`);
        return { plik, adres: `/_zrzut-${i}.svg` };
      });

    const { ctx, pg } = await karta(br, env, PULPIT);
    await pg.evaluate((adresy) => {
      const c = ensureConversation('archive');
      c.messages.push({ role: 'user', content: 'Show the newest shots from the lake' });
      c.messages.push({
        role: 'assistant',
        content: {
          text: '',
          photos: [
            { title: '3B9A4703.CR3 · 19:12 · golden hour', licencja: '70 mm · f/4 · 1/250' },
            { title: '3B9A4711.CR3 · 19:18 · golden hour', licencja: '105 mm · f/4 · 1/320' },
            { title: '3B9A4726.CR3 · 19:31 · blue hour', licencja: '24 mm · f/4 · 1/60' },
            { title: '3B9A4740.CR3 · 19:44 · blue hour', licencja: '50 mm · f/1.8 · 1/125' },
          ].map((p, i) => ({ ...p, thumb: adresy[i] })),
          dalej: { q: 'folder=Lake+2026', pomin: 4, razem: 311 },
        },
      });
      renderMessages();
    }, atrapy.map((a) => a.adres));
    await ustabilizuj(pg);
    await zapisz(pg, '04-archive');
    await ctx.close();
    for (const a of atrapy) fs.unlinkSync(a.plik);
  }

  /* --- 5. TELEFON --------------------------------------------------------
     Cosmos jest instalowany jako aplikacja i większość czasu chodzi
     na telefonie. Zrzut z pulpitu sam w sobie tego nie pokazuje. */
  console.log('5. telefon');
  {
    const { ctx, pg } = await karta(br, env, TELEFON);
    await pg.evaluate(() => {
      const c = ensureConversation('Which lens for the cliffs?');
      c.messages = [
        { role: 'user', content: 'Which lens for the cliffs at sunset?' },
        { role: 'assistant', content: 'The **RF 70-200 f/4** \u2014 it lets you stay back '
          + 'from the edge and still fill the frame with rock.\n\n'
          + 'At 200 mm you will want `1/250 s` or shorter; the wind up there is enough '
          + 'to blur a handheld frame at `1/125 s`.\n\n'
          + 'The 24-105 works too, but you will be standing much closer to the drop.' },
      ];
      renderMessages();
    });
    await ustabilizuj(pg, 900);
    await zapisz(pg, '05-mobile');
    await ctx.close();
  }

  /* --- 6. TRYB GŁOSOWY --------------------------------------------------- */
  console.log('6. tryb głosowy');
  {
    const { ctx, pg } = await karta(br, env, TELEFON);
    await pg.evaluate(() => {
      document.getElementById('voice-overlay').style.display = '';
      document.getElementById('voice-transcript').textContent
        = 'what are the best spots for sunrise here';
      document.getElementById('voice-answer').textContent
        = 'The eastern cliffs catch first light about twenty minutes '
        + 'before the sun clears the horizon.';
      document.getElementById('voice-orb').className = 'voice-orb listening';
    });
    await ustabilizuj(pg);
    await zapisz(pg, '06-voice');
    await ctx.close();
  }

  await br.close();
  env.koniec();
  console.log(`\nGotowe — ${zrobione.length} zrzutów w docs/obrazy/`);
  process.exit(0);
})();

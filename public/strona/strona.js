/* Cosmos — strona produktowa: języki, rozmowa pokazowa i ruch przy przewijaniu.
   Polski tekst stoi w HTML-u (tak widzą go wyszukiwarki i podgląd linku),
   angielski jest tutaj. Oba pisane osobno, nie tłumaczone zdanie w zdanie. */
(function () {
  'use strict';

  const doc = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const ruchOgraniczony = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const zKursorem = matchMedia('(hover: hover) and (pointer: fine)').matches;

  // -------------------------------------------------------------------------
  // Teksty
  // -------------------------------------------------------------------------

  const EN = {
    pomin: 'Skip to content',
    navAria: 'Sections',
    stopkaAria: 'Footer',
    'nav.hybryda': 'Hybrid',
    'nav.plener': 'Planner',
    'nav.pamiec': 'Memory',
    'nav.glos': 'Voice',
    'nav.prywatnosc': 'Privacy',
    'nav.podMaska': 'Under the hood',
    wejdz: 'Sign in',
    otworz: 'Open Cosmos',
    'hero.et': 'A personal, hybrid AI system',
    'hero.h': 'One thread. <em>Every engine.</em>',
    'hero.lead': 'Cosmos runs one conversation across NVIDIA’s cloud, a local GPU, Claude and OpenAI. Switch engines mid-thread and nothing resets — same memory, same tools, same context.',
    'hero.zobacz': 'See how it works',
    'hero.uwaga': 'Invitation-only. Accounts are created by the instance administrator.',
    'czat.aria': 'Example conversation: one question, four engines answering in turn within the same thread',
    'czat.status': 'one thread',
    'czat.przelacznik': 'Switch engines mid-conversation',
    'czat.podpis': 'Pick an engine — the next reply comes from it, in the same thread.',
    'silnik.local': 'Local GPU',
    'czat.local': 'Local<span class="przel-dop"> GPU</span>',
    'liczby.zal': 'runtime dependencies in the core',
    'liczby.testy': 'behavioural test suites',
    'liczby.narzedzia': 'tools the model can call mid-reply',
    'liczby.silniki': 'engines, one conversation',
    'hyb.et': 'Why hybrid',
    'hyb.h': 'Local where it matters. Cloud when it helps.',
    'hyb.lead': 'The switch between local and cloud is the one decision everything else follows from. Five reasons, in the order they actually matter.',
    'hyb.rozmowa': 'one conversation',
    'hyb.r.h': 'One thread, one set of guarantees',
    'hyb.r.p': 'The interesting part isn’t that both exist. It’s that they share one conversation, one tool cascade and one set of rules. Switching providers mid-thread must not lose the thread.',
    'hyb.1.h': 'Privacy',
    'hyb.1.p': 'A photo archive is personal: home, people, places. Those queries hit a local index and a local vision model. None of it has to leave the house.',
    'hyb.2.h': 'Cost',
    'hyb.2.p': 'Bulk work is unmetered locally. Indexing tens of thousands of photos through a cloud vision API is a bill; on your own GPU it’s an evening.',
    'hyb.3.h': 'Latency',
    'hyb.3.p': 'A camera frame that needs a verdict in under a second can’t make a round trip to a datacentre. Detection and pose run right next to the sensor.',
    'hyb.4.h': 'Availability',
    'hyb.4.p': 'The home GPU is off most of the day. The cloud isn’t. A system that only works while one machine is awake isn’t one you use on a train.',
    'hyb.5.h': 'Model choice',
    'hyb.5.p': 'No single provider wins at everything. Reasoning, vision, long context and speech each have a different winner this month — so switching is one click.',
    'pl.et': 'Shoot planner',
    'pl.h': 'It does the math.',
    'pl.lead': 'Instead of describing light, Cosmos computes it: sun position from ephemerides, an hourly forecast, the exposure. Settings stay inside the kit you actually own — suggesting f/2.8 to someone with f/4 glass is worse than no suggestion at all.',
    'pl.c1': 'Sun ephemerides: sunrise, sunset, golden and blue hour',
    'pl.c2': 'Hour-by-hour weather and cloud cover',
    'pl.c3': 'Your gear on file: body, lenses, filters',
    'pl.c4': 'Your archive: what you’ve already shot here',
    'pl.niebieska': 'blue hour',
    'pl.zlota': 'golden hour',
    'pl.dzien': 'soft light',
    'pl.wys': 'Sun altitude',
    'pl.azymut': 'Azimuth',
    'pl.chmury': 'Cloud cover',
    'pl.poza': 'f/2.8 — not in your kit',
    'pam.et': 'Memory & knowledge',
    'pam.h': 'It remembers, so you don’t repeat yourself.',
    'pam.lead': 'Long-term memory recalls by meaning, not by keywords. The knowledge base holds your documents and images — pinned items always join the conversation, the rest are picked automatically.',
    'pam.zap': '“where was that lake with the fog?”',
    'pam.w1': 'September: Morskie Oko at dawn, fog until 7:20',
    'pam.w2': 'Takes coffee without sugar',
    'pam.w3': 'Favourite shots: mountains reflected in water',
    'pam.w4': 'Hosting invoice — March',
    'pam.w5': 'Plan: Tatra lakes in autumn',
    'pam.w6': 'Drone registration number',
    'pam.k1.h': 'Recall by meaning',
    'pam.k1.p': 'bge-m3 embeddings surface memories that match the question in meaning, even when they share none of its words.',
    'pam.k2.h': 'Nothing without your approval',
    'pam.k2.p': 'Remember, note, new procedure — every such action waits for a human to approve it.',
    'pam.k3.h': 'Images stay images',
    'pam.k3.p': 'Pictures from the knowledge base reach vision models as pixels, not as someone’s caption of them.',
    'pam.k4.h': 'Works without the extra services too',
    'pam.k4.p': 'If the embedding service is down, recall falls back to keywords and keeps working.',
    'glos.et': 'Voice & camera',
    'glos.h': 'Say “Hey Cosmos” and keep talking.',
    'glos.lead': 'Voice mode with a wake word, a camera that sees what you’re holding, a depth sensor. Each has a fallback, so losing one service never takes the whole thing down. Listening for the wake word stays at home: only what you deliberately say to Cosmos goes to the cloud.',
    'glos.ty': 'Hey Cosmos, what am I holding?',
    'glos.on': 'A 24–105 lens. The cap’s still on.',
    'glos.z1': 'your own speech server, then OpenAI',
    'glos.z2': 'OpenAI, Piper, then the system voice',
    'glos.z3': 'keyword search',
    'glos.android': 'Chrome on Android ends listening after every sentence and restarts on its own. Cosmos filters out the repeats, and when the restarts pile up it switches to push-to-talk.',
    'ciag.et': 'Continuity',
    'ciag.h': 'Lock your phone. The answer keeps going.',
    'ciag.lead': 'Answers are generated on the server; the browser only attaches to them. Screen lock, a tunnel, Wi-Fi handing over to LTE — when you’re back, you rejoin the same stream right where it broke off.',
    'ciag.pyt': 'Compare three routes for Saturday.',
    'ciag.wznowiono': 'resumed · 0 tokens lost',
    'ciag.serwer': 'server · reply a41f',
    'ciag.l1': 'stream: client attached',
    'ciag.l2': 'client gone — still writing',
    'ciag.l3': 'answer saved to the conversation',
    'ciag.l4': 'client back — rejoins the same reply',
    'pryw.et': 'Privacy & accounts',
    'pryw.h': 'Invitation-only, isolated by design.',
    'pryw.lead': 'Accounts are created by the instance administrator. Every account has its own conversations, memory, profile and knowledge base. The admin panel shows accounts, last visits and message counts — not content, because the app doesn’t hand it over. Your data lives on the server Cosmos runs on. A conversation with a cloud engine is also seen by that engine’s provider; with a local model nothing leaves the house.',
    'pryw.c1': 'Engines are granted by the administrator — or you add your own API key and the provider bills you directly',
    'pryw.c2': 'Passwords stored as scrypt hashes; sessions stored only as hashes',
    'pryw.c3': 'If code can’t tell whose request it is, it fails instead of falling back to a default',
    'pryw.panel': 'admin panel',
    'pryw.kolKonto': 'account',
    'pryw.kolWizyta': 'last seen',
    'pryw.kolWiad': 'msgs',
    'pryw.kolTresc': 'content',
    'pryw.dzis': 'today',
    'pryw.wczoraj': 'yesterday',
    'pm.et': 'Under the hood',
    'pm.h': 'Four layers. One rule.',
    'pm.lead': 'Each layer only receives what it needs to do its job. The tool cascade never sees app state, views never see the conversation, the Node core never imports a Python sensor. A module that can’t reach something can’t quietly start depending on it.',
    'pm.w4': 'Edge',
    'pm.w4p': 'The phone app, voice, camera, sensors and hardware.',
    'pm.w3': 'Tools',
    'pm.w3p': 'One contract per tool, up to four rounds in a single turn.',
    'pm.w2': 'Routing',
    'pm.w2p': 'Model catalogue, capability detection, prompt assembly.',
    'pm.w1': 'Inference',
    'pm.w1p': 'Provider adapters, streaming, replies that resume after a dropped connection.',
    'pm.f1.h': 'runtime dependencies',
    'pm.f1.p': '<code>node server.js</code> and that’s it. Nothing to build, and no dependency tree waiting to break overnight.',
    'pm.f2.h': 'behavioural test suites',
    'pm.f2.p': 'Tests call the function and check the result, never the source text. Each new one must first fail against the old, broken code.',
    'pm.f3.h': 'audit sections',
    'pm.f3.p': 'The audit audits itself: a pattern that stops matching anything is an error, not silence.',
    'pm.f4.h': 'tool rounds per turn',
    'pm.f4.p': 'A plan, the archive and photos of each spot in one reply — images land under the finished plan points.',
    'cta.h': 'Got an invitation? Your Cosmos is ready.',
    'cta.p': 'Open the link from your invitation and set a login and password in a minute. Already have an account? Sign in. No invitation? Run your own Cosmos — the code is open.',
    'cta.kod': 'Run your own Cosmos',
    'stopka.opis': 'A personal, hybrid AI system.',
    'stopka.kod': 'Source code (non-commercial use)',
  };

  const META = {
    pl: {
      adres: 'https://cosmosai.live/',
      title: 'Cosmos — jedna rozmowa, każdy model',
      opis: 'Cosmos to osobisty, hybrydowy system AI. Prowadzi jedną rozmowę przez chmurę NVIDIA, lokalny GPU, Claude i OpenAI, a zamiast opisywać świat — liczy.',
    },
    en: {
      adres: 'https://cosmosai.live/?lang=en',
      title: 'Cosmos — one thread, every engine',
      opis: 'Cosmos is a personal, hybrid AI system. One conversation across NVIDIA’s cloud, a local GPU, Claude and OpenAI — and instead of describing the world, it does the math.',
    },
  };

  /* Polski oryginał zbieramy z dokumentu, zanim cokolwiek podmienimy —
     jedno źródło prawdy, bez drugiej kopii tekstów w skrypcie. */
  const PL = {};
  $$('[data-t]').forEach((el) => { if (!(el.dataset.t in PL)) PL[el.dataset.t] = el.innerHTML; });
  $$('[data-t-aria]').forEach((el) => { PL[el.dataset.tAria] = el.getAttribute('aria-label'); });
  PL.otworz = 'Otwórz Cosmos';
  /* Pory światła nazwane tak jak w aplikacji (lib/slonce.js, fazaSwiatla). */
  Object.assign(PL, {
    'pl.niebieska': PL['pl.niebieska'] || 'niebieska godzina',
    'pl.zlota': 'złota godzina',
    'pl.dzien': 'miękkie światło',
  });

  /* Język: adres (/?lang=en) → zapisany wybór → polski. Języka przeglądarki nie
     zgadujemy (robot en-US widziałby angielski pod polskim adresem) — zamiast
     tego osoba z nie-polską przeglądarką dostaje dyskretną podpowiedź. */
  const zAdresu = (/[?&]lang=(pl|en)(?:&|$)/.exec(location.search) || [])[1] || null;
  let zapisany = null;
  try { zapisany = localStorage.getItem('cosmos.lang'); } catch (e) { /* tryb prywatny */ }
  let jezyk = zAdresu || zapisany || 'pl';
  if (jezyk !== 'en') jezyk = 'pl';

  const t = (k) => (jezyk === 'en' ? EN[k] : PL[k]) ?? PL[k] ?? k;

  let zalogowany = false;

  function zastosujJezyk() {
    doc.lang = jezyk;
    $$('[data-t]').forEach((el) => {
      const k = el.dataset.t;
      if (k === 'wejdz') {
        /* Rezerwa szerokości: przycisk jest od początku tak szeroki jak dłuższy
           z napisów, więc „Otwórz Cosmos” po /api/auth nie przesuwa nawigacji. */
        el.dataset.alt = t(zalogowany ? 'wejdz' : 'otworz');
        el.innerHTML = t(zalogowany ? 'otworz' : 'wejdz');
        return;
      }
      el.innerHTML = t(k);
    });
    $$('[data-t-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.tAria)));
    $$('[data-jezyk]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.jezyk === jezyk)));
    document.title = META[jezyk].title;
    $('meta[name="description"]').setAttribute('content', META[jezyk].opis);
    $('link[rel="canonical"]').setAttribute('href', META[jezyk].adres);
    $('meta[property="og:url"]').setAttribute('content', META[jezyk].adres);
    rozbijNaSlowa();
    formatujLiczby();
    swiatlo = null;
    ostatniCzas = '';
    czat.odNowa();
    przewin();
  }

  function zmienJezyk(nowy) {
    if (nowy === jezyk) return;
    jezyk = nowy;
    try { localStorage.setItem('cosmos.lang', jezyk); } catch (e) { /* bez zapisu */ }
    /* Adres w pasku mówi, co widać — link skopiowany z angielskiej wersji
       otworzy się po angielsku. */
    try {
      const u = new URL(location.href);
      if (jezyk === 'en') u.searchParams.set('lang', 'en'); else u.searchParams.delete('lang');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) { /* bez zmiany adresu */ }
    schowajPodpowiedz();
    if (document.startViewTransition && !ruchOgraniczony) document.startViewTransition(zastosujJezyk);
    else zastosujJezyk();
  }

  $$('[data-jezyk]').forEach((b) => b.addEventListener('click', () => zmienJezyk(b.dataset.jezyk)));

  /* Język idzie za człowiekiem do aplikacji. Samo wejście pod /?lang=en nic nie
     zapisuje, ale „Open Cosmos" kliknięte na angielskiej stronie to już wybór —
     bez tego aplikacja witała po polsku kogoś, kto przed chwilą czytał po
     angielsku (aplikacja czyta język tylko z cosmos.lang). */
  $$('.js-wejscie').forEach((a) => a.addEventListener('click', () => {
    if (zAdresu) try { localStorage.setItem('cosmos.lang', jezyk); } catch (e) { /* bez zapisu */ }
  }));

  /* Podpowiedź „Read in English” — tylko gdy nikt jeszcze nie wybrał języka,
     adres go nie narzuca, a przeglądarka nie jest polska. */
  const podpowiedz = $('#podpowiedz-jezyka');
  function schowajPodpowiedz() { if (podpowiedz) podpowiedz.hidden = true; }
  if (podpowiedz && !zAdresu && !zapisany && !/^pl\b/i.test(navigator.language || '')) {
    podpowiedz.hidden = false;
    $('.pj-tak', podpowiedz).addEventListener('click', () => zmienJezyk('en'));
    $('.pj-nie', podpowiedz).addEventListener('click', () => {
      schowajPodpowiedz();
      try { localStorage.setItem('cosmos.lang', 'pl'); } catch (e) { /* bez zapisu */ }
    });
  }

  // -------------------------------------------------------------------------
  // Nagłówek słowo po słowie
  // -------------------------------------------------------------------------

  /* Skrypt spóźniony (wolna sieć) nie może zgasić nagłówka, który już widać,
     tylko po to, żeby go „wprowadzić” drugi raz. */
  const wczesnie = performance.now() < 600;
  function rozbijNaSlowa() {
    if (ruchOgraniczony || !wczesnie) return;
    let i = 0;
    const rozbij = (wezel) => {
      Array.from(wezel.childNodes).forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((kawalek) => {
            if (!kawalek) return;
            if (/^\s+$/.test(kawalek)) { frag.appendChild(document.createTextNode(kawalek)); return; }
            const s = document.createElement('span');
            s.className = 'slowo';
            s.style.setProperty('--i', i++);
            s.textContent = kawalek;
            frag.appendChild(s);
          });
          wezel.replaceChild(frag, n);
        } else if (n.nodeType === 1 && n.tagName === 'EM') {
          /* Wyróżnienie wchodzi jako całość: gradient przez oba słowa musi
             zostać jednym ciągłym pasem, a nie osobnym na każde słowo. */
          n.classList.add('slowo');
          n.style.setProperty('--i', i++);
        } else if (n.nodeType === 1) rozbij(n);
      });
    };
    $$('[data-slowa]').forEach((el) => rozbij(el));
  }

  // -------------------------------------------------------------------------
  // Rozmowa pokazowa: jedno pytanie, cztery silniki w jednym wątku
  // -------------------------------------------------------------------------

  const SILNIKI = {
    cloud: { pill: 'nemotron-3-super · cloud', kolor: '--k-nvidia', nazwa: 'NVIDIA Nemotron', nr: 0 },
    /* Archiwum przegląda lokalny model z narzędziami: nano-9b dostaje skrócony
       prompt bez [ARCHIWUM:] (public/models.js, modelToolLevel), 30B — pełny. */
    local: { pill: 'nemotron-3-nano-30b · local-gpu', kolor: '--k-local', nazwa: { pl: 'Lokalny GPU', en: 'Local GPU' }, nr: 1 },
    claude: { pill: 'claude-sonnet-5 · anthropic', kolor: '--k-claude', nazwa: 'Claude', nr: 2 },
    openai: { pill: 'gpt-4o · openai', kolor: '--k-openai', nazwa: 'OpenAI', nr: 3 },
  };
  const KOLEJNOSC = ['cloud', 'local', 'claude', 'openai'];

  const ROZMOWA = {
    pl: {
      /* Te same zdania stoją w index.html (duch i pierwsza odpowiedź) —
         zmieniając je, zmień oba miejsca. Liczby: 2 października nad Morskim
         Okiem wg lib/slonce.js i lib/ekspozycja.js, jak w Plenerze niżej. */
      pyt: 'Jutro świt w\u00A0górach. Jakie nastawy przy 24–105 f/4?',
      kroki: [
        'Złota godzina jutro 6:40–7:22, Słońce wschodzi na azymucie 94°. Liczę pod obiektyw, który masz — f/4 to Twoje maksimum.',
        'W archiwum masz 212 zdjęć z\u00A0tego miejsca; najlepsze kadry to październik, 6:55. Przejrzane lokalnie — nic nie wyszło z\u00A0komputera.',
        'Kadr: kamienie na pierwszym planie, horyzont w\u00A0górnej tercji. O\u00A07:00 f/8, 1/60 s, ISO 100 — mieści się w\u00A0Twoim sprzęcie.',
        'Zapisać to jako plan na jutro? Nic nie trafi do pamięci bez Twojej zgody.',
      ],
    },
    en: {
      pyt: 'Mountains at dawn tomorrow. Settings for a 24–105 f/4?',
      kroki: [
        'Golden hour runs 6:40–7:22, sun rising at 94°. I’m planning around the lens you own — f/4 is as wide as it goes.',
        'Your archive has 212 frames from this spot; the best are from October at 6:55. Reviewed locally — nothing left the machine.',
        'Frame: rocks in the foreground, horizon on the upper third. At 7:00, f/8, 1/60 s, ISO 100 — all within your kit.',
        'Save this as tomorrow’s plan? Nothing goes into memory until you approve it.',
      ],
    },
  };

  const czat = (() => {
    const el = $('#czat');
    const zywy = $('#czat-zywy');
    const duch = $('#czat-duch');
    const pillTekst = $('#pill-tekst');
    const przyciski = $$('[data-silnik]');
    const przelacznik = $('.przelacznik');
    let krok = 0;
    let pokolenie = 0;       // każde odNowa() unieważnia trwające pisanie
    let autoplay = true;
    let zajety = false;
    let widoczny = true;
    let biezace = null;      // odpowiedź w trakcie pisania: { tr, tekst }
    let zegar = 0;

    const czekaj = (ms) => new Promise((r) => setTimeout(r, ms));
    const nazwa = (s) => (typeof SILNIKI[s].nazwa === 'string' ? SILNIKI[s].nazwa : SILNIKI[s].nazwa[jezyk]);

    function wiadomoscTy(tekst) {
      const d = document.createElement('div');
      d.className = 'wiad-ty';
      d.textContent = tekst;
      return d;
    }
    function odpowiedz(silnik, tekst, odRazu) {
      const d = document.createElement('div');
      d.className = 'odp';
      d.style.setProperty('--k', `var(${SILNIKI[silnik].kolor})`);
      const et = document.createElement('div');
      et.className = 'odp-silnik';
      et.textContent = nazwa(silnik);
      const tr = document.createElement('div');
      tr.className = 'odp-tekst';
      if (odRazu) tr.textContent = tekst;
      d.append(et, tr);
      return { d, tr };
    }

    function ustawSilnik(s) {
      const k = `var(${SILNIKI[s].kolor})`;
      el.style.setProperty('--k-akt', k);
      przelacznik.style.setProperty('--nr', SILNIKI[s].nr);
      przyciski.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.silnik === s)));
      if (pillTekst.textContent !== SILNIKI[s].pill) {
        pillTekst.classList.remove('zmiana');
        void pillTekst.offsetWidth;
        pillTekst.classList.add('zmiana');
        setTimeout(() => { pillTekst.textContent = SILNIKI[s].pill; }, ruchOgraniczony ? 0 : 230);
      }
    }

    function zbudujDucha() {
      /* Niewidoczna, pełna rozmowa rezerwuje wysokość — karta nie skacze,
         gdy dochodzą kolejne odpowiedzi. Polska wersja stoi już w HTML-u
         (inaczej karta rosłaby dopiero po dojściu skryptu), tu dobudowujemy
         tylko inny język. */
      if (duch.dataset.jezyk === jezyk) return;
      const r = ROZMOWA[jezyk];
      duch.replaceChildren(wiadomoscTy(r.pyt), ...r.kroki.map((tx, i) => odpowiedz(KOLEJNOSC[i], tx, true).d));
      duch.dataset.jezyk = jezyk;
    }

    async function pisz(silnik) {
      const moje = pokolenie;
      const r = ROZMOWA[jezyk];
      if (krok >= r.kroki.length) {
        zywy.classList.add('znika');
        await czekaj(ruchOgraniczony ? 0 : 520);
        if (moje !== pokolenie) return;
        zywy.classList.remove('znika');
        zywy.replaceChildren(wiadomoscTy(r.pyt));
        krok = 0;
        await czekaj(ruchOgraniczony ? 0 : 500);
        if (moje !== pokolenie) return;
      }
      ustawSilnik(silnik);
      zywy.dataset.jezyk = '';
      const tekst = r.kroki[krok++];
      if (ruchOgraniczony) { zywy.appendChild(odpowiedz(silnik, tekst, true).d); return; }
      const { d, tr } = odpowiedz(silnik, '', false);
      zywy.appendChild(d);
      biezace = { tr, tekst };
      await czekaj(380);
      const slowa = tekst.split(' ');
      for (let i = 0; i < slowa.length; i++) {
        if (moje !== pokolenie) return;
        const w = document.createElement('span');
        w.className = 'w';
        w.textContent = (i ? ' ' : '') + slowa[i];
        tr.appendChild(w);
        await czekaj(34 + Math.random() * 38);
      }
      biezace = null;
    }

    async function petla() {
      const moje = pokolenie;
      while (moje === pokolenie && autoplay) {
        if (!widoczny || document.hidden) { await czekaj(400); continue; }
        zajety = true;
        await pisz(KOLEJNOSC[krok % 4]);
        zajety = false;
        if (moje !== pokolenie) return;
        await czekaj(krok >= 4 ? 4200 : 1100);
      }
    }

    function odNowa() {
      pokolenie++;
      clearTimeout(zegar);
      krok = 0;
      zajety = false;
      biezace = null;
      autoplay = true;
      zbudujDucha();
      zywy.classList.remove('znika');
      /* Pytanie i pierwsza odpowiedź widoczne od razu — karta nie stoi pusta.
         Gdy ten sam język już jest w HTML-u, zostawiamy węzły (bez powtórki
         animacji wejścia). */
      if (zywy.dataset.jezyk !== jezyk) {
        zywy.replaceChildren(wiadomoscTy(ROZMOWA[jezyk].pyt), odpowiedz(KOLEJNOSC[0], ROZMOWA[jezyk].kroki[0], true).d);
      }
      zywy.dataset.jezyk = '';
      krok = 1;
      if (ruchOgraniczony) {
        /* Bez ruchu: cała rozmowa widoczna od razu, przełącznik działa bez animacji. */
        ROZMOWA[jezyk].kroki.slice(1).forEach((tx, i) => zywy.appendChild(odpowiedz(KOLEJNOSC[i + 1], tx, true).d));
        krok = 4;
        ustawSilnik('openai');
        return;
      }
      ustawSilnik('cloud');
      zegar = setTimeout(petla, 1200);
    }

    przyciski.forEach((b) => b.addEventListener('click', async () => {
      autoplay = false;
      clearTimeout(zegar);
      /* Przerwana odpowiedź nie zostaje urwana w pół zdania — dopisujemy ją od razu. */
      if (biezace) { biezace.tr.textContent = biezace.tekst; biezace = null; }
      const moje = ++pokolenie;
      zajety = true;
      await pisz(b.dataset.silnik);
      if (moje === pokolenie) zajety = false;
    }));

    new IntersectionObserver((w) => { widoczny = w[0].isIntersecting; }, { threshold: 0.2 }).observe(el);

    return { odNowa };
  })();

  // -------------------------------------------------------------------------
  // Liczniki
  // -------------------------------------------------------------------------

  const liczniki = $$('.licznik');
  /* Formatery raz na język, nie w każdej klatce: nowy Intl.NumberFormat to
     kilka milisekund na telefonie, a liczniki wołają go 60 razy na sekundę. */
  const formatery = {};
  const fmt = (n) => {
    const loc = jezyk === 'en' ? 'en-US' : 'pl-PL';
    return (formatery[loc] ||= new Intl.NumberFormat(loc)).format(n);
  };
  function formatujLiczby() { liczniki.forEach((l) => { l.textContent = fmt(Number(l.dataset.do)); }); }
  function odliczaj(l) {
    if (ruchOgraniczony) return;
    const od = Number(l.dataset.od || 0);
    const doW = Number(l.dataset.do);
    const czas = 1600 + Math.min(900, Math.log10(Math.abs(doW - od) + 1) * 260);
    const start = performance.now();
    const krok = (teraz) => {
      const x = Math.min(1, (teraz - start) / czas);
      const e = 1 - Math.pow(1 - x, 4);
      l.textContent = fmt(Math.round(od + (doW - od) * e));
      if (x < 1) requestAnimationFrame(krok);
    };
    requestAnimationFrame(krok);
  }

  // -------------------------------------------------------------------------
  // Pojawianie się przy przewijaniu
  // -------------------------------------------------------------------------

  const obserwator = new IntersectionObserver((wpisy) => {
    wpisy.forEach((w) => {
      if (!w.isIntersecting) return;
      const el = w.target;
      el.classList.add('widoczne');
      obserwator.unobserve(el);
      if (el.classList.contains('liczby')) liczniki.forEach(odliczaj);
      if (el.classList.contains('karta-wspomnienia')) przywolaj(el);
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -6% 0px' });
  $$('[data-pokaz]').forEach((el) => obserwator.observe(el));

  /* Pamięć: wspomnienia podobne sensem zapalają się z wynikiem podobieństwa. */
  function przywolaj(karta) {
    $$('.wsp', karta).forEach((w) => {
      const s = parseFloat(getComputedStyle(w).getPropertyValue('--s')) || 0;
      w.dataset.wynik = s.toFixed(2);
      if (s > 0.6) w.classList.add('traf');
    });
  }

  /* Scena „zgaszony ekran” gra tylko wtedy, gdy ją widać — i zaczyna od początku. */
  new IntersectionObserver((wpisy) => {
    wpisy.forEach((w) => w.target.classList.toggle('gra', w.isIntersecting && !ruchOgraniczony));
  }, { threshold: 0.3 }).observe($('[data-gra]'));

  // -------------------------------------------------------------------------
  // Ruter silników: kolejny silnik co chwilę przejmuje rozmowę
  // -------------------------------------------------------------------------

  const router = $('.router');
  let akt = 0;
  router.dataset.akt = '0';
  if (!ruchOgraniczony) setInterval(() => { if (!document.hidden) router.dataset.akt = String(akt = (akt + 1) % 4); }, 1800);

  // -------------------------------------------------------------------------
  // Przewijanie: pasek postępu, nić, plener, przekrój, aktywny link
  // -------------------------------------------------------------------------

  const nav = $('#nav');
  const glowna = $('main');
  const pasek = $('.postep-strony');
  const watek = $('.watek');
  const plenerTor = $('.plener-tor');
  const przekrojTor = $('.przekroj-tor');
  const stos = $('.stos');
  const droga = $('#luk-droga');
  const slonce = $('#slonce');
  /* Długość łuku to 1 z definicji (pathLength="1" w index.html). Dawniej
     getTotalLength() w trakcie wykonywania skryptu wymuszał pełny układ
     strony, zanim cokolwiek się narysowało — na telefonie ~55 ms z 500 ms
     pierwszego długiego zadania. */
  const dlDrogi = 1;
  droga.style.strokeDasharray = '1';
  const scenaPlener = $('.plener-scena');
  const niebo = { noc: $('.n-noc'), zloto: $('.n-zloto'), dzien: $('.n-dzien') };
  const odczyt = {
    czas: $('#p-czas'), wys: $('#p-wys'), az: $('#p-az'), ev: $('#p-ev'),
    swiatlo: $('#p-swiatlo'), naswietlanie: $('#p-czas-naswietlania'),
  };
  const linki = $$('.nav-linki a');
  const sekcje = linki.map((a) => $(a.getAttribute('href')));
  const warstwy = $$('.warstwa');
  const legenda = $$('.legenda li');

  const ogr = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const przecinek = (x, m = 1) => {
    const s = x.toFixed(m);
    return jezyk === 'en' ? s.replace('-', '−') : s.replace('.', ',').replace('-', '−');
  };

  /* Wschód nad Morskim Okiem (49,20°N 20,07°E), 2 października, co 6,5 minuty:
     [czas, wysokość °, azymut °, EV₁₀₀]. Policzone funkcjami aplikacji —
     pozycjaSlonca() z lib/slonce.js i evZeSlonca() z lib/ekspozycja.js — a nie
     wpisane na oko. Kadr: 60° poziomo wokół azymutu 98°, 9 px na stopień
     wysokości; ta sama droga stoi w index.html jako ścieżka SVG. */
  const TABELA = [
    ['06:21', -4.0, 90.6, 9.02], ['06:27', -2.9, 91.8, 9.55], ['06:34', -1.8, 93.0, 10.08],
    ['06:40', -0.8, 94.3, 10.60], ['06:47', 0.3, 95.5, 11.13], ['06:53', 1.3, 96.7, 11.66],
    ['07:00', 2.4, 98.0, 12.19], ['07:06', 3.4, 99.2, 12.64], ['07:13', 4.5, 100.5, 12.99],
    ['07:19', 5.5, 101.7, 13.34], ['07:26', 6.5, 103.0, 13.56], ['07:32', 7.6, 104.2, 13.67],
    ['07:39', 8.6, 105.5, 13.79],
  ];
  const X = (az) => 200 + (az - 98) * (400 / 60);
  const Y = (h) => 178 - h * 9;
  /* Czasy naświetlania z typowej skali aparatu; przysłona f/8, ISO 100. */
  const PRZYSLONA = 8;
  const SKALA = [1, 0.5, 1 / 4, 1 / 8, 1 / 15, 1 / 30, 1 / 60, 1 / 125, 1 / 250, 1 / 500];
  const zapisCzasu = (s) => (s >= 1 ? `${s} s` : s >= 0.5 ? '1/2 s' : `1/${Math.round(1 / s)} s`);
  let swiatlo = null;
  let ostatniCzas = '';

  function plener(p) {
    /* t = N² / 2^EV — czas na karcie jest policzony, nie wpisany. */
    const f = p * (TABELA.length - 1);
    const i = Math.min(TABELA.length - 2, Math.floor(f));
    const u = f - i;
    const [, h0, a0, e0] = TABELA[i];
    const [, h1, a1, e1] = TABELA[i + 1];
    const wys = h0 + (h1 - h0) * u;
    const az = a0 + (a1 - a0) * u;
    const ev = e0 + (e1 - e0) * u;
    slonce.setAttribute('transform', `translate(${X(az).toFixed(1)} ${Y(wys).toFixed(1)})`);
    droga.style.strokeDashoffset = String(dlDrogi * (1 - p));
    /* Wiersze co 6,5 min od 6:21; minuta liczona tak samo jak w tabeli (w dół). */
    const minuty = Math.floor(6 * 60 + 21 + f * 6.5 + 1e-6);
    odczyt.czas.textContent = `${String(Math.floor(minuty / 60)).padStart(2, '0')}:${String(minuty % 60).padStart(2, '0')}`;
    odczyt.wys.textContent = `${przecinek(wys)}°`;
    odczyt.az.textContent = `${Math.round(az)}°`;
    odczyt.ev.textContent = przecinek(ev);
    const czasN = (PRZYSLONA * PRZYSLONA) / Math.pow(2, ev);
    const najblizszy = SKALA.reduce((a, b) => (Math.abs(Math.log(b / czasN)) < Math.abs(Math.log(a / czasN)) ? b : a));
    const zapis = zapisCzasu(najblizszy);
    if (zapis !== ostatniCzas) {
      odczyt.naswietlanie.textContent = zapis;
      if (ostatniCzas && !ruchOgraniczony) {
        odczyt.naswietlanie.classList.remove('mig'); void odczyt.naswietlanie.offsetWidth; odczyt.naswietlanie.classList.add('mig');
      }
      ostatniCzas = zapis;
    }
    /* Progi jak w lib/slonce.js: −0,833° (wschód) i +6° (koniec złotej godziny). */
    const faza = wys < -0.833 ? 'niebieska' : wys < 6 ? 'zlota' : 'dzien';
    if (faza !== swiatlo) {
      swiatlo = faza;
      odczyt.swiatlo.textContent = t(`pl.${faza}`);
      odczyt.swiatlo.className = `odznaka-swiatla ${faza === 'niebieska' ? '' : faza === 'zlota' ? 'zloto' : 'dzien'}`;
    }
    niebo.noc.style.opacity = String(ogr(1 - (wys + 4) / 4));
    niebo.zloto.style.opacity = String(ogr(1 - Math.abs(wys - 1.5) / 5));
    niebo.dzien.style.opacity = String(ogr((wys - 4) / 4.5));
    scenaPlener.style.setProperty('--dzien', ogr((wys + 2) / 10).toFixed(3));
  }

  let hoverWarstwa = -1;
  let ostatniP = 0;
  function przekroj(q) {
    /* q: przejście sekcji przez ekran (0 — wchodzi od dołu, 1 — znika u góry).
       Warstwy rozsuwają się do połowy drogi, potem podświetla się jedna po
       drugiej, od krawędzi do inferencji. */
    stos.style.setProperty('--p', ogr((q - 0.1) / 0.4).toFixed(3));
    let wyrozniona = -1;
    if (hoverWarstwa >= 0) wyrozniona = hoverWarstwa;
    else if (q > 0.36 && q < 0.86) wyrozniona = 3 - Math.min(3, Math.floor((q - 0.36) / 0.125));
    warstwy.forEach((w) => w.classList.toggle('przygas', wyrozniona >= 0 && Number(w.dataset.w) !== wyrozniona));
    legenda.forEach((l) => l.classList.toggle('aktywna', Number(l.dataset.w) === wyrozniona));
  }
  legenda.forEach((l) => {
    l.addEventListener('mouseenter', () => { hoverWarstwa = Number(l.dataset.w); przekroj(ostatniP); });
    l.addEventListener('mouseleave', () => { hoverWarstwa = -1; przekroj(ostatniP); });
  });

  let czeka = false;
  function klatka() {
    czeka = false;
    /* NAJPIERW wszystkie odczyty układu, POTEM zapisy. Przeplatane (zapis
       klasy, odczyt prostokąta, zapis zmiennej, odczyt…) wymuszały przeliczenie
       stylu i układu kilka razy w jednej klatce przewijania. */
    const vh = innerHeight;
    const y = scrollY;
    const calosc = doc.scrollHeight - vh;
    const rm = glowna.getBoundingClientRect();
    const rp = ruchOgraniczony ? null : plenerTor.getBoundingClientRect();
    const rk = ruchOgraniczony ? null : przekrojTor.getBoundingClientRect();
    let aktywny = -1;
    sekcje.forEach((s, i) => { if (s && s.getBoundingClientRect().top < vh * 0.4) aktywny = i; });

    nav.classList.toggle('przewiniety', y > 8);
    /* Zmienne tylko na elementach, które ich używają: --pp na <html> albo <main>
       dziedziczy cała strona i każda klatka przewijania przeliczała styl
       wszystkich elementów (ślad Chrome: 11,8 s → 0,4 s). */
    pasek.style.transform = `scaleX(${calosc > 0 ? (y / calosc).toFixed(4) : 0})`;

    /* nić: postęp liczony względem głównej treści; głowica jedzie transformem
       (--pp-px), bo „top” liczony z --pp przesuwał ją w układzie — CLS. */
    const pp = ogr((vh * 0.5 - rm.top) / rm.height);
    watek.style.setProperty('--pp', pp.toFixed(4));
    watek.style.setProperty('--pp-px', `${(pp * rm.height).toFixed(1)}px`);

    if (ruchOgraniczony) { plener(0.55); przekroj(0.5); } else {
      plener(ogr(-rp.top / Math.max(1, rp.height - vh * 0.8)));
      ostatniP = ogr((vh - rk.top) / (vh + rk.height));
      przekroj(ostatniP);
    }
    linki.forEach((a, i) => a.classList.toggle('aktywny', i === aktywny));
  }
  const przewin = () => { if (!czeka) { czeka = true; requestAnimationFrame(klatka); } };
  addEventListener('scroll', przewin, { passive: true });
  addEventListener('resize', przewin);

  // -------------------------------------------------------------------------
  // Kursor: światło na kartach, magnetyczne przyciski, pochylenie czatu
  // -------------------------------------------------------------------------

  if (zKursorem && !ruchOgraniczony) {
    $$('.karta').forEach((k) => k.addEventListener('pointermove', (e) => {
      const r = k.getBoundingClientRect();
      k.style.setProperty('--mx', `${e.clientX - r.left}px`);
      k.style.setProperty('--my', `${e.clientY - r.top}px`);
    }));
    $$('.magnes').forEach((b) => {
      b.addEventListener('pointermove', (e) => {
        const r = b.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        b.style.transform = `translate(${dx * 0.18}px, ${dy * 0.28}px)`;
      });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
    const scena = $('.hero-scena');
    const karta = $('#czat');
    scena.addEventListener('pointermove', (e) => {
      const r = scena.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      karta.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`);
      karta.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
    });
    scena.addEventListener('pointerleave', () => { karta.style.setProperty('--ry', '0deg'); karta.style.setProperty('--rx', '0deg'); });
  }

  // -------------------------------------------------------------------------
  // Pas znaczników: druga kopia, żeby przewijanie było bez szwu
  // -------------------------------------------------------------------------

  const tor = $('.pas-tor');
  Array.from(tor.children).forEach((s) => tor.appendChild(s.cloneNode(true)));

  // -------------------------------------------------------------------------
  // Zalogowany? W miejscu „Zaloguj się” pokazujemy „Otwórz Cosmos”.
  // -------------------------------------------------------------------------

  fetch('/api/auth', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || !d.authed) return;
      zalogowany = true;
      $$('.js-wejscie-tekst').forEach((el) => { el.innerHTML = t('otworz'); el.dataset.alt = t('wejdz'); });
    })
    .catch(() => { /* strona działa i bez serwera Cosmosa */ });

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  /* Po polsku liczby stoją w HTML-u już sformatowane — pierwszy
     Intl.NumberFormat (~25 ms na telefonie) powstaje dopiero, gdy liczniki
     wjadą w widok. Pierwsza klatka przewijania w requestAnimationFrame, nie
     tutaj: odczyt prostokątów w trakcie skryptu wymuszał pełny układ strony
     w tym samym długim zadaniu co wykonanie skryptu. */
  if (jezyk === 'en') zastosujJezyk();
  else { rozbijNaSlowa(); czat.odNowa(); }
  doc.classList.remove('czeka-na-jezyk');
  requestAnimationFrame(klatka);
})();

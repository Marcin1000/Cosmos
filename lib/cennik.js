/* ============================================================
   Cennik modeli – ile kosztuje wywołanie, w złotówkach

   Zespół agentów to kilka płatnych wywołań na jedno pytanie. Bez cennika
   budżet w złotówkach (lib/budzet.js) nie ma z czego liczyć, a osoba nie
   wie, czy „zrób zespołem” to grosz, czy złotówka.

   Ceny w USD za milion tokenów (wejście / wyjście), osobno dla każdego
   modelu. Źródła:
     – Claude: tabela modeli Anthropic (stan 2026-09-25) – `pewne: true`;
       starsze rodziny (Opus 4.1 i wcześniej, Sonnet 4.5 i wcześniej,
       Haiku 3.x) z pamięci – `pewne: false`,
     – OpenAI: z pamięci (stan 2026-06, gpt-5 do gpt-5.4) – `pewne: false`,
     – usługi (głos, obrazy, wideo – `kosztUslugiZl`): z pamięci, `pewne: false`.
   Właściciel poprawia ceny bez zmiany kodu: COSMOS_CENNIK (JSON), a kurs
   COSMOS_KURS_USD_PLN (domyślnie 3,70). Cenę zgadniętą (model spoza cennika)
   serwer zgłasza raz na model w dzienniku, a `stan()` mówi o niej Ustawieniom.

   Chmura NVIDIA (build.nvidia.com) i lokalny GPU kosztują 0 zł – płaci się
   tam limitem zapytań i prądem, nie rachunkiem za tokeny.

   Nieznany model płatny liczymy OSTROŻNIE: najdroższą ceną jego rodziny
   (np. nowy Sonnet → najdroższy znany Sonnet), a bez rodziny – najdroższą
   zwykłą ceną dostawcy. Zaniżony koszt przepuściłby budżet, zawyżony
   najwyżej zatrzyma turę wcześniej – i da się go poprawić w COSMOS_CENNIK.
   ============================================================ */

const STAN_CLAUDE = '2026-09-25';
const STAN_OPENAI = '2026-06';
const STAN_USLUG = '2026-06';
const KURS_DOMYSLNY = 3.7;
/* 'studio' – ElevenLabs, Seedance, Firefly: klucze właściciela spoza OpenAI
   i Claude'a, zapisywane w zużyciu pod tym silnikiem (lib/konta.js). */
const PLATNE = ['openai', 'claude', 'studio'];

/* Claude: klucz „rodzina-wersja”. Nazwy przychodzą w dwóch układach:
   nowy „claude-opus-4-8” i stary „claude-3-5-sonnet-20241022”. */
const CLAUDE = {
  'fable-5.1': [10, 50, true], 'fable-5.0': [10, 50, true],
  'mythos-5.1': [10, 50, true], 'mythos-5.0': [10, 50, true],
  'opus-5.5': [4, 20, true], 'opus-5.0': [5, 25, true], 'opus-4.8': [5, 25, true],
  'opus-4.7': [5, 25, true], 'opus-4.6': [5, 25, true],
  'opus-4.5': [5, 25, false], 'opus-4.1': [15, 75, false], 'opus-4.0': [15, 75, false], 'opus-3.0': [15, 75, false],
  'sonnet-5.5': [2, 10, true], 'sonnet-5.0': [2, 10, true], 'sonnet-4.6': [3, 15, true],
  'sonnet-4.5': [3, 15, false], 'sonnet-4.0': [3, 15, false], 'sonnet-3.7': [3, 15, false], 'sonnet-3.5': [3, 15, false],
  'haiku-4.5': [1, 5, true], 'haiku-3.5': [0.8, 4, false], 'haiku-3.0': [0.25, 1.25, false],
};

/* OpenAI: dokładne nazwy (bez daty na końcu) i rodziny – od najwęższej. */
const OPENAI = {
  'gpt-5': [1.25, 10], 'gpt-5-chat-latest': [1.25, 10], 'gpt-5-mini': [0.25, 2], 'gpt-5-nano': [0.05, 0.4],
  'gpt-5-pro': [15, 120],
  'gpt-5.1': [1.25, 10], 'gpt-5.1-mini': [0.25, 2],
  'gpt-5.2': [1.75, 14], 'gpt-5.2-pro': [21, 168],
  'gpt-5.4': [2.5, 15], 'gpt-5.4-mini': [0.75, 4.5], 'gpt-5.4-nano': [0.2, 1.25], 'gpt-5.4-pro': [30, 180],
  'gpt-4.1': [2, 8], 'gpt-4.1-mini': [0.4, 1.6], 'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4o': [2.5, 10], 'gpt-4o-mini': [0.15, 0.6],
  o3: [2, 8], 'o3-mini': [1.1, 4.4], 'o3-pro': [20, 80], 'o4-mini': [1.1, 4.4],
  o1: [15, 60], 'o1-mini': [1.1, 4.4], 'o1-pro': [150, 600],
  'o3-deep-research': [10, 40], 'o4-mini-deep-research': [2, 8], 'gpt-4.5-preview': [75, 150],
  'gpt-4-turbo': [10, 30], 'gpt-4': [30, 60], 'gpt-3.5-turbo': [0.5, 1.5],
};
/* Linia gpt-5 i nowsze: warianty (pro, mini, nano) – najdroższa znana cena
   wariantu w całej linii; nieznana wersja gpt-N.M bez wariantu – najdroższa
   znana GŁÓWNA wersja (nie cena gpt-5 z sierpnia 2025, bo nowsze wersje
   bywają droższe – zespół IT, etap 5: gpt-5.4 liczony jak gpt-5 = budżet
   zaniżony o połowę). Sam „gpt-5-coś” bez numeru wersji – jak gpt-5. */
const LINIA = '(?:5(?:\\.\\d+)?|[6-9](?:\\.\\d+)?|\\d{2,}(?:\\.\\d+)?)';
const wariantyLinii = (w) => Object.keys(OPENAI).filter((k) => new RegExp(`^gpt-5(?:\\.\\d+)?-${w}$`).test(k));
const RODZINY_OPENAI = [
  [new RegExp(`^gpt-${LINIA}-pro`), wariantyLinii('pro')],
  [/^o\d+-pro/, ['o1-pro', 'o3-pro']],
  [new RegExp(`^gpt-${LINIA}-nano`), wariantyLinii('nano')],
  [new RegExp(`^gpt-${LINIA}-mini`), wariantyLinii('mini')],
  [/^gpt-(?:5\.\d+|[6-9]|\d{2,})/, Object.keys(OPENAI).filter((k) => /^gpt-5(?:\.\d+)?$/.test(k))],
  [/^gpt-5/, ['gpt-5']],
  [/deep-research/, ['o3-deep-research', 'o4-mini-deep-research']],
  [/^gpt-4\.5/, ['gpt-4.5-preview']],
  [/^gpt-4\.1-nano/, ['gpt-4.1-nano']],
  [/^gpt-4\.1-mini/, ['gpt-4.1-mini']],
  [/^gpt-4\.1/, ['gpt-4.1']],
  [/^gpt-4o-mini/, ['gpt-4o-mini']],
  [/^gpt-4o/, ['gpt-4o']],
  [/^o\d+-mini/, ['o1-mini', 'o3-mini', 'o4-mini']],
  [/^o\d+/, ['o1', 'o3']],
  [/^gpt-4/, ['gpt-4', 'gpt-4-turbo']],
  [/^gpt-3\.5/, ['gpt-3.5-turbo']],
];
/* Bez rodziny: najdroższa ZWYKŁA cena dostawcy (bez wariantów „pro”, które
   są wyjątkiem, a nie tym, co ktoś wybiera przez pomyłkę w nazwie). */
const DOMYSLNIE = { openai: [30, 60], claude: [15, 75] };

/* Usługi poza tokenami (`kosztUslugiZl`) – USD za jednostkę CENNIKA:
     stt     – za minutę nagrania,
     tts     – za 1000 znaków tekstu (czytanie na głos),
     dzwiek  – za 1000 znaków (lektor w Studiu),
     obraz   – za sztukę; `duzy` = każdy rozmiar większy niż 1024×1024,
     wideo   – za sekundę filmu, osobno dla rozdzielczości.
   Wszystko z pamięci (stan 2026-06) – `pewne: false`. Jakość obrazu, której
   Cosmos nie wybiera („auto” u gpt-image), liczymy jak najwyższą: dostawca
   sam decyduje, a zaniżony koszt przepuściłby budżet. Nieznany model usługi –
   najdroższa cena tego rodzaju (ostrożnie, jak przy tokenach). */
const USLUGI = {
  stt: [
    [/mini-transcribe/, 0.003], [/transcribe/, 0.006], [/whisper/, 0.006],
  ],
  tts: [
    [/^tts-1-hd/, 0.03], [/^tts-1/, 0.015], [/mini-tts/, 0.015], [/tts/, 0.015],
    [/eleven_(flash|turbo)/, 0.15], [/eleven/, 0.3],
  ],
  dzwiek: [
    [/eleven_(flash|turbo)/, 0.15], [/eleven/, 0.3],
  ],
  obraz: [
    [/^gpt-image-1-mini/, { zwykly: 0.036, duzy: 0.052 }],
    [/^gpt-image/, { zwykly: 0.167, duzy: 0.25 }],
    [/^dall-e-3/, { zwykly: 0.08, duzy: 0.12 }],
    [/^dall-e-2/, { zwykly: 0.02, duzy: 0.02 }],
    [/firefly/, { zwykly: 0.1, duzy: 0.1 }],
  ],
  wideo: [
    [/seedance.*lite/, { '480p': 0.02, '720p': 0.04, '1080p': 0.1 }],
    [/seedance/, { '480p': 0.03, '720p': 0.06, '1080p': 0.15 }],
  ],
};
const RODZAJE_USLUG = Object.keys(USLUGI);
/* Jednostka `ilosc` → jednostka cennika. */
const PRZELICZ = { stt: (s) => s / 60, tts: (z) => z / 1000, dzwiek: (z) => z / 1000, obraz: (n) => n, wideo: (s) => s };

/** Cena usługi z wpisu cennika dla danego rozmiaru/rozdzielczości. */
function cenaWpisu(wpis, wariant) {
  if (typeof wpis === 'number') return wpis;
  if (wpis[wariant] !== undefined) return wpis[wariant];
  return Math.max(...Object.values(wpis));
}

/* Cache wejścia OpenAI (z pamięci, 2026-06): `prompt_tokens` ZAWIERA
   `prompt_tokens_details.cached_tokens`, a tokeny z cache kosztują ułamek ceny
   wejścia. Bez tego długa rozmowa na gpt-5 (20 tys. wejścia, 18 tys. z cache)
   schodziła z budżetu ~5 razy szybciej niż z rachunku (zespół IT, etap 5).
   Model spoza listy (Claude przez warstwę zgodną z OpenAI – cache tam nie
   działa) – pełna cena, czyli ostrożnie. */
const CACHE = [
  [/^gpt-(?:5|[6-9]|\d{2,})/, 0.1],
  [/^gpt-4\.1|^o3|^o4-mini/, 0.25],
  [/^gpt-4o/, 0.5],
];

/* Ukryte myślenie na jedno wywołanie (tokeny płatne jak wyjście) – szacunek
   z pomiarów zespołu IT (koszt-tury.js, runda 9), tylko do REZERWACJI budżetu
   przed startem. Po wywołaniu liczy się `usage` dostawcy. */
const MYSLENIE = [
  [/fable|mythos/, 3000], [/opus-5/, 1500], [/sonnet-5/, 2000],
  [/^gpt-(?:5|[6-9]|\d{2,})(\.\d+)?-nano/, 800], [/^gpt-(?:5|[6-9]|\d{2,})(\.\d+)?-mini/, 1000],
  [/^gpt-(?:5|[6-9]|\d{2,})/, 1500], [/^o\d/, 1500],
];

const zaokraglij = (x) => Math.round(x * 1e4) / 1e4;
const liczbaDodatnia = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0);

/** Nazwa bez dostawcy z przodu i bez daty na końcu, małymi literami. */
function normalizuj(model) {
  return String(model || '').trim().toLowerCase()
    .replace(/^(?:anthropic|openai)[/.:]/, '')
    .replace(/[-@](?:\d{4}-\d{2}-\d{2}|\d{8})$/, '');
}

/** { rodzina, wersja } dla nazwy Claude'a albo null. */
function wersjaClaude(id) {
  let m = id.match(/(fable|mythos|opus|sonnet|haiku)[-_ ]?(\d+)(?:[-.](\d{1,2})(?!\d))?/);
  if (m) return { rodzina: m[1], klucz: `${m[1]}-${m[2]}.${m[3] || 0}` };
  m = id.match(/claude-(\d+)(?:[-.](\d{1,2})(?!\d))?-(opus|sonnet|haiku)/);
  if (m) return { rodzina: m[3], klucz: `${m[3]}-${m[1]}.${m[2] || 0}` };
  m = id.match(/(fable|mythos|opus|sonnet|haiku)/);
  return m ? { rodzina: m[1], klucz: '' } : null;
}

/** Najdroższa cena z listy (osobno wejście i wyjście – ostrożnie w obie strony). */
function najdrozsza(ceny) {
  return [Math.max(...ceny.map((c) => c[0])), Math.max(...ceny.map((c) => c[1]))];
}

/** Nadpisania właściciela: { "model": [we, wy] | {we, wy} }, klucz z „*” na
 *  końcu = przedrostek (najdłuższy wygrywa). Zły JSON – ostrzeżenie i nic. */
function wczytajNadpisania(tekst) {
  if (!tekst || !String(tekst).trim()) return [];
  let j;
  try { j = JSON.parse(String(tekst)); } catch (err) {
    console.warn(`COSMOS_CENNIK to nie jest poprawny JSON – pomijam (${err.message}).`);
    return [];
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return [];
  const wynik = [];
  const nieujemna = (x) => x !== undefined && x !== null && x !== '' && Number.isFinite(Number(x)) && Number(x) >= 0;
  for (const [klucz, v] of Object.entries(j)) {
    const para = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.we, v.wy] : null;
    if (!para) continue;
    const k = klucz.trim().toLowerCase();
    const wpis = { klucz: k.endsWith('*') ? k.slice(0, -1) : normalizuj(k), przedrostek: k.endsWith('*') };
    // Tokeny: [we, wy] albo {we, wy}.
    if (nieujemna(para[0]) && nieujemna(para[1])) { wpis.we = Number(para[0]); wpis.wy = Number(para[1]); }
    /* Usługi: {"gpt-image-1": {"obraz": 0.04}} – USD za jednostkę cennika
       (stt – minuta, tts/dzwiek – 1000 znaków, obraz – sztuka, wideo – sekunda). */
    if (!Array.isArray(v)) {
      for (const r of RODZAJE_USLUG) if (nieujemna(v[r])) (wpis.uslugi || (wpis.uslugi = {}))[r] = Number(v[r]);
    }
    if (wpis.we === undefined && !wpis.uslugi) continue;
    wynik.push(wpis);
  }
  // Dokładne przed przedrostkami, dłuższe przedrostki przed krótszymi.
  return wynik.sort((a, b) => (a.przedrostek - b.przedrostek) || (b.klucz.length - a.klucz.length));
}

/** Kurs z tekstu („3,70” albo „3.70”); zły albo ≤ 0 – domyślny. */
function wczytajKurs(tekst) {
  const k = Number(String(tekst ?? '').trim().replace(',', '.'));
  return Number.isFinite(k) && k > 0 ? k : KURS_DOMYSLNY;
}

/**
 * @param {object} o
 * @param {object} o.env  zmienne środowiska (COSMOS_CENNIK, COSMOS_KURS_USD_PLN)
 */
function utworzCennik({ env = process.env } = {}) {
  const nadpisania = wczytajNadpisania(env.COSMOS_CENNIK);
  const kursZl = wczytajKurs(env.COSMOS_KURS_USD_PLN);
  const dzis = new Date().toLocaleDateString('sv-SE');

  const darmowy = (silnik) => !PLATNE.includes(silnik);

  /* Ceny zgadnięte (model spoza cennika): raz na model ostrzeżenie w dzienniku,
     a lista idzie do `stan()` – Ustawienia pokazują, że liczba jest przybliżona.
     Zbiór ograniczony, żeby dziwne nazwy nie rosły w pamięci bez końca. */
  const zgadniete = new Map();
  function zglosZgadniete(id, rodzaj, cena) {
    const klucz = `${rodzaj}:${id}`;
    if (zgadniete.has(klucz) || zgadniete.size >= 50) return;
    zgadniete.set(klucz, { model: id, rodzaj, cena });
    console.warn(`Cena modelu „${id}” (${rodzaj}) zgadnięta ostrożnie (${cena}) – popraw ją w COSMOS_CENNIK, jeśli znasz prawdziwą.`);
  }
  const znajdzNadpisanie = (id, warunek) => nadpisania.find((n) => warunek(n)
    && (n.przedrostek ? id.startsWith(n.klucz) : id === n.klucz));

  function ceny(model, silnik) {
    if (darmowy(silnik)) return { we: 0, wy: 0, waluta: 'USD', zrodlo: 'darmowy', stan: dzis, pewne: true };
    const id = normalizuj(model);
    const z = znajdzNadpisanie(id, (n) => n.we !== undefined);
    if (z) return { we: z.we, wy: z.wy, waluta: 'USD', zrodlo: 'env', stan: dzis, pewne: true };

    const wynik = (para, zrodlo, stan, pewne) => {
      if (zrodlo === 'domysl') zglosZgadniete(id || '(bez nazwy)', 'tokeny', `${para[0]}/${para[1]} USD za mln tokenów`);
      return { we: para[0], wy: para[1], waluta: 'USD', zrodlo, stan, pewne };
    };
    /* Dostawca po NAZWIE modelu, nie po silniku: klucz OpenAI bywa wpięty
       w pośrednika z modelami Claude'a i odwrotnie. */
    const c = /claude|fable|mythos|opus|sonnet|haiku/.test(id) ? wersjaClaude(id) : null;
    if (c) {
      if (c.klucz && CLAUDE[c.klucz]) {
        const [we, wy, pewne] = CLAUDE[c.klucz];
        return wynik([we, wy], 'katalog', STAN_CLAUDE, pewne);
      }
      const rodzina = Object.entries(CLAUDE).filter(([k]) => k.startsWith(`${c.rodzina}-`)).map(([, v]) => v);
      return wynik(najdrozsza(rodzina), 'domysl', STAN_CLAUDE, false);
    }
    if (OPENAI[id]) return wynik(OPENAI[id], 'katalog', STAN_OPENAI, false);
    const rodzina = RODZINY_OPENAI.find(([wzor]) => wzor.test(id));
    if (rodzina) return wynik(najdrozsza(rodzina[1].map((n) => OPENAI[n])), 'domysl', STAN_OPENAI, false);
    return wynik(DOMYSLNIE[silnik] || DOMYSLNIE.openai, 'domysl', silnik === 'claude' ? STAN_CLAUDE : STAN_OPENAI, false);
  }

  /** Ułamek ceny wejścia za token z cache dla modelu (1 = pełna cena). */
  function mnoznikCache(model) {
    const id = normalizuj(model);
    const t = CACHE.find(([wzor]) => wzor.test(id));
    return t ? t[1] : 1;
  }

  /** Koszt w zł z liczby tokenów (z `usage` dostawcy). `cache` – ile z `we`
   *  przyszło z cache (OpenAI: prompt_tokens_details.cached_tokens); liczone
   *  ceną cache, reszta wejścia pełną ceną. Cache większy niż wejście – przycięty. */
  function kosztZl(model, silnik, { we = 0, wy = 0, cache = 0 } = {}) {
    if (darmowy(silnik)) return 0;
    const c = ceny(model, silnik);
    const wejscie = liczbaDodatnia(we);
    const zCache = Math.min(liczbaDodatnia(cache), wejscie);
    const koszt = (wejscie - zCache) * c.we + zCache * c.we * mnoznikCache(model) + liczbaDodatnia(wy) * c.wy;
    return zaokraglij((koszt / 1e6) * kursZl);
  }

  /** Ile tokenów ukrytego myślenia doliczyć przed startem. */
  function myslenieDla(model, myslenie) {
    if (myslenie === false) return 0;
    if (typeof myslenie === 'number') return liczbaDodatnia(myslenie);
    const id = normalizuj(model);
    const t = MYSLENIE.find(([wzor]) => wzor.test(id));
    return t ? t[1] : 0;
  }

  /** Szacunek PRZED startem: wejście + wyjście + ukryte myślenie modelu
   *  (chyba że `myslenie: false` albo podana liczba tokenów). */
  function szacujZl(model, silnik, { we = 0, wy = 0, myslenie } = {}) {
    if (darmowy(silnik)) return 0;
    return kosztZl(model, silnik, { we, wy: liczbaDodatnia(wy) + myslenieDla(model, myslenie) });
  }

  /**
   * Koszt usługi poza tokenami, w zł (kontrakt C4 między paczkami).
   * @param {'stt'|'tts'|'dzwiek'|'obraz'|'wideo'} rodzaj
   * @param {string} model  nazwa modelu; wariant po „@”: obraz – rozmiar
   *        („gpt-image-1@1536x1024”), wideo – rozdzielczość („seedance-1-0-pro@720p”)
   * @param {number} ilosc  stt – sekundy nagrania, tts/dzwiek – znaki,
   *        obraz – sztuki, wideo – sekundy filmu
   * @returns {{zl: number, pewne: boolean, zrodlo: string}}
   */
  function kosztUslugiZl(rodzaj, model, ilosc) {
    if (!RODZAJE_USLUG.includes(rodzaj)) return { zl: 0, pewne: false, zrodlo: 'nieznany-rodzaj' };
    const pelna = String(model || '').trim().toLowerCase();
    const [nazwa, wariantSurowy = ''] = pelna.split('@');
    const id = normalizuj(nazwa);
    const wariant = rodzaj === 'obraz'
      ? (/^1024x1024$/.test(wariantSurowy) || !wariantSurowy ? 'zwykly' : 'duzy')
      : wariantSurowy;
    const jednostki = PRZELICZ[rodzaj](liczbaDodatnia(ilosc));
    const zl = (usd) => zaokraglij(jednostki * usd * kursZl);
    // Nadpisanie właściciela: najpierw pełna nazwa z wariantem, potem sama nazwa.
    const z = znajdzNadpisanie(`${id}${wariantSurowy ? `@${wariantSurowy}` : ''}`, (n) => n.uslugi && n.uslugi[rodzaj] !== undefined)
      || znajdzNadpisanie(id, (n) => n.uslugi && n.uslugi[rodzaj] !== undefined);
    if (z) return { zl: zl(z.uslugi[rodzaj]), pewne: true, zrodlo: 'env' };
    const t = USLUGI[rodzaj].find(([wzor]) => wzor.test(id));
    if (t) return { zl: zl(cenaWpisu(t[1], wariant)), pewne: false, zrodlo: 'katalog' };
    const najwiecej = Math.max(...USLUGI[rodzaj].map(([, w]) => cenaWpisu(w, '')));
    zglosZgadniete(id || '(bez nazwy)', rodzaj, `${najwiecej} USD za jednostkę`);
    return { zl: zl(najwiecej), pewne: false, zrodlo: 'domysl' };
  }

  /** Stan cennika do Ustawień: daty cenników, czy ceny są z pamięci i które
   *  modele dostały cenę zgadniętą od startu serwera. */
  function stan() {
    return {
      kurs: kursZl,
      claude: { stan: STAN_CLAUDE, pewne: true },
      openai: { stan: STAN_OPENAI, pewne: false },
      uslugi: { stan: STAN_USLUG, pewne: false },
      nadpisan: nadpisania.length,
      zgadniete: [...zgadniete.values()].map((x) => ({ model: x.model, rodzaj: x.rodzaj })),
      saZgadniete: zgadniete.size > 0,
    };
  }

  return { ceny, kosztZl, szacujZl, kosztUslugiZl, stan, mnoznikCache, kurs: () => kursZl, darmowy };
}

module.exports = { utworzCennik, normalizuj, KURS_DOMYSLNY, STAN_OPENAI, STAN_CLAUDE };

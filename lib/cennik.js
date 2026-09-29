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
     – OpenAI: z pamięci (stan 2025-08-07, premiera gpt-5) – `pewne: false`.
   Właściciel poprawia ceny bez zmiany kodu: COSMOS_CENNIK (JSON), a kurs
   COSMOS_KURS_USD_PLN (domyślnie 3,70).

   Chmura NVIDIA (build.nvidia.com) i lokalny GPU kosztują 0 zł – płaci się
   tam limitem zapytań i prądem, nie rachunkiem za tokeny.

   Nieznany model płatny liczymy OSTROŻNIE: najdroższą ceną jego rodziny
   (np. nowy Sonnet → najdroższy znany Sonnet), a bez rodziny – najdroższą
   zwykłą ceną dostawcy. Zaniżony koszt przepuściłby budżet, zawyżony
   najwyżej zatrzyma turę wcześniej – i da się go poprawić w COSMOS_CENNIK.
   ============================================================ */

const STAN_CLAUDE = '2026-09-25';
const STAN_OPENAI = '2025-08-07';
const KURS_DOMYSLNY = 3.7;
const PLATNE = ['openai', 'claude'];

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
  'gpt-4.1': [2, 8], 'gpt-4.1-mini': [0.4, 1.6], 'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4o': [2.5, 10], 'gpt-4o-mini': [0.15, 0.6],
  o3: [2, 8], 'o3-mini': [1.1, 4.4], 'o3-pro': [20, 80], 'o4-mini': [1.1, 4.4],
  o1: [15, 60], 'o1-mini': [1.1, 4.4], 'o1-pro': [150, 600],
  'gpt-4-turbo': [10, 30], 'gpt-4': [30, 60], 'gpt-3.5-turbo': [0.5, 1.5],
};
const RODZINY_OPENAI = [
  [/^gpt-5(\.\d+)?-pro/, ['gpt-5-pro']],
  [/^o\d+-pro/, ['o1-pro', 'o3-pro']],
  [/^gpt-5(\.\d+)?-nano/, ['gpt-5-nano']],
  [/^gpt-5(\.\d+)?-mini/, ['gpt-5-mini']],
  [/^gpt-5/, ['gpt-5']],
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

/* Ukryte myślenie na jedno wywołanie (tokeny płatne jak wyjście) – szacunek
   z pomiarów zespołu IT (koszt-tury.js, runda 9), tylko do REZERWACJI budżetu
   przed startem. Po wywołaniu liczy się `usage` dostawcy. */
const MYSLENIE = [
  [/fable|mythos/, 3000], [/opus-5/, 1500], [/sonnet-5/, 2000],
  [/^gpt-5(\.\d+)?-nano/, 800], [/^gpt-5(\.\d+)?-mini/, 1000], [/^gpt-5/, 1500], [/^o\d/, 1500],
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
  for (const [klucz, v] of Object.entries(j)) {
    const para = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.we, v.wy] : null;
    if (!para) continue;
    const we = Number(para[0]);
    const wy = Number(para[1]);
    if (!Number.isFinite(we) || !Number.isFinite(wy) || we < 0 || wy < 0) continue;
    const k = klucz.trim().toLowerCase();
    wynik.push({ klucz: k.endsWith('*') ? k.slice(0, -1) : normalizuj(k), przedrostek: k.endsWith('*'), we, wy });
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

  function ceny(model, silnik) {
    if (darmowy(silnik)) return { we: 0, wy: 0, waluta: 'USD', zrodlo: 'darmowy', stan: dzis, pewne: true };
    const id = normalizuj(model);
    const z = nadpisania.find((n) => (n.przedrostek ? id.startsWith(n.klucz) : id === n.klucz));
    if (z) return { we: z.we, wy: z.wy, waluta: 'USD', zrodlo: 'env', stan: dzis, pewne: true };

    const wynik = (para, zrodlo, stan, pewne) => ({ we: para[0], wy: para[1], waluta: 'USD', zrodlo, stan, pewne });
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
    return wynik(DOMYSLNIE[silnik], 'domysl', silnik === 'claude' ? STAN_CLAUDE : STAN_OPENAI, false);
  }

  /** Koszt w zł z liczby tokenów (z `usage` dostawcy). */
  function kosztZl(model, silnik, { we = 0, wy = 0 } = {}) {
    if (darmowy(silnik)) return 0;
    const c = ceny(model, silnik);
    return zaokraglij(((liczbaDodatnia(we) * c.we + liczbaDodatnia(wy) * c.wy) / 1e6) * kursZl);
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

  return { ceny, kosztZl, szacujZl, kurs: () => kursZl, darmowy };
}

module.exports = { utworzCennik, normalizuj, KURS_DOMYSLNY };

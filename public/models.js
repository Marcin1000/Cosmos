/* ============================================================
   Cosmos — katalog modeli

   Lista modeli zwracana przez `/v1/models` to same identyfikatory. Sam ciąg
   „nvidia/nemotron-3-super-120b-a12b" nie mówi, czy model widzi obrazy, ile
   pamięta kontekstu ani czy nadaje się do rozumowania — a to decyduje o tym,
   czy wybór ma sens dla zadania.

   Ten plik dokłada do identyfikatorów wiedzę o tym, do czego każdy model
   się nadaje. Dopasowanie idzie po fragmencie nazwy, więc nowe warianty
   („…-v3", „…-instruct") trafiają do właściwego wpisu bez zmian w kodzie.

   Pola:
     dopasuj    fragmenty nazwy (małymi literami); pierwszy trafiony wygrywa
     nazwa      krótka etykieta dla człowieka
     opis       jedno zdanie: do czego to jest
     mocne      lista konkretnych zastosowań
     kontekst   rozmiar okna kontekstu, opisowo
     cechy      wizja | rozumowanie | narzędzia | szybki | polski
     uwaga      ostrzeżenie, jeśli jakieś jest (np. nie zmieści się na 10 GB)
   ============================================================ */

const MODEL_CATALOG = [
  // ---- NVIDIA Nemotron ----
  {
    dopasuj: ['nemotron-3-ultra', 'ultra-550b'],
    nazwa: 'Nemotron 3 Ultra 550B',
    opis: 'Flagowiec NVIDII — najlepszy do zadań, w których liczy się jakość, nie czas.',
    mocne: ['trudne rozumowanie', 'długie analizy', 'najlepsza polszczyzna', 'kod wielopikowy'],
    kontekst: '1 mln tokenów',
    cechy: ['rozumowanie', 'narzędzia', 'polski'],
    uwaga: 'Najwolniejszy z rodziny — do szybkich pytań weź Super albo Nano.',
  },
  {
    dopasuj: ['nemotron-3-super', 'super-120b'],
    nazwa: 'Nemotron 3 Super 120B',
    opis: 'Najlepszy stosunek jakości do szybkości — domyślny wybór na co dzień.',
    mocne: ['codzienna praca', 'rozumowanie', 'wywoływanie narzędzi', 'dobra polszczyzna'],
    kontekst: '1 mln tokenów',
    cechy: ['rozumowanie', 'narzędzia', 'polski'],
  },
  {
    dopasuj: ['nano-omni'],
    nazwa: 'Nemotron 3 Nano Omni 30B',
    opis: 'Omni-modalny: obrazy, wideo, mowa i tekst naraz, z rozumowaniem.',
    mocne: ['opis zdjęć i wideo', 'pytania o kadr', 'analiza materiału z drona'],
    kontekst: 'średni',
    cechy: ['wizja', 'rozumowanie'],
  },
  {
    dopasuj: ['nemotron-nano-12b-v2-vl', '12b-v2-vl'],
    nazwa: 'Nemotron Nano 12B VL',
    opis: 'Model wizyjny — wiele obrazów i wideo w jednym pytaniu.',
    mocne: ['porównywanie zdjęć', 'czytanie tekstu z obrazu', 'kontrola jakości ujęć'],
    kontekst: 'średni',
    cechy: ['wizja'],
  },
  {
    dopasuj: ['nemotron-3-nano-30b', 'nano-30b-a3b'],
    nazwa: 'Nemotron 3 Nano 30B',
    opis: 'Lekki model MoE — szybki, sensowny kompromis jakości.',
    mocne: ['szybkie odpowiedzi', 'proste zadania', 'streszczenia'],
    kontekst: 'duży',
    cechy: ['szybki', 'narzędzia'],
    uwaga: 'MoE zmniejsza obliczenia, nie pamięć — lokalnie potrzebuje ~16–18 GB VRAM.',
  },
  {
    dopasuj: ['nemotron-nano-9b', 'nano-9b-v2'],
    nazwa: 'Nemotron Nano 9B v2',
    opis: 'Hybryda Transformer-Mamba — mieści się na RTX 3080 i ma budżet myślenia.',
    mocne: ['praca lokalna', 'szybkie odpowiedzi', 'długi kontekst tanim kosztem'],
    kontekst: 'duży (Mamba oszczędza pamięć)',
    cechy: ['szybki', 'rozumowanie'],
  },
  {
    dopasuj: ['nemotron-mini', 'mini-4b'],
    nazwa: 'Nemotron Mini 4B',
    opis: 'Najmniejszy z rodziny — na słabsze karty i bardzo szybkie odpowiedzi.',
    mocne: ['słaby sprzęt', 'proste polecenia'],
    kontekst: 'mały',
    cechy: ['szybki'],
    uwaga: 'Po polsku wyraźnie słabszy niż większe modele.',
  },
  {
    dopasuj: ['nemotron-embed', 'embed-1b', 'embedqa'],
    nazwa: 'Nemotron Embed',
    opis: 'Model embeddingów — nie do rozmowy, tylko do wyszukiwania semantycznego.',
    mocne: ['baza wiedzy', 'pamięć długotrwała'],
    kontekst: 'krótkie fragmenty',
    cechy: [],
    uwaga: 'Nie wybieraj go do czatu — ustawia się go w EMBED, nie jako model rozmowy.',
  },

  // ---- OpenAI ----
  {
    dopasuj: ['gpt-4o-mini', 'gpt-5-mini', 'o4-mini'],
    nazwa: 'GPT mini',
    opis: 'Tania i szybka wersja — do prostych zadań i dużej liczby zapytań.',
    mocne: ['szybkie odpowiedzi', 'niski koszt', 'proste przetwarzanie tekstu'],
    kontekst: 'duży',
    cechy: ['szybki', 'wizja', 'narzędzia'],
  },
  {
    dopasuj: ['gpt-4o', 'gpt-5', 'gpt-4.1'],
    nazwa: 'GPT (pełny)',
    opis: 'Uniwersalny model OpenAI — mocny w kodzie, obrazach i rozmowie.',
    mocne: ['kod', 'analiza obrazów', 'pisanie', 'wywoływanie narzędzi'],
    kontekst: 'duży',
    cechy: ['wizja', 'narzędzia', 'polski'],
  },
  {
    dopasuj: ['gpt-image', 'dall-e'],
    nazwa: 'Model obrazów OpenAI',
    opis: 'Generowanie grafiki — używany przez Studio, nie przez czat.',
    mocne: ['grafiki', 'storyboard', 'edycja maską'],
    kontekst: '—',
    cechy: [],
    uwaga: 'Nie ustawiaj go jako modelu rozmowy — służy Studiu.',
  },
  {
    dopasuj: ['o3', 'o1'],
    nazwa: 'OpenAI o-series (rozumowanie)',
    opis: 'Model rozumujący — myśli dłużej, zanim odpowie.',
    mocne: ['matematyka', 'logika', 'trudne debugowanie'],
    kontekst: 'duży',
    cechy: ['rozumowanie'],
    uwaga: 'Wolniejszy i droższy — nie do zwykłej rozmowy.',
  },

  // ---- Anthropic ----
  {
    dopasuj: ['claude-opus'],
    nazwa: 'Claude Opus',
    opis: 'Najmocniejszy Claude — do długich, złożonych zadań.',
    mocne: ['analiza długich dokumentów', 'refaktoryzacja kodu', 'pisanie'],
    kontekst: 'bardzo duży',
    cechy: ['wizja', 'rozumowanie', 'narzędzia', 'polski'],
  },
  {
    dopasuj: ['claude-sonnet'],
    nazwa: 'Claude Sonnet',
    opis: 'Zrównoważony Claude — szybki, a nadal bardzo mocny.',
    mocne: ['codzienna praca', 'kod', 'długi kontekst'],
    kontekst: 'bardzo duży',
    cechy: ['wizja', 'rozumowanie', 'narzędzia', 'polski'],
  },
  {
    dopasuj: ['claude-haiku'],
    nazwa: 'Claude Haiku',
    opis: 'Najszybszy Claude — do zadań, gdzie liczy się czas odpowiedzi.',
    mocne: ['szybkie odpowiedzi', 'klasyfikacja', 'krótkie streszczenia'],
    kontekst: 'duży',
    cechy: ['szybki', 'wizja', 'narzędzia'],
  },

  // ---- lokalne ----
  {
    dopasuj: ['llava', 'qwen2.5vl', 'qwen2-vl', '-vl'],
    nazwa: 'Lokalny model wizyjny',
    opis: 'Rozpoznaje obrazy na Twoim GPU — bez wysyłania zdjęć do chmury.',
    mocne: ['prywatna analiza zdjęć', 'praca offline'],
    kontekst: 'zależny od modelu',
    cechy: ['wizja'],
  },
];

/* Fragmenty nazw, z których da się wyczytać cechę, gdy modelu nie ma
   w katalogu. Lepsze niż brak informacji, i uczciwie oznaczone jako domysł. */
const HINTS = [
  { frag: ['-vl', 'vision', 'omni', 'llava'], cecha: 'wizja' },
  { frag: ['reason', 'thinking', '-r1'], cecha: 'rozumowanie' },
  { frag: ['mini', 'nano', 'small', 'tiny', 'flash'], cecha: 'szybki' },
  { frag: ['instruct', 'chat', 'it'], cecha: 'narzędzia' },
];

const CECHA_OPIS = {
  wizja: { ikona: '👁', pl: 'widzi obrazy', en: 'sees images' },
  rozumowanie: { ikona: '🧠', pl: 'rozumowanie', en: 'reasoning' },
  narzędzia: { ikona: '🔧', pl: 'narzędzia', en: 'tools' },
  szybki: { ikona: '⚡', pl: 'szybki', en: 'fast' },
  polski: { ikona: '🇵🇱', pl: 'dobra polszczyzna', en: 'strong Polish' },
};

/** Znajdź opis modelu po jego identyfikatorze. Zwraca null, gdy nic nie pasuje. */
function modelInfo(id) {
  if (!id) return null;
  const key = String(id).toLowerCase();
  for (const entry of MODEL_CATALOG) {
    if (entry.dopasuj.some((frag) => key.includes(frag))) return { ...entry, zgadywane: false };
  }
  // Nieznany model — wyczytaj, co się da, z samej nazwy i powiedz, że to domysł.
  const cechy = HINTS.filter((h) => h.frag.some((f) => key.includes(f))).map((h) => h.cecha);
  return cechy.length ? { nazwa: id, opis: null, mocne: [], kontekst: null, cechy, zgadywane: true } : null;
}

/** Czy model przyjmuje obrazy? Używane, by ostrzec przed wysłaniem zdjęcia. */
function modelSeesImages(id) {
  const info = modelInfo(id);
  return Boolean(info && info.cechy.includes('wizja'));
}

if (typeof window !== 'undefined') {
  window.MODEL_CATALOG = MODEL_CATALOG;
  window.modelInfo = modelInfo;
  window.modelSeesImages = modelSeesImages;
  window.CECHA_OPIS = CECHA_OPIS;
}
if (typeof module !== 'undefined') {
  module.exports = { MODEL_CATALOG, modelInfo, modelSeesImages, CECHA_OPIS };
}

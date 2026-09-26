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
     en         te same pola tekstowe po angielsku (opis, mocne, kontekst,
                uwaga, czasem nazwa). modelInfo() podmienia je, gdy interfejs
                jest po angielsku — bez tego angielskie Ustawienia pokazywały
                „Mocny, ale nierówny…”. Brak pola w `en` = zostaje polskie.
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
    uwaga: 'Najwolniejszy z rodziny i nie zawsze odpowiada — do szybkich pytań weź Super 49B.',
    en: {
      opis: 'NVIDIA\'s flagship — best for work where quality matters more than time.',
      mocne: ['hard reasoning', 'long analyses', 'best Polish', 'multi-step code'],
      kontekst: '1M tokens',
      uwaga: 'Slowest of the family and doesn\'t always answer — for quick questions take Super 49B.',
    },
  },
  {
    dopasuj: ['nemotron-3-super', 'super-120b'],
    nazwa: 'Nemotron 3 Super 120B',
    opis: 'Mocny, ale nierówny — zmierzone 0,5 s przy jednym przebiegu i 5,8 s przy drugim.',
    mocne: ['codzienna praca', 'rozumowanie', 'wywoływanie narzędzi', 'dobra polszczyzna'],
    kontekst: '1 mln tokenów',
    cechy: ['rozumowanie', 'narzędzia', 'polski'],
    en: {
      opis: 'Strong but uneven — measured 0.5 s on one run and 5.8 s on another.',
      mocne: ['everyday work', 'reasoning', 'tool calling', 'good Polish'],
      kontekst: '1M tokens',
    },
  },
  {
    dopasuj: ['nano-omni'],
    nazwa: 'Nemotron 3 Nano Omni 30B',
    opis: 'Omni-modalny: obrazy, wideo, mowa i tekst naraz, z rozumowaniem.',
    mocne: ['opis zdjęć i wideo', 'pytania o kadr', 'analiza materiału z drona'],
    kontekst: 'średni',
    cechy: ['wizja', 'rozumowanie'],
    en: {
      opis: 'Omni-modal: images, video, speech and text at once, with reasoning.',
      mocne: ['describing photos and video', 'questions about the frame', 'reviewing drone footage'],
      kontekst: 'medium',
    },
  },
  {
    dopasuj: ['nemotron-nano-vl-8b', 'nemotron-nano-vl'],
    nazwa: 'Llama 3.1 Nemotron Nano VL 8B',
    opis: 'Mały model wizyjny NVIDII — zmieści się także lokalnie obok modelu tekstowego.',
    mocne: ['opis zdjęć', 'tekst z obrazu', 'praca lokalna na RTX'],
    kontekst: 'średni',
    cechy: ['wizja', 'szybki'],
    en: {
      opis: 'NVIDIA\'s small vision model — also fits locally next to a text model.',
      mocne: ['describing photos', 'text from images', 'local work on an RTX'],
      kontekst: 'medium',
    },
  },
  {
    dopasuj: ['nemotron-nano-12b-v2-vl', '12b-v2-vl'],
    nazwa: 'Nemotron Nano 12B VL',
    opis: 'Najpewniejszy model wizyjny: 0,2–0,3 s, odpowiadał w każdym pomiarze.',
    mocne: ['porównywanie zdjęć', 'czytanie tekstu z obrazu', 'kontrola jakości ujęć'],
    kontekst: 'średni',
    cechy: ['wizja'],
    en: {
      opis: 'The most reliable vision model: 0.2–0.3 s, answered in every measurement.',
      mocne: ['comparing photos', 'reading text from images', 'checking shot quality'],
      kontekst: 'medium',
    },
  },
  {
    dopasuj: ['nemotron-3-nano-30b', 'nano-30b-a3b'],
    nazwa: 'Nemotron 3 Nano 30B',
    opis: 'Lekki model MoE — szybki, sensowny kompromis jakości.',
    mocne: ['szybkie odpowiedzi', 'proste zadania', 'streszczenia'],
    kontekst: 'duży',
    cechy: ['szybki', 'narzędzia'],
    uwaga: 'MoE zmniejsza obliczenia, nie pamięć — lokalnie potrzebuje ~16–18 GB VRAM.',
    en: {
      opis: 'Light MoE model — fast, a sensible quality trade-off.',
      mocne: ['quick answers', 'simple tasks', 'summaries'],
      kontekst: 'large',
      uwaga: 'MoE cuts compute, not memory — locally it needs ~16–18 GB of VRAM.',
    },
  },
  {
    dopasuj: ['nemotron-nano-9b', 'nano-9b-v2'],
    nazwa: 'Nemotron Nano 9B v2',
    opis: 'Hybryda Transformer-Mamba — mieści się na RTX 3080 i ma budżet myślenia.',
    mocne: ['praca lokalna', 'długi kontekst tanim kosztem'],
    kontekst: 'duży (Mamba oszczędza pamięć)',
    cechy: ['szybki', 'rozumowanie'],
    uwaga: 'Model rozumujący: przy limicie poniżej ~700 tokenów zużywa cały budżet '
      + 'na myślenie i oddaje pustą treść. Podnieś „Maks. tokenów odpowiedzi".',
    en: {
      opis: 'Transformer-Mamba hybrid — fits on an RTX 3080 and has a thinking budget.',
      mocne: ['local work', 'long context on the cheap'],
      kontekst: 'large (Mamba saves memory)',
      uwaga: 'Reasoning model: with a limit below ~700 tokens it spends the whole budget on thinking and returns empty content. Raise “Max response tokens”.',
    },
  },
  {
    dopasuj: ['nemotron-mini', 'mini-4b'],
    nazwa: 'Nemotron Mini 4B',
    opis: 'Najmniejszy z rodziny — na słabsze karty i bardzo szybkie odpowiedzi.',
    mocne: ['słaby sprzęt', 'proste polecenia'],
    kontekst: 'mały',
    cechy: ['szybki'],
    uwaga: 'Po polsku wyraźnie słabszy niż większe modele.',
    en: {
      opis: 'Smallest of the family — for weaker cards and very fast answers.',
      mocne: ['weak hardware', 'simple commands'],
      kontekst: 'small',
      uwaga: 'Noticeably weaker in Polish than the bigger models.',
    },
  },
  {
    dopasuj: ['nemotron-embed', 'embed-1b', 'embedqa'],
    nazwa: 'Nemotron Embed',
    opis: 'Model embeddingów — nie do rozmowy, tylko do wyszukiwania semantycznego.',
    mocne: ['baza wiedzy', 'pamięć długotrwała'],
    kontekst: 'krótkie fragmenty',
    cechy: [],
    uwaga: 'Nie wybieraj go do czatu — ustawia się go w EMBED, nie jako model rozmowy.',
    en: {
      opis: 'Embedding model — not for chat, only for semantic search.',
      mocne: ['knowledge base', 'long-term memory'],
      kontekst: 'short passages',
      uwaga: 'Don\'t pick it for chat — it goes in EMBED, not as the conversation model.',
    },
  },

  {
    dopasuj: ['nemotron-super-49b', 'nemotron-super-49b-v1.5', 'llama-3.3-nemotron-super-49b'],
    nazwa: 'Llama 3.3 Nemotron Super 49B',
    opis: 'Najlepszy wybór do rozmowy: 0,3–0,4 s do pierwszego znaku, powtarzalnie.',
    mocne: ['codzienna rozmowa', 'dłuższe teksty', 'rozumowanie', 'kod'],
    kontekst: 'duży',
    cechy: ['szybki', 'rozumowanie', 'narzędzia', 'polski'],
    en: {
      opis: 'The best pick for conversation: 0.3–0.4 s to the first character, consistently.',
      mocne: ['everyday conversation', 'longer texts', 'reasoning', 'code'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['nemoguard', 'nemotron-safety-guard', 'content-safety', 'topic-control'],
    nazwa: 'Nemotron Guard (moderacja)',
    opis: 'Klasyfikator bezpieczeństwa treści — ocenia teksty, nie prowadzi rozmowy.',
    mocne: ['filtrowanie treści', 'kontrola tematu'],
    kontekst: 'krótkie fragmenty',
    cechy: [],
    uwaga: 'Odpowie, ale nie jako rozmówca — to narzędzie do oceny tekstu.',
    en: {
      nazwa: 'Nemotron Guard (moderation)',
      opis: 'Content-safety classifier — it rates text, it doesn\'t hold a conversation.',
      mocne: ['content filtering', 'topic control'],
      kontekst: 'short passages',
      uwaga: 'It will answer, but not as a conversation partner — it is a tool for rating text.',
    },
  },
  {
    dopasuj: ['riva-translate'],
    nazwa: 'Riva Translate 4B',
    opis: 'Model tłumaczeniowy NVIDII — do przekładu, nie do rozmowy.',
    mocne: ['tłumaczenie napisów', 'przekład opisów'],
    kontekst: 'mały',
    cechy: ['szybki'],
    uwaga: 'Do zwykłej rozmowy weź Nemotron — ten model tłumaczy.',
    en: {
      opis: 'NVIDIA\'s translation model — for translating, not for conversation.',
      mocne: ['translating subtitles', 'translating descriptions'],
      kontekst: 'small',
      uwaga: 'For regular conversation take Nemotron — this model translates.',
    },
  },
  {
    dopasuj: ['ising-calibration'],
    nazwa: 'Ising Calibration 31B',
    opis: 'Model badawczy NVIDII — czyta obrazy, ale nie jest modelem ogólnego przeznaczenia.',
    mocne: ['eksperymenty', 'zadania kalibracyjne'],
    kontekst: 'średni',
    cechy: ['wizja'],
    uwaga: 'Do codziennej pracy weź Nano Omni albo Nano 12B VL.',
    en: {
      opis: 'NVIDIA research model — reads images, but isn\'t a general-purpose model.',
      mocne: ['experiments', 'calibration tasks'],
      kontekst: 'medium',
      uwaga: 'For everyday work take Nano Omni or Nano 12B VL.',
    },
  },

  // ---- Meta Llama ----
  {
    dopasuj: ['llama-3.2-90b-vision', 'llama-3.2-11b-vision'],
    nazwa: 'Llama 3.2 Vision',
    opis: 'Wizyjna Llama — solidna do opisu zdjęć i czytania tekstu z obrazu.',
    mocne: ['opis zdjęć', 'tekst z obrazu', 'pytania o kadr'],
    kontekst: 'duży',
    cechy: ['wizja'],
    en: {
      opis: 'Vision Llama — solid for describing photos and reading text from images.',
      mocne: ['describing photos', 'text from images', 'questions about the frame'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['llama-3.1-8b-instruct', 'llama-3.2-1b-instruct', 'llama-3.2-3b-instruct', 'llama-3.1-8b'],
    nazwa: 'Llama mała (1B–8B)',
    opis: 'Lekka Llama — szybka, do prostych zadań i dużej liczby zapytań.',
    mocne: ['szybkie odpowiedzi', 'klasyfikacja', 'proste przetwarzanie'],
    kontekst: 'średni',
    cechy: ['szybki', 'narzędzia'],
    uwaga: 'Po polsku wyraźnie słabsza niż Nemotron — do pisania weź większy model.',
    en: {
      nazwa: 'Small Llama (1B–8B)',
      opis: 'Light Llama — fast, for simple tasks and many requests.',
      mocne: ['quick answers', 'classification', 'simple processing'],
      kontekst: 'medium',
      uwaga: 'Noticeably weaker in Polish than Nemotron — for writing take a bigger model.',
    },
  },

  // ---- inne, potwierdzone na koncie ----
  {
    dopasuj: ['gpt-oss-20b'],
    nazwa: 'GPT-OSS 20B',
    /* Model TEKSTOWY (karta modelu OpenAI). Cecha „wizja" stała tu po sondzie
       z obrazkiem 1×1, którą dostawca po prostu zignorował — zdjęcia leciały
       do modelu, który ich nie widzi. */
    opis: 'Otwarty model OpenAI z widocznym tokiem myślenia — sam tekst.',
    mocne: ['rozumowanie', 'kod', 'wyjaśnianie krok po kroku'],
    kontekst: 'duży',
    cechy: ['rozumowanie', 'narzędzia'],
    uwaga: 'Zdjęć nie widzi — do nich weź model wizyjny (Nano Omni, 12B VL, lokalnie qwen2.5vl).',
    en: {
      opis: 'Open OpenAI model with visible reasoning — text only.',
      mocne: ['reasoning', 'code', 'step-by-step explanations'],
      kontekst: 'large',
      uwaga: 'It cannot see photos — use a vision model for them (Nano Omni, 12B VL, locally qwen2.5vl).',
    },
  },
  {
    dopasuj: ['gpt-oss-120b', 'gpt-oss'],
    nazwa: 'GPT-OSS 120B',
    opis: 'Większy otwarty model OpenAI z widocznym tokiem myślenia — sam tekst.',
    mocne: ['rozumowanie', 'kod', 'dłuższe analizy'],
    kontekst: 'duży',
    cechy: ['rozumowanie', 'narzędzia'],
    en: {
      opis: 'The larger open OpenAI model with visible reasoning — text only.',
      mocne: ['reasoning', 'code', 'longer analyses'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['deepseek-v4-pro', 'deepseek-v4'],
    nazwa: 'DeepSeek V4 Pro',
    opis: 'Mocny model wielomodalny — dobry w kodzie i w analizie obrazów.',
    mocne: ['kod', 'analiza zdjęć', 'trudne rozumowanie'],
    kontekst: 'duży',
    cechy: ['wizja', 'rozumowanie', 'narzędzia'],
    en: {
      opis: 'Strong multimodal model — good at code and at analysing images.',
      mocne: ['code', 'photo analysis', 'hard reasoning'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['minimax-m3', 'minimax'],
    nazwa: 'MiniMax M3',
    opis: 'Duży model tekstowy — długi kontekst i sprawne rozumowanie.',
    mocne: ['długie dokumenty', 'analiza', 'pisanie'],
    kontekst: 'bardzo duży',
    cechy: ['rozumowanie', 'narzędzia'],
    en: {
      opis: 'Large text model — long context and capable reasoning.',
      mocne: ['long documents', 'analysis', 'writing'],
      kontekst: 'very large',
    },
  },
  {
    dopasuj: ['inkling'],
    nazwa: 'Inkling (Thinking Machines)',
    opis: 'Model wielomodalny — czyta obrazy razem z tekstem.',
    mocne: ['analiza zdjęć', 'rozmowa o materiale wizualnym'],
    kontekst: 'średni',
    cechy: ['wizja'],
    en: {
      opis: 'Multimodal model — reads images together with text.',
      mocne: ['photo analysis', 'talking about visual material'],
      kontekst: 'medium',
    },
  },

  // ---- OpenAI ----
  {
    dopasuj: ['gpt-4o-mini', 'gpt-5-mini', 'o4-mini'],
    nazwa: 'GPT mini',
    opis: 'Tania i szybka wersja — do prostych zadań i dużej liczby zapytań.',
    mocne: ['szybkie odpowiedzi', 'niski koszt', 'proste przetwarzanie tekstu'],
    kontekst: 'duży',
    cechy: ['szybki', 'wizja', 'narzędzia'],
    en: {
      opis: 'Cheap, fast version — for simple tasks and many requests.',
      mocne: ['quick answers', 'low cost', 'simple text processing'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['gpt-4o', 'gpt-5', 'gpt-4.1'],
    nazwa: 'GPT (pełny)',
    opis: 'Uniwersalny model OpenAI — mocny w kodzie, obrazach i rozmowie.',
    mocne: ['kod', 'analiza obrazów', 'pisanie', 'wywoływanie narzędzi'],
    kontekst: 'duży',
    cechy: ['wizja', 'narzędzia', 'polski'],
    en: {
      nazwa: 'GPT (full)',
      opis: 'General-purpose OpenAI model — strong at code, images and conversation.',
      mocne: ['code', 'image analysis', 'writing', 'tool calling'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['gpt-image', 'dall-e'],
    nazwa: 'Model obrazów OpenAI',
    opis: 'Generowanie grafiki — używany przez Studio, nie przez czat.',
    mocne: ['grafiki', 'storyboard', 'edycja maską'],
    kontekst: '—',
    cechy: [],
    uwaga: 'Nie ustawiaj go jako modelu rozmowy — służy Studiu.',
    en: {
      nazwa: 'OpenAI image model',
      opis: 'Image generation — used by Studio, not by the chat.',
      mocne: ['images', 'storyboard', 'mask editing'],
      kontekst: '—',
      uwaga: 'Don\'t set it as the conversation model — it serves Studio.',
    },
  },
  {
    dopasuj: ['o3', 'o1'],
    nazwa: 'OpenAI o-series (rozumowanie)',
    opis: 'Model rozumujący — myśli dłużej, zanim odpowie.',
    mocne: ['matematyka', 'logika', 'trudne debugowanie'],
    kontekst: 'duży',
    cechy: ['rozumowanie'],
    uwaga: 'Wolniejszy i droższy — nie do zwykłej rozmowy.',
    en: {
      nazwa: 'OpenAI o-series (reasoning)',
      opis: 'Reasoning model — thinks longer before it answers.',
      mocne: ['maths', 'logic', 'hard debugging'],
      kontekst: 'large',
      uwaga: 'Slower and more expensive — not for everyday conversation.',
    },
  },

  // ---- Anthropic ----
  {
    dopasuj: ['claude-opus'],
    nazwa: 'Claude Opus',
    opis: 'Najmocniejszy Claude — do długich, złożonych zadań.',
    mocne: ['analiza długich dokumentów', 'refaktoryzacja kodu', 'pisanie'],
    kontekst: 'bardzo duży',
    cechy: ['wizja', 'rozumowanie', 'narzędzia', 'polski'],
    en: {
      opis: 'The most capable Claude — for long, complex tasks.',
      mocne: ['long-document analysis', 'code refactoring', 'writing'],
      kontekst: 'very large',
    },
  },
  {
    dopasuj: ['claude-sonnet'],
    nazwa: 'Claude Sonnet',
    opis: 'Zrównoważony Claude — szybki, a nadal bardzo mocny.',
    mocne: ['codzienna praca', 'kod', 'długi kontekst'],
    kontekst: 'bardzo duży',
    cechy: ['wizja', 'rozumowanie', 'narzędzia', 'polski'],
    en: {
      opis: 'Balanced Claude — fast and still very capable.',
      mocne: ['everyday work', 'code', 'long context'],
      kontekst: 'very large',
    },
  },
  {
    dopasuj: ['claude-haiku'],
    nazwa: 'Claude Haiku',
    opis: 'Najszybszy Claude — do zadań, gdzie liczy się czas odpowiedzi.',
    mocne: ['szybkie odpowiedzi', 'klasyfikacja', 'krótkie streszczenia'],
    kontekst: 'duży',
    cechy: ['szybki', 'wizja', 'narzędzia'],
    en: {
      opis: 'The fastest Claude — for tasks where response time matters.',
      mocne: ['quick answers', 'classification', 'short summaries'],
      kontekst: 'large',
    },
  },

  // ---- lokalne (nazwy z Ollamy: „rodzina:rozmiar") ----
  /* Nazwy z Ollamy („llama3.2:3b", „qwen3:4b") katalog znał słabo, więc każdy
     mały model dostawał pełny prompt z narzędziami — 3,3–3,8 tys. tokenów przy
     oknie 4096 — i wypisywał znaczniki na ekran zamiast ich używać. */
  {
    dopasuj: ['llama3.2:1b', 'llama3.2:3b', 'qwen2.5:0.5b', 'qwen2.5:1.5b', 'qwen2.5:3b',
      'gemma3:1b', 'gemma3:270m', 'phi4-mini', 'smollm'],
    nazwa: 'Mały model lokalny (do 4B)',
    opis: 'Mały model na Twojej karcie — szybki, do krótkiej rozmowy bez narzędzi.',
    mocne: ['szybkie odpowiedzi', 'prywatność', 'praca bez internetu'],
    kontekst: 'mały',
    cechy: ['szybki'],
    uwaga: 'Narzędzi (wyszukiwanie, plan, archiwum) nie umie — Cosmos ich mu nie opisuje. Po polsku słaby.',
    en: {
      nazwa: 'Small local model (up to 4B)',
      opis: 'A small model on your GPU — fast, for short chats without tools.',
      mocne: ['quick answers', 'privacy', 'works offline'],
      kontekst: 'small',
      uwaga: 'It cannot use tools (search, plan, archive), so Cosmos does not describe them to it. Weak in Polish.',
    },
  },
  {
    dopasuj: ['qwen3:0.6b', 'qwen3:1.7b', 'qwen3:4b'],
    nazwa: 'Qwen3 mały (do 4B)',
    opis: 'Mały Qwen3 z trybem myślenia — rozsądny kompromis na słabszej karcie.',
    mocne: ['krótkie rozumowanie', 'proste zadania', 'praca bez internetu'],
    kontekst: 'średni',
    cechy: ['szybki', 'rozumowanie'],
    uwaga: 'Dostaje narzędzia w krótkiej wersji. Myślenie zjada limit odpowiedzi — daj co najmniej 1500 tokenów.',
    en: {
      nazwa: 'Small Qwen3 (up to 4B)',
      opis: 'A small Qwen3 with a thinking mode — a sensible compromise on a weaker GPU.',
      mocne: ['short reasoning', 'simple tasks', 'works offline'],
      kontekst: 'medium',
      uwaga: 'Gets the short version of the tools. Thinking eats the reply budget — give it at least 1500 tokens.',
    },
  },
  {
    dopasuj: ['llama3.2-vision', 'qwen2.5vl', 'qwen2.5-vl', 'minicpm-v', 'gemma3:4b', 'gemma3:12b', 'gemma3:27b',
      'llava', 'qwen2-vl', '-vl'],
    nazwa: 'Lokalny model wizyjny',
    opis: 'Rozpoznaje obrazy na Twoim GPU — bez wysyłania zdjęć do chmury.',
    mocne: ['prywatna analiza zdjęć', 'praca offline'],
    kontekst: 'zależny od modelu',
    cechy: ['wizja'],
    en: {
      nazwa: 'Local vision model',
      opis: 'Recognises images on your GPU — no photos sent to the cloud.',
      mocne: ['private photo analysis', 'offline work'],
      kontekst: 'depends on the model',
    },
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
  // `ik` = klasa ikony liniowej (style.css, `.ik-…`) — zamiast emoji, jak w całej aplikacji.
  wizja: { ik: 'ik-oko', pl: 'widzi obrazy', en: 'sees images' },
  rozumowanie: { ik: 'ik-mysl', pl: 'rozumowanie', en: 'reasoning' },
  narzędzia: { ik: 'ik-klucz', pl: 'narzędzia', en: 'tools' },
  szybki: { ik: 'ik-blyskawica', pl: 'szybki', en: 'fast' },
  polski: { ik: 'ik-dymek', pl: 'dobra polszczyzna', en: 'strong Polish' },
};

/* Język interfejsu. `getLang` daje i18n.js (ładowany wcześniej); w Node
   (testy wołają modelInfo przez require) go nie ma — wtedy polski. */
function jezykInterfejsu() {
  return typeof getLang === 'function' ? getLang() : 'pl';
}

/** Znajdź opis modelu po jego identyfikatorze. Zwraca null, gdy nic nie pasuje.
    Pola tekstowe w języku interfejsu (patrz `en` w nagłówku pliku). */
/* Warianty nazwy do dopasowania. Ollama pisze „rodzina:rozmiar" i bez
   myślnika przed numerem wersji („llama3.1:8b", „gpt-oss:20b"), katalog —
   jak NVIDIA i Hugging Face („llama-3.1-8b", „gpt-oss-20b"). Bez tego
   gpt-oss:20b trafiał we wpis 120B, a llama3.1:8b był dla katalogu obcy. */
function wariantyNazwy(id) {
  const k0 = String(id).toLowerCase();
  const k1 = k0.replace(/:/g, '-');
  const k2 = k1.replace(/([a-z])(\d)/g, '$1-$2');
  return [...new Set([k0, k1, k2])];
}

function modelInfo(id) {
  if (!id) return null;
  const key = String(id).toLowerCase();
  const warianty = wariantyNazwy(id);
  for (const entry of MODEL_CATALOG) {
    if (entry.dopasuj.some((frag) => warianty.some((w) => w.includes(frag)))) {
      const { en, ...wpis } = entry;
      return { ...wpis, ...(jezykInterfejsu() === 'en' && en ? en : {}), zgadywane: false };
    }
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

/* Ile instrukcji ma sens wysłać temu modelowi.
 *
 * Do niedawna KAŻDY model dostawał ten sam prompt systemowy: 1351 tokenów
 * opisu narzędzi, zanim użytkownik napisał słowo. Model 4-miliardowy dostawał
 * instrukcje do wyszukiwania, grafik, obrazów, akcji, procedur i urządzeń —
 * których nie umie użyć. To go spowalnia i rozprasza.
 *
 * Trzy poziomy:
 *   'pelny'   — model ogarnia protokoły znaczników; pełne opisy z niuansami.
 *   'zwiezly' — te same narzędzia, ale krótkim tekstem. Mniej kontekstu na
 *               instrukcje, więcej na rozmowę.
 *   'rozmowa' — same fakty (kim jest, data, miejsce) i zero narzędzi. Dla
 *               modeli, które i tak by ich nie użyły, a znacznik wypisałyby
 *               użytkownikowi na ekran.
 *
 * Model NIEZNANY dostaje 'pelny'. Ta sama zasada, co przy wzroku: lepiej dać
 * możliwość czemuś, czego nie znamy, niż odebrać ją po cichu na podstawie
 * domysłu z nazwy.
 */
function modelToolLevel(id) {
  const info = modelInfo(id);
  if (!info || info.zgadywane) return 'pelny';
  if (info.cechy.includes('narzędzia')) return 'pelny';
  // „szybki" bez rozumowania to modele rzędu paru miliardów parametrów.
  if (info.cechy.includes('szybki') && !info.cechy.includes('rozumowanie')) return 'rozmowa';
  return 'zwiezly';
}

/* Modele, które w ogóle nie mają końcówki /chat/completions — embeddingi,
   przeszukiwanie, OCR, ocena odpowiedzi, wykrywanie treści. Odpowiadają
   „404 page not found", co wygląda jak brak dostępu, a nim nie jest: one po
   prostu robią co innego. Część z nich Cosmos sam wykorzystuje (embeddingi
   w bazie wiedzy), więc wrzucanie ich do worka „niedostępne" wprowadzałoby
   w błąd. */
const NIE_DO_ROZMOWY = [
  'embed', 'rerank', 'nvclip', 'nemoretriever', 'ocr', '-parse',
  'reward', 'genrm', 'detector', 'deplot',
  // z listy Ollamy: bge-m3 (embeddingi Cosmosa) nie ma w nazwie „embed"
  'bge-m3', 'bge-large', 'bge-small',
];

/** Czy to model o innym przeznaczeniu niż rozmowa? */
function modelNotForChat(id) {
  const key = String(id || '').toLowerCase();
  return NIE_DO_ROZMOWY.some((frag) => key.includes(frag));
}

/* Osobna kategoria: modele, które MAJĄ /chat/completions i odpowiadają
   poprawnie, ale rozmówcami nie są. Klasyfikator bezpieczeństwa odsyła
   „safe" w jedną dziesiątą sekundy i przez to wygrywa każdy wyścig na
   szybkość — w rankingu „najlepsze do rozmowy" wyprzedzał flagowca 550B.
   Kto by posłuchał takiej podpowiedzi, ustawiłby sobie jako główny model
   coś, co umie odpowiedzieć wyłącznie „bezpieczne / niebezpieczne". */
const NIE_ROZMOWCA = [
  'nemoguard', 'safety-guard', 'content-safety', 'topic-control',
  'llama-guard', 'riva-translate', 'ising-calibration',
  // klasyfikatory bezpieczeństwa z Ollamy — odpowiedzą, ale tylko „bezpieczne / nie"
  'shieldgemma', 'granite3-guardian', 'guardian',
];

/** Czy model odpowiada, ale nie nadaje się na rozmówcę? */
function modelNotAChatPartner(id) {
  const key = String(id || '').toLowerCase();
  return modelNotForChat(key) || NIE_ROZMOWCA.some((frag) => key.includes(frag));
}

if (typeof window !== 'undefined') {
  window.MODEL_CATALOG = MODEL_CATALOG;
  window.modelInfo = modelInfo;
  window.modelSeesImages = modelSeesImages;
  window.modelNotForChat = modelNotForChat;
  window.modelNotAChatPartner = modelNotAChatPartner;
  window.modelToolLevel = modelToolLevel;
  window.CECHA_OPIS = CECHA_OPIS;
}
if (typeof module !== 'undefined') {
  module.exports = {
    MODEL_CATALOG, modelInfo, modelSeesImages,
    modelNotForChat, modelNotAChatPartner, modelToolLevel, CECHA_OPIS,
  };
}

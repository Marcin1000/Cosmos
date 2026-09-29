/* ============================================================
   Cosmos – katalog modeli

   Lista modeli zwracana przez `/v1/models` to same identyfikatory. Sam ciąg
   „nvidia/nemotron-3-super-120b-a12b" nie mówi, czy model widzi obrazy, ile
   pamięta kontekstu ani czy nadaje się do rozumowania – a to decyduje o tym,
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
     cechy      wizja | rozumowanie | narzędzia | szybki | polski | kod
     uwaga      ostrzeżenie, jeśli jakieś jest (np. nie zmieści się na 10 GB)
     poziom     klasa wielkości i kosztu: nano | mini | pelny | flagowy
                (POZIOMY – od najtańszego); dobór modeli do ról porównuje po nim
     myslenie   jak przełączyć myślenie (MYSLENIE niżej); brak pola = nie wiemy,
                więc nikt niczego do zapytania nie dopisuje
     vramGb     lokalnie: ile pamięci karty zajmuje model w kwantyzacji Q4 –
                liczba albo mapa rozmiarów {'8b': 6, '14b': 10} (vramDla)
     en         te same pola tekstowe po angielsku (opis, mocne, kontekst,
                uwaga, czasem nazwa). modelInfo() podmienia je, gdy interfejs
                jest po angielsku – bez tego angielskie Ustawienia pokazywały
                „Mocny, ale nierówny…”. Brak pola w `en` = zostaje polskie.
   ============================================================ */

/* Sposoby przełączania myślenia (pole `myslenie`). Te same nazwy czyta
   `ustawMyslenie` w lib/model.js – zmiana nazwy tu = zmiana tam.
     enable_thinking   chat_template_kwargs.enable_thinking (Nemotron 3, Qwen3 na vLLM/NIM)
     no_think          „/think” albo „/no_think” w wiadomości system (Nano 9B v2, Super 49B v1.5, Qwen3)
     detailed          „detailed thinking on|off” w system (Super 49B v1)
     reasoning_effort  parametr reasoning_effort (GPT-5, seria o, gpt-oss)
     zawsze            myśli zawsze, wyłączyć się nie da (DeepSeek R1) */
const MYSLENIE = ['enable_thinking', 'no_think', 'detailed', 'reasoning_effort', 'zawsze'];
const POZIOMY = ['nano', 'mini', 'pelny', 'flagowy'];

/* Wspólne pola dwóch wersji Super 49B: różnią się tylko przełącznikiem myślenia. */
const SUPER_49B = {
  nazwa: 'Llama 3.3 Nemotron Super 49B',
  opis: 'Najlepszy wybór do rozmowy: 0,3–0,4 s do pierwszego znaku, powtarzalnie.',
  mocne: ['codzienna rozmowa', 'dłuższe teksty', 'rozumowanie', 'kod'],
  kontekst: 'duży',
  cechy: ['szybki', 'rozumowanie', 'narzędzia', 'polski', 'kod'],
  poziom: 'pelny',
  en: {
    opis: 'The best pick for conversation: 0.3–0.4 s to the first character, consistently.',
    mocne: ['everyday conversation', 'longer texts', 'reasoning', 'code'],
    kontekst: 'large',
  },
};

const MODEL_CATALOG = [
  // ---- NVIDIA Nemotron ----
  {
    dopasuj: ['nemotron-3-ultra', 'ultra-550b'],
    nazwa: 'Nemotron 3 Ultra 550B',
    opis: 'Flagowiec NVIDII – najlepszy do zadań, w których liczy się jakość, nie czas.',
    mocne: ['trudne rozumowanie', 'długie analizy', 'najlepsza polszczyzna', 'kod wielopikowy'],
    kontekst: '1 mln tokenów',
    cechy: ['rozumowanie', 'narzędzia', 'polski', 'kod'],
    poziom: 'flagowy',
    myslenie: 'enable_thinking',
    uwaga: 'Najwolniejszy z rodziny i nie zawsze odpowiada – do szybkich pytań weź Super 49B.',
    en: {
      opis: 'NVIDIA\'s flagship – best for work where quality matters more than time.',
      mocne: ['hard reasoning', 'long analyses', 'best Polish', 'multi-step code'],
      kontekst: '1M tokens',
      uwaga: 'Slowest of the family and doesn\'t always answer – for quick questions take Super 49B.',
    },
  },
  {
    dopasuj: ['nemotron-3-super', 'super-120b'],
    nazwa: 'Nemotron 3 Super 120B',
    opis: 'Mocny, ale nierówny – zmierzone 0,5 s przy jednym przebiegu i 5,8 s przy drugim.',
    mocne: ['codzienna praca', 'rozumowanie', 'wywoływanie narzędzi', 'dobra polszczyzna'],
    kontekst: '1 mln tokenów',
    cechy: ['rozumowanie', 'narzędzia', 'polski'],
    poziom: 'pelny',
    myslenie: 'enable_thinking',
    en: {
      opis: 'Strong but uneven – measured 0.5 s on one run and 5.8 s on another.',
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
    poziom: 'mini',
    myslenie: 'enable_thinking',
    en: {
      opis: 'Omni-modal: images, video, speech and text at once, with reasoning.',
      mocne: ['describing photos and video', 'questions about the frame', 'reviewing drone footage'],
      kontekst: 'medium',
    },
  },
  {
    dopasuj: ['nemotron-nano-vl-8b', 'nemotron-nano-vl'],
    nazwa: 'Llama 3.1 Nemotron Nano VL 8B',
    opis: 'Mały model wizyjny NVIDII – zmieści się także lokalnie obok modelu tekstowego.',
    mocne: ['opis zdjęć', 'tekst z obrazu', 'praca lokalna na RTX'],
    kontekst: 'średni',
    cechy: ['wizja', 'szybki'],
    poziom: 'mini',
    vramGb: 6,
    en: {
      opis: 'NVIDIA\'s small vision model – also fits locally next to a text model.',
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
    poziom: 'mini',
    en: {
      opis: 'The most reliable vision model: 0.2–0.3 s, answered in every measurement.',
      mocne: ['comparing photos', 'reading text from images', 'checking shot quality'],
      kontekst: 'medium',
    },
  },
  {
    dopasuj: ['nemotron-3-nano-30b', 'nano-30b-a3b'],
    nazwa: 'Nemotron 3 Nano 30B',
    opis: 'Lekki model MoE – szybki, sensowny kompromis jakości.',
    mocne: ['szybkie odpowiedzi', 'proste zadania', 'streszczenia'],
    kontekst: 'duży',
    cechy: ['szybki', 'narzędzia'],
    poziom: 'mini',
    myslenie: 'enable_thinking',
    vramGb: 18,
    uwaga: 'MoE zmniejsza obliczenia, nie pamięć – lokalnie potrzebuje ~16–18 GB VRAM.',
    en: {
      opis: 'Light MoE model – fast, a sensible quality trade-off.',
      mocne: ['quick answers', 'simple tasks', 'summaries'],
      kontekst: 'large',
      uwaga: 'MoE cuts compute, not memory – locally it needs ~16–18 GB of VRAM.',
    },
  },
  {
    dopasuj: ['nemotron-nano-9b', 'nano-9b-v2'],
    nazwa: 'Nemotron Nano 9B v2',
    opis: 'Hybryda Transformer-Mamba – mieści się na RTX 3080 i ma budżet myślenia.',
    mocne: ['praca lokalna', 'długi kontekst tanim kosztem'],
    kontekst: 'duży (Mamba oszczędza pamięć)',
    cechy: ['szybki', 'rozumowanie'],
    poziom: 'mini',
    myslenie: 'no_think',
    vramGb: 7,
    uwaga: 'Model rozumujący: przy limicie poniżej ~700 tokenów zużywa cały budżet '
      + 'na myślenie i oddaje pustą treść. Podnieś „Maks. tokenów odpowiedzi".',
    en: {
      opis: 'Transformer-Mamba hybrid – fits on an RTX 3080 and has a thinking budget.',
      mocne: ['local work', 'long context on the cheap'],
      kontekst: 'large (Mamba saves memory)',
      uwaga: 'Reasoning model: with a limit below ~700 tokens it spends the whole budget on thinking and returns empty content. Raise “Max response tokens”.',
    },
  },
  {
    dopasuj: ['nemotron-mini', 'mini-4b'],
    nazwa: 'Nemotron Mini 4B',
    opis: 'Najmniejszy z rodziny – na słabsze karty i bardzo szybkie odpowiedzi.',
    mocne: ['słaby sprzęt', 'proste polecenia'],
    kontekst: 'mały',
    cechy: ['szybki'],
    poziom: 'nano',
    vramGb: 3,
    uwaga: 'Po polsku wyraźnie słabszy niż większe modele.',
    en: {
      opis: 'Smallest of the family – for weaker cards and very fast answers.',
      mocne: ['weak hardware', 'simple commands'],
      kontekst: 'small',
      uwaga: 'Noticeably weaker in Polish than the bigger models.',
    },
  },
  {
    dopasuj: ['nemotron-embed', 'embed-1b', 'embedqa'],
    nazwa: 'Nemotron Embed',
    opis: 'Model embeddingów – nie do rozmowy, tylko do wyszukiwania semantycznego.',
    mocne: ['baza wiedzy', 'pamięć długotrwała'],
    kontekst: 'krótkie fragmenty',
    cechy: [],
    uwaga: 'Nie wybieraj go do czatu – ustawia się go w EMBED, nie jako model rozmowy.',
    en: {
      opis: 'Embedding model – not for chat, only for semantic search.',
      mocne: ['knowledge base', 'long-term memory'],
      kontekst: 'short passages',
      uwaga: 'Don\'t pick it for chat – it goes in EMBED, not as the conversation model.',
    },
  },

  /* v1.5 przed v1: „…-49b-v1” jest fragmentem „…-49b-v1.5”. Różnią się
     przełącznikiem myślenia (karty modeli NVIDII, z pamięci). */
  { dopasuj: ['super-49b-v1.5', 'super-49b-v1-5'], ...SUPER_49B, myslenie: 'no_think' },
  { dopasuj: ['nemotron-super-49b', 'llama-3.3-nemotron-super-49b'], ...SUPER_49B, myslenie: 'detailed' },
  {
    dopasuj: ['nemoguard', 'nemotron-safety-guard', 'content-safety', 'topic-control'],
    nazwa: 'Nemotron Guard (moderacja)',
    opis: 'Klasyfikator bezpieczeństwa treści – ocenia teksty, nie prowadzi rozmowy.',
    mocne: ['filtrowanie treści', 'kontrola tematu'],
    kontekst: 'krótkie fragmenty',
    cechy: [],
    uwaga: 'Odpowie, ale nie jako rozmówca – to narzędzie do oceny tekstu.',
    en: {
      nazwa: 'Nemotron Guard (moderation)',
      opis: 'Content-safety classifier – it rates text, it doesn\'t hold a conversation.',
      mocne: ['content filtering', 'topic control'],
      kontekst: 'short passages',
      uwaga: 'It will answer, but not as a conversation partner – it is a tool for rating text.',
    },
  },
  {
    dopasuj: ['riva-translate'],
    nazwa: 'Riva Translate 4B',
    opis: 'Model tłumaczeniowy NVIDII – do przekładu, nie do rozmowy.',
    mocne: ['tłumaczenie napisów', 'przekład opisów'],
    kontekst: 'mały',
    cechy: ['szybki'],
    uwaga: 'Do zwykłej rozmowy weź Nemotron – ten model tłumaczy.',
    en: {
      opis: 'NVIDIA\'s translation model – for translating, not for conversation.',
      mocne: ['translating subtitles', 'translating descriptions'],
      kontekst: 'small',
      uwaga: 'For regular conversation take Nemotron – this model translates.',
    },
  },
  {
    dopasuj: ['ising-calibration'],
    nazwa: 'Ising Calibration 31B',
    opis: 'Model badawczy NVIDII – czyta obrazy, ale nie jest modelem ogólnego przeznaczenia.',
    mocne: ['eksperymenty', 'zadania kalibracyjne'],
    kontekst: 'średni',
    cechy: ['wizja'],
    uwaga: 'Do codziennej pracy weź Nano Omni albo Nano 12B VL.',
    en: {
      opis: 'NVIDIA research model – reads images, but isn\'t a general-purpose model.',
      mocne: ['experiments', 'calibration tasks'],
      kontekst: 'medium',
      uwaga: 'For everyday work take Nano Omni or Nano 12B VL.',
    },
  },

  // ---- Meta Llama ----
  {
    dopasuj: ['llama-3.2-90b-vision', 'llama-3.2-11b-vision'],
    nazwa: 'Llama 3.2 Vision',
    opis: 'Wizyjna Llama – solidna do opisu zdjęć i czytania tekstu z obrazu.',
    mocne: ['opis zdjęć', 'tekst z obrazu', 'pytania o kadr'],
    kontekst: 'duży',
    cechy: ['wizja'],
    poziom: 'pelny',
    en: {
      opis: 'Vision Llama – solid for describing photos and reading text from images.',
      mocne: ['describing photos', 'text from images', 'questions about the frame'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['llama-3.1-8b-instruct', 'llama-3.2-1b-instruct', 'llama-3.2-3b-instruct', 'llama-3.1-8b'],
    nazwa: 'Llama mała (1B–8B)',
    opis: 'Lekka Llama – szybka, do prostych zadań i dużej liczby zapytań.',
    mocne: ['szybkie odpowiedzi', 'klasyfikacja', 'proste przetwarzanie'],
    kontekst: 'średni',
    cechy: ['szybki', 'narzędzia'],
    poziom: 'nano',
    uwaga: 'Po polsku wyraźnie słabsza niż Nemotron – do pisania weź większy model.',
    en: {
      nazwa: 'Small Llama (1B–8B)',
      opis: 'Light Llama – fast, for simple tasks and many requests.',
      mocne: ['quick answers', 'classification', 'simple processing'],
      kontekst: 'medium',
      uwaga: 'Noticeably weaker in Polish than Nemotron – for writing take a bigger model.',
    },
  },

  // ---- inne, potwierdzone na koncie ----
  {
    dopasuj: ['gpt-oss-20b'],
    nazwa: 'GPT-OSS 20B',
    /* Model TEKSTOWY (karta modelu OpenAI). Cecha „wizja" stała tu po sondzie
       z obrazkiem 1×1, którą dostawca po prostu zignorował – zdjęcia leciały
       do modelu, który ich nie widzi. */
    opis: 'Otwarty model OpenAI z widocznym tokiem myślenia – sam tekst.',
    mocne: ['rozumowanie', 'kod', 'wyjaśnianie krok po kroku'],
    kontekst: 'duży',
    cechy: ['rozumowanie', 'narzędzia', 'kod'],
    poziom: 'mini',
    myslenie: 'reasoning_effort',
    vramGb: 14,
    uwaga: 'Zdjęć nie widzi – do nich weź model wizyjny (Nano Omni, 12B VL, lokalnie qwen2.5vl).',
    en: {
      opis: 'Open OpenAI model with visible reasoning – text only.',
      mocne: ['reasoning', 'code', 'step-by-step explanations'],
      kontekst: 'large',
      uwaga: 'It cannot see photos – use a vision model for them (Nano Omni, 12B VL, locally qwen2.5vl).',
    },
  },
  {
    dopasuj: ['gpt-oss-120b', 'gpt-oss'],
    nazwa: 'GPT-OSS 120B',
    opis: 'Większy otwarty model OpenAI z widocznym tokiem myślenia – sam tekst.',
    mocne: ['rozumowanie', 'kod', 'dłuższe analizy'],
    kontekst: 'duży',
    cechy: ['rozumowanie', 'narzędzia', 'kod'],
    poziom: 'pelny',
    myslenie: 'reasoning_effort',
    vramGb: 65,
    en: {
      opis: 'The larger open OpenAI model with visible reasoning – text only.',
      mocne: ['reasoning', 'code', 'longer analyses'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['deepseek-v4-pro', 'deepseek-v4'],
    nazwa: 'DeepSeek V4 Pro',
    opis: 'Mocny model wielomodalny – dobry w kodzie i w analizie obrazów.',
    mocne: ['kod', 'analiza zdjęć', 'trudne rozumowanie'],
    kontekst: 'duży',
    cechy: ['wizja', 'rozumowanie', 'narzędzia', 'kod'],
    poziom: 'flagowy',
    en: {
      opis: 'Strong multimodal model – good at code and at analysing images.',
      mocne: ['code', 'photo analysis', 'hard reasoning'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['minimax-m3', 'minimax'],
    nazwa: 'MiniMax M3',
    opis: 'Duży model tekstowy – długi kontekst i sprawne rozumowanie.',
    mocne: ['długie dokumenty', 'analiza', 'pisanie'],
    kontekst: 'bardzo duży',
    cechy: ['rozumowanie', 'narzędzia'],
    poziom: 'pelny',
    en: {
      opis: 'Large text model – long context and capable reasoning.',
      mocne: ['long documents', 'analysis', 'writing'],
      kontekst: 'very large',
    },
  },
  {
    dopasuj: ['inkling'],
    nazwa: 'Inkling (Thinking Machines)',
    opis: 'Model wielomodalny – czyta obrazy razem z tekstem.',
    mocne: ['analiza zdjęć', 'rozmowa o materiale wizualnym'],
    kontekst: 'średni',
    cechy: ['wizja'],
    en: {
      opis: 'Multimodal model – reads images together with text.',
      mocne: ['photo analysis', 'talking about visual material'],
      kontekst: 'medium',
    },
  },

  // ---- OpenAI ----
  /* Nano i mini wybiera POZIOM z nazwy (poziomOpenAI niżej), nie fragment:
     „gpt-5.5-mini” i „gpt-5.4-nano” łapały się na „gpt-5” i dostawały opis
     i koszt flagowca (zespół IT, runda 9). `klucz` to adres wpisu dla poziomu. */
  {
    klucz: 'gpt5-nano',
    dopasuj: ['gpt-5-nano'],
    nazwa: 'GPT-5 nano',
    opis: 'Najmniejsza i najtańsza wersja GPT-5 – krótko myśli, do prostych zadań.',
    mocne: ['krótkie odpowiedzi', 'najniższy koszt', 'klasyfikacja'],
    kontekst: 'duży',
    cechy: ['szybki', 'rozumowanie'],
    poziom: 'nano',
    myslenie: 'reasoning_effort',
    en: {
      opis: 'The smallest and cheapest GPT-5 – thinks briefly, for simple tasks.',
      mocne: ['short answers', 'lowest cost', 'classification'],
      kontekst: 'large',
    },
  },
  {
    klucz: 'gpt-nano',
    dopasuj: ['gpt-4.1-nano'],
    nazwa: 'GPT nano',
    opis: 'Najmniejsza i najtańsza wersja – do bardzo prostych zadań.',
    mocne: ['krótkie odpowiedzi', 'najniższy koszt', 'klasyfikacja'],
    kontekst: 'duży',
    cechy: ['szybki'],
    poziom: 'nano',
    en: {
      opis: 'Smallest and cheapest version – for very simple tasks.',
      mocne: ['short answers', 'lowest cost', 'classification'],
      kontekst: 'large',
    },
  },
  {
    klucz: 'gpt5-mini',
    dopasuj: ['gpt-5-mini'],
    nazwa: 'GPT-5 mini',
    opis: 'Tańszy GPT-5 – myśli przed odpowiedzią, widzi obrazy, szybszy od pełnego.',
    mocne: ['szybkie odpowiedzi', 'niski koszt', 'kod', 'analiza obrazów'],
    kontekst: 'duży',
    cechy: ['szybki', 'wizja', 'rozumowanie', 'narzędzia', 'kod'],
    poziom: 'mini',
    myslenie: 'reasoning_effort',
    en: {
      opis: 'A cheaper GPT-5 – thinks before it answers, sees images, faster than the full one.',
      mocne: ['quick answers', 'low cost', 'code', 'image analysis'],
      kontekst: 'large',
    },
  },
  {
    klucz: 'gpt-mini',
    dopasuj: ['gpt-4o-mini', 'gpt-4.1-mini'],
    nazwa: 'GPT mini',
    opis: 'Tania i szybka wersja – do prostych zadań i dużej liczby zapytań.',
    mocne: ['szybkie odpowiedzi', 'niski koszt', 'proste przetwarzanie tekstu'],
    kontekst: 'duży',
    cechy: ['szybki', 'wizja', 'narzędzia'],
    poziom: 'mini',
    en: {
      opis: 'Cheap, fast version – for simple tasks and many requests.',
      mocne: ['quick answers', 'low cost', 'simple text processing'],
      kontekst: 'large',
    },
  },
  {
    /* GPT-5 i nowsze myślą przed odpowiedzią – bez tej cechy wyglądały jak
       gpt-4o (zespół IT, runda 5). */
    dopasuj: ['gpt-5', 'gpt-6'],
    nazwa: 'GPT-5 (rozumujący)',
    opis: 'Flagowy model OpenAI – myśli przed odpowiedzią; mocny w kodzie, obrazach i rozmowie.',
    mocne: ['kod', 'analiza obrazów', 'trudniejsze pytania', 'wywoływanie narzędzi'],
    kontekst: 'duży',
    cechy: ['wizja', 'rozumowanie', 'narzędzia', 'polski', 'kod'],
    poziom: 'pelny',
    myslenie: 'reasoning_effort',
    en: {
      nazwa: 'GPT-5 (reasoning)',
      opis: 'OpenAI flagship – thinks before it answers; strong at code, images and conversation.',
      mocne: ['code', 'image analysis', 'harder questions', 'tool calling'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['gpt-4o', 'gpt-4.1'],
    nazwa: 'GPT (pełny)',
    opis: 'Uniwersalny model OpenAI – mocny w kodzie, obrazach i rozmowie.',
    mocne: ['kod', 'analiza obrazów', 'pisanie', 'wywoływanie narzędzi'],
    kontekst: 'duży',
    cechy: ['wizja', 'narzędzia', 'polski', 'kod'],
    poziom: 'pelny',
    en: {
      nazwa: 'GPT (full)',
      opis: 'General-purpose OpenAI model – strong at code, images and conversation.',
      mocne: ['code', 'image analysis', 'writing', 'tool calling'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['gpt-image', 'dall-e'],
    nazwa: 'Model obrazów OpenAI',
    opis: 'Generowanie grafiki – używany przez Studio, nie przez czat.',
    mocne: ['grafiki', 'storyboard', 'edycja maską'],
    kontekst: '–',
    cechy: [],
    uwaga: 'Nie ustawiaj go jako modelu rozmowy – służy Studiu.',
    en: {
      nazwa: 'OpenAI image model',
      opis: 'Image generation – used by Studio, not by the chat.',
      mocne: ['images', 'storyboard', 'mask editing'],
      kontekst: '–',
      uwaga: 'Don\'t set it as the conversation model – it serves Studio.',
    },
  },
  /* Seria o: o1, o3 i o4-mini czytają obrazy, o1-mini i o3-mini – nie
     (dokumentacja OpenAI, z pamięci). Stąd osobny wpis przed ogólnym. */
  {
    dopasuj: ['o3-mini', 'o1-mini'],
    nazwa: 'OpenAI o-mini (rozumowanie, sam tekst)',
    opis: 'Mniejszy model rozumujący – myśli przed odpowiedzią, obrazów nie czyta.',
    mocne: ['matematyka', 'logika', 'kod'],
    kontekst: 'duży',
    cechy: ['rozumowanie', 'kod'],
    poziom: 'mini',
    myslenie: 'reasoning_effort',
    uwaga: 'Zdjęć nie widzi – do nich weź o3, o4-mini albo GPT-5.',
    en: {
      nazwa: 'OpenAI o-mini (reasoning, text only)',
      opis: 'A smaller reasoning model – thinks before it answers, cannot read images.',
      mocne: ['maths', 'logic', 'code'],
      kontekst: 'large',
      uwaga: 'It cannot see photos – use o3, o4-mini or GPT-5 for them.',
    },
  },
  {
    dopasuj: ['o4-mini', 'o3', 'o1'],
    nazwa: 'OpenAI o-series (rozumowanie)',
    opis: 'Model rozumujący – myśli dłużej, zanim odpowie; czyta też obrazy.',
    mocne: ['matematyka', 'logika', 'trudne debugowanie', 'analiza obrazów'],
    kontekst: 'duży',
    cechy: ['wizja', 'rozumowanie', 'kod'],
    poziom: 'flagowy',
    myslenie: 'reasoning_effort',
    uwaga: 'Wolniejszy i droższy – nie do zwykłej rozmowy.',
    en: {
      nazwa: 'OpenAI o-series (reasoning)',
      opis: 'Reasoning model – thinks longer before it answers; also reads images.',
      mocne: ['maths', 'logic', 'hard debugging', 'image analysis'],
      kontekst: 'large',
      uwaga: 'Slower and more expensive – not for everyday conversation.',
    },
  },
  // ---- Anthropic ----
  /* Fable lądował w „Pozostałe” bez opisu (zespół IT, runda 5). */
  {
    dopasuj: ['claude-fable'],
    nazwa: 'Claude Fable',
    opis: 'Duży model Anthropic – do najbardziej złożonych, długich zadań.',
    mocne: ['złożone analizy', 'długie dokumenty', 'pisanie', 'kod'],
    kontekst: 'bardzo duży',
    cechy: ['wizja', 'rozumowanie', 'narzędzia', 'polski', 'kod'],
    poziom: 'flagowy',
    en: {
      opis: 'Large Anthropic model – for the most complex, long tasks.',
      mocne: ['complex analysis', 'long documents', 'writing', 'code'],
      kontekst: 'very large',
    },
  },
  {
    dopasuj: ['claude-opus'],
    nazwa: 'Claude Opus',
    opis: 'Bardzo mocny Claude – do długich, złożonych zadań.',
    mocne: ['analiza długich dokumentów', 'refaktoryzacja kodu', 'pisanie'],
    kontekst: 'bardzo duży',
    cechy: ['wizja', 'rozumowanie', 'narzędzia', 'polski', 'kod'],
    poziom: 'flagowy',
    en: {
      opis: 'A very capable Claude – for long, complex tasks.',
      mocne: ['long-document analysis', 'code refactoring', 'writing'],
      kontekst: 'very large',
    },
  },
  {
    dopasuj: ['claude-sonnet'],
    nazwa: 'Claude Sonnet',
    opis: 'Zrównoważony Claude – szybki, a nadal bardzo mocny.',
    mocne: ['codzienna praca', 'kod', 'długi kontekst'],
    kontekst: 'bardzo duży',
    cechy: ['wizja', 'rozumowanie', 'narzędzia', 'polski', 'kod'],
    poziom: 'pelny',
    en: {
      opis: 'Balanced Claude – fast and still very capable.',
      mocne: ['everyday work', 'code', 'long context'],
      kontekst: 'very large',
    },
  },
  {
    dopasuj: ['claude-haiku'],
    nazwa: 'Claude Haiku',
    opis: 'Najszybszy Claude – do zadań, gdzie liczy się czas odpowiedzi.',
    mocne: ['szybkie odpowiedzi', 'klasyfikacja', 'krótkie streszczenia'],
    kontekst: 'duży',
    cechy: ['szybki', 'wizja', 'narzędzia'],
    poziom: 'mini',
    en: {
      opis: 'The fastest Claude – for tasks where response time matters.',
      mocne: ['quick answers', 'classification', 'short summaries'],
      kontekst: 'large',
    },
  },

  // ---- lokalne (nazwy z Ollamy: „rodzina:rozmiar") ----
  /* Nazwy z Ollamy („llama3.2:3b", „qwen3:4b") katalog znał słabo, więc każdy
     mały model dostawał pełny prompt z narzędziami – 3,3–3,8 tys. tokenów przy
     oknie 4096 – i wypisywał znaczniki na ekran zamiast ich używać. */
  {
    dopasuj: ['llama3.2:1b', 'llama3.2:3b', 'qwen2.5:0.5b', 'qwen2.5:1.5b', 'qwen2.5:3b',
      'gemma3:1b', 'gemma3:270m', 'phi4-mini', 'smollm'],
    nazwa: 'Mały model lokalny (do 4B)',
    opis: 'Mały model na Twojej karcie – szybki, do krótkiej rozmowy bez narzędzi.',
    mocne: ['szybkie odpowiedzi', 'prywatność', 'praca bez internetu'],
    kontekst: 'mały',
    cechy: ['szybki'],
    poziom: 'nano',
    vramGb: 3,
    uwaga: 'Narzędzi (wyszukiwanie, plan, archiwum) nie umie – Cosmos ich mu nie opisuje. Po polsku słaby.',
    en: {
      nazwa: 'Small local model (up to 4B)',
      opis: 'A small model on your GPU – fast, for short chats without tools.',
      mocne: ['quick answers', 'privacy', 'works offline'],
      kontekst: 'small',
      uwaga: 'It cannot use tools (search, plan, archive), so Cosmos does not describe them to it. Weak in Polish.',
    },
  },
  {
    dopasuj: ['qwen3:0.6b', 'qwen3:1.7b', 'qwen3:4b'],
    nazwa: 'Qwen3 mały (do 4B)',
    opis: 'Mały Qwen3 z trybem myślenia – rozsądny kompromis na słabszej karcie.',
    mocne: ['krótkie rozumowanie', 'proste zadania', 'praca bez internetu'],
    kontekst: 'średni',
    cechy: ['szybki', 'rozumowanie'],
    poziom: 'nano',
    myslenie: 'no_think',
    vramGb: { '0.6b': 1, '1.7b': 2, '4b': 3.5 },
    uwaga: 'Dostaje narzędzia w krótkiej wersji. Myślenie zjada limit odpowiedzi – daj co najmniej 1500 tokenów.',
    en: {
      nazwa: 'Small Qwen3 (up to 4B)',
      opis: 'A small Qwen3 with a thinking mode – a sensible compromise on a weaker GPU.',
      mocne: ['short reasoning', 'simple tasks', 'works offline'],
      kontekst: 'medium',
      uwaga: 'Gets the short version of the tools. Thinking eats the reply budget – give it at least 1500 tokens.',
    },
  },
  /* Modele średnie z Ollamy, które zespół IT zmierzył na RTX (runda 9). Rozmiary
     w vramGb to Q4 z listy Ollamy, z pamięci – rząd wielkości, nie obietnica. */
  {
    dopasuj: ['qwen3:8b', 'qwen3:14b', 'qwen3:30b', 'qwen3:32b', 'qwen3-8b', 'qwen3-14b', 'qwen3-30b', 'qwen3-32b'],
    nazwa: 'Qwen3 (8B–32B)',
    opis: 'Qwen3 z przełączanym myśleniem – solidny model ogólny na domową kartę.',
    mocne: ['rozumowanie', 'wywoływanie narzędzi', 'praca bez internetu'],
    kontekst: 'duży',
    cechy: ['rozumowanie', 'narzędzia'],
    poziom: 'mini',
    myslenie: 'no_think',
    vramGb: { '8b': 6, '14b': 10, '30b': 19, '32b': 20 },
    uwaga: 'Myślenie zjada limit odpowiedzi – daj co najmniej 1500 tokenów albo je wyłącz.',
    en: {
      nazwa: 'Qwen3 (8B–32B)',
      opis: 'Qwen3 with switchable thinking – a solid general model for a home GPU.',
      mocne: ['reasoning', 'tool calling', 'works offline'],
      kontekst: 'large',
      uwaga: 'Thinking eats the reply budget – give it at least 1500 tokens or switch it off.',
    },
  },
  {
    dopasuj: ['qwen2.5-coder', 'qwen-2.5-coder'],
    nazwa: 'Qwen2.5 Coder',
    opis: 'Model do kodu – pisze, poprawia i tłumaczy programy, bez myślenia na głos.',
    mocne: ['pisanie kodu', 'poprawki', 'wyjaśnianie błędów'],
    kontekst: 'duży',
    cechy: ['kod'],
    poziom: 'mini',
    vramGb: { '1.5b': 1.5, '3b': 2.5, '7b': 5, '14b': 10, '32b': 20 },
    uwaga: 'Do rozmowy po polsku weź model ogólny – ten jest od kodu.',
    en: {
      opis: 'A code model – writes, fixes and explains programs, without thinking out loud.',
      mocne: ['writing code', 'fixes', 'explaining errors'],
      kontekst: 'large',
      uwaga: 'For conversation in Polish take a general model – this one is for code.',
    },
  },
  {
    dopasuj: ['mistral-nemo'],
    nazwa: 'Mistral Nemo 12B',
    opis: 'Model ogólny Mistrala z NVIDIĄ – długi kontekst, sam tekst.',
    mocne: ['rozmowa', 'streszczenia', 'wywoływanie narzędzi'],
    kontekst: 'duży',
    cechy: ['narzędzia'],
    poziom: 'mini',
    vramGb: 8,
    uwaga: 'Zdjęć nie widzi.',
    en: {
      opis: 'A general Mistral model made with NVIDIA – long context, text only.',
      mocne: ['conversation', 'summaries', 'tool calling'],
      kontekst: 'large',
      uwaga: 'It cannot see photos.',
    },
  },
  {
    dopasuj: ['phi4', 'phi-4'],
    nazwa: 'Phi-4 14B',
    opis: 'Model Microsoftu mocny w matematyce, logice i kodzie jak na swój rozmiar.',
    mocne: ['matematyka', 'logika', 'kod'],
    kontekst: 'średni',
    cechy: ['rozumowanie', 'kod'],
    poziom: 'mini',
    vramGb: 10,
    en: {
      opis: 'A Microsoft model strong at maths, logic and code for its size.',
      mocne: ['maths', 'logic', 'code'],
      kontekst: 'medium',
    },
  },
  {
    dopasuj: ['deepseek-r1'],
    nazwa: 'DeepSeek R1',
    opis: 'Model rozumujący – zawsze myśli przed odpowiedzią, tego nie da się wyłączyć.',
    mocne: ['matematyka', 'logika', 'rozumowanie krok po kroku'],
    kontekst: 'duży',
    cechy: ['rozumowanie'],
    poziom: 'pelny',
    myslenie: 'zawsze',
    vramGb: { '1.5b': 1.5, '7b': 5, '8b': 5.5, '14b': 10, '32b': 20, '70b': 43 },
    uwaga: 'Wolny: najpierw długo myśli. Myślenie zjada limit odpowiedzi – daj co najmniej 2000 tokenów.',
    en: {
      opis: 'A reasoning model – always thinks before it answers; this cannot be switched off.',
      mocne: ['maths', 'logic', 'step-by-step reasoning'],
      kontekst: 'large',
      uwaga: 'Slow: it thinks for a long time first. Thinking eats the reply budget – give it at least 2000 tokens.',
    },
  },
  /* Gemma 3 od 4B widzi obrazy i dobrze pisze po polsku – w ogólnym wpisie
     „Lokalny model wizyjny” traciła drugą z tych cech (zespół IT, runda 9).
     Małe (1B, 270M) łapie wcześniej wpis „Mały model lokalny”. */
  {
    dopasuj: ['gemma3', 'gemma-3'],
    nazwa: 'Gemma 3',
    opis: 'Model Google – widzi obrazy i dobrze pisze po polsku.',
    mocne: ['opis zdjęć', 'pisanie po polsku', 'praca bez internetu'],
    kontekst: 'duży',
    cechy: ['wizja', 'polski'],
    poziom: 'mini',
    vramGb: { '4b': 3.5, '12b': 8, '27b': 17 },
    en: {
      opis: 'A Google model – sees images and writes Polish well.',
      mocne: ['describing photos', 'writing in Polish', 'works offline'],
      kontekst: 'large',
    },
  },
  {
    dopasuj: ['llama3.2-vision', 'qwen2.5vl', 'qwen2.5-vl', 'minicpm-v', 'llava', 'qwen2-vl', '-vl'],
    nazwa: 'Lokalny model wizyjny',
    // Opis prawdziwy TYLKO na silniku lokalnym (patrz modelInfo).
    tylkoLokalny: true,
    opis: 'Rozpoznaje obrazy na Twoim GPU – bez wysyłania zdjęć do chmury.',
    mocne: ['prywatna analiza zdjęć', 'praca offline'],
    kontekst: 'zależny od modelu',
    cechy: ['wizja'],
    en: {
      nazwa: 'Local vision model',
      opis: 'Recognises images on your GPU – no photos sent to the cloud.',
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
  { frag: ['coder', 'codestral', 'codellama', 'devstral'], cecha: 'kod' },
];

const CECHA_OPIS = {
  // `ik` = klasa ikony liniowej (style.css, `.ik-…`) – zamiast emoji, jak w całej aplikacji.
  wizja: { ik: 'ik-oko', pl: 'widzi obrazy', en: 'sees images' },
  rozumowanie: { ik: 'ik-mysl', pl: 'rozumowanie', en: 'reasoning' },
  narzędzia: { ik: 'ik-klucz', pl: 'narzędzia', en: 'tools' },
  szybki: { ik: 'ik-blyskawica', pl: 'szybki', en: 'fast' },
  polski: { ik: 'ik-dymek', pl: 'dobra polszczyzna', en: 'strong Polish' },
  kod: { ik: 'ik-dokument', pl: 'kod', en: 'code' },
};

/* Język interfejsu. `getLang` daje i18n.js (ładowany wcześniej); w Node
   (testy wołają modelInfo przez require) go nie ma – wtedy polski. */
function jezykInterfejsu() {
  return typeof getLang === 'function' ? getLang() : 'pl';
}

/** Znajdź opis modelu po jego identyfikatorze. Zwraca null, gdy nic nie pasuje.
    Pola tekstowe w języku interfejsu (patrz `en` w nagłówku pliku). */
/* Warianty nazwy do dopasowania. Ollama pisze „rodzina:rozmiar" i bez
   myślnika przed numerem wersji („llama3.1:8b", „gpt-oss:20b"), katalog –
   jak NVIDIA i Hugging Face („llama-3.1-8b", „gpt-oss-20b"). Bez tego
   gpt-oss:20b trafiał we wpis 120B, a llama3.1:8b był dla katalogu obcy. */
function wariantyNazwy(id) {
  const k0 = String(id).toLowerCase();
  const k1 = k0.replace(/:/g, '-');
  const k2 = k1.replace(/([a-z])(\d)/g, '$1-$2');
  return [...new Set([k0, k1, k2])];
}

/* Poziom z nazwy modelu OpenAI: „gpt-5.5-mini” to mini, „gpt-5.4-nano” to nano,
   „o4-mini” to mini. Sprawdzany PRZED dopasowaniem fragmentu – inaczej
   „gpt-5.5-mini” trafiało we wpis „gpt-5” (flagowiec, zespół IT runda 9).
   Zwraca {poziom, klucz} – `klucz` wskazuje wpis katalogu dla rodziny gpt;
   dla serii o sam poziom (wpis wybiera fragment). */
function poziomOpenAI(id) {
  const k = String(id || '').toLowerCase();
  const gpt = k.match(/(?:^|\/)gpt-(\d+)[\w.]*?-(mini|nano)(?![a-z])/);
  if (gpt) {
    const poziom = gpt[2];
    return { poziom, klucz: `${Number(gpt[1]) >= 5 ? 'gpt5' : 'gpt'}-${poziom}` };
  }
  const o = k.match(/(?:^|\/)o\d+-(mini|nano)(?![a-z])/);
  return o ? { poziom: o[1], klucz: null } : null;
}

/* VRAM wpisu dla konkretnego rozmiaru: „qwen3:14b” → 10. Mapa rozmiarów
   szuka „14b” w nazwie (po dwukropku, myślniku albo ukośniku); liczba to
   jeden rozmiar dla całego wpisu; brak rozmiaru w nazwie → null. */
function vramDla(vram, id) {
  if (typeof vram === 'number') return vram;
  if (!vram || typeof vram !== 'object') return null;
  const rozmiary = String(id || '').toLowerCase().match(/(?:^|[:\-_/])\d+(?:\.\d+)?[bm](?![a-z0-9])/g) || [];
  for (const r of rozmiary) {
    const w = vram[r.replace(/^[:\-_/]/, '')];
    if (typeof w === 'number') return w;
  }
  return null;
}

/* `silnik` (cloud / local / openai / claude), gdy wiadomo, gdzie model działa.
   Chmurowy „…-vl” dostawał opis „Lokalny model wizyjny – bez wysyłania zdjęć
   do chmury”: fałszywa obietnica prywatności (agencja, runda 5). */
function modelInfo(id, silnik) {
  if (!id) return null;
  const key = String(id).toLowerCase();
  const warianty = wariantyNazwy(id);
  const zNazwy = poziomOpenAI(id);
  const wymuszony = zNazwy && zNazwy.klucz ? MODEL_CATALOG.find((e) => e.klucz === zNazwy.klucz) : null;
  for (const entry of (wymuszony ? [wymuszony] : MODEL_CATALOG)) {
    if (entry === wymuszony || entry.dopasuj.some((frag) => warianty.some((w) => w.includes(frag)))) {
      if (entry.tylkoLokalny && silnik && silnik !== 'local') {
        const en = jezykInterfejsu() === 'en';
        return {
          nazwa: en ? 'Vision model' : 'Model wizyjny',
          opis: en ? 'Recognises images. Runs at the provider, so photos go to its cloud.'
            : 'Rozpoznaje obrazy. Działa u dostawcy, więc zdjęcia trafiają do jego chmury.',
          mocne: [], kontekst: null, cechy: ['wizja'], poziom: null, myslenie: null, vramGb: null, zgadywane: false,
        };
      }
      const { en, tylkoLokalny, klucz, ...wpis } = entry;
      return {
        ...wpis,
        ...(jezykInterfejsu() === 'en' && en ? en : {}),
        poziom: (zNazwy && zNazwy.poziom) || entry.poziom || null,
        myslenie: entry.myslenie || null,
        vramGb: vramDla(entry.vramGb, id),
        zgadywane: false,
      };
    }
  }
  // Nieznany model – wyczytaj, co się da, z samej nazwy i powiedz, że to domysł.
  const cechy = HINTS.filter((h) => h.frag.some((f) => key.includes(f))).map((h) => h.cecha);
  return cechy.length ? { nazwa: id, opis: null, mocne: [], kontekst: null, cechy,
    poziom: zNazwy ? zNazwy.poziom : null, myslenie: null, vramGb: null, zgadywane: true } : null;
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
 * instrukcje do wyszukiwania, grafik, obrazów, akcji, procedur i urządzeń –
 * których nie umie użyć. To go spowalnia i rozprasza.
 *
 * Trzy poziomy:
 *   'pelny'   – model ogarnia protokoły znaczników; pełne opisy z niuansami.
 *   'zwiezly' – te same narzędzia, ale krótkim tekstem. Mniej kontekstu na
 *               instrukcje, więcej na rozmowę.
 *   'rozmowa' – same fakty (kim jest, data, miejsce) i zero narzędzi. Dla
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

/* Modele, które w ogóle nie mają końcówki /chat/completions – embeddingi,
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
  /* Z listy OpenAI: obrazy, mowa, moderacja, stare modele uzupełniania.
     „Pobierz listę” podsuwała do czatu dall-e-3 i whisper-1 (agencja, runda 5). */
  'dall-e', 'gpt-image', 'whisper', 'tts-', '-tts', 'transcribe', 'moderation',
  'davinci', 'babbage', 'text-embedding', 'sora', 'realtime', 'audio-preview',
  /* Tylko przez Responses API – w czacie zawsze 404 (zespół IT, runda 5). */
  'gpt-5-pro', 'o1-pro', 'o3-pro', 'codex',
  /* Też nie do rozmowy (zespół IT, runda 6): nowsze -pro, głębokie badania,
     sterowanie komputerem, stare modele uzupełniania, embeddingi z Ollamy. */
  'deep-research', 'computer-use', 'gpt-3.5-turbo-instruct', 'all-minilm', 'multilingual-e5',
  'paraphrase-', 'sentence-transformers/', 'mxbai-embed', 'snowflake-arctic-embed',
];

/** Czy to model o innym przeznaczeniu niż rozmowa? */
function modelNotForChat(id) {
  const key = String(id || '').toLowerCase();
  // gpt-5.x-pro działa tylko przez Responses API – ale deepseek-v4-pro to zwykły czat.
  return NIE_DO_ROZMOWY.some((frag) => key.includes(frag)) || /^gpt-5[\w.-]*-pro\b/.test(key);
}

/* Osobna kategoria: modele, które MAJĄ /chat/completions i odpowiadają
   poprawnie, ale rozmówcami nie są. Klasyfikator bezpieczeństwa odsyła
   „safe" w jedną dziesiątą sekundy i przez to wygrywa każdy wyścig na
   szybkość – w rankingu „najlepsze do rozmowy" wyprzedzał flagowca 550B.
   Kto by posłuchał takiej podpowiedzi, ustawiłby sobie jako główny model
   coś, co umie odpowiedzieć wyłącznie „bezpieczne / niebezpieczne". */
const NIE_ROZMOWCA = [
  'nemoguard', 'safety-guard', 'content-safety', 'topic-control',
  'llama-guard', 'riva-translate', 'ising-calibration',
  // klasyfikatory bezpieczeństwa z Ollamy – odpowiedzą, ale tylko „bezpieczne / nie"
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
  window.POZIOMY = POZIOMY;
}
if (typeof module !== 'undefined') {
  module.exports = {
    MODEL_CATALOG, modelInfo, modelSeesImages,
    modelNotForChat, modelNotAChatPartner, modelToolLevel, CECHA_OPIS,
    MYSLENIE, POZIOMY, poziomOpenAI, vramDla,
  };
}

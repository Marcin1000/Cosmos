/* ============================================================
   Wywołania modelu bez strumienia

   Streszczenia, dopracowanie promptu, storyboard — wszędzie tam, gdzie
   potrzebna jest jedna gotowa odpowiedź, a nie tekst lecący po kawałku.

   Osobny moduł, bo tego używa i Studio, i czat, i nauka. Siedziało to
   wcześniej w środku Studia tylko dlatego, że tam powstało jako pierwsze.
   ============================================================ */

const { ENDPOINTS, pickEndpoint, authHeaders } = require('./rdzen.js');
const { modelInfo } = require('../public/models.js');

// Niestreamowane wywołanie modelu (Storyboard, streszczenia itp.)
/** Odczytaj odpowiedź modelu, nawet gdy nie jest czystym JSON-em.
 *
 * `stream: false` bywa zignorowane: bramka potrafi oddać strumień zdarzeń
 * (`data: {…}` w wielu liniach) albo kilka obiektów JSON jeden po drugim.
 * `JSON.parse` mówi wtedy „Unexpected non-whitespace character after JSON at
 * position 4” — komunikat, który trafiał wprost do użytkownika i nie mówił nic
 * o prawdziwej przyczynie. Tutaj składamy taką odpowiedź w jedną całość,
 * a gdy się nie da — rzucamy błąd z kawałkiem tego, co faktycznie przyszło.
 */
async function parseModelResponse(r) {
  const body = await r.text();
  try {
    return JSON.parse(body);
  } catch { /* niżej próby ratunkowe */ }

  // 1. strumień zdarzeń mimo stream:false — sklej treść z kolejnych fragmentów
  if (/^\s*data:/m.test(body)) {
    let content = '';
    let reasoning = '';
    let finish = null;
    for (const line of body.split('\n')) {
      const m = line.match(/^\s*data:\s*(.+)$/);
      if (!m || m[1].trim() === '[DONE]') continue;
      try {
        const j = JSON.parse(m[1]);
        const c = j.choices?.[0] || {};
        content += c.delta?.content ?? c.message?.content ?? '';
        reasoning += c.delta?.reasoning_content ?? c.message?.reasoning_content ?? '';
        if (c.finish_reason) finish = c.finish_reason;
      } catch { /* niepełny fragment */ }
    }
    if (content || reasoning) {
      return { choices: [{ message: { content, reasoning_content: reasoning }, finish_reason: finish }] };
    }
  }

  // 2. kilka obiektów JSON pod rząd — weź ostatni kompletny
  const objects = [];
  let depth = 0; let start = -1; let inStr = false; let esc = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) { objects.push(body.slice(start, i + 1)); start = -1; }
    }
  }
  for (let i = objects.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(objects[i]);
      if (j.choices || j.error) return j;
    } catch { /* próbuj wcześniejszy */ }
  }

  throw new Error(`Model oddał odpowiedź, której nie da się odczytać (HTTP ${r.status}). `
    + `Początek: ${body.trim().slice(0, 200) || '(pusto)'}`);
}

/* ============ ŻĄDANIE DO MODELU — parametry, które dostawca przyjmie ============
   Każdy dostawca odrzuca co innego i mówi o tym po jednym parametrze naraz.
   Modele rozumujące OpenAI (o1, o3, o4, gpt-5) chcą `max_completion_tokens`
   zamiast `max_tokens` i nie przyjmują własnej temperatury; część modeli
   Claude'a odrzuca `temperature` razem z `top_p`. Dawniej była jedna
   poprawka i jedna ponowna próba — pierwsza odmowa dotyczyła `max_tokens`,
   druga `temperature`, i zakładka OpenAI z gpt-5 nie odpowiadała NIGDY.

   Teraz: znane reguły stosujemy od razu, a każdą odmowę dostawcy
   zapamiętujemy dla pary (adres, model) — drugie pytanie idzie już poprawne,
   bez straconego żądania. */
const POPRAWKI = new Map();          // `${baseUrl}|${model}` → { usun: Set, naCompletion: bool }
const WYCISZANE = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'stream_options'];

function kluczModelu(ep, model) { return `${ep.baseUrl}|${model}`; }

function parametryDla(ep, body) {
  const b = { ...body };
  const model = String(b.model || '');
  const openAiRozumujacy = /^(o\d|gpt-5)/i.test(model.replace(/^openai\//, ''));
  const znane = POPRAWKI.get(kluczModelu(ep, model));
  if (openAiRozumujacy || (znane && znane.naCompletion)) {
    if (b.max_tokens !== undefined) { b.max_completion_tokens = b.max_tokens; delete b.max_tokens; }
  }
  if (openAiRozumujacy) { delete b.temperature; delete b.top_p; }
  /* Modele rozumujące (gpt-5, o*, Claude z myśleniem) liczą myślenie do
     limitu odpowiedzi. Przy 2048 tokenach potrafiły wydać wszystko na
     myślenie i oddać pustą treść. Płaci się za faktycznie zużyte tokeny,
     więc wyższy sufit nie podnosi kosztu zwykłej odpowiedzi. */
  if (openAiRozumujacy || ep.anthropic || /^claude/i.test(model)) {
    for (const k of ['max_tokens', 'max_completion_tokens']) {
      if (typeof b[k] === 'number' && b[k] < 16000) b[k] = 16000;
    }
  }
  if (znane) for (const k of znane.usun) delete b[k];
  return b;
}

/** Z odmowy 400 wyczytaj, co poprawić. Zwraca `null`, gdy nie ma czego. */
function poprawkaZOdmowy(tresc, b) {
  const t = String(tresc || '');
  const zmiana = { usun: [], naCompletion: false };
  if (b.max_tokens !== undefined && /max_completion_tokens/i.test(t)) zmiana.naCompletion = true;
  for (const k of WYCISZANE) {
    if (b[k] !== undefined && new RegExp(k, 'i').test(t)) zmiana.usun.push(k);
  }
  // „temperature and top_p cannot both be specified" — wystarczy zdjąć top_p,
  // ale zdjęcie obu jest bezpieczne i nie wymaga kolejnej próby.
  return zmiana.naCompletion || zmiana.usun.length ? zmiana : null;
}

const pauzaZ = (ms, signal) => new Promise((ok, zle) => {
  const t = setTimeout(ok, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); zle(signal.reason || new Error('przerwane')); }, { once: true });
});

/**
 * Wyślij `chat/completions` z parametrami dopasowanymi do dostawcy.
 * Do trzech poprawek parametrów (po odmowie 400) i do dwóch ponowień przy
 * 429/503 — z nagłówkiem `Retry-After`, ale nie dłużej niż 8 s, bo po drugiej
 * stronie ktoś patrzy na migający kursor.
 */
async function zapytajModel(ep, body, { signal, ponowienia = 2 } = {}) {
  let b = parametryDla(ep, body);
  let poprawek = 0;
  let ponowien = 0;
  for (;;) {
    const r = await fetch(`${ep.baseUrl}/chat/completions`, {
      method: 'POST', headers: authHeaders(ep), body: JSON.stringify(b), signal,
    });
    if (r.status === 400 && poprawek < 3) {
      const tresc = await r.clone().text().catch(() => '');
      const zmiana = poprawkaZOdmowy(tresc, b);
      if (zmiana) {
        poprawek++;
        const klucz = kluczModelu(ep, b.model);
        const znane = POPRAWKI.get(klucz) || { usun: new Set(), naCompletion: false };
        zmiana.usun.forEach((k) => znane.usun.add(k));
        znane.naCompletion = znane.naCompletion || zmiana.naCompletion;
        POPRAWKI.set(klucz, znane);
        b = parametryDla(ep, body);
        continue;
      }
    }
    if ((r.status === 429 || r.status === 503) && ponowien < ponowienia) {
      const naglowek = Number(r.headers.get('retry-after'));
      const ms = Math.min(8000, Number.isFinite(naglowek) && naglowek > 0 ? naglowek * 1000 : 1500 * (ponowien + 1));
      ponowien++;
      r.body?.cancel().catch(() => {});
      await pauzaZ(ms, signal);
      continue;
    }
    return r;
  }
}

async function llmComplete(messages, { endpoint = 'cloud', maxTokens = 1024, model: want, _ponowienie = false } = {}) {
  const ep = pickEndpoint(endpoint);
  // Model wybrany w Ustawieniach jest ważniejszy niż ten z .env — tak samo jak
  // w czacie. Bez tego funkcje pomocnicze (dopracowanie promptu, streszczenie)
  // strzelały do modelu, którego użytkownik nie wybrał, i przy nieaktualnym
  // wpisie w .env dostawały 404, choć sam czat działał bez zarzutu.
  const model = (typeof want === 'string' && want.trim()) || ep.model;
  if (!model) {
    throw new Error(`Nie ustawiono modelu dla „${ep.label}". Wybierz go w Ustawieniach `
      + 'albo uzupełnij .env na serwerze.');
  }
  if (!ep.apiKey && ep.baseUrl.includes('integrate.api.nvidia.com')) {
    throw new Error('Brak klucza API dla chmury NVIDIA.');
  }
  const r = await zapytajModel(ep, { model, messages, temperature: 0.7, max_tokens: maxTokens, stream: false },
    { signal: AbortSignal.timeout(120000) });
  let d;
  try {
    d = await parseModelResponse(r);
  } catch (err) {
    // Dopowiedz, DOKĄD poszło żądanie — bez tego „404 page not found" nie mówi,
    // czy winny jest adres, czy identyfikator modelu.
    throw new Error(`${err.message}  [${ep.label} · ${model}]`
      + (r.status === 404
        ? '\nTaki model nie istnieje pod tym adresem — sprawdź go w Ustawieniach → Pobierz listę.'
        : ''));
  }
  if (!r.ok) throw new Error(`${d.error?.message || d.error || `HTTP ${r.status}`}  [${ep.label} · ${model}]`);
  const msg = d.choices?.[0]?.message || {};
  const text = (msg.content || '').trim();
  if (text) return text;

  // Model rozumujący (Nemotron 3, gpt-oss, R1) potrafi zużyć cały budżet tokenów
  // na myślenie i zwrócić puste `content`. Bez tego streszczenia i dopracowanie
  // promptu po cichu zwracały pusty tekst — wyglądało to na zepsutą funkcję.
  /* Kiedyś oddawaliśmy wtedy tok myślenia — i dopracowanie promptu wstawiało
     do pola angielskie rozważania modelu. Rozumowanie to nie odpowiedź. */
  const why = d.choices?.[0]?.finish_reason;
  /* Przyczyną jest za mały budżet — więc go dajemy, raz. Czterokrotnie
     większy limit zwykle wystarcza, żeby po myśleniu padła odpowiedź; płaci
     się za zużyte tokeny, nie za sufit. */
  if (why === 'length' && !_ponowienie && (msg.reasoning_content || msg.reasoning)) {
    return llmComplete(messages, { endpoint, maxTokens: Math.min(16000, Math.max(4096, maxTokens * 4)), model: want, _ponowienie: true });
  }
  throw new Error(why === 'length'
    ? 'Model zużył cały budżet tokenów na myślenie i nie zdążył odpowiedzieć. '
      + 'Zwiększ „Maks. tokenów odpowiedzi” albo wybierz szybszy model.'
    : 'Model zwrócił pustą odpowiedź.');
}

/** Czy katalog WIE, że ten model nie czyta obrazów?
 *
 *  Ostrożnie z odpowiedzią „nie wiem": modele spoza katalogu przepuszczamy,
 *  bo lepiej pozwolić dostawcy odmówić, niż zablokować model, który widzi.
 *  Dawniej całość siedziała w `try/catch` zwracającym `false` — gdy zabrakło
 *  importu `modelInfo`, KAŻDY model wyglądał na widzący i zdjęcia leciały
 *  w próżnię. Cicho, bo wyjątek był połykany. Teraz błąd katalogu jest
 *  słyszalny w logu.
 */
function blindToImages(id) {
  try {
    const info = modelInfo(id);
    return Boolean(info && !info.zgadywane && !info.cechy.includes('wizja'));
  } catch (err) {
    console.error('Katalog modeli nie odpowiedział na pytanie o wzrok:', err.message);
    return false;
  }
}

module.exports = { parseModelResponse, llmComplete, blindToImages, zapytajModel, parametryDla };

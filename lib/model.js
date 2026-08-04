/* ============================================================
   Wywołania modelu bez strumienia

   Streszczenia, dopracowanie promptu, storyboard — wszędzie tam, gdzie
   potrzebna jest jedna gotowa odpowiedź, a nie tekst lecący po kawałku.

   Osobny moduł, bo tego używa i Studio, i czat, i nauka. Siedziało to
   wcześniej w środku Studia tylko dlatego, że tam powstało jako pierwsze.
   ============================================================ */

const { ENDPOINTS, pickEndpoint, authHeaders } = require('./rdzen.js');

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

async function llmComplete(messages, { endpoint = 'cloud', maxTokens = 1024, model: want } = {}) {
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
  const r = await fetch(`${ep.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(ep),
    body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(120000),
  });
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
  const reasoning = (msg.reasoning_content || msg.reasoning || '').trim();
  if (reasoning) return reasoning;

  const why = d.choices?.[0]?.finish_reason;
  throw new Error(why === 'length'
    ? 'Model zużył cały budżet tokenów na myślenie i nie zdążył odpowiedzieć. '
      + 'Zwiększ „Maks. tokenów odpowiedzi” albo wybierz szybszy model.'
    : 'Model zwrócił pustą odpowiedź.');
}

module.exports = { parseModelResponse, llmComplete };

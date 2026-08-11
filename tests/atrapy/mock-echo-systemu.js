/* Atrapa, która oddaje w treści odpowiedzi to, co dostała w wiadomościach
   systemowych. Dzięki temu test sprawdza, co model NAPRAWDĘ widzi, zamiast
   zgadywać po kodzie serwera — a właśnie tam siedziały luki: Cosmos nigdy
   nie podawał daty ani lokalizacji, więc „dziś" i „w okolicy" nic nie
   znaczyły. */
const http = require('http');

/* Port z otoczenia, bo tej atrapy potrzebują DWA środowiska naraz („kontekst"
   i „grafiki"). Na jednym, wpisanym na stałe porcie zestawy ubijały sobie
   nawzajem atrapę: sprzątanie portów przed startem środowiska zabija to, co
   na nim stoi, a drugie środowisko czekało potem 1,5 s na własną — i w tym
   oknie żądanie pierwszego wracało błędem połączenia zamiast treścią promptu.
   Objaw: `plan-zdjeciowy` padał raz na kilka przebiegów CAŁEJ baterii,
   a uruchomiony osobno przechodził zawsze. */
const PORT = Number(process.env.PORT) || 7116;

http.createServer((req, res) => {
  /* Udaje uśpiony komputer domowy: połączenie przyjęte, odpowiedzi brak.
     Adres nieistniejący nie nadaje się do tego testu — w kontenerze odbija
     się od proxy w 80 ms zamiast wisieć, więc niczego by nie dowodził. */
  if (req.url === '/health') return;             // celowo bez odpowiedzi

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'atrapa/echo' }] }));
  }
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    let systemowe = '';
    try {
      systemowe = (JSON.parse(b).messages || [])
        .filter((m) => m.role === 'system')
        .map((m) => (typeof m.content === 'string' ? m.content : ''))
        .join('\n---\n');
    } catch { systemowe = 'BŁĄD PARSOWANIA'; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    // Jednym kawałkiem — treść jest tu danymi, nie testem płynności.
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: systemowe } }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(PORT, () => console.log(`atrapa echa systemu na ${PORT}`));

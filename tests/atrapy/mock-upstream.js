// Atrapy endpointów OpenAI-compatible: 9099 = "chmura", 9098 = "lokalny GPU"
const http = require('node:http');

function makeMock(port, name) {
  http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ object: 'list', data: [
        { id: name + '/nemotron-3-test', object: 'model' },
        { id: name + '/nemotron-vl-test', object: 'model' },
      ]}));
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => body += c);
      req.on('end', () => {
        const parsed = JSON.parse(body);
        console.log(`MOCK[${name}]`, JSON.stringify(parsed.messages).slice(0, 6000));
        const flat = JSON.stringify(parsed.messages);
        const hasImage = flat.includes('image_url');
        const hasResults = parsed.messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('WYNIKI WYSZUKIWANIA'));
        const lastUser = [...parsed.messages].reverse().find(m => m.role === 'user');
        const lastText = typeof lastUser?.content === 'string' ? lastUser.content
          : (lastUser?.content?.find?.(p => p.type === 'text')?.text || '');
        if (parsed.stream === false) {
          let out;
          if (/reżyser|director|Scena:|Scene:/i.test(flat)) out = JSON.stringify(['wide establishing shot of a bear','close-up of the bear face','low angle tracking shot','sunset silhouette of the bear']);
          else out = 'OK.';
          res.writeHead(200,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({choices:[{message:{role:'assistant',content:out}}]}));
        }
        /* Kolejkowanie wiadomości da się sprawdzić tylko wtedy, gdy istnieje
           „w trakcie odpowiedzi". Atrapa domyślnie kończy w kilkadziesiąt
           milisekund — szybciej, niż test zdąży cokolwiek napisać. Słowo
           „powoli" w pytaniu rozciąga strumień na kilkanaście sekund. */
        const powoli = /powoli/i.test(lastText);
        let text;
        if (powoli) {
          text = ('Odpowiadam powoli, żeby dało się w tym czasie napisać kolejną wiadomość. '
            + 'Strumień leci token po tokenie i trwa na tyle długo, że kolejka ma co obsłużyć. ')
            .repeat(4);
        } else if (hasResults) {
          text = 'To **Samsung Galaxy S24** — 6.2" AMOLED 120 Hz, Exynos 2400, aparat 50 MP, ceny od ok. 3799 zł.\n\nŹródła: gsmarena.com, samsung.com.';
        } else if (/jaki to telefon/i.test(lastText)) {
          text = 'Rozpoznaję smartfon Samsunga — sprawdzę dokładny model.\n\n[SZUKAJ: Samsung Galaxy S24 specyfikacja cena]';
        } else if (/wygeneruj.*(grafik|obraz|logo)/i.test(lastText)) {
          text = 'Jasne, generuję!\n\n[OBRAZ: a majestic cosmic bear astronaut floating in a nebula, cinematic lighting]';
        } else if (/zapami[eę]taj|zapisz/i.test(lastText)) {
          text = 'Jasne.\n\n[AKCJA: zapamiętaj | Ulubiony obiektyw to 50mm f/1.8]';
        } else if (hasImage) {
          text = `Widzę w Twojej dłoni **telefon** — ciemny smartfon z wyspą aparatów. (model: ${parsed.model})`;
        } else if (/przykład kodu|kod/i.test(lastText)) {
          text = `Proszę, z ${name}:\n\n\`\`\`python\nprint("Cześć, Kosmos")\n\`\`\`\n`;
        } else {
          text = `Cześć z ${name}! Model: \`${parsed.model}\`.`;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const tokens = text.match(/.{1,8}/gs) || [];
        let i = 0;
        const timer = setInterval(() => {
          if (i >= tokens.length) {
            res.write('data: [DONE]\n\n'); res.end(); clearInterval(timer); return;
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: tokens[i] } }] })}\n\n`);
          i++;
        }, powoli ? 60 : 8);
      });
      return;
    }
    res.writeHead(404); res.end();
  }).listen(port, () => console.log(`mock ${name} on ${port}`));
}
makeMock(9099, 'cloud');
makeMock(9098, 'local');

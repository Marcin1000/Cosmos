// Atrapa modeli o różnej płynności — do sprawdzenia skryptu scripts/plynnosc.js.
// Każdy model ma inny czas do pierwszego znaku i inne tempo pisania.
const http = require('http');

const MODELE = {
  'szybki/blyskawiczny':  { pierwszy: 200,   naZnak: 8 },
  'sredni/przyzwoity':    { pierwszy: 900,   naZnak: 25 },
  'wolny/znosny':         { pierwszy: 3000,  naZnak: 55 },
  'zolw/meczacy':         { pierwszy: 7000,  naZnak: 120 },
  'zepsuty/bez-dostepu':  { blad: 404 },
};
const ODPOWIEDZ = 'Fotografia poklatkowa to seria zdjęć robionych w równych odstępach '
  + 'czasu, złożona potem w film pokazujący powolne zmiany w przyspieszeniu.';

http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ data: Object.keys(MODELE).map((id) => ({ id })) }));
  }
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', async () => {
    const cfg = MODELE[JSON.parse(b).model] || MODELE['sredni/przyzwoity'];
    if (cfg.blad) {
      res.writeHead(cfg.blad, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Not found for account.' } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    await new Promise((r) => setTimeout(r, cfg.pierwszy));
    for (const znak of ODPOWIEDZ) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: znak } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, cfg.naZnak / 10));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(7115, () => console.log('atrapa tempa na 7115'));

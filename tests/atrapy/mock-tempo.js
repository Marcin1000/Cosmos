// Atrapa modeli o różnej płynności — do sprawdzenia skryptu scripts/plynnosc.js.
// Każdy model ma inny czas do pierwszego znaku i inne tempo pisania.
const http = require('http');

const MODELE = {
  'szybki/blyskawiczny':  { pierwszy: 200,   naZnak: 8 },
  'sredni/przyzwoity':    { pierwszy: 900,   naZnak: 25 },
  'wolny/znosny':         { pierwszy: 3000,  naZnak: 55 },
  'zolw/meczacy':         { pierwszy: 7000,  naZnak: 120 },
  'zepsuty/bez-dostepu':  { blad: 404 },
  // Kapryśny: raz błyskawiczny, raz w ogóle. Tak zachowuje się darmowy
  // endpoint NVIDII i to właśnie mylnie wychodziło jako „znakomity".
  'kaprysny/raz-tak-raz-nie': { pierwszy: 200, naZnak: 8, padaCo: 2 },
  // Rozumujący: cały budżet w myślenie, treści zero. Dawniej: „pusta odpowiedź".
  'rozumujacy/samo-myslenie': { pierwszy: 400, naZnak: 10, tylkoMyslenie: true },
  // Myśli długo, POTEM odpowiada. „Pierwszy znak" po 0,3 s wygląda na
  // błyskawiczną odpowiedź, a to dopiero „…myślę" — treść przychodzi po 3 s.
  'rozumujacy/mysli-potem-mowi': { pierwszy: 300, naZnak: 8, myslenieMs: 3000 },
  // Rusza wcześnie, kończy późno — i odwrotnie. Ranking liczony po pierwszym
  // znaku stawiał „zwlekacza" nad „sprinterem", choć czekało się na niego
  // siedem razy dłużej.
  'zwlekacz/szybki-start-wolny-koniec': { pierwszy: 250, naZnak: 300 },
  'sprinter/pozny-start-szybki-koniec': { pierwszy: 500, naZnak: 8 },
  // Klasyfikator bezpieczeństwa: odsyła jedno słowo w mgnieniu oka. Wygrywał
  // każdy wyścig na szybkość i lądował na szczycie „najlepszych do rozmowy".
  'straznik/nemoguard-atrapa': { pierwszy: 100, naZnak: 2, odpowiedz: 'safe' },
};
const licznik = {};
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
    const id = JSON.parse(b).model;
    if (cfg.blad) {
      res.writeHead(cfg.blad, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Not found for account.' } }));
    }
    if (cfg.padaCo) {
      licznik[id] = (licznik[id] || 0) + 1;
      if (licznik[id] % cfg.padaCo === 0) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Przeciążenie — spróbuj później.' } }));
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    await new Promise((r) => setTimeout(r, cfg.pierwszy));
    if (cfg.myslenieMs) {
      const krokow = 10;
      for (let i = 0; i < krokow; i++) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'myślę… ' } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, cfg.myslenieMs / krokow));
      }
    }
    for (const znak of (cfg.odpowiedz || ODPOWIEDZ)) {
      const pole = cfg.tylkoMyslenie ? { reasoning_content: znak } : { content: znak };
      res.write(`data: ${JSON.stringify({ choices: [{ delta: pole }] })}\n\n`);
      await new Promise((r) => setTimeout(r, cfg.naZnak / 10));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
}).listen(7115, () => console.log('atrapa tempa na 7115'));

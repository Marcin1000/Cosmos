// Pierwsza wersja pomiaru kłamała: przy dwóch przebiegach na tym samym
// koncie wskazywała ZUPEŁNIE INNE modele jako najlepsze. Powody były trzy —
// przerywanie na pierwszym błędzie, ocena bez uwzględnienia niezawodności
// i „pusta odpowiedź" przy modelach rozumujących.
const { execFileSync } = require('child_process');
const path = require('path');
const { srodowisko } = require('../pomoc');

(async () => {
  const env = await srodowisko('tempo');
  const fail = [];
  let out = '';
  try {
    out = execFileSync('node', [path.join(__dirname, '..', '..', 'scripts', 'plynnosc.js'), 'cloud'], {
      env: { ...process.env, COSMOS_URL: env.adres, PLYNNOSC_PROBY: '3' },
      timeout: 180000,
    }).toString();
  } catch (e) { out = (e.stdout || '').toString(); fail.push('skrypt zakończył się błędem'); }

  const wiersz = (frag) => (out.split('\n').find((l) => l.includes(frag)) || '').trim();

  console.log('1. ' + wiersz('szybki/blyskawiczny'));
  if (!/✦/.test(wiersz('szybki/blyskawiczny'))) fail.push('szybki model nie dostał najwyższej oceny');

  const kapr = wiersz('kaprysny/raz-tak-raz-nie');
  console.log('2. ' + kapr);
  if (/✦/.test(kapr)) fail.push('kapryśny model wciąż uchodzi za znakomity');
  if (!/2\/3/.test(kapr)) fail.push('nie widać, że odpowiedział 2 z 3 razy');

  const roz = wiersz('rozumujacy/samo-myslenie');
  console.log('3. ' + roz);
  if (/pusta odpowiedź/.test(roz)) fail.push('model rozumujący nadal uznany za pustą odpowiedź');
  if (!/3\/3/.test(roz)) fail.push('model rozumujący nie zaliczył wszystkich prób');

  console.log('4. kolejność na liście najlepszych:');
  const lista = out.slice(out.indexOf('Najlepsze do rozmowy')).split('\n')
    .filter((l) => /^  [✦✓~✗] /.test(l)).map((l) => l.trim());
  lista.forEach((l) => console.log('   ' + l));
  if (lista.some((l) => l.includes('kaprysny'))) fail.push('kapryśny model trafił na listę najlepszych');

  console.log(`5. sekcja o modelach nierównych: ${/nie zawsze/.test(out) ? 'jest' : 'BRAK'}`);
  if (!/nie zawsze/.test(out)) fail.push('brak ostrzeżenia o modelach odpowiadających nierówno');

  // 6. model, który najpierw myśli, a potem mówi: „pierwszy znak" po 0,3 s
  //    wygląda na błyskawiczną odpowiedź, a to dopiero „…myślę".
  const mysli = wiersz('rozumujacy/mysli-potem-mowi');
  console.log('6. ' + mysli);
  if (!/🧠myśli/.test(mysli)) fail.push('nie rozróżnia myślenia od odpowiedzi');
  if (/✦/.test(mysli)) fail.push('model myślący 3 s uchodzi za błyskawiczny');

  // 7. pasek postępu nie może mieszać się z wynikami (na terminalu stderr
  //    też jest terminalem, więc `\r` nie kasował i zostawały puste linie)
  const smieci = out.split('\n').filter((l) => l.trim().startsWith('…')).length;
  const puste = out.split('\n').filter((l) => /^\s{20,}$/.test(l)).length;
  console.log(`7. resztki paska postępu: ${smieci}, puste linie: ${puste}`);
  if (smieci || puste) fail.push('pasek postępu zaśmieca wynik');

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPOMIAR PŁYNNOŚCI OK');
  process.exit(fail.length ? 1 : 0);
})();

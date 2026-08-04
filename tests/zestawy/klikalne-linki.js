const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Gołe adresy klikalne, bez psucia tego, co już jest linkiem albo kodem
(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const b = await przegladarka();
  const p = await b.newPage();
  await p.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const fail = [];

  const cases = [
    ['goły adres', 'Sprawdź https://meteo.imgw.pl/dyn/ teraz.',
      { hrefs: ['https://meteo.imgw.pl/dyn/'], texts: ['https://meteo.imgw.pl/dyn/'] }],
    ['adres z www', 'Zobacz www.radary24.pl/warszawa i tyle.',
      { hrefs: ['https://www.radary24.pl/warszawa'] }],
    ['kropka na końcu zdania', 'Wejdź na https://itaka.pl.',
      { hrefs: ['https://itaka.pl'], notIn: ['https://itaka.pl.'] }],
    ['przecinek po adresie', 'Tu https://a.pl/x, a tu https://b.pl/y.',
      { hrefs: ['https://a.pl/x', 'https://b.pl/y'] }],
    ['adres w nawiasie', 'Źródło (https://imgw.pl/pogoda) jest pewne.',
      { hrefs: ['https://imgw.pl/pogoda'] }],
    ['nawias w adresie', 'Zobacz https://pl.wikipedia.org/wiki/Test_(ujednoznacznienie) tutaj.',
      { hrefs: ['https://pl.wikipedia.org/wiki/Test_(ujednoznacznienie)'] }],
    ['link markdown nietknięty', 'Patrz [IMGW](https://meteo.imgw.pl) teraz.',
      { hrefs: ['https://meteo.imgw.pl'], texts: ['IMGW'], count: 1 }],
    ['adres w kodzie NIE linkowany', 'Uruchom `curl https://example.com/plik` w konsoli.',
      { count: 0 }],
    ['adres w bloku kodu', '```\ncurl https://example.com\n```', { count: 0 }],
    ['zwykły tekst bez adresu', 'Nie ma tu żadnego adresu.', { count: 0 }],
  ];

  for (const [name, md, want] of cases) {
    const r = await p.evaluate((src) => {
      const d = document.createElement('div');
      d.innerHTML = renderMarkdown(src);
      const as = [...d.querySelectorAll('a')];
      return { hrefs: as.map((a) => a.getAttribute('href')), texts: as.map((a) => a.textContent),
        targets: as.map((a) => a.getAttribute('target')), html: d.innerHTML };
    }, md);
    const problems = [];
    if (want.count !== undefined && r.hrefs.length !== want.count) {
      problems.push(`oczekiwano ${want.count} linków, jest ${r.hrefs.length}`);
    }
    for (const h of want.hrefs || []) if (!r.hrefs.includes(h)) problems.push(`brak href ${h}`);
    for (const t of want.texts || []) if (!r.texts.includes(t)) problems.push(`brak tekstu „${t}"`);
    for (const n of want.notIn || []) if (r.hrefs.includes(n)) problems.push(`zły href ${n}`);
    if (r.hrefs.length && !r.targets.every((t) => t === '_blank')) problems.push('link nie otwiera się w nowej karcie');
    console.log(`  ${problems.length ? '✗' : '✓'} ${name.padEnd(26)} ${r.hrefs.join(' , ') || '(brak linków)'}`);
    if (problems.length) { problems.forEach((x) => console.log(`      ${x}`)); fail.push(name); }
  }

  // bezpieczeństwo: nie wolno wpuścić javascript: ani HTML z treści modelu
  const sec = await p.evaluate(() => {
    const d = document.createElement('div');
    d.innerHTML = renderMarkdown('Klik [tu](javascript:alert(1)) i <img src=x onerror=alert(1)> oraz '
      + 'https://ok.pl/<script>alert(1)</script>');
    return { hrefs: [...d.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      imgs: d.querySelectorAll('img').length, scripts: d.querySelectorAll('script').length };
  });
  console.log(`  ${sec.hrefs.some((h) => /javascript:/i.test(h)) || sec.imgs || sec.scripts ? '✗' : '✓'} `
    + `bezpieczeństwo: href=${JSON.stringify(sec.hrefs)}, <img>=${sec.imgs}, <script>=${sec.scripts}`);
  if (sec.hrefs.some((h) => /javascript:/i.test(h))) fail.push('javascript: w href');
  if (sec.imgs || sec.scripts) fail.push('HTML z treści modelu trafił do DOM');

  console.log(fail.length ? '\nBŁĘDY: ' + fail.join('; ') : '\nLINKI OK');
  await b.close();
  env.koniec();
  process.exit(fail.length ? 1 : 0);
})();

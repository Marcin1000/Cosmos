// Wyniki wyszukiwarki: reklamy odrzucone, przekierowania rozpakowane, bez duplikatów
const src = require('fs').readFileSync('/home/user/Bear/server.js', 'utf8');
const cut = (re) => { const m = src.match(re); if (!m) throw new Error('brak: ' + re); return m[0]; };
const deps = cut(/const NAMED_ENTITIES[\s\S]*?\nfunction stripTags[\s\S]*?\n}\n/)
  + cut(/\/\*\* Rozpakuj adres wyniku[\s\S]*?\nfunction resolveDdgUrl[\s\S]*?\n}\n/);
const resolveDdgUrl = eval(`(() => { ${deps}\n return resolveDdgUrl; })()`);

const fail = [];
const cases = [
  ['//duckduckgo.com/y.js?ad_domain=booking.com&ad_provider=bingv7&click_metadata=xyz', '', 'reklama Booking'],
  ['//duckduckgo.com/y.js?ad_domain=itaka.pl&u3=https%3A%2F%2Fwww.itaka.pl', '', 'reklama Itaka'],
  ['//duckduckgo.com/l/?uddg=https%3A%2F%2Fmeteo.imgw.pl%2Fdyn%2F&rut=abc',
    'https://meteo.imgw.pl/dyn/', 'przekierowanie IMGW'],
  ['https://radary24.pl/radar-temperatury/warszawa', 'https://radary24.pl/radar-temperatury/warszawa', 'zwykły link'],
  ['//pogoda.interia.pl/prognoza', 'https://pogoda.interia.pl/prognoza', 'link bez protokołu'],
  ['javascript:alert(1)', '', 'nie-http odrzucone'],
  ['//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fabout', '', 'przekierowanie na samo DDG'],
  ['nie-adres', '', 'śmieć'],
];
for (const [input, want, name] of cases) {
  const got = resolveDdgUrl(input);
  const ok = got === want;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(28)} → ${got || '(odrzucone)'}`);
  if (!ok) fail.push(`${name}: oczekiwano ${want || '(odrzucone)'}, jest ${got || '(odrzucone)'}`);
}
console.log(fail.length ? '\nBŁĘDY:\n- ' + fail.join('\n- ') : '\nADRESY WYNIKÓW OK');
process.exit(fail.length ? 1 : 0);

// Wyniki wyszukiwarki: reklamy odrzucone, przekierowania rozpakowane, bez duplikatów
// Import zamiast wycinania regexem — trzeci raz ten sam problem: przy każdym
// przeniesieniu funkcji do modułu test padał, choć kod działał.
const { resolveDdgUrl } = require('../../lib/szukanie.js');

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

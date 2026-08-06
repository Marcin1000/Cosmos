/* Dwie rzeczy, których Cosmos NIGDY nie mówił modelowi, a bez których pół
   pytań nie ma sensu:

     • która jest godzina i jaki dziś dzień — model zna świat do końca swojego
       treningu, więc na „co dziś?" nie odpowiadał „nie wiem", tylko podawał
       konkretną złą datę;
     • gdzie jest użytkownik — na „znajdź warsztat w okolicy" trzeba było
       podać miasto ręcznie, za każdym razem.

   Trzecia sprawa to instrukcja wyszukiwania. Nie przewidywała sytuacji
   „chcę szukać, ale brakuje mi miasta" — model kręcił się wtedy w kółko
   przez cztery ekrany toku myślenia i nie robił ani jednego, ani drugiego. */
const { srodowisko } = require('../pomoc');

const rozmowa = async (adres, tekst) => {
  const r = await fetch(`${adres}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', messages: [{ role: 'user', content: tekst }] }),
  });
  return (await r.text());
};

(async () => {
  const env = await srodowisko('kontekst');
  const fail = [];

  // 1. data i godzina docierają do modelu
  let widziane = await rozmowa(env.adres, 'cokolwiek');
  const teraz = new Date();
  const rok = String(teraz.getFullYear());
  console.log(`1. „TERAZ JEST" w promptcie: ${/TERAZ JEST/.test(widziane) ? 'jest' : 'BRAK'}`);
  if (!/TERAZ JEST/.test(widziane)) fail.push('model nie dostaje daty ani godziny');
  if (!widziane.includes(rok)) fail.push(`w promptcie nie ma bieżącego roku (${rok})`);
  if (!/godzina \d{2}:\d{2}/.test(widziane)) fail.push('brak godziny — „dziś wieczorem" nic nie znaczy');

  // 2. bez ustawionej lokalizacji model ma wiedzieć, że jej NIE zna
  console.log(`2. bez lokalizacji: ${/Nie znasz lokalizacji/.test(widziane) ? 'mówi wprost' : 'MILCZY'}`);
  if (!/Nie znasz lokalizacji/.test(widziane)) fail.push('nie informuje modelu o braku lokalizacji');

  // 3. zapis lokalizacji
  const zapis = await fetch(`${env.adres}/api/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: 'Złotokłos, mazowieckie' }),
  });
  const wynikZapisu = await zapis.json();
  console.log(`3. zapis lokalizacji → ${zapis.status}, odczyt: „${wynikZapisu.location}"`);
  if (wynikZapisu.location !== 'Złotokłos, mazowieckie') fail.push('lokalizacja nie zapisała się poprawnie');

  const odczyt = await (await fetch(`${env.adres}/api/location`)).json();
  if (odczyt.location !== 'Złotokłos, mazowieckie') fail.push('lokalizacja nie przeżyła odczytu');

  // 4. i trafia do promptu przy następnej rozmowie
  widziane = await rozmowa(env.adres, 'znajdź warsztat w okolicy');
  console.log(`4. lokalizacja w promptcie: ${/Złotokłos/.test(widziane) ? 'jest' : 'BRAK'}`);
  if (!/Złotokłos/.test(widziane)) fail.push('zapisana lokalizacja nie dociera do modelu');
  if (!/nie dopytuj o lokalizację/i.test(widziane)) {
    fail.push('nic nie powstrzymuje modelu przed ponownym pytaniem o miasto');
  }

  // 5. instrukcja wyszukiwania mówi, co robić przy braku jednej informacji
  console.log(`5. reguła „brakuje mi jednej informacji": ${/BRAKUJE CI JEDNEJ INFORMACJI/.test(widziane) ? 'jest' : 'BRAK'}`);
  if (!/BRAKUJE CI JEDNEJ INFORMACJI/.test(widziane)) {
    fail.push('brak reguły na „chcę szukać, ale nie mam miasta" — model będzie się zapętlał');
  }
  if (!/nie roztrząsaj/i.test(widziane)) fail.push('nie mówi wprost, żeby nie roztrząsać');

  // 6. i żeby nie odpowiadał samą listą katalogów
  console.log(`6. reguła o lokalnych usługach: ${/LOKALNEJ USŁUGI/.test(widziane) ? 'jest' : 'BRAK'}`);
  if (!/LOKALNEJ USŁUGI/.test(widziane)) fail.push('brak zasady „konkretne firmy, nie same katalogi"');

  // 7. pusta lokalizacja wraca do stanu „nie znam"
  await fetch(`${env.adres}/api/location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: '' }),
  });
  widziane = await rozmowa(env.adres, 'cokolwiek');
  console.log(`7. po wyczyszczeniu: ${/Nie znasz lokalizacji/.test(widziane) ? 'znów nie zna' : 'PAMIĘTA STARĄ'}`);
  if (/Złotokłos/.test(widziane)) fail.push('wyczyszczona lokalizacja nadal trafia do modelu');

  // 8. geokodowanie odrzuca śmieci zamiast dzwonić po nie na zewnątrz
  const zle = await fetch(`${env.adres}/api/location/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat: 'nie-liczba', lon: null }),
  });
  console.log(`8. współrzędne-śmieci → HTTP ${zle.status}`);
  if (zle.status !== 400) fail.push('nie sprawdza współrzędnych przed wyjściem w internet');

  /* 9. Niedostępne zmysły nie mogą wstrzymywać rozmowy.
     Cache stanu zmysłów wygasa co minutę, a manifest zdolności — czekający
     na ten fetch — jest awaitowany PRZED wysłaniem pytania do modelu.
     Komputer domowy bywa wyłączony, więc raz na minutę pierwsza wiadomość
     płaciła do 1,5 s ciszy. Środowisko celuje w adres, z którego nic nie
     wraca (TEST-NET-1), więc gdyby blokada wróciła — ten pomiar ją złapie. */
  const czasy = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    await rozmowa(env.adres, 'krótkie pytanie');
    czasy.push(Date.now() - t0);
  }
  const najgorszy = Math.max(...czasy);
  console.log(`9. rozmowa przy niedostępnych zmysłach: ${czasy.join(' / ')} ms`);
  if (najgorszy > 1200) {
    fail.push(`odpowiedź czeka na zmysły (${najgorszy} ms) — manifest znów blokuje rozmowę`);
  }

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nDATA I MIEJSCE OK');
  process.exit(fail.length ? 1 : 0);
})();

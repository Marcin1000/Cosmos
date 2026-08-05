/* Cosmos umiał obraz WYGENEROWAĆ, ale nie umiał żadnego ZNALEŹĆ. Na prośbę
   „poproszę zdjęcia tych miejsc" model odpowiadał uczciwie „nie mam dostępu
   do wyszukiwania obrazów" i proponował wizje artystyczne zamiast prawdziwej
   Majorki — czyli dokładnie to, czego użytkownik nie chciał.

   Sprawdzamy całą drogę: żeton → wyniki → miniatura przez proxy. Osobno
   pilnujemy, żeby proxy nie dało się użyć do zaglądania gdzie indziej. */
const { srodowisko } = require('../pomoc');

(async () => {
  const env = await srodowisko('grafiki');
  const fail = [];

  // 1. wyszukiwanie zwraca zdjęcia ze źródłem
  const r = await fetch(`${env.adres}/api/search/images?q=Majorka%20La%20Seu`);
  const d = await r.json();
  console.log(`1. znaleziono ${d.results?.length || 0} zdjęć, błąd: ${d.error || 'brak'}`);
  if (!d.results || d.results.length < 5) fail.push('wyszukiwarka grafik nic nie zwróciła');
  const pierwsze = (d.results || [])[0] || {};
  if (!pierwsze.thumb) fail.push('brak miniatury w wyniku');
  if (!pierwsze.source) fail.push('brak źródła — zdjęcie bez źródła jest bezwartościowe');
  if (!pierwsze.title) fail.push('brak tytułu');

  // 2. puste zapytanie odrzucone, nie wysyłane dalej
  const puste = await fetch(`${env.adres}/api/search/images?q=`);
  console.log(`2. puste zapytanie → HTTP ${puste.status}`);
  if (puste.status !== 400) fail.push('puste zapytanie idzie do wyszukiwarki');

  // 3. miniatura przechodzi przez proxy Cosmosa (a nie prosto z cudzego CDN-u)
  const mini = await fetch(`${env.adres}/api/search/thumb?u=${encodeURIComponent(pierwsze.thumb)}`);
  const typ = mini.headers.get('content-type') || '';
  console.log(`3. miniatura przez proxy → HTTP ${mini.status}, typ ${typ}`);
  if (mini.status !== 200) fail.push('proxy nie przepuszcza własnych miniatur');
  if (!/^image\//.test(typ)) fail.push('proxy oddaje coś, co nie jest obrazem');

  // 4. proxy NIE jest otwarte — inaczej służy do skanowania sieci serwera
  const obcy = await fetch(`${env.adres}/api/search/thumb?u=${encodeURIComponent('https://przyklad.pl/cokolwiek.jpg')}`);
  console.log(`4. obcy host → HTTP ${obcy.status}`);
  if (obcy.status !== 403) fail.push('proxy przepuszcza dowolny host (SSRF)');

  const lokalny = await fetch(`${env.adres}/api/search/thumb?u=${encodeURIComponent('http://127.0.0.1:22/')}`);
  console.log(`5. inny port na localhoście → HTTP ${lokalny.status}`);
  if (lokalny.status === 200) fail.push('przez proxy da się zajrzeć w sieć lokalną serwera');

  const bezsens = await fetch(`${env.adres}/api/search/thumb?u=nie-adres`);
  console.log(`6. śmieciowy adres → HTTP ${bezsens.status}`);
  if (bezsens.status !== 400) fail.push('proxy nie sprawdza adresu');

  // 7. model musi WIEDZIEĆ, że to narzędzie istnieje — inaczej nadal będzie
  //    odpowiadał „nie mam dostępu do wyszukiwania obrazów"
  const czat = await fetch(`${env.adres}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', messages: [{ role: 'user', content: 'x' }] }),
  });
  const prompt = await czat.text();
  console.log(`7. instrukcja [GRAFIKA:] w promptcie: ${/GRAFIKA:/.test(prompt) ? 'jest' : 'BRAK'}`);
  if (!/WYSZUKIWANIE GRAFIK/.test(prompt)) fail.push('model nie wie, że umie szukać zdjęć');
  if (!/RÓŻNICA MIĘDZY NARZĘDZIAMI/.test(prompt)) {
    fail.push('nic nie odróżnia „znajdź zdjęcia" od „wygeneruj obraz"');
  }

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nSZUKANIE GRAFIK OK');
  process.exit(fail.length ? 1 : 0);
})();

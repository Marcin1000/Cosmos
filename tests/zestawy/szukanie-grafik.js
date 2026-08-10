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
  /* Model podajemy WPROST. Za pierwszym razem test brał domyślny z konfiguracji
     i przewrócił się, gdy poziomy narzędzi obcięły opis dla mniejszych modeli —
     badał wtedy nie to, co miał badać, tylko przypadkowe ustawienie. */
  const promptDla = async (model) => {
    const r = await fetch(`${env.adres}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'cloud', model, messages: [{ role: 'user', content: 'x' }] }),
    });
    return r.text();
  };

  const prompt = await promptDla('nvidia/nemotron-3-super-120b-a12b');
  console.log(`7. instrukcja [GRAFIKA:] w promptcie: ${/GRAFIKA:/.test(prompt) ? 'jest' : 'BRAK'}`);
  if (!/WYSZUKIWANIE GRAFIK/.test(prompt)) fail.push('model nie wie, że umie szukać zdjęć');
  if (!/RÓŻNICA MIĘDZY NARZĘDZIAMI/.test(prompt)) {
    fail.push('nic nie odróżnia „znajdź zdjęcia" od „wygeneruj obraz"');
  }

  /* Marcin poprosił „ze zdjęciami proszę" do siedmiodniowego planu Majorki
     i dostał zdjęcia JEDNEGO miejsca, poprzedzone zapowiedzią „oto propozycje
     zapytań o zdjęcia". Obie rzeczy wynikały z tego, czego prompt NIE mówił. */
  const jednymZnacznikiem = /JEDNYM\s+znaczniku/.test(prompt);
  console.log(`7b. prompt żąda kilku miejsc w jednym znaczniku: ${jednymZnacznikiem ? 'tak' : 'NIE'}`);
  if (!jednymZnacznikiem) {
    fail.push('prompt nie żąda kilku miejsc naraz — stąd jedno zdjęcie z siedmiu przystanków planu');
  }
  if (!/NIE ZAPOWIADAJ WYSZUKIWANIA/.test(prompt)) {
    fail.push('prompt nie zabrania zapowiadania — stąd „oto propozycje zapytań o zdjęcia"');
  }

  /* Źródła. „Podaj źródła" bez formatu kończyło się zapisem 【1†L1-L4】 —
     nie linkiem, nie tytułem, tylko czymś, w co nie da się kliknąć. */
  const format = /Źródła:/.test(prompt) && /\[tytuł\]\(adres\)/.test(prompt);
  console.log(`7c. prompt podaje FORMAT źródeł: ${format ? 'tak' : 'NIE'}`);
  if (!format) fail.push('prompt każe podać źródła, ale nie mówi jak — stąd 【1†L1-L4】');
  if (!/【/.test(prompt)) {
    fail.push('prompt nie wymienia zapisu 【…】 jako zakazanego — model sam z niego nie zrezygnuje');
  }

  // 8. mniejszy model też musi umieć szukać zdjęć — tylko krótszym tekstem
  const krotki = await promptDla('nvidia/nvidia-nemotron-nano-9b-v2');
  console.log(`8. mniejszy model — [GRAFIKA:] ${/GRAFIKA:/.test(krotki) ? 'jest' : 'BRAK'}`);
  if (!/GRAFIKA:/.test(krotki)) fail.push('skracanie instrukcji odebrało mniejszemu modelowi grafiki');

  /* ---- SEDNO POPRAWKI: zapas źródeł ----
     Marcin zgłosił „nie pokazuje zdjęć, które wyszukał". Jedno źródło
     (DuckDuckGo ze skrobanym żetonem) potrafi odmówić z powodów całkowicie
     poza naszą kontrolą — i wtedy nie było ŻADNYCH zdjęć. Poniżej wyłączamy
     źródła po kolei i pilnujemy, że zdjęcia nadal są. */
  const awaria = async (zrodla) => {
    await fetch(`http://127.0.0.1:7117/awaria?zrodla=${encodeURIComponent(zrodla)}`);
  };
  const ile = async (etykieta) => {
    const rr = await fetch(`${env.adres}/api/search/images?q=Krak%C3%B3w`);
    const dd = await rr.json();
    const zrodla = (dd.zrodla || []).map((z) => `${z.nazwa}=${z.blad ? 'padło' : z.ile}`).join(' ');
    console.log(`   ${etykieta}: ${dd.results?.length || 0} zdjęć  [${zrodla}]`);
    return dd;
  };

  console.log('9. odporność na awarie źródeł:');
  /* SearXNG jest źródłem WŁASNYM i idzie pierwszy — sprawdzamy osobno, że
     naprawdę bierze udział, bo tylko nad nim mamy kontrolę. */
  const zSearx = await ile('wszystkie działają');
  if (!zSearx.results?.some((x) => x.zrodlo === 'SearXNG')) {
    fail.push('SearXNG skonfigurowany, a nie ma go w wynikach');
  }
  await awaria('searxng');
  const bezSearx = await ile('bez SearXNG');
  if (!bezSearx.results?.length) fail.push('padł SearXNG i zdjęcia zniknęły');
  await awaria('');

  await awaria('ddg');
  let d9 = await ile('bez DuckDuckGo');
  if (!d9.results?.length) fail.push('padł DuckDuckGo i zdjęcia zniknęły — zapas nie działa');
  if (!d9.results?.some((x) => x.zrodlo === 'Wikimedia Commons')) {
    fail.push('Commons nie wskoczył na miejsce DuckDuckGo');
  }

  await awaria('ddg,commons');
  d9 = await ile('bez DDG i Commons');
  if (!d9.results?.length) fail.push('zostało jedno źródło, a zdjęć brak');

  await awaria('searxng,ddg,commons,openverse');
  d9 = await ile('wszystkie padły');
  if (d9.results?.length) fail.push('atrapa miała paść, a zdjęcia są — test nic nie sprawdza');
  if (!d9.error) fail.push('wszystko padło, a Cosmos nie mówi DLACZEGO — nie do zdiagnozowania');
  else console.log(`   powód podany użytkownikowi: „${d9.error.slice(0, 80)}"`);

  await awaria('');   // przywróć wszystkie źródła
  const d10 = await ile('wszystkie działają');
  const zrodlaWWynikach = [...new Set((d10.results || []).map((x) => x.zrodlo))];
  console.log(`10. źródła w wynikach: ${zrodlaWWynikach.join(', ')}`);
  if (!(d10.results || []).every((x) => x.zrodlo)) fail.push('wynik bez nazwy źródła');
  /* Przeplot: gdy działają wszystkie źródła, w wynikach mają być WSZYSTKIE.
     Sklejanie po kolei dawało osiem obrazów z samego DuckDuckGo, a materiał
     na jasnej licencji nie pokazywał się nigdy. */
  if (zrodlaWWynikach.length < 3) {
    fail.push(`w wynikach tylko ${zrodlaWWynikach.length} źródła (${zrodlaWWynikach.join(', ')}) `
      + '— jedno źródło zajmuje wszystkie miejsca');
  }
  const zLicencja = (d10.results || []).filter((x) => x.licencja);
  console.log(`    z podaną licencją: ${zLicencja.length} z ${d10.results.length}`);
  if (!zLicencja.length) fail.push('żaden wynik nie niesie licencji — nie wiadomo, czego wolno użyć');
  // Duplikaty: to samo zdjęcie z dwóch źródeł ma pojawić się raz.
  const pelne = (d10.results || []).map((x) => x.full);
  if (new Set(pelne).size !== pelne.length) fail.push('ten sam obraz pokazany dwa razy');

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nSZUKANIE GRAFIK OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Archiwum materiału — drugi wyróżnik Cosmosa.

   ChatGPT nie ma plików Marcina i nigdy nie będzie ich miał, bo nikt nie
   wrzuci dwóch terabajtów do okna czatu. Tu indeks mieszka na VPS-ie, więc
   „ile klipów 50 mm w tym roku" odpowie z telefonu w terenie, przy
   wyłączonym komputerze domowym.

   Najciekawsze i najłatwiejsze do zepsucia jest filtrowanie po PORZE
   ŚWIATŁA: liczonej z pozycji Słońca nad miejscem zdjęcia, nie zgadywanej
   z godziny w nazwie pliku. Dlatego sprawdzamy je na zdjęciach o znanych
   porach — południe musi wyjść jako ostre światło, a 20:40 w czerwcu jako
   złota godzina. */
const { srodowisko } = require('../pomoc');

const ZLOTOKLOS = { lat: 52.0247, lon: 20.9019 };

// Materiał próbny: te same współrzędne, różne pory i nastawy.
const MATERIAL = [
  { id: 'a1', nazwa: 'IMG_001.jpg', typ: 'zdjecie', kiedy: '2026-06-14T20:40:00',
    aparat: 'Canon EOS R6m2', obiektyw: 'RF50mm F1.8 STM', ogniskowa: 50,
    przyslona: 1.8, iso: 400, czasS: 0.005, ...ZLOTOKLOS, obiekty: ['person'] },
  { id: 'a2', nazwa: 'IMG_002.jpg', typ: 'zdjecie', kiedy: '2026-06-14T13:00:00',
    aparat: 'Canon EOS R6m2', obiektyw: 'RF50mm F1.8 STM', ogniskowa: 50,
    przyslona: 8, iso: 100, czasS: 0.002, ...ZLOTOKLOS },
  { id: 'a3', nazwa: 'DJI_003.mp4', typ: 'wideo', kiedy: '2026-06-15T20:45:00',
    aparat: 'DJI Mavic 3', ogniskowa: 24, przyslona: 2.8, iso: 800,
    ...ZLOTOKLOS, zrodlo: 'onedrive' },
  { id: 'a4', nazwa: 'IMG_004.jpg', typ: 'zdjecie', kiedy: '2025-11-02T10:00:00',
    aparat: 'Canon EOS R6m2', obiektyw: 'RF24-70mm F2.8', ogniskowa: 35,
    przyslona: 4, iso: 1600, ...ZLOTOKLOS },
  { id: 'a5', nazwa: 'IMG_005.jpg', typ: 'zdjecie', kiedy: '2026-06-14T23:30:00',
    aparat: 'Canon EOS R6m2', ogniskowa: 35, przyslona: 1.4, iso: 6400, ...ZLOTOKLOS },
  // Zdjęcie z zupełnie innego miejsca — do sprawdzania promienia.
  { id: 'a6', nazwa: 'IMG_006.jpg', typ: 'zdjecie', kiedy: '2026-07-01T12:00:00',
    aparat: 'Canon EOS R6m2', ogniskowa: 50, lat: 54.352, lon: 18.6466 },
  // Bez daty i GPS — takich plików w archiwum jest zawsze sporo.
  { id: 'a7', nazwa: 'skan.jpg', typ: 'zdjecie' },
];

(async () => {
  /* Środowisko z atrapą echa: ten sam zestaw sprawdza i indeks, i to,
     czy model W OGÓLE dowiaduje się o istnieniu archiwum. */
  const env = await srodowisko('kontekst');
  const fail = [];

  const dodaj = (wpisy) => fetch(`${env.adres}/api/archive/add`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wpisy }),
  }).then((r) => r.json());
  const szukaj = (q) => fetch(`${env.adres}/api/archive/search?${new URLSearchParams(q)}`).then((r) => r.json());
  const staty = (q) => fetch(`${env.adres}/api/archive/stats?${new URLSearchParams(q || {})}`).then((r) => r.json());

  // 1. indeksowanie
  let r = await dodaj(MATERIAL);
  console.log(`1. dodano ${r.dodanych}, razem ${r.razem}`);
  if (r.dodanych !== 7) fail.push(`dodano ${r.dodanych} zamiast 7`);

  /* 2. Powtórne indeksowanie tego samego katalogu ma ODŚWIEŻAĆ, nie mnożyć.
     Bez tego każde ponowne skanowanie OneDrive podwajałoby archiwum. */
  r = await dodaj(MATERIAL);
  console.log(`2. powtórka: dodanych ${r.dodanych}, odświeżonych ${r.odswiezonych}, razem ${r.razem}`);
  if (r.dodanych !== 0 || r.razem !== 7) fail.push('powtórne indeksowanie zduplikowało wpisy');

  /* 3. Pora światła — sedno tego wyróżnika. 20:40 czasu lokalnego w czerwcu
     pod Warszawą to złota godzina, 13:00 to ostre światło, 23:30 to noc.
     Gdyby przeliczanie strefy było zepsute, wszystkie trzy byłyby przesunięte. */
  const zlota = await szukaj({ swiatlo: 'złota godzina' });
  const ostre = await szukaj({ swiatlo: 'ostre światło' });
  console.log(`3. złota godzina: ${zlota.wyniki.map((w) => w.nazwa).join(', ') || 'brak'}`);
  console.log(`   ostre światło: ${ostre.wyniki.map((w) => w.nazwa).join(', ') || 'brak'}`);
  if (!zlota.wyniki.some((w) => w.id === 'a1')) fail.push('zdjęcie z 20:40 nie trafiło do złotej godziny');
  if (!zlota.wyniki.some((w) => w.id === 'a3')) fail.push('klip z 20:45 nie trafił do złotej godziny');
  if (!ostre.wyniki.some((w) => w.id === 'a2')) fail.push('zdjęcie z 13:00 nie trafiło do ostrego światła');
  if (zlota.wyniki.some((w) => w.id === 'a2')) fail.push('południe zaliczone do złotej godziny');

  // 4. filtry proste
  const rok = await szukaj({ rok: 2026 });
  const wideo = await szukaj({ typ: 'wideo' });
  const ogn = await szukaj({ ogniskowa: 50 });
  console.log(`4. rok 2026: ${rok.znaleziono} · wideo: ${wideo.znaleziono} · 50 mm: ${ogn.znaleziono}`);
  if (rok.znaleziono !== 5) fail.push(`rok 2026 dał ${rok.znaleziono}, oczekiwano 5`);
  if (wideo.znaleziono !== 1) fail.push('zły filtr po typie');
  if (ogn.znaleziono !== 3) fail.push(`50 mm dało ${ogn.znaleziono}, oczekiwano 3`);

  // 5. dopasowanie fragmentem — „R6" ma znaleźć „Canon EOS R6m2"
  const r6 = await szukaj({ aparat: 'R6' });
  console.log(`5. aparat „R6": ${r6.znaleziono}`);
  if (r6.znaleziono !== 5) fail.push(`„R6" dało ${r6.znaleziono}, oczekiwano 5`);

  // 6. zakresy
  const wysokieIso = await szukaj({ isoOd: 1600 });
  const szerokie = await szukaj({ ogniskowaOd: 24, ogniskowaDo: 35 });
  console.log(`6. ISO ≥1600: ${wysokieIso.znaleziono} · 24–35 mm: ${szerokie.znaleziono}`);
  if (wysokieIso.znaleziono !== 2) fail.push(`ISO ≥1600 dało ${wysokieIso.znaleziono}, oczekiwano 2`);
  if (szerokie.znaleziono !== 3) fail.push(`24–35 mm dało ${szerokie.znaleziono}, oczekiwano 3`);

  /* 7. Promień od punktu — „mam coś z tego miejsca". Gdańsk (a6) leży
     260 km od Złotokłosu i nie może wpaść w promień 5 km. */
  const tutaj = await szukaj({ ...ZLOTOKLOS, promienKm: 5 });
  console.log(`7. w promieniu 5 km od Złotokłosu: ${tutaj.znaleziono}`);
  if (tutaj.znaleziono !== 5) fail.push(`promień dał ${tutaj.znaleziono}, oczekiwano 5`);
  if (tutaj.wyniki.some((w) => w.id === 'a6')) fail.push('Gdańsk wpadł w promień 5 km od Złotokłosu');

  // 8. zestawienia — na tym opierają się pytania „ile" i „najczęściej"
  const poOgn = await staty({ pole: 'ogniskowa' });
  console.log(`8. wg ogniskowej: ${poOgn.grupy.map((g) => `${g.wartosc}mm×${g.ile}`).join(', ')}`);
  const p50 = poOgn.grupy.find((g) => g.wartosc === '50');
  if (!p50 || p50.ile !== 3) fail.push('złe zestawienie po ogniskowej');

  const poRoku = await staty({ pole: 'rok' });
  console.log(`   wg roku: ${poRoku.grupy.map((g) => `${g.wartosc}×${g.ile}`).join(', ')}`);
  if (!poRoku.grupy.find((g) => g.wartosc === '2026' && g.ile === 5)) fail.push('złe zestawienie po roku');

  // 9. zestawienie z filtrem — „ile 50 mm W TYM ROKU", nie w ogóle
  const poObiektywie = await staty({ pole: 'obiektyw', rok: 2026 });
  console.log(`9. obiektywy w 2026: ${poObiektywie.grupy.map((g) => `${g.wartosc}×${g.ile}`).join(', ')}`);
  if (poObiektywie.grupy.some((g) => g.wartosc.includes('24-70'))) {
    fail.push('filtr roku nie zadziałał w zestawieniu — wszedł obiektyw z 2025');
  }

  // 10. pliki bez danych nie mogą znikać ani udawać, że mają datę
  const brak = await szukaj({ nazwa: 'skan' });
  console.log(`10. plik bez EXIF-u: ${brak.znaleziono}, światło=${brak.wyniki[0] && brak.wyniki[0].swiatlo}`);
  if (brak.znaleziono !== 1) fail.push('plik bez metadanych wypadł z indeksu');
  if (brak.wyniki[0] && brak.wyniki[0].swiatlo !== null) fail.push('zmyślił porę światła bez daty i GPS');

  // 11. podsumowanie
  const suma = await staty();
  console.log(`11. podsumowanie: ${suma.wpisow} wpisów, ${suma.zdjec} zdjęć, `
    + `${suma.wideo} wideo, ${suma.zGps} z GPS, źródła: ${suma.zrodla.join('+')}`);
  if (suma.wpisow !== 7 || suma.zGps !== 6) fail.push('złe podsumowanie');
  if (!suma.zrodla.includes('onedrive') || !suma.zrodla.includes('dysk')) fail.push('zgubił źródła');

  // 12. usuwanie po źródle — przy przeindeksowaniu OneDrive od zera
  const usuniete = await (await fetch(`${env.adres}/api/archive/source?zrodlo=onedrive`, { method: 'DELETE' })).json();
  const po = await staty();
  console.log(`12. usunięto z OneDrive: ${usuniete.usunieto}, zostało ${po.wpisow}`);
  if (usuniete.usunieto !== 1 || po.wpisow !== 6) fail.push('usuwanie po źródle nie działa');

  // 13. odporność na śmieci
  const zle = await fetch(`${env.adres}/api/archive/add`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wpisy: 'nie tablica' }),
  });
  const zlePole = await staty({ pole: 'cokolwiek' });
  console.log(`13. śmieci → HTTP ${zle.status}; złe pole grupowania → „${zlePole.error}"`);
  if (zle.status !== 400) fail.push('przyjął wpisy, które nie są tablicą');
  if (!zlePole.error) fail.push('grupowanie po nieznanym polu nie zgłasza błędu');

  // 14. model wie o narzędziu — dopiero gdy archiwum NIE jest puste
  const prompt = await (await fetch(`${env.adres}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', model: 'nvidia/nemotron-3-super-120b-a12b', messages: [{ role: 'user', content: 'x' }] }),
  })).text();
  console.log(`14. instrukcja [ARCHIWUM:] w promptcie: ${/ARCHIWUM MATERIAŁU/.test(prompt) ? 'jest' : 'BRAK'}`);
  if (!/ARCHIWUM MATERIAŁU/.test(prompt)) fail.push('model nie wie o archiwum');
  if (!/grupuj/.test(prompt)) fail.push('model nie wie, jak zapytać o zestawienie');

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nARCHIWUM OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Budowniczowie widoku — sprawdzani wywołaniem, nie regexpem.

   PIĘĆ RAZY w jednej sesji test szukający frazy w `public/app.js` padł przy
   przeprowadzce kodu, mimo że funkcja działała bez zmian. Marcin nazwał ten
   problem wprost: „za dużo testów sprawdza tekst źródła, nie zachowanie".

   Za każdym piątym razem kusiło, żeby po prostu przestawić regexp na nowy
   plik. To jednak nie naprawia niczego — tylko przesuwa moment, w którym
   test znowu skłamie. Prawdziwą przeszkodą było to, że budowniczych DOM-u
   nie dało się uruchomić poza przeglądarką.

   Po wydzieleniu `public/widoki.js` brakowało tylko atrapy `document`
   (`tests/atrapy/maly-dom.js`). Z nią te funkcje da się wywołać w Node
   i zapytać o rzeczy, na które regexp nie odpowie:

     — czy stopka pokazuje właściwy licznik i przycisk,
     — czy kliknięcie dobiera KOLEJNĄ porcję, a nie tę samą,
     — czy dobrane kafelki dopisują się do istniejącej siatki,
     — czy panel wyniku programu pokazuje też to, co poszło źle.

   Zestaw trwa ułamek sekundy i nie potrzebuje Chromium.
*/
const path = require('node:path');
const { zainstalujDom } = require(path.join(__dirname, '..', 'atrapy', 'maly-dom.js'));

const fail = [];
const dom = zainstalujDom();

// Wczytujemy DOPIERO po zainstalowaniu atrapy — moduł sięga po `window`.
const { utworzWidoki } = require(path.join(__dirname, '..', '..', 'public', 'widoki.js'));

/** Świeży zestaw budowniczych z atrapami zależności. */
function stanowisko({ odpowiedz = {} } = {}) {
  const dziennik = { adresy: [], zapisy: 0, odmalowania: 0 };
  const widoki = utworzWidoki({
    t: (klucz, v) => (v ? `${klucz}:${Object.values(v).join(',')}` : klucz),
    readJsonSafe: async (r) => r.json(),
    saveConversations: () => { dziennik.zapisy++; },
    renderMessages: () => { dziennik.odmalowania++; },
    msgPhotos: (m) => (m.content && m.content.photos) || [],
    msgDalej: (m) => (m.content && m.content.dalej) || null,
    PORCJA_ARCHIWUM: 24,
  });
  global.fetch = async (adres) => {
    dziennik.adresy.push(String(adres));
    return { ok: true, status: 200, json: async () => odpowiedz };
  };
  return { widoki, dziennik };
}

(async () => {
  /* --- 1. Stopka archiwum: licznik i przycisk --------------------------- */
  {
    const { widoki } = stanowisko();
    const m = {
      content: {
        photos: [{ thumb: '/a' }, { thumb: '/b' }],
        dalej: { q: 'folder=Mazury+2026', pomin: 2, razem: 311 },
      },
    };
    const pasek = widoki.stopkaArchiwum(m);
    const tekst = pasek.calyTekst();
    const przyciski = pasek.children.filter((c) => c.tagName === 'BUTTON');
    console.log(`1. stopka: „${tekst}", przycisków: ${przyciski.length}`);
    if (!/311/.test(tekst)) fail.push('stopka nie podaje, ile plików jest łącznie');
    if (!/\b2\b/.test(tekst)) fail.push('stopka nie podaje, ile już pokazano');
    if (przyciski.length !== 1) fail.push(`stopka ma ${przyciski.length} przycisków zamiast jednego`);
  }

  /* --- 2. Wszystko pokazane → sam licznik, bez przycisku ---------------- */
  {
    const { widoki } = stanowisko();
    const m = { content: { photos: [{ thumb: '/a' }], dalej: { q: '', pomin: 311, razem: 311 } } };
    const pasek = widoki.stopkaArchiwum(m);
    const przyciski = pasek.children.filter((c) => c.tagName === 'BUTTON');
    console.log(`2. po dojściu do końca przycisków: ${przyciski.length}`);
    if (przyciski.length) {
      fail.push('przycisk „pokaż kolejne" zostaje, choć nie ma już czego dobierać');
    }
  }

  /* --- 3. KLIKNIĘCIE DOBIERA KOLEJNĄ PORCJĘ ----------------------------
     Sedno stronicowania: adres musi nieść `pomin` z bieżącego stanu, a nie
     zaczynać od początku listy. Regexp po źródle sprawdzał, czy w pliku jest
     napis `pomin=${d.pomin}`; tutaj sprawdzamy, co naprawdę poleciało. */
  {
    const { widoki, dziennik } = stanowisko({
      odpowiedz: {
        znaleziono: 311,
        wyniki: [
          { id: 'onedrive:c', nazwa: 'c.CR3', zrodlo: 'onedrive' },
          { id: 'onedrive:d', nazwa: 'd.CR3', zrodlo: 'onedrive' },
          { id: 'dysk:e', nazwa: 'e.jpg', zrodlo: 'dysk' },
        ],
      },
    });
    const m = {
      content: {
        photos: [{ thumb: '/a' }, { thumb: '/b' }],
        dalej: { q: 'folder=Mazury+2026', pomin: 2, razem: 311 },
      },
    };
    /* Siatka + stopka pod nią, tak jak układa je rozmowa — stopka szuka
       siatki przez `previousElementSibling`, więc kolejność ma znaczenie. */
    const rodzic = dom.dokument.createElement('div');
    const siatka = widoki.photosGrid(m.content.photos);
    rodzic.appendChild(siatka);
    const pasek = widoki.stopkaArchiwum(m);
    rodzic.appendChild(pasek);

    const przycisk = pasek.children.find((c) => c.tagName === 'BUTTON');
    await przycisk.dispatch('click');

    const adres = dziennik.adresy[0] || '';
    console.log(`3. dobranie: ${adres}`);
    if (!/pomin=2/.test(adres)) fail.push(`adres nie niesie miejsca zatrzymania: ${adres}`);
    if (!/folder=Mazury/.test(adres)) fail.push('adres zgubił filtry — kolejna porcja byłaby inna');

    console.log(`   kafelków po dobraniu: ${m.content.photos.length}, `
      + `pomin: ${m.content.dalej.pomin}`);
    /* Z trzech oddanych plików kafelki dostają tylko dwa z OneDrive, ale
       `pomin` przesuwa się o CAŁĄ stronę — inaczej pliki z dysku wracałyby
       w kółko i przycisk kręciłby się w miejscu. */
    if (m.content.photos.length !== 4) {
      fail.push(`po dobraniu jest ${m.content.photos.length} kafelków zamiast 4`);
    }
    if (m.content.dalej.pomin !== 5) {
      fail.push(`pomin przesunął się na ${m.content.dalej.pomin} zamiast na 5 `
        + '(o całą oddaną stronę, nie o liczbę kafelków)');
    }
    // Kafelki mają DOPISAĆ się do istniejącej siatki, nie przerysować rozmowy.
    console.log(`   kafelków w siatce: ${siatka.children.length}, `
      + `przerysowań rozmowy: ${dziennik.odmalowania}`);
    if (siatka.children.length !== 4) {
      fail.push(`siatka ma ${siatka.children.length} kafelków zamiast 4 — `
        + 'dobrane nie zostały dopisane');
    }
    if (dziennik.odmalowania) {
      fail.push('dobranie porcji przerysowuje całą rozmowę — to wyrzuca użytkownika '
        + 'spod siatki, którą właśnie ogląda');
    }
  }

  /* --- 4. Siatka miniatur: jeden kafelek na zdjęcie --------------------- */
  {
    const { widoki } = stanowisko();
    const siatka = widoki.photosGrid([{ thumb: '/1' }, { thumb: '/2' }, { thumb: '/3' }]);
    console.log(`4. siatka z trzech zdjęć: ${siatka.children.length} kafelków`);
    if (siatka.children.length !== 3) {
      fail.push(`siatka zbudowała ${siatka.children.length} kafelków z trzech zdjęć`);
    }
  }

  /* --- 5. Wpis archiwum → kafelek --------------------------------------- */
  {
    const { widoki } = stanowisko();
    const k = widoki.naKafelek({
      id: 'onedrive:abc', nazwa: '3B9A4703.CR3',
      kiedy: '2026-06-14T19:12:33', ogniskowa: 70, poraDnia: 'wieczor',
    });
    console.log(`5. kafelek: „${k.title}" | ${k.licencja}`);
    if (!/3B9A4703/.test(k.title)) fail.push('kafelek nie pokazuje nazwy pliku');
    if (!/2026-06-14 19:12/.test(k.title)) fail.push('kafelek nie pokazuje daty zdjęcia');
    if (!/70 mm/.test(k.licencja)) fail.push('kafelek nie pokazuje ogniskowej');
    if (!/id=onedrive%3Aabc/.test(k.thumb)) fail.push('adres miniatury nie jest zakodowany');
  }

  /* --- 6. Panel wyniku programu pokazuje TAKŻE błędy --------------------
     Program, który się wywrócił, jest częstszy niż ten, który policzył —
     a panel pokazujący tylko `stdout` zostawiałby wtedy pustą ramkę. */
  {
    const { widoki } = stanowisko();
    const panel = widoki.runPanel({ stdout: 'wynik: 42', stderr: 'Traceback…', wyniki: [], ms: 120 });
    const tekst = panel.calyTekst();
    console.log(`6. panel wyniku zawiera stdout: ${/42/.test(tekst)}, `
      + `stderr: ${/Traceback/.test(tekst)}`);
    if (!/42/.test(tekst)) fail.push('panel wyniku nie pokazuje tego, co program wypisał');
    if (!/Traceback/.test(tekst)) fail.push('panel wyniku nie pokazuje błędów programu');
  }

  dom.odinstaluj();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nWIDOKI BUDUJĄ OK');
  process.exit(fail.length ? 1 : 0);
})();

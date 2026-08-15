/* „Pokazałem Ci 20, ale jest 311" — czyli wynik, którego nie da się obejrzeć.

   Marcin: „Chciałbym móc przejrzeć wszystkie np. zdjęcia z wyszukania, a nie
   mieć informacje typu »pokazałem Ci 20 ale jest 311« bo nie o to tu chodzi."

   Miał rację i nie chodziło o gadatliwość modelu. Trasa `/api/archive/search`
   przyjmowała `limit`, ale nie umiała pominąć początku — więc każde zapytanie oddawało ten
   sam POCZĄTEK listy. Jedyną drogą do 311. pliku było zawężanie filtrów tak
   długo, aż wynik zejdzie poniżej limitu; do zdjęcia bez wyróżniającej cechy
   nie dało się dojść w ogóle.

   Sedno naprawy jest podziałem ról, nie większym limitem:
     — MODEL dostaje próbkę i ma prawo jej nie przekraczać (kontekst kosztuje),
     — CZŁOWIEK dostaje przycisk i dochodzi nim do ostatniego pliku.
   Dlatego zestaw sprawdza obie strony: że trasa umie oddać dowolny kawałek
   wyniku, i że nagłówek dla modelu każe mu przestać przepraszać za limit.
*/
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fail = [];
const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-strony-'));
const archiwum = require('../../lib/archiwum.js').utworz(katalog);

// 311 plików — dokładnie ta liczba, o którą pytał Marcin.
const ILE = 311;
archiwum.dodaj(Array.from({ length: ILE }, (_, i) => ({
  id: `onedrive:p${String(i).padStart(4, '0')}`,
  zrodlo: 'onedrive',
  typ: 'zdjecie',
  nazwa: `3B9A${4000 + i}.CR3`,
  sciezka: `/Zdjęcia/Mazury 2026/3B9A${4000 + i}.CR3`,
  // Kolejne minuty: pierwszy plik jest NAJSTARSZY, ostatni najnowszy.
  kiedy: `2026-06-14T${String(8 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`,
  aparat: 'Canon EOS R6m2',
  dataZrodlo: 'exif',
  exifCzytany: true,
})));

const trasy = require('../../lib/archiwum-trasy.js').utworz({
  archiwum,
  onedrive: { polaczony: () => true },
  SENSES_URL: '',
  sendJson: (res, kod, dane) => { res.kod = kod; res.dane = dane; },
  readJson: async () => ({}),
  addEvent: () => {},
  sensesState: () => ({}),
  wspolrzedneMiejsca: async () => null,
});

const zapytaj = async (qs) => {
  const res = {};
  await trasy.handleArchiwum(
    { method: 'GET', url: `/api/archive/search?${qs}` }, res, '/api/archive/search');
  return res.dane || {};
};

(async () => {
  // --- 1. Pierwsza porcja mówi, ile jest wszystkiego ----------------------
  const s1 = await zapytaj('limit=24');
  console.log(`1. pierwsza porcja: ${s1.wyniki.length} plików, znaleziono ${s1.znaleziono}, `
    + `pomin=${s1.pomin}, zostało ${s1.zostalo}`);
  if (s1.wyniki.length !== 24) fail.push(`pierwsza porcja ma ${s1.wyniki.length} plików zamiast 24`);
  if (s1.znaleziono !== ILE) fail.push(`znaleziono=${s1.znaleziono}, a plików jest ${ILE}`);
  if (s1.zostalo !== ILE - 24) fail.push(`zostalo=${s1.zostalo}, spodziewane ${ILE - 24}`);

  // --- 2. Da się dojść do OSTATNIEGO pliku --------------------------------
  /* Sedno skargi. Chodzimy porcjami tak, jak robi to przycisk pod siatką,
     i liczymy, czy zobaczyliśmy wszystkie 311 — każdy raz, żadnego dwa razy. */
  const widziane = new Set();
  let pomin = 0;
  let porcji = 0;
  for (;;) {
    const s = await zapytaj(`limit=24&pomin=${pomin}`);
    if (!s.wyniki.length) break;
    for (const w of s.wyniki) widziane.add(w.id);
    pomin += s.wyniki.length;
    porcji++;
    if (porcji > 100) { fail.push('przeglądanie nie kończy się — porcje kręcą się w kółko'); break; }
  }
  console.log(`2. po ${porcji} porcjach obejrzano ${widziane.size} z ${ILE} plików`);
  if (widziane.size !== ILE) {
    fail.push(`przez stronicowanie widać ${widziane.size} z ${ILE} plików — reszta jest nieosiągalna`);
  }
  if (porcji !== Math.ceil(ILE / 24)) {
    fail.push(`${porcji} porcji zamiast ${Math.ceil(ILE / 24)} — porcje się nakładają albo gubią`);
  }

  // --- 3. Kolejne porcje to KOLEJNE pliki, nie te same --------------------
  const a = await zapytaj('limit=24&pomin=0');
  const b = await zapytaj('limit=24&pomin=24');
  const wspolne = a.wyniki.filter((w) => b.wyniki.some((x) => x.id === w.id)).length;
  console.log(`3. porcja 1 i porcja 2 mają wspólnych plików: ${wspolne}`);
  if (wspolne) fail.push(`druga porcja powtarza ${wspolne} plików z pierwszej — \`pomin\` jest ignorowane`);
  // Druga porcja ma iść DALEJ w czasie, nie wracać.
  if (b.wyniki[0].kiedy > a.wyniki[a.wyniki.length - 1].kiedy) {
    fail.push('druga porcja zaczyna się nowszym plikiem niż koniec pierwszej — porządek się rozjeżdża');
  }

  // --- 4. Porządek od najnowszych trzyma się przez CAŁY wynik -------------
  /* Sortowanie na jednej stronie to za mało: gdyby stronicowanie tasowało,
     przeglądanie 311 plików pokazywałoby je w losowej kolejności. */
  const wszystko = [];
  for (let i = 0; i < ILE; i += 50) {
    const s = await zapytaj(`limit=50&pomin=${i}`);
    wszystko.push(...s.wyniki.map((w) => w.kiedy));
  }
  const zepsute = wszystko.findIndex((k, i) => i > 0 && k > wszystko[i - 1]);
  console.log(`4. porządek malejący na ${wszystko.length} plikach: `
    + `${zepsute === -1 ? 'zachowany' : `złamany na pozycji ${zepsute}`}`);
  if (zepsute !== -1) fail.push(`porządek od najnowszych łamie się na pozycji ${zepsute}`);

  // --- 5. `pomin` poza końcem oddaje pustkę, nie błąd i nie ostatnią stronę
  const poza = await zapytaj(`limit=24&pomin=${ILE + 100}`);
  console.log(`5. pomin=${ILE + 100}: ${poza.wyniki.length} plików, zostało ${poza.zostalo}`);
  if (poza.wyniki.length) fail.push('`pomin` za końcem listy oddaje pliki — przycisk nie ma jak się zatrzymać');
  if (poza.zostalo !== 0) fail.push(`zostalo=${poza.zostalo} przy pustej stronie`);
  const ujemne = await zapytaj('limit=24&pomin=-50');
  if (ujemne.pomin !== 0) fail.push('ujemne `pomin` nie jest przycinane do zera');

  /* --- 6. NAGŁÓWEK DLA MODELU --------------------------------------------
     Druga połowa skargi: nawet z działającym przyciskiem model dalej pisałby
     „pokazuję tylko część, zawęź wyszukiwanie". Musi wiedzieć, że limit
     dotyczy JEGO, nie człowieka. */
  /* Budujemy nagłówek NAPRAWDĘ — tak, jak zbuduje go przeglądarka po wyniku
     większym niż próbka.

     Dwie wcześniejsze wersje czytały `public/app.js` tekstem. Pierwsza
     dopasowywała dokładną frazę i padła przy przeredagowaniu jej z „PRÓBKA"
     na „LIMIT". Druga szukała już samej zasady, ale i tak padła — gdy
     `naKontekst` przeniosło się do `public/protokol.js`. Reguła w obu
     wypadkach była na miejscu i działała; usterki nie było. */
  const { utworzProtokol } = require(path.join(__dirname, '..', '..', 'public', 'protokol.js'));
  const naglowek = utworzProtokol().naKontekst({
    znaleziono: ILE,
    wyniki: Array.from({ length: 40 }, (_, i) => ({
      nazwa: `3B9A${4000 + i}.CR3`, kiedy: '2026-06-14T19:12:00',
      sciezka: `/Zdjęcia/Mazury 2026/3B9A${4000 + i}.CR3`, aparat: 'Canon EOS R6m2',
    })),
  });
  const maPodzialRol = /DOTYCZY CIEBIE,?\s*NIE UŻYTKOWNIKA/i.test(naglowek);
  const maPrzycisk = /sam dojdzie do ostatniego/i.test(naglowek);
  console.log(`6. nagłówek dla modelu: podział ról ${maPodzialRol ? 'jest' : 'BRAK'}, `
    + `wzmianka o przycisku ${maPrzycisk ? 'jest' : 'BRAK'}`);
  if (!maPodzialRol) fail.push('nagłówek nie mówi modelowi, że próbka ogranicza jego, a nie użytkownika');
  if (!maPrzycisk) fail.push('nagłówek nie wspomina o przycisku „pokaż kolejne"');

  /* Ta sama zasada musi być też w instrukcji STAŁEJ, nie tylko w nagłówku
     doklejanym do wyniku — inaczej model pozna ją dopiero po pierwszym
     zapytaniu. Składamy instrukcje naprawdę: czytanie server.js regexpem
     przestało działać, gdy opisy narzędzi przeniosły się do osobnego
     modułu, choć treść była bez zmian. */
  const { zbudujInstrukcje } = require(path.join(__dirname, '..', '..', 'lib', 'instrukcje-narzedzi.js'));
  const stala = zbudujInstrukcje({
    payload: {}, krotko: false, bezNarzedzi: false,
    archiwum: { ile: () => 100 },
    userWspolrzedne: null,
    procedury: () => [], urzadzenia: () => [], imageProviders: () => [],
    KOD_WLACZONY: false, capabilityText: '',
  }).map((b) => b.content).join('\n');
  if (!/DOTYCZY CIEBIE,?\s*NIE UŻYTKOWNIKA/i.test(stala)) {
    fail.push('instrukcja stała nie zawiera tej samej zasady — model pozna ją dopiero po wyniku');
  }

  /* --- 7. Stan przycisku „pokaż kolejne" ---------------------------------
     Sprawdza to teraz zestaw `widoki-buduja` — wywołaniem, na atrapie DOM-u:
     buduje siatkę, klika przycisk i patrzy, jaki adres poleciał, ile kafelków
     przybyło i czy rozmowa nie została przerysowana.

     Stały tu wcześniej cztery regexpy po `public/app.js` („czy jest napis
     `dalej: {`", „czy jest `pomin=${d.pomin}`"). Padły przy przeniesieniu
     budowniczych do `public/widoki.js`, mimo że przycisk działał bez zmian —
     PIĄTY raz w jednej sesji, gdy test pilnujący brzmienia pliku zgłosił
     usterkę, której nie było. Dlatego nie zostały przestawione na nowy plik,
     tylko zastąpione sprawdzeniem zachowania. */

  fs.rmSync(katalog, { recursive: true, force: true });
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPRZEGLĄDANIE WYNIKÓW OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Instrukcja dla modelu nie może podsuwać mu słownictwa dla użytkownika.

   Marcin, po przeczytaniu zapisów rozmów: „te rozmowy nie są nienaganne i nie
   mają takiego flow, jakbym chciał (…) modele piszą do mnie z odpowiedziami,
   o które nie prosiłem". Zajrzałem w zapisy i połowa winy okazała się moja.

   Cytaty z jego rozmów o zdjęciach psa i o Mazurach:

     „Wszystkie te zdjęcia mają `swiatloPrzyblizone: true`"
     „użytkownik może użyć przycisku »pokaż kolejne« pod miniaturami"
     „do takich wniosków służy polecenie grupowania (`grupuj=aparat`)"
     „Microsoft Graph nie czyta metadanych z RAW-ów"
     „To moja wiedza na podstawie wyników z archiwum"

   To nie są halucynacje. To są ZDANIA Z MOJEGO PROMPTU, oddane człowiekowi,
   który zapytał o psa. Każda naprawa dokładała modelowi wyjaśnienie, jak
   działa system — a model uczciwie przekazywał je dalej. Nazwy pól, składnia
   filtrów, nazwa panelu i cudza firma w jednym akapicie, plus mówienie
   o rozmówcy w trzeciej osobie, bo tak brzmiały instrukcje.

   Ten zestaw pilnuje dwóch rzeczy naraz:

     1. że reguła rejestru („JAK ODPOWIADASZ") w ogóle jest i stoi PRZED
        opisami narzędzi — bo instrukcja czytana później nie unieważnia
        wcześniejszej,
     2. że instrukcje narzędzi nie zawierają gotowych zwrotów do recytacji.

   Punkt 2 jest z natury przybliżony: nie da się sprawdzić, co model powie.
   Da się sprawdzić, czego mu nie podsuwamy — i to jest jedyna część tego
   problemu, nad którą mamy władzę.
*/
const fs = require('node:fs');
const path = require('node:path');

const fail = [];
const KORZEN = path.join(__dirname, '..', '..');
const serwer = fs.readFileSync(path.join(KORZEN, 'server.js'), 'utf8');

/* --- 1. Reguła rejestru istnieje i jest pierwsza ------------------------- */
const iRejestr = serwer.indexOf('JAK ODPOWIADASZ');
const iArchiwum = serwer.indexOf('NARZĘDZIE — ARCHIWUM MATERIAŁU');
console.log(`1. reguła „JAK ODPOWIADASZ": ${iRejestr >= 0 ? `pozycja ${iRejestr}` : 'BRAK'}, `
  + `opis archiwum: pozycja ${iArchiwum}`);
if (iRejestr < 0) {
  fail.push('brak reguły „JAK ODPOWIADASZ" — nic nie oddziela wiedzy o mechanice '
    + 'od tego, co model mówi użytkownikowi');
} else if (iArchiwum >= 0 && iRejestr > iArchiwum) {
  fail.push('reguła rejestru stoi PO opisie archiwum — ma iść przed nim, '
    + 'bo dotyczy wszystkich narzędzi');
}

/* Co reguła musi obejmować. Każda pozycja odpowiada innemu cytatowi
   z prawdziwej rozmowy Marcina. */
const WYMAGANE = [
  [/nazw pól/i, 'zakaz wymieniania nazw pól („swiatloPrzyblizone: true")'],
  [/składni filtrów|grupuj=, folder=/i, 'zakaz cytowania składni filtrów („grupuj=aparat")'],
  [/BEZPOŚREDNIO|Nigdy „użytkownik może"/i, 'zwracanie się wprost, nie w trzeciej osobie'],
  [/Nie wypisuj list plików/i, 'zakaz wypisywania list plików mimo pokazanych miniatur'],
  [/firm, od których/i, 'zakaz wymieniania cudzych firm („Microsoft Graph")'],
  [/nie opowiadaj, co robisz/i, 'zakaz komentowania własnej pracy („to moja wiedza…")'],
];
for (const [wzor, opis] of WYMAGANE) {
  if (!wzor.test(serwer)) fail.push(`reguła rejestru nie obejmuje: ${opis}`);
}
console.log(`   punktów reguły obecnych: ${WYMAGANE.filter(([w]) => w.test(serwer)).length}`
  + `/${WYMAGANE.length}`);

/* --- 2. Instrukcje nie podsuwają gotowych zwrotów ------------------------
   Sprawdzamy TYLKO treść wysyłaną do modelu, nie komentarze w kodzie —
   komentarz opisujący usterkę ma prawo cytować ją dosłownie i właśnie po to
   istnieje. Bierzemy więc literały tekstowe z bloków `content:`. */
function tekstyDlaModelu(zrodlo) {
  const out = [];
  const re = /content:\s*((?:'[^']*'|`[^`]*`|\s*\+\s*)+)/g;
  let m;
  while ((m = re.exec(zrodlo))) out.push(m[1]);
  return out.join('\n');
}
const doModelu = tekstyDlaModelu(serwer);

const ZAKAZANE = [
  [/Microsoft Graph/, 'nazwa cudzej firmy — model recytował ją użytkownikowi'],
  [/Dociągnij dane z plików/, 'nazwa przycisku w panelu — model odsyłał do niej w odpowiedzi'],
  [/Plenerze →/, 'ścieżka po interfejsie w instrukcji dla modelu'],
  [/pokaż kolejne/, 'nazwa przycisku — model tłumaczył użytkownikowi, jak przewijać wyniki'],
];
for (const [wzor, opis] of ZAKAZANE) {
  const jest = wzor.test(doModelu);
  console.log(`2. ${jest ? 'ŹLE' : 'ok '} — ${opis}`);
  if (jest) {
    fail.push(`instrukcja dla modelu zawiera „${wzor.source}": ${opis}. `
      + 'Opisz ZACHOWANIE, nie podawaj gotowego zwrotu.');
  }
}

/* --- 3. To samo po stronie klienta --------------------------------------
   Nagłówek doklejany do wyniku archiwum trafia do modelu tą samą drogą
   i pierwsza wersja zawierała dokładnie ten sam błąd. */
const app = fs.readFileSync(path.join(KORZEN, 'public', 'app.js'), 'utf8');
const iNaglowek = app.indexOf('LIMIT DOTYCZY CIEBIE');
const fragment = iNaglowek >= 0 ? app.slice(iNaglowek, iNaglowek + 700) : '';
console.log(`3. nagłówek wyniku archiwum: ${iNaglowek >= 0 ? 'jest' : 'BRAK'}`);
if (iNaglowek < 0) {
  fail.push('brak nagłówka wyjaśniającego modelowi, że limit dotyczy jego, nie użytkownika');
} else if (/pokaż kolejne/.test(fragment)) {
  fail.push('nagłówek wyniku archiwum podaje modelowi nazwę przycisku — '
    + 'a on ją potem powtarza użytkownikowi');
}

/* --- 4. Rozmiar instrukcji archiwum --------------------------------------
   Nie jako sztywny limit, tylko jako czujnik: ta sekcja rosła przy każdej
   naprawie i to jej rozrost wyprodukował wycieki. Gdy znów zacznie puchnąć,
   niech ktoś na to spojrzy, zamiast dowiedzieć się z zapisu rozmowy. */
const start = serwer.indexOf('NARZĘDZIE — ARCHIWUM MATERIAŁU');
const koniec = serwer.indexOf('});', start);
const rozmiar = start >= 0 ? serwer.slice(start, koniec).length : 0;
const SUFIT = 6000;
console.log(`4. instrukcja archiwum: ${rozmiar} znaków (sufit ostrzegawczy ${SUFIT})`);
if (rozmiar > SUFIT) {
  fail.push(`instrukcja archiwum urosła do ${rozmiar} znaków. Nie jest to samo w sobie `
    + 'usterką, ale każdy poprzedni przyrost skończył się cytowaniem jej użytkownikowi '
    + '— przejrzyj, co da się zamienić na zachowanie zamiast na kolejny akapit.');
}

console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nREJESTR ODPOWIEDZI OK');
process.exit(fail.length ? 1 : 0);

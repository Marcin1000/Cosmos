/* „Jakiejakiejakie sąjakie są największejakie są największe…"

   Marcin przysłał zrzut z trybu głosowego. Jego pytanie brzmiało
   „Jakie są największe atrakcje na Majorce". Na ekranie stało to:

     Jakiejakiejakie sąjakie są największejakie są największejakie są
     największejakie są największejakie są największe atrakcjejakie są
     największe atrakcjejakie są największe atrakcjejakie są największe
     atrakcje najakie są największe atrakcje na Majorce

   Model dostał TO — i uczciwie napisał w toku myślenia „Seems garbled due
   to repetition". Odpowiedź wyszła dobra tylko dlatego, że domyślił się
   pytania. Przy dłuższym albo mniej oczywistym zdaniu nie miałby czego się
   domyślić.

   PRZYCZYNA NIE LEŻY W ROZPOZNAWANIU MOWY. Chrome na Androidzie nie
   obsługuje `continuous` — kończy sesję po każdej wypowiedzi i po każdej
   ciszy. Wznowiona sesja rozpoznaje od nowa audio, które częściowo już
   słyszeliśmy, więc dostajemy coraz dłuższe wersje tego samego zdania.
   Kod robił wtedy `voiceHeard += transcript` i sklejał je wszystkie, gołym
   plusem — stąd brak spacji między powtórzeniami.

   Zestaw odtwarza dokładnie tę sekwencję i wymaga, żeby na końcu stało
   jedno czyste zdanie. Sprawdza też stronę odwrotną, ważniejszą: scalanie
   nie może zjadać zdań, które naprawdę są różne, ani powtórzeń, które
   człowiek wypowiedział celowo.
*/
const path = require('node:path');

const { utworzMowe } = require(path.join(__dirname, '..', '..', 'public', 'mowa.js'));

const fail = [];
const WAKE_RE = /\b(hej|hey|ok(?:ej)?)[\s,.!]*(kosmos|cosmos)/i;
const M = utworzMowe({ WAKE_RE });

/** Przepuść ciąg rozpoznań tak, jak robi to pętla `onresult`. */
const zloz = (fragmenty) => fragmenty.reduce((acc, f) => M.doklej(acc, f), '');

/* --- 1. DOKŁADNIE TO, CO ZOBACZYŁ MARCIN -------------------------------
   Kolejne wznowienia sesji na Androidzie: każde oddaje dłuższą wersję. */
{
  const zAndroida = [
    'Jakie',
    'jakie są',
    'jakie są największe',
    'jakie są największe',
    'jakie są największe',
    'jakie są największe atrakcje',
    'jakie są największe atrakcje',
    'jakie są największe atrakcje na',
    'jakie są największe atrakcje na Majorce',
  ];
  const wynik = zloz(zAndroida);
  console.log(`1. dziewięć wznowień → „${wynik}"`);
  if (!/^jakie są największe atrakcje na Majorce$/i.test(wynik)) {
    fail.push(`z ciągu wznowień wyszło „${wynik}", a ma wyjść jedno zdanie `
      + '„jakie są największe atrakcje na Majorce"');
  }
  // Żadne słowo nie może wystąpić dwa razy pod rząd.
  const slowa = wynik.toLowerCase().split(/\s+/);
  const podwojne = slowa.filter((w, i) => i > 0 && w === slowa[i - 1]);
  if (podwojne.length) fail.push(`powtórzone słowa obok siebie: ${podwojne.join(', ')}`);
}

/* --- 2. Rozpoznanie poprawiające SIĘ w miejscu -------------------------
   Zwykły przebieg jednej sesji: ten sam fragment wraca dokładniejszy. */
{
  const wynik = zloz(['pokaz', 'pokaż zdjęcia', 'pokaż zdjęcia z Mazur']);
  console.log(`2. poprawianie w miejscu → „${wynik}"`);
  if (wynik !== 'pokaż zdjęcia z Mazur') {
    fail.push(`poprawiane rozpoznanie dało „${wynik}" zamiast „pokaż zdjęcia z Mazur"`);
  }
}

/* --- 3. Zakładka na kilku słowach -------------------------------------
   Sesja urwała się w środku zdania, nowa złapała je od trzeciego słowa. */
{
  const wynik = M.doklej('zaplanuj zdjęcia na', 'zdjęcia na Majorce we wrześniu');
  console.log(`3. zakładka trzech słów → „${wynik}"`);
  if (wynik !== 'zaplanuj zdjęcia na Majorce we wrześniu') {
    fail.push(`scalanie po zakładce dało „${wynik}"`);
  }
}

/* --- 4. CZEGO SCALANIE ZJEŚĆ NIE MOŻE ---------------------------------
   Strona odwrotna i ważniejsza. Gdyby `doklej` był zbyt gorliwy, gubiłby
   treść — a to jest gorsze niż powtórzenie, bo niewidoczne. */
{
  const przypadki = [
    [['dzień dobry', 'jak leci'], 'dzień dobry jak leci', 'dwa różne zdania'],
    [['pokaż zdjęcia', 'pokaż filmy'], 'pokaż zdjęcia pokaż filmy',
      'dwa polecenia zaczynające się tak samo'],
    [['tak', 'tak'], 'tak', 'to samo słowo dwa razy — to jest powtórzenie rozpoznania'],
    [['nie nie nie', 'zdecydowanie nie'], 'nie nie nie zdecydowanie nie',
      'celowe powtórzenie w środku zdania zostaje'],
    [['', 'sam początek'], 'sam początek', 'pusty początek'],
    [['sam koniec', ''], 'sam koniec', 'pusty dokładany fragment'],
  ];
  for (const [fragmenty, oczek, opis] of przypadki) {
    const got = zloz(fragmenty);
    const ok = got === oczek;
    console.log(`4. ${ok ? 'ok ' : 'ŹLE'} — ${opis}: „${got}"`);
    if (!ok) fail.push(`${opis}: „${got}" zamiast „${oczek}"`);
  }
}

/* Zakładka liczona w SŁOWACH, nie w znakach. Gdyby liczyć znaki,
   „na Majorce" i „nam" miałyby wspólne „na" i zdanie by się rozjechało. */
{
  const wynik = M.doklej('lecimy na Majorkę', 'nam się to opłaci');
  console.log(`   zakładka pozorna na „na": „${wynik}"`);
  if (wynik !== 'lecimy na Majorkę nam się to opłaci') {
    fail.push(`fałszywa zakładka na cząstce słowa: „${wynik}"`);
  }
}

/* --- 5. Słowo budzące wypada, także powtórzone ------------------------- */
{
  const przypadki = [
    ['Hej Kosmos co widzisz', 'co widzisz'],
    ['Hej kosmosHej kosmos co widzisz', 'co widzisz'],
    ['hej, kosmos! pokaż zdjęcia', 'pokaż zdjęcia'],
    ['Hej co słychać', 'co słychać'],
    /* A tego ruszyć NIE WOLNO: pytanie o kosmos, bez słowa budzącego.
       Sprzątanie sierot po wyciętej frazie działa tylko wtedy, gdy fraza
       naprawdę w zdaniu była — inaczej zjadłoby pierwsze słowo. */
    ['Kosmos jest wielki, prawda?', 'Kosmos jest wielki, prawda?'],
    ['kosmos pokaż zdjęcia', 'kosmos pokaż zdjęcia'],
  ];
  for (const [wejscie, oczek] of przypadki) {
    const got = M.bezSlowaBudzacego(wejscie).trim();
    const ok = got.toLowerCase() === oczek.toLowerCase();
    console.log(`5. ${ok ? 'ok ' : 'ŹLE'} — „${wejscie}" → „${got}"`);
    if (!ok) fail.push(`słowo budzące: „${wejscie}" → „${got}" zamiast „${oczek}"`);
  }
}

/* --- 6. Cosmos nie odpowiada na własne słowa --------------------------- */
{
  const odpowiedz = 'Największe atrakcje na Majorce to katedra La Seu i zamek Bellver';
  const echo = 'największe atrakcje na majorce to katedra la seu i zamek bellver';
  const inne = 'a jakie są plaże na Majorce';
  console.log(`6. echo własnej wypowiedzi wykryte: ${M.toSamoZdanie(echo, odpowiedz)}, `
    + `nowe pytanie wykryte jako echo: ${M.toSamoZdanie(inne, odpowiedz)}`);
  if (!M.toSamoZdanie(echo, odpowiedz)) {
    fail.push('własna odpowiedź wróciłaby jako pytanie użytkownika');
  }
  if (M.toSamoZdanie(inne, odpowiedz)) {
    fail.push('nowe pytanie zostało wzięte za echo i przepadłoby bez odpowiedzi');
  }
}

console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nMOWA NIE DUBLUJE OK');
process.exit(fail.length ? 1 : 0);

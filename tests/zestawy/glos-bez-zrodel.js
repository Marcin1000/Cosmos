/* Asystent głosowy nie mówi, skąd ma informacje.

   Zgłoszenie Marcina: „W asystencie głosowym nie musi mówić o źródłach
   informacji”. Po pierwszej poprawce agencja zebrała 41 realistycznych
   odpowiedzi w stylu Nemotrona, Qwena, Claude’a i gpt – lektor czytał źródła
   w 22 z nich („Źródła. IMGW.”, „Według IMGW…”, „[źródło: Instrukcja.pdf]”),
   a zwykłe zdanie „Z sieci rybackich wyciągnięto…” traciło początek.

   Funkcja `bezZrodel` (public/protokol.js) wołana wprost w Node:
     1. każda postać źródła znika, a treść zostaje,
     2. zwykłe zdania z „według”, „z sieci”, „zgodnie z” zostają nietknięte.
*/
const { utworzProtokol } = require('../../public/protokol.js');

const { bezZrodel } = utworzProtokol();
const fail = [];

// [nazwa, wejście, czego NIE może być, co MUSI zostać]
const PRZYPADKI = [
  ['**Źródła:** z listą', 'Jutro w Krakowie będzie słonecznie, do 21 °C.\n\n**Źródła:**\n- [IMGW](https://imgw.pl/prognoza)\n- [Onet Pogoda](https://pogoda.onet.pl)', /IMGW|Onet|http/, /słonecznie/],
  ['Źródła bez dwukropka', 'Jutro będzie słonecznie.\n\nŹródła\n1. imgw.pl\n2. meteo.pl', /imgw|meteo/i, /słonecznie/],
  ['### Źródła', 'Jutro pada.\n\n### Źródła\n- meteo.pl\n- yr.no', /meteo|yr\.no/, /pada/],
  ['*Źródło:* kursywą', 'Wschód słońca jutro o 6:41.\n\n*Źródło: timeanddate.com*', /timeanddate|Źródło/, /6:41/],
  ['długi myślnik + Źródła:', 'Wschód o 6:41.\n\n\u2014 Źródła: timeanddate.com, sunrise-sunset.org', /timeanddate|sunrise/, /6:41/],
  ['Bibliografia', 'Jutro pada.\n\nBibliografia:\n- meteo.pl', /meteo/, /pada/],
  ['Źródła w linii', 'Jutro pada. Źródła: meteo.pl, yr.no.', /meteo|yr/, /pada/],
  ['– źródło: w środku linii', 'Jutro 18 stopni – źródło: pogoda.onet.pl', /onet|źródło/, /18 stopni/],
  ['Według wyników wyszukiwania', 'Według wyników wyszukiwania, zamek na Wawelu jest otwarty do 17:00.', /Według/, /^Zamek/],
  ['Według strony x.pl', 'Według strony wawel.krakow.pl zamek jest otwarty do 17:00.', /Według|wawel\.krakow/, /otwarty/],
  ['Według serwisu x.pl,', 'Według serwisu pogoda.onet.pl, jutro będzie słonecznie.', /Według|onet/, /^Jutro będzie słonecznie/],
  ['Według IMGW', 'Według IMGW jutro spadnie do 10 mm deszczu.', /Według IMGW/, /deszczu/],
  ['Znalazłem w sieci', 'Znalazłem w sieci, że muzeum jest nieczynne w poniedziałki.', /Znalazłem w sieci/, /nieczynne/],
  ['Z informacji na stronie', 'Z informacji na stronie muzeum wynika, że bilet kosztuje 30 zł.', /stronie muzeum/, /30 zł/],
  ['(źródło: …)', 'Bilet kosztuje 30 zł (źródło: mnk.pl).', /źródło|mnk/, /30/],
  ['(domena)', 'Bilet kosztuje 30 zł (pogoda.onet.pl).', /onet/, /30 zł/],
  ['[źródło: plik] – format bazy wiedzy', 'Obiektyw ma mocowanie RF [źródło: Instrukcja R6.pdf].', /źródło|Instrukcja/, /mocowanie RF/],
  ['[Źródło: notatki]', 'Obiektyw ma mocowanie RF. [Źródło: notatki]', /Źródło|notatki/, /mocowanie RF/],
  ['[domena]', 'Jutro pada [pogoda.onet.pl].', /onet/, /Jutro pada/],
  ['przypis [^1]', 'Szczyt ma 1987 m[^1].', /\^1/, /1987/],
  ['przypis ¹', 'Szczyt ma 1987 m n.p.m.¹', /¹/, /1987/],
  ['EN **Sources:**', 'It will be sunny tomorrow.\n\n**Sources:**\n- [BBC Weather](https://bbc.co.uk/weather)', /BBC|http/, /sunny/],
  ['EN According to the search results', 'According to the search results, the museum opens at 9 am.', /According/, /^The museum/],
  ['EN According to the Met Office', 'According to the Met Office, it will rain.', /Met Office/, /rain/],
  ['EN Per the official site', 'Per the official site, tickets cost £20.', /official site/, /tickets/i],
  ['EN I found online', 'I found online that the trail is closed.', /I found online/, /closed/],
  ['EN Source: w linii', 'Sunrise is at 6:41.\nSource: timeanddate.com', /timeanddate/, /6:41/],
  ['EN References', 'Sunrise is at 6:41.\n\nReferences:\n1. timeanddate.com', /timeanddate/, /6:41/],
];

// Zwykłe zdania: bez zmian.
const ZOSTAJE = [
  'Według ciebie to dobry pomysł, więc spróbujmy.',
  'Z sieci rybackich wyciągnięto dwa szczupaki, a potem łowiliśmy dalej.',
  'Zgodnie z planem wyjeżdżamy o 5:00, a na miejscu jesteśmy o 7:00.',
  'Z internetem w schronisku bywa różnie, weź mapę offline.',
  'Na podstawie twoich zdjęć widzę, że lubisz szerokie kadry.',
  'Użyj filtra ND (według mnie ND8 wystarczy).',
  'Via ferrata: trasa ma trzy odcinki.',
  'Ze strony wschodniej światło jest lepsze, więc ustaw się tam.',
  'Z wyniku meczu 2:1 wynika, że Polska awansowała, więc gramy dalej.',
  'Tablica [A] i tablica [B] różnią się kolorem.',
  'Sprawdź [komunikat TPN](https://tpn.pl) przed wyjściem.',
  'Jutro pada, a według prognozy ICM w niedzielę się przejaśni.',
  'According to plan, we leave at five.',
  'Based on your photos, you like wide shots.',
  'Based on a web of lies, the story unravels, and then ends.',
];

for (const [nazwa, wej, nie, musi] of PRZYPADKI) {
  const wyj = bezZrodel(wej).trim();
  const dobrze = !nie.test(wyj) && musi.test(wyj);
  console.log(`${dobrze ? 'OK ' : 'ŹLE'} ${nazwa}: „${wyj.replace(/\n/g, ' ⏎ ')}”`);
  if (!dobrze) fail.push(`${nazwa}: „${wyj}”`);
}
for (const zdanie of ZOSTAJE) {
  const wyj = bezZrodel(zdanie);
  const dobrze = wyj === zdanie;
  console.log(`${dobrze ? 'OK ' : 'ŹLE'} zostaje: „${zdanie}”${dobrze ? '' : ` → „${wyj}”`}`);
  if (!dobrze) fail.push(`zwykłe zdanie zmienione: „${zdanie}” → „${wyj}”`);
}

console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : `\nGŁOS BEZ ŹRÓDEŁ OK (${PRZYPADKI.length} postaci źródeł, ${ZOSTAJE.length} zwykłych zdań)`);
process.exit(fail.length ? 1 : 0);

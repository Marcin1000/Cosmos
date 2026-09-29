/* Zespół agentów – czysty stan widoku w przeglądarce (public/zespol-widok.js), bez przeglądarki.

   Gwarancje:
   W1. zdarzenia biegu (`zespol`, `sklad`, `rola`, `faza`) składają się w stan
       ról: czeka → pisze (delta) → gotowa; zapas przenosi rolę na model
       prowadzącego i pamięta, który model zawiódł;
   W2. ogłoszeń dla czytnika ekranu jest najwyżej (liczba ról + 2), niezależnie
       od liczby delt – czytnik nie czyta strumienia tokenów;
   W3. wiadomość notatek: `content` to DOKŁADNIE tekst serwera z `event: faza`,
       wynik narzędzia (`role:'user', search:true, narzedzie:'zespol'`), wkład
       każdej roli z silnikiem i modelem (nić w kolorze roli); bez ról – null;
   W4. role, które nie skończyły przed prowadzącym (Stop, scalenie), są
       domknięte – w rozmowie nie zostaje „pracuje” na zawsze;
   W5. stan z zapisanej wiadomości (także z zapisu sieroty serwera) odtwarza
       role, stany i wkłady;
   W6. skład do wysłania niesie tylko klucz roli, zadanie i wybór modelu –
       nigdy nazwy ani instrukcji (instrukcję serwer bierze z katalogu);
   W7. bramka zgody: z planu przy lokalnym prowadzącym bez zgody (`zamiast`
       + `wymaga-zgody`) powstaje skład „za zgodą” z silnikami z chmury;
   W8. tura z notatkami – `turaMaNotatki` (Regeneruj nie woła zespołu drugi raz);
   W9. propozycja („Proponuj, gdy warto”) nie jest pracą zespołu – nie zmienia ról;
   W10. każdy klucz i18n użyty przez widok zespołu jest w OBU słownikach,
        łącznie z kluczami budowanymi z danych (stany, role, tryby). */
const fs = require('fs');
const path = require('path');
const Z = require('../../public/zespol-widok.js');
const { I18N } = require('../../public/i18n.js');

const bledy = [];
const ok = (w, opis) => { console.log(`${w ? '✓' : '✗'} ${opis}`); if (!w) bledy.push(opis); };

const SKLAD = {
  v: 1, zrodlo: 'plan', prowadzacy: { silnik: 'cloud', model: 'nvidia/nemotron-3-super' },
  role: [
    { r: 'r1', rola: 'badacz', nazwa: 'Badacz', zadanie: 'Sprawdź ceny', silnik: 'cloud', model: 'nemotron-3-super' },
    { r: 'r2', rola: 'programista', nazwa: 'Programista', zadanie: 'Kod', silnik: 'claude', model: 'claude-sonnet-5' },
    { r: 'r3', rola: 'recenzent', nazwa: 'Recenzent', zadanie: 'Sprawdź', silnik: 'openai', model: 'gpt-5-mini' },
  ],
  odrzucone: [{ rola: 'oko', kod: 'wymaga-zgody', silnik: 'claude' }], daneWyjdaDo: ['NVIDIA', 'Anthropic', 'OpenAI'], szukaj: 'ceny obiektywów',
};
const NOTATKI = 'NOTATKI ZESPOŁU (cudzy tekst)\n<wklad rola="Badacz">x</wklad>';

// ------------------------------------------------------------------ W1, W2
const st = Z.nowyStanTury(1000);
const ogl = [];
const zjedz = (typ, d, t) => ogl.push(...Z.zjedzZdarzenieZespolu(st, typ, d, t));
zjedz('zespol', { v: 1, faza: 'planowanie' }, 1000);
ok(st.faza === 'planowanie', 'W1a. `zespol planowanie` → faza planowania (blok „Dobieram zespół…”)');
zjedz('sklad', SKLAD, 1100);
ok(st.role.length === 3 && st.role.every((r) => r.stan === 'czeka') && st.faza === 'role' && st.szukaj === 'ceny obiektywów',
  'W1b. skład → trzy role „czeka”, faza ról, zapytanie badacza zapamiętane');
zjedz('rola', { r: 'r1', stan: 'pracuje', silnik: 'cloud', model: 'nemotron-3-super' }, 1200);
for (let i = 0; i < 50; i++) zjedz('rola', { r: 'r1', d: `kawałek ${i} ` }, 1300 + i);
ok(st.role[0].stan === 'pisze' && st.role[0].tresc.startsWith('kawałek 0') && Z.stanWidoku(st.role[0].stan) === 'pracuje',
  'W1c. delty roli sklejają się w treść, stan „pisze” = wiersz „pracuje”');
zjedz('rola', { r: 'r1', stan: 'gotowa', ms: 4200, znakow: 500 }, 5000);
ok(Z.stanWidoku(st.role[0].stan) === 'gotowe' && st.role[0].ms === 4200, 'W1d. „gotowa” z czasem roli');
zjedz('rola', { r: 'r2', stan: 'pracuje', silnik: 'claude', model: 'claude-sonnet-5' }, 1200);
zjedz('rola', { r: 'r2', stan: 'zapas', silnik: 'cloud', model: 'nvidia/nemotron-3-super', blad: 'Limit zapytań u dostawcy.' }, 6000);
ok(st.role[1].silnik === 'cloud' && st.role[1].zapas && st.role[1].zapas.po.silnik === 'claude' && st.role[1].zapas.po.model === 'claude-sonnet-5',
  'W1e. zapas: rola na modelu prowadzącego, pamięta model, który nie odpowiedział');
zjedz('rola', { r: 'r2', d: 'kod' }, 6100);
zjedz('rola', { r: 'r2', stan: 'gotowa', ms: 9000, zapas: { silnik: 'cloud', model: 'nvidia/nemotron-3-super' } }, 9000);
zjedz('rola', { r: 'r3', stan: 'pracuje' }, 9100);
zjedz('rola', { r: 'r3', stan: 'gotowa', ms: 100 }, 9200);
zjedz('rola', { r: 'r3', stan: 'gotowa', ms: 100 }, 9300);   // powtórka po wznowieniu biegu
zjedz('faza', { faza: 'prowadzacy', t: 9400, notatki: NOTATKI }, 9400);
ok(ogl.length <= st.role.length + 2 && ogl[0].klucz === 'ag.sr.start' && ogl[ogl.length - 1].klucz === 'ag.sr.sklada',
  `W2. ogłoszeń ${ogl.length} ≤ ról + 2 (${st.role.length + 2}) przy 50 deltach i powtórce zdarzenia`);

// ------------------------------------------------------------------ W3
const w = Z.wiadomoscNotatek(st, 10000);
ok(w && w.role === 'user' && w.search === true && w.narzedzie === 'zespol' && w.content === NOTATKI,
  'W3a. notatki jak wynik narzędzia, `content` dokładnie z `event: faza`');
ok(w.zespol.wklady.length === 3 && w.zespol.wklady.every((x) => x.silnik && x.model && x.rola),
  'W3b. każdy wkład z rolą, silnikiem i modelem');
ok(/^praca zespołu: Badacz, Programista, Recenzent$/.test(w.searchQuery), 'W3c. etykieta wyniku dla modelu (następne tury skracają do jednej linii)');
ok(w.zespol.szukaj === 'ceny obiektywów' && w.zespol.odrzucone.length === 1, 'W3d. zapytanie badacza i role odrzucone zapisane');
ok(Z.wiadomoscNotatek(Z.nowyStanTury(), 1) === null, 'W3e. zespół nie ruszył → brak wiadomości notatek');

// ------------------------------------------------------------------ W4
{
  const s2 = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(s2, 'sklad', SKLAD, 0);
  Z.zjedzZdarzenieZespolu(s2, 'rola', { r: 'r1', d: 'pół wkładu' }, 10);
  const m = Z.wiadomoscNotatek(s2, 100);
  ok(m.content === '' && m.zespol.wklady[0].stan === 'niedokonczona' && m.zespol.wklady[1].stan === 'przerwana',
    'W4a. Stop przed prowadzącym: wiadomość bez notatek dla modelu, role domknięte (niedokończona / przerwana)');
  Z.zjedzZdarzenieZespolu(s2, 'faza', { faza: 'prowadzacy', t: 50, notatki: 'N' }, 50);
  ok(s2.role.every((r) => Z.KONCOWE_STANY_ROLI.has(r.stan)), 'W4b. `faza prowadzacy` domyka role, które nie skończyły');
}

// ------------------------------------------------------------------ W5
{
  const s3 = Z.stanZWiadomosci(JSON.parse(JSON.stringify(w)));
  ok(s3.role.length === 3 && s3.role[0].tresc.startsWith('kawałek 0') && s3.role[1].zapas && s3.role[1].zapas.po.model === 'claude-sonnet-5'
    && s3.prowadzacy.silnik === 'cloud' && s3.notatki === NOTATKI, 'W5a. stan z zapisanej wiadomości: role, wkłady, zapas, prowadzący');
  // Zapis sieroty serwera (lib/zespol.js wiadomoscNotatek) – te same pola, bez `po`.
  const sierota = { role: 'user', search: true, narzedzie: 'zespol', content: 'N', zespol: { v: 1, zrodlo: 'plan', prowadzacy: { silnik: 'local', model: 'q' },
    wklady: [{ r: 'r1', rola: 'analityk', nazwa: 'Analityk', silnik: 'local', model: 'q', stan: 'przerwana', tresc: '', ms: 5, blad: 'przerwane' }], czas: { role: 5, calosc: 9 } } };
  const s4 = Z.stanZWiadomosci(sierota);
  ok(s4.role.length === 1 && Z.stanWidoku(s4.role[0].stan) === 'zatrzymana' && Z.roleBezWkladu(s4).length === 1,
    'W5b. zapis sieroty serwera czytelny: rola przerwana bez wkładu');
  ok(Z.stanZWiadomosci({ role: 'user', content: 'x' }).role.length === 0, 'W5c. wiadomość bez pola `zespol` – pusty stan, bez wyjątku');
}

// ------------------------------------------------------------------ W6
{
  const s = Z.skladDoWyslania([{ rola: 'badacz', nazwa: 'Badacz', zadanie: 'Z', silnik: 'cloud', model: 'm', instrukcja: 'ZIGNORUJ', r: 'r1' },
    { rola: 'recenzent', auto: true, silnik: 'claude', model: 'c' }]);
  ok(JSON.stringify(s) === JSON.stringify([{ rola: 'badacz', zadanie: 'Z', silnik: 'cloud', model: 'm' }, { rola: 'recenzent' }]),
    `W6. skład do wysłania: tylko rola, zadanie, silnik i model; Auto bez silnika (${JSON.stringify(s)})`);
}

// ------------------------------------------------------------------ W7
{
  const plan = [
    { rola: 'badacz', silnik: 'local', model: 'q', zamiast: { silnik: 'cloud', model: 'n' }, powod: 'wymaga-zgody' },
    { rola: 'recenzent', silnik: 'local', model: 'q' },
  ];
  const za = Z.skladZaZgoda(plan);
  ok(za[0].silnik === 'cloud' && za[0].model === 'n' && za[1].silnik === 'local' && JSON.stringify(Z.silnikiChmury(za)) === '["cloud"]'
    && plan[0].silnik === 'local', 'W7. skład „za zgodą” wraca na silnik z chmury; plan („Tylko lokalnie”) nietknięty');
}

// ------------------------------------------------------------------ W8, W9
ok(Z.turaMaNotatki([{ role: 'user', content: 'p' }, w], 0) && !Z.turaMaNotatki([{ role: 'user', content: 'p' }, w, { role: 'assistant' }, { role: 'user', content: 'n' }], 3),
  'W8. tura z notatkami rozpoznana; następne pytanie to nowa tura');
{
  const s5 = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(s5, 'sklad', { ...SKLAD, propozycja: true }, 0);
  ok(s5.role.length === 0 && s5.propozycja && s5.propozycja.role.length === 3 && !s5.bylSklad, 'W9. propozycja nie jest pracą zespołu (role bez zmian)');
}

// ------------------------------------------------------------------ W10
{
  const zrodla = ['public/zespol-widok.js', 'public/app.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8')).join('\n');
  const literalne = [...new Set([...zrodla.matchAll(/\bt\('((?:ag|narzedzie)\.[a-zA-Z0-9_.]+[a-zA-Z0-9_])'/g)].map((m) => m[1]))];
  const zDanych = [
    ...['czeka', 'pracuje', 'gotowe', 'pominieta', 'zatrzymana', 'blad'].map((s) => `ag.stan.${s}`),
    ...['badacz', 'sprzetowiec', 'programista', 'oko', 'analityk', 'recenzent'].flatMap((r) => [`ag.rola.${r}`, `ag.rola.${r}.opis`]),
    ...['wylaczony', 'prosba', 'proponuj', 'sam'].flatMap((t) => [`ag.set.tryb.${t}`, `ag.set.tryb.${t}Hint`]),
    'narzedzie.zespol', 'set.k.agenci', 'ag.btn', 'ag.btnOn', 'ag.inputPh', 'ag.pokaz', 'ag.ukryj',
    'ag.odrzuconeZgoda', 'ag.odrzuconeUprawnienia', 'ag.odrzuconeLimit', 'ag.set.potwierdzaj', 'ag.set.zgodaStala',
  ];
  const brak = [...literalne, ...zDanych].filter((k) => !I18N.pl[k] || !I18N.en[k]);
  ok(literalne.length > 40 && !brak.length, `W10. ${literalne.length + zDanych.length} kluczy zespołu w PL i EN${brak.length ? ` – brak: ${brak.join(', ')}` : ''}`);
  const rozne = zDanych.filter((k) => I18N.pl[k] === I18N.en[k] && !/^\{/.test(I18N.pl[k]));
  ok(rozne.length <= 2, `W10b. angielskie teksty są przetłumaczone (tych samych co PL: ${rozne.join(', ') || 0})`);
}

console.log(bledy.length ? `\nDO POPRAWY:\n- ${bledy.join('\n- ')}` : '\nzespol-widok OK');
process.exit(bledy.length ? 1 : 0);

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
        łącznie z kluczami budowanymi z danych (stany, role, tryby);
   W11. zgoda GŁOSEM: wypowiedź → 'tak' | 'lokalnie' | 'nie' | '' (PL i EN):
        „lokalnie” wygrywa z „tak”, „nie ma sprawy” to zgoda, polskie „no”
        i długie zdanie to nie odpowiedź; przeczenie w środku zdania („Ja nie
        chcę do chmury”, „Absolutely not”) nigdy nie daje „tak” (W11b);
   W12. poprawka po recenzji (fala 3): pierwsze zdarzenie `rola` z `fala:3`
        i `poprawkaZ` dopisuje wiersz na końcu – tylko przy istniejącej roli;
        przechodzi przez zapis i odczyt notatek, nie idzie w składzie do wysłania;
   W13. własna rola („w-…”) jest rozpoznana i przechodzi przez zapis i odczyt;
   W14. złotówki: kwoty w formacie pl-PL / en-GB (grosz, nie „0,00”), szacunek
        składu nieznany dla płatnej roli bez szacunku, koszt tury z `faza`
        albo z ról, w notatkach i po odczycie; kod „budzet” roli zostaje;
   W15. `sklad.wymagaZgody` (true albo 'chmura') i silniki za zgodą – tylko
        znane nazwy, bez lokalnego;
   W16. fotograf: miejsce i czas planu wracają ze składem od osoby; `powod`
        roli jako lista kodów;
   W17. poprawka po recenzji nie ma własnego ogłoszenia, „N z M” liczy skład,
        linijka historii bez poprawki jako osobnej roli;
   W18. koszt całej odpowiedzi (role + planista + prowadzący z `koniec`, C2)
        i `planPoliczony` (C5) – przez zapis i odczyt notatek;
   W19. przy planie policzonym przez fotografa [PLAN:] prowadzącego nie liczy
        drugiego planu (narzedzia.js);
   W20–W24. skład „Darmowe modele” (runda 10): skład startowy z ustawienia
        osoby, wariant i kandydaci przez białą listę, propozycja z wariantem
        darmowym, tura „tylko darmowe” przez zapis i odczyt, „Auto – najlepszy
        darmowy” w składzie do wysłania, „0 zł” tylko przy darmowym prowadzącym,
        klucze PL/EN. */
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
{
  const s0 = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(s0, 'zespol', { faza: 'planowanie' }, 0);
  Z.zjedzZdarzenieZespolu(s0, 'sklad', { v: 1, zrodlo: 'plan', prowadzacy: { silnik: 'local', model: 'q' }, role: [], odrzucone: [{ rola: 'badacz', kod: 'wymaga-zgody', silnik: 'cloud' }] }, 1);
  const m0 = Z.wiadomoscNotatek(s0, 2);
  ok(m0 && m0.content === '' && m0.zespol.odrzucone[0].kod === 'wymaga-zgody', 'W3f. wszystkie role czekają na zgodę na chmurę – zapis dla „Zgoda i ponów”, bez notatek dla modelu');
}

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

// ------------------------------------------------------------------ W11
{
  const przypadki = [
    ['pl', 'Tak.', 'tak'], ['pl', 'No dobra', 'tak'], ['pl', 'Jasne!', 'tak'], ['pl', 'okej', 'tak'], ['pl', 'Nie ma sprawy', 'tak'],
    ['pl', 'Czemu nie?', 'tak'], ['pl', 'Użyj chmury', 'tak'],
    ['pl', 'Tylko lokalnie', 'lokalnie'], ['pl', 'Tak, ale tylko lokalnie', 'lokalnie'], ['pl', 'Nie, u mnie na komputerze', 'lokalnie'],
    ['pl', 'Bez chmury', 'lokalnie'], ['pl', 'Nie do chmury', 'lokalnie'],
    ['pl', 'Nie.', 'nie'], ['pl', 'Nie, dziękuję', 'nie'], ['pl', 'Bez agentów', 'nie'], ['pl', 'Tak, bez agentów', 'nie'], ['pl', 'Odpowiedz sam', 'nie'],
    ['pl', 'no', ''], ['pl', 'Hmm', ''], ['pl', 'Dziękuję', ''], ['pl', 'Tak naprawdę chciałem zapytać o coś innego', ''],
    ['pl', 'Jaka będzie jutro pogoda w Krakowie i czy warto jechać na zdjęcia nad morze?', ''], ['pl', '', ''],
    ['en', 'Yes.', 'tak'], ['en', 'Go ahead', 'tak'], ['en', 'No problem', 'tak'], ['en', 'Why not?', 'tak'],
    ['en', 'Only locally', 'lokalnie'], ['en', 'Local only', 'lokalnie'], ['en', 'Keep it local', 'lokalnie'], ['en', 'Yes, but locally', 'lokalnie'],
    ['en', 'No.', 'nie'], ['en', 'No thanks', 'nie'], ['en', 'Without agents', 'nie'], ['en', 'Hmm', ''],
  ];
  const zle = przypadki.filter(([j, x, oczek]) => Z.rozpoznajZgode(x, j) !== oczek).map(([j, x, oczek]) => `${j}:„${x}” → ${Z.rozpoznajZgode(x, j) || '∅'} (≠ ${oczek || '∅'})`);
  ok(!zle.length, `W11. zgoda głosem: ${przypadki.length} wypowiedzi PL/EN → tak/lokalnie/nie/niejasne${zle.length ? ` – źle: ${zle.join('; ')}` : ''}`);
}

// ------------------------------------------------------------------ W11b
{
  // Przeczenie w środku zdania NIGDY nie daje „tak” – zgoda wysyła rozmowę z domu.
  const odmowy = [
    ['pl', 'Ja nie chcę do chmury.'], ['pl', 'Wolę nie wysyłać do chmury.'], ['pl', 'Chmura? Nie.'], ['pl', 'W chmurze nie.'],
    ['pl', 'Przez chmurę nie, dzięki.'], ['pl', 'Nigdy do chmury'], ['pl', 'Tak nie wiem'], ['pl', 'nie wiem'],
    ['en', 'I don\'t want the cloud.'], ['en', 'Not the cloud.'], ['en', 'Please don\'t use the cloud'], ['en', 'I\'d rather not use the cloud'],
    ['en', 'Never the cloud'], ['en', 'Keep it off the cloud'], ['en', 'Absolutely not'], ['en', 'No way'],
  ];
  const zgody = [['pl', 'Tak, bez problemu'], ['pl', 'wyślij do chmury'], ['pl', 'dawaj'], ['en', 'absolutely'], ['en', 'use the cloud'], ['en', 'of course']];
  const zleO = odmowy.filter(([j, x]) => Z.rozpoznajZgode(x, j) === 'tak').map(([j, x]) => `${j}:„${x}”`);
  const zleZ = zgody.filter(([j, x]) => Z.rozpoznajZgode(x, j) !== 'tak').map(([j, x]) => `${j}:„${x}” → ${Z.rozpoznajZgode(x, j) || '∅'}`);
  ok(!zleO.length && !zleZ.length, `W11b. przeczenie w środku zdania nie jest zgodą (${odmowy.length} odmów), zgody zostają (${zgody.length})${zleO.length ? ` – „tak” dla: ${zleO.join('; ')}` : ''}${zleZ.length ? ` – zgubione: ${zleZ.join('; ')}` : ''}`);
  ok(Z.rozpoznajZgode('W chmurze nie.', 'pl') === 'lokalnie' && Z.rozpoznajZgode('Never the cloud', 'en') === 'lokalnie',
    'W11b. odmowa chmury w zdaniu = „tylko lokalnie”');
}

// ------------------------------------------------------------------ W11c
{
  // Echo pytania o zgodę: tylko dosłowny OGON pytania i tylko tuż po końcu mowy.
  const P = 'Zespół chce wysłać rozmowę do chmury: NVIDIA. Powiedz „tak”, „tylko lokalnie” albo „bez agentów” – zgoda obowiązuje do końca tej rozmowy.';
  const echo = Z.echoPytaniaZgody('do końca tej rozmowy', P, 300) && Z.echoPytaniaZgody('Do końca tej rozmowy.', P, 1100) && Z.echoPytaniaZgody(P, P, 200);
  const nieEcho = [['Tak, ale tylko lokalnie', 300], ['tak', 200], ['tylko lokalnie', 200], ['bez agentów', 200], ['do końca tej rozmowy', 1500], ['końca tej rozmowy ok', 200], ['', 100]]
    .filter(([x, ms]) => Z.echoPytaniaZgody(x, P, ms));
  ok(echo && !nieEcho.length, `W11c. echo pytania o zgodę = dosłowny ogon pytania < 1,2 s po mowie; odpowiedź powtarzająca słowa pytania nie jest echem${nieEcho.length ? ` – źle: ${nieEcho.map((x) => x[0]).join('; ')}` : ''}`);
}

// ------------------------------------------------------------------ W17, W18
{
  // W17: poprawka po recenzji nie ma własnego ogłoszenia, „N z M” liczy skład; historia bez fali 3.
  const s = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(s, 'sklad', { v: 1, zrodlo: 'plan', prowadzacy: { silnik: 'cloud', model: 'm' }, role: [
    { r: 'r1', rola: 'programista', nazwa: 'Programista', silnik: 'openai', model: 'gpt-5-mini', fala: 1 },
    { r: 'r2', rola: 'recenzent', nazwa: 'Recenzent', silnik: 'claude', model: 'claude-sonnet-5', fala: 2 }] }, 0);
  const o17 = [];
  const zj = (typ, d, t) => o17.push(...Z.zjedzZdarzenieZespolu(s, typ, d, t));
  zj('rola', { r: 'r1', stan: 'gotowa', ms: 10, kosztZl: 0.01 }, 10);
  zj('rola', { r: 'r2', stan: 'gotowa', ms: 10, kosztZl: 0.02, kosztSzacowany: true }, 20);
  zj('rola', { r: 'r1p', rola: 'programista', nazwa: 'Programista', fala: 3, poprawkaZ: 'r1', stan: 'pracuje', silnik: 'openai', model: 'gpt-5-mini' }, 30);
  zj('rola', { r: 'r1p', stan: 'gotowa', ms: 10, kosztZl: 0.01 }, 40);
  const gotowe = o17.filter((x) => x.klucz === 'ag.sr.gotowa');
  ok(gotowe.length === 2 && gotowe.every((x) => x.n === 2) && gotowe[1].g === 2,
    `W17a. ogłoszenia: poprawka bez własnego „gotowe”, „N z M” po składzie (${JSON.stringify(gotowe.map((x) => `${x.g}/${x.n}`))})`);
  zj('faza', { faza: 'prowadzacy', notatki: 'N', kosztZl: 0.04, planPoliczony: true }, 50);
  Z.kosztProwadzacego(s, 0.12, false);
  const w = Z.wiadomoscNotatek(s, 60);
  ok(!/Programista, Recenzent, Programista/.test(w.searchQuery) && /Programista, Recenzent$/.test(w.searchQuery),
    `W17b. linijka historii bez poprawki jako osobnej roli („${w.searchQuery}”)`);
  // W18: cała odpowiedź = role + planista (faza) + prowadzący; „ok.” przy szacunku; C5 planPoliczony; przez zapis i odczyt.
  ok(s.planPoliczony === true && w.zespol.planPoliczony === true, 'W18a. `faza.planPoliczony` (C5) trafia do stanu i do notatek');
  const s2 = Z.stanZWiadomosci(w);
  ok(Z.kosztCaly(s) === 0.16 && Z.kosztTury(s) === 0.04 && Z.kosztCaly(s2) === 0.16 && Z.kosztSzacowany(s2) && s2.planPoliczony === true,
    `W18b. koszt całej odpowiedzi z prowadzącym (${Z.kosztCaly(s)} / po odczycie ${Z.kosztCaly(s2)}), szacunek zapamiętany`);
  const s3 = Z.nowyStanTury(0);
  ok(Z.kosztCaly(s3) === undefined && (Z.kosztProwadzacego(s3, 0.05, true), Z.kosztCaly(s3) === 0.05 && Z.kosztSzacowany(s3)),
    'W18c. bez ról i prowadzącego – nieznany; sam prowadzący z szacunkiem – jego kwota z „ok.”');
}

// ------------------------------------------------------------------ W19
const w19 = (async () => {
  // C5 w narzedzia.js: gdy fotograf dostał policzony plan (stan.planZespolu), [PLAN:] prowadzącego nie liczy drugiego.
  const { utworzNarzedzia } = require('../../public/narzedzia.js');
  const protokol = require('../../public/protokol.js').utworzProtokol();
  const adresy = [];
  const doModelu = [];
  const narz = utworzNarzedzia({
    t: (k) => k, saveConversations: () => {}, renderMessages: () => {},
    dodajWynikNarzedzia: (c, tresc) => { doModelu.push(tresc); c.messages.push({ role: 'user', content: tresc, search: true }); },
    stripSearchMarker: protokol.stripSearchMarker, readJsonSafe: async (r) => r.json(),
    fetch: async (a) => { adresy.push(String(a)); return { ok: true, status: 200, json: async () => ({ ok: true, tekst: 'DANE PLANU' }) }; },
    webSearch: async () => '', naKafelek: (x) => x, naKontekst: (d) => JSON.stringify(d), bezOgonkowKlient: (x) => String(x || '').toLowerCase(),
    zebranyMaterial: () => [], zastosujZmianePlotna: () => ({ ok: true }), pokazPlotno: () => {}, mowGlosem: async () => {}, PORCJA_ARCHIWUM: 24,
    wstawTekstModelu: () => null, WZORCE: { SZUKAJ: protokol.SEARCH_MARKER_RE, ARCHIWUM: protokol.ARCHIVE_RE, PLAN: protokol.PLAN_RE,
      PLOTNO_NOWE: protokol.CANVAS_NEW_RE, PLOTNO_ZMIANA: protokol.CANVAS_PATCH_RE, KOD: protokol.RUN_FENCE_RE, GRAFIKA: protokol.PHOTO_MARKER_RE, OBRAZ: protokol.IMAGE_MARKER_RE },
  });
  const plan = narz.find((n) => n.nazwa === 'plan');
  const acc = '[PLAN: obiektyw=24-105 miejsce=Morskie Oko]';
  const w1 = await plan.wykonaj({ acc, dop: plan.dopasuj(acc), conv: { messages: [] }, depth: 0, ostatnia: false, przed: '',
    stan: { archiwum: new Set(), grafiki: new Set(), plan: new Set(), planZespolu: true } });
  ok(w1 && w1.akcja === 'dalej' && !adresy.some((a) => a.includes('/api/plan')) && /JUŻ POLICZONY/.test(doModelu.join(' ')),
    `W19. plan policzony przez fotografa (C5) – [PLAN:] prowadzącego nie liczy drugiego, model dostaje „przepisz z notatki” (żądań /api/plan: ${adresy.length})`);
  await plan.wykonaj({ acc, dop: plan.dopasuj(acc), conv: { messages: [] }, depth: 0, ostatnia: false, przed: '',
    stan: { archiwum: new Set(), grafiki: new Set(), plan: new Set() } }).catch(() => {});
  ok(adresy.some((a) => a.includes('/api/plan')), 'W19b. bez planu zespołu [PLAN:] liczy się jak dawniej');
})().catch((e) => ok(false, `W19. wyjątek: ${e.message}`));

// ------------------------------------------------------------------ W12
{
  const s = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(s, 'sklad', { v: 1, zrodlo: 'plan', prowadzacy: { silnik: 'cloud', model: 'm' }, role: [
    { r: 'r1', rola: 'programista', nazwa: 'Programista', silnik: 'openai', model: 'gpt-5-mini', fala: 1 },
    { r: 'r2', rola: 'recenzent', nazwa: 'Recenzent', silnik: 'claude', model: 'claude-sonnet-5', fala: 2 }] }, 0);
  Z.zjedzZdarzenieZespolu(s, 'rola', { r: 'x9', rola: 'programista', stan: 'pracuje' }, 10);
  Z.zjedzZdarzenieZespolu(s, 'rola', { r: 'r9p', rola: 'programista', fala: 3, poprawkaZ: 'r9', stan: 'pracuje' }, 10);
  ok(s.role.length === 2, 'W12a. nieznana rola bez fali 3 (albo z poprawką nieistniejącej) – pominięta');
  Z.zjedzZdarzenieZespolu(s, 'rola', { r: 'r1p', rola: 'programista', nazwa: 'Programista', fala: 3, poprawkaZ: 'r1', stan: 'czeka', silnik: 'openai', model: 'gpt-5-mini' }, 20);
  Z.zjedzZdarzenieZespolu(s, 'rola', { r: 'r1p', stan: 'pracuje' }, 30);
  Z.zjedzZdarzenieZespolu(s, 'rola', { r: 'r1p', d: 'poprawiony kod' }, 40);
  Z.zjedzZdarzenieZespolu(s, 'rola', { r: 'r1p', stan: 'gotowa', ms: 900, kosztZl: 0.0123 }, 50);
  const p = s.role[2];
  ok(s.role.length === 3 && p && p.r === 'r1p' && p.fala === 3 && p.poprawkaZ === 'r1' && p.silnik === 'openai' && p.tresc === 'poprawiony kod' && p.stan === 'gotowa',
    'W12b. fala 3: pierwsze zdarzenie dopisuje wiersz na końcu (pod recenzentem), dalej stany jak inne');
  const w12 = Z.wiadomoscNotatek(s, 100);
  const z12 = w12.zespol.wklady.find((x) => x.r === 'r1p');
  ok(z12 && z12.fala === 3 && z12.poprawkaZ === 'r1' && z12.kosztZl === 0.0123, 'W12c. w notatkach poprawka ma fala:3, poprawkaZ i koszt');
  const o12 = Z.stanZWiadomosci(w12);
  ok(o12.role[2].fala === 3 && o12.role[2].poprawkaZ === 'r1', 'W12d. po odczycie zapisu wiersz poprawki zostaje poprawką');
  ok(Z.skladDoWyslania(o12.role).length === 2 && !Z.skladDoWyslania(o12.role).some((x) => x.rola === 'programista' && x.fala), 'W12e. „Zmień skład”/„Ponów” nie wysyła poprawki jako osobnej roli');
}

// ------------------------------------------------------------------ W13
{
  const s = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(s, 'sklad', { v: 1, role: [{ r: 'r1', rola: 'w-1a2b3c4d', nazwa: 'Tłumacz', silnik: 'local', model: 'q', fala: 2 }],
    odrzucone: [{ rola: 'w-9f9f9f9f', kod: 'wymaga-zgody', silnik: 'claude', wlasna: true, nazwa: 'Doradca' }] }, 0);
  ok(s.role[0].wlasna === true && Z.czyWlasnaRola(s.role[0]) && Z.czyWlasnaRola({ klucz: 'w-x' }) && !Z.czyWlasnaRola({ rola: 'badacz' }),
    'W13a. własna rola rozpoznana po „w-” (i fladze), wbudowana – nie');
  ok(s.odrzucone[0].nazwa === 'Doradca', 'W13b. odrzucona własna rola niesie swoją nazwę (do linijki pod blokiem)');
  const o = Z.stanZWiadomosci(Z.wiadomoscNotatek(s, 10));
  ok(o.role[0].wlasna === true && o.role[0].nazwa === 'Tłumacz' && o.role[0].fala === 2, 'W13c. zapis i odczyt zachowują własną rolę');
  ok(Z.skladDoWyslania(s.role)[0].rola === 'w-1a2b3c4d', 'W13d. skład do wysłania niesie id własnej roli (instrukcję ma serwer)');
}

// ------------------------------------------------------------------ W14
{
  const nb = (x) => x.replace(/\u00a0/g, ' ');
  ok(nb(Z.kwotaZl(0.12, 'pl')) === '0,12 zł' && nb(Z.kwotaZl(0.12, 'en')) === 'PLN 0.12' && nb(Z.kwotaZl(0.001, 'pl')) === 'poniżej 0,01 zł' && nb(Z.kwotaZl(0.001, 'en')) === 'under PLN 0.01'
    && Z.kwotaZl(undefined, 'pl') === '' && Z.kwotaZl(-1, 'pl') === '',
    `W14a. kwoty: „${Z.kwotaZl(0.12, 'pl')}”, „${Z.kwotaZl(0.12, 'en')}”, grosz „${Z.kwotaZl(0.001, 'pl')}”, brak → ''`);
  ok(Z.szacunekSkladu([{ silnik: 'claude', szacunekZl: 0.1 }, { silnik: 'cloud' }, { silnik: 'local' }]) === 0.1
    && Z.szacunekSkladu([{ silnik: 'claude' }]) === null && Z.szacunekSkladu([{ silnik: 'cloud', auto: true }]) === null
    && Z.szacunekSkladu([{ silnik: 'cloud' }]) === 0,
    'W14b. szacunek składu: znany + darmowe = suma; płatna bez szacunku albo „Auto” = nieznany');
  const s = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(s, 'sklad', { v: 1, szacunekZl: 0.2, role: [
    { r: 'r1', rola: 'badacz', silnik: 'openai', model: 'gpt-5-mini', szacunekZl: 0.05 },
    { r: 'r2', rola: 'analityk', silnik: 'claude', model: 'c' }] }, 0);
  ok(s.szacunekZl === 0.2 && s.role[0].szacunekZl === 0.05, 'W14c. szacunek całości i roli ze `sklad`');
  Z.zjedzZdarzenieZespolu(s, 'rola', { r: 'r1', stan: 'gotowa', ms: 1, kosztZl: 0.04 }, 5);
  Z.zjedzZdarzenieZespolu(s, 'rola', { r: 'r2', stan: 'pominieta', kod: 'budzet', ms: 0, kosztZl: 0 }, 6);
  ok(Z.kosztTury(s) === 0.04, `W14d. koszt tury bez \`faza\` – suma ról (${Z.kosztTury(s)})`);
  Z.zjedzZdarzenieZespolu(s, 'faza', { faza: 'prowadzacy', t: 10, notatki: 'N', kosztZl: 0.0512 }, 10);
  const w = Z.wiadomoscNotatek(s, 20);
  const o = Z.stanZWiadomosci(w);
  ok(w.zespol.kosztZl === 0.0512 && o.kosztZl === 0.0512 && Z.kosztTury(o) === 0.0512, 'W14e. koszt z `faza` w notatkach i po odczycie');
  ok(o.role[1].stan === 'pominieta' && o.role[1].kod === 'budzet', 'W14f. rola pominięta z powodu budżetu – kod zostaje w zapisie (wiersz mówi „budżet”)');
  const pr = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(pr, 'sklad', { propozycja: true, szacunekZl: 0.33, role: [{ r: 'r1', rola: 'badacz', silnik: 'claude' }] }, 0);
  ok(pr.propozycja.szacunekZl === 0.33, 'W14g. propozycja („Proponuj”) niesie szacunek');
}

// ------------------------------------------------------------------ W15
{
  const s = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(s, 'sklad', { v: 1, wymagaZgody: true, silnikiZaZgoda: ['claude', 'local', 'x<y', 'cloud'], role: [{ r: 'r1', rola: 'analityk', silnik: 'local' }] }, 0);
  ok(s.wymagaZgody === true && s.silnikiZaZgoda.join(',') === 'claude,cloud', `W15a. wymagaZgody + silniki za zgodą (${s.silnikiZaZgoda.join(',')})`);
  const s2 = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(s2, 'sklad', { v: 1, role: [{ r: 'r1', rola: 'analityk', silnik: 'local' }] }, 0);
  ok(s2.wymagaZgody === false && Z.wymagaZgodyZ('chmura') && Z.wymagaZgodyZ(true) && !Z.wymagaZgodyZ(null), 'W15b. bez pola – bez pytania; trasa planu: \'chmura\' = true');
}

// ------------------------------------------------------------------ W16
{
  const s = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(s, 'sklad', { v: 1, miejsce: 'Łeba', kiedy: 'czwartek', role: [
    { r: 'r1', rola: 'fotograf', silnik: 'local', model: 'q', zamiast: { silnik: 'claude', model: 'c' }, powod: 'budzet,wymaga-zgody' }] }, 0);
  const o = Z.stanZWiadomosci(Z.wiadomoscNotatek(s, 5));
  ok(s.miejsce === 'Łeba' && s.kiedy === 'czwartek' && o.miejsce === 'Łeba' && o.kiedy === 'czwartek',
    'W16a. fotograf: miejsce i czas planu ze `sklad` przechodzą przez zapis (do „Zmień skład” i ponowienia)');
  ok(Z.maPowod(s.role[0], 'budzet') && Z.maPowod(s.role[0], 'wymaga-zgody') && !Z.maPowod(s.role[0], 'uprawnienia')
    && Z.skladZaZgoda(s.role)[0].silnik === 'claude',
    'W16b. `powod` jako lista kodów („budzet,wymaga-zgody”) – oba rozpoznane, skład za zgodą wraca do chmury');
}

// ------------------------------------------------------------------ W10
{
  const zrodla = ['public/zespol-widok.js', 'public/app.js', 'public/konta.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8')).join('\n');
  const literalne = [...new Set([...zrodla.matchAll(/\bt\('((?:ag|narzedzie|chat\.budzet|voice\.errBudzet|acc\.budzet|acc\.zuzycieZl)[a-zA-Z0-9_.]*[a-zA-Z0-9_])'/g)].map((m) => m[1]))];
  const zDanych = [
    ...['czeka', 'pracuje', 'gotowe', 'pominieta', 'zatrzymana', 'blad'].map((s) => `ag.stan.${s}`),
    ...['badacz', 'fotograf', 'sprzetowiec', 'programista', 'oko', 'analityk', 'recenzent'].flatMap((r) => [`ag.rola.${r}`, `ag.rola.${r}.opis`]),
    // Własne role: cechy, pola formularza, fale (klucze składane z danych).
    ...['kod', 'wizja', 'rozumowanie', 'szybki', 'polski'].map((c) => `ag.wl.cecha.${c}`),
    ...['nazwa', 'cel'].flatMap((x) => [`ag.wl.pole.${x}`, `ag.wl.pole.${x}Hint`]), 'ag.wl.pole.instrukcja', 'ag.wl.pole.cechy', 'ag.wl.pole.cechyHint',
    'ag.wl.pole.fala', 'ag.wl.pole.obraz', 'ag.wl.pole.obrazHint', 'ag.wl.fala1', 'ag.wl.fala1Hint', 'ag.wl.fala2', 'ag.wl.fala2Hint',
    'ag.odrzuconeBudzet', 'ag.odmowaBudzet', 'ag.kosztOk', 'ag.wl.zleRole', 'ag.bud.zly', 'ag.glos.zgodaGrupa', 'ag.glos.tak', 'chat.doBudzetu', 'voice.errBudzet', 'voice.errBudzetChmura',
    ...['wylaczony', 'prosba', 'proponuj', 'sam'].flatMap((t) => [`ag.set.tryb.${t}`, `ag.set.tryb.${t}Hint`]),
    'narzedzie.zespol', 'set.k.agenci', 'ag.btn', 'ag.btnOn', 'ag.inputPh', 'ag.pokaz', 'ag.ukryj',
    'ag.odrzuconeZgoda', 'ag.odrzuconeUprawnienia', 'ag.odrzuconeLimit', 'ag.set.potwierdzaj', 'ag.set.zgodaStala',
  ];
  const brak = [...literalne, ...zDanych].filter((k) => !I18N.pl[k] || !I18N.en[k]);
  ok(literalne.length > 40 && !brak.length, `W10. ${literalne.length + zDanych.length} kluczy zespołu w PL i EN${brak.length ? ` – brak: ${brak.join(', ')}` : ''}`);
  const rozne = zDanych.filter((k) => I18N.pl[k] === I18N.en[k] && !/^\{/.test(I18N.pl[k]));
  ok(rozne.length <= 2, `W10b. angielskie teksty są przetłumaczone (tych samych co PL: ${rozne.join(', ') || 0})`);
}

// ------------------------------------------------------------------ W20–W24 skład „Darmowe modele” (runda 10, paczka Z)
{
  const prow = { silnik: 'cloud', model: 'nvidia/nemotron-3-super-120b-a12b' };
  const darmoweSurowe = {
    role: [{ r: 'r1', rola: 'analityk', silnik: 'cloud', model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5', szacunekZl: 0 },
      { r: 'r2', rola: 'recenzent', silnik: 'cloud', model: 'deepseek-ai/deepseek-v3.2', szacunekZl: 0 }],
    odrzucone: [{ rola: 'badacz', kod: 'rodzina' }], szacunekZl: 0, prowadzacyPlatny: false,
  };
  const planSklad = { prowadzacy: prow, role: [{ r: 'r1', rola: 'analityk', silnik: 'claude', model: 'claude-sonnet-5', szacunekZl: 0.1 },
    { r: 'r2', rola: 'recenzent', silnik: 'claude', model: 'claude-sonnet-5', szacunekZl: 0.1 }], odrzucone: [], szacunekZl: 0.26, darmowe: darmoweSurowe };
  // W20: skład startowy z ustawienia osoby – darmowy tylko, gdy jest wariant darmowy.
  const s1 = Z.skladStartowy(planSklad);
  const s2 = Z.skladStartowy({ ...planSklad, skladDomyslny: 'darmowy' });
  const s3 = Z.skladStartowy({ ...planSklad, skladDomyslny: 'darmowy', darmowe: null });
  ok(s1.wariant === 'proponowany' && s1.role[0].silnik === 'claude' && s1.szacunekZl === 0.26 && s1.tylkoDarmowe === false
    && s2.wariant === 'darmowe' && s2.role.every((r) => r.silnik === 'cloud') && s2.szacunekZl === 0 && s2.tylkoDarmowe === true
    && s3.wariant === 'proponowany',
    'W20. skład startowy: „Proponowany” domyślnie, „Darmowe modele” z ustawienia (tylkoDarmowe), bez wariantu darmowego – proponowany');
  const w20 = Z.wariantDarmowy({ ...darmoweSurowe, role: [...darmoweSurowe.role, { rola: 'x', silnik: 'marsjanski', model: 'm' }], szacunekZl: -1 });
  const k20 = Z.kandydaciZDanych({ analityk: [{ silnik: 'claude', model: 'claude-sonnet-5' }, { silnik: 'zly', model: 'x' }, { silnik: 'cloud', model: '' }, null] });
  ok(w20 && w20.role[2].silnik === 'cloud' && w20.szacunekZl === undefined && Z.wariantDarmowy(null) === null && Z.wariantDarmowy({ role: [] }) === null
    && k20.analityk.length === 1 && k20.analityk[0].darmowy === false,
    'W20b. wariant i kandydaci z serwera przez białą listę (nieznany silnik → chmura, ujemna kwota odpada, śmieci odrzucone)');
  // W21: reduktor – propozycja trzyma wariant darmowy, ustawienie i kandydatów; tura „tylko darmowe” przez zapis i odczyt.
  const st = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(st, 'sklad', { v: 1, propozycja: true, ...planSklad, skladDomyslny: 'darmowy', szacunekProwadzacyZl: 0.05,
    kandydaci: { analityk: [{ silnik: 'cloud', model: 'qwen/qwen3-235b-a22b' }] } });
  const p21 = st.propozycja;
  const start21 = Z.skladStartowy(p21);
  ok(p21 && p21.darmowe && p21.darmowe.role.length === 2 && p21.skladDomyslny === 'darmowy' && p21.kandydaci.analityk[0].darmowy === true
    && p21.szacunekProwadzacyZl === 0.05 && p21.role[0].silnik === 'claude' && start21.wariant === 'darmowe' && !st.role.length,
    'W21. propozycja pod odpowiedzią: wariant darmowy, ustawienie osoby i kandydaci w stanie; skład startowy z nich; role tury nietknięte');
  const stT = Z.nowyStanTury(0);
  Z.zjedzZdarzenieZespolu(stT, 'sklad', { v: 1, zrodlo: 'plan', prowadzacy: prow, role: darmoweSurowe.role, odrzucone: [], tylkoDarmowe: true });
  const odczyt = Z.stanZWiadomosci(Z.wiadomoscNotatek(stT));
  ok(stT.tylkoDarmowe === true && odczyt.tylkoDarmowe === true, 'W21b. tura „tylko darmowe” – flaga w stanie, w zapisie notatek i po odczycie');
  // W22: „Auto – najlepszy darmowy” idzie do serwera jako tylkoDarmowe bez silnika.
  const w22 = Z.skladDoWyslania([{ rola: 'analityk', auto: true, autoDarmowy: true, silnik: 'claude', model: 'claude-sonnet-5' }, { rola: 'recenzent', auto: true }]);
  ok(JSON.stringify(w22) === JSON.stringify([{ rola: 'analityk', tylkoDarmowe: true }, { rola: 'recenzent' }]),
    `W22. skład do wysłania: Auto w wariancie darmowym → {tylkoDarmowe:true}, zwykłe Auto bez pól (${JSON.stringify(w22)})`);
  // W23: „0 zł” tylko, gdy cała tura nic nie kosztuje; „jeden model” – wszystkie role na modelu prowadzącego.
  ok(Z.zeroZl({ szacunekZl: 0 }) && !Z.zeroZl({ szacunekZl: 0.04, prowadzacyPlatny: true }) && Z.zeroZl({ prowadzacyPlatny: false })
    && !Z.zeroZl({ prowadzacyPlatny: true }) && Z.jedenModel([{ silnik: 'cloud', model: prow.model }, { silnik: 'cloud', model: prow.model }], prow)
    && !Z.jedenModel(darmoweSurowe.role, prow) && !Z.jedenModel([], prow),
    'W23. „0 zł” tylko przy darmowym prowadzącym; „jeden model” rozpoznany');
  // W24: klucze składane z danych (segment, edytor, uwaga, Ustawienia) są w obu słownikach i przetłumaczone.
  const klucze = ['ag.wariant.grupa', 'ag.wariant.proponowany', 'ag.wariant.darmowe', 'ag.zeroZl', 'ag.darmowe.opis', 'ag.darmowe.jedenModel', 'ag.darmowe.prowadzacyPlatny',
    'ag.pominietaRodzina', 'ag.odrzuconeDarmowe', 'ag.bladLimitDarmowy', 'ag.uruchomDarmowo', 'ag.uruchomDarmowoTitle', 'ag.re.bezOplat', 'ag.re.platny', 'ag.re.polecany',
    'ag.re.autoDarmowy', 'ag.set.sklad.h', 'ag.set.sklad.opis', 'ag.set.sklad.proponowany', 'ag.set.sklad.proponowanyHint', 'ag.set.sklad.darmowe', 'ag.set.sklad.darmoweHint'];
  const brak24 = klucze.filter((k) => !I18N.pl[k] || !I18N.en[k] || I18N.pl[k] === I18N.en[k]);
  ok(!brak24.length && !klucze.some((k) => /—/.test(I18N.pl[k] + I18N.en[k])), `W24. ${klucze.length} kluczy składu darmowego w PL i EN, przetłumaczone${brak24.length ? ` – brak: ${brak24.join(', ')}` : ''}`);
}

w19.then(() => {
  console.log(bledy.length ? `\nDO POPRAWY:\n- ${bledy.join('\n- ')}` : '\nzespol-widok OK');
  process.exit(bledy.length ? 1 : 0);
});

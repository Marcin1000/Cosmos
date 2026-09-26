/* Czat bez serwera — kroki lib/czat.js wołane wprost.

   Do rundy 4 cały czat był jedną funkcją w server.js i sprawdzić go dało się
   tylko przez HTTP, z atrapą modelu i przeglądarką. Teraz kroki są osobne,
   więc ich obietnice sprawdzamy w ułamku sekundy:

     1. Przycięcie do okna modelu lokalnego nigdy nie wyrzuca instrukcji ani
        bieżącej tury (w kaskadzie: pytania przed wynikami narzędzia), wyrzuca
        od najstarszej tury, mieści się w oknie i nie zmienia tablicy
        wejściowej; za duże wyniki skraca w środku, z dopiskiem dla modelu.
     2. Błąd dostawcy PO odpowiedzi 200 jest rozpoznawany we wszystkich
        znanych kształtach, a zwykły kawałek odpowiedzi — nie.
     3. „Myślą po cichu" (dłuższy limit ciszy) tylko modele, które naprawdę
        nie przysyłają rozumowania: Claude, gpt-5+, o*.
     4. Okno Ollamy bez ustawienia to 4096, vLLM — bez budżetu, LOCAL_NUM_CTX wygrywa.
     5. Składanie kontekstu: własna instrukcja systemowa zostaje pierwsza,
        dodatki idą zaraz za nią; czas i miejsce, profil; obraz zaznaczony
        w bazie wiedzy trafia do OSTATNIEJ wiadomości człowieka, za duży —
        model dostaje o tym zdanie; tryb głosowy jest ostatnim dodatkiem;
        wyłączona pamięć nie jest w ogóle pytana. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Dane serwera w katalogu tymczasowym — moduły czytają COSMOS_DATA_DIR przy wczytaniu.
process.env.COSMOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-czat-'));
delete process.env.LOCAL_NUM_CTX;

const czat = require('../../lib/czat.js');
const { wKontekscie } = require('../../lib/kontekst.js');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

// --- 1. przycięcie do okna --------------------------------------------------------
{
  const dluga = 'x'.repeat(3000);            // ~1000 tokenów
  const wej = [
    { role: 'system', content: 'Jesteś pomocny.' },
    { role: 'system', content: 'TERAZ JEST: …' },
    { role: 'user', content: `najstarsze ${dluga}` },
    { role: 'assistant', content: `druga ${dluga}` },
    { role: 'user', content: `trzecia ${dluga}` },
    { role: 'assistant', content: `czwarta ${dluga}` },
    { role: 'user', content: 'ostatnie pytanie' },
  ];
  const kopia = JSON.stringify(wej);
  const bez = czat.przytnijDoOkna(wej, 0, 2048);
  ok(bez.wiadomosci === wej && bez.przycietoTur === 0 && bez.limitZOkna === 0, 'bez okna (chmura, vLLM) nic się nie zmienia');

  const w = czat.przytnijDoOkna(wej, 4096, 2048);
  const zostaly = w.wiadomosci;
  ok(JSON.stringify(wej) === kopia, 'tablica wejściowa nietknięta');
  ok(zostaly.filter((m) => m.role === 'system').length === 2, 'instrukcje systemowe zostają wszystkie');
  ok(zostaly[zostaly.length - 1].content === 'ostatnie pytanie', 'ostatnia wiadomość człowieka zostaje');
  ok(w.przycietoTur === wej.length - zostaly.length && w.przycietoTur > 0, `wypadło ${w.przycietoTur} tur i tyle zgłoszono`);
  ok(!zostaly.some((m) => /^najstarsze/.test(m.content)), 'wypada od najstarszej tury');
  const suma = zostaly.reduce((a, m) => a + czat.szacujTokeny(m.content), 0);
  ok(suma + Math.min(2048, 1024) <= 4096, `mieści się w oknie (${suma} tokenów + miejsce na odpowiedź)`);
  ok(w.limitZOkna >= 512 && w.limitZOkna <= 2048, `limit odpowiedzi dopasowany do reszty okna (${w.limitZOkna})`);

  const same = czat.przytnijDoOkna([{ role: 'system', content: dluga }, { role: 'user', content: dluga }], 512, 2048);
  ok(same.wiadomosci.length === 2 && same.limitZOkna === 512, 'gdy nie ma czego wyrzucić, nic nie ginie, a limit ma dolną granicę');
}

// --- 1b. kaskada: bieżąca tura to pytanie + wyniki narzędzia ------------------------------
{
  const instrukcje = { role: 'system', content: 'i'.repeat(3000) };        // ~1000 tokenów, jak wersja zwięzła
  const tura = (wyniki) => [
    instrukcje,
    { role: 'user', content: `stare pytanie ${'s'.repeat(1500)}` },
    { role: 'assistant', content: `stara odpowiedź ${'s'.repeat(1500)}` },
    { role: 'user', content: 'Jaka jest dziś pogoda w Warszawie?' },
    { role: 'assistant', content: 'Sprawdzę to.' },
    { role: 'user', content: `WYNIKI WYSZUKIWANIA dla „pogoda Warszawa": ${wyniki}KONIEC WYNIKÓW` },
  ];
  const wej = tura('w'.repeat(6400));
  const k = czat.przytnijDoOkna(wej, 4096, 2048, 3);
  const teksty = k.wiadomosci.map((m) => m.content);
  ok(teksty.includes('Jaka jest dziś pogoda w Warszawie?') && teksty.includes('Sprawdzę to.'),
    'kaskada: pytanie i zapowiedź narzędzia zostają, choć ostatnia wiadomość to wyniki');
  ok(!teksty.some((t) => /^stare/.test(t)) && k.przycietoTur === 2, 'wypadają tury sprzed bieżącej (i tyle zgłoszono)');

  // Wyniki większe niż całe okno: skracamy je w środku, pytanie zostaje całe.
  const duze = czat.przytnijDoOkna(tura('w'.repeat(20000)), 4096, 2048, 3);
  const wyniki = duze.wiadomosci[duze.wiadomosci.length - 1].content;
  const suma = duze.wiadomosci.reduce((a, m) => a + czat.szacujTokeny(m.content), 0);
  ok(duze.skrocono && /skrócone do okna modelu/.test(wyniki), 'za duże wyniki są skrócone i model o tym wie');
  ok(/^WYNIKI WYSZUKIWANIA/.test(wyniki) && /KONIEC WYNIKÓW$/.test(wyniki), 'skrócenie w środku — początek i koniec zostają');
  ok(duze.wiadomosci.some((m) => m.content === 'Jaka jest dziś pogoda w Warszawie?'), 'pytanie zostaje także przy skracaniu');
  ok(suma + 1024 <= 4096, `po skróceniu mieści się w oknie (${suma} tokenów + miejsce na odpowiedź)`);

  // Klient bez `turaOd` (stara karta, mostek MCP): chroniona jak dawniej ostatnia wiadomość.
  const stary = czat.przytnijDoOkna([
    { role: 'user', content: `stare ${'s'.repeat(9000)}` }, { role: 'user', content: 'teraz' },
  ], 2048, 1024);
  ok(stary.wiadomosci.length === 1 && stary.wiadomosci[0].content === 'teraz' && !stary.skrocono,
    'bez granicy tury chroniona ostatnia wiadomość');
}

// --- 2. błąd w strumieniu ------------------------------------------------------------
{
  const b = czat.bladWStrumieniu;
  ok(b('data: {"error":{"message":"Overloaded","type":"overloaded_error"}}') === 'Overloaded', 'błąd w stylu OpenAI/Anthropic');
  ok(b('data: {"object":"error","message":"out of memory"}') === 'out of memory', 'stary format vLLM');
  ok(b('data: {"error":"limit reached"}') === 'limit reached', 'błąd jako napis');
  ok(b('data: {"choices":[{"delta":{"content":"error: to zwykłe słowo"}}]}') === '', 'zwykły kawałek odpowiedzi to nie błąd');
  ok(b('data: [DONE]') === '' && b('data: {"err') === '', 'koniec strumienia i niepełny blok to nie błąd');
}

// --- 3. kto myśli po cichu -------------------------------------------------------------
{
  const c = (m, ep = {}) => czat.cichoMysli(ep, m);
  ok(c('claude-sonnet-5') && c('gpt-5-mini') && c('openai/gpt-5') && c('o3') && c('x', { anthropic: true }),
    'Claude, gpt-5+, o* i warstwa Anthropic — dłuższy limit do pierwszej treści');
  ok(!c('gpt-4o-mini') && !c('nvidia/nemotron-3-super') && !c('qwen3:8b'), 'modele przysyłające rozumowanie (albo szybkie) — zwykły limit');
}

// --- 4. okno modelu lokalnego ------------------------------------------------------------
{
  ok(czat.oknoLokalneDla({ baseUrl: 'http://pc:11434/v1' }) === 4096, 'Ollama bez ustawienia: 4096');
  ok(czat.oknoLokalneDla({ baseUrl: 'http://pc:8000/v1' }) === 0, 'vLLM/NIM: bez budżetu');
  process.env.LOCAL_NUM_CTX = '16384';
  ok(czat.oknoLokalneDla({ baseUrl: 'http://pc:11434/v1' }) === 16384, 'LOCAL_NUM_CTX wygrywa');
  delete process.env.LOCAL_NUM_CTX;
  ok(czat.rodzajBleduPolaczenia({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }) === 'uspiony'
    && czat.rodzajBleduPolaczenia({ code: 'ECONNREFUSED' }) === 'odmowa'
    && czat.rodzajBleduPolaczenia({ cause: { code: 'ENOTFOUND' } }) === 'dns', 'przyczyna braku połączenia rozpoznana po kodzie');
}

// --- 5. składanie kontekstu na atrapach --------------------------------------------------
(async () => {
  const stan = {
    location: 'Piaseczno', profile: 'Fotografuje krajobrazy.', sprzet: null, wspolrzedne: null,
    kbItems: [
      { id: 'n1', name: 'notatka.md', mime: 'text/markdown', text: 'Kod do bramy: 1234' },
      { id: 'o1', name: 'mazury.jpg', mime: 'image/jpeg' },
      { id: 'o2', name: 'wielkie.jpg', mime: 'image/jpeg' },
    ],
  };
  let pytanoPamiec = 0;
  const c = czat.utworz({
    U: () => stan,
    archiwum: { ile: () => 0 }, procedury: () => [], urzadzenia: () => [],
    searchMemory: async () => { pytanoPamiec++; return []; },
    memoryContextLines: () => '',
    kbSearch: async () => [],
    obrazDlaModelu: (it) => (it.id === 'o1' ? { mime: 'image/jpeg', buf: Buffer.from('JPEG') } : null),
    biegi: {}, terazTekst: () => 'sobota, 26 września 2026, godzina 20:15',
    capabilityManifest: async () => ({}), capabilityText: () => 'Jestem Cosmos.\n\nSzczegóły konfiguracji.',
    scrubSecrets: (s) => s,
  });
  const ep = { baseUrl: 'http://chmura/v1', model: 'nvidia/nemotron-3-super' };
  const osoba = { id: 'wlasciciel', rola: 'wlasciciel' };

  const { messages } = await wKontekscie(osoba, () => c.zlozKontekst({
    endpoint: 'cloud', useMemory: false, kbSelected: ['n1', 'o1', 'o2'], trybGlosowy: true,
    messages: [
      { role: 'system', content: 'MOJA INSTRUKCJA' },
      { role: 'user', content: 'pierwsze pytanie' },
      { role: 'assistant', content: 'odpowiedź' },
      { role: 'user', content: 'co jest na zdjęciu?' },
    ],
  }, ep));

  ok(messages[0].content === 'MOJA INSTRUKCJA', 'własna instrukcja systemowa zostaje pierwsza');
  const dodatki = messages.slice(1, messages.findIndex((m, i) => i > 0 && m.role !== 'system'));
  const tekst = dodatki.map((m) => m.content).join('\n');
  ok(/TERAZ JEST: sobota/.test(tekst) && /ZNAJDUJE SIĘ W: Piaseczno/.test(tekst), 'czas i miejsce w kontekście');
  ok(/PROFIL UŻYTKOWNIKA[\s\S]*krajobrazy/.test(tekst), 'profil w kontekście');
  ok(/Kod do bramy: 1234/.test(tekst) && /\[źródło: nazwa\]/.test(tekst), 'zaznaczona notatka z bazy wiedzy, z prośbą o źródło');
  const ostatnia = messages[messages.length - 1];
  const obrazy = Array.isArray(ostatnia.content) ? ostatnia.content.filter((p) => p.type === 'image_url') : [];
  ok(obrazy.length === 1 && obrazy[0].image_url.url === `data:image/jpeg;base64,${Buffer.from('JPEG').toString('base64')}`,
    'zaznaczony obraz trafia do OSTATNIEJ wiadomości człowieka');
  ok(typeof messages[1 + dodatki.length].content === 'string', 'wcześniejsze wiadomości człowieka bez obrazów');
  ok(/wielkie\.jpg/.test(tekst) && /za duże/.test(tekst), 'za duży obraz — model dostaje zdanie z nazwą pliku');
  ok(/^TRYB GŁOSOWY/.test(dodatki[dodatki.length - 1].content), 'tryb głosowy jest ostatnim dodatkiem');
  ok(pytanoPamiec === 0, 'wyłączona pamięć nie jest w ogóle pytana');

  // Granica tury podana przez klienta wskazuje po doklejeniu instrukcji to samo pytanie.
  const kaskada = await wKontekscie(osoba, () => c.zlozKontekst({
    endpoint: 'cloud', useMemory: false, turaOd: 3,
    messages: [
      { role: 'system', content: 'MOJA INSTRUKCJA' },
      { role: 'user', content: 'stare' }, { role: 'assistant', content: 'stara odpowiedź' },
      { role: 'user', content: 'PYTANIE' }, { role: 'assistant', content: 'Sprawdzę to.' },
      { role: 'user', content: 'WYNIKI' },
    ],
  }, ep));
  ok(kaskada.messages[kaskada.chronOd].content === 'PYTANIE', 'granica tury po doklejeniu instrukcji wskazuje pytanie');
  const bezGranicy = await wKontekscie(osoba, () => c.zlozKontekst({ endpoint: 'cloud', useMemory: false, turaOd: 99,
    messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] }, ep));
  ok(bezGranicy.chronOd === bezGranicy.messages.length - 1, 'granica spoza tablicy — chroniona ostatnia wiadomość');

  const bezMiejsca = await wKontekscie(osoba, () => { stan.location = ''; return c.zlozKontekst({ endpoint: 'cloud', messages: [{ role: 'user', content: 'hej' }] }, ep); });
  const t2 = bezMiejsca.messages.map((m) => m.content).join('\n');
  ok(/Nie znasz lokalizacji/.test(t2) && !/TRYB GŁOSOWY/.test(t2) && pytanoPamiec === 1,
    'bez lokalizacji model wie, że jej nie zna; bez trybu głosowego brak tej instrukcji; pamięć pytana');

  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nCZAT BEZ SERWERA OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

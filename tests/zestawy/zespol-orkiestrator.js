/* Zespół agentów – cała tura przez HTTP/SSE na prawdziwym serwerze.

   Atrapa tests/atrapy/mock-zespol.js udaje cztery silniki naraz (chmura,
   lokalny, OpenAI, Claude) i rozpoznaje planistę, role i prowadzącego.
   Tryb domowy (właściciel), krótkie terminy z env.

   Gwarancje:
   O1. tura = JEDEN bieg: zdarzenia zespol → sklad → rola… → faza (z notatkami)
       → odpowiedź prowadzącego → koniec; żadne zdarzenie zespołu nie ma klucza
       choices/error/object, więc parser starego klienta widzi WYŁĄCZNIE tekst
       prowadzącego; recenzent rusza PO fali 1 i dostaje jej notatki;
       notatki idą w OSTATNIEJ wypowiedzi człowieka, nie w system;
   O2. odpowiedź, po którą nikt nie wrócił: notatki (wynik narzędzia
       `narzedzie:'zespol'` z wkładami, silnikiem i modelem ról) i odpowiedź
       prowadzącego w pliku rozmowy; wznowienie od 0 odtwarza stany ról ==
       zapis;
   O3. prywatność: prowadzący lokalny bez zgody – ani planista, ani rola nie
       wysyła nic do chmury (0 żądań na chmurę/OpenAI/Claude), rola
       zaproponowana na Claude idzie lokalnie z `zamiast` i powodem
       `wymaga-zgody`, role lokalne po kolei; ze zgodą – Claude dostaje rolę;
   O4. awarie: 500 → zapas na modelu prowadzącego; cisza → rola kończy się
       po terminie ciszy, reszta nie czeka; 429 bez ponawiania → zapas;
       tura kończy się bez błędu, prowadzący dostaje „NIE DOTARŁO”;
   O5. Stop w fazie ról: koniec w < 1,5 s, prowadzący nie rusza, u dostawcy
       nic nie wisi;
   O6. „Pomiń rolę” i „Scal teraz”: pominięta rola ma stan `pominieta`,
       po scaleniu prowadzący rusza z tym, co jest;
   O7. planista: brudny JSON (<think>, True, angielskie nazwy, wstrzyknięty
       znacznik) daje skład bez znacznika; milczący planista – skład z
       heurystyki po terminie planisty;
   O8. wkład z „</wklad>” i „[AKCJA: …]” dochodzi do prowadzącego jako jeden
       blok bez aktywnego znacznika;
   O9. badacz szuka po stronie serwera – wyniki trafiają tylko do niego;
   O10. bez `payload.zespol` (stary klient) – zwykła odpowiedź; tura
       z notatkami (Regeneruj) nie uruchamia zespołu drugi raz; „Proponuj”
       – odpowiedź sama + `sklad {propozycja:true}` przed końcem;
   O11. limit naraz: trzeci zespół właściciela → 409 zespol-zajety;
   O9b. role domyślnie bez myślenia (planista, badacz), recenzent bez zmian;
   O12. SIGTERM w fazie ról: żadnego nowego wywołania modelu, w rozmowie
       notatki z DOMKNIĘTYMI stanami ról (nic „pisze”);
   O13. fala 3 – poprawka kodu po recenzji: nowa rola `r1p` ogłasza się
       zdarzeniem z falą 3, poprawkaZ, silnikiem i modelem programisty; ten
       sam model dostaje swój kod i uwagi recenzenta; do prowadzącego idzie
       wersja poprawiona, w zapisie zostaje też oryginał (fala 1); „BEZ UWAG”
       – bez poprawki; nieudana poprawka – kod z fali 1, bez zapasu; za mało
       czasu fazy – bez poprawki;
   O14. fotograf: planista daje miejsce i kiedy, serwer liczy plan (geokoder,
       pogoda) i daje go TYLKO fotografowi; prowadzący wie, że plan jest
       w notatkach (bez dublowania); nieznane miejsce – fotograf dostaje
       „brak planu”, prowadzący liczy sam;
   O15. własna rola: planista widzi ją bez instrukcji i wybiera, rola dostaje
       instrukcję osoby w ramie roli;
   O16. budżet w zł: płatna rola ponad budżet → darmowa chmura z powodem
       `budzet`; w budżecie – szacunek przed startem, koszt z usage w końcu
       roli i w fazie prowadzącego, bez wiszących rezerwacji; bez usage –
       koszt z szacunku z flagą; fala 1 wydała za dużo → recenzent pominięty
       (`budzet`); wyczerpany budżet + płatny prowadzący → 429;
   O17. głos: planista krócej (także „tylko plan”); lokalny prowadzący bez
       zgody – role lokalnie, zero żądań do chmury, `sklad` i „tylko plan”
       mówią wymagaZgody i dokąd poszłyby dane; serwer nie rusza żadnej roli
       (także lokalnej), dopóki przeglądarka nie zatrzyma biegu (O17d);
   O14e–h. plan dla roli: godziny czasu miejsca bez pól UTC, „chwila”, tryb
       zdjęcie (wideo tylko przy pytaniu o film), sama data + złota godzina
       = nastawy na jej początek, nieistniejąca data = brak planu; faza
       prowadzącego mówi planPoliczony (C5);
   O18. przerwana płatna rola („Scal teraz”) kosztuje – szacunek z flagą;
   O19. płatny planista po terminie kosztuje co najmniej szacunek;
   O20. prowadzący rezerwuje budżet: ponad limit – bez wywołania, koniec
       z kodem budzet-wyczerpany; szacunek składu z prowadzącym (C6);
   O22. obraz w turze (Z5): rola „oko” dostaje obraz, prowadzący zostaje na
       modelu tekstowym i dostaje opis zamiast obrazu (dawniej 400 bez
       NEMOTRON_VISION_MODEL albo 12B VL pisał całą odpowiedź);
   O23. tura „tylko darmowe” (K5) przy płatnym prowadzącym: role na chmurze
       NVIDIA, zalecany model spoza konta (404) spada na darmowy zapas –
       zero ról na płatnych silnikach;
   O24. /api/zespol/plan: proponowany + `darmowe` z tego samego planu,
       kandydaci do edytora, `skladDomyslny` z ustawień osoby;
   O21. fala 3: poprawka urwana na limicie („urwana”), bez kodu, fragmentem
       – prowadzący dostaje kod z fali 1; „BEZ UWAG” z dopiskiem – bez fali 3. */
const fs = require('fs');
const path = require('path');
const { KORZEN, serwerCosmosa, atrapaNode, czekajNa, zabij, zwolnijPorty, katalogOsoby } = require('../pomoc');

const PORT = 3521;
const A = { cloud: 7521, local: 7522, openai: 7523, claude: 7524 };
const ADRES = `http://127.0.0.1:${PORT}`;
const spij = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = [];
const ok = (warunek, opis) => { console.log(`${warunek ? '✓' : '✗'} ${opis}`); if (!warunek) fail.push(opis); };

let licznik = 0;
const nowyBieg = () => `zespol-test-${Date.now().toString(36)}-${++licznik}`;

/** Jedna tura: POST /api/chat, zdarzenia SSE do końca (albo do akcji w trakcie). */
async function tura(payload, { wTrakcie = null, limitMs = 20_000 } = {}) {
  const bieg = payload.bieg || nowyBieg();
  const r = await fetch(`${ADRES}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', bieg, ...payload }), signal: AbortSignal.timeout(limitMs),
  });
  const wynik = { status: r.status, bieg, zdarzenia: [], tekst: '', koniec: null, surowe: '' };
  if (!r.ok || !/event-stream/.test(r.headers.get('content-type') || '')) { wynik.blad = await r.text(); return wynik; }
  if (wTrakcie) wTrakcie(bieg, wynik).catch((e) => console.log('akcja w trakcie:', e.message));
  const dek = new TextDecoder(); let ogon = '';
  for await (const k of r.body) {
    ogon += dek.decode(k, { stream: true });
    const bloki = ogon.split('\n\n'); ogon = bloki.pop();
    for (const b of bloki) zjedz(b, wynik);
  }
  if (ogon.trim()) zjedz(ogon, wynik);
  return wynik;
}
/* Ten sam sposób czytania co stary klient (public/app.js: zjedzZdarzenie):
   treść tylko z `choices[0].delta.content` – i osobno lista zdarzeń zespołu. */
function zjedz(blok, w) {
  w.surowe += `${blok}\n\n`;
  let typ = ''; let id = null;
  for (const linia of blok.split('\n')) {
    if (linia.startsWith('id:')) { id = Number(linia.slice(3)); continue; }
    if (linia.startsWith('event:')) { typ = linia.slice(6).trim(); continue; }
    if (!linia.startsWith('data:')) continue;
    const d = linia.slice(5).trim();
    if (d === '[DONE]') continue;
    let j; try { j = JSON.parse(d); } catch { continue; }
    if (typ === 'koniec') { w.koniec = j; continue; }
    if (typ) { w.zdarzenia.push({ id, typ, dane: j }); continue; }
    w.tekst += j.choices?.[0]?.delta?.content ?? '';
  }
}
const zd = (w, typ) => w.zdarzenia.filter((e) => e.typ === typ).map((e) => e.dane);
const sklad = (w) => zd(w, 'sklad')[0] || { role: [], odrzucone: [] };
const stanyKoncowe = (w) => {
  const s = {};
  for (const e of zd(w, 'rola')) if (e.stan) s[e.r] = e.stan;
  return s;
};

const atrapa = async (silnik) => (await fetch(`http://127.0.0.1:${A[silnik]}/__stan`)).json();
const zeruj = async () => { await fetch(`http://127.0.0.1:${A.cloud}/__zeruj`); };
const zadania = async () => (await atrapa('cloud')).zadania;
const post = (p, dane) => fetch(`${ADRES}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dane) });

async function nowaRozmowa(id, pytanie) {
  await fetch(`${ADRES}/api/conversations?id=${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'zespół', messages: [{ role: 'user', content: pytanie }] }),
  });
}

(async () => {
  await zwolnijPorty([PORT, ...Object.values(A)]);
  const procAtrapy = atrapaNode('mock-zespol.js');
  // atrapaNode nie przekazuje własnych zmiennych – porty idą przez domyślne 7521–7524 atrapy.
  await spij(700);
  const env = {
    NVIDIA_API_KEY: 'test', LOCAL_API_KEY: 'test',
    NEMOTRON_BASE_URL: `http://127.0.0.1:${A.cloud}/v1`, NEMOTRON_MODEL: 'nvidia/nemotron-3-super-120b-a12b',
    LOCAL_BASE_URL: `http://127.0.0.1:${A.local}/v1`, LOCAL_MODEL: 'qwen3:8b',
    OPENAI_API_KEY: 'sk-test-wlasciciela-openai-1234', OPENAI_BASE_URL: `http://127.0.0.1:${A.openai}/v1`, OPENAI_MODEL: 'gpt-4o-mini',
    ANTHROPIC_API_KEY: 'sk-ant-test-wlasciciela-12345', ANTHROPIC_BASE_URL: `http://127.0.0.1:${A.claude}/v1`, CLAUDE_MODEL: 'claude-haiku-4-5',
    SEARCH_URL: `http://127.0.0.1:${A.cloud}/szukaj`, SEARXNG_URL: '', SERPER_API_KEY: '', BRAVE_API_KEY: '',
    COSMOS_ZESPOL_CISZA_MS: '2500', COSMOS_ZESPOL_TERMIN_ROLI_MS: '5000', COSMOS_ZESPOL_TERMIN_PLANISTY_MS: '1500',
    COSMOS_ZESPOL_TERMIN_FAZY_MS: '12000', COSMOS_BIEG_SIEROTA_MS: '400', COSMOS_CZAS_NA_DOKONCZENIE_MS: '2500',
    // Fala 3 przy fazie 12 s; planista w głosie krócej niż zwykle (700 vs 1500 ms).
    COSMOS_ZESPOL_MIN_NA_POPRAWKE_MS: '3000', COSMOS_ZESPOL_TERMIN_PLANISTY_GLOS_MS: '700',
    // Plan fotografa: geokoder i pogoda z atrapy.
    GEOCODE_SEARCH_URL: `http://127.0.0.1:${A.cloud}/geokoduj`, WEATHER_URL: `http://127.0.0.1:${A.cloud}/pogoda`, GEOCODE_COUNTRY: '',
  };
  let srv = serwerCosmosa(PORT, env);
  const katalog = srv.katalogDanych;
  if (!await czekajNa(ADRES)) { console.log('serwer nie wstał'); zabij(procAtrapy); process.exit(1); }

  try {
    // ------------------------------------------------------------ O1 / O2
    {
      await zeruj();
      const rozmowa = 'rozmowazespolu1';
      const pytanie = 'Jak rozłożyć budżet domowy na trzy cele?';
      await nowaRozmowa(rozmowa, pytanie);
      const w = await tura({ messages: [{ role: 'user', content: pytanie }], rozmowa, zespol: { uruchom: true } });
      const typy = w.zdarzenia.map((e) => e.typ);
      const iSklad = typy.indexOf('sklad'); const iFaza = typy.indexOf('faza');
      ok(w.status === 200 && typy[0] === 'zespol' && iSklad > 0 && iFaza > iSklad && typy.slice(iSklad + 1, iFaza).every((t) => t === 'rola'),
        `O1a. kolejność zdarzeń: ${[...new Set(typy)].join(' → ')}`);
      ok(w.tekst === 'Odpowiedź prowadzącego po scaleniu (wkładów: 2).' && w.koniec && w.koniec.blad === '',
        `O1b. parser starego klienta widzi tylko tekst prowadzącego: „${w.tekst}”`);
      const zakazane = w.zdarzenia.filter((e) => ['choices', 'error', 'object'].some((k) => k in e.dane));
      ok(!zakazane.length, 'O1c. żadne zdarzenie zespołu nie ma kluczy choices/error/object');
      const z = await zadania();
      const an = z.find((x) => x.rola === 'ANALITYK'); const re = z.find((x) => x.rola === 'RECENZENT');
      const pr = z.find((x) => x.rodzaj === 'prowadzacy');
      ok(an && re && re.czas >= an.czas && re.tekst.includes('notatka roli ANALITYK'), 'O1d. recenzent w fali 2, na notatkach analityka');
      ok(pr && pr.ostatniaRola === 'user' && pr.ostatnia.includes('NOTATKI ZESPOŁU') && !pr.system.includes('NOTATKI ZESPOŁU'),
        'O1e. notatki w ostatniej wypowiedzi człowieka, nie w system');
      ok(!/PROFIL|KONTEKST PERCEPCJI|JAK ODPOWIADASZ/.test(an.tekst) && an.max_tokens <= 2048, 'O1f. rola bez instrukcji Cosmosa (paczka z białej listy), stały limit tokenów');
      ok(!z.some((x) => /klatka z kamery/i.test(x.tekst)), 'O1g. pytanie bez obrazu – żadna rola ani prowadzący nie dostaje notki o klatce z kamery (runda 11)');
      // O2 – sierota (nikt nie potwierdził odebrania)
      await spij(900);
      const plik = path.join(katalogOsoby(katalog), 'conversations', `${rozmowa}.json`);
      const conv = JSON.parse(fs.readFileSync(plik, 'utf8'));
      const [q, notatki, odp] = conv.messages;
      ok(conv.messages.length === 3 && q.content === pytanie && notatki.narzedzie === 'zespol' && notatki.search === true && notatki.role === 'user'
        && odp.role === 'assistant' && odp.silnik === 'cloud' && odp.model,
        `O2a. w rozmowie: pytanie → notatki (wynik narzędzia) → odpowiedź (${conv.messages.map((m) => m.narzedzie || m.role).join(' → ')})`);
      const wk = (notatki.zespol && notatki.zespol.wklady) || [];
      ok(wk.length === 2 && wk.every((x) => x.silnik && x.model && x.stan === 'gotowa' && x.tresc.length > 10 && x.tresc.length <= 8000)
        && notatki.content.startsWith('NOTATKI ZESPOŁU') && Array.isArray(notatki.zespol.daneWyjdaDo),
        'O2b. wkłady z silnikiem, modelem, stanem i treścią (≤8000), daneWyjdaDo w zapisie');
      // wznowienie od 0 – stany ról == zapis (bieg jeszcze w pamięci, potwierdzenia nie było)
      const r = await fetch(`${ADRES}/api/chat/bieg?id=${w.bieg}&od=0`);
      const wz = { zdarzenia: [], tekst: '', surowe: '' };
      for (const b of (await r.text()).split('\n\n')) if (b.trim()) zjedz(b, wz);
      const st = stanyKoncowe(wz);
      ok(r.status === 200 && wk.every((x) => st[x.r] === x.stan) && wz.tekst === w.tekst, 'O2c. wznowienie od 0: stany ról i odpowiedź == zapis');
    }

    // ------------------------------------------------------------ O3 prywatność
    {
      await zeruj();
      const pytanie = 'Prywatne pytanie o moje finanse, przeanalizuj.';
      const w = await tura({ endpoint: 'local', messages: [{ role: 'user', content: pytanie }],
        zespol: { sklad: [{ rola: 'analityk', silnik: 'claude', model: 'claude-haiku-4-5' }, { rola: 'recenzent' }] } });
      const z = await zadania();
      const doChmury = z.filter((x) => x.silnik !== 'local' && x.rodzaj !== 'szukanie');
      const s = sklad(w);
      const an = s.role.find((r) => r.rola === 'analityk') || {};
      ok(w.status === 200 && doChmury.length === 0, `O3a. lokalny prowadzący bez zgody: 0 żądań do chmury (było ${doChmury.length})`);
      ok(an.silnik === 'local' && an.zamiast && an.zamiast.silnik === 'claude' && /wymaga-zgody/.test(an.powod || ''),
        `O3b. rola z Claude’a → lokalnie, zamiast + powód (${JSON.stringify({ s: an.silnik, z: an.zamiast, p: an.powod })})`);
      const st = await atrapa('local');
      ok(st.maks.local === 1, `O3c. role lokalne po kolei (najwięcej naraz: ${st.maks.local})`);
      await zeruj();
      const w2 = await tura({ endpoint: 'local', messages: [{ role: 'user', content: pytanie }],
        zespol: { sklad: [{ rola: 'analityk', silnik: 'claude', model: 'claude-haiku-4-5' }, { rola: 'recenzent' }], zgoda: { chmura: true } } });
      const z2 = await zadania();
      ok(w2.status === 200 && z2.some((x) => x.silnik === 'claude' && x.rola === 'ANALITYK') && sklad(w2).daneWyjdaDo.includes('Anthropic'),
        'O3d. ze zgodą na chmurę rola idzie do Claude’a, daneWyjdaDo = Anthropic');
    }

    // ------------------------------------------------------------ O4 awarie
    {
      await zeruj();
      const pytanie = 'Awarie: rola-500:ANALITYK@openai rola-cisza:PROGRAMISTA rola-429:BADACZ@openai';
      const t0 = Date.now();
      const w = await tura({ messages: [{ role: 'user', content: pytanie }], zespol: { sklad: [
        { rola: 'analityk', silnik: 'openai', model: 'gpt-4o-mini' }, { rola: 'programista', silnik: 'openai', model: 'gpt-4o-mini' },
        { rola: 'recenzent', silnik: 'cloud' }] } });
      const ms = Date.now() - t0;
      const st = stanyKoncowe(w);
      const zapas = zd(w, 'rola').find((e) => e.r === 'r1' && e.stan === 'zapas');
      const z = await zadania();
      ok(zapas && zapas.silnik === 'cloud' && st.r1 === 'gotowa' && zapas.kod === 'blad'
        && zapas.zamiast && zapas.zamiast.silnik === 'openai' && zapas.zamiast.model === 'gpt-4o-mini',
        `O4a. 500 → zapas na modelu prowadzącego, rola gotowa (${st.r1}); K3: kod „blad” i model pierwotny (${JSON.stringify(zapas && { kod: zapas.kod, zamiast: zapas.zamiast })})`);
      const pr = zd(w, 'rola').filter((e) => e.r === 'r2' && e.ms !== undefined).pop() || {};
      const zapasCiszy = zd(w, 'rola').find((e) => e.r === 'r2' && e.stan === 'zapas');
      // Runda 11 (W1.5): cisza przed pierwszym bajtem → zapas; zapas też milczy → błąd po terminie ciszy.
      ok(st.r2 === 'blad' && pr.kod === 'czas' && zapasCiszy && zapasCiszy.kod === 'cisza' && zapasCiszy.silnik === 'cloud',
        `O4b. cisza przed pierwszym bajtem → zapas (kod ${zapasCiszy && zapasCiszy.kod}); milczy i zapas → błąd po terminie ciszy (${st.r2}, ${pr.kod})`);
      ok(w.koniec && w.koniec.blad === '' && /wkładów: 2/.test(w.tekst) && ms < 8000, `O4c. tura bez błędu w ${ms} ms, prowadzący z 2 wkładami`);
      const prow = z.find((x) => x.rodzaj === 'prowadzacy');
      ok(prow && /NIE DOTARŁO: Programista/.test(prow.ostatnia), 'O4d. prowadzący dostaje „NIE DOTARŁO: Programista”');
      await zeruj();
      const w2 = await tura({ messages: [{ role: 'user', content: 'Limit: rola-429:ANALITYK@openai' }], zespol: { sklad: [
        { rola: 'analityk', silnik: 'openai', model: 'gpt-4o-mini' }, { rola: 'recenzent', silnik: 'cloud' }] } });
      const z2 = await zadania();
      const proby = z2.filter((x) => x.silnik === 'openai' && x.rola === 'ANALITYK').length;
      ok(proby === 2 && stanyKoncowe(w2).r1 === 'gotowa' && zd(w2, 'rola').some((e) => e.r === 'r1' && e.stan === 'zapas' && e.kod === 'limit'),
        `O4e. 429: bez ponowień w zapytajModel, raz z powrotem do kolejki, potem zapas z kodem „limit” (żądań do OpenAI: ${proby})`);
      await zeruj();
      const w3 = await tura({ messages: [{ role: 'user', content: 'Wisi: rola-cisza:ANALITYK@openai' }], zespol: { sklad: [
        { rola: 'analityk', silnik: 'openai', model: 'gpt-4o-mini' }, { rola: 'recenzent', silnik: 'cloud' }] } });
      const kon3 = zd(w3, 'rola').filter((e) => e.r === 'r1' && e.ms !== undefined).pop() || {};
      ok(stanyKoncowe(w3).r1 === 'gotowa' && kon3.zapas && kon3.zapas.kod === 'cisza' && kon3.zapas.silnik === 'cloud'
        && kon3.zapas.zamiast && kon3.zapas.zamiast.model === 'gpt-4o-mini' && /wkładów: 2/.test(w3.tekst),
        `O4f. model milczący przed pierwszym bajtem → zapas na modelu prowadzącego, rola gotowa (${stanyKoncowe(w3).r1}, ${JSON.stringify(kon3.zapas || null)})`);
      // O4g/h (runda 11, W1.6): recenzent nie ląduje na zapasie z rodziny autorów notatek.
      await zeruj();
      const w4 = await tura({ messages: [{ role: 'user', content: 'Recenzja: rola-500:RECENZENT@openai' }], zespol: { sklad: [
        { rola: 'analityk', silnik: 'cloud' }, { rola: 'recenzent', silnik: 'openai', model: 'gpt-4o-mini' }] } });
      const z4r = await zadania();
      const kon4 = zd(w4, 'rola').filter((e) => e.r === 'r2' && e.ms !== undefined).pop() || {};
      ok(stanyKoncowe(w4).r1 === 'gotowa' && kon4.stan === 'blad' && kon4.kod === 'rodzina' && !zd(w4, 'rola').some((e) => e.r === 'r2' && e.stan === 'zapas')
        && !z4r.some((x) => x.rola === 'RECENZENT' && x.silnik === 'cloud') && w4.koniec && w4.koniec.blad === '',
        `O4g. recenzent bez zapasu z rodziny autorów (Nemotron) – recenzja pominięta z kodem „rodzina” (${kon4.stan}, ${kon4.kod})`);
      await zeruj();
      const w5 = await tura({ messages: [{ role: 'user', content: 'Recenzja: rola-500:RECENZENT@claude' }], zespol: { sklad: [
        { rola: 'analityk', silnik: 'openai', model: 'gpt-4o-mini' }, { rola: 'recenzent', silnik: 'claude', model: 'claude-haiku-4-5' }] } });
      const kon5 = zd(w5, 'rola').filter((e) => e.r === 'r2' && e.ms !== undefined).pop() || {};
      ok(kon5.stan === 'gotowa' && kon5.zapas && kon5.zapas.silnik === 'cloud',
        `O4h. autorzy z innej rodziny (OpenAI) – recenzent dalej ma zapas na Nemotronie prowadzącego (${kon5.stan}, ${JSON.stringify(kon5.zapas || null)})`);
      // O4i (runda 11, W1.8): wkład dobił do limitu znaków – strumień przerwany, wkład zachowany jako gotowy (przycięty).
      await zeruj();
      const w6 = await tura({ messages: [{ role: 'user', content: 'Długo: rola-dluga:ANALITYK' }], zespol: { sklad: [{ rola: 'analityk' }, { rola: 'recenzent' }] } });
      const kon6 = zd(w6, 'rola').filter((e) => e.r === 'r1' && e.ms !== undefined).pop() || {};
      const pr6 = (await zadania()).find((x) => x.rodzaj === 'prowadzacy') || { ostatnia: '' };
      ok(kon6.stan === 'gotowa' && kon6.urwane === true && kon6.znakow >= 7900 && kon6.znakow < 8100 && /długi wkład/.test(pr6.ostatnia)
        && !/KONIEC-WKLADU/.test(pr6.ostatnia) && w6.koniec && w6.koniec.blad === '',
        `O4i. wkład ponad limit znaków – strumień przerwany, notatka zachowana (${kon6.stan}, urwane: ${kon6.urwane}, ${kon6.znakow} znaków)`);
    }

    // ------------------------------------------------------------ O5 Stop
    {
      await zeruj();
      let tStop = 0;
      const w = await tura({ messages: [{ role: 'user', content: 'Wolno: rola-wolna:ANALITYK' }], zespol: { uruchom: true } }, {
        wTrakcie: async (bieg) => { await spij(700); tStop = Date.now(); await post('/api/chat/stop', { bieg }); },
      });
      const poStopie = Date.now() - tStop;
      const z = await zadania();
      await spij(150);
      const st = await atrapa('cloud');
      ok(poStopie < 1500 && !z.some((x) => x.rodzaj === 'prowadzacy') && w.tekst === '', `O5a. Stop: koniec po ${poStopie} ms, prowadzący nie ruszył`);
      ok((st.aktywne.cloud || 0) === 0, `O5b. u dostawcy nic nie wisi (aktywnych: ${st.aktywne.cloud})`);
    }

    // ------------------------------------------------------------ O6 Pomiń / Scal
    {
      await zeruj();
      const w = await tura({ messages: [{ role: 'user', content: 'Pomiń i scal: rola-wolna:ANALITYK rola-wolna:PROGRAMISTA' }], zespol: { sklad: [
        { rola: 'analityk' }, { rola: 'programista' }, { rola: 'recenzent' }] } }, {
        wTrakcie: async (bieg) => {
          await spij(500);
          const a = await (await post('/api/zespol/pomin', { bieg, r: 'r2' })).json();
          await spij(300);
          const b = await (await post('/api/zespol/scal', { bieg })).json();
          ok(a.ok === true && b.ok === true, 'O6a. trasy pomiń/scal przyjęły polecenie');
        },
      });
      const st = stanyKoncowe(w);
      ok(st.r2 === 'pominieta' && ['niedokonczona', 'przerwana'].includes(st.r1) && w.koniec && w.koniec.blad === '' && /po scaleniu/.test(w.tekst),
        `O6b. pominięta rola, scalenie bez czekania, odpowiedź prowadzącego (${JSON.stringify(st)})`);
    }

    // ------------------------------------------------------------ O7 planista
    {
      await zeruj();
      const w = await tura({ messages: [{ role: 'user', content: 'plan-smieci proszę o ceny' }], zespol: { uruchom: true } });
      const s = sklad(w);
      ok(s.zrodlo === 'plan' && s.role.map((r) => r.rola).join(',') === 'badacz,recenzent' && !/AKCJA|zly\.pl/.test(JSON.stringify(s)),
        `O7a. brudny JSON planisty → skład (${s.zrodlo}: ${s.role.map((r) => r.rola).join(',')}), znacznik z zadania wycięty`);
      await zeruj();
      const t0 = Date.now();
      const w2 = await tura({ messages: [{ role: 'user', content: 'plan-milczy napisz funkcję w Pythonie' }], zespol: { uruchom: true } });
      const s2 = sklad(w2);
      ok(s2.zrodlo === 'heurystyka' && s2.role.map((r) => r.rola).join(',') === 'programista,recenzent' && Date.now() - t0 < 6000,
        `O7b. milczący planista → heurystyka po terminie (${s2.role.map((r) => r.rola).join(',')}, ${Date.now() - t0} ms)`);
    }

    // ------------------------------------------------------------ O8 wstrzyknięcie
    {
      await zeruj();
      await tura({ messages: [{ role: 'user', content: 'Wstrzyknięcie: rola-wstrzykniecie:ANALITYK' }], zespol: { uruchom: true } });
      const pr = (await zadania()).find((x) => x.rodzaj === 'prowadzacy') || { ostatnia: '' };
      const otw = (pr.ostatnia.match(/<wklad /g) || []).length; const zam = (pr.ostatnia.match(/<\/wklad>/g) || []).length;
      ok(otw === 2 && zam === 2 && !/\[AKCJA/.test(pr.ostatnia), `O8. wkład z „</wklad>” i „[AKCJA]”: bloków ${otw}/${zam}, bez aktywnego znacznika`);
    }

    // ------------------------------------------------------------ O9 badacz
    {
      await zeruj();
      await tura({ messages: [{ role: 'user', content: 'plan-badacz ile kosztuje Galaxy S24?' }], zespol: { uruchom: true } });
      const z = await zadania();
      const b = z.find((x) => x.rola === 'BADACZ'); const r = z.find((x) => x.rola === 'RECENZENT');
      ok(z.some((x) => x.rodzaj === 'szukanie') && b && b.tekst.includes('WYNIK-ATRAPY') && r && !r.tekst.includes('WYNIKI WYSZUKIWANIA:'),
        'O9. badacz dostaje wyniki wyszukiwania z serwera, recenzent nie');
      const pl = z.find((x) => x.rodzaj === 'planista');
      await zeruj();
      await tura({ messages: [{ role: 'user', content: 'Ile kosztuje Galaxy S24?' }], zespol: { sklad: [{ rola: 'badacz', silnik: 'cloud' }, { rola: 'recenzent', silnik: 'cloud' }] } });
      const z2 = await zadania();
      const b2 = z2.find((x) => x.rola === 'BADACZ'); const r2 = z2.find((x) => x.rola === 'RECENZENT');
      ok(b2 && b2.chat_template_kwargs && b2.chat_template_kwargs.enable_thinking === false && pl && pl.chat_template_kwargs
        && pl.chat_template_kwargs.enable_thinking === false && r2 && !r2.chat_template_kwargs,
        'O9b. myślenie: badacz i planista bez myślenia (Nemotron 3), recenzent – jak model chce');
    }

    // ------------------------------------------------------------ O10 stary klient, regeneracja, propozycja
    {
      await zeruj();
      const w = await tura({ messages: [{ role: 'user', content: 'Zrób to zespołem: jak żyć?' }] });
      ok(!w.zdarzenia.length && w.tekst === 'Odpowiedź prowadzącego bez zespołu.', 'O10a. bez payload.zespol (stary klient) – zwykła odpowiedź');
      const w2 = await tura({ messages: [{ role: 'user', content: 'pytanie' }, { role: 'user', content: 'NOTATKI ZESPOŁU – materiał …' }], zespol: { uruchom: true } });
      ok(!zd(w2, 'sklad').length && !(await zadania()).some((x) => x.rodzaj === 'rola'), 'O10b. tura z notatkami (Regeneruj) – zespół nie rusza drugi raz');
      await zeruj();
      const trudne = 'Napisz skrypt w Pythonie, który porówna aktualne ceny obiektywów w 2026 i sprawdź źródła, oraz policz średnią?';
      const w3 = await tura({ messages: [{ role: 'user', content: trudne }], zespol: { auto: true } });
      const typy = w3.zdarzenia.map((e) => e.typ);
      const prop = zd(w3, 'sklad')[0];
      ok(w3.tekst === 'Odpowiedź prowadzącego bez zespołu.' && typy.join() === 'sklad' && prop && prop.propozycja === true && prop.role.length >= 1
        && !(await zadania()).some((x) => x.rodzaj === 'rola'),
        `O10c. „Proponuj”: odpowiedź sama + propozycja składu pod nią, bez ról (${typy.join(',')})`);
      const w4 = await tura({ messages: [{ role: 'user', content: 'Cześć, jak się masz?' }], zespol: { auto: true } });
      ok(!w4.zdarzenia.length, 'O10d. „Proponuj” przy prostym pytaniu – ani planisty w zdarzeniach, ani propozycji');
    }


    // ------------------------------------------------------------ O13 fala 3 – poprawka kodu
    {
      await zeruj();
      const rozmowa = 'rozmowapoprawki1';
      const pytanie = 'plan-kod napisz funkcję sumującą';
      await nowaRozmowa(rozmowa, pytanie);
      const w = await tura({ messages: [{ role: 'user', content: pytanie }], rozmowa, zespol: { uruchom: true } });
      const zdr = zd(w, 'rola');
      const pierwsze = zdr.find((e) => e.r === 'r1p');
      const st = stanyKoncowe(w);
      const z = await zadania();
      const pop = z.filter((x) => x.poprawka);
      const prog = z.find((x) => x.rola === 'PROGRAMISTA' && !x.poprawka);
      const rec = z.find((x) => x.rola === 'RECENZENT');
      const pr = z.find((x) => x.rodzaj === 'prowadzacy') || { ostatnia: '' };
      ok(pierwsze && pierwsze.fala === 3 && pierwsze.poprawkaZ === 'r1' && pierwsze.rola === 'programista' && pierwsze.silnik && pierwsze.model
        && pierwsze.stan === 'czeka' && zdr.indexOf(pierwsze) === zdr.findIndex((e) => e.r === 'r1p') && st.r1p === 'gotowa',
        `O13a. poprawka ogłasza się pierwszym zdarzeniem roli r1p (fala 3, poprawkaZ r1, ${pierwsze && pierwsze.silnik}), kończy „gotowa”`);
      ok(pop.length === 1 && prog && rec && pop[0].silnik === prog.silnik && pop[0].model === prog.model && pop[0].czas >= rec.czas
        && pop[0].role.join() === 'system,user,assistant,user' && pop[0].ostatnia.includes('notatka roli RECENZENT') && pop[0].tekst.includes('notatka roli PROGRAMISTA'),
        'O13b. ten sam model programisty, PO recenzji: jego kod jako asystent, uwagi recenzenta w ostatniej wiadomości');
      ok(pr.ostatnia.includes('KOD-POPRAWIONY') && !pr.ostatnia.includes('notatka roli PROGRAMISTA') && /już poprawiony po uwagach/.test(pr.ostatnia)
        && /wkładów: 2/.test(w.tekst), 'O13c. do prowadzącego idzie wersja poprawiona (dwa wkłady: programista i recenzent)');
      await spij(900);
      const conv = JSON.parse(fs.readFileSync(path.join(katalogOsoby(katalog), 'conversations', `${rozmowa}.json`), 'utf8'));
      const wk = ((conv.messages.find((m) => m.narzedzie === 'zespol') || {}).zespol || {}).wklady || [];
      const w1 = wk.find((x) => x.r === 'r1') || {}; const w3 = wk.find((x) => x.r === 'r1p') || {};
      ok(w1.fala === 1 && w1.tresc.includes('notatka roli PROGRAMISTA') && w3.fala === 3 && w3.poprawkaZ === 'r1' && w3.tresc.includes('KOD-POPRAWIONY'),
        'O13d. zapis: oryginał jako wkład fali 1, poprawka z falą 3 i poprawkaZ');
      await zeruj();
      const w2 = await tura({ messages: [{ role: 'user', content: 'plan-kod rola-bezuwag:RECENZENT' }], zespol: { uruchom: true } });
      ok(!zd(w2, 'rola').some((e) => e.r === 'r1p') && !(await zadania()).some((x) => x.poprawka) && w2.koniec && w2.koniec.blad === '',
        'O13e. recenzent „BEZ UWAG” – bez poprawki');
      await zeruj();
      const w3b = await tura({ messages: [{ role: 'user', content: 'plan-kod poprawka-500' }], zespol: { uruchom: true } });
      const z3 = await zadania();
      const pr3 = z3.find((x) => x.rodzaj === 'prowadzacy') || { ostatnia: '' };
      const prog3 = z3.find((x) => x.rola === 'PROGRAMISTA' && !x.poprawka) || {};
      ok(stanyKoncowe(w3b).r1p === 'blad' && w3b.koniec && w3b.koniec.blad === '' && pr3.ostatnia.includes('notatka roli PROGRAMISTA')
        && !/już poprawiony/.test(pr3.ostatnia) && z3.filter((x) => x.poprawka).every((x) => x.silnik === prog3.silnik && x.model === prog3.model),
        'O13f. nieudana poprawka: bez zapasu na innym modelu, prowadzący dostaje kod z fali 1');
    }

    // ------------------------------------------------------------ O14 fotograf
    {
      await zeruj();
      const w = await tura({ messages: [{ role: 'user', content: 'plan-foto kiedy złota godzina?' }], zespol: { uruchom: true } });
      const s = sklad(w);
      const z = await zadania();
      const f = z.find((x) => x.rola === 'FOTOGRAF') || { ostatnia: '', tekst: '' };
      const r = z.find((x) => x.rola === 'RECENZENT') || { tekst: '' };
      const pr = z.find((x) => x.rodzaj === 'prowadzacy') || { ostatnia: '' };
      ok(s.role.map((x) => x.rola).join() === 'fotograf,recenzent' && s.miejsce === 'Morskie Oko' && s.kiedy === '2026-10-01T18:00',
        `O14a. skład z fotografem; miejsce i kiedy od planisty (${s.miejsce}, ${s.kiedy})`);
      ok(z.some((x) => x.rodzaj === 'geokod' && /morskie oko/i.test(x.tekst)) && f.ostatnia.includes('DANE PLANU (policzone przez Cosmosa):')
        && /49\.2013/.test(f.ostatnia) && !f.ostatnia.includes('plan nie został policzony'),
        'O14b. serwer policzył plan dla miejsca z planisty (geokoder) i dał go fotografowi');
      ok(!/DANE PLANU|49\.2013/.test(r.tekst) && /plan zdjęciowy jest policzony w notatkach fotografa/.test(pr.ostatnia) && !/49\.2013/.test(pr.ostatnia),
        'O14c. plan tylko u fotografa; prowadzący wie, że plan jest w notatkach (bez dublowania liczb)');
      const utc = f.ostatnia.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z/g) || [];
      ok(!utc.length && f.ostatnia.includes('"godziny"') && f.ostatnia.includes('"chwila"') && f.ostatnia.includes('"tryb": "zdjecie"')
        && !f.ostatnia.includes('"ujecia"') && (zd(w, 'faza')[0] || {}).planPoliczony === true,
        `O14e. plan dla roli: godziny czasu miejsca bez pól UTC (${utc.slice(0, 2).join(', ') || 'brak'}), „chwila”, tryb zdjęcie bez listy ujęć; faza prowadzącego mówi planPoliczony`);
      await zeruj();
      await tura({ messages: [{ role: 'user', content: 'plan-foto chcę nakręcić film o zachodzie' }], zespol: { uruchom: true } });
      const fw = (await zadania()).find((x) => x.rola === 'FOTOGRAF') || { ostatnia: '' };
      ok(fw.ostatnia.includes('"tryb": "wideo"'), 'O14f. pytanie o film – plan w trybie wideo');
      await zeruj();
      const wd = await tura({ messages: [{ role: 'user', content: 'plan-foto-data kiedy złota godzina wieczorem?' }], zespol: { uruchom: true } });
      const fd = (await zadania()).find((x) => x.rola === 'FOTOGRAF') || { ostatnia: '' };
      const chwila = (fd.ostatnia.match(/"chwila": "([^"]*)"/) || [])[1] || '';
      const zlota = ((fd.ostatnia.match(/"zlotaWieczor": "(\d{2}:\d{2})/) || [])[1]) || 'brak';
      const minuty = (t) => { const [g, m] = String(t).split(':').map(Number); return g * 60 + m; };
      const godzChwili = (chwila.match(/(\d{2}:\d{2})/) || [])[1] || '';
      ok(sklad(wd).kiedy === '2026-10-01' && chwila.includes('01.10.2026') && /złota godzina/.test(chwila)
        && Math.abs(minuty(godzChwili) - minuty(zlota)) <= 2,
        `O14g. sama data od planisty + pytanie o złotą godzinę – nastawy liczone na jej początek (chwila: ${chwila.slice(0, 40)}; złota od ${zlota})`);
      await zeruj();
      const wz = await tura({ messages: [{ role: 'user', content: 'plan-foto-zladata kiedy złota godzina?' }], zespol: { uruchom: true } });
      const z4 = await zadania();
      const fz = z4.find((x) => x.rola === 'FOTOGRAF') || { ostatnia: '' };
      ok(/brak – plan nie został policzony: nieczytelna data „2026-02-30”/.test(fz.ostatnia) && !z4.some((x) => x.rodzaj === 'geokod')
        && !(zd(wz, 'faza')[0] || {}).planPoliczony, 'O14h. nieistniejąca data od planisty – brak planu (bez liczenia na przeliczoną datę), bez planPoliczony');
      await zeruj();
      await tura({ messages: [{ role: 'user', content: 'Zrób to zespołem: zachód słońca' }],
        zespol: { sklad: [{ rola: 'fotograf' }, { rola: 'analityk' }], miejsce: 'Atlantyda Zaginiona' } });
      const z2 = await zadania();
      const f2 = z2.find((x) => x.rola === 'FOTOGRAF') || { ostatnia: '' };
      const pr2 = z2.find((x) => x.rodzaj === 'prowadzacy') || { ostatnia: '' };
      ok(/brak – plan nie został policzony: nie znaleziono miejsca „Atlantyda Zaginiona”/.test(f2.ostatnia) && !/SPRÓBUJ|Plener →/.test(f2.ostatnia)
        && !/plan zdjęciowy jest policzony/.test(pr2.ostatnia) && /Planu zdjęciowego nie policzono \(nie znaleziono miejsca/.test(pr2.ostatnia),
        'O14d. nieznane miejsce: fotograf dostaje krótkie „brak planu” dla roli (bez poleceń dla człowieka), prowadzący wie, że planu nie ma i godzin nie zgaduje');

      /* Runda 11 (R1, R3). Zapisana lokalizacja (dom) – wtedy instrukcja PLAN
         w ogóle trafia do zwykłego czatu, a plan „bez miejsca” liczyłby się dla domu. */
      await post('/api/location', { location: 'Warszawa', lat: 52.2297, lon: 21.0122 });
      await zeruj();
      const solo = await tura({ messages: [{ role: 'user', content: 'Kiedy dziś złota godzina?' }] });
      const prSolo = (await zadania()).find((x) => x.rodzaj === 'prowadzacy') || { system: '' };
      await zeruj();
      const wp = await tura({ messages: [{ role: 'user', content: 'plan-foto kiedy złota godzina?' }], zespol: { uruchom: true } });
      const zp = await zadania();
      const prP = zp.find((x) => x.rodzaj === 'prowadzacy') || { system: '', ostatnia: '' };
      ok(solo.status === 200 && /NARZĘDZIE – PLAN ZDJĘCIOWY/.test(prSolo.system) && wp.status === 200 && zp.some((x) => x.rola === 'FOTOGRAF')
        && !/PLAN ZDJĘCIOWY/.test(prP.system),
        'O14i. R1: prowadzący w turze zespołu NIE dostaje opisu narzędzia [PLAN:] (zwykły czat z lokalizacją dostaje)');
      const fazaP = zd(wp, 'faza')[0] || {};
      const planK4 = fazaP.plan || {};
      ok(fazaP.planPoliczony === true && /Morskie Oko/.test(planK4.miejsce || '') && /^2026-10-01T\d{2}:\d{2}/.test(planK4.kiedy || '')
        && planK4.strefa === 'Europe/Warsaw' && /01\.10\.2026/.test(planK4.chwila || '')
        && /Plan zdjęciowy policzono dla: Morskie Oko[^.]*01\.10\.2026/.test(prP.ostatnia) && /inne miejsce albo inny czas/.test(prP.ostatnia),
        `O14j. K4: faza niesie plan {miejsce, kiedy, strefa, chwila} (${JSON.stringify(planK4)}); prowadzący dostaje zakres planu od Cosmosa`);
      await zeruj();
      const ww = await tura({ messages: [{ role: 'user', content: 'Jadę na Sycylię, kiedy tam złota godzina?' }],
        zespol: { sklad: [{ rola: 'fotograf' }, { rola: 'analityk' }] } });
      const zw = await zadania();
      const fw2 = zw.find((x) => x.rola === 'FOTOGRAF') || { ostatnia: '' };
      const prW = zw.find((x) => x.rodzaj === 'prowadzacy') || { ostatnia: '' };
      ok(/plan nie został policzony: pytanie dotyczy wyjazdu/.test(fw2.ostatnia) && !/52\.2297|"godziny"/.test(fw2.ostatnia)
        && !(zd(ww, 'faza')[0] || {}).planPoliczony && /Planu zdjęciowego nie policzono \(pytanie dotyczy wyjazdu/.test(prW.ostatnia),
        'O14k. R3: pytanie o wyjazd bez miejsca – brak planu (nie plan domu), prowadzący wie, że godzin nie ma');
      await zeruj();
      await tura({ messages: [{ role: 'user', content: 'Zachód słońca nad Morskim Okiem we wrześniu 2027 – kiedy?' }],
        zespol: { sklad: [{ rola: 'fotograf' }, { rola: 'analityk' }], miejsce: 'Morskie Oko' } });
      const zt = await zadania();
      const ft = zt.find((x) => x.rola === 'FOTOGRAF') || { ostatnia: '' };
      ok(/plan nie został policzony: pytanie podaje termin/.test(ft.ostatnia) && !zt.some((x) => x.rodzaj === 'geokod'),
        'O14l. R3: termin w pytaniu, a planista nie dał „kiedy” – brak planu (nie plan na dziś)');
      await post('/api/location', { location: '' });
    }

    // ------------------------------------------------------------ O15 własna rola
    {
      const zap = await (await post('/api/zespol/ustawienia', { wlasneRole: [{ nazwa: 'Tłumacz', cel: 'przekład na angielski',
        instrukcja: 'INSTRUKCJA-TLUMACZA: tłumacz dosłownie', cechy: ['polski'] }] })).json();
      const id = ((zap.ustawienia || {}).wlasneRole || [{}])[0].id;
      await zeruj();
      const w = await tura({ messages: [{ role: 'user', content: 'plan-wlasna przetłumacz zdanie' }], zespol: { uruchom: true } });
      const s = sklad(w);
      const z = await zadania();
      const pl = z.find((x) => x.rodzaj === 'planista') || { system: '', tekst: '' };
      const t = z.find((x) => x.rola === 'TŁUMACZ') || { system: '', tekst: '' };
      ok(/^w-[0-9a-f]{8}$/.test(id || '') && pl.system.includes(id) && !pl.tekst.includes('INSTRUKCJA-TLUMACZA')
        && s.role[0] && s.role[0].rola === id && s.role[0].wlasna === true && s.role[0].nazwa === 'Tłumacz',
        `O15a. planista widzi własną rolę (bez jej instrukcji) i ją wybiera (${id})`);
      ok(t.system.includes('INSTRUKCJA ROLI (od użytkownika): INSTRUKCJA-TLUMACZA') && !/PROFIL|KONTEKST PERCEPCJI|JAK ODPOWIADASZ/.test(t.tekst)
        && stanyKoncowe(w).r1 === 'gotowa', 'O15b. rola własna: instrukcja osoby w ramie roli, bez instrukcji Cosmosa');
      await post('/api/zespol/ustawienia', { wlasneRole: [] });
    }

    // ------------------------------------------------------------ O16 budżet w zł
    {
      const limit = (dzien) => post('/api/zespol/ustawienia', { budzetZl: { dzien } });
      const cfg = async () => (await (await fetch(`${ADRES}/api/config`)).json()).zespol || {};
      const naClaude = { sklad: [{ rola: 'analityk', silnik: 'claude', model: 'claude-haiku-4-5' }, { rola: 'recenzent', silnik: 'claude', model: 'claude-haiku-4-5' }] };
      const konce = (w) => zd(w, 'rola').filter((e) => e.ms !== undefined);
      await limit(0.01); await zeruj();
      const w1 = await tura({ messages: [{ role: 'user', content: 'Budżet: przeanalizuj' }], zespol: naClaude });
      const s1 = sklad(w1);
      ok(s1.role.length === 2 && s1.role.every((r) => r.silnik === 'cloud' && r.zamiast && r.zamiast.silnik === 'claude' && /budzet/.test(r.powod || ''))
        && !(await zadania()).some((x) => x.silnik === 'claude'), `O16a. płatne role ponad budżet → darmowa chmura, powód „budzet” (${s1.role.map((r) => r.powod).join('; ')})`);
      await limit(50); await zeruj();
      const w2 = await tura({ messages: [{ role: 'user', content: 'Budżet: przeanalizuj' }], zespol: naClaude });
      const s2 = sklad(w2);
      const k2 = konce(w2);
      const faza = zd(w2, 'faza')[0] || {};
      const suma = k2.reduce((a, e) => a + (e.kosztZl || 0), 0);
      const c2 = await cfg();
      ok(s2.role.every((r) => r.silnik === 'claude' && r.szacunekZl > 0) && s2.szacunekZl >= s2.role.reduce((a, r) => a + r.szacunekZl, 0) - 1e-9,
        `O16b. szacunek przed startem: na rolę i całość (${s2.szacunekZl} zł)`);
      ok(k2.length === 2 && k2.every((e) => e.kosztZl > 0 && !e.kosztSzacowany) && Math.abs((faza.kosztZl || 0) - suma) < 0.0002
        && c2.budzet && c2.budzet.wydanoDzis > 0 && c2.budzet.zarezerwowano === 0,
        `O16c. koszt z usage na końcu roli i w fazie prowadzącego (${suma.toFixed(4)} zł), wydatek zapisany, bez wiszących rezerwacji`);
      await zeruj();
      const w3 = await tura({ messages: [{ role: 'user', content: 'Budżet: bez-usage' }], zespol: naClaude });
      ok(konce(w3).every((e) => e.kosztZl > 0 && e.kosztSzacowany === true), 'O16d. bez usage od dostawcy – koszt z szacunku, z flagą');
      await limit(Math.ceil(((await cfg()).budzet.wydanoDzis + 0.5) * 100) / 100); await zeruj();
      const w4 = await tura({ messages: [{ role: 'user', content: 'Budżet: zuzycie-duze' }], zespol: naClaude });
      const r2 = konce(w4).find((e) => e.r === 'r2') || {};
      ok(stanyKoncowe(w4).r1 === 'gotowa' && r2.stan === 'pominieta' && r2.kod === 'budzet' && !(await zadania()).some((x) => x.rola === 'RECENZENT'),
        `O16e. fala 1 wydała ponad budżet → recenzent pominięty bez wywołania (${r2.stan}/${r2.kod})`);
      const w5 = await tura({ endpoint: 'claude', messages: [{ role: 'user', content: 'Budżet: płatny prowadzący' }], zespol: { uruchom: true } });
      let j5 = {}; try { j5 = JSON.parse(w5.blad || '{}'); } catch { /* */ }
      ok(w5.status === 429 && j5.kod === 'budzet-wyczerpany' && j5.error && j5.blad && j5.zostalo === 0,
        `O16f. wyczerpany budżet + płatny prowadzący → 429 budzet-wyczerpany (${w5.status})`);
      await limit(0);
    }

    // ------------------------------------------------------------ O17 głos i zgoda
    {
      await zeruj();
      const t0 = Date.now();
      const r = await post('/api/zespol/plan', { endpoint: 'cloud', pytanie: 'plan-milczy Zrób to zespołem: przeanalizuj', trybGlosowy: true });
      const msGlos = Date.now() - t0; const j = await r.json();
      const t1 = Date.now();
      await post('/api/zespol/plan', { endpoint: 'cloud', pytanie: 'plan-milczy Zrób to zespołem: przeanalizuj' });
      const msTekst = Date.now() - t1;
      ok(r.status === 200 && j.sklad && j.sklad.zrodlo === 'heurystyka' && msGlos < 1300 && msTekst >= 1400,
        `O17a. głos: planista krócej (${msGlos} ms wobec ${msTekst} ms)`);
      await zeruj();
      /* Z8: przeglądarka staje na `sklad` z wymagaZgody i woła Stop – serwer
         w tym czasie nie rusza ŻADNEJ roli (także lokalnej). */
      let poSkladzie = null;
      const w = await tura({ endpoint: 'local', trybGlosowy: true, messages: [{ role: 'user', content: 'Zrób to zespołem: przeanalizuj' }], zespol: { uruchom: true } }, {
        wTrakcie: async (bieg, wy) => {
          for (let i = 0; i < 100 && !wy.zdarzenia.some((e) => e.typ === 'sklad'); i++) await spij(50);
          await spij(600);
          poSkladzie = (await zadania()).filter((x) => x.rodzaj === 'rola').length;
          await post('/api/chat/stop', { bieg });
        },
      });
      const s = sklad(w);
      const z = await zadania();
      ok(s.wymagaZgody === true && (s.silnikiZaZgoda || []).length > 0 && (s.daneWyjdaDoZaZgoda || []).length > 0 && s.role.length
        && s.role.every((x) => x.silnik === 'local') && !z.some((x) => x.silnik !== 'local' && !['szukanie', 'geokod'].includes(x.rodzaj)),
        `O17b. głos, lokalny prowadzący bez zgody: role lokalnie, 0 żądań do chmury, sklad mówi wymagaZgody (${(s.daneWyjdaDoZaZgoda || []).join(',')})`);
      ok(poSkladzie === 0 && !z.some((x) => x.rodzaj === 'rola' || x.rodzaj === 'prowadzacy') && w.koniec && w.koniec.blad === '',
        `O17d. głos + wymagaZgody: serwer czeka na zgodę – żadna rola (także lokalna) nie rusza przed Stop (ról: ${poSkladzie})`);
      const p = await (await post('/api/zespol/plan', { endpoint: 'local', pytanie: 'Zrób to zespołem: przeanalizuj', trybGlosowy: true })).json();
      ok(p.wymagaZgody === 'chmura' && (p.silnikiZaZgoda || []).length > 0, 'O17c. „tylko plan” w głosie też mówi o zgodzie i dokąd');
    }

    // ------------------------------------------------------------ O18–O21 poprawki po przeglądzie dokładek
    {
      const limit = (dzien) => post('/api/zespol/ustawienia', { budzetZl: { dzien } });
      const bud = async () => ((await (await fetch(`${ADRES}/api/config`)).json()).zespol || {}).budzet || {};
      const konce = (w) => zd(w, 'rola').filter((e) => e.ms !== undefined);
      await limit(50);
      // O18 – przerwana płatna rola kosztuje (Scal teraz w połowie strumienia, bez usage).
      await zeruj();
      const przed = (await bud()).wydanoDzis || 0;
      const w18 = await tura({ messages: [{ role: 'user', content: 'Scal płatnie: rola-dluga:ANALITYK rola-wolna:ANALITYK' }],
        zespol: { sklad: [{ rola: 'analityk', silnik: 'claude', model: 'claude-haiku-4-5' }, { rola: 'recenzent', silnik: 'cloud' }] } }, {
        wTrakcie: async (bieg) => { await spij(1500); await post('/api/zespol/scal', { bieg }); },
      });
      const k18 = konce(w18).find((e) => e.r === 'r1') || {};
      const b18 = await bud();
      ok(k18.stan === 'niedokonczona' && k18.kosztZl > 0 && k18.kosztSzacowany === true && b18.wydanoDzis > przed && b18.zarezerwowano === 0,
        `O18. „Scal teraz” w trakcie płatnej roli: koszt z szacunku (${k18.kosztZl} zł, ${k18.stan}), wydatek zapisany, bez wiszących rezerwacji`);
      // O19 – planista po terminie (płatny, bez strumienia) kosztuje co najmniej szacunek.
      await zeruj();
      const przed19 = (await bud()).wydanoDzis || 0;
      const j19 = await (await post('/api/zespol/plan', { endpoint: 'claude', pytanie: 'plan-milczy Zrób to zespołem: przeanalizuj' })).json();
      const b19 = await bud();
      ok(j19.sklad && j19.sklad.zrodlo === 'heurystyka' && j19.kosztPlanistyZl > 0 && b19.wydanoDzis > przed19 && b19.zarezerwowano === 0,
        `O19. płatny planista po terminie – koszt z szacunku (${j19.kosztPlanistyZl} zł), bez wiszącej rezerwacji`);
      // O20 – prowadzący rezerwuje budżet (C1/C6); odmowa kończy turę, notatki zostają.
      await zeruj();
      const naChmurze = { sklad: [{ rola: 'analityk', silnik: 'cloud' }, { rola: 'recenzent', silnik: 'cloud' }] };
      await limit(Math.ceil(((await bud()).wydanoDzis + 0.005) * 100) / 100);
      const w20 = await tura({ endpoint: 'claude', messages: [{ role: 'user', content: 'Prowadzący płatny: przeanalizuj' }], zespol: naChmurze });
      const s20 = sklad(w20);
      const z20 = await zadania();
      ok(w20.status === 200 && s20.szacunekProwadzacyZl > 0 && s20.szacunekZl >= s20.szacunekProwadzacyZl - 1e-9
        && w20.koniec && /nie wystarczy na odpowiedź prowadzącego/.test(w20.koniec.blad) && w20.koniec.kod === 'budzet-wyczerpany'
        && !z20.some((x) => x.rodzaj === 'prowadzacy') && z20.some((x) => x.rola === 'ANALITYK') && (await bud()).zarezerwowano === 0,
        `O20a. prowadzący ponad budżet: bez wywołania, koniec z kodem budzet-wyczerpany; szacunek składu z prowadzącym (${s20.szacunekProwadzacyZl} z ${s20.szacunekZl} zł)`);
      await limit(50); await zeruj();
      const w20b = await tura({ endpoint: 'claude', messages: [{ role: 'user', content: 'Prowadzący płatny: przeanalizuj' }], zespol: naChmurze });
      ok(w20b.koniec && w20b.koniec.blad === '' && /po scaleniu/.test(w20b.tekst) && (await bud()).zarezerwowano === 0,
        'O20b. prowadzący w budżecie odpowiada; po turze nic nie zostaje zarezerwowane');
      // O21 – fala 3: urwana na limicie, bez kodu, fragmentem – do prowadzącego idzie kod z fali 1; „BEZ UWAG” z dopiskiem – bez fali 3.
      const fala3 = async (slowa) => {
        await zeruj();
        const w = await tura({ messages: [{ role: 'user', content: `plan-kod prog-kod ${slowa}` }], zespol: { uruchom: true } });
        const z = await zadania();
        return { w, st: stanyKoncowe(w), pr: (z.find((x) => x.rodzaj === 'prowadzacy') || { ostatnia: '' }).ostatnia, z };
      };
      const pelna = await fala3('');
      ok(pelna.st.r1p === 'gotowa' && pelna.pr.includes('KOD-POPRAWIONY') && !pelna.pr.includes('KOD-ORYGINALNY') && /już poprawiony/.test(pelna.pr),
        'O21a. pełna poprawka (domknięty kod) – do prowadzącego idzie wersja poprawiona');
      const dl = await fala3('poprawka-length');
      const kDl = konce(dl.w).find((e) => e.r === 'r1p') || {};
      ok(dl.st.r1p === 'urwana' && kDl.urwane === true && dl.pr.includes('KOD-ORYGINALNY') && !/już poprawiony/.test(dl.pr),
        `O21b. poprawka urwana na limicie tokenów – stan „urwana”, prowadzący dostaje kod z fali 1 (${dl.st.r1p})`);
      const bk = await fala3('poprawka-bez-kodu'); const fr = await fala3('poprawka-fragment');
      ok([bk, fr].every((x) => x.pr.includes('KOD-ORYGINALNY') && !x.pr.includes('KOD-POPRAWIONY') && !/już poprawiony/.test(x.pr)),
        'O21c. poprawka bez kodu albo fragmentem („# ... reszta bez zmian”) – prowadzący dostaje pełny kod z fali 1');
      const lg = await fala3('recenzja-lgtm');
      ok(!zd(lg.w, 'rola').some((e) => e.r === 'r1p') && !lg.z.some((x) => x.poprawka),
        'O21d. recenzja „BEZ UWAG – kod jest poprawny” – bez fali 3');
      await limit(0);
    }

    // ------------------------------------------------------------ O22–O24 skład „Darmowe modele” (runda 10, paczka Z)
    {
      // O22 (Z5): obraz ogląda rola „oko”, prowadzący zostaje tekstowy i dostaje opis zamiast obrazu.
      await zeruj();
      const { PNG_SONDY_WZROKU } = require(path.join(KORZEN, 'lib/umiejetnosci.js'));
      const w22 = await tura({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Co jest na tym zdjęciu? plan-oko' }, { type: 'image_url', image_url: { url: PNG_SONDY_WZROKU } }] }],
        zespol: { uruchom: true } });
      const z22 = await zadania();
      const oko = z22.find((x) => x.rola === 'OKO'); const pr22 = z22.find((x) => x.rodzaj === 'prowadzacy');
      ok(w22.status === 200 && oko && oko.obraz && pr22 && !pr22.obraz && pr22.model === 'nvidia/nemotron-3-super-120b-a12b'
        && /obejrzała go rola zespołu „Oko”/i.test(pr22.system) && /wkładów: 2/.test(w22.tekst),
        `O22. obraz → rola „oko” (${oko && `${oko.silnik}:${oko.model}`}), prowadzący na modelu tekstowym bez obrazu (${pr22 && pr22.model}, obraz: ${pr22 && pr22.obraz}; status ${w22.status})`);

      /* O22b (runda 11, W1.4): model oka niedostępny (404), a silnik zapasu nie ma modelu wizyjnego –
         bez zapasu na ślepym prowadzącym (opisałby zdjęcie z wyobraźni); prowadzący bez obrazu
         dostaje zdanie, że obrazu nikt nie obejrzał (nie „Obejrzała go rola Oko”), tura bez błędu. */
      await zeruj();
      const w22b = await tura({ messages: [{ role: 'user', content: [{ type: 'text', text: 'Co jest na tym zdjęciu? plan-oko model-404:gpt-4o-mini' },
        { type: 'image_url', image_url: { url: PNG_SONDY_WZROKU } }] }], zespol: { uruchom: true } });
      const z22b = await zadania();
      const pr22b = z22b.find((x) => x.rodzaj === 'prowadzacy') || { system: '' };
      const okoR = (sklad(w22b).role.find((r) => r.rola === 'oko') || {}).r;
      ok(w22b.status === 200 && okoR && !zd(w22b, 'rola').some((e) => e.r === okoR && e.stan === 'zapas') && stanyKoncowe(w22b)[okoR] === 'blad'
        && !z22b.some((x) => x.rola === 'OKO' && x.silnik === 'cloud') && pr22b.system && !pr22b.obraz
        && /nie udało się go obejrzeć/.test(pr22b.system) && !/Obejrzała go rola/.test(pr22b.system) && w22b.koniec && w22b.koniec.blad === '',
        `O22b. oko bez modelu wizyjnego na zapas – bez zapasu na ślepym modelu, prowadzący wie, że obrazu nie obejrzano (${okoR}: ${stanyKoncowe(w22b)[okoR]}; koniec: ${w22b.koniec && w22b.koniec.blad})`);

      /* O23: tura „tylko darmowe” przy płatnym prowadzącym. Runda 11 (W1.3): zalecany
         model wchodzi do puli dopiero po udanej sondzie; rola, której model odpowiada
         404 „Not found for account”, schodzi na darmowy zapas z kodem „wycofany”
         (K3), a rejestr zapamiętuje awarię – następny skład go nie bierze. */
      const ULTRA = 'nvidia/nemotron-3-ultra-550b-a55b'; const DSV4 = 'deepseek-ai/deepseek-v4.1-flash';
      const { ZALECANE_DARMOWE } = require(path.join(KORZEN, 'lib/umiejetnosci.js'));
      const zalecane = new Set(Object.values(ZALECANE_DARMOWE).flat().filter((id) => id !== 'nvidia/nemotron-3-super-120b-a12b'));
      const planD = async () => (await post('/api/zespol/plan', { messages: [{ role: 'user', content: 'Jak rozłożyć budżet domowy?' }], endpoint: 'claude',
        sklad: [{ rola: 'analityk' }, { rola: 'recenzent' }], tylkoDarmowe: true })).json();
      const rejestr = () => { try { return JSON.parse(fs.readFileSync(path.join(srv.katalogDanych, 'konta', 'modele-sprawdzone.json'), 'utf8')).sprawdzone || {}; } catch { return {}; } };
      const przed = await planD();
      const kandPrzed = Object.values((przed.sklad || {}).kandydaci || {}).flat().map((k) => k.model);
      ok(przed.sklad && przed.sklad.role.length && !przed.sklad.role.some((r) => zalecane.has(r.model)) && !kandPrzed.some((m) => zalecane.has(m)),
        `O23a. bez sondy zalecane darmowe (dawniej wycofane przez NVIDIĘ) nie wchodzą do puli (${przed.sklad && przed.sklad.role.map((r) => r.model).join(',')})`);
      for (const model of [ULTRA, DSV4]) await post('/api/models/check', { endpoint: 'cloud', model });
      await zeruj();
      const w23 = await tura({ endpoint: 'claude', messages: [{ role: 'user', content: 'Jak rozłożyć budżet domowy? model-404:ultra-550b' }],
        zespol: { sklad: [{ rola: 'analityk' }, { rola: 'recenzent' }], tylkoDarmowe: true } });
      const z23 = await zadania();
      const s23 = sklad(w23);
      const zapas23 = zd(w23, 'rola').find((e) => e.stan === 'zapas');
      ok(w23.status === 200 && s23.tylkoDarmowe === true && s23.role.length === 2 && s23.role.every((r) => ['cloud', 'local'].includes(r.silnik))
        && s23.role[0].model === ULTRA
        && !z23.some((x) => x.rodzaj === 'rola' && ['claude', 'openai'].includes(x.silnik)) && z23.some((x) => x.rodzaj === 'prowadzacy' && x.silnik === 'claude')
        && zapas23 && zapas23.silnik === 'cloud' && zapas23.kod === 'wycofany' && zapas23.zamiast && zapas23.zamiast.model === ULTRA
        && stanyKoncowe(w23).r1 === 'gotowa',
        `O23. „tylko darmowe” z prowadzącym Claude: zalecany po sondzie, 404 → zapas „wycofany” na domyślnym modelu chmury, zero ról na płatnych (${z23.filter((x) => x.rodzaj === 'rola').map((x) => `${x.rola}@${x.silnik}:${x.model}`).join(', ')})`);
      const po = await planD();
      const wpis = rejestr()[`cloud|${ULTRA}`] || {};
      ok(wpis.rozmowa === false && po.sklad && po.sklad.role.length && !po.sklad.role.some((r) => r.model === ULTRA)
        && po.sklad.role.some((r) => r.model === DSV4),
        `O23b. pamięć awarii: 404 roli zapisany jak nieudana sonda, następny skład bez tego modelu (${po.sklad && po.sklad.role.map((r) => r.model).join(',')})`);

      // O24: plan dla bramki – oba składy, kandydaci do edytora i ustawienie osoby; „Darmowe modele” nie zmienia proponowanego.
      const plan = async () => (await post('/api/zespol/plan', { messages: [{ role: 'user', content: 'Jak rozłożyć budżet domowy na trzy cele?' }], endpoint: 'cloud',
        modele: { claude: 'claude-sonnet-5' } })).json();
      const p24 = await plan();
      await post('/api/zespol/ustawienia', { skladDomyslny: 'darmowy' });
      const p24b = await plan();
      await post('/api/zespol/ustawienia', { skladDomyslny: 'proponowany' });
      const d24 = p24.sklad && p24.sklad.darmowe;
      ok(p24.sklad.role.some((r) => r.silnik === 'claude') && d24 && d24.role.length === 2 && d24.role.every((r) => !['claude', 'openai'].includes(r.silnik))
        && d24.szacunekZl === 0 && d24.prowadzacyPlatny === false && p24.sklad.skladDomyslny === 'proponowany'
        && Array.isArray((p24.sklad.kandydaci || {}).analityk) && p24b.sklad.skladDomyslny === 'darmowy' && p24b.sklad.darmowe
        && p24b.sklad.role.some((r) => r.silnik === 'claude'),
        `O24. /api/zespol/plan: proponowany (${p24.sklad.role.map((r) => r.silnik).join(',')}) + darmowe (${d24 && d24.role.map((r) => r.model.split('/').pop()).join(',')}, ${d24 && d24.szacunekZl} zł), kandydaci, skladDomyslny z ustawień`);
    }

    // ------------------------------------------------------------ O11 limit naraz
    {
      await zeruj();
      const wolno = { messages: [{ role: 'user', content: 'rola-wolna:ANALITYK' }], zespol: { sklad: [{ rola: 'analityk' }, { rola: 'recenzent' }] } };
      const a = tura(wolno); const b = tura(wolno);
      await spij(300);
      const c = await tura(wolno);
      ok(c.status === 409 && /zespol-zajety/.test(c.blad || ''), `O11. trzeci zespół właściciela naraz → 409 (${c.status})`);
      await Promise.all([a, b]);
    }

    // ------------------------------------------------------------ O12 SIGTERM
    /* Restart daje biegom 2,5 s na dokończenie. W tym czasie rola z kolejki
       (lokalny GPU: jedna naraz) mogłaby ruszyć – płatne wywołanie, którego
       wyniku nikt nie zobaczy. */
    {
      await zeruj();
      const p = tura({ endpoint: 'local', messages: [{ role: 'user', content: 'Restart w kolejce: rola-wolna:ANALITYK' }],
        zespol: { sklad: [{ rola: 'analityk', silnik: 'local' }, { rola: 'programista', silnik: 'local' }] } }).catch(() => null);
      await spij(400);
      srv.kill('SIGTERM');
      for (let i = 0; i < 60 && srv.exitCode === null; i++) await spij(100);
      await p;
      const po = await zadania();
      ok(srv.exitCode !== null && !po.some((x) => x.rola === 'PROGRAMISTA' || x.rodzaj === 'prowadzacy'),
        `O12a. po SIGTERM rola z kolejki i prowadzący nie ruszają (${po.map((x) => x.rola || x.rodzaj).join(',')})`);
    }
    srv = serwerCosmosa(PORT, env);
    if (!await czekajNa(ADRES)) throw new Error('serwer po restarcie nie wstał');
    {
      await zeruj();
      const rozmowa = 'rozmowarestart1';
      const pytanie = 'Restart: rola-wolna:ANALITYK rola-dluga:ANALITYK rola-wolna:RECENZENT';
      await nowaRozmowa(rozmowa, pytanie);
      const p = tura({ messages: [{ role: 'user', content: pytanie }], rozmowa, zespol: { sklad: [{ rola: 'analityk' }, { rola: 'programista' }, { rola: 'recenzent' }] } }).catch(() => null);
      await spij(900);
      srv.kill('SIGTERM');
      for (let i = 0; i < 60 && srv.exitCode === null; i++) await spij(100);
      await p;
      const plik = path.join(katalogOsoby(srv.katalogDanych), 'conversations', `${rozmowa}.json`);
      const conv = JSON.parse(fs.readFileSync(plik, 'utf8'));
      const notatki = conv.messages.find((m) => m.narzedzie === 'zespol');
      const stany = notatki ? notatki.zespol.wklady.map((x) => x.stan) : [];
      ok(notatki && stany.length === 3 && stany.every((s) => ['gotowa', 'niedokonczona', 'przerwana', 'blad', 'pominieta', 'urwana'].includes(s))
        && notatki.zespol.wklady.some((x) => x.tresc),
        `O12b. w rozmowie notatki z domkniętymi stanami (${stany.join(',')})`);
    }
    // ------------------------------------------------------------ O13g za mało czasu na poprawkę
    zabij(srv);
    for (let i = 0; i < 60 && srv.exitCode === null; i++) await spij(100);
    // Sonda zalecanych przy starcie – na atrapie tylko na jawne COSMOS_SONDA_ZALECANYCH_PO_MS (O25).
    srv = serwerCosmosa(PORT, { ...env, COSMOS_ZESPOL_MIN_NA_POPRAWKE_MS: '60000', COSMOS_SONDA_ZALECANYCH_PO_MS: '100',
      COSMOS_SONDA_ZALECANYCH_PRZERWA_MS: '0' });
    if (!await czekajNa(ADRES)) throw new Error('serwer (bez czasu na poprawkę) nie wstał');
    {
      await zeruj();
      const w = await tura({ messages: [{ role: 'user', content: 'plan-kod napisz funkcję' }], zespol: { uruchom: true } });
      ok(stanyKoncowe(w).r2 === 'gotowa' && !zd(w, 'rola').some((e) => e.r === 'r1p') && !(await zadania()).some((x) => x.poprawka),
        'O13g. do końca fazy zostało mniej niż próg – bez poprawki kodu');
    }
    {
      // O25 (runda 11, W1.3): sonda zalecanych darmowych w tle po starcie – każdy zalecany ma świeży wynik w rejestrze.
      const { ZALECANE_DARMOWE } = require(path.join(KORZEN, 'lib/umiejetnosci.js'));
      const ids = [...new Set(Object.values(ZALECANE_DARMOWE).flat())];
      const plik = path.join(srv.katalogDanych, 'konta', 'modele-sprawdzone.json');
      const wpisy = () => { try { return JSON.parse(fs.readFileSync(plik, 'utf8')).sprawdzone || {}; } catch { return {}; } };
      for (let i = 0; i < 50 && !ids.every((id) => wpisy()[`cloud|${id}`]); i++) await spij(100);
      const w = wpisy();
      ok(ids.every((id) => w[`cloud|${id}`] && w[`cloud|${id}`].rozmowa === true) && !JSON.stringify(w).includes('127.0.0.1'),
        `O25. sonda zalecanych przy starcie: ${ids.filter((id) => w[`cloud|${id}`]).length}/${ids.length} w rejestrze (bez adresów)`);
    }
    {
      /* O26 (runda 11, W1.10): przerwana odpowiedź prowadzącego w turze zespołu kieruje do
         „Złóż ponownie” (notatki zostają), a zwykły czat – do „Ponów”. Wprost na lib/czat.js. */
      const C = require(path.join(KORZEN, 'lib/czat.js'));
      const powody = [];
      const czatU = C.utworz({ biegi: { zakoncz: (b, p) => powody.push(p), dopisz: () => {}, dopiszZdarzenie: () => {} }, scrubSecrets: (t) => t, U: () => ({}) });
      const strumien = () => new Response(new ReadableStream({ start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Początek odpowiedzi ' } }] })}\n\n`));
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: { message: 'coś dziwnego' } })}\n\n`));
        c.close();
      } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      const opcje = () => ({ ep: { label: 'x', baseUrl: 'http://x' }, model: 'm', payload: { endpoint: 'cloud' }, abort: new AbortController(),
        zegar: C.zegarCiszy(new AbortController()) });
      const log = console.warn; console.warn = () => {};
      await czatU.pompujDoBiegu({ id: 'z', tekst: '', zespol: { faza: 'prowadzacy' } }, strumien(), opcje());
      await czatU.pompujDoBiegu({ id: 's', tekst: '' }, strumien(), opcje());
      console.warn = log;
      ok(/Złóż ponownie/.test(powody[0] || '') && !/Ponów/.test(powody[0] || '') && /Ponów/.test(powody[1] || ''),
        `O26. przerwany prowadzący zespołu → „Złóż ponownie”, zwykły czat → „Ponów” (${powody.map((x) => x.slice(0, 70)).join(' | ')})`);
    }
  } catch (err) {
    fail.push(`wyjątek: ${err.stack || err.message}`);
  } finally {
    zabij(srv); zabij(procAtrapy);
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nzespol-orkiestrator OK');
  process.exit(fail.length ? 1 : 0);
})();

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
       notatki z DOMKNIĘTYMI stanami ról (nic „pisze”). */
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
      ok(zapas && zapas.silnik === 'cloud' && st.r1 === 'gotowa', `O4a. 500 → zapas na modelu prowadzącego, rola gotowa (${st.r1})`);
      const pr = zd(w, 'rola').filter((e) => e.r === 'r2' && e.ms !== undefined).pop() || {};
      ok(st.r2 === 'blad' && pr.kod === 'czas', `O4b. cisza → rola kończy się po terminie ciszy (${st.r2}, ${pr.kod})`);
      ok(w.koniec && w.koniec.blad === '' && /wkładów: 2/.test(w.tekst) && ms < 8000, `O4c. tura bez błędu w ${ms} ms, prowadzący z 2 wkładami`);
      const prow = z.find((x) => x.rodzaj === 'prowadzacy');
      ok(prow && /NIE DOTARŁO: Programista/.test(prow.ostatnia), 'O4d. prowadzący dostaje „NIE DOTARŁO: Programista”');
      await zeruj();
      const w2 = await tura({ messages: [{ role: 'user', content: 'Limit: rola-429:ANALITYK@openai' }], zespol: { sklad: [
        { rola: 'analityk', silnik: 'openai', model: 'gpt-4o-mini' }, { rola: 'recenzent', silnik: 'cloud' }] } });
      const z2 = await zadania();
      const proby = z2.filter((x) => x.silnik === 'openai' && x.rola === 'ANALITYK').length;
      ok(proby === 2 && stanyKoncowe(w2).r1 === 'gotowa' && zd(w2, 'rola').some((e) => e.r === 'r1' && e.stan === 'zapas'),
        `O4e. 429: bez ponowień w zapytajModel, raz z powrotem do kolejki, potem zapas (żądań do OpenAI: ${proby})`);
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
  } catch (err) {
    fail.push(`wyjątek: ${err.stack || err.message}`);
  } finally {
    zabij(srv); zabij(procAtrapy);
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nzespol-orkiestrator OK');
  process.exit(fail.length ? 1 : 0);
})();

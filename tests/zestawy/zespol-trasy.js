/* Zespół agentów – konta, uprawnienia i trasy /api/zespol/* (serwer z logowaniem).

   Właściciel Marcin, członkini Ania (bez przyznań), członek Bartek (Claude
   i lokalny GPU przyznane). Atrapa tests/atrapy/mock-zespol.js na 7525–7528.

   Gwarancje:
   T1. /api/config.zespol – bez kluczy i adresów; członek: sufit 3 ról;
       katalog ról bez instrukcji dla modelu;
   T2. ustawienia na serwerze, per osoba: maxRol przycięte do sufitu, silnik
       roli spoza uprawnień odrzucony; ustawienia Ani nie zmieniają Marcina;
   T3. członek BEZ przyznania „zespol”: rola zaproponowana na przyznanym
       Claude idzie na chmurę wspólną (`zamiast`, powód
       `zespol-nie-przyznany`), na kluczu właściciela jest nadal JEDNO
       wywołanie (prowadzący), planista też nie na Claude;
   T4. z przyznaniem: rola na Claude, model z listy właściciela, max_tokens
       ≤ sufit członka; liczniki zużycia rosną per silnik;
   T5. konto czytane świeżo przed każdą rolą: odebrane przyznanie w trakcie
       tury – recenzent (fala 2) już nie idzie na Claude;
   T6. jeden zespół naraz u członka → 409 zespol-zajety;
   T7. własny klucz członka: rola płacona jego kluczem; ani klucz, ani adres
       lokalnego silnika nie trafia do strumienia ani do pliku rozmowy;
   T8. „tylko plan” (/api/zespol/plan): bez biegu i bez wywołań ról;
       lokalny prowadzący bez zgody – rola z chmury przeniesiona lokalnie,
       `wymagaZgody: 'chmura'`;
   T9. limit dobowy członka: po wyczerpaniu – zdarzenie `odmowa`
       (limit-dobowy) i odpowiedź samego prowadzącego. */
const fs = require('fs');
const path = require('path');
const { KORZEN, ATRAPY, serwerCosmosa, uruchom, czekajNa, zabij, zwolnijPorty, katalogOsoby } = require('../pomoc');

const PORT = 3522;
const A = { cloud: 7525, local: 7526, openai: 7527, claude: 7528 };
const ADRES = `http://127.0.0.1:${PORT}`;
const HASLO = 'haslo-wlasciciela-zespol-1';
const KLUCZ_CLAUDE_W = 'sk-ant-wlasciciela-zespol-00001';
const KLUCZ_OPENAI_ANI = 'sk-ania-wlasny-klucz-0000000099';
const spij = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = [];
const ok = (warunek, opis) => { console.log(`${warunek ? '✓' : '✗'} ${opis}`); if (!warunek) fail.push(opis); };
let nr = 0;
const bieg = () => `trasy-zespol-${Date.now().toString(36)}-${++nr}`;

function klient(ip) {
  let ciastko = '';
  const k = {
    async zadaj(sciezka, { metoda = 'GET', dane } = {}) {
      const r = await fetch(`${ADRES}${sciezka}`, {
        method: metoda,
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(ciastko ? { Cookie: ciastko } : {}) },
        body: dane === undefined ? undefined : JSON.stringify(dane),
      });
      const sc = r.headers.get('set-cookie');
      if (sc) ciastko = sc.split(';')[0];
      const tekst = await r.text();
      let json = {};
      try { json = JSON.parse(tekst); } catch { /* strumień */ }
      return { kod: r.status, json, tekst };
    },
    /** Tura czatu: surowy strumień i zdarzenia. */
    async tura(dane) {
      const w = await k.zadaj('/api/chat', { metoda: 'POST', dane: { bieg: bieg(), ...dane } });
      const zdarzenia = [];
      w.odpowiedz = '';
      for (const b of w.tekst.split('\n\n')) {
        const t = (b.match(/^event: (\w+)/m) || [])[1];
        const d = (b.match(/^data: (.*)$/m) || [])[1];
        if (t && d) { try { zdarzenia.push({ typ: t, dane: JSON.parse(d) }); } catch { /* */ } }
        else if (d) { try { w.odpowiedz += JSON.parse(d).choices?.[0]?.delta?.content ?? ''; } catch { /* [DONE] */ } }
      }
      w.zdarzenia = zdarzenia;
      w.sklad = (zdarzenia.find((e) => e.typ === 'sklad') || {}).dane || { role: [], odrzucone: [] };
      return w;
    },
  };
  return k;
}
const zadania = async () => (await (await fetch(`http://127.0.0.1:${A.cloud}/__stan`)).json()).zadania;
const zeruj = () => fetch(`http://127.0.0.1:${A.cloud}/__zeruj`);

(async () => {
  await zwolnijPorty([PORT, ...Object.values(A)]);
  const atrapa = uruchom('node', [path.join(ATRAPY, 'mock-zespol.js')], { cwd: ATRAPY, env: { ...process.env, ZESPOL_PORTY: Object.values(A).join(',') } });
  await spij(700);
  const srv = serwerCosmosa(PORT, {
    COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin',
    NVIDIA_API_KEY: 'test-nvidia', LOCAL_API_KEY: 'test',
    NEMOTRON_BASE_URL: `http://127.0.0.1:${A.cloud}/v1`, NEMOTRON_MODEL: 'nvidia/nemotron-3-super-120b-a12b',
    LOCAL_BASE_URL: `http://127.0.0.1:${A.local}/v1`, LOCAL_MODEL: 'qwen3:8b',
    OPENAI_API_KEY: 'sk-openai-wlasciciela-zespol-01', OPENAI_BASE_URL: `http://127.0.0.1:${A.openai}/v1`, OPENAI_MODEL: 'gpt-4o-mini',
    ANTHROPIC_API_KEY: KLUCZ_CLAUDE_W, ANTHROPIC_BASE_URL: `http://127.0.0.1:${A.claude}/v1`, CLAUDE_MODEL: 'claude-haiku-4-5',
    COSMOS_MODELE_PRZYZNANE: 'claude-haiku-4-5', COSMOS_ZESPOL_NA_DOBE: '5',
    COSMOS_ZESPOL_CISZA_MS: '3000', COSMOS_ZESPOL_TERMIN_PLANISTY_MS: '1500', COSMOS_BIEG_SIEROTA_MS: '300',
  });
  try {
    if (!(await czekajNa(`${ADRES}/api/auth`))) throw new Error('serwer nie wstał');
    const marcin = klient('10.2.0.1');
    await marcin.zadaj('/api/login', { metoda: 'POST', dane: { password: HASLO } });
    const nowy = async (nazwa, login, ip) => {
      const zap = await marcin.zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa } });
      const k = klient(ip);
      const p = await k.zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token: zap.json.token, login, haslo: `haslo-${login}-12345` } });
      if (p.kod !== 200) throw new Error(`konto ${login}: ${p.tekst}`);
      k.id = p.json.uzytkownik.id;
      return k;
    };
    const ania = await nowy('Ania', 'ania', '10.2.0.2');
    const bartek = await nowy('Bartek', 'bartek', '10.2.0.3');
    await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: bartek.id, silniki: { claude: true, local: true } } });

    // ------------------------------------------------------------ T1
    {
      const cfg = await ania.zadaj('/api/config');
      const z = cfg.json.zespol || {};
      ok(z.dozwolony === true && z.przyznany === false && z.maxRolSufit === 3 && z.maxRol <= 3 && z.tryb === 'proponuj',
        `T1a. config członka: ${JSON.stringify(z)}`);
      ok(!/sk-|7526|7528|test-nvidia/.test(JSON.stringify(z)), 'T1b. obiekt zespol w /api/config bez kluczy i adresów');
      const kat = await ania.zadaj('/api/zespol/katalog');
      ok(kat.kod === 200 && kat.json.role.length === 6 && !/instrukcja|ROLA AGENTA/.test(kat.tekst), 'T1c. katalog ról: 6 ról, bez instrukcji dla modelu');
    }

    // ------------------------------------------------------------ T2
    {
      const zap = await ania.zadaj('/api/zespol/ustawienia', { metoda: 'POST', dane: { tryb: 'sam', maxRol: 5, zgodaChmura: true,
        role: { analityk: { silnik: 'claude', model: 'claude-opus-5' }, programista: { silnik: 'cloud' } } } });
      const u = zap.json.ustawienia || {};
      ok(zap.kod === 200 && u.tryb === 'sam' && u.maxRol === 3 && !u.role.analityk && u.role.programista && u.role.programista.silnik === 'cloud',
        `T2a. ustawienia Ani: maxRol przycięte do 3, rola na nieprzyznanym Claude odrzucona (${JSON.stringify(u)})`);
      const odczyt = await ania.zadaj('/api/zespol/ustawienia');
      const m = await marcin.zadaj('/api/zespol/ustawienia');
      ok(odczyt.json.ustawienia.tryb === 'sam' && m.json.ustawienia.tryb === 'proponuj', 'T2b. ustawienia na serwerze, osobne dla każdej osoby');
      await ania.zadaj('/api/zespol/ustawienia', { metoda: 'POST', dane: { tryb: 'proponuj', zgodaChmura: false, role: {} } });
    }

    // ------------------------------------------------------------ T3 / T4 / T5
    {
      await zeruj();
      const w = await bartek.tura({ endpoint: 'claude', messages: [{ role: 'user', content: 'Przeanalizuj, proszę.' }],
        zespol: { uruchom: true, sklad: [{ rola: 'analityk', silnik: 'claude', model: 'claude-haiku-4-5' }, { rola: 'recenzent', silnik: 'claude' }] } });
      const an = w.sklad.role.find((r) => r.rola === 'analityk') || {};
      const z = await zadania();
      const naClaude = z.filter((x) => x.silnik === 'claude');
      ok(w.kod === 200 && an.silnik === 'cloud' && an.zamiast && an.zamiast.silnik === 'claude' && /zespol-nie-przyznany/.test(an.powod || ''),
        `T3a. bez przyznania „zespol”: rola z Claude’a → chmura wspólna (${JSON.stringify({ s: an.silnik, p: an.powod })})`);
      ok(naClaude.length === 1 && naClaude[0].rodzaj === 'prowadzacy', `T3b. na kluczu właściciela jedno wywołanie – prowadzący (${naClaude.map((x) => x.rodzaj).join(',')})`);
      await zeruj();
      const w0 = await bartek.tura({ endpoint: 'claude', messages: [{ role: 'user', content: 'Zrób to zespołem: plan-kod' }], zespol: { uruchom: true } });
      const z0 = await zadania();
      ok(w0.kod === 200 && !z0.some((x) => x.silnik === 'claude' && x.rodzaj === 'planista') && z0.some((x) => x.rodzaj === 'planista'),
        'T3c. planista członka bez przyznania nie liczy się na Claude właściciela');

      const przedLicznik = async () => ((((await marcin.zadaj('/api/konta')).json.uzytkownicy || []).find((u) => u.id === bartek.id) || {})
        .zuzycie?.silniki?.dzisiaj?.claude?.wywolan) || 0;
      const lPrzed = await przedLicznik();
      await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: bartek.id, silniki: { claude: true, local: true, zespol: true } } });
      await zeruj();
      const w2 = await bartek.tura({ endpoint: 'claude', messages: [{ role: 'user', content: 'Przeanalizuj, proszę.' }],
        zespol: { sklad: [{ rola: 'analityk', silnik: 'claude', model: 'claude-opus-5' }, { rola: 'recenzent', silnik: 'claude' }] } });
      const an2 = w2.sklad.role.find((r) => r.rola === 'analityk') || {};
      const z2 = await zadania();
      const rolaClaude = z2.find((x) => x.silnik === 'claude' && x.rola === 'ANALITYK');
      ok(an2.silnik === 'claude' && an2.model === 'claude-haiku-4-5' && an2.zamiast && an2.zamiast.model === 'claude-opus-5',
        `T4a. z przyznaniem: rola na Claude, model z listy właściciela zamiast opus (${an2.model})`);
      ok(rolaClaude && rolaClaude.max_tokens <= 8192 && rolaClaude.klucz === KLUCZ_CLAUDE_W.slice(-4), 'T4b. max_tokens roli ≤ sufit członka, klucz właściciela (przyznany)');
      await spij(200);
      const lPo = await przedLicznik();
      ok(lPo - lPrzed >= 3, `T4c. liczniki zużycia per rola: Claude +${lPo - lPrzed} wywołań (role + prowadzący)`);

      // T5 – odebranie przyznania w trakcie tury
      await zeruj();
      const pw = bartek.tura({ endpoint: 'claude', messages: [{ role: 'user', content: 'Wolno: rola-wolna:ANALITYK' }],
        zespol: { sklad: [{ rola: 'analityk', silnik: 'claude' }, { rola: 'recenzent', silnik: 'claude' }] } });
      await spij(500);
      await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: bartek.id, silniki: { claude: true, local: true, zespol: false } } });
      const w3 = await pw;
      const z3 = await zadania();
      const rec = w3.zdarzenia.filter((e) => e.typ === 'rola' && e.dane.r === 'r2' && e.dane.ms !== undefined).pop();
      ok(!z3.some((x) => x.silnik === 'claude' && x.rola === 'RECENZENT') && rec && rec.dane.stan === 'blad' && rec.dane.kod === 'uprawnienia',
        `T5. odebrane przyznanie działa od następnej roli (recenzent: ${rec && rec.dane.stan}/${rec && rec.dane.kod})`);
    }

    // ------------------------------------------------------------ T6
    {
      const wolno = { messages: [{ role: 'user', content: 'rola-wolna:ANALITYK' }], zespol: { sklad: [{ rola: 'analityk' }, { rola: 'recenzent' }] } };
      const p1 = ania.tura(wolno);
      await spij(300);
      const w2 = await ania.tura(wolno);
      ok(w2.kod === 409 && /zespol-zajety/.test(w2.tekst), `T6. drugi zespół członka naraz → 409 (${w2.kod})`);
      await p1;
    }

    // ------------------------------------------------------------ T7
    {
      await ania.zadaj('/api/konto/klucze', { metoda: 'PUT', dane: { nazwa: 'openai', klucz: KLUCZ_OPENAI_ANI } });
      await ania.zadaj('/api/conversations?id=rozmowaani1', { metoda: 'PUT', dane: { title: 'x', messages: [{ role: 'user', content: 'Moje pytanie' }] } });
      await zeruj();
      const w = await ania.tura({ endpoint: 'cloud', rozmowa: 'rozmowaani1', messages: [{ role: 'user', content: 'Moje pytanie' }],
        zespol: { sklad: [{ rola: 'analityk', silnik: 'openai', model: 'gpt-4o' }, { rola: 'recenzent' }] } });
      const z = await zadania();
      const r = z.find((x) => x.silnik === 'openai' && x.rola === 'ANALITYK');
      ok(r && r.klucz === KLUCZ_OPENAI_ANI.slice(-4) && r.model === 'gpt-4o' && w.sklad.role[0].zrodlo === 'wlasny', 'T7a. rola na własnym kluczu Ani, dowolny model, zrodlo „wlasny”');
      await spij(700);
      const plik = fs.readFileSync(path.join(katalogOsoby(srv.katalogDanych, ania.id), 'conversations', 'rozmowaani1.json'), 'utf8');
      ok(!w.tekst.includes(KLUCZ_OPENAI_ANI) && !plik.includes(KLUCZ_OPENAI_ANI) && !/127\.0\.0\.1:7526|:7527|:7525/.test(w.tekst + plik)
        && plik.includes('"narzedzie":"zespol"'), 'T7b. ani klucz, ani adres silnika w strumieniu i w pliku rozmowy (notatki zapisane)');
      await ania.zadaj('/api/konto/klucze', { metoda: 'PUT', dane: { nazwa: 'openai', klucz: '' } });
    }

    // ------------------------------------------------------------ T8
    {
      await marcin.zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: bartek.id, silniki: { claude: true, local: true, zespol: true } } });
      await zeruj();
      const p = await bartek.zadaj('/api/zespol/plan', { metoda: 'POST', dane: { endpoint: 'local', pytanie: 'Prywatne: przeanalizuj',
        sklad: [{ rola: 'analityk', silnik: 'cloud' }, { rola: 'recenzent' }] } });
      const an = ((p.json.sklad || {}).role || []).find((r) => r.rola === 'analityk') || {};
      const z = await zadania();
      ok(p.kod === 200 && an.silnik === 'local' && an.zamiast && an.zamiast.silnik === 'cloud' && p.json.wymagaZgody === 'chmura' && !z.length,
        `T8. tylko plan: bez wywołań (${z.length}), rola z chmury lokalnie, wymagaZgody=${p.json.wymagaZgody}`);
    }

    // ------------------------------------------------------------ T9
    {
      let odmowa = null;
      for (let i = 0; i < 6 && !odmowa; i++) {
        const w = await ania.tura({ messages: [{ role: 'user', content: 'Zrób to zespołem' }], zespol: { uruchom: true } });
        odmowa = w.zdarzenia.find((e) => e.typ === 'zespol' && e.dane.faza === 'odmowa');
        if (odmowa) ok(odmowa.dane.kod === 'limit-dobowy' && /bez zespołu/.test(w.odpowiedz) && !w.zdarzenia.some((e) => e.typ === 'rola'),
          'T9. limit dobowy członka: odmowa + odpowiedź samego prowadzącego');
      }
      ok(Boolean(odmowa), 'T9b. limit dobowy zadziałał');
    }
  } catch (err) {
    fail.push(`wyjątek: ${err.stack || err.message}`);
  } finally {
    zabij(srv); zabij(atrapa);
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nzespol-trasy OK');
  process.exit(fail.length ? 1 : 0);
})();

/* Agent zmysłów – zmysły na komputerze KAŻDEJ osoby, sterowane z aplikacji.

   Do tej pory zmysły były jedne: na domowym GPU właściciela. Zaproszona osoba
   albo nie miała ich wcale, albo jej nagrania i zdjęcia liczył cudzy komputer.
   Teraz każda osoba paruje SWÓJ komputer kodem z Ustawień, a włączanie
   i wyłączanie zmysłów idzie przełącznikiem w aplikacji, nie z wiersza poleceń.

   Zestaw stawia prawdziwy serwer z hasłem, właściciela i członka przez
   zaproszenie, trzy atrapy usługi zmysłów (dom właściciela, komputer
   właściciela z agentem, komputer członka) i uruchamia PRAWDZIWY
   senses/agent.py – dwa razy, osobno dla każdej osoby. Sprawdza:
     1. instalator jednym poleceniem zawiera adres serwera i kod,
     2. zły kod nie paruje, dobry paruje raz,
     3. agent pobiera pliki zmysłów z serwera (skrót się zgadza),
     4. zlecenie zmysłów osoby idzie do JEJ komputera – nie do domu
        właściciela i nie do komputera drugiej osoby,
     5. członek bez agenta i bez zgody dostaje 403, a po podłączeniu swojego
        komputera – wynik ze swojego komputera,
     6. zdarzenia z obserwatora (token agenta) trafiają tylko do tej osoby,
     7. przełącznik w Ustawieniach uruchamia składnik na komputerze osoby,
        a jego upadek (brak pakietu) widać w aplikacji z dziennikiem,
     8. lista komputerów osoby nie pokazuje cudzych,
     9. odłączenie komputera w aplikacji wyłącza agenta, a ten usuwa u siebie
        token,
    10. uśpiony laptop (SIGSTOP): zlecenie kończy się po kilku sekundach, nie
        po minucie, a po przebudzeniu komputer znów liczy,
    11. usunięte konto: agent tej osoby kończy pracę, token nie pobiera plików,
    12. seria błędnych kodów z wielu adresów wstrzymuje parowanie – nawet
        prawdziwy kod – a nie blokuje logowania z tych adresów.
   Oraz (punkt 1 i 4): długi kod w poleceniu instalacji, podrobiony
   X-Forwarded-Host nie trafia do skryptu, 6 MB dociera bajt w bajt.
*/
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3506;
const S = `http://127.0.0.1:${PORT}`;
const HASLO = 'haslo-wlasciciela-2026';
const KORZEN = path.resolve(__dirname, '../..');
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const pauza = (ms) => new Promise((r) => setTimeout(r, ms));

/** Atrapa usługi zmysłów, która podpisuje każdą odpowiedź swoim imieniem. */
function atrapaZmyslow(imie) {
  const srv = http.createServer((req, res) => {
    let ile = 0;
    req.on('data', (c) => { ile += c.length; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/health') return res.end(JSON.stringify({ yolo: true, whisper: true }));
      res.end(JSON.stringify({ kto: imie, objects: [{ label: `obiekt-${imie}`, conf: 0.9 }], summary: imie, bajtow: ile }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

function klient() {
  let ciastko = '';
  return async (sciezka, { metoda = 'GET', dane, naglowki = {} } = {}) => {
    const r = await fetch(`${S}${sciezka}`, {
      method: metoda,
      headers: { 'Content-Type': 'application/json', ...(ciastko ? { Cookie: ciastko } : {}), ...naglowki },
      body: dane === undefined ? undefined : JSON.stringify(dane),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) ciastko = sc.split(';')[0];
    const tekst = await r.text();
    let json = {};
    try { json = JSON.parse(tekst); } catch { /* tekst */ }
    return { kod: r.status, json, tekst };
  };
}

const agenci = [];
function uruchomAgenta(katalog, portZmyslow, portZamka, args) {
  const p = spawn('python3', [path.join(KORZEN, 'senses', 'agent.py'), ...args], {
    env: { ...process.env, COSMOS_AGENT_DIR: katalog, SENSES_PORT: String(portZmyslow), COSMOS_AGENT_LOCK_PORT: String(portZamka) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.wyjscie = '';
  p.stdout.on('data', (d) => { p.wyjscie += d; });
  p.stderr.on('data', (d) => { p.wyjscie += d; });
  p.zakonczony = new Promise((r) => p.on('exit', (kod) => r(kod)));
  agenci.push(p);
  return p;
}

async function czekajNaWarunek(fn, ms = 20000) {
  const koniec = Date.now() + ms;
  while (Date.now() < koniec) {
    const w = await fn();
    if (w) return w;
    await pauza(300);
  }
  return null;
}

(async () => {
  const dom = await atrapaZmyslow('DOM');
  const komputerMarcina = await atrapaZmyslow('MARCIN');
  const komputerAni = await atrapaZmyslow('ANIA');
  const srv = serwerCosmosa(PORT, {
    COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin',
    SENSES_URL: `http://127.0.0.1:${dom.address().port}`,
  });
  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-agent-'));
  const katMarcina = path.join(kat, 'marcin');
  const katAni = path.join(kat, 'ania');
  try {
    if (!(await czekajNa(`${S}/api/auth`))) throw new Error('serwer testowy nie wstał');
    const marcin = klient();
    await marcin('/api/login', { metoda: 'POST', dane: { password: HASLO } });
    const zap = await marcin('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: 'Ania' } });
    const ania = klient();
    const przyj = await ania('/api/zaproszenie', { metoda: 'POST', dane: { token: zap.json.token, login: 'ania', haslo: 'haslo-ani-12345' } });
    if (przyj.kod !== 200) throw new Error(`nie udało się założyć konta członka: ${przyj.tekst}`);

    /* ---- 5a. Członek bez agenta i bez zgody ---- */
    const bez = await ania('/api/detect', { metoda: 'POST', dane: { image: 'x' } });
    ok(bez.kod === 403 && !/DOM/.test(bez.tekst), `5. członek bez komputera i bez zgody: 403, nic z domu właściciela (${bez.kod})`);

    /* ---- 1. Instalator ---- */
    const kodyM = (await marcin('/api/agent/kod', { metoda: 'POST' })).json;
    const kodM = kodyM.dlugi;
    ok(/^\d{6}$/.test(kodyM.kod || '') && /^[A-Za-z0-9_-]{20,}$/.test(kodM || ''),
      `1. dwa kody: 6 cyfr do przepisania i długi do polecenia instalacji (${kodyM.kod}, ${String(kodM).length} znaków)`);
    const ps1 = await fetch(`${S}/api/agent/instaluj.ps1?kod=${kodM}`, { headers: { 'X-Forwarded-Proto': 'https' } });
    const tps1 = await ps1.text();
    ok(ps1.status === 200 && tps1.includes(`'https://127.0.0.1:${PORT}'`) && tps1.includes(`'${kodM}'`) && /agent\.py/.test(tps1),
      '1. instalator PowerShell niesie adres serwera (https za tunelem) i kod');
    const sh = await (await fetch(`${S}/api/agent/instaluj.sh?kod=${kodM}`)).text();
    ok(sh.includes(`'${S}'`) && sh.includes(`'${kodM}'`), '1. instalator sh niesie adres i kod');
    /* Podrobiony X-Forwarded-Host dawał skrypt pobierający agenta z obcego
       serwera – bez pośrednika (COSMOS_POSREDNIK=inny) jest ignorowany. */
    const obcy = await (await fetch(`${S}/api/agent/instaluj.sh?kod=${kodM}`, { headers: { 'X-Forwarded-Host': 'zly.example.com' } })).text();
    ok(!obcy.includes('zly.example.com') && obcy.includes(`'${S}'`), '1. podrobiony X-Forwarded-Host nie trafia do skryptu instalacji');

    /* ---- 2. Parowanie ---- */
    const zly = await fetch(`${S}/api/agent/paruj`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kod: '000000' === kodM ? '111111' : '000000' }) });
    ok(zly.status === 404, `2. zły kod nie paruje (${zly.status})`);

    const aM = uruchomAgenta(katMarcina, komputerMarcina.address().port, 17069, ['--serwer', S, '--kod', kodM]);
    const onlineM = await czekajNaWarunek(async () => {
      const l = (await marcin('/api/agent/lista')).json;
      return (l.agenci || []).find((a) => a.online && a.zmyslyDzialaja);
    });
    ok(Boolean(onlineM), `2. komputer właściciela połączony i zgłasza działające zmysły${onlineM ? '' : ` (wyjście agenta: ${aM.wyjscie.slice(-300)})`}`);
    const ponownie = await fetch(`${S}/api/agent/paruj`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kod: kodM }) });
    ok(ponownie.status === 404, `2. ten sam kod drugi raz nie paruje (${ponownie.status})`);

    /* ---- 3. Pliki z serwera ---- */
    const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const pobrany = path.join(katMarcina, 'senses', 'service.py');
    ok(fs.existsSync(pobrany) && sha(pobrany) === sha(path.join(KORZEN, 'senses', 'service.py')), '3. agent pobrał service.py z serwera, skrót zgodny');
    const konfig = JSON.parse(fs.readFileSync(path.join(katMarcina, 'agent.json'), 'utf8'));
    ok(konfig.token && !fs.readFileSync(path.join(KORZEN, 'lib', 'agent-zmyslow.js'), 'utf8').includes(konfig.token), '3. token agenta zapisany u osoby');

    /* ---- 4. Zlecenie idzie do komputera osoby ---- */
    const detM = await marcin('/api/detect', { metoda: 'POST', dane: { image: 'data:image/png;base64,AAAA' } });
    ok(detM.kod === 200 && detM.json.kto === 'MARCIN', `4. wykrywanie właściciela liczy JEGO komputer z agentem, nie dom (${detM.json.kto})`);
    ok(detM.json.bajtow > 10, `4. ciało żądania dotarło do usługi przez agenta (${detM.json.bajtow} B)`);
    // Duże ciało jedzie surowymi bajtami (dawniej base64 w JSON-ie stawiało pętlę zdarzeń).
    const duze = JSON.stringify({ image: `data:image/png;base64,${'A'.repeat(6 * 1024 * 1024)}` });
    const detDuze = await marcin('/api/detect', { metoda: 'POST', dane: JSON.parse(duze) });
    ok(detDuze.kod === 200 && detDuze.json.bajtow === Buffer.byteLength(duze), `4. 6 MB dociera do usługi bajt w bajt (${detDuze.json.bajtow} z ${Buffer.byteLength(duze)})`);

    /* ---- 5b. Członek podłącza swój komputer ---- */
    const kodA = (await ania('/api/agent/kod', { metoda: 'POST' })).json.kod;
    const aA = uruchomAgenta(katAni, komputerAni.address().port, 17070, ['--serwer', S, '--kod', kodA]);
    const onlineA = await czekajNaWarunek(async () => ((await ania('/api/agent/lista')).json.agenci || []).find((a) => a.online && a.zmyslyDzialaja));
    ok(Boolean(onlineA), '5. komputer członka połączony');
    const detA = await ania('/api/detect', { metoda: 'POST', dane: { image: 'x' } });
    ok(detA.kod === 200 && detA.json.kto === 'ANIA', `5. wykrywanie członka liczy JEGO komputer (${detA.kod} ${detA.json.kto})`);
    const detM2 = await marcin('/api/detect', { metoda: 'POST', dane: { image: 'x' } });
    ok(detM2.json.kto === 'MARCIN', `4. właściciel dalej na swoim komputerze, nie na komputerze członka (${detM2.json.kto})`);
    const statusA = (await ania('/api/status')).json;
    ok(statusA.senses && statusA.senses.online === true && !JSON.stringify(statusA).includes(String(dom.address().port)),
      '5. /api/status członka: zmysły online z jego komputera, bez adresu domu');

    /* ---- 8. Lista tylko swoich ---- */
    const listaA = (await ania('/api/agent/lista')).json.agenci || [];
    ok(listaA.length === 1 && listaA[0].id === onlineA.id, `8. członek widzi tylko swój komputer (${listaA.length})`);
    const cudzy = await ania(`/api/agent/ustaw?id=${onlineM.id}`, { metoda: 'POST', dane: { chce: { zmysly: false } } });
    ok(cudzy.kod === 404, `8. członek nie przełączy cudzego komputera (${cudzy.kod})`);

    /* ---- 6. Zdarzenia tokenem agenta ---- */
    const tokenA = JSON.parse(fs.readFileSync(path.join(katAni, 'agent.json'), 'utf8')).token;
    const zd = await fetch(`${S}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ type: 'wzrok', summary: 'ZDARZENIE-ANI kot na parapecie' }) });
    ok(zd.status === 200, `6. obserwator z tokenem agenta może wysłać zdarzenie (${zd.status})`);
    ok(/ZDARZENIE-ANI/.test((await ania('/api/events')).tekst), '6. zdarzenie widzi osoba, do której należy komputer');
    ok(!/ZDARZENIE-ANI/.test((await marcin('/api/events')).tekst), '6. właściciel NIE widzi zdarzenia z komputera członka');
    const zdZly = await fetch(`${S}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer zmyslony' },
      body: JSON.stringify({ type: 'wzrok', summary: 'x' }) });
    ok(zdZly.status === 401, `6. zmyślony token nie wysyła zdarzeń (${zdZly.status})`);

    /* ---- 10. Uśpiony laptop: bez minuty czekania ---- */
    // SIGSTOP = uśpienie: połączenie TCP zostaje, agent nic nie odbiera.
    // Dawniej zlecenie leżało w martwym gnieździe i głos milkł na 61 s.
    aA.kill('SIGSTOP');
    const t0 = Date.now();
    const spiacy = await ania('/api/detect', { metoda: 'POST', dane: { image: 'x' } });
    const ms = Date.now() - t0;
    ok(ms < 8000 && spiacy.kod >= 400, `10. zlecenie do uśpionego komputera kończy się po ${ms} ms (${spiacy.kod}), nie po minucie`);
    const drugie = await ania('/api/detect', { metoda: 'POST', dane: { image: 'x' } });
    ok(drugie.kod === 403, `10. następne żądanie od razu wie, że zmysłów nie ma (${drugie.kod})`);
    aA.kill('SIGCONT');
    const wrocil = await czekajNaWarunek(async () => (await ania('/api/detect', { metoda: 'POST', dane: { image: 'x' } })).json.kto === 'ANIA', 40000);
    ok(Boolean(wrocil), '10. po przebudzeniu komputer znów liczy zmysły');

    /* ---- 7. Przełącznik uruchamia składnik ---- */
    const ust = await marcin(`/api/agent/ustaw?id=${onlineM.id}`, { metoda: 'POST', dane: { chce: { obserwator: true } } });
    ok(ust.kod === 200 && ust.json.chce.obserwator === true, '7. przełącznik „Obserwator kamery” zapisany');
    // Obserwator bez ultralytics pada od razu – aplikacja ma to pokazać, nie udawać, że działa.
    const po = await czekajNaWarunek(async () => {
      const a = ((await marcin('/api/agent/lista')).json.agenci || [])[0] || {};
      const o = (a.skladniki || {}).obserwator || {};
      return (o.dziala || o.kodWyjscia !== null && o.kodWyjscia !== undefined) ? o : null;
    }, 25000);
    ok(Boolean(po), `7. agent uruchomił obserwatora na komputerze osoby (${JSON.stringify(po)})`);
    ok(fs.existsSync(path.join(katMarcina, 'logi', 'obserwator.log')), '7. składnik ma swój dziennik u osoby');
    if (po && !po.dziala) ok(po.log !== undefined, '7. upadek składnika widać w aplikacji razem z końcówką dziennika');
    await marcin(`/api/agent/ustaw?id=${onlineM.id}`, { metoda: 'POST', dane: { chce: { obserwator: false } } });
    const zapamietane = JSON.parse(fs.readFileSync(path.join(katMarcina, 'agent.json'), 'utf8'));
    await czekajNaWarunek(async () => JSON.parse(fs.readFileSync(path.join(katMarcina, 'agent.json'), 'utf8')).chce?.obserwator === false, 8000);
    ok(JSON.parse(fs.readFileSync(path.join(katMarcina, 'agent.json'), 'utf8')).chce?.obserwator === false && zapamietane,
      '7. wyłączenie dociera do agenta i zostaje w jego ustawieniach (po restarcie komputera też)');

    /* ---- 9. Odłączenie ---- */
    const usun = await marcin(`/api/agent?id=${onlineM.id}`, { metoda: 'DELETE' });
    ok(usun.kod === 200, '9. odłączenie komputera w aplikacji');
    const kodWyjscia = await Promise.race([aM.zakonczony, pauza(20000).then(() => 'dalej działa')]);
    ok(kodWyjscia !== 'dalej działa', `9. agent po odłączeniu kończy pracę (${kodWyjscia})`);
    const detM3 = await marcin('/api/detect', { metoda: 'POST', dane: { image: 'x' } });
    ok(detM3.json.kto === 'DOM', `9. właściciel bez agenta wraca do zmysłów w domu (${detM3.json.kto})`);
    const cfgM = JSON.parse(fs.readFileSync(path.join(katMarcina, 'agent.json'), 'utf8'));
    ok(!cfgM.token, '9. odłączony agent usuwa u siebie token (nie wstaje na próżno przy każdym starcie)');
    ok(!(await marcin('/api/agent/lista')).json.agenci.length, '9. odłączony komputer znika z listy');

    /* ---- 11. Usunięte konto: jego komputer traci dostęp ---- */
    const idAni = przyj.json.uzytkownik.id;
    await marcin(`/api/konta/uzytkownik?id=${encodeURIComponent(idAni)}`, { metoda: 'DELETE' });
    const koniecAni = await Promise.race([aA.zakonczony, pauza(35000).then(() => 'dalej działa')]);
    ok(koniecAni !== 'dalej działa', `11. agent usuniętego konta kończy pracę (${koniecAni})`);
    const poUsunieciu = await fetch(`${S}/api/agent/pliki`, { headers: { Authorization: `Bearer ${tokenA}` } });
    ok(poUsunieciu.status === 410, `11. token agenta usuniętego konta nie pobiera już plików (${poUsunieciu.status})`);

    /* ---- 12. Zgadywanie kodu z wielu adresów ---- */
    const kodPrawdziwy = (await marcin('/api/agent/kod', { metoda: 'POST' })).json.kod;
    for (let i = 0; i < 31; i++) {
      await fetch(`${S}/api/agent/paruj`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `203.0.113.${i + 1}` },
        body: JSON.stringify({ kod: String(100000 + i) }) });
    }
    const trafiony = await fetch(`${S}/api/agent/paruj`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.7' }, body: JSON.stringify({ kod: kodPrawdziwy }) });
    ok(trafiony.status === 429, `12. po serii błędnych kodów z różnych adresów nawet prawdziwy kod nie paruje (${trafiony.status})`);
    const logowanie = await fetch(`${S}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.1' },
      body: JSON.stringify({ password: HASLO }) });
    ok(logowanie.status === 200, `12. pomyłki w kodzie nie blokują logowania z tego adresu (${logowanie.status})`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    for (const a of agenci) try { a.kill('SIGTERM'); } catch { /* już nie żyje */ }
    zabij(srv);
    dom.close(); komputerMarcina.close(); komputerAni.close();
    fs.rmSync(kat, { recursive: true, force: true });
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nAGENT ZMYSŁÓW OK');
  process.exit(fail.length ? 1 : 0);
})();

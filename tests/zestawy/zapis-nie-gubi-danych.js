/* Czy przerwany zapis może zniszczyć dane?

   `writeFileSync` NIE JEST niepodzielny: najpierw obcina plik do zera, potem
   dopisuje treść. Przerwanie między jednym a drugim — restart usługi w złym
   momencie, zanik zasilania VPS-a, brak miejsca na dysku — zostawia plik
   pusty albo urwany w połowie.

   Przy `archiwum.json` zauważyłem to od razu i zrobiłem tam zapis przez plik
   tymczasowy. Reszta danych została po staremu i to była niespójność po ZŁEJ
   stronie: indeks zdjęć odbudowuje się jednym kliknięciem „Indeksuj teraz",
   a rozmowy, pamięć długotrwała i baza wiedzy nie odbudowują się wcale.

   Prawdziwego zaniku zasilania nie wywołamy, więc awarię MODELUJEMY: „proces
   zginął po obcięciu pliku, a przed dopisaniem treści". Zestaw pokazuje obie
   strony obok siebie — przy zapisie wprost dane w tym momencie już nie
   istnieją, przy zapisie przez plik tymczasowy leżą nietknięte, bo obcinany
   jest plik tymczasowy, a `rename` w obrębie katalogu jest niepodzielny.

   Druga część sprawdza rzecz osobną i równie łatwą do przeoczenia: czy ten
   mechanizm jest FAKTYCZNIE użyty tam, gdzie trzeba. Sam poprawny helper nic
   nie daje, jeśli połowa modułów dalej woła `writeFileSync`.
*/
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { srodowisko, katalogOsoby, KORZEN, uruchom, zabij, czekajNa } = require('../pomoc');
const { zapiszAtomowo, czytajJson } = require('../../lib/rdzen.js');

(async () => {
  const fail = [];

  /* ---- 1. Przerwany zapis a stare dane ----
     Modelujemy awarię wprost, bo prawdziwego zaniku zasilania nie wywołamy:
     „proces zginął po obcięciu pliku, a przed dopisaniem treści". Dla
     `writeFileSync` to jest moment, w którym dane już nie istnieją. Dla zapisu
     przez plik tymczasowy taki moment nie istnieje w ogóle — obcinany jest
     PLIK TYMCZASOWY, a prawdziwy leży nietknięty aż do `rename`. */
  {
    const kat = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cosmos-zapis-'));
    const STARE = JSON.stringify({ wersja: 1, tresc: 'dane, których nie wolno stracić' });

    // a) tak wyglądała awaria przy zapisie wprost
    const naiwny = path.join(kat, 'naiwny.json');
    fs.writeFileSync(naiwny, STARE);
    try {
      fs.writeFileSync(naiwny, '');        // obcięcie — pierwszy krok writeFileSync
      throw new Error('tu ginie proces');  // …i drugi krok już nie następuje
    } catch { /* modelowana awaria */ }
    const poNaiwnym = fs.readFileSync(naiwny, 'utf8');
    console.log(`1a. zapis wprost, awaria w połowie → zostało ${poNaiwnym.length} B `
      + `z ${STARE.length} B`);
    if (poNaiwnym.length) fail.push('model awarii jest zły — zapis wprost powinien zniszczyć plik');

    // b) to samo przy zapisie przez plik tymczasowy
    const bezpieczny = path.join(kat, 'bezpieczny.json');
    zapiszAtomowo(bezpieczny, STARE);
    try {
      fs.writeFileSync(`${bezpieczny}.tmp`, '');
      throw new Error('tu ginie proces');  // przed renameSync
    } catch { /* modelowana awaria */ }
    const poBezpiecznym = fs.readFileSync(bezpieczny, 'utf8');
    console.log(`1b. zapis przez plik tymczasowy, ta sama awaria → zostało `
      + `${poBezpiecznym.length} B z ${STARE.length} B`);
    if (poBezpiecznym !== STARE) fail.push('przerwany zapis atomowy uszkodził stare dane');

    // c) po udanym zapisie treść jest kompletna, a śmieci nie ma
    const duza = JSON.stringify({ wersja: 2, tresc: 'x'.repeat(2_000_000) });
    zapiszAtomowo(bezpieczny, duza);
    const po = JSON.parse(fs.readFileSync(bezpieczny, 'utf8'));
    if (po.wersja !== 2 || po.tresc.length !== 2_000_000) fail.push('zapisana treść jest niekompletna');
    const smieci = fs.readdirSync(kat).filter((f) => f.endsWith('.tmp') && !f.startsWith('bezpieczny'));
    console.log(`2. 2 MB zapisane w całości, pozostałości .tmp: ${smieci.length}`);
    if (smieci.length) fail.push(`zostały pliki tymczasowe: ${smieci.join(', ')}`);

    /* Uprawnienia ustawiamy NA PLIKU TYMCZASOWYM, nie po podmianie — token
       OneDrive zapisany najpierw jawnie byłby przez chwilę do odczytania
       przez każdego na maszynie. Krótkie okno to wciąż okno. */
    const tajny = path.join(kat, 'tajne.json');
    zapiszAtomowo(tajny, '{"refresh_token":"x"}', { mode: 0o600 });
    const tryb = fs.statSync(tajny).mode & 0o777;
    console.log(`3. tryb dostępu pliku z poświadczeniami: ${tryb.toString(8)}`);
    if (tryb & 0o077) fail.push(`plik z tokenem czytelny dla innych (${tryb.toString(8)})`);

    /* Resztka po przerwanym zapisie ma SWÓJ tryb — `mode` działa tylko przy
       zakładaniu pliku. Gdyby zapis ją otworzył zamiast założyć plik od
       nowa, token dostałby 0644 po poprzednim, nieudanym przebiegu. */
    fs.writeFileSync(`${tajny}.tmp`, 'resztka', { mode: 0o644 });
    fs.chmodSync(`${tajny}.tmp`, 0o644);
    zapiszAtomowo(tajny, '{"refresh_token":"y"}', { mode: 0o600 });
    const trybPoResztce = fs.statSync(tajny).mode & 0o777;
    console.log(`3b. ten sam plik po resztce .tmp z trybem 644: ${trybPoResztce.toString(8)}`);
    if (trybPoResztce & 0o077) fail.push(`resztka .tmp przeniosła swój tryb na plik z tokenem (${trybPoResztce.toString(8)})`);

    /* Pełny dysk w połowie zapisu: `.tmp` zostawał i zjadał resztę miejsca —
       przy dużym indeksie bazy wiedzy padały potem drobne zapisy INNYCH osób.
       Pełny dysk modelujemy podmianą writeSync na błąd ENOSPC po pierwszym kawałku. */
    const indeks = path.join(kat, 'index.json');
    zapiszAtomowo(indeks, STARE);
    const prawdziwyWrite = fs.writeSync;
    let kawalki = 0;
    fs.writeSync = (...a) => {
      if (++kawalki > 1) throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
      return prawdziwyWrite(a[0], a[1], a[2], Math.min(a[3], 1024), a[4]);   // małymi kawałkami
    };
    let rzucil = false;
    try { zapiszAtomowo(indeks, 'y'.repeat(50_000)); } catch (e) { rzucil = e.code === 'ENOSPC'; } finally { fs.writeSync = prawdziwyWrite; }
    const resztka = fs.existsSync(`${indeks}.tmp`);
    console.log(`3c. pełny dysk w połowie zapisu → błąd: ${rzucil}, resztka .tmp: ${resztka}, stare dane: ${fs.readFileSync(indeks, 'utf8') === STARE}`);
    if (!rzucil) fail.push('nieudany zapis nie zgłosił błędu (trasa odpowiedziałaby „ok")');
    if (resztka) fail.push('nieudany zapis zostawił plik .tmp, który zjada miejsce');
    if (fs.readFileSync(indeks, 'utf8') !== STARE) fail.push('nieudany zapis naruszył poprzednią wersję');

    fs.rmSync(kat, { recursive: true, force: true });
  }

  /* ---- 1c. Uszkodzony plik nie daje po cichu pustego stanu ----
     Dawniej każdy moduł czytał `try { JSON.parse } catch { return [] }`.
     Ucięty plik dawał pusty stan bez słowa, a PIERWSZY zapis nadpisywał go
     pustą listą — tak ginęły konta członków, pamięć i indeks rozmów.
     Teraz: kopia uszkodzonego pliku obok, przywrócenie z `.bak`, a przy
     kontach serwer woli nie wstać, niż wstać bez nich. */
  {
    const kat = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cosmos-uszk-'));
    const plik = path.join(kat, 'memory.json');
    const kopie = () => fs.readdirSync(kat).filter((f) => f.startsWith('memory.json.uszkodzony-'));

    const brak = czytajJson(plik, ['domyślna']);
    if (JSON.stringify(brak) !== '["domyślna"]') fail.push('brak pliku nie dał wartości domyślnej');

    // a) uszkodzony, bez kopii — wartość domyślna, ALE ucięta treść zachowana obok
    const UCIETY = '[{"id":"a","text":"Fotografuje Canonem R6 II"},{"id":"b","te';
    fs.writeFileSync(plik, UCIETY);
    const a = czytajJson(plik, []);
    const kopiaA = kopie();
    console.log(`6a. ucięty plik bez .bak → ${JSON.stringify(a)}, kopia obok: ${kopiaA.length}`);
    if (!kopiaA.length || fs.readFileSync(path.join(kat, kopiaA[0]), 'utf8') !== UCIETY) {
      fail.push('uszkodzony plik nie został zachowany obok przed nadpisaniem');
    }

    // b) zapis z `kopia: true` odkłada poprzednią wersję jako .bak
    zapiszAtomowo(plik, JSON.stringify([{ id: 'v1' }]), { kopia: true });
    zapiszAtomowo(plik, JSON.stringify([{ id: 'v2' }]), { kopia: true });
    const bak = JSON.parse(fs.readFileSync(`${plik}.bak`, 'utf8'));
    console.log(`6b. po dwóch zapisach .bak trzyma: ${bak[0]?.id}`);
    if (bak[0]?.id !== 'v1') fail.push(`.bak nie trzyma poprzedniej wersji (${JSON.stringify(bak)})`);

    // c) uszkodzony plik z .bak — dane wracają, i to NA DYSKU
    fs.writeFileSync(plik, '{"ucięte');
    const c = czytajJson(plik, []);
    console.log(`6c. ucięty plik z .bak → ${JSON.stringify(c)}`);
    if (c[0]?.id !== 'v1') fail.push(`nie przywrócono danych z .bak (${JSON.stringify(c)})`);
    let naDysku = null;
    try { naDysku = JSON.parse(fs.readFileSync(plik, 'utf8')); } catch { /* dalej uszkodzony */ }
    if (naDysku?.[0]?.id !== 'v1') {
      fail.push('plik na dysku został uszkodzony — następny zapis odłożyłby śmieci jako .bak');
    }

    // d) pusty plik to też uszkodzenie, nie „pusta lista"
    const pusty = path.join(kat, 'pusty.json');
    fs.writeFileSync(pusty, '');
    czytajJson(pusty, []);
    if (!fs.readdirSync(kat).some((f) => f.startsWith('pusty.json.uszkodzony-'))) fail.push('pusty plik przeszedł bez śladu');

    // e) krytyczny (konta) bez kopii — wyjątek zamiast pustej listy
    const konta = path.join(kat, 'uzytkownicy.json');
    fs.writeFileSync(konta, '[{"id":"wlasciciel","login":"marcin"},{"id":"u');
    let rzucil = false;
    try { czytajJson(konta, [], { krytyczny: true }); } catch { rzucil = true; }
    console.log(`6e. uszkodzone konta bez .bak → ${rzucil ? 'wyjątek' : 'pusta lista (ŹLE)'}`);
    if (!rzucil) fail.push('uszkodzony plik kont dał pustą listę zamiast zatrzymać start');

    fs.rmSync(kat, { recursive: true, force: true });
  }

  /* ---- 2. Przez serwer: rozmowa, pamięć i sprzęt trafiają na dysk ----
     Nie sam mechanizm, tylko czy jest FAKTYCZNIE użyty tam, gdzie trzeba.
     Zapisujemy przez API i sprawdzamy, że plik na dysku da się sparsować,
     a obok nie leży zapomniany `.tmp`. */
  const env = await srodowisko('grafiki');
  const dane = katalogOsoby(env);

  await fetch(`${env.adres}/api/conversations?id=proba1`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Zapis atomowy', messages: [{ role: 'user', content: 'test' }] }),
  });
  await fetch(`${env.adres}/api/gear`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ korpus: 'Canon R6 II', obiektywy: '24-105 f/4', dodatki: 'DJI Mavic 3' }),
  });

  const sprawdzPlik = (wzgledna, opis) => {
    const p = path.join(dane, wzgledna);
    if (!fs.existsSync(p)) return `${opis}: pliku nie ma`;
    try { JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return `${opis}: nie da się sparsować (${e.message})`; }
    return null;
  };
  for (const [plik, opis] of [
    ['conversations/proba1.json', 'rozmowa'],
    ['conversations/index.json', 'indeks rozmów'],
    ['sprzet.json', 'sprzęt'],
  ]) {
    const blad = sprawdzPlik(plik, opis);
    if (blad) fail.push(blad);
  }
  console.log('4. rozmowa, indeks rozmów i sprzęt: zapisane i parsowalne');

  /* 4b. DWA URZĄDZENIA. Zapis z nieaktualnej kopii nadpisywał całą rozmowę —
     telefon kasował wiadomości napisane w międzyczasie na komputerze. Zapis
     mówi teraz, na której wersji się opiera; nowszej serwer nie nadpisze. */
  const put = async (tresc) => {
    const r = await fetch(`${env.adres}/api/conversations?id=wersje1`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tresc) });
    return { kod: r.status, json: await r.json().catch(() => ({})) };
  };
  const bazowe = [{ role: 'user', content: 'Plan na Tatry?' }, { role: 'assistant', content: 'Morskie Oko o świcie.' }];
  const v1 = await put({ title: 'Tatry', messages: bazowe });
  await new Promise((r) => setTimeout(r, 5));
  const zKomputera = await put({ title: 'Tatry', messages: [...bazowe, { role: 'user', content: 'A pogoda?' }],
    bazaUpdatedAt: v1.json.meta.updatedAt });
  const zTelefonu = await put({ title: 'Tatry', messages: [...bazowe, { role: 'user', content: 'A nocleg?' }],
    bazaUpdatedAt: v1.json.meta.updatedAt });
  console.log(`4b. zapis z komputera → ${zKomputera.kod}, spóźniony zapis z telefonu → ${zTelefonu.kod}`);
  if (zKomputera.kod !== 200) fail.push(`zapis na aktualnej wersji odrzucony (${zKomputera.kod})`);
  if (zTelefonu.kod !== 409 || !zTelefonu.json.rozmowa
    || !zTelefonu.json.rozmowa.messages.some((m) => m.content === 'A pogoda?')) {
    fail.push(`zapis z nieaktualnej kopii nie dostał 409 z nowszą wersją (${zTelefonu.kod})`);
  }
  const { scalRozmowy } = require('../../public/protokol.js').utworzProtokol();
  const scalona = scalRozmowy({ messages: [...bazowe, { role: 'user', content: 'A nocleg?' }] }, zTelefonu.json.rozmowa || { messages: [] });
  const tresci = scalona.messages.map((m) => m.content);
  console.log(`    po scaleniu: ${tresci.slice(2).join(' | ')}`);
  if (!(tresci.includes('A pogoda?') && tresci.includes('A nocleg?'))) fail.push('scalenie zgubiło wiadomość z któregoś urządzenia');
  const bezBazy = await put({ title: 'Tatry', messages: bazowe });
  if (bezBazy.kod !== 200) fail.push(`zapis bez wersji (stary klient, skrypty) odrzucony (${bezBazy.kod})`);

  // Żadnych osieroconych plików tymczasowych w katalogu danych.
  const osierocone = [];
  const przejdz = (kat) => {
    for (const w of fs.readdirSync(kat, { withFileTypes: true })) {
      const pelna = path.join(kat, w.name);
      if (w.isDirectory()) przejdz(pelna);
      else if (w.name.endsWith('.tmp')) osierocone.push(pelna.replace(dane, ''));
    }
  };
  try { przejdz(dane); } catch { /* katalog mógł nie powstać */ }
  console.log(`5. osierocone pliki .tmp w danych: ${osierocone.length}`);
  if (osierocone.length) fail.push(`zostały pliki tymczasowe: ${osierocone.slice(0, 4).join(', ')}`);

  env.koniec();

  /* ---- 3. Start serwera na uszkodzonych danych ----
     a) Konta uszkodzone, kopii brak → serwer NIE wstaje. Wstałby „bez kont",
        zapewnijWlasciciela od razu zapisałby plik z samym właścicielem
        i członkowie zniknęliby na zawsze.
     b) Indeks rozmów uszkodzony, pliki rozmów na dysku → lista wraca
        odbudowana z plików, a nie pusta. */
  const bazaEnv = { ...process.env, NVIDIA_API_KEY: 'test', COSMOS_PASSWORD: '', COSMOS_API_TOKEN: '' };
  {
    const kat = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cosmos-konta-uszk-'));
    fs.mkdirSync(path.join(kat, 'konta'), { recursive: true });
    fs.writeFileSync(path.join(kat, 'konta', 'uzytkownicy.json'), '[{"id":"wlasciciel","login":"marcin"},{"id":"u');
    const start = spawnSync('node', ['server.js'], { cwd: KORZEN, encoding: 'utf8', timeout: 20000,
      env: { ...bazaEnv, PORT: '3491', COSMOS_DATA_DIR: kat } });
    /* Serwer, który WSTAŁ, kończy się dopiero sygnałem po limicie czasu — a na
       SIGTERM odpowiada porządnym wyjściem z kodem 0. Odmowa startu to kod ≠ 0. */
    const wstal = start.status === null || start.status === 0;
    console.log(`7. serwer z uszkodzonym plikiem kont: ${wstal ? 'WSTAŁ (ŹLE)' : `odmówił startu (kod ${start.status})`}`);
    if (wstal) fail.push('serwer wstał mimo uszkodzonego pliku kont');
    if (!/uzytkownicy\.json/.test(start.stderr || '')) fail.push('komunikat przy odmowie startu nie mówi, który plik jest uszkodzony');
    const zostal = fs.readFileSync(path.join(kat, 'konta', 'uzytkownicy.json'), 'utf8');
    if (!zostal.includes('"u')) fail.push('uszkodzony plik kont został nadpisany');
    fs.rmSync(kat, { recursive: true, force: true });
  }
  {
    const kat = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cosmos-indeks-uszk-'));
    const rozmowy = path.join(kat, 'uzytkownicy', 'wlasciciel', 'conversations');
    fs.mkdirSync(rozmowy, { recursive: true });
    const teraz = Date.now();
    for (const [id, tytul, przesuniecie, pinned] of [['alfa1', 'Plan na Tatry', 2, false], ['beta2', 'Zorza w listopadzie', 1, true], ['gamma3', 'Obiektywy do nieba', 0, false]]) {
      fs.writeFileSync(path.join(rozmowy, `${id}.json`), JSON.stringify({ id, title: tytul, pinned,
        createdAt: teraz - przesuniecie * 60000, updatedAt: teraz - przesuniecie * 60000,
        messages: [{ role: 'user', content: tytul }] }));
    }
    fs.writeFileSync(path.join(rozmowy, 'index.json'), '[{"id":"alfa1","title":"Plan');
    const srv = uruchom('node', ['server.js'], { cwd: KORZEN, env: { ...bazaEnv, PORT: '3490', COSMOS_DATA_DIR: kat } });
    let lista = [];
    if (await czekajNa('http://127.0.0.1:3490/')) {
      lista = (await (await fetch('http://127.0.0.1:3490/api/conversations')).json()).conversations || [];
    }
    zabij(srv);
    console.log(`8. uszkodzony indeks, 3 rozmowy na dysku → na liście: ${lista.map((c) => c.id).join(', ') || 'nic'}`);
    if (lista.length !== 3) fail.push(`indeks rozmów nie odbudował się z plików (${lista.length} z 3)`);
    if (lista[0]?.id !== 'beta2') fail.push(`przypięta rozmowa nie stoi na górze po odbudowie (${lista[0]?.id})`);
    fs.rmSync(kat, { recursive: true, force: true });
  }

  /* ---- 4. Nagranie przerwane restartem nie wisi „w tle" na zawsze ----
     Transkrypcja żyła tylko w pamięci procesu: po restarcie pozycja zostawała
     „przepisuje się w tle", bez tekstu, na zawsze. Przy pierwszym zajrzeniu
     do bazy wiedzy rusza od nowa (tu zmysłów nie ma, więc kończy się pustym
     tekstem — ważne, że się KOŃCZY), a po dwóch przerwanych próbach
     przestaje udawać, że trwa. */
  {
    const kat = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cosmos-transkrypcja-'));
    const kb = path.join(kat, 'uzytkownicy', 'wlasciciel', 'kb');
    fs.mkdirSync(path.join(kb, 'files'), { recursive: true });
    fs.writeFileSync(path.join(kb, 'files', 'nagr1'), Buffer.alloc(2048));
    fs.writeFileSync(path.join(kb, 'files', 'nagr2'), Buffer.alloc(2048));
    const pozycja = (id, prob) => ({ id, type: 'file', name: `${id}.mp3`, mime: 'audio/mpeg', size: 2048, time: Date.now(),
      text: '', chunks: [], przetwarzanie: 'transkrypcja', ...(prob ? { probPrzepisania: prob } : {}) });
    fs.writeFileSync(path.join(kb, 'index.json'), JSON.stringify([pozycja('nagr1'), pozycja('nagr2', 2)]));
    const srv = uruchom('node', ['server.js'], { cwd: KORZEN, env: { ...bazaEnv, PORT: '3490', COSMOS_DATA_DIR: kat, SENSES_URL: 'http://127.0.0.1:9', EMBED_PROVIDER: 'off' } });
    let wTle = ['?'];
    if (await czekajNa('http://127.0.0.1:3490/')) {
      await fetch('http://127.0.0.1:3490/api/kb');
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const items = (await (await fetch('http://127.0.0.1:3490/api/kb')).json()).items || [];
        wTle = items.filter((it) => it.przetwarzanie).map((it) => it.name);
        if (!wTle.length) break;
      }
    }
    zabij(srv);
    console.log(`9. nagrania przerwane restartem, po pierwszym zajrzeniu do bazy: wciąż „w tle": ${wTle.join(', ') || 'żadne'}`);
    if (wTle.length) fail.push(`nagranie przerwane restartem dalej „przepisuje się w tle" (${wTle.join(', ')})`);
    fs.rmSync(kat, { recursive: true, force: true });
  }

  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nZAPIS NIE GUBI DANYCH OK');
  process.exit(fail.length ? 1 : 0);
})();

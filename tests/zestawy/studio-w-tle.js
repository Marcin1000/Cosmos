/* Studio w tle – generowanie nie kończy się stroną 524 za Cloudflare.

   Cloudflare zrywa żądanie, na które serwer nie odpowie w 100 s. Studio
   generowało wszystko w jednym żądaniu: obraz gpt-image w wysokiej jakości
   trwa minutę-dwie, cztery warianty albo storyboard – kilka minut. Człowiek
   dostawał 524, a serwer liczył dalej i zapisywał obraz, o którym nikt się
   nie dowiedział.

   Co musi być prawdą (atrapa generatora: słowo POWOLI = 1,5 s, a serwer
   czeka przed 202 tylko 0,4 s; BLAD = generator odpowiada 500):
     1. Szybkie generowanie odpowiada jak dawniej – 200 z obrazem. Mostek MCP
        i znacznik [OBRAZ:] w czacie działają bez zmian.
     2. Wolne odpowiada 202 z numerem zadania ZANIM praca się skończy.
     3. Dopytywanie: „pracuje", potem „gotowe" z obrazem, który leży w bazie
        wiedzy; odebrane zadanie znika.
     4. Błąd generatora w tle wraca jako „blad" z opisem, nie jako „gotowe".
     5. Cudze zadanie wygląda jak nieistniejące; zadanie poza żądaniem (bez
        osoby) rzuca, zamiast zgadywać, czyje jest.
     6. Na osobę pracuje najwyżej N zadań naraz – kolejne dostaje 429.
     7. Pomocnik przeglądarki (czekajNaZadanie) prowadzi od 202 do wyniku,
        przeżywa chwilowy brak sieci i przekazuje błąd z tła.
     8. Storyboard, edycja i dźwięk idą tą samą drogą; pobranie gotowego
        wideo nie wisi w odpytaniu statusu.
     9. W przeglądarce: „Generuj" przy wolnym generowaniu pokazuje „Trwa
        dłużej niż zwykle", a potem obraz – przez widok Studia (studio-widok.js). */
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
const { utworzZadania } = require('../../lib/zadania.js');
const { wKontekscie } = require('../../lib/kontekst.js');
const { czekajNaZadanie } = require('../../public/narzedzia.js');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const readJsonSafe = async (r) => {
  const tekst = await r.text();
  try { return JSON.parse(tekst); } catch { return { error: `HTTP ${r.status} – ${tekst.slice(0, 120)}` }; }
};
const t = (k) => k;
const spij = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const env = await srodowisko('studio');
  const A = env.adres;
  const post = (sciezka, dane) => fetch(A + sciezka, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dane),
  });
  const pobierz = (u) => fetch(A + u);
  const dopytujDoKonca = async (numer) => {
    let s = {};
    for (let i = 0; i < 60; i++) {
      await spij(150);
      s = await (await pobierz(`/api/zadania?id=${encodeURIComponent(numer)}`)).json();
      if (s.stan !== 'pracuje') break;
    }
    return s;
  };

  // --- 1. szybka ścieżka: jak dawniej -------------------------------------
  let obrazId = '';
  {
    const r = await post('/api/studio/image', { prompt: 'szybki kot na parapecie' });
    const d = await r.json();
    obrazId = d.item?.id || '';
    ok(r.status === 200 && d.url && d.item, `szybki obraz: 200 z obrazem od razu (${r.status})`);
  }

  // --- 2. wolna ścieżka: 202, zanim praca się skończy ------------------------
  let numer = '';
  {
    const t0 = Date.now();
    const r = await post('/api/studio/image', { prompt: 'POWOLI zachód słońca nad jeziorem' });
    const ms = Date.now() - t0;
    const d = await r.json();
    numer = d.zadanie || '';
    ok(r.status === 202 && numer, `wolny obraz: 202 z numerem zadania (${r.status})`);
    ok(ms < 1300, `żądanie nie czeka na koniec generowania (${ms} ms; generator potrzebuje 1500 ms)`);
  }

  // --- 3. dopytywanie: pracuje → gotowe; obraz w bazie wiedzy ---------------
  {
    const s1 = await (await pobierz(`/api/zadania?id=${numer}`)).json();
    ok(s1.stan === 'pracuje', `zaraz po 202: „pracuje" (${s1.stan})`);
    const s = await dopytujDoKonca(numer);
    ok(s.stan === 'gotowe' && s.wynik && s.wynik.url, `po chwili: „gotowe" z adresem obrazu (${s.stan})`);
    if (s.wynik && s.wynik.url) {
      const img = await pobierz(s.wynik.url);
      const buf = Buffer.from(await img.arrayBuffer());
      ok(img.ok && buf.subarray(1, 4).toString() === 'PNG', 'obraz z zadania leży w bazie wiedzy (PNG)');
    }
    const po = await pobierz(`/api/zadania?id=${numer}`);
    ok(po.status === 404, `odebrane zadanie znika z pamięci (${po.status})`);
  }

  // --- 4. błąd generatora w tle ----------------------------------------------
  {
    const r = await post('/api/studio/image', { prompt: 'POWOLI BLAD' });
    const d = await r.json();
    ok(r.status === 202 && d.zadanie, `wolny obraz z błędem: też 202 (${r.status})`);
    const s = await dopytujDoKonca(d.zadanie);
    ok(s.stan === 'blad' && /padł/.test(s.error || ''), `błąd w tle wraca jako „blad" z opisem generatora (${s.stan}: ${s.error})`);
  }

  // --- 5. cudze zadanie i zadanie bez osoby ----------------------------------
  {
    const zad = utworzZadania({ czekajMs: 10 });
    const marcin = { id: 'wlasciciel', rola: 'wlasciciel' };
    const ania = { id: 'ania', rola: 'czlonek' };
    const z = wKontekscie(marcin, () => zad.zacznij('obraz', 'test', async () => ({ ok: true })));
    await z.obietnica;
    ok(wKontekscie(ania, () => zad.wez(z.id)) === null, 'cudze zadanie wygląda jak nieistniejące');
    ok(wKontekscie(marcin, () => zad.wez(z.id)) !== null, 'własne zadanie widać');
    let rzucil = false;
    try { zad.zacznij('obraz', 'bez osoby', async () => ({})); } catch { rzucil = true; }
    ok(rzucil, 'zadanie poza żądaniem (bez osoby) rzuca, zamiast zgadywać, czyje jest');
    const r = await pobierz('/api/zadania?id=nie-ma-takiego');
    ok(r.status === 404, `nieznany numer: 404 (${r.status})`);
  }

  // --- 6. limit zadań naraz (w środowisku: 2) ----------------------------------
  {
    const r1 = await post('/api/studio/image', { prompt: 'POWOLI pierwszy' });
    const r2 = await post('/api/studio/image', { prompt: 'POWOLI drugi' });
    const r3 = await post('/api/studio/image', { prompt: 'POWOLI trzeci' });
    ok(r1.status === 202 && r2.status === 202, `dwa wolne zadania naraz: 202 i 202 (${r1.status}, ${r2.status})`);
    ok(r3.status === 429, `trzecie naraz: 429 z wyjaśnieniem (${r3.status})`);
    await czekajNaZadanie(r1, { pobierz, readJsonSafe, t, coIleMs: 150 }).catch(() => {});
    await czekajNaZadanie(r2, { pobierz, readJsonSafe, t, coIleMs: 150 }).catch(() => {});
  }

  // --- 7. pomocnik przeglądarki ----------------------------------------------
  {
    const r = await post('/api/studio/image', { prompt: 'POWOLI pomocnik' });
    let zerwane = 0;
    const kaprysna = async (u) => {
      if (zerwane < 2) { zerwane++; throw new TypeError('Failed to fetch'); }
      return pobierz(u);
    };
    const postep = [];
    const d = await czekajNaZadanie(r, { pobierz: kaprysna, readJsonSafe, t, coIleMs: 150, naPostep: (s) => postep.push(s) })
      .catch((e) => ({ error: e.message }));
    ok(d && d.url, `czekajNaZadanie: od 202 do obrazu mimo dwóch zerwanych dopytań (${d.error || 'ok'})`);
    ok(postep.length >= 1, `czekajNaZadanie: melduje postęp w trakcie (${postep.length}×)`);

    const r2 = await post('/api/studio/image', { prompt: 'szybki pies' });
    const d2 = await czekajNaZadanie(r2, { pobierz, readJsonSafe, t }).catch((e) => ({ error: e.message }));
    ok(d2 && d2.url, 'czekajNaZadanie: szybka odpowiedź przechodzi bez dopytywania');

    const r3 = await post('/api/studio/image', { prompt: 'POWOLI BLAD pomocnik' });
    let blad = '';
    try { await czekajNaZadanie(r3, { pobierz, readJsonSafe, t, coIleMs: 150 }); } catch (e) { blad = e.message; }
    ok(/padł/.test(blad), `czekajNaZadanie: błąd z tła rzuca opis generatora („${blad}")`);

    const r4 = await post('/api/studio/image', { prompt: '' });
    let blad4 = '';
    try { await czekajNaZadanie(r4, { pobierz, readJsonSafe, t }); } catch (e) { blad4 = e.message; }
    ok(/prompt/i.test(blad4), `czekajNaZadanie: błąd walidacji (400) rzuca od razu („${blad4}")`);
  }

  // --- 8. storyboard, edycja, dźwięk, wideo ----------------------------------
  {
    const rs = await post('/api/studio/storyboard', { scene: 'Niedźwiedź o zachodzie słońca', shots: 2 });
    const ds = await czekajNaZadanie(rs, { pobierz, readJsonSafe, t, coIleMs: 150 }).catch((e) => ({ error: e.message }));
    ok(Array.isArray(ds.frames) && ds.frames.length === 2 && ds.frames.every((f) => f.url),
      `storyboard: dwa kadry z obrazami (${ds.error || (ds.frames || []).length})`);

    const re = await post('/api/studio/edit', { imageId: obrazId, prompt: 'POWOLI dorysuj kota' });
    const statusEdycji = re.status;
    const de = await czekajNaZadanie(re, { pobierz, readJsonSafe, t, coIleMs: 150 }).catch((e) => ({ error: e.message }));
    ok(statusEdycji === 202 && de.url, `wolna edycja: 202, potem obraz (${statusEdycji}, ${de.error || 'ok'})`);

    const rd = await post('/api/studio/speech', { text: 'POWOLI Dzień dobry' });
    const statusDzwieku = rd.status;
    const dd = await czekajNaZadanie(rd, { pobierz, readJsonSafe, t, coIleMs: 150 }).catch((e) => ({ error: e.message }));
    let mp3 = false;
    if (dd.url) mp3 = Buffer.from(await (await pobierz(dd.url)).arrayBuffer()).subarray(0, 3).toString() === 'ID3';
    ok(statusDzwieku === 202 && mp3, `wolny dźwięk: 202, potem nagranie w bazie wiedzy (${statusDzwieku}, ${dd.error || 'ok'})`);

    const rv = await post('/api/studio/video', { prompt: 'POWOLI lot nad lasem' });
    const dv = await rv.json();
    ok(rv.ok && dv.taskId, `wideo: zlecone (${rv.status})`);
    let najdluzej = 0;
    let koniec = {};
    for (let i = 0; i < 30 && dv.taskId; i++) {
      const t0 = Date.now();
      const st = await (await pobierz(`/api/studio/video/status?id=${encodeURIComponent(dv.taskId)}`)).json();
      najdluzej = Math.max(najdluzej, Date.now() - t0);
      if (st.status !== 'running') { koniec = st; break; }
      await spij(200);
    }
    ok(koniec.status === 'done' && koniec.url, `wideo: gotowe i zapisane (${koniec.status || 'brak'})`);
    ok(najdluzej < 1000, `odpytanie statusu nie wisi na pobieraniu filmu (najdłuższe ${najdluzej} ms; pobranie trwa 1500 ms)`);
  }

  // --- 9. przeglądarka: przycisk „Generuj" przy wolnym generowaniu ---------
  if (!maPrzegladarke()) {
    console.log('⚠ Brak Chromium – pomijam część z przeglądarką.');
  } else {
    const b = await przegladarka();
    const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
    const bledy = [];
    p.on('pageerror', (e) => bledy.push(e.message));
    await p.goto(`${A}/app`, { waitUntil: 'load' });
    await p.waitForFunction(() => typeof openStudio === 'function');
    await p.evaluate(() => openStudio());
    await p.waitForFunction(() => !document.getElementById('studio-image-go').disabled);
    await p.fill('#studio-image-prompt', 'POWOLI latarnia morska o świcie');
    await p.click('#studio-image-go');
    const napisy = [];
    const koniec = Date.now() + 15000;
    let obraz = false;
    while (Date.now() < koniec) {
      const stan = await p.evaluate(() => ({
        tekst: document.getElementById('studio-image-out').textContent,
        img: Boolean(document.querySelector('#studio-image-out img')),
      }));
      if (stan.tekst) napisy.push(stan.tekst);
      if (stan.img) { obraz = true; break; }
      await spij(150);
    }
    ok(napisy.some((x) => /st\.dluzej|Trwa dłużej/.test(x)), `widok mówi, że trwa dłużej (${napisy.find((x) => /dłużej/.test(x)) || napisy.slice(-1)[0] || 'nic'})`);
    ok(obraz, 'po chwili w Studiu jest wygenerowany obraz');
    ok(bledy.length === 0, `bez błędów JavaScript (${bledy.slice(0, 2).join(' | ') || 'brak'})`);
    await b.close();
  }

  env.koniec();
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nSTUDIO W TLE OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

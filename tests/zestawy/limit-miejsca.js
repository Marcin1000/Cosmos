/* Limit miejsca i pełny dysk — zapis, który się nie udał, nie odpowiada „ok".

   Zespół IT zapchał dane testowego serwera do zera i zobaczył, że pamięć,
   profil, sprzęt i baza wiedzy odpowiadają `{ ok: true }`, choć na dysku nic
   się nie zmieniło — a po restarcie wszystko „zapisane" od zapełnienia znika.
   Do tego nic nie pilnowało, ile miejsca zajmuje jedna osoba: zaproszony gość
   mógł zapchać VPS-a plikami w bazie wiedzy wszystkim naraz.

   Co musi być prawdą:
     A. Limit osoby (tu właściciel z limitem 1 MB):
        1. plik, który się mieści, wchodzi; następny ponad limit dostaje 507
           z wyjaśnieniem, NIE trafia do bazy wiedzy i nie zostaje na dysku,
        2. „Twoje konto" pokazuje zajęte miejsce i limit,
        3. rozmowa, która przekroczyłaby limit, dostaje 507; mała zmiana
           przechodzi (liczy się przyrost, nie całość),
        4. usunięcie pliku zwalnia miejsce od razu.
     B. Prawdziwy pełny dysk (tmpfs zapchany do zera — tylko root na Linuksie,
        gdzie indziej jawnie pominięte):
        5. profil, pamięć, notatka i sprzęt dostają 507, a nie „ok",
        6. to, czego nie zapisano, nie udaje zapisanego (GET pokazuje stan dysku),
        7. po zwolnieniu miejsca zapis działa od razu, bez restartu.
     C. Mapowanie błędów: ENOSPC i przekroczony limit → 507, inny błąd → 500. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { serwerCosmosa, czekajNa, zabij, katalogOsoby } = require('../pomoc');
const miejsce = require('../../lib/miejsce.js');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const ENV = { EMBED_PROVIDER: 'off', SENSES_URL: 'http://127.0.0.1:9', COSMOS_LIMIT_MB_WLASCICIELA: '1' };

async function klient(adres) {
  const zadaj = async (sciezka, { metoda = 'GET', dane } = {}) => {
    const r = await fetch(adres + sciezka, {
      method: metoda, headers: dane ? { 'Content-Type': 'application/json' } : {},
      body: dane ? JSON.stringify(dane) : undefined,
    });
    let json = {};
    try { json = await r.json(); } catch { /* pusta odpowiedź */ }
    return { kod: r.status, json };
  };
  return zadaj;
}

const plik = (kb, nazwa) => ({ name: nazwa, mime: 'application/octet-stream', data: Buffer.alloc(kb * 1024, 7).toString('base64') });

(async () => {
  // --- C. mapowanie błędów (bez serwera) -----------------------------------
  {
    const pelny = Object.assign(new Error('no space left on device, write'), { code: 'ENOSPC' });
    ok(miejsce.bladDlaCzlowieka(pelny).kod === 507, 'ENOSPC → 507');
    ok(miejsce.bladDlaCzlowieka(new miejsce.BrakMiejsca('limit')).kod === 507, 'przekroczony limit osoby → 507');
    ok(miejsce.bladDlaCzlowieka(new Error('coś innego')).kod === 500, 'inny błąd → 500');
  }

  // --- A. limit osoby -------------------------------------------------------
  {
    const PORT = 3493;
    const srv = serwerCosmosa(PORT, ENV);
    const adres = `http://127.0.0.1:${PORT}`;
    if (!await czekajNa(adres)) { zabij(srv); throw new Error('serwer testowy nie wstał'); }
    const zadaj = await klient(adres);

    const r1 = await zadaj('/api/kb/file', { metoda: 'POST', dane: plik(600, 'pierwszy.bin') });
    ok(r1.kod === 200, `plik 600 KB przy limicie 1 MB wchodzi (${r1.kod})`);
    const r2 = await zadaj('/api/kb/file', { metoda: 'POST', dane: plik(600, 'drugi.bin') });
    ok(r2.kod === 507 && /miejsce/i.test(r2.json.error || ''), `drugi plik ponad limit: 507 z wyjaśnieniem (${r2.kod}: ${r2.json.error})`);
    const lista = (await zadaj('/api/kb')).json.items || [];
    ok(lista.length === 1 && lista[0].name === 'pierwszy.bin', `odrzucony plik nie trafił do bazy wiedzy (${lista.map((x) => x.name).join(', ')})`);
    const katalogPlikow = path.join(katalogOsoby({ katalogDanych: srv.katalogDanych }), 'kb', 'files');
    const naDysku = fs.existsSync(katalogPlikow) ? fs.readdirSync(katalogPlikow) : [];
    ok(naDysku.length === 1, `na dysku nie został plik-sierota (${naDysku.length} plików)`);

    const konto = (await zadaj('/api/konto')).json.miejsce || {};
    ok(konto.limit === 1024 * 1024 && konto.zajete >= 600 * 1024, `„Twoje konto" zna zajęte miejsce i limit (${konto.zajete} z ${konto.limit} B)`);

    const duza = { title: 'Duża rozmowa', messages: [{ role: 'user', content: 'x'.repeat(700 * 1024) }] };
    const rd = await zadaj('/api/conversations?id=duza1', { metoda: 'PUT', dane: duza });
    ok(rd.kod === 507, `rozmowa, która przekroczyłaby limit: 507 (${rd.kod})`);
    const mala = { title: 'Mała rozmowa', messages: [{ role: 'user', content: 'Cześć' }] };
    const rm = await zadaj('/api/conversations?id=mala1', { metoda: 'PUT', dane: mala });
    ok(rm.kod === 200, `mała rozmowa przy prawie pełnym limicie przechodzi (${rm.kod})`);

    const usun = await zadaj(`/api/kb?id=${encodeURIComponent(lista[0] ? lista[0].id : '')}`, { metoda: 'DELETE' });
    const r3 = await zadaj('/api/kb/file', { metoda: 'POST', dane: plik(600, 'trzeci.bin') });
    ok(usun.kod === 200 && r3.kod === 200, `usunięcie pliku zwalnia miejsce od razu (${usun.kod}, potem ${r3.kod})`);
    zabij(srv);
  }

  // --- B. prawdziwy pełny dysk ---------------------------------------------
  const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-pelny-dysk-'));
  let zamontowany = false;
  try {
    if (process.platform === 'linux') {
      execSync(`mount -t tmpfs -o size=6m tmpfs ${mnt}`, { stdio: 'ignore' });
      zamontowany = true;
    }
  } catch { /* brak uprawnień */ }
  if (!zamontowany) {
    console.log('⚠ Nie da się zamontować tmpfs (potrzebny root na Linuksie) — pomijam część z pełnym dyskiem.');
  } else {
    const PORT = 3494;
    const srv = serwerCosmosa(PORT, { ...ENV, COSMOS_LIMIT_MB_WLASCICIELA: '', COSMOS_DATA_DIR: mnt });
    const adres = `http://127.0.0.1:${PORT}`;
    try {
      if (!await czekajNa(adres)) throw new Error('serwer na tmpfs nie wstał');
      const zadaj = await klient(adres);
      ok((await zadaj('/api/profile', { metoda: 'POST', dane: { profile: 'Stary profil' } })).kod === 200, 'przed zapchaniem profil się zapisuje');

      // Zapchaj dysk do zera.
      const zapchaj = path.join(mnt, 'zapchaj.bin');
      const fd = fs.openSync(zapchaj, 'w');
      const kawalek = Buffer.alloc(64 * 1024);
      try { for (;;) fs.writeSync(fd, kawalek); } catch { /* ENOSPC — o to chodziło */ }
      try { for (;;) fs.writeSync(fd, Buffer.alloc(512)); } catch { /* do ostatniego bloku */ }
      fs.closeSync(fd);

      const rp = await zadaj('/api/profile', { metoda: 'POST', dane: { profile: 'Nowy profil' } });
      ok(rp.kod === 507, `pełny dysk: profil dostaje 507, nie „ok" (${rp.kod}: ${rp.json.error})`);
      const profil = (await zadaj('/api/profile')).json.profile;
      ok(profil === 'Stary profil', `niezapisany profil nie udaje zapisanego („${profil}")`);

      const rpam = await zadaj('/api/memory', { metoda: 'POST', dane: { text: 'Zapamiętaj: klucz pod wycieraczką' } });
      ok(rpam.kod === 507, `pełny dysk: pamięć dostaje 507 (${rpam.kod})`);
      const pamiec = (await zadaj('/api/memory')).json.memories || [];
      ok(!pamiec.some((m) => /wycieraczk/.test(m.text)), 'niezapisany wpis nie wisi w pamięci do restartu');

      const rn = await zadaj('/api/kb/note', { metoda: 'POST', dane: { text: 'Notatka na pełnym dysku', title: 'Pełny dysk' } });
      ok(rn.kod === 507, `pełny dysk: notatka w bazie wiedzy dostaje 507 (${rn.kod})`);
      const rs = await zadaj('/api/gear', { metoda: 'PUT', dane: { korpus: 'R6 II', obiektywy: '24-105 f/4' } });
      ok(rs.kod === 507, `pełny dysk: sprzęt dostaje 507 (${rs.kod})`);

      fs.unlinkSync(zapchaj);
      const po = await zadaj('/api/profile', { metoda: 'POST', dane: { profile: 'Profil po zwolnieniu' } });
      const profilPo = (await zadaj('/api/profile')).json.profile;
      ok(po.kod === 200 && profilPo === 'Profil po zwolnieniu', `po zwolnieniu miejsca zapis działa bez restartu (${po.kod})`);
    } finally {
      zabij(srv);
      await new Promise((r) => setTimeout(r, 500));
      try { execSync(`umount ${mnt}`, { stdio: 'ignore' }); } catch { /* spróbujemy leniwie */ try { execSync(`umount -l ${mnt}`, { stdio: 'ignore' }); } catch { /* zostaje */ } }
    }
  }
  try { fs.rmdirSync(mnt); } catch { /* */ }

  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nLIMIT MIEJSCA OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

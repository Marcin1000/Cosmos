/* Archiwum bez zamrożeń — paczka 5000 plików nie stawia serwera wszystkim.

   Zespół IT zmierzył: POST /api/archive/add z 5000 wpisami liczył się jednym
   ciągiem ~1,9 s (pozycja Słońca i tematy na każdy plik). Przez ten czas
   serwer nie odpowiadał nikomu — stały strumienie czatu wszystkich osób.
   A trasa jest dla każdego zaproszonego, bez limitu żądań.

   Co musi być prawdą:
     1. W trakcie wgrywania 5000 wpisów serwer odpowiada innym żądaniom:
        najdłuższa odpowiedź na lekkie pytanie < 400 ms (było ~2000 ms).
     2. Wynik ten sam co dawniej: 5000 dodanych, ponowne wgranie = 5000
        odświeżonych (nie dubli) — i też bez zamrożenia.
     3. Druga paczka tej samej osoby w trakcie pierwszej dostaje 429 —
        pętla takich żądań nie zajmie całego procesora.
     4. Wpisy są potem w archiwum (wyszukiwanie je widzi). */
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3497;
const ADRES = `http://127.0.0.1:${PORT}`;
const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

function paczka(n, od = 0) {
  const wpisy = [];
  for (let i = od; i < od + n; i++) {
    wpisy.push({
      id: `onedrive:test-${i}`, zrodlo: 'onedrive', typ: i % 7 ? 'zdjecie' : 'wideo',
      nazwa: `3B9A${10000 + i}.CR3`, sciezka: `/Zdjęcia/Mazury 2026/3B9A${10000 + i}.CR3`,
      kiedy: new Date(Date.UTC(2026, 5, 1 + (i % 28), 4 + (i % 16), i % 60)).toISOString(),
      lat: 53.8 + (i % 100) / 1000, lon: 21.6 + (i % 100) / 1000,
      ogniskowa: [24, 50, 105][i % 3], przyslona: 4, iso: 100 * (1 + (i % 8)),
    });
  }
  return wpisy;
}

/** Wyślij paczkę i w tym czasie co 25 ms pytaj serwer o coś lekkiego. */
async function zPomiarem(wpisy) {
  let najdluzej = 0;
  let pingow = 0;
  let trwa = true;
  const pinguj = (async () => {
    while (trwa) {
      const t0 = Date.now();
      await fetch(`${ADRES}/api/auth`).then((r) => r.text()).catch(() => {});
      najdluzej = Math.max(najdluzej, Date.now() - t0);
      pingow++;
      await new Promise((r) => setTimeout(r, 25));
    }
  })();
  const t0 = Date.now();
  const r = await fetch(`${ADRES}/api/archive/add`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wpisy }),
  });
  const wynik = await r.json();
  const ms = Date.now() - t0;
  trwa = false;
  await pinguj;
  return { kod: r.status, wynik, ms, najdluzej, pingow };
}

(async () => {
  const srv = serwerCosmosa(PORT, { EMBED_PROVIDER: 'off', SENSES_URL: 'http://127.0.0.1:9' });
  if (!await czekajNa(ADRES)) { zabij(srv); throw new Error('serwer testowy nie wstał'); }
  // rozgrzewka — pierwsze żądanie ładuje moduły i archiwum osoby
  await fetch(`${ADRES}/api/archive/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wpisy: paczka(10, 90000) }) });

  const pierwsza = paczka(5000);
  const a = await zPomiarem(pierwsza);
  console.log(`   wgranie 5000: ${a.ms} ms, pingów w trakcie: ${a.pingow}, najdłuższy: ${a.najdluzej} ms`);
  ok(a.kod === 200 && a.wynik.dodanych === 5000, `5000 wpisów dodanych (${a.kod}, ${a.wynik.dodanych})`);
  ok(a.najdluzej < 400, `w trakcie wgrywania serwer odpowiada innym: najdłużej ${a.najdluzej} ms (było ~2000 ms)`);

  const b = await zPomiarem(pierwsza);
  console.log(`   ponowne wgranie 5000: ${b.ms} ms, najdłuższy ping: ${b.najdluzej} ms`);
  ok(b.kod === 200 && b.wynik.odswiezonych === 5000 && b.wynik.dodanych === 0,
    `ponowne wgranie: 5000 odświeżonych, 0 dubli (${b.wynik.odswiezonych}/${b.wynik.dodanych})`);
  ok(b.najdluzej < 400, `ponowne wgranie też bez zamrożenia: najdłużej ${b.najdluzej} ms`);

  // 3. druga paczka w trakcie pierwszej
  const trzecia = fetch(`${ADRES}/api/archive/add`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wpisy: paczka(5000, 10000) }),
  });
  await new Promise((r) => setTimeout(r, 150));
  const druga = await fetch(`${ADRES}/api/archive/add`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wpisy: paczka(10, 20000) }),
  });
  const dd = await druga.json();
  ok(druga.status === 429, `druga paczka w trakcie pierwszej: 429 (${druga.status}: ${dd.error || ''})`);
  const t = await (await trzecia).json();
  ok(t.dodanych === 5000, `pierwsza paczka dokończona mimo odmowy drugiej (${t.dodanych})`);

  // 4. wpisy są w archiwum
  const s = await (await fetch(`${ADRES}/api/archive/search?zrodlo=onedrive&limit=5`)).json();
  const razem = s.znaleziono;
  ok(razem >= 10000, `wyszukiwanie widzi wgrane pliki (${razem})`);

  zabij(srv);
  console.log(fail.length ? `\nDO POPRAWY (${fail.length}):\n- ${fail.join('\n- ')}` : '\nARCHIWUM BEZ ZAMROŻEŃ OK');
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

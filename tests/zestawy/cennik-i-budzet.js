/* Cennik modeli, budżet w złotówkach i plan zdjęciowy jako funkcja
   (zespół agentów, etap 5 – paczka K).

   Zespół agentów to kilka płatnych wywołań na jedno pytanie. Marcin chce
   widzieć i ograniczać ich koszt w złotówkach – sobie i członkom na swoich
   kluczach. Gwarancje:

     1. cennik: znane modele Claude'a z ceną z tabeli Anthropic (także ze
        starym układem nazwy i datą na końcu), chmura NVIDIA i lokalny GPU za
        0 zł, nieznany model płatny liczony OSTROŻNIE (nie taniej niż
        najdroższy znany z jego rodziny), szacunek przed startem dolicza ukryte
        myślenie, a COSMOS_CENNIK i COSMOS_KURS_USD_PLN nadpisują ceny i kurs,
     2. zapis kosztu: `konta.zanotujZuzycie` liczy złotówki z `usage` i modelu,
        przy braku `usage` – z szacunku (nie zero), darmowy silnik – zero;
        właściciel NIE widzi wydatków z własnego klucza członka, członek widzi
        swoje w całości; nazwa modelu nie zostaje w pliku kont,
     3. budżet: rezerwacja jest synchroniczna – sześć ról naraz (Promise.all)
        przy budżecie na trzy przechodzi DOKŁADNIE trzy razy; limit od
        właściciela nie dotyczy własnego klucza członka, własny limit dotyczy
        wszystkiego; obowiązuje najciaśniejszy; rozliczenie i zwolnienie
        oddają rezerwację, porzucona wygasa; zmiana limitu działa od razu,
     4. zapis limitu: zła kwota → 400, limit „od właściciela” dla właściciela
        → 404, tekst z przecinkiem przyjęty, brak pola = bez zmiany,
     5. plan jako funkcja: `policzPlan` oddaje dokładnie to, co trasa
        /api/plan, plus tekst dla modelu; `typ` działa tylko w funkcji (trasa
        bez zmiany zachowania), odmowy z tym samym komunikatem co trasa.

   Bez serwera i bez przeglądarki – moduły wołane wprost. Czat (odmowa 429
   przy wyczerpanym budżecie) i trasy – zestawy izolacja-osob (punkt 10)
   i konta-i-logowanie (punkt 11c). */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.COSMOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-cennik-budzet-'));
delete process.env.COSMOS_CENNIK;
delete process.env.COSMOS_KURS_USD_PLN;

const R = path.join(__dirname, '..', '..', 'lib');
const { utworzCennik } = require(path.join(R, 'cennik.js'));
const { utworzBudzet, REZERWACJA_MS } = require(path.join(R, 'budzet.js'));
const konta = require(path.join(R, 'konta.js'));
const plenerTrasy = require(path.join(R, 'plener-trasy.js'));

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };
const pauza = (ms) => new Promise((r) => setTimeout(r, ms));
const blisko = (a, b) => Math.abs(a - b) < 1e-4;

(async () => {
  // --- 1. Cennik -------------------------------------------------------------------
  const c = utworzCennik({ env: {} });
  const opus = c.ceny('claude-opus-5-5', 'claude');
  ok(opus.we === 4 && opus.wy === 20 && opus.pewne && opus.zrodlo === 'katalog' && opus.waluta === 'USD' && /^\d{4}-\d{2}-\d{2}$/.test(opus.stan),
    `Opus 5.5: 4/20 USD za MTok, pewne, z katalogu (${JSON.stringify(opus)})`);
  const tabela = [
    ['claude-fable-5-1', 10, 50], ['claude-sonnet-5-5', 2, 10], ['claude-haiku-4-5', 1, 5],
    ['claude-sonnet-4-5-20250929', 3, 15], ['claude-3-5-haiku-20241022', 0.8, 4], ['anthropic/claude-opus-4-8', 5, 25],
  ];
  for (const [m, we, wy] of tabela) {
    const x = c.ceny(m, 'claude');
    ok(x.we === we && x.wy === wy, `${m} → ${we}/${wy} (${x.we}/${x.wy})`);
  }
  ok(c.ceny('claude-haiku-4-5', 'openai').we === 1, 'dostawca po NAZWIE modelu, nie po silniku (Claude przez pośrednika OpenAI)');
  for (const [m, s] of [['nemotron-super', 'cloud'], ['qwen3:14b', 'local'], ['claude-opus-5-5', 'cloud']]) {
    ok(c.darmowy(s) && c.kosztZl(m, s, { we: 1e6, wy: 1e6 }) === 0 && c.ceny(m, s).zrodlo === 'darmowy', `${s} (${m}) = 0 zł`);
  }
  ok(!c.darmowy('openai') && !c.darmowy('claude'), 'OpenAI i Claude są płatne');
  const znaneOpus = ['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-1', 'claude-3-opus'].map((m) => c.ceny(m, 'claude'));
  const nowyOpus = c.ceny('claude-opus-6', 'claude');
  ok(!nowyOpus.pewne && nowyOpus.zrodlo === 'domysl' && znaneOpus.every((z) => nowyOpus.we >= z.we && nowyOpus.wy >= z.wy),
    `nieznany Opus – nie taniej niż najdroższy znany Opus (${nowyOpus.we}/${nowyOpus.wy})`);
  const nowyMini = c.ceny('gpt-5.5-mini', 'openai');
  ok(!nowyMini.pewne && nowyMini.wy >= c.ceny('gpt-5-mini', 'openai').wy && nowyMini.wy < c.ceny('gpt-5', 'openai').wy,
    `nowy gpt-5.x-mini liczony jak rodzina mini, nie jak pełny gpt-5 (${nowyMini.we}/${nowyMini.wy})`);
  const obcy = c.ceny('jakis-model-7b', 'openai');
  ok(obcy.zrodlo === 'domysl' && ['gpt-5', 'gpt-4o', 'o3', 'gpt-4.1'].every((m) => obcy.wy >= c.ceny(m, 'openai').wy),
    `model spoza cennika – ostrożnie, nie taniej niż zwykłe modele dostawcy (${obcy.we}/${obcy.wy})`);
  ok(c.kurs() === 3.7, `kurs domyślny 3,70 zł (${c.kurs()})`);
  ok(blisko(c.kosztZl('claude-opus-5-5', 'claude', { we: 1e6, wy: 1e6 }), 24 * 3.7), 'koszt = (we × cena we + wy × cena wy) / 1e6 × kurs');
  ok(c.kosztZl('claude-opus-5-5', 'claude', { we: 6000, wy: 900 }) === 0.1554, `koszt w zł z 4 miejscami (${c.kosztZl('claude-opus-5-5', 'claude', { we: 6000, wy: 900 })})`);
  const bez = c.kosztZl('claude-opus-5-5', 'claude', { we: 6000, wy: 900 });
  ok(c.szacujZl('claude-opus-5-5', 'claude', { we: 6000, wy: 900 }) > bez, 'szacunek przed startem dolicza ukryte myślenie modelu myślącego');
  ok(c.szacujZl('claude-opus-5-5', 'claude', { we: 6000, wy: 900, myslenie: false }) === bez, '…chyba że `myslenie: false`');
  ok(c.szacujZl('claude-haiku-4-5', 'claude', { we: 6000, wy: 900 }) === c.kosztZl('claude-haiku-4-5', 'claude', { we: 6000, wy: 900 }),
    'model bez myślenia – szacunek = koszt');
  const cE = utworzCennik({ env: { COSMOS_CENNIK: '{"gpt-5.5*": [2, 15], "claude-opus-5-5": {"we": 1, "wy": 2}, "zly": "x"}', COSMOS_KURS_USD_PLN: '4,05' } });
  const e1 = cE.ceny('gpt-5.5-mini-2026-01-01', 'openai');
  ok(e1.we === 2 && e1.wy === 15 && e1.zrodlo === 'env' && e1.pewne, `COSMOS_CENNIK: przedrostek z „*” i data na końcu (${JSON.stringify(e1)})`);
  ok(cE.ceny('claude-opus-5-5', 'claude').wy === 2, 'COSMOS_CENNIK wygrywa z wbudowanym cennikiem');
  ok(cE.kurs() === 4.05, `COSMOS_KURS_USD_PLN z przecinkiem (${cE.kurs()})`);
  const bladOstrz = console.warn;
  console.warn = () => {};
  const cZ = utworzCennik({ env: { COSMOS_CENNIK: '{zły json', COSMOS_KURS_USD_PLN: '-2' } });
  console.warn = bladOstrz;
  ok(cZ.ceny('claude-opus-5-5', 'claude').we === 4 && cZ.kurs() === 3.7, 'zły COSMOS_CENNIK i ujemny kurs – wbudowane wartości, bez wywrotki');

  // --- 2. Zapis kosztu w koncie --------------------------------------------------------
  konta.ustawCennik(c);
  await konta.zapewnijWlasciciela({ login: 'marcin' });
  const nowy = async (login) => {
    const { token } = konta.utworzZaproszenie({ nazwa: login, przez: 'wlasciciel' });
    return (await konta.przyjmijZaproszenie(token, { login, haslo: `haslo-${login}-12345` })).id;
  };
  const idA = await nowy('ania');
  const idB = await nowy('bartek');
  const W = konta.znajdz('wlasciciel');
  const A = konta.znajdz(idA);
  const B = konta.znajdz(idB);

  const k1 = konta.zanotujZuzycie(idA, { silnik: 'claude', zrodlo: 'przyznany', model: 'claude-opus-5-5', we: 6000, wy: 900 });
  ok(k1 === 0.1554, `zanotujZuzycie liczy zł z usage i modelu i oddaje kwotę (${k1})`);
  const k2 = konta.zanotujZuzycie(idA, { silnik: 'cloud', zrodlo: 'wspolny', model: 'claude-opus-5-5', we: 6000, wy: 900 });
  ok(k2 === 0, 'darmowy silnik – 0 zł, nawet z nazwą płatnego modelu');
  ok(konta.zanotujZuzycie(idA, { silnik: 'local', zrodlo: 'przyznany', model: 'claude-opus-5-5', zl: 0.5 }) === 0,
    'darmowy silnik – 0 zł, nawet gdy wołający poda kwotę (rola na chmurze nie zjada budżetu)');
  const k3 = konta.zanotujZuzycie(idA, { silnik: 'claude', zrodlo: 'wlasny', model: 'claude-opus-5-5', we: 0, wy: 0, szacunek: { we: 6000, wy: 900 } });
  ok(blisko(k3, 1.5 * 0.1554), `brak usage (przerwany strumień) – 1,5 × szacunek, nie zero (${k3})`);
  const k4 = konta.zanotujZuzycie(idA, { silnik: 'openai', zrodlo: 'przyznany', model: 'gpt-5', zl: 0.5 });
  ok(k4 === 0.5, 'kwota podana wprost (orkiestrator ją zna) – zapisana tak, jak jest');
  const k5 = konta.zanotujZuzycie(idA, { silnik: 'openai', zrodlo: 'przyznany', model: 'gpt-5', we: 0, wy: 0 });
  ok(k5 === 0, 'bez usage i bez szacunku – 0 (nie zgadujemy)');
  const zlW = konta.znajdz(idA).zuzycie.zl;          // widok jak w panelu właściciela
  const zlA = konta.zuzycieOsoby(idA).zl;             // widok osoby
  ok(blisko(zlW.dzis, 0.6554) && !zlW.zrodla.wlasny && blisko(zlW.zrodla.wlasciciel.dzis, 0.6554),
    `właściciel widzi wydatki członka na SWOICH kluczach, bez własnego klucza członka (${JSON.stringify(zlW)})`);
  ok(blisko(zlA.dzis, 0.6554 + k3) && zlA.zrodla.wlasny && blisko(zlA.zrodla.wlasny.dzis, k3) && blisko(zlA.miesiac, zlA.dzis),
    `członek widzi u siebie całość, z podziałem na źródła (${JSON.stringify(zlA)})`);
  const sil = konta.zuzycieOsoby(idA).silniki.dzisiaj;
  ok(sil.claude && blisko(sil.claude.zl, 0.1554 + k3) && sil.openai && sil.openai.zl === 0.5, 'liczniki silników mają też złotówki');
  konta.zapiszZalegle();
  const plik = fs.readFileSync(konta.PLIK_UZYTKOWNICY, 'utf8');
  ok(/"zl"/.test(plik) && !/claude-opus-5-5|gpt-5/.test(plik), 'złotówki są w pliku kont, nazwy modeli – nie');

  // --- 3. Budżet ------------------------------------------------------------------------
  const budzet = utworzBudzet({ konta, cennik: c });
  const bezLimitu = budzet.stan(B);
  ok(bezLimitu.dzien === 0 && bezLimitu.zostaloDzis === null && !bezLimitu.wyczerpany, 'bez limitu: 0 = bez limitu, zostało = null');
  ok(budzet.zarezerwuj(B, 1000, { naKluczuWlasciciela: true }).ok, 'bez limitu każda rezerwacja przechodzi');
  konta.ustawBudzet(idB, { dzien: 1 });

  // Sześć ról naraz, każda po 0,30 zł, dzienny budżet 1 zł na kluczach właściciela.
  const budzet2 = utworzBudzet({ konta, cennik: c });
  const wyniki = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
    await pauza(i % 3);
    return budzet2.zarezerwuj(B, 0.3, { naKluczuWlasciciela: true });
  }));
  const przeszly = wyniki.filter((w) => w.ok);
  ok(przeszly.length === 3, `6 ról naraz przy budżecie na 3 → przechodzą dokładnie 3 (${przeszly.length})`);
  const odmowa = wyniki.find((w) => !w.ok) || {};
  ok(odmowa.kod === 'budzet-dzienny' && odmowa.limit === 'wlasciciel' && blisko(odmowa.zostalo, 0.1),
    `odmowa mówi, który limit i ile zostało (${JSON.stringify(odmowa)})`);
  ok(budzet2.zarezerwuj(B, 0.3, { naKluczuWlasciciela: false }).ok, 'limit od właściciela nie dotyczy własnego klucza członka');
  const st = budzet2.stan(B, { naKluczuWlasciciela: true });
  ok(st.dzien === 1 && st.limit.dzien === 'wlasciciel' && st.zarezerwowano > 0.89 && blisko(st.zostaloDzis, 0.1), `stan liczy rezerwacje (${JSON.stringify(st)})`);
  // Rola skończona: wydatek zapisuje konto, rozliczenie tylko zwalnia rezerwację.
  konta.zanotujZuzycie(idB, { silnik: 'claude', zrodlo: 'przyznany', model: 'claude-opus-5-5', zl: 0.2 });
  budzet2.rozlicz(przeszly[0].token, 0.2);
  const po1 = budzet2.stan(B, { naKluczuWlasciciela: true });
  ok(blisko(po1.wydanoDzis, 0.2) && blisko(po1.zostaloDzis, 0.2), `po rozliczeniu: wydane 0,20, zostało 0,20 – bez podwójnego liczenia (${po1.wydanoDzis}/${po1.zostaloDzis})`);
  budzet2.zwolnij(przeszly[1].token);
  ok(blisko(budzet2.stan(B, { naKluczuWlasciciela: true }).zostaloDzis, 0.5), 'zwolniona rezerwacja wraca do puli');
  // Porzucona rezerwacja wygasa.
  const teraz = Date.now;
  Date.now = () => teraz() + REZERWACJA_MS + 1000;
  const poWygasnieciu = budzet2.stan(B, { naKluczuWlasciciela: true }).zostaloDzis;
  Date.now = teraz;
  ok(blisko(poWygasnieciu, 0.8), `porzucona rezerwacja wygasa (zostało ${poWygasnieciu})`);
  // Najciaśniejszy limit i własny limit na własnym kluczu.
  konta.ustawBudzet(idB, { dzien: 0.5 }, { wlasny: true });
  const st2 = budzet2.stan(B);
  ok(st2.dzien === 0.5 && st2.limit.dzien === 'wlasny', `obowiązuje najciaśniejszy z limitów (${st2.dzien}, ${st2.limit.dzien})`);
  const wl = budzet2.zarezerwuj(B, 0.4, { naKluczuWlasciciela: false });
  ok(!wl.ok && wl.limit === 'wlasny', 'własny limit dotyczy też własnego klucza');
  // Wyczerpany: po wydaniu całości płatny czat dostaje odmowę, darmowa kwota przechodzi.
  konta.zanotujZuzycie(idB, { silnik: 'claude', zrodlo: 'wlasny', model: 'claude-opus-5-5', zl: 0.35 });
  const wycz = budzet2.wyczerpany(B, { naKluczuWlasciciela: false });
  ok(wycz && wycz.kod === 'budzet-dzienny' && wycz.limit === 'wlasny' && wycz.okres === 'dzien', `wyczerpany: kod, okres, limit (${JSON.stringify(wycz)})`);
  ok(budzet2.stan(B).wyczerpany && budzet2.stan(B).zostaloDzis === 0, 'stan mówi „wyczerpany”, zostało 0');
  ok(budzet2.zarezerwuj(B, 0, { naKluczuWlasciciela: true }).ok, 'kwota 0 (darmowy silnik) przechodzi zawsze');
  // Zmiana limitu działa od następnej rezerwacji (konto czytane świeżo).
  konta.ustawBudzet(idB, { dzien: 0, miesiac: 0.6 }, { wlasny: true });
  ok(!budzet2.wyczerpany(B, { naKluczuWlasciciela: false }), 'podniesiony limit działa od razu');
  const mies = budzet2.zarezerwuj(B, 0.1, { naKluczuWlasciciela: false });
  ok(!mies.ok && mies.kod === 'budzet-miesieczny', `limit miesięczny ma własny kod (${mies.kod})`);
  ok(budzet2.limity(W).odWlasciciela === null && budzet2.limity(B).wlasny.miesiac === 0.6, 'właściciel nie ma limitu „od właściciela”');
  ok(budzet2.stan(A).dzien === 0 && !budzet2.stan(A).wyczerpany, 'limity jednej osoby nie dotyczą drugiej');
  let rzucil = null;
  try { budzet2.zarezerwuj(null, 1); } catch (err) { rzucil = err; }
  ok(Boolean(rzucil), 'rezerwacja bez osoby – wyjątek, nie „w takim razie ktoś”');

  // --- 4. Zapis limitu ---------------------------------------------------------------------
  const zle = [-1, 'abc', 100001, {}].map((v) => konta.ustawBudzet(idA, { dzien: v }).blad);
  ok(zle.every((b) => b && b.kod === 400 && b.kodBledu === 'budzet-zly'), 'zła kwota (ujemna, tekst, za duża, obiekt) → 400');
  const przecinek = konta.ustawBudzet(idA, { dzien: '12,50', miesiac: 100 });
  ok(!przecinek.blad && przecinek.limit.dzien === 12.5 && przecinek.uzytkownik.budzetZl.miesiac === 100, 'kwota z przecinkiem przyjęta, widok konta ją pokazuje');
  const bezPola = konta.ustawBudzet(idA, { miesiac: 0 });
  ok(bezPola.limit.dzien === 12.5 && bezPola.limit.miesiac === 0, 'brak pola = bez zmiany, 0 = bez limitu');
  ok(konta.ustawBudzet('wlasciciel', { dzien: 5 }).blad.kod === 404, 'limitu „od właściciela” dla właściciela nie ma (404)');
  ok(!budzet2.ustawWlasny(W, { dzien: 3 }) && budzet2.limity(W).wlasny.dzien === 3, 'właściciel ustawia sobie własny limit');
  ok(budzet2.ustawWlasny(W, { dzien: -3 }).kod === 400, 'ustawWlasny: zła kwota → błąd 400');

  // --- 5. Plan zdjęciowy jako funkcja -----------------------------------------------------
  const katalog = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-plan-funkcja-'));
  let osoba = { katalog, sprzet: { korpus: 'Canon R6 Mark II', obiektywy: '24-105 f/4, 70-200 f/4', dodatki: '' },
    wspolrzedne: { lat: 50.0614, lon: 19.9366 }, location: 'Kraków' };
  const odpowiedzi = [];
  const plener = plenerTrasy.utworz({
    U: () => osoba,
    readJson: async (req) => req.cialo,
    sendJson: (res, kod, obj) => { odpowiedzi.push({ kod, obj: JSON.parse(JSON.stringify(obj)) }); },
    addEvent: () => {}, bladZapisu: () => {},
  });
  const trasa = async (cialo) => {
    await plener.handlePlener({ method: 'POST', cialo }, {}, '/api/plan');
    return odpowiedzi.pop();
  };
  // Bez sieci: współrzędne zapisane (bez strefy miejsca), niebo podane, Słońce wysoko (bez zorzy).
  const d = { kiedy: '2026-06-21T10:00:00Z', zachmurzenie: 'bezchmurnie', tryb: 'zdjecie', obiektyw: '24-105 f/4' };
  const bezTeraz = (x) => { const k = JSON.parse(JSON.stringify(x)); if (k.slonce && k.slonce.lokalnie) delete k.slonce.lokalnie.teraz; return k; };
  const zTrasy = await trasa({ ...d });
  const zFunkcji = await plener.policzPlan({ ...d });
  ok(zTrasy.kod === 200 && zFunkcji.ok, 'trasa i funkcja liczą plan');
  ok(JSON.stringify(bezTeraz(zFunkcji.dane)) === JSON.stringify(bezTeraz(zTrasy.obj)), 'policzPlan.dane = dokładnie ciało odpowiedzi /api/plan');
  ok(zFunkcji.tekst.startsWith('DANE PLANU ZDJĘCIOWEGO (policzone przez Cosmosa') && zFunkcji.tekst.endsWith(JSON.stringify(zFunkcji.dane, null, 1)),
    'tekst = nagłówek „DANE PLANU…” + dane planu, jak po znaczniku [PLAN:]');
  const dn = zFunkcji.dane;
  ok(dn.slonce && dn.slonce.wschod && dn.slonce.zachod && dn.slonce.zlotaWieczor && Number.isFinite(dn.slonce.azymut)
    && Number.isFinite(dn.slonce.wysokosc) && dn.ustawienia && dn.miejsce === 'Kraków',
  'dane: wschód, zachód, złota godzina, azymut i wysokość Słońca, nastawy, miejsce');
  ok(/f\/4|4\.0|4,0/.test(JSON.stringify(dn.ustawienia)) && !/f\/2\.8/.test(JSON.stringify(dn.ustawienia)), 'nastawy w sprzęcie osoby (f/4, nie f/2.8)');
  const typF = await plener.policzPlan({ ...d, tryb: undefined, typ: 'zdjecie' });
  const typT = await trasa({ ...d, tryb: undefined, typ: 'zdjecie' });
  ok(typF.dane.ustawienia.tryb === 'zdjecie' && typT.obj.ustawienia.tryb === 'wideo', '`typ` = `tryb` tylko w funkcji; trasa bez zmiany zachowania');
  const zlaData = await plener.policzPlan({ ...d, kiedy: 'jutro-po-poludniu' });
  const zlaDataT = await trasa({ ...d, kiedy: 'jutro-po-poludniu' });
  ok(!zlaData.ok && zlaData.powod === 'zla-data' && zlaDataT.kod === 400 && zlaDataT.obj.error === zlaData.blad, 'zła data: powód „zla-data”, trasa – 400 jak dotąd');
  osoba = { ...osoba, wspolrzedne: {} };
  const brak = await plener.policzPlan({ tryb: 'zdjecie' });
  const brakT = await trasa({ tryb: 'zdjecie' });
  ok(!brak.ok && brak.powod === 'brak-lokalizacji' && brakT.kod === 400 && brakT.obj.brakLokalizacji === true && brakT.obj.error === brak.blad,
    'bez lokalizacji: powód „brak-lokalizacji”, ten sam komunikat co trasa (400 z brakLokalizacji)');

  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nCENNIK I BUDŻET OK');
  process.exit(fail.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

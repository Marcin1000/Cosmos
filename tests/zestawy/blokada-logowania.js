/* Logowanie na publicznej domenie: obcy nie może zamknąć drzwi właścicielowi.

   Zespół IT, runda 5, na atrapie tunelu Cloudflare: dziesięć złych haseł pod
   PUSTYM loginem (pusty = właściciel) z dziesięciu adresów i Marcin, z dobrym
   hasłem, z nowego adresu, dostawał „Spróbuj ponownie za 15 min". Co kwadrans
   od nowa – bez końca. Dokumentacja obiecywała, że „z innego adresu da się
   wejść od razu".

     1. Urządzenie, które kiedyś zalogowało się poprawnie, wchodzi mimo blokady
        pod loginem. Obce urządzenie dalej ją dostaje (to ona chroni hasło
        przed zgadywaniem z wielu adresów).
     2. Zmiana hasła ma limit prób starego hasła.
     3. Dwa zaproszenia przyjęte naraz z tym samym loginem dają JEDNO konto,
        a przegrane zaproszenie wraca do użycia.
     4. Link do nowego hasła: członek ustawia hasło, stare sesje giną, link
        działa raz; dla właściciela linku nie ma.
     5. Błędy logowania i zaproszenia mają stały `kod` (przeglądarka tłumaczy
        go na język osoby) i `Cache-Control: no-store`.
     6. Za pośrednikiem innym niż Cloudflare (COSMOS_POSREDNIK=inny) podrobiony
        CF-Connecting-IP nie omija limitu po adresie.
*/
const { serwerCosmosa, czekajNa, zabij } = require('../pomoc');

const PORT = 3501;
const PORT2 = 3502;
const HASLO = 'haslo-wlasciciela-2026';
const fail = [];
const ok = (warunek, opis) => { console.log(`${warunek ? 'ok ' : 'ŹLE'} ${opis}`); if (!warunek) fail.push(opis); };

function klient(port, ip) {
  const ciastka = {};
  return {
    ciastka,
    async zadaj(sciezka, { metoda = 'GET', dane, naglowki = {} } = {}) {
      const c = Object.entries(ciastka).map(([k, v]) => `${k}=${v}`).join('; ');
      const r = await fetch(`http://127.0.0.1:${port}${sciezka}`, {
        method: metoda,
        headers: { 'Content-Type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...(c ? { Cookie: c } : {}), ...naglowki },
        body: dane === undefined ? undefined : JSON.stringify(dane),
      });
      for (const sc of r.headers.getSetCookie()) {
        const [para] = sc.split(';');
        const i = para.indexOf('=');
        const [k, v] = [para.slice(0, i), para.slice(i + 1)];
        if (v) ciastka[k] = v; else delete ciastka[k];
      }
      let json = {};
      try { json = await r.json(); } catch { /* nie JSON */ }
      return { kod: r.status, json, cache: r.headers.get('cache-control') || '' };
    },
  };
}

(async () => {
  const srv = serwerCosmosa(PORT, { COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin' });
  const srv2 = serwerCosmosa(PORT2, { COSMOS_PASSWORD: HASLO, COSMOS_LOGIN: 'marcin', COSMOS_POSREDNIK: 'inny' });
  try {
    if (!(await czekajNa(`http://127.0.0.1:${PORT}/api/auth`)) || !(await czekajNa(`http://127.0.0.1:${PORT2}/api/auth`))) {
      throw new Error('serwer testowy nie wstał');
    }

    /* ---- 1. Znane urządzenie a blokada pod loginem ---- */
    const telefon = klient(PORT, '10.1.0.1');
    const pierwsze = await telefon.zadaj('/api/login', { metoda: 'POST', dane: { login: '', password: HASLO } });
    ok(pierwsze.kod === 200 && Boolean(telefon.ciastka.cosmos_znane), 'udane logowanie zapamiętuje urządzenie (ciastko cosmos_znane)');
    ok(/no-store/.test(pierwsze.cache), `odpowiedź logowania nie trafia do pamięci pośredników (${pierwsze.cache})`);
    for (let i = 0; i < 10; i++) {
      await klient(PORT, `10.2.0.${i + 1}`).zadaj('/api/login', { metoda: 'POST', dane: { login: '', password: `zle-${i}` } });
    }
    const obcy = await klient(PORT, '10.3.0.1').zadaj('/api/login', { metoda: 'POST', dane: { login: '', password: HASLO } });
    ok(obcy.kod === 429 && obcy.json.kod === 'za-duzo-prob', `nieznane urządzenie po 10 pomyłkach pod loginem: 429 z kodem (${obcy.kod}, ${obcy.json.kod})`);
    const podrobione = klient(PORT, '10.4.0.2');
    podrobione.ciastka.cosmos_znane = 'podrobione-ciastko-1234567890';
    const pod = await podrobione.zadaj('/api/login', { metoda: 'POST', dane: { login: '', password: HASLO } });
    ok(pod.kod === 429, `zmyślone ciastko nie omija blokady (${pod.kod})`);
    // Telefon zmienia sieć (LTE zamiast Wi-Fi) – nowy adres, to samo urządzenie.
    const telefonLte = klient(PORT, '10.4.0.1');
    telefonLte.ciastka.cosmos_znane = telefon.ciastka.cosmos_znane;
    const swoj = await telefonLte.zadaj('/api/login', { metoda: 'POST', dane: { login: '', password: HASLO } });
    ok(swoj.kod === 200, `właściciel ze znanego urządzenia wchodzi mimo blokady pod loginem (${swoj.kod} ${swoj.json.error || ''})`);
    const zle = await klient(PORT, '10.5.0.1').zadaj('/api/login', { metoda: 'POST', dane: { login: 'marcin', password: 'zle' } });
    ok(zle.json.kod === 'za-duzo-prob' || zle.json.kod === 'zle-haslo', `błąd logowania ma stały kod (${zle.json.kod})`);

    /* ---- 2. Limit prób przy zmianie hasła ---- */
    const kody = [];
    for (let i = 0; i < 7; i++) {
      kody.push((await telefonLte.zadaj('/api/konto/haslo', { metoda: 'POST', dane: { stare: `zgaduje-${i}`, nowe: 'nowe-haslo-12345' } })).kod);
    }
    ok(kody.includes(429), `zgadywanie obecnego hasła przy zmianie kończy się blokadą (${kody.join(',')})`);

    /* ---- 3. Dwa zaproszenia naraz, ten sam login ---- */
    const z1 = (await telefonLte.zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: 'Ola' } })).json.token;
    const z2 = (await telefonLte.zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: 'Ola 2' } })).json.token;
    const [a, b] = await Promise.all([
      klient(PORT, '10.6.0.1').zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token: z1, login: 'ola', haslo: 'haslo-oli-12345' } }),
      klient(PORT, '10.6.0.2').zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token: z2, login: 'ola', haslo: 'haslo-oli-67890' } }),
    ]);
    const lista = (await telefonLte.zadaj('/api/konta')).json;
    const ole = (lista.uzytkownicy || []).filter((u) => u.login === 'ola');
    ok(ole.length === 1, `dwa równoległe zaproszenia z loginem „ola" → kont „ola": ${ole.length} (${a.kod}, ${b.kod})`);
    const przegrany = a.kod === 200 ? { r: b, token: z2 } : { r: a, token: z1 };
    ok(przegrany.r.json.kod === 'login-zajety', `przegrany dostaje kod login-zajety (${przegrany.r.json.kod})`);
    const ponownie = await klient(PORT, '10.6.0.3').zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token: przegrany.token, login: 'ola2', haslo: 'haslo-oli-67890' } });
    ok(ponownie.kod === 200, `przegrane zaproszenie działa z innym loginem (${ponownie.kod} ${ponownie.json.error || ''})`);

    /* ---- 4. Link do nowego hasła ---- */
    const ola = ole[0];
    const olaTelefon = klient(PORT, '10.7.0.1');
    await olaTelefon.zadaj('/api/login', { metoda: 'POST', dane: { login: 'ola', password: a.kod === 200 ? 'haslo-oli-12345' : 'haslo-oli-67890' } });
    ok((await olaTelefon.zadaj('/api/auth')).json.authed === true, 'Ola zalogowana przed resetem');
    const link = await telefonLte.zadaj('/api/konta/nowe-haslo', { metoda: 'POST', dane: { id: ola.id } });
    ok(link.kod === 200 && /#zaproszenie=/.test(link.json.sciezka || ''), `właściciel wystawia link do nowego hasła (${link.kod})`);
    const podglad = await klient(PORT, '10.7.0.2').zadaj('/api/zaproszenie', { naglowki: { 'X-Cosmos-Zaproszenie': link.json.token } });
    ok(podglad.json.reset === true && podglad.json.login === 'ola', `link rozpoznany jako nowe hasło dla „ola" (${JSON.stringify(podglad.json)})`);
    const krotkie = await klient(PORT, '10.7.0.2').zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token: link.json.token, haslo: '123' } });
    ok(krotkie.kod === 400 && krotkie.json.kod === 'haslo-krotkie', `za krótkie hasło: kod haslo-krotkie (${krotkie.json.kod})`);
    const nowe = await klient(PORT, '10.7.0.2').zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token: link.json.token, haslo: 'nowe-haslo-oli-1' } });
    ok(nowe.kod === 200 && nowe.json.uzytkownik && nowe.json.uzytkownik.id === ola.id, `nowe hasło ustawione na TYM SAMYM koncie (${nowe.kod})`);
    ok((await olaTelefon.zadaj('/api/auth')).json.authed !== true, 'stara sesja Oli wygasła po nowym haśle');
    const zNowym = await klient(PORT, '10.7.0.3').zadaj('/api/login', { metoda: 'POST', dane: { login: 'ola', password: 'nowe-haslo-oli-1' } });
    ok(zNowym.kod === 200, `logowanie nowym hasłem (${zNowym.kod})`);
    const drugiRaz = await klient(PORT, '10.7.0.4').zadaj('/api/zaproszenie', { metoda: 'POST', dane: { token: link.json.token, haslo: 'inne-haslo-oli-2' } });
    ok(drugiRaz.kod === 410 && drugiRaz.json.kod === 'zaproszenie-wygaslo', `link działa raz (${drugiRaz.kod}, ${drugiRaz.json.kod})`);
    const dlaWlasciciela = await telefonLte.zadaj('/api/konta/nowe-haslo', { metoda: 'POST', dane: { id: 'wlasciciel' } });
    ok(dlaWlasciciela.kod === 404, `link do hasła właściciela nie powstaje (${dlaWlasciciela.kod})`);

    /* ---- 5. Wylogowanie bez pamięci pośredników ---- */
    const wyl = await zNowymKlient();
    ok(/no-store/.test(wyl.cache), `wylogowanie z no-store (${wyl.cache})`);

    /* ---- 6. Pośrednik inny niż Cloudflare ---- */
    const kodyPodrobione = [];
    for (let i = 0; i < 7; i++) {
      const r = await klient(PORT2, `10.9.0.${i + 1}`).zadaj('/api/login', { metoda: 'POST', dane: { login: 'marcin', password: 'zle' },
        naglowki: { 'X-Forwarded-For': `1.2.3.${i}, 192.0.2.10` } });
      kodyPodrobione.push(r.kod);
    }
    ok(kodyPodrobione.includes(429), `COSMOS_POSREDNIK=inny: zmienny CF-Connecting-IP nie omija limitu po adresie (${kodyPodrobione.join(',')})`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    zabij(srv); zabij(srv2);
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nBLOKADA LOGOWANIA OK');
  process.exit(fail.length ? 1 : 0);
})();

async function zNowymKlient() {
  const k = klient(PORT, '10.8.0.1');
  await k.zadaj('/api/login', { metoda: 'POST', dane: { login: 'ola', password: 'nowe-haslo-oli-1' } });
  return k.zadaj('/api/logout', { metoda: 'POST' });
}

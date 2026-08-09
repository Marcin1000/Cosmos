/* Canon R6 II po Wi-Fi (CCAPI) — aparat jako urządzenie, nie temat rozmowy.

   Od firmware'u 1.7.0 aparat wystawia REST po HTTP. Dla Cosmosa to idealne
   dopasowanie: zero zależności, samo `fetch`. I jest to NAPRAWA, nie nowa
   zabawka — `senses/tether.py` steruje aparatem przez gPhoto2 po kablu, a to
   na Windowsie wymaga WSL, więc w praktyce nigdy nie ruszyło.

   Zestaw pilnuje czterech rzeczy, z których każda jest osobnym sposobem na
   zepsucie tego cicho:

     1. ŚCIEŻKI NIE SĄ ZASZYTE. CCAPI ma kilka wersji i każdy model wystawia
        inny podzbiór; pytamy aparat, co obsługuje, i bierzemy NAJNOWSZĄ wersję.
     2. WARTOŚĆ SPOZA LISTY nie leci do aparatu — komunikat ma mówić, co wolno.
     3. AWARIA MÓWI, CO ZROBIĆ. „fetch failed" nie podpowiada niczego;
        uśpione Wi-Fi aparatu i serwer w innej sieci to dwie różne rzeczy.
     4. AUTOFOKUS PRZY ZDALNYM STRZALE JEST DOMYŚLNIE WYŁĄCZONY. Aparat na
        statywie z ręczną ostrością (astro, makro, stacking) przeostrzyłby się
        przy każdym zdjęciu i cała seria byłaby do wyrzucenia.
*/
const { uruchom, zabij, czekajNa, zwolnijPorty } = require('../pomoc');
const path = require('node:path');

const PORT = 7120;
const ADRES = `http://127.0.0.1:${PORT}`;

(async () => {
  const fail = [];
  await zwolnijPorty([PORT]);
  const atrapa = uruchom('node', [path.join(__dirname, '..', 'atrapy', 'mock-canon.js')],
    { env: { ...process.env, PORT: String(PORT) } });
  if (!await czekajNa(`${ADRES}/ccapi`)) {
    zabij(atrapa);
    console.log('DO POPRAWY:\n- atrapa aparatu nie wstała');
    process.exit(1);
  }

  /* Moduł czyta adres ze zmiennej przy wczytaniu, więc ustawiamy ją WCZEŚNIEJ.
     Ten sam powód, dla którego `lib/rdzen.js` czyta konfigurację na starcie. */
  process.env.CANON_CCAPI_URL = ADRES;
  const canon = require('../../lib/canon.js');
  /* Spis ścieżek jest buforowany na minutę — po zmianie zachowania atrapy
     trzeba go unieważnić, inaczej test sprawdzałby stan sprzed sekundy.
     W prawdziwym użyciu robi to samo przekręcenie pokrętła w aparacie. */
  const awaria = (co) => fetch(`${ADRES}/awaria?co=${co}`).then((r) => r.json());
  const licznik = () => fetch(`${ADRES}/licznik`).then((r) => r.json());

  /* ---- 1. Kto tam jest ---- */
  const st = await canon.stan();
  console.log(`1. stan aparatu: ${st.online ? `${st.model}, firmware ${st.firmware}` : st.powod}`);
  if (!st.online) fail.push(`aparat nieosiągalny: ${st.powod}`);
  if (st.model !== 'Canon EOS R6m2') fail.push(`rozpoznany jako „${st.model}"`);

  /* ---- 2. Nastawy z listą dopuszczalnych wartości ---- */
  const w = await canon.nastawy();
  console.log(`2. nastawy: ISO ${w.nastawy.iso}, ${w.nastawy.przyslona}, ${w.nastawy.czas} `
    + `· ISO do wyboru: ${(w.nastawy.isoMozliwe || []).length}`);
  if (w.nastawy.przyslona !== 'f4.0' || w.nastawy.czas !== '1/60') fail.push('nastawy odczytane źle');
  if (!(w.nastawy.isoMozliwe || []).includes('800')) {
    fail.push('brak listy dopuszczalnych wartości — nie da się sensownie zaproponować zmiany');
  }

  /* Zapis aparatu → liczby Cosmosa. Bez tego „1/250" z aparatu i 0,004 s
     z planu to dwa nieporównywalne światy. */
  const l = canon.naLiczby({ iso: '800', przyslona: 'f5.6', czas: '1/250' });
  console.log(`3. „f5.6" i „1/250" → ${l.przyslona} i ${l.czasS.toFixed(5)} s`);
  if (l.przyslona !== 5.6 || Math.abs(l.czasS - 1 / 250) > 1e-9 || l.iso !== 800) {
    fail.push(`przeliczenie zapisu aparatu na liczby: ${JSON.stringify(l)}`);
  }
  const dlugi = canon.naLiczby({ czas: '4"' });
  console.log(`4. długi czas „4\\"" → ${dlugi.czasS} s`);
  if (dlugi.czasS !== 4) fail.push(`czas 4 s odczytany jako ${dlugi.czasS} — astro byłoby nie do ustawienia`);

  /* ---- 3. Zmiana nastawy i odrzucenie bzdury ---- */
  const zmiana = await canon.ustaw('iso', '800');
  console.log(`5. ISO ${zmiana.poprzednia} → ${zmiana.wartosc}`);
  if ((await canon.nastawy()).nastawy.iso !== '800') fail.push('zmiana ISO nie dotarła do aparatu');

  let odmowa = null;
  try { await canon.ustaw('iso', '12800'); } catch (e) { odmowa = e.message; }
  console.log(`6. ISO 12800 (poza możliwościami) → „${String(odmowa).slice(0, 70)}"`);
  if (!odmowa) fail.push('wartość spoza listy przeszła do aparatu');
  if (odmowa && !/6400/.test(odmowa)) {
    fail.push('komunikat nie mówi, jakie wartości aparat przyjmie');
  }

  /* ---- 4. Migawka: autofokus domyślnie WYŁĄCZONY ---- */
  const przed = (await licznik()).wyzwolen;
  const strzal = await canon.migawka();
  const po = (await licznik()).wyzwolen;
  console.log(`7. migawka → wyzwoleń ${przed} → ${po}, autofokus: ${strzal.af}`);
  if (po !== przed + 1) fail.push('migawka nie wyzwoliła zdjęcia');
  if (strzal.af !== false) {
    fail.push('autofokus włączony domyślnie — seria z ręczną ostrością byłaby do wyrzucenia');
  }

  /* ---- 5. Nastawa, której aparat teraz nie wystawia ----
     W trybie automatycznym część nastaw znika ze spisu. To normalny stan,
     a nie awaria — ale musi być powiedziany, a nie przemilczany. */
  await awaria('brak-iso');
  canon.zapomnij();
  const bezIso = await canon.nastawy();
  console.log(`8. tryb bez regulacji ISO → ISO: ${bezIso.nastawy.iso === undefined ? 'brak' : bezIso.nastawy.iso}`
    + ` · powód: ${(bezIso.bledy && bezIso.bledy.iso) || 'PRZEMILCZANY'}`);
  if (bezIso.nastawy.iso !== undefined) fail.push('ISO oddane mimo braku w spisie aparatu');
  if (!bezIso.bledy || !bezIso.bledy.iso) fail.push('brak nastawy przemilczany');
  if (bezIso.nastawy.przyslona !== 'f4.0') {
    fail.push('brak jednej nastawy zabrał pozostałe — a te były dostępne');
  }

  /* ---- 6. Aparat zajęty i aparat uśpiony ---- */
  await awaria('busy');
  canon.zapomnij();
  let zajety = null;
  try { await canon.ustaw('przyslona', 'f8.0'); } catch (e) { zajety = e.message; }
  console.log(`9. aparat zajęty → „${zajety}"`);
  if (!zajety || !/busy/i.test(zajety)) fail.push(`komunikat aparatu zgubiony: ${zajety}`);

  await awaria('off');
  canon.zapomnij();
  const uspiony = await canon.stan();
  console.log(`10. aparat nie odpowiada → „${String(uspiony.powod).slice(0, 90)}…"`);
  if (uspiony.online) fail.push('martwy aparat zgłoszony jako dostępny');
  if (!/Wi-Fi/i.test(uspiony.powod) || !/sieci/i.test(uspiony.powod)) {
    fail.push('komunikat nie podpowiada dwóch najczęstszych przyczyn (uśpione Wi-Fi, inna sieć)');
  }

  zabij(atrapa);
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nAPARAT CANON OK');
  process.exit(fail.length ? 1 : 0);
})();

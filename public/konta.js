/* ============================================================
   Konta w przeglądarce: zaproszenie, Twoje konto, Dostęp

   Trzy ekrany, jedna zasada: wszystko, co przyszło od INNEJ osoby — imię,
   login — trafia na ekran przez `textContent`, nigdy przez `innerHTML`.
   Panel Dostęp pokazuje właścicielowi imiona wpisane przez zaproszonych.
   Gość, który jako imię podałby `<img src=x onerror=…>`, przy `innerHTML`
   wykonałby kod w sesji WŁAŚCICIELA — z jego uprawnieniami.

   Wzorzec dwustronny: ten sam plik działa w przeglądarce i w `require()`
   z testu (patrz CLAUDE.md, „Front-end — bez budowania").
   ============================================================ */

function utworzKonta({ $, t }) {
  let ja = null;
  let kontaSerwera = null;

  async function zadaj(sciezka, { metoda = 'GET', dane, naglowki = {} } = {}) {
    const r = await fetch(sciezka, {
      method: metoda,
      headers: { 'Content-Type': 'application/json', ...naglowki },
      body: dane === undefined ? undefined : JSON.stringify(dane),
    });
    let json = {};
    try { json = await r.json(); } catch { /* pusta odpowiedź */ }
    return { ok: r.ok, kod: r.status, json };
  }

  /* Rola decyduje o tym, co widać. Ukrywanie w interfejsie to wygoda, nie
     zabezpieczenie — serwer i tak odmawia (TYLKO_WLASCICIEL w server.js).
     Ale przycisk, który zawsze kończy się „tylko dla właściciela", to zły
     interfejs. */
  function zastosujRole(u) {
    ja = u || null;
    const czlonek = Boolean(ja && ja.rola !== 'wlasciciel');
    if (typeof document !== 'undefined') document.body.classList.toggle('rola-czlonek', czlonek);
  }

  /* Kopie rozmów do pracy bez sieci należą do KONKRETNEJ osoby. Na wspólnym
     telefonie — Marcin się wylogowuje, loguje się ktoś z rodziny — stara kopia
     pokazałaby się nowej osobie przy pierwszym zaniku sieci. Dlatego
     przeglądarka pamięta, czyja jest kopia, i czyści ją przy zmianie osoby
     i przy wylogowaniu. Ustawienia urządzenia (język, mikrofon) zostają. */
  const PAMIEC_OSOBY = [/^cosmos\.conv\./, /^cosmos\.convIndex$/, /^cosmos\.kbSelected$/, /^cosmos\.promptTemplates$/];
  function wyczyscPamiecOsoby(magazyn = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!magazyn) return 0;
    const klucze = [];
    for (let i = 0; i < magazyn.length; i++) klucze.push(magazyn.key(i));
    const doUsuniecia = klucze.filter((k) => k && PAMIEC_OSOBY.some((w) => w.test(k)));
    for (const k of doUsuniecia) magazyn.removeItem(k);
    return doUsuniecia.length;
  }
  function pilnujWlascicielaPamieci(u, magazyn = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!magazyn || !u) return false;
    let poprzedni = null;
    try { poprzedni = magazyn.getItem('cosmos.kto'); } catch { return false; }
    const zmiana = Boolean(poprzedni && poprzedni !== u.id);
    if (zmiana) wyczyscPamiecOsoby(magazyn);
    try { magazyn.setItem('cosmos.kto', u.id); } catch { /* prywatne okno */ }
    return zmiana;
  }

  /* Pierwsza LITERA albo cyfra, nie pierwszy znak: imię „<b>Tomek" dawało
     w kółku „<". Litery spoza łaciny też się liczą (\p{L}). */
  const inicjal = (u) => {
    const m = String((u && (u.nazwa || u.login)) || '').match(/[\p{L}\p{N}]/u);
    return m ? m[0].toUpperCase() : '?';
  };

  // ------------------------------------------------------------------
  // Zaproszenie: /#zaproszenie=TOKEN
  // ------------------------------------------------------------------

  function tokenZaproszenia(hash = (typeof location !== 'undefined' ? location.hash : '')) {
    const m = String(hash || '').match(/^#zaproszenie=([A-Za-z0-9_-]{16,})$/);
    return m ? m[1] : '';
  }

  async function pokazZaproszenie(token) {
    const nakladka = $('invite-overlay');
    const blad = $('invite-error');
    nakladka.style.display = '';
    // Token w nagłówku, nie w adresie — adresy lądują w logach po drodze.
    const r = await zadaj('/api/zaproszenie', { naglowki: { 'X-Cosmos-Zaproszenie': token } });
    if (!r.ok) {
      $('invite-sub').textContent = r.json.error || t('inv.expired');
      for (const id of ['invite-name', 'invite-login', 'invite-pass', 'invite-pass2', 'invite-submit']) $(id).hidden = true;
      return;
    }
    $('invite-sub').textContent = r.json.zapraszajacy
      ? t('inv.subFrom', { kto: r.json.zapraszajacy })
      : t('inv.sub');
    $('invite-name').value = r.json.nazwa || '';
    $('invite-login').value = r.json.proponowanyLogin || '';
    $('invite-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      blad.textContent = '';
      if ($('invite-pass').value !== $('invite-pass2').value) {
        blad.textContent = t('inv.mismatch');
        return;
      }
      $('invite-submit').disabled = true;
      const w = await zadaj('/api/zaproszenie', { metoda: 'POST', dane: {
        token, nazwa: $('invite-name').value, login: $('invite-login').value, haslo: $('invite-pass').value,
      } });
      if (!w.ok) {
        blad.textContent = w.json.error || t('login.failed');
        $('invite-submit').disabled = false;
        return;
      }
      /* Czyścimy fragment ZANIM przeładujemy: token w historii przeglądarki
         jest już zużyty, ale nie ma powodu, żeby wisiał w pasku adresu. */
      history.replaceState(null, '', location.pathname);
      location.reload();
    });
  }

  // ------------------------------------------------------------------
  // Twoje konto
  // ------------------------------------------------------------------

  function komunikat(tekst, blad = false) {
    const k = $('konto-komunikat');
    if (!k) return;
    k.textContent = tekst || '';
    k.classList.toggle('blad', Boolean(blad));
  }

  async function odswiezKonto() {
    const r = await zadaj('/api/konto');
    if (!r.ok) return;
    const u = r.json.uzytkownik;
    zastosujRole(u);
    $('konto-blok').hidden = false;
    $('konto-avatar').textContent = inicjal(u);
    $('konto-nazwa-widok').textContent = u.nazwa || u.login;
    $('konto-login').textContent = u.login;
    $('konto-rola').textContent = u.rola === 'wlasciciel' ? t('acc.roleOwner') : t('acc.roleMember');
    $('konto-nazwa').value = u.nazwa || '';
    /* Tryb domowy: nie ma logowania, więc nie ma czego wylogować ani zmieniać.
       Zmiana hasła zostaje — to właśnie nią właściciel włącza logowanie. */
    $('konto-wyloguj').hidden = !r.json.logowanie;
    $('konto-wyloguj-wszedzie').hidden = !r.json.logowanie;
    $('konto-haslo-stare').hidden = !u.maHaslo;
    const maLokalny = (r.json.silniki || []).some((s) => s.nazwa === 'local');
    document.body.classList.toggle('bez-lokalnego', !maLokalny);
    const k = r.json.klucze || {};
    $('konto-klucz-openai').placeholder = k.openai ? t('acc.keySet', { koncowka: k.openai }) : t('acc.keyOpenai');
    $('konto-klucz-claude').placeholder = k.claude ? t('acc.keySet', { koncowka: k.claude }) : t('acc.keyClaude');
  }

  async function zapiszKlucz(nazwa) {
    const pole = $(`konto-klucz-${nazwa}`);
    const r = await zadaj('/api/konto/klucze', { metoda: 'PUT', dane: { nazwa, klucz: pole.value } });
    if (!r.ok) return komunikat(r.json.error, true);
    pole.value = '';
    komunikat(r.json.klucze[nazwa] ? t('acc.keySaved') : t('acc.keyRemoved'));
    await odswiezKonto();
    // Zakładki silników zależą od kluczy — przeładuj konfigurację.
    if (typeof window !== 'undefined' && typeof window.loadServerConfig === 'function') window.loadServerConfig();
  }

  // ------------------------------------------------------------------
  // Dostęp (właściciel)
  // ------------------------------------------------------------------

  function kiedy(ms) {
    if (!ms) return t('acc.never');
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 2) return t('acc.now');
    if (min < 60) return t('acc.minAgo', { n: min });
    const godz = Math.round(min / 60);
    if (godz < 36) return t('acc.hAgo', { n: godz });
    return data(ms);
  }

  /* Data w języku INTERFEJSU, nie systemu. `toLocaleDateString()` bez
     argumentu bierze ustawienia systemu, więc na komputerze po angielsku
     polski interfejs pokazywał „10/1/2026". */
  const data = (ms) => new Date(ms).toLocaleDateString(
    (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang === 'en') ? 'en-GB' : 'pl-PL');

  function element(tag, klasa, tekst) {
    const e = document.createElement(tag);
    if (klasa) e.className = klasa;
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  }

  const SILNIKI = [
    ['local', 'acc.engLocal'], ['openai', 'acc.engOpenai'], ['claude', 'acc.engClaude'], ['studio', 'acc.engStudio'],
  ];

  function wierszOsoby(u) {
    const w = element('div', 'osoba');
    const glowa = element('div', 'osoba-glowa');
    glowa.append(element('span', 'konto-avatar maly', inicjal(u)));
    const opis = element('div', 'osoba-opis');
    opis.append(element('div', 'osoba-nazwa', u.nazwa || u.login));
    const z = u.zuzycie || {};
    opis.append(element('div', 'osoba-meta mono',
      `${u.login} · ${u.rola === 'wlasciciel' ? t('acc.roleOwner') : t('acc.roleMember')} · `
      + `${t('acc.lastSeen')}: ${kiedy(u.ostatnio)} · ${t('acc.messages', { n: z.wiadomosci || 0, dzis: z.dzien === new Date().toISOString().slice(0, 10) ? (z.dzisiaj || 0) : 0 })}`));
    glowa.append(opis);
    w.append(glowa);
    if (u.rola === 'wlasciciel') return w;

    const przelaczniki = element('div', 'osoba-silniki');
    const serwer = (kontaSerwera && kontaSerwera.silnikiSerwera) || {};
    for (const [nazwa, klucz] of SILNIKI) {
      const et = element('label', 'osoba-silnik');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(u.silniki && u.silniki[nazwa]);
      // Silnik, którego serwer nie ma, nie da się przyznać — nie udawajmy, że się da.
      box.disabled = !serwer[nazwa];
      if (!serwer[nazwa]) et.title = t('acc.engMissing');
      box.addEventListener('change', async () => {
        const r = await zadaj('/api/konta/uzytkownik', { metoda: 'PUT', dane: { id: u.id, silniki: { [nazwa]: box.checked } } });
        if (!r.ok) { box.checked = !box.checked; komunikat(r.json.error, true); }
      });
      et.append(box, element('span', '', t(klucz)));
      przelaczniki.append(et);
    }
    w.append(przelaczniki);

    const akcje = element('div', 'field-row osoba-akcje');
    const wyloguj = element('button', 'btn-ghost', t('acc.logoutUser'));
    wyloguj.type = 'button';
    wyloguj.addEventListener('click', async () => {
      const r = await zadaj('/api/konta/wyloguj', { metoda: 'POST', dane: { id: u.id } });
      komunikat(r.ok ? t('acc.loggedOutN', { n: r.json.wylogowano }) : r.json.error, !r.ok);
      odswiezDostep();
    });
    const usun = element('button', 'btn-ghost niebezpieczny', t('acc.remove'));
    usun.type = 'button';
    usun.addEventListener('click', async () => {
      if (!confirm(t('acc.removeConfirm', { kto: u.nazwa || u.login }))) return;
      const r = await zadaj(`/api/konta/uzytkownik?id=${encodeURIComponent(u.id)}`, { metoda: 'DELETE' });
      komunikat(r.ok ? t('acc.removed') : r.json.error, !r.ok);
      odswiezDostep();
    });
    akcje.append(wyloguj, usun);
    w.append(akcje);
    return w;
  }

  function wierszZaproszenia(z) {
    const w = element('div', 'osoba zaproszenie');
    const opis = element('div', 'osoba-opis');
    opis.append(element('div', 'osoba-nazwa', `✉ ${z.nazwa || t('acc.noName')}`));
    opis.append(element('div', 'osoba-meta mono', t('acc.expires', { data: data(z.wygasa) })));
    const cofnij = element('button', 'btn-ghost', t('acc.revoke'));
    cofnij.type = 'button';
    cofnij.addEventListener('click', async () => {
      await zadaj(`/api/konta/zaproszenia?id=${encodeURIComponent(z.id)}`, { metoda: 'DELETE' });
      odswiezDostep();
    });
    w.append(opis, cofnij);
    return w;
  }

  async function odswiezDostep() {
    const blok = $('dostep-blok');
    if (!ja || ja.rola !== 'wlasciciel') { blok.hidden = true; return; }
    const r = await zadaj('/api/konta');
    if (!r.ok) { blok.hidden = true; return; }
    kontaSerwera = r.json;
    blok.hidden = false;
    $('dostep-bez-hasla').hidden = r.json.logowanie;
    $('dostep-zapros').disabled = !r.json.logowanie;
    const lista = $('dostep-lista');
    lista.replaceChildren(...r.json.uzytkownicy.map(wierszOsoby));
    const zap = $('dostep-zaproszenia');
    zap.replaceChildren(...r.json.zaproszenia.map(wierszZaproszenia));
  }

  async function zapros() {
    const r = await zadaj('/api/konta/zaproszenia', { metoda: 'POST', dane: { nazwa: $('dostep-nazwa').value } });
    if (!r.ok) return komunikat(r.json.error, true);
    const link = `${location.origin}${r.json.sciezka}`;
    $('dostep-link-pole').value = link;
    $('dostep-link').hidden = false;
    // „Wyślij…" otwiera arkusz udostępniania telefonu (WhatsApp, SMS). Na
    // komputerze go zwykle nie ma — wtedy przycisk znika, zostaje „Kopiuj".
    $('dostep-udostepnij').hidden = !(typeof navigator !== 'undefined' && navigator.share);
    $('dostep-nazwa').value = '';
    odswiezDostep();
  }

  // ------------------------------------------------------------------

  let podpiete = false;
  function podepnij() {
    if (podpiete) return;
    podpiete = true;
    $('konto-wyloguj').addEventListener('click', async () => {
      await zadaj('/api/logout', { metoda: 'POST' });
      try { wyczyscPamiecOsoby(); localStorage.removeItem('cosmos.kto'); } catch { /* */ }
      location.reload();
    });
    $('konto-wyloguj-wszedzie').addEventListener('click', async () => {
      const r = await zadaj('/api/konto/wyloguj-wszedzie', { metoda: 'POST' });
      komunikat(r.ok ? t('acc.loggedOutN', { n: r.json.wylogowano }) : r.json.error, !r.ok);
    });
    $('konto-nazwa-zapisz').addEventListener('click', async () => {
      const r = await zadaj('/api/konto', { metoda: 'PUT', dane: { nazwa: $('konto-nazwa').value } });
      komunikat(r.ok ? t('acc.saved') : r.json.error, !r.ok);
      odswiezKonto();
    });
    $('konto-haslo-zapisz').addEventListener('click', async () => {
      const r = await zadaj('/api/konto/haslo', { metoda: 'POST',
        dane: { stare: $('konto-haslo-stare').value, nowe: $('konto-haslo-nowe').value } });
      if (!r.ok) return komunikat(r.json.error, true);
      $('konto-haslo-stare').value = '';
      $('konto-haslo-nowe').value = '';
      komunikat(t('acc.passChanged', { n: r.json.wylogowano || 0 }));
      odswiezKonto();
      odswiezDostep();
    });
    $('konto-klucz-openai-zapisz').addEventListener('click', () => zapiszKlucz('openai'));
    $('konto-klucz-claude-zapisz').addEventListener('click', () => zapiszKlucz('claude'));
    $('dostep-zapros').addEventListener('click', zapros);
    $('dostep-nazwa').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); zapros(); } });
    $('dostep-kopiuj').addEventListener('click', async () => {
      const pole = $('dostep-link-pole');
      try { await navigator.clipboard.writeText(pole.value); komunikat(t('acc.copied')); }
      catch { pole.select(); document.execCommand('copy'); komunikat(t('acc.copied')); }
    });
    $('dostep-udostepnij').addEventListener('click', async () => {
      try {
        await navigator.share({ title: 'Cosmos', text: t('acc.shareText'), url: $('dostep-link-pole').value });
      } catch { /* anulowane — nic się nie stało */ }
    });
  }

  async function odswiez() {
    podepnij();
    await odswiezKonto();
    await odswiezDostep();
  }

  return { tokenZaproszenia, pokazZaproszenie, zastosujRole, odswiez, odswiezKonto, odswiezDostep,
    wyczyscPamiecOsoby, pilnujWlascicielaPamieci, ja: () => ja };
}

if (typeof window !== 'undefined') window.utworzKonta = utworzKonta;
if (typeof module !== 'undefined') module.exports = { utworzKonta };

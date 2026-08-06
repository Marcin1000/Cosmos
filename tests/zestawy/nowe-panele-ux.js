/* UI/UX nowych paneli z tej serii partii.

   Przez sześć partii doszło do interfejsu sześć nowych rzeczy: kafelki
   dokumentów, siatka znalezionych zdjęć, panel wyniku programu, płótno,
   plan zdjęciowy przy kamerze i panel archiwum w Ustawieniach. Każda z nich
   powstała osobno i osobno wyglądała dobrze — a razem mają się zmieścić
   na ekranie telefonu o szerokości 360 px.

   Sprawdzamy trzy rzeczy, na które nikt nie patrzy, dopóki nie zawiodą:
   brak przewijania w bok, czytelny kontrast napisów pomocniczych oraz to,
   czy element da się kliknąć palcem (a nie tylko myszą). */
const { srodowisko, przegladarka, maPrzegladarke, KATALOG_ZRZUTOW } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

// Najwęższy realnie spotykany telefon. Jeśli mieści się tu, mieści się wszędzie.
const WASKI = { width: 360, height: 740 };

(async () => {
  const env = await srodowisko('kontekst');
  const fail = [];
  const br = await przegladarka();
  const ctx = await br.newContext({ viewport: WASKI, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  const bledy = [];
  pg.on('pageerror', (e) => bledy.push(e.message));
  await pg.goto(env.adres, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(400);

  /** Czy strona przewija się w bok — najczęstsza wpadka na wąskim ekranie. */
  const wBok = async (gdzie) => {
    const r = await pg.evaluate(() => ({
      s: document.documentElement.scrollWidth, i: window.innerWidth,
    }));
    const zle = r.s > r.i + 1;
    console.log(`   ${gdzie}: ${zle ? `PRZEWIJANIE W BOK (${r.s} > ${r.i}) ⚠` : 'mieści się'}`);
    if (zle) fail.push(`${gdzie}: strona przewija się w bok na ${WASKI.width} px`);
  };

  /** Czy element wystaje poza swojego rodzica. */
  const wystaje = async (sel, gdzie) => pg.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el || el.hidden || !el.offsetParent) return null;
    const e = el.getBoundingClientRect();
    return { poza: e.right > window.innerWidth + 1 || e.left < -1, szer: Math.round(e.width) };
  }, sel).then((r) => {
    if (!r) return;
    console.log(`   ${gdzie}: ${r.szer} px${r.poza ? ' — WYSTAJE ⚠' : ''}`);
    if (r.poza) fail.push(`${gdzie} wystaje poza ekran`);
  });

  console.log('1. czat na 360 px');
  await wBok('czat');

  /* 2. Płótno. Na wąskim ekranie ma zajmować CAŁY ekran — panel na 46%
     szerokości przy 360 px dawał kolumnę, w której nie da się przeczytać
     zdania. Reguła jest w CSS pod media query, więc sprawdzamy ją realnie. */
  console.log('2. płótno');
  await pg.evaluate(() => {
    const c = activeConv() || { messages: [] };
    c.canvas = { title: 'Scenariusz filmu o Złotokłosie', text: 'UJĘCIE 1\nDron wznosi się nad lasem.' };
    pokazPlotno(c);
  });
  await pg.waitForTimeout(200);
  const plotno = await pg.evaluate(() => {
    const el = document.getElementById('canvas');
    const r = el.getBoundingClientRect();
    return { szer: Math.round(r.width), okno: window.innerWidth, widoczne: !el.hidden };
  });
  console.log(`   szerokość ${plotno.szer} px z ${plotno.okno} px okna`);
  if (plotno.szer < plotno.okno * 0.9) {
    fail.push(`płótno zajmuje tylko ${plotno.szer} px — na telefonie ma być pełnoekranowe`);
  }
  await wBok('płótno otwarte');
  await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/ux-plotno-360.png` });
  await pg.evaluate(() => pokazPlotno(null));

  /* 3. Kafelki dokumentów i siatka zdjęć w wiadomości. Nazwy plików bywają
     długie, a adresy źródeł jeszcze dłuższe — bez ucinania rozpychają czat. */
  console.log('3. załączniki i zdjęcia w wiadomości');
  await pg.evaluate(() => {
    const c = ensureConversation('test');
    c.messages.push({ role: 'user', content: { text: 'sprawdź to',
      docs: [{ name: 'Umowa-o-dzielo-bardzo-dluga-nazwa-pliku-2026-final-v3.pdf', chars: 8412, text: 'treść' }] } });
    c.messages.push({ role: 'assistant', content: { text: '', photos: Array.from({ length: 8 }, (_, i) => ({
      title: `Zdjęcie ${i}`, thumb: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      source: 'https://bardzo-dluga-nazwa-domeny-testowej.example.com/strona/podstrona' })) } });
    renderMessages();
  });
  await pg.waitForTimeout(300);
  await wBok('wiadomość z dokumentem i zdjęciami');
  await wystaje('.doc-chip', 'kafelek dokumentu');
  await wystaje('.photo-grid', 'siatka zdjęć');
  const kolumny = await pg.evaluate(() => {
    const g = document.querySelector('.photo-grid');
    return g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : 0;
  });
  console.log(`   siatka zdjęć: ${kolumny} kolumny`);
  if (kolumny < 2) fail.push('siatka zdjęć zwinęła się do jednej kolumny — miniatury są za duże');
  await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/ux-zalaczniki-360.png` });

  // 4. panel wyniku programu — długie linie muszą się zawijać, nie rozpychać
  console.log('4. wynik programu');
  await pg.evaluate(() => {
    const c = activeConv();
    c.messages.push({ role: 'assistant', content: { text: '', run: {
      ms: 54, stdout: 'SUMA_CALKOWITA_ZA_CZERWIEC_LIPIEC_I_SIERPIEN_DWA_TYSIACE_DWUDZIESTY_SZOSTY = 35800',
      stderr: '', wyniki: [] } } });
    renderMessages();
  });
  await pg.waitForTimeout(200);
  await wBok('wynik programu');
  await wystaje('.run-panel', 'panel wyniku');

  // 5. Ustawienia: pola planu i panel archiwum
  console.log('5. Ustawienia');
  /* Na telefonie przycisk Ustawień siedzi w schowanym panelu bocznym —
     najpierw trzeba go wysunąć. To nie usterka, tylko sposób działania
     interfejsu; test musi robić to samo co człowiek. */
  await pg.evaluate(() => {
    document.querySelector('.app').classList.remove('sidebar-hidden');
    document.querySelector('.sidebar').classList.remove('collapsed');
  });
  await pg.waitForTimeout(200);
  await pg.click('#settings-btn');
  await pg.waitForTimeout(600);
  await wBok('Ustawienia');
  await wystaje('#set-location', 'pole lokalizacji');
  await wystaje('#arch-box', 'panel archiwum');
  const archTekst = await pg.textContent('#arch-state');
  console.log(`   archiwum mówi: „${(archTekst || '').slice(0, 70)}…"`);
  if (!archTekst || archTekst === '…') fail.push('panel archiwum nie pokazał żadnego stanu');
  // Bez konfiguracji ma TŁUMACZYĆ, czego brakuje, a nie milczeć.
  if (!/ONEDRIVE_CLIENT_ID/.test(archTekst || '')) {
    fail.push('panel archiwum nie mówi, co ustawić w .env');
  }
  await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/ux-ustawienia-360.png` });
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(300);

  /* 6. Panel planu przy kamerze. Trzy listy rozwijane obok siebie na 360 px
     to test na `min-width: 0` — bez niego pola rozpychają panel. */
  console.log('6. plan zdjęciowy przy kamerze');
  await pg.evaluate(() => {
    document.getElementById('live-panel').style.display = '';
    document.getElementById('plan-box').hidden = false;
    pokazPlan({
      slonce: { wysokosc: 4.1, azymut: 303, faza: 'złota godzina', doZlotejMin: -5, doZachoduMin: 41 },
      kadr: { uklad: 'pionowo', proporcje: '9:16' },
      pogoda: { opis: 'częściowe zachmurzenie', temperatura: 18.4, opadyProc: 10 },
      ustawienia: { czas: '1/60', przyslona: 'f/11', iso: 100, powody: [
        'Czas 1/60 s wynika z reguły 180° przy 25 kl./s — to on daje naturalne rozmycie ruchu.',
      ] },
    });
  });
  await pg.waitForTimeout(300);
  await wBok('panel planu');
  await wystaje('#plan-box', 'panel planu');
  for (const sel of ['#plan-gear', '#plan-mode', '#plan-sky']) {
    await wystaje(sel, `pole ${sel}`);
  }
  const nastawy = await pg.textContent('#plan-shot');
  console.log(`   nastawy: „${nastawy}"`);
  if (!/1\/60/.test(nastawy || '')) fail.push('panel planu nie pokazał nastaw');
  const swiatlo = await pg.textContent('#plan-light');
  if (!/złota godzina TERAZ/.test(swiatlo || '')) {
    fail.push('trwająca złota godzina nie jest oznaczona — pokazałby ujemne minuty');
  }
  await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/ux-plan-360.png` });

  /* 7. Dotyk. Cele mniejsze niż ~32 px trudno trafić palcem; wytyczne mówią
     o 44 px, ale przyciski pomocnicze w gęstym panelu bywają mniejsze
     i to jest świadomy kompromis — pilnujemy dolnej granicy. */
  console.log('7. rozmiary celów dotykowych');
  const male = await pg.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#plan-box select, .doc-chip, .arch-box button')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && r.height < 28) {
        out.push(`${el.id || el.className}: ${Math.round(r.height)} px`);
      }
    }
    return out;
  });
  console.log(`   za małe do kliknięcia palcem: ${male.length ? male.join(', ') : 'brak'}`);
  if (male.length) fail.push(`cele dotykowe poniżej 28 px: ${male.join(', ')}`);

  // 8. czy nowe napisy pomocnicze mają jakikolwiek kontrast (nie są niewidoczne)
  console.log('8. kontrast napisów pomocniczych');
  const bezKontrastu = await pg.evaluate(() => {
    const jasnosc = (kolor) => {
      const m = kolor.match(/\d+/g);
      if (!m) return null;
      return (Number(m[0]) * 0.299 + Number(m[1]) * 0.587 + Number(m[2]) * 0.114) / 255;
    };
    const out = [];
    for (const sel of ['.plan-light', '.plan-why', '.arch-state', '.canvas-hint', '.run-bar']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const s = getComputedStyle(el);
      const tekst = jasnosc(s.color);
      let tlo = null;
      for (let p = el; p && !tlo; p = p.parentElement) {
        const b = getComputedStyle(p).backgroundColor;
        if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) tlo = jasnosc(b);
      }
      if (tekst === null || tlo === null) continue;
      if (Math.abs(tekst - tlo) < 0.18) out.push(`${sel} (różnica ${Math.abs(tekst - tlo).toFixed(2)})`);
    }
    return out;
  });
  console.log(`   zbyt niski kontrast: ${bezKontrastu.length ? bezKontrastu.join(', ') : 'brak'}`);
  if (bezKontrastu.length) fail.push(`napisy prawie niewidoczne: ${bezKontrastu.join(', ')}`);

  console.log(`9. błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  if (bledy.length) fail.push(`błędy JS: ${bledy.join(' | ')}`);

  await br.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nNOWE PANELE UX OK');
  process.exit(fail.length ? 1 : 0);
})();

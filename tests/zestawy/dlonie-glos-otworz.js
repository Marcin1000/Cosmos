/* Dłonie w podglądzie, kamera w trybie głosowym, „otwórz stronę”.

   Uwagi Marcina z jednej rozmowy (Windows, sam Kinect, bez kamery):
   – „Ile palców pokazuję?” → model nie wiedział, bo nikt nie liczył palców,
   – przy wyłączonym „Rozpoznawaniu” dalej wyskakiwało „w kadrze pojawiło się:
     chair” (to mówi obserwator na jego komputerze, nie podgląd),
   – w trybie głosowym nie dało się włączyć podglądu – przycisk znał tylko
     kamerę przeglądarki,
   – „Nie udało się rozpoznać mowy: HTTP 502” stało w dymku jego wypowiedzi,
   – asystent ma otwierać strony („otwórz onet.pl”).

   Środowisko `pelne`: atrapa modelu i atrapa zmysłów (Kinect, YOLO, dłonie):
     1. panel kamery rysuje dłonie, pisze pod obrazem palce i gest, a do
        kontekstu modelu idzie zdarzenie „dlonie” (po dwóch zgodnych odczytach),
     2. wyłączone rozpoznawanie: dłonie znikają, do zmysłów nie idzie żadna
        klatka, a dymki rozpoznawania (także z obserwatora) nie wyskakują,
     3. tryb głosowy bez kamery przeglądarki pokazuje Kinecta, a klatkę z niego
        da się dołączyć do pytania,
     4. pytanie głosowe „ile palców pokazuję?” najpierw liczy palce na klatce
        i wysyła zdarzenie, dopiero potem idzie do modelu,
     5. „otwórz stronę” otwiera kartę od razu; przy zablokowanym oknie zostaje
        przycisk „Otwórz”, który otwiera ją kliknięciem,
     6. komunikat błędu w trybie głosowym nie ma dymka wypowiedzi.
*/
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

const fail = [];
const ok = (w, opis) => { console.log(`${w ? 'ok ' : 'ŹLE'} ${opis}`); if (!w) fail.push(opis); };

if (!maPrzegladarke()) {
  console.log('POMINIĘTE: brak Chromium');
  process.exit(0);
}

(async () => {
  const env = await srodowisko('pelne');
  const b = await przegladarka();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const bledy = [];
    p.on('pageerror', (e) => bledy.push(e.message));
    const zapytania = [];   // [czas, adres, treść]
    p.on('request', (r) => {
      if (/\/api\/(dlonie|events|chat)$/.test(new URL(r.url()).pathname) && r.method() === 'POST') {
        zapytania.push([Date.now(), new URL(r.url()).pathname, r.postData() || '']);
      }
    });
    const ile = (sciezka, od = 0) => zapytania.filter(([t, a]) => a === sciezka && t >= od).length;
    const zdarzeniaDloni = () => zapytania.filter(([, a, d]) => a === '/api/events' && /"type":"dlonie"/.test(d));
    const pikseleDloni = () => p.evaluate(() => {
      const c = document.getElementById('live-dlonie');
      if (!c || !c.width) return 0;
      return c.getContext('2d').getImageData(0, 0, c.width, c.height).data.filter((v, i) => i % 4 === 3 && v).length;
    });

    await p.goto(`${env.adres}/app`, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.app.gotowa') && typeof startLive === 'function');
    await p.evaluate(() => localStorage.setItem('cosmos.liveSource', 'kinect-color'));
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelector('.app.gotowa') && typeof startLive === 'function');

    /* ---- 1. Dłonie w panelu ---- */
    await p.evaluate(() => startLive());
    await p.waitForFunction(() => /znak V/.test(document.getElementById('live-status').textContent), null, { timeout: 10000 }).catch(() => {});
    const status1 = await p.$eval('#live-status', (e) => e.textContent);
    const piksele1 = await pikseleDloni();
    ok(/2 palce/.test(status1) && /znak V/.test(status1) && /pięść/.test(status1), `1. pod obrazem palce i gesty („${status1.slice(0, 120)}”)`);
    ok(piksele1 > 50, `1. szkielet dłoni narysowany (${piksele1} px)`);
    await p.waitForFunction(() => true);
    for (let i = 0; i < 20 && !zdarzeniaDloni().length; i++) await p.waitForTimeout(250);
    const zd = zdarzeniaDloni();
    ok(zd.length === 1 && /razem 2 palce/.test(zd[0][2]), `1. do kontekstu modelu jedno zdarzenie „dlonie” (${zd.length}: ${(zd[0] || [])[2] || '–'})`);
    await p.waitForTimeout(2600);
    ok(zdarzeniaDloni().length === 1, `1. ten sam układ dłoni nie wysyła zdarzenia ponownie (${zdarzeniaDloni().length})`);

    /* ---- 2. Wyłączone rozpoznawanie ---- */
    await p.click('#live-rozpoznawanie');
    const piksele2 = await pikseleDloni();
    const od2 = Date.now();
    await p.waitForTimeout(3000);
    const status2 = await p.$eval('#live-status', (e) => e.textContent);
    ok(piksele2 === 0, `2. dłonie znikają od razu po wyłączeniu (${piksele2} px)`);
    ok(ile('/api/dlonie', od2) === 0, `2. żadnej klatki do rozpoznawania dłoni przez 3 s (${ile('/api/dlonie', od2)})`);
    ok(status2 === '', `2. pod obrazem pusto – ani opisu dłoni, ani wiszącego „…” („${status2}”)`);
    await p.evaluate(() => stopLive());
    // Zdarzenie z obserwatora na komputerze (to samo, co widział Marcin).
    await p.evaluate(() => fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'kamera', summary: 'w kadrze pojawiło się: chair' }) }));
    await p.waitForTimeout(1500);
    const dymekWyl = await p.$eval('#event-flash', (e) => !e.hidden && e.textContent);
    ok(!dymekWyl, `2. dymek z obserwatora nie wyskakuje przy wyłączonym rozpoznawaniu (${dymekWyl || 'brak'})`);
    await p.evaluate(() => localStorage.setItem('cosmos.liveRozpoznawanie', '1'));
    await p.evaluate(() => fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'kamera', summary: 'w kadrze pojawiło się: cup' }) }));
    await p.waitForFunction(() => !document.getElementById('event-flash').hidden, null, { timeout: 4000 }).catch(() => {});
    const dymekWl = await p.$eval('#event-flash', (e) => !e.hidden && e.textContent);
    ok(/cup/.test(dymekWl || ''), `2. przy włączonym rozpoznawaniu dymek jest (${dymekWl || 'brak'})`);

    /* ---- 3. Kinect w trybie głosowym ---- */
    await p.evaluate(() => {
      localStorage.setItem('cosmos.liveSource', 'camera');
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Requested device not found', 'NotFoundError'); };
    });
    const wlaczona = await p.evaluate(() => startVoiceCamera());
    await p.waitForFunction(() => document.getElementById('voice-kinect').naturalWidth > 0, null, { timeout: 6000 }).catch(() => {});
    const glos3 = await p.evaluate(() => ({
      kinect: !document.getElementById('voice-kinect').hidden && document.getElementById('voice-kinect').naturalWidth,
      klatka: (captureVoiceFrame() || '').slice(0, 23),
    }));
    ok(wlaczona === true && glos3.kinect > 0, `3. bez kamery przeglądarki tryb głosowy pokazuje Kinecta (${glos3.kinect}px)`);
    ok(glos3.klatka === 'data:image/jpeg;base64,', `3. klatkę z Kinecta da się dołączyć do pytania (${glos3.klatka || 'brak'})`);

    /* ---- 4. „Ile palców pokazuję?” ---- */
    const od4 = Date.now();
    await p.evaluate(() => handleVoiceQuery('Ile palców pokazuję?'));
    await p.waitForTimeout(500);
    const po4 = zapytania.filter(([t]) => t >= od4);
    const iDlonie = po4.findIndex(([, a]) => a === '/api/dlonie');
    const iZdarz = po4.findIndex(([, a, d]) => a === '/api/events' && /"type":"dlonie"/.test(d));
    const iChat = po4.findIndex(([, a]) => a === '/api/chat');
    ok(iDlonie >= 0 && iZdarz > iDlonie && iChat > iZdarz, `4. palce policzone i zgłoszone PRZED pytaniem do modelu (dłonie ${iDlonie}, zdarzenie ${iZdarz}, czat ${iChat})`);
    await p.evaluate(() => stopVoiceCamera());

    /* ---- 5. „Otwórz stronę” ---- */
    await p.evaluate(() => {
      window.__otwarte = [];
      window.__blokuj = false;
      window.open = (u) => { window.__otwarte.push(u); return window.__blokuj ? null : { opener: 1 }; };
    });
    const wyslij = async (tekst) => {
      await p.fill('#input', tekst);
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => !document.querySelector('.msg.streaming') && typeof isGenerating !== 'undefined' && !isGenerating, null, { timeout: 15000 });
    };
    await wyslij('otwórz stronę onet');
    const otwarte1 = await p.evaluate(() => window.__otwarte.slice());
    const karta1 = await p.evaluate(() => { const k = [...document.querySelectorAll('.msg-action-card')].pop(); return k ? { przycisk: Boolean(k.querySelector('.act-do')), zrobione: Boolean(k.querySelector('.action-card-done')) } : null; });
    ok(JSON.stringify(otwarte1) === '["https://onet.pl/"]', `5. strona otwiera się od razu (${JSON.stringify(otwarte1)})`);
    ok(karta1 && karta1.zrobione && !karta1.przycisk, '5. karta od razu odhaczona – bez zatwierdzania');
    await p.evaluate(() => { window.__otwarte = []; window.__blokuj = true; });
    await wyslij('otwórz stronę onet jeszcze raz');
    const przycisk = await p.evaluate(() => { const k = [...document.querySelectorAll('.msg-action-card')].pop(); const b = k && k.querySelector('.act-do'); return b ? b.textContent : ''; });
    ok(/Otwórz|Open/.test(przycisk), `5. zablokowane okno: zostaje przycisk „${przycisk}”`);
    await p.evaluate(() => { window.__blokuj = false; [...document.querySelectorAll('.msg-action-card')].pop().querySelector('.act-do').click(); });
    await p.waitForTimeout(300);
    const otwarte2 = await p.evaluate(() => window.__otwarte.slice());
    ok(otwarte2.length === 2 && otwarte2[1] === 'https://onet.pl/', `5. kliknięcie „Otwórz” otwiera stronę (${JSON.stringify(otwarte2)})`);

    /* ---- 6. Komunikat bez dymka ---- */
    const kom = await p.evaluate(() => {
      komunikatGlosu('Nie udało się rozpoznać mowy: test');
      const e = document.getElementById('voice-transcript');
      return { klasa: e.classList.contains('komunikat'), tlo: getComputedStyle(e).backgroundColor };
    });
    ok(kom.klasa && /rgba\(0, 0, 0, 0\)|transparent/.test(kom.tlo), `6. komunikat błędu bez dymka wypowiedzi (tło ${kom.tlo})`);

    ok(!bledy.length, `błędy JavaScriptu: ${bledy.length ? bledy.join(' | ') : 'brak'}`);
  } catch (e) {
    fail.push(`wyjątek: ${e.message}`);
    console.error(e);
  } finally {
    await b.close();
    env.koniec();
  }
  console.log(fail.length ? `\nDO POPRAWY:\n- ${fail.join('\n- ')}` : '\nDŁONIE, GŁOS I OTWIERANIE OK');
  process.exit(fail.length ? 1 : 0);
})();

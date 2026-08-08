/* Klip wrzucony do rozmowy → klatki kluczowe wycięte W PRZEGLĄDARCE.

   Pomysł z claude-video: model nie czyta wideo, model czyta klatki. Wysyłanie
   klipu na serwer odpada z arytmetyki — minuta z R6 II to 300-500 MB, a te same
   klatki `<video>` + `<canvas>` wyjmują na miejscu, dekoderem sprzętowym, który
   i tak siedzi w każdym urządzeniu.

   To jest kod, którego nie da się sprawdzić bez prawdziwej przeglądarki: cała
   robota dzieje się w dekoderze wideo. Klip nagrywamy w locie z płótna, więc
   zestaw nie potrzebuje ani pliku w repo, ani ffmpega.

   Sprawdzamy przy okazji rzecz, na której łatwo się przejechać: webm nagrany
   w przeglądarce NIE MA W NAGŁÓWKU SWOJEJ DŁUGOŚCI. Bez obejścia wychodzi
   z tego jedna klatka zamiast czterech.
*/
const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');

(async () => {
  if (!maPrzegladarke()) {
    console.log('Brak Chromium — pomijam.');
    process.exit(0);
  }
  const env = await srodowisko('goly');
  const fail = [];
  const b = await przegladarka();
  const p = await b.newPage();
  p.on('pageerror', (e) => fail.push('błąd JS: ' + e.message));
  await p.goto(env.adres, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);

  /* Klip testowy: 2 sekundy, kolor zmieniający się w czasie. Dzięki temu
     z samych klatek widać, CZY zostały wzięte z różnych momentów — cztery
     identyczne obrazy przeszłyby każdy test na „liczbę klatek". */
  const wynik = await p.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    const strumien = canvas.captureStream(25);
    const kawalki = [];
    const rec = new MediaRecorder(strumien, { mimeType: 'video/webm' });
    rec.ondataavailable = (e) => { if (e.data.size) kawalki.push(e.data); };
    const koniec = new Promise((ok) => { rec.onstop = ok; });
    rec.start();

    const start = performance.now();
    await new Promise((ok) => {
      const rysuj = () => {
        const t = (performance.now() - start) / 2000;
        if (t >= 1) return ok();
        // Od czerni do bieli — jasność klatki mówi, z którego momentu pochodzi.
        const j = Math.round(t * 255);
        ctx.fillStyle = `rgb(${j},${j},${j})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        requestAnimationFrame(rysuj);
      };
      rysuj();
    });
    rec.stop();
    await koniec;

    const blob = new Blob(kawalki, { type: 'video/webm' });
    const plik = new File([blob], 'proba.webm', { type: 'video/webm' });

    const przed = pendingImages.length;
    let blad = null;
    try {
      await wczytajWideo(plik);
    } catch (e) {
      blad = e.message;
    }

    // Jasność każdej klatki — czy naprawdę pochodzą z różnych momentów.
    const jasnosci = [];
    for (const src of pendingImages.slice(przed)) {
      const img = new Image();
      await new Promise((ok, zle) => { img.onload = ok; img.onerror = zle; img.src = src; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cc = c.getContext('2d');
      cc.drawImage(img, 0, 0);
      const d = cc.getImageData(0, 0, c.width, c.height).data;
      let suma = 0;
      for (let i = 0; i < d.length; i += 4) suma += d[i];
      jasnosci.push(Math.round(suma / (d.length / 4)));
    }

    const notatka = pendingDocs[pendingDocs.length - 1];
    return {
      rozmiarKlipu: blob.size,
      blad,
      klatek: pendingImages.length - przed,
      jasnosci,
      notatka: notatka ? notatka.text : null,
      nazwaNotatki: notatka ? notatka.name : null,
      trwaWczytywanie: Boolean(notatka && notatka.loading),
    };
  });

  console.log(`1. klip ${Math.round(wynik.rozmiarKlipu / 1024)} kB → ${wynik.klatek} klatek`
    + `${wynik.blad ? ` (błąd: ${wynik.blad})` : ''}`);
  if (wynik.blad) fail.push(`wczytywanie wideo rzuciło wyjątkiem: ${wynik.blad}`);
  if (wynik.klatek !== 4) {
    fail.push(`z klipu wyszły ${wynik.klatek} klatki zamiast 4 — najpewniej `
      + 'nie udało się poznać długości pliku bez nagłówka');
  }

  console.log(`2. jasność kolejnych klatek: ${JSON.stringify(wynik.jasnosci)}`);
  const rosnie = wynik.jasnosci.every((j, i) => i === 0 || j >= wynik.jasnosci[i - 1]);
  const rozpietosc = wynik.jasnosci.length
    ? Math.max(...wynik.jasnosci) - Math.min(...wynik.jasnosci) : 0;
  if (!rosnie) fail.push('klatki nie są w kolejności czasu');
  if (rozpietosc < 40) {
    fail.push(`wszystkie klatki wyglądają tak samo (rozpiętość ${rozpietosc}) `
      + '— przewijanie nie zadziałało i to jest cztery razy ta sama klatka');
  }

  console.log(`3. notatka: „${String(wynik.notatka).slice(0, 90)}…"`);
  if (wynik.trwaWczytywanie) fail.push('załącznik został w stanie „wczytuję"');
  if (!wynik.notatka) {
    fail.push('brak notatki — model dostanie cztery luźne zdjęcia zamiast jednego ujęcia');
  } else {
    if (!/proba\.webm/.test(wynik.notatka)) fail.push('notatka nie mówi, z jakiego pliku są klatki');
    if (!/JEDNEGO KLIPU|ONE CLIP/.test(wynik.notatka)) {
      fail.push('notatka nie tłumaczy, że to kolejne momenty jednego ujęcia');
    }
  }

  /* Plik, który wideo tylko udaje. Ma się skończyć czytelnym komunikatem,
     a nie zawieszonym załącznikiem „wczytuję…" na zawsze. */
  const smiec = await p.evaluate(async () => {
    // Bez tego limit czterech obrazów zdążyłby się wyczerpać na poprzednim
    // klipie i „sprawdzenie zepsutego pliku" sprawdzałoby tylko limit.
    pendingImages.length = 0;
    renderAttachments();
    const plik = new File([new Uint8Array([1, 2, 3, 4, 5])], 'zepsute.mp4', { type: 'video/mp4' });
    const docPrzed = pendingDocs.length;
    let blad = null;
    try { await wczytajWideo(plik); } catch (e) { blad = e.message; }
    return { blad, zostawilSmiec: pendingDocs.length !== docPrzed };
  });
  console.log(`4. zepsuty plik → „${String(smiec.blad).slice(0, 70)}"`);
  if (!smiec.blad) fail.push('zepsute wideo przeszło bez słowa');
  if (smiec.zostawilSmiec) fail.push('po nieudanym wideo został wiszący załącznik');

  await b.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nKLATKI Z WIDEO OK');
  process.exit(fail.length ? 1 : 0);
})();

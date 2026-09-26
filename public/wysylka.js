/* ============================================================
   Wysyłka do bazy wiedzy – surowy plik z postępem i podgląd obrazu dla modelu

   Wydzielone z app.js. Oba kawałki pilnują tego samego: telefon nie zamiera,
   a do serwera i do modelu idzie tyle danych, ile trzeba.
   ============================================================ */

/**
 * @param {object} z
 * @param {Function} z.t tłumaczenia
 */
function utworzWysylke({ t }) {
  /* Plik idzie do bazy wiedzy jako SUROWE ciało, nie base64 w JSON-ie.
     Kodowanie base64 i JSON.stringify działały w wątku głównym: plik 45 MB
     zamrażał telefon na 4,7 s (bez przewijania, bez dotyku), a przez tunel szło
     o jedną trzecią więcej danych. XMLHttpRequest zamiast fetch, bo tylko on
     mówi, ile już wysłał – człowiek widzi „Wysyłam 37%", a nie jeden napis
     przez minutę. Nazwa w nagłówku, nie w adresie (adresy lądują w dziennikach). */
  function wyslijPlikDoBazy(file, naPostep) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/kb/file');
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('X-Cosmos-Nazwa', encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && naPostep) naPostep(e.loaded / e.total); };
      xhr.onload = () => {
        let d;
        try { d = JSON.parse(xhr.responseText); } catch { d = { error: `HTTP ${xhr.status} – ${String(xhr.responseText || '').trim().slice(0, 200)}` }; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(d);
        else reject(new Error(d.error || `HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error(t('offline.title')));
      xhr.send(file);
    });
  }

  /* PODGLĄD OBRAZU DLA MODELU. Zdjęcie z aparatu szło do modelu w oryginale
     (15 MB = ~20 MB w każdej wiadomości, u Claude'a ponad limit na obraz).
     Serwer nie ma dekodera obrazów, więc mniejszą wersję robi przeglądarka:
     createImageBitmap dekoduje poza wątkiem głównym, a toBlob koduje
     asynchronicznie – telefon nie zamiera. Mały obraz podglądu nie potrzebuje. */
  const PODGLAD_BOK = 1568;
  const PODGLAD_OD_BAJTOW = 1.5 * 1024 * 1024;
  /* Formaty, które przyjmują i OpenAI, i Claude. Mały BMP, SVG czy AVIF szedł
     do modelu w oryginale i każda wiadomość padała odmową 400 (zespół IT,
     runda 4) – dostają podgląd JPEG niezależnie od rozmiaru. */
  const PRZYJMOWANY = /^image\/(jpeg|png|gif|webp)$/;
  async function przygotujPodglad(zrodlo, id) {
    const bitmapa = await createImageBitmap(zrodlo);
    const skala = Math.min(1, PODGLAD_BOK / Math.max(bitmapa.width, bitmapa.height));
    if (skala === 1 && zrodlo.size <= PODGLAD_OD_BAJTOW && PRZYJMOWANY.test(zrodlo.type || '')) { bitmapa.close(); return false; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmapa.width * skala);
    canvas.height = Math.round(bitmapa.height * skala);
    canvas.getContext('2d').drawImage(bitmapa, 0, 0, canvas.width, canvas.height);
    bitmapa.close();
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    if (!blob) return false;
    const r = await fetch(`/api/kb/podglad?id=${encodeURIComponent(id)}`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
    });
    return r.ok;
  }

  /** Stara pozycja bez podglądu – dorabiamy go przy zaznaczeniu, w tle. */
  async function podgladDlaPozycji(item) {
    if (item.podglad || !/^image\//.test(item.mime || '')) return;
    if (item.size <= PODGLAD_OD_BAJTOW && PRZYJMOWANY.test(item.mime)) return;
    try {
      const blob = await (await fetch(`/api/kb/raw?id=${encodeURIComponent(item.id)}`)).blob();
      if (await przygotujPodglad(blob, item.id)) item.podglad = true;
    } catch { /* zostaje oryginał – serwer powie modelowi, że obraz jest za duży */ }
  }

  return { wyslijPlikDoBazy, przygotujPodglad, podgladDlaPozycji };
}

if (typeof window !== 'undefined') window.utworzWysylke = utworzWysylke;
if (typeof module !== 'undefined') module.exports = { utworzWysylke };

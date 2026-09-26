/* ============================================================
   Historia rozmów – jeden plik JSON na rozmowę + lekki indeks metadanych

   Współdzielona między urządzeniami (PC, Android, Electron), bez limitu
   localStorage. Bez bazy danych – rozmowy to dokumenty, nie dane relacyjne.

   Wydzielone z server.js (runda 3). Indeks żyje w stanie osoby (U().convIndex),
   pliki w jej katalogu `conversations/` – oba wyłącznie przez U() wołane
   W FUNKCJI, nigdy wartość przy starcie (zasada 4 z CLAUDE.md).
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const { zapiszAtomowo } = require('./rdzen.js');
const miejsce_ = require('./miejsce.js');

/**
 * @param {object} z
 * @param {Function} z.U          stan bieżącej osoby (lib/stan-osoby.js)
 * @param {Function} z.readJson   odczyt JSON-a z żądania
 * @param {Function} z.sendJson   odpowiedź JSON
 * @param {Function} z.bladZapisu odpowiedź na nieudany zapis (507/500)
 */
function utworz({ U, readJson, sendJson, bladZapisu }) {
  const CONV_DIR = () => path.join(U().katalog, 'conversations');
  const CONV_INDEX = () => path.join(CONV_DIR(), 'index.json');

  /** Zapis indeksu. Nie rzuca – ZWRACA błąd (null = zapisane), patrz lib/miejsce.js. */
  function saveConvIndex() {
    return miejsce_.zapiszLubBlad('indeksu rozmów', () => zapiszAtomowo(CONV_INDEX(), JSON.stringify(U().convIndex)));
  }

  /** Oczyszczony identyfikator – tylko nasz alfabet uid; blokuje path traversal.
   *  Indeks i nazwa pliku muszą przechodzić przez tę samą funkcję. */
  const czysteId = (id) => String(id).replace(/[^a-z0-9]/gi, '');

  function convPath(id) {
    return path.join(CONV_DIR(), `${czysteId(id)}.json`);
  }

  function sortConvIndex() {
    // przypięte na górze, potem wg czasu modyfikacji
    U().convIndex.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
  }

  /** Wpis indeksu w miejsce starego albo na koniec. */
  function ustawMeta(meta) {
    const i = U().convIndex.findIndex((c) => c.id === meta.id);
    if (i >= 0) U().convIndex[i] = meta; else U().convIndex.push(meta);
  }

  /** Dopisz wiadomość do rozmowy PO STRONIE SERWERA.
   *
   *  Normalnie rozmowy zapisuje przeglądarka, całym dokumentem. Ta furtka jest
   *  dla jednego przypadku: odpowiedź skończyła się, gdy nikogo już nie było
   *  przy ekranie. Bez niej „praca w tle" znaczyłaby tylko tyle, że serwer
   *  dokończył czytanie od modelu i wyrzucił wynik.
   *
   *  Zabezpieczenie przed dublem: wiadomość niesie `bieg` – identyfikator biegu,
   *  który ją wyprodukował. Gdy przeglądarka wróci i zapisze rozmowę po swojemu,
   *  jej wersja nadpisze plik w całości, więc dubla nie będzie. Gdyby jednak
   *  dopisywano dwa razy z tym samym `bieg`, drugi raz pomijamy.
   */
  function dopiszWiadomosc(id, wiadomosc) {
    const plik = convPath(id);
    let conv;
    try { conv = JSON.parse(fs.readFileSync(plik, 'utf8')); } catch { return false; }
    if (!Array.isArray(conv.messages)) return false;
    if (wiadomosc.bieg && conv.messages.some((m) => m.bieg === wiadomosc.bieg)) return false;
    /* Drugi pas bezpieczeństwa: przeglądarka mogła już zapisać tę samą
       odpowiedź pod swoją postacią (bez znacznika biegu). Dwie identyczne
       wypowiedzi pod rząd to dla użytkownika ewidentna usterka. */
    const ostatnia = conv.messages[conv.messages.length - 1];
    if (ostatnia && ostatnia.role === 'assistant' && typeof ostatnia.content === 'string'
        && typeof wiadomosc.content === 'string'
        && ostatnia.content.trim() === wiadomosc.content.trim()) return false;
    conv.messages.push(wiadomosc);
    conv.updatedAt = Date.now();
    zapiszAtomowo(plik, JSON.stringify(conv));
    const meta = U().convIndex.find((c) => c.id === id);
    if (meta) { meta.updatedAt = conv.updatedAt; sortConvIndex(); saveConvIndex(); }
    return true;
  }

  /** Wyszukiwanie po TREŚCI rozmów (skan plików) – dopasowania z fragmentem. */
  function szukajWTresci(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const meta of U().convIndex) {
      try {
        const conv = JSON.parse(fs.readFileSync(convPath(meta.id), 'utf8'));
        let snippet = '';
        for (const m of conv.messages || []) {
          const text = typeof m.content === 'string' ? m.content
            : (Array.isArray(m.content) ? (m.content.find((p) => p.type === 'text')?.text || '') : (m.content?.text || ''));
          const at = text.toLowerCase().indexOf(q);
          if (at >= 0) { snippet = text.slice(Math.max(0, at - 40), at + 80); break; }
        }
        const inTitle = (meta.title || '').toLowerCase().includes(q);
        if (snippet || inTitle) out.push({ id: meta.id, title: meta.title, snippet: snippet.trim() });
      } catch { /* pomiń uszkodzony plik */ }
    }
    return out.slice(0, 30);
  }

  /** Wszystkie rozmowy osoby w całości – do kopii zapasowej. */
  function wszystkie() {
    return U().convIndex.map((meta) => {
      try { return JSON.parse(fs.readFileSync(convPath(meta.id), 'utf8')); } catch { return null; }
    }).filter(Boolean);
  }

  /** Przywrócenie rozmów z kopii. Miejsce sprawdzane dla całości, zanim
   *  cokolwiek zapiszemy. Zwraca { przywrocono, blad } – blad = pierwszy
   *  nieudany zapis (null, gdy wszystko weszło). */
  async function przywroc(rozmowy) {
    const tresci = rozmowy.filter((c) => c && c.id).map((c) => JSON.stringify(c));
    await miejsce_.sprawdz(tresci.reduce((suma, t) => suma + Buffer.byteLength(t), 0));
    let przywrocono = 0;
    let blad = null;
    for (const conv of rozmowy) {
      if (!conv || !conv.id) continue;
      const id = czysteId(conv.id);
      try {
        zapiszAtomowo(convPath(id), JSON.stringify(conv));
        ustawMeta({ id, title: conv.title || 'Rozmowa', createdAt: conv.createdAt || Date.now(), updatedAt: conv.updatedAt || Date.now(), pinned: conv.pinned || false });
        przywrocono++;
      } catch (err) { blad = blad || err; }
    }
    sortConvIndex();
    return { przywrocono, blad: saveConvIndex() || blad };
  }

  /** /api/conversations, /api/conversations/meta, /api/conversations/search */
  async function obsluz(req, res, pathname) {
    const rawId = new URL(req.url, 'http://localhost').searchParams.get('id');
    // ta sama sanityzacja co convPath – indeks i nazwa pliku zawsze zgodne
    const id = rawId ? czysteId(rawId) : rawId;

    // zmiana nazwy / przypięcie – bez nadpisywania treści rozmowy
    if (pathname === '/api/conversations/meta' && req.method === 'POST' && id) {
      let data;
      try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const entry = U().convIndex.find((c) => c.id === id);
      if (!entry) return sendJson(res, 404, { error: 'Nie znaleziono rozmowy.' });
      if (typeof data.title === 'string' && data.title.trim()) entry.title = data.title.trim().slice(0, 120);
      if (typeof data.pinned === 'boolean') entry.pinned = data.pinned;
      // zapisz też do pliku (trwałość tytułu/przypięcia)
      try {
        const conv = JSON.parse(fs.readFileSync(convPath(id), 'utf8'));
        conv.title = entry.title;
        conv.pinned = entry.pinned || false;
        zapiszAtomowo(convPath(id), JSON.stringify(conv));
      } catch { /* plik mógł zniknąć – indeks i tak zaktualizowany */ }
      sortConvIndex();
      const blad = saveConvIndex();
      if (blad) return bladZapisu(res, blad);
      return sendJson(res, 200, { ok: true, meta: entry });
    }

    if (pathname === '/api/conversations/search' && req.method === 'GET') {
      const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
      return sendJson(res, 200, { results: szukajWTresci(q) });
    }

    if (req.method === 'GET' && !id) {
      return sendJson(res, 200, { conversations: U().convIndex });
    }
    if (req.method === 'GET' && id) {
      try {
        return sendJson(res, 200, JSON.parse(fs.readFileSync(convPath(id), 'utf8')));
      } catch {
        return sendJson(res, 404, { error: 'Nie znaleziono rozmowy.' });
      }
    }
    if (req.method === 'PUT' && id) {
      let conv;
      try { conv = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      /* Zapis z nieaktualnej kopii (drugie urządzenie) nie nadpisuje nowszej
         wersji – 409 z nią, klient scala. Bez `bazaUpdatedAt` (stary klient,
         skrypty) – dawne zachowanie. */
      const baza = Number(conv.bazaUpdatedAt);
      delete conv.bazaUpdatedAt;
      if (Number.isFinite(baza) && baza > 0) {
        let naDysku = null;
        try { naDysku = JSON.parse(fs.readFileSync(convPath(id), 'utf8')); } catch { /* nowa rozmowa */ }
        if (naDysku && Number(naDysku.updatedAt) > baza) {
          return sendJson(res, 409, { error: 'Ta rozmowa zmieniła się w międzyczasie na innym urządzeniu.', rozmowa: naDysku });
        }
      }
      conv.id = id;
      conv.updatedAt = Date.now();
      if (!conv.createdAt) conv.createdAt = conv.updatedAt;
      /* Rozmowa ze zdjęciami potrafi urosnąć – liczy się do limitu osoby tak
         samo jak baza wiedzy. Liczymy przyrost, nie całość: poprawka literówki
         w rozmowie przy pełnym limicie ma przejść. */
      const tresc = JSON.stringify(conv);
      let bylo = 0;
      try { bylo = fs.statSync(convPath(id)).size; } catch { /* nowa rozmowa */ }
      const przyrost = Buffer.byteLength(tresc) - bylo;
      if (przyrost > 0) await miejsce_.sprawdz(przyrost);
      try {
        zapiszAtomowo(convPath(id), tresc);
      } catch (err) {
        if (miejsce_.toBrakMiejsca(err)) return bladZapisu(res, err);
        return sendJson(res, 500, { error: `Zapis rozmowy nie powiódł się: ${err.message}` });
      }
      miejsce_.dolicz(przyrost);
      const prev = U().convIndex.find((c) => c.id === id);
      const meta = {
        id,
        title: conv.title || 'Rozmowa',
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        pinned: (typeof conv.pinned === 'boolean' ? conv.pinned : prev?.pinned) || false,
      };
      ustawMeta(meta);
      sortConvIndex();
      const bladIndeksu = saveConvIndex();
      if (bladIndeksu) return bladZapisu(res, bladIndeksu);
      return sendJson(res, 200, { ok: true, meta });
    }
    if (req.method === 'DELETE' && id) {
      const usunieta = U().convIndex.find((c) => c.id === id);
      U().convIndex = U().convIndex.filter((c) => c.id !== id);
      const blad = saveConvIndex();
      if (blad) {
        // Indeks na dysku dalej ją ma – niech i w pamięci wróci, zamiast zniknąć do restartu.
        if (usunieta) { U().convIndex.push(usunieta); sortConvIndex(); }
        return bladZapisu(res, blad);
      }
      try { fs.unlinkSync(convPath(id)); } catch { /* już nie ma */ }
      return sendJson(res, 200, { ok: true });
    }
    res.writeHead(405);
    res.end();
  }

  return { obsluz, convPath, dopiszWiadomosc, szukajWTresci, wszystkie, przywroc };
}

module.exports = { utworz };

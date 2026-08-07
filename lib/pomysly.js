/* ============================================================
   Backlog usprawnień — pomysły Cosmosa na samego siebie

   Cosmos zna swój stan (manifest zdolności), Twój profil i tematy rozmów,
   więc potrafi zaproponować, co jeszcze mógłby dla Ciebie robić. Pomysły
   trafiają tutaj DO AKCEPTACJI — nic nie dzieje się samo. To celowe:
   narzędzie, które samo sobie dokłada zadania, przestaje być narzędziem.

   Wydzielone z server.js przy podziale pliku. Moduł dostaje zależności
   przez `utworz()`, zamiast sięgać po globalne stany serwera — dzięki temu
   da się go uruchomić i sprawdzić osobno.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const { genId } = require('./rdzen.js');

/**
 * @param {object} zaleznosci
 * @param {string} zaleznosci.katalogDanych  gdzie trzymać plik z pomysłami
 * @param {Function} zaleznosci.saveJsonFile zapis JSON-a na dysk
 * @param {Function} zaleznosci.sendJson     odpowiedź HTTP
 * @param {Function} zaleznosci.readJson     odczyt ciała żądania
 * @param {Function} zaleznosci.addEvent     dziennik zdarzeń
 * @param {Function} zaleznosci.llmComplete  zapytanie do modelu
 * @param {Function} zaleznosci.manifest     tekst manifestu zdolności
 * @param {Function} zaleznosci.opisZdolnosci manifest zamieniony na tekst dla modelu
 * @param {Function} zaleznosci.profil       profil użytkownika (tekst)
 * @param {Function} zaleznosci.tematyRozmow tytuły ostatnich rozmów
 * @param {Function} zaleznosci.pozycjeWiedzy nazwy pozycji z bazy wiedzy
 */
function utworz({ katalogDanych, saveJsonFile, sendJson, readJson, addEvent,
  llmComplete, manifest, opisZdolnosci, profil, tematyRozmow, pozycjeWiedzy }) {
  const IMPROVE_FILE = path.join(katalogDanych, 'improvements.json');
  let improvements = [];
  try { improvements = JSON.parse(fs.readFileSync(IMPROVE_FILE, 'utf8')); } catch { /* brak */ }
  const saveImprovements = () => saveJsonFile(IMPROVE_FILE, improvements);

  async function handleImprovements(req, res, pathname) {
    if (pathname === '/api/improvements' && req.method === 'GET') {
      return sendJson(res, 200, { improvements });
    }
    if (pathname === '/api/improvements' && req.method === 'POST') {
      let data; try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const text = String(data.text || '').trim().slice(0, 1000);
      if (!text) return sendJson(res, 400, { error: 'Pusty pomysł.' });
      const item = { id: genId(), text, zrodlo: data.zrodlo === 'model' ? 'model' : 'ja',
        status: 'nowy', createdAt: Date.now() };
      improvements.push(item);
      saveImprovements();
      addEvent('rozwój', `nowy pomysł na usprawnienie: ${text.slice(0, 80)}`);
      return sendJson(res, 200, { ok: true, id: item.id });
    }
    if (pathname === '/api/improvements' && req.method === 'PUT') {
      let data; try { data = await readJson(req); } catch { return sendJson(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const it = improvements.find((x) => x.id === data.id);
      if (!it) return sendJson(res, 404, { error: 'Nie znaleziono.' });
      if (['nowy', 'zaakceptowany', 'odrzucony', 'zrobione'].includes(data.status)) it.status = data.status;
      saveImprovements();
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/improvements' && req.method === 'DELETE') {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      improvements = improvements.filter((x) => x.id !== id);
      saveImprovements();
      return sendJson(res, 200, { ok: true });
    }
    res.writeHead(405); res.end();
  }

  /** Zamień surową wypowiedź w precyzyjny prompt.
   *
   * Dyktowana wiadomość jest z natury luźna: powtórzenia, „yyy", myśl zmieniana
   * w połowie zdania. Model dostaje ją do przepisania — ma zachować INTENCJĘ
   * i wszystkie szczegóły, a uporządkować formę. Zwracamy sam tekst, bez
   * komentarzy, żeby dało się nim po prostu podmienić zawartość pola.
   */
  async function handleSuggest(req, res) {
    const m = await manifest();
    const titles = tematyRozmow();
    const kbNames = pozycjeWiedzy();
    const known = improvements.map((i) => i.text.slice(0, 60));

    const context = [
      opisZdolnosci(m),
      profil().trim() ? '\nPROFIL UŻYTKOWNIKA:\n' + profil().trim() : '',
      titles.length ? '\nOSTATNIE TEMATY ROZMÓW:\n- ' + titles.join('\n- ') : '',
      kbNames.length ? '\nCO JEST W BAZIE WIEDZY:\n- ' + kbNames.join('\n- ') : '',
      known.length ? '\nJUŻ ZAPROPONOWANE (nie powtarzaj):\n- ' + known.join('\n- ') : '',
    ].filter(Boolean).join('\n');

    const lang = (req.headers['x-cosmos-lang'] === 'en') ? 'en' : 'pl';
    const instruction = lang === 'en'
      ? 'You are Cosmos. Based on your real capabilities and this user\'s context, propose 4 concrete, '
        + 'personal ways they could use you that they probably have not thought of. Skip anything already '
        + 'listed. For each: a bold one-line title, two sentences on the value, and a short "How:" line with '
        + 'the exact steps or what to enable. Only propose things your listed capabilities actually allow.'
      : 'Jesteś Cosmosem. Na podstawie swoich REALNYCH możliwości i kontekstu tego użytkownika zaproponuj '
        + '4 konkretne, osobiste sposoby wykorzystania siebie, na które on prawdopodobnie nie wpadł. '
        + 'Pomiń to, co już zaproponowane. Każdy pomysł: pogrubiony tytuł w jednej linii, dwa zdania '
        + 'o wartości, oraz krótka linia „Jak:" z dokładnymi krokami albo co włączyć. '
        + 'Proponuj wyłącznie rzeczy, na które pozwalają wymienione możliwości. Bez lania wody.';

    try {
      const text = await llmComplete([
        { role: 'system', content: instruction },
        { role: 'user', content: context },
      ], { endpoint: 'cloud', maxTokens: 900 });
      addEvent('rozwój', 'Cosmos zaproponował nowe zastosowania');
      return sendJson(res, 200, { ok: true, text });
    } catch (err) {
      return sendJson(res, 502, { error: 'suggest-failed', message: err.message });
    }
  }

  return { handleImprovements, handleSuggest, lista: () => improvements };
}

module.exports = { utworz };

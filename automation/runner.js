#!/usr/bin/env node
/* Cosmos — moduł automatyzacji web (TYLKO DO ODCZYTU).
 *
 * Uruchamia kroki nauczonej procedury w prawdziwej przeglądarce (Playwright).
 * Dozwolone: otwórz stronę, poczekaj, odczytaj, kliknij (nawigacja) ORAZ
 * logowanie (kroki oznaczone auth: wpisanie loginu/hasła z menedżera haseł,
 * klik "Zaloguj"). ODRZUCANE: kroki wrażliwe (płatność, wysłanie, potwierdzenie)
 * oraz zwykłe wpisywanie danych (type bez auth) — te wymagają ręcznego runnera.
 *
 * Wartości sekretów są już podmienione przez serwer (z menedżera haseł) i
 * docierają tu przez stdin — runner nie zna vaulta i nie zapisuje niczego.
 *
 * Zależność opcjonalna: `npm install playwright` (przeglądarka Chromium).
 * Bez niej reszta Cosmosa działa; ten moduł zwraca wtedy błąd „playwright-missing".
 *
 * Wejście: JSON {name, steps} na stdin.
 * Wyjście: JSON {ok, results:[{step,label,value}], stoppedAt?, reason?} na stdout.
 */
'use strict';

// akcje bezpieczne dla trybu tylko-do-odczytu
const READONLY_ACTIONS = new Set(['open', 'wait', 'read', 'click']);
// krok dozwolony w trybie auto: odczyt zawsze; type/click jako logowanie (auth);
// nigdy krok wrażliwy ani confirm.
function stepAllowed(s) {
  if (s.sensitive || s.action === 'confirm') return false;
  if (READONLY_ACTIONS.has(s.action)) return true;
  if (s.action === 'type' && s.auth) return true;
  return false;
}
const TIMEOUT_MS = 20000;
const MAX_STEPS = 40;

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => resolve(buf));
  });
}

function out(obj) { process.stdout.write(JSON.stringify(obj)); }

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { return out({ ok: false, error: 'playwright-missing' }); }

  let input;
  try { input = JSON.parse(await readStdin() || '{}'); }
  catch { return out({ ok: false, error: 'bad-input' }); }

  const steps = Array.isArray(input.steps) ? input.steps.slice(0, MAX_STEPS) : [];
  if (!steps.length) return out({ ok: false, error: 'no-steps' });

  // twarda bramka: żaden krok wrażliwy ani zmieniający stan (poza logowaniem) nie przejdzie
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!stepAllowed(s)) {
      return out({
        ok: false, error: 'not-readonly', stoppedAt: i + 1,
        reason: `Krok ${i + 1} (${s.action}${s.sensitive ? ', wrażliwy' : ''}) zmienia stan — ` +
                `użyj ręcznego runnera z potwierdzeniem.`,
      });
    }
  }

  const launchOpts = {};
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

  let browser;
  const results = [];
  try {
    browser = await chromium.launch(launchOpts);
    const page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.action === 'open') {
        await page.goto(s.target, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
      } else if (s.action === 'wait') {
        if (s.target) await page.waitForSelector(s.target, { timeout: TIMEOUT_MS }).catch(() => {});
        else await page.waitForTimeout(Math.min(10000, Number(s.value) || 1500));
      } else if (s.action === 'click') {
        if (s.target) await page.click(s.target, { timeout: TIMEOUT_MS }).catch(() => {});
      } else if (s.action === 'type' && s.auth) {
        // logowanie: wpisz wartość (login/hasło z menedżera) do pola
        if (s.target) await page.fill(s.target, String(s.value || ''), { timeout: TIMEOUT_MS }).catch(() => {});
      } else if (s.action === 'read') {
        let value = '';
        try {
          if (s.target) {
            const el = await page.$(s.target);
            value = el ? (await el.textContent() || '').trim() : '(nie znaleziono elementu)';
          } else {
            value = (await page.title()) || '';
          }
        } catch { value = '(błąd odczytu)'; }
        results.push({ step: i + 1, label: s.note || s.target || `krok ${i + 1}`, value: value.slice(0, 2000) });
      }
    }
    await browser.close();
    return out({ ok: true, name: input.name || '', results });
  } catch (err) {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    return out({ ok: false, error: 'run-failed', reason: String(err && err.message || err).slice(0, 300), results });
  }
}

main();

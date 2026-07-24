#!/usr/bin/env node
/*
 * Cosmos — nagrywarka procedur webowych (opcjonalna, Playwright).
 *
 * Otwiera prawdziwą przeglądarkę na maszynie z serwerem; Ty wykonujesz zadanie
 * (klikasz, wpisujesz, przechodzisz między stronami), a nagrywarka zapisuje
 * SEMANTYCZNE kroki — który element, nie współrzędne — do pliku JSON, który
 * runner Cosmosa potrafi wiernie odtworzyć.
 *
 * Zasady bezpieczeństwa:
 *  • pola hasła NIE są zapisywane — stają się krokiem „logowanie" (auth)
 *    z odwołaniem {{secret:haslo}} (wartość pobiera menedżer haseł przy odtwarzaniu),
 *  • kliknięcia w przyciski typu „Zapłać/Wyślij/Potwierdź" są oznaczane jako
 *    wrażliwe (zawsze wymagają potwierdzenia — nie idą w tryb auto).
 *
 * Wejście:  --url <adres startowy>   (opcjonalne)
 *           env COSMOS_RECORD_OUT = ścieżka pliku wynikowego JSON
 *           --selftest               (test logiki bez przeglądarki)
 * Wyjście:  plik JSON { steps:[...] } zapisywany na bieżąco i przy zamknięciu.
 */
'use strict';
const fs = require('node:fs');

const SENSITIVE_RE = /(zap[łl]a[cć]|p[łl]atno|pay\b|buy\b|kup|wy[śs]lij|send\b|potwierd|confirm|submit|przelew|transfer|order|checkout|delete|usu[nń])/i;
const LOGIN_HINT_RE = /(login|user|e-?mail|użytkownik|uzytkownik|nazwa)/i;

// Przetworzenie surowych zdarzeń na kroki procedury (czyste, oznaczone).
function buildSteps(raw) {
  const steps = [];
  let lastClickAt = -1e12; // pierwsza nawigacja NIE jest „po kliknięciu"
  for (const ev of raw) {
    if (ev.type === 'nav') {
      // pomiń nawigację wywołaną klikiem (do 1,5 s po nim) i duplikaty
      if (ev.t - lastClickAt < 1500) continue;
      const prev = steps[steps.length - 1];
      if (prev && prev.action === 'open' && prev.target === ev.url) continue;
      steps.push({ action: 'open', target: ev.url, value: '', note: '', sensitive: false, auth: false });
    } else if (ev.type === 'click') {
      lastClickAt = ev.t;
      const sensitive = SENSITIVE_RE.test(ev.text || '');
      steps.push({ action: 'click', target: ev.selector, value: '', note: (ev.text || '').slice(0, 60), sensitive, auth: false });
    } else if (ev.type === 'input') {
      const isPw = ev.isPassword;
      const isLogin = isPw || LOGIN_HINT_RE.test(ev.selector || '') || LOGIN_HINT_RE.test(ev.name || '');
      steps.push({
        action: 'type',
        target: ev.selector,
        value: isPw ? '{{secret:haslo}}' : (ev.value || ''),
        note: '',
        sensitive: false,
        auth: Boolean(isLogin),
      });
    }
  }
  // scal kolejne wpisy do tego samego pola (bierz ostatnią wartość)
  const merged = [];
  for (const s of steps) {
    const prev = merged[merged.length - 1];
    if (prev && s.action === 'type' && prev.action === 'type' && prev.target === s.target) {
      merged[merged.length - 1] = s;
    } else merged.push(s);
  }
  return merged;
}

// Funkcja wstrzykiwana do stron — liczy stabilny selektor i melduje zdarzenia.
/* istanbul ignore next — działa w przeglądarce */
function browserRecorder() {
  function sel(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const name = el.getAttribute && el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
    const ph = el.getAttribute && el.getAttribute('placeholder');
    if (ph) return `${el.tagName.toLowerCase()}[placeholder="${ph}"]`;
    const al = el.getAttribute && el.getAttribute('aria-label');
    if (al) return `${el.tagName.toLowerCase()}[aria-label="${al}"]`;
    // ścieżka nth-of-type do korzenia
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node.tagName !== 'BODY' && parts.length < 6) {
      let seg = node.tagName.toLowerCase();
      const parent = node.parentNode;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) seg += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(seg);
      node = node.parentNode;
    }
    return parts.join(' > ');
  }
  const clickable = (el) => el.closest('button, a, [role="button"], input[type="submit"], input[type="button"], summary');
  document.addEventListener('click', (e) => {
    const el = clickable(e.target) || e.target;
    if (!el) return;
    window.__cosmosRecord({ type: 'click', selector: sel(el), text: (el.innerText || el.value || '').trim().slice(0, 80), t: Date.now() });
  }, true);
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el || !('value' in el)) return;
    if (el.tagName === 'INPUT' && ['checkbox', 'radio', 'file', 'submit', 'button'].includes(el.type)) return;
    window.__cosmosRecord({
      type: 'input', selector: sel(el), name: el.getAttribute && el.getAttribute('name') || '',
      value: el.value || '', isPassword: el.type === 'password', t: Date.now(),
    });
  }, true);
}

async function main() {
  const outFile = process.env.COSMOS_RECORD_OUT;
  const urlArg = (() => { const i = process.argv.indexOf('--url'); return i >= 0 ? process.argv[i + 1] : ''; })();

  if (process.argv.includes('--selftest')) {
    const sample = [
      { type: 'nav', url: 'https://ebok.example.com', t: 1000 },
      { type: 'input', selector: '#login', name: 'login', value: 'marcin', isPassword: false, t: 2000 },
      { type: 'input', selector: '#pass', name: 'pass', value: 'TOPSECRET', isPassword: true, t: 2500 },
      { type: 'click', selector: 'button#signin', text: 'Zaloguj', t: 3000 },
      { type: 'nav', url: 'https://ebok.example.com/panel', t: 3200 }, // klik-nawigacja → pomiń
      { type: 'input', selector: '#pass', name: 'pass', value: 'TOPSECRET2', isPassword: true, t: 4000 }, // scal
      { type: 'click', selector: 'button.pay', text: 'Zapłać teraz', t: 6000 },
    ];
    process.stdout.write(JSON.stringify(buildSteps(sample), null, 2));
    return;
  }

  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { if (outFile) fs.writeFileSync(outFile, JSON.stringify({ error: 'playwright-missing' })); process.stderr.write('playwright-missing\n'); process.exit(2); }

  const raw = [];
  const flush = () => { if (outFile) { try { fs.writeFileSync(outFile, JSON.stringify({ steps: buildSteps(raw) })); } catch { /* */ } } };

  const launchOpts = { headless: false };
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

  let browser;
  try { browser = await chromium.launch(launchOpts); }
  catch (err) { if (outFile) fs.writeFileSync(outFile, JSON.stringify({ error: 'launch-failed', reason: err.message })); process.stderr.write('launch-failed: ' + err.message + '\n'); process.exit(3); }

  const context = await browser.newContext();
  await context.exposeBinding('__cosmosRecord', (_src, ev) => { raw.push(ev); flush(); });
  await context.addInitScript(browserRecorder);
  context.on('page', (p) => {
    p.on('framenavigated', (f) => { if (f === p.mainFrame() && f.url() && f.url() !== 'about:blank') { raw.push({ type: 'nav', url: f.url(), t: Date.now() }); flush(); } });
  });
  const page = await context.newPage();
  if (urlArg) await page.goto(urlArg).catch(() => {});

  const finish = async () => { flush(); try { await browser.close(); } catch { /* */ } process.exit(0); };
  process.on('SIGTERM', finish);
  process.on('SIGINT', finish);
  browser.on('disconnected', () => { flush(); process.exit(0); }); // użytkownik zamknął okno
}

module.exports = { buildSteps };
if (require.main === module) main();

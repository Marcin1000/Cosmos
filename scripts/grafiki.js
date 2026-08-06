#!/usr/bin/env node
/* Sprawdź, które źródła grafik naprawdę działają Z TEGO SERWERA.
 *
 * Po co osobny skrypt. Wyszukiwanie obrazów zależy od trzech cudzych usług,
 * a każda może odmówić z innego powodu i w innym momencie: DuckDuckGo bywa
 * nieprzyjazny adresom centrów danych, Wikimedia i Openverse mają limity
 * zapytań, a firma hostingowa potrafi mieć własne blokady. Kiedy Marcin pisze
 * „Cosmos nie pokazuje zdjęć", to jest pytanie o TO, i odpowiedzi nie da się
 * udzielić z żadnego innego miejsca niż ten serwer.
 *
 *   node scripts/grafiki.js            — zapytanie domyślne
 *   node scripts/grafiki.js Kraków     — własne zapytanie
 */
const { szukajGrafik } = require('../lib/grafiki.js');

const zapytanie = process.argv.slice(2).join(' ').trim() || 'Kraków Wawel';

(async () => {
  console.log(`Zapytanie: „${zapytanie}"\n`);
  const start = Date.now();
  const w = await szukajGrafik(zapytanie, { limit: 8, timeoutMs: 12000 });
  const ms = Date.now() - start;

  console.log('Źródła:');
  for (const z of w.zrodla) {
    const stan = z.blad ? `✗ ${z.blad}` : (z.ile ? `✓ ${z.ile} obrazów` : '· 0 obrazów (bez błędu)');
    console.log(`  ${z.nazwa.padEnd(12)} ${stan}`);
  }

  console.log(`\nPo scaleniu i odsianiu duplikatów: ${w.results.length} obrazów (${ms} ms)`);
  for (const r of w.results.slice(0, 5)) {
    console.log(`  · [${r.zrodlo}] ${r.title.slice(0, 60) || '(bez tytułu)'}`
      + (r.licencja ? ` — ${r.licencja}` : ''));
  }

  const dziala = w.zrodla.filter((z) => z.ile > 0).length;
  console.log('');
  if (!w.results.length) {
    console.log('✗ ŻADNE źródło nie oddało obrazów. Cosmos w tym stanie nie pokaże zdjęć.');
    console.log('  Sprawdź połączenie z internetem i czy serwer nie siedzi za blokadą wyjścia.');
  } else if (dziala === w.zrodla.length) {
    console.log('✓ Wszystkie źródła działają.');
  } else {
    console.log(`✓ Działa ${dziala} z ${w.zrodla.length} źródeł — to wystarczy, żeby zdjęcia się pokazywały.`);
    console.log('  Zapas jest właśnie po to. Nie trzeba nic robić.');
  }
  process.exit(w.results.length ? 0 : 1);
})();

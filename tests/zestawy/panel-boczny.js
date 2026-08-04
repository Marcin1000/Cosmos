const { srodowisko, przegladarka, maPrzegladarke } = require('../pomoc');
// Po zmianie na JEDEN obszar przewijania stopka jest wysoka z założenia.
// Ważne jest tylko to, czy da się do niej dojechać — o to szła skarga.
(async () => {
  const env = await srodowisko('pelne');
  const ADRES = env.adres;
  if (typeof B !== 'undefined') B = ADRES;
  const b = await przegladarka();
  const p = await b.newPage({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  await p.goto(`${ADRES}`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.getElementById('sidebar').classList.remove('collapsed'));
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const sc = document.querySelector('.sidebar-scroll');
    const senses = document.getElementById('status-senses');
    const bars = [...document.querySelectorAll('#sidebar *')]
      .filter((e) => e.scrollHeight > e.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    sc.scrollTop = sc.scrollHeight;
    const rect = senses.getBoundingClientRect();
    return { obszarow: bars.length, widacZmysly: rect.top >= 0 && rect.bottom <= window.innerHeight };
  });
  console.log(`obszarów przewijania w panelu: ${r.obszarow} (ma być 1)`);
  console.log(`„Zmysły" da się dojechać: ${r.widacZmysly}`);
  await b.close();
  const ok = r.obszarow === 1 && r.widacZmysly;
  console.log(ok ? '\nPANEL BOCZNY OK' : '\nPROBLEM Z PANELEM');
  env.koniec();
  process.exit(ok ? 0 : 1);
})();

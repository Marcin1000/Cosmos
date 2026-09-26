/* ============================================================
   PWA — service worker i pasek „Jest nowa wersja"

   Wydzielone z app.js (propozycja podziału zespołu IT: „pwa.js"). Nowy
   skrypt w public/ to zawsze trzy miejsca naraz: index.html, STATIC_ASSETS
   w sw.js i podniesiona wersja CACHE — inaczej działa u Ciebie, a nie na
   telefonie Marcina.
   ============================================================ */

/**
 * @param {object} z
 * @param {Function} z.t tłumaczenia
 */
function uruchomPwa({ t }) {
  if ('serviceWorker' in navigator) {
    /* Nowa wersja po wdrożeniu. Service worker przejmuje stronę od razu
       (skipWaiting + claim), ale wczytany już kod jest stary — dawniej nowy
       działał dopiero przy DRUGIM otwarciu, bez słowa, a aplikacja otwarta
       w tle nie dowiadywała się o nim wcale. Teraz: sprawdzenie przy powrocie
       do karty i pasek „Jest nowa wersja — Odśwież". Bez przeładowania za
       plecami — w połowie odpowiedzi człowiek straciłby wątek. */
    const bylKontroler = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!bylKontroler || document.getElementById('nowa-wersja')) return;
      const pasek = document.createElement('div');
      pasek.id = 'nowa-wersja';
      pasek.className = 'nowa-wersja';
      pasek.setAttribute('role', 'status');
      const napis = document.createElement('span');
      napis.textContent = t('app.newVersion');
      const przycisk = document.createElement('button');
      przycisk.type = 'button';
      przycisk.textContent = t('app.reload');
      przycisk.addEventListener('click', () => location.reload());
      // „Później" — pasek nie może wisieć, dopóki ktoś nie przeładuje strony.
      const pozniej = document.createElement('button');
      pozniej.type = 'button';
      pozniej.className = 'nowa-wersja-pozniej';
      pozniej.textContent = t('app.later');
      pozniej.addEventListener('click', () => pasek.remove());
      pasek.append(napis, pozniej, przycisk);
      document.body.appendChild(pasek);
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => { /* offline */ });
        });
      }).catch(() => { /* offline dev */ });
    });
  }
}

if (typeof window !== 'undefined') window.uruchomPwa = uruchomPwa;
if (typeof module !== 'undefined') module.exports = { uruchomPwa };

/* Panel kamery MA SIĘ MIEŚCIĆ w oknie — w każdym trybie i na każdej wysokości.
 *
 *  Marcin, po dołożeniu pudełka nastaw: „Nie mieści mi się to teraz na ekranie.
 *  W obu przypadkach nie mogę też scrollować w dół lub w górę." Na zrzutach
 *  widać ucięty nagłówek „KAMERA NA ŻYWO" u góry i ucięty przycisk migawki
 *  na dole — treść wychodziła poza panel, a panel miał `overflow: hidden`,
 *  więc nie było jak do niej dojechać.
 *
 *  Przyczyna była w liczeniu wysokości ze STAŁEJ: szerokość panelu wynikała
 *  z `calc((100dvh - 220px) * 4 / 3)`, gdzie 220 px miało pokryć „nagłówek,
 *  wybór źródła, status i przycisk". Taka stała starzeje się przy pierwszej
 *  nowej rzeczy w panelu, a doszły dwie: pudełko nastaw i status, który przy
 *  wyłączonych zmysłach ma trzy wiersze.
 *
 *  Dlatego ten zestaw nie sprawdza żadnej konkretnej liczby pikseli, tylko
 *  własność, która ma być prawdziwa zawsze: panel mieści się w oknie, nagłówek
 *  jest widoczny, a do przycisku migawki da się dojechać — albo dlatego, że
 *  jest w panelu, albo dlatego, że treść pod obrazem się przewija.
 */
const { srodowisko, przegladarka, maPrzegladarke, KATALOG_ZRZUTOW } = require('../pomoc');

if (!maPrzegladarke()) {
  console.log('⚠ Brak Chromium — pomijam zestaw przeglądarkowy.');
  process.exit(0);
}

/* Cztery okna, w tym dwa niskie. Najciaśniejsze jest 390×640 — telefon,
   na którym pasek adresu i pasek nawigacji zjadły swoje. */
/* Dolne granice szerokości panelu z `public/style.css` — poniżej nich panel
   nie ma już czym ustąpić i dopiero wtedy wolno przewijać dolną część.
   Są trzy, bo panel ma trzy układy, i zestaw musi znać ten sam podział
   co arkusz stylów: w rogu 200 px, powiększony na wąskim ekranie 240 px,
   a powiększony dwukolumnowy (od 900 px szerokości okna) 560 px, bo mieści
   obraz i kolumnę nastaw obok siebie. */
const PODLOGA_ROG = 200;
const PODLOGA_POWIEKSZONY_WASKI = 240;
const PODLOGA_DWIE_KOLUMNY = 560;
/* Przewinięcie o kilka pikseli to zaokrąglenie układu, nie „małe okienko
   przesuwalne". Liczy się dopiero tyle, ile widać. */
const ZNACZACE_PRZEWINIECIE_PX = 24;

const OKNA = [
  ['telefon 390×640', { width: 390, height: 640 }],
  ['telefon 390×844', { width: 390, height: 844 }],
  ['laptop 1440×700', { width: 1440, height: 700 }],
  ['desktop 1440×900', { width: 1440, height: 900 }],
];

/* Poczekaj, aż układ przestanie się ruszać.
 *
 *  Szerokość panelu liczy się z wysokości pasków, a ta z szerokości (teksty
 *  się zawijają), więc po każdej zmianie panel dochodzi do swojego miejsca
 *  przez kilka rund pomiaru. Czekanie „na 400 ms" mierzyło stan w połowie tej
 *  drogi i zgłaszało usterkę, której w gotowym układzie nie ma: panel złapany
 *  przy 311 px, choć docelowo schodzi do 200 px. To ten sam błąd, co mierzenie
 *  czasem zamiast warunkiem — wynik zależy wtedy od obciążenia maszyny,
 *  a nie od kodu.
 *
 *  @param {object} pg strona Playwrighta
 */
async function poczekajNaUklad(pg) {
  let poprzednie = null;
  for (let i = 0; i < 40; i++) {
    const teraz = await pg.evaluate(() => {
      const p = document.getElementById('live-panel');
      return `${Math.round(p.getBoundingClientRect().width)}|`
        + p.style.getPropertyValue('--live-chrome');
    });
    if (teraz === poprzednie) return;
    poprzednie = teraz;
    await pg.waitForTimeout(50);
  }
}

(async () => {
  const fail = [];
  const env = await srodowisko('zmysly');
  // Bez współrzędnych pudełko nastaw się nie pokaże, a o nie tu chodzi.
  await fetch(`${env.adres}/api/location`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: 'Złotokłos', lat: 52.0247, lon: 20.9019 }),
  }).catch(() => {});

  /* Kamera z atrapy: bez niej podgląd kończy się błędem „nie znaleziono
     urządzenia", pudełko nastaw się nie wypełnia i zestaw mierzyłby panel
     w stanie, w którym nikt go nie ogląda. */
  const br = await przegladarka({ args: [
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  ] });

  for (const [nazwa, viewport] of OKNA) {
    const ctx = await br.newContext({ viewport, permissions: ['camera'] });
    const pg = await ctx.newPage();
    await pg.goto(env.adres, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1500);
    await pg.click('#live-btn');
    await pg.waitForTimeout(2500);

    const sprawdz = async (tryb, podloga = PODLOGA_ROG) => {
      await poczekajNaUklad(pg);
      const r = await pg.evaluate(() => {
        const panel = document.getElementById('live-panel');
        const przycisk = document.getElementById('live-snapshot');
        const glowa = document.querySelector('.live-head');
        const body = document.getElementById('live-body');
        const scena = document.getElementById('live-stage');
        const pr = panel.getBoundingClientRect();
        return {
          panel: Math.round(pr.height),
          panelW: Math.round(pr.width),
          okno: window.innerHeight,
          gora: Math.round(pr.top),
          glowaWidoczna: glowa.getBoundingClientRect().top >= -1,
          przyciskWPanelu: przycisk.getBoundingClientRect().bottom <= pr.bottom + 1,
          // `overflow-y: auto` sam nie wystarczy — treść musi się DAĆ przewinąć.
          przewija: Boolean(body) && body.scrollHeight > body.clientHeight + 1,
          ileNiemiesci: body ? body.scrollHeight - body.clientHeight : 0,
          przewijalny: body ? getComputedStyle(body).overflowY : 'brak elementu',
          scena: scena ? Math.round(scena.getBoundingClientRect().height) : -1,
          /* Proporcja SCENY kontra proporcja, o którą poprosiliśmy. Rozjazd
             znaczy czarne pasy — bo obraz mieści się w scenie wpisanej
             w inny kształt niż on sam. */
          scenaProp: scena
            ? scena.getBoundingClientRect().width / scena.getBoundingClientRect().height : 0,
          zadanaProp: Number(getComputedStyle(panel).getPropertyValue('--live-arn')) || 0,
        };
      });
      const miesci = r.panel <= r.okno && r.gora >= -1 && r.glowaWidoczna;
      const dojedzie = r.przyciskWPanelu || r.przewija;
      console.log(`   ${tryb}: panel ${r.panel}/${r.okno} px, obraz ${r.scena} px, `
        + `mieści się: ${miesci}, przycisk osiągalny: ${dojedzie}`);
      if (!miesci) {
        fail.push(`${nazwa} / ${tryb}: panel ${r.panel} px nie mieści się w oknie ${r.okno} px`
          + `${r.glowaWidoczna ? '' : ', nagłówek ucięty u góry'}`);
      }
      if (!dojedzie) {
        fail.push(`${nazwa} / ${tryb}: nie da się dojechać do przycisku migawki `
          + `(poza panelem, a treść się nie przewija — overflow: ${r.przewijalny})`);
      }
      // Obraz nie może zniknąć do zera przy ciasnocie — to już nie jest podgląd.
      if (r.scena >= 0 && r.scena < 100) {
        fail.push(`${nazwa} / ${tryb}: obraz skurczył się do ${r.scena} px`);
      }
      /* DUŻY PODGLĄD NIE MOŻE BYĆ OKUPIONY MAŁYM OKIENKIEM POD NIM.
       *
       *  Marcin: „okno podglądu jest duże, a pod nim małe okienko przesuwalne.
       *  To nie wygląda dobrze i nie jest użyteczne. Źle to wygląda."
       *
       *  Poprzednia wersja tego zestawu przepuszczała ten stan bez słowa,
       *  bo pytała tylko „czy panel się mieści" i „czy da się dojechać do
       *  migawki" — a na jedno i drugie ścisnięty pasek przewijania odpowiada
       *  TAK. Zestaw był zielony przy układzie, który użytkownik nazwał
       *  zepsutym; to gorsze niż brak zestawu, bo daje spokój bez pokrycia.
       *
       *  Zasada jest o KOLEJNOŚCI USTĘPOWANIA: gdy brakuje miejsca, najpierw
       *  zwęża się panel (a z nim obraz), i dopiero gdy panel jest już
       *  najwęższy jak można, wolno zwinąć dół w przewijalny pasek.
       *
       *  Sprawdzamy to przez szerokość panelu, a nie przez wysokość obrazu.
       *  Pierwsza wersja pytała „czy obraz ma ponad 260 px" — próg wzięty
       *  z sufitu, który przy kadrze pionowym znaczył co innego niż przy
       *  poziomym. Szerokość jest jednoznaczna: albo panel dobił do swojej
       *  dolnej granicy i naprawdę nie ma czym ustąpić, albo nie dobił
       *  i przewijanie jest przedwczesne. */
      if (r.ileNiemiesci > ZNACZACE_PRZEWINIECIE_PX && r.panelW > podloga + 10) {
        fail.push(`${nazwa} / ${tryb}: dół nie mieści się o ${r.ileNiemiesci} px, `
          + `choć panel ma ${r.panelW} px szerokości i mógł się zwęzić do ${podloga} px `
          + '— to jest „duże okno podglądu, a pod nim małe okienko przesuwalne"');
      }
      /* SCENA MA TRZYMAĆ PROPORCJĘ KADRU.
       *
       *  Marcin, ze zrzutu z telefonu: wąski pasek obrazu pośrodku i czarne
       *  pasy zajmujące 68% szerokości panelu. Scena była wpisana w kształt
       *  inny niż kadr, więc obraz mieścił się w niej z ogromnym marginesem.
       *
       *  Przyczyną była DOLNA GRANICA szerokości panelu: kadr 9:16 dzieli
       *  dostępną wysokość przez 0,5625, więc wyliczona szerokość schodziła
       *  poniżej 200 px, granica ją podnosiła, a wtedy scena chciała być
       *  wyższa niż zostało miejsca — i ścinał ją sufit wysokości, łamiąc
       *  proporcję. Każdy krok z osobna był rozsądny; razem dały pasek obrazu.
       *
       *  Zestaw pilnował wcześniej wysokości i przewijania, ale nigdy KSZTAŁTU,
       *  więc przepuszczał to bez słowa. */
      if (r.zadanaProp && r.scenaProp) {
        const rozjazd = Math.abs(r.scenaProp - r.zadanaProp) / r.zadanaProp;
        const pasy = Math.round(rozjazd * 100);
        if (rozjazd > 0.05) {
          fail.push(`${nazwa} / ${tryb}: scena ma proporcję ${r.scenaProp.toFixed(2)} `
            + `zamiast ${r.zadanaProp.toFixed(2)} — kadr dostanie czarne pasy (~${pasy}%)`);
        }
      }
    };

    console.log(`\n${nazwa}`);
    await sprawdz('nastawy zwinięte');
    await pg.evaluate(() => { document.getElementById('plan-box').open = true; });
    await pg.waitForTimeout(400);
    await sprawdz('nastawy rozwinięte');
    await pg.click('#live-expand');
    await pg.waitForTimeout(600);
    await sprawdz('powiększony + rozwinięte', (viewport.width >= 900 ? PODLOGA_DWIE_KOLUMNY : PODLOGA_POWIEKSZONY_WASKI));

    /* KADR PIONOWY — telefon trzymany normalnie. Atrapa kamery w Chromium
       jest pozioma, więc proporcję podstawiamy ręcznie; inaczej ten zestaw
       nigdy nie zobaczyłby przypadku, w którym panel realnie się rozjeżdżał.
       Przy 340 px szerokości kadr 9:16 daje scenę wysoką na 604 px, czyli
       więcej, niż zostaje na telefonie po paskach przeglądarki. */
    await pg.evaluate(() => {
      /* Bez tego pomiar jest loteryjny: `liveDetect` chodzi co trzy sekundy
         i przy każdym takcie wpisuje proporcję PRAWDZIWEJ atrapy kamery
         (16:9), kasując tę, którą tu podstawiamy. Zestaw mierzyłby wtedy raz
         kadr pionowy, a raz poziomy, zależnie od tego, gdzie akurat trafi. */
      clearInterval(liveTimer); liveTimer = null;
      const panel = document.getElementById('live-panel');
      panel.style.setProperty('--live-ar', '9 / 16');
      panel.style.setProperty('--live-arn', String(9 / 16));
      dopasujPanelKamery();
    });
    await pg.waitForTimeout(400);
    await sprawdz('pionowy kadr 9:16', (viewport.width >= 900 ? PODLOGA_DWIE_KOLUMNY : PODLOGA_POWIEKSZONY_WASKI));
    await pg.click('#live-expand');            // z powrotem do rogu
    await pg.waitForTimeout(500);
    await sprawdz('pionowy kadr w rogu');
    if (viewport.height === 640) {
      await pg.screenshot({ path: `${KATALOG_ZRZUTOW}/kamera-390x640.png` });
    }
    await ctx.close();
  }

  await br.close();
  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nPANEL KAMERY MIEŚCI SIĘ OK');
  process.exit(fail.length ? 1 : 0);
})();

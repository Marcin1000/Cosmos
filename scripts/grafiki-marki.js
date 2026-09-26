#!/usr/bin/env node
/* Grafiki marki Cosmosa z jednego źródła — README i serwisy społecznościowe.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node scripts/zrzuty-readme.js   # najpierw zrzuty
 *   NODE_PATH=/opt/node22/lib/node_modules node scripts/grafiki-marki.js
 *
 * Kierunek „Jeden wątek”, ten sam co strona produktowa i aplikacja: jasne tło
 * #F6F5F1 (ciemne #111214), Onest i Martian Mono, kolor mają tylko silniki
 * (NVIDIA, lokalny GPU, Claude, OpenAI), a znak — planeta z pierścieniem
 * z czterech łuków — pochodzi ze scripts/ikony.js, nie z kopii.
 *
 * Grafiki to strony HTML renderowane przez Chromium: prawdziwe czcionki,
 * prawdziwe zrzuty aplikacji w środku (docs/obrazy/, robi je
 * scripts/zrzuty-readme.js). Czcionki osadzamy w stronie, bo obrazek SVG
 * w README na GitHubie nie wczyta żadnej czcionki z zewnątrz.
 *
 * Wynik:
 *   docs/obrazy/  — banner i schemat architektury (EN/PL × jasny/ciemny) do README,
 *   docs/grafiki/ — LinkedIn (post, kwadrat, pion, baner profilu), GitHub (podgląd
 *                   repozytorium), X, relacja 9:16 — po polsku i po angielsku.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { znak, JASNE, CIEMNE } = require('./ikony.js');

const KORZEN = path.join(__dirname, '..');
const OBRAZY = path.join(KORZEN, 'docs', 'obrazy');
const GRAFIKI = path.join(KORZEN, 'docs', 'grafiki');
const CHROMIUM = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

const czcionka = (plik) => `data:font/woff2;base64,${fs.readFileSync(path.join(KORZEN, 'public', 'fonts', plik)).toString('base64')}`;
const CZCIONKI = `
@font-face{font-family:Onest;font-weight:300 700;src:url(${czcionka('Onest-latin.woff2')}) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212}
@font-face{font-family:Onest;font-weight:300 700;src:url(${czcionka('Onest-latin-ext.woff2')}) format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F}
@font-face{font-family:'Martian Mono';font-weight:300 700;src:url(${czcionka('MartianMono-latin.woff2')}) format('woff2');unicode-range:U+0000-00FF,U+2000-206F}
@font-face{font-family:'Martian Mono';font-weight:300 700;src:url(${czcionka('MartianMono-latin-ext.woff2')}) format('woff2');unicode-range:U+0100-02BA,U+1E00-1E9F}`;

const plikUrl = (p) => `file://${p}`;

/* ------------------------------------------------------------------ teksty */
const T = {
  pl: {
    h1: 'Jedna rozmowa.', h2: 'Każdy model.',
    sub: 'Osobisty, hybrydowy system AI.',
    lead: 'Chmura NVIDIA, lokalna karta graficzna, Claude i OpenAI w jednym wątku — z tą samą pamięcią, narzędziami i kontekstem.',
    leadKrotki: 'Chmura NVIDIA, lokalny GPU, Claude i OpenAI w jednej rozmowie.',
    fakty: ['Zero zależności npm', 'Ponad 100 zestawów testów', 'Aplikacja na telefon'],
    gpu: 'GPU', lokalnyGpu: 'Lokalny GPU',
    urywki: ['Złota godzina zaczyna się o 06:47…', 'RF 70-200 f/4 — stań dalej od krawędzi…', 'Na odbicie f/8, 1/125 s, ISO 400…', 'Najnowsze 10 z 311 znad jeziora…'],
    arch: {
      tytul: 'Architektura', warstwy: ['WNIOSKOWANIE', 'ROZDZIAŁ', 'NARZĘDZIA', 'KRAWĘDŹ'],
      gpu: 'Lokalny GPU', gpuTresc: 'Ollama · vLLM · modele wizyjne · Whisper · YOLO', gpuPod: 'prywatnie · bez opłat za tokeny · komputer musi działać',
      chmura: 'Chmura', chmuraTresc: 'NVIDIA · OpenAI · Anthropic', chmuraPod: 'zawsze dostępna · większe modele · płatna za użycie',
      przelacznik: 'jeden przełącznik, ta sama rozmowa',
      rozdzial: 'Warstwa multimodalna', rozdzialTresc: 'tekst · obrazy · dźwięk · dokumenty — kierowane do silnika, który umie je odczytać; kontekst składany przed każdą odpowiedzią',
      narzedzia: 'Kaskada narzędzi i mostek MCP', narzedziaTresc: 'wyszukiwanie · zdjęcia miejsc · własne archiwum · plan zdjęciowy · Studio · kod',
      narzedziaPod: 'jedna umowa na narzędzie · do czterech rund w turze · każdy wynik wraca do modelu',
      krawedz: [['Interfejsy', 'PWA · pulpit · głos', 'działa offline, wraca w pół odpowiedzi'],
        ['Zmysły', 'kamera · Kinect · mikrofon', 'osobny proces na osobnej maszynie'],
        ['Sprzęt', 'Canon CCAPI · misje DJI', 'odczyt i zapis nastaw']],
    },
  },
  en: {
    h1: 'One thread.', h2: 'Every engine.',
    sub: 'A personal, hybrid AI system.',
    lead: 'NVIDIA’s cloud, a local GPU, Claude and OpenAI in one conversation — same memory, same tools, same context.',
    leadKrotki: 'NVIDIA’s cloud, a local GPU, Claude and OpenAI in one conversation.',
    fakty: ['Zero npm dependencies', '100+ behaviour test suites', 'Installable phone app'],
    gpu: 'GPU', lokalnyGpu: 'Local GPU',
    urywki: ['Golden hour starts at 06:47…', 'RF 70-200 f/4 — stay back from the edge…', 'For the reflection: f/8, 1/125 s, ISO 400…', 'The newest 10 of 311 from the lake…'],
    arch: {
      tytul: 'Architecture', warstwy: ['INFERENCE', 'ROUTING', 'TOOLS', 'EDGE'],
      gpu: 'Local GPU', gpuTresc: 'Ollama · vLLM · vision models · Whisper · YOLO', gpuPod: 'private · no per-token cost · needs the box on',
      chmura: 'Cloud APIs', chmuraTresc: 'NVIDIA · OpenAI · Anthropic', chmuraPod: 'always up · larger models · metered',
      przelacznik: 'one switch, same conversation',
      rozdzial: 'Multimodal layer', rozdzialTresc: 'text · images · audio · documents — routed to whichever engine can read them; context assembled before every answer',
      narzedzia: 'Tool cascade & MCP bridge', narzedziaTresc: 'web search · place photos · own photo archive · shoot planner · Studio · code',
      narzedziaPod: 'one contract per tool · up to four rounds per turn · every result goes back to the model',
      krawedz: [['Interfaces', 'PWA · desktop · voice', 'works offline, resumes mid-answer'],
        ['Sensors', 'camera · Kinect · microphone', 'separate process, separate machine'],
        ['Hardware', 'Canon CCAPI · DJI missions', 'read settings, write settings']],
    },
  },
};

/* ---------------------------------------------------------------- motywy */
const MOTYW = {
  jasny: {
    tlo: '#F6F5F1', karta: '#FFFFFF', tekst: '#16171B', przyg: '#5E616B', blady: '#686B75', linia: '#E3E1DA',
    k: { nvidia: '#5E9E3A', gpu: '#2F6FEB', claude: '#C8643B', openai: '#16171B' },
    gradient: 'linear-gradient(95deg,#5E9E3A 0%,#2F6FEB 44%,#7B5CC4 66%,#C8643B 92%)',
    aura: ['rgba(94,158,58,.20)', 'rgba(47,111,235,.16)', 'rgba(200,100,59,.16)'],
    cien: '0 24px 60px rgba(22,23,27,.14), 0 2px 8px rgba(22,23,27,.06)',
    znak: () => znak({ kolory: JASNE, planeta: '#16171B', szczelina: '#F6F5F1', id: 'zj' }),
  },
  ciemny: {
    tlo: '#111214', karta: '#1A1B1F', tekst: '#ECEBE6', przyg: '#A3A5AD', blady: '#8A8D96', linia: '#2A2B30',
    k: { nvidia: '#76B84F', gpu: '#5B8FF5', claude: '#DE7A51', openai: '#ECEBE6' },
    gradient: 'linear-gradient(95deg,#76B84F 0%,#5B8FF5 44%,#9C7FE0 66%,#DE7A51 92%)',
    aura: ['rgba(118,184,79,.16)', 'rgba(91,143,245,.15)', 'rgba(222,122,81,.13)'],
    cien: '0 24px 60px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3)',
    znak: () => znak({ kolory: CIEMNE, planeta: '#ECEBE6', szczelina: '#111214', id: 'zc' }),
  },
};

/* Wspólny arkusz: zmienne motywu, znak, nagłówek z gradientem silników, chipy,
   okno przeglądarki i telefon ze zrzutem w środku. */
function arkusz(m) {
  return `${CZCIONKI}
  :root{--tlo:${m.tlo};--karta:${m.karta};--tekst:${m.tekst};--przyg:${m.przyg};--blady:${m.blady};--linia:${m.linia};
    --nvidia:${m.k.nvidia};--gpu:${m.k.gpu};--claude:${m.k.claude};--openai:${m.k.openai};--gradient:${m.gradient};--cien:${m.cien}}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{background:var(--tlo);color:var(--tekst);font-family:Onest,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
  .scena{position:relative;overflow:hidden;background:var(--tlo)}
  .aura{position:absolute;border-radius:50%;pointer-events:none}
  .marka{display:flex;align-items:center;gap:.55em;font-weight:600;letter-spacing:.34em;font-size:var(--rm,18px)}
  .marka svg{width:1.9em;height:1.9em;flex:none;overflow:visible}
  .h{font-weight:600;letter-spacing:-.045em;line-height:.98}
  .h em{font-style:normal;background:var(--gradient);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:.04em}
  .sub{color:var(--przyg);letter-spacing:-.01em;line-height:1.35}
  .chipy{display:flex;flex-wrap:wrap;gap:.5em}
  .chip{display:inline-flex;align-items:center;gap:.55em;font:500 1em/1 'Martian Mono',monospace;color:var(--tekst);
    background:var(--karta);border:1px solid var(--linia);border-radius:999px;padding:.62em .95em .62em .8em;white-space:nowrap}
  .chip i{width:.6em;height:.6em;border-radius:50%;background:var(--k);flex:none}
  .fakty{display:flex;flex-wrap:wrap;gap:.4em 1.4em;color:var(--przyg);font:500 1em/1.2 'Martian Mono',monospace;letter-spacing:-.01em}
  .fakty span+span::before{content:'·';margin-right:1.4em;color:var(--blady)}
  .adres{font:500 1em/1 'Martian Mono',monospace;color:var(--przyg)}
  .okno{background:var(--karta);border:1px solid var(--linia);border-radius:14px;box-shadow:var(--cien);overflow:hidden}
  .okno .pasek{height:30px;display:flex;align-items:center;gap:7px;padding:0 14px;border-bottom:1px solid var(--linia)}
  .okno .pasek i{width:10px;height:10px;border-radius:50%;background:var(--linia)}
  .okno img{display:block;width:100%}
  .tel{background:#16171B;border-radius:46px;padding:11px;box-shadow:var(--cien)}
  .tel img{display:block;width:100%;border-radius:36px}
  .nic{position:relative;padding-left:22px}
  .nic::before{content:'';position:absolute;left:0;top:4px;bottom:4px;width:3px;border-radius:3px;
    background:linear-gradient(var(--nvidia) 0 25%,var(--gpu) 25% 50%,var(--claude) 50% 75%,var(--openai) 75% 100%)}`;
}

function aura(m, w, h, uklad = 'szeroki') {
  // Trzy miękkie plamy: zieleń u góry, błękit z prawej, pomarańcz u dołu — jak og.jpg strony.
  const r = Math.max(w, h);
  const plamy = uklad === 'wysoki'
    ? [[0.82, 0.06, 0.62, 0], [1.02, 0.46, 0.70, 1], [0.05, 0.96, 0.66, 2]]
    : [[0.66, -0.20, 0.52, 0], [1.00, 0.52, 0.55, 1], [0.12, 1.10, 0.50, 2]];
  return plamy.map(([x, y, s, k]) => {
    const d = r * s;
    return `<div class="aura" style="left:${x * w - d / 2}px;top:${y * h - d / 2}px;width:${d}px;height:${d}px;`
      + `background:radial-gradient(circle,${m.aura[k]} 0%,transparent 68%)"></div>`;
  }).join('');
}

const chipySilnikow = (j) => `<div class="chipy">`
  + `<span class="chip" style="--k:var(--nvidia)"><i></i>NVIDIA</span>`
  + `<span class="chip" style="--k:var(--gpu)"><i></i>${T[j].gpu}</span>`
  + `<span class="chip" style="--k:var(--claude)"><i></i>Claude</span>`
  + `<span class="chip" style="--k:var(--openai)"><i></i>OpenAI</span></div>`;

const marka = (m, rozmiar) => `<div class="marka" style="--rm:${rozmiar}px">${`<svg viewBox="0 0 40 40">${m.znak()}</svg>`}<span>COSMOS</span></div>`;
const naglowek = (j, rozmiar, styl = '') => `<h1 class="h" style="font-size:${rozmiar}px;${styl}">${T[j].h1}<br><em>${T[j].h2}</em></h1>`;
const fakty = (j, rozmiar) => `<div class="fakty" style="font-size:${rozmiar}px">${T[j].fakty.map((f) => `<span>${f}</span>`).join('')}</div>`;

/* Wątek na banerze: jedna nić, cztery silniki, każdy ze swoim podpisem — tak
   wygląda rozmowa w aplikacji. */
function watekMini(j, skala = 1) {
  const wiersz = (k, nazwa, model, urywek) => `<div style="padding:${7 * skala}px 0">
    <div style="display:flex;align-items:baseline;gap:${9 * skala}px">
      <span style="font:600 ${13.5 * skala}px/1 Onest;color:var(--${k === 'openai' ? 'tekst' : k})">${nazwa}</span>
      <span style="font:500 ${10.5 * skala}px/1 'Martian Mono';color:var(--blady)">${model}</span></div>
    <div style="margin-top:${5 * skala}px;font:400 ${12.5 * skala}px/1.3 Onest;color:var(--przyg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${urywek}</div></div>`;
  const u = T[j].urywki;
  return `<div class="nic" style="padding-left:${20 * skala}px">
    ${wiersz('nvidia', 'NVIDIA', 'nemotron-3-super', u[0])}
    ${wiersz('gpu', T[j].lokalnyGpu, 'qwen3:14b', u[1])}
    ${wiersz('claude', 'Claude', 'claude-sonnet-5', u[2])}
    ${wiersz('openai', 'OpenAI', 'gpt-4o', u[3])}</div>`;
}

/* ----------------------------------------------------------- szablony */

function banner(j, m) {
  const W = 880, H = 220;
  return { w: W, h: H, html: `<div class="scena" style="width:${W}px;height:${H}px">${aura(m, W, H)}
    <div style="position:absolute;left:44px;top:34px">${marka(m, 13)}</div>
    <div style="position:absolute;left:44px;top:74px">${naglowek(j, 44)}
      <p class="sub" style="font-size:15px;margin-top:14px">${T[j].sub}</p></div>
    <div style="position:absolute;right:44px;top:50%;transform:translateY(-50%);width:360px">${watekMini(j)}</div>
  </div>` };
}

function architektura(j, m) {
  const A = T[j].arch;
  const W = 900, H = 'auto';
  const etykieta = (i) => `<div style="font:500 11px/1 'Martian Mono';letter-spacing:.08em;color:var(--blady);width:142px;flex:none;white-space:nowrap;padding-top:18px">0${i + 1} · ${A.warstwy[i]}</div>`;
  const karta = (tytul, tresc, pod, kolory = [], styl = '') => `<div style="flex:1;background:var(--karta);border:1px solid var(--linia);border-radius:14px;padding:14px 16px;${styl}">
      <div style="display:flex;align-items:center;gap:8px;font:600 15px/1.2 Onest;letter-spacing:-.01em">${kolory.map((k) => `<i style="width:8px;height:8px;border-radius:50%;background:var(--${k})"></i>`).join('')}${tytul}</div>
      <div style="margin-top:6px;font:400 13px/1.45 Onest;color:var(--tekst)">${tresc}</div>
      ${pod ? `<div style="margin-top:6px;font:500 10.5px/1.4 'Martian Mono';color:var(--blady)">${pod}</div>` : ''}</div>`;
  const wiersz = (i, tresc) => `<div style="display:flex;gap:14px;align-items:stretch">${etykieta(i)}<div style="flex:1;display:flex;gap:12px;align-items:stretch">${tresc}</div></div>`;
  /* Nić neutralna: kolor mają tylko silniki (kropki przy backendach) —
     kolorowe warstwy sugerowałyby, że routing jest „niebieski", a narzędzia „Claude'a". */
  return { w: W, h: H, html: `<div class="scena" style="width:${W}px;padding:28px 34px">
    <div style="display:flex;flex-direction:column;gap:14px;position:relative">
      <div style="position:absolute;left:162px;top:0;bottom:0;width:2px;border-radius:2px;background:var(--linia)"></div>
      ${wiersz(0, karta(A.gpu, A.gpuTresc, A.gpuPod, ['gpu'], 'margin-left:14px')
        + `<div style="display:flex;flex-direction:column;justify-content:center;align-items:center;width:86px;gap:6px;text-align:center">
             <span style="font:500 18px/1 Onest;color:var(--przyg)">⇄</span>
             <span style="font:500 9.5px/1.35 'Martian Mono';color:var(--blady)">${A.przelacznik}</span></div>`
        + karta(A.chmura, A.chmuraTresc, A.chmuraPod, ['nvidia', 'claude', 'openai']))}
      ${wiersz(1, karta(A.rozdzial, A.rozdzialTresc, '', [], 'margin-left:14px'))}
      ${wiersz(2, karta(A.narzedzia, A.narzedziaTresc, A.narzedziaPod, [], 'margin-left:14px'))}
      ${wiersz(3, A.krawedz.map(([t, c, p], i) => karta(t, c, p, [], i === 0 ? 'margin-left:14px' : '')).join(''))}
    </div></div>` };
}

/* Serwisy społecznościowe. `w`, `h` — rozmiary zalecane przez serwisy. */
function spolecznosc(rodzaj, j, m) {
  // Rozmowa na pulpicie ma wersję ciemną — ciemna grafika dostaje ciemne okno.
  const ciemny = m === MOTYW.ciemny;
  const zrzut = (nazwa) => plikUrl(path.join(OBRAZY, `${nazwa}-${j}${ciemny && nazwa === 'rozmowa' ? '-ciemny' : ''}.png`));
  const okno = (nazwa, szer, styl = '') => `<div class="okno" style="width:${szer}px;${styl}"><div class="pasek"><i></i><i></i><i></i></div><img src="${zrzut(nazwa)}"></div>`;
  const tel = (szer, styl = '', nazwa = 'telefon') => `<div class="tel" style="width:${szer}px;${styl}"><img src="${zrzut(nazwa)}"></div>`;

  if (rodzaj === 'linkedin-post') {                 // 1200×627 — post z obrazem i udostępniony link
    const W = 1200, H = 627;
    return { w: W, h: H, html: `<div class="scena" style="width:${W}px;height:${H}px">${aura(m, W, H)}
      <div style="position:absolute;left:72px;top:64px">${marka(m, 17)}</div>
      <div style="position:absolute;left:72px;top:172px;width:560px">${naglowek(j, 76)}
        <p class="sub" style="font-size:21px;margin-top:22px;max-width:500px">${T[j].leadKrotki}</p></div>
      <div style="position:absolute;left:72px;bottom:62px;font-size:14px">${chipySilnikow(j)}</div>
      ${okno('rozmowa', 760, 'position:absolute;left:668px;top:84px')}
    </div>` };
  }
  if (rodzaj === 'linkedin-kwadrat') {              // 1080×1080 — post, także Instagram i Facebook
    const W = 1080, H = 1080;
    return { w: W, h: H, html: `<div class="scena" style="width:${W}px;height:${H}px">${aura(m, W, H, 'wysoki')}
      <div style="position:absolute;left:84px;top:84px">${marka(m, 20)}</div>
      <div style="position:absolute;left:84px;top:196px">${naglowek(j, 78)}
        <p class="sub" style="font-size:24px;margin-top:24px;max-width:430px">${T[j].leadKrotki}</p></div>
      <div style="position:absolute;left:84px;bottom:84px;font-size:16px">${chipySilnikow(j)}</div>
      ${tel(336, 'position:absolute;right:76px;top:236px;transform:rotate(2deg)')}
    </div>` };
  }
  if (rodzaj === 'linkedin-pion') {                 // 1080×1350 — pionowy post (4:5), najwięcej miejsca w strumieniu
    /* Okno o szerokości 880 px mieści całą rozmowę aż do odpowiedzi Claude'a —
       to ona jest puentą („zmiana silnika w tym samym wątku"). Szersze okno
       ucinało ją w pół. */
    const W = 1080, H = 1350;
    return { w: W, h: H, html: `<div class="scena" style="width:${W}px;height:${H}px">${aura(m, W, H, 'wysoki')}
      <div style="position:absolute;left:84px;top:84px">${marka(m, 20)}</div>
      <div style="position:absolute;left:84px;top:172px">${naglowek(j, 96)}
        <p class="sub" style="font-size:25px;margin-top:24px;max-width:880px">${T[j].lead}</p></div>
      <div style="position:absolute;left:100px;top:548px;height:672px;overflow:hidden;border-radius:14px">
        ${okno('rozmowa', 880, '')}</div>
      <div style="position:absolute;left:100px;width:880px;top:1170px;height:50px;background:linear-gradient(transparent,var(--tlo))"></div>
      <div style="position:absolute;left:84px;right:84px;bottom:66px;display:flex;justify-content:space-between;align-items:center;gap:40px">
        ${fakty(j, 14)}<span class="adres" style="font-size:16px;white-space:nowrap">cosmosai.live</span></div>
    </div>` };
  }
  if (rodzaj === 'linkedin-baner') {                // 1584×396 — tło profilu; lewy dół zasłania zdjęcie profilowe
    const W = 1584, H = 396;
    return { w: W, h: H, html: `<div class="scena" style="width:${W}px;height:${H}px">${aura(m, W, H)}
      <div style="position:absolute;right:96px;top:74px;text-align:right;display:flex;flex-direction:column;align-items:flex-end">
        ${marka(m, 16)}
        <div style="margin-top:26px">${naglowek(j, 62, 'text-align:right')}</div>
        <p class="sub" style="margin-top:22px;font-size:17px">${T[j].sub} <span class="adres" style="font-size:15px;margin-left:10px">cosmosai.live</span></p></div>
      <div style="position:absolute;left:560px;top:96px;width:400px;opacity:.95">${watekMini(j, 1.1)}</div>
    </div>` };
  }
  if (rodzaj === 'github') {                        // 1280×640 — podgląd repozytorium (Settings → Social preview)
    const W = 1280, H = 640;
    return { w: W, h: H, html: `<div class="scena" style="width:${W}px;height:${H}px">${aura(m, W, H)}
      <div style="position:absolute;left:80px;top:72px">${marka(m, 17)}</div>
      <div style="position:absolute;left:80px;top:170px;width:560px">${naglowek(j, 78)}
        <p class="sub" style="font-size:21px;margin-top:22px;max-width:500px">${T[j].leadKrotki}</p></div>
      <div style="position:absolute;left:80px;bottom:70px">${fakty(j, 14)}
        <div class="adres" style="font-size:15px;margin-top:16px">github.com/Marcin1000/Cosmos</div></div>
      ${okno('rozmowa', 800, 'position:absolute;left:700px;top:96px')}
    </div>` };
  }
  if (rodzaj === 'x') {                             // 1600×900 — X/Twitter, także slajd 16:9
    const W = 1600, H = 900;
    return { w: W, h: H, html: `<div class="scena" style="width:${W}px;height:${H}px">${aura(m, W, H)}
      <div style="position:absolute;left:96px;top:88px">${marka(m, 20)}</div>
      <div style="position:absolute;left:96px;top:236px;width:700px">${naglowek(j, 100)}
        <p class="sub" style="font-size:27px;margin-top:28px;max-width:640px">${T[j].lead}</p></div>
      <div style="position:absolute;left:96px;bottom:92px;font-size:17px">${chipySilnikow(j)}</div>
      ${okno('rozmowa', 900, 'position:absolute;left:860px;top:150px')}
    </div>` };
  }
  if (rodzaj === 'relacja') {                       // 1080×1920 — relacja/story (Instagram, LinkedIn na telefonie)
    const W = 1080, H = 1920;
    return { w: W, h: H, html: `<div class="scena" style="width:${W}px;height:${H}px">${aura(m, W, H, 'wysoki')}
      <div style="position:absolute;left:0;right:0;top:170px;display:flex;justify-content:center">${marka(m, 22)}</div>
      <div style="position:absolute;left:0;right:0;top:300px;text-align:center">${naglowek(j, 112, 'text-align:center')}
        <p class="sub" style="font-size:30px;margin:30px auto 0;max-width:800px">${T[j].leadKrotki}</p></div>
      ${tel(430, 'position:absolute;left:325px;top:690px')}
      <div style="position:absolute;left:0;right:0;bottom:136px;display:flex;justify-content:center;font-size:18px">${chipySilnikow(j)}</div>
      <div style="position:absolute;left:0;right:0;bottom:76px;text-align:center" class="adres"><span style="font-size:20px">cosmosai.live</span></div>
    </div>` };
  }
  throw new Error(`nieznany rodzaj: ${rodzaj}`);
}

/* ------------------------------------------------------------- render */
(async () => {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    console.error('Brak Playwrighta — uruchom z NODE_PATH=/opt/node22/lib/node_modules.');
    process.exit(1);
  }
  for (const n of ['rozmowa-pl', 'rozmowa-en', 'telefon-pl', 'telefon-en']) {
    if (!fs.existsSync(path.join(OBRAZY, `${n}.png`))) {
      console.error(`Brak docs/obrazy/${n}.png — najpierw: node scripts/zrzuty-readme.js`);
      process.exit(1);
    }
  }
  fs.mkdirSync(GRAFIKI, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-grafiki-'));
  const br = await chromium.launch({ executablePath: CHROMIUM });

  async function renderuj({ w, h, html }, motyw, plik, { skala = 1, jpeg = false } = {}) {
    const m = MOTYW[motyw];
    const strona = path.join(tmp, 'g.html');
    fs.writeFileSync(strona, `<!doctype html><meta charset="utf-8"><style>${arkusz(m)}</style>${html}`);
    const ctx = await br.newContext({ viewport: { width: w, height: h === 'auto' ? 1200 : h }, deviceScaleFactor: skala });
    const pg = await ctx.newPage();
    await pg.goto(plikUrl(strona), { waitUntil: 'load' });
    await pg.evaluate(() => document.fonts.ready);
    await pg.waitForTimeout(150);
    // 'auto' — wysokość z treści (schemat), zaokrąglona w górę do pełnego piksela.
    const wys = h === 'auto' ? await pg.evaluate(() => Math.ceil(document.querySelector('.scena').getBoundingClientRect().height)) : h;
    await pg.screenshot({ path: plik, clip: { x: 0, y: 0, width: w, height: wys }, ...(jpeg ? { type: 'jpeg', quality: 92 } : {}) });
    await ctx.close();
    console.log(`  ✓ ${path.relative(KORZEN, plik)} — ${Math.round(fs.statSync(plik).size / 1024)} KB`);
  }

  console.log('README');
  for (const j of ['en', 'pl']) {
    for (const [motyw, przyrostek] of [['jasny', ''], ['ciemny', '-ciemny']]) {
      // JPEG: miękkie plamy koloru w tle dawały PNG po 330 KB.
      await renderuj(banner(j, MOTYW[motyw]), motyw, path.join(OBRAZY, `banner-${j}${przyrostek}.jpg`), { skala: 2, jpeg: true });
      await renderuj(architektura(j, MOTYW[motyw]), motyw, path.join(OBRAZY, `architektura-${j}${przyrostek}.png`), { skala: 2 });
    }
  }

  console.log('Serwisy społecznościowe');
  for (const j of ['pl', 'en']) {
    for (const rodzaj of ['linkedin-post', 'linkedin-kwadrat', 'linkedin-pion', 'linkedin-baner', 'x', 'relacja']) {
      await renderuj(spolecznosc(rodzaj, j, MOTYW.jasny), 'jasny', path.join(GRAFIKI, `${rodzaj}-${j}.jpg`), { jpeg: true });
    }
  }
  await renderuj(spolecznosc('github', 'en', MOTYW.jasny), 'jasny', path.join(GRAFIKI, 'github-podglad.jpg'), { jpeg: true });
  // Wariant ciemny postu — na LinkedIn w trybie ciemnym jasna grafika świeci.
  for (const j of ['pl', 'en']) {
    await renderuj(spolecznosc('linkedin-post', j, MOTYW.ciemny), 'ciemny', path.join(GRAFIKI, `linkedin-post-${j}-ciemny.jpg`), { jpeg: true });
  }

  await br.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nGotowe.');
})().catch((e) => { console.error(e); process.exit(1); });

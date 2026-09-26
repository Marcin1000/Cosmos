#!/usr/bin/env node
/* Ikony Cosmosa z jednego źródła.
 *
 *   node scripts/ikony.js
 *
 * Znak to planeta i pierścień z czterech łuków – po jednym na silnik (NVIDIA,
 * lokalny GPU, Claude, OpenAI). Kształt żyje tylko tutaj; skrypt zapisuje z niego
 * favicon strony, ikony aplikacji (SVG i PNG, zwykłe i maskable) oraz maskę dla
 * Safari. PNG renderuje Playwright – bez niego powstaną same pliki SVG.
 *
 * Pliki w public/icons/ serwer oddaje jako niezmienne (rok w pamięci przeglądarki
 * i Cloudflare). Zmieniając wygląd, zmień też nazwy plików – inaczej nikt nie
 * zobaczy nowej ikony. */
'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const IKONY = path.join(PUBLIC, 'icons');

const JASNE = ['#5E9E3A', '#2F6FEB', '#C8643B', '#16171B'];   // na jasnym tle (strona)
const CIEMNE = ['#76B84F', '#5B8FF5', '#DE7A51', '#ECEBE6'];  // na ciemnym tle (aplikacja)

/* Znak w układzie 40×40. `szczelina` to kolor obwódki planety, która oddziela
   ją od tylnej części pierścienia – powinien być kolorem tła pod spodem. */
function znak({ kolory, planeta, szczelina, grubosc = 2.4, id = 'z' }) {
  const luki = kolory.map((k, i) =>
    `<ellipse cx="20" cy="20" rx="17.5" ry="6.4" pathLength="100" stroke="${k}" stroke-dasharray="21 79" stroke-dashoffset="${-25 * i}"/>`).join('');
  return `<defs><clipPath id="${id}p" clipPathUnits="userSpaceOnUse"><rect x="0" y="20" width="40" height="20"/></clipPath>`
    + `<g id="${id}r" fill="none" stroke-width="2.6" stroke-linecap="round">${luki}</g></defs>`
    + `<g transform="rotate(-22 20 20)"><use href="#${id}r"/>`
    + `<circle cx="20" cy="20" r="9.6" fill="${planeta}" stroke="${szczelina}" stroke-width="${grubosc}"/>`
    + `<g clip-path="url(#${id}p)"><use href="#${id}r"/></g></g>`;
}

const TLO_APLIKACJI = '<radialGradient id="tlo" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="#11131c"/><stop offset="1" stop-color="#05060a"/></radialGradient>';
const GWIAZDY = '<circle cx="120" cy="112" r="4" fill="#fff" opacity=".45"/><circle cx="404" cy="396" r="3.5" fill="#fff" opacity=".35"/>'
  + '<circle cx="388" cy="104" r="2.6" fill="#fff" opacity=".3"/><circle cx="102" cy="398" r="2.6" fill="#fff" opacity=".28"/>';

/* Ikona aplikacji: znak o boku `bok` px na tle 512×512 (zaokrąglonym albo pełnym). */
function ikonaAplikacji(bok, zaokraglona) {
  const k = bok / 40;
  const tlo = zaokraglona ? '<rect width="512" height="512" rx="112" fill="url(#tlo)"/>' : '<rect width="512" height="512" fill="url(#tlo)"/>';
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n'
    + '  <!-- Wygenerowane przez scripts/ikony.js – zmieniaj tam, nie tutaj. -->\n'
    + `  <defs>${TLO_APLIKACJI}</defs>${tlo}${GWIAZDY}\n`
    + `  <g transform="translate(${256 - 20 * k} ${256 - 20 * k}) scale(${k})">${znak({ kolory: CIEMNE, planeta: '#ECEBE6', szczelina: '#0f111a', grubosc: 1.8 })}</g>\n`
    + '</svg>\n';
}

const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">\n'
  + '  <!-- Wygenerowane przez scripts/ikony.js – zmieniaj tam, nie tutaj. -->\n'
  + '  <style>.pl { fill: #16171B; stroke: #F6F5F1; } @media (prefers-color-scheme: dark) { .pl { fill: #ECEBE6; stroke: #111214; } .o { stroke: #ECEBE6; } }</style>\n'
  + '  ' + znak({ kolory: JASNE, planeta: '#16171B', szczelina: '#F6F5F1' })
    .replace('<circle cx="20" cy="20" r="9.6" fill="#16171B" stroke="#F6F5F1"', '<circle cx="20" cy="20" r="9.6" class="pl"')
    .replace('stroke="#16171B" stroke-dasharray', 'class="o" stroke="#16171B" stroke-dasharray') + '\n'
  + '</svg>\n';

const MASKA = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">\n'
  + '  <!-- Wygenerowane przez scripts/ikony.js. Safari barwi maskę sam, więc jeden kolor. -->\n'
  + '  <defs><clipPath id="p" clipPathUnits="userSpaceOnUse"><rect x="0" y="20" width="40" height="20"/></clipPath></defs>\n'
  + '  <g transform="rotate(-22 20 20)" fill="none" stroke="black" stroke-width="2.6">\n'
  + '    <ellipse cx="20" cy="20" rx="17.5" ry="6.4"/>\n'
  + '    <circle cx="20" cy="20" r="9.6" fill="black" stroke="none"/>\n'
  + '    <ellipse cx="20" cy="20" rx="17.5" ry="6.4" clip-path="url(#p)"/>\n'
  + '  </g>\n</svg>\n';

const SVG = {
  [path.join(PUBLIC, 'strona', 'znak.svg')]: FAVICON,
  [path.join(IKONY, 'cosmos.svg')]: ikonaAplikacji(400, true),
  [path.join(IKONY, 'cosmos-maska.svg')]: MASKA,
};

/* PNG: [plik, rozmiar, bok znaku w układzie 512, zaokrąglone tło].
   Maskable ma znak w bezpiecznym kole (~60%), bo system przycina ikonę po swojemu.
   Apple zaokrągla sam, więc dostaje pełne tło. */
const PNG = [
  ['cosmos-192.png', 192, 400, true],
  ['cosmos-512.png', 512, 400, true],
  ['cosmos-1024.png', 1024, 400, true],
  ['cosmos-maskable-192.png', 192, 300, false],
  ['cosmos-maskable-512.png', 512, 300, false],
  ['cosmos-apple-touch.png', 180, 390, false],
];

async function main() {
  for (const [plik, tresc] of Object.entries(SVG)) {
    fs.writeFileSync(plik, tresc);
    console.log('  ✓', path.relative(process.cwd(), plik));
  }
  let chromium;
  try { ({ chromium } = require('playwright')); } catch {
    console.log('  – brak Playwrighta: PNG zostają bez zmian (NODE_PATH=… node scripts/ikony.js)');
    return;
  }
  const przegladarka = await chromium.launch();
  for (const [plik, rozmiar, bok, zaokraglona] of PNG) {
    const strona = await (await przegladarka.newContext({ viewport: { width: rozmiar, height: rozmiar } })).newPage();
    await strona.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${rozmiar}px;height:${rozmiar}px}</style>${ikonaAplikacji(bok, zaokraglona)}`);
    await strona.screenshot({ path: path.join(IKONY, plik), omitBackground: true });
    console.log('  ✓', path.relative(process.cwd(), path.join(IKONY, plik)));
  }
  await przegladarka.close();
}

/* Znak jest potrzebny też grafikom marki (scripts/grafiki-marki.js) – jedno
   źródło kształtu, więc eksport; pliki zapisujemy tylko przy uruchomieniu wprost. */
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { znak, JASNE, CIEMNE };

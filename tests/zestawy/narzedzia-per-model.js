/* Do niedawna KAŻDY model dostawał ten sam prompt systemowy: 1351 tokenów
   opisu narzędzi, zanim użytkownik napisał słowo. Także model 4-miliardowy,
   który żadnego z nich nie umie użyć — a znacznik [SZUKAJ:] wypisałby
   użytkownikowi wprost na ekran.

   Trzy poziomy, wszystkie mierzone tym, co model NAPRAWDĘ dostaje (atrapa
   oddaje wiadomości systemowe jako treść odpowiedzi), a nie tym, co wynika
   z lektury kodu. */
const { srodowisko } = require('../pomoc');
const { modelToolLevel } = require('../../public/models.js');

const promptDla = async (adres, model) => {
  const r = await fetch(`${adres}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: 'cloud', model, messages: [{ role: 'user', content: 'x' }] }),
  });
  const txt = await r.text();
  return txt.split('data: ').filter(Boolean)
    .map((l) => { try { return JSON.parse(l).choices[0].delta.content || ''; } catch { return ''; } })
    .join('');
};

(async () => {
  const env = await srodowisko('kontekst');
  const fail = [];

  // 1. przypisanie poziomów
  const oczekiwane = {
    'nvidia/nemotron-3-super-120b-a12b': 'pelny',
    'openai/gpt-oss-20b': 'pelny',
    'nvidia/nvidia-nemotron-nano-9b-v2': 'zwiezly',
    'nvidia/nemotron-nano-12b-v2-vl': 'zwiezly',
    'nvidia/nemotron-mini-4b-instruct': 'rozmowa',
  };
  for (const [m, chciany] of Object.entries(oczekiwane)) {
    const jest = modelToolLevel(m);
    if (jest !== chciany) fail.push(`${m}: poziom ${jest}, oczekiwano ${chciany}`);
  }
  console.log('1. poziomy przypisane wg katalogu');

  /* 2. Model NIEZNANY dostaje pełny zestaw. Ta sama zasada, co przy wzroku:
     lepiej dać możliwość czemuś, czego nie znamy, niż odebrać ją po cichu
     na podstawie domysłu z nazwy. */
  const nieznany = modelToolLevel('jakas/nowosc-2027-700b');
  console.log(`2. nieznany model → ${nieznany}`);
  if (nieznany !== 'pelny') fail.push('nieznanemu modelowi po cichu odebrano narzędzia');

  // 3. rozmiary promptu maleją wraz z poziomem
  const p = {};
  for (const m of Object.keys(oczekiwane)) p[m] = await promptDla(env.adres, m);
  const duzy = p['nvidia/nemotron-3-super-120b-a12b'].length;
  const sredni = p['nvidia/nvidia-nemotron-nano-9b-v2'].length;
  const maly = p['nvidia/nemotron-mini-4b-instruct'].length;
  console.log(`3. prompt: pełny ${duzy} zn. · zwięzły ${sredni} zn. · rozmowa ${maly} zn.`);
  if (!(duzy > sredni && sredni > maly)) fail.push('prompt nie maleje wraz z poziomem modelu');
  if (sredni > duzy * 0.6) fail.push('poziom „zwięzły" prawie nic nie oszczędza');
  if (maly > duzy * 0.25) fail.push('poziom „rozmowa" prawie nic nie oszczędza');

  // 4. duży model NIE MOŻE stracić żadnego narzędzia — to nie jest oszczędność,
  //    tylko regresja
  const pelnyTekst = p['nvidia/nemotron-3-super-120b-a12b'];
  for (const [co, wzor] of [
    ['wyszukiwanie', /WYSZUKIWANIE W INTERNECIE/],
    ['grafiki', /WYSZUKIWANIE GRAFIK/],
    ['reguła o brakującym mieście', /BRAKUJE CI JEDNEJ INFORMACJI/],
    ['data i miejsce', /TERAZ JEST/],
    ['manifest zdolności', /KIM JESTEŚ/],
  ]) {
    if (!wzor.test(pelnyTekst)) fail.push(`duży model stracił: ${co}`);
  }
  console.log('4. duży model zachował wszystkie narzędzia');

  // 5. średni ma narzędzia, ale krótkim tekstem — nie wolno mu ich ODEBRAĆ
  const sredniTekst = p['nvidia/nvidia-nemotron-nano-9b-v2'];
  console.log(`5. zwięzły — [SZUKAJ:] ${/SZUKAJ:/.test(sredniTekst) ? 'jest' : 'BRAK'}, `
    + `[GRAFIKA:] ${/GRAFIKA:/.test(sredniTekst) ? 'jest' : 'BRAK'}`);
  if (!/SZUKAJ:/.test(sredniTekst)) fail.push('zwięzły stracił wyszukiwanie zamiast je skrócić');
  if (!/GRAFIKA:/.test(sredniTekst)) fail.push('zwięzły stracił grafiki zamiast je skrócić');
  if (/BRAKUJE CI JEDNEJ INFORMACJI/.test(sredniTekst)) fail.push('zwięzły dostał pełny tekst');

  // 6. najmniejszy nie dostaje ŻADNEGO znacznika — wypisałby go na ekran
  const malyTekst = p['nvidia/nemotron-mini-4b-instruct'];
  console.log(`6. rozmowa — znaczniki: ${/\[(SZUKAJ|GRAFIKA|OBRAZ|AKCJA):/.test(malyTekst) ? 'SĄ' : 'brak'}`);
  if (/\[(SZUKAJ|GRAFIKA|OBRAZ|AKCJA):/.test(malyTekst)) {
    fail.push('najmniejszy model dostał znaczniki, których nie użyje');
  }

  // 7. ale data i miejsce zostają zawsze — to fakty, nie narzędzia
  for (const [nazwa, tekst] of Object.entries(p)) {
    if (!/TERAZ JEST/.test(tekst)) fail.push(`${nazwa} nie dostał daty`);
  }
  console.log('7. każdy poziom zna datę i miejsce');

  env.koniec();
  console.log(fail.length ? '\nDO POPRAWY:\n- ' + fail.join('\n- ') : '\nNARZĘDZIA PER MODEL OK');
  process.exit(fail.length ? 1 : 0);
})();

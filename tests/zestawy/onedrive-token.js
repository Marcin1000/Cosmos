/* Token OneDrive: jedno odświeżenie naraz, cofnięta zgoda, foldery z „#" (lib/onedrive.js).
 *
 * Odtworzone przez przegląd backendu:
 *   1. osiem równoległych żądań po wygaśnięciu tokenu = JEDNO odświeżenie
 *      (było osiem, a Microsoft przy rotacji unieważnia poprzednie tokeny),
 *   2. cofnięta zgoda (invalid_grant) → `polaczony()` fałsz, czytelny błąd
 *      i żadnych kolejnych prób odświeżenia,
 *   3. folder „Sesja #3?" dociera do Graph w całości, nie urwany na „#".
 * Bez sieci: podmieniony `fetch` udaje Microsoft. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const problemy = [];
const ok = (w, opis) => { console.log(`${w ? 'OK ' : 'ZLE'} ${opis}`); if (!w) problemy.push(opis); };

let odswiezen = 0;
let odwolany = false;
const adresy = [];
global.fetch = async (url) => {
  const u = String(url);
  adresy.push(u);
  const json = (status, d) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('/oauth2/v2.0/token')) {
    odswiezen++;
    await new Promise((r) => setTimeout(r, 50));
    if (odwolany) return json(400, { error: 'invalid_grant', error_description: 'AADSTS70000: The grant was revoked.' });
    return json(200, { access_token: `AT${odswiezen}`, refresh_token: `RT${odswiezen + 1}`, expires_in: 3600 });
  }
  return json(200, { value: [] });
};

const onedrive_ = require('../../lib/onedrive.js');

(async () => {
  const kat = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmos-od-'));
  const zapisz = (d) => fs.writeFileSync(path.join(kat, 'onedrive.json'), JSON.stringify(d));
  const nowy = () => onedrive_.utworz({ katalogDanych: kat, clientId: 'c', clientSecret: 's', redirectUri: 'r' });

  zapisz({ refresh_token: 'RT1', access_token: 'STARY', wygasa: Date.now() - 1000, od: 1 });
  const od = nowy();
  await Promise.all(Array.from({ length: 8 }, () => od.graf('/me/drive/root/children').catch((e) => e.message)));
  ok(odswiezen === 1, `8 równoległych żądań po wygaśnięciu → odświeżeń: ${odswiezen}`);

  odwolany = true;
  zapisz({ refresh_token: 'RT9', access_token: 'STARY', wygasa: Date.now() - 1000, od: 1 });
  const od2 = nowy();
  let blad = '';
  try { await od2.graf('/me/drive/root/children'); } catch (e) { blad = e.message; }
  ok(/połącz/i.test(blad), `cofnięta zgoda → prośba o ponowne połączenie („${blad.slice(0, 60)}")`);
  ok(od2.polaczony() === false, 'po cofniętej zgodzie polaczony() = false');
  const przed = odswiezen;
  try { await od2.graf('/me/drive/root/children'); } catch { /* oczekiwane */ }
  ok(odswiezen === przed, 'drugie żądanie nie próbuje odświeżać od nowa');
  ok(nowy().polaczony() === false, 'stan „wymaga logowania" przeżywa restart');

  odwolany = false;
  zapisz({ refresh_token: 'RT1', access_token: 'SWIEZY', wygasa: Date.now() + 3600000, od: 1 });
  const od3 = nowy();
  adresy.length = 0;
  try { await od3.indeksuj(() => {}, { folder: 'Zdjęcia/Sesja #3?', limit: 1 }); } catch { /* sam adres nas interesuje */ }
  const doGraf = adresy.find((a) => a.includes('graph.microsoft.com')) || '';
  ok(/Sesja%20%233%3F/.test(doGraf), `folder z „#" i „?" zakodowany w całości (${doGraf.slice(0, 110)})`);

  fs.rmSync(kat, { recursive: true, force: true });
  console.log(problemy.length ? `\n${problemy.length} problem(ów)` : '\nTOKEN ONEDRIVE OK');
  process.exit(problemy.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

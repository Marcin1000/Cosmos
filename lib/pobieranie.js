/* Pobieranie stron z internetu — bezpiecznie, dla treści, którą wskazał ktoś inny.
 *
 * DLACZEGO. `/api/kb/link` pobierał dowolny adres podany przez użytkownika
 * zwykłym `fetch`. Odkąd Cosmos ma konta, „użytkownik" to także zaproszony
 * gość — a serwer stoi w sieci, do której gość nie powinien mieć wstępu:
 * 127.0.0.1 (usługa zmysłów, SearXNG, sam Cosmos), adres metadanych chmury
 * (169.254.169.254), komputer domowy przez Tailscale (100.64.0.0/10), router.
 * Wystarczyło dodać „link" http://100.x.y.z:7060/health, żeby treść wewnętrznej
 * usługi wylądowała w bazie wiedzy gościa, gotowa do odczytu.
 *
 * Zasady:
 *   1. tylko http i https,
 *   2. adres sprawdzamy W CHWILI ŁĄCZENIA (własny `lookup` gniazda), nie
 *      przed nim — inaczej wystarczy domena, która najpierw odpowiada
 *      publicznym adresem, a przy połączeniu prywatnym (DNS rebinding),
 *   3. przekierowania prowadzimy sami, każdy krok przez te same bramki,
 *   4. czytamy z limitem bajtów, nie całość do pamięci,
 *   5. tekst dekodujemy wg charsetu z nagłówka lub <meta> — polskie strony
 *      w windows-1250 / ISO-8859-2 wychodziły dotąd z „krzaczkami".
 *
 * Wyjątek: właściciel instancji może pobrać adres w sieci prywatnej (strona
 * NAS-a, drukarki) — i tak ma pełny dostęp do serwera. Decyduje wołający przez
 * `pozwolPrywatne`.
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');

class ZablokowanyAdres extends Error {
  constructor(msg) { super(msg); this.name = 'ZablokowanyAdres'; }
}

/* Sieci, do których nie wolno sięgać z zewnątrz. `net.BlockList` sama rozpoznaje
   IPv4 zapisane po IPv6 (`::ffff:7f00:1` — tak parser URL zapisuje
   `[::ffff:127.0.0.1]`); ręczne porównywanie tekstu tę formę przepuszczało. */
const PRYWATNE = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['224.0.0.0', 3]]) PRYWATNE.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 96],                    // ::, ::1 i przestarzałe „IPv4-compatible"
  ['64:ff9b::', 96], ['64:ff9b:1::', 48],            // NAT64 — w środku adres IPv4
  ['2002::', 16], ['2001::', 32],                    // 6to4, Teredo — też niosą IPv4
  ['100::', 64], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) PRYWATNE.addSubnet(a, p, 'ipv6');

/** Czy adres IP należy do sieci, do której nie wolno sięgać z zewnątrz. */
function prywatnyAdres(ip) {
  const typ = net.isIPv4(ip) ? 'ipv4' : net.isIPv6(ip) ? 'ipv6' : null;
  if (!typ) return true;                              // nieznany format — nie ryzykujemy
  return PRYWATNE.check(ip, typ);
}

/* Node 22 (autoSelectFamily) woła `lookup` z `{ all: true }` i czeka na TABLICĘ.
   Wymuszone `all: false` kończyło KAŻDE pobranie po nazwie hosta błędem
   „Invalid IP address: undefined" — testy tego nie widziały, bo szły na 127.0.0.1. */
function bezpiecznyLookup(pozwolPrywatne) {
  return (host, opcje, cb) => {
    dns.lookup(host, { ...opcje, all: true }, (err, adresy) => {
      if (err) return cb(err);
      const dobre = pozwolPrywatne ? adresy : adresy.filter((a) => !prywatnyAdres(a.address));
      if (!dobre.length) return cb(new ZablokowanyAdres(`Adres ${host} prowadzi do sieci prywatnej — nie pobieramy go.`));
      if (opcje && opcje.all) return cb(null, dobre);
      cb(null, dobre[0].address, dobre[0].family);
    });
  };
}

function charsetZ(typ, poczatek) {
  const zNaglowka = /charset=["']?([\w-]+)/i.exec(typ || '');
  if (zNaglowka) return zNaglowka[1].toLowerCase();
  const zMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(poczatek || '');
  return zMeta ? zMeta[1].toLowerCase() : 'utf-8';
}

function dekoduj(buf, typ) {
  const cs = charsetZ(typ, buf.subarray(0, 2048).toString('latin1'));
  try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

/**
 * Pobierz stronę. Zwraca `{ status, typ, tekst, adres }` (adres po przekierowaniach).
 * Rzuca `ZablokowanyAdres` dla adresów prywatnych i niedozwolonych schematów.
 */
/** Hosty wpuszczane mimo prywatnego adresu — jawna lista operatora
 *  (np. własny SearXNG albo atrapy w testach). Czytana przy każdym wywołaniu. */
const zaufane = () => String(process.env.POBIERANIE_ZAUFANE || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

async function pobierzStrone(adres, {
  pozwolPrywatne = false, maxBajtow = 2_000_000, czasMs = 15000,
  naglowki = {}, maksPrzekierowan = 5,
} = {}) {
  let url;
  try { url = new URL(adres); } catch { throw new ZablokowanyAdres('To nie jest poprawny adres.'); }

  const pozwolPoczatkowo = pozwolPrywatne;
  for (let krok = 0; krok <= maksPrzekierowan; krok++) {
    pozwolPrywatne = pozwolPoczatkowo || zaufane().includes(url.hostname.replace(/^\[|\]$/g, '').toLowerCase());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ZablokowanyAdres('Pobieramy tylko adresy http i https.');
    }
    if (url.username || url.password) throw new ZablokowanyAdres('Adres z loginem i hasłem — nie pobieramy.');
    // Dosłowny adres IP nie przechodzi przez DNS, więc sprawdzamy go od razu.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !pozwolPrywatne && prywatnyAdres(host)) {
      throw new ZablokowanyAdres(`Adres ${host} prowadzi do sieci prywatnej — nie pobieramy go.`);
    }

    const odp = await new Promise((resolve, reject) => {
      const modul = url.protocol === 'https:' ? https : http;
      const req = modul.request(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.6',
          ...naglowki,
        },
        lookup: bezpiecznyLookup(pozwolPrywatne),
        // Bez wspólnego agenta: gniazdo keep-alive otwarte dla właściciela
        // (adres prywatny wolno) nie może obsłużyć potem gościa.
        agent: false,
        timeout: czasMs,
      }, resolve);
      req.on('timeout', () => req.destroy(new Error('Strona nie odpowiedziała na czas.')));
      req.on('error', reject);
      req.end();
    });

    if ([301, 302, 303, 307, 308].includes(odp.statusCode) && odp.headers.location) {
      odp.resume();
      url = new URL(odp.headers.location, url);
      continue;
    }

    const typ = String(odp.headers['content-type'] || '');
    const kawalki = [];
    let razem = 0;
    await new Promise((resolve, reject) => {
      odp.on('data', (k) => {
        razem += k.length;
        if (razem > maxBajtow) { kawalki.push(k.subarray(0, k.length - (razem - maxBajtow))); odp.destroy(); resolve(); return; }
        kawalki.push(k);
      });
      odp.on('end', resolve);
      odp.on('error', reject);
      odp.on('close', resolve);
    });
    return { status: odp.statusCode, typ, tekst: dekoduj(Buffer.concat(kawalki), typ), adres: url.href };
  }
  throw new ZablokowanyAdres('Za dużo przekierowań.');
}

module.exports = { pobierzStrone, prywatnyAdres, ZablokowanyAdres };

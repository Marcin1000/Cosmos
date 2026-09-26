/* ============================================================
   Pliki statyczne — strona produktowa, aplikacja, czcionki, ikony

   Wydzielone z server.js (propozycja podziału zespołu IT, krok 1: ryzyko
   bliskie zeru, bo nie dotyka danych osób). Przy okazji dwie rzeczy:

   1. CSP aplikacji. Cosmos jest w internecie pod publiczną domeną, a w DOM
      trafiają rzeczy od innych osób (imiona w panelu Dostęp) i od modeli
      (Markdown odpowiedzi). Pilnujemy tego przez `textContent` i escape, ale
      jedna pomyłka w szablonie = skrypt obcej osoby w sesji właściciela, z pełnym
      dostępem do /api/*. Nagłówek Content-Security-Policy to druga linia
      obrony: przeglądarka uruchomi tylko skrypty z naszego adresu i jeden
      skrypt inline z `index.html` (motyw przed pierwszym malowaniem) — ten
      rozpoznajemy po skrócie liczonym Z PLIKU, więc edycja skryptu nie psuje
      polityki po cichu.

   2. Pamięć skompresowanych plików. Każde pełne pobranie /app.js liczyło
      brotli od nowa (~10 ms stojącej pętli zdarzeń na plik). Wynik zależy
      tylko od treści, więc trzymamy go pod ETagiem.
   ============================================================ */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

/* Typy, które opłaca się kompresować — tekst. Cloudflare robi to sam, ale
   instancja wystawiona bez niego wysyłała 225 kB zamiast ~60. */
const KOMPRESUJ = /^(text\/|application\/(json|xml|javascript|manifest\+json)|image\/svg)/;

/** Skróty (sha256) treści skryptów inline dokumentu — do `script-src`. */
function skrotyInline(html) {
  const skroty = [];
  for (const m of String(html).matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    skroty.push(`'sha256-${crypto.createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  return skroty;
}

/** Content-Security-Policy aplikacji (`/app`).
 *
 *  Style inline zostają dozwolone: `style="…"` stoi w HTML-u i w szablonach,
 *  a styl nie uruchamia kodu. Obrazy także z https: — odpowiedź modelu może
 *  pokazać obrazek z sieci, a obraz niczego nie wykona. Reszta tylko z naszego
 *  adresu; ramki, wtyczki i cudze osadzanie Cosmosa — wcale. */
function politykaAplikacji(html) {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...skrotyInline(html)].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function utworz({ PUBLIC_DIR }) {
  // `${plik}|${etag}|${kodowanie}` → Buffer; kilkadziesiąt plików, więc bez wymiany.
  const skompresowane = new Map();
  const MAKS_W_PAMIECI = 200;

  function skompresuj(klucz, dane, kodowanie) {
    const juz = skompresowane.get(klucz);
    if (juz) return juz;
    const wynik = kodowanie === 'br'
      ? zlib.brotliCompressSync(dane, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
      : zlib.gzipSync(dane);
    if (skompresowane.size >= MAKS_W_PAMIECI) skompresowane.delete(skompresowane.keys().next().value);
    skompresowane.set(klucz, wynik);
    return wynik;
  }

  function serveStatic(req, res) {
    let urlPath;
    // „/%E0" to zepsuty adres, nie awaria serwera — 400 zamiast 500.
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Bad request');
    }
    /* Pod „/" stoi strona produktowa, a sam Cosmos pod „/app". Aplikacja ładuje
       swoje pliki ścieżkami bezwzględnymi (/app.js, /style.css), więc działa
       tak samo spod „/app" i „/app/". */
    if (urlPath === '/') urlPath = '/strona/index.html';
    else if (urlPath === '/app' || urlPath === '/app/') urlPath = '/index.html';

    const filePath = path.join(PUBLIC_DIR, urlPath);
    // Z separatorem: sam prefiks przepuściłby sąsiedni katalog „public-cokolwiek".
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      const ext = path.extname(filePath).toLowerCase();
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        /* Publiczna domena: przeglądarka nie zgaduje typu pliku, strona nie daje
           się osadzić w cudzej ramce (klikanie w Cosmosa „przez szybę" obcej
           strony), a adres Cosmosa nie wycieka w nagłówku Referer do stron,
           do których prowadzą linki z odpowiedzi. */
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'same-origin',
      };
      // Aplikacja (i tylko ona) dostaje CSP — strona produktowa ma własne skrypty inline.
      if (urlPath === '/index.html') headers['Content-Security-Policy'] = politykaAplikacji(data.toString('utf8'));
      /* Czcionki i ikony są niezmienne pod swoją nazwą — przeglądarka i Cloudflare
         trzymają je rok. Nowa ikona = nowa nazwa pliku, inaczej nikt jej nie zobaczy. */
      // Skrót treści: ETag dla kodu aplikacji i klucz pamięci skompresowanych wersji.
      const skrot = crypto.createHash('sha1').update(data).digest('base64url').slice(0, 22);
      if (ext === '.woff2' || urlPath.startsWith('/icons/')) {
        headers['Cache-Control'] = 'public, max-age=31536000, immutable';
      } else {
        /* Kod aplikacji: wolno trzymać, ale trzeba zapytać, czy jest nowszy.
           Bez tego nagłówka Cloudflare trzyma .js i .css u siebie około dwóch
           godzin — po aktualizacji telefony dostawałyby stary app.js, i żadne
           podniesienie wersji service workera by tego nie naprawiło, bo sam
           sw.js też przychodziłby z pamięci Cloudflare. */
        headers['Cache-Control'] = 'no-cache';
        /* „no-cache" = zapytaj, czy się zmieniło. Bez ETag odpowiedź brzmiała
           zawsze „tak" i każda wizyta pobierała całe 120 kB od nowa. */
        const etag = `W/"${skrot}"`;
        headers.ETag = etag;
        if (String(req.headers['if-none-match'] || '').split(/\s*,\s*/).includes(etag)) {
          res.writeHead(304, headers);
          return res.end();
        }
      }
      const ae = String(req.headers['accept-encoding'] || '');
      if (KOMPRESUJ.test(headers['Content-Type']) && data.length > 1024) {
        headers.Vary = 'Accept-Encoding';
        const kodowanie = /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : '';
        if (kodowanie) {
          data = skompresuj(`${filePath}|${skrot}|${kodowanie}`, data, kodowanie);
          headers['Content-Encoding'] = kodowanie;
        }
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  }

  return { serveStatic };
}

module.exports = { utworz, MIME, KOMPRESUJ, skrotyInline, politykaAplikacji };

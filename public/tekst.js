/* ============================================================
   TEKST – treść wiadomości i mini-renderer Markdown

   Najczystsza część `app.js`: same przekształcenia tekstu. Nic tu nie sięga
   po DOM, stan aplikacji ani sieć – wchodzi string, wychodzi string.

   Wydzielone z dwóch powodów. Pierwszy to rozmiar `app.js`. Drugi ważniejszy:
   te funkcje decydują o BEZPIECZEŃSTWIE tego, co model wpisze w rozmowę.
   `escapeHtml`, filtr adresów w `renderInline` i `autoLink` są jedyną barierą
   między odpowiedzią modelu a `innerHTML`. Dopóki mieszkały w pliku, którego
   nie da się wczytać poza przeglądarką, sprawdzało je kilka testów
   przeglądarkowych – wolnych i sprawdzających przy okazji wygląd.
   Teraz da się je wywołać w Node i przepuścić przez nie listę prób wstrzyknięcia
   w ułamku sekundy.
   ============================================================ */

/**
 * Zbuduj zestaw funkcji tekstowych.
 *
 * @param {object} z zależności
 * @param {Function} z.t tłumaczenia (etykieta przycisku „kopiuj")
 * @param {string} z.COPY_SVG ikona kopiowania wstawiana w blok kodu
 * @returns {object} funkcje tekstowe
 */
function utworzTekst(z) {
  const { t, COPY_SVG } = z;

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // treść wiadomości: string albo { text, images: [dataURL] }
  function msgText(m) {
    return typeof m.content === 'string' ? m.content : (m.content?.text || '');
  }
  function msgImages(m) {
    return typeof m.content === 'string' ? [] : (m.content?.images || []);
  }
  // Zdjęcia znalezione w internecie – inna rzecz niż `images` (te są wgrane
  // albo wygenerowane). Mają źródło, więc dają się kliknąć i sprawdzić.
  function msgPhotos(m) {
    return typeof m.content === 'string' ? [] : (m.content?.photos || []);
  }
  /* Wynik z archiwum bywa dłuższy niż jedna porcja miniatur. Tu leży wszystko,
     czego trzeba, by dobrać następną: zapytanie, na którym pliku skończyliśmy
     i ile ich jest razem. Bez tego przycisk „pokaż kolejne" nie miałby czego
     powtórzyć. */
  function msgDalej(m) {
    return typeof m.content === 'string' ? null : (m.content?.dalej || null);
  }
  // Wczytane dokumenty: na ekranie kafelek z nazwą, do modelu pełna treść.
  function msgDocs(m) {
    return typeof m.content === 'string' ? [] : (m.content?.docs || []);
  }
  // Wynik uruchomienia programu: { stdout, stderr, wyniki, ms }.
  function msgRun(m) {
    return typeof m.content === 'string' ? null : (m.content?.run || null);
  }

  /** Wszystkie załączniki tej rozmowy – program dostaje je jako pliki obok
   *  siebie, więc „policz sumę z tego arkusza" działa bez przeklejania danych. */
  function zebranyMaterial(conv) {
    const pliki = [];
    for (const m of conv.messages) {
      for (const d of msgDocs(m)) {
        if (pliki.length < 8) pliki.push({ name: d.name, text: d.text });
      }
    }
    return pliki;
  }

  // ----------------------------------------------------------------
  // Mini-renderer Markdown (bez zewnętrznych bibliotek)
  // ----------------------------------------------------------------

  /** Zamień gołe adresy w tekście na klikalne odnośniki.
   *
   * Model podaje źródła raz jako `[tekst](adres)`, a raz jako sam adres w zdaniu –
   * i ta druga postać zostawała martwym tekstem, którego nie dało się kliknąć.
   * Pracujemy na HTML-u po `renderInline`, więc omijamy to, co już jest wewnątrz
   * `<a>` i `<code>`: inaczej podlinkowalibyśmy adres w atrybucie href.
   */
  function autoLink(html) {
    const skip = /<a\b[^>]*>[\s\S]*?<\/a>|<code>[\s\S]*?<\/code>/gi;
    const url = /\bhttps?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+\.[a-z]{2,}[^\s<>"']*/gi;

    const linkify = (chunk) => chunk.replace(url, (m) => {
      // Znaki interpunkcyjne na końcu należą do zdania, nie do adresu.
      // Nawias zamykający zostawiamy tylko wtedy, gdy w adresie jest otwierający.
      let tail = '';
      let addr = m;
      for (;;) {
        const last = addr.slice(-1);
        if (/[.,;:!?…"']/.test(last)
            || (last === ')' && (addr.match(/\(/g) || []).length < (addr.match(/\)/g) || []).length)) {
          tail = last + tail;
          addr = addr.slice(0, -1);
          continue;
        }
        break;
      }
      if (!addr) return m;
      const href = addr.startsWith('www.') ? 'https://' + addr : addr;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${addr}</a>${tail}`;
    });

    let out = '';
    let last = 0;
    for (const m of html.matchAll(skip)) {
      out += linkify(html.slice(last, m.index)) + m[0];
      last = m.index + m[0].length;
    }
    return out + linkify(html.slice(last));
  }

  function renderInline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    out = out.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    out = out.replace(/(^|[\s(])_([^_\s][^_]*)_/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return autoLink(out);
  }

  function renderMarkdown(text) {
    const lines = text.split('\n');
    const html = [];
    let i = 0;
    let para = [];
    let listStack = null; // 'ul' | 'ol'
    let ostatniPunkt = -1; // indeks w `html` ostatniego <li> (dopisywanie wciętego ciągu dalszego)

    const flushPara = () => {
      if (para.length) {
        html.push(`<p>${renderInline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
        para = [];
      }
    };
    const closeList = () => {
      if (listStack) { html.push(`</${listStack}>`); listStack = null; }
    };

    while (i < lines.length) {
      const line = lines[i];

      // blok kodu ```
      const fence = line.match(/^```(\S*)\s*$/);
      if (fence) {
        flushPara(); closeList();
        const lang = fence[1] || '';
        const code = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        html.push(
          `<div class="code-block">` +
          `<div class="code-block-header"><span>${escapeHtml(lang || 'kod')}</span>` +
          `<button class="code-copy-btn" data-copy>${COPY_SVG}${t('copy')}</button></div>` +
          `<pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`
        );
        continue;
      }

      // nagłówki
      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushPara(); closeList();
        const level = heading[1].length;
        html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        i++; continue;
      }

      // pozioma linia
      if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushPara(); closeList();
        html.push('<hr>');
        i++; continue;
      }

      // cytat
      if (/^>\s?/.test(line)) {
        flushPara(); closeList();
        const quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        html.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
        continue;
      }

      // tabela
      if (line.includes('|') && i + 1 < lines.length &&
          /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        flushPara(); closeList();
        const splitRow = (row) =>
          row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
        const headers = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
          rows.push(splitRow(lines[i]));
          i++;
        }
        let table = '<table><thead><tr>';
        table += headers.map((h) => `<th>${renderInline(h)}</th>`).join('');
        table += '</tr></thead><tbody>';
        for (const row of rows) {
          table += '<tr>' + row.map((c) => `<td>${renderInline(c)}</td>`).join('') + '</tr>';
        }
        table += '</tbody></table>';
        html.push(table);
        continue;
      }

      /* LISTY. Dwie rzeczy dawały „1. 1. 1.” (agencja-rozmowa, runda 5):
         1. Lista luźna – pusta linia między punktami („1. a\n\n2. b”), domyślny
            styl GPT i Claude w planach i przepisach. Pusta linia zamykała listę,
            więc każdy punkt był osobną listą z jednym punktem.
         2. Numer z tekstu przepadał. Plan przedzielony siatką zdjęć
            ([GRAFIKA: …] między punktami) to osobne wiadomości, a druga zaczyna
            się od „2.” – i rysowała się jako „1.”. Stąd `<ol start>`. */
      const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
      const olMatch = line.match(/^\s*(\d{1,9})[.)]\s+(.*)$/);
      if (ulMatch || olMatch) {
        flushPara();
        const type = ulMatch ? 'ul' : 'ol';
        if (listStack !== type) {
          closeList();
          const start = olMatch ? parseInt(olMatch[1], 10) : 1;
          html.push(start !== 1 ? `<ol start="${start}">` : `<${type}>`);
          listStack = type;
        }
        html.push(`<li>${renderInline(ulMatch ? ulMatch[1] : olMatch[2])}</li>`);
        ostatniPunkt = html.length - 1;
        i++; continue;
      }

      // Wcięta linia pod punktem („1. Wawel\n   złota godzina”) – dalszy ciąg
      // tego punktu, nie akapit wciśnięty między punkty listy.
      if (listStack && ostatniPunkt === html.length - 1 && /^\s{2,}\S/.test(line)) {
        html[ostatniPunkt] = html[ostatniPunkt].replace(/<\/li>$/, `<br>${renderInline(line.trim())}</li>`);
        i++; continue;
      }

      // pusta linia
      if (line.trim() === '') {
        flushPara();
        /* Lista luźna: pusta linia nie zamyka listy, jeśli dalej idzie punkt
           tego samego rodzaju albo wcięty dalszy ciąg punktu. */
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') j++;
        const dalej = j < lines.length ? lines[j] : '';
        const tenSam = listStack === 'ol' ? /^\s*\d{1,9}[.)]\s+/ : /^\s*[-*+]\s+/;
        const ciagDalszy = /^\s{2,}\S/.test(dalej) && ostatniPunkt === html.length - 1;
        if (!listStack || !(tenSam.test(dalej) || ciagDalszy)) closeList();
        i = j; continue;
      }

      para.push(line);
      i++;
    }

    flushPara(); closeList();
    return html.join('');
  }

  return {
    escapeHtml,
    msgText,
    msgImages,
    msgPhotos,
    msgDalej,
    msgDocs,
    msgRun,
    zebranyMaterial,
    autoLink,
    renderInline,
    renderMarkdown,
  };
}

if (typeof window !== 'undefined') window.utworzTekst = utworzTekst;
if (typeof module !== 'undefined') module.exports = { utworzTekst };

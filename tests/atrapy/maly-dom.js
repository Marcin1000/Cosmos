/* Najmniejszy DOM, jaki wystarcza budowniczym widoku.

   Powód istnienia tego pliku jest jeden i konkretny: PIĘĆ RAZY w jednej sesji
   test sprawdzający obecność frazy w `public/app.js` padł przy przeprowadzce
   kodu, mimo że funkcja działała bez zmian. Za każdym razem kusiło, żeby
   przestawić regexp na nowy plik — i za każdym razem byłoby to odłożenie
   problemu, nie rozwiązanie.

   Prawdziwa przyczyna była taka, że budowniczych DOM-u nie dało się uruchomić
   poza przeglądarką, a testy przeglądarkowe są wolne i sprawdzają układ,
   nie logikę. Po wydzieleniu `public/widoki.js` brakowało już tylko atrapy
   `document` — i to jest ona.

   ŚWIADOMIE NIEPEŁNA. Nie udaje przeglądarki i nie ma jej udawać: obsługuje
   tworzenie elementów, drzewo, klasy, atrybuty i zdarzenia. Wszystko, co
   wymaga układu strony (wymiary, style wyliczone, widoczność), zostaje
   w zestawach przeglądarkowych, bo tam jest jedyne miejsce, gdzie te pomiary
   cokolwiek znaczą. Atrapa, która zaczęłaby zgadywać wysokości, dawałaby
   zielone wyniki o niczym.
*/

/** Jeden element drzewa. */
class Element {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.nasluchy = {};
    this._text = '';
    this._html = '';
    this.classList = {
      lista: new Set(),
      add: (...k) => k.forEach((x) => this.classList.lista.add(x)),
      remove: (...k) => k.forEach((x) => this.classList.lista.delete(x)),
      contains: (k) => this.classList.lista.has(k),
      toggle: (k, on) => {
        const chce = on === undefined ? !this.classList.lista.has(k) : Boolean(on);
        if (chce) this.classList.lista.add(k); else this.classList.lista.delete(k);
        return chce;
      },
    };
  }

  get className() { return [...this.classList.lista].join(' '); }
  set className(v) { this.classList.lista = new Set(String(v || '').split(/\s+/).filter(Boolean)); }

  get textContent() {
    if (this.children.length) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
  set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; }

  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v == null ? '' : v); this.children = []; }

  get firstChild() { return this.children[0] || null; }
  get previousElementSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.children.indexOf(this);
    return i > 0 ? this.parentNode.children[i - 1] : null;
  }

  appendChild(el) {
    if (el.parentNode) el.parentNode.removeChild(el);
    el.parentNode = this;
    this.children.push(el);
    return el;
  }
  append(...els) { els.forEach((e) => this.appendChild(e)); }
  prepend(el) { el.parentNode = this; this.children.unshift(el); }
  removeChild(el) {
    const i = this.children.indexOf(el);
    if (i >= 0) this.children.splice(i, 1);
    el.parentNode = null;
    return el;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith(inny) {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    this.parentNode.children[i] = inny;
    inny.parentNode = this.parentNode;
    this.parentNode = null;
  }

  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }

  addEventListener(typ, fn) { (this.nasluchy[typ] ||= []).push(fn); }
  /** Wywołaj zdarzenie tak, jak zrobiłby to użytkownik. */
  async dispatch(typ, zdarzenie = {}) {
    for (const fn of this.nasluchy[typ] || []) await fn({ preventDefault() {}, stopPropagation() {}, ...zdarzenie });
  }

  /** Wszystkie elementy w poddrzewie o danej klasie — do sprawdzania wyniku. */
  poKlasie(k) {
    const out = [];
    const chodz = (el) => {
      if (el.classList.contains(k)) out.push(el);
      el.children.forEach(chodz);
    };
    chodz(this);
    return out;
  }
  /** Cały tekst poddrzewa, także z `innerHTML`. */
  calyTekst() {
    let out = this._text + this._html;
    for (const c of this.children) out += c.calyTekst();
    return out;
  }
}

/** Zbuduj atrapę `document` i zainstaluj ją globalnie na czas testu. */
function zainstalujDom() {
  const dokument = {
    createElement: (tag) => new Element(tag),
    createElementNS: (_ns, tag) => new Element(tag),
    body: new Element('body'),
    addEventListener() {},
  };
  const poprzedni = { document: global.document, window: global.window };
  global.document = dokument;
  global.window = global.window || { addEventListener() {} };
  return {
    dokument,
    Element,
    odinstaluj() {
      global.document = poprzedni.document;
      global.window = poprzedni.window;
    },
  };
}

module.exports = { zainstalujDom, Element };

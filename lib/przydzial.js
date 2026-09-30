/* ============================================================
   Przydział miejsc u dostawcy modelu – jeden na cały proces serwera

   Zespół agentów to kilka wywołań modelu na jedno pytanie, a kilka osób
   naraz to kilkanaście. Node nie ogranicza równoległych strumieni do jednego
   dostawcy, a dostawca ma limit na KLUCZ i MODEL, nie na osobę. Pomiar
   (it-backend, runda 9): 25 osób × 5 ról na dostawcy z limitem 20 bez
   przydziału – 273 × 429, 21 z 25 tur z błędem PROWADZĄCEGO, a zwykły czat
   innych osób w tej chwili też dostawał 429. Z przydziałem – zero.

   Zasady:
   - kubełek na (adres, końcówka klucza, model); lokalny GPU – na sam adres
     (VRAM i OLLAMA_NUM_PARALLEL są na komputer, nie na model). Własny klucz
     członka to własny kubełek – nie dzieli limitu właściciela;
   - chmura NVIDIA ma drugi poziom: kubełek KLUCZA (adres, końcówka klucza)
     z limitem COSMOS_ZESPOL_ROWNOLEGLE_CLOUD_KLUCZ (domyślnie 6). Darmowy
     dostęp liczy zapytania na konto, nie na model – pięć osób z rolami na
     kilku modelach NVIDII to było 18 żądań naraz na jednym kluczu, a 429 na
     jednym modelu nie hamowało pozostałych (it-backend, runda 10). Miejsce
     bierze się najpierw w kubełku modelu, potem klucza; 429 obniża oba;
   - zwykły czat i prowadzący biorą miejsce BEZ czekania (`zajmijOdRazu`),
     ale liczą się do zajętych – inaczej przydział nie wie, że dostawca jest
     pełny; role czekają w kolejce (`zajmij`);
   - kolejka oddaje miejsce osobie, która trzyma ich najmniej (pięć ról jednej
     osoby nie zagłodzi drugiej), przy remisie – rola z modelem, który ruszył
     ostatnio (lokalnie: bez przeładowania pamięci karty);
   - samoregulacja po 429: limit = strumienie, które dostawca PRZYJĄŁ, minus
     zapas na prowadzących i czat; wraca o 1 co 30 s bez 429. Wersja „limit
     o 1 w dół” zawodziła: fala 429 przychodzi w jednej sekundzie;
   - czekanie to `await` na obietnicy – kontekst osoby (AsyncLocalStorage)
     wraca za nim sam, bo kontynuacja biegnie w kontekście czekającego
     (sonda it-konta); dla pewności rozwiązanie wiążemy AsyncResource.
   ============================================================ */

const { zwiazZKontekstem } = require('./kontekst.js');

const LIMITY_DOMYSLNE = { cloud: 4, openai: 6, claude: 6, local: 1 };
/* Limit na KLUCZ (drugi poziom) – dziś tylko chmura NVIDIA; inny silnik dostaje
   go wyłącznie z env (COSMOS_ZESPOL_ROWNOLEGLE_<SILNIK>_KLUCZ). */
const LIMITY_KLUCZA_DOMYSLNE = { cloud: 6 };
const ZAPAS = 2;
const POWROT_MS = Number(process.env.COSMOS_PRZYDZIAL_POWROT_MS) || 30_000;

function limitDla(silnik, env = process.env) {
  const nazwa = `COSMOS_ZESPOL_ROWNOLEGLE_${String(silnik || 'cloud').toUpperCase()}`;
  const n = Number(env[nazwa]);
  return Number.isInteger(n) && n > 0 ? n : (LIMITY_DOMYSLNE[silnik] || 4);
}

/** Limit kubełka klucza dla silnika albo 0 (bez drugiego poziomu). */
function limitKluczaDla(silnik, env = process.env) {
  const nazwa = `COSMOS_ZESPOL_ROWNOLEGLE_${String(silnik || 'cloud').toUpperCase()}_KLUCZ`;
  const n = Number(env[nazwa]);
  return Number.isInteger(n) && n > 0 ? n : (LIMITY_KLUCZA_DOMYSLNE[silnik] || 0);
}

class Kubelek {
  constructor(nazwa, limit, { powrotMs = POWROT_MS, zapas = ZAPAS } = {}) {
    this.nazwa = nazwa;
    this.bazowy = limit;
    this.limit = limit;
    this.zajete = 0;
    this.przyjete = 0;
    this.kolejka = [];
    this.trzyma = new Map();
    this.ostatniModel = '';
    this.ost429 = 0;
    this.zgloszen429 = 0;
    this.maksKolejki = 0;
    this.powrotMs = powrotMs;
    this.zapas = zapas;
    this.odbudowa = null;
  }

  _wez(osoba, model) {
    this.zajete++;
    this.ostatniModel = model || this.ostatniModel;
    this.trzyma.set(osoba, (this.trzyma.get(osoba) || 0) + 1);
    let oddane = false; let przyjete = false;
    const zwolnij = () => {
      if (oddane) return;
      oddane = true;
      this.zajete--;
      if (przyjete) this.przyjete--;
      const n = (this.trzyma.get(osoba) || 1) - 1;
      if (n) this.trzyma.set(osoba, n); else this.trzyma.delete(osoba);
      this._dalej();
    };
    /* Dostawca przyjął (200) – to miejsce naprawdę jest u niego zajęte. */
    zwolnij.przyjete = () => { if (!przyjete && !oddane) { przyjete = true; this.przyjete++; } };
    return zwolnij;
  }

  /** Zwykły czat i prowadzący – bez czekania, ale liczone. */
  zajmijOdRazu(osoba, model = '') { return this._wez(osoba || '?', model); }

  /** Rola – czeka w kolejce. Abort zdejmuje ją z kolejki. */
  zajmij(osoba, signal, model = '') {
    osoba = osoba || '?';
    if (signal?.aborted) return Promise.reject(signal.reason || new Error('przerwane'));
    if (this.zajete < this.limit && !this.kolejka.length) return Promise.resolve(this._wez(osoba, model));
    return new Promise((ok, zle) => {
      const w = { osoba, model, od: Date.now(), ok: zwiazZKontekstem(ok), zle };
      const naAbort = () => {
        const i = this.kolejka.indexOf(w);
        if (i >= 0) this.kolejka.splice(i, 1);
        zle(signal.reason || new Error('przerwane'));
      };
      w.sprzatnij = () => signal?.removeEventListener('abort', naAbort);
      signal?.addEventListener('abort', naAbort, { once: true });
      this.kolejka.push(w);
      this.maksKolejki = Math.max(this.maksKolejki, this.kolejka.length);
    });
  }

  /** Pozycja w kolejce – do zdarzenia „czeka (n)”. */
  czekajacych() { return this.kolejka.length; }

  /** Nowe miejsce musiałoby czekać. */
  pelny() { return this.zajete >= this.limit; }

  _dalej() {
    while (this.zajete < this.limit && this.kolejka.length) {
      let i = 0;
      const ile = (w) => this.trzyma.get(w.osoba) || 0;
      for (let k = 1; k < this.kolejka.length; k++) {
        const a = this.kolejka[k]; const b = this.kolejka[i];
        if (ile(a) < ile(b) || (ile(a) === ile(b) && a.model === this.ostatniModel && b.model !== this.ostatniModel)) i = k;
      }
      const [w] = this.kolejka.splice(i, 1);
      w.sprzatnij();
      w.ok(this._wez(w.osoba, w.model));
    }
  }

  /** Dostawca odpowiedział 429. Limit schodzi do zmierzonej pojemności konta. */
  zglos429() {
    this.zgloszen429++;
    this.ost429 = Date.now();
    this.limit = Math.max(1, Math.min(this.limit, this.przyjete - this.zapas));
    clearInterval(this.odbudowa);
    this.odbudowa = setInterval(() => {
      if (Date.now() - this.ost429 < this.powrotMs) return;
      if (this.limit < this.bazowy) { this.limit++; this._dalej(); } else { clearInterval(this.odbudowa); this.odbudowa = null; }
    }, this.powrotMs);
    this.odbudowa.unref?.();
  }

  stan() {
    return { limit: this.limit, bazowy: this.bazowy, zajete: this.zajete, przyjete: this.przyjete,
      kolejka: this.kolejka.length, maksKolejki: this.maksKolejki, zgloszen429: this.zgloszen429 };
  }
}

/**
 * Para kubełków: model (pierwszy) i klucz (drugi). Ten sam interfejs co
 * Kubelek – czat, prowadzący i role nie wiedzą, że poziomy są dwa.
 * Kolejność zawsze model → klucz (bez zakleszczeń); czekając na klucz, rola
 * trzyma miejsce modelu – to nie marnuje klucza, bo klucz i tak jest pełny.
 */
class KubelekPara {
  constructor(model, klucz) {
    this.model = model;
    this.klucz = klucz;
    this.nazwa = model.nazwa;
  }

  get zajete() { return this.model.zajete; }
  get limit() { return this.model.limit; }
  /** Pełny, gdy pełny którykolwiek poziom (zdarzenie „czeka”). */
  pelny() { return this.model.pelny() || this.klucz.pelny(); }

  static polacz(a, b) {
    const zwolnij = () => { a(); b(); };
    zwolnij.przyjete = () => { a.przyjete(); b.przyjete(); };
    return zwolnij;
  }

  zajmijOdRazu(osoba, model = '') { return KubelekPara.polacz(this.model.zajmijOdRazu(osoba, model), this.klucz.zajmijOdRazu(osoba, model)); }

  async zajmij(osoba, signal, model = '') {
    const a = await this.model.zajmij(osoba, signal, model);
    try {
      const b = await this.klucz.zajmij(osoba, signal, model);
      return KubelekPara.polacz(a, b);
    } catch (err) { a(); throw err; }
  }

  czekajacych() { return this.model.czekajacych() + this.klucz.czekajacych(); }
  zglos429() { this.model.zglos429(); this.klucz.zglos429(); }
  stan() { return { ...this.model.stan(), klucz: this.klucz.stan() }; }
}

/** Rejestr kubełków. `ep` – silnik (baseUrl, apiKey), `silnik` – nazwa. */
function utworzPrzydzial({ env = process.env, powrotMs, zapas } = {}) {
  const kubelki = new Map();
  function kluczDla(ep, silnik, model) {
    const baza = String((ep && ep.baseUrl) || '').replace(/\/+$/, '');
    if (silnik === 'local') return `local|${baza}`;
    return `${silnik}|${baza}|${String((ep && ep.apiKey) || '').slice(-6)}|${model || ''}`;
  }
  const kubelek = (k, limit) => {
    let b = kubelki.get(k);
    if (!b) { b = new Kubelek(k, limit, { powrotMs, zapas }); kubelki.set(k, b); }
    return b;
  };
  function dla(ep, silnik, model) {
    const k = kluczDla(ep, silnik, model);
    const b = kubelek(k, limitDla(silnik, env));
    const naKlucz = silnik === 'local' ? 0 : limitKluczaDla(silnik, env);
    if (!naKlucz) return b;
    // Kubełek klucza: ten sam adres i końcówka klucza, BEZ modelu (sufiks „|*”).
    return new KubelekPara(b, kubelek(`${k.slice(0, k.lastIndexOf('|'))}|*`, naKlucz));
  }
  /** Stan bez kluczy (do logu i testów): nazwa kubełka ma tylko 6 ostatnich znaków klucza. */
  function stan() {
    return [...kubelki.entries()].map(([k, b]) => ({ kubelek: k.replace(/\|[^|]*\|([^|]*)$/, '|…|$1'), ...b.stan() }));
  }
  return { dla, stan, kluczDla };
}

/* Jeden przydział na proces – czat i zespół muszą widzieć te same kubełki. */
const wspolny = utworzPrzydzial();

module.exports = { Kubelek, KubelekPara, utworzPrzydzial, wspolny, limitDla, limitKluczaDla, LIMITY_DOMYSLNE, LIMITY_KLUCZA_DOMYSLNE };

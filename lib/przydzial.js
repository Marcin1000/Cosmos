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
const ZAPAS = 2;
const POWROT_MS = Number(process.env.COSMOS_PRZYDZIAL_POWROT_MS) || 30_000;

function limitDla(silnik, env = process.env) {
  const nazwa = `COSMOS_ZESPOL_ROWNOLEGLE_${String(silnik || 'cloud').toUpperCase()}`;
  const n = Number(env[nazwa]);
  return Number.isInteger(n) && n > 0 ? n : (LIMITY_DOMYSLNE[silnik] || 4);
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

/** Rejestr kubełków. `ep` – silnik (baseUrl, apiKey), `silnik` – nazwa. */
function utworzPrzydzial({ env = process.env, powrotMs, zapas } = {}) {
  const kubelki = new Map();
  function kluczDla(ep, silnik, model) {
    const baza = String((ep && ep.baseUrl) || '').replace(/\/+$/, '');
    if (silnik === 'local') return `local|${baza}`;
    return `${silnik}|${baza}|${String((ep && ep.apiKey) || '').slice(-6)}|${model || ''}`;
  }
  function dla(ep, silnik, model) {
    const k = kluczDla(ep, silnik, model);
    let b = kubelki.get(k);
    if (!b) {
      b = new Kubelek(k, limitDla(silnik, env), { powrotMs, zapas });
      kubelki.set(k, b);
    }
    return b;
  }
  /** Stan bez kluczy (do logu i testów): nazwa kubełka ma tylko 6 ostatnich znaków klucza. */
  function stan() {
    return [...kubelki.entries()].map(([k, b]) => ({ kubelek: k.replace(/\|[^|]*\|([^|]*)$/, '|…|$1'), ...b.stan() }));
  }
  return { dla, stan, kluczDla };
}

/* Jeden przydział na proces – czat i zespół muszą widzieć te same kubełki. */
const wspolny = utworzPrzydzial();

module.exports = { Kubelek, utworzPrzydzial, wspolny, limitDla, LIMITY_DOMYSLNE };

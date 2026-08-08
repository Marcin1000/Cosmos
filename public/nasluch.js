/* ============================================================
   Nasłuch własnym strumieniem audio

   Po co, skoro przeglądarka ma Web Speech API? Bo Web Speech API ma trzy
   wady, których nie da się obejść od środka, i wszystkie trzy Marcin zgłosił
   z realnego użycia:

   1. MIKROFON JEST PRZEJMOWANY I ZWALNIANY przez przeglądarkę, a Android
      sygnalizuje to dźwiękiem. Stąd „ciągłe podłączanie i odłączanie".
   2. ROZPOZNAWANIE NIE DA SIĘ WYCISZYĆ. Kiedy Cosmos mówi, transkrybuje
      dalej — jego własny głos wraca jako pytanie i robi się pętla. Łataliśmy
      to znacznikami zużycia i odciskami wyników; działa, ale to obchodzenie
      cudzego automatu, a nie panowanie nad nim.
   3. NUMERACJA WYNIKÓW POTRAFI RUSZYĆ OD ZERA bez żadnego zdarzenia.

   Tutaj mikrofon otwieramy RAZ i trzymamy przez całą sesję głosową. Nic go
   nie przejmuje, więc nie ma dźwięków. Kiedy Cosmos mówi, po prostu wyrzucamy
   próbki do kosza (`gluchy`) — nie ma czego rozpoznać, więc nie ma pętli.
   Wypowiedzi wycinamy sami, mierząc energię sygnału, i wysyłamy do Whispera
   przez `/api/stt`.

   To jest pomysł z huggingface/speech-to-speech i Silero VAD, sprowadzony do
   tego, co da się zrobić bez ani jednej zewnętrznej biblioteki: detekcja mowy
   po energii sygnału z ruchomym progiem szumu tła. Silero jest mądrzejsze
   (sieć neuronowa odróżnia mowę od trzaśnięcia drzwiami), ale wymaga ONNX
   w przeglądarce albo usługi zmysłów — a to już nie jest „bez zależności".
   Gdy zmysły są włączone, sam Whisper i tak przepuszcza nagranie przez własny
   VAD (`vad_filter=True`), więc fałszywy wyzwalacz kończy się pustym tekstem,
   nie bzdurą.

   WYMAGA WHISPERA W ZMYSŁACH. Przy wyłączonym komputerze domowym nie ma
   dokąd wysłać dźwięku i tryb głosowy wraca do Web Speech API. Dlatego to
   jest WYBÓR silnika, a nie zamiennik — patrz „Nasłuch" w Ustawieniach.
   ============================================================ */

(function (global) {
  'use strict';

  /* Po tylu milisekundach bez ani jednej ramki uznajemy, że wejście umarło.
     Ramka przy 48 kHz i buforze 1024 to 21 ms, więc 2,5 s to ponad sto
     przegapionych — na pewno awaria, a nie chwilowe zadyszanie procesora. */
  const CISZA_ALARM_MS = 2500;

  const DOMYSLNE = {
    // Whisper i tak pracuje na 16 kHz. Wysyłanie 48 kHz to trzykrotnie
    // większy plik bez ani jednej dodatkowej informacji dla modelu.
    czestotliwosc: 16000,
    ramka: 1024,
    // Ile dźwięku SPRZED wykrycia mowy dokleić. Bez tego ginie pierwsza
    // głoska — próg przekracza dopiero samogłoska, a „Kosmos" zaczyna się
    // od cichego „k".
    przedbiegMs: 320,
    // Cisza kończąca wypowiedź. 700 ms to naturalna pauza między zdaniami
    // w mowie potocznej; poniżej 500 ms zdanie tnie się w środku.
    ciszaMs: 700,
    // Krótsze wycinki to zwykle kaszlnięcie albo stuknięcie w biurko.
    minMowyMs: 350,
    // Twardy limit — inaczej ciągły hałas rósłby w nieskończoność w pamięci.
    maxMowyMs: 15000,
    // Ile ramek pod rząd musi przekroczyć próg, żeby uznać to za mowę.
    ramekNaStart: 3,
  };

  function dostepny() {
    return Boolean(
      global.AudioContext || global.webkitAudioContext
    ) && Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /** Float32 [-1,1] w dowolnej częstotliwości → Int16 PCM w docelowej.
   *
   *  Uśrednianie okna, nie wybieranie co n-tej próbki. Wybieranie jest
   *  szybsze i daje ALIASING: przy 48→16 kHz wszystko powyżej 8 kHz wraca
   *  do pasma jako świst. Uśrednianie działa jak prosty filtr dolnoprzepustowy
   *  — to nie jest porządny resampler, ale dla mowy różnica jest słyszalna
   *  na korzyść uśredniania i kosztuje jedno dodanie na próbkę.
   */
  function przeprobkuj(probki, zrodlowa, docelowa) {
    if (docelowa >= zrodlowa) {
      const out = new Int16Array(probki.length);
      for (let i = 0; i < probki.length; i++) out[i] = doInt16(probki[i]);
      return out;
    }
    const krok = zrodlowa / docelowa;
    const dlugosc = Math.floor(probki.length / krok);
    const out = new Int16Array(dlugosc);
    for (let i = 0; i < dlugosc; i++) {
      const od = Math.floor(i * krok);
      const doIdx = Math.min(probki.length, Math.floor((i + 1) * krok));
      let suma = 0;
      let ile = 0;
      for (let j = od; j < doIdx; j++) { suma += probki[j]; ile++; }
      out[i] = doInt16(ile ? suma / ile : 0);
    }
    return out;
  }

  function doInt16(x) {
    const v = Math.max(-1, Math.min(1, x));
    return v < 0 ? v * 0x8000 : v * 0x7fff;
  }

  /** Int16 PCM → kompletny plik WAV (RIFF, mono).
   *  Whisper przyjmuje webm z MediaRecordera, ale wtedy dekoduje go ffmpegiem;
   *  surowy WAV omija ten krok i nie wymaga MediaRecordera w ogóle. */
  function wav(pcm, czestotliwosc) {
    const bufor = new ArrayBuffer(44 + pcm.length * 2);
    const w = new DataView(bufor);
    const tekst = (poz, s) => { for (let i = 0; i < s.length; i++) w.setUint8(poz + i, s.charCodeAt(i)); };
    tekst(0, 'RIFF');
    w.setUint32(4, 36 + pcm.length * 2, true);
    tekst(8, 'WAVE');
    tekst(12, 'fmt ');
    w.setUint32(16, 16, true);          // długość bloku fmt
    w.setUint16(20, 1, true);           // PCM bez kompresji
    w.setUint16(22, 1, true);           // mono
    w.setUint32(24, czestotliwosc, true);
    w.setUint32(28, czestotliwosc * 2, true);  // bajtów na sekundę
    w.setUint16(32, 2, true);           // bajtów na próbkę
    w.setUint16(34, 16, true);          // bitów na próbkę
    tekst(36, 'data');
    w.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) w.setInt16(44 + i * 2, pcm[i], true);
    return new Blob([bufor], { type: 'audio/wav' });
  }

  /** Jeden nasłuch: mikrofon, wycinanie wypowiedzi, wołanie o transkrypcję. */
  function utworz(opcje) {
    const o = Object.assign({}, DOMYSLNE, opcje || {});
    const onWypowiedz = o.onWypowiedz || (() => {});
    const onPoziom = o.onPoziom || (() => {});
    const onBlad = o.onBlad || (() => {});
    o.onCisza = o.onCisza || (() => {});

    let ctx = null;
    let strumien = null;
    let zrodlo = null;
    let procesor = null;
    let cisza = null;             // węzeł o zerowym wzmocnieniu (patrz niżej)
    let dziala = false;
    let gluchyFlag = false;
    let ostatniaRamka = 0;      // kiedy ostatnio przyszła ramka dźwięku
    let pilnowanie = null;      // odliczanie „mikrofon zamilkł"
    let cisząZgloszona = false;

    // Stan wykrywania mowy
    let tlo = 0.01;               // ruchomy poziom szumu otoczenia
    let wMowie = false;
    let ramekGlosnych = 0;
    let ramekCichych = 0;
    let zebrane = [];             // Float32Array[] bieżącej wypowiedzi
    let zebranychProbek = 0;
    /* Ile z zebranego to NAPRAWDĘ dźwięk. Liczone osobno, bo w `zebrane`
       siedzi też przedbieg i ogon ciszy domykający wypowiedź — razem ponad
       sekunda. Gdyby minimalną długość mierzyć całą paczką, to stuknięcie
       w biurko (0,1 s) wychodziłoby na „wypowiedź długą na 1,2 s" i lądowało
       u Whispera. Test `nasluch-wlasny` (6a) właśnie na to wpadł. */
    let ramekDzwieku = 0;
    let przedbieg = [];           // ostatnie ramki sprzed wykrycia mowy
    let przedbiegProbek = 0;

    function wyzeruj() {
      wMowie = false;
      ramekGlosnych = 0;
      ramekCichych = 0;
      zebrane = [];
      zebranychProbek = 0;
      ramekDzwieku = 0;
      przedbieg = [];
      przedbiegProbek = 0;
    }

    async function start(ograniczenia) {
      if (dziala) return true;
      const Ctx = global.AudioContext || global.webkitAudioContext;
      strumien = await navigator.mediaDevices.getUserMedia(ograniczenia || {
        audio: {
          echoCancellation: true,     // ważne: bez tego głośnik telefonu
          noiseSuppression: true,     // wraca do mikrofonu mimo `gluchy`
          autoGainControl: true,
        },
      });
      ctx = new Ctx();
      if (ctx.state === 'suspended') await ctx.resume();
      zrodlo = ctx.createMediaStreamSource(strumien);

      /* ScriptProcessorNode, nie AudioWorklet — świadomie.
         Worklet jest nowszy i nie blokuje wątku głównego, ale wymaga
         OSOBNEGO PLIKU MODUŁU ładowanego przez addModule(). To znaczy: kolejny
         wpis w service workerze, kolejna rzecz do przegapienia przy
         odświeżaniu pamięci podręcznej i kolejny powód, żeby tryb głosowy
         przestał działać po wdrożeniu. Liczenie energii z ramki 1024 próbek
         to kilka tysięcy operacji zmiennoprzecinkowych ~47 razy na sekundę —
         wątku głównego to nie ruszy. „Przestarzały" nie znaczy „usunięty". */
      procesor = ctx.createScriptProcessor(o.ramka, 1, 1);
      procesor.onaudioprocess = (e) => ramka(e.inputBuffer.getChannelData(0));

      /* Procesor musi mieć DOKĄD wysyłać dźwięk, inaczej część przeglądarek
         w ogóle go nie uruchamia. Wysyłamy więc do wyjścia przez wzmocnienie
         zero — bo puszczenie mikrofonu na głośnik to sprzężenie w najbardziej
         dosłownym, akustycznym sensie. */
      cisza = ctx.createGain();
      cisza.gain.value = 0;
      zrodlo.connect(procesor);
      procesor.connect(cisza);
      cisza.connect(ctx.destination);

      /* ---- CZUJNIK GŁUCHOTY ------------------------------------------
         Najgorsza możliwa awaria tego modułu nie jest głośna. Jest CICHA:
         mikrofon przestaje dawać próbki, a interfejs dalej pokazuje
         „SŁUCHAM…". Człowiek mówi do ekranu i nie rozumie, dlaczego nic
         się nie dzieje. Trzy realne drogi do tego stanu, wszystkie na
         telefonie:

           1. WYGASZONY EKRAN — Android usypia AudioContext. Wraca sam po
              odblokowaniu, ale tylko jeśli ktoś go obudzi.
           2. POŁĄCZENIE PRZYCHODZĄCE albo inna aplikacja przejmująca
              mikrofon — ścieżka dostaje `mute`, a czasem `ended`.
           3. ODŁĄCZONE SŁUCHAWKI — ścieżka kończy się na dobre i nie
              wróci; trzeba wziąć mikrofon od nowa.

         Żadna z nich nie rzuca wyjątkiem. Dlatego pilnujemy tego z trzech
         stron naraz: stanu kontekstu, zdarzeń ścieżki i — bo tamte dwa
         potrafią milczeć — licznika czasu od ostatniej ramki. */
      ctx.onstatechange = () => {
        if (!dziala || !ctx) return;
        if (ctx.state === 'running') return;
        // „interrupted" to stan z Safari na iOS; nie ma go w standardzie.
        ctx.resume().catch(() => {});
        zglosCisze(ctx.state === 'closed' ? 'kontekst zamknięty' : 'dźwięk uśpiony');
      };
      for (const tr of strumien.getTracks()) {
        tr.onended = () => zglosCisze('mikrofon odłączony');
        tr.onmute = () => zglosCisze('mikrofon wyciszony przez system');
      }
      ostatniaRamka = Date.now();
      pilnowanie = setInterval(() => {
        if (!dziala || gluchyFlag) return;
        if (Date.now() - ostatniaRamka > CISZA_ALARM_MS) zglosCisze('brak sygnału z mikrofonu');
      }, 2000);

      wyzeruj();
      tlo = 0.01;
      dziala = true;
      return true;
    }

    /* Zgłaszamy RAZ na epizod, nie co dwie sekundy. Powtarzany komunikat
       w kółko jest tak samo bezużyteczny jak jego brak, a przy odzyskaniu
       dźwięku i tak zerujemy znacznik. */
    function zglosCisze(powod) {
      if (cisząZgloszona) return;
      cisząZgloszona = true;
      o.onCisza(powod);
    }

    function stop() {
      dziala = false;
      wyzeruj();
      clearInterval(pilnowanie);
      pilnowanie = null;
      cisząZgloszona = false;
      try { if (ctx) ctx.onstatechange = null; } catch { /* już zwolniony */ }
      try { if (procesor) procesor.onaudioprocess = null; } catch { /* już zwolniony */ }
      try { if (zrodlo) zrodlo.disconnect(); } catch { /* jw. */ }
      try { if (procesor) procesor.disconnect(); } catch { /* jw. */ }
      try { if (cisza) cisza.disconnect(); } catch { /* jw. */ }
      if (strumien) strumien.getTracks().forEach((tr) => tr.stop());
      if (ctx) { try { ctx.close(); } catch { /* jw. */ } }
      ctx = null; strumien = null; zrodlo = null; procesor = null; cisza = null;
    }

    /** Głuchy = mikrofon nadal otwarty, ale próbki lecą do kosza.
     *  To jest cała naprawa sprzężenia: nie ma czego rozpoznać. */
    function gluchy(wlacz) {
      const zmiana = gluchyFlag !== Boolean(wlacz);
      gluchyFlag = Boolean(wlacz);
      // Wypowiedź zaczęta tuż przed wyciszeniem nie ma prawa się dokończyć.
      if (zmiana) wyzeruj();
    }

    function ramka(dane) {
      if (!dziala) return;
      ostatniaRamka = Date.now();
      // Dźwięk wrócił — kolejna awaria ma znów dojść do interfejsu.
      cisząZgloszona = false;

      let suma = 0;
      for (let i = 0; i < dane.length; i++) suma += dane[i] * dane[i];
      const rms = Math.sqrt(suma / dane.length);

      if (gluchyFlag) {
        /* Tło uczymy się DALEJ, choć wypowiedzi nie zbieramy. Gdyby stanęło,
           to po długiej odpowiedzi Cosmosa próg pamiętałby ciszę sprzed niej
           i pierwsze zdanie po wznowieniu wpadałoby na starym, złym progu. */
        uczTlo(rms);
        onPoziom(0);
        return;
      }

      onPoziom(Math.min(1, rms * 12));

      const prog = Math.max(tlo * 3.5, 0.006);
      const glosno = rms > prog;

      if (!wMowie) {
        // Przedbieg: trzymamy ostatnie ~300 ms na wypadek, gdyby zaraz padło słowo.
        przedbieg.push(new Float32Array(dane));
        przedbiegProbek += dane.length;
        const limit = (o.przedbiegMs / 1000) * czestotliwoscWejscia();
        while (przedbiegProbek > limit && przedbieg.length > 1) {
          przedbiegProbek -= przedbieg.shift().length;
        }
        if (glosno) {
          ramekGlosnych++;
          if (ramekGlosnych >= o.ramekNaStart) {
            wMowie = true;
            ramekCichych = 0;
            ramekDzwieku = ramekGlosnych;
            zebrane = przedbieg.slice();
            zebranychProbek = przedbiegProbek;
            przedbieg = [];
            przedbiegProbek = 0;
          }
        } else {
          ramekGlosnych = 0;
          uczTlo(rms);
        }
        return;
      }

      zebrane.push(new Float32Array(dane));
      zebranychProbek += dane.length;
      const naSekunde = czestotliwoscWejscia();

      if (glosno) {
        ramekCichych = 0;
        ramekDzwieku++;
      } else {
        ramekCichych++;
        uczTlo(rms);
        if ((ramekCichych * dane.length) / naSekunde * 1000 >= o.ciszaMs) {
          domknij(naSekunde);
          return;
        }
      }
      if ((zebranychProbek / naSekunde) * 1000 >= o.maxMowyMs) domknij(naSekunde);
    }

    /* Szum tła: SZYBKO w dół, WOLNO w górę.
       Odwrotna asymetria byłaby katastrofą — jeden przejeżdżający samochód
       podniósłby próg i Cosmos ogłuchłby na kilka minut. Tak dobrany filtr
       schodzi do prawdziwej ciszy w ułamku sekundy, a rośnie w ciągu minut,
       więc dostosowuje się do pokoju, a nie do pojedynczego hałasu. */
    function uczTlo(rms) {
      tlo = rms < tlo ? (rms * 0.25 + tlo * 0.75) : (rms * 0.002 + tlo * 0.998);
      if (!(tlo > 0)) tlo = 0.001;
    }

    function czestotliwoscWejscia() {
      return (ctx && ctx.sampleRate) || 48000;
    }

    function domknij(naSekunde) {
      const probek = zebranychProbek;
      const kawalki = zebrane;
      const glosnych = ramekDzwieku;
      wMowie = false;
      ramekGlosnych = 0;
      ramekCichych = 0;
      ramekDzwieku = 0;
      zebrane = [];
      zebranychProbek = 0;
      // Miarą jest DŹWIĘK, nie długość paczki — patrz komentarz przy ramekDzwieku.
      if ((glosnych * o.ramka / naSekunde) * 1000 < o.minMowyMs) return;   // kaszlnięcie

      const plaskie = new Float32Array(probek);
      let poz = 0;
      for (const k of kawalki) { plaskie.set(k, poz); poz += k.length; }
      const pcm = przeprobkuj(plaskie, naSekunde, o.czestotliwosc);
      wyslij(wav(pcm, o.czestotliwosc));
    }

    async function wyslij(blob) {
      try {
        const res = await fetch('/api/stt', {
          method: 'POST',
          headers: { 'Content-Type': 'audio/wav' },
          body: blob,
        });
        let dane = {};
        try { dane = await res.json(); } catch { /* nie-JSON = i tak błąd */ }
        if (!res.ok) throw new Error(dane.error || `HTTP ${res.status}`);
        const tekst = String(dane.text || '').trim();
        // Whisper na czystym szumie oddaje puste albo same znaki interpunkcyjne.
        if (tekst && /[\p{L}\p{N}]/u.test(tekst)) onWypowiedz(tekst);
      } catch (err) {
        onBlad(err);
      }
    }

    return { start, stop, gluchy, dziala: () => dziala, czyGluchy: () => gluchyFlag,
      zywy: () => dziala && Date.now() - ostatniaRamka < CISZA_ALARM_MS };
  }

  /** Jednorazowe nagranie o zadanej długości → Blob WAV.
   *  Używane przez rozpoznawanie ptaków: tam nie chodzi o mowę, więc nie ma
   *  czego wycinać, a częstotliwość zostaje wysoka (śpiew ptaków sięga
   *  kilkunastu kHz i przy 16 kHz próbkowania połowa gatunków traci to,
   *  po czym się je rozpoznaje). */
  async function nagrajWav(ms, opcje) {
    const o = opcje || {};
    const Ctx = global.AudioContext || global.webkitAudioContext;
    const strumien = await navigator.mediaDevices.getUserMedia(o.ograniczenia || {
      // Bez „ulepszaczy": redukcja szumu wycina dokładnie te ciche, wysokie
      // dźwięki, które są tu całą treścią.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = new Ctx();
    if (ctx.state === 'suspended') await ctx.resume();
    const zrodlo = ctx.createMediaStreamSource(strumien);
    const procesor = ctx.createScriptProcessor(4096, 1, 1);
    const cisza = ctx.createGain();
    cisza.gain.value = 0;
    const kawalki = [];
    let probek = 0;
    procesor.onaudioprocess = (e) => {
      kawalki.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      probek += e.inputBuffer.length;
      if (o.onPoziom) {
        const d = e.inputBuffer.getChannelData(0);
        let s = 0;
        for (let i = 0; i < d.length; i++) s += d[i] * d[i];
        o.onPoziom(Math.min(1, Math.sqrt(s / d.length) * 12));
      }
    };
    zrodlo.connect(procesor);
    procesor.connect(cisza);
    cisza.connect(ctx.destination);

    const czestotliwosc = ctx.sampleRate;
    await new Promise((ok) => setTimeout(ok, ms));

    procesor.onaudioprocess = null;
    try { zrodlo.disconnect(); procesor.disconnect(); cisza.disconnect(); } catch { /* jw. */ }
    strumien.getTracks().forEach((tr) => tr.stop());
    try { ctx.close(); } catch { /* jw. */ }

    const plaskie = new Float32Array(probek);
    let poz = 0;
    for (const k of kawalki) { plaskie.set(k, poz); poz += k.length; }
    const doc = Math.min(czestotliwosc, o.czestotliwosc || 48000);
    return wav(przeprobkuj(plaskie, czestotliwosc, doc), doc);
  }

  global.NasluchWlasny = { dostepny, utworz, nagrajWav, wav, przeprobkuj };
})(window);

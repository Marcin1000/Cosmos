# 📱 Android a włączony komputer — jak to naprawdę działa

To najważniejsze pytanie do zrozumienia, zanim zaczniesz używać Cosmosa na telefonie.
Odpowiadam wprost, bez owijania.

---

## Krótka odpowiedź

**Tak — żeby Cosmos działał na Androidzie, komputer z serwerem musi być włączony.**
Gdy komputer jest wyłączony, telefon nie ma się z czym połączyć i Cosmos na telefonie
nie zadziała (poza otwarciem samej aplikacji i podejrzeniem ostatnich rozmów offline).

To jest zasadnicza różnica między Cosmosem a ChatGPT:
- **ChatGPT** działa w gigantycznych centrach danych OpenAI, które są włączone
  24 godziny na dobę. Dlatego masz do niego dostęp zawsze.
- **Cosmos** to Twój prywatny system — „centrum danych" to Twój komputer. Jest włączony
  wtedy, kiedy Ty go włączysz.

To jest **cena suwerenności**: Twoje dane, modele i klucze są u Ciebie, nikt inny ich
nie widzi — ale to Ty odpowiadasz za to, żeby serwer działał.

---

## Dlaczego tak jest?

Na komputerze działają trzy rzeczy naraz:
1. **Mózg lokalny** — modele AI na Twojej karcie RTX 3080 (bez komputera = brak karty).
2. **Twoje dane** — rozmowy, pamięć, baza wiedzy (leżą w folderze `data` na dysku PC).
3. **Serwer** — pośrednik, przez który telefon rozmawia z modelami i sięga po dane.

Telefon sam z siebie nie ma ani Twojej karty graficznej, ani Twoich plików. On tylko
wyświetla i wysyła pytania do komputera. Nie ma komputera — nie ma z kim rozmawiać.

---

## Co dokładnie działa, a co nie, gdy komputer jest wyłączony

| Na telefonie | Komputer włączony | Komputer wyłączony |
|---|---|---|
| Otwarcie aplikacji Cosmos | ✅ | ✅ (sama aplikacja jest zapamiętana) |
| Podejrzenie ostatnio otwartych rozmów | ✅ | ✅ (kopia offline, tylko do czytania) |
| Nowa rozmowa / odpowiedź AI | ✅ | ❌ |
| Dostęp do pełnej historii i bazy wiedzy | ✅ | ❌ |
| Głos, generowanie grafik/wideo | ✅ | ❌ |

---

## Twoje możliwości — od najprostszej do najbardziej „jak w centrum danych"

### Opcja 1 — Włączaj komputer, gdy chcesz używać (najprostsze, 0 zł)
Traktuj to jak laptopa: chcesz porozmawiać z Cosmosem → włączasz komputer.
Dla wielu osób to zupełnie wystarcza. Nic nie musisz konfigurować.

**Ułatwienie:** ustaw serwer tak, żeby startował sam po włączeniu komputera
(patrz sekcja „Automatyczny start" niżej) — wtedy po prostu włączasz PC i po chwili
Cosmos jest gotowy, także na telefonie.

### Opcja 2 — Budź komputer zdalnie (Wake-on-LAN)
Komputer śpi (nie zużywa prądu), a gdy chcesz go użyć, „budzisz" go z telefonu
jedną aplikacją.
- Włącz **Wake-on-LAN** w BIOS komputera i w ustawieniach karty sieciowej Windows.
- Na telefonie zainstaluj aplikację typu „Wake on LAN".
- Efekt: klikasz w telefonie, komputer się budzi w kilkanaście sekund, Cosmos działa.
- Działa najlepiej w domowej sieci; poza domem wymaga dodatkowej konfiguracji.

### Opcja 3 — Mały, tani komputer zawsze włączony (zalecane, jeśli chcesz „zawsze pod ręką")
To najlepszy kompromis między kosztem prądu a wygodą.
- Kup tani mini-komputer (np. mini PC lub Raspberry Pi) albo użyj starego laptopa.
- Na nim uruchom **tylko serwer Cosmosa** (jest lekki — nie potrzebuje mocnej karty).
- Twoje rozmowy, pamięć i baza wiedzy leżą na tym małym, cichym urządzeniu włączonym 24/7.
- Do rozmów używa **chmury** (NVIDIA / OpenAI / Claude) — tam jest moc obliczeniowa.
- Duży komputer z RTX 3080 włączasz **tylko wtedy**, gdy chcesz liczyć lokalnie
  (ciężka grafika, prywatne dane bez chmury).

To dokładnie wzorzec „mały mózg zawsze czuwa, wielki mózg budzi się na żądanie".
Mini PC pobiera kilka watów — prąd to grosze miesięcznie.

### Opcja 4 — Serwer w chmurze (VPS)
Wynajmujesz mały serwer w internecie (kilkanaście złotych miesięcznie) i tam stawiasz
serwer Cosmosa. Jest wtedy włączony zawsze i dostępny z każdego miejsca.
- **Zaleta:** działa 24/7 bez Twojego sprzętu, dostęp z całego świata.
- **Wada:** Twoje dane (rozmowy, baza wiedzy) leżą wtedy na cudzym serwerze, a nie u Ciebie
  — tracisz część prywatności. Lokalna karta RTX 3080 i tak jest nieosiągalna, gdy
  duży komputer jest wyłączony.
- Dobre, jeśli używasz głównie modeli z chmury i zależy Ci na dostępie zewsząd.

### Moja rekomendacja
- **Na start:** Opcja 1 (włączaj, gdy używasz) + automatyczny start serwera.
- **Gdy poczujesz, że chcesz Cosmosa „zawsze":** Opcja 3 (mały mini-PC 24/7 do serwera
  i danych, duży komputer tylko do liczenia na GPU). To najlepszy balans prywatności,
  kosztu i wygody.

---

## Dostęp poza domem (Tailscale)

Domyślnie telefon łączy się z komputerem tylko w tej samej sieci Wi-Fi. Żeby mieć
dostęp z dowolnego miejsca **bez otwierania portów i bez ryzyka**:

1. Załóż darmowe konto na **https://tailscale.com**.
2. Zainstaluj Tailscale na komputerze **i** na telefonie, zaloguj się tym samym kontem.
3. Tailscale nada komputerowi stały prywatny adres (np. `100.x.x.x`).
4. Na telefonie otwieraj Cosmos pod tym adresem: `http://100.x.x.x:3000`.

To tworzy prywatny, szyfrowany tunel tylko między Twoimi urządzeniami. Nikt z zewnątrz
nie ma dostępu. (Komputer i tak musi być włączony — Tailscale tylko łączy, nie budzi.)

---

## Automatyczny start serwera po włączeniu komputera (Windows)

Żeby nie wpisywać `npm start` za każdym razem:

1. W folderze `C:\Cosmos` utwórz plik tekstowy **`start-cosmos.bat`** o treści:
   ```bat
   cd /d C:\Cosmos
   npm start
   ```
2. Naciśnij `Windows + R`, wpisz `shell:startup`, Enter — otworzy się folder
   „Autostart".
3. Wrzuć do niego skrót do `start-cosmos.bat`.

Od teraz serwer uruchomi się sam przy każdym włączeniu komputera. Cosmos będzie gotowy
na komputerze i na telefonie (gdy komputer jest włączony).

> Chcesz, żeby serwer działał, nawet gdy nikt nie jest zalogowany (np. na mini-PC z
> Opcji 3)? Użyj narzędzia typu **NSSM** (darmowe), które uruchamia Cosmos jako usługę
> Windows w tle. To temat na osobno — napisz, pomogę skonfigurować.

---

## Podsumowanie w jednym zdaniu

Cosmos to Twój prywatny asystent — działa, gdy działa jego serwer; na start włączaj
komputer wtedy, gdy chcesz go używać, a jeśli zechcesz mieć go „zawsze", postaw serwer
na małym, tanim urządzeniu włączonym 24/7, zostawiając wielki komputer z RTX tylko do
zadań wymagających mocy.

# Grafiki Cosmosa do serwisów społecznościowych

Renderuje je `scripts/grafiki-marki.js` z tych samych czcionek (Onest, Martian Mono),
kolorów silników i znaku co aplikacja i strona produktowa. W środku są prawdziwe zrzuty
aplikacji z `scripts/zrzuty-readme.js` (dane testowe, nie prywatne). Każdy plik jest po
polsku (`-pl`) i po angielsku (`-en`).

```bash
NODE_PATH=/opt/node22/lib/node_modules node scripts/zrzuty-readme.js   # najpierw zrzuty
NODE_PATH=/opt/node22/lib/node_modules node scripts/grafiki-marki.js   # potem grafiki
```

| Plik | Rozmiar | Gdzie |
|---|---|---|
| `linkedin-post-*.jpg` | 1200×627 | post z obrazem i podgląd udostępnionego linku na LinkedIn; pasuje też do Facebooka |
| `linkedin-post-*-ciemny.jpg` | 1200×627 | to samo w ciemnym motywie — lepiej wygląda przy ciemnym LinkedIn |
| `linkedin-kwadrat-*.jpg` | 1080×1080 | post kwadratowy: LinkedIn, Instagram, Facebook |
| `linkedin-pion-*.jpg` | 1080×1350 | post pionowy 4:5 — zajmuje najwięcej miejsca w strumieniu na telefonie |
| `linkedin-baner-*.jpg` | 1584×396 | tło profilu LinkedIn (Profil → ikona ołówka na tle). Lewa trzecia część jest celowo pusta: tam wchodzi zdjęcie profilowe |
| `x-*.jpg` | 1600×900 | post na X (Twitter); także slajd 16:9 |
| `relacja-*.jpg` | 1080×1920 | relacja/story 9:16: Instagram, Facebook |
| `github-podglad.jpg` | 1280×640 | podgląd repozytorium na GitHubie: **Settings → General → Social preview → Edit → Upload an image**. GitHub nie pozwala ustawić go przez API |

Liczb i nazw modeli, które się starzeją, jest tu mało celowo: „ponad 100 zestawów testów”
zamiast dokładnej liczby, modele tylko w podpisach wątku.

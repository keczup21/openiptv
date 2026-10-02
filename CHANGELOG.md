# Changelog

Wszystkie istotne zmiany w projekcie **OpenIPTV** są tu dokumentowane.
Format oparty na [Keep a Changelog](https://keepachangelog.com/), wersje wg [SemVer](https://semver.org/).

**Jak numerujemy wersje:** gruba zmiana (nowa funkcja, przebudowa) podbija
środkową liczbę — `1.19.0 → 1.20.0`, a poprawka albo drobiazg ostatnią —
`1.19.0 → 1.19.1`. Wszystkie cztery miejsca z numerem (`www/app.js`,
`www/appinfo.json`, `package.json`, `android/app/build.gradle`) podbija jedna
komenda: `npm run bump -- X.Y.Z`.

## [1.19.4] — 2026-10-02

### Naprawiono
- **Sprawdzanie aktualizacji na Fire TV / Androidzie działa.** Gdy GitHub
  odpowiedział „application/json”, natywne pobieranie oddawało gotowy obiekt
  zamiast tekstu, więc aplikacja mówiła „panel Xtream zwrócił nieprawidłową
  odpowiedź”. Teraz JSON czytany jest poprawnie, a komunikat o panelu dotyczy
  tylko panelu.

### Dodano
- **Informacja o nowszej wersji po włączeniu.** Numer nowej wersji widać
  w nagłówku ekranu głównego, pod numerem wersji — nie tylko w ustawieniach.

## [1.19.3] — 2026-10-02

### Dodano
- **Przewijanie na żywo.** Na kanale na żywo `⏪` wchodzi w catch-up i cofa obraz
  o krok („Krok przewijania archiwum”: 5 / 10 / 30 s). Kolejne `⏪` na początku
  okna sięgają dalej wstecz, a `⏩` idzie do przodu tym samym krokiem.

### Naprawiono
- **`⏩` na końcu okna wraca na żywo.** Przy programie, który wciąż leci, okno
  nagrania było zamrożone na chwili włączenia, więc przewijanie do przodu nie
  dawało żadnego efektu. Teraz `⏩` na końcu takiego okna przełącza na LIVE,
  a na kanale na żywo pokazuje pasek, że obraz już jest na żywo.
- Podpowiedź na pasku nie obiecuje już przewijania nagrania na żywo.

## [1.19.2] — 2026-10-02

### Naprawiono
- **OK na pilocie Fire TV rozwija pola formularza.** Klawisz OK był zjadany przez
  obsługę pilota, więc nie dawało się rozwinąć listy „Typ źródła”. Teraz trafia do
  WebView (lista, kalendarz, klawiatura), a `checkbox`/`radio` przełączamy sami.
- **Interfejs nie jest dwa razy za duży na Fire TV / Android TV.** Strona układa
  się w stałej szerokości 1920 px, a `MainActivity.applyTvViewport()` włącza
  obsługę „meta viewport”, dzięki czemu projekt jest skalowany do ekranu.

## [1.19.1] — 2026-10-02

### Zmieniono
- **Aktualizacja tylko informuje.** Wejście w ustawienia sprawdza cicho najnowsze
  wydanie i pokazuje numer nowszej wersji oraz krótko, co się zmieniło (pierwsze
  punkty opisu wydania, bez markdownu). Pobranie i instalację uruchamia dopiero
  przycisk `Pobierz i zainstaluj` — nic nie dzieje się w tle.
- **Wersje podbite w czterech miejscach**: `www/app.js` (`APP_VERSION`),
  `www/appinfo.json`, `package.json` i `android/app/build.gradle`
  (`versionName` + `versionCode 21`).
- **Wydanie developerskie w repozytorium.** `npm run build:android` tworzy jedną
  paczkę `.apk` bez żadnej konfiguracji trzymanej poza repozytorium, a `app.js`,
  `build.gradle` opisują tylko ten build — na GitHub idzie gotowy plik z `dist`
  (`.apk` + `.ipk`) do instalacji na własnym sprzęcie.

## [1.19.0] — 2026-10-02

### Dodano
- **Aktualizacja z aplikacji (Android TV / Fire TV).** W ustawieniach jest sekcja
  „AKTUALIZACJE”: przycisk `Sprawdź aktualizacje` pyta GitHuba o najnowsze
  wydanie (`releases/latest`), porównuje numery wersji i mówi, czy jest nowsza.
  Na Androidzie i Fire TV przycisk `Pobierz i zainstaluj` pobiera
  `OpenIPTV-<wersja>.apk` i przekazuje go systemowemu instalatorowi (`UpdatePlugin.java`,
  `FileProvider` + `REQUEST_INSTALL_PACKAGES`), więc aktualizacja nie wymaga już
  ADB ani komputera. Gdy system blokuje instalację z nieznanych źródeł, aplikacja
  sama otwiera ekran, na którym włącza się tę zgodę dla OpenIPTV.
- **webOS dostaje ten sam przycisk, ale bez cichej instalacji.** Ten system nie
  instaluje `.ipk` sam, więc przy nowszym wydaniu aplikacja pokazuje wersję,
  nazwę paczki oraz adres wydania — paczkę wgrywa się z komputera przez tryb
  deweloperski (`ares-install`).
- **Wersje podbite w czterech miejscach**: `www/app.js` (`APP_VERSION`),
  `www/appinfo.json`, `package.json` i `android/app/build.gradle`
  (`versionName` + `versionCode 20`).

## [1.18.2] — 2026-10-02

### Dodano
- **Więcej funkcji na stronie projektu.** Sekcja „Co potrafi” w `docs/index.html`
  ma dwanaście kart — doszły: kolejność silników odtwarzania (natywnie → TS/MSE →
  HLS → ten sam kanał jako `.m3u8`), ponawianie i komunikaty błędów, sterowanie
  nagraniem na pilocie, menu kanału pod długim OK, ustawienia archiwum i EPG oraz
  źródła EPG (plik, spakowany `.gz`, automatyczne `xmltv.php` z panelu Xtream).

### Zmieniono
- **Czytelne nazwy paczek**: `OpenIPTV-<wersja>.apk` i `OpenIPTV-<wersja>.ipk`
  zamiast `pl.openiptv.player_<wersja>_all.ipk`; `scripts/build-webos.ps1` sam
  zmienia nazwę nadaną przez `ares-package`.
- **Wydania z gotowych paczek**: `scripts/publish.ps1` ma przełącznik `-Release`,
  który po commicie buduje paczki (`npm run build:all`) i tworzy wydanie na
  GitHubie z `OpenIPTV-<wersja>.apk` oraz `OpenIPTV-<wersja>.ipk`. Gdy brakuje
  gotowego pliku, publikacja przerywa się błędem.

## [1.18.1] — 2026-10-02

### Zmieniono
- **Wersje podbite w czterech miejscach**: `www/app.js` (`APP_VERSION`),
  `www/appinfo.json`, `package.json` i `android/app/build.gradle`
  (`versionName` + `versionCode 18`), dzięki czemu webOS i Android widzą nowszą
  paczkę niż wydanie 1.18.0.

## [1.18.0] — 2026-10-01

### Dodano
- **Strona projektu w `docs/`** (`npm run serve:docs` daje podgląd na localhost).
- **`scripts/publish.ps1`**: `npm run publish --message="..."` robi stage, commit
  i push, opcjonalnie z tagiem (`--tag=v1.19.0`).

### Naprawiono
- **Program TV nie otwierał się.** W pętli rysującej oś czasu `var t = new Date(...)`
  zasłaniało funkcję tłumaczeń `t()`, więc rysowanie każdej godziny kończyło się
  wyjątkiem „t is not a function” i ekran zostawał pusty. Zmienna nazywa się
  teraz `hourDate`.
- **Czarny ekran, gdy dekoder sprzętowy nie ruszył strumienia.** Odtwarzacz ma
  budzik `START_TIMEOUT` (9 s) pilnujący, czy obraz faktycznie wystartował, i
  kolejkę prób (natywnie, MSE, HLS, ten sam kanał jako `.m3u8`). Gdy wszystkie
  zawiodą, pokazuje komunikat z adresem i treścią błędu.
- **Sprzętowy Wstecz na Fire TV/Android TV zamykał aplikację.** Trafia teraz do
  `window.__openiptvBack`, czyli do tej samej logiki co klawisz pilota (461/4):
  zamyka kolejno menu kontekstowe, odtwarzacz, EPG i archiwum, a gdy nie ma już
  czego zamykać, oddaje zdarzenie systemowi.

### Zmieniono
- **EPG parsuje się poza głównym wątkiem.** `www/epg-worker.js` czyta XMLTV
  w Web Workerze, a gdy Worker jest niedostępny albo padnie, ten sam kod parsuje
  w głównym wątku. Postęp widać w pasku statusu (pobieranie, parsowanie, liczba
  programów).
- **Duże playlisty i siatka EPG są przycinane do rozsądnego rozmiaru.** Lista
  kanałów rysuje się porcjami po `LIST_CHUNK = 60` kart (resztę dokłada przy
  przewijaniu), a siatka EPG pokazuje `GUIDE_ROWS = 60` wierszy z informacją
  „pokazano 60 z 120”.
- **Zapis ustawień rozdzielony na dwa klucze.** `openiptvSettings` trzyma
  lekkie dane (ulubione, kolejność grup, ostatnio oglądane), a playlista i EPG
  wczytane z pliku leżą w `openiptvBlobs`, więc zapis nie przepisuje
  megabajtów tekstu. Klucze są spójne z nazwą aplikacji — ustawienia zapisane
  przez 1.17.x nie są przenoszone, więc po aktualizacji trzeba raz wczytać
  źródło jeszcze raz.
- **Skrypty budowania zapisują paczki do `dist/`** (`npm run build:webos` →
  `dist/ipk`, `npm run build:android` → `dist/android`). Parametr `-OutDir`
  wskazuje inny folder docelowy.
- **Nazwy bez „firetv”**: `scripts/build-firetv.ps1` → `scripts/build-android.ps1`,
  a skrypt npm `build:firetv` → `build:android`. Fire TV to tylko jedno z
  urządzeń, na których działa ta sama paczka Android.
- **Wersje ujednolicone na 1.18.0**: `www/app.js`, `www/appinfo.json`,
  `package.json` i `android/app/build.gradle` (versionCode 17).
- **Nowa tożsamość aplikacji**: `appId`/`applicationId` oraz usługa Luna to
  teraz `pl.openiptv.player` (paczka webOS: `pl.openiptv.player_1.18.0_all.ipk`).
  Instaluje się obok poprzedniej wersji, więc ustawienia się nie przenoszą.

## [1.17.2] — 2026-10-01

### Dodano
- **Program TV: przewijanie osi czasu pilotem (◀ ▶).** Strzałki w lewo/prawo
  przesuwają widok o godzinę w obie strony — dowolnie daleko w przeszłość
  i przyszłość (data oraz godzina aktualizują się na pasku). Wcześniej strzałki
  tylko przenosiły fokus między programami i „zatykały się” na skraju
  widocznego, 3‑godzinnego zakresu, więc cofnąć dało się najwyżej jedno okno.
  Fokus zostaje na tym samym kanale, a obok zakresu pojawiła się podpowiedź.

### Naprawiono
- **EPG wczytywało się tylko z adresów `.gz`.** Plik EPG jest teraz pobierany
  zawsze binarnie i GZIP rozpoznawany jest **po nagłówku** (`0x1f 0x8b`), a nie
  po rozszerzeniu adresu — działa więc EPG pod `.xml`, `.php` (np. `xmltv.php`)
  i bez rozszerzenia, także gdy serwer podaje spakowany plik pod adresem `.xml`.
  Dodatkowo obsługiwany jest BOM UTF‑8 i UTF‑16 (LE/BE). Lokalny plik EPG też
  jest czytany binarnie, więc spakowany plik o nazwie `.xml` również się rozpakuje.
- **„Ostatnio oglądane” wrzucało kanał natychmiast po włączeniu.** Kanał trafia
  na listę dopiero po **10 s oglądania** (pauza, błąd i buforowanie się nie liczą),
  a lista trzyma **maksymalnie 15 kanałów** — kanał, który wypadł poza 15 ostatnich,
  znika z listy. Lista odświeża się przy powrocie do widoku kanałów.
- **webOS (kod 4: format nieobsługiwany).** Komunikat błędu pokazuje teraz pełny
  próbowany adres (dane logowania zamaskowane) i treść błędu zdekodera, próba HLS
  (`.m3u8`) dla strumieni `.ts` wykonywana jest **zawsze** (także przy wyłączonym
  ponawianiu) i obejmuje każdy strumień `.ts`, nie tylko panele Xtream.

## [1.17.1] — 2026-10-01

### Naprawiono
- **Android: „Cannot set properties of null (setting 'textContent')” i pusta lista kategorii.**
  Przyczyną było czyszczenie całego `<aside id="categories">`, w którym od 1.17.0
  znajdują się `#categoryList` oraz narzędzia kolejności grup — czyszczenie usuwało je
  z DOM, a kolejny render odwoływał się do `null`. Lista kategorii jest teraz
  odtwarzana w locie, gdy brakuje jej w HTML (`ensureCategoryLayout()`), więc
  niekompletne/zmiksowane zasoby nie wywalają już aplikacji.
- **webOS: „Format lub serwer może nie być obsługiwany…”** — komunikat błędu pokazuje
  teraz kod błędu elementu `<video>` (przerwane / błąd sieci / dekodowanie / format
  nieobsługiwany) oraz host źródła, a ponowienie **podmienia element `<video>` na świeży**
  (webOS potrafi zakleszczyć dekoder po błędzie). Kanały Xtream z surowym strumieniem
  `.ts` są dodatkowo ponawiane raz jako HLS (`.m3u8`).

### Zmieniono
- Podniesiona wersja we wszystkich miejscach: `APP_VERSION`, `appinfo.json`,
  `package.json`, `versionName` + `versionCode 15` — dzięki temu webOS instaluje
  aktualizację, a Android widzi nowy build.
- Android czyści pamięć podręczną WebView raz na nową wersję (`MainActivity`), żeby
  nigdy nie powstała mieszanka starych i nowych plików (`index.html` + `app.js`).

## [1.17.0] — 2026-10-01

### Dodano
- **Kolejność grup kanałów**: w kolumnie kategorii przycisk **„⇅ Kolejność grup"**
  otwiera tryb edycji, w którym każda grupa dostaje strzałki **▲ / ▼** do przestawiania.
  Ustawiona kolejność jest zapisywana **osobno dla każdego profilu** i obowiązuje
  przy następnych uruchomieniach. Przycisk **„Alfabetycznie"** przywraca domyślny
  porządek. Grupy bez zapisanej pozycji nadal sortują się alfabetycznie pod spodem.

### Usunięto
- ustawienie **„Proxy CORS"** z ekranu ustawień wraz z całym mechanizmem proxy
  (publiczne proxy `allorigins` / `codetabs`) i kluczami tłumaczeń. Pobieranie M3U
  i EPG idzie teraz wyłącznie bezpośrednio — na Androidzie (Capacitor) i webOS
  (natywny serwis) i tak omijało CORS, a w przeglądarce proxy wysyłało adresy
  playlisty i EPG do zewnętrznych usług.
  Migracja ustawień (`schemaVersion` 3) usuwa zapisany klucz `corsProxy`.

### Naprawiono
- pola **„Nazwa profilu"**, **„Użytkownik"** (Xtream) i **„Globalny szablon catch-up"**
  nie miały atrybutu `type="text"`, przez co nie łapały ich style pól formularza:
  wyglądały jak zwykły tekst zlewający się z tłem karty (bez ramki i tła pola).
  Dodano `type="text"` oraz zapasowy selektor `.settings-card input:not([type])`,
  więc każde pole tekstowe w ustawieniach ma teraz pełny wygląd (ramka, tło,
  wysokość 58 px, odstęp od etykiety).

## [1.16.0] — 2026-10-01

### Zmieniono
- **Logo aplikacji**: nowy znak (gradient + trójkąt „play" + fale) w `www/icon.png`,
  `www/largeicon.png` oraz we wszystkich gęstościach Androida (ikony adaptacyjne).
  Generator: `scripts/make-icons.ps1` (jeden wzór → wszystkie rozmiary).
- **EPG („Program TV")**: usunięte mylące przyciski `‹ 2h / 2h › / ‹ 6h / 6h ›`.
  Zamiast nich nawigacja dzienna: **‹ Dzień**, **Przedwczoraj**, **Wczoraj**, **Dziś**,
  **Dzień ›** — skoki zachowują aktualnie ustawioną godzinę i pozwalają od razu
  podejrzeć EPG z wczoraj/przedwczoraj o tej samej porze.
- **Ustawienia**: domyślnie włączony **catch-up na wszystkich kanałach** oraz
  domyślny **krok przewijania archiwum 10 s**.
- **Formularze**: pola tekstowe w ustawieniach i wyszukiwanie mają teraz wyraźne tło,
  ramkę i większą wysokość — od razu widać, gdzie można wpisywać.

### Dodano
- jednorazowa migracja ustawień (`schemaVersion`), która istniejącym instalacjom
  ustawia nowe wartości domyślne (catch-up, krok 10 s).

## [1.15.0] — 2026-10-01

### Zmieniono
- Nazwa aplikacji to teraz **OpenIPTV** (interfejs, tytuły okien, nazwy paczek).

## [1.14.0] — 2026-10-01

### Naprawiono
- Catch-up działa teraz spójnie dla **każdego źródła** (Xtream, plik M3U, link M3U): parser czyta standardowy atrybut **`catchup-type`** (wcześniej pomijany) oraz obsługuje typy `append`, `shift`, `default`, `flussonic`, `xc`/`xs`/`xtream` i generyczny fallback HLS.

### Dodano
- Opcja **„Catch-up na wszystkich kanałach (HLS)"** — wymusza archiwum dla każdego kanału.

## [1.13.0] — 2026-10-01

### Dodano
- W EPG („Program TV"): wybór **konkretnego dnia i godziny** (pola data/czas) oraz skoki **±6 h** i przycisk „Dziś".

### Naprawiono
- Przeszłe programy w EPG bez obsługi catch-up są teraz **nieaktywne** (nie pokazują błędu „Brak obsługiwanego szablonu catch-up").

## [1.12.0] — 2026-10-01

### Dodano
- **Natywny serwis webOS** (`pl.openiptv.player.service.fetch`) — pobiera playlisty i EPG po stronie TV, **omijając CORS** na LG. Aplikacja używa go automatycznie, gdy wykryje `webOS.service`.

## [1.11.0] — 2026-10-01

### Dodano
- **Wybór języka: Polski / English** (cały interfejs i komunikaty tłumaczone).
- **Motyw: jasny / ciemny** w ustawieniach.
- Sekcja „Wygląd i język" w ustawieniach.

### Zmieniono
- GUI odświeżone na nowocześniejszy wygląd (spójne kolory, jaśniejszy/ciemniejszy motyw, lepsza czytelność).

## [1.10.0] — 2026-10-01

### Zmieniono
- Wyraźne **3 opcje źródła**: „Link do M3U", „Plik M3U" i „Xtream (login)" (osobne pola dla każdej).

## [1.9.0] — 2026-10-01

### Dodano
- Numer wersji widoczny w nagłówku i na dole ustawień.
- Przycisk „EPG" zamiast ikony siatki.

### Naprawiono
- **CORS na Fire TV (Android)**: EPG/playlista pobierane natywnie przez `CapacitorHttp`, więc nie są blokowane przez CORS (darmowe publiczne proxy okazały się niedostępne).

## [1.8.0] — 2026-10-01

### Dodano
- Opcja **odświeżania EPG** co N minut (30 min … 24 h) oraz przełącznik **„Pobieraj EPG przy starcie"**.
- Pole **własnego proxy CORS** (opcjonalne) — dla niezawodnego pobierania EPG z obcych domen.

### Zmieniono
- Parser EPG działa **iteracyjnie** (bez budowania całego DOM) — mniejsze zużycie pamięci przy dużych plikach XMLTV.
- Nagłówek przeprojektowany na **ikony SVG** (logo, wyszukiwarka z lupą, Program TV / odśwież / ustawienia) zamiast pełnych słów.

### Naprawiono
- Fallback CORS próbuje teraz własnego proxy (jeśli ustawione), potem publicznych.

## [1.7.0] — 2026-10-01

### Zmieniono
- **Kanały ładują się od razu**, a EPG pobiera się w tle z paskiem postępu (%, a przy braku `Content-Length` — liczba MB).
- Parsowanie XMLTV przeniesione do **Web Workera** (interfejs nie zamarza na dużym EPG) z automatycznym fallbackiem synchronicznym.

### Naprawiono
- Usunięto `corsproxy.io` (wymaga klucza API → powodował błąd **401**); fallback CORS to teraz `api.allorigins.win` + `api.codetabs.com`.
- Poprawiono komunikaty HTTP 401/403 — nie sugerują już „danych logowania" dla publicznego EPG.

## [1.6.0] — 2026-10-01

### Naprawiono
- EPG z obcych domen (np. `https://epg.ovh/pl.xml`) blokowane przez **CORS** — dodano automatyczny fallback przez publiczny proxy (`api.allorigins.win`, potem `corsproxy.io`).

### Zmieniono
- **Nowoczesny odtwarzacz**: panel „glassmorphism" (rozmycie tła), plakietka **LIVE / CATCH-UP**, gradientowy pasek postępu, wyrównany czas.
- Drobna korekta kolorów tła aplikacji (spójna z nowym motywem).

## [1.5.0] — 2026-10-01

### Dodano
- Logowanie **Xtream Codes** (serwer + użytkownik + hasło), pobieranie kanałów, kategorii i EPG przez `player_api.php` / `xmltv.php`.
- Nowy ekran **„Program TV"** (EPG): siatka kanałów × czas, aktualny program podświetlony, przeszłe = catch-up, przyszłe = nieaktywne.
- Pasek postępu aktualnego programu na karcie kanału.
- Status w nagłówku pokazuje liczbę wczytanych programów EPG („EPG: N programów") albo przyczynę błędu.

### Zmieniono
- **Przebudowa GUI**: ciemny motyw, akcent gradientowy indygo→fiolet, zaokrąglone karty, glow na fokusie.
- Poprawki EPG: `next_days` przy pobieraniu z Xtream + dopasowanie programów po nazwie wyświetlanej (`<display-name>`) dla kanałów bez `tvg-id`.
- Catch-up Xtream liczy czas **wg UTC** (poprawka strefy czasowej).

### Zbudowano
- Skrypty budowania zapisują gotowe pliki w jednym folderze (zawsze najnowsza wersja).

## [1.4.0] — 2026-09-xx

### Dodano
- Odtwarzacz **M3U** (URL lub plik lokalny) z EPG/XMLTV (`.xml` / `.gz`) i catch-up/archiwum.
- Profile źródeł, ulubione, ostatnio oglądane, wyszukiwarka, ustawienia przewijania archiwum i ponawiania kanałów.

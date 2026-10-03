# OpenIPTV

Jeden kod web (`www/`), dwa wydania:

| Platforma | Paczka | Technologia |
|---|---|---|
| LG webOS (Smart TV) | `.ipk` | aplikacja web pakowana przez `ares-cli` |
| Android TV / Google TV / Fire TV | `.apk` | WebView + Capacitor, budowane Gradle'em |

Warstwa interfejsu i cała logika są wspólne, różni się tylko opakowanie.
Odtwarzacz M3U z EPG/XMLTV i obsługą paneli Xtream Codes:

- źródła: link M3U, plik M3U albo login Xtream (serwer, użytkownik, hasło),
- program TV (siatka kanałów na osi czasu) i mini-EPG na karcie kanału,
- catch-up/archiwum: programy z przeszłości odtwarzane z adresu liczonego
  ze znaczników czasu; przycisk `EPG` na pasku odtwarzacza otwiera listę
  programów oglądanego kanału — poprzednie, bieżący i następne — z której
  wybiera się materiał do odtworzenia, a `Na żywo` wraca do bieżącej chwili,
- ulubione, ostatnio oglądane, wyszukiwarka, profile źródeł,
- ustawienia w trzech zakładkach: **Ogólne** (sama aplikacja), **Aktualizacja**
  (tylko wydania) i **Instrukcja** (poradnik obsługi pilota),
- interfejs po polsku i angielsku, motyw jasny i ciemny, tryb TV z obsługą
  pilota oraz wspólna obsługa klawisza Wstecz (z pytaniem o wyjście zamiast
  zamykania aplikacji z przypadku),
- rozmiar interfejsu dobierany do rozdzielczości ekranu (720p / 1080p / 4K)
  albo wybierany ręcznie w 100–150% — dla czytelności z dużej odległości,
- aktualizacja bez przymusu: ustawienia tylko pokazują, że jest nowsza wersja
  i krótko co się zmieniło, a aktualizację uruchamia przycisk.

## Rozmiar interfejsu

Projekt układu ma 1920 px szerokości, a przeglądarka telewizora skaluje go do
ekranu — dzięki temu ten sam kod obsługuje 720p, 1080p i 4K. Żeby litery były
czytelne z kanapy, aplikacja wykrywa rozdzielczość ekranu (px CSS ekranu ×
gęstość) i sama dobiera wielkość układu (`www/ui-scale.js`):

| Ekran | Skala automatyczna | Układ |
|---|---|---|
| 720p i mniejsze | 140% | 1371 px |
| 1080p | 100% | 1920 px |
| 4K | 100% | 1920 px |

W **Ustawieniach** (zakładka **Ogólne**) jest lista **Rozmiar interfejsu** —
Automatyczny, 100%, 115%, 130% i 150% — a pod nią informacja, co aplikacja
wykryła (np. „Wykryty ekran:
1920×1080 px, gęstość 2.0× — układ 1920 px, skala 100%”). Skala obowiązuje od
razu: szerokość układu ustawia się jeszcze przed pierwszym rysowaniem strony,
a gdy telewizor zmieni rozdzielczość w trakcie pracy, układ przelicza się sam.
W przeglądarce na komputerze skalę robi zoom CSS.

## Ustawienia: trzy zakładki

Karta ustawień rosła razem z aplikacją i wszystko trafiało do jednej, długiej
listy — instrukcja pilota stała między polami formularza. Teraz na górze karty
jest pasek zakładek, a pilot zmienia zakładkę strzałkami `◀` `▶` (`▼` wchodzi
w treść, `OK` też przełącza):

| Zakładka | Co trzyma |
|---|---|
| **Ogólne** | wszystko o samej aplikacji: profil i źródło (M3U / plik / Xtream), adres EPG, odświeżanie EPG, archiwum i odtwarzanie, wygląd, język i rozmiar interfejsu |
| **Aktualizacja** | tylko wydania: numer nowszej wersji, co się zmieniło i przyciski `Sprawdź aktualizacje` / `Pobierz i zainstaluj` |
| **Instrukcja** | poradnik obsługi: źródło kanałów, poruszanie się po aplikacji, pilot w odtwarzaczu, program TV, archiwum i telefon |

Przyciski `Zapisz i pobierz` oraz `Wstecz` są widoczne w każdej zakładce —
`Wstecz` wychodzi z ustawień bez zapisu.

## Pilot w odtwarzaczu

Podczas oglądania kanału (na żywo i w archiwum) pilot działa jak w telewizorze —
bez wchodzenia fokusem w przyciski:

| Klawisz | Co robi |
|---|---|
| `▲` `▼` (CH+ / CH−) | następny / poprzedni kanał z listy, którą widzisz (z kategorii, wyszukiwania), z zawijaniem na końcach |
| `◀` `▶` / `⏪` `⏩` | przewijanie o krok z ustawień; w archiwum skok, na kanale na żywo `⏪` wchodzi w catch-up, a `▶` na zatrzymanym obrazie wznawia od miejsca pauzy. Po skoku pasek pisze wprost, o ile obraz przesunięto („Cofnięto o 10 s” / „Przesunięto o +10 s”), a nie „Ładowanie strumienia”; kolejne naciśnięcia pod rząd sumują się (5 × `⏩` = „Przesunięto o +50 s”) |
| `OK` | pokaż / schowaj pasek informacyjny (mini-EPG kanału) |
| `OK` przytrzymane, `MENU` | opcje kanału i obrazu (od początku, poprzedni/następny program, na żywo, cisza, EPG, ulubione) |
| `⏵` `⏸` / `⏹` | pauza i wznowienie. Po dłuższej pauzie kanał na żywo jest wznawiany z archiwum dokładnie od chwili zatrzymania (jeśli kanał ma archiwum), a nie od bieżącej sceny |
| `🔇` | cisza / dźwięk (wyciszenie strumienia; głośność telewizora należy do sprzętu) |
| `Wstecz` | obraz wraca do listy kanałów, a na liście pokazuje pytanie „Wyjdź z aplikacji?” — dopiero tam wyjście kończy aplikację |

`⏵‖` to jeden przycisk, a dekodery wysyłają go różnymi kodami (`85`, `126`,
`415`…) i część z nich zjada go dla własnej sesji multimediów. Aplikacja
obsługuje kody i nazwy tych klawiszy, rejestruje akcje w sesji multimediów,
łapie klawisz też na zwolnieniu, a na Android TV / Fire TV `MainActivity`
oddaje go stronie, gdy na ekranie jest odtwarzacz — dlatego play/pauza działa
także na pilotach, na których wcześniej milczał.

Pasek na dole obrazu pokazuje to, co da się zrobić w danym momencie:
`Pauza`/`Wznów`, `Od początku`, `◀ Poprzedni` i `Następny ▶` (w archiwum),
`EPG`, `Na żywo` (gdy obraz nie jest na żywo) i `Wycisz`. Menu opcji kanału
i wyjście do listy są poza paskiem na telewizorze — tam są pod `MENU` /
trzymanym `OK` i pod klawiszem `Wstecz`, więc nie dublują się na ekranie. Na
telefonie i tablecie oba te przyciski zostają na pasku, bo tam nie ma pilota.

Fokus na przycisku paska zmienia strzałki w nawigację po pasku (tak działa mysz,
dotyk i pilot z fokusem) — na obrazie strzałki zostają przy transmisji.
Długie przytrzymanie `▲` `▼` nie przełącza kanałów seriami: jedno naciśnięcie = jedna zmiana.

Ta sama instrukcja jest w aplikacji, na telewizorze:
**Ustawienia → zakładka „Instrukcja”** (tabele klawiszy po polsku i angielsku,
razem z krótkim opisem każdej akcji).

**Wyjście z aplikacji** (`Wstecz` na liście kanałów) potwierdza się przyciskiem.
Na Android TV / Fire TV zamknięcie okna z tej strony robi most
`OpenIptvNative.quit()` z `MainActivity` (samo `window.close()` w WebView jest
ignorowane), na webOS i Tizenie kończy aplikację platforma, a w zwykłej
przeglądarce zostaje podpowiedź, że okno zamyka użytkownik. `Wstecz`
w ustawieniach wychodzi **bez zapisu**.

## Pilot na liście kanałów (menu główne)

Lista kanałów to ekran startowy: z boku grupy, obok kanały, u góry szukanie,
`EPG`, odświeżanie i ustawienia. Pod listą jest pasek przypominający klawisze
pilot, a fokus chodzi po przyciskach jak po stronie — bez myszki:

| Klawisz | Co robi |
|---|---|
| `◀` `▲` `▼` `▶` | przejście do najbliższego przycisku w tym kierunku (grupy, kanały, pasek u góry) |
| `OK` | wybór: na grupie pokazuje jej kanały i od razu wchodzi w listę, na kanale włącza obraz |
| `OK` przytrzymane, `MENU` | opcje kanału (ulubione, archiwum, program TV, od początku, cisza) |

Grupa zmienia się **tylko po naciśnięciu `OK`** — samo dojechanie fokusem na
przycisk grupy nie przełącza już listy kanałów, więc przewijanie kanałów nie
przerzuca na inną kategorię. Po wczytaniu playlisty (i po zapisaniu ustawień)
fokus wchodzi od razu w listę kanałów — nigdy w pole szukania, żeby na
telewizorze nie wyskakiwała z niego klawiatura ekranowa.

Z pola **Szukaj** też da się wyjść: `▼` przechodzi do listy kanałów, `▶` przy
końcu wpisanego tekstu do następnego pola paska, a `◀` — gdy kursor stoi na
początku zapytania — do listy grup. W środku tekstu `◀` `▶` przesuwają kursor,
więc zapytanie poprawia się jak na komputerze.

Ikony przycisków (zębatka, odświeżanie, pasek odtwarzacza, gwiazdki ulubionych)
są rysowane jako SVG, a nie znakami emoji: na dekoderach telewizyjnych czcionka
emoji bywa okrojona i z ikony zostawała kropka. Przycisk programu TV to sam
napis `EPG`, a nagrania otwiera się z opcji kanału (`OK` przytrzymane / `MENU`).
Podpowiedź pilota pod listą to pasek z tłem, a nie szary tekst położony na
kanałach.

## Plik M3U i EPG z pamięci

Rodzaj źródła wybiera się w **Ustawieniach** (zakładka **Ogólne**), przyciskami
**Link do M3U**, **Plik M3U** i **Xtream (login)** — wszystkie pozycje widać
naraz, a wybrana jest podświetlona kolorem. Rozwijana lista systemowa odpadała,
bo na telewizorze rysowała się ciemno na ciemnym i nie było widać, co jest
zaznaczone.

Playlistę i program TV można też wskazać plikiem z pamięci urządzenia albo
z karty USB — w **Ustawieniach** (zakładka **Ogólne**), przyciskami
**„Wybierz plik M3U”** i **„Wybierz plik EPG”**. Na każdej platformie robi to
coś innego:

| Platforma | Co się dzieje po naciśnięciu |
|---|---|
| przeglądarka, telefon | otwiera się systemowe okno wyboru plików |
| Android TV / Google TV / Fire TV | wybór prowadzi plugin `OpenIptvFiles` (patrz niżej) |
| webOS | systemowego okna nie ma, więc jest podpowiedź, czym zastąpić plik |

Telewizory — typowy Fire TV — często nie mają żadnej aplikacji z systemowym oknem
wyboru plików. Wtedy `<input type="file">` nie ma czego otworzyć i przycisk
milczy, dlatego wybór przejmuje plugin natywny
(`android/app/src/main/java/pl/openiptv/player/FilePlugin.java`):

1. próbuje systemowego wyboru dokumentów (`ACTION_OPEN_DOCUMENT`, potem
   `ACTION_GET_CONTENT`) — tak działa Android TV, Google TV i telefon,
2. gdy takiego okna nie ma, pokazuje własną listę katalogów, po której chodzi się
   pilotem: pamięć urządzenia, karta USB, dysk. Katalogi są pierwsze, `../` wraca
   w górę, widać pierwsze 300 pozycji, pliki ukryte (z kropką) są pomijane,
3. kopiuje wybrany plik do pamięci aplikacji i oddaje stronie jego ścieżkę, a ta
   czyta go przez lokalny serwer Capacitora (`/_capacitor_file_/`). Dzięki temu
   odczyt zależy tylko od własnego pliku, a nie od uprawnień do cudzych URI.

Uprawnienie `READ_EXTERNAL_STORAGE` w manifeście ma `maxSdkVersion="32"`: na
Androidzie 12 i starszym plugin prosi o nie przed pokazaniem listy, na Androidzie
13+ nie jest potrzebne (wybór idzie przez systemowy wybór dokumentów), a po
odmowie lista pokazuje katalogi, które i tak da się przeczytać (na Fire OS 7
wystarcza `/sdcard`).

Plik EPG czytany jest binarnie, a GZIP rozpoznawany po nagłówku — spakowany plik
o nazwie `.xml` też się rozpakuje.

## Pobieranie

Gotowe paczki (`.apk` i `.ipk`) leżą w
[wydaniach](https://github.com/keczup21/openiptv/releases). Każde wydanie ma dwa
pliki, a `<wersja>` w nazwie to numer z `package.json`:

| Plik | System |
|---|---|
| `OpenIPTV-<wersja>.apk` | Android TV / Google TV / Fire TV |
| `OpenIPTV-<wersja>.ipk` | LG webOS |

Wydania są developerskie: `npm run build:android` składa paczkę `.apk` od razu po
sklonowaniu repozytorium — nic nie trzeba przygotowywać poza nim — i dokładnie
ten plik ląduje w wydaniu na GitHubie razem z `.ipk`.

Adres `.../releases/latest` zawsze prowadzi do najnowszego wydania, a numer
wersji i pełna lista zmian są w `CHANGELOG.md`. Wpis w changelogu jest krótki
i dotyczy tylko funkcji aplikacji — tego, co widać na ekranie — bez testów
i skryptów wydania. Opis wydania (to, co widać na GitHubie jako „co nowego”)
wycina z `CHANGELOG.md` generator `scripts/release-notes.js` (`npm run notes`)
— tylko sekcję wydawanej wersji, bez zmian z poprzednich wydań. Kolejne wydanie
tworzy `scripts/publish.ps1` z przełącznikiem `-Release`: robi commit, buduje
paczki (`npm run build:all`),
sam generuje opis i tworzy wydanie tylko z tymi plikami — brak gotowej paczki
przerywa publikację. Uwaga: przez npm argumenty podaje się po separatorze `--`,
bo inaczej npm „zjada” `-Tag` / `-Release` jako swoje flagi (skrypt to wychwytuje
i odmawia, gdy tag nie wygląda jak `vX.Y.Z`):

```powershell
npm run publish -- -Message "wersja 1.19.0" -Tag v1.19.0 -Release
# własny opis wydania zamiast z CHANGELOG.md: dodatkowo -Notes C:\sciezka\opis.md
```

Ręcznie to samo robi `gh release create`, z jawnie wskazanymi paczkami i opisem:

```powershell
gh release create vX.Y.Z dist\android\OpenIPTV-X.Y.Z.apk dist\ipk\OpenIPTV-X.Y.Z.ipk --title "OpenIPTV X.Y.Z" --notes-file dist\release-notes-X.Y.Z.md
```

### Numeracja wersji

Numer wersji jest zapisany w czterech miejscach — `www/app.js` (`APP_VERSION`),
`www/appinfo.json`, `package.json` i `android/app/build.gradle` (`versionName`
oraz `versionCode`) — a podbija je jedna komenda, żeby żadne miejsce nie zostało
ze starą wersją:

```powershell
npm run bump -- 1.20.0   # gruba zmiana: nowa funkcja, przebudowa
npm run bump -- 1.19.1   # poprawka albo drobiazg
```

Zasada: **gruba zmiana** podbija środkową liczbę (`1.19.0 → 1.20.0`), a **bugfix
albo drobiazg** ostatnią (`1.19.0 → 1.19.1`). Skrypt sam zwiększa `versionCode`
o 1 (musi rosnąć, inaczej Android nie przyjmie aktualizacji — można go wymusić
przez `-VersionCode`), wypisuje podbite miejsca i przypomina, że nowy numer ma
dostać wpis w `CHANGELOG.md`.

## Struktura

```
OpenIPTV/
├─ www/                     wspólny kod aplikacji (edytuj tylko tutaj)
│  ├─ index.html app.js styles.css ui-scale.js
│  ├─ epg-worker.js         parser XMLTV poza wątkiem UI (fallback: app.js)
│  ├─ appinfo.json          manifest webOS
│  ├─ icon.png icon.svg largeicon.png
│  └─ lib/                  hls.min.js, mpegts.min.js, pako.min.js (ładowane leniwie)
├─ webos-service/           natywny serwis webOS (pobieranie bez CORS)
├─ android/                 projekt Android wygenerowany przez Capacitor
│  └─ app/                  MainActivity, UpdatePlugin, FilePlugin, AndroidManifest, ikony, splash
├─ scripts/
│  ├─ build-webos.ps1       www/ + webos-service/ → .ipk
│  ├─ build-android.ps1     www/ → .apk (Capacitor + Gradle)
│  ├─ make-icons.ps1        ikony i ekrany startowe PNG z jednego wzoru
│  ├─ test-*.js             testy bez telewizora (npm test)
│  └─ publish.ps1           commit + push, opcjonalnie z tagiem i wydaniem (-Release)
├─ capacitor.config.json    appId: pl.openiptv.player, webDir: www
├─ package.json
└─ CHANGELOG.md
```

## Wymagania

- Node.js 18+ i npm.
- webOS: `npm install -g @webos-tools/cli` (daje `ares-package` i `ares-install`).
- Android (.apk): JDK 17 oraz Android SDK z platform-tools, android-34 i build-tools 34.0.0.
  `scripts/build-android.ps1` czyta `JAVA_HOME` i `ANDROID_HOME`, a gdy ich nie ma,
  szuka JDK 17 w `C:\Program Files\Eclipse Adoptium` i SDK w `%USERPROFILE%\Android\Sdk`.

## Build — webOS (.ipk)

```powershell
npm install
npm run build:webos
# wynik: dist\ipk\OpenIPTV-<wersja>.ipk
```

`ares-package` nazywa wynik `pl.openiptv.player_<wersja>_all.ipk` (`all`, bo to
czysta aplikacja web) — skrypt zmienia nazwę na taką samą jak paczka Android.
Urządzenie czyta `appinfo.json` z wnętrza paczki, więc nazwa pliku nie ma znaczenia.

Instalacja na TV (tryb deweloperski + `ares-setup-device`):

```powershell
ares-install -d <device> dist\ipk\OpenIPTV-<wersja>.ipk
ares-launch  -d <device> pl.openiptv.player
```

## Build — Android (.apk)

```powershell
npm install
npm run build:android
# wynik: dist\android\OpenIPTV-<wersja>.apk
```

To wydanie developerskie: cała konfiguracja budowania leży w repozytorium, więc
paczka powstaje bez żadnych dodatkowych plików na dysku. Ten sam plik, który
zapisze się w `dist\android`, idzie na GitHuba (`npm run build:all` dorzuca
jeszcze `.ipk`), a instalacja to jedno `adb install -r`.

Instalacja na Android TV / Fire TV (ADB Debugging włączone, ta sama sieć):

```powershell
adb connect <ip>:5555
adb install -r dist\android\OpenIPTV-<wersja>.apk
```

Oba skrypty mają parametr `-OutDir`, którym można wskazać inny folder docelowy, np.
`npm run build:android -- -OutDir D:\builds`.

### Konfiguracja Android (w `android/app/src/main/AndroidManifest.xml`)

- `<uses-feature android:software.leanback required="true">`
- `<uses-feature android.hardware.touchscreen required="false">`
- `android:screenOrientation="landscape"`
- kategoria `android.intent.category.LEANBACK_LAUNCHER`
- `android:usesCleartextTraffic="true"` (strumienie http)
- `android.permission.REQUEST_INSTALL_PACKAGES` oraz sekcja `<queries>` dla
  instalatora paczek — bez nich przycisk „Pobierz i zainstaluj” w ustawieniach
  nie otworzy systemowego instalatora na Androidzie 11+
- motyw startowy `AppTheme.NoActionBarLaunch` (`android:background="@drawable/splash"`)
  — ekran startowy to tło `#0a0c11` z logo OpenIPTV na środku; obrazki
  w `res\drawable*\splash.png` generuje `scripts/make-icons.ps1`, żeby start
  pokazywał ten sam znak co ikona aplikacji (`npm run test:splash` tego pilnuje)
- plugin `FilePlugin` (`OpenIptvFiles`) — wybór plików M3U/EPG dla telewizorów bez
  systemowego okna wyboru plików; rejestrowany w `MainActivity` obok
  `UpdatePlugin` (`registerPlugin`), a uprawnienie `READ_EXTERNAL_STORAGE` ma
  `maxSdkVersion="32"` (na Androidzie 13+ zbędne — patrz
  [Plik M3U i EPG z pamięci](#plik-m3u-i-epg-z-pamięci))

## Testy

Bez telewizora i bez emulatora — `npm test` uruchamia wszystkie siedem:

```powershell
npm run test:seek     # przewijanie archiwum, pauza/wznowienie, 🔇 i ▲▼ kanał (www/app.js)
npm run test:update   # porównanie wersji i wybór paczki .apk / .ipk
npm run test:ui       # skalowanie interfejsu (www/ui-scale.js)
npm run test:pick     # wybór pliku M3U/EPG: przyciski, plugin natywny, błędy odczytu
npm run test:nav      # menu główne i ustawienia: zakładki, ikony SVG, pasek odtwarzacza, klawisze multimedialne
npm run test:splash   # ekran startowy Androida: tło, znak, wymiary, środek
npm run test:notes    # opis wydania: tylko wydawana wersja, bez ogona z poprzednich
```

Testy czytają prawdziwe pliki z repozytorium (wyciągają funkcje z `www/app.js`,
a PNG czytają własnym kodem), więc nie trzymają kopii logiki, która mogłaby się
rozjechać z aplikacją.

## Aktualizacja z aplikacji

Aktualizacja nigdy nie dzieje się sama. Wejście w **Ustawienia** (zakładka
**Aktualizacja**) sprawdza cicho wydanie na GitHubie (`releases/latest`) i — gdy jest
nowsze od `APP_VERSION` — pokazuje tylko informację: numer wersji i krótko, co się
zmieniło (pierwsze punkty opisu wydania). Nic nie pobiera się w tle, a instalację
uruchamia dopiero naciśnięcie przycisku `Pobierz i zainstaluj`. Przycisk
`Sprawdź aktualizacje` robi to samo na żądanie i pokazuje też błędy, np. brak
internetu.

- **Android TV / Google TV / Fire TV** — `Pobierz i zainstaluj` pobiera
  `OpenIPTV-<wersja>.apk` z tego wydania i otwiera systemowy instalator.
  Adres paczki to plik z wydania (`browser_download_url`), a nie adres API
  GitHuba — API oddaje opis wydania w JSON-ie, więc instalator odpowiadał
  wtedy „problem z analizowaniem pakietu”. Przed przekazaniem paczki systemowi
  aplikacja sprawdza, że to naprawdę plik APK.
  Pobieraniem zajmuje się `UpdatePlugin.java` (lokalny plugin Capacitora,
  plik ląduje w cache aplikacji i wychodzi przez `FileProvider`), więc
  aktualizacja nie wymaga ADB ani komputera. Potrzebna jest zgoda „Instaluj
  nieznane aplikacje” dla OpenIPTV — gdy jej nie ma, aplikacja sama otwiera
  ekran, na którym się ją włącza.
- **LG webOS** — system nie instaluje `.ipk` sam, więc aplikacja pokazuje
  numer wersji, nazwę paczki i adres wydania; paczkę wgrywa się z komputera
  (`ares-install`, sekcja „Build — webOS”).
- **przeglądarka** (`npm run serve`) — zostaje sam komunikat o nowszej wersji.


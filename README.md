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
  ze znaczników czasu,
- ulubione, ostatnio oglądane, wyszukiwarka, profile źródeł,
- interfejs po polsku i angielsku, motyw jasny i ciemny, tryb TV z obsługą
  pilota oraz wspólna obsługa klawisza Wstecz,
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

W **Ustawieniach** jest lista **Rozmiar interfejsu** — Automatyczny, 100%, 115%,
130% i 150% — a pod nią informacja, co aplikacja wykryła (np. „Wykryty ekran:
1920×1080 px, gęstość 2.0× — układ 1920 px, skala 100%”). Skala obowiązuje od
razu: szerokość układu ustawia się jeszcze przed pierwszym rysowaniem strony,
a gdy telewizor zmieni rozdzielczość w trakcie pracy, układ przelicza się sam.
W przeglądarce na komputerze skalę robi zoom CSS.

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
wersji i pełna lista zmian są w `CHANGELOG.md`. Kolejne wydanie tworzy
`scripts/publish.ps1` z przełącznikiem `-Release`: robi commit, buduje paczki
(`npm run build:all`) i tworzy wydanie tylko z nimi — brak gotowej paczki
przerywa publikację:

```powershell
npm run publish --message="wersja 1.19.0" -Tag v1.19.0 -Release
# własny opis wydania: dodatkowo -Notes C:\sciezka\opis.md
```

Ręcznie to samo robi `gh release create`, z jawnie wskazanymi paczkami:

```powershell
gh release create vX.Y.Z dist\android\OpenIPTV-X.Y.Z.apk dist\ipk\OpenIPTV-X.Y.Z.ipk --title "OpenIPTV X.Y.Z" --notes "co nowego"
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
│  └─ app/                  MainActivity, UpdatePlugin, AndroidManifest, ikony, splash
├─ scripts/
│  ├─ build-webos.ps1       www/ + webos-service/ → .ipk
│  ├─ build-android.ps1     www/ → .apk (Capacitor + Gradle)
│  ├─ make-icons.ps1        ikony PNG z jednego wzoru wektorowego
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

## Aktualizacja z aplikacji

Aktualizacja nigdy nie dzieje się sama. Wejście w **Ustawienia** (sekcja
AKTUALIZACJE) sprawdza cicho wydanie na GitHubie (`releases/latest`) i — gdy jest
nowsze od `APP_VERSION` — pokazuje tylko informację: numer wersji i krótko, co się
zmieniło (pierwsze punkty opisu wydania). Nic nie pobiera się w tle, a instalację
uruchamia dopiero naciśnięcie przycisku `Pobierz i zainstaluj`. Przycisk
`Sprawdź aktualizacje` robi to samo na żądanie i pokazuje też błędy, np. brak
internetu.

- **Android TV / Google TV / Fire TV** — `Pobierz i zainstaluj` pobiera
  `OpenIPTV-<wersja>.apk` z tego wydania i otwiera systemowy instalator.
  Pobieraniem zajmuje się `UpdatePlugin.java` (lokalny plugin Capacitora,
  plik ląduje w cache aplikacji i wychodzi przez `FileProvider`), więc
  aktualizacja nie wymaga ADB ani komputera. Potrzebna jest zgoda „Instaluj
  nieznane aplikacje” dla OpenIPTV — gdy jej nie ma, aplikacja sama otwiera
  ekran, na którym się ją włącza.
- **LG webOS** — system nie instaluje `.ipk` sam, więc aplikacja pokazuje
  numer wersji, nazwę paczki i adres wydania; paczkę wgrywa się z komputera
  (`ares-install`, sekcja „Build — webOS”).
- **przeglądarka** (`npm run serve`) — zostaje sam komunikat o nowszej wersji.


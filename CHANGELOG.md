# Changelog

Wszystkie istotne zmiany w projekcie **OpenIPTV** są tu dokumentowane.
Format oparty na [Keep a Changelog](https://keepachangelog.com/), wersje wg [SemVer](https://semver.org/).

**Jak numerujemy wersje:** gruba zmiana (nowa funkcja, przebudowa) podbija
środkową liczbę — `1.19.0 → 1.20.0`, a poprawka albo drobiazg ostatnią —
`1.19.0 → 1.19.1`. Wszystkie cztery miejsca z numerem (`www/app.js`,
`www/appinfo.json`, `package.json`, `android/app/build.gradle`) podbija jedna
komenda: `npm run bump -- X.Y.Z`.

**Jak piszemy wpisy:** wpis jest krótki i mówi tylko o tym, co zmieniło się
w aplikacji, czyli o funkcjach i poprawkach widocznych na ekranie. Nie opisujemy
w nim testów, skryptów wydania ani porządków w kodzie, nie powtarzamy zmian
z wcześniejszych wersji i nie odnotowujemy samego podbicia numeru (miejsca
z numerem opisuje akapit wyżej). Opis wydania na GitHubie powstaje z tego wpisu:
`npm run notes` (`scripts/release-notes.js`) bierze z changeloga tylko sekcję
wydawanej wersji.

## [1.21.7] — 2026-10-03

### Naprawiono
- **Przewijanie pilota (`⏪` `⏩`) działa na większej liczbie pilotów.** Skok
  rozpoznajemy nie tylko po kodach webOS (`412`/`417`) i Androida (`89`/`90`),
  ale też po nazwach klawiszy oraz po klawiszach „poprzedni / następny”
  (`87`/`88`), którymi część pilotów wysyła przewijanie. Skok dzieje się także
  wtedy, gdy pilot zgłasza klawisz dopiero na zwolnieniu — i tylko raz, bo jedno
  naciśnięcie nie może liczyć się podwójnie.

## [1.21.6] — 2026-10-03

### Naprawiono
- **Kolejne naciśnięcia przewijania sumują się w jednym wpisie.** Pięć razy
  `⏩` pod rząd pokazuje na pasku „Przesunięto o +50 s”, a `⏪` — „Cofnięto
  o 50 s”, zamiast pięć razy opisywać ten sam krok z ustawień. Skok w tę samą
  stronę dolicza się, dopóki wpis jest jeszcze na pasku; zmiana kierunku albo
  dłuższa przerwa zaczyna liczenie od nowa.

## [1.21.5] — 2026-10-03

### Naprawiono
- **Po przewinięciu catch-upu pasek pisze, o ile obraz się przesunął.**
  Skok w archiwum zmusza dekoder do doniesienia obrazu na nową pozycję, więc
  odtwarzacz zgłaszał buforowanie i pasek pokazywał „Ładowanie strumienia…
  (LIVE)” — tak samo jak przy włączaniu kanału. Teraz pasek mówi wprost
  „Cofnięto o 10 s” albo „Przesunięto o +10 s”: krok z ustawień, a przy
  krawędzi nagrania tyle, ile naprawdę udało się przesunąć. Komunikat
  o wczytywaniu obrazu nazywa natomiast silnik odtwarzania („natywnie”,
  „TS/MSE”, „HLS”) zamiast mylącego „LIVE”.

## [1.21.4] — 2026-10-03

### Naprawiono
- **„Wstecz” w odtwarzaczu wraca do listy kanałów, a nie na czarny ekran.**
  Akcje wykonywane na obrazie (następny program, „od początku”, „na żywo”,
  wznowienie po pauzie) ustawiały odtwarzacz jako miejsce powrotu, więc po
  wyjściu z kanału „Wstecz” pokazywał czarny prostokąt bez obrazu i bez paska.
- **Play/pauza na pilocie działa.** Dekodery wysyłają `⏵‖` różnymi kodami,
  a część z nich przeglądarka zjadała dla własnej sesji multimediów. Aplikacja
  rozpoznaje teraz wszystkie te kody (i same nazwy klawiszy), rejestruje akcje
  w sesji multimediów, łapie klawisz także na zwolnieniu, a na Android TV
  i Fire TV oddaje go stronie natywna obsługa pilota.
- **„Sprawdź aktualizacje” wygląda jak przycisk** — miał takie samo tło jak
  karta ustawień, więc wyglądał na zwykły napis. Teraz ma obwódkę, jaśniejsze
  tło i reakcję na najechanie i naciśnięcie.

### Dodano
- **Ustawienia mają trzy zakładki: Ogólne, Aktualizacja i Instrukcja.**
  W „Ogólnych” jest wszystko o samej aplikacji (profil i źródło, EPG,
  archiwum, odtwarzanie, wygląd i język), w „Aktualizacji” tylko wydania,
  a „Instrukcja” to poradnik obsługi. Pilot zmienia zakładkę strzałkami
  `◀` `▶`, a `▼` wchodzi w treść.
- **„EPG” na pasku odtwarzacza pokazuje listę programów oglądanego kanału** —
  poprzednie, bieżący (z podpisem LIVE) i następne. Wybranie programu odtwarza
  go z archiwum, a `Na żywo` wraca do bieżącej chwili. Programy, które dopiero
  będą, są widoczne, ale nie do wybrania, bo archiwum ich nie ma.

### Zmieniono
- **Pasek odtwarzacza bez duplikatów.** Na telewizorze zniknęły z niego
  „Kanał” (to samo, co menu pod `MENU` i trzymanym `OK`) oraz „Wstecz” (to
  samo, co klawisz `Wstecz` na pilocie). Na telefonie i tablecie oba zostają,
  bo tam nie ma pilota. Przycisk programu TV na pasku to teraz `EPG`,
  a odtwarzacz wypisuje w podpowiedzi, jak z niego wyjść.
- **Instrukcja w ustawieniach to poradnik**, a nie tabela wciśnięta między pola
  formularza: źródło kanałów, poruszanie się po aplikacji, pilot w odtwarzaczu,
  program TV, archiwum i telefon — każdy z krótkim opisem.

## [1.21.3] — 2026-10-03

### Naprawiono
- **„Pobierz i zainstaluj” naprawdę pobiera paczkę.** Aplikacja brała z GitHuba
  adres opisujący wydanie, więc do instalatora trafiał tekst zamiast pliku `.apk`
  i instalacja kończyła się komunikatem „podczas analizowania pakietu wystąpił
  problem”. Teraz pobierany jest plik wydania, a paczka jest sprawdzana, zanim
  trafi do systemu.
- **Kafelek kanału ma jedną obwódkę fokusu** wokół całego wiersza — wcześniej
  druga ramka rysowała się wokół nazwy kanału, programu teraz i następnego.
- **Przycisk archiwum zniknął z listy kanałów** — obok gwiazdki ulubionych
  rysował się jak „<<”. Nagrania otwiera się z opcji kanału i z programu TV.

### Zmieniono
- **Przycisk programu TV to sam napis „EPG”** — ikona kalendarza na telewizorze
  bywa nieczytelna.
- **Program, który leci teraz, ma w programie TV podpis „LIVE”**, a mocne
  podświetlenie należy do programu wybieranego pilotem — czyli wskazywanego do
  odtworzenia z archiwum.
- **Przez program TV biegnie pionowa linia bieżącej godziny** z godziną u góry;
  przesuwa się sama, dopóki ekran jest otwarty.

## [1.21.2] — 2026-10-03

### Zmieniono
- **„Typ źródła” widać od razu, bez rozwijanego menu.** Systemowa lista
  rozwijana na telewizorze rysowała się ciemno na ciemnym i nie było widać,
  która pozycja jest podświetlona. Wszystkie pozycje (Link do M3U, Plik M3U,
  Xtream) stoją teraz obok siebie jako przyciski, a wybrana jest podświetlona
  kolorem akcentu.
- **Pozycje pozostałych list rozwijanych** (motyw, język, odświeżanie EPG,
  archiwum) mają ciemne tło i jasny tekst, więc zaznaczenie też jest widoczne.
- **Przycisk ustawień w nagłówku to sama zębatka** — napis „Ustawienia” został
  w podpowiedzi przycisku, tak jak dotąd.

## [1.21.1] — 2026-10-03

### Naprawiono
- **Fokus nie ucieka już na początek ustawień po naciśnięciu „Pobierz i
  zainstaluj”.** Oba przyciski sekcji AKTUALIZACJE były w trakcie pobierania
  wyłączane, a wyłączony przycisk oddaje fokus początkowi ekranu — nie było jak
  zjechać do opisu zmian ani do „Zapisz i pobierz”. Teraz są tylko przygaszone.
- **Ekran przesuwa się o brakujący kawałek, a nie do samej krawędzi.** Jazda
  pilotem po ustawieniach szła „po schodkach”, a wszystko pod przyciskiem
  aktualizacji — stan pobierania, ostatnie zmiany, przyciski na dole ustawień —
  lądowało poza ekranem. Pod sfokusowanym elementem widać teraz sąsiednie
  wiersze, a to, co już jest widoczne, nie rusza ekranu wcale.
- **Zgubiony fokus liczy od miejsca, w którym był.** Gdy element zniknie
  z ekranu, strzałka idzie dalej od ostatniego miejsca, a nie od góry ustawień.

## [1.21.0] — 2026-10-03

### Dodano
- **Pilot w odtwarzaczu działa jak w telewizorze.** `▲` `▼` (CH+ / CH−) na obrazie
  wybierają następny i poprzedni kanał z listy, którą widać (kategoria, wyniki
  wyszukiwania), z zawijaniem na końcach; kanał oglądany z programu TV z innej
  kategorii szukany jest w całej playliście. Trzymana strzałka nie przełącza
  kanałów seriami — jedno naciśnięcie to jedna zmiana
  (`zapChannel()`, `listIndex()` w `www/app.js`).
- **Pauza i wznowienie na kanale na żywo.** `⏸` / `⏹` zatrzymuje obraz i zapamiętuje
  chwilę zatrzymania, a `⏵` po dłuższej pauzie (ponad 1,5 s) wraca przez okno
  catch-up dokładnie do tego miejsca, jeśli kanał ma archiwum. Bez archiwum (albo
  przy krótkiej pauzie) obraz leci dalej tym samym strumieniem, bez przeładowania
  (`pausePlayback()`, `resumePlayback()`).
- **`🔇` na pilocie** (449 webOS / Tizen, 173 klawiatura) wycisza i włącza dźwięk
  strumienia, a przycisk na pasku pokazuje stan: „🔇 Wycisz” albo „🔊 Dźwięk”.
- **Dwa przyciski więcej na pasku odtwarzacza**: `📅 Program TV` — siatka otwiera się
  na oglądanym kanale i `Wstecz` wraca do obrazu, nie do listy — oraz `🔇 Wycisz`.
- **Pytanie „Wyjdź z aplikacji?”.** `Wstecz` na liście kanałów nie zamyka już
  aplikacji od razu, tylko pokazuje potwierdzenie (Zostaję / Wyjdź). Na Android TV
  i Fire TV okno zamyka most `OpenIptvNative.quit()` dodany w `MainActivity`
  (samo `window.close()` w WebView jest ignorowane), na webOS i Tizenie kończy
  aplikację platforma, a w przeglądarce zostaje podpowiedź, że okno zamyka
  użytkownik. W `Wstecz` zamyka też to okno.
- **`npm run test:seek` sprawdza sterowanie obrazem.** Nowe scenariusze bez
  telewizora: pauza i wznowienie na żywo (z oknem catch-up, po krótkiej pauzie,
  bez archiwum), `⏵‖`, wyciszenie i `▲▼` z zawijaniem oraz kanałem spoza widocznej
  kategorii. Test nadal wyciąga funkcje z `www/app.js`, więc nie trzyma kopii logiki.
- **Instrukcja pilota w ustawieniach.** Nowa sekcja **„PILOT W ODTWARZACZU”**
  (`www/index.html`) z tabelą klawiszy — krótkie i przytrzymane `OK`, `MENU`,
  `▲ ▼`, `◀ ▶`, `⏪ ⏩`, `⏵‖`, `⏹`, `🔇` i `Wstecz` — oraz zdaniem, co robi każdy
  z nich na kanale na żywo i w archiwum. Opisy są w obu językach (`I18N_PL` /
  `I18N_EN` w `www/app.js`), tabela ma własny styl w `www/styles.css`
  (`.keys-table`, z wariantami dla trybu TV i dotykowego), a pilnuje jej
  `npm run test:ui`: komplet klawiszy, opis w każdym wierszu i to, że **każdy**
  napis z `index.html` ma wersję polską i angielską (102 klucze).

### Zmieniono
- **Strzałki na obrazie sterują transmisją, nie paskiem.** `◀` `▶` przewijają
  (o krok z ustawień, `⏪` `⏩` pilota zawsze), a `▲` `▼` przełączają kanał. Po
  przyciskach paska chodzą tylko wtedy, gdy fokus jest już na pasku (mysz, dotyk),
  dzięki czemu pilot nie „gubi się” między paskiem a kanałami.
- **Krótkie `OK` pokazuje i schowuje pasek**, a `MENU` albo trzymane `OK` otwiera
  menu opcji kanału — teraz z akcjami odtwarzacza także na kanale na żywo: od
  początku (catch-up), poprzedni/następny program, na żywo, cisza, EPG, ulubione.
- **Program TV podświetla oglądany kanał** (wiersz z akcentem), więc po powrocie
  z obrazu od razu widać, gdzie się jest.
- **Ustawienia wychodzą bez zapisu.** „Zapisz i pobierz” i nowy przycisk „Wstecz”
  stoją obok siebie; porzucone zmiany w formularzu nie trafiają do pliku ustawień.
- **Teksty interfejsu** (polskie i angielskie) opisują nowe klawisze: podpowiedź
  trybu TV, etykiety przycisków paska i pytanie o wyjście.
- **README opisuje pilota.** Nowa sekcja **Pilot w odtwarzaczu** — tabela klawiszy
  (kanał, przewijanie, pasek, menu, pauza, cisza, `Wstecz`), opis potwierdzenia
  wyjścia z aplikacji i wskazanie, gdzie w aplikacji leży ta sama instrukcja
  (Ustawienia → „Pilot w odtwarzaczu”).

### Naprawiono
- **Sterowanie w menu głównym (lista kanałów) działa jak pilot.** Cztery rzeczy
  zachowywały się źle, a wszystkie brały się z tego, że ekran nie był pisany pod
  fokus pilota:
  - **Grupa przełączała się sama.** Przycisk grupy wybierał kategorię już na
    `focus`, więc pilot schodząc z listy kanałów na boki (albo dojeżdżając do jej
    końca) przerzucał na inną kategorię w trakcie przewijania. Teraz grupę
    wybiera tylko `OK` (klik), a po wybraniu fokus od razu wchodzi w jej kanały.
  - **Z pola „Szukaj” nie dało się wyjść.** Pole tekstowe zjadało wszystkie
    strzałki (przesuwało kursor), a pilot nie ma `Tab`, więc z szukania nie
    było drogi ani do grup, ani do kanałów. Teraz `▼` przechodzi do listy
    kanałów, `▶` przy końcu tekstu do następnego pola paska, a `◀` — gdy kursor
    stoi na początku zapytania — do listy grup. W środku tekstu `◀` `▶` nadal
    przesuwają kursor, więc zapytanie można poprawiać.
  - **Po zapisaniu ustawień samo włączało się szukanie kanałów.** `showScreen()`
    stawiał fokus na pierwszym elemencie ekranu, a tym elementem jest pole
    szukania — na telewizorze wyskakiwała z niego klawiatura ekranowa. Wejście
    na ekran pomija teraz pola tekstowe, a lista kanałów zaczyna na wybranej
    grupie (`entryFocusTarget()`); po wczytaniu playlisty fokus wchodzi od razu
    w kanały (`focusChannelEntry()`), chyba że użytkownik właśnie pisze zapytanie.
  - **„Kropka” zamiast ikon.** Na telewizorze przyciski bez napisu (zębatka
    ustawień, odświeżanie) dostawały `padding` z reguły `body.uimode-tv button`
    — razem z szerokością 58 px zostawało 6 px na treść i ikona była ściśnięta
    do kreski. Poprawka: `body.uimode-tv .icon-button { padding: 0 }` i
    `flex: none` na SVG. Dodatkowo ikony przycisków są teraz **rysowane jako
    SVG, a nie znakami emoji** (`setIconLabel()` w `www/app.js`, ikony
    w `ICON_PATHS`): na dekoderach telewizyjnych czcionka emoji bywa okrojona
    i z „📅 Program TV” zostawała kropka. Przycisk `EPG` ma ikonę kalendarza,
    ustawienia — zębatkę razem z napisem „Ustawienia”, a gwiazdki ulubionych,
    archiwum, pasek odtwarzacza, menu opcji kanału i pytanie o wyjście mają
    własne ikony SVG.
- **Podpowiedź pilota pod listą kanałów jest widoczna.** `.tv-keys-hint` był
  szarym (`--faint`) tekstem 17 px położonym `position: absolute` na wierzchu
  listy. Teraz to pasek w układzie ekranu: tło `--surface`, ramka, tekst
  `--text` i 20 px, więc instrukcja czytelnie odcina się od kanałów.
- **`npm run test:nav` pilnuje menu głównego.** Test bez telewizora sprawdza na
  prawdziwych funkcjach z `www/app.js` (w `vm`): brak wyboru grupy na `focus`,
  strzałki w polu szukania, wejście fokusem w kanały po wybraniu grupy, pomijanie
  pól tekstowych przez `entryFocusTarget()`, a także to, że każdy napis
  z przycisku (pasek odtwarzacza, menu opcji, pytanie o wyjście, narzędzia grup)
  ma przypisaną ikonę SVG i że `index.html` oraz `styles.css` nie wróciły do
  emoji ani do ściskanego przycisku. Sterowanie opisuje też nowa sekcja README
  **Pilot na liście kanałów (menu główne)**.
- **„Wybierz plik M3U” i „Wybierz plik EPG” znów coś robią na telewizorach.**
  Przyciski były opakowaniem na `<input type="file">`, a Fire TV (i część
  Android TV) nie ma żadnej aplikacji z systemowym oknem wyboru plików — kliknięcie
  nie miało czego otworzyć, więc nic się nie działo i nie było nawet błędu. Wybór
  przejmuje teraz plugin natywny `OpenIptvFiles`
  (`android/app/src/main/java/pl/openiptv/player/FilePlugin.java`, rejestrowany
  w `MainActivity` obok `UpdatePlugin`): próbuje systemowego wyboru dokumentów
  (`ACTION_OPEN_DOCUMENT`, potem `ACTION_GET_CONTENT`), a gdy takiego okna nie ma,
  pokazuje własną listę katalogów do chodzenia pilotem — pamięć urządzenia, karta
  USB, dysk; katalogi pierwsze, `../` w górę, pierwsze 300 pozycji, pliki ukryte
  pomijane. Wybrany plik kopiuje do pamięci aplikacji i oddaje `www` jego ścieżkę,
  a strona czyta go przez lokalny serwer Capacitora (`/_capacitor_file_/`) — bez
  zależności od uprawnień do cudzego URI. `READ_EXTERNAL_STORAGE` w manifeście ma
  `maxSdkVersion="32"`, więc na Androidzie 12 i starszym plugin poprosi
  o uprawnienie, a na Androidzie 13+ pójdzie przez systemowy wybór dokumentów.
  Plik EPG czytany jest binarnie, a GZIP rozpoznawany po nagłówku, więc spakowany
  plik o nazwie `.xml` też się rozpakuje. Przyciski wyboru to teraz prawdziwe
  `<button>` z fokusem pilota (podświetlenie w trybie TV), a ukryte pola pliku
  zostały jako ścieżka zapasowa dla przeglądarki i telefonu.
- **webOS mówi, co zrobić zamiast martwego przycisku.** Systemowego wyboru pliku
  tam nie ma i nie będzie, więc wybór M3U/EPG pokazuje podpowiedź: wpisz adres
  playlisty (Typ źródła: Link do M3U) albo dane Xtream.
- **`npm run test:pick` pilnuje wyboru pliku.** Test bez telewizora sprawdza
  przyciski, napisy (polskie i angielskie) i styl pola pliku w `www/`, plugin
  `FilePlugin.java` wraz z jego rejestracją i uprawnieniem w paczce Android, a na
  prawdziwych funkcjach wyciągniętych z `www/app.js` (uruchomionych w `vm`) same
  decyzje: udany wybór playlisty i EPG, anulowanie, brak czym wybrać, odrzucone
  wywołanie pluginu, nieczytelny plik i błędny GZIP.
- **README opisuje wybór pliku.** Nowa sekcja **Plik M3U i EPG z pamięci** —
  tabela zachowania na trzech platformach, kolejność prób w pluginie, kopia pliku
  do pamięci aplikacji i uprawnienie ograniczone do Androida 12.
- **Opis wydania na GitHubie opisuje tylko wydawaną wersję.** Pliki z „co nowego”
  (`dist/release-notes-<wersja>.md`) powstawały ręcznie i miały ogon z poprzednich
  wydań — wydanie 1.20.0 opisywało też 1.19.4 i 1.19.3, a 1.20.1 jeszcze 1.20.0.
  Teraz opis wycina z `CHANGELOG.md` generator `scripts/release-notes.js`
  (`npm run notes`) i kończy go na nagłówku następnej wersji,
  `npm run publish -Release` tworzy opis sam (własny nadal przyjmuje `-Notes`)
  i przerywa publikację, gdy w opisie jest więcej niż jedna wersja. Pilnuje tego
  nowy `npm run test:notes`.

## [1.20.1] — 2026-10-02

### Naprawiono
- **Ekran startowy pokazuje logo OpenIPTV.** Przy włączaniu (Android TV, Fire TV)
  widniał domyślny obrazek z szablonu Capacitora — białe tło i obcy znak — więc
  logo było inne niż na ikonie aplikacji. Teraz wszystkie jedenaście wariantów
  `drawable*/splash.png` powstaje w tym samym generatorze co ikony
  (`scripts/make-icons.ps1`): tło w kolorze aplikacji (`#0a0c11`, ten sam co
  `--bg` w `www/styles.css` i `bgColor` w manifeście webOS) oraz ten sam znak
  (`$script:SplashLogo = 0.26` krótszego boku) na środku. Start nie mruga już na
  biało — ekran startowy przechodzi w interfejs bez zmiany koloru.

### Dodano
- **`npm run test:splash`** — test bez telewizora i bez emulatora: czyta pliki PNG
  własnym kodem i sprawdza w każdym wariancie wymiary, tło, rozmiar znaku i jego
  wyśrodkowanie, a także to, że `make-icons.ps1` opisuje te same pliki.

## [1.20.0] — 2026-10-02

### Dodano
- **Rozmiar interfejsu dobierany do ekranu.** Aplikacja wykrywa rozdzielczość
  ekranu (piksele fizyczne = rozmiar w px CSS × gęstość) i sama ustawia wielkość
  interfejsu: na 1080p i 4K zostaje projekt 1920 px, a na 720p i mniejszych
  układ zwęża się do 1371 px, dzięki czemu litery mają tyle samo pikseli ekranu,
  co na 1080p (są o 40% większe). W ustawieniach doszła lista **Rozmiar
  interfejsu**: Automatyczny, 100%, 115%, 130% i 150% — dla dużych odległości
  i słabszego wzroku. Pod listą widać, co wykryto, np. „Wykryty ekran:
  1920×1080 px, gęstość 2.0× — układ 1920 px, skala 100%”.
- **Skala działa też w trakcie pracy.** Gdy telewizor zmieni rozdzielczość,
  układ przelicza się sam. Wybrany rozmiar obowiązuje jeszcze przed pierwszym
  rysowaniem strony (`www/ui-scale.js` czyta go z pamięci ustawień), więc nic
  nie mruga; jeśli starszy WebView nie przełoży zmiany „meta viewport” na
  układ, strona wczytuje się raz jeszcze. Na komputerze skalę robi zoom CSS.

### Zmieniono
- **Nagłówek przy wąskim układzie.** Przy skali 150% (układ 1280 px) przyciski
  w nagłówku nie są już ucinane — ekran telewizora układa się kolumną, a lista
  kanałów zabiera resztę wysokości.

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
- **Wydanie z nowszym numerem** (`versionCode 18`) — sama zmiana numeru wersji,
  żeby webOS i Android przyjęły paczkę jako aktualizację; bez zmian w działaniu.

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

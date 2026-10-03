/* OpenIPTV — wspólny kod dla webOS (.ipk) i Fire TV (.apk)
 *
 * ŹRÓDŁA (na profil):
 *   - Playlista M3U : adres URL lub plik lokalny
 *   - Xtream Codes  : serwer + użytkownik + hasło (player_api.php)
 * EPG:
 *   - XMLTV (.xml / .gz) z URL lub pliku lokalnego
 *   - dla Xtream: automatycznie z <serwer>/xmltv.php
 * ARCHIWUM / CATCH-UP:
 *   - własny szablon (np. ...start={utc}&end={utcend})
 *   - doklejanie ?utc=&lutc= (catchup="append")
 *   - Xtream <serwer>/timeshift/... (catchup="default" / 1)
 */
(function () {
  "use strict";

  var SCREENS = ["settingsScreen", "browserScreen", "archiveScreen", "guideScreen", "playerScreen"];
  var SETTINGS_KEY = "openiptvSettings";
  /* Wielkie teksty (playlista i EPG wczytane z pliku) trzymamy w osobnym kluczu
     localStorage, żeby zapis ulubionych, kolejności grup i „ostatnio oglądane”
     był natychmiastowy i nie przepisywał za każdym razem megabajtów danych. */
  var BLOBS_KEY = "openiptvBlobs";
  var BLOB_FIELDS = ["playlistFileText", "epgFileText", "playlistFileName", "epgFileName"];
  var APP_VERSION = "1.21.7";
  var SCHEMA_VERSION = 4;

  /* „Ostatnio oglądane”: kanał trafia na listę po 10 s oglądania,
     a lista trzyma tylko 15 najnowszych (starsze wypadają) */
  var RECENT_DELAY = 10000;
  var RECENT_LIMIT = 15;

  /* Lista kanałów budowana jest porcjami („okienkowo”): DOM trzyma wtedy
     kilkadziesiąt kart zamiast kilkunastu tysięcy, więc przewijanie i
     sterowanie pilotem działa płynnie nawet na bardzo dużych playlistach. */
  var LIST_CHUNK = 60;
  /* Ile pikseli przed ekranem wczytujemy logotyp kanału (resztę leniwie) */
  var LOGO_MARGIN = 800;
  /* Po ilu ms samoczynnie znika pasek informacyjny odtwarzacza */
  var OSD_AUTOHIDE = 6000;
  /* Po jakim czasie trzymania OK otwiera się menu opcji kanału (TV) */
  var OK_HOLD_MS = 700;
  /* Ile czekamy na obraz, zanim uznamy, że dany sposób odtwarzania zawiódł */
  var START_TIMEOUT = 9000;
  /* Ile pozycji archiwum rysujemy naraz — 7 dni po kilkadziesiąt programów to
     setki przycisków; resztę i tak „chowa” filtr dni w ustawieniach. */
  var ARCHIVE_MAX = 240;
  /* Ile godzin w przód pokazuje lista programów otwarta z odtwarzacza (przycisk
     „EPG” na pasku) — tyle wystarczy, żeby zobaczyć, co będzie dalej, bez
     rysowania całego EPG dnia. */
  var ARCHIVE_AHEAD = 12 * 3600000;
  /* Ile kanałów pokazuje program TV (EPG). Przy 5000 kanałów nie da się
     zbudować całej siatki bez zamrożenia interfejsu, a i tak nikt nie
     przewija 5000 wierszy pilotem — resztę zawęża się kategorią. */
  var GUIDE_ROWS = 60;
  /* Szerokość kolumny z nazwami kanałów w programie TV — tyle samo co
     w styles.css (.guide-channel i .guide-corner). Potrzebna, żeby linia
     bieżącej godziny wypadła dokładnie na początku osi czasu, także wtedy, gdy
     siatka jest jeszcze niewidoczna i nie da się jej zmierzyć. */
  var GUIDE_CHANNEL_WIDTH = 260;
  /* Co ile przesuwamy linię bieżącej godziny: przy 280 px na godzinę minuta to
     ~4,7 px, więc częstsze odświeżanie niczego nie zmienia. */
  var GUIDE_NOWLINE_MS = 20000;
  /* Jak długo kanał na żywo może stać w pauzie, żeby wznowienie poszło jeszcze
     z tego samego strumienia. Po tym czasie obraz ucieka do przodu, więc
     wznawiamy z archiwum dokładnie od chwili zatrzymania — inaczej „wznów”
     pokazałoby skok do bieżącej chwili (patrz resumePlayback). */
  var RESUME_AFTER_PAUSE = 1500;

  var state = {
    channels: [],
    programs: {},
    epgUrl: "",
    epgTimer: null,
    selectedChannel: null,
    selectedGroup: "@all",
    playerReturn: "browserScreen",
    isArchive: false,
    /* chwila, w której użytkownik zatrzymał kanał na żywo (0 = nie zatrzymał);
       wznowienie wraca dokładnie w to miejsce — patrz resumePlayback() */
    livePauseAt: 0,
    /* kiedy ostatnio obsłużyliśmy klawisz multimedialny pilota (⏵‖ / ⏹).
       Jedno naciśnięcie ma dać jedną akcję, a część dekoderów wysyła klawisz
       dopiero na zwolnieniu — patrz mediaKeyAction() i keyup niżej. */
    mediaKeyAt: 0,
    currentSource: "",
    altSource: "",
    retryCount: 0,
    retryTimer: null,
    stableTimer: null,
    orderEdit: false,
    orderFocus: null,
    /* licznik oglądania dla „Ostatnio oglądane” */
    recentChannel: null,
    recentTimer: null,
    watchedMs: 0,
    watchStart: 0,
    recentRecorded: false,
    recentDirty: false,
    /* lista kanałów budowana porcjami (wydajność na dużych playlistach) */
    listItems: [],
    listRendered: 0,
    listGroup: null,
    listToken: 0,
    /* odtwarzacz: kolejka prób (natywnie / MSE / HLS) */
    sources: [],
    sourceIndex: 0,
    cycle: 0,
    engine: "",
    engineInstance: null,
    engineLoading: false,
    watchChannel: null,
    watchProgram: null,
    /* przewijanie archiwum: ostatni skok (kierunek i ile sekund). Pasek opisuje
       nim chwilę, w której dekoder donosi obraz na nową pozycję — bez tego
       wyglądało to jak wczytywanie strumienia od zera. */
    seekAt: 0,
    seekDirection: 0,
    seekSize: 0,
    osdTimer: null,
    osdTicker: null,
    /* EPG */
    epgLoading: false,
    epgToken: 0,
    epgLoaded: false,
    /* klawisz OK trzymany wciśnięty (menu kontekstowe na TV) */
    okHoldTimer: null,
    okFired: false,
    okAction: null,
    /* odrzucanie zdublowanych błędów <video> (jeden błąd = jedno przejście) */
    lastErrorAt: 0,
    /* budzik sprawdzający, czy obraz w ogóle się pojawił */
    startTimer: null,
    /* blokada zdarzeń przewijania listy (rysujemy jedną porcję na raz) */
    listScrollLock: false
  };

  var overlayTimer = null;
  var settingsWriteTimer = null;
  var logoObserver = null;   // wspólny obserwator dla leniwego wczytywania logotypów
  var epgAliases = {};   // nazwa wyświetlana (małe litery) -> id kanału EPG

  var guide = {          // widok "Program TV"
    windowStart: 0,
    hours: 3,
    hourWidth: 280,
    /* wiersze również rysujemy porcjami — inaczej lista 20 000 kanałów zabija TV */
    items: [],
    rendered: 0,
    token: 0,
    /* kanał, na którym EPG ma stanąć po otwarciu (oglądany kanał), oraz ekran,
       do którego wracamy po zamknięciu programu TV */
    focusKey: "",
    returnTo: "browserScreen",
    /* zegar przesuwający linię bieżącej godziny (działa tylko na widocznym
       programie TV — pilnuje tego showScreen) */
    lineTimer: null
  };

  /* Ekran „Archiwum / programy kanału”. Ten sam ekran obsługuje dwa wejścia:
     z listy kanałów (nagrania z ostatnich dni) i z odtwarzacza (wszystkie
     programy oglądanego kanału: poprzednie, bieżący i następne). Pamięta więc,
     skąd przyszedł i dokąd wraca klawisz „Wstecz”. */
  var archive = {
    channel: null,
    fromPlayer: false,
    returnTo: "browserScreen"
  };

  var DEFAULTS = {
    profiles: [],
    profilesInitialized: false,
    activeProfileId: "",
    playlistUrl: "",
    playlistFileText: "",
    playlistFileName: "",
    epgUrl: "",
    archiveDays: 7,
    seekSeconds: 10,
    retryAttempts: 3,
    dpadSeek: true,
    catchupTemplate: "",
    catchupAll: true,
    epgRefreshMinutes: 0,
    epgReloadOnStart: true,
    language: "pl",
    theme: "dark",
    uiMode: "auto",
    uiScale: "auto",
    osdEnabled: true,
    favorites: {},
    recentChannels: {},
    groupOrder: {}
  };

  var settings = loadSettings();

  /* TŁUMACZENIA — polski */
  var I18N_PL = {
    settings: "Ustawienia", new: "Nowy", delete: "Usuń", profile_name: "Nazwa profilu",
    sources: "ŹRÓDŁA", source_type: "Typ źródła", m3u_url: "Link do M3U", m3u_file: "Plik M3U",
    xtream: "Xtream (login)", playlist_url: "Adres playlisty M3U", pick_m3u_file: "Wybierz plik M3U",
    add_local_file: "dodaj lokalny plik", active_file: "Aktywny plik: {name}",
    xtream_hint: "Dane z panelu Xtream Codes. Podaj sam adres (host:port) — kanały, kategorie, EPG i archiwum pobiorą się automatycznie.",
    xtream_server: "Adres serwera Xtream", username: "Użytkownik", password: "Hasło",
    epg_url: "EPG XMLTV (opcjonalny — Xtream pobiera go sam)", pick_epg_file: "Wybierz plik EPG",
    use_link: "Użyj linku", add_local_epg: "lub dodaj lokalny plik XMLTV",
    pick_no_files: "Ten telewizor nie ma czym wybrać pliku — wpisz adres playlisty (Typ źródła: Link do M3U) albo dane Xtream.",
    pick_m3u_error: "Nie udało się odczytać pliku M3U.",
    pick_epg_error: "Nie udało się odczytać pliku EPG.",
    pick_epg_unzip: "Nie udało się rozpakować pliku EPG: {error}",
    epg_update: "EPG — AKTUALIZACJA",
    epg_refresh: "Odświeżanie EPG", on_start: "Tylko przy starcie", every_30min: "Co 30 minut",
    every_1h: "Co 1 godzinę", every_2h: "Co 2 godziny", every_6h: "Co 6 godzin",
    every_12h: "Co 12 godzin", every_24h: "Co 24 godziny", epg_reload_on_start: "Pobieraj EPG przy starcie",
    archive_playback: "ARCHIWUM I ODTWARZANIE", archive_days: "Dni EPG/archiwum wstecz",
    seek_step: "Krok przewijania archiwum", sec5: "5 sekund", sec10: "10 sekund", sec30: "30 sekund",
    min1: "1 minuta", min5: "5 minut", min10: "10 minut",
    retry_attempts: "Próby ponownego uruchomienia kanału", disabled: "Wyłączone",
    attempt1: "1 próba", attempt2: "2 próby", attempt3: "3 próby", attempt5: "5 prób", attempt10: "10 prób",
    dpad_seek: "Strzałki sterują transmisją: ◀ ▶ przewija, ▲ ▼ zmienia kanał", advanced: "ZAAWANSOWANE (OPCJONALNE)",
    catchup_template: "Globalny szablon catch-up", catchup_all: "Catch-up na wszystkich kanałach (HLS)", save: "Zapisz i pobierz",
    appearance: "WYGLĄD I JĘZYK", language: "Język", theme: "Motyw", theme_dark: "Ciemny", theme_light: "Jasny",
    search: "Szukaj", refresh: "Odśwież", guide_title: "Program TV", guide_prev_day: "‹ Dzień",
    guide_next_day: "Dzień ›", guide_yesterday: "Wczoraj", guide_day_before: "Przedwczoraj", today: "Dziś", date: "Data", time: "Godzina",
    guide_pan_hint: "◀ ▶ — przewijanie godzin",
    back: "Wstecz", live: "LIVE", catchup: "CATCH-UP", archive: "Archiwum",
    loading: "Pobieranie…", all: "Wszystkie", favorites: "★ Ulubione", recent: "Ostatnio oglądane",
    group_order: "⇅ Kolejność grup", group_order_done: "✓ Gotowe", order_reset: "Alfabetycznie",
    order_hint: "Przestaw grupy przyciskami ▲ / ▼, a potem wybierz „Gotowe”.",
    other: "Pozostałe", channel: "Kanał", program: "Program",
    connecting_xtream: "Łączenie z panelem Xtream…", loading_playlist: "Pobieranie playlisty…",
    loading_epg: "Pobieranie EPG…", parsing_epg: "Parsowanie EPG…",
    channels_count: "kanałów", epg_programs: "programów", epg_no_data: "brak danych",
    no_epg: "Brak informacji EPG", next: "Następnie", error: "Błąd:", hourly_recording: "Nagranie godzinowe",
    archive_title: "Archiwum • ", days_back: " dni wstecz", archive_catchup: "Archiwum / catch-up",
    err_http: "Serwer zwrócił HTTP {code}", err_http_access: "Serwer zwrócił HTTP {code} (brak dostępu).",
    err_network: "Nie można pobrać danych (sieć / CORS).", err_timeout: "Przekroczono czas połączenia.",
    err_xtream_auth: "Xtream: nieprawidłowy adres serwera, użytkownik lub hasło.",
    err_xtream_inactive: "Xtream: konto nieaktywne ({status}). Sprawdź datę ważności.",
    err_xtream_no_channels: "Xtream nie zwrócił żadnych kanałów live dla tego konta.",
    err_xtream_json: "Panel Xtream zwrócił nieprawidłową odpowiedź (oczekiwano JSON).",
    err_not_m3u: "To nie jest playlista M3U.", err_no_channels: "Playlista nie zawiera kanałów.",
    err_epg_xml: "EPG nie jest poprawnym XMLTV.", err_gzip: "Brak biblioteki rozpakowującej GZIP.",
    err_playback: "Nie udało się rozpocząć odtwarzania.",
    err_stream: "Błąd odtwarzania strumienia. Format lub serwer może nie być obsługiwany przez ten model TV.",
    err_catchup: "Brak obsługiwanego szablonu catch-up dla tego kanału.",
    err_read_file: "Nie udało się odczytać pliku.", err_read_m3u: "Nie udało się odczytać pliku M3U.",
    err_read_epg: "Nie udało się odczytać pliku EPG.", err_gunzip: "Nie udało się rozpakować pliku EPG: {msg}",
    err_worker: "Nie udało się uruchomić parsera EPG.",
    err_xtream_required: "Xtream: podaj adres serwera, użytkownika i hasło.",
    err_m3u_file_required: "Wybierz lokalny plik M3U.",
    err_m3u_url_required: "Podaj pełny adres http:// lub https:// do playlisty M3U.",
    err_epg_url: "Adres EPG musi zaczynać się od http:// lub https://",
    err_storage: "Dane są zbyt duże, aby zapisać je w pamięci aplikacji (zbyt duży plik M3U/EPG).",
    err_delete_confirm: "Usunąć ten profil (playlistę, login Xtream i EPG)?",
    retry_msg: "Ponawiam próbę {n} z {total}…", retry_fail: "Nie udało się uruchomić kanału po {total} próbach.",
    retry_off: "Automatyczne ponawianie jest wyłączone.", back_hint: "Naciśnij Wstecz, aby wybrać inny kanał.",
    retry_alt_hls: "Kanał nie działa jako TS — próbuję HLS (m3u8)…",
    media_code: "kod {code}", media_aborted: "przerwane", media_network: "błąd sieci / serwera",
    media_decode: "błąd dekodowania materiału", media_unsupported: "format nieobsługiwany", media_url: "Adres",

    /* ---------- 1.18.0 ---------- */
    ui_mode: "Tryb interfejsu",
    ui_mode_auto: "Automatyczny (TV / telefon)",
    ui_mode_tv: "Telewizor (pilot, 10 stóp)",
    ui_mode_touch: "Dotykowy (telefon / tablet)",
    ui_scale: "Rozmiar interfejsu",
    ui_scale_auto: "Automatyczny (wg rozdzielczości ekranu)",
    ui_scale_100: "100%",
    ui_scale_115: "115% — większe litery",
    ui_scale_130: "130% — duże litery",
    ui_scale_150: "150% — największe",
    screen_info: "Wykryty ekran: {width}×{height} px, gęstość {dpr}× — układ {canvas} px, skala {scale}% ({source}).",
    scale_source_auto: "automatyczna",
    scale_source_manual: "ustawiona ręcznie",
    osd_enabled: "Mini-EPG na kanale (co teraz leci)",
    platform_line: "Wykryto: {name} • interfejs: {mode}",
    platform_firetv: "Fire TV", platform_androidtv: "Android TV", platform_webos: "webOS",
    platform_android: "Android", platform_ios: "iOS", platform_browser: "komputer / przeglądarka",
    mode_tv: "telewizyjny (pilot)", mode_touch: "dotykowy",
    tv_hint: "OK – oglądaj • MENU / długie OK – opcje • ◀ ▲ ▼ ▶ – nawigacja • EPG: ◀ ▶ – godziny • w kanale: ▲ ▼ kanał, ◀ ▶ przewijanie",
    osd_restart: "⏪ Od początku",
    osd_prev_program: "◀ Poprzedni",
    osd_next_program: "Następny ▶",
    osd_live: "⏵ Na żywo",
    osd_back: "✕ Wstecz",
    osd_pause: "⏸ Pauza",
    osd_play: "⏵ Wznów",
    osd_hint_live: "OK – pasek • ⏵‖ – pauza/wznów • ▲ ▼ – kanał • ◀ ▶ – cofnij / do przodu • EPG – programy kanału • MENU – opcje • Wstecz – wyjście",
    osd_hint_archive: "OK – pasek • ⏵‖ – pauza/wznów • ▲ ▼ – kanał • ◀ ▶ – przewijanie • EPG – programy kanału • Wstecz – wyjście",
    osd_now: "Teraz:",
    osd_next_label: "Następnie:",
    osd_paused: "PAUZA",
    osd_epg: "📅 EPG",
    osd_mute: "🔇 Wycisz",
    osd_unmute: "🔊 Dźwięk",
    osd_muted: "WYCISZONE",
    ctx_menu: "Kanał",
    ctx_play: "⏵ Oglądaj",
    ctx_fav_add: "☆ Dodaj do ulubionych",
    ctx_fav_del: "★ Usuń z ulubionych",
    ctx_archive: "⏪ Archiwum / catch-up",
    ctx_epg: "📅 Program TV (EPG)",
    ctx_close: "✕ Zamknij",
    epg_parsing_progress: "EPG… {pct}%",
    epg_filtered: "EPG dla {shown} kanałów",
    err_player_lib: "Nie udało się wczytać odtwarzacza ({name}).",
    err_no_mse: "Brak obsługi strumieni TS w tym odtwarzaczu (MSE).",
    retry_engine_mse: "Próbuję odtwarzacz TS (MSE)…",
    retry_engine_hls: "Próbuję odtwarzacz HLS…",
    engine_mse: "TS/MSE", engine_hls: "HLS",
    engine_native: "natywnie",
    epg_none: "Brak danych EPG dla tego kanału.",
    archive_day_today: "Dziś", archive_day_yesterday: "Wczoraj", archive_day_before: "Przedwczoraj",
    archive_limited: "pokazano {shown} z {total}",
    guide_limited: "pokazano {shown} z {total} kanałów (zawęź kategorię)",
    osd_buffering: "Ładowanie strumienia…",
    seek_back: "Cofnięto o {s} s",
    seek_forward: "Przesunięto o +{s} s",
    engine_line: "Silnik: {name}",

    /* ---------- 1.19.0 ---------- */
    updates: "AKTUALIZACJE",
    updates_hint: "Nic nie instaluje się samo: przy wejściu w ustawienia aplikacja tylko mówi, że jest nowsza wersja, i krótko wypisuje, co się zmieniło. Aktualizację uruchamia dopiero przycisk „Pobierz i zainstaluj”.",
    update_check: "Sprawdź aktualizacje",
    update_install: "Pobierz i zainstaluj",
    update_checking: "Sprawdzam najnowsze wydanie…",
    update_current: "Masz najnowszą wersję (v{version}).",
    update_available: "Dostępna nowa wersja {latest} — masz {current}.",
    update_changes: "Co nowego w {latest}:",
    update_asset: "Paczka: {name} ({size})",
    update_manual: "webOS nie instaluje paczek sam — pobierz .{ext} na komputerze i wgraj przez tryb deweloperski (ares-install). Adres: {url}",
    update_downloading: "Pobieram paczkę… {pct}%",
    update_permission: "Włącz dla OpenIPTV zgodę na instalowanie aplikacji z nieznanych źródeł i naciśnij „Pobierz i zainstaluj” ponownie.",
    update_installer: "Paczka pobrana — potwierdź aktualizację w instalatorze na ekranie.",
    update_err: "Nie udało się zaktualizować: {msg}",
    update_err_data: "GitHub nie zwrócił informacji o wydaniu.",
    update_err_404: "GitHub nie widzi wydań tej aplikacji (HTTP 404). Sprawdzanie aktualizacji w aplikacji działa tylko wtedy, gdy repozytorium i wydania są publiczne.",
    update_err_json: "GitHub zwrócił nieprawidłową odpowiedź (oczekiwano JSON).",
    update_notice: "Nowa wersja {latest} (masz {current}) — Ustawienia → Aktualizacje.",
    update_err_unknown: "nieznany błąd",

    /* ---------- 1.21.0 — wyjście z aplikacji pytaniem, nie od razu ---------- */
    exit_title: "Wyjść z aplikacji?",
    exit_hint: "Zamknij OpenIPTV albo zostań na liście kanałów.",
    exit_confirm: "⏻ Wyjdź z aplikacji",
    exit_cancel: "✕ Zostań",
    exit_manual: "Ta platforma nie pozwala zamknąć okna z aplikacji — użyj przycisku zakończenia na pilocie.",

    /* ---------- 1.21.0 — instrukcja pilota w ustawieniach (sekcja „PILOT W ODTWARZACZU”) ---------- */
    player_keys: "PILOT W ODTWARZACZU",
    player_keys_hint: "Tak działa pilot, gdy leci kanał albo archiwum. Ustawienie „◀ ▶ przewija” dotyczy tylko strzałek — ⏪ ⏩ przewijają zawsze. Na dotykowym ekranie te same akcje są na pasku u dołu obrazu.",
    key_ok_short: "Pasek z nazwą kanału, programem i postępem: pokaż albo schowaj.",
    key_ok_hold: "Przytrzymaj około sekundy: menu opcji kanału (ulubione, archiwum, program TV, od początku, cisza).",
    key_menu: "To samo menu opcji kanału, bez trzymania OK.",
    key_updown: "Następny i poprzedni kanał z widocznej listy (jak CH+ / CH−), z zawijaniem na końcach. Jedno naciśnięcie to jedna zmiana.",
    key_leftright: "Przewijanie o krok z ustawienia „Krok przewijania archiwum”: na nagraniu skok w tył i w przód, na kanale na żywo ◀ wchodzi w catch-up, a ▶ wznawia zatrzymany obraz.",
    key_rewff: "Przewijanie pilota działa zawsze, także przy wyłączonych strzałkach; ⏩ na końcu programu wraca na żywo.",
    key_playpause: "Pauza i wznowienie. Po dłuższej pauzie kanał na żywo wraca do chwili zatrzymania przez catch-up, a bez archiwum obraz dogania transmisję.",
    key_stop: "Zatrzymanie obrazu — to samo co pauza.",
    key_mute: "Cisza w odtwarzaczu; głośność telewizora zostaje bez zmian.",
    key_back: "Wstecz",
    key_back_desc: "Zamyka menu albo pasek; z obrazu wraca do listy kanałów, a z listy pyta „Wyjdź z aplikacji?”.",

    /* ---------- 1.21.4 — zakładki w ustawieniach i EPG w odtwarzaczu ---------- */
    tab_general: "Ogólne",
    tab_update: "Aktualizacja",
    tab_help: "Instrukcja",
    tabs_hint: "Zakładki ustawień: ◀ ▶ zmieniają zakładkę, ▼ wchodzi w treść.",
    help_title: "JAK KORZYSTAĆ Z APLIKACJI",
    help_intro: "Poradnik w trzech krokach: źródło kanałów, poruszanie się pilotem i odtwarzacz z archiwum.",
    help_setup: "1. ŹRÓDŁO KANAŁÓW",
    help_setup_text: "Playlistę wpisuje się w zakładce „Ogólne”: adres M3U, plik z pamięci urządzenia albo login Xtream. Po zapisaniu kanały, EPG i archiwum pobierają się same.",
    help_nav: "2. PORUSZANIE SIĘ",
    help_nav_move: "Strzałki chodzą po przyciskach, grupach i liście kanałów — podświetlenie zawsze widać.",
    help_nav_ok: "Wybierz podświetloną pozycję: kategorię, kanał albo przycisk.",
    help_nav_menu: "Menu opcji kanału bez trzymania OK — to samo, co przytrzymane OK na kafelku kanału.",
    help_nav_search: "Pole szukania. Wychodzi się z niego strzałkami: ▼ do listy kanałów, ◀ na początku tekstu do grup, ▶ na końcu do paska u góry.",
    help_nav_back: "Zamyka nakładkę albo wraca o ekran wstecz. Na liście kanałów pyta, czy wyjść z aplikacji.",
    help_epg: "PROGRAM TV (EPG)",
    help_epg_grid: "Przycisk „EPG” w nagłówku otwiera siatkę wszystkich kanałów na osi czasu. Program, który leci teraz, ma podpis LIVE, a pionowa linia pokazuje bieżącą godzinę.",
    help_epg_pan: "Przewijanie osi czasu o godzinę — dowolnie daleko w obie strony.",
    help_epg_days: "Skok o dzień wstecz albo w przód; obok są pola daty i godziny do wskazania dokładnej chwili.",
    help_epg_pick: "Zakończony program włącza się z archiwum, a ten, który leci teraz — na żywo.",
    help_catchup: "ARCHIWUM I CATCH-UP",
    help_catchup_list: "Przycisk „EPG” na pasku odtwarzacza otwiera listę programów oglądanego kanału: poprzednie, bieżący i następne. Wybierz pozycję i naciśnij OK, żeby odtworzyć ją z archiwum.",
    help_catchup_live: "Przycisk „Na żywo” (na pasku odtwarzacza albo nad listą programów) wraca do bieżącej chwili.",
    help_catchup_days: "Ile dni wstecz sięga archiwum, ustawia „Dni EPG/archiwum wstecz” w zakładce „Ogólne”, a wielkość skoku — „Krok przewijania archiwum”.",
    help_catchup_note: "Kanał bez archiwum pokaże komunikat zamiast obrazu, a kanał bez EPG dostaje nagrania godzinowe — dzięki temu archiwum zostaje użyteczne.",
    help_touch: "TELEFON I TABLET",
    help_touch_bar: "Te same akcje są na pasku u dołu obrazu — wystarczy dotknąć. Tylko tutaj, bez pilota, pasek ma także „Kanał” (menu opcji) i „Wstecz”, i zawija się do kilku rzędów.",
    help_touch_back: "Wyjście z obrazu: przycisk „Wstecz” na pasku albo systemowy przycisk wstecz na telefonie.",
    help_update: "AKTUALIZACJA",
    help_update_text: "Aktualizacja siedzi we własnej zakładce „Aktualizacja”: nic nie instaluje się samo, a pobranie paczki uruchamia dopiero przycisk.",
    epg_list_title: "Program • {name}",
    epg_list_hint: "poprzednie • teraz • następne",
    epg_list_days: " • {days} dni wstecz",
    epg_list_future: "jeszcze nie było"
  };

  /* TŁUMACZENIA — angielski */
  var I18N_EN = {
    settings: "Settings", new: "New", delete: "Delete", profile_name: "Profile name",
    sources: "SOURCES", source_type: "Source type", m3u_url: "M3U link", m3u_file: "M3U file",
    xtream: "Xtream (login)", playlist_url: "M3U playlist URL", pick_m3u_file: "Choose M3U file",
    add_local_file: "add a local file", active_file: "Active file: {name}",
    xtream_hint: "Xtream Codes panel credentials. Enter just the address (host:port) — channels, categories, EPG and archive will load automatically.",
    xtream_server: "Xtream server address", username: "Username", password: "Password",
    epg_url: "EPG XMLTV (optional — Xtream loads it automatically)", pick_epg_file: "Choose EPG file",
    use_link: "Use link", add_local_epg: "or add a local XMLTV file",
    pick_no_files: "This TV has no way to pick a file — enter the playlist address (Source type: M3U link) or Xtream credentials.",
    pick_m3u_error: "Could not read the M3U file.",
    pick_epg_error: "Could not read the EPG file.",
    pick_epg_unzip: "Could not unpack the EPG file: {error}",
    epg_update: "EPG — UPDATES",
    epg_refresh: "EPG refresh", on_start: "Only on start", every_30min: "Every 30 minutes",
    every_1h: "Every 1 hour", every_2h: "Every 2 hours", every_6h: "Every 6 hours",
    every_12h: "Every 12 hours", every_24h: "Every 24 hours", epg_reload_on_start: "Load EPG on start",
    archive_playback: "ARCHIVE & PLAYBACK", archive_days: "EPG/archive days back",
    seek_step: "Archive seek step", sec5: "5 seconds", sec10: "10 seconds", sec30: "30 seconds",
    min1: "1 minute", min5: "5 minutes", min10: "10 minutes",
    retry_attempts: "Channel retry attempts", disabled: "Disabled",
    attempt1: "1 attempt", attempt2: "2 attempts", attempt3: "3 attempts", attempt5: "5 attempts", attempt10: "10 attempts",
    dpad_seek: "Arrow keys control playback: ◀ ▶ seek, ▲ ▼ change channel", advanced: "ADVANCED (OPTIONAL)",
    catchup_template: "Global catch-up template", catchup_all: "Catch-up on all channels (HLS)", save: "Save & load",
    appearance: "APPEARANCE & LANGUAGE", language: "Language", theme: "Theme", theme_dark: "Dark", theme_light: "Light",
    search: "Search", refresh: "Refresh", guide_title: "TV Guide", guide_prev_day: "‹ Day",
    guide_next_day: "Day ›", guide_yesterday: "Yesterday", guide_day_before: "2 days ago", today: "Today", date: "Date", time: "Time",
    guide_pan_hint: "◀ ▶ — shift hours",
    back: "Back", live: "LIVE", catchup: "CATCH-UP", archive: "Archive",
    loading: "Loading…", all: "All", favorites: "★ Favorites", recent: "Recently watched",
    group_order: "⇅ Group order", group_order_done: "✓ Done", order_reset: "Alphabetical",
    order_hint: "Move groups with the ▲ / ▼ buttons, then choose “Done”.",
    other: "Other", channel: "Channel", program: "Program",
    connecting_xtream: "Connecting to Xtream panel…", loading_playlist: "Loading playlist…",
    loading_epg: "Loading EPG…", parsing_epg: "Parsing EPG…",
    channels_count: "channels", epg_programs: "programs", epg_no_data: "no data",
    no_epg: "No EPG info", next: "Next", error: "Error:", hourly_recording: "Hourly recording",
    archive_title: "Archive • ", days_back: " days back", archive_catchup: "Archive / catch-up",
    err_http: "Server returned HTTP {code}", err_http_access: "Server returned HTTP {code} (access denied).",
    err_network: "Cannot fetch data (network / CORS).", err_timeout: "Connection timed out.",
    err_xtream_auth: "Xtream: invalid server address, username or password.",
    err_xtream_inactive: "Xtream: account inactive ({status}). Check the expiry date.",
    err_xtream_no_channels: "Xtream returned no live channels for this account.",
    err_xtream_json: "Xtream panel returned an invalid response (expected JSON).",
    err_not_m3u: "This is not an M3U playlist.", err_no_channels: "Playlist contains no channels.",
    err_epg_xml: "EPG is not valid XMLTV.", err_gzip: "Missing GZIP decompression library.",
    err_playback: "Failed to start playback.",
    err_stream: "Stream playback error. The format or server may not be supported by this TV model.",
    err_catchup: "No supported catch-up template for this channel.",
    err_read_file: "Failed to read file.", err_read_m3u: "Failed to read M3U file.",
    err_read_epg: "Failed to read EPG file.", err_gunzip: "Failed to decompress EPG file: {msg}",
    err_worker: "Failed to start EPG parser.",
    err_xtream_required: "Xtream: enter server address, username and password.",
    err_m3u_file_required: "Choose a local M3U file.",
    err_m3u_url_required: "Enter a full http:// or https:// M3U playlist URL.",
    err_epg_url: "EPG URL must start with http:// or https://",
    err_storage: "Data is too large to store in app memory (M3U/EPG file too big).",
    err_delete_confirm: "Delete this profile (playlist, Xtream login and EPG)?",
    retry_msg: "Retrying attempt {n} of {total}…", retry_fail: "Failed to start the channel after {total} attempts.",
    retry_off: "Automatic retry is disabled.", back_hint: "Press Back to choose another channel.",
    retry_alt_hls: "Channel failed as TS — trying HLS (m3u8)…",
    media_code: "code {code}", media_aborted: "aborted", media_network: "network / server error",
    media_decode: "decoding error", media_unsupported: "unsupported format", media_url: "URL",

    /* ---------- 1.18.0 ---------- */
    ui_mode: "Interface mode",
    ui_mode_auto: "Automatic (TV / phone)",
    ui_mode_tv: "TV (remote, 10-foot)",
    ui_mode_touch: "Touch (phone / tablet)",
    ui_scale: "Interface size",
    ui_scale_auto: "Automatic (by screen resolution)",
    ui_scale_100: "100%",
    ui_scale_115: "115% — larger text",
    ui_scale_130: "130% — large text",
    ui_scale_150: "150% — largest",
    screen_info: "Detected screen: {width}×{height} px, density {dpr}× — layout {canvas} px, scale {scale}% ({source}).",
    scale_source_auto: "automatic",
    scale_source_manual: "set by hand",
    osd_enabled: "Mini-EPG on channel (what's on now)",
    platform_line: "Detected: {name} • interface: {mode}",
    platform_firetv: "Fire TV", platform_androidtv: "Android TV", platform_webos: "webOS",
    platform_android: "Android", platform_ios: "iOS", platform_browser: "desktop / browser",
    mode_tv: "TV (remote)", mode_touch: "touch",
    tv_hint: "OK – watch • MENU / long OK – options • ◀ ▲ ▼ ▶ – navigate • Guide: ◀ ▶ – hours • in a channel: ▲ ▼ channel, ◀ ▶ seek",
    osd_restart: "⏪ From start",
    osd_prev_program: "◀ Previous",
    osd_next_program: "Next ▶",
    osd_live: "⏵ Live",
    osd_back: "✕ Back",
    osd_pause: "⏸ Pause",
    osd_play: "⏵ Resume",
    osd_hint_live: "OK – info bar • ⏵‖ – pause/resume • ▲ ▼ – channel • ◀ ▶ – back / forward • EPG – channel guide • MENU – options • Back – exit",
    osd_hint_archive: "OK – info bar • ⏵‖ – pause/resume • ▲ ▼ – channel • ◀ ▶ – seek • EPG – channel guide • Back – exit",
    osd_now: "Now:",
    osd_next_label: "Next:",
    osd_paused: "PAUSED",
    osd_epg: "📅 EPG",
    osd_mute: "🔇 Mute",
    osd_unmute: "🔊 Sound",
    osd_muted: "MUTED",
    ctx_menu: "Channel",
    ctx_play: "⏵ Watch",
    ctx_fav_add: "☆ Add to favourites",
    ctx_fav_del: "★ Remove from favourites",
    ctx_archive: "⏪ Archive / catch-up",
    ctx_epg: "📅 TV guide (EPG)",
    ctx_close: "✕ Close",
    epg_parsing_progress: "EPG… {pct}%",
    epg_filtered: "EPG for {shown} channels",
    err_player_lib: "Failed to load the player ({name}).",
    err_no_mse: "This player does not support TS streams (no MSE).",
    retry_engine_mse: "Trying the TS player (MSE)…",
    retry_engine_hls: "Trying the HLS player…",
    engine_mse: "TS/MSE", engine_hls: "HLS",
    engine_native: "native",
    epg_none: "No EPG data for this channel.",
    archive_day_today: "Today", archive_day_yesterday: "Yesterday", archive_day_before: "2 days ago",
    archive_limited: "showing {shown} of {total}",
    guide_limited: "showing {shown} of {total} channels (narrow the category)",
    osd_buffering: "Loading stream…",
    seek_back: "Back {s} s",
    seek_forward: "Forward +{s} s",
    engine_line: "Engine: {name}",

    /* ---------- 1.19.0 ---------- */
    updates: "UPDATES",
    updates_hint: "Nothing installs itself: when you open the settings the app only says a newer version exists and briefly lists what changed. The update starts with the “Download & install” button.",
    update_check: "Check for updates",
    update_install: "Download & install",
    update_checking: "Checking the latest release…",
    update_current: "You have the latest version (v{version}).",
    update_available: "New version {latest} is available — you have {current}.",
    update_changes: "What's new in {latest}:",
    update_asset: "Package: {name} ({size})",
    update_manual: "webOS does not install packages on its own — download the .{ext} on a computer and push it with developer mode (ares-install). Address: {url}",
    update_downloading: "Downloading the package… {pct}%",
    update_permission: "Allow OpenIPTV to install apps from unknown sources, then press “Download & install” again.",
    update_installer: "Package downloaded — confirm the update in the installer on screen.",
    update_err: "Update failed: {msg}",
    update_err_data: "GitHub returned no release information.",
    update_err_404: "GitHub cannot see this app's releases (HTTP 404). The in-app update check works only when the repository and its releases are public.",
    update_err_json: "GitHub returned an invalid response (expected JSON).",
    update_notice: "New version {latest} (you have {current}) — Settings → Updates.",
    update_err_unknown: "unknown error",

    /* ---------- 1.21.0 ---------- */
    exit_title: "Quit the app?",
    exit_hint: "Close OpenIPTV or stay on the channel list.",
    exit_confirm: "⏻ Quit the app",
    exit_cancel: "✕ Stay",
    exit_manual: "This platform does not let the app close its own window — use the exit button on the remote.",

    /* ---------- 1.21.0 — remote manual in the settings (“REMOTE IN THE PLAYER”) ---------- */
    player_keys: "REMOTE IN THE PLAYER",
    player_keys_hint: "This is how the remote works while a channel or a recording plays. The “◀ ▶ seek” option affects the arrow keys only — ⏪ ⏩ always seek. On a touch screen the same actions sit on the bar at the bottom of the picture.",
    key_ok_short: "The bar with the channel name, current programme and progress: show or hide.",
    key_ok_hold: "Hold for about a second: the channel options menu (favourites, archive, TV guide, restart, mute).",
    key_menu: "The same channel options menu, without holding OK.",
    key_updown: "Next and previous channel on the visible list (like CH+ / CH−), wrapping around at both ends. One press is one change.",
    key_leftright: "Seeking by the “archive seek step” setting: on a recording it jumps back and forward, on a live channel ◀ enters catch-up and ▶ resumes the paused picture.",
    key_rewff: "The remote's own seek keys always work, even with the arrows switched off; ⏩ at the end of a programme goes back live.",
    key_playpause: "Pause and resume. After a longer pause a live channel returns to the moment you stopped it through catch-up; without archive the picture simply rejoins the stream.",
    key_stop: "Freeze the picture — the same as pause.",
    key_mute: "Mutes the player; the TV volume is left untouched.",
    key_back: "Back",
    key_back_desc: "Closes the menu or the bar; from the player it goes back to the channel list, and from the list it asks “Quit the app?”.",

    /* ---------- 1.21.4 — settings tabs and the channel guide in the player ---------- */
    tab_general: "General",
    tab_update: "Update",
    tab_help: "Manual",
    tabs_hint: "Settings tabs: ◀ ▶ switch the tab, ▼ enters the content.",
    help_title: "HOW TO USE THE APP",
    help_intro: "A guide in three steps: the channel source, moving around with the remote, and the player with archive.",
    help_setup: "1. CHANNEL SOURCE",
    help_setup_text: "The playlist goes in the “General” tab: an M3U address, a file from the device, or Xtream credentials. After saving, channels, EPG and archive load on their own.",
    help_nav: "2. MOVING AROUND",
    help_nav_move: "The arrow keys walk through buttons, categories and the channel list — the highlight is always visible.",
    help_nav_ok: "Picks the highlighted item: a category, a channel or a button.",
    help_nav_menu: "Channel options menu without holding OK — the same as holding OK on a channel card.",
    help_nav_search: "The search box. Leave it with the arrows: ▼ to the channel list, ◀ at the start of the text to the categories, ▶ at the end to the top bar.",
    help_nav_back: "Closes an overlay or goes one screen back. On the channel list it asks whether to quit the app.",
    help_epg: "TV GUIDE (EPG)",
    help_epg_grid: "The “EPG” button in the header opens a grid of all channels on a time axis. The programme on air carries a LIVE tag and the vertical line marks the current time.",
    help_epg_pan: "Shifts the time axis by an hour — as far back or forward as you like.",
    help_epg_days: "Jumps a day back or forward; the date and time fields next to it jump to an exact moment.",
    help_epg_pick: "A finished programme plays from the archive, the one on air goes live.",
    help_catchup: "ARCHIVE AND CATCH-UP",
    help_catchup_list: "The “EPG” button on the player bar opens the programme list of the channel you watch: previous, current and next. Pick one and press OK to play it from the archive.",
    help_catchup_live: "The “Live” button (on the player bar or above the programme list) returns to the current moment.",
    help_catchup_days: "How many days back the archive goes is set by “EPG/archive days back” in the “General” tab, and the jump size by “Archive seek step”.",
    help_catchup_note: "A channel without archive shows a message instead of the picture, and a channel without EPG gets hourly recordings — so the archive stays useful.",
    help_touch: "PHONE AND TABLET",
    help_touch_bar: "The same actions sit on the bar at the bottom of the picture — just tap. Only here, without a remote, the bar also carries “Channel” (options menu) and “Back”, and wraps into a few rows.",
    help_touch_back: "Leaving the picture: the “Back” button on the bar or the system back button on the phone.",
    help_update: "UPDATES",
    help_update_text: "Updates live in their own “Update” tab: nothing installs itself, and only the button downloads the package.",
    epg_list_title: "Guide • {name}",
    epg_list_hint: "previous • now • next",
    epg_list_days: " • {days} days back",
    epg_list_future: "not aired yet"
  };

  var I18N = { pl: I18N_PL, en: I18N_EN };

  function t(key, params) {
    var lang = settings.language === "en" ? "en" : "pl";
    var s = (I18N[lang] && I18N[lang][key]) || (I18N.pl && I18N.pl[key]) || key;
    if (params) {
      for (var p in params) s = s.split("{" + p + "}").join(String(params[p]));
    }
    return s;
  }

  /* =====================  IKONY WEKTOROWE PRZYCISKÓW  =====================
     Ikony rysujemy jako SVG, a nie znakami emoji: na dekoderach telewizyjnych
     (Fire TV, webOS) czcionka emoji bywa okrojona i z „📅 Program TV” zostaje
     kropka — a przyciski bez napisu (zębatka, odświeżanie) na telewizorze
     dodatkowo dostawały padding reguły ogólnej i ich SVG był ściśnięty do
     kreski (patrz styles.css: body.uimode-tv .icon-button).

     Napisy w słownikach nadal mają emoji na początku — jest z nich czytelny
     kod i instrukcja — więc przy wstawianiu na przycisk odcinamy ten znak
     (labelWithoutIcon) i zamiast niego wstawiamy ikonę. Kolejność: znak przed
     napisem („✕ Wstecz”) albo po nim („Następny ▶”). */

  var ICON_PATHS = {
    calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10.5h18"/>',
    play: '<polygon fill="currentColor" points="7 5 19 12 7 19"/>',
    pause: '<rect fill="currentColor" x="6.5" y="5" width="4" height="14" rx="1"/><rect fill="currentColor" x="13.5" y="5" width="4" height="14" rx="1"/>',
    stop: '<rect fill="currentColor" x="6" y="6" width="12" height="12" rx="2"/>',
    rewind: '<polygon fill="currentColor" points="13 12 21 6.5 21 17.5"/><polygon fill="currentColor" points="3 12 11 6.5 11 17.5"/>',
    forward: '<polygon fill="currentColor" points="11 12 3 6.5 3 17.5"/><polygon fill="currentColor" points="21 12 13 6.5 13 17.5"/>',
    prev: '<path d="M15 18l-6-6 6-6"/>',
    next: '<path d="M9 18l6-6-6-6"/>',
    star: '<polygon points="12 2.8 14.9 8.7 21.4 9.6 16.7 14.2 17.8 20.6 12 17.6 6.2 20.6 7.3 14.2 2.6 9.6 9.1 8.7"/>',
    "star-filled": '<polygon fill="currentColor" points="12 2.8 14.9 8.7 21.4 9.6 16.7 14.2 17.8 20.6 12 17.6 6.2 20.6 7.3 14.2 2.6 9.6 9.1 8.7"/>',
    mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19"/><path d="M22 9l-6 6M16 9l6 6"/>',
    volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a9 9 0 0 1 0 12"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><path d="M12 2.5v9"/>',
    swap: '<path d="M8 3v18M4 7l4-4 4 4M16 21V3M12 17l4 4 4-4"/>',
    check: '<path d="M20 6L9 17l-5-5"/>'
  };

  /* znak (albo para znaków) na brzegu napisu → nazwa ikony SVG */
  var ICON_BY_LEAD = {
    "⏵": "play", "⏸": "pause", "⏹": "stop", "⏪": "rewind", "⏩": "forward",
    "◀": "prev", "▶": "next", "★": "star-filled", "☆": "star",
    "📅": "calendar", "🔇": "mute", "🔊": "volume", "✕": "close",
    "⏻": "power", "⇅": "swap", "✓": "check"
  };

  /* emoji trzymają się parami znaków (📅 = D83D DCC5), dlatego próbujemy dwa
     znaki, a dopiero potem jeden — inaczej „Następny ▶” złapałoby złą ikonę */
  function iconEdge(text, fromEnd) {
    for (var i = 2; i > 0; i--) {
      var part = fromEnd ? text.slice(-i) : text.slice(0, i);
      if (ICON_BY_LEAD[part]) return { name: ICON_BY_LEAD[part], size: i, atEnd: !!fromEnd };
    }
    return null;
  }

  function iconForLabel(label) {
    var text = String(label === undefined || label === null ? "" : label);
    var head = iconEdge(text, false);
    if (head) return head.name;
    var tail = iconEdge(text, true);
    return tail ? tail.name : null;
  }

  /* ten sam napis, ale bez znaku ikony — na przycisku rysuje ją SVG */
  function labelWithoutIcon(label) {
    var text = String(label === undefined || label === null ? "" : label);
    var head = iconEdge(text, false);
    if (head) return text.slice(head.size).replace(/^\s+/, "");
    var tail = iconEdge(text, true);
    if (tail) return text.slice(0, -tail.size).replace(/\s+$/, "");
    return text;
  }

  function iconHtml(name) {
    var body = ICON_PATHS[name];
    if (!body) return "";
    return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true" focusable="false">' + body + "</svg>";
  }

  /* Napis przycisku razem z ikoną. Ikona jest SVG, więc nie zależy od czcionki
     emoji, a textContent nie może jej zjeść — dlatego wszystkie przyciski
     z ikoną przechodzą przez tę funkcję. Bez drugiego argumentu ikonę bierzemy
     ze znaku na brzegu napisu. */
  function setIconLabel(element, iconName, label) {
    if (!element) return "";
    if (arguments.length === 2) { label = iconName; iconName = iconForLabel(label); }
    var text = labelWithoutIcon(label);
    element.classList.add("has-icon");
    element.innerHTML = iconHtml(iconName);
    if (!iconName) element.classList.remove("has-icon");
    if (text) {
      var span = document.createElement("span");
      span.className = "icon-label";
      span.textContent = text;
      element.appendChild(span);
    }
    return text;
  }

  function applyTranslations() {
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) {
      var v = t(els[i].getAttribute("data-i18n"));
      if (v === undefined) continue;
      /* napisy ze znakiem ikony („⇅ Kolejność grup”) dostają SVG — ale tylko
         one: do <option> i innych kontenerów tekstowych nie wolno wstawiać
         elementów potomnych, a bez ikony textContent wystarcza */
      if (iconForLabel(v)) setIconLabel(els[i], v);
      else els[i].textContent = v;
    }
    var ph = document.querySelectorAll("[data-i18n-placeholder]");
    for (var j = 0; j < ph.length; j++) {
      ph[j].placeholder = t(ph[j].getAttribute("data-i18n-placeholder"));
    }
    var ti = document.querySelectorAll("[data-i18n-title]");
    for (var k = 0; k < ti.length; k++) {
      ti[k].title = t(ti[k].getAttribute("data-i18n-title"));
    }
    document.documentElement.lang = settings.language;
  }

  function applyTheme() {
    document.body.classList.toggle("light", settings.theme === "light");
  }

  /* ====================  TYP URZĄDZENIA I TRYBY INTERFEJSU  ====================
     Ten sam kod działa na Fire TV / Android TV (pilot), na webOS oraz na
     telefonach i tabletach. Interfejs ma dwa tryby:

       • „tv”    — 10 stóp: duże elementy, obszar bezpieczny pod overscan,
                   tani fokus (bez transformacji), menu pilota (MENU / długie OK),
       • „touch” — palec: kategorie jako poziome „chipsy”, lista na całą szerokość.

     Tryb wykrywamy automatycznie, ale można go wymusić w ustawieniach. */

  function isTabletSize() {
    var screenRef = window.screen || {};
    var smaller = Math.min(screenRef.width || 0, screenRef.height || 0);
    var dpr = window.devicePixelRatio || 1;
    return (smaller / dpr) >= 600;
  }

  function detectPlatform() {
    var ua = (navigator.userAgent || "").toLowerCase();
    var maxTouch = navigator.maxTouchPoints || 0;
    var touch = ("ontouchstart" in window) || maxTouch > 0;
    var native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var kind = "desktop";
    var os = "browser";
    var android = /android/.test(ua);

    if (/web0s|webos|netcast|smarttv|hbbtv|viera|bravia/.test(ua)) {
      os = "webos";
      kind = "tv";
    } else if (/firetv|fire tv|\baft[a-z0-9]{1,2}\b|kindle/.test(ua)) {
      os = "firetv";
      kind = "tv";
    } else if (android) {
      if (/android tv|\btv\b|bravia|shield|droidlogic|leanback|aft/.test(ua)) {
        os = "androidtv";
        kind = "tv";
      } else {
        os = "android";
        kind = touch ? (isTabletSize() ? "tablet" : "phone") : "desktop";
      }
    } else if (/iphone|ipod/.test(ua)) {
      os = "ios";
      kind = "phone";
    } else if (/ipad/.test(ua) || (/macintosh/.test(ua) && maxTouch > 1)) {
      os = "ios";
      kind = "tablet";
    }
    return { kind: kind, os: os, touch: touch, native: native, tv: kind === "tv", android: android };
  }

  var platformInfo = detectPlatform();

  /* tryb z ustawień albo automatyczny: TV → „tv”, telefon/tablet → „touch”,
     komputer → „tv” (mysz i klawiatura obsługują ten sam układ bez przeszkód) */
  function uiMode() {
    var forced = settings.uiMode;
    if (forced === "tv" || forced === "touch") return forced;
    if (platformInfo.tv) return "tv";
    if (platformInfo.kind === "phone" || platformInfo.kind === "tablet") return "touch";
    return "tv";
  }

  function isTvMode() {
    return uiMode() === "tv";
  }

  function platformName() {
    return t("platform_" + (platformInfo.os || "browser"));
  }

  function applyUiMode() {
    var mode = uiMode();
    document.body.classList.toggle("uimode-tv", mode === "tv");
    document.body.classList.toggle("uimode-touch", mode === "touch");
    document.body.classList.toggle("platform-firetv", platformInfo.os === "firetv");
    document.body.setAttribute("data-uimode", mode);
    document.body.setAttribute("data-platform", platformInfo.os);
    var hint = $("tvHint");
    if (hint) hint.textContent = t("tv_hint");
    var info = $("platformInfo");
    if (info) {
      info.textContent = t("platform_line", {
        name: platformName(),
        mode: t(mode === "tv" ? "mode_tv" : "mode_touch")
      });
    }
    applyUiScale();
  }

  /* ---------- rozmiar interfejsu: rozdzielczość ekranu → skala układu ----------
     Cała matematyka jest w www/ui-scale.js — ten sam kod ustawia szerokość
     układu zaraz po wczytaniu index.html, więc interfejs nie pojawia się
     najpierw w złym rozmiarze. Tutaj: ustawienie z formularza, informacja
     o wykrytym ekranie i przeliczenie skali, gdy telewizor zmieni rozdzielczość
     już w trakcie pracy (np. 720p → 1080p przy materiale 4K). */
  function scaleApi() {
    return window.OpenIPTVScale || null;
  }

  function scaleContext() {
    var api = scaleApi();
    if (api) return api.context(window);
    return { tv: isTvMode(), mobile: false, native: false, viewport: false };
  }

  /* wartość z <select id="uiScale">: „auto” albo jedna z gotowych skal */
  function normalizeUiScale(value) {
    var api = scaleApi();
    return api && api.isFactor(value) ? String(value) : "auto";
  }

  function uiScaleFactor(ctx) {
    var api = scaleApi();
    if (!api) return 1;
    return api.factor(settings.uiScale, api.metrics(window), ctx || scaleContext());
  }

  function applyUiScale() {
    var info = $("screenInfo");
    var api = scaleApi();
    if (!api) {
      if (info) info.textContent = "";
      return;
    }
    var ctx = scaleContext();
    var factor = uiScaleFactor(ctx);
    api.applyToPage(document, factor, ctx);
    document.body.setAttribute("data-uiscale", String(Math.round(factor * 100)));
    if (info) {
      var m = api.metrics(window);
      info.textContent = t("screen_info", {
        width: m.physW,
        height: m.physH,
        dpr: m.dpr.toFixed(1),
        canvas: api.canvasWidth(factor, ctx) || m.viewW,
        scale: Math.round(factor * 100),
        source: t(settings.uiScale === "auto" ? "scale_source_auto" : "scale_source_manual")
      });
    }
    watchScreen();
  }

  var screenWatchTimer = null;
  var screenWatchPhys = 0;

  /* Ekran telewizora potrafi zmienić rozdzielczość już w trakcie pracy, a wtedy
     sama zmienia się skala „automatyczna”. Sprawdzamy to co dwie sekundy, ale
     przy skali wybranej ręcznie nie robimy nic. */
  function watchScreen() {
    var api = scaleApi();
    if (!api || settings.uiScale !== "auto" || !isTvMode()) {
      if (screenWatchTimer) {
        window.clearInterval(screenWatchTimer);
        screenWatchTimer = null;
      }
      return;
    }
    screenWatchPhys = api.metrics(window).physH;
    if (screenWatchTimer) return;
    screenWatchTimer = window.setInterval(function () {
      var phys = scaleApi().metrics(window).physH;
      if (phys === screenWatchPhys) return;
      screenWatchPhys = phys;
      applyUiScale();
    }, 2000);
  }

  /* robocza kopia edytowanego profilu (pliki wybrane z dysku) */
  var draft = {
    editingId: "",
    playlistText: "",
    playlistName: "",
    epgText: "",
    epgName: ""
  };

  var suppressProfileSelect = false;
  var suppressProfileSwitcher = false;

  /* ============================  POMOCNICZE  ============================ */

  function $(id) {
    return document.getElementById(id);
  }

  function loadSettings() {
    var stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
    } catch (e) {
      stored = {};
    }
    var schema = parseInt(stored.schemaVersion, 10) || 0;
    for (var key in DEFAULTS) {
      if (typeof stored[key] === "undefined") stored[key] = DEFAULTS[key];
    }
    /* migracja 1.16.0: istniejące instalacje dostają nowe domyślne
       (catch-up włączony, krok przewijania 10 s) — jednorazowo */
    if (schema < 2) {
      stored.catchupAll = true;
      stored.seekSeconds = 10;
    }
    /* migracja 1.17.0: usunięte ustawienie „Proxy CORS" — czyścimy zapisany klucz */
    if (schema < 3) {
      delete stored.corsProxy;
    }
    /* migracja 1.18.0: wielkie teksty (playlista/EPG wczytane z pliku) idą do
       osobnego klucza — w głównym zostają tylko lekkie ustawienia */
    var blobs = {};
    try { blobs = JSON.parse(localStorage.getItem(BLOBS_KEY) || "{}") || {}; } catch (e2) { blobs = {}; }
    var profiles = Array.isArray(stored.profiles) ? stored.profiles : [];
    for (var pi = 0; pi < profiles.length; pi++) {
      var prof = profiles[pi];
      if (!prof || !prof.id) continue;
      var bucket = blobs[prof.id] || (blobs[prof.id] = {});
      if (prof[BLOB_FIELDS[0]]) bucket.playlistFileText = prof.playlistFileText;
      if (prof[BLOB_FIELDS[1]]) bucket.epgFileText = prof.epgFileText;
      if (prof[BLOB_FIELDS[2]]) bucket.playlistFileName = prof.playlistFileName;
      if (prof[BLOB_FIELDS[3]]) bucket.epgFileName = prof.epgFileName;
      /* w pamięci zostawiamy teksty (korzysta z nich wczytywanie katalogu),
         ale do głównego klucza już ich nie zapisujemy */
      prof.playlistFileText = bucket.playlistFileText || "";
      prof.playlistFileName = bucket.playlistFileName || "";
      prof.epgFileText = bucket.epgFileText || "";
      prof.epgFileName = bucket.epgFileName || "";
    }
    stored.__blobs = blobs;

    if (schema < SCHEMA_VERSION) {
      stored.schemaVersion = SCHEMA_VERSION;
      try { localStorage.setItem(BLOBS_KEY, JSON.stringify(blobs)); } catch (err) {}
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(compactSettings(stored))); } catch (err2) {}
    }
    return stored;
  }

  /* kopia ustawień bez wielkich tekstów — to trafia do localStorage */
  function compactSettings(source) {
    var src = source || settings;
    var out = {};
    for (var key in src) {
      if (key === "__blobs" || key === "profiles") continue;
      out[key] = src[key];
    }
    out.profiles = (src.profiles || []).map(function (p) {
      var copy = {};
      for (var field in p) {
        if (BLOB_FIELDS.indexOf(field) >= 0) continue;
        copy[field] = p[field];
      }
      return copy;
    });
    return out;
  }

  /* Zapis „na gorąco” (ulubione, kolejność grup, ostatnio oglądane): odroczony
     o 400 ms i bez wielkich tekstów, więc interfejs się nie zacina. */
  function saveSettings() {
    if (settingsWriteTimer) return;
    settingsWriteTimer = window.setTimeout(flushSettings, 400);
  }

  function flushSettings() {
    if (settingsWriteTimer) {
      window.clearTimeout(settingsWriteTimer);
      settingsWriteTimer = null;
    }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(compactSettings()));
    } catch (e) {
      /* brak miejsca w pamięci urządzenia */
    }
  }

  /* Pełny zapis: profil wraz z plikami (playlista/EPG) — używany przez formularz
     ustawień i przy usuwaniu profilu. */
  function saveSettingsFull() {
    flushSettings();
    try {
      localStorage.setItem(BLOBS_KEY, JSON.stringify(settings.__blobs || {}));
    } catch (e) {
      /* brak miejsca w pamięci urządzenia */
    }
  }

  function newProfileId() {
    return "profile-" + Date.now() + "-" + Math.floor(1000000 * Math.random());
  }

  function normalizeProfile(p) {
    if (p.sourceType !== "xtream" && p.sourceType !== "m3u-file" && p.sourceType !== "m3u-url") {
      p.sourceType = "m3u-url";
    }
    p.playlistUrl = p.playlistUrl || "";
    p.playlistFileText = p.playlistFileText || "";
    p.playlistFileName = p.playlistFileName || "";
    p.xtreamServer = p.xtreamServer || "";
    p.xtreamUser = p.xtreamUser || "";
    p.xtreamPass = p.xtreamPass || "";
    p.epgUrl = p.epgUrl || "";
    p.epgFileText = p.epgFileText || "";
    p.epgFileName = p.epgFileName || "";
    if (!p.name) p.name = "Playlista";
    if (!p.id) p.id = newProfileId();
    return p;
  }

  function keyOf(channel) {
    return channel.tvgId || channel.streamUrl.split("|")[0];
  }

  function perProfile(bucket) {
    if (!bucket[settings.activeProfileId]) bucket[settings.activeProfileId] = [];
    return bucket[settings.activeProfileId];
  }

  function isFavorite(channel) {
    return perProfile(settings.favorites).indexOf(keyOf(channel)) >= 0;
  }

  function activeProfile() {
    for (var i = 0; i < settings.profiles.length; i++) {
      if (settings.profiles[i].id === settings.activeProfileId) return settings.profiles[i];
    }
    if (settings.profiles.length) {
      settings.activeProfileId = settings.profiles[0].id;
      return settings.profiles[0];
    }
    return null;
  }

  /* lista „Ostatnio oglądane” zmienia się w trakcie oglądania — odświeżamy ją
     w momencie powrotu do listy kanałów */
  function refreshRecentGroup() {
    if (!state.recentDirty) return;
    state.recentDirty = false;
    if (state.selectedGroup !== "@recent" || !state.channels.length) return;
    selectGroup("@recent", document.querySelector(".category.active"));
  }

  /* Android TV / Fire TV: natywny odbiornik musi wiedzieć, że na ekranie jest
     odtwarzacz — tylko wtedy oddaje stronie klawisze multimedialne pilota
     ⏵‖ / ⏹ (MainActivity.onKeyDown -> window.__openiptvKey). Bez mostu
     (webOS, przeglądarka, stary APK) nic się nie dzieje. */
  function notifyNativePlayer(on) {
    var bridge = window.OpenIptvNative;
    if (!bridge || !bridge.setPlayerMode) return;
    try {
      bridge.setPlayerMode(!!on);
    } catch (error) { /* starszy APK bez tego mostu */ }
  }

  function showScreen(id) {
    if (id === "browserScreen") refreshRecentGroup();
    for (var i = 0; i < SCREENS.length; i++) {
      $(SCREENS[i]).classList.toggle("hidden", SCREENS[i] !== id);
    }
    notifyNativePlayer(id === "playerScreen");
    /* zegar linii bieżącej godziny chodzi tylko na widocznym programie TV */
    if (id !== "guideScreen") stopGuideNowLine();
    window.setTimeout(function () {
      /* fokus wchodzi na przycisk, nigdy na pole tekstowe: na telewizorze
         klawiatura ekranowa zasłaniałaby listę, a po zapisaniu ustawień samo
         włączało się szukanie kanałów (patrz entryFocusTarget) */
      var first = entryFocusTarget($(id));
      if (first && first.focus) first.focus();
    }, 30);
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /* =======================  USTAWIENIA (FORMULARZ)  ======================= */

  /* ==========================  ZAKŁADKI USTAWIEŃ  ==========================
     Trzy zakładki trzymają porządek: „Ogólne” (sama aplikacja — profil,
     źródła, EPG, odtwarzanie, wygląd i język), „Aktualizacja” (tylko wydania
     i instalacja paczki) oraz „Instrukcja” (poradnik obsługi pilota). Pasek
     zakładek jest nad treścią, a pilot zmienia zakładkę strzałkami ◀ ▶
     (obsługa klawiszy w sekcji OBSŁUGA PILOTA) i wchodzi w treść klawiszem ▼. */

  var SETTINGS_TABS = ["general", "update", "help"];
  var settingsTab = "general";

  function settingsTabName(name) {
    return SETTINGS_TABS.indexOf(name) < 0 ? "general" : name;
  }

  function settingsTabId(name) {
    return "settingsTab" + name.charAt(0).toUpperCase() + name.slice(1);
  }

  function settingsPanelId(name) {
    return "settingsPanel" + name.charAt(0).toUpperCase() + name.slice(1);
  }

  function showSettingsTab(name) {
    settingsTab = settingsTabName(name);
    for (var i = 0; i < SETTINGS_TABS.length; i++) {
      var key = SETTINGS_TABS[i];
      var on = key === settingsTab;
      var tab = $(settingsTabId(key));
      var panel = $(settingsPanelId(key));
      if (tab) {
        tab.classList.toggle("active", on);
        tab.setAttribute("aria-selected", on ? "true" : "false");
      }
      if (panel) panel.classList.toggle("hidden", !on);
    }
  }

  /* ◀ ▶ na pasku zakładek: sąsiednia zakładka (z zawijaniem na końcach) */
  function stepSettingsTab(direction) {
    var index = SETTINGS_TABS.indexOf(settingsTab);
    if (index < 0) index = 0;
    var next = SETTINGS_TABS[(index + direction + SETTINGS_TABS.length) % SETTINGS_TABS.length];
    showSettingsTab(next);
    var tab = $(settingsTabId(next));
    if (tab && tab.focus) tab.focus();
  }

  /* ▼ z paska zakładek: fokus wchodzi w treść widocznej zakładki. Zakładka
     „Instrukcja” jest samym tekstem, więc gdy nie ma w niej czego sfokusować,
     fokus idzie po prostu niżej (do „Zapisz i pobierz” / „Wstecz”) — inaczej
     z paska nie dałoby się zjechać w dół. */
  function focusSettingsPanel() {
    var target = entryFocusTarget($(settingsPanelId(settingsTab)));
    if (target && target.focus) {
      target.focus();
      return;
    }
    focusNearest(40);
  }

  /* fokus na zakładce, w której użytkownik był ostatnio */
  function focusSettingsTabs() {
    var tab = $(settingsTabId(settingsTab));
    if (tab && tab.focus) tab.focus();
  }

  function bindSettingsTabs() {
    for (var i = 0; i < SETTINGS_TABS.length; i++) {
      var name = SETTINGS_TABS[i];
      var tab = $(settingsTabId(name));
      if (tab) tab.onclick = (function (chosen) {
        return function () { showSettingsTab(chosen); };
      })(name);
    }
  }

  function openSettings() {
    $("archiveDays").value = String(settings.archiveDays);
    $("seekSeconds").value = String(settings.seekSeconds);
    $("retryAttempts").value = String(settings.retryAttempts);
    $("dpadSeek").checked = !!settings.dpadSeek;
    $("catchupTemplate").value = settings.catchupTemplate;
    $("catchupAll").checked = !!settings.catchupAll;
    $("epgRefreshMinutes").value = String(settings.epgRefreshMinutes);
    $("epgReloadOnStart").checked = !!settings.epgReloadOnStart;
    $("language").value = settings.language === "en" ? "en" : "pl";
    $("theme").value = settings.theme === "light" ? "light" : "dark";
    $("uiMode").value = settings.uiMode === "tv" || settings.uiMode === "touch" ? settings.uiMode : "auto";
    $("uiScale").value = normalizeUiScale(settings.uiScale);
    $("osdEnabled").checked = settings.osdEnabled !== false;
    $("settingsError").textContent = "";
    resetUpdateStatus();
    /* „Wstecz” w ustawieniach wychodzi bez zapisu — przy pierwszym uruchomieniu
       (brak playlisty) nie ma dokąd wrócić, więc przycisk jest ukryty */
    var backButton = $("settingsBack");
    if (backButton) backButton.classList.toggle("hidden", !state.channels.length);
    /* ciche sprawdzenie: pokaże tylko informację o nowszej wersji i krótko,
       co się zmieniło — żadnego pobierania ani instalacji bez naciśnięcia przycisku */
    checkForUpdates(true);
    applyUiMode();
    refreshProfileSelect();
    loadProfileIntoForm(activeProfile());
    /* otwieramy tę zakładkę, w której użytkownik był ostatnio */
    showSettingsTab(settingsTab);
    showScreen("settingsScreen");
    /* fokus na widocznej zakładce — showScreen() stawia go na pierwszym
       przycisku karty, a to nie zawsze jest zakładka otwarta */
    window.setTimeout(focusSettingsTabs, 60);
  }

  function refreshProfileSelect() {
    var select = $("settingsProfile");
    suppressProfileSelect = true;
    select.textContent = "";
    settings.profiles.forEach(function (p) {
      var option = document.createElement("option");
      option.value = p.id;
      option.textContent = p.name;
      select.appendChild(option);
    });
    select.value = settings.activeProfileId;
    suppressProfileSelect = false;
  }

  /* ---------- pola z listą wyboru widoczne w całości ---------------------- */
  /* Rozwinięte menu systemowe (<select>) na dekoderach TV bywa ciemne na
     ciemnym i nie widać, która pozycja jest podświetlona. Pole, na którym wybór
     ma być jednoznaczny („Typ źródła”), rysujemy więc jako rząd przycisków:
     wszystkie pozycje widać naraz, a wybrana jest w kolorze akcentu. Ukryty
     <select> zostaje w formularzu jako miejsce, z którego wartość czytają
     pozostałe funkcje (`$("sourceType").value`), więc zmienia się tylko wygląd.
     Znacznik w index.html: <div class="choice-row" data-choice-for="sourceType">. */

  /* zdarzenie „change” takie, jak z prawdziwej listy: kod podłączony do
     <select> (pokazywanie pól Xtream, skok do pola adresu) działa bez zmian */
  function fireChange(element) {
    var event;
    try {
      event = new Event("change", { bubbles: true });
    } catch (error) {
      event = document.createEvent("HTMLEvents");
      event.initEvent("change", true, false);
    }
    element.dispatchEvent(event);
  }

  function syncChoiceRow(row) {
    var select = $(row.getAttribute("data-choice-for"));
    if (!select) return;
    var buttons = row.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute("data-value") === select.value;
      buttons[i].setAttribute("aria-checked", on ? "true" : "false");
    }
  }

  function syncChoiceRows() {
    var rows = document.querySelectorAll("[data-choice-for]");
    for (var i = 0; i < rows.length; i++) syncChoiceRow(rows[i]);
  }

  function pickChoice(button) {
    var row = button.parentNode;
    var select = $(row.getAttribute("data-choice-for"));
    if (!select) return;
    var chosen = button.getAttribute("data-value");
    var changed = select.value !== chosen;
    if (changed) select.value = chosen;
    syncChoiceRow(row);
    if (changed) fireChange(select);
  }

  function buildChoiceRow(row) {
    var select = $(row.getAttribute("data-choice-for"));
    if (!select || !select.options) return;
    row.textContent = "";
    for (var i = 0; i < select.options.length; i++) {
      var option = select.options[i];
      var button = document.createElement("button");
      button.type = "button";
      button.className = "choice";
      button.tabIndex = 0;
      button.setAttribute("role", "radio");
      button.setAttribute("data-value", option.value);
      /* napis pozycji przechodzi przez tłumaczenia tak samo jak <option> */
      var key = option.getAttribute("data-i18n");
      if (key) button.setAttribute("data-i18n", key);
      button.textContent = option.textContent;
      button.onclick = function () { pickChoice(this); };
      row.appendChild(button);
    }
    syncChoiceRow(row);
  }

  function buildChoiceRows() {
    var rows = document.querySelectorAll("[data-choice-for]");
    for (var i = 0; i < rows.length; i++) buildChoiceRow(rows[i]);
  }

  function loadProfileIntoForm(profile) {
    draft.editingId = profile ? profile.id : newProfileId();
    draft.playlistText = (profile && profile.playlistFileText) || "";
    draft.playlistName = (profile && profile.playlistFileName) || "";
    draft.epgText = (profile && profile.epgFileText) || "";
    draft.epgName = (profile && profile.epgFileName) || "";

    $("profileName").value = profile ? profile.name : "Nowa playlista";
    $("sourceType").value = profile ? profile.sourceType : "m3u-url";
    $("playlistUrl").value = (profile && profile.playlistUrl) || "";
    $("xtreamServer").value = (profile && profile.xtreamServer) || "";
    $("xtreamUser").value = (profile && profile.xtreamUser) || "";
    $("xtreamPass").value = (profile && profile.xtreamPass) || "";
    $("epgUrl").value = (profile && profile.epgUrl) || "";

    updateSourceSections();
    /* lista wyboru pokazuje wartość wczytaną z profilu */
    syncChoiceRows();
    updatePlaylistPicker();
    updateEpgPicker();
  }

  function updateSourceSections() {
    var type = $("sourceType").value;
    $("m3uUrlSection").classList.toggle("hidden", type !== "m3u-url");
    $("m3uFileSection").classList.toggle("hidden", type !== "m3u-file");
    $("xtreamSection").classList.toggle("hidden", type !== "xtream");
  }

  function updatePlaylistPicker() {
    var hasFile = !!draft.playlistText;
    $("selectedPlaylistFile").textContent = hasFile
      ? t("active_file", { name: draft.playlistName || "playlist.m3u" })
      : t("add_local_file");
  }

  function updateEpgPicker() {
    var hasFile = !!draft.epgText;
    $("epgUrl").disabled = hasFile;
    $("useEpgLink").classList.toggle("hidden", !hasFile);
    $("selectedEpgFile").textContent = hasFile
      ? t("active_file", { name: draft.epgName || "epg.xml" })
      : t("add_local_epg");
  }

  function readFile(file, asBinary) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("Nie udało się odczytać pliku."));
      };
      if (asBinary) reader.readAsArrayBuffer(file);
      else reader.readAsText(file, "UTF-8");
    });
  }

  /* --------------- wybór pliku M3U / EPG bez okna systemowego ----------------
     W przeglądarce i na telefonie plik wybiera systemowe okno (ukryte pole
     <input type="file"> pod przyciskiem). Na telewizorze — typowy Fire TV — takiego
     okna często nie ma w ogóle i przycisk „Wybierz plik” tylko milczy. Wybór
     przejmuje wtedy natywny plugin OpenIptvFiles (paczka Android): pokazuje
     własną listę katalogów pamięci i karty USB, kopiuje plik do pamięci aplikacji
     i oddaje tu jego ścieżkę. Plik czytamy przez lokalny serwer Capacitora. */

  function nativeFilePicker() {
    var C = (typeof window !== "undefined") ? window.Capacitor : null;
    var plugin = C && C.Plugins ? C.Plugins.OpenIptvFiles : null;
    return plugin && plugin.pickFile ? plugin : null;
  }

  function pickedFileUrl(path) {
    var C = (typeof window !== "undefined") ? window.Capacitor : null;
    if (C && typeof C.convertFileSrc === "function") return C.convertFileSrc(path);
    return (window.location.origin || "") + "/_capacitor_file_" + path;
  }

  function pickedFileRead(path, asBinary) {
    return fetch(pickedFileUrl(path)).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return asBinary ? response.arrayBuffer() : response.text();
    });
  }

  function setSettingsError(message) {
    $("settingsError").textContent = message || "";
  }

  function applyPlaylistFile(name, text) {
    draft.playlistText = String(text || "");
    draft.playlistName = name || "playlist.m3u";
    setSettingsError("");
    updatePlaylistPicker();
  }

  function applyEpgFile(name, buffer) {
    draft.epgText = gunzipText(buffer);
    draft.epgName = name || "epg.xml";
    setSettingsError("");
    updateEpgPicker();
  }

  /* Wybór pliku: najpierw systemowy (plugin w paczce Android), a gdy go nie ma —
     zostaje ukryte pole <input type="file"> (przeglądarka, webOS). */
  function startFilePick(kind) {
    var input = $(kind === "epg" ? "epgFile" : "playlistFile");
    var plugin = nativeFilePicker();
    if (!plugin) {
      /* Na webOS systemowe okno wyboru pliku nie istnieje, więc zamiast milczeć
         mówimy wprost, czym zastąpić plik (link albo Xtream). */
      if (platformInfo && platformInfo.os === "webos") setSettingsError(t("pick_no_files"));
      else if (input) input.click();
      return;
    }

    plugin.pickFile({ kind: kind, title: t(kind === "epg" ? "pick_epg_file" : "pick_m3u_file") })
      .then(function (picked) {
        if (!picked || picked.cancelled) return;
        if (!picked.path) {
          setSettingsError(t("pick_no_files"));
          return;
        }
        loadPickedFile(kind, picked.name, picked.path);
      }, function () {
        setSettingsError(t("pick_no_files"));
      });
  }

  function loadPickedFile(kind, name, path) {
    pickedFileRead(path, kind === "epg").then(function (data) {
      try {
        if (kind === "epg") applyEpgFile(name, data);
        else applyPlaylistFile(name, data);
      } catch (error) {
        setSettingsError(t("pick_epg_unzip", { error: error.message }));
      }
    }, function () {
      setSettingsError(t(kind === "epg" ? "pick_epg_error" : "pick_m3u_error"));
    });
  }

  function normalizeServer(value) {
    var server = String(value || "").trim().replace(/\/+$/, "");
    if (!server) return "";
    if (!/^https?:\/\//i.test(server)) server = "http://" + server;
    return server;
  }

  function xtreamEndpoint(profile, extra) {
    var server = normalizeServer(profile.xtreamServer);
    var user = encodeURIComponent(profile.xtreamUser || "");
    var pass = encodeURIComponent(profile.xtreamPass || "");
    return server + "/player_api.php?username=" + user + "&password=" + pass + (extra ? "&" + extra : "");
  }

  /* =============================  AKTUALIZACJE  =============================
     Aktualizacja nie jest przymusowa i nigdy nie dzieje się sama. Przy wejściu
     w ustawienia aplikacja cicho pyta GitHuba o najnowsze wydanie
     (releases/latest) i pokazuje tylko informację: numer nowszej wersji oraz
     krótko, co się zmieniło. Pobranie i instalację uruchamia dopiero przycisk
     „Pobierz i zainstaluj” — na Androidzie / Fire TV paczkę pobiera natywny
     plugin OpenIptvUpdater i oddaje ją systemowemu instalatorowi (FileProvider),
     więc aktualizacja nie wymaga ADB ani komputera. webOS nie instaluje .ipk
     sam — tam pokazujemy adres wydania, a paczkę wgrywa się z komputera. */

  var UPDATE_REPO = "keczup21/openiptv";
  var UPDATE_API = "https://api.github.com/repos/" + UPDATE_REPO + "/releases/latest";
  var UPDATE_PAGE = "https://github.com/" + UPDATE_REPO + "/releases/latest";
  var updateState = { asset: null, busy: false, progressBound: false };

  /* „1.19.0” albo „v1.19.0” → [1, 19, 0]; brakujące i nieliczbowe części to zera */
  function versionParts(text) {
    var head = String(text || "").trim().replace(/^v/i, "").split("+")[0].split("-")[0];
    var parts = head.split(".");
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var value = parseInt(parts[i], 10);
      out.push(isNaN(value) || value < 0 ? 0 : value);
    }
    while (out.length < 3) out.push(0);
    return out;
  }

  function compareVersions(a, b) {
    var left = versionParts(a);
    var right = versionParts(b);
    for (var i = 0; i < 3; i++) {
      if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    }
    return 0;
  }

  /* Rozszerzenie paczki dla tej platformy: .apk (Android / Fire TV) lub .ipk (webOS) */
  function updateExtension() {
    if (platformInfo.native && /^(android|androidtv|firetv)$/.test(platformInfo.os)) return "apk";
    if (platformInfo.os === "webos") return "ipk";
    return "";
  }

  /* Paczka z wydania: plik z właściwym rozszerzeniem; gdy wydanie ma ich kilka,
     wybieramy nazwę zaczynającą się od „OpenIPTV” */
  function updateAssetFor(release, extension) {
    if (!release || !release.assets || !extension) return null;
    var pattern = new RegExp("\\." + extension + "$", "i");
    var found = null;
    for (var i = 0; i < release.assets.length; i++) {
      var asset = release.assets[i];
      var name = (asset && asset.name) || "";
      if (!pattern.test(name)) continue;
      if (!found || /^openiptv/i.test(name)) found = asset;
    }
    return found;
  }

  /* Adres, spod którego plugin pobiera paczkę. Pole `url` z API GitHuba
     (api.github.com/repos/.../releases/assets/N) oddaje metadane pliku, a nie
     sam plik — bez nagłówka „Accept: application/octet-stream” przychodzi
     kilkaset bajtów JSON-a, więc instalator mówił „problem z analizowaniem
     pakietu”. Właściwa paczka leży pod browser_download_url
     (github.com/.../releases/download/<tag>/<plik>); adres API zostaje tylko
     jako zapas, bo plugin dokłada wtedy wymagany nagłówek. */
  function updateDownloadUrl(asset) {
    if (!asset) return "";
    if (asset.browser_download_url) return asset.browser_download_url;
    return asset.url || "";
  }

  /* Instalację robi natywny plugin — istnieje tylko w paczce Android / Fire TV */
  function nativeUpdater() {
    var C = (typeof window !== "undefined") ? window.Capacitor : null;
    var plugin = C && C.Plugins ? C.Plugins.OpenIptvUpdater : null;
    return plugin && plugin.install ? plugin : null;
  }

  function setUpdateStatus(message, kind) {
    var el = $("updateStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = "update-status" + (kind ? " " + kind : "");
  }

  /* Opis wydania z GitHuba w wersji „na ekran”: bez markdownu i nagłówków sekcji,
     kilka pierwszych punktów i limit znaków — na pilocie nikt nie przewinie
     całego changelogu */
  function shortReleaseNotes(body, maxLines, maxChars) {
    if (!body) return "";
    var lines = String(body).replace(/\r/g, "").split("\n");
    var out = [];
    for (var i = 0; i < lines.length && out.length < (maxLines || 3); i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === "#") continue;
      line = line
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+[.)]\s+/, "")
        .replace(/\*\*|__|`/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
      if (!line) continue;
      out.push("• " + line);
    }
    var text = out.join("\n");
    if (text.length > (maxChars || 320)) {
      text = text.slice(0, (maxChars || 320) - 1).replace(/[\s.,;:•]+$/, "") + "…";
    }
    return text;
  }

  /* Krótkie „co nowego” pokazujemy tylko wtedy, gdy wydanie faktycznie jest nowsze */
  function setUpdateNotes(latest, body) {
    var el = $("updateNotes");
    if (!el) return;
    var summary = shortReleaseNotes(body);
    if (!summary) {
      hideUpdateNotes();
      return;
    }
    el.textContent = t("update_changes", { latest: latest }) + "\n" + summary;
    el.classList.remove("hidden");
  }

  function hideUpdateNotes() {
    var el = $("updateNotes");
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }

  /* Przyciski w trakcie pobierania zostają dostępne dla pilota. `disabled`
     zabierało fokus (przeglądarka oddaje go wtedy ciału strony), więc po
     naciśnięciu „Pobierz i zainstaluj” nawigacja wracała na początek
     ustawień i nie dało się już zjechać do opisu zmian ani do „Zapisz”.
     Drugie naciśnięcie i tak odrzuca updateState.busy — pilnują tego
     checkForUpdates() i installAvailableUpdate(). */
  function setButtonBusy(button, busy) {
    if (!button) return;
    if (busy) {
      button.classList.add("busy");
      button.setAttribute("aria-disabled", "true");
      return;
    }
    button.classList.remove("busy");
    button.removeAttribute("aria-disabled");
  }

  function setUpdateBusy(busy) {
    updateState.busy = !!busy;
    setButtonBusy($("checkUpdates"), busy);
    setButtonBusy($("installUpdate"), busy);
  }

  function hideInstallButton() {
    var install = $("installUpdate");
    if (install) install.classList.add("hidden");
  }

  /* Informacja pod nazwą aplikacji, w nagłówku ekranu głównego: po włączeniu
     widać, że jest nowsza wersja i gdzie po nią pójść. Nic się nie pobiera
     ani nie instaluje bez naciśnięcia przycisku w ustawieniach. */
  function showUpdateNotice(latest) {
    var el = $("updateNotice");
    if (!el) return;
    el.textContent = t("update_notice", { latest: latest, current: APP_VERSION });
    el.classList.remove("hidden");
  }

  function hideUpdateNotice() {
    var el = $("updateNotice");
    if (!el) return;
    el.textContent = "";
    el.classList.add("hidden");
  }

  function updateErrorText(error) {
    if (error && error.message) return error.message;
    return t("update_err_unknown");
  }

  /* 404 z API GitHuba znaczy jedno: nie widzimy tego repozytorium (jest prywatne).
     Wtedy komunikat z kodem HTTP nic nie tłumaczy, więc mówimy wprost. */
  function updateErrorStatus(error) {
    var text = updateErrorText(error);
    if (/404/.test(text)) return t("update_err_404");
    return t("update_err", { msg: text });
  }

  function reportUpdateError(error) {
    setUpdateBusy(false);
    hideInstallButton();
    hideUpdateNotes();
    setUpdateStatus(updateErrorStatus(error), "warn");
  }

  function updateSizeLabel(asset) {
    var bytes = asset && typeof asset.size === "number" ? asset.size : 0;
    if (bytes <= 0) return "";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  /* Po wejściu w ustawienia wynik poprzedniego sprawdzania nie wisi już na ekranie */
  function resetUpdateStatus() {
    setUpdateBusy(false);
    hideInstallButton();
    hideUpdateNotes();
    setUpdateStatus("", "");
  }

  /* Wynik sprawdzenia. `silent` = ciche sprawdzenie przy wejściu w ustawienia:
     przy aktualnej wersji nie pokazujemy niczego, żeby nie zasypywać ekranu
     komunikatami, których nikt nie prosił */
  function applyRelease(release, installButton, silent) {
    var latest = (release && release.tag_name) || "";
    if (!latest) {
      if (silent) return;
      throw new Error(t("update_err_data"));
    }

    if (compareVersions(latest, APP_VERSION) <= 0) {
      updateState.asset = null;
      hideInstallButton();
      hideUpdateNotes();
      hideUpdateNotice();
      if (!silent) setUpdateStatus(t("update_current", { version: APP_VERSION }), "ok");
      return;
    }

    var asset = updateAssetFor(release, updateExtension());
    updateState.asset = asset;

    /* informacja na ekranie głównym — sam numer nowszej wersji */
    showUpdateNotice(latest);

    var message = t("update_available", { latest: latest, current: APP_VERSION });
    var size = updateSizeLabel(asset);
    if (asset) message += " " + t("update_asset", { name: asset.name, size: size || "?" });

    /* sama informacja: numer nowszej wersji i krótko, co się zmieniło */
    setUpdateNotes(latest, release && release.body);

    if (nativeUpdater() && asset) {
      /* instalację uruchamia dopiero naciśnięcie przycisku — pobranie
         i otwarcie instalatora robi plugin, gdy użytkownik o to poprosi */
      setUpdateStatus(message, "ok");
      if (installButton) installButton.classList.remove("hidden");
      return;
    }

    /* webOS i przeglądarka: paczkę trzeba pobrać i wgrać samemu */
    hideInstallButton();
    setUpdateStatus(
      message + " " + t("update_manual", { ext: updateExtension() || "apk", url: UPDATE_PAGE }),
      "warn"
    );
  }

  function checkForUpdates(silent) {
    if (updateState.busy) return;

    if (silent) {
      fetchJson(UPDATE_API, "update_err_json").then(function (release) {
        try {
          applyRelease(release, $("installUpdate"), true);
        } catch (error) {
          /* brak sensownej odpowiedzi — nie ma czego pokazywać */
        }
      }, function () {
        /* brak sieci nie jest błędem, o którym trzeba mówić po wejściu w ustawienia */
      });
      return;
    }

    setUpdateBusy(true);
    hideInstallButton();
    hideUpdateNotes();
    setUpdateStatus(t("update_checking"), "busy");

    fetchJson(UPDATE_API, "update_err_json").then(function (release) {
      setUpdateBusy(false);
      try {
        applyRelease(release, $("installUpdate"));
      } catch (error) {
        reportUpdateError(error);
      }
    }, reportUpdateError);
  }

  /* Postęp pobierania z pluginu. Brak nasłuchu niczego nie przerywa — wynik
     końcowy i tak przychodzi jako odpowiedź obietnicy z install(). */
  function bindUpdaterProgress(plugin) {
    if (updateState.progressBound) return;
    updateState.progressBound = true;
    try {
      plugin.addListener("progress", function (data) {
        var percent = data && typeof data.percent === "number" ? Math.round(data.percent) : 0;
        if (percent < 0) percent = 0;
        if (percent > 100) percent = 100;
        setUpdateStatus(t("update_downloading", { pct: percent }), "busy");
      });
    } catch (error) {
      /* cisza: komunikat końcowy wystarczy */
    }
  }

  function installAvailableUpdate() {
    var plugin = nativeUpdater();
    var asset = updateState.asset;
    if (!plugin || !asset || updateState.busy) return;

    setUpdateBusy(true);
    setUpdateStatus(t("update_downloading", { pct: 0 }), "busy");
    bindUpdaterProgress(plugin);

    var allowed = plugin.canInstall ? plugin.canInstall() : Promise.resolve({ allowed: true });
    var askedForPermission = false;

    allowed.then(function (result) {
      if (result && result.allowed === false) {
        /* system nie pozwala instalować z nieznanych źródeł — otwieramy ekran,
           na którym włącza się tę zgodę dla OpenIPTV */
        askedForPermission = true;
        setUpdateStatus(t("update_permission"), "warn");
        if (!plugin.openInstallSettings) return null;
        return plugin.openInstallSettings().then(null, function () { return null; });
      }
      return plugin.install({ url: updateDownloadUrl(asset), name: asset.name });
    }).then(function () {
      setUpdateBusy(false);
      if (askedForPermission) return;
      setUpdateStatus(t("update_installer"), "ok");
    }, function (error) {
      setUpdateBusy(false);
      setUpdateStatus(updateErrorStatus(error), "warn");
    });
  }

  /* ================================  SIEĆ  ================================ */

  function nativeHttpAvailable() {
    var C = (typeof window !== "undefined") ? window.Capacitor : null;
    return !!(C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.CapacitorHttp && C.Plugins.CapacitorHttp.get);
  }

  function base64ToUint8Array(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function nativeHttpGet(url, asArrayBuffer) {
    var Http = window.Capacitor.Plugins.CapacitorHttp;
    return Http.get({
      url: url,
      responseType: asArrayBuffer ? "arraybuffer" : "text",
      connectTimeout: 30000,
      readTimeout: 120000
    }).then(function (res) {
      if (res.status < 200 || res.status >= 300) {
        var e = new Error(t("err_http", { code: res.status }));
        e.isHttp = true;
        throw e;
      }
      /* Capacitor zwraca już sparsowany JSON, gdy serwer odpowiedział
         „application/json” (tak robi GitHub API), a nasze ścieżki tekstowe
         czytają string — obiekt wraca więc do postaci tekstu */
      if (!asArrayBuffer) {
        if (res.data && typeof res.data === "object") return JSON.stringify(res.data);
        return res.data;
      }
      if (res.data instanceof ArrayBuffer) return res.data;
      if (res.data && res.data.buffer instanceof ArrayBuffer) return res.data;
      if (typeof res.data === "string") return base64ToUint8Array(res.data);
      return res.data;
    });
  }

  function webosServiceAvailable() {
    return !!(typeof webOS !== "undefined" && webOS.service && webOS.service.request);
  }

  function webosHttpGet(url, asArrayBuffer) {
    return new Promise(function (resolve, reject) {
      var method = asArrayBuffer ? "fetchBinary" : "fetch";
      webOS.service.request(
        "luna://pl.openiptv.player.service.fetch/" + method,
        { url: url },
        function (result) {
          if (result && result.returnValue) {
            if (asArrayBuffer) resolve(base64ToUint8Array(result.dataBase64 || ""));
            else resolve(result.data || "");
          } else {
            var e = new Error(result && result.errorText ? result.errorText : "service error");
            if (result && result.status) e.isHttp = true;
            reject(e);
          }
        },
        function (err) {
          reject(new Error(err && err.errorText ? err.errorText : "service error"));
        }
      );
    });
  }

  function httpGet(url, asArrayBuffer, onProgress) {
    /* natywne HTTP omija CORS — Android (Capacitor) oraz webOS (serwis) */
    if (nativeHttpAvailable()) {
      return nativeHttpGet(url, asArrayBuffer).then(null, function (e) {
        if (e && e.isHttp) throw e;
        return httpGetOnce(url, asArrayBuffer, onProgress);
      });
    }
    if (webosServiceAvailable()) {
      return webosHttpGet(url, asArrayBuffer).then(null, function (e) {
        if (e && e.isHttp) throw e;
        return httpGetOnce(url, asArrayBuffer, onProgress);
      });
    }
    return httpGetOnce(url, asArrayBuffer, onProgress);
  }

  function httpGetOnce(url, asArrayBuffer, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      if (asArrayBuffer) xhr.responseType = "arraybuffer";
      xhr.timeout = 120000;
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response);
        } else if (xhr.status === 401 || xhr.status === 403) {
          var e = new Error(t("err_http_access", { code: xhr.status }));
          e.isHttp = true;
          reject(e);
        } else {
          var e2 = new Error(t("err_http", { code: xhr.status }));
          e2.isHttp = true;
          reject(e2);
        }
      };
      xhr.onerror = function () {
        reject(new Error(t("err_network")));
      };
      xhr.ontimeout = function () {
        reject(new Error(t("err_timeout")));
      };
      if (onProgress) {
        xhr.onprogress = function (event) {
          if (event.lengthComputable) {
            onProgress({ loaded: event.loaded, total: event.total });
          } else if (event.loaded) {
            onProgress({ loaded: event.loaded, total: 0 });
          }
        };
      }
      xhr.send();
    });
  }

  function fetchText(url, onProgress) {
    return httpGet(url, false, onProgress).then(function (text) {
      return String(text || "");
    });
  }

  /* `errorKey` mówi, czyjego adresu dotyczy odpowiedź — panelu Xtream czy
     GitHuba (aktualizacje). Bez tego każdy zły JSON zrzucał winę na panel.
     Natywne HTTP oddaje gotowy obiekt, gdy serwer odpowiedział
     „application/json”, więc obiekt przechodzi bez zmian. */
  function fetchJson(url, errorKey) {
    return fetchText(url).then(function (text) {
      if (text && typeof text === "object") return text;
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(t(errorKey || "err_xtream_json"));
      }
    });
  }

  function decodeUtf8(bytes) {
    if (window.TextDecoder) return new TextDecoder("utf-8").decode(bytes);
    var out = "";
    for (var i = 0; i < bytes.length; i += 8192) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    try {
      return decodeURIComponent(escape(out));
    } catch (e) {
      return out;
    }
  }

  function decodeText(bytes, encoding) {
    if (window.TextDecoder) {
      try {
        return new TextDecoder(encoding).decode(bytes);
      } catch (error) {
        /* nieznany kodek — zostaje UTF-8 */
      }
    }
    return decodeUtf8(bytes);
  }

  /* dekodowanie XMLTV z obsługą BOM (UTF-8 oraz UTF-16LE/BE) */
  function decodeXmlBytes(bytes) {
    if (bytes.length > 1) {
      if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeText(bytes, "utf-16le");
      if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeText(bytes, "utf-16be");
    }
    if (bytes.length > 2 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return decodeUtf8(bytes.subarray(3));
    }
    return decodeUtf8(bytes);
  }

  function stripBom(text) {
    return String(text || "").replace(/^\uFEFF/, "");
  }

  function gunzipText(buffer) {
    var bytes = new Uint8Array(buffer || []);
    if (bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (!window.pako) throw new Error(t("err_gzip"));
      return stripBom(decodeXmlBytes(window.pako.ungzip(bytes)));
    }
    return stripBom(decodeXmlBytes(bytes));
  }

  /* EPG pobieramy ZAWSZE binarnie i sami wykrywamy GZIP po nagłówku pliku
     (0x1f 0x8b) — nie po rozszerzeniu adresu. Wiele serwerów podaje spakowany
     plik pod adresem .xml, .php albo bez rozszerzenia i takie EPG wcześniej
     w ogóle się nie wczytywało. */
  function fetchEpg(url, onProgress) {
    return httpGet(url, true, onProgress).then(gunzipText);
  }

  /* ===============================  PARSERY  =============================== */

  function parseAttributes(line) {
    var attrs = {};
    var re = /([A-Za-z0-9_-]+)="([^"]*)"/g;
    var m;
    while ((m = re.exec(line))) attrs[m[1].toLowerCase()] = m[2];
    return attrs;
  }

  function resolveUrl(base, url) {
    try {
      return new URL(url, base).href;
    } catch (e) {
      return url;
    }
  }

  function parseXmltvDate(value) {
    var m = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
    if (!m) return 0;
    var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (m[7]) {
      var offset = 60000 * (60 * +m[8] + +m[9]);
      utc += m[7] === "+" ? -offset : offset;
    }
    return utc;
  }

  function parsePlaylist(text, baseUrl) {
    var lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    if (!lines.length || lines[0].trim().toUpperCase().indexOf("#EXTM3U") !== 0) {
      throw new Error("To nie jest playlista M3U.");
    }
    var header = parseAttributes(lines[0]);
    var headerEpg = (header["url-tvg"] || header["x-tvg-url"] || "").split(",")[0].trim();
    var channels = [];
    var current = null;

    for (var i = 1; i < lines.length; i++) {
      var line = lines[i].trim();
      if (line.toUpperCase().indexOf("#EXTINF") === 0) {
        current = line;
      } else if (line && line.charAt(0) !== "#" && current) {
        var attrs = parseAttributes(current);
        var commaAt = current.lastIndexOf(",");
        var name = (commaAt >= 0 ? current.substring(commaAt + 1) : attrs["tvg-name"] || "Kanał").trim();
        var streamUrl = resolveUrl(baseUrl, line);
        channels.push({
          key: channels.length + "|" + streamUrl,
          name: name || t("channel") + " " + (channels.length + 1),
          streamUrl: streamUrl,
          tvgId: attrs["tvg-id"] || "",
          group: attrs["group-title"] || t("other"),
          logoUrl: attrs["tvg-logo"] ? resolveUrl(baseUrl, attrs["tvg-logo"]) : "",
          catchupType: attrs["catchup-type"] || attrs.catchup || attrs.timeshift || "",
          catchupSource: attrs["catchup-source"] || "",
          catchupDays: Math.max(0, Math.min(30, parseInt(attrs["catchup-days"] || attrs.timeshift || "0", 10) || 0)),
          correction: parseFloat(attrs["catchup-correction"] || "0") || 0
        });
        current = null;
      }
    }
    if (!channels.length) throw new Error("Playlista nie zawiera kanałów.");
    return { channels: channels, epgUrl: headerEpg ? resolveUrl(baseUrl, headerEpg) : "" };
  }

  function parseXmltv(text, daysBack) {
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) {
      throw new Error("EPG nie jest poprawnym XMLTV.");
    }
    var nodes = doc.getElementsByTagName("programme");
    var now = Date.now();
    var from = now - 86400000 * daysBack;
    var to = now + 86400000 * 2;
    var programs = {};
    epgAliases = {};

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var channelId = node.getAttribute("channel") || "";
      var start = parseXmltvDate(node.getAttribute("start"));
      var end = parseXmltvDate(node.getAttribute("stop"));
      if (!channelId || start < from || start > to || end <= start) continue;
      var titles = node.getElementsByTagName("title");
      var title = titles.length ? titles[0].textContent.trim() : "Program";
      if (!programs[channelId]) programs[channelId] = [];
      programs[channelId].push({
        channelId: channelId,
        start: start,
        end: end,
        title: title || "Program"
      });

      /* alias po nazwie wyświetlanej — kanały bez tvg-id też dostaną EPG */
      var names = node.getElementsByTagName("display-name");
      for (var d = 0; d < names.length; d++) {
        var dn = (names[d].textContent || "").trim();
        if (dn) epgAliases[dn.toLowerCase()] = channelId;
      }
    }
    for (var key in programs) {
      programs[key].sort(function (a, b) {
        return b.start - a.start;
      });
    }
    return programs;
  }

  /* =============================  XTREAM CODES  ============================= */

  function xtreamStreamUrl(profile, stream) {
    var server = normalizeServer(profile.xtreamServer);
    var user = encodeURIComponent(profile.xtreamUser || "");
    var pass = encodeURIComponent(profile.xtreamPass || "");
    var ext = String(stream.container_extension || "ts").replace(/^\./, "") || "ts";
    return server + "/live/" + user + "/" + pass + "/" + stream.stream_id + "." + ext;
  }

  function xtreamXmltvUrl(profile) {
    var server = normalizeServer(profile.xtreamServer);
    var user = encodeURIComponent(profile.xtreamUser || "");
    var pass = encodeURIComponent(profile.xtreamPass || "");
    /* next_days ogranicza rozmiar EPG; jeśli panel go nie obsługuje, zwróci pełny plik (bez szkody) */
    var days = Math.max(1, (parseInt(settings.archiveDays, 10) || 7) + 1);
    return server + "/xmltv.php?username=" + user + "&password=" + pass + "&next_days=" + days;
  }

  /* krok 1: logowanie (player_api.php bez akcji) → user_info.auth
     krok 2: kategorie live       (action=get_live_categories)
     krok 3: lista kanałów live   (action=get_live_streams)
     krok 4: EPG                  (xmltv.php, o ile nie podano własnego adresu) */
  function loadXtreamCatalog(profile) {
    var categories = [];
    var streams = [];

    return fetchJson(xtreamEndpoint(profile, "")).then(function (info) {
      var userInfo = info && info.user_info;
      if (!userInfo || String(userInfo.auth) !== "1") {
        throw new Error("Xtream: nieprawidłowy adres serwera, użytkownik lub hasło.");
      }
      if (userInfo.status && String(userInfo.status).toLowerCase() !== "active") {
        throw new Error("Xtream: konto nieaktywne (" + userInfo.status + "). Sprawdź datę ważności.");
      }
      return fetchJson(xtreamEndpoint(profile, "action=get_live_categories"));
    }).then(function (data) {
      if (Array.isArray(data)) categories = data;
      return fetchJson(xtreamEndpoint(profile, "action=get_live_streams"));
    }).then(function (data) {
      if (Array.isArray(data)) streams = data;
      if (!streams.length) {
        throw new Error("Xtream nie zwrócił żadnych kanałów live dla tego konta.");
      }
      var groupNames = {};
      categories.forEach(function (category) {
        groupNames[String(category.category_id)] = category.category_name || t("other");
      });

      var channels = streams.map(function (stream, index) {
        var archiveDays = Math.max(0, Math.min(30, parseInt(stream.tv_archive_duration || "0", 10) || 0));
        var hasArchive = String(stream.tv_archive) === "1" || archiveDays > 0;
        return {
          key: "xtream-" + stream.stream_id,
          name: stream.name || "Kanał " + (index + 1),
          streamUrl: xtreamStreamUrl(profile, stream),
          tvgId: stream.epg_channel_id || "",
          group: groupNames[String(stream.category_id)] || stream.category_name || t("other"),
          logoUrl: stream.stream_icon || "",
          catchupType: hasArchive ? "xtream" : "",
          catchupSource: "",
          catchupDays: hasArchive ? archiveDays : 0,
          correction: 0
        };
      });

      return {
        channels: channels,
        epgUrl: profile.epgUrl || xtreamXmltvUrl(profile)
      };
    });
  }

  /* ==========================  WCZYTANIE KATALOGU  ========================== */

  function setStatus(text) {
    $("status").textContent = text;
  }

  function formatProgress(info) {
    if (info && info.total > 0) {
      return Math.round((info.loaded / info.total) * 100) + "%";
    }
    if (info && info.loaded > 0) {
      return (info.loaded / 1048576).toFixed(1) + " MB";
    }
    return "";
  }

  /* parsuje XMLTV w Web Workerze, żeby nie blokować UI; z fallbackiem synchronicznym */
  function parseXmltvAsync(text, daysBack) {
    return new Promise(function (resolve) {
      var settled = false;
      var finish = function (programs) {
        if (!settled) {
          settled = true;
          resolve(programs);
        }
      };
      var worker;
      try {
        worker = new Worker("epg-worker.js");
      } catch (e) {
        finish(parseXmltv(text, daysBack));
        return;
      }
      worker.onmessage = function (event) {
        var data = event.data || {};
        if (data.error) {
          finish(parseXmltv(text, daysBack));
        } else {
          epgAliases = data.aliases || {};
          finish(data.programs || {});
        }
        try { worker.terminate(); } catch (e2) {}
      };
      worker.onerror = function () {
        finish(parseXmltv(text, daysBack));
        try { worker.terminate(); } catch (e2) {}
      };
      worker.postMessage({ text: text, daysBack: daysBack });
    });
  }

  function loadEpgInBackground(profile, epgUrl) {
    if (!profile.epgFileText && !epgUrl) {
      state.programs = {};
      setStatus(state.channels.length + " " + t("channels_count"));
      return;
    }
    setStatus(state.channels.length + " " + t("channels_count") + " • " + t("loading_epg"));
    var epgSource = profile.epgFileText
      ? Promise.resolve(profile.epgFileText)
      : fetchEpg(epgUrl, function (info) {
          setStatus(state.channels.length + " " + t("channels_count") + " • " + t("loading_epg") + " " + formatProgress(info));
        });
    epgSource.then(function (xml) {
      setStatus(state.channels.length + " " + t("channels_count") + " • " + t("parsing_epg"));
      return parseXmltvAsync(xml, settings.archiveDays).then(function (programs) {
        state.programs = programs;
        var count = 0;
        for (var k in state.programs) count += state.programs[k].length;
        if (state.channels.length) {
          selectGroup(state.selectedGroup, document.querySelector(".category.active"));
        }
        setStatus(state.channels.length + " " + t("channels_count") + " • EPG: " + count + " " + t("epg_programs"));
      });
    }, function (error) {
      state.programs = {};
      setStatus(state.channels.length + " " + t("channels_count") + " • EPG: " + t("epg_no_data") + " (" + error.message + ")");
    });
  }

  function refreshEpg() {
    var profile = activeProfile();
    if (!profile || !state.channels.length) return;
    loadEpgInBackground(profile, state.epgUrl);
  }

  function scheduleEpgRefresh() {
    clearInterval(state.epgTimer);
    state.epgTimer = null;
    var mins = parseInt(settings.epgRefreshMinutes, 10) || 0;
    if (mins > 0) state.epgTimer = setInterval(refreshEpg, mins * 60000);
  }

  function loadCatalog() {
    var profile = activeProfile();
    if (!profile) {
      openSettings();
      return;
    }
    normalizeProfile(profile);
    showScreen("browserScreen");
    scheduleEpgRefresh();

    var switcher = $("profileSwitcher");
    suppressProfileSwitcher = true;
    switcher.textContent = "";
    settings.profiles.forEach(function (item) {
      var option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      switcher.appendChild(option);
    });
    switcher.value = settings.activeProfileId;
    suppressProfileSwitcher = false;

    /* UWAGA: NIE czyścimy tutaj #categories — to <aside>, w którym
       renderCategories trzyma #categoryList oraz narzędzia kolejności grup.
       Wyczyszczenie go usuwało te elementy z DOM i kolejny render kończył się
       błędem „Cannot set properties of null (setting 'textContent')”.
       Listę kategorii czyści renderCategories(). */
    $("channels").textContent = "";

    var loadSource;
    if (profile.sourceType === "xtream") {
      setStatus(t("connecting_xtream"));
      loadSource = loadXtreamCatalog(profile);
    } else if (profile.playlistFileText) {
      var fileBase = "file:///" + (profile.playlistFileName || "playlist.m3u");
      loadSource = Promise.resolve(parsePlaylist(profile.playlistFileText, fileBase));
    } else {
      setStatus(t("loading_playlist"));
      loadSource = fetchText(profile.playlistUrl).then(function (text) {
        return parsePlaylist(text, profile.playlistUrl);
      });
    }

    loadSource.then(function (catalog) {
      state.channels = catalog.channels;
      state.epgUrl = profile.epgUrl || catalog.epgUrl;

      /* 1) najpierw pokazujemy kanały */
      renderCategories();

      /* Pilot: po wczytaniu listy fokus wchodzi w kanały — inaczej zostawał
         w nagłówku (albo w polu szukania) i trzeba było szukać listy strzałkami.
         Gdy użytkownik właśnie pisze zapytanie, nie przerywamy mu. */
      if (isTvMode() && document.activeElement !== $("searchInput")) focusChannelEntry();

      /* 2) EPG w tle (o ile włączone przy starcie) */
      if (settings.epgReloadOnStart) {
        loadEpgInBackground(profile, state.epgUrl);
      } else {
        state.programs = {};
        setStatus(state.channels.length + " " + t("channels_count"));
      }
    }).catch(function (error) {
      state.channels = [];
      setStatus(t("error") + " " + error.message);
    });
  }

  /* ---------- kolejność grup (ręczna, zapisywana per profil) ---------- */

  function groupNames() {
    var groups = [];
    var seen = {};
    state.channels.forEach(function (channel) {
      if (!seen[channel.group]) {
        seen[channel.group] = true;
        groups.push(channel.group);
      }
    });
    var saved = perProfile(settings.groupOrder);
    var rank = {};
    saved.forEach(function (name, i) { rank[name] = i; });
    return groups.sort(function (a, b) {
      var ra = typeof rank[a] === "number" ? rank[a] : -1;
      var rb = typeof rank[b] === "number" ? rank[b] : -1;
      if (ra >= 0 && rb >= 0) return ra - rb;
      if (ra >= 0) return -1;
      if (rb >= 0) return 1;
      return a.localeCompare(b, settings.language === "en" ? "en" : "pl");
    });
  }

  function moveGroup(name, direction) {
    var groups = groupNames();
    var from = groups.indexOf(name);
    var to = from + direction;
    if (from < 0 || to < 0 || to >= groups.length) return;

    groups.splice(to, 0, groups.splice(from, 1)[0]);
    var saved = perProfile(settings.groupOrder);
    saved.length = 0;
    groups.forEach(function (g) { saved.push(g); });
    saveSettings();

    state.orderFocus = { key: name, dir: direction };
    renderCategories();
  }

  function resetGroupOrder() {
    var saved = perProfile(settings.groupOrder);
    saved.length = 0;
    saveSettings();
    renderCategories();
  }

  function setGroupOrderEdit(on) {
    state.orderEdit = !!on;
    if (!state.orderEdit) state.orderFocus = null;
    renderCategories();
  }

  function orderButton(key, glyph, dir, disabled) {
    var button = document.createElement("button");
    button.className = "order-btn";
    button.type = "button";
    button.tabIndex = 0;
    button.textContent = glyph;
    button.title = t(dir < 0 ? "move_up" : "move_down");
    button.setAttribute("data-move-key", key);
    button.setAttribute("data-move-dir", String(dir));
    if (disabled) {
      button.disabled = true;
      button.tabIndex = -1;
    }
    button.onclick = function (event) {
      if (event && event.stopPropagation) event.stopPropagation();
      moveGroup(key, dir);
    };
    return button;
  }

  /* Odporność na niekompletny HTML (starsze/zmiksowane zasoby w WebView):
     jeśli brakuje kontenera listy lub narzędzi kolejności grup, tworzymy je w locie. */
  function ensureCategoryLayout() {
    var host = $("categories") || document.body;
    var container = $("categoryList");
    if (!container) {
      container = document.createElement("div");
      container.id = "categoryList";
      host.appendChild(container);
    }

    var toggle = $("groupOrderToggle");
    var reset = $("groupOrderReset");
    if (!toggle || !reset) {
      var tools = document.createElement("div");
      tools.className = "category-tools";
      if (!toggle) {
        toggle = document.createElement("button");
        toggle.id = "groupOrderToggle";
        toggle.type = "button";
        toggle.tabIndex = 0;
        toggle.className = "order-toggle hidden";
        toggle.onclick = function () { setGroupOrderEdit(!state.orderEdit); };
      }
      if (!reset) {
        reset = document.createElement("button");
        reset.id = "groupOrderReset";
        reset.type = "button";
        reset.tabIndex = 0;
        reset.className = "order-reset hidden";
        reset.onclick = function () { resetGroupOrder(); };
      }
      tools.appendChild(toggle);
      tools.appendChild(reset);
      host.insertBefore(tools, container);
    }

    if (!$("groupOrderHint")) {
      var hint = document.createElement("p");
      hint.id = "groupOrderHint";
      hint.className = "order-hint hidden";
      hint.textContent = t("order_hint");
      host.insertBefore(hint, container);
    }

    return container;
  }

  function renderCategories() {
    var groups = groupNames();
    var container = ensureCategoryLayout();
    container.textContent = "";

    var canOrder = groups.length > 1;
    var toggle = $("groupOrderToggle");
    var reset = $("groupOrderReset");
    var hint = $("groupOrderHint");
    if (toggle) {
      toggle.classList.toggle("hidden", !canOrder);
      setIconLabel(toggle, t(state.orderEdit ? "group_order_done" : "group_order"));
    }
    if (reset) {
      reset.classList.toggle("hidden", !(canOrder && state.orderEdit));
      setIconLabel(reset, t("order_reset"));
    }
    if (hint) hint.classList.toggle("hidden", !(canOrder && state.orderEdit));

    var items = [
      { key: "@favorites", label: t("favorites") },
      { key: "@recent", label: t("recent") },
      { key: "@all", label: t("all") }
    ].concat(groups.map(function (g) { return { key: g, label: g }; }));

    var buttons = {};

    items.forEach(function (item, index) {
      var fixed = item.key.charAt(0) === "@";
      var button = document.createElement("button");
      button.className = "category";
      button.type = "button";
      button.tabIndex = 0;
      setIconLabel(button, item.label);
      button.setAttribute("data-key", item.key);
      /* Grupa zmienia się tylko po naciśnięciu OK (klik) — samo dojechanie
         fokusem nie może przełączać listy kanałów: pilot schodząc z kanałów
         na przyciski grup przerzucał wtedy kategorię w trakcie przewijania. */
      button.onclick = function () {
        selectGroup(item.key, button);
        if (nextFocusAfterGroup(isTvMode()) === "channels") focusChannelEntry();
      };
      buttons[item.key] = button;

      if (!state.orderEdit || fixed) {
        container.appendChild(button);
        return;
      }

      var row = document.createElement("div");
      row.className = "category-row";
      var tools = document.createElement("div");
      tools.className = "order-btns";
      tools.appendChild(orderButton(item.key, "▲", -1, index === 3));
      tools.appendChild(orderButton(item.key, "▼", 1, index === items.length - 1));
      row.appendChild(button);
      row.appendChild(tools);
      container.appendChild(row);
    });

    var target = buttons[state.selectedGroup] || buttons["@all"];
    selectGroup(target.getAttribute("data-key"), target);

    /* pilot: po przesunięciu grupy wracamy na ten sam przycisk strzałki */
    if (state.orderFocus) {
      var wanted = state.orderFocus;
      state.orderFocus = null;
      var all = container.querySelectorAll(".order-btn");
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute("data-move-key") === wanted.key &&
            all[i].getAttribute("data-move-dir") === String(wanted.dir)) {
          all[i].focus();
          break;
        }
      }
    }
  }

  /* -------------------------------  EPG  ------------------------------- */

  function programsFor(channel) {
    if (state.programs[channel.tvgId]) return state.programs[channel.tvgId];
    if (state.programs[channel.name]) return state.programs[channel.name];
    var alias = epgAliases[String(channel.name || "").toLowerCase()];
    return alias ? (state.programs[alias] || []) : [];
  }

  function currentProgram(channel) {
    var list = programsFor(channel);
    var now = Date.now();
    for (var i = 0; i < list.length; i++) {
      if (now >= list[i].start && now < list[i].end) return list[i];
    }
    return null;
  }

  function nextProgram(channel) {
    var list = programsFor(channel);
    var now = Date.now();
    var next = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].start >= now && (!next || list[i].start < next.start)) next = list[i];
    }
    return next;
  }

  function hasArchive(channel) {
    if (settings.catchupAll) return true;
    if (channel.catchupSource || settings.catchupTemplate) return true;
    var type = String(channel.catchupType || "").toLowerCase();
    if (type === "append" || type === "shift" || type === "flussonic") return true;
    if (channel.catchupDays > 0 || channel.catchupType) {
      return !!buildTimeshiftUrl(channel.streamUrl, 1, 1);
    }
    return false;
  }

  /* ===============================  KANAŁY  =============================== */

  function selectGroup(name, button) {
    state.selectedGroup = name;
    var active = document.querySelectorAll(".category.active");
    for (var i = 0; i < active.length; i++) active[i].classList.remove("active");
    if (button) button.classList.add("active");

    var container = $("channels");
    container.textContent = "";
    var query = ($("searchInput").value || "").trim().toLowerCase();
    var recents = perProfile(settings.recentChannels);

    var visible = state.channels.filter(function (channel) {
      var inGroup =
        name === "@all" ||
        (name === "@favorites" && isFavorite(channel)) ||
        (name === "@recent" && recents.indexOf(keyOf(channel)) >= 0) ||
        channel.group === name;
      if (!inGroup) return false;
      if (!query) return true;
      if (channel.name.toLowerCase().indexOf(query) >= 0) return true;
      return programsFor(channel).some(function (program) {
        return program.title.toLowerCase().indexOf(query) >= 0;
      });
    });

    if (name === "@recent") {
      visible.sort(function (a, b) {
        return recents.indexOf(keyOf(a)) - recents.indexOf(keyOf(b));
      });
    }

    /* Lista rysowana porcjami (LIST_CHUNK) — na playlistach z tysiącami kanałów
       do DOM trafia tylko to, co realnie widać, a resztę dokładamy przy przewijaniu */
    state.listItems = visible;
    state.listRendered = 0;
    state.listGroup = name;
    state.listToken++;
    container.textContent = "";
    container.scrollTop = 0;
    bindListScroll();
    renderListChunk(true);
  }

  function renderListChunk(focusFirst) {
    var container = $("channels");
    if (!container || state.listRendered >= state.listItems.length) return;

    var token = state.listToken;
    var end = Math.min(state.listRendered + LIST_CHUNK, state.listItems.length);
    for (var i = state.listRendered; i < end; i++) {
      container.appendChild(buildChannelCard(state.listItems[i]));
    }
    state.listRendered = end;

    /* w trybie TV fokus musi od razu wylądować na pierwszym kanale */
    if (focusFirst && end > 0 && isTvMode() && document.activeElement === document.body) {
      var first = container.querySelector(".channel-main");
      if (first) {
        try { first.focus(); } catch (error) { /* bez fokusu też da się kliknąć */ }
      }
    }

    /* gdy porcja nie zapełniła jeszcze ekranu, dokładamy kolejną */
    if (container.clientHeight > 0 && container.scrollHeight <= container.clientHeight) {
      setTimeout(function () {
        if (token === state.listToken && !state.listScrollLock) renderListChunk(false);
      }, 0);
    }
  }

  /* doładowanie przy przewijaniu: jedna porcja na raz, bez mielenia DOM-u */
  function bindListScroll() {
    var container = $("channels");
    if (!container || container.getAttribute("data-scroll-bound")) return;
    container.setAttribute("data-scroll-bound", "1");
    container.addEventListener("scroll", function () {
      if (state.listScrollLock) return;
      var remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (remaining > LOGO_MARGIN) return;
      state.listScrollLock = true;
      setTimeout(function () {
        state.listScrollLock = false;
        if (state.listRendered < state.listItems.length) renderListChunk(false);
      }, 80);
    });
  }

  /* nawigacja pilotem: dokładamy porcje, zanim fokus dojdzie do końca listy */
  function ensureListAhead() {
    var container = $("channels");
    var active = document.activeElement;
    if (!container || !active || !active.closest) return;
    var card = active.closest(".channel");
    if (!card) return;
    var index = Array.prototype.indexOf.call(container.children, card);
    if (index >= state.listRendered - 12) renderListChunk(false);
  }

  /* logotyp wczytujemy dopiero, gdy kafelek zbliży się do ekranu — inaczej
     duża playlista zasypuje łącze setkami obrazków na starcie */
  function observeLogo(image) {
    var url = image.dataset ? image.dataset.logo : "";
    if (!url) return;
    if (!("IntersectionObserver" in window)) {
      image.src = url;
      return;
    }
    if (!logoObserver) {
      logoObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var target = entry.target;
          logoObserver.unobserve(target);
          if (target.dataset.logo) target.src = target.dataset.logo;
        });
      }, { root: $("channels"), rootMargin: LOGO_MARGIN + "px 0px" });
    }
    logoObserver.observe(image);
  }

  function buildChannelCard(channel) {
    var card = document.createElement("article");
    card.className = "channel";

    var logo = document.createElement("img");
    logo.className = "channel-logo";
    logo.alt = "";
    if (channel.logoUrl) {
      /* adres trafia do src dopiero, gdy kafelek wejdzie w obszar widzenia */
      logo.dataset.logo = channel.logoUrl;
      logo.loading = "lazy";
      logo.decoding = "async";
      logo.onerror = function () {
        this.style.display = "none";
      };
      observeLogo(logo);
    } else {
      logo.style.display = "none";
    }
    card.appendChild(logo);

    var main = document.createElement("button");
    main.className = "channel-main";
    main.tabIndex = 0;

    var title = document.createElement("span");
    title.className = "channel-name";
    title.textContent = channel.name;
    main.appendChild(title);

    var now = currentProgram(channel);
    var next = nextProgram(channel);

    var nowRow = document.createElement("small");
    nowRow.className = "channel-now";
    nowRow.textContent = now
      ? pad2(new Date(now.start).getHours()) + ":" + pad2(new Date(now.start).getMinutes()) + "  " + now.title
      : t("no_epg");
    main.appendChild(nowRow);

    if (next) {
      var nextRow = document.createElement("small");
      nextRow.className = "channel-next";
      nextRow.textContent = t("next") + " " + pad2(new Date(next.start).getHours()) + ":" + pad2(new Date(next.start).getMinutes()) + "  " + next.title;
      main.appendChild(nextRow);
    }

    if (now) {
      var progress = document.createElement("i");
      progress.className = "channel-progress";
      var pct = Math.max(0, Math.min(100, (Date.now() - now.start) / (now.end - now.start) * 100));
      progress.style.width = pct + "%";
      main.appendChild(progress);
    }

    main.onclick = function () {
      playChannel(channel, null, "browserScreen");
    };
    card.appendChild(main);

    /* Na kafelku zostaje sama gwiazdka ulubionych. Przycisk archiwum („⏪”)
       rysował się obok niej jak „<<” i był tu zbędny — do nagrań wchodzi się
       z menu opcji kanału (przytrzymane OK / MENU) oraz z programu TV, gdzie
       wybiera się konkretny program z przeszłości. */
    var favorite = document.createElement("button");
    favorite.className = "favorite-button";
    favorite.tabIndex = 0;
    setIconLabel(favorite, isFavorite(channel) ? "★" : "☆");
    favorite.onclick = function () {
      toggleFavorite(channel);
    };
    card.appendChild(favorite);

    return card;
  }

  function toggleFavorite(channel) {
    var list = perProfile(settings.favorites);
    var key = keyOf(channel);
    var index = list.indexOf(key);
    if (index >= 0) list.splice(index, 1);
    else list.push(key);
    saveSettings();

    /* odświeżamy tylko gwiazdki widocznych kafelków — pełne przerysowanie listy
       gubi pozycję przewijania i miga na telewizorze */
    refreshFavoriteButtons(channel);
    if (state.selectedGroup === "@favorites") {
      selectGroup("@favorites", document.querySelector(".category.active"));
    }
  }

  function refreshFavoriteButtons(channel) {
    var container = $("channels");
    if (!container) return;
    var key = keyOf(channel);
    var cards = container.children;
    for (var i = 0; i < cards.length && i < state.listItems.length; i++) {
      if (keyOf(state.listItems[i]) !== key) continue;
      var button = cards[i].querySelector(".favorite-button");
      if (button) button.textContent = isFavorite(channel) ? "★" : "☆";
    }
  }

  /* ==============================  ARCHIWUM  ============================== */

  function formatRange(start, end) {
    var from = new Date(start);
    var to = new Date(end);
    return pad2(from.getDate()) + "." + pad2(from.getMonth() + 1) + " " +
      pad2(from.getHours()) + ":" + pad2(from.getMinutes()) + "–" +
      pad2(to.getHours()) + ":" + pad2(to.getMinutes());
  }

  /* Ekran „Archiwum / programy kanału”. Dwa wejścia na ten sam ekran:
       • z listy kanałów — nagrania z ostatnich dni (ustawienie „dni wstecz”),
       • z odtwarzacza (opts.fromPlayer) — wszystkie programy oglądanego
         kanału: poprzednie, bieżący i następne, żeby wybrać materiał
         z archiwum albo wrócić do bieżącej chwili.
     Program, który jeszcze się nie zaczął, jest nieaktywny (archiwum go nie
     ma), a ten, który leci teraz, dostaje podpis LIVE i odtwarza się od
     początku. */
  function openArchive(channel, options) {
    var opts = options || {};
    var fromPlayer = !!opts.fromPlayer;
    state.selectedChannel = channel;
    archive.channel = channel;
    archive.fromPlayer = fromPlayer;
    /* „Wstecz” wraca do obrazu tylko wtedy, gdy coś tam jeszcze leci —
       pilnuje tego closeArchive() */
    archive.returnTo = fromPlayer ? "playerScreen" : "browserScreen";

    var days = channel.catchupDays > 0 ? Math.min(channel.catchupDays, settings.archiveDays) : settings.archiveDays;
    var now = Date.now();
    var from = now - 86400000 * days;
    /* lista otwarta z odtwarzacza pokazuje też to, co dopiero będzie */
    var until = fromPlayer ? now + ARCHIVE_AHEAD : now;
    var entries = programsFor(channel).filter(function (program) {
      return program.start >= from && program.start < until && program.end > program.start;
    });

    /* brak EPG → pozycje godzinowe, żeby archiwum było nadal użyteczne */
    if (!entries.length) {
      var hourStart = now - (now % 3600000);
      for (var i = 1; i <= 24 * days; i++) {
        entries.push({
          start: hourStart - 3600000 * i,
          end: hourStart - 3600000 * (i - 1),
          title: t("hourly_recording")
        });
      }
    }

    $("archiveTitle").textContent = fromPlayer
      ? t("epg_list_title", { name: channel.name })
      : t("archive_title") + channel.name;
    $("archiveSubtitle").textContent = fromPlayer
      ? t("epg_list_hint") + t("epg_list_days", { days: days })
      : days + t("days_back");

    var container = $("programs");
    container.textContent = "";
    entries.sort(function (a, b) {
      return b.start - a.start;
    });
    if (entries.length > ARCHIVE_MAX) {
      $("archiveSubtitle").textContent += " • " + t("archive_limited", { shown: ARCHIVE_MAX, total: entries.length });
      entries = entries.slice(0, ARCHIVE_MAX);
    }
    entries.forEach(function (program) {
      container.appendChild(programEntry(channel, program, fromPlayer));
    });

    showScreen("archiveScreen");
  }

  /* jedna pozycja listy programów: godzina, tytuł, podpis LIVE dla programu,
     który leci teraz, i brak wyboru dla tego, co dopiero będzie */
  function programEntry(channel, program, fromPlayer) {
    var now = Date.now();
    var isNow = program.start <= now && program.end > now;
    var isFuture = program.start > now;

    var button = document.createElement("button");
    button.className = "program" + (isNow ? " now" : "") + (isFuture ? " future" : "");
    button.tabIndex = 0;

    var time = document.createElement("time");
    time.textContent = formatRange(program.start, program.end);
    button.appendChild(time);

    var row = document.createElement("span");
    row.className = "program-title-row";
    var label = document.createElement("span");
    label.className = "program-title";
    label.textContent = program.title;
    row.appendChild(label);
    if (isNow) {
      var live = document.createElement("em");
      live.className = "guide-live";
      live.textContent = t("live");
      row.appendChild(live);
    }
    button.appendChild(row);

    if (isFuture) {
      var note = document.createElement("span");
      note.className = "program-note";
      note.textContent = t("epg_list_future");
      button.appendChild(note);
      button.disabled = true;
    } else {
      button.onclick = function () {
        /* Z listy otwartej w odtwarzaczu wracamy potem do listy kanałów (była
           tylko wyborem materiału), a z listy kanałów — do archiwum. */
        playChannel(channel, program, fromPlayer ? "browserScreen" : "archiveScreen");
      };
    }
    return button;
  }

  /* Powrót z archiwum / listy programów. Do obrazu wracamy tylko wtedy, gdy
     coś tam jeszcze leci: po wyjściu z odtwarzacza kanał jest już zatrzymany
     i ekran odtwarzacza byłby czarnym prostokątem bez obrazu. */
  function closeArchive() {
    var target = archive.returnTo === "playerScreen" && state.watchChannel ? "playerScreen" : "browserScreen";
    archive.returnTo = "browserScreen";
    archive.fromPlayer = false;
    showScreen(target);
  }

  /* „Na żywo” nad listą programów: wraca do bieżącej chwili na tym kanale */
  function playArchiveLive() {
    if (!archive.channel) return;
    playChannel(archive.channel, null, "archiveScreen");
  }

  /* ==============================  CATCH-UP  ============================== */

  function formatStamp(seconds, pattern) {
    var date = new Date(seconds * 1000);
    return pattern
      .replace(/Y/g, date.getFullYear())
      .replace(/m/g, pad2(date.getMonth() + 1))
      .replace(/d/g, pad2(date.getDate()))
      .replace(/H/g, pad2(date.getHours()))
      .replace(/i/g, pad2(date.getMinutes()))
      .replace(/s/g, pad2(date.getSeconds()));
  }

  /* Xtream timeshift liczy czas wg UTC — niezależnie od strefy urządzenia */
  function formatStampUtc(seconds, pattern) {
    var date = new Date(seconds * 1000);
    return pattern
      .replace(/Y/g, date.getUTCFullYear())
      .replace(/m/g, pad2(date.getUTCMonth() + 1))
      .replace(/d/g, pad2(date.getUTCDate()))
      .replace(/H/g, pad2(date.getUTCHours()))
      .replace(/i/g, pad2(date.getUTCMinutes()))
      .replace(/s/g, pad2(date.getUTCSeconds()));
  }

  /* Xtream / standard: <serwer>/timeshift/<user>/<pass>/<minuty>/<YYYY-MM-DD:HH-mm>/<id>.<ext> */
  function buildTimeshiftUrl(streamUrl, startSeconds, durationMinutes) {
    try {
      var anchor = document.createElement("a");
      anchor.href = streamUrl.split("|")[0];
      var parts = anchor.pathname.replace(/^\/+|\/+$/g, "").split("/");
      if (parts.length < 3) return "";
      var file = parts[parts.length - 1];
      if (!/^\d+$/.test(file.split(".")[0])) return "";
      var stamp = formatStampUtc(startSeconds, "Y-m-d:H-i");
      return anchor.protocol + "//" + anchor.host + "/timeshift/" +
        parts[parts.length - 3] + "/" + parts[parts.length - 2] + "/" +
        durationMinutes + "/" + stamp + "/" + file;
    } catch (e) {
      return "";
    }
  }

  function fillCatchupTemplate(template, channel, startSeconds, endSeconds) {
    var durationSeconds = Math.max(1, endSeconds - startSeconds);
    var durationMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
    var streamId = (channel.streamUrl.split("|")[0].split("?")[0].split("/").pop() || "").split(".")[0];
    var out = template.replace(/\$\{(start|end):([^}]+)\}/g, function (match, which, pattern) {
      return formatStamp(which === "start" ? startSeconds : endSeconds, pattern);
    });
    return out
      .replace(/\$\{start\}/g, startSeconds)
      .replace(/\$\{end\}/g, endSeconds)
      .replace(/\$\{timestamp\}/g, startSeconds)
      .replace(/\$\{duration\}/g, durationMinutes)
      .replace(/\{utc\}/g, startSeconds)
      .replace(/\{utcend\}/g, endSeconds)
      .replace(/\{start\}/g, startSeconds)
      .replace(/\{end\}/g, endSeconds)
      .replace(/\{timestamp\}/g, startSeconds)
      .replace(/\{duration\}/g, durationSeconds)
      .replace(/\{channel_id\}/g, streamId);
  }

  function buildCatchupUrl(channel, start, end) {
    var correction = 3600 * channel.correction;
    var startSeconds = Math.floor(start / 1000 + correction);
    var endSeconds = Math.floor(end / 1000 + correction);
    var type = String(channel.catchupType || "").toLowerCase();
    var template = channel.catchupSource || settings.catchupTemplate;
    var base = channel.streamUrl;

    if (template) return fillCatchupTemplate(template, channel, startSeconds, endSeconds);

    /* append / shift → ?utc=&lutc= */
    if (type === "append" || type === "shift") {
      return base + (base.indexOf("?") >= 0 ? "&" : "?") + "utc=" + startSeconds + "&lutc=" + endSeconds;
    }
    /* flussonic → ?from=&to= */
    if (type === "flussonic") {
      return base + (base.indexOf("?") >= 0 ? "&" : "?") + "from=" + startSeconds + "&to=" + endSeconds;
    }
    /* default / xtream / xc / xs / timeshift → /timeshift/... */
    var url = buildTimeshiftUrl(base, startSeconds, Math.max(1, Math.ceil((endSeconds - startSeconds) / 60)));
    if (url) return url;
    /* generyczny fallback dla HLS */
    if (/\.m3u8/i.test(base)) {
      return base + (base.indexOf("?") >= 0 ? "&" : "?") + "utc=" + startSeconds + "&lutc=" + endSeconds;
    }
    throw new Error(t("err_catchup"));
  }

  /* =============================  ODTWARZANIE  ============================= */

  /* maskuje login i hasło w adresie, żeby komunikat można było bezpiecznie pokazać */
  function maskUrl(url) {
    return String(url || "")
      .replace(/(\/(?:live|movie|series|timeshift)\/)[^/]+\/[^/]+\//i, "$1****/****/")
      .replace(/(username|password)=([^&]*)/gi, "$1=****");
  }

  /* Diagnostyka błędów <video>: kod błędu + host/adres źródła. Dzięki temu
     komunikat mówi, CZY zawiódł format/dekoder, sieć, czy sam serwer. */
  function playbackDetails() {
    var video = $("video");
    var code = video && video.error ? video.error.code : 0;
    var details = "";
    if (code) {
      var known = { 1: "media_aborted", 2: "media_network", 3: "media_decode", 4: "media_unsupported" }[code];
      details += " (" + t("media_code", { code: code }) + (known ? ": " + t(known) : "") + ")";
    }
    var message = video && video.error && video.error.message;
    if (message) details += " " + String(message).slice(0, 80);

    var shown = maskUrl(state.currentSource);
    if (shown && shown.length > 92) shown = shown.slice(0, 48) + "…" + shown.slice(-40);
    if (shown) details += "\n" + t("media_url") + ": " + shown;

    return details;
  }

  /* Gdy odbiornik nie radzi sobie z surowym .ts (typowe na webOS), ponawiamy
     ten sam kanał raz jako HLS (.m3u8) — panele Xtream oraz część dostawców
     M3U udostępniają ten sam strumień również w HLS. */
  function alternateSource(channel, program, source) {
    if (program || !channel || !source) return "";
    if (!/\.ts(?:\?.*)?$/i.test(source)) return "";
    return source.replace(/\.ts(\?.*)?$/i, ".m3u8$1");
  }

  /* ----------  sesja multimediów: ⏵‖ i ⏹ na pilocie ----------
     Na Androidzie i Fire TV system kieruje przyciski pilota do sesji
     multimediów strony, a nie do zdarzeń klawiatury — bez zarejestrowania
     akcji przycisk play/pauza nie robił nic. Akcje są te same co na pasku
     (pauza / wznowienie / przewijanie), a stan sesji zmienia się razem
     z obrazem, więc pilot widzi, czy kanał gra. */
  var mediaSessionBound = false;

  function updateMediaSession() {
    var session = navigator.mediaSession;
    var video = $("video");
    var inPlayer = !$("playerScreen").classList.contains("hidden");
    if (session) {
      try {
        session.playbackState = inPlayer && video && !video.paused ? "playing" : "paused";
      } catch (error) { /* starsze WebView nie znają stanu sesji */ }
    }
    /* nazwa kanału i programu na wyświetlaczu pilota (AVRCP) */
    if (!session || !inPlayer || !state.watchChannel || typeof window.MediaMetadata !== "function") return;
    try {
      session.metadata = new window.MediaMetadata({
        title: state.watchProgram ? state.watchProgram.title : state.watchChannel.name,
        artist: state.watchChannel.name,
        album: state.watchProgram ? t("catchup") : t("live")
      });
    } catch (error2) { /* bez metadanych przyciski i tak działają */ }
  }

  function bindMediaSession() {
    var session = navigator.mediaSession;
    if (!session || typeof session.setActionHandler !== "function") return;
    if (!mediaSessionBound) {
      mediaSessionBound = true;
      var handlers = {
        play: resumePlayback,
        pause: pausePlayback,
        stop: pausePlayback,
        seekbackward: function () { seekBy(-1); },
        seekforward: function () { seekBy(1); }
      };
      for (var name in handlers) {
        try { session.setActionHandler(name, handlers[name]); } catch (error) { /* brak obsługi */ }
      }
    }
    updateMediaSession();
  }

  function bindVideoEvents(video) {
    video.addEventListener("playing", function () {
      $("playerError").classList.add("hidden");
      clearStartWatchdog();
      /* od tego momentu liczy się czas oglądania dla „Ostatnio oglądane” */
      state.watchStart = state.watchStart || Date.now();
      scheduleRecentRecord();
      clearTimeout(state.stableTimer);
      state.stableTimer = setTimeout(function () {
        var current = $("video");
        if (state.currentSource && current && !current.paused) {
          /* obraz stoi już 10 s — kolejne błędy liczymy od nowa */
          state.retryCount = 0;
          state.cycle = 0;
        }
      }, 10000);
      updateOsd();
      scheduleOsdHide();
      updateMediaSession();
    });

    video.addEventListener("pause", function () {
      markWatchedTime();
      clearTimeout(state.recentTimer);
      updateOsd();
      updateMediaSession();
      /* obraz zatrzymany — pasek informacyjny zostaje na ekranie */
      clearTimeout(state.osdTimer);
      state.osdTimer = null;
    });

    /* buforowanie: pasek mówi wprost, co się dzieje i który silnik pracuje */
    video.addEventListener("waiting", function () {
      if (!state.currentSource) return;
      /* chwilę po przewinięciu dekoder donosi obraz na nową pozycję — to nie
         jest wczytywanie strumienia od zera, więc pasek pokazuje skok
         („Cofnięto o 10 s”), a nie „Ładowanie strumienia…” */
      if (seekNotice()) { showOsd(); return; }
      showPlayerError(t("osd_buffering") + " (" + engineName(state.engine) + ")");
    });

    video.addEventListener("timeupdate", updateOsdProgress);
    video.addEventListener("loadedmetadata", function () {
      /* obraz wczytał metadane — nie ma sensu czekać na kolejny sposób */
      clearStartWatchdog();
      updateOsd();
    });
    video.addEventListener("canplay", clearStartWatchdog);

    video.addEventListener("error", function () {
      markWatchedTime();
      clearTimeout(state.recentTimer);
      /* jeden błąd = jedno przejście do następnego silnika (błąd potrafi dublować) */
      if (Date.now() - state.lastErrorAt < 500) return;
      state.lastErrorAt = Date.now();
      handlePlaybackError(t("err_stream") + playbackDetails());
    });
  }

  /* webOS potrafi „zakleszczyć” pipeline po błędzie — świeży element <video>
     resetuje dekoder, więc ponowienie ma szansę zadziałać. */
  function resetVideoElement() {
    var old = $("video");
    if (!old || !old.parentNode) return old;
    var fresh = document.createElement("video");
    fresh.id = "video";
    fresh.setAttribute("autoplay", "autoplay");
    fresh.playsInline = true;
    bindVideoEvents(fresh);
    old.parentNode.replaceChild(fresh, old);
    return fresh;
  }

  function playSource(source) {
    var video = resetVideoElement();
    if (!video) return;
    video.src = source;
    video.load();
    var promise = video.play();
    if (promise && promise.catch) promise.catch(function () {});
  }

  /* ==================  SILNIKI ODTWARZANIA (natywnie → MSE → HLS)  ==================
     Różne telewizory i przystawki różnie radzą sobie z surowym MPEG-TS:

       • natywnie — sprzętowy dekoder Fire TV / webOS potrafi zagrać .ts wprost,
       • MSE      — gdy nie potrafi, ten sam strumień wciąga mpegts.js (MSE w WebView),
       • HLS      — dostawcy często udostępniają ten sam kanał jako .m3u8 (hls.js).

     Biblioteki leżą w www/lib i wczytują się LENIWIE — dopiero gdy są naprawdę
     potrzebne, więc start aplikacji na to nie płaci. */

  var engineCache = {};

  function loadEngineScript(src) {
    if (engineCache[src]) return engineCache[src];
    engineCache[src] = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        delete engineCache[src];
        reject(new Error(t("err_player_lib", { name: src })));
      };
      (document.head || document.documentElement).appendChild(script);
    });
    return engineCache[src];
  }

  /* zamyka poprzedni silnik (odłącza MSE) — bez tego zostaje drugi dekoder w tle */
  function destroyEngine() {
    var instance = state.engineInstance;
    state.engineInstance = null;
    state.engineLoading = false;
    clearStartWatchdog();
    if (!instance) return;
    try { instance.close(); } catch (error) { /* już zamknięty */ }
  }

  /* Nazwa silnika dla komunikatów o wczytywaniu obrazu. Osobno od engineLabel,
     bo tam „LIVE” opisuje stan obrazu na pasku odtwarzacza, a w komunikacie
     czytało się jak informacja o strumieniu — przy catch-upie wyglądało to,
     jakby aplikacja wczytywała kanał na żywo zamiast nagrania. */
  function engineName(engine) {
    if (engine === "mse") return t("engine_mse");
    if (engine === "hls") return t("engine_hls");
    return t("engine_native");
  }

  function engineLabel(engine) {
    if (engine === "mse") return t("engine_mse");
    if (engine === "hls") return t("engine_hls");
    return t("live");
  }

  /* nowy token unieważnia trwające wczytywanie biblioteki po zmianie kanału */
  function nextEngineToken() {
    state.engineToken = (state.engineToken || 0) + 1;
    return state.engineToken;
  }

  function startMseSource(entry) {
    var token = nextEngineToken();
    state.engine = "mse";
    state.engineLoading = true;
    loadEngineScript("lib/mpegts.min.js").then(function () {
      if (state.engineToken !== token || !state.watchChannel) return;
      if (!window.mpegts || !window.mpegts.isSupported || !window.mpegts.isSupported()) {
        handlePlaybackError(t("err_no_mse"));
        return;
      }
      var video = resetVideoElement();
      if (!video) return;
      var player;
      try {
        player = window.mpegts.createPlayer(
          { type: "mpegts", isLive: !state.watchProgram, url: entry.url },
          {
            enableWorker: true,               /* parsowanie TS poza wątkiem UI */
            lazyLoad: false,
            stashInitialSize: 512,
            enableStashBuffer: false,
            autoCleanupSourceBuffer: true,
            liveBufferLatencyChasing: true,
            liveBufferLatencyMaxLatency: 3.5,
            liveBufferLatencyMinRemain: 0.5
          }
        );
      } catch (createError) {
        /* np. WebView bez MediaSource — od razu przechodzimy dalej */
        handlePlaybackError(t("err_stream") + " (" + engineLabel("mse") + ": " + createError.message + ")");
        return;
      }
      state.engineInstance = {
        kind: "mse",
        close: function () {
          try { player.pause(); } catch (e) {}
          try { player.unload(); } catch (e2) {}
          try { player.detachMediaElement(); } catch (e3) {}
          try { player.destroy(); } catch (e4) {}
        }
      };
      player.on(window.mpegts.Events.ERROR, function (type, detail) {
        handlePlaybackError(t("err_stream") + " (" + engineLabel("mse") + ": " + type + "/" + detail + ")");
      });
      try {
        player.attachMediaElement(video);
        player.load();
        var promise = player.play();
        if (promise && promise.catch) promise.catch(function () {});
      } catch (playError) {
        handlePlaybackError(t("err_stream") + " (" + engineLabel("mse") + ": " + playError.message + ")");
        return;
      }
      state.engineLoading = false;
    }, function (error) {
      if (state.engineToken !== token) return;
      nextSourceEntry(String(error && error.message ? error.message : ""), 1200);
    });
  }

  function startHlsSource(entry) {
    var token = nextEngineToken();
    state.engine = "hls";
    state.engineLoading = true;
    loadEngineScript("lib/hls.min.js").then(function () {
      if (state.engineToken !== token || !state.watchChannel) return;
      var video = resetVideoElement();
      if (!video) return;

      if (!window.Hls || !window.Hls.isSupported()) {
        /* webOS / Safari często grają HLS sprzętowo, bez żadnej biblioteki */
        var nativeHls = video.canPlayType("application/vnd.apple.mpegurl");
        if (nativeHls) {
          state.engine = "native";
          video.src = entry.url;
          video.load();
          var direct = video.play();
          if (direct && direct.catch) direct.catch(function () {});
          state.engineLoading = false;
          return;
        }
        handlePlaybackError(t("err_player_lib", { name: t("engine_hls") }));
        return;
      }

      var hls;
      try {
        hls = new window.Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
      } catch (createError) {
        handlePlaybackError(t("err_stream") + " (" + engineLabel("hls") + ": " + createError.message + ")");
        return;
      }
      state.engineInstance = {
        kind: "hls",
        close: function () {
          try { hls.stopLoad(); } catch (e) {}
          try { hls.detachMedia(); } catch (e2) {}
          try { hls.destroy(); } catch (e3) {}
        }
      };
      hls.on(window.Hls.Events.ERROR, function (event, data) {
        if (!data || !data.fatal) return;
        handlePlaybackError(t("err_stream") + " (" + engineLabel("hls") + ": " + data.type + "/" + data.details + ")");
      });
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () {
        if (state.engineToken !== token) return;
        var promise = video.play();
        if (promise && promise.catch) promise.catch(function () {});
      });
      try {
        hls.loadSource(entry.url);
        hls.attachMedia(video);
      } catch (loadError) {
        handlePlaybackError(t("err_stream") + " (" + engineLabel("hls") + ": " + loadError.message + ")");
        return;
      }
      state.engineLoading = false;
    }, function (error) {
      if (state.engineToken !== token) return;
      nextSourceEntry(String(error && error.message ? error.message : ""), 1200);
    });
  }

  /* Kolejka prób dla kanału. Zawsze najpierw próbujemy sprzętowo (natywnie),
     dopiero potem sięgamy po MSE i HLS. */
  function buildSourceQueue(primaryUrl) {
    var queue = [{ engine: "native", url: primaryUrl }];
    var bare = String(primaryUrl || "").split("#")[0].split("?")[0].toLowerCase();
    var extension = bare.indexOf(".") >= 0 ? bare.substring(bare.lastIndexOf(".") + 1) : "";
    var tsLike =
      !extension ||
      extension === "ts" || extension === "mpegts" || extension === "mts" ||
      extension === "php" || extension === "m3u";
    if (extension === "m3u8") {
      queue.push({ engine: "hls", url: primaryUrl });
    } else if (tsLike) {
      queue.push({ engine: "mse", url: primaryUrl });
    }

    /* ten sam kanał jako HLS — najczęstsza deska ratunku na telewizorach */
    var hlsUrl = primaryUrl.replace(/\.ts(\?.*)?$/i, ".m3u8$1");
    if (hlsUrl !== primaryUrl) {
      queue.push({ engine: "native", url: hlsUrl });
      queue.push({ engine: "hls", url: hlsUrl });
    }
    return queue;
  }

  function startSourceEntry(entry) {
    if (!entry || !state.watchChannel) return;
    state.currentSource = entry.url;
    state.engine = entry.engine;
    armStartWatchdog();
    if (entry.engine === "mse") startMseSource(entry);
    else if (entry.engine === "hls") startHlsSource(entry);
    else playSource(entry.url);
  }

  /* Nie każdy telewizor zgłasza błąd odtwarzania — czasem <video> po prostu
     „wisi” na czarnym ekranie. Ten budzik pilnuje, żeby brak obrazu w ciągu
     START_TIMEOUT ms przełączył kolejkę na następny sposób odtwarzania. */
  function armStartWatchdog() {
    clearTimeout(state.startTimer);
    var token = state.engineToken;
    state.startTimer = setTimeout(function () {
      state.startTimer = null;
      if (!state.watchChannel || state.engineToken !== token) return;
      var video = $("video");
      if (video && video.readyState >= 2 && !video.paused) return;   /* obraz jest */
      nextSourceEntry(t("err_stream") + " (" + t("osd_buffering") + ")", 0);
    }, START_TIMEOUT);
  }

  function clearStartWatchdog() {
    clearTimeout(state.startTimer);
    state.startTimer = null;
  }

  /* Przejście do następnego sposobu odtwarzania. Po wyczerpaniu całej listy
     rusza kolejna runda prób (ustawienie „Próby ponownego uruchomienia”), więc
     kanał ma realną szansę podnieść się po chwilowym błędzie serwera. */
  function nextSourceEntry(message, delay, silent) {
    if (!state.watchChannel) return;
    var attempts = parseInt(settings.retryAttempts, 10) || 0;

    state.sourceIndex++;
    if (state.sourceIndex >= state.sources.length) {
      state.sourceIndex = 0;
      state.cycle++;
    }
    if (state.cycle > attempts) {
      showPlayerError(
        (message ? message + "\n" : "") +
        (attempts ? t("retry_fail", { total: attempts }) : t("retry_off")) +
        "\n" + t("back_hint")
      );
      return;
    }

    var entry = state.sources[state.sourceIndex];
    if (!entry) return;

    if (!silent) {
      var lines = [];
      if (message) lines.push(message);
      if (entry.engine === "mse") lines.push(t("retry_engine_mse"));
      else if (entry.engine === "hls") lines.push(t("retry_engine_hls"));
      else lines.push(t("osd_buffering"));
      if (state.cycle > 0) lines.push(t("retry_msg", { n: state.cycle, total: attempts }));
      showPlayerError(lines.join("\n"));
    }

    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(function () {
      state.retryTimer = null;
      if (!state.watchChannel) return;
      startSourceEntry(entry);
    }, delay || 0);
  }

  /* ================  „OSTATNIO OGLĄDANE” (10 s / maks. 15 kanałów)  ================ */

  /* nowy kanał do obserwacji — licznik oglądania startuje od zera */
  function startRecentWatch(channel) {
    clearTimeout(state.recentTimer);
    state.recentTimer = null;
    state.recentChannel = channel || null;
    state.watchedMs = 0;
    state.watchStart = 0;
    state.recentRecorded = false;
  }

  /* dolicza realny czas odtwarzania (pauza i buforowanie się nie liczą) */
  function markWatchedTime() {
    if (state.recentChannel && state.watchStart) {
      state.watchedMs += Date.now() - state.watchStart;
      state.watchStart = 0;
    }
  }

  function scheduleRecentRecord() {
    if (!state.recentChannel || state.recentRecorded) return;
    clearTimeout(state.recentTimer);
    var left = Math.max(0, RECENT_DELAY - state.watchedMs);
    state.recentTimer = setTimeout(function () {
      if (!state.recentChannel || !state.currentSource) return;
      state.recentRecorded = true;
      addRecent(state.recentChannel);
    }, left);
  }

  /* wpis na początek listy, bez duplikatów i z limitem 15 pozycji —
     kanał, który wypadł poza 15 ostatnich, znika z tej listy */
  function addRecent(channel) {
    if (!channel) return;
    var recents = perProfile(settings.recentChannels);
    var key = keyOf(channel);
    var index = recents.indexOf(key);
    if (index >= 0) recents.splice(index, 1);
    recents.unshift(key);
    if (recents.length > RECENT_LIMIT) recents.splice(RECENT_LIMIT);
    saveSettings();
    state.recentDirty = true;
  }

  function playChannel(channel, program, returnScreen) {
    clearTimeout(state.retryTimer);
    clearTimeout(state.stableTimer);
    /* kanał trafi na listę „Ostatnio oglądane” dopiero po 10 s oglądania */
    startRecentWatch(channel);

    /* Ekran, do którego wraca „Wstecz” po wyjściu z obrazu. Akcje wykonywane
       wewnątrz odtwarzacza (następny program, „od początku”, „na żywo”,
       wznowienie) podają jako cel playerScreen — to nie jest miejsce, do
       którego można wrócić po zatrzymaniu kanału: nie ma tam już czego
       odtwarzać i zostawał czarny prostokąt bez obrazu i bez paska.
       Dlatego taki cel zachowuje poprzednią wartość (lista kanałów). */
    if (returnScreen && returnScreen !== "playerScreen") state.playerReturn = returnScreen;
    else if (!state.playerReturn) state.playerReturn = "browserScreen";
    state.isArchive = !!program;
    state.retryCount = 0;
    state.cycle = 0;
    state.sourceIndex = -1;          /* -1 → pierwszy wpis wybierze nextSourceEntry() */
    state.watchChannel = channel;
    state.watchProgram = program || null;
    /* nowy kanał (albo nowe okno archiwum) = poprzednia pauza na żywo nie
       obowiązuje — inaczej „wznów” wróciłoby do starego kanału */
    state.livePauseAt = 0;
    state.lastErrorAt = 0;
    /* nowy obraz nie jest przewinięciem: kasujemy wpis o poprzednim skoku, żeby
       „waiting” przy wczytywaniu nie pokazał go na cudzym kanale */
    clearSeekMark();
    destroyEngine();

    var source;
    try {
      source = program
        ? buildCatchupUrl(channel, program.start, Math.min(program.end, Date.now()))
        : channel.streamUrl;
    } catch (error) {
      alert(error.message);
      return;
    }
    source = String(source).split("|")[0];
    /* kolejka prób: natywnie → MSE (mpegts.js) → HLS (hls.js) */
    state.sources = buildSourceQueue(source);

    showScreen("playerScreen");
    $("playerError").classList.add("hidden");
    /* klawisze ⏵‖ / ⏹ pilota: system kieruje je do sesji multimediów */
    bindMediaSession();
    var badge = $("playerBadge");
    badge.textContent = program ? t("catchup") : t("live");
    badge.classList.toggle("archive", !!program);
    buildOsdActions();
    updateOsd();
    if (settings.osdEnabled !== false) showOsd();

    nextSourceEntry("", 0, true);
  }

  /* ▲ / ▼ (oraz CH+ / CH− na pilocie) w odtwarzaczu: kanał wyżej albo niżej na
     tej samej liście, którą widzi użytkownik (kategoria i wyszukiwanie), z
     zawijaniem na końcach. Kanał oglądany z EPG innej kategorii szukamy w całej
     playliście, żeby przełączanie nigdy nie „nie działało”. */
  function zapChannel(direction) {
    var channel = state.watchChannel;
    if (!channel) return;

    var list = state.listItems && state.listItems.length ? state.listItems : state.channels;
    var index = listIndex(list, channel);
    if (index < 0) {
      list = state.channels;
      index = listIndex(list, channel);
    }
    if (index < 0 || list.length < 2) return;

    var next = list[(index + direction + list.length) % list.length];
    if (!next) return;
    /* nowy kanał startuje na żywo — tak jak przy przełączaniu z listy */
    playChannel(next, null, "playerScreen");
  }

  function listIndex(list, channel) {
    var key = keyOf(channel);
    for (var i = 0; i < list.length; i++) {
      if (keyOf(list[i]) === key) return i;
    }
    return -1;
  }

  function showPlayerError(message) {
    $("playerError").textContent = message;
    $("playerError").classList.remove("hidden");
  }

  /* Błąd odtwarzania: zamykamy bieżący silnik i przechodzimy do następnego
     sposobu (natywnie → MSE → HLS), a po wyczerpaniu listy — kolejna runda
     prób wg ustawień. Cały łańcuch pilnuje nextSourceEntry(). */
  function handlePlaybackError(message) {
    if (!state.currentSource) return;
    clearTimeout(state.stableTimer);
    clearTimeout(state.retryTimer);
    destroyEngine();
    nextSourceEntry(message, 900);
  }

  function stopPlayback() {
    var video = $("video");
    clearTimeout(state.retryTimer);
    clearTimeout(state.stableTimer);
    clearTimeout(state.recentTimer);
    clearTimeout(state.okHoldTimer);
    clearTimeout(state.osdTimer);
    clearInterval(state.osdTicker);
    state.retryTimer = null;
    state.stableTimer = null;
    state.recentTimer = null;
    state.okHoldTimer = null;
    state.osdTimer = null;
    state.osdTicker = null;
    markWatchedTime();
    state.recentChannel = null;
    state.currentSource = "";
    state.altSource = "";
    state.sources = [];
    state.sourceIndex = 0;
    state.cycle = 0;
    state.watchChannel = null;
    state.watchProgram = null;
    /* wpis o przewinięciu dotyczył zamkniętego obrazu — na pasku nie ma czego
       pokazywać, gdy kanał zostanie włączony ponownie */
    clearSeekMark();
    state.livePauseAt = 0;
    /* unieważnia spóźnione wczytywanie biblioteki po wyjściu z kanału */
    nextEngineToken();
    destroyEngine();
    hideContextMenu();
    hideExitDialog();
    hideOsd();
    video.pause();
    video.removeAttribute("src");
    video.load();
    /* Zabezpieczenie: ekran odtwarzacza bez kanału to czarny prostokąt, więc
       nigdy nie wracamy na niego po zatrzymaniu obrazu. */
    var target = state.playerReturn && state.playerReturn !== "playerScreen"
      ? state.playerReturn
      : "browserScreen";
    showScreen(target);
    /* sesja multimediów gaśnie razem z obrazem, żeby pilot nie pauzował
       odtwarzacza, którego już nie ma */
    updateMediaSession();
  }

  /* Krok przewijania z ustawień („Krok przewijania archiwum”: 5 / 10 / 30 s) */
  function seekStep() {
    var step = parseInt(settings.seekSeconds, 10);
    return step > 0 ? step : 10;
  }

  /* ---------  ŚLAD PRZEWINIĘCIA („Cofnięto o 10 s” / „Przesunięto o +10 s”)  ---------
     Po skoku w archiwum dekoder musi donieść obraz na nową pozycję i zgłasza
     wtedy „waiting” — identycznie jak przy wczytywaniu strumienia od zera, więc
     pasek pisał „Ładowanie strumienia…”. Przez chwilę po skoku pamiętamy więc
     kierunek i krok i to nimi opisujemy oczekiwanie na obraz. Skoki w tę samą
     stronę doliczają się do jednego wpisu, bo tak się je robi pilotem: kilka
     naciśnięć pod rząd to jeden skok o kilka kroków. */

  var SEEK_GRACE = 6000;

  function markSeek(direction, seconds) {
    /* Kolejne naciśnięcia pilota sumujemy: pięć ⏩ pod rząd to „Przesunięto
       o +50 s”, a nie pięć razy „o +10 s”. Skok w tę samą stronę dolicza się,
       dopóki poprzedni wpis jest jeszcze na pasku (czyli przez SEEK_GRACE od
       ostatniego skoku); zmiana kierunku albo przerwa zaczyna liczenie od nowa. */
    var now = Date.now();
    var same = state.seekAt && state.seekDirection === direction &&
      now - state.seekAt <= SEEK_GRACE;
    state.seekSize = (same ? state.seekSize : 0) + seconds;
    state.seekAt = now;
    state.seekDirection = direction;
    refreshSeekNotice();
  }

  /* nowe okno obrazu (kanał, program, „na żywo”) nie jest przewijaniem — wpis
     o poprzednim skoku nie może zostać na pasku */
  function clearSeekMark() {
    state.seekAt = 0;
    state.seekDirection = 0;
    state.seekSize = 0;
  }

  /* tekst skoku dla paska; pusty, gdy od przewinięcia minęło już SEEK_GRACE */
  function seekNotice() {
    if (!state.seekAt || Date.now() - state.seekAt > SEEK_GRACE) return "";
    return t(state.seekDirection < 0 ? "seek_back" : "seek_forward", { s: state.seekSize });
  }

  function refreshSeekNotice() {
    var el = $("playerSeek");
    if (!el) return;
    var text = seekNotice();
    el.textContent = text;
    if (text) el.classList.remove("hidden");
    else el.classList.add("hidden");
  }

  /* Czy odtwarzane okno archiwum kończy się na „teraz”? Tak jest w timeshicie
     (patrz timeshiftBack) i wtedy, gdy otworzyliśmy program, który wciąż leci —
     w obu wypadkach „do przodu” na końcu okna znaczy „na żywo”. */
  function atLiveEdge() {
    var program = state.watchProgram;
    if (!program) return false;
    return !!program.timeshift || program.end > Date.now();
  }

  /* Przewijanie pilota (⏪/⏩): po nagraniu skaczemy o krok z ustawień, a gdy
     w oknie kończącym się na „teraz” nie ma już czego przewijać — ⏩ wraca na
     żywo, a ⏪ wczytuje dłuższe okno catch-up. Na samym kanale na żywo ⏪
     wchodzi w catch-up, a ⏩ tylko przywołuje pasek z informacją. */
  function seekBy(direction) {
    var video = $("video");
    if (!video) return;

    var step = seekStep();

    /* kanał na żywo: ◀ wchodzi w catch-up o krok, ▶ na zatrzymanym obrazie
       po prostu wznawia (od miejsca pauzy), a na lecącym nie ma czego
       przewijać — zostaje pasek z informacją */
    if (!state.isArchive) {
      if (direction < 0) timeshiftBack();
      else if (video.paused) resumePlayback();
      else showOsd();
      return;
    }

    /* nagranie, którego długości odtwarzacz nie zna — nie ma po czym skakać,
       zostaje tylko zmiana okna: dłużej wstecz albo powrót na żywo */
    if (!isFinite(video.duration)) {
      if (atLiveEdge()) {
        if (direction < 0) timeshiftBack();
        else goLive();
      } else {
        showOsd();
      }
      return;
    }

    /* koniec okna programu, który wciąż leci = powrót na żywo */
    if (direction > 0 && atLiveEdge() && video.currentTime + step >= video.duration - 0.5) {
      goLive();
      return;
    }

    /* za mało miejsca na pełny krok w tył = sięgnij po dłuższe okno catch-up */
    if (direction < 0 && atLiveEdge() && video.currentTime < step) {
      timeshiftBack();
      return;
    }

    var before = video.currentTime;
    video.currentTime = Math.max(0, Math.min(video.duration, before + direction * step));
    $("playerProgress").style.width = (video.currentTime / video.duration) * 100 + "%";
    $("playerTime").textContent = formatTime(video.currentTime) + " / " + formatTime(video.duration);
    /* ile obrazu naprawdę przybyło: na krawędzi nagrania skok bywa mniejszy od
       kroku (albo zerowy) — wtedy pasek nie pisze o ruchu, którego nie było */
    var moved = Math.round(video.currentTime) - Math.round(before);
    if (moved) markSeek(moved < 0 ? -1 : 1, Math.abs(moved));
    showSeekOverlay();
  }

  /* pasek z czasem na chwilę po skoku — jak przy przewijaniu nagrania */
  function showSeekOverlay() {
    $("playerOverlay").classList.remove("hidden");
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(function () {
      $("playerOverlay").classList.add("hidden");
    }, 1800);
  }

  /* ⏪ na kanale na żywo (i cofanie dalej w tył): strumienia na żywo nie da się
     przewinąć, więc wchodzimy w catch-up okna kończącego się TERAZ — odtwarzanie
     startuje w punkcie „teraz − krok”. Okno kończy się na chwili włączenia, więc
     jego długość to nasze opóźnienie; kolejne ⏪ na początku okna wydłużają je
     wstecz, dzięki czemu cofać można się dowolnie daleko — na miarę archiwum
     dostawcy. ⏩ na końcu takiego okna wraca na żywo (patrz atLiveEdge). */
  function timeshiftBack() {
    var channel = state.watchChannel;
    if (!channel) return;

    if (!hasArchive(channel)) {
      showPlayerError(t("err_catchup"));
      scheduleOsdHide();
      return;
    }

    var video = $("video");
    var behind = state.isArchive && video && isFinite(video.duration)
      ? Math.ceil(video.duration)
      : 0;
    var now = Date.now();
    /* wstrzymany kanał na żywo: cofamy się od miejsca zatrzymania, a nie od
       „teraz” — inaczej ◀ po pauzie przeniosłoby obraz do przodu */
    if (state.livePauseAt) {
      behind = Math.max(behind, Math.round((now - state.livePauseAt) / 1000));
    }
    var program = currentProgram(channel);

    playChannel(channel, {
      start: now - (behind + seekStep()) * 1000,
      end: now,
      title: program ? program.title : channel.name,
      timeshift: true
    }, "playerScreen");
    /* świeżo wczytane okno też donosi obraz — pasek mówi wprost, że to cofnięcie,
       a nie wczytywanie strumienia od zera */
    markSeek(-1, seekStep());
  }

  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    var rest = seconds % 60;
    return (hours ? hours + ":" : "") +
      (minutes < 10 ? "0" : "") + minutes + ":" +
      (rest < 10 ? "0" : "") + rest;
  }

  /* -------------------------  PRZEWIJANIE EKRANU  --------------------------
     Fokus ma zostać na ekranie, ale nie przy samej krawędzi. Wcześniej
     `scrollIntoView(false)` wyrównywał sfokusowany element do dolnej krawędzi,
     więc każdy krok pilota robił duży, nierówny skok („po schodkach”), a
     wszystko pod przyciskiem — opis zmian, „Zapisz i pobierz” — zostawało poza
     ekranem. Tutaj dosuwamy ekran tylko wtedy, gdy element nie mieści się w
     marginesie, i tylko o tyle, ile trzeba, żeby widać było sąsiednie wiersze. */

  /* Najbliższy przodek, który naprawdę się przewija. Bez tego scrollIntoView
     przesuwa dokument, a ten jest przyklejony do ekranu (html, body — hidden). */
  function scrollParent(element) {
    var node = element && element.parentNode;
    while (node && node.nodeType === 1) {
      var style = (typeof window !== "undefined" && window.getComputedStyle)
        ? window.getComputedStyle(node) : null;
      var overflow = style ? style.overflowY : "";
      if ((overflow === "auto" || overflow === "scroll") &&
          node.scrollHeight > node.clientHeight + 1) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  function keepInView(element) {
    if (!element || !element.getBoundingClientRect) return;
    var parent = scrollParent(element);
    if (!parent) return;

    /* Zapas wokół sfokusowanego elementu (mniejszy na wąskim ekranie). */
    var view = parent.getBoundingClientRect();
    var marginY = Math.max(80, Math.min(200, Math.round(view.height * 0.25)));
    var marginX = Math.max(40, Math.min(120, Math.round(view.width * 0.08)));
    var box = element.getBoundingClientRect();
    var down = 0;
    var across = 0;

    if (box.bottom + marginY > view.bottom) down = box.bottom + marginY - view.bottom;
    else if (box.top - marginY < view.top) down = box.top - marginY - view.top;

    if (box.right + marginX > view.right) across = box.right + marginX - view.right;
    else if (box.left - marginX < view.left) across = box.left - marginX - view.left;

    /* Przeglądarka sama przycina przewijanie do zakresu, więc ostatni element
       formularza nadal da się pokazać — tyle że nie przy samej krawędzi. */
    if (down) parent.scrollTop += down;
    if (across) parent.scrollLeft += across;

    /* Zapamiętane miejsce fokusu musi być aktualne po dosunięciu ekranu. */
    if ((down || across) && focusAnchor && focusAnchor.el === element) {
      focusAnchor = { el: element, box: element.getBoundingClientRect() };
    }
  }

  /* nawigacja pilotem: wybiera najbliższy element w kierunku strzałki */
  function focusNearest(keyCode) {
    var current = document.activeElement;
    var all = document.querySelectorAll('button,input,select,[tabindex="0"]');
    var candidates = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null && !all[i].disabled) candidates.push(all[i]);
    }
    if (!candidates.length) return;

    /* Punkt odniesienia: sfokusowany element. Gdy fokus zniknął, bo przycisk
       został wyłączony albo ukryty (tak działo się z „Pobierz i zainstaluj”
       po ruszeniu pobierania), liczymy od jego ostatniego miejsca na ekranie —
       inaczej nawigacja wracała na sam początek ustawień i nie było jak
       zjechać do opisu zmian ani do „Zapisz i pobierz”. */
    var box = null;
    if (current && candidates.indexOf(current) >= 0) {
      box = current.getBoundingClientRect();
    } else if (focusAnchor && focusAnchor.el && focusAnchor.el.parentNode &&
               (focusAnchor.el.disabled || focusAnchor.el.offsetParent === null)) {
      box = focusAnchor.box;
    }

    if (!box || (!box.width && !box.height)) {
      candidates[0].focus();
      keepInView(candidates[0]);
      return;
    }

    var cx = box.left + box.width / 2;
    var cy = box.top + box.height / 2;
    var best = null;
    var bestScore = Infinity;

    for (var j = 0; j < candidates.length; j++) {
      if (candidates[j] === current) continue;
      var rect = candidates[j].getBoundingClientRect();
      var rx = rect.left + rect.width / 2;
      var ry = rect.top + rect.height / 2;
      var forward, lateral;
      if (keyCode === 37) {
        forward = cx - rx;
        lateral = Math.abs(cy - ry);
      } else if (keyCode === 39) {
        forward = rx - cx;
        lateral = Math.abs(cy - ry);
      } else if (keyCode === 38) {
        forward = cy - ry;
        lateral = Math.abs(cx - rx);
      } else {
        forward = ry - cy;
        lateral = Math.abs(cx - rx);
      }
      if (forward <= 2) continue;
      var score = forward + 2.5 * lateral;
      if (score < bestScore) {
        bestScore = score;
        best = candidates[j];
      }
    }

    if (best) {
      best.focus();
      keepInView(best);
    }
  }

  /* ---------------------  STRZAŁKI W POLU SZUKANIA  ---------------------
     Pole tekstowe zjada strzałki (przesuwa w nim kursor), a pilot nie ma
     Tab — bez tego z szukania nie dało się wyjść: ani do listy grup, ani do
     kanałów. Dlatego: ▼ prowadzi do listy kanałów, ◀ zabiera tekst dopiero
     wtedy, gdy kursor stoi na jego początku (inaczej nie dałoby się poprawić
     zapytania), a ▶ przy końcu tekstu przechodzi do następnego pola paska. */
  function searchArrowTarget(keyCode, caretAtStart, caretAtEnd) {
    if (keyCode === 40) return "channels";
    if (keyCode === 37 && caretAtStart) return "categories";
    if (keyCode === 39 && caretAtEnd) return "bar";
    return "";
  }

  /* po wybraniu grupy (OK / klik) w trybie TV wchodzimy od razu w jej kanały */
  function nextFocusAfterGroup(tvMode) {
    return tvMode ? "channels" : "";
  }

  function focusActiveCategory() {
    var target = document.querySelector(".category.active") || document.querySelector(".category");
    if (target && target.focus) {
      try { target.focus(); } catch (error) { /* bez fokusu też da się kliknąć */ }
    }
  }

  function focusChannelEntry() {
    var container = $("channels");
    var card = container && container.querySelector
      ? (container.querySelector(".channel-main") || container.querySelector(".channel"))
      : null;
    if (card && card.focus) {
      try { card.focus(); } catch (error) { /* bez fokusu też da się kliknąć */ }
      return true;
    }
    focusNearest(40);
    return false;
  }

  /* Pola tekstowe nie dostają fokusu przy wejściu na ekran: na telewizorze
     wyskakiwałaby z nich klawiatura ekranowa (po zapisaniu ustawień lista
     kanałów od razu wpadała w tryb szukania), a na telefonie zasłaniałaby
     połowę listy. */
  function isTextField(element) {
    if (!element || element.tagName !== "INPUT") return false;
    var type = String(element.getAttribute("type") || "text").toLowerCase();
    return type !== "checkbox" && type !== "radio" && type !== "button" &&
      type !== "submit" && type !== "range";
  }

  /* na co ma stanąć fokus po pokazaniu ekranu: lista kanałów zaczyna na
     kategorii (z niej ▼ / ▶ prowadzą do kanałów), inne ekrany — jak dotąd,
     z pominięciem pól tekstowych */
  function entryFocusTarget(screen) {
    if (!screen) return null;
    if (screen.id === "browserScreen" && screen.querySelector) {
      var active = screen.querySelector(".category.active") || screen.querySelector(".category");
      if (active) return active;
    }
    if (!screen.querySelectorAll) return null;
    var all = screen.querySelectorAll('[tabindex="0"],button,input,select');
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent === null) continue;
      if (isTextField(all[i])) continue;
      return all[i];
    }
    return null;
  }

  /* Ruch pilotem po siatce EPG: ▲ / ▼ przeskakują do najbliższego programu w
     sąsiednim wierszu (kanale) — fokus trzyma się kolumny czasu. ◀ / ▶ nadal
     przewijają całą oś, a OK uruchamia program albo catch-up. */
  function focusGuide(keyCode) {
    var grid = $("guideGrid");
    if (!grid) return;

    var current = document.activeElement;
    var inGrid = !!(current && current.classList && current.classList.contains("guide-program"));

    if (!inGrid) {
      /* wejście w siatkę z nagłówka: pierwszy dostępny program pierwszego kanału */
      var first = grid.querySelector(".guide-program:not([disabled])");
      if (first) {
        first.focus();
        first.scrollIntoView(false);
      }
      return;
    }

    var blocks = grid.querySelectorAll(".guide-program");
    var box = current.getBoundingClientRect();
    var cx = box.left + box.width / 2;
    var cy = box.top + box.height / 2;
    var best = null;
    var bestScore = Infinity;

    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block === current || block.disabled) continue;
      var rect = block.getBoundingClientRect();
      var ry = rect.top + rect.height / 2;
      var forward = keyCode === 38 ? cy - ry : ry - cy;
      if (forward <= 2) continue;
      var lateral = Math.abs(cx - (rect.left + rect.width / 2));
      var score = forward + 2.5 * lateral;
      if (score < bestScore) {
        bestScore = score;
        best = block;
      }
    }

    if (best) {
      best.focus();
      best.scrollIntoView(false);
    }
  }

  /* ==============================  PROGRAM TV  ============================== */

  function guideChannels() {
    var name = state.selectedGroup;
    return state.channels.filter(function (channel) {
      if (name === "@all") return true;
      if (name === "@favorites") return isFavorite(channel);
      if (name === "@recent") {
        return perProfile(settings.recentChannels).indexOf(keyOf(channel)) >= 0;
      }
      return channel.group === name;
    });
  }

  /* Program TV. Bez argumentów pokazuje całą kategorię; z kanałem (otwarcie
     z paska odtwarzacza) staje na oglądanym kanale i wraca potem do obrazu. */
  function openGuide(options) {
    var opts = options || {};
    var now = Date.now();
    guide.windowStart = now - (now % 3600000) - 3600000;
    guide.focusKey = opts.channel ? keyOf(opts.channel) : "";
    guide.returnTo = opts.returnTo || "browserScreen";
    renderGuide();
    showScreen("guideScreen");
    focusGuideWatched();
    /* linia bieżącej godziny rysuje się dopiero na widocznej siatce (wtedy da
       się zmierzyć kolumnę z nazwami kanałów) i sama idzie dalej */
    updateGuideNowLine();
    startGuideNowLine();
  }

  /* powrót z programu TV tam, skąd przyszedł: do odtwarzacza albo do listy */
  function closeGuide() {
    var target = guide.returnTo === "playerScreen" ? "playerScreen" : "browserScreen";
    guide.focusKey = "";
    guide.returnTo = "browserScreen";
    stopGuideNowLine();
    showScreen(target);
  }

  /* przewijanie o cały dzień — zachowuje wybraną godzinę */
  function guideShiftDays(dir) {
    guide.windowStart += dir * 24 * 3600000;
    renderGuide();
  }

  /* Przewijanie osi czasu o godzinę (◀ ▶) — działa w obie strony bez żadnego
     ograniczenia. Wcześniej strzałki tylko przenosiły fokus między programami
     i „zatykały się” na skraju widocznego zakresu, więc nie dało się cofnąć
     dalej niż jedno okno (3 godziny). */
  function guidePan(hours) {
    var active = document.activeElement;
    var currentRow = active && active.closest ? active.closest(".guide-row") : null;
    var rowIndex = -1;
    if (currentRow && currentRow.parentNode) {
      rowIndex = Array.prototype.indexOf.call(
        currentRow.parentNode.querySelectorAll(".guide-row"),
        currentRow
      );
    }

    guide.windowStart += hours * 3600000;
    guide.windowStart -= guide.windowStart % 3600000;
    renderGuide();

    /* fokus zostaje na tym samym kanale (wiersz), o ile ten istnieje */
    if (rowIndex >= 0) {
      var rows = $("guideGrid").querySelectorAll(".guide-row");
      var targetRow = rows[Math.min(rowIndex, rows.length - 1)];
      var block = targetRow && targetRow.querySelector(".guide-program:not([disabled])");
      if (block) block.focus();
      else $("guideGrid").scrollLeft = 0;
    }
  }

  /* skok do dnia względem dziś (0 = dziś, -1 = wczoraj, -2 = przedwczoraj)
     z zachowaniem aktualnie ustawionej godziny */
  function guideGoToDayOffset(offset) {
    var now = new Date();
    var hour = new Date(guide.windowStart).getHours();
    var target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour, 0, 0, 0);
    guide.windowStart = target.getTime();
    renderGuide();
  }

  function guideGoToday() {
    var now = Date.now();
    guide.windowStart = now - (now % 3600000) - 3600000;
    renderGuide();
  }

  function guideGoToDate(dateStr) {
    var m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return;
    var d = new Date(guide.windowStart);
    d.setFullYear(+m[1], +m[2] - 1, +m[3]);
    guide.windowStart = d.getTime() - (d.getTime() % 3600000);
    renderGuide();
  }

  function guideGoToTime(timeStr) {
    var m = String(timeStr || "").match(/^(\d{2}):(\d{2})/);
    if (!m) return;
    var d = new Date(guide.windowStart);
    d.setHours(+m[1], +m[2] || 0, 0, 0);
    guide.windowStart = d.getTime();
    renderGuide();
  }

  function renderGuide() {
    var start = guide.windowStart;
    var end = start + guide.hours * 3600000;
    var container = $("guideGrid");
    container.textContent = "";

    /* oś czasu */
    var axis = document.createElement("div");
    axis.className = "guide-axis";
    var corner = document.createElement("div");
    corner.className = "guide-corner";
    axis.appendChild(corner);
    for (var h = 0; h < guide.hours; h++) {
      var cell = document.createElement("div");
      cell.className = "guide-hour";
      cell.style.width = guide.hourWidth + "px";
      var hourDate = new Date(start + h * 3600000);
      cell.textContent = pad2(hourDate.getHours()) + ":00";
      axis.appendChild(cell);
    }
    container.appendChild(axis);

    var now = Date.now();
    var rows = guideChannels();
    var hiddenRows = Math.max(0, rows.length - GUIDE_ROWS);
    /* EPG otwarte z odtwarzacza: oglądany kanał musi być w siatce, nawet gdy
       leży daleko na liście — inaczej trzeba by go szukać pilotem */
    var first = 0;
    if (guide.focusKey) {
      for (var f = 0; f < rows.length; f++) {
        if (keyOf(rows[f]) === guide.focusKey) {
          if (f >= GUIDE_ROWS) first = f - 3;
          break;
        }
      }
    }
    /* Wiersze siedzą we wspólnym pudełku: tylko wtedy da się poprowadzić przez
       wszystkie kanały jedną pionową linię bieżącej godziny. */
    var rowsWrap = document.createElement("div");
    rowsWrap.className = "guide-rows";

    rows.slice(first, first + GUIDE_ROWS).forEach(function (channel) {
      var row = document.createElement("div");
      row.className = "guide-row";
      row.setAttribute("data-key", keyOf(channel));
      if (guide.focusKey && keyOf(channel) === guide.focusKey) row.classList.add("watching");

      var name = document.createElement("div");
      name.className = "guide-channel";
      var nm = document.createElement("span");
      nm.textContent = channel.name;
      name.appendChild(nm);
      row.appendChild(name);

      var lane = document.createElement("div");
      lane.className = "guide-lane";
      lane.style.width = (guide.hours * guide.hourWidth) + "px";

      var canCatchup = hasArchive(channel);
      programsFor(channel).filter(function (p) {
        return p.end > start && p.start < end;
      }).forEach(function (p) {
        var block = document.createElement("button");
        block.className = "guide-program";
        var s = Math.max(p.start, start);
        var e = Math.min(p.end, end);
        block.style.left = ((s - start) / 3600000 * guide.hourWidth) + "px";
        block.style.width = Math.max(44, ((e - s) / 3600000 * guide.hourWidth) - 6) + "px";

        var isPast = p.end <= now;
        var isNow = p.start <= now && now < p.end;
        block.classList.toggle("past", isPast);
        block.classList.toggle("now", isNow);
        if (p.start > now || (isPast && !canCatchup)) block.disabled = true;

        var tm = document.createElement("time");
        tm.textContent = pad2(new Date(p.start).getHours()) + ":" + pad2(new Date(p.start).getMinutes());
        block.appendChild(tm);
        var titleRow = document.createElement("div");
        titleRow.className = "guide-title-row";
        var lab = document.createElement("span");
        lab.textContent = p.title;
        titleRow.appendChild(lab);
        /* program, który leci teraz, dostaje podpis „LIVE” */
        if (isNow) {
          var live = document.createElement("em");
          live.className = "guide-live";
          live.textContent = t("live");
          titleRow.appendChild(live);
        }
        block.appendChild(titleRow);

        block.onclick = function () {
          if (isNow) playChannel(channel, null, "guideScreen");
          else if (isPast && canCatchup) playChannel(channel, p, "guideScreen");
        };
        lane.appendChild(block);
      });
      row.appendChild(lane);
      rowsWrap.appendChild(row);
    });
    container.appendChild(rowsWrap);

    /* linia bieżącej godziny — nad wierszami, więc przechodzi przez całą
       wysokość siatki, a podpis u góry pokazuje aktualną godzinę */
    var line = document.createElement("div");
    line.className = "guide-nowline";
    line.id = "guideNowLine";
    var chip = document.createElement("b");
    chip.className = "guide-nowline-label";
    line.appendChild(chip);
    rowsWrap.appendChild(line);
    updateGuideNowLine();

    var from = new Date(start);
    var to = new Date(end);
    $("guideRange").textContent =
      pad2(from.getDate()) + "." + pad2(from.getMonth() + 1) + "  " +
      pad2(from.getHours()) + ":00 – " + pad2(to.getHours()) + ":00" +
      (hiddenRows ? " • " + t("guide_limited", { shown: GUIDE_ROWS, total: rows.length }) : "");

    var dateEl = $("guideDate");
    var ds = from.getFullYear() + "-" + pad2(from.getMonth() + 1) + "-" + pad2(from.getDate());
    if (dateEl && dateEl.value !== ds) dateEl.value = ds;
    var timeEl = $("guideTime");
    var ts = pad2(from.getHours()) + ":" + pad2(from.getMinutes());
    if (timeEl && timeEl.value !== ts) timeEl.value = ts;
  }

  /* Fokus (i przewinięcie siatki) na oglądanym kanale — EPG otwarte z paska
     odtwarzacza od razu pokazuje, co leci teraz na tym kanale. */
  function focusGuideWatched() {
    var grid = $("guideGrid");
    if (!grid || !guide.focusKey) return;
    var rows = grid.querySelectorAll(".guide-row");
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute("data-key") !== guide.focusKey) continue;
      var block = rows[i].querySelector(".guide-program.now:not([disabled])") ||
        rows[i].querySelector(".guide-program:not([disabled])");
      if (block) {
        try { block.focus(); } catch (error) { /* bez fokusu też da się kliknąć */ }
        try { block.scrollIntoView({ block: "nearest", inline: "center" }); }
        catch (error2) { block.scrollIntoView(false); }
      }
      return;
    }
  }

  /* =====================  LINIA BIEŻĄCEJ GODZINY (EPG)  =====================
     Pionowa linia przez całą siatkę pokazuje, gdzie na osi czasu jesteśmy
     teraz — jednym rzutem oka widać, co leci, a co da się jeszcze cofnąć
     z archiwum. Podpis u góry osi to aktualna godzina. Linia odświeża się
     sama, dopóki program TV jest otwarty (patrz startGuideNowLine). */

  function updateGuideNowLine() {
    var line = $("guideNowLine");
    if (!line) return;

    var start = guide.windowStart;
    var now = Date.now();
    /* inny dzień niż dzisiejszy: bieżącej godziny nie ma na osi, linia znika */
    if (now < start || now > start + guide.hours * 3600000) {
      line.classList.add("hidden");
      return;
    }
    line.classList.remove("hidden");

    /* kolumnę z nazwami kanałów mierzymy w siatce, a nie przepisujemy z CSS —
       linia ma wypaść dokładnie na początku osi czasu */
    var wrap = line.parentNode;
    var lane = wrap && wrap.querySelector ? wrap.querySelector(".guide-lane") : null;
    var base = lane && lane.offsetLeft ? lane.offsetLeft : GUIDE_CHANNEL_WIDTH;
    line.style.left = (base + (now - start) / 3600000 * guide.hourWidth) + "px";

    var label = line.querySelector ? line.querySelector(".guide-nowline-label") : null;
    if (label) {
      var clock = new Date(now);
      label.textContent = pad2(clock.getHours()) + ":" + pad2(clock.getMinutes());
    }
  }

  function stopGuideNowLine() {
    if (!guide.lineTimer) return;
    clearInterval(guide.lineTimer);
    guide.lineTimer = null;
  }

  function startGuideNowLine() {
    stopGuideNowLine();
    guide.lineTimer = setInterval(updateGuideNowLine, GUIDE_NOWLINE_MS);
  }

  /* =========================  OSD ODTWARZACZA (MINI-EPG)  =========================
     Pasek odtwarzacza pokazuje, co leci teraz i co będzie następne na oglądanym
     kanale — mini-EPG bez opuszczania obrazu. Znika sam po OSD_AUTOHIDE ms, ale
     zostaje na ekranie, gdy obraz jest zatrzymany (klasyczne zachowanie TV). */

  function osdVisible() {
    var overlay = $("playerOverlay");
    return !!overlay && !overlay.classList.contains("hidden");
  }

  function showOsd() {
    if (settings.osdEnabled === false) return;
    var overlay = $("playerOverlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    updateOsd();
    scheduleOsdHide();
    if (!state.osdTicker) {
      /* zegar odświeża EPG co sekundę, żeby pasek nie „zamarzł” na kanale */
      state.osdTicker = setInterval(updateOsd, 1000);
    }
  }

  function hideOsd() {
    var overlay = $("playerOverlay");
    if (overlay) {
      overlay.classList.add("hidden");
      /* fokus nie może zostać na ukrytym przycisku — inaczej pilot „gubi się” */
      suspendFocusInside(overlay);
    }
    clearTimeout(state.osdTimer);
    state.osdTimer = null;
    if (state.osdTicker) {
      clearInterval(state.osdTicker);
      state.osdTicker = null;
    }
  }

  function toggleOsd() {
    if (osdVisible()) hideOsd();
    else showOsd();
  }

  /* pasek znika sam — chyba że obraz jest zatrzymany albo użytkownik właśnie
     nawiguje po jego przyciskach (wtedy licznik startuje od nowa) */
  function scheduleOsdHide() {
    clearTimeout(state.osdTimer);
    var video = $("video");
    if (!osdVisible() || (video && video.paused)) {
      state.osdTimer = null;
      return;
    }
    state.osdTimer = setTimeout(function () {
      state.osdTimer = null;
      hideOsd();
    }, OSD_AUTOHIDE);
  }

  function suspendFocusInside(element) {
    var active = document.activeElement;
    if (active && element.contains(active) && active.blur) active.blur();
  }

  function osdTime(ms) {
    var date = new Date(ms);
    return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
  }

  /* przyciski paska budowane raz na kanał; etykiety odświeża updateOsd() */
  function osdButton(id, label, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "osd-button";
    button.tabIndex = 0;
    setIconLabel(button, label);
    button.setAttribute("data-osd", id);
    button.onclick = function (event) {
      if (event) event.stopPropagation();
      action();
      scheduleOsdHide();
    };
    button.onfocus = scheduleOsdHide;
    return button;
  }

  /* Pasek odtwarzacza. Kolejność jest stała, a przyciski zmieniają się razem
     z tym, co naprawdę da się zrobić: „Od początku” jest wtedy, gdy znamy
     program, „Na żywo” tylko wtedy, gdy obraz nie jest na żywo, a „EPG”
     otwiera listę programów oglądanego kanału. Menu opcji kanału zostaje pod
     klawiszem MENU / trzymanym OK — nie dublujemy go na pasku. */
  function buildOsdActions() {
    var bar = $("playerActions");
    if (!bar) return;
    bar.textContent = "";
    var channel = state.watchChannel;
    if (!channel) return;

    bar.appendChild(osdButton("play", t("osd_pause"), togglePlayPause));

    if (state.isArchive || currentProgram(channel)) {
      bar.appendChild(osdButton("restart", t("osd_restart"), restartWatching));
    }

    if (state.isArchive) {
      /* nagranie: skok po archiwum i powrót do bieżącego programu */
      bar.appendChild(osdButton("prev", t("osd_prev_program"), function () { watchProgramStep(-1); }));
      bar.appendChild(osdButton("next", t("osd_next_program"), function () { watchProgramStep(1); }));
    }

    /* EPG oglądanego kanału: lista programów (poprzednie, bieżący i następne),
       z której wybiera się materiał do odtworzenia z archiwum */
    bar.appendChild(osdButton("epg", t("osd_epg"), openPlayerGuide));

    if (state.isArchive) bar.appendChild(osdButton("live", t("osd_live"), goLive));

    bar.appendChild(osdButton("mute", t("osd_mute"), toggleMute));

    /* Na telewizorze te dwie akcje są na pilocie (MENU / trzymane OK oraz
       Wstecz), więc przyciski na pasku byłyby tylko duplikatem — dlatego
       pokazują się wyłącznie w trybie dotykowym (CSS: .osd-touch-only).
       Na telefonie to jedyna droga do menu opcji kanału i do wyjścia. */
    bar.appendChild(osdButton("options", t("ctx_menu"), function () {
      openContextMenu(state.watchChannel);
    })).classList.add("osd-touch-only");
    bar.appendChild(osdButton("back", t("osd_back"), stopPlayback)).classList.add("osd-touch-only");
  }

  /* „EPG” na pasku odtwarzacza: lista programów oglądanego kanału. Wybranie
     pozycji odtwarza ją z archiwum, „Na żywo” wraca do bieżącej chwili. */
  function openPlayerGuide() {
    if (!state.watchChannel) return;
    openArchive(state.watchChannel, { fromPlayer: true });
  }

  /* ⏵‖ (przycisk na pasku i klawisz play/pauza na pilocie). */
  function togglePlayPause() {
    var video = $("video");
    if (!video) return;
    if (video.paused) resumePlayback();
    else pausePlayback();
  }

  /* Pauza na kanale na żywo zapamiętuje chwilę zatrzymania — obraz leci dalej,
     więc wznowienie musi wrócić dokładnie tam (patrz resumePlayback). */
  function pausePlayback() {
    var video = $("video");
    if (!video) return;
    if (!state.isArchive && state.watchChannel) state.livePauseAt = Date.now();
    video.pause();
    showOsd();
    updateOsd();
  }

  /* Wznowienie po pauzie. Kanał na żywo po dłuższej pauzie zdążył uciec do
     przodu, więc wracamy do momentu zatrzymania przez archiwum (okno catch-up
     kończące się teraz). Bez archiwum — albo przy krótkiej pauzie — zwykłe
     wznowienie odtwarzacza. */
  function resumePlayback() {
    var video = $("video");
    if (!video) return;

    var channel = state.watchChannel;
    var pausedAt = state.livePauseAt;
    state.livePauseAt = 0;

    if (!state.isArchive && channel && pausedAt &&
        Date.now() - pausedAt > RESUME_AFTER_PAUSE && hasArchive(channel)) {
      var program = currentProgram(channel);
      playChannel(channel, {
        start: pausedAt,
        end: Date.now(),
        title: program ? program.title : channel.name,
        timeshift: true
      }, "playerScreen");
      return;
    }

    var promise = video.play();
    if (promise && promise.catch) promise.catch(function () {});
    updateOsd();
    scheduleOsdHide();
  }

  /* 🔇 na pilocie (i przycisk na pasku): wyciszenie dźwięku strumienia.
     Głośność samego telewizora należy do sprzętu — tu wyciszamy odtwarzacz. */
  function toggleMute() {
    var video = $("video");
    if (!video) return;
    video.muted = !video.muted;
    showOsd();
    updateOsd();
  }

  function isMuted() {
    var video = $("video");
    return !!(video && video.muted);
  }

  function muteLabel() {
    return t(isMuted() ? "osd_unmute" : "osd_mute");
  }

  /* „Od początku”: w archiwum powtarza bieżące nagranie, na kanale na żywo
     przechodzi do catch-up początku programu, który leci w tej chwili */
  function restartWatching() {
    var channel = state.watchChannel;
    if (!channel) return;

    if (state.isArchive && state.watchProgram) {
      var program = state.watchProgram;
      playChannel(channel, { start: program.start, end: program.end, title: program.title }, "playerScreen");
      return;
    }

    var now = currentProgram(channel);
    if (now && hasArchive(channel)) {
      playChannel(channel, now, "playerScreen");
      return;
    }
    showPlayerError(t("err_catchup"));
    scheduleOsdHide();
  }

  function goLive() {
    if (!state.watchChannel) return;
    playChannel(state.watchChannel, null, "playerScreen");
  }

  /* ◀/▶ na pasku archiwum: poprzednie / następne nagranie tego samego kanału */
  function watchProgramStep(direction) {
    var channel = state.watchChannel;
    var current = state.watchProgram;
    if (!channel || !current) return;

    var now = Date.now();
    var playable = programsFor(channel).filter(function (program) {
      return program.end > program.start && program.end <= now;
    });
    playable.sort(function (a, b) { return a.start - b.start; });
    if (!playable.length) return;

    var index = -1;
    for (var i = 0; i < playable.length; i++) {
      if (playable[i].start <= current.start) index = i;
      else break;
    }
    var target = playable[index + direction];
    if (!target) return;
    playChannel(channel, target, "playerScreen");
  }

  /* ---------------------  TREŚĆ PASKA: MINI-EPG KANAŁU  --------------------- */

  function updateOsd() {
    var channel = state.watchChannel;
    if (!channel) return;

    var video = $("video");
    var program = state.watchProgram;
    var titleEl = $("playerTitle");
    var clockEl = $("playerClock");
    var nowRow = $("playerNow");
    var nextRow = $("playerNext");
    var timeEl = $("playerTime");
    var hintEl = $("playerHint");

    if (titleEl) titleEl.textContent = channel.name;
    if (clockEl) clockEl.textContent = osdTime(Date.now());

    if (program) {
      /* odtwarzamy archiwum — pokazujemy nagranie i jego własny postęp */
      if (nowRow) {
        nowRow.textContent = "";
        var label = document.createElement("span");
        label.className = "osd-time";
        label.textContent = t("catchup") + ":";
        nowRow.appendChild(label);
        nowRow.appendChild(document.createTextNode(program.title));
      }
      if (nextRow) nextRow.textContent = formatRange(program.start, program.end);
      if (hintEl) hintEl.textContent = t("osd_hint_archive");
    } else {
      var now = currentProgram(channel);
      var next = nextProgram(channel);

      if (nowRow) {
        nowRow.textContent = "";
        if (now) {
          var nowTime = document.createElement("span");
          nowTime.className = "osd-time";
          nowTime.textContent = osdTime(now.start) + "–" + osdTime(now.end);
          nowRow.appendChild(nowTime);
          nowRow.appendChild(document.createTextNode(now.title));
        } else {
          nowRow.textContent = t("epg_none");
        }
      }
      if (nextRow) {
        nextRow.textContent = next
          ? t("osd_next_label") + " " + osdTime(next.start) + "–" + osdTime(next.end) + "  " + next.title
          : "";
      }
      if (timeEl) {
        timeEl.textContent = engineLabel(state.engine) +
          (video && video.paused ? " • " + t("osd_paused") : "") +
          (video && video.muted ? " • " + t("osd_muted") : "");
      }
      if (hintEl) hintEl.textContent = t("osd_hint_live");
    }

    updateOsdProgress();
    refreshSeekNotice();

    var bar = $("playerActions");
    var playButton = bar ? bar.querySelector('[data-osd="play"]') : null;
    if (playButton) setIconLabel(playButton, t(video && video.paused ? "osd_play" : "osd_pause"));
    var muteButton = bar ? bar.querySelector('[data-osd="mute"]') : null;
    if (muteButton) setIconLabel(muteButton, muteLabel());
  }

  /* tanie odświeżanie (timeupdate / zegar): tylko pasek postępu i czas */
  function updateOsdProgress() {
    var channel = state.watchChannel;
    if (!channel || !osdVisible()) return;

    var video = $("video");
    var bar = $("playerProgress");
    if (!bar) return;

    if (state.isArchive && video && isFinite(video.duration) && video.duration > 0) {
      bar.style.width = (video.currentTime / video.duration) * 100 + "%";
      var timeEl = $("playerTime");
      if (timeEl) {
        timeEl.textContent = formatTime(video.currentTime) + " / " + formatTime(video.duration) +
          (video.muted ? " • " + t("osd_muted") : "");
      }
      return;
    }

    /* kanał na żywo: pasek pokazuje, jak daleko jesteśmy w bieżącym programie */
    var now = currentProgram(channel);
    bar.style.width = now
      ? Math.max(0, Math.min(100, (Date.now() - now.start) / (now.end - now.start) * 100)) + "%"
      : "0%";
  }

  /* ------------------------  MENU OPCJI KANAŁU (pilot)  ------------------------ */

  function currentScreenId() {
    for (var i = 0; i < SCREENS.length; i++) {
      var el = $(SCREENS[i]);
      if (el && !el.classList.contains("hidden")) return SCREENS[i];
    }
    return "browserScreen";
  }

  function hideContextMenu() {
    var menu = $("contextMenu");
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
  }

  function ctxButton(label, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.tabIndex = 0;
    setIconLabel(button, label);
    button.onclick = function (event) {
      if (event) event.stopPropagation();
      action();
    };
    return button;
  }

  /* Menu opcji kanału: otwierane trzymanym OK na kafelku (albo klawiszem MENU
     w odtwarzaczu). Wszystkie pozycje to zwykłe przyciski, więc pilot obsługuje
     je bez dodatkowego kodu. */
  function openContextMenu(channel) {
    hideContextMenu();
    var target = channel || state.watchChannel || state.selectedChannel;
    if (!target) return;
    /* z odtwarzacza (MENU / trzymane OK) menu dostaje dodatkowo akcje obrazu */
    var inPlayer = currentScreenId() === "playerScreen" && !!state.watchChannel;

    var menu = document.createElement("section");
    menu.id = "contextMenu";
    menu.className = "ctx-menu";

    var card = document.createElement("div");
    card.className = "ctx-card";

    var title = document.createElement("h2");
    title.className = "ctx-title";
    title.textContent = t("ctx_menu");
    card.appendChild(title);

    var subtitle = document.createElement("p");
    subtitle.className = "ctx-sub";
    subtitle.textContent = target.name;
    card.appendChild(subtitle);

    var actions = document.createElement("div");
    actions.className = "ctx-actions";

    actions.appendChild(ctxButton(t("ctx_play"), function () {
      hideContextMenu();
      playChannel(target, null, currentScreenId() === "playerScreen" ? "playerScreen" : currentScreenId());
    }));

    actions.appendChild(ctxButton(isFavorite(target) ? t("ctx_fav_del") : t("ctx_fav_add"), function () {
      hideContextMenu();
      toggleFavorite(target);
    }));

    if (hasArchive(target)) {
      actions.appendChild(ctxButton(t("ctx_archive"), function () {
        hideContextMenu();
        openArchive(target);
      }));
    }

    actions.appendChild(ctxButton(t("ctx_epg"), function () {
      hideContextMenu();
      if (inPlayer) openGuide({ channel: target, returnTo: "playerScreen" });
      else openGuide();
    }));

    if (inPlayer) {
      /* Odtwarzacz: te same akcje co na pasku. Pilotem ▲▼ zmieniają kanał, więc
         do opcji obrazu dochodzi się przez MENU albo trzymane OK. */
      if (state.watchProgram) {
        actions.appendChild(ctxButton(t("osd_restart"), function () {
          hideContextMenu();
          restartWatching();
        }));
        actions.appendChild(ctxButton(t("osd_prev_program"), function () {
          hideContextMenu();
          watchProgramStep(-1);
        }));
        actions.appendChild(ctxButton(t("osd_next_program"), function () {
          hideContextMenu();
          watchProgramStep(1);
        }));
        actions.appendChild(ctxButton(t("osd_live"), function () {
          hideContextMenu();
          goLive();
        }));
      } else if (currentProgram(target)) {
        actions.appendChild(ctxButton(t("osd_restart"), function () {
          hideContextMenu();
          restartWatching();
        }));
      }
      actions.appendChild(ctxButton(muteLabel(), function () {
        hideContextMenu();
        toggleMute();
      }));
    }

    actions.appendChild(ctxButton(t("ctx_close"), hideContextMenu));

    card.appendChild(actions);
    menu.appendChild(card);
    document.body.appendChild(menu);

    /* fokus na pierwszej pozycji — pilot może działać od razu */
    var first = actions.querySelector("button");
    if (first) {
      try { first.focus(); } catch (error) { /* bez fokusu też da się kliknąć */ }
    }
  }

  /* -------------------------  OK: krótko vs. trzymane  ------------------------- */

  /* kafelek kanału, na którym stoi fokus (potrzebny przy trzymanym OK) */
  function focusedChannelCard() {
    var active = document.activeElement;
    if (!active || !active.closest) return null;
    var card = active.closest(".channel");
    var container = $("channels");
    if (!card || !container) return null;
    var index = Array.prototype.indexOf.call(container.children, card);
    if (index < 0 || index >= state.listItems.length) return null;
    return state.listItems[index];
  }

  /* Krótkie OK uruchamia onShort, trzymane OK (OK_HOLD_MS) otwiera menu opcji.
     Jedno naciśnięcie = jedna akcja, dlatego rozstrzygamy to na zwolnieniu. */
  function startOkHold(onShort) {
    clearTimeout(state.okHoldTimer);
    state.okAction = onShort || null;
    state.okFired = false;
    state.okHoldTimer = setTimeout(function () {
      state.okHoldTimer = null;
      state.okFired = true;
      state.okAction = null;
      openContextMenu(focusedChannelCard() || state.watchChannel || state.selectedChannel);
    }, OK_HOLD_MS);
  }

  function releaseOk() {
    var fired = state.okFired;
    var action = state.okAction;
    clearTimeout(state.okHoldTimer);
    state.okHoldTimer = null;
    state.okAction = null;
    state.okFired = false;
    if (fired) return;               /* menu zdążyło się otworzyć */
    if (action) action();
    else if (currentScreenId() === "playerScreen") toggleOsd();
  }

  /* Jedna wspólna obsługa „Wstecz” — dla klawisza pilota (webOS 461, Android 4)
     i dla sprzętowego Back na Android TV / Fire TV (MainActivity pyta o nią
     przez window.__openiptvBack). Zwraca true, gdy zdarzenie zostało zużyte. */
  function handleBack() {
    if ($("exitDialog")) {
      hideExitDialog();          /* Wstecz na pytaniu o wyjście = zostaję */
      return true;
    }
    if ($("contextMenu")) {
      hideContextMenu();
      return true;
    }
    if (!$("playerScreen").classList.contains("hidden")) {
      stopPlayback();
      return true;
    }
    if (!$("archiveScreen").classList.contains("hidden")) {
      /* archiwum wraca tam, skąd przyszło: do obrazu, jeśli coś tam jeszcze
         leci, a inaczej do listy kanałów (patrz closeArchive) */
      closeArchive();
      return true;
    }
    if (!$("guideScreen").classList.contains("hidden")) {
      /* program TV wraca tam, skąd został otwarty (obraz albo lista) */
      closeGuide();
      return true;
    }
    if (!$("settingsScreen").classList.contains("hidden") && state.channels.length) {
      showScreen("browserScreen");
      return true;
    }
    /* Główna lista (albo ustawienia bez wczytanej playlisty): Wstecz najpierw
       pyta, czy na pewno wyjść — jedno naciśnięcie pilota nie może kończyć
       oglądania. Samo zamknięcie aplikacji robi requestExit(). */
    showExitConfirm();
    return true;
  }

  /* ------------------------  WYJŚCIE Z APLIKACJI  ------------------------
     Zamknięcie okna zależy od platformy: w WebView na Androidzie i Fire TV
     window.close() jest ignorowane, więc pytanie o wyjście woła most
     OpenIptvNative.quit() z MainActivity (patrz bindExitBridge). Na webOS
     i Tizenie wystarczy zamknięcie okna aplikacji. W zwykłej przeglądarce
     kartę może zamknąć tylko użytkownik — wtedy zostaje podpowiedź, żeby użyć
     przycisku wyjścia na pilocie. */
  function requestExit() {
    var bridge = window.OpenIptvNative;
    if (bridge && typeof bridge.quit === "function") {
      try {
        bridge.quit();
        return true;
      } catch (error) { /* brak mostu — próbujemy dalej */ }
    }
    var tizen = window.tizen;
    if (tizen && tizen.application && tizen.application.getCurrentApplication) {
      try {
        tizen.application.getCurrentApplication().exit();
        return true;
      } catch (error2) { /* starsze wersje Tizena — próbujemy dalej */ }
    }
    try {
      window.close();
    } catch (error3) { /* okno zostaje otwarte — niżej podpowiedź */ }
    return false;
  }

  /* Pytanie „wyjść z aplikacji?” — jak menu kontekstowe, więc pilot obsługuje
     je bez dodatkowego kodu (▲ ▼ / OK, Wstecz zamyka). */
  function showExitConfirm() {
    hideExitDialog();

    var dialog = document.createElement("section");
    dialog.id = "exitDialog";
    dialog.className = "ctx-menu";

    var card = document.createElement("div");
    card.className = "ctx-card";

    var title = document.createElement("h2");
    title.className = "ctx-title";
    title.textContent = t("exit_title");
    card.appendChild(title);

    var hint = document.createElement("p");
    hint.className = "ctx-sub";
    hint.id = "exitHint";
    hint.textContent = t("exit_hint");
    card.appendChild(hint);

    var actions = document.createElement("div");
    actions.className = "ctx-actions";

    actions.appendChild(ctxButton(t("exit_confirm"), function () {
      /* gdy platforma nie pozwala zamknąć okna, okno zostaje z podpowiedzią */
      if (!requestExit()) $("exitHint").textContent = t("exit_manual");
    }));
    actions.appendChild(ctxButton(t("exit_cancel"), hideExitDialog));
    card.appendChild(actions);
    dialog.appendChild(card);
    document.body.appendChild(dialog);

    if (actions.firstChild && actions.firstChild.focus) actions.firstChild.focus();
  }

  function hideExitDialog() {
    var dialog = $("exitDialog");
    if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
  }

  /* Most dla natywnej obsługi Back (Fire TV / Android TV):
     „handled” = zajęliśmy się klawiszem, puste = oddaj kontrolę systemowi. */
  window.__openiptvBack = function () {
    try {
      return handleBack() ? "handled" : "";
    } catch (error) {
      return "";
    }
  };

  /* ==============================  ZDARZENIA  ============================== */

  /* ==========================  OBSŁUGA PILOTA / KLAWIATURY  ==========================
     Kody klawiszy obsługujemy wg standardowego mapowania przeglądarki (strzałki
     37–40, OK 13, okno DPAD_CENTER 23), a dodatkowo kody specyficzne dla webOS
     (Wstecz 461, pauza 19, play 415, przewijanie 412/417) — i tylko tam, gdzie
     faktycznie występują, żeby nie kolidowały ze strzałkami Fire TV. */

  /* Ostatnie miejsce fokusu. Gdy przycisk zniknie albo przestanie być dostępny
     (tak jest z „Pobierz i zainstaluj” w trakcie pobierania paczki), system
     oddaje fokus ciału strony — bez zapamiętanego miejsca nawigacja pilotem nie
     wiedziała, gdzie była, i wracała na sam początek ustawień. */
  var focusAnchor = null;

  document.addEventListener("focusin", function (event) {
    var element = event.target;
    if (!element || !element.getBoundingClientRect) return;
    var box = element.getBoundingClientRect();
    if (!box.width && !box.height) return;
    focusAnchor = { el: element, box: box };
  });

  var WEBOS_KEYS = platformInfo.os === "webos";

  /* -------------------  PILOT: PLAY/PAUZA I KLAWISZE MEDIALNE  -------------------
     Jeden przycisk ⏵‖ (albo ⏹) na pilocie, a tyle różnych kodów klawiszy między
     dekoderami: 85 / 126 / 127 / 86 na Androidzie i Fire TV, 415 / 19 na webOS.
     Część pilotów wysyła przy tym samą nazwę klawisza („MediaPlayPause”) i kod 0,
     więc bierzemy pod uwagę jedno i drugie. WEBOS_KEYS pilnuje tylko kodów,
     które na innych platformach znaczą coś innego (19 to na Androidzie ▲). */

  var MEDIA_KEY_TOGGLE = [85, 126, 179, 415];   // ⏵‖ oraz samo ⏵
  var MEDIA_KEY_PAUSE = [86, 93, 127, 178];     // ⏹ oraz samo ⏸ (178 = Chromium)

  function mediaKeyAction(keyCode, keyName) {
    var name = String(keyName || "");
    if (name === "MediaPlayPause" || name === "MediaPlay") return "toggle";
    if (name === "MediaPause" || name === "MediaStop") return "pause";
    if (MEDIA_KEY_TOGGLE.indexOf(keyCode) >= 0) return "toggle";
    if (MEDIA_KEY_PAUSE.indexOf(keyCode) >= 0) return "pause";
    if (keyCode === 19 && WEBOS_KEYS) return "toggle";
    return "";
  }

  function runMediaKey(action) {
    if (action === "toggle") togglePlayPause();
    else if (action === "pause") pausePlayback();
  }

  /* -----------------  PILOT: PRZEWIJANIE (⏪ ⏩ I ICH WARIANTY)  -----------------
     Jeden przycisk ⏪ / ⏩, a znowu kilka kodów między dekoderami: webOS 412/417,
     Android TV i Fire TV 89/90 (KEYCODE_MEDIA_REWIND / FAST_FORWARD), a część
     pilotów wysyła zamiast przewijania klawisze „poprzedni / następny” (88/87,
     w Chromium 177/176). Część pilotów podaje przy tym samą nazwę klawisza
     („MediaRewind”) albo kod 0, więc bierzemy pod uwagę jedno i drugie.
     Strzałki ◀ ▶ przewijają tylko przy włączonym ustawieniu „◀ ▶ przewija”. */

  var SEEK_BACK_KEYS = [412, 89, 88, 177];      // ⏪ oraz ⏮ (webOS / Android / Chromium)
  var SEEK_FORWARD_KEYS = [417, 90, 87, 176];   // ⏩ oraz ⏭

  /* kierunek skoku dla klawisza pilota; 0 = to nie jest klawisz przewijania */
  function seekKeyDirection(keyCode, keyName, arrowsSeek) {
    var name = String(keyName || "");
    if (name === "MediaRewind" || name === "MediaTrackPrevious") return -1;
    if (name === "MediaFastForward" || name === "MediaTrackNext") return 1;
    if (SEEK_BACK_KEYS.indexOf(keyCode) >= 0) return -1;
    if (SEEK_FORWARD_KEYS.indexOf(keyCode) >= 0) return 1;
    if (arrowsSeek && keyCode === 37) return -1;
    if (arrowsSeek && keyCode === 39) return 1;
    return 0;
  }

  /* Klawisze przewijania, które przyszły na keydown. Część pilotów wysyła
     przewijanie dopiero na zwolnieniu klawisza — wtedy skok robi keyup, ale gdy
     keydown już go zrobił, zwolnienie nie może dodać drugiego kroku. */
  var seekKeyDown = {};

  /* Część dekoderów oddaje klawisze multimedialne dopiero na zwolnieniu
     klawisza, a część nie oddaje ich wcale — wtedy trafiają do nas mostem
     natywnym (patrz window.__openiptvKey i MainActivity). */
  function mediaKeyHandledRecently() {
    return !!state.mediaKeyAt && Date.now() - state.mediaKeyAt < 1200;
  }

  document.addEventListener("keydown", function (event) {
    var key = event.keyCode;
    var inPlayer = !$("playerScreen").classList.contains("hidden");
    var inGuide = !$("guideScreen").classList.contains("hidden");

    /* Wstecz (webOS 461, Android 4): najpierw zamyka nakładki */
    if (key === 461 || key === 4) {
      event.preventDefault();
      handleBack();
      return;
    }

    /* ------------------------------  ODTWARZACZ  ------------------------------ */
    if (inPlayer) {
      /* Fokus na przycisku paska (mysz, dotyk): strzałki chodzą po pasku.
         Z pilota fokus siedzi na obrazie, więc strzałki sterują transmisją —
         dlatego kanału nie przełącza „przypadkowe” wejście w pasek. */
      var osdFocus = document.activeElement;
      var onOsdButton = !!(osdFocus && osdFocus.getAttribute && osdFocus.getAttribute("data-osd"));
      if (onOsdButton && key >= 37 && key <= 40) {
        event.preventDefault();
        focusNearest(key);
        scheduleOsdHide();
        return;
      }

      /* ▲ ▼ (CH+ / CH−): następny / poprzedni kanał z listy, jak na pilocie
         telewizora. Trzymana strzałka nie przełącza kanałów seriami. */
      if (key === 38 || key === 40) {
        event.preventDefault();
        if (event.repeat) return;
        zapChannel(key === 38 ? -1 : 1);
        return;
      }

      /* ◀ ▶ — przewijanie obrazu (na kanale na żywo ◀ wchodzi w catch-up o krok,
         a ▶ na zatrzymanym obrazie wznawia od miejsca pauzy). ⏪ ⏩ pilota
         (webOS 412/417, Android 89/90, „poprzedni / następny” 88/87) przewijają
         zawsze, a strzałki tylko przy włączonym ustawieniu „◀ ▶ przewija” —
         inaczej wracają do nawigacji (patrz seekKeyDirection). */
      var seekDirection = seekKeyDirection(key, event.key, settings.dpadSeek);
      if (seekDirection) {
        event.preventDefault();
        seekKeyDown[key] = true;
        seekBy(seekDirection);
        return;
      }
      if (key === 37 || key === 39) {
        event.preventDefault();
        focusNearest(key);
        scheduleOsdHide();
        return;
      }

      /* OK: krótko = panel odtwarzacza (albo kliknięcie przycisku paska, gdy
         fokus już na nim jest), trzymane = menu opcji kanału */
      if (key === 13 || key === 23 || key === 66) {
        event.preventDefault();
        if (event.repeat) return;
        startOkHold(onOsdButton ? function () { osdFocus.click(); } : null);
        return;
      }

      /* 🔇 na pilocie (449 = webOS / Tizen, 173 = klawiatura) — cisza w obrazie */
      if (key === 449 || key === 173) {
        event.preventDefault();
        if (event.repeat) return;
        toggleMute();
        return;
      }

      /* ⏵‖ / ⏹ / pauza: klawisze multimedialne obu platform (patrz
         mediaKeyAction — kody różnią się między dekoderami) */
      var media = mediaKeyAction(key, event.key);
      if (media) {
        event.preventDefault();
        /* jedno naciśnięcie = jedna akcja, także gdy klawisz jest trzymany */
        state.mediaKeyAt = Date.now();
        if (event.repeat) return;
        runMediaKey(media);
        return;
      }
      /* MENU (webOS/Tizen 18, Android 82) — opcje kanału; tutaj są też wszystkie
         akcje panelu, więc pilot nie musi wchodzić fokusem w pasek */
      if (key === 82 || key === 18) {
        event.preventDefault();
        openContextMenu(state.watchChannel);
        return;
      }
      return;
    }

    /* Pola formularza obsługuje sam WebView: klawisz OK musi na nich zostać
       „przepuszczony” do przeglądarki, bo tylko wtedy rozwinie się lista wyboru
       (select), otworzy się kalendarz albo zegar (date, time) i klawiatura.
       Wcześniej preventDefault z sekcji OK poniżej zjadał ten klawisz i np. na
       Fire TV nie dało się rozwinąć pola „Typ źródła”. Zaznaczenia przełączamy
       sami, bo Enter na polu wyboru nie działa jednakowo na wszystkich
       platformach, a strzałki zostawiamy polu (lista, kursor). */
    var field = document.activeElement;
    var fieldTag = (field && field.tagName) || "";

    if (fieldTag === "SELECT" || fieldTag === "TEXTAREA") return;

    if (fieldTag === "INPUT") {
      var fieldType = (field.getAttribute("type") || "text").toLowerCase();
      if ((fieldType === "checkbox" || fieldType === "radio") &&
          (key === 13 || key === 23 || key === 66)) {
        event.preventDefault();
        if (!event.repeat && field.click) field.click();
      }

      /* Pole szukania: strzałki mają z niego wyprowadzać fokus (pilot nie ma
         Tab, a klawiatura ekranowa zasłania listę). ◀ i ▶ zostają w polu,
         dopóki jest w nim co poprawiać — decyduje searchArrowTarget. */
      if (field === $("searchInput")) {
        var caret = field.selectionStart === null ? field.value.length : field.selectionStart;
        var caretEnd = field.selectionEnd === null ? field.value.length : field.selectionEnd;
        var arrow = searchArrowTarget(key, caret === 0, caretEnd === field.value.length);
        if (arrow === "channels") {
          event.preventDefault();
          focusChannelEntry();
          return;
        }
        if (arrow === "categories") {
          event.preventDefault();
          focusActiveCategory();
          return;
        }
        if (arrow === "bar") {
          event.preventDefault();
          focusNearest(39);
          return;
        }
      }
      return;
    }

    /* Ustawienia: na pasku zakładek ◀ ▶ zmieniają zakładkę, a ▼ wchodzi w jej
       treść (pilot nie ma Tab, więc bez tego z paska nie dałoby się zejść) */
    var focused = document.activeElement;
    var onTab = !!(focused && focused.getAttribute && focused.getAttribute("data-tab"));
    if (onTab && (key === 37 || key === 39 || key === 412 || key === 417)) {
      event.preventDefault();
      stepSettingsTab(key === 37 || key === 412 ? -1 : 1);
      return;
    }
    if (onTab && key === 40) {
      event.preventDefault();
      focusSettingsPanel();
      return;
    }

    /* Program TV: ◀ ▶ przewijają oś czasu o godzinę (dowolnie daleko w obie
       strony); przy polach daty/godziny strzałki obsługuje sam formularz */
    if (inGuide && (key === 37 || key === 39 || key === 412 || key === 417)) {
      event.preventDefault();
      guidePan(key === 37 || key === 412 ? -1 : 1);
      return;
    }

    /* Program TV: ▲ ▼ przenoszą fokus po programach w siatce (OK odtwarza) */
    if (inGuide && (key === 38 || key === 40)) {
      event.preventDefault();
      focusGuide(key);
      return;
    }

    if (key >= 37 && key <= 40) {
      event.preventDefault();
      focusNearest(key);
      ensureListAhead();
      return;
    }

    /* OK: krótko = odtwórz kanał, trzymane = menu opcji kanału */
    if (key === 13 || key === 23 || key === 66) {
      event.preventDefault();
      if (event.repeat) return;
      var card = focusedChannelCard();
      if (card) {
        startOkHold(function () { playChannel(card, null, "browserScreen"); });
      } else if (document.activeElement && document.activeElement.click) {
        document.activeElement.click();
      }
    }
  });

  /* Akcję przypisujemy dopiero na zwolnieniu OK — dzięki temu jedno naciśnięcie
     wykonuje dokładnie jedną rzecz (krótkie OK albo menu przy trzymaniu).
     Tutaj też domykamy klawisze multimedialne: jeśli dekoder wysłał je tylko
     na zwolnieniu (bez keydown, którego nie obsłużyliśmy chwilę wcześniej),
     obraz zatrzyma się albo ruszy mimo wszystko. */
  document.addEventListener("keyup", function (event) {
    if (event.keyCode === 13 || event.keyCode === 23 || event.keyCode === 66) releaseOk();
    if ($("playerScreen").classList.contains("hidden")) return;
    var media = mediaKeyAction(event.keyCode, event.key);
    if (media && !mediaKeyHandledRecently()) {
      state.mediaKeyAt = Date.now();
      runMediaKey(media);
      return;
    }
    /* przewijanie wysłane tylko na zwolnieniu klawisza (bez keydown): gdy
       naciśnięcie już zrobiło skok, zwolnienie tylko je kończy */
    var seekCode = event.keyCode;
    if (seekKeyDown[seekCode]) { delete seekKeyDown[seekCode]; return; }
    var seekDirection = seekKeyDirection(seekCode, event.key, false);
    if (seekDirection) seekBy(seekDirection);
  });

  /* Most dla natywnej obsługi klawiszy multimedialnych (Android TV / Fire TV).
     MainActivity oddaje je tutaj, gdy na ekranie jest odtwarzacz — inaczej
     WebView zjada część z nich dla własnej sesji multimediów i strona nie wie
     o naciśnięciu przycisku ⏵‖. */
  window.__openiptvKey = function (code, name) {
    if ($("playerScreen").classList.contains("hidden")) return "";
    /* ⏪ / ⏩ pilota (KEYCODE_MEDIA_REWIND / FAST_FORWARD): przewijanie o krok */
    var seekDirection = seekKeyDirection(code, name, settings.dpadSeek);
    if (seekDirection) {
      seekKeyDown[code] = true;
      seekBy(seekDirection);
      return "handled";
    }
    var media = mediaKeyAction(code, name);
    if (!media) return "";
    state.mediaKeyAt = Date.now();
    runMediaKey(media);
    return "handled";
  };

  $("saveSettings").onclick = function () {
    var sourceType = $("sourceType").value;
    var profile = {
      id: draft.editingId || newProfileId(),
      name: $("profileName").value.trim() || "Playlista",
      sourceType: sourceType,
      playlistUrl: $("playlistUrl").value.trim(),
      playlistFileText: draft.playlistText,
      playlistFileName: draft.playlistName,
      xtreamServer: normalizeServer($("xtreamServer").value),
      xtreamUser: $("xtreamUser").value.trim(),
      xtreamPass: $("xtreamPass").value,
      epgUrl: $("epgUrl").value.trim(),
      epgFileText: draft.epgText,
      epgFileName: draft.epgName
    };

    if (sourceType === "xtream") {
      if (!profile.xtreamServer || !profile.xtreamUser || !profile.xtreamPass) {
        $("settingsError").textContent = "Xtream: podaj adres serwera, użytkownika i hasło.";
        return;
      }
    } else if (sourceType === "m3u-file") {
      if (!draft.playlistText) {
        $("settingsError").textContent = "Wybierz lokalny plik M3U.";
        return;
      }
    } else if (!/^https?:\/\//i.test(profile.playlistUrl)) {
      $("settingsError").textContent = "Podaj pełny adres http:// lub https:// do playlisty M3U.";
      return;
    }

    if (!draft.epgText && profile.epgUrl && !/^https?:\/\//i.test(profile.epgUrl)) {
      $("settingsError").textContent = "Adres EPG musi zaczynać się od http:// lub https://";
      return;
    }

    var index = -1;
    for (var i = 0; i < settings.profiles.length; i++) {
      if (settings.profiles[i].id === profile.id) index = i;
    }
    if (index >= 0) settings.profiles[index] = profile;
    else settings.profiles.push(profile);

    settings.activeProfileId = profile.id;
    settings.archiveDays = parseInt($("archiveDays").value, 10) || 7;
    settings.seekSeconds = parseInt($("seekSeconds").value, 10) || 10;
    settings.retryAttempts = parseInt($("retryAttempts").value, 10) || 0;
    settings.dpadSeek = $("dpadSeek").checked;
    settings.catchupTemplate = $("catchupTemplate").value.trim();
    settings.catchupAll = $("catchupAll").checked;
    settings.epgRefreshMinutes = parseInt($("epgRefreshMinutes").value, 10) || 0;
    settings.epgReloadOnStart = $("epgReloadOnStart").checked;
    settings.language = $("language").value === "en" ? "en" : "pl";
    settings.theme = $("theme").value === "light" ? "light" : "dark";
    settings.uiMode = $("uiMode").value === "tv" || $("uiMode").value === "touch" ? $("uiMode").value : "auto";
    settings.uiScale = normalizeUiScale($("uiScale").value);
    settings.osdEnabled = $("osdEnabled").checked;

    /* Wielkie teksty (playlista/EPG wybrane z pliku) trzymamy w osobnym kluczu,
       a w głównym zapisujemy tylko lekkie ustawienia — w przeciwnym razie zapis
       profilu blokuje interfejs na kilka sekund. */
    var bucket = settings.__blobs[profile.id] || (settings.__blobs[profile.id] = {});
    bucket.playlistFileText = profile.playlistFileText || "";
    bucket.playlistFileName = profile.playlistFileName || "";
    bucket.epgFileText = profile.epgFileText || "";
    bucket.epgFileName = profile.epgFileName || "";

    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(compactSettings()));
      localStorage.setItem(BLOBS_KEY, JSON.stringify(settings.__blobs || {}));
    } catch (error) {
      $("settingsError").textContent = "Dane są zbyt duże, aby zapisać je w pamięci aplikacji (zbyt duży plik M3U/EPG).";
      return;
    }

    applyTheme();
    applyTranslations();
    applyUiMode();
    loadCatalog();
  };

  $("sourceType").onchange = function () {
    updateSourceSections();
    var type = $("sourceType").value;
    if (type === "xtream") $("xtreamServer").focus();
    else if (type === "m3u-url") $("playlistUrl").focus();
  };

  $("language").onchange = function () {
    settings.language = this.value === "en" ? "en" : "pl";
    applyTranslations();
    /* informacja o wykrytym ekranie ma liczby, więc tłumaczymy ją osobno */
    applyUiScale();
  };

  $("theme").onchange = function () {
    settings.theme = this.value === "light" ? "light" : "dark";
    applyTheme();
  };

  /* Tryb interfejsu działa od razu — na telewizorze widać różnicę bez
     zapisywania ustawień. Mini-EPG można wyłączyć w locie. */
  $("uiMode").onchange = function () {
    settings.uiMode = this.value === "tv" || this.value === "touch" ? this.value : "auto";
    applyUiMode();
  };

  /* Rozmiar interfejsu też działa od razu. Szerokość układu zmieniamy w „meta
     viewport”, a gdy przeglądarka nie przeliczy jej w locie (starsze WebView na
     telewizorach), wczytujemy stronę raz jeszcze — index.html ustawia wtedy
     szerokość przed pierwszym rysowaniem, więc nic nie mruga. */
  $("uiScale").onchange = function () {
    var value = normalizeUiScale(this.value);
    settings.uiScale = value;
    flushSettings();
    applyUiScale();
    var api = scaleApi();
    if (!api) return;
    var ctx = scaleContext();
    var factor = uiScaleFactor(ctx);
    window.setTimeout(function () {
      if (!api.canvasMismatch(window, factor, ctx)) return;
      try {
        if (sessionStorage.getItem("openiptvScaleReload") === value) return;
        sessionStorage.setItem("openiptvScaleReload", value);
      } catch (e) {
        return;
      }
      window.location.reload();
    }, 500);
  };

  $("osdEnabled").onchange = function () {
    settings.osdEnabled = this.checked;
    if (!settings.osdEnabled) hideOsd();
  };

  /* aktualizacja: sprawdzenie wydania na GitHubie i — na Androidzie / Fire TV —
     pobranie paczki i przekazanie jej systemowemu instalatorowi */
  $("checkUpdates").onclick = function () { checkForUpdates(); };
  $("installUpdate").onclick = installAvailableUpdate;

  /* Przyciski „Wybierz plik M3U / EPG”. Na telewizorze wybór prowadzi plugin
     natywny (własna lista katalogów), w przeglądarce — ukryte pole pliku;
     decyduje o tym startFilePick(). */
  $("pickPlaylistFile").onclick = function () { startFilePick("m3u"); };
  $("pickEpgFile").onclick = function () { startFilePick("epg"); };

  /* Ścieżka zapasowa: plik wskazany w systemowym oknie wyboru plików */
  $("playlistFile").onchange = function () {
    var file = this.files && this.files[0];
    if (!file) return;
    readFile(file, false).then(function (text) {
      applyPlaylistFile(file.name, text);
    }, function () {
      setSettingsError(t("pick_m3u_error"));
    });
  };

  $("epgFile").onchange = function () {
    var file = this.files && this.files[0];
    if (!file) return;
    /* plik EPG czytamy binarnie — GZIP rozpoznajemy po nagłówku, więc
       spakowany plik o nazwie .xml też się rozpakuje */
    readFile(file, true).then(function (result) {
      try {
        applyEpgFile(file.name, result);
      } catch (error) {
        setSettingsError(t("pick_epg_unzip", { error: error.message }));
      }
    }, function () {
      setSettingsError(t("pick_epg_error"));
    });
  };

  $("useEpgLink").onclick = function () {
    draft.epgText = "";
    draft.epgName = "";
    $("epgFile").value = "";
    updateEpgPicker();
    $("epgUrl").focus();
  };

  $("settingsProfile").onchange = function () {
    if (suppressProfileSelect) return;
    for (var i = 0; i < settings.profiles.length; i++) {
      if (settings.profiles[i].id === this.value) loadProfileIntoForm(settings.profiles[i]);
    }
  };

  $("newProfile").onclick = function () {
    loadProfileIntoForm(null);
    $("profileName").focus();
  };

  $("deleteProfile").onclick = function () {
    var index = -1;
    for (var i = 0; i < settings.profiles.length; i++) {
      if (settings.profiles[i].id === draft.editingId) index = i;
    }
    if (index < 0) return;
    if (!window.confirm("Usunąć ten profil (playlistę, login Xtream i EPG)?")) return;

    settings.profiles.splice(index, 1);
    settings.activeProfileId = settings.profiles.length ? settings.profiles[0].id : "";
    /* usuwamy też pliki (playlista/EPG) tego profilu z osobnego klucza */
    if (settings.__blobs && settings.__blobs[draft.editingId]) delete settings.__blobs[draft.editingId];
    saveSettingsFull();
    refreshProfileSelect();
    loadProfileIntoForm(activeProfile());
  };

  $("profileSwitcher").onchange = function () {
    if (suppressProfileSwitcher) return;
    if (!this.value || this.value === settings.activeProfileId) return;
    settings.activeProfileId = this.value;
    saveSettings();
    loadCatalog();
  };

  $("openSettings").onclick = openSettings;
  /* Pasek zakładek ustawień (Ogólne / Aktualizacja / Instrukcja) — kliknięcie
     i OK na pilocie robią to samo; strzałki obsługuje keydown */
  bindSettingsTabs();
  /* „Wstecz” w ustawieniach: wyjście bez zapisu. Formularz wczytuje wartości
     z ustawień przy każdym otwarciu, więc porzucone zmiany nie zostają w pliku
     (nic nie jest zapisywane, dopóki nie naciśniemy „Zapisz i pobierz”). */
  $("settingsBack").onclick = function () { showScreen("browserScreen"); };
  $("openGuide").onclick = function () { openGuide(); };
  var archiveClose = $("archiveClose");
  if (archiveClose) archiveClose.onclick = closeArchive;
  /* „Na żywo” nad listą programów kanału: powrót do bieżącej chwili */
  var archiveLive = $("archiveLive");
  if (archiveLive) archiveLive.onclick = playArchiveLive;
  $("guidePrevDay").onclick = function () { guideShiftDays(-1); };
  $("guideNextDay").onclick = function () { guideShiftDays(1); };
  $("guideYesterday").onclick = function () { guideGoToDayOffset(-1); };
  $("guideDayBefore").onclick = function () { guideGoToDayOffset(-2); };
  $("guideToday").onclick = guideGoToday;
  $("guideDate").onchange = function () { guideGoToDate(this.value); };
  $("guideTime").onchange = function () { guideGoToTime(this.value); };
  /* Wstecz z programu TV wraca do obrazu, gdy program otwarto z paska
     odtwarzacza — a do listy kanałów, gdy wszedł z niej (patrz closeGuide) */
  $("guideClose").onclick = closeGuide;
  $("reload").onclick = loadCatalog;
  /* narzędzia kolejności grup — gdyby HTML ich nie miał, ensureCategoryLayout()
     tworzy je razem z obsługą kliknięcia */
  var orderToggle = $("groupOrderToggle");
  if (orderToggle) orderToggle.onclick = function () { setGroupOrderEdit(!state.orderEdit); };
  var orderReset = $("groupOrderReset");
  if (orderReset) orderReset.onclick = function () { resetGroupOrder(); };
  $("searchInput").oninput = function () {
    selectGroup(state.selectedGroup, document.querySelector(".category.active"));
  };

  bindVideoEvents($("video"));

  /* ================================  START  ================================ */

  /* profile ze starej wersji (1.4.x) dostają sourceType = "m3u" */
  (function initProfiles() {
    if (!Array.isArray(settings.profiles)) settings.profiles = [];
    if (!settings.profilesInitialized) {
      settings.profiles = [];
      if (settings.playlistUrl || settings.playlistFileText) {
        settings.profiles.push({
          id: newProfileId(),
          name: "Moja telewizja",
          sourceType: "m3u",
          playlistUrl: settings.playlistUrl || "",
          playlistFileText: settings.playlistFileText || "",
          playlistFileName: settings.playlistFileName || "",
          epgUrl: settings.epgUrl || "",
          epgFileText: "",
          epgFileName: ""
        });
        settings.activeProfileId = settings.profiles[0].id;
      }
      settings.profilesInitialized = true;
    }
    settings.profiles = settings.profiles.map(normalizeProfile);
    /* przenosimy ewentualne teksty plików ze starej instalacji do osobnego klucza */
    settings.profiles.forEach(function (item) {
      var bucket = settings.__blobs[item.id] || (settings.__blobs[item.id] = {});
      if (item.playlistFileText) bucket.playlistFileText = item.playlistFileText;
      if (item.playlistFileName) bucket.playlistFileName = item.playlistFileName;
      if (item.epgFileText) bucket.epgFileText = item.epgFileText;
      if (item.epgFileName) bucket.epgFileName = item.epgFileName;
    });
    saveSettingsFull();
  })();

  /* przy chowaniu aplikacji dopisujemy ustawienia czekające jeszcze w kolejce */
  window.addEventListener("pagehide", function () {
    if (settingsWriteTimer) flushSettings();
  });

  applyTheme();
  applyTranslations();
  buildChoiceRows();
  applyUiMode();

  var versionEl = $("appVersion");
  if (versionEl) versionEl.textContent = "v" + APP_VERSION;
  var settingsVersionEl = $("settingsVersion");
  if (settingsVersionEl) settingsVersionEl.textContent = "OpenIPTV v" + APP_VERSION;

  if (settings.profiles.length) {
    loadCatalog();
    /* ciche sprawdzenie po włączeniu: pokaże tylko numer nowszej wersji */
    checkForUpdates(true);
  } else {
    openSettings();
  }
})();













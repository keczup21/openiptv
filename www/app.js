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
  var APP_VERSION = "1.20.0";
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
  /* Ile kanałów pokazuje program TV (EPG). Przy 5000 kanałów nie da się
     zbudować całej siatki bez zamrożenia interfejsu, a i tak nikt nie
     przewija 5000 wierszy pilotem — resztę zawęża się kategorią. */
  var GUIDE_ROWS = 60;

  var state = {
    channels: [],
    programs: {},
    epgUrl: "",
    epgTimer: null,
    selectedChannel: null,
    selectedGroup: "@all",
    playerReturn: "browserScreen",
    isArchive: false,
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
    token: 0
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
    epg_update: "EPG — AKTUALIZACJA",
    epg_refresh: "Odświeżanie EPG", on_start: "Tylko przy starcie", every_30min: "Co 30 minut",
    every_1h: "Co 1 godzinę", every_2h: "Co 2 godziny", every_6h: "Co 6 godzin",
    every_12h: "Co 12 godzin", every_24h: "Co 24 godziny", epg_reload_on_start: "Pobieraj EPG przy starcie",
    archive_playback: "ARCHIWUM I ODTWARZANIE", archive_days: "Dni EPG/archiwum wstecz",
    seek_step: "Krok przewijania archiwum", sec5: "5 sekund", sec10: "10 sekund", sec30: "30 sekund",
    min1: "1 minuta", min5: "5 minut", min10: "10 minut",
    retry_attempts: "Próby ponownego uruchomienia kanału", disabled: "Wyłączone",
    attempt1: "1 próba", attempt2: "2 próby", attempt3: "3 próby", attempt5: "5 prób", attempt10: "10 prób",
    dpad_seek: "Lewo/prawo przewija archiwum", advanced: "ZAAWANSOWANE (OPCJONALNE)",
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
    tv_hint: "OK – oglądaj • MENU / długie OK – opcje • ◀ ▲ ▼ ▶ – nawigacja • EPG: ◀ ▶ – godziny",
    osd_restart: "⏪ Od początku",
    osd_prev_program: "◀ Poprzedni",
    osd_next_program: "Następny ▶",
    osd_live: "⏵ Na żywo",
    osd_back: "✕ Wstecz",
    osd_pause: "⏸ Pauza",
    osd_play: "⏵ Wznów",
    osd_hint_live: "OK – pasek opcji • MENU – opcje kanału • ⏪ – cofnij o krok (catch-up)",
    osd_hint_archive: "OK – pasek opcji • ◀ ▶ – nawigacja paska • ⏪ ⏩ – przewijanie • ⏩ na końcu – na żywo",
    osd_now: "Teraz:",
    osd_next_label: "Następnie:",
    osd_paused: "PAUZA",
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
    epg_none: "Brak danych EPG dla tego kanału.",
    archive_day_today: "Dziś", archive_day_yesterday: "Wczoraj", archive_day_before: "Przedwczoraj",
    archive_limited: "pokazano {shown} z {total}",
    guide_limited: "pokazano {shown} z {total} kanałów (zawęź kategorię)",
    osd_buffering: "Ładowanie strumienia…",
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
    update_err_unknown: "nieznany błąd"
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
    epg_update: "EPG — UPDATES",
    epg_refresh: "EPG refresh", on_start: "Only on start", every_30min: "Every 30 minutes",
    every_1h: "Every 1 hour", every_2h: "Every 2 hours", every_6h: "Every 6 hours",
    every_12h: "Every 12 hours", every_24h: "Every 24 hours", epg_reload_on_start: "Load EPG on start",
    archive_playback: "ARCHIVE & PLAYBACK", archive_days: "EPG/archive days back",
    seek_step: "Archive seek step", sec5: "5 seconds", sec10: "10 seconds", sec30: "30 seconds",
    min1: "1 minute", min5: "5 minutes", min10: "10 minutes",
    retry_attempts: "Channel retry attempts", disabled: "Disabled",
    attempt1: "1 attempt", attempt2: "2 attempts", attempt3: "3 attempts", attempt5: "5 attempts", attempt10: "10 attempts",
    dpad_seek: "Left/right seeks the archive", advanced: "ADVANCED (OPTIONAL)",
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
    tv_hint: "OK – watch • MENU / long OK – options • ◀ ▲ ▼ ▶ – navigate • Guide: ◀ ▶ – hours",
    osd_restart: "⏪ From start",
    osd_prev_program: "◀ Previous",
    osd_next_program: "Next ▶",
    osd_live: "⏵ Live",
    osd_back: "✕ Back",
    osd_pause: "⏸ Pause",
    osd_play: "⏵ Resume",
    osd_hint_live: "OK – action bar • MENU – channel options • ⏪ – step back (catch-up)",
    osd_hint_archive: "OK – action bar • ◀ ▶ – bar navigation • ⏪ ⏩ – seek • ⏩ at the end – live",
    osd_now: "Now:",
    osd_next_label: "Next:",
    osd_paused: "PAUSED",
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
    epg_none: "No EPG data for this channel.",
    archive_day_today: "Today", archive_day_yesterday: "Yesterday", archive_day_before: "2 days ago",
    archive_limited: "showing {shown} of {total}",
    guide_limited: "showing {shown} of {total} channels (narrow the category)",
    osd_buffering: "Loading stream…",
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
    update_err_unknown: "unknown error"
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

  function applyTranslations() {
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) {
      var v = t(els[i].getAttribute("data-i18n"));
      if (v !== undefined) els[i].textContent = v;
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

  function showScreen(id) {
    if (id === "browserScreen") refreshRecentGroup();
    for (var i = 0; i < SCREENS.length; i++) {
      $(SCREENS[i]).classList.toggle("hidden", SCREENS[i] !== id);
    }
    window.setTimeout(function () {
      var first = $(id).querySelector('[tabindex="0"],button,input,select');
      if (first) first.focus();
    }, 30);
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /* =======================  USTAWIENIA (FORMULARZ)  ======================= */

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
    /* ciche sprawdzenie: pokaże tylko informację o nowszej wersji i krótko,
       co się zmieniło — żadnego pobierania ani instalacji bez naciśnięcia przycisku */
    checkForUpdates(true);
    applyUiMode();
    refreshProfileSelect();
    loadProfileIntoForm(activeProfile());
    showScreen("settingsScreen");
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

  function setUpdateBusy(busy) {
    updateState.busy = !!busy;
    var check = $("checkUpdates");
    var install = $("installUpdate");
    if (check) check.disabled = !!busy;
    if (install) install.disabled = !!busy;
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
      return plugin.install({ url: asset.url, name: asset.name });
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
      toggle.textContent = t(state.orderEdit ? "group_order_done" : "group_order");
    }
    if (reset) {
      reset.classList.toggle("hidden", !(canOrder && state.orderEdit));
      reset.textContent = t("order_reset");
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
      button.textContent = item.label;
      button.setAttribute("data-key", item.key);
      button.onclick = function () {
        selectGroup(item.key, button);
      };
      button.onfocus = function () {
        selectGroup(item.key, button);
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

    var favorite = document.createElement("button");
    favorite.className = "favorite-button";
    favorite.tabIndex = 0;
    favorite.textContent = isFavorite(channel) ? "★" : "☆";
    favorite.onclick = function () {
      toggleFavorite(channel);
    };
    card.appendChild(favorite);

    if (hasArchive(channel)) {
      var archive = document.createElement("button");
      archive.className = "archive-button";
      archive.tabIndex = 0;
      archive.textContent = "⏪";
      archive.title = "Archiwum / catch-up";
      archive.onclick = function () {
        openArchive(channel);
      };
      card.appendChild(archive);
    }
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

  function openArchive(channel) {
    state.selectedChannel = channel;
    $("archiveTitle").textContent = t("archive_title") + channel.name;

    var days = channel.catchupDays > 0 ? Math.min(channel.catchupDays, settings.archiveDays) : settings.archiveDays;
    $("archiveSubtitle").textContent = days + t("days_back");

    var now = Date.now();
    var from = now - 86400000 * days;
    var entries = programsFor(channel).filter(function (program) {
      return program.start >= from && program.start < now && program.end > program.start;
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
      var button = document.createElement("button");
      button.className = "program";
      button.tabIndex = 0;
      var time = document.createElement("time");
      time.textContent = formatRange(program.start, program.end);
      button.appendChild(time);
      var label = document.createElement("span");
      label.textContent = program.title;
      button.appendChild(label);
      button.onclick = function () {
        playChannel(channel, program, "archiveScreen");
      };
      container.appendChild(button);
    });

    showScreen("archiveScreen");
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
    });

    video.addEventListener("pause", function () {
      markWatchedTime();
      clearTimeout(state.recentTimer);
      updateOsd();
      /* obraz zatrzymany — pasek informacyjny zostaje na ekranie */
      clearTimeout(state.osdTimer);
      state.osdTimer = null;
    });

    /* buforowanie: pasek mówi wprost, co się dzieje i który silnik pracuje */
    video.addEventListener("waiting", function () {
      if (!state.currentSource) return;
      showPlayerError(t("osd_buffering") + " (" + engineLabel(state.engine) + ")");
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

    state.playerReturn = returnScreen || "browserScreen";
    state.isArchive = !!program;
    state.retryCount = 0;
    state.cycle = 0;
    state.sourceIndex = -1;          /* -1 → pierwszy wpis wybierze nextSourceEntry() */
    state.watchChannel = channel;
    state.watchProgram = program || null;
    state.lastErrorAt = 0;
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
    var badge = $("playerBadge");
    badge.textContent = program ? t("catchup") : t("live");
    badge.classList.toggle("archive", !!program);
    buildOsdActions();
    updateOsd();
    if (settings.osdEnabled !== false) showOsd();

    nextSourceEntry("", 0, true);
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
    /* unieważnia spóźnione wczytywanie biblioteki po wyjściu z kanału */
    nextEngineToken();
    destroyEngine();
    hideContextMenu();
    hideOsd();
    video.pause();
    video.removeAttribute("src");
    video.load();
    showScreen(state.playerReturn);
  }

  /* Krok przewijania z ustawień („Krok przewijania archiwum”: 5 / 10 / 30 s) */
  function seekStep() {
    var step = parseInt(settings.seekSeconds, 10);
    return step > 0 ? step : 10;
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

    /* kanał na żywo: ⏪ wchodzi w catch-up o krok, ⏩ nie ma czego przewijać */
    if (!state.isArchive) {
      if (direction < 0) timeshiftBack();
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

    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + direction * step));
    $("playerProgress").style.width = (video.currentTime / video.duration) * 100 + "%";
    $("playerTime").textContent = formatTime(video.currentTime) + " / " + formatTime(video.duration);
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
    var program = currentProgram(channel);

    playChannel(channel, {
      start: now - (behind + seekStep()) * 1000,
      end: now,
      title: program ? program.title : channel.name,
      timeshift: true
    }, "playerScreen");
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

  /* nawigacja pilotem: wybiera najbliższy element w kierunku strzałki */
  function focusNearest(keyCode) {
    var current = document.activeElement;
    var all = document.querySelectorAll('button,input,select,[tabindex="0"]');
    var candidates = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].offsetParent !== null && !all[i].disabled) candidates.push(all[i]);
    }
    if (!candidates.length) return;

    if (!current || candidates.indexOf(current) < 0) {
      candidates[0].focus();
      return;
    }

    var box = current.getBoundingClientRect();
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
      best.scrollIntoView(false);
    }
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

  function openGuide() {
    var now = Date.now();
    guide.windowStart = now - (now % 3600000) - 3600000;
    renderGuide();
    showScreen("guideScreen");
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
    rows.slice(0, GUIDE_ROWS).forEach(function (channel) {
      var row = document.createElement("div");
      row.className = "guide-row";

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
        var lab = document.createElement("span");
        lab.textContent = p.title;
        block.appendChild(lab);

        block.onclick = function () {
          if (isNow) playChannel(channel, null, "guideScreen");
          else if (isPast && canCatchup) playChannel(channel, p, "guideScreen");
        };
        lane.appendChild(block);
      });
      row.appendChild(lane);
      container.appendChild(row);
    });

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
    button.textContent = label;
    button.setAttribute("data-osd", id);
    button.onclick = function (event) {
      if (event) event.stopPropagation();
      action();
      scheduleOsdHide();
    };
    button.onfocus = scheduleOsdHide;
    return button;
  }

  function buildOsdActions() {
    var bar = $("playerActions");
    if (!bar) return;
    bar.textContent = "";
    var channel = state.watchChannel;
    if (!channel) return;

    bar.appendChild(osdButton("play", t("osd_pause"), togglePlayPause));

    if (state.isArchive) {
      /* nagranie: skok po archiwum i powrót do bieżącego programu */
      bar.appendChild(osdButton("prev", t("osd_prev_program"), function () { watchProgramStep(-1); }));
      bar.appendChild(osdButton("next", t("osd_next_program"), function () { watchProgramStep(1); }));
      bar.appendChild(osdButton("restart", t("osd_restart"), restartWatching));
      bar.appendChild(osdButton("live", t("osd_live"), goLive));
    } else if (currentProgram(channel)) {
      bar.appendChild(osdButton("restart", t("osd_restart"), restartWatching));
    }

    bar.appendChild(osdButton("options", t("ctx_menu"), function () {
      openContextMenu(state.watchChannel);
    }));
    bar.appendChild(osdButton("back", t("osd_back"), stopPlayback));
  }

  function togglePlayPause() {
    var video = $("video");
    if (!video) return;
    if (video.paused) {
      var promise = video.play();
      if (promise && promise.catch) promise.catch(function () {});
    } else {
      video.pause();
    }
    updateOsd();
    scheduleOsdHide();
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
          ? t("osd_next_label") + " " + osdTime(next.start) + "  " + next.title
          : "";
      }
      if (timeEl) {
        timeEl.textContent = engineLabel(state.engine) +
          (video && video.paused ? " • " + t("osd_paused") : "");
      }
      if (hintEl) hintEl.textContent = t("osd_hint_live");
    }

    updateOsdProgress();

    var bar = $("playerActions");
    var playButton = bar ? bar.querySelector('[data-osd="play"]') : null;
    if (playButton) playButton.textContent = t(video && video.paused ? "osd_play" : "osd_pause");
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
      if (timeEl) timeEl.textContent = formatTime(video.currentTime) + " / " + formatTime(video.duration);
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
    button.textContent = label;
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
      openGuide();
    }));

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
    if ($("contextMenu")) {
      hideContextMenu();
      return true;
    }
    if (!$("playerScreen").classList.contains("hidden")) {
      stopPlayback();
      return true;
    }
    if (!$("archiveScreen").classList.contains("hidden")) {
      showScreen("browserScreen");
      return true;
    }
    if (!$("guideScreen").classList.contains("hidden")) {
      showScreen("browserScreen");
      return true;
    }
    if (!$("settingsScreen").classList.contains("hidden") && state.channels.length) {
      showScreen("browserScreen");
      return true;
    }
    return false;   /* nie ma czego zamykać — na Androidzie aplikacja może wyjść */
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

  var WEBOS_KEYS = platformInfo.os === "webos";

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
      /* strzałki przy widocznym pasku chodzą po jego przyciskach (mini-EPG) */
      if (osdVisible() && key >= 37 && key <= 40) {
        event.preventDefault();
        focusNearest(key);
        scheduleOsdHide();
        return;
      }
      /* przewijanie: ⏪/⏩ (webOS 412/417), Android 89/90, ◀ ▶ w archiwum;
         na kanale na żywo ⏪ wchodzi w catch-up o krok, a ⏩ na końcu okna
         (program, który wciąż leci) wraca na żywo */
      if (key === 412 || key === 89 || ((key === 37) && settings.dpadSeek)) {
        event.preventDefault();
        seekBy(-1);
        return;
      }
      if (key === 417 || key === 90 || ((key === 39) && settings.dpadSeek)) {
        event.preventDefault();
        seekBy(1);
        return;
      }
      /* OK: krótko = pasek/kliknięcie, trzymane = menu opcji kanału */
      if (key === 13 || key === 23 || key === 66) {
        event.preventDefault();
        if (event.repeat) return;
        var active = document.activeElement;
        var osdTarget = active && active.getAttribute && active.getAttribute("data-osd") ? active : null;
        startOkHold(osdTarget ? function () { osdTarget.click(); } : null);
        return;
      }
      /* play/pauza: klawisze multimedialne obu platform */
      if (key === 415 || key === 85 || key === 126 || (key === 19 && WEBOS_KEYS)) {
        event.preventDefault();
        togglePlayPause();
        return;
      }
      if (key === 127 || key === 93) {
        event.preventDefault();
        var video = $("video");
        if (video && !video.paused) video.pause();
        updateOsd();
        return;
      }
      /* MENU (webOS/Tizen 18, Android 82) i ▼ poza paskiem — opcje kanału */
      if (key === 82 || key === 18 || key === 40) {
        event.preventDefault();
        openContextMenu(state.watchChannel);
        return;
      }
      /* ▲ — przywołaj pasek informacyjny z mini-EPG */
      if (key === 38) {
        event.preventDefault();
        showOsd();
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
     wykonuje dokładnie jedną rzecz (krótkie OK albo menu przy trzymaniu). */
  document.addEventListener("keyup", function (event) {
    if (event.keyCode === 13 || event.keyCode === 23 || event.keyCode === 66) releaseOk();
  });

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

  $("playlistFile").onchange = function () {
    var file = this.files && this.files[0];
    if (!file) return;
    readFile(file, false).then(function (text) {
      draft.playlistText = String(text || "");
      draft.playlistName = file.name || "playlist.m3u";
      $("settingsError").textContent = "";
      updatePlaylistPicker();
    }, function () {
      $("settingsError").textContent = "Nie udało się odczytać pliku M3U.";
    });
  };

  $("epgFile").onchange = function () {
    var file = this.files && this.files[0];
    if (!file) return;
    /* plik EPG czytamy binarnie — GZIP rozpoznajemy po nagłówku, więc
       spakowany plik o nazwie .xml też się rozpakuje */
    readFile(file, true).then(function (result) {
      try {
        draft.epgText = gunzipText(result);
        draft.epgName = file.name || "epg.xml";
        $("settingsError").textContent = "";
        updateEpgPicker();
      } catch (error) {
        $("settingsError").textContent = "Nie udało się rozpakować pliku EPG: " + error.message;
      }
    }, function () {
      $("settingsError").textContent = "Nie udało się odczytać pliku EPG.";
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
  $("openGuide").onclick = openGuide;
  var archiveClose = $("archiveClose");
  if (archiveClose) archiveClose.onclick = function () { showScreen("browserScreen"); };
  $("guidePrevDay").onclick = function () { guideShiftDays(-1); };
  $("guideNextDay").onclick = function () { guideShiftDays(1); };
  $("guideYesterday").onclick = function () { guideGoToDayOffset(-1); };
  $("guideDayBefore").onclick = function () { guideGoToDayOffset(-2); };
  $("guideToday").onclick = guideGoToday;
  $("guideDate").onchange = function () { guideGoToDate(this.value); };
  $("guideTime").onchange = function () { guideGoToTime(this.value); };
  $("guideClose").onclick = function () { showScreen("browserScreen"); };
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













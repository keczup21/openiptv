/* TeleIPTV — rozmiar interfejsu: rozdzielczość ekranu → skala układu.
 *
 * Ten sam projekt (1920 px szerokości) trafia na telewizory 720p, 1080p i 4K,
 * telefony oraz komputery. Moduł liczy, ile pikseli naprawdę ma ekran
 * (px CSS ekranu × gęstość) i wybiera szerokość układu:
 *
 *   • 1080p i większe — układ 1920 px, czyli dokładnie ten sam projekt co dotąd,
 *   • 720p i mniejsze — układ węższy (do 1371 px), więc wszystko jest większe
 *     o tyle, że litery mają tyle samo pikseli ekranu co na 1080p,
 *   • „Rozmiar interfejsu” w ustawieniach pozwala wybrać skalę ręcznie:
 *     100% (1920 px), 115% (1670 px), 130% (1477 px), 150% (1280 px).
 *
 * Szerokość układu ustawiamy w „meta viewport” jeszcze przed pierwszym
 * rysowaniem strony (skrypt w index.html) — tak samo, jak robi to
 * MainActivity.applyTvViewport na Androidzie, gdzie układ 1920 px skaluje się
 * do szerokości ekranu. Na komputerze przeglądarki ignorują „meta viewport”,
 * więc tam skalę robi zoom CSS.
 *
 * Moduł jest wspólny dla index.html (przed pierwszym rysowaniem) i app.js
 * (ustawienia i informacja o wykrytym ekranie), żeby oba miejsca liczyły
 * dokładnie to samo.
 */
(function (global) {
  "use strict";

  var SETTINGS_KEY = "openiptvSettings";   // ten sam klucz czyta app.js
  var BASE_CANVAS = 1920;                  // szerokość projektu (px CSS)
  var BASE_HEIGHT = 1080;                  // projektowa wysokość ekranu (1080p)
  var MIN_CANVAS = 1280;                   // węższego układu ten projekt nie uniesie
  var MAX_FACTOR = 1.4;                    // automat: najwyżej +40% (ekran 720p i mniejsze)

  /* ręczne skale z ustawień — klucz to wartość z <select id="uiScale"> */
  var FACTORS = { "1": 1, "1.15": 1.15, "1.3": 1.3, "1.5": 1.5 };

  var TV_UA = /web0s|webos|netcast|smarttv|hbbtv|viera|bravia|firetv|fire tv|(^|[^a-z])aft[a-z0-9]{1,2}([^a-z]|$)|android tv|leanback|shield|droidlogic/;
  var MOBILE_UA = /android|iphone|ipod|ipad|silk|kindle/;

  function ua(win) {
    return String((win && win.navigator && win.navigator.userAgent) || "").toLowerCase();
  }

  function looksLikeTv(win) {
    return TV_UA.test(ua(win));
  }

  function looksLikeMobile(win) {
    return MOBILE_UA.test(ua(win));
  }

  function isNative(win) {
    var cap = win && win.Capacitor;
    return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  }

  /* Czy przeglądarka zwraca uwagę na „meta viewport”? Telewizor i telefon tak —
     tam szerokość układu ustawiamy tą drogą. Na komputerze nie, więc zostaje
     zoom CSS. */
  function honorsViewport(win) {
    return looksLikeTv(win) || looksLikeMobile(win) || isNative(win);
  }

  /* Kontekst urządzenia — jedno miejsce, z którego korzystają index.html i app.js */
  function context(win) {
    return {
      tv: looksLikeTv(win),
      mobile: looksLikeMobile(win),
      native: isNative(win),
      viewport: honorsViewport(win)
    };
  }

  function num(value, fallback) {
    var n = typeof value === "number" ? value : parseFloat(value);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  function round(value, digits) {
    var k = Math.pow(10, digits === undefined ? 2 : digits);
    return Math.round(value * k) / k;
  }

  /* Rozdzielczość ekranu i okno, w którym układa się strona:
       cssW/cssH   — ekran tak, jak podaje go przeglądarka (px CSS),
       physW/physH — piksele fizyczne (ekran × gęstość) — z tego liczymy skalę,
       viewW/viewH — okno układu (px CSS), czyli bieżąca szerokość układu
                     (po ustawieniu „meta viewport” = wybrana szerokość). */
  function metrics(win) {
    var w = win || global;
    var doc = w.document || {};
    var el = doc.documentElement || {};
    var screenRef = w.screen || {};
    var dpr = num(w.devicePixelRatio, 1);
    var viewW = num(w.innerWidth, num(el.clientWidth, BASE_CANVAS));
    var viewH = num(w.innerHeight, num(el.clientHeight, BASE_HEIGHT));
    var cssW = num(screenRef.width, viewW);
    var cssH = num(screenRef.height, viewH);
    return {
      dpr: round(dpr, 2),
      cssW: Math.round(cssW),
      cssH: Math.round(cssH),
      physW: Math.round(cssW * dpr),
      physH: Math.round(cssH * dpr),
      viewW: Math.round(viewW),
      viewH: Math.round(viewH)
    };
  }

  /* Skala automatyczna: taka, żeby litera miała tyle samo pikseli ekranu co na
     1080p. Ekran 720p dostałby +50%, ale trzymamy +40%, żeby w układzie został
     jeszcze zapas miejsca; 4K zostaje na 100%, bo z tej samej odległości widać
     ten sam rozmiar względny, a projekt jest ten sam. */
  function autoFactor(m) {
    var phys = num(m && m.physH, BASE_HEIGHT);
    var f = BASE_HEIGHT / phys;
    if (f < 1) f = 1;
    if (f > MAX_FACTOR) f = MAX_FACTOR;
    return round(f, 2);
  }

  function isFactor(value) {
    return Object.prototype.hasOwnProperty.call(FACTORS, String(value));
  }

  /* skala z ustawień: wartość z FACTORS albo „auto” (wtedy wg wykrytego ekranu) */
  function factor(setting, m, ctx) {
    var key = String(setting);
    if (isFactor(key)) return FACTORS[key];
    return (ctx && ctx.tv) ? autoFactor(m) : 1;
  }

  /* szerokość układu w px CSS dla danej skali (100% = 1920 px) */
  function canvasWidth(f, ctx) {
    if (!(ctx && ctx.tv)) return 0;
    var w = Math.round(BASE_CANVAS / (f > 0 ? f : 1));
    return w < MIN_CANVAS ? MIN_CANVAS : w;
  }

  function viewportContent(f, ctx) {
    if (ctx && ctx.tv) return "width=" + canvasWidth(f, ctx);
    if (ctx && ctx.mobile && f !== 1) return "width=device-width,initial-scale=" + f;
    return "width=device-width,initial-scale=1";
  }

  /* Zapisane ustawienie „Rozmiar interfejsu” — czytane wprost z localStorage,
     bo index.html potrzebuje go zanim wczyta się app.js. */
  function readSetting(win) {
    var w = win || global;
    try {
      var raw = (w.localStorage && w.localStorage.getItem(SETTINGS_KEY)) || "{}";
      var stored = JSON.parse(raw) || {};
      return isFactor(stored.uiScale) ? String(stored.uiScale) : "auto";
    } catch (e) {
      return "auto";
    }
  }

  function viewportMeta(doc) {
    var meta = doc.querySelector ? doc.querySelector('meta[name="viewport"]') : null;
    if (meta) return meta;
    meta = doc.createElement("meta");
    meta.setAttribute("name", "viewport");
    doc.head.appendChild(meta);
    return meta;
  }

  /* Ustawia szerokość układu (albo zoom na komputerze) dla wybranej skali.
     Wołane i z index.html (przed pierwszym rysowaniem), i z app.js (po zmianie
     ustawienia — tam „meta viewport” zmieniamy już na działającej stronie). */
  function applyToPage(doc, f, ctx) {
    if (!doc) return;
    if (ctx && ctx.viewport) {
      var meta = viewportMeta(doc);
      var content = viewportContent(f, ctx);
      if (meta.getAttribute("content") !== content) meta.setAttribute("content", content);
    }
    var root = doc.documentElement;
    if (!root || !root.style) return;
    /* komputerowe przeglądarki nie słuchają „meta viewport” — tam skalujemy zoomem */
    var zoom = (!ctx || !ctx.viewport) && f !== 1 ? String(f) : "";
    if (root.style.zoom !== zoom) root.style.zoom = zoom;
  }

  /* Najczęstszy przypadek: ustaw viewport wg zapisanego ustawienia (index.html,
     przed pierwszym rysowaniem). Zwraca wybraną skalę — przydaje się w testach. */
  function applyViewport(win) {
    var w = win || global;
    var ctx = context(w);
    var f = factor(readSetting(w), metrics(w), ctx);
    applyToPage(w.document, f, ctx);
    return f;
  }

  /* Starsze WebView potrafią zignorować zmianę „meta viewport” już po wczytaniu
     strony — wtedy trzeba wczytać stronę ponownie (index.html ustawia szerokość
     przed pierwszym rysowaniem, więc nic nie mruga). Zwraca true tylko wtedy,
     gdy układ nadal ma inną szerokość niż wybrana skala. */
  function canvasMismatch(win, f, ctx) {
    if (!ctx || !ctx.viewport || !ctx.tv) return false;
    var want = canvasWidth(f, ctx);
    return Math.abs(metrics(win).viewW - want) > 4;
  }

  global.OpenIPTVScale = {
    SETTINGS_KEY: SETTINGS_KEY,
    BASE_CANVAS: BASE_CANVAS,
    BASE_HEIGHT: BASE_HEIGHT,
    MIN_CANVAS: MIN_CANVAS,
    MAX_FACTOR: MAX_FACTOR,
    FACTORS: FACTORS,
    autoFactor: autoFactor,
    isFactor: isFactor,
    factor: factor,
    canvasWidth: canvasWidth,
    viewportContent: viewportContent,
    metrics: metrics,
    context: context,
    looksLikeTv: looksLikeTv,
    honorsViewport: honorsViewport,
    readSetting: readSetting,
    applyToPage: applyToPage,
    applyViewport: applyViewport,
    canvasMismatch: canvasMismatch
  };
})(typeof window !== "undefined" ? window : this);

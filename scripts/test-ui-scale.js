/* Test rozmiaru interfejsu (www/ui-scale.js) - bez telewizora.
   Sprawdza to samo, co robi aplikacja na telewizorze: wykryta rozdzielczosc
   ekranu (piksele fizyczne = px CSS ekranu x gestosc) -> skala -> szerokosc
   ukladu wpisana do "meta viewport". Dodatkowo pilnuje, ze index.html i app.js
   sa z modulem zgodne (id="uiScale", id="screenInfo", klucze tlumaczen).

   Uruchomienie: npm run test:ui */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MODULE = path.join(ROOT, "www", "ui-scale.js");
const HTML = path.join(ROOT, "www", "index.html");
const APP = path.join(ROOT, "www", "app.js");
const src = fs.readFileSync(MODULE, "utf8").replace(/\r\n/g, "\n");
const html = fs.readFileSync(HTML, "utf8").replace(/\r\n/g, "\n");
const app = fs.readFileSync(APP, "utf8").replace(/\r\n/g, "\n");

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  OK   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "   -> " + extra : "")); }
}

/* --- atrapa przegladarki / telewizora ------------------------------------ */
const TV_UA = "Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7255) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/106 Safari/537.36";
const WEBOS_UA = "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68 Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36";

function fakeDoc() {
  const metas = [];
  return {
    metas: metas,
    doc: {
      head: { appendChild: function (el) { metas.push(el); } },
      querySelector: function () { return metas.length ? metas[0] : null; },
      createElement: function (tag) {
        return {
          tagName: tag,
          attrs: {},
          setAttribute: function (k, v) { this.attrs[k] = v; },
          getAttribute: function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }
        };
      },
      documentElement: { clientWidth: 1920, clientHeight: 1080, style: {} }
    }
  };
}

/* ekran 1080p telewizora: okno 960x540 px CSS przy gestosci 2 -> 1920x1080 px */
function tvWin(opt) {
  const o = opt || {};
  const dom = fakeDoc();
  const win = {
    navigator: { userAgent: o.ua === undefined ? TV_UA : o.ua },
    screen: o.screen === undefined ? { width: 960, height: 540 } : o.screen,
    devicePixelRatio: o.dpr === undefined ? 2 : o.dpr,
    innerWidth: o.viewW === undefined ? 1920 : o.viewW,
    innerHeight: o.viewH === undefined ? 1080 : o.viewH,
    localStorage: { getItem: function () { return o.raw === undefined ? null : o.raw; } },
    document: dom.doc
  };
  if (o.native) win.Capacitor = { isNativePlatform: function () { return true; } };
  win.window = win;
  dom.win = win;
  return dom;
}

function loadApi(dom) {
  const ctx = vm.createContext(dom.win);
  vm.runInContext(src, ctx);
  return dom.win.OpenIPTVScale;
}

/* --- 1. rozdzielczosc ekranu -------------------------------------------- */
const d1080 = tvWin({});
const api = loadApi(d1080);
const m1080 = api.metrics(d1080.win);
check("1080p Fire TV: ekran rozpoznany jako 1920x1080 px",
  m1080.physW === 1920 && m1080.physH === 1080, JSON.stringify(m1080));
check("gestosc i okno ukladu czytane poprawnie",
  m1080.dpr === 2 && m1080.cssW === 960 && m1080.viewW === 1920, JSON.stringify(m1080));

const d720 = tvWin({ screen: { width: 853, height: 480 }, dpr: 1.5, viewW: 1280, viewH: 720 });
const api720 = loadApi(d720);
const m720 = api720.metrics(d720.win);
check("720p Fire TV: ekran rozpoznany jako 1280x720 px",
  m720.physW === 1280 && m720.physH === 720, JSON.stringify(m720));

const d4k = tvWin({ screen: { width: 1920, height: 1080 }, dpr: 2 });
const api4k = loadApi(d4k);
const m4k = api4k.metrics(d4k.win);
check("4K: ekran rozpoznany jako 3840x2160 px",
  m4k.physW === 3840 && m4k.physH === 2160, JSON.stringify(m4k));

const mDesktop = api.metrics(tvWin({ ua: DESKTOP_UA, screen: { width: 1920, height: 1080 }, dpr: 1.25 }).win);
check("monitor 1920 px przy 125% to 2400x1350 px",
  mDesktop.physW === 2400 && mDesktop.physH === 1350, JSON.stringify(mDesktop));

/* --- 2. skala automatyczna ---------------------------------------------- */
check("automat na 1080p zostawia projekt bez zmian (100%)", api.autoFactor(m1080) === 1, String(api.autoFactor(m1080)));
check("automat na 720p powieksza interfejs o 40%", api720.autoFactor(m720) === 1.4, String(api720.autoFactor(m720)));
check("automat na 4K nie zmienia skali", api4k.autoFactor(m4k) === 1, String(api4k.autoFactor(m4k)));
const m768 = api.metrics(tvWin({ screen: { width: 1366, height: 768 }, dpr: 1 }).win);
check("ekran 768 px wysokosci tez dostaje maksimum (1.4)", api.autoFactor(m768) === 1.4, String(api.autoFactor(m768)));
const m900 = api.metrics(tvWin({ screen: { width: 1600, height: 900 }, dpr: 1 }).win);
check("posrednia wysokosc 900 px daje skale posrednia (1.2)", api.autoFactor(m900) === 1.2, String(api.autoFactor(m900)));
check("brak informacji o ekranie nie psuje skali", api.autoFactor(null) === 1, String(api.autoFactor(null)));

/* --- 3. skala z ustawien ------------------------------------------------ */
check("reczna skala wygrywa z automatem (130% na 1080p)", api.factor("1.3", m1080, { tv: true }) === 1.3);
check("reczna 115% dziala tez na 720p", api720.factor("1.15", m720, { tv: true }) === 1.15);
check("na komputerze automat nie skaluje", api.factor("auto", m1080, { tv: false }) === 1);
check("nieznana wartosc wraca do automatu", api.factor("bzdura", m720, { tv: true }) === 1.4);
check("klucz z prototypu nie udaje skali",
  api.isFactor("constructor") === false && api.factor("constructor", m1080, { tv: true }) === 1);
check("wszystkie cztery skale z listy sa znane",
  ["1", "1.15", "1.3", "1.5"].every(function (v) { return api.isFactor(v); }));
check("liczba 1.3 dziala tak samo jak tekst", api.isFactor(1.3) === true && api.factor(1.3, m1080, { tv: true }) === 1.3);

/* --- 4. szerokosc ukladu (px CSS) --------------------------------------- */
check("100% -> uklad 1920 px (jak dotad)", api.canvasWidth(1, { tv: true }) === 1920, String(api.canvasWidth(1, { tv: true })));
check("115% -> uklad 1670 px", api.canvasWidth(1.15, { tv: true }) === 1670, String(api.canvasWidth(1.15, { tv: true })));
check("130% -> uklad 1477 px", api.canvasWidth(1.3, { tv: true }) === 1477, String(api.canvasWidth(1.3, { tv: true })));
check("150% -> uklad 1280 px", api.canvasWidth(1.5, { tv: true }) === 1280, String(api.canvasWidth(1.5, { tv: true })));
check("automat na 720p -> uklad 1371 px", api.canvasWidth(1.4, { tv: true }) === 1371, String(api.canvasWidth(1.4, { tv: true })));
check("poza telewizorem uklad nie jest wymuszany", api.canvasWidth(1.3, { tv: false }) === 0);
check("uklad nigdy nie schodzi ponizej 1280 px", api.canvasWidth(9, { tv: true }) === 1280, String(api.canvasWidth(9, { tv: true })));

/* --- 5. "meta viewport", ktora ustawia sie przed pierwszym rysowaniem ---- */
check("telewizor 100% -> width=1920 (bez zmian wobec 1.19.4)", api.viewportContent(1, { tv: true }) === "width=1920");
check("telewizor 130% -> width=1477", api.viewportContent(1.3, { tv: true }) === "width=1477");
check("telefon 115% -> initial-scale=1.15",
  api.viewportContent(1.15, { tv: false, mobile: true }) === "width=device-width,initial-scale=1.15");
check("telefon 100% -> jak dotad", api.viewportContent(1, { tv: false, mobile: true }) === "width=device-width,initial-scale=1");
check("komputer -> meta bez zmian (skaluje zoom CSS)",
  api.viewportContent(1.3, { tv: false, mobile: false }) === "width=device-width,initial-scale=1");

/* --- 6. ustawienie zapisane w localStorage ------------------------------- */
check("brak zapisu -> automat", api.readSetting(tvWin({}).win) === "auto");
check("zapisana skala 1.3 jest czytana", api.readSetting(tvWin({ raw: "{\"uiScale\":\"1.3\"}" }).win) === "1.3");
check("zapisana bzdura -> automat", api.readSetting(tvWin({ raw: "{\"uiScale\":\"abc\"}" }).win) === "auto");
check("uszkodzony zapis nie wywraca czytania", api.readSetting(tvWin({ raw: "{to nie json" }).win) === "auto");
check("brak pamieci urzadzenia nie wywraca czytania",
  api.readSetting({ localStorage: { getItem: function () { throw new Error("brak"); } } }) === "auto");

/* --- 7. index.html ustawia uklad przed pierwszym rysowaniem -------------- */
const dHtml = tvWin({ raw: "{\"uiScale\":\"1.3\"}" });
const apiHtml = loadApi(dHtml);
const applied = apiHtml.applyViewport(dHtml.win);
check("strona startuje od razu z ukladem 1477 px",
  applied === 1.3 && dHtml.metas.length === 1 && dHtml.metas[0] && dHtml.metas[0].attrs.content === "width=1477",
  JSON.stringify(dHtml.metas.map(function (m) { return m.attrs; })));
const dHtmlAuto = tvWin({});
const apiHtmlAuto = loadApi(dHtmlAuto);
check("bez zapisanego ustawienia startuje uklad 1920 px",
  apiHtmlAuto.applyViewport(dHtmlAuto.win) === 1 && dHtmlAuto.metas[0].attrs.content === "width=1920",
  JSON.stringify(dHtmlAuto.metas.map(function (m) { return m.attrs; })));

/* --- 8. czy trzeba wczytac strone jeszcze raz --------------------------- */
check("uklad sie nie zgadza (1920 zamiast 1477) -> jedno wczytanie strony",
  apiHtml.canvasMismatch(dHtml.win, 1.3, { tv: true, viewport: true }) === true);
const dOk = tvWin({ viewW: 1477 });
const apiOk = loadApi(dOk);
check("uklad sie zgadza -> bez wczytywania", apiOk.canvasMismatch(dOk.win, 1.3, { tv: true, viewport: true }) === false);
check("na komputerze nigdy nie wczytujemy strony", apiOk.canvasMismatch(dOk.win, 1.3, { tv: false, viewport: false }) === false);
check("na telefonie (uklad ekranu) nie wczytujemy strony", apiOk.canvasMismatch(dOk.win, 1.3, { tv: false, viewport: true }) === false);

/* --- 9. rozpoznanie urzadzenia ----------------------------------------- */
check("Fire TV rozpoznany jako telewizor", api.looksLikeTv(tvWin({}).win) === true);
check("webOS rozpoznany jako telewizor", api.looksLikeTv(tvWin({ ua: WEBOS_UA }).win) === true);
check("komputer nie jest telewizorem", api.looksLikeTv(tvWin({ ua: DESKTOP_UA }).win) === false);
check("telewizor slucha meta viewport", api.honorsViewport(tvWin({}).win) === true);
check("komputer nie slucha meta viewport", api.honorsViewport(tvWin({ ua: DESKTOP_UA }).win) === false);
check("aplikacja natywna jest traktowana jak ekran z meta viewport",
  api.honorsViewport(tvWin({ ua: DESKTOP_UA, native: true }).win) === true);

/* --- 10. zgodnosc z index.html i app.js --------------------------------- */
const iModule = html.indexOf('src="ui-scale.js"');
const iApp = html.indexOf('src="app.js"');
check("index.html laduje ui-scale.js przed app.js", iModule > 0 && iApp > iModule, iModule + " / " + iApp);
check("index.html ma liste rozmiaru interfejsu", html.indexOf('id="uiScale"') > 0);
check("index.html ma linie z wykrytym ekranem", html.indexOf('id="screenInfo"') > 0);

const iSelect = html.indexOf('id="uiScale"');
const scaleSelect = html.slice(iSelect, html.indexOf("</select>", iSelect));
const optionValues = [];
const optRe = /<option value="(auto|1|1.15|1.3|1.5)"/g;
let optMatch;
while ((optMatch = optRe.exec(scaleSelect)) !== null) optionValues.push(optMatch[1]);
check("lista ustawien ma automat i cztery skale",
  optionValues.length === 5 && optionValues[0] === "auto" &&
  optionValues.slice(1).every(function (v) { return api.isFactor(v); }),
  optionValues.join(", "));

const plPart = app.slice(app.indexOf("var I18N_PL"), app.indexOf("var I18N_EN"));
const enPart = app.slice(app.indexOf("var I18N_EN"), app.indexOf("var I18N = {"));
const usedKeys = (scaleSelect.match(/data-i18n="[a-z_0-9]+"/g) || []).map(function (s) {
  return s.replace('data-i18n="', "").replace('"', "");
}).concat(["ui_scale", "screen_info", "scale_source_auto", "scale_source_manual"]);
const missing = [];
usedKeys.forEach(function (k) {
  if (plPart.indexOf(k + ":") < 0) missing.push(k + " (PL)");
  if (enPart.indexOf(k + ":") < 0) missing.push(k + " (EN)");
});
check("nowe napisy sa i po polsku, i po angielsku", missing.length === 0, missing.join(", "));

check("app.js ma domyslne ustawienie uiScale", app.indexOf('uiScale: "auto"') > 0);
const scaleCalls = (app.match(/applyUiScale\(\);/g) || []).length;
check("skala jest przeliczana przy starcie, w ustawieniach i po zmianie jezyka",
  scaleCalls >= 4, String(scaleCalls));
check("skalowanie na komputerze zostaje w ui-scale.js (app.js go nie dubluje)",
  app.indexOf("document.documentElement.style.zoom") < 0);
check("stary skrypt viewportu z index.html zniknal (nie ma dwoch meta viewport)",
  html.indexOf("applyTvViewport") > 0 && html.indexOf("createElement(\"meta\")") < 0);

console.log("");
if (fails) { console.log("BLEDY: " + fails); process.exit(1); }
console.log("Wszystkie sprawdzenia przeszly.");

/* Test wyboru pliku M3U / EPG na telewizorze - bez telewizora i bez emulatora.
   Na Fire TV czesto nie ma zadnej aplikacji, ktora umie pokazac systemowe okno
   wyboru plikow: ukryte pole <input type="file"> nie ma wtedy czego otworzyc
   i przycisk "Wybierz plik" milczy (zgloszony blad). Wybor przejmuje plugin
   natywny OpenIptvFiles (android/.../FilePlugin.java), a gdy i jego nie ma
   (webOS), aplikacja mowi wprost, czym zastapic plik, zamiast nic nie robic.

   Test sprawdza trzy warstwy:
     1. www/index.html + www/app.js - przyciski, plugin, czytanie pliku, napisy,
     2. paczka Android - plugin, jego rejestracja i uprawnienie do pamieci,
     3. zachowanie - prawdziwe funkcje wyciagniete z www/app.js (vm), na atrapach
        pluginu i sieci: udany wybor, anulowanie, brak wyboru, blad odczytu.
   Uruchomienie: npm run test:pick */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const INDEX = path.join(ROOT, "www", "index.html");
const APP = path.join(ROOT, "www", "app.js");
const CSS = path.join(ROOT, "www", "styles.css");
const JAVA = path.join(ROOT, "android", "app", "src", "main", "java", "pl", "openiptv", "player");
const PLUGIN = path.join(JAVA, "FilePlugin.java");
const ACTIVITY = path.join(JAVA, "MainActivity.java");
const MANIFEST = path.join(ROOT, "android", "app", "src", "main", "AndroidManifest.xml");

const html = fs.readFileSync(INDEX, "utf8");
const app = fs.readFileSync(APP, "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(CSS, "utf8");
const java = fs.readFileSync(PLUGIN, "utf8");
const activity = fs.readFileSync(ACTIVITY, "utf8");
const manifest = fs.readFileSync(MANIFEST, "utf8");

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  OK   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "   -> " + extra : "")); }
}
function flush() {
  return new Promise(function (done) { setImmediate(function () { setImmediate(done); }); });
}

console.log("wybor pliku M3U / EPG (Fire TV, Android TV)");

/* --- 1. przyciski w interfejsie ----------------------------------------- */

/* Pilot chodzi po elementach z tabindex, a przycisk (nie <label>) dostaje
   takze styl fokusu z trybu TV - dlatego wybor pliku musi byc <button>. */
const m3uButton = /<button[^>]*id="pickPlaylistFile"[^>]*>/.exec(html);
const epgButton = /<button[^>]*id="pickEpgFile"[^>]*>/.exec(html);

check("index.html: przycisk M3U to <button id=pickPlaylistFile> z tabindex",
  !!m3uButton && m3uButton[0].indexOf("file-picker") > 0 && m3uButton[0].indexOf('tabindex="0"') > 0,
  m3uButton ? m3uButton[0] : "brak przycisku");
check("index.html: przycisk EPG to <button id=pickEpgFile> z tabindex",
  !!epgButton && epgButton[0].indexOf("file-picker") > 0 && epgButton[0].indexOf('tabindex="0"') > 0,
  epgButton ? epgButton[0] : "brak przycisku");
check("index.html: oba przyciski maja podpis (pick_m3u_file / pick_epg_file)",
  html.indexOf('id="pickPlaylistFile"') > 0 && html.indexOf('data-i18n="pick_m3u_file"') > 0 &&
  html.indexOf('id="pickEpgFile"') > 0 && html.indexOf('data-i18n="pick_epg_file"') > 0);
check("index.html: pola pliku zostaly jako sciezka zapasowa (playlistFile / epgFile)",
  /<input[^>]*id="playlistFile"[^>]*class="file-input"[^>]*accept="\.m3u/.test(html) &&
  /<input[^>]*id="epgFile"[^>]*class="file-input"[^>]*accept="\.xml/.test(html));
check("index.html: nie ma juz <label class=file-picker> (stara, milczaca sciezka)",
  !/<label[^>]*class="file-picker"/.test(html));

/* --- 2. www/app.js: plugin, czytanie pliku, napisy ---------------------- */

check("app.js: przyciski wolaja wspolna funkcje startFilePick()",
  /pickPlaylistFile"\)\.onclick[\s\S]{0,90}startFilePick\("m3u"\)/.test(app) &&
  /pickEpgFile"\)\.onclick[\s\S]{0,90}startFilePick\("epg"\)/.test(app));
check("app.js: wybor prowadzi natywny plugin (Capacitor.Plugins.OpenIptvFiles)",
  app.indexOf("C.Plugins.OpenIptvFiles") > 0 && /plugin\.pickFile\(\{/.test(app));
check("app.js: plugin dostaje rodzaj pliku i tytul okna (kind, title)",
  /pickFile\(\{\s*kind:\s*kind,\s*title:\s*t\(/.test(app));
check("app.js: bez pluginu zostaje ukryte pole pliku (input.click())",
  /if \(input\) input\.click\(\);/.test(app));
check("app.js: na webOS jest komunikat zamiast milczenia",
  /platformInfo\.os === "webos"[\s\S]{0,80}pick_no_files/.test(app));
check("app.js: wybrany plik czytamy przez lokalny serwer Capacitora",
  app.indexOf('"/_capacitor_file_"') > 0 && app.indexOf("convertFileSrc") > 0);
check("app.js: kazda odpowiedz pluginu ma obsluge (plik, anulowanie, brak wyboru)",
  /picked\.cancelled/.test(app) && /picked\.path/.test(app) && /t\("pick_no_files"\)/.test(app));
check("app.js: EPG z pliku idzie przez gunzipText (gzip w .gz i .xml)",
  /function applyEpgFile[\s\S]{0,200}gunzipText/.test(app));
check("app.js: sciezka zapasowa (pole pliku) uzywa tych samych funkcji i napisow",
  /applyPlaylistFile\(file\.name, text\)/.test(app) && /applyEpgFile\(file\.name, result\)/.test(app) &&
  /t\("pick_m3u_error"\)/.test(app) && /t\("pick_epg_error"\)/.test(app));
check("app.js: bledny gzip pokazuje powod (pick_epg_unzip z {error})",
  /t\("pick_epg_unzip", \{ error: error\.message \}\)/.test(app));
check("app.js: pole pliku czyszczone, by ten sam plik dalo sie wybrac drugi raz",
  app.indexOf('$("epgFile").value = ""') > 0);

/* Napisy nowe w obu jezykach - inaczej na telewizorze zostaje klucz. */
const plPart = app.slice(app.indexOf("var I18N_PL"), app.indexOf("var I18N_EN"));
const enPart = app.slice(app.indexOf("var I18N_EN"), app.indexOf("var I18N = {"));
const newKeys = ["pick_no_files", "pick_m3u_error", "pick_epg_error", "pick_epg_unzip"];
const missingPl = newKeys.filter(function (k) { return plPart.indexOf(k + ":") < 0; });
const missingEn = newKeys.filter(function (k) { return enPart.indexOf(k + ":") < 0; });
check("app.js: napisy wyboru pliku sa po polsku i po angielsku (" + newKeys.length + " klucze)",
  missingPl.length === 0 && missingEn.length === 0,
  "brak PL: " + missingPl.join(",") + " | brak EN: " + missingEn.join(","));

/* --- 3. paczka Android --------------------------------------------------- */

/* Nazwa pluginu musi byc ta sama w Javie i w www - inaczej wywolanie z www
   trafia w pustke i przycisk znowu milczy. */
const pluginName = /name\s*=\s*"([A-Za-z0-9_]+)"/.exec(java);
const usedNames = [];
const usedRe = /\.Plugins\.([A-Za-z0-9_]+)/g;
let usedMatch;
while ((usedMatch = usedRe.exec(app)) !== null) usedNames.push(usedMatch[1]);
check("FilePlugin.java: klasa jest pluginem Capacitora (@CapacitorPlugin)",
  /@CapacitorPlugin\(/.test(java) && !!pluginName, "brak @CapacitorPlugin");
check("app.js i FilePlugin.java uzywaja tej samej nazwy pluginu: " +
  (pluginName ? pluginName[1] : "?"),
  !!pluginName && usedNames.indexOf(pluginName[1]) >= 0,
  "w www: " + usedNames.join(", "));
check("FilePlugin.java: pickFile({ title }) to metoda pluginu",
  /public void pickFile\(PluginCall call\)/.test(java) && java.indexOf('getString("title"') > 0);
check("FilePlugin.java: najpierw systemowe okno, potem wlasna lista katalogow",
  java.indexOf("ACTION_OPEN_DOCUMENT") > 0 && java.indexOf("ACTION_GET_CONTENT") > 0 &&
  /showFolders\(/.test(java) && java.indexOf("readableRoots") > 0 && java.indexOf("MAX_ENTRIES") > 0);
check("FilePlugin.java: bez filtra rozszerzen (playlista moze nie miec .m3u)",
  /ANY_MIME = "\*\/\*"/.test(java));
check("FilePlugin.java: kopiuje wybrany plik do pamieci aplikacji i oddaje sciezke",
  java.indexOf("copyToCache") > 0 && java.indexOf("FileOutputStream") > 0 &&
  /result\.put\("path"/.test(java));
check("FilePlugin.java: brak wyboru i anulowanie to osobne odpowiedzi",
  java.indexOf('flag("unavailable")') > 0 && java.indexOf('flag("cancelled")') > 0);
check("MainActivity: plugin jest zarejestrowany przed startem WebView",
  /registerPlugin\(FilePlugin\.class\)/.test(activity));
check("AndroidManifest.xml: czytanie pamieci tylko do Androida 12 (SDK 32)",
  /<uses-permission[^>]*READ_EXTERNAL_STORAGE[^>]*maxSdkVersion="32"/.test(manifest));

/* --- 4. style ------------------------------------------------------------ */

check("styles.css: pole pliku jest ukryte (klikalny zostaje przycisk)",
  /\.file-input \{ display: none; \}/.test(css));
check("styles.css: przycisk wyboru pliku wyglada jak dotychczas (przerywana ramka)",
  /\.file-picker \{[\s\S]{0,300}border: 2px dashed var\(--border\)/.test(css));
check("styles.css: tryb TV powieksza i podswietla przyciski (pilot widzi wybor pliku)",
  /body\.uimode-tv button \{/.test(css) && /body\.uimode-tv button:focus/.test(css));

/* --- 5. zachowanie: prawdziwe funkcje z www/app.js ----------------------- */

/* Blok wyboru pliku z app.js - tam jest cala decyzja: plugin czy pole pliku, co
   zrobic z odpowiedzia i jak pokazac blad. Kod nie jest przepisywany: leci
   z pliku do vm, a podstawiane sa tylko atrapy ($, t, draft, fetch, Capacitor). */
const bStart = app.indexOf("function nativeFilePicker(");
const bEnd = app.indexOf("function normalizeServer(");
if (bStart < 0 || bEnd < 0) throw new Error("Nie znalazlem bloku wyboru pliku w app.js");
const pickCode = app.slice(app.lastIndexOf("\n\n", bStart) + 2, app.lastIndexOf("\n\n", bEnd) + 2);
if (pickCode.indexOf("function loadPickedFile") < 0 || pickCode.indexOf("function startFilePick") < 0) {
  throw new Error("Wyciety blok nie ma funkcji wyboru pliku");
}

const PLUGIN_PATH = "/data/user/0/pl.openiptv.player/cache/picked/lista.m3u";
const M3U = "#EXTM3U\n#EXTINF:-1,TVN\nhttp://host/live/1.ts\n";

function harness(o) {
  o = o || {};
  const calls = { pick: [], fetch: [], click: 0, playlist: 0, epg: 0 };
  const errorBox = { textContent: "" };
  const plugin = o.plugin || null;

  const sandbox = {
    draft: { playlistText: "", playlistName: "", epgText: "", epgName: "" },
    platformInfo: { os: o.os || "firetv" },
    $: function (id) {
      if (id === "settingsError") return errorBox;
      return { click: function () { calls.click++; }, value: "", textContent: "" };
    },
    t: function (key, params) {
      var text = "[" + key + "]";
      if (params && params.error !== undefined) text += " (" + params.error + ")";
      return text;
    },
    gunzipText: function (buffer) {
      if (o.gunzipFails) throw new Error("zly gzip");
      return "ROZPAKOWANE " + buffer;
    },
    updatePlaylistPicker: function () { calls.playlist++; },
    updateEpgPicker: function () { calls.epg++; },
    window: {
      location: { origin: "https://localhost" },
      Capacitor: o.noCapacitor ? undefined : {
        Plugins: plugin ? { OpenIptvFiles: plugin } : undefined,
        convertFileSrc: o.convertFileSrc
      }
    },
    fetch: function (url) {
      calls.fetch.push(url);
      if (o.response) return Promise.resolve(o.response(url));
      return Promise.reject(new Error("brak sieci"));
    },
    Promise: Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(pickCode, sandbox);
  return { api: sandbox, calls: calls, error: errorBox, draft: sandbox.draft };
}
function pickerReturning(result, asked) {
  return {
    pickFile: function (options) {
      asked.push(options);
      return Promise.resolve(result);
    }
  };
}
function textFile(body) {
  return { ok: true, text: function () { return Promise.resolve(body); } };
}
function binaryFile(size) {
  return { ok: true, arrayBuffer: function () { return Promise.resolve("BIN" + size); } };
}
function rejectedFile() {
  return { ok: false, status: 404 };
}

(async function run() {
  /* 1. Telewizor z pluginem - wybor pliku M3U dochodzi do konca */
  const asked = [];
  let h = harness({
    plugin: pickerReturning({ name: "lista.m3u", path: PLUGIN_PATH }, asked),
    response: function () { return textFile(M3U); }
  });
  h.api.startFilePick("m3u");
  await flush();
  check("wybor M3U: plugin dostaje rodzaj pliku i tytul okna",
    asked.length === 1 && asked[0].kind === "m3u" && asked[0].title === "[pick_m3u_file]",
    JSON.stringify(asked));
  check("wybor M3U: plik czytany przez lokalny serwer Capacitora (/_capacitor_file_/)",
    h.calls.fetch.length === 1 && h.calls.fetch[0] === "https://localhost/_capacitor_file_" + PLUGIN_PATH,
    String(h.calls.fetch[0]));
  check("wybor M3U: tresc playlisty i nazwa trafiaja do ustawien",
    h.draft.playlistText === M3U && h.draft.playlistName === "lista.m3u");
  check("wybor M3U: widok wybranego pliku odswiezony, bez bledu",
    h.calls.playlist === 1 && h.calls.epg === 0 && h.error.textContent === "");

  /* 2. Gdy Capacitor umie sam zamienic sciezke na adres, bierzemy jego adres */
  h = harness({
    plugin: pickerReturning({ name: "lista.m3u", path: PLUGIN_PATH }, []),
    convertFileSrc: function (p) { return "http://localhost/_capacitor_file_" + p; },
    response: function () { return textFile(M3U); }
  });
  h.api.startFilePick("m3u");
  await flush();
  check("wybor M3U: adres pliku bierze sie z Capacitor.convertFileSrc",
    h.calls.fetch.length === 1 && h.calls.fetch[0] === "http://localhost/_capacitor_file_" + PLUGIN_PATH,
    String(h.calls.fetch[0]));

  /* 3. EPG czytamy binarnie (gzip) i rozpakowujemy */
  h = harness({
    plugin: pickerReturning({ name: "epg.xml.gz", path: "/storage/emulated/0/epg.xml.gz" }, []),
    response: function () { return binaryFile(12); }
  });
  h.api.startFilePick("epg");
  await flush();
  check("wybor EPG: rozpakowany program i nazwa trafiaja do ustawien",
    h.draft.epgText === "ROZPAKOWANE BIN12" && h.draft.epgName === "epg.xml.gz" && h.calls.epg === 1,
    h.draft.epgText);

  /* 4. Plik EPG z blednym gzipem - powod widac w ustawieniach */
  h = harness({
    plugin: pickerReturning({ name: "epg.xml", path: "/sdcard/epg.xml" }, []),
    gunzipFails: true,
    response: function () { return binaryFile(4); }
  });
  h.api.startFilePick("epg");
  await flush();
  check("wybor EPG: bledny gzip pokazuje powod",
    h.error.textContent === "[pick_epg_unzip] (zly gzip)", h.error.textContent);

  /* 5. Anulowanie (Wstecz w oknie wyboru) nie zmienia niczego */
  h = harness({ plugin: pickerReturning({ cancelled: true }, []) });
  h.api.startFilePick("m3u");
  await flush();
  check("anulowanie: brak czytania, brak bledu, ustawienia bez zmian",
    h.calls.fetch.length === 0 && h.error.textContent === "" && h.draft.playlistText === "");

  /* 6. Telewizor bez czym wybrac pliku (unavailable) */
  h = harness({ plugin: pickerReturning({ unavailable: true }, []) });
  h.api.startFilePick("m3u");
  await flush();
  check("brak czym wybrac (unavailable): podpowiedz, co wpisac zamiast pliku",
    h.error.textContent === "[pick_no_files]", h.error.textContent);

  /* 7. Plugin odrzuca wywolanie (np. brak aktywnosci) */
  h = harness({ plugin: { pickFile: function () { return Promise.reject(new Error("blad")); } } });
  h.api.startFilePick("m3u");
  await flush();
  check("odrzucone wywolanie pluginu: tez podpowiedz, a nie cisza",
    h.error.textContent === "[pick_no_files]", h.error.textContent);

  /* 8. Pliku nie da sie odczytac (np. wyczyszczona pamiec podreczna) */
  h = harness({
    plugin: pickerReturning({ name: "lista.m3u", path: PLUGIN_PATH }, []),
    response: function () { return rejectedFile(); }
  });
  h.api.startFilePick("m3u");
  await flush();
  check("nieczytelny plik M3U: napis o bledzie odczytu",
    h.error.textContent === "[pick_m3u_error]", h.error.textContent);

  h = harness({
    plugin: pickerReturning({ name: "epg.xml", path: "/sdcard/epg.xml" }, []),
    response: function () { return rejectedFile(); }
  });
  h.api.startFilePick("epg");
  await flush();
  check("nieczytelny plik EPG: napis o bledzie odczytu",
    h.error.textContent === "[pick_epg_error]", h.error.textContent);

  /* 9. Bez pluginu (przegladarka) zostaje ukryte pole pliku */
  h = harness({ noCapacitor: true });
  h.api.startFilePick("m3u");
  await flush();
  check("przegladarka: bez pluginu otwiera sie pole pliku (input.click)",
    h.calls.click === 1 && h.error.textContent === "");

  /* 10. Capacitor bez naszego pluginu - tez pole pliku (np. starsza paczka) */
  h = harness({});
  h.api.startFilePick("epg");
  await flush();
  check("Capacitor bez tego pluginu: tez pole pliku, bez bledu",
    h.calls.click === 1 && h.error.textContent === "");

  /* 11. webOS: pola pliku nie ma w ogole, wiec jest podpowiedz, nie cisza */
  h = harness({ noCapacitor: true, os: "webos" });
  h.api.startFilePick("m3u");
  await flush();
  check("webOS: podpowiedz zamiast martwego przycisku",
    h.calls.click === 0 && h.error.textContent === "[pick_no_files]", h.error.textContent);

  if (fails > 0) {
    console.log("\n" + fails + " sprawdzen nie przeszlo.");
    process.exit(1);
  }
  console.log("\nWszystkie sprawdzenia przeszly.");
})();





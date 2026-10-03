/* Test sprawdzania aktualizacji i warstwy sieciowej z www/app.js - bez telewizora.
   Wyciaga zrodlo funkcji z pliku (nie kopiuje logiki) i sprawdza:
   - porownywanie wersji i wybor paczki (.apk / .ipk),
   - odpowiedz natywnego HTTP: Capacitor oddaje gotowy obiekt, gdy serwer
     odpowiedzial "application/json" (GitHub API tak robi), a aplikacja czytala
     to jako tekst i pokazywala blad o panelu Xtream (zgloszony blad).
   Uruchomienie: npm run test:update */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const APP = path.join(__dirname, "..", "www", "app.js");
const src = fs.readFileSync(APP, "utf8").replace(/\r\n/g, "\n");

function slice(from, to, mustHave) {
  const iStart = src.indexOf(from);
  const iEnd = src.indexOf(to);
  if (iStart < 0 || iEnd < 0 || iEnd <= iStart) throw new Error("Nie znalazlem bloku: " + from);
  const code = src.slice(iStart, iEnd);
  if (code.indexOf(mustHave) < 0) throw new Error("Wyciety blok nie ma: " + mustHave);
  return code;
}

const versionsCode = slice("function versionParts(text)", "function nativeUpdater()", "function updateAssetFor");
const netCode = slice("function nativeHttpAvailable()", "function decodeUtf8(bytes)", "function fetchJson(url, errorKey)");

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  OK   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "   -> " + extra : "")); }
}

/* --- 1. wersje i paczka ------------------------------------------------- */
function versionHarness(os) {
  const sandbox = {
    APP_VERSION: "1.19.4",
    platformInfo: { native: true, os: os || "firetv" },
    t: function (k) { return k; }
  };
  vm.createContext(sandbox);
  vm.runInContext(versionsCode, sandbox);
  return sandbox;
}

const v = versionHarness();
check("nowsze wydanie wygrywa: v1.19.4 > 1.19.3", v.compareVersions("v1.19.4", "1.19.3") === 1);
check("ta sama wersja to zero", v.compareVersions("1.19.4", "1.19.4") === 0);
check("starsze wydanie przegrywa", v.compareVersions("1.19.3", "1.19.4") === -1);
check("porownanie jest liczbowe, nie tekstowe (1.9.0 < 1.10.0)", v.compareVersions("1.9.0", "1.10.0") === -1);
check("koncowka wydania nie przeszkadza (1.19.4-beta)", v.compareVersions("1.19.4-beta", "1.19.4") === 0);
check("krotszy numer dopelnia sie zerem (1.19 = 1.19.0)", v.compareVersions("1.19", "1.19.0") === 0);
check("paczka dla Fire TV to .apk", v.updateExtension() === "apk");
check("paczka dla webOS to .ipk", versionHarness("webos").updateExtension() === "ipk");
check("w przegladarce nie ma paczki", versionHarness("browser").updateExtension() === "");

const release = {
  tag_name: "v1.19.4",
  assets: [
    { name: "OpenIPTV-1.19.4.ipk", size: 470750 },
    { name: "inna.apk", size: 10 },
    { name: "OpenIPTV-1.19.4.apk", size: 4038058 }
  ]
};
let asset = v.updateAssetFor(release, "apk");
check("z wydania wybierany jest OpenIPTV-*.apk",
  !!asset && asset.name === "OpenIPTV-1.19.4.apk" && asset.size === 4038058,
  JSON.stringify(asset));
asset = v.updateAssetFor(release, "ipk");
check("dla webOS wybierany jest .ipk", !!asset && asset.name === "OpenIPTV-1.19.4.ipk", JSON.stringify(asset));
check("brak wydania to brak paczki", v.updateAssetFor(null, "apk") === null);
/* Nazwa paczki zmienila sie z OpenIPTV-* na TeleIPTV-* (wersja 2.0.0). Wybor
   pliku z wydania musi znac obie: nowe wydania maja nowa nazwe, a starsze
   (i wydania bez zmian) dalej nazywaja sie OpenIPTV-*. */
const releaseNew = {
  tag_name: "v2.0.0",
  assets: [
    { name: "TeleIPTV-2.0.0.apk", size: 4038058 },
    { name: "OpenIPTV-1.22.0.apk", size: 4038058 }
  ]
};
asset = v.updateAssetFor(releaseNew, "apk");
check("nowa nazwa paczki (TeleIPTV-*.apk) jest rozpoznawana",
  !!asset && asset.name === "TeleIPTV-2.0.0.apk", JSON.stringify(asset));
asset = v.updateAssetFor({ assets: [{ name: "OpenIPTV-1.22.0.apk", size: 4038058 }] }, "apk");
check("wydania sprzed przemianowania (OpenIPTV-*.apk) dalej sie instaluja",
  !!asset && asset.name === "OpenIPTV-1.22.0.apk", JSON.stringify(asset));

/* --- 1b. adres paczki do pobrania ---------------------------------------- */
/* Wazne dla aktualizacji z telewizora: pole `url` z API GitHuba oddaje metadane
   pliku w JSON-ie (kilkaset bajtow), a nie paczke — instalator odpowiadal wtedy
   „podczas analizowania pakietu wystapil problem”. Paczka jest pod
   browser_download_url. */
const apiAsset = {
  name: "OpenIPTV-1.19.4.apk",
  size: 4038058,
  url: "https://api.github.com/repos/keczup21/openiptv/releases/assets/606584608",
  browser_download_url: "https://github.com/keczup21/openiptv/releases/download/v1.19.4/OpenIPTV-1.19.4.apk"
};
check("paczke pobieramy z browser_download_url, a nie z API GitHuba",
  v.updateDownloadUrl(apiAsset) === apiAsset.browser_download_url,
  v.updateDownloadUrl(apiAsset));
check("adres z API zostaje jako zapas (plugin doklada naglowek Accept)",
  v.updateDownloadUrl({ url: apiAsset.url }) === apiAsset.url);
check("brak paczki to pusty adres", v.updateDownloadUrl(null) === "");
check("app.js podaje pluginowi wlasnie ten adres",
  src.indexOf("plugin.install({ url: updateDownloadUrl(asset)") > 0);

/* --- 2. siec: natywne HTTP Capacitora ----------------------------------- */
function netHarness(reply) {
  const calls = [];
  const sandbox = {
    window: {
      Capacitor: {
        isNativePlatform: function () { return true; },
        Plugins: {
          CapacitorHttp: {
            get: function (opts) { calls.push(opts); return reply(opts); }
          }
        }
      }
    },
    t: function (k, p) { return p ? k + " " + JSON.stringify(p) : k; },
    atob: function (b64) { return Buffer.from(b64, "base64").toString("binary"); },
    XMLHttpRequest: function () { throw new Error("XHR nie powinien byc uzyty w tym tescie"); }
  };
  vm.createContext(sandbox);
  vm.runInContext(netCode, sandbox);
  return { api: sandbox, calls: calls };
}

/* tak odpowiada GitHub i kazdy serwer z "application/json" */
function ok(data) {
  return function () { return Promise.resolve({ status: 200, data: data }); };
}

async function netTests() {
  let h = netHarness(ok(release));
  let got = await h.api.fetchJson("https://api.github.com/repos/x/releases/latest", "update_err_json");
  check("gotowy obiekt z natywnego HTTP czytany jako wydanie (zgloszony blad)",
    !!got && got.tag_name === "v1.19.4", JSON.stringify(got));

  const text = await h.api.fetchText("https://api.github.com/repos/x/releases/latest");
  check("obiekt zamieniany na tekst JSON, a nie na [object Object]",
    typeof text === "string" && text.charAt(0) === "{" && text.indexOf("v1.19.4") > 0, String(text));

  h = netHarness(ok({ user_info: { username: "u" } }));
  got = await h.api.fetchJson("http://panel/player_api.php");
  check("panel, ktory odda JSON jako obiekt, tez dziala",
    !!got && !!got.user_info && got.user_info.username === "u", JSON.stringify(got));

  h = netHarness(ok('{"user_info":{"username":"u"}}'));
  got = await h.api.fetchJson("http://panel/player_api.php");
  check("panel z tekstowym JSON dziala jak dotad",
    !!got && !!got.user_info && got.user_info.username === "u", JSON.stringify(got));

  h = netHarness(ok("<html>nie ma tu JSON-a</html>"));
  let msg = "";
  try { await h.api.fetchJson("https://api.github.com/repos/x/releases/latest", "update_err_json"); }
  catch (e) { msg = String(e.message); }
  check("zly JSON z GitHuba nie zrzuca winy na panel Xtream", msg === "update_err_json", msg);

  h = netHarness(ok("<html>login</html>"));
  msg = "";
  try { await h.api.fetchJson("http://panel/player_api.php"); }
  catch (e) { msg = String(e.message); }
  check("zly JSON z panelu dalej mowi o panelu Xtream", msg === "err_xtream_json", msg);

  h = netHarness(function (opts) {
    return Promise.resolve({ status: 200, data: opts.responseType === "arraybuffer" ? "AQID" : "{}" });
  });
  const bytes = await h.api.httpGet("https://github.com/keczup21/openiptv/releases/download/v1.19.4/OpenIPTV-1.19.4.apk", true);
  check("paczka .apk leci jako bajty (base64 -> Uint8Array)",
    !!bytes && bytes.length === 3 && bytes[0] === 1 && bytes[2] === 3,
    bytes ? String(bytes.length) + " bajtow" : String(bytes));

  h = netHarness(function () { return Promise.resolve({ status: 404, data: "" }); });
  msg = "";
  let isHttp = false;
  try { await h.api.fetchJson("https://api.github.com/repos/x/releases/latest", "update_err_json"); }
  catch (e) { msg = String(e.message); isHttp = !!e.isHttp; }
  check("404 z GitHuba zostaje bledem HTTP (komunikat o wydaniach)", isHttp && msg.indexOf("404") >= 0,
    msg + " isHttp=" + isHttp);

  h = netHarness(ok("{}"));
  const asked = await h.api.fetchText("https://api.github.com/repos/x/releases/latest");
  check("zadanie idzie z responseType tekstowym",
    h.calls.length === 1 && h.calls[0].responseType === "text" && asked === "{}",
    JSON.stringify(h.calls[0]));
}

netTests().then(function () {
  console.log("");
  if (fails) { console.log("BLEDY: " + fails); process.exit(1); }
  console.log("Wszystkie sprawdzenia przeszly.");
}, function (e) {
  console.log("  FAIL nieoczekiwany blad: " + ((e && e.stack) || e));
  process.exit(1);
});


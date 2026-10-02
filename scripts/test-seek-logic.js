/* Test logiki przewijania z www/app.js — scenariusze pilota bez telewizora.
   Wyciaga zrodlo nowych funkcji z pliku (nie kopiuje logiki) i sprawdza same
   decyzje: kiedy skok w nagraniu, kiedy powrot na zywo, kiedy okno catch-up.
   Uruchomienie: npm run test:seek */
const fs = require("fs");
const vm = require("vm");

const APP = require("path").join(__dirname, "..", "www", "app.js");
const src = fs.readFileSync(APP, "utf8").replace(/\r\n/g, "\n");

const iStart = src.indexOf("function seekStep()");
const iEnd = src.indexOf("function formatTime(seconds)");
if (iStart < 0 || iEnd < 0) throw new Error("Nie znalazlem bloku przewijania w app.js");
/* od pustej linii przed komentarzem seekStep() do pustej linii przed formatTime() */
const code = src.slice(src.lastIndexOf("\n\n", iStart) + 2, src.lastIndexOf("\n\n", iEnd) + 2);
if (code.indexOf("function timeshiftBack") < 0) throw new Error("Wyciety blok nie ma timeshiftBack");

const NOW = 1700000000000;
const CH = { name: "TVN", streamUrl: "http://host/live/u/p/12345.ts" };

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  OK   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "   -> " + extra : "")); }
}

function harness(o) {
  o = o || {};
  const calls = { play: [], goLive: 0, osd: 0, error: [], osdHide: 0 };
  const overlay = { classList: { remove: function () {}, add: function () {} } };
  const video = { duration: o.duration, currentTime: o.currentTime || 0 };
  const sandbox = {
    state: {
      watchChannel: o.noChannel ? null : CH,
      watchProgram: o.program || null,
      isArchive: !!o.isArchive
    },
    settings: { seekSeconds: o.seekSeconds === undefined ? 10 : o.seekSeconds },
    $: function (id) {
      if (id === "video") return video;
      return { style: {}, textContent: "", classList: { remove: function () {}, add: function () {} } };
    },
    playChannel: function (channel, program, screen) { calls.play.push({ channel: channel, program: program, screen: screen }); },
    goLive: function () { calls.goLive++; },
    showOsd: function () { calls.osd++; },
    showPlayerError: function (m) { calls.error.push(m); },
    scheduleOsdHide: function () { calls.osdHide++; },
    hasArchive: function () { return o.hasArchive !== false; },
    currentProgram: function () { return o.epg || null; },
    t: function (k) { return k; },
    formatTime: function (s) { return "t" + s; },
    overlayTimer: null,
    setTimeout: function () { return 0; },
    clearTimeout: function () {},
    Date: { now: function () { return NOW; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { api: sandbox, calls: calls, video: video };
}

/* --- 1. kanal na zywo --------------------------------------------------- */
let h = harness({ isArchive: false, duration: Infinity, epg: { title: "Wiadomosci" } });
h.api.seekBy(-1);
let p = h.calls.play[0];
check("na zywo wstecz: wchodzi w catch-up od teraz - krok",
  h.calls.play.length === 1 && !!p && p.program.start === NOW - 10000 && p.program.end === NOW &&
  p.program.timeshift === true && p.program.title === "Wiadomosci" && p.screen === "playerScreen",
  JSON.stringify(h.calls.play));

h = harness({ isArchive: false, duration: Infinity, seekSeconds: 30 });
h.api.seekBy(-1);
check("na zywo wstecz: krok z opcji (30 s)",
  h.calls.play.length === 1 && h.calls.play[0].program.start === NOW - 30000,
  JSON.stringify(h.calls.play));

h = harness({ isArchive: false, duration: Infinity });
h.api.seekBy(1);
check("na zywo do przodu: tylko pasek, bez zmiany kanalu",
  h.calls.osd === 1 && h.calls.play.length === 0 && h.calls.goLive === 0,
  JSON.stringify(h.calls));

h = harness({ isArchive: false, duration: Infinity, hasArchive: false });
h.api.seekBy(-1);
check("na zywo wstecz bez catch-up: komunikat err_catchup",
  h.calls.error.length === 1 && h.calls.error[0] === "err_catchup" && h.calls.play.length === 0 && h.calls.osdHide === 1,
  JSON.stringify(h.calls));

h = harness({ isArchive: false, duration: Infinity, noChannel: true });
h.api.seekBy(-1);
check("brak kanalu: nic sie nie dzieje",
  h.calls.play.length === 0 && h.calls.error.length === 0 && h.calls.osd === 0,
  JSON.stringify(h.calls));

/* --- 2. okno catch-up konczace sie na teraz (timeshift) ----------------- */
h = harness({ isArchive: true, duration: 60, currentTime: 0, program: { start: NOW - 60000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(1);
check("okno 60 s, pozycja 0: do przodu skacze o krok w nagraniu",
  h.video.currentTime === 10 && h.calls.goLive === 0 && h.calls.play.length === 0,
  "currentTime=" + h.video.currentTime);

h.api.seekBy(-1);
check("okno 60 s, pozycja 10: wstecz skacze o krok",
  h.video.currentTime === 0 && h.calls.goLive === 0 && h.calls.play.length === 0,
  "currentTime=" + h.video.currentTime);

h = harness({ isArchive: true, duration: 60, currentTime: 55, program: { start: NOW - 60000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(1);
check("okno 60 s, koniec: do przodu przechodzi na zywo",
  h.calls.goLive === 1 && h.calls.play.length === 0,
  JSON.stringify(h.calls));

h = harness({ isArchive: true, duration: 60, currentTime: 0, program: { start: NOW - 60000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(-1);
check("okno 60 s, poczatek: wstecz siega po dluzsze okno (60 s + krok)",
  h.calls.play.length === 1 && h.calls.play[0].program.start === NOW - 70000 && h.calls.play[0].program.end === NOW,
  JSON.stringify(h.calls.play));

h = harness({ isArchive: true, duration: 600, currentTime: 300, program: { start: NOW - 600000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(-1);
check("dlugie okno, srodek: wstecz tnie w miejscu bez przeadowania",
  h.video.currentTime === 290 && h.calls.play.length === 0 && h.calls.goLive === 0,
  "currentTime=" + h.video.currentTime);

/* --- 3. catch-up programu, ktory wciaz leci (zgloszony blad) ------------ */
h = harness({ isArchive: true, duration: 5400, currentTime: 5398, program: { start: NOW - 5400000, end: NOW + 600000, title: "Film" } });
h.api.seekBy(1);
check("program leci, koniec okna: do przodu wraca na zywo (naprawiony blad)",
  h.calls.goLive === 1 && h.calls.play.length === 0,
  JSON.stringify(h.calls));

h = harness({ isArchive: true, duration: 5400, currentTime: 3000, program: { start: NOW - 5400000, end: NOW + 600000, title: "Film" } });
h.api.seekBy(1);
check("program leci, srodek: do przodu skacze o krok",
  h.video.currentTime === 3010 && h.calls.goLive === 0,
  "currentTime=" + h.video.currentTime);

h = harness({ isArchive: true, duration: 5400, currentTime: 5, program: { start: NOW - 5400000, end: NOW + 600000, title: "Film" } });
h.api.seekBy(-1);
check("program leci, poczatek: wstecz siega jeszcze dalej w tyl",
  h.calls.play.length === 1 && h.calls.play[0].program.start === NOW - 5410000,
  JSON.stringify(h.calls.play));

/* --- 4. zakonczone nagranie (bez zmian) --------------------------------- */
h = harness({ isArchive: true, duration: 3600, currentTime: 3600, program: { start: NOW - 7200000, end: NOW - 3600000, title: "Stary" } });
h.api.seekBy(1);
check("zakonczone nagranie, koniec: do przodu nie wraca na zywo",
  h.calls.goLive === 0 && h.calls.play.length === 0 && h.video.currentTime === 3600,
  "currentTime=" + h.video.currentTime + " goLive=" + h.calls.goLive);

h = harness({ isArchive: true, duration: 3600, currentTime: 0, program: { start: NOW - 7200000, end: NOW - 3600000, title: "Stary" } });
h.api.seekBy(-1);
check("zakonczone nagranie, poczatek: nic nie przeadowuje",
  h.video.currentTime === 0 && h.calls.play.length === 0,
  "currentTime=" + h.video.currentTime);

/* --- 5. nagranie o nieznanej dlugosci ----------------------------------- */
h = harness({ isArchive: true, duration: Infinity, currentTime: 0, program: { start: NOW - 600000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(1);
check("okno bez znanej dlugosci: do przodu wraca na zywo",
  h.calls.goLive === 1 && h.calls.osd === 0,
  JSON.stringify(h.calls));

h = harness({ isArchive: true, duration: Infinity, currentTime: 0, program: { start: NOW - 7200000, end: NOW - 3600000, title: "Stary" } });
h.api.seekBy(-1);
check("zakonczone bez znanej dlugosci: tylko pasek (zero przeadowan)",
  h.calls.osd === 1 && h.calls.play.length === 0 && h.calls.goLive === 0,
  JSON.stringify(h.calls));

h = harness({ isArchive: true, duration: Infinity, currentTime: 0, program: { start: NOW - 7200000, end: NOW - 3600000, title: "Stary" } });
h.api.seekBy(1);
check("to samo w druga strone: tez tylko pasek",
  h.calls.osd === 1 && h.calls.goLive === 0 && h.calls.play.length === 0,
  JSON.stringify(h.calls));

console.log("");
if (fails) { console.log("BLEDY: " + fails); process.exit(1); }
console.log("Wszystkie scenariusze przeszly.");

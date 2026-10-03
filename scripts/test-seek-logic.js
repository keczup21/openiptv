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

/* Blok sterowania obrazem: ⏵‖ / pauza na zywo, wznowienie z catch-upu, wyciszenie
   (pilot: play/pauza, 🔇) — od togglePlayPause() do restartWatching(). */
const cStart = src.indexOf("function togglePlayPause()");
const cEnd = src.indexOf("function restartWatching(");
if (cStart < 0 || cEnd < 0) throw new Error("Nie znalazlem bloku sterowania obrazem w app.js");
const codeCtrl = src.slice(src.lastIndexOf("\n\n", cStart) + 2, src.lastIndexOf("\n\n", cEnd) + 2);
if (codeCtrl.indexOf("function resumePlayback") < 0 || codeCtrl.indexOf("function toggleMute") < 0) {
  throw new Error("Wyciety blok sterowania obrazem nie ma resumePlayback/toggleMute");
}

/* Blok przelaczania kanalow ▲ ▼ (CH+ / CH−): zapChannel() + listIndex(). */
const zStart = src.indexOf("function zapChannel(");
const zEnd = src.indexOf("function showPlayerError(");
if (zStart < 0 || zEnd < 0) throw new Error("Nie znalazlem bloku przelaczania kanalow w app.js");
const codeZap = src.slice(src.lastIndexOf("\n\n", zStart) + 2, src.lastIndexOf("\n\n", zEnd) + 2);
if (codeZap.indexOf("function listIndex") < 0) throw new Error("Wyciety blok nie ma listIndex");

/* Blok wejscia w kanal: playChannel() — decyduje, gdzie wraca „Wstecz” po
   wyjsciu z obrazu, i resetuje stan pauzy na zywo. */
const pStart = src.indexOf("function playChannel(");
const pEnd = src.indexOf("function zapChannel(");
if (pStart < 0 || pEnd <= pStart) throw new Error("Nie znalazlem playChannel w app.js");
const codePlay = src.slice(src.lastIndexOf("\n\n", pStart) + 2, src.lastIndexOf("\n\n", pEnd) + 2);
if (codePlay.indexOf("state.playerReturn") < 0) throw new Error("Wyciety blok nie ma playChannel");

const NOW = 1700000000000;
const CH = { name: "TVN", streamUrl: "http://host/live/u/p/12345.ts" };

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  OK   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "   -> " + extra : "")); }
}

function harness(o) {
  o = o || {};
  const calls = { play: [], goLive: 0, osd: 0, error: [], osdHide: 0, timeouts: [] };
  const overlay = { classList: { remove: function () {}, add: function () {} } };
  const video = { duration: o.duration, currentTime: o.currentTime || 0 };
  /* Atrapy elementów interfejsu (wpis na pasku, komunikat na środku obrazu):
     jedna atrapa na id, żeby dalo sie sprawdzic, co aplikacja na nim pokazuje. */
  const els = {};
  function stub(id) {
    if (!els[id]) {
      const classes = {};
      els[id] = {
        id: id,
        textContent: "",
        style: {},
        classList: {
          add: function (c) { classes[c] = true; },
          remove: function (c) { delete classes[c]; },
          contains: function (c) { return !!classes[c]; }
        }
      };
    }
    return els[id];
  }
  const sandbox = {
    state: {
      watchChannel: o.noChannel ? null : CH,
      watchProgram: o.program || null,
      isArchive: !!o.isArchive,
      /* jak w aplikacji: wpis o ostatnim skoku (markSeek / clearSeekMark) */
      seekAt: 0,
      seekDirection: 0,
      seekSize: 0,
      /* pasek otwarty klawiszem OK (menu) — skok musi go zamienić w informację */
      osdMenu: !!o.osdMenu
    },
    settings: { seekSeconds: o.seekSeconds === undefined ? 10 : o.seekSeconds },
    $: function (id) {
      if (id === "video") return video;
      return stub(id);
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
    setTimeout: function (fn, ms) { calls.timeouts.push({ fn: fn, ms: ms }); return calls.timeouts.length; },
    clearTimeout: function () {},
    Date: { now: function () { return NOW; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { api: sandbox, calls: calls, video: video, els: els };
}

/* Otoczenie dla bloku sterowania obrazem: obraz (pauza, wyciszenie) + decyzje
   o wznowieniu na kanale na zywo (catch-up) i w archiwum. */
function ctrlHarness(o) {
  o = o || {};
  const calls = { play: [], played: 0, paused: 0, osd: 0 };
  const video = {
    paused: !!o.paused,
    muted: !!o.muted,
    pause: function () { calls.paused++; this.paused = true; },
    play: function () { calls.played++; this.paused = false; return { catch: function () {} }; }
  };
  const sandbox = {
    RESUME_AFTER_PAUSE: 1500,
    state: {
      watchChannel: o.noChannel ? null : CH,
      watchProgram: o.program || null,
      isArchive: !!o.isArchive,
      livePauseAt: o.livePauseAt || 0
    },
    $: function (id) {
      if (id === "video") return video;
      return { style: {}, textContent: "", classList: { remove: function () {}, add: function () {} } };
    },
    playChannel: function (channel, program, screen) { calls.play.push({ channel: channel, program: program, screen: screen }); },
    hasArchive: function () { return o.hasArchive !== false; },
    currentProgram: function () { return o.epg || null; },
    showOsd: function () { calls.osd++; },
    updateOsd: function () {},
    scheduleOsdHide: function () {},
    t: function (k) { return k; },
    Date: { now: function () { return NOW; } }
  };
  vm.createContext(sandbox);
  vm.runInContext(codeCtrl, sandbox);
  return { api: sandbox, calls: calls, video: video };
}

/* Otoczenie dla przelaczania kanalow ▲ ▼: playlista, kategoria i klucz kanalu. */
function zapHarness(o) {
  o = o || {};
  const calls = { play: [] };
  const list = o.list || [
    { name: "A", streamUrl: "http://host/live/u/p/1.ts" },
    { name: "B", streamUrl: "http://host/live/u/p/2.ts" },
    { name: "C", streamUrl: "http://host/live/u/p/3.ts" }
  ];
  const sandbox = {
    state: {
      watchChannel: o.watching || list[0],
      channels: o.channels || list,
      listItems: o.listItems || list
    },
    keyOf: function (channel) { return channel ? String(channel.streamUrl) : ""; },
    playChannel: function (channel, program, screen) { calls.play.push({ channel: channel, program: program, screen: screen }); }
  };
  vm.createContext(sandbox);
  vm.runInContext(codeZap, sandbox);
  return { api: sandbox, calls: calls, list: list };
}

/* Otoczenie dla wejscia w kanal: playChannel() bez prawdziwego wideo —
   interesuje nas tylko decyzja, gdzie wraca „Wstecz” i co sie zeruje. */
function playHarness(o) {
  o = o || {};
  const calls = { screens: [], seekCleared: 0 };
  const sandbox = {
    state: {
      playerReturn: o.playerReturn || "browserScreen",
      livePauseAt: o.livePauseAt || 0
    },
    settings: { osdEnabled: true },
    clearTimeout: function () {},
    $: function () {
      return { classList: { add: function () {}, toggle: function () {} }, textContent: "" };
    },
    startRecentWatch: function () {},
    clearSeekMark: function () { calls.seekCleared++; },
    destroyEngine: function () {},
    buildCatchupUrl: function () { return "http://host/catchup.ts"; },
    buildSourceQueue: function (source) { return [{ url: source }]; },
    showScreen: function (id) { calls.screens.push(id); },
    t: function (k) { return k; },
    buildOsdActions: function () {},
    updateOsd: function () {},
    showOsd: function () {},
    bindMediaSession: function () {},
    nextSourceEntry: function () {}
  };
  vm.createContext(sandbox);
  vm.runInContext(codePlay, sandbox);
  return { api: sandbox, calls: calls };
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

/* --- 6. pauza i wznowienie kanalu na zywo (pilot: pauza, play) ---------- */
let z;
h = ctrlHarness({ isArchive: false, paused: false, epg: { title: "Wiadomosci" } });
h.api.pausePlayback();
check("pauza na kanale na zywo: obraz staje, chwila zatrzymania zapamietana",
  h.video.paused === true && h.calls.paused === 1 && h.api.state.livePauseAt === NOW,
  "livePauseAt=" + h.api.state.livePauseAt + " paused=" + h.calls.paused);

h = ctrlHarness({ isArchive: true, paused: false, program: { start: NOW - 600000, end: NOW, title: "P" } });
h.api.pausePlayback();
check("pauza w nagraniu: znacznik pauzy na zywo zostaje pusty",
  h.video.paused === true && h.api.state.livePauseAt === 0,
  "livePauseAt=" + h.api.state.livePauseAt);

/* po dluzszej pauzie kanal na zywo uciekl do przodu — wznowienie wraca do
   chwili zatrzymania przez okno catch-up konczace sie na „teraz” */
h = ctrlHarness({ isArchive: false, paused: true, livePauseAt: NOW - 60000, epg: { title: "Wiadomosci" } });
h.api.resumePlayback();
p = h.calls.play[0];
check("wznowienie po dlugiej pauzie: catch-up od chwili zatrzymania do teraz",
  h.calls.play.length === 1 && !!p && p.program.start === NOW - 60000 && p.program.end === NOW &&
  p.program.timeshift === true && p.program.title === "Wiadomosci" && p.screen === "playerScreen" &&
  h.api.state.livePauseAt === 0,
  JSON.stringify(h.calls.play));

h = ctrlHarness({ isArchive: false, paused: true, livePauseAt: NOW - 800, epg: { title: "Wiadomosci" } });
h.api.resumePlayback();
check("wznowienie po krotkiej pauzie: lecimy dalej tym samym strumieniem",
  h.calls.played === 1 && h.calls.play.length === 0,
  "played=" + h.calls.played + " play=" + h.calls.play.length);

h = ctrlHarness({ isArchive: false, paused: true, livePauseAt: NOW - 60000, hasArchive: false });
h.api.resumePlayback();
check("kanal bez archiwum: zwykle wznowienie nawet po dlugiej pauzie",
  h.calls.played === 1 && h.calls.play.length === 0,
  "played=" + h.calls.played + " play=" + h.calls.play.length);

h = ctrlHarness({ isArchive: false, paused: true, livePauseAt: 0 });
h.api.resumePlayback();
check("wznowienie bez zapamietanej pauzy: bez przeadowania",
  h.calls.played === 1 && h.calls.play.length === 0,
  "played=" + h.calls.played + " play=" + h.calls.play.length);

/* ⏵‖ jednym klawiszem: zatrzymany obraz wznawia, lecacy zatrzymuje */
h = ctrlHarness({ isArchive: false, paused: true, livePauseAt: NOW - 800 });
h.api.togglePlayPause();
check("play/pauza na zatrzymanym obrazie: wznawia", h.calls.played === 1 && h.calls.paused === 0,
  "played=" + h.calls.played + " paused=" + h.calls.paused);

h = ctrlHarness({ isArchive: false, paused: false });
h.api.togglePlayPause();
check("play/pauza na lecacym obrazie: zatrzymuje i zapamietuje chwile",
  h.calls.paused === 1 && h.api.state.livePauseAt === NOW,
  "paused=" + h.calls.paused + " livePauseAt=" + h.api.state.livePauseAt);

/* --- 7. wyciszenie (🔇 na pilocie) -------------------------------------- */
h = ctrlHarness({ muted: false });
check("na starcie dzwiek gra, etykieta przycisku zacheca do wyciszenia",
  h.api.isMuted() === false && h.api.muteLabel() === "osd_mute",
  h.api.muteLabel());

h.api.toggleMute();
check("🔇 na pilocie: obraz wyciszony, etykieta proponuje wlaczenie dzwieku",
  h.video.muted === true && h.api.isMuted() === true && h.api.muteLabel() === "osd_unmute" &&
  h.calls.osd === 1,
  h.api.muteLabel() + " osd=" + h.calls.osd);

h.api.toggleMute();
check("ponowne 🔇: dzwiek wraca", h.video.muted === false && h.api.muteLabel() === "osd_mute",
  h.api.muteLabel());

/* --- 8. przelaczanie kanalow ▲ ▼ (CH+ / CH−) ---------------------------- */
z = zapHarness({ watching: { name: "B", streamUrl: "http://host/live/u/p/2.ts" } });
z.api.zapChannel(1);
check("▼ nizej: nastepny kanal z listy, na zywo (bez nagrania)",
  z.calls.play.length === 1 && z.calls.play[0].channel.name === "C" &&
  z.calls.play[0].program === null && z.calls.play[0].screen === "playerScreen",
  JSON.stringify(z.calls.play));

z = zapHarness({ watching: { name: "B", streamUrl: "http://host/live/u/p/2.ts" } });
z.api.zapChannel(-1);
check("▲ wyzej: poprzedni kanal z listy",
  z.calls.play.length === 1 && z.calls.play[0].channel.name === "A",
  JSON.stringify(z.calls.play));

z = zapHarness({ watching: { name: "A", streamUrl: "http://host/live/u/p/1.ts" } });
z.api.zapChannel(-1);
check("▲ na poczatku listy: zawija na ostatni kanal",
  z.calls.play.length === 1 && z.calls.play[0].channel.name === "C",
  JSON.stringify(z.calls.play));

z = zapHarness({ watching: { name: "C", streamUrl: "http://host/live/u/p/3.ts" } });
z.api.zapChannel(1);
check("▼ na koncu listy: zawija na pierwszy kanal",
  z.calls.play.length === 1 && z.calls.play[0].channel.name === "A",
  JSON.stringify(z.calls.play));

z = zapHarness({ watching: { name: "Obcy", streamUrl: "http://inny/kanal.ts" } });
z.api.zapChannel(1);
check("kanalu nie ma w playliscie: nie przelaczamy na przypadkowy",
  z.calls.play.length === 0, JSON.stringify(z.calls.play));

const cats = [
  { name: "A", streamUrl: "http://host/u/p/1.ts" },
  { name: "B", streamUrl: "http://host/u/p/2.ts" },
  { name: "C", streamUrl: "http://host/u/p/3.ts" }
];
z = zapHarness({ watching: cats[1], listItems: [cats[0], cats[2]], channels: cats });
z.api.zapChannel(1);
check("kanal z innej kategorii niz widoczna: szukamy w calej playliscie",
  z.calls.play.length === 1 && z.calls.play[0].channel.name === "C",
  JSON.stringify(z.calls.play));

z = zapHarness({ list: [{ name: "A", streamUrl: "http://host/u/p/1.ts" }] });
z.api.zapChannel(1);
check("jeden kanal w playliscie: nic nie przelaczamy",
  z.calls.play.length === 0, JSON.stringify(z.calls.play));

/* --- 9. wejscie w kanal: gdzie wraca „Wstecz” -------------------------- */
p = playHarness({});
p.api.playChannel(CH, null, "browserScreen");
check("ogladanie z listy: „Wstecz” wraca na liste kanalow",
  p.api.state.playerReturn === "browserScreen", p.api.state.playerReturn);

p = playHarness({});
p.api.playChannel(CH, { start: NOW - 60000, end: NOW, title: "P" }, "playerScreen");
check("akcja w odtwarzaczu (od poczatku, na zywo, nastepny program) nie psuje miejsca powrotu",
  p.api.state.playerReturn === "browserScreen", p.api.state.playerReturn);

p = playHarness({ playerReturn: "archiveScreen" });
p.api.playChannel(CH, null, "playerScreen");
check("powrot do archiwum zostaje, gdy obraz wyszedl z listy nagran",
  p.api.state.playerReturn === "archiveScreen", p.api.state.playerReturn);

p = playHarness({ playerReturn: "browserScreen", livePauseAt: NOW - 60000 });
p.api.playChannel(CH, { start: NOW - 60000, end: NOW, title: "P" }, "archiveScreen");
check("nowe okno archiwum: stara pauza na zywo nie obowiazuje, obraz sie wlacza",
  p.api.state.isArchive === true && p.api.state.livePauseAt === 0 &&
  p.api.state.watchChannel === CH && p.calls.screens[0] === "playerScreen",
  JSON.stringify({ isArchive: p.api.state.isArchive, livePauseAt: p.api.state.livePauseAt, screens: p.calls.screens }));

/* --- 10. pasek przewijania archiwum („cofnieto / przesunieto o N s”) -----
   Po skoku dekoder musi doniesc obraz na nowa pozycje i zglasza wtedy
   „waiting” — tak samo jak przy wczytywaniu strumienia od zera, wiec pasek
   pisal „Ladowanie strumienia (LIVE)”. Teraz zapamietujemy kierunek i krok
   skoku i to nimi opisujemy te chwile. */
h = harness({ isArchive: true, duration: 600, currentTime: 300, program: { start: NOW - 600000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(1);
check("skok do przodu: pasek wie o kroku 10 s w przod",
  h.video.currentTime === 310 && h.api.state.seekDirection === 1 && h.api.state.seekSize === 10 &&
  h.api.seekNotice() === "seek_forward",
  JSON.stringify({ t: h.video.currentTime, d: h.api.state.seekDirection, s: h.api.state.seekSize, note: h.api.seekNotice() }));

/* ten sam wpis widac na srodku obrazu, a nie tylko w pasku, ktory po OSD_AUTOHIDE
   sam znika — inaczej przy przewijaniu zostawal sam obraz bez informacji */
check("skok widac na srodku obrazu (ten sam wpis co na pasku)",
  h.els.playerToast.textContent === "seek_forward" &&
  h.els.playerToast.textContent === h.els.playerSeek.textContent &&
  !h.els.playerToast.classList.contains("hidden"),
  JSON.stringify({ toast: h.els.playerToast.textContent, bar: h.els.playerSeek.textContent }));
check("komunikat na obrazie gasnie sam po chwili (nie czeka na pasek)",
  h.calls.timeouts.some(function (t) { return t.ms === 2000; }),
  JSON.stringify(h.calls.timeouts));

h.api.state.seekAt = NOW - 7000;
check("kilka sekund po skoku wpis znika (to juz zwykle buforowanie)",
  h.api.seekNotice() === "", h.api.seekNotice());

/* pasek pokazany przy skoku jest tylko informacja (chowa sie sam po 1,8 s),
   wiec flaga menu musi wtedy zgasnac — inaczej ▲ ▼ nie zmienilyby kanalu */
h = harness({ isArchive: true, duration: 600, currentTime: 300, osdMenu: true, program: { start: NOW - 600000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(-1);
check("skok gasi flage menu (▲ ▼ znowu przelaczaja kanaly)",
  h.api.state.osdMenu === false, String(h.api.state.osdMenu));

h = harness({ isArchive: true, duration: 600, currentTime: 300, program: { start: NOW - 600000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(-1);
check("skok w tyl: pasek wie o cofnieciu",
  h.video.currentTime === 290 && h.api.seekNotice() === "seek_back" && h.api.state.seekSize === 10,
  JSON.stringify({ t: h.video.currentTime, note: h.api.seekNotice() }));

h = harness({ isArchive: true, duration: 600, currentTime: 300, seekSeconds: 30, program: { start: NOW - 600000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(-1);
check("krok z ustawien (30 s) trafia do wpisu na pasku",
  h.api.state.seekSize === 30 && h.api.seekNotice() === "seek_back",
  JSON.stringify({ s: h.api.state.seekSize }));

/* kilka nacisniec pod rzad (tak przewija sie pilotem) to jeden wpis o sumie */
h = harness({ isArchive: true, duration: 600, currentTime: 300, program: { start: NOW - 600000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(1); h.api.seekBy(1); h.api.seekBy(1); h.api.seekBy(1); h.api.seekBy(1);
check("piec skokow do przodu: jeden wpis o pieciu krokach (50 s)",
  h.video.currentTime === 350 && h.api.state.seekSize === 50 && h.api.seekNotice() === "seek_forward",
  JSON.stringify({ t: h.video.currentTime, s: h.api.state.seekSize, note: h.api.seekNotice() }));

h.api.seekBy(-1);
check("zmiana kierunku zaczyna liczenie od nowa",
  h.api.state.seekSize === 10 && h.api.seekNotice() === "seek_back",
  JSON.stringify({ s: h.api.state.seekSize, note: h.api.seekNotice() }));

h.api.state.seekAt = NOW - 7000;
h.api.seekBy(-1);
check("przerwa dluzsza niz wpis na pasku: liczenie od nowa",
  h.api.state.seekSize === 10 && h.api.seekNotice() === "seek_back",
  JSON.stringify({ s: h.api.state.seekSize }));

h = harness({ isArchive: false, duration: Infinity, epg: { title: "Wiadomosci" } });
h.api.seekBy(-1); h.api.seekBy(-1); h.api.seekBy(-1);
check("trzy cofniecia pod rzad na kanale na zywo: 30 s w jednym wpisie",
  h.calls.play.length === 3 && h.api.state.seekSize === 30 && h.api.seekNotice() === "seek_back",
  JSON.stringify({ play: h.calls.play.length, s: h.api.state.seekSize }));

h = harness({ isArchive: true, duration: 3600, currentTime: 4, program: { start: NOW - 7200000, end: NOW - 3600000, title: "Stary" } });
h.api.seekBy(-1);
check("przy krawedzi nagrania skok jest mniejszy od kroku i tak tez jest opisany",
  h.video.currentTime === 0 && h.api.state.seekSize === 4 && h.api.seekNotice() === "seek_back",
  JSON.stringify({ t: h.video.currentTime, s: h.api.state.seekSize }));

h = harness({ isArchive: true, duration: 3600, currentTime: 0, program: { start: NOW - 7200000, end: NOW - 3600000, title: "Stary" } });
h.api.seekBy(-1);
check("zero ruchu (poczatek nagrania): pasek nie pisze o cofnieciu",
  h.video.currentTime === 0 && h.api.state.seekAt === 0 && h.api.seekNotice() === "",
  "seekAt=" + h.api.state.seekAt);

h = harness({ isArchive: true, duration: 60, currentTime: 0, program: { start: NOW - 60000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(-1);
check("nowe okno catch-up (dluzsze w tyl) tez jest opisane jako cofniecie",
  h.calls.play.length === 1 && h.api.seekNotice() === "seek_back" && h.api.state.seekSize === 10,
  JSON.stringify({ play: h.calls.play.length, note: h.api.seekNotice() }));

h = harness({ isArchive: false, duration: Infinity, epg: { title: "Wiadomosci" } });
h.api.seekBy(-1);
check("wejscie w catch-up z kanalu na zywo: cofnieto o krok",
  h.calls.play.length === 1 && h.api.seekNotice() === "seek_back",
  h.api.seekNotice());

h = harness({ isArchive: false, duration: Infinity, epg: { title: "Wiadomosci" } });
h.api.seekBy(1);
check("na zywo do przodu bez skoku: brak wpisu o przewinieciu",
  h.api.state.seekAt === 0 && h.api.seekNotice() === "", "seekAt=" + h.api.state.seekAt);

/* nowy obraz (kanal / program) nie jest przewinieciem — kasuje wpis o skoku */
p = playHarness({});
p.api.playChannel(CH, null, "playerScreen");
check("wczytanie nowego obrazu kasuje wpis o przewinieciu",
  p.calls.seekCleared === 1, "seekCleared=" + p.calls.seekCleared);

/* ...a razem z wpisem gasnie komunikat na srodku obrazu — nie moze zostac na
   nowym kanale, ktorego nie dotyczyl */
h = harness({ isArchive: true, duration: 600, currentTime: 300, program: { start: NOW - 600000, end: NOW, title: "P", timeshift: true } });
h.api.seekBy(-1);
const toastBefore = h.els.playerToast.textContent;
h.api.clearSeekMark();
check("nowy obraz gasi komunikat o skoku na srodku obrazu",
  toastBefore === "seek_back" && h.els.playerToast.textContent === "" &&
  h.els.playerToast.classList.contains("hidden"),
  JSON.stringify({ before: toastBefore, after: h.els.playerToast.textContent }));

console.log("");
if (fails) { console.log("BLEDY: " + fails); process.exit(1); }
console.log("Wszystkie scenariusze przeszly.");

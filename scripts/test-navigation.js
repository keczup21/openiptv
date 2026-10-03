/* Test sterowania w menu glownym (lista kanalow) — bez telewizora.
   Wyciaga z www/app.js logike (nie kopiuje jej) i sprawdza rzeczy, ktore na
   pilocie wychodzily zle:
     • samo dojechanie fokusem na grupe nie moze przelaczac listy kanalow,
     • z pola szukania trzeba umiec wyjsc: ▼ do kanalow, ◀ do grup,
     • wejscie na ekran nie moze stawiac fokusu w polu tekstowym (po zapisaniu
       ustawien „samo” wlaczalo sie szukanie kanalow),
     • ikony przyciskow sa SVG (emoji na dekoderach TV zostawialo kropke),
     • podpowiedz pilota pod lista ma czytelny pasek.
   Uruchomienie: npm run test:nav */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "www", "app.js"), "utf8").replace(/\r\n/g, "\n");
const html = fs.readFileSync(path.join(ROOT, "www", "index.html"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.join(ROOT, "www", "styles.css"), "utf8").replace(/\r\n/g, "\n");
/* natywna obsługa pilota (klawisze multimedialne) — patrz sekcja 19 */
const java = fs.readFileSync(path.join(ROOT, "android", "app", "src", "main", "java",
  "pl", "openiptv", "player", "MainActivity.java"), "utf8").replace(/\r\n/g, "\n");

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  OK   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "   -> " + extra : "")); }
}

/* blok ikon: ICON_PATHS, ICON_BY_LEAD, iconEdge(), iconForLabel(),
   labelWithoutIcon() — do funkcji iconHtml() (ta dotyka juz DOM) */
const iconStart = src.indexOf("var ICON_PATHS = {");
const iconEnd = src.indexOf("function iconHtml(");
if (iconStart < 0 || iconEnd < 0) throw new Error("Nie znalazlem bloku ikon w app.js");
const codeIcons = src.slice(iconStart, src.lastIndexOf("\n\n", iconEnd) + 2);
if (codeIcons.indexOf("function iconForLabel") < 0 || codeIcons.indexOf("function labelWithoutIcon") < 0) {
  throw new Error("Wyciety blok ikon nie ma iconForLabel/labelWithoutIcon");
}

/* blok nawigacji: searchArrowTarget(), nextFocusAfterGroup(),
   focusActiveCategory(), focusChannelEntry(), isTextField(), entryFocusTarget() */
const navStart = src.indexOf("function searchArrowTarget(");
const navEnd = src.indexOf("function focusGuide(");
if (navStart < 0 || navEnd < 0) throw new Error("Nie znalazlem bloku nawigacji w app.js");
const codeNav = src.slice(src.lastIndexOf("\n\n", navStart) + 2, src.lastIndexOf("\n\n", navEnd) + 2);
["nextFocusAfterGroup", "focusActiveCategory", "focusChannelEntry", "isTextField", "entryFocusTarget"]
  .forEach(function (fn) {
    if (codeNav.indexOf("function " + fn) < 0) throw new Error("Wyciety blok nawigacji nie ma " + fn);
  });

function run(code, sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

const icons = run(codeIcons, {});

/* --- 1. napis przycisku -> ikona ---------------------------------------- */
check("📅 Program TV -> ikona kalendarza (EPG na pasku i w menu)",
  icons.iconForLabel("📅 Program TV") === "calendar", String(icons.iconForLabel("📅 Program TV")));
check("🔇 / 🔊 -> ikona dzwieku",
  icons.iconForLabel("🔇 Wycisz") === "mute" && icons.iconForLabel("🔊 Dźwięk") === "volume");
check("⏪ / ⏵ / ⏸ / ✕ / ⏻ / ★ / ☆ -> wlasne ikony",
  icons.iconForLabel("⏪ Od początku") === "rewind" &&
  icons.iconForLabel("⏵ Wznów") === "play" &&
  icons.iconForLabel("⏸ Pauza") === "pause" &&
  icons.iconForLabel("✕ Wstecz") === "close" &&
  icons.iconForLabel("⏻ Wyjdź z aplikacji") === "power" &&
  icons.iconForLabel("★ Ulubione") === "star-filled" &&
  icons.iconForLabel("☆ Dodaj do ulubionych") === "star");
check("znak po napisie tez jest ikona („Następny ▶”)",
  icons.iconForLabel("Następny ▶") === "next" && icons.iconForLabel("◀ Poprzedni") === "prev");
/* --- 2. napis na przycisku bez znaku ikony ------------------------------ */
check("napis bez znaku nie dostaje ikony („Kanał”, „Wstecz”, „Wszystkie”)",
  icons.iconForLabel("Kanał") === null && icons.iconForLabel("Wstecz") === null &&
  icons.iconForLabel("Wszystkie") === null &&
  icons.labelWithoutIcon("Kanał") === "Kanał");
check("znak ikony nie zostaje w napisie (bez podwojnej ikony)",
  icons.labelWithoutIcon("📅 Program TV") === "Program TV" &&
  icons.labelWithoutIcon("✕ Wstecz") === "Wstecz" &&
  icons.labelWithoutIcon("★ Ulubione") === "Ulubione" &&
  icons.labelWithoutIcon("🔇 Wycisz") === "Wycisz",
  [icons.labelWithoutIcon("📅 Program TV"), icons.labelWithoutIcon("✕ Wstecz")].join(" | "));
check("znak z konca napisu tez znika („Następny ▶” -> „Następny”)",
  icons.labelWithoutIcon("Następny ▶") === "Następny", icons.labelWithoutIcon("Następny ▶"));
check("napisy bez znaku zostaja bez zmian",
  icons.labelWithoutIcon("Kanał") === "Kanał" &&
  icons.labelWithoutIcon("Ostatnio oglądane") === "Ostatnio oglądane");

/* --- 3. kazda ikona ma rysunek ------------------------------------------ */
const leads = Object.keys(icons.ICON_BY_LEAD);
const noPath = leads.filter(function (k) { return !icons.ICON_PATHS[icons.ICON_BY_LEAD[k]]; });
check("kazdy znak z listy ma rysunek SVG (" + leads.length + " znakow)",
  noPath.length === 0, noPath.join(", "));
const usedIcons = leads.map(function (k) { return icons.ICON_BY_LEAD[k]; });
const unreachable = Object.keys(icons.ICON_PATHS).filter(function (name) {
  return usedIcons.indexOf(name) < 0;
});
check("nie ma rysunkow bez znaku, ktory je wybiera", unreachable.length === 0, unreachable.join(", "));

/* --- 3b. napis z ikona na przycisku (setIconLabel -> SVG + napis) ------- */
const htmlStart = src.indexOf("function iconHtml(");
const htmlEnd = src.indexOf("function applyTranslations(");
if (htmlStart < 0 || htmlEnd < 0) throw new Error("Nie znalazlem iconHtml/setIconLabel w app.js");
const codeLabel = src.slice(htmlStart, src.lastIndexOf("\n\n", htmlEnd) + 2);
if (codeLabel.indexOf("function setIconLabel") < 0) throw new Error("Wyciety blok nie ma setIconLabel");

function fakeButton() {
  const classes = [];
  const button = {
    children: [],
    classes: classes,
    classList: {
      add: function (c) { if (classes.indexOf(c) < 0) classes.push(c); },
      remove: function (c) { const i = classes.indexOf(c); if (i >= 0) classes.splice(i, 1); }
    },
    appendChild: function (child) { this.children.push(child); }
  };
  /* w przegladarce ustawienie innerHTML kasuje dotychczasowe dzieci — atrapa
     musi robic to samo, inaczej licznik dzieci klamie */
  let markup = "";
  Object.defineProperty(button, "innerHTML", {
    get: function () { return markup; },
    set: function (value) { markup = value; button.children.length = 0; }
  });
  return button;
}

const labelBox = {
  document: {
    createElement: function (tag) {
      return { tagName: tag, className: "", textContent: "" };
    }
  }
};
run(codeIcons, labelBox);
run(codeLabel, labelBox);

(function () {
  const button = fakeButton();
  const text = labelBox.setIconLabel(button, "📅 Program TV");
  check("przycisk dostaje ikone SVG (viewBox 24, klasa .icon) i napis bez znaku",
    button.innerHTML.indexOf("<svg") === 0 &&
    button.innerHTML.indexOf('class="icon"') > 0 &&
    button.innerHTML.indexOf('viewBox="0 0 24 24"') > 0 &&
    button.innerHTML.indexOf("calendar") < 0 &&
    button.children.length === 1 &&
    button.children[0].className === "icon-label" &&
    button.children[0].textContent === "Program TV" &&
    text === "Program TV",
    button.innerHTML.slice(0, 90));
  check("przycisk z ikona dostaje klase do ukladu w jednej linii",
    button.classes.join(",") === "has-icon", button.classes.join(","));
  check("rysunek ikony pochodzi z listy (kalendarz ma <rect> i <path>)",
    button.innerHTML.indexOf("<rect") > 0 && button.innerHTML.indexOf("<path") > 0);
})();

(function () {
  const button = fakeButton();
  const text = labelBox.setIconLabel(button, "Kanał");
  check("napis bez znaku nie dostaje ikony ani klasy has-icon",
    button.innerHTML === "" && text === "Kanał" &&
    button.classes.length === 0 && button.children.length === 1 &&
    button.children[0].textContent === "Kanał");
})();

(function () {
  const button = fakeButton();
  labelBox.setIconLabel(button, "⏸ Pauza");
  labelBox.setIconLabel(button, "Kanał");
  check("po zmianie napisu ikona znika razem z klasa has-icon",
    button.innerHTML === "" && button.classes.length === 0 &&
    button.children.length === 1 && button.children[0].textContent === "Kanał");
})();

/* --- 4. napisy z aplikacji naprawde znajduja ikone ----------------------
   Kazdy przycisk, ktory ma dzialac jak ikona (pasek odtwarzacza, menu opcji,
   pytanie o wyjscie, narzedzia grup), bierzemy ze slownika i sprawdzamy, ze
   jego napis daje ikone — literowka w ICON_BY_LEAD wyjdzie od razu. */
const ICON_LABEL_KEYS = [
  "osd_pause", "osd_play", "osd_restart", "osd_prev_program", "osd_next_program",
  "osd_live", "osd_epg", "osd_mute", "osd_unmute", "osd_back",
  "ctx_play", "ctx_fav_add", "ctx_fav_del", "ctx_archive", "ctx_epg", "ctx_close",
  "exit_confirm", "exit_cancel", "group_order", "group_order_done"
];
function plLabel(key) {
  /* napisy stoja czasem po kilka w jednej linii (group_order i group_order_done),
     dlatego szukamy klucza, a nie jego poczatku linii */
  const m = src.match(new RegExp("\\b" + key + ": \"([^\"]*)\""));
  return m ? m[1] : null;
}
const labelProblems = [];
ICON_LABEL_KEYS.forEach(function (key) {
  const label = plLabel(key);
  if (label === null) labelProblems.push(key + " (brak napisu)");
  else if (!icons.iconForLabel(label)) labelProblems.push(key + " = „" + label + "”");
});
check("kazdy napis z ikona daje ikone (" + ICON_LABEL_KEYS.length + " kluczy)",
  labelProblems.length === 0, labelProblems.join(", "));

/* --- 5. strzalki w polu szukania ---------------------------------------- */
function navHarness(o) {
  o = o || {};
  const calls = { nearest: [], focused: [] };
  const sandbox = {
    document: { querySelector: function () { return o.category === undefined ? null : o.category; } },
    $: function (id) { return (o.containers && o.containers[id]) || null; },
    focusNearest: function (key) { calls.nearest.push(key); }
  };
  run(codeNav, sandbox);
  return { api: sandbox, calls: calls };
}

const search = navHarness().api;
check("▼ z pola szukania prowadzi do listy kanalow",
  search.searchArrowTarget(40, false, false) === "channels" &&
  search.searchArrowTarget(40, true, true) === "channels");
check("◀ zabiera tekst do listy grup tylko z poczatku zapytania",
  search.searchArrowTarget(37, true, false) === "categories" &&
  search.searchArrowTarget(37, false, false) === "");
check("▶ przy koncu tekstu przechodzi do nastepnego pola paska",
  search.searchArrowTarget(39, false, true) === "bar" &&
  search.searchArrowTarget(39, false, false) === "");
check("▲ i pozostale klawisze zostaja w polu",
  search.searchArrowTarget(38, false, false) === "" &&
  search.searchArrowTarget(13, false, false) === "");

/* --- 6. po wybraniu grupy wchodzimy w jej kanaly (tylko TV) ------------- */
check("OK na grupie w trybie TV ustawia fokus na kanalach",
  search.nextFocusAfterGroup(true) === "channels" &&
  search.nextFocusAfterGroup(false) === "");

/* --- 7. fokus na kanaly / na grupe -------------------------------------- */
function fakeElement(tag, type) {
  const attrs = type ? { type: type } : {};
  return {
    tagName: tag,
    offsetParent: {},
    getAttribute: function (k) { return attrs[k] === undefined ? null : attrs[k]; },
    focused: false,
    focus: function () { this.focused = true; }
  };
}

(function () {
  const card = fakeElement("BUTTON");
  const container = { querySelector: function (sel) { return sel === ".channel-main" ? card : null; } };
  const h = navHarness({ containers: { channels: container } });
  check("▼ z szukania stawia fokus na pierwszym kanale",
    h.api.focusChannelEntry() === true && card.focused === true && h.calls.nearest.length === 0);
})();

(function () {
  const container = { querySelector: function () { return null; } };
  const h = navHarness({ containers: { channels: container } });
  check("pusta lista kanalow: fokus szuka najblizszego elementu w dol",
    h.api.focusChannelEntry() === false && h.calls.nearest.join(",") === "40");
})();

(function () {
  const active = fakeElement("BUTTON");
  const h = navHarness({ category: active });
  h.api.focusActiveCategory();
  check("◀ z szukania stawia fokus na wybranej grupie", active.focused === true);
})();

/* --- 8. pola tekstowe nie lapia fokusu na start ------------------------- */
check("pole tekstowe jest rozpoznawane (takze type=url, date, time)",
  search.isTextField(fakeElement("INPUT", "text")) === true &&
  search.isTextField(fakeElement("INPUT", null)) === true &&
  search.isTextField(fakeElement("INPUT", "url")) === true &&
  search.isTextField(fakeElement("INPUT", "date")) === true);
check("przelacznik i przycisk to nie pole tekstowe",
  search.isTextField(fakeElement("INPUT", "checkbox")) === false &&
  search.isTextField(fakeElement("INPUT", "radio")) === false &&
  search.isTextField(fakeElement("BUTTON")) === false);

(function () {
  const category = fakeElement("BUTTON");
  const screen = {
    id: "browserScreen",
    querySelector: function (sel) { return sel === ".category.active" ? category : null; },
    querySelectorAll: function () { return []; }
  };
  check("wejscie na liste kanalow staje na grupie (nie w polu szukania)",
    search.entryFocusTarget(screen) === category);
})();

(function () {
  const searchField = fakeElement("INPUT", "text");
  const select = fakeElement("SELECT");
  const screen = {
    id: "settingsScreen",
    querySelector: function () { return null; },
    querySelectorAll: function () { return [searchField, select]; }
  };
  check("w ustawieniach fokus omija pola tekstowe, a staje na liscie wyboru",
    search.entryFocusTarget(screen) === select);
})();

(function () {
  const hidden = fakeElement("BUTTON");
  hidden.offsetParent = null;
  const screen = {
    id: "settingsScreen",
    querySelector: function () { return null; },
    querySelectorAll: function () { return [hidden]; }
  };
  check("ukryte elementy nie dostaja fokusu", search.entryFocusTarget(screen) === null);
})();

/* --- 9. app.js naprawde tego uzywa ------------------------------------- */
check("samo dojechanie fokusem na grupe nie przelacza juz listy kanalow",
  src.indexOf("button.onfocus = function () {\n        selectGroup") < 0 &&
  src.indexOf("selectGroup(item.key, button);") > 0);
check("renderCategories() uzywa nextFocusAfterGroup()",
  src.indexOf('if (nextFocusAfterGroup(isTvMode()) === "channels") focusChannelEntry();') > 0);
check("showScreen() stawia fokus przez entryFocusTarget(), nie na pierwszym polu",
  src.indexOf("var first = entryFocusTarget($(id));") > 0 &&
  src.indexOf("$(id).querySelector('[tabindex=\"0\"],button,input,select')") < 0);
check("po wczytaniu playlisty fokus wchodzi w liste kanalow (nie w pole szukania)",
  src.indexOf('if (isTvMode() && document.activeElement !== $("searchInput")) focusChannelEntry();') > 0);
check("obsluga klawiszy rozpoznaje pole szukania",
  src.indexOf('if (field === $("searchInput")) {') > 0 &&
  src.indexOf("searchArrowTarget(key, caret === 0, caretEnd === field.value.length)") > 0);
check("pasek odtwarzacza i menu opcji wstawiaja napisy z ikona",
  (src.match(/setIconLabel\(button, label\);/g) || []).length >= 2 &&
  src.indexOf("setIconLabel(playButton, t(video && video.paused") > 0 &&
  src.indexOf("setIconLabel(muteButton, muteLabel())") > 0);
check("kafelek kanalu ma sama gwiazdke ulubionych (bez przycisku „<<” na archiwum)",
  src.indexOf('setIconLabel(favorite, isFavorite(channel) ? "★" : "☆")') > 0 &&
  src.indexOf("archive-button") < 0 && src.indexOf("setIconLabel(archive") < 0);
check("nagrania zostaja pod reka: menu opcji kanalu nadal ma archiwum",
  src.indexOf('ctxButton(t("ctx_archive")') > 0 && css.indexOf(".archive-button") < 0);
check("filtrowanie listy przy wpisywaniu zapytania zostaje bez zmian",
  src.indexOf('$("searchInput").oninput') > 0);

/* --- 10. index.html: przyciski naglowka z ikona ------------------------- */
function tag(id) {
  const at = html.indexOf('id="' + id + '"');
  if (at < 0) return "";
  return html.slice(at, html.indexOf("</button>", at) + 9);
}
const guideBtn = tag("openGuide");
check("przycisk programu TV to sam napis „EPG” (bez ikony kalendarza)",
  guideBtn.indexOf("<svg") < 0 && guideBtn.indexOf(">EPG<") > 0 &&
  guideBtn.indexOf('class="labeled-button"') > 0, guideBtn.slice(0, 60));
check("przycisk ustawien to sama zebatka (napis zostal w podpowiedzi)",
  tag("openSettings").indexOf('class="icon-button"') > 0 &&
  tag("openSettings").indexOf("<svg") > 0 &&
  tag("openSettings").indexOf('data-i18n-title="settings"') > 0 &&
  tag("openSettings").indexOf("<span") < 0);
check("napis „Ustawienia” zostaje tam, gdzie jest potrzebny (naglowek ekranu)",
  html.indexOf('<h1 data-i18n="settings">') > 0);
check("odswiezanie zostaje przyciskiem z sama ikona",
  tag("reload").indexOf('class="icon-button"') > 0 && tag("reload").indexOf("<svg") > 0);
check("ikony naglowka nie sa emoji (zadnego znaku emoji w przyciskach)",
  /[\uD83C-\uDBFF][\uDC00-\uDFFF]/.test(guideBtn + tag("openSettings") + tag("reload")) === false);
check("podpowiedz pilota nadal jest w naglowku listy",
  html.indexOf('id="tvHint"') > 0 && src.indexOf('hint.textContent = t("tv_hint")') > 0);
check("napisy z ikona z index.html przechodza przez setIconLabel",
  src.indexOf("setIconLabel(els[i], v);") > 0);
/* Ikona SVG rozmiar bierze z regul przycisku („button .icon”), wiec napis
   z ikona w innym kontenerze rozszedlby sie na caly naglowek: tak wlasnie
   legenda pilota („◀ ▶ — przewijanie godzin”) robila wielki znak w programie
   TV. Dlatego ikony dostaja wylacznie przyciski, a legenda zostaje tekstem. */
check("napis z ikona poza przyciskiem zostaje tekstem (legenda pilota)",
  src.indexOf('if (els[i].tagName === "BUTTON" && iconForLabel(v)) setIconLabel(els[i], v);') > 0 &&
  html.indexOf('<span id="guidePanHint"') > 0 &&
  icons.iconForLabel("◀ ▶ — przewijanie godzin • ▲ ▼ — kanały") === "prev");

/* <option> nie moze dostac elementu potomnego, wiec zaden napis z ikona nie
   moze byc uzyty w liscie wyboru — inaczej pozycja zostalaby pusta */
const optionKeys = (html.match(/<option[^>]*data-i18n="([a-z_0-9]+)"/g) || [])
  .map(function (s) { return s.replace(/.*="/, "").replace(/"$/, ""); });
const optionWithIcon = optionKeys.filter(function (k) { return icons.iconForLabel(plLabel(k)); });
check("zadna opcja listy wyboru nie ma napisu z ikona (" + optionKeys.length + " opcji)",
  optionWithIcon.length === 0, optionWithIcon.join(", "));

/* --- 11. styles.css: ikony i pasek podpowiedzi -------------------------- */
check("przycisk bez napisu nie dziedziczy paddingu reguly TV (ikona nie jest sciskana)",
  css.indexOf("body.uimode-tv .icon-button { padding: 0; }") > 0 &&
  /\.icon-button svg \{[^}]*flex: none[^}]*\}/.test(css));
check("przycisk z ikona uklada ikone i napis w jednej linii",
  css.indexOf("button.has-icon {") > 0 && css.indexOf("button .icon {") > 0 &&
  css.indexOf("body.uimode-tv button .icon {") > 0);
check("przyciski naglowka z napisem maja wlasny padding takze na TV",
  css.indexOf(".labeled-button {") > 0 && css.indexOf("body.uimode-tv .labeled-button") > 0);
check("ikony kafelkow i menu opcji maja swoj rozmiar",
  css.indexOf(".favorite-button .icon {") > 0 && css.indexOf(".ctx-actions button.has-icon .icon {") > 0);

const hintAt = css.indexOf("body.uimode-tv .tv-keys-hint {");
const hintRule = css.slice(hintAt, css.indexOf("}", hintAt));
check("podpowiedz pilota to czytelny pasek (tlo, jasny tekst, wieksza czcionka)",
  hintRule.indexOf("background: var(--surface)") > 0 &&
  hintRule.indexOf("color: var(--text)") > 0 &&
  /font-size: 2\dpx/.test(hintRule), hintRule.replace(/\s+/g, " ").slice(0, 120));
check("podpowiedz nie jest juz polozona na wierzchu listy kanalow",
  css.slice(css.indexOf(".tv-keys-hint {"), hintAt).indexOf("position: absolute") < 0);

/* --- 11. przewijanie ekranu przy nawigacji pilotem ----------------------
   `scrollIntoView(false)` wyrownywal sfokusowany element do samej dolnej
   krawedzi: kazdy krok pilota robil duzy, nierowny skok („po schodkach”), a
   to, co bylo pod przyciskiem (opis zmian, „Zapisz i pobierz”), zostawalo
   poza ekranem. keepInView() dosuwa ekran tylko o brakujacy kawalek i z
   zapasem, zeby widac bylo takze sasiednie wiersze. */
const scrollStart = src.indexOf("function scrollParent(");
const scrollEnd = src.indexOf("function focusNearest(");
if (scrollStart < 0 || scrollEnd < 0 || scrollEnd <= scrollStart) {
  throw new Error("Nie znalazlem bloku przewijania w app.js");
}
const codeScroll = src.slice(scrollStart, scrollEnd);
if (codeScroll.indexOf("function keepInView") < 0) {
  throw new Error("Wyciety blok przewijania nie ma keepInView");
}

/* atrapa kontenera: wiersze licza swoje polozenie od biezacego scrollTop */
function fakeScrollBox(height) {
  return {
    nodeType: 1,
    parentNode: null,
    style: { overflowY: "auto" },
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: height,
    clientWidth: 1000,
    scrollHeight: 5000,
    getBoundingClientRect: function () {
      return { top: 0, left: 0, bottom: height, right: 1000, width: 1000, height: height };
    }
  };
}
function fakeRow(box, top, height) {
  return {
    nodeType: 1,
    parentNode: box,
    getBoundingClientRect: function () {
      const t = top - box.scrollTop;
      return { top: t, left: 0, bottom: t + height, right: 800, width: 800, height: height };
    }
  };
}
function scrollHarness() {
  return run(codeScroll, {
    window: { getComputedStyle: function (node) { return node.style; } },
    focusAnchor: null
  });
}

(function () {
  const api = scrollHarness();
  const box = fakeScrollBox(1000);
  const row = fakeRow(box, 900, 60);
  api.keepInView(row);
  check("wiersz przy dolnej krawedzi zjezdza z zapasem, a nie staje na krawedzi",
    box.scrollTop === 160, "scrollTop = " + box.scrollTop);
  check("po dosunieciu pod wierszem zostaje miejsce na to, co jest nizej",
    box.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom === 200,
    String(box.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom));
})();

(function () {
  const api = scrollHarness();
  const box = fakeScrollBox(1000);
  api.keepInView(fakeRow(box, 300, 60));
  check("wiersz widoczny z zapasem nie rusza ekranu (bez skokow)", box.scrollTop === 0, String(box.scrollTop));
})();

(function () {
  const api = scrollHarness();
  const box = fakeScrollBox(1000);
  box.scrollTop = 500;
  api.keepInView(fakeRow(box, 500, 60));
  check("wiersz nad ekranem wraca z zapasem od gornej krawedzi", box.scrollTop === 300, String(box.scrollTop));
})();

(function () {
  const api = scrollHarness();
  const box = fakeScrollBox(1000);
  box.scrollHeight = 900; /* tresc miesci sie w oknie — nie ma czego przewijac */
  api.keepInView(fakeRow(box, 2000, 60));
  check("kontener bez przewijania nie jest ruszany", box.scrollTop === 0, String(box.scrollTop));

  let threw = "";
  try { api.keepInView(null); api.keepInView({}); } catch (error) { threw = String(error && error.message); }
  check("keepInView nie wywraca sie na atrapie elementu", threw === "", threw);
})();

const focusStart = src.indexOf("function focusNearest(");
const focusEnd = src.indexOf("function searchArrowTarget(");
if (focusStart < 0 || focusEnd < 0) throw new Error("Nie znalazlem focusNearest w app.js");
const codeFocus = src.slice(focusStart, focusEnd);
check("nawigacja pilotem dosuwa ekran z zapasem, a nie do samej krawedzi",
  codeFocus.indexOf("keepInView(best)") > 0 && codeFocus.indexOf("scrollIntoView") < 0);
check("zgubiony fokus liczy od ostatniego miejsca, a nie od poczatku ekranu",
  codeFocus.indexOf("focusAnchor") > 0 && codeFocus.indexOf("focusAnchor.box") > 0);

/* --- 12. przyciski aktualizacji w trakcie pobierania --------------------
   `disabled` na przycisku „Pobierz i zainstaluj” zabieralo fokus w trakcie
   pobierania paczki — nawigacja pilotem wracala wtedy na poczatek ustawien
   i nie dalo sie zjechac do opisu zmian ani do „Zapisz”. */
check("przyciski aktualizacji nie traca fokusu w trakcie pobierania (bez disabled)",
  src.indexOf("check.disabled") < 0 && src.indexOf("install.disabled") < 0 &&
  src.indexOf('button.classList.add("busy")') > 0);
check("app.js pamieta ostatnie miejsce fokusu (focusin)",
  src.indexOf('document.addEventListener("focusin"') > 0);
check("CSS przygasza przycisk w trakcie pobierania",
  /\.update-row button\.busy\s*\{[^}]*opacity/.test(css));

/* --- 13. pole z listą wyboru („Typ źródła”) ------------------------------
   Rozwinięte menu systemowe (<select>) na telewizorze bywa ciemne na ciemnym
   i nie było widać, która pozycja jest podświetlona. Pole jest teraz rzędem
   przycisków — wszystkie pozycje widoczne naraz, wybrana w kolorze akcentu —
   a ukryty <select> trzyma wartość, którą czytają pozostałe funkcje. */
const choiceStart = src.indexOf("function fireChange(");
const choiceEnd = src.indexOf("function loadProfileIntoForm(");
if (choiceStart < 0 || choiceEnd < 0 || choiceEnd <= choiceStart) {
  throw new Error("Nie znalazlem bloku list wyboru w app.js");
}
const codeChoice = src.slice(choiceStart, choiceEnd);
["fireChange", "syncChoiceRow", "syncChoiceRows", "pickChoice", "buildChoiceRow", "buildChoiceRows"]
  .forEach(function (fn) {
    if (codeChoice.indexOf("function " + fn) < 0) {
      throw new Error("Wyciety blok list wyboru nie ma " + fn);
    }
  });

/* atrapa pola: wiersz z przyciskami + <select>, ktory trzyma wartosc */
function choiceHarness(withoutEvent) {
  const buttons = [];
  const row = {
    attrs: { "data-choice-for": "sourceType" },
    getAttribute: function (name) { return this.attrs[name] === undefined ? null : this.attrs[name]; },
    querySelectorAll: function () { return buttons; },
    appendChild: function (child) { child.parentNode = this; buttons.push(child); }
  };
  /* w przegladarce ustawienie textContent kasuje dotychczasowe dzieci */
  Object.defineProperty(row, "textContent", { set: function () { buttons.length = 0; } });

  function option(value, key, text) {
    const attrs = { "data-i18n": key };
    return {
      value: value,
      textContent: text,
      getAttribute: function (name) { return attrs[name] === undefined ? null : attrs[name]; }
    };
  }

  const select = {
    value: "m3u-url",
    options: [option("m3u-url", "m3u_url", "Link do M3U"),
      option("m3u-file", "m3u_file", "Plik M3U"),
      option("xtream", "xtream", "Xtream (login)")],
    events: [],
    onchange: null,
    dispatchEvent: function (event) {
      this.events.push(event);
      if (this.onchange) this.onchange(event);
    }
  };

  const sandbox = {
    document: {
      createElement: function () {
        const attrs = {};
        return {
          tabIndex: -1,
          className: "",
          textContent: "",
          parentNode: null,
          setAttribute: function (name, value) { attrs[name] = String(value); },
          getAttribute: function (name) { return attrs[name] === undefined ? null : attrs[name]; }
        };
      },
      /* droga zapasowa dla starszych WebView (bez konstruktora Event) */
      createEvent: function (kind) {
        return { kind: kind, initEvent: function (type) { this.type = type; } };
      },
      querySelectorAll: function () { return [row]; }
    },
    $: function (id) { return id === "sourceType" ? select : null; }
  };
  if (!withoutEvent) sandbox.Event = function (type) { this.type = type; };

  run(codeChoice, sandbox);
  return { api: sandbox, row: row, select: select, buttons: buttons };
}

(function () {
  const h = choiceHarness();
  h.api.buildChoiceRows();
  const texts = h.buttons.map(function (b) { return b.textContent; });
  check("kazda pozycja listy ma swoj przycisk — wszystkie widoczne naraz",
    h.buttons.length === 3 && texts.join(" | ") === "Link do M3U | Plik M3U | Xtream (login)",
    texts.join(" | "));
  check("wybor widac niezaleznie od fokusu (aria-checked, rola radio, tabindex)",
    h.buttons[0].getAttribute("aria-checked") === "true" &&
    h.buttons[1].getAttribute("aria-checked") === "false" &&
    h.buttons[2].getAttribute("aria-checked") === "false" &&
    h.buttons[0].getAttribute("role") === "radio" && h.buttons[0].tabIndex === 0);
  check("napisy pozycji nadal ida przez tlumaczenia (data-i18n z <option>)",
    h.buttons[0].getAttribute("data-i18n") === "m3u_url" &&
    h.buttons[1].getAttribute("data-i18n") === "m3u_file" &&
    h.buttons[2].getAttribute("data-i18n") === "xtream");
})();

(function () {
  const h = choiceHarness();
  h.api.buildChoiceRows();
  let changes = 0;
  h.select.onchange = function () { changes++; };

  h.buttons[1].onclick.call(h.buttons[1]);
  check("wybor z listy zapisuje wartosc w <select> (czytaja ja pozostale funkcje)",
    h.select.value === "m3u-file", h.select.value);
  check("wybor z listy wysyla zdarzenie „change” (pola Xtream sie przelaczaja)",
    changes === 1 && h.select.events.length === 1 && h.select.events[0].type === "change",
    "zmian: " + changes + ", zdarzen: " + h.select.events.length);
  check("zaznaczenie idzie za wyborem",
    h.buttons[1].getAttribute("aria-checked") === "true" &&
    h.buttons[0].getAttribute("aria-checked") === "false");

  h.buttons[1].onclick.call(h.buttons[1]);
  check("wybranie tej samej pozycji nic nie zmienia (bez zdarzenia, bez skoku fokusu)",
    changes === 1, "zmian: " + changes);

  h.select.value = "xtream"; /* tak wartosc z profilu ustawia loadProfileIntoForm */
  h.api.syncChoiceRows();
  check("wartosc wczytana z profilu tez jest zaznaczona",
    h.buttons[2].getAttribute("aria-checked") === "true" &&
    h.buttons[0].getAttribute("aria-checked") === "false");
})();

(function () {
  const h = choiceHarness(true); /* starszy WebView: bez konstruktora Event */
  h.api.buildChoiceRows();
  let changes = 0;
  h.select.onchange = function () { changes++; };
  h.buttons[2].onclick.call(h.buttons[2]);
  check("na starszym WebView zdarzenie „change” idzie droga zapasowa (createEvent)",
    changes === 1 && h.select.events[0].type === "change", "zmian: " + changes);
})();

check("pole z lista wyboru nie rozwija systemowego menu (ukryty <select> + rzad przyciskow)",
  html.indexOf('id="sourceType" class="choice-value"') > 0 &&
  html.indexOf('data-choice-for="sourceType"') > 0 &&
  /\.settings-card select\.choice-value\s*\{\s*display:\s*none/.test(css));
check("wybrana pozycja jest widoczna od razu (tlo akcentu, nie tylko obwodka fokusu)",
  /\.choice-row button\[aria-checked="true"\]\s*\{[^}]*background:\s*var\(--grad\)/.test(css));
check("lista wyboru jest wieksza na telewizorze", css.indexOf("body.uimode-tv .choice-row button") > 0);
check("pozostale listy (<option>) maja wlasne tlo, a nie systemowe",
  /select option\s*\{[^}]*background/.test(css));
check("lista wyboru powstaje przy starcie, a wartosc z profilu ja odswieza",
  src.indexOf("\n  buildChoiceRows();") > 0 && src.indexOf("\n    syncChoiceRows();") > 0);

/* --- 14. program TV: podpis „LIVE”, podświetlenie do catch-up, linia godziny --
   Program, który leci teraz, dostaje podpis „LIVE” i samą obwódkę akcentu,
   a mocne podświetlenie (gradient) należy do programu wybieranego pilotem —
   tym samym wskazuje się materiał do catch-up. Przez całą siatkę, przez
   wszystkie kanały, biegnie pionowa linia bieżącej godziny z podpisem. */
check("program „teraz” jest podpisany „LIVE” przy tytule",
  src.indexOf('titleRow.className = "guide-title-row"') > 0 &&
  src.indexOf('live.className = "guide-live"') > 0 &&
  src.indexOf('live.textContent = t("live")') > 0 &&
  css.indexOf(".guide-live {") > 0);
check("mocne podswietlenie nalezy do wybieranego programu, nie do „teraz”",
  /\.guide-program:focus[\s\S]{0,140}background: var\(--grad\)/.test(css) &&
  /\.guide-program\.now\s*\{\s*border-color: var\(--accent\)/.test(css));
check("zaznaczony program do catch-up nie jest przygaszony",
  css.indexOf(".guide-program.past:focus") > 0);
check("linia biezacej godziny: pionowa kreska przez cala siatke i podpis z godzina",
  src.indexOf('line.className = "guide-nowline"') > 0 &&
  src.indexOf('line.id = "guideNowLine"') > 0 &&
  /\.guide-nowline\s*\{[^}]*top: 0[^}]*bottom: 0/.test(css) &&
  css.indexOf(".guide-nowline-label {") > 0);
check("linia liczy sie od poczatku osi czasu (kolumna kanalow + godzina)",
  src.indexOf("lane.offsetLeft") > 0 && src.indexOf("GUIDE_CHANNEL_WIDTH") > 0);
check("linia odswieza sie sama, a zegar chodzi tylko na widocznym programie TV",
  src.indexOf("setInterval(updateGuideNowLine, GUIDE_NOWLINE_MS)") > 0 &&
  src.indexOf('if (id !== "guideScreen") stopGuideNowLine();') > 0 &&
  src.indexOf("stopGuideNowLine();\n    showScreen(target);") > 0);
check("wiersze siedza we wspolnym pudelku (inaczej linia nie przejdzie przez wszystkie)",
  src.indexOf('rowsWrap.className = "guide-rows"') > 0 &&
  css.indexOf(".guide-rows { position: relative; }") > 0);
check("nazwy kanalow przykrywaja linie przy przewijaniu osi czasu",
  /\.guide-channel\s*\{[^}]*z-index: 4/.test(css) && /\.guide-axis\s*\{[^}]*z-index: 5/.test(css));
check("fokus kafelka kanalu to jedna obwodka wokol calego wiersza",
  css.indexOf("body.uimode-tv .channel .channel-main:focus") > 0);

/* --- 15. zakładki ustawień (Ogólne / Aktualizacja / Instrukcja) ----------
   Ustawienia rosły w jedną długą kartę, w której instrukcja pilota stała
   pomiędzy polami formularza. Teraz są trzy zakładki: „Ogólne” (sama
   aplikacja: profil, źródła, EPG, odtwarzanie, wygląd), „Aktualizacja” (tylko
   wydania) i „Instrukcja” (poradnik obsługi pilota). */
function settingsPanel(id) {
  const at = html.indexOf('id="' + id + '"');
  if (at < 0) return "";
  const next = html.indexOf('id="settingsPanel', at + 12);
  return next < 0 ? html.slice(at) : html.slice(at, next);
}

const tabsAt = html.indexOf('id="settingsTabs"');
const tabsHtml = tabsAt < 0 ? "" : html.slice(tabsAt, html.indexOf("</nav>", tabsAt));
const tabNames = (tabsHtml.match(/data-tab="[a-z]+"/g) || [])
  .map(function (s) { return s.replace(/.*="/, "").replace(/"$/, ""); });
check("ustawienia maja trzy zakladki (Ogolne / Aktualizacja / Instrukcja)",
  tabNames.join(",") === "general,update,help", tabNames.join(",") || "brak paska zakladek");
check("kazda zakladka ma napis z tlumaczen i swoja sekcje z trescia",
  html.indexOf('data-i18n="tab_general"') > 0 && html.indexOf('data-i18n="tab_update"') > 0 &&
  html.indexOf('data-i18n="tab_help"') > 0 &&
  html.indexOf('id="settingsPanelGeneral"') > 0 && html.indexOf('id="settingsPanelUpdate"') > 0 &&
  html.indexOf('id="settingsPanelHelp"') > 0);
check("zakladki przelacza app.js — widoczna jest jedna sekcja naraz",
  src.indexOf('var SETTINGS_TABS = ["general", "update", "help"];') > 0 &&
  src.indexOf("function showSettingsTab(name)") > 0 &&
  src.indexOf('panel.classList.toggle("hidden", !on)') > 0);
check("pilot zmienia zakladke (◀ ▶), a ▼ wchodzi w jej tresc",
  src.indexOf("stepSettingsTab(key === 37 || key === 412 ? -1 : 1)") > 0 &&
  src.indexOf("focusSettingsPanel();") > 0 &&
  src.indexOf('focused.getAttribute("data-tab")') > 0);
check("pasek zakladek wyglada jak przelacznik (aktywna w kolorze akcentu)",
  css.indexOf(".settings-tabs {") > 0 && css.indexOf(".settings-tab.active {") > 0 &&
  css.indexOf("body.uimode-tv .settings-tab") > 0);

const generalPanel = settingsPanel("settingsPanelGeneral");
const updatePanel = settingsPanel("settingsPanelUpdate");
const helpPanel = settingsPanel("settingsPanelHelp");
check("zakladka Ogolne trzyma sama aplikacje (zrodla, wyglad), a nie aktualizacje",
  generalPanel.indexOf('data-i18n="sources"') > 0 && generalPanel.indexOf('data-i18n="appearance"') > 0 &&
  generalPanel.indexOf('id="checkUpdates"') < 0);
check("zakladka Aktualizacja trzyma tylko wydania",
  updatePanel.indexOf('id="checkUpdates"') > 0 && updatePanel.indexOf('id="installUpdate"') > 0 &&
  updatePanel.indexOf('data-i18n="sources"') < 0);
check("zakladka Instrukcja to poradnik (nawigacja, odtwarzacz, EPG, archiwum)",
  helpPanel.indexOf('data-i18n="help_nav_move"') > 0 &&
  helpPanel.indexOf('data-i18n="player_keys"') > 0 &&
  helpPanel.indexOf('data-i18n="help_epg_grid"') > 0 &&
  helpPanel.indexOf('data-i18n="help_catchup_list"') > 0);
check("przyciski aktualizacji wygladaja jak przyciski (tlo, obwodka, hover)",
  /\.update-row button\s*\{[^}]*background: var\(--surface-2\)[^}]*border: 2px solid var\(--border\)/.test(css) &&
  css.indexOf(".update-row button:hover") > 0 &&
  /\.update-row #installUpdate\s*\{[^}]*background: var\(--grad\)/.test(css));
/* --- 16. pasek odtwarzacza bez duplikatow --------------------------------
   Na pasku stały przyciski „Kanał” (to samo, co MENU / trzymane OK) i
   „Wstecz” (to samo, co klawisz Wstecz na pilocie), a „Program TV” otwierał
   siatkę wszystkich kanałów zamiast programów oglądanego kanału. */
const osdStart = src.indexOf("function buildOsdActions()");
const osdEnd = src.indexOf("function openPlayerGuide()");
if (osdStart < 0 || osdEnd <= osdStart) throw new Error("Nie znalazlem paska odtwarzacza w app.js");
const codeOsd = src.slice(osdStart, osdEnd);
check("menu opcji kanalu i Wstecz na pasku pokazuja sie tylko na dotykowym ekranie",
  codeOsd.indexOf('classList.add("osd-touch-only")') > 0 &&
  codeOsd.indexOf('osdButton("options", t("ctx_menu")') > 0 &&
  css.indexOf("body.uimode-tv .osd-touch-only { display: none; }") > 0);
check("„EPG” na pasku otwiera liste programow ogladanego kanalu",
  codeOsd.indexOf('osdButton("epg", t("osd_epg"), openPlayerGuide)') > 0 &&
  src.indexOf("openArchive(state.watchChannel, { fromPlayer: true });") > 0 &&
  src.indexOf('osd_epg: "📅 EPG"') > 0);
check("„Na zywo” jest na pasku wtedy, gdy obraz nie jest na zywo",
  codeOsd.indexOf('if (state.isArchive) bar.appendChild(osdButton("live", t("osd_live"), goLive));') > 0);
check("„Od poczatku” zostaje takze na kanale na zywo z EPG",
  codeOsd.indexOf("if (state.isArchive || currentProgram(channel))") > 0);

/* --- 17. „Wstecz” w odtwarzaczu nie wraca na pusty odtwarzacz -------------
   Akcje wewnątrz obrazu (następny program, „od początku”, „na żywo”,
   wznowienie po pauzie) podawały playerScreen jako ekran powrotu. Po wyjściu
   z kanału „Wstecz” pokazywał więc czarny prostokąt: odtwarzacz bez obrazu,
   bez paska i bez listy kanałów. */
check("cel powrotu odtwarzacza nigdy nie jest samym odtwarzaczem",
  src.indexOf('if (returnScreen && returnScreen !== "playerScreen") state.playerReturn = returnScreen;') > 0);
check("stopPlayback pilnuje, ze nie wraca na odtwarzacz bez kanalu",
  src.indexOf("var target = state.playerReturn && state.playerReturn !== \"playerScreen\"") > 0 &&
  src.indexOf("showScreen(target);") > 0);
check("lista programow wraca do obrazu tylko wtedy, gdy cos tam jeszcze leci",
  src.indexOf('archive.returnTo === "playerScreen" && state.watchChannel ? "playerScreen" : "browserScreen"') > 0);
check("Wstecz z archiwum idzie wspolna droga (closeArchive)",
  src.indexOf("if (archiveClose) archiveClose.onclick = closeArchive;") > 0 &&
  src.indexOf("closeArchive();\n      return true;") > 0);

/* --- 18. lista programow kanalu (EPG w odtwarzaczu) ---------------------- */
check("lista pokazuje takze to, co dopiero bedzie (12 godzin w przod)",
  src.indexOf("var ARCHIVE_AHEAD = 12 * 3600000;") > 0 &&
  src.indexOf("var until = fromPlayer ? now + ARCHIVE_AHEAD : now;") > 0);
check("program, ktory leci teraz, ma podpis LIVE",
  src.indexOf('live.className = "guide-live"') > 0 && src.indexOf('live.textContent = t("live")') > 0);
check("program, ktory dopiero bedzie, widac, ale nie da sie go wybrac",
  src.indexOf('note.textContent = t("epg_list_future")') > 0 &&
  src.indexOf("button.disabled = true;") > 0 && css.indexOf(".program.future {") > 0);
check("„Na zywo” nad lista wraca do biezacej chwili",
  html.indexOf('id="archiveLive"') > 0 && src.indexOf("function playArchiveLive()") > 0 &&
  src.indexOf("if (archiveLive) archiveLive.onclick = playArchiveLive;") > 0);
check("lista otwarta z odtwarzacza wraca potem do listy kanalow",
  src.indexOf('playChannel(channel, program, fromPlayer ? "browserScreen" : "archiveScreen");') > 0);

/* --- 19. play/pauza z pilota (klawisze multimedialne) --------------------
   Przycisk ⏵‖ na pilocie nie robił nic: dekodery wysyłają różne kody
   (85 / 126 / 127 / 86 / 415 / 179), a część z nich WebView zjadał dla
   własnej sesji multimediów. Teraz obsługujemy kody i nazwy klawiszy, stan
   sesji multimediów, zwolnienie klawisza i most natywny. */
check("kody klawiszy multimedialnych obu platform",
  src.indexOf("var MEDIA_KEY_TOGGLE = [85, 126, 179, 415];") > 0 &&
  src.indexOf("var MEDIA_KEY_PAUSE = [86, 93, 127, 178];") > 0 &&
  src.indexOf('if (name === "MediaPlayPause" || name === "MediaPlay") return "toggle";') > 0);
check("play/pauza dziala takze bez keydown (keyup) i przez most natywny",
  src.indexOf("if (media && !mediaKeyHandledRecently()) {") > 0 &&
  src.indexOf("window.__openiptvKey = function (code, name)") > 0 &&
  src.indexOf("runMediaKey(media);") > 0);
check("sesja multimediow rejestruje akcje pilota (Android TV / Fire TV)",
  src.indexOf("function bindMediaSession()") > 0 &&
  src.indexOf("seekbackward: function () { seekBy(-1); }") > 0 &&
  src.indexOf("session.playbackState = inPlayer") > 0);
check("natywny odbiornik wie, ze leci obraz (most setPlayerMode)",
  src.indexOf("function notifyNativePlayer(on)") > 0 && src.indexOf("bridge.setPlayerMode(!!on);") > 0 &&
  src.indexOf('notifyNativePlayer(id === "playerScreen");') > 0);
check("MainActivity oddaje klawisze multimedialne stronie tylko w odtwarzaczu",
  java.indexOf("public boolean onKeyDown(int keyCode, KeyEvent event)") > 0 &&
  java.indexOf("window.__openiptvKey") > 0 &&
  java.indexOf("public void setPlayerMode(final boolean on)") > 0 &&
  java.indexOf("if (playerMode && isMediaKey(keyCode))") > 0);

/* --- 20. pasek przewijania archiwum („cofnieto / przesunieto o N s”) ----
   Po skoku w catch-upie dekoder donosi obraz na nowa pozycje i pasek mowil
   wtedy „Ladowanie strumienia… (LIVE)”, choc obraz byl tylko przesuwany.
   Teraz pasek opisuje skok, a komunikat o wczytywaniu nazywa silnik. */
check("pasek ma osobne miejsce na wpis o przewinieciu",
  html.indexOf('id="playerSeek"') > 0 && html.indexOf('class="player-seek hidden"') > 0 &&
  css.indexOf(".player-seek {") > 0);
check("skok w archiwum opisuje krok w sekundach, w obu jezykach",
  src.indexOf("function markSeek(direction, seconds)") > 0 &&
  src.indexOf('seek_back: "Cofnięto o {s} s"') > 0 &&
  src.indexOf('seek_forward: "Przesunięto o +{s} s"') > 0 &&
  src.indexOf('seek_back: "Back {s} s"') > 0 &&
  src.indexOf('seek_forward: "Forward +{s} s"') > 0);
check("opis skoku bierze sie z tego, co sie naprawde przesunelo",
  src.indexOf("if (moved) markSeek(moved < 0 ? -1 : 1, Math.abs(moved));") > 0 &&
  src.indexOf("var moved = Math.round(video.currentTime) - Math.round(before);") > 0);
check("nowe okno catch-up i powrot na zywo nie zostawiaja starego wpisu",
  src.indexOf("markSeek(-1, seekStep());") > 0 && src.indexOf("clearSeekMark();") > 0 &&
  src.indexOf("function clearSeekMark()") > 0);
check("po skoku waiting pokazuje skok, a nie wczytywanie strumienia",
  src.indexOf("if (seekNotice()) { showOsd(); return; }") > 0 &&
  src.indexOf("function seekNotice()") > 0 && src.indexOf("var SEEK_GRACE = 6000;") > 0);
check("komunikat o wczytywaniu nazywa silnik, a nie stan obrazu (LIVE)",
  src.indexOf("function engineName(engine)") > 0 &&
  src.indexOf('engine_native: "natywnie"') > 0 &&
  src.indexOf('showPlayerError(t("osd_buffering") + " (" + engineName(state.engine) + ")");') > 0);
check("kolejne nacisniecia pilota sumuja sie w jednym wpisie",
  src.indexOf("var same = state.seekAt && state.seekDirection === direction &&") > 0 &&
  src.indexOf("state.seekSize = (same ? state.seekSize : 0) + seconds;") > 0 &&
  src.indexOf("now - state.seekAt <= SEEK_GRACE;") > 0);
check("pasek odtwarzacza odswieza wpis razem z reszta wskazan",
  src.indexOf("updateOsdProgress();\n    refreshSeekNotice();") > 0);

/* --- 21. przewijanie z pilota: warianty klawiszy ⏪ ⏩ ----------------------
   Jeden przycisk ⏪ / ⏩, a dekodery wysylaja go roznymi kodami: webOS
   412/417, Android TV i Fire TV 89/90, a czesc pilotow klawisze „poprzedni /
   nastepny” (88/87, w Chromium 177/176). Bierzemy tez nazwy klawiszy, bo
   niektore piloty podaja kod 0, oraz zwolnienie klawisza, bo czesc pilotow
   wysyla przewijanie dopiero na keyup. */
check("przewijanie zna kody wszystkich pilotow",
  src.indexOf("var SEEK_BACK_KEYS = [412, 89, 88, 177];") > 0 &&
  src.indexOf("var SEEK_FORWARD_KEYS = [417, 90, 87, 176];") > 0);
check("przewijanie zna tez nazwy klawiszy (kod 0 na czesci dekoderow)",
  src.indexOf("function seekKeyDirection(keyCode, keyName, arrowsSeek)") > 0 &&
  src.indexOf('if (name === "MediaRewind" || name === "MediaTrackPrevious") return -1;') > 0 &&
  src.indexOf('if (name === "MediaFastForward" || name === "MediaTrackNext") return 1;') > 0);
check("strzalki przewijaja tylko przy wlaczonym ustawieniu",
  src.indexOf("if (arrowsSeek && keyCode === 37) return -1;") > 0 &&
  src.indexOf("if (arrowsSeek && keyCode === 39) return 1;") > 0 &&
  src.indexOf("var seekDirection = seekKeyDirection(key, event.key, settings.dpadSeek);") > 0);
check("most natywny przewija ta sama droga co klawiatura",
  src.indexOf("var seekDirection = seekKeyDirection(code, name, settings.dpadSeek);") > 0);
check("klawisz wyslany dopiero na zwolnieniu tez przewija - i tylko raz",
  src.indexOf("var seekKeyDown = {};") > 0 &&
  src.indexOf("seekKeyDown[key] = true;") > 0 &&
  src.indexOf("seekKeyDown[code] = true;") > 0 &&
  src.indexOf("if (seekKeyDown[seekCode]) { delete seekKeyDown[seekCode]; return; }") > 0 &&
  src.indexOf("var seekDirection = seekKeyDirection(seekCode, event.key, false);") > 0);

/* --- 22. program TV: siatka okienkowa (wszystkie kanały), większe okno -------
   Program TV rysował wiersze tylko dla 60 kanałów, a przy 5000 kanałów zaciąłby
   telewizor. Teraz w DOM jest tylko widok z zapasem (GUIDE_CHUNK / GUIDE_OVERSCAN),
   a brakujące kanały udają odstępy — dzięki temu siatka pokazuje wszystkie kanały
   kategorii, a rysowanie jednej porcji jest zawsze tak samo tanie. Okno jest
   większe (godziny liczą się z realnej szerokości ekranu, nagłówek jest mniejszy),
   a kafelki czytelniejsze (wyższy wiersz, tytuł w dwóch liniach, pasek postępu).
   Start EPG jest odroczony, żeby pobieranie nie zamroziło uruchomienia. */
check("siatka pokazuje wszystkie kanaly kategorii (bez ucinania listy)",
  src.indexOf("var GUIDE_CHUNK = 16;") > 0 &&
  src.indexOf("var GUIDE_OVERSCAN = 24;") > 0 &&
  src.indexOf("var GUIDE_AHEAD = 8;") > 0 &&
  src.indexOf("GUIDE_ROWS") < 0 && src.indexOf("guide_limited") < 0 &&
  src.indexOf('if (name === "@all") return true;') > 0);
check("brakujace kanaly udaja odstepy o wysokosci wiersza (padding siatki)",
  src.indexOf("function guideUpdateSpacers()") > 0 &&
  src.indexOf("wrap.style.paddingTop = (guide.winStart * guide.rowHeight)") > 0 &&
  src.indexOf("wrap.style.paddingBottom =") > 0 &&
  src.indexOf("guideUpdateSpacers();") > 0);
check("wiersze daleko nad widokiem sa usuwane, ale nie ten z fokusem",
  src.indexOf("function guidePruneTop(limit)") > 0 &&
  src.indexOf("if (!row || row.contains(document.activeElement)) break;") > 0);
check("przewijanie dokłada wiersze jedna porcja na raz (siatka sie nie zacina)",
  src.indexOf("function guideFollowScroll()") > 0 &&
  src.indexOf("if (guide.scrollLock) return;") > 0 &&
  src.indexOf("guideFill(Math.min(need, guideRowsOnScreen() + GUIDE_OVERSCAN * 3))") > 0 &&
  src.indexOf('grid.setAttribute("data-guide-scroll", "1");') > 0);
check("fokus na krawedzi widoku dokłada wiersze, zanim zabraknie programu",
  src.indexOf("function guideEnsureAhead()") > 0 &&
  src.indexOf("if (ahead < GUIDE_AHEAD) guideFill(GUIDE_AHEAD - ahead + GUIDE_CHUNK);") > 0 &&
  src.indexOf("guideEnsureAhead();") > 0);
check("okno wypelnia ekran: liczba godzin liczy sie z szerokosci siatki",
  src.indexOf("function guideFitHours(innerWidth, channelWidth)") > 0 &&
  src.indexOf("var GUIDE_MIN_HOURS = 3;") > 0 &&
  src.indexOf("var GUIDE_MAX_HOURS = 6;") > 0 &&
  src.indexOf("var GUIDE_HOUR_MIN_W = 300;") > 0 &&
  src.indexOf('container.style.setProperty("--guide-hour", guide.hourWidth + "px");') > 0);
check("szerokosc godziny idzie z app.js do CSS (linie godzin na kazdym wierszu)",
  css.indexOf("var(--guide-hour, 300px)") > 0 &&
  /\.guide-lane\s*\{[^}]*repeating-linear-gradient/.test(css));
check("ekran jest pokazywany przed rysowaniem (godziny z realnej szerokosci)",
  src.indexOf('showScreen("guideScreen");\n    renderGuide();') > 0 &&
  src.indexOf("var inner = guideInnerWidth();") > 0);
check("zmiana dnia albo godzin zostawia ten sam kanal pod fokusem",
  src.indexOf("function guideRedraw(shift)") > 0 &&
  src.indexOf("guideSetWindow(guide.windowStart + dir * 24 * 3600000);") > 0 &&
  src.indexOf("guideSetWindow(next - (next % 3600000));") > 0 &&
  src.indexOf("if (rowIndex > 0) guide.anchor = rowIndex - 1;") > 0 &&
  src.indexOf("if (inGrid) focusGuideRowBlock(rowIndex, focusTime, focusSame);") > 0);
check("po zmianie dnia albo godzin wracamy na ten sam program i to samo miejsce wiersza",
  src.indexOf("var focusTime = guideFocusTime();") > 0 &&
  src.indexOf("var keepOffset = guideRowViewportOffset();") > 0 &&
  src.indexOf("guideRestoreRowOffset(keepOffset);") > 0 &&
  src.indexOf("function guideBlockAtTime(row, time)") > 0);
check("przeskok o dobe szuka tej samej godziny, a nie ostatniego programu w kanale",
  src.indexOf("var focusSame = focusTime && shift ? focusTime + shift : 0;") > 0 &&
  src.indexOf("function guideBlockContaining(row, time)") > 0 &&
  src.indexOf("var block = guideBlockContaining(row, time) || guideBlockContaining(row, sameTime) ||") > 0 &&
  src.indexOf("function focusGuideRowBlock(index, time, sameTime)") > 0 &&
  /* okno zmienia sie wylacznie przez guideSetWindow: gdy ktos znowu ustawi
     guide.windowStart z pominieciem przeskoku, fokus przy „Wczoraj” wroci na
     ostatni program w kanale (dzien bez towarzyszacego guideRedraw) */
  (src.match(/guide\.windowStart = (?!start;)/g) || []).length === 1);
check("przycisk dnia nie cofa widoku siatki na poczatek listy",
  src.indexOf("var inGrid = rowIndex >= 0;") > 0 &&
  src.indexOf("var top = Math.max(0, grid.scrollTop - guideRowsOffset());") > 0 &&
  src.indexOf("rowIndex = guide.winStart + Math.floor(top / guide.rowHeight);") > 0);

check("obrot ekranu przerysowuje siatke (godziny licza sie na nowo)",
  /window\.addEventListener\("resize", function \(\) \{[\s\S]{0,400}guideRedraw\(\);/.test(src) &&
  src.indexOf("guide.resizeTimer = window.setTimeout(function () {") > 0);
check("naglowek programu TV jest mniejszy (przyciski dnia w jednej linii)",
  /#guideScreen header nav button\s*\{[^}]*padding: 10px 16px[^}]*font-size: 18px/.test(css) &&
  /#guideScreen > header > div\s*\{[^}]*display: flex/.test(css) &&
  css.indexOf("body.uimode-tv #guideScreen header nav button") > 0 &&
  css.indexOf("body.uimode-tv #guideScreen header nav input") > 0);
check("wiersz jest wyzszy, a tytul lamie sie na dwie linie",
  /\.guide-row \{[^}]*height: 96px/.test(css) &&
  css.indexOf("-webkit-line-clamp: 2") > 0 &&
  src.indexOf("return height > 20 ? height : 96;") > 0 &&
  src.indexOf("rowHeight: 96,") > 0);
check("program, ktory leci teraz, ma pasek postepu",
  src.indexOf('bar.className = "guide-progress"') > 0 &&
  src.indexOf("block.appendChild(bar);") > 0 &&
  src.indexOf("(now - p.start) / (p.end - p.start) * 100") > 0 &&
  css.indexOf(".guide-progress {") > 0);
check("programy z archiwum nie sa przygaszone tak samo jak te bez archiwum",
  css.indexOf(".guide-program.past:not([disabled])") > 0 &&
  css.indexOf(".guide-program.past:focus") > 0);
check("napis zakresu podaje liczbe kanalow (bez „pokazano 60 z …”)",
  src.indexOf('t("guide_count", { count: guide.items.length })') > 0 &&
  src.indexOf('guide_count: "kanałów: {count}"') > 0 &&
  src.indexOf('guide_count: "channels: {count}"') > 0 &&
  src.indexOf("guide_limited") < 0);
check("podpowiedz pilota pod siatka mowi o kanalach i powrocie do dni",
  src.indexOf('guide_pan_hint: "◀ ▶ — przewijanie godzin • ▲ ▼ — kanały"') > 0 &&
  src.indexOf("help_epg_pan:") > 0 &&
  src.indexOf("▲ ▼ chodzą po kanałach") > 0);
check("z gornego wiersza ▲ wraca do przyciskow dnia",
  src.indexOf("if (keyCode === 38) focusGuideHeader();") > 0 &&
  src.indexOf('var target = $("guideToday") || $("guideClose");') > 0);
check("start EPG jest odroczony (lista kanalow rysuje sie od razu)",
  src.indexOf("function scheduleEpgStart(profile, epgUrl)") > 0 &&
  src.indexOf("window.requestIdleCallback(run, { timeout: 4000 })") > 0 &&
  src.indexOf("scheduleEpgStart(profile, state.epgUrl);") > 0 &&
  !/if \(settings\.epgReloadOnStart\) \{\s*loadEpgInBackground/.test(src));
check("odroczony start nie ruszy bez listy kanalow ani po zmianie profilu",
  src.indexOf("var EPG_START_DELAY_MS = 1500;") > 0 &&
  src.indexOf("window.setTimeout(run, EPG_START_DELAY_MS)") > 0 &&
  src.indexOf("if (!state.channels.length) return;") > 0 &&
  src.indexOf("if (!current || current.id !== profile.id) return;") > 0 &&
  src.indexOf("cancelEpgStart();\n    loadEpgInBackground(profile, state.epgUrl);") > 0);

/* --- 23. komunikat na środku obrazu i ▲ ▼ w pasku odtwarzacza ---------------
   Dwie rzeczy z pilota:
     • wpis o skoku („Cofnięto o 10 s”) był tylko w pasku, a pasek chowa się sam
       po OSD_AUTOHIDE — teraz ten sam komunikat widać na środku obrazu,
     • ▼ po otwarciu paska klawiszem OK zmieniało kanał, więc do przycisków
       („Pauza”, „EPG”…) nie dało się dojść. Pasek otwarty przez użytkownika jest
       teraz menu: ▲ ▼ wchodzą w jego przyciski, a pasek pokazany przy zmianie
       kanału zostaje informacją — ▲ ▼ dalej przełączają kanały. */
check("komunikat o skoku jest na srodku obrazu, nie tylko w pasku",
  html.indexOf('id="playerToast"') > 0 && html.indexOf('class="player-toast hidden"') > 0 &&
  src.indexOf("function showPlayerToast(text, ms)") > 0 &&
  src.indexOf("showPlayerToast(seekNotice());") > 0 &&
  src.indexOf("var TOAST_MS = 2000;") > 0);
check("komunikat jest wysrodkowany na wideo i nie lapie klikniec",
  /\.player-toast\s*\{[^}]*left: 50%; top: 50%[^}]*translate\(-50%, -50%\)[^}]*pointer-events: none/.test(css) &&
  css.indexOf("body.uimode-tv .player-toast {") > 0 &&
  css.indexOf("body.uimode-touch .player-toast {") > 0);
const clearMarkStart = src.indexOf("function clearSeekMark()");
const clearMarkBody = src.slice(clearMarkStart, src.indexOf("\n  }", clearMarkStart));
check("nowy obraz gasi komunikat razem z wpisem o skoku",
  clearMarkStart > 0 && clearMarkBody.indexOf("hidePlayerToast();") > 0);

check("pasek otwarty klawiszem OK jest menu, a nie tylko informacja",
  src.indexOf("osdMenu: false,") > 0 &&
  src.indexOf("function showOsd(options)") > 0 &&
  src.indexOf("state.osdMenu = !!(options && options.menu);") > 0 &&
  src.indexOf("else showOsd({ menu: true });") > 0 &&
  src.indexOf("state.osdMenu = false;\n    clearTimeout(state.osdTimer);") > 0 &&
  src.indexOf("state.osdMenu = false;\n    clearTimeout(overlayTimer);") > 0);
check("fokus na przycisku paska (mysz, dotyk) tez znaczy menu",
  src.indexOf("button.onfocus = function () {\n      state.osdMenu = true;") > 0);
check("▲ ▼ po otwarciu paska wchodza w jego przyciski",
  /if \(!onOsdButton && state\.osdMenu && osdVisible\(\) && \(key === 38 \|\| key === 40\)\) \{[\s\S]{0,120}enterOsdBar\(\);/.test(src) &&
  src.indexOf("function enterOsdBar()") > 0 &&
  src.indexOf("buttons[0].focus();") > 0);
const menuBranch = src.indexOf("if (!onOsdButton && state.osdMenu && osdVisible()");
const zapBranch = src.indexOf("zapChannel(key === 38 ? -1 : 1);");
check("wejscie w menu stoi przed przelaczaniem kanalu",
  menuBranch > 0 && zapBranch > menuBranch);
check("▲ ▼ z paska wychodza z menu na obraz (kanal znowu dziala)",
  src.indexOf("if (key === 38 || key === 40) {\n          if (!focusNearest(key)) leaveOsdBar();\n        } else {\n          focusNearest(key);\n        }") > 0 &&
  src.indexOf("function leaveOsdBar()") > 0);
const focusBlock = src.slice(src.indexOf("function focusNearest(keyCode)"),
  src.indexOf("function searchArrowTarget("));
check("nawigacja mowi, czy fokus sie ruszyl (koniec menu na krawedzi paska)",
  focusBlock.indexOf("if (!candidates.length) return false;") > 0 &&
  focusBlock.indexOf("return true;") > 0 && focusBlock.indexOf("return false;") > 0);
check("Wstecz najpierw zamyka otwarty pasek, a potem wychodzi z kanalu",
  src.indexOf("if (state.osdMenu && osdVisible()) {\n        hideOsd();\n        return true;\n      }") > 0);
check("nakladka nad obrazem (menu opcji) ma swoje strzalki i OK",
  src.indexOf('if ($("contextMenu") || $("exitDialog")) {') > 0 &&
  src.indexOf("if (overlay && overlay.contains(osdFocus) && osdFocus.click) osdFocus.click();") > 0);
check("podpowiedzi pilota i instrukcja opisuja ▲ ▼ w pasku oraz komunikat",
  src.indexOf("a w otwartym pasku – jego przyciski") > 0 &&
  src.indexOf("or the bar buttons while it is open") > 0 &&
  src.indexOf("widać na środku obrazu") > 0 &&
  src.indexOf("shows in the middle of the picture") > 0 &&
  html.indexOf("Po skoku komunikat („Cofnięto o 10 s”) widać na środku obrazu.") > 0 &&
  html.indexOf("Gdy pasek jest otwarty, ▲ ▼ wchodzą najpierw w jego przyciski") > 0);

/* Zachowanie, nie napisy: uruchamiamy prawdziwą obsługę klawiszy z app.js na
   atrapie ekranu odtwarzacza i patrzymy, co zrobi ▼ po otwarciu paska (OK),
   a co przy pasku pokazanym tylko jako informacja. */
const keyStart = src.indexOf('document.addEventListener("keydown", function (event) {');
const keyEnd = src.indexOf("/* Akcję przypisujemy dopiero na zwolnieniu OK", keyStart);
if (keyStart < 0 || keyEnd <= keyStart) throw new Error("Nie znalazlem obslugi klawiszy w app.js");
/* Wycięty blok kończy się rejestracją listy („});”) — zamykamy ciało funkcji
   i samo wywołanie, żeby całość była poprawnym fragmentem kodu. */
const codeKeys = src.slice(keyStart, keyEnd).replace(/\n\s*\}\);\s*$/, "\n  })");

function fakeClass(hidden) {
  return {
    hidden: !!hidden,
    contains: function (c) { return c === "hidden" ? !!this.hidden : false; },
    add: function (c) { if (c === "hidden") this.hidden = true; },
    remove: function (c) { if (c === "hidden") this.hidden = false; }
  };
}
function fakeEl(hidden) {
  const el = { classList: fakeClass(hidden), clicks: 0 };
  el.contains = function () { return false; };
  el.focus = function () {};
  el.click = function () { el.clicks++; };
  el.getAttribute = function () { return null; };
  return el;
}
function keyHarness(o) {
  o = o || {};
  const calls = { zap: [], focus: [], enter: 0, leave: 0, clicks: 0 };
  const player = fakeEl(false);            /* ekran odtwarzacza widoczny */
  const overlay = fakeEl(!o.overlayVisible); /* pasek widoczny albo schowany */
  const ctxMenu = fakeEl(false);            /* menu opcji nad obrazem */
  /* w prawdziwej nakładce fokus siedzi w środku, więc OK trafia w jej przycisk */
  ctxMenu.contains = function () { return true; };
  const active = fakeEl(false);
  if (o.onOsdButton) active.getAttribute = function () { return "play"; };
  active.click = function () { calls.clicks++; };
  let handler = null;
  const sandbox = {
    state: { osdMenu: !!o.osdMenu, watchChannel: { name: "TVN" }, mediaKeyAt: 0 },
    settings: { dpadSeek: false, osdEnabled: true },
    $: function (id) {
      if (id === "playerScreen") return player;
      if (id === "playerOverlay") return overlay;
      if (id === "contextMenu") return o.contextMenu ? ctxMenu : null;
      if (id === "exitDialog") return null;
      if (id === "guideScreen") return fakeEl(true);
      return fakeEl(true);
    },
    document: {
      activeElement: active,
      addEventListener: function (type, fn) { if (type === "keydown") handler = fn; }
    },
    osdVisible: function () { return !!o.overlayVisible; },
    enterOsdBar: function () { calls.enter++; return true; },
    leaveOsdBar: function () { calls.leave++; },
    zapChannel: function (direction) { calls.zap.push(direction); },
    focusNearest: function (key) { calls.focus.push(key); return o.focusMoves !== false; },
    scheduleOsdHide: function () {},
    seekKeyDirection: function () { return 0; },
    mediaKeyAction: function () { return ""; },
    t: function (k) { return k; }
  };
  run(codeKeys, sandbox);
  return {
    calls: calls,
    press: function (key) {
      if (handler) handler({ keyCode: key, repeat: false, preventDefault: function () {} });
    }
  };
}

let kh = keyHarness({ osdMenu: true, overlayVisible: true });
kh.press(40);
check("uruchomione: ▼ po otwarciu paska wchodzi w przyciski, a nie zmienia kanalu",
  kh.calls.enter === 1 && kh.calls.zap.length === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true });
kh.press(38);
check("uruchomione: ▲ przy otwartym pasku tez wchodzi w przyciski",
  kh.calls.enter === 1 && kh.calls.zap.length === 0, JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: false, overlayVisible: true });
kh.press(40);
kh.press(40);
check("uruchomione: pasek-informacja zostawia ▼ przy kanalach (dwa razy = dwa kanaly)",
  kh.calls.zap.length === 2 && kh.calls.zap[0] === 1 && kh.calls.zap[1] === 1 && kh.calls.enter === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({});
kh.press(38);
check("uruchomione: bez paska ▲ zmienia kanal w gore",
  kh.calls.zap.length === 1 && kh.calls.zap[0] === -1 && kh.calls.enter === 0, JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true, onOsdButton: true });
kh.press(39);
check("uruchomione: ◀ ▶ na przycisku paska chodza po pasku (bez zmiany kanalu)",
  kh.calls.focus.length === 1 && kh.calls.zap.length === 0 && kh.calls.leave === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true, onOsdButton: true, focusMoves: false });
kh.press(38);
check("uruchomione: ▲ z paska bez pozycji wyzej wychodzi z menu na obraz",
  kh.calls.leave === 1 && kh.calls.zap.length === 0 && kh.calls.enter === 0,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true, contextMenu: true });
kh.press(38);
check("uruchomione: w menu opcji nad obrazem ▲ nie zmienia kanalu",
  kh.calls.zap.length === 0 && kh.calls.enter === 0 && kh.calls.focus.length === 1,
  JSON.stringify(kh.calls));

kh = keyHarness({ osdMenu: true, overlayVisible: true, contextMenu: true });
kh.press(13);
check("uruchomione: OK w menu opcji nad obrazem wybiera podswietlona pozycje",
  kh.calls.clicks === 1 && kh.calls.enter === 0, JSON.stringify(kh.calls));

/* --- 24. zegar w rogu obrazu ------------------------------------------------ 
   Nowe ustawienie „Zegar w rogu obrazu”: pokazuje HH:MM w lewym górnym rogu,
   ale wyłącznie podczas oglądania programu. Sprawdzamy jedno i drugie — że
   przełącznik oraz sam zegar są w aplikacji, i że naprawdę pokazuje właściwą
   godzinę (wyciągamy funkcje z app.js i uruchamiamy je na atrapie ekranu). */
check("ustawienia maja przelacznik zegara w rogu",
  html.indexOf('id="clockEnabled"') > 0 &&
  html.indexOf('data-i18n="clock_enabled"') > 0 &&
  src.indexOf("clockEnabled: false,") > 0 &&
  src.indexOf('$("clockEnabled").onchange = function () {') > 0 &&
  src.indexOf("settings.clockEnabled = $(\"clockEnabled\").checked;") > 0 &&
  src.indexOf('$("clockEnabled").checked = settings.clockEnabled === true;') > 0);
check("zegar jest elementem ekranu odtwarzacza, nie listy kanalow",
  html.indexOf('id="cornerClock" class="corner-clock hidden"') > 0 &&
  src.indexOf("function syncCornerClock()") > 0);
check("zegar rusza i gasnie razem ze zmiana ekranu",
  src.indexOf("/* zegar w rogu obrazu ma sens tylko na widocznym ekranie odtwarzacza */\n    syncCornerClock();") > 0);
check("zegar siedzi w lewym gornym rogu i nie lapie klikniec",
  /\.corner-clock\s*\{[^}]*left: 34px; top: 26px[^}]*pointer-events: none/.test(css) &&
  css.indexOf("body.uimode-tv .corner-clock {") > 0 &&
  css.indexOf("body.uimode-touch .corner-clock {") > 0);
check("zegar wraca do wlasciwej godziny po powrocie do aplikacji",
  src.indexOf("document.addEventListener(\"visibilitychange\", function () {") > 0 &&
  src.indexOf("if (!document.hidden) syncCornerClock();") > 0);

const clockStart = src.indexOf("var clockTimer = null;");
const clockEnd = src.indexOf("function atLiveEdge()");
if (clockStart < 0 || clockEnd <= clockStart) throw new Error("Nie znalazlem zegara w rogu w app.js");
const codeClock = src.slice(clockStart, clockEnd);
if (codeClock.indexOf("function syncCornerClock") < 0 || codeClock.indexOf("function cornerClockText") < 0) {
  throw new Error("Wyciety blok nie ma zegara w rogu");
}

function clockHarness(o) {
  o = o || {};
  const calls = { shown: 0, hidden: 0, timers: [] };
  const clock = {
    textContent: "",
    classList: {
      add: function (c) { if (c === "hidden") calls.hidden++; },
      remove: function (c) { if (c === "hidden") calls.shown++; }
    }
  };
  const screen = {
    classList: { contains: function (c) { return c === "hidden" ? !!o.screenHidden : false; } }
  };
  /* Czas zamrozony: `new Date()` w app.js musi zwracac stala godzine, wiec
     podstawiamy wlasna klase, a odczyty godzin delegujemy do prawdziwego Date. */
  const RealDate = Date;
  const FIXED = typeof o.nowMs === "number" ? o.nowMs : 0;
  function FakeDate(ts) {
    this.real = new RealDate(ts === undefined ? FIXED : ts);
  }
  FakeDate.now = function () { return FIXED; };
  ["getHours", "getMinutes", "getSeconds", "getMilliseconds", "getTime"].forEach(function (method) {
    FakeDate.prototype[method] = function () { return this.real[method](); };
  });

  const sandbox = {
    settings: { clockEnabled: o.enabled === true },
    state: { watchChannel: o.watching === false ? null : { name: "TVN" } },
    $: function (id) {
      if (id === "cornerClock") return clock;
      if (id === "playerScreen") return screen;
      return null;
    },
    pad2: function (n) { return n < 10 ? "0" + n : String(n); },
    Date: FakeDate,
    setTimeout: function (fn, ms) { calls.timers.push(ms); return calls.timers.length; },
    clearTimeout: function () {}
  };
  run(codeClock, sandbox);
  return { api: sandbox, calls: calls, clock: clock };
}

/* 21:07:20 — do pelnej minuty zostaje 39,88 s plus zapas 120 ms */
const CLOCK_NOW = new Date(2026, 9, 3, 21, 7, 20).getTime();
let ck = clockHarness({ enabled: true, nowMs: CLOCK_NOW });
ck.api.syncCornerClock();
check("uruchomione: zegar pokazuje godzine HH:MM podczas ogladania",
  ck.clock.textContent === "21:07" && ck.calls.shown === 1 && ck.calls.hidden === 0,
  ck.clock.textContent + " " + JSON.stringify(ck.calls));
check("uruchomione: tykniecie wypada rowno z pelna minuta",
  ck.calls.timers.length === 1 && ck.calls.timers[0] === 40120,
  JSON.stringify(ck.calls.timers));

ck = clockHarness({ enabled: true });
check("godzina jest zawsze dwucyfrowa (09:05, nie 9:5)",
  ck.api.cornerClockText(new Date(2026, 9, 3, 9, 5).getTime()) === "09:05" &&
  ck.api.cornerClockText(new Date(2026, 9, 3, 0, 0).getTime()) === "00:00",
  ck.api.cornerClockText(new Date(2026, 9, 3, 9, 5).getTime()));

ck = clockHarness({ enabled: false, nowMs: CLOCK_NOW });
ck.api.syncCornerClock();
check("wylaczony w ustawieniach: zegar sie nie pokazuje i nic nie chodzi",
  ck.clock.textContent === "" && ck.calls.shown === 0 && ck.calls.hidden === 1 && ck.calls.timers.length === 0,
  JSON.stringify(ck.calls));

ck = clockHarness({ enabled: true, watching: false, nowMs: CLOCK_NOW });
ck.api.syncCornerClock();
check("bez ogladania kanalu zegar zostaje schowany (lista, EPG, ustawienia)",
  ck.calls.shown === 0 && ck.calls.hidden === 1 && ck.calls.timers.length === 0,
  JSON.stringify(ck.calls));

ck = clockHarness({ enabled: true, screenHidden: true, nowMs: CLOCK_NOW });
ck.api.syncCornerClock();
check("po wyjsciu z odtwarzacza zegar gasnie",
  ck.calls.shown === 0 && ck.calls.hidden === 1 && ck.calls.timers.length === 0,
  JSON.stringify(ck.calls));

ck = clockHarness({ enabled: true, nowMs: CLOCK_NOW });
ck.api.syncCornerClock();
ck.api.syncCornerClock();
check("kolejne ustawienie budzika nie mnozy zegarow (jeden na raz)",
  ck.calls.timers.length === 2 && ck.calls.shown === 2, JSON.stringify(ck.calls));


/* --- 25. brak obrazu: dzwiek gra, ekran czarny ------------------------------
   Na czesci dekoderow Android/Fire TV <video> odtwarza sam dzwiek — stan
   odtwarzania jest poprawny, wiec zwykly budzik uznawal kanal za uruchomiony
   i czarny ekran zostawal na zawsze. Sprawdzamy, ze aplikacja: (1) wykrywa brak
   obrazu po wymiarach klatki, (2) probuje naprawic warstwe obrazu i powtarza ten
   sam strumien, (3) dopiero potem zmienia sposob odtwarzania, (4) pamieta ten,
   ktory naprawde dal obraz. */
check("brak obrazu wykrywany po wymiarach klatki, nie po stanie odtwarzania",
  src.indexOf("function videoHasPicture(video)") > 0 &&
  src.indexOf("return !!video && (video.videoWidth | 0) > 0 && (video.videoHeight | 0) > 0;") > 0 &&
  src.indexOf("var PICTURE_TIMEOUT = 6000;") > 0);
check("budziki obrazu uzbrajane PO starcie silnika (token MSE/HLS inaczej je uniewaznial)",
  src.indexOf("armStartWatchdog(token);\n    armPictureWatchdog(token);") > 0 &&
  src.indexOf("if (typeof token !== \"number\") token = state.engineToken;") > 0);
check("pierwsza klatka zdejmuje budzik i zapamietuje sposob odtwarzania",
  src.indexOf("function notePicture()") > 0 &&
  src.indexOf("clearPictureWatchdog();\n    rememberEngine(state.engine);") > 0 &&
  src.indexOf("notePicture();\n      updateOsdProgress();") > 0 &&
  src.indexOf("video.addEventListener(\"canplay\", function () {") > 0);
check("naprawa warstwy obrazu jest w CSS i tylko na zadanie aplikacji",
  css.indexOf("body.video-layer-fix .player-screen video") > 0 &&
  css.indexOf("transform: translateZ(0);") > 0 &&
  src.indexOf("document.body.classList.toggle(\"video-layer-fix\", want)") > 0 &&
  src.indexOf("if (document.body) document.body.classList.toggle(\"video-layer-fix\", want);") > 0);
check("brak obrazu: jedna runda po sposobach odtwarzania i komunikat, co sie stalo",
  src.indexOf("nextSourceEntry(t(\"err_no_picture\"), 0, false, 0, t(\"err_no_picture_hint\"));") > 0 &&
  src.indexOf("err_no_picture_hint:") > 0 &&
  src.indexOf("if (!custom || limit > 0) {") > 0);
const picStart = src.indexOf("var PICTURE_TIMEOUT = 6000;");
const picEnd = src.indexOf("function nextSourceEntry(");
if (picStart < 0 || picEnd <= picStart) throw new Error("Nie znalazlem budzika obrazu w app.js");
const codePicture = src.slice(picStart, src.lastIndexOf("\n\n", picEnd) + 2);
["videoHasPicture", "armPictureWatchdog", "retryCurrentEntry", "clearPictureWatchdog",
  "notePicture", "applyVideoLayerFix", "rememberEngine"].forEach(function (fn) {
  if (codePicture.indexOf("function " + fn) < 0) throw new Error("Wyciety blok nie ma " + fn);
});

/* atrapa odtwarzacza: jedno <video> (z obrazem albo bez), licznik zapisow
   ustawien, kolejka budzikow wywolywana recznie (tak jakby plynal czas) */
function pictureHarness(o) {
  o = o || {};
  const calls = { errors: [], started: [], next: [], saves: 0, pending: [] };
  const video = { videoWidth: o.picture ? 1280 : 0, videoHeight: o.picture ? 720 : 0 };
  const classes = [];
  let timerId = 0;
  const sandbox = {
    settings: { videoLayerFix: false, engineHint: "" },
    state: {
      watchChannel: { name: "TVN" },
      engineToken: 7,
      engine: o.engine || "native",
      pictureTimer: null,
      pictureRetried: false,
      retryTimer: null,
      sources: [{ engine: "native", url: "http://s/x.ts" }, { engine: "mse", url: "http://s/x.ts" }],
      sourceIndex: 0
    },
    t: function (key) { return "<" + key + ">"; },
    $: function (id) { return id === "video" ? video : null; },
    document: {
      body: {
        classList: {
          toggle: function (name, on) {
            const i = classes.indexOf(name);
            if (on && i < 0) classes.push(name);
            if (!on && i >= 0) classes.splice(i, 1);
          }
        }
      }
    },
    saveSettings: function () { calls.saves++; },
    showPlayerError: function (message) { calls.errors.push(message); },
    startSourceEntry: function (entry) { calls.started.push(entry); },
    nextSourceEntry: function (message, delay, silent, maxCycles, finalHint) {
      calls.next.push({ message: message, maxCycles: maxCycles, finalHint: finalHint });
    },
    setTimeout: function (fn) { timerId++; calls.pending.push(fn); return timerId; },
    clearTimeout: function () {}
  };
  run(codePicture, sandbox);
  return {
    api: sandbox,
    calls: calls,
    video: video,
    classes: classes,
    /* wywoluje budziki czekajace w kolejce */
    fire: function () {
      const queue = calls.pending.splice(0);
      queue.forEach(function (fn) { fn(); });
      return queue.length;
    }
  };
}
/* dzwiek bez obrazu: budzik obrazu najpierw naprawia warstwe, potem powtarza wpis */
let ph = pictureHarness({});
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: czarny obraz uruchamia naprawe warstwy obrazu",
  ph.classes.indexOf("video-layer-fix") >= 0 && ph.api.settings.videoLayerFix === true &&
  ph.calls.saves === 1 && ph.calls.next.length === 0 && ph.calls.started.length === 0,
  JSON.stringify({ classes: ph.classes, next: ph.calls.next, started: ph.calls.started }));
check("uruchomione: komunikat mowi, ze to dzwiek bez obrazu",
  ph.calls.errors.length === 1 && ph.calls.errors[0] === "<err_no_picture>",
  JSON.stringify(ph.calls.errors));
check("uruchomione: powtorka startuje chwile pozniej, a nie od razu",
  ph.calls.pending.length === 1 && ph.calls.started.length === 0,
  "budzikow w kolejce: " + ph.calls.pending.length);
ph.fire();
check("uruchomione: ten sam strumien jest probowany jeszcze raz (bez zmiany sposobu)",
  ph.calls.started.length === 1 && ph.calls.started[0].engine === "native" &&
  ph.calls.started[0].url === "http://s/x.ts" && ph.api.state.pictureRetried === true &&
  ph.calls.next.length === 0,
  JSON.stringify(ph.calls.started));
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: gdy naprawa nie pomogla, kolejka idzie dalej i konczy po jednej rundzie",
  ph.calls.next.length === 1 && ph.calls.next[0].maxCycles === 0 &&
  ph.calls.next[0].finalHint === "<err_no_picture_hint>" &&
  ph.calls.next[0].message === "<err_no_picture>",
  JSON.stringify(ph.calls.next));

/* zmiana kanalu w miedzyczasie: stary budzik obrazu nie moze nic zrobic */
ph = pictureHarness({});
ph.api.armPictureWatchdog(7);
ph.api.state.engineToken = 8;
ph.fire();
check("uruchomione: budzik obrazu z porzuconej proby nic nie zmienia",
  ph.classes.length === 0 && ph.calls.errors.length === 0 && ph.calls.next.length === 0 &&
  ph.calls.started.length === 0,
  JSON.stringify({ classes: ph.classes, next: ph.calls.next }));
/* obraz jest: budzik obrazu nic nie zmienia, a tryb pracy idzie do pamieci */
ph = pictureHarness({ picture: true, engine: "mse" });
ph.api.armPictureWatchdog(7);
ph.fire();
check("uruchomione: obraz jest, wiec budzik obrazu nic nie zmienia",
  ph.classes.length === 0 && ph.calls.errors.length === 0 && ph.calls.next.length === 0 &&
  ph.calls.started.length === 0,
  JSON.stringify({ classes: ph.classes, next: ph.calls.next }));
ph.api.notePicture();
check("uruchomione: udany sposob odtwarzania jest zapamietany (MSE dal obraz)",
  ph.api.settings.engineHint === "mse" && ph.calls.saves === 1 &&
  ph.api.state.pictureTimer === null,
  JSON.stringify({ hint: ph.api.settings.engineHint, saves: ph.calls.saves }));

ph = pictureHarness({ engine: "mse" });
check("uruchomione: bez obrazu tryb nie trafia do pamieci (MSE sam nie dostaje pochwaly)",
  ph.api.notePicture() === false && ph.api.settings.engineHint === "" && ph.calls.saves === 0,
  JSON.stringify({ hint: ph.api.settings.engineHint, saves: ph.calls.saves }));

/* zapamietany tryb idzie na poczatek kolejki nastepnego kanalu */
const queueStart = src.indexOf("function buildSourceQueue(primaryUrl)");
const queueEnd = src.indexOf("function startSourceEntry(");
if (queueStart < 0 || queueEnd <= queueStart) throw new Error("Nie znalazlem kolejki prob w app.js");
const codeQueue = src.slice(queueStart, queueEnd);
if (codeQueue.indexOf("function preferEngine(queue, hint)") < 0) {
  throw new Error("Wyciety blok nie ma preferEngine");
}
const queueBox = { settings: { engineHint: "" } };
run(codeQueue, queueBox);
function engines(url) {
  return queueBox.buildSourceQueue(url).map(function (e) { return e.engine; });
}
const qPlain = engines("http://s/x.ts");
check("uruchomione: bez pamieci kolejnosc prob zostaje jak byla (natywny, MSE, HLS)",
  qPlain.join(",") === "native,mse,native,hls", JSON.stringify(qPlain));
queueBox.settings.engineHint = "mse";
const qMse = queueBox.buildSourceQueue("http://s/x.ts");
check("uruchomione: zapamietany MSE idzie na poczatek kolejki nastepnego kanalu",
  qMse[0].engine === "mse" && qMse[0].url === "http://s/x.ts" && qMse.length === qPlain.length &&
  qMse.map(function (e) { return e.engine; }).indexOf("native") === 1,
  JSON.stringify(qMse.map(function (e) { return e.engine; })));
queueBox.settings.engineHint = "hls";
check("uruchomione: to samo dla HLS (kanal .m3u8 i .ts)",
  engines("http://s/x.m3u8")[0] === "hls" && engines("http://s/x.ts")[0] === "hls",
  JSON.stringify([engines("http://s/x.m3u8"), engines("http://s/x.ts")]));
queueBox.settings.engineHint = "bogus";
check("uruchomione: nieznana pamiec nic nie psuje",
  engines("http://s/x.ts").join(",") === qPlain.join(","), JSON.stringify(engines("http://s/x.ts")));


console.log("");
if (fails) { console.log("BLEDY: " + fails); process.exit(1); }
console.log("Wszystkie sprawdzenia przeszly.");





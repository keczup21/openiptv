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
  src.indexOf("if (iconForLabel(v)) setIconLabel(els[i], v);") > 0);

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

console.log("");
if (fails) { console.log("BLEDY: " + fails); process.exit(1); }
console.log("Wszystkie sprawdzenia przeszly.");





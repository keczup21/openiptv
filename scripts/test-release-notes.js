/* Test opisu wydania (treść wydania na GitHubie) — bez internetu i bez Gita.
   Opis wydania powstaje z CHANGELOG.md i ma opisywać TYLKO wydawaną wersję.
   Do 1.21.0 pliki dist/release-notes-*.md były wycinane ręcznie i miały ogon
   z poprzednich wydań (opis wydania 1.20.0 opisywał też 1.19.4 i 1.19.3, a opis
   1.20.1 — 1.20.0), więc w wydaniu lądowały zmiany starszych wersji.
   Test pilnuje generatora scripts/release-notes.js, gotowych plików w dist
   oraz tego, że publish.ps1 korzysta z generatora, a nie z ręcznego pliku.

   Uruchomienie: npm run test:notes */
const fs = require("fs");
const os = require("os");
const path = require("path");
const notes = require("./release-notes");

const ROOT = notes.ROOT;
const changelog = fs.readFileSync(notes.CHANGELOG, "utf8");
const versions = notes.versionsIn(changelog);

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  OK   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "   -> " + extra : "")); }
}

/* --- 1. generator widzi wszystkie wersje z changeloga -------------------- */
check("CHANGELOG ma wersje do wydania", versions.length >= 20, String(versions.length));
check("żadna wersja nie powtarza się w changelogu",
  new Set(versions).size === versions.length,
  versions.join(", "));
check("pierwsza wersja to wersja z package.json",
  versions[0] === notes.currentVersion(),
  versions[0] + " vs " + notes.currentVersion());

/* --- 2. sekcja wersji to tylko ta wersja -------------------------------- */
let bad = [];
versions.forEach(function (version) {
  const section = notes.sectionFor(changelog, version);
  const found = notes.versionsIn(section);
  const content = section.split("\r\n").filter(function (line) { return line.trim() !== ""; });
  if (found.length !== 1 || found[0] !== version) bad.push(version + ": " + found.join("/"));
  if (content.length < 3) bad.push(version + ": pusta");
  if (section.indexOf("\n\n") >= 0) bad.push(version + ": puste linie na koncu");
});
check("każda wersja ma opis z jednym nagłówkiem i treścią", bad.length === 0, bad.join(", "));

/* --- 3. ogon poprzedniego wydania nie wchodzi do opisu ------------------ */
/* Tak wyglądały stare pliki: opis wersji + opis wcześniejszej wersji. */
const withTail = notes.sectionFor(changelog, versions[1]) + notes.sectionFor(changelog, versions[2]);
check("opis z doklejoną poprzednią wersją jest wykrywany",
  notes.versionsIn(withTail).length === 2, notes.versionsIn(withTail).join(", "));
check("opis 1.20.0 nie zawiera już 1.19.4 ani 1.19.3",
  notes.versionsIn(notes.sectionFor(changelog, "1.20.0")).join(",") === "1.20.0");
check("opis 1.20.1 nie zawiera już 1.20.0",
  notes.versionsIn(notes.sectionFor(changelog, "1.20.1")).join(",") === "1.20.1");

/* --- 4. wersja bez sekcji w changelogu to błąd, nie pusty opis --------- */
try {
  notes.sectionFor(changelog, "9.9.9");
  check("nieznana wersja zgłasza błąd", false, "brak wyjątku");
} catch (err) {
  check("nieznana wersja zgłasza błąd", /nie ma wersji/.test(err.message), err.message);
}
try {
  notes.sectionFor("## [2.0.0] \u2014 2026-01-01\r\n\r\n## [1.0.0] \u2014 2025-01-01\r\n\r\n### Dodano\r\n- coś\r\n", "2.0.0");
  check("wersja bez zmian nie dostaje pustego opisu", false, "brak wyjątku");
} catch (err) {
  check("wersja bez zmian nie dostaje pustego opisu", /jest pusta/.test(err.message), err.message);
}

/* --- 5. plik opisu: zawartość, kodowanie, końce linii ------------------ */
const sample = "1.20.1";
const tmp = path.join(os.tmpdir(), "openiptv-notes-test", "release-notes-" + sample + ".md");
const written = notes.writeNotes(sample, tmp);
const bytes = fs.readFileSync(tmp);
check("zapisany plik = sekcja z changeloga",
  fs.readFileSync(tmp, "utf8") === notes.sectionFor(changelog, sample));
check("plik bez BOM (tak jak czyta go gh)",
  !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf));
check("końce linii CRLF, jak w CHANGELOG.md",
  bytes.includes(Buffer.from("\r\n")) && !/[^\r]\n/.test(written.notes));
check("opis nie ma pustych linii na końcu",
  written.notes.endsWith("\r\n") && !written.notes.endsWith("\r\n\r\n"));
fs.rmSync(path.dirname(tmp), { recursive: true, force: true });

/* --- 6. gotowe pliki w dist idą do wydania i też mają jedną wersję ----- */
const distDir = path.join(ROOT, "dist");
const distNotes = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter(function (f) { return /^release-notes-.*\.md$/.test(f); })
  : [];
check("w dist są pliki opisu wydania", distNotes.length > 0, distNotes.join(", "));
const distBad = [];
distNotes.forEach(function (file) {
  const version = file.replace(/^release-notes-/, "").replace(/\.md$/, "");
  const text = fs.readFileSync(path.join(distDir, file), "utf8");
  const found = notes.versionsIn(text);
  if (found.length !== 1 || found[0] !== version) distBad.push(file + ": " + found.join("/"));
  else if (versions.indexOf(version) < 0) distBad.push(file + ": brak w changelogu");
  else if (text !== notes.sectionFor(changelog, version)) distBad.push(file + ": inna treść niż w changelogu");
});
check("każdy plik w dist opisuje tylko swoją wersję (zgodnie z changelogiem)",
  distBad.length === 0, distBad.join(", "));

/* --- 7. publikacja korzysta z generatora ------------------------------- */
const publish = fs.readFileSync(path.join(ROOT, "scripts", "publish.ps1"), "utf8");
check("publish.ps1 generuje opis z changeloga",
  publish.indexOf("scripts\\release-notes.js") > 0, "brak wywołania generatora");
check("publish.ps1 odrzuca opis z więcej niż jedną wersją",
  publish.indexOf("^## \\[") > 0 && /throw/.test(publish), "brak sprawdzenia");
check("publish.ps1 nie prosi już GitHuba o własne notatki (--generate-notes)",
  publish.indexOf("--generate-notes") < 0);

/* --- 8. package.json wystawia generator i ten test --------------------- */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const scripts = pkg.scripts || {};
check("npm run notes uruchamia generator",
  scripts.notes === "node scripts/release-notes.js", scripts.notes);
check("npm test uruchamia test:notes",
  typeof scripts.test === "string" && scripts.test.indexOf("test:notes") > 0, scripts.test);

console.log("");
console.log(fails ? "BŁĘDY: " + fails : "Opis wydania zawiera tylko wydawaną wersję.");
process.exit(fails ? 1 : 0);


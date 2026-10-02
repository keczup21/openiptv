/* OpenIPTV - opis wydania na GitHuba, wyciety z CHANGELOG.md.
   Bierze WYLACZNIE sekcje wydawanej wersji: od naglowka "## [X.Y.Z]" do
   nastepnego naglowka wersji. Do 1.21.0 opisy wydan powstawaly recznie i mialy
   ogon z poprzednich wydan (opis wydania 1.20.0 opisywal tez 1.19.4 i 1.19.3),
   a w wydaniu ma byc tylko to, co zmienilo sie w wydawanej wersji.

   Uruchomienie:
     node scripts/release-notes.js                  # wersja z package.json
     node scripts/release-notes.js 1.21.0           # wybrana wersja
     node scripts/release-notes.js 1.21.0 plik.md   # inny plik wynikowy
   Wynik: dist/release-notes-<wersja>.md (UTF-8 bez BOM, konce linii CRLF,
   takie jak w CHANGELOG.md). */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");

/* Naglowek wersji w changelogu, np. "## [1.21.0] — 2026-10-03" */
const HEADING = /^##\s+\[(\d+\.\d+\.\d+)\]/;

function changelogLines(text) {
  return text.split(/\r?\n/);
}

/* Wersje w kolejnosci wystapienia (najnowsza pierwsza) */
function versionsIn(text) {
  return changelogLines(text).map(function (line) {
    const found = HEADING.exec(line);
    return found ? found[1] : null;
  }).filter(function (version) { return version !== null; });
}

/* Sekcja jednej wersji: naglowek + tresc, bez pustych linii na koncu.
   Rzuca blad, gdy wersji nie ma w changelogu albo gdy jej sekcja jest pusta -
   wydanie bez zmian nie moze dostac pustego opisu. */
function sectionFor(text, version) {
  const all = changelogLines(text);
  const start = all.findIndex(function (line) {
    const found = HEADING.exec(line);
    return found !== null && found[1] === version;
  });
  if (start < 0) throw new Error("CHANGELOG.md nie ma wersji " + version);

  let end = all.length;
  for (let i = start + 1; i < all.length; i++) {
    if (HEADING.test(all[i])) { end = i; break; }
  }

  const body = all.slice(start, end);
  while (body.length && body[body.length - 1].trim() === "") body.pop();
  if (body.length < 3) throw new Error("Sekcja wersji " + version + " jest pusta");

  const notes = body.join("\r\n") + "\r\n";
  const found = versionsIn(notes);
  if (found.length !== 1 || found[0] !== version) {
    throw new Error("Opis wersji " + version + " zawiera inne wersje: " + found.join(", "));
  }
  return notes;
}

function notesPathFor(version) {
  return path.join(ROOT, "dist", "release-notes-" + version + ".md");
}

function currentVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

/* Zapisuje opis wydania; outFile domyslnie dist/release-notes-<wersja>.md */
function writeNotes(version, outFile) {
  const file = outFile || notesPathFor(version);
  const notes = sectionFor(fs.readFileSync(CHANGELOG, "utf8"), version);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, notes, "utf8");
  return { file: file, notes: notes };
}

if (require.main === module) {
  const version = (process.argv[2] || currentVersion()).trim().replace(/^v/, "");
  const result = writeNotes(version, process.argv[3]);
  console.log("Opis wydania " + version + " -> " + path.relative(ROOT, result.file));
  console.log("  wersji w opisie: " + versionsIn(result.notes).length + " (tylko wydawana)");
  console.log("  znakow: " + result.notes.length + ", linii: " +
    result.notes.split("\r\n").length);
}

module.exports = {
  ROOT: ROOT,
  CHANGELOG: CHANGELOG,
  versionsIn: versionsIn,
  sectionFor: sectionFor,
  notesPathFor: notesPathFor,
  currentVersion: currentVersion,
  writeNotes: writeNotes
};

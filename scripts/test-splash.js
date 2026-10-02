/* Test ekranu startowego (splash) Androida - bez telewizora i bez emulatora.
   Splash to zwykly obrazek, ktory Android rysuje z motywu AppTheme.NoActionBarLaunch
   (android:background="@drawable/splash"), zanim wczyta sie interfejs. Do 1.20.0
   lezaly tam pliki z szablonu Capacitora (biale tlo i obcy znak), wiec przy
   wlaczaniu widac bylo inne logo niz na ikonie aplikacji (zgloszony blad).
   Test czyta pliki PNG sam (bez bibliotek) i sprawdza w kazdym wariancie:
   wymiary, tlo w kolorze aplikacji, obecnosc znaku, jego rozmiar i srodek.
   Pilnuje tez, ze generator scripts/make-icons.ps1 opisuje te same pliki.

   Uruchomienie: npm run test:splash */
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RES = path.join(ROOT, "android", "app", "src", "main", "res");
const GEN = path.join(ROOT, "scripts", "make-icons.ps1");

/* Tlo splashu = --bg z www/styles.css i bgColor z www/appinfo.json */
const BG = "#0a0c11";
/* Udzial krotszego boku, jaki zajmuje znak (patrz $script:SplashLogo) */
const LOGO = 0.26;
/* Ponizej tej roznicy kolorow piksel uchodzi za tlo (halo antyaliasingu) */
const TOL = 24;

const EXPECTED = [
  ["drawable/splash.png", 480, 320],
  ["drawable-land-mdpi/splash.png", 480, 320],
  ["drawable-land-hdpi/splash.png", 800, 480],
  ["drawable-land-xhdpi/splash.png", 1280, 720],
  ["drawable-land-xxhdpi/splash.png", 1600, 960],
  ["drawable-land-xxxhdpi/splash.png", 1920, 1280],
  ["drawable-port-mdpi/splash.png", 320, 480],
  ["drawable-port-hdpi/splash.png", 480, 800],
  ["drawable-port-xhdpi/splash.png", 720, 1280],
  ["drawable-port-xxhdpi/splash.png", 960, 1600],
  ["drawable-port-xxxhdpi/splash.png", 1280, 1920]
];

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  OK   " + name); }
  else { fails++; console.log("  FAIL " + name + (extra ? "   -> " + extra : "")); }
}

function hex(r, g, b) {
  return "#" + [r, g, b].map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
}

/* --- czytanie PNG: IHDR + IDAT (odfiltrowane wiersze) -------------------- */
function readPng(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("to nie PNG: " + file);

  let pos = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const parts = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      parts.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }

  const bpp = color === 6 ? 4 : color === 2 ? 3 : 0;
  if (!bpp || depth !== 8 || interlace !== 0) {
    throw new Error("obsluguje tylko PNG 8 bit nieprzeplotowy RGB/RGBA: " + file);
  }

  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const line = raw.subarray(start + 1, start + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }

  return { width: width, height: height, bpp: bpp, data: out };
}

function pixel(img, x, y) {
  const off = y * img.width * img.bpp + x * img.bpp;
  return [img.data[off], img.data[off + 1], img.data[off + 2]];
}

/* otoczka pikseli roznych od tla - czyli sam znak */
function logoBox(img, bg) {
  let minX = img.width, maxX = -1, minY = img.height, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    let off = y * img.width * img.bpp;
    for (let x = 0; x < img.width; x++, off += img.bpp) {
      if (Math.abs(img.data[off] - bg[0]) <= TOL &&
          Math.abs(img.data[off + 1] - bg[1]) <= TOL &&
          Math.abs(img.data[off + 2] - bg[2]) <= TOL) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
}

/* --- kolor tla zgadza sie z reszta aplikacji ----------------------------- */
const css = fs.readFileSync(path.join(ROOT, "www", "styles.css"), "utf8");
const info = fs.readFileSync(path.join(ROOT, "www", "appinfo.json"), "utf8");
check("kolor tla splashu to --bg z www/styles.css", css.indexOf("--bg: " + BG) > 0);
check("kolor tla splashu to bgColor z www/appinfo.json", info.indexOf("\"bgColor\": \"" + BG + "\"") > 0);

/* --- sam motyw: splash musi byc tym plikiem, ktory rysuje Android -------- */
const styles = fs.readFileSync(path.join(RES, "values", "styles.xml"), "utf8").replace(/\r\n/g, "\n");
const launchTheme = /AppTheme\.NoActionBarLaunch[\s\S]*?<\/style>/.exec(styles);
check("motyw startowy uzywa @drawable/splash",
  launchTheme !== null && launchTheme[0].indexOf("@drawable/splash") > 0,
  launchTheme ? launchTheme[0].replace(/\s+/g, " ") : "brak motywu");

/* --- generator opisuje dokladnie te same pliki i wymiary ---------------- */
const gen = fs.readFileSync(GEN, "utf8").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");

/* --- kazdy wariant: wymiary, tlo, znak ---------------------------------- */
const bg = [
  parseInt(BG.slice(1, 3), 16),
  parseInt(BG.slice(3, 5), 16),
  parseInt(BG.slice(5, 7), 16)
];

EXPECTED.forEach(function (entry) {
  const file = path.join(RES, entry[0].split("/").join(path.sep));
  const wantW = entry[1], wantH = entry[2];
  const label = entry[0];

  if (!fs.existsSync(file)) { check(label + " istnieje", false, "brak pliku"); return; }

  const img = readPng(file);
  check(label + ": wymiary " + wantW + "x" + wantH,
    img.width === wantW && img.height === wantH,
    img.width + "x" + img.height);

  const corner = pixel(img, 2, 2);
  check(label + ": tlo w narozniku to " + BG,
    hex(corner[0], corner[1], corner[2]) === BG, hex(corner[0], corner[1], corner[2]));

  const box = logoBox(img, bg);
  const logoW = box.maxX - box.minX + 1;
  const logoH = box.maxY - box.minY + 1;
  const want = Math.round(Math.min(wantW, wantH) * LOGO);
  check(label + ": znak na srodku ma " + want + " px",
    Math.abs(logoW - want) <= 3 && Math.abs(logoH - want) <= 3,
    logoW + "x" + logoH);

  const cx = (box.minX + box.maxX + 1) / 2, cy = (box.minY + box.maxY + 1) / 2;
  check(label + ": znak jest wysrodkowany",
    Math.abs(cx - wantW / 2) <= 2 && Math.abs(cy - wantH / 2) <= 2,
    cx + "," + cy + " vs " + wantW / 2 + "," + wantH / 2);

  const center = pixel(img, Math.floor(img.width / 2), Math.floor(img.height / 2));
  const spread = Math.max(
    Math.abs(center[0] - bg[0]), Math.abs(center[1] - bg[1]), Math.abs(center[2] - bg[2]));
  check(label + ": srodek to kolor znaku, nie tla", spread > TOL,
    hex(center[0], center[1], center[2]));

  const line = "File = '" + entry[0].split("/").join("\\") + "'; W = " + wantW + "; H = " + wantH;
  check(label + ": make-icons.ps1 generuje ten plik", gen.indexOf(line) > 0, line);
});

/* --- ikona i splash pochodza z jednego generatora ------------------------ */
check("generator rysuje znak z tego samego wzoru co ikona",
  gen.indexOf("$script:Triangle") > 0 && gen.indexOf("function New-LogoBitmap") > 0);
check("generator ma udzial znaku ($script:SplashLogo = " + LOGO + ")",
  gen.indexOf("$script:SplashLogo = " + LOGO) > 0);

console.log("");
if (fails) { console.log("BLEDY: " + fails); process.exit(1); }
console.log("Wszystkie sprawdzenia przeszly.");

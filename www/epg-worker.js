/* TeleIPTV — parser XMLTV uruchamiany w Web Workerze (nie blokuje UI) */
"use strict";

function parseXmltvDate(value) {
  var m = String(value || "").match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!m) return 0;
  var utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (m[7]) {
    var offset = 60000 * (60 * +m[8] + +m[9]);
    utc += m[7] === "+" ? -offset : offset;
  }
  return utc;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, function (m, n) {
      n = +n;
      if (n < 65536) return String.fromCharCode(n);
      return String.fromCharCode(0xD7C0 + (n >> 10), 0xDC00 + (n & 1023));
    });
}

function extractTag(block, tagName) {
  var out = [];
  var re = new RegExp("<" + tagName + "\\b[^>]*>([\\s\\S]*?)</" + tagName + ">", "g");
  var m;
  while ((m = re.exec(block))) out.push(decodeEntities(m[1]).trim());
  return out;
}

self.onmessage = function (event) {
  var data = event.data || {};
  var text = data.text || "";
  var daysBack = data.daysBack || 7;
  try {
    var now = Date.now();
    var from = now - 86400000 * daysBack;
    var to = now + 86400000 * 2;
    var programs = {};
    var aliases = {};

    /* mapuj <channel> → display-name (żeby kanały bez tvg-id dopasować po nazwie) */
    var cpos = 0;
    var cclosing = "</channel>";
    while ((cpos = text.indexOf("<channel", cpos)) !== -1) {
      var cend = text.indexOf(cclosing, cpos);
      if (cend === -1) break;
      cend += cclosing.length;
      var cblock = text.substring(cpos, cend);
      cpos = cend;
      var cOpenEnd = cblock.indexOf(">");
      if (cOpenEnd === -1) continue;
      var cid = (cblock.substring(0, cOpenEnd + 1).match(/id="([^"]*)"/) || [])[1] || "";
      if (!cid) continue;
      var cnames = extractTag(cblock, "display-name");
      for (var n = 0; n < cnames.length; n++) {
        if (cnames[n]) aliases[cnames[n].toLowerCase()] = cid;
      }
    }

    /* iteracyjnie po blokach <programme> — bez budowania całego DOM (oszczędza pamięć) */
    var pos = 0;
    var closing = "</programme>";
    while ((pos = text.indexOf("<programme", pos)) !== -1) {
      var end = text.indexOf(closing, pos);
      if (end === -1) break;
      end += closing.length;
      var block = text.substring(pos, end);
      pos = end;

      var openEnd = block.indexOf(">");
      if (openEnd === -1) continue;
      var openTag = block.substring(0, openEnd + 1);

      var channelId = (openTag.match(/channel="([^"]*)"/) || [])[1] || "";
      var start = parseXmltvDate((openTag.match(/start="([^"]*)"/) || [])[1]);
      var stop = parseXmltvDate((openTag.match(/stop="([^"]*)"/) || [])[1]);
      if (!channelId || start < from || start > to || stop <= start) continue;

      var titles = extractTag(block, "title");
      var title = titles[0] || "Program";
      if (!programs[channelId]) programs[channelId] = [];
      programs[channelId].push({ channelId: channelId, start: start, end: stop, title: title });
    }
    for (var key in programs) {
      programs[key].sort(function (a, b) { return b.start - a.start; });
    }
    self.postMessage({ programs: programs, aliases: aliases });
  } catch (err) {
    self.postMessage({ error: err && err.message ? err.message : "Błąd parsowania EPG." });
  }
};

/* TeleIPTV — webOS native service: fetches URLs bypassing CORS.
 * Runs under node.js on the TV; the web UI calls it over Luna Bus.
 */
"use strict";

var Service = require("webos-service");
var http = require("http");
var https = require("https");
var url = require("url");

var service = new Service("pl.openiptv.player.service.fetch");

function fetchUrl(target, asBinary, message, redirectsLeft) {
  if (redirectsLeft === undefined) redirectsLeft = 5;

  var parsed;
  try {
    parsed = url.parse(target);
  } catch (e) {
    message.respond({ returnValue: false, errorText: "invalid url" });
    return;
  }
  if (!parsed.hostname) {
    message.respond({ returnValue: false, errorText: "invalid url" });
    return;
  }

  var mod = parsed.protocol === "https:" ? https : http;
  var req = mod.get({
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.path,
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" }
  }, function (res) {
    var status = res.statusCode || 0;

    if ((status === 301 || status === 302 || status === 307 || status === 308) && res.headers.location && redirectsLeft > 0) {
      res.resume();
      fetchUrl(url.resolve(target, res.headers.location), asBinary, message, redirectsLeft - 1);
      return;
    }

    var chunks = [];
    res.on("data", function (c) { chunks.push(c); });
    res.on("end", function () {
      var buf = Buffer.concat(chunks);
      if (status >= 200 && status < 300) {
        if (asBinary) {
          message.respond({ returnValue: true, status: status, dataBase64: buf.toString("base64") });
        } else {
          message.respond({ returnValue: true, status: status, data: buf.toString("utf8") });
        }
      } else {
        message.respond({ returnValue: false, status: status, errorText: "HTTP " + status });
      }
    });
  });

  req.setTimeout(120000, function () {
    req.destroy(new Error("timeout"));
  });

  req.on("error", function (err) {
    message.respond({ returnValue: false, errorText: err && err.message ? err.message : "network error" });
  });
}

service.register("fetch", function (message) {
  var target = message.payload && message.payload.url;
  if (!target) { message.respond({ returnValue: false, errorText: "no url" }); return; }
  fetchUrl(target, false, message);
});

service.register("fetchBinary", function (message) {
  var target = message.payload && message.payload.url;
  if (!target) { message.respond({ returnValue: false, errorText: "no url" }); return; }
  fetchUrl(target, true, message);
});

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const chrome = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/usr/bin/google-chrome";
const browserAvailable = fs.existsSync(chrome);
const fixture = path.join(__dirname, "gallery-fit-pan-browser.html");

for (const viewport of ["1440,900", "400,820"]) {
  test("fullscreen piano gallery fits, follows the cursor, drags and pinches in Chrome " + viewport,
    { skip: browserAvailable ? false : "Chrome not available on this build machine" }, () => {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), "kh-gallery-chrome-"));
      try {
        const dom = execFileSync(chrome, [
          "--headless=new", "--disable-gpu", "--no-first-run",
          "--disable-extensions", "--disable-background-networking",
          "--user-data-dir=" + profile,
          "--window-size=" + viewport,
          "--virtual-time-budget=6500", "--dump-dom",
          pathToFileURL(fixture).href
        ], { encoding: "utf8", maxBuffer: 3 * 1024 * 1024, timeout: 25000, stdio: ["ignore", "pipe", "ignore"] });
        const html = dom.match(/<pre id="gallery-browser-result">([^<]*)<\/pre>/);
        assert.ok(html, "Browser did not produce a gallery result");
        assert.ok(html[1].startsWith("KH_GALLERY_PASS "), html[1]);
        const data = JSON.parse(html[1].slice("KH_GALLERY_PASS ".length));
        for (const key of ["hover", "mouseFollow", "drag", "swipe", "pinch", "wheel", "keyboard"]) {
          assert.equal(data[key], true, "Browser interaction failed: " + key);
        }
        assert.ok(data.fit[0] > 0 && data.fit[1] > 0);
        assert.deepEqual(data.source, [900, 1400], "Original photo dimensions must survive");
        assert.ok(data.viewport[0] > 0 && data.viewport[1] > 0);
      } finally {
        fs.rmSync(profile, { recursive: true, force: true });
      }
    });
}

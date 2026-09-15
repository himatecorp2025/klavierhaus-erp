"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "..");
const engine = require(path.join(root, "server", "piano-reference-engine.js"));
const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const publicThemeSource = fs.readFileSync(path.join(root, "website", "public", "app.js"), "utf8");
const stylesPath = path.join(root, "website", "public", "styles.css");
const designPath = path.join(root, "website", "public", "design-v3.css");
const stylesBuffer = fs.readFileSync(stylesPath);
const styles = stylesBuffer.toString("utf8");
const designBuffer = fs.readFileSync(designPath);
const design = designBuffer.toString("utf8");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

const DARK_BASELINE_STYLES_LENGTH = 56599;
const DARK_BASELINE_STYLES_SHA256 = "ab23e827acc6a8a04d0e76299c33334e504318b274ddb3f07ac251643663e5c9";
const DARK_BASELINE_DESIGN_SHA256 = "3b76d8b176a57710dd5fef429b102a30e50c91459f309c14d83b81affce7698e";

test("Steinway lookup thresholds and model sizes are correct", () => {
  assert.equal(engine.lookupYearFromThresholds(483), 1853);
  assert.equal(engine.lookupYearFromThresholds(88686), 1896);
  assert.equal(engine.lookupYearFromThresholds(122799), 1906);
  assert.equal(engine.lookupYearFromThresholds(488243), 1984);
  assert.equal(engine.lookupYearFromThresholds(589500), 2010);
  assert.equal(engine.DEFAULT_MODELS.B.size_cm, "211");
  assert.equal(engine.DEFAULT_MODELS.B.size_inch, "6'10.5");
  assert.equal(engine.pianoAge(1906, 2026), 120);
});

test("real Inventory 2025 workbook parser detects exactly 141 serial rows and 8 models when fixture is available", (t) => {
  const candidates = [
    process.env.STEINWAY_REFERENCE_XLSX,
    "/mnt/data/Inventory 2025(2).xlsx",
    path.join(root, "test", "fixtures", "Inventory 2025.xlsx")
  ].filter(Boolean);
  const workbook = candidates.find((candidate) => fs.existsSync(candidate));
  if (!workbook) return t.skip("Steinway Inventory workbook fixture is not available in this environment");
  const parsed = engine.extractReferenceWorkbook(fs.readFileSync(workbook));
  assert.equal(parsed.sheet, "Steinway Serial Numbers");
  assert.equal(parsed.serials.length, 141);
  assert.equal(parsed.models.length, 8);
  assert.deepEqual(parsed.serials[0], { start_serial: 483, build_year: 1853 });
  assert.deepEqual(parsed.serials.at(-1), { start_serial: 589500, build_year: 2010 });
  assert.deepEqual(parsed.models.map((row) => row.model).sort(), ["A", "B", "C", "D", "L", "M", "O", "S"]);
});

test("ERP frontend exposes human reference import, central lookup and permanent delete controls", () => {
  assert.match(appSource, /Import Steinway Reference/);
  assert.match(appSource, /141 serial reference rows detected, 8 Steinway models detected\. Import successful\./);
  assert.match(appSource, /\/api\/pianos\/import-reference/);
  assert.match(appSource, /\/api\/pianos\/lookup/);
  assert.match(appSource, /deletePianoPermanently/);
  assert.match(appSource, /Delete Piano/);
});

test("original dark-mode CSS is byte-identical and light mode is append-only", () => {
  assert.ok(stylesBuffer.length > DARK_BASELINE_STYLES_LENGTH, "styles.css must contain the original dark CSS plus an appended light layer");
  assert.equal(sha256(stylesBuffer.subarray(0, DARK_BASELINE_STYLES_LENGTH)), DARK_BASELINE_STYLES_SHA256);
  assert.equal(sha256(designBuffer), DARK_BASELINE_DESIGN_SHA256);
  assert.match(styles, /html\[data-theme="light"\][\s\S]*#F7F5EF/);
  assert.match(styles, /html\[data-theme="light"\][\s\S]*#FCFBF7/);
  assert.match(styles, /html\[data-theme="light"\][\s\S]*#181917/);
});

test("cinematic hero, cookie banner, testimonials and events have explicit light-mode protection", () => {
  assert.match(styles, /html\[data-theme="light"\] \.hero--home[\s\S]*color:\s*#FFFFFF/);
  assert.match(styles, /html\[data-theme="light"\] \.hero h1[\s\S]*#FFFFFF\s*!important/);
  assert.match(styles, /html\[data-theme="light"\] \.consent-banner[\s\S]*overflow:\s*hidden/);
  assert.match(styles, /html\[data-theme="light"\] \.section--quote/);
  assert.match(styles, /html\[data-theme="light"\] \.public-event-card/);
});

test("public theme switcher uses SVG icons and retains solar/manual persistence", () => {
  assert.doesNotMatch(publicThemeSource, /icon\.textContent\s*=\s*value\s*===\s*"light"\s*\?\s*"☾"/);
  assert.match(publicThemeSource, /<svg viewBox="0 0 24 24"/);
  assert.match(publicThemeSource, /America\/New_York/);
  assert.match(publicThemeSource, /hour\s*>=\s*7\s*&&\s*hour\s*<\s*19/);
  assert.match(publicThemeSource, /localStorage\.setItem\(klavierhausThemePreferenceKey,\s*next\)/);
});

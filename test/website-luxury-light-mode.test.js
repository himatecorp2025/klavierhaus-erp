"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const sha256 = (relative) => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex");

const styles = read("website/public/styles.css");
const designV3 = read("website/public/design-v3.css");
const app = read("website/public/app.js");
const websiteServer = read("website/server/index.js");

test("Luxury Light token szerződés és vizuális alapértékek", () => {
  assert.match(styles, /:root\[data-theme="light"\]\s*\{/);
  for (const value of ["#F7F5EF", "#F1EDE4", "#FCFBF7", "#FFFEFA", "#F3F0E8", "#171817", "#292B2A", "#A98442", "#80642F", "#C8AD76", "#191A18"]) {
    assert.ok(styles.includes(value), `Hiányzó Luxury Light token/szín: ${value}`);
  }
  assert.match(styles, /rgba\(247,\s*245,\s*239,\s*0\.92\)/);
  assert.match(styles, /backdrop-filter:\s*blur\(18px\)/);
  assert.match(styles, /\.site-footer\s*\{[\s\S]*?background:\s*#191A18/i);
  assert.match(styles, /\.theme-toggle[\s\S]*?width:\s*38px[\s\S]*?height:\s*38px/);
});

test("Light mode komponensekben nincs közvetlen tiszta fekete/fehér dark leakage", () => {
  const lightStyles = styles.slice(styles.indexOf("/* Luxury Light Mode — Ivory, Ebony & Brass */"));
  const lightV3 = designV3.slice(designV3.indexOf("/* Luxury Light Mode cascade lock"));
  assert.ok(lightStyles.length > 1000, "A Luxury Light styles blokk hiányzik vagy túl rövid.");
  assert.ok(lightV3.length > 500, "A design-v3 Luxury Light cascade blokk hiányzik.");
  for (const css of [lightStyles, lightV3]) {
    assert.doesNotMatch(css, /(?:background|color|border(?:-color)?)\s*:\s*#(?:000(?:000)?|fff(?:fff)?)\b/i);
  }
  assert.match(lightStyles, /var\(--color-surface\)/);
  assert.match(lightStyles, /var\(--color-text\)/);
  assert.match(lightV3, /var\(--color-photo-mat\)/);
});

test("Solar témamotor, manual override és SVG jewel switch működési szerződése", () => {
  const marker = "// Public website theme engine: solar default";
  const start = app.indexOf(marker);
  assert.ok(start >= 0, "A publikus témamotor nem található.");
  const themeSource = app.slice(start);
  const store = new Map();
  const rootElement = {
    dataset: {},
    style: { values: new Map(), setProperty(name, value) { this.values.set(name, value); } }
  };
  const icon = { innerHTML: "" };
  let clickHandler = null;
  const button = {
    dataset: {},
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(type, handler) { if (type === "click") clickHandler = handler; }
  };
  const context = {
    publishedDesignSettings: null,
    document: {
      documentElement: rootElement,
      querySelectorAll(selector) {
        if (selector === "[data-theme-icon]") return [icon];
        if (selector === "[data-theme-toggle]") return [button];
        return [];
      }
    },
    localStorage: {
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); }
    },
    Intl,
    Date,
    console
  };
  vm.createContext(context);
  vm.runInContext(themeSource, context);
  const solarTheme = vm.runInContext("solarTheme", context);
  const applyPublicTheme = vm.runInContext("applyPublicTheme", context);
  const initializeSolarTheme = vm.runInContext("initializeSolarTheme", context);

  assert.equal(solarTheme(new Date("2026-09-15T11:00:00Z")), "light", "07:00 New York időben light mód szükséges.");
  assert.equal(solarTheme(new Date("2026-09-15T22:59:00Z")), "light", "18:59 New York időben még light mód szükséges.");
  assert.equal(solarTheme(new Date("2026-09-15T23:00:00Z")), "dark", "19:00 New York időben dark mód szükséges.");
  assert.equal(solarTheme(new Date("2026-09-15T10:59:00Z")), "dark", "06:59 New York időben dark mód szükséges.");

  applyPublicTheme("light");
  assert.equal(rootElement.dataset.theme, "light");
  assert.match(icon.innerHTML, /<svg[\s\S]*?<path/);
  assert.equal(button.attrs["aria-pressed"], "false");

  assert.equal(typeof clickHandler, "function", "A theme jewel click handler hiányzik.");
  clickHandler();
  assert.equal(rootElement.dataset.theme, "dark");
  assert.equal(store.get("theme_preference"), "dark");
  assert.equal(button.attrs["aria-pressed"], "true");

  store.set("theme_preference", "light");
  initializeSolarTheme();
  assert.equal(rootElement.dataset.theme, "light", "A manual override-nak felül kell írnia a solar automatikát.");
  assert.doesNotMatch(websiteServer, /data-theme-icon[^>]*>\s*[☀☾]/);
  assert.match(websiteServer, /data-theme-icon[\s\S]*?<svg/);
});

test("Scope védelem: az ERP/admin stíluslap változatlan", () => {
  assert.equal(sha256("public/styles.css"), "f700d359009225386a3d404197855b9417f5d33b90b11b2e2e98cfd61990ebed");
});

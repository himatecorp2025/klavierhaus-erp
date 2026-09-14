"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SERIAL_THRESHOLDS,
  lookupSteinwayYear,
  lookupSteinwayModel,
  lookupSteinwayReference,
  formatAge,
  isSteinwayBrand
} = require("../server/steinway-reference");

const root = path.join(__dirname, "..");

test("Küszöbkeresési pontosság és a 141 rekordos 1853–2010 registry", () => {
  assert.equal(SERIAL_THRESHOLDS.length, 141);
  assert.deepEqual(SERIAL_THRESHOLDS[0], [483, 1853]);
  assert.deepEqual(SERIAL_THRESHOLDS.at(-1), [589500, 2010]);
  assert.equal(lookupSteinwayYear(483), 1853);
  assert.equal(lookupSteinwayYear(122799), 1906);
  assert.equal(lookupSteinwayYear(488243), 1984);
  assert.equal(lookupSteinwayYear(589500), 2010);
  assert.equal(lookupSteinwayYear(482), null);
});

test("Köztes sorozatszám floor-match az előző gyártási küszöböt használja", () => {
  assert.equal(lookupSteinwayYear(122799), 1906);
  assert.equal(lookupSteinwayYear(124999), 1906);
  assert.equal(lookupSteinwayYear(125000), 1907);
  assert.equal(lookupSteinwayYear(490000), 1984);
  assert.equal(lookupSteinwayYear("488,243"), 1984);
});

test("Steinway S–D modellek gyári méretei cm és inch formátumban", () => {
  const expected = {
    S: ["155", "5'1\""], M: ["170", "5'7\""], O: ["180", "5'10.5\""], L: ["179", "5'10.5\""],
    A: ["188–194", "6'2\" or 6'4\""], B: ["211", "6'10.5\""], C: ["227", "7'5\""], D: ["274", "8'11.75\""]
  };
  for (const [model, [cm, inch]] of Object.entries(expected)) {
    const ref = lookupSteinwayModel(`Model ${model}`);
    assert.equal(ref.size_cm, cm);
    assert.equal(ref.size_in, inch);
    assert.match(ref.size_display, new RegExp(`^${cm.replace(/[–]/g, "–")} cm`));
  }
  assert.equal(lookupSteinwayModel("K"), null);
});

test("Kétnyelvű életkor-formázás 2026-ra és márkaaktiválás", () => {
  assert.equal(formatAge(1906, "hu", 2026), "1906 (120 éves)");
  assert.equal(formatAge(1906, "en", 2026), "1906 (120 years old)");
  assert.equal(isSteinwayBrand("Steinway"), true);
  assert.equal(isSteinwayBrand("Steinway & Sons"), true);
  assert.equal(isSteinwayBrand("Fazioli"), false);
  const lookup = lookupSteinwayReference({ brand: "Steinway & Sons", model: "B", serial_no: "122799", currentYear: 2026 });
  assert.equal(lookup.build_year, 1906);
  assert.equal(lookup.age, 120);
  assert.equal(lookup.size_display, "211 cm (6'10.5\")");
});

test("Adatmodell és három UI integrációs contract jelen van", () => {
  const schema = fs.readFileSync(path.join(root, "server/schema.sql"), "utf8");
  const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
  const workflow = fs.readFileSync(path.join(root, "server/workshop-workflow.js"), "utf8");
  const catalog = fs.readFileSync(path.join(root, "server/website-catalog.js"), "utf8");
  const website = fs.readFileSync(path.join(root, "website/server/index.js"), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS steinway_serial_registry/);
  assert.match(schema, /size_display TEXT/);
  assert.match(app, /bindSteinwayReferenceForm/);
  assert.match(app, /client-piano-reference/);
  assert.match(app, /workflow-piano-reference-meta/);
  assert.match(app, /data-steinway-reference-status/);
  assert.match(workflow, /p\.build_year,p\.size_cm,p\.size_in,p\.size_display/);
  assert.match(catalog, /serial_no/);
  assert.match(catalog, /size_display/);
  assert.match(website, /publicPianoReferenceText/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { extractReferenceWorkbook, lookupYearFromThresholds, DEFAULT_MODELS, pianoAge } = require("../server/piano-reference-engine");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel));
const readText = (rel) => read(rel).toString("utf8");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function storedZip(entries) {
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(value);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuffer.length, 28); central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(entries).length, 8); eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}
function referenceWorkbookFixture() {
  const thresholds = require("../server/piano-reference-engine").DEFAULT_SERIAL_THRESHOLDS;
  const modelRows = { S:["155","5'1"], M:["170","5'7"], O:["180","5'10.5"], L:["179","5'10.5"], A:["188 - 194","6'2 or 6'4"], B:["211","6'10.5"], C:["227","7'5"], D:["274","8'11.75"] };
  const rows = thresholds.map(([serial, year], index) => {
    const rowNumber = index + 2;
    const model = Object.keys(modelRows)[index - 10];
    const modelCells = model ? `<c r="A${rowNumber}" t="inlineStr"><is><t>${model}</t></is></c><c r="B${rowNumber}" t="inlineStr"><is><t>${modelRows[model][0]}</t></is></c><c r="C${rowNumber}" t="inlineStr"><is><t>${modelRows[model][1]}</t></is></c>` : "";
    return `<row r="${rowNumber}">${modelCells}<c r="E${rowNumber}"><v>${year}</v></c><c r="F${rowNumber}"><v>${serial}</v></c></row>`;
  }).join("");
  const workbook = `<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Steinway Serial Numbers" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`;
  return storedZip({ "xl/workbook.xml": workbook, "xl/_rels/workbook.xml.rels": rels, "xl/worksheets/sheet1.xml": sheet });
}

test("Steinway XLSX parser: exactly 141 serial rows and 8 models", () => {
  const parsed = extractReferenceWorkbook(referenceWorkbookFixture());
  assert.equal(parsed.serials.length, 141);
  assert.equal(parsed.models.length, 8);
  assert.deepEqual(parsed.serials[0], { start_serial: 483, build_year: 1853 });
  assert.deepEqual(parsed.serials.at(-1), { start_serial: 589500, build_year: 2010 });
});

test("Steinway floor lookup and 2026 age engine", () => {
  assert.equal(lookupYearFromThresholds(483), 1853);
  assert.equal(lookupYearFromThresholds(88686), 1896);
  assert.equal(lookupYearFromThresholds(122799), 1906);
  assert.equal(lookupYearFromThresholds(488243), 1984);
  assert.equal(lookupYearFromThresholds(589500), 2010);
  assert.equal(pianoAge(1906, 2026), 120);
  assert.equal(DEFAULT_MODELS.B.size_cm, "211");
  assert.equal(DEFAULT_MODELS.B.size_inch, "6'10.5");
});

test("Backend route contracts: central lookup, reference import and transactional piano delete", () => {
  const server = readText("server/index.js");
  const engine = readText("server/piano-reference-engine.js");
  assert.match(server, /registerPianoReferenceRoutes\(\{app,db,auth,permit,audit,createPianoImportUpload\}\)/);
  assert.match(engine, /app\.get\("\/api\/pianos\/lookup"/);
  assert.match(engine, /app\.post\("\/api\/pianos\/import-reference"/);
  assert.match(engine, /141 serial reference rows detected, 8 Steinway models detected\. Import successful\./);
  assert.match(server, /app\.delete\("\/api\/pianos\/:id", auth, requireSuperadmin/);
  assert.match(server, /const remove=db\.transaction/);
  assert.match(server, /PIANO_HARD_DELETE/);
});

test("ERP UI contract: reference upload, editable lookup fields and permanent delete", () => {
  const app = readText("public/app.js");
  assert.match(app, /uploadSteinwayReferenceExcel/);
  assert.match(app, /\/api\/pianos\/import-reference/);
  assert.match(app, /bindSteinwayReferenceForm/);
  assert.match(app, /data-piano-reference-status/);
  assert.match(app, /Delete Piano/);
  assert.match(app, /deletePianoPermanently/);
});

test("Dark-mode baseline is preserved byte-for-byte; light mode is appended", () => {
  const design = read("website/public/design-v3.css");
  assert.equal(crypto.createHash("sha256").update(design).digest("hex"), "3b76d8b176a57710dd5fef429b102a30e50c91459f309c14d83b81affce7698e");
  const styles = read("website/public/styles.css");
  const originalPrefix = styles.subarray(0, 56599);
  assert.equal(crypto.createHash("sha256").update(originalPrefix).digest("hex"), "ab23e827acc6a8a04d0e76299c33334e504318b274ddb3f07ac251643663e5c9");
  const css = styles.toString("utf8");
  assert.match(css, /html\[data-theme="light"\][\s\S]*--color-bg:#F7F5EF/);
  assert.match(css, /html\[data-theme="light"\] \.hero h1\{color:#FFFFFF!important\}/);
  assert.match(css, /html\[data-theme="dark"\] \.consent-banner\{background:#121418\}/);
});

test("Public theme uses SVG icons and preserves solar/manual theme behavior", () => {
  const app = readText("website/public/app.js");
  assert.match(app, /function themeIconSvg/);
  assert.match(app, /<svg viewBox=/);
  assert.doesNotMatch(app, /icon\.textContent\s*=\s*value\s*===\s*"light"\s*\?\s*"☾"/);
  assert.match(app, /hour >= 7 && hour < 19 \? "light" : "dark"/);
  assert.match(app, /localStorage\.setItem\(klavierhausThemePreferenceKey, next\)/);
});

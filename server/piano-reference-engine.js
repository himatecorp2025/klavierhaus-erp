"use strict";

const zlib = require("zlib");
const path = require("path");

const DEFAULT_SERIAL_THRESHOLDS = Object.freeze([
  [483, 1853],
  [1000, 1856],
  [2000, 1858],
  [3000, 1860],
  [5000, 1861],
  [7000, 1863],
  [9000, 1864],
  [11000, 1865],
  [13000, 1866],
  [15000, 1867],
  [17000, 1868],
  [19000, 1869],
  [21000, 1870],
  [23000, 1871],
  [25000, 1872],
  [27000, 1873],
  [29000, 1874],
  [31000, 1875],
  [33000, 1876],
  [35000, 1877],
  [40000, 1878],
  [45000, 1881],
  [50000, 1883],
  [55000, 1886],
  [60000, 1887],
  [65000, 1889],
  [70000, 1891],
  [75000, 1893],
  [80000, 1894],
  [85000, 1896],
  [90000, 1898],
  [95000, 1900],
  [100000, 1901],
  [105000, 1902],
  [110000, 1904],
  [115000, 1905],
  [120000, 1906],
  [125000, 1907],
  [130000, 1908],
  [135000, 1909],
  [140000, 1910],
  [150000, 1911],
  [155000, 1912],
  [160000, 1913],
  [165000, 1914],
  [170000, 1915],
  [175000, 1916],
  [185000, 1917],
  [190000, 1918],
  [195000, 1919],
  [200000, 1920],
  [205000, 1921],
  [210000, 1922],
  [220000, 1923],
  [225000, 1924],
  [235000, 1925],
  [240000, 1926],
  [255000, 1927],
  [260000, 1928],
  [265000, 1929],
  [270000, 1930],
  [271000, 1931],
  [274000, 1932],
  [276000, 1933],
  [278000, 1934],
  [279000, 1935],
  [284000, 1936],
  [289000, 1937],
  [290000, 1938],
  [294000, 1939],
  [300000, 1940],
  [305000, 1941],
  [310000, 1942],
  [314000, 1943],
  [316000, 1944],
  [317000, 1945],
  [319000, 1946],
  [322000, 1947],
  [324000, 1948],
  [328000, 1949],
  [331000, 1950],
  [334000, 1951],
  [337000, 1952],
  [340000, 1953],
  [343000, 1954],
  [346500, 1955],
  [350000, 1956],
  [355000, 1957],
  [358000, 1958],
  [362000, 1959],
  [366000, 1960],
  [370000, 1961],
  [375000, 1962],
  [380000, 1963],
  [385000, 1964],
  [390000, 1965],
  [395000, 1966],
  [400000, 1967],
  [405000, 1968],
  [412000, 1969],
  [418000, 1970],
  [423000, 1971],
  [426000, 1972],
  [431000, 1973],
  [436000, 1974],
  [439000, 1975],
  [445000, 1976],
  [450000, 1977],
  [455300, 1978],
  [463000, 1979],
  [468500, 1980],
  [473500, 1981],
  [478500, 1982],
  [483000, 1983],
  [488000, 1984],
  [493000, 1985],
  [498000, 1986],
  [503000, 1987],
  [507700, 1988],
  [512600, 1989],
  [516700, 1990],
  [521000, 1991],
  [523500, 1992],
  [527000, 1993],
  [530000, 1994],
  [533500, 1995],
  [537200, 1996],
  [540700, 1997],
  [545600, 1998],
  [549600, 1999],
  [554000, 2000],
  [558000, 2001],
  [562500, 2002],
  [567000, 2003],
  [571000, 2004],
  [574500, 2005],
  [578500, 2006],
  [582500, 2007],
  [584600, 2008],
  [587500, 2009],
  [589500, 2010],
]);
const DEFAULT_MODELS = Object.freeze({
  S: { model: "S", size_cm: "155", size_inch: "5\'1" },
  M: { model: "M", size_cm: "170", size_inch: "5\'7" },
  O: { model: "O", size_cm: "180", size_inch: "5\'10.5" },
  L: { model: "L", size_cm: "179", size_inch: "5\'10.5" },
  A: { model: "A", size_cm: "188 - 194", size_inch: "6\'2 or 6\'4" },
  B: { model: "B", size_cm: "211", size_inch: "6\'10.5" },
  C: { model: "C", size_cm: "227", size_inch: "7\'5" },
  D: { model: "D", size_cm: "274", size_inch: "8\'11.75" }
});

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function findEndOfTag(xml, start) {
  let quote = "";
  for (let index = start + 1; index < xml.length; index += 1) {
    const ch = xml[index];
    if (quote) { if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ">") return index;
  }
  return -1;
}

function parseAttributes(raw) {
  const attrs = {};
  let index = 0;
  while (index < raw.length) {
    while (index < raw.length && /\s/.test(raw[index])) index += 1;
    if (index >= raw.length) break;
    let name = "";
    while (index < raw.length && !/[\s=]/.test(raw[index])) name += raw[index++];
    while (index < raw.length && /\s/.test(raw[index])) index += 1;
    if (raw[index] !== "=") { while (index < raw.length && !/\s/.test(raw[index])) index += 1; continue; }
    index += 1;
    while (index < raw.length && /\s/.test(raw[index])) index += 1;
    const quote = raw[index] === '"' || raw[index] === "'" ? raw[index++] : "";
    let value = "";
    if (quote) { while (index < raw.length && raw[index] !== quote) value += raw[index++]; if (raw[index] === quote) index += 1; }
    else { while (index < raw.length && !/\s/.test(raw[index])) value += raw[index++]; }
    if (name) attrs[name] = decodeXml(value);
  }
  return attrs;
}

function xmlTokens(xml) {
  const tokens = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start < 0) break;
    if (xml.startsWith("<!--", start)) { const end = xml.indexOf("-->", start + 4); cursor = end < 0 ? xml.length : end + 3; continue; }
    if (xml.startsWith("<![CDATA[", start)) { const end = xml.indexOf("]]>", start + 9); cursor = end < 0 ? xml.length : end + 3; continue; }
    const end = findEndOfTag(xml, start);
    if (end < 0) break;
    let raw = xml.slice(start + 1, end).trim();
    cursor = end + 1;
    if (!raw || raw[0] === "?" || raw[0] === "!") continue;
    const closing = raw[0] === "/";
    if (closing) raw = raw.slice(1).trim();
    const selfClosing = !closing && raw.endsWith("/");
    if (selfClosing) raw = raw.slice(0, -1).trim();
    let split = 0; while (split < raw.length && !/\s/.test(raw[split])) split += 1;
    const qName = raw.slice(0, split);
    const localName = qName.split(":").pop();
    const attrs = closing ? {} : parseAttributes(raw.slice(split));
    tokens.push({ start, end: end + 1, closing, selfClosing, localName, attrs });
  }
  return tokens;
}

function xmlElements(xml, localName) {
  const result = [], stack = [];
  for (const token of xmlTokens(xml)) {
    if (token.localName !== localName) continue;
    if (!token.closing) {
      if (token.selfClosing) result.push({ attrs: token.attrs, inner: "", start: token.start });
      else stack.push(token);
      continue;
    }
    const open = stack.pop();
    if (open) result.push({ attrs: open.attrs, inner: xml.slice(open.end, token.start), start: open.start });
  }
  return result.sort((a, b) => a.start - b.start);
}

function xmlText(xml) {
  let out = "", cursor = 0;
  for (const token of xmlTokens(xml)) {
    if (token.start > cursor) out += xml.slice(cursor, token.start);
    cursor = token.end;
  }
  if (cursor < xml.length) out += xml.slice(cursor);
  return decodeXml(out);
}

function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error("INVALID_XLSX_STRUCTURE");
  let eocd = -1;
  const floor = Math.max(0, buffer.length - 0xFFFF - 22);
  for (let index = buffer.length - 22; index >= floor; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error("INVALID_XLSX_STRUCTURE");
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  let cursor = centralOffset;
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("INVALID_XLSX_CENTRAL_DIRECTORY");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.slice(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("INVALID_XLSX_LOCAL_HEADER");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`UNSUPPORTED_XLSX_COMPRESSION_${method}`);
    entries.set(name.replace(/\\/g, "/"), data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function normalizeZipPath(base, target) {
  const value = String(target || "").replace(/\\/g, "/");
  if (value.startsWith("/")) return value.slice(1);
  return path.posix.normalize(path.posix.join(base, value));
}

function excelColumnIndex(ref) {
  const input = String(ref || "").toUpperCase();
  let total = 0, found = false;
  for (const ch of input) {
    if (ch < "A" || ch > "Z") break;
    found = true; total = total * 26 + ch.charCodeAt(0) - 64;
  }
  return found ? total - 1 : 0;
}

function parseWorkbookSheets(buffer) {
  const entries = readZipEntries(buffer);
  const readText = (name) => entries.get(name)?.toString("utf8") || "";
  const workbookXml = readText("xl/workbook.xml");
  const relationshipXml = readText("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relationshipXml) throw new Error("INVALID_XLSX_STRUCTURE");

  const relationships = new Map();
  for (const relation of xmlElements(relationshipXml, "Relationship")) {
    if (relation.attrs.Id && relation.attrs.Target) relationships.set(relation.attrs.Id, relation.attrs.Target);
  }

  const shared = [];
  const sharedXml = readText("xl/sharedStrings.xml");
  if (sharedXml) {
    for (const item of xmlElements(sharedXml, "si")) {
      shared.push(xmlElements(item.inner, "t").map((textNode) => xmlText(textNode.inner)).join(""));
    }
  }

  const sheets = [];
  for (const sheet of xmlElements(workbookXml, "sheet")) {
    const name = sheet.attrs.name || "";
    const relationId = sheet.attrs["r:id"] || "";
    const target = relationships.get(relationId);
    if (!target) continue;
    const sheetPath = normalizeZipPath("xl", target);
    const sheetXml = readText(sheetPath);
    if (!sheetXml) continue;
    const rows = [];
    for (const rowElement of xmlElements(sheetXml, "row")) {
      const row = [];
      for (const cell of xmlElements(rowElement.inner, "c")) {
        const ref = cell.attrs.r || "A1";
        const type = cell.attrs.t || "";
        const col = excelColumnIndex(ref);
        let value = "";
        if (type === "inlineStr") value = xmlElements(cell.inner, "t").map((node) => xmlText(node.inner)).join("");
        else {
          const valueNode = xmlElements(cell.inner, "v")[0];
          const raw = valueNode ? xmlText(valueNode.inner).trim() : "";
          value = type === "s" ? (shared[Number(raw)] ?? "") : raw;
        }
        row[col] = value;
      }
      rows.push(row);
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

function cleanInteger(value) {
  const text = String(value ?? "").trim().replace(/,/g, "").replace(/\.0+$/, "");
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}
function cleanMeasure(value) {
  return String(value ?? "").trim().replace(/\.0$/, "").replace(/\s*-\s*/g, " - ");
}
function normalizeModel(value) {
  const text = String(value ?? "").trim().toUpperCase().replace(/^MODEL\s+/i, "");
  return Object.prototype.hasOwnProperty.call(DEFAULT_MODELS, text) ? text : "";
}
function normalizeSerial(value) {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const number = Number(digits);
  return Number.isSafeInteger(number) ? number : null;
}
function isSteinwayBrand(value) { return /steinway/i.test(String(value || "")); }
function pianoAge(buildYear, currentYear = 2026) {
  const year = Number(buildYear); return Number.isInteger(year) && year > 0 ? Math.max(0, Number(currentYear) - year) : null;
}
function lookupYearFromThresholds(serialInput, thresholds = DEFAULT_SERIAL_THRESHOLDS) {
  const serial = normalizeSerial(serialInput); if (!serial || serial < 483) return null;
  let low = 0, high = thresholds.length - 1, answer = null;
  while (low <= high) { const mid = Math.floor((low + high) / 2), row = thresholds[mid]; if (row[0] <= serial) { answer = row[1]; low = mid + 1; } else high = mid - 1; }
  return answer;
}

function extractReferenceWorkbook(buffer) {
  const sheet = parseWorkbookSheets(buffer).find((item) => String(item.name).trim().toLowerCase() === "steinway serial numbers");
  if (!sheet) throw new Error("STEINWAY_REFERENCE_SHEET_NOT_FOUND");
  const serialRows = [];
  const models = [];
  for (const row of sheet.rows) {
    const year = cleanInteger(row[4]);
    const serial = cleanInteger(row[5]);
    if (year && serial && year >= 1800 && year <= 2100 && serial >= 483) serialRows.push({ start_serial: serial, build_year: year });
    const model = normalizeModel(row[0]);
    if (model) {
      const sizeCm = cleanMeasure(row[1]);
      const sizeInch = cleanMeasure(row[2]);
      if (sizeCm && sizeInch) models.push({ model, size_cm: sizeCm, size_inch: sizeInch });
    }
  }
  serialRows.sort((a, b) => a.start_serial - b.start_serial);
  const uniqueSerials = [...new Map(serialRows.map((row) => [row.start_serial, row])).values()];
  const uniqueModels = [...new Map(models.map((row) => [row.model, row])).values()].sort((a, b) => a.model.localeCompare(b.model));
  if (uniqueSerials.length !== 141) {
    const error = new Error("STEINWAY_REFERENCE_SERIAL_ROWS_INCOMPLETE");
    error.detectedSerialRows = uniqueSerials.length;
    error.detectedModelRows = uniqueModels.length;
    throw error;
  }
  if (uniqueSerials[0].start_serial !== 483 || uniqueSerials[0].build_year !== 1853 || uniqueSerials.at(-1).start_serial !== 589500 || uniqueSerials.at(-1).build_year !== 2010) throw new Error("STEINWAY_REFERENCE_SERIAL_BOUNDARY_MISMATCH");
  for (let index = 1; index < uniqueSerials.length; index += 1) if (uniqueSerials[index].start_serial <= uniqueSerials[index - 1].start_serial) throw new Error("STEINWAY_REFERENCE_SERIAL_ORDER_INVALID");
  if (uniqueModels.length !== 8 || ["A","B","C","D","L","M","O","S"].some((model) => !uniqueModels.some((row) => row.model === model))) {
    const error = new Error("STEINWAY_REFERENCE_MODEL_ROWS_INCOMPLETE"); error.detectedSerialRows = uniqueSerials.length; error.detectedModelRows = uniqueModels.length; throw error;
  }
  return { sheet: sheet.name, serials: uniqueSerials, models: uniqueModels };
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((row) => row.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
function ensureCentralPianoReference(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS steinway_serial_registry (
      start_serial INTEGER PRIMARY KEY,
      build_year INTEGER NOT NULL CHECK(build_year BETWEEN 1853 AND 2100)
    );
    CREATE TABLE IF NOT EXISTS steinway_model_reference (
      model_key TEXT PRIMARY KEY,
      size_cm TEXT NOT NULL,
      size_in TEXT NOT NULL,
      size_display TEXT NOT NULL
    );
  `);
  ensureColumn(db, "pianos", "size_cm", "TEXT");
  ensureColumn(db, "pianos", "size_in", "TEXT");
  ensureColumn(db, "pianos", "size_display", "TEXT");

  const serialCount = Number(db.prepare("SELECT COUNT(*) AS c FROM steinway_serial_registry").get().c || 0);
  const modelCount = Number(db.prepare("SELECT COUNT(*) AS c FROM steinway_model_reference").get().c || 0);
  if (serialCount === 0 || modelCount === 0) {
    const insertSerial = db.prepare("INSERT OR IGNORE INTO steinway_serial_registry(start_serial, build_year) VALUES(?, ?)");
    const insertModel = db.prepare("INSERT OR IGNORE INTO steinway_model_reference(model_key, size_cm, size_in, size_display) VALUES(?, ?, ?, ?)");
    db.transaction(() => {
      if (serialCount === 0) DEFAULT_SERIAL_THRESHOLDS.forEach(([serial, year]) => insertSerial.run(serial, year));
      if (modelCount === 0) Object.values(DEFAULT_MODELS).forEach((row) => insertModel.run(row.model, row.size_cm, row.size_inch, `${row.size_cm} cm (${row.size_inch})`));
    })();
  }
}

function importReferenceWorkbook(db, buffer) {
  const parsed = extractReferenceWorkbook(buffer);
  ensureCentralPianoReference(db);
  const insertSerial = db.prepare("INSERT OR REPLACE INTO steinway_serial_registry(start_serial, build_year) VALUES(?, ?)");
  const insertModel = db.prepare("INSERT OR REPLACE INTO steinway_model_reference(model_key, size_cm, size_in, size_display) VALUES(?, ?, ?, ?)");
  db.transaction(() => {
    db.prepare("DELETE FROM steinway_serial_registry").run();
    db.prepare("DELETE FROM steinway_model_reference").run();
    parsed.serials.forEach((row) => insertSerial.run(row.start_serial, row.build_year));
    parsed.models.forEach((row) => insertModel.run(row.model, row.size_cm, row.size_inch, `${row.size_cm} cm (${row.size_inch})`));
  })();
  return { ok: true, sheet: parsed.sheet, serial_records: parsed.serials.length, model_records: parsed.models.length, message: "141 serial reference rows detected, 8 Steinway models detected. Import successful." };
}

function lookupYear(db, serialInput) {
  const serial = normalizeSerial(serialInput);
  if (!serial || serial < 483) return null;
  return db.prepare("SELECT build_year FROM steinway_serial_registry WHERE start_serial <= ? ORDER BY start_serial DESC LIMIT 1").get(serial)?.build_year || null;
}
function lookupModel(db, modelInput) {
  const model = normalizeModel(modelInput);
  if (!model) return null;
  const row = db.prepare("SELECT model_key,size_cm,size_in,size_display FROM steinway_model_reference WHERE model_key=?").get(model);
  return row ? { model: row.model_key, size_cm: row.size_cm, size_inch: row.size_in, size_display: row.size_display } : null;
}
function findExistingBySerial(db, serialInput) {
  const serial = normalizeSerial(serialInput); if (!serial) return null;
  return db.prepare("SELECT p.*, c.name AS client_name FROM pianos p LEFT JOIN contacts c ON c.id=p.owner_contact_id WHERE REPLACE(REPLACE(REPLACE(p.serial_no,' ',''),'-',''),'.','')=? LIMIT 1").get(String(serial)) || null;
}
function centralPianoLookup(db, { q = "", serial = "", serial_no = "", brand = "", model = "", currentYear = 2026 } = {}) {
  ensureCentralPianoReference(db);
  const query = String(q || "").trim();
  const serialInput = serial || serial_no || (/^\s*\d[\d\s.-]*\s*$/.test(query) ? query : "");
  const existing = serialInput ? findExistingBySerial(db, serialInput) : null;
  if (existing) return { match_type: "EXISTING_RECORD", existing_piano_id: existing.id, piano: existing, brand: existing.brand, model: existing.model, build_year: existing.build_year || existing.year || null, age: pianoAge(existing.build_year || existing.year, currentYear), size_cm: existing.size_cm || null, size_inch: existing.size_in || null, size_display: existing.size_display || null };
  if (query && !serialInput && !model) {
    const like = `%${query}%`;
    const rows = db.prepare("SELECT p.*, c.name AS client_name FROM pianos p LEFT JOIN contacts c ON c.id=p.owner_contact_id WHERE p.brand LIKE ? OR p.model LIKE ? OR p.display_name LIKE ? OR p.serial_no LIKE ? OR c.name LIKE ? ORDER BY p.display_name LIMIT 25").all(like, like, like, like, like);
    return { match_type: rows.length ? "EXISTING_SEARCH_RESULTS" : "NO_MATCH", results: rows };
  }
  const buildYear = serialInput ? lookupYear(db, serialInput) : null;
  const modelData = lookupModel(db, model);
  const steinwaySuggested = Boolean(buildYear) || isSteinwayBrand(brand);
  return { match_type: buildYear || modelData ? "REFERENCE_SUGGESTION" : "NO_MATCH", brand: steinwaySuggested ? (brand || "Steinway & Sons") : (brand || null), model: modelData?.model || model || null, build_year: buildYear, age: buildYear ? pianoAge(buildYear, currentYear) : null, size_cm: modelData?.size_cm || null, size_inch: modelData?.size_inch || null, size_display: modelData?.size_display || null };
}

function registerPianoReferenceRoutes({ app, db, auth, permit, audit, createPianoImportUpload }) {
  ensureCentralPianoReference(db);
  app.get("/api/pianos/lookup", auth, (req, res) => {
    try { res.json(centralPianoLookup(db, { q: req.query.q || "", serial: req.query.serial || req.query.serial_no || "", brand: req.query.brand || "", model: req.query.model || "", currentYear: 2026 })); }
    catch (error) { console.error("central piano lookup failed:", error); res.status(500).json({ error: "PIANO_LOOKUP_FAILED" }); }
  });
  const upload = createPianoImportUpload();
  app.post("/api/pianos/import-reference", auth, permit("ADMIN"), upload.single("file"), (req, res) => {
    if (!req.file?.buffer) return res.status(400).json({ error: "REFERENCE_EXCEL_REQUIRED" });
    try {
      const result = importReferenceWorkbook(db, req.file.buffer);
      if (audit) audit(req, "STEINWAY_REFERENCE_IMPORTED", "pianos", "STEINWAY_REFERENCE", null, result, 1, result.message, "TECHNICAL");
      res.json(result);
    } catch (error) {
      console.error("Steinway reference import failed:", error);
      res.status(400).json({ error: error.message || "STEINWAY_REFERENCE_IMPORT_FAILED", detected_serial_rows: error.detectedSerialRows ?? null, detected_model_rows: error.detectedModelRows ?? null });
    }
  });
}

module.exports = { DEFAULT_SERIAL_THRESHOLDS, DEFAULT_MODELS, parseWorkbookSheets, extractReferenceWorkbook, ensureCentralPianoReference, importReferenceWorkbook, lookupYear, lookupYearFromThresholds, lookupModel, findExistingBySerial, centralPianoLookup, registerPianoReferenceRoutes, pianoAge, normalizeModel, normalizeSerial };

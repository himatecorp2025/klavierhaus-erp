"use strict";

const crypto = require("crypto");
let AdmZip = null;

function xmlDecode(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
function excelColumnIndex(ref) {
  const letters = String(ref || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}
function parseSharedStrings(xml) {
  const out = [];
  for (const match of String(xml || "").matchAll(/<(?:[A-Za-z0-9_]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?si>/g)) {
    const parts = [...match[1].matchAll(/<(?:[A-Za-z0-9_]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g)].map((x) => xmlDecode(x[1]));
    out.push(parts.join(""));
  }
  return out;
}
function parseWorkbookSheets(buffer) {
  if (!AdmZip) AdmZip = require("adm-zip");
  const zip = new AdmZip(buffer);
  const read = (name) => zip.getEntry(name)?.getData().toString("utf8") || "";
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("INVALID_XLSX_STRUCTURE");
  const relationships = new Map();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)) {
    const attrs = m[1];
    const id = attrs.match(/\bId="([^"]+)"/)?.[1] || "";
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1] || "";
    if (id && target) relationships.set(id, target);
  }
  const shared = parseSharedStrings(read("xl/sharedStrings.xml"));
  const sheets = [];
  for (const m of workbook.matchAll(/<(?:[A-Za-z0-9_]+:)?sheet\b([^>]*)\/?>(?:<\/(?:[A-Za-z0-9_]+:)?sheet>)?/g)) {
    const attrs = m[1];
    const name = xmlDecode(attrs.match(/\bname="([^"]*)"/)?.[1] || "");
    const relId = attrs.match(/\br:id="([^"]+)"/)?.[1] || "";
    let target = relationships.get(relId) || "";
    if (!target) continue;
    target = target.replace(/^\//, "");
    if (!target.startsWith("xl/")) target = "xl/" + target.replace(/^\.\//, "");
    const sheetXml = read(target);
    if (!sheetXml) continue;
    const rows = [];
    for (const rowMatch of sheetXml.matchAll(/<(?:[A-Za-z0-9_]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?row>/g)) {
      const row = [];
      for (const cMatch of rowMatch[1].matchAll(/<(?:[A-Za-z0-9_]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?c>)/g)) {
        const cellAttrs = cMatch[1];
        const body = cMatch[2] || "";
        const ref = cellAttrs.match(/\br="([^"]+)"/)?.[1] || "";
        const type = cellAttrs.match(/\bt="([^"]+)"/)?.[1] || "";
        const col = excelColumnIndex(ref);
        let value = "";
        if (type === "inlineStr") {
          value = [...body.matchAll(/<(?:[A-Za-z0-9_]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g)].map((x) => xmlDecode(x[1])).join("");
        } else {
          const raw = xmlDecode(body.match(/<(?:[A-Za-z0-9_]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?v>/)?.[1] || "");
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
function normalizeText(value) { return String(value ?? "").trim().toLowerCase().replace(/[_\.\-]+/g, " ").replace(/\s+/g, " "); }
function normalizeEmailList(value) { return String(value ?? "").split(/[;,\n]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)); }
function normalizePhones(value) {
  const out = [];
  for (const line of String(value ?? "").split(/\n+/)) {
    if (/fax/i.test(line)) continue;
    const digits = line.replace(/\D/g, "");
    if (digits.length >= 7) out.push(digits.length > 10 ? digits.slice(-10) : digits);
  }
  return [...new Set(out)];
}
function excelDateToIso(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (n >= 30000 && n <= 60000) return new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000)).toISOString().slice(0, 10);
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const HEADER_ALIASES = Object.freeze({
  externalReference: ["external reference", "external ref", "client id", "customer id", "customer reference", "client reference"],
  name: ["client name", "customer name", "name", "client", "customer"],
  contactFullName: ["contact full name", "contact name", "contact person", "relationship contact"],
  phone: ["phone", "phone number", "telephone", "mobile", "tel"],
  email: ["email", "e mail", "email address"],
  billingAddress: ["billing address", "invoice address", "billing"],
  serviceAddress: ["service address", "address", "client address", "customer address", "location"],
  status: ["status", "client status", "customer status"],
  lastContact: ["last contact", "last contacted", "last contact date"],
  nextStep: ["next step", "next action", "follow up"],
  notes: ["notes", "note", "comments", "comment", "remarks"],
  reviewStatus: ["review status", "import status", "ready", "review"]
});
function detectClientSheet(sheets) {
  let selected = null;
  for (const sheet of sheets) {
    if (!sheet.rows.length) continue;
    const headers = (sheet.rows[0] || []).map((x) => String(x ?? "").trim());
    const normalized = headers.map(normalizeText);
    const mapping = {};
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      const idx = normalized.findIndex((h) => aliases.includes(h));
      if (idx >= 0) mapping[key] = idx;
    }
    const score = ["name", "phone", "email", "serviceAddress", "externalReference"].filter((key) => mapping[key] !== undefined).length;
    if (mapping.name !== undefined && score >= 2 && (!selected || score > selected.score)) selected = { sheet, headers, mapping, score };
  }
  return selected;
}
function analyzeClientWorkbook(buffer, originalFilename, existingContacts = []) {
  const selected = detectClientSheet(parseWorkbookSheets(buffer));
  if (!selected) throw Object.assign(new Error("NO_IMPORTABLE_CLIENT_SHEET"), { missingColumns: ["Client Name plus at least one of Phone, Email, Address or External Reference"] });
  const { sheet, headers, mapping } = selected;
  if (sheet.rows.length < 2) throw new Error("IMPORT_READY_EMPTY");
  const fileFingerprint = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 12).toUpperCase();
  const source = "CLIENT_EXCEL_IMPORT";
  const exactRefs = new Map(existingContacts.filter((x) => x.import_source && x.external_reference).map((x) => [`${x.import_source}::${x.external_reference}`, x]));
  const existingEmails = new Map(), existingPhones = new Map(), existingNameAddress = new Map();
  for (const c of existingContacts) {
    for (const e of normalizeEmailList(c.email)) if (!existingEmails.has(e)) existingEmails.set(e, c);
    for (const ph of normalizePhones(c.phone)) if (!existingPhones.has(ph)) existingPhones.set(ph, c);
    const key = `${normalizeText(c.name)}::${normalizeText(c.address)}`;
    if (normalizeText(c.name) && normalizeText(c.address) && !existingNameAddress.has(key)) existingNameAddress.set(key, c);
  }
  const seenRefs = new Set(), records = [];
  const getCell = (cells, key) => mapping[key] === undefined ? "" : String(cells[mapping[key]] ?? "").trim();
  for (let r = 1; r < sheet.rows.length; r++) {
    const cells = sheet.rows[r] || [];
    if (!cells.some((v) => String(v ?? "").trim())) continue;
    const externalReference = getCell(cells, "externalReference") || `AUTO-${fileFingerprint}-${r + 1}`;
    const rec = { rowNumber: r + 1, externalReference, name: getCell(cells, "name"), contactFullName: getCell(cells, "contactFullName"), phone: getCell(cells, "phone"), email: getCell(cells, "email"), billingAddress: getCell(cells, "billingAddress"), serviceAddress: getCell(cells, "serviceAddress"), status: getCell(cells, "status") || "General", lastContact: excelDateToIso(getCell(cells, "lastContact")), nextStep: getCell(cells, "nextStep"), notes: getCell(cells, "notes"), reviewStatus: getCell(cells, "reviewStatus") || "READY" };
    rec.missingFields = [];
    if (!normalizeEmailList(rec.email).length && !normalizePhones(rec.phone).length) rec.missingFields.push("Phone or Email");
    if (!rec.serviceAddress) rec.missingFields.push("Address");
    rec.hasMissingData = rec.missingFields.length > 0;
    let category = "NEW", reason = "";
    if (!rec.name) { category = "INVALID"; reason = "MISSING_CLIENT_NAME"; }
    else if (mapping.reviewStatus !== undefined && !["ready", "import", "approved", "yes", "ok"].includes(normalizeText(rec.reviewStatus))) { category = "INVALID"; reason = "NOT_READY"; }
    else if (seenRefs.has(rec.externalReference)) { category = "INVALID"; reason = "DUPLICATE_REFERENCE_IN_FILE"; }
    else {
      seenRefs.add(rec.externalReference);
      const exact = exactRefs.get(`${source}::${rec.externalReference}`);
      if (exact) { category = "ALREADY_IMPORTED"; reason = "EXTERNAL_REFERENCE_MATCH"; rec.match = exact; }
      else {
        const emailMatch = normalizeEmailList(rec.email).map((e) => existingEmails.get(e)).find(Boolean);
        const phoneMatch = normalizePhones(rec.phone).map((ph) => existingPhones.get(ph)).find(Boolean);
        const nameAddressMatch = existingNameAddress.get(`${normalizeText(rec.name)}::${normalizeText(rec.serviceAddress)}`);
        const match = emailMatch || phoneMatch || nameAddressMatch;
        if (match) { category = "POSSIBLE_DUPLICATE"; reason = emailMatch ? "EMAIL_MATCH" : phoneMatch ? "PHONE_MATCH" : "NAME_ADDRESS_MATCH"; rec.match = match; }
      }
    }
    rec.category = category; rec.reason = reason; records.push(rec);
  }
  if (!records.length) throw new Error("IMPORT_READY_EMPTY");
  const count = (cat) => records.filter((x) => x.category === cat).length;
  return {
    source,
    headers,
    mapping,
    summary: { filename: originalFilename, sheetName: sheet.name, totalRows: records.length, newClients: count("NEW"), alreadyImported: count("ALREADY_IMPORTED"), possibleDuplicates: count("POSSIBLE_DUPLICATE"), invalidRows: count("INVALID"), missingDataClients: records.filter((x) => x.category === "NEW" && x.hasMissingData).length },
    records
  };
}
function commitClientImportRecords(db, { records, source, batchId }) {
  const run = db.transaction(() => {
    const existing = db.prepare("SELECT id,name,email,phone,address,external_reference,import_source FROM contacts").all();
    const exactRefs = new Map(existing.filter((x) => x.import_source && x.external_reference).map((x) => [`${x.import_source}::${x.external_reference}`, x]));
    const existingEmails = new Map(), existingPhones = new Map(), existingNameAddress = new Map();
    for (const c of existing) {
      for (const e of normalizeEmailList(c.email)) if (!existingEmails.has(e)) existingEmails.set(e, c);
      for (const ph of normalizePhones(c.phone)) if (!existingPhones.has(ph)) existingPhones.set(ph, c);
      const key = `${normalizeText(c.name)}::${normalizeText(c.address)}`;
      if (normalizeText(c.name) && normalizeText(c.address) && !existingNameAddress.has(key)) existingNameAddress.set(key, c);
    }
    const idRows = db.prepare("SELECT id FROM contacts WHERE id LIKE 'C-%'").all();
    let maxId = 0;
    for (const row of idRows) { const m = String(row.id || "").match(/^C-(\d{1,5})$/); if (m) maxId = Math.max(maxId, Number(m[1])); }
    const nextId = () => { maxId += 1; if (maxId > 99999) throw new Error("CONTACT_ID_LIMIT_REACHED"); return `C-${String(maxId).padStart(5, "0")}`; };
    const insert = db.prepare(`INSERT INTO contacts(id,name,company,type,email,phone,address,billing_address,priority,status,owner,relationship_holder,loss_risk,last_contact,next_step,notes,has_piano,interested_buying,external_reference,import_source,import_batch_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    let importedClients = 0, skippedDuplicates = 0, missingDataClients = 0, failedRows = 0;
    const skipped = [];
    for (const rec of records) {
      if (rec.category !== "NEW") { skippedDuplicates += 1; continue; }
      if (!String(rec.name || "").trim() || !String(rec.externalReference || "").trim()) { failedRows += 1; continue; }
      const refKey = `${source}::${rec.externalReference}`;
      let match = exactRefs.get(refKey), reason = match ? "EXTERNAL_REFERENCE_MATCH" : "";
      if (!match) { match = normalizeEmailList(rec.email).map((e) => existingEmails.get(e)).find(Boolean); if (match) reason = "EMAIL_MATCH"; }
      if (!match) { match = normalizePhones(rec.phone).map((ph) => existingPhones.get(ph)).find(Boolean); if (match) reason = "PHONE_MATCH"; }
      if (!match) { match = existingNameAddress.get(`${normalizeText(rec.name)}::${normalizeText(rec.serviceAddress)}`); if (match) reason = "NAME_ADDRESS_MATCH"; }
      if (match) { skippedDuplicates += 1; skipped.push({ externalReference: rec.externalReference, name: rec.name, reason, matchId: match.id }); continue; }
      const id = nextId();
      insert.run(id, String(rec.name || "").trim(), "", "General", String(rec.email || "").trim(), String(rec.phone || "").trim(), String(rec.serviceAddress || "").trim(), String(rec.billingAddress || "").trim(), "Medium", "Active", "", String(rec.contactFullName || "").trim(), "Unknown", rec.lastContact || null, String(rec.nextStep || "").trim(), String(rec.notes || "").trim(), 0, 0, String(rec.externalReference || "").trim(), source, batchId);
      const added = { id, name: rec.name, email: rec.email, phone: rec.phone, address: rec.serviceAddress, external_reference: rec.externalReference, import_source: source };
      exactRefs.set(refKey, added);
      for (const e of normalizeEmailList(rec.email)) if (!existingEmails.has(e)) existingEmails.set(e, added);
      for (const ph of normalizePhones(rec.phone)) if (!existingPhones.has(ph)) existingPhones.set(ph, added);
      const nameAddressKey = `${normalizeText(rec.name)}::${normalizeText(rec.serviceAddress)}`;
      if (normalizeText(rec.name) && normalizeText(rec.serviceAddress) && !existingNameAddress.has(nameAddressKey)) existingNameAddress.set(nameAddressKey, added);
      importedClients += 1;
      if (rec.hasMissingData) missingDataClients += 1;
    }
    const result = { batchId, source, totalRows: records.length, importedClients, missingDataClients, skippedDuplicates, failedRows, skipped };
    const hasBatchTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_batches'").get();
    if (hasBatchTable) db.prepare(`UPDATE import_batches SET status='COMPLETED',imported_clients=?,skipped_duplicates=?,missing_data_clients=?,failed_rows=?,completed_at=CURRENT_TIMESTAMP,summary_json=? WHERE id=? AND status='PREVIEW'`).run(importedClients,skippedDuplicates,missingDataClients,failedRows,JSON.stringify(result),batchId);
    return result;
  });
  return run();
}

module.exports = { parseWorkbookSheets, detectClientSheet, analyzeClientWorkbook, commitClientImportRecords, normalizeEmailList, normalizePhones };

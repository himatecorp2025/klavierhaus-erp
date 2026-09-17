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

const CLIENT_PIANO_STRUCTURED_FIELDS = Object.freeze([
  "client_name",
  "client_email",
  "client_phone",
  "address",
  "brand",
  "model",
  "serial_number",
  "year_built",
  "size_length",
  "finish",
  "notes",
  "is_verified"
]);

function clientPianoExportRows(db) {
  return db.prepare(`
    SELECT
      COALESCE(c.name,'') AS client_name,
      COALESCE(c.email,'') AS client_email,
      COALESCE(c.phone,'') AS client_phone,
      COALESCE(NULLIF(trim(p.location),''),NULLIF(trim(c.address),''),'') AS address,
      COALESCE(p.brand,'') AS brand,
      COALESCE(p.model,'') AS model,
      COALESCE(p.serial_no,'') AS serial_number,
      COALESCE(p.build_year,p.year,'') AS year_built,
      COALESCE(NULLIF(trim(p.size_length),''),NULLIF(trim(p.size_display),''),NULLIF(trim(p.size_cm),''),NULLIF(trim(p.size_in),''),'') AS size_length,
      COALESCE(p.finish,'') AS finish,
      COALESCE(p.notes,'') AS notes,
      CASE WHEN COALESCE(cp.is_verified,0)=1 THEN 1 ELSE 0 END AS is_verified
    FROM client_pianos cp
    JOIN pianos p ON p.id=cp.piano_id
    JOIN contacts c ON c.id=cp.client_id
    ORDER BY lower(c.name),lower(p.brand),lower(p.model),p.id
  `).all().map(row => {
    const out = {};
    for (const field of CLIENT_PIANO_STRUCTURED_FIELDS) out[field] = row[field] ?? "";
    return out;
  });
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}
function serializeClientPianoCsv(rows) {
  const lines = [CLIENT_PIANO_STRUCTURED_FIELDS.join(",")];
  for (const row of rows) lines.push(CLIENT_PIANO_STRUCTURED_FIELDS.map(field => csvCell(row[field])).join(","));
  return lines.join("\r\n");
}
function parseCsvRows(content) {
  const text = String(content ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (quoted) throw new Error("CLIENT_PIANO_CSV_UNCLOSED_QUOTE");
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows.filter(values => values.some(value => String(value ?? "").trim() !== ""));
}
function normalizeStructuredClientPianoRow(input = {}) {
  const row = {};
  for (const field of CLIENT_PIANO_STRUCTURED_FIELDS) row[field] = input[field] == null ? "" : String(input[field]).trim();
  row.is_verified = /^(?:1|true|yes|y|verified)$/i.test(String(input.is_verified ?? "").trim()) ? 1 : 0;
  return row;
}
function parseStructuredClientPianoPayload({ format, content }) {
  const type = String(format || "").trim().toLowerCase();
  let rows = [];
  if (type === "json") {
    const parsed = JSON.parse(String(content || "[]"));
    rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.rows) ? parsed.rows : [];
    if (!rows.length && String(content || "").trim() !== "[]") throw new Error("CLIENT_PIANO_JSON_ROWS_REQUIRED");
  } else if (type === "csv") {
    const csvRows = parseCsvRows(content);
    if (!csvRows.length) return [];
    const header = csvRows.shift().map(value => String(value || "").trim());
    const missing = CLIENT_PIANO_STRUCTURED_FIELDS.filter(field => !header.includes(field));
    if (missing.length) {
      const error = new Error("CLIENT_PIANO_IMPORT_COLUMNS_MISSING");
      error.missingColumns = missing;
      throw error;
    }
    rows = csvRows.map(values => Object.fromEntries(header.map((field, index) => [field, values[index] ?? ""])));
  } else throw new Error("CLIENT_PIANO_IMPORT_FORMAT_UNSUPPORTED");
  return rows.map(normalizeStructuredClientPianoRow);
}

function commitStructuredClientPianoImport(db, { rows, actorName = "IMPORT" }) {
  const normalizedRows = Array.isArray(rows) ? rows.map(normalizeStructuredClientPianoRow) : [];
  const run = db.transaction(() => {
    const contacts = db.prepare("SELECT id,name,email,phone,address FROM contacts").all();
    const byEmail = new Map(), byPhone = new Map(), byNameAddress = new Map();
    const indexContact = contact => {
      for (const email of normalizeEmailList(contact.email)) if (!byEmail.has(email)) byEmail.set(email, contact);
      for (const phone of normalizePhones(contact.phone)) if (!byPhone.has(phone)) byPhone.set(phone, contact);
      const key = `${normalizeText(contact.name)}::${normalizeText(contact.address)}`;
      if (normalizeText(contact.name) && !byNameAddress.has(key)) byNameAddress.set(key, contact);
    };
    contacts.forEach(indexContact);
    const idRows = db.prepare("SELECT id FROM contacts WHERE id LIKE 'C-%'").all();
    let maxId = 0;
    for (const row of idRows) { const match = String(row.id || "").match(/^C-(\d{1,5})$/); if (match) maxId = Math.max(maxId, Number(match[1])); }
    const nextContactId = () => { maxId += 1; if (maxId > 99999) throw new Error("CONTACT_ID_LIMIT_REACHED"); return `C-${String(maxId).padStart(5, "0")}`; };
    const touchedClients = new Set();
    let createdClients = 0, updatedClients = 0, createdPianos = 0, updatedPianos = 0, verifiedLinks = 0;
    for (let index = 0; index < normalizedRows.length; index++) {
      const row = normalizedRows[index];
      if (!row.client_name || !row.brand || !row.model) {
        const error = new Error("CLIENT_PIANO_IMPORT_REQUIRED_FIELD");
        error.rowNumber = index + 2;
        throw error;
      }
      const email = normalizeEmailList(row.client_email)[0] || "", phone = normalizePhones(row.client_phone)[0] || "";
      let client = email ? byEmail.get(email) : null;
      if (!client && phone) client = byPhone.get(phone);
      if (!client) client = byNameAddress.get(`${normalizeText(row.client_name)}::${normalizeText(row.address)}`) || null;
      if (!client) {
        const id = nextContactId();
        db.prepare(`INSERT INTO contacts(id,name,type,email,phone,address,billing_address,priority,status,has_piano,interested_buying,notes)
          VALUES(?,?,'General',?,?,?,?, 'Medium','Active',1,0,'')`).run(id,row.client_name,row.client_email,row.client_phone,row.address,row.address);
        client = { id, name: row.client_name, email: row.client_email, phone: row.client_phone, address: row.address };
        contacts.push(client); indexContact(client); createdClients += 1;
      } else {
        db.prepare(`UPDATE contacts SET name=?,email=CASE WHEN ?<>'' THEN ? ELSE email END,phone=CASE WHEN ?<>'' THEN ? ELSE phone END,
          address=CASE WHEN ?<>'' THEN ? ELSE address END,billing_address=CASE WHEN ?<>'' THEN ? ELSE billing_address END,has_piano=1,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(row.client_name,row.client_email,row.client_email,row.client_phone,row.client_phone,row.address,row.address,row.address,row.address,client.id);
        client = { ...client, name: row.client_name, email: row.client_email || client.email, phone: row.client_phone || client.phone, address: row.address || client.address };
        updatedClients += 1;
      }
      touchedClients.add(client.id);
      db.prepare("INSERT OR IGNORE INTO piano_brands(brand_name,active) VALUES(?,1)").run(row.brand);
      db.prepare("INSERT OR IGNORE INTO piano_model_catalog(brand_name,model_name,active) VALUES(?,?,1)").run(row.brand,row.model);
      const serial = String(row.serial_number || "").trim();
      let piano = serial ? db.prepare("SELECT * FROM pianos WHERE lower(trim(serial_no))=lower(trim(?)) LIMIT 1").get(serial) : null;
      if (!piano) {
        piano = db.prepare(`SELECT p.* FROM pianos p JOIN client_pianos cp ON cp.piano_id=p.id
          WHERE cp.client_id=? AND lower(trim(COALESCE(p.brand,'')))=lower(trim(?)) AND lower(trim(COALESCE(p.model,'')))=lower(trim(?))
            AND COALESCE(p.build_year,p.year,0)=COALESCE(?,0)
            AND lower(trim(COALESCE(NULLIF(p.size_length,''),NULLIF(p.size_display,''),'')))=lower(trim(?))
            AND lower(trim(COALESCE(p.finish,'')))=lower(trim(?)) LIMIT 1`)
          .get(client.id,row.brand,row.model,Number(row.year_built)||null,row.size_length,row.finish);
      }
      const buildYear = Number(row.year_built) || null;
      if (!piano) {
        const pianoId = `P-${crypto.randomUUID()}`;
        db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,finish,build_year,size_length,size_display,ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes,owner_resolution)
          VALUES(?,?,?,?,?,?,?,?, 'Customer owned','Customer owned',?,?,?,0,'Active',?,'MATCHED_CLIENT')`)
          .run(pianoId,row.brand,row.model,serial,row.finish,buildYear,row.size_length,row.size_length,`${row.brand} ${row.model}`.trim(),client.id,row.address,row.notes);
        piano = db.prepare("SELECT * FROM pianos WHERE id=?").get(pianoId); createdPianos += 1;
      } else {
        const previousOwner = String(piano.owner_contact_id || ""); if (previousOwner) touchedClients.add(previousOwner);
        db.prepare(`UPDATE pianos SET brand=?,model=?,serial_no=?,finish=?,build_year=?,size_length=?,size_display=?,display_name=?,owner_contact_id=?,location=?,notes=?,
          ownership='Customer owned',ownership_type='Customer owned',owner_resolution='MATCHED_CLIENT',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(row.brand,row.model,serial,row.finish,buildYear,row.size_length,row.size_length,`${row.brand} ${row.model}`.trim(),client.id,row.address,row.notes,piano.id);
        updatedPianos += 1;
      }
      const currentLink = db.prepare("SELECT * FROM client_pianos WHERE client_id=? AND piano_id=? LIMIT 1").get(client.id,piano.id);
      db.prepare("DELETE FROM client_pianos WHERE piano_id=? AND client_id<>?").run(piano.id,client.id);
      if (currentLink) {
        db.prepare("UPDATE client_pianos SET is_verified=?,verified_at=?,verified_by=? WHERE id=?")
          .run(row.is_verified,row.is_verified ? new Date().toISOString() : null,row.is_verified ? actorName : null,currentLink.id);
      } else {
        db.prepare("INSERT INTO client_pianos(id,client_id,piano_id,is_verified,verified_at,verified_by) VALUES(?,?,?,?,?,?)")
          .run(`CP-${crypto.randomUUID()}`,client.id,piano.id,row.is_verified,row.is_verified ? new Date().toISOString() : null,row.is_verified ? actorName : null);
      }
      if (row.is_verified) verifiedLinks += 1;
    }
    const countForClient = db.prepare("SELECT COUNT(*) AS c FROM client_pianos WHERE client_id=?");
    const updateHasPiano = db.prepare("UPDATE contacts SET has_piano=?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
    for (const clientId of touchedClients) updateHasPiano.run(Number(countForClient.get(clientId)?.c || 0) > 0 ? 1 : 0, clientId);
    return { totalRows: normalizedRows.length, createdClients, updatedClients, createdPianos, updatedPianos, verifiedLinks };
  });
  return run();
}

module.exports = {
  parseWorkbookSheets,
  detectClientSheet,
  analyzeClientWorkbook,
  commitClientImportRecords,
  normalizeEmailList,
  normalizePhones,
  CLIENT_PIANO_STRUCTURED_FIELDS,
  clientPianoExportRows,
  serializeClientPianoCsv,
  parseStructuredClientPianoPayload,
  commitStructuredClientPianoImport
};

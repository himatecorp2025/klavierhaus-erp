"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { generateInvoicePdf, generateBusinessInvoicePdf, generateMonthlyInvoiceReportPdf, generateTicketBackPdf, generateTicketFrontPdf, generateTicketFullPdf } = require("./document-pdf");
const { generateGuestDataPdf } = require("./guest-list-pdf");
const { readGuestData } = require("./guest-data");
const { createTicketService } = require("./ticket-service");
const { PAYMENT_METHODS, normalizePaymentMethod } = require("./payment-methods");
const { buildConversationAutoReplyEmail, buildConversationReplyEmail } = require("./transactional-email");
const { workflowBillablePhaseSubtotal } = require("./accounting-domain");
const { generateCustomerConversationReportPdf } = require("./helpdesk-pdf");
const {
  attendanceError,
  attendanceRows,
  attendanceSnapshot,
  changeGuestStatus,
  close: closeAttendance,
  createAttendanceHub,
  ensureSession,
  pause: pauseAttendance,
  recordPdfExport,
  reopen: reopenAttendance,
  resume: resumeAttendance,
  startMode,
  state: attendanceState
} = require("./event-attendance");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONVERSATION_CATEGORIES = new Set(["SERVICE", "PIANO", "EVENT", "REFUND", "PRIVATE_CONSULTATION", "TECHNICAL", "TICKET", "BILLING", "REPAIR", "GENERAL", "OTHER"]);
const CONVERSATION_STATUSES = new Set(["OPEN", "PENDING_CUSTOMER", "PENDING_STAFF", "CLOSED"]);
const IDENTITY_REQUIRED_CATEGORIES = new Set(["SERVICE", "EVENT", "REFUND", "PRIVATE_CONSULTATION", "BILLING", "REPAIR"]);
const CATEGORY_ROUTING = Object.freeze({
  SERVICE: "MANAGER", PIANO: "MANAGER", REPAIR: "MANAGER",
  EVENT: "ADMIN", REFUND: "ADMIN", PRIVATE_CONSULTATION: "ADMIN", BILLING: "ADMIN",
  TECHNICAL: "WORKER", TICKET: "WORKER", GENERAL: "ADMIN", OTHER: "ADMIN"
});
const CATEGORY_LABELS = Object.freeze({
  SERVICE: ["Services", "Szolgáltatások"], PIANO: ["Piano / showroom", "Zongora / showroom"], EVENT: ["Events", "Események"],
  REFUND: ["Refund / payment", "Visszatérítés / fizetés"], PRIVATE_CONSULTATION: ["Private consultation", "Privát konzultáció"],
  TECHNICAL: ["Technical issue", "Technikai probléma"], TICKET: ["Ticket problem", "Jegyprobléma"], BILLING: ["Billing", "Számlázás"],
  REPAIR: ["Repair / service", "Javítás / szerviz"], GENERAL: ["General question", "Általános kérdés"], OTHER: ["Other", "Egyéb"]
});
const CUSTOMER_ATTACHMENT_MAX_FILES = 10;
const CUSTOMER_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
const CUSTOMER_RETENTION_YEARS = 5;

function clean(value, max = 5000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function parseFinancialNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  let raw = String(value ?? "").trim().replace(/\s+/g, "");
  if (!raw) return NaN;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) raw = raw.replace(/\./g, "").replace(",", ".");
    else raw = raw.replace(/,/g, "");
  } else if (comma >= 0) raw = raw.replace(",", ".");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function roundFinancial(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

const NEW_YORK_TIME_ZONE = "America/New_York";
function newYorkParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}
function newYorkDateKey(value = new Date()) { const p = newYorkParts(value); return `${p.year}-${p.month}-${p.day}`; }
function newYorkMonthKey(value = new Date()) { const p = newYorkParts(value); return `${p.year}-${p.month}`; }
function timeZoneOffsetMs(date, timeZone = NEW_YORK_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const asUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
  return asUtc - date.getTime();
}
function newYorkLocalToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  const localUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = localUtc;
  for (let i = 0; i < 4; i += 1) guess = localUtc - timeZoneOffsetMs(new Date(guess));
  return new Date(guess);
}
function nextNewYorkMonthBoundary(value = new Date()) {
  const p = newYorkParts(value);
  let year = Number(p.year), month = Number(p.month) + 1;
  if (month === 13) { month = 1; year += 1; }
  return newYorkLocalToUtc(year, month, 1, 0, 0, 0);
}
function actualMonthEndDate(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) return null;
  const [year, monthNumber] = String(month).split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
}
function invoiceLifecycleStatus(invoice, now = new Date()) {
  const status = String(invoice?.status || "").toLowerCase();
  if (status === "void") return "Void";
  if (status === "draft") return "Draft";
  if (status === "paid") return "Paid";
  const due = String(invoice?.due_date || "");
  if (due && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < newYorkDateKey(now)) return "Overdue";
  return "Pending";
}
function sqliteTimestampToUtc(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) { const parsed = new Date(text); return Number.isNaN(parsed.getTime()) ? null : parsed; }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) { const parsed = new Date(`${text.replace(" ", "T")}Z`); return Number.isNaN(parsed.getTime()) ? null : parsed; }
  return null;
}
function invoicePaidPeriod(invoice) {
  const paidAt = sqliteTimestampToUtc(invoice?.paid_at);
  if (paidAt) return newYorkMonthKey(paidAt);
  const issueDate = String(invoice?.issue_date || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(issueDate) ? issueDate.slice(0, 7) : "";
}
function archiveEligibleInvoices(db, predicate, now = new Date()) {
  const archivedAt = now.toISOString();
  const rows = db.prepare("SELECT id,paid_at,issue_date FROM invoices WHERE status='paid' AND archived_at IS NULL").all();
  const update = db.prepare("UPDATE invoices SET archived_at=?,archived_period=? WHERE id=? AND status='paid' AND archived_at IS NULL");
  const apply = db.transaction(() => {
    let changes = 0;
    for (const row of rows) {
      const period = invoicePaidPeriod(row);
      if (!period || !predicate(period)) continue;
      changes += Number(update.run(archivedAt, period, row.id).changes || 0);
    }
    return changes;
  });
  return apply();
}
function closeInvoicePeriod(db, period, now = new Date()) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ""))) throw new Error("INVALID_INVOICE_PERIOD");
  return archiveEligibleInvoices(db, (paidPeriod) => paidPeriod <= period, now);
}
function closeCompletedInvoicePeriods(db, now = new Date()) {
  const currentMonth = newYorkMonthKey(now);
  return archiveEligibleInvoices(db, (paidPeriod) => paidPeriod < currentMonth, now);
}
function nextNewYorkMonthClose(value = new Date()) {
  return new Date(nextNewYorkMonthBoundary(value).getTime() - 1000);
}
const MAX_INVOICE_CLOSE_TIMER_MS = 6 * 60 * 60 * 1000;
function scheduleInvoicePeriodClose(db) {
  closeCompletedInvoicePeriods(db, new Date());
  const scheduleNext = (base = new Date()) => {
    const closeAt = nextNewYorkMonthClose(base);
    const waitUntilClose = () => {
      const remaining = closeAt.getTime() - Date.now();
      if (remaining <= 0) {
        closeInvoicePeriod(db, newYorkMonthKey(closeAt), new Date());
        scheduleNext(new Date(closeAt.getTime() + 2000));
        return;
      }
      const timer = setTimeout(waitUntilClose, Math.min(remaining, MAX_INVOICE_CLOSE_TIMER_MS));
      if (typeof timer.unref === "function") timer.unref();
    };
    waitUntilClose();
  };
  scheduleNext();
}

function normalizeEmail(value) { return clean(value, 320).toLowerCase(); }
function validEmail(value) { return EMAIL_PATTERN.test(normalizeEmail(value)); }
function newId(prefix) { return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`; }
function tokenHash(token) { return crypto.createHash("sha256").update(String(token || "")).digest("hex"); }
function isSuperadmin(user) { return Boolean(user && (user.role === "SUPERADMIN" || Number(user.is_superadmin || 0) === 1)); }
function conversationEncryptionKey(env = process.env) {
  const secret = String(env.CONVERSATION_TOKEN_ENCRYPTION_KEY || env.JWT_SECRET || "").trim();
  return crypto.createHash("sha256").update(secret || "klavierhaus-conversation-key-not-for-production").digest();
}
function encryptConversationToken(token, key) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}
function decryptConversationToken(value, key) {
  try {
    const [ivValue, tagValue, ciphertextValue] = String(value || "").split(".");
    if (!ivValue || !tagValue || !ciphertextValue) return "";
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  } catch (_error) { return ""; }
}

const COMPANY_KEYS = Object.freeze([
  "legal_name", "trade_name", "logo_url", "address_line1", "address_line2", "city", "state", "postal_code", "country",
  "tax_id", "email", "phone", "invoice_prefix", "invoice_currency", "invoice_payment_terms", "invoice_footer"
]);

function readCompanyData(db) {
  const rows = db.prepare("SELECT setting_key,setting_value FROM app_settings WHERE setting_key LIKE 'company_data_%' OR setting_key IN ('company_name','logo_url')").all();
  const values = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value || ""]));
  return {
    legal_name: values.company_data_legal_name || values.company_name || "Klavierhaus",
    trade_name: values.company_data_trade_name || values.company_name || "Klavierhaus",
    logo_url: values.company_data_logo_url || values.logo_url || "/icons/icon-512.png",
    address_line1: values.company_data_address_line1 || "",
    address_line2: values.company_data_address_line2 || "",
    city: values.company_data_city || "New York",
    state: values.company_data_state || "NY",
    postal_code: values.company_data_postal_code || "",
    country: values.company_data_country || "United States",
    tax_id: values.company_data_tax_id || "",
    email: values.company_data_email || "",
    phone: values.company_data_phone || "",
    invoice_prefix: values.company_data_invoice_prefix || "KH",
    invoice_currency: values.company_data_invoice_currency || "USD",
    invoice_payment_terms: values.company_data_invoice_payment_terms || "Paid at checkout",
    invoice_footer: values.company_data_invoice_footer || "Klavierhaus · New York"
  };
}

function saveCompanyData(db, data, userName) {
  const values = {
    legal_name: clean(data.legal_name, 240), trade_name: clean(data.trade_name, 240), logo_url: clean(data.logo_url, 1000),
    address_line1: clean(data.address_line1, 300), address_line2: clean(data.address_line2, 300), city: clean(data.city, 120),
    state: clean(data.state, 80), postal_code: clean(data.postal_code, 40), country: clean(data.country, 120), tax_id: clean(data.tax_id, 120),
    email: normalizeEmail(data.email), phone: clean(data.phone, 80), invoice_prefix: clean(data.invoice_prefix || "KH", 20).replace(/[^A-Za-z0-9_-]/g, "").toUpperCase() || "KH",
    invoice_currency: clean(data.invoice_currency || "USD", 3).toUpperCase(), invoice_payment_terms: clean(data.invoice_payment_terms || "Paid at checkout", 300),
    invoice_footer: clean(data.invoice_footer || "Klavierhaus · New York", 500)
  };
  if (!values.legal_name || !values.address_line1 || !values.city || !values.state || !values.postal_code || !values.country) {
    throw Object.assign(new Error("COMPANY_LEGAL_ADDRESS_REQUIRED"), { status: 400 });
  }
  if (values.email && !validEmail(values.email)) throw Object.assign(new Error("COMPANY_EMAIL_INVALID"), { status: 400 });
  if (!/^[A-Z]{3}$/.test(values.invoice_currency)) throw Object.assign(new Error("COMPANY_CURRENCY_INVALID"), { status: 400 });
  const save = db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`);
  db.transaction(() => COMPANY_KEYS.forEach((key) => save.run(`company_data_${key}`, values[key] ?? "", userName || "")))();
  return readCompanyData(db);
}

function resolveCompanyLogoPath(logoUrl, uploadDir) {
  const value = clean(logoUrl, 1000);
  if (value.startsWith("/uploads/") && uploadDir) return path.join(uploadDir, path.basename(value));
  if (value.startsWith("/icons/")) return path.join(__dirname, "..", "public", value.slice(1));
  return path.join(__dirname, "assets", "klavierhaus-logo-black.jpg");
}

function resolveTicketLogoPath(logoUrl, uploadDir) {
  const canonical = path.join(__dirname, "assets", "klavierhaus-logo-white.png");
  const value = clean(logoUrl, 1000);
  if (!value || value === "/icons/icon-192.png" || value === "/icons/icon-512.png") return canonical;
  if (value.startsWith("/uploads/") && uploadDir) {
    const uploaded = path.join(uploadDir, path.basename(value));
    return fs.existsSync(uploaded) ? uploaded : canonical;
  }
  if (value.startsWith("/icons/")) {
    const publicAsset = path.join(__dirname, "..", "public", value.slice(1));
    return fs.existsSync(publicAsset) ? publicAsset : canonical;
  }
  return canonical;
}

function formatEventDate(event, language = "en") {
  if (!event?.start_at) return "";
  return new Intl.DateTimeFormat(language === "hu" ? "hu-HU" : "en-US", { timeZone: event.timezone || "America/New_York", dateStyle: "long", timeStyle: "short" }).format(new Date(event.start_at));
}

function eventVenue(event) {
  return [event?.venue_name, event?.venue_street, event?.venue_city, event?.venue_region, event?.venue_postal_code].filter(Boolean).join(", ");
}

function isoDate(year, month, day) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function weekdayDate(year, month, weekday, occurrence) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return isoDate(year, month, 1 + offset + (occurrence - 1) * 7);
}
function lastWeekdayDate(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return isoDate(year, month, last.getUTCDate() - offset);
}
function addCalendarDays(dateKey, amount) {
  const date = new Date(`${dateKey}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
function easterSundayDate(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}
function supportHolidayKeys(year, includeChristian = true) {
  const fixed = [[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]];
  const keys = new Set(fixed.map(([month, day]) => isoDate(year, month, day)));
  const observed = (month, day) => {
    const key = isoDate(year, month, day); const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
    keys.add(weekday === 6 ? addCalendarDays(key, -1) : weekday === 0 ? addCalendarDays(key, 1) : key);
  };
  fixed.forEach(([month, day]) => observed(month, day));
  keys.add(weekdayDate(year, 1, 1, 3)); // Martin Luther King Jr. Day
  keys.add(weekdayDate(year, 2, 1, 3)); // Washington's Birthday
  keys.add(lastWeekdayDate(year, 5, 1)); // Memorial Day
  keys.add(weekdayDate(year, 9, 1, 1)); // Labor Day
  keys.add(weekdayDate(year, 10, 1, 2)); // Columbus / Indigenous Peoples' Day
  keys.add(weekdayDate(year, 11, 4, 4)); // Thanksgiving Day
  if (includeChristian) {
    const easter = easterSundayDate(year);
    keys.add(addCalendarDays(easter, -2)); // Good Friday
    keys.add(easter); // Easter Sunday
    keys.add(addCalendarDays(easter, 1)); // Easter Monday
    keys.add(addCalendarDays(easter, 39)); // Ascension Day
    keys.add(addCalendarDays(easter, 49)); // Pentecost Sunday
    keys.add(addCalendarDays(easter, 50)); // Pentecost Monday
  }
  return keys;
}
function manualSupportHolidayKeys(db, year) {
  if (!db) return new Map();
  try {
    return new Map(db.prepare("SELECT holiday_date,enabled FROM support_holidays WHERE holiday_date LIKE ?").all(`${year}-%`).map((row) => [row.holiday_date, Number(row.enabled) === 1]));
  } catch (_error) { return new Map(); }
}
function isSupportHoursOpen(date = new Date(), env = process.env, db = null) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).reduce((result, part) => { result[part.type] = part.value; return result; }, {});
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const holidays = supportHolidayKeys(Number(parts.year), String(env.SUPPORT_CHRISTIAN_HOLIDAYS || "true").toLowerCase() !== "false");
  String(env.SUPPORT_HOLIDAYS || "").split(",").map((value) => value.trim()).filter(Boolean).forEach((value) => holidays.add(value));
  manualSupportHolidayKeys(db, Number(parts.year)).forEach((enabled, key) => { if (enabled) holidays.add(key); else holidays.delete(key); });
  if (["Sat", "Sun"].includes(parts.weekday) || holidays.has(dateKey)) return false;
  const hour = Number(parts.hour);
  return hour >= 9 && hour < 17;
}

function requiresConversationIdentity(category) { return IDENTITY_REQUIRED_CATEGORIES.has(String(category || "").toUpperCase()); }
function roleLabel(role) { return role === "WORKER" ? "Staff" : role === "MANAGER" ? "Manager" : role === "SUPERADMIN" ? "Superadmin" : "Admin"; }
function routingRoleFor(category) { return CATEGORY_ROUTING[String(category || "GENERAL").toUpperCase()] || "ADMIN"; }
function chooseConversationAssignee(db, category) {
  const role = routingRoleFor(category);
  const row = db.prepare("SELECT id,name,role,is_superadmin FROM users WHERE status='Active' AND role=? AND COALESCE(hidden_user,0)=0 ORDER BY name,id LIMIT 1").get(role);
  if (row) return { ...row, routing_role: role };
  const fallback = db.prepare("SELECT id,name,role,is_superadmin FROM users WHERE status='Active' AND role='ADMIN' AND COALESCE(hidden_user,0)=0 ORDER BY name,id LIMIT 1").get();
  return fallback ? { ...fallback, routing_role: "ADMIN" } : null;
}
function conversationIdentityError(category) {
  const error = new Error("CONVERSATION_IDENTITY_REQUIRED"); error.status = 400; error.required_fields = ["name", "email"]; error.category = category; return error;
}
function conversationTokenFromRow(row, key) { return decryptConversationToken(row?.public_token_encrypted, key); }
function parseMetadata(row) { try { return JSON.parse(row?.metadata_json || "{}"); } catch (_error) { return {}; } }
function attachmentUrl(scope, tokenOrId, attachmentId) {
  return scope === "public"
    ? `/api/site/customer-conversations/${encodeURIComponent(tokenOrId)}/attachments/${encodeURIComponent(attachmentId)}`
    : `/api/customer-conversations/${encodeURIComponent(tokenOrId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function createBusinessDocumentService({ db, uploadDir, transactionalEmail, websiteBaseUrl = "", env = process.env, invoiceEngineProvider = null }) {
  const documentDir = path.join(uploadDir || path.join(__dirname, "uploads"), "documents");
  fs.mkdirSync(documentDir, { recursive: true });
  const engine = () => {
    const value = typeof invoiceEngineProvider === "function" ? invoiceEngineProvider() : invoiceEngineProvider;
    if (!value) throw Object.assign(new Error("INVOICE_ENGINE_UNAVAILABLE"), { status: 503 });
    return value;
  };

  function deliveryRow(eventKey) { return db.prepare("SELECT * FROM communication_deliveries WHERE event_key=?").get(eventKey); }
  function beginDelivery({ eventKey, deliveryType, recipientEmail, eventId, paymentId, ticketId, conversationId }) {
    const existing = deliveryRow(eventKey);
    if (existing?.status === "SENT") return existing;
    if (!existing) db.prepare(`INSERT INTO communication_deliveries(id,event_key,delivery_type,recipient_email,event_id,payment_id,ticket_id,conversation_id,status,provider,attempt_count)
      VALUES(?,?,?,?,?,?,?,?,'PENDING','RESEND',0)`).run(newId("DEL"), eventKey, deliveryType, recipientEmail || null, eventId || null, paymentId || null, ticketId || null, conversationId || null);
    db.prepare("UPDATE communication_deliveries SET attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP WHERE event_key=?").run(eventKey);
    return deliveryRow(eventKey);
  }
  function finishDelivery(eventKey, result) {
    db.prepare(`UPDATE communication_deliveries SET status=?,provider_message_id=?,error_code=?,sent_at=CASE WHEN ?='SENT' THEN CURRENT_TIMESTAMP ELSE sent_at END,updated_at=CURRENT_TIMESTAMP WHERE event_key=?`)
      .run(result.status, result.providerMessageId || null, result.errorCode || null, result.status, eventKey);
  }
  function recordDelivery({ eventKey, deliveryType, recipientEmail, eventId, paymentId, ticketId, conversationId, result }) {
    beginDelivery({ eventKey, deliveryType, recipientEmail, eventId, paymentId, ticketId, conversationId });
    finishDelivery(eventKey, result);
    return deliveryRow(eventKey);
  }
  function artifactPath(prefix, id) { return path.join(documentDir, `${prefix}-${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`); }
  function publicDocumentPath(filePath) { return `/uploads/documents/${path.basename(filePath)}`; }
  function eventDocumentData(event, tickets) {
    return { event: { ...event, dateLabel: formatEventDate(event, "en"), venueLabel: eventVenue(event) }, tickets, language: "en", logoPath: resolveTicketLogoPath(readCompanyData(db).logo_url, uploadDir) };
  }
  function ticketDocumentGenerator(mode) { return mode === "front" ? generateTicketFrontPdf : mode === "back" ? generateTicketBackPdf : generateTicketFullPdf; }
  function persistTicketDocument(ticket, documentType, pdf, userId = null) {
    const normalized = String(documentType || "FULL").toUpperCase();
    const filePath = artifactPath(`ticket-${ticket.id}-${normalized.toLowerCase()}`, ticket.id);
    fs.writeFileSync(filePath, pdf);
    const column = ({ FRONT: "document_front_path", BACK: "document_back_path", FULL: "document_full_path" })[normalized];
    if (column) db.prepare(`UPDATE event_tickets SET ${column}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(publicDocumentPath(filePath), ticket.id);
    db.prepare(`INSERT INTO event_ticket_documents(id,ticket_id,event_id,document_type,stored_path,generated_by_user_id)
      VALUES(?,?,?,?,?,?) ON CONFLICT(ticket_id,document_type) DO UPDATE SET stored_path=excluded.stored_path,generated_at=CURRENT_TIMESTAMP,generated_by_user_id=excluded.generated_by_user_id`)
      .run(newId("TDOC"), ticket.id, ticket.event_id, normalized, publicDocumentPath(filePath), userId);
    return { document_type: normalized, stored_path: publicDocumentPath(filePath), file_path: filePath };
  }
  function eventRecognition(event) {
    const status = String(event?.status || "").toUpperCase();
    const recognized = status === "COMPLETED" || (status === "CLOSED" && String(event?.status_before_close || "").toUpperCase() === "COMPLETED");
    return {
      revenueRecognitionStatus: recognized ? "RECOGNIZED" : "DEFERRED",
      revenueRecognitionDate: recognized ? newYorkDateKey(event?.end_at || new Date()) : null,
      deferredEventId: event?.id || null
    };
  }
  function eventDueDate(event, issueDate) {
    const eventDate = String(event?.start_at || "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && eventDate >= issueDate ? eventDate : issueDate;
  }
  function ensureTicketInvoice(ticket, event, { status = null } = {}) {
    if (!ticket || Number(ticket.price_cents || 0) <= 0) return null;
    const invoiceEngine = engine();
    let invoice = ticket.invoice_id ? invoiceEngine.invoiceDetail(ticket.invoice_id) : null;
    if (!invoice) invoice = db.prepare("SELECT * FROM invoices WHERE direction='receivable' AND source_type='event' AND source_id=? LIMIT 1").get(`ticket:${ticket.id}`);
    const desiredStatus = status || (ticket.payment_status === "PAID" ? "paid" : "issued");
    const method = normalizePaymentMethod(ticket.payment_method) || "Cash";
    const recognition = eventRecognition(event);
    if (!invoice) {
      const issueDate = String(ticket.paid_at || ticket.reserved_at || ticket.created_at || new Date().toISOString()).slice(0, 10);
      invoice = invoiceEngine.createInvoice({
        direction:"receivable", issueDate, dueDate:eventDueDate(event,issueDate), sourceType:"event", sourceId:`ticket:${ticket.id}`,
        summary:`Event ticket: ${event.title_en || event.title_hu || event.id}`, taxRate:0, paymentMethod:method, status:desiredStatus,
        ...recognition,
        items:[{ item_description:`${event.title_en || event.title_hu || "Event"} · ${ticket.attendee_name || ticket.buyer_name || "Ticket"}`, quantity:1, unit_price:Number(ticket.price_cents || 0)/100, line_type:"fee" }]
      });
    } else {
      if (desiredStatus === "paid" && invoice.status !== "paid") {
        const before = invoiceEngine.invoiceDetail(invoice.id);
        db.prepare("UPDATE invoices SET status='paid',payment_method=?,paid_at=COALESCE(paid_at,CURRENT_TIMESTAMP) WHERE id=?").run(method, invoice.id);
        const after = invoiceEngine.invoiceDetail(invoice.id);
        invoiceEngine.recordAdjustment(before, after, "Ticket payment marked paid", { name: "SYSTEM" });
      }
      if (recognition.revenueRecognitionStatus === "DEFERRED") {
        const current = invoiceEngine.invoiceDetail(invoice.id);
        const needsRepair = String(current.revenue_recognition_status || "").toUpperCase() !== "DEFERRED" || String(current.deferred_event_id || "") !== String(event.id) || current.revenue_recognition_date;
        if (needsRepair) {
          db.prepare("UPDATE invoices SET revenue_recognition_status='DEFERRED',revenue_recognition_date=NULL,deferred_event_id=? WHERE id=?").run(event.id, current.id);
          db.prepare("UPDATE invoice_credit_memos SET revenue_effect_date=NULL WHERE invoice_id=? AND memo_type='EVENT_REFUND' AND accounting_effect=1 AND revenue_effect_date IS NOT NULL").run(current.id);
          const repaired = invoiceEngine.invoiceDetail(current.id);
          invoiceEngine.recordAdjustment(current, repaired, "Event revenue recognition corrected to deferred", { name: "SYSTEM" });
        }
      } else if (String(invoice.revenue_recognition_status || "").toUpperCase() !== "RECOGNIZED") {
        invoiceEngine.recognizeEventRevenue({ eventId: event.id, recognitionDate: recognition.revenueRecognitionDate });
      }
      invoice = invoiceEngine.invoiceDetail(invoice.id);
    }
    db.prepare("UPDATE event_tickets SET invoice_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(invoice.id,ticket.id);
    db.prepare("DELETE FROM financial_items WHERE source_type='event_manual_ticket' AND source_id=?").run(ticket.id);
    return invoice;
  }
  function ensurePaymentInvoice(payment, event, tickets) {
    const invoiceEngine = engine();
    let invoice = payment.invoice_id ? invoiceEngine.invoiceDetail(payment.invoice_id) : null;
    if (!invoice) invoice = db.prepare("SELECT * FROM invoices WHERE direction='receivable' AND source_type='event' AND source_id=? LIMIT 1").get(`payment:${payment.id}`);
    const recognition = eventRecognition(event);
    if (!invoice) {
      const issueDate = String(payment.paid_at || payment.created_at || new Date().toISOString()).slice(0, 10);
      invoice = invoiceEngine.createInvoice({
        direction:"receivable", issueDate, dueDate:eventDueDate(event,issueDate), sourceType:"event", sourceId:`payment:${payment.id}`,
        summary:`Event ticket sale: ${event.title_en || event.title_hu || event.id}`, taxRate:0, paymentMethod:"Credit Card", status:"paid",
        ...recognition,
        items:[{ item_description:`${event.title_en || event.title_hu || "Event"} · ${Number(payment.quantity || tickets.length || 1)} ticket(s)`, quantity:1, unit_price:Number(payment.amount_total || 0)/100, line_type:"fee" }]
      });
    } else {
      if (recognition.revenueRecognitionStatus === "DEFERRED") {
        const current = invoiceEngine.invoiceDetail(invoice.id);
        const needsRepair = String(current.revenue_recognition_status || "").toUpperCase() !== "DEFERRED" || String(current.deferred_event_id || "") !== String(event.id) || current.revenue_recognition_date;
        if (needsRepair) {
          db.prepare("UPDATE invoices SET revenue_recognition_status='DEFERRED',revenue_recognition_date=NULL,deferred_event_id=? WHERE id=?").run(event.id, current.id);
          db.prepare("UPDATE invoice_credit_memos SET revenue_effect_date=NULL WHERE invoice_id=? AND memo_type='EVENT_REFUND' AND accounting_effect=1 AND revenue_effect_date IS NOT NULL").run(current.id);
          const repaired = invoiceEngine.invoiceDetail(current.id);
          invoiceEngine.recordAdjustment(current, repaired, "Event revenue recognition corrected to deferred", { name: "SYSTEM" });
        }
      } else if (String(invoice.revenue_recognition_status || "").toUpperCase() !== "RECOGNIZED") {
        invoiceEngine.recognizeEventRevenue({ eventId: event.id, recognitionDate: recognition.revenueRecognitionDate });
      }
      invoice = invoiceEngine.invoiceDetail(invoice.id);
    }
    db.prepare("UPDATE event_payments SET invoice_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(invoice.id,payment.id);
    db.prepare("UPDATE event_tickets SET invoice_id=?,updated_at=CURRENT_TIMESTAMP WHERE event_payment_id=?").run(invoice.id,payment.id);
    db.prepare("DELETE FROM financial_items WHERE source_type='event_payment' AND source_id=?").run(payment.id);
    return invoice;
  }
  function createEventRefundCreditMemo(payment, event, refund = null) {
    if (!payment || !event) return null;
    const tickets = db.prepare("SELECT * FROM event_tickets WHERE event_payment_id=? ORDER BY ticket_sequence,id").all(payment.id);
    const invoice = ensurePaymentInvoice(payment, event, tickets);
    const amount = roundFinancial(Number(payment.amount_total || 0) / 100);
    if (!(amount > 0)) return null;
    return engine().createCreditMemo({
      invoiceId: invoice.id,
      eventId: event.id,
      memoType: "EVENT_REFUND",
      sourceType: "EVENT_PAYMENT_REFUND",
      sourceId: payment.id,
      memoDate: newYorkDateKey(),
      reason: clean(refund?.metadata?.administrative_reason || `Stripe ticket refund ${refund?.id || payment.stripe_refund_id || payment.id}`, 2000),
      totalAmount: amount,
      cashEffect: true,
      accountingEffect: true,
      actor: { name: "SYSTEM" }
    });
  }
  function businessInvoicePdf(invoice, counterpartyName = "") {
    const company = readCompanyData(db);
    const logoPath = resolveCompanyLogoPath(company.logo_url, uploadDir);
    return generateBusinessInvoicePdf({ company, invoice, items: invoice.items || [], counterpartyName: counterpartyName || invoice.counterparty_name || "Event Customer", logoPath });
  }

  async function sendPurchaseDocuments(paymentId, { resend = false } = {}) {
    const payment = db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);
    if (!payment) throw Object.assign(new Error("EVENT_PAYMENT_NOT_FOUND"), { status: 404 });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);
    const tickets = db.prepare("SELECT * FROM event_tickets WHERE event_payment_id=? ORDER BY ticket_sequence,id").all(payment.id);
    if (!event || !tickets.length) throw new Error("EVENT_TICKETS_NOT_READY");
    const company = readCompanyData(db);
    const invoice = ensurePaymentInvoice(payment,event,tickets);
    const ticketPdf = generateTicketFrontPdf(eventDocumentData(event, tickets));
    tickets.forEach((ticket) => {
      persistTicketDocument(ticket, "FRONT", generateTicketFrontPdf(eventDocumentData(event, [ticket])));
      persistTicketDocument(ticket, "BACK", generateTicketBackPdf(eventDocumentData(event, [ticket])));
      persistTicketDocument(ticket, "FULL", generateTicketFullPdf(eventDocumentData(event, [ticket])));
    });
    const invoicePdf = businessInvoicePdf(invoice,payment.purchaser_name);
    const ticketPath = artifactPath("tickets", payment.id); const invoicePath = artifactPath("central-invoice", invoice.id);
    if (!fs.existsSync(ticketPath) || resend) fs.writeFileSync(ticketPath, ticketPdf);
    if (!fs.existsSync(invoicePath) || resend) fs.writeFileSync(invoicePath, invoicePdf);
    const key = `event-purchase-documents:${payment.id}`;
    beginDelivery({ eventKey: key, deliveryType: "EVENT_PURCHASE_DOCUMENTS", recipientEmail: payment.purchaser_email, eventId: event.id, paymentId: payment.id });
    if (!transactionalEmail?.sendEventPurchaseConfirmation) {
      finishDelivery(key, { status: "NOT_CONFIGURED", errorCode: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      return { status: "NOT_CONFIGURED", invoice_number: invoice.invoice_number, ticket_file: publicDocumentPath(ticketPath), invoice_file: publicDocumentPath(invoicePath) };
    }
    try {
      const sent = await transactionalEmail.sendEventPurchaseConfirmation({ to: payment.purchaser_email, purchaserName: payment.purchaser_name, event, payment, tickets, invoiceNumber: invoice.invoice_number, company, ticketPdf, invoicePdf, websiteBaseUrl, idempotencyKey: key });
      finishDelivery(key, { status: "SENT", providerMessageId: sent.providerMessageId });
      return { status: "SENT", provider_message_id: sent.providerMessageId, invoice_number: invoice.invoice_number };
    } catch (error) {
      finishDelivery(key, { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", errorCode: error.code || "EMAIL_DELIVERY_FAILED" });
      return { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", invoice_number: invoice.invoice_number };
    }
  }
  async function sendTicketDocuments({ eventId, ticketIds, deliveryType = "EVENT_FREE_TICKETS" }) {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(eventId);
    const tickets = db.prepare(`SELECT * FROM event_tickets WHERE event_id=? AND id IN (${(ticketIds || []).map(() => "?").join(",") || "NULL"}) ORDER BY ticket_sequence,id`).all(eventId, ...(ticketIds || []));
    if (!event || !tickets.length) return { status: "NOT_READY" };
    const first = tickets[0]; const key = `${deliveryType.toLowerCase()}:${first.id}`;
    beginDelivery({ eventKey: key, deliveryType, recipientEmail: first.contact_email, eventId, ticketId: first.id });
    const pdf = generateTicketFrontPdf(eventDocumentData(event, tickets));
    if (!validEmail(first.contact_email) || !transactionalEmail?.sendEventTicketDocuments) { finishDelivery(key, { status: "NOT_CONFIGURED", errorCode: "EMAIL_DELIVERY_NOT_CONFIGURED" }); return { status: "NOT_CONFIGURED" }; }
    try { const sent = await transactionalEmail.sendEventTicketDocuments({ to: first.contact_email, event, tickets, ticketPdf: pdf, language: "en", websiteBaseUrl, idempotencyKey: key }); finishDelivery(key, { status: "SENT", providerMessageId: sent.providerMessageId }); return { status: "SENT", provider_message_id: sent.providerMessageId }; }
    catch (error) { finishDelivery(key, { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", errorCode: error.code || "EMAIL_DELIVERY_FAILED" }); return { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED" }; }
  }
  function ticketPdfForTicket(ticketId, mode = "full") { const ticket=db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticketId);if(!ticket)throw Object.assign(new Error("TICKET_NOT_FOUND"),{status:404});const event=db.prepare("SELECT * FROM events WHERE id=?").get(ticket.event_id);if(!event)throw Object.assign(new Error("EVENT_NOT_FOUND"),{status:404});return ticketDocumentGenerator(mode)(eventDocumentData(event,[ticket])); }
  function ticketPdfForPayment(paymentId, mode = "full") { const payment=db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);if(!payment)throw Object.assign(new Error("EVENT_PAYMENT_NOT_FOUND"),{status:404});const event=db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);const tickets=db.prepare("SELECT * FROM event_tickets WHERE event_payment_id=? ORDER BY ticket_sequence,id").all(payment.id);if(!event||!tickets.length)throw Object.assign(new Error("EVENT_TICKETS_NOT_READY"),{status:404});return ticketDocumentGenerator(mode)(eventDocumentData(event,tickets)); }
  function generateTicketDocuments(ticketId, { mode = "full", userId = null } = {}) { const ticket=db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticketId);if(!ticket)throw Object.assign(new Error("TICKET_NOT_FOUND"),{status:404});const event=db.prepare("SELECT * FROM events WHERE id=?").get(ticket.event_id);if(!event)throw Object.assign(new Error("EVENT_NOT_FOUND"),{status:404});const normalized=String(mode||"full").toLowerCase();const document=persistTicketDocument(ticket,normalized.toUpperCase(),ticketDocumentGenerator(normalized)(eventDocumentData(event,[ticket])),userId);return {ticket_id:ticket.id,event_id:event.id,mode:normalized,...document}; }
  function ticketDocuments(ticketId) { return db.prepare("SELECT document_type,stored_path,generated_at,generated_by_user_id FROM event_ticket_documents WHERE ticket_id=? ORDER BY document_type").all(ticketId); }
  function invoicePdfForPayment(paymentId) { const payment=db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);if(!payment)throw Object.assign(new Error("EVENT_PAYMENT_NOT_FOUND"),{status:404});const event=db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);const tickets=db.prepare("SELECT * FROM event_tickets WHERE event_payment_id=? ORDER BY ticket_sequence,id").all(payment.id);if(!event||!tickets.length)throw Object.assign(new Error("EVENT_TICKETS_NOT_READY"),{status:404});const invoice=ensurePaymentInvoice(payment,event,tickets);return {pdf:businessInvoicePdf(invoice,payment.purchaser_name),invoice_number:invoice.invoice_number,stored_path:null}; }
  function invoicePdfForTicket(ticketId) { const ticket=db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticketId);if(!ticket)throw Object.assign(new Error("TICKET_NOT_FOUND"),{status:404});if(ticket.payment_status!=="PAID"||Number(ticket.price_cents||0)<=0)throw Object.assign(new Error("TICKET_INVOICE_REQUIRES_PAID_PRICE"),{status:409});const event=db.prepare("SELECT * FROM events WHERE id=?").get(ticket.event_id);if(!event)throw Object.assign(new Error("EVENT_NOT_FOUND"),{status:404});const invoice=ensureTicketInvoice(ticket,event,{status:"paid"});const pdf=businessInvoicePdf(invoice,ticket.buyer_name||ticket.attendee_name);const invoicePath=artifactPath("central-invoice",invoice.id);if(!fs.existsSync(invoicePath))fs.writeFileSync(invoicePath,pdf);return {pdf,invoice_number:invoice.invoice_number,stored_path:publicDocumentPath(invoicePath)}; }

  return Object.freeze({ companyData:()=>readCompanyData(db),sendPurchaseDocuments,sendTicketDocuments,ticketPdfForTicket,ticketPdfForPayment,generateTicketDocuments,ticketDocuments,invoicePdfForPayment,invoicePdfForTicket,deliveryRow,recordDelivery,ensureTicketInvoice,ensurePaymentInvoice,createEventRefundCreditMemo,
    onPaymentRecorded({paymentId}){const payment=db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);if(!payment)throw Object.assign(new Error("EVENT_PAYMENT_NOT_FOUND"),{status:404});const event=db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);const tickets=db.prepare("SELECT * FROM event_tickets WHERE event_payment_id=? ORDER BY ticket_sequence,id").all(payment.id);if(!event||!tickets.length)throw new Error("EVENT_TICKETS_NOT_READY");return ensurePaymentInvoice(payment,event,tickets);},
    async onPaymentFulfilled({paymentId}){return sendPurchaseDocuments(paymentId);},
    onPaymentRefunded({paymentId,refund}){const payment=db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);const event=payment&&db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);return payment&&event?createEventRefundCreditMemo(payment,event,refund):null;}
  });
}

function createInvoiceEngine({ db, balanceAccountFromPaymentMethod = () => "BANK" }) {
  function money(value) { const n = parseFinancialNumber(value); return Number.isFinite(n) ? roundFinancial(n) : 0; }
  function paymentMethod(value) {
    const raw = clean(value, 120);
    if (["NONE / INTERNAL", "NONE", "INTERNAL"].includes(raw.toUpperCase())) return "NONE / INTERNAL";
    return normalizePaymentMethod(value);
  }
  function nextNumber(direction, issueDate) {
    const year = String(issueDate || new Date().toISOString().slice(0, 10)).slice(0, 4);
    const prefix = direction === "payable" ? "VND" : "INV";
    const sequence = db.prepare(`INSERT INTO invoice_sequences(direction,sequence_year,last_number,updated_at) VALUES(?,?,1,CURRENT_TIMESTAMP)
      ON CONFLICT(direction,sequence_year) DO UPDATE SET last_number=invoice_sequences.last_number+1,updated_at=CURRENT_TIMESTAMP
      RETURNING last_number`).get(direction, year);
    return `${prefix}-${year}-${String(Number(sequence?.last_number || 1)).padStart(4, "0")}`;
  }
  function nextCreditMemoNumber(memoDate) {
    const year = String(memoDate || newYorkDateKey()).slice(0, 4);
    const sequence = db.prepare(`INSERT INTO credit_memo_sequences(sequence_year,last_number,updated_at) VALUES(?,1,CURRENT_TIMESTAMP)
      ON CONFLICT(sequence_year) DO UPDATE SET last_number=credit_memo_sequences.last_number+1,updated_at=CURRENT_TIMESTAMP
      RETURNING last_number`).get(year);
    return `CM-${year}-${String(Number(sequence?.last_number || 1)).padStart(4, "0")}`;
  }
  function ensureContractorPartner(job) {
    if (!job.assigned_user_id) return null;
    const linked = db.prepare(`SELECT p.* FROM partner_contractors pc JOIN partners p ON p.id=pc.partner_id WHERE pc.user_id=? AND p.status='active' ORDER BY p.created_at,p.id`).all(job.assigned_user_id);
    if (linked.length === 1) return linked[0];
    const problem = new Error(linked.length ? "DAILY_RATE_PARTNER_AMBIGUOUS" : "DAILY_RATE_PARTNER_REQUIRED");
    problem.status = 409;
    throw problem;
  }
  function createInvoice({ direction, issueDate, dueDate, partnerId = null, clientId = null, sourceType = "manual", sourceId = null, summary = "", taxRate = 0, currency = "USD", paymentMethod: method = null, paymentLinkUrl = null, notes = "", status = "issued", revenueRecognitionStatus = "RECOGNIZED", revenueRecognitionDate = null, deferredEventId = null, items = [] }) {
    if (sourceId) {
      const existing = db.prepare("SELECT * FROM invoices WHERE direction=? AND source_type=? AND source_id=? LIMIT 1").get(direction, sourceType, sourceId);
      if (existing) { const detail = invoiceDetail(existing.id); linkInvoiceSource(detail); return detail; }
    }
    const normalizedItems = (items || []).map((item, index) => {
      const quantity = Math.max(0.0001, Number(item.quantity || 1));
      const unitPrice = Math.max(0, money(item.unit_price));
      const itemMethodRaw = clean(item.payment_method, 120);
      const itemMethod = itemMethodRaw ? paymentMethod(itemMethodRaw) : null;
      if (itemMethodRaw && !itemMethod) throw Object.assign(new Error("INVALID_ITEM_PAYMENT_METHOD"), { status: 400 });
      const itemStatusRaw = clean(item.financial_status, 20).toLowerCase();
      const itemStatus = itemStatusRaw ? (["paid", "pending"].includes(itemStatusRaw) ? itemStatusRaw : null) : null;
      if (itemStatusRaw && !itemStatus) throw Object.assign(new Error("INVALID_ITEM_FINANCIAL_STATUS"), { status: 400 });
      return { description: clean(item.item_description || item.description || "Item", 1000), quantity, unit_price: unitPrice, total_price: money(item.total_price ?? quantity * unitPrice), line_type: ["material", "fee", "custom"].includes(item.line_type) ? item.line_type : "custom", sort_order: index, payment_method: itemMethod, financial_status: itemStatus };
    }).filter((item) => item.total_price >= 0);
    let subtotal = 0;
    for (const item of normalizedItems) subtotal = money(subtotal + item.total_price);
    // Do not allocate a number, insert a document or post a zero-value workflow.
    if (sourceType === "workflow" && !(subtotal > 0)) return null;
    const rate = Math.max(0, money(taxRate));
    const taxAmount = money(subtotal * rate / 100);
    const total = money(subtotal + taxAmount);
    const id = newId("BILL");
    const date = issueDate || newYorkDateKey();
    const number = nextNumber(direction, date);
    const normalizedMethod = paymentMethod(method);
    if (clean(method, 120) && !normalizedMethod) throw Object.assign(new Error("INVALID_PAYMENT_METHOD"), { status: 400, allowed: [...PAYMENT_METHODS, "NONE / INTERNAL"] });
    const recognitionStatus = String(revenueRecognitionStatus || "RECOGNIZED").toUpperCase() === "DEFERRED" ? "DEFERRED" : "RECOGNIZED";
    const recognitionDate = recognitionStatus === "RECOGNIZED" ? (revenueRecognitionDate || date) : null;
    db.prepare(`INSERT INTO invoices(id,direction,invoice_number,issue_date,due_date,partner_id,client_id,source_type,source_id,summary,subtotal,tax_rate,tax_amount,total_amount,currency,payment_method,payment_link_url,notes,status,revenue_recognition_status,revenue_recognition_date,deferred_event_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, direction, number, date, dueDate || date, partnerId, clientId, sourceType, sourceId, clean(summary, 2000), subtotal, rate, taxAmount, total, clean(currency || "USD", 3).toUpperCase(), normalizedMethod, normalizedMethod === "Payment Link" ? clean(paymentLinkUrl, 2000) || null : null, clean(notes, 5000) || null, status, recognitionStatus, recognitionDate, deferredEventId || null);
    if (status === "paid") db.prepare("UPDATE invoices SET paid_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    const insertItem = db.prepare("INSERT INTO invoice_items(id,invoice_id,item_description,quantity,unit_price,total_price,line_type,sort_order,payment_method,financial_status) VALUES(?,?,?,?,?,?,?,?,?,?)");
    normalizedItems.forEach((item) => insertItem.run(newId("BLI"), id, item.description, item.quantity, item.unit_price, item.total_price, item.line_type, item.sort_order, item.payment_method, item.financial_status));
    const created = invoiceDetail(id);
    linkInvoiceSource(created);
    return invoiceDetail(id);
  }
  function invoiceDetail(id) {
    const invoice = db.prepare(`SELECT i.*,
      c.name AS client_name,c.company AS client_company,c.address AS client_address,c.billing_address AS client_billing_address,c.tax_id AS client_tax_id,c.email AS client_email,c.phone AS client_phone,
      p.company_name AS partner_name,p.tax_id AS partner_tax_id,p.billing_address AS partner_billing_address,p.contact_person AS partner_contact_person,p.contact_email AS partner_contact_email,p.contact_phone AS partner_contact_phone,p.default_tax_rate AS partner_default_tax_rate
      FROM invoices i LEFT JOIN contacts c ON c.id=i.client_id LEFT JOIN partners p ON p.id=i.partner_id WHERE i.id=?`).get(id);
    if (!invoice) return null;
    const partnerCounterparty = Boolean(invoice.partner_id);
    return {
      ...invoice,
      counterparty_type: partnerCounterparty ? "partner" : "client",
      counterparty_name: partnerCounterparty ? (invoice.partner_name || "Partner") : (invoice.client_company || invoice.client_name || "Client"),
      counterparty_address: partnerCounterparty ? (invoice.partner_billing_address || "") : (invoice.client_billing_address || invoice.client_address || ""),
      counterparty_tax_id: partnerCounterparty ? (invoice.partner_tax_id || "") : (invoice.client_tax_id || ""),
      counterparty_contact: partnerCounterparty ? (invoice.partner_contact_person || "") : (invoice.client_name || ""),
      counterparty_email: partnerCounterparty ? (invoice.partner_contact_email || "") : (invoice.client_email || ""),
      counterparty_phone: partnerCounterparty ? (invoice.partner_contact_phone || "") : (invoice.client_phone || ""),
      items: db.prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order,id").all(id),
      credit_memos: db.prepare("SELECT * FROM invoice_credit_memos WHERE invoice_id=? ORDER BY memo_date,created_at,id").all(id)
    };
  }
  function recordAdjustment(before, after, reason, actor = {}) {
    if (!before || !after) return null;
    const normalizedReason = clean(reason, 2000);
    if (normalizedReason.length < 5) throw Object.assign(new Error("ADJUSTMENT_REASON_REQUIRED"), { status: 400, minimum_length: 5 });
    const adjustedAt = new Date();
    const p = newYorkParts(adjustedAt);
    const id = newId("IADJ");
    db.prepare(`INSERT INTO invoice_adjustments(id,invoice_id,reason,adjusted_by_user_id,adjusted_by_name,adjusted_at,adjusted_at_local,previous_values,new_values)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      id,
      before.id,
      normalizedReason,
      actor.id || null,
      actor.name || actor.email || actor.id || "SYSTEM",
      adjustedAt.toISOString(),
      `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}[America/New_York]`,
      JSON.stringify(before),
      JSON.stringify(after)
    );
    return db.prepare("SELECT * FROM invoice_adjustments WHERE id=?").get(id);
  }
  function linkInvoiceSource(invoice) {
    if (!invoice || invoice.direction !== "receivable" || !invoice.source_id) return;
    if (invoice.source_type === "job") {
      db.prepare(`UPDATE jobs SET billing_status='Billed',invoice_id=?,invoice_status='Invoiced',invoice_number=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(invoice.id, invoice.invoice_number, invoice.source_id);
    } else if (invoice.source_type === "workflow") {
      db.prepare(`UPDATE workflow_finance_sources SET billing_status='Billed',invoice_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(invoice.id, invoice.source_id);
    }
  }
  function resetInvoiceSource(invoice) {
    if (!invoice || !invoice.source_id) return;
    if (invoice.source_type === "job" && invoice.direction === "receivable") {
      db.prepare(`UPDATE jobs SET billing_status='Unbilled',invoice_id=NULL,invoice_status='Not invoiced',invoice_number=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(invoice.source_id);
    } else if (invoice.source_type === "workflow" && invoice.direction === "receivable") {
      db.prepare(`UPDATE workflow_finance_sources SET billing_status='Unbilled',invoice_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(invoice.source_id);
    }
  }
  function createCreditMemo({ invoiceId, eventId = null, memoType = "EVENT_REFUND", sourceType, sourceId, memoDate = newYorkDateKey(), reason, subtotalAmount = null, taxAmount = null, totalAmount = null, revenueEffectDate = undefined, cashEffect = true, accountingEffect = true, actor = {} }) {
    const normalizedReason = clean(reason, 2000);
    if (normalizedReason.length < 5) throw Object.assign(new Error("ADJUSTMENT_REASON_REQUIRED"), { status: 400, minimum_length: 5 });
    const normalizedSourceType = clean(sourceType || memoType, 80);
    const normalizedSourceId = clean(sourceId || invoiceId, 180);
    const existing = db.prepare("SELECT * FROM invoice_credit_memos WHERE source_type=? AND source_id=? LIMIT 1").get(normalizedSourceType, normalizedSourceId);
    if (existing) return existing;
    const invoice = invoiceDetail(invoiceId);
    if (!invoice) throw Object.assign(new Error("INVOICE_NOT_FOUND"), { status: 404 });
    let subtotal = subtotalAmount == null ? money(invoice.subtotal) : money(subtotalAmount);
    let tax = taxAmount == null ? money(invoice.tax_amount) : money(taxAmount);
    let total = totalAmount == null ? money(subtotal + tax) : money(totalAmount);
    if (totalAmount != null && subtotalAmount == null && taxAmount == null) {
      const invoiceTotal = money(invoice.total_amount);
      const ratio = invoiceTotal > 0 ? Math.min(1, total / invoiceTotal) : 0;
      subtotal = money(Number(invoice.subtotal || 0) * ratio);
      tax = money(total - subtotal);
    }
    const refunded = money(db.prepare("SELECT COALESCE(SUM(total_amount),0) AS total FROM invoice_credit_memos WHERE invoice_id=? AND memo_type='EVENT_REFUND' AND accounting_effect=1").get(invoice.id)?.total || 0);
    if (memoType === "EVENT_REFUND" && money(refunded + total) > money(invoice.total_amount)) throw Object.assign(new Error("REFUND_EXCEEDS_INVOICE_TOTAL"), { status: 409 });
    const recognized = String(invoice.revenue_recognition_status || "RECOGNIZED").toUpperCase() === "RECOGNIZED";
    const effectiveDate = revenueEffectDate === undefined ? (recognized ? memoDate : null) : (revenueEffectDate || null);
    const id = newId("CM");
    const memoNumber = nextCreditMemoNumber(memoDate);
    db.prepare(`INSERT INTO invoice_credit_memos(id,credit_memo_number,invoice_id,event_id,memo_type,source_type,source_id,memo_date,reason,subtotal_amount,tax_amount,total_amount,revenue_effect_date,cash_effect,accounting_effect,created_by_user_id,created_by_name)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, memoNumber, invoice.id, eventId || invoice.deferred_event_id || null, memoType, normalizedSourceType, normalizedSourceId, memoDate, normalizedReason, subtotal, tax, total, effectiveDate, cashEffect ? 1 : 0, accountingEffect ? 1 : 0, actor.id || null, actor.name || actor.email || actor.id || "SYSTEM");
    return db.prepare("SELECT * FROM invoice_credit_memos WHERE id=?").get(id);
  }
  function recognizeEventRevenue({ eventId, recognitionDate = newYorkDateKey(), actor = {} }) {
    const apply = () => {
      const invoices = db.prepare("SELECT id FROM invoices WHERE source_type='event' AND deferred_event_id=? AND status<>'void' AND revenue_recognition_status='DEFERRED'").all(eventId);
      if (!invoices.length) return { invoices: 0, credit_memos: 0, recognized_by: actor.id || actor.name || "SYSTEM" };
      let updatedInvoices = 0;
      let updatedMemos = 0;
      for (const row of invoices) {
        const before = invoiceDetail(row.id);
        updatedInvoices += db.prepare("UPDATE invoices SET revenue_recognition_status='RECOGNIZED',revenue_recognition_date=? WHERE id=? AND revenue_recognition_status='DEFERRED'").run(recognitionDate, row.id).changes;
        updatedMemos += db.prepare("UPDATE invoice_credit_memos SET revenue_effect_date=? WHERE invoice_id=? AND memo_type='EVENT_REFUND' AND accounting_effect=1 AND revenue_effect_date IS NULL").run(recognitionDate, row.id).changes;
        const after = invoiceDetail(row.id);
        recordAdjustment(before, after, "Event revenue recognized after completion", actor);
      }
      return { invoices: updatedInvoices, credit_memos: updatedMemos, recognized_by: actor.id || actor.name || "SYSTEM" };
    };
    return db.inTransaction ? apply() : db.transaction(apply)();
  }
  function postManualInvoiceLedger(invoice, actor = {}) {
    if (!invoice || invoice.source_type !== "manual" || invoice.status === "void") return null;
    const items = Array.isArray(invoice.items) ? invoice.items : db.prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order,id").all(invoice.id);
    const invoiceStatus = invoice.status === "paid" ? "paid" : "pending";
    const paidItems = items.filter((item) => (item.financial_status || invoiceStatus) === "paid");
    let paidSubtotal = 0;
    for (const item of paidItems) paidSubtotal = money(paidSubtotal + Number(item.total_price || 0));
    const paidAmount = money(paidSubtotal + money(paidSubtotal * Number(invoice.tax_rate || 0) / 100));
    const methods = [...new Set(paidItems.map((item) => paymentMethod(item.payment_method || invoice.payment_method)).filter((value) => value && value !== "NONE / INTERNAL"))];
    const effectiveMethod = methods.length === 1 ? methods[0] : paymentMethod(invoice.payment_method);
    const existing = db.prepare("SELECT * FROM financial_items WHERE source_type='MANUAL_INVOICE' AND source_id=? LIMIT 1").get(invoice.id);
    if (!(paidAmount > 0)) {
      if (existing) db.prepare("DELETE FROM financial_items WHERE id=?").run(existing.id);
      return null;
    }
    const mainType = invoice.direction === "payable" ? "EXPENSE" : "INCOME";
    const category = invoice.direction === "payable" ? "OTHER_OPERATING_EXPENSE" : "SERVICE_REVENUE";
    const description = `${invoice.notes || invoice.summary || ""}${paidItems.length !== items.length ? ` · ${paidItems.length}/${items.length} paid line(s)` : ""}`.trim();
    if (existing) {
      db.prepare(`UPDATE financial_items SET item_date=?,title=?,description=?,amount=?,main_type=?,category=?,payment_method=?,balance_account=?,client_id=?,created_by=? WHERE id=?`).run(
        invoice.issue_date, `${invoice.invoice_number} · ${invoice.counterparty_name || invoice.summary || "Manual invoice"}`, description, paidAmount, mainType, category, effectiveMethod || "", balanceAccountFromPaymentMethod(effectiveMethod || ""), invoice.client_id || null, actor.name || actor.id || existing.created_by || "System", existing.id
      );
      return db.prepare("SELECT * FROM financial_items WHERE id=?").get(existing.id);
    }
    const id = newId("FIN");
    db.prepare(`INSERT INTO financial_items(id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,client_id,source_type,source_id,created_by)
      VALUES(?,?,?,?,?,?,?,'ONE_TIME',?,?,?,?,?,?)`).run(id, invoice.issue_date, `${invoice.invoice_number} · ${invoice.counterparty_name || invoice.summary || "Manual invoice"}`, description, paidAmount, mainType, category, effectiveMethod || "", balanceAccountFromPaymentMethod(effectiveMethod || ""), invoice.client_id || null, "MANUAL_INVOICE", invoice.id, actor.name || actor.id || "System");
    return db.prepare("SELECT * FROM financial_items WHERE id=?").get(id);
  }
  function createJobInvoices({ job, actor = {}, now = new Date().toISOString(), entries = [] }) {
    const issueDate = String(now).slice(0, 10);
    const due = new Date(`${issueDate}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + 30);
    const method = paymentMethod(entries.find((entry) => entry.mainType !== "EXPENSE")?.paymentMethod || job.payment_method || null);
    const estimated = money(entries.find((entry) => entry.mainType !== "EXPENSE")?.amount ?? job.billed_amount ?? 0);
    const dailyRateAmount = Number(job.daily_rate_enabled || 0) === 1 ? money(job.daily_rate_allocated_amount) : 0;
    const extraCompensation = money(job.technician_extra_compensation || 0);
    const contractorTotal = money(dailyRateAmount + extraCompensation);
    if (estimated > 0 && !method) throw Object.assign(new Error("PAYMENT_METHOD_REQUIRED"), { status: 400 });
    const created = [];
    const receivableMethod = estimated > 0 ? method : "NONE / INTERNAL";
    const retiredWorkflowJob=Boolean(db.prepare("SELECT 1 FROM workflow_retired_calendar_jobs WHERE job_id=?").get(job.id));
    if(estimated > 0 || !retiredWorkflowJob) created.push(createInvoice({ direction: "receivable", issueDate, dueDate: due.toISOString().slice(0, 10), clientId: job.client_id || null, sourceType: "job", sourceId: job.id, summary: `Job completed: ${job.title || job.job_key || job.id}`, taxRate: 0, paymentMethod: receivableMethod, status: "issued", items: [{ item_description: job.title || "Completed service", quantity: 1, unit_price: estimated, line_type: "fee" }] }));
    if (contractorTotal > 0) {
      const partner = ensureContractorPartner(job);
      const contractorItems = [];
      if (dailyRateAmount > 0) contractorItems.push({ item_description: `Daily rate — ${job.title || job.job_key || job.id}`, quantity: 1, unit_price: dailyRateAmount, line_type: "fee" });
      if (extraCompensation > 0) contractorItems.push({ item_description: `Field-service compensation — ${job.title || job.job_key || job.id}`, quantity: 1, unit_price: extraCompensation, line_type: "fee" });
      created.push(createInvoice({ direction: "payable", issueDate, dueDate: issueDate, partnerId: partner?.id || null, sourceType: "job", sourceId: job.id, summary: `Technician compensation: ${job.assigned_to || job.assigned_user_id || "Contractor"}`, taxRate: partner?.default_tax_rate || 0, paymentMethod: null, status: "issued", items: contractorItems }));
    }
    return created;
  }
  function postWorkflowInvoiceLedger(invoice, actor = {}) {
    if (!invoice || invoice.direction !== "receivable" || invoice.source_type !== "workflow") return null;
    if (["draft", "void"].includes(String(invoice.status || "").toLowerCase())) return null;
    const sourceId = `WORKFLOW_INVOICE_REVENUE:${invoice.source_id}`;
    const existing = db.prepare("SELECT * FROM financial_items WHERE source_type='WORKFLOW_INVOICE_REVENUE' AND source_id=? LIMIT 1").get(sourceId);
    if (existing) return existing;
    if (!(Number(invoice.subtotal || 0) > 0)) return null;
    const id = newId("FI");
    db.prepare(`INSERT INTO financial_items(id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,job_id,client_id,piano_id,source_type,source_id,created_by)
      VALUES(?,?,?,?,?,'INCOME','SERVICE_REVENUE','ONE_TIME',?,?,?,?,?,?,?,?)`).run(
      id, invoice.issue_date, `Workshop invoice revenue: ${invoice.invoice_number}`, invoice.summary || "", Number(invoice.subtotal || 0), invoice.payment_method || "", balanceAccountFromPaymentMethod(invoice.payment_method || ""), null, invoice.client_id || null, null, "WORKFLOW_INVOICE_REVENUE", sourceId, actor.name || actor.id || "System"
    );
    return db.prepare("SELECT * FROM financial_items WHERE id=?").get(id);
  }

  function createWorkflowPayableInvoice({ workflow, stage = null, line, partner, actor = {}, now = new Date().toISOString() }) {
    if (!workflow || !line || !partner) throw Object.assign(new Error("WORKFLOW_PARTNER_PAYABLE_DATA_REQUIRED"), { status: 400 });
    if (!(money(line.amount) > 0)) return null;
    const issueDate = String(now).slice(0, 10);
    const invoice = createInvoice({
      direction: "payable", issueDate, dueDate: issueDate, partnerId: partner.id, sourceType: "workflow", sourceId: `WORKFLOW_LINE:${line.id}`,
      summary: `${stage?.name_snapshot_en || line.title || "Workflow phase"} · ${workflow.title || workflow.id}`, taxRate: Number(partner.default_tax_rate || 0),
      paymentMethod: null, status: "issued", items: [{ item_description: line.title || line.description || "Workflow partner cost", quantity: 1, unit_price: Number(line.amount || 0), line_type: "fee" }]
    });
    return invoice;
  }

  function createWorkflowInvoice({ workflow, stages = [], lines = [], actor = {}, now = new Date().toISOString(), paymentMethod: requestedPaymentMethod = null }) {
    const issueDate = String(now).slice(0, 10);
    const due = new Date(`${issueDate}T00:00:00Z`); due.setUTCDate(due.getUTCDate() + 30);
    const method = paymentMethod(requestedPaymentMethod);
    const phaseRows = (Array.isArray(stages) && stages.length ? stages : db.prepare("SELECT * FROM workflow_finance_phases WHERE workflow_id=? ORDER BY stage_order,id").all(workflow.id)).filter((stage) => stage.status !== "NOT_REQUIRED");
    const costLines = (lines || []).filter((row) => row.line_type === "COST" && String(row.accounting_status || "WIP") !== "WRITTEN_OFF");
    const items = phaseRows.map((stage) => {
      const phaseSubtotal = workflowBillablePhaseSubtotal(costLines.filter((row) => String(row.stage_id || "") === String(stage.id)));
      if (phaseSubtotal < 0) throw Object.assign(new Error("WORKFLOW_PHASE_CREDIT_EXCEEDS_CHARGEABLE_TOTAL"), { status: 409 });
      const phaseName = stage.name_snapshot_en || stage.card_title || stage.stage_code || `Phase ${Number(stage.stage_order || 0) + 1}`;
      return { item_description: `Phase ${Number(stage.stage_order || 0) + 1}: ${phaseName}`, quantity: 1, unit_price: phaseSubtotal, line_type: "fee" };
    }).filter((item) => money(item.unit_price) > 0);
    if (!items.length || !(money(items.reduce((sum,item)=>sum+item.unit_price,0)) > 0)) return null;
    if (!method) throw Object.assign(new Error("PAYMENT_METHOD_REQUIRED"), { status: 400 });
    return createInvoice({ direction: "receivable", issueDate, dueDate: due.toISOString().slice(0, 10), clientId: workflow.client_id, sourceType: "workflow", sourceId: workflow.id, summary: `Workshop workflow completed: ${workflow.title || workflow.id}`, taxRate: 0, paymentMethod: method, status: "draft", items });
  }
  function reverseLedger(invoice) {
    if (!invoice) return;
    if (invoice.source_type === "job") {
      if (invoice.direction === "receivable") db.prepare("DELETE FROM financial_items WHERE source_type='JOB_REVENUE' AND source_id=?").run(`JOB_REVENUE:${invoice.source_id}`);
      else {
        db.prepare("DELETE FROM financial_items WHERE source_type='DAILY_RATE' AND source_id=?").run(`DAILY_RATE:${invoice.source_id}`);
        db.prepare("DELETE FROM financial_items WHERE source_type='TECHNICIAN_EXTRA_COMPENSATION' AND source_id=?").run(`TECHNICIAN_EXTRA_COMPENSATION:${invoice.source_id}`);
      }
    } else if (invoice.source_type === "manual") {
      db.prepare("DELETE FROM financial_items WHERE source_type='MANUAL_INVOICE' AND source_id=?").run(invoice.id);
    } else if (invoice.source_type === "workflow" && invoice.direction === "receivable") {
      db.prepare("DELETE FROM financial_items WHERE source_type='WORKFLOW_INVOICE_REVENUE' AND source_id=?").run(`WORKFLOW_INVOICE_REVENUE:${invoice.source_id}`);
    }
  }
  return { createInvoice, invoiceDetail, createJobInvoices, createWorkflowInvoice, createWorkflowPayableInvoice, postWorkflowInvoiceLedger, createCreditMemo, recognizeEventRevenue, recordAdjustment, postManualInvoiceLedger, reverseLedger, linkInvoiceSource, resetInvoiceSource, paymentMethod };
}

function registerBusinessOperationsRoutes(options) {
  const { app, db, auth, permit, audit, transactionalEmail, websiteBaseUrl = "", uploadDir, env = process.env, documentService, ticketService: providedTicketService, customerConversationUpload, notifyUser, invoiceEngine } = options;
  const admin = permit("ADMIN");
  const financeReader = permit("ADMIN", "MANAGER");
  const helpdesk = permit("ADMIN", "MANAGER", "WORKER");
  const attendanceOperator = permit("ADMIN", "MANAGER", "WORKER");
  const ticketService = providedTicketService || createTicketService({ db });
  const conversationKey = conversationEncryptionKey(env);
  const recentRequests = new Map();
  function rateLimited(key, limit = 8, windowMs = 60000) {
    const now = Date.now();
    const values = (recentRequests.get(key) || []).filter((stamp) => now - stamp < windowMs);
    values.push(now); recentRequests.set(key, values);
    return values.length > limit;
  }
  function sendError(res, error, fallback = "BUSINESS_OPERATION_FAILED") {
    const code = clean(error?.message || fallback, 120);
    const payload = { error: code };
    if (error?.state) payload.state = error.state;
    res.status(Number(error?.status || (code.includes("NOT_FOUND") ? 404 : code.includes("ALREADY") || code.includes("CONFLICT") ? 409 : 400))).json(payload);
  }
  if (invoiceEngine) {
    const invoiceSelect = `SELECT i.*,c.name AS client_name,p.company_name AS partner_name,
      CASE WHEN i.partner_id IS NOT NULL THEN COALESCE(p.company_name,i.summary,'Partner') ELSE COALESCE(c.company,c.name,i.summary,'Client') END AS counterparty_name
      FROM invoices i LEFT JOIN contacts c ON c.id=i.client_id LEFT JOIN partners p ON p.id=i.partner_id`;
    function adjustmentStamp() {
      const adjustedAt = new Date();
      const p = newYorkParts(adjustedAt);
      return { adjustedAt, adjustedAtLocal: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}[America/New_York]` };
    }
    function recordAdjustment(before, after, reason, user) {
      const { adjustedAt, adjustedAtLocal } = adjustmentStamp();
      db.prepare(`INSERT INTO invoice_adjustments(id,invoice_id,reason,adjusted_by_user_id,adjusted_by_name,adjusted_at,adjusted_at_local,previous_values,new_values) VALUES(?,?,?,?,?,?,?,?,?)`).run(
        newId('IADJ'), before.id, reason, user?.id || null, user?.name || user?.email || user?.id || 'SYSTEM', adjustedAt.toISOString(), adjustedAtLocal, JSON.stringify(before), JSON.stringify(after)
      );
      return adjustedAt;
    }
    function financialPeriodClosedForDate(dateKey) {
      const value = String(dateKey || "");
      if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return false;
      try {
        return Boolean(db.prepare("SELECT 1 FROM financial_statement_snapshots WHERE period=? LIMIT 1").get(value.slice(0, 7)));
      } catch (_error) {
        return false;
      }
    }
    function rejectClosedInvoicePeriod(res, invoice) {
      if (!financialPeriodClosedForDate(invoice?.issue_date)) return false;
      res.status(409).json({
        error: "CLOSED_PERIOD_IMMUTABLE_USE_CURRENT_PERIOD_ADJUSTMENT",
        period: String(invoice.issue_date).slice(0, 7),
        message: "The invoice belongs to an officially closed financial period. Record any correction in the current open period instead of rewriting history."
      });
      return true;
    }
    function voidInvoiceRecord(before, reason, user) {
      if (before.status === 'void') return before;
      return db.transaction(() => {
        invoiceEngine.reverseLedger(before);
        invoiceEngine.createCreditMemo({
          invoiceId: before.id,
          eventId: before.deferred_event_id || null,
          memoType: 'VOID_REVERSAL',
          sourceType: 'INVOICE_VOID',
          sourceId: before.id,
          memoDate: newYorkDateKey(),
          reason,
          subtotalAmount: before.subtotal,
          taxAmount: before.tax_amount,
          totalAmount: before.total_amount,
          revenueEffectDate: null,
          cashEffect: false,
          accountingEffect: false,
          actor: user || {}
        });
        db.prepare("UPDATE invoices SET status='void',voided_at=CURRENT_TIMESTAMP,voided_by=?,archived_at=CURRENT_TIMESTAMP,archived_period=COALESCE(archived_period,substr(issue_date,1,7)) WHERE id=?")
          .run(user?.name || user?.email || user?.id || 'SYSTEM', before.id);
        const after = invoiceEngine.invoiceDetail(before.id);
        recordAdjustment(before, after, reason, user);
        return after;
      })();
    }
    scheduleInvoicePeriodClose(db);
    app.get("/api/invoices", auth, financeReader, (req, res) => {
      closeCompletedInvoicePeriods(db, new Date());
      const month = clean(req.query.month, 7), direction = clean(req.query.direction, 20), status = clean(req.query.status, 30), bucket = clean(req.query.bucket, 20).toLowerCase();
      const where = [], params = [];
      if (/^\d{4}-\d{2}$/.test(month)) { where.push("substr(i.issue_date,1,7)=?"); params.push(month); }
      if (["receivable","payable"].includes(direction)) { where.push("i.direction=?"); params.push(direction); }
      if (["draft","issued","paid","void","carried_over"].includes(status)) { where.push("i.status=?"); params.push(status); }
      if (bucket === "active") where.push("i.archived_at IS NULL AND i.status<>'void'");
      if (bucket === "archive") where.push("(i.archived_at IS NOT NULL OR i.status='void')");
      const rows = db.prepare(`${invoiceSelect}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY COALESCE(i.archived_at,i.issue_date) DESC,i.invoice_number DESC`).all(...params)
        .map((row) => ({ ...row, lifecycle_status: invoiceLifecycleStatus(row, new Date()) }));
      const accountingRows = rows.filter((row) => !["void","draft"].includes(String(row.status || "").toLowerCase()));
      const recognizedReceivables = accountingRows.filter((row) => row.direction === "receivable" && (row.source_type !== "event" || row.revenue_recognition_status === "RECOGNIZED"));
      const revenue = recognizedReceivables.reduce((sum,row)=>roundFinancial(sum+Number(row.subtotal||0)),0);
      const payables = accountingRows.filter((row) => row.direction === "payable").reduce((sum,row)=>roundFinancial(sum+Number(row.total_amount||0)),0);
      res.json({ invoices: rows, bucket: bucket || "all", summary: { revenue: roundFinancial(revenue), payables: roundFinancial(payables), net: roundFinancial(revenue - payables) } });
    });
    app.get("/api/invoice-counterparties", auth, admin, (_req, res) => {
      const partners = db.prepare(`SELECT id,company_name,tax_id,billing_address,contact_person,contact_email,contact_phone,default_tax_rate
        FROM partners WHERE status='active' ORDER BY lower(company_name),id`).all().map((row) => ({
          type: "partner", id: row.id, official_name: row.company_name, display_name: row.company_name, billing_address: row.billing_address || "", tax_id: row.tax_id || "",
          contact_person: row.contact_person || "", contact_email: row.contact_email || "", contact_phone: row.contact_phone || "", default_tax_rate: Number(row.default_tax_rate || 0)
        }));
      const clients = db.prepare(`SELECT id,name,company,email,phone,address,billing_address,tax_id FROM contacts WHERE COALESCE(status,'Active')<>'Inactive' ORDER BY lower(COALESCE(company,name)),lower(name),id`).all().map((row) => ({
          type: "client", id: row.id, official_name: row.company || row.name, display_name: row.company ? `${row.company} · ${row.name}` : row.name, billing_address: row.billing_address || row.address || "", tax_id: row.tax_id || "",
          contact_person: row.name || "", contact_email: row.email || "", contact_phone: row.phone || "", default_tax_rate: 0
        }));
      res.json({ partners, clients, all: [...partners, ...clients] });
    });
    app.post("/api/invoices/manual", auth, admin, (req, res) => {
      try {
        const direction = clean(req.body?.direction, 20);
        if (!["receivable", "payable"].includes(direction)) return res.status(400).json({ error: "INVALID_INVOICE_DIRECTION" });
        const explicitPartnerId = clean(req.body?.partner_id, 160);
        const explicitClientId = clean(req.body?.client_id, 160);
        const counterpartyType = clean(req.body?.counterparty_type, 20) || (explicitPartnerId ? "partner" : explicitClientId ? "client" : "");
        const counterpartyId = clean(req.body?.counterparty_id, 160) || (counterpartyType === "partner" ? explicitPartnerId : explicitClientId);
        if (!counterpartyId || !["partner", "client"].includes(counterpartyType)) return res.status(400).json({ error: "INVOICE_COUNTERPARTY_REQUIRED" });
        if ((counterpartyType === "partner" && explicitClientId) || (counterpartyType === "client" && explicitPartnerId)) return res.status(400).json({ error: "INVOICE_COUNTERPARTY_CONFLICT" });
        if (direction === "payable" && counterpartyType !== "partner") return res.status(400).json({ error: "PAYABLE_REQUIRES_PARTNER" });
        if (direction === "receivable" && counterpartyType !== "client") return res.status(400).json({ error: "RECEIVABLE_REQUIRES_CLIENT" });
        const partner = counterpartyType === "partner" ? db.prepare("SELECT * FROM partners WHERE id=? AND status='active'").get(counterpartyId) : null;
        const client = counterpartyType === "client" ? db.prepare("SELECT * FROM contacts WHERE id=?").get(counterpartyId) : null;
        if (counterpartyType === "partner" && !partner) return res.status(404).json({ error: "PARTNER_NOT_FOUND" });
        if (counterpartyType === "client" && !client) return res.status(404).json({ error: "CLIENT_NOT_FOUND" });
        const method = normalizePaymentMethod(req.body?.payment_method, { allowEmpty: false });
        if (!method) return res.status(400).json({ error: "INVALID_PAYMENT_METHOD", allowed: PAYMENT_METHODS });
        const paymentLinkUrl = clean(req.body?.payment_link_url, 2000);
        if (method === "Payment Link" && paymentLinkUrl && !/^https:\/\//i.test(paymentLinkUrl)) return res.status(400).json({ error: "PAYMENT_LINK_URL_INVALID" });
        const financialStatus = clean(req.body?.financial_status, 20).toLowerCase();
        if (!["paid", "pending"].includes(financialStatus)) return res.status(400).json({ error: "INVALID_FINANCIAL_STATUS" });
        const issueDate = clean(req.body?.issue_date, 10) || new Date().toISOString().slice(0, 10);
        const dueDate = clean(req.body?.due_date, 10) || issueDate;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ error: "INVALID_INVOICE_DATE" });
        if (financialPeriodClosedForDate(issueDate)) return res.status(409).json({ error: "CLOSED_PERIOD_IMMUTABLE_USE_CURRENT_PERIOD_ADJUSTMENT", period: issueDate.slice(0, 7) });
        if (financialStatus === "pending" && dueDate < issueDate) return res.status(400).json({ error: "DUE_DATE_BEFORE_ISSUE_DATE" });
        const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
        const items = rawItems.map((item) => {
          const itemMethodRaw = clean(item?.payment_method, 120);
          const itemMethod = itemMethodRaw ? normalizePaymentMethod(itemMethodRaw, { allowEmpty: false }) : null;
          const itemStatusRaw = clean(item?.financial_status, 20).toLowerCase();
          const itemStatus = itemStatusRaw || null;
          return { item_description: clean(item?.item_description || item?.description, 1000), quantity: parseFinancialNumber(item?.quantity), unit_price: parseFinancialNumber(item?.unit_price), line_type: "custom", payment_method: itemMethod, financial_status: itemStatus };
        });
        if (!items.length || items.some((item) => item.item_description.trim().length < 3 || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) return res.status(400).json({ error: "INVALID_INVOICE_ITEMS" });
        if (rawItems.some((item, index) => clean(item?.payment_method, 120) && !items[index].payment_method)) return res.status(400).json({ error: "INVALID_ITEM_PAYMENT_METHOD", allowed: PAYMENT_METHODS });
        if (items.some((item) => item.financial_status && !["paid", "pending"].includes(item.financial_status))) return res.status(400).json({ error: "INVALID_ITEM_FINANCIAL_STATUS" });
        const summary = clean(req.body?.summary, 2000);
        if (summary.trim().length < 3) return res.status(400).json({ error: "INVOICE_SUMMARY_TOO_SHORT" });
        const settledItems = items.map((item) => ({ ...item, financial_status: item.financial_status || financialStatus }));
        const invoiceStatus = settledItems.every((item) => item.financial_status === "paid") ? "paid" : "issued";
        const subtotal = roundFinancial(settledItems.reduce((sum, item) => sum + roundFinancial(item.quantity * item.unit_price), 0));
        if (!(subtotal > 0)) return res.status(400).json({ error: "INVOICE_TOTAL_REQUIRED" });
        const requestedRate = req.body?.tax_rate === undefined || req.body?.tax_rate === null || req.body?.tax_rate === "" ? parseFinancialNumber(partner?.default_tax_rate || 0) : parseFinancialNumber(req.body.tax_rate);
        if (!Number.isFinite(requestedRate) || requestedRate < 0) return res.status(400).json({ error: "INVALID_TAX_RATE" });
        const created = db.transaction(() => {
          const invoice = invoiceEngine.createInvoice({
            direction, issueDate, dueDate, partnerId: partner?.id || null, clientId: client?.id || null, sourceType: "manual", sourceId: null,
            summary, taxRate: requestedRate, currency: "USD",
            paymentMethod: method, paymentLinkUrl, notes: clean(req.body?.notes, 5000), status: invoiceStatus, items: settledItems
          });
          invoiceEngine.postManualInvoiceLedger(invoice, req.user);
          return invoiceEngine.invoiceDetail(invoice.id);
        })();
        audit(req, "CREATE", "invoices", created.id, null, created, 1, `Manual ${direction} created`, "FINANCIAL");
        res.status(201).json(created);
      } catch (error) { sendError(res, error); }
    });

    app.get("/api/invoices/unbilled-sources", auth, financeReader, (_req, res) => {
      const jobs = db.prepare(`SELECT id,title,client_name,start_time,planned_amount,payment_method FROM jobs WHERE status='Completed' AND COALESCE(billing_status,'Unbilled')='Unbilled' ORDER BY COALESCE(completed_at,start_time) DESC,id`).all().map((row) => ({ ...row, source_type: "job" }));
      const workflows = db.prepare(`SELECT id,title,client_id,final_due_at FROM workflow_finance_sources WHERE current_status='COMPLETED' AND COALESCE(billing_status,'Unbilled')='Unbilled' ORDER BY COALESCE(financial_closed_at,updated_at) DESC,id`).all().map((row) => ({ ...row, source_type: "workflow" }));
      res.json({ jobs, workflows, all: [...jobs, ...workflows] });
    });
    app.get("/api/invoices/:id", auth, financeReader, (req, res) => {
      const row = invoiceEngine.invoiceDetail(req.params.id);
      if (!row) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
      row.lifecycle_status = invoiceLifecycleStatus(row, new Date());
      row.adjustments = db.prepare("SELECT * FROM invoice_adjustments WHERE invoice_id=? ORDER BY adjusted_at DESC,id DESC").all(row.id);
      res.json(row);
    });
    app.patch("/api/invoices/:id", auth, admin, (req, res) => {
      try {
        const before = invoiceEngine.invoiceDetail(req.params.id);
        if (!before) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
        if (rejectClosedInvoicePeriod(res, before)) return;
        const reason = clean(req.body?.reason, 2000);
        if (reason.length < 5) return res.status(400).json({ error: "ADJUSTMENT_REASON_MIN_5" });
        const issueDate = clean(req.body?.issue_date ?? before.issue_date, 10);
        const dueDate = clean(req.body?.due_date ?? before.due_date, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ error: "INVALID_INVOICE_DATE" });
        const summary = clean(req.body?.summary ?? before.summary, 2000);
        if (summary.length < 3) return res.status(400).json({ error: "INVOICE_SUMMARY_TOO_SHORT" });
        const taxRate = req.body?.tax_rate === undefined ? Number(before.tax_rate || 0) : parseFinancialNumber(req.body.tax_rate);
        if (!Number.isFinite(taxRate) || taxRate < 0) return res.status(400).json({ error: "INVALID_TAX_RATE" });
        const requestedMethod = req.body?.payment_method === undefined ? before.payment_method : normalizePaymentMethod(req.body.payment_method, { allowEmpty: false });
        if (!requestedMethod) return res.status(400).json({ error: "INVALID_PAYMENT_METHOD", allowed: PAYMENT_METHODS });
        let nextStatus = before.status;
        if (before.status !== "void" && req.body?.financial_status !== undefined) {
          const financialStatus = clean(req.body.financial_status, 20).toLowerCase();
          if (!['paid','pending'].includes(financialStatus)) return res.status(400).json({ error: "INVALID_FINANCIAL_STATUS" });
          nextStatus = financialStatus === 'paid' ? 'paid' : 'issued';
        }
        const rawItems = Array.isArray(req.body?.items) ? req.body.items : before.items;
        const items = rawItems.map((item, index) => {
          const description = clean(item?.item_description || item?.description, 1000);
          const quantity = parseFinancialNumber(item?.quantity);
          const unitPrice = parseFinancialNumber(item?.unit_price);
          if (description.length < 3 || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) throw Object.assign(new Error("INVALID_INVOICE_ITEMS"), { status: 400 });
          const lineMethodRaw = clean(item?.payment_method, 120);
          const lineMethod = lineMethodRaw ? normalizePaymentMethod(lineMethodRaw, { allowEmpty: false }) : null;
          if (lineMethodRaw && !lineMethod) throw Object.assign(new Error("INVALID_ITEM_PAYMENT_METHOD"), { status: 400 });
          const lineStatusRaw = clean(item?.financial_status, 20).toLowerCase();
          const lineStatus = lineStatusRaw ? (['paid','pending'].includes(lineStatusRaw) ? lineStatusRaw : null) : null;
          if (lineStatusRaw && !lineStatus) throw Object.assign(new Error("INVALID_ITEM_FINANCIAL_STATUS"), { status: 400 });
          return { description, quantity, unit_price: roundFinancial(unitPrice), total_price: roundFinancial(quantity * unitPrice), line_type: ['material','fee','custom'].includes(item?.line_type) ? item.line_type : 'custom', sort_order:index, payment_method: lineMethod, financial_status: lineStatus };
        });
        const subtotal = roundFinancial(items.reduce((sum, item) => sum + item.total_price, 0));
        if (!(subtotal > 0)) return res.status(400).json({ error: "INVOICE_TOTAL_REQUIRED" });
        const taxAmount = roundFinancial(subtotal * taxRate / 100);
        const totalAmount = roundFinancial(subtotal + taxAmount);
        const adjustedAt = new Date();
        const adjustedAtLocalParts = newYorkParts(adjustedAt);
        const adjustedAtLocal = `${adjustedAtLocalParts.year}-${adjustedAtLocalParts.month}-${adjustedAtLocalParts.day}T${adjustedAtLocalParts.hour}:${adjustedAtLocalParts.minute}:${adjustedAtLocalParts.second}[America/New_York]`;
        const after = db.transaction(() => {
          if (before.source_type === 'manual') invoiceEngine.reverseLedger(before);
          db.prepare(`UPDATE invoices SET issue_date=?,due_date=?,summary=?,subtotal=?,tax_rate=?,tax_amount=?,total_amount=?,payment_method=?,notes=?,status=?,paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) ELSE NULL END,archived_at=CASE WHEN ?='paid' THEN archived_at ELSE NULL END,archived_period=CASE WHEN ?='paid' THEN archived_period ELSE NULL END WHERE id=?`).run(
            issueDate,dueDate,summary,subtotal,roundFinancial(taxRate),taxAmount,totalAmount,requestedMethod,clean(req.body?.notes ?? before.notes,5000)||null,nextStatus,nextStatus,nextStatus,nextStatus,before.id
          );
          db.prepare("DELETE FROM invoice_items WHERE invoice_id=?").run(before.id);
          const insert = db.prepare("INSERT INTO invoice_items(id,invoice_id,item_description,quantity,unit_price,total_price,line_type,sort_order,payment_method,financial_status) VALUES(?,?,?,?,?,?,?,?,?,?)");
          for (const item of items) insert.run(newId('BLI'),before.id,item.description,item.quantity,item.unit_price,item.total_price,item.line_type,item.sort_order,item.payment_method,item.financial_status);
          const updated = invoiceEngine.invoiceDetail(before.id);
          if (updated.source_type === 'manual') invoiceEngine.postManualInvoiceLedger(updated, req.user);
          db.prepare(`INSERT INTO invoice_adjustments(id,invoice_id,reason,adjusted_by_user_id,adjusted_by_name,adjusted_at,adjusted_at_local,previous_values,new_values) VALUES(?,?,?,?,?,?,?,?,?)`).run(
            newId('IADJ'),before.id,reason,req.user.id||null,req.user.name||req.user.email||req.user.id||'Unknown',adjustedAt.toISOString(),adjustedAtLocal,JSON.stringify(before),JSON.stringify(updated)
          );
          return updated;
        })();
        audit(req,'ADJUST','invoices',before.id,before,after,1,reason,'FINANCIAL');
        res.json({ ...after, lifecycle_status: invoiceLifecycleStatus(after, adjustedAt) });
      } catch (error) { sendError(res,error); }
    });
    app.post("/api/invoices/:id/issue", auth, admin, (req, res) => {
      try {
        const before = invoiceEngine.invoiceDetail(req.params.id);
        if (!before) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
        if (before.status !== "draft") return res.status(409).json({ error: "INVOICE_NOT_DRAFT" });
        if (financialPeriodClosedForDate(before.issue_date)) return res.status(409).json({ error: "CLOSED_PERIOD_IMMUTABLE_USE_CURRENT_PERIOD_ADJUSTMENT", period: String(before.issue_date).slice(0, 7) });
        const reason = clean(req.body?.reason, 1000) || "Workflow draft approved and issued";
        const after = db.transaction(() => {
          db.prepare("UPDATE invoices SET status='issued' WHERE id=? AND status='draft'").run(before.id);
          const updated = invoiceEngine.invoiceDetail(before.id);
          if (updated.source_type === "workflow") invoiceEngine.postWorkflowInvoiceLedger(updated, req.user);
          recordAdjustment(before, updated, reason, req.user);
          return updated;
        })();
        audit(req, "ISSUE", "invoices", before.id, before, after, 1, reason, "FINANCIAL");
        res.json({ ...after, lifecycle_status: invoiceLifecycleStatus(after, new Date()) });
      } catch (error) { sendError(res, error); }
    });

    app.post("/api/invoices/:id/status", auth, admin, (req, res) => {
      const before = invoiceEngine.invoiceDetail(req.params.id); if (!before) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
      const status = clean(req.body?.status, 30); if (!["issued","paid","carried_over"].includes(status)) return res.status(400).json({ error: "INVALID_INVOICE_STATUS" });
      const reason = clean(req.body?.reason, 1000); if (reason.length < 5) return res.status(400).json({ error: "ADJUSTMENT_REASON_REQUIRED", minimum_length: 5 });
      if (before.status === "void") return res.status(409).json({ error: "VOID_INVOICE_IMMUTABLE" });
      if (financialPeriodClosedForDate(before.issue_date) && status !== "paid") {
        return res.status(409).json({
          error: "CLOSED_PERIOD_IMMUTABLE_USE_CURRENT_PERIOD_ADJUSTMENT",
          period: String(before.issue_date).slice(0, 7),
          message: "Closed-period invoice content remains immutable. A carried receivable may still be settled in the current open period, but other historical status rewrites are prohibited."
        });
      }
      const after = db.transaction(() => {
        if (before.source_type === "manual" && before.status === "paid" && status !== "paid") invoiceEngine.reverseLedger(before);
        db.prepare("UPDATE invoices SET status=?,paid_at=CASE WHEN ?='paid' THEN COALESCE(paid_at,CURRENT_TIMESTAMP) ELSE NULL END,archived_at=CASE WHEN ?='paid' THEN archived_at ELSE NULL END,archived_period=CASE WHEN ?='paid' THEN archived_period ELSE NULL END WHERE id=?").run(status,status,status,status,before.id);
        const updated = invoiceEngine.invoiceDetail(before.id);
        if (updated.source_type === "manual") invoiceEngine.postManualInvoiceLedger(updated, req.user);
        recordAdjustment(before, updated, reason, req.user);
        return updated;
      })();
      audit(req, "ADJUST", "invoices", before.id, before, after, 1, reason, "FINANCIAL"); res.json(after);
    });
    app.post("/api/invoices/:id/void", auth, admin, (req, res) => {
      const before = invoiceEngine.invoiceDetail(req.params.id); if (!before) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
      if (rejectClosedInvoicePeriod(res, before)) return;
      const reason = clean(req.body?.reason, 1000); if (reason.length < 5) return res.status(400).json({ error: "ADJUSTMENT_REASON_REQUIRED", minimum_length: 5 });
      if (before.status === "void") return res.json(before);
      const after = voidInvoiceRecord(before, reason, req.user);
      audit(req, "VOID", "invoices", before.id, before, after, 1, reason, "FINANCIAL"); res.json(after);
    });
    app.delete("/api/invoices/:id", auth, admin, (req, res) => {
      if (req.user.role !== "SUPERADMIN") return res.status(403).json({ error: "SUPERADMIN_REQUIRED" });
      const before = invoiceEngine.invoiceDetail(req.params.id); if (!before) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
      if (rejectClosedInvoicePeriod(res, before)) return;
      const reason = clean(req.body?.reason, 1000); if (reason.length < 5) return res.status(400).json({ error: "ADJUSTMENT_REASON_REQUIRED", minimum_length: 5 });
      const after = voidInvoiceRecord(before, reason, req.user);
      audit(req, "VOID_INSTEAD_OF_DELETE", "invoices", before.id, before, after, 1, reason, "FINANCIAL");
      res.json({ ok: true, converted_to_void: true, invoice: after });
    });
    app.post("/api/invoices/rebill-source", auth, admin, (req, res) => {
      try {
        const sourceType = clean(req.body?.source_type, 20);
        const sourceId = clean(req.body?.source_id, 160);
        const method = normalizePaymentMethod(req.body?.payment_method, { allowEmpty: false });
        if (!method) return res.status(400).json({ error: "INVALID_PAYMENT_METHOD", allowed: PAYMENT_METHODS });
        let created = [];
        db.transaction(() => {
          if (sourceType === "job") {
            const job = db.prepare("SELECT * FROM jobs WHERE id=? AND status='Completed'").get(sourceId);
            if (!job) throw Object.assign(new Error("UNBILLED_JOB_NOT_FOUND"), { status: 404 });
            if (String(job.billing_status || "Unbilled") !== "Unbilled") throw Object.assign(new Error("SOURCE_ALREADY_BILLED"), { status: 409 });
            created = invoiceEngine.createJobInvoices({ job: { ...job, payment_method: method }, actor: req.user, now: new Date().toISOString(), entries: [] });
          } else if (sourceType === "workflow") {
            const workflow = db.prepare("SELECT * FROM workflow_finance_sources WHERE id=? AND current_status='COMPLETED'").get(sourceId);
            if (!workflow) throw Object.assign(new Error("UNBILLED_WORKFLOW_NOT_FOUND"), { status: 404 });
            if (String(workflow.billing_status || "Unbilled") !== "Unbilled") throw Object.assign(new Error("SOURCE_ALREADY_BILLED"), { status: 409 });
            const stages = db.prepare("SELECT * FROM workflow_finance_phases WHERE workflow_id=? ORDER BY stage_order,id").all(sourceId);
            const hasNewSource = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='wf2_workflows'").get() && db.prepare("SELECT 1 FROM wf2_workflows WHERE id=?").get(sourceId);
            const lines = hasNewSource
              ? db.prepare("SELECT c.*,p.id stage_id,'COST' line_type,c.charge_cents/100.0 amount,'RELEASED' accounting_status FROM wf2_costs c JOIN wf2_phases p ON p.id=c.phase_id WHERE p.workflow_id=? ORDER BY c.id").all(sourceId)
              : db.prepare("SELECT * FROM workflow_finance_lines WHERE workflow_id=? ORDER BY created_at,id").all(sourceId);
            created = [invoiceEngine.createWorkflowInvoice({ workflow, stages, lines, actor: req.user, now: new Date().toISOString(), paymentMethod: method })].filter(Boolean);
          } else {
            throw Object.assign(new Error("INVALID_INVOICE_SOURCE_TYPE"), { status: 400 });
          }
        })();
        audit(req, "REBILL", "invoices", sourceId, null, { source_type: sourceType, invoices: created.map((row) => row.invoice_number) }, created.length, "Unbilled source re-invoiced", "FINANCIAL");
        res.status(201).json({ ok: true, invoices: created });
      } catch (error) { sendError(res, error); }
    });

    app.post("/api/invoices/purge-all", auth, admin, (req, res) => {
      if (req.user.role !== "SUPERADMIN") return res.status(403).json({ error: "SUPERADMIN_REQUIRED" });
      audit(req, "BLOCKED_HARD_DELETE", "invoices", "ALL", null, null, 0, "Immutable financial records cannot be purged", "FINANCIAL");
      res.status(405).json({ error: "IMMUTABLE_FINANCIAL_RECORDS", message: "Issued financial documents cannot be physically deleted. Use Void with a documented adjustment reason." });
    });

    app.get("/api/invoices/:id/pdf", auth, financeReader, (req, res) => {
      const invoice = invoiceEngine.invoiceDetail(req.params.id); if (!invoice) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
      const company = readCompanyData(db); const logoPath = resolveCompanyLogoPath(company.logo_url, uploadDir);
      const pdf = generateBusinessInvoicePdf({ company, invoice, items: invoice.items, counterpartyName: invoice.counterparty_name, logoPath });
      res.type("application/pdf").set("Content-Disposition", `attachment; filename="${invoice.invoice_number}.pdf"`).send(pdf);
    });
    app.get("/api/invoices/monthly/report.pdf", auth, financeReader, (req, res) => {
      const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : new Date().toISOString().slice(0,7);
      const rows = db.prepare(`${invoiceSelect} WHERE substr(i.issue_date,1,7)=? AND i.status<>'void' ORDER BY i.issue_date,i.invoice_number`).all(month);
      const paid = rows.filter((row)=>row.status==='paid');
      const recognizedPaidRevenue = db.prepare(`${invoiceSelect} WHERE i.direction='receivable' AND i.status='paid' AND COALESCE(i.revenue_recognition_status,'RECOGNIZED')='RECOGNIZED' AND substr(COALESCE(i.revenue_recognition_date,i.issue_date),1,7)=? ORDER BY i.issue_date,i.invoice_number`).all(month);
      const grossNetRevenue = recognizedPaidRevenue.reduce((sum,row)=>roundFinancial(sum + Number(row.subtotal_amount||0)),0);
      const contraRevenue = Number(db.prepare(`SELECT COALESCE(SUM(cm.subtotal_amount),0) AS amount FROM invoice_credit_memos cm JOIN invoices i ON i.id=cm.invoice_id WHERE cm.accounting_effect=1 AND i.status<>'void' AND cm.revenue_effect_date IS NOT NULL AND substr(cm.revenue_effect_date,1,7)=?`).get(month)?.amount || 0);
      const revenue = roundFinancial(grossNetRevenue - contraRevenue);
      const costs = paid.filter((row)=>row.direction==='payable').reduce((sum,row)=>roundFinancial(sum+Number(row.total_amount||0)),0);
      const paidBreakdownRows = db.prepare(`SELECT payment_method,SUM(total_amount) AS amount FROM invoices WHERE substr(issue_date,1,7)=? AND status='paid' AND payment_method IS NOT NULL GROUP BY payment_method`).all(month);
      const paidByMethod = new Map(paidBreakdownRows.map((row) => [row.payment_method, Number(row.amount || 0)]));
      const breakdown = PAYMENT_METHODS.map((method) => ({ payment_method: method, amount: paidByMethod.get(method) || 0 }));
      const monthEnd = actualMonthEndDate(month);
      const carried = db.prepare(`${invoiceSelect} WHERE i.status IN ('issued','carried_over') AND COALESCE(i.due_date,'9999-12-31')<=? ORDER BY i.due_date,i.invoice_number`).all(monthEnd);
      const company = readCompanyData(db); const logoPath = resolveCompanyLogoPath(company.logo_url, uploadDir);
      const pdf = generateMonthlyInvoiceReportPdf({ company, month, summary:{ revenue, costs, net: revenue-costs }, paymentBreakdown: breakdown, carried, invoices: rows, logoPath });
      res.type("application/pdf").set("Content-Disposition", `attachment; filename="klavierhaus-monthly-financial-${month}.pdf"`).send(pdf);
    });

    app.get("/api/partners", auth, admin, (_req, res) => res.json(db.prepare(`SELECT p.*,COUNT(DISTINCT pc.id) AS contractor_count,COUNT(DISTINCT i.id) AS invoice_count FROM partners p LEFT JOIN partner_contractors pc ON pc.partner_id=p.id LEFT JOIN invoices i ON i.partner_id=p.id GROUP BY p.id ORDER BY lower(p.company_name),p.id`).all()));
    app.get("/api/partners/:id", auth, admin, (req, res) => {
      const partner = db.prepare("SELECT * FROM partners WHERE id=?").get(req.params.id); if (!partner) return res.status(404).json({error:"PARTNER_NOT_FOUND"});
      res.json({ ...partner, contractors: db.prepare(`SELECT pc.*,u.name AS user_name FROM partner_contractors pc LEFT JOIN users u ON u.id=pc.user_id WHERE pc.partner_id=? ORDER BY COALESCE(u.name,pc.worker_name)`).all(partner.id) });
    });
    app.post("/api/partners", auth, admin, (req, res) => {
      const companyName = clean(req.body?.company_name,300); if (!companyName) return res.status(400).json({error:"PARTNER_COMPANY_NAME_REQUIRED"});
      const id = newId("PTR"), parsedRate = parseFinancialNumber(req.body?.default_tax_rate ?? 0); if (!Number.isFinite(parsedRate) || parsedRate < 0) return res.status(400).json({error:"INVALID_TAX_RATE"}); const rate = roundFinancial(parsedRate);
      db.prepare(`INSERT INTO partners(id,company_name,tax_id,billing_address,contact_person,contact_email,contact_phone,default_tax_rate,status) VALUES(?,?,?,?,?,?,?,?,?)`).run(id,companyName,clean(req.body?.tax_id,120),clean(req.body?.billing_address,1000),clean(req.body?.contact_person,300),normalizeEmail(req.body?.contact_email),clean(req.body?.contact_phone,120),rate,req.body?.status==='inactive'?'inactive':'active');
      for(const userId of Array.isArray(req.body?.user_ids)?req.body.user_ids:[]) if(db.prepare("SELECT 1 FROM users WHERE id=?").get(userId)) db.prepare("INSERT INTO partner_contractors(id,partner_id,user_id,worker_name) VALUES(?,?,?,NULL)").run(newId("PC"),id,userId);
      const after=db.prepare("SELECT * FROM partners WHERE id=?").get(id); audit(req,"CREATE","partners",id,null,after,1,"Partner created","FINANCIAL"); res.status(201).json(after);
    });
    app.patch("/api/partners/:id", auth, admin, (req, res) => {
      const before=db.prepare("SELECT * FROM partners WHERE id=?").get(req.params.id); if(!before)return res.status(404).json({error:"PARTNER_NOT_FOUND"});
      const next={...before}; for(const key of ["company_name","tax_id","billing_address","contact_person","contact_email","contact_phone","status"]) if(Object.prototype.hasOwnProperty.call(req.body||{},key)) next[key]=key==='contact_email'?normalizeEmail(req.body[key]):clean(req.body[key],1000);
      if(Object.prototype.hasOwnProperty.call(req.body||{},"default_tax_rate")){const parsedRate=parseFinancialNumber(req.body.default_tax_rate);if(!Number.isFinite(parsedRate)||parsedRate<0)return res.status(400).json({error:"INVALID_TAX_RATE"});next.default_tax_rate=roundFinancial(parsedRate);}
      if(!next.company_name)return res.status(400).json({error:"PARTNER_COMPANY_NAME_REQUIRED"}); if(!["active","inactive"].includes(next.status))next.status="active";
      db.prepare(`UPDATE partners SET company_name=?,tax_id=?,billing_address=?,contact_person=?,contact_email=?,contact_phone=?,default_tax_rate=?,status=? WHERE id=?`).run(next.company_name,next.tax_id,next.billing_address,next.contact_person,next.contact_email,next.contact_phone,next.default_tax_rate,next.status,before.id);
      if(Array.isArray(req.body?.user_ids)){db.prepare("DELETE FROM partner_contractors WHERE partner_id=?").run(before.id); for(const userId of req.body.user_ids) if(db.prepare("SELECT 1 FROM users WHERE id=?").get(userId)) db.prepare("INSERT INTO partner_contractors(id,partner_id,user_id,worker_name) VALUES(?,?,?,NULL)").run(newId("PC"),before.id,userId);}
      const after=db.prepare("SELECT * FROM partners WHERE id=?").get(before.id); audit(req,"UPDATE","partners",before.id,before,after,1,"Partner updated","FINANCIAL"); res.json(after);
    });
    app.delete("/api/partners/:id", auth, admin, (req,res)=>{
      const before=db.prepare("SELECT * FROM partners WHERE id=?").get(req.params.id); if(!before)return res.status(404).json({error:"PARTNER_NOT_FOUND"});
      if(req.user.role!=="SUPERADMIN"){db.prepare("UPDATE partners SET status='inactive' WHERE id=?").run(before.id);return res.json({ok:true,status:"inactive"});}
      if(db.prepare("SELECT 1 FROM invoices WHERE partner_id=? LIMIT 1").get(before.id))return res.status(409).json({error:"PARTNER_HAS_INVOICES"});
      db.prepare("DELETE FROM partners WHERE id=?").run(before.id); audit(req,"HARD_DELETE","partners",before.id,before,null,1,"Partner permanently deleted","FINANCIAL");res.json({ok:true});
    });
  }

  function notifyAssignedStaff(conversation, message, assignedUserId = conversation.assigned_user_id) {
    if (!assignedUserId) return;
    const titleEn = conversation.category === "REFUND" ? "Customer refund conversation" : "New customer helpdesk case";
    const titleHu = conversation.category === "REFUND" ? "Ügyfél-visszatérítési beszélgetés" : "Új ügyfél-helpdesk ügy";
    const eventKey = `customer-conversation:${conversation.id}:${message.id}:${assignedUserId}`;
    try {
      if (typeof notifyUser === "function") {
        notifyUser({ recipientUserId: assignedUserId, type: "DIRECT_MESSAGE", titleEn, titleHu, bodyEn: `${conversation.name || "Guest"} wrote: ${message.body.slice(0, 240)}`, bodyHu: `${conversation.name || "Vendég"} írt: ${message.body.slice(0, 240)}`, customMessage: message.body.slice(0, 1000), metadata: { conversation_id: conversation.id }, eventKey });
      } else {
        db.prepare(`INSERT OR IGNORE INTO notifications(id,recipient_user_id,notification_type,title_en,title_hu,body_en,body_hu,custom_message,metadata_json,event_key)
          VALUES(?,?, 'DIRECT_MESSAGE',?,?,?,?,?,?,?)`).run(newId("NTF"), assignedUserId, titleEn, titleHu, `${conversation.name || "Guest"} wrote: ${message.body.slice(0, 240)}`, `${conversation.name || "Vendég"} írt: ${message.body.slice(0, 240)}`, message.body.slice(0, 1000), JSON.stringify({ conversation_id: conversation.id }), eventKey);
      }
    } catch (_error) { /* A notification must never block a customer message. */ }
  }
  function conversationPayload(row, includeMessages = false, scope = "admin", accessToken = "") {
    if (!row) return null;
    const assignee = row.assigned_user_id ? db.prepare("SELECT name FROM users WHERE id=?").get(row.assigned_user_id) : null;
    const unreadCount = Number(db.prepare("SELECT COUNT(*) AS count FROM customer_messages WHERE conversation_id=? AND direction='CUSTOMER' AND status='UNREAD'").get(row.id)?.count || 0);
    const payload = { id: row.id, name: row.name || "", email: row.email || "", language: row.language, category: row.category, category_label_en: CATEGORY_LABELS[row.category]?.[0] || row.category, category_label_hu: CATEGORY_LABELS[row.category]?.[1] || row.category, service_id: row.service_id, piano_id: row.piano_id, event_id: row.event_id, ticket_id: row.ticket_id, status: row.status, assigned_user_id: row.assigned_user_id, assigned_user_name: assignee?.name || null, assigned_role: row.assigned_role || assignee?.role || null, source_path: row.source_path, metadata: parseMetadata(row), last_message_at: row.last_message_at, last_activity_at: row.last_activity_at || row.last_message_at, closed_at: row.closed_at, auto_closed_at: row.auto_closed_at, closure_note: row.closure_note || "", reopen_reason: row.reopen_reason || "", unread_count: unreadCount, created_at: row.created_at, updated_at: row.updated_at };
    if (includeMessages) {
      payload.messages = db.prepare("SELECT id,direction,sender_name,sender_email,sender_user_id,body,status,created_at FROM customer_messages WHERE conversation_id=? ORDER BY created_at,id").all(row.id).map((message) => ({
        ...message,
        attachments: db.prepare("SELECT id,original_name,mime_type,file_size,created_at FROM customer_message_attachments WHERE message_id=? ORDER BY created_at,id").all(message.id).map((attachment) => ({ ...attachment, url: attachmentUrl(scope, scope === "public" ? (accessToken || decryptConversationToken(row.public_token_encrypted, conversationKey)) : row.id, attachment.id) }))
      }));
      if (scope === "admin") {
        payload.audit_events = db.prepare("SELECT id,event_type,actor_user_id,actor_name,actor_role,from_status,to_status,details,created_at FROM customer_conversation_events WHERE conversation_id=? ORDER BY created_at,id").all(row.id).map((event) => {
          let details = event.details;
          try { details = details ? JSON.parse(details) : null; } catch (_error) {}
          return { ...event, details };
        });
      }
    }
    return payload;
  }
  function conversationByToken(token) { return db.prepare("SELECT * FROM customer_conversations WHERE public_token_hash=?").get(tokenHash(token)); }
  function conversationById(id) { return db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(id); }
  function recordConversationEvent(conversationId, eventType, { actor = null, fromStatus = null, toStatus = null, details = null } = {}) {
    try {
      const serializedDetails = details == null ? null : typeof details === "string" ? clean(details, 4000) : JSON.stringify(details);
      db.prepare(`INSERT INTO customer_conversation_events(id,conversation_id,event_type,actor_user_id,actor_name,actor_role,from_status,to_status,details)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(newId("CEV"), conversationId, eventType, actor?.id || null, clean(actor?.name, 240) || null, clean(actor?.role, 40) || null, fromStatus || null, toStatus || null, serializedDetails);
    } catch (error) { console.warn("customer conversation event log failed:", error.message); }
  }
  function cleanupExpiredCustomerConversations() {
    const rows = db.prepare("SELECT id FROM customer_conversations WHERE datetime(created_at) < datetime('now', ?)").all(`-${CUSTOMER_RETENTION_YEARS} years`);
    if (!rows.length) return 0;
    const attachments = db.prepare("SELECT stored_name FROM customer_message_attachments WHERE conversation_id=?");
    const remove = db.transaction(() => {
      rows.forEach(({ id }) => {
        attachments.all(id).forEach(({ stored_name }) => { try { fs.unlinkSync(path.join(uploadDir || "", "customer-conversations", stored_name)); } catch (_error) {} });
        db.prepare("DELETE FROM customer_conversations WHERE id=?").run(id);
      });
    });
    remove();
    return rows.length;
  }
  function autoCloseInactiveCustomerConversations() {
    const rows = db.prepare("SELECT id,status FROM customer_conversations WHERE status <> 'CLOSED' AND datetime(COALESCE(last_activity_at,last_message_at,created_at)) < datetime('now','-5 minutes')").all();
    if (!rows.length) return 0;
    const close = db.prepare("UPDATE customer_conversations SET status='CLOSED',closed_at=CURRENT_TIMESTAMP,auto_closed_at=CURRENT_TIMESTAMP,closure_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'CLOSED'");
    rows.forEach(({ id, status }) => {
      close.run("Automatically closed after five minutes without a sent message.", id);
      recordConversationEvent(id, "AUTO_CLOSED", { actor: { name: "Klavierhaus Support", role: "SYSTEM" }, fromStatus: status, toStatus: "CLOSED", details: { reason: "five_minutes_without_sent_message" } });
    });
    return rows.length;
  }
  function saveConversationAttachments(files, conversationId, messageId) {
    const list = Array.isArray(files) ? files : [];
    if (list.length > CUSTOMER_ATTACHMENT_MAX_FILES) throw Object.assign(new Error("TOO_MANY_CUSTOMER_ATTACHMENTS"), { status: 400 });
    const rows = [];
    for (const file of list) {
      if (Number(file.size || 0) > CUSTOMER_ATTACHMENT_MAX_BYTES) throw Object.assign(new Error("CUSTOMER_ATTACHMENT_TOO_LARGE"), { status: 400 });
      const storedName = path.basename(file.filename || file.path || "");
      if (!storedName) throw Object.assign(new Error("CUSTOMER_ATTACHMENT_STORAGE_FAILED"), { status: 400 });
      const sourcePath = file.path || path.join(uploadDir || "", "customer-conversations", storedName);
      const buffer = fs.readFileSync(sourcePath);
      const row = { id: newId("ATT"), conversationId, messageId, storedName, originalName: clean(file.originalname, 320) || storedName, mimeType: clean(file.mimetype, 160) || "application/octet-stream", size: buffer.length, sha256: crypto.createHash("sha256").update(buffer).digest("hex") };
      db.prepare("INSERT INTO customer_message_attachments(id,conversation_id,message_id,stored_name,original_name,mime_type,file_size,sha256) VALUES(?,?,?,?,?,?,?,?)").run(row.id, row.conversationId, row.messageId, row.storedName, row.originalName, row.mimeType, row.size, row.sha256);
      rows.push(row);
    }
    return rows;
  }
  function removeUploadedFiles(files) {
    (Array.isArray(files) ? files : []).forEach((file) => { try { if (file.path) fs.unlinkSync(file.path); } catch (_error) {} });
  }
  function canViewConversation(user, row) {
    if (isSuperadmin(user) || user?.role === "ADMIN") return true;
    if (user?.role === "MANAGER") return row.assigned_user_id === user.id || ["SERVICE", "PIANO", "REPAIR"].includes(row.category);
    if (user?.role === "WORKER") return row.assigned_user_id === user.id || (row.assigned_role === "MANAGER" && ["TICKET", "TECHNICAL", "GENERAL"].includes(row.category));
    return false;
  }
  function canEditConversation(user, row) {
    return isSuperadmin(user) || user?.role === "ADMIN" || row.assigned_user_id === user?.id;
  }
  function normalizedStatus(value, fallback = "PENDING_STAFF") {
    const status = clean(value || fallback, 30).toUpperCase();
    if (status === "NEW") return "PENDING_STAFF";
    if (status === "IN_PROGRESS") return "OPEN";
    return status;
  }
  function listSupportHolidays(year) {
    const safeYear = Number(year) || new Date().getUTCFullYear();
    const keys = supportHolidayKeys(safeYear, true);
    const manual = manualSupportHolidayKeys(db, safeYear);
    const rows = [...keys].map((date) => ({ date, label_en: "System holiday", label_hu: "Rendszerünnep", enabled: manual.has(date) ? manual.get(date) : true, is_system: 1 }));
    manual.forEach((enabled, date) => { if (!rows.some((row) => row.date === date)) rows.push({ date, label_en: "Custom holiday", label_hu: "Egyedi ünnepnap", enabled, is_system: 0 }); });
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }
  cleanupExpiredCustomerConversations();
  const retentionTimer = setInterval(cleanupExpiredCustomerConversations, 60 * 60 * 1000);
  retentionTimer.unref?.();
  const inactivityTimer = setInterval(autoCloseInactiveCustomerConversations, 30 * 1000);
  inactivityTimer.unref?.();

  const attendanceHub = createAttendanceHub({
    getState(eventId) {
      const event = db.prepare("SELECT * FROM events WHERE id=?").get(eventId);
      return event ? attendanceState(db, event) : null;
    }
  });

  app.get("/api/settings/company-data", auth, admin, (_req, res) => res.json(documentService.companyData()));
  app.put("/api/settings/company-data", auth, admin, (req, res) => {
    try {
      const before = documentService.companyData();
      const after = saveCompanyData(db, { ...before, ...(req.body || {}) }, req.user.name || req.user.id);
      audit(req, "UPDATE", "company_data", "company", before, after, 1, "Company invoice data updated");
      res.json(after);
    } catch (error) { sendError(res, error); }
  });

  function sendPdf(res, pdf, filename) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.type("application/pdf").send(pdf);
  }

  function normalizeTicketVariant(value) {
    const key = clean(value, 40).toUpperCase().replace(/[- ]+/g, "_");
    return ({
      PUBLIC: "PUBLIC_PAID", PAID: "PUBLIC_PAID", PUBLIC_PAID: "PUBLIC_PAID", FREE: "PUBLIC_FREE", PUBLIC_FREE: "PUBLIC_FREE",
      VIP: "VIP", INVITATION: "INVITATION", COMPLIMENTARY: "COMPLIMENTARY", COMPLIMENTARY_TICKET: "COMPLIMENTARY",
      MANUAL: "MANUAL", ON_SITE: "ON_SITE", ON_SITE_PAYMENT: "ON_SITE"
    })[key] || key;
  }

  function recordManualTicketIncome(ticket, event, userName = "SYSTEM") {
    if (Number(ticket.price_cents || 0) <= 0) return null;
    const desiredStatus = ticket.payment_status === "PAID" ? "paid" : "issued";
    if (!documentService?.ensureTicketInvoice) throw Object.assign(new Error("EVENT_DOCUMENT_SERVICE_REQUIRED"), { status: 500 });
    const invoice = documentService.ensureTicketInvoice(ticket, event, { status: desiredStatus });
    db.prepare("DELETE FROM financial_items WHERE source_type='event_manual_ticket' AND source_id=?").run(ticket.id);
    return invoice;
  }

  app.get("/api/events/tickets/:id.pdf", auth, admin, (req, res) => {
    try { sendPdf(res, documentService.ticketPdfForTicket(req.params.id, "full"), `klavierhaus-ticket-${req.params.id}-full.pdf`); } catch (error) { sendError(res, error); }
  });
  app.get("/api/events/tickets/:id/front.pdf", auth, admin, (req, res) => {
    try { sendPdf(res, documentService.ticketPdfForTicket(req.params.id, "front"), `klavierhaus-ticket-${req.params.id}-front.pdf`); } catch (error) { sendError(res, error); }
  });
  app.get("/api/events/tickets/:id/back.pdf", auth, admin, (req, res) => {
    try { sendPdf(res, documentService.ticketPdfForTicket(req.params.id, "back"), `klavierhaus-ticket-${req.params.id}-back.pdf`); } catch (error) { sendError(res, error); }
  });
  app.get("/api/events/tickets/:id/full.pdf", auth, admin, (req, res) => {
    try { sendPdf(res, documentService.ticketPdfForTicket(req.params.id, "full"), `klavierhaus-ticket-${req.params.id}-full.pdf`); } catch (error) { sendError(res, error); }
  });
  app.post("/api/events/tickets/:id/documents", auth, admin, async (req, res) => {
    const ticket = db.prepare("SELECT t.*,e.status AS event_status FROM event_tickets t JOIN events e ON e.id=t.event_id WHERE t.id=?").get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    if (ticket.event_status === "CLOSED") return res.status(409).json({ error: "EVENT_ALREADY_CLOSED" });
    try {
      const mode = ["front", "back", "full"].includes(String(req.body?.mode || "full").toLowerCase()) ? String(req.body.mode || "full").toLowerCase() : "full";
      const document = documentService.generateTicketDocuments(ticket.id, { mode, userId: req.user.id });
      let email = { status: "NOT_REQUESTED" };
      if (req.body?.email_front === true) email = await documentService.sendTicketDocuments({ eventId: ticket.event_id, ticketIds: [ticket.id], deliveryType: "EVENT_MANUAL_TICKET" });
      res.json({ ok: true, document, email, ticket: db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticket.id) });
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/events/individual-tickets", auth, admin, async (req, res) => {
    const eventId = clean(req.body?.event_id, 160);
    const event = eventId ? db.prepare("SELECT * FROM events WHERE id=?").get(eventId) : null;
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    if (["CANCELLED", "CLOSED"].includes(event.status)) return res.status(409).json({ error: "EVENT_NOT_AVAILABLE" });
    const contactId = clean(req.body?.contact_id || req.body?.customer_id, 160) || null;
    const contact = contactId ? db.prepare("SELECT id,name,email FROM contacts WHERE id=?").get(contactId) : null;
    if (contactId && !contact) return res.status(404).json({ error: "CONTACT_NOT_FOUND" });
    const salutation = clean(req.body?.salutation, 30);
    const firstNames = clean(req.body?.first_names || req.body?.firstNames, 120);
    const surnames = clean(req.body?.surnames || req.body?.last_names || req.body?.lastNames, 120);
    const suffix = clean(req.body?.suffix, 30);
    const structuredName = [salutation, firstNames, surnames, suffix].filter(Boolean).join(" ");
    const attendeeName = clean(req.body?.attendee_name || req.body?.guest_name || req.body?.name || structuredName || contact?.name, 500);
    if (!attendeeName) return res.status(400).json({ error: "GUEST_NAME_REQUIRED" });
    const email = normalizeEmail(req.body?.contact_email || req.body?.email || contact?.email);
    if (email && !validEmail(email)) return res.status(400).json({ error: "CONTACT_EMAIL_INVALID" });
    const variant = normalizeTicketVariant(req.body?.ticket_variant || req.body?.ticket_type || req.body?.type || "PUBLIC_PAID");
    const allowedVariants = ["PUBLIC_PAID", "PUBLIC_FREE", "VIP", "INVITATION", "COMPLIMENTARY", "MANUAL", "ON_SITE"];
    if (!allowedVariants.includes(variant)) return res.status(400).json({ error: "INVALID_TICKET_VARIANT" });
    const specialVariant = ["VIP", "INVITATION", "COMPLIMENTARY"].includes(variant);
    const requestedPrice = Number(req.body?.price_cents ?? (variant === "PUBLIC_PAID" || variant === "ON_SITE" ? event.price_cents : 0));
    const priceCents = specialVariant || variant === "PUBLIC_FREE" ? 0 : requestedPrice;
    if (!Number.isInteger(priceCents) || priceCents < 0) return res.status(400).json({ error: "INVALID_TICKET_PRICE" });
    const requestedPayment = clean(req.body?.payment_status, 30).toUpperCase();
    const paymentMethod = priceCents > 0 ? normalizePaymentMethod(req.body?.payment_method, { allowEmpty: false }) : null;
    if (priceCents > 0 && !paymentMethod) return res.status(400).json({ error: "INVALID_PAYMENT_METHOD", allowed: PAYMENT_METHODS });
    const paymentStatus = requestedPayment || ((priceCents > 0 && variant !== "ON_SITE" && paymentMethod) ? "PAID" : priceCents === 0 ? "NOT_REQUIRED" : "PENDING");
    if (!["PAID", "PENDING", "NOT_REQUIRED"].includes(paymentStatus)) return res.status(400).json({ error: "INVALID_PAYMENT_STATUS" });
    if (paymentStatus === "PAID" && priceCents <= 0) return res.status(400).json({ error: "FREE_TICKET_CANNOT_BE_PAID" });
    if (variant === "ON_SITE" && paymentStatus === "PENDING" && !event.start_at) return res.status(400).json({ error: "EVENT_START_REQUIRED" });
    try {
      const ticket = db.transaction(() => {
        const created = ticketService.createTicket({
          eventId, ticketVariant: variant, sourceType: variant === "INVITATION" ? "INVITATION" : variant === "PUBLIC_PAID" || variant === "ON_SITE" ? "PURCHASE" : "COMPLIMENTARY",
          invitationId: clean(req.body?.invitation_id, 160) || null, contactId, buyerName: clean(req.body?.buyer_name || contact?.name || attendeeName, 500), attendeeName,
          originalGuestName: attendeeName, salutation, firstNames, surnames, suffix, contactEmail: email, priceCents, currency: event.currency || "USD", paymentMethod,
          paymentStatus, reservationStatus: clean(req.body?.reservation_status, 30).toUpperCase() || undefined, userId: req.user.id
        });
        recordManualTicketIncome(created, event, req.user.name || req.user.id);
        return created;
      })();
      const documents = variant === "ON_SITE" && paymentStatus !== "PAID"
        ? []
        : ["front", "back", "full"].map((mode) => documentService.generateTicketDocuments(ticket.id, { mode, userId: req.user.id }));
      const invoice = paymentStatus === "PAID" && priceCents > 0 ? documentService.invoicePdfForTicket(ticket.id) : null;
      let emailDelivery = { status: "NOT_REQUESTED" };
      if (documents.length && (req.body?.send_email === true || req.body?.send_email === "true" || req.body?.send_email === 1 || req.body?.send_email === "1")) {
        emailDelivery = await documentService.sendTicketDocuments({ eventId, ticketIds: [ticket.id], deliveryType: "EVENT_INDIVIDUAL_TICKET" });
      } else if (!documents.length && (req.body?.send_email === true || req.body?.send_email === "true" || req.body?.send_email === 1 || req.body?.send_email === "1")) {
        emailDelivery = { status: "NOT_AVAILABLE_UNPAID" };
      }
      const after = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticket.id);
      audit(req, "CREATE_INDIVIDUAL_TICKET", "event_tickets", ticket.id, null, after, 1, `Individual ${variant} ticket created`);
      res.status(201).json({ ok: true, ticket: after, documents, invoice: invoice ? { invoice_number: invoice.invoice_number, stored_path: invoice.stored_path } : null, email: emailDelivery });
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/events/tickets/:id/pay", auth, admin, async (req, res) => {
    const ticket = db.prepare("SELECT t.*,e.status AS event_status FROM event_tickets t JOIN events e ON e.id=t.event_id WHERE t.id=?").get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    if (ticket.event_status === "CLOSED") return res.status(409).json({ error: "EVENT_ALREADY_CLOSED" });
    if (ticket.event_status === "CANCELLED") return res.status(409).json({ error: "EVENT_NOT_AVAILABLE" });
    if (!["ON_SITE", "PUBLIC_PAID"].includes(ticket.ticket_variant)) return res.status(400).json({ error: "TICKET_VARIANT_NOT_PAYABLE_HERE" });
    if (Number(ticket.price_cents || 0) <= 0) return res.status(400).json({ error: "TICKET_PRICE_REQUIRED" });
    try {
      const paymentMethod = normalizePaymentMethod(req.body?.payment_method || ticket.payment_method || "Cash", { allowEmpty: false });
      if (!paymentMethod) return res.status(400).json({ error: "INVALID_PAYMENT_METHOD", allowed: PAYMENT_METHODS });
      const paid = db.transaction(() => {
        const updated = ticketService.markPaid(ticket.id, { paymentMethod });
        recordManualTicketIncome(updated, db.prepare("SELECT * FROM events WHERE id=?").get(updated.event_id), req.user.name || req.user.id);
        return updated;
      })();
      const documents = ["front", "back", "full"].map((mode) => documentService.generateTicketDocuments(paid.id, { mode, userId: req.user.id }));
      const invoice = documentService.invoicePdfForTicket(paid.id);
      let email = { status: "NOT_REQUESTED" };
      if (req.body?.send_email === true || req.body?.send_email === "true" || req.body?.send_email === 1 || req.body?.send_email === "1") {
        email = await documentService.sendTicketDocuments({ eventId: paid.event_id, ticketIds: [paid.id], deliveryType: ticket.ticket_variant === "ON_SITE" ? "EVENT_ON_SITE_TICKET" : "EVENT_PUBLIC_PAID_TICKET" });
      }
      const after = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(paid.id);
      audit(req, "MARK_EVENT_TICKET_PAID", "event_tickets", paid.id, ticket, after, 1, `${ticket.ticket_variant} ticket paid and finalized`);
      res.json({ ok: true, ticket: after, documents, invoice: { invoice_number: invoice.invoice_number, stored_path: invoice.stored_path }, email });
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/events/tickets/:id/invoice.pdf", auth, admin, (req, res) => {
    try {
      const invoice = documentService.invoicePdfForTicket(req.params.id);
      sendPdf(res, invoice.pdf, `klavierhaus-invoice-${invoice.invoice_number}.pdf`);
    } catch (error) { sendError(res, error); }
  });
  app.get("/api/event-payments/:id/tickets.pdf", auth, admin, (req, res) => {
    try { sendPdf(res, documentService.ticketPdfForPayment(req.params.id, "full"), `klavierhaus-tickets-${req.params.id}-full.pdf`); } catch (error) { sendError(res, error); }
  });
  app.get("/api/event-payments/:id/tickets/front.pdf", auth, admin, (req, res) => {
    try { sendPdf(res, documentService.ticketPdfForPayment(req.params.id, "front"), `klavierhaus-tickets-${req.params.id}-front.pdf`); } catch (error) { sendError(res, error); }
  });
  app.get("/api/event-payments/:id/tickets/back.pdf", auth, admin, (req, res) => {
    try { sendPdf(res, documentService.ticketPdfForPayment(req.params.id, "back"), `klavierhaus-tickets-${req.params.id}-back.pdf`); } catch (error) { sendError(res, error); }
  });
  app.get("/api/event-payments/:id/tickets/full.pdf", auth, admin, (req, res) => {
    try { sendPdf(res, documentService.ticketPdfForPayment(req.params.id, "full"), `klavierhaus-tickets-${req.params.id}-full.pdf`); } catch (error) { sendError(res, error); }
  });
  app.get("/api/event-payments/:id/invoice.pdf", auth, admin, (req, res) => {
    try { const invoice = documentService.invoicePdfForPayment(req.params.id); sendPdf(res, invoice.pdf, `klavierhaus-invoice-${invoice.invoice_number}.pdf`); } catch (error) { sendError(res, error); }
  });
  app.post("/api/event-payments/:id/invoice/resend", auth, admin, async (req, res) => {
    try { res.json(await documentService.sendPurchaseDocuments(req.params.id, { resend: true })); } catch (error) { sendError(res, error); }
  });

  app.get("/api/guest-data", auth, admin, (req, res) => {
    try {
      const data = readGuestData(db, {
        search: clean(req.query.search, 160),
        eventId: clean(req.query.event_id, 160)
      });
      res.setHeader("Cache-Control", "private, no-store");
      res.json(data);
    } catch (error) { sendError(res, error, "GUEST_DATA_LOAD_FAILED"); }
  });

  app.get("/api/guest-data.pdf", auth, admin, (req, res) => {
    try {
      const data = readGuestData(db, {
        search: clean(req.query.search, 160),
        eventId: clean(req.query.event_id, 160)
      });
      const language = req.query.lang === "hu" ? "hu" : "en";
      const company = readCompanyData(db);
      const pdf = generateGuestDataPdf({
        guests: data.guests,
        language,
        logoPath: resolveCompanyLogoPath(company.logo_url, uploadDir)
      });
      sendPdf(res, pdf, `klavierhaus-guest-data-${language}.pdf`);
    } catch (error) { sendError(res, error, "GUEST_DATA_PDF_FAILED"); }
  });

  app.get("/api/events/:id/attendance", auth, attendanceOperator, (req, res) => {
    const event = db.prepare("SELECT id,event_key,custom_type,title_en,title_hu,start_at,end_at,status,capacity_total,currency,venue_name,timezone FROM events WHERE id=?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    res.json(attendanceState(db, event, clean(req.query.q, 160)));
  });

  app.post("/api/events/:id/attendance/mode", auth, attendanceOperator, (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    try {
      const before = ensureSession(db, event.id, req.user.id);
      const session = startMode(db, event, req.body?.mode, req.user);
      audit(req, "ATTENDANCE_MODE", "event_attendance", event.id, before, session, 1, "Attendance mode changed");
      const current = attendanceState(db, event);
      attendanceHub.publish(event.id, current);
      res.json(current);
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/events/:id/attendance/stream", auth, attendanceOperator, (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");
    const unsubscribe = attendanceHub.subscribe(event.id, res, attendanceState(db, event));
    req.on("close", unsubscribe);
  });

  app.post("/api/events/:id/attendance/pause", auth, attendanceOperator, (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    try {
      const before = ensureSession(db, event.id, req.user.id);
      const session = pauseAttendance(db, event, req.user);
      audit(req, "ATTENDANCE_PAUSE", "event_attendance", event.id, before, session, 1, "Digital attendance input paused");
      const current = attendanceState(db, event);
      attendanceHub.publish(event.id, current);
      res.json(current);
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/events/:id/attendance/resume", auth, attendanceOperator, (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    try {
      const before = ensureSession(db, event.id, req.user.id);
      const session = resumeAttendance(db, event, req.user);
      audit(req, "ATTENDANCE_RESUME", "event_attendance", event.id, before, session, 1, "Digital attendance input resumed");
      const current = attendanceState(db, event);
      attendanceHub.publish(event.id, current);
      res.json(current);
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/events/:id/attendance/reopen", auth, admin, (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    try {
      const before = ensureSession(db, event.id, req.user.id);
      const session = reopenAttendance(db, event, req.user);
      audit(req, "ATTENDANCE_REOPEN", "event_attendance", event.id, before, session, 1, "Attendance list reopened by administrator");
      const current = attendanceState(db, event);
      attendanceHub.publish(event.id, current);
      res.json(current);
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/events/tickets/:id/check-in", auth, attendanceOperator, (req, res) => {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(ticket.event_id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    try {
      const result = changeGuestStatus(db, event, ticket, req.body?.checked_in === false ? "NOT_ARRIVED" : "PRESENT", req.user, { expectedRevision: req.body?.expected_revision });
      audit(req, result.attendance_status === "PRESENT" ? "CHECK_IN" : "CHECK_IN_REVERT", "event_attendance", ticket.id, ticket, result, 1, "Digital attendance status changed");
      const current = attendanceState(db, event);
      attendanceHub.publish(event.id, current);
      res.json({ ...result, checked_in: result.attendance_status === "PRESENT", state: current });
    } catch (error) {
      if (error?.message === "ATTENDANCE_CONFLICT") error.state = attendanceState(db, event);
      sendError(res, error);
    }
  });

  app.post("/api/events/tickets/:id/attendance-status", auth, attendanceOperator, (req, res) => {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(ticket.event_id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    try {
      const result = changeGuestStatus(db, event, ticket, req.body?.status, req.user, { expectedRevision: req.body?.expected_revision });
      audit(req, req.body?.status === "DELETED" ? "GUEST_DELETE" : "ATTENDANCE_STATUS", "event_attendance", ticket.id, ticket, result, 1, "Digital attendance guest status changed");
      const current = attendanceState(db, event);
      attendanceHub.publish(event.id, current);
      res.json({ ...result, state: current });
    } catch (error) {
      if (error?.message === "ATTENDANCE_CONFLICT") error.state = attendanceState(db, event);
      sendError(res, error);
    }
  });

  app.post("/api/events/:id/attendance/close", auth, admin, (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    try {
      const before = ensureSession(db, event.id, req.user.id);
      const report = closeAttendance(db, event, req.user, Boolean(req.body?.force));
      audit(req, "ATTENDANCE_CLOSE", "event_attendance", event.id, before, report, 1, "Digital guest list finalized");
      attendanceHub.publish(event.id, attendanceState(db, event));
      res.json(report);
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/events/:id/attendance-report", auth, attendanceOperator, (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    const session = ensureSession(db, event.id, req.user.id);
    if (!session.snapshot_json) return res.status(404).json({ error: "ATTENDANCE_REPORT_NOT_FOUND" });
    res.json(JSON.parse(session.snapshot_json));
  });

  app.post("/api/events/tickets/:id/void", auth, admin, (req, res) => {
    const ticket = db.prepare("SELECT t.*,e.status AS event_status FROM event_tickets t JOIN events e ON e.id=t.event_id WHERE t.id=?").get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    if (ticket.event_status === "CLOSED") return res.status(409).json({ error: "EVENT_ALREADY_CLOSED" });
    if (ticket.event_status === "CANCELLED") return res.status(409).json({ error: "EVENT_NOT_AVAILABLE" });
    if (ticket.source_type === "PURCHASE" && ticket.ticket_variant !== "ON_SITE") return res.status(409).json({ error: "PURCHASE_TICKET_REQUIRES_REFUND" });
    if (["VOID", "REFUNDED"].includes(ticket.status)) return res.json({ ...ticket, already_void: true });
    if (ticket.status === "USED") return res.status(409).json({ error: "CHECKED_IN_TICKET_CANNOT_BE_VOIDED" });
    db.prepare("UPDATE event_tickets SET status='VOID',voided_at=CURRENT_TIMESTAMP,voided_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, ticket.id);
    if (ticket.invitation_id) db.prepare("UPDATE event_invitations SET status='REVOKED',revoked_at=CURRENT_TIMESTAMP,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, ticket.invitation_id);
    const after = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticket.id);
    audit(req, "VOID_TICKET", "event_tickets", ticket.id, ticket, after, 1, "Complementary or invitation ticket voided");
    res.json(after);
  });

  app.get("/api/event-payments/:id/documents", auth, admin, (req, res) => {
    const payment = db.prepare("SELECT id,event_id,status,purchaser_name,purchaser_email,amount_total,currency,invoice_id FROM event_payments WHERE id=?").get(req.params.id);
    if (!payment) return res.status(404).json({ error: "EVENT_PAYMENT_NOT_FOUND" });
    const invoice = payment.invoice_id ? invoiceEngine.invoiceDetail(payment.invoice_id) : null;
    res.json({ payment, delivery: documentService.deliveryRow(`event-purchase-documents:${payment.id}`), invoice });
  });
  app.post("/api/event-payments/:id/documents/resend", auth, admin, async (req, res) => {
    try { res.json(await documentService.sendPurchaseDocuments(req.params.id, { resend: true })); } catch (error) { sendError(res, error); }
  });

  function autoReplyText(name, language) {
    return language === "hu"
      ? `Köszönjük, hogy felvette a kapcsolatot a Klavierhaus csapatával, ${name || "Ügyfelünk"}. Ügyfélszolgálatunk New York-i idő szerint hétfőtől péntekig 09:00 és 17:00 között működik. Üzenetét megkaptuk, és a következő munkanapon feldolgozzuk.`
      : `Thank you for contacting Klavierhaus, ${name || "our guest"}. Our support hours are Monday through Friday, 9:00 AM–5:00 PM New York time. We received your message and will process it on the next business day.`;
  }
  function publicConversationUrl(rawToken) { return `${String(websiteBaseUrl).replace(/\/$/, "")}/contact?conversation=${encodeURIComponent(rawToken)}`; }
  function validateConversationRequest(body) {
    const name = clean(body?.name, 200);
    const email = normalizeEmail(body?.email);
    const message = clean(body?.message, 5000);
    const category = clean(body?.category || "GENERAL", 40).toUpperCase();
    const consentContact = body?.consent_contact === true || ["true", "1", "on"].includes(String(body?.consent_contact || "").toLowerCase());
    if (!message || !CONVERSATION_CATEGORIES.has(category) || !consentContact) throw Object.assign(new Error("VALID_CONVERSATION_FIELDS_REQUIRED"), { status: 400 });
    if (email && !validEmail(email)) throw Object.assign(new Error("INVALID_CONVERSATION_EMAIL"), { status: 400 });
    if (requiresConversationIdentity(category) && (!name || !validEmail(email))) throw conversationIdentityError(category);
    return { name: name || null, email: email || null, message, category };
  }
  function validateConversationMessage(body) {
    const message = clean(body?.message, 5000);
    if (!message) throw Object.assign(new Error("MESSAGE_REQUIRED"), { status: 400 });
    return message;
  }
  function insertAttachments(files, conversationId, messageId) {
    try { return saveConversationAttachments(files, conversationId, messageId); }
    catch (error) { removeUploadedFiles(files); throw error; }
  }

  const publicConversationUpload = customerConversationUpload ? customerConversationUpload.array("attachments", CUSTOMER_ATTACHMENT_MAX_FILES) : (_req, _res, next) => next();
  app.post("/api/public/customer-conversations", publicConversationUpload, async (req, res) => {
    const ipKey = clean(req.ip || req.socket?.remoteAddress, 120);
    if (rateLimited(`conversation:${ipKey}`, 5, 10 * 60 * 1000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    let input;
    try { input = validateConversationRequest(req.body || {}); } catch (error) { removeUploadedFiles(req.files); return sendError(res, error); }
    autoCloseInactiveCustomerConversations(); cleanupExpiredCustomerConversations();
    const rawToken = crypto.randomBytes(32).toString("base64url"); const id = newId("CONV"); const language = req.body?.language === "hu" ? "hu" : "en";
    const outsideSupportHours = !isSupportHoursOpen(new Date(), env, db);
    const context = { service_id: clean(req.body?.service_id, 120) || null, piano_id: clean(req.body?.piano_id, 120) || null, event_id: clean(req.body?.event_id, 120) || null, ticket_id: clean(req.body?.ticket_id, 120) || null };
    const assignee = chooseConversationAssignee(db, input.category);
    const visitorTokenHash = input.email ? null : tokenHash(rawToken);
    let messageId;
    try {
      db.transaction(() => {
        db.prepare(`INSERT INTO customer_conversations(id,public_token_hash,public_token_encrypted,visitor_token_hash,name,email,language,category,service_id,piano_id,event_id,ticket_id,status,assigned_user_id,assigned_role,consent_contact,source_path,metadata_json,last_message_at,last_activity_at)
          VALUES(
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )`).run(id, tokenHash(rawToken), encryptConversationToken(rawToken, conversationKey), visitorTokenHash, input.name, input.email, language, input.category, context.service_id, context.piano_id, context.event_id, context.ticket_id, "PENDING_STAFF", assignee?.id || null, assignee?.routing_role || assignee?.role || null, 1, clean(req.body?.source_path, 1000), JSON.stringify({ subject: clean(req.body?.subject, 240), routing_role: assignee?.routing_role || "ADMIN" }));
        messageId = newId("MSG");
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')").run(messageId, id, "CUSTOMER", input.name || "Guest", input.email, input.message);
        insertAttachments(req.files, id, messageId);
        recordConversationEvent(id, "CREATED", { actor: { name: input.name || "Guest", role: "CUSTOMER" }, toStatus: "PENDING_STAFF", details: { category: input.category, message_id: messageId, attachment_count: Array.isArray(req.files) ? req.files.length : 0 } });
        if (outsideSupportHours) db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'READ')").run(newId("MSG"), id, "STAFF", "Klavierhaus Support", null, autoReplyText(input.name, language));
      })();
    } catch (error) { removeUploadedFiles(req.files); return sendError(res, error); }
    const conversation = db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(id);
    notifyAssignedStaff(conversation, { id: messageId, body: input.message });
    const conversationUrl = publicConversationUrl(rawToken);
    let autoReplyDelivery = { status: "NOT_CONFIGURED" };
    if (outsideSupportHours && input.email && transactionalEmail?.sendCustomerConversationAutoReply) {
      try { const sent = await transactionalEmail.sendCustomerConversationAutoReply({ to: input.email, name: input.name, conversationUrl, language, idempotencyKey: `customer-conversation-auto-reply:${id}` }); autoReplyDelivery = { status: "SENT", provider_message_id: sent.providerMessageId }; }
      catch (error) { autoReplyDelivery = { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED" }; }
    }
    res.status(201).json({ ...conversationPayload(db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(id), true, "public", rawToken), access_token: rawToken, conversation_url: conversationUrl, outside_support_hours: outsideSupportHours, auto_reply_delivery: autoReplyDelivery });
  });

  app.post("/api/public/customer-conversations/lookup", (req, res) => {
    const ipKey = clean(req.ip || req.socket?.remoteAddress, 120);
    if (rateLimited(`conversation-lookup:${ipKey}`, 5, 10 * 60 * 1000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email)) return res.status(400).json({ error: "VALID_CONVERSATION_EMAIL_REQUIRED" });

    // Security boundary: an e-mail address alone is not proof that the caller is
    // entitled to any private conversation token. Never expose decrypted
    // access tokens, conversation URLs, row counts, or conversation metadata
    // from this public endpoint. Return the same generic response regardless of
    // whether matching conversations exist to avoid both account takeover and
    // e-mail-address enumeration. Existing conversation access continues to use
    // the possession-based /:token routes.
    res.setHeader("Cache-Control", "no-store");
    return res.status(202).json({ ok: true });
  });

  app.get("/api/public/customer-conversations/:token", (req, res) => {
    autoCloseInactiveCustomerConversations();
    const conversation = conversationByToken(req.params.token);
    if (!conversation) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    res.setHeader("Cache-Control", "no-store");
    res.json(conversationPayload(conversation, true, "public", req.params.token));
  });

  app.post("/api/public/customer-conversations/:token/messages", publicConversationUpload, (req, res) => {
    const ipKey = clean(req.ip || req.socket?.remoteAddress, 120);
    if (rateLimited(`conversation-message:${ipKey}`, 20, 10 * 60 * 1000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    const conversation = conversationByToken(req.params.token);
    if (!conversation) { removeUploadedFiles(req.files); return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" }); }
    let body; try { body = validateConversationMessage(req.body || {}); } catch (error) { removeUploadedFiles(req.files); return sendError(res, error); }
    const messageId = newId("MSG");
    const wasClosed = conversation.status === "CLOSED";
    try {
      db.transaction(() => {
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')").run(messageId, conversation.id, "CUSTOMER", conversation.name || "Guest", conversation.email, body);
        insertAttachments(req.files, conversation.id, messageId);
        db.prepare("UPDATE customer_conversations SET status='PENDING_STAFF',last_message_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP,closed_at=NULL,auto_closed_at=NULL,reopen_reason=CASE WHEN ? THEN 'Customer sent a new message after automatic closure.' ELSE reopen_reason END,reopened_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE reopened_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(wasClosed ? 1 : 0, wasClosed ? 1 : 0, conversation.id);
        recordConversationEvent(conversation.id, wasClosed ? "REOPENED_BY_CUSTOMER" : "CUSTOMER_MESSAGE", { actor: { name: conversation.name || "Guest", role: "CUSTOMER" }, fromStatus: conversation.status, toStatus: "PENDING_STAFF", details: { message_id: messageId, attachment_count: Array.isArray(req.files) ? req.files.length : 0, reason: wasClosed ? "Customer sent a new message after automatic closure." : null } });
      })();
    } catch (error) { removeUploadedFiles(req.files); return sendError(res, error); }
    const fresh = conversationById(conversation.id);
    notifyAssignedStaff(fresh, { id: messageId, body });
    res.status(201).json(conversationPayload(fresh, true, "public", req.params.token));
  });
  app.get("/api/public/customer-conversations/:token/attachments/:attachmentId", (req, res) => {
    const row = conversationByToken(req.params.token); const attachment = db.prepare("SELECT * FROM customer_message_attachments WHERE id=? AND conversation_id=?").get(req.params.attachmentId, row?.id || "");
    if (!row || !attachment) return res.status(404).json({ error: "CUSTOMER_ATTACHMENT_NOT_FOUND" });
    const filePath = path.join(uploadDir || "", "customer-conversations", attachment.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "CUSTOMER_ATTACHMENT_NOT_FOUND" });
    res.type(attachment.mime_type).download(filePath, attachment.original_name);
  });

  app.get("/api/customer-conversations", auth, helpdesk, (req, res) => {
    autoCloseInactiveCustomerConversations(); cleanupExpiredCustomerConversations();
    const status = normalizedStatus(req.query.status, ""); const query = clean(req.query.q, 240).toLowerCase();
    const rows = db.prepare("SELECT * FROM customer_conversations ORDER BY updated_at DESC").all().filter((row) => (!status || status === "" || row.status === status) && (!query || `${row.name || ""} ${row.email || ""} ${row.category} ${row.id}`.toLowerCase().includes(query)) && canViewConversation(req.user, row));
    res.json(rows.map((row) => conversationPayload(row)));
  });
  app.get("/api/customer-conversations/:id", auth, helpdesk, (req, res) => {
    const row = conversationById(req.params.id);
    if (!row) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    if (!canViewConversation(req.user, row)) return res.status(403).json({ error: "PERMISSION_DENIED" });
    db.prepare("UPDATE customer_messages SET status='READ' WHERE conversation_id=? AND direction='CUSTOMER'").run(row.id);
    res.json(conversationPayload(row, true));
  });
  app.get("/api/customer-conversations/:id/attachments/:attachmentId", auth, helpdesk, (req, res) => {
    const row = conversationById(req.params.id); const attachment = db.prepare("SELECT * FROM customer_message_attachments WHERE id=? AND conversation_id=?").get(req.params.attachmentId, req.params.id);
    if (!row || !attachment) return res.status(404).json({ error: "CUSTOMER_ATTACHMENT_NOT_FOUND" });
    if (!canViewConversation(req.user, row)) return res.status(403).json({ error: "PERMISSION_DENIED" });
    const filePath = path.join(uploadDir || "", "customer-conversations", attachment.stored_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "CUSTOMER_ATTACHMENT_NOT_FOUND" });
    res.type(attachment.mime_type).download(filePath, attachment.original_name);
  });
  app.post("/api/customer-conversations/:id/messages", auth, helpdesk, customerConversationUpload ? customerConversationUpload.array("attachments", CUSTOMER_ATTACHMENT_MAX_FILES) : (_req, _res, next) => next(), async (req, res) => {
    const row = conversationById(req.params.id);
    if (!row) { removeUploadedFiles(req.files); return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" }); }
    if (!canEditConversation(req.user, row)) { removeUploadedFiles(req.files); return res.status(403).json({ error: "PERMISSION_DENIED" }); }
    let body; try { body = validateConversationMessage(req.body || {}); } catch (error) { removeUploadedFiles(req.files); return sendError(res, error); }
    if (row.status === "CLOSED") { removeUploadedFiles(req.files); return res.status(409).json({ error: "CONVERSATION_REOPEN_REQUIRED" }); }
    const messageId = newId("MSG");
    try {
      db.transaction(() => {
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,sender_user_id,body,status) VALUES(?,?,?,?,?,?,?,'READ')").run(messageId, row.id, "STAFF", req.user.name || "Klavierhaus", req.user.email || null, req.user.id, body);
        insertAttachments(req.files, row.id, messageId);
        db.prepare("UPDATE customer_conversations SET status='PENDING_CUSTOMER',last_message_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
        recordConversationEvent(row.id, "STAFF_MESSAGE", { actor: req.user, fromStatus: row.status, toStatus: "PENDING_CUSTOMER", details: { message_id: messageId, attachment_count: Array.isArray(req.files) ? req.files.length : 0 } });
      })();
    } catch (error) { removeUploadedFiles(req.files); return sendError(res, error); }
    let delivery = { status: "NOT_CONFIGURED" };
    const accessToken = conversationTokenFromRow(row, conversationKey);
    const conversationUrl = accessToken ? publicConversationUrl(accessToken) : `${String(websiteBaseUrl).replace(/\/$/, "")}/contact`;
    const deliveryKey = `customer-message:${messageId}`;
    if (row.email && transactionalEmail?.sendCustomerConversationReply) {
      documentService?.recordDelivery?.({ eventKey: deliveryKey, deliveryType: "CUSTOMER_CONVERSATION_REPLY", recipientEmail: row.email, conversationId: row.id, result: { status: "PENDING" } });
      try {
        const sent = await transactionalEmail.sendCustomerConversationReply({ to: row.email, name: row.name, message: body, conversationUrl, language: row.language, idempotencyKey: deliveryKey });
        delivery = { status: "SENT", provider_message_id: sent.providerMessageId };
        documentService?.recordDelivery?.({ eventKey: deliveryKey, deliveryType: "CUSTOMER_CONVERSATION_REPLY", recipientEmail: row.email, conversationId: row.id, result: { status: "SENT", providerMessageId: sent.providerMessageId } });
      } catch (error) {
        delivery = { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED" };
        documentService?.recordDelivery?.({ eventKey: deliveryKey, deliveryType: "CUSTOMER_CONVERSATION_REPLY", recipientEmail: row.email, conversationId: row.id, result: { status: delivery.status, errorCode: error.code || "EMAIL_DELIVERY_FAILED" } });
      }
    }
    res.status(201).json({ conversation: conversationPayload(conversationById(row.id), true), delivery });
  });
  app.patch("/api/customer-conversations/:id", auth, helpdesk, (req, res) => {
    const row = conversationById(req.params.id);
    if (!row) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    if (!canEditConversation(req.user, row) && !(isSuperadmin(req.user) || req.user.role === "ADMIN")) return res.status(403).json({ error: "PERMISSION_DENIED" });
    const status = normalizedStatus(req.body?.status, row.status);
    if (!CONVERSATION_STATUSES.has(status)) return res.status(400).json({ error: "INVALID_CONVERSATION_STATUS" });
    const changingAssignment = Object.prototype.hasOwnProperty.call(req.body || {}, "assigned_user_id");
    const assigned = changingAssignment ? clean(req.body?.assigned_user_id, 120) || null : row.assigned_user_id;
    if (assigned && !db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assigned)) return res.status(400).json({ error: "INVALID_CONVERSATION_ASSIGNEE" });
    if (changingAssignment && !(isSuperadmin(req.user) || req.user.role === "ADMIN")) return res.status(403).json({ error: "ONLY_ADMIN_CAN_ASSIGN" });
    if (status === "CLOSED" && !clean(req.body?.closure_note, 2000) && row.status !== "CLOSED") return res.status(400).json({ error: "CLOSURE_NOTE_REQUIRED" });
    if (row.status === "CLOSED" && status !== "CLOSED" && !clean(req.body?.reopen_reason, 2000)) return res.status(400).json({ error: "REOPEN_REASON_REQUIRED" });
    if (row.status === "CLOSED" && status !== "CLOSED" && req.user.role === "WORKER") return res.status(403).json({ error: "STAFF_REOPEN_NOT_ALLOWED" });
    const assignee = assigned ? db.prepare("SELECT id,role FROM users WHERE id=?").get(assigned) : null;
    db.prepare(`UPDATE customer_conversations SET status=?,assigned_user_id=?,assigned_role=?,closed_at=CASE WHEN ?='CLOSED' THEN COALESCE(closed_at,CURRENT_TIMESTAMP) ELSE NULL END,
      auto_closed_at=CASE WHEN ?='CLOSED' THEN auto_closed_at ELSE NULL END,closure_note=CASE WHEN ?='CLOSED' THEN COALESCE(?,closure_note) ELSE closure_note END,
      reopen_reason=CASE WHEN ?<>'CLOSED' AND status='CLOSED' THEN ? ELSE reopen_reason END,reopened_at=CASE WHEN ?<>'CLOSED' AND status='CLOSED' THEN CURRENT_TIMESTAMP ELSE reopened_at END,
      reopened_by_user_id=CASE WHEN ?<>'CLOSED' AND status='CLOSED' THEN ? ELSE reopened_by_user_id END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status, assigned, assignee?.role || null, status, status, status, clean(req.body?.closure_note, 2000) || null, status, clean(req.body?.reopen_reason, 2000) || null, status, status, req.user.id, row.id);
    if (status !== row.status) {
      recordConversationEvent(row.id, status === "CLOSED" ? "CLOSED" : row.status === "CLOSED" ? "REOPENED" : "STATUS_CHANGED", { actor: req.user, fromStatus: row.status, toStatus: status, details: status === "CLOSED" ? { closure_note: clean(req.body?.closure_note, 2000) } : { reopen_reason: clean(req.body?.reopen_reason, 2000) } });
    }
    if (changingAssignment && assigned !== row.assigned_user_id) {
      recordConversationEvent(row.id, "ASSIGNED", { actor: req.user, details: { assigned_user_id: assigned, assigned_role: assignee?.role || null } });
    }
    if (changingAssignment && assigned && assigned !== row.assigned_user_id) {
      const eventKey = `customer-conversation-assignment:${row.id}:${assigned}:${Date.now()}`;
      try { notifyUser?.({ recipientUserId: assigned, senderUserId: req.user.id, type: "DIRECT_MESSAGE", titleEn: "Helpdesk case assigned to you", titleHu: "Helpdesk ügyet rendeltek hozzád", bodyEn: `${row.name || "Guest"} · ${row.category}`, bodyHu: `${row.name || "Vendég"} · ${row.category}`, metadata: { conversation_id: row.id }, eventKey }); } catch (_error) {}
    }
    res.json(conversationPayload(conversationById(row.id)));
  });
  app.get("/api/customer-conversations/:id/report", auth, helpdesk, (req, res) => {
    const row = conversationById(req.params.id);
    if (!row) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    if (!canViewConversation(req.user, row)) return res.status(403).json({ error: "PERMISSION_DENIED" });
    const messages = db.prepare("SELECT id,direction,sender_name,sender_email,sender_user_id,body,status,created_at FROM customer_messages WHERE conversation_id=? ORDER BY created_at,id").all(row.id);
    const attachments = db.prepare("SELECT message_id,original_name,mime_type,file_size,created_at FROM customer_message_attachments WHERE conversation_id=? ORDER BY created_at,id").all(row.id);
    const auditEvents = db.prepare("SELECT id,event_type,actor_user_id,actor_name,actor_role,from_status,to_status,details,created_at FROM customer_conversation_events WHERE conversation_id=? ORDER BY created_at,id").all(row.id).map((event) => { let details = event.details; try { details = details ? JSON.parse(details) : null; } catch (_error) {} return { ...event, details }; });
    const pdf = generateCustomerConversationReportPdf({ conversation: conversationPayload(row), messages, attachments, auditEvents, language: req.query.lang === "hu" ? "hu" : "en" });
    res.type("application/pdf").set("Content-Disposition", `attachment; filename="klavierhaus-helpdesk-${row.id}.pdf"`).send(pdf);
  });
  app.get("/api/customer-support/holidays", auth, helpdesk, (req, res) => res.json(listSupportHolidays(req.query.year)));
  app.put("/api/customer-support/holidays/:date", auth, admin, (req, res) => {
    const date = clean(req.params.date, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "INVALID_HOLIDAY_DATE" });
    const row = listSupportHolidays(date.slice(0, 4)).find((item) => item.date === date);
    const labels = row || { label_en: clean(req.body?.label_en, 200) || "Custom holiday", label_hu: clean(req.body?.label_hu, 200) || "Egyedi ünnepnap", is_system: 0 };
    db.prepare(`INSERT INTO support_holidays(id,holiday_date,label_en,label_hu,enabled,is_system,updated_by_user_id,updated_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(holiday_date) DO UPDATE SET label_en=excluded.label_en,label_hu=excluded.label_hu,enabled=excluded.enabled,is_system=excluded.is_system,updated_by_user_id=excluded.updated_by_user_id,updated_at=CURRENT_TIMESTAMP`)
      .run(newId("HOL"), date, clean(req.body?.label_en, 200) || labels.label_en, clean(req.body?.label_hu, 200) || labels.label_hu, req.body?.enabled === false ? 0 : 1, labels.is_system ? 1 : 0, req.user.id);
    res.json(listSupportHolidays(date.slice(0, 4)));
  });

  app.get("/api/marketing/seo/audit", auth, admin, (_req, res) => {
    const settingsRow = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='website_seo_settings'").get();
    let settings = {}; try { settings = JSON.parse(settingsRow?.setting_value || "{}"); } catch (_error) { settings = {}; }
    const pages = ["home", "story", "pianos", "steinway", "services", "restoration", "tuning", "concert", "artists", "events", "salon", "mission", "contact", "privacy", "ticketTerms"];
    const result = [];
    for (const pageKey of pages) {
      const rows = db.prepare("SELECT language,content_json FROM website_content_pages WHERE page_key=?").all(pageKey);
      const keywordsEn = Array.isArray(settings.page_keywords_en?.[pageKey]) ? settings.page_keywords_en[pageKey] : [];
      const keywordsHu = Array.isArray(settings.page_keywords_hu?.[pageKey]) ? settings.page_keywords_hu[pageKey] : [];
      const languages = ["en", "hu"].map((language) => {
        const row = rows.find((item) => item.language === language);
        let content = {}; try { content = JSON.parse(row?.content_json || "{}"); } catch (_error) { content = {}; }
        const title = clean(content.seo?.title || content.hero?.title, 300);
        const description = clean(content.seo?.description || content.hero?.lead, 400);
        const keywords = language === "hu" ? keywordsHu : keywordsEn;
        const issues = [];
        if (!title) issues.push("MISSING_TITLE"); else if (title.length < 20 || title.length > 65) issues.push("TITLE_LENGTH");
        if (!description) issues.push("MISSING_DESCRIPTION"); else if (description.length < 70 || description.length > 170) issues.push("DESCRIPTION_LENGTH");
        if (!keywords.length) issues.push("NO_TARGET_KEYWORD");
        return { language, title, description, keyword_count: keywords.length, issues, score: Math.max(0, 100 - issues.length * 25) };
      });
      result.push({ page_key: pageKey, languages });
    }
    res.json({ generated_at: new Date().toISOString(), pages: result, note: "This is a deterministic metadata/content audit; rankings require Search Console, Analytics and human content review." });
  });
}

module.exports = { COMPANY_KEYS, createBusinessDocumentService, createInvoiceEngine, isSupportHoursOpen, readCompanyData, registerBusinessOperationsRoutes, tokenHash, validEmail, invoiceLifecycleStatus, closeInvoicePeriod, closeCompletedInvoicePeriods, nextNewYorkMonthBoundary, nextNewYorkMonthClose, actualMonthEndDate };

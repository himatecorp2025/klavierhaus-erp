"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { generateInvoicePdf, generateTicketBackPdf, generateTicketFrontPdf, generateTicketFullPdf } = require("./document-pdf");
const { generateGuestDataPdf } = require("./guest-list-pdf");
const { readGuestData } = require("./guest-data");
const { createTicketService } = require("./ticket-service");
const { buildConversationAutoReplyEmail, buildConversationReplyEmail } = require("./transactional-email");
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

function createBusinessDocumentService({ db, uploadDir, transactionalEmail, websiteBaseUrl = "", env = process.env }) {
  const documentDir = path.join(uploadDir || path.join(__dirname, "uploads"), "documents");
  fs.mkdirSync(documentDir, { recursive: true });

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
  function ticketDocumentGenerator(mode) {
    return mode === "front" ? generateTicketFrontPdf : mode === "back" ? generateTicketBackPdf : generateTicketFullPdf;
  }
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

  function invoiceNumber(payment, company) {
    const existing = db.prepare("SELECT invoice_number FROM knowledge_base WHERE content_type='Event Invoice' AND body LIKE ? LIMIT 1").get(`%${payment.id}%`);
    if (existing?.invoice_number) return existing.invoice_number;
    const year = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric" }).format(new Date());
    return `${company.invoice_prefix || "KH"}-${year}-${String(Date.now()).slice(-8)}`;
  }

  function createFinancialItem(payment, event, userName = "SYSTEM") {
    const amount = Number(payment.amount_total || 0) / 100;
    if (amount <= 0 || db.prepare("SELECT 1 FROM financial_items WHERE source_type='event_payment' AND source_id=? LIMIT 1").get(payment.id)) return;
    db.prepare(`INSERT INTO financial_items(id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,source_type,source_id,created_by)
      VALUES(?,?,?,?,?,'INCOME','CONCERT_SERVICE_REVENUE','ONE_TIME','STRIPE_TEST','1010','event_payment',?,?)`).run(
      newId("FIN"), new Date().toISOString().slice(0, 10), `Event ticket sale · ${event.title_en}`, `Stripe Sandbox payment ${payment.id}`, amount, payment.id, userName
    );
  }

  function createRefundFinancialItem(payment, event) {
    const amount = Number(payment.amount_total || 0) / 100;
    if (amount <= 0 || db.prepare("SELECT 1 FROM financial_items WHERE source_type='event_payment_refund' AND source_id=? LIMIT 1").get(payment.id)) return;
    db.prepare(`INSERT INTO financial_items(id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,source_type,source_id,created_by)
      VALUES(?,?,?,?,?,'EXPENSE','EVENT_REFUND','ONE_TIME','STRIPE_TEST','1010','event_payment_refund',?,'SYSTEM')`).run(
      newId("FIN"), new Date().toISOString().slice(0, 10), `Event ticket refund · ${event.title_en}`, `Stripe Sandbox refund ${payment.id}`, amount, payment.id
    );
  }

  async function sendPurchaseDocuments(paymentId, { resend = false } = {}) {
    const payment = db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);
    if (!payment) throw Object.assign(new Error("EVENT_PAYMENT_NOT_FOUND"), { status: 404 });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);
    const tickets = db.prepare("SELECT * FROM event_tickets WHERE event_payment_id=? ORDER BY ticket_sequence,id").all(payment.id);
    if (!event || !tickets.length) throw new Error("EVENT_TICKETS_NOT_READY");
    const company = readCompanyData(db);
    const invoice = invoiceNumber(payment, company);
    const logoPath = resolveCompanyLogoPath(company.logo_url, uploadDir);
    const pdfOptions = eventDocumentData(event, tickets);
    const ticketPdf = generateTicketFrontPdf(pdfOptions);
    tickets.forEach((ticket) => {
      persistTicketDocument(ticket, "FRONT", generateTicketFrontPdf(eventDocumentData(event, [ticket])));
      persistTicketDocument(ticket, "BACK", generateTicketBackPdf(eventDocumentData(event, [ticket])));
      persistTicketDocument(ticket, "FULL", generateTicketFullPdf(eventDocumentData(event, [ticket])));
    });
    const invoicePdf = generateInvoicePdf({ company, event, payment, tickets, invoiceNumber: invoice, language: "en", logoPath });
    const ticketPath = artifactPath("tickets", payment.id); const invoicePath = artifactPath("invoice", payment.id);
    if (!fs.existsSync(ticketPath) || resend) fs.writeFileSync(ticketPath, ticketPdf);
    if (!fs.existsSync(invoicePath) || resend) fs.writeFileSync(invoicePath, invoicePdf);
    const existingInvoice = db.prepare("SELECT id FROM knowledge_base WHERE content_type='Event Invoice' AND body LIKE ? LIMIT 1").get(`%${payment.id}%`);
    if (!existingInvoice) db.prepare(`INSERT INTO knowledge_base(id,title,category,content_type,body,stored_path,owner,amount,payment_method,invoice_number)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(newId("DOC"), `Invoice ${invoice}`, "Event Ticketing", "Event Invoice", JSON.stringify({ payment_id: payment.id, event_id: event.id }), publicDocumentPath(invoicePath), payment.purchaser_name, Number(payment.amount_total || 0) / 100, "STRIPE_TEST", invoice);
    createFinancialItem(payment, event);
    const key = `event-purchase-documents:${payment.id}`;
    beginDelivery({ eventKey: key, deliveryType: "EVENT_PURCHASE_DOCUMENTS", recipientEmail: payment.purchaser_email, eventId: event.id, paymentId: payment.id });
    if (!transactionalEmail?.sendEventPurchaseConfirmation) {
      finishDelivery(key, { status: "NOT_CONFIGURED", errorCode: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      return { status: "NOT_CONFIGURED", invoice_number: invoice, ticket_file: publicDocumentPath(ticketPath), invoice_file: publicDocumentPath(invoicePath) };
    }
    try {
      const sent = await transactionalEmail.sendEventPurchaseConfirmation({ to: payment.purchaser_email, purchaserName: payment.purchaser_name, event, payment, tickets, invoiceNumber: invoice, company, ticketPdf, invoicePdf, websiteBaseUrl, idempotencyKey: key });
      finishDelivery(key, { status: "SENT", providerMessageId: sent.providerMessageId });
      return { status: "SENT", provider_message_id: sent.providerMessageId, invoice_number: invoice };
    } catch (error) {
      finishDelivery(key, { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", errorCode: error.code || "EMAIL_DELIVERY_FAILED" });
      return { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", invoice_number: invoice };
    }
  }

  async function sendTicketDocuments({ eventId, ticketIds, deliveryType = "EVENT_FREE_TICKETS" }) {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(eventId);
    const tickets = db.prepare(`SELECT * FROM event_tickets WHERE event_id=? AND id IN (${(ticketIds || []).map(() => "?").join(",") || "NULL"}) ORDER BY ticket_sequence,id`).all(eventId, ...(ticketIds || []));
    if (!event || !tickets.length) return { status: "NOT_READY" };
    const first = tickets[0];
    const key = `${deliveryType.toLowerCase()}:${first.id}`;
    beginDelivery({ eventKey: key, deliveryType, recipientEmail: first.contact_email, eventId, ticketId: first.id });
    const pdf = generateTicketFrontPdf(eventDocumentData(event, tickets));
    if (!validEmail(first.contact_email) || !transactionalEmail?.sendEventTicketDocuments) {
      finishDelivery(key, { status: "NOT_CONFIGURED", errorCode: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      return { status: "NOT_CONFIGURED" };
    }
    try {
      const sent = await transactionalEmail.sendEventTicketDocuments({ to: first.contact_email, event, tickets, ticketPdf: pdf, language: "en", websiteBaseUrl, idempotencyKey: key });
      finishDelivery(key, { status: "SENT", providerMessageId: sent.providerMessageId });
      return { status: "SENT", provider_message_id: sent.providerMessageId };
    } catch (error) {
      finishDelivery(key, { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", errorCode: error.code || "EMAIL_DELIVERY_FAILED" });
      return { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED" };
    }
  }

  function ticketPdfForTicket(ticketId, mode = "full") {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticketId);
    if (!ticket) throw Object.assign(new Error("TICKET_NOT_FOUND"), { status: 404 });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(ticket.event_id);
    if (!event) throw Object.assign(new Error("EVENT_NOT_FOUND"), { status: 404 });
    const company = readCompanyData(db);
    return ticketDocumentGenerator(mode)(eventDocumentData(event, [ticket]));
  }

  function ticketPdfForPayment(paymentId, mode = "full") {
    const payment = db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);
    if (!payment) throw Object.assign(new Error("EVENT_PAYMENT_NOT_FOUND"), { status: 404 });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);
    const tickets = db.prepare("SELECT * FROM event_tickets WHERE event_payment_id=? ORDER BY ticket_sequence,id").all(payment.id);
    if (!event || !tickets.length) throw Object.assign(new Error("EVENT_TICKETS_NOT_READY"), { status: 404 });
    const company = readCompanyData(db);
    return ticketDocumentGenerator(mode)(eventDocumentData(event, tickets));
  }

  function generateTicketDocuments(ticketId, { mode = "full", userId = null } = {}) {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticketId);
    if (!ticket) throw Object.assign(new Error("TICKET_NOT_FOUND"), { status: 404 });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(ticket.event_id);
    if (!event) throw Object.assign(new Error("EVENT_NOT_FOUND"), { status: 404 });
    const normalized = String(mode || "full").toLowerCase();
    const generator = ticketDocumentGenerator(normalized);
    const document = persistTicketDocument(ticket, normalized.toUpperCase(), generator(eventDocumentData(event, [ticket])), userId);
    return { ticket_id: ticket.id, event_id: event.id, mode: normalized, ...document };
  }

  function ticketDocuments(ticketId) {
    return db.prepare("SELECT document_type,stored_path,generated_at,generated_by_user_id FROM event_ticket_documents WHERE ticket_id=? ORDER BY document_type").all(ticketId);
  }

  function invoicePdfForPayment(paymentId) {
    const payment = db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);
    if (!payment) throw Object.assign(new Error("EVENT_PAYMENT_NOT_FOUND"), { status: 404 });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);
    const tickets = db.prepare("SELECT * FROM event_tickets WHERE event_payment_id=? ORDER BY ticket_sequence,id").all(payment.id);
    if (!event || !tickets.length) throw Object.assign(new Error("EVENT_TICKETS_NOT_READY"), { status: 404 });
    const company = readCompanyData(db);
    const invoice = invoiceNumber(payment, company);
    return { pdf: generateInvoicePdf({ company, event, payment, tickets, invoiceNumber: invoice, language: "en", logoPath: resolveCompanyLogoPath(company.logo_url, uploadDir) }), invoice_number: invoice };
  }

  function invoicePdfForTicket(ticketId) {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticketId);
    if (!ticket) throw Object.assign(new Error("TICKET_NOT_FOUND"), { status: 404 });
    if (ticket.payment_status !== "PAID" || Number(ticket.price_cents || 0) <= 0) throw Object.assign(new Error("TICKET_INVOICE_REQUIRES_PAID_PRICE"), { status: 409 });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(ticket.event_id);
    if (!event) throw Object.assign(new Error("EVENT_NOT_FOUND"), { status: 404 });
    const company = readCompanyData(db);
    const payment = {
      id: `ticket:${ticket.id}`,
      purchaser_name: ticket.buyer_name || ticket.attendee_name,
      purchaser_email: ticket.contact_email || "",
      amount_total: Number(ticket.price_cents || 0),
      currency: ticket.currency || "USD",
      status: "PAID"
    };
    const invoice = invoiceNumber(payment, company);
    const pdf = generateInvoicePdf({ company, event, payment, tickets: [ticket], invoiceNumber: invoice, language: "en", logoPath: resolveCompanyLogoPath(company.logo_url, uploadDir) });
    const invoicePath = artifactPath("invoice-ticket", ticket.id);
    if (!fs.existsSync(invoicePath)) fs.writeFileSync(invoicePath, pdf);
    const existing = db.prepare("SELECT id FROM knowledge_base WHERE content_type='Event Invoice' AND body LIKE ? LIMIT 1").get(`%${ticket.id}%`);
    if (!existing) db.prepare(`INSERT INTO knowledge_base(id,title,category,content_type,body,stored_path,owner,amount,payment_method,invoice_number)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(newId("DOC"), `Invoice ${invoice}`, "Event Ticketing", "Event Invoice", JSON.stringify({ ticket_id: ticket.id, event_id: event.id }), publicDocumentPath(invoicePath), payment.purchaser_name, Number(ticket.price_cents || 0) / 100, ticket.payment_method || "MANUAL", invoice);
    return { pdf, invoice_number: invoice, stored_path: publicDocumentPath(invoicePath) };
  }

  return Object.freeze({
    companyData: () => readCompanyData(db),
    sendPurchaseDocuments,
    sendTicketDocuments,
    ticketPdfForTicket,
    ticketPdfForPayment,
    generateTicketDocuments,
    ticketDocuments,
    invoicePdfForPayment,
    invoicePdfForTicket,
    deliveryRow,
    recordDelivery,
    async onPaymentFulfilled({ paymentId }) { return sendPurchaseDocuments(paymentId); },
    onPaymentRefunded({ paymentId }) {
      const payment = db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);
      const event = payment && db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);
      if (payment && event) createRefundFinancialItem(payment, event);
    }
  });
}

function registerBusinessOperationsRoutes(options) {
  const { app, db, auth, permit, audit, transactionalEmail, websiteBaseUrl = "", uploadDir, env = process.env, documentService, ticketService: providedTicketService, customerConversationUpload, notifyUser } = options;
  const admin = permit("ADMIN");
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
    if (ticket.payment_status !== "PAID" || Number(ticket.price_cents || 0) <= 0) return;
    if (db.prepare("SELECT 1 FROM financial_items WHERE source_type='event_manual_ticket' AND source_id=? LIMIT 1").get(ticket.id)) return;
    db.prepare(`INSERT INTO financial_items(id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,source_type,source_id,created_by)
      VALUES(?,?,?,?,?,'INCOME','CONCERT_SERVICE_REVENUE','ONE_TIME',?,'1010','event_manual_ticket',?,?)`).run(
      newId("FIN"), new Date().toISOString().slice(0, 10), `Event ticket sale · ${event.title_en}`, `Administrative ticket ${ticket.id}`, Number(ticket.price_cents || 0) / 100,
      ticket.payment_method || "MANUAL", ticket.id, userName
    );
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
    const paymentMethod = clean(req.body?.payment_method, 60).toUpperCase() || (variant === "ON_SITE" ? "ON_SITE" : "MANUAL");
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
    if (ticket.ticket_variant !== "ON_SITE") return res.status(400).json({ error: "ONLY_ON_SITE_TICKETS_CAN_BE_PAID_HERE" });
    if (Number(ticket.price_cents || 0) <= 0) return res.status(400).json({ error: "ON_SITE_PRICE_REQUIRED" });
    try {
      const paymentMethod = clean(req.body?.payment_method || ticket.payment_method || "ON_SITE", 60).toUpperCase();
      const paid = db.transaction(() => {
        const updated = ticketService.markPaid(ticket.id, { paymentMethod });
        recordManualTicketIncome(updated, db.prepare("SELECT * FROM events WHERE id=?").get(updated.event_id), req.user.name || req.user.id);
        return updated;
      })();
      const documents = ["front", "back", "full"].map((mode) => documentService.generateTicketDocuments(paid.id, { mode, userId: req.user.id }));
      const invoice = documentService.invoicePdfForTicket(paid.id);
      let email = { status: "NOT_REQUESTED" };
      if (req.body?.send_email === true || req.body?.send_email === "true" || req.body?.send_email === 1 || req.body?.send_email === "1") {
        email = await documentService.sendTicketDocuments({ eventId: paid.event_id, ticketIds: [paid.id], deliveryType: "EVENT_ON_SITE_TICKET" });
      }
      const after = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(paid.id);
      audit(req, "MARK_ON_SITE_TICKET_PAID", "event_tickets", paid.id, ticket, after, 1, "On-site reservation paid and finalized");
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
    const payment = db.prepare("SELECT id,event_id,status,purchaser_name,purchaser_email,amount_total,currency FROM event_payments WHERE id=?").get(req.params.id);
    if (!payment) return res.status(404).json({ error: "EVENT_PAYMENT_NOT_FOUND" });
    res.json({ payment, delivery: documentService.deliveryRow(`event-purchase-documents:${payment.id}`), documents: db.prepare("SELECT id,title,content_type,stored_path,invoice_number,amount,created_at FROM knowledge_base WHERE content_type='Event Invoice' AND body LIKE ? ORDER BY created_at DESC").all(`%${payment.id}%`) });
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
    const rows = db.prepare("SELECT * FROM customer_conversations WHERE lower(trim(email))=? AND datetime(created_at)>=datetime('now', ?) ORDER BY updated_at DESC LIMIT 20").all(email, `-${CUSTOMER_RETENTION_YEARS} years`);
    res.setHeader("Cache-Control", "no-store");
    res.json(rows.map((row) => { const accessToken = conversationTokenFromRow(row, conversationKey); return { ...conversationPayload(row, true, "public", accessToken), access_token: accessToken, conversation_url: publicConversationUrl(accessToken) }; }));
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

module.exports = { COMPANY_KEYS, createBusinessDocumentService, isSupportHoursOpen, readCompanyData, registerBusinessOperationsRoutes, tokenHash, validEmail };

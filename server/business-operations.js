"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { generateInvoicePdf, generateTicketBackPdf, generateTicketFrontPdf, generateTicketFullPdf } = require("./document-pdf");
const { generateGuestDataPdf } = require("./guest-list-pdf");
const { readGuestData } = require("./guest-data");
const { createTicketService } = require("./ticket-service");
const { buildConversationAutoReplyEmail } = require("./transactional-email");
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
const CONVERSATION_CATEGORIES = new Set(["SERVICE", "PIANO", "EVENT", "REFUND", "PRIVATE_CONSULTATION", "TECHNICAL", "GENERAL"]);
const CONVERSATION_STATUSES = new Set(["OPEN", "PENDING_CUSTOMER", "PENDING_STAFF", "CLOSED"]);

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
function isSupportHoursOpen(date = new Date(), env = process.env) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date).reduce((result, part) => { result[part.type] = part.value; return result; }, {});
  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  const holidays = supportHolidayKeys(Number(parts.year), String(env.SUPPORT_CHRISTIAN_HOLIDAYS || "true").toLowerCase() !== "false");
  String(env.SUPPORT_HOLIDAYS || "").split(",").map((value) => value.trim()).filter(Boolean).forEach((value) => holidays.add(value));
  if (["Sat", "Sun"].includes(parts.weekday) || holidays.has(dateKey)) return false;
  const hour = Number(parts.hour);
  return hour >= 9 && hour < 17;
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
    return { event: { ...event, dateLabel: formatEventDate(event, "en"), venueLabel: eventVenue(event) }, tickets, language: "en", logoPath: resolveCompanyLogoPath(readCompanyData(db).logo_url, uploadDir) };
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
  const { app, db, auth, permit, audit, transactionalEmail, websiteBaseUrl = "", uploadDir, env = process.env, documentService, ticketService: providedTicketService } = options;
  const admin = permit("ADMIN");
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
  function notifyStaff(conversation, message) {
    const users = db.prepare("SELECT id FROM users WHERE status='Active' AND role IN ('SUPERADMIN','ADMIN','MANAGER')").all();
    const titleEn = conversation.category === "REFUND" ? "Customer refund conversation" : "New customer conversation";
    const titleHu = conversation.category === "REFUND" ? "Ügyfél-visszatérítési beszélgetés" : "Új ügyfélbeszélgetés";
    for (const user of users) {
      const eventKey = `customer-conversation:${conversation.id}:${message.id}:${user.id}`;
      try {
        db.prepare(`INSERT OR IGNORE INTO notifications(id,recipient_user_id,notification_type,title_en,title_hu,body_en,body_hu,custom_message,metadata_json,event_key)
          VALUES(?,?, 'DIRECT_MESSAGE',?,?,?,?,?,?,?)`).run(newId("NTF"), user.id, titleEn, titleHu, `${conversation.name} wrote: ${message.body.slice(0, 240)}`, `${conversation.name} írt: ${message.body.slice(0, 240)}`, message.body.slice(0, 1000), JSON.stringify({ conversation_id: conversation.id }), eventKey);
      } catch (_error) { /* A notification must not block a customer message. */ }
    }
  }
  function conversationPayload(row, includeMessages = false) {
    if (!row) return null;
    const assignee = row.assigned_user_id ? db.prepare("SELECT name FROM users WHERE id=?").get(row.assigned_user_id) : null;
    const payload = { id: row.id, name: row.name, email: row.email, language: row.language, category: row.category, service_id: row.service_id, piano_id: row.piano_id, event_id: row.event_id, ticket_id: row.ticket_id, status: row.status, assigned_user_id: row.assigned_user_id, assigned_user_name: assignee?.name || null, source_path: row.source_path, last_message_at: row.last_message_at, created_at: row.created_at, updated_at: row.updated_at };
    if (includeMessages) payload.messages = db.prepare("SELECT id,direction,sender_name,sender_email,sender_user_id,body,status,created_at FROM customer_messages WHERE conversation_id=? ORDER BY created_at,id").all(row.id);
    return payload;
  }
  function conversationByToken(token) { return db.prepare("SELECT * FROM customer_conversations WHERE public_token_hash=?").get(tokenHash(token)); }

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

  app.post("/api/public/customer-conversations", async (req, res) => {
    const ipKey = clean(req.ip || req.socket?.remoteAddress, 120);
    if (rateLimited(`conversation:${ipKey}`, 5, 10 * 60 * 1000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    const name = clean(req.body?.name, 200); const email = normalizeEmail(req.body?.email); const body = clean(req.body?.message, 5000);
    const category = clean(req.body?.category || "GENERAL", 40).toUpperCase();
    if (!name || !validEmail(email) || !body || !CONVERSATION_CATEGORIES.has(category) || req.body?.consent_contact !== true) return res.status(400).json({ error: "VALID_CONVERSATION_FIELDS_REQUIRED" });
    const rawToken = crypto.randomBytes(32).toString("base64url"); const id = newId("CONV"); const language = req.body?.language === "hu" ? "hu" : "en";
    const outsideSupportHours = !isSupportHoursOpen(new Date(), env);
    const context = { service_id: clean(req.body?.service_id, 120) || null, piano_id: clean(req.body?.piano_id, 120) || null, event_id: clean(req.body?.event_id, 120) || null, ticket_id: clean(req.body?.ticket_id, 120) || null };
    try {
      db.transaction(() => {
        db.prepare(`INSERT INTO customer_conversations(id,public_token_hash,public_token_encrypted,name,email,language,category,service_id,piano_id,event_id,ticket_id,status,consent_contact,source_path,metadata_json,last_message_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'PENDING_STAFF',1,?,?,CURRENT_TIMESTAMP)`).run(id, tokenHash(rawToken), encryptConversationToken(rawToken, conversationKey), name, email, language, category, context.service_id, context.piano_id, context.event_id, context.ticket_id, clean(req.body?.source_path, 1000), JSON.stringify({ subject: clean(req.body?.subject, 240) }));
        const messageId = newId("MSG");
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')").run(messageId, id, "CUSTOMER", name, email, body);
        const conversation = db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(id);
        notifyStaff(conversation, { id: messageId, body });
        if (outsideSupportHours) {
          const conversationUrl = `${String(websiteBaseUrl).replace(/\/$/, "")}/contact?conversation=${encodeURIComponent(rawToken)}`;
          const autoReply = buildConversationAutoReplyEmail({ name, conversationUrl, language });
          db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'READ')").run(newId("MSG"), id, "STAFF", "Klavierhaus Support", null, autoReply.text);
        }
      })();
    } catch (error) { return sendError(res, error); }
    const conversationUrl = `${String(websiteBaseUrl).replace(/\/$/, "")}/contact?conversation=${encodeURIComponent(rawToken)}`;
    let autoReplyDelivery = { status: "NOT_CONFIGURED" };
    if (outsideSupportHours && transactionalEmail?.sendCustomerConversationAutoReply) {
      try { const sent = await transactionalEmail.sendCustomerConversationAutoReply({ to: email, name, conversationUrl, language, idempotencyKey: `customer-conversation-auto-reply:${id}` }); autoReplyDelivery = { status: "SENT", provider_message_id: sent.providerMessageId }; }
      catch (error) { autoReplyDelivery = { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED" }; }
    }
    res.status(201).json({ ...conversationPayload(db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(id), true), access_token: rawToken, conversation_url: conversationUrl, outside_support_hours: outsideSupportHours, auto_reply_delivery: autoReplyDelivery });
  });

  app.get("/api/public/customer-conversations/:token", (req, res) => {
    const conversation = conversationByToken(req.params.token);
    if (!conversation) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    res.setHeader("Cache-Control", "no-store");
    res.json(conversationPayload(conversation, true));
  });

  app.post("/api/public/customer-conversations/:token/messages", (req, res) => {
    const ipKey = clean(req.ip || req.socket?.remoteAddress, 120);
    if (rateLimited(`conversation-message:${ipKey}`, 20, 10 * 60 * 1000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    const conversation = conversationByToken(req.params.token);
    if (!conversation) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    if (conversation.status === "CLOSED") return res.status(409).json({ error: "CONVERSATION_CLOSED" });
    const body = clean(req.body?.message, 5000);
    if (!body) return res.status(400).json({ error: "MESSAGE_REQUIRED" });
    const messageId = newId("MSG");
    db.transaction(() => {
      db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')").run(messageId, conversation.id, "CUSTOMER", conversation.name, conversation.email, body);
      db.prepare("UPDATE customer_conversations SET status='PENDING_STAFF',last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(conversation.id);
    })();
    notifyStaff(conversation, { id: messageId, body });
    res.status(201).json(conversationPayload(db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(conversation.id), true));
  });

  app.get("/api/customer-conversations", auth, admin, (req, res) => {
    const status = clean(req.query.status, 30).toUpperCase();
    const rows = status && CONVERSATION_STATUSES.has(status)
      ? db.prepare("SELECT * FROM customer_conversations WHERE status=? ORDER BY updated_at DESC").all(status)
      : db.prepare("SELECT * FROM customer_conversations ORDER BY updated_at DESC").all();
    res.json(rows.map((row) => conversationPayload(row)));
  });
  app.get("/api/customer-conversations/:id", auth, admin, (req, res) => {
    const row = db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    db.prepare("UPDATE customer_messages SET status='READ' WHERE conversation_id=? AND direction='CUSTOMER'").run(row.id);
    res.json(conversationPayload(row, true));
  });
  app.post("/api/customer-conversations/:id/messages", auth, admin, async (req, res) => {
    const row = db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    const body = clean(req.body?.message, 5000);
    if (!body) return res.status(400).json({ error: "MESSAGE_REQUIRED" });
    const messageId = newId("MSG");
    db.transaction(() => {
      db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,sender_user_id,body,status) VALUES(?,?,?,?,?,?,?,'READ')").run(messageId, row.id, "STAFF", req.user.name || "Klavierhaus", req.user.email || null, req.user.id, body);
      db.prepare("UPDATE customer_conversations SET status='PENDING_CUSTOMER',last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
    })();
    let delivery = { status: "NOT_CONFIGURED" };
    const accessToken = decryptConversationToken(row.public_token_encrypted, conversationKey) || clean(req.body?.access_token, 300);
    const conversationUrl = accessToken
      ? `${String(websiteBaseUrl).replace(/\/$/, "")}/contact?conversation=${encodeURIComponent(accessToken)}`
      : `${String(websiteBaseUrl).replace(/\/$/, "")}/contact`;
    const deliveryKey = `customer-message:${messageId}`;
    documentService?.recordDelivery?.({ eventKey: deliveryKey, deliveryType: "CUSTOMER_CONVERSATION_REPLY", recipientEmail: row.email, conversationId: row.id, result: { status: "PENDING" } });
    if (transactionalEmail?.sendCustomerConversationReply) {
      try {
        const sent = await transactionalEmail.sendCustomerConversationReply({ to: row.email, name: row.name, message: body, conversationUrl, language: row.language, idempotencyKey: `customer-message:${messageId}` });
        delivery = { status: "SENT", provider_message_id: sent.providerMessageId };
        documentService?.recordDelivery?.({ eventKey: deliveryKey, deliveryType: "CUSTOMER_CONVERSATION_REPLY", recipientEmail: row.email, conversationId: row.id, result: { status: "SENT", providerMessageId: sent.providerMessageId } });
      } catch (error) {
        delivery = { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED" };
        documentService?.recordDelivery?.({ eventKey: deliveryKey, deliveryType: "CUSTOMER_CONVERSATION_REPLY", recipientEmail: row.email, conversationId: row.id, result: { status: delivery.status, errorCode: error.code || "EMAIL_DELIVERY_FAILED" } });
      }
    } else {
      documentService?.recordDelivery?.({ eventKey: deliveryKey, deliveryType: "CUSTOMER_CONVERSATION_REPLY", recipientEmail: row.email, conversationId: row.id, result: { status: "NOT_CONFIGURED", errorCode: "EMAIL_DELIVERY_NOT_CONFIGURED" } });
    }
    res.status(201).json({ conversation: conversationPayload(db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(row.id), true), delivery });
  });
  app.patch("/api/customer-conversations/:id", auth, admin, (req, res) => {
    const row = db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    const status = clean(req.body?.status || row.status, 30).toUpperCase();
    if (!CONVERSATION_STATUSES.has(status)) return res.status(400).json({ error: "INVALID_CONVERSATION_STATUS" });
    const assigned = clean(req.body?.assigned_user_id, 120) || null;
    if (assigned && !db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assigned)) return res.status(400).json({ error: "INVALID_CONVERSATION_ASSIGNEE" });
    db.prepare("UPDATE customer_conversations SET status=?,assigned_user_id=?,closed_at=CASE WHEN ?='CLOSED' THEN CURRENT_TIMESTAMP ELSE closed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, assigned, status, row.id);
    res.json(conversationPayload(db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(row.id)));
  });

  app.get("/api/customer-conversations/:id/report", auth, admin, (req, res) => {
    const row = db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    res.json({ report_type: "CUSTOMER_HELPDESK_CONVERSATION", generated_at: new Date().toISOString(), conversation: conversationPayload(row), messages: db.prepare("SELECT id,direction,sender_name,sender_email,sender_user_id,body,status,created_at FROM customer_messages WHERE conversation_id=? ORDER BY created_at,id").all(row.id) });
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

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { generateTicketPdf, generateInvoicePdf, normalizeTicketSide } = require("./document-pdf");
const { generateGuestListPdf } = require("./guest-list-pdf");
const { nextTicketCode } = require("./ticket-code");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONVERSATION_CATEGORIES = new Set(["SERVICE", "PIANO", "EVENT", "REFUND", "PRIVATE_CONSULTATION", "TECHNICAL", "GENERAL"]);
const CONVERSATION_STATUSES = new Set(["OPEN", "PENDING_CUSTOMER", "PENDING_STAFF", "CLOSED"]);
const ATTENDANCE_MODES = new Set(["UNSET", "PAPER", "DIGITAL"]);
const MANUAL_TICKET_VARIANTS = new Set(["PUBLIC", "INVITATION", "VIP", "COMPLIMENTARY"]);

function clean(value, max = 5000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function normalizeEmail(value) { return clean(value, 320).toLowerCase(); }
function validEmail(value) { return EMAIL_PATTERN.test(normalizeEmail(value)); }
function newId(prefix) { return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`; }
function tokenHash(token) { return crypto.createHash("sha256").update(String(token || "")).digest("hex"); }
function isSuperadmin(user) { return Boolean(user && (user.role === "SUPERADMIN" || Number(user.is_superadmin || 0) === 1)); }
function newYorkDateParts(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).reduce((parts, part) => { parts[part.type] = part.value; return parts; }, {});
}
function isSupportHoursOpen(date = new Date(), env = process.env) {
  const parts = newYorkDateParts(date);
  if (["Sat", "Sun"].includes(parts.weekday)) return false;
  const holidaySet = new Set(String(env.SUPPORT_HOLIDAYS || "").split(",").map((value) => value.trim()).filter(Boolean));
  const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  if (holidaySet.has(localDate)) return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 && minutes < 17 * 60;
}
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
  const officialLogo = path.join(__dirname, "assets", "klavierhaus-logo-white.png");
  if (!value || value === "/icons/icon-512.png") return officialLogo;
  let candidate = "";
  if (value.startsWith("/uploads/") && uploadDir) candidate = path.join(uploadDir, path.basename(value));
  else if (value.startsWith("/icons/")) candidate = path.join(__dirname, "..", "public", value.slice(1));
  if (candidate && fs.existsSync(candidate)) return candidate;
  return officialLogo;
}

function formatEventDate(event, language = "en") {
  if (!event?.start_at) return "";
  return new Intl.DateTimeFormat(language === "hu" ? "hu-HU" : "en-US", { timeZone: event.timezone || "America/New_York", dateStyle: "long", timeStyle: "short" }).format(new Date(event.start_at));
}

function eventVenue(event) {
  return [event?.venue_name, event?.venue_street, event?.venue_city, event?.venue_region, event?.venue_postal_code].filter(Boolean).join(", ");
}

function attendanceTicketType(ticket, event) {
  const variant = String(ticket?.ticket_variant || "").toUpperCase();
  if (variant === "VIP" || event?.access_type === "INTERNAL") return "VIP TICKET";
  if (variant === "INVITATION" || ticket?.source_type === "INVITATION" || event?.access_type === "INVITE_ONLY") return "PERSONAL INVITATION";
  if (variant === "COMPLIMENTARY" || ticket?.source_type === "COMPLIMENTARY") return "COMPLIMENTARY";
  return "PUBLIC EVENT";
}

function attendanceRow(ticket, event) {
  return {
    id: ticket.id,
    attendee_name: ticket.attendee_name,
    contact_email: ticket.contact_email,
    ticket_type: attendanceTicketType(ticket, event),
    public_code: ticket.public_code,
    source_type: ticket.source_type,
    ticket_variant: ticket.ticket_variant || "PUBLIC",
    status: ticket.status,
    attendance_status: ticket.status,
    price_cents: Number(ticket.price_cents || 0),
    currency: ticket.currency || event.currency || "USD",
    checked_in_at: ticket.checked_in_at || null,
    checked_in_by_user_id: ticket.checked_in_by_user_id || null,
    created_at: ticket.created_at || null
  };
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
  function documentEvent(event, language = "en") {
    return { ...event, dateLabel: formatEventDate(event, language), venueLabel: eventVenue(event) };
  }
  function ticketContext(ticketId) {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticketId);
    if (!ticket) throw Object.assign(new Error("TICKET_NOT_FOUND"), { status: 404 });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(ticket.event_id);
    if (!event) throw Object.assign(new Error("EVENT_NOT_FOUND"), { status: 404 });
    return { ticket, event: documentEvent(event), company: readCompanyData(db) };
  }
  function paymentContext(paymentId) {
    const payment = db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);
    if (!payment) throw Object.assign(new Error("EVENT_PAYMENT_NOT_FOUND"), { status: 404 });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(payment.event_id);
    const tickets = db.prepare("SELECT * FROM event_tickets WHERE event_payment_id=? ORDER BY ticket_sequence,id").all(payment.id);
    if (!event || !tickets.length) throw new Error("EVENT_TICKETS_NOT_READY");
    return { payment, event: documentEvent(event), tickets, company: readCompanyData(db) };
  }
  function ticketPdfForTicket(ticketId, language = "en", side = "both") {
    const { ticket, event, company } = ticketContext(ticketId);
    return generateTicketPdf({ event: documentEvent(event, language), tickets: [ticket], language, side: normalizeTicketSide(side, "both"), logoPath: resolveCompanyLogoPath(company.logo_url, uploadDir) });
  }
  function ticketPdfForPayment(paymentId, language = "en", side = "both") {
    const { event, tickets, company } = paymentContext(paymentId);
    return generateTicketPdf({ event: documentEvent(event, language), tickets, language, side: normalizeTicketSide(side, "both"), logoPath: resolveCompanyLogoPath(company.logo_url, uploadDir) });
  }
  function invoicePdfForPayment(paymentId, language = "en") {
    const { payment, event, tickets, company } = paymentContext(paymentId);
    return { pdf: generateInvoicePdf({ company, event: documentEvent(event, language), payment, tickets, invoiceNumber: invoiceNumber(payment, company), language, logoPath: resolveCompanyLogoPath(company.logo_url, uploadDir) }), invoice_number: invoiceNumber(payment, company) };
  }

  function prepareTicketDocument(ticketId, { language = "en", side = "front" } = {}) {
    const { ticket, event, company } = ticketContext(ticketId);
    const normalizedSide = normalizeTicketSide(side, "front");
    const ticketPath = artifactPath("ticket", ticket.id);
    const pdf = generateTicketPdf({ event: documentEvent(event, language), tickets: [ticket], language, side: normalizedSide, logoPath: resolveCompanyLogoPath(company.logo_url, uploadDir) });
    fs.writeFileSync(ticketPath, pdf);
    return { ticket_file: publicDocumentPath(ticketPath), side: normalizedSide };
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

  async function sendPurchaseDocuments(paymentId, { resend = false, sendEmail = true } = {}) {
    const payment = db.prepare("SELECT * FROM event_payments WHERE id=?").get(paymentId);
    if (!payment) throw Object.assign(new Error("EVENT_PAYMENT_NOT_FOUND"), { status: 404 });
    const context = paymentContext(paymentId);
    const { event, tickets, company } = context;
    const invoice = invoiceNumber(payment, company);
    const logoPath = resolveCompanyLogoPath(company.logo_url, uploadDir);
    const ticketPdf = generateTicketPdf({ event, tickets, language: "en", side: "front", logoPath });
    const invoicePdf = generateInvoicePdf({ company, event, payment, tickets, invoiceNumber: invoice, language: "en", logoPath });
    const ticketPath = artifactPath("tickets", payment.id); const invoicePath = artifactPath("invoice", payment.id);
    if (!fs.existsSync(ticketPath) || resend) fs.writeFileSync(ticketPath, ticketPdf);
    if (!fs.existsSync(invoicePath) || resend) fs.writeFileSync(invoicePath, invoicePdf);
    const existingInvoice = db.prepare("SELECT id FROM knowledge_base WHERE content_type='Event Invoice' AND body LIKE ? LIMIT 1").get(`%${payment.id}%`);
    if (!existingInvoice) db.prepare(`INSERT INTO knowledge_base(id,title,category,content_type,body,stored_path,owner,amount,payment_method,invoice_number)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(newId("DOC"), `Invoice ${invoice}`, "Event Ticketing", "Event Invoice", JSON.stringify({ payment_id: payment.id, event_id: event.id }), publicDocumentPath(invoicePath), payment.purchaser_name, Number(payment.amount_total || 0) / 100, "STRIPE_TEST", invoice);
    createFinancialItem(payment, event);
    if (!sendEmail) return { status: "PREPARED", invoice_number: invoice, ticket_file: publicDocumentPath(ticketPath), invoice_file: publicDocumentPath(invoicePath) };
    const key = `event-purchase-documents:${payment.id}`;
    beginDelivery({ eventKey: key, deliveryType: "EVENT_PURCHASE_DOCUMENTS", recipientEmail: payment.purchaser_email, eventId: event.id, paymentId: payment.id });
    if (!transactionalEmail?.sendEventPurchaseConfirmation) {
      finishDelivery(key, { status: "NOT_CONFIGURED", errorCode: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      return { status: "NOT_CONFIGURED", invoice_number: invoice, ticket_file: publicDocumentPath(ticketPath), invoice_file: publicDocumentPath(invoicePath) };
    }
    try {
      const sent = await transactionalEmail.sendEventPurchaseConfirmation({ to: payment.purchaser_email, purchaserName: payment.purchaser_name, event, payment, tickets, invoiceNumber: invoice, company, ticketPdf, invoicePdf, websiteBaseUrl, idempotencyKey: key });
      finishDelivery(key, { status: "SENT", providerMessageId: sent.providerMessageId });
      return { status: "SENT", provider_message_id: sent.providerMessageId, invoice_number: invoice, ticket_file: publicDocumentPath(ticketPath), invoice_file: publicDocumentPath(invoicePath) };
    } catch (error) {
      finishDelivery(key, { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", errorCode: error.code || "EMAIL_DELIVERY_FAILED" });
      return { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", invoice_number: invoice, ticket_file: publicDocumentPath(ticketPath), invoice_file: publicDocumentPath(invoicePath) };
    }
  }

  async function sendTicketDocuments({ eventId, ticketIds, deliveryType = "EVENT_FREE_TICKETS" }) {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(eventId);
    const tickets = db.prepare(`SELECT * FROM event_tickets WHERE event_id=? AND id IN (${(ticketIds || []).map(() => "?").join(",") || "NULL"}) ORDER BY ticket_sequence,id`).all(eventId, ...(ticketIds || []));
    if (!event || !tickets.length) return { status: "NOT_READY" };
    const first = tickets[0];
    const key = `${deliveryType.toLowerCase()}:${first.id}`;
    beginDelivery({ eventKey: key, deliveryType, recipientEmail: first.contact_email, eventId, ticketId: first.id });
    const pdf = generateTicketPdf({ event: documentEvent(event), tickets, language: "en", side: "front", logoPath: resolveCompanyLogoPath(readCompanyData(db).logo_url, uploadDir) });
    const ticketPath = artifactPath("tickets", `${eventId}-${first.id}`);
    fs.writeFileSync(ticketPath, pdf);
    if (!transactionalEmail?.sendEventTicketDocuments) {
      finishDelivery(key, { status: "NOT_CONFIGURED", errorCode: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      return { status: "NOT_CONFIGURED", ticket_file: publicDocumentPath(ticketPath) };
    }
    try {
      const sent = await transactionalEmail.sendEventTicketDocuments({ to: first.contact_email, event, tickets, ticketPdf: pdf, language: "en", websiteBaseUrl, idempotencyKey: key });
      finishDelivery(key, { status: "SENT", providerMessageId: sent.providerMessageId });
      return { status: "SENT", provider_message_id: sent.providerMessageId, ticket_file: publicDocumentPath(ticketPath) };
    } catch (error) {
      finishDelivery(key, { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", errorCode: error.code || "EMAIL_DELIVERY_FAILED" });
      return { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", ticket_file: publicDocumentPath(ticketPath) };
    }
  }

  async function sendTicketDocument(ticketId, { resend = false } = {}) {
    const { ticket, event, company } = ticketContext(ticketId);
    const key = `event-ticket-document:${ticket.id}`;
    const ticketPath = artifactPath("ticket", ticket.id);
    const pdf = generateTicketPdf({ event, tickets: [ticket], language: "en", side: "front", logoPath: resolveCompanyLogoPath(company.logo_url, uploadDir) });
    if (!fs.existsSync(ticketPath) || resend) fs.writeFileSync(ticketPath, pdf);
    beginDelivery({ eventKey: key, deliveryType: "EVENT_TICKET_DOCUMENT", recipientEmail: ticket.contact_email, eventId: event.id, ticketId: ticket.id });
    if (!transactionalEmail?.sendEventTicketDocuments) {
      finishDelivery(key, { status: "NOT_CONFIGURED", errorCode: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      return { status: "NOT_CONFIGURED", ticket_file: publicDocumentPath(ticketPath) };
    }
    try {
      const sent = await transactionalEmail.sendEventTicketDocuments({ to: ticket.contact_email, event, tickets: [ticket], ticketPdf: pdf, language: "en", websiteBaseUrl, idempotencyKey: key });
      finishDelivery(key, { status: "SENT", providerMessageId: sent.providerMessageId });
      return { status: "SENT", provider_message_id: sent.providerMessageId, ticket_file: publicDocumentPath(ticketPath) };
    } catch (error) {
      const status = error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
      finishDelivery(key, { status, errorCode: error.code || "EMAIL_DELIVERY_FAILED" });
      return { status, ticket_file: publicDocumentPath(ticketPath) };
    }
  }

  async function sendInvoiceDocument(paymentId, { resend = false } = {}) {
    const { payment, event, tickets, company } = paymentContext(paymentId);
    const invoice = invoiceNumber(payment, company);
    const invoicePath = artifactPath("invoice", payment.id);
    const invoicePdf = generateInvoicePdf({ company, event, payment, tickets, invoiceNumber: invoice, language: "en", logoPath: resolveCompanyLogoPath(company.logo_url, uploadDir) });
    if (!fs.existsSync(invoicePath) || resend) fs.writeFileSync(invoicePath, invoicePdf);
    const existingInvoice = db.prepare("SELECT id FROM knowledge_base WHERE content_type='Event Invoice' AND body LIKE ? LIMIT 1").get(`%${payment.id}%`);
    if (!existingInvoice) db.prepare(`INSERT INTO knowledge_base(id,title,category,content_type,body,stored_path,owner,amount,payment_method,invoice_number)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(newId("DOC"), `Invoice ${invoice}`, "Event Ticketing", "Event Invoice", JSON.stringify({ payment_id: payment.id, event_id: event.id }), publicDocumentPath(invoicePath), payment.purchaser_name, Number(payment.amount_total || 0) / 100, "STRIPE_TEST", invoice);
    const key = `event-invoice-document:${payment.id}`;
    beginDelivery({ eventKey: key, deliveryType: "EVENT_INVOICE_DOCUMENT", recipientEmail: payment.purchaser_email, eventId: event.id, paymentId: payment.id });
    if (!transactionalEmail?.sendInvoiceDocument) {
      finishDelivery(key, { status: "NOT_CONFIGURED", errorCode: "EMAIL_DELIVERY_NOT_CONFIGURED" });
      return { status: "NOT_CONFIGURED", invoice_number: invoice, invoice_file: publicDocumentPath(invoicePath) };
    }
    try {
      const sent = await transactionalEmail.sendInvoiceDocument({ to: payment.purchaser_email, purchaserName: payment.purchaser_name, event, payment, invoiceNumber: invoice, company, invoicePdf, websiteBaseUrl, idempotencyKey: key });
      finishDelivery(key, { status: "SENT", providerMessageId: sent.providerMessageId });
      return { status: "SENT", provider_message_id: sent.providerMessageId, invoice_number: invoice, invoice_file: publicDocumentPath(invoicePath) };
    } catch (error) {
      const status = error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED";
      finishDelivery(key, { status, errorCode: error.code || "EMAIL_DELIVERY_FAILED" });
      return { status, invoice_number: invoice, invoice_file: publicDocumentPath(invoicePath) };
    }
  }

  return Object.freeze({
    companyData: () => readCompanyData(db),
    ticketPdfForTicket,
    ticketPdfForPayment,
    invoicePdfForPayment,
    prepareTicketDocument,
    sendPurchaseDocuments,
    sendTicketDocuments,
    sendTicketDocument,
    sendInvoiceDocument,
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
  const { app, db, auth, permit, audit, transactionalEmail, websiteBaseUrl = "", uploadDir, env = process.env, documentService } = options;
  const admin = permit("ADMIN");
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
    res.status(Number(error?.status || (code.includes("NOT_FOUND") ? 404 : code.includes("ALREADY") ? 409 : 400))).json({ error: code });
  }
  function notifyStaff(conversation, message) {
    const roles = conversationRecipients(conversation.category);
    const placeholders = roles.map(() => "?").join(",");
    const users = db.prepare(`SELECT id FROM users WHERE status='Active' AND role IN (${placeholders})`).all(...roles);
    const titleEn = conversation.category === "REFUND" ? "Customer refund conversation" : conversation.category === "TECHNICAL" ? "Technical customer conversation" : "New customer conversation";
    const titleHu = conversation.category === "REFUND" ? "Ügyfél-visszatérítési beszélgetés" : conversation.category === "TECHNICAL" ? "Technikai ügyfélbeszélgetés" : "Új ügyfélbeszélgetés";
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
    const assignee = row.assigned_user_id ? db.prepare("SELECT name,role FROM users WHERE id=?").get(row.assigned_user_id) : null;
    const payload = { id: row.id, name: row.name, email: row.email, language: row.language, category: row.category, service_id: row.service_id, piano_id: row.piano_id, event_id: row.event_id, ticket_id: row.ticket_id, status: row.status, assigned_user_id: row.assigned_user_id, assigned_user_name: assignee?.name || null, assigned_user_role: assignee?.role || null, source_path: row.source_path, last_message_at: row.last_message_at, created_at: row.created_at, updated_at: row.updated_at };
    if (includeMessages) payload.messages = db.prepare("SELECT id,direction,sender_name,sender_email,sender_user_id,body,status,created_at FROM customer_messages WHERE conversation_id=? ORDER BY created_at,id").all(row.id);
    return payload;
  }
  function conversationByToken(token) { return db.prepare("SELECT * FROM customer_conversations WHERE public_token_hash=?").get(tokenHash(token)); }
  function buildConversationUrl(accessToken) {
    return accessToken
      ? `${String(websiteBaseUrl).replace(/\/$/, "")}/contact?conversation=${encodeURIComponent(accessToken)}`
      : `${String(websiteBaseUrl).replace(/\/$/, "")}/contact`;
  }
  function conversationRecipients(category) {
    if (category === "TECHNICAL") return ["SUPERADMIN", "MANAGER"];
    if (["EVENT", "REFUND"].includes(category)) return ["SUPERADMIN", "ADMIN", "MANAGER"];
    if (category === "GENERAL") return ["SUPERADMIN", "ADMIN"];
    return ["SUPERADMIN", "ADMIN", "MANAGER"];
  }

  app.get("/api/settings/company-data", auth, admin, (_req, res) => res.json(documentService.companyData()));
  app.put("/api/settings/company-data", auth, admin, (req, res) => {
    try {
      const before = documentService.companyData();
      const after = saveCompanyData(db, { ...before, ...(req.body || {}) }, req.user.name || req.user.id);
      audit(req, "UPDATE", "company_data", "company", before, after, 1, "Company invoice data updated");
      res.json(after);
    } catch (error) { sendError(res, error); }
  });

  app.post("/api/manual-tickets", auth, admin, async (req, res) => {
    const eventId = clean(req.body?.event_id, 120);
    const attendeeName = clean(req.body?.attendee_name, 200);
    const contactEmail = normalizeEmail(req.body?.contact_email);
    const requestedVariant = clean(req.body?.ticket_variant || "PUBLIC", 30).toUpperCase();
    const sendEmail = Boolean(req.body?.send_email);
    if (!eventId || !attendeeName || !validEmail(contactEmail)) return res.status(400).json({ error: "VALID_GUEST_REQUIRED" });
    if (!MANUAL_TICKET_VARIANTS.has(requestedVariant)) return res.status(400).json({ error: "INVALID_MANUAL_TICKET_TYPE" });
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(eventId);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    if (["CANCELLED", "CLOSED"].includes(event.status)) return res.status(409).json({ error: "EVENT_NOT_AVAILABLE" });
    const requestedPrice = Number(req.body?.price_cents ?? (requestedVariant === "PUBLIC" ? event.price_cents : 0));
    if (!Number.isInteger(requestedPrice) || requestedPrice < 0) return res.status(400).json({ error: "INVALID_EVENT_PRICE" });
    if (requestedVariant !== "PUBLIC" && requestedPrice !== 0) return res.status(400).json({ error: "MANUAL_NON_PAID_TICKET_MUST_BE_ZERO" });
    if (requestedVariant === "PUBLIC" && event.access_type !== "PUBLIC_PAID" && requestedPrice !== 0) return res.status(400).json({ error: "NON_PAID_EVENT_PRICE_MUST_BE_ZERO" });
    if (requestedVariant === "PUBLIC" && event.access_type === "PUBLIC_PAID" && requestedPrice <= 0) return res.status(400).json({ error: "PAID_EVENT_PRICE_REQUIRED" });
    const sourceType = requestedVariant === "INVITATION" ? "INVITATION" : requestedVariant === "PUBLIC" ? "PURCHASE" : "COMPLIMENTARY";
    const ticketId = newId("EVTKT");
    let created;
    try {
      created = db.transaction(() => {
        const occupied = Number(db.prepare("SELECT COUNT(*) AS count FROM event_tickets WHERE event_id=? AND status IN ('VALID','USED')").get(event.id).count || 0);
        const held = Number(db.prepare("SELECT COALESCE(SUM(quantity),0) AS count FROM event_checkout_holds WHERE event_id=? AND status='PENDING' AND expires_at>CURRENT_TIMESTAMP").get(event.id).count || 0);
        if (Number(event.capacity_total) - occupied - held < 1) throw Object.assign(new Error("EVENT_SOLD_OUT"), { status: 409 });
        const sequence = Number(db.prepare("SELECT COALESCE(MAX(ticket_sequence),0)+1 AS next FROM event_tickets WHERE event_id=?").get(event.id).next || 1);
        const ticketCode = nextTicketCode(db, event, sourceType, sequence, requestedVariant);
        let payment = null;
        if (requestedVariant === "PUBLIC" && requestedPrice > 0) {
          const holdId = newId("EVHLD");
          const paymentId = newId("EVPAY");
          const sessionId = `manual_session_${paymentId}`;
          const intentId = `manual_intent_${paymentId}`;
          const now = new Date().toISOString();
          db.prepare(`INSERT INTO event_checkout_holds(id,event_id,quantity,status,expires_at,language,attendee_names_json,purchaser_name,purchaser_email,currency,amount_total,test_mode)
            VALUES(?,?,1,'PAID',?,'en',?,?,?,?,?,1)`).run(holdId, event.id, now, JSON.stringify([attendeeName]), attendeeName, contactEmail, "USD", requestedPrice);
          db.prepare(`INSERT INTO event_payments(id,event_id,hold_id,status,purchaser_name,purchaser_email,quantity,amount_total,currency,stripe_checkout_session_id,stripe_payment_intent_id,test_mode,paid_at)
            VALUES(?,?,?,'PAID',?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(paymentId, event.id, holdId, attendeeName, contactEmail, 1, requestedPrice, "USD", sessionId, intentId, 1);
          payment = { id: paymentId, hold_id: holdId };
        }
        db.prepare(`INSERT INTO event_tickets(id,event_id,source_type,ticket_variant,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,event_payment_id,ticket_sequence,created_by_user_id)
          VALUES(?,?,?,?,?,?,?,?,'VALID',?,?,?, ?,?)`).run(ticketId, event.id, sourceType, requestedVariant, attendeeName, attendeeName, contactEmail, ticketCode.code, requestedPrice, "USD", payment?.id || null, ticketCode.sequence, req.user.id);
        return { ticket: db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticketId), payment: payment ? db.prepare("SELECT * FROM event_payments WHERE id=?").get(payment.id) : null };
      })();
    } catch (error) { return sendError(res, error, "MANUAL_TICKET_CREATE_FAILED"); }
    try {
      let documents;
      if (created.payment) documents = await documentService.sendPurchaseDocuments(created.payment.id, { sendEmail });
      else {
        documents = documentService.prepareTicketDocument(created.ticket.id, { side: "front" });
        if (sendEmail) documents = await documentService.sendTicketDocument(created.ticket.id);
      }
      audit(req, "CREATE_MANUAL_TICKET", "event_tickets", created.ticket.id, null, created.ticket, 1, `${requestedVariant} manual ticket issued`);
      res.status(201).json({ ticket: created.ticket, payment: created.payment, documents, ticket_pdf_url: `/api/events/tickets/${encodeURIComponent(created.ticket.id)}.pdf?side=front`, invoice_pdf_url: created.payment ? `/api/event-payments/${encodeURIComponent(created.payment.id)}/invoice.pdf` : null });
    } catch (error) {
      sendError(res, Object.assign(error, { status: 500 }), "MANUAL_TICKET_DOCUMENT_FAILED");
    }
  });

  function attendanceEvent(eventId) {
    return db.prepare("SELECT id,event_key,title_en,title_hu,start_at,end_at,status,capacity_total,currency,attendance_mode,attendance_closed_at,attendance_closed_by_user_id,timezone FROM events WHERE id=?").get(eventId) || null;
  }

  function attendanceTickets(eventId, query = "") {
    const normalizedQuery = clean(query, 160).toLocaleLowerCase();
    const rows = db.prepare(`SELECT id,event_id,source_type,ticket_variant,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,checked_in_at,checked_in_by_user_id,created_at
      FROM event_tickets WHERE event_id=? AND status IN ('VALID','USED','VOID','REFUNDED')
      AND (?='' OR lower(attendee_name) LIKE '%'||?||'%' OR lower(contact_email) LIKE '%'||?||'%' OR lower(public_code) LIKE '%'||?||'%')
      ORDER BY lower(attendee_name),created_at,id`).all(eventId, normalizedQuery, normalizedQuery, normalizedQuery, normalizedQuery);
    const event = attendanceEvent(eventId);
    return rows.map((ticket) => attendanceRow(ticket, event));
  }

  function attendanceSummary(rows) {
    return {
      total: rows.length,
      present: rows.filter((row) => row.status === "USED").length,
      no_show: rows.filter((row) => row.status === "VALID").length,
      deleted: rows.filter((row) => ["VOID", "REFUNDED"].includes(row.status)).length,
      voided: rows.filter((row) => row.status === "VOID").length,
      refunded: rows.filter((row) => row.status === "REFUNDED").length
    };
  }

  function refundReviewOutcome(event) {
    if (event.status === "CANCELLED" || event.status === "RESCHEDULED") return { outcome: "REFUND_ELIGIBLE", note: "Refund review required because the event was cancelled or rescheduled." };
    if (["COMPLETED", "CLOSED"].includes(event.status)) return { outcome: "REFUND_NOT_ELIGIBLE", note: "REFUND NOT ELIGIBLE – NO-SHOW" };
    return { outcome: "REVIEW_REQUIRED", note: "Manual refund review required; no automatic refund was initiated." };
  }

  function recordDeletedPaidTicketReview(ticket, event, userId) {
    if (ticket.source_type !== "PURCHASE" && !ticket.event_payment_id) return null;
    const review = refundReviewOutcome(event);
    const id = newId("EVTRR");
    const existing = db.prepare("SELECT id FROM event_ticket_refund_reviews WHERE ticket_id=? AND reason_code='ATTENDANCE_DELETED'").get(ticket.id);
    if (existing) db.prepare("UPDATE event_ticket_refund_reviews SET event_id=?,payment_id=?,outcome=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(event.id, ticket.event_payment_id || null, review.outcome, review.note, existing.id);
    else db.prepare(`INSERT INTO event_ticket_refund_reviews(id,event_id,ticket_id,payment_id,reason_code,outcome,note,created_by_user_id)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, event.id, ticket.id, ticket.event_payment_id || null, "ATTENDANCE_DELETED", review.outcome, review.note, userId);
    return db.prepare("SELECT * FROM event_ticket_refund_reviews WHERE ticket_id=? AND reason_code='ATTENDANCE_DELETED'").get(ticket.id);
  }

  app.post("/api/events/:id/attendance/open", auth, admin, (req, res) => {
    const event = attendanceEvent(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    if (event.status === "CANCELLED") return res.status(409).json({ error: "EVENT_NOT_AVAILABLE" });
    if (event.attendance_mode === "PAPER") return res.status(409).json({ error: "ATTENDANCE_PAPER_MODE_ACTIVE" });
    if (event.attendance_closed_at || event.status === "CLOSED" || db.prepare("SELECT 1 FROM event_closures WHERE event_id=?").get(event.id)) return res.status(409).json({ error: "ATTENDANCE_ALREADY_CLOSED" });
    if (event.attendance_mode !== "DIGITAL") db.prepare("UPDATE events SET attendance_mode='DIGITAL',updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, event.id);
    const updated = attendanceEvent(event.id);
    audit(req, "ATTENDANCE_OPEN", "event_attendance", event.id, event, updated, 1, "Digital attendance mode opened");
    res.json({ event: updated, mode: updated.attendance_mode, opened: true });
  });

  app.get("/api/events/:id/attendance", auth, admin, (req, res) => {
    const event = attendanceEvent(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    const query = clean(req.query.q, 160);
    const closure = db.prepare("SELECT id,snapshot_json,created_at FROM event_closures WHERE event_id=?").get(event.id);
    const report = closure ? JSON.parse(closure.snapshot_json) : null;
    const rows = report?.attendance_rows ? report.attendance_rows.filter((row) => `${row.attendee_name || ""} ${row.contact_email || ""} ${row.public_code || ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) : attendanceTickets(event.id, query);
    const allRows = report?.attendance_rows || attendanceTickets(event.id);
    res.json({ event, mode: event.attendance_mode || "UNSET", closed: Boolean(closure), tickets: rows, totals: report?.tickets || attendanceSummary(allRows), report, digital_enabled: event.attendance_mode !== "PAPER" && !closure });
  });

  app.post("/api/events/:id/attendance/paper-export", auth, admin, (req, res) => {
    const event = attendanceEvent(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    if (event.attendance_mode === "DIGITAL") return res.status(409).json({ error: "ATTENDANCE_DIGITAL_MODE_ACTIVE" });
    if (event.attendance_closed_at || event.status === "CLOSED") return res.status(409).json({ error: "ATTENDANCE_ALREADY_CLOSED" });
    if (new Date(event.start_at).getTime() <= Date.now()) return res.status(409).json({ error: "PAPER_ATTENDANCE_EXPORT_WINDOW_CLOSED" });
    if (event.attendance_mode !== "PAPER" && req.body?.confirm !== true) return res.status(409).json({ error: "PAPER_ATTENDANCE_CONFIRMATION_REQUIRED", warning: "Paper attendance mode will disable digital check-in for this event. Use one attendance method only." });
    db.prepare("UPDATE events SET attendance_mode='PAPER',updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND attendance_mode='UNSET'").run(req.user.id, event.id);
    const current = attendanceEvent(event.id);
    const guests = attendanceTickets(event.id).filter((row) => ["VALID", "USED"].includes(row.status)).map((row) => ({ ...row, attendance_status: "VALID", status: "VALID" }));
    const language = req.query.lang === "hu" ? "hu" : "en";
    const title = language === "hu" ? current.title_hu : current.title_en;
    try {
      const pdf = generateGuestListPdf({ event: { title, dateLabel: formatEventDate(current, language) }, guests, language, closed: false });
      audit(req, "ATTENDANCE_PAPER_EXPORT", "event_attendance", current.id, event, { mode: "PAPER", guest_count: guests.length }, 1, "Paper attendance mode selected");
      const safeName = title.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "event";
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}-paper-guest-list.pdf"`);
      res.type("application/pdf").send(pdf);
    } catch (error) { sendError(res, Object.assign(error, { status: 500 }), "GUEST_LIST_PDF_FAILED"); }
  });

  app.get("/api/events/:id/attendance.pdf", auth, admin, (req, res) => {
    const event = attendanceEvent(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    if (event.attendance_mode !== "DIGITAL") return res.status(409).json({ error: event.attendance_mode === "PAPER" ? "ATTENDANCE_PAPER_MODE_ACTIVE" : "ATTENDANCE_DIGITAL_MODE_REQUIRED" });
    const closure = db.prepare("SELECT snapshot_json FROM event_closures WHERE event_id=?").get(event.id);
    if (!closure) return res.status(409).json({ error: "ATTENDANCE_PDF_LOCKED_UNTIL_CLOSED" });
    const report = JSON.parse(closure.snapshot_json);
    const language = req.query.lang === "hu" ? "hu" : "en";
    const title = language === "hu" ? event.title_hu : event.title_en;
    try {
      const pdf = generateGuestListPdf({ event: { title, dateLabel: formatEventDate(event, language) }, guests: report.attendance_rows || [], language, closed: true });
      const safeName = title.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "event";
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}-attendance-report.pdf"`);
      res.type("application/pdf").send(pdf);
    } catch (error) { sendError(res, Object.assign(error, { status: 500 }), "ATTENDANCE_PDF_FAILED"); }
  });

  app.post("/api/events/tickets/:id/attendance-delete", auth, admin, (req, res) => {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    const event = attendanceEvent(ticket.event_id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    if (event.attendance_mode !== "DIGITAL") return res.status(409).json({ error: event.attendance_mode === "PAPER" ? "ATTENDANCE_PAPER_MODE_ACTIVE" : "ATTENDANCE_DIGITAL_MODE_REQUIRED" });
    if (event.attendance_closed_at || db.prepare("SELECT 1 FROM event_closures WHERE event_id=?").get(ticket.event_id)) return res.status(409).json({ error: "ATTENDANCE_ALREADY_CLOSED" });
    if (["VOID", "REFUNDED"].includes(ticket.status)) return res.json({ ...attendanceRow(ticket, event), deleted: true, refund_review: db.prepare("SELECT * FROM event_ticket_refund_reviews WHERE ticket_id=? ORDER BY created_at DESC LIMIT 1").get(ticket.id) || null });
    const result = db.transaction(() => {
      db.prepare("UPDATE event_tickets SET status='VOID',voided_at=CURRENT_TIMESTAMP,voided_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, ticket.id);
      db.prepare("INSERT INTO event_checkins(id,event_id,ticket_id,result,performed_by_user_id,details) VALUES(?,?,?,'VOID',?,?)").run(newId("CHK"), ticket.event_id, ticket.id, req.user.id, "Guest marked deleted from digital attendance list");
      const updated = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticket.id);
      return { ticket: updated, refund_review: recordDeletedPaidTicketReview(updated, event, req.user.id) };
    })();
    audit(req, "ATTENDANCE_DELETE", "event_attendance", ticket.id, ticket, result.ticket, 1, "Guest retained with Deleted attendance status");
    res.json({ ...attendanceRow(result.ticket, event), deleted: true, refund_review: result.refund_review });
  });

  app.post("/api/events/tickets/:id/check-in", auth, admin, (req, res) => {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    const event = attendanceEvent(ticket.event_id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    if (event.attendance_mode !== "DIGITAL") return res.status(409).json({ error: event.attendance_mode === "PAPER" ? "ATTENDANCE_PAPER_MODE_ACTIVE" : "ATTENDANCE_DIGITAL_MODE_REQUIRED" });
    if (["VOID", "REFUNDED"].includes(ticket.status)) return res.status(409).json({ error: "TICKET_NOT_ACTIVE" });
    if (event.attendance_closed_at || db.prepare("SELECT 1 FROM event_closures WHERE event_id=?").get(ticket.event_id)) return res.status(409).json({ error: "ATTENDANCE_ALREADY_CLOSED" });
    const checkedIn = req.body?.checked_in !== false;
    const result = db.transaction(() => {
      const nextStatus = checkedIn ? "USED" : "VALID";
      db.prepare("UPDATE event_tickets SET status=?,checked_in_at=?,checked_in_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nextStatus, checkedIn ? new Date().toISOString() : null, checkedIn ? req.user.id : null, ticket.id);
      db.prepare("INSERT INTO event_checkins(id,event_id,ticket_id,result,performed_by_user_id,details) VALUES(?,?,?, ?,?,?)").run(newId("CHK"), ticket.event_id, ticket.id, checkedIn ? "ACCEPTED" : "REVERTED", req.user.id, checkedIn ? "Manual digital check-in" : "Manual check-in correction");
      return db.prepare("SELECT id,event_id,source_type,ticket_variant,buyer_name,attendee_name,contact_email,public_code,status,checked_in_at,checked_in_by_user_id FROM event_tickets WHERE id=?").get(ticket.id);
    })();
    audit(req, checkedIn ? "CHECK_IN" : "CHECK_IN_REVERT", "event_attendance", ticket.id, ticket, result, 1, checkedIn ? "Manual attendance recorded" : "Manual attendance corrected");
    res.json({ ...result, checked_in: result.status === "USED" });
  });

  app.post("/api/events/:id/attendance/close", auth, admin, (req, res) => {
    const event = attendanceEvent(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    if (event.attendance_mode !== "DIGITAL") return res.status(409).json({ error: event.attendance_mode === "PAPER" ? "ATTENDANCE_PAPER_MODE_ACTIVE" : "ATTENDANCE_DIGITAL_MODE_REQUIRED" });
    const existing = db.prepare("SELECT snapshot_json FROM event_closures WHERE event_id=?").get(event.id);
    if (existing) return res.status(409).json({ error: "ATTENDANCE_ALREADY_CLOSED", report: JSON.parse(existing.snapshot_json) });
    const force = Boolean(req.body?.force) && isSuperadmin(req.user);
    if (new Date(event.end_at).getTime() > Date.now() && !force) return res.status(409).json({ error: "EVENT_HAS_NOT_ENDED" });
    const report = db.transaction(() => {
      const rows = attendanceTickets(event.id);
      const counts = attendanceSummary(rows);
      const sourceCounts = rows.filter((row) => !["VOID", "REFUNDED"].includes(row.status)).reduce((map, row) => { map[row.source_type] = (map[row.source_type] || 0) + 1; return map; }, {});
      const closedEvent = { ...event, status: "CLOSED" };
      const paidNoShows = db.prepare("SELECT * FROM event_tickets WHERE event_id=? AND source_type='PURCHASE' AND status IN ('VALID','VOID')").all(event.id);
      for (const ticket of paidNoShows) recordDeletedPaidTicketReview(ticket, closedEvent, req.user.id);
      const value = { event_id: event.id, event_key: event.event_key, closed_at: new Date().toISOString(), capacity_total: Number(event.capacity_total), attendance_mode: "DIGITAL", tickets: counts, sources: sourceCounts, attendance_rows: rows, attendance_tracking: "MANUAL_DIGITAL_CHECKLIST", test_mode: true };
      db.prepare("INSERT INTO event_closures(id,event_id,snapshot_json,closed_by_user_id) VALUES(?,?,?,?)").run(newId("EVCLS"), event.id, JSON.stringify(value), req.user.id);
      db.prepare("UPDATE events SET status='CLOSED',closed_at=CURRENT_TIMESTAMP,closed_by_user_id=?,attendance_closed_at=CURRENT_TIMESTAMP,attendance_closed_by_user_id=?,closure_snapshot_json=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, req.user.id, JSON.stringify(value), req.user.id, event.id);
      return value;
    })();
    audit(req, "ATTENDANCE_CLOSE", "event_attendance", event.id, event, report, 1, "Digital guest list finalized");
    res.json(report);
  });

  app.get("/api/events/:id/attendance-report", auth, admin, (req, res) => {
    const row = db.prepare("SELECT snapshot_json FROM event_closures WHERE event_id=?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "ATTENDANCE_REPORT_NOT_FOUND" });
    res.json(JSON.parse(row.snapshot_json));
  });

  app.post("/api/events/tickets/:id/void", auth, admin, (req, res) => {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    if (ticket.source_type === "PURCHASE") return res.status(409).json({ error: "PURCHASE_TICKET_REQUIRES_REFUND" });
    if (["VOID", "REFUNDED"].includes(ticket.status)) return res.json({ ...ticket, already_void: true });
    if (ticket.status === "USED") return res.status(409).json({ error: "CHECKED_IN_TICKET_CANNOT_BE_VOIDED" });
    db.prepare("UPDATE event_tickets SET status='VOID',voided_at=CURRENT_TIMESTAMP,voided_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, ticket.id);
    if (ticket.invitation_id) db.prepare("UPDATE event_invitations SET status='REVOKED',revoked_at=CURRENT_TIMESTAMP,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, ticket.invitation_id);
    const after = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(ticket.id);
    audit(req, "VOID_TICKET", "event_tickets", ticket.id, ticket, after, 1, "Complementary or invitation ticket voided");
    res.json(after);
  });

  app.get("/api/events/tickets/:id.pdf", auth, admin, (req, res) => {
    try {
      const side = normalizeTicketSide(req.query.side, "both");
      const pdf = documentService.ticketPdfForTicket(req.params.id, req.query.language === "hu" ? "hu" : "en", side);
      const suffix = side === "front" ? "front" : side === "back" ? "back" : "two-sided";
      res.type("application/pdf").set("Content-Disposition", `attachment; filename="klavierhaus-ticket-${String(req.params.id).replace(/[^A-Za-z0-9_-]/g, "_")}-${suffix}.pdf"`).send(pdf);
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/event-payments/:id/documents", auth, admin, (req, res) => {
    const payment = db.prepare("SELECT id,event_id,status,purchaser_name,purchaser_email,amount_total,currency FROM event_payments WHERE id=?").get(req.params.id);
    if (!payment) return res.status(404).json({ error: "EVENT_PAYMENT_NOT_FOUND" });
    const paymentId = encodeURIComponent(payment.id);
    res.json({ payment, delivery: documentService.deliveryRow(`event-purchase-documents:${payment.id}`), invoice_delivery: documentService.deliveryRow(`event-invoice-document:${payment.id}`), documents: db.prepare("SELECT id,title,content_type,stored_path,invoice_number,amount,created_at FROM knowledge_base WHERE content_type='Event Invoice' AND body LIKE ? ORDER BY created_at DESC").all(`%${payment.id}%`), downloads: { tickets: `/api/event-payments/${paymentId}/tickets.pdf?side=both`, tickets_front: `/api/event-payments/${paymentId}/tickets.pdf?side=front`, tickets_back: `/api/event-payments/${paymentId}/tickets.pdf?side=back`, invoice: `/api/event-payments/${paymentId}/invoice.pdf` } });
  });
  app.get("/api/event-payments/:id/tickets.pdf", auth, admin, (req, res) => {
    try {
      const side = normalizeTicketSide(req.query.side, "both");
      const pdf = documentService.ticketPdfForPayment(req.params.id, req.query.language === "hu" ? "hu" : "en", side);
      const suffix = side === "front" ? "front" : side === "back" ? "back" : "two-sided";
      res.type("application/pdf").set("Content-Disposition", `attachment; filename="klavierhaus-tickets-${String(req.params.id).replace(/[^A-Za-z0-9_-]/g, "_")}-${suffix}.pdf"`).send(pdf);
    } catch (error) { sendError(res, error); }
  });
  app.get("/api/event-payments/:id/invoice.pdf", auth, admin, (req, res) => {
    try {
      const result = documentService.invoicePdfForPayment(req.params.id, req.query.language === "hu" ? "hu" : "en");
      res.type("application/pdf").set("Content-Disposition", `attachment; filename="klavierhaus-invoice-${String(result.invoice_number).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`).send(result.pdf);
    } catch (error) { sendError(res, error); }
  });
  app.post("/api/event-payments/:id/documents/resend", auth, admin, async (req, res) => {
    try { res.json(await documentService.sendPurchaseDocuments(req.params.id, { resend: true })); } catch (error) { sendError(res, error); }
  });
  app.post("/api/event-payments/:id/invoice/resend", auth, admin, async (req, res) => {
    try { res.json(await documentService.sendInvoiceDocument(req.params.id, { resend: true })); } catch (error) { sendError(res, error); }
  });
  app.post("/api/events/tickets/:id/resend", auth, admin, async (req, res) => {
    try { res.json(await documentService.sendTicketDocument(req.params.id, { resend: true })); } catch (error) { sendError(res, error); }
  });

  app.post("/api/public/customer-conversations", async (req, res) => {
    const ipKey = clean(req.ip || req.socket?.remoteAddress, 120);
    if (rateLimited(`conversation:${ipKey}`, 5, 10 * 60 * 1000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    const name = clean(req.body?.name, 200); const email = normalizeEmail(req.body?.email); const body = clean(req.body?.message, 5000);
    const category = clean(req.body?.category || "GENERAL", 40).toUpperCase();
    if (!name || !validEmail(email) || !body || !CONVERSATION_CATEGORIES.has(category) || req.body?.consent_contact !== true) return res.status(400).json({ error: "VALID_CONVERSATION_FIELDS_REQUIRED" });
    const rawToken = crypto.randomBytes(32).toString("base64url"); const id = newId("CONV"); const language = req.body?.language === "hu" ? "hu" : "en";
    const context = { service_id: clean(req.body?.service_id, 120) || null, piano_id: clean(req.body?.piano_id, 120) || null, event_id: clean(req.body?.event_id, 120) || null, ticket_id: clean(req.body?.ticket_id, 120) || null };
    const outsideSupportHours = !isSupportHoursOpen(new Date(), env);
    try {
      db.transaction(() => {
        db.prepare(`INSERT INTO customer_conversations(id,public_token_hash,public_token_encrypted,name,email,language,category,service_id,piano_id,event_id,ticket_id,status,consent_contact,source_path,metadata_json,last_message_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'PENDING_STAFF',1,?,?,CURRENT_TIMESTAMP)`).run(id, tokenHash(rawToken), encryptConversationToken(rawToken, conversationKey), name, email, language, category, context.service_id, context.piano_id, context.event_id, context.ticket_id, clean(req.body?.source_path, 1000), JSON.stringify({ subject: clean(req.body?.subject, 240) }));
        const messageId = newId("MSG");
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')").run(messageId, id, "CUSTOMER", name, email, body);
        if (outsideSupportHours) {
          const autoReply = language === "hu"
            ? "Köszönjük megkeresését. Jelenleg munkaidőn kívül vagyunk; e-mailben a lehető leghamarabb válaszolunk. Élő ügyfélszolgálat: New York-i idő szerint 09:00–17:00, munkanapokon."
            : "Thank you for contacting Klavierhaus. We are currently outside live support hours; we will reply by email as soon as possible. Live support: 09:00–17:00 New York time, on business days.";
          db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'READ')").run(newId("MSG"), id, "STAFF", "Klavierhaus", null, autoReply);
        }
        const conversation = db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(id);
        notifyStaff(conversation, { id: messageId, body });
      })();
    } catch (error) { return sendError(res, error); }
    if (outsideSupportHours && transactionalEmail?.sendCustomerConversationAutoReply) {
      const conversationUrl = buildConversationUrl(rawToken);
      const deliveryKey = `customer-auto-reply:${id}`;
      documentService?.recordDelivery?.({ eventKey: deliveryKey, deliveryType: "CUSTOMER_CONVERSATION_AUTO_REPLY", recipientEmail: email, conversationId: id, result: { status: "PENDING" } });
      try {
        const sent = await transactionalEmail.sendCustomerConversationAutoReply({ to: email, name, conversationUrl, language, supportHours: "09:00–17:00 New York time, business days", idempotencyKey: deliveryKey });
        documentService?.recordDelivery?.({ eventKey: deliveryKey, deliveryType: "CUSTOMER_CONVERSATION_AUTO_REPLY", recipientEmail: email, conversationId: id, result: { status: "SENT", providerMessageId: sent.providerMessageId } });
      } catch (error) {
        documentService?.recordDelivery?.({ eventKey: deliveryKey, deliveryType: "CUSTOMER_CONVERSATION_AUTO_REPLY", recipientEmail: email, conversationId: id, result: { status: error.code === "EMAIL_DELIVERY_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "FAILED", errorCode: error.code || "EMAIL_DELIVERY_FAILED" } });
      }
    }
    res.status(201).json({ ...conversationPayload(db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(id), true), access_token: rawToken, conversation_url: buildConversationUrl(rawToken), outside_support_hours: outsideSupportHours });
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
    const hasAssignment = Object.prototype.hasOwnProperty.call(req.body || {}, "assigned_user_id");
    const assigned = hasAssignment ? (clean(req.body?.assigned_user_id, 120) || null) : (row.assigned_user_id || null);
    if (assigned && !db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assigned)) return res.status(400).json({ error: "INVALID_CONVERSATION_ASSIGNEE" });
    db.prepare("UPDATE customer_conversations SET status=?,assigned_user_id=?,closed_at=CASE WHEN ?='CLOSED' THEN CURRENT_TIMESTAMP ELSE closed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, assigned, status, row.id);
    audit(req, "UPDATE", "customer_conversations", row.id, row, { status, assigned_user_id: assigned }, 1, "Customer conversation status or assignment updated");
    res.json(conversationPayload(db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(row.id)));
  });

  app.get("/api/customer-conversations/:id/report", auth, admin, (req, res) => {
    const row = db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "CONVERSATION_NOT_FOUND" });
    const messages = db.prepare("SELECT id,direction,sender_name,sender_email,sender_user_id,body,status,created_at FROM customer_messages WHERE conversation_id=? ORDER BY created_at,id").all(row.id);
    res.json({ conversation: conversationPayload(row), messages, generated_at: new Date().toISOString(), report_type: "CUSTOMER_HELPDESK_CONVERSATION" });
  });

  app.get("/api/notifications/acknowledgements", auth, admin, (_req, res) => {
    const rows = db.prepare(`SELECT n.id,n.notification_type,n.title_en,n.title_hu,n.body_en,n.body_hu,n.status,n.created_at,n.acknowledged_at,n.recipient_user_id,n.sender_user_id,
      recipient.name recipient_name,recipient.role recipient_role,sender.name sender_name
      FROM notifications n
      LEFT JOIN users recipient ON recipient.id=n.recipient_user_id
      LEFT JOIN users sender ON sender.id=n.sender_user_id
      ORDER BY n.created_at DESC LIMIT 1000`).all();
    res.json(rows);
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

module.exports = { COMPANY_KEYS, createBusinessDocumentService, readCompanyData, registerBusinessOperationsRoutes, tokenHash, validEmail, isSupportHoursOpen };

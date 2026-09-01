"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { generateTicketPdf, generateInvoicePdf } = require("./document-pdf");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONVERSATION_CATEGORIES = new Set(["SERVICE", "PIANO", "EVENT", "REFUND", "PRIVATE_CONSULTATION", "GENERAL"]);
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
    const ticketPdf = generateTicketPdf({ event: { ...event, dateLabel: formatEventDate(event, "en"), venueLabel: eventVenue(event) }, tickets, language: "en", logoPath });
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
    const pdf = generateTicketPdf({ event: { ...event, dateLabel: formatEventDate(event, "en"), venueLabel: eventVenue(event) }, tickets, language: "en", logoPath: resolveCompanyLogoPath(readCompanyData(db).logo_url, uploadDir) });
    if (!transactionalEmail?.sendEventTicketDocuments) {
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

  return Object.freeze({
    companyData: () => readCompanyData(db),
    sendPurchaseDocuments,
    sendTicketDocuments,
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
    const payload = { id: row.id, name: row.name, email: row.email, language: row.language, category: row.category, service_id: row.service_id, piano_id: row.piano_id, event_id: row.event_id, ticket_id: row.ticket_id, status: row.status, assigned_user_id: row.assigned_user_id, source_path: row.source_path, last_message_at: row.last_message_at, created_at: row.created_at, updated_at: row.updated_at };
    if (includeMessages) payload.messages = db.prepare("SELECT id,direction,sender_name,sender_email,sender_user_id,body,status,created_at FROM customer_messages WHERE conversation_id=? ORDER BY created_at,id").all(row.id);
    return payload;
  }
  function conversationByToken(token) { return db.prepare("SELECT * FROM customer_conversations WHERE public_token_hash=?").get(tokenHash(token)); }

  app.get("/api/settings/company-data", auth, admin, (_req, res) => res.json(documentService.companyData()));
  app.put("/api/settings/company-data", auth, admin, (req, res) => {
    try {
      const before = documentService.companyData();
      const after = saveCompanyData(db, { ...before, ...(req.body || {}) }, req.user.name || req.user.id);
      audit(req, "UPDATE", "company_data", "company", before, after, 1, "Company invoice data updated");
      res.json(after);
    } catch (error) { sendError(res, error); }
  });

  app.get("/api/events/:id/attendance", auth, admin, (req, res) => {
    const event = db.prepare("SELECT id,event_key,title_en,title_hu,start_at,end_at,status,capacity_total,currency FROM events WHERE id=?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    const query = clean(req.query.q, 160).toLocaleLowerCase();
    const tickets = db.prepare(`SELECT id,source_type,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,checked_in_at,checked_in_by_user_id,created_at
      FROM event_tickets WHERE event_id=? AND status IN ('VALID','USED') AND (?='' OR lower(attendee_name) LIKE '%'||?||'%' OR lower(contact_email) LIKE '%'||?||'%' OR lower(public_code) LIKE '%'||?||'%') ORDER BY lower(attendee_name),created_at`)
      .all(event.id, query, query, query, query);
    const totals = db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='USED' THEN 1 ELSE 0 END) AS present,SUM(CASE WHEN status='VALID' THEN 1 ELSE 0 END) AS no_show FROM event_tickets WHERE event_id=? AND status IN ('VALID','USED')").get(event.id);
    const closure = db.prepare("SELECT id,snapshot_json,created_at FROM event_closures WHERE event_id=?").get(event.id);
    res.json({ event, closed: Boolean(closure), tickets, totals: { total: Number(totals.total || 0), present: Number(totals.present || 0), no_show: Number(totals.no_show || 0) }, report: closure ? JSON.parse(closure.snapshot_json) : null });
  });

  app.post("/api/events/tickets/:id/check-in", auth, admin, (req, res) => {
    const ticket = db.prepare("SELECT * FROM event_tickets WHERE id=?").get(req.params.id);
    if (!ticket) return res.status(404).json({ error: "TICKET_NOT_FOUND" });
    if (["VOID", "REFUNDED"].includes(ticket.status)) return res.status(409).json({ error: "TICKET_NOT_ACTIVE" });
    if (db.prepare("SELECT 1 FROM event_closures WHERE event_id=?").get(ticket.event_id)) return res.status(409).json({ error: "ATTENDANCE_ALREADY_CLOSED" });
    const checkedIn = req.body?.checked_in !== false;
    if (checkedIn && ticket.status === "USED") return res.status(409).json({ error: "TICKET_ALREADY_CHECKED_IN", ticket: { ...ticket, checked_in: true } });
    const result = db.transaction(() => {
      const nextStatus = checkedIn ? "USED" : "VALID";
      db.prepare("UPDATE event_tickets SET status=?,checked_in_at=?,checked_in_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nextStatus, checkedIn ? new Date().toISOString() : null, checkedIn ? req.user.id : null, ticket.id);
      db.prepare("INSERT INTO event_checkins(id,event_id,ticket_id,result,performed_by_user_id,details) VALUES(?,?,?, ?,?,?)").run(newId("CHK"), ticket.event_id, ticket.id, checkedIn ? "ACCEPTED" : "REVERTED", req.user.id, checkedIn ? "Manual digital check-in" : "Manual check-in correction");
      return db.prepare("SELECT id,event_id,source_type,buyer_name,attendee_name,contact_email,public_code,status,checked_in_at,checked_in_by_user_id FROM event_tickets WHERE id=?").get(ticket.id);
    })();
    audit(req, checkedIn ? "CHECK_IN" : "CHECK_IN_REVERT", "event_attendance", ticket.id, ticket, result, 1, checkedIn ? "Manual attendance recorded" : "Manual attendance corrected");
    res.json({ ...result, checked_in: result.status === "USED" });
  });

  app.post("/api/events/:id/attendance/close", auth, admin, (req, res) => {
    const event = db.prepare("SELECT * FROM events WHERE id=?").get(req.params.id);
    if (!event) return res.status(404).json({ error: "EVENT_NOT_FOUND" });
    const existing = db.prepare("SELECT snapshot_json FROM event_closures WHERE event_id=?").get(event.id);
    if (existing) return res.status(409).json({ error: "ATTENDANCE_ALREADY_CLOSED", report: JSON.parse(existing.snapshot_json) });
    const force = Boolean(req.body?.force) && isSuperadmin(req.user);
    if (new Date(event.end_at).getTime() > Date.now() && !force) return res.status(409).json({ error: "EVENT_HAS_NOT_ENDED" });
    const report = db.transaction(() => {
      const counts = db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='USED' THEN 1 ELSE 0 END) AS present,SUM(CASE WHEN status='VALID' THEN 1 ELSE 0 END) AS no_show,SUM(CASE WHEN status='VOID' THEN 1 ELSE 0 END) AS voided,SUM(CASE WHEN status='REFUNDED' THEN 1 ELSE 0 END) AS refunded FROM event_tickets WHERE event_id=?").get(event.id);
      const sourceCounts = Object.fromEntries(db.prepare("SELECT source_type,COUNT(*) count FROM event_tickets WHERE event_id=? AND status IN ('VALID','USED') GROUP BY source_type").all(event.id).map((row) => [row.source_type, Number(row.count)]));
      const value = { event_id: event.id, event_key: event.event_key, closed_at: new Date().toISOString(), capacity_total: Number(event.capacity_total), tickets: { total: Number(counts.total || 0), present: Number(counts.present || 0), no_show: Number(counts.no_show || 0), voided: Number(counts.voided || 0), refunded: Number(counts.refunded || 0) }, sources: sourceCounts, attendance_tracking: "MANUAL_DIGITAL_CHECKLIST", test_mode: true };
      db.prepare("INSERT INTO event_closures(id,event_id,snapshot_json,closed_by_user_id) VALUES(?,?,?,?)").run(newId("EVCLS"), event.id, JSON.stringify(value), req.user.id);
      db.prepare("UPDATE events SET status='CLOSED',closed_at=CURRENT_TIMESTAMP,closed_by_user_id=?,closure_snapshot_json=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id, JSON.stringify(value), req.user.id, event.id);
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

  app.get("/api/event-payments/:id/documents", auth, admin, (req, res) => {
    const payment = db.prepare("SELECT id,event_id,status,purchaser_name,purchaser_email,amount_total,currency FROM event_payments WHERE id=?").get(req.params.id);
    if (!payment) return res.status(404).json({ error: "EVENT_PAYMENT_NOT_FOUND" });
    res.json({ payment, delivery: documentService.deliveryRow(`event-purchase-documents:${payment.id}`), documents: db.prepare("SELECT id,title,content_type,stored_path,invoice_number,amount,created_at FROM knowledge_base WHERE content_type='Event Invoice' AND body LIKE ? ORDER BY created_at DESC").all(`%${payment.id}%`) });
  });
  app.post("/api/event-payments/:id/documents/resend", auth, admin, async (req, res) => {
    try { res.json(await documentService.sendPurchaseDocuments(req.params.id, { resend: true })); } catch (error) { sendError(res, error); }
  });

  app.post("/api/public/customer-conversations", (req, res) => {
    const ipKey = clean(req.ip || req.socket?.remoteAddress, 120);
    if (rateLimited(`conversation:${ipKey}`, 5, 10 * 60 * 1000)) return res.status(429).json({ error: "TOO_MANY_REQUESTS" });
    const name = clean(req.body?.name, 200); const email = normalizeEmail(req.body?.email); const body = clean(req.body?.message, 5000);
    const category = clean(req.body?.category || "GENERAL", 40).toUpperCase();
    if (!name || !validEmail(email) || !body || !CONVERSATION_CATEGORIES.has(category) || req.body?.consent_contact !== true) return res.status(400).json({ error: "VALID_CONVERSATION_FIELDS_REQUIRED" });
    const rawToken = crypto.randomBytes(32).toString("base64url"); const id = newId("CONV"); const language = req.body?.language === "hu" ? "hu" : "en";
    const context = { service_id: clean(req.body?.service_id, 120) || null, piano_id: clean(req.body?.piano_id, 120) || null, event_id: clean(req.body?.event_id, 120) || null, ticket_id: clean(req.body?.ticket_id, 120) || null };
    try {
      db.transaction(() => {
        db.prepare(`INSERT INTO customer_conversations(id,public_token_hash,public_token_encrypted,name,email,language,category,service_id,piano_id,event_id,ticket_id,status,consent_contact,source_path,metadata_json,last_message_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'PENDING_STAFF',1,?,?,CURRENT_TIMESTAMP)`).run(id, tokenHash(rawToken), encryptConversationToken(rawToken, conversationKey), name, email, language, category, context.service_id, context.piano_id, context.event_id, context.ticket_id, clean(req.body?.source_path, 1000), JSON.stringify({ subject: clean(req.body?.subject, 240) }));
        const messageId = newId("MSG");
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')").run(messageId, id, "CUSTOMER", name, email, body);
        const conversation = db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(id);
        notifyStaff(conversation, { id: messageId, body });
      })();
    } catch (error) { return sendError(res, error); }
    res.status(201).json({ ...conversationPayload(db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(id), true), access_token: rawToken, conversation_url: `${String(websiteBaseUrl).replace(/\/$/, "")}/contact?conversation=${encodeURIComponent(rawToken)}` });
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

module.exports = { COMPANY_KEYS, createBusinessDocumentService, readCompanyData, registerBusinessOperationsRoutes, tokenHash, validEmail };

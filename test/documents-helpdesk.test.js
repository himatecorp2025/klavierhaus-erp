"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const { BOARDING_PASS, generateTicketPdf, generateInvoicePdf } = require("../server/document-pdf");
const { createBusinessDocumentService, isSupportHoursOpen } = require("../server/business-operations");
const { buildConversationAutoReplyEmail, buildInvoiceEmail } = require("../server/transactional-email");

const projectRoot = path.join(__dirname, "..");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited early with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/public/branding`);
      if (response.ok) return;
    } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Server did not become ready");
}

async function jsonRequest(baseUrl, endpoint, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, payload: await response.json() };
}

async function binaryRequest(baseUrl, endpoint, token) {
  const response = await fetch(`${baseUrl}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, contentType: response.headers.get("content-type") || "", body: Buffer.from(await response.arrayBuffer()) };
}

function documentFixture() {
  const event = {
    id: "EV-DOC-1",
    title_en: "Salon & Artistry",
    title_hu: "Szalon és művészet",
    dateLabel: "April 10, 2031 at 7:00 PM",
    venueLabel: "Klavierhaus, 790 11th Avenue, New York, NY 10019",
    currency: "USD"
  };
  const tickets = [
    { id: "T-1", attendee_name: "Daniel Kovacs", contact_email: "daniel@example.com", public_code: "KH-DEMO-001", price_cents: 12500, currency: "USD" },
    { id: "T-2", attendee_name: "Claire Mirel", contact_email: "daniel@example.com", public_code: "KH-DEMO-002", price_cents: 12500, currency: "USD" }
  ];
  const company = {
    legal_name: "Klavierhaus LLC", trade_name: "Klavierhaus", address_line1: "790 11th Avenue", address_line2: "",
    city: "New York", state: "NY", postal_code: "10019", country: "United States", tax_id: "EIN 12-3456789",
    email: "accounts@example.com", phone: "+1 212 555 0100", invoice_currency: "USD", invoice_payment_terms: "Paid at checkout", invoice_footer: "Klavierhaus LLC · New York"
  };
  const payment = { id: "PAY-DOC-1", purchaser_name: "Daniel Kovacs", purchaser_email: "daniel@example.com", amount_total: 25000, currency: "USD", created_at: "2031-04-01T13:00:00.000Z", paid_at: "2031-04-01T13:00:00.000Z" };
  return { event, tickets, company, payment };
}

test("ticket PDF uses the exact 8.5 x 3.5 inch landscape boarding-pass MediaBox", () => {
  const { event, tickets } = documentFixture();
  const pdf = generateTicketPdf({ event, tickets });
  assert.deepEqual(BOARDING_PASS, { width: 612, height: 252 });
  assert.ok(pdf.length > 1000);
  assert.match(pdf.toString("latin1"), /\/MediaBox \[0 0 612 252\]/);
});

test("invoice PDF contains US-style identity, payment, event and total data", () => {
  const { event, tickets, company, payment } = documentFixture();
  const pdf = generateInvoicePdf({ event, tickets, company, payment, invoiceNumber: "KH-2031-00000001" });
  const source = pdf.toString("latin1");
  assert.ok(pdf.length > 1000);
  assert.match(source, /\/MediaBox \[0 0 612 792\]/);
});

test("support hours are New York weekdays 09:00 inclusive through 17:00 exclusive and honor holidays", () => {
  assert.equal(isSupportHoursOpen(new Date("2026-03-02T14:00:00.000Z"), {}), true);
  assert.equal(isSupportHoursOpen(new Date("2026-03-02T22:00:00.000Z"), {}), false);
  assert.equal(isSupportHoursOpen(new Date("2026-03-07T15:00:00.000Z"), {}), false);
  assert.equal(isSupportHoursOpen(new Date("2026-03-02T14:00:00.000Z"), { SUPPORT_HOLIDAYS: "2026-03-02" }), false);
});

test("automatic helpdesk and invoice messages escape customer data and remain bilingual", () => {
  const autoReply = buildConversationAutoReplyEmail({ name: "<Guest>", conversationUrl: "https://example.com/contact?conversation=token", language: "hu" });
  assert.match(autoReply.text, /Köszönjük/);
  assert.match(autoReply.html, /&lt;Guest&gt;/);
  assert.doesNotMatch(autoReply.html, /<Guest>/);
  const invoice = buildInvoiceEmail({ purchaserName: "<Guest>", event: { title_en: "Salon", title_hu: "Szalon" }, invoiceNumber: "KH-1", payment: { amount_total: 12500, currency: "USD" } });
  assert.match(invoice.text, /számlát/i);
  assert.match(invoice.html, /&lt;Guest&gt;/);
});

test("document service creates downloadable ticket and invoice artifacts from current company data", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-documents-"));
  const dbPath = path.join(tempRoot, "documents.sqlite");
  const init = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], { cwd: projectRoot, env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: path.join(tempRoot, "backups") }, encoding: "utf8" });
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);
  const db = new Database(dbPath);
  db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES('company_data_legal_name','Klavierhaus LLC','TEST') ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value").run();
  db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES('company_data_address_line1','790 11th Avenue','TEST') ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value").run();
  db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES('company_data_postal_code','10019','TEST') ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value").run();
  db.prepare("INSERT INTO events(id,event_key,category_id,access_type,status,slug_en,slug_hu,title_en,title_hu,venue_name,venue_street,venue_city,venue_region,venue_postal_code,venue_country,start_at,end_at,capacity_total,price_cents,currency) VALUES('EV-DOC-1','DOC-1','EVC-SALON-CONCERT','PUBLIC_PAID','PUBLISHED','doc-1','doc-1-hu','Salon & Artistry','Szalon és művészet','Klavierhaus','790 11th Avenue','New York','NY','10019','US','2031-04-10T23:00:00.000Z','2031-04-11T01:00:00.000Z',2,12500,'USD')").run();
  db.prepare("INSERT INTO event_checkout_holds(id,event_id,quantity,status,expires_at,language,purchaser_name,purchaser_email,amount_total) VALUES('HOLD-DOC-1','EV-DOC-1',2,'PAID','2031-04-11T01:00:00.000Z','en','Daniel Kovacs','daniel@example.com',25000)").run();
  db.prepare("INSERT INTO event_payments(id,event_id,hold_id,status,purchaser_name,purchaser_email,quantity,amount_total,currency,stripe_checkout_session_id,stripe_payment_intent_id,paid_at) VALUES('PAY-DOC-1','EV-DOC-1','HOLD-DOC-1','PAID','Daniel Kovacs','daniel@example.com',2,25000,'USD','cs_doc_1','pi_doc_1','2031-04-01T13:00:00.000Z')").run();
  db.prepare("INSERT INTO event_tickets(id,event_id,source_type,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,event_payment_id,ticket_sequence) VALUES('T-DOC-1','EV-DOC-1','PURCHASE','Daniel Kovacs','Daniel Kovacs','daniel@example.com','KH-DOC-001','VALID',12500,'USD','PAY-DOC-1',1)").run();
  db.prepare("INSERT INTO event_tickets(id,event_id,source_type,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,event_payment_id,ticket_sequence) VALUES('T-DOC-2','EV-DOC-1','PURCHASE','Daniel Kovacs','Claire Mirel','daniel@example.com','KH-DOC-002','VALID',12500,'USD','PAY-DOC-1',2)").run();
  const service = createBusinessDocumentService({ db, uploadDir: path.join(tempRoot, "uploads"), transactionalEmail: null, websiteBaseUrl: "https://klavierhaus.com", env: { JWT_SECRET: "document-test-secret" } });
  const ticketPdf = service.ticketPdfForTicket("T-DOC-1");
  const paymentTicketsPdf = service.ticketPdfForPayment("PAY-DOC-1");
  const invoice = service.invoicePdfForPayment("PAY-DOC-1");
  assert.match(ticketPdf.toString("latin1"), /\/MediaBox \[0 0 612 252\]/);
  assert.match(paymentTicketsPdf.toString("latin1"), /\/MediaBox \[0 0 612 252\]/);
  assert.equal(invoice.invoice_number.startsWith("KH-"), true);
  db.prepare("UPDATE app_settings SET setting_value='Klavierhaus Updated LLC' WHERE setting_key='company_data_legal_name'").run();
  const updatedInvoice = service.invoicePdfForPayment("PAY-DOC-1");
  const extractedUpdatedInvoice = spawnSync("pdftotext", ["-", "-"], { input: updatedInvoice.pdf }).stdout.toString("utf8");
  assert.match(extractedUpdatedInvoice, /Klavierhaus Updated LLC/);
  const sent = service.sendPurchaseDocuments("PAY-DOC-1");
  assert.equal(typeof sent.then, "function");
  return sent.then((result) => {
    assert.equal(result.status, "NOT_CONFIGURED");
    assert.equal(fs.existsSync(path.join(tempRoot, "uploads", "documents", "tickets-PAY-DOC-1.pdf")), true);
    assert.equal(fs.existsSync(path.join(tempRoot, "uploads", "documents", "invoice-PAY-DOC-1.pdf")), true);
    assert.match(fs.readFileSync(path.join(tempRoot, "uploads", "documents", "tickets-PAY-DOC-1.pdf"), "latin1"), /\/Subtype \/Image/);
    db.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});

test("document and helpdesk HTTP routes work end to end with admin authentication", async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-route-api-"));
  const dbPath = path.join(tempRoot, "routes.sqlite");
  const backupDir = path.join(tempRoot, "backups");
  const uploadDir = path.join(tempRoot, "uploads");
  const password = "Route-test-password-123";
  const jwtSecret = "route-test-jwt-secret-that-is-longer-than-thirty-two-characters";
  const init = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], { cwd: projectRoot, env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir }, encoding: "utf8" });
  assert.equal(init.status, 0, `${init.stdout}\n${init.stderr}`);
  const db = new Database(dbPath);
  const hash = bcrypt.hashSync(password, 4);
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,is_superadmin) VALUES(?,?,?,?, 'ADMIN','Active',1)").run("ROUTE-ADMIN", "Route Admin", "route-admin@example.com", hash);
  db.prepare("INSERT INTO events(id,event_key,category_id,access_type,status,slug_en,slug_hu,title_en,title_hu,venue_name,venue_street,venue_city,venue_region,venue_postal_code,venue_country,start_at,end_at,capacity_total,price_cents,currency) VALUES('EV-ROUTE-1','ROUTE-1','EVC-SALON-CONCERT','PUBLIC_PAID','PUBLISHED','route-event','route-event-hu','Route Event','Útvonal esemény','Klavierhaus','790 11th Avenue','New York','NY','10019','US','2031-04-10T23:00:00.000Z','2031-04-11T01:00:00.000Z',2,12500,'USD')").run();
  db.prepare("INSERT INTO event_checkout_holds(id,event_id,quantity,status,expires_at,language,purchaser_name,purchaser_email,amount_total) VALUES('HOLD-ROUTE-1','EV-ROUTE-1',2,'PAID','2031-04-11T01:00:00.000Z','en','Daniel Kovacs','daniel@example.com',25000)").run();
  db.prepare("INSERT INTO event_payments(id,event_id,hold_id,status,purchaser_name,purchaser_email,quantity,amount_total,currency,stripe_checkout_session_id,stripe_payment_intent_id,paid_at) VALUES('PAY-ROUTE-1','EV-ROUTE-1','HOLD-ROUTE-1','PAID','Daniel Kovacs','daniel@example.com',2,25000,'USD','cs_route_1','pi_route_1','2031-04-01T13:00:00.000Z')").run();
  db.prepare("INSERT INTO event_tickets(id,event_id,source_type,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,event_payment_id,ticket_sequence) VALUES('T-ROUTE-1','EV-ROUTE-1','PURCHASE','Daniel Kovacs','Daniel Kovacs','daniel@example.com','KH-ROUTE-001','VALID',12500,'USD','PAY-ROUTE-1',1)").run();
  db.prepare("INSERT INTO event_tickets(id,event_id,source_type,buyer_name,attendee_name,contact_email,public_code,status,price_cents,currency,event_payment_id,ticket_sequence) VALUES('T-ROUTE-2','EV-ROUTE-1','PURCHASE','Daniel Kovacs','Claire Mirel','daniel@example.com','KH-ROUTE-002','VALID',12500,'USD','PAY-ROUTE-1',2)").run();
  db.close();

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const forcedHoliday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const child = spawn(process.execPath, [path.join(projectRoot, "server", "index.js")], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), DB_PATH: dbPath, BACKUP_DIR: backupDir, UPLOAD_DIR: uploadDir, JWT_SECRET: jwtSecret, WEBSITE_BASE_URL: "https://klavierhaus.com", SUPPORT_HOLIDAYS: forcedHoliday, RESEND_API_KEY: "", RESEND_FROM: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => {
    if (child.exitCode === null) child.kill("SIGTERM");
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  await waitForServer(baseUrl, child).catch((error) => { throw new Error(`${error.message}\n${output}`); });

  const login = await jsonRequest(baseUrl, "/api/login", { method: "POST", body: { email: "route-admin@example.com", password } });
  assert.equal(login.status, 200, JSON.stringify(login.payload));
  const token = login.payload.token;
  for (const endpoint of ["/api/events/tickets/T-ROUTE-1.pdf", "/api/event-payments/PAY-ROUTE-1/tickets.pdf", "/api/event-payments/PAY-ROUTE-1/invoice.pdf"]) {
    const document = await binaryRequest(baseUrl, endpoint, token);
    assert.equal(document.status, 200, endpoint);
    assert.match(document.contentType, /application\/pdf/);
    assert.ok(document.body.length > 1000, endpoint);
  }
  const resendInvoice = await jsonRequest(baseUrl, "/api/event-payments/PAY-ROUTE-1/invoice/resend", { token, method: "POST", body: {} });
  assert.equal(resendInvoice.status, 200, JSON.stringify(resendInvoice.payload));
  assert.equal(resendInvoice.payload.status, "NOT_CONFIGURED");

  const conversation = await jsonRequest(baseUrl, "/api/public/customer-conversations", { method: "POST", body: { name: "Route Guest", email: "guest@example.com", category: "TECHNICAL", language: "en", message: "Please help with the ticket.", consent_contact: true, source_path: "/events/route-event" } });
  assert.equal(conversation.status, 201, JSON.stringify(conversation.payload));
  assert.equal(conversation.payload.outside_support_hours, true);
  assert.ok(conversation.payload.messages.some((message) => message.direction === "STAFF"));
  const conversations = await jsonRequest(baseUrl, "/api/customer-conversations", { token });
  assert.equal(conversations.status, 200);
  assert.equal(conversations.payload.length, 1);
  const conversationId = conversations.payload[0].id;
  const assigned = await jsonRequest(baseUrl, `/api/customer-conversations/${encodeURIComponent(conversationId)}`, { token, method: "PATCH", body: { assigned_user_id: "ROUTE-ADMIN", status: "CLOSED" } });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.payload));
  assert.equal(assigned.payload.status, "CLOSED");
  assert.equal(assigned.payload.assigned_user_name, "Route Admin");
  const report = await jsonRequest(baseUrl, `/api/customer-conversations/${encodeURIComponent(conversationId)}/report`, { token });
  assert.equal(report.status, 200);
  assert.equal(report.payload.report_type, "CUSTOMER_HELPDESK_CONVERSATION");
  assert.ok(report.payload.messages.length >= 2);
  const acknowledgementHistory = await jsonRequest(baseUrl, "/api/notifications/acknowledgements", { token });
  assert.equal(acknowledgementHistory.status, 200);
  assert.ok(Array.isArray(acknowledgementHistory.payload));
});

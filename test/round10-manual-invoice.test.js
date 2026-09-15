"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PAYMENT_METHODS, normalizePaymentMethod } = require("../server/payment-methods");
const { generateBusinessInvoicePdf } = require("../server/document-pdf");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const STANDARD = ["Credit Card", "Bank Transfer / ACH", "Zelle", "Check", "Payment Link", "PayPal", "Cash"];

test("seven payment methods are centralized and legacy runtime values are rejected", () => {
  assert.deepEqual(PAYMENT_METHODS, STANDARD);
  for (const method of STANDARD) assert.equal(normalizePaymentMethod(method, { allowEmpty: false }), method);
  for (const legacy of ["wire", "electronic", "direct debit", "Bank Transfer", "BANK_TRANSFER", "ON_SITE", "STRIPE_TEST"]) {
    assert.equal(normalizePaymentMethod(legacy, { allowEmpty: false }), null, legacy);
  }
  const schema = read("server/schema.sql");
  for (const method of STANDARD) assert.match(schema, new RegExp(method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(read("server/stripe-sandbox.js"), /paymentMethod:\s*"Credit Card"/);
  assert.doesNotMatch(read("server/stripe-sandbox.js"), /STRIPE_TEST/);
});

test("manual invoice UI is adjacent to monthly export and contains all required controls", () => {
  const app = read("public/app.js");
  assert.match(app, /Export Monthly Statement \(PDF\)[\s\S]{0,700}Create Invoice \/ Bill/);
  assert.match(app, /openManualInvoiceModal/);
  assert.match(app, /Receivable \/ Outgoing/);
  assert.match(app, /Payable \/ Incoming/);
  assert.match(app, /Search clients and partners/);
  assert.match(app, /Add New Partner\.\.\./);
  assert.match(app, /addManualInvoiceItem/);
  assert.match(app, /Taxable Base/);
  assert.match(app, /Payment Link URL/);
  assert.match(app, /Financial Status/);
  assert.match(app, /Preview Invoice/);
  assert.match(app, /Number assigned only on save/);
});

test("manual invoice API allocates a number only during the save transaction and books paid invoices", () => {
  const ops = read("server/business-operations.js");
  assert.match(ops, /app\.post\("\/api\/invoices\/manual"/);
  assert.match(ops, /sourceType:\s*"manual"/);
  assert.match(ops, /financialStatus === "paid" \? "paid" : "issued"/);
  assert.match(ops, /db\.transaction\(\(\) => \{[\s\S]*invoiceEngine\.createInvoice[\s\S]*invoiceEngine\.postManualInvoiceLedger/);
  assert.match(ops, /nextNumber\(direction, date\)/);
  assert.match(ops, /paymentLinkUrl/);
  assert.match(ops, /notes/);
  assert.match(ops, /PAYABLE_REQUIRES_PARTNER/);
});

test("inline partner creation persists, refreshes and auto-selects the new partner", () => {
  const app = read("public/app.js");
  assert.match(app, /openInlinePartnerFromInvoice/);
  assert.match(app, /api\('\/api\/partners'/);
  assert.match(app, /refreshManualInvoiceCounterparties\(saved\.id\)/);
  assert.match(app, /selectManualInvoiceCounterparty\('partner',saved\.id\)/);
  assert.match(app, /default_tax_rate/);
});

test("saved invoice preview exposes PDF and print and the invoice PDF supports multi-page itemization", () => {
  const app = read("public/app.js");
  assert.match(app, /previewInvoice\(id\)/);
  assert.match(app, /downloadInvoicePdf/);
  assert.match(app, /printInvoice/);

  const items = Array.from({ length: 13 }, (_, index) => ({
    item_description: `Service line ${index + 1}`,
    quantity: 1,
    unit_price: 100 + index,
    total_price: 100 + index
  }));
  const subtotal = items.reduce((sum, item) => sum + item.total_price, 0);
  const pdf = generateBusinessInvoicePdf({
    company: { trade_name: "Klavierhaus", address_line1: "New York, NY", email: "office@example.com", phone: "212-555-0100" },
    invoice: {
      direction: "receivable", invoice_number: "INV-2026-0001", issue_date: "2026-09-15", due_date: "2026-10-15",
      subtotal, tax_rate: 0, tax_amount: 0, total_amount: subtotal, currency: "USD", payment_method: "Payment Link",
      payment_link_url: "https://example.com/pay", notes: "Thank you", status: "issued",
      counterparty_address: "Manhattan, New York", counterparty_tax_id: "TAX-1", counterparty_contact: "Jane Doe"
    },
    items,
    counterpartyName: "Acme Music"
  });
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.ok((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length >= 2);
});

test("global runtime payment inputs are canonicalized and old names are confined to migration aliases", () => {
  const runtimeFiles = ["public/app.js", "server/index.js", "server/job-domain.js", "server/business-operations.js", "server/ticket-service.js", "server/stripe-sandbox.js"];
  const forbiddenPaymentAssignments = [
    /paymentMethod\s*:\s*["']STRIPE_TEST["']/, /paymentMethod\s*:\s*["']Bank Transfer["']/,
    /payment_method\s*:\s*["']ON_SITE["']/, /payment_method\s*:\s*["']BANK_TRANSFER["']/,
    /payment_method\s*:\s*["']CASH["']/, /initialValue\s*:\s*["']ON_SITE["']/
  ];
  for (const file of runtimeFiles) {
    const source = read(file);
    for (const pattern of forbiddenPaymentAssignments) assert.doesNotMatch(source, pattern, `${file} ${pattern}`);
  }
  const migration = read("server/init-db.js");
  assert.match(migration, /DIRECT DEBIT/);
  assert.match(migration, /STRIPE_TEST/);
  assert.match(migration, /normalizePaymentMethodColumns/);
});

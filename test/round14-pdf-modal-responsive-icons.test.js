"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generateBusinessInvoicePdf } = require("../server/document-pdf");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("business invoice PDF uses one-based months, complete QTY/TAX glyphs and dynamic issuer fields", () => {
  const source = read("server/document-pdf.js");
  assert.match(source, /date\.getMonth\(\) \+ 1/);
  assert.match(source, /textCommand\(`Issue Date: \$\{formatPdfDate\(invoice\.issue_date\)\}`/);
  assert.match(source, /"DESCRIPTION", "QTY", "UNIT PRICE", "LINE TOTAL"/);
  assert.match(source, /"TAX \(0\.00%\)", "%"/);
  assert.match(source, /company\.address_line1/);
  assert.match(source, /company\.tax_id/);
  assert.doesNotMatch(source, /2026-00-/);
  const pdf = generateBusinessInvoicePdf({
    company: { trade_name: "Klavierhaus", address_line1: "Dynamic Address", city: "New York", state: "NY", postal_code: "10001", tax_id: "DYNAMIC-TAX", email: "billing@example.com", phone: "+1 212 555 0100" },
    invoice: { direction: "receivable", invoice_number: "INV-2026-0042", issue_date: new Date(2026, 8, 15), due_date: new Date(2026, 9, 15), summary: "Piano service", subtotal: 100, tax_rate: 0, tax_amount: 0, total_amount: 100, payment_method: "Bank Transfer / ACH", status: "issued", counterparty_address: "Client Address" },
    items: [{ item_description: "Regulation", quantity: 1, unit_price: 100, total_price: 100, payment_method: "Bank Transfer / ACH", financial_status: "Pending" }],
    counterpartyName: "Client"
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length > 10000);
});

test("manual invoice dates support typed MM/DD/YYYY plus calendar selection and strict three-character validation", () => {
  const app = read("public/app.js");
  const css = read("public/styles.css");
  const ops = read("server/business-operations.js");
  assert.match(app, /function manualInvoiceDateControl[\s\S]*type="text" inputmode="numeric"[\s\S]*placeholder="MM\/DD\/YYYY"/);
  assert.match(app, /workflowBindDatePicker\(field\)/);
  assert.match(app, /name="summary" required minlength="3"/);
  assert.match(app, /name="item_description" required aria-required="true" minlength="3"/);
  assert.match(app, /manualInvoiceSaveButton" type="submit" disabled/);
  assert.match(app, /String\(input\.value\|\|''\)\.trim\(\)\.length<3/);
  assert.match(app, /missingDescription=String\(description\?\.value\|\|''\)\.trim\(\)\.length<3/);
  assert.match(css, /#manualInvoiceForm \[name="summary"\]\[aria-invalid="true"\]/);
  assert.match(ops, /summary\.trim\(\)\.length < 3/);
  assert.match(ops, /item_description\.trim\(\)\.length < 3/);
});

test("missing counterparty exposes inline create-now prompt and Pages & Content is exclusive", () => {
  const app = read("public/app.js");
  const index = read("server/index.js");
  assert.match(app, /Partner not found\. Create now\?/);
  assert.match(app, /Client not found\. Create now\?/);
  assert.match(app, /openInlineCounterpartyFromInvoice/);
  assert.doesNotMatch(app, /\["website_design","[^"]+"/);
  assert.doesNotMatch(index, /key:\s*"website_design"/);
  assert.match(app, /\["pages_content","Pages & Content"/);
});

test("all administration dialog classes receive viewport containment and mobile one-column rules", () => {
  const css = read("public/styles.css");
  assert.match(css, /max-width:min\(92vw,680px\)/);
  assert.match(css, /max-width:min\(94vw,1100px\)/);
  assert.match(css, /max-height:calc\(100vh - 32px\)/);
  assert.match(css, /@media\(max-width:768px\)/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\)!important/);
  assert.match(css, /\.digital-attendance-modal-shell\{align-items:center!important;padding:16px!important\}/);
  assert.match(css, /\.workflow-drawer\{position:fixed;inset:16px/);
  assert.match(css, /\.admin-date-picker-popover\{max-width:calc\(100vw - 32px\)\}/);
});

test("requested administration cards render premium off-white inline SVG icons instead of legacy card glyphs", () => {
  const app = read("public/app.js");
  const css = read("public/styles.css");
  for (const key of ["event_tickets", "event_guest_list", "pianos", "finance", "income_statement", "knowledge_base", "partners", "scheduler"]) {
    assert.match(app, new RegExp(`${key}:'<`));
  }
  assert.match(app, /class="admin-premium-icon" viewBox="0 0 24 24"/);
  assert.match(css, /\.admin-premium-icon\{[^}]*stroke:currentColor[^}]*stroke-width:1\.7[^}]*color:#e6e4df/);
  assert.doesNotMatch(app, /\["event_tickets"[^\n]*"🎫"/);
  assert.doesNotMatch(app, /\["pianos"[^\n]*"🎹"/);
  assert.doesNotMatch(app, /\["finance"[^\n]*"💵"/);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generateBusinessInvoicePdf } = require("../server/document-pdf");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const methods = ["Credit Card", "Bank Transfer / ACH", "Zelle", "Check", "Payment Link", "PayPal", "Cash"];

test("manual payment and status controls are native-accessible and expose all seven methods", () => {
  const app = read("public/app.js");
  assert.ok(app.includes('id="manualPaymentMethod" class="manual-native-select" name="payment_method" data-native-select="true"'));
  assert.ok(app.includes('id="manualFinancialStatus" class="manual-native-select" name="financial_status" data-native-select="true"'));
  assert.ok(app.includes('<option value="Pending">Pending</option><option value="Paid">Paid</option>'));
  assert.ok(app.includes('name="item_payment_method" data-native-select="true"'));
  assert.ok(app.includes('name="item_financial_status" data-native-select="true"'));
  for (const method of methods) assert.ok(app.includes(method));
  assert.match(app, /method\.addEventListener\('change'/);
  assert.match(app, /status\.addEventListener\('change'/);
  assert.match(app, /items:items\.map\(item=>\(\{\.\.\.item[\s\S]*payment_method:item\.payment_method\|\|data\.payment_method[\s\S]*financial_status:item\.financial_status\|\|data\.financial_status/);
});

test("description is required and preview/save share the same line validation", () => {
  const app = read("public/app.js");
  const css = read("public/styles.css");
  assert.ok(app.includes('name="item_description" required aria-required="true"'));
  assert.match(app, /function validateManualInvoiceItems/);
  assert.match(app, /manual-field-invalid/);
  assert.match(app, /Service \/ item description is required on every line/);
  assert.match(app, /function collectManualInvoicePayload\(\)[\s\S]*validateManualInvoiceItems/);
  assert.match(app, /function previewManualInvoiceDraft\(\)[\s\S]*collectManualInvoicePayload/);
  assert.match(css, /\.manual-field-invalid\{border-color:#f87171!important/);
});

test("counterparty menu is focus-bound, absolute and supports inline client plus partner creation", () => {
  const app = read("public/app.js");
  const css = read("public/styles.css");
  assert.match(app, /if\(document\.activeElement!==search\)\{closeManualInvoiceCounterpartyMenu\(\);return;\}/);
  assert.match(app, /addEventListener\('blur',[\s\S]{0,300}closeManualInvoiceCounterpartyMenu/);
  assert.match(app, /addEventListener\('pointerdown',outsideClose\)/);
  assert.match(app, /addEventListener\('touchstart',outsideClose/);
  assert.match(css, /\.manual-counterparty-menu\{position:absolute;/);
  assert.match(app, /Add New Client\.\.\./);
  assert.match(app, /Add New Partner\.\.\./);
  assert.match(app, /api\(isPartner\?'\/api\/partners':'\/api\/contacts'/);
  assert.match(app, /refreshManualInvoiceCounterparties\(\{type,id:saved\.id\}\)/);
  assert.match(app, /selectManualInvoiceCounterparty\(type,saved\.id\)/);
});

test("client tax id and item-level settlement persist through schema and backend", () => {
  const schema = read("server/schema.sql");
  const init = read("server/init-db.js");
  const ops = read("server/business-operations.js");
  const index = read("server/index.js");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS contacts \([\s\S]*billing_address TEXT,[\s\S]*tax_id TEXT,/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS invoice_items \([\s\S]*payment_method TEXT CHECK[\s\S]*financial_status TEXT CHECK/);
  assert.match(init, /ensureColumn\("contacts", "tax_id", "TEXT"\)/);
  assert.match(init, /ensureColumn\("invoice_items", "payment_method"/);
  assert.match(init, /ensureColumn\("invoice_items", "financial_status"/);
  assert.match(index, /createResourceRoutes\("contacts"[\s\S]*"tax_id"/);
  assert.match(ops, /SELECT id,name,company,email,phone,address,billing_address,tax_id FROM contacts/);
  assert.match(ops, /RECEIVABLE_REQUIRES_CLIENT/);
  assert.match(ops, /INVALID_ITEM_PAYMENT_METHOD/);
  assert.match(ops, /INVALID_ITEM_FINANCIAL_STATUS/);
  assert.match(ops, /INSERT INTO invoice_items\(id,invoice_id,item_description,quantity,unit_price,total_price,line_type,payment_method,financial_status\)/);
});

test("partial settlement ledger books only paid lines and reconciles on status changes", () => {
  const ops = read("server/business-operations.js");
  assert.match(ops, /const paidItems = items\.filter\(\(item\) => \(item\.financial_status \|\| invoiceStatus\) === "paid"\)/);
  assert.match(ops, /const paidSubtotal = money\(paidItems\.reduce/);
  assert.match(ops, /const paidAmount = money\(paidSubtotal \+ paidSubtotal \* Number\(invoice\.tax_rate \|\| 0\) \/ 100\)/);
  assert.match(ops, /UPDATE financial_items SET item_date=\?,title=\?,description=\?,amount=/);
  assert.match(ops, /if \(updated\.source_type === "manual"\) invoiceEngine\.postManualInvoiceLedger\(updated, req\.user\)/);
});

test("preview and PDF render item settlement details and remain multi-page", () => {
  const app = read("public/app.js");
  const pdfSource = read("server/document-pdf.js");
  assert.match(app, /manualInvoicePreviewButton[\s\S]*addEventListener\('click'/);
  assert.match(app, /manual-line-settlement/);
  assert.match(pdfSource, /Payment: \$\{item\.payment_method\}/);
  assert.match(pdfSource, /Status: \$\{String\(item\.financial_status\)/);
  assert.match(pdfSource, /index \+= 9/);
  const items = Array.from({length: 11}, (_, index) => ({
    item_description: `Line ${index + 1}`,
    quantity: 1,
    unit_price: 25,
    total_price: 25,
    payment_method: index % 2 ? "Cash" : "Zelle",
    financial_status: index % 3 ? "paid" : "pending"
  }));
  const subtotal = 275;
  const pdf = generateBusinessInvoicePdf({
    company: { trade_name: "Klavierhaus", address_line1: "New York, NY" },
    invoice: { direction: "receivable", invoice_number: "INV-2026-TEST", issue_date: "2026-09-15", due_date: "2026-10-15", subtotal, tax_rate: 0, tax_amount: 0, total_amount: subtotal, currency: "USD", payment_method: "Credit Card", status: "issued" },
    items,
    counterpartyName: "Test Client"
  });
  assert.equal(pdf.subarray(0,5).toString("ascii"), "%PDF-");
  assert.ok((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length >= 2);
});

test("dark scrollbar contract is applied globally and manual invoice direction colors are explicit", () => {
  const css = read("public/styles.css");
  assert.match(css, /\*\{scrollbar-width:thin!important;scrollbar-color:rgba\(230,228,223,\.2\) transparent!important\}/);
  assert.match(css, /\*::-webkit-scrollbar\{width:6px!important;height:6px!important\}/);
  assert.match(css, /background:rgba\(0,0,0,\.2\)!important/);
  assert.match(css, /background:rgba\(230,228,223,\.2\)!important/);
  assert.match(css, /background:rgba\(230,228,223,\.4\)!important/);
  assert.match(css, /\.manual-invoice-card\.receivable[\s\S]*#86efac/);
  assert.match(css, /\.manual-invoice-card\.payable[\s\S]*#fb7185/);
});

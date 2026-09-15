"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { PAYMENT_METHODS, normalizePaymentMethod } = require("../server/payment-methods");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const STANDARD = ["Credit Card", "Bank Transfer / ACH", "Zelle", "Check", "Payment Link", "PayPal", "Cash"];

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0;
  let bodyStarted = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") { depth += 1; bodyStarted = true; }
    else if (source[i] === "}") {
      depth -= 1;
      if (bodyStarted && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} could not be extracted`);
}

test("the canonical seven-method contract is exact and legacy runtime aliases are rejected", () => {
  assert.deepEqual(PAYMENT_METHODS, STANDARD);
  for (const method of STANDARD) assert.equal(normalizePaymentMethod(method, { allowEmpty: false }), method);
  for (const legacy of ["wire", "electronic", "direct debit", "Bank Transfer", "STRIPE_TEST", "ON_SITE"]) {
    assert.equal(normalizePaymentMethod(legacy, { allowEmpty: false }), null, legacy);
  }
});

test("manual invoice quantity, decimal normalization, counterparty payload and change handlers are deterministic", () => {
  const app = read("public/app.js");
  assert.match(app, /name="quantity" type="number" min="1" step="1" value="\$\{quantity\}"/);
  assert.match(app, /name="unit_price" type="text" inputmode="decimal"/);
  assert.match(app, /name="default_tax_rate" type="text" inputmode="decimal"/);
  assert.match(app, /partner_id:counterparty\.type==='partner'\?counterparty\.id:null/);
  assert.match(app, /client_id:counterparty\.type==='client'\?counterparty\.id:null/);
  assert.match(app, /method\.addEventListener\('change'/);
  assert.match(app, /status\.addEventListener\('change'/);
  assert.match(app, /Math\.round\(\(number\+Number\.EPSILON\)\*100\)\/100/);

  const context = {};
  vm.createContext(context);
  vm.runInContext(`${extractFunction(app, "parseFinancialNumber")};${extractFunction(app, "roundFinancial")};this.parseFinancialNumber=parseFinancialNumber;this.roundFinancial=roundFinancial;`, context);
  assert.equal(context.parseFinancialNumber("1000,00"), 1000);
  assert.equal(context.parseFinancialNumber("1000.00"), 1000);
  assert.equal(context.parseFinancialNumber("1.234,56"), 1234.56);
  assert.equal(context.parseFinancialNumber("1,234.56"), 1234.56);
  assert.equal(context.roundFinancial(1.005), 1.01);
});

test("manual invoice backend accepts explicit partner/client ids, comma decimals and blocks invalid or zero items", () => {
  const ops = read("server/business-operations.js");
  assert.match(ops, /explicitPartnerId = clean\(req\.body\?\.partner_id/);
  assert.match(ops, /explicitClientId = clean\(req\.body\?\.client_id/);
  assert.match(ops, /parseFinancialNumber\(item\?\.unit_price\)/);
  assert.match(ops, /Number\.isInteger\(item\.quantity\)/);
  assert.match(ops, /INVOICE_TOTAL_REQUIRED/);
  assert.match(ops, /roundFinancial\(settledItems\.reduce/);
  assert.match(ops, /parsedRate = parseFinancialNumber\(req\.body\?\.default_tax_rate/);
});

test("workflow finalization requires one of seven methods and propagates it to invoice and ledger", () => {
  const ui = read("public/app.js");
  const workflow = read("server/workshop-workflow.js");
  const ops = read("server/business-operations.js");
  assert.match(ui, /workflowFinalize\(id\).*chooseStandardPaymentMethod/s);
  assert.match(ui, /payment_method:paymentMethod/);
  assert.match(workflow, /normalizePaymentMethod\(req\.body\?\.payment_method/);
  assert.match(workflow, /paymentMethod,/);
  assert.match(workflow, /createWorkflowInvoice\(\{ workflow,[\s\S]*paymentMethod \}\)/);
  assert.match(ops, /createWorkflowInvoice\(\{ workflow,[\s\S]*requestedPaymentMethod/);
  assert.match(ops, /paymentMethod: method, status: "issued"/);
  assert.match(ops, /balanceAccountFromPaymentMethod\(method\)/);
});

test("on-site and pending public-paid tickets use the seven-option chooser before mark-paid", () => {
  const ui = read("public/app.js");
  const ops = read("server/business-operations.js");
  assert.match(ui, /markEventTicketPaid\(ticketId\)[\s\S]*chooseStandardPaymentMethod/);
  assert.match(ui, /pendingPaid=\['ON_SITE','PUBLIC_PAID'\]\.includes\(row\.ticket_variant\).*Number\(row\.price_cents\|\|0\)>0/);
  assert.match(ops, /\["ON_SITE", "PUBLIC_PAID"\]\.includes\(ticket\.ticket_variant\)/);
  assert.match(ops, /allowed: PAYMENT_METHODS/);
});

test("public paid-event checkout renders all seven methods and only Credit Card enters Stripe", () => {
  const website = read("website/server/index.js");
  const client = read("website/server/event-client.js");
  const events = read("server/events.js");
  const stripe = read("server/stripe-sandbox.js");
  assert.match(website, /const \{ PAYMENT_METHODS \} = require\("\.\.\/\.\.\/server\/payment-methods"\)/);
  assert.match(website, /PAYMENT_METHODS\.map\(\(method\) => `<option/);
  assert.match(website, /name="payment_method" required/);
  assert.match(website, /name="contact_email" type="email"/);
  assert.match(client, /payment_method: paymentMethod, contact_email: contactEmail/);
  assert.match(events, /normalizePaymentMethod\(req\.body\?\.payment_method/);
  assert.match(events, /if \(paymentMethod === "Credit Card"\)/);
  assert.match(events, /paymentStatus: "PENDING"/);
  assert.match(events, /reservationStatus: "RESERVED"/);
  assert.match(events, /checkout_available: Boolean\(row\.access_type === "PUBLIC_PAID"/);
  assert.match(stripe, /payment_method_types: \["card"\]/);
  assert.match(stripe, /customer_email: normalizeEmail\(purchaserEmail\)/);
});

test("manual invoice preview uses SVG controls and responsive billing CSS", () => {
  const app = read("public/app.js");
  const css = read("public/styles.css");
  assert.match(app, /function billingIcon\(/);
  for (const icon of ["eye", "check", "close", "calendar", "download", "print"]) assert.match(app, new RegExp(`billingIcon\\(['\"]${icon}['\"]`));
  assert.match(css, /\.billing-svg-icon\{/);
  assert.match(css, /color:#e6e4df/);
  assert.match(css, /\.manual-invoice-totals\{margin-left:auto/);
  assert.match(css, /@media\(max-width:820px\)/);
});



test("every user-facing payment selection path is sourced from the seven-method standard", () => {
  const app = read("public/app.js");
  const website = read("website/server/index.js");
  const content = read("website/server/site-content.js");
  assert.match(app, /const STANDARD_PAYMENT_METHODS=\["Credit Card","Bank Transfer \/ ACH","Zelle","Check","Payment Link","PayPal","Cash"\]/);
  assert.match(app, /function paymentOptions\(selected=""\)\{\s*return standardPaymentMethodOptions\(selected\)/);
  assert.match(app, /Close Job[\s\S]*standardPaymentMethodOptions\(\)/);
  assert.match(app, /workflowFinalize\(id\)[\s\S]*chooseStandardPaymentMethod/);
  assert.match(app, /openManualInvoiceModal\(\)[\s\S]*standardPaymentMethodOptions\(\)/);
  assert.match(app, /markEventTicketPaid\(ticketId\)[\s\S]*chooseStandardPaymentMethod/);
  assert.match(app, /individualTicketVariant[\s\S]*standardPaymentMethodOptions\('Cash'\)/);
  assert.match(website, /PAYMENT_METHODS\.map\(\(method\) => `<option/);
  for (const method of STANDARD) assert.ok(content.includes(method), `${method} missing from public payment terms`);
  assert.doesNotMatch(content, /Cash and pay-at-the-door reservations are excluded/);
});


test("non-Stripe public-paid ticket refunds keep the original canonical payment method", () => {
  const events = read("server/events.js");
  assert.match(events, /function recordNonStripeTicketRefund\(ticket, event/);
  assert.match(events, /normalizePaymentMethod\(ticket\?\.payment_method, \{ allowEmpty: false \}\)/);
  assert.match(events, /source_type='event_manual_ticket_refund'/);
  assert.match(events, /nonStripePaidTickets = db\.prepare/);
  assert.match(events, /ticket\?\.source_type === "PURCHASE" && ticket\.event_payment_id/);
  assert.match(events, /ticket\?\.source_type === "PURCHASE" && ticket\.payment_status === "PAID"/);
});
test("workflow close history exposes the actual invoice number and payment method", () => {
  const server = read("server/index.js");
  assert.match(server, /wi\.payment_method AS payment_method/);
  assert.match(server, /wi\.invoice_number AS invoice_number/);
  assert.match(server, /LEFT JOIN invoices wi ON wi\.source_type='workflow'/);
});

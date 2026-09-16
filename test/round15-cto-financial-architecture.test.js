"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildAccountingSnapshot, roundMoney, isInvoiceDerivedFinancialItem } = require("../server/accounting-domain");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function block(source, startNeedle, endNeedle, last = false) {
  const start = last ? source.lastIndexOf(startNeedle) : source.indexOf(startNeedle);
  assert.notEqual(start, -1, `Missing block start: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `Missing block end: ${endNeedle}`);
  return source.slice(start, end);
}

test("US GAAP invoice-state accounting remains balanced through pending/paid/void transitions", () => {
  const directExpense = { main_type: "EXPENSE", amount: 10, source_type: "workflow_financial_line" };
  assert.equal(isInvoiceDerivedFinancialItem(directExpense), false, "workflow phase cost must remain a real direct expense");
  assert.equal(roundMoney(1.005), 1.01);

  const cases = [
    {
      label: "pending receivable",
      invoices: [{ direction: "receivable", status: "issued", total_amount: 100 }],
      direct: [],
      expected: { cashBankAccounts: 0, accountsReceivable: 100, accountsPayable: 0, currentPeriodNetIncome: 100 }
    },
    {
      label: "paid receivable",
      invoices: [{ direction: "receivable", status: "paid", total_amount: 100 }],
      direct: [],
      expected: { cashBankAccounts: 100, accountsReceivable: 0, accountsPayable: 0, currentPeriodNetIncome: 100 }
    },
    {
      label: "pending contractor payable",
      invoices: [
        { direction: "receivable", status: "paid", total_amount: 100 },
        { direction: "payable", status: "issued", total_amount: 40 }
      ],
      direct: [],
      expected: { cashBankAccounts: 100, accountsReceivable: 0, accountsPayable: 40, currentPeriodNetIncome: 60 }
    },
    {
      label: "paid contractor payable",
      invoices: [
        { direction: "receivable", status: "paid", total_amount: 100 },
        { direction: "payable", status: "paid", total_amount: 40 }
      ],
      direct: [],
      expected: { cashBankAccounts: 60, accountsReceivable: 0, accountsPayable: 0, currentPeriodNetIncome: 60 }
    },
    {
      label: "workflow direct phase cost",
      invoices: [{ direction: "receivable", status: "paid", total_amount: 100 }],
      direct: [directExpense],
      expected: { cashBankAccounts: 90, accountsReceivable: 0, accountsPayable: 0, currentPeriodNetIncome: 90 }
    },
    {
      label: "void invoice excluded",
      invoices: [
        { direction: "receivable", status: "paid", total_amount: 100 },
        { direction: "receivable", status: "void", total_amount: 9999 }
      ],
      direct: [],
      expected: { cashBankAccounts: 100, accountsReceivable: 0, accountsPayable: 0, currentPeriodNetIncome: 100 }
    }
  ];

  for (const row of cases) {
    const snapshot = buildAccountingSnapshot({
      monthInvoices: row.invoices,
      monthDirectItems: row.direct,
      asOfInvoices: row.invoices,
      asOfDirectItems: row.direct
    });
    for (const [key, value] of Object.entries(row.expected)) assert.equal(snapshot.balance[key], value, `${row.label}: ${key}`);
    assert.equal(snapshot.balance.totalAssets, snapshot.balance.totalLiabilitiesEquity, `${row.label}: accounting equation`);
    assert.equal(snapshot.balance.difference, 0, `${row.label}: zero difference`);
    assert.equal(snapshot.balance.balanced, true, `${row.label}: balanced flag`);
  }
});

test("three-level invoice deletion contract includes Void, single hard delete, invoice-only bulk purge and global reset", () => {
  const business = read("server/business-operations.js");
  const index = read("server/index.js");
  const schema = read("server/schema.sql");

  assert.match(business, /app\.post\("\/api\/invoices\/:id\/void"/);
  const app = read("public/app.js");
  assert.match(app, /function voidInvoice/);
  assert.match(app, /function hardDeleteInvoice/);
  assert.match(app, /title=\"Void\"/);
  assert.match(app, /title=\"Permanently Delete\"/);
  assert.match(business, /UPDATE invoices SET status='void'/);
  assert.match(business, /app\.delete\("\/api\/invoices\/:id"/);
  assert.match(business, /req\.user\.role !== "SUPERADMIN"/);
  assert.match(business, /resetInvoiceSource\(before\)/);
  assert.match(business, /app\.post\("\/api\/invoices\/purge-all"/);
  assert.match(business, /confirmation !== "DELETE ALL INVOICES"/);
  assert.match(business, /DELETE FROM invoices/);
  assert.match(business, /billing_status='Unbilled'/);
  assert.match(business, /invoice_id=NULL/);
  assert.match(schema, /billing_status TEXT NOT NULL DEFAULT 'Unbilled'/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS invoice_sequences/);
  assert.match(schema, /sort_order INTEGER NOT NULL DEFAULT 0/);
  assert.match(business, /RETURNING last_number/);
  assert.match(business, /ORDER BY sort_order,id/);
  assert.match(schema, /invoice_id TEXT/);
  assert.match(schema, /FOREIGN KEY\(invoice_id\) REFERENCES invoices\(id\) ON DELETE CASCADE/);

  const unbilledPos = business.indexOf('app.get("/api/invoices/unbilled-sources"');
  const genericGetPos = business.indexOf('app.get("/api/invoices/:id"');
  assert.ok(unbilledPos >= 0 && genericGetPos >= 0 && unbilledPos < genericGetPos, "specific unbilled route must precede generic /:id route");

  assert.match(index, /isSuperadminUser\(req\?\.user\) && auditType!==['\"]FINANCIAL['\"]/);
  assert.match(index, /app\.post\("\/api\/system\/delete-everything"/);
  for (const table of ["invoice_items", "invoices", "invoice_sequences", "partner_contractors", "partners", "workflow_financial_lines", "workshop_workflows", "financial_items", "jobs", "client_pianos", "pianos", "contacts"]) {
    assert.ok(index.includes(`"${table}"`), `global reset must clear ${table}`);
  }
});

test("admin navigation is exactly four primary groups with finance separated and clean technical/website card sets", () => {
  const app = read("public/app.js");
  const nav = block(app, "const adminNavGroups=[", "];\nconst adminNavigationItems");
  const ids = [...nav.matchAll(/\{id:"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ["finance_invoicing", "technical", "marketing", "website_events"]);

  const finance = block(nav, '{id:"finance_invoicing"', ' {id:"technical"');
  const financeViews = [...finance.matchAll(/\["([a-z_]+)",/g)].map((m) => m[1]);
  assert.deepEqual(financeViews, ["finance", "income_statement", "invoice_documents"]);
  const technical = block(nav, '{id:"technical"', ' {id:"marketing"');
  const techViews = [...technical.matchAll(/\["([a-z_]+)",/g)].map((m) => m[1]);
  assert.deepEqual(techViews, ["audit_log","backups","pianos","contacts","closed_jobs","knowledge_base","company_data","inventory","partners","planned_jobs","scheduler","website_services","settings","system_integrations","users","workshop_workflow"]);
  assert.ok(!technical.includes('["finance"'));
  assert.ok(!technical.includes('["income_statement"'));
  assert.ok(technical.includes('["knowledge_base","Company Documents Archive"'));

  const marketing = block(nav, '{id:"marketing"', ' {id:"website_events"');
  const marketingViews = [...marketing.matchAll(/\["([a-z_]+)",/g)].map((m) => m[1]);
  assert.ok(marketingViews.includes("customer_inbox"));

  const website = nav.slice(nav.indexOf('{id:"website_events"'));
  const websiteViews = [...website.matchAll(/\["([a-z_]+)",/g)].map((m) => m[1]);
  assert.deepEqual(websiteViews, ["website_artists","website_contacts","digital_attendance","events","event_guest_list","event_invitations","media_library","pages_content","publish_preview","showroom_pianos","event_tickets"]);
  assert.doesNotMatch(nav, /Landing Page Design|landing_page_design/);

  assert.match(app, /brandHomeButton/);
  assert.match(app, /navigationHomeNeutral=true;closeModal\(\);render\('workshop_workflow'/);
});

test("workflow billing UI and engine use manual phase costs and customer-facing phase subtotals only", () => {
  const app = read("public/app.js");
  const workflowServer = read("server/workshop-workflow.js");
  const business = read("server/business-operations.js");
  const pdf = read("server/document-pdf.js");

  const activeDrawer = block(app, "function workflowPhaseDrawerMarkup(workflow,stage){", "\nasync function workflowCompleteStage", true);
  assert.match(activeDrawer, /Phase subtotal/);
  assert.match(activeDrawer, /Manual phase costs only; no inventory or quantity link/);
  assert.match(activeDrawer, /id="workflowFinanceTitle"/);
  assert.match(activeDrawer, /id="workflowFinanceAmount"/);
  assert.doesNotMatch(activeDrawer, /workflowMaterialQuantity|workflowMaterialInventoryId|Central inventory/);
  assert.doesNotMatch(activeDrawer, /workflowFinanceType|workflowFinanceCategory/);

  assert.match(workflowServer, /lineType = "COST", category = "OTHER"/);
  assert.doesNotMatch(workflowServer, /workflow_materials|inventory_items|CENTRAL_INVENTORY|\/materials/);
  assert.doesNotMatch(app, /workflowAddMaterial|workflowInventoryOptions|CENTRAL_INVENTORY|\/api\/workflows\/\$\{workflowId\}\/materials/);
  assert.match(business, /const phaseSubtotal = money\(costLines\.filter/);
  assert.match(business, /item_description: `Phase \$\{Number\(stage\.stage_order/);
  assert.doesNotMatch(block(business, "function createWorkflowInvoice", "\n  function reverseLedger"), /workflow_materials|materialRows|requested_quantity/);
  assert.match(pdf, /workflowPhaseInvoice = invoice\.source_type === "workflow"/);
  assert.match(pdf, /PHASE SUBTOTAL/);
});

test("automatic and manual financial flows share invoice-state accounting and 1099 daily rates use subcontractor expense", () => {
  const index = read("server/index.js");
  const jobDomain = read("server/job-domain.js");
  const business = read("server/business-operations.js");

  assert.match(index, /buildAccountingSnapshot/);
  assert.match(index, /balanceSheet:\{cashBankAccounts:balance\.cashBankAccounts,accountsReceivable:balance\.accountsReceivable,totalAssets:balance\.totalAssets,accountsPayable:balance\.accountsPayable,currentPeriodNetIncome:balance\.currentPeriodNetIncome,totalLiabilitiesEquity:balance\.totalLiabilitiesEquity\}/);
  assert.match(index, /equation:'Assets = Liabilities \+ Equity'/);
  assert.match(index, /source_type==='job'/);
  assert.match(index, /SUBCONTRACTOR_EXPENSE/);
  assert.match(jobDomain, /category: "SUBCONTRACTOR_EXPENSE"/);
  assert.match(business, /direction: "receivable"/);
  assert.match(business, /direction: "payable"/);
  assert.match(business, /sourceType: "job"/);
  assert.match(business, /sourceType: "workflow"/);
  assert.match(business, /sourceType: "manual"/);
});

test("critical regression guards remain present: money rounding, PDF month and responsive modal envelope", () => {
  const accounting = read("server/accounting-domain.js");
  const pdf = read("server/document-pdf.js");
  const css = read("public/styles.css");
  assert.match(accounting, /Math\.round\(\(number \+ Number\.EPSILON\) \* 100\) \/ 100/);
  assert.match(pdf, /date\.getMonth\(\) \+ 1/);
  assert.doesNotMatch(pdf, /getMonth\(\)\.toString\(\)\.padStart/);
  assert.match(css, /max-width:min\(92vw,680px\)/);
  assert.match(css, /max-height:calc\(100dvh - 32px\)/);
});

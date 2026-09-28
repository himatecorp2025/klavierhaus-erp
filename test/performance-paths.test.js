"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createPdfDiskCache } = require("../server/document-pdf");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("performance schema has targeted indexes, KPI materialization and Workflow V2 foreign-key indexes", () => {
  const schema = read("server/schema.sql");
  const init = read("server/init-db.js");
  const workflow = read("server/workflow-v2-schema.sql");
  for (const name of ["idx_jobs_client_id","idx_jobs_piano_id","idx_jobs_status_scheduled","idx_events_scheduled_at","idx_events_type_status","idx_invoices_client_id","idx_invoices_status_due"]) assert.match(schema + init, new RegExp(name));
  assert.match(schema, /CREATE TABLE IF NOT EXISTS kpi_summary_cache/);
  assert.match(init, /installKpiSummaryCache\(\)/);
  assert.match(init, /trg_kpi_summary_/);
  for (const name of ["idx_wf2_workflows_client","idx_wf2_workflows_piano","idx_wf2_phases_workflow","idx_wf2_costs_phase","idx_wf2_checklist_phase","idx_wf2_documents_phase","idx_wf2_audit_actor","idx_wf2_closeouts_actor"]) assert.match(workflow, new RegExp(name));
});

test("dashboard read path is a single materialized-cache lookup", () => {
  const source = read("server/business-operations.js");
  const start = source.indexOf('app.get("/api/dashboard/summary"');
  const end = source.indexOf("});", start);
  const route = source.slice(start, end + 3);
  assert.ok(start > 0);
  assert.match(route, /dashboardSummaryStatement\.get\(\)/);
  assert.doesNotMatch(route, /COUNT\(|SUM\(|JOIN\s/i);
  assert.match(source, /SELECT payload FROM kpi_summary_cache WHERE key='dashboard_summary'/);
});

test("PDF disk cache renders once in a worker and reuses the checksum-addressed file", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kh-pdf-cache-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cache = createPdfDiskCache({ rootDir: directory });
  const args = {
    company: { trade_name: "Klavierhaus", address_line1: "New York, NY" },
    invoice: { id: "INV-TEST", invoice_number: "INV-TEST", issue_date: "2026-09-28", due_date: "2026-09-28", summary: "Performance cache test", direction: "receivable", status: "issued", subtotal: 100, tax_rate: 0, tax_amount: 0, total_amount: 100, currency: "USD" },
    items: [{ item_description: "Piano service", quantity: 1, unit_price: 100, total_price: 100 }],
    counterpartyName: "Test Client"
  };
  const first = await cache.render({ type: "invoice", id: "INV-TEST", generatorName: "generateBusinessInvoicePdf", args, source: args });
  assert.equal(first.cacheHit, false);
  assert.match(path.basename(first.filePath), /^invoice_INV-TEST_[a-f0-9]{32}\.pdf$/);
  assert.equal(fs.readFileSync(first.filePath).subarray(0,4).toString("ascii"), "%PDF");
  const second = await cache.render({ type: "invoice", id: "INV-TEST", generatorName: "generateBusinessInvoicePdf", args, source: args });
  assert.equal(second.cacheHit, true);
  assert.equal(second.filePath, first.filePath);
});

test("service worker is stale-while-revalidate for static assets and bypasses API requests", () => {
  const source = read("public/service-worker.js");
  assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)\)return/);
  assert.match(source, /event\.waitUntil\(revalidate\.catch/);
  assert.match(source, /if\(cached\)return cached/);
  assert.doesNotMatch(source, /isCriticalShell/);
});

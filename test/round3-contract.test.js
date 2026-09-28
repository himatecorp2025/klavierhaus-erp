"use strict";

const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const test=require("node:test");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
function gitBlobSha(file){
  const data=fs.readFileSync(path.join(root,file));
  return crypto.createHash("sha1").update(Buffer.from(`blob ${data.length}\0`)).update(data).digest("hex");
}

test("Round 3 keeps protected website/CMS server modules byte-identical",()=>{
  const expected={
    "server/website-platform.js":"8a10313eb02bdd41fdc434d1f5a9bdbe7ca7d1e7",
    "server/website-content.js":"3886ff1e4b4261dd8512781fc833c6c8cd796ce5",
    "server/website-catalog.js":"18ebe2d0663d2c4dfd995f1732a504b6555a8b98",
    "server/upload-middleware.js":"64444c043a3a1b646032a5ca5c10569d37806938"
  };
  for(const [file,sha] of Object.entries(expected))assert.equal(gitBlobSha(file),sha,`${file} changed despite zero-modification policy`);
});

test("Round 3 finance schema is simple, two-sided and does not restore retired finance subsystems",()=>{
  const schema=read("server/schema.sql");
  for(const table of ["partners","partner_contractors","invoice_sequences","invoices","invoice_items","invoice_payments"]){
    assert.match(schema,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`),table);
  }
  assert.match(schema,/direction TEXT NOT NULL CHECK\(direction IN \('receivable','payable'\)\)/);
  assert.match(schema,/status TEXT NOT NULL DEFAULT 'issued' CHECK\(status IN \('issued','partial','paid','void'\)\)/);
  assert.match(schema,/closed_at TEXT/);
  assert.match(schema,/payment_method TEXT NOT NULL CHECK\(payment_method IN \('Cash','Check','Zelle','Bank Transfer \/ ACH','Credit Card'\)\)/);
  for(const retired of ["financial_items","workflow_finance_sources","journal_entries","journal_lines","planned_jobs"]){
    assert.doesNotMatch(schema,new RegExp(`CREATE TABLE IF NOT EXISTS ${retired}\\s*\\(`),retired);
  }
});

test("Round 3 routes implement closeout, invoices, payments, partners, PDF and permissions",()=>{
  const source=read("server/round3-finance.js"),server=read("server/index.js");
  assert.match(server,/registerRound3FinanceRoutes/);
  for(const route of ["/api/jobs/:id/closeout","/api/invoices","/api/invoices/:id/payments","/api/invoices/:id/void","/api/partners","/api/finance/summary","/api/finance/ledger","/api/finance/monthly-report.pdf"]){
    assert.ok(source.includes(route),route);
  }
  assert.match(source,/INV/);
  assert.match(source,/VND/);
  assert.match(source,/generateBusinessInvoicePdf/);
  assert.match(source,/generateMonthlyInvoiceReportPdf/);
  assert.match(source,/requireSuperadmin/);
  assert.match(source,/financeAdmin/);
  assert.doesNotMatch(server,/registerBusinessOperationsRoutes|registerFinanceResetRoutes|createJobDomain/);
});

test("Round 3 preserves the five active workflow states and uses closed_at as terminal closeout",()=>{
  const round2=read("server/round2-workflow.js"),schema=read("server/schema.sql");
  for(const state of ["planned","scheduled","in_progress","blocked","ready_for_closeout"])assert.ok(round2.includes(`key: "${state}"`));
  assert.match(round2,/j\.closed_at IS NULL/);
  assert.match(schema,/CHECK\(status IN \('planned','scheduled','in_progress','blocked','ready_for_closeout'\)\)/);
  assert.doesNotMatch(schema,/status IN \([^)]*closed/);
});

test("Round 3 PWA exposes closeout and Finance on desktop/mobile with PDFs and payments",()=>{
  const html=read("public/index.html"),app=read("public/app.js"),round2=read("public/round2.js"),round3=read("public/round3.js"),css=read("public/styles.css"),sw=read("public/service-worker.js");
  assert.match(html,/data-nav="finance"/);
  assert.ok(html.includes("/round3.js"));
  assert.match(app,/state\.view==="finance"/);
  assert.match(round2,/data-closeout-job/);
  assert.match(round3,/\/api\/jobs\/"\+job\.id\+"\/closeout/);
  assert.match(round3,/\/api\/finance\/summary/);
  assert.match(round3,/\/api\/finance\/monthly-report\.pdf/);
  assert.match(round3,/\/api\/invoices\//);
  assert.match(round3,/\/api\/partners/);
  assert.match(round3,/Zelle/);
  assert.match(css,/\.finance-split/);
  assert.match(css,/\.invoice-line/);
  assert.match(sw,/klavierhaus-round3-shell-v1/);
  assert.match(sw,/\/round3\.js/);
});

test("CI requires five consecutive full acceptance runs",()=>{
  const workflow=read(".github/workflows/ci.yml");
  assert.match(workflow,/Klavierhaus ERP Round 3 CI/);
  assert.match(workflow,/for run in 1 2 3 4 5/);
  assert.match(workflow,/npm test/);
});

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
  return crypto.createHash("sha1").update(Buffer.from("blob "+data.length+"\0")).update(data).digest("hex");
}

test("protected website and CMS server modules remain byte-identical",()=>{
  const expected={
    "server/website-platform.js":"8a10313eb02bdd41fdc434d1f5a9bdbe7ca7d1e7",
    "server/website-content.js":"3886ff1e4b4261dd8512781fc833c6c8cd796ce5",
    "server/website-catalog.js":"18ebe2d0663d2c4dfd995f1732a504b6555a8b98",
    "server/upload-middleware.js":"64444c043a3a1b646032a5ca5c10569d37806938"
  };
  for(const [file,sha] of Object.entries(expected))assert.equal(gitBlobSha(file),sha,file+" changed despite zero-modification policy");
});

test("Round 1 schema and APIs implement media, review state and zero-duplicate conversion",()=>{
  const schema=read("server/schema.sql"),core=read("server/round1-core.js"),upload=read("server/intake-media-upload.js");
  for(const table of ["clients","pianos","intake_leads"])assert.match(schema,new RegExp("CREATE TABLE IF NOT EXISTS "+table+"\\s*\\("));
  assert.match(schema,/media_urls TEXT NOT NULL DEFAULT '\[\]'/);
  assert.match(schema,/status TEXT NOT NULL DEFAULT 'new' CHECK\(status IN \('new','under_review','converted','archived'\)\)/);
  assert.match(schema,/idx_clients_name/);assert.match(schema,/idx_clients_email/);assert.match(schema,/idx_clients_phone/);
  assert.match(core,/lower\(COALESCE\(c\.email,''\)\) LIKE/);
  assert.match(core,/lower\(COALESCE\(c\.phone,''\)\) LIKE/);
  assert.match(core,/\/api\/intake\/media/);
  assert.match(core,/convertIntakeLead/);
  assert.match(upload,/video\/mp4/);
  assert.match(upload,/100\*1024\*1024/);
});

test("Round 2 uses a separate planned pipeline and data-driven workflow phases",()=>{
  const schema=read("server/schema.sql"),workflow=read("server/round2-workflow.js");
  assert.match(schema,/stage TEXT NOT NULL DEFAULT 'planned' CHECK\(stage IN \('planned','received','in_progress','qa_review','admin_approval','completed'\)\)/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS job_handoffs\s*\(/);
  assert.match(schema,/estimated_duration_min INTEGER NOT NULL DEFAULT 120/);
  assert.match(schema,/total_labor_cost REAL NOT NULL DEFAULT 0/);
  assert.match(schema,/total_material_cost REAL NOT NULL DEFAULT 0/);
  assert.match(schema,/CREATE INDEX IF NOT EXISTS idx_jobs_stage/);
  assert.match(schema,/CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_at/);
  for(const endpoint of ["/api/jobs/pipeline","/api/jobs/activate/:id","/api/jobs/workflow","/api/jobs/:id/handoff"])assert.ok(workflow.includes(endpoint),endpoint);
  assert.match(workflow,/j\.stage='planned' AND j\.scheduled_at IS NULL/);
  for(const stage of ["received","in_progress","qa_review","admin_approval","completed"])assert.ok(workflow.includes('key:"'+stage+'"'),stage);
  assert.doesNotMatch(workflow,/key:"blocked"/);
  assert.match(workflow,/responsible_user_id/);
  assert.match(workflow,/workflow_owner_user_id/);
  assert.match(workflow,/MAX_WORKFLOW_STAGES=7/);
  assert.match(workflow,/phase_labor_cost\|\|0/);
  assert.match(workflow,/ADMIN_CLOSEOUT_REQUIRED/);
  assert.match(workflow,/cancelled_by_name/);
});

test("Round 3 schema and APIs implement draft-send-paid invoices, direct expenses and KPI cache",()=>{
  const schema=read("server/schema.sql"),finance=read("server/round3-finance.js"),email=read("server/transactional-email.js");
  for(const table of ["invoices","invoice_items","invoice_payments","direct_expenses","invoice_email_log","kpi_summary_cache"])assert.match(schema,new RegExp("CREATE TABLE IF NOT EXISTS "+table+"\\s*\\("));
  assert.match(schema,/status TEXT NOT NULL DEFAULT 'draft' CHECK\(status IN \('draft','sent','paid','cancelled'\)\)/);
  assert.match(schema,/subtotal_labor REAL NOT NULL DEFAULT 0/);
  assert.match(schema,/subtotal_material REAL NOT NULL DEFAULT 0/);
  assert.match(schema,/pdf_path TEXT/);
  for(const endpoint of ["/api/invoices/generate-from-job/:jobId","/api/invoices/:id/send-email","/api/invoices/:id/mark-paid","/api/finance/overview"])assert.ok(finance.includes(endpoint),endpoint);
  assert.doesNotMatch(finance,/\/api\/invoices\/:id\/payments/);
  assert.match(finance,/status='paid'/);
  assert.match(finance,/outstanding_invoice_count/);
  assert.match(finance,/kpi_summary_cache/);
  assert.match(finance,/direct_expenses/);
  assert.match(email,/sendWorkshopInvoice/);
  assert.match(email,/attachments:/);
  assert.match(email,/language = "en"/);
});

test("PWA is English-first, bilingual and implements required operational controls",()=>{
  const html=read("public/index.html"),app=read("public/app.js"),round2=read("public/round2.js"),round3=read("public/round3.js"),css=read("public/styles.css"),sw=read("public/service-worker.js");
  assert.match(html,/<html lang="en"/);
  assert.match(html,/id="languageToggle"/);
  assert.match(app,/state\.language/);
  assert.match(app,/localStorage\.getItem\("kh_language"\)/);
  assert.match(app,/\/api\/intake\/media/);
  assert.match(app,/\/api\/intake\/\$\{lead\.id\}\/convert-to-job/);
  assert.match(round2,/data-workshop-mode="calendar"/);
  assert.match(round2,/data-workshop-mode="workflow"/);
  assert.match(round2,/data-calendar-mode="day"/);
  assert.match(round2,/data-calendar-mode="week"/);
  assert.match(round2,/\/api\/jobs\/pipeline/);
  assert.match(round2,/\/api\/jobs\/activate\//);
  assert.match(round2,/\/handoff/);
  assert.match(round3,/Save Draft \/ Send Later/);
  assert.match(round3,/Send Invoice Now/);
  assert.match(round3,/Approve & Send/);
  assert.match(round3,/\/mark-paid/);
  assert.match(round3,/\/api\/direct-expenses/);
  assert.match(round3,/outstanding_invoice_count/);
  assert.match(css,/min-height:48px/);
  assert.match(css,/\.segmented-control/);
  assert.match(css,/\.typeahead-menu/);
  assert.match(sw,/klavierhaus-admin-v11-responsive-pwa/);
  assert.match(sw,/url\.pathname\.startsWith\("\/api\/"\)/);
});

test("retired ERP domains and duplicate calendar/workflow tables are absent from active schema",()=>{
  const schema=read("server/schema.sql");
  for(const table of ["planned_jobs","calendar_jobs","workflow_jobs","financial_items","workflow_finance_sources","journal_entries","journal_lines","inventory_items"]){
    assert.doesNotMatch(schema,new RegExp("CREATE TABLE IF NOT EXISTS "+table+"\\s*\\("),table);
  }
});

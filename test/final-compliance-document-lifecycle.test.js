"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {generateJobCompletionReportPdf}=require("../server/document-pdf");

test("job completion report renders a real PDF with handoff detail",()=>{
  const pdf=generateJobCompletionReportPdf({
    company:{trade_name:"Klavierhaus",address_line1:"790 11th Ave",city:"New York",state:"NY"},
    job:{id:42,job_code:"KH-2026-0042",client_name:"Client",title:"Grand piano service",description:"Workshop service",piano_brand:"Steinway",piano_model:"B",piano_serial_number:"123",completed_at:"2026-09-29T12:00:00Z",completed_by_name:"Admin"},
    handoffs:[{id:1,from_stage:"in_progress",billing_description:"Tuning",phase_labor_cost:220,phase_material_cost:0,phase_duration_min:90}],
    phases:[{stage_key:"received",completed_at:"2026-09-28T12:00:00Z"},{stage_key:"in_progress",completed_at:"2026-09-29T12:00:00Z"}]
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0,5).toString(),"%PDF-");
  assert.ok(pdf.length>1000);
});

test("document lifecycle queues completion reports and immutable issued invoices without changing business approval gates",()=>{
  const root=path.resolve(__dirname,"..");
  const finance=fs.readFileSync(path.join(root,"server","round3-finance.js"),"utf8");
  const schema=fs.readFileSync(path.join(root,"server","schema.sql"),"utf8");
  assert.match(schema,/completion_document_id INTEGER/);
  assert.match(schema,/issued_document_id INTEGER/);
  assert.match(finance,/GENERATE_JOB_COMPLETION_REPORT/);
  assert.match(finance,/job-completion-document-/);
  assert.match(finance,/ARCHIVE_ISSUED_INVOICE/);
  assert.match(finance,/issued-invoice-document-/);
  assert.match(finance,/category,title,description,entity_type,entity_id/);
  assert.match(finance,/VALUES\('exported_report'/);
  assert.match(finance,/VALUES\('financial_document'/);
  assert.match(finance,/persistPdf\(invoice\.id,\{statusOverride:"sent"\}\)/);
  assert.match(finance,/invoice_mode/);
  assert.match(finance,/\["draft","send"\]/);
});

test("issued invoice PDF is intentionally rendered as DUE before successful send while database status stays draft until delivery",()=>{
  const root=path.resolve(__dirname,"..");
  const finance=fs.readFileSync(path.join(root,"server","round3-finance.js"),"utf8");
  const start=finance.indexOf("async function sendInvoiceNow");
  const end=finance.indexOf("if(automationOutbox)",start);
  const source=finance.slice(start,end);
  const pdfAt=source.indexOf('persistPdf(invoice.id,{statusOverride:"sent"})');
  const statusAt=source.indexOf("UPDATE invoices SET status='sent'");
  assert.ok(pdfAt>=0&&statusAt>pdfAt);
  assert.match(source,/catch\(error\)[\s\S]*invoice_email_log/);
});

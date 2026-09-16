const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('public/app.js');
const styles=read('public/styles.css');
const business=read('server/business-operations.js');
const events=read('server/events.js');
const index=read('server/index.js');
const schema=read('server/schema.sql');
const initDb=read('server/init-db.js');
const uploads=read('server/upload-middleware.js');
const workflow=read('server/workshop-workflow.js');
const accounting=require('../server/accounting-domain');
const Module=require('node:module');
const originalModuleLoad=Module._load;
Module._load=function(request,parent,isMain){if(request==='resend')return {Resend:class Resend{}};return originalModuleLoad.call(this,request,parent,isMain);};
const businessModule=require('../server/business-operations');
Module._load=originalModuleLoad;

function block(source,startMarker,endMarker){
  const start=source.indexOf(startMarker);
  assert.ok(start>=0,`missing start marker: ${startMarker}`);
  const end=source.indexOf(endMarker,start+startMarker.length);
  assert.ok(end>start,`missing end marker: ${endMarker}`);
  return source.slice(start,end);
}

test('navigation is exactly three finance cards, sixteen technical cards and eleven public website cards',()=>{
  const nav=block(app,'const adminNavGroups=[','const adminNavigationItems=');
  const finance=block(nav,'{id:"finance_invoicing"','{id:"technical"');
  const financeItems=finance.match(/items:\[([\s\S]*?)\]\}/)?.[1]||'';
  assert.deepEqual([...financeItems.matchAll(/\["([^"]+)","([^"]+)"/g)].map(m=>[m[1],m[2]]),[
    ['finance','Balance Sheet'],['income_statement','Income Statement'],['invoice_documents','Invoices Documents']
  ]);
  const technical=block(nav,'{id:"technical"','{id:"marketing"');
  const technicalItems=technical.match(/items:\[([\s\S]*?)\]\}/)?.[1]||'';
  assert.deepEqual([...technicalItems.matchAll(/\["([^"]+)","([^"]+)"/g)].map(m=>[m[1],m[2]]),[
    ['audit_log','Audit Log'],['backups','Backups'],['pianos','Client Piano'],['contacts','Clients'],['closed_jobs','Closed Jobs'],['knowledge_base','Company Documents Archive'],['company_data','Company Data'],['inventory','Inventory'],['partners','Partners'],['planned_jobs','Planned Jobs'],['scheduler','Scheduler'],['website_services','Services'],['settings','Settings'],['system_integrations','System Activation & Integrations'],['users','Users'],['workshop_workflow','Workshop Workflow']
  ]);
  const website=block(nav,'{id:"website_events"','\n ]}\n];');
  const websiteItems=website.slice(website.indexOf('items:[')+7);
  assert.equal([...websiteItems.matchAll(/\["([^"]+)","([^"]+)"/g)].length,11);
  assert.doesNotMatch(nav,/Landing Page Design/);
});

test('fresh authentication always forces Workshop Workflow while reload preserves a valid hash',()=>{
  assert.match(app,/function completeLoginSession[\s\S]*?forceWorkflowHomeOnBoot=true;[\s\S]*?boot\(\)/);
  assert.match(app,/const bootView=forceWorkflowHomeOnBoot\?"workshop_workflow":\(viewFromLocation\(\)\|\|"workshop_workflow"\)/);
  assert.match(app,/function externalRouteForView\(view\)\{return view==="finance"\?"balance_sheet":view;\}/);
  assert.match(app,/function internalViewFromRoute\(route\)\{return route==="balance_sheet"\?"finance":route;\}/);
  assert.match(app,/render\('workshop_workflow',\{homeNavigation:true\}\)/);
});

test('Balance Sheet is the only balance presentation and Income Statement is pure P&L',()=>{
  const finance=block(app,'async function renderFinance(','async function renderPartners(');
  assert.match(finance,/Official US GAAP balance sheet/);
  assert.match(finance,/TOTAL ASSETS/);
  assert.match(finance,/TOTAL LIABILITIES & EQUITY/);
  const income=block(app,'function renderIncomeSheetHTML(','async function renderIncomeStatement(');
  assert.doesNotMatch(income,/Balance Sheet|TOTAL ASSETS|LIABILITIES & EQUITY/);
  assert.match(income,/Income Statement|P&L|REVENUE|EXPENSE/);
});

test('invoice active/archive buckets and three lifecycle colors are wired end-to-end',()=>{
  const invoiceUi=block(app,'async function renderInvoiceDocuments(','async function renderInvoiceDocumentsMonth(');
  assert.match(invoiceUi,/Active Invoices/);
  assert.match(invoiceUi,/Archived Invoices/);
  assert.match(invoiceUi,/bucket=\$\{encodeURIComponent\(invoiceDocumentsBucket\)\}/);
  assert.match(invoiceUi,/const statusClass=row=>`status-\$\{/);
  assert.match(styles,/\.invoice-status-badge\.status-pending/);
  assert.match(styles,/\.invoice-status-badge\.status-paid/);
  assert.match(styles,/\.invoice-status-badge\.status-overdue/);
  assert.match(business,/if \(status === "paid"\) return "Paid";/);
  assert.match(business,/due < newYorkDateKey\(now\).*"Overdue"/);
  assert.match(business,/if \(bucket === "active"\).*archived_at IS NULL/);
  assert.match(business,/if \(bucket === "archive"\).*archived_at IS NOT NULL/);
});

test('month close is New York calendar based, uses 23:59:59 and preserves open invoices',()=>{
  assert.match(business,/const NEW_YORK_TIME_ZONE = "America\/New_York"/);
  assert.match(business,/function nextNewYorkMonthBoundary/);
  assert.match(business,/function nextNewYorkMonthClose[\s\S]*?getTime\(\) - 1000/);
  assert.match(business,/MAX_INVOICE_CLOSE_TIMER_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(business,/setTimeout\(waitUntilClose, Math\.min\(remaining, MAX_INVOICE_CLOSE_TIMER_MS\)\)/);
  assert.match(business,/function invoicePaidPeriod[\s\S]*?newYorkMonthKey\(paidAt\)/);
  assert.match(business,/SELECT id,paid_at,issue_date FROM invoices WHERE status='paid' AND archived_at IS NULL/);
  assert.doesNotMatch(business,/\$\{month\}-31/);
});

test('New York lifecycle helpers classify overdue and archive by the actual local payment month',()=>{
  assert.equal(businessModule.invoiceLifecycleStatus({status:'issued',due_date:'2026-09-15'},new Date('2026-09-16T16:00:00Z')),'Overdue');
  assert.equal(businessModule.invoiceLifecycleStatus({status:'paid',due_date:'2026-09-01'},new Date('2026-09-16T16:00:00Z')),'Paid');
  assert.equal(businessModule.actualMonthEndDate('2026-02'),'2026-02-28');
  assert.equal(businessModule.actualMonthEndDate('2028-02'),'2028-02-29');
  const close=businessModule.nextNewYorkMonthClose(new Date('2026-09-16T12:00:00Z'));
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(close);
  const values=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  assert.deepEqual({month:values.month,day:values.day,hour:values.hour,minute:values.minute,second:values.second},{month:'09',day:'30',hour:'23',minute:'59',second:'59'});
  const rows=[
    {id:'SEP-LATE-NY',paid_at:'2026-10-01 03:30:00',issue_date:'2026-09-30'},
    {id:'OCT-NY',paid_at:'2026-10-01 04:30:00',issue_date:'2026-10-01'}
  ];
  const updates=[];
  const db={
    prepare(sql){
      if(sql.startsWith('SELECT id,paid_at'))return {all:()=>rows};
      if(sql.startsWith('UPDATE invoices SET archived_at'))return {run:(archivedAt,period,id)=>{updates.push({period,id});return {changes:1};}};
      throw new Error(`unexpected SQL: ${sql}`);
    },
    transaction(fn){return fn;}
  };
  const changed=businessModule.closeCompletedInvoicePeriods(db,new Date('2026-10-01T04:01:00Z'));
  assert.equal(changed,1);
  assert.deepEqual(updates,[{period:'2026-09',id:'SEP-LATE-NY'}]);
});

test('archived invoices expose view download and audited edit actions',()=>{
  const ui=block(app,'async function renderInvoiceDocuments(','async function renderInvoiceDocumentsMonth(');
  assert.match(ui,/Edit Invoice Details/);
  assert.match(ui,/downloadInvoicePdf/);
  assert.match(ui,/previewInvoice/);
  assert.match(app,/Reason for Adjustment/);
  assert.match(app,/minlength="5"/);
  assert.match(app,/api\(`\/api\/invoices\/\$\{encodeURIComponent\(id\)\}`/);
});

test('invoice adjustment audit preserves invoice number and stores complete before/after audit metadata',()=>{
  const patch=block(business,'app.patch("/api/invoices/:id"','app.post("/api/invoices/:id/status"');
  assert.match(patch,/reason\.length < 5/);
  assert.match(patch,/adjusted_by_user_id/);
  assert.match(patch,/adjusted_by_name/);
  assert.match(patch,/adjusted_at_local/);
  assert.match(patch,/JSON\.stringify\(before\)/);
  assert.match(patch,/JSON\.stringify\(updated\)/);
  assert.doesNotMatch(patch,/invoice_number\s*=/);
  assert.match(patch,/archived_at=CASE WHEN \?='paid' THEN archived_at ELSE NULL END/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS invoice_adjustments/);
});

test('job close uses approved billed amount and has no external invoice/check upload path',()=>{
  const ui=block(app,'function openCloseJob(','function toggleNextJob(');
  assert.match(ui,/name="billed_amount"/);
  assert.doesNotMatch(ui,/type="file"|invoice_file|check_file|multipart\/form-data/);
  const route=block(index,'app.post("/api/jobs/:id/close"','app.get("/api/contacts/:id/pianos"');
  assert.match(route,/const billed=Number\(req\.body\.billed_amount\)/);
  assert.match(route,/amount:billed/);
  assert.doesNotMatch(route,/req\.file|removeUploadedFile|validMagic/);
  const engine=block(business,'function createJobInvoices(','function createWorkflowInvoice(');
  assert.match(engine,/entries\.find\(\(entry\) => entry\.mainType !== "EXPENSE"\)\?\.amount \?\? job\.billed_amount/);
  assert.doesNotMatch(engine,/planned_amount/);
});

test('workflow invoices remain phase-subtotal only and have no live inventory dependency',()=>{
  assert.doesNotMatch(workflow,/workflow_materials|CENTRAL_INVENTORY|\/materials|inventory_items/);
  assert.match(workflow,/lineType = "COST", category = "OTHER"/);
  const engine=block(business,'function createWorkflowInvoice(','function reverseLedger');
  assert.match(engine,/phaseSubtotal/);
  assert.match(engine,/Phase \$\{Number\(stage\.stage_order \|\| 0\) \+ 1\}/);
  assert.doesNotMatch(engine,/workflow_materials|inventory_items/);
});

test('paid event tickets use central event invoices while free reservations remain non-financial',()=>{
  assert.match(schema,/source_type IN \('job','workflow','manual','event'\)/);
  const paid=block(events,'app.post("/api/public/events/:slug/checkout"','app.post("/api/public/events/:slug/reservations"');
  assert.match(paid,/invoiceEngine\.createInvoice/);
  assert.match(paid,/sourceType:"event"/);
  assert.match(paid,/status:"issued"/);
  assert.match(paid,/UPDATE event_tickets SET invoice_id=/);
  const free=block(events,'app.post("/api/public/events/:slug/reservations"','app.get("/api/events"');
  assert.doesNotMatch(free,/invoiceEngine\.createInvoice|financial_items/);
});

test('event invoice accounting maps to concert revenue and central AR/Cash accounting',()=>{
  assert.match(index,/source_type==='event'/);
  assert.match(index,/CONCERT_SERVICE_REVENUE/);
  const snapshot=accounting.buildAccountingSnapshot({
    monthInvoices:[
      {direction:'receivable',status:'issued',total_amount:100,source_type:'event'},
      {direction:'receivable',status:'paid',total_amount:60,source_type:'event'}
    ],
    monthDirectItems:[],
    asOfInvoices:[
      {direction:'receivable',status:'issued',total_amount:100,source_type:'event'},
      {direction:'receivable',status:'paid',total_amount:60,source_type:'event'}
    ],
    asOfDirectItems:[]
  });
  assert.equal(snapshot.balance.accountsReceivable,100);
  assert.equal(snapshot.balance.cashBankAccounts,60);
  assert.equal(snapshot.balance.totalAssets,snapshot.balance.totalLiabilitiesEquity);
  assert.equal(snapshot.balance.difference,0);
});

test('company documents archive is Technical #6 with required upload metadata, formats, search, download and preview',()=>{
  assert.match(app,/\["knowledge_base","Company Documents Archive"/);
  const archive=block(app,'async function renderCompanyDocumentsArchive(','function handleCompanyDocumentDrop');
  assert.match(archive,/Drag & Drop company document here/);
  assert.match(archive,/\.pdf,\.doc,\.docx,\.xls,\.xlsx,\.jpg,\.jpeg,\.png,\.webp/);
  assert.match(archive,/name="title" required/);
  assert.match(archive,/name="effective_date" type="date" required/);
  assert.match(archive,/Contract|Permit|Technical Documentation|Other Company Document/);
  assert.match(archive,/companyDocumentSearch/);
  assert.match(archive,/openCompanyDocumentPreview/);
  assert.match(archive,/download=/);
  assert.match(index,/app\.post\("\/api\/company-documents"/);
  assert.match(index,/content_type='Company Document'/);
  assert.match(uploads,/pdf|doc|docx|xls|xlsx|jpg|jpeg|png|webp/i);
  assert.match(schema,/effective_date TEXT/);
  assert.match(schema,/original_filename TEXT/);
  assert.match(schema,/mime_type TEXT/);
});

test('company documents and invoice adjustments are responsive on mobile',()=>{
  assert.match(styles,/\.company-document-preview-card\{[^}]*max-height:calc\(100dvh - 32px\)/);
  assert.match(styles,/@media \(max-width:768px\)[\s\S]*?\.company-document-filters\{grid-template-columns:1fr\}/);
  assert.match(styles,/@media \(max-width:768px\)[\s\S]*?\.invoice-adjustment-item\{grid-template-columns:1fr\}/);
});

test('all card activation contracts remain present after the requested relocations',()=>{
  const frontendKeys=[...block(app,'const adminNavGroups=[','const adminNavigationItems=').matchAll(/\["([a-z0-9_]+)","/g)].map(m=>m[1]);
  assert.equal(frontendKeys.length,38);
  assert.equal(new Set(frontendKeys).size,38);
  const backendKeys=[...index.matchAll(/\{ key: "([^"]+)", group_key: "([^"]+)"/g)].map(m=>m[1]);
  assert.equal(backendKeys.length,38);
  assert.deepEqual(new Set(backendKeys),new Set(frontendKeys));
});

test('invoice archive schema and event invoice links are migration-safe',()=>{
  for(const marker of ['paid_at','archived_at','archived_period','invoice_adjustments']){
    assert.ok(schema.includes(marker),`schema missing ${marker}`);
    assert.ok(initDb.includes(marker),`migration missing ${marker}`);
  }
  assert.match(schema,/CREATE TABLE IF NOT EXISTS event_tickets[\s\S]*?invoice_id TEXT/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS event_payments[\s\S]*?invoice_id TEXT/);
  assert.match(initDb,/ensureColumn\("event_tickets", "invoice_id", "TEXT"\)/);
  assert.match(initDb,/ensureColumn\("event_payments", "invoice_id", "TEXT"\)/);
});

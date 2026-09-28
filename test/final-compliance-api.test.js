"use strict";

const assert=require("node:assert/strict");
const bcrypt=require("bcryptjs");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const test=require("node:test");
const Database=require("better-sqlite3");
const {buildWorkshopInvoiceEmail}=require("../server/transactional-email");

const root=path.resolve(__dirname,"..");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"kh-final-api-"));
const dbPath=path.join(temp,"api.sqlite");
const env={
  ...process.env,
  DB_PATH:dbPath,
  BACKUP_DIR:path.join(temp,"backups"),
  UPLOAD_DIR:path.join(temp,"uploads"),
  JWT_SECRET:"final-api-test-secret-abcdefghijklmnopqrstuvwxyz",
  STRIPE_SECRET_KEY:"",
  STRIPE_WEBHOOK_SECRET:"",
  RESEND_API_KEY:"",
  EMAIL_FROM:"",
  WEBSITE_BASE_URL:"https://website.example.test",
  APP_BASE_URL:"https://erp.example.test",
  NODE_ENV:"test"
};
for(const [key,value] of Object.entries(env))if(value!==undefined)process.env[key]=String(value);

let server,origin,appDb;
const shared={};

async function request(url,{token,method="GET",body,form}={}){
  const headers={Accept:"application/json"};
  if(token)headers.Authorization="Bearer "+token;
  let payloadBody;
  if(form)payloadBody=form;
  else if(body!==undefined){headers["Content-Type"]="application/json";payloadBody=JSON.stringify(body);}
  const response=await fetch(origin+url,{method,headers,body:payloadBody});
  const type=response.headers.get("content-type")||"";
  const payload=type.includes("application/json")?await response.json().catch(()=>({})):await response.text();
  return {status:response.status,payload,headers:response.headers};
}
async function pdf(url,token){
  const response=await fetch(origin+url,{headers:{Accept:"application/pdf",Authorization:"Bearer "+token}});
  return {status:response.status,buffer:Buffer.from(await response.arrayBuffer()),headers:response.headers};
}
async function login(email,password="FinalPass!"){
  const response=await request("/api/login",{method:"POST",body:{email,password}});
  assert.equal(response.status,200,JSON.stringify(response.payload));
  return response.payload.token;
}
function nyDate(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const p=Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return p.year+"-"+p.month+"-"+p.day;
}
function futureIso(dayOffset,hour=14){
  const d=new Date(Date.UTC(2035,4,10+dayOffset,hour,0,0));
  return d.toISOString();
}

test.before(async()=>{
  const init=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env,encoding:"utf8"});
  assert.equal(init.status,0,init.stdout+"\n"+init.stderr);
  const seed=new Database(dbPath);
  const hash=bcrypt.hashSync("FinalPass!",4);
  const insert=seed.prepare("INSERT INTO users(id,name,email,contact_email,password_hash,role,status,hidden_user,is_superadmin,session_version,calendar_color) VALUES(?,?,?,?,?,?,'Active',?,?,0,?)");
  insert.run("U-F-ADMIN","Final Admin","admin.final@example.com","admin.final@example.com",hash,"ADMIN",0,0,"#1f5eff");
  insert.run("U-F-WORKER","Final Technician","tech.final@example.com","tech.final@example.com",hash,"WORKER",0,0,"#0f8b6d");
  insert.run("U-F-MANAGER","Final Manager","manager.final@example.com","manager.final@example.com",hash,"MANAGER",0,0,"#7352aa");
  insert.run("U-F-SUPER","Final Owner","owner.final@example.com","owner.final@example.com",hash,"ADMIN",1,1,"#111111");
  seed.close();
  const mod=require("../server/index.js");appDb=mod.db;
  server=mod.app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  origin="http://127.0.0.1:"+server.address().port;
});
test.after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  try{appDb?.close();}catch(_error){}
  fs.rmSync(temp,{recursive:true,force:true});
});

test("Intake supports real media upload and one-action conversion to a Planned Job",async()=>{
  const token=await login("admin.final@example.com");
  shared.adminToken=token;
  const form=new FormData();
  form.append("media",new Blob(["fake png bytes"],{type:"image/png"}),"piano.png");
  const uploaded=await request("/api/intake/media",{token,method:"POST",form});
  assert.equal(uploaded.status,201,JSON.stringify(uploaded.payload));
  assert.equal(uploaded.payload.urls.length,1);
  assert.match(uploaded.payload.urls[0],/^\/uploads\/intake\//);

  const intake=await request("/api/intake",{token,method:"POST",body:{
    raw_client_name:"Final Client",
    raw_contact:"final.client@example.com",
    service_location:"on_site",
    reported_issue:"Full regulation and voicing",
    estimated_urgency:"normal",
    media_urls:[uploaded.payload.urls[0],"https://example.com/piano-before.jpg"],
    assigned_technician_id:"U-F-WORKER"
  }});
  assert.equal(intake.status,201,JSON.stringify(intake.payload));
  assert.deepEqual(intake.payload.media_urls.length,2);
  shared.intakeId=intake.payload.id;

  const reviewed=await request("/api/intake/"+intake.payload.id,{token,method:"PUT",body:{status:"under_review"}});
  assert.equal(reviewed.status,200,JSON.stringify(reviewed.payload));
  assert.equal(reviewed.payload.status,"under_review");

  const converted=await request("/api/intake/"+intake.payload.id+"/convert-to-job",{token,method:"POST",body:{
    client:{name:"Final Client",email:"final.client@example.com",address:"100 Park Ave, New York, NY"},
    piano:{brand:"Steinway & Sons",model:"B-211",serial_number:"FINAL-001",location_notes:"Living room"},
    title:"Final compliance service",
    estimated_duration_min:180
  }});
  assert.equal(converted.status,201,JSON.stringify(converted.payload));
  assert.equal(converted.payload.idempotent,false);
  assert.equal(converted.payload.job.stage,"planned");
  assert.equal(converted.payload.job.scheduled_at,null);
  assert.equal(converted.payload.job.estimated_duration_min,180);
  assert.equal(converted.payload.client.name,"Final Client");
  assert.equal(converted.payload.piano.brand,"Steinway & Sons");
  shared.client=converted.payload.client;shared.piano=converted.payload.piano;shared.job=converted.payload.job;

  const duplicate=await request("/api/intake/"+intake.payload.id+"/convert-to-job",{token,method:"POST",body:{}});
  assert.equal(duplicate.status,200,JSON.stringify(duplicate.payload));
  assert.equal(duplicate.payload.idempotent,true);
  assert.equal(duplicate.payload.job.id,converted.payload.job.id);

  const pipeline=await request("/api/jobs/pipeline",{token});
  assert.equal(pipeline.status,200,JSON.stringify(pipeline.payload));
  assert.ok(pipeline.payload.some(job=>job.id===converted.payload.job.id));
  const workflow=await request("/api/jobs/workflow",{token});
  assert.equal(workflow.status,200,JSON.stringify(workflow.payload));
  assert.equal(workflow.payload.jobs.some(job=>job.id===converted.payload.job.id),false);
});

test("Pipeline activation feeds the Calendar and exact five-stage Workflow",async()=>{
  const token=shared.adminToken;
  const activated=await request("/api/jobs/activate/"+shared.job.id,{token,method:"POST",body:{
    scheduled_at:futureIso(0,14),
    estimated_duration_min:180,
    assigned_technician_id:"U-F-WORKER"
  }});
  assert.equal(activated.status,200,JSON.stringify(activated.payload));
  assert.equal(activated.payload.stage,"received");
  assert.equal(activated.payload.assigned_technician_id,"U-F-WORKER");
  shared.job=activated.payload;

  const pipeline=await request("/api/jobs/pipeline",{token});
  assert.equal(pipeline.status,200);
  assert.equal(pipeline.payload.some(job=>job.id===shared.job.id),false);

  const workflow=await request("/api/jobs/workflow",{token});
  assert.equal(workflow.status,200,JSON.stringify(workflow.payload));
  assert.equal(workflow.payload.bucket,"active");
  assert.deepEqual(workflow.payload.stages.map(stage=>stage.key),["received","in_progress","qa_review","admin_approval"]);
  assert.equal(workflow.payload.columns.length,4);
  assert.ok(workflow.payload.jobs.some(job=>job.id===shared.job.id));

  const calendar=await request("/api/calendar?from=2035-05-10T00:00:00.000Z&to=2035-05-11T23:59:59.000Z",{token});
  assert.equal(calendar.status,200,JSON.stringify(calendar.payload));
  const event=calendar.payload.jobs.find(job=>job.id===shared.job.id);
  assert.ok(event);
  assert.equal(event.stage,"received");
  assert.ok(event.scheduled_end);
});

test("Handoff fields are optional, current technician carries forward, and costs aggregate",async()=>{
  const workerToken=await login("tech.final@example.com");
  shared.workerToken=workerToken;
  const first=await request("/api/jobs/"+shared.job.id+"/handoff",{token:workerToken,method:"POST",body:{}});
  assert.equal(first.status,201,JSON.stringify(first.payload));
  assert.equal(first.payload.job.stage,"in_progress");
  assert.equal(first.payload.job.assigned_technician_id,"U-F-WORKER");
  assert.equal(first.payload.handoff.phase_labor_cost,0);
  assert.equal(first.payload.handoff.phase_material_cost,0);

  const second=await request("/api/jobs/"+shared.job.id+"/handoff",{token:workerToken,method:"POST",body:{
    phase_labor_cost:150,
    phase_material_cost:30,
    phase_note:"Regulation completed; proceed to QA."
  }});
  assert.equal(second.status,201,JSON.stringify(second.payload));
  assert.equal(second.payload.job.stage,"qa_review");
  assert.equal(second.payload.job.assigned_technician_id,"U-F-WORKER");
  assert.equal(second.payload.job.total_labor_cost,150);
  assert.equal(second.payload.job.total_material_cost,30);

  const third=await request("/api/jobs/"+shared.job.id+"/handoff",{token:workerToken,method:"POST",body:{}});
  assert.equal(third.status,201,JSON.stringify(third.payload));
  assert.equal(third.payload.job.stage,"admin_approval");
  assert.equal(third.payload.job.assigned_technician_id,"U-F-WORKER");
  shared.job=third.payload.job;

  const handoffs=await request("/api/jobs/"+shared.job.id+"/handoffs",{token:workerToken});
  assert.equal(handoffs.status,200);
  assert.equal(handoffs.payload.length,3);

  const denied=await request("/api/jobs/"+shared.job.id+"/complete",{token:workerToken,method:"POST",body:{invoice_mode:"draft"}});
  assert.equal(denied.status,403);
});

test("Admin closeout creates editable draft invoice from aggregated costs and records closing Admin",async()=>{
  const token=shared.adminToken;
  appDb.prepare("UPDATE clients SET email=NULL WHERE id=?").run(shared.client.id);
  const closeout=await request("/api/jobs/"+shared.job.id+"/complete",{token,method:"POST",body:{
    invoice_mode:"draft",
    due_date:nyDate(),
    email_language:"en",
    recipient_email:"captured.final@example.com"
  }});
  assert.equal(closeout.status,201,JSON.stringify(closeout.payload));
  assert.equal(closeout.payload.invoice.status,"draft");
  assert.equal(closeout.payload.invoice.subtotal_labor,150);
  assert.equal(closeout.payload.invoice.subtotal_material,30);
  assert.equal(closeout.payload.invoice.total_amount,180);
  assert.match(closeout.payload.invoice.invoice_number,/^INV-\d{4}-\d{4}$/);
  assert.match(closeout.payload.invoice.pdf_path,/^\/uploads\/invoices\//);
  assert.equal(closeout.payload.job.stage,"completed");
  assert.equal(closeout.payload.job.completed_by_name,"Final Admin");
  assert.equal(closeout.payload.invoice.counterparty_email,"captured.final@example.com");
  assert.equal(appDb.prepare("SELECT email FROM clients WHERE id=?").get(shared.client.id).email,"captured.final@example.com");
  const activeWorkflow=await request("/api/jobs/workflow",{token});
  assert.equal(activeWorkflow.status,200);
  assert.equal(activeWorkflow.payload.jobs.some(job=>job.id===shared.job.id),false);
  const closedWorkflow=await request("/api/jobs/workflow?bucket=closed",{token});
  assert.equal(closedWorkflow.status,200,JSON.stringify(closedWorkflow.payload));
  assert.equal(closedWorkflow.payload.bucket,"closed");
  assert.deepEqual(closedWorkflow.payload.stages.map(stage=>stage.key),["completed"]);
  assert.ok(closedWorkflow.payload.jobs.some(job=>job.id===shared.job.id));
  shared.invoice=closeout.payload.invoice;

  const edit=await request("/api/invoices/"+shared.invoice.id,{token,method:"PUT",body:{
    summary:"Final adjusted invoice",
    due_date:nyDate(),
    email_language:"en",
    tax_rate:0,
    items:[
      {item_type:"labor",item_description:"Technician service",quantity:1,unit_price:200},
      {item_type:"material",item_description:"Action materials",quantity:1,unit_price:50},
      {item_type:"adjustment",item_description:"Courtesy discount",quantity:1,unit_price:-25}
    ]
  }});
  assert.equal(edit.status,200,JSON.stringify(edit.payload));
  assert.equal(edit.payload.status,"draft");
  assert.equal(edit.payload.subtotal_labor,200);
  assert.equal(edit.payload.subtotal_material,50);
  assert.equal(edit.payload.subtotal_adjustment,-25);
  assert.equal(edit.payload.total_amount,225);
  shared.invoice=edit.payload;

  const invoicePdf=await pdf("/api/invoices/"+shared.invoice.id+"/pdf",token);
  assert.equal(invoicePdf.status,200);
  assert.equal(invoicePdf.buffer.subarray(0,5).toString(),"%PDF-");

  const overview=await request("/api/finance/overview?month="+nyDate().slice(0,7),{token});
  assert.equal(overview.status,200,JSON.stringify(overview.payload));
  assert.equal(overview.payload.kpis.outstanding_invoice_count,1);
  assert.equal(overview.payload.kpis.outstanding_invoice_amount,225);
});

test("Invoice email uses English by default, Hungarian is available, and failed delivery remains draft",async()=>{
  const en=buildWorkshopInvoiceEmail({clientName:"Jane Client",piano:{brand:"Steinway & Sons",model:"B"},workSummary:"Regulation",invoiceNumber:"INV-TEST",totalAmount:225});
  assert.match(en.subject,/Klavierhaus invoice/);
  assert.match(en.text,/Dear Jane Client/);
  const hu=buildWorkshopInvoiceEmail({clientName:"Teszt Ügyfél",piano:{brand:"Steinway & Sons",model:"B"},workSummary:"Szabályozás",invoiceNumber:"INV-TEST",totalAmount:225,language:"hu"});
  assert.match(hu.subject,/számla/i);
  assert.match(hu.text,/Tisztelt Teszt Ügyfél/);

  const sent=await request("/api/invoices/"+shared.invoice.id+"/send-email",{token:shared.adminToken,method:"POST",body:{language:"en"}});
  assert.equal(sent.status,503,JSON.stringify(sent.payload));
  assert.equal(sent.payload.error,"EMAIL_DELIVERY_NOT_CONFIGURED");
  const detail=await request("/api/invoices/"+shared.invoice.id,{token:shared.adminToken});
  assert.equal(detail.status,200);
  assert.equal(detail.payload.status,"draft");
  assert.equal(detail.payload.email_log[0].status,"failed");
});

test("There is no partial-payment path; sent invoice is settled in one full Mark Paid action",async()=>{
  const token=shared.adminToken;
  appDb.prepare("UPDATE invoices SET status='sent',sent_at=CURRENT_TIMESTAMP WHERE id=?").run(shared.invoice.id);
  const missingPartial=await request("/api/invoices/"+shared.invoice.id+"/payments",{token,method:"POST",body:{amount:10,payment_method:"Cash"}});
  assert.equal(missingPartial.status,404);

  const paid=await request("/api/invoices/"+shared.invoice.id+"/mark-paid",{token,method:"POST",body:{
    payment_method:"Bank Transfer",
    paid_at:nyDate(),
    reference:"FINAL-FULL"
  }});
  assert.equal(paid.status,200,JSON.stringify(paid.payload));
  assert.equal(paid.payload.invoice.status,"paid");
  assert.equal(paid.payload.invoice.payment_method,"Bank Transfer");
  assert.equal(paid.payload.invoice.payments.length,1);
  assert.equal(paid.payload.invoice.payments[0].amount,225);

  const overview=await request("/api/finance/overview?month="+nyDate().slice(0,7),{token});
  assert.equal(overview.status,200);
  assert.equal(overview.payload.kpis.labor_revenue,200);
  assert.equal(overview.payload.kpis.outstanding_invoice_count,0);
});

test("Direct expenses and paid vendor bills feed workshop cost KPI",async()=>{
  const token=shared.adminToken;
  const expense=await request("/api/direct-expenses",{token,method:"POST",body:{
    category:"Tooling",
    description:"Workshop consumables",
    amount:40,
    expense_date:nyDate(),
    receipt_url:"https://example.com/receipt.pdf"
  }});
  assert.equal(expense.status,201,JSON.stringify(expense.payload));

  const partner=await request("/api/partners",{token,method:"POST",body:{
    company_name:"Final Vendor",
    email:"vendor.final@example.com",
    contractor_user_ids:["U-F-WORKER"]
  }});
  assert.equal(partner.status,201,JSON.stringify(partner.payload));
  shared.partner=partner.payload;

  const bill=await request("/api/invoices",{token,method:"POST",body:{
    direction:"payable",
    partner_id:partner.payload.id,
    summary:"Replacement parts",
    issue_date:nyDate(),
    due_date:nyDate(),
    tax_rate:0,
    items:[{item_type:"material",item_description:"Replacement parts",quantity:1,unit_price:80}]
  }});
  assert.equal(bill.status,201,JSON.stringify(bill.payload));
  assert.equal(bill.payload.status,"sent");
  assert.match(bill.payload.invoice_number,/^VND-\d{4}-\d{4}$/);

  const paid=await request("/api/invoices/"+bill.payload.id+"/mark-paid",{token,method:"POST",body:{payment_method:"Check",paid_at:nyDate(),reference:"CHK-FINAL"}});
  assert.equal(paid.status,200,JSON.stringify(paid.payload));
  assert.equal(paid.payload.invoice.status,"paid");

  const overview=await request("/api/finance/overview?month="+nyDate().slice(0,7),{token});
  assert.equal(overview.status,200,JSON.stringify(overview.payload));
  assert.equal(overview.payload.kpis.labor_revenue,200);
  assert.equal(overview.payload.breakdown.direct_expenses,40);
  assert.equal(overview.payload.breakdown.paid_vendor_bills,80);
  assert.equal(overview.payload.breakdown.handoff_material,30);
  assert.equal(overview.payload.kpis.material_direct_cost,150);
  assert.equal(overview.payload.kpis.net_workshop_result,50);

  const cache=appDb.prepare("SELECT * FROM kpi_summary_cache WHERE month_key=?").get(nyDate().slice(0,7));
  assert.ok(cache);
  assert.equal(cache.labor_revenue,200);
  assert.equal(cache.material_direct_cost,150);
});

test("Admin cancellation removes a job from active Calendar/Workflow while incurred costs remain costs",async()=>{
  const token=shared.adminToken;
  const created=await request("/api/jobs",{token,method:"POST",body:{
    client_id:shared.client.id,
    piano_id:shared.piano.id,
    title:"Cancelled workflow cost test",
    assigned_technician_id:"U-F-WORKER"
  }});
  assert.equal(created.status,201,JSON.stringify(created.payload));
  const activated=await request("/api/jobs/activate/"+created.payload.id,{token,method:"POST",body:{
    scheduled_at:futureIso(2,14),
    estimated_duration_min:120,
    assigned_technician_id:"U-F-WORKER"
  }});
  assert.equal(activated.status,200);

  const handoff=await request("/api/jobs/"+created.payload.id+"/handoff",{token:shared.workerToken,method:"POST",body:{
    phase_labor_cost:60,
    phase_material_cost:10,
    phase_note:"Initial work before cancellation"
  }});
  assert.equal(handoff.status,201,JSON.stringify(handoff.payload));

  const cancelled=await request("/api/jobs/"+created.payload.id+"/cancel",{token,method:"POST",body:{party:"client",reason:"Client stopped the project"}});
  assert.equal(cancelled.status,200,JSON.stringify(cancelled.payload));
  assert.equal(cancelled.payload.job.cancelled_by_name,"Final Admin");
  assert.equal(cancelled.payload.job.cancelled_by_party,"client");

  const workflow=await request("/api/jobs/workflow",{token});
  assert.equal(workflow.payload.jobs.some(job=>job.id===created.payload.id),false);
  const calendar=await request("/api/calendar?from=2035-05-11T00:00:00.000Z&to=2035-05-14T23:59:59.000Z",{token});
  assert.equal(calendar.payload.jobs.some(job=>job.id===created.payload.id),false);
  const history=await request("/api/jobs?include_cancelled=1",{token});
  assert.ok(history.payload.some(job=>job.id===created.payload.id&&job.cancelled_at));

  const overview=await request("/api/finance/overview?month="+nyDate().slice(0,7),{token});
  assert.equal(overview.status,200);
  assert.equal(overview.payload.breakdown.cancelled_labor,60);
  assert.equal(overview.payload.breakdown.handoff_material,40);
  assert.equal(overview.payload.kpis.material_direct_cost,220);
  assert.equal(overview.payload.kpis.net_workshop_result,-20);
});

test("Admin and Super Admin invoice controls move deleted drafts to the document archive",async()=>{
  const token=shared.adminToken;
  const manual=await request("/api/invoices",{token,method:"POST",body:{
    direction:"receivable",
    client_id:shared.client.id,
    summary:"Manual draft to cancel",
    issue_date:nyDate(),
    due_date:nyDate(),
    items:[{item_type:"labor",item_description:"Consultation",quantity:1,unit_price:25}]
  }});
  assert.equal(manual.status,201,JSON.stringify(manual.payload));
  assert.equal(manual.payload.status,"draft");

  const cancelled=await request("/api/invoices/"+manual.payload.id+"/cancel",{token,method:"POST",body:{reason:"Duplicate draft"}});
  assert.equal(cancelled.status,200,JSON.stringify(cancelled.payload));
  assert.equal(cancelled.payload.status,"cancelled");

  const denied=await request("/api/invoices/"+manual.payload.id,{token,method:"DELETE"});
  assert.equal(denied.status,403);
  assert.equal(denied.payload.error,"SUPERADMIN_REQUIRED");

  const superToken=await login("owner.final@example.com");
  const deleted=await request("/api/invoices/"+manual.payload.id,{token:superToken,method:"DELETE",body:{reason:"Duplicate draft removed from active finance"}});
  assert.equal(deleted.status,200,JSON.stringify(deleted.payload));
  assert.equal(deleted.payload.archived,true);
  const missing=await request("/api/invoices/"+manual.payload.id,{token:superToken});
  assert.equal(missing.status,404);
  const activeInvoices=await request("/api/invoices",{token:superToken});
  assert.equal(activeInvoices.status,200);
  assert.equal(activeInvoices.payload.some(row=>row.id===manual.payload.id),false);
  const archive=await request("/api/archive/documents?category=deleted_invoice",{token:superToken});
  assert.equal(archive.status,200,JSON.stringify(archive.payload));
  const archived=archive.payload.rows.find(row=>row.entity_type==="invoice"&&String(row.entity_id)===String(manual.payload.id));
  assert.ok(archived);
  assert.equal(archived.metadata.invoice.invoice_number,manual.payload.invoice_number);
  const retained=appDb.prepare("SELECT deleted_at,archive_document_id FROM invoices WHERE id=?").get(manual.payload.id);
  assert.ok(retained?.deleted_at);
  assert.equal(Number(retained.archive_document_id),Number(archived.id));
});

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
function recentBusinessIso(daysAgo=1,hourUtc=14){
  const d=new Date();d.setUTCDate(d.getUTCDate()-daysAgo);d.setUTCHours(hourUtc,0,0,0);return d.toISOString();
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

test("operations enhancements persist staff profiles, Milestone and full XLSX export",async()=>{
  const token=await login("admin.final@example.com");
  const skill=await request("/api/staff-skills",{token,method:"POST",body:{name_en:"Concert Preparation",name_hu:"Koncert-előkészítés",description_en:"Concert preparation and final technical setup"}});
  assert.equal(skill.status,201,JSON.stringify(skill.payload));
  assert.equal(skill.payload.name_en,"Concert Preparation");
  shared.operationsSkillId=skill.payload.id;

  const workProfile=await request("/api/users/U-F-MANAGER/work-profile",{token,method:"PUT",body:{manager_scope:"INSIDE",skill_ids:[skill.payload.id]}});
  assert.equal(workProfile.status,200,JSON.stringify(workProfile.payload));
  assert.equal(workProfile.payload.manager_scope,"INSIDE");
  assert.ok(workProfile.payload.skill_ids.includes(skill.payload.id));

  const profiles=await request("/api/work-profiles",{token});
  assert.equal(profiles.status,200,JSON.stringify(profiles.payload));
  assert.ok(profiles.payload.some(row=>row.id==="U-F-MANAGER"&&row.manager_scope==="INSIDE"));

  const milestone=await request("/api/milestone",{token,method:"PUT",body:{dashboard:{
    title_en:"Road to One Million",title_hu:"Út az egymillióhoz",quote_en:"One completed step at a time.",quote_hu:"Lépésről lépésre.",
    start_date:"2035-01-01",end_date:"2035-12-31",target_label:"$1M Klavierhaus",hero_icon:"growth"
  },steps:[
    {uid:"m1",step_kind:"major",title_en:"Build repeatable workshop flow",title_hu:"Ismételhető műhelyfolyamat",target_date:"2035-04-01",completed:true,icon:"workshop",link_view:"workshop"},
    {uid:"s1",parent_uid:"m1",step_kind:"minor",title_en:"Finish priority grand piano",title_hu:"Kiemelt zongora befejezése",completed:true,icon:"piano",link_view:"master"},
    {uid:"m2",step_kind:"major",title_en:"Reach the next revenue milestone",title_hu:"Következő bevételi cél",target_date:"2035-09-01",completed:false,icon:"revenue",link_view:"finance"},
    {uid:"s2",parent_uid:"m2",step_kind:"minor",title_en:"Contact institutional prospect",title_hu:"Intézményi kapcsolat felkeresése",completed:false,icon:"phone",link_view:"master"},
    {uid:"m3",step_kind:"major",title_en:"Expand partner network",title_hu:"Partnerhálózat bővítése",completed:false,icon:"partner"},
    {uid:"m4",step_kind:"major",title_en:"Cross one million dollars",title_hu:"Egymillió dollár átlépése",completed:false,icon:"flag"}
  ]}});
  assert.equal(milestone.status,200,JSON.stringify(milestone.payload));
  assert.equal(milestone.payload.total_count,6);
  assert.equal(milestone.payload.major_steps.length,4);
  assert.equal(milestone.payload.minor_steps.length,2);
  assert.equal(milestone.payload.completed_count,2);
  assert.equal(milestone.payload.dashboard.target_label,"$1M Klavierhaus");
  assert.equal(milestone.payload.next_step.title_en,"Reach the next revenue milestone");
  assert.ok(milestone.payload.icon_keys.includes("piano"));
  assert.ok(milestone.payload.icon_keys.length>=30);

  const milestoneRead=await request("/api/milestone",{token});
  assert.equal(milestoneRead.status,200,JSON.stringify(milestoneRead.payload));
  assert.equal(milestoneRead.payload.steps.length,6);
  assert.equal(milestoneRead.payload.steps.find(row=>row.uid==="s1").parent_uid,"m1");

  const huOnlyMilestone=await request("/api/milestone",{token,method:"PUT",body:{dashboard:{title_en:"Road to One Million",title_hu:"Út az egymillióhoz"},steps:[
    {uid:"hm1",step_kind:"major",title_hu:"Magyar fő mérföldkő",completed:false,icon:"target"},
    {uid:"hs1",parent_uid:"hm1",step_kind:"minor",title_hu:"Magyar almérföldkő",completed:false,icon:"check"}
  ]}});
  assert.equal(huOnlyMilestone.status,200,JSON.stringify(huOnlyMilestone.payload));
  assert.equal(huOnlyMilestone.payload.steps.find(row=>row.uid==="hm1").title_en,"Magyar fő mérföldkő");
  assert.equal(huOnlyMilestone.payload.steps.find(row=>row.uid==="hs1").parent_uid,"hm1");

  const orphanMinor=await request("/api/milestone",{token,method:"PUT",body:{dashboard:{title_en:"Road to One Million",title_hu:"Út az egymillióhoz"},steps:[
    {uid:"om1",step_kind:"major",title_en:"Major",title_hu:"Fő"},
    {uid:"os1",step_kind:"minor",title_hu:"Árva almérföldkő",icon:"check"}
  ]}});
  assert.equal(orphanMinor.status,400,JSON.stringify(orphanMinor.payload));
  assert.equal(orphanMinor.payload.error,"MILESTONE_PARENT_REQUIRED");

  const exportResponse=await fetch(origin+"/api/system-export.xlsx",{headers:{Authorization:"Bearer "+token}});
  assert.equal(exportResponse.status,200);
  assert.match(exportResponse.headers.get("content-type")||"",/spreadsheetml/);
  const exportBuffer=Buffer.from(await exportResponse.arrayBuffer());
  assert.equal(exportBuffer.subarray(0,2).toString(),"PK");
  const zip=new (require("adm-zip"))(exportBuffer);
  const workbook=zip.readAsText("xl/workbook.xml");
  assert.match(workbook,/Manifest/);
  assert.match(workbook,/clients/);
  assert.match(workbook,/staff_skills/);
  assert.match(workbook,/milestone_steps/);
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

test("VIP client follow-up becomes overdue after three months and clears after contact",async()=>{
  const token=shared.adminToken;
  const oldContact=await request("/api/clients/"+shared.client.id,{token,method:"PUT",body:{is_vip:true,last_contacted_at:"2025-01-01"}});
  assert.equal(oldContact.status,200,JSON.stringify(oldContact.payload));
  assert.equal(Number(oldContact.payload.is_vip),1);
  assert.equal(oldContact.payload.last_contacted_at,"2025-01-01");

  const overdueList=await request("/api/clients?q="+encodeURIComponent(shared.client.name),{token});
  assert.equal(overdueList.status,200,JSON.stringify(overdueList.payload));
  const overdue=overdueList.payload.find(row=>Number(row.id)===Number(shared.client.id));
  assert.ok(overdue);
  assert.equal(overdue.vip_followup_due,true);

  const today=new Date().toISOString().slice(0,10);
  const contacted=await request("/api/clients/"+shared.client.id,{token,method:"PUT",body:{is_vip:true,last_contacted_at:today}});
  assert.equal(contacted.status,200,JSON.stringify(contacted.payload));
  const currentList=await request("/api/clients?q="+encodeURIComponent(shared.client.name),{token});
  const current=currentList.payload.find(row=>Number(row.id)===Number(shared.client.id));
  assert.ok(current);
  assert.equal(current.vip_followup_due,false);
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
  assert.deepEqual(workflow.payload.stages.map(stage=>stage.key),["received","in_progress","qa_review","admin_approval","completed"]);
  assert.deepEqual(workflow.payload.columns.map(stage=>stage.key),["received","in_progress","qa_review","admin_approval"]);
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
  assert.equal(closeout.payload.invoice.snapshot.counterparty.email,"captured.final@example.com");
  assert.equal(closeout.payload.invoice.snapshot.instrument.brand,shared.piano.brand);
  assert.equal(closeout.payload.invoice.items.length,3);
  const phaseLine=closeout.payload.invoice.items.find(item=>Number(item.labor_amount)===150&&Number(item.material_amount)===30);
  assert.ok(phaseLine,"phase-level labor/material invoice line must be preserved");
  assert.equal(appDb.prepare("SELECT email FROM clients WHERE id=?").get(shared.client.id).email,"captured.final@example.com");
  const activeWorkflow=await request("/api/jobs/workflow",{token});
  assert.equal(activeWorkflow.status,200);
  assert.equal(activeWorkflow.payload.jobs.some(job=>job.id===shared.job.id),false);
  const closedWorkflow=await request("/api/jobs/workflow?bucket=closed",{token});
  assert.equal(closedWorkflow.status,200,JSON.stringify(closedWorkflow.payload));
  assert.equal(closedWorkflow.payload.bucket,"closed");
  assert.deepEqual(closedWorkflow.payload.stages.map(stage=>stage.key),["received","in_progress","qa_review","admin_approval","completed"]);
  assert.deepEqual(closedWorkflow.payload.columns.map(stage=>stage.key),["completed"]);
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
  const invoicePdfSource=invoicePdf.buffer.toString("latin1");
  assert.match(invoicePdfSource,/1 1 1 rg 0 0 612 792 re f/);
  assert.doesNotMatch(invoicePdfSource,/0\.055 0\.055 0\.055 rg 0 0 612 792 re f/);

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
  const queued=appDb.prepare("SELECT * FROM automation_outbox WHERE event_type='SEND_INVOICE' AND entity_id=? ORDER BY created_at DESC LIMIT 1").get(String(shared.invoice.id));
  assert.ok(queued,"failed approved invoice delivery must remain durable");
  assert.equal(queued.status,"pending");
  assert.ok(Number(queued.attempts)>=1);
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
  assert.ok(Number(cancelled.payload.archive_document_id)>0);
  const activeAfterCancel=await request("/api/invoices",{token});
  assert.equal(activeAfterCancel.status,200);
  assert.equal(activeAfterCancel.payload.some(row=>row.id===manual.payload.id),false);
  const invalidatedDocs=await request("/api/archive/documents?category=deleted_invoice",{token});
  assert.equal(invalidatedDocs.status,200,JSON.stringify(invalidatedDocs.payload));
  const invalidatedDoc=invalidatedDocs.payload.rows.find(row=>row.entity_type==="invoice"&&String(row.entity_id)===String(manual.payload.id));
  assert.ok(invalidatedDoc);
  assert.equal(invalidatedDoc.metadata.source,"invoice_cancellation");
  assert.equal(invalidatedDoc.metadata.invoice.status,"cancelled");

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
  assert.equal(Number(archived.id),Number(invalidatedDoc.id));
  assert.equal(archived.metadata.invoice.invoice_number,manual.payload.invoice_number);
  const retained=appDb.prepare("SELECT deleted_at,archive_document_id FROM invoices WHERE id=?").get(manual.payload.id);
  assert.ok(retained?.deleted_at);
  assert.equal(Number(retained.archive_document_id),Number(archived.id));

  const form=new FormData();
  form.append("category","company_document");
  form.append("title","Internal operating note");
  form.append("description","Retention and operating reference");
  form.append("file",new Blob(["archive text"],{type:"text/plain"}),"operating-note.txt");
  const createdDocument=await request("/api/archive/documents",{token:superToken,method:"POST",form});
  assert.equal(createdDocument.status,201,JSON.stringify(createdDocument.payload));
  assert.equal(createdDocument.payload.category,"company_document");
  assert.equal(createdDocument.payload.original_name,"operating-note.txt");
  const companyDocuments=await request("/api/archive/documents?category=company_document",{token:superToken});
  assert.equal(companyDocuments.status,200);
  assert.ok(companyDocuments.payload.rows.some(row=>row.id===createdDocument.payload.id));
});



test("Deleting an Intake archives a complete snapshot and PDF while client and linked Job remain",async()=>{
  const token=shared.adminToken;
  const created=await request("/api/intake",{token,method:"POST",body:{
    client_id:shared.client.id,
    piano_id:shared.piano.id,
    raw_client_name:"Archive Intake Client",
    raw_contact:"archive.intake@example.com",
    service_location:"on_site",
    reported_issue:"Archive-only regulation assessment",
    estimated_urgency:"normal",
    media_urls:["https://example.com/archive-before.jpg"],
    assigned_technician_id:"U-F-WORKER"
  }});
  assert.equal(created.status,201,JSON.stringify(created.payload));

  const catalog=await request("/api/intake-catalog",{token,method:"POST",body:{
    category:"ARCHIVE TEST",title_en:"Archive regulation",title_hu:"Archív szabályozás",description_en:"Retention test",description_hu:"Megőrzési teszt",default_price:175,active:true
  }});
  assert.equal(catalog.status,201,JSON.stringify(catalog.payload));
  const assessment=await request("/api/intake/"+created.payload.id+"/assessment",{token,method:"PUT",body:{items:[{catalog_item_id:catalog.payload.id,price:190}]}});
  assert.equal(assessment.status,200,JSON.stringify(assessment.payload));
  assert.equal(assessment.payload.items.length,1);

  const linkedJob=await request("/api/jobs",{token,method:"POST",body:{
    client_id:shared.client.id,piano_id:shared.piano.id,title:"Job retained after Intake deletion"
  }});
  assert.equal(linkedJob.status,201,JSON.stringify(linkedJob.payload));
  appDb.prepare("UPDATE jobs SET intake_id=? WHERE id=?").run(created.payload.id,linkedJob.payload.id);

  const clientBefore=appDb.prepare("SELECT * FROM clients WHERE id=?").get(shared.client.id);
  const deleted=await request("/api/intake/"+created.payload.id,{token,method:"DELETE",body:{reason:"Customer cancelled before work approval"}});
  assert.equal(deleted.status,200,JSON.stringify(deleted.payload));
  assert.equal(deleted.payload.ok,true);
  assert.equal(deleted.payload.archive_document.category,"deleted_intake");

  const active=await request("/api/intake",{token});
  assert.equal(active.status,200);
  assert.equal(active.payload.some(row=>Number(row.id)===Number(created.payload.id)),false);
  assert.equal(Boolean(appDb.prepare("SELECT 1 FROM clients WHERE id=?").get(shared.client.id)),true);
  assert.equal(appDb.prepare("SELECT name FROM clients WHERE id=?").get(shared.client.id).name,clientBefore.name);
  const retainedJob=appDb.prepare("SELECT id,intake_id FROM jobs WHERE id=?").get(linkedJob.payload.id);
  assert.ok(retainedJob);
  assert.equal(retainedJob.intake_id,null);

  const archive=await request("/api/archive/documents?category=deleted_intake",{token});
  assert.equal(archive.status,200,JSON.stringify(archive.payload));
  const row=archive.payload.rows.find(item=>String(item.entity_id)===String(created.payload.id));
  assert.ok(row);
  assert.equal(row.metadata.source,"deleted_intake");
  assert.equal(row.metadata.intake.reported_issue,"Archive-only regulation assessment");
  assert.equal(row.metadata.items.length,1);
  assert.equal(row.metadata.items[0].price,190);
  assert.ok(row.metadata.linked_jobs.some(job=>Number(job.id)===Number(linkedJob.payload.id)));
  assert.equal(row.metadata.reason,"Customer cancelled before work approval");

  const archivedPdf=await pdf("/api/archive/documents/"+row.id+"/download",token);
  assert.equal(archivedPdf.status,200);
  assert.ok(archivedPdf.buffer.subarray(0,4).toString("utf8")==="%PDF");
});



test("Website recovery API enforces backup creation and destructive-action permissions",async()=>{
  const adminToken=shared.adminToken;
  const manual=await request("/api/website-recovery/backups",{token:adminToken,method:"POST",body:{label:"Pre-launch golden state"}});
  assert.equal(manual.status,201,JSON.stringify(manual.payload));
  assert.equal(manual.payload.trigger_type,"MANUAL");
  const status=await request("/api/website-recovery",{token:adminToken});
  assert.equal(status.status,200,JSON.stringify(status.payload));
  assert.ok(status.payload.backups.some(row=>row.id===manual.payload.id));

  const deniedFull=await request("/api/website-recovery/factory-reset",{token:adminToken,method:"POST",body:{scope:"all",confirmation:"RESET WEBSITE"}});
  assert.equal(deniedFull.status,403,JSON.stringify(deniedFull.payload));
  assert.equal(deniedFull.payload.error,"SUPERADMIN_REQUIRED");

  const superToken=await login("owner.final@example.com");
  const badRestore=await request("/api/website-recovery/backups/"+encodeURIComponent(manual.payload.id)+"/restore",{token:superToken,method:"POST",body:{confirmation:"WRONG"}});
  assert.equal(badRestore.status,409,JSON.stringify(badRestore.payload));
  assert.equal(badRestore.payload.error,"WEBSITE_RESTORE_CONFIRMATION_REQUIRED");
});


test("Dynamic workflow supports seven active reorderable phases plus a separate closed state",async()=>{
  const token=shared.adminToken;
  const initial=await request("/api/workflow/settings",{token});
  assert.equal(initial.status,200,JSON.stringify(initial.payload));
  assert.equal(initial.payload.stages.length,5);
  assert.equal(initial.payload.max_stages,7);
  assert.equal(initial.payload.active_stage_count,4);
  assert.equal(initial.payload.can_add_stage,true);

  const firstAdd=await request("/api/workflow/stages",{token,method:"POST",body:{label_en:"Voicing",label_hu:"Intonálás"}});
  assert.equal(firstAdd.status,201,JSON.stringify(firstAdd.payload));
  assert.equal(firstAdd.payload.stages.length,6);
  assert.equal(firstAdd.payload.active_stage_count,5);
  const voicing=firstAdd.payload.stages.find(stage=>stage.label_en==="Voicing");
  assert.ok(voicing);
  assert.equal(voicing.removable,true);

  const secondAdd=await request("/api/workflow/stages",{token,method:"POST",body:{label_en:"Final Polish",label_hu:"Végső finomítás"}});
  assert.equal(secondAdd.status,201,JSON.stringify(secondAdd.payload));
  assert.equal(secondAdd.payload.stages.length,7);
  assert.equal(secondAdd.payload.active_stage_count,6);
  assert.equal(secondAdd.payload.can_add_stage,true);
  const polish=secondAdd.payload.stages.find(stage=>stage.label_en==="Final Polish");
  assert.ok(polish);

  const thirdAdd=await request("/api/workflow/stages",{token,method:"POST",body:{label_en:"Action Regulation",label_hu:"Mechanika szabályozás"}});
  assert.equal(thirdAdd.status,201,JSON.stringify(thirdAdd.payload));
  assert.equal(thirdAdd.payload.stages.length,8);
  assert.equal(thirdAdd.payload.active_stage_count,7);
  assert.equal(thirdAdd.payload.can_add_stage,false);
  const regulation=thirdAdd.payload.stages.find(stage=>stage.label_en==="Action Regulation");
  assert.ok(regulation);

  const deniedFourth=await request("/api/workflow/stages",{token,method:"POST",body:{label_en:"Extra Eighth Active",label_hu:"Nyolcadik aktív"}});
  assert.equal(deniedFourth.status,409,JSON.stringify(deniedFourth.payload));
  assert.equal(deniedFourth.payload.error,"WORKFLOW_STAGE_LIMIT_REACHED");

  const middle=[polish.key,"qa_review","in_progress",voicing.key,regulation.key];
  const reordered=await request("/api/workflow/stages/order",{token,method:"PUT",body:{stage_keys:middle}});
  assert.equal(reordered.status,200,JSON.stringify(reordered.payload));
  assert.deepEqual(reordered.payload.stages.map(stage=>stage.key),["received",...middle,"admin_approval","completed"]);

  const defaultScoped=await request("/api/jobs",{token,method:"POST",body:{
    client_id:shared.client.id,piano_id:shared.piano.id,title:"Default scoped workflow test"
  }});
  assert.equal(defaultScoped.status,201,JSON.stringify(defaultScoped.payload));
  assert.deepEqual(defaultScoped.payload.workflow_phases.map(phase=>phase.stage_key).sort(),["admin_approval","completed","in_progress","qa_review","received"].sort());
  assert.equal(defaultScoped.payload.workflow_phases.some(phase=>[voicing.key,polish.key,regulation.key].includes(phase.stage_key)),false);

  const created=await request("/api/jobs",{token,method:"POST",body:{
    client_id:shared.client.id,piano_id:shared.piano.id,title:"Flexible dynamic workflow test",
    workflow_phases:reordered.payload.stages.map(stage=>({stage_key:stage.key,enabled:true}))
  }});
  assert.equal(created.status,201,JSON.stringify(created.payload));
  assert.equal(created.payload.stage,"planned");
  assert.equal(created.payload.workflow_phases.filter(phase=>phase.enabled&&phase.stage_key!=="completed").length,7);
  assert.equal(created.payload.workflow_phases.filter(phase=>phase.enabled).length,8);

  const activated=await request("/api/jobs/activate/"+created.payload.id,{token,method:"POST",body:{
    scheduled_at:futureIso(6,14),estimated_duration_min:120,assigned_technician_id:"U-F-WORKER"
  }});
  assert.equal(activated.status,200,JSON.stringify(activated.payload));
  assert.equal(activated.payload.stage,"received");

  const jumpToVoicing=await request("/api/jobs/"+created.payload.id+"/handoff",{token:shared.workerToken,method:"POST",body:{
    to_stage:voicing.key,phase_note:"Voicing is ready before the earlier intermediate phases"
  }});
  assert.equal(jumpToVoicing.status,201,JSON.stringify(jumpToVoicing.payload));
  assert.equal(jumpToVoicing.payload.job.stage,voicing.key);

  const toQa=await request("/api/jobs/"+created.payload.id+"/handoff",{token:shared.workerToken,method:"POST",body:{to_stage:"qa_review"}});
  assert.equal(toQa.status,201,JSON.stringify(toQa.payload));
  assert.equal(toQa.payload.job.stage,"qa_review");

  const prematureApproval=await request("/api/jobs/"+created.payload.id+"/handoff",{token:shared.workerToken,method:"POST",body:{to_stage:"admin_approval"}});
  assert.equal(prematureApproval.status,409,JSON.stringify(prematureApproval.payload));
  assert.equal(prematureApproval.payload.error,"WORKFLOW_PHASES_REMAINING");

  const toPolish=await request("/api/jobs/"+created.payload.id+"/handoff",{token:shared.workerToken,method:"POST",body:{to_stage:polish.key}});
  assert.equal(toPolish.status,201,JSON.stringify(toPolish.payload));
  const toProgress=await request("/api/jobs/"+created.payload.id+"/handoff",{token:shared.workerToken,method:"POST",body:{to_stage:"in_progress"}});
  assert.equal(toProgress.status,201,JSON.stringify(toProgress.payload));
  const toRegulation=await request("/api/jobs/"+created.payload.id+"/handoff",{token:shared.workerToken,method:"POST",body:{to_stage:regulation.key}});
  assert.equal(toRegulation.status,201,JSON.stringify(toRegulation.payload));
  const toApproval=await request("/api/jobs/"+created.payload.id+"/handoff",{token:shared.workerToken,method:"POST",body:{to_stage:"admin_approval"}});
  assert.equal(toApproval.status,201,JSON.stringify(toApproval.payload));
  assert.equal(toApproval.payload.job.stage,"admin_approval");
  assert.equal(toApproval.payload.job.ready_for_closeout,true);

  const historyBeforeCancel=await request("/api/jobs/"+created.payload.id+"/history",{token});
  assert.equal(historyBeforeCancel.status,200,JSON.stringify(historyBeforeCancel.payload));
  assert.equal(historyBeforeCancel.payload.handoffs.length,6);
  assert.ok(historyBeforeCancel.payload.phases.find(phase=>phase.stage_key===voicing.key)?.completed_at);
  assert.ok(historyBeforeCancel.payload.events.length>=1);

  const cancelled=await request("/api/jobs/"+created.payload.id+"/cancel",{token,method:"POST",body:{party:"klavierhaus",reason:"Dynamic workflow cancellation audit test"}});
  assert.equal(cancelled.status,200,JSON.stringify(cancelled.payload));

  const cancelledClosed=await request("/api/jobs/workflow?bucket=closed&closed_type=cancelled",{token});
  assert.equal(cancelledClosed.status,200,JSON.stringify(cancelledClosed.payload));
  assert.equal(cancelledClosed.payload.closed_type,"cancelled");
  assert.ok(cancelledClosed.payload.jobs.some(job=>job.id===created.payload.id));
  const completedClosed=await request("/api/jobs/workflow?bucket=closed&closed_type=completed",{token});
  assert.equal(completedClosed.status,200);
  assert.equal(completedClosed.payload.jobs.some(job=>job.id===created.payload.id),false);
  assert.ok(completedClosed.payload.jobs.some(job=>job.id===shared.job.id));

  const removeVoicing=await request("/api/workflow/stages/"+encodeURIComponent(voicing.key),{token,method:"DELETE"});
  assert.equal(removeVoicing.status,200,JSON.stringify(removeVoicing.payload));
  const removePolish=await request("/api/workflow/stages/"+encodeURIComponent(polish.key),{token,method:"DELETE"});
  assert.equal(removePolish.status,200,JSON.stringify(removePolish.payload));
  const removeRegulation=await request("/api/workflow/stages/"+encodeURIComponent(regulation.key),{token,method:"DELETE"});
  assert.equal(removeRegulation.status,200,JSON.stringify(removeRegulation.payload));
  assert.deepEqual(removeRegulation.payload.stages.map(stage=>stage.key),["received","qa_review","in_progress","admin_approval","completed"]);
});

test("Job-specific phases stay isolated and workflow/calendar APIs enforce half-hour business scheduling",async()=>{
  const token=shared.adminToken;
  const first=await request("/api/jobs",{token,method:"POST",body:{client_id:shared.client.id,piano_id:shared.piano.id,title:"Job scoped phase A"}});
  const second=await request("/api/jobs",{token,method:"POST",body:{client_id:shared.client.id,piano_id:shared.piano.id,title:"Job scoped phase B"}});
  assert.equal(first.status,201,JSON.stringify(first.payload));
  assert.equal(second.status,201,JSON.stringify(second.payload));

  const added=await request("/api/jobs/"+first.payload.id+"/workflow-phases/custom",{token,method:"POST",body:{label_en:"Delivery Window",label_hu:"Kiszállítási ablak"}});
  assert.equal(added.status,201,JSON.stringify(added.payload));
  const custom=added.payload.workflow_phases.find(phase=>phase.label_en==="Delivery Window");
  assert.ok(custom);
  assert.equal(custom.job_specific,true);
  const untouched=await request("/api/jobs/"+second.payload.id,{token});
  assert.equal(untouched.status,200,JSON.stringify(untouched.payload));
  assert.equal(untouched.payload.workflow_phases.some(phase=>phase.stage_key===custom.stage_key),false);

  const invalidQuarter=await request("/api/jobs/activate/"+second.payload.id,{token,method:"POST",body:{scheduled_at:"2035-05-20T14:07:00.000Z",estimated_duration_min:120,assigned_technician_id:"U-F-WORKER"}});
  assert.equal(invalidQuarter.status,400,JSON.stringify(invalidQuarter.payload));
  assert.equal(invalidQuarter.payload.error,"WORK_TIME_HALF_HOUR_REQUIRED");

  const activated=await request("/api/jobs/activate/"+second.payload.id,{token,method:"POST",body:{scheduled_at:"2035-05-20T14:00:00.000Z",estimated_duration_min:120,assigned_technician_id:"U-F-WORKER"}});
  assert.equal(activated.status,200,JSON.stringify(activated.payload));
  const tooShort=await request("/api/jobs/"+second.payload.id+"/workflow-phases/received",{token,method:"PATCH",body:{starts_at:"2035-05-20T14:00:00.000Z",due_at:"2035-05-20T16:30:00.000Z"}});
  assert.equal(tooShort.status,400,JSON.stringify(tooShort.payload));
  assert.equal(tooShort.payload.error,"WORKFLOW_LOGISTICS_MINIMUM_WINDOW");
  const validWindow=await request("/api/jobs/"+second.payload.id+"/workflow-phases/received",{token,method:"PATCH",body:{starts_at:"2035-05-20T14:00:00.000Z",due_at:"2035-05-20T17:00:00.000Z"}});
  assert.equal(validWindow.status,200,JSON.stringify(validWindow.payload));
});

test("customer phase prices and deposit persist through job finance into the final invoice",async()=>{
  const token=shared.adminToken;
  const created=await request("/api/jobs",{token,method:"POST",body:{
    client_id:shared.client.id,piano_id:shared.piano.id,title:"Quoted phase finance",
    scheduled_at:futureIso(40,14),estimated_duration_min:120,assigned_technician_id:"U-F-WORKER",estimated_revenue:1500,deposit_amount:250,
    workflow_phases:[
      {stage_key:"received",enabled:true,customer_price:700,responsibility_skill_id:shared.operationsSkillId,starts_at:futureIso(40,14),due_at:futureIso(40,17),costs:[{title:"Wood",category:"material",amount:80},{title:"Lacquer",category:"material",amount:40}]},
      {stage_key:"admin_approval",enabled:true,customer_price:300},
      {stage_key:"completed",enabled:true}
    ]
  }});
  assert.equal(created.status,201,JSON.stringify(created.payload));
  assert.equal(created.payload.planned_total,1500);
  assert.equal(created.payload.phase_customer_total,1000);
  assert.equal(created.payload.phase_internal_cost_total,120);
  assert.equal(created.payload.deposit_amount,250);
  assert.equal(created.payload.balance_due,750);
  assert.equal(created.payload.estimated_balance,1250);
  assert.equal(created.payload.workflow_phases.find(phase=>phase.stage_key==="received").customer_price,700);
  assert.equal(created.payload.workflow_phases.find(phase=>phase.stage_key==="received").responsibility_skill_id,shared.operationsSkillId);
  assert.equal(created.payload.workflow_phases.find(phase=>phase.stage_key==="received").responsibility_skill_name_en,"Concert Preparation");
  const technicianProfile=await request("/api/users/U-F-WORKER/work-profile",{token});
  assert.equal(technicianProfile.status,200,JSON.stringify(technicianProfile.payload));
  assert.ok(technicianProfile.payload.skill_ids.includes(shared.operationsSkillId));
  assert.equal(created.payload.workflow_phases.find(phase=>phase.stage_key==="received").costs.length,2);
  assert.equal(created.payload.workflow_phases.find(phase=>phase.stage_key==="received").internal_cost_total,120);
  assert.equal(created.payload.workflow_phases.find(phase=>phase.stage_key==="admin_approval").customer_price,300);

  const approval=await request("/api/jobs/"+created.payload.id+"/handoff",{token,method:"POST",body:{to_stage:"admin_approval"}});
  assert.equal(approval.status,201,JSON.stringify(approval.payload));
  assert.equal(approval.payload.job.stage,"admin_approval");

  const completed=await request("/api/jobs/"+created.payload.id+"/complete",{token,method:"POST",body:{invoice_mode:"draft",email_language:"en"}});
  assert.equal(completed.status,201,JSON.stringify(completed.payload));
  assert.equal(completed.payload.invoice.total_amount,750);
  const invoice=await request("/api/invoices/"+completed.payload.invoice.id,{token});
  assert.equal(invoice.status,200,JSON.stringify(invoice.payload));
  assert.equal(invoice.payload.items.filter(item=>item.phase_key).reduce((sum,item)=>sum+Number(item.total_price),0),1000);
  const deposit=invoice.payload.items.find(item=>item.item_type==="adjustment"&&item.item_description==="Deposit received");
  assert.ok(deposit);
  assert.equal(deposit.total_price,-250);
});

test("Workflow timing can move backward and forward and recomputes colors",async()=>{
  const token=shared.adminToken;
  const created=await request("/api/jobs",{token,method:"POST",body:{
    client_id:shared.client.id,
    piano_id:shared.piano.id,
    title:"Bidirectional workflow timing test",
    scheduled_at:futureIso(30,14),
    estimated_duration_min:120,
    assigned_technician_id:"U-F-WORKER"
  }});
  assert.equal(created.status,201,JSON.stringify(created.payload));
  assert.equal(created.payload.stage,"received");
  assert.equal(created.payload.workflow_owner_user_id,"U-F-ADMIN");
  assert.equal(created.payload.workflow_status,"scheduled");
  assert.ok(created.payload.workflow_phases.filter(phase=>phase.enabled).every(phase=>phase.responsible_user_id===null));
  assert.ok(created.payload.workflow_phases.filter(phase=>phase.enabled).every(phase=>phase.effective_responsible_user_id==="U-F-WORKER"));

  const movedOwner=await request("/api/jobs/"+created.payload.id,{token,method:"PUT",body:{workflow_owner_user_id:"U-F-MANAGER"}});
  assert.equal(movedOwner.status,200,JSON.stringify(movedOwner.payload));
  assert.equal(movedOwner.payload.workflow_owner_user_id,"U-F-MANAGER");
  assert.equal(movedOwner.payload.assigned_technician_id,"U-F-WORKER");

  const overridePlan=movedOwner.payload.workflow_phases.map(phase=>({
    stage_key:phase.stage_key,position:phase.position,enabled:phase.enabled,starts_at:phase.starts_at,due_at:phase.due_at,
    customer_price:phase.customer_price,responsible_user_id:phase.stage_key==="qa_review"?"U-F-MANAGER":phase.responsible_user_id,costs:phase.costs||[]
  }));
  const overridden=await request("/api/jobs/"+created.payload.id+"/workflow-phases",{token,method:"PUT",body:{phases:overridePlan,estimated_revenue:movedOwner.payload.estimated_revenue,deposit_amount:movedOwner.payload.deposit_amount}});
  assert.equal(overridden.status,200,JSON.stringify(overridden.payload));
  assert.equal(overridden.payload.workflow_phases.find(phase=>phase.stage_key==="qa_review").responsible_user_id,"U-F-MANAGER");
  assert.equal(overridden.payload.workflow_phases.find(phase=>phase.stage_key==="qa_review").effective_responsible_user_id,"U-F-MANAGER");

  const resetPlan=overridden.payload.workflow_phases.map(phase=>({
    stage_key:phase.stage_key,position:phase.position,enabled:phase.enabled,starts_at:phase.starts_at,due_at:phase.due_at,
    customer_price:phase.customer_price,responsible_user_id:phase.stage_key==="qa_review"?null:phase.responsible_user_id,costs:phase.costs||[]
  }));
  const reset=await request("/api/jobs/"+created.payload.id+"/workflow-phases",{token,method:"PUT",body:{phases:resetPlan,estimated_revenue:overridden.payload.estimated_revenue,deposit_amount:overridden.payload.deposit_amount}});
  assert.equal(reset.status,200,JSON.stringify(reset.payload));
  assert.equal(reset.payload.workflow_phases.find(phase=>phase.stage_key==="qa_review").responsible_user_id,null);
  assert.equal(reset.payload.workflow_phases.find(phase=>phase.stage_key==="qa_review").effective_responsible_user_id,"U-F-WORKER");

  const pastStart=recentBusinessIso(1,14),pastDue=recentBusinessIso(1,17);
  const farFuture=futureIso(31,18);
  const started=await request("/api/jobs/"+created.payload.id+"/workflow-phases/received",{token,method:"PATCH",body:{
    starts_at:pastStart,due_at:farFuture,responsible_user_id:"U-F-MANAGER",blocker_code:null,blocker_note:null
  }});
  assert.equal(started.status,200,JSON.stringify(started.payload));
  assert.equal(started.payload.workflow_status,"in_progress");
  assert.equal(started.payload.current_phase.responsible_user_id,"U-F-MANAGER");
  assert.equal(started.payload.scheduled_at,pastStart);

  const overdue=await request("/api/jobs/"+created.payload.id+"/workflow-phases/received",{token,method:"PATCH",body:{
    due_at:pastDue
  }});
  assert.equal(overdue.status,200,JSON.stringify(overdue.payload));
  assert.equal(overdue.payload.workflow_status,"overdue");

  const blocked=await request("/api/jobs/"+created.payload.id+"/workflow-phases/received",{token,method:"PATCH",body:{
    due_at:farFuture,starts_at:pastStart,blocker_code:"waiting_client",blocker_note:"Awaiting confirmation"
  }});
  assert.equal(blocked.status,200,JSON.stringify(blocked.payload));
  assert.equal(blocked.payload.workflow_status,"blocked");

  const scheduledAgain=await request("/api/jobs/"+created.payload.id+"/workflow-phases/received",{token,method:"PATCH",body:{
    starts_at:futureIso(32,14),due_at:futureIso(32,18),blocker_code:null,blocker_note:null
  }});
  assert.equal(scheduledAgain.status,200,JSON.stringify(scheduledAgain.payload));
  assert.equal(scheduledAgain.payload.workflow_status,"scheduled");
  assert.equal(scheduledAgain.payload.scheduled_at,futureIso(32,14));

  const calendarMovedAt=futureIso(33,11);
  const calendarMoved=await request("/api/jobs/"+created.payload.id+"/schedule",{token,method:"PATCH",body:{scheduled_at:calendarMovedAt}});
  assert.equal(calendarMoved.status,200,JSON.stringify(calendarMoved.payload));
  assert.equal(calendarMoved.payload.scheduled_at,calendarMovedAt);
  assert.equal(calendarMoved.payload.current_phase.starts_at,calendarMovedAt);

  const retroactiveAgain=await request("/api/jobs/"+created.payload.id+"/workflow-phases/received",{token,method:"PATCH",body:{
    starts_at:pastStart,due_at:farFuture
  }});
  assert.equal(retroactiveAgain.status,200,JSON.stringify(retroactiveAgain.payload));
  assert.equal(retroactiveAgain.payload.workflow_status,"in_progress");
  assert.equal(retroactiveAgain.payload.scheduled_at,pastStart);

  const nextPhaseStart=futureIso(34,12);
  const plannedNext=await request("/api/jobs/"+created.payload.id+"/workflow-phases/in_progress",{token,method:"PATCH",body:{starts_at:nextPhaseStart,due_at:futureIso(34,18)}});
  assert.equal(plannedNext.status,200,JSON.stringify(plannedNext.payload));
  assert.equal(plannedNext.payload.scheduled_at,pastStart);
  const movedByWorkflowCard=await request("/api/jobs/"+created.payload.id+"/handoff",{token:shared.workerToken,method:"POST",body:{to_stage:"in_progress"}});
  assert.equal(movedByWorkflowCard.status,201,JSON.stringify(movedByWorkflowCard.payload));
  assert.equal(movedByWorkflowCard.payload.job.stage,"in_progress");
  assert.equal(movedByWorkflowCard.payload.job.scheduled_at,nextPhaseStart);
  assert.equal(movedByWorkflowCard.payload.job.current_phase.starts_at,nextPhaseStart);
  const calendarFrom=new Date(new Date(nextPhaseStart).getTime()-60*60*1000).toISOString();
  const calendarTo=new Date(new Date(nextPhaseStart).getTime()+4*60*60*1000).toISOString();
  const calendarSynced=await request("/api/calendar?from="+encodeURIComponent(calendarFrom)+"&to="+encodeURIComponent(calendarTo),{token});
  assert.equal(calendarSynced.status,200,JSON.stringify(calendarSynced.payload));
  assert.equal(calendarSynced.payload.jobs.find(job=>job.id===created.payload.id)?.scheduled_at,nextPhaseStart);

  const cancelled=await request("/api/jobs/"+created.payload.id+"/cancel",{token,method:"POST",body:{party:"klavierhaus",reason:"Timing status acceptance cleanup"}});
  assert.equal(cancelled.status,200,JSON.stringify(cancelled.payload));
  assert.equal(cancelled.payload.job.workflow_status,"cancelled");
});

test("Intake assessment PDF is exported and retained in Documents",async()=>{
  const token=shared.adminToken;
  const response=await fetch(origin+"/api/intake/"+shared.intakeId+"/export-pdf",{
    method:"POST",
    headers:{Authorization:"Bearer "+token,Accept:"application/pdf"}
  });
  assert.equal(response.status,200);
  assert.match(response.headers.get("content-type")||"",/application\/pdf/);
  const archiveId=Number(response.headers.get("x-archive-document-id"));
  assert.ok(Number.isSafeInteger(archiveId)&&archiveId>0);
  const buffer=Buffer.from(await response.arrayBuffer());
  assert.ok(buffer.length>500);
  assert.match(buffer.subarray(0,8).toString("latin1"),/^%PDF-1\.[0-9]$/);

  const documents=await request("/api/archive/documents?category=intake_assessment",{token});
  assert.equal(documents.status,200,JSON.stringify(documents.payload));
  const row=documents.payload.rows.find(item=>Number(item.id)===archiveId);
  assert.ok(row);
  assert.equal(row.category,"intake_assessment");
  assert.equal(row.entity_type,"intake");
  assert.equal(String(row.entity_id),String(shared.intakeId));
  assert.match(row.original_name,/intake-assessment-/);
  assert.equal(row.mime_type,"application/pdf");
  assert.equal(row.metadata.source,"intake_assessment_export");

  const fileResponse=await fetch(origin+"/api/archive/documents/"+archiveId+"/download",{headers:{Authorization:"Bearer "+token}});
  assert.equal(fileResponse.status,200);
  const archivedPdf=Buffer.from(await fileResponse.arrayBuffer());
  assert.match(archivedPdf.subarray(0,8).toString("latin1"),/^%PDF-1\.[0-9]$/);
});


test("Admin can delete and archive an Intake while retaining linked Master Data",async()=>{
  const token=shared.adminToken;
  const created=await request("/api/intake",{token,method:"POST",body:{
    client_id:shared.client.id,
    piano_id:shared.piano.id,
    raw_client_name:shared.client.name,
    raw_contact:shared.client.email,
    service_location:"workshop",
    reported_issue:"Temporary intake created to verify delete-and-archive lifecycle",
    estimated_urgency:"normal"
  }});
  assert.equal(created.status,201,JSON.stringify(created.payload));
  const intakeId=Number(created.payload.id);
  const clientBefore=appDb.prepare("SELECT id,name FROM clients WHERE id=?").get(shared.client.id);
  const pianoBefore=appDb.prepare("SELECT id,brand,model FROM pianos WHERE id=?").get(shared.piano.id);

  const deleted=await request("/api/intake/"+intakeId,{token,method:"DELETE",body:{reason:"Acceptance test archive"}});
  assert.equal(deleted.status,200,JSON.stringify(deleted.payload));
  assert.equal(deleted.payload.ok,true);
  assert.equal(Number(deleted.payload.deleted_intake_id),intakeId);
  assert.ok(deleted.payload.archive_document?.id);
  assert.equal(appDb.prepare("SELECT id FROM intake_leads WHERE id=?").get(intakeId),undefined);

  const clientAfter=appDb.prepare("SELECT id,name FROM clients WHERE id=?").get(shared.client.id);
  const pianoAfter=appDb.prepare("SELECT id,brand,model FROM pianos WHERE id=?").get(shared.piano.id);
  assert.deepEqual(clientAfter,clientBefore);
  assert.deepEqual(pianoAfter,pianoBefore);

  const archived=await request("/api/archive/documents/"+deleted.payload.archive_document.id,{token});
  assert.equal(archived.status,200,JSON.stringify(archived.payload));
  assert.equal(archived.payload.category,"deleted_intake");
  assert.equal(String(archived.payload.entity_id),String(intakeId));
  assert.equal(archived.payload.metadata.source,"deleted_intake");
  assert.equal(archived.payload.metadata.reason,"Acceptance test archive");
});


test("Private appointment requests require staff approval, preserve context and do not consume workshop capacity",async()=>{
  const token=shared.adminToken;
  appDb.prepare(`INSERT OR REPLACE INTO website_showroom_pianos(id,slug_en,slug_hu,brand,model,title_en,title_hu,image_url,availability_status,published)
    VALUES('WP-PRIVATE-1','private-steinway-b','private-steinway-b-hu','Steinway & Sons','B','Steinway B','Steinway B','/uploads/website/private-b.jpg','AVAILABLE',1)`).run();
  appDb.prepare(`INSERT OR REPLACE INTO website_services(id,slug_en,slug_hu,title_en,title_hu,image_url,visible)
    VALUES('WS-PRIVATE-1','private-tuning','private-hangolas','Concert Tuning','Koncerthangolás','/uploads/website/tuning.jpg',1)`).run();

  const job=await request("/api/jobs",{token,method:"POST",body:{
    client_id:shared.client.id,piano_id:shared.piano.id,title:"Capacity overlap proof",
    scheduled_at:"2035-08-20T14:00:00.000Z",estimated_duration_min:120,assigned_technician_id:"U-F-WORKER"
  }});
  assert.equal(job.status,201,JSON.stringify(job.payload));

  async function submitAndApprove(body){
    const submitted=await fetch(origin+"/api/public/private-appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    assert.equal(submitted.status,201);
    const payload=await submitted.json();
    assert.equal(payload.pending_approval,true);
    assert.equal(payload.request.status,"REQUESTED");
    assert.equal(appDb.prepare("SELECT COUNT(*) c FROM private_appointments WHERE conversation_id IS NULL AND name=?").get(body.name).c,0,"public request must not enter calendar before staff approval");
    const approved=await request("/api/private-appointment-requests/"+encodeURIComponent(payload.request.id)+"/approve",{token,method:"POST",body:{
      scheduled_at:body.scheduled_at,duration_min:body.duration_min||60,assigned_user_id:"U-F-MANAGER"
    }});
    assert.equal(approved.status,200,JSON.stringify(approved.payload));
    assert.equal(approved.payload.status,"APPROVED");
    assert.equal(approved.payload.appointment.status,"SCHEDULED");
    assert.equal(Number(approved.payload.appointment.duration_min),Number(body.duration_min||60));
    return {request:payload.request,appointment:approved.payload.appointment};
  }

  const piano=await submitAndApprove({
    name:"Private Piano Guest",email:"private-piano@example.com",phone:"+1 212 555 0101",scheduled_at:"2035-08-20T10:00",duration_min:60,
    note:"Please prepare the piano in the main showroom.",piano_id:"WP-PRIVATE-1",language:"en",source_path:"/pianos/private-steinway-b"
  });
  assert.equal(piano.request.appointment_type,"PIANO_VIEWING");
  assert.equal(piano.request.piano_id,"WP-PRIVATE-1");
  assert.equal(piano.appointment.piano_id,"WP-PRIVATE-1");
  assert.equal(piano.appointment.service_id,null);
  assert.equal(piano.appointment.note,"Please prepare the piano in the main showroom.");
  assert.equal(piano.appointment.scheduled_at,"2035-08-20T14:00:00.000Z");
  shared.privateAppointmentId=piano.appointment.id;

  const service=await submitAndApprove({
    name:"Private Service Guest",email:"private-service@example.com",phone:"+1 212 555 0102",scheduled_at:"2035-08-21T11:30",duration_min:90,
    note:"Discuss tuning before a recital.",service_id:"WS-PRIVATE-1",language:"en",source_path:"/services/private-tuning"
  });
  assert.equal(service.request.appointment_type,"SERVICE_CONSULTATION");
  assert.equal(service.appointment.service_id,"WS-PRIVATE-1");
  assert.equal(Number(service.appointment.duration_min),90);

  const generic=await submitAndApprove({
    name:"Private Visit Guest",email:"private-visit@example.com",phone:"+1 212 555 0103",scheduled_at:"2035-08-22T12:00",duration_min:120,
    note:"General private visit.",language:"en",source_path:"/"
  });
  assert.equal(generic.request.appointment_type,"PRIVATE_VISIT");
  assert.equal(Number(generic.appointment.duration_min),120);

  const list=await request("/api/private-appointments?status=SCHEDULED",{token});
  assert.equal(list.status,200,JSON.stringify(list.payload));
  assert.ok(list.payload.some(row=>row.id===piano.appointment.id&&row.piano_title_en==="Steinway B"));
  assert.ok(list.payload.some(row=>row.id===service.appointment.id&&row.service_title_en==="Concert Tuning"));

  const completed=await request("/api/private-appointments/"+encodeURIComponent(service.appointment.id),{token,method:"PUT",body:{
    status:"COMPLETED",assigned_user_id:"U-F-MANAGER"
  }});
  assert.equal(completed.status,200,JSON.stringify(completed.payload));
  assert.equal(completed.payload.status,"COMPLETED");
  assert.equal(completed.payload.assigned_user_id,"U-F-MANAGER");
});


test("Public consultation availability exposes only conflict-safe 15-minute slots and rejects duplicate requests",async()=>{
  const date="2035-08-24";
  const before=await request("/api/public/private-appointment-availability?date="+date);
  assert.equal(before.status,200,JSON.stringify(before.payload));
  assert.equal(before.payload.timezone,"America/New_York");
  assert.equal(Number(before.payload.duration_min),60);
  assert.equal(Number(before.payload.buffer_min),15);
  assert.equal(Number(before.payload.step_min),15);
  assert.ok(before.payload.slots.some(slot=>slot.wall_time===date+"T11:00"));

  const first=await request("/api/public/private-appointments",{method:"POST",body:{
    name:"Availability Guest One",email:"availability-one@example.com",phone:"+1 212 555 0191",
    scheduled_at:date+"T11:00",duration_min:60,language:"en",source_path:"/"
  }});
  assert.equal(first.status,201,JSON.stringify(first.payload));
  assert.equal(first.payload.pending_approval,true);

  const duplicate=await request("/api/public/private-appointments",{method:"POST",body:{
    name:"Availability Guest Two",email:"availability-two@example.com",phone:"+1 212 555 0192",
    scheduled_at:date+"T11:00",duration_min:60,language:"en",source_path:"/"
  }});
  assert.equal(duplicate.status,409,JSON.stringify(duplicate.payload));
  assert.equal(duplicate.payload.error,"PRIVATE_APPOINTMENT_REQUEST_HOLD_CONFLICT");

  const after=await request("/api/public/private-appointment-availability?date="+date);
  assert.equal(after.status,200,JSON.stringify(after.payload));
  const walls=new Set(after.payload.slots.map(slot=>slot.wall_time));
  for(const blocked of ["T10:00","T10:15","T10:30","T10:45","T11:00","T11:15","T11:30","T11:45","T12:00"])assert.equal(walls.has(date+blocked),false,blocked+" must respect the one-hour appointment plus 15-minute separation");
  assert.equal(walls.has(date+"T09:45"),true,"09:45-10:45 leaves a 15-minute gap before the 11:00 request");
  assert.equal(walls.has(date+"T12:15"),true,"12:15 is the first valid start after an 11:00-12:00 request");
});

test("VIP client status is durable, filterable data and can be switched both directions",async()=>{
  const token=shared.adminToken,id=shared.client.id;
  const before=await request("/api/clients/"+id,{token});
  assert.equal(before.status,404,"No standalone client GET is required; list remains the canonical master-data source");

  const vip=await request("/api/clients/"+id,{token,method:"PUT",body:{
    name:shared.client.name,email:shared.client.email||"",phone:shared.client.phone||"",address:shared.client.address||"",notes:shared.client.notes||"",is_vip:true
  }});
  assert.equal(vip.status,200,JSON.stringify(vip.payload));
  assert.equal(Number(vip.payload.is_vip),1);
  assert.equal(vip.payload.vip_updated_by_user_id,"U-F-ADMIN");
  assert.ok(vip.payload.vip_updated_at);

  const listed=await request("/api/clients",{token});
  assert.equal(listed.status,200);
  assert.equal(Number(listed.payload.find(row=>row.id===id).is_vip),1);

  const normal=await request("/api/clients/"+id,{token,method:"PUT",body:{...vip.payload,is_vip:false}});
  assert.equal(normal.status,200,JSON.stringify(normal.payload));
  assert.equal(Number(normal.payload.is_vip),0);
});

test("Unified notifications support 3-hour dismiss, permanent Done, sound preference and admin-only delivery",async()=>{
  const admin=shared.adminToken,manager=await login("manager.final@example.com"),worker=await login("tech.final@example.com");
  const payload=await request("/api/notifications",{token:manager});
  assert.equal(payload.status,200,JSON.stringify(payload.payload));
  const row=payload.payload.notifications.find(item=>item.entity_type==="PRIVATE_APPOINTMENT"&&item.entity_id===shared.privateAppointmentId);
  assert.ok(row,JSON.stringify(payload.payload.notifications));

  const snooze=await request("/api/notifications/"+encodeURIComponent(row.id)+"/snooze",{token:manager,method:"POST",body:{hours:3}});
  assert.equal(snooze.status,200,JSON.stringify(snooze.payload));
  assert.ok(new Date(snooze.payload.snoozed_until).getTime()>Date.now()+2.5*3600000);
  const hidden=await request("/api/notifications",{token:manager});
  assert.equal(hidden.payload.notifications.some(item=>item.id===row.id),false);

  appDb.prepare("UPDATE notification_recipients SET snoozed_until=datetime('now','-1 minute') WHERE notification_id=? AND user_id='U-F-MANAGER'").run(row.id);
  const returned=await request("/api/notifications",{token:manager});
  assert.equal(returned.payload.notifications.some(item=>item.id===row.id),true);

  const done=await request("/api/notifications/"+encodeURIComponent(row.id)+"/acknowledge",{token:manager,method:"POST",body:{}});
  assert.equal(done.status,200);
  appDb.prepare("UPDATE notification_recipients SET snoozed_until=datetime('now','-1 minute') WHERE notification_id=? AND user_id='U-F-MANAGER'").run(row.id);
  const gone=await request("/api/notifications",{token:manager});
  assert.equal(gone.payload.notifications.some(item=>item.id===row.id),false);

  const soundOff=await request("/api/notifications/preferences/sound",{token:worker,method:"PUT",body:{sound_enabled:false}});
  assert.equal(soundOff.status,200,JSON.stringify(soundOff.payload));
  assert.equal(Number(soundOff.payload.sound_enabled),0);
  const soundOn=await request("/api/notifications/preferences/sound",{token:worker,method:"PUT",body:{sound_enabled:true}});
  assert.equal(Number(soundOn.payload.sound_enabled),1);

  const forbidden=await request("/api/admin/users/U-F-WORKER/notification-delivery",{token:worker,method:"PUT",body:{notifications_enabled:false}});
  assert.equal(forbidden.status,403);
  const disabled=await request("/api/admin/users/U-F-WORKER/notification-delivery",{token:admin,method:"PUT",body:{notifications_enabled:false}});
  assert.equal(disabled.status,200,JSON.stringify(disabled.payload));
  assert.equal(Number(disabled.payload.notifications_enabled),0);
  const workerHidden=await request("/api/notifications",{token:worker});
  assert.equal(workerHidden.status,200);
  assert.deepEqual(workerHidden.payload.notifications,[]);
  const reenabled=await request("/api/admin/users/U-F-WORKER/notification-delivery",{token:admin,method:"PUT",body:{notifications_enabled:true}});
  assert.equal(Number(reenabled.payload.notifications_enabled),1);
});

test("Timed notification sweep deduplicates overdue private appointment alerts",async()=>{
  const admin=await login("manager.final@example.com"),id=shared.privateAppointmentId;
  appDb.prepare("UPDATE private_appointments SET scheduled_at=datetime('now','-10 minutes'),status='SCHEDULED',completed_at=NULL,cancelled_at=NULL WHERE id=?").run(id);
  const first=await request("/api/notifications",{token:admin});
  assert.equal(first.status,200);
  const due=first.payload.notifications.filter(item=>item.category==="APPOINTMENT_DUE"&&item.entity_id===id);
  assert.equal(due.length,1);
  const second=await request("/api/notifications",{token:admin});
  assert.equal(second.payload.notifications.filter(item=>item.category==="APPOINTMENT_DUE"&&item.entity_id===id).length,1);

  const future=new Date(Date.now()+24*3600000).toISOString();
  appDb.prepare("UPDATE private_appointments SET scheduled_at=? WHERE id=?").run(future,id);
  const after=await request("/api/notifications",{token:admin});
  assert.equal(after.payload.notifications.some(item=>item.category==="APPOINTMENT_DUE"&&item.entity_id===id),false);
});

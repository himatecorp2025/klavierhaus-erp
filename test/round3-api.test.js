"use strict";

const assert=require("node:assert/strict");
const bcrypt=require("bcryptjs");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const test=require("node:test");
const Database=require("better-sqlite3");

const root=path.resolve(__dirname,"..");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"kh-round3-api-"));
const dbPath=path.join(temp,"api.sqlite");
const env={
  ...process.env,
  DB_PATH:dbPath,
  BACKUP_DIR:path.join(temp,"backups"),
  UPLOAD_DIR:path.join(temp,"uploads"),
  JWT_SECRET:"round3-api-test-secret-abcdefghijklmnopqrstuvwxyz",
  STRIPE_SECRET_KEY:"",
  STRIPE_WEBHOOK_SECRET:"",
  WEBSITE_BASE_URL:"https://website.example.test",
  APP_BASE_URL:"https://erp.example.test",
  NODE_ENV:"test"
};
for(const [key,value] of Object.entries(env))if(value!==undefined)process.env[key]=String(value);

let server,origin,appDb;

async function request(url,{token,method="GET",body}={}){
  const headers={Accept:"application/json"};
  if(token)headers.Authorization="Bearer "+token;
  if(body!==undefined)headers["Content-Type"]="application/json";
  const response=await fetch(origin+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const type=response.headers.get("content-type")||"";
  const payload=type.includes("application/json")?await response.json().catch(()=>({})):await response.text();
  return {status:response.status,payload,headers:response.headers};
}
async function pdf(url,token){
  const response=await fetch(origin+url,{headers:{Accept:"application/pdf",Authorization:"Bearer "+token}});
  return {status:response.status,buffer:Buffer.from(await response.arrayBuffer()),headers:response.headers};
}
async function login(email,password="Round3Pass!"){
  const response=await request("/api/login",{method:"POST",body:{email,password}});
  assert.equal(response.status,200,JSON.stringify(response.payload));
  return response.payload.token;
}
function nyDate(){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const p=Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
  return p.year+"-"+p.month+"-"+p.day;
}

test.before(async()=>{
  const init=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env,encoding:"utf8"});
  assert.equal(init.status,0,init.stdout+"\n"+init.stderr);
  const seed=new Database(dbPath);
  const hash=bcrypt.hashSync("Round3Pass!",4);
  const insert=seed.prepare("INSERT INTO users(id,name,email,contact_email,password_hash,role,status,hidden_user,is_superadmin,session_version,calendar_color) VALUES(?,?,?,?,?,?,'Active',?,?,0,?)");
  insert.run("U-R3-ADMIN","Round Three Admin","admin3@example.com","admin3@example.com",hash,"ADMIN",0,0,"#1f5eff");
  insert.run("U-R3-MANAGER","Round Three Manager","manager3@example.com","manager3@example.com",hash,"MANAGER",0,0,"#6655aa");
  insert.run("U-R3-WORKER","Round Three Tech","tech3@example.com","tech3@example.com",hash,"WORKER",0,0,"#0f8b6d");
  insert.run("U-R3-SUPER","Round Three Owner","owner3@example.com","owner3@example.com",hash,"ADMIN",1,1,"#111111");
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

let shared={};

test("job closeout is idempotent and dispatches one receivable invoice",async()=>{
  const token=await login("admin3@example.com");
  const client=await request("/api/clients",{token,method:"POST",body:{name:"Round Three Client",email:"client3@example.com",phone:"212-555-3300",address:"New York, NY"}});
  assert.equal(client.status,201,JSON.stringify(client.payload));
  const piano=await request("/api/clients/"+client.payload.id+"/pianos",{token,method:"POST",body:{brand:"Steinway & Sons",model:"B-211",serial_number:"R3-001"}});
  assert.equal(piano.status,201,JSON.stringify(piano.payload));
  const job=await request("/api/jobs",{token,method:"POST",body:{client_id:client.payload.id,piano_id:piano.payload.id,title:"Round 3 regulation",assigned_technician_id:"U-R3-WORKER"}});
  assert.equal(job.status,201,JSON.stringify(job.payload));
  const scheduled=await request("/api/jobs/"+job.payload.id+"/schedule",{token,method:"PATCH",body:{assigned_technician_id:"U-R3-WORKER",scheduled_start:"2031-05-10T14:00:00.000Z",scheduled_end:"2031-05-10T16:00:00.000Z"}});
  assert.equal(scheduled.status,200,JSON.stringify(scheduled.payload));
  const progress=await request("/api/jobs/"+job.payload.id+"/status",{token,method:"PATCH",body:{status:"in_progress"}});
  assert.equal(progress.status,200);
  const ready=await request("/api/jobs/"+job.payload.id+"/status",{token,method:"PATCH",body:{status:"ready_for_closeout"}});
  assert.equal(ready.status,200);

  const closeout=await request("/api/jobs/"+job.payload.id+"/closeout",{token,method:"POST",body:{
    summary:"Concert regulation closeout",tax_rate:8.875,due_date:nyDate(),
    items:[{item_description:"Regulation labor",quantity:2,unit_price:250},{item_description:"Action materials",quantity:1,unit_price:80}]
  }});
  assert.equal(closeout.status,201,JSON.stringify(closeout.payload));
  assert.equal(closeout.payload.idempotent,false);
  assert.match(closeout.payload.invoice.invoice_number,/^INV-\d{4}-\d{4}$/);
  assert.equal(closeout.payload.invoice.direction,"receivable");
  assert.equal(closeout.payload.invoice.job_id,job.payload.id);
  assert.ok(closeout.payload.job.closed_at);
  assert.equal(closeout.payload.invoice.subtotal,580);
  assert.equal(closeout.payload.invoice.tax_amount,51.48);
  assert.equal(closeout.payload.invoice.total_amount,631.48);

  const again=await request("/api/jobs/"+job.payload.id+"/closeout",{token,method:"POST",body:{items:[{item_description:"ignored",quantity:1,unit_price:1}]}});
  assert.equal(again.status,200,JSON.stringify(again.payload));
  assert.equal(again.payload.idempotent,true);
  assert.equal(again.payload.invoice.id,closeout.payload.invoice.id);

  const board=await request("/api/workshop",{token});
  assert.equal(board.status,200);
  assert.equal(board.payload.jobs.some(row=>row.id===job.payload.id),false);
  const jobHistory=await request("/api/jobs/"+job.payload.id,{token});
  assert.equal(jobHistory.status,200);
  assert.ok(jobHistory.payload.closed_at);

  const invoicePdf=await pdf("/api/invoices/"+closeout.payload.invoice.id+"/pdf",token);
  assert.equal(invoicePdf.status,200);
  assert.equal(invoicePdf.buffer.subarray(0,5).toString(),"%PDF-");

  shared={token,client:client.payload,piano:piano.payload,job:job.payload,invoice:closeout.payload.invoice};
});

test("partial and full payments update AR and monthly realized revenue",async()=>{
  const token=shared.token||await login("admin3@example.com");
  const first=await request("/api/invoices/"+shared.invoice.id+"/payments",{token,method:"POST",body:{amount:200,payment_method:"Zelle",paid_at:nyDate(),reference:"R3-P1"}});
  assert.equal(first.status,201,JSON.stringify(first.payload));
  assert.equal(first.payload.status,"partial");
  assert.equal(first.payload.paid_amount,200);
  assert.equal(first.payload.balance_due,431.48);

  const second=await request("/api/invoices/"+shared.invoice.id+"/payments",{token,method:"POST",body:{amount:431.48,payment_method:"Bank Transfer / ACH",paid_at:nyDate(),reference:"R3-P2"}});
  assert.equal(second.status,201,JSON.stringify(second.payload));
  assert.equal(second.payload.status,"paid");
  assert.equal(second.payload.balance_due,0);

  const stats=await request("/api/finance/summary?month="+nyDate().slice(0,7),{token});
  assert.equal(stats.status,200,JSON.stringify(stats.payload));
  assert.equal(stats.payload.kpis.accounts_receivable,0);
  assert.equal(stats.payload.kpis.realized_revenue,631.48);
  assert.equal(stats.payload.payment_breakdown.length>=2,true);
});

test("vendor partner, payable invoice and paid cost flow work end-to-end",async()=>{
  const token=shared.token||await login("admin3@example.com");
  const partner=await request("/api/partners",{token,method:"POST",body:{company_name:"Round Three Vendor",contact_name:"Vendor Contact",email:"vendor@example.com",tax_id:"VENDOR-TAX-3",contractor_user_ids:["U-R3-WORKER"]}});
  assert.equal(partner.status,201,JSON.stringify(partner.payload));

  const detail=await request("/api/partners/"+partner.payload.id,{token});
  assert.equal(detail.status,200);
  assert.deepEqual(detail.payload.contractor_user_ids,["U-R3-WORKER"]);

  const update=await request("/api/partners/"+partner.payload.id,{token,method:"PUT",body:{notes:"Preferred vendor",contractor_user_ids:["U-R3-WORKER"]}});
  assert.equal(update.status,200);

  const bill=await request("/api/invoices",{token,method:"POST",body:{
    direction:"payable",partner_id:partner.payload.id,summary:"Action parts",issue_date:nyDate(),due_date:nyDate(),
    items:[{item_description:"Replacement action parts",quantity:1,unit_price:120}],tax_rate:0
  }});
  assert.equal(bill.status,201,JSON.stringify(bill.payload));
  assert.match(bill.payload.invoice_number,/^VND-\d{4}-\d{4}$/);
  assert.equal(bill.payload.total_amount,120);

  const blockedDelete=await request("/api/partners/"+partner.payload.id,{token,method:"DELETE"});
  assert.equal(blockedDelete.status,409);
  assert.equal(blockedDelete.payload.error,"PARTNER_HAS_INVOICES");

  const paid=await request("/api/invoices/"+bill.payload.id+"/payments",{token,method:"POST",body:{amount:120,payment_method:"Check",paid_at:nyDate(),reference:"CHK-300"}});
  assert.equal(paid.status,201,JSON.stringify(paid.payload));
  assert.equal(paid.payload.status,"paid");

  const stats=await request("/api/finance/summary?month="+nyDate().slice(0,7),{token});
  assert.equal(stats.status,200);
  assert.equal(stats.payload.kpis.accounts_payable,0);
  assert.equal(stats.payload.kpis.paid_costs,120);
  assert.equal(stats.payload.kpis.net_cash_result,511.48);

  const ledger=await request("/api/finance/ledger?month="+nyDate().slice(0,7),{token});
  assert.equal(ledger.status,200);
  assert.ok(ledger.payload.entries.some(row=>row.account==="Accounts Payable"));
  assert.ok(ledger.payload.entries.some(row=>row.account==="Cash Payment"));

  const report=await pdf("/api/finance/monthly-report.pdf?month="+nyDate().slice(0,7),token);
  assert.equal(report.status,200);
  assert.equal(report.buffer.subarray(0,5).toString(),"%PDF-");

  shared.partner=partner.payload;shared.bill=bill.payload;
});

test("Admin void reopens a closed job, while hard delete is Super Admin only",async()=>{
  const token=shared.token||await login("admin3@example.com");
  const job=await request("/api/jobs",{token,method:"POST",body:{client_id:shared.client.id,piano_id:shared.piano.id,title:"Void closeout test",assigned_technician_id:"U-R3-WORKER"}});
  assert.equal(job.status,201);
  await request("/api/jobs/"+job.payload.id+"/schedule",{token,method:"PATCH",body:{assigned_technician_id:"U-R3-WORKER",scheduled_start:"2031-05-12T14:00:00.000Z",scheduled_end:"2031-05-12T15:00:00.000Z"}});
  await request("/api/jobs/"+job.payload.id+"/status",{token,method:"PATCH",body:{status:"in_progress"}});
  await request("/api/jobs/"+job.payload.id+"/status",{token,method:"PATCH",body:{status:"ready_for_closeout"}});
  const closeout=await request("/api/jobs/"+job.payload.id+"/closeout",{token,method:"POST",body:{items:[{item_description:"Diagnostic",quantity:1,unit_price:50}],due_date:nyDate()}});
  assert.equal(closeout.status,201);

  const voided=await request("/api/invoices/"+closeout.payload.invoice.id+"/void",{token,method:"POST",body:{reason:"Customer scope changed"}});
  assert.equal(voided.status,200,JSON.stringify(voided.payload));
  assert.equal(voided.payload.invoice.status,"void");
  assert.equal(voided.payload.invoice.job_id,null);
  const reopened=await request("/api/jobs/"+job.payload.id,{token});
  assert.equal(reopened.status,200);
  assert.equal(reopened.payload.closed_at,null);
  assert.equal(reopened.payload.status,"ready_for_closeout");

  const denied=await request("/api/invoices/"+closeout.payload.invoice.id,{token,method:"DELETE"});
  assert.equal(denied.status,403);
  assert.equal(denied.payload.error,"SUPERADMIN_REQUIRED");

  const superToken=await login("owner3@example.com");
  const deleted=await request("/api/invoices/"+closeout.payload.invoice.id,{token:superToken,method:"DELETE"});
  assert.equal(deleted.status,200,JSON.stringify(deleted.payload));
  const missing=await request("/api/invoices/"+closeout.payload.invoice.id,{token:superToken});
  assert.equal(missing.status,404);
});

test("finance settings, sequence continuation and deletable unused partner work",async()=>{
  const token=shared.token||await login("admin3@example.com");
  const settings=await request("/api/finance/settings",{token,method:"PUT",body:{
    trade_name:"Klavierhaus",legal_name:"Klavierhaus LLC",address_line1:"New York",city:"New York",state:"NY",postal_code:"10001",tax_id:"R3-EIN",email:"billing@example.com",phone:"212-555-0000"
  }});
  assert.equal(settings.status,200,JSON.stringify(settings.payload));
  assert.equal(settings.payload.legal_name,"Klavierhaus LLC");

  const another=await request("/api/invoices",{token,method:"POST",body:{
    direction:"receivable",client_id:shared.client.id,summary:"Manual service invoice",issue_date:nyDate(),due_date:nyDate(),
    items:[{item_description:"Consultation",quantity:1,unit_price:25}]
  }});
  assert.equal(another.status,201,JSON.stringify(another.payload));
  assert.match(another.payload.invoice_number,/^INV-\d{4}-\d{4}$/);
  assert.notEqual(another.payload.invoice_number,shared.invoice.invoice_number);

  const unused=await request("/api/partners",{token,method:"POST",body:{company_name:"Unused Round Three Vendor"}});
  assert.equal(unused.status,201);
  const removed=await request("/api/partners/"+unused.payload.id,{token,method:"DELETE"});
  assert.equal(removed.status,200);

  const publicBranding=await request("/api/public/branding");
  assert.equal(publicBranding.status,200);
});

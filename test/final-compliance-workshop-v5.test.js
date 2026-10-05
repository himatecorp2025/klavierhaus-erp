"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const Database=require("better-sqlite3");
const bcrypt=require("bcryptjs");

const root=path.resolve(__dirname,"..");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"kh-workshop-v5-"));
const dbPath=path.join(temp,"workshop-v5.sqlite");
const backupDir=path.join(temp,"backups");
const env={
  ...process.env,
  PORT:"0",
  DB_PATH:dbPath,
  BACKUP_DIR:backupDir,
  UPLOAD_DIR:path.join(temp,"uploads"),
  JWT_SECRET:"workshop-v5-test-secret-abcdefghijklmnopqrstuvwxyz",
  RESEND_API_KEY:"",
  EMAIL_FROM:"Klavierhaus <test@example.com>",
  APP_BASE_URL:"https://erp.example.test",
  NODE_ENV:"test"
};
for(const [key,value] of Object.entries(env))process.env[key]=String(value);

let server,origin,db;
async function request(url,{token,method="GET",body}={}){
  const headers={Accept:"application/json"};if(token)headers.Authorization="Bearer "+token;
  if(body!==undefined)headers["Content-Type"]="application/json";
  const response=await fetch(origin+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const payload=await response.json().catch(()=>({}));
  return {status:response.status,payload};
}
async function login(email){
  const result=await request("/api/login",{method:"POST",body:{email,password:"WorkshopV5!"}});
  assert.equal(result.status,200,JSON.stringify(result.payload));return result.payload.token;
}
function futureIso(day,hour=14,minute=0){return new Date(Date.UTC(2036,5,10+day,hour,minute,0)).toISOString();}

test.before(async()=>{
  const init=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env,encoding:"utf8"});
  assert.equal(init.status,0,init.stdout+"\n"+init.stderr);
  const seed=new Database(dbPath),hash=bcrypt.hashSync("WorkshopV5!",4);
  const insertUser=seed.prepare("INSERT INTO users(id,name,email,contact_email,password_hash,role,status,hidden_user,is_superadmin,session_version,calendar_color) VALUES(?,?,?,?,?,?,'Active',0,0,0,?)");
  insertUser.run("WV5-A","Workshop Admin","admin.v5@example.com","admin.v5@example.com",hash,"ADMIN","#b8914a");
  insertUser.run("WV5-T","Workshop Technician","tech.v5@example.com","tech.v5@example.com",hash,"WORKER","#315f9d");
  const c=seed.prepare("INSERT INTO clients(name,email,address) VALUES(?,?,?)").run("V5 Client","client.v5@example.com","100 Park Ave, New York, NY");
  const clientId=Number(c.lastInsertRowid);
  const p=seed.prepare("INSERT INTO pianos(client_id,brand,model,serial_number,location_notes) VALUES(?,?,?,?,?)").run(clientId,"Steinway & Sons","B","WV5-001","Client home");
  seed.close();
  process.env.DB_PATH=dbPath;
  const mod=require("../server/index.js");db=mod.db;
  server=mod.app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  origin="http://127.0.0.1:"+server.address().port;
  globalThis.clientId=clientId;globalThis.pianoId=Number(p.lastInsertRowid);
});
test.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));try{db?.close();}catch(_error){}fs.rmSync(temp,{recursive:true,force:true});});

test("v5 migration installs configurable workflow schema and default bilingual labels",()=>{
  const stages=db.prepare("SELECT stage_key,position,label_en,label_hu FROM workflow_stage_definitions ORDER BY position").all();
  assert.deepEqual(stages.map(row=>row.stage_key),["received","in_progress","qa_review","admin_approval","completed"]);
  assert.equal(stages.at(-1).label_hu,"Lezárva");
  assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='workshop_ux_schema_version'").get().setting_value,"5");
});

test("job-specific workflow skips disabled intermediates but keeps Admin Approval and Completed mandatory",async()=>{
  const admin=await login("admin.v5@example.com");
  const created=await request("/api/jobs",{token:admin,method:"POST",body:{
    client_id:globalThis.clientId,piano_id:globalThis.pianoId,title:"Selective workflow",
    scheduled_at:futureIso(0,14),estimated_duration_min:120,assigned_technician_id:"WV5-T",
    workflow_phases:[
      {stage_key:"received",enabled:true,due_at:futureIso(0,17)},
      {stage_key:"in_progress",enabled:false},
      {stage_key:"qa_review",enabled:true,due_at:futureIso(1,16)},
      {stage_key:"admin_approval",enabled:false},
      {stage_key:"completed",enabled:false}
    ]
  }});
  assert.equal(created.status,201,JSON.stringify(created.payload));
  assert.equal(created.payload.stage,"received");
  assert.equal(created.payload.workflow_phases.find(row=>row.stage_key==="admin_approval").enabled,true);
  assert.equal(created.payload.workflow_phases.find(row=>row.stage_key==="completed").enabled,true);
  assert.equal(created.payload.next_stage,"qa_review");
  globalThis.jobId=created.payload.id;globalThis.admin=admin;

  const worker=await login("tech.v5@example.com");globalThis.worker=worker;
  const handoff=await request("/api/jobs/"+globalThis.jobId+"/handoff",{token:worker,method:"POST",body:{phase_note:"Skip disabled phase"}});
  assert.equal(handoff.status,201,JSON.stringify(handoff.payload));
  assert.equal(handoff.payload.job.stage,"qa_review");
  assert.equal(handoff.payload.job.next_stage,"admin_approval");
  assert.equal(handoff.payload.job.ready_for_closeout,false);
});

test("calendar reschedule updates the same workflow job record",async()=>{
  const moved=futureIso(3,15,15);
  const result=await request("/api/jobs/"+globalThis.jobId+"/schedule",{token:globalThis.admin,method:"PATCH",body:{
    scheduled_at:moved,estimated_duration_min:165,assigned_technician_id:"WV5-T"
  }});
  assert.equal(result.status,200,JSON.stringify(result.payload));
  assert.equal(result.payload.scheduled_at,moved);
  assert.equal(result.payload.estimated_duration_min,165);

  const workflow=await request("/api/jobs/workflow",{token:globalThis.admin});
  const same=workflow.payload.jobs.find(row=>row.id===globalThis.jobId);
  assert.ok(same);
  assert.equal(same.scheduled_at,moved);
  assert.equal(same.estimated_duration_min,165);

  const calendar=await request("/api/calendar?from="+encodeURIComponent(futureIso(3,0))+"&to="+encodeURIComponent(futureIso(4,0)),{token:globalThis.admin});
  assert.ok(calendar.payload.jobs.some(row=>row.id===globalThis.jobId));
});

test("phase deadline/blocker drives overdue workshop overview drilldown",async()=>{
  const pastDate=new Date(Date.now()-3600000);pastDate.setUTCMinutes(Math.floor(pastDate.getUTCMinutes()/15)*15,0,0);const past=pastDate.toISOString();
  const update=await request("/api/jobs/"+globalThis.jobId+"/workflow-phases/qa_review",{token:globalThis.admin,method:"PATCH",body:{
    due_at:past,blocker_code:"material_procurement",blocker_note:"Awaiting action parts"
  }});
  assert.equal(update.status,200,JSON.stringify(update.payload));
  assert.equal(update.payload.current_phase.blocker_code,"material_procurement");

  const overview=await request("/api/workshop/overview",{token:globalThis.admin});
  assert.equal(overview.status,200);
  assert.ok(overview.payload.kpis.active_workflows>=1);
  assert.ok(overview.payload.kpis.overdue_workflows>=1);
  const overdue=overview.payload.details.overdue_workflows.find(row=>row.id===globalThis.jobId);
  assert.ok(overdue);
  assert.equal(overdue.current_phase.blocker_code,"material_procurement");
  assert.equal(typeof overview.payload.kpis.active_financial_total,"number");
});

test("admins can rename English/Hungarian workflow labels without changing stage keys",async()=>{
  const before=await request("/api/workflow/settings",{token:globalThis.admin});
  const stages=before.payload.stages.map(row=>({...row,label_en:row.key==="qa_review"?"Quality Review":row.label_en,label_hu:row.key==="qa_review"?"Minőségi ellenőrzés":row.label_hu}));
  const saved=await request("/api/workflow/settings",{token:globalThis.admin,method:"PUT",body:{stages}});
  assert.equal(saved.status,200,JSON.stringify(saved.payload));
  const qa=saved.payload.stages.find(row=>row.key==="qa_review");
  assert.equal(qa.label_en,"Quality Review");
  assert.equal(qa.label_hu,"Minőségi ellenőrzés");
  const workflow=await request("/api/jobs/workflow",{token:globalThis.admin});
  assert.equal(workflow.payload.stages.find(row=>row.key==="qa_review").label_hu,"Minőségi ellenőrzés");
});

test("Admin Approval is the mandatory final active phase before Completed closeout",async()=>{
  const approval=await request("/api/jobs/"+globalThis.jobId+"/handoff",{token:globalThis.worker,method:"POST",body:{phase_note:"QA complete; ready for Admin Approval"}});
  assert.equal(approval.status,201,JSON.stringify(approval.payload));
  assert.equal(approval.payload.job.stage,"admin_approval");
  assert.equal(approval.payload.job.next_stage,"completed");
  assert.equal(approval.payload.job.ready_for_closeout,true);
  const completed=await request("/api/jobs/"+globalThis.jobId+"/complete",{token:globalThis.admin,method:"POST",body:{invoice_mode:"draft",email_language:"en"}});
  assert.equal(completed.status,201,JSON.stringify(completed.payload));
  assert.equal(completed.payload.job.stage,"completed");
  assert.equal(completed.payload.job.completed_by_name,"Workshop Admin");
  assert.equal(completed.payload.invoice.status,"draft");
  const phases=db.prepare("SELECT stage_key,completed_at FROM job_workflow_phases WHERE job_id=? ORDER BY position").all(globalThis.jobId);
  assert.ok(phases.find(row=>row.stage_key==="qa_review").completed_at);
  assert.ok(phases.find(row=>row.stage_key==="completed").completed_at);
});

test("an active workflow can add a future phase before it is reached",async()=>{
  const created=await request("/api/jobs",{token:globalThis.admin,method:"POST",body:{
    client_id:globalThis.clientId,piano_id:globalThis.pianoId,title:"Dynamic phase insertion",
    workflow_phases:[
      {stage_key:"received",enabled:true},{stage_key:"in_progress",enabled:false},{stage_key:"qa_review",enabled:false},{stage_key:"admin_approval",enabled:false},{stage_key:"completed",enabled:true}
    ]
  }});
  assert.equal(created.status,201);
  const updated=await request("/api/jobs/"+created.payload.id+"/workflow-phases",{token:globalThis.admin,method:"PUT",body:{phases:[
    {stage_key:"received",enabled:true},{stage_key:"in_progress",enabled:false},{stage_key:"qa_review",enabled:true,due_at:futureIso(8,16)},{stage_key:"admin_approval",enabled:false},{stage_key:"completed",enabled:false}
  ]}});
  assert.equal(updated.status,200,JSON.stringify(updated.payload));
  assert.equal(updated.payload.workflow_phases.find(row=>row.stage_key==="qa_review").enabled,true);
  assert.equal(updated.payload.workflow_phases.find(row=>row.stage_key==="completed").enabled,true);
});

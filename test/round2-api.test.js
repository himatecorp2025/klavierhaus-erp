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
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"kh-round2-api-"));
const dbPath=path.join(temp,"api.sqlite");
const env={
  ...process.env,
  DB_PATH:dbPath,
  BACKUP_DIR:path.join(temp,"backups"),
  UPLOAD_DIR:path.join(temp,"uploads"),
  JWT_SECRET:"round2-api-test-secret-abcdefghijklmnopqrstuvwxyz",
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
  if(token)headers.Authorization=`Bearer ${token}`;
  if(body!==undefined)headers["Content-Type"]="application/json";
  const response=await fetch(origin+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const payload=await response.json().catch(()=>({}));
  return {status:response.status,payload};
}
async function login(){
  const response=await request("/api/login",{method:"POST",body:{email:"admin2@example.com",password:"Round2Pass!"}});
  assert.equal(response.status,200,JSON.stringify(response.payload));
  return response.payload.token;
}

test.before(async()=>{
  const init=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env,encoding:"utf8"});
  assert.equal(init.status,0,`${init.stdout}\n${init.stderr}`);
  const seed=new Database(dbPath);
  const hash=bcrypt.hashSync("Round2Pass!",4);
  seed.prepare("INSERT INTO users(id,name,email,contact_email,password_hash,role,status,hidden_user,is_superadmin,session_version,calendar_color) VALUES(?,?,?,?,?,'ADMIN','Active',0,0,0,'#1f5eff')")
    .run("U-ADMIN2","Round Two Admin","admin2@example.com","admin2@example.com",hash);
  seed.prepare("INSERT INTO users(id,name,email,contact_email,password_hash,role,status,hidden_user,is_superadmin,session_version,calendar_color) VALUES(?,?,?,?,?,'WORKER','Active',0,0,0,'#0f8b6d')")
    .run("U-TECH-A","Tech A","techa@example.com","techa@example.com",hash);
  seed.prepare("INSERT INTO users(id,name,email,contact_email,password_hash,role,status,hidden_user,is_superadmin,session_version,calendar_color) VALUES(?,?,?,?,?,'WORKER','Active',0,0,0,'#a35d00')")
    .run("U-TECH-B","Tech B","techb@example.com","techb@example.com",hash);
  seed.close();
  const mod=require("../server/index.js");appDb=mod.db;
  server=mod.app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
});
test.after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  try{appDb?.close();}catch(_error){}
  fs.rmSync(temp,{recursive:true,force:true});
});

test("one jobs record drives Planned Jobs, Workshop and Calendar",async()=>{
  const token=await login();
  const client=await request("/api/clients",{token,method:"POST",body:{name:"Round Two Client",email:"round2@example.com",address:"57th Street, New York"}});
  assert.equal(client.status,201,JSON.stringify(client.payload));
  const piano=await request(`/api/clients/${client.payload.id}/pianos`,{token,method:"POST",body:{brand:"Steinway & Sons",model:"D-274",serial_number:"R2-001"}});
  assert.equal(piano.status,201,JSON.stringify(piano.payload));

  const created=await request("/api/jobs",{token,method:"POST",body:{
    client_id:client.payload.id,piano_id:piano.payload.id,title:"Concert grand regulation",
    description:"Full regulation before performance",priority:"urgent",assigned_technician_id:"U-TECH-A"
  }});
  assert.equal(created.status,201,JSON.stringify(created.payload));
  assert.equal(created.payload.status,"planned");
  assert.match(created.payload.job_code,/^KH-\d{4}-\d{5}$/);

  const planned=await request("/api/planned-jobs",{token});
  assert.equal(planned.status,200);
  assert.ok(planned.payload.some(job=>job.id===created.payload.id));

  const scheduled=await request(`/api/jobs/${created.payload.id}/schedule`,{token,method:"PATCH",body:{
    assigned_technician_id:"U-TECH-A",scheduled_start:"2030-04-10T14:00:00.000Z",scheduled_end:"2030-04-10T16:00:00.000Z"
  }});
  assert.equal(scheduled.status,200,JSON.stringify(scheduled.payload));
  assert.equal(scheduled.payload.status,"scheduled");

  const workshop=await request("/api/workshop",{token});
  assert.equal(workshop.status,200);
  assert.deepEqual(workshop.payload.stages.map(stage=>stage.key),["planned","scheduled","in_progress","blocked","ready_for_closeout"]);
  assert.equal(workshop.payload.columns.length,5);
  assert.ok(workshop.payload.jobs.some(job=>job.id===created.payload.id));

  const calendar=await request("/api/calendar?from=2030-04-10T00:00:00.000Z&to=2030-04-11T00:00:00.000Z",{token});
  assert.equal(calendar.status,200);
  assert.ok(calendar.payload.jobs.some(job=>job.id===created.payload.id));

  const progress=await request(`/api/jobs/${created.payload.id}/status`,{token,method:"PATCH",body:{status:"in_progress"}});
  assert.equal(progress.status,200,JSON.stringify(progress.payload));
  const blocked=await request(`/api/jobs/${created.payload.id}/status`,{token,method:"PATCH",body:{status:"blocked",blocked_reason:"Waiting for action parts"}});
  assert.equal(blocked.status,200,JSON.stringify(blocked.payload));
  assert.equal(blocked.payload.blocked_reason,"Waiting for action parts");
  const ready=await request(`/api/jobs/${created.payload.id}/status`,{token,method:"PATCH",body:{status:"ready_for_closeout"}});
  assert.equal(ready.status,200,JSON.stringify(ready.payload));
  assert.ok(ready.payload.ready_for_closeout_at);
});

test("technician overlap is rejected without creating duplicate calendar state",async()=>{
  const token=await login();
  const clients=await request("/api/clients?q=Round%20Two",{token});
  const client=clients.payload[0];
  const pianos=await request(`/api/clients/${client.id}/pianos`,{token});
  const second=await request("/api/jobs",{token,method:"POST",body:{
    client_id:client.id,piano_id:pianos.payload[0].id,title:"Second scheduled job",assigned_technician_id:"U-TECH-A"
  }});
  assert.equal(second.status,201,JSON.stringify(second.payload));
  const conflict=await request(`/api/jobs/${second.payload.id}/schedule`,{token,method:"PATCH",body:{
    assigned_technician_id:"U-TECH-A",scheduled_start:"2030-04-10T15:00:00.000Z",scheduled_end:"2030-04-10T17:00:00.000Z"
  }});
  assert.equal(conflict.status,409,JSON.stringify(conflict.payload));
  assert.equal(conflict.payload.error,"SCHEDULE_CONFLICT");
  assert.ok(conflict.payload.conflict?.id);
  const okay=await request(`/api/jobs/${second.payload.id}/schedule`,{token,method:"PATCH",body:{
    assigned_technician_id:"U-TECH-B",scheduled_start:"2030-04-10T15:00:00.000Z",scheduled_end:"2030-04-10T17:00:00.000Z"
  }});
  assert.equal(okay.status,200,JSON.stringify(okay.payload));
});

test("converted intake creates exactly one planned job",async()=>{
  const token=await login();
  const intake=await request("/api/intake",{token,method:"POST",body:{
    raw_client_name:"Pipeline Lead",raw_contact:"lead@example.com",reported_issue:"Voicing requested",service_location:"workshop",estimated_urgency:"normal"
  }});
  assert.equal(intake.status,201);
  const converted=await request(`/api/intake/${intake.payload.id}/convert`,{token,method:"POST",body:{
    client:{name:"Pipeline Lead",email:"lead@example.com"},piano:{brand:"Yamaha",model:"CFX"}
  }});
  assert.equal(converted.status,200,JSON.stringify(converted.payload));
  const first=await request(`/api/intake/${intake.payload.id}/create-job`,{token,method:"POST",body:{title:"CFX voicing"}});
  assert.equal(first.status,201,JSON.stringify(first.payload));
  assert.equal(first.payload.job.status,"planned");
  const second=await request(`/api/intake/${intake.payload.id}/create-job`,{token,method:"POST",body:{}});
  assert.equal(second.status,200,JSON.stringify(second.payload));
  assert.equal(second.payload.idempotent,true);
  assert.equal(second.payload.job.id,first.payload.job.id);
});

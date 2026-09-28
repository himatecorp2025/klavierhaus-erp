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
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"kh-round1-api-"));
const dbPath=path.join(temp,"api.sqlite");
const env={
  ...process.env,
  DB_PATH:dbPath,
  BACKUP_DIR:path.join(temp,"backups"),
  UPLOAD_DIR:path.join(temp,"uploads"),
  JWT_SECRET:"round1-api-test-secret-abcdefghijklmnopqrstuvwxyz",
  STRIPE_SECRET_KEY:"",
  STRIPE_WEBHOOK_SECRET:"",
  WEBSITE_BASE_URL:"https://website.example.test",
  APP_BASE_URL:"https://erp.example.test",
  NODE_ENV:"test"
};
process.env.DB_PATH=env.DB_PATH;
process.env.BACKUP_DIR=env.BACKUP_DIR;
process.env.UPLOAD_DIR=env.UPLOAD_DIR;
process.env.JWT_SECRET=env.JWT_SECRET;
process.env.STRIPE_SECRET_KEY="";
process.env.STRIPE_WEBHOOK_SECRET="";
process.env.WEBSITE_BASE_URL=env.WEBSITE_BASE_URL;
process.env.APP_BASE_URL=env.APP_BASE_URL;
process.env.NODE_ENV="test";

let server,origin,appDb;

async function request(url,{token,method="GET",body}={}){
  const headers={Accept:"application/json"};
  if(token)headers.Authorization=`Bearer ${token}`;
  if(body!==undefined)headers["Content-Type"]="application/json";
  const response=await fetch(origin+url,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const payload=await response.json().catch(()=>({}));
  return {status:response.status,payload};
}

test.before(async()=>{
  const init=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env,encoding:"utf8"});
  assert.equal(init.status,0,`${init.stdout}\n${init.stderr}`);
  const seed=new Database(dbPath);
  const hash=bcrypt.hashSync("Round1Pass!",4);
  seed.prepare("INSERT INTO users(id,name,email,contact_email,password_hash,role,status,hidden_user,is_superadmin,session_version) VALUES(?,?,?,?,?,'ADMIN','Active',0,0,0)")
    .run("U-ADMIN","Round One Admin","admin@example.com","admin@example.com",hash);
  seed.prepare("INSERT INTO users(id,name,email,contact_email,password_hash,role,status,hidden_user,is_superadmin,session_version) VALUES(?,?,?,?,?,'WORKER','Active',0,0,0)")
    .run("U-TECH","Technician One","tech@example.com","tech@example.com",hash);
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

test("auth + clients + pianos + intake conversion work end-to-end",async()=>{
  const login=await request("/api/login",{method:"POST",body:{email:"admin@example.com",password:"Round1Pass!"}});
  assert.equal(login.status,200,JSON.stringify(login.payload));
  const token=login.payload.token;assert.ok(token);

  const client=await request("/api/clients",{token,method:"POST",body:{name:"Alice Client",email:"alice@example.com",phone:"212-555-1111",address:"Manhattan"}});
  assert.equal(client.status,201,JSON.stringify(client.payload));
  assert.equal(client.payload.name,"Alice Client");

  const piano=await request(`/api/clients/${client.payload.id}/pianos`,{token,method:"POST",body:{brand:"Steinway & Sons",model:"B-211",serial_number:"R1-001"}});
  assert.equal(piano.status,201,JSON.stringify(piano.payload));
  assert.equal(Number(piano.payload.client_id),Number(client.payload.id));

  const intake=await request("/api/intake",{token,method:"POST",body:{client_id:client.payload.id,piano_id:piano.payload.id,service_location:"workshop",reported_issue:"Voicing and regulation requested",estimated_urgency:"urgent",assigned_technician_id:"U-TECH"}});
  assert.equal(intake.status,201,JSON.stringify(intake.payload));

  const converted=await request(`/api/intake/${intake.payload.id}/convert`,{token,method:"POST",body:{}});
  assert.equal(converted.status,200,JSON.stringify(converted.payload));
  assert.equal(converted.payload.lead.status,"converted");

  const list=await request("/api/clients?q=alice",{token});
  assert.equal(list.status,200);assert.equal(list.payload.length,1);assert.equal(Number(list.payload[0].piano_count),1);
});

test("one-click conversion creates client and piano when intake is raw",async()=>{
  const login=await request("/api/login",{method:"POST",body:{email:"admin@example.com",password:"Round1Pass!"}});
  const token=login.payload.token;
  const intake=await request("/api/intake",{token,method:"POST",body:{raw_client_name:"Raw Lead",raw_contact:"raw@example.com",reported_issue:"Action is uneven",service_location:"on_site",estimated_urgency:"normal"}});
  assert.equal(intake.status,201);
  const converted=await request(`/api/intake/${intake.payload.id}/convert`,{token,method:"POST",body:{client:{name:"Raw Lead",email:"raw@example.com"},piano:{brand:"Yamaha",model:"C7"}}});
  assert.equal(converted.status,200,JSON.stringify(converted.payload));
  assert.equal(converted.payload.client.name,"Raw Lead");
  assert.equal(converted.payload.piano.brand,"Yamaha");
});

test("public website content routes remain available through the clean server",async()=>{
  const global=await request("/api/public/website-content/global?lang=en");
  assert.equal(global.status,200,JSON.stringify(global.payload));
  const pages=await request("/api/public/website-page-settings");
  assert.equal(pages.status,200,JSON.stringify(pages.payload));
  const reviews=await request("/api/public/website-reviews?lang=en");
  assert.equal(reviews.status,200,JSON.stringify(reviews.payload));
});

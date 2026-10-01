"use strict";

const assert=require("node:assert/strict");
const bcrypt=require("bcryptjs");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const test=require("node:test");
const Database=require("better-sqlite3");
const {createApp:createPublicWebsite}=require("../website/server/index");

const root=path.resolve(__dirname,"..");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"kh-service-suspension-"));
const dbPath=path.join(temp,"service.sqlite");
const env={
  ...process.env,
  DB_PATH:dbPath,
  BACKUP_DIR:path.join(temp,"backups"),
  UPLOAD_DIR:path.join(temp,"uploads"),
  JWT_SECRET:"service-suspension-test-secret-abcdefghijklmnopqrstuvwxyz",
  STRIPE_SECRET_KEY:"",
  STRIPE_WEBHOOK_SECRET:"",
  RESEND_API_KEY:"",
  EMAIL_FROM:"",
  WEBSITE_BASE_URL:"https://website.example.test",
  APP_BASE_URL:"https://erp.example.test",
  NODE_ENV:"test"
};
for(const [key,value] of Object.entries(env))if(value!==undefined)process.env[key]=String(value);

let server,origin,db;
const password="SuspendPass!123";

async function request(url,{token,method="GET",body}={}){
  const headers={Accept:"application/json"};
  if(token)headers.Authorization="Bearer "+token;
  let payloadBody;
  if(body!==undefined){headers["Content-Type"]="application/json";payloadBody=JSON.stringify(body);}
  const response=await fetch(origin+url,{method,headers,body:payloadBody});
  const type=response.headers.get("content-type")||"";
  const payload=type.includes("application/json")?await response.json().catch(()=>({})):await response.text();
  return {status:response.status,payload,headers:response.headers};
}
async function login(email){
  return request("/api/login",{method:"POST",body:{email,password}});
}

test.before(async()=>{
  const init=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env,encoding:"utf8"});
  assert.equal(init.status,0,init.stdout+"\n"+init.stderr);
  const seed=new Database(dbPath),hash=bcrypt.hashSync(password,4);
  const insert=seed.prepare("INSERT INTO users(id,name,email,contact_email,password_hash,role,status,hidden_user,is_superadmin,session_version) VALUES(?,?,?,?,?,?,'Active',?,?,0)");
  insert.run("SA-ONLY","Hidden Owner","owner.service@example.test","owner.service@example.test",hash,"ADMIN",1,1);
  insert.run("AD-1","Visible Admin","admin.service@example.test","admin.service@example.test",hash,"ADMIN",0,0);
  insert.run("WK-1","Visible Worker","worker.service@example.test","worker.service@example.test",hash,"WORKER",0,0);
  seed.close();

  const mod=require("../server/index.js");db=mod.db;
  server=mod.app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  origin="http://127.0.0.1:"+server.address().port;
});
test.after(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));
  try{db?.close();}catch(_error){}
  fs.rmSync(temp,{recursive:true,force:true});
});

test("hidden Super Admin is absent from team APIs and can only edit credentials from self profile",async()=>{
  const adminLogin=await login("admin.service@example.test");
  assert.equal(adminLogin.status,200,JSON.stringify(adminLogin.payload));
  const adminToken=adminLogin.payload.token;

  const users=await request("/api/users",{token:adminToken});
  assert.equal(users.status,200);
  assert.equal(users.payload.some(row=>row.id==="SA-ONLY"),false);

  const hiddenEdit=await request("/api/users/SA-ONLY",{token:adminToken,method:"PUT",body:{name:"Should Not Change"}});
  assert.equal(hiddenEdit.status,403);
  assert.equal(hiddenEdit.payload.error,"HIDDEN_OWNER_SELF_SERVICE_ONLY");

  const normalProfile=await request("/api/me/profile",{token:adminToken,method:"PUT",body:{
    name:"Visible Admin",email:"cannot-change-login@example.test",contact_email:"admin.service@example.test",phone:"",address:""
  }});
  assert.equal(normalProfile.status,200,JSON.stringify(normalProfile.payload));
  assert.equal(normalProfile.payload.email,"admin.service@example.test");

  const serviceControl=await request("/api/superadmin/service-suspension",{token:adminToken});
  assert.equal(serviceControl.status,403);
  assert.equal(serviceControl.payload.error,"SUPERADMIN_REQUIRED");
});

test("suspension revokes normal sessions, blocks every normal login and public API, while Super Admin remains operational",async()=>{
  const adminBefore=await login("admin.service@example.test");
  const superBefore=await login("owner.service@example.test");
  assert.equal(adminBefore.status,200);
  assert.equal(superBefore.status,200);

  const invalidConfirm=await request("/api/superadmin/service-suspension",{token:superBefore.payload.token,method:"PUT",body:{suspended:true,confirmation:"NO"}});
  assert.equal(invalidConfirm.status,400);
  assert.equal(invalidConfirm.payload.error,"SERVICE_SUSPENSION_CONFIRMATION_REQUIRED");

  const suspended=await request("/api/superadmin/service-suspension",{token:superBefore.payload.token,method:"PUT",body:{
    suspended:true,confirmation:"SUSPEND",invoice_reference:"KH-MONTHLY-TEST",note:"Payment test fixture"
  }});
  assert.equal(suspended.status,200,JSON.stringify(suspended.payload));
  assert.equal(suspended.payload.suspended,true);
  assert.equal(suspended.payload.reason,"PAYMENT_OVERDUE");

  const publicStatus=await request("/api/public/service-status");
  assert.equal(publicStatus.status,200);
  assert.deepEqual(Object.keys(publicStatus.payload).sort(),["available","status","updated_at","version"]);
  assert.equal(publicStatus.payload.available,false);

  const oldAdminSession=await request("/api/me",{token:adminBefore.payload.token});
  assert.equal(oldAdminSession.status,401);
  assert.equal(oldAdminSession.payload.error,"SESSION_REVOKED");

  const blockedAdmin=await login("admin.service@example.test");
  assert.equal(blockedAdmin.status,423);
  assert.equal(blockedAdmin.payload.error,"SERVICE_SUSPENDED");
  const blockedWorker=await login("worker.service@example.test");
  assert.equal(blockedWorker.status,423);
  assert.equal(blockedWorker.payload.error,"SERVICE_SUSPENDED");

  const superLogin=await login("owner.service@example.test");
  assert.equal(superLogin.status,200,JSON.stringify(superLogin.payload));
  assert.equal(superLogin.payload.user.role,"SUPERADMIN");
  assert.equal(superLogin.payload.service_suspended,true);
  const superMe=await request("/api/me",{token:superLogin.payload.token});
  assert.equal(superMe.status,200);

  const publicContent=await request("/api/public/website-content/home?lang=en");
  assert.equal(publicContent.status,503);
  assert.equal(publicContent.payload.error,"SITE_TEMPORARILY_UNAVAILABLE");

  const loginPage=await fetch(origin+"/");
  const loginHtml=await loginPage.text();
  assert.equal(loginPage.status,200);
  assert.match(loginHtml,/service-suspension-notice/);
  assert.doesNotMatch(loginHtml,/service-suspension-notice hidden/);
  assert.match(loginHtml,/outstanding payment/i);

  const restored=await request("/api/superadmin/service-suspension",{token:superLogin.payload.token,method:"PUT",body:{suspended:false,confirmation:"RESTORE"}});
  assert.equal(restored.status,200,JSON.stringify(restored.payload));
  assert.equal(restored.payload.suspended,false);

  const adminAfter=await login("admin.service@example.test");
  assert.equal(adminAfter.status,200,JSON.stringify(adminAfter.payload));
});

test("Super Admin can change only its own login identity and the credential change revokes its prior session",async()=>{
  const signedIn=await login("owner.service@example.test");
  assert.equal(signedIn.status,200);
  const token=signedIn.payload.token;

  const changed=await request("/api/me/profile",{token,method:"PUT",body:{
    name:"Hidden Owner",
    email:"owner.changed@example.test",
    contact_email:"owner.changed@example.test",
    phone:"",
    address:""
  }});
  assert.equal(changed.status,200,JSON.stringify(changed.payload));
  assert.equal(changed.payload.email,"owner.changed@example.test");
  assert.equal(changed.payload.reauth_required,true);

  const oldSession=await request("/api/me",{token});
  assert.equal(oldSession.status,401);
  assert.equal(oldSession.payload.error,"SESSION_REVOKED");

  const oldEmail=await login("owner.service@example.test");
  assert.equal(oldEmail.status,401);
  const newEmail=await login("owner.changed@example.test");
  assert.equal(newEmail.status,200,JSON.stringify(newEmail.payload));
  assert.equal(newEmail.payload.user.role,"SUPERADMIN");
});

test("public website returns only generic technical-unavailability messaging when ERP service is suspended",async()=>{
  const fetchImpl=async url=>{
    if(String(url).endsWith("/api/public/service-status")){
      return new Response(JSON.stringify({available:false,status:"UNAVAILABLE",updated_at:"",version:"1"}),{status:200,headers:{"content-type":"application/json"}});
    }
    throw new Error("Unexpected public API request: "+url);
  };
  const app=createPublicWebsite({
    baseUrl:"https://www.example.test",
    eventApiBaseUrl:"https://erp.example.test",
    fetchImpl,
    allowIndexing:true
  });
  const publicServer=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>publicServer.once("listening",resolve));
  const publicOrigin="http://127.0.0.1:"+publicServer.address().port;
  try{
    const health=await fetch(publicOrigin+"/health");
    assert.equal(health.status,200);

    const english=await fetch(publicOrigin+"/");
    const enHtml=await english.text();
    assert.equal(english.status,503);
    assert.match(enHtml,/technical reasons/i);
    assert.doesNotMatch(enHtml,/payment|outstanding|invoice|díjhátralék|számla/i);
    assert.match(enHtml,/class="piano"/);

    const hungarian=await fetch(publicOrigin+"/hu/");
    const huHtml=await hungarian.text();
    assert.equal(hungarian.status,503);
    assert.match(huHtml,/Technikai okok/i);
    assert.doesNotMatch(huHtml,/díjhátralék|számla|payment|outstanding/i);

    const apiResponse=await fetch(publicOrigin+"/api/site/contact-leads",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
    assert.equal(apiResponse.status,503);
    assert.equal((await apiResponse.json()).error,"SITE_TEMPORARILY_UNAVAILABLE");
  }finally{
    await new Promise(resolve=>publicServer.close(resolve));
  }
});

test("suspension contracts stay server-enforced and hidden-owner lookups exclude the Super Admin",()=>{
  const index=fs.readFileSync(path.join(root,"server","index.js"),"utf8");
  const v6=fs.readFileSync(path.join(root,"public","v6.js"),"utf8");
  const website=fs.readFileSync(path.join(root,"website","server","index.js"),"utf8");
  const workflow=fs.readFileSync(path.join(root,"server","workflow-v2.js"),"utf8");
  const round2=fs.readFileSync(path.join(root,"server","round2-workflow.js"),"utf8");

  assert.match(index,/serviceSuspension\.isSuspended\(\) && !isSuperadmin\(req\.user\)/);
  assert.match(index,/serviceSuspension\.isSuspended\(\)&&Number\(row\.is_superadmin\|\|0\)!==1/);
  assert.match(index,/app\.put\("\/api\/superadmin\/service-suspension",auth,requireSuperadmin/);
  assert.match(index,/app\.use\("\/api\/public"/);
  assert.match(index,/HIDDEN_OWNER_SELF_SERVICE_ONLY/);
  assert.match(v6,/serviceAccessToggle/);
  assert.match(v6,/api\/superadmin\/service-suspension/);
  assert.match(website,/renderTechnicalUnavailable/);
  assert.match(website,/SITE_TEMPORARILY_UNAVAILABLE/);
  assert.match(workflow,/COALESCE\(hidden_user,0\)=0/);
  assert.match(round2,/COALESCE\(hidden_user,0\)=0/);
});

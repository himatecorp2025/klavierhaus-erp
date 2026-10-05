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
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"kh-admin-v6-"));
const dbPath=path.join(temp,"v6.sqlite");
const env={
  ...process.env,
  PORT:"0",
  DB_PATH:dbPath,
  BACKUP_DIR:path.join(temp,"backups"),
  UPLOAD_DIR:path.join(temp,"uploads"),
  JWT_SECRET:"admin-v6-test-secret-abcdefghijklmnopqrstuvwxyz",
  RESEND_API_KEY:"",
  NODE_ENV:"test"
};
for(const [key,value] of Object.entries(env))process.env[key]=String(value);

let server,origin,db;
const ids={};
async function request(url,{token,method="GET",body,form}={}){
  const headers={Accept:"application/json"};if(token)headers.Authorization="Bearer "+token;
  let payload;
  if(form)payload=form;
  else if(body!==undefined){headers["Content-Type"]="application/json";payload=JSON.stringify(body);}
  const response=await fetch(origin+url,{method,headers,body:payload});
  const data=await response.json().catch(()=>({}));
  return {status:response.status,payload:data};
}
async function login(email){
  const result=await request("/api/login",{method:"POST",body:{email,password:"AdminV6!"}});
  assert.equal(result.status,200,JSON.stringify(result.payload));return result.payload;
}
function futureIso(day=0,hour=15,minute=0){return new Date(Date.UTC(2038,2,10+day,hour,minute)).toISOString();}

test.before(async()=>{
  const init=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env,encoding:"utf8"});
  assert.equal(init.status,0,init.stdout+"\n"+init.stderr);
  const seed=new Database(dbPath),hash=bcrypt.hashSync("AdminV6!",4);
  const user=seed.prepare(`INSERT INTO users(id,name,email,contact_email,password_hash,role,status,hidden_user,is_superadmin,session_version,calendar_color,theme_preference)
    VALUES(?,?,?,?,?,?,'Active',0,?,0,?,?)`);
  user.run("V6-A","V6 Admin","admin.v6@example.com","admin.v6@example.com",hash,"ADMIN",0,"#5577cc","dark");
  user.run("V6-M","V6 Manager","manager.v6@example.com","manager.v6@example.com",hash,"MANAGER",0,"#557799","dark");
  user.run("V6-T","V6 Technician","tech.v6@example.com","tech.v6@example.com",hash,"WORKER",0,"#335577","dark");
  user.run("V6-W2","Delete Target","delete.v6@example.com","delete.v6@example.com",hash,"WORKER",0,"#888888","dark");
  const client=seed.prepare("INSERT INTO clients(name,email,address) VALUES(?,?,?)").run("V6 Client","client@example.com","57th Street, New York");
  ids.client=Number(client.lastInsertRowid);
  const piano=seed.prepare("INSERT INTO pianos(client_id,brand,model,serial_number,location_notes) VALUES(?,?,?,?,?)").run(ids.client,"Steinway & Sons","B","V6-001","57th Street");
  ids.piano=Number(piano.lastInsertRowid);
  seed.close();

  const mod=require("../server/index.js");db=mod.db;
  server=mod.app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  origin="http://127.0.0.1:"+server.address().port;
});
test.after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));try{db?.close();}catch(_error){}fs.rmSync(temp,{recursive:true,force:true});});

test("theme preference is stored per user and returned in the authenticated user",async()=>{
  const adminSession=await login("admin.v6@example.com"),managerSession=await login("manager.v6@example.com");
  ids.admin=adminSession.token;ids.manager=managerSession.token;
  assert.equal(adminSession.user.theme_preference,"dark");
  assert.equal(managerSession.user.theme_preference,"dark");

  const changed=await request("/api/me/preferences",{token:ids.admin,method:"PUT",body:{theme:"light"}});
  assert.equal(changed.status,200,JSON.stringify(changed.payload));
  assert.equal(changed.payload.theme,"light");

  const adminAgain=await login("admin.v6@example.com");
  const managerAgain=await login("manager.v6@example.com");
  assert.equal(adminAgain.user.theme_preference,"light");
  assert.equal(managerAgain.user.theme_preference,"dark");
});

test("only Admin can delete a normal team member and deletion preserves the historical user row",async()=>{
  const denied=await request("/api/users/V6-W2",{token:ids.manager,method:"DELETE"});
  assert.equal(denied.status,403);

  const removed=await request("/api/users/V6-W2",{token:ids.admin,method:"DELETE"});
  assert.equal(removed.status,200,JSON.stringify(removed.payload));
  assert.equal(removed.payload.soft_deleted,true);
  const stored=db.prepare("SELECT status,hidden_user,email,session_version FROM users WHERE id='V6-W2'").get();
  assert.equal(stored.status,"Inactive");
  assert.equal(stored.hidden_user,1);
  assert.match(stored.email,/^deleted\.V6-W2\./);
});

test("Intake Center catalog is Admin-managed and available to staff as active checklist items",async()=>{
  const denied=await request("/api/intake-catalog",{token:ids.manager,method:"POST",body:{category:"Action",title_en:"Manager item",title_hu:"Manager tétel",default_price:50}});
  assert.equal(denied.status,403);

  const tuning=await request("/api/intake-catalog",{token:ids.admin,method:"POST",body:{
    category:"Tuning",title_en:"Concert tuning",title_hu:"Koncerthangolás",description_en:"Concert-level tuning",description_hu:"Koncertszintű hangolás",default_price:320,active:true
  }});
  assert.equal(tuning.status,201,JSON.stringify(tuning.payload));
  const action=await request("/api/intake-catalog",{token:ids.admin,method:"POST",body:{
    category:"Action",title_en:"Action regulation",title_hu:"Mechanika szabályozás",default_price:780,active:true
  }});
  assert.equal(action.status,201,JSON.stringify(action.payload));
  ids.tuning=tuning.payload.id;ids.action=action.payload.id;

  const list=await request("/api/intake-catalog",{token:ids.manager});
  assert.equal(list.status,200);
  assert.equal(list.payload.length,2);
});

test("intake checklist prices are snapshotted and summed into an estimated quote",async()=>{
  const created=await request("/api/intake",{token:ids.admin,method:"POST",body:{
    client_id:ids.client,piano_id:ids.piano,service_location:"workshop",reported_issue:"Concert preparation",estimated_urgency:"normal",media_urls:[],assigned_technician_id:"V6-T"
  }});
  assert.equal(created.status,201,JSON.stringify(created.payload));
  ids.intake=created.payload.id;

  const assessment=await request(`/api/intake/${ids.intake}/assessment`,{token:ids.admin,method:"PUT",body:{items:[
    {catalog_item_id:ids.tuning,price:350},
    {catalog_item_id:ids.action,price:800}
  ]}});
  assert.equal(assessment.status,200,JSON.stringify(assessment.payload));
  assert.equal(assessment.payload.estimated_total,1150);
  assert.equal(assessment.payload.items.length,2);
  assert.equal(db.prepare("SELECT estimated_total FROM intake_leads WHERE id=?").get(ids.intake).estimated_total,1150);
});

test("approved intake can create a scheduled active calendar/workflow job with quoted revenue in one action",async()=>{
  const converted=await request(`/api/intake/${ids.intake}/convert-to-job`,{token:ids.admin,method:"POST",body:{
    title:"Concert prep approved",
    estimated_duration_min:180,
    estimated_revenue:1150,
    scheduled_at:futureIso(0,15,30),
    assigned_technician_id:"V6-T",
    workflow_phases:[
      {stage_key:"received",enabled:true},
      {stage_key:"in_progress",enabled:true},
      {stage_key:"qa_review",enabled:true},
      {stage_key:"admin_approval",enabled:false},
      {stage_key:"completed",enabled:true}
    ]
  }});
  assert.equal(converted.status,201,JSON.stringify(converted.payload));
  assert.equal(converted.payload.job.stage,"received");
  assert.equal(converted.payload.job.estimated_revenue,1150);
  assert.equal(converted.payload.job.scheduled_at,futureIso(0,15,30));
  ids.job=converted.payload.job.id;

  const workflow=await request("/api/jobs/workflow",{token:ids.admin});
  assert.ok(workflow.payload.jobs.some(row=>row.id===ids.job&&row.estimated_revenue===1150));
  const calendar=await request("/api/calendar?from="+encodeURIComponent(futureIso(0,0,0))+"&to="+encodeURIComponent(futureIso(1,0,0)),{token:ids.admin});
  assert.ok(calendar.payload.jobs.some(row=>row.id===ids.job));
});

test("service CMS galleries persist through the v6 extension and are exposed by the preserved public API",async()=>{
  const service=await request("/api/website-services",{token:ids.admin,method:"POST",body:{
    title_en:"Concert preparation",title_hu:"Koncert-előkészítés",
    summary_en:"Preparation service",summary_hu:"Előkészítési szolgáltatás",
    image_url:"/uploads/website/service-main.jpg",image_alt_en:"Concert piano",image_alt_hu:"Koncertzongora",visible:true
  }});
  assert.equal(service.status,201,JSON.stringify(service.payload));
  const media=await request(`/api/v6/website-services/${service.payload.id}/gallery`,{token:ids.admin,method:"PUT",body:{gallery:[
    {url:"/uploads/website/service-1.jpg",alt_en:"Action work",alt_hu:"Mechanikai munka"},
    {url:"/uploads/website/service-2.jpg",alt_en:"Voicing",alt_hu:"Intonálás"}
  ]}});
  assert.equal(media.status,200,JSON.stringify(media.payload));
  assert.equal(JSON.parse(media.payload.gallery_json).length,2);

  const publicList=await request("/api/public/website-services?lang=en");
  assert.equal(publicList.status,200,JSON.stringify(publicList.payload));
  const publicService=publicList.payload.find(row=>row.id===service.payload.id);
  assert.ok(publicService);
  assert.equal(publicService.gallery.length,2);
  assert.equal(publicService.gallery[0].alt,"Action work");
});

test("direct-expense receipt endpoint accepts a real PDF upload and returns a persistent public path",async()=>{
  const form=new FormData();
  form.append("file",new Blob(["%PDF-1.4\nV6 receipt"],{type:"application/pdf"}),"receipt.pdf");
  const uploaded=await request("/api/v6/direct-expense-receipt",{token:ids.manager,method:"POST",form});
  assert.equal(uploaded.status,201,JSON.stringify(uploaded.payload));
  assert.match(uploaded.payload.url,/^\/uploads\/receipts\/receipt-/);
  assert.ok(fs.existsSync(path.join(env.UPLOAD_DIR,"receipts",path.basename(uploaded.payload.url))));
});

test("branding assets expose independent ERP dark/light, PWA and login slots",async()=>{
  const assets=await request("/api/settings/branding/assets",{token:ids.admin});
  assert.equal(assets.status,200);
  for(const key of ["favicon_url","app_icon_url","login_background_url","logo_url","erp_logo_dark_url","erp_logo_light_url","branding_version"])assert.ok(Object.prototype.hasOwnProperty.call(assets.payload,key),key);
  assert.equal(assets.payload.app_icon_url,"/icons/icon-512.png");
});

test("CMS public favicon upload is also rendered as the Klavierhaus System favicon",async()=>{
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64");
  png.writeUInt32BE(64,16);png.writeUInt32BE(64,20);
  const form=new FormData();
  form.append("file",new Blob([png],{type:"image/png"}),"shared-favicon.png");
  const uploaded=await request("/api/settings/branding/public-favicon",{token:ids.admin,method:"POST",form});
  assert.equal(uploaded.status,200,JSON.stringify(uploaded.payload));
  assert.match(uploaded.payload.url,/^\/uploads\/branding-v6\//);

  const assets=await request("/api/settings/branding/assets",{token:ids.admin});
  assert.equal(assets.status,200,JSON.stringify(assets.payload));
  assert.equal(assets.payload.favicon_url,uploaded.payload.url);

  const publicBranding=await request("/api/public/branding");
  assert.equal(publicBranding.status,200,JSON.stringify(publicBranding.payload));
  assert.equal(publicBranding.payload.favicon_url,uploaded.payload.url);

  const htmlResponse=await fetch(origin+"/",{headers:{Accept:"text/html"}});
  const html=await htmlResponse.text();
  assert.equal(htmlResponse.status,200);
  assert.ok(html.includes('id="appFavicon" rel="icon" href="'+uploaded.payload.url+'?v='),html.slice(0,800));
});


test("existing public website favicon is the canonical System favicon without requiring a re-upload",async()=>{
  const getSetting=db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?");
  const previousDesign=getSetting.get("website_design_settings")?.setting_value;
  const previousSystemFavicon=getSetting.get("favicon_url")?.setting_value;
  const upsert=db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`);
  try{
    upsert.run("website_design_settings",JSON.stringify({favicon_url:"/uploads/branding-v6/existing-public-favicon.png"}),"TEST");
    upsert.run("favicon_url","/icons/icon-192.png","TEST");

    const branding=await request("/api/public/branding");
    assert.equal(branding.status,200,JSON.stringify(branding.payload));
    assert.equal(branding.payload.favicon_url,"/uploads/branding-v6/existing-public-favicon.png");

    const response=await fetch(origin+"/",{headers:{Accept:"text/html"}});
    const html=await response.text();
    assert.equal(response.status,200);
    assert.ok(html.includes('id="appFavicon" rel="icon" href="/uploads/branding-v6/existing-public-favicon.png?v='),html.slice(0,1000));
  }finally{
    if(previousDesign===undefined)db.prepare("DELETE FROM app_settings WHERE setting_key='website_design_settings'").run();
    else upsert.run("website_design_settings",previousDesign,"TEST");
    if(previousSystemFavicon===undefined)db.prepare("DELETE FROM app_settings WHERE setting_key='favicon_url'").run();
    else upsert.run("favicon_url",previousSystemFavicon,"TEST");
  }
});

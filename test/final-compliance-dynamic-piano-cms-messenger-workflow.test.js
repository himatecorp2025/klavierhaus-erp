"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const express=require("express");
const Database=require("better-sqlite3");
const {registerWebsiteContentRoutes}=require("../server/website-content");

const root=path.resolve(__dirname,"..");
const read=(name)=>fs.readFileSync(path.join(root,name),"utf8");

async function withWebsiteContent(callback){
  const db=new Database(":memory:");
  db.exec(read("server/schema.sql"));
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,is_superadmin) VALUES('A','Admin','a@example.test','x','ADMIN','Active',1)").run();
  const insert=db.prepare(`INSERT INTO website_showroom_pianos(id,slug_en,slug_hu,brand,model,title_en,title_hu,image_url,published,availability_status)
    VALUES(?,?,?,?,?,?,?,?,1,'AVAILABLE')`);
  insert.run("ST","steinway-b","steinway-b","Steinway & Sons","B","Steinway B","Steinway B","/steinway.jpg");
  insert.run("FA","fazioli-f212","fazioli-f212","Fazioli","F212","Fazioli F212","Fazioli F212","/fazioli.jpg");
  insert.run("BO","bosendorfer-214","bosendorfer-214","Bösendorfer","214VC","Bösendorfer 214VC","Bösendorfer 214VC","/bosendorfer.jpg");
  insert.run("YA","yamaha-c7","yamaha-c7","Yamaha","C7","Yamaha C7","Yamaha C7","/yamaha.jpg");
  const app=express();app.use(express.json());
  const auth=(req,_res,next)=>{req.user={id:"A",name:"Admin",role:"ADMIN",is_superadmin:1};next();};
  registerWebsiteContentRoutes({
    app,db,auth,permit:()=>auth,audit:()=>{},
    websiteImageUpload:{single:()=> (_req,_res,next)=>next()},websiteImageDir:os.tmpdir(),
    websiteBaseUrl:"https://klavierhaus.example",erpBaseUrl:"https://erp.example"
  });
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=async(url,options={})=>{
    const response=await fetch(origin+url,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
    const text=await response.text();let body;try{body=text?JSON.parse(text):null}catch(_error){body=text;}
    return {status:response.status,body};
  };
  try{await callback({db,request});}
  finally{await new Promise(resolve=>server.close(resolve));db.close();}
}

test("Website CMS creates one editable page per live piano brand, including future brands",async()=>{
  await withWebsiteContent(async({request})=>{
    const pages=await request("/api/website-content/pages");
    assert.equal(pages.status,200,JSON.stringify(pages.body));
    const pianoPages=pages.body.pages.filter(row=>row.admin_group==="pianos");
    assert.ok(pianoPages.some(row=>row.page_key==="steinway"&&row.piano_brand==="Steinway & Sons"));
    assert.ok(pianoPages.some(row=>row.page_key==="piano-brand--fazioli"&&row.piano_brand==="Fazioli"));
    assert.ok(pianoPages.some(row=>row.page_key==="piano-brand--bosendorfer"&&row.piano_brand==="Bösendorfer"));
    assert.ok(pianoPages.some(row=>row.page_key==="piano-brand--yamaha"&&row.piano_brand==="Yamaha"));

    const fallback=await request("/api/website-content/piano-brand--yamaha?lang=en");
    assert.equal(fallback.status,200,JSON.stringify(fallback.body));
    assert.equal(fallback.body.content.hero.title,"Yamaha");

    const edited=structuredClone(fallback.body.content);
    edited.hero.title="Yamaha collection edited in CMS";
    edited.seo.title="Yamaha at Klavierhaus";
    const saved=await request("/api/website-content/piano-brand--yamaha",{method:"PUT",body:JSON.stringify({language:"en",content:edited})});
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    assert.equal(saved.body.content.hero.title,"Yamaha collection edited in CMS");
    const publicPage=await request("/api/public/website-content/piano-brand--yamaha?lang=en");
    assert.equal(publicPage.body.content.hero.title,"Yamaha collection edited in CMS");
  });
});

test("legacy archive foreign keys to removed documents table are rebuilt against document_archive",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"kh-legacy-documents-fk-"));
  const dbPath=path.join(dir,"legacy.sqlite"),backupDir=path.join(dir,"backups");
  const db=new Database(dbPath);db.pragma("foreign_keys=OFF");db.exec(read("server/schema.sql"));
  db.exec(`
    DROP TABLE intake_assessment_email_log;
    CREATE TABLE intake_assessment_email_log(
      id INTEGER PRIMARY KEY AUTOINCREMENT,intake_id INTEGER NOT NULL,archive_document_id INTEGER,recipient TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',custom_message TEXT,status TEXT NOT NULL,provider_message_id TEXT,error_code TEXT,
      sent_by_user_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(intake_id) REFERENCES intake_leads(id) ON DELETE CASCADE,
      FOREIGN KEY(archive_document_id) REFERENCES documents(id) ON DELETE SET NULL,
      FOREIGN KEY(sent_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    DROP TABLE workshop_invoice_checkouts;
    CREATE TABLE workshop_invoice_checkouts(
      id TEXT PRIMARY KEY,invoice_id INTEGER NOT NULL,stripe_checkout_session_id TEXT UNIQUE,stripe_payment_intent_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',amount_cents INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'USD',checkout_url TEXT,
      expires_at TEXT NOT NULL,failure_code TEXT,paid_at TEXT,receipt_archive_document_id INTEGER,receipt_provider_message_id TEXT,
      receipt_sent_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY(receipt_archive_document_id) REFERENCES documents(id) ON DELETE SET NULL
    );
  `);db.close();
  const run=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env:{...process.env,DB_PATH:dbPath,BACKUP_DIR:backupDir},encoding:"utf8"});
  assert.equal(run.status,0,run.stdout+"\n"+run.stderr);
  const migrated=new Database(dbPath);
  for(const table of ["intake_assessment_email_log","workshop_invoice_checkouts"]){
    const targets=migrated.prepare(`PRAGMA foreign_key_list("${table}")`).all().map(row=>row.table);
    assert.ok(!targets.includes("documents"),`${table} still points at removed documents table`);
    assert.ok(targets.includes("document_archive"),`${table} must point at document_archive`);
  }
  migrated.close();fs.rmSync(dir,{recursive:true,force:true});
});

test("New Workflow Job has an inline add-phase card that does not mutate existing workflows",()=>{
  const ui=read("public/round2.js"),api=read("server/round2-workflow.js"),css=read("public/styles.css");
  assert.match(ui,/id="workflowJobAddPhase"/);
  assert.match(ui,/Add phase to this workflow/);
  assert.match(ui,/apply_to_existing:false/);
  assert.match(ui,/id="jobWorkflowPlanRows"/);
  assert.match(api,/req\.body\?\.apply_to_existing!==false/);
  assert.match(css,/\.workflow-add-phase-card/);
});

test("Messenger admin composer ends with an unclipped two-column 2x2 action grid",()=>{
  const ui=read("public/messenger.js"),css=read("public/styles.css");
  assert.match(ui,/class="messenger-action-grid"/);
  assert.match(ui,/id="messengerSendProfileForm"/);
  assert.match(ui,/id="messengerAppointmentAction"/);
  assert.match(ui,/messenger-attach-button/);
  assert.match(ui,/messenger-send-button/);
  const canonical=css.slice(css.lastIndexOf("DYNAMIC PIANO + NEW WORKFLOW PHASE + MESSENGER COMPOSER V34"));
  assert.match(canonical,/\.messenger-reply\{[\s\S]*grid-template-columns:minmax\(0,1fr\) 94px!important/);
  assert.match(canonical,/grid-template-columns:repeat\(2,44px\)!important/);
  assert.match(canonical,/@media\(max-width:700px\)[\s\S]*grid-template-columns:minmax\(0,1fr\) 86px!important/);
  assert.match(canonical,/grid-template-columns:repeat\(2,40px\)!important/);
  assert.match(canonical,/grid-column:auto!important/);
});

test("dynamic public piano routes are derived from live showroom brands",()=>{
  const publicServer=read("website/server/index.js");
  assert.match(publicServer,/function uniquePianoBrands\(items=\[\]\)/);
  assert.match(publicServer,/pianoBrandContentKey\(brand\)/);
  assert.match(publicServer,/uniquePianoBrands\(allItems\)\.find/);
  assert.match(publicServer,/eventClient\.content\(pianoBrandContentKey\(brand\),language\)/);
  assert.match(publicServer,/uniquePianoBrands\(values\[2\]\)\.flatMap/);
});

test("CMS piano brand grids include a per-brand add-piano card and seeded brand editor",()=>{
  const ui=read("public/v6.js"),css=read("public/styles.css");
  assert.match(ui,/data-add-piano-brand/);
  assert.match(ui,/Add piano to this brand/);
  assert.match(ui,/row\?\.brand\|\|seed\?\.brand/);
  assert.match(ui,/piano_brand_slug/);
  assert.match(css,/\.cms-add-collection-card/);
});

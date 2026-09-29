"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const Database=require("better-sqlite3");
const {
  createWebsiteBackup,readWebsiteBackup,restoreSnapshot,factoryReset
}=require("../server/website-backup-reset");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

function makeDb(){
  const db=new Database(":memory:");
  db.pragma("foreign_keys=ON");
  db.exec(read("server/schema.sql"));
  return db;
}

test("Website backup factory reset and restore preserve operational rows and CMS links",()=>{
  const db=makeDb(),backupDir=fs.mkdtempSync(path.join(os.tmpdir(),"kh-web-recovery-"));
  try{
    db.prepare(`INSERT INTO website_services(id,slug_en,slug_hu,title_en,title_hu,image_url,visible)
      VALUES('CUSTOM-SVC','custom-service','egyedi-szolgaltatas','Custom Service','Egyedi szolgáltatás','/uploads/website/custom.jpg',1)`).run();
    db.prepare(`INSERT INTO website_contact_leads(id,name,email,service_id,consent_contact)
      VALUES('LEAD-1','Backup Client','backup@example.com','CUSTOM-SVC',1)`).run();
    db.prepare(`INSERT INTO website_content_pages(page_key,language,content_json,version)
      VALUES('home','en','{"hero":{"title":"Custom backup state"}}',7)`).run();
    db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES('logo_url','/uploads/website/custom-logo.png','TEST')").run();

    const backup=createWebsiteBackup({db,backupDir,scope:"all",triggerType:"MANUAL",label:"Golden website state"});
    assert.ok(backup.id);
    assert.ok(fs.existsSync(path.join(backupDir,backup.file_path)));
    const verified=readWebsiteBackup({db,backupDir,id:backup.id});
    assert.equal(verified.snapshot.tables.website_services.some(row=>row.id==="CUSTOM-SVC"),true);
    assert.equal(verified.snapshot.foreign_links.website_contact_leads.find(row=>row.id==="LEAD-1").service_id,"CUSTOM-SVC");

    factoryReset(db,"collections",{websiteBaseUrl:"https://website.example.test"});
    assert.equal(Boolean(db.prepare("SELECT 1 FROM website_services WHERE id='CUSTOM-SVC'").get()),false);
    assert.ok(Number(db.prepare("SELECT COUNT(*) c FROM website_services WHERE is_sample=1").get().c)>=3);
    const leadAfterReset=db.prepare("SELECT * FROM website_contact_leads WHERE id='LEAD-1'").get();
    assert.ok(leadAfterReset);
    assert.equal(leadAfterReset.service_id,null);

    const restoredCounts=restoreSnapshot(db,verified.snapshot);
    assert.ok(restoredCounts.website_services>=1);
    assert.ok(db.prepare("SELECT 1 FROM website_services WHERE id='CUSTOM-SVC'").get());
    assert.equal(db.prepare("SELECT service_id FROM website_contact_leads WHERE id='LEAD-1'").get().service_id,"CUSTOM-SVC");
    assert.equal(db.prepare("SELECT content_json FROM website_content_pages WHERE page_key='home' AND language='en'").get().content_json,'{"hero":{"title":"Custom backup state"}}');
    assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='logo_url'").get().setting_value,"/uploads/website/custom-logo.png");

    factoryReset(db,"pages",{websiteBaseUrl:"https://website.example.test"});
    assert.equal(Boolean(db.prepare("SELECT 1 FROM website_content_pages WHERE page_key='home' AND language='en'").get()),false);
    assert.ok(Number(db.prepare("SELECT COUNT(*) c FROM landing_sections").get().c)>0);

    db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES('website_design_settings','{"black":"#ffffff"}','TEST')
      ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value`).run();
    factoryReset(db,"branding",{websiteBaseUrl:"https://website.example.test"});
    assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='logo_url'").get().setting_value,"/icons/icon-512.png");
    const design=JSON.parse(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='website_design_settings'").get().setting_value);
    assert.equal(design.black,"#080807");
  }finally{db.close();fs.rmSync(backupDir,{recursive:true,force:true});}
});

test("Website recovery UI replaces CMS archive tab and uses typed destructive confirmations",()=>{
  const v6=read("public/v6.js"),backend=read("server/website-backup-reset.js"),schema=read("server/schema.sql");
  assert.match(v6,/data-cms-mode="recovery"/);
  assert.match(v6,/Factory recovery/);
  assert.match(v6,/Gyári adatok visszaállítása/);
  assert.doesNotMatch(v6,/data-cms-mode="archive"/);
  assert.match(v6,/RESET WEBSITE/);
  assert.match(v6,/RESTORE WEBSITE/);
  assert.match(v6,/RESET \$\{scope\.toUpperCase\(\)\}/);
  assert.match(v6,/\/api\/website-recovery\/backups/);
  assert.match(v6,/\/api\/website-recovery\/factory-reset/);
  assert.match(backend,/triggerType:"PRE_RESET"/);
  assert.match(backend,/triggerType:"PRE_RESTORE"/);
  assert.match(backend,/sha256/);
  assert.match(backend,/restoreLinks/);
  assert.match(schema,/CREATE TABLE IF NOT EXISTS website_backups/);
});

test("Deleted intake UI and archive category are explicit system lifecycle contracts",()=>{
  const v6=read("public/v6.js"),archive=read("server/archive-center.js"),schema=read("server/schema.sql");
  assert.match(v6,/deleted_intake:\["Deleted intake requests","Törölt igények"\]/);
  assert.match(v6,/id="intakeDeleteButton"/);
  assert.match(v6,/Delete and archive/);
  assert.match(v6,/\/api\/intake\/\$\{lead\.id\}/);
  assert.match(archive,/app\.delete\("\/api\/intake\/:id"/);
  assert.match(archive,/source:"deleted_intake"/);
  assert.match(archive,/linked_jobs:linkedJobs/);
  assert.match(archive,/email_log:emailLog/);
  assert.match(archive,/DELETE FROM intake_leads WHERE id=\?/);
  assert.match(schema,/category TEXT NOT NULL CHECK\(category IN \('deleted_invoice','deleted_intake'/);
});

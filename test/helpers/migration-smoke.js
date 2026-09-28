"use strict";

const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");

const root=path.resolve(__dirname,"../..");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"kh-final-migration-"));
const dbPath=path.join(temp,"legacy.sqlite");
const backupDir=path.join(temp,"backups");
const env={...process.env,DB_PATH:dbPath,BACKUP_DIR:backupDir,JWT_SECRET:"final-migration-test-secret-1234567890"};

function run(label){
  const result=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env,encoding:"utf8"});
  if(result.status!==0)throw new Error(`${label}_FAILED\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try{
  const legacy=new Database(dbPath);
  legacy.exec(`
    PRAGMA foreign_keys=OFF;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN','MANAGER','WORKER')),status TEXT DEFAULT 'Active',
      phone TEXT,address_line1 TEXT,city TEXT,state TEXT,postal_code TEXT,country TEXT DEFAULT 'United States',
      address TEXT,calendar_color TEXT,google_calendar_email TEXT,contact_email TEXT,hidden_user INTEGER DEFAULT 0,
      is_superadmin INTEGER DEFAULT 0,session_version INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value TEXT,updated_by TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE contacts(id TEXT PRIMARY KEY,name TEXT,email TEXT,phone TEXT,address TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE pianos(id TEXT PRIMARY KEY,brand TEXT,model TEXT,serial_no TEXT,finish TEXT,location TEXT,notes TEXT,owner_contact_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE client_pianos(id TEXT PRIMARY KEY,client_id TEXT,piano_id TEXT);
    CREATE TABLE invoices(id INTEGER PRIMARY KEY,total_amount REAL,status TEXT);
    CREATE TABLE invoice_credit_memos(id INTEGER PRIMARY KEY,invoice_id INTEGER);
    CREATE TRIGGER trg_invoice_credit_memos_immutable_update
    BEFORE UPDATE ON invoice_credit_memos
    BEGIN
      SELECT CASE WHEN (SELECT i.revenue_recognition_status FROM invoices i WHERE i.id=NEW.invoice_id)='DEFERRED'
        THEN RAISE(ABORT,'IMMUTABLE_CREDIT_MEMO') END;
    END;
    CREATE TABLE legacy_fk_parent(id INTEGER PRIMARY KEY,label TEXT);
    CREATE TABLE legacy_fk_child(id INTEGER PRIMARY KEY,parent_id INTEGER NOT NULL,FOREIGN KEY(parent_id) REFERENCES legacy_fk_parent(id));
    INSERT INTO legacy_fk_parent(id,label) VALUES(1,'parent');
    INSERT INTO legacy_fk_child(id,parent_id) VALUES(1,1);
  `);
  legacy.prepare("INSERT INTO users(id,name,email,password_hash,role,status,contact_email,hidden_user,is_superadmin) VALUES(?,?,?,?,?,'Active',?,0,0)")
    .run("U1","Round One Admin","admin@example.com",bcrypt.hashSync("Round1Pass!",4),"ADMIN","admin@example.com");
  legacy.prepare("INSERT INTO contacts(id,name,email,phone,address,notes) VALUES('C-1','Legacy Client','legacy@example.com','212-555-0100','New York','Important customer')").run();
  legacy.prepare("INSERT INTO pianos(id,brand,model,serial_no,finish,location,owner_contact_id) VALUES('P-1','Steinway & Sons','B-211','123456','Ebony','Client home','C-1')").run();
  legacy.prepare("INSERT INTO client_pianos(id,client_id,piano_id) VALUES('CP-1','C-1','P-1')").run();
  legacy.close();

  run("FINAL_LEGACY_MIGRATION");
  run("FINAL_IDEMPOTENT");

  const db=new Database(dbPath,{readonly:true});
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients").get().c,1);
  assert.equal(db.prepare("SELECT name,email FROM clients").get().name,"Legacy Client");
  const piano=db.prepare("SELECT p.*,c.name client_name FROM pianos p JOIN clients c ON c.id=p.client_id").get();
  assert.equal(piano.brand,"Steinway & Sons");
  assert.equal(piano.serial_number,"123456");
  assert.equal(piano.client_name,"Legacy Client");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM intake_leads").get().c,0);
  for(const retired of ["contacts","client_pianos","planned_jobs","inventory_items","wf2_workflows","financial_items","legacy_fk_parent","legacy_fk_child"]){
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(retired)),false,`${retired} should be retired`);
  }
  for(const preserved of ["users","events","website_content_pages","website_showroom_pianos","website_services","website_artists","website_media","intake_catalog_items","intake_assessment_items","jobs","workflow_stage_definitions","job_workflow_phases","job_handoffs","partners","partner_contractors","invoice_sequences","invoices","invoice_items","invoice_payments","direct_expenses","invoice_email_log","kpi_summary_cache"]){
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(preserved)),true,`${preserved} must remain`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM jobs").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM invoices").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM partners").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM job_handoffs").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM direct_expenses").get().c,0);
  assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=\'final_compliance_schema_version\'").get().setting_value,"4");
  assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=\'workshop_ux_schema_version\'").get().setting_value,"5");
  assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=\'admin_ux_schema_version\'").get().setting_value,"6");
  assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=\'ui_default_theme\'").get().setting_value,"dark");
  assert.equal(db.prepare("SELECT theme_preference FROM users WHERE id='U1'").get().theme_preference,"dark");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM intake_catalog_items").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM intake_assessment_items").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM workflow_stage_definitions").get().c,5);
  assert.equal(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=\'ui_default_language\'").get().setting_value,"en");
  assert.equal(db.pragma("foreign_key_check").length,0);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type IN ('trigger','view')").get().c,0,"legacy triggers/views must be retired before structural migration");
  db.close();
  const backups=fs.readdirSync(backupDir);
  assert.ok(backups.some(name=>name.startsWith("round1-pre-migration-")),"Round 1 safety backup missing");
  assert.ok(backups.some(name=>name.startsWith("round3-pre-migration-")),"Round 3 safety backup missing");
  assert.ok(backups.some(name=>name.startsWith("final-compliance-pre-migration-")),"Final compliance safety backup missing");
  assert.ok(backups.some(name=>name.startsWith("workshop-ux-v5-pre-migration-")),"Workshop UX v5 safety backup missing");
  assert.ok(backups.some(name=>name.startsWith("admin-ux-v6-pre-migration-")),"Admin UX v6 safety backup missing");
  console.log("Final six-module migration smoke passed");
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}

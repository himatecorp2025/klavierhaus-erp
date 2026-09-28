"use strict";

const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");

const root=path.resolve(__dirname,"../..");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"kh-round1-migration-"));
const dbPath=path.join(temp,"legacy.sqlite");
const backupDir=path.join(temp,"backups");
const env={...process.env,DB_PATH:dbPath,BACKUP_DIR:backupDir,JWT_SECRET:"round1-migration-test-secret-1234567890"};

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
  `);
  legacy.prepare("INSERT INTO users(id,name,email,password_hash,role,status,contact_email,hidden_user,is_superadmin) VALUES(?,?,?,?,?,'Active',?,0,0)")
    .run("U1","Round One Admin","admin@example.com",bcrypt.hashSync("Round1Pass!",4),"ADMIN","admin@example.com");
  legacy.prepare("INSERT INTO contacts(id,name,email,phone,address,notes) VALUES('C-1','Legacy Client','legacy@example.com','212-555-0100','New York','Important customer')").run();
  legacy.prepare("INSERT INTO pianos(id,brand,model,serial_no,finish,location,owner_contact_id) VALUES('P-1','Steinway & Sons','B-211','123456','Ebony','Client home','C-1')").run();
  legacy.prepare("INSERT INTO client_pianos(id,client_id,piano_id) VALUES('CP-1','C-1','P-1')").run();
  legacy.close();

  run("ROUND1_LEGACY_MIGRATION");
  run("ROUND1_IDEMPOTENT");

  const db=new Database(dbPath,{readonly:true});
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients").get().c,1);
  assert.equal(db.prepare("SELECT name,email FROM clients").get().name,"Legacy Client");
  const piano=db.prepare("SELECT p.*,c.name client_name FROM pianos p JOIN clients c ON c.id=p.client_id").get();
  assert.equal(piano.brand,"Steinway & Sons");
  assert.equal(piano.serial_number,"123456");
  assert.equal(piano.client_name,"Legacy Client");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM intake_leads").get().c,0);
  for(const retired of ["contacts","client_pianos","planned_jobs","inventory_items","wf2_workflows","financial_items","invoices"]){
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(retired)),false,`${retired} should be retired`);
  }
  for(const preserved of ["users","events","website_content_pages","website_showroom_pianos","website_services","website_artists","website_media","jobs"]){
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(preserved)),true,`${preserved} must remain`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM jobs").get().c,0);
  assert.equal(db.pragma("foreign_key_check").length,0);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
  db.close();
  assert.ok(fs.readdirSync(backupDir).some(name=>name.startsWith("round1-pre-migration-")),"safety backup missing");
  console.log("Round 1 + Round 2 migration smoke passed");
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}

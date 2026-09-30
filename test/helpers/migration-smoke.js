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

function run(label,options={}){
  const runEnv={...env,...(options.env||{})};
  const result=spawnSync(process.execPath,[path.join(root,"server","init-db.js")],{cwd:root,env:runEnv,encoding:"utf8"});
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
    CREATE TABLE inventory_items(id TEXT PRIMARY KEY,name TEXT,qty REAL);
    INSERT INTO inventory_items(id,name,qty) VALUES('LEGACY-INV-1','Legacy felt',12);
    CREATE TABLE invoices(id INTEGER PRIMARY KEY,total_amount REAL,status TEXT);
    CREATE TABLE invoice_credit_memos(id INTEGER PRIMARY KEY,invoice_id INTEGER);
    CREATE TRIGGER trg_invoice_credit_memos_immutable_update
    BEFORE UPDATE ON invoice_credit_memos
    BEGIN
      SELECT CASE WHEN (SELECT i.revenue_recognition_status FROM invoices i WHERE i.id=NEW.invoice_id)='DEFERRED'
        THEN RAISE(ABORT,'IMMUTABLE_CREDIT_MEMO') END;
    END;
    CREATE TABLE private_appointments (
      id TEXT PRIMARY KEY,
      appointment_type TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      note TEXT,
      piano_id TEXT,
      service_id TEXT,
      status TEXT NOT NULL DEFAULT 'SCHEDULED',
      assigned_user_id TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      source_path TEXT,
      created_source TEXT NOT NULL DEFAULT 'PUBLIC',
      created_by_user_id TEXT,
      completed_at TEXT,
      cancelled_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO private_appointments(id,appointment_type,name,phone,scheduled_at,note,status,language,created_source)
      VALUES('PA-LEGACY-1','PRIVATE_VISIT','Legacy Appointment','212-555-0199','2031-05-10T14:00:00.000Z','Preserve me','SCHEDULED','en','PUBLIC');
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
  {
    const migrated=new Database(dbPath);
    const columns=migrated.prepare("PRAGMA table_info(inventory_items)").all().map(row=>row.name);
    assert.ok(columns.includes("sku"),"canonical inventory_items.sku missing after legacy retirement");
    assert.ok(columns.includes("quantity_on_hand"),"canonical inventory_items.quantity_on_hand missing after legacy retirement");
    assert.equal(migrated.prepare("SELECT COUNT(*) c FROM inventory_items").get().c,0,"legacy inventory rows must not leak into the canonical stock catalog");
    const appointmentColumns=migrated.prepare("PRAGMA table_info(private_appointments)").all().map(row=>row.name);
    assert.ok(appointmentColumns.includes("scheduled_end_at"),"legacy private_appointments.scheduled_end_at must be added before schema indexes");
    assert.ok(appointmentColumns.includes("conversation_id"),"legacy private_appointments.conversation_id must be added before schema indexes");
    assert.ok(appointmentColumns.includes("email"),"legacy private_appointments.email must be added");
    assert.ok(appointmentColumns.includes("duration_min"),"legacy private_appointments.duration_min must be added");
    assert.equal(migrated.prepare("SELECT duration_min FROM private_appointments WHERE id='PA-LEGACY-1'").get().duration_min,60,"legacy appointments must receive the 60-minute default");
    assert.equal(migrated.prepare("SELECT name FROM private_appointments WHERE id='PA-LEGACY-1'").get().name,"Legacy Appointment","legacy appointment data must survive Messenger migration");
    assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_private_appointments_conversation'").get(),"Messenger private appointment index must exist");
    migrated.prepare(`INSERT INTO inventory_items(sku,name_en,name_hu,unit,quantity_on_hand,reorder_point,reorder_quantity,unit_cost,active)
      VALUES('INV-SENTINEL','Migration sentinel','Migrációs sentinel','pcs',7,2,4,1.5,1)`).run();
    migrated.close();
  }
  run("FINAL_IDEMPOTENT");

  const db=new Database(dbPath,{readonly:true});
  assert.equal(db.prepare("SELECT COUNT(*) c FROM clients").get().c,1);
  assert.equal(db.prepare("SELECT name,email FROM clients").get().name,"Legacy Client");
  const piano=db.prepare("SELECT p.*,c.name client_name FROM pianos p JOIN clients c ON c.id=p.client_id").get();
  assert.equal(piano.brand,"Steinway & Sons");
  assert.equal(piano.serial_number,"123456");
  assert.equal(piano.client_name,"Legacy Client");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM intake_leads").get().c,0);
  for(const retired of ["contacts","client_pianos","planned_jobs","wf2_workflows","financial_items","legacy_fk_parent","legacy_fk_child","_inventory_legacy_items"]){
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(retired)),false,`${retired} should be retired`);
  }
  for(const preserved of ["users","events","website_content_pages","website_showroom_pianos","website_services","website_artists","website_media","intake_catalog_items","intake_assessment_items","private_appointments","private_appointment_requests","customer_appointment_proposals","inventory_items","handoff_preset_materials","purchase_requests","job_material_usage","inventory_movements","jobs","workflow_stage_definitions","job_workflow_phases","job_handoffs","partners","partner_contractors","invoice_sequences","invoices","invoice_items","invoice_payments","direct_expenses","invoice_email_log","kpi_summary_cache"]){
    assert.equal(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(preserved)),true,`${preserved} must remain`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM jobs").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM invoices").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM partners").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM job_handoffs").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM direct_expenses").get().c,0);
  const inventorySentinel=db.prepare("SELECT * FROM inventory_items WHERE sku='INV-SENTINEL'").get();
  assert.equal(inventorySentinel.quantity_on_hand,7,"canonical inventory data must survive idempotent init-db runs");
  assert.equal(inventorySentinel.reorder_point,2);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM purchase_requests").get().c,0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM inventory_movements").get().c,0);
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
  assert.ok(backups.some(name=>name.startsWith("messenger-v12-pre-migration-")),"Messenger v12 safety backup missing");

  // Reproduce the Render production shape that already has clients/is_vip but
  // predates the new client_type column. Schema indexes must not run before
  // the compatibility column is added.
  const prodDbPath=path.join(temp,"render-production-like.sqlite");
  const prodBackupDir=path.join(temp,"render-production-like-backups");
  const prod=new Database(prodDbPath);
  prod.exec(`
    PRAGMA foreign_keys=OFF;
    CREATE TABLE app_settings(setting_key TEXT PRIMARY KEY,setting_value TEXT,updated_by TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE clients(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      notes TEXT,
      preferred_language TEXT NOT NULL DEFAULT 'en',
      is_vip INTEGER NOT NULL DEFAULT 0 CHECK(is_vip IN (0,1)),
      vip_updated_by_user_id TEXT,
      vip_updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO clients(name,email,phone,is_vip) VALUES('Render Legacy Client','render.legacy@example.com','212-555-0111',1);
  `);
  prod.close();
  run("RENDER_CLIENT_TYPE_COMPATIBILITY",{env:{DB_PATH:prodDbPath,BACKUP_DIR:prodBackupDir}});
  const prodMigrated=new Database(prodDbPath,{readonly:true});
  const prodClientColumns=prodMigrated.prepare("PRAGMA table_info(clients)").all().map(row=>row.name);
  assert.ok(prodClientColumns.includes("client_type"),"production clients.client_type must be added before schema indexes");
  assert.equal(prodMigrated.prepare("SELECT client_type,is_vip FROM clients WHERE email='render.legacy@example.com'").get().client_type,"INDIVIDUAL");
  assert.equal(prodMigrated.prepare("SELECT client_type,is_vip FROM clients WHERE email='render.legacy@example.com'").get().is_vip,1);
  assert.ok(prodMigrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_clients_client_type'").get(),"client_type index must exist after production compatibility migration");
  assert.equal(Boolean(prodMigrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_clients_customer_type'").get()),false,"retired customer_type index must be absent");
  prodMigrated.close();

  console.log("Final six-module migration smoke passed");
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}

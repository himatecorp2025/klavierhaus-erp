"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus_v6.sqlite");
const backupDir = process.env.BACKUP_DIR || path.join(__dirname, "backups");
const canonicalSchemaSql=fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = OFF");

function tableExists(name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}
function columns(name) {
  return tableExists(name) ? new Set(db.prepare(`PRAGMA table_info("${String(name).replaceAll('"','""')}")`).all().map(row => row.name)) : new Set();
}
function quoteName(name) {
  return `"${String(name).replaceAll('"','""')}"`;
}
function setting(key) {
  if (!tableExists("app_settings")) return null;
  return db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get(key)?.setting_value ?? null;
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at)
    VALUES(?,?, 'SYSTEM', CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by='SYSTEM',updated_at=CURRENT_TIMESTAMP`).run(key, String(value));
}
function preMigrationBackup() {
  if (!fs.existsSync(dbPath) || setting("round1_core_migration_complete") === "1") return null;
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch (_error) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `round1-pre-migration-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, target);
  console.log(`[ROUND1] Safety backup created: ${target}`);
  return target;
}
function round3MigrationBackup() {
  if (!fs.existsSync(dbPath) || !tableExists("app_settings") || setting("round3_finance_migration_complete") === "1") return null;
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch (_error) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `round3-pre-migration-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, target);
  console.log(`[ROUND3] Safety backup created: ${target}`);
  return target;
}
function finalComplianceBackup() {
  if (!fs.existsSync(dbPath) || !tableExists("app_settings") || setting("final_compliance_migration_complete") === "1") return null;
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch (_error) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `final-compliance-pre-migration-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, target);
  console.log(`[COMPLIANCE] Safety backup created: ${target}`);
  return target;
}
function workshopUxV5Backup() {
  if (!fs.existsSync(dbPath) || !tableExists("app_settings") || setting("workshop_ux_schema_version") === "5") return null;
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch (_error) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `workshop-ux-v5-pre-migration-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, target);
  console.log(`[WORKSHOP-V5] Safety backup created: ${target}`);
  return target;
}
function adminUxV6Backup() {
  if (!fs.existsSync(dbPath) || !tableExists("app_settings") || setting("admin_ux_schema_version") === "6") return null;
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch (_error) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `admin-ux-v6-pre-migration-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, target);
  console.log(`[ADMIN-V6] Safety backup created: ${target}`);
  return target;
}
function messengerV12NeedsCompatibilityMigration() {
  return (tableExists("private_appointments") &&
      (!columns("private_appointments").has("scheduled_end_at") || !columns("private_appointments").has("conversation_id"))) ||
    (tableExists("intake_leads") && !columns("intake_leads").has("source_conversation_id"));
}
function messengerV12Backup() {
  if (!fs.existsSync(dbPath) || !messengerV12NeedsCompatibilityMigration()) return null;
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch (_error) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `messenger-v12-pre-migration-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, target);
  console.log(`[MESSENGER-V12] Safety backup created: ${target}`);
  return target;
}
function prepareMessengerV12Compatibility() {
  if (tableExists("intake_leads")) ensureColumn("intake_leads","source_conversation_id","TEXT");
  if (tableExists("private_appointments")) {
    ensureColumn("private_appointments","scheduled_end_at","TEXT");
    ensureColumn("private_appointments","conversation_id","TEXT");
  }
}
function ensureColumn(table, name, definition) {
  if (tableExists(table) && !columns(table).has(name)) db.exec(`ALTER TABLE ${quoteName(table)} ADD COLUMN ${quoteName(name)} ${definition}`);
}
function legacyValue(row, ...names) {
  for (const name of names) if (row && row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") return row[name];
  return null;
}
function numericId(value) {
  const id=Number(value);
  return Number.isSafeInteger(id)&&id>0?id:null;
}
function jsonArray(value) {
  if(Array.isArray(value))return JSON.stringify(value);
  try {
    const parsed=JSON.parse(String(value||"[]"));
    return JSON.stringify(Array.isArray(parsed)?parsed:[]);
  } catch (_error) { return "[]"; }
}
function normalizePaymentMethod(value) {
  const raw=String(value||"").trim().toLowerCase();
  if(!raw)return null;
  if(raw.includes("cash"))return "Cash";
  if(raw.includes("card")||raw.includes("stripe"))return "Credit Card / Stripe";
  if(raw.includes("check"))return "Check";
  return "Bank Transfer";
}
function mappedStage(row) {
  const raw=String(legacyValue(row,"stage","status")||"planned").toLowerCase();
  if(raw==="planned")return "planned";
  if(["scheduled","received"].includes(raw))return "received";
  if(["in_progress","blocked"].includes(raw))return "in_progress";
  if(raw==="qa_review")return "qa_review";
  if(["ready_for_closeout","admin_approval"].includes(raw))return "admin_approval";
  if(raw==="completed"||legacyValue(row,"closed_at","completed_at"))return "completed";
  return "planned";
}
function mappedInvoiceStatus(row) {
  const raw=String(row?.status||"draft").toLowerCase();
  if(raw==="paid")return "paid";
  if(["void","cancelled","canceled"].includes(raw))return "cancelled";
  if(["sent","partial"].includes(raw))return "sent";
  return "draft";
}

function dropLegacyDerivedSchemaObjects() {
  const objects=db.prepare(`SELECT type,name FROM sqlite_master
    WHERE type IN ('trigger','view') AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'trigger' THEN 0 ELSE 1 END,name`).all();
  let triggers=0,views=0;
  for(const object of objects){
    if(object.type==="trigger"){
      db.exec(`DROP TRIGGER IF EXISTS ${quoteName(object.name)}`);
      triggers+=1;
    }else if(object.type==="view"){
      db.exec(`DROP VIEW IF EXISTS ${quoteName(object.name)}`);
      views+=1;
    }
  }
  if(triggers||views)console.log(`[COMPLIANCE] Retired legacy derived schema objects before table migration: triggers=${triggers}, views=${views}`);
}

preMigrationBackup();
round3MigrationBackup();
finalComplianceBackup();
workshopUxV5Backup();
adminUxV6Backup();
messengerV12Backup();
dropLegacyDerivedSchemaObjects();

const legacyPianoColumns = columns("pianos");
const legacyPianosDetected = tableExists("pianos") && (!legacyPianoColumns.has("client_id") || legacyPianoColumns.has("owner_contact_id") || legacyPianoColumns.has("serial_no"));
if (legacyPianosDetected) {
  if (tableExists("_round1_legacy_pianos")) db.exec('DROP TABLE "_round1_legacy_pianos"');
  db.exec('ALTER TABLE "pianos" RENAME TO "_round1_legacy_pianos"');
  console.log("[ROUND1] Legacy pianos table isolated for migration");
}

const complianceReady =
  (!tableExists("intake_leads") || columns("intake_leads").has("media_urls")) &&
  (!tableExists("jobs") || columns("jobs").has("stage")) &&
  (!tableExists("invoices") || columns("invoices").has("subtotal_labor")) &&
  (!tableExists("invoice_items") || columns("invoice_items").has("item_type"));

function isolateForCompliance(name) {
  if (!tableExists(name)) return;
  const legacyName = `_final_legacy_${name}`;
  if (tableExists(legacyName)) db.exec(`DROP TABLE ${quoteName(legacyName)}`);
  db.exec(`ALTER TABLE ${quoteName(name)} RENAME TO ${quoteName(legacyName)}`);
  console.log(`[COMPLIANCE] Legacy ${name} table isolated for migration`);
}

if (setting("final_compliance_migration_complete") !== "1" && !complianceReady) {
  for (const name of ["invoice_payments","invoice_items","invoices","jobs","intake_leads"]) isolateForCompliance(name);
}

const dynamicWorkflowNeedsMigration =
  tableExists("workflow_stage_definitions") &&
  (!columns("workflow_stage_definitions").has("active") || !columns("job_workflow_phases").has("stage_key"));
if(dynamicWorkflowNeedsMigration){
  if(tableExists("_dynamic_legacy_job_workflow_phases"))db.exec('DROP TABLE "_dynamic_legacy_job_workflow_phases"');
  if(tableExists("_dynamic_legacy_workflow_stage_definitions"))db.exec('DROP TABLE "_dynamic_legacy_workflow_stage_definitions"');
  if(tableExists("job_workflow_phases"))db.exec('ALTER TABLE "job_workflow_phases" RENAME TO "_dynamic_legacy_job_workflow_phases"');
  if(tableExists("workflow_stage_definitions"))db.exec('ALTER TABLE "workflow_stage_definitions" RENAME TO "_dynamic_legacy_workflow_stage_definitions"');
  console.log("[WORKFLOW-DYNAMIC] Legacy five-stage workflow tables isolated");
}
const inventoryCatalogNeedsMigration=tableExists("inventory_items")&&(!columns("inventory_items").has("sku")||!columns("inventory_items").has("quantity_on_hand")||!columns("inventory_items").has("reorder_point"));
if(inventoryCatalogNeedsMigration){
  if(tableExists("_inventory_legacy_items"))db.exec('DROP TABLE "_inventory_legacy_items"');
  db.exec('ALTER TABLE "inventory_items" RENAME TO "_inventory_legacy_items"');
  console.log("[INVENTORY] Legacy inventory_items table isolated before canonical inventory schema creation");
}
const archiveCategoryNeedsMigration=tableExists("document_archive")&&!String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='document_archive'").get()?.sql||"").includes("financial_document");
if(archiveCategoryNeedsMigration){
  if(tableExists("_documents_legacy_archive"))db.exec('DROP TABLE "_documents_legacy_archive"');
  db.exec('ALTER TABLE "document_archive" RENAME TO "_documents_legacy_archive"');
  console.log("[DOCUMENTS] Legacy archive category table isolated");
}
// Existing production databases already have private_appointments/intake_leads.
// Add Messenger v12 columns before schema.sql creates indexes that depend on them.
prepareMessengerV12Compatibility();
db.exec(canonicalSchemaSql);
if(tableExists("_documents_legacy_archive")){
  db.exec(`INSERT INTO document_archive(id,category,title,description,entity_type,entity_id,original_name,stored_name,mime_type,size_bytes,file_path,metadata_json,archived_by_user_id,archived_at,created_at)
    SELECT id,category,title,description,entity_type,entity_id,original_name,stored_name,mime_type,size_bytes,file_path,metadata_json,archived_by_user_id,archived_at,created_at FROM _documents_legacy_archive`);
  db.exec('DROP TABLE "_documents_legacy_archive"');
  db.exec("CREATE INDEX IF NOT EXISTS idx_document_archive_category_time ON document_archive(category,archived_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_document_archive_entity ON document_archive(entity_type,entity_id)");
  console.log("[DOCUMENTS] Archive categories migrated");
}

// schema.sql enables FK enforcement for normal runtime use. The migration must keep
// it disabled until all legacy parent/child tables have been retired, otherwise
// DROP TABLE on an obsolete parent can fire SQLite's FK constraint triggers.
db.pragma("foreign_keys = OFF");

ensureColumn("clients","preferred_language","TEXT NOT NULL DEFAULT 'en' CHECK(preferred_language IN ('en','hu'))");
ensureColumn("clients","client_type","TEXT NOT NULL DEFAULT 'PRIVATE' CHECK(client_type IN ('PRIVATE','BUSINESS','INSTITUTION'))");
ensureColumn("clients","is_vip","INTEGER NOT NULL DEFAULT 0 CHECK(is_vip IN (0,1))");
ensureColumn("clients","vip_updated_by_user_id","TEXT");
ensureColumn("clients","vip_updated_at","TEXT");
ensureColumn("users","theme_preference","TEXT NOT NULL DEFAULT 'dark' CHECK(theme_preference IN ('dark','light'))");
ensureColumn("intake_leads","estimated_total","REAL NOT NULL DEFAULT 0 CHECK(estimated_total >= 0)");
ensureColumn("intake_leads","source_conversation_id","TEXT");
ensureColumn("customer_conversations","client_id","INTEGER");
ensureColumn("private_appointments","scheduled_end_at","TEXT");
ensureColumn("private_appointments","conversation_id","TEXT");
ensureColumn("private_appointments","client_id","INTEGER");
ensureColumn("private_appointment_requests","client_id","INTEGER");
ensureColumn("private_appointments","email","TEXT");
ensureColumn("private_appointments","duration_min","INTEGER NOT NULL DEFAULT 60 CHECK(duration_min >= 15 AND duration_min <= 480)");
ensureColumn("customer_appointment_proposals","expires_at","TEXT");
ensureColumn("customer_appointment_proposals","finalized_at","TEXT");
ensureColumn("customer_appointment_proposals","finalized_by_user_id","TEXT");
ensureColumn("jobs","estimated_revenue","REAL NOT NULL DEFAULT 0 CHECK(estimated_revenue >= 0)");
ensureColumn("jobs","workflow_stage_key","TEXT");
ensureColumn("jobs","workflow_owner_user_id","TEXT");
ensureColumn("jobs","completion_document_id","INTEGER");
ensureColumn("job_workflow_phases","starts_at","TEXT");
ensureColumn("job_workflow_phases","responsible_user_id","TEXT");
ensureColumn("job_handoffs","phase_duration_min","INTEGER NOT NULL DEFAULT 0 CHECK(phase_duration_min >= 0)");
ensureColumn("job_handoffs","billing_description","TEXT");
db.prepare("UPDATE jobs SET workflow_owner_user_id=COALESCE(workflow_owner_user_id,created_by_user_id) WHERE workflow_owner_user_id IS NULL").run();
db.prepare(`UPDATE job_workflow_phases SET responsible_user_id=COALESCE(responsible_user_id,(SELECT created_by_user_id FROM jobs WHERE jobs.id=job_workflow_phases.job_id))
  WHERE responsible_user_id IS NULL`).run();
db.prepare(`UPDATE job_workflow_phases SET starts_at=COALESCE(starts_at,(SELECT scheduled_at FROM jobs WHERE jobs.id=job_workflow_phases.job_id))
  WHERE stage_key='received' AND starts_at IS NULL`).run();
if(tableExists("handoff_presets")&&Number(db.prepare("SELECT COUNT(*) count FROM handoff_presets").get()?.count||0)===0){
  const seed=db.prepare("INSERT INTO handoff_presets(title_en,title_hu,default_labor_cost,default_material_cost,default_duration_min,active,sort_order) VALUES(?,?,?,?,?,1,?)");
  [
    ["Tuning","Hangolás",220,0,90,10],
    ["Regulation","Mechanika szabályozás",450,45,180,20],
    ["String replacement","Húrcsere",120,35,60,30],
    ["Voicing","Intonálás",300,15,120,40]
  ].forEach(row=>seed.run(...row));
}

ensureColumn("website_services","gallery_json","TEXT NOT NULL DEFAULT '[]'");
ensureColumn("invoices","deleted_at","TEXT");
ensureColumn("invoices","deleted_by_user_id","TEXT");
ensureColumn("invoices","service_date","TEXT");
ensureColumn("invoices","snapshot_json","TEXT NOT NULL DEFAULT '{}'");
ensureColumn("invoices","payment_url","TEXT");
ensureColumn("invoice_items","labor_amount","REAL NOT NULL DEFAULT 0");
ensureColumn("invoice_items","material_amount","REAL NOT NULL DEFAULT 0");
ensureColumn("invoice_items","phase_key","TEXT");
ensureColumn("invoices","archive_document_id","INTEGER");
ensureColumn("invoices","issued_document_id","INTEGER");

function seedWorkshopUxV5() {
  if (!tableExists("workflow_stage_definitions") || !tableExists("job_workflow_phases")) return;
  const stageRows = [
    ["received",1,"Received / Scheduled","Beérkezett / Ütemezve","start",0],
    ["in_progress",2,"In Progress","Folyamatban","intermediate",0],
    ["qa_review",3,"QA / Handoff","Minőségellenőrzés / Átadás","intermediate",0],
    ["admin_approval",4,"Admin Approval","Admin jóváhagyás","approval",0],
    ["completed",5,"Completed","Lezárva","completed",0]
  ];
  const insertStage=db.prepare(`INSERT OR IGNORE INTO workflow_stage_definitions(stage_key,position,label_en,label_hu,stage_type,active,removable,updated_at)
    VALUES(?,?,?,?,?,1,?,CURRENT_TIMESTAMP)`);
  stageRows.forEach(row=>insertStage.run(...row));

  if(tableExists("_dynamic_legacy_workflow_stage_definitions")){
    const legacyStages=db.prepare("SELECT stage_key,position,label_en,label_hu,updated_by_user_id,updated_at FROM _dynamic_legacy_workflow_stage_definitions ORDER BY position").all();
    const upsert=db.prepare(`INSERT INTO workflow_stage_definitions(stage_key,position,label_en,label_hu,stage_type,active,removable,updated_by_user_id,updated_at)
      VALUES(?,?,?,?,?,1,0,?,?)
      ON CONFLICT(stage_key) DO UPDATE SET label_en=excluded.label_en,label_hu=excluded.label_hu,updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at`);
    for(const row of legacyStages){
      const type=row.stage_key==="received"?"start":row.stage_key==="admin_approval"?"approval":row.stage_key==="completed"?"completed":"intermediate";
      upsert.run(row.stage_key,row.position,row.label_en,row.label_hu,type,row.updated_by_user_id,row.updated_at);
    }
  }

  const insertPhase=db.prepare(`INSERT OR IGNORE INTO job_workflow_phases(job_id,stage_key,position,enabled,due_at,blocker_code,blocker_note,activated_at,completed_at,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  if(tableExists("_dynamic_legacy_job_workflow_phases")){
    for(const row of db.prepare("SELECT * FROM _dynamic_legacy_job_workflow_phases ORDER BY job_id,position,id").all()){
      insertPhase.run(row.job_id,row.stage_key,row.position,row.enabled,row.due_at,row.blocker_code,row.blocker_note,row.activated_at,row.completed_at,row.created_at,row.updated_at);
    }
  }

  const jobs=db.prepare("SELECT id,stage,workflow_stage_key,created_at,completed_at,cancelled_at FROM jobs ORDER BY id").all();
  const activeStages=db.prepare("SELECT stage_key,position FROM workflow_stage_definitions WHERE active=1 ORDER BY position").all();
  const phaseInsert=db.prepare(`INSERT OR IGNORE INTO job_workflow_phases(job_id,stage_key,position,enabled,activated_at,completed_at)
    VALUES(?,?,?,?,?,?)`);
  for(const job of jobs){
    if(job.stage!=="planned"&&!job.workflow_stage_key)db.prepare("UPDATE jobs SET workflow_stage_key=? WHERE id=?").run(job.stage,job.id);
    if(db.prepare("SELECT 1 FROM job_workflow_phases WHERE job_id=? LIMIT 1").get(job.id))continue;
    const logical=job.workflow_stage_key||job.stage,currentIndex=activeStages.findIndex(item=>item.stage_key===logical);
    for(const row of activeStages){
      const index=activeStages.findIndex(item=>item.stage_key===row.stage_key);
      const done=logical==="completed"||(currentIndex>=0&&index<currentIndex);
      const active=logical===row.stage_key||done;
      phaseInsert.run(job.id,row.stage_key,row.position,1,active?(job.created_at||new Date().toISOString()):null,done?(job.completed_at||job.created_at||new Date().toISOString()):null);
    }
  }

  if(tableExists("_dynamic_legacy_job_workflow_phases"))db.exec('DROP TABLE "_dynamic_legacy_job_workflow_phases"');
  if(tableExists("_dynamic_legacy_workflow_stage_definitions"))db.exec('DROP TABLE "_dynamic_legacy_workflow_stage_definitions"');
  setSetting("workflow_dynamic_schema_version","1");
}

db.prepare(`INSERT OR IGNORE INTO app_settings(setting_key,setting_value,updated_by) VALUES
  ('company_name','Klavierhaus','SYSTEM'),
  ('short_name','KH ERP','SYSTEM'),
  ('logo_url','/icons/icon-512.png','SYSTEM'),
  ('login_background_url','','SYSTEM'),
  ('branding_version','1','SYSTEM')`).run();

const defaultCategories = [
  ["EVC-PIANO-CONCERT","PIANO_CONCERT","Piano Concert","Zongorahangverseny",10],
  ["EVC-ARTIST-PERFORMANCE","ARTIST_PERFORMANCE","Artist Performance","Művészi előadás",20],
  ["EVC-SALON-CONCERT","SALON_CONCERT","Salon Concert","Szalonkoncert",30],
  ["EVC-MASTERCLASS","MASTERCLASS","Masterclass","Mesterkurzus",40],
  ["EVC-CULTURAL-EVENT","CULTURAL_EVENT","Cultural Event","Kulturális esemény",50],
  ["EVC-OTHER-MUSICAL","OTHER_MUSICAL_EVENT","Other Musical Event","Egyéb zenei esemény",60]
];
const insertCategory = db.prepare("INSERT OR IGNORE INTO event_categories(id,code,name_en,name_hu,sort_order) VALUES(?,?,?,?,?)");
defaultCategories.forEach(row => insertCategory.run(...row));

function migrateLegacyMasterData() {
  if (!tableExists("contacts") && !tableExists("_round1_legacy_pianos")) return;
  db.exec("CREATE TABLE IF NOT EXISTS _round1_client_map(legacy_id TEXT PRIMARY KEY,new_id INTEGER NOT NULL)");

  const insertClient = db.prepare("INSERT INTO clients(name,email,phone,address,notes,created_at) VALUES(?,?,?,?,?,?)");
  const mapClient = db.prepare("INSERT OR IGNORE INTO _round1_client_map(legacy_id,new_id) VALUES(?,?)");
  if (tableExists("contacts")) {
    for (const row of db.prepare("SELECT * FROM contacts ORDER BY rowid").all()) {
      const legacyId = String(row.id ?? "");
      if (!legacyId || db.prepare("SELECT 1 FROM _round1_client_map WHERE legacy_id=?").get(legacyId)) continue;
      const name = String(legacyValue(row,"name","company") || "Legacy client").trim();
      const info = insertClient.run(
        name,
        legacyValue(row,"email"),
        legacyValue(row,"phone"),
        legacyValue(row,"address","billing_address"),
        [legacyValue(row,"relationship_notes","notes"), `Migrated from legacy client ${legacyId}`].filter(Boolean).join("\n"),
        legacyValue(row,"created_at") || new Date().toISOString()
      );
      mapClient.run(legacyId, Number(info.lastInsertRowid));
    }
  }

  let fallbackClientId = null;
  const ensureFallback = () => {
    if (fallbackClientId) return fallbackClientId;
    const existing = db.prepare("SELECT id FROM clients WHERE name='Legacy unassigned piano owner' ORDER BY id LIMIT 1").get();
    if (existing) return (fallbackClientId = Number(existing.id));
    fallbackClientId = Number(insertClient.run("Legacy unassigned piano owner",null,null,null,"Automatically created during Round 1 migration.",new Date().toISOString()).lastInsertRowid);
    return fallbackClientId;
  };

  if (tableExists("_round1_legacy_pianos")) {
    const pianoRows = db.prepare('SELECT * FROM "_round1_legacy_pianos" ORDER BY rowid').all();
    const insertPiano = db.prepare(`INSERT INTO pianos(client_id,brand,model,serial_number,finish,location_notes,last_serviced_at,created_at)
      VALUES(?,?,?,?,?,?,?,?)`);
    for (const row of pianoRows) {
      let legacyClientId = legacyValue(row,"owner_contact_id","client_id");
      if (!legacyClientId && tableExists("client_pianos")) {
        legacyClientId = db.prepare("SELECT client_id FROM client_pianos WHERE piano_id=? ORDER BY rowid LIMIT 1").get(row.id)?.client_id || null;
      }
      const clientId = legacyClientId ? db.prepare("SELECT new_id FROM _round1_client_map WHERE legacy_id=?").get(String(legacyClientId))?.new_id : null;
      insertPiano.run(
        Number(clientId || ensureFallback()),
        String(legacyValue(row,"brand") || "Unknown").trim(),
        legacyValue(row,"model"),
        legacyValue(row,"serial_number","serial_no"),
        legacyValue(row,"finish"),
        [legacyValue(row,"location_notes","location"),legacyValue(row,"notes")].filter(Boolean).join("\n") || null,
        legacyValue(row,"last_serviced_at","last_service_date"),
        legacyValue(row,"created_at") || new Date().toISOString()
      );
    }
  }
}


function migrateFinalComplianceData() {
  if (tableExists("_final_legacy_intake_leads")) {
    const insert=db.prepare(`INSERT OR IGNORE INTO intake_leads(id,client_id,piano_id,raw_client_name,raw_contact,service_location,reported_issue,media_urls,estimated_urgency,status,assigned_technician_id,created_at,converted_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of db.prepare('SELECT * FROM "_final_legacy_intake_leads" ORDER BY rowid').all()) {
      const id=numericId(row.id); if(!id) continue;
      const status=["new","under_review","converted","archived"].includes(String(row.status||""))?String(row.status):"new";
      insert.run(id,numericId(row.client_id),numericId(row.piano_id),legacyValue(row,"raw_client_name"),legacyValue(row,"raw_contact"),
        ["workshop","on_site"].includes(String(row.service_location))?row.service_location:"workshop",String(legacyValue(row,"reported_issue")||"Migrated intake"),
        jsonArray(row.media_urls),["low","normal","urgent"].includes(String(row.estimated_urgency))?row.estimated_urgency:"normal",status,legacyValue(row,"assigned_technician_id"),
        legacyValue(row,"created_at")||new Date().toISOString(),legacyValue(row,"converted_at"),legacyValue(row,"updated_at")||legacyValue(row,"created_at")||new Date().toISOString());
    }
  }

  if (tableExists("_final_legacy_jobs")) {
    const insert=db.prepare(`INSERT OR IGNORE INTO jobs(id,job_code,client_id,piano_id,intake_id,title,description,location_type,site_address,scheduled_at,estimated_duration_min,stage,assigned_technician_id,total_labor_cost,total_material_cost,internal_notes,cancelled_at,cancelled_by_user_id,cancelled_by_name,cancelled_by_party,cancel_reason,completed_at,completed_by_user_id,completed_by_name,created_by_user_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of db.prepare('SELECT * FROM "_final_legacy_jobs" ORDER BY rowid').all()) {
      const id=numericId(row.id),clientId=numericId(row.client_id),pianoId=numericId(row.piano_id); if(!id||!clientId||!pianoId) continue;
      const scheduledAt=legacyValue(row,"scheduled_at","scheduled_start");
      let duration=Number(legacyValue(row,"estimated_duration_min")||0);
      if(!(duration>0)&&scheduledAt&&row.scheduled_end){const delta=(new Date(row.scheduled_end).getTime()-new Date(scheduledAt).getTime())/60000;if(Number.isFinite(delta)&&delta>0)duration=Math.round(delta);}
      if(!(duration>0))duration=120;
      const stage=mappedStage(row);
      const completedAt=stage==="completed"?(legacyValue(row,"completed_at","closed_at")||new Date().toISOString()):null;
      const completedUser=stage==="completed"?legacyValue(row,"completed_by_user_id","closed_by_user_id"):null;
      const completedName=completedUser?db.prepare("SELECT name FROM users WHERE id=?").get(completedUser)?.name||null:legacyValue(row,"completed_by_name");
      const blockedNote=String(row.status||"")==="blocked"&&row.blocked_reason?("[Legacy blocked] "+row.blocked_reason):"";
      const notes=[legacyValue(row,"internal_notes"),blockedNote].filter(Boolean).join("\n")||null;
      const location=String(legacyValue(row,"location_type","service_location")||"workshop");
      insert.run(id,legacyValue(row,"job_code"),clientId,pianoId,numericId(legacyValue(row,"intake_id","intake_lead_id")),String(legacyValue(row,"title")||"Migrated job"),legacyValue(row,"description"),
        ["workshop","on_site"].includes(location)?location:"workshop",legacyValue(row,"site_address","service_address"),scheduledAt,duration,stage,legacyValue(row,"assigned_technician_id"),
        Number(legacyValue(row,"total_labor_cost")||0),Number(legacyValue(row,"total_material_cost")||0),notes,legacyValue(row,"cancelled_at"),legacyValue(row,"cancelled_by_user_id"),legacyValue(row,"cancelled_by_name"),
        legacyValue(row,"cancelled_by_party"),legacyValue(row,"cancel_reason"),completedAt,completedUser,completedName,legacyValue(row,"created_by_user_id"),legacyValue(row,"created_at")||new Date().toISOString(),legacyValue(row,"updated_at")||legacyValue(row,"created_at")||new Date().toISOString());
    }
  }

  if (tableExists("_final_legacy_invoices")) {
    const insert=db.prepare(`INSERT OR IGNORE INTO invoices(id,invoice_number,direction,status,source_type,source_id,job_id,client_id,partner_id,counterparty_name,counterparty_contact,counterparty_email,counterparty_phone,counterparty_address,counterparty_tax_id,summary,notes,issue_date,due_date,currency,subtotal_labor,subtotal_material,subtotal_adjustment,tax_rate,tax_amount,total_amount,payment_method,paid_at,pdf_path,email_language,sent_at,sent_by_user_id,resend_message_id,cancelled_at,cancelled_by_user_id,cancel_reason,created_by_user_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const row of db.prepare('SELECT * FROM "_final_legacy_invoices" ORDER BY rowid').all()) {
      const id=numericId(row.id); if(!id) continue;
      const direction=String(row.direction||"receivable")==="payable"?"payable":"receivable";
      const total=Number(legacyValue(row,"total_amount")||0),tax=Number(legacyValue(row,"tax_amount")||0);
      const job=numericId(row.job_id)?db.prepare("SELECT * FROM jobs WHERE id=?").get(Number(row.job_id)):null;
      const labor=Number(legacyValue(row,"subtotal_labor")??job?.total_labor_cost??(direction==="receivable"?Math.max(0,total-tax):0))||0;
      const material=Number(legacyValue(row,"subtotal_material")??job?.total_material_cost??0)||0;
      const adjustment=Number(legacyValue(row,"subtotal_adjustment")??Math.round((total-labor-material-tax)*100)/100)||0;
      insert.run(id,String(row.invoice_number||("MIGRATED-"+id)),direction,mappedInvoiceStatus(row),String(row.source_type||"manual"),legacyValue(row,"source_id"),numericId(row.job_id),numericId(row.client_id),numericId(row.partner_id),
        String(legacyValue(row,"counterparty_name")||"Migrated counterparty"),legacyValue(row,"counterparty_contact"),legacyValue(row,"counterparty_email"),legacyValue(row,"counterparty_phone"),legacyValue(row,"counterparty_address"),legacyValue(row,"counterparty_tax_id"),
        String(legacyValue(row,"summary")||"Migrated invoice"),legacyValue(row,"notes"),String(legacyValue(row,"issue_date")||new Date().toISOString().slice(0,10)),String(legacyValue(row,"due_date")||legacyValue(row,"issue_date")||new Date().toISOString().slice(0,10)),String(row.currency||"USD"),
        labor,material,adjustment,Number(legacyValue(row,"tax_rate")||0),tax,total,normalizePaymentMethod(row.payment_method),legacyValue(row,"paid_at"),legacyValue(row,"pdf_path"),["en","hu"].includes(String(row.email_language))?row.email_language:"en",
        legacyValue(row,"sent_at"),legacyValue(row,"sent_by_user_id"),legacyValue(row,"resend_message_id"),legacyValue(row,"cancelled_at","voided_at"),legacyValue(row,"cancelled_by_user_id","voided_by_user_id"),legacyValue(row,"cancel_reason","void_reason"),legacyValue(row,"created_by_user_id"),
        legacyValue(row,"created_at")||new Date().toISOString(),legacyValue(row,"updated_at")||legacyValue(row,"created_at")||new Date().toISOString());
    }
  }

  if (tableExists("_final_legacy_invoice_items")) {
    const insert=db.prepare("INSERT OR IGNORE INTO invoice_items(id,invoice_id,item_type,item_description,quantity,unit_price,total_price,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?,?)");
    for (const row of db.prepare('SELECT * FROM "_final_legacy_invoice_items" ORDER BY rowid').all()) {
      const id=numericId(row.id),invoiceId=numericId(row.invoice_id); if(!id||!invoiceId||!db.prepare("SELECT 1 FROM invoices WHERE id=?").get(invoiceId)) continue;
      const description=String(legacyValue(row,"item_description","description")||"Migrated item");
      const itemType=["labor","material","adjustment","other"].includes(String(row.item_type))?row.item_type:(/material|part|felt|string/i.test(description)?"material":/labor|service|tuning|regulation|voicing/i.test(description)?"labor":"other");
      insert.run(id,invoiceId,itemType,description,Number(row.quantity||1),Number(row.unit_price||0),Number(row.total_price||0),Number(row.sort_order||0),legacyValue(row,"created_at")||new Date().toISOString());
    }
  }

  if (tableExists("_final_legacy_invoice_payments")) {
    const insert=db.prepare("INSERT OR IGNORE INTO invoice_payments(id,invoice_id,amount,payment_method,reference,paid_at,notes,created_by_user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)");
    for (const row of db.prepare('SELECT * FROM "_final_legacy_invoice_payments" ORDER BY rowid').all()) {
      const id=numericId(row.id),invoiceId=numericId(row.invoice_id); if(!id||!invoiceId||!db.prepare("SELECT 1 FROM invoices WHERE id=?").get(invoiceId)) continue;
      insert.run(id,invoiceId,Number(row.amount||0),normalizePaymentMethod(row.payment_method)||"Bank Transfer",legacyValue(row,"reference"),String(legacyValue(row,"paid_at")||new Date().toISOString().slice(0,10)),legacyValue(row,"notes"),legacyValue(row,"created_by_user_id"),legacyValue(row,"created_at")||new Date().toISOString());
    }
  }
}
db.transaction(migrateLegacyMasterData)();
db.transaction(migrateFinalComplianceData)();
seedWorkshopUxV5();

const preserved=new Set(
  [...canonicalSchemaSql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)/gi)].map(match=>match[1])
);

for (const row of db.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'").all()) {
  if (row.type === "view") {
    db.exec(`DROP VIEW IF EXISTS ${quoteName(row.name)}`);
    continue;
  }
  if (!preserved.has(row.name)) db.exec(`DROP TABLE IF EXISTS ${quoteName(row.name)}`);
}

db.exec(canonicalSchemaSql);
setSetting("round1_core_migration_complete", "1");
setSetting("round1_schema_version", "1");
setSetting("round2_workflow_migration_complete", "1");
setSetting("round2_schema_version", "2");
setSetting("round3_finance_migration_complete", "1");
setSetting("round3_schema_version", "3");
setSetting("final_compliance_migration_complete", "1");
setSetting("final_compliance_schema_version", "4");
setSetting("workshop_ux_schema_version", "5");
setSetting("admin_ux_schema_version", "6");
setSetting("ui_default_language", "en");
setSetting("ui_default_theme", "dark");

db.pragma("foreign_keys = ON");
const fk = db.prepare("PRAGMA foreign_key_check").all();
if (fk.length) throw new Error(`FINAL_COMPLIANCE_FOREIGN_KEY_CHECK_FAILED:${JSON.stringify(fk.slice(0,10))}`);
const integrity = db.prepare("PRAGMA integrity_check").get();
if (String(integrity?.integrity_check || "").toLowerCase() !== "ok") throw new Error("FINAL_COMPLIANCE_INTEGRITY_CHECK_FAILED");

console.log(`[COMPLIANCE] Database ready: clients=${db.prepare("SELECT COUNT(*) c FROM clients").get().c}, pianos=${db.prepare("SELECT COUNT(*) c FROM pianos").get().c}, intake=${db.prepare("SELECT COUNT(*) c FROM intake_leads").get().c}, jobs=${db.prepare("SELECT COUNT(*) c FROM jobs").get().c}, handoffs=${db.prepare("SELECT COUNT(*) c FROM job_handoffs").get().c}, invoices=${db.prepare("SELECT COUNT(*) c FROM invoices").get().c}, expenses=${db.prepare("SELECT COUNT(*) c FROM direct_expenses").get().c}`);
db.close();

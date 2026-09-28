"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus_v6.sqlite");
const backupDir = process.env.BACKUP_DIR || path.join(__dirname, "backups");
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
function ensureColumn(table, name, definition) {
  if (tableExists(table) && !columns(table).has(name)) db.exec(`ALTER TABLE ${quoteName(table)} ADD COLUMN ${quoteName(name)} ${definition}`);
}
function legacyValue(row, ...names) {
  for (const name of names) if (row && row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") return row[name];
  return null;
}

preMigrationBackup();
round3MigrationBackup();
finalComplianceBackup();

const legacyPianoColumns = columns("pianos");
const legacyPianosDetected = tableExists("pianos") && (!legacyPianoColumns.has("client_id") || legacyPianoColumns.has("owner_contact_id") || legacyPianoColumns.has("serial_no"));
if (legacyPianosDetected) {
  if (tableExists("_round1_legacy_pianos")) db.exec('DROP TABLE "_round1_legacy_pianos"');
  db.exec('ALTER TABLE "pianos" RENAME TO "_round1_legacy_pianos"');
  console.log("[ROUND1] Legacy pianos table isolated for migration");
}

const currentJobColumns = columns("jobs");
const legacyJobsDetected = tableExists("jobs") && !(currentJobColumns.has("client_id") && currentJobColumns.has("piano_id") && currentJobColumns.has("scheduled_start") && currentJobColumns.has("ready_for_closeout_at"));
if (legacyJobsDetected) {
  if (tableExists("_round2_legacy_jobs")) db.exec('DROP TABLE "_round2_legacy_jobs"');
  db.exec('ALTER TABLE "jobs" RENAME TO "_round2_legacy_jobs"');
  console.log("[ROUND2] Legacy jobs table isolated; Round 1 safety backup retains the retired data.");
}

if (tableExists("jobs") && !legacyJobsDetected) {
  ensureColumn("jobs","closed_at","TEXT");
  ensureColumn("jobs","closed_by_user_id","TEXT");
}

const round3Shapes = {
  partners:["company_name","status"],
  partner_contractors:["partner_id","user_id"],
  invoice_sequences:["direction","sequence_year","last_value"],
  invoices:["invoice_number","direction","status","job_id","counterparty_name","total_amount","balance_due"],
  invoice_items:["invoice_id","item_description","quantity","unit_price","total_price"],
  invoice_payments:["invoice_id","amount","payment_method","paid_at"]
};
for (const [name,required] of Object.entries(round3Shapes)) {
  if (!tableExists(name)) continue;
  const current=columns(name);
  if (required.every(column=>current.has(column))) continue;
  const legacyName=`_round3_legacy_${name}`;
  if (tableExists(legacyName)) db.exec(`DROP TABLE ${quoteName(legacyName)}`);
  db.exec(`ALTER TABLE ${quoteName(name)} RENAME TO ${quoteName(legacyName)}`);
  console.log(`[ROUND3] Legacy ${name} table isolated; safety backup retained.`);
}

db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

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

db.transaction(migrateLegacyMasterData)();

const preserved = new Set(["users","account_activations","activation_email_log","activation_email_events","steinway_serial_registry","steinway_model_reference","event_categories","events","event_invitations","event_tickets","event_ticket_documents","event_checkins","event_refund_requests","event_checkout_holds","event_payments","stripe_webhook_events","event_closures","event_attendance_sessions","event_attendance_entries","event_attendance_actions","event_attendance_exports","event_repeat_requests","customer_conversations","customer_messages","customer_message_attachments","customer_conversation_events","app_settings","landing_sections","website_content_pages","website_reviews","website_showroom_pianos","website_services","website_artists","website_media","website_contact_leads","website_content_versions","website_preview_tokens","website_integration_settings","system_integration_secrets","system_integration_health","system_integration_backups","system_integration_delete_tokens","system_integration_test_tokens","website_integration_oauth_states","marketing_campaigns","website_tracking_events","audit_log","role_permissions","clients","pianos","intake_leads","jobs","partners","partner_contractors","invoice_sequences","invoices","invoice_items","invoice_payments"]);
for (const row of db.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'").all()) {
  if (row.type === "view") {
    db.exec(`DROP VIEW IF EXISTS ${quoteName(row.name)}`);
    continue;
  }
  if (!preserved.has(row.name)) db.exec(`DROP TABLE IF EXISTS ${quoteName(row.name)}`);
}

db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
setSetting("round1_core_migration_complete", "1");
setSetting("round1_schema_version", "1");
setSetting("round2_workflow_migration_complete", "1");
setSetting("round2_schema_version", "2");
setSetting("round3_finance_migration_complete", "1");
setSetting("round3_schema_version", "3");

db.pragma("foreign_keys = ON");
const fk = db.prepare("PRAGMA foreign_key_check").all();
if (fk.length) throw new Error(`ROUND3_FOREIGN_KEY_CHECK_FAILED:${JSON.stringify(fk.slice(0,10))}`);
const integrity = db.prepare("PRAGMA integrity_check").get();
if (String(integrity?.integrity_check || "").toLowerCase() !== "ok") throw new Error("ROUND3_INTEGRITY_CHECK_FAILED");

console.log(`[ROUND3] Database ready: clients=${db.prepare("SELECT COUNT(*) c FROM clients").get().c}, pianos=${db.prepare("SELECT COUNT(*) c FROM pianos").get().c}, intake=${db.prepare("SELECT COUNT(*) c FROM intake_leads").get().c}, jobs=${db.prepare("SELECT COUNT(*) c FROM jobs").get().c}, invoices=${db.prepare("SELECT COUNT(*) c FROM invoices").get().c}`);
db.close();

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

const preserved = new Set(["users","account_activations","activation_email_log","activation_email_events","steinway_serial_registry","steinway_model_reference","event_categories","events","event_invitations","event_tickets","event_ticket_documents","event_checkins","event_refund_requests","event_checkout_holds","event_payments","stripe_webhook_events","event_closures","event_attendance_sessions","event_attendance_entries","event_attendance_actions","event_attendance_exports","event_repeat_requests","customer_conversations","customer_messages","customer_message_attachments","customer_conversation_events","app_settings","landing_sections","website_content_pages","website_reviews","website_showroom_pianos","website_services","website_artists","website_media","website_contact_leads","website_content_versions","website_preview_tokens","website_integration_settings","system_integration_secrets","system_integration_health","system_integration_backups","system_integration_delete_tokens","system_integration_test_tokens","website_integration_oauth_states","marketing_campaigns","website_tracking_events","audit_log","role_permissions","clients","pianos","intake_leads","jobs","job_handoffs","partners","partner_contractors","invoice_sequences","invoices","invoice_items","invoice_payments","direct_expenses","invoice_email_log","kpi_summary_cache"]);
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
setSetting("final_compliance_migration_complete", "1");
setSetting("final_compliance_schema_version", "4");
setSetting("ui_default_language", "en");

db.pragma("foreign_keys = ON");
const fk = db.prepare("PRAGMA foreign_key_check").all();
if (fk.length) throw new Error(`FINAL_COMPLIANCE_FOREIGN_KEY_CHECK_FAILED:${JSON.stringify(fk.slice(0,10))}`);
const integrity = db.prepare("PRAGMA integrity_check").get();
if (String(integrity?.integrity_check || "").toLowerCase() !== "ok") throw new Error("FINAL_COMPLIANCE_INTEGRITY_CHECK_FAILED");

console.log(`[COMPLIANCE] Database ready: clients=${db.prepare("SELECT COUNT(*) c FROM clients").get().c}, pianos=${db.prepare("SELECT COUNT(*) c FROM pianos").get().c}, intake=${db.prepare("SELECT COUNT(*) c FROM intake_leads").get().c}, jobs=${db.prepare("SELECT COUNT(*) c FROM jobs").get().c}, handoffs=${db.prepare("SELECT COUNT(*) c FROM job_handoffs").get().c}, invoices=${db.prepare("SELECT COUNT(*) c FROM invoices").get().c}, expenses=${db.prepare("SELECT COUNT(*) c FROM direct_expenses").get().c}`);
db.close();

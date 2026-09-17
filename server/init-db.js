const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { backfillUserCalendarColors } = require("./calendar-colors");
const { SAMPLE_VERSION_KEY } = require("./sample-content");
const { nextTicketCode } = require("./ticket-code");
const { parseGuestName } = require("./name-format");
const { ensureSteinwayReferenceTables } = require("./steinway-reference");
require("dotenv").config();

const dbPath = process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus_v6.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

function log(message) {
  console.log(`[database] ${message}`);
}

function fail(message, error) {
  console.error(`[database] ${message}`);
  if (error) console.error(error.stack || error.message || error);
  try { db.close(); } catch (_error) {}
  process.exit(1);
}

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function tableColumns(tableName) {
  if (!tableExists(tableName)) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name));
}

function ensureColumn(tableName, columnName, definition) {
  if (!tableExists(tableName)) throw new Error(`Required table does not exist: ${tableName}`);
  if (!tableColumns(tableName).has(columnName)) {
    log(`Adding column ${tableName}.${columnName}`);
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function ensureIndex(name, sql) {
  db.exec(sql);
  log(`Index ready: ${name}`);
}

function ensureFinancialSourceUniqueIndex() {
  if (!tableExists("financial_items")) return;
  const columns = tableColumns("financial_items");
  if (!columns.has("source_type") || !columns.has("source_id")) return;
  const duplicates = db.prepare(`
    SELECT source_type,source_id,COUNT(*) AS count
    FROM financial_items
    WHERE source_type IS NOT NULL AND trim(source_type)<>'' AND source_id IS NOT NULL AND trim(source_id)<>''
    GROUP BY source_type,source_id
    HAVING COUNT(*)>1
    LIMIT 1
  `).get();
  if (duplicates) {
    log(`WARNING: duplicate financial source reference detected (${duplicates.source_type}:${duplicates.source_id}); application-level idempotency remains active and the unique index was not created`);
    ensureIndex("idx_financial_items_source", "CREATE INDEX IF NOT EXISTS idx_financial_items_source ON financial_items(source_type,source_id)");
    return;
  }
  db.exec("DROP INDEX IF EXISTS idx_financial_items_source");
  ensureIndex("idx_financial_items_source_unique", "CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_items_source_unique ON financial_items(source_type,source_id) WHERE source_type IS NOT NULL AND source_type<>'' AND source_id IS NOT NULL AND source_id<>''");
}

function tableSql(tableName) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(tableName)?.sql || "";
}

function hardenSystemIntegrationControlTables() {
  const allowed = "'GOOGLE_CALENDAR','GA4','CLARITY','SEARCH_CONSOLE','RESEND','STRIPE'";
  const backupSql = tableSql("system_integration_backups");
  if (backupSql && !/CHECK\s*\(provider\s+IN/i.test(backupSql)) {
    log("Hardening system_integration_backups provider constraint");
    db.exec("ALTER TABLE system_integration_backups RENAME TO system_integration_backups_legacy");
    db.exec(`CREATE TABLE system_integration_backups (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN (${allowed})), snapshot_json TEXT NOT NULL,
      backup_file_path TEXT NOT NULL DEFAULT '', backup_sha256 TEXT NOT NULL DEFAULT '', created_by_user_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL)`);
    db.exec(`INSERT INTO system_integration_backups(id,provider,snapshot_json,backup_file_path,backup_sha256,created_by_user_id,created_at)
      SELECT id,provider,snapshot_json,COALESCE(backup_file_path,''),COALESCE(backup_sha256,''),created_by_user_id,created_at FROM system_integration_backups_legacy
      WHERE provider IN (${allowed})`);
    db.exec("DROP TABLE system_integration_backups_legacy");
  }
  const deleteSql = tableSql("system_integration_delete_tokens");
  if (deleteSql && !/CHECK\s*\(provider\s+IN/i.test(deleteSql)) {
    log("Hardening system_integration_delete_tokens provider constraint");
    db.exec("ALTER TABLE system_integration_delete_tokens RENAME TO system_integration_delete_tokens_legacy");
    db.exec(`CREATE TABLE system_integration_delete_tokens (
      token_hash TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN (${allowed})), requested_by_user_id TEXT NOT NULL,
      record_counts_json TEXT NOT NULL DEFAULT '{}', expires_at TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON DELETE CASCADE)`);
    db.exec(`INSERT INTO system_integration_delete_tokens(token_hash,provider,requested_by_user_id,record_counts_json,expires_at,created_at)
      SELECT token_hash,provider,requested_by_user_id,record_counts_json,expires_at,created_at FROM system_integration_delete_tokens_legacy
      WHERE provider IN (${allowed})`);
    db.exec("DROP TABLE system_integration_delete_tokens_legacy");
  }
}

function ensureNormalizedUserEmailIndexes() {
  ensureIndex("idx_users_email_lookup", "CREATE INDEX IF NOT EXISTS idx_users_email_lookup ON users(lower(trim(email)))");
  const duplicates = db.prepare(`
    SELECT lower(trim(email)) AS normalized_email,COUNT(*) AS count
    FROM users
    WHERE email IS NOT NULL AND trim(email)<>''
    GROUP BY lower(trim(email))
    HAVING COUNT(*)>1
    ORDER BY normalized_email
  `).all();
  if (duplicates.length) {
    log(`WARNING: ${duplicates.length} normalized user email conflict(s) found; accounts were preserved and new duplicates are blocked by the API`);
    return;
  }
  ensureIndex("idx_users_email_normalized", "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users(lower(trim(email))) WHERE email IS NOT NULL AND trim(email)<>''");
}

function ensureNormalizedContactEmailIndexes() {
  ensureIndex("idx_users_contact_email_lookup", "CREATE INDEX IF NOT EXISTS idx_users_contact_email_lookup ON users(lower(trim(contact_email)))");
  const duplicates = db.prepare(`
    SELECT lower(trim(contact_email)) AS normalized_email,COUNT(*) AS count
    FROM users
    WHERE contact_email IS NOT NULL AND trim(contact_email)<>''
    GROUP BY lower(trim(contact_email))
    HAVING COUNT(*)>1
    ORDER BY normalized_email
  `).all();
  if (duplicates.length) {
    log(`WARNING: ${duplicates.length} normalized contact email conflict(s) found; accounts were preserved and new duplicates are blocked by the API`);
    return;
  }
  ensureIndex("idx_users_contact_email", "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_contact_email ON users(lower(trim(contact_email))) WHERE contact_email IS NOT NULL AND trim(contact_email)<>''");
}

function preservedBusinessCounts() {
  const tables = ["users", "contacts", "pianos", "jobs", "inventory_items", "events", "event_invitations", "event_tickets"];
  return Object.fromEntries(tables.map((tableName) => [
    tableName,
    tableExists(tableName) ? Number(db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count || 0) : 0
  ]));
}

function assertPreservedBusinessCounts(before) {
  const after = preservedBusinessCounts();
  for (const [tableName, count] of Object.entries(before)) {
    const current = after[tableName];
    const valid = tableName === "jobs" ? current >= count : current === count;
    if (!valid) {
      throw new Error(`Data-preservation check failed for ${tableName}: before=${count}, after=${current}`);
    }
  }
  log(`Data-preservation check passed: ${Object.entries(after).map(([name, count]) => `${name}=${count}`).join(", ")}`);
}

function migrationRequiresBackup() {
  const usersSql = tableExists("users")
    ? String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || "").toUpperCase()
    : "";
  const usersMissingCalendarColor = tableExists("users") && !tableColumns("users").has("calendar_color");
  const usersMissingGoogleCalendarEmail = tableExists("users") && !tableColumns("users").has("google_calendar_email");
  const usersMissingContactEmail = tableExists("users") && !tableColumns("users").has("contact_email");
  const contactsTaxIdMissing = tableExists("contacts") && !tableColumns("contacts").has("tax_id");
  const inventoryMissingCreator = tableExists("inventory_items") && !tableColumns("inventory_items").has("created_by_user_id");
  const jobsMissingPlannedMinutes = tableExists("jobs") && !tableColumns("jobs").has("planned_minutes");
  const jobsMissingRound5DomainColumns = tableExists("jobs") && ["notes","workflow_id","financial_status","financial_ledger_id","closed_at"].some((column) => !tableColumns("jobs").has(column));
  const round6DailyRateMissing = tableExists("users") && (!tableExists("employee_daily_rates") || (tableExists("jobs") && ["daily_rate_enabled","daily_rate_allocated_amount","daily_rate_date"].some((column) => !tableColumns("jobs").has(column))));
  const workflowMissingJobLink = tableExists("workshop_workflows") && !tableColumns("workshop_workflows").has("job_id");
  const googleIntegrationMissing = tableExists("users") && !tableExists("calendar_integrations");
  const activationTablesMissing = tableExists("users") && (!tableExists("account_activations") || !tableExists("activation_email_log") || !tableExists("activation_email_events"));
  const eventTablesMissing = tableExists("users") && (!tableExists("events") || !tableExists("event_tickets") || !tableExists("event_invitations"));
  const websiteCatalogTablesMissing = tableExists("users") && (!tableExists("website_reviews") || !tableExists("website_showroom_pianos") || !tableExists("website_services"));
  const websitePlatformTablesMissing = tableExists("users") && (!tableExists("website_artists") || !tableExists("website_media") || !tableExists("website_contact_leads") || !tableExists("website_content_versions") || !tableExists("event_repeat_requests") || !tableExists("website_integration_settings") || !tableExists("website_integration_oauth_states") || !tableExists("marketing_campaigns") || !tableExists("website_tracking_events"));
  const systemIntegrationTablesMissing = tableExists("users") && (!["system_integration_secrets","system_integration_health","system_integration_backups","system_integration_delete_tokens","system_integration_test_tokens"].every(tableExists));
  const eventPlatformColumnsMissing = tableExists("events") && ["sold_out_at", "is_sample", "relaunch_source_event_id", "custom_type"].some((column) => !tableColumns("events").has(column));
  const eventArtistForeignKeyMissing = tableExists("events") && !db.prepare("PRAGMA foreign_key_list(events)").all().some((row) => row.from === "artist_id" && row.table === "website_artists");
  const sampleFlagsMissing = ["website_reviews", "website_showroom_pianos", "website_services"].some((table) => tableExists(table) && !tableColumns(table).has("is_sample"));
  const attendancePauseColumnsMissing = tableExists("event_attendance_sessions") && ["paused_at", "paused_by_user_id", "resumed_at", "resumed_by_user_id"].some((column) => !tableColumns("event_attendance_sessions").has(column));
  const sampleContentMissing = tableExists("app_settings") && !db.prepare("SELECT 1 FROM app_settings WHERE setting_key=?").get(SAMPLE_VERSION_KEY);
  const workflowTablesMissing = tableExists("users") && (!["workflow_stage_definitions","workshop_workflows","workflow_stages","workflow_stage_transfers","workflow_materials","workflow_financial_lines","workflow_documents","workflow_closed_jobs","workflow_audit_events"].every(tableExists));
  const inventoryMissingReservedQuantity = tableExists("inventory_items") && !tableColumns("inventory_items").has("reserved_quantity");
  const invoicePaymentSchemaOutdated = tableExists("invoices") && (!tableColumns("invoices").has("payment_link_url") || !tableColumns("invoices").has("notes") || !tableColumns("invoices").has("paid_at") || !tableColumns("invoices").has("archived_at") || !tableColumns("invoices").has("archived_period") || !tableColumns("invoices").has("revenue_recognition_status") || !tableColumns("invoices").has("revenue_recognition_date") || !tableColumns("invoices").has("deferred_event_id") || !tableSql("invoices").includes("Payment Link") || !tableSql("invoices").includes("PayPal") || !tableSql("invoices").includes("NONE / INTERNAL") || !tableSql("invoices").includes("'event'"));
  const invoiceItemSettlementMissing = tableExists("invoice_items") && ["payment_method","financial_status"].some((column) => !tableColumns("invoice_items").has(column));
  return usersSql.includes("'VIEWER'") || invoicePaymentSchemaOutdated || invoiceItemSettlementMissing || contactsTaxIdMissing || usersMissingCalendarColor || usersMissingGoogleCalendarEmail || usersMissingContactEmail || inventoryMissingCreator || inventoryMissingReservedQuantity || jobsMissingPlannedMinutes || googleIntegrationMissing || activationTablesMissing || eventTablesMissing || websiteCatalogTablesMissing || websitePlatformTablesMissing || eventPlatformColumnsMissing || eventArtistForeignKeyMissing || sampleFlagsMissing || attendancePauseColumnsMissing || sampleContentMissing || workflowTablesMissing || systemIntegrationTablesMissing || jobsMissingRound5DomainColumns || round6DailyRateMissing || workflowMissingJobLink;
}

function migrateWebsiteContactLeadStatuses() {
  const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='website_contact_leads'").get()?.sql || "");
  const normalizedSql = sql.toUpperCase();
  if (!normalizedSql.includes("'QUALIFIED'") && !normalizedSql.includes("'CONVERTED'")) return;
  log("Migrating website contact leads to the approved six-stage workflow");
  db.transaction(() => {
    db.exec(`CREATE TABLE website_contact_leads_new (
      id TEXT PRIMARY KEY,lead_type TEXT NOT NULL DEFAULT 'SERVICE_CALLBACK' CHECK(lead_type IN ('SERVICE_CALLBACK','PRIVATE_CONSULTATION','GENERAL_CONTACT','EVENT_INTEREST')),
      name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT,service_id TEXT,piano_brand TEXT,piano_model TEXT,service_address TEXT,preferred_time TEXT,event_date TEXT,event_venue TEXT,instrument_requirements TEXT,rental_duration TEXT,message TEXT,
      preferred_contact TEXT NOT NULL DEFAULT 'EMAIL' CHECK(preferred_contact IN ('EMAIL','PHONE','EITHER')),language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
      consent_contact INTEGER NOT NULL DEFAULT 0 CHECK(consent_contact IN (0,1)),consent_marketing INTEGER NOT NULL DEFAULT 0 CHECK(consent_marketing IN (0,1)),source_path TEXT,utm_source TEXT,utm_medium TEXT,utm_campaign TEXT,
      status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','CONTACTED','IN_DISCUSSION','APPOINTMENT_SCHEDULED','CLOSED','REJECTED')),assigned_user_id TEXT,internal_notes TEXT,contact_date TEXT,agreed_appointment_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(service_id) REFERENCES website_services(id) ON DELETE SET NULL,FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
    )`);
    db.exec(`INSERT INTO website_contact_leads_new SELECT id,lead_type,name,email,phone,service_id,piano_brand,piano_model,service_address,preferred_time,event_date,event_venue,instrument_requirements,rental_duration,message,preferred_contact,language,consent_contact,consent_marketing,source_path,utm_source,utm_medium,utm_campaign,
      CASE status WHEN 'QUALIFIED' THEN 'IN_DISCUSSION' WHEN 'CONVERTED' THEN 'APPOINTMENT_SCHEDULED' ELSE status END,assigned_user_id,internal_notes,contact_date,agreed_appointment_at,created_at,updated_at FROM website_contact_leads`);
    db.exec("DROP TABLE website_contact_leads");
    db.exec("ALTER TABLE website_contact_leads_new RENAME TO website_contact_leads");
  })();
}

function migrateCustomerConversationSchema() {
  if (!tableExists("customer_conversations")) return;
  const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customer_conversations'").get()?.sql || "").toUpperCase();
  const columns = tableColumns("customer_conversations");
  const nameNullable = !db.prepare("PRAGMA table_info(customer_conversations)").all().find((row) => row.name === "name")?.notnull;
  const emailNullable = !db.prepare("PRAGMA table_info(customer_conversations)").all().find((row) => row.name === "email")?.notnull;
  const ready = sql.includes("'TICKET'") && sql.includes("'BILLING'") && sql.includes("'REPAIR'") && nameNullable && emailNullable
    && ["visitor_token_hash", "assigned_role", "last_activity_at", "auto_closed_at", "closure_note", "reopen_reason", "reopened_at", "reopened_by_user_id"].every((column) => columns.has(column));
  if (ready) return;
  log("Migrating customer conversation schema while preserving existing conversations");
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE customer_conversations_new (
        id TEXT PRIMARY KEY,public_token_hash TEXT NOT NULL UNIQUE,public_token_encrypted TEXT,visitor_token_hash TEXT,name TEXT,email TEXT,
        language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
        category TEXT NOT NULL CHECK(category IN ('SERVICE','PIANO','EVENT','REFUND','PRIVATE_CONSULTATION','TECHNICAL','TICKET','BILLING','REPAIR','GENERAL','OTHER')),
        service_id TEXT,piano_id TEXT,event_id TEXT,ticket_id TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PENDING_CUSTOMER','PENDING_STAFF','CLOSED')),
        assigned_user_id TEXT,assigned_role TEXT,consent_contact INTEGER NOT NULL DEFAULT 0 CHECK(consent_contact IN (0,1)),source_path TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',last_message_at TEXT,last_activity_at TEXT,closed_at TEXT,auto_closed_at TEXT,closure_note TEXT,
        reopen_reason TEXT,reopened_at TEXT,reopened_by_user_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(service_id) REFERENCES website_services(id) ON DELETE SET NULL,FOREIGN KEY(piano_id) REFERENCES website_showroom_pianos(id) ON DELETE SET NULL,
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL,FOREIGN KEY(ticket_id) REFERENCES event_tickets(id) ON DELETE SET NULL,
        FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,FOREIGN KEY(reopened_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`);
      const source = (column, fallback) => columns.has(column) ? `c.${column}` : fallback;
      db.exec(`INSERT INTO customer_conversations_new(id,public_token_hash,public_token_encrypted,visitor_token_hash,name,email,language,category,service_id,piano_id,event_id,ticket_id,status,assigned_user_id,assigned_role,consent_contact,source_path,metadata_json,last_message_at,last_activity_at,closed_at,auto_closed_at,closure_note,reopen_reason,reopened_at,reopened_by_user_id,created_at,updated_at)
        SELECT ${source("id", "NULL")},${source("public_token_hash", "NULL")},${source("public_token_encrypted", "NULL")},${source("public_token_hash", "NULL")},${source("name", "NULL")},${source("email", "NULL")},${source("language", "'en'")},
          CASE WHEN ${source("category", "'GENERAL'")} IN ('SERVICE','PIANO','EVENT','REFUND','PRIVATE_CONSULTATION','TECHNICAL','TICKET','BILLING','REPAIR','GENERAL','OTHER') THEN ${source("category", "'GENERAL'")} ELSE 'GENERAL' END,
          ${source("service_id", "NULL")},${source("piano_id", "NULL")},${source("event_id", "NULL")},${source("ticket_id", "NULL")},${source("status", "'OPEN'")},${source("assigned_user_id", "NULL")},NULL,COALESCE(${source("consent_contact", "0")},0),${source("source_path", "NULL")},COALESCE(${source("metadata_json", "'{}'")},'{}'),${source("last_message_at", "NULL")},${source("last_message_at", "NULL")},${source("closed_at", "NULL")},NULL,NULL,NULL,NULL,NULL,${source("created_at", "CURRENT_TIMESTAMP")},${source("updated_at", "CURRENT_TIMESTAMP")} FROM customer_conversations c`);
      db.exec("DROP TABLE customer_conversations");
      db.exec("ALTER TABLE customer_conversations_new RENAME TO customer_conversations");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function migrateEventArtistForeignKey() {
  const hasArtistForeignKey = db.prepare("PRAGMA foreign_key_list(events)").all()
    .some((row) => row.from === "artist_id" && row.table === "website_artists");
  if (hasArtistForeignKey) return;
  log("Adding the stable events.artist_id foreign-key relation while preserving event records");
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE events_new (
        id TEXT PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,category_id TEXT NOT NULL,custom_type TEXT,
        access_type TEXT NOT NULL CHECK(access_type IN ('PUBLIC_PAID','PUBLIC_FREE','INVITE_ONLY','INTERNAL')),
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','RESCHEDULED','CANCELLED','COMPLETED','CLOSED')),status_before_close TEXT,
        slug_en TEXT NOT NULL UNIQUE,slug_hu TEXT NOT NULL UNIQUE,title_en TEXT NOT NULL,title_hu TEXT NOT NULL,
        short_description_en TEXT,short_description_hu TEXT,description_en TEXT,description_hu TEXT,artist_id TEXT,performer_name TEXT,
        hero_image_url TEXT,hero_image_alt_en TEXT,hero_image_alt_hu TEXT,gallery_json TEXT DEFAULT '[]',venue_name TEXT NOT NULL,
        venue_street TEXT NOT NULL,venue_city TEXT NOT NULL,venue_region TEXT NOT NULL,venue_postal_code TEXT NOT NULL,
        venue_country TEXT NOT NULL DEFAULT 'US',timezone TEXT NOT NULL DEFAULT 'America/New_York',start_at TEXT NOT NULL,end_at TEXT NOT NULL,
        previous_start_at TEXT,cancellation_reason TEXT,cancelled_at TEXT,cancelled_by_user_id TEXT,
        capacity_total INTEGER NOT NULL CHECK(capacity_total > 0),special_capacity_total INTEGER NOT NULL DEFAULT 0 CHECK(special_capacity_total >= 0),
        special_capacity_unlimited INTEGER NOT NULL DEFAULT 1 CHECK(special_capacity_unlimited IN (0,1)),price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
        currency TEXT NOT NULL DEFAULT 'USD',sales_start_at TEXT,sales_end_at TEXT,refund_policy_version TEXT NOT NULL DEFAULT 'KH-48H-V1',
        published_at TEXT,closed_at TEXT,closed_by_user_id TEXT,closure_snapshot_json TEXT,sold_out_at TEXT,
        is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1)),relaunch_source_event_id TEXT,created_by_user_id TEXT,updated_by_user_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(category_id) REFERENCES event_categories(id),FOREIGN KEY(artist_id) REFERENCES website_artists(id) ON DELETE SET NULL,
        FOREIGN KEY(cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL,FOREIGN KEY(closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(relaunch_source_event_id) REFERENCES events_new(id) ON DELETE SET NULL
      )`);
      const hasCustomType = tableColumns("events").has("custom_type");
      db.exec(`INSERT INTO events_new SELECT e.id,e.event_key,e.category_id,${hasCustomType ? "e.custom_type" : "NULL"},e.access_type,e.status,e.status_before_close,e.slug_en,e.slug_hu,e.title_en,e.title_hu,
        e.short_description_en,e.short_description_hu,e.description_en,e.description_hu,
        CASE WHEN a.id IS NULL THEN NULL ELSE e.artist_id END,e.performer_name,e.hero_image_url,e.hero_image_alt_en,
        e.hero_image_alt_hu,e.gallery_json,e.venue_name,e.venue_street,e.venue_city,e.venue_region,e.venue_postal_code,e.venue_country,e.timezone,e.start_at,e.end_at,
        e.previous_start_at,e.cancellation_reason,e.cancelled_at,e.cancelled_by_user_id,e.capacity_total,e.special_capacity_total,e.special_capacity_unlimited,e.price_cents,e.currency,e.sales_start_at,e.sales_end_at,
        e.refund_policy_version,e.published_at,e.closed_at,e.closed_by_user_id,e.closure_snapshot_json,e.sold_out_at,e.is_sample,e.relaunch_source_event_id,
        e.created_by_user_id,e.updated_by_user_id,e.created_at,e.updated_at FROM events e LEFT JOIN website_artists a ON a.id=e.artist_id`);
      db.exec("DROP TABLE events");
      db.exec("ALTER TABLE events_new RENAME TO events");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function migrateEventTicketData() {
  if (!tableExists("event_tickets") || !tableExists("events")) return;
  const rows = db.prepare(`SELECT t.*,e.event_key,e.access_type,c.code AS category_code,c.name_en AS category_name_en,e.title_en
    FROM event_tickets t JOIN events e ON e.id=t.event_id
    LEFT JOIN event_categories c ON c.id=e.category_id ORDER BY t.event_id,t.created_at,t.id`).all();
  if (!rows.length) return;

  const sequenceByKey = new Map();
  const variantFor = (row) => {
    const existing = String(row.ticket_variant || "").trim().toUpperCase();
    if (existing && existing !== "PUBLIC_PAID") return existing;
    if (row.source_type === "PURCHASE") return "PUBLIC_PAID";
    if (row.source_type === "INVITATION") return "INVITATION";
    return row.access_type === "PUBLIC_FREE" ? "PUBLIC_FREE" : "COMPLIMENTARY";
  };
  const paymentStatusFor = (row, variant) => {
    if (variant === "PUBLIC_PAID" && row.event_payment_id) {
      const payment = db.prepare("SELECT status FROM event_payments WHERE id=?").get(row.event_payment_id);
      return payment?.status === "PAID" ? "PAID" : "PENDING";
    }
    return Number(row.price_cents || 0) > 0 ? "PENDING" : "NOT_REQUIRED";
  };
  const update = db.prepare(`UPDATE event_tickets SET ticket_variant=?,attendee_name=?,original_guest_name=COALESCE(NULLIF(original_guest_name,''),?),
    payment_status=?,reservation_status=COALESCE(NULLIF(reservation_status,''),'FINALIZED'),ticket_sequence=?,legacy_public_code=?,public_code=? WHERE id=?`);

  db.transaction(() => {
    for (const row of rows) {
      const variant = variantFor(row);
      const key = `${row.event_id}:${variant}`;
      const fallbackSequence = (sequenceByKey.get(key) || 0) + 1;
      const sequence = Number(row.ticket_sequence) > 0 ? Number(row.ticket_sequence) : fallbackSequence;
      sequenceByKey.set(key, Math.max(sequenceByKey.get(key) || 0, sequence));
      const event = { ...row, category_code: row.category_code, category_name_en: row.category_name_en };
      const parsed = parseGuestName(row.original_guest_name || row.attendee_name || row.buyer_name || "Unknown guest");
      const isNewCode = /^[PVIC]-[A-Z0-9]{3}-\d{3}-\d{2,}$/.test(String(row.public_code || ""));
      const next = isNewCode ? { code: row.public_code, sequence } : nextTicketCode(db, event, row.source_type, sequence, variant);
      const oldCode = isNewCode ? row.legacy_public_code || null : row.public_code || null;
      update.run(variant, parsed.display_name, parsed.original_name, paymentStatusFor(row, variant), next.sequence, oldCode, next.code, row.id);
    }
  })();
  log(`Migrated ${rows.length} event ticket record(s) to the v2 ticket model`);
}

function createPreMigrationBackup() {
  if (!migrationRequiresBackup() || !fs.existsSync(dbPath)) return null;
  db.pragma("wal_checkpoint(FULL)");
  const backupDir = process.env.BACKUP_DIR || path.join(__dirname, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `klavierhaus-pre-migration-${stamp}.sqlite`);
  fs.copyFileSync(dbPath, target);
  log(`Pre-migration backup created: ${target}`);
  return target;
}

function migrateUsersRoleConstraint() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  const createSql = String(row?.sql || "").toUpperCase();
  if (!createSql.includes("'VIEWER'")) {
    if (tableExists("role_permissions")) db.prepare("DELETE FROM role_permissions WHERE role='VIEWER'").run();
    return;
  }

  log("Removing VIEWER from the users role constraint while preserving every user record");
  db.pragma("foreign_keys = OFF");
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('ADMIN','MANAGER','WORKER')),
        status TEXT DEFAULT 'Active',
        phone TEXT,
        address TEXT,
        calendar_color TEXT,
        google_calendar_email TEXT,
        contact_email TEXT,
        hidden_user INTEGER DEFAULT 0,
        is_superadmin INTEGER DEFAULT 0,
        session_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      INSERT INTO users_new(
        id,name,email,password_hash,role,status,phone,address,calendar_color,google_calendar_email,contact_email,hidden_user,is_superadmin,session_version,created_at,updated_at
      )
      SELECT
        id,name,email,password_hash,
        CASE WHEN role IN ('ADMIN','MANAGER','WORKER') THEN role ELSE 'WORKER' END,
        CASE WHEN role='VIEWER' THEN 'Inactive' ELSE COALESCE(status,'Active') END,
        phone,address,calendar_color,google_calendar_email,contact_email,COALESCE(hidden_user,0),COALESCE(is_superadmin,0),COALESCE(session_version,0),created_at,updated_at
      FROM users
    `);
    db.exec("DROP TABLE users");
    db.exec("ALTER TABLE users_new RENAME TO users");
  });
  try {
    migrate();
    if (tableExists("role_permissions")) db.prepare("DELETE FROM role_permissions WHERE role='VIEWER'").run();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

function cleanupDuplicateImportBatches() {
  if (!tableExists("import_batches")) return;
  const groups = db.prepare(`
    SELECT import_source,file_hash,COUNT(*) AS count
    FROM import_batches
    WHERE import_source IS NOT NULL AND TRIM(import_source)<>''
      AND file_hash IS NOT NULL AND TRIM(file_hash)<>''
    GROUP BY import_source,file_hash
    HAVING COUNT(*)>1
  `).all();
  if (!groups.length) return;

  const list = db.prepare(`
    SELECT id,status,created_at,completed_at
    FROM import_batches
    WHERE import_source=? AND file_hash=?
  `);
  const remove = db.prepare("DELETE FROM import_batches WHERE id=?");
  const priority = (status) => ({ COMPLETED: 4, PREVIEW: 3, FAILED: 2 }[String(status || '').toUpperCase()] || 1);
  const stamp = (row) => Date.parse(row.completed_at || row.created_at || '') || 0;

  db.transaction(() => {
    for (const group of groups) {
      const rows = list.all(group.import_source, group.file_hash).sort((a, b) =>
        priority(b.status) - priority(a.status) || stamp(b) - stamp(a) || String(b.id).localeCompare(String(a.id))
      );
      for (const duplicate of rows.slice(1)) remove.run(duplicate.id);
      log(`Removed ${rows.length - 1} duplicate import batch record(s); kept ${rows[0].id}`);
    }
  })();
}

function neutralizeDuplicateImportReferences(tableName) {
  const groups = db.prepare(`
    SELECT import_source,external_reference,COUNT(*) AS count
    FROM ${tableName}
    WHERE import_source IS NOT NULL AND TRIM(import_source)<>''
      AND external_reference IS NOT NULL AND TRIM(external_reference)<>''
    GROUP BY import_source,external_reference
    HAVING COUNT(*)>1
  `).all();
  if (!groups.length) return;

  const rowsStmt = db.prepare(`
    SELECT id,created_at FROM ${tableName}
    WHERE import_source=? AND external_reference=?
    ORDER BY COALESCE(created_at,'') ASC,id ASC
  `);
  const clearStmt = db.prepare(`
    UPDATE ${tableName}
    SET import_source=NULL,external_reference=NULL,import_batch_id=NULL
    WHERE id=?
  `);

  db.transaction(() => {
    for (const group of groups) {
      const rows = rowsStmt.all(group.import_source, group.external_reference);
      for (const duplicate of rows.slice(1)) clearStmt.run(duplicate.id);
      log(`Resolved duplicate ${tableName} import reference ${group.import_source}/${group.external_reference}; business records preserved`);
    }
  })();
}

function removeRetiredPrivateConsultationPage() {
  const hasPages = tableExists("website_content_pages");
  const hasVersions = tableExists("website_content_versions");
  if (!hasPages && !hasVersions) return;
  db.transaction(() => {
    if (tableExists("website_preview_tokens") && hasVersions) db.prepare("DELETE FROM website_preview_tokens WHERE version_id IN (SELECT id FROM website_content_versions WHERE page_key='consultation')").run();
    if (hasVersions) db.prepare("DELETE FROM website_content_versions WHERE page_key='consultation'").run();
    if (hasPages) db.prepare("DELETE FROM website_content_pages WHERE page_key='consultation'").run();
  })();
  log("Removed retired standalone Private Consultation website content");
}

function purgeLegacyRoundOneEvents() {
  if (!tableExists("events") || !tableExists("app_settings")) return;
  const markerKey = "legacy_round_one_events_purged_v3";
  if (db.prepare("SELECT 1 FROM app_settings WHERE setting_key=?").get(markerKey)) return;

  const events = db.prepare(`SELECT id,title_en,title_hu,slug_en,slug_hu,start_at,hero_image_url,gallery_json FROM events`).all();
  const normalized = (value) => String(value || "").toLocaleLowerCase("hu-HU");
  const localDate = (value) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(value)).reduce((output, part) => { output[part.type] = part.value; return output; }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const matches = [
    { date: "2027-10-15", matcher: (text) => /ravel/.test(text) && /(est|evening)/.test(text) },
    { date: "2027-11-11", matcher: (text) => /éneklő\s+dallam\s+művész|singing\s+melody|art\s+of\s+the\s+singing\s+line/.test(text) },
    { date: "2027-12-04", matcher: (text) => /young\s+artist\s+salon|fiatal\s+művészek\s+szalonja/.test(text) }
  ];
  const selected = new Map();
  matches.forEach((target, index) => {
    const found = events.filter((event) => {
      const text = [event.title_en, event.title_hu, event.slug_en, event.slug_hu].map(normalized).join(" ");
      return localDate(event.start_at) === target.date && target.matcher(text);
    });
    if (found.length > 1) throw new Error(`LEGACY_EVENT_PURGE_AMBIGUOUS_${index + 1}`);
    if (found[0]) selected.set(found[0].id, found[0]);
  });
  const selectedRows = [...selected.values()];
  const removeUploadedFile = (url) => {
    const value = String(url || "");
    if (!value.startsWith("/uploads/events/")) return;
    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
    try { fs.unlinkSync(path.join(uploadDir, "events", path.basename(value))); } catch (_error) {}
  };
  const eventImages = selectedRows.flatMap((event) => {
    let gallery = [];
    try { gallery = JSON.parse(event.gallery_json || "[]"); } catch (_error) {}
    return [event.hero_image_url, ...(Array.isArray(gallery) ? gallery.map((item) => typeof item === "string" ? item : item?.url || item?.image_url) : [])];
  });
  if (selectedRows.length) {
    const ids = selectedRows.map((event) => event.id);
    const placeholders = ids.map(() => "?").join(",");
    const ticketColumns = tableColumns("event_tickets");
    const tickets = tableExists("event_tickets") && ticketColumns.has("event_id")
      ? db.prepare(`SELECT id,${ticketColumns.has("event_payment_id") ? "event_payment_id" : "NULL AS event_payment_id"} FROM event_tickets WHERE event_id IN (${placeholders})`).all(...ids)
      : [];
    const ticketIds = tickets.map((row) => row.id).filter(Boolean);
    const paymentColumns = tableColumns("event_payments");
    const directPayments = tableExists("event_payments") && paymentColumns.has("event_id")
      ? db.prepare(`SELECT id FROM event_payments WHERE event_id IN (${placeholders})`).all(...ids)
      : [];
    const paymentIds = [...new Set([...tickets.map((row) => row.event_payment_id), ...directPayments.map((row) => row.id)].filter(Boolean))];
    const paymentPlaceholders = paymentIds.map(() => "?").join(",");
    const documentNeedles = [...ids, ...paymentIds];
    const documentColumns = tableColumns("knowledge_base");
    const documentRows = tableExists("knowledge_base") && documentColumns.has("stored_path") && documentColumns.has("body") && documentNeedles.length
      ? db.prepare(`SELECT id,stored_path FROM knowledge_base WHERE content_type='Event Invoice' AND (${documentNeedles.map(() => "body LIKE ?").join(" OR ")})`)
        .all(...documentNeedles.map((id) => `%${id}%`))
      : [];
    const removeDocumentFile = (value) => {
      const relative = String(value || "");
      if (!relative.startsWith("/uploads/documents/")) return;
      const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
      const documentDir = path.join(uploadDir, "documents");
      const fileName = path.basename(relative);
      const target = path.resolve(documentDir, fileName);
      if (path.dirname(target) !== path.resolve(documentDir)) return;
      try { fs.unlinkSync(target); } catch (_error) {}
    };
    const legacyDocumentFiles = [
      ...paymentIds.flatMap((id) => [`tickets-${id}.pdf`, `invoice-${id}.pdf`]),
      ...ticketIds.map((id) => `ticket-${id}.pdf`),
      ...documentRows.map((row) => path.basename(String(row.stored_path || ""))).filter(Boolean)
    ];
    db.transaction(() => {
      // These relations intentionally use SET NULL in the operational schema,
      // but the round-one purge is a hard deletion. Remove every event-owned
      // record explicitly before the parent event is removed so no orphaned
      // interest, conversation, delivery, tracking, review or finance record
      // survives the requested cleanup.
      const deleteByEvent = (tableName, columnName = "event_id") => {
        if (tableExists(tableName) && tableColumns(tableName).has(columnName)) {
          db.prepare(`DELETE FROM ${tableName} WHERE ${columnName} IN (${placeholders})`).run(...ids);
        }
      };
      [
        "event_repeat_requests",
        "customer_conversations",
        "website_tracking_events",
        "communication_deliveries"
      ].forEach((tableName) => deleteByEvent(tableName));
      deleteByEvent("website_reviews", "linked_event_id");

      if (tableExists("financial_items") && paymentIds.length && tableColumns("financial_items").has("source_id")) {
        db.prepare(`DELETE FROM financial_items WHERE source_type IN ('event_payment','event_payment_refund') AND source_id IN (${paymentPlaceholders})`).run(...paymentIds);
      }
      if (tableExists("knowledge_base") && documentRows.length) {
        db.prepare(`DELETE FROM knowledge_base WHERE id IN (${documentRows.map(() => "?").join(",")})`).run(...documentRows.map((row) => row.id));
      }
      if (tableExists("audit_log") && tableColumns("audit_log").has("record_id")) {
        const auditIds = [...new Set([...ids, ...ticketIds, ...paymentIds])];
        const auditPlaceholders = auditIds.map(() => "?").join(",");
        if (auditIds.length) db.prepare(`DELETE FROM audit_log WHERE record_id IN (${auditPlaceholders})`).run(...auditIds);
      }
      db.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).run(...ids);
      db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES(?,?,?)").run(markerKey, JSON.stringify({ deleted_event_ids: ids, deleted_count: ids.length }), "SYSTEM");
    })();
    eventImages.forEach(removeUploadedFile);
    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
    const documentDir = path.join(uploadDir, "documents");
    legacyDocumentFiles.forEach((fileName) => {
      if (!fileName || fileName.includes("/") || fileName.includes("\\")) return;
      try { fs.unlinkSync(path.join(documentDir, fileName)); } catch (_error) {}
    });
    documentRows.forEach((row) => removeDocumentFile(row.stored_path));
    log(`Removed ${selectedRows.length} targeted legacy event(s) and all cascading records: ${ids.join(", ")}`);
  } else {
    db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES(?,?,?)").run(markerKey, JSON.stringify({ deleted_event_ids: [], deleted_count: 0 }), "SYSTEM");
    log("Targeted legacy events were already absent; purge marker recorded");
  }
}

function canonicalPaymentMethodSql(columnName) {
  return `CASE
    WHEN ${columnName} IS NULL OR trim(${columnName})='' THEN NULL
    WHEN upper(trim(${columnName})) IN ('CREDIT CARD','CARD','STRIPE_TEST','STRIPE') THEN 'Credit Card'
    WHEN upper(trim(${columnName})) IN ('BANK TRANSFER / ACH','BANK TRANSFER','ACH','WIRE','WIRE TRANSFER','ELECTRONIC','ELECTRONIC TRANSFER','DIRECT DEBIT') THEN 'Bank Transfer / ACH'
    WHEN upper(trim(${columnName}))='ZELLE' THEN 'Zelle'
    WHEN upper(trim(${columnName})) IN ('CHECK','CHEQUE') THEN 'Check'
    WHEN upper(trim(${columnName})) IN ('PAYMENT LINK','PAYMENT_LINK') THEN 'Payment Link'
    WHEN upper(trim(${columnName}))='PAYPAL' THEN 'PayPal'
    WHEN upper(trim(${columnName})) IN ('CASH','ON_SITE','ON SITE') THEN 'Cash'
    WHEN upper(trim(${columnName})) IN ('NONE / INTERNAL','NONE','INTERNAL') THEN 'NONE / INTERNAL'
    ELSE NULL
  END`;
}

function normalizePaymentMethodColumns() {
  for (const tableName of ['jobs','job_logs','knowledge_base','journal_entries','financial_items','event_tickets']) {
    if (!tableExists(tableName) || !tableColumns(tableName).has('payment_method')) continue;
    db.exec(`UPDATE ${tableName} SET payment_method=${canonicalPaymentMethodSql('payment_method')} WHERE payment_method IS NOT NULL AND trim(payment_method)<>''`);
  }
}

function migrateInvoicePaymentStandards() {
  if (!tableExists('invoices')) return;
  const columns = tableColumns('invoices');
  const sql = tableSql('invoices');
  const constraintReady = sql.includes('Payment Link') && sql.includes('PayPal') && sql.includes('NONE / INTERNAL');
  const columnsReady = columns.has('payment_link_url') && columns.has('notes') && columns.has('paid_at') && columns.has('archived_at') && columns.has('archived_period')
    && columns.has('revenue_recognition_status') && columns.has('revenue_recognition_date') && columns.has('deferred_event_id') && sql.includes("'event'");
  if (constraintReady && columnsReady) {
    normalizePaymentMethodColumns();
    return;
  }
  log('Migrating invoices to immutable GAAP payment and revenue-recognition standard');
  const paymentLinkExpr = columns.has('payment_link_url') ? 'payment_link_url' : 'NULL';
  const notesExpr = columns.has('notes') ? 'notes' : 'NULL';
  const paidAtExpr = columns.has('paid_at') ? 'paid_at' : "CASE WHEN status='paid' THEN created_at ELSE NULL END";
  const archivedAtExpr = columns.has('archived_at') ? 'archived_at' : 'NULL';
  const archivedPeriodExpr = columns.has('archived_period') ? 'archived_period' : 'NULL';
  const recognitionStatusExpr = columns.has('revenue_recognition_status') ? "COALESCE(NULLIF(revenue_recognition_status,''),'RECOGNIZED')" : "'RECOGNIZED'";
  const recognitionDateExpr = columns.has('revenue_recognition_date') ? 'revenue_recognition_date' : 'issue_date';
  const deferredEventExpr = columns.has('deferred_event_id') ? 'deferred_event_id' : 'NULL';
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS invoices_payment_v2;
        CREATE TABLE invoices_payment_v2 (
          id TEXT PRIMARY KEY,
          direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')),
          invoice_number TEXT NOT NULL UNIQUE,
          issue_date TEXT NOT NULL,
          due_date TEXT,
          partner_id TEXT,
          client_id TEXT,
          source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('job','workflow','manual','event')),
          source_id TEXT,
          summary TEXT,
          subtotal REAL NOT NULL DEFAULT 0 CHECK(subtotal >= 0),
          tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate >= 0),
          tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),
          total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
          currency TEXT NOT NULL DEFAULT 'USD',
          payment_method TEXT CHECK(payment_method IS NULL OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash','NONE / INTERNAL')),
          payment_link_url TEXT,
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','paid','void','carried_over')),
          revenue_recognition_status TEXT NOT NULL DEFAULT 'RECOGNIZED' CHECK(revenue_recognition_status IN ('RECOGNIZED','DEFERRED')),
          revenue_recognition_date TEXT,
          deferred_event_id TEXT,
          paid_at TEXT,
          voided_at TEXT,
          voided_by TEXT,
          archived_at TEXT,
          archived_period TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE SET NULL,
          FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE SET NULL
        )`);
      db.exec(`INSERT INTO invoices_payment_v2(
        id,direction,invoice_number,issue_date,due_date,partner_id,client_id,source_type,source_id,summary,subtotal,tax_rate,tax_amount,total_amount,currency,payment_method,payment_link_url,notes,status,revenue_recognition_status,revenue_recognition_date,deferred_event_id,paid_at,voided_at,voided_by,archived_at,archived_period,created_at
      ) SELECT id,direction,invoice_number,issue_date,due_date,partner_id,client_id,source_type,source_id,summary,subtotal,tax_rate,tax_amount,total_amount,currency,
        ${canonicalPaymentMethodSql('payment_method')},${paymentLinkExpr},${notesExpr},status,${recognitionStatusExpr},${recognitionDateExpr},${deferredEventExpr},${paidAtExpr},voided_at,voided_by,${archivedAtExpr},${archivedPeriodExpr},created_at FROM invoices`);
      db.exec('DROP TABLE invoices; ALTER TABLE invoices_payment_v2 RENAME TO invoices;');
    })();
    ensureIndex('idx_invoices_direction_issue', 'CREATE INDEX IF NOT EXISTS idx_invoices_direction_issue ON invoices(direction,issue_date DESC)');
    ensureIndex('idx_invoices_source', 'CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices(source_type,source_id)');
    ensureIndex('idx_invoices_status_due', 'CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(status,due_date)');
    ensureIndex('idx_invoices_source_direction_unique', "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_source_direction_unique ON invoices(direction,source_type,source_id) WHERE source_id IS NOT NULL AND trim(source_id)<>''");
    normalizePaymentMethodColumns();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const fkProblems = db.prepare('PRAGMA foreign_key_check').all();
  if (fkProblems.length) throw new Error(`Invoice payment migration produced ${fkProblems.length} foreign-key violation(s)`);
}

function migrateInvoiceAdjustmentImmutability() {
  if (!tableExists('invoice_adjustments')) return;
  const sql = tableSql('invoice_adjustments');
  if (/ON\s+DELETE\s+RESTRICT/i.test(sql)) return;
  log('Migrating invoice adjustments to delete-restricted immutable audit storage');
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS invoice_adjustments_immutable_v2;
        CREATE TABLE invoice_adjustments_immutable_v2 (
          id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          adjusted_by_user_id TEXT,
          adjusted_by_name TEXT NOT NULL,
          adjusted_at TEXT NOT NULL,
          adjusted_at_local TEXT NOT NULL,
          previous_values TEXT NOT NULL,
          new_values TEXT NOT NULL,
          FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
        )`);
      db.exec(`INSERT INTO invoice_adjustments_immutable_v2(
        id,invoice_id,reason,adjusted_by_user_id,adjusted_by_name,adjusted_at,adjusted_at_local,previous_values,new_values
      ) SELECT id,invoice_id,reason,adjusted_by_user_id,adjusted_by_name,adjusted_at,adjusted_at_local,previous_values,new_values FROM invoice_adjustments`);
      db.exec('DROP TABLE invoice_adjustments; ALTER TABLE invoice_adjustments_immutable_v2 RENAME TO invoice_adjustments;');
    })();
    ensureIndex('idx_invoice_adjustments_invoice_time', 'CREATE INDEX IF NOT EXISTS idx_invoice_adjustments_invoice_time ON invoice_adjustments(invoice_id,adjusted_at DESC)');
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const fkProblems = db.prepare('PRAGMA foreign_key_check').all();
  if (fkProblems.length) throw new Error(`Invoice adjustment immutability migration produced ${fkProblems.length} foreign-key violation(s)`);
}

function newYorkDate(value) {
  const date = new Date(value || Date.now());
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(safe).reduce((out, part) => { out[part.type] = part.value; return out; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function resolveInvoiceEventId(invoice) {
  if (invoice?.deferred_event_id) return invoice.deferred_event_id;
  const sourceId = String(invoice?.source_id || '');
  if (sourceId.startsWith('ticket:') && tableExists('event_tickets')) {
    return db.prepare('SELECT event_id FROM event_tickets WHERE id=?').get(sourceId.slice(7))?.event_id || null;
  }
  if (sourceId.startsWith('payment:') && tableExists('event_payments')) {
    return db.prepare('SELECT event_id FROM event_payments WHERE id=?').get(sourceId.slice(8))?.event_id || null;
  }
  return null;
}

function backfillInvoiceRevenueRecognition() {
  if (!tableExists('invoices')) return;
  db.prepare(`UPDATE invoices
    SET revenue_recognition_status='RECOGNIZED',revenue_recognition_date=COALESCE(revenue_recognition_date,issue_date)
    WHERE source_type<>'event'`).run();
  if (!tableExists('events')) return;
  const eventInvoices = db.prepare("SELECT * FROM invoices WHERE source_type='event'").all();
  const update = db.prepare('UPDATE invoices SET revenue_recognition_status=?,revenue_recognition_date=?,deferred_event_id=? WHERE id=?');
  db.transaction(() => {
    for (const invoice of eventInvoices) {
      const eventId = resolveInvoiceEventId(invoice);
      const event = eventId ? db.prepare('SELECT id,status,status_before_close,end_at FROM events WHERE id=?').get(eventId) : null;
      const status = String(event?.status || '').toUpperCase();
      const recognized = Boolean(event && (status === 'COMPLETED' || (status === 'CLOSED' && String(event.status_before_close || '').toUpperCase() === 'COMPLETED')));
      update.run(recognized ? 'RECOGNIZED' : 'DEFERRED', recognized ? newYorkDate(event.end_at) : null, eventId, invoice.id);
    }
  })();
}

function backfillEventRefundCreditMemos() {
  if (!tableExists('invoice_credit_memos') || !tableExists('credit_memo_sequences') || !tableExists('financial_items') || !tableExists('invoices')) return;
  const legacy = db.prepare("SELECT * FROM financial_items WHERE source_type IN ('event_payment_refund','event_manual_ticket_refund') ORDER BY item_date,created_at,id").all();
  if (!legacy.length) return;
  const nextNumber = (memoDate) => {
    const year = String(memoDate || newYorkDate()).slice(0, 4);
    const row = db.prepare(`INSERT INTO credit_memo_sequences(sequence_year,last_number,updated_at) VALUES(?,1,CURRENT_TIMESTAMP)
      ON CONFLICT(sequence_year) DO UPDATE SET last_number=credit_memo_sequences.last_number+1,updated_at=CURRENT_TIMESTAMP RETURNING last_number`).get(year);
    return `CM-${year}-${String(Number(row?.last_number || 1)).padStart(4,'0')}`;
  };
  db.transaction(() => {
    for (const item of legacy) {
      const sourceType = String(item.source_type || '');
      const sourceId = String(item.source_id || '');
      const normalizedSourceType = sourceType === 'event_payment_refund' ? 'EVENT_PAYMENT_REFUND' : 'EVENT_MANUAL_TICKET_REFUND';
      if (!sourceId || db.prepare('SELECT 1 FROM invoice_credit_memos WHERE source_type=? AND source_id=?').get(normalizedSourceType, sourceId)) continue;
      let invoiceId = null;
      let eventId = null;
      if (sourceType === 'event_payment_refund' && tableExists('event_payments')) {
        const payment = db.prepare('SELECT id,event_id,invoice_id FROM event_payments WHERE id=?').get(sourceId);
        invoiceId = payment?.invoice_id || db.prepare("SELECT id FROM invoices WHERE source_type='event' AND source_id=? LIMIT 1").get(`payment:${sourceId}`)?.id || null;
        eventId = payment?.event_id || null;
      } else if (sourceType === 'event_manual_ticket_refund' && tableExists('event_tickets')) {
        const ticket = db.prepare('SELECT id,event_id,invoice_id FROM event_tickets WHERE id=?').get(sourceId);
        invoiceId = ticket?.invoice_id || db.prepare("SELECT id FROM invoices WHERE source_type='event' AND source_id=? LIMIT 1").get(`ticket:${sourceId}`)?.id || null;
        eventId = ticket?.event_id || null;
      }
      if (!invoiceId) continue;
      const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
      if (!invoice) continue;
      const total = Math.round((Number(item.amount || 0) + Number.EPSILON) * 100) / 100;
      if (!(total > 0)) continue;
      const invoiceTotal = Math.round((Number(invoice.total_amount || 0) + Number.EPSILON) * 100) / 100;
      const ratio = invoiceTotal > 0 ? Math.min(1, total / invoiceTotal) : 0;
      const subtotal = Math.round((Number(invoice.subtotal || 0) * ratio + Number.EPSILON) * 100) / 100;
      const tax = Math.round((total - subtotal + Number.EPSILON) * 100) / 100;
      const memoDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.item_date || '')) ? item.item_date : newYorkDate(item.created_at);
      const recognized = String(invoice.revenue_recognition_status || 'RECOGNIZED').toUpperCase() === 'RECOGNIZED';
      db.prepare(`INSERT INTO invoice_credit_memos(id,credit_memo_number,invoice_id,event_id,memo_type,source_type,source_id,memo_date,reason,subtotal_amount,tax_amount,total_amount,revenue_effect_date,cash_effect,accounting_effect,created_by_name)
        VALUES(?,?,?,?,?,'${normalizedSourceType}',?,?,?,?,?,?,?,1,1,'MIGRATION')`).run(
        `CM-${crypto.randomUUID()}`, nextNumber(memoDate), invoice.id, eventId || invoice.deferred_event_id || null, 'EVENT_REFUND', sourceId, memoDate,
        `Migrated legacy event refund ${sourceId}`, subtotal, tax, total, recognized ? memoDate : null
      );
    }
  })();
}

function ensureInvoiceImmutability() {
  if (!tableExists('invoices') || !tableExists('invoice_adjustments') || !tableExists('invoice_credit_memos')) return;
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_invoices_immutable_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INVOICE_RECORD'); END;
    CREATE TRIGGER IF NOT EXISTS trg_financial_audit_log_immutable_delete BEFORE DELETE ON audit_log WHEN OLD.audit_type='FINANCIAL' BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_AUDIT_LOG'); END;
    CREATE TRIGGER IF NOT EXISTS trg_financial_audit_log_immutable_update BEFORE UPDATE ON audit_log WHEN OLD.audit_type='FINANCIAL' OR NEW.audit_type='FINANCIAL' BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_AUDIT_LOG'); END;
    CREATE TRIGGER IF NOT EXISTS trg_invoice_adjustments_immutable_delete BEFORE DELETE ON invoice_adjustments BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INVOICE_ADJUSTMENT'); END;
    CREATE TRIGGER IF NOT EXISTS trg_invoice_adjustments_reason_required BEFORE INSERT ON invoice_adjustments WHEN length(trim(COALESCE(NEW.reason,'')))<5 BEGIN SELECT RAISE(ABORT,'ADJUSTMENT_REASON_REQUIRED'); END;
    CREATE TRIGGER IF NOT EXISTS trg_invoice_adjustments_immutable_update BEFORE UPDATE ON invoice_adjustments BEGIN SELECT RAISE(ABORT,'IMMUTABLE_INVOICE_ADJUSTMENT'); END;
    CREATE TRIGGER IF NOT EXISTS trg_invoice_credit_memos_immutable_delete BEFORE DELETE ON invoice_credit_memos BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CREDIT_MEMO'); END;
    CREATE TRIGGER IF NOT EXISTS trg_invoice_credit_memos_reason_required BEFORE INSERT ON invoice_credit_memos WHEN length(trim(COALESCE(NEW.reason,'')))<5 BEGIN SELECT RAISE(ABORT,'ADJUSTMENT_REASON_REQUIRED'); END;
    CREATE TRIGGER IF NOT EXISTS trg_invoice_credit_memos_immutable_update BEFORE UPDATE ON invoice_credit_memos
    WHEN NEW.id<>OLD.id OR NEW.credit_memo_number<>OLD.credit_memo_number OR NEW.invoice_id<>OLD.invoice_id OR COALESCE(NEW.event_id,'')<>COALESCE(OLD.event_id,'')
      OR NEW.memo_type<>OLD.memo_type OR NEW.source_type<>OLD.source_type OR NEW.source_id<>OLD.source_id OR NEW.memo_date<>OLD.memo_date OR NEW.reason<>OLD.reason
      OR NEW.subtotal_amount<>OLD.subtotal_amount OR NEW.tax_amount<>OLD.tax_amount OR NEW.total_amount<>OLD.total_amount OR NEW.cash_effect<>OLD.cash_effect OR NEW.accounting_effect<>OLD.accounting_effect
      OR COALESCE(NEW.created_by_user_id,'')<>COALESCE(OLD.created_by_user_id,'') OR NEW.created_by_name<>OLD.created_by_name OR NEW.created_at<>OLD.created_at
      OR OLD.revenue_effect_date IS NOT NULL OR NEW.revenue_effect_date IS NULL
    BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CREDIT_MEMO'); END;
  `);
}

function runMigrations() {
  // Startup migrations must never delete existing business or sample records.
  // Historical content is preserved; removal is an explicit administrator action.
  const preservedCounts = preservedBusinessCounts();
  createPreMigrationBackup();

  // Existing databases may have the pre-Workshop-link jobs table. The schema
  // creates an index on jobs.workshop_workflow_id, so the compatibility column
  // must exist before the full schema is executed. Fresh databases skip this
  // branch and receive the column plus its foreign key from schema.sql.
  if (tableExists("jobs")) {
    ensureColumn("jobs", "workshop_workflow_id", "TEXT");
  }
  // The current schema creates idx_client_pianos_verified immediately. On an
  // existing database, add the relation-verification columns before schema.sql
  // so index creation cannot fail with "no such column: is_verified".
  if (tableExists("client_pianos")) {
    ensureColumn("client_pianos", "is_verified", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn("client_pianos", "verified_at", "TEXT");
    ensureColumn("client_pianos", "verified_by", "TEXT");
  }

  db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  ensureColumn("system_integration_health", "enabled", "INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))");
  ensureColumn("system_integration_backups", "backup_file_path", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("system_integration_backups", "backup_sha256", "TEXT NOT NULL DEFAULT ''");
  hardenSystemIntegrationControlTables();
  removeRetiredPrivateConsultationPage();

  const migrateColumns = db.transaction(() => {
    // Users. No user account is created here.
    ensureColumn("users", "phone", "TEXT");
    ensureColumn("users", "address", "TEXT");
    ensureColumn("users", "calendar_color", "TEXT");
    ensureColumn("users", "google_calendar_email", "TEXT");
    ensureColumn("users", "contact_email", "TEXT");
    ensureColumn("users", "hidden_user", "INTEGER DEFAULT 0");
    ensureColumn("users", "is_superadmin", "INTEGER DEFAULT 0");
    ensureColumn("users", "session_version", "INTEGER NOT NULL DEFAULT 0");

    // Contacts and customer import.
    ensureColumn("contacts", "address_line1", "TEXT");
    ensureColumn("contacts", "city", "TEXT");
    ensureColumn("contacts", "state", "TEXT");
    ensureColumn("contacts", "postal_code", "TEXT");
    ensureColumn("contacts", "country", "TEXT DEFAULT 'United States'");
    ensureColumn("contacts", "address", "TEXT");
    ensureColumn("contacts", "billing_address", "TEXT");
    ensureColumn("contacts", "tax_id", "TEXT");
    ensureColumn("contacts", "external_reference", "TEXT");
    ensureColumn("contacts", "import_source", "TEXT");
    ensureColumn("contacts", "import_batch_id", "TEXT");
    ensureColumn("contacts", "has_piano", "INTEGER DEFAULT 0");
    ensureColumn("contacts", "interested_buying", "INTEGER DEFAULT 0");
    ensureColumn("contacts", "interest_brand", "TEXT");
    ensureColumn("contacts", "interest_model", "TEXT");
    ensureColumn("contacts", "interest_budget", "REAL DEFAULT 0");
    ensureColumn("contacts", "interest_timeline", "TEXT");
    ensureColumn("contacts", "interest_notes", "TEXT");

    // Pianos and piano import.
    db.exec(`CREATE TABLE IF NOT EXISTS piano_brands (
      brand_name TEXT PRIMARY KEY COLLATE NOCASE,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    ensureIndex("idx_piano_brands_active_name", "CREATE INDEX IF NOT EXISTS idx_piano_brands_active_name ON piano_brands(active,brand_name)");
    db.prepare("INSERT OR IGNORE INTO piano_brands(brand_name) SELECT DISTINCT trim(brand) FROM pianos WHERE brand IS NOT NULL AND trim(brand)<>''").run();
    for (const brandName of ["Steinway & Sons", "Bösendorfer", "Yamaha", "Fazioli", "Bechstein"]) {
      db.prepare("INSERT OR IGNORE INTO piano_brands(brand_name,active) VALUES(?,1)").run(brandName);
    }

    ensureColumn("pianos", "finish", "TEXT");
    ensureColumn("pianos", "build_year", "INTEGER");
    ensureColumn("pianos", "size_cm", "TEXT");
    ensureColumn("pianos", "size_in", "TEXT");
    ensureColumn("pianos", "size_display", "TEXT");
    ensureColumn("pianos", "size_length", "TEXT");
    ensureColumn("pianos", "ownership_type", "TEXT DEFAULT 'Customer owned'");
    ensureColumn("pianos", "display_name", "TEXT");
    ensureColumn("pianos", "asset_recorded", "INTEGER DEFAULT 0");
    ensureColumn("pianos", "external_reference", "TEXT");
    ensureColumn("pianos", "import_source", "TEXT");
    ensureColumn("pianos", "import_batch_id", "TEXT");
    ensureColumn("pianos", "original_description", "TEXT");
    ensureColumn("pianos", "owner_resolution", "TEXT");
    db.exec(`CREATE TABLE IF NOT EXISTS client_pianos (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      piano_id TEXT NOT NULL,
      is_verified INTEGER NOT NULL DEFAULT 0 CHECK(is_verified IN (0,1)),
      verified_at TEXT,
      verified_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(client_id,piano_id),
      FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE CASCADE,
      FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE CASCADE
    )`);
    ensureColumn("client_pianos", "is_verified", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn("client_pianos", "verified_at", "TEXT");
    ensureColumn("client_pianos", "verified_by", "TEXT");
    db.prepare(`INSERT OR IGNORE INTO client_pianos(id,client_id,piano_id)
      SELECT 'CP-' || lower(hex(randomblob(12))), owner_contact_id, id FROM pianos
      WHERE owner_contact_id IS NOT NULL AND trim(owner_contact_id)<>''`).run();
    db.prepare(`UPDATE pianos SET size_length=COALESCE(NULLIF(trim(size_length),''),NULLIF(trim(size_display),''),NULLIF(trim(size_cm),''),NULLIF(trim(size_in),''))
      WHERE size_length IS NULL OR trim(size_length)=''`).run();

    // Jobs and immutable user/workflow links.
    ensureColumn("website_showroom_pianos", "build_year", "INTEGER");
    ensureColumn("website_showroom_pianos", "serial_no", "TEXT");
    ensureColumn("website_showroom_pianos", "size_cm", "TEXT");
    ensureColumn("website_showroom_pianos", "size_in", "TEXT");
    ensureColumn("website_showroom_pianos", "size_display", "TEXT");
    ensureColumn("jobs", "job_type", "TEXT DEFAULT 'Standalone'");
    ensureColumn("jobs", "pricing_basis", "TEXT");
    ensureColumn("jobs", "last_reassigned_by", "TEXT");
    ensureColumn("jobs", "reassignment_note", "TEXT");
    ensureColumn("jobs", "job_key", "TEXT");
    ensureColumn("jobs", "client_phone", "TEXT");
    ensureColumn("jobs", "planned_job_id", "TEXT");
    ensureColumn("jobs", "assigned_user_id", "TEXT");
    ensureColumn("jobs", "created_by_user_id", "TEXT");
    ensureColumn("jobs", "last_reassigned_by_user_id", "TEXT");
    ensureColumn("jobs", "workflow_root_id", "TEXT");
    ensureColumn("jobs", "workflow_step_no", "INTEGER DEFAULT 1");
    ensureColumn("jobs", "workflow_status", "TEXT DEFAULT 'ACTIVE'");
    ensureColumn("jobs", "finalized_at", "TEXT");
    ensureColumn("jobs", "planned_minutes", "INTEGER DEFAULT 0");
    ensureColumn("jobs", "notes", "TEXT");
    ensureColumn("jobs", "workflow_id", "TEXT");
    ensureColumn("jobs", "workshop_workflow_id", "TEXT");
    ensureColumn("jobs", "financial_status", "TEXT NOT NULL DEFAULT 'OPEN'");
    ensureColumn("jobs", "financial_ledger_id", "TEXT");
    ensureColumn("jobs", "closed_at", "TEXT");
    ensureColumn("jobs", "daily_rate_enabled", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn("jobs", "daily_rate_allocated_amount", "REAL NOT NULL DEFAULT 0");
    ensureColumn("jobs", "daily_rate_date", "TEXT");
    ensureColumn("jobs", "technician_extra_compensation", "REAL NOT NULL DEFAULT 0");
    ensureColumn("jobs", "billing_status", "TEXT NOT NULL DEFAULT 'Unbilled'");
    ensureColumn("jobs", "invoice_id", "TEXT");

    db.exec(`CREATE TABLE IF NOT EXISTS employee_daily_rates (
      user_id TEXT NOT NULL,
      rate REAL NOT NULL CHECK(rate >= 0),
      currency TEXT NOT NULL DEFAULT 'USD',
      effective_date TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      PRIMARY KEY(user_id,effective_date),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    ensureIndex("idx_employee_daily_rates_user_date", "CREATE INDEX IF NOT EXISTS idx_employee_daily_rates_user_date ON employee_daily_rates(user_id,effective_date DESC)");


    db.exec(`CREATE TABLE IF NOT EXISTS partners (
      id TEXT PRIMARY KEY, company_name TEXT NOT NULL, tax_id TEXT, billing_address TEXT, contact_person TEXT,
      contact_email TEXT, contact_phone TEXT, default_tax_rate REAL NOT NULL DEFAULT 0.0 CHECK(default_tax_rate >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS partner_contractors (
      id TEXT PRIMARY KEY, partner_id TEXT NOT NULL, user_id TEXT, worker_name TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      CHECK(user_id IS NOT NULL OR length(trim(COALESCE(worker_name,''))) > 0)
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY, direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')), invoice_number TEXT NOT NULL UNIQUE,
      issue_date TEXT NOT NULL, due_date TEXT, partner_id TEXT, client_id TEXT, source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('job','workflow','manual','event')),
      source_id TEXT, summary TEXT, subtotal REAL NOT NULL DEFAULT 0 CHECK(subtotal >= 0), tax_rate REAL NOT NULL DEFAULT 0 CHECK(tax_rate >= 0),
      tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0), total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0), currency TEXT NOT NULL DEFAULT 'USD',
      payment_method TEXT CHECK(payment_method IS NULL OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash','NONE / INTERNAL')),
      payment_link_url TEXT, notes TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','paid','void','carried_over')),
      revenue_recognition_status TEXT NOT NULL DEFAULT 'RECOGNIZED' CHECK(revenue_recognition_status IN ('RECOGNIZED','DEFERRED')), revenue_recognition_date TEXT, deferred_event_id TEXT,
      paid_at TEXT, voided_at TEXT, voided_by TEXT, archived_at TEXT, archived_period TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(partner_id) REFERENCES partners(id) ON DELETE SET NULL, FOREIGN KEY(client_id) REFERENCES contacts(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS invoice_sequences (
      direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')), sequence_year TEXT NOT NULL,
      last_number INTEGER NOT NULL DEFAULT 0 CHECK(last_number >= 0), updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(direction,sequence_year)
    );
    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, item_description TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1 CHECK(quantity > 0),
      unit_price REAL NOT NULL DEFAULT 0 CHECK(unit_price >= 0), total_price REAL NOT NULL DEFAULT 0 CHECK(total_price >= 0),
      line_type TEXT NOT NULL DEFAULT 'custom' CHECK(line_type IN ('material','fee','custom')), sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
      payment_method TEXT CHECK(payment_method IS NULL OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash')),
      financial_status TEXT CHECK(financial_status IS NULL OR financial_status IN ('paid','pending')), FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS invoice_adjustments (
      id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, reason TEXT NOT NULL, adjusted_by_user_id TEXT, adjusted_by_name TEXT NOT NULL,
      adjusted_at TEXT NOT NULL, adjusted_at_local TEXT NOT NULL, previous_values TEXT NOT NULL, new_values TEXT NOT NULL,
      FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT
    )`);
    ensureColumn("invoices", "payment_link_url", "TEXT");
    ensureColumn("invoices", "notes", "TEXT");
    ensureColumn("invoices", "paid_at", "TEXT");
    ensureColumn("invoices", "archived_at", "TEXT");
    ensureColumn("invoices", "archived_period", "TEXT");
    ensureColumn("invoices", "revenue_recognition_status", "TEXT NOT NULL DEFAULT 'RECOGNIZED'");
    ensureColumn("invoices", "revenue_recognition_date", "TEXT");
    ensureColumn("invoices", "deferred_event_id", "TEXT");
    ensureColumn("invoice_items", "payment_method", "TEXT CHECK(payment_method IS NULL OR payment_method IN ('Credit Card','Bank Transfer / ACH','Zelle','Check','Payment Link','PayPal','Cash'))");
    ensureColumn("invoice_items", "financial_status", "TEXT CHECK(financial_status IS NULL OR financial_status IN ('paid','pending'))");
    ensureColumn("invoice_items", "sort_order", "INTEGER NOT NULL DEFAULT 0");
    db.exec(`CREATE TABLE IF NOT EXISTS invoice_sequences (
      direction TEXT NOT NULL CHECK(direction IN ('receivable','payable')), sequence_year TEXT NOT NULL,
      last_number INTEGER NOT NULL DEFAULT 0 CHECK(last_number >= 0), updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(direction,sequence_year)
    )`);
    db.exec(`CREATE TABLE IF NOT EXISTS credit_memo_sequences (
      sequence_year TEXT PRIMARY KEY,last_number INTEGER NOT NULL DEFAULT 0 CHECK(last_number >= 0),updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS invoice_credit_memos (
      id TEXT PRIMARY KEY,credit_memo_number TEXT NOT NULL UNIQUE,invoice_id TEXT NOT NULL,event_id TEXT,
      memo_type TEXT NOT NULL CHECK(memo_type IN ('EVENT_REFUND','VOID_REVERSAL')),source_type TEXT NOT NULL,source_id TEXT NOT NULL,
      memo_date TEXT NOT NULL,reason TEXT NOT NULL,subtotal_amount REAL NOT NULL DEFAULT 0 CHECK(subtotal_amount >= 0),
      tax_amount REAL NOT NULL DEFAULT 0 CHECK(tax_amount >= 0),total_amount REAL NOT NULL DEFAULT 0 CHECK(total_amount >= 0),
      revenue_effect_date TEXT,cash_effect INTEGER NOT NULL DEFAULT 1 CHECK(cash_effect IN (0,1)),accounting_effect INTEGER NOT NULL DEFAULT 1 CHECK(accounting_effect IN (0,1)),
      created_by_user_id TEXT,created_by_name TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(source_type,source_id),
      FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT,FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_credit_memos_invoice_date ON invoice_credit_memos(invoice_id,memo_date DESC);
    CREATE INDEX IF NOT EXISTS idx_credit_memos_revenue_effect ON invoice_credit_memos(revenue_effect_date,memo_type);`);
    const sequenceUpsert = db.prepare(`INSERT INTO invoice_sequences(direction,sequence_year,last_number,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(direction,sequence_year) DO UPDATE SET last_number=MAX(invoice_sequences.last_number,excluded.last_number),updated_at=CURRENT_TIMESTAMP`);
    for (const invoice of db.prepare("SELECT direction,invoice_number,issue_date FROM invoices").all()) {
      const year = String(invoice.issue_date || "").slice(0,4);
      const match = String(invoice.invoice_number || "").match(/-(\d{4,})$/);
      const number = Number(match?.[1] || 0);
      if (/^\d{4}$/.test(year) && Number.isSafeInteger(number) && number > 0) sequenceUpsert.run(invoice.direction,year,number);
    }
    ensureIndex("idx_partners_status_name", "CREATE INDEX IF NOT EXISTS idx_partners_status_name ON partners(status,company_name)");
    ensureIndex("idx_partner_contractors_partner", "CREATE INDEX IF NOT EXISTS idx_partner_contractors_partner ON partner_contractors(partner_id)");
    ensureIndex("idx_partner_contractors_user", "CREATE INDEX IF NOT EXISTS idx_partner_contractors_user ON partner_contractors(user_id)");
    ensureIndex("idx_invoices_direction_issue", "CREATE INDEX IF NOT EXISTS idx_invoices_direction_issue ON invoices(direction,issue_date DESC)");
    ensureIndex("idx_invoices_source", "CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices(source_type,source_id)");
    ensureIndex("idx_invoices_status_due", "CREATE INDEX IF NOT EXISTS idx_invoices_status_due ON invoices(status,due_date)");
    ensureIndex("idx_invoices_source_direction_unique", "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_source_direction_unique ON invoices(direction,source_type,source_id) WHERE source_id IS NOT NULL AND trim(source_id)<>''");
    ensureIndex("idx_jobs_invoice_id", "CREATE INDEX IF NOT EXISTS idx_jobs_invoice_id ON jobs(invoice_id)");
    ensureIndex("idx_invoice_items_invoice", "CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id,sort_order,id)");
    ensureIndex("idx_invoice_adjustments_invoice_time", "CREATE INDEX IF NOT EXISTS idx_invoice_adjustments_invoice_time ON invoice_adjustments(invoice_id,adjusted_at DESC)");
    db.prepare(`UPDATE jobs SET billing_status='Billed',invoice_id=(SELECT i.id FROM invoices i WHERE i.direction='receivable' AND i.source_type='job' AND i.source_id=jobs.id AND i.status<>'void' ORDER BY i.created_at DESC,i.id DESC LIMIT 1),invoice_status='Invoiced',invoice_number=(SELECT i.invoice_number FROM invoices i WHERE i.direction='receivable' AND i.source_type='job' AND i.source_id=jobs.id AND i.status<>'void' ORDER BY i.created_at DESC,i.id DESC LIMIT 1) WHERE EXISTS(SELECT 1 FROM invoices i WHERE i.direction='receivable' AND i.source_type='job' AND i.source_id=jobs.id AND i.status<>'void')`).run();

    ensureIndex("idx_jobs_daily_rate_capacity", "CREATE INDEX IF NOT EXISTS idx_jobs_daily_rate_capacity ON jobs(assigned_user_id,daily_rate_date,daily_rate_enabled,status)");

    // Import batches.
    ensureColumn("import_batches", "imported_pianos", "INTEGER DEFAULT 0");
    ensureColumn("import_batches", "updated_clients", "INTEGER DEFAULT 0");
    ensureColumn("import_batches", "unidentified_owner_pianos", "INTEGER DEFAULT 0");
    ensureColumn("import_batches", "client_not_found", "INTEGER DEFAULT 0");
    ensureColumn("audit_log", "audit_type", "TEXT DEFAULT 'TECHNICAL'");

    // Financial items.
    ensureColumn("financial_items", "source_type", "TEXT");
    ensureColumn("financial_items", "source_id", "TEXT");
    ensureColumn("knowledge_base", "workflow_id", "TEXT");
    ensureColumn("knowledge_base", "effective_date", "TEXT");
    ensureColumn("knowledge_base", "original_filename", "TEXT");
    ensureColumn("knowledge_base", "mime_type", "TEXT");
    if (tableExists("workshop_workflows")) {
      ensureColumn("workshop_workflows", "planned_job_id", "TEXT");
      ensureColumn("workshop_workflows", "job_id", "TEXT");
      ensureColumn("workshop_workflows", "billing_status", "TEXT NOT NULL DEFAULT 'Unbilled'");
      ensureColumn("workshop_workflows", "invoice_id", "TEXT");
      ensureColumn("workshop_workflows", "notes", "TEXT");
      ensureColumn("workshop_workflows", "due_time", "TEXT");
      ensureColumn("workshop_workflows", "intake_inspection_status", "TEXT NOT NULL DEFAULT 'PENDING'");
      ensureColumn("workshop_workflows", "intake_pdf_path", "TEXT");
      ensureColumn("workflow_financial_lines", "partner_id", "TEXT");
      ensureColumn("workflow_financial_lines", "payable_invoice_id", "TEXT");
      ensureColumn("workshop_workflows", "intake_photos", "TEXT NOT NULL DEFAULT '[]'");
      ensureColumn("workshop_workflows", "intake_inspected_by", "TEXT");
      ensureColumn("workshop_workflows", "intake_inspected_at", "TEXT");
      ensureColumn("workshop_workflows", "dispatch_inspection_status", "TEXT NOT NULL DEFAULT 'PENDING'");
      ensureColumn("workshop_workflows", "dispatch_pdf_path", "TEXT");
      ensureColumn("workshop_workflows", "dispatch_inspected_by", "TEXT");
      ensureColumn("workshop_workflows", "dispatch_inspected_at", "TEXT");
      ensureIndex("idx_workflows_invoice_id", "CREATE INDEX IF NOT EXISTS idx_workflows_invoice_id ON workshop_workflows(invoice_id)");
      db.prepare(`UPDATE workshop_workflows SET billing_status='Billed',invoice_id=(SELECT i.id FROM invoices i WHERE i.direction='receivable' AND i.source_type='workflow' AND i.source_id=workshop_workflows.id AND i.status<>'void' ORDER BY i.created_at DESC,i.id DESC LIMIT 1) WHERE EXISTS(SELECT 1 FROM invoices i WHERE i.direction='receivable' AND i.source_type='workflow' AND i.source_id=workshop_workflows.id AND i.status<>'void')`).run();
    }
    if (tableExists("workshop_workflows") && tableExists("jobs")) {
      const legacyWorkflows=db.prepare("SELECT w.*,c.name AS client_name,p.display_name AS piano_display,p.brand AS piano_brand,p.model AS piano_model,u.name AS creator_name FROM workshop_workflows w JOIN contacts c ON c.id=w.client_id JOIN pianos p ON p.id=w.piano_id LEFT JOIN users u ON u.id=COALESCE(w.transport_responsible_user_id,w.created_by_user_id) WHERE w.job_id IS NULL OR trim(w.job_id)='' ORDER BY w.created_at,w.id").all();
      const insertLinkedJob=db.prepare(`INSERT OR IGNORE INTO jobs(id,job_key,workflow_root_id,workflow_step_no,workflow_status,workflow_id,title,job_type,client_id,client_name,piano_id,piano_name,assigned_user_id,assigned_to,created_by_user_id,created_by,priority,status,start_time,end_time,timezone,planned_amount,planned_hours,planned_minutes,travel_minutes,service_address,instructions,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const linkWorkflow=db.prepare("UPDATE workshop_workflows SET job_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?");
      for(const workflow of legacyWorkflows){
        const jobId=`WFJOB-${workflow.id}`;
        const end=String(workflow.final_due_at||'').slice(0,16);
        const endDate=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end)?new Date(`${end}:00Z`):null;
        const start=endDate?new Date(endDate.getTime()-15*60000).toISOString().slice(0,16):end;
        const pianoName=workflow.piano_display||`${workflow.piano_brand||''} ${workflow.piano_model||''}`.trim()||workflow.piano_id;
        const assigneeId=workflow.transport_responsible_user_id||workflow.created_by_user_id||null;
        const assigneeName=workflow.transport_responsible_name||workflow.creator_name||'Workshop workflow';
        insertLinkedJob.run(jobId,`WFJOB-${workflow.workflow_key||workflow.id}`,jobId,1,workflow.current_status==='COMPLETED'?'COMPLETED':(workflow.current_status==='ABORTED'?'FAILED':'ACTIVE'),workflow.id,workflow.title,'Workflow',workflow.client_id,workflow.client_name,workflow.piano_id,pianoName,assigneeId,assigneeName,workflow.created_by_user_id||null,workflow.creator_name||'System','Medium',workflow.current_status==='COMPLETED'?'Completed':(workflow.current_status==='ABORTED'?'Cancelled':'Open'),start,end,'America/New_York',0,0.25,15,0,workflow.transport_address||workflow.current_location||'',workflow.description||'',workflow.description||'');
        linkWorkflow.run(jobId,workflow.id);
      }
    }
    if (tableExists("workflow_stages")) {
      ensureColumn("workflow_stages", "card_title", "TEXT");
      ensureColumn("workflow_stages", "notes", "TEXT");
      ensureColumn("workflow_stages", "financial_status", "TEXT NOT NULL DEFAULT 'OPEN'");
      ensureColumn("workflow_stages", "financial_closed_at", "TEXT");
      ensureColumn("workflow_stages", "financial_closed_by_user_id", "TEXT");
      ensureColumn("workflow_stages", "financial_closure_reason", "TEXT");
    }

    if (tableExists("jobs") && tableExists("workshop_workflows")) {
      db.prepare("UPDATE jobs SET workshop_workflow_id=workflow_id WHERE (workshop_workflow_id IS NULL OR trim(workshop_workflow_id)='') AND workflow_id IS NOT NULL AND trim(workflow_id)<>''").run();
      ensureIndex("idx_jobs_workshop_workflow", "CREATE INDEX IF NOT EXISTS idx_jobs_workshop_workflow ON jobs(workshop_workflow_id)");
    }
    db.exec(`CREATE TABLE IF NOT EXISTS piano_inspection_history (
      id TEXT PRIMARY KEY,piano_id TEXT NOT NULL,workflow_id TEXT,inspection_type TEXT NOT NULL CHECK(inspection_type IN ('INTAKE','DISPATCH','DAMAGE_PHOTO')),
      inspection_status TEXT,file_path TEXT NOT NULL,original_filename TEXT,mime_type TEXT,inspected_by TEXT,inspected_at TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(piano_id) REFERENCES pianos(id) ON DELETE CASCADE,FOREIGN KEY(workflow_id) REFERENCES workshop_workflows(id) ON DELETE SET NULL
    )`);
    ensureIndex("idx_piano_inspection_history_piano", "CREATE INDEX IF NOT EXISTS idx_piano_inspection_history_piano ON piano_inspection_history(piano_id,inspected_at DESC)");
    ensureIndex("idx_piano_inspection_history_workflow", "CREATE INDEX IF NOT EXISTS idx_piano_inspection_history_workflow ON piano_inspection_history(workflow_id,inspection_type)");

    // Public events and Stripe Sandbox. These nullable additions preserve every
    // existing event and ticket while enabling cancellation and payment links.
    ensureColumn("events", "cancellation_reason", "TEXT");
    ensureColumn("events", "cancelled_at", "TEXT");
    ensureColumn("events", "cancelled_by_user_id", "TEXT");
    ensureColumn("events", "hero_image_alt_en", "TEXT");
    ensureColumn("events", "hero_image_alt_hu", "TEXT");
    ensureColumn("events", "custom_type", "TEXT");
    ensureColumn("events", "sold_out_at", "TEXT");
    ensureColumn("events", "is_sample", "INTEGER DEFAULT 0");
    ensureColumn("events", "relaunch_source_event_id", "TEXT");
    ensureColumn("events", "artist_id", "TEXT");
    ensureColumn("event_tickets", "event_payment_id", "TEXT");
    ensureColumn("event_tickets", "contact_id", "TEXT");
    ensureColumn("event_tickets", "ticket_sequence", "INTEGER");
    ensureColumn("events", "special_capacity_total", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn("events", "special_capacity_unlimited", "INTEGER NOT NULL DEFAULT 1");
    ensureColumn("events", "status_before_close", "TEXT");
    ensureColumn("event_tickets", "ticket_variant", "TEXT NOT NULL DEFAULT 'PUBLIC_PAID'");
    ensureColumn("event_tickets", "original_guest_name", "TEXT");
    ensureColumn("event_tickets", "salutation", "TEXT");
    ensureColumn("event_tickets", "first_names", "TEXT");
    ensureColumn("event_tickets", "surnames", "TEXT");
    ensureColumn("event_tickets", "suffix", "TEXT");
    ensureColumn("event_tickets", "payment_method", "TEXT");
    ensureColumn("event_tickets", "payment_status", "TEXT NOT NULL DEFAULT 'NOT_REQUIRED'");
    ensureColumn("event_tickets", "reservation_status", "TEXT NOT NULL DEFAULT 'FINALIZED'");
    ensureColumn("event_tickets", "on_site_deadline_at", "TEXT");
    ensureColumn("event_tickets", "reserved_at", "TEXT");
    ensureColumn("event_tickets", "paid_at", "TEXT");
    ensureColumn("event_tickets", "finalized_at", "TEXT");
    ensureColumn("event_tickets", "legacy_public_code", "TEXT");
    ensureColumn("event_tickets", "document_front_path", "TEXT");
    ensureColumn("event_tickets", "document_back_path", "TEXT");
    ensureColumn("event_tickets", "document_full_path", "TEXT");
    ensureColumn("event_tickets", "invoice_id", "TEXT");
    ensureColumn("event_payments", "invoice_id", "TEXT");
    ensureColumn("event_refund_requests", "review_note", "TEXT");
    ensureColumn("event_refund_requests", "reviewed_at", "TEXT");
    ensureColumn("event_refund_requests", "approved_at", "TEXT");
    ensureColumn("event_refund_requests", "executed_at", "TEXT");
    ensureColumn("event_refund_requests", "execution_status", "TEXT NOT NULL DEFAULT 'NOT_STARTED'");
    ensureColumn("event_refund_requests", "no_show", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn("event_checkout_holds", "attendee_names_json", "TEXT NOT NULL DEFAULT '[]'");
    ensureColumn("website_reviews", "is_sample", "INTEGER DEFAULT 0");
    ensureColumn("website_showroom_pianos", "is_sample", "INTEGER DEFAULT 0");
    ensureColumn("website_services", "is_sample", "INTEGER DEFAULT 0");
    ensureColumn("website_contact_leads", "piano_brand", "TEXT");
    ensureColumn("website_contact_leads", "piano_model", "TEXT");
    ensureColumn("website_contact_leads", "service_address", "TEXT");
    ensureColumn("website_contact_leads", "preferred_time", "TEXT");
    ensureColumn("website_contact_leads", "event_date", "TEXT");
    ensureColumn("website_contact_leads", "event_venue", "TEXT");
    ensureColumn("website_contact_leads", "instrument_requirements", "TEXT");
    ensureColumn("website_contact_leads", "rental_duration", "TEXT");
    ensureColumn("website_contact_leads", "contact_date", "TEXT");
    ensureColumn("website_contact_leads", "agreed_appointment_at", "TEXT");
    ensureColumn("event_repeat_requests", "notified_at", "TEXT");
    ensureColumn("event_repeat_requests", "notification_event_id", "TEXT");
    ensureColumn("event_repeat_requests", "delivery_status", "TEXT");
    ensureColumn("event_attendance_sessions", "paused_at", "TEXT");
    ensureColumn("event_attendance_sessions", "paused_by_user_id", "TEXT");
    ensureColumn("event_attendance_sessions", "resumed_at", "TEXT");
    ensureColumn("event_attendance_sessions", "resumed_by_user_id", "TEXT");

    // Inventory.
    const inventoryColumns = {
      inventory_id: "TEXT", item_name: "TEXT", main_category: "TEXT", piano_part_category: "TEXT",
      item_type: "TEXT", acquisition_type: "TEXT", supplier: "TEXT", manufacturer: "TEXT",
      purchase_price: "REAL DEFAULT 0", manufacturing_cost: "REAL DEFAULT 0", quantity: "REAL DEFAULT 1",
      unit: "TEXT", condition_status: "TEXT", location: "TEXT", linked_piano_id: "TEXT",
      linked_client_id: "TEXT", status: "TEXT DEFAULT 'In Stock'", notes: "TEXT", deleted_at: "TEXT",
      deleted_by: "TEXT", created_by: "TEXT", created_by_user_id: "TEXT", reserved_quantity: "REAL DEFAULT 0"
    };
    for (const [name, definition] of Object.entries(inventoryColumns)) ensureColumn("inventory_items", name, definition);

    // Planned jobs.
    const plannedColumns = {
      planned_key: "TEXT", planned_type: "TEXT", title: "TEXT", client_id: "TEXT", client_name: "TEXT",
      client_phone: "TEXT", piano_id: "TEXT", piano_name: "TEXT", service_address: "TEXT",
      preferred_assigned_to: "TEXT", preferred_assigned_user_id: "TEXT", priority: "TEXT",
      expected_revenue: "REAL DEFAULT 0", probability: "TEXT DEFAULT '100% - Biztos'",
      estimated_hours: "REAL DEFAULT 0", target_date: "TEXT", status: "TEXT", block_reason: "TEXT",
      next_step: "TEXT", notes: "TEXT", converted_job_id: "TEXT", created_by: "TEXT",
      created_by_user_id: "TEXT", archived_at: "TEXT", archived_by: "TEXT", workflow_id: "TEXT"
    };
    for (const [name, definition] of Object.entries(plannedColumns)) ensureColumn("planned_jobs", name, definition);
  });

  migrateColumns();
  migrateInvoicePaymentStandards();
  migrateInvoiceAdjustmentImmutability();
  backfillInvoiceRevenueRecognition();
  backfillEventRefundCreditMemos();
  ensureInvoiceImmutability();
  migrateEventTicketData();
  migrateWebsiteContactLeadStatuses();
  migrateCustomerConversationSchema();
  migrateEventArtistForeignKey();
  migrateUsersRoleConstraint();
  backfillUserCalendarColors(db, log);

  cleanupDuplicateImportBatches();
  neutralizeDuplicateImportReferences("contacts");
  neutralizeDuplicateImportReferences("pianos");

  ensureIndex("idx_contacts_import_reference", `CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_import_reference ON contacts(import_source,external_reference) WHERE import_source IS NOT NULL AND external_reference IS NOT NULL`);
  ensureIndex("idx_contacts_email", "CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)");
  ensureIndex("idx_contacts_phone", "CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone)");
  ensureIndex("idx_contacts_import_batch", "CREATE INDEX IF NOT EXISTS idx_contacts_import_batch ON contacts(import_batch_id)");
  ensureIndex("idx_import_batches_file_hash_source", `CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batches_file_hash_source ON import_batches(import_source,file_hash) WHERE import_source IS NOT NULL AND file_hash IS NOT NULL`);
  ensureIndex("idx_pianos_import_reference", `CREATE UNIQUE INDEX IF NOT EXISTS idx_pianos_import_reference ON pianos(import_source,external_reference) WHERE import_source IS NOT NULL AND external_reference IS NOT NULL`);
  ensureIndex("idx_pianos_import_batch", "CREATE INDEX IF NOT EXISTS idx_pianos_import_batch ON pianos(import_batch_id)");
  ensureIndex("idx_pianos_owner_resolution", "CREATE INDEX IF NOT EXISTS idx_pianos_owner_resolution ON pianos(owner_resolution)");
  ensureIndex("idx_pianos_owner_contact", "CREATE INDEX IF NOT EXISTS idx_pianos_owner_contact ON pianos(owner_contact_id)");
  ensureIndex("idx_client_pianos_client", "CREATE INDEX IF NOT EXISTS idx_client_pianos_client ON client_pianos(client_id,piano_id)");
  ensureIndex("idx_client_pianos_piano", "CREATE INDEX IF NOT EXISTS idx_client_pianos_piano ON client_pianos(piano_id,client_id)");
  ensureIndex("idx_client_pianos_verified", "CREATE INDEX IF NOT EXISTS idx_client_pianos_verified ON client_pianos(is_verified,client_id,piano_id)");
  ensureFinancialSourceUniqueIndex();
  ensureIndex("idx_inventory_items_inventory_id", "CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_inventory_id ON inventory_items(inventory_id) WHERE inventory_id IS NOT NULL");
  ensureIndex("idx_inventory_items_category", "CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(main_category,piano_part_category,status)");
  ensureIndex("idx_planned_jobs_key", "CREATE UNIQUE INDEX IF NOT EXISTS idx_planned_jobs_key ON planned_jobs(planned_key) WHERE planned_key IS NOT NULL");
  ensureIndex("idx_planned_jobs_status", "CREATE INDEX IF NOT EXISTS idx_planned_jobs_status ON planned_jobs(status,planned_type)");
  ensureIndex("idx_jobs_workflow_root", "CREATE INDEX IF NOT EXISTS idx_jobs_workflow_root ON jobs(workflow_root_id,workflow_step_no)");
  ensureIndex("idx_jobs_workflow_id", "CREATE INDEX IF NOT EXISTS idx_jobs_workflow_id ON jobs(workflow_id)");
  if (tableExists("workshop_workflows")) ensureIndex("idx_workshop_workflows_job_id", "CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_workflows_job_id ON workshop_workflows(job_id) WHERE job_id IS NOT NULL AND trim(job_id)<>''");
  ensureIndex("idx_jobs_assigned_user_id", "CREATE INDEX IF NOT EXISTS idx_jobs_assigned_user_id ON jobs(assigned_user_id)");
  ensureIndex("idx_jobs_time_range", "CREATE INDEX IF NOT EXISTS idx_jobs_time_range ON jobs(start_time,end_time)");
  ensureIndex("idx_jobs_assignee_time_range", "CREATE INDEX IF NOT EXISTS idx_jobs_assignee_time_range ON jobs(assigned_user_id,start_time,end_time)");
  ensureNormalizedUserEmailIndexes();
  ensureNormalizedContactEmailIndexes();
  ensureIndex("idx_users_google_calendar_email", "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_calendar_email ON users(lower(trim(google_calendar_email))) WHERE google_calendar_email IS NOT NULL AND trim(google_calendar_email)<>''");
  ensureIndex("idx_external_calendar_events_job", "CREATE INDEX IF NOT EXISTS idx_external_calendar_events_job ON external_calendar_events(job_id)");
  ensureIndex("idx_external_calendar_events_review", "CREATE INDEX IF NOT EXISTS idx_external_calendar_events_review ON external_calendar_events(review_status,updated_at DESC)");
  ensureIndex("idx_calendar_sync_log_started", "CREATE INDEX IF NOT EXISTS idx_calendar_sync_log_started ON calendar_sync_log(started_at DESC)");
  ensureIndex("idx_audit_type_time", "CREATE INDEX IF NOT EXISTS idx_audit_type_time ON audit_log(audit_type,event_time DESC)");
  ensureColumn("push_subscriptions", "language", "TEXT DEFAULT 'en'");
  ensureColumn("push_subscriptions", "device_id", "TEXT");
  ensureColumn("push_subscriptions", "last_seen_at", "TEXT DEFAULT CURRENT_TIMESTAMP");
  ensureColumn("push_subscriptions", "verified_at", "TEXT");
    ensureIndex("idx_notifications_event_key", "CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_key ON notifications(event_key) WHERE event_key IS NOT NULL");
  ensureIndex("idx_notifications_recipient_status", "CREATE INDEX IF NOT EXISTS idx_notifications_recipient_status ON notifications(recipient_user_id,status,created_at DESC)");
  ensureIndex("idx_notifications_job", "CREATE INDEX IF NOT EXISTS idx_notifications_job ON notifications(related_job_id)");
  ensureIndex("idx_push_subscriptions_user", "CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)");
  ensureIndex("idx_notification_devices_user_status", "CREATE INDEX IF NOT EXISTS idx_notification_devices_user_status ON notification_devices(user_id,status)");
  ensureIndex("idx_push_activation_tests_user_device", "CREATE INDEX IF NOT EXISTS idx_push_activation_tests_user_device ON push_activation_tests(user_id,device_id,created_at DESC)");
  ensureIndex("idx_account_activations_status", "CREATE INDEX IF NOT EXISTS idx_account_activations_status ON account_activations(status,updated_at DESC)");
  ensureIndex("idx_activation_email_log_user", "CREATE INDEX IF NOT EXISTS idx_activation_email_log_user ON activation_email_log(user_id,created_at DESC)");
  ensureIndex("idx_activation_email_log_provider_id", "CREATE UNIQUE INDEX IF NOT EXISTS idx_activation_email_log_provider_id ON activation_email_log(provider_message_id) WHERE provider_message_id IS NOT NULL AND trim(provider_message_id)<>''");
  ensureIndex("idx_events_public_schedule", "CREATE INDEX IF NOT EXISTS idx_events_public_schedule ON events(access_type,status,published_at,start_at)");
  ensureIndex("idx_events_category_schedule", "CREATE INDEX IF NOT EXISTS idx_events_category_schedule ON events(category_id,start_at)");
  ensureIndex("idx_events_artist_schedule", "CREATE INDEX IF NOT EXISTS idx_events_artist_schedule ON events(artist_id,start_at)");
  ensureIndex("idx_event_invitations_event_status", "CREATE INDEX IF NOT EXISTS idx_event_invitations_event_status ON event_invitations(event_id,status,created_at)");
  ensureIndex("idx_event_invitations_email", "CREATE INDEX IF NOT EXISTS idx_event_invitations_email ON event_invitations(lower(trim(guest_email)))");
  ensureIndex("idx_event_tickets_event_status", "CREATE INDEX IF NOT EXISTS idx_event_tickets_event_status ON event_tickets(event_id,status,source_type)");
  ensureIndex("idx_event_tickets_variant", "CREATE INDEX IF NOT EXISTS idx_event_tickets_variant ON event_tickets(event_id,ticket_variant,status)");
  ensureIndex("idx_event_ticket_documents_ticket", "CREATE INDEX IF NOT EXISTS idx_event_ticket_documents_ticket ON event_ticket_documents(ticket_id,document_type)");
  ensureIndex("idx_event_refund_execution", "CREATE INDEX IF NOT EXISTS idx_event_refund_execution ON event_refund_requests(event_id,execution_status,requested_at DESC)");
  ensureIndex("idx_event_tickets_contact", "CREATE INDEX IF NOT EXISTS idx_event_tickets_contact ON event_tickets(lower(trim(contact_email)))");
  ensureIndex("idx_event_tickets_contact_id", "CREATE INDEX IF NOT EXISTS idx_event_tickets_contact_id ON event_tickets(contact_id)");
  ensureIndex("idx_event_attendance_sessions_event", "CREATE UNIQUE INDEX IF NOT EXISTS idx_event_attendance_sessions_event ON event_attendance_sessions(event_id)");
  ensureIndex("idx_event_attendance_entries_event_status", "CREATE INDEX IF NOT EXISTS idx_event_attendance_entries_event_status ON event_attendance_entries(event_id,status,updated_at)");
  ensureIndex("idx_event_attendance_entries_ticket", "CREATE UNIQUE INDEX IF NOT EXISTS idx_event_attendance_entries_ticket ON event_attendance_entries(ticket_id)");
  ensureIndex("idx_event_attendance_actions_event_time", "CREATE INDEX IF NOT EXISTS idx_event_attendance_actions_event_time ON event_attendance_actions(event_id,created_at DESC)");
  ensureIndex("idx_event_attendance_exports_event_version", "CREATE INDEX IF NOT EXISTS idx_event_attendance_exports_event_version ON event_attendance_exports(event_id,export_version DESC,created_at DESC)");
  ensureColumn("customer_conversations", "public_token_encrypted", "TEXT");
  ensureIndex("idx_event_checkins_event_time", "CREATE INDEX IF NOT EXISTS idx_event_checkins_event_time ON event_checkins(event_id,created_at DESC)");
  ensureIndex("idx_event_refunds_event_status", "CREATE INDEX IF NOT EXISTS idx_event_refunds_event_status ON event_refund_requests(event_id,status,requested_at DESC)");
  ensureIndex("idx_event_holds_event_status_expiry", "CREATE INDEX IF NOT EXISTS idx_event_holds_event_status_expiry ON event_checkout_holds(event_id,status,expires_at)");
  ensureIndex("idx_event_holds_session", "CREATE UNIQUE INDEX IF NOT EXISTS idx_event_holds_session ON event_checkout_holds(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL");
  ensureIndex("idx_event_payments_event_status", "CREATE INDEX IF NOT EXISTS idx_event_payments_event_status ON event_payments(event_id,status,created_at DESC)");
  ensureIndex("idx_event_tickets_payment", "CREATE INDEX IF NOT EXISTS idx_event_tickets_payment ON event_tickets(event_payment_id,ticket_sequence)");
  ensureIndex("idx_stripe_webhook_status", "CREATE INDEX IF NOT EXISTS idx_stripe_webhook_status ON stripe_webhook_events(status,received_at DESC)");
  ensureIndex("idx_website_content_updated", "CREATE INDEX IF NOT EXISTS idx_website_content_updated ON website_content_pages(updated_at DESC)");
  ensureIndex("idx_website_reviews_public", "CREATE INDEX IF NOT EXISTS idx_website_reviews_public ON website_reviews(visible,sort_order,updated_at DESC)");
  ensureIndex("idx_showroom_pianos_public", "CREATE INDEX IF NOT EXISTS idx_showroom_pianos_public ON website_showroom_pianos(published,availability_status,featured,sort_order,updated_at DESC)");
  ensureIndex("idx_website_services_public", "CREATE INDEX IF NOT EXISTS idx_website_services_public ON website_services(visible,featured,sort_order,updated_at DESC)");
  ensureIndex("idx_website_artists_public", "CREATE INDEX IF NOT EXISTS idx_website_artists_public ON website_artists(published,featured,sort_order,updated_at DESC)");
  ensureIndex("idx_website_media_created", "CREATE INDEX IF NOT EXISTS idx_website_media_created ON website_media(created_at DESC)");
  ensureIndex("idx_website_leads_status", "CREATE INDEX IF NOT EXISTS idx_website_leads_status ON website_contact_leads(status,created_at DESC)");
  ensureIndex("idx_website_content_versions", "CREATE INDEX IF NOT EXISTS idx_website_content_versions ON website_content_versions(page_key,language,version DESC)");
  ensureIndex("idx_website_preview_expiry", "CREATE INDEX IF NOT EXISTS idx_website_preview_expiry ON website_preview_tokens(expires_at)");
  ensureIndex("idx_website_integration_oauth_expiry", "CREATE INDEX IF NOT EXISTS idx_website_integration_oauth_expiry ON website_integration_oauth_states(expires_at)");
  ensureIndex("idx_system_integration_health_status", "CREATE INDEX IF NOT EXISTS idx_system_integration_health_status ON system_integration_health(status,provider)");
  ensureIndex("idx_system_integration_backups_provider", "CREATE INDEX IF NOT EXISTS idx_system_integration_backups_provider ON system_integration_backups(provider,created_at DESC)");
  ensureIndex("idx_system_integration_delete_expiry", "CREATE INDEX IF NOT EXISTS idx_system_integration_delete_expiry ON system_integration_delete_tokens(expires_at)");
  ensureIndex("idx_system_integration_test_expiry", "CREATE INDEX IF NOT EXISTS idx_system_integration_test_expiry ON system_integration_test_tokens(expires_at)");
  ensureIndex("idx_event_repeat_requests", "CREATE INDEX IF NOT EXISTS idx_event_repeat_requests ON event_repeat_requests(event_id,created_at DESC)");
  ensureIndex("idx_marketing_campaigns_active", "CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_active ON marketing_campaigns(active,updated_at DESC)");
  ensureIndex("idx_website_tracking_events", "CREATE INDEX IF NOT EXISTS idx_website_tracking_events ON website_tracking_events(event_name,created_at DESC)");
  ensureIndex("idx_customer_conversations_status", "CREATE INDEX IF NOT EXISTS idx_customer_conversations_status ON customer_conversations(status,updated_at DESC)");
  ensureIndex("idx_customer_conversations_email", "CREATE INDEX IF NOT EXISTS idx_customer_conversations_email ON customer_conversations(lower(trim(email)),updated_at DESC)");
  ensureIndex("idx_customer_conversations_visitor_token", "CREATE INDEX IF NOT EXISTS idx_customer_conversations_visitor_token ON customer_conversations(visitor_token_hash,updated_at DESC)");
  ensureIndex("idx_customer_messages_conversation", "CREATE INDEX IF NOT EXISTS idx_customer_messages_conversation ON customer_messages(conversation_id,created_at)");
  ensureIndex("idx_customer_message_attachments_message", "CREATE INDEX IF NOT EXISTS idx_customer_message_attachments_message ON customer_message_attachments(message_id,created_at)");
  ensureIndex("idx_customer_conversation_events_conversation", "CREATE INDEX IF NOT EXISTS idx_customer_conversation_events_conversation ON customer_conversation_events(conversation_id,created_at,id)");
  ensureIndex("idx_support_holidays_date", "CREATE UNIQUE INDEX IF NOT EXISTS idx_support_holidays_date ON support_holidays(holiday_date)");
  ensureIndex("idx_communication_deliveries_status", "CREATE INDEX IF NOT EXISTS idx_communication_deliveries_status ON communication_deliveries(status,updated_at DESC)");

  db.prepare("UPDATE jobs SET job_key='JK-'||id WHERE job_key IS NULL OR job_key='' ").run();
  db.prepare("UPDATE jobs SET workflow_root_id=COALESCE(NULLIF(workflow_root_id,''),id),workflow_step_no=COALESCE(workflow_step_no,1),workflow_status=COALESCE(NULLIF(workflow_status,''),CASE WHEN status='Completed' THEN 'COMPLETED' WHEN status='Partially completed' THEN 'IN_PROGRESS' WHEN status='Failed' THEN 'FAILED' ELSE 'ACTIVE' END)").run();
  db.prepare("UPDATE jobs SET planned_minutes=CAST(ROUND(COALESCE(planned_hours,0)*60) AS INTEGER) WHERE COALESCE(planned_minutes,0)=0 AND COALESCE(planned_hours,0)>0").run();
  ensureSteinwayReferenceTables(db);
  log("Steinway serial/model reference tables synchronized");

  db.prepare("UPDATE pianos SET ownership_type=COALESCE(NULLIF(ownership_type,''),ownership,'Customer owned')").run();
  db.prepare("UPDATE pianos SET display_name=trim(COALESCE(NULLIF(original_description,''),COALESCE(brand,'')||' '||COALESCE(model,''))) WHERE display_name IS NULL OR display_name='' ").run();

  const accounts = [
    ["1000","Cash","Készpénz","ASSET","DEBIT"],["1010","Bank","Bank","ASSET","DEBIT"],
    ["1020","Undeposited Checks","Befizetés előtti csekkek","ASSET","DEBIT"],
    ["1200","Accounts Receivable","Vevőkövetelés","ASSET","DEBIT"],["1300","Inventory","Készlet","ASSET","DEBIT"],
    ["1500","Fixed Assets","Befektetett eszközök","ASSET","DEBIT"],["2000","Accounts Payable","Szállítói tartozás","LIABILITY","CREDIT"],["2010","Sales Tax Payable","Fizetendő forgalmi adó","LIABILITY","CREDIT"],["2020","Deferred Revenue","Halasztott bevétel","LIABILITY","CREDIT"],
    ["2100","SBA Loan","SBA hitel","LIABILITY","CREDIT"],["3000","Owner Equity","Saját tőke","EQUITY","CREDIT"],
    ["4000","Sales Revenue","Árbevétel","REVENUE","CREDIT"],["4100","Restoration Revenue","Felújítási bevétel","REVENUE","CREDIT"],
    ["4200","Tuning Revenue","Hangolási bevétel","REVENUE","CREDIT"],["4300","Concert Service Revenue","Koncertszerviz bevétel","REVENUE","CREDIT"],["4390","Ticket Refund Contra Revenue","Jegy-visszatérítés bevételcsökkentés","REVENUE","DEBIT"],
    ["5000","Cost of Goods Sold","Eladott áruk költsége","EXPENSE","DEBIT"],["6100","Rent Expense","Bérleti díj","EXPENSE","DEBIT"],
    ["6200","Transport Expense","Szállítási költség","EXPENSE","DEBIT"],["6300","Payroll Expense","Bérköltség","EXPENSE","DEBIT"],
    ["6400","Interest Expense","Kamatköltség","EXPENSE","DEBIT"]
  ];
  const insertAccount = db.prepare("INSERT OR IGNORE INTO accounts(code,name_en,name_hu,category,normal_side) VALUES(?,?,?,?,?)");
  db.transaction(() => accounts.forEach((account) => insertAccount.run(...account)))();


  // Every existing user receives enabled notification preferences. This one-time backfill does not overwrite later user choices.
  db.prepare(`INSERT OR IGNORE INTO notification_preferences(user_id,push_enabled,job_assigned,job_transferred,job_updated,job_deleted,one_hour_reminder,direct_message)
    SELECT id,1,1,1,1,1,1,1 FROM users`).run();
  const notificationBackfill = db.prepare("SELECT setting_value FROM app_settings WHERE setting_key='notification_preferences_v1_backfilled'").get();
  if (!notificationBackfill) {
    db.prepare(`UPDATE notification_preferences SET push_enabled=1,job_assigned=1,job_transferred=1,job_updated=1,job_deleted=1,one_hour_reminder=1,direct_message=1,updated_at=CURRENT_TIMESTAMP`).run();
    db.prepare("INSERT INTO app_settings(setting_key,setting_value,updated_by) VALUES('notification_preferences_v1_backfilled','1','SYSTEM')").run();
    log('Enabled all notification preferences for existing users');
  }
  assertPreservedBusinessCounts(preservedCounts);
  // Automatic sample installation was intentionally removed. Existing rows
  // remain untouched and restarts never create new sample records.
  const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyErrors.length) throw new Error(`Foreign-key integrity check failed: ${JSON.stringify(foreignKeyErrors.slice(0, 10))}`);
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.some((row) => String(row.integrity_check || "").toLowerCase() !== "ok")) {
    throw new Error(`SQLite integrity check failed: ${JSON.stringify(integrity)}`);
  }
  log("SQLite integrity and foreign-key checks passed");
  // No user, customer piano, job, inventory or financial demo record is seeded.
  const users = db.prepare("SELECT id,email,is_superadmin,status FROM users ORDER BY created_at").all();
  const superadmins = users.filter((user) => Number(user.is_superadmin || 0) === 1 && user.status === "Active");
  log(`Initialization preserved ${users.length} existing user account(s), including ${superadmins.length} active superadmin account(s)`);
  if (superadmins.length === 0) log("WARNING: no active superadmin exists; initialization will not create one automatically");
}

try {
  runMigrations();
  log(`Klavierhaus database initialized successfully: ${dbPath}`);
  db.close();
} catch (error) {
  fail("Database initialization failed", error);
}

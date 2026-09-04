const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { backfillUserCalendarColors } = require("./calendar-colors");
const { SAMPLE_VERSION_KEY, installSampleContent } = require("./sample-content");
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
    if (after[tableName] !== count) {
      throw new Error(`Data-preservation check failed for ${tableName}: before=${count}, after=${after[tableName]}`);
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
  const inventoryMissingCreator = tableExists("inventory_items") && !tableColumns("inventory_items").has("created_by_user_id");
  const jobsMissingPlannedMinutes = tableExists("jobs") && !tableColumns("jobs").has("planned_minutes");
  const googleIntegrationMissing = tableExists("users") && !tableExists("calendar_integrations");
  const activationTablesMissing = tableExists("users") && (!tableExists("account_activations") || !tableExists("activation_email_log") || !tableExists("activation_email_events"));
  const eventTablesMissing = tableExists("users") && (!tableExists("events") || !tableExists("event_tickets") || !tableExists("event_invitations"));
  const websiteCatalogTablesMissing = tableExists("users") && (!tableExists("website_reviews") || !tableExists("website_showroom_pianos") || !tableExists("website_services"));
  const websitePlatformTablesMissing = tableExists("users") && (!tableExists("website_artists") || !tableExists("website_media") || !tableExists("website_contact_leads") || !tableExists("website_content_versions") || !tableExists("event_repeat_requests") || !tableExists("website_integration_settings") || !tableExists("website_integration_oauth_states") || !tableExists("marketing_campaigns") || !tableExists("website_tracking_events"));
  const eventPlatformColumnsMissing = tableExists("events") && ["sold_out_at", "is_sample", "relaunch_source_event_id", "attendance_mode", "attendance_closed_at", "attendance_closed_by_user_id"].some((column) => !tableColumns("events").has(column));
  const ticketPlatformColumnsMissing = tableExists("event_tickets") && ["event_payment_id", "ticket_sequence", "ticket_variant"].some((column) => !tableColumns("event_tickets").has(column));
  const eventArtistForeignKeyMissing = tableExists("events") && !db.prepare("PRAGMA foreign_key_list(events)").all().some((row) => row.from === "artist_id" && row.table === "website_artists");
  const sampleFlagsMissing = ["website_reviews", "website_showroom_pianos", "website_services"].some((table) => tableExists(table) && !tableColumns(table).has("is_sample"));
  const sampleContentMissing = tableExists("app_settings") && !db.prepare("SELECT 1 FROM app_settings WHERE setting_key=?").get(SAMPLE_VERSION_KEY);
  const conversationCategoryMissing = tableExists("customer_conversations") && !String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customer_conversations'").get()?.sql || "").toUpperCase().includes("'TECHNICAL'");
  return usersSql.includes("'VIEWER'") || usersMissingCalendarColor || usersMissingGoogleCalendarEmail || usersMissingContactEmail || inventoryMissingCreator || jobsMissingPlannedMinutes || googleIntegrationMissing || activationTablesMissing || eventTablesMissing || websiteCatalogTablesMissing || websitePlatformTablesMissing || eventPlatformColumnsMissing || ticketPlatformColumnsMissing || eventArtistForeignKeyMissing || sampleFlagsMissing || sampleContentMissing || conversationCategoryMissing;
}

function migrateCustomerConversationCategoryConstraint() {
  if (!tableExists("customer_conversations")) return;
  const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='customer_conversations'").get()?.sql || "").toUpperCase();
  if (sql.includes("'TECHNICAL'")) return;
  log("Adding TECHNICAL to the customer conversation categories while preserving conversations");
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE customer_conversations_new (
        id TEXT PRIMARY KEY,public_token_hash TEXT NOT NULL UNIQUE,public_token_encrypted TEXT,name TEXT NOT NULL,email TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','hu')),
        category TEXT NOT NULL CHECK(category IN ('SERVICE','PIANO','EVENT','REFUND','PRIVATE_CONSULTATION','TECHNICAL','GENERAL')),
        service_id TEXT,piano_id TEXT,event_id TEXT,ticket_id TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PENDING_CUSTOMER','PENDING_STAFF','CLOSED')),
        assigned_user_id TEXT,consent_contact INTEGER NOT NULL DEFAULT 0 CHECK(consent_contact IN (0,1)),source_path TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',last_message_at TEXT,closed_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(service_id) REFERENCES website_services(id) ON DELETE SET NULL,FOREIGN KEY(piano_id) REFERENCES website_showroom_pianos(id) ON DELETE SET NULL,
        FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL,FOREIGN KEY(ticket_id) REFERENCES event_tickets(id) ON DELETE SET NULL,
        FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`);
      db.exec(`INSERT INTO customer_conversations_new SELECT id,public_token_hash,public_token_encrypted,name,email,language,category,service_id,piano_id,event_id,ticket_id,status,assigned_user_id,consent_contact,source_path,metadata_json,last_message_at,closed_at,created_at,updated_at FROM customer_conversations`);
      db.exec("DROP TABLE customer_conversations");
      db.exec("ALTER TABLE customer_conversations_new RENAME TO customer_conversations");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
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

function migrateEventArtistForeignKey() {
  const hasArtistForeignKey = db.prepare("PRAGMA foreign_key_list(events)").all()
    .some((row) => row.from === "artist_id" && row.table === "website_artists");
  if (hasArtistForeignKey) return;
  log("Adding the stable events.artist_id foreign-key relation while preserving event records");
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE events_new (
        id TEXT PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,category_id TEXT NOT NULL,
        access_type TEXT NOT NULL CHECK(access_type IN ('PUBLIC_PAID','PUBLIC_FREE','INVITE_ONLY','INTERNAL')),
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','RESCHEDULED','CANCELLED','COMPLETED','CLOSED')),
        slug_en TEXT NOT NULL UNIQUE,slug_hu TEXT NOT NULL UNIQUE,title_en TEXT NOT NULL,title_hu TEXT NOT NULL,
        short_description_en TEXT,short_description_hu TEXT,description_en TEXT,description_hu TEXT,artist_id TEXT,performer_name TEXT,
        hero_image_url TEXT,hero_image_alt_en TEXT,hero_image_alt_hu TEXT,gallery_json TEXT DEFAULT '[]',venue_name TEXT NOT NULL,
        venue_street TEXT NOT NULL,venue_city TEXT NOT NULL,venue_region TEXT NOT NULL,venue_postal_code TEXT NOT NULL,
        venue_country TEXT NOT NULL DEFAULT 'US',timezone TEXT NOT NULL DEFAULT 'America/New_York',start_at TEXT NOT NULL,end_at TEXT NOT NULL,
        previous_start_at TEXT,cancellation_reason TEXT,cancelled_at TEXT,cancelled_by_user_id TEXT,
        capacity_total INTEGER NOT NULL CHECK(capacity_total > 0),price_cents INTEGER NOT NULL DEFAULT 0 CHECK(price_cents >= 0),
        currency TEXT NOT NULL DEFAULT 'USD',sales_start_at TEXT,sales_end_at TEXT,refund_policy_version TEXT NOT NULL DEFAULT 'KH-48H-V1',
        published_at TEXT,closed_at TEXT,closed_by_user_id TEXT,closure_snapshot_json TEXT,sold_out_at TEXT,
        is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1)),relaunch_source_event_id TEXT,created_by_user_id TEXT,updated_by_user_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(category_id) REFERENCES event_categories(id),FOREIGN KEY(artist_id) REFERENCES website_artists(id) ON DELETE SET NULL,
        FOREIGN KEY(cancelled_by_user_id) REFERENCES users(id) ON DELETE SET NULL,FOREIGN KEY(closed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,FOREIGN KEY(updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY(relaunch_source_event_id) REFERENCES events_new(id) ON DELETE SET NULL
      )`);
      db.exec(`INSERT INTO events_new SELECT e.id,e.event_key,e.category_id,e.access_type,e.status,e.slug_en,e.slug_hu,e.title_en,e.title_hu,
        e.short_description_en,e.short_description_hu,e.description_en,e.description_hu,
        CASE WHEN a.id IS NULL THEN NULL ELSE e.artist_id END,e.performer_name,e.hero_image_url,e.hero_image_alt_en,
        e.hero_image_alt_hu,e.gallery_json,e.venue_name,e.venue_street,e.venue_city,e.venue_region,e.venue_postal_code,e.venue_country,e.timezone,e.start_at,e.end_at,
        e.previous_start_at,e.cancellation_reason,e.cancelled_at,e.cancelled_by_user_id,e.capacity_total,e.price_cents,e.currency,e.sales_start_at,e.sales_end_at,
        e.refund_policy_version,e.published_at,e.closed_at,e.closed_by_user_id,e.closure_snapshot_json,e.sold_out_at,e.is_sample,e.relaunch_source_event_id,
        e.created_by_user_id,e.updated_by_user_id,e.created_at,e.updated_at FROM events e LEFT JOIN website_artists a ON a.id=e.artist_id`);
      db.exec("DROP TABLE events");
      db.exec("ALTER TABLE events_new RENAME TO events");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      INSERT INTO users_new(
        id,name,email,password_hash,role,status,phone,address,calendar_color,google_calendar_email,contact_email,hidden_user,is_superadmin,created_at,updated_at
      )
      SELECT
        id,name,email,password_hash,
        CASE WHEN role IN ('ADMIN','MANAGER','WORKER') THEN role ELSE 'WORKER' END,
        CASE WHEN role='VIEWER' THEN 'Inactive' ELSE COALESCE(status,'Active') END,
        phone,address,calendar_color,google_calendar_email,contact_email,COALESCE(hidden_user,0),COALESCE(is_superadmin,0),created_at,updated_at
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

function runMigrations() {
  const preservedCounts = preservedBusinessCounts();
  createPreMigrationBackup();
  db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
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

    // Contacts and customer import.
    ensureColumn("contacts", "address", "TEXT");
    ensureColumn("contacts", "billing_address", "TEXT");
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
    ensureColumn("pianos", "ownership_type", "TEXT DEFAULT 'Customer owned'");
    ensureColumn("pianos", "display_name", "TEXT");
    ensureColumn("pianos", "asset_recorded", "INTEGER DEFAULT 0");
    ensureColumn("pianos", "external_reference", "TEXT");
    ensureColumn("pianos", "import_source", "TEXT");
    ensureColumn("pianos", "import_batch_id", "TEXT");
    ensureColumn("pianos", "original_description", "TEXT");
    ensureColumn("pianos", "owner_resolution", "TEXT");

    // Jobs and immutable user/workflow links.
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

    // Import batches.
    ensureColumn("import_batches", "imported_pianos", "INTEGER DEFAULT 0");
    ensureColumn("import_batches", "updated_clients", "INTEGER DEFAULT 0");
    ensureColumn("import_batches", "unidentified_owner_pianos", "INTEGER DEFAULT 0");
    ensureColumn("import_batches", "client_not_found", "INTEGER DEFAULT 0");
    ensureColumn("audit_log", "audit_type", "TEXT DEFAULT 'TECHNICAL'");

    // Financial items.
    ensureColumn("financial_items", "source_type", "TEXT");
    ensureColumn("financial_items", "source_id", "TEXT");

    // Public events and Stripe Sandbox. These nullable additions preserve every
    // existing event and ticket while enabling cancellation and payment links.
    ensureColumn("events", "cancellation_reason", "TEXT");
    ensureColumn("events", "cancelled_at", "TEXT");
    ensureColumn("events", "cancelled_by_user_id", "TEXT");
    ensureColumn("events", "hero_image_alt_en", "TEXT");
    ensureColumn("events", "hero_image_alt_hu", "TEXT");
    ensureColumn("events", "sold_out_at", "TEXT");
    ensureColumn("events", "is_sample", "INTEGER DEFAULT 0");
    ensureColumn("events", "relaunch_source_event_id", "TEXT");
    ensureColumn("events", "attendance_mode", "TEXT NOT NULL DEFAULT 'UNSET'");
    ensureColumn("events", "attendance_closed_at", "TEXT");
    ensureColumn("events", "attendance_closed_by_user_id", "TEXT");
    ensureColumn("events", "artist_id", "TEXT");
    ensureColumn("event_tickets", "event_payment_id", "TEXT");
    ensureColumn("event_tickets", "ticket_sequence", "INTEGER");
    ensureColumn("event_tickets", "ticket_variant", "TEXT NOT NULL DEFAULT 'PUBLIC'");
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

    // Inventory.
    const inventoryColumns = {
      inventory_id: "TEXT", item_name: "TEXT", main_category: "TEXT", piano_part_category: "TEXT",
      item_type: "TEXT", acquisition_type: "TEXT", supplier: "TEXT", manufacturer: "TEXT",
      purchase_price: "REAL DEFAULT 0", manufacturing_cost: "REAL DEFAULT 0", quantity: "REAL DEFAULT 1",
      unit: "TEXT", condition_status: "TEXT", location: "TEXT", linked_piano_id: "TEXT",
      linked_client_id: "TEXT", status: "TEXT DEFAULT 'In Stock'", notes: "TEXT", deleted_at: "TEXT",
      deleted_by: "TEXT", created_by: "TEXT", created_by_user_id: "TEXT"
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
      created_by_user_id: "TEXT", archived_at: "TEXT", archived_by: "TEXT"
    };
    for (const [name, definition] of Object.entries(plannedColumns)) ensureColumn("planned_jobs", name, definition);
  });

  migrateColumns();
  migrateCustomerConversationCategoryConstraint();
  migrateWebsiteContactLeadStatuses();
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
  ensureIndex("idx_financial_items_source", "CREATE INDEX IF NOT EXISTS idx_financial_items_source ON financial_items(source_type,source_id)");
  ensureIndex("idx_inventory_items_inventory_id", "CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_inventory_id ON inventory_items(inventory_id) WHERE inventory_id IS NOT NULL");
  ensureIndex("idx_inventory_items_category", "CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(main_category,piano_part_category,status)");
  ensureIndex("idx_planned_jobs_key", "CREATE UNIQUE INDEX IF NOT EXISTS idx_planned_jobs_key ON planned_jobs(planned_key) WHERE planned_key IS NOT NULL");
  ensureIndex("idx_planned_jobs_status", "CREATE INDEX IF NOT EXISTS idx_planned_jobs_status ON planned_jobs(status,planned_type)");
  ensureIndex("idx_jobs_workflow_root", "CREATE INDEX IF NOT EXISTS idx_jobs_workflow_root ON jobs(workflow_root_id,workflow_step_no)");
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
  ensureIndex("idx_event_tickets_contact", "CREATE INDEX IF NOT EXISTS idx_event_tickets_contact ON event_tickets(lower(trim(contact_email)))");
  ensureColumn("customer_conversations", "public_token_encrypted", "TEXT");
  ensureIndex("idx_event_checkins_event_time", "CREATE INDEX IF NOT EXISTS idx_event_checkins_event_time ON event_checkins(event_id,created_at DESC)");
  ensureIndex("idx_event_refunds_event_status", "CREATE INDEX IF NOT EXISTS idx_event_refunds_event_status ON event_refund_requests(event_id,status,requested_at DESC)");
  ensureIndex("idx_event_holds_event_status_expiry", "CREATE INDEX IF NOT EXISTS idx_event_holds_event_status_expiry ON event_checkout_holds(event_id,status,expires_at)");
  ensureIndex("idx_event_holds_session", "CREATE UNIQUE INDEX IF NOT EXISTS idx_event_holds_session ON event_checkout_holds(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL");
  ensureIndex("idx_event_payments_event_status", "CREATE INDEX IF NOT EXISTS idx_event_payments_event_status ON event_payments(event_id,status,created_at DESC)");
  ensureIndex("idx_event_tickets_payment", "CREATE INDEX IF NOT EXISTS idx_event_tickets_payment ON event_tickets(event_payment_id,ticket_sequence)");
  ensureIndex("idx_event_ticket_refund_reviews_event", "CREATE INDEX IF NOT EXISTS idx_event_ticket_refund_reviews_event ON event_ticket_refund_reviews(event_id,created_at DESC)");
  ensureIndex("idx_event_ticket_refund_reviews_ticket", "CREATE INDEX IF NOT EXISTS idx_event_ticket_refund_reviews_ticket ON event_ticket_refund_reviews(ticket_id,created_at DESC)");
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
  ensureIndex("idx_event_repeat_requests", "CREATE INDEX IF NOT EXISTS idx_event_repeat_requests ON event_repeat_requests(event_id,created_at DESC)");
  ensureIndex("idx_marketing_campaigns_active", "CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_active ON marketing_campaigns(active,updated_at DESC)");
  ensureIndex("idx_website_tracking_events", "CREATE INDEX IF NOT EXISTS idx_website_tracking_events ON website_tracking_events(event_name,created_at DESC)");
  ensureIndex("idx_customer_conversations_status", "CREATE INDEX IF NOT EXISTS idx_customer_conversations_status ON customer_conversations(status,updated_at DESC)");
  ensureIndex("idx_customer_conversations_email", "CREATE INDEX IF NOT EXISTS idx_customer_conversations_email ON customer_conversations(lower(trim(email)),updated_at DESC)");
  ensureIndex("idx_customer_messages_conversation", "CREATE INDEX IF NOT EXISTS idx_customer_messages_conversation ON customer_messages(conversation_id,created_at)");
  ensureIndex("idx_communication_deliveries_status", "CREATE INDEX IF NOT EXISTS idx_communication_deliveries_status ON communication_deliveries(status,updated_at DESC)");

  db.prepare("UPDATE jobs SET job_key='JK-'||id WHERE job_key IS NULL OR job_key='' ").run();
  db.prepare("UPDATE jobs SET workflow_root_id=COALESCE(NULLIF(workflow_root_id,''),id),workflow_step_no=COALESCE(workflow_step_no,1),workflow_status=COALESCE(NULLIF(workflow_status,''),CASE WHEN status='Completed' THEN 'COMPLETED' WHEN status='Partially completed' THEN 'IN_PROGRESS' WHEN status='Failed' THEN 'FAILED' ELSE 'ACTIVE' END)").run();
  db.prepare("UPDATE jobs SET planned_minutes=CAST(ROUND(COALESCE(planned_hours,0)*60) AS INTEGER) WHERE COALESCE(planned_minutes,0)=0 AND COALESCE(planned_hours,0)>0").run();
  db.prepare("UPDATE pianos SET ownership_type=COALESCE(NULLIF(ownership_type,''),ownership,'Customer owned')").run();
  db.prepare("UPDATE pianos SET display_name=trim(COALESCE(NULLIF(original_description,''),COALESCE(brand,'')||' '||COALESCE(model,''))) WHERE display_name IS NULL OR display_name='' ").run();
  db.prepare("UPDATE events SET attendance_mode=COALESCE(NULLIF(attendance_mode,''),'UNSET') WHERE attendance_mode IS NULL OR attendance_mode='' ").run();
  db.prepare("UPDATE event_tickets SET ticket_variant=CASE WHEN source_type='INVITATION' THEN 'INVITATION' WHEN source_type='COMPLIMENTARY' THEN 'COMPLIMENTARY' ELSE 'PUBLIC' END WHERE ticket_variant IS NULL OR ticket_variant='' ").run();

  const accounts = [
    ["1000","Cash","Készpénz","ASSET","DEBIT"],["1010","Bank","Bank","ASSET","DEBIT"],
    ["1020","Undeposited Checks","Befizetés előtti csekkek","ASSET","DEBIT"],
    ["1200","Accounts Receivable","Vevőkövetelés","ASSET","DEBIT"],["1300","Inventory","Készlet","ASSET","DEBIT"],
    ["1500","Fixed Assets","Befektetett eszközök","ASSET","DEBIT"],["2000","Accounts Payable","Szállítói tartozás","LIABILITY","CREDIT"],
    ["2100","SBA Loan","SBA hitel","LIABILITY","CREDIT"],["3000","Owner Equity","Saját tőke","EQUITY","CREDIT"],
    ["4000","Sales Revenue","Árbevétel","REVENUE","CREDIT"],["4100","Restoration Revenue","Felújítási bevétel","REVENUE","CREDIT"],
    ["4200","Tuning Revenue","Hangolási bevétel","REVENUE","CREDIT"],["4300","Concert Service Revenue","Koncertszerviz bevétel","REVENUE","CREDIT"],
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
  const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyErrors.length) throw new Error(`Foreign-key integrity check failed: ${JSON.stringify(foreignKeyErrors.slice(0, 10))}`);
  const integrity = db.prepare("PRAGMA integrity_check").all();
  if (integrity.some((row) => String(row.integrity_check || "").toLowerCase() !== "ok")) {
    throw new Error(`SQLite integrity check failed: ${JSON.stringify(integrity)}`);
  }
  log("SQLite integrity and foreign-key checks passed");
  const autoInstallSamples = process.env.WEBSITE_AUTO_INSTALL_SAMPLES === undefined
    ? Boolean(String(process.env.WEBSITE_BASE_URL || "").trim())
    : String(process.env.WEBSITE_AUTO_INSTALL_SAMPLES).toLowerCase() !== "false";
  if (autoInstallSamples) {
    const sampleResult = installSampleContent({ db, publicWebsiteUrl: process.env.WEBSITE_BASE_URL, updatedBy: "SYSTEM" });
    log(sampleResult.alreadyInstalled ? "Editable public sample content already present" : `Editable public sample content installed: ${JSON.stringify(sampleResult.installed)}`);
  }
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

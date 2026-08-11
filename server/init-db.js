const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { backfillUserCalendarColors } = require("./calendar-colors");
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

function preservedBusinessCounts() {
  const tables = ["users", "contacts", "pianos", "jobs", "inventory_items"];
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
  const inventoryMissingCreator = tableExists("inventory_items") && !tableColumns("inventory_items").has("created_by_user_id");
  const jobsMissingPlannedMinutes = tableExists("jobs") && !tableColumns("jobs").has("planned_minutes");
  const googleIntegrationMissing = tableExists("users") && !tableExists("calendar_integrations");
  return usersSql.includes("'VIEWER'") || usersMissingCalendarColor || usersMissingGoogleCalendarEmail || inventoryMissingCreator || jobsMissingPlannedMinutes || googleIntegrationMissing;
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
        hidden_user INTEGER DEFAULT 0,
        is_superadmin INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      INSERT INTO users_new(
        id,name,email,password_hash,role,status,phone,address,calendar_color,google_calendar_email,hidden_user,is_superadmin,created_at,updated_at
      )
      SELECT
        id,name,email,password_hash,
        CASE WHEN role IN ('ADMIN','MANAGER','WORKER') THEN role ELSE 'WORKER' END,
        CASE WHEN role='VIEWER' THEN 'Inactive' ELSE COALESCE(status,'Active') END,
        phone,address,calendar_color,google_calendar_email,COALESCE(hidden_user,0),COALESCE(is_superadmin,0),created_at,updated_at
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

function runMigrations() {
  const preservedCounts = preservedBusinessCounts();
  createPreMigrationBackup();
  db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

  const migrateColumns = db.transaction(() => {
    // Users. No user account is created here.
    ensureColumn("users", "phone", "TEXT");
    ensureColumn("users", "address", "TEXT");
    ensureColumn("users", "calendar_color", "TEXT");
    ensureColumn("users", "google_calendar_email", "TEXT");
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

  db.prepare("UPDATE jobs SET job_key='JK-'||id WHERE job_key IS NULL OR job_key='' ").run();
  db.prepare("UPDATE jobs SET workflow_root_id=COALESCE(NULLIF(workflow_root_id,''),id),workflow_step_no=COALESCE(workflow_step_no,1),workflow_status=COALESCE(NULLIF(workflow_status,''),CASE WHEN status='Completed' THEN 'COMPLETED' WHEN status='Partially completed' THEN 'IN_PROGRESS' WHEN status='Failed' THEN 'FAILED' ELSE 'ACTIVE' END)").run();
  db.prepare("UPDATE jobs SET planned_minutes=CAST(ROUND(COALESCE(planned_hours,0)*60) AS INTEGER) WHERE COALESCE(planned_minutes,0)=0 AND COALESCE(planned_hours,0)>0").run();
  db.prepare("UPDATE pianos SET ownership_type=COALESCE(NULLIF(ownership_type,''),ownership,'Customer owned')").run();
  db.prepare("UPDATE pianos SET display_name=trim(COALESCE(NULLIF(original_description,''),COALESCE(brand,'')||' '||COALESCE(model,''))) WHERE display_name IS NULL OR display_name='' ").run();

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
  // Intentionally no user, customer, piano, job, or other demo/business record is seeded.
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

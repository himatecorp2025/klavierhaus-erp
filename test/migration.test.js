const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");

const projectRoot = path.join(__dirname, "..");

test("v6.5.0 migration preserves business records and creates a backup before calendar integration changes", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-migration-"));
  const dbPath = path.join(tempRoot, "existing.sqlite");
  const backupDir = path.join(tempRoot, "backups");
  const currentSchema = fs.readFileSync(path.join(projectRoot, "server", "schema.sql"), "utf8");
  const legacySchema = currentSchema
    .replace("  calendar_color TEXT,\n", "")
    .replace("  planned_minutes INTEGER DEFAULT 0,\n", "");
  const db = new Database(dbPath);
  db.exec(legacySchema);
  const passwordHash = "legacy-hash";
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES(?,?,?,?,?,?,0,0)").run("U-K", "Károly", "karoly@example.com", passwordHash, "ADMIN", "Active");
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES(?,?,?,?,?,?,0,0)").run("U-M", "Misi", "misi@example.com", passwordHash, "MANAGER", "Active");
  db.prepare("INSERT INTO contacts(id,name) VALUES('C-1','Existing client')").run();
  db.prepare("INSERT INTO pianos(id,brand,model,owner_contact_id) VALUES('P-1','Steinway','B','C-1')").run();
  db.prepare("INSERT INTO jobs(id,title,assigned_user_id,assigned_to,start_time,end_time,planned_hours) VALUES('J-1','Existing job','U-K','Károly','2026-07-01T10:00','2026-07-01T13:05',?)").run(185/60);
  db.prepare("INSERT INTO inventory_items(id,item_name,quantity) VALUES('I-1','Existing part',4)").run();
  db.close();

  const result = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], {
    cwd: projectRoot,
    env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Data-preservation check passed/);
  assert.match(result.stdout, /SQLite integrity and foreign-key checks passed/);

  const migrated = new Database(dbPath, { readonly: true });
  const columns = migrated.prepare("PRAGMA table_info(users)").all().map((column) => column.name);
  const jobColumns = migrated.prepare("PRAGMA table_info(jobs)").all().map((column) => column.name);
  assert.ok(columns.includes("calendar_color"));
  assert.ok(columns.includes("google_calendar_email"));
  assert.ok(jobColumns.includes("planned_minutes"));
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='calendar_integrations'").get());
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='external_calendar_events'").get());
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_jobs_time_range'").get());
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_users_email_lookup'").get());
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_users_email_normalized'").get());
  assert.deepEqual(
    migrated.prepare("SELECT name,calendar_color FROM users ORDER BY name").all(),
    [{ name: "Károly", calendar_color: "#2563EB" }, { name: "Misi", calendar_color: "#EA580C" }]
  );
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM contacts").get().count, 1);
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM pianos").get().count, 1);
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM jobs").get().count, 1);
  assert.equal(migrated.prepare("SELECT planned_minutes FROM jobs WHERE id='J-1'").get().planned_minutes, 185);
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM inventory_items").get().count, 1);
  assert.equal(migrated.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  migrated.close();

  const backups = fs.readdirSync(backupDir).filter((name) => name.endsWith(".sqlite"));
  assert.equal(backups.length, 1);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("migration preserves pre-existing normalized email conflicts and reports them without blocking deployment", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-email-conflict-"));
  const dbPath = path.join(tempRoot, "existing.sqlite");
  const backupDir = path.join(tempRoot, "backups");
  const schema = fs.readFileSync(path.join(projectRoot, "server", "schema.sql"), "utf8");
  const db = new Database(dbPath);
  db.exec(schema);
  const insert = db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES(?,?,?,?,?,'Active',0,0)");
  insert.run("U-1", "First Alex", "alex@example.com", "hash-1", "ADMIN");
  insert.run("U-2", "Second Alex", " ALEX@example.com ", "hash-2", "WORKER");
  db.close();

  const result = spawnSync(process.execPath, [path.join(projectRoot, "server", "init-db.js")], {
    cwd: projectRoot,
    env: { ...process.env, DB_PATH: dbPath, BACKUP_DIR: backupDir },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /normalized user email conflict/);

  const migrated = new Database(dbPath, { readonly: true });
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM users").get().count, 2);
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_users_email_lookup'").get());
  assert.equal(Boolean(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_users_email_normalized'").get()), false);
  assert.equal(migrated.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  migrated.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

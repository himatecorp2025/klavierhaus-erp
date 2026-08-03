const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");

const projectRoot = path.join(__dirname, "..");

test("v6.5.0 migration preserves business records and creates a backup before adding colors", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kh-migration-"));
  const dbPath = path.join(tempRoot, "existing.sqlite");
  const backupDir = path.join(tempRoot, "backups");
  const currentSchema = fs.readFileSync(path.join(projectRoot, "server", "schema.sql"), "utf8");
  const legacySchema = currentSchema.replace("  calendar_color TEXT,\n", "");
  const db = new Database(dbPath);
  db.exec(legacySchema);
  const passwordHash = "legacy-hash";
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES(?,?,?,?,?,?,0,0)").run("U-K", "Károly", "karoly@example.com", passwordHash, "ADMIN", "Active");
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES(?,?,?,?,?,?,0,0)").run("U-M", "Misi", "misi@example.com", passwordHash, "MANAGER", "Active");
  db.prepare("INSERT INTO contacts(id,name) VALUES('C-1','Existing client')").run();
  db.prepare("INSERT INTO pianos(id,brand,model,owner_contact_id) VALUES('P-1','Steinway','B','C-1')").run();
  db.prepare("INSERT INTO jobs(id,title,assigned_user_id,assigned_to,start_time,end_time) VALUES('J-1','Existing job','U-K','Károly','2026-07-01T10:00','2026-07-01T12:00')").run();
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
  assert.ok(columns.includes("calendar_color"));
  assert.deepEqual(
    migrated.prepare("SELECT name,calendar_color FROM users ORDER BY name").all(),
    [{ name: "Károly", calendar_color: "#2563EB" }, { name: "Misi", calendar_color: "#EA580C" }]
  );
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM contacts").get().count, 1);
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM pianos").get().count, 1);
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM jobs").get().count, 1);
  assert.equal(migrated.prepare("SELECT COUNT(*) count FROM inventory_items").get().count, 1);
  assert.equal(migrated.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  migrated.close();

  const backups = fs.readdirSync(backupDir).filter((name) => name.endsWith(".sqlite"));
  assert.equal(backups.length, 1);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
require("dotenv").config();

const dbPath = process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus_v6.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

/**
 * schema.sql intentionally contains table/view definitions but no indexes that
 * depend on columns added by later migrations. This allows the same schema to
 * run against both a new database and an older persistent Render database.
 */
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

function tableColumns(tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
}

function ensureColumn(tableName, columnName, definition) {
  const columns = tableColumns(tableName);
  if (!columns.has(columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  }
}

function ensureIndex(sql) {
  db.exec(sql);
}

function runMigrations() {
  const migrate = db.transaction(() => {
    // Existing general migrations.
    ensureColumn("contacts", "address", "TEXT");
    ensureColumn("jobs", "job_type", "TEXT DEFAULT 'Standalone'");
    ensureColumn("jobs", "pricing_basis", "TEXT");
    ensureColumn("jobs", "last_reassigned_by", "TEXT");
    ensureColumn("jobs", "reassignment_note", "TEXT");

    // Customer import and customer-status fields.
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

    // Piano import fields. These MUST exist before piano import indexes are created.
    ensureColumn("pianos", "ownership_type", "TEXT DEFAULT 'Customer owned'");
    ensureColumn("pianos", "display_name", "TEXT");
    ensureColumn("pianos", "asset_recorded", "INTEGER DEFAULT 0");
    ensureColumn("pianos", "external_reference", "TEXT");
    ensureColumn("pianos", "import_source", "TEXT");
    ensureColumn("pianos", "import_batch_id", "TEXT");
    ensureColumn("pianos", "original_description", "TEXT");
    ensureColumn("pianos", "owner_resolution", "TEXT");

    // Older databases may already have import_batches without piano counters.
    ensureColumn("import_batches", "imported_pianos", "INTEGER DEFAULT 0");
    ensureColumn("import_batches", "updated_clients", "INTEGER DEFAULT 0");
    ensureColumn("import_batches", "unidentified_owner_pianos", "INTEGER DEFAULT 0");
    ensureColumn("import_batches", "client_not_found", "INTEGER DEFAULT 0");
  });

  migrate();

  // Indexes are deliberately created only after all required legacy columns exist.
  ensureIndex(`CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_import_reference
    ON contacts(import_source, external_reference)
    WHERE import_source IS NOT NULL AND external_reference IS NOT NULL`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_contacts_import_batch ON contacts(import_batch_id)");
  ensureIndex(`CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batches_file_hash_source
    ON import_batches(import_source, file_hash)`);
  ensureIndex(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pianos_import_reference
    ON pianos(import_source, external_reference)
    WHERE import_source IS NOT NULL AND external_reference IS NOT NULL`);
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_pianos_import_batch ON pianos(import_batch_id)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_pianos_owner_resolution ON pianos(owner_resolution)");
  ensureIndex("CREATE INDEX IF NOT EXISTS idx_pianos_owner_contact ON pianos(owner_contact_id)");
}

runMigrations();

function id(prefix){ return `${prefix}-${Date.now()}-${Math.floor(Math.random()*9999)}`; }
function addUser(name,email,password,role){
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`INSERT OR IGNORE INTO users(id,name,email,password_hash,role,status) VALUES(?,?,?,?,?,?)`)
    .run(id("U"), name, email, hash, role, "Active");
}
addUser("Károly","karoly@klavierhaus.local","karoly123","ADMIN");
addUser("Alex","alex@klavierhaus.local","alex123","ADMIN");
addUser("Paul","paul@klavierhaus.local","paul123","MANAGER");
addUser("Misi","misi@klavierhaus.local","misi123","MANAGER");
addUser("Said","said@klavierhaus.local","said123","WORKER");

const accounts = [
  ["1000","Cash","Készpénz","ASSET","DEBIT"],
  ["1010","Bank","Bank","ASSET","DEBIT"],
  ["1020","Undeposited Checks","Befizetés előtti csekkek","ASSET","DEBIT"],
  ["1200","Accounts Receivable","Vevőkövetelés","ASSET","DEBIT"],
  ["1300","Inventory","Készlet","ASSET","DEBIT"],
  ["1500","Fixed Assets","Befektetett eszközök","ASSET","DEBIT"],
  ["2000","Accounts Payable","Szállítói tartozás","LIABILITY","CREDIT"],
  ["2100","SBA Loan","SBA hitel","LIABILITY","CREDIT"],
  ["3000","Owner Equity","Saját tőke","EQUITY","CREDIT"],
  ["4000","Sales Revenue","Árbevétel","REVENUE","CREDIT"],
  ["4100","Restoration Revenue","Felújítási bevétel","REVENUE","CREDIT"],
  ["4200","Tuning Revenue","Hangolási bevétel","REVENUE","CREDIT"],
  ["4300","Concert Service Revenue","Koncertszerviz bevétel","REVENUE","CREDIT"],
  ["5000","Cost of Goods Sold","Eladott áruk költsége","EXPENSE","DEBIT"],
  ["6100","Rent Expense","Bérleti díj","EXPENSE","DEBIT"],
  ["6200","Transport Expense","Szállítási költség","EXPENSE","DEBIT"],
  ["6300","Payroll Expense","Bérköltség","EXPENSE","DEBIT"],
  ["6400","Interest Expense","Kamatköltség","EXPENSE","DEBIT"]
];
const stmt = db.prepare(`INSERT OR IGNORE INTO accounts(code,name_en,name_hu,category,normal_side) VALUES(?,?,?,?,?)`);
accounts.forEach(a => stmt.run(...a));

if(db.prepare("SELECT COUNT(*) c FROM contacts").get().c === 0){
  db.prepare(`INSERT INTO contacts(id,name,company,type,email,phone,address,priority,status,owner,relationship_holder,loss_risk,last_contact,next_step,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("C-001","John Smith","Carnegie-level client","Institution","","+1 555 000 1111","Manhattan, NY","Critical","Active","Károly","Károly","High","2026-06-20","Confirm concert prep","Demo contact.");
}
if(db.prepare("SELECT COUNT(*) c FROM pianos").get().c === 0){
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,year,ownership,owner_contact_id,location,estimated_value,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run("P-001","Steinway & Sons","D","TBD",1890,"Customer owned","C-001","Client site",120000,"In restoration","Demo piano.");
}
if(db.prepare("SELECT COUNT(*) c FROM jobs").get().c === 0){
  db.prepare(`INSERT INTO jobs(id,title,job_type,client_id,client_name,client_phone,piano_id,piano_name,assigned_to,created_by,priority,status,start_time,end_time,planned_amount,pricing_basis,planned_hours,travel_minutes,service_address,instructions) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("J-001","Demo Steinway tuning","Standalone","C-001","John Smith","+1 555 000 1111","P-001","Steinway D","Said","Károly","High","Open","2026-07-20T11:00","2026-07-20T14:00",500,"Phone quote / Telefonos ajánlat",3,35,"Manhattan, NY","Demo calendar job.");
}
console.log("Klavierhaus v6 database initialized:", dbPath);


const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
require("dotenv").config();

const dbPath = process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

function tryAlter(sql){ try { db.prepare(sql).run(); } catch(e) {} }
tryAlter("ALTER TABLE tasks ADD COLUMN phase_id TEXT");
tryAlter("ALTER TABLE journal_entries ADD COLUMN phase_id TEXT");
tryAlter("ALTER TABLE scheduler_events ADD COLUMN phase_id TEXT");
tryAlter("ALTER TABLE scheduler_events ADD COLUMN event_type TEXT DEFAULT 'Task'");
tryAlter("ALTER TABLE scheduler_events ADD COLUMN planned_amount REAL DEFAULT 0");
tryAlter("ALTER TABLE documents ADD COLUMN amount REAL DEFAULT 0");
tryAlter("ALTER TABLE documents ADD COLUMN payment_method TEXT");
tryAlter("ALTER TABLE documents ADD COLUMN invoice_number TEXT");
tryAlter("ALTER TABLE knowledge_base ADD COLUMN project_id TEXT");
tryAlter("ALTER TABLE knowledge_base ADD COLUMN phase_id TEXT");

function id(prefix){ return `${prefix}-${Date.now()}-${Math.floor(Math.random()*9999)}`; }
function user(name,email,password,role){
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`INSERT OR IGNORE INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)`).run(id("U"), name, email, hash, role);
}
user("Károly","karoly@klavierhaus.local","karoly123","ADMIN");
user("Alex","alex@klavierhaus.local","alex123","ADMIN");
user("Paul","paul@klavierhaus.local","paul123","MANAGER");
user("Misi","misi@klavierhaus.local","misi123","MANAGER");
user("Said","said@klavierhaus.local","said123","STAFF");
user("Viewer","viewer@klavierhaus.local","viewer123","VIEWER");

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
const accountStmt = db.prepare(`INSERT OR IGNORE INTO accounts(code,name_en,name_hu,category,normal_side) VALUES(?,?,?,?,?)`);
accounts.forEach(a => accountStmt.run(...a));

const templates = [
  ["Full restoration","Intake inspection / Átvételi vizsgálat","High",2,1],
  ["Full restoration","Disassembly / Szétszerelés","High",8,2],
  ["Full restoration","Soundboard & structure / Rezonáns és szerkezet","High",20,3],
  ["Full restoration","String replacement / Húrcsere","High",16,4],
  ["Full restoration","Action regulation / Mechanika szabályozás","High",18,5],
  ["Full restoration","Key replacement / Billentyű csere","Medium",10,6],
  ["Full restoration","Voicing / Intonálás","High",8,7],
  ["Full restoration","Tuning / Hangolás","High",4,8],
  ["Full restoration","Polishing / Fényezés","Medium",22,9],
  ["Full restoration","Final QA / Végső ellenőrzés","High",3,10],
  ["Tuning","In-home tuning / Helyszíni hangolás","High",3,1],
  ["Concert prep","Concert tuning / Koncert hangolás","High",3,1],
  ["Concert prep","On-site performance support / Helyszíni koncert támogatás","High",5,2],
  ["In-home voicing","In-home voicing / Helyszíni intonálás","High",3,1],
  ["Emergency service","Emergency diagnosis / Sürgősségi diagnózis","Critical",2,1],
  ["Repair","Diagnosis / Diagnózis","High",2,1],
  ["Repair","Repair work / Javítás","Medium",8,2],
  ["Piano evaluation","Evaluation / Állapotfelmérés","Medium",2,1],
  ["Sale","Client consultation / Ügyfél konzultáció","High",2,1],
  ["Rental","Rental prep / Bérleti előkészítés","Medium",4,1]
];
const tt = db.prepare(`INSERT OR IGNORE INTO task_templates(id,project_type,task_type,default_priority,default_planned_hours,sequence_no) VALUES(?,?,?,?,?,?)`);
templates.forEach(t => tt.run(id("TT"), ...t));

if(db.prepare("SELECT COUNT(*) c FROM contacts").get().c === 0){
  db.prepare(`INSERT INTO contacts(id,name,company,type,email,phone,priority,status,owner,relationship_holder,loss_risk,last_contact,next_step,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("C-001","John Smith","Carnegie-level client","Institution","","","Critical","Active","Károly","Károly","High","2026-06-20","Confirm concert prep","Key relationship to document.");
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,year,ownership,owner_contact_id,location,estimated_value,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run("P-001","Steinway & Sons","D","TBD",1890,"Customer owned","C-001","Workshop",120000,"In restoration","Demo piano.");
  db.prepare(`INSERT INTO projects(id,piano_id,client_id,name,type,manager,priority,status,start_date,due_date,planned_revenue,planned_cost,location_type,service_address,customer_phone,customer_email,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("PR-001","P-001","C-001","Steinway D full restoration","Full restoration","Misi","High","In progress","2026-06-15","2026-07-20",45000,22000,"Workshop","790 11th Avenue, New York, NY 10019","","","Auto workflow demo.");
}
console.log("Klavierhaus v4 database initialized:", dbPath);

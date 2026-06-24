
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
tryAlter("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'Active'");
tryAlter("ALTER TABLE jobs ADD COLUMN client_name TEXT");
tryAlter("ALTER TABLE jobs ADD COLUMN piano_name TEXT");

function id(prefix){ return `${prefix}-${Date.now()}-${Math.floor(Math.random()*9999)}`; }
function user(name,email,password,role){
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`INSERT OR IGNORE INTO users(id,name,email,password_hash,role,status) VALUES(?,?,?,?,?,?)`)
    .run(id("U"), name, email, hash, role, "Active");
}
user("Károly","karoly@klavierhaus.local","karoly123","ADMIN");
user("Alex","alex@klavierhaus.local","alex123","ADMIN");
user("Paul","paul@klavierhaus.local","paul123","MANAGER");
user("Misi","misi@klavierhaus.local","misi123","MANAGER");
user("Said","said@klavierhaus.local","said123","WORKER");

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

if(db.prepare("SELECT COUNT(*) c FROM contacts").get().c === 0){
  db.prepare(`INSERT INTO contacts(id,name,company,type,email,phone,priority,status,owner,relationship_holder,loss_risk,last_contact,next_step,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("C-001","John Smith","Carnegie-level client","Institution","","","Critical","Active","Károly","Károly","High","2026-06-20","Confirm concert prep","Demo contact.");
}
if(db.prepare("SELECT COUNT(*) c FROM pianos").get().c === 0){
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,year,ownership,owner_contact_id,location,estimated_value,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run("P-001","Steinway & Sons","D","TBD",1890,"Customer owned","C-001","Workshop",120000,"In restoration","Demo piano.");
}
if(db.prepare("SELECT COUNT(*) c FROM jobs").get().c === 0){
  db.prepare(`INSERT INTO jobs(id,title,client_id,client_name,piano_id,piano_name,assigned_to,created_by,priority,status,start_time,end_time,planned_amount,planned_hours,travel_minutes,service_address,instructions) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("J-001","Demo Steinway tuning","C-001","John Smith","P-001","Steinway D","Said","Károly","High","Open","2026-07-20T11:00","2026-07-20T14:00",500,3,35,"Manhattan, NY","Demo calendar job.");
}
console.log("Klavierhaus v5 database initialized:", dbPath);

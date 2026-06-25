
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
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`).run();

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

function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token) return res.status(401).json({error:"Missing token"});
  try{ req.user=jwt.verify(token, JWT_SECRET); next(); }
  catch(e){ res.status(401).json({error:"Invalid token"}); }
}
function permit(...roles){ return (req,res,next)=> roles.includes(req.user.role) ? next() : res.status(403).json({error:"Forbidden"}); }

function canCloseJob(user, job){
  if(user.role === "ADMIN") return true;
  return job.assigned_to === user.name;
}
function canEditJob(user, job){
  if(user.role === "ADMIN") return true;
  if(job.assigned_to === user.name) return true;
  if(user.role === "MANAGER" && job.created_by === user.name) return true;
  return false;
}
function canReassignJob(user, job){
  if(user.role === "ADMIN") return true;
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
  const u=db.prepare("SELECT * FROM users WHERE email=? AND status='Active'").get(email);
  if(!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({error:"Invalid login"});
  const token=jwt.sign({id:u.id,name:u.name,email:u.email,role:u.role}, JWT_SECRET, {expiresIn:"12h"});
  res.json({token,user:{id:u.id,name:u.name,email:u.email,role:u.role}});
});
app.get("/api/me", auth, (req,res)=>res.json(req.user));


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
    id,item_date,title,description,amount,main_type,category,recurrence,payment_method,balance_account,job_id,client_id,piano_id,created_by
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,item_date,title,req.body.description||"",amount,main_type,req.body.category||"",recurrence,req.body.payment_method||"",req.body.balance_account||"",req.body.job_id||null,req.body.client_id||null,req.body.piano_id||null,req.user.name
  );
  res.json(db.prepare("SELECT * FROM financial_items WHERE id=?").get(id));
});

app.put("/api/financial-items/:id", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  ensureRuntimeMigrations();
  const existing=db.prepare("SELECT * FROM financial_items WHERE id=?").get(req.params.id);
  if(!existing) return res.status(404).json({error:"Financial item not found / Pénzügyi tétel nem található"});
  const allowed=["item_date","title","description","amount","main_type","category","recurrence","payment_method","balance_account","job_id","client_id","piano_id"];
  const body={...req.body};
  if(body.amount!==undefined) body.amount=Number(body.amount||0);
  if(body.main_type!==undefined && !["INCOME","EXPENSE","ASSET","LIABILITY","EQUITY"].includes(body.main_type)) return res.status(400).json({error:"Invalid main type / Hibás fő típus"});
  if(body.recurrence!==undefined && !["ONE_TIME","MONTHLY"].includes(body.recurrence)) return res.status(400).json({error:"Invalid recurrence / Hibás ismétlődés"});
  const cols=allowed.filter(c=>body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE financial_items SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>body[c]),req.params.id);
  res.json(db.prepare("SELECT * FROM financial_items WHERE id=?").get(req.params.id));
});

app.delete("/api/financial-items/:id", auth, permit("ADMIN"), (req,res)=>{
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
    AP:["Accounts Payable","Szállítói tartozás","LIABILITY"],
    LOAN:["Loans Payable","Hitelek","LIABILITY"],
    CHECK_PAYABLE:["Check Payables","Csekkes tartozás","LIABILITY"],
    BANK_LOAN:["Bank Loan","Bankkölcsön","LIABILITY"],
    OWNER_EQUITY:["Owner Equity","Saját tőke","EQUITY"],
    OTHER_SOURCE:["Other Sources","Egyéb forrás","EQUITY"]
  };
  function addBalance(code, amount, preferredCategory){
    const n=categoryNames[code] || [code,code,preferredCategory||"ASSET"];
    const a=account(code,n[0],n[1],n[2]);
    a.balance += Number(amount||0);
    if(Number(amount||0)>=0) a.debit_total += Number(amount||0); else a.credit_total += Math.abs(Number(amount||0));
  }
  rows.forEach(x=>{
    const amount=Number(x.amount||0);
    if(x.main_type==='INCOME'){
      addBalance(x.category || (x.recurrence==='MONTHLY'?'PASSIVE_REVENUE':'SERVICE_REVENUE'), amount, 'REVENUE');
      if(x.balance_account) addBalance(x.balance_account, amount, 'ASSET');
    } else if(x.main_type==='EXPENSE'){
      addBalance(x.category || 'OTHER_EXPENSE', amount, 'EXPENSE');
      if(x.balance_account) addBalance(x.balance_account, -amount, 'ASSET');
    } else if(x.main_type==='ASSET'){
      addBalance(x.category || x.balance_account || 'OTHER_ASSET', amount, 'ASSET');
    } else if(x.main_type==='LIABILITY'){
      addBalance(x.category || 'OTHER_SOURCE', amount, 'LIABILITY');
    } else if(x.main_type==='EQUITY'){
      addBalance(x.category || 'OWNER_EQUITY', amount, 'EQUITY');
    }
  });
  const trialBalance=Object.values(accounts).sort((a,b)=>String(a.category+a.code).localeCompare(String(b.category+b.code)));
  const assets=trialBalance.filter(a=>a.category==='ASSET').reduce((s,a)=>s+Number(a.balance||0),0);
  const liabilities=trialBalance.filter(a=>a.category==='LIABILITY').reduce((s,a)=>s+Number(a.balance||0),0);
  const equity=trialBalance.filter(a=>a.category==='EQUITY').reduce((s,a)=>s+Number(a.balance||0),0);
  return {
    month,monthStart,monthEndExclusive:monthEnd,generatedAt:new Date().toISOString(),
    accountingLogic:{source:"financial_items",generalLedger:"simple_internal_finance_register"},
    counts:{openJobs,closedJobs:closedJobs.length,financialItems:rows.length},
    totals:{passiveIncome,oneTimeIncome,revenue,recurringExpenses,oneTimeExpenses,expenses,profit:revenue-expenses,assets,liabilities,equity,netWorth:assets-liabilities},
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
  res.json(db.prepare("SELECT id,name,email,role,status,created_at FROM users ORDER BY role,name").all());
});
app.post("/api/users", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const {name,email,password,role}=req.body;
  if(!name || !email || !password || !role) return res.status(400).json({error:"Name, email, password and role are required"});
  if(req.user.role==="MANAGER" && role==="ADMIN") return res.status(403).json({error:"Managers cannot create admins"});
  const id=rid("U");
  const hash=bcrypt.hashSync(password,10);
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status) VALUES(?,?,?,?,?,?)").run(id,name,email,hash,role,"Active");
  res.json({id,name,email,role,status:"Active"});
});
app.put("/api/users/:id", auth, permit("ADMIN"), (req,res)=>{
  const allowed=["name","email","role","status"];
  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(req.body.password){ cols.push("password_hash"); req.body.password_hash=bcrypt.hashSync(req.body.password,10); }
  if(cols.length) db.prepare(`UPDATE users SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]),req.params.id);
  res.json(db.prepare("SELECT id,name,email,role,status FROM users WHERE id=?").get(req.params.id));
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
}
createResourceRoutes("contacts","contacts","C",["name","company","type","email","phone","address","priority","status","owner","relationship_holder","loss_risk","last_contact","next_step","notes"],["ADMIN","MANAGER","WORKER"]);

app.get("/api/pianos", auth, (req,res)=>{
  ensureRuntimeMigrations();
  res.json(db.prepare("SELECT * FROM pianos ORDER BY display_name, brand, model").all());
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
  const cols=["id","job_key","parent_job_id","title","job_type","client_id","client_name","client_phone","piano_id","piano_name","assigned_to","created_by","priority","status","start_time","end_time","timezone","planned_amount","pricing_basis","planned_hours","travel_minutes","service_address","instructions"]
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
  if(!["Partial","Full"].includes(closeType)) return res.status(400).json({error:"Close type must be Partial or Full"});

  const billed=Number(req.body.billed_amount);
  if(Number.isNaN(billed)) return res.status(400).json({error:"Billed amount is required. Use 0 if not billable."});

  const desc=(req.body.close_description||"").trim();
  if(!desc) return res.status(400).json({error:"Close description is required"});

  const payment=req.body.payment_method || "";
  if(!payment) return res.status(400).json({error:"Payment method is required / Fizetési mód kötelező"});

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
    .run(closeType==="Full"?"Completed":"Partially completed",closeType,billed,payment,billed>0?(req.body.invoice_status||"Invoiced"):"Not billable",req.body.invoice_number||"",desc,nowISO(),job.id);

  db.prepare(`INSERT INTO job_logs(id,job_id,log_type,description,billed_amount,payment_method,invoice_number,document_path,next_job_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(rid("LOG"),job.id,closeType,desc,billed,payment,req.body.invoice_number||"",storedPath,nextJobId,req.user.name);

  db.prepare(`INSERT INTO knowledge_base(id,job_id,title,category,content_type,body,stored_path,owner,amount,payment_method,invoice_number,priority) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rid("KB"),job.id,`${closeType} close / ${closeType==="Full"?"Teljes lezárás":"Részlezárás"}: ${job.title}`,closeType==="Full"?"Closed Job":"Partial Close","Job Record",desc,storedPath,req.user.name,billed,payment,req.body.invoice_number||"",job.priority);
res.json({ok:true,next_job_id:nextJobId,storedPath});
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
    WHERE jl.log_type IN ('Full','Partial')
    ORDER BY jl.created_at DESC
  `).all();
  res.json(rows);
});
















app.use((err,req,res,next)=>{
  if(err) return res.status(400).json({error:err.message || "Upload error"});
  next();
});
app.listen(PORT,()=>console.log(`Klavierhaus v6.3 running on http://localhost:${PORT}`));










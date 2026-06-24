
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
  } catch(e) {
    console.warn("runtime migration skipped:", e.message);
  }
}
ensureRuntimeMigrations();


function monthEndDate(dateStr){
  const d = dateStr ? new Date(`${String(dateStr).slice(0,7)}-01T00:00:00`) : new Date();
  d.setMonth(d.getMonth()+1);
  d.setDate(0);
  return d.toISOString().slice(0,10);
}
function currentMonthEnd(){
  return monthEndDate(today());
}
function canEditJournalEntry(entry){
  if(!entry || !entry.entry_date) return false;
  const currentMonth = today().slice(0,7);
  return String(entry.entry_date).slice(0,7) === currentMonth;
}

function ensureLedgerExpansion(){
  try{
    const jeCols=db.prepare("PRAGMA table_info(journal_entries)").all().map(c=>c.name);
    if(!jeCols.includes("entry_type")) db.prepare("ALTER TABLE journal_entries ADD COLUMN entry_type TEXT DEFAULT 'Normal'").run();
    if(!jeCols.includes("acquisition_date")) db.prepare("ALTER TABLE journal_entries ADD COLUMN acquisition_date TEXT").run();
    if(!jeCols.includes("acquisition_value")) db.prepare("ALTER TABLE journal_entries ADD COLUMN acquisition_value REAL DEFAULT 0").run();
    if(!jeCols.includes("check_number")) db.prepare("ALTER TABLE journal_entries ADD COLUMN check_number TEXT").run();
    if(!jeCols.includes("check_status")) db.prepare("ALTER TABLE journal_entries ADD COLUMN check_status TEXT").run();
    if(!jeCols.includes("client_name")) db.prepare("ALTER TABLE journal_entries ADD COLUMN client_name TEXT").run();
  }catch(e){ console.warn("ledger expansion migration skipped:", e.message); }
}
ensureLedgerExpansion();

function ensureCommonAccounts(){
  const rows=[
    ["1030","Petty Cash","Házipénztár","ASSET","DEBIT"],
    ["1100","Security Deposits","Kauciók","ASSET","DEBIT"],
    ["1310","Parts Inventory","Alkatrész készlet","ASSET","DEBIT"],
    ["1320","Tools and Equipment","Szerszámok és berendezések","ASSET","DEBIT"],
    ["1510","Company Pianos","Céges zongorák","ASSET","DEBIT"],
    ["2200","Credit Card Payable","Hitelkártya tartozás","LIABILITY","CREDIT"],
    ["2300","Sales Tax Payable","Értékesítési adó tartozás","LIABILITY","CREDIT"],
    ["2400","Payroll Taxes Payable","Bérjárulék tartozás","LIABILITY","CREDIT"],
    ["4400","Service Revenue","Szolgáltatási bevétel","REVENUE","CREDIT"],
    ["4500","Parts Revenue","Alkatrész bevétel","REVENUE","CREDIT"],
    ["5100","Materials Expense","Anyagköltség","EXPENSE","DEBIT"],
    ["6500","Marketing Expense","Marketingköltség","EXPENSE","DEBIT"],
    ["6600","Insurance Expense","Biztosítási költség","EXPENSE","DEBIT"],
    ["6700","Utilities Expense","Rezsi / közüzemi költség","EXPENSE","DEBIT"],
    ["6800","Professional Fees","Szakértői díjak","EXPENSE","DEBIT"],
    ["6900","Bank Fees","Bankköltség","EXPENSE","DEBIT"]
  ];
  const st=db.prepare("INSERT OR IGNORE INTO accounts(code,name_en,name_hu,category,normal_side) VALUES(?,?,?,?,?)");
  rows.forEach(r=>st.run(...r));
}
ensureCommonAccounts();




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
  if(String(ownershipType).toLowerCase().includes("company")) createPianoAssetEntry(piano,req.user.id);
  res.json(db.prepare("SELECT * FROM pianos WHERE id=?").get(id));
});

app.put("/api/pianos/:id", auth, permit("ADMIN","MANAGER","WORKER"), (req,res)=>{
  ensureRuntimeMigrations();
  const allowed=["brand","model","serial_no","ownership","ownership_type","display_name","owner_contact_id","location","estimated_value","status","notes"];
  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE pianos SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]), req.params.id);
  const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(req.params.id);
  if(piano && String(piano.ownership_type||piano.ownership||"").toLowerCase().includes("company")) createPianoAssetEntry(piano,req.user.id);
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

  if(billed > 0) createRevenueEntry(job,billed,payment,req.user.id);
  res.json({ok:true,next_job_id:nextJobId,storedPath});
});


function createPianoAssetEntry(piano,userId){
  const value = Number(piano.estimated_value || 0);
  if(value <= 0) return;
  if(String(piano.ownership_type || piano.ownership || "").toLowerCase().includes("customer")) return;
  if(Number(piano.asset_recorded || 0) === 1) return;

  const je = rid("JE");
  const tx = db.transaction(()=>{
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,piano_id,payment_method,status,created_by) VALUES(?,?,?,?,?,?,?)`)
      .run(je,today(),`Piano asset / Céges zongora eszköz: ${piano.display_name || `${piano.brand||""} ${piano.model||""}`.trim()}`,piano.id,"Asset Entry","POSTED",userId);
    const ins=db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)");
    ins.run(rid("JL"),je,"1500",value,0,"Fixed asset piano / Befektetett eszköz zongora");
    ins.run(rid("JL"),je,"3000",0,value,"Owner equity / Saját tőke");
  });
  tx();
  db.prepare("UPDATE pianos SET asset_recorded=1 WHERE id=?").run(piano.id);
}

function createRevenueEntry(job,amount,payment,userId){
  let debitAccount="1010";
  if(payment==="Cash") debitAccount="1000";
  if(payment==="Check") debitAccount="1020";
  if(payment==="Invoice") debitAccount="1200";
  if(payment==="Bank Transfer" || payment==="Credit Card") debitAccount="1010";
  let creditAccount="4200";
  if((job.title||"").toLowerCase().includes("restoration") || (job.title||"").toLowerCase().includes("felújítás")) creditAccount="4100";
  if((job.title||"").toLowerCase().includes("concert")) creditAccount="4300";
  const je=rid("JE");
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,client_id,piano_id,job_id,payment_method,status,created_by) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(je,today(),`Job revenue / Munkabevétel: ${job.title}`,job.client_id,job.piano_id,job.id,payment,"POSTED",userId);
    const ins=db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)");
    ins.run(rid("JL"),je,debitAccount,amount,0,`Payment / Fizetés: ${payment}`);
    ins.run(rid("JL"),je,creditAccount,0,amount,`Revenue from job / Bevétel munkából ${job.id}`);
  });
  tx();
}


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
  if(String(ownershipType).toLowerCase().includes("company")) createPianoAssetEntry(piano,req.user.id);
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
  if(String(ownershipType).toLowerCase().includes("company") && typeof createPianoAssetEntry==="function") createPianoAssetEntry(piano,req.user.id);
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


app.post("/api/accounts", auth, permit("ADMIN"), (req,res)=>{
  const code=String(req.body.code||"").trim();
  const name_en=String(req.body.name_en||"").trim();
  const name_hu=String(req.body.name_hu||"").trim();
  const category=String(req.body.category||"").trim();
  const normal_side=String(req.body.normal_side||"").trim();
  if(!code||!name_en||!name_hu||!category||!normal_side) return res.status(400).json({error:"All account fields are required"});
  if(!["ASSET","LIABILITY","EQUITY","REVENUE","EXPENSE"].includes(category)) return res.status(400).json({error:"Invalid category"});
  if(!["DEBIT","CREDIT"].includes(normal_side)) return res.status(400).json({error:"Invalid normal side"});
  db.prepare("INSERT INTO accounts(code,name_en,name_hu,category,normal_side) VALUES(?,?,?,?,?)").run(code,name_en,name_hu,category,normal_side);
  res.json(db.prepare("SELECT * FROM accounts WHERE code=?").get(code));
});

app.get("/api/accounts", auth, permit("ADMIN","MANAGER"), (req,res)=>res.json(db.prepare("SELECT * FROM accounts ORDER BY code").all()));

app.get("/api/finance/journal-entries", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const rows=db.prepare(`
    SELECT je.*, 
           GROUP_CONCAT(jl.account_code || ':' || jl.debit || ':' || jl.credit || ':' || COALESCE(jl.memo,''), '||') AS line_blob
    FROM journal_entries je
    LEFT JOIN journal_lines jl ON jl.entry_id=je.id
    GROUP BY je.id
    ORDER BY je.entry_date DESC, je.created_at DESC
  `).all().map(r=>{
    const lines=String(r.line_blob||"").split("||").filter(Boolean).map(x=>{
      const p=x.split(":");
      return {account_code:p[0],debit:Number(p[1]||0),credit:Number(p[2]||0),memo:p.slice(3).join(":")};
    });
    delete r.line_blob;
    return {...r,lines,editable:canEditJournalEntry(r),editable_until:currentMonthEnd()};
  });
  res.json(rows);
});

app.get("/api/finance/journal-entries/:id", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const entry=db.prepare("SELECT * FROM journal_entries WHERE id=?").get(req.params.id);
  if(!entry) return res.status(404).json({error:"Journal entry not found"});
  const lines=db.prepare("SELECT * FROM journal_lines WHERE entry_id=? ORDER BY id").all(req.params.id);
  res.json({...entry,lines,editable:canEditJournalEntry(entry),editable_until:currentMonthEnd()});
});

app.put("/api/finance/journal-entries/:id", auth, permit("ADMIN"), (req,res)=>{
  const entry=db.prepare("SELECT * FROM journal_entries WHERE id=?").get(req.params.id);
  if(!entry) return res.status(404).json({error:"Journal entry not found"});
  if(!canEditJournalEntry(entry)){
    return res.status(403).json({error:`Closed month cannot be modified. Current month entries can be edited until ${currentMonthEnd()} / Lezárt hónap nem módosítható. Az aktuális hónap tételei eddig módosíthatók: ${currentMonthEnd()}`});
  }

  const {entry_date,description,payment_method,entry_type,acquisition_date,acquisition_value,check_number,check_status,client_name,lines}=req.body;
  const nextDate=entry_date || entry.entry_date;
  if(String(nextDate).slice(0,7)!==today().slice(0,7)){
    return res.status(403).json({error:`Entry date must remain in the current open month. Editable until ${currentMonthEnd()} / A tétel dátuma csak az aktuális nyitott hónapban maradhat. Módosítható eddig: ${currentMonthEnd()}`});
  }

  if(!Array.isArray(lines)||lines.length<2) return res.status(400).json({error:"At least two ledger lines are required"});
  const debit=lines.reduce((s,l)=>s+Number(l.debit||0),0);
  const credit=lines.reduce((s,l)=>s+Number(l.credit||0),0);
  if(Math.round(debit*100)!==Math.round(credit*100)) return res.status(400).json({error:"Debit and credit must balance"});

  const tx=db.transaction(()=>{
    db.prepare(`UPDATE journal_entries SET entry_date=?, description=?, payment_method=?, entry_type=?, acquisition_date=?, acquisition_value=?, check_number=?, check_status=?, client_name=? WHERE id=?`)
      .run(nextDate,description||entry.description,payment_method||"",entry_type||entry.entry_type||"Normal",acquisition_date||"",Number(acquisition_value||0),check_number||"",check_status||"",client_name||"",entry.id);
    db.prepare("DELETE FROM journal_lines WHERE entry_id=?").run(entry.id);
    const ins=db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)");
    lines.forEach(l=>ins.run(rid("JL"),entry.id,l.account_code,Number(l.debit||0),Number(l.credit||0),l.memo||""));
  });
  tx();
  res.json({ok:true,id:entry.id,editable_until:currentMonthEnd()});
});

app.get("/api/finance/entries", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const rows=db.prepare(`SELECT je.*, j.title AS job_title, j.client_name, j.piano_name, j.invoice_status, j.invoice_number, j.billed_amount
                         FROM journal_entries je LEFT JOIN jobs j ON j.id=je.job_id
                         ORDER BY je.entry_date DESC, je.created_at DESC`).all();
  const lines=db.prepare("SELECT * FROM journal_lines WHERE entry_id=? ORDER BY id");
  res.json(rows.map(e=>({...e,lines:lines.all(e.id)})));
});

app.post("/api/finance/check-workflow", auth, permit("ADMIN"), (req,res)=>{
  const type=String(req.body.type||"").trim();
  const amount=Number(req.body.amount||0);
  const entry_date=req.body.entry_date || today();
  const check_number=req.body.check_number || "";
  const client_name=req.body.client_name || "";
  const memo=req.body.memo || "";
  const revenue_account=req.body.revenue_account || "4200";
  if(amount<=0) return res.status(400).json({error:"Amount must be greater than zero"});

  let debit_account="", credit_account="", description="", check_status="";
  if(type==="received"){
    debit_account="1020"; credit_account=revenue_account;
    description=`Check received / Csekk beérkezett${check_number?": "+check_number:""}${client_name?" · "+client_name:""}`;
    check_status="Received";
  }else if(type==="deposit_bank"){
    debit_account="1010"; credit_account="1020";
    description=`Check deposited to bank / Csekk bankba befizetve${check_number?": "+check_number:""}`;
    check_status="Deposited to bank";
  }else if(type==="cash"){
    debit_account="1000"; credit_account="1020";
    description=`Check cashed / Csekk készpénzre váltva${check_number?": "+check_number:""}`;
    check_status="Cashed";
  }else{
    return res.status(400).json({error:"Invalid check workflow type"});
  }

  const id=rid("JE");
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,payment_method,status,created_by,entry_type,check_number,check_status,client_name)
                VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id,entry_date,description,"Check","POSTED",req.user.id,"Check workflow",check_number,check_status,client_name);
    const ins=db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)");
    ins.run(rid("JL"),id,debit_account,amount,0,memo);
    ins.run(rid("JL"),id,credit_account,0,amount,memo);
  });
  tx();
  res.json({ok:true,id,type,check_status});
});

app.post("/api/finance/entries", auth, permit("ADMIN"), (req,res)=>{
  const {entry_date,description,payment_method,lines,entry_type,acquisition_date,acquisition_value,check_number,check_status,client_name}=req.body;
  if(!entry_date||!description||!Array.isArray(lines)||lines.length<2) return res.status(400).json({error:"Balanced entry with at least two lines is required"});
  const debit=lines.reduce((s,l)=>s+Number(l.debit||0),0);
  const credit=lines.reduce((s,l)=>s+Number(l.credit||0),0);
  if(Math.round(debit*100)!==Math.round(credit*100)) return res.status(400).json({error:"Debit and credit must balance"});
  const id=rid("JE");
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,payment_method,status,created_by,entry_type,acquisition_date,acquisition_value,check_number,check_status,client_name)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,entry_date,description,payment_method||"", "POSTED", req.user.id, entry_type||"Normal", acquisition_date||"", Number(acquisition_value||0), check_number||"", check_status||"", client_name||"");
    const ins=db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)");
    lines.forEach(l=>ins.run(rid("JL"),id,l.account_code,Number(l.debit||0),Number(l.credit||0),l.memo||""));
  });
  tx();
  res.json({ok:true,id});
});


app.get("/api/income-statement/monthly", auth, (req,res)=>{
  const month = req.query.month || today().slice(0,7);
  if(!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({error:"Month must be YYYY-MM"});
  const monthStart = `${month}-01`;
  const nextMonth = new Date(`${monthStart}T00:00:00`);
  nextMonth.setMonth(nextMonth.getMonth()+1);
  const monthEnd = nextMonth.toISOString().slice(0,10);

  /*
    Correct accounting logic / Helyes könyvelési logika:
    - REVENUE and EXPENSE are period accounts: only current month movement.
      Bevétel és kiadás: csak az adott hónap mozgása.
    - ASSET, LIABILITY and EQUITY are balance-sheet accounts: cumulative balance up to month end.
      Eszköz, kötelezettség és saját tőke: hónap végéig halmozott állomány.
  */
  const tb=db.prepare(`
    SELECT a.code,a.name_en,a.name_hu,a.category,a.normal_side,
      COALESCE(SUM(CASE
        WHEN a.category IN ('REVENUE','EXPENSE')
          AND je.entry_date >= ? AND je.entry_date < ?
        THEN jl.debit
        WHEN a.category IN ('ASSET','LIABILITY','EQUITY')
          AND je.entry_date < ?
        THEN jl.debit
        ELSE 0 END),0) debit_total,
      COALESCE(SUM(CASE
        WHEN a.category IN ('REVENUE','EXPENSE')
          AND je.entry_date >= ? AND je.entry_date < ?
        THEN jl.credit
        WHEN a.category IN ('ASSET','LIABILITY','EQUITY')
          AND je.entry_date < ?
        THEN jl.credit
        ELSE 0 END),0) credit_total
    FROM accounts a
    LEFT JOIN journal_lines jl ON jl.account_code=a.code
    LEFT JOIN journal_entries je ON je.id=jl.entry_id AND je.status='POSTED'
    GROUP BY a.code
    ORDER BY a.code
  `).all(monthStart,monthEnd,monthEnd,monthStart,monthEnd,monthEnd).map(a=>{
    const balance=a.normal_side==="DEBIT" ? Number(a.debit_total)-Number(a.credit_total) : Number(a.credit_total)-Number(a.debit_total);
    return {...a,balance};
  });

  const revenue=tb.filter(a=>a.category==="REVENUE").reduce((s,a)=>s+a.balance,0);
  const expenses=tb.filter(a=>a.category==="EXPENSE").reduce((s,a)=>s+a.balance,0);
  const assets=tb.filter(a=>a.category==="ASSET").reduce((s,a)=>s+a.balance,0);
  const liabilities=tb.filter(a=>a.category==="LIABILITY").reduce((s,a)=>s+a.balance,0);
  const equity=tb.filter(a=>a.category==="EQUITY").reduce((s,a)=>s+a.balance,0);

  const closedJobs=db.prepare("SELECT COUNT(*) c FROM jobs WHERE status='Completed' AND completed_at >= ? AND completed_at < ?").get(monthStart,monthEnd).c;
  const openJobs=db.prepare("SELECT COUNT(*) c FROM jobs WHERE status!='Completed' OR status IS NULL").get().c;

  res.json({
    month,
    monthStart,
    monthEndExclusive:monthEnd,
    generatedAt:new Date().toISOString(),
    accountingLogic:{
      revenueExpense:"period",
      assetsLiabilitiesEquity:"cumulative_to_month_end"
    },
    counts:{openJobs,closedJobs},
    totals:{revenue,expenses,profit:revenue-expenses,assets,liabilities,equity,netWorth:assets-liabilities},
    trialBalance:tb
  });
});


app.get("/api/income-statement", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const trial=db.prepare("SELECT * FROM v_trial_balance ORDER BY code").all();
  const sum=cat=>trial.filter(a=>a.category===cat).reduce((s,a)=>s+Number(a.balance||0),0);
  const byPayment=db.prepare(`SELECT payment_method, COALESCE(SUM(billed_amount),0) amount FROM jobs WHERE billed_amount > 0 GROUP BY payment_method`).all();
  res.json({
    totals:{assets:sum("ASSET"),liabilities:sum("LIABILITY"),equity:sum("EQUITY"),revenue:sum("REVENUE"),expense:sum("EXPENSE"),profit:sum("REVENUE")-sum("EXPENSE"),netWorth:sum("ASSET")-sum("LIABILITY")},
    counts:{openJobs:db.prepare("SELECT COUNT(*) c FROM jobs WHERE status!='Completed'").get().c, completedJobs:db.prepare("SELECT COUNT(*) c FROM jobs WHERE status='Completed'").get().c},
    trialBalance:trial,
    byPayment
  });
});

app.use((err,req,res,next)=>{
  if(err) return res.status(400).json({error:err.message || "Upload error"});
  next();
});
app.listen(PORT,()=>console.log(`Klavierhaus v6.3 running on http://localhost:${PORT}`));

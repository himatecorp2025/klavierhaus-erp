
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

const db = new Database(process.env.DB_PATH || path.join(__dirname, "db", "klavierhaus.sqlite"));
db.pragma("foreign_keys = ON");

const upload = multer({ dest: UPLOAD_DIR });
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
function permit(...roles){
  return (req,res,next)=>{
    if(!roles.includes(req.user.role)) return res.status(403).json({error:"Forbidden"});
    next();
  };
}
function canCloseJob(user, job){
  if(user.role === "ADMIN") return true;
  return job.assigned_to === user.name;
}
function canEditJob(user, job){
  if(user.role === "ADMIN") return true;
  if(user.role === "MANAGER") return job.created_by === user.name || job.assigned_to === user.name;
  if(user.role === "WORKER") return job.assigned_to === user.name;
  return false;
}

app.post("/api/login",(req,res)=>{
  const {email,password}=req.body;
  const u=db.prepare("SELECT * FROM users WHERE email=? AND status='Active'").get(email);
  if(!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({error:"Invalid login"});
  const token=jwt.sign({id:u.id,name:u.name,email:u.email,role:u.role}, JWT_SECRET, {expiresIn:"12h"});
  res.json({token,user:{id:u.id,name:u.name,email:u.email,role:u.role}});
});
app.get("/api/me", auth, (req,res)=>res.json(req.user));

app.get("/api/users", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const rows=db.prepare("SELECT id,name,email,role,status,created_at FROM users ORDER BY role,name").all();
  res.json(rows);
});
app.post("/api/users", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const {name,email,password,role}=req.body;
  if(!name || !email || !password || !role) return res.status(400).json({error:"Name, email, password and role are required"});
  if(req.user.role==="MANAGER" && role==="ADMIN") return res.status(403).json({error:"Managers cannot create admins"});
  const hash=bcrypt.hashSync(password,10);
  const id=rid("U");
  db.prepare("INSERT INTO users(id,name,email,password_hash,role,status) VALUES(?,?,?,?,?,?)").run(id,name,email,hash,role,"Active");
  res.json({id,name,email,role,status:"Active"});
});
app.put("/api/users/:id", auth, permit("ADMIN"), (req,res)=>{
  const allowed=["name","email","role","status"];
  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(req.body.password){
    const hash=bcrypt.hashSync(req.body.password,10);
    cols.push("password_hash");
    req.body.password_hash=hash;
  }
  if(!cols.length) return res.json({ok:true});
  db.prepare(`UPDATE users SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]),req.params.id);
  res.json(db.prepare("SELECT id,name,email,role,status FROM users WHERE id=?").get(req.params.id));
});

function simpleResource(key, table, prefix, write, roles){
  app.get(`/api/${key}`, auth, (req,res)=>{
    let rows=db.prepare(`SELECT * FROM ${table} ORDER BY created_at DESC`).all();
    if(req.user.role==="WORKER" && key==="contacts") rows=[];
    res.json(rows);
  });
  app.post(`/api/${key}`, auth, permit(...roles), (req,res)=>{
    const id=req.body.id || rid(prefix);
    const cols=["id",...write].filter(c=>c==="id" || req.body[c]!==undefined);
    db.prepare(`INSERT INTO ${table}(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...cols.map(c=>c==="id"?id:req.body[c]));
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id));
  });
  app.put(`/api/${key}/:id`, auth, permit(...roles), (req,res)=>{
    const cols=write.filter(c=>req.body[c]!==undefined);
    if(cols.length) db.prepare(`UPDATE ${table} SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]),req.params.id);
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id));
  });
}
simpleResource("contacts","contacts","C",["name","company","type","email","phone","priority","status","owner","relationship_holder","loss_risk","last_contact","next_step","notes"],["ADMIN","MANAGER"]);
simpleResource("pianos","pianos","P",["brand","model","serial_no","year","ownership","owner_contact_id","location","estimated_value","status","notes"],["ADMIN","MANAGER","WORKER"]);
simpleResource("knowledge_base","knowledge_base","KB",["job_id","title","category","content_type","body","stored_path","owner","amount","payment_method","invoice_number","priority"],["ADMIN","MANAGER","WORKER"]);

app.get("/api/jobs", auth, (req,res)=>{
  let rows=db.prepare("SELECT * FROM jobs ORDER BY start_time").all();
  if(req.user.role==="WORKER") rows=rows.filter(j=>j.assigned_to===req.user.name);
  res.json(rows);
});
app.post("/api/jobs", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const required=["title","assigned_to","start_time","end_time"];
  for(const r of required) if(!req.body[r]) return res.status(400).json({error:`${r} is required`});
  const id=req.body.id || rid("J");
  const cols=["id","parent_job_id","title","client_id","client_name","piano_id","piano_name","assigned_to","created_by","priority","status","start_time","end_time","timezone","planned_amount","planned_hours","travel_minutes","service_address","instructions"]
    .filter(c=>c==="id" || c==="created_by" || req.body[c]!==undefined);
  const vals=cols.map(c=>c==="id"?id:(c==="created_by"?req.user.name:req.body[c]));
  db.prepare(`INSERT INTO jobs(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...vals);
  res.json(db.prepare("SELECT * FROM jobs WHERE id=?").get(id));
});
app.put("/api/jobs/:id", auth, (req,res)=>{
  const job=db.prepare("SELECT * FROM jobs WHERE id=?").get(req.params.id);
  if(!job) return res.status(404).json({error:"Job not found"});
  if(!canEditJob(req.user, job)) return res.status(403).json({error:"You cannot edit this job"});
  const allowed=["title","client_id","client_name","piano_id","piano_name","assigned_to","priority","status","start_time","end_time","planned_amount","planned_hours","travel_minutes","service_address","instructions"];
  if(req.user.role==="MANAGER" && job.assigned_to!==req.user.name){
    const forbidden=["billed_amount","payment_method","invoice_status","invoice_number","close_notes","completed_at","status"];
    for(const f of forbidden) if(req.body[f]!==undefined) return res.status(403).json({error:"Managers cannot modify worker closeout or financial data"});
  }
  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE jobs SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]),req.params.id);
  res.json(db.prepare("SELECT * FROM jobs WHERE id=?").get(req.params.id));
});
app.post("/api/jobs/:id/close", auth, upload.single("file"), (req,res)=>{
  const job=db.prepare("SELECT * FROM jobs WHERE id=?").get(req.params.id);
  if(!job) return res.status(404).json({error:"Job not found"});
  if(!canCloseJob(req.user, job)) return res.status(403).json({error:"Only the assigned worker/manager or admin can close this job"});
  const closeType=req.body.close_type;
  if(!["Partial","Full"].includes(closeType)) return res.status(400).json({error:"Close type must be Partial or Full"});
  const billed=Number(req.body.billed_amount);
  if(Number.isNaN(billed)) return res.status(400).json({error:"Billed amount is required. Use 0 if not billable."});
  const desc=req.body.close_description || "";
  if(!desc.trim()) return res.status(400).json({error:"Close description is required"});
  const payment=req.body.payment_method || "";
  if(billed > 0 && !payment) return res.status(400).json({error:"Payment method is required when billed amount is greater than zero"});
  if(billed > 0 && !req.file) return res.status(400).json({error:"Invoice/check document is required when billed amount is greater than zero"});
  let storedPath=null;
  if(req.file) storedPath="/uploads/"+path.basename(req.file.path);

  let nextJobId=null;
  if(closeType==="Partial"){
    const required=["next_title","next_assigned_to","next_start_time","next_end_time"];
    for(const r of required) if(!req.body[r]) return res.status(400).json({error:`${r} is required for partial close`});
    nextJobId=rid("J");
    db.prepare(`INSERT INTO jobs(id,parent_job_id,title,client_id,client_name,piano_id,piano_name,assigned_to,created_by,priority,status,start_time,end_time,timezone,planned_amount,planned_hours,travel_minutes,service_address,instructions)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(nextJobId,job.id,req.body.next_title,job.client_id,job.client_name,job.piano_id,job.piano_name,req.body.next_assigned_to,req.user.name,req.body.next_priority||job.priority,"Open",req.body.next_start_time,req.body.next_end_time,"America/New_York",Number(req.body.next_planned_amount||0),Number(req.body.next_planned_hours||0),Number(req.body.next_travel_minutes||0),req.body.next_service_address||job.service_address,req.body.next_instructions||"");
  }
  db.prepare(`UPDATE jobs SET status=?, close_type=?, billed_amount=?, payment_method=?, invoice_status=?, invoice_number=?, close_notes=?, completed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(closeType==="Full"?"Completed":"Partially completed",closeType,billed,payment,billed>0?(req.body.invoice_status||"Invoiced"):"Not billable",req.body.invoice_number||"",desc,nowISO(),job.id);

  const logId=rid("LOG");
  db.prepare(`INSERT INTO job_logs(id,job_id,log_type,description,billed_amount,payment_method,invoice_number,document_path,next_job_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(logId,job.id,closeType,desc,billed,payment,req.body.invoice_number||"",storedPath,nextJobId,req.user.name);

  db.prepare(`INSERT INTO knowledge_base(id,job_id,title,category,content_type,body,stored_path,owner,amount,payment_method,invoice_number,priority) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(rid("KB"),job.id,`${closeType} close: ${job.title}`,closeType==="Full"?"Closed Job":"Partial Close","Job Record",desc,storedPath,req.user.name,billed,payment,req.body.invoice_number||"",job.priority);

  if(billed > 0) createRevenueEntry(job,billed,payment,req.user.id);
  res.json({ok:true,next_job_id:nextJobId,storedPath});
});

function createRevenueEntry(job,amount,payment,userId){
  let debitAccount="1010";
  if(payment==="Cash") debitAccount="1000";
  if(payment==="Check") debitAccount="1020";
  if(payment==="Invoice") debitAccount="1200";
  if(payment==="Bank Transfer" || payment==="Credit Card") debitAccount="1010";
  let creditAccount= job.title && job.title.toLowerCase().includes("restoration") ? "4100" : "4200";
  const je=rid("JE");
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,client_id,piano_id,job_id,payment_method,status,created_by) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(je,today(),`Job revenue: ${job.title}`,job.client_id,job.piano_id,job.id,payment,"POSTED",userId);
    const ins=db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)");
    ins.run(rid("JL"),je,debitAccount,amount,0,`Payment received/receivable: ${payment}`);
    ins.run(rid("JL"),je,creditAccount,0,amount,`Revenue from job ${job.id}`);
  });
  tx();
}

app.get("/api/accounts", auth, permit("ADMIN","MANAGER"), (req,res)=>res.json(db.prepare("SELECT * FROM accounts ORDER BY code").all()));
app.get("/api/finance/entries", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const entries=db.prepare("SELECT * FROM journal_entries ORDER BY entry_date DESC, created_at DESC").all();
  const lines=db.prepare("SELECT * FROM journal_lines WHERE entry_id=? ORDER BY id");
  res.json(entries.map(e=>({...e,lines:lines.all(e.id)})));
});
app.post("/api/finance/entries", auth, permit("ADMIN"), (req,res)=>{
  const {entry_date,description,client_id,piano_id,job_id,payment_method,status,lines}=req.body;
  if(!Array.isArray(lines)||lines.length<2) return res.status(400).json({error:"At least two journal lines required"});
  const debit=lines.reduce((s,l)=>s+Number(l.debit||0),0), credit=lines.reduce((s,l)=>s+Number(l.credit||0),0);
  if(Math.abs(debit-credit)>0.005) return res.status(400).json({error:"Debit and credit must balance",debit,credit});
  const id=rid("JE");
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,client_id,piano_id,job_id,payment_method,status,created_by) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(id,entry_date,description,client_id||null,piano_id||null,job_id||null,payment_method,status||"POSTED",req.user.id);
    const ins=db.prepare(`INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)`);
    lines.forEach(l=>ins.run(rid("JL"),id,l.account_code,Number(l.debit||0),Number(l.credit||0),l.memo||""));
  });
  tx();
  res.json({ok:true,id});
});
app.get("/api/dashboard", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const trial=db.prepare("SELECT * FROM v_trial_balance ORDER BY code").all();
  const sum=cat=>trial.filter(a=>a.category===cat).reduce((s,a)=>s+Number(a.balance||0),0);
  res.json({
    totals:{assets:sum("ASSET"),liabilities:sum("LIABILITY"),equity:sum("EQUITY"),revenue:sum("REVENUE"),expense:sum("EXPENSE"),profit:sum("REVENUE")-sum("EXPENSE"),netWorth:sum("ASSET")-sum("LIABILITY")},
    trialBalance:trial,
    counts:{openJobs:db.prepare("SELECT COUNT(*) c FROM jobs WHERE status!='Completed'").get().c, completedJobs:db.prepare("SELECT COUNT(*) c FROM jobs WHERE status='Completed'").get().c}
  });
});
app.listen(PORT,()=>console.log(`Klavierhaus v5 running on http://localhost:${PORT}`));

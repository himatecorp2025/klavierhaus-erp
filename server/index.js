
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
function canWriteResource(role, cfg){ return cfg.roles.includes(role); }

app.post("/api/login",(req,res)=>{
  const {email,password}=req.body;
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if(!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({error:"Invalid login"});
  const token=jwt.sign({id:u.id,name:u.name,email:u.email,role:u.role}, JWT_SECRET, {expiresIn:"12h"});
  res.json({token,user:{id:u.id,name:u.name,email:u.email,role:u.role}});
});

app.get("/api/me", auth, (req,res)=>res.json(req.user));

app.get("/api/users", auth, permit("ADMIN"), (req,res)=>res.json(db.prepare("SELECT id,name,email,role,created_at FROM users ORDER BY role,name").all()));
app.post("/api/users", auth, permit("ADMIN"), (req,res)=>{
  const {name,email,password,role}=req.body;
  const hash=bcrypt.hashSync(password,10);
  const id=rid("U");
  db.prepare("INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)").run(id,name,email,hash,role);
  res.json({id,name,email,role});
});

const resources = {
  contacts:{table:"contacts",prefix:"C",write:["name","company","type","email","phone","priority","status","owner","relationship_holder","loss_risk","last_contact","next_step","notes"],roles:["ADMIN","MANAGER"]},
  pianos:{table:"pianos",prefix:"P",write:["brand","model","serial_no","year","ownership","owner_contact_id","location","estimated_value","status","notes"],roles:["ADMIN","MANAGER","STAFF"]},
  projects:{table:"projects",prefix:"PR",write:["piano_id","client_id","name","type","manager","priority","status","start_date","due_date","planned_revenue","actual_revenue","planned_cost","actual_cost","location_type","service_address","customer_phone","customer_email","notes"],roles:["ADMIN","MANAGER","STAFF"]},
  tasks:{table:"tasks",prefix:"T",write:["project_id","phase_id","task_type","assigned_to","priority","status","due_date","appointment_start","appointment_end","timezone","location_type","service_address","travel_minutes","planned_hours","actual_hours","completion_revenue","payment_method","invoice_status","invoice_number","completion_notes","required_document_status","notes"],roles:["ADMIN","MANAGER","STAFF"]},
  documents:{table:"documents",prefix:"D",write:["related_type","related_id","title","doc_type","doc_date","url","stored_path","owner","amount","payment_method","invoice_number","notes"],roles:["ADMIN","MANAGER","STAFF"]},
  knowledge_base:{table:"knowledge_base",prefix:"KB",write:["title","category","brand","content_type","body","url","stored_path","owner","priority","project_id","phase_id"],roles:["ADMIN","MANAGER","STAFF"]}
};

for(const [key,cfg] of Object.entries(resources)){
  app.get(`/api/${key}`, auth, (req,res)=>{
    let rows=db.prepare(`SELECT * FROM ${cfg.table} ORDER BY created_at DESC`).all();
    if(req.user.role==="STAFF"){
      if(key==="contacts") rows=[];
      if(key==="tasks") rows=rows.filter(r=>r.assigned_to===req.user.name);
      if(key==="projects"){
        const visibleProjectIds = new Set(db.prepare("SELECT project_id FROM project_phases WHERE assigned_to=? UNION SELECT project_id FROM tasks WHERE assigned_to=?").all(req.user.name,req.user.name).map(x=>x.project_id));
        rows=rows.filter(r=>r.manager===req.user.name || visibleProjectIds.has(r.id));
      }
      if(key==="documents") rows=rows.filter(r=>r.owner===req.user.name || r.related_type==="Phase" || r.related_type==="Task");
    }
    res.json(rows);
  });
  app.post(`/api/${key}`, auth, (req,res)=>{
    if(!canWriteResource(req.user.role,cfg)) return res.status(403).json({error:"Forbidden"});
    const id=req.body.id || rid(cfg.prefix);
    const cols=["id",...cfg.write].filter(c=>c==="id" || req.body[c]!==undefined);
    const vals=cols.map(c=>c==="id"?id:req.body[c]);
    db.prepare(`INSERT INTO ${cfg.table}(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...vals);
    const row=db.prepare(`SELECT * FROM ${cfg.table} WHERE id=?`).get(id);
    if(key==="tasks") upsertSchedulerForTask(row);
    res.json(row);
  });
  app.put(`/api/${key}/:id`, auth, (req,res)=>{
    if(!canWriteResource(req.user.role,cfg)) return res.status(403).json({error:"Forbidden"});
    const old=db.prepare(`SELECT * FROM ${cfg.table} WHERE id=?`).get(req.params.id);
    if(!old) return res.status(404).json({error:"Not found"});
    if(req.user.role==="STAFF" && key==="tasks" && old.assigned_to!==req.user.name) return res.status(403).json({error:"Staff can edit only assigned tasks"});
    const cols=cfg.write.filter(c=>req.body[c]!==undefined);
    if(cols.length){
      const updatedCol = ["documents"].includes(cfg.table) ? "" : ", updated_at=CURRENT_TIMESTAMP";
      db.prepare(`UPDATE ${cfg.table} SET ${cols.map(c=>`${c}=?`).join(",")}${updatedCol} WHERE id=?`).run(...cols.map(c=>req.body[c]), req.params.id);
    }
    const row=db.prepare(`SELECT * FROM ${cfg.table} WHERE id=?`).get(req.params.id);
    if(key==="tasks") upsertSchedulerForTask(row);
    res.json(row);
  });
  app.delete(`/api/${key}/:id`, auth, permit("ADMIN","MANAGER"), (req,res)=>{
    db.prepare(`DELETE FROM ${cfg.table} WHERE id=?`).run(req.params.id);
    res.json({ok:true});
  });
}

function upsertSchedulerForTask(task){
  if(!task || !task.appointment_start || !task.appointment_end) return;
  const project=db.prepare("SELECT * FROM projects WHERE id=?").get(task.project_id);
  const existing=db.prepare("SELECT * FROM scheduler_events WHERE task_id=?").get(task.id);
  const title=task.task_type;
  if(existing){
    db.prepare(`UPDATE scheduler_events SET phase_id=?,project_id=?,title=?,assigned_to=?,event_start=?,event_end=?,service_address=?,priority=?,status=?,planned_amount=? WHERE task_id=?`)
      .run(task.phase_id,task.project_id,title,task.assigned_to,task.appointment_start,task.appointment_end,task.service_address||project?.service_address,task.priority,task.status,task.completion_revenue||0,task.id);
  } else {
    db.prepare(`INSERT INTO scheduler_events(id,task_id,phase_id,project_id,title,assigned_to,event_start,event_end,service_address,priority,status,event_type,planned_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(rid("EV"),task.id,task.phase_id,task.project_id,title,task.assigned_to,task.appointment_start,task.appointment_end,task.service_address||project?.service_address,task.priority,task.status,"Task",task.completion_revenue||0);
  }
}
function upsertSchedulerForPhase(phase){
  if(!phase || !phase.appointment_start || !phase.appointment_end) return;
  const project=db.prepare("SELECT * FROM projects WHERE id=?").get(phase.project_id);
  const existing=db.prepare("SELECT * FROM scheduler_events WHERE phase_id=?").get(phase.id);
  const title=`${project?.name || "Project"} · ${phase.phase_name}`;
  if(existing){
    db.prepare(`UPDATE scheduler_events SET project_id=?,title=?,assigned_to=?,event_start=?,event_end=?,service_address=?,priority=?,status=?,event_type='Phase',planned_amount=? WHERE phase_id=?`)
      .run(phase.project_id,title,phase.assigned_to,phase.appointment_start,phase.appointment_end,phase.service_address||project?.service_address,phase.priority,phase.status,phase.planned_amount||0,phase.id);
  } else {
    db.prepare(`INSERT INTO scheduler_events(id,phase_id,project_id,title,assigned_to,event_start,event_end,service_address,priority,status,event_type,planned_amount) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(rid("EV"),phase.id,phase.project_id,title,phase.assigned_to,phase.appointment_start,phase.appointment_end,phase.service_address||project?.service_address,phase.priority,phase.status,"Phase",phase.planned_amount||0);
  }
}

app.get("/api/phases", auth, (req,res)=>{
  let rows=db.prepare(`SELECT ph.*, p.name AS project_name, p.type AS project_type, p.client_id, p.piano_id FROM project_phases ph LEFT JOIN projects p ON p.id=ph.project_id ORDER BY ph.project_id, ph.sequence_no, ph.created_at`).all();
  if(req.user.role==="STAFF") rows=rows.filter(r=>r.assigned_to===req.user.name);
  res.json(rows);
});
app.post("/api/phases", auth, permit("ADMIN","MANAGER","STAFF"), (req,res)=>{
  const id=req.body.id || rid("PH");
  const allowed=["project_id","phase_name","phase_type","sequence_no","assigned_to","priority","status","planned_start","planned_end","appointment_start","appointment_end","timezone","service_address","planned_amount","billed_amount","payment_method","invoice_status","invoice_number","required_document_status","completion_notes","notes"];
  const cols=["id",...allowed].filter(c=>c==="id" || req.body[c]!==undefined);
  const vals=cols.map(c=>c==="id"?id:req.body[c]);
  db.prepare(`INSERT INTO project_phases(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...vals);
  const row=db.prepare("SELECT * FROM project_phases WHERE id=?").get(id);
  upsertSchedulerForPhase(row);
  res.json(row);
});
app.put("/api/phases/:id", auth, permit("ADMIN","MANAGER","STAFF"), (req,res)=>{
  const old=db.prepare("SELECT * FROM project_phases WHERE id=?").get(req.params.id);
  if(!old) return res.status(404).json({error:"Phase not found"});
  if(req.user.role==="STAFF" && old.assigned_to!==req.user.name) return res.status(403).json({error:"Staff can edit only assigned phases"});
  const allowed=["phase_name","phase_type","sequence_no","assigned_to","priority","status","planned_start","planned_end","appointment_start","appointment_end","timezone","service_address","planned_amount","billed_amount","payment_method","invoice_status","invoice_number","required_document_status","completion_notes","notes"];
  const cols=allowed.filter(c=>req.body[c]!==undefined);
  if(cols.length) db.prepare(`UPDATE project_phases SET ${cols.map(c=>`${c}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...cols.map(c=>req.body[c]), req.params.id);
  const row=db.prepare("SELECT * FROM project_phases WHERE id=?").get(req.params.id);
  upsertSchedulerForPhase(row);
  res.json(row);
});
app.post("/api/phases/:id/complete", auth, upload.single("file"), (req,res)=>{
  const phase=db.prepare("SELECT * FROM project_phases WHERE id=?").get(req.params.id);
  if(!phase) return res.status(404).json({error:"Phase not found"});
  if(req.user.role==="STAFF" && phase.assigned_to!==req.user.name) return res.status(403).json({error:"Forbidden"});
  const billed=Number(req.body.billed_amount);
  if(Number.isNaN(billed)) return res.status(400).json({error:"Billed amount is required. Use 0 if not billable."});
  const payment=req.body.payment_method || "";
  if(billed > 0 && !payment) return res.status(400).json({error:"Payment method is required when billed amount is greater than zero"});
  if(billed > 0 && !req.file && !req.body.document_url) return res.status(400).json({error:"Invoice/check document is required when billed amount is greater than zero"});
  const invoiceNumber=req.body.invoice_number || "";
  const notes=req.body.completion_notes || "";
  let storedPath=null;
  if(req.file){
    storedPath="/uploads/"+path.basename(req.file.path);
    db.prepare(`INSERT INTO documents(id,related_type,related_id,title,doc_type,doc_date,stored_path,owner,amount,payment_method,invoice_number,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(rid("D"),"Phase",phase.id,`Invoice/check for ${phase.phase_name}`,billed>0?"Invoice/Check":"Completion document",today(),storedPath,req.user.name,billed,payment,invoiceNumber,notes);
  }
  db.prepare(`UPDATE project_phases SET status='Completed', billed_amount=?, payment_method=?, invoice_status=?, invoice_number=?, completion_notes=?, required_document_status=?, completed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(billed,payment, billed>0 ? (req.body.invoice_status || "Invoiced") : "Not billable", invoiceNumber, notes, billed>0?"Uploaded":"Not required", nowISO(), phase.id);
  db.prepare("UPDATE scheduler_events SET status='Completed' WHERE phase_id=?").run(phase.id);
  if(billed > 0) createRevenueEntryForPhase(phase, billed, payment, req.user.id);
  const remaining=db.prepare("SELECT COUNT(*) c FROM project_phases WHERE project_id=? AND status!='Completed'").get(phase.project_id).c;
  if(remaining===0){
    db.prepare("UPDATE projects SET status='Completed', actual_revenue=COALESCE(actual_revenue,0)+(?) WHERE id=?").run(0,phase.project_id);
    db.prepare(`INSERT INTO knowledge_base(id,title,category,content_type,body,owner,priority,project_id,phase_id) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(rid("KB"),`Completed project: ${phase.project_id}`,"Completed Project","Procedure",`All phases completed for project ${phase.project_id}.`,req.user.name,"Medium",phase.project_id,phase.id);
  }
  res.json({ok:true, storedPath});
});

function createRevenueEntryForPhase(phase,billed,payment,userId){
  const project=db.prepare("SELECT * FROM projects WHERE id=?").get(phase.project_id);
  let debitAccount="1010";
  if(payment==="Cash") debitAccount="1000";
  if(payment==="Check") debitAccount="1020";
  if(payment==="Invoice") debitAccount="1200";
  if(payment==="Bank Transfer" || payment==="Credit Card") debitAccount="1010";
  let creditAccount="4200";
  if(phase.phase_type && phase.phase_type.includes("Concert")) creditAccount="4300";
  if(project && project.type==="Full restoration") creditAccount="4100";
  const je=rid("JE");
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,client_id,project_id,piano_id,phase_id,payment_method,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(je,today(),`Completed phase revenue: ${phase.phase_name}`,project?.client_id,phase.project_id,project?.piano_id,phase.id,payment,"POSTED",userId);
    const ins=db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)");
    ins.run(rid("JL"),je,debitAccount,billed,0,`Payment received/receivable: ${payment}`);
    ins.run(rid("JL"),je,creditAccount,0,billed,`Service revenue from phase ${phase.id}`);
    db.prepare("UPDATE projects SET actual_revenue=COALESCE(actual_revenue,0)+? WHERE id=?").run(billed, phase.project_id);
  });
  tx();
}

app.post("/api/projects/:id/generate-workflow", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const project=db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.id);
  if(!project) return res.status(404).json({error:"Project not found"});
  const existing=db.prepare("SELECT COUNT(*) c FROM project_phases WHERE project_id=?").get(project.id).c;
  if(existing>0 && !req.body.force) return res.status(409).json({error:"Project already has phases"});
  const templates=db.prepare("SELECT * FROM task_templates WHERE project_type=? ORDER BY sequence_no").all(project.type);
  const ins=db.prepare(`INSERT INTO project_phases(id,project_id,phase_name,phase_type,sequence_no,assigned_to,priority,status,planned_start,planned_end,service_address,planned_amount,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const tx=db.transaction(()=>{
    templates.forEach((t,idx)=>ins.run(rid("PH"),project.id,t.task_type,t.task_type,idx+1,project.manager,t.default_priority,"Open",project.start_date,project.due_date,project.service_address,0,`Auto generated phase ${idx+1}`));
  });
  tx();
  res.json(db.prepare("SELECT * FROM project_phases WHERE project_id=? ORDER BY sequence_no").all(project.id));
});

app.get("/api/scheduler", auth, (req,res)=>{
  let rows=db.prepare("SELECT * FROM scheduler_events ORDER BY event_start").all();
  if(req.user.role==="STAFF") rows=rows.filter(r=>r.assigned_to===req.user.name);
  res.json(rows);
});

app.post("/api/tasks/:id/complete", auth, upload.single("file"), (req,res)=>{
  const task=db.prepare("SELECT * FROM tasks WHERE id=?").get(req.params.id);
  if(!task) return res.status(404).json({error:"Task not found"});
  if(req.user.role==="STAFF" && task.assigned_to!==req.user.name) return res.status(403).json({error:"Forbidden"});
  const revenue=Number(req.body.completion_revenue);
  if(Number.isNaN(revenue)) return res.status(400).json({error:"Completion revenue is required. Use 0 if not billable."});
  const payment=req.body.payment_method || "";
  if(revenue > 0 && !payment) return res.status(400).json({error:"Payment method is required when revenue is greater than zero"});
  if(revenue > 0 && !req.file && !req.body.document_url) return res.status(400).json({error:"Invoice/check document is required when revenue is greater than zero"});
  const invoiceNumber=req.body.invoice_number || "";
  const notes=req.body.completion_notes || "";
  let storedPath=null;
  if(req.file){
    storedPath="/uploads/"+path.basename(req.file.path);
    db.prepare(`INSERT INTO documents(id,related_type,related_id,title,doc_type,doc_date,stored_path,owner,amount,payment_method,invoice_number,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(rid("D"),"Task",task.id,`${payment || "No bill"} document for ${task.id}`,revenue>0?"Invoice/Check":"Completion document",today(),storedPath,req.user.name,revenue,payment,invoiceNumber,notes);
  }
  db.prepare(`UPDATE tasks SET status='Completed', actual_hours=?, completion_revenue=?, payment_method=?, invoice_status=?, invoice_number=?, completion_notes=?, required_document_status=?, completed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(Number(req.body.actual_hours||task.actual_hours||task.planned_hours||0),revenue,payment,revenue>0?(req.body.invoice_status||"Invoiced"):"Not billable",invoiceNumber,notes,revenue>0?"Uploaded":"Not required",nowISO(),task.id);
  db.prepare("UPDATE scheduler_events SET status='Completed' WHERE task_id=?").run(task.id);
  if(revenue > 0) createRevenueEntryForTask(task, revenue, payment, req.user.id);
  res.json({ok:true, storedPath});
});

function createRevenueEntryForTask(task,revenue,payment,userId){
  const project=db.prepare("SELECT * FROM projects WHERE id=?").get(task.project_id);
  let debitAccount="1010";
  if(payment==="Cash") debitAccount="1000";
  if(payment==="Check") debitAccount="1020";
  if(payment==="Invoice") debitAccount="1200";
  if(payment==="Bank Transfer" || payment==="Credit Card") debitAccount="1010";
  let creditAccount="4200";
  if(task.task_type && task.task_type.includes("Concert")) creditAccount="4300";
  if(project && project.type==="Full restoration") creditAccount="4100";
  const je=rid("JE");
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,client_id,project_id,piano_id,task_id,payment_method,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(je,today(),`Completed task revenue: ${task.task_type}`,project?.client_id,task.project_id,project?.piano_id,task.id,payment,"POSTED",userId);
    const ins=db.prepare("INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)");
    ins.run(rid("JL"),je,debitAccount,revenue,0,`Payment received/receivable: ${payment}`);
    ins.run(rid("JL"),je,creditAccount,0,revenue,`Service revenue from task ${task.id}`);
    db.prepare("UPDATE projects SET actual_revenue=COALESCE(actual_revenue,0)+? WHERE id=?").run(revenue, task.project_id);
  });
  tx();
}

app.get("/api/accounts", auth, (req,res)=>res.json(db.prepare("SELECT * FROM accounts ORDER BY code").all()));
app.get("/api/finance/entries", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const entries=db.prepare("SELECT * FROM journal_entries ORDER BY entry_date DESC, created_at DESC").all();
  const lines=db.prepare("SELECT * FROM journal_lines WHERE entry_id=? ORDER BY id");
  res.json(entries.map(e=>({...e,lines:lines.all(e.id)})));
});
app.post("/api/finance/entries", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const {entry_date,description,client_id,project_id,piano_id,task_id,phase_id,payment_method,status,lines}=req.body;
  if(!Array.isArray(lines)||lines.length<2) return res.status(400).json({error:"At least two journal lines required"});
  const debit=lines.reduce((s,l)=>s+Number(l.debit||0),0), credit=lines.reduce((s,l)=>s+Number(l.credit||0),0);
  if(Math.abs(debit-credit)>0.005) return res.status(400).json({error:"Debit and credit must balance",debit,credit});
  const id=rid("JE");
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,client_id,project_id,piano_id,task_id,phase_id,payment_method,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,entry_date,description,client_id||null,project_id||null,piano_id||null,task_id||null,phase_id||null,payment_method,status||"POSTED",req.user.id);
    const ins=db.prepare(`INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)`);
    lines.forEach(l=>ins.run(rid("JL"),id,l.account_code,Number(l.debit||0),Number(l.credit||0),l.memo||""));
  });
  tx();
  res.json({ok:true,id});
});

app.get("/api/dashboard", auth, (req,res)=>{
  const trial=db.prepare("SELECT * FROM v_trial_balance ORDER BY code").all();
  const sum=cat=>trial.filter(a=>a.category===cat).reduce((s,a)=>s+Number(a.balance||0),0);
  const activeProjects=db.prepare("SELECT COUNT(*) c FROM projects WHERE status NOT IN ('Completed','Kész')").get().c;
  const overduePhases=db.prepare("SELECT COUNT(*) c FROM project_phases WHERE planned_end < date('now') AND status!='Completed'").get().c;
  const openPhases=db.prepare("SELECT COUNT(*) c FROM project_phases WHERE status!='Completed'").get().c;
  res.json({
    totals:{assets:sum("ASSET"),liabilities:sum("LIABILITY"),equity:sum("EQUITY"),revenue:sum("REVENUE"),expense:sum("EXPENSE"),profit:sum("REVENUE")-sum("EXPENSE"),netWorth:sum("ASSET")-sum("LIABILITY")},
    trialBalance: req.user.role==="STAFF" ? [] : trial,
    counts:{activeProjects,overdueTasks:overduePhases,overrunTasks:0,openPhases},
    alerts:{
      criticalContacts:req.user.role==="STAFF"?[]:db.prepare("SELECT * FROM contacts WHERE priority='Critical' LIMIT 10").all(),
      overrunTasks:[],
      overdueTasks:db.prepare("SELECT * FROM project_phases WHERE planned_end < date('now') AND status!='Completed' LIMIT 10").all()
    }
  });
});

app.listen(PORT,()=>console.log(`Klavierhaus Cloud ERP v4 running on http://localhost:${PORT}`));

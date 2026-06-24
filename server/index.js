
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
function canSeeAssigned(user, assigned){
  return user.role !== "STAFF" || user.name === assigned;
}

app.post("/api/login",(req,res)=>{
  const {email,password}=req.body;
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if(!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({error:"Invalid login"});
  const token=jwt.sign({id:u.id,name:u.name,email:u.email,role:u.role}, JWT_SECRET, {expiresIn:"12h"});
  res.json({token,user:{id:u.id,name:u.name,email:u.email,role:u.role}});
});

app.get("/api/me", auth, (req,res)=>res.json(req.user));

app.get("/api/users", auth, permit("ADMIN"), (req,res)=>{
  res.json(db.prepare("SELECT id,name,email,role,created_at FROM users ORDER BY role,name").all());
});
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
  tasks:{table:"tasks",prefix:"T",write:["project_id","task_type","assigned_to","priority","status","due_date","appointment_start","appointment_end","timezone","location_type","service_address","travel_minutes","planned_hours","actual_hours","completion_revenue","payment_method","invoice_status","invoice_number","completion_notes","required_document_status","notes"],roles:["ADMIN","MANAGER","STAFF"]},
  documents:{table:"documents",prefix:"D",write:["related_type","related_id","title","doc_type","doc_date","url","stored_path","owner","notes"],roles:["ADMIN","MANAGER","STAFF"]},
  knowledge_base:{table:"knowledge_base",prefix:"KB",write:["title","category","brand","content_type","body","url","stored_path","owner","priority"],roles:["ADMIN","MANAGER","STAFF"]}
};

for(const [key,cfg] of Object.entries(resources)){
  app.get(`/api/${key}`, auth, (req,res)=>{
    let rows=db.prepare(`SELECT * FROM ${cfg.table} ORDER BY created_at DESC`).all();
    if(req.user.role==="STAFF"){
      if(key==="contacts") rows=[];
      if(key==="tasks") rows=rows.filter(r=>r.assigned_to===req.user.name);
      if(key==="projects"){
        const visibleProjectIds = new Set(db.prepare("SELECT project_id FROM tasks WHERE assigned_to=?").all(req.user.name).map(x=>x.project_id));
        rows=rows.filter(r=>r.manager===req.user.name || visibleProjectIds.has(r.id));
      }
      if(key==="documents") rows=rows.filter(r=>r.owner===req.user.name || r.related_type==="Task");
    }
    res.json(rows);
  });
  app.post(`/api/${key}`, auth, (req,res,next)=>{
    if(!cfg.roles.includes(req.user.role)) return res.status(403).json({error:"Forbidden"});
    const id=req.body.id || rid(cfg.prefix);
    const cols=["id",...cfg.write].filter(c=>c==="id" || req.body[c]!==undefined);
    const vals=cols.map(c=>c==="id"?id:req.body[c]);
    db.prepare(`INSERT INTO ${cfg.table}(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`).run(...vals);
    const row=db.prepare(`SELECT * FROM ${cfg.table} WHERE id=?`).get(id);
    if(key==="tasks") upsertSchedulerForTask(row);
    res.json(row);
  });
  app.put(`/api/${key}/:id`, auth, (req,res)=>{
    if(!cfg.roles.includes(req.user.role)) return res.status(403).json({error:"Forbidden"});
    const old=db.prepare(`SELECT * FROM ${cfg.table} WHERE id=?`).get(req.params.id);
    if(!old) return res.status(404).json({error:"Not found"});
    if(req.user.role==="STAFF" && key==="tasks" && old.assigned_to!==req.user.name) return res.status(403).json({error:"Staff can edit only assigned tasks"});
    const cols=cfg.write.filter(c=>req.body[c]!==undefined);
    if(cols.length){
      const updatedCol = cfg.table === "documents" ? "" : ", updated_at=CURRENT_TIMESTAMP";
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
    db.prepare(`UPDATE scheduler_events SET project_id=?,title=?,assigned_to=?,event_start=?,event_end=?,service_address=?,priority=?,status=? WHERE task_id=?`)
      .run(task.project_id,title,task.assigned_to,task.appointment_start,task.appointment_end,task.service_address||project?.service_address,task.priority,task.status,task.id);
  } else {
    db.prepare(`INSERT INTO scheduler_events(id,task_id,project_id,title,assigned_to,event_start,event_end,service_address,priority,status) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(rid("EV"),task.id,task.project_id,title,task.assigned_to,task.appointment_start,task.appointment_end,task.service_address||project?.service_address,task.priority,task.status);
  }
}

app.post("/api/projects/:id/generate-workflow", auth, permit("ADMIN","MANAGER"), (req,res)=>{
  const project=db.prepare("SELECT * FROM projects WHERE id=?").get(req.params.id);
  if(!project) return res.status(404).json({error:"Project not found"});
  const existing=db.prepare("SELECT COUNT(*) c FROM tasks WHERE project_id=?").get(project.id).c;
  if(existing>0 && !req.body.force) return res.status(409).json({error:"Project already has tasks"});
  const templates=db.prepare("SELECT * FROM task_templates WHERE project_type=? ORDER BY sequence_no").all(project.type);
  const ins=db.prepare(`INSERT INTO tasks(id,project_id,task_type,assigned_to,priority,status,due_date,appointment_start,appointment_end,location_type,service_address,planned_hours,actual_hours,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const tx=db.transaction(()=>{
    templates.forEach((t,idx)=>ins.run(rid("T"),project.id,t.task_type,project.manager,t.default_priority,"Open",project.due_date,null,null,project.location_type,project.service_address,t.default_planned_hours,0,`Auto workflow step ${idx+1}`));
  });
  tx();
  res.json(db.prepare("SELECT * FROM tasks WHERE project_id=? ORDER BY created_at").all(project.id));
});

app.get("/api/my-work", auth, (req,res)=>{
  const name=req.query.user || req.user.name;
  if(req.user.role==="STAFF" && name!==req.user.name) return res.status(403).json({error:"Forbidden"});
  const rows=db.prepare(`
    SELECT t.*, p.name AS project_name, p.client_id, p.service_address AS project_address, c.name AS client_name, c.phone AS client_phone
    FROM tasks t
    LEFT JOIN projects p ON p.id=t.project_id
    LEFT JOIN contacts c ON c.id=p.client_id
    WHERE t.assigned_to=?
    ORDER BY COALESCE(t.appointment_start,t.due_date), 
      CASE t.priority WHEN 'Critical' THEN 1 WHEN 'Urgent' THEN 2 WHEN 'High' THEN 3 WHEN 'Medium' THEN 4 ELSE 5 END
  `).all(name);
  const now=new Date();
  const enriched=rows.map(r=>{
    let computed="Scheduled";
    if(r.status==="Completed") computed="Completed";
    else if(r.appointment_end && new Date(r.appointment_end)<now) computed="Needs closeout";
    else if(r.due_date && new Date(r.due_date+"T23:59:59")<now) computed="Overdue";
    return {...r, computed_status:computed};
  });
  res.json(enriched);
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
  const revenue=Number(req.body.completion_revenue||0);
  const payment=req.body.payment_method;
  const invoiceStatus=req.body.invoice_status || "Not invoiced";
  if(!revenue || !payment) return res.status(400).json({error:"Completion revenue and payment method are required"});
  const needsFile = ["Check","Invoice"].includes(payment) || invoiceStatus==="Invoiced";
  if(needsFile && !req.file && !req.body.document_url) return res.status(400).json({error:"Document upload is required for Check or Invoice"});
  const invoiceNumber=req.body.invoice_number || "";
  const notes=req.body.completion_notes || "";
  let storedPath=null;
  if(req.file){
    storedPath="/uploads/"+path.basename(req.file.path);
    db.prepare(`INSERT INTO documents(id,related_type,related_id,title,doc_type,doc_date,stored_path,owner,notes) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(rid("D"),"Task",task.id,`${payment} document for ${task.id}`,payment,new Date().toISOString().slice(0,10),storedPath,req.user.name,notes);
  }
  db.prepare(`UPDATE tasks SET status='Completed', actual_hours=?, completion_revenue=?, payment_method=?, invoice_status=?, invoice_number=?, completion_notes=?, required_document_status=?, completed_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(Number(req.body.actual_hours||task.actual_hours||task.planned_hours||0),revenue,payment,invoiceStatus,invoiceNumber,notes,needsFile?"Uploaded":"Not required",nowISO(),task.id);
  db.prepare("UPDATE scheduler_events SET status='Completed' WHERE task_id=?").run(task.id);
  createRevenueEntry(task, revenue, payment, req.user.id);
  res.json({ok:true, storedPath});
});

function createRevenueEntry(task,revenue,payment,userId){
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
      .run(je,new Date().toISOString().slice(0,10),`Completed task revenue: ${task.task_type}`,project?.client_id,task.project_id,project?.piano_id,task.id,payment,"POSTED",userId);
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
  const {entry_date,description,client_id,project_id,piano_id,task_id,payment_method,status,lines}=req.body;
  if(!Array.isArray(lines)||lines.length<2) return res.status(400).json({error:"At least two journal lines required"});
  const debit=lines.reduce((s,l)=>s+Number(l.debit||0),0), credit=lines.reduce((s,l)=>s+Number(l.credit||0),0);
  if(Math.abs(debit-credit)>0.005) return res.status(400).json({error:"Debit and credit must balance",debit,credit});
  const id=rid("JE");
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO journal_entries(id,entry_date,description,client_id,project_id,piano_id,task_id,payment_method,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id,entry_date,description,client_id||null,project_id||null,piano_id||null,task_id||null,payment_method,status||"POSTED",req.user.id);
    const ins=db.prepare(`INSERT INTO journal_lines(id,entry_id,account_code,debit,credit,memo) VALUES(?,?,?,?,?,?)`);
    lines.forEach(l=>ins.run(rid("JL"),id,l.account_code,Number(l.debit||0),Number(l.credit||0),l.memo||""));
  });
  tx();
  res.json({ok:true,id});
});

app.get("/api/dashboard", auth, (req,res)=>{
  const trial=db.prepare("SELECT * FROM v_trial_balance ORDER BY code").all();
  const sum=cat=>trial.filter(a=>a.category===cat).reduce((s,a)=>s+Number(a.balance||0),0);
  const taskFilter=req.user.role==="STAFF" ? "WHERE assigned_to=?" : "";
  const param=req.user.role==="STAFF" ? [req.user.name] : [];
  const activeProjects=db.prepare("SELECT COUNT(*) c FROM projects WHERE status NOT IN ('Completed','Kész')").get().c;
  const overdueTasks=db.prepare(`SELECT COUNT(*) c FROM tasks ${taskFilter ? taskFilter + " AND" : "WHERE"} due_date < date('now') AND status NOT LIKE 'Completed%'`).get(...param).c;
  const overrunTasks=db.prepare(`SELECT COUNT(*) c FROM tasks ${taskFilter ? taskFilter + " AND" : "WHERE"} actual_hours > planned_hours`).get(...param).c;
  res.json({
    totals:{assets:sum("ASSET"),liabilities:sum("LIABILITY"),equity:sum("EQUITY"),revenue:sum("REVENUE"),expense:sum("EXPENSE"),profit:sum("REVENUE")-sum("EXPENSE"),netWorth:sum("ASSET")-sum("LIABILITY")},
    trialBalance: req.user.role==="STAFF" ? [] : trial,
    counts:{activeProjects,overdueTasks,overrunTasks},
    alerts:{
      criticalContacts:req.user.role==="STAFF"?[]:db.prepare("SELECT * FROM contacts WHERE priority='Critical' LIMIT 10").all(),
      overrunTasks:db.prepare(`SELECT * FROM tasks ${taskFilter ? taskFilter + " AND" : "WHERE"} actual_hours > planned_hours LIMIT 10`).all(...param),
      overdueTasks:db.prepare(`SELECT * FROM tasks ${taskFilter ? taskFilter + " AND" : "WHERE"} due_date < date('now') AND status NOT LIKE 'Completed%' LIMIT 10`).all(...param)
    }
  });
});

app.listen(PORT,()=>console.log(`Klavierhaus Cloud ERP v3 running on http://localhost:${PORT}`));

"use strict";

const WORKFLOW_STAGES = Object.freeze([
  { key: "planned", label: "Tervezett" },
  { key: "scheduled", label: "Ütemezett" },
  { key: "in_progress", label: "Folyamatban" },
  { key: "blocked", label: "Blokkolva" },
  { key: "ready_for_closeout", label: "Lezárásra vár" }
]);
const WORKFLOW_KEYS = new Set(WORKFLOW_STAGES.map(stage => stage.key));

function text(value,max=5000){
  return String(value ?? "").replace(/\u0000/g,"").trim().slice(0,max);
}
function integerId(value){
  const id=Number(value);
  return Number.isSafeInteger(id)&&id>0?id:null;
}
function problem(code,status=400,extra=null){
  const error=new Error(code);error.status=status;error.extra=extra;return error;
}
function respondError(res,error){
  res.status(Number(error?.status||400)).json({error:error?.message||"ROUND2_REQUEST_FAILED",...(error?.extra||{})});
}
function iso(value,code="INVALID_SCHEDULE_TIME"){
  const raw=text(value,80);
  if(!raw)throw problem(code);
  const date=new Date(raw);
  if(Number.isNaN(date.getTime()))throw problem(code);
  return date.toISOString();
}
function validateSchedule(startValue,endValue){
  const start=iso(startValue,"INVALID_SCHEDULE_START");
  const end=iso(endValue,"INVALID_SCHEDULE_END");
  if(new Date(end).getTime()<=new Date(start).getTime())throw problem("INVALID_SCHEDULE_RANGE");
  return {start,end};
}
function newYorkYear(){
  return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric"}).format(new Date());
}

function registerRound2WorkflowRoutes({app,db,auth,permit,audit}){
  const staff=permit("ADMIN","MANAGER","WORKER");
  const selectJob=`SELECT j.*,
    c.name AS client_name,c.email AS client_email,c.phone AS client_phone,c.address AS client_address,
    p.brand AS piano_brand,p.model AS piano_model,p.serial_number AS piano_serial_number,
    u.name AS assigned_technician_name,u.calendar_color AS assigned_technician_color
    FROM jobs j
    JOIN clients c ON c.id=j.client_id
    JOIN pianos p ON p.id=j.piano_id
    LEFT JOIN users u ON u.id=j.assigned_technician_id`;
  const jobById=id=>db.prepare(`${selectJob} WHERE j.id=?`).get(id);

  function requireClientPiano(clientId,pianoId){
    const client=clientId&&db.prepare("SELECT * FROM clients WHERE id=?").get(clientId);
    if(!client)throw problem("INVALID_CLIENT_ID");
    const piano=pianoId&&db.prepare("SELECT * FROM pianos WHERE id=? AND client_id=?").get(pianoId,clientId);
    if(!piano)throw problem("INVALID_PIANO_ID");
    return {client,piano};
  }
  function technician(id){
    const value=text(id,160);
    if(!value)return null;
    const row=db.prepare("SELECT id,name,role,status,calendar_color FROM users WHERE id=? AND status='Active' AND role IN ('WORKER','MANAGER','ADMIN')").get(value);
    if(!row)throw problem("INVALID_TECHNICIAN_ID");
    return row;
  }
  function findConflict(jobId,technicianId,start,end){
    if(!technicianId)return null;
    return db.prepare(`${selectJob}
      WHERE j.id<>? AND j.assigned_technician_id=? AND j.status IN ('scheduled','in_progress','blocked')
        AND j.scheduled_start IS NOT NULL AND j.scheduled_end IS NOT NULL
        AND j.scheduled_start < ? AND j.scheduled_end > ?
      ORDER BY j.scheduled_start,j.id LIMIT 1`).get(jobId||0,technicianId,end,start);
  }
  function createJob(body,req,defaults={}){
    const clientId=integerId(body?.client_id ?? defaults.client_id);
    const pianoId=integerId(body?.piano_id ?? defaults.piano_id);
    const {client}=requireClientPiano(clientId,pianoId);
    const intakeId=integerId(body?.intake_lead_id ?? defaults.intake_lead_id);
    if(intakeId){
      const lead=db.prepare("SELECT * FROM intake_leads WHERE id=?").get(intakeId);
      if(!lead)throw problem("INTAKE_NOT_FOUND",404);
      if(lead.status!=="converted")throw problem("INTAKE_MUST_BE_CONVERTED",409);
      if(Number(lead.client_id)!==clientId||Number(lead.piano_id)!==pianoId)throw problem("INTAKE_MASTER_DATA_MISMATCH",409);
      const existing=db.prepare("SELECT id FROM jobs WHERE intake_lead_id=?").get(intakeId);
      if(existing)throw problem("INTAKE_JOB_ALREADY_EXISTS",409,{job_id:Number(existing.id)});
    }
    const title=text(body?.title ?? defaults.title,240);
    if(!title)throw problem("JOB_TITLE_REQUIRED");
    const serviceLocation=text(body?.service_location ?? defaults.service_location ?? "workshop",30);
    if(!["workshop","on_site"].includes(serviceLocation))throw problem("INVALID_SERVICE_LOCATION");
    const priority=text(body?.priority ?? defaults.priority ?? "normal",30);
    if(!["low","normal","urgent"].includes(priority))throw problem("INVALID_PRIORITY");
    const tech=technician(body?.assigned_technician_id ?? defaults.assigned_technician_id);
    let scheduledStart=null,scheduledEnd=null,status="planned";
    const startRaw=text(body?.scheduled_start,80),endRaw=text(body?.scheduled_end,80);
    if(startRaw||endRaw){
      if(!startRaw||!endRaw)throw problem("SCHEDULE_PAIR_REQUIRED");
      if(!tech)throw problem("TECHNICIAN_REQUIRED_FOR_SCHEDULE");
      const schedule=validateSchedule(startRaw,endRaw);
      const conflict=findConflict(0,tech.id,schedule.start,schedule.end);
      if(conflict)throw problem("SCHEDULE_CONFLICT",409,{conflict});
      scheduledStart=schedule.start;scheduledEnd=schedule.end;status="scheduled";
    }
    const info=db.prepare(`INSERT INTO jobs(
      job_code,client_id,piano_id,intake_lead_id,title,description,service_location,service_address,priority,status,
      assigned_technician_id,scheduled_start,scheduled_end,timezone,blocked_reason,internal_notes,position,created_by_user_id,created_at,updated_at
    ) VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,'America/New_York',NULL,?,0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
      clientId,pianoId,intakeId,title,text(body?.description ?? defaults.description,10000)||null,serviceLocation,
      text(body?.service_address ?? defaults.service_address ?? (serviceLocation==="on_site"?client.address:""),1200)||null,
      priority,status,tech?.id||null,scheduledStart,scheduledEnd,text(body?.internal_notes ?? defaults.internal_notes,10000)||null,req.user.id
    );
    const id=Number(info.lastInsertRowid);
    const code=`KH-${newYorkYear()}-${String(id).padStart(5,"0")}`;
    db.prepare("UPDATE jobs SET job_code=? WHERE id=?").run(code,id);
    const created=jobById(id);audit(req,"CREATE","jobs",String(id),null,created);return created;
  }

  app.get("/api/jobs",auth,staff,(req,res)=>{
    try{
      const status=text(req.query.status,40);
      if(status&&!WORKFLOW_KEYS.has(status))throw problem("INVALID_JOB_STATUS");
      const q=text(req.query.q,180).toLowerCase(),like=`%${q}%`;
      const technicianId=text(req.query.technician_id,160);
      const rows=db.prepare(`${selectJob}
        WHERE (?='' OR j.status=?)
          AND (?='' OR j.assigned_technician_id=?)
          AND (?='' OR lower(j.title) LIKE ? OR lower(COALESCE(j.description,'')) LIKE ? OR lower(c.name) LIKE ? OR lower(p.brand||' '||COALESCE(p.model,'')) LIKE ? OR lower(COALESCE(j.job_code,'')) LIKE ?)
        ORDER BY CASE j.status WHEN 'planned' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'blocked' THEN 3 ELSE 4 END,
          COALESCE(j.scheduled_start,j.created_at),j.id`).all(status,status,technicianId,technicianId,q,like,like,like,like,like);
      res.json(rows);
    }catch(error){respondError(res,error);}
  });

  app.get("/api/jobs/:id",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),row=id&&jobById(id);
    if(!row)return res.status(404).json({error:"JOB_NOT_FOUND"});
    res.json(row);
  });

  app.get("/api/planned-jobs",auth,staff,(_req,res)=>{
    res.json(db.prepare(`${selectJob} WHERE j.status='planned' ORDER BY CASE j.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,j.created_at,j.id`).all());
  });

  app.get("/api/clients/:id/jobs",auth,staff,(req,res)=>{
    const clientId=integerId(req.params.id);
    if(!clientId||!db.prepare("SELECT 1 FROM clients WHERE id=?").get(clientId))return res.status(404).json({error:"CLIENT_NOT_FOUND"});
    res.json(db.prepare(`${selectJob} WHERE j.client_id=? ORDER BY j.created_at DESC,j.id DESC`).all(clientId));
  });

  app.get("/api/workshop",auth,staff,(_req,res)=>{
    const jobs=db.prepare(`${selectJob}
      ORDER BY CASE j.status WHEN 'planned' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'blocked' THEN 3 ELSE 4 END,
      CASE j.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,COALESCE(j.scheduled_start,j.updated_at),j.id`).all();
    res.json({stages:WORKFLOW_STAGES,columns:WORKFLOW_STAGES.map(stage=>({...stage,jobs:jobs.filter(job=>job.status===stage.key)})),jobs});
  });

  app.get("/api/calendar",auth,staff,(req,res)=>{
    try{
      const now=Date.now(),from=iso(req.query.from||new Date(now-86400000).toISOString(),"INVALID_CALENDAR_FROM");
      const to=iso(req.query.to||new Date(now+31*86400000).toISOString(),"INVALID_CALENDAR_TO");
      if(new Date(to).getTime()<=new Date(from).getTime())throw problem("INVALID_CALENDAR_RANGE");
      const technicianId=text(req.query.technician_id,160);
      const rows=db.prepare(`${selectJob}
        WHERE j.scheduled_start IS NOT NULL AND j.scheduled_end IS NOT NULL
          AND j.scheduled_start < ? AND j.scheduled_end > ?
          AND (?='' OR j.assigned_technician_id=?)
        ORDER BY j.scheduled_start,j.scheduled_end,j.id`).all(to,from,technicianId,technicianId);
      res.json({from,to,timezone:"America/New_York",jobs:rows});
    }catch(error){respondError(res,error);}
  });

  app.post("/api/jobs",auth,staff,(req,res)=>{
    try{res.status(201).json(createJob(req.body||{},req));}
    catch(error){respondError(res,error);}
  });

  app.post("/api/intake/:id/create-job",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),lead=id&&db.prepare("SELECT * FROM intake_leads WHERE id=?").get(id);
    if(!lead)return res.status(404).json({error:"INTAKE_NOT_FOUND"});
    if(lead.status!=="converted")return res.status(409).json({error:"INTAKE_MUST_BE_CONVERTED"});
    const existing=db.prepare("SELECT id FROM jobs WHERE intake_lead_id=?").get(id);
    if(existing)return res.json({ok:true,idempotent:true,job:jobById(Number(existing.id))});
    try{
      const title=text(req.body?.title,240)||text(lead.reported_issue,180)||"Szervizmunka";
      const job=createJob(req.body||{},req,{client_id:lead.client_id,piano_id:lead.piano_id,intake_lead_id:lead.id,title,
        description:lead.reported_issue,service_location:lead.service_location,priority:lead.estimated_urgency,
        assigned_technician_id:lead.assigned_technician_id});
      res.status(201).json({ok:true,idempotent:false,job});
    }catch(error){respondError(res,error);}
  });

  app.put("/api/jobs/:id",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&jobById(id);
    if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    try{
      const title=text(req.body?.title ?? before.title,240);
      if(!title)throw problem("JOB_TITLE_REQUIRED");
      const priority=text(req.body?.priority ?? before.priority,30);
      if(!["low","normal","urgent"].includes(priority))throw problem("INVALID_PRIORITY");
      const serviceLocation=text(req.body?.service_location ?? before.service_location,30);
      if(!["workshop","on_site"].includes(serviceLocation))throw problem("INVALID_SERVICE_LOCATION");
      const tech=technician(req.body?.assigned_technician_id ?? before.assigned_technician_id);
      if(before.scheduled_start&&before.scheduled_end&&tech){
        const conflict=findConflict(id,tech.id,before.scheduled_start,before.scheduled_end);
        if(conflict)throw problem("SCHEDULE_CONFLICT",409,{conflict});
      }
      db.prepare(`UPDATE jobs SET title=?,description=?,service_location=?,service_address=?,priority=?,assigned_technician_id=?,
        blocked_reason=?,internal_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
        title,text(req.body?.description ?? before.description,10000)||null,serviceLocation,
        text(req.body?.service_address ?? before.service_address,1200)||null,priority,tech?.id||null,
        text(req.body?.blocked_reason ?? before.blocked_reason,5000)||null,text(req.body?.internal_notes ?? before.internal_notes,10000)||null,id
      );
      const after=jobById(id);audit(req,"UPDATE","jobs",String(id),before,after);res.json(after);
    }catch(error){respondError(res,error);}
  });

  app.patch("/api/jobs/:id/schedule",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&jobById(id);
    if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    try{
      if(req.body?.clear===true){
        const nextStatus=before.status==="ready_for_closeout"?"ready_for_closeout":"planned";
        db.prepare("UPDATE jobs SET scheduled_start=NULL,scheduled_end=NULL,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nextStatus,id);
        const after=jobById(id);audit(req,"UNSCHEDULE","jobs",String(id),before,after);return res.json(after);
      }
      const schedule=validateSchedule(req.body?.scheduled_start,req.body?.scheduled_end);
      const tech=technician(req.body?.assigned_technician_id ?? before.assigned_technician_id);
      if(!tech)throw problem("TECHNICIAN_REQUIRED_FOR_SCHEDULE");
      const conflict=findConflict(id,tech.id,schedule.start,schedule.end);
      if(conflict)throw problem("SCHEDULE_CONFLICT",409,{conflict});
      const nextStatus=before.status==="planned"?"scheduled":before.status;
      db.prepare("UPDATE jobs SET assigned_technician_id=?,scheduled_start=?,scheduled_end=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(tech.id,schedule.start,schedule.end,nextStatus,id);
      const after=jobById(id);audit(req,"SCHEDULE","jobs",String(id),before,after);res.json(after);
    }catch(error){respondError(res,error);}
  });

  app.patch("/api/jobs/:id/status",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&jobById(id);
    if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    try{
      const status=text(req.body?.status,40);
      if(!WORKFLOW_KEYS.has(status))throw problem("INVALID_JOB_STATUS");
      let blockedReason=text(req.body?.blocked_reason ?? before.blocked_reason,5000)||null;
      if(status==="scheduled"||status==="in_progress"){
        if(!before.scheduled_start||!before.scheduled_end)throw problem("SCHEDULE_REQUIRED_FOR_STATUS",409);
        if(!before.assigned_technician_id)throw problem("TECHNICIAN_REQUIRED_FOR_STATUS",409);
      }
      if(status==="blocked"&&!blockedReason)throw problem("BLOCKED_REASON_REQUIRED");
      if(status!=="blocked")blockedReason=null;
      if(status==="planned"){
        db.prepare("UPDATE jobs SET status='planned',scheduled_start=NULL,scheduled_end=NULL,blocked_reason=NULL,ready_for_closeout_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      }else{
        db.prepare(`UPDATE jobs SET status=?,blocked_reason=?,ready_for_closeout_at=CASE WHEN ?='ready_for_closeout' THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(status,blockedReason,status,id);
      }
      const after=jobById(id);audit(req,"STATUS","jobs",String(id),before,after);res.json(after);
    }catch(error){respondError(res,error);}
  });
}

module.exports={registerRound2WorkflowRoutes,WORKFLOW_STAGES};

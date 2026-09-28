"use strict";

const {convertIntakeLead}=require("./round1-core");

const PIPELINE_STAGE="planned";
const WORKFLOW_STAGES=Object.freeze([
  {key:"received",label_en:"Received / Scheduled",label_hu:"Beérkezett / Ütemezve"},
  {key:"in_progress",label_en:"In Progress",label_hu:"Folyamatban"},
  {key:"qa_review",label_en:"QA / Handoff",label_hu:"Minőségellenőrzés / Átadás"},
  {key:"admin_approval",label_en:"Admin Approval",label_hu:"Admin Jóváhagyás"},
  {key:"completed",label_en:"Completed",label_hu:"Lezárva"}
]);
const ACTIVE_STAGE_KEYS=new Set(WORKFLOW_STAGES.map(stage=>stage.key));
const NEXT_STAGE=Object.freeze({received:"in_progress",in_progress:"qa_review",qa_review:"admin_approval"});

function text(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function integerId(value){const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null;}
function money(value){const number=Number(value??0);return Number.isFinite(number)?Math.round((number+Number.EPSILON)*100)/100:NaN;}
function positiveDuration(value,fallback=120){const number=Number(value??fallback);return Number.isFinite(number)&&number>0?Math.round(number):fallback;}
function problem(code,status=400,extra=null){const error=new Error(code);error.status=status;error.extra=extra;return error;}
function respondError(res,error){res.status(Number(error?.status||400)).json({error:error?.message||"WORKFLOW_REQUEST_FAILED",...(error?.extra||{})});}
function iso(value,code="INVALID_SCHEDULE_TIME"){
  const raw=text(value,80);if(!raw)throw problem(code);
  const date=new Date(raw);if(Number.isNaN(date.getTime()))throw problem(code);
  return date.toISOString();
}
function isAdmin(user){return Boolean(user&&(user.role==="ADMIN"||user.role==="SUPERADMIN"||Number(user.is_superadmin||0)===1));}
function newYorkYear(){return new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric"}).format(new Date());}
function endAt(start,duration){return new Date(new Date(start).getTime()+positiveDuration(duration)*60000).toISOString();}

function registerRound2WorkflowRoutes({app,db,auth,permit,audit}){
  const staff=permit("ADMIN","MANAGER","WORKER");
  const admin=permit("ADMIN");
  const selectJob=`SELECT j.*,
    c.name AS client_name,c.email AS client_email,c.phone AS client_phone,c.address AS client_address,
    p.brand AS piano_brand,p.model AS piano_model,p.serial_number AS piano_serial_number,p.location_notes AS piano_location_notes,
    u.name AS assigned_technician_name,u.calendar_color AS assigned_technician_color,
    (SELECT COUNT(*) FROM job_handoffs h WHERE h.job_id=j.id) AS handoff_count
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
  function technician(id,{optional=true}={}){
    const value=text(id,160);
    if(!value&&optional)return null;
    const row=value&&db.prepare("SELECT id,name,role,status,calendar_color FROM users WHERE id=? AND status='Active' AND role IN ('WORKER','MANAGER','ADMIN')").get(value);
    if(!row)throw problem("INVALID_TECHNICIAN_ID");
    return row;
  }
  function activeForSchedule(job){return !job.cancelled_at&&job.stage!=="completed"&&job.stage!=="planned"&&job.scheduled_at;}
  function findConflict(jobId,technicianId,start,duration){
    if(!technicianId||!start)return null;
    const wantedStart=new Date(start).getTime(),wantedEnd=new Date(endAt(start,duration)).getTime();
    const rows=db.prepare(`${selectJob} WHERE j.id<>? AND j.assigned_technician_id=? AND j.cancelled_at IS NULL
      AND j.stage IN ('received','in_progress','qa_review','admin_approval') AND j.scheduled_at IS NOT NULL`).all(jobId||0,technicianId);
    return rows.find(row=>{
      const rowStart=new Date(row.scheduled_at).getTime(),rowEnd=new Date(endAt(row.scheduled_at,row.estimated_duration_min)).getTime();
      return rowStart<wantedEnd&&rowEnd>wantedStart;
    })||null;
  }
  function createJob(body,req,defaults={}){
    const clientId=integerId(body?.client_id??defaults.client_id),pianoId=integerId(body?.piano_id??defaults.piano_id);
    const {client}=requireClientPiano(clientId,pianoId);
    const intakeId=integerId(body?.intake_id??body?.intake_lead_id??defaults.intake_id);
    if(intakeId){
      const lead=db.prepare("SELECT * FROM intake_leads WHERE id=?").get(intakeId);
      if(!lead)throw problem("INTAKE_NOT_FOUND",404);
      if(lead.status!=="converted")throw problem("INTAKE_MUST_BE_CONVERTED",409);
      const existing=db.prepare("SELECT id FROM jobs WHERE intake_id=?").get(intakeId);
      if(existing)throw problem("INTAKE_JOB_ALREADY_EXISTS",409,{job_id:Number(existing.id)});
    }
    const title=text(body?.title??defaults.title,240);if(!title)throw problem("JOB_TITLE_REQUIRED");
    const locationType=text(body?.location_type??body?.service_location??defaults.location_type??"workshop",30);
    if(!["workshop","on_site"].includes(locationType))throw problem("INVALID_SERVICE_LOCATION");
    const assigned=technician(body?.assigned_technician_id??defaults.assigned_technician_id,{optional:true});
    const duration=positiveDuration(body?.estimated_duration_min??defaults.estimated_duration_min??120);
    const rawSchedule=text(body?.scheduled_at??defaults.scheduled_at,80);
    let scheduledAt=null,stage=PIPELINE_STAGE;
    if(rawSchedule){
      scheduledAt=iso(rawSchedule);
      if(!assigned)throw problem("TECHNICIAN_REQUIRED_FOR_SCHEDULE");
      const conflict=findConflict(0,assigned.id,scheduledAt,duration);
      if(conflict)throw problem("SCHEDULE_CONFLICT",409,{conflict});
      stage="received";
    }
    const siteAddress=text(body?.site_address??body?.service_address??defaults.site_address??(locationType==="on_site"?client.address:""),1200)||null;
    const info=db.prepare(`INSERT INTO jobs(
      job_code,client_id,piano_id,intake_id,title,description,location_type,site_address,scheduled_at,estimated_duration_min,stage,
      assigned_technician_id,total_labor_cost,total_material_cost,internal_notes,created_by_user_id,created_at,updated_at
    ) VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
      clientId,pianoId,intakeId,title,text(body?.description??defaults.description,10000)||null,locationType,siteAddress,scheduledAt,duration,stage,
      assigned?.id||null,text(body?.internal_notes??defaults.internal_notes,10000)||null,req.user.id
    );
    const id=Number(info.lastInsertRowid);
    db.prepare("UPDATE jobs SET job_code=? WHERE id=?").run(`KH-${newYorkYear()}-${String(id).padStart(5,"0")}`,id);
    const created=jobById(id);audit(req,"CREATE","jobs",String(id),null,created);return created;
  }

  function convertToJob(intakeId,body,req){
    const lead=db.prepare("SELECT * FROM intake_leads WHERE id=?").get(intakeId);
    if(!lead)throw problem("INTAKE_NOT_FOUND",404);
    const existing=db.prepare("SELECT id FROM jobs WHERE intake_id=?").get(intakeId);
    if(existing)return {idempotent:true,job:jobById(Number(existing.id))};
    let converted={lead,client:lead.client_id?db.prepare("SELECT * FROM clients WHERE id=?").get(lead.client_id):null,piano:lead.piano_id?db.prepare("SELECT * FROM pianos WHERE id=?").get(lead.piano_id):null};
    if(lead.status!=="converted"||!converted.client||!converted.piano){
      converted=convertIntakeLead(db,lead,body||{});
      audit(req,"CONVERT","intake",String(intakeId),lead,converted.lead);
    }
    const job=createJob({
      client_id:converted.client.id,piano_id:converted.piano.id,intake_id:intakeId,
      title:text(body?.title,240)||text(converted.lead.reported_issue,180)||"Service job",
      description:text(body?.description,10000)||converted.lead.reported_issue,
      location_type:converted.lead.service_location,
      site_address:body?.site_address||converted.client.address,
      assigned_technician_id:body?.assigned_technician_id||converted.lead.assigned_technician_id,
      estimated_duration_min:body?.estimated_duration_min||120
    },req);
    return {idempotent:false,job,client:converted.client,piano:converted.piano,lead:converted.lead};
  }

  app.get("/api/jobs",auth,staff,(req,res)=>{
    try{
      const q=text(req.query.q,180).toLowerCase(),like=`%${q}%`,includeCancelled=req.query.include_cancelled==="1"?1:0;
      const rows=db.prepare(`${selectJob} WHERE (?=1 OR j.cancelled_at IS NULL)
        AND (?='' OR lower(j.title) LIKE ? OR lower(COALESCE(j.description,'')) LIKE ? OR lower(c.name) LIKE ? OR lower(p.brand||' '||COALESCE(p.model,'')) LIKE ? OR lower(COALESCE(j.job_code,'')) LIKE ?)
        ORDER BY j.created_at DESC,j.id DESC`).all(includeCancelled,q,like,like,like,like,like);
      res.json(rows);
    }catch(error){respondError(res,error);}
  });

  app.get("/api/jobs/:id",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),row=id&&jobById(id);if(!row)return res.status(404).json({error:"JOB_NOT_FOUND"});
    res.json({...row,handoffs:db.prepare("SELECT * FROM job_handoffs WHERE job_id=? ORDER BY created_at,id").all(id)});
  });

  app.get("/api/clients/:id/jobs",auth,staff,(req,res)=>{
    const clientId=integerId(req.params.id);
    if(!clientId||!db.prepare("SELECT 1 FROM clients WHERE id=?").get(clientId))return res.status(404).json({error:"CLIENT_NOT_FOUND"});
    res.json(db.prepare(`${selectJob} WHERE j.client_id=? ORDER BY j.created_at DESC,j.id DESC`).all(clientId));
  });

  app.get("/api/jobs/pipeline",auth,staff,(_req,res)=>{
    res.json(db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage='planned' AND j.scheduled_at IS NULL ORDER BY j.created_at,j.id`).all());
  });
  app.get("/api/planned-jobs",auth,staff,(_req,res)=>{
    res.json(db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage='planned' AND j.scheduled_at IS NULL ORDER BY j.created_at,j.id`).all());
  });

  app.get("/api/jobs/workflow",auth,staff,(_req,res)=>{
    const jobs=db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage IN ('received','in_progress','qa_review','admin_approval','completed')
      ORDER BY CASE j.stage WHEN 'received' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'qa_review' THEN 2 WHEN 'admin_approval' THEN 3 ELSE 4 END,
      COALESCE(j.scheduled_at,j.updated_at),j.id`).all();
    res.json({stages:WORKFLOW_STAGES,columns:WORKFLOW_STAGES.map(stage=>({...stage,jobs:jobs.filter(job=>job.stage===stage.key)})),jobs});
  });
  app.get("/api/workshop",auth,staff,(_req,res)=>{
    const jobs=db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage IN ('received','in_progress','qa_review','admin_approval','completed')
      ORDER BY CASE j.stage WHEN 'received' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'qa_review' THEN 2 WHEN 'admin_approval' THEN 3 ELSE 4 END,
      COALESCE(j.scheduled_at,j.updated_at),j.id`).all();
    res.json({stages:WORKFLOW_STAGES,columns:WORKFLOW_STAGES.map(stage=>({...stage,key:stage.key,label:stage.label_en,jobs:jobs.filter(job=>job.stage===stage.key)})),jobs});
  });

  app.get("/api/calendar",auth,staff,(req,res)=>{
    try{
      const now=Date.now(),from=iso(req.query.from||new Date(now-86400000).toISOString(),"INVALID_CALENDAR_FROM"),to=iso(req.query.to||new Date(now+31*86400000).toISOString(),"INVALID_CALENDAR_TO");
      if(new Date(to).getTime()<=new Date(from).getTime())throw problem("INVALID_CALENDAR_RANGE");
      const technicianId=text(req.query.technician_id,160);
      const rows=db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage<>'planned' AND j.scheduled_at IS NOT NULL
        AND j.scheduled_at>=? AND j.scheduled_at<? AND (?='' OR j.assigned_technician_id=?)
        ORDER BY j.scheduled_at,j.id`).all(from,to,technicianId,technicianId)
        .map(row=>({...row,scheduled_end:endAt(row.scheduled_at,row.estimated_duration_min)}));
      res.json({from,to,timezone:"America/New_York",jobs:rows});
    }catch(error){respondError(res,error);}
  });

  app.post("/api/jobs",auth,staff,(req,res)=>{
    try{res.status(201).json(createJob(req.body||{},req));}catch(error){respondError(res,error);}
  });

  app.post("/api/intake/:id/convert-to-job",auth,staff,(req,res)=>{
    try{
      const id=integerId(req.params.id);if(!id)throw problem("INTAKE_NOT_FOUND",404);
      const result=db.transaction(()=>convertToJob(id,req.body||{},req))();
      res.status(result.idempotent?200:201).json({ok:true,...result});
    }catch(error){respondError(res,error);}
  });
  app.post("/api/intake/:id/create-job",auth,staff,(req,res)=>{
    try{
      const id=integerId(req.params.id);if(!id)throw problem("INTAKE_NOT_FOUND",404);
      const result=db.transaction(()=>convertToJob(id,req.body||{},req))();
      res.status(result.idempotent?200:201).json({ok:true,...result});
    }catch(error){respondError(res,error);}
  });

  app.post("/api/jobs/activate/:id",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&jobById(id);if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    if(before.cancelled_at)return res.status(409).json({error:"JOB_CANCELLED"});
    if(before.stage!=="planned")return res.status(409).json({error:"JOB_NOT_IN_PIPELINE"});
    try{
      const scheduledAt=iso(req.body?.scheduled_at),duration=positiveDuration(req.body?.estimated_duration_min??before.estimated_duration_min);
      const assigned=technician(req.body?.assigned_technician_id??before.assigned_technician_id,{optional:false});
      const conflict=findConflict(id,assigned.id,scheduledAt,duration);if(conflict)throw problem("SCHEDULE_CONFLICT",409,{conflict});
      db.prepare("UPDATE jobs SET scheduled_at=?,estimated_duration_min=?,assigned_technician_id=?,stage='received',updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(scheduledAt,duration,assigned.id,id);
      const after=jobById(id);audit(req,"ACTIVATE","jobs",String(id),before,after);res.json(after);
    }catch(error){respondError(res,error);}
  });

  app.patch("/api/jobs/:id/schedule",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&jobById(id);if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    if(before.cancelled_at)return res.status(409).json({error:"JOB_CANCELLED"});
    if(before.stage==="completed")return res.status(409).json({error:"JOB_ALREADY_COMPLETED"});
    try{
      const scheduledAt=iso(req.body?.scheduled_at),duration=positiveDuration(req.body?.estimated_duration_min??before.estimated_duration_min);
      const assigned=technician(req.body?.assigned_technician_id??before.assigned_technician_id,{optional:false});
      const conflict=findConflict(id,assigned.id,scheduledAt,duration);if(conflict)throw problem("SCHEDULE_CONFLICT",409,{conflict});
      const stage=before.stage==="planned"?"received":before.stage;
      db.prepare("UPDATE jobs SET scheduled_at=?,estimated_duration_min=?,assigned_technician_id=?,stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(scheduledAt,duration,assigned.id,stage,id);
      const after=jobById(id);audit(req,"SCHEDULE","jobs",String(id),before,after);res.json(after);
    }catch(error){respondError(res,error);}
  });

  app.put("/api/jobs/:id",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&jobById(id);if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    if(before.cancelled_at)return res.status(409).json({error:"JOB_CANCELLED"});
    if(before.stage==="completed")return res.status(409).json({error:"JOB_ALREADY_COMPLETED"});
    try{
      const title=text(req.body?.title??before.title,240);if(!title)throw problem("JOB_TITLE_REQUIRED");
      const location=text(req.body?.location_type??before.location_type,30);if(!["workshop","on_site"].includes(location))throw problem("INVALID_SERVICE_LOCATION");
      const assigned=technician(req.body?.assigned_technician_id??before.assigned_technician_id,{optional:true});
      db.prepare(`UPDATE jobs SET title=?,description=?,location_type=?,site_address=?,estimated_duration_min=?,assigned_technician_id=?,internal_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
        title,text(req.body?.description??before.description,10000)||null,location,text(req.body?.site_address??before.site_address,1200)||null,
        positiveDuration(req.body?.estimated_duration_min??before.estimated_duration_min),assigned?.id||null,text(req.body?.internal_notes??before.internal_notes,10000)||null,id
      );
      const after=jobById(id);audit(req,"UPDATE","jobs",String(id),before,after);res.json(after);
    }catch(error){respondError(res,error);}
  });

  app.get("/api/jobs/:id/handoffs",auth,staff,(req,res)=>{
    const id=integerId(req.params.id);if(!id||!db.prepare("SELECT 1 FROM jobs WHERE id=?").get(id))return res.status(404).json({error:"JOB_NOT_FOUND"});
    res.json(db.prepare("SELECT * FROM job_handoffs WHERE job_id=? ORDER BY created_at,id").all(id));
  });

  app.post("/api/jobs/:id/handoff",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&jobById(id);if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    if(before.cancelled_at)return res.status(409).json({error:"JOB_CANCELLED"});
    if(before.stage==="planned")return res.status(409).json({error:"JOB_MUST_BE_ACTIVATED"});
    if(before.stage==="completed")return res.status(409).json({error:"JOB_ALREADY_COMPLETED"});
    if(before.stage==="admin_approval")return res.status(409).json({error:"ADMIN_CLOSEOUT_REQUIRED"});
    if(req.user.role==="WORKER"&&before.assigned_technician_id&&String(before.assigned_technician_id)!==String(req.user.id))return res.status(403).json({error:"JOB_ASSIGNED_TO_ANOTHER_TECHNICIAN"});
    try{
      const toStage=NEXT_STAGE[before.stage];if(!toStage)throw problem("INVALID_HANDOFF_STAGE");
      const labor=money(req.body?.phase_labor_cost||0),material=money(req.body?.phase_material_cost||0);
      if(!(labor>=0)||!(material>=0))throw problem("INVALID_HANDOFF_COST");
      const fallbackAssignee=before.assigned_technician_id||req.user.id;
      const assigned=technician(req.body?.assigned_to_user_id||fallbackAssignee,{optional:false});
      const note=text(req.body?.phase_note,5000)||null;
      const result=db.transaction(()=>{
        const info=db.prepare(`INSERT INTO job_handoffs(job_id,from_stage,to_stage,performed_by_user_id,performed_by,assigned_to_user_id,assigned_to,phase_note,phase_labor_cost,phase_material_cost,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(id,before.stage,toStage,req.user.id,req.user.name,assigned.id,assigned.name,note,labor,material);
        db.prepare(`UPDATE jobs SET stage=?,assigned_technician_id=?,total_labor_cost=ROUND(total_labor_cost+?,2),total_material_cost=ROUND(total_material_cost+?,2),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(toStage,assigned.id,labor,material,id);
        return {handoff:db.prepare("SELECT * FROM job_handoffs WHERE id=?").get(Number(info.lastInsertRowid)),job:jobById(id)};
      })();
      audit(req,"HANDOFF","jobs",String(id),before,result.job);res.status(201).json(result);
    }catch(error){respondError(res,error);}
  });

  app.post("/api/jobs/:id/cancel",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),before=id&&jobById(id);if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    if(before.cancelled_at)return res.json({ok:true,idempotent:true,job:before});
    if(before.stage==="completed")return res.status(409).json({error:"JOB_ALREADY_COMPLETED"});
    const reason=text(req.body?.reason,5000),party=text(req.body?.party||"other",30);
    if(!reason)return res.status(400).json({error:"CANCEL_REASON_REQUIRED"});
    if(!["client","klavierhaus","other"].includes(party))return res.status(400).json({error:"INVALID_CANCEL_PARTY"});
    db.prepare(`UPDATE jobs SET cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,cancelled_by_name=?,cancelled_by_party=?,cancel_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(req.user.id,req.user.name,party,reason,id);
    const after=jobById(id);audit(req,"CANCEL","jobs",String(id),before,after);res.json({ok:true,idempotent:false,job:after});
  });
}

module.exports={registerRound2WorkflowRoutes,WORKFLOW_STAGES,PIPELINE_STAGE,ACTIVE_STAGE_KEYS};

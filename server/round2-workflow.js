"use strict";

const PIPELINE_STAGE="planned";
const WORKFLOW_STAGES=Object.freeze([
  {key:"received",label_en:"Received / Scheduled",label_hu:"Beérkezett / Ütemezve",position:1},
  {key:"in_progress",label_en:"In Progress",label_hu:"Folyamatban",position:2},
  {key:"qa_review",label_en:"QA / Handoff",label_hu:"Minőségellenőrzés / Átadás",position:3},
  {key:"admin_approval",label_en:"Admin Approval",label_hu:"Admin jóváhagyás",position:4},
  {key:"completed",label_en:"Completed",label_hu:"Lezárva",position:5}
]);
const ACTIVE_STAGE_KEYS=new Set(WORKFLOW_STAGES.map(stage=>stage.key));
const BLOCKER_CODES=new Set(["material_procurement","parts_procurement","material_issue","waiting_client","waiting_technician","waiting_admin","waiting_invoice","other"]);

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
function optionalIso(value,code="INVALID_WORKFLOW_DUE_AT"){
  if(value===null||value===undefined||String(value).trim()==="")return null;
  return iso(value,code);
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

  function stageDefinitions(){
    const rows=db.prepare("SELECT stage_key key,position,label_en,label_hu FROM workflow_stage_definitions ORDER BY position").all();
    return rows.length===WORKFLOW_STAGES.length?rows:WORKFLOW_STAGES.map(row=>({...row}));
  }
  function phasesForJob(jobId){
    const rows=db.prepare(`SELECT id,job_id,stage_key,position,enabled,due_at,blocker_code,blocker_note,activated_at,completed_at,created_at,updated_at
      FROM job_workflow_phases WHERE job_id=? ORDER BY position`).all(jobId);
    if(rows.length)return rows.map(row=>({...row,enabled:Boolean(row.enabled)}));
    return WORKFLOW_STAGES.map(row=>({job_id:jobId,stage_key:row.key,position:row.position,enabled:true,due_at:null,blocker_code:null,blocker_note:null,activated_at:null,completed_at:null}));
  }
  function nextEnabledPhase(jobId,currentStage){
    const phases=phasesForJob(jobId),current=phases.find(row=>row.stage_key===currentStage);
    if(!current)return null;
    return phases.find(row=>row.enabled&&row.position>current.position)||null;
  }
  function decorateJob(row){
    if(!row)return null;
    const workflow_phases=phasesForJob(row.id);
    const current_phase=workflow_phases.find(phase=>phase.stage_key===row.stage)||null;
    const next_phase=row.stage==="planned"||row.stage==="completed"?null:nextEnabledPhase(row.id,row.stage);
    return {...row,workflow_phases,current_phase,next_stage:next_phase?.stage_key||null,ready_for_closeout:Boolean(next_phase&&next_phase.stage_key==="completed")};
  }
  const jobById=id=>decorateJob(db.prepare(`${selectJob} WHERE j.id=?`).get(id));

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
  function normalizePlan(input){
    const supplied=Array.isArray(input)?input:null;
    const byKey=new Map((supplied||[]).map(item=>[String(item?.stage_key||item?.key||""),item]));
    const plan=WORKFLOW_STAGES.map(stage=>{
      const item=byKey.get(stage.key);
      const enabled=stage.key==="completed"?true:(supplied?Boolean(item?.enabled):true);
      return {stage_key:stage.key,position:stage.position,enabled,due_at:item?optionalIso(item.due_at):null};
    });
    if(!plan.some(row=>row.stage_key!=="completed"&&row.enabled))throw problem("WORKFLOW_REQUIRES_ACTIVE_PHASE");
    return plan;
  }
  function writePlan(jobId,plan,{preserveProgress=false}={}){
    const existing=new Map(phasesForJob(jobId).map(row=>[row.stage_key,row]));
    const upsert=db.prepare(`INSERT INTO job_workflow_phases(job_id,stage_key,position,enabled,due_at,activated_at,completed_at,updated_at)
      VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(job_id,stage_key) DO UPDATE SET position=excluded.position,enabled=excluded.enabled,due_at=excluded.due_at,
      activated_at=CASE WHEN ?=1 THEN job_workflow_phases.activated_at ELSE excluded.activated_at END,
      completed_at=CASE WHEN ?=1 THEN job_workflow_phases.completed_at ELSE excluded.completed_at END,
      updated_at=CURRENT_TIMESTAMP`);
    for(const row of plan){
      const old=existing.get(row.stage_key);
      upsert.run(jobId,row.stage_key,row.position,row.enabled?1:0,row.due_at,preserveProgress?old?.activated_at||null:null,preserveProgress?old?.completed_at||null:null,preserveProgress?1:0,preserveProgress?1:0);
    }
  }
  function firstEnabledStage(jobId){
    return phasesForJob(jobId).find(row=>row.enabled&&row.stage_key!=="completed")?.stage_key||null;
  }
  function activatePhase(jobId,stageKey){
    db.prepare("UPDATE job_workflow_phases SET activated_at=COALESCE(activated_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND stage_key=?").run(jobId,stageKey);
  }
  function completePhase(jobId,stageKey){
    db.prepare("UPDATE job_workflow_phases SET completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND stage_key=?").run(jobId,stageKey);
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
    const rawSchedule=text(body?.scheduled_at??defaults.scheduled_at,80),plan=normalizePlan(body?.workflow_phases??defaults.workflow_phases);
    let scheduledAt=null,stage=PIPELINE_STAGE;
    if(rawSchedule){
      scheduledAt=iso(rawSchedule);
      if(!assigned)throw problem("TECHNICIAN_REQUIRED_FOR_SCHEDULE");
      const conflict=findConflict(0,assigned.id,scheduledAt,duration);
      if(conflict)throw problem("SCHEDULE_CONFLICT",409,{conflict});
      stage=plan.find(row=>row.enabled&&row.stage_key!=="completed")?.stage_key||"received";
    }
    const siteAddress=text(body?.site_address??body?.service_address??defaults.site_address??(locationType==="on_site"?client.address:""),1200)||null;
    const info=db.prepare(`INSERT INTO jobs(
      job_code,client_id,piano_id,intake_id,title,description,location_type,site_address,scheduled_at,estimated_duration_min,stage,
      assigned_technician_id,total_labor_cost,total_material_cost,estimated_revenue,internal_notes,created_by_user_id,created_at,updated_at
    ) VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
      clientId,pianoId,intakeId,title,text(body?.description??defaults.description,10000)||null,locationType,siteAddress,scheduledAt,duration,stage,
      assigned?.id||null,Math.max(0,Number(body?.estimated_revenue??defaults.estimated_revenue??0)||0),text(body?.internal_notes??defaults.internal_notes,10000)||null,req.user.id
    );
    const id=Number(info.lastInsertRowid);
    db.prepare("UPDATE jobs SET job_code=? WHERE id=?").run(`KH-${newYorkYear()}-${String(id).padStart(5,"0")}`,id);
    writePlan(id,plan);
    if(stage!==PIPELINE_STAGE)activatePhase(id,stage);
    const created=jobById(id);audit(req,"CREATE","jobs",String(id),null,created);return created;
  }

  function convertToJob(intakeId,body,req){
    const lead=db.prepare("SELECT * FROM intake_leads WHERE id=?").get(intakeId);
    if(!lead)throw problem("INTAKE_NOT_FOUND",404);
    const existing=db.prepare("SELECT id FROM jobs WHERE intake_id=?").get(intakeId);
    if(existing)return {idempotent:true,job:jobById(Number(existing.id))};
    let converted={lead,client:lead.client_id?db.prepare("SELECT * FROM clients WHERE id=?").get(lead.client_id):null,piano:lead.piano_id?db.prepare("SELECT * FROM pianos WHERE id=?").get(lead.piano_id):null};
    if(lead.status!=="converted"||!converted.client||!converted.piano){
      const {convertIntakeLead}=require("./round1-core");
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
      estimated_duration_min:body?.estimated_duration_min||120,
      estimated_revenue:body?.estimated_revenue??converted.lead.estimated_total??0,
      workflow_phases:body?.workflow_phases,
      scheduled_at:body?.scheduled_at,
      site_address:body?.site_address||converted.client.address
    },req);
    return {idempotent:false,job,client:converted.client,piano:converted.piano,lead:converted.lead};
  }

  app.get("/api/workflow/settings",auth,staff,(_req,res)=>res.json({stages:stageDefinitions(),blocker_codes:[...BLOCKER_CODES]}));
  app.put("/api/workflow/settings",auth,admin,(req,res)=>{
    try{
      const updates=Array.isArray(req.body?.stages)?req.body.stages:[];
      const before=stageDefinitions(),byKey=new Map(updates.map(row=>[String(row?.key||row?.stage_key||""),row]));
      const update=db.prepare("UPDATE workflow_stage_definitions SET label_en=?,label_hu=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE stage_key=?");
      for(const stage of before){
        const incoming=byKey.get(stage.key);if(!incoming)continue;
        const labelEn=text(incoming.label_en,80),labelHu=text(incoming.label_hu,80);
        if(!labelEn||!labelHu)throw problem("WORKFLOW_LABEL_REQUIRED");
        update.run(labelEn,labelHu,req.user.id,stage.key);
      }
      const after=stageDefinitions();audit(req,"UPDATE","workflow_settings","stages",before,after);res.json({stages:after});
    }catch(error){respondError(res,error);}
  });

  app.get("/api/jobs",auth,staff,(req,res)=>{
    try{
      const q=text(req.query.q,180).toLowerCase(),like=`%${q}%`,includeCancelled=req.query.include_cancelled==="1"?1:0;
      const rows=db.prepare(`${selectJob} WHERE (?=1 OR j.cancelled_at IS NULL)
        AND (?='' OR lower(j.title) LIKE ? OR lower(COALESCE(j.description,'')) LIKE ? OR lower(c.name) LIKE ? OR lower(p.brand||' '||COALESCE(p.model,'')) LIKE ? OR lower(COALESCE(j.job_code,'')) LIKE ?)
        ORDER BY j.created_at DESC,j.id DESC`).all(includeCancelled,q,like,like,like,like,like).map(decorateJob);
      res.json(rows);
    }catch(error){respondError(res,error);}
  });

  app.get("/api/jobs/:id(\\d+)",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),row=id&&jobById(id);if(!row)return res.status(404).json({error:"JOB_NOT_FOUND"});
    res.json({...row,handoffs:db.prepare("SELECT * FROM job_handoffs WHERE job_id=? ORDER BY created_at,id").all(id)});
  });

  app.get("/api/clients/:id/jobs",auth,staff,(req,res)=>{
    const clientId=integerId(req.params.id);
    if(!clientId||!db.prepare("SELECT 1 FROM clients WHERE id=?").get(clientId))return res.status(404).json({error:"CLIENT_NOT_FOUND"});
    res.json(db.prepare(`${selectJob} WHERE j.client_id=? ORDER BY j.created_at DESC,j.id DESC`).all(clientId).map(decorateJob));
  });

  app.get("/api/jobs/pipeline",auth,staff,(_req,res)=>{
    res.json(db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage='planned' AND j.scheduled_at IS NULL ORDER BY j.created_at,j.id`).all().map(decorateJob));
  });
  app.get("/api/planned-jobs",auth,staff,(_req,res)=>{
    res.json(db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage='planned' AND j.scheduled_at IS NULL ORDER BY j.created_at,j.id`).all().map(decorateJob));
  });

  app.get("/api/jobs/workflow",auth,staff,(req,res)=>{
    const bucket=String(req.query.bucket||"active").toLowerCase();
    if(!["active","closed"].includes(bucket))return res.status(400).json({error:"INVALID_WORKFLOW_BUCKET"});
    const stageSql=bucket==="closed"?"j.stage='completed'":"j.stage IN ('received','in_progress','qa_review','admin_approval')";
    const jobs=db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND ${stageSql}
      ORDER BY CASE j.stage WHEN 'received' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'qa_review' THEN 2 WHEN 'admin_approval' THEN 3 ELSE 4 END,
      COALESCE(j.completed_at,j.scheduled_at,j.updated_at) DESC,j.id DESC`).all().map(decorateJob);
    const allStages=stageDefinitions(),visibleStages=bucket==="closed"?allStages.filter(stage=>stage.key==="completed"):allStages.filter(stage=>stage.key!=="completed");
    res.json({bucket,stages:allStages,columns:visibleStages.map(stage=>({...stage,jobs:jobs.filter(job=>job.stage===stage.key)})),jobs});
  });
  app.get("/api/workshop",auth,staff,(_req,res)=>{
    const jobs=db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage IN ('received','in_progress','qa_review','admin_approval','completed')
      ORDER BY CASE j.stage WHEN 'received' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'qa_review' THEN 2 WHEN 'admin_approval' THEN 3 ELSE 4 END,
      COALESCE(j.scheduled_at,j.updated_at),j.id`).all().map(decorateJob);
    const stages=stageDefinitions();
    res.json({stages,columns:stages.map(stage=>({...stage,label:stage.label_en,jobs:jobs.filter(job=>job.stage===stage.key)})),jobs});
  });

  app.get("/api/workshop/overview",auth,staff,(_req,res)=>{
    const all=db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL ORDER BY COALESCE(j.scheduled_at,j.updated_at),j.id`).all().map(decorateJob);
    const active=all.filter(job=>job.stage!=="planned"&&job.stage!=="completed");
    const now=Date.now();
    const overdue=active.filter(job=>job.current_phase?.due_at&&new Date(job.current_phase.due_at).getTime()<now);
    const invoiceRows=db.prepare("SELECT id,job_id,invoice_number,status,total_amount,due_date FROM invoices WHERE deleted_at IS NULL AND direction='receivable' AND job_id IS NOT NULL AND status IN ('draft','sent') ORDER BY id DESC").all();
    const invoiceByJob=new Map();for(const row of invoiceRows)if(!invoiceByJob.has(Number(row.job_id)))invoiceByJob.set(Number(row.job_id),row);
    const openInvoice=all.filter(job=>job.ready_for_closeout||invoiceByJob.has(Number(job.id))).map(job=>({...job,invoice:invoiceByJob.get(Number(job.id))||null,invoice_issue:job.ready_for_closeout&&!invoiceByJob.has(Number(job.id))?"awaiting_closeout":invoiceByJob.get(Number(job.id))?.status==="draft"?"invoice_draft":"invoice_sent"}));
    const activeFinancial=active.map(job=>({...job,financial_total:money(Number(job.total_labor_cost||0)+Number(job.total_material_cost||0))}));
    res.json({
      kpis:{
        active_workflows:active.length,
        overdue_workflows:overdue.length,
        active_financial_total:money(activeFinancial.reduce((sum,row)=>sum+row.financial_total,0)),
        open_invoice_actions:openInvoice.length
      },
      details:{active_workflows:active,overdue_workflows:overdue,active_financial:activeFinancial,open_invoice_actions:openInvoice}
    });
  });

  app.get("/api/calendar",auth,staff,(req,res)=>{
    try{
      const now=Date.now(),from=iso(req.query.from||new Date(now-86400000).toISOString(),"INVALID_CALENDAR_FROM"),to=iso(req.query.to||new Date(now+31*86400000).toISOString(),"INVALID_CALENDAR_TO");
      if(new Date(to).getTime()<=new Date(from).getTime())throw problem("INVALID_CALENDAR_RANGE");
      const technicianId=text(req.query.technician_id,160);
      const rows=db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage<>'planned' AND j.scheduled_at IS NOT NULL
        AND j.scheduled_at<? AND datetime(j.scheduled_at,'+'||j.estimated_duration_min||' minutes')>datetime(?)
        AND (?='' OR j.assigned_technician_id=?)
        ORDER BY j.scheduled_at,j.id`).all(to,from,technicianId,technicianId)
        .map(row=>decorateJob({...row,scheduled_end:endAt(row.scheduled_at,row.estimated_duration_min)}));
      res.json({from,to,timezone:"America/New_York",jobs:rows});
    }catch(error){respondError(res,error);}
  });

  app.post("/api/jobs",auth,staff,(req,res)=>{
    try{res.status(201).json(db.transaction(()=>createJob(req.body||{},req))());}catch(error){respondError(res,error);}
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

  app.get("/api/jobs/:id/workflow-phases",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),job=id&&jobById(id);if(!job)return res.status(404).json({error:"JOB_NOT_FOUND"});
    res.json({job_id:id,current_stage:job.stage,ready_for_closeout:job.ready_for_closeout,phases:job.workflow_phases,definitions:stageDefinitions()});
  });
  app.put("/api/jobs/:id/workflow-phases",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),before=id&&jobById(id);if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    if(before.cancelled_at||before.stage==="completed")return res.status(409).json({error:before.cancelled_at?"JOB_CANCELLED":"JOB_ALREADY_COMPLETED"});
    try{
      const incoming=normalizePlan(req.body?.phases),currentPhase=before.stage==="planned"?null:before.workflow_phases.find(row=>row.stage_key===before.stage);
      const oldByKey=new Map(before.workflow_phases.map(row=>[row.stage_key,row]));
      const safe=incoming.map(row=>{
        const old=oldByKey.get(row.stage_key);
        if(currentPhase&&row.position<=currentPhase.position)return {...row,enabled:Boolean(old?.enabled),due_at:row.due_at??old?.due_at??null};
        return row;
      });
      if(currentPhase&&!safe.find(row=>row.stage_key===before.stage)?.enabled)throw problem("CURRENT_WORKFLOW_PHASE_REQUIRED",409);
      writePlan(id,safe,{preserveProgress:true});
      const after=jobById(id);audit(req,"UPDATE_WORKFLOW_PLAN","jobs",String(id),before,after);res.json(after);
    }catch(error){respondError(res,error);}
  });
  app.patch("/api/jobs/:id/workflow-phases/:stage",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),stage=text(req.params.stage,40),before=id&&jobById(id);if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    if(!ACTIVE_STAGE_KEYS.has(stage))return res.status(400).json({error:"INVALID_WORKFLOW_STAGE"});
    const phase=before.workflow_phases.find(row=>row.stage_key===stage);if(!phase)return res.status(404).json({error:"WORKFLOW_PHASE_NOT_FOUND"});
    if(req.user.role==="WORKER"&&stage!==before.stage)return res.status(403).json({error:"PERMISSION_DENIED"});
    try{
      const dueAt=req.body?.due_at===undefined?phase.due_at:optionalIso(req.body.due_at);
      let blockerCode=req.body?.blocker_code===undefined?phase.blocker_code:text(req.body.blocker_code,50)||null;
      const blockerNote=req.body?.blocker_note===undefined?phase.blocker_note:text(req.body.blocker_note,2000)||null;
      if(blockerCode&&!BLOCKER_CODES.has(blockerCode))throw problem("INVALID_BLOCKER_CODE");
      db.prepare("UPDATE job_workflow_phases SET due_at=?,blocker_code=?,blocker_note=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND stage_key=?")
        .run(dueAt,blockerCode,blockerNote,id,stage);
      const after=jobById(id);audit(req,"UPDATE_PHASE_STATUS","jobs",String(id),before,after);res.json(after);
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
      const stage=firstEnabledStage(id);if(!stage)throw problem("WORKFLOW_REQUIRES_ACTIVE_PHASE");
      db.prepare("UPDATE jobs SET scheduled_at=?,estimated_duration_min=?,assigned_technician_id=?,stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(scheduledAt,duration,assigned.id,stage,id);
      activatePhase(id,stage);
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
      const stage=before.stage==="planned"?firstEnabledStage(id):before.stage;
      if(!stage)throw problem("WORKFLOW_REQUIRES_ACTIVE_PHASE");
      db.prepare("UPDATE jobs SET scheduled_at=?,estimated_duration_min=?,assigned_technician_id=?,stage=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(scheduledAt,duration,assigned.id,stage,id);
      if(before.stage==="planned")activatePhase(id,stage);
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
    if(before.ready_for_closeout)return res.status(409).json({error:"ADMIN_CLOSEOUT_REQUIRED"});
    if(req.user.role==="WORKER"&&before.assigned_technician_id&&String(before.assigned_technician_id)!==String(req.user.id))return res.status(403).json({error:"JOB_ASSIGNED_TO_ANOTHER_TECHNICIAN"});
    try{
      const next=nextEnabledPhase(id,before.stage),toStage=next?.stage_key;if(!toStage)throw problem("INVALID_HANDOFF_STAGE");
      if(toStage==="completed")throw problem("ADMIN_CLOSEOUT_REQUIRED",409);
      const labor=money(req.body?.phase_labor_cost||0),material=money(req.body?.phase_material_cost||0);
      if(!(labor>=0)||!(material>=0))throw problem("INVALID_HANDOFF_COST");
      const fallbackAssignee=before.assigned_technician_id||req.user.id;
      const assigned=technician(req.body?.assigned_to_user_id||fallbackAssignee,{optional:false});
      const note=text(req.body?.phase_note,5000)||null;
      const result=db.transaction(()=>{
        const info=db.prepare(`INSERT INTO job_handoffs(job_id,from_stage,to_stage,performed_by_user_id,performed_by,assigned_to_user_id,assigned_to,phase_note,phase_labor_cost,phase_material_cost,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(id,before.stage,toStage,req.user.id,req.user.name,assigned.id,assigned.name,note,labor,material);
        completePhase(id,before.stage);activatePhase(id,toStage);
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

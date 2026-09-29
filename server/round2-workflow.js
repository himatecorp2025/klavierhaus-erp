"use strict";

const PIPELINE_STAGE="planned";
const WORKFLOW_STAGES=Object.freeze([
  {key:"received",label_en:"Received / Scheduled",label_hu:"Beérkezett / Ütemezve",position:1,stage_type:"start",active:1,removable:0},
  {key:"in_progress",label_en:"In Progress",label_hu:"Folyamatban",position:2,stage_type:"intermediate",active:1,removable:0},
  {key:"qa_review",label_en:"QA / Handoff",label_hu:"Minőségellenőrzés / Átadás",position:3,stage_type:"intermediate",active:1,removable:0},
  {key:"admin_approval",label_en:"Admin Approval",label_hu:"Admin jóváhagyás",position:4,stage_type:"approval",active:1,removable:0},
  {key:"completed",label_en:"Completed",label_hu:"Lezárva",position:5,stage_type:"completed",active:1,removable:0}
]);
const ACTIVE_STAGE_KEYS=new Set(WORKFLOW_STAGES.map(stage=>stage.key));
const MAX_WORKFLOW_STAGES=7;
const FIXED_STAGE_KEYS=new Set(["received","admin_approval","completed"]);
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
    owner.name AS workflow_owner_name,
    (SELECT COUNT(*) FROM job_handoffs h WHERE h.job_id=j.id) AS handoff_count
    FROM jobs j
    JOIN clients c ON c.id=j.client_id
    JOIN pianos p ON p.id=j.piano_id
    LEFT JOIN users u ON u.id=j.assigned_technician_id
    LEFT JOIN users owner ON owner.id=j.workflow_owner_user_id`;

  function stageDefinitions({includeInactive=false}={}){
    const rows=db.prepare(`SELECT stage_key key,position,label_en,label_hu,stage_type,active,removable,created_at,updated_at
      FROM workflow_stage_definitions ${includeInactive?"":"WHERE active=1"} ORDER BY position,created_at,stage_key`).all();
    return rows.length?rows.map(row=>({...row,active:Boolean(row.active),removable:Boolean(row.removable)})):WORKFLOW_STAGES.map(row=>({...row,active:true,removable:false}));
  }
  function stageByKey(key,{includeInactive=false}={}){
    return stageDefinitions({includeInactive}).find(stage=>stage.key===key)||null;
  }
  function logicalStage(row){return row?.workflow_stage_key||row?.stage||PIPELINE_STAGE;}
  function storageStage(stageKey){
    if(["planned","received","in_progress","qa_review","admin_approval","completed"].includes(stageKey))return stageKey;
    return "in_progress";
  }
  function phasesForJob(jobId){
    const rows=db.prepare(`SELECT p.id,p.job_id,p.stage_key,p.position,p.enabled,p.starts_at,p.due_at,p.responsible_user_id,
      ru.name AS responsible_name,p.blocker_code,p.blocker_note,p.activated_at,p.completed_at,p.created_at,p.updated_at
      FROM job_workflow_phases p LEFT JOIN users ru ON ru.id=p.responsible_user_id
      WHERE p.job_id=? ORDER BY p.position,p.id`).all(jobId);
    if(rows.length)return rows.map(row=>({...row,enabled:Boolean(row.enabled)}));
    return stageDefinitions().map(row=>({job_id:jobId,stage_key:row.key,position:row.position,enabled:true,starts_at:null,due_at:null,responsible_user_id:null,responsible_name:null,blocker_code:null,blocker_note:null,activated_at:null,completed_at:null}));
  }
  function phaseVisualStatus(job,phase,now=Date.now()){
    if(job?.cancelled_at)return "cancelled";
    if(job?.stage==="completed"||phase?.completed_at)return "completed";
    if(phase?.blocker_code)return "blocked";
    const due=phase?.due_at?new Date(phase.due_at).getTime():NaN;
    if(Number.isFinite(due)&&due<now)return "overdue";
    const plannedStart=phase?.starts_at||(phase?.stage_key==="received"?job?.scheduled_at:null)||phase?.activated_at;
    const start=plannedStart?new Date(plannedStart).getTime():NaN;
    if(Number.isFinite(start)&&start>now)return "scheduled";
    return "in_progress";
  }
  function pendingWorkingPhases(jobId,currentStage){
    return phasesForJob(jobId).filter(row=>row.enabled&&!row.completed_at&&row.stage_key!==currentStage&&row.stage_key!=="completed"&&row.stage_key!=="admin_approval");
  }
  function nextEnabledPhase(jobId,currentStage){
    const phases=phasesForJob(jobId),current=phases.find(row=>row.stage_key===currentStage);
    if(!current)return null;
    const pending=pendingWorkingPhases(jobId,currentStage);
    if(pending.length)return pending.sort((a,b)=>a.position-b.position)[0];
    const approval=phases.find(row=>row.enabled&&row.stage_key==="admin_approval"&&!row.completed_at);
    if(approval&&currentStage!=="admin_approval")return approval;
    return phases.find(row=>row.enabled&&row.stage_key==="completed")||null;
  }
  function readyForCloseout(jobId,currentStage){
    if(currentStage!=="admin_approval")return false;
    return !phasesForJob(jobId).some(row=>row.enabled&&!row.completed_at&&!["admin_approval","completed"].includes(row.stage_key));
  }
  function decorateJob(row){
    if(!row)return null;
    const stage=logicalStage(row),workflow_phases=phasesForJob(row.id);
    const current_phase=workflow_phases.find(phase=>phase.stage_key===stage)||null;
    const next_phase=stage==="planned"||stage==="completed"?null:nextEnabledPhase(row.id,stage);
    const phasesWithStatus=workflow_phases.map(phase=>({...phase,visual_status:phaseVisualStatus({...row,stage},phase)}));
    const activePhase=phasesWithStatus.find(phase=>phase.stage_key===stage)||null;
    return {...row,storage_stage:row.stage,stage,workflow_phases:phasesWithStatus,current_phase:activePhase,next_stage:next_phase?.stage_key||null,
      workflow_status:stage==="planned"?"planned":phaseVisualStatus({...row,stage},activePhase),ready_for_closeout:readyForCloseout(row.id,stage)};
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
  function responsibleUser(id,{optional=true}={}){
    const value=text(id,160);
    if(!value&&optional)return null;
    const row=value&&db.prepare("SELECT id,name,role,status,calendar_color FROM users WHERE id=? AND status='Active' AND role IN ('WORKER','MANAGER','ADMIN','SUPERADMIN')").get(value);
    if(!row)throw problem("INVALID_RESPONSIBLE_USER_ID");
    return row;
  }
  function findConflict(jobId,technicianId,start,duration){
    if(!technicianId||!start)return null;
    const wantedStart=new Date(start).getTime(),wantedEnd=new Date(endAt(start,duration)).getTime();
    const rows=db.prepare(`${selectJob} WHERE j.id<>? AND j.assigned_technician_id=? AND j.cancelled_at IS NULL
      AND j.stage NOT IN ('planned','completed') AND j.scheduled_at IS NOT NULL`).all(jobId||0,technicianId);
    return rows.find(row=>{
      const rowStart=new Date(row.scheduled_at).getTime(),rowEnd=new Date(endAt(row.scheduled_at,row.estimated_duration_min)).getTime();
      return rowStart<wantedEnd&&rowEnd>wantedStart;
    })||null;
  }
  function normalizePlan(input,{defaultResponsibleId=null,defaultStartAt=null}={}){
    const supplied=Array.isArray(input)?input:null;
    const byKey=new Map((supplied||[]).map(item=>[String(item?.stage_key||item?.key||""),item]));
    const plan=stageDefinitions().map(stage=>{
      const item=byKey.get(stage.key),mandatory=FIXED_STAGE_KEYS.has(stage.key),enabled=mandatory?true:(supplied?Boolean(item?.enabled):true);
      const responsibleId=text(item?.responsible_user_id||defaultResponsibleId,160)||null;
      if(responsibleId)responsibleUser(responsibleId,{optional:false});
      return {stage_key:stage.key,position:stage.position,enabled,
        starts_at:item?.starts_at?optionalIso(item.starts_at):(stage.key==="received"&&defaultStartAt?optionalIso(defaultStartAt):null),
        due_at:item?.due_at?optionalIso(item.due_at):null,responsible_user_id:responsibleId};
    });
    for(const key of ["received","admin_approval","completed"])if(!plan.find(row=>row.stage_key===key)?.enabled)throw problem("WORKFLOW_FIXED_STAGE_REQUIRED");
    return plan;
  }
  function writePlan(jobId,plan,{preserveProgress=false}={}){
    const existing=new Map(phasesForJob(jobId).map(row=>[row.stage_key,row]));
    const upsert=db.prepare(`INSERT INTO job_workflow_phases(job_id,stage_key,position,enabled,starts_at,due_at,responsible_user_id,activated_at,completed_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(job_id,stage_key) DO UPDATE SET position=excluded.position,enabled=excluded.enabled,starts_at=excluded.starts_at,due_at=excluded.due_at,responsible_user_id=excluded.responsible_user_id,
      activated_at=CASE WHEN ?=1 THEN job_workflow_phases.activated_at ELSE excluded.activated_at END,
      completed_at=CASE WHEN ?=1 THEN job_workflow_phases.completed_at ELSE excluded.completed_at END,
      updated_at=CURRENT_TIMESTAMP`);
    for(const row of plan){
      const old=existing.get(row.stage_key);
      upsert.run(jobId,row.stage_key,row.position,row.enabled?1:0,row.starts_at,row.due_at,row.responsible_user_id,
        preserveProgress?old?.activated_at||null:null,preserveProgress?old?.completed_at||null:null,preserveProgress?1:0,preserveProgress?1:0);
    }
  }
  function firstEnabledStage(jobId){
    return phasesForJob(jobId).find(row=>row.enabled&&row.stage_key==="received")?.stage_key||null;
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
    const owner=responsibleUser(body?.workflow_owner_user_id??defaults.workflow_owner_user_id??req.user.id,{optional:false});
    const duration=positiveDuration(body?.estimated_duration_min??defaults.estimated_duration_min??120);
    const rawSchedule=text(body?.scheduled_at??defaults.scheduled_at,80);
    let scheduledAt=null,stage=PIPELINE_STAGE;
    if(rawSchedule){
      scheduledAt=iso(rawSchedule);
      if(!assigned)throw problem("TECHNICIAN_REQUIRED_FOR_SCHEDULE");
      const conflict=findConflict(0,assigned.id,scheduledAt,duration);
      if(conflict)throw problem("SCHEDULE_CONFLICT",409,{conflict});
    }
    const plan=normalizePlan(body?.workflow_phases??defaults.workflow_phases,{defaultResponsibleId:req.user.id,defaultStartAt:scheduledAt});
    if(scheduledAt)stage=plan.find(row=>row.enabled&&row.stage_key!=="completed")?.stage_key||"received";
    const siteAddress=text(body?.site_address??body?.service_address??defaults.site_address??(locationType==="on_site"?client.address:""),1200)||null;
    const info=db.prepare(`INSERT INTO jobs(
      job_code,client_id,piano_id,intake_id,title,description,location_type,site_address,scheduled_at,estimated_duration_min,stage,workflow_stage_key,workflow_owner_user_id,
      assigned_technician_id,total_labor_cost,total_material_cost,estimated_revenue,internal_notes,created_by_user_id,created_at,updated_at
    ) VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
      clientId,pianoId,intakeId,title,text(body?.description??defaults.description,10000)||null,locationType,siteAddress,scheduledAt,duration,storageStage(stage),stage===PIPELINE_STAGE?null:stage,owner.id,
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
      workflow_owner_user_id:body?.workflow_owner_user_id||req.user.id,
      estimated_duration_min:body?.estimated_duration_min||120,
      estimated_revenue:body?.estimated_revenue??converted.lead.estimated_total??0,
      workflow_phases:body?.workflow_phases,
      scheduled_at:body?.scheduled_at,
      site_address:body?.site_address||converted.client.address
    },req);
    return {idempotent:false,job,client:converted.client,piano:converted.piano,lead:converted.lead};
  }

  function workflowSettingsPayload(){
    const stages=stageDefinitions();
    return {stages,blocker_codes:[...BLOCKER_CODES],max_stages:MAX_WORKFLOW_STAGES,can_add_stage:stages.length<MAX_WORKFLOW_STAGES};
  }
  function stageKeyFromLabels(labelEn,labelHu){
    const base=(labelEn||labelHu||"phase").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,28)||"phase";
    let key=`custom_${base}`,suffix=2;
    while(db.prepare("SELECT 1 FROM workflow_stage_definitions WHERE stage_key=?").get(key)){key=`custom_${base}_${suffix}`;suffix+=1;}
    return key;
  }
  function applyStageOrder(orderedKeys,userId){
    const defs=stageDefinitions(),byKey=new Map(defs.map(stage=>[stage.key,stage]));
    if(orderedKeys.length!==defs.length||orderedKeys.some(key=>!byKey.has(key)))throw problem("INVALID_WORKFLOW_STAGE_ORDER");
    if(orderedKeys[0]!=="received"||orderedKeys.at(-2)!=="admin_approval"||orderedKeys.at(-1)!=="completed")throw problem("WORKFLOW_FIXED_STAGE_ORDER",409);
    const updateDef=db.prepare("UPDATE workflow_stage_definitions SET position=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE stage_key=? AND active=1");
    const updatePhase=db.prepare(`UPDATE job_workflow_phases SET position=?,updated_at=CURRENT_TIMESTAMP WHERE stage_key=? AND job_id IN
      (SELECT id FROM jobs WHERE cancelled_at IS NULL AND stage<>'completed')`);
    orderedKeys.forEach((key,index)=>{updateDef.run(index+1,userId,key);updatePhase.run(index+1,key);});
  }
  app.get("/api/workflow/settings",auth,staff,(_req,res)=>res.json(workflowSettingsPayload()));
  app.put("/api/workflow/settings",auth,admin,(req,res)=>{
    try{
      const updates=Array.isArray(req.body?.stages)?req.body.stages:[];
      const before=stageDefinitions(),byKey=new Map(updates.map(row=>[String(row?.key||row?.stage_key||""),row]));
      const update=db.prepare("UPDATE workflow_stage_definitions SET label_en=?,label_hu=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE stage_key=? AND active=1");
      for(const stage of before){
        const incoming=byKey.get(stage.key);if(!incoming)continue;
        const labelEn=text(incoming.label_en,80),labelHu=text(incoming.label_hu,80);
        if(!labelEn||!labelHu)throw problem("WORKFLOW_LABEL_REQUIRED");
        update.run(labelEn,labelHu,req.user.id,stage.key);
      }
      const after=stageDefinitions();audit(req,"UPDATE","workflow_settings","stages",before,after);res.json(workflowSettingsPayload());
    }catch(error){respondError(res,error);}
  });
  app.post("/api/workflow/stages",auth,admin,(req,res)=>{
    try{
      const before=stageDefinitions();if(before.length>=MAX_WORKFLOW_STAGES)throw problem("WORKFLOW_STAGE_LIMIT_REACHED",409,{max_stages:MAX_WORKFLOW_STAGES});
      const labelEn=text(req.body?.label_en,80),labelHu=text(req.body?.label_hu,80);if(!labelEn||!labelHu)throw problem("WORKFLOW_LABEL_REQUIRED");
      const key=stageKeyFromLabels(labelEn,labelHu),adminIndex=before.findIndex(stage=>stage.key==="admin_approval");
      const position=adminIndex>=0?adminIndex+1:Math.max(2,before.length-1);
      db.transaction(()=>{
        db.prepare(`INSERT INTO workflow_stage_definitions(stage_key,position,label_en,label_hu,stage_type,active,removable,updated_by_user_id,updated_at)
          VALUES(?,?,?,?,'intermediate',1,1,?,CURRENT_TIMESTAMP)`).run(key,position,labelEn,labelHu,req.user.id);
        const order=stageDefinitions().filter(stage=>stage.key!==key).map(stage=>stage.key);
        order.splice(order.indexOf("admin_approval"),0,key);applyStageOrder(order,req.user.id);
        const stage=stageDefinitions().find(row=>row.key===key);
        const insert=db.prepare(`INSERT OR IGNORE INTO job_workflow_phases(job_id,stage_key,position,enabled,responsible_user_id,created_at,updated_at)
          SELECT id,?,?,1,COALESCE(created_by_user_id,workflow_owner_user_id),CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM jobs WHERE cancelled_at IS NULL AND stage<>'completed'`);
        insert.run(key,stage.position);
      })();
      const after=stageDefinitions();audit(req,"CREATE","workflow_stage_definitions",key,null,after.find(row=>row.key===key));res.status(201).json(workflowSettingsPayload());
    }catch(error){respondError(res,error);}
  });
  app.delete("/api/workflow/stages/:key",auth,admin,(req,res)=>{
    try{
      const key=text(req.params.key,80),stage=stageByKey(key);if(!stage)return res.status(404).json({error:"WORKFLOW_STAGE_NOT_FOUND"});
      if(!stage.removable||FIXED_STAGE_KEYS.has(key))throw problem("WORKFLOW_STAGE_NOT_REMOVABLE",409);
      const inUse=db.prepare("SELECT id FROM jobs WHERE cancelled_at IS NULL AND stage<>'completed' AND COALESCE(workflow_stage_key,stage)=? LIMIT 1").get(key);
      if(inUse)throw problem("WORKFLOW_STAGE_IN_USE",409,{job_id:Number(inUse.id)});
      const before=stageDefinitions();
      db.transaction(()=>{
        db.prepare("UPDATE workflow_stage_definitions SET active=0,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE stage_key=?").run(req.user.id,key);
        db.prepare(`UPDATE job_workflow_phases SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE stage_key=? AND job_id IN
          (SELECT id FROM jobs WHERE cancelled_at IS NULL AND stage<>'completed')`).run(key);
        applyStageOrder(stageDefinitions().map(row=>row.key),req.user.id);
      })();
      audit(req,"ARCHIVE","workflow_stage_definitions",key,stage,null);res.json(workflowSettingsPayload());
    }catch(error){respondError(res,error);}
  });
  app.put("/api/workflow/stages/order",auth,admin,(req,res)=>{
    try{
      const middle=Array.isArray(req.body?.stage_keys)?req.body.stage_keys.map(value=>text(value,80)).filter(Boolean):[];
      const defs=stageDefinitions(),expected=defs.filter(stage=>!FIXED_STAGE_KEYS.has(stage.key)).map(stage=>stage.key);
      if(middle.length!==expected.length||new Set(middle).size!==middle.length||middle.some(key=>!expected.includes(key)))throw problem("INVALID_WORKFLOW_STAGE_ORDER");
      const before=defs;db.transaction(()=>applyStageOrder(["received",...middle,"admin_approval","completed"],req.user.id))();
      const after=stageDefinitions();audit(req,"REORDER","workflow_stage_definitions","active",before,after);res.json(workflowSettingsPayload());
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
  app.get("/api/jobs/:id/history",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),job=id&&jobById(id);if(!job)return res.status(404).json({error:"JOB_NOT_FOUND"});
    const labels=new Map(stageDefinitions({includeInactive:true}).map(stage=>[stage.key,stage]));
    const phases=job.workflow_phases.map(phase=>({...phase,label_en:labels.get(phase.stage_key)?.label_en||phase.stage_key,label_hu:labels.get(phase.stage_key)?.label_hu||phase.stage_key}));
    const handoffs=db.prepare("SELECT * FROM job_handoffs WHERE job_id=? ORDER BY created_at,id").all(id);
    const invoices=db.prepare(`SELECT id,invoice_number,status,total_amount,issue_date,due_date,sent_at,paid_at,cancelled_at,deleted_at,pdf_path
      FROM invoices WHERE job_id=? OR (source_type='job' AND source_id=?) ORDER BY id DESC`).all(id,String(id));
    const events=db.prepare(`SELECT id,event_time,user_id,user_name,user_role,action,module,record_id,success,details
      FROM audit_log WHERE module='jobs' AND record_id=? ORDER BY event_time,id`).all(String(id));
    res.json({job,phases,handoffs,invoices,events});
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
    const bucket=String(req.query.bucket||"active").toLowerCase(),closedType=String(req.query.closed_type||"completed").toLowerCase();
    if(!["active","closed"].includes(bucket))return res.status(400).json({error:"INVALID_WORKFLOW_BUCKET"});
    if(bucket==="closed"&&!["completed","cancelled"].includes(closedType))return res.status(400).json({error:"INVALID_CLOSED_WORKFLOW_TYPE"});
    let rows=[];
    if(bucket==="active")rows=db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage NOT IN ('planned','completed')
      ORDER BY COALESCE(j.scheduled_at,j.updated_at) DESC,j.id DESC`).all();
    else if(closedType==="cancelled")rows=db.prepare(`${selectJob} WHERE j.cancelled_at IS NOT NULL ORDER BY j.cancelled_at DESC,j.id DESC`).all();
    else rows=db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage='completed' ORDER BY j.completed_at DESC,j.id DESC`).all();
    const jobs=rows.map(decorateJob),allStages=stageDefinitions();
    let visibleStages=bucket==="active"?allStages.filter(stage=>stage.key!=="completed"):allStages.filter(stage=>stage.key==="completed");
    if(bucket==="closed"&&closedType==="cancelled")visibleStages=[{key:"cancelled",position:1,label_en:"Cancelled",label_hu:"Törölt / megszakított",stage_type:"closed",active:true,removable:false}];
    res.json({bucket,closed_type:bucket==="closed"?closedType:null,stages:allStages,max_stages:MAX_WORKFLOW_STAGES,can_add_stage:allStages.length<MAX_WORKFLOW_STAGES,
      columns:visibleStages.map(stage=>({...stage,jobs:bucket==="closed"?jobs:jobs.filter(job=>job.stage===stage.key)})),jobs});
  });
  app.get("/api/workshop",auth,staff,(_req,res)=>{
    const jobs=db.prepare(`${selectJob} WHERE j.cancelled_at IS NULL AND j.stage<>'planned' ORDER BY COALESCE(j.scheduled_at,j.updated_at),j.id`).all().map(decorateJob);
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
      const incoming=normalizePlan(req.body?.phases,{defaultResponsibleId:before.created_by_user_id||before.workflow_owner_user_id||req.user.id}),currentPhase=before.stage==="planned"?null:before.workflow_phases.find(row=>row.stage_key===before.stage);
      const oldByKey=new Map(before.workflow_phases.map(row=>[row.stage_key,row]));
      const safe=incoming.map(row=>{
        const old=oldByKey.get(row.stage_key);
        const merged={...row,starts_at:row.starts_at??old?.starts_at??null,due_at:row.due_at??old?.due_at??null,responsible_user_id:row.responsible_user_id??old?.responsible_user_id??before.created_by_user_id??req.user.id};
        if(old?.completed_at||row.stage_key===before.stage||FIXED_STAGE_KEYS.has(row.stage_key))return {...merged,enabled:true};
        return merged;
      });
      if(currentPhase&&!safe.find(row=>row.stage_key===before.stage)?.enabled)throw problem("CURRENT_WORKFLOW_PHASE_REQUIRED",409);
      writePlan(id,safe,{preserveProgress:true});
      const after=jobById(id);audit(req,"UPDATE_WORKFLOW_PLAN","jobs",String(id),before,after);res.json(after);
    }catch(error){respondError(res,error);}
  });
  app.patch("/api/jobs/:id/workflow-phases/:stage",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),stage=text(req.params.stage,40),before=id&&jobById(id);if(!before)return res.status(404).json({error:"JOB_NOT_FOUND"});
    if(!stageByKey(stage,{includeInactive:true}))return res.status(400).json({error:"INVALID_WORKFLOW_STAGE"});
    const phase=before.workflow_phases.find(row=>row.stage_key===stage);if(!phase)return res.status(404).json({error:"WORKFLOW_PHASE_NOT_FOUND"});
    if(req.user.role==="WORKER"&&stage!==before.stage)return res.status(403).json({error:"PERMISSION_DENIED"});
    try{
      const startsAt=req.body?.starts_at===undefined?phase.starts_at:optionalIso(req.body.starts_at);
      const dueAt=req.body?.due_at===undefined?phase.due_at:optionalIso(req.body.due_at);
      const responsibleId=req.body?.responsible_user_id===undefined?phase.responsible_user_id:(text(req.body.responsible_user_id,160)||null);
      if(responsibleId)responsibleUser(responsibleId,{optional:false});
      let blockerCode=req.body?.blocker_code===undefined?phase.blocker_code:text(req.body.blocker_code,50)||null;
      const blockerNote=req.body?.blocker_note===undefined?phase.blocker_note:text(req.body.blocker_note,2000)||null;
      if(blockerCode&&!BLOCKER_CODES.has(blockerCode))throw problem("INVALID_BLOCKER_CODE");
      db.prepare("UPDATE job_workflow_phases SET starts_at=?,due_at=?,responsible_user_id=?,blocker_code=?,blocker_note=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND stage_key=?")
        .run(startsAt,dueAt,responsibleId,blockerCode,blockerNote,id,stage);
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
      db.prepare("UPDATE jobs SET scheduled_at=?,estimated_duration_min=?,assigned_technician_id=?,stage=?,workflow_stage_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(scheduledAt,duration,assigned.id,storageStage(stage),stage,id);
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
      db.prepare("UPDATE jobs SET scheduled_at=?,estimated_duration_min=?,assigned_technician_id=?,stage=?,workflow_stage_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(scheduledAt,duration,assigned.id,storageStage(stage),stage,id);
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
      const owner=responsibleUser(req.body?.workflow_owner_user_id??before.workflow_owner_user_id??before.created_by_user_id,{optional:false});
      db.prepare(`UPDATE jobs SET title=?,description=?,location_type=?,site_address=?,estimated_duration_min=?,assigned_technician_id=?,workflow_owner_user_id=?,internal_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
        title,text(req.body?.description??before.description,10000)||null,location,text(req.body?.site_address??before.site_address,1200)||null,
        positiveDuration(req.body?.estimated_duration_min??before.estimated_duration_min),assigned?.id||null,owner.id,text(req.body?.internal_notes??before.internal_notes,10000)||null,id
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
      const requested=text(req.body?.to_stage,80),next=nextEnabledPhase(id,before.stage),toStage=requested||next?.stage_key;if(!toStage)throw problem("INVALID_HANDOFF_STAGE");
      if(toStage===before.stage)throw problem("INVALID_HANDOFF_STAGE");
      if(toStage==="completed")throw problem("ADMIN_CLOSEOUT_REQUIRED",409);
      if(toStage==="received")throw problem("WORKFLOW_START_STAGE_FIXED",409);
      const target=before.workflow_phases.find(row=>row.stage_key===toStage&&row.enabled);
      if(!target)throw problem("WORKFLOW_PHASE_NOT_AVAILABLE",409);
      if(target.completed_at)throw problem("WORKFLOW_PHASE_ALREADY_COMPLETED",409);
      if(toStage==="admin_approval"){
        const remaining=before.workflow_phases.filter(row=>row.enabled&&!row.completed_at&&!["admin_approval","completed",before.stage].includes(row.stage_key));
        if(remaining.length)throw problem("WORKFLOW_PHASES_REMAINING",409,{remaining:remaining.map(row=>row.stage_key)});
      }
      const labor=money(req.body?.phase_labor_cost||0),material=money(req.body?.phase_material_cost||0);
      if(!(labor>=0)||!(material>=0))throw problem("INVALID_HANDOFF_COST");
      const fallbackAssignee=before.assigned_technician_id||req.user.id;
      const assigned=technician(req.body?.assigned_to_user_id||fallbackAssignee,{optional:false});
      const note=text(req.body?.phase_note,5000)||null;
      const result=db.transaction(()=>{
        const info=db.prepare(`INSERT INTO job_handoffs(job_id,from_stage,to_stage,performed_by_user_id,performed_by,assigned_to_user_id,assigned_to,phase_note,phase_labor_cost,phase_material_cost,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(id,before.stage,toStage,req.user.id,req.user.name,assigned.id,assigned.name,note,labor,material);
        completePhase(id,before.stage);activatePhase(id,toStage);
        db.prepare(`UPDATE jobs SET stage=?,workflow_stage_key=?,assigned_technician_id=?,total_labor_cost=ROUND(total_labor_cost+?,2),total_material_cost=ROUND(total_material_cost+?,2),updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(storageStage(toStage),toStage,assigned.id,labor,material,id);
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

"use strict";
const crypto = require('node:crypto');
const {createWorkflowFinance}=require('./workflow-finance');
const {workflowPurgePlan,purgeWorkflowHistory}=require('./workflow-retirement');
const id=prefix=>`${prefix}-${crypto.randomUUID()}`;
const text=(v,max=5000)=>String(v??'').replace(/\u0000/g,'').trim().slice(0,max);
const fault=(code,status=400,details)=>Object.assign(new Error(code),{code,status,details});
const superuser=u=>u?.role==='SUPERADMIN'||Number(u?.is_superadmin)===1;
const admin=u=>superuser(u)||u?.role==='ADMIN';
function localTime(value,optional=false){
 if((value===null||value==='')&&optional)return null;
 const s=String(value||'');
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45)$/.test(s))throw fault('WORKFLOW_TIME_INVALID');
 const date=new Date(`${s}:00Z`);
 if(!Number.isFinite(+date)||date.toISOString().slice(0,16)!==s)throw fault('WORKFLOW_TIME_INVALID');
 // New York wall time: reject nonexistent spring-forward times without shifting dates.
 const ny=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 if(![240,300].some(offset=>ny.format(new Date(+date+offset*60000)).replace(' ','T')===s))throw fault('WORKFLOW_TIME_DST_GAP');
 return s;
}
const afterQuarter=s=>new Date(Date.parse(`${s}:00Z`)+900000).toISOString().slice(0,16);
function money(v){const n=Number(v);if(!Number.isFinite(n)||n<0||n>100000000)throw fault('WORKFLOW_AMOUNT_INVALID');return Math.round((n+Number.EPSILON)*100);}

function createWorkflowV2({db,invoiceEngine}){
 const finance=createWorkflowFinance({db,rid:id,nowISO:()=>nowLocal()});
 const one=(sql,...args)=>db.prepare(sql).get(...args), all=(sql,...args)=>db.prepare(sql).all(...args);
 const run=(sql,...args)=>db.prepare(sql).run(...args);
 const workflow=key=>{const w=one('SELECT * FROM wf2_workflows WHERE id=?',key);if(!w)throw fault('WORKFLOW_NOT_FOUND',404);return w;};
 const phase=key=>{const p=one('SELECT * FROM wf2_phases WHERE id=?',key);if(!p)throw fault('WORKFLOW_PHASE_NOT_FOUND',404);return p;};
 const task=key=>{const t=one('SELECT * FROM wf2_tasks WHERE id=?',key);if(!t)throw fault('WORKFLOW_TASK_NOT_FOUND',404);return t;};
 const user=key=>{const u=one("SELECT id,name FROM users WHERE id=? AND status='Active'",key);if(!u)throw fault('WORKFLOW_ACTIVE_USER_REQUIRED');return u;};
 const owns=(u,w)=>admin(u)||u.id===w.main_responsible_user_id;
 const ownsPhase=(u,w,p)=>owns(u,w)||u.id===p.responsible_user_id;
 const ownsTask=(u,w,p,t)=>ownsPhase(u,w,p)||Boolean(one('SELECT 1 FROM wf2_task_assignees WHERE task_id=? AND user_id=?',t.id,u.id));
 const requireRight=ok=>{if(!ok)throw fault('WORKFLOW_FORBIDDEN',403);};
 const requireActive=w=>{if(w.status!=='ACTIVE')throw fault('WORKFLOW_CLOSED',409);};
 const reasonRequired=(u,reason)=>{if(!superuser(u)&&text(reason).length<5)throw fault('WORKFLOW_OVERRIDE_REASON_REQUIRED');};
 const definitions=()=>all(`SELECT d.*,COALESCE(o.color,'#B88A44') color,COALESCE(o.required,1) required,COALESCE(o.enabled,1) enabled,COALESCE(o.default_status,'WAITING') default_status
   FROM workshop_phase_definitions d LEFT JOIN wf2_phase_options o ON o.code=d.code WHERE d.is_system=1 ORDER BY d.sort_order,d.id`).slice(0,7);
 function audit(w,u,action,kind,entity,before,after,reason=''){
  if(superuser(u))return;
  run('INSERT INTO wf2_audit(id,workflow_id,entity_type,entity_id,actor_user_id,action,reason,before_json,after_json) VALUES(?,?,?,?,?,?,?,?,?)',id('WA'),w.id,kind,entity,u.id,action,text(reason),before?JSON.stringify(before):null,after?JSON.stringify(after):null);
 }
 function notifyApproval(w,t,u,reason){
  for(const person of all('SELECT user_id FROM wf2_task_assignees WHERE task_id=? AND user_id<>?',t.id,u.id))run("INSERT INTO notifications(id,recipient_user_id,sender_user_id,notification_type,title_en,title_hu,body_en,body_hu,metadata_json) VALUES(?,?,?,'WORKFLOW_APPROVAL',?,?,?,?,?)",id('WN'),person.user_id,u.id,'Task approved on your behalf','Részfeladatod teljesítése jóváhagyva',`${u.name||u.id}: ${t.title}. ${text(reason)}`,`${u.name||u.id} jóváhagyta: ${t.title}. ${text(reason)}`,JSON.stringify({wf2_workflow_id:w.id,task_id:t.id,approved_by:u.id}));
 }
 function validPiano(clientId,pianoId){
  if(!one('SELECT id FROM contacts WHERE id=?',clientId))throw fault('WORKFLOW_CLIENT_REQUIRED');
  const p=one('SELECT * FROM pianos WHERE id=?',pianoId);if(!p)throw fault('WORKFLOW_PIANO_REQUIRED');
  if(p.owner_contact_id!==clientId&&!one('SELECT 1 FROM client_pianos WHERE client_id=? AND piano_id=?',clientId,pianoId))throw fault('WORKFLOW_PIANO_CLIENT_MISMATCH');
 }
 function validateDates(w){
  localTime(w.start_at);localTime(w.final_due_at);if(w.start_at>w.final_due_at)throw fault('WORKFLOW_DATE_ORDER');
  const phases=all('SELECT * FROM wf2_phases WHERE workflow_id=?',w.id);
  for(const p of phases){
   if(p.due_at&&(p.due_at<w.start_at||p.due_at>w.final_due_at))throw fault('WORKFLOW_PHASE_OUTSIDE_DATES',409,{phase_id:p.id});
   for(const t of all('SELECT * FROM wf2_tasks WHERE phase_id=?',p.id))if(t.due_at&&(t.due_at<w.start_at||t.due_at>(p.due_at||w.final_due_at)))throw fault('WORKFLOW_TASK_OUTSIDE_DATES',409,{task_id:t.id});
  }
 }
 function permissions(u,w,p,t){return {edit_workflow:owns(u,w),close_workflow:owns(u,w),edit_phase:p?ownsPhase(u,w,p):false,assign_phase:owns(u,w),edit_task:t?ownsTask(u,w,p,t):false,admin:admin(u),superadmin:superuser(u)};}
 function detail(key,u){
  if(!one('SELECT 1 FROM wf2_workflows WHERE id=?',key))return archivedDetail(key,u);
  const w=workflow(key),client=one('SELECT name FROM contacts WHERE id=?',w.client_id),piano=one('SELECT brand,model,serial_no,display_name FROM pianos WHERE id=?',w.piano_id);
  const phases=all('SELECT * FROM wf2_phases WHERE workflow_id=? ORDER BY stage_order,id',key).map(p=>{
   const tasks=all('SELECT * FROM wf2_tasks WHERE phase_id=? ORDER BY rowid',p.id).map(t=>({...t,assignee_ids:all('SELECT user_id FROM wf2_task_assignees WHERE task_id=? ORDER BY user_id',t.id).map(a=>a.user_id),permissions:permissions(u,w,p,t)}));
   return {...p,effective_status:p.due_at&&p.due_at<nowLocal()&&!['COMPLETED','NOT_REQUIRED'].includes(p.status)?'OVERDUE':p.status,card_title:p.title,details:p.description,assigned_user_id:p.responsible_user_id,assigned_to:one('SELECT name FROM users WHERE id=?',p.responsible_user_id)?.name||'',is_overdue:Boolean(p.due_at&&p.due_at<nowLocal()&&!['COMPLETED','NOT_REQUIRED'].includes(p.status)),tasks,subtasks:tasks,costs:all('SELECT * FROM wf2_costs WHERE phase_id=? ORDER BY rowid',p.id),checklist:all('SELECT * FROM wf2_checklist WHERE phase_id=? ORDER BY rowid',p.id),documents:all('SELECT id,phase_id,task_id,original_name,mime_type,size_bytes,uploaded_by,created_at FROM wf2_documents WHERE phase_id=? ORDER BY created_at',p.id),permissions:permissions(u,w,p)};
  });
  return {...w,...piano,client_name:client?.name||'',current_status:w.status,creator_name:one('SELECT name FROM users WHERE id=?',w.creator_user_id)?.name||'',main_responsible_name:one('SELECT name FROM users WHERE id=?',w.main_responsible_user_id)?.name||'',stages:phases,permissions:permissions(u,w),audit:all('SELECT a.*,u.name actor_name FROM wf2_audit a JOIN users u ON u.id=a.actor_user_id WHERE workflow_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 200',key),calendar:all('SELECT l.*,j.start_time,j.end_time,j.status FROM wf2_calendar_links l JOIN jobs j ON j.id=l.job_id WHERE l.workflow_id=?',key)};
 }
 function nowLocal(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');}
 function archivedDetail(key,u){
  const w=one('SELECT w.*,c.name client_name,p.brand,p.model,p.serial_no,p.display_name FROM workflow_finance_sources w LEFT JOIN contacts c ON c.id=w.client_id LEFT JOIN pianos p ON p.id=w.piano_id WHERE w.id=?',key);
  if(!w)throw fault('WORKFLOW_NOT_FOUND',404);
  const readOnly={edit_workflow:false,close_workflow:false,edit_phase:false,assign_phase:false,edit_task:false,admin:admin(u),superadmin:superuser(u)};
  const stages=all('SELECT * FROM workflow_finance_phases WHERE workflow_id=? ORDER BY stage_order,id',key).map(p=>({...p,title:p.card_title||p.name_snapshot_hu,description:p.details||'',responsible_user_id:p.assigned_user_id,assigned_to:one('SELECT name FROM users WHERE id=?',p.assigned_user_id)?.name||'',tasks:[],subtasks:[],checklist:[],documents:[],costs:all('SELECT *,CAST(ROUND(amount*100) AS INTEGER) amount_cents,CAST(ROUND(amount*100) AS INTEGER) charge_cents FROM workflow_finance_lines WHERE stage_id=?',p.id),permissions:readOnly,is_overdue:false,effective_status:p.status}));
  return {...w,historical:true,status:'COMPLETED',creator_user_id:w.created_by_user_id,creator_name:one('SELECT name FROM users WHERE id=?',w.created_by_user_id)?.name||'',main_responsible_user_id:null,main_responsible_name:'',start_at:'',stages,permissions:readOnly,audit:[],calendar:[]};
 }
 function list(u,status='ACTIVE'){
  const rows=all('SELECT id FROM wf2_workflows WHERE status=? ORDER BY final_due_at,id',status).map(w=>detail(w.id,u));
  if(status==='COMPLETED')for(const w of all('SELECT id FROM workflow_finance_sources s WHERE NOT EXISTS(SELECT 1 FROM wf2_workflows w WHERE w.id=s.id) ORDER BY final_due_at,id'))rows.push(archivedDetail(w.id,u));
  return rows.sort((a,b)=>String(a.final_due_at).localeCompare(String(b.final_due_at))||a.id.localeCompare(b.id));
 }
 function syncCalendar(w){
  const phases=all('SELECT * FROM wf2_phases WHERE workflow_id=?',w.id),events=[{kind:'START',key:w.id,due:w.start_at,owner:w.main_responsible_user_id,title:`Start · ${w.title}`,done:w.status==='COMPLETED'},{kind:'FINAL',key:w.id,due:w.final_due_at,owner:w.main_responsible_user_id,title:`Deadline · ${w.title}`,done:w.status==='COMPLETED'}];
  for(const p of phases){events.push({kind:'PHASE',key:p.id,due:p.due_at,owner:p.responsible_user_id,title:`${w.title} · ${p.title}`,done:['COMPLETED','NOT_REQUIRED'].includes(p.status)});for(const t of all('SELECT * FROM wf2_tasks WHERE phase_id=?',p.id))events.push({kind:'TASK',key:t.id,due:t.due_at,owner:one('SELECT user_id FROM wf2_task_assignees WHERE task_id=? ORDER BY user_id LIMIT 1',t.id)?.user_id||p.responsible_user_id,title:`${w.title} · ${t.title}`,done:t.status==='COMPLETED',cancelled:t.status!=='COMPLETED'&&(['COMPLETED','NOT_REQUIRED'].includes(p.status)||w.status==='COMPLETED')});}
  const client=one('SELECT name,phone FROM contacts WHERE id=?',w.client_id),piano=one('SELECT brand,model FROM pianos WHERE id=?',w.piano_id),expected=new Set();
  for(const e of events){
   if(!e.due)continue;expected.add(`${e.kind}:${e.key}`);const link=one('SELECT * FROM wf2_calendar_links WHERE entity_type=? AND entity_id=?',e.kind,e.key);const jobId=link?.job_id||id('WF2J'),owner=user(e.owner);
   if(!link){run('INSERT INTO jobs(id,job_key,title,job_type,assigned_to,start_time,end_time,created_by_user_id,created_by) VALUES(?,?,?,?,?,?,?,?,?)',jobId,jobId,e.title,'Workflow deadline',owner.name,e.due,afterQuarter(e.due),w.creator_user_id,one('SELECT name FROM users WHERE id=?',w.creator_user_id)?.name||'');run('INSERT INTO wf2_calendar_links(id,workflow_id,entity_type,entity_id,job_id) VALUES(?,?,?,?,?)',id('WL'),w.id,e.kind,e.key,jobId);}
   const started=e.kind==='START'&&one("SELECT 1 FROM jobs WHERE id=? AND notes='WF2_STARTED'",jobId);
   run("UPDATE jobs SET title=?,assigned_user_id=?,assigned_to=?,start_time=?,end_time=?,client_id=?,client_name=?,client_phone=?,piano_id=?,piano_name=?,status=?,financial_status=?,planned_minutes=15,planned_hours=0.25,updated_at=CURRENT_TIMESTAMP WHERE id=?",e.title,e.owner,owner.name,e.due,afterQuarter(e.due),w.client_id,client.name,client.phone||'',w.piano_id,[piano.brand,piano.model].filter(Boolean).join(' '),e.cancelled?'Cancelled':e.done||started?'Completed':'Open',w.status==='COMPLETED'?'POSTED':'OPEN',jobId);
  }
  for(const l of all('SELECT * FROM wf2_calendar_links WHERE workflow_id=?',w.id))if(!expected.has(`${l.entity_type}:${l.entity_id}`)){run('DELETE FROM wf2_calendar_links WHERE id=?',l.id);run('DELETE FROM jobs WHERE id=?',l.job_id);}
 }
 function command(key,u,body,action,fn){return db.transaction(()=>{
  const w=workflow(key);requireActive(w);if(body.version!==undefined&&Number(body.version)!==w.version)throw fault('WORKFLOW_VERSION_CONFLICT',409,{version:w.version});
  fn(w);const current=workflow(key);validateDates(current);syncCalendar(current);run('UPDATE wf2_workflows SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',key);
  return detail(key,u);
 })();}
 function create(body,u){return db.transaction(()=>{
  user(u.id);const owner=user(body.main_responsible_user_id||u.id);validPiano(body.client_id,body.piano_id);const title=text(body.title,200);if(!title)throw fault('WORKFLOW_TITLE_REQUIRED');
  const key=id('WF2'),start=localTime(body.start_at),due=localTime(body.final_due_at),mode=body.mode||'INBOUND';if(!['INBOUND','ON_SITE'].includes(mode))throw fault('WORKFLOW_MODE_INVALID');if(start>due)throw fault('WORKFLOW_DATE_ORDER');
  run('INSERT INTO wf2_workflows(id,workflow_key,title,client_id,piano_id,creator_user_id,main_responsible_user_id,mode,start_at,final_due_at,description) VALUES(?,?,?,?,?,?,?,?,?,?,?)',key,key,title,body.client_id,body.piano_id,u.id,owner.id,mode,start,due,text(body.description));
  const defs=definitions();if(defs.length!==7)throw fault('WORKFLOW_SEVEN_PHASES_REQUIRED',409);
  for(const d of defs){const input=(body.phases||[]).find(p=>p.stage_code===d.code)||{};const assigned=user(input.responsible_user_id||owner.id);run('INSERT INTO wf2_phases(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,responsible_user_id,title,due_at,required,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id('WP'),key,d.code,d.sort_order,d.name_en,d.name_hu,assigned.id,text(input.title||d.name_hu,200),localTime(input.due_at??null,true),d.required,d.enabled?d.default_status:'NOT_REQUIRED');}
  const w=workflow(key);validateDates(w);syncCalendar(w);audit(w,u,'CREATE','WORKFLOW',key,null,w);return detail(key,u);
 })();}
 function update(key,body,u){return command(key,u,body,'UPDATE',w=>{
  requireRight(owns(u,w));const next={...w};for(const f of ['title','description','mode','client_id','piano_id','main_responsible_user_id','start_at','final_due_at'])if(body[f]!==undefined)next[f]=body[f];
  if(!text(next.title,200))throw fault('WORKFLOW_TITLE_REQUIRED');user(next.main_responsible_user_id);validPiano(next.client_id,next.piano_id);localTime(next.start_at);localTime(next.final_due_at);if(!['INBOUND','ON_SITE'].includes(next.mode))throw fault('WORKFLOW_MODE_INVALID');
  run('UPDATE wf2_workflows SET title=?,description=?,mode=?,client_id=?,piano_id=?,main_responsible_user_id=?,start_at=?,final_due_at=? WHERE id=?',text(next.title,200),text(next.description),next.mode,next.client_id,next.piano_id,next.main_responsible_user_id,next.start_at,next.final_due_at,key);audit(w,u,'UPDATE','WORKFLOW',key,w,workflow(key));
 });}
 function phaseContext(key,phaseId){const p=phase(phaseId);if(p.workflow_id!==key)throw fault('WORKFLOW_PHASE_NOT_FOUND',404);return p;}
 function taskContext(p,taskId){const t=task(taskId);if(t.phase_id!==p.id)throw fault('WORKFLOW_TASK_NOT_FOUND',404);return t;}
 function updatePhase(key,phaseId,body,u){return command(key,u,body,'PHASE_UPDATE',w=>{
  const p=phaseContext(key,phaseId);requireRight(ownsPhase(u,w,p));
  const n={...p,...Object.fromEntries(Object.entries(body).filter(([k])=>['title','description','responsible_user_id','due_at','required','status'].includes(k)))};
  if(n.responsible_user_id!==p.responsible_user_id||Number(n.required)!==p.required)requireRight(owns(u,w));user(n.responsible_user_id);if(!text(n.title,200))throw fault('WORKFLOW_TITLE_REQUIRED');
  if(!['WAITING','IN_PROGRESS','BLOCKED','NOT_REQUIRED','COMPLETED'].includes(n.status))throw fault('WORKFLOW_STATUS_INVALID');
  if(n.status==='COMPLETED'&&p.status!=='COMPLETED')throw fault('WORKFLOW_USE_PHASE_CLOSE',409);
  if(p.status==='COMPLETED'&&n.status!==p.status)throw fault('WORKFLOW_USE_PHASE_REOPEN',409);
  if(n.status==='NOT_REQUIRED'){requireRight(owns(u,w));if(Number(n.required))throw fault('WORKFLOW_REQUIRED_PHASE',409);if(all('SELECT id FROM wf2_costs WHERE phase_id=?',p.id).length)throw fault('WORKFLOW_PHASE_HAS_COSTS',409);}
  run('UPDATE wf2_phases SET title=?,description=?,responsible_user_id=?,due_at=?,required=?,status=? WHERE id=?',text(n.title,200),text(n.description),n.responsible_user_id,localTime(n.due_at,true),n.required?1:0,n.status,p.id);audit(w,u,'PHASE_UPDATE','PHASE',p.id,p,phase(p.id));
 });}
 function addPhase(key,code,body,u){return command(key,u,body,'PHASE_ADD',w=>{
  requireRight(owns(u,w));const d=definitions().find(d=>d.code===code);if(!d)throw fault('WORKFLOW_PHASE_INVALID');if(one('SELECT 1 FROM wf2_phases WHERE workflow_id=? AND stage_code=?',key,code))throw fault('WORKFLOW_PHASE_EXISTS',409);user(body.responsible_user_id||w.main_responsible_user_id);
  const pid=id('WP');run('INSERT INTO wf2_phases(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,responsible_user_id,title,required) VALUES(?,?,?,?,?,?,?,?,?)',pid,key,code,d.sort_order,d.name_en,d.name_hu,body.responsible_user_id||w.main_responsible_user_id,d.name_hu,d.required);audit(w,u,'PHASE_ADD','PHASE',pid,null,phase(pid));
 });}
 function setAssignees(t,p,values){const users=values===undefined?[p.responsible_user_id]:values;if(!Array.isArray(users)||!users.length||users.length>100)throw fault('WORKFLOW_ASSIGNEES_REQUIRED');for(const uid of new Set(users))user(uid);run('DELETE FROM wf2_task_assignees WHERE task_id=?',t.id);for(const uid of new Set(users))run('INSERT INTO wf2_task_assignees(task_id,user_id) VALUES(?,?)',t.id,uid);}
 function saveTask(key,phaseId,taskId,body,u){return command(key,u,body,'TASK_SAVE',w=>{
  const p=phaseContext(key,phaseId),t=taskId?taskContext(p,taskId):null;requireRight(t?ownsTask(u,w,p,t):ownsPhase(u,w,p));if(p.status==='COMPLETED')throw fault('WORKFLOW_PHASE_CLOSED',409);
  const manager=ownsPhase(u,w,p);if(!manager&&['assignee_ids','required'].some(f=>body[f]!==undefined))throw fault('WORKFLOW_FORBIDDEN',403);
  const title=text(body.title??t?.title,200);if(!title)throw fault('WORKFLOW_TITLE_REQUIRED');const due=localTime(body.due_at===undefined?(t?.due_at||null):body.due_at,true),tid=t?.id||id('WT');
  if(!t)run('INSERT INTO wf2_tasks(id,phase_id,title,description,due_at,required) VALUES(?,?,?,?,?,?)',tid,p.id,title,text(body.description),due,body.required===false||body.required===0?0:1);
  else run('UPDATE wf2_tasks SET title=?,description=?,due_at=?,required=? WHERE id=?',title,text(body.description??t.description),due,body.required===undefined?t.required:(body.required?1:0),tid);
  if(!t||body.assignee_ids!==undefined)setAssignees({id:tid},p,body.assignee_ids);audit(w,u,t?'TASK_UPDATE':'TASK_CREATE','TASK',tid,t,task(tid));
 });}
 function completeTask(key,phaseId,taskId,body,u){return command(key,u,body,'TASK_COMPLETE',w=>{
  const p=phaseContext(key,phaseId),t=taskContext(p,taskId);requireRight(ownsTask(u,w,p,t));if(t.status==='COMPLETED')return;
  const own=Boolean(one('SELECT 1 FROM wf2_task_assignees WHERE task_id=? AND user_id=?',t.id,u.id));if(!own){requireRight(ownsPhase(u,w,p));reasonRequired(u,body.reason);}
  if(one('SELECT 1 FROM wf2_checklist WHERE task_id=? AND required=1 AND checked=0',t.id))throw fault('WORKFLOW_CHECKLIST_INCOMPLETE',409);
  run("UPDATE wf2_tasks SET status='COMPLETED',completed_by=?,completed_at=CURRENT_TIMESTAMP,approved_by=?,approval_reason=? WHERE id=?",u.id,own?null:u.id,own?null:text(body.reason),t.id);audit(w,u,own?'TASK_COMPLETE':'TASK_APPROVED_FOR_ASSIGNEES','TASK',t.id,t,task(t.id),body.reason);if(!own)notifyApproval(w,t,u,body.reason);
 });}
 function deleteTask(key,phaseId,taskId,body,u){return command(key,u,body,'TASK_DELETE',w=>{const p=phaseContext(key,phaseId),t=taskContext(p,taskId);requireRight(ownsPhase(u,w,p));if(p.status==='COMPLETED')throw fault('WORKFLOW_PHASE_CLOSED',409);run('DELETE FROM wf2_tasks WHERE id=?',t.id);audit(w,u,'TASK_DELETE','TASK',t.id,t,null,body.reason);});}
 function saveCost(key,phaseId,costId,body,u,remove=false){return command(key,u,body,'COST_SAVE',w=>{
  const p=phaseContext(key,phaseId);requireRight(ownsPhase(u,w,p));if(p.financial_status==='CLOSED')throw fault('WORKFLOW_PHASE_FINANCE_CLOSED',409);
  const old=costId?one('SELECT * FROM wf2_costs WHERE id=? AND phase_id=?',costId,p.id):null;if(costId&&!old)throw fault('WORKFLOW_COST_NOT_FOUND',404);if(old?.finance_line_id)throw fault('WORKFLOW_POSTED_COST_REQUIRES_ADJUSTMENT',409);
  if(remove){run('DELETE FROM wf2_costs WHERE id=?',costId);audit(w,u,'COST_DELETE','COST',costId,old,null);return;}
  const title=text(body.title??old?.title,200),category=body.category||old?.category||'LABOR',billing=body.billing_status||old?.billing_status||'CHARGEABLE';if(!title)throw fault('WORKFLOW_TITLE_REQUIRED');
  if(!['LABOR','MATERIAL','TRANSPORT','PURCHASE','CONTRACTOR','OTHER'].includes(category)||!['CHARGEABLE','WARRANTY','FREE','COMPENSATION','CREDIT'].includes(billing))throw fault('WORKFLOW_COST_CATEGORY_INVALID');
  const partner=body.partner_id===undefined?(old?.partner_id||null):(body.partner_id||null);if(partner&&!one('SELECT id FROM partners WHERE id=?',partner))throw fault('WORKFLOW_PARTNER_INVALID');
  const amount=body.amount===undefined?(old?.amount_cents||0):money(body.amount),charge=body.charge_amount===undefined?(old?.charge_cents??amount):money(body.charge_amount),cid=old?.id||id('WC');
  run('INSERT INTO wf2_costs(id,phase_id,title,category,amount_cents,charge_cents,billing_status,partner_id,created_by) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,amount_cents=excluded.amount_cents,charge_cents=excluded.charge_cents,billing_status=excluded.billing_status,partner_id=excluded.partner_id',cid,p.id,title,category,amount,charge,billing,partner,u.id);audit(w,u,'COST_SAVE','COST',cid,old,one('SELECT * FROM wf2_costs WHERE id=?',cid));
 });}
 function checklist(key,phaseId,itemId,body,u,remove=false){return command(key,u,body,'CHECKLIST',w=>{
  const p=phaseContext(key,phaseId),old=itemId?one('SELECT * FROM wf2_checklist WHERE id=? AND phase_id=?',itemId,p.id):null;if(itemId&&!old)throw fault('WORKFLOW_CHECKLIST_NOT_FOUND',404);
  const taskId=body.task_id===undefined?(old?.task_id||null):(body.task_id||null),t=taskId?taskContext(p,taskId):null;requireRight(ownsPhase(u,w,p)||(t&&ownsTask(u,w,p,t)));if(p.status==='COMPLETED')throw fault('WORKFLOW_PHASE_CLOSED',409);
  if(!ownsPhase(u,w,p)&&(remove||!old||['title','required','task_id'].some(k=>body[k]!==undefined)))throw fault('WORKFLOW_FORBIDDEN',403);
  if(remove){run('DELETE FROM wf2_checklist WHERE id=?',old.id);audit(w,u,'CHECKLIST_DELETE','CHECKLIST',old.id,old,null);return;}
  const cid=old?.id||id('WK'),title=text(body.title??old?.title,300),checked=body.checked===undefined?(old?.checked||0):(body.checked?1:0);if(!title)throw fault('WORKFLOW_TITLE_REQUIRED');
  run('INSERT INTO wf2_checklist(id,phase_id,task_id,title,required,checked,checked_by,checked_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id,title=excluded.title,required=excluded.required,checked=excluded.checked,checked_by=excluded.checked_by,checked_at=excluded.checked_at',cid,p.id,taskId,title,body.required===undefined?(old?.required??1):(body.required?1:0),checked,checked?u.id:null,checked?new Date().toISOString():null);audit(w,u,'CHECKLIST_SAVE','CHECKLIST',cid,old,one('SELECT * FROM wf2_checklist WHERE id=?',cid));
 });}
 function custody(w){
  run('INSERT INTO workflow_finance_sources(id,workflow_key,client_id,piano_id,mode,title,final_due_at,created_by_user_id) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,client_id=excluded.client_id,piano_id=excluded.piano_id,final_due_at=excluded.final_due_at',w.id,w.workflow_key,w.client_id,w.piano_id,w.mode,w.title,w.final_due_at,w.creator_user_id);
  for(const p of all('SELECT * FROM wf2_phases WHERE workflow_id=?',w.id))run('INSERT INTO workflow_finance_phases(id,workflow_id,stage_code,stage_order,name_snapshot_en,name_snapshot_hu,card_title,assigned_user_id,status,due_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET card_title=excluded.card_title,status=excluded.status,due_at=excluded.due_at',p.id,w.id,p.stage_code,p.stage_order,p.name_snapshot_en,p.name_snapshot_hu,p.title,p.responsible_user_id,p.status,p.due_at);
  return one('SELECT * FROM workflow_finance_sources WHERE id=?',w.id);
 }
 function postPhase(w,p,u){
  if(one('SELECT 1 FROM wf2_costs WHERE phase_id=? AND amount_cents>0 AND finance_line_id IS NULL',p.id)&&one('SELECT 1 FROM financial_statement_snapshots WHERE period>=? LIMIT 1',nowLocal().slice(0,7)))throw fault('WORKFLOW_CLOSED_PERIOD_REVIEW_REQUIRED',409);
  const source=custody(w);
  for(const c of all('SELECT * FROM wf2_costs WHERE phase_id=?',p.id)){
   if(c.finance_line_id||!c.amount_cents)continue;const fid=id('WFL');
   run("INSERT INTO workflow_finance_lines(id,workflow_id,stage_id,line_type,category,title,amount,billing_status,partner_id,created_by_user_id) VALUES(?,?,?,'COST',?,?,?,?,?,?)",fid,w.id,p.id,c.category,c.title,c.amount_cents/100,c.billing_status,c.partner_id,u.id);
   const line=one('SELECT * FROM workflow_finance_lines WHERE id=?',fid);finance.postWipForLine(line,source,u);
   if(c.partner_id){const bill=invoiceEngine.createWorkflowPayableInvoice({workflow:source,stage:{...p,name_snapshot_en:p.name_snapshot_en},line,partner:one('SELECT * FROM partners WHERE id=?',c.partner_id),actor:u,now:nowLocal()});if(bill)run('UPDATE workflow_finance_lines SET payable_invoice_id=? WHERE id=?',bill.id,fid);}
   run('UPDATE wf2_costs SET finance_line_id=? WHERE id=?',fid,c.id);
  }
  run("UPDATE wf2_phases SET financial_status='CLOSED' WHERE id=?",p.id);run("UPDATE workflow_finance_phases SET financial_status='CLOSED',financial_closed_at=CURRENT_TIMESTAMP,financial_closed_by_user_id=? WHERE id=?",u.id,p.id);
 }
 function closePhase(key,phaseId,body,u){return command(key,u,body,'PHASE_CLOSE',w=>{
  const p=phaseContext(key,phaseId);requireRight(ownsPhase(u,w,p));if(p.status==='COMPLETED')return;
  const pending=all("SELECT id FROM wf2_tasks WHERE phase_id=? AND required=1 AND status<>'COMPLETED'",p.id),unchecked=all('SELECT id FROM wf2_checklist WHERE phase_id=? AND required=1 AND checked=0',p.id);
  if(pending.length||unchecked.length)throw fault('WORKFLOW_PHASE_INCOMPLETE',409,{tasks:pending,checklist:unchecked});
  run("UPDATE wf2_phases SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP,completed_by=? WHERE id=?",u.id,p.id);postPhase(w,phase(p.id),u);audit(w,u,'PHASE_COMPLETE','PHASE',p.id,p,phase(p.id),body.reason);
 });}
 function closeWorkflow(key,body,u){
  const current=workflow(key);requireRight(owns(u,current));if(current.status==='COMPLETED')return detail(key,u);
  return command(key,u,body,'WORKFLOW_CLOSE',w=>{
   const phases=all('SELECT * FROM wf2_phases WHERE workflow_id=?',key),pending=phases.filter(p=>p.required&&p.status!=='COMPLETED'),tasks=all("SELECT t.* FROM wf2_tasks t JOIN wf2_phases p ON p.id=t.phase_id WHERE p.workflow_id=? AND t.required=1 AND t.status<>'COMPLETED'",key),checks=all('SELECT c.* FROM wf2_checklist c JOIN wf2_phases p ON p.id=c.phase_id WHERE p.workflow_id=? AND c.required=1 AND c.checked=0',key);
   const override=u.id!==w.main_responsible_user_id||pending.length>0||tasks.length>0||checks.length>0;
   if(override&&!admin(u))throw fault('WORKFLOW_INCOMPLETE',409,{phases:pending.map(p=>({title:p.title,responsible:one('SELECT name FROM users WHERE id=?',p.responsible_user_id)?.name||p.responsible_user_id})),tasks:tasks.map(t=>({title:t.title,responsible:all('SELECT u.name FROM wf2_task_assignees a JOIN users u ON u.id=a.user_id WHERE a.task_id=?',t.id).map(u=>u.name).join(', ')})),checklist:checks.map(c=>({title:c.title}))});
   if(override){requireRight(admin(u));reasonRequired(u,body.reason);if(!superuser(u)&&!body.override)throw fault('WORKFLOW_OVERRIDE_CONFIRMATION_REQUIRED',409,{pending:pending.map(p=>p.id),tasks:tasks.map(t=>t.id)});}
   for(const t of tasks){run("UPDATE wf2_tasks SET status='COMPLETED',completed_by=?,completed_at=CURRENT_TIMESTAMP,approved_by=?,approval_reason=? WHERE id=?",u.id,u.id,text(body.reason),t.id);audit(w,u,'TASK_APPROVED_FOR_ASSIGNEES','TASK',t.id,t,task(t.id),body.reason);notifyApproval(w,t,u,body.reason);}
   for(const c of checks){run('UPDATE wf2_checklist SET checked=1,checked_by=?,checked_at=CURRENT_TIMESTAMP WHERE id=?',u.id,c.id);audit(w,u,'CHECKLIST_APPROVED','CHECKLIST',c.id,c,{checked:1},body.reason);}
   for(const p of phases.filter(p=>p.status!=='NOT_REQUIRED')){run("UPDATE wf2_phases SET status='COMPLETED',completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),completed_by=COALESCE(completed_by,?) WHERE id=?",u.id,p.id);postPhase(w,phase(p.id),u);}
   const source=custody(w);for(const line of all("SELECT * FROM workflow_finance_lines WHERE workflow_id=? AND line_type='COST'",key))finance.releaseWipForLine(line,source,u);
   const costs=all('SELECT c.*,p.id stage_id FROM wf2_costs c JOIN wf2_phases p ON p.id=c.phase_id WHERE p.workflow_id=?',key);
   if(costs.some(c=>c.amount_cents||c.charge_cents)&&one('SELECT 1 FROM financial_statement_snapshots WHERE period>=? LIMIT 1',nowLocal().slice(0,7)))throw fault('WORKFLOW_CLOSED_PERIOD_REVIEW_REQUIRED',409);
   const invoice=invoiceEngine.createWorkflowInvoice({workflow:source,stages:all('SELECT * FROM workflow_finance_phases WHERE workflow_id=?',key),lines:costs.map(c=>({...c,line_type:'COST',amount:c.charge_cents/100,accounting_status:'RELEASED'})),actor:u,now:nowLocal(),paymentMethod:body.payment_method});
   if(invoice){run("UPDATE invoices SET status='issued' WHERE id=?",invoice.id);invoiceEngine.postWorkflowInvoiceLedger(invoiceEngine.invoiceDetail(invoice.id),u);}
   run("UPDATE wf2_workflows SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP,completed_by=?,invoice_id=? WHERE id=?",u.id,invoice?.id||null,key);
   run("UPDATE workflow_finance_sources SET current_status='COMPLETED',financial_status='CLOSED',financial_closed_at=CURRENT_TIMESTAMP,financial_closed_by_user_id=?,invoice_id=? WHERE id=?",u.id,invoice?.id||null,key);
   const snapshot=detail(key,u),costTotal=costs.reduce((s,c)=>s+c.amount_cents,0)/100,revenue=invoice?.subtotal||0;
   run('INSERT INTO workflow_finance_closures(id,workflow_id,client_id,piano_id,final_due_at,closed_at,closed_by_user_id,closure_reason,revenue_total,cost_total,net_total,snapshot_json) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?,?)',id('WFC'),key,w.client_id,w.piano_id,w.final_due_at,u.id,text(body.reason),revenue,costTotal,revenue-costTotal,JSON.stringify(snapshot));
   run('INSERT INTO wf2_closeouts(workflow_id,actor_user_id,override,reason,snapshot_json) VALUES(?,?,?,?,?)',key,u.id,override?1:0,text(body.reason),JSON.stringify(snapshot));audit(w,u,override?'WORKFLOW_OVERRIDE_CLOSE':'WORKFLOW_CLOSE','WORKFLOW',key,w,workflow(key),body.reason);
  });
 }
 function deletePhase(key,phaseId,body,u){return command(key,u,body,'PHASE_DELETE',w=>{
  requireRight(admin(u));const p=phaseContext(key,phaseId);reasonRequired(u,body.reason);const source=custody(w);finance.writeOffStageWip({id:p.id},source,u,body.reason);
  run("UPDATE workflow_finance_phases SET stage_code=stage_code||':REMOVED:'||id,status='ABORTED' WHERE id=?",p.id);
  run('DELETE FROM wf2_phases WHERE id=?',p.id);audit(w,u,'PHASE_DELETE','PHASE',p.id,p,null,body.reason);
 });}
 function canDocument(key,phaseId,taskId,u){const w=workflow(key),p=phaseContext(key,phaseId);requireActive(w);requireRight(taskId?ownsTask(u,w,p,taskContext(p,taskId)):ownsPhase(u,w,p));return {w,p};}
 function addDocument(key,phaseId,body,file,u){return command(key,u,body,'DOCUMENT_ADD',w=>{canDocument(key,phaseId,body.task_id,u);const doc=id('WD');run('INSERT INTO wf2_documents(id,phase_id,task_id,original_name,stored_name,mime_type,size_bytes,sha256,uploaded_by) VALUES(?,?,?,?,?,?,?,?,?)',doc,phaseId,body.task_id||null,text(file.original_name,250),file.stored_name,file.mime_type,file.size_bytes,file.sha256,u.id);audit(w,u,'DOCUMENT_ADD','DOCUMENT',doc,null,{name:file.original_name});});}
 function removeDocument(key,phaseId,docId,body,u){return command(key,u,body,'DOCUMENT_DELETE',w=>{const d=one('SELECT * FROM wf2_documents WHERE id=? AND phase_id=?',docId,phaseId);if(!d)throw fault('WORKFLOW_DOCUMENT_NOT_FOUND',404);canDocument(key,phaseId,d.task_id,u);run('DELETE FROM wf2_documents WHERE id=?',docId);audit(w,u,'DOCUMENT_DELETE','DOCUMENT',docId,{name:d.original_name},null);});}
 function link(jobId){return one('SELECT * FROM wf2_calendar_links WHERE job_id=?',jobId);}
 function jobRights(jobId,u){const l=link(jobId);if(!l)return null;const w=workflow(l.workflow_id);if(l.entity_type==='PHASE')return ownsPhase(u,w,phase(l.entity_id));if(l.entity_type==='TASK'){const t=task(l.entity_id);return ownsTask(u,w,phase(t.phase_id),t);}return owns(u,w);}
 function calendarRow(row,u){
  const l=link(row.id);if(!l)return row;
  const t=l.entity_type==='TASK'?task(l.entity_id):null;
  return {...row,calendar_entry_type:'WORKFLOW_V2',wf2_workflow_id:l.workflow_id,wf2_entity_type:l.entity_type,wf2_entity_id:l.entity_id,wf2_phase_id:t?.phase_id||(l.entity_type==='PHASE'?l.entity_id:null),wf2_can_edit:Boolean(jobRights(row.id,u)),wf2_assignee_ids:t?all('SELECT user_id FROM wf2_task_assignees WHERE task_id=?',t.id).map(a=>a.user_id):[row.assigned_user_id]};
 }
 function rescheduleJob(jobId,body,u){const l=link(jobId);if(!l)throw fault('WORKFLOW_CALENDAR_LINK_NOT_FOUND',404);requireRight(jobRights(jobId,u));const due=localTime(body.target_date||body.start_time);const w=workflow(l.workflow_id),reason=text(body.reason||body.reassignment_note||'Calendar reschedule / Naptári újraütemezés');
  if(body.assigned_user_id!==undefined&&body.assigned_user_id!==one('SELECT assigned_user_id FROM jobs WHERE id=?',jobId).assigned_user_id)throw fault('WORKFLOW_ASSIGN_IN_DETAILS',409);
  return command(w.id,u,body,'RESCHEDULE',current=>{
   if(l.entity_type==='START'||l.entity_type==='FINAL')run(`UPDATE wf2_workflows SET ${l.entity_type==='START'?'start_at':'final_due_at'}=? WHERE id=?`,due,current.id);
   if(l.entity_type==='PHASE')run('UPDATE wf2_phases SET due_at=? WHERE id=?',due,l.entity_id);
   if(l.entity_type==='TASK')run('UPDATE wf2_tasks SET due_at=? WHERE id=?',due,l.entity_id);
   audit(current,u,'RESCHEDULE',l.entity_type,l.entity_id,{date:one('SELECT start_time FROM jobs WHERE id=?',jobId).start_time},{date:due},`Határidő újraütemezve: ${due}. ${reason}`);
  });
 }
 function completeJob(jobId,body,u){const l=link(jobId);if(!l)throw fault('WORKFLOW_CALENDAR_LINK_NOT_FOUND',404);requireRight(jobRights(jobId,u));
  if(l.entity_type==='PHASE')return closePhase(l.workflow_id,l.entity_id,body,u);
  if(l.entity_type==='TASK'){const t=task(l.entity_id);return completeTask(l.workflow_id,t.phase_id,t.id,body,u);}
  if(l.entity_type==='FINAL')return closeWorkflow(l.workflow_id,body,u);
  return command(l.workflow_id,u,body,'START',w=>{run("UPDATE jobs SET status='Completed' WHERE id=?",jobId);audit(w,u,'WORKFLOW_STARTED','WORKFLOW',w.id,null,{started:true});run("UPDATE jobs SET notes='WF2_STARTED' WHERE id=?",jobId);});
 }
 function purge(key,body,u){requireRight(superuser(u));return db.transaction(()=>{
  const keys=key?all('SELECT * FROM wf2_workflows WHERE id=?',key):all('SELECT * FROM wf2_workflows');
  const expected=key?`DELETE WORKFLOW ${key}`:'DELETE ALL WORKFLOWS';if(body.confirmation!==expected)throw fault('WORKFLOW_DELETE_CONFIRMATION_REQUIRED');
  for(const w of keys){custody(w);for(const l of all('SELECT * FROM wf2_calendar_links WHERE workflow_id=?',w.id)){const j=one('SELECT * FROM jobs WHERE id=?',l.job_id);run('INSERT OR IGNORE INTO workflow_retired_calendar_jobs(job_id,workflow_id,snapshot_json) VALUES(?,?,?)',l.job_id,w.id,JSON.stringify(j));run("DELETE FROM notification_snooze_log WHERE entity_type='CALENDAR_JOB' AND entity_id=?",l.job_id);}run("DELETE FROM notifications WHERE json_valid(metadata_json) AND json_extract(metadata_json,'$.wf2_workflow_id')=?",w.id);run('DELETE FROM wf2_workflows WHERE id=?',w.id);}
  return purgeWorkflowHistory({db,actor:u,workflowId:key||null,confirmation:expected});
 })();}
 function purgePreview(key,u){requireRight(superuser(u));return {workflows:key?1:one('SELECT COUNT(*) n FROM wf2_workflows').n,historical_workflows:workflowPurgePlan(db,key||null).sources.length};}
 function saveDefinitions(body,u){requireRight(admin(u));return db.transaction(()=>{
  const defs=definitions(),codes=new Set(defs.map(d=>d.code)),items=body.stages;if(!Array.isArray(items)||items.length!==7||new Set(items.map(d=>d.code)).size!==7||items.some(d=>!codes.has(d.code)))throw fault('WORKFLOW_SEVEN_PHASES_REQUIRED');
  if(new Set(items.map(d=>d.sort_order)).size!==7||items.some(d=>!Number.isInteger(d.sort_order)||d.sort_order<0||d.sort_order>6||!text(d.name_en,200)||!text(d.name_hu,200)||!/^#[0-9a-f]{6}$/i.test(d.color)||!['WAITING','IN_PROGRESS','BLOCKED'].includes(d.default_status)))throw fault('WORKFLOW_PHASE_SETTINGS_INVALID');
  for(const d of items){run('UPDATE workshop_phase_definitions SET name_en=?,name_hu=?,sort_order=?,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE code=?',text(d.name_en,200),text(d.name_hu,200),d.sort_order,u.id,d.code);run('INSERT INTO wf2_phase_options(code,color,required,enabled,default_status) VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET color=excluded.color,required=excluded.required,enabled=excluded.enabled,default_status=excluded.default_status',d.code,d.color,d.required&&d.enabled?1:0,d.enabled?1:0,d.default_status);run('UPDATE wf2_phases SET stage_order=?,name_snapshot_en=?,name_snapshot_hu=? WHERE stage_code=?',d.sort_order,d.name_en,d.name_hu,d.code);}
  if(!superuser(u))run("INSERT INTO audit_log(id,user_id,user_name,user_role,action,module,record_id,old_value,new_value,success,audit_type) VALUES(?,?,?,?,?,'workshop_workflow','PHASE_DEFINITIONS',?,?,1,'WORK')",id('AUD'),u.id,u.name,u.role,'PHASE_DEFINITIONS_UPDATED',JSON.stringify(defs),JSON.stringify(items));run("UPDATE wf2_workflows SET version=version+1,updated_at=CURRENT_TIMESTAMP WHERE status='ACTIVE'");return definitions();
 })();}
 return {create,update,detail,definitions,saveDefinitions,updatePhase,addPhase,saveTask,completeTask,deleteTask,saveCost,checklist,closePhase,closeWorkflow,deletePhase,addDocument,removeDocument,canDocument,link,jobRights,calendarRow,rescheduleJob,completeJob,purge,purgePreview,list,options:()=>({users:all("SELECT id,name,role FROM users WHERE status='Active' ORDER BY name"),clients:all('SELECT id,name FROM contacts ORDER BY name'),pianos:all('SELECT id,owner_contact_id,brand,model,serial_no,display_name FROM pianos ORDER BY brand,model'),client_pianos:all('SELECT client_id,piano_id FROM client_pianos'),partners:all("SELECT id,company_name FROM partners WHERE status='active' ORDER BY company_name"),stages:definitions()})};
}
module.exports={createWorkflowV2,localTime,admin,superuser};

"use strict";
// Phase I shell: phase configuration only; no operational workflow creation/details.
const {purgeWorkflowHistory,workflowPurgePlan}=require('./workflow-retirement');
const DEFAULT_STAGES=Object.freeze([
 ['INBOUND','Arrival & Intake Logistics','Beérkezés és Állapotrögzítés'],
 ['ASSESSMENT','Technical Assessment & Repair Plan','Részletes Műszaki Állapotfelmérés'],
 ['ACOUSTICS','Belly & Acoustic Restoration','Akusztikus Szerkezet és Hangszekrény'],
 ['MECHANICS','Action & Keyboard Restoration','Mechanika és Billentyűzet Felújítás'],
 ['VOICING','Regulation, Voicing & Tuning','Szabályozás, Intonálás és Hangolás'],
 ['FINISH','Cabinet & Finish Refinishing','Külső Bútorzat és Felületkezelés'],
 ['FINAL_HANDOVER','Final Quality Control & Delivery','Végső Minőségellenőrzés és Kiszállítás']
]);
function registerWorkshopWorkflowRoutes({app,db,auth,permit,requireSuperadmin,rid}) {
 const seed=db.prepare('INSERT OR IGNORE INTO workshop_phase_definitions(id,code,name_en,name_hu,sort_order,active,is_system) VALUES(?,?,?,?,?,1,1)');
 db.transaction(()=>DEFAULT_STAGES.forEach(([code,en,hu],i)=>{seed.run(`WSD-${code}`,code,en,hu,i);db.prepare('UPDATE workshop_phase_definitions SET active=1 WHERE code=?').run(code);}))();
 const definitions=()=>db.prepare(`SELECT * FROM workshop_phase_definitions WHERE code IN (${DEFAULT_STAGES.map(()=>'?').join(',')}) ORDER BY sort_order,id`).all(...DEFAULT_STAGES.map(([code])=>code));
 const failure=(res,e)=>res.status(e.status||400).json({error:e.code||e.message,details:e.details});
 app.get('/api/workshop-shell',auth,permit('ADMIN','MANAGER','WORKER'),(_req,res)=>res.json({phase:1,workflows:[],stages:definitions(),creation_enabled:false,details_enabled:false}));
 app.get('/api/workshop-shell/calendar',auth,permit('ADMIN','MANAGER','WORKER'),(_req,res)=>res.json([]));
 app.get('/api/workshop-shell/phases',auth,permit('ADMIN','MANAGER','WORKER'),(_req,res)=>res.json({stages:definitions()}));
 app.put('/api/workshop-shell/phases',auth,permit('ADMIN'),(req,res)=>{
  try {
   const items=req.body?.stages,codes=new Set(DEFAULT_STAGES.map(([code])=>code));
   if(!Array.isArray(items)||items.length!==7||new Set(items.map(s=>s.code)).size!==7||items.some(s=>!codes.has(s.code)))throw new Error('WORKFLOW_SEVEN_PHASES_REQUIRED');
   if(items.some(s=>!String(s.name_en||'').trim()||!String(s.name_hu||'').trim()||String(s.name_en).length>200||String(s.name_hu).length>200))throw new Error('WORKFLOW_PHASE_NAME_REQUIRED');
   if(items.some(s=>!Number.isInteger(s.sort_order)||s.sort_order<0||s.sort_order>6)||new Set(items.map(s=>s.sort_order)).size!==7)throw new Error('WORKFLOW_PHASE_ORDER_INVALID');
   db.transaction(()=>{
    const before=definitions(),update=db.prepare('UPDATE workshop_phase_definitions SET name_en=?,name_hu=?,sort_order=?,active=1,updated_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE code=?');
    for(const item of items)update.run(item.name_en.trim(),item.name_hu.trim(),item.sort_order,req.user.id,item.code);
    db.prepare("INSERT INTO audit_log(id,user_id,user_name,user_role,action,module,record_id,old_value,new_value,success,audit_type) VALUES(?,?,?,?,?,'workshop_workflow','PHASE_DEFINITIONS',?,?,1,'WORK')").run(rid('AUD'),req.user.id,req.user.name,req.user.role,'PHASE_DEFINITIONS_UPDATED',JSON.stringify(before),JSON.stringify(definitions()));
   })();res.json({stages:definitions()});
  }catch(e){failure(res,e);}
 });
 app.get('/api/workshop-shell/history',auth,permit('ADMIN','MANAGER','WORKER'),(req,res)=>{
  const date=String(req.query.date||'');
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'INVALID_DATE'});
  const workflows=db.prepare(`SELECT w.id,w.workflow_key,w.title,w.current_status,w.final_due_at,w.client_id,w.piano_id,c.name client_name,p.brand,p.model,p.serial_no
   FROM workflow_finance_sources w LEFT JOIN contacts c ON c.id=w.client_id LEFT JOIN pianos p ON p.id=w.piano_id
   WHERE (?='' OR substr(w.final_due_at,1,10)=?) ORDER BY w.final_due_at DESC,w.id`).all(date,date);
  res.json({workflows,historical:true});
 });
 app.get('/api/workshop-shell/purge-preview',auth,requireSuperadmin,(req,res)=>{
  try {const p=workflowPurgePlan(db,req.query.id?String(req.query.id):null);res.json({workflows:p.sources.length,phases:p.phases.length,invoices:p.invoices.length,financial_items:p.financial.length,journal_entries:p.journals.length,calendar_jobs:p.calendar.length});}catch(e){failure(res,e);}
 });
 app.post('/api/workshop-shell/purge',auth,requireSuperadmin,(req,res)=>{
  try{res.json(purgeWorkflowHistory({db,actor:req.user,workflowId:req.body?.workflow_id?String(req.body.workflow_id):null,confirmation:req.body?.confirmation}));}catch(e){failure(res,e);}
 });
 // Explicit Admin-only contract: no operational card exists during Phase I.
 app.delete('/api/workshop-shell/cards/:id',auth,permit('ADMIN'),(_req,res)=>res.status(404).json({error:'WORKFLOW_CARD_NOT_FOUND',phase:1}));
 app.get('/api/pianos/:pianoId/inspection-history',auth,permit('ADMIN','MANAGER','WORKER'),(req,res)=>res.json(db.prepare('SELECT * FROM piano_inspection_history WHERE piano_id=? ORDER BY inspected_at DESC,id DESC').all(req.params.pianoId)));
 for(const route of ['/api/workflows','/api/workflows/*','/api/workflow/stage-definitions','/api/workflow/inline-client-piano','/api/workflows-partners/options','/api/workshop/workflows/*','/api/jobs/:jobId/workshop-workflow'])app.all(route,auth,(_req,res)=>res.status(410).json({error:'WORKFLOW_PHASE_ONE_RETIRED',phase:1}));
}
module.exports={registerWorkshopWorkflowRoutes,DEFAULT_STAGES};

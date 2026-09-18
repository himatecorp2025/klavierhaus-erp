"use strict";
// Seven stable definitions remain; all operational writes have exactly one API.
const DEFAULT_STAGES=Object.freeze([
 ['INBOUND','Arrival & Intake Logistics','Beérkezés és Állapotrögzítés'],
 ['ASSESSMENT','Technical Assessment & Repair Plan','Részletes Műszaki Állapotfelmérés'],
 ['ACOUSTICS','Belly & Acoustic Restoration','Akusztikus Szerkezet és Hangszekrény'],
 ['MECHANICS','Action & Keyboard Restoration','Mechanika és Billentyűzet Felújítás'],
 ['VOICING','Regulation, Voicing & Tuning','Szabályozás, Intonálás és Hangolás'],
 ['FINISH','Cabinet & Finish Refinishing','Külső Bútorzat és Felületkezelés'],
 ['FINAL_HANDOVER','Final Quality Control & Delivery','Végső Minőségellenőrzés és Kiszállítás']
]);
function registerWorkshopWorkflowRoutes({app,db,auth,permit}) {
 const seed=db.prepare('INSERT OR IGNORE INTO workshop_phase_definitions(id,code,name_en,name_hu,sort_order,active,is_system) VALUES(?,?,?,?,?,1,1)');
 db.transaction(()=>DEFAULT_STAGES.forEach(([code,en,hu],i)=>seed.run(`WSD-${code}`,code,en,hu,i)))();
 const definitions=()=>db.prepare(`SELECT * FROM workshop_phase_definitions WHERE is_system=1 ORDER BY sort_order,id`).all();
 app.use('/api/workshop-shell',auth,(req,res,next)=>{
  if(['POST','PUT','PATCH','DELETE'].includes(req.method))return res.status(410).json({error:'WORKFLOW_USE_V2_API'});
  next();
 });
 app.get('/api/workshop-shell',auth,permit('ADMIN','MANAGER','WORKER'),(_req,res)=>res.json({contract:'UI12',workflows:[],stages:definitions(),replacement:'/api/workshop/v2/workflows'}));
 app.get('/api/workshop-shell/phases',auth,permit('ADMIN','MANAGER','WORKER'),(_req,res)=>res.json({stages:definitions()}));
 app.get('/api/workshop-shell/calendar',auth,permit('ADMIN','MANAGER','WORKER'),(_req,res)=>res.json([]));
 app.get('/api/workshop-shell/history',auth,permit('ADMIN','MANAGER','WORKER'),(req,res)=>{
  const date=String(req.query.date||'');
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:'INVALID_DATE'});
  res.json({historical:true,workflows:db.prepare(`SELECT w.id,w.workflow_key,w.title,w.current_status,w.final_due_at,w.client_id,w.piano_id,c.name client_name,p.brand,p.model,p.serial_no
   FROM workflow_finance_sources w LEFT JOIN contacts c ON c.id=w.client_id LEFT JOIN pianos p ON p.id=w.piano_id
   WHERE (?='' OR substr(w.final_due_at,1,10)=?) ORDER BY w.final_due_at DESC,w.id`).all(date,date)});
 });
 app.get('/api/workshop-shell/purge-preview',auth,(_req,res)=>res.status(410).json({error:'WORKFLOW_USE_V2_API'}));
 app.get('/api/pianos/:pianoId/inspection-history',auth,permit('ADMIN','MANAGER','WORKER'),(req,res)=>res.json(db.prepare('SELECT * FROM piano_inspection_history WHERE piano_id=? ORDER BY inspected_at DESC,id DESC').all(req.params.pianoId)));
 for(const route of ['/api/workflows','/api/workflows/*','/api/workflow/stage-definitions','/api/workflow/inline-client-piano','/api/workflows-partners/options','/api/workshop/workflows/*','/api/jobs/:jobId/workshop-workflow'])
  app.all(route,auth,(_req,res)=>res.status(410).json({error:'WORKFLOW_LEGACY_RETIRED',replacement:'/api/workshop/v2/workflows'}));
}
module.exports={registerWorkshopWorkflowRoutes,DEFAULT_STAGES};

"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),multer=require('multer');
const {createWorkflowV2}=require('./workflow-v2');
function registerWorkflowV2({app,db,auth,permit,invoiceEngine}){
 const engine=createWorkflowV2({db,invoiceEngine}),base='/api/workshop/v2';
 const documentsDir=path.join(path.dirname(db.name),'workflow-documents-v2');fs.mkdirSync(documentsDir,{recursive:true});
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:10}}).single('file');
 const wrap=fn=>(req,res)=>{try{const result=fn(req,res);if(result!==undefined&&!res.headersSent)res.json(result);}catch(e){res.status(e.status||400).json({error:e.code||e.message,details:e.details});}};
 const p=req=>[req.params.id,req.params.phaseId],body=req=>req.body||{};
 app.use(base,auth,permit('ADMIN','MANAGER','WORKER'));
 app.get(`${base}/options`,wrap(()=>engine.options()));
 app.get(`${base}/phases`,wrap(()=>({stages:engine.definitions()})));
 app.put(`${base}/phases`,wrap(req=>({stages:engine.saveDefinitions(body(req),req.user)})));
 app.get(`${base}/workflows`,wrap(req=>({workflows:engine.list(req.user,req.query.status==='COMPLETED'?'COMPLETED':'ACTIVE'),stages:engine.definitions()})));
 app.post(`${base}/workflows`,wrap(req=>engine.create(body(req),req.user)));
 app.get(`${base}/workflows/:id`,wrap(req=>engine.detail(req.params.id,req.user)));
 app.put(`${base}/workflows/:id/schedule`,wrap(req=>engine.updateSchedule(req.params.id,body(req),req.user)));
 app.put(`${base}/workflows/:id`,wrap(req=>engine.update(req.params.id,body(req),req.user)));
 app.post(`${base}/workflows/:id/close`,wrap(req=>engine.closeWorkflow(req.params.id,body(req),req.user)));
 app.post(`${base}/workflows/:id/reopen`,wrap(req=>engine.reopenWorkflow(req.params.id,body(req),req.user)));
 app.post(`${base}/workflows/:id/abort`,wrap(req=>engine.abandonWorkflow(req.params.id,body(req),req.user,false)));
 app.delete(`${base}/workflows/:id`,wrap(req=>engine.abandonWorkflow(req.params.id,body(req),req.user,true)));
 app.post(`${base}/workflows/:id/phases/:code/create`,wrap(req=>engine.addPhase(req.params.id,req.params.code,body(req),req.user)));
 app.put(`${base}/workflows/:id/phases/:phaseId`,wrap(req=>engine.updatePhase(...p(req),body(req),req.user)));
 app.post(`${base}/workflows/:id/phases/:phaseId/close`,wrap(req=>engine.closePhase(...p(req),body(req),req.user)));
 app.post(`${base}/workflows/:id/phases/:phaseId/reopen`,wrap(req=>engine.reopenPhase(...p(req),body(req),req.user)));
 app.delete(`${base}/workflows/:id/phases/:phaseId`,wrap(req=>{
  const files=db.prepare('SELECT stored_name FROM wf2_documents WHERE phase_id=?').all(req.params.phaseId);
  const result=engine.deletePhase(...p(req),body(req),req.user);
  for(const f of files)if(!db.prepare("SELECT 1 FROM wf2_documents WHERE stored_name=?").get(f.stored_name))fs.rmSync(path.join(documentsDir,path.basename(f.stored_name)),{force:true});return result;
 }));
 app.post(`${base}/workflows/:id/phases/:phaseId/tasks`,wrap(req=>engine.saveTask(...p(req),null,body(req),req.user)));
 app.put(`${base}/workflows/:id/phases/:phaseId/tasks/:taskId`,wrap(req=>engine.saveTask(...p(req),req.params.taskId,body(req),req.user)));
 app.post(`${base}/workflows/:id/phases/:phaseId/tasks/:taskId/complete`,wrap(req=>engine.completeTask(...p(req),req.params.taskId,body(req),req.user)));
 app.post(`${base}/workflows/:id/phases/:phaseId/tasks/:taskId/reopen`,wrap(req=>engine.reopenTask(...p(req),req.params.taskId,body(req),req.user)));
 app.delete(`${base}/workflows/:id/phases/:phaseId/tasks/:taskId`,wrap(req=>{
  const files=db.prepare('SELECT stored_name FROM wf2_documents WHERE task_id=? AND phase_id=?').all(req.params.taskId,req.params.phaseId);
  const result=engine.deleteTask(...p(req),req.params.taskId,body(req),req.user);
  for(const f of files)if(!db.prepare("SELECT 1 FROM wf2_documents WHERE stored_name=?").get(f.stored_name))fs.rmSync(path.join(documentsDir,path.basename(f.stored_name)),{force:true});return result;
 }));
 app.post(`${base}/workflows/:id/phases/:phaseId/costs`,wrap(req=>engine.saveCost(...p(req),null,body(req),req.user)));
 app.post(`${base}/workflows/:id/phases/:phaseId/costs/:costId/approve`,wrap(req=>engine.approveCost(...p(req),req.params.costId,body(req),req.user)));
 app.put(`${base}/workflows/:id/phases/:phaseId/costs/:costId`,wrap(req=>engine.saveCost(...p(req),req.params.costId,body(req),req.user)));
 app.delete(`${base}/workflows/:id/phases/:phaseId/costs/:costId`,wrap(req=>engine.saveCost(...p(req),req.params.costId,body(req),req.user,true)));
 app.post(`${base}/workflows/:id/phases/:phaseId/checklist`,wrap(req=>engine.checklist(...p(req),null,body(req),req.user)));
 app.put(`${base}/workflows/:id/phases/:phaseId/checklist/:itemId`,wrap(req=>engine.checklist(...p(req),req.params.itemId,body(req),req.user)));
 app.delete(`${base}/workflows/:id/phases/:phaseId/checklist/:itemId`,wrap(req=>engine.checklist(...p(req),req.params.itemId,body(req),req.user,true)));
 app.post(`${base}/workflows/:id/phases/:phaseId/documents`,(req,res)=>upload(req,res,error=>{
  if(error)return res.status(400).json({error:error.code||'WORKFLOW_DOCUMENT_INVALID'});
  wrap(()=>{
   engine.canDocument(...p(req),req.body.task_id||null,req.user);
   const file=req.file;if(!file?.size)throw new Error('WORKFLOW_DOCUMENT_REQUIRED');
   const ext=path.extname(file.originalname).toLowerCase(),buffer=file.buffer;
   const allowed={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.txt':'text/plain','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};
   const valid=ext==='.pdf'?buffer.subarray(0,5).toString()==='%PDF-':ext==='.png'?buffer.subarray(0,8).toString('hex')==='89504e470d0a1a0a':['.jpg','.jpeg'].includes(ext)?buffer[0]===255&&buffer[1]===216:ext==='.txt'?!buffer.includes(0):['.docx','.xlsx'].includes(ext)?buffer.subarray(0,4).toString('hex')==='504b0304':false;
   if(!allowed[ext]||!valid)throw new Error('WORKFLOW_DOCUMENT_TYPE_INVALID');
   const name=`${crypto.randomUUID()}${ext}`,filePath=path.join(documentsDir,name);fs.writeFileSync(filePath,buffer,{flag:'wx'});
   try{return engine.addDocument(...p(req),body(req),{original_name:path.basename(file.originalname),stored_name:name,mime_type:allowed[ext],size_bytes:file.size,sha256:crypto.createHash('sha256').update(buffer).digest('hex')},req.user);}catch(e){fs.unlinkSync(filePath);throw e;}
  })(req,res);
 }));
 app.get(`${base}/documents/:docId`,wrap((req,res)=>{
  const d=db.prepare('SELECT * FROM wf2_documents WHERE id=?').get(req.params.docId);if(!d)return res.status(404).json({error:'WORKFLOW_DOCUMENT_NOT_FOUND'});
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','private, no-store');res.download(path.join(documentsDir,path.basename(d.stored_name)),d.original_name);
 }));
 app.delete(`${base}/workflows/:id/phases/:phaseId/documents/:docId`,wrap(req=>{
  const doc=db.prepare('SELECT * FROM wf2_documents WHERE id=? AND phase_id=?').get(req.params.docId,req.params.phaseId);
  const result=engine.removeDocument(...p(req),req.params.docId,body(req),req.user);if(doc)fs.rmSync(path.join(documentsDir,path.basename(doc.stored_name)),{force:true});return result;
 }));
 app.get(`${base}/purge-preview`,wrap(req=>engine.purgePreview(req.query.id||null,req.user)));
 // Compatibility endpoint is now a loss-posting soft delete. Retain attachments,
 // invoices, journals and the audit trail along with the retained workflow rows.
 app.post(`${base}/purge`,wrap(req=>engine.purge(req.body.workflow_id||null,body(req),req.user)));
 // Calendar writes must use the same per-entity authorization as the details UI.
 app.use('/api/jobs',auth,(req,res,next)=>{
  if(!['POST','PUT','PATCH','DELETE'].includes(req.method))return next();
  const match=req.path.match(/^\/([^/]+)(?:\/(.*))?$/);if(!match)return next();
  const job=db.prepare('SELECT id FROM jobs WHERE id=? OR job_key=?').get(match[1],match[1]);if(!job)return next();
  if(engine.retiredJob(job.id))return res.status(409).json({error:'WORKFLOW_RETIRED_CALENDAR_JOB'});
  if(!engine.link(job.id))return next();
  wrap(()=>{
   if((req.method==='PATCH'&&match[2]==='schedule')||(req.method==='PUT'&&!match[2])){
    if(!req.body.start_time)throw new Error('WORKFLOW_USE_DETAILS');
    engine.rescheduleJob(job.id,body(req),req.user);return engine.calendarRow(db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id),req.user);
   }
   if(req.method==='POST'&&match[2]==='close')return engine.completeJob(job.id,body(req),req.user);
   return res.status(409).json({error:'WORKFLOW_USE_DETAILS'});
  })(req,res);
 });
 return engine;
}
module.exports={registerWorkflowV2};

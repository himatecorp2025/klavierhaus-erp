"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const multer=require("multer");
const {LETTER,createPdf,textCommand,safeText}=require("./document-pdf");

const CATEGORIES=new Set(["deleted_invoice","financial_document","contract","intake_assessment","exported_report","internal_correspondence","company_message","company_document"]);
const SYSTEM_ONLY_CATEGORIES=new Set(["deleted_invoice","intake_assessment"]);
const EXTENSIONS=new Set([".pdf",".doc",".docx",".xls",".xlsx",".csv",".txt",".jpg",".jpeg",".png",".webp",".gif"]);
const MIMES=new Set([
  "application/pdf","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv","text/plain","image/jpeg","image/png","image/webp","image/gif"
]);
function text(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function integerId(value){const n=Number(value);return Number.isSafeInteger(n)&&n>0?n:null;}
function json(value){try{return JSON.parse(String(value||"{}"));}catch(_error){return {};}}
function problem(code,status=400){const e=new Error(code);e.status=status;return e;}
function respond(res,error){res.status(Number(error?.status||400)).json({error:error?.message||"ARCHIVE_REQUEST_FAILED"});}
function money(value){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(value||0));}
function clip(value,max=92){const source=safeText(value);return source.length>max?source.slice(0,max-1)+"…":source;}
function intakeAssessmentPdf({lead,items=[]}){
  const BLACK="0.10 0.10 0.10",MUTED="0.38 0.38 0.38",BLUE="0.10 0.32 0.72";
  const chunks=[];for(let i=0;i<Math.max(1,items.length);i+=14)chunks.push(items.slice(i,i+14));if(!chunks.length)chunks.push([]);
  const labels=[lead.client_name,lead.raw_client_name,lead.reported_issue,lead.piano_brand,lead.piano_model,...items.flatMap(row=>[row.item_title_en,row.item_title_hu])];
  const pages=chunks.map((chunk,pageIndex)=>()=>{let y=742,out="";
    out+=textCommand("KLAVIERHAUS · INTAKE ASSESSMENT",48,y,16,BLUE,{bold:true});y-=28;
    out+=textCommand(`Assessment #${lead.id} · page ${pageIndex+1}/${chunks.length}`,48,y,9,MUTED);y-=28;
    if(pageIndex===0){
      const client=lead.client_name||lead.raw_client_name||"New prospect",piano=[lead.piano_brand,lead.piano_model,lead.piano_serial_number].filter(Boolean).join(" · ")||"Not specified";
      for(const [label,value] of [["Client",client],["Piano",piano],["Service location",lead.service_location],["Urgency",lead.estimated_urgency],["Created",lead.created_at],["Assigned",lead.technician_name||"Unassigned"]]){
        out+=textCommand(label.toUpperCase(),48,y,7,MUTED);out+=textCommand(clip(value,72),160,y,10,BLACK);y-=20;
      }
      y-=6;out+=textCommand("REQUEST / ISSUE",48,y,8,MUTED);y-=18;
      const issue=safeText(lead.reported_issue||"");for(let i=0;i<issue.length;i+=82){out+=textCommand(clip(issue.slice(i,i+82),82),48,y,9,BLACK);y-=16;}y-=10;
      out+=textCommand("SELECTED WORK",48,y,9,BLUE,{bold:true});y-=22;
    }else{out+=textCommand("SELECTED WORK · CONTINUED",48,y,9,BLUE,{bold:true});y-=22;}
    if(!chunk.length){out+=textCommand("No assessment items selected.",48,y,9,MUTED);y-=18;}
    chunk.forEach((row,index)=>{const title=row.item_title_en||row.item_title_hu||`Item ${index+1}`;out+=textCommand(clip(title,66),48,y,9,BLACK);out+=textCommand(money(row.price),460,y,9,BLACK,{bold:true});y-=18;if(row.notes){out+=textCommand(clip(row.notes,80),64,y,8,MUTED);y-=15;}});
    if(pageIndex===chunks.length-1){y-=12;out+=textCommand("ESTIMATED TOTAL",48,y,9,MUTED);out+=textCommand(money(lead.estimated_total),430,y,13,BLUE,{bold:true});y-=26;out+=textCommand(`Media attachments: ${Array.isArray(lead.media_urls)?lead.media_urls.length:0}`,48,y,8,MUTED);}
    return out;
  });
  return createPdf({pages,size:LETTER,labels,title:`Klavierhaus Intake Assessment ${lead.id}`});
}

function registerArchiveCenterRoutes({app,db,auth,permit,audit,uploadDir,transactionalEmail,notifications=null}){
  const admin=permit("ADMIN");
  const staff=permit("ADMIN","MANAGER","WORKER");
  const target=path.join(uploadDir,"archive");
  fs.mkdirSync(target,{recursive:true});
  const upload=multer({
    storage:multer.diskStorage({
      destination:(_req,_file,cb)=>cb(null,target),
      filename:(_req,file,cb)=>{
        const ext=path.extname(file.originalname||"").toLowerCase();
        cb(null,`archive-${Date.now()}-${crypto.randomBytes(8).toString("hex")}${EXTENSIONS.has(ext)?ext:""}`);
      }
    }),
    limits:{fileSize:50*1024*1024,files:1},
    fileFilter:(_req,file,cb)=>{
      const ext=path.extname(file.originalname||"").toLowerCase(),mime=String(file.mimetype||"").toLowerCase();
      const ok=EXTENSIONS.has(ext)&&MIMES.has(mime);cb(ok?null:new Error("INVALID_ARCHIVE_FILE_TYPE"),ok);
    }
  }).single("file");

  const select=`SELECT a.*,u.name archived_by_name FROM document_archive a LEFT JOIN users u ON u.id=a.archived_by_user_id`;
  function assessmentSource(id){
    const lead=db.prepare(`SELECT l.*,c.name client_name,c.email client_email,c.phone client_phone,c.preferred_language client_preferred_language,
      p.brand piano_brand,p.model piano_model,p.serial_number piano_serial_number,u.name technician_name
      FROM intake_leads l LEFT JOIN clients c ON c.id=l.client_id LEFT JOIN pianos p ON p.id=l.piano_id
      LEFT JOIN users u ON u.id=l.assigned_technician_id WHERE l.id=?`).get(id);
    if(!lead)throw problem("INTAKE_NOT_FOUND",404);
    lead.media_urls=json(lead.media_urls||"[]");
    const items=db.prepare("SELECT * FROM intake_assessment_items WHERE intake_id=? ORDER BY sort_order,id").all(id);
    return {lead,items};
  }
  function createAssessmentArtifact(id,actor){
    const {lead,items}=assessmentSource(id);
    const pdf=intakeAssessmentPdf({lead,items}),filename=`intake-assessment-${id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`,filePath=path.join(target,filename);
    fs.writeFileSync(filePath,pdf,{flag:"wx"});
    const publicPath=`/uploads/archive/${filename}`,snapshot={source:"intake_assessment_export",intake:lead,items};
    const info=db.prepare(`INSERT INTO document_archive(category,title,description,entity_type,entity_id,original_name,stored_name,mime_type,size_bytes,file_path,metadata_json,archived_by_user_id)
      VALUES('intake_assessment',?,?,?,?,?,?,?,?,?,?,?)`).run(
      `Intake Assessment #${id} · ${lead.client_name||lead.raw_client_name||"Prospect"}`,lead.reported_issue||null,"intake",String(id),
      `intake-assessment-${id}.pdf`,filename,"application/pdf",pdf.length,publicPath,JSON.stringify(snapshot),actor?.id||null
    );
    return {lead,items,pdf,publicPath,archiveId:Number(info.lastInsertRowid)};
  }

  app.get("/api/archive/documents",auth,admin,(req,res)=>{
    try{
      const category=text(req.query.category,80),q=text(req.query.q,240).toLowerCase(),like=`%${q}%`;
      if(category&&!CATEGORIES.has(category))throw problem("INVALID_ARCHIVE_CATEGORY");
      const rows=db.prepare(`${select} WHERE (?='' OR a.category=?) AND (?='' OR lower(a.title) LIKE ? OR lower(COALESCE(a.description,'')) LIKE ? OR lower(COALESCE(a.original_name,'')) LIKE ? OR lower(COALESCE(a.entity_id,'')) LIKE ?)
        ORDER BY a.archived_at DESC,a.id DESC`).all(category,category,q,like,like,like,like)
        .map(row=>({...row,metadata:json(row.metadata_json)}));
      res.json({categories:[...CATEGORIES],rows});
    }catch(error){respond(res,error);}
  });

  app.get("/api/archive/documents/:id",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),row=id&&db.prepare(`${select} WHERE a.id=?`).get(id);
    if(!row)return res.status(404).json({error:"ARCHIVE_DOCUMENT_NOT_FOUND"});
    res.json({...row,metadata:json(row.metadata_json)});
  });

  app.post("/api/archive/documents",auth,admin,(req,res)=>{
    upload(req,res,error=>{
      if(error)return respond(res,error);
      try{
        const category=text(req.body?.category,80),title=text(req.body?.title,300),description=text(req.body?.description,5000);
        if(!CATEGORIES.has(category)||SYSTEM_ONLY_CATEGORIES.has(category))throw problem("INVALID_ARCHIVE_CATEGORY");
        if(!title)throw problem("ARCHIVE_TITLE_REQUIRED");
        const file=req.file||null,publicPath=file?`/uploads/archive/${path.basename(file.path)}`:null;
        const info=db.prepare(`INSERT INTO document_archive(category,title,description,original_name,stored_name,mime_type,size_bytes,file_path,metadata_json,archived_by_user_id)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(category,title,description||null,file?.originalname||null,file?path.basename(file.path):null,file?.mimetype||null,file?.size||null,publicPath,JSON.stringify({source:"manual"}),req.user.id);
        const row=db.prepare(`${select} WHERE a.id=?`).get(Number(info.lastInsertRowid));
        audit(req,"CREATE","document_archive",String(row.id),null,row);
        res.status(201).json({...row,metadata:json(row.metadata_json)});
      }catch(e){
        if(req.file){try{fs.unlinkSync(req.file.path);}catch(_error){}}
        respond(res,e);
      }
    });
  });

  app.post("/api/intake/:id/export-pdf",auth,staff,(req,res)=>{
    try{
      const id=integerId(req.params.id);if(!id)throw problem("INTAKE_NOT_FOUND",404);
      const artifact=createAssessmentArtifact(id,req.user);
      audit(req,"EXPORT_PDF","intake",String(id),null,{archive_document_id:artifact.archiveId,file_path:artifact.publicPath});
      res.setHeader("X-Archive-Document-Id",String(artifact.archiveId));
      res.type("application/pdf").set("Content-Disposition",`attachment; filename="intake-assessment-${id}.pdf"`).send(artifact.pdf);
    }catch(error){respond(res,error);}
  });

  app.get("/api/intake/:id/assessment-email-log",auth,staff,(req,res)=>{
    const id=integerId(req.params.id);if(!id||!db.prepare("SELECT 1 FROM intake_leads WHERE id=?").get(id))return res.status(404).json({error:"INTAKE_NOT_FOUND"});
    res.json(db.prepare("SELECT * FROM intake_assessment_email_log WHERE intake_id=? ORDER BY created_at DESC,id DESC").all(id));
  });

  app.post("/api/intake/:id/send-assessment",auth,staff,async(req,res)=>{
    const id=integerId(req.params.id);if(!id)return res.status(404).json({error:"INTAKE_NOT_FOUND"});
    let artifact=null,recipient="",language="en",customMessage=text(req.body?.message,3000),attachPdf=req.body?.attach_pdf!==false;
    try{
      const source=assessmentSource(id),lead=source.lead;
      recipient=text(req.body?.recipient_email||lead.client_email||(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(lead.raw_contact||"").trim())?lead.raw_contact:""),320).toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))throw problem("CLIENT_EMAIL_REQUIRED",409);
      language=["en","hu"].includes(req.body?.language)?req.body.language:(lead.client_preferred_language||"en");
      artifact=createAssessmentArtifact(id,req.user);
      const delivery=await transactionalEmail.sendIntakeAssessment({
        to:recipient,clientName:artifact.lead.client_name||artifact.lead.raw_client_name,
        piano:{brand:artifact.lead.piano_brand,model:artifact.lead.piano_model,serial_number:artifact.lead.piano_serial_number},
        issue:artifact.lead.reported_issue,items:artifact.items,estimatedTotal:artifact.lead.estimated_total,
        assessmentPdf:attachPdf?artifact.pdf:null,customMessage,language,
        idempotencyKey:`intake-assessment-${id}-archive-${artifact.archiveId}`
      });
      db.transaction(()=>{
        db.prepare(`INSERT INTO intake_assessment_email_log(intake_id,archive_document_id,recipient,language,custom_message,status,provider_message_id,sent_by_user_id)
          VALUES(?,?,?,?,?,'sent',?,?)`).run(id,artifact.archiveId,recipient,language,customMessage||null,delivery.providerMessageId,req.user.id);
        if(artifact.lead.client_id)db.prepare("UPDATE clients SET preferred_language=?,email=COALESCE(NULLIF(email,''),?),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(language,recipient,artifact.lead.client_id);
        db.prepare("UPDATE intake_leads SET status=CASE WHEN status='new' THEN 'under_review' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      })();
      audit(req,"SEND_ASSESSMENT","intake",String(id),null,{archive_document_id:artifact.archiveId,recipient,language,provider_message_id:delivery.providerMessageId});
      res.status(201).json({ok:true,archive_document_id:artifact.archiveId,recipient,language,provider_message_id:delivery.providerMessageId});
    }catch(error){
      if(id&&recipient){
        try{db.prepare(`INSERT INTO intake_assessment_email_log(intake_id,archive_document_id,recipient,language,custom_message,status,error_code,sent_by_user_id)
          VALUES(?,?,?,?,?,'failed',?,?)`).run(id,artifact?.archiveId||null,recipient,language,customMessage||null,text(error?.code||error?.message,120),req.user?.id||null);}catch(_logError){}
      }
      if(notifications){
        try{
          const recipients=db.prepare("SELECT id FROM users WHERE status='Active' AND (role='ADMIN' OR role='SUPERADMIN' OR is_superadmin=1)").all().map(row=>row.id);
          if(recipients.length)notifications.emitOnce({
            category:"DELIVERY_EXCEPTION",entityType:"INTAKE",entityId:String(id),
            titleEn:"Assessment delivery failed",titleHu:"Az igényfelmérés küldése sikertelen",
            bodyEn:`Intake #${id} · ${text(error?.code||error?.message,180)}`,
            bodyHu:`Igény #${id} · ${text(error?.code||error?.message,180)}`,
            actionUrl:"#intake",severity:"URGENT",recipients
          });
        }catch(_notificationError){}
      }
      respond(res,error);
    }
  });

  app.get("/api/archive/documents/:id/download",auth,admin,(req,res)=>{
    const id=integerId(req.params.id),row=id&&db.prepare("SELECT * FROM document_archive WHERE id=?").get(id);
    if(!row||!row.file_path)return res.status(404).json({error:"ARCHIVE_FILE_NOT_FOUND"});
    const rel=String(row.file_path).replace(/^\/uploads\//,"");
    const candidate=path.resolve(uploadDir,rel),root=path.resolve(uploadDir)+path.sep;
    if(!candidate.startsWith(root)||!fs.existsSync(candidate))return res.status(404).json({error:"ARCHIVE_FILE_NOT_FOUND"});
    res.download(candidate,row.original_name||path.basename(candidate));
  });
}

module.exports={registerArchiveCenterRoutes};

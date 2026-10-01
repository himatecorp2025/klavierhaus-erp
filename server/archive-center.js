"use strict";

const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const multer=require("multer");
const {LETTER,createPdf,textCommand,safeText}=require("./document-pdf");

const CATEGORIES=new Set(["deleted_invoice","deleted_intake","deleted_client","financial_document","contract","intake_assessment","exported_report","internal_correspondence","company_message","company_document"]);
const SYSTEM_ONLY_CATEGORIES=new Set(["deleted_invoice","deleted_intake","deleted_client","intake_assessment"]);
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
  const tableExists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?").get(name));
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

  function deleteIntakeToArchive(id,actor,reason=""){
    const {lead,items}=assessmentSource(id);
    const emailLog=tableExists("intake_assessment_email_log")?db.prepare("SELECT * FROM intake_assessment_email_log WHERE intake_id=? ORDER BY created_at,id").all(id):[];
    const linkedJobs=tableExists("jobs")?db.prepare("SELECT id,job_code,title,stage,cancelled_at,completed_at FROM jobs WHERE intake_id=? ORDER BY id").all(id):[];
    const pdf=intakeAssessmentPdf({lead,items});
    const filename=`deleted-intake-${id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`;
    const filePath=path.join(target,filename);
    fs.writeFileSync(filePath,pdf,{flag:"wx"});
    const publicPath=`/uploads/archive/${filename}`;
    const snapshot={source:"deleted_intake",deleted_at:new Date().toISOString(),deleted_by_user_id:actor?.id||null,reason:text(reason,3000),intake:lead,items,email_log:emailLog,linked_jobs:linkedJobs};
    try{
      const archived=db.transaction(()=>{
        const info=db.prepare(`INSERT INTO document_archive(category,title,description,entity_type,entity_id,original_name,stored_name,mime_type,size_bytes,file_path,metadata_json,archived_by_user_id)
          VALUES('deleted_intake',?,?,?,?,?,?,?,?,?,?,?)`).run(
          `Deleted Intake #${id} · ${lead.client_name||lead.raw_client_name||"Prospect"}`,
          text(reason,3000)||lead.reported_issue||null,"intake",String(id),`deleted-intake-${id}.pdf`,filename,"application/pdf",pdf.length,publicPath,JSON.stringify(snapshot),actor?.id||null
        );
        // Detach converted jobs explicitly so deletion works against legacy production schemas too.
        if(tableExists("jobs"))db.prepare("UPDATE jobs SET intake_id=NULL WHERE intake_id=?").run(id);
        if(tableExists("intake_assessment_email_log"))db.prepare("DELETE FROM intake_assessment_email_log WHERE intake_id=?").run(id);
        if(tableExists("intake_assessment_items"))db.prepare("DELETE FROM intake_assessment_items WHERE intake_id=?").run(id);
        const deleted=db.prepare("DELETE FROM intake_leads WHERE id=?").run(id);
        if(Number(deleted.changes)!==1)throw problem("INTAKE_DELETE_FAILED",409);
        return db.prepare(`${select} WHERE a.id=?`).get(Number(info.lastInsertRowid));
      })();
      return {...archived,metadata:snapshot};
    }catch(error){try{fs.unlinkSync(filePath);}catch(_error){}throw error;}
  }

  function clientArchiveSource(id){
    const client=db.prepare("SELECT * FROM clients WHERE id=? AND deleted_at IS NULL").get(id);
    if(!client)throw problem("CLIENT_NOT_FOUND",404);
    const pianos=tableExists("pianos")?db.prepare("SELECT * FROM pianos WHERE client_id=? ORDER BY id").all(id):[];
    const jobs=tableExists("jobs")?db.prepare("SELECT id,job_code,title,stage,scheduled_at,completed_at,cancelled_at,piano_id,created_at FROM jobs WHERE client_id=? ORDER BY id").all(id):[];
    const invoices=tableExists("invoices")?db.prepare("SELECT id,invoice_number,status,total_amount,issue_date,due_date,paid_at,job_id FROM invoices WHERE client_id=? ORDER BY id").all(id):[];
    const intakes=tableExists("intake_leads")?db.prepare("SELECT id,piano_id,raw_client_name,raw_contact,reported_issue,status,created_at,converted_at FROM intake_leads WHERE client_id=? ORDER BY id").all(id):[];
    const source_refs=tableExists("master_data_client_source_map")?db.prepare("SELECT source_name,source_client_id,updated_at FROM master_data_client_source_map WHERE client_id=? ORDER BY source_name,source_client_id").all(id):[];
    return {client,pianos,jobs,invoices,intakes,source_refs};
  }
  function clientRelationManifest(clientId){
    const byId={};
    for(const table of ["customer_conversations","private_appointments","private_appointment_requests","pianos","client_piano_review_queue","intake_leads","jobs","invoices","customer_communication_log"]){
      if(!tableExists(table))continue;
      const columns=new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(row=>row.name));
      if(!columns.has("client_id")||!columns.has("id"))continue;
      byId[table]=db.prepare(`SELECT id FROM "${table}" WHERE client_id=? ORDER BY id`).all(clientId).map(row=>row.id);
    }
    const sourceRefs=tableExists("master_data_client_source_map")?db.prepare("SELECT source_name,source_client_id FROM master_data_client_source_map WHERE client_id=? ORDER BY source_name,source_client_id").all(clientId):[];
    const importRows=tableExists("master_data_import_rows")?db.prepare("SELECT source_name,source_instrument_id FROM master_data_import_rows WHERE client_id=? ORDER BY source_name,source_instrument_id").all(clientId):[];
    const sourceRows=tableExists("master_data_source_rows")?db.prepare("SELECT source_name,source_row_number FROM master_data_source_rows WHERE client_id=? ORDER BY source_name,source_row_number").all(clientId):[];
    return {by_id:byId,source_refs:sourceRefs,import_rows:importRows,source_rows:sourceRows};
  }
  function transferClientRelations(fromId,toId){
    const manifest=clientRelationManifest(fromId);
    for(const table of Object.keys(manifest.by_id)){
      db.prepare(`UPDATE "${table}" SET client_id=? WHERE client_id=?`).run(toId,fromId);
    }
    if(tableExists("master_data_client_source_map"))db.prepare("UPDATE master_data_client_source_map SET client_id=?,updated_at=CURRENT_TIMESTAMP WHERE client_id=?").run(toId,fromId);
    if(tableExists("master_data_import_rows"))db.prepare("UPDATE master_data_import_rows SET client_id=?,updated_at=CURRENT_TIMESTAMP WHERE client_id=?").run(toId,fromId);
    if(tableExists("master_data_source_rows"))db.prepare("UPDATE master_data_source_rows SET client_id=?,updated_at=CURRENT_TIMESTAMP WHERE client_id=?").run(toId,fromId);
    return manifest;
  }
  function restoreTransferredRelations(manifest,fromPrimaryId,toRestoredId){
    for(const [table,ids] of Object.entries(manifest?.by_id||{})){
      if(!tableExists(table)||!Array.isArray(ids)||!ids.length)continue;
      const columns=new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(row=>row.name));
      if(!columns.has("client_id")||!columns.has("id"))continue;
      const update=db.prepare(`UPDATE "${table}" SET client_id=? WHERE id=? AND client_id=?`);
      for(const rowId of ids)update.run(toRestoredId,rowId,fromPrimaryId);
    }
    if(tableExists("master_data_client_source_map")){
      const update=db.prepare("UPDATE master_data_client_source_map SET client_id=?,updated_at=CURRENT_TIMESTAMP WHERE source_name=? AND source_client_id=? AND client_id=?");
      for(const row of manifest?.source_refs||[])update.run(toRestoredId,row.source_name,row.source_client_id,fromPrimaryId);
    }
    if(tableExists("master_data_import_rows")){
      const update=db.prepare("UPDATE master_data_import_rows SET client_id=?,updated_at=CURRENT_TIMESTAMP WHERE source_name=? AND source_instrument_id=? AND client_id=?");
      for(const row of manifest?.import_rows||[])update.run(toRestoredId,row.source_name,row.source_instrument_id,fromPrimaryId);
    }
    if(tableExists("master_data_source_rows")){
      const update=db.prepare("UPDATE master_data_source_rows SET client_id=?,updated_at=CURRENT_TIMESTAMP WHERE source_name=? AND source_row_number=? AND client_id=?");
      for(const row of manifest?.source_rows||[])update.run(toRestoredId,row.source_name,row.source_row_number,fromPrimaryId);
    }
  }
  function mergeClientFields(primaryId,duplicate){
    const primary=db.prepare("SELECT * FROM clients WHERE id=? AND deleted_at IS NULL").get(primaryId);
    if(!primary)throw problem("CLIENT_NOT_FOUND",404);
    const fill=["first_name","last_name","company_name","contact_name","email","mobile_phone","line_phone","phone","street","city","district","postcode","country","address","short_memo_to_name","last_visit"];
    const next={};
    for(const field of fill)next[field]=text(primary[field],5000)||text(duplicate[field],5000)||null;
    const notes=[text(primary.notes,5000),text(duplicate.notes,5000)].filter(Boolean);
    next.notes=[...new Set(notes)].join("\n\n")||null;
    db.prepare(`UPDATE clients SET first_name=?,last_name=?,company_name=?,contact_name=?,email=?,mobile_phone=?,line_phone=?,phone=?,street=?,city=?,district=?,postcode=?,country=?,address=?,short_memo_to_name=?,last_visit=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(next.first_name,next.last_name,next.company_name,next.contact_name,next.email,next.mobile_phone,next.line_phone,next.phone,next.street,next.city,next.district,next.postcode,next.country,next.address,next.short_memo_to_name,next.last_visit,next.notes,primaryId);
  }
  function deleteClientToArchive(id,actor,reason=""){
    const source=clientArchiveSource(id),deletedAt=new Date().toISOString();
    const snapshot={source:"deleted_client",deleted_at:deletedAt,deleted_by_user_id:actor?.id||null,reason:text(reason,3000),...source};
    const archived=db.transaction(()=>{
      const info=db.prepare(`INSERT INTO document_archive(category,title,description,entity_type,entity_id,metadata_json,archived_by_user_id)
        VALUES('deleted_client',?,?,?,?,?,?)`).run(
        `Deleted Client #${id} · ${source.client.name||"Client"}`,
        text(reason,3000)||`Removed from active Master Data · ${source.pianos.length} piano(s)`,
        "client",String(id),JSON.stringify(snapshot),actor?.id||null
      );
      const archiveId=Number(info.lastInsertRowid);
      // Keep financial/job history referentially intact, but remove the client from active Master Data ownership.
      if(tableExists("pianos"))db.prepare("UPDATE pianos SET client_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE client_id=?").run(id);
      if(tableExists("client_piano_review_queue"))db.prepare("UPDATE client_piano_review_queue SET client_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE client_id=?").run(id);
      db.prepare("UPDATE clients SET deleted_at=CURRENT_TIMESTAMP,deleted_by_user_id=?,archive_document_id=?,deletion_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(actor?.id||null,archiveId,text(reason,3000)||null,id);
      return db.prepare(`${select} WHERE a.id=?`).get(archiveId);
    })();
    return {...archived,metadata:snapshot};
  }

  function normalizeIdentityText(value){
    return text(value,1000).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
  }
  function normalizeIdentityEmail(value){return text(value,320).toLowerCase();}
  function normalizeIdentityPhone(value){const digits=String(value||"").replace(/\D/g,"");return digits.length>10?digits.slice(-10):digits;}
  function normalizeIdentityAddress(value){
    return normalizeIdentityText(value)
      .replace(/\bstreet\b/g,"st").replace(/\bavenue\b/g,"ave").replace(/\broad\b/g,"rd")
      .replace(/\bboulevard\b/g,"blvd").replace(/\bdrive\b/g,"dr").replace(/\blane\b/g,"ln")
      .replace(/\bapartment\b/g,"apt").replace(/\bsuite\b/g,"ste").replace(/\s+/g," ").trim();
  }
  function clientIdentity(row){
    const phoneValues=[row.phone,row.mobile_phone,row.line_phone].map(normalizeIdentityPhone).filter(value=>value.length>=7);
    const structuredAddress=[row.street,row.city,row.district,row.postcode,row.country].filter(Boolean).join(" ");
    const addressValues=[row.address,structuredAddress].map(normalizeIdentityAddress).filter(Boolean);
    const nameValues=[row.name,[row.first_name,row.last_name].filter(Boolean).join(" ")].map(normalizeIdentityText).filter(Boolean);
    return {
      name:[...new Set(nameValues)],email:[normalizeIdentityEmail(row.email)].filter(Boolean),phone:[...new Set(phoneValues)],
      address:[...new Set(addressValues)],postcode:[normalizeIdentityText(row.postcode)].filter(Boolean),
      city:[normalizeIdentityText(row.city)].filter(Boolean),company_name:[normalizeIdentityText(row.company_name)].filter(Boolean),
      contact_name:[normalizeIdentityText(row.contact_name)].filter(Boolean)
    };
  }
  const DUPLICATE_WEIGHTS={email:5,phone:5,address:4,name:3,company_name:3,contact_name:2,postcode:2,city:1};
  function shareIdentityValue(a,b,field){const right=new Set(b[field]||[]);return (a[field]||[]).some(value=>right.has(value));}
  function identitySignature(a,b){
    const payload=[a,b].sort((x,y)=>Number(x.id)-Number(y.id)).map(row=>({id:row.id,identity:clientIdentity(row)}));
    return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }
  function duplicateCandidates(){
    const clients=db.prepare("SELECT * FROM clients WHERE deleted_at IS NULL ORDER BY id").all();
    const identities=new Map(clients.map(row=>[row.id,clientIdentity(row)])),byField=new Map(),pairs=new Set();
    for(const field of ["email","phone","name","address","company_name","contact_name","postcode"]){
      const values=new Map();
      for(const row of clients)for(const value of identities.get(row.id)?.[field]||[]){if(!values.has(value))values.set(value,[]);values.get(value).push(row.id);}
      byField.set(field,values);
      for(const ids of values.values()){
        if(ids.length<2)continue;
        for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)pairs.add(`${Math.min(ids[i],ids[j])}:${Math.max(ids[i],ids[j])}`);
      }
    }
    const clientById=new Map(clients.map(row=>[row.id,row])),out=[];
    for(const pairKey of pairs){
      const [aId,bId]=pairKey.split(":").map(Number),a=clientById.get(aId),b=clientById.get(bId);if(!a||!b)continue;
      const ia=identities.get(aId),ib=identities.get(bId),fields=Object.keys(DUPLICATE_WEIGHTS).filter(field=>shareIdentityValue(ia,ib,field));
      if(fields.length<2)continue;
      const score=fields.reduce((sum,field)=>sum+DUPLICATE_WEIGHTS[field],0);
      out.push({pair_key:pairKey,client_a_id:aId,client_b_id:bId,signature:identitySignature(a,b),match_fields:fields,match_count:fields.length,match_score:score});
    }
    return out;
  }
  function syncDuplicateReviewQueue(){
    if(!tableExists("client_duplicate_reviews"))return [];
    const candidates=duplicateCandidates(),activeKeys=new Set(candidates.map(row=>row.pair_key));
    const existing=new Map(db.prepare("SELECT * FROM client_duplicate_reviews").all().map(row=>[row.pair_key,row]));
    const insert=db.prepare(`INSERT INTO client_duplicate_reviews(pair_key,client_a_id,client_b_id,signature,match_fields_json,match_count,match_score,status)
      VALUES(?,?,?,?,?,?,?,'PENDING')`);
    const update=db.prepare(`UPDATE client_duplicate_reviews SET signature=?,match_fields_json=?,match_count=?,match_score=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`);
    db.transaction(()=>{
      for(const candidate of candidates){
        const row=existing.get(candidate.pair_key),fields=JSON.stringify(candidate.match_fields);
        if(!row){insert.run(candidate.pair_key,candidate.client_a_id,candidate.client_b_id,candidate.signature,fields,candidate.match_count,candidate.match_score);continue;}
        if(row.status==="MERGED")continue;
        let status=row.status;
        if(status==="CLEARED")status="PENDING";
        else if(status==="NOT_DUPLICATE"&&row.signature!==candidate.signature)status="PENDING";
        update.run(candidate.signature,fields,candidate.match_count,candidate.match_score,status,row.id);
      }
      db.prepare(`UPDATE client_duplicate_reviews SET status='CLEARED',updated_at=CURRENT_TIMESTAMP
        WHERE status IN ('PENDING','REVIEW_LATER') AND pair_key NOT IN (SELECT value FROM json_each(?))`).run(JSON.stringify([...activeKeys]));
    })();
    return candidates;
  }
  function clientDuplicateSummary(id){
    const client=db.prepare("SELECT * FROM clients WHERE id=?").get(id);if(!client)return null;
    const count=table=>tableExists(table)?Number(db.prepare(`SELECT COUNT(*) count FROM "${table}" WHERE client_id=?`).get(id)?.count||0):0;
    client.relationship_counts={
      pianos:count("pianos"),jobs:count("jobs"),invoices:count("invoices"),intakes:count("intake_leads"),
      conversations:count("customer_conversations"),appointments:count("private_appointments")+count("private_appointment_requests")
    };
    client.source_refs=tableExists("master_data_client_source_map")?db.prepare("SELECT source_name,source_client_id FROM master_data_client_source_map WHERE client_id=? ORDER BY source_name,source_client_id").all(id):[];
    return client;
  }
  function duplicateReviewPayload(){
    syncDuplicateReviewQueue();
    const rows=db.prepare(`SELECT * FROM client_duplicate_reviews WHERE status IN ('PENDING','REVIEW_LATER')
      ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END,match_score DESC,updated_at DESC,id DESC`).all();
    return {
      pending_count:rows.length,
      cases:rows.map(row=>({...row,match_fields:json(row.match_fields_json||"[]"),client_a:clientDuplicateSummary(row.client_a_id),client_b:clientDuplicateSummary(row.client_b_id)}))
    };
  }
  function archiveMergedDuplicate(review,primaryId,duplicateId,actor){
    const duplicateSource=clientArchiveSource(duplicateId),deletedAt=new Date().toISOString(),manifest=clientRelationManifest(duplicateId);
    const snapshot={
      source:"merged_duplicate",deleted_at:deletedAt,deleted_by_user_id:actor?.id||null,reason:"Merged after duplicate review",
      merged_into_client_id:primaryId,duplicate_review_id:review.id,transfer_manifest:manifest,...duplicateSource
    };
    const info=db.prepare(`INSERT INTO document_archive(category,title,description,entity_type,entity_id,metadata_json,archived_by_user_id)
      VALUES('deleted_client',?,?,?,?,?,?)`).run(
      `Merged Duplicate Client #${duplicateId} · ${duplicateSource.client.name||"Client"}`,
      `Merged into active Client #${primaryId} after duplicate review. Original record remains restorable from this archive.`,
      "client",String(duplicateId),JSON.stringify(snapshot),actor?.id||null
    );
    const archiveId=Number(info.lastInsertRowid);
    mergeClientFields(primaryId,duplicateSource.client);
    transferClientRelations(duplicateId,primaryId);
    db.prepare("UPDATE clients SET deleted_at=CURRENT_TIMESTAMP,deleted_by_user_id=?,archive_document_id=?,deletion_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(actor?.id||null,archiveId,`Merged into Client #${primaryId}`,duplicateId);
    db.prepare(`UPDATE client_duplicate_reviews SET status='MERGED',primary_client_id=?,archived_client_id=?,archive_document_id=?,resolution_note=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(primaryId,duplicateId,archiveId,`Merged into Client #${primaryId}`,actor?.id||null,review.id);
    db.prepare(`UPDATE client_duplicate_reviews SET status='CLEARED',updated_at=CURRENT_TIMESTAMP
      WHERE id<>? AND status IN ('PENDING','REVIEW_LATER') AND (client_a_id=? OR client_b_id=?)`).run(review.id,duplicateId,duplicateId);
    return {...db.prepare(`${select} WHERE a.id=?`).get(archiveId),metadata:snapshot};
  }
  function restoreArchivedClient(archiveId,actor){
    const archive=db.prepare(`${select} WHERE a.id=?`).get(archiveId);if(!archive||archive.category!=="deleted_client")throw problem("ARCHIVED_CLIENT_NOT_FOUND",404);
    const metadata=json(archive.metadata_json),clientId=integerId(metadata?.client?.id||archive.entity_id);if(!clientId)throw problem("ARCHIVED_CLIENT_NOT_FOUND",404);
    const current=db.prepare("SELECT * FROM clients WHERE id=?").get(clientId);if(!current)throw problem("ARCHIVED_CLIENT_RECORD_MISSING",409);
    if(!current.deleted_at)return {...archive,metadata,restored:true,restored_client_id:clientId};
    const restoredAt=new Date().toISOString();
    db.transaction(()=>{
      db.prepare("UPDATE clients SET deleted_at=NULL,deleted_by_user_id=NULL,archive_document_id=NULL,deletion_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(clientId);
      if(metadata.source==="merged_duplicate"&&integerId(metadata.merged_into_client_id)){
        const primaryId=integerId(metadata.merged_into_client_id);
        restoreTransferredRelations(metadata.transfer_manifest||{},primaryId,clientId);
        if(integerId(metadata.duplicate_review_id)&&tableExists("client_duplicate_reviews")){
          const primary=db.prepare("SELECT * FROM clients WHERE id=? AND deleted_at IS NULL").get(primaryId),restored=db.prepare("SELECT * FROM clients WHERE id=?").get(clientId);
          const signature=primary&&restored?identitySignature(primary,restored):"";
          db.prepare(`UPDATE client_duplicate_reviews SET status='NOT_DUPLICATE',signature=COALESCE(NULLIF(?,''),signature),resolution_note=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(signature,"Restored from merge archive; treated as separate client",actor?.id||null,metadata.duplicate_review_id);
        }
      }else if(tableExists("pianos")){
        const update=db.prepare("UPDATE pianos SET client_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND client_id IS NULL");
        for(const piano of metadata.pianos||[])if(integerId(piano.id))update.run(clientId,piano.id);
      }
      const nextMetadata={...metadata,restored_at:restoredAt,restored_by_user_id:actor?.id||null};
      db.prepare("UPDATE document_archive SET metadata_json=?,description=? WHERE id=?")
        .run(JSON.stringify(nextMetadata),`${archive.description||""}${archive.description?" · ":""}Restored ${restoredAt}`,archiveId);
    })();
    const row=db.prepare(`${select} WHERE a.id=?`).get(archiveId);
    return {...row,metadata:json(row.metadata_json),restored:true,restored_client_id:clientId};
  }

  app.delete("/api/intake/:id",auth,admin,(req,res)=>{
    try{
      const id=integerId(req.params.id);if(!id)throw problem("INTAKE_NOT_FOUND",404);
      const before=assessmentSource(id);
      const archived=deleteIntakeToArchive(id,req.user,req.body?.reason||"");
      audit(req,"DELETE","intake",String(id),before,{archive_document_id:archived.id,category:"deleted_intake"},1,"Intake deleted and archived");
      res.json({ok:true,deleted_intake_id:id,archive_document:archived});
    }catch(error){respond(res,error);}
  });
  app.delete("/api/clients/:id",auth,admin,(req,res)=>{
    try{
      const id=integerId(req.params.id);if(!id)throw problem("CLIENT_NOT_FOUND",404);
      const before=clientArchiveSource(id);
      const archived=deleteClientToArchive(id,req.user,req.body?.reason||"");
      audit(req,"DELETE","clients",String(id),before.client,{name:before.client.name,archive_document_id:archived.id,category:"deleted_client"},1,"Client removed from active Master Data and archived");
      res.json({ok:true,archive_document:archived,deleted_client_id:id});
    }catch(error){respond(res,error);}
  });
  app.get("/api/client-duplicates",auth,admin,(_req,res)=>{
    try{res.json(duplicateReviewPayload());}catch(error){respond(res,error);}
  });
  app.post("/api/client-duplicates/rescan",auth,admin,(_req,res)=>{
    try{res.json(duplicateReviewPayload());}catch(error){respond(res,error);}
  });
  app.post("/api/client-duplicates/:id/later",auth,admin,(req,res)=>{
    try{
      const id=integerId(req.params.id),review=id&&db.prepare("SELECT * FROM client_duplicate_reviews WHERE id=?").get(id);if(!review)throw problem("DUPLICATE_REVIEW_NOT_FOUND",404);
      db.prepare("UPDATE client_duplicate_reviews SET status='REVIEW_LATER',reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user?.id||null,id);
      audit(req,"REVIEW_LATER","client_duplicate_reviews",String(id),review,{status:"REVIEW_LATER"});
      res.json({ok:true,...duplicateReviewPayload()});
    }catch(error){respond(res,error);}
  });
  app.post("/api/client-duplicates/:id/not-duplicate",auth,admin,(req,res)=>{
    try{
      const id=integerId(req.params.id),review=id&&db.prepare("SELECT * FROM client_duplicate_reviews WHERE id=?").get(id);if(!review)throw problem("DUPLICATE_REVIEW_NOT_FOUND",404);
      const a=db.prepare("SELECT * FROM clients WHERE id=? AND deleted_at IS NULL").get(review.client_a_id),b=db.prepare("SELECT * FROM clients WHERE id=? AND deleted_at IS NULL").get(review.client_b_id);
      const signature=a&&b?identitySignature(a,b):review.signature;
      db.prepare(`UPDATE client_duplicate_reviews SET status='NOT_DUPLICATE',signature=?,resolution_note=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(signature,text(req.body?.note,1000)||"Reviewed as separate clients",req.user?.id||null,id);
      audit(req,"NOT_DUPLICATE","client_duplicate_reviews",String(id),review,{status:"NOT_DUPLICATE"});
      res.json({ok:true,...duplicateReviewPayload()});
    }catch(error){respond(res,error);}
  });
  app.post("/api/client-duplicates/:id/merge",auth,admin,(req,res)=>{
    try{
      const id=integerId(req.params.id),primaryId=integerId(req.body?.primary_client_id),review=id&&db.prepare("SELECT * FROM client_duplicate_reviews WHERE id=?").get(id);
      if(!review)throw problem("DUPLICATE_REVIEW_NOT_FOUND",404);
      if(!["PENDING","REVIEW_LATER"].includes(review.status))throw problem("DUPLICATE_REVIEW_ALREADY_RESOLVED",409);
      if(!primaryId||![Number(review.client_a_id),Number(review.client_b_id)].includes(primaryId))throw problem("INVALID_PRIMARY_CLIENT",400);
      const duplicateId=primaryId===Number(review.client_a_id)?Number(review.client_b_id):Number(review.client_a_id);
      const before={primary:clientDuplicateSummary(primaryId),duplicate:clientDuplicateSummary(duplicateId)};
      const archived=db.transaction(()=>archiveMergedDuplicate(review,primaryId,duplicateId,req.user))();
      audit(req,"MERGE_DUPLICATE","clients",String(duplicateId),before,{primary_client_id:primaryId,archive_document_id:archived.id},1,"Duplicate client merged and archived");
      res.json({ok:true,primary_client_id:primaryId,archived_client_id:duplicateId,archive_document:archived,...duplicateReviewPayload()});
    }catch(error){respond(res,error);}
  });
  app.post("/api/archive/documents/:id/restore-client",auth,admin,(req,res)=>{
    try{
      const id=integerId(req.params.id);if(!id)throw problem("ARCHIVE_DOCUMENT_NOT_FOUND",404);
      const before=db.prepare(`${select} WHERE a.id=?`).get(id),restored=restoreArchivedClient(id,req.user);
      audit(req,"RESTORE","clients",String(restored.restored_client_id),before,{archive_document_id:id,restored_client_id:restored.restored_client_id},1,"Archived client restored to active Master Data");
      res.json({ok:true,archive_document:restored,restored_client_id:restored.restored_client_id});
    }catch(error){respond(res,error);}
  });
  app.get("/api/archive/documents",auth,admin,(req,res)=>{
    try{
      const category=text(req.query.category,80),q=text(req.query.q,240).toLowerCase(),like=`%${q}%`;
      if(category&&!CATEGORIES.has(category))throw problem("INVALID_ARCHIVE_CATEGORY");
      const rows=db.prepare(`${select} WHERE (?='' OR a.category=?) AND (?='' OR lower(a.title) LIKE ? OR lower(COALESCE(a.description,'')) LIKE ? OR lower(COALESCE(a.original_name,'')) LIKE ? OR lower(COALESCE(a.entity_id,'')) LIKE ? OR lower(COALESCE(a.metadata_json,'')) LIKE ?)
        ORDER BY a.archived_at DESC,a.id DESC`).all(category,category,q,like,like,like,like,like)
        .map(row=>{
          const metadata=json(row.metadata_json),clientId=row.category==="deleted_client"?integerId(metadata?.client?.id||row.entity_id):null;
          const activeClient=clientId?db.prepare("SELECT deleted_at FROM clients WHERE id=?").get(clientId):null;
          return {...row,metadata,restorable:Boolean(clientId&&activeClient?.deleted_at),restored:Boolean(metadata?.restored_at||clientId&&activeClient&&!activeClient.deleted_at)};
        });
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

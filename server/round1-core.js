"use strict";

function text(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function validEmail(value){
  const email=text(value,320).toLowerCase();
  return !email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function integerId(value){const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null;}
const CLIENT_TYPES=new Set(["PRIVATE","BUSINESS","INSTITUTION"]);
function parseContact(raw){
  const value=text(raw,500);
  if(!value)return {email:null,phone:null};
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return {email:value.toLowerCase(),phone:null};
  return {email:null,phone:value};
}
function normalizePhone(value){return String(value||"").replace(/\D/g,"").replace(/^1(?=\d{10}$)/,"");}
function exactClientCandidates(db,{email,phone}={}){
  const ids=new Set();
  const normalizedEmail=text(email,320).toLowerCase();
  if(normalizedEmail){
    for(const row of db.prepare("SELECT id FROM clients WHERE lower(COALESCE(email,''))=?").all(normalizedEmail))ids.add(Number(row.id));
  }
  const normalizedPhone=normalizePhone(phone);
  if(normalizedPhone){
    for(const row of db.prepare("SELECT id,phone FROM clients WHERE phone IS NOT NULL AND trim(phone)<>''").all()){
      if(normalizePhone(row.phone)===normalizedPhone)ids.add(Number(row.id));
    }
  }
  return [...ids].map(id=>db.prepare("SELECT * FROM clients WHERE id=?").get(id)).filter(Boolean);
}
function mediaList(value){
  if(Array.isArray(value))return value;
  try{const parsed=JSON.parse(String(value||"[]"));return Array.isArray(parsed)?parsed:[];}catch(_error){return [];}
}
function normalizeMedia(value){
  const rows=mediaList(value).map(item=>text(item,1200)).filter(Boolean);
  if(rows.length>20)throw Object.assign(new Error("TOO_MANY_INTAKE_MEDIA"),{status:400});
  for(const url of rows){
    if(!/^https?:\/\//i.test(url)&&!/^\/uploads\/intake\//.test(url))throw Object.assign(new Error("INVALID_INTAKE_MEDIA_URL"),{status:400});
  }
  return [...new Set(rows)];
}
function leadRow(row){return row?{...row,media_urls:mediaList(row.media_urls)}:row;}

function convertIntakeLead(db,lead,body={}){
  return db.transaction(()=>{
    let client=lead.client_id?db.prepare("SELECT * FROM clients WHERE id=?").get(lead.client_id):null;
    if(!client){
      const parsed=parseContact(lead.raw_contact);
      const name=text(body?.client?.name||lead.raw_client_name,240);
      const email=text(body?.client?.email||parsed.email,320).toLowerCase();
      const phone=text(body?.client?.phone||parsed.phone,120);
      const address=text(body?.client?.address||body?.location,1000);
      if(!name)throw Object.assign(new Error("CLIENT_NAME_REQUIRED"),{status:400});
      if(!validEmail(email))throw Object.assign(new Error("INVALID_CLIENT_EMAIL"),{status:400});
      const info=db.prepare("INSERT INTO clients(name,email,phone,address,notes,created_at,updated_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
        .run(name,email||null,phone||null,address||null,text(body?.client?.notes,5000)||null);
      client=db.prepare("SELECT * FROM clients WHERE id=?").get(Number(info.lastInsertRowid));
    }

    let piano=lead.piano_id?db.prepare("SELECT * FROM pianos WHERE id=? AND client_id=?").get(lead.piano_id,client.id):null;
    const selectedPianoId=integerId(body?.piano_id);
    if(!piano&&selectedPianoId){
      piano=db.prepare("SELECT * FROM pianos WHERE id=? AND client_id=?").get(selectedPianoId,client.id);
      if(!piano)throw Object.assign(new Error("INVALID_PIANO_ID"),{status:400});
    }
    if(!piano){
      const brand=text(body?.piano?.brand,200),model=text(body?.piano?.model,200);
      if(!brand)throw Object.assign(new Error("PIANO_DETAILS_REQUIRED"),{status:400});
      const info=db.prepare(`INSERT INTO pianos(client_id,brand,model,serial_number,finish,location_notes,last_serviced_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
        client.id,brand,model||null,text(body?.piano?.serial_number,160)||null,text(body?.piano?.finish,160)||null,
        text(body?.piano?.location_notes||body?.location||client.address,1200)||null,text(body?.piano?.last_serviced_at,40)||null
      );
      piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(Number(info.lastInsertRowid));
    }

    db.prepare("UPDATE intake_leads SET client_id=?,piano_id=?,status='converted',converted_at=COALESCE(converted_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(client.id,piano.id,lead.id);
    return {client,piano,lead:leadRow(db.prepare("SELECT * FROM intake_leads WHERE id=?").get(lead.id))};
  })();
}

function registerRound1CoreRoutes({app,db,auth,permit,audit,intakeMediaUpload,notifications=null}){
  const staff=permit("ADMIN","MANAGER","WORKER");

  app.get("/api/clients",auth,staff,(req,res)=>{
    const q=text(req.query.q,160).toLowerCase(),like=`%${q}%`;
    const rows=db.prepare(`SELECT c.*,COUNT(p.id) AS piano_count
      FROM clients c LEFT JOIN pianos p ON p.client_id=c.id
      WHERE ?='' OR lower(c.name) LIKE ? OR lower(COALESCE(c.email,'')) LIKE ? OR lower(COALESCE(c.phone,'')) LIKE ?
      GROUP BY c.id ORDER BY lower(c.name),c.id`).all(q,like,like,like);
    res.json(rows);
  });

  app.post("/api/clients",auth,staff,(req,res)=>{
    const name=text(req.body?.name,240),email=text(req.body?.email,320).toLowerCase();
    if(!name)return res.status(400).json({error:"CLIENT_NAME_REQUIRED"});
    if(!validEmail(email))return res.status(400).json({error:"INVALID_CLIENT_EMAIL"});
    const isVip=req.body?.is_vip===true||req.body?.is_vip===1||String(req.body?.is_vip||"").toLowerCase()==="true"?1:0,requestedType=text(req.body?.client_type||"PRIVATE",40).toUpperCase();
    if(!CLIENT_TYPES.has(requestedType))return res.status(400).json({error:"INVALID_CLIENT_TYPE"});
    const info=db.prepare("INSERT INTO clients(name,email,phone,address,notes,client_type,is_vip,vip_updated_by_user_id,vip_updated_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
      .run(name,email||null,text(req.body?.phone,120)||null,text(req.body?.address,1000)||null,text(req.body?.notes,5000)||null,requestedType,isVip,isVip?req.user.id:null,isVip?new Date().toISOString():null);
    const row=db.prepare("SELECT * FROM clients WHERE id=?").get(Number(info.lastInsertRowid));
    audit(req,"CREATE","clients",String(row.id),null,row);res.status(201).json(row);
  });

  app.put("/api/clients/:id",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&db.prepare("SELECT * FROM clients WHERE id=?").get(id);
    if(!before)return res.status(404).json({error:"CLIENT_NOT_FOUND"});
    const requestedVip=req.body?.is_vip===undefined?Number(before.is_vip||0):(req.body.is_vip===true||req.body.is_vip===1||String(req.body.is_vip||"").toLowerCase()==="true"?1:0),requestedType=text(req.body?.client_type??before.client_type??"PRIVATE",40).toUpperCase();
    if(!CLIENT_TYPES.has(requestedType))return res.status(400).json({error:"INVALID_CLIENT_TYPE"});
    const next={
      name:text(req.body?.name??before.name,240),email:text(req.body?.email??before.email,320).toLowerCase(),
      phone:text(req.body?.phone??before.phone,120),address:text(req.body?.address??before.address,1000),notes:text(req.body?.notes??before.notes,5000),client_type:requestedType,is_vip:requestedVip
    };
    if(!next.name)return res.status(400).json({error:"CLIENT_NAME_REQUIRED"});
    if(!validEmail(next.email))return res.status(400).json({error:"INVALID_CLIENT_EMAIL"});
    const vipChanged=Number(before.is_vip||0)!==next.is_vip;
    db.prepare("UPDATE clients SET name=?,email=?,phone=?,address=?,notes=?,client_type=?,is_vip=?,vip_updated_by_user_id=CASE WHEN ?=1 THEN ? ELSE vip_updated_by_user_id END,vip_updated_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE vip_updated_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(next.name,next.email||null,next.phone||null,next.address||null,next.notes||null,next.client_type,next.is_vip,vipChanged?1:0,req.user.id,vipChanged?1:0,id);
    const row=db.prepare("SELECT * FROM clients WHERE id=?").get(id);
    audit(req,"UPDATE","clients",String(id),before,row);res.json(row);
  });

  app.get("/api/clients/:id/pianos",auth,staff,(req,res)=>{
    const id=integerId(req.params.id);
    if(!id||!db.prepare("SELECT 1 FROM clients WHERE id=?").get(id))return res.status(404).json({error:"CLIENT_NOT_FOUND"});
    res.json(db.prepare("SELECT * FROM pianos WHERE client_id=? ORDER BY lower(brand),lower(COALESCE(model,'')),id").all(id));
  });

  app.post("/api/clients/:id/pianos",auth,staff,(req,res)=>{
    const clientId=integerId(req.params.id);
    if(!clientId||!db.prepare("SELECT 1 FROM clients WHERE id=?").get(clientId))return res.status(404).json({error:"CLIENT_NOT_FOUND"});
    const brand=text(req.body?.brand,200);if(!brand)return res.status(400).json({error:"PIANO_BRAND_REQUIRED"});
    const info=db.prepare(`INSERT INTO pianos(client_id,brand,model,serial_number,finish,location_notes,last_serviced_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
      clientId,brand,text(req.body?.model,200)||null,text(req.body?.serial_number,160)||null,text(req.body?.finish,160)||null,
      text(req.body?.location_notes,1200)||null,text(req.body?.last_serviced_at,40)||null
    );
    const row=db.prepare("SELECT * FROM pianos WHERE id=?").get(Number(info.lastInsertRowid));
    audit(req,"CREATE","pianos",String(row.id),null,row);res.status(201).json(row);
  });

  app.put("/api/pianos/:id",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&db.prepare("SELECT * FROM pianos WHERE id=?").get(id);
    if(!before)return res.status(404).json({error:"PIANO_NOT_FOUND"});
    const clientId=integerId(req.body?.client_id??before.client_id),brand=text(req.body?.brand??before.brand,200);
    if(!clientId||!db.prepare("SELECT 1 FROM clients WHERE id=?").get(clientId))return res.status(400).json({error:"INVALID_CLIENT_ID"});
    if(!brand)return res.status(400).json({error:"PIANO_BRAND_REQUIRED"});
    db.prepare("UPDATE pianos SET client_id=?,brand=?,model=?,serial_number=?,finish=?,location_notes=?,last_serviced_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(clientId,brand,text(req.body?.model??before.model,200)||null,text(req.body?.serial_number??before.serial_number,160)||null,
        text(req.body?.finish??before.finish,160)||null,text(req.body?.location_notes??before.location_notes,1200)||null,
        text(req.body?.last_serviced_at??before.last_serviced_at,40)||null,id);
    const row=db.prepare("SELECT * FROM pianos WHERE id=?").get(id);
    audit(req,"UPDATE","pianos",String(id),before,row);res.json(row);
  });

  app.post("/api/intake/media",auth,staff,(req,res,next)=>{
    if(!intakeMediaUpload)return res.status(503).json({error:"INTAKE_MEDIA_UPLOAD_UNAVAILABLE"});
    intakeMediaUpload.array("media",10)(req,res,error=>{
      if(error)return next(error);
      const files=Array.isArray(req.files)?req.files:[];
      if(!files.length)return res.status(400).json({error:"INTAKE_MEDIA_REQUIRED"});
      res.status(201).json({urls:files.map(file=>`/uploads/intake/${file.filename}`)});
    });
  });

  app.get("/api/intake",auth,staff,(req,res)=>{
    const status=text(req.query.status,30).toLowerCase();
    if(status&&!["new","under_review","converted","archived"].includes(status))return res.status(400).json({error:"INVALID_INTAKE_STATUS"});
    const rows=db.prepare(`SELECT i.*,c.name AS client_name,c.email AS client_email,c.phone AS client_phone,c.preferred_language AS client_preferred_language,p.brand AS piano_brand,p.model AS piano_model,u.name AS assigned_technician_name,
      j.id AS job_id,j.job_code AS job_code,j.stage AS job_stage
      FROM intake_leads i
      LEFT JOIN clients c ON c.id=i.client_id
      LEFT JOIN pianos p ON p.id=i.piano_id
      LEFT JOIN users u ON u.id=i.assigned_technician_id
      LEFT JOIN jobs j ON j.intake_id=i.id
      WHERE ?='' OR i.status=?
      ORDER BY CASE i.estimated_urgency WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,i.created_at DESC,i.id DESC`).all(status,status);
    res.json(rows.map(leadRow));
  });

  app.post("/api/intake",auth,staff,(req,res)=>{
    try{
      const issue=text(req.body?.reported_issue,5000),location=text(req.body?.service_location||"workshop",30),urgency=text(req.body?.estimated_urgency||"normal",30);
      let clientId=integerId(req.body?.client_id),pianoId=integerId(req.body?.piano_id),identityStatus="unmatched";
      const rawContact=text(req.body?.raw_contact,500),parsedContact=parseContact(rawContact),sourceConversationId=text(req.body?.source_conversation_id,160)||null;
      if(sourceConversationId&&!db.prepare("SELECT 1 FROM customer_conversations WHERE id=?").get(sourceConversationId))return res.status(400).json({error:"INVALID_SOURCE_CONVERSATION"});
      if(sourceConversationId){const existing=db.prepare("SELECT id FROM intake_leads WHERE source_conversation_id=? ORDER BY id DESC LIMIT 1").get(sourceConversationId);if(existing)return res.status(409).json({error:"INTAKE_ALREADY_EXISTS",intake_id:existing.id});}
      if(!clientId){
        const matches=exactClientCandidates(db,parsedContact);
        if(matches.length===1){clientId=Number(matches[0].id);identityStatus="matched";}
        else if(matches.length>1)identityStatus="ambiguous";
      }else identityStatus="explicit";
      if(!issue)return res.status(400).json({error:"REPORTED_ISSUE_REQUIRED"});
      if(!["workshop","on_site"].includes(location))return res.status(400).json({error:"INVALID_SERVICE_LOCATION"});
      if(!["low","normal","urgent"].includes(urgency))return res.status(400).json({error:"INVALID_URGENCY"});
      if(clientId&&!db.prepare("SELECT 1 FROM clients WHERE id=?").get(clientId))return res.status(400).json({error:"INVALID_CLIENT_ID"});
      if(pianoId){
        const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(pianoId);
        if(!piano||(clientId&&Number(piano.client_id)!==clientId))return res.status(400).json({error:"INVALID_PIANO_ID"});
        if(!clientId){clientId=Number(piano.client_id);identityStatus="piano_owner";}
      }
      const technician=text(req.body?.assigned_technician_id,160);
      if(technician&&!db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active' AND role IN ('WORKER','MANAGER','ADMIN')").get(technician))return res.status(400).json({error:"INVALID_TECHNICIAN_ID"});
      const media=normalizeMedia(req.body?.media_urls);
      const initialStatus=identityStatus==="ambiguous"?"under_review":"new";
      const info=db.prepare(`INSERT INTO intake_leads(client_id,piano_id,raw_client_name,raw_contact,service_location,reported_issue,media_urls,estimated_urgency,status,assigned_technician_id,source_conversation_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
        clientId,pianoId,text(req.body?.raw_client_name,240)||null,rawContact||null,location,issue,JSON.stringify(media),urgency,initialStatus,technician||null,sourceConversationId
      );
      const row=leadRow(db.prepare("SELECT * FROM intake_leads WHERE id=?").get(Number(info.lastInsertRowid)));
      if(identityStatus==="ambiguous"&&notifications){
        const recipients=db.prepare("SELECT id FROM users WHERE status='Active' AND (role='ADMIN' OR role='SUPERADMIN' OR is_superadmin=1)").all().map(item=>item.id);
        if(recipients.length)notifications.emitOnce({
          category:"DATA_EXCEPTION",entityType:"INTAKE",entityId:String(row.id),
          titleEn:"Possible duplicate customer",titleHu:"Lehetséges duplikált ügyfél",
          bodyEn:`${row.raw_client_name||"New intake"} · multiple exact client matches need review`,
          bodyHu:`${row.raw_client_name||"Új igény"} · több pontos ügyféltalálat, ellenőrzés szükséges`,
          actionUrl:"#intake",severity:"WARNING",recipients
        });
      }
      audit(req,"CREATE","intake",String(row.id),null,{...row,identity_status:identityStatus});res.status(201).json({...row,identity_status:identityStatus});
    }catch(error){res.status(Number(error.status||400)).json({error:error.message||"INTAKE_CREATE_FAILED"});}
  });

  app.put("/api/intake/:id",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&db.prepare("SELECT * FROM intake_leads WHERE id=?").get(id);
    if(!before)return res.status(404).json({error:"INTAKE_NOT_FOUND"});
    if(before.status==="converted")return res.status(409).json({error:"INTAKE_ALREADY_CONVERTED"});
    try{
      const status=text(req.body?.status??before.status,30);if(!["new","under_review","archived"].includes(status))throw Object.assign(new Error("INVALID_INTAKE_STATUS"),{status:400});
      const location=text(req.body?.service_location??before.service_location,30);if(!["workshop","on_site"].includes(location))throw Object.assign(new Error("INVALID_SERVICE_LOCATION"),{status:400});
      const urgency=text(req.body?.estimated_urgency??before.estimated_urgency,30);if(!["low","normal","urgent"].includes(urgency))throw Object.assign(new Error("INVALID_URGENCY"),{status:400});
      let clientId=req.body?.client_id===undefined?before.client_id:integerId(req.body.client_id),pianoId=req.body?.piano_id===undefined?before.piano_id:integerId(req.body.piano_id);
      if(clientId&&!db.prepare("SELECT 1 FROM clients WHERE id=?").get(clientId))throw Object.assign(new Error("INVALID_CLIENT_ID"),{status:400});
      if(pianoId){
        const piano=db.prepare("SELECT * FROM pianos WHERE id=?").get(pianoId);if(!piano||(clientId&&Number(piano.client_id)!==Number(clientId)))throw Object.assign(new Error("INVALID_PIANO_ID"),{status:400});
        if(!clientId)clientId=Number(piano.client_id);
      }
      const technician=req.body?.assigned_technician_id===undefined?before.assigned_technician_id:(text(req.body.assigned_technician_id,160)||null);
      if(technician&&!db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active' AND role IN ('WORKER','MANAGER','ADMIN')").get(technician))throw Object.assign(new Error("INVALID_TECHNICIAN_ID"),{status:400});
      const sourceConversationId=req.body?.source_conversation_id===undefined?before.source_conversation_id:(text(req.body.source_conversation_id,160)||null);
      if(sourceConversationId&&!db.prepare("SELECT 1 FROM customer_conversations WHERE id=?").get(sourceConversationId))throw Object.assign(new Error("INVALID_SOURCE_CONVERSATION"),{status:400});
      const media=req.body?.media_urls===undefined?mediaList(before.media_urls):normalizeMedia(req.body.media_urls),issue=text(req.body?.reported_issue??before.reported_issue,5000);
      if(!issue)throw Object.assign(new Error("REPORTED_ISSUE_REQUIRED"),{status:400});
      db.prepare(`UPDATE intake_leads SET client_id=?,piano_id=?,raw_client_name=?,raw_contact=?,service_location=?,reported_issue=?,media_urls=?,estimated_urgency=?,status=?,assigned_technician_id=?,source_conversation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
        clientId||null,pianoId||null,text(req.body?.raw_client_name??before.raw_client_name,240)||null,text(req.body?.raw_contact??before.raw_contact,500)||null,
        location,issue,JSON.stringify(media),urgency,status,technician,sourceConversationId,id
      );
      const row=leadRow(db.prepare("SELECT * FROM intake_leads WHERE id=?").get(id));audit(req,"UPDATE","intake",String(id),leadRow(before),row);res.json(row);
    }catch(error){res.status(Number(error.status||400)).json({error:error.message||"INTAKE_UPDATE_FAILED"});}
  });

  app.post("/api/intake/:id/convert",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),lead=id&&db.prepare("SELECT * FROM intake_leads WHERE id=?").get(id);
    if(!lead)return res.status(404).json({error:"INTAKE_NOT_FOUND"});
    if(lead.status==="converted"){
      return res.json({ok:true,idempotent:true,lead:leadRow(lead),client:lead.client_id?db.prepare("SELECT * FROM clients WHERE id=?").get(lead.client_id):null,piano:lead.piano_id?db.prepare("SELECT * FROM pianos WHERE id=?").get(lead.piano_id):null});
    }
    try{
      const result=convertIntakeLead(db,lead,req.body||{});
      audit(req,"CONVERT","intake",String(id),leadRow(lead),result.lead);res.json({ok:true,idempotent:false,...result});
    }catch(error){res.status(Number(error.status||400)).json({error:error.message||"INTAKE_CONVERSION_FAILED"});}
  });
}

module.exports={registerRound1CoreRoutes,convertIntakeLead,mediaList};

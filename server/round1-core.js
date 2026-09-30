"use strict";

const {importLegacyInstrumentClientCsv}=require("./master-data-reconcile");

function text(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function validEmail(value){
  const email=text(value,320).toLowerCase();
  return !email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function integerId(value){const id=Number(value);return Number.isSafeInteger(id)&&id>0?id:null;}
const CLIENT_TYPES=new Set(["PRIVATE","BUSINESS","INSTITUTION"]);
function structuredClientAddress(row){return [row.street,row.city,row.district,row.postcode,row.country].map(value=>text(value,300)).filter(Boolean).join(", ");}
function structuredClientName(row){const person=[text(row.first_name,160),text(row.last_name,160)].filter(Boolean).join(" ");return text(row.company_name,240)||person||text(row.contact_name,240)||text(row.name,240)||"Data pending";}
function structuredClientPhone(row){return text(row.mobile_phone,120)||text(row.line_phone,120)||text(row.phone,120);}
function clientBody(body={},before={}){
  const fields={};
  for(const [key,max] of [["first_name",160],["last_name",160],["company_name",240],["contact_name",240],["mobile_phone",120],["line_phone",120],["street",300],["city",200],["district",160],["postcode",80],["country",160],["short_memo_to_name",1000]])fields[key]=text(body[key]??before[key],max);
  fields.email=text(body.email??before.email,320).toLowerCase();
  fields.notes=text(body.notes??before.notes,5000);
  fields.name=text(body.name??"",240)||structuredClientName({...before,...fields});
  fields.phone=text(body.phone??"",120)||structuredClientPhone({...before,...fields});
  fields.address=text(body.address??"",1000)||structuredClientAddress({...before,...fields});
  fields.client_type=text(body.client_type??before.client_type??"PRIVATE",40).toUpperCase();
  fields.is_vip=body.is_vip===undefined?Number(before.is_vip||0):(body.is_vip===true||body.is_vip===1||String(body.is_vip||"").toLowerCase()==="true"?1:0);
  return fields;
}
function pianoBody(body={},before={},forcedClientId=undefined){
  const rawClient=forcedClientId!==undefined?forcedClientId:(body.client_id===undefined?before.client_id:body.client_id);
  const client_id=rawClient===null||rawClient===""||rawClient===undefined?null:integerId(rawClient);
  const build_year=body.build_year===undefined?(before.build_year??null):(body.build_year===""||body.build_year===null?null:Number(body.build_year));
  return {
    client_id,category:text(body.category??before.category,80),brand:text(body.brand??before.brand,200)||"No brand",model:text(body.model??before.model,200),
    serial_number:text(body.serial_number??before.serial_number,200),finish:text(body.finish??before.finish,160),location_notes:text(body.location_notes??before.location_notes,1200),
    last_serviced_at:text(body.last_serviced_at??before.last_serviced_at,120),last_service_title:text(body.last_service_title??before.last_service_title,300),
    last_service_description:text(body.last_service_description??before.last_service_description,3000),next_service_date:text(body.next_service_date??before.next_service_date,120),
    date_of_purchase:text(body.date_of_purchase??before.date_of_purchase,120),warranty:text(body.warranty??before.warranty,300),
    latest_info_frequency:text(body.latest_info_frequency??before.latest_info_frequency,120),latest_info_humidity:text(body.latest_info_humidity??before.latest_info_humidity,120),
    latest_info_temperature:text(body.latest_info_temperature??before.latest_info_temperature,120),build_year,size_display:text(body.size_display??before.size_display,120),
    color:text(body.color??before.color,160),notes:text(body.notes??before.notes,5000)
  };
}
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

function registerRound1CoreRoutes({app,db,auth,permit,audit,intakeMediaUpload,masterDataImportUpload=null,notifications=null}){
  const staff=permit("ADMIN","MANAGER","WORKER");

  app.get("/api/clients",auth,staff,(req,res)=>{
    const q=text(req.query.q,160).toLowerCase(),like=`%${q}%`;
    const rows=db.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM pianos p WHERE p.client_id=c.id) AS piano_count,
      (SELECT COUNT(*) FROM client_piano_review_queue r WHERE r.client_id=c.id AND r.status='PENDING') AS piano_review_count
      FROM clients c
      WHERE c.deleted_at IS NULL AND (
        @q='' OR lower(c.name) LIKE @like OR lower(COALESCE(c.first_name,'')) LIKE @like OR lower(COALESCE(c.last_name,'')) LIKE @like
        OR lower(COALESCE(c.company_name,'')) LIKE @like OR lower(COALESCE(c.contact_name,'')) LIKE @like OR lower(COALESCE(c.email,'')) LIKE @like
        OR lower(COALESCE(c.phone,'')) LIKE @like OR lower(COALESCE(c.mobile_phone,'')) LIKE @like OR lower(COALESCE(c.line_phone,'')) LIKE @like
        OR lower(COALESCE(c.address,'')) LIKE @like OR lower(COALESCE(c.street,'')) LIKE @like OR lower(COALESCE(c.city,'')) LIKE @like
        OR lower(COALESCE(c.district,'')) LIKE @like OR lower(COALESCE(c.postcode,'')) LIKE @like OR lower(COALESCE(c.country,'')) LIKE @like
        OR lower(COALESCE(c.notes,'')) LIKE @like OR lower(COALESCE(c.short_memo_to_name,'')) LIKE @like
        OR EXISTS(
          SELECT 1 FROM pianos p WHERE p.client_id=c.id AND (
            lower(COALESCE(p.category,'')) LIKE @like OR lower(COALESCE(p.brand,'')) LIKE @like OR lower(COALESCE(p.model,'')) LIKE @like
            OR lower(COALESCE(p.serial_number,'')) LIKE @like OR lower(COALESCE(p.finish,'')) LIKE @like OR lower(COALESCE(p.location_notes,'')) LIKE @like
            OR lower(COALESCE(p.last_serviced_at,'')) LIKE @like OR lower(COALESCE(p.last_service_title,'')) LIKE @like OR lower(COALESCE(p.last_service_description,'')) LIKE @like
            OR lower(COALESCE(p.next_service_date,'')) LIKE @like OR lower(COALESCE(p.date_of_purchase,'')) LIKE @like OR lower(COALESCE(p.warranty,'')) LIKE @like
            OR lower(COALESCE(p.latest_info_frequency,'')) LIKE @like OR lower(COALESCE(p.latest_info_humidity,'')) LIKE @like OR lower(COALESCE(p.latest_info_temperature,'')) LIKE @like
            OR lower(COALESCE(CAST(p.build_year AS TEXT),'')) LIKE @like OR lower(COALESCE(p.size_display,'')) LIKE @like OR lower(COALESCE(p.color,'')) LIKE @like
            OR lower(COALESCE(p.notes,'')) LIKE @like
          )
        )
      )
      ORDER BY lower(c.name),c.id`).all({q,like});
    res.json(rows);
  });

  app.post("/api/clients",auth,staff,(req,res)=>{
    const next=clientBody(req.body||{});
    if(!validEmail(next.email))return res.status(400).json({error:"INVALID_CLIENT_EMAIL"});
    if(!CLIENT_TYPES.has(next.client_type))return res.status(400).json({error:"INVALID_CLIENT_TYPE"});
    const info=db.prepare(`INSERT INTO clients(name,first_name,last_name,company_name,contact_name,email,mobile_phone,line_phone,phone,street,city,district,postcode,country,address,notes,short_memo_to_name,client_type,is_vip,vip_updated_by_user_id,vip_updated_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
      next.name,next.first_name||null,next.last_name||null,next.company_name||null,next.contact_name||null,next.email||null,next.mobile_phone||null,next.line_phone||null,next.phone||null,
      next.street||null,next.city||null,next.district||null,next.postcode||null,next.country||null,next.address||null,next.notes||null,next.short_memo_to_name||null,next.client_type,next.is_vip,next.is_vip?req.user.id:null,next.is_vip?new Date().toISOString():null
    );
    const row=db.prepare("SELECT * FROM clients WHERE id=?").get(Number(info.lastInsertRowid));
    audit(req,"CREATE","clients",String(row.id),null,row);res.status(201).json(row);
  });

  app.put("/api/clients/:id",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&db.prepare("SELECT * FROM clients WHERE id=? AND deleted_at IS NULL").get(id);
    if(!before)return res.status(404).json({error:"CLIENT_NOT_FOUND"});
    const next=clientBody(req.body||{},before);
    if(!validEmail(next.email))return res.status(400).json({error:"INVALID_CLIENT_EMAIL"});
    if(!CLIENT_TYPES.has(next.client_type))return res.status(400).json({error:"INVALID_CLIENT_TYPE"});
    const vipChanged=Number(before.is_vip||0)!==next.is_vip;
    db.prepare(`UPDATE clients SET name=?,first_name=?,last_name=?,company_name=?,contact_name=?,email=?,mobile_phone=?,line_phone=?,phone=?,street=?,city=?,district=?,postcode=?,country=?,address=?,notes=?,short_memo_to_name=?,client_type=?,is_vip=?,
      vip_updated_by_user_id=CASE WHEN ?=1 THEN ? ELSE vip_updated_by_user_id END,vip_updated_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE vip_updated_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(next.name,next.first_name||null,next.last_name||null,next.company_name||null,next.contact_name||null,next.email||null,next.mobile_phone||null,next.line_phone||null,next.phone||null,next.street||null,next.city||null,next.district||null,next.postcode||null,next.country||null,next.address||null,next.notes||null,next.short_memo_to_name||null,next.client_type,next.is_vip,vipChanged?1:0,req.user.id,vipChanged?1:0,id);
    const row=db.prepare("SELECT * FROM clients WHERE id=?").get(id);
    audit(req,"UPDATE","clients",String(id),before,row);res.json(row);
  });

  const pianoSelect=`SELECT p.*,c.name AS client_name,c.first_name AS client_first_name,c.last_name AS client_last_name,c.company_name AS client_company_name,
    c.contact_name AS client_contact_name,c.email AS client_email,c.phone AS client_phone,c.mobile_phone AS client_mobile_phone,c.line_phone AS client_line_phone,
    c.address AS client_address,c.street AS client_street,c.city AS client_city,c.district AS client_district,c.postcode AS client_postcode,c.country AS client_country,
    c.notes AS client_notes,c.short_memo_to_name AS client_short_memo,
    COALESCE(NULLIF(TRIM(p.location_notes),''),NULLIF(TRIM(c.address),'')) AS effective_location
    FROM pianos p LEFT JOIN clients c ON c.id=p.client_id AND c.deleted_at IS NULL`;
  app.get("/api/pianos",auth,staff,(_req,res)=>{
    res.json(db.prepare(pianoSelect+" ORDER BY lower(COALESCE(p.brand,'No brand')),lower(COALESCE(p.model,'')),p.id").all());
  });

  app.get("/api/master-data/piano-overview",auth,staff,(_req,res)=>{
    const pianos=db.prepare(pianoSelect+" ORDER BY lower(COALESCE(p.brand,'No brand')),lower(COALESCE(p.model,'')),p.id").all();
    const review=db.prepare(`SELECT r.*,c.name AS client_name,c.address AS client_address,
      COALESCE(NULLIF(TRIM(r.source_brand),''),'No brand') AS display_brand,
      NULLIF(TRIM(r.source_model),'') AS display_model,NULLIF(TRIM(r.source_serial_number),'') AS display_serial_number
      FROM client_piano_review_queue r LEFT JOIN clients c ON c.id=r.client_id WHERE r.status='PENDING' ORDER BY r.id`).all();
    const sourceRows=db.prepare("SELECT COUNT(*) AS count FROM master_data_piano_source_map").get()?.count||0;
    const ownerLinked=pianos.filter(row=>row.client_id!==null&&row.client_id!==undefined).length,ownerPending=pianos.length-ownerLinked;
    res.json({classified:pianos,review,totals:{classified:pianos.length,review:review.length,total_entities:pianos.length,source_rows:Number(sourceRows),source_groups:Number(sourceRows),owner_linked:ownerLinked,owner_pending:ownerPending}});
  });

  app.get("/api/clients/:id/pianos",auth,staff,(req,res)=>{
    const id=integerId(req.params.id);
    if(!id||!db.prepare("SELECT 1 FROM clients WHERE id=? AND deleted_at IS NULL").get(id))return res.status(404).json({error:"CLIENT_NOT_FOUND"});
    res.json(db.prepare(pianoSelect+" WHERE p.client_id=? ORDER BY lower(COALESCE(p.brand,'No brand')),lower(COALESCE(p.model,'')),p.id").all(id));
  });

  app.get("/api/clients/:id/piano-review",auth,staff,(req,res)=>{
    const id=integerId(req.params.id);
    if(!id||!db.prepare("SELECT 1 FROM clients WHERE id=?").get(id))return res.status(404).json({error:"CLIENT_NOT_FOUND"});
    res.json(db.prepare("SELECT * FROM client_piano_review_queue WHERE client_id=? AND status='PENDING' ORDER BY id").all(id));
  });

  app.post("/api/master-data/import-csv",auth,permit("ADMIN"),(req,res,next)=>{
    if(!masterDataImportUpload)return res.status(503).json({error:"MASTER_DATA_IMPORT_UNAVAILABLE"});
    masterDataImportUpload.single("file")(req,res,error=>{
      if(error)return next(error);
      if(!req.file?.buffer?.length)return res.status(400).json({error:"MASTER_DATA_CSV_REQUIRED"});
      try{
        const summary=importLegacyInstrumentClientCsv(db,{content:req.file.buffer.toString("utf8"),sourceName:"KLAVIERHAUS_MASTER_CSV"});
        audit(req,"IMPORT","master_data","KLAVIERHAUS_MASTER_CSV",null,summary);res.json(summary);
      }catch(error){res.status(error.status||400).json({error:error.message||"MASTER_DATA_IMPORT_FAILED"});}
    });
  });

  function createPiano(req,res,forcedClientId=undefined){
    const next=pianoBody(req.body||{}, {}, forcedClientId);
    if(next.client_id&&!db.prepare("SELECT 1 FROM clients WHERE id=? AND deleted_at IS NULL").get(next.client_id))return res.status(400).json({error:"INVALID_CLIENT_ID"});
    if(next.build_year!==null&&(!Number.isInteger(next.build_year)||next.build_year<1700||next.build_year>2100))return res.status(400).json({error:"PIANO_YEAR_INVALID"});
    const info=db.prepare(`INSERT INTO pianos(client_id,category,brand,model,serial_number,finish,location_notes,last_serviced_at,last_service_title,last_service_description,next_service_date,date_of_purchase,warranty,latest_info_frequency,latest_info_humidity,latest_info_temperature,build_year,size_display,color,notes,classification_status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CLASSIFIED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(
      next.client_id,next.category||null,next.brand,next.model||null,next.serial_number||null,next.finish||null,next.location_notes||null,next.last_serviced_at||null,next.last_service_title||null,next.last_service_description||null,
      next.next_service_date||null,next.date_of_purchase||null,next.warranty||null,next.latest_info_frequency||null,next.latest_info_humidity||null,next.latest_info_temperature||null,next.build_year,next.size_display||null,next.color||null,next.notes||null
    );
    const row=db.prepare("SELECT * FROM pianos WHERE id=?").get(Number(info.lastInsertRowid));
    const reviewId=integerId(req.body?.review_id);
    if(reviewId)db.prepare("UPDATE client_piano_review_queue SET status='RESOLVED',resolved_piano_id=?,resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'").run(row.id,reviewId);
    audit(req,"CREATE","pianos",String(row.id),null,row);res.status(201).json(row);
  }
  app.post("/api/pianos",auth,staff,(req,res)=>createPiano(req,res));
  app.post("/api/clients/:id/pianos",auth,staff,(req,res)=>{
    const clientId=integerId(req.params.id);
    if(!clientId||!db.prepare("SELECT 1 FROM clients WHERE id=? AND deleted_at IS NULL").get(clientId))return res.status(404).json({error:"CLIENT_NOT_FOUND"});
    createPiano(req,res,clientId);
  });

  app.put("/api/pianos/:id",auth,staff,(req,res)=>{
    const id=integerId(req.params.id),before=id&&db.prepare("SELECT * FROM pianos WHERE id=?").get(id);
    if(!before)return res.status(404).json({error:"PIANO_NOT_FOUND"});
    const next=pianoBody(req.body||{},before);
    if(next.client_id&&!db.prepare("SELECT 1 FROM clients WHERE id=? AND deleted_at IS NULL").get(next.client_id))return res.status(400).json({error:"INVALID_CLIENT_ID"});
    if(next.build_year!==null&&(!Number.isInteger(next.build_year)||next.build_year<1700||next.build_year>2100))return res.status(400).json({error:"PIANO_YEAR_INVALID"});
    db.prepare(`UPDATE pianos SET client_id=?,category=?,brand=?,model=?,serial_number=?,finish=?,location_notes=?,last_serviced_at=?,last_service_title=?,last_service_description=?,next_service_date=?,date_of_purchase=?,warranty=?,latest_info_frequency=?,latest_info_humidity=?,latest_info_temperature=?,build_year=?,size_display=?,color=?,notes=?,classification_status='CLASSIFIED',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(next.client_id,next.category||null,next.brand,next.model||null,next.serial_number||null,next.finish||null,next.location_notes||null,next.last_serviced_at||null,next.last_service_title||null,next.last_service_description||null,next.next_service_date||null,next.date_of_purchase||null,next.warranty||null,next.latest_info_frequency||null,next.latest_info_humidity||null,next.latest_info_temperature||null,next.build_year,next.size_display||null,next.color||null,next.notes||null,id);
    db.prepare("UPDATE client_piano_review_queue SET status='RESOLVED',resolved_piano_id=?,resolved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE piano_id=? AND status='PENDING'").run(id,id);
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
      if(clientId&&!db.prepare("SELECT 1 FROM clients WHERE id=? AND deleted_at IS NULL").get(clientId))return res.status(400).json({error:"INVALID_CLIENT_ID"});
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
      if(clientId&&!db.prepare("SELECT 1 FROM clients WHERE id=? AND deleted_at IS NULL").get(clientId))throw Object.assign(new Error("INVALID_CLIENT_ID"),{status:400});
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

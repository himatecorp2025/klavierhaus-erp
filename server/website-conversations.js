"use strict";

const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {supportState}=require("./support-calendar");
const {assertAvailable,interval,holdExpiry}=require("./private-appointment-scheduling");
const {ensureClientIdentity,findClientIdentity}=require("./client-identity");

const PUBLIC_CATEGORIES=new Set(["SERVICE","TECHNICAL","PIANO","REPAIR","PRIVATE_CONSULTATION","BILLING","OTHER"]);
const IDENTITY_REQUIRED=new Set(["SERVICE","PIANO","REPAIR","PRIVATE_CONSULTATION","BILLING"]);
const CUSTOMER_INACTIVITY_MS=5*60*1000;
function clean(value,max=5000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function email(value){return clean(value,320).toLowerCase();}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email(value));}
function id(prefix){return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;}
function hash(token){return crypto.createHash("sha256").update(String(token)).digest("hex");}
function removeFiles(files){for(const file of files||[]){if(file?.path)try{fs.unlinkSync(file.path);}catch(_error){}}}
function encryptionKey(env=process.env){const secret=String(env.CONVERSATION_TOKEN_ENCRYPTION_KEY||env.JWT_SECRET||"").trim();return crypto.createHash("sha256").update(secret||"klavierhaus-conversation-key-not-for-production").digest();}
function encryptToken(token,key){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key,iv),ciphertext=Buffer.concat([cipher.update(String(token),"utf8"),cipher.final()]);return [iv,cipher.getAuthTag(),ciphertext].map(part=>part.toString("base64url")).join(".");}
function decryptToken(value,key){try{const [iv,tag,data]=String(value||"").split(".");if(!iv||!tag||!data)return "";const decipher=crypto.createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64url"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8");}catch(_error){return "";}}
function formatNy(date){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"})
    .formatToParts(date).reduce((out,part)=>(out[part.type]=part.value,out),{});
  const hour=parts.hour==="24"?"00":parts.hour;return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}
function localNewYorkToIso(value){
  const raw=clean(value,80),match=raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);if(!match)return null;
  const [,year,month,day,hour,minute]=match,desired=Date.UTC(+year,+month-1,+day,+hour,+minute);let candidate=desired;
  for(let i=0;i<3;i++){const rendered=formatNy(new Date(candidate)),m=rendered.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/),wall=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);candidate+=desired-wall;}
  const date=new Date(candidate);return formatNy(date)===`${year}-${month}-${day}T${hour}:${minute}`?date.toISOString():null;
}
function validTime(value){const raw=clean(value,80);if(!raw)return null;if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw))return localNewYorkToIso(raw);const date=new Date(raw);return Number.isNaN(date.getTime())?null:date.toISOString();}

function registerWebsiteConversationRoutes({
  app,db,auth,permit,customerConversationUpload,uploadDir,notifications=null,transactionalEmail=null,
  websiteBaseUrl="https://klavierhaus-home.onrender.com",env=process.env
}) {
  const upload=customerConversationUpload?customerConversationUpload.array("attachments",10):(_req,_res,next)=>next();
  const staff=permit?permit("ADMIN","MANAGER","WORKER"):(_req,_res,next)=>next();
  const admin=permit?permit("ADMIN"):(_req,_res,next)=>next();
  const tokenKey=encryptionKey(env);

  function normalizedIdentityName(value){return clean(value,200).replace(/\s+/g," ").toLowerCase();}
  function closeIfInactive(row){
    if(!row||row.status==="CLOSED")return row;
    const stamp=row.last_activity_at||row.last_message_at||row.created_at,when=stamp?new Date(stamp).getTime():NaN;
    if(!Number.isFinite(when)||Date.now()-when<CUSTOMER_INACTIVITY_MS)return row;
    db.prepare(`UPDATE customer_conversations SET status='CLOSED',closed_at=CURRENT_TIMESTAMP,auto_closed_at=CURRENT_TIMESTAMP,
      closure_note='CUSTOMER_INACTIVITY',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>'CLOSED'`).run(row.id);
    event(row.id,"AUTO_CLOSED",{fromStatus:row.status,toStatus:"CLOSED",details:{reason:"CUSTOMER_INACTIVITY",inactivity_ms:CUSTOMER_INACTIVITY_MS}});
    notifications?.resolveEntity("CUSTOMER_CONVERSATION",row.id);
    return db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(row.id);
  }
  function closeStaleConversations(){
    const threshold=new Date(Date.now()-CUSTOMER_INACTIVITY_MS).toISOString();
    const stale=db.prepare(`SELECT * FROM customer_conversations WHERE status<>'CLOSED'
      AND COALESCE(last_activity_at,last_message_at,created_at) <= ?`).all(threshold);
    stale.forEach(closeIfInactive);return stale.length;
  }
  function byToken(token){
    const row=db.prepare("SELECT * FROM customer_conversations WHERE public_token_hash=?").get(hash(token));
    return closeIfInactive(row);
  }
  function byId(conversationId){
    const row=db.prepare(`SELECT c.*,u.name AS assigned_user_name FROM customer_conversations c LEFT JOIN users u ON u.id=c.assigned_user_id WHERE c.id=?`).get(conversationId);
    if(!row)return row;const closed=closeIfInactive(row);
    return db.prepare(`SELECT c.*,u.name AS assigned_user_name FROM customer_conversations c LEFT JOIN users u ON u.id=c.assigned_user_id WHERE c.id=?`).get(closed.id);
  }
  function matchingConversation(name,mail,category){
    const normalized=normalizedIdentityName(name);
    return db.prepare(`SELECT * FROM customer_conversations WHERE lower(COALESCE(email,''))=? AND category=?
      ORDER BY updated_at DESC,created_at DESC`).all(mail,category).find(row=>normalizedIdentityName(row.name)===normalized)||null;
  }
  function supportRecipients(assignedUserId=null){
    if(assignedUserId)return [assignedUserId];
    let rows=db.prepare("SELECT id FROM users WHERE status='Active' AND role IN ('ADMIN','MANAGER') AND COALESCE(hidden_user,0)=0 ORDER BY role,name").all();
    if(!rows.length)rows=db.prepare("SELECT id FROM users WHERE status='Active' AND role='WORKER' AND COALESCE(hidden_user,0)=0 ORDER BY name").all();
    return rows.map(row=>row.id);
  }
  function attachmentRows(messageId,{token=null,conversationId=null}={}){
    return db.prepare("SELECT id,original_name,stored_name,mime_type,file_size FROM customer_message_attachments WHERE message_id=? ORDER BY created_at,id").all(messageId).map(row=>({
      ...row,
      url:token
        ?`/api/site/customer-conversations/${encodeURIComponent(token)}/attachments/${encodeURIComponent(row.id)}`
        :`/api/customer-conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(row.id)}`
    }));
  }
  function proposals(conversationId){
    return db.prepare(`SELECT p.*,u.name AS assigned_user_name FROM customer_appointment_proposals p LEFT JOIN users u ON u.id=p.assigned_user_id
      WHERE p.conversation_id=? ORDER BY p.created_at,p.id`).all(conversationId);
  }
  function payload(row,{token=null,staffView=false}={}){
    const messages=db.prepare("SELECT id,direction,sender_name,sender_email,sender_user_id,body,message_type,metadata_json,status,created_at FROM customer_messages WHERE conversation_id=? ORDER BY created_at,id").all(row.id)
      .map(message=>{let metadata={};try{metadata=JSON.parse(message.metadata_json||"{}");}catch(_error){}return {...message,metadata,attachments:attachmentRows(message.id,{token,conversationId:row.id})};});
    const linkedAppointments=db.prepare("SELECT * FROM private_appointments WHERE conversation_id=? ORDER BY scheduled_at DESC").all(row.id);
    const linkedIntake=db.prepare("SELECT id,status,reported_issue,estimated_total,created_at FROM intake_leads WHERE source_conversation_id=? ORDER BY id DESC LIMIT 1").get(row.id)||null;
    const linkedClient=row.client_id?db.prepare("SELECT id,name,email,phone,address,street,city,district,postcode,country,preferred_language,client_type,is_vip FROM clients WHERE id=?").get(row.client_id)||null:null;
    const linkedPianos=linkedClient?db.prepare("SELECT id,brand,model,serial_number,location_address,location_notes FROM pianos WHERE client_id=? ORDER BY id").all(linkedClient.id):[];
    return {...row,messages,appointment_proposals:proposals(row.id),private_appointments:linkedAppointments,linked_intake:linkedIntake,linked_client:linkedClient,linked_pianos:linkedPianos,support:supportState({db,env}),staff_view:staffView};
  }
  function saveFiles(files,conversationId,messageId){
    const insert=db.prepare("INSERT INTO customer_message_attachments(id,conversation_id,message_id,stored_name,original_name,mime_type,file_size,sha256) VALUES(?,?,?,?,?,?,?,?)");
    for(const file of files||[]){const bytes=fs.readFileSync(file.path);insert.run(id("ATT"),conversationId,messageId,path.basename(file.filename||file.path),clean(file.originalname,500),clean(file.mimetype,200),Number(file.size||bytes.length),crypto.createHash("sha256").update(bytes).digest("hex"));}
  }
  function event(conversationId,type,{actor=null,fromStatus=null,toStatus=null,details={}}={}){
    db.prepare("INSERT INTO customer_conversation_events(id,conversation_id,event_type,actor_user_id,actor_name,actor_role,from_status,to_status,details) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id("CEV"),conversationId,type,actor?.id||null,actor?.name||"Website visitor",actor?.role||"CUSTOMER",fromStatus,toStatus,JSON.stringify(details));
  }
  function notifyConversationOnce(row,{titleEn="New customer conversation",titleHu="Új ügyfélbeszélgetés",body="",severity="INFO",actor=null}={}){
    if(!row||!notifications)return false;
    const cycle=Math.max(1,Number(row.activity_cycle||1)),notified=Math.max(0,Number(row.last_notified_activity_cycle||0));
    if(notified>=cycle)return false;
    notifications.emit({
      category:"CUSTOMER_CONVERSATION",entityType:"CUSTOMER_CONVERSATION",entityId:row.id,titleEn,titleHu,
      bodyEn:body||`${row.name||"Website visitor"} · ${String(row.category||"").replaceAll("_"," ")}`,
      bodyHu:body||`${row.name||"Weboldali látogató"} · ${String(row.category||"").replaceAll("_"," ")}`,
      actionUrl:"#messenger",severity,actorUserId:actor?.id||null,recipients:supportRecipients(row.assigned_user_id)
    });
    db.prepare("UPDATE customer_conversations SET last_notified_activity_cycle=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND last_notified_activity_cycle<?").run(cycle,row.id,cycle);
    return true;
  }
  function conversationUrl(row){
    const token=decryptToken(row.public_token_encrypted,tokenKey);return token?`${String(websiteBaseUrl||"").replace(/\/$/,"")}/?conversation=${encodeURIComponent(token)}`:String(websiteBaseUrl||"");
  }
  async function sendOfflineAutoReply(row){
    if(!transactionalEmail?.configured||!validEmail(row.email))return {status:"NOT_CONFIGURED"};
    try{
      const result=await transactionalEmail.sendCustomerConversationAutoReply({to:row.email,name:row.name,conversationUrl:conversationUrl(row),language:row.language||"en",idempotencyKey:`conversation-offline-${row.id}`});
      event(row.id,"AUTO_REPLY_SENT",{details:{provider_message_id:result.providerMessageId}});return {status:"SENT",provider_message_id:result.providerMessageId};
    }catch(error){event(row.id,"AUTO_REPLY_FAILED",{details:{error:error.code||error.message}});return {status:"FAILED",error:error.code||error.message};}
  }

  app.get("/api/public/support-status",(_req,res)=>{res.setHeader("Cache-Control","no-store");res.json(supportState({db,env}));});

  app.post("/api/public/customer-conversations",upload,async(req,res)=>{
    const category=clean(req.body?.category||"OTHER",40).toUpperCase(),name=clean(req.body?.name,200),mail=email(req.body?.email),message=clean(req.body?.message,5000),language=req.body?.language==="hu"?"hu":"en";
    const consent=req.body?.consent_contact===true||["true","1","on"].includes(String(req.body?.consent_contact||"").toLowerCase());
    if(!name||!validEmail(mail)||!PUBLIC_CATEGORIES.has(category)||!consent){removeFiles(req.files);return res.status(400).json({error:"CONVERSATION_IDENTITY_REQUIRED",required_fields:["name","email","category"]});}
    const support=supportState({db,env}),existingRaw=matchingConversation(name,mail,category),existing=existingRaw?closeIfInactive(existingRaw):null;
    const token=crypto.randomBytes(32).toString("base64url"),customerMessageId=message||req.files?.length?id("MSG"):null;
    if(existing){
      const before=existing.status,wasClosed=before==="CLOSED",nextCycle=Math.max(1,Number(existing.activity_cycle||1))+(wasClosed?1:0);
      try{
        db.transaction(()=>{
          db.prepare(`UPDATE customer_conversations SET public_token_hash=?,public_token_encrypted=?,name=?,email=?,language=?,consent_contact=1,
            status='PENDING_STAFF',last_activity_at=CURRENT_TIMESTAMP,last_message_at=CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE last_message_at END,
            closed_at=NULL,auto_closed_at=NULL,closure_note=NULL,reopen_reason=CASE WHEN ?=1 THEN 'CUSTOMER_IDENTITY_MATCH' ELSE reopen_reason END,
            reopened_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE reopened_at END,reopened_by_user_id=CASE WHEN ?=1 THEN NULL ELSE reopened_by_user_id END,
            activity_cycle=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
            .run(hash(token),encryptToken(token,tokenKey),name,mail,language,customerMessageId,wasClosed?1:0,wasClosed?1:0,wasClosed?1:0,nextCycle,existing.id);
          if(customerMessageId){
            db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')")
              .run(customerMessageId,existing.id,"CUSTOMER",name,mail,message||"");
            saveFiles(req.files,existing.id,customerMessageId);
          }
          event(existing.id,wasClosed?"CUSTOMER_REOPENED":"CUSTOMER_RESUMED",{fromStatus:before,toStatus:"PENDING_STAFF",details:{message_id:customerMessageId,activity_cycle:nextCycle,support_open:support.open}});
        })();
      }catch(error){removeFiles(req.files);return res.status(500).json({error:"CONVERSATION_RESUME_FAILED"});}
      const row=byId(existing.id);
      if(wasClosed||customerMessageId)notifyConversationOnce(row,{titleEn:wasClosed?"Customer reopened conversation":"Customer returned to conversation",titleHu:wasClosed?"Ügyfél újranyitotta a beszélgetést":"Ügyfél visszatért a beszélgetéshez",body:`${name} · ${category.replaceAll("_"," ")}${message?` · ${message.slice(0,220)}`:""}`});
      return res.status(200).json({...payload(byId(existing.id),{token}),access_token:token,resumed:true,reopened:wasClosed,outside_support_hours:!support.open});
    }

    const conversationId=id("CONV"),welcomeMessageId=id("MSG");
    try{
      db.transaction(()=>{
        const linked=ensureClientIdentity(db,{name,email:mail,language},{create:true}).client;
        db.prepare(`INSERT INTO customer_conversations(id,public_token_hash,public_token_encrypted,name,email,client_id,language,category,status,consent_contact,source_path,metadata_json,last_message_at,last_activity_at,activity_cycle,last_notified_activity_cycle)
          VALUES(?,?,?,?,?,?,?,?,'PENDING_STAFF',1,?,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1,0)`).run(conversationId,hash(token),encryptToken(token,tokenKey),linked?.name||name,linked?.email||mail,linked?.id||null,language,category,clean(req.body?.source_path,1000)||null);
        const welcome=support.open
          ?(language==="hu"?"Üdvözöljük a Klavierhaus ügyfélszolgálatán! Hogyan segíthetünk Önnek?":"Welcome to Klavierhaus Customer Service. How may we assist you?")
          :(language==="hu"
            ?"Üdvözöljük a Klavierhaus ügyfélszolgálatán! Ügyfélszolgálatunk jelenleg nem elérhető. Munkatársaink 9:00 és 17:00 között érhetők el. Addig kérjük, írja le a problémát, és szükség esetén küldjön fényképet, videót vagy további információt."
            :"Welcome to Klavierhaus Customer Service. Our customer service team is currently unavailable and is available from 9:00 AM to 5:00 PM New York time. In the meantime, please describe the problem and send a photo, video, or any other helpful details.");
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,body,status) VALUES(?,?,?,?,?,'READ')").run(welcomeMessageId,conversationId,"STAFF","Klavierhaus Customer Service",welcome);
        if(customerMessageId){
          db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')").run(customerMessageId,conversationId,"CUSTOMER",name,mail,message||"");
          saveFiles(req.files,conversationId,customerMessageId);
        }
        event(conversationId,"CREATED",{toStatus:"PENDING_STAFF",details:{message_id:customerMessageId,support_open:support.open,activity_cycle:1}});
      })();
    }catch(error){removeFiles(req.files);return res.status(500).json({error:"CONVERSATION_CREATE_FAILED"});}
    const row=byId(conversationId);notifyConversationOnce(row,{body:`${name} · ${category.replaceAll("_"," ")}${message?` · ${message.slice(0,220)}`:""}`});
    const autoReply=!support.open?await sendOfflineAutoReply(row):{status:"NOT_REQUIRED"};
    res.status(201).json({...payload(byId(conversationId),{token}),access_token:token,resumed:false,outside_support_hours:!support.open,auto_reply_delivery:autoReply});
  });

  app.post("/api/public/customer-conversations/lookup",(req,res)=>{
    if(!validEmail(req.body?.email))return res.status(400).json({error:"VALID_CONVERSATION_EMAIL_REQUIRED"});
    res.setHeader("Cache-Control","no-store");res.status(202).json({ok:true});
  });

  app.get("/api/public/customer-conversations/:token",(req,res)=>{
    const row=byToken(req.params.token);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    res.setHeader("Cache-Control","no-store");res.json(payload(row,{token:req.params.token}));
  });

  app.post("/api/public/customer-conversations/:token/customer-profile",(req,res)=>{
    const row=byToken(req.params.token);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    if(row.status==="CLOSED")return res.status(409).json({error:"CONVERSATION_REAUTH_REQUIRED"});
    const phone=clean(req.body?.phone,120),address=clean(req.body?.address,500),pianoId=Number(req.body?.piano_id)||null;
    const brand=clean(req.body?.piano_brand,200),model=clean(req.body?.piano_model,200),serial=clean(req.body?.piano_serial,120),locationAddress=clean(req.body?.piano_location_address||address,500);
    if(!phone)return res.status(400).json({error:"CUSTOMER_PROFILE_PHONE_REQUIRED"});
    let client=row.client_id?db.prepare("SELECT * FROM clients WHERE id=?").get(row.client_id):findClientIdentity(db,{name:row.name,email:row.email,phone}).client;
    let savedPiano=null;
    try{
      db.transaction(()=>{
        if(!client){
          client=ensureClientIdentity(db,{name:row.name,email:row.email,phone,language:row.language},{create:true}).client;
          if(!client)throw new Error("CUSTOMER_PROFILE_IDENTITY_FAILED");
          db.prepare("UPDATE customer_conversations SET client_id=? WHERE id=?").run(client.id,row.id);
        }
        db.prepare("UPDATE clients SET phone=?,address=COALESCE(NULLIF(?,''),address),updated_at=CURRENT_TIMESTAMP WHERE id=?").run(phone,address,client.id);
        if(pianoId){
          savedPiano=db.prepare("SELECT * FROM pianos WHERE id=? AND client_id=?").get(pianoId,client.id);
          if(!savedPiano)throw Object.assign(new Error("CUSTOMER_PIANO_NOT_FOUND"),{status:404});
          if(locationAddress)db.prepare("UPDATE pianos SET location_address=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(locationAddress,savedPiano.id);
          savedPiano=db.prepare("SELECT * FROM pianos WHERE id=?").get(savedPiano.id);
        }else if(brand||model||serial){
          savedPiano=serial?db.prepare("SELECT * FROM pianos WHERE client_id=? AND lower(COALESCE(serial_number,''))=lower(?) ORDER BY id LIMIT 1").get(client.id,serial):null;
          if(!savedPiano&&brand&&model)savedPiano=db.prepare("SELECT * FROM pianos WHERE client_id=? AND lower(brand)=lower(?) AND lower(COALESCE(model,''))=lower(?) ORDER BY id LIMIT 1").get(client.id,brand,model);
          if(savedPiano){
            db.prepare("UPDATE pianos SET brand=COALESCE(NULLIF(?,''),brand),model=COALESCE(NULLIF(?,''),model),serial_number=COALESCE(NULLIF(?,''),serial_number),location_address=COALESCE(NULLIF(?,''),location_address),updated_at=CURRENT_TIMESTAMP WHERE id=?")
              .run(brand,model,serial,locationAddress,savedPiano.id);
            savedPiano=db.prepare("SELECT * FROM pianos WHERE id=?").get(savedPiano.id);
          }else{
            const info=db.prepare("INSERT INTO pianos(client_id,brand,model,serial_number,location_address,classification_status,created_at,updated_at) VALUES(?,?,?,?,?,'CLASSIFIED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
              .run(client.id,brand||"No brand",model||null,serial||null,locationAddress||null);
            savedPiano=db.prepare("SELECT * FROM pianos WHERE id=?").get(Number(info.lastInsertRowid));
          }
        }
        const messageId=id("MSG"),metadata=JSON.stringify({client_id:client.id,phone,address,piano:savedPiano?{id:savedPiano.id,brand:savedPiano.brand,model:savedPiano.model,serial_number:savedPiano.serial_number,location_address:savedPiano.location_address}:null});
        db.prepare(`INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,message_type,metadata_json,status)
          VALUES(?,?,?,?,?,?,'CUSTOMER_PROFILE_SUBMITTED',?,'UNREAD')`).run(messageId,row.id,"CUSTOMER",row.name||client.name,row.email||client.email||null,"Customer and piano details submitted",metadata);
        db.prepare("UPDATE customer_conversations SET status='PENDING_STAFF',client_id=?,last_message_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(client.id,row.id);
        event(row.id,"CUSTOMER_PROFILE_SUBMITTED",{fromStatus:row.status,toStatus:"PENDING_STAFF",details:{message_id:messageId,client_id:client.id,piano_id:savedPiano?.id||null}});
      })();
    }catch(error){return res.status(error.status||400).json({error:error.message||"CUSTOMER_PROFILE_FAILED"});}
    const after=byId(row.id);notifyConversationOnce(after,{titleEn:"Customer details received",titleHu:"Ügyféladatok beérkeztek",body:`${row.name||"Website visitor"} · customer/piano details updated`});
    res.status(201).json(payload(after,{token:req.params.token}));
  });

  app.post("/api/public/customer-conversations/:token/messages",upload,(req,res)=>{
    const row=byToken(req.params.token);if(!row){removeFiles(req.files);return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});}
    if(row.status==="CLOSED"){removeFiles(req.files);return res.status(409).json({error:"CONVERSATION_REAUTH_REQUIRED",required_fields:["name","email","category"],reason:row.closure_note||"CLOSED"});}
    const body=clean(req.body?.message,5000);if(!body&&!(req.files||[]).length){removeFiles(req.files);return res.status(400).json({error:"MESSAGE_REQUIRED"});}
    const messageId=id("MSG"),before=row.status;
    try{
      db.transaction(()=>{
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')").run(messageId,row.id,"CUSTOMER",row.name||"Guest",row.email||null,body);
        saveFiles(req.files,row.id,messageId);
        db.prepare("UPDATE customer_conversations SET status='PENDING_STAFF',last_message_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
        event(row.id,"CUSTOMER_MESSAGE",{fromStatus:before,toStatus:"PENDING_STAFF",details:{message_id:messageId,activity_cycle:Number(row.activity_cycle||1)}});
      })();
    }catch(error){removeFiles(req.files);return res.status(500).json({error:"CONVERSATION_MESSAGE_FAILED"});}
    const after=byId(row.id);notifyConversationOnce(after,{titleEn:"Customer reply",titleHu:"Ügyfélválasz",body:`${row.name||"Website visitor"} · ${(body||((req.files||[]).length+" media attachment(s)")).slice(0,220)}`});
    res.status(201).json(payload(after,{token:req.params.token}));
  });

  app.post("/api/public/customer-conversations/:token/appointment-proposals/:proposalId/respond",(req,res)=>{
    const row=byToken(req.params.token);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    const proposal=db.prepare("SELECT * FROM customer_appointment_proposals WHERE id=? AND conversation_id=?").get(req.params.proposalId,row.id);
    if(!proposal)return res.status(404).json({error:"APPOINTMENT_PROPOSAL_NOT_FOUND"});
    if(proposal.status!=="PROPOSED")return res.status(409).json({error:"APPOINTMENT_PROPOSAL_ALREADY_RESOLVED"});
    if(proposal.expires_at&&new Date(proposal.expires_at)<=new Date())return res.status(409).json({error:"APPOINTMENT_PROPOSAL_EXPIRED"});
    const decision=clean(req.body?.decision,20).toUpperCase();if(!["ACCEPTED","DECLINED"].includes(decision))return res.status(400).json({error:"INVALID_APPOINTMENT_DECISION"});
    const request=db.prepare("SELECT * FROM private_appointment_requests WHERE proposal_id=?").get(proposal.id)||null;
    let appointmentId=null,slot=null,linkedClient=null;
    if(decision==="ACCEPTED"){
      const phone=clean(proposal.phone||request?.phone,80);if(!phone)return res.status(409).json({error:"PRIVATE_APPOINTMENT_PHONE_REQUIRED"});
      try{slot=assertAvailable(db,{startsAt:proposal.starts_at,endsAt:proposal.ends_at,excludeProposalId:proposal.id});}catch(error){return res.status(error.status||409).json({error:error.message,details:error.details});}
      linkedClient=row.client_id?db.prepare("SELECT * FROM clients WHERE id=?").get(row.client_id):null;
      if(!linkedClient)linkedClient=ensureClientIdentity(db,{name:row.name||request?.name,email:row.email||request?.email,phone,language:row.language||request?.language},{create:true}).client;
      appointmentId=id("PA");
      db.transaction(()=>{
        db.prepare(`INSERT INTO private_appointments(id,appointment_type,name,email,phone,scheduled_at,scheduled_end_at,duration_min,note,conversation_id,client_id,piano_id,service_id,status,assigned_user_id,language,source_path,created_source,created_by_user_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'SCHEDULED',?,?,?,?,?)`).run(
          appointmentId,proposal.appointment_type,row.name||request?.name||"Guest",row.email||request?.email||null,phone,slot.starts_at,slot.ends_at,slot.duration_min,proposal.note||request?.note||null,row.id,linkedClient?.id||request?.client_id||null,
          request?.piano_id||null,request?.service_id||null,proposal.assigned_user_id||row.assigned_user_id||null,row.language||request?.language||"en",row.source_path||request?.source_path||null,"ERP",proposal.created_by_user_id||null
        );
        db.prepare("UPDATE customer_appointment_proposals SET status='ACCEPTED',private_appointment_id=?,responded_at=CURRENT_TIMESTAMP,expires_at=NULL,finalized_at=CURRENT_TIMESTAMP,finalized_by_user_id=created_by_user_id,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(appointmentId,proposal.id);
        db.prepare("UPDATE customer_conversations SET client_id=COALESCE(client_id,?),status='OPEN',last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(linkedClient?.id||request?.client_id||null,row.id);
        if(request)db.prepare("UPDATE private_appointment_requests SET status='APPROVED',client_id=COALESCE(client_id,?),private_appointment_id=?,assigned_user_id=COALESCE(assigned_user_id,?),reviewed_by_user_id=COALESCE(reviewed_by_user_id,?),reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(linkedClient?.id||null,appointmentId,proposal.assigned_user_id||null,proposal.created_by_user_id||null,request.id);
        event(row.id,"APPOINTMENT_ACCEPTED",{toStatus:"OPEN",details:{proposal_id:proposal.id,private_appointment_id:appointmentId,auto_finalized:true}});
      })();
    }else{
      db.transaction(()=>{
        db.prepare("UPDATE customer_appointment_proposals SET status='DECLINED',responded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(proposal.id);
        db.prepare("UPDATE customer_conversations SET status='PENDING_STAFF',last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
        db.prepare("UPDATE private_appointment_requests SET status='REQUESTED',proposal_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE proposal_id=? AND status='PROPOSED'").run(proposal.id);
        event(row.id,"APPOINTMENT_DECLINED",{toStatus:"PENDING_STAFF",details:{proposal_id:proposal.id}});
      })();
    }
    const after=byId(row.id);
    if(notifications)notifications.emit({category:"PRIVATE_APPOINTMENT",entityType:decision==="ACCEPTED"?"PRIVATE_APPOINTMENT":"CUSTOMER_CONVERSATION",entityId:appointmentId||row.id,titleEn:decision==="ACCEPTED"?"Customer accepted · appointment scheduled":"Customer requested another appointment time",titleHu:decision==="ACCEPTED"?"Ügyfél elfogadta · időpont naptárba helyezve":"Az ügyfél másik időpontot kér",bodyEn:`${row.name||"Customer"} · ${formatNy(new Date(proposal.starts_at))}`,bodyHu:`${row.name||"Ügyfél"} · ${formatNy(new Date(proposal.starts_at))}`,actionUrl:decision==="ACCEPTED"?"/?view=workshop&private=1":"#messenger",severity:decision==="ACCEPTED"?"SUCCESS":"INFO",recipients:supportRecipients(proposal.assigned_user_id||row.assigned_user_id)});
    res.json(payload(after,{token:req.params.token}));
  });

  app.get("/api/public/customer-conversations/:token/attachments/:attachmentId",(req,res)=>{
    const row=byToken(req.params.token);if(!row)return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    const attachment=db.prepare("SELECT * FROM customer_message_attachments WHERE id=? AND conversation_id=?").get(req.params.attachmentId,row.id);
    if(!attachment)return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    const filePath=path.join(uploadDir,"customer-conversations",path.basename(attachment.stored_name));if(!fs.existsSync(filePath))return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    res.type(attachment.mime_type);res.setHeader("Content-Disposition",`inline; filename="${String(attachment.original_name||"attachment").replace(/[\r\n"]/g,"_")}"`);res.sendFile(filePath);
  });

  app.get("/api/customer-conversations",auth,staff,(req,res)=>{
    closeStaleConversations();
    const status=clean(req.query.status,40).toUpperCase(),q=clean(req.query.q,200).toLowerCase(),args=[],where=[];
    if(status&&["OPEN","PENDING_CUSTOMER","PENDING_STAFF","CLOSED"].includes(status)){where.push("c.status=?");args.push(status);}
    if(q){where.push("(lower(COALESCE(c.name,'')) LIKE ? OR lower(COALESCE(c.email,'')) LIKE ? OR lower(c.category) LIKE ?)");args.push(`%${q}%`,`%${q}%`,`%${q}%`);}
    const rows=db.prepare(`SELECT c.*,u.name AS assigned_user_name,
      (SELECT COUNT(*) FROM customer_messages m WHERE m.conversation_id=c.id AND m.direction='CUSTOMER' AND m.status='UNREAD') AS unread_count,
      (SELECT body FROM customer_messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC,lm.id DESC LIMIT 1) AS last_message,
      (SELECT direction FROM customer_messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC,lm.id DESC LIMIT 1) AS last_message_direction,
      (SELECT created_at FROM customer_messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC,lm.id DESC LIMIT 1) AS last_message_at,
      (SELECT created_at FROM customer_messages cm WHERE cm.conversation_id=c.id AND cm.direction='CUSTOMER' ORDER BY cm.created_at DESC,cm.id DESC LIMIT 1) AS last_customer_message_at
      FROM customer_conversations c LEFT JOIN users u ON u.id=c.assigned_user_id
      ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY CASE WHEN c.status='PENDING_STAFF' THEN 0 WHEN c.status='OPEN' THEN 1 ELSE 2 END,c.last_activity_at DESC,c.created_at DESC LIMIT 300`).all(...args);
    const conversations=rows.map(row=>{
      const raw=String(row.last_customer_message_at||"").trim(),stamp=raw?(new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw)?raw:raw.replace(" ","T")+"Z")):null;
      const outsideHours=Boolean(row.status==="PENDING_STAFF"&&stamp&&!Number.isNaN(stamp.getTime())&&!supportState({db,env,date:stamp}).open);
      return {...row,waiting_after_hours:outsideHours?1:0};
    });
    res.json({support:supportState({db,env}),conversations});
  });

  app.get("/api/customer-conversations/:id",auth,staff,(req,res)=>{
    const row=byId(req.params.id);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    db.prepare("UPDATE customer_messages SET status='READ' WHERE conversation_id=? AND direction='CUSTOMER' AND status='UNREAD'").run(row.id);
    res.json(payload(byId(row.id),{staffView:true}));
  });

  app.post("/api/customer-conversations/:id/reply",auth,staff,upload,async(req,res)=>{
    const row=byId(req.params.id);if(!row){removeFiles(req.files);return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});}
    const body=clean(req.body?.message,5000);if(!body){removeFiles(req.files);return res.status(400).json({error:"MESSAGE_REQUIRED"});}
    const messageId=id("MSG"),before=row.status;
    try{
      db.transaction(()=>{
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,sender_user_id,body,status) VALUES(?,?,?,?,?,?,?,'READ')")
          .run(messageId,row.id,"STAFF",req.user.name||"Klavierhaus",req.user.email||null,req.user.id,body);
        saveFiles(req.files,row.id,messageId);
        db.prepare("UPDATE customer_conversations SET status='PENDING_CUSTOMER',assigned_user_id=COALESCE(assigned_user_id,?),last_message_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id,row.id);
        event(row.id,"STAFF_REPLY",{actor:req.user,fromStatus:before,toStatus:"PENDING_CUSTOMER",details:{message_id:messageId}});
      })();
    }catch(error){removeFiles(req.files);return res.status(500).json({error:"CONVERSATION_REPLY_FAILED"});}
    let delivery={status:"NOT_CONFIGURED"};
    if(validEmail(row.email)&&transactionalEmail?.configured){
      try{
        const result=await transactionalEmail.sendCustomerConversationReply({to:row.email,name:row.name,message:body,conversationUrl:conversationUrl(row),language:row.language||"en",idempotencyKey:`conversation-reply-${messageId}`});
        delivery={status:"SENT",provider_message_id:result.providerMessageId};
      }catch(error){delivery={status:"FAILED",error:error.code||error.message};notifications?.emit({category:"AUTOMATION_FAILURE",entityType:"CUSTOMER_CONVERSATION",entityId:row.id,titleEn:"Customer reply email failed",titleHu:"Ügyfélválasz e-mail sikertelen",bodyEn:row.email||"",bodyHu:row.email||"",actionUrl:"#messenger",severity:"WARNING",recipients:[req.user.id]});}
    }
    res.status(201).json({...payload(byId(row.id),{staffView:true}),email_delivery:delivery});
  });

  app.post("/api/customer-conversations/:id/interactions",auth,staff,async(req,res)=>{
    const row=byId(req.params.id);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    const type=clean(req.body?.type,60).toUpperCase();
    if(!["CUSTOMER_PROFILE_FORM","PRIVATE_APPOINTMENT_PICKER"].includes(type))return res.status(400).json({error:"INVALID_INTERACTION_TYPE"});
    const client=row.client_id?db.prepare("SELECT * FROM clients WHERE id=?").get(row.client_id):findClientIdentity(db,{name:row.name,email:row.email}).client;
    const pianos=client?db.prepare("SELECT id,brand,model,serial_number,location_address,location_notes FROM pianos WHERE client_id=? ORDER BY id").all(client.id):[];
    const metadata=type==="CUSTOMER_PROFILE_FORM"
      ?{name:client?.name||row.name||"",email:client?.email||row.email||"",phone:client?.phone||"",address:client?.address||"",pianos}
      :{name:client?.name||row.name||"",email:client?.email||row.email||"",phone:client?.phone||"",appointment_reason:"OTHER",duration_min:60};
    const messageId=id("MSG"),body=type==="CUSTOMER_PROFILE_FORM"?"Please complete your customer and piano details.":"Please choose a private appointment time.";
    db.transaction(()=>{
      db.prepare(`INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,sender_user_id,body,message_type,metadata_json,status)
        VALUES(?,?,?,?,?,?,?,?,?,'READ')`).run(messageId,row.id,"STAFF",req.user.name||"Klavierhaus",req.user.email||null,req.user.id,body,type,JSON.stringify(metadata));
      db.prepare("UPDATE customer_conversations SET status='PENDING_CUSTOMER',assigned_user_id=COALESCE(assigned_user_id,?),last_message_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id,row.id);
      event(row.id,"INTERACTION_SENT",{actor:req.user,fromStatus:row.status,toStatus:"PENDING_CUSTOMER",details:{message_id:messageId,type}});
    })();
    let delivery={status:"NOT_CONFIGURED"};
    if(validEmail(row.email)&&transactionalEmail?.configured){
      try{
        const sent=await transactionalEmail.sendCustomerConversationReply({to:row.email,name:row.name,message:body,conversationUrl:conversationUrl(row),language:row.language||"en",idempotencyKey:`conversation-interaction-${messageId}`});
        delivery={status:"SENT",provider_message_id:sent.providerMessageId};
      }catch(error){delivery={status:"FAILED",error:error.code||error.message};}
    }
    res.status(201).json({...payload(byId(row.id),{staffView:true}),email_delivery:delivery});
  });

  app.put("/api/customer-conversations/:id/assign",auth,staff,(req,res)=>{
    const row=byId(req.params.id);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    const userId=clean(req.body?.assigned_user_id,160)||req.user.id;
    if(userId&&!db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(userId))return res.status(400).json({error:"INVALID_CONVERSATION_ASSIGNEE"});
    db.prepare("UPDATE customer_conversations SET assigned_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(userId,row.id);
    event(row.id,"ASSIGNED",{actor:req.user,details:{assigned_user_id:userId}});res.json(payload(byId(row.id),{staffView:true}));
  });

  app.put("/api/customer-conversations/:id/status",auth,staff,(req,res)=>{
    const row=byId(req.params.id);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    const status=clean(req.body?.status,40).toUpperCase();if(!["OPEN","PENDING_CUSTOMER","PENDING_STAFF","CLOSED"].includes(status))return res.status(400).json({error:"INVALID_CONVERSATION_STATUS"});
    const reopening=row.status==="CLOSED"&&status!=="CLOSED",nextCycle=Math.max(1,Number(row.activity_cycle||1))+(reopening?1:0);
    db.prepare(`UPDATE customer_conversations SET status=?,closed_at=CASE WHEN ?='CLOSED' THEN CURRENT_TIMESTAMP ELSE NULL END,
      auto_closed_at=CASE WHEN ?='CLOSED' THEN auto_closed_at ELSE NULL END,
      closure_note=CASE WHEN ?='CLOSED' THEN COALESCE(closure_note,'STAFF_CLOSED') ELSE NULL END,
      reopen_reason=CASE WHEN ?=1 THEN 'STAFF_REOPENED' ELSE reopen_reason END,reopened_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE reopened_at END,
      reopened_by_user_id=CASE WHEN ?=1 THEN ? ELSE reopened_by_user_id END,activity_cycle=?,
      last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status,status,status,status,reopening?1:0,reopening?1:0,reopening?1:0,req.user.id,nextCycle,row.id);
    event(row.id,reopening?"STAFF_REOPENED":"STATUS_CHANGED",{actor:req.user,fromStatus:row.status,toStatus:status,details:{activity_cycle:nextCycle}});
    if(status==="CLOSED")notifications?.resolveEntity("CUSTOMER_CONVERSATION",row.id);
    res.json(payload(byId(row.id),{staffView:true}));
  });

  app.post("/api/customer-conversations/:id/appointment-proposals",auth,staff,(req,res)=>{
    const row=byId(req.params.id);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    const startsAt=validTime(req.body?.starts_at);if(!startsAt)return res.status(400).json({error:"INVALID_APPOINTMENT_TIME"});
    let slot;try{slot=assertAvailable(db,{startsAt,endsAt:req.body?.ends_at,duration:req.body?.duration_min||60});}catch(error){return res.status(error.status||409).json({error:error.message,details:error.details});}
    const type=clean(req.body?.appointment_type||"PRIVATE_VISIT",40).toUpperCase();if(!["PRIVATE_VISIT","PIANO_VIEWING","SERVICE_CONSULTATION"].includes(type))return res.status(400).json({error:"INVALID_APPOINTMENT_TYPE"});
    const assigned=clean(req.body?.assigned_user_id,160)||row.assigned_user_id||req.user.id;if(assigned&&!db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assigned))return res.status(400).json({error:"INVALID_APPOINTMENT_ASSIGNEE"});
    const linked=row.client_id?db.prepare("SELECT phone FROM clients WHERE id=?").get(row.client_id):null,proposalPhone=clean(req.body?.phone,80)||clean(linked?.phone,80);if(!proposalPhone)return res.status(400).json({error:"PRIVATE_APPOINTMENT_PHONE_REQUIRED"});
    const proposalId=id("APR"),expiry=holdExpiry();
    db.transaction(()=>{
      const reason=["PIANO_VIEWING","SERVICE_REQUEST","OTHER"].includes(clean(req.body?.appointment_reason,40).toUpperCase())?clean(req.body?.appointment_reason,40).toUpperCase():(type==="PIANO_VIEWING"?"PIANO_VIEWING":type==="SERVICE_CONSULTATION"?"SERVICE_REQUEST":"OTHER");
      db.prepare(`INSERT INTO customer_appointment_proposals(id,conversation_id,appointment_type,starts_at,ends_at,assigned_user_id,phone,appointment_reason,note,status,created_by_user_id,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?, 'PROPOSED',?,?)`).run(proposalId,row.id,type,slot.starts_at,slot.ends_at,assigned,proposalPhone,reason,clean(req.body?.note,1000)||null,req.user.id,expiry);
      db.prepare("UPDATE customer_conversations SET status='PENDING_CUSTOMER',assigned_user_id=COALESCE(assigned_user_id,?),last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(assigned,row.id);
      event(row.id,"APPOINTMENT_PROPOSED",{actor:req.user,fromStatus:row.status,toStatus:"PENDING_CUSTOMER",details:{proposal_id:proposalId,starts_at:slot.starts_at,ends_at:slot.ends_at,duration_min:slot.duration_min,expires_at:expiry}});
    })();
    res.status(201).json(payload(byId(row.id),{staffView:true}));
  });

  app.get("/api/customer-conversations/:id/intake-draft",auth,staff,(req,res)=>{
    const row=byId(req.params.id);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    const customerMessages=db.prepare("SELECT body FROM customer_messages WHERE conversation_id=? AND direction='CUSTOMER' ORDER BY created_at,id LIMIT 8").all(row.id).map(item=>item.body).filter(Boolean);
    const client=row.client_id?db.prepare("SELECT * FROM clients WHERE id=?").get(row.client_id):findClientIdentity(db,{name:row.name,email:row.email}).client;
    res.json({
      source_conversation_id:row.id,client_id:client?.id||null,client_name:client?.name||row.name||"",client_email:client?.email||row.email||"",client_phone:client?.phone||"",client_type:client?.client_type||"INDIVIDUAL",raw_client_name:client?.name||row.name||"",raw_contact:client?.email||client?.phone||row.email||"",
      reported_issue:customerMessages.join("\n\n")||`${row.category} enquiry`,service_location:"workshop",estimated_urgency:"normal",
      assigned_technician_id:row.assigned_user_id||null
    });
  });

  app.post("/api/customer-conversations/:id/create-intake",auth,staff,(req,res)=>{
    const row=byId(req.params.id);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    return res.status(409).json({error:"INTAKE_REQUIRES_REVIEW",message:"Open the editable Intake draft and save it before approval."});
  });

  app.get("/api/customer-conversations/:id/attachments/:attachmentId",auth,staff,(req,res)=>{
    const attachment=db.prepare("SELECT * FROM customer_message_attachments WHERE id=? AND conversation_id=?").get(req.params.attachmentId,req.params.id);
    if(!attachment)return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    const filePath=path.join(uploadDir,"customer-conversations",path.basename(attachment.stored_name));if(!fs.existsSync(filePath))return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    res.type(attachment.mime_type).download(filePath,attachment.original_name);
  });

  const inactivityTimer=setInterval(()=>{try{closeStaleConversations();}catch(error){console.warn("[CUSTOMER-CONVERSATION-INACTIVITY]",error.message);}},5000);
  inactivityTimer.unref?.();

  app.get("/api/support/holidays",auth,admin,(_req,res)=>res.json(db.prepare("SELECT * FROM support_holidays ORDER BY holiday_date").all()));
  app.put("/api/support/holidays/:date",auth,admin,(req,res)=>{
    const date=clean(req.params.date,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return res.status(400).json({error:"INVALID_SUPPORT_HOLIDAY_DATE"});
    db.prepare(`INSERT INTO support_holidays(holiday_date,label,enabled,updated_by_user_id,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(holiday_date) DO UPDATE SET label=excluded.label,enabled=excluded.enabled,updated_by_user_id=excluded.updated_by_user_id,updated_at=CURRENT_TIMESTAMP`)
      .run(date,clean(req.body?.label,240)||null,req.body?.enabled===false?0:1,req.user.id);
    res.json(db.prepare("SELECT * FROM support_holidays WHERE holiday_date=?").get(date));
  });
}

module.exports={registerWebsiteConversationRoutes,PUBLIC_CATEGORIES};

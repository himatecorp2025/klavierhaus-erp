"use strict";

const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {supportState}=require("./support-calendar");
const {assertAvailable,interval,holdExpiry}=require("./private-appointment-scheduling");

const PUBLIC_CATEGORIES=new Set(["SERVICE","TECHNICAL","PIANO","REPAIR","PRIVATE_CONSULTATION","BILLING","OTHER"]);
const IDENTITY_REQUIRED=new Set(["SERVICE","PIANO","REPAIR","PRIVATE_CONSULTATION","BILLING"]);
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

  function byToken(token){return db.prepare("SELECT * FROM customer_conversations WHERE public_token_hash=?").get(hash(token));}
  function byId(conversationId){return db.prepare(`SELECT c.*,u.name AS assigned_user_name FROM customer_conversations c LEFT JOIN users u ON u.id=c.assigned_user_id WHERE c.id=?`).get(conversationId);}
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
    const messages=db.prepare("SELECT id,direction,sender_name,sender_email,sender_user_id,body,status,created_at FROM customer_messages WHERE conversation_id=? ORDER BY created_at,id").all(row.id)
      .map(message=>({...message,attachments:attachmentRows(message.id,{token,conversationId:row.id})}));
    const linkedAppointments=db.prepare("SELECT * FROM private_appointments WHERE conversation_id=? ORDER BY scheduled_at DESC").all(row.id);
    const linkedIntake=db.prepare("SELECT id,status,reported_issue,estimated_total,created_at FROM intake_leads WHERE source_conversation_id=? ORDER BY id DESC LIMIT 1").get(row.id)||null;
    return {...row,messages,appointment_proposals:proposals(row.id),private_appointments:linkedAppointments,linked_intake:linkedIntake,support:supportState({db,env}),staff_view:staffView};
  }
  function saveFiles(files,conversationId,messageId){
    const insert=db.prepare("INSERT INTO customer_message_attachments(id,conversation_id,message_id,stored_name,original_name,mime_type,file_size,sha256) VALUES(?,?,?,?,?,?,?,?)");
    for(const file of files||[]){const bytes=fs.readFileSync(file.path);insert.run(id("ATT"),conversationId,messageId,path.basename(file.filename||file.path),clean(file.originalname,500),clean(file.mimetype,200),Number(file.size||bytes.length),crypto.createHash("sha256").update(bytes).digest("hex"));}
  }
  function event(conversationId,type,{actor=null,fromStatus=null,toStatus=null,details={}}={}){
    db.prepare("INSERT INTO customer_conversation_events(id,conversation_id,event_type,actor_user_id,actor_name,actor_role,from_status,to_status,details) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id("CEV"),conversationId,type,actor?.id||null,actor?.name||"Website visitor",actor?.role||"CUSTOMER",fromStatus,toStatus,JSON.stringify(details));
  }
  function notifyConversation(row,{titleEn="New customer message",titleHu="Új ügyfélüzenet",body="",severity="INFO",actor=null}={}){
    if(!row||!notifications)return;
    notifications.emit({
      category:"CUSTOMER_CONVERSATION",entityType:"CUSTOMER_CONVERSATION",entityId:row.id,titleEn,titleHu,
      bodyEn:body||`${row.name||"Website visitor"} · ${String(row.category||"").replaceAll("_"," ")}`,
      bodyHu:body||`${row.name||"Weboldali látogató"} · ${String(row.category||"").replaceAll("_"," ")}`,
      actionUrl:"#messenger",severity,actorUserId:actor?.id||null,recipients:supportRecipients(row.assigned_user_id)
    });
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
    const category=clean(req.body?.category||"OTHER",40).toUpperCase(),name=clean(req.body?.name,200),mail=email(req.body?.email),message=clean(req.body?.message,5000);
    const consent=req.body?.consent_contact===true||["true","1","on"].includes(String(req.body?.consent_contact||"").toLowerCase());
    if(!message||!PUBLIC_CATEGORIES.has(category)||!consent){removeFiles(req.files);return res.status(400).json({error:"VALID_CONVERSATION_FIELDS_REQUIRED"});}
    if(mail&&!validEmail(mail)){removeFiles(req.files);return res.status(400).json({error:"INVALID_CONVERSATION_EMAIL"});}
    if(IDENTITY_REQUIRED.has(category)&&(!name||!validEmail(mail))){removeFiles(req.files);return res.status(400).json({error:"CONVERSATION_IDENTITY_REQUIRED",required_fields:["name","email"]});}
    const token=crypto.randomBytes(32).toString("base64url"),conversationId=id("CONV"),messageId=id("MSG"),support=supportState({db,env});
    try{
      db.transaction(()=>{
        db.prepare(`INSERT INTO customer_conversations(id,public_token_hash,public_token_encrypted,name,email,language,category,status,consent_contact,source_path,metadata_json,last_message_at,last_activity_at)
          VALUES(?,?,?,?,?,?,?,'PENDING_STAFF',1,?,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run(conversationId,hash(token),encryptToken(token,tokenKey),name||null,mail||null,req.body?.language==="hu"?"hu":"en",category,clean(req.body?.source_path,1000)||null);
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')").run(messageId,conversationId,"CUSTOMER",name||"Guest",mail||null,message);
        saveFiles(req.files,conversationId,messageId);event(conversationId,"CREATED",{toStatus:"PENDING_STAFF",details:{message_id:messageId,support_open:support.open}});
      })();
    }catch(error){removeFiles(req.files);return res.status(500).json({error:"CONVERSATION_CREATE_FAILED"});}
    const row=byId(conversationId);notifyConversation(row,{body:`${name||"Website visitor"} · ${category.replaceAll("_"," ")} · ${message.slice(0,220)}`});
    const autoReply=!support.open?await sendOfflineAutoReply(row):{status:"NOT_REQUIRED"};
    res.status(201).json({...payload(row,{token}),access_token:token,outside_support_hours:!support.open,auto_reply_delivery:autoReply});
  });

  app.post("/api/public/customer-conversations/lookup",(req,res)=>{
    if(!validEmail(req.body?.email))return res.status(400).json({error:"VALID_CONVERSATION_EMAIL_REQUIRED"});
    res.setHeader("Cache-Control","no-store");res.status(202).json({ok:true});
  });

  app.get("/api/public/customer-conversations/:token",(req,res)=>{
    const row=byToken(req.params.token);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    res.setHeader("Cache-Control","no-store");res.json(payload(row,{token:req.params.token}));
  });

  app.post("/api/public/customer-conversations/:token/messages",upload,(req,res)=>{
    const row=byToken(req.params.token);if(!row){removeFiles(req.files);return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});}
    const body=clean(req.body?.message,5000);if(!body){removeFiles(req.files);return res.status(400).json({error:"MESSAGE_REQUIRED"});}
    const messageId=id("MSG"),before=row.status;
    try{
      db.transaction(()=>{
        db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'UNREAD')").run(messageId,row.id,"CUSTOMER",row.name||"Guest",row.email||null,body);
        saveFiles(req.files,row.id,messageId);
        db.prepare("UPDATE customer_conversations SET status='PENDING_STAFF',last_message_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP,closed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
        event(row.id,"CUSTOMER_MESSAGE",{fromStatus:before,toStatus:"PENDING_STAFF",details:{message_id:messageId}});
      })();
    }catch(error){removeFiles(req.files);return res.status(500).json({error:"CONVERSATION_MESSAGE_FAILED"});}
    const after=byId(row.id);notifyConversation(after,{titleEn:"New customer reply",titleHu:"Új ügyfélválasz",body:`${row.name||"Website visitor"} · ${body.slice(0,220)}`});
    res.status(201).json(payload(after,{token:req.params.token}));
  });

  app.post("/api/public/customer-conversations/:token/appointment-proposals/:proposalId/respond",(req,res)=>{
    const row=byToken(req.params.token);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    const proposal=db.prepare("SELECT * FROM customer_appointment_proposals WHERE id=? AND conversation_id=?").get(req.params.proposalId,row.id);
    if(!proposal)return res.status(404).json({error:"APPOINTMENT_PROPOSAL_NOT_FOUND"});
    if(proposal.status!=="PROPOSED")return res.status(409).json({error:"APPOINTMENT_PROPOSAL_ALREADY_RESOLVED"});
    if(proposal.expires_at&&new Date(proposal.expires_at)<=new Date())return res.status(409).json({error:"APPOINTMENT_PROPOSAL_EXPIRED"});
    const decision=clean(req.body?.decision,20).toUpperCase();if(!["ACCEPTED","DECLINED"].includes(decision))return res.status(400).json({error:"INVALID_APPOINTMENT_DECISION"});
    db.transaction(()=>{
      db.prepare("UPDATE customer_appointment_proposals SET status=?,responded_at=CURRENT_TIMESTAMP,expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(decision,decision==="ACCEPTED"?holdExpiry():proposal.expires_at,proposal.id);
      db.prepare("UPDATE customer_conversations SET status='PENDING_STAFF',last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(row.id);
      event(row.id,decision==="ACCEPTED"?"APPOINTMENT_ACCEPTED":"APPOINTMENT_DECLINED",{toStatus:"PENDING_STAFF",details:{proposal_id:proposal.id}});
    })();
    const after=byId(row.id);
    if(notifications)notifications.emit({
      category:"PRIVATE_APPOINTMENT",entityType:"CUSTOMER_CONVERSATION",entityId:row.id,
      titleEn:decision==="ACCEPTED"?"Customer accepted proposed appointment":"Customer requested another appointment time",
      titleHu:decision==="ACCEPTED"?"Az ügyfél elfogadta az időpontjavaslatot":"Az ügyfél másik időpontot kér",
      bodyEn:`${row.name||"Customer"} · ${formatNy(new Date(proposal.starts_at))}`,bodyHu:`${row.name||"Ügyfél"} · ${formatNy(new Date(proposal.starts_at))}`,
      actionUrl:"#messenger",severity:decision==="ACCEPTED"?"SUCCESS":"INFO",recipients:supportRecipients(proposal.assigned_user_id||row.assigned_user_id)
    });
    res.json(payload(after,{token:req.params.token}));
  });

  app.get("/api/public/customer-conversations/:token/attachments/:attachmentId",(req,res)=>{
    const row=byToken(req.params.token);if(!row)return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    const attachment=db.prepare("SELECT * FROM customer_message_attachments WHERE id=? AND conversation_id=?").get(req.params.attachmentId,row.id);
    if(!attachment)return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    const filePath=path.join(uploadDir,"customer-conversations",path.basename(attachment.stored_name));if(!fs.existsSync(filePath))return res.status(404).json({error:"CUSTOMER_ATTACHMENT_NOT_FOUND"});
    res.type(attachment.mime_type).download(filePath,attachment.original_name);
  });

  app.get("/api/customer-conversations",auth,staff,(req,res)=>{
    const status=clean(req.query.status,40).toUpperCase(),q=clean(req.query.q,200).toLowerCase(),args=[],where=[];
    if(status&&["OPEN","PENDING_CUSTOMER","PENDING_STAFF","CLOSED"].includes(status)){where.push("c.status=?");args.push(status);}
    if(q){where.push("(lower(COALESCE(c.name,'')) LIKE ? OR lower(COALESCE(c.email,'')) LIKE ? OR lower(c.category) LIKE ?)");args.push(`%${q}%`,`%${q}%`,`%${q}%`);}
    const rows=db.prepare(`SELECT c.*,u.name AS assigned_user_name,
      (SELECT COUNT(*) FROM customer_messages m WHERE m.conversation_id=c.id AND m.direction='CUSTOMER' AND m.status='UNREAD') AS unread_count,
      (SELECT body FROM customer_messages lm WHERE lm.conversation_id=c.id ORDER BY lm.created_at DESC,lm.id DESC LIMIT 1) AS last_message
      FROM customer_conversations c LEFT JOIN users u ON u.id=c.assigned_user_id
      ${where.length?"WHERE "+where.join(" AND "):""} ORDER BY CASE WHEN c.status='PENDING_STAFF' THEN 0 WHEN c.status='OPEN' THEN 1 ELSE 2 END,c.last_activity_at DESC,c.created_at DESC LIMIT 300`).all(...args);
    res.json({support:supportState({db,env}),conversations:rows});
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
    db.prepare("UPDATE customer_conversations SET status=?,closed_at=CASE WHEN ?='CLOSED' THEN CURRENT_TIMESTAMP ELSE NULL END,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status,status,row.id);
    event(row.id,"STATUS_CHANGED",{actor:req.user,fromStatus:row.status,toStatus:status});if(status==="CLOSED")notifications?.resolveEntity("CUSTOMER_CONVERSATION",row.id);
    res.json(payload(byId(row.id),{staffView:true}));
  });

  app.post("/api/customer-conversations/:id/appointment-proposals",auth,staff,(req,res)=>{
    const row=byId(req.params.id);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    const startsAt=validTime(req.body?.starts_at);if(!startsAt)return res.status(400).json({error:"INVALID_APPOINTMENT_TIME"});
    let slot;try{slot=assertAvailable(db,{startsAt,endsAt:req.body?.ends_at,duration:req.body?.duration_min||60});}catch(error){return res.status(error.status||409).json({error:error.message,details:error.details});}
    const type=clean(req.body?.appointment_type||"PRIVATE_VISIT",40).toUpperCase();if(!["PRIVATE_VISIT","PIANO_VIEWING","SERVICE_CONSULTATION"].includes(type))return res.status(400).json({error:"INVALID_APPOINTMENT_TYPE"});
    const assigned=clean(req.body?.assigned_user_id,160)||row.assigned_user_id||req.user.id;if(assigned&&!db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assigned))return res.status(400).json({error:"INVALID_APPOINTMENT_ASSIGNEE"});
    const proposalId=id("APR"),expiry=holdExpiry();
    db.transaction(()=>{
      db.prepare(`INSERT INTO customer_appointment_proposals(id,conversation_id,appointment_type,starts_at,ends_at,assigned_user_id,phone,note,status,created_by_user_id,expires_at)
        VALUES(?,?,?,?,?,?,?,?, 'PROPOSED',?,?)`).run(proposalId,row.id,type,slot.starts_at,slot.ends_at,assigned,clean(req.body?.phone,80)||null,clean(req.body?.note,1000)||null,req.user.id,expiry);
      db.prepare("UPDATE customer_conversations SET status='PENDING_CUSTOMER',assigned_user_id=COALESCE(assigned_user_id,?),last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(assigned,row.id);
      event(row.id,"APPOINTMENT_PROPOSED",{actor:req.user,fromStatus:row.status,toStatus:"PENDING_CUSTOMER",details:{proposal_id:proposalId,starts_at:slot.starts_at,ends_at:slot.ends_at,duration_min:slot.duration_min,expires_at:expiry}});
    })();
    res.status(201).json(payload(byId(row.id),{staffView:true}));
  });

  app.get("/api/customer-conversations/:id/intake-draft",auth,staff,(req,res)=>{
    const row=byId(req.params.id);if(!row)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    const customerMessages=db.prepare("SELECT body FROM customer_messages WHERE conversation_id=? AND direction='CUSTOMER' ORDER BY created_at,id LIMIT 8").all(row.id).map(item=>item.body).filter(Boolean);
    const client=validEmail(row.email)?db.prepare("SELECT id FROM clients WHERE lower(COALESCE(email,''))=? ORDER BY id LIMIT 1").get(row.email):null;
    res.json({
      source_conversation_id:row.id,client_id:client?.id||null,raw_client_name:row.name||"",raw_contact:row.email||"",
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

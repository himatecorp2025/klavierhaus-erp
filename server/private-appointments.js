"use strict";

const crypto=require("node:crypto");
const {availability,assertAvailable,interval,holdExpiry,DEFAULT_DURATION_MIN,BUFFER_MIN}=require("./private-appointment-scheduling");
const {ensureClientIdentity}=require("./client-identity");

const clean=(value,max=2000)=>String(value??"").replace(/\u0000/g,"").trim().slice(0,max);
const rid=(prefix="PA")=>`${prefix}-${crypto.randomUUID()}`;
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value,320).toLowerCase());
const APPOINTMENT_REASONS=new Set(["PIANO_VIEWING","SERVICE_REQUEST","OTHER"]);
function appointmentReason(value,contextType="PRIVATE_VISIT"){
  const explicit=clean(value,40).toUpperCase();
  if(APPOINTMENT_REASONS.has(explicit))return explicit;
  if(contextType==="PIANO_VIEWING")return "PIANO_VIEWING";
  if(contextType==="SERVICE_CONSULTATION")return "SERVICE_REQUEST";
  return "OTHER";
}
const tokenHash=token=>crypto.createHash("sha256").update(String(token)).digest("hex");
function encryptionKey(env=process.env){const secret=String(env.CONVERSATION_TOKEN_ENCRYPTION_KEY||env.JWT_SECRET||"").trim();return crypto.createHash("sha256").update(secret||"klavierhaus-conversation-key-not-for-production").digest();}
function encryptToken(token,key){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key,iv),ciphertext=Buffer.concat([cipher.update(String(token),"utf8"),cipher.final()]);return [iv,cipher.getAuthTag(),ciphertext].map(part=>part.toString("base64url")).join(".");}
function decryptToken(value,key){try{const [iv,tag,data]=String(value||"").split(".");if(!iv||!tag||!data)return "";const decipher=crypto.createDecipheriv("aes-256-gcm",key,Buffer.from(iv,"base64url"));decipher.setAuthTag(Buffer.from(tag,"base64url"));return Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8");}catch(_error){return "";}}
function formatNy(date){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"})
    .formatToParts(date).reduce((out,part)=>(out[part.type]=part.value,out),{});
  const hour=parts.hour==="24"?"00":parts.hour;return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}
function localNewYorkToIso(value){
  const raw=clean(value,80),match=raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/);
  if(!match)return null;
  const [,year,month,day,hour,minute]=match,desired=Date.UTC(+year,+month-1,+day,+hour,+minute);let candidate=desired;
  for(let i=0;i<3;i++){
    const rendered=formatNy(new Date(candidate)),m=rendered.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    const wall=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);candidate+=desired-wall;
  }
  const date=new Date(candidate);return formatNy(date)===`${year}-${month}-${day}T${hour}:${minute}`?date.toISOString():null;
}
function parseLocalizedWallTime(value,language="en"){const raw=clean(value,80);if(!raw)return null;let year,month,day,hour,minute,match;if(language==="hu"){match=raw.match(/^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})[.]?\s+(\d{1,2}):(\d{2})$/);if(match)[,year,month,day,hour,minute]=match;}else{match=raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);if(match){month=match[1];day=match[2];year=match[3];hour=match[4];minute=match[5];const meridiem=String(match[6]||"").toUpperCase();if(meridiem){let h=Number(hour);if(h<1||h>12)return null;if(meridiem==="PM"&&h!==12)h+=12;if(meridiem==="AM"&&h===12)h=0;hour=String(h);}}}if(!year)return null;const y=Number(year),m=Number(month),d=Number(day),h=Number(hour),min=Number(minute);if(y<2000||m<1||m>12||d<1||d>31||h<0||h>23||min<0||min>59||min%15!==0)return null;return localNewYorkToIso(`${String(y).padStart(4,"0")}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}T${String(h).padStart(2,"0")}:${String(min).padStart(2,"0")}`);}
const validTime=(value,language="en")=>{const raw=clean(value,80);if(!raw)return null;if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw))return localNewYorkToIso(raw);const localized=parseLocalizedWallTime(raw,language);if(localized)return localized;const date=new Date(raw);return Number.isNaN(date.getTime())?null:date.toISOString();};

function registerPrivateAppointmentRoutes({app,db,auth,permit,audit,notifications,transactionalEmail=null,websiteBaseUrl="https://klavierhaus-home.onrender.com",env=process.env}){
  const staff=permit("ADMIN","MANAGER","WORKER"),admin=permit("ADMIN"),tokenKey=encryptionKey(env);
  const rate=new Map();
  const limited=key=>{
    const now=Date.now(),windowMs=10*60*1000,limit=8,rows=(rate.get(key)||[]).filter(ts=>now-ts<windowMs);
    rows.push(now);rate.set(key,rows);return rows.length>limit;
  };
  const detailSql=`SELECT a.*,
    p.brand AS piano_brand,p.model AS piano_model,p.title_en AS piano_title_en,p.title_hu AS piano_title_hu,
    s.title_en AS service_title_en,s.title_hu AS service_title_hu,u.name AS assigned_user_name
    FROM private_appointments a
    LEFT JOIN website_showroom_pianos p ON p.id=a.piano_id
    LEFT JOIN website_services s ON s.id=a.service_id
    LEFT JOIN users u ON u.id=a.assigned_user_id`;
  const requestSql=`SELECT r.*,
    p.brand AS piano_brand,p.model AS piano_model,p.title_en AS piano_title_en,p.title_hu AS piano_title_hu,
    s.title_en AS service_title_en,s.title_hu AS service_title_hu,u.name AS assigned_user_name
    FROM private_appointment_requests r
    LEFT JOIN website_showroom_pianos p ON p.id=r.piano_id
    LEFT JOIN website_services s ON s.id=r.service_id
    LEFT JOIN users u ON u.id=r.assigned_user_id`;
  const byId=id=>db.prepare(`${detailSql} WHERE a.id=?`).get(id);
  const requestById=id=>db.prepare(`${requestSql} WHERE r.id=?`).get(id);
  const supportRecipients=assigned=>{
    if(assigned)return [assigned];
    let rows=db.prepare("SELECT id FROM users WHERE status='Active' AND role IN ('ADMIN','MANAGER') ORDER BY role,name").all();
    if(!rows.length)rows=db.prepare("SELECT id FROM users WHERE status='Active' AND role='WORKER' ORDER BY name").all();
    return rows.map(row=>row.id);
  };
  const notify=(row,{kind="created",actor=null}={})=>{
    if(!row||!notifications)return;
    const context=row.piano_id?(row.piano_title_en||[row.piano_brand,row.piano_model].filter(Boolean).join(" ")):row.service_id?(row.service_title_en||"Service"):"Private visit";
    const titleEn=kind==="created"?"Private appointment scheduled":kind==="rescheduled"?"Private appointment rescheduled":kind==="completed"?"Private appointment completed":"Private appointment cancelled";
    const titleHu=kind==="created"?"Privát időpont naptárba helyezve":kind==="rescheduled"?"Privát időpont átütemezve":kind==="completed"?"Privát időpont lezárva":"Privát időpont törölve";
    const when=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(row.scheduled_at));
    if(["completed","cancelled"].includes(kind))notifications.resolveEntity("PRIVATE_APPOINTMENT",row.id);
    notifications.emit({
      category:"PRIVATE_APPOINTMENT",entityType:"PRIVATE_APPOINTMENT",entityId:row.id,titleEn,titleHu,
      bodyEn:`${row.name} · ${context} · ${when}`,bodyHu:`${row.name} · ${context} · ${when}`,
      actionUrl:"/?view=workshop&private=1",severity:kind==="cancelled"?"WARNING":kind==="completed"?"SUCCESS":"INFO",
      actorUserId:actor?.id||null,recipients:supportRecipients(row.assigned_user_id)
    });
  };
  const notifyRequest=(row,{kind="requested",actor=null}={})=>{
    if(!row||!notifications)return;
    const labels={
      requested:["New Private Appointment – Customer call required","Új privát időpont – ügyfél felhívása kötelező","URGENT"],
      proposed:["Alternative appointment proposed","Másik privát időpont javasolva","INFO"],
      approved:["Private appointment request approved","Privát időpontkérés jóváhagyva","SUCCESS"],
      declined:["Private appointment request declined","Privát időpontkérés elutasítva","WARNING"]
    }[kind]||["Private appointment request","Privát időpontkérés","INFO"];
    if(["approved","declined"].includes(kind))notifications.resolveEntity("PRIVATE_APPOINTMENT_REQUEST",row.id);
    notifications.emit({
      category:"PRIVATE_APPOINTMENT",entityType:"PRIVATE_APPOINTMENT_REQUEST",entityId:row.id,
      titleEn:labels[0],titleHu:labels[1],
      bodyEn:kind==="requested"
        ?`${row.name} · ${row.email} · ${row.phone} · ${row.appointment_reason||"OTHER"} · ${formatNy(new Date(row.requested_at))}`
        :`${row.name} · ${formatNy(new Date(row.requested_at))}`,
      bodyHu:kind==="requested"
        ?`${row.name} · ${row.email} · ${row.phone} · ${row.appointment_reason||"OTHER"} · ${formatNy(new Date(row.requested_at))}`
        :`${row.name} · ${formatNy(new Date(row.requested_at))}`,
      actionUrl:"#messenger",severity:labels[2],actorUserId:actor?.id||null,recipients:supportRecipients(row.assigned_user_id)
    });
  };
  function validateContext(body){
    const pianoId=clean(body?.piano_id,160)||null,serviceId=clean(body?.service_id,160)||null;
    if(pianoId&&serviceId)throw Object.assign(new Error("PRIVATE_APPOINTMENT_SINGLE_CONTEXT_REQUIRED"),{status:400});
    if(pianoId&&!db.prepare("SELECT 1 FROM website_showroom_pianos WHERE id=? AND published=1 AND availability_status<>'HIDDEN'").get(pianoId))
      throw Object.assign(new Error("SHOWROOM_PIANO_NOT_FOUND"),{status:400});
    if(serviceId&&!db.prepare("SELECT 1 FROM website_services WHERE id=? AND visible=1").get(serviceId))
      throw Object.assign(new Error("WEBSITE_SERVICE_NOT_AVAILABLE"),{status:400});
    return {pianoId,serviceId,type:pianoId?"PIANO_VIEWING":serviceId?"SERVICE_CONSULTATION":"PRIVATE_VISIT"};
  }
  function makeScheduled(body,{actor=null,source="ERP",conversationId=null,email=null,excludeAppointmentId=null,excludeProposalId=null,excludeRequestId=null}={}){
    const name=clean(body?.name,200),phone=clean(body?.phone,80),scheduledAt=validTime(body?.scheduled_at||body?.appointment_at||body?.preferred_time),note=clean(body?.note??body?.message,1000);
    if(!name)return {error:"PRIVATE_APPOINTMENT_NAME_REQUIRED",status:400};
    if(!phone)return {error:"PRIVATE_APPOINTMENT_PHONE_REQUIRED",status:400};
    if(!scheduledAt)return {error:"PRIVATE_APPOINTMENT_TIME_REQUIRED",status:400};
    let context;try{context=validateContext(body);}catch(error){return {error:error.message,status:error.status||400};}
    const explicitType=clean(body?.appointment_type,40).toUpperCase();if(!context.pianoId&&!context.serviceId&&["PRIVATE_VISIT","PIANO_VIEWING","SERVICE_CONSULTATION"].includes(explicitType))context.type=explicitType;
    const reason=appointmentReason(body?.appointment_reason,context.type);
    const assigned=clean(body?.assigned_user_id,160)||null;if(assigned&&!db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assigned))return {error:"INVALID_APPOINTMENT_ASSIGNEE",status:400};
    let clientId=Number(body?.client_id)||null;if(!clientId&&conversationId)clientId=Number(db.prepare("SELECT client_id FROM customer_conversations WHERE id=?").get(conversationId)?.client_id)||null;if(!clientId)clientId=ensureClientIdentity(db,{name,email:email??body?.email,phone,language:body?.language},{create:true}).client?.id||null;
    let slot;try{slot=assertAvailable(db,{startsAt:scheduledAt,endsAt:body?.scheduled_end_at,duration:body?.duration_min||DEFAULT_DURATION_MIN,excludeAppointmentId,excludeProposalId,excludeRequestId});}catch(error){return {error:error.message,status:error.status||409,details:error.details};}
    const appointmentId=excludeAppointmentId||rid();
    if(excludeAppointmentId){
      db.prepare(`UPDATE private_appointments SET name=?,email=?,phone=?,appointment_reason=?,scheduled_at=?,scheduled_end_at=?,duration_min=?,note=?,client_id=?,assigned_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(name,clean(email??body?.email,320)||null,phone,reason,slot.starts_at,slot.ends_at,slot.duration_min,note||null,clientId,assigned,appointmentId);
    }else{
      db.prepare(`INSERT INTO private_appointments(id,appointment_type,name,email,phone,appointment_reason,scheduled_at,scheduled_end_at,duration_min,note,conversation_id,client_id,piano_id,service_id,status,assigned_user_id,language,source_path,created_source,created_by_user_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'SCHEDULED',?,?,?,?,?)`).run(
        appointmentId,context.type,name,clean(email??body?.email,320)||null,phone,reason,slot.starts_at,slot.ends_at,slot.duration_min,note||null,conversationId||clean(body?.conversation_id,160)||null,clientId,context.pianoId,context.serviceId,assigned,
        body?.language==="hu"?"hu":"en",clean(body?.source_path,1000)||null,source,actor?.id||null
      );
    }
    const row=byId(appointmentId);return {row,slot};
  }
  async function sendDecisionEmail(row,decision,{conversationUrl=""}={}){
    if(!transactionalEmail?.configured||!validEmail(row.email))return {status:"NOT_CONFIGURED"};
    try{
      const result=await transactionalEmail.sendPrivateAppointmentDecision({
        to:row.email,name:row.name,decision,startsAt:row.scheduled_at||row.requested_at,endsAt:row.scheduled_end_at||null,
        durationMin:Number(row.duration_min||row.requested_duration_min||DEFAULT_DURATION_MIN),language:row.language||"en",conversationUrl,
        idempotencyKey:`private-appointment-${decision.toLowerCase()}-${row.id}`
      });
      return {status:"SENT",provider_message_id:result.providerMessageId};
    }catch(error){return {status:"FAILED",error:error.code||error.message};}
  }
  function ensureConversationForRequest(request,actor){
    if(request.conversation_id){
      const row=db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(request.conversation_id);
      if(row)return {conversation:row,token:decryptToken(row.public_token_encrypted,tokenKey)||null};
    }
    const conversationId=rid("CONV"),token=crypto.randomBytes(32).toString("base64url"),messageId=rid("MSG");
    const body=`Private appointment request · ${formatNy(new Date(request.requested_at))} ET${request.note?` · ${request.note}`:""}`;
    const linked=Number(request.client_id)?{id:Number(request.client_id)}:ensureClientIdentity(db,{name:request.name,email:request.email,phone:request.phone,language:request.language},{create:true}).client;
    db.prepare(`INSERT INTO customer_conversations(id,public_token_hash,public_token_encrypted,name,email,client_id,language,category,status,consent_contact,source_path,metadata_json,last_message_at,last_activity_at,assigned_user_id)
      VALUES(?,?,?,?,?,?,?,'PRIVATE_CONSULTATION','PENDING_CUSTOMER',1,?,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?)`)
      .run(conversationId,tokenHash(token),encryptToken(token,tokenKey),request.name,request.email,linked?.id||null,request.language||"en",request.source_path||null,request.assigned_user_id||actor?.id||null);
    db.prepare("INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,status) VALUES(?,?,?,?,?,?,'READ')")
      .run(messageId,conversationId,"CUSTOMER",request.name,request.email,body);
    db.prepare("UPDATE private_appointment_requests SET conversation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(conversationId,request.id);
    return {conversation:db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(conversationId),token};
  }
  function publicConversationUrl(token){return token?`${String(websiteBaseUrl||"").replace(/\/$/,"")}/?conversation=${encodeURIComponent(token)}`:"";}

  function publicAppointmentWindow(){
    const readSetting=(key,fallback)=>{try{return clean(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key=?").get(key)?.setting_value,20)||fallback;}catch(_error){return fallback;}};
    const parse=(value,fallback)=>{const match=String(value||"").match(/^(\d{1,2}):(\d{2})$/);if(!match)return fallback;const minutes=Number(match[1])*60+Number(match[2]);return minutes>=0&&minutes<=24*60?minutes:fallback;};
    const start=parse(readSetting("private_appointment_public_start","07:00"),7*60);
    const end=parse(readSetting("private_appointment_public_end","21:00"),21*60);
    return end>start?{start,end}:{start:7*60,end:21*60};
  }
  function publicAvailabilityForDate(dateValue,duration=DEFAULT_DURATION_MIN){
    const date=clean(dateValue,20);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Object.assign(new Error("PRIVATE_APPOINTMENT_DATE_REQUIRED"),{status:400});
    const noon=validTime(date+"T12:00");if(!noon)throw Object.assign(new Error("INVALID_PRIVATE_APPOINTMENT_DATE"),{status:400});
    const durationMin=Number(duration||DEFAULT_DURATION_MIN),window=publicAppointmentWindow(),slots=[];
    for(let minutes=window.start;minutes+durationMin<=window.end;minutes+=15){
      const hh=String(Math.floor(minutes/60)).padStart(2,"0"),mm=String(minutes%60).padStart(2,"0"),wallTime=`${date}T${hh}:${mm}`,startsAt=validTime(wallTime);
      if(!startsAt||new Date(startsAt).getTime()<=Date.now())continue;
      const result=availability(db,{startsAt,duration:durationMin});if(!result.ok)continue;
      slots.push({wall_time:wallTime,starts_at:result.starts_at,ends_at:result.ends_at,duration_min:result.duration_min});
    }
    return {date,timezone:"America/New_York",duration_min:durationMin,buffer_min:BUFFER_MIN,step_min:15,window_start:`${String(Math.floor(window.start/60)).padStart(2,"0")}:${String(window.start%60).padStart(2,"0")}`,window_end:`${String(Math.floor(window.end/60)).padStart(2,"0")}:${String(window.end%60).padStart(2,"0")}`,slots};
  }

  app.get("/api/public/private-appointment-availability",(req,res)=>{
    try{res.setHeader("Cache-Control","no-store");res.json(publicAvailabilityForDate(req.query?.date,DEFAULT_DURATION_MIN));}
    catch(error){res.status(error.status||400).json({error:error.message||"PRIVATE_APPOINTMENT_AVAILABILITY_FAILED"});}
  });

  app.post("/api/public/private-appointments",(req,res)=>{
    const ip=clean(req.ip||req.socket?.remoteAddress,120);if(limited(ip))return res.status(429).json({error:"TOO_MANY_REQUESTS"});
    let name=clean(req.body?.name,200),email=clean(req.body?.email,320).toLowerCase(),phone=clean(req.body?.phone,80);
    const conversationToken=clean(req.body?.conversation_token,500);
    const conversation=conversationToken?db.prepare("SELECT * FROM customer_conversations WHERE public_token_hash=?").get(tokenHash(conversationToken)):null;
    if(conversation){name=conversation.name||name;email=String(conversation.email||email).toLowerCase();const linked=conversation.client_id?db.prepare("SELECT phone FROM clients WHERE id=?").get(conversation.client_id):null;phone=phone||clean(linked?.phone,80);}
    const requestedAt=validTime(req.body?.scheduled_at||req.body?.preferred_time,req.body?.language==="hu"?"hu":"en"),note=clean(req.body?.note??req.body?.message,1000);
    if(!name)return res.status(400).json({error:"PRIVATE_APPOINTMENT_NAME_REQUIRED"});
    if(!validEmail(email))return res.status(400).json({error:"PRIVATE_APPOINTMENT_EMAIL_REQUIRED"});
    if(!phone)return res.status(400).json({error:"PRIVATE_APPOINTMENT_PHONE_REQUIRED"});
    if(!requestedAt)return res.status(400).json({error:"PRIVATE_APPOINTMENT_TIME_REQUIRED"});
    let context;try{context=validateContext(req.body);}catch(error){return res.status(error.status||400).json({error:error.message});}
    let duration;try{duration=interval({startsAt:requestedAt,duration:req.body?.duration_min||DEFAULT_DURATION_MIN}).duration_min;assertAvailable(db,{startsAt:requestedAt,duration});}catch(error){return res.status(error.status||409).json({error:error.message,details:error.details});}
    const reason=appointmentReason(req.body?.appointment_reason,context.type);
    const requestId=rid("PAR"),client=conversation?.client_id?db.prepare("SELECT * FROM clients WHERE id=?").get(conversation.client_id):ensureClientIdentity(db,{name,email,phone,language:req.body?.language},{create:true}).client;
    db.transaction(()=>{
      db.prepare(`INSERT INTO private_appointment_requests(id,appointment_type,name,email,phone,appointment_reason,requested_at,requested_duration_min,note,piano_id,service_id,status,language,source_path,client_id,conversation_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'REQUESTED',?,?,?,?)`).run(
        requestId,context.type,name,email,phone,reason,requestedAt,duration,note||null,context.pianoId,context.serviceId,req.body?.language==="hu"?"hu":"en",clean(req.body?.source_path,1000)||null,client?.id||null,conversation?.id||null
      );
      if(conversation){
        const messageId=rid("MSG"),meta=JSON.stringify({request_id:requestId,appointment_reason:reason,scheduled_at:requestedAt,duration_min:duration,phone,note:note||"",status:"REQUESTED"});
        db.prepare(`INSERT INTO customer_messages(id,conversation_id,direction,sender_name,sender_email,body,message_type,metadata_json,status)
          VALUES(?,?,?,?,?,?,'PRIVATE_APPOINTMENT_REQUEST',?,'UNREAD')`).run(messageId,conversation.id,"CUSTOMER",name,email,"Private appointment request",meta);
        db.prepare("UPDATE customer_conversations SET status='PENDING_STAFF',last_message_at=CURRENT_TIMESTAMP,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(conversation.id);
      }
    })();
    const row=requestById(requestId);notifyRequest(row,{kind:"requested"});res.status(201).json({ok:true,id:requestId,request:row,pending_approval:true});
  });

  app.get("/api/private-appointment-requests",auth,staff,(req,res)=>{
    db.prepare(`UPDATE private_appointment_requests SET status='REQUESTED',updated_at=CURRENT_TIMESTAMP
      WHERE status='PROPOSED' AND proposal_id IN (
        SELECT id FROM customer_appointment_proposals WHERE status='CANCELLED' AND private_appointment_id IS NULL
      )`).run();
    const status=clean(req.query.status,30).toUpperCase(),clauses=[],args=[];
    if(status){const statuses=status.split(",").map(item=>item.trim()).filter(Boolean);if(statuses.some(item=>!["REQUESTED","PROPOSED","APPROVED","DECLINED","CANCELLED"].includes(item)))return res.status(400).json({error:"INVALID_PRIVATE_APPOINTMENT_REQUEST_STATUS"});clauses.push(`r.status IN (${statuses.map(()=>"?").join(",")})`);args.push(...statuses);}
    res.json(db.prepare(`${requestSql} ${clauses.length?"WHERE "+clauses.join(" AND "):""} ORDER BY CASE r.status WHEN 'REQUESTED' THEN 0 WHEN 'PROPOSED' THEN 1 ELSE 2 END,r.requested_at,r.created_at`).all(...args));
  });
  app.get("/api/private-appointment-requests/:id",auth,staff,(req,res)=>{
    const row=requestById(req.params.id);if(!row)return res.status(404).json({error:"PRIVATE_APPOINTMENT_REQUEST_NOT_FOUND"});res.json(row);
  });
  app.post("/api/private-appointment-requests/:id/approve",auth,staff,async(req,res)=>{
    const before=requestById(req.params.id);if(!before)return res.status(404).json({error:"PRIVATE_APPOINTMENT_REQUEST_NOT_FOUND"});
    if(!["REQUESTED","PROPOSED"].includes(before.status))return res.status(409).json({error:"PRIVATE_APPOINTMENT_REQUEST_ALREADY_RESOLVED"});
    const body={...before,...req.body,name:before.name,email:before.email,phone:before.phone,appointment_reason:before.appointment_reason,piano_id:before.piano_id,service_id:before.service_id,scheduled_at:req.body?.scheduled_at||before.requested_at,duration_min:req.body?.duration_min||before.requested_duration_min,language:before.language,source_path:before.source_path};
    const result=db.transaction(()=>makeScheduled(body,{actor:req.user,source:"ERP",email:before.email,excludeProposalId:before.proposal_id||null,excludeRequestId:before.id}))();
    if(result.error)return res.status(result.status).json({error:result.error,details:result.details});
    db.prepare(`UPDATE private_appointment_requests SET status='APPROVED',private_appointment_id=?,assigned_user_id=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(result.row.id,result.row.assigned_user_id||null,req.user.id,before.id);
    if(before.proposal_id)db.prepare("UPDATE customer_appointment_proposals SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE id=? AND private_appointment_id IS NULL").run(before.proposal_id);
    const after=requestById(before.id);notify(result.row,{kind:"created",actor:req.user});notifyRequest(after,{kind:"approved",actor:req.user});
    const emailDelivery=await sendDecisionEmail({...after,scheduled_at:result.row.scheduled_at,scheduled_end_at:result.row.scheduled_end_at,duration_min:result.row.duration_min},"APPROVED");
    audit(req,"APPROVE","private_appointment_requests",before.id,before,after);res.json({...after,appointment:result.row,email_delivery:emailDelivery});
  });
  app.post("/api/private-appointment-requests/:id/decline",auth,staff,async(req,res)=>{
    const before=requestById(req.params.id);if(!before)return res.status(404).json({error:"PRIVATE_APPOINTMENT_REQUEST_NOT_FOUND"});
    if(["APPROVED","DECLINED","CANCELLED"].includes(before.status))return res.status(409).json({error:"PRIVATE_APPOINTMENT_REQUEST_ALREADY_RESOLVED"});
    db.prepare("UPDATE private_appointment_requests SET status='DECLINED',reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.user.id,before.id);
    const after=requestById(before.id);notifyRequest(after,{kind:"declined",actor:req.user});const emailDelivery=await sendDecisionEmail(after,"DECLINED");
    audit(req,"DECLINE","private_appointment_requests",before.id,before,after);res.json({...after,email_delivery:emailDelivery});
  });
  app.post("/api/private-appointment-requests/:id/propose",auth,staff,async(req,res)=>{
    const before=requestById(req.params.id);if(!before)return res.status(404).json({error:"PRIVATE_APPOINTMENT_REQUEST_NOT_FOUND"});
    if(["APPROVED","DECLINED","CANCELLED"].includes(before.status))return res.status(409).json({error:"PRIVATE_APPOINTMENT_REQUEST_ALREADY_RESOLVED"});
    const startsAt=validTime(req.body?.starts_at);if(!startsAt)return res.status(400).json({error:"INVALID_APPOINTMENT_TIME"});
    let slot;try{slot=assertAvailable(db,{startsAt,duration:req.body?.duration_min||before.requested_duration_min,excludeRequestId:before.id});}catch(error){return res.status(error.status||409).json({error:error.message,details:error.details});}
    const assigned=clean(req.body?.assigned_user_id,160)||before.assigned_user_id||req.user.id;if(assigned&&!db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assigned))return res.status(400).json({error:"INVALID_APPOINTMENT_ASSIGNEE"});
    const {conversation,token}=ensureConversationForRequest(before,req.user),proposalId=rid("APR");
    const expiry=holdExpiry();
    db.transaction(()=>{
      db.prepare(`INSERT INTO customer_appointment_proposals(id,conversation_id,appointment_type,starts_at,ends_at,assigned_user_id,phone,appointment_reason,note,status,created_by_user_id,expires_at)
        VALUES(?,?,?,?,?,?,?,?,?, 'PROPOSED',?,?)`).run(proposalId,conversation.id,before.appointment_type,slot.starts_at,slot.ends_at,assigned,before.phone,before.appointment_reason||appointmentReason(null,before.appointment_type),clean(req.body?.note,1000)||before.note||null,req.user.id,expiry);
      db.prepare("UPDATE customer_conversations SET status='PENDING_CUSTOMER',assigned_user_id=?,last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(assigned,conversation.id);
      db.prepare("UPDATE private_appointment_requests SET status='PROPOSED',conversation_id=?,proposal_id=?,assigned_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(conversation.id,proposalId,assigned,before.id);
    })();
    const after=requestById(before.id);notifyRequest(after,{kind:"proposed",actor:req.user});
    let delivery={status:"NOT_CONFIGURED"};
    if(transactionalEmail?.configured&&validEmail(before.email)){
      const url=token?publicConversationUrl(token):String(websiteBaseUrl||"");
      const message=(before.language==="hu"?"Másik privát időpontot javaslunk: ":"We would like to propose another private appointment time: ")+
        new Intl.DateTimeFormat(before.language==="hu"?"hu-HU":"en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(slot.starts_at));
      try{const sent=await transactionalEmail.sendCustomerConversationReply({to:before.email,name:before.name,message,conversationUrl:url,language:before.language||"en",idempotencyKey:`private-request-proposal-${proposalId}`});delivery={status:"SENT",provider_message_id:sent.providerMessageId};}
      catch(error){delivery={status:"FAILED",error:error.code||error.message};}
    }
    audit(req,"PROPOSE","private_appointment_requests",before.id,before,after);res.status(201).json({...after,proposal:db.prepare("SELECT * FROM customer_appointment_proposals WHERE id=?").get(proposalId),email_delivery:delivery});
  });

  app.post("/api/customer-conversations/:conversationId/appointment-proposals/:proposalId/finalize",auth,staff,async(req,res)=>{
    const conversation=db.prepare("SELECT * FROM customer_conversations WHERE id=?").get(req.params.conversationId);
    if(!conversation)return res.status(404).json({error:"CONVERSATION_NOT_FOUND"});
    const proposal=db.prepare("SELECT * FROM customer_appointment_proposals WHERE id=? AND conversation_id=?").get(req.params.proposalId,conversation.id);
    if(!proposal)return res.status(404).json({error:"APPOINTMENT_PROPOSAL_NOT_FOUND"});
    if(proposal.private_appointment_id)return res.json({ok:true,idempotent:true,appointment:byId(proposal.private_appointment_id)});
    if(proposal.status!=="ACCEPTED")return res.status(409).json({error:"APPOINTMENT_PROPOSAL_NOT_ACCEPTED"});
    if(proposal.expires_at&&new Date(proposal.expires_at)<=new Date())return res.status(409).json({error:"APPOINTMENT_PROPOSAL_EXPIRED"});
    const request=db.prepare("SELECT * FROM private_appointment_requests WHERE proposal_id=?").get(proposal.id);
    const duration=Math.round((new Date(proposal.ends_at)-new Date(proposal.starts_at))/60000);
    const body={
      appointment_type:proposal.appointment_type,name:conversation.name||request?.name||"Guest",email:conversation.email||request?.email||null,phone:proposal.phone||request?.phone||"",appointment_reason:proposal.appointment_reason||request?.appointment_reason||appointmentReason(null,proposal.appointment_type),client_id:conversation.client_id||request?.client_id||null,
      scheduled_at:proposal.starts_at,scheduled_end_at:proposal.ends_at,duration_min:duration,note:proposal.note||request?.note||null,
      assigned_user_id:proposal.assigned_user_id||conversation.assigned_user_id||req.user.id,language:conversation.language||request?.language||"en",
      source_path:conversation.source_path||request?.source_path||null,piano_id:request?.piano_id||null,service_id:request?.service_id||null
    };
    const result=db.transaction(()=>makeScheduled(body,{actor:req.user,source:"ERP",conversationId:conversation.id,email:body.email,excludeProposalId:proposal.id}))();
    if(result.error)return res.status(result.status).json({error:result.error,details:result.details});
    db.transaction(()=>{
      db.prepare("UPDATE customer_appointment_proposals SET private_appointment_id=?,finalized_at=CURRENT_TIMESTAMP,finalized_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(result.row.id,req.user.id,proposal.id);
      db.prepare("UPDATE customer_conversations SET status='PENDING_CUSTOMER',last_activity_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(conversation.id);
      if(request)db.prepare("UPDATE private_appointment_requests SET status='APPROVED',private_appointment_id=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(result.row.id,req.user.id,request.id);
    })();
    notify(result.row,{kind:"created",actor:req.user});if(request)notifyRequest(requestById(request.id),{kind:"approved",actor:req.user});
    const emailDelivery=await sendDecisionEmail({...result.row,email:body.email,language:body.language},"APPROVED");
    audit(req,"FINALIZE","customer_appointment_proposals",proposal.id,proposal,db.prepare("SELECT * FROM customer_appointment_proposals WHERE id=?").get(proposal.id));
    res.status(201).json({ok:true,appointment:result.row,email_delivery:emailDelivery});
  });

  app.post("/api/private-appointments",auth,staff,(req,res)=>{
    const result=db.transaction(()=>makeScheduled(req.body,{actor:req.user,source:"ERP"}))();if(result.error)return res.status(result.status).json({error:result.error,details:result.details});
    notify(result.row,{kind:"created",actor:req.user});audit(req,"CREATE","private_appointments",result.row.id,null,result.row);res.status(201).json(result.row);
  });
  app.get("/api/private-appointments",auth,staff,(req,res)=>{
    const from=clean(req.query.from,80),to=clean(req.query.to,80),status=clean(req.query.status,30).toUpperCase(),type=clean(req.query.type,40).toUpperCase();
    const clauses=[],args=[];
    if(from){const iso=validTime(from);if(!iso)return res.status(400).json({error:"INVALID_APPOINTMENT_FROM"});clauses.push("a.scheduled_at>=?");args.push(iso);}
    if(to){const iso=validTime(to);if(!iso)return res.status(400).json({error:"INVALID_APPOINTMENT_TO"});clauses.push("a.scheduled_at<?");args.push(iso);}
    if(status){if(!["SCHEDULED","COMPLETED","CANCELLED"].includes(status))return res.status(400).json({error:"INVALID_APPOINTMENT_STATUS"});clauses.push("a.status=?");args.push(status);}
    if(type){if(!["PRIVATE_VISIT","PIANO_VIEWING","SERVICE_CONSULTATION"].includes(type))return res.status(400).json({error:"INVALID_APPOINTMENT_TYPE"});clauses.push("a.appointment_type=?");args.push(type);}
    res.json(db.prepare(`${detailSql} ${clauses.length?"WHERE "+clauses.join(" AND "):""} ORDER BY a.scheduled_at,a.created_at`).all(...args));
  });
  app.get("/api/private-appointments/:id",auth,staff,(req,res)=>{const row=byId(req.params.id);if(!row)return res.status(404).json({error:"PRIVATE_APPOINTMENT_NOT_FOUND"});res.json(row);});
  app.put("/api/private-appointments/:id",auth,staff,(req,res)=>{
    const before=byId(req.params.id);if(!before)return res.status(404).json({error:"PRIVATE_APPOINTMENT_NOT_FOUND"});
    const status=clean(req.body?.status??before.status,30).toUpperCase();if(!["SCHEDULED","COMPLETED","CANCELLED"].includes(status))return res.status(400).json({error:"INVALID_APPOINTMENT_STATUS"});
    const assigned=req.body?.assigned_user_id===undefined?before.assigned_user_id:(clean(req.body.assigned_user_id,160)||null);if(assigned&&!db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assigned))return res.status(400).json({error:"INVALID_APPOINTMENT_ASSIGNEE"});
    if(status==="SCHEDULED"){
      const body={...before,...req.body,assigned_user_id:assigned,scheduled_at:req.body?.scheduled_at??before.scheduled_at,duration_min:req.body?.duration_min??before.duration_min,email:req.body?.email??before.email};
      const result=db.transaction(()=>makeScheduled(body,{actor:req.user,source:before.created_source||"ERP",conversationId:before.conversation_id,email:body.email,excludeAppointmentId:before.id}))();
      if(result.error)return res.status(result.status).json({error:result.error,details:result.details});
      const after=result.row,kind=after.scheduled_at!==before.scheduled_at||Number(after.duration_min)!==Number(before.duration_min)?"rescheduled":null;if(kind)notify(after,{kind,actor:req.user});
      audit(req,"UPDATE","private_appointments",before.id,before,after);return res.json(after);
    }
    db.prepare(`UPDATE private_appointments SET status=?,assigned_user_id=?,
      completed_at=CASE WHEN ?='COMPLETED' THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE NULL END,
      cancelled_at=CASE WHEN ?='CANCELLED' THEN COALESCE(cancelled_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(status,assigned,status,status,before.id);
    const after=byId(before.id),kind=status==="COMPLETED"?"completed":"cancelled";notify(after,{kind,actor:req.user});audit(req,"UPDATE","private_appointments",before.id,before,after);res.json(after);
  });
  app.delete("/api/private-appointments/:id",auth,admin,(req,res)=>{
    const before=byId(req.params.id);if(!before)return res.status(404).json({error:"PRIVATE_APPOINTMENT_NOT_FOUND"});
    db.prepare("DELETE FROM private_appointments WHERE id=?").run(before.id);notifications?.resolveEntity("PRIVATE_APPOINTMENT",before.id);
    audit(req,"DELETE","private_appointments",before.id,before,null);res.json({ok:true});
  });
}

module.exports={registerPrivateAppointmentRoutes,validTime,parseLocalizedWallTime,formatNy};

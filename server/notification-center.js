"use strict";

const crypto=require("node:crypto");
const webpush=require("web-push");

const clean=(value,max=2000)=>String(value??"").replace(/\u0000/g,"").trim().slice(0,max);
const id=prefix=>`${prefix}-${crypto.randomUUID()}`;
const isAdmin=user=>Boolean(user&&(user.role==="ADMIN"||user.role==="SUPERADMIN"||Number(user.is_superadmin||0)===1));

function createNotificationCenter({db,env=process.env}={}){
  const vapid={
    publicKey:clean(env.VAPID_PUBLIC_KEY,500),
    privateKey:clean(env.VAPID_PRIVATE_KEY,500),
    subject:clean(env.VAPID_SUBJECT||env.APP_BASE_URL||"mailto:notifications@klavierhaus.com",500)
  };
  const pushConfigured=Boolean(vapid.publicKey&&vapid.privateKey&&vapid.subject);
  if(pushConfigured)webpush.setVapidDetails(vapid.subject,vapid.publicKey,vapid.privateKey);
  const realtimeListeners=new Map(),realtimeTickets=new Map();

  function issueRealtimeTicket(userId){
    const ticket=crypto.randomBytes(32).toString("base64url");
    realtimeTickets.set(ticket,{userId:String(userId),expiresAt:Date.now()+60000});
    return {ticket,expires_in_seconds:60};
  }
  function publishRealtime(userId,event){
    const listeners=realtimeListeners.get(String(userId));if(!listeners?.size)return;
    const payload={id:event.id,category:event.category,severity:event.severity,active_count:countActive(userId),created_at:event.created_at};
    for(const listener of [...listeners]){try{listener(payload);}catch(_error){listeners.delete(listener);}}
    if(!listeners.size)realtimeListeners.delete(String(userId));
  }
  function attachRealtime(ticket,res){
    const key=clean(ticket,200),entry=realtimeTickets.get(key);
    realtimeTickets.delete(key);
    if(!entry||entry.expiresAt<Date.now())return false;
    const userId=String(entry.userId);
    res.status(200);
    res.setHeader("Content-Type","text/event-stream");
    res.setHeader("Cache-Control","no-cache, no-transform");
    res.setHeader("Connection","keep-alive");
    res.setHeader("X-Accel-Buffering","no");
    res.flushHeaders?.();
    const send=payload=>res.write("event: notification\ndata: "+JSON.stringify(payload)+"\n\n");
    if(!realtimeListeners.has(userId))realtimeListeners.set(userId,new Set());
    realtimeListeners.get(userId).add(send);
    res.write("event: ready\ndata: "+JSON.stringify({active_count:countActive(userId)})+"\n\n");
    const heartbeat=setInterval(()=>{try{res.write(": keep-alive\n\n");}catch(_error){}},20000);
    const cleanup=()=>{clearInterval(heartbeat);const set=realtimeListeners.get(userId);set?.delete(send);if(set&&!set.size)realtimeListeners.delete(userId);};
    res.on("close",cleanup);res.on("error",cleanup);
    return true;
  }

  function ensurePreference(userId){
    if(!userId)return;
    db.prepare("INSERT OR IGNORE INTO notification_preferences(user_id,notifications_enabled,sound_enabled) VALUES(?,1,1)").run(userId);
  }
  function preference(userId){
    ensurePreference(userId);
    return db.prepare("SELECT user_id,notifications_enabled,sound_enabled,disabled_by_user_id,updated_at FROM notification_preferences WHERE user_id=?").get(userId);
  }
  function enabledUsers(){
    return db.prepare(`SELECT u.id FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id
      WHERE u.status='Active' AND COALESCE(p.notifications_enabled,1)=1`).all().map(row=>row.id);
  }
  function countActive(userId){
    return Number(db.prepare(`SELECT COUNT(*) count FROM notification_recipients r JOIN notification_events n ON n.id=r.notification_id
      WHERE r.user_id=? AND n.resolved_at IS NULL AND r.acknowledged_at IS NULL
      AND (r.snoozed_until IS NULL OR datetime(r.snoozed_until)<=CURRENT_TIMESTAMP)`).get(userId)?.count||0);
  }
  async function sendPush(userId,event){
    if(!pushConfigured)return;
    const pref=preference(userId);if(!pref||!Number(pref.notifications_enabled))return;
    const subscriptions=db.prepare("SELECT * FROM push_subscriptions WHERE user_id=?").all(userId);
    if(!subscriptions.length)return;
    const count=countActive(userId),payload=JSON.stringify({
      id:event.id,title:event.title_en||"Klavierhaus",body:event.body_en||"",url:event.action_url||"/",count
    });
    for(const sub of subscriptions){
      try{
        await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_secret}},payload,{TTL:300});
        db.prepare("UPDATE push_subscriptions SET last_sent_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(sub.id);
      }catch(error){
        const status=Number(error?.statusCode||0),message=clean(error?.message||"PUSH_SEND_FAILED",1000);
        if(status===404||status===410)db.prepare("DELETE FROM push_subscriptions WHERE id=?").run(sub.id);
        else db.prepare("UPDATE push_subscriptions SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(message,sub.id);
      }
    }
  }
  function emit({
    category="SYSTEM",entityType="SYSTEM",entityId="SYSTEM",titleEn="Klavierhaus update",titleHu="Klavierhaus frissítés",
    bodyEn="",bodyHu="",actionUrl="",severity="INFO",actorUserId=null,recipients=null
  }={}){
    const eventId=id("NOTIF"),targets=[...new Set((Array.isArray(recipients)&&recipients.length?recipients:enabledUsers()).filter(Boolean))];
    db.transaction(()=>{
      db.prepare(`INSERT INTO notification_events(id,category,entity_type,entity_id,title_en,title_hu,body_en,body_hu,action_url,severity,created_by_user_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(eventId,clean(category,80),clean(entityType,80),clean(entityId,240),clean(titleEn,240),clean(titleHu,240),clean(bodyEn,1000),clean(bodyHu,1000),clean(actionUrl,1000),["INFO","SUCCESS","WARNING","URGENT"].includes(severity)?severity:"INFO",actorUserId||null);
      const insert=db.prepare(`INSERT OR IGNORE INTO notification_recipients(notification_id,user_id)
        SELECT ?,u.id FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id
        WHERE u.id=? AND u.status='Active' AND COALESCE(p.notifications_enabled,1)=1`);
      for(const userId of targets)insert.run(eventId,userId);
    })();
    const event=db.prepare("SELECT * FROM notification_events WHERE id=?").get(eventId);
    const delivered=db.prepare("SELECT user_id FROM notification_recipients WHERE notification_id=?").all(eventId).map(row=>row.user_id);
    for(const userId of delivered){void sendPush(userId,event);publishRealtime(userId,event);}
    return event;
  }
  function emitOnce({category,entityType,entityId,...rest}){
    const existing=db.prepare("SELECT * FROM notification_events WHERE category=? AND entity_type=? AND entity_id=? AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1")
      .get(clean(category,80),clean(entityType,80),clean(entityId,240));
    return existing||emit({category,entityType,entityId,...rest});
  }
  function refreshTimedNotifications(){
    const recentLeads=db.prepare(`SELECT id,name,lead_type,message,assigned_user_id FROM website_contact_leads
      WHERE status NOT IN ('CLOSED','REJECTED') AND datetime(created_at)>=datetime('now','-7 days') ORDER BY created_at DESC LIMIT 100`).all();
    for(const lead of recentLeads)emitOnce({
      category:"WEBSITE_LEAD",entityType:"WEBSITE_LEAD",entityId:String(lead.id),
      titleEn:"New website enquiry",titleHu:"Új weboldali megkeresés",
      bodyEn:`${lead.name} · ${String(lead.lead_type||"").replaceAll("_"," ")}${lead.message?` · ${String(lead.message).slice(0,220)}`:""}`,
      bodyHu:`${lead.name} · ${String(lead.lead_type||"").replaceAll("_"," ")}${lead.message?` · ${String(lead.message).slice(0,220)}`:""}`,
      actionUrl:"#cms",severity:"INFO",recipients:lead.assigned_user_id?[lead.assigned_user_id]:null
    });
    const openLeadIds=new Set(recentLeads.map(row=>String(row.id)));
    for(const event of db.prepare("SELECT id,entity_id FROM notification_events WHERE category='WEBSITE_LEAD' AND entity_type='WEBSITE_LEAD' AND resolved_at IS NULL").all()){
      if(!openLeadIds.has(String(event.entity_id)))db.prepare("UPDATE notification_events SET resolved_at=CURRENT_TIMESTAMP WHERE id=?").run(event.id);
    }

    const overdue=db.prepare(`SELECT p.job_id,p.stage_key,p.due_at,j.job_code,j.title,COALESCE(p.responsible_user_id,j.workflow_owner_user_id,j.assigned_technician_id) AS assigned_user_id
      FROM job_workflow_phases p JOIN jobs j ON j.id=p.job_id
      WHERE p.enabled=1 AND p.completed_at IS NULL AND p.due_at IS NOT NULL AND datetime(p.due_at)<CURRENT_TIMESTAMP
      AND j.cancelled_at IS NULL AND j.stage NOT IN ('planned','completed')`).all();
    const overdueKeys=new Set(overdue.map(row=>`${row.job_id}:${row.stage_key}`));
    for(const event of db.prepare("SELECT id,entity_id FROM notification_events WHERE category='DEADLINE' AND entity_type='WORKFLOW_PHASE' AND resolved_at IS NULL").all()){
      if(!overdueKeys.has(String(event.entity_id)))db.prepare("UPDATE notification_events SET resolved_at=CURRENT_TIMESTAMP WHERE id=?").run(event.id);
    }
    for(const row of overdue)emitOnce({
      category:"DEADLINE",entityType:"WORKFLOW_PHASE",entityId:`${row.job_id}:${row.stage_key}`,
      titleEn:"Workflow phase overdue",titleHu:"Lejárt munkafázis",
      bodyEn:`${row.job_code||("#"+row.job_id)} · ${row.title}`,bodyHu:`${row.job_code||("#"+row.job_id)} · ${row.title}`,
      actionUrl:"#workshop",severity:"URGENT",recipients:row.assigned_user_id?[row.assigned_user_id]:null
    });

    const dueAppointments=db.prepare(`SELECT id,name,scheduled_at,assigned_user_id FROM private_appointments
      WHERE status='SCHEDULED' AND datetime(scheduled_at)<=CURRENT_TIMESTAMP`).all();
    const appointmentKeys=new Set(dueAppointments.map(row=>String(row.id)));
    for(const event of db.prepare("SELECT id,entity_id FROM notification_events WHERE category='APPOINTMENT_DUE' AND entity_type='PRIVATE_APPOINTMENT' AND resolved_at IS NULL").all()){
      if(!appointmentKeys.has(String(event.entity_id)))db.prepare("UPDATE notification_events SET resolved_at=CURRENT_TIMESTAMP WHERE id=?").run(event.id);
    }
    for(const row of dueAppointments)emitOnce({
      category:"APPOINTMENT_DUE",entityType:"PRIVATE_APPOINTMENT",entityId:String(row.id),
      titleEn:"Private appointment needs attention",titleHu:"Privát időpont figyelmet igényel",
      bodyEn:`${row.name} · ${new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(row.scheduled_at))}`,
      bodyHu:`${row.name} · ${new Intl.DateTimeFormat("hu-HU",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(row.scheduled_at))}`,
      actionUrl:"/?view=workshop&private=1",severity:"WARNING",recipients:row.assigned_user_id?[row.assigned_user_id]:null
    });
  }
  function list(userId){
    ensurePreference(userId);refreshTimedNotifications();
    const pref=preference(userId);if(!Number(pref?.notifications_enabled))return {notifications:[],unread_count:0,active_count:0,preferences:pref,push_configured:pushConfigured};
    const rows=db.prepare(`SELECT n.*,r.read_at,r.snoozed_until,r.acknowledged_at
      FROM notification_recipients r JOIN notification_events n ON n.id=r.notification_id
      WHERE r.user_id=? AND n.resolved_at IS NULL AND r.acknowledged_at IS NULL
      AND (r.snoozed_until IS NULL OR datetime(r.snoozed_until)<=CURRENT_TIMESTAMP)
      ORDER BY n.created_at DESC,n.id DESC LIMIT 200`).all(userId);
    return {notifications:rows,unread_count:rows.filter(row=>!row.read_at).length,active_count:rows.length,preferences:preference(userId),push_configured:pushConfigured};
  }
  function visible(userId,notificationId){
    return Boolean(db.prepare("SELECT 1 FROM notification_recipients WHERE user_id=? AND notification_id=?").get(userId,notificationId));
  }
  function snooze(userId,notificationId,{hours=3,until=null}={}){
    if(!visible(userId,notificationId))throw Object.assign(new Error("NOTIFICATION_NOT_FOUND"),{status:404});
    let snoozedUntil=null;
    if(until){
      const date=new Date(until);if(Number.isNaN(date.getTime()))throw Object.assign(new Error("INVALID_NOTIFICATION_SNOOZE_TIME"),{status:400});
      snoozedUntil=date.toISOString();
    }else{
      const safeHours=Math.min(168,Math.max(1,Number(hours)||3));
      snoozedUntil=new Date(Date.now()+safeHours*3600000).toISOString();
    }
    db.prepare("UPDATE notification_recipients SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP),snoozed_until=?,acknowledged_at=NULL WHERE user_id=? AND notification_id=?")
      .run(snoozedUntil,userId,notificationId);
    return {ok:true,snoozed_until:snoozedUntil};
  }
  function acknowledge(userId,notificationId){
    if(!visible(userId,notificationId))throw Object.assign(new Error("NOTIFICATION_NOT_FOUND"),{status:404});
    db.prepare("UPDATE notification_recipients SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP),acknowledged_at=CURRENT_TIMESTAMP,snoozed_until=NULL WHERE user_id=? AND notification_id=?")
      .run(userId,notificationId);
    return {ok:true};
  }
  function acknowledgeAll(userId){
    db.prepare(`UPDATE notification_recipients SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP),acknowledged_at=CURRENT_TIMESTAMP,snoozed_until=NULL
      WHERE user_id=? AND acknowledged_at IS NULL`).run(userId);
    return {ok:true};
  }
  function snoozeAll(userId,{hours=3,until=null}={}){
    let snoozedUntil=null;
    if(until){
      const date=new Date(until);if(Number.isNaN(date.getTime()))throw Object.assign(new Error("INVALID_NOTIFICATION_SNOOZE_TIME"),{status:400});
      snoozedUntil=date.toISOString();
    }else{
      const safeHours=Math.min(168,Math.max(1,Number(hours)||3));
      snoozedUntil=new Date(Date.now()+safeHours*3600000).toISOString();
    }
    db.prepare(`UPDATE notification_recipients SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP),snoozed_until=?,acknowledged_at=NULL
      WHERE user_id=? AND acknowledged_at IS NULL`).run(snoozedUntil,userId);
    return {ok:true,snoozed_until:snoozedUntil};
  }
  function markRead(userId,notificationId){
    if(!visible(userId,notificationId))throw Object.assign(new Error("NOTIFICATION_NOT_FOUND"),{status:404});
    db.prepare("UPDATE notification_recipients SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE user_id=? AND notification_id=?").run(userId,notificationId);
    return {ok:true};
  }
  function resolveEntity(entityType,entityId){
    db.prepare("UPDATE notification_events SET resolved_at=COALESCE(resolved_at,CURRENT_TIMESTAMP) WHERE entity_type=? AND entity_id=?").run(clean(entityType,80),clean(entityId,240));
  }
  function auditQuery(sql,...params){try{return db.prepare(sql).get(...params)||null;}catch(_error){return null;}}
  function auditChangedFields(before={},after={}){
    if(!before||!after||typeof before!=="object"||typeof after!=="object")return [];
    const ignored=new Set(["id","created_at","updated_at","session_version","vip_updated_at","vip_updated_by_user_id","deleted_at","deleted_by_user_id","archive_document_id"]);
    return [...new Set(Object.keys(after).filter(key=>!ignored.has(key)&&Object.prototype.hasOwnProperty.call(before,key)&&JSON.stringify(before[key]??null)!==JSON.stringify(after[key]??null)))].slice(0,5);
  }
  function auditFieldLabel(key,language="en"){
    const labels={
      name:["name","név"],first_name:["first name","keresztnév"],last_name:["last name","vezetéknév"],company_name:["company name","cégnév"],contact_name:["contact name","kapcsolattartó"],
      email:["email","e-mail"],phone:["phone","telefon"],mobile_phone:["mobile phone","mobiltelefon"],line_phone:["landline phone","vezetékes telefon"],address:["address","cím"],street:["street","utca"],city:["city","város"],district:["district / state","kerület / állam"],postcode:["postcode","irányítószám"],country:["country","ország"],
      client_type:["client type","ügyféltípus"],is_vip:["VIP status","VIP státusz"],brand:["brand","márka"],model:["model","modell"],serial_number:["serial number","gyári szám"],color:["color","szín"],size_display:["size","méret"],build_year:["year built","gyártási év"],category:["category","kategória"],
      last_serviced_at:["last service date","utolsó szerviz dátuma"],last_service_title:["last service","utolsó szerviz"],last_service_description:["service description","szervizleírás"],next_service_date:["next service date","következő szerviz"],date_of_purchase:["purchase date","vásárlás dátuma"],warranty:["warranty","garancia"],
      title:["title","megnevezés"],description:["description","leírás"],status:["status","státusz"],stage:["workflow stage","munkafázis"],scheduled_at:["scheduled time","időpont"],assigned_technician_id:["assigned technician","kijelölt technikus"],
      total_amount:["total amount","végösszeg"],payment_method:["payment method","fizetési mód"],paid_at:["payment date","fizetés időpontja"],due_date:["due date","fizetési határidő"],reported_issue:["request / issue","igény / probléma"],estimated_urgency:["urgency","sürgősség"]
    };
    const pair=labels[key]||[key.replaceAll("_"," "),key.replaceAll("_"," ")];return language==="hu"?pair[1]:pair[0];
  }
  function auditContext(mod,recordId,oldValue,newValue){
    const after=newValue&&typeof newValue==="object"?newValue:{},before=oldValue&&typeof oldValue==="object"?oldValue:{};
    if(mod.startsWith("clients")){
      const row=auditQuery("SELECT * FROM clients WHERE id=?",recordId)||after||before;
      return {kind:"client",label:clean(row?.name||after?.name||before?.name||("Client #"+recordId),240),row,before,after,actionUrl:after?.archive_document_id?`/?view=documents&category=deleted_client&archive=${after.archive_document_id}`:`/?view=master&client=${recordId}`};
    }
    if(mod.startsWith("pianos")){
      const row=auditQuery(`SELECT p.*,c.name AS client_name FROM pianos p LEFT JOIN clients c ON c.id=p.client_id WHERE p.id=?`,recordId)||after||before;
      const label=[row?.brand||after?.brand||before?.brand||"No brand",row?.model||after?.model||before?.model].filter(Boolean).join(" ");
      return {kind:"piano",label:clean(label||("Piano #"+recordId),240),clientName:clean(row?.client_name||"",240),row,before,after,actionUrl:`/?view=master&piano=${recordId}`};
    }
    if(mod.startsWith("intake")){
      const oldLead=before?.lead&&typeof before.lead==="object"?before.lead:before;
      const row=auditQuery(`SELECT i.*,c.name AS client_name,p.brand AS piano_brand,p.model AS piano_model FROM intake_leads i LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN pianos p ON p.id=i.piano_id WHERE i.id=?`,recordId)||after?.lead||oldLead||{};
      return {kind:"intake",label:`Intake #${recordId}`,clientName:clean(row?.client_name||row?.raw_client_name||"",240),pianoLabel:clean([row?.piano_brand,row?.piano_model].filter(Boolean).join(" "),240),issue:clean(row?.reported_issue||"",180),row,before:oldLead,after:after?.lead||after,actionUrl:after?.archive_document_id?`/?view=documents&category=deleted_intake&archive=${after.archive_document_id}`:`/?view=intake&intake=${recordId}`};
    }
    if(mod.startsWith("invoices")){
      const row=auditQuery(`SELECT i.*,c.name AS client_name FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.id=?`,recordId)||after||before;
      return {kind:"invoice",label:clean(row?.invoice_number||after?.invoice_number||before?.invoice_number||("Invoice #"+recordId),240),clientName:clean(row?.client_name||row?.counterparty_name||after?.counterparty_name||before?.counterparty_name||"",240),row,before,after,actionUrl:`/?view=finance&invoice=${recordId}`};
    }
    if(mod.startsWith("jobs")){
      const row=auditQuery(`SELECT j.*,c.name AS client_name,p.brand AS piano_brand,p.model AS piano_model FROM jobs j LEFT JOIN clients c ON c.id=j.client_id LEFT JOIN pianos p ON p.id=j.piano_id WHERE j.id=?`,recordId)||after||before;
      return {kind:"job",label:clean(row?.job_code||after?.job_code||before?.job_code||("Job #"+recordId),240),clientName:clean(row?.client_name||"",240),pianoLabel:clean([row?.piano_brand,row?.piano_model].filter(Boolean).join(" "),240),row,before,after,actionUrl:`/?view=workshop&job=${recordId}`};
    }
    const label=mod.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase());
    return {kind:"record",label,row:after,before,after,actionUrl:""};
  }
  function fromAudit({action,module,recordId,oldValue,newValue,user,success=true}={}){
    if(!success)return null;
    const mod=clean(module,80),act=clean(action,60).toUpperCase(),actor=clean(user?.name||"System",160);
    if(!mod||["notifications","auth","session","branding"].includes(mod))return null;
    const allowedPrefixes=["clients","pianos","intake","jobs","invoices","document","website_leads","events"];
    if(!allowedPrefixes.some(prefix=>mod.startsWith(prefix)))return null;
    const terminal=/COMPLETE|CLOSE|CANCEL|DELETE|ARCHIVE/.test(act);
    if(terminal&&recordId!==undefined&&recordId!==null)resolveEntity(mod.toUpperCase(),String(recordId));
    const severity=/CANCEL|DELETE|FAIL|OVERDUE/.test(act)?"WARNING":/COMPLETE|PAID|CLOSE/.test(act)?"SUCCESS":"INFO";
    const ctx=auditContext(mod,String(recordId||""),oldValue,newValue),changes=auditChangedFields(ctx.before,ctx.after);
    const changesEn=changes.map(key=>auditFieldLabel(key,"en")).join(", "),changesHu=changes.map(key=>auditFieldLabel(key,"hu")).join(", ");
    let titleEn=`${actor} · ${act.replaceAll("_"," ")} · ${ctx.label}`,titleHu=titleEn,bodyEn=changesEn?`Updated: ${changesEn}.`:"",bodyHu=changesHu?`Módosult: ${changesHu}.`:"";

    if(ctx.kind==="client"){
      if(act==="CREATE"){titleEn=`${actor} created client ${ctx.label}`;titleHu=`${actor} létrehozta az ügyfelet: ${ctx.label}`;bodyEn="New client added to Master Data.";bodyHu="Új ügyfél került a törzsadatok közé.";}
      else if(act==="UPDATE"){titleEn=`${actor} updated client ${ctx.label}`;titleHu=`${actor} frissítette az ügyfelet: ${ctx.label}`;}
      else if(act==="DELETE"){titleEn=`${actor} deleted client ${ctx.label}`;titleHu=`${actor} törölte az ügyfelet: ${ctx.label}`;bodyEn="Removed from active Master Data and moved to Deleted clients archive.";bodyHu="Eltávolítva az aktív törzsadatokból, és áthelyezve a Törölt ügyfelek archívumba.";}
    }else if(ctx.kind==="piano"){
      const owner=ctx.clientName?` · ${ctx.clientName}`:"";
      if(act==="CREATE"){titleEn=`${actor} added piano ${ctx.label}`;titleHu=`${actor} zongorát adott hozzá: ${ctx.label}`;bodyEn=`Piano added to Master Data${owner}.`;bodyHu=`Zongora hozzáadva a törzsadatokhoz${owner}.`;}
      else if(act==="UPDATE"){titleEn=`${actor} updated piano ${ctx.label}`;titleHu=`${actor} frissítette a zongorát: ${ctx.label}`;if(ctx.clientName&&changesEn)bodyEn=`${ctx.clientName} · Updated: ${changesEn}.`;if(ctx.clientName&&changesHu)bodyHu=`${ctx.clientName} · Módosult: ${changesHu}.`;}
    }else if(ctx.kind==="intake"){
      if(act==="DELETE"){titleEn=`${actor} deleted an intake request`;titleHu=`${actor} törölt egy igényfelmérést`;const parts=[ctx.clientName,ctx.pianoLabel,ctx.issue].filter(Boolean).join(" · ");bodyEn=`${parts?parts+" · ":""}Moved to Deleted intake requests.`;bodyHu=`${parts?parts+" · ":""}Áthelyezve a Törölt igények archívumba.`;}
      else if(act==="CREATE"){titleEn=`${actor} created ${ctx.label}`;titleHu=`${actor} létrehozta: ${ctx.label}`;bodyEn=[ctx.clientName,ctx.pianoLabel,ctx.issue].filter(Boolean).join(" · ");bodyHu=bodyEn;}
      else if(act==="UPDATE"){titleEn=`${actor} updated ${ctx.label}`;titleHu=`${actor} frissítette: ${ctx.label}`;if(ctx.clientName&&changesEn)bodyEn=`${ctx.clientName} · Updated: ${changesEn}.`;if(ctx.clientName&&changesHu)bodyHu=`${ctx.clientName} · Módosult: ${changesHu}.`;}
    }else if(ctx.kind==="invoice"){
      if(/PAID|PAYMENT/.test(act)){
        const amount=Number(ctx.row?.total_amount||ctx.after?.total_amount||ctx.before?.total_amount||0),money=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(amount);
        titleEn="Invoice payment recorded";titleHu="Számlafizetés rögzítve";
        bodyEn=`${actor} recorded ${money} payment for ${ctx.label}${ctx.clientName?" · "+ctx.clientName:""}.`;
        bodyHu=`${actor} ${money} összegű fizetést rögzített: ${ctx.label}${ctx.clientName?" · "+ctx.clientName:""}.`;
      }else{titleEn=`${actor} ${act==="CREATE"?"created":"updated"} ${ctx.label}`;titleHu=`${actor} ${act==="CREATE"?"létrehozta":"frissítette"}: ${ctx.label}`;if(ctx.clientName&&changesEn)bodyEn=`${ctx.clientName} · Updated: ${changesEn}.`;if(ctx.clientName&&changesHu)bodyHu=`${ctx.clientName} · Módosult: ${changesHu}.`;}
    }else if(ctx.kind==="job"){
      if(/COMPLETE|CLOSE/.test(act)){titleEn=`${actor} completed ${ctx.label}`;titleHu=`${actor} lezárta: ${ctx.label}`;bodyEn=[ctx.pianoLabel,ctx.clientName].filter(Boolean).join(" · ");bodyHu=bodyEn;}
      else{titleEn=`${actor} ${act==="CREATE"?"created":"updated"} ${ctx.label}`;titleHu=`${actor} ${act==="CREATE"?"létrehozta":"frissítette"}: ${ctx.label}`;const context=[ctx.pianoLabel,ctx.clientName,changesEn?`Updated: ${changesEn}`:""].filter(Boolean).join(" · ");bodyEn=context;bodyHu=[ctx.pianoLabel,ctx.clientName,changesHu?`Módosult: ${changesHu}`:""].filter(Boolean).join(" · ");}
    }

    if(!bodyEn)bodyEn=`${actor} performed ${act.replaceAll("_"," ").toLowerCase()} on ${ctx.label}.`;
    if(!bodyHu)bodyHu=`${actor} műveletet végzett: ${ctx.label} · ${act.replaceAll("_"," ").toLowerCase()}.`;
    const source=newValue&&typeof newValue==="object"?newValue:{};
    const recipientKeys=["assigned_user_id","responsible_user_id","technician_id","main_responsible_user_id","owner_user_id"];
    const recipients=[...new Set(recipientKeys.map(key=>source?.[key]).filter(Boolean))];
    return emit({category:"OPERATIONAL",entityType:mod.toUpperCase(),entityId:String(recordId||""),titleEn,titleHu,bodyEn,bodyHu,actionUrl:ctx.actionUrl,severity,actorUserId:user?.id||null,recipients:recipients.length?recipients:null});
  }
  function subscribe(userId,subscription,userAgent=""){
    if(!subscription?.endpoint||!subscription?.keys?.p256dh||!subscription?.keys?.auth)throw Object.assign(new Error("INVALID_PUSH_SUBSCRIPTION"),{status:400});
    ensurePreference(userId);
    const existing=db.prepare("SELECT id FROM push_subscriptions WHERE endpoint=?").get(subscription.endpoint),subscriptionId=existing?.id||id("PUSH");
    db.prepare(`INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth_secret,user_agent)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,user_agent=excluded.user_agent,updated_at=CURRENT_TIMESTAMP,last_error=NULL`)
      .run(subscriptionId,userId,clean(subscription.endpoint,3000),clean(subscription.keys.p256dh,1000),clean(subscription.keys.auth,1000),clean(userAgent,500));
    return {ok:true,id:subscriptionId};
  }
  function unsubscribe(userId,endpoint){
    db.prepare("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?").run(userId,clean(endpoint,3000));return {ok:true};
  }
  return {emit,emitOnce,list,snooze,snoozeAll,acknowledge,acknowledgeAll,markRead,resolveEntity,refreshTimedNotifications,preference,ensurePreference,fromAudit,subscribe,unsubscribe,issueRealtimeTicket,attachRealtime,pushConfigured,vapidPublicKey:vapid.publicKey};
}

function registerNotificationCenterRoutes({app,db,auth,permit,audit,env=process.env,service=null}){
  const notifications=service||createNotificationCenter({db,env}),admin=permit("ADMIN");
  const send=(res,fn)=>{try{res.json(fn());}catch(error){res.status(Number(error?.status||400)).json({error:error?.message||"NOTIFICATION_REQUEST_FAILED"});}};
  app.get("/api/notifications",auth,(req,res)=>send(res,()=>notifications.list(req.user.id)));
  app.get("/api/notifications/active",auth,(req,res)=>send(res,()=>notifications.list(req.user.id)));
  app.post("/api/notifications/realtime-ticket",auth,(req,res)=>send(res,()=>notifications.issueRealtimeTicket(req.user.id)));
  app.get("/api/notifications/stream",(req,res)=>{
    if(!notifications.attachRealtime(req.query?.ticket,res))return res.status(401).json({error:"INVALID_NOTIFICATION_STREAM_TICKET"});
  });
  app.post("/api/notifications/:id/read",auth,(req,res)=>send(res,()=>notifications.markRead(req.user.id,req.params.id)));
  app.post("/api/notifications/:id/snooze",auth,(req,res)=>send(res,()=>notifications.snooze(req.user.id,req.params.id,{hours:req.body?.hours??3,until:req.body?.until||null})));
  app.post("/api/notifications/:id/acknowledge",auth,(req,res)=>send(res,()=>notifications.acknowledge(req.user.id,req.params.id)));
  app.post("/api/notifications/acknowledge-all",auth,(req,res)=>send(res,()=>notifications.acknowledgeAll(req.user.id)));
  app.post("/api/notifications/snooze-all",auth,(req,res)=>send(res,()=>notifications.snoozeAll(req.user.id,{hours:req.body?.hours??3,until:req.body?.until||null})));
  app.get("/api/notifications/preferences",auth,(req,res)=>send(res,()=>({preferences:notifications.preference(req.user.id),push_configured:notifications.pushConfigured,vapid_public_key:notifications.vapidPublicKey})));
  app.put("/api/notifications/preferences/sound",auth,(req,res)=>send(res,()=>{
    notifications.ensurePreference(req.user.id);const enabled=req.body?.sound_enabled?1:0;
    db.prepare("UPDATE notification_preferences SET sound_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(enabled,req.user.id);
    audit?.(req,"UPDATE_SOUND","notifications",req.user.id,null,{sound_enabled:enabled});return notifications.preference(req.user.id);
  }));
  app.get("/api/admin/users/:id/notification-delivery",auth,admin,(req,res)=>send(res,()=>{
    const userId=clean(req.params.id,160);if(!db.prepare("SELECT 1 FROM users WHERE id=?").get(userId))throw Object.assign(new Error("USER_NOT_FOUND"),{status:404});
    return notifications.preference(userId);
  }));
  app.put("/api/admin/users/:id/notification-delivery",auth,admin,(req,res)=>send(res,()=>{
    const userId=clean(req.params.id,160);if(!db.prepare("SELECT 1 FROM users WHERE id=?").get(userId))throw Object.assign(new Error("USER_NOT_FOUND"),{status:404});
    notifications.ensurePreference(userId);const enabled=req.body?.notifications_enabled?1:0;
    db.prepare("UPDATE notification_preferences SET notifications_enabled=?,disabled_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(enabled,enabled?null:req.user.id,userId);
    audit?.(req,"UPDATE_DELIVERY","notifications",userId,null,{notifications_enabled:enabled});return notifications.preference(userId);
  }));
  app.get("/api/push/config",auth,(req,res)=>res.json({enabled:notifications.pushConfigured,public_key:notifications.vapidPublicKey||""}));
  app.post("/api/push/subscriptions",auth,(req,res)=>send(res,()=>notifications.subscribe(req.user.id,req.body?.subscription,req.headers["user-agent"]||"")));
  app.delete("/api/push/subscriptions",auth,(req,res)=>send(res,()=>notifications.unsubscribe(req.user.id,req.body?.endpoint||"")));
  return notifications;
}

module.exports={createNotificationCenter,registerNotificationCenterRoutes};

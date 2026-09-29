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
    for(const userId of targets)void sendPush(userId,event);
    return event;
  }
  function list(userId){
    ensurePreference(userId);
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
  function markRead(userId,notificationId){
    if(!visible(userId,notificationId))throw Object.assign(new Error("NOTIFICATION_NOT_FOUND"),{status:404});
    db.prepare("UPDATE notification_recipients SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE user_id=? AND notification_id=?").run(userId,notificationId);
    return {ok:true};
  }
  function resolveEntity(entityType,entityId){
    db.prepare("UPDATE notification_events SET resolved_at=COALESCE(resolved_at,CURRENT_TIMESTAMP) WHERE entity_type=? AND entity_id=?").run(clean(entityType,80),clean(entityId,240));
  }
  function fromAudit({action,module,recordId,oldValue,newValue,user,success=true}={}){
    if(!success)return null;
    const mod=clean(module,80),act=clean(action,60).toUpperCase();
    if(!mod||["notifications","auth","session","branding"].includes(mod))return null;
    const allowedPrefixes=["clients","pianos","intake","jobs","invoices","document","website_leads","events"];
    if(!allowedPrefixes.some(prefix=>mod.startsWith(prefix)))return null;
    const label=mod.replaceAll("_"," ").replace(/\b\w/g,m=>m.toUpperCase());
    const severity=/CANCEL|DELETE|FAIL|OVERDUE/.test(act)?"WARNING":/COMPLETE|PAID|CLOSE/.test(act)?"SUCCESS":"INFO";
    const bodyEn=`${user?.name||"System"} · ${act.replaceAll("_"," ")}`;
    const bodyHu=`${user?.name||"Rendszer"} · ${act.replaceAll("_"," ")}`;
    return emit({category:"OPERATIONAL",entityType:mod.toUpperCase(),entityId:String(recordId||""),titleEn:label,titleHu:label,bodyEn,bodyHu,severity,actorUserId:user?.id||null});
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
  return {emit,list,snooze,acknowledge,acknowledgeAll,markRead,resolveEntity,preference,ensurePreference,fromAudit,subscribe,unsubscribe,pushConfigured,vapidPublicKey:vapid.publicKey};
}

function registerNotificationCenterRoutes({app,db,auth,permit,audit,env=process.env,service=null}){
  const notifications=service||createNotificationCenter({db,env}),admin=permit("ADMIN");
  const send=(res,fn)=>{try{res.json(fn());}catch(error){res.status(Number(error?.status||400)).json({error:error?.message||"NOTIFICATION_REQUEST_FAILED"});}};
  app.get("/api/notifications",auth,(req,res)=>send(res,()=>notifications.list(req.user.id)));
  app.get("/api/notifications/active",auth,(req,res)=>send(res,()=>notifications.list(req.user.id)));
  app.post("/api/notifications/:id/read",auth,(req,res)=>send(res,()=>notifications.markRead(req.user.id,req.params.id)));
  app.post("/api/notifications/:id/snooze",auth,(req,res)=>send(res,()=>notifications.snooze(req.user.id,req.params.id,{hours:req.body?.hours??3,until:req.body?.until||null})));
  app.post("/api/notifications/:id/acknowledge",auth,(req,res)=>send(res,()=>notifications.acknowledge(req.user.id,req.params.id)));
  app.post("/api/notifications/acknowledge-all",auth,(req,res)=>send(res,()=>notifications.acknowledgeAll(req.user.id)));
  app.get("/api/notifications/preferences",auth,(req,res)=>send(res,()=>({preferences:notifications.preference(req.user.id),push_configured:notifications.pushConfigured,vapid_public_key:notifications.vapidPublicKey})));
  app.put("/api/notifications/preferences/sound",auth,(req,res)=>send(res,()=>{
    notifications.ensurePreference(req.user.id);const enabled=req.body?.sound_enabled?1:0;
    db.prepare("UPDATE notification_preferences SET sound_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(enabled,req.user.id);
    audit?.(req,"UPDATE_SOUND","notifications",req.user.id,null,{sound_enabled:enabled});return notifications.preference(req.user.id);
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

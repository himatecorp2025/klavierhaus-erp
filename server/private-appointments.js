"use strict";

const crypto=require("node:crypto");
const clean=(value,max=2000)=>String(value??"").replace(/\u0000/g,"").trim().slice(0,max);
const rid=()=>`PA-${crypto.randomUUID()}`;
const validTime=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?null:date.toISOString();};

function registerPrivateAppointmentRoutes({app,db,auth,permit,audit,notifications}){
  const staff=permit("ADMIN","MANAGER","WORKER"),admin=permit("ADMIN");
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
  const byId=id=>db.prepare(`${detailSql} WHERE a.id=?`).get(id);
  const notify=(row,{kind="created",actor=null}={})=>{
    if(!row||!notifications)return;
    const context=row.piano_id?(row.piano_title_en||[row.piano_brand,row.piano_model].filter(Boolean).join(" ")):row.service_id?(row.service_title_en||"Service"):"Private visit";
    const titleEn=kind==="created"?"New private appointment":kind==="rescheduled"?"Private appointment rescheduled":kind==="completed"?"Private appointment completed":"Private appointment cancelled";
    const titleHu=kind==="created"?"Új privát időpont":kind==="rescheduled"?"Privát időpont átütemezve":kind==="completed"?"Privát időpont lezárva":"Privát időpont törölve";
    const when=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",dateStyle:"medium",timeStyle:"short"}).format(new Date(row.scheduled_at));
    if(["completed","cancelled"].includes(kind))notifications.resolveEntity("PRIVATE_APPOINTMENT",row.id);
    notifications.emit({
      category:"PRIVATE_APPOINTMENT",entityType:"PRIVATE_APPOINTMENT",entityId:row.id,
      titleEn,titleHu,
      bodyEn:`${row.name} · ${context} · ${when}${row.note?` · ${row.note}`:""}`,
      bodyHu:`${row.name} · ${context} · ${when}${row.note?` · ${row.note}`:""}`,
      actionUrl:"/?view=workshop&private=1",severity:kind==="cancelled"?"WARNING":kind==="completed"?"SUCCESS":"INFO",
      actorUserId:actor?.id||null
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
  function create(body,{actor=null,source="PUBLIC"}={}){
    const name=clean(body?.name,200),phone=clean(body?.phone,80),scheduledAt=validTime(body?.scheduled_at||body?.appointment_at||body?.preferred_time),note=clean(body?.note??body?.message,1000);
    if(!name)return {error:"PRIVATE_APPOINTMENT_NAME_REQUIRED",status:400};
    if(!phone)return {error:"PRIVATE_APPOINTMENT_PHONE_REQUIRED",status:400};
    if(!scheduledAt)return {error:"PRIVATE_APPOINTMENT_TIME_REQUIRED",status:400};
    let context;try{context=validateContext(body);}catch(error){return {error:error.message,status:error.status||400};}
    const id=rid(),assigned=clean(body?.assigned_user_id,160)||null;
    if(assigned&&!db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assigned))return {error:"INVALID_APPOINTMENT_ASSIGNEE",status:400};
    db.prepare(`INSERT INTO private_appointments(id,appointment_type,name,phone,scheduled_at,note,piano_id,service_id,status,assigned_user_id,language,source_path,created_source,created_by_user_id)
      VALUES(?,?,?,?,?,?,?,?, 'SCHEDULED',?,?,?,?,?)`).run(
        id,context.type,name,phone,scheduledAt,note||null,context.pianoId,context.serviceId,assigned,
        body?.language==="hu"?"hu":"en",clean(body?.source_path,1000)||null,source,actor?.id||null
      );
    const row=byId(id);notify(row,{kind:"created",actor});return {row};
  }

  app.post("/api/public/private-appointments",(req,res)=>{
    const ip=clean(req.ip||req.socket?.remoteAddress,120);if(limited(ip))return res.status(429).json({error:"TOO_MANY_REQUESTS"});
    const result=create(req.body,{source:"PUBLIC"});if(result.error)return res.status(result.status).json({error:result.error});
    res.status(201).json({ok:true,id:result.row.id,appointment:result.row});
  });
  app.post("/api/private-appointments",auth,staff,(req,res)=>{
    const result=create(req.body,{actor:req.user,source:"ERP"});if(result.error)return res.status(result.status).json({error:result.error});
    audit(req,"CREATE","private_appointments",result.row.id,null,result.row);res.status(201).json(result.row);
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
  app.get("/api/private-appointments/:id",auth,staff,(req,res)=>{
    const row=byId(req.params.id);if(!row)return res.status(404).json({error:"PRIVATE_APPOINTMENT_NOT_FOUND"});res.json(row);
  });
  app.put("/api/private-appointments/:id",auth,staff,(req,res)=>{
    const before=byId(req.params.id);if(!before)return res.status(404).json({error:"PRIVATE_APPOINTMENT_NOT_FOUND"});
    const scheduledAt=req.body?.scheduled_at===undefined?before.scheduled_at:validTime(req.body.scheduled_at);
    if(!scheduledAt)return res.status(400).json({error:"PRIVATE_APPOINTMENT_TIME_REQUIRED"});
    const status=clean(req.body?.status??before.status,30).toUpperCase();
    if(!["SCHEDULED","COMPLETED","CANCELLED"].includes(status))return res.status(400).json({error:"INVALID_APPOINTMENT_STATUS"});
    const assigned=req.body?.assigned_user_id===undefined?before.assigned_user_id:(clean(req.body.assigned_user_id,160)||null);
    if(assigned&&!db.prepare("SELECT 1 FROM users WHERE id=? AND status='Active'").get(assigned))return res.status(400).json({error:"INVALID_APPOINTMENT_ASSIGNEE"});
    db.prepare(`UPDATE private_appointments SET name=?,phone=?,scheduled_at=?,note=?,status=?,assigned_user_id=?,
      completed_at=CASE WHEN ?='COMPLETED' THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE NULL END,
      cancelled_at=CASE WHEN ?='CANCELLED' THEN COALESCE(cancelled_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(clean(req.body?.name??before.name,200),clean(req.body?.phone??before.phone,80),scheduledAt,clean(req.body?.note??before.note,1000)||null,status,assigned,status,status,before.id);
    const after=byId(before.id),kind=status==="COMPLETED"?"completed":status==="CANCELLED"?"cancelled":scheduledAt!==before.scheduled_at?"rescheduled":null;
    if(kind)notify(after,{kind,actor:req.user});
    audit(req,"UPDATE","private_appointments",before.id,before,after);res.json(after);
  });
  app.delete("/api/private-appointments/:id",auth,admin,(req,res)=>{
    const before=byId(req.params.id);if(!before)return res.status(404).json({error:"PRIVATE_APPOINTMENT_NOT_FOUND"});
    db.prepare("DELETE FROM private_appointments WHERE id=?").run(before.id);notifications?.resolveEntity("PRIVATE_APPOINTMENT",before.id);
    audit(req,"DELETE","private_appointments",before.id,before,null);res.json({ok:true});
  });
}

module.exports={registerPrivateAppointmentRoutes};

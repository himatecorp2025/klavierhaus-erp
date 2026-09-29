"use strict";

const crypto=require("node:crypto");

function text(value,max=2000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function sqlTime(date=new Date()){return date.toISOString().replace("T"," ").slice(0,19);}
function json(value){try{return JSON.parse(String(value||"{}"));}catch(_error){return {};}}
function createAutomationOutbox({db,notifications,maxAttempts=5}){
  const handlers=new Map(),delays=[60,300,900,3600,21600];
  db.prepare("UPDATE automation_outbox SET status='pending',locked_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE status='processing' AND datetime(locked_at)<datetime('now','-10 minutes')").run();

  function register(eventType,handler){
    if(!eventType||typeof handler!=="function")throw new Error("OUTBOX_HANDLER_INVALID");
    handlers.set(String(eventType),handler);return api;
  }
  function rowById(id){const row=db.prepare("SELECT * FROM automation_outbox WHERE id=?").get(id);return row?{...row,payload:json(row.payload_json)}:null;}
  function enqueue({eventType,entityType,entityId,payload={},dedupeKey,availableAt=null}){
    const type=text(eventType,120),entity=text(entityType,120),entityKey=text(entityId,240),dedupe=text(dedupeKey,500);
    if(!type||!entity||!entityKey||!dedupe)throw new Error("OUTBOX_EVENT_INVALID");
    const existing=db.prepare("SELECT id,status FROM automation_outbox WHERE dedupe_key=?").get(dedupe);
    if(existing){
      if(existing.status!=="completed")db.prepare("UPDATE automation_outbox SET payload_json=?,status='pending',available_at=?,locked_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(JSON.stringify(payload||{}),availableAt||sqlTime(),existing.id);
      return rowById(existing.id);
    }
    const id="OUT-"+crypto.randomUUID();
    db.prepare(`INSERT INTO automation_outbox(id,event_type,entity_type,entity_id,payload_json,status,attempts,available_at,dedupe_key)
      VALUES(?,?,?,?,?,'pending',0,?,?)`).run(id,type,entity,entityKey,JSON.stringify(payload||{}),availableAt||sqlTime(),dedupe);
    return rowById(id);
  }
  function notifyTerminal(row,error){
    if(!notifications)return;
    const recipients=db.prepare("SELECT id FROM users WHERE status='Active' AND (role='ADMIN' OR role='SUPERADMIN' OR is_superadmin=1)").all().map(r=>r.id);
    if(!recipients.length)return;
    notifications.emit({
      category:"AUTOMATION",entityType:row.entity_type,entityId:row.entity_id,
      titleEn:"Automation requires attention",titleHu:"Automatizálás beavatkozást igényel",
      bodyEn:`${row.event_type} failed after ${row.attempts} attempts: ${text(error?.message||error,240)}`,
      bodyHu:`${row.event_type} ${row.attempts} próbálkozás után sem sikerült: ${text(error?.message||error,240)}`,
      severity:"URGENT",recipients
    });
  }
  async function run(id){
    let row=rowById(id);if(!row)return null;
    if(row.status==="completed")return row;
    const handler=handlers.get(row.event_type);if(!handler)throw new Error("OUTBOX_HANDLER_NOT_REGISTERED");
    const claim=db.prepare("UPDATE automation_outbox SET status='processing',locked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','failed')").run(id);
    if(!claim.changes)return rowById(id);
    row=rowById(id);
    try{
      await handler(row.payload,row);
      db.prepare("UPDATE automation_outbox SET status='completed',completed_at=CURRENT_TIMESTAMP,locked_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      return rowById(id);
    }catch(error){
      const attempts=Number(row.attempts||0)+1,terminal=attempts>=maxAttempts,delay=delays[Math.min(attempts-1,delays.length-1)];
      db.prepare("UPDATE automation_outbox SET status=?,attempts=?,available_at=?,locked_at=NULL,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(terminal?"failed":"pending",attempts,sqlTime(new Date(Date.now()+delay*1000)),text(error?.code||error?.message||"AUTOMATION_FAILED",1000),id);
      const after=rowById(id);if(terminal)notifyTerminal(after,error);
      error.outbox=after;throw error;
    }
  }
  async function processDue(limit=10){
    const rows=db.prepare("SELECT id FROM automation_outbox WHERE status='pending' AND datetime(available_at)<=datetime('now') ORDER BY created_at,id LIMIT ?").all(Number(limit||10));
    const results=[];
    for(const row of rows){try{results.push(await run(row.id));}catch(error){results.push(error.outbox||rowById(row.id));}}
    return results;
  }
  function retry(id){
    const row=rowById(id);if(!row)throw new Error("OUTBOX_EVENT_NOT_FOUND");
    db.prepare("UPDATE automation_outbox SET status='pending',available_at=CURRENT_TIMESTAMP,locked_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    return rowById(id);
  }
  const api={register,enqueue,run,processDue,retry,rowById};
  return api;
}
module.exports={createAutomationOutbox,sqlTime};

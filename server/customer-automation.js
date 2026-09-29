"use strict";

function text(value,max=2000){return String(value??"").replace(/\u0000/g,"").trim().slice(0,max);}
function validEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||"").trim().toLowerCase());}
function nonRetryable(code){
  const error=new Error(code);error.code=code;error.retryable=false;return error;
}
function nyDate(value=new Date()){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(value);
  const p=Object.fromEntries(parts.filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function addDays(dateKey,days){const d=new Date(dateKey+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString().slice(0,10);}

const JOB_EVENTS=new Set(["JOB_CONFIRMED","APPOINTMENT_SCHEDULED","APPOINTMENT_REMINDER","WORK_STARTED","WORK_COMPLETED"]);
const INVOICE_EVENTS=new Set(["INVOICE_DUE_3_DAYS","INVOICE_DUE_TODAY","INVOICE_OVERDUE_7_DAYS"]);

function createCustomerAutomation({db,transactionalEmail,automationOutbox}){
  if(!automationOutbox)throw new Error("CUSTOMER_AUTOMATION_OUTBOX_REQUIRED");

  function jobContext(id){
    return db.prepare(`SELECT j.*,c.name AS client_name,c.email AS client_email,c.preferred_language,
      p.brand AS piano_brand,p.model AS piano_model,p.serial_number AS piano_serial_number
      FROM jobs j JOIN clients c ON c.id=j.client_id JOIN pianos p ON p.id=j.piano_id WHERE j.id=?`).get(id);
  }
  function invoiceContext(id){
    return db.prepare(`SELECT i.*,c.name AS client_name,c.email AS client_email,c.preferred_language
      FROM invoices i LEFT JOIN clients c ON c.id=i.client_id WHERE i.id=?`).get(id);
  }
  function record({eventType,jobId=null,invoiceId=null,clientId=null,recipient=null,language="en",status,providerMessageId=null,errorCode=null,dedupeKey,metadata={}}){
    db.prepare(`INSERT INTO customer_communication_log(event_type,job_id,invoice_id,client_id,recipient,language,status,provider_message_id,error_code,dedupe_key,metadata_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(dedupe_key) DO UPDATE SET recipient=excluded.recipient,language=excluded.language,status=excluded.status,
        provider_message_id=excluded.provider_message_id,error_code=excluded.error_code,metadata_json=excluded.metadata_json,created_at=CURRENT_TIMESTAMP`)
      .run(eventType,jobId,invoiceId,clientId,recipient,language,status,providerMessageId,errorCode,dedupeKey,JSON.stringify(metadata||{}));
  }
  function recipientFor(context){return String(context?.client_email||"").trim().toLowerCase();}
  function languageFor(context){return context?.preferred_language==="hu"?"hu":"en";}

  automationOutbox.register("SEND_CUSTOMER_COMMUNICATION",async(payload,row)=>{
    const eventType=text(payload?.event_type,80),jobId=Number(payload?.job_id||0)||null,invoiceId=Number(payload?.invoice_id||0)||null;
    const context=jobId?jobContext(jobId):invoiceContext(invoiceId);
    if(!context)throw nonRetryable(jobId?"JOB_NOT_FOUND":"INVOICE_NOT_FOUND");
    if(jobId&&context.cancelled_at)return;
    if(invoiceId&&context.status!=="sent")return;
    const recipient=recipientFor(context),language=languageFor(context),dedupeKey=row.dedupe_key;
    if(!validEmail(recipient)){
      record({eventType,jobId,invoiceId,clientId:context.client_id,recipient:recipient||null,language,status:"failed",errorCode:"CLIENT_EMAIL_REQUIRED",dedupeKey,metadata:{reason:"missing_email"}});
      throw nonRetryable("CLIENT_EMAIL_REQUIRED");
    }
    try{
      const delivery=await transactionalEmail.sendCustomerMilestone({
        to:recipient,eventType,clientName:context.client_name,
        job:jobId?context:{},invoice:invoiceId?context:{},language,
        idempotencyKey:`customer-communication-${dedupeKey}`
      });
      record({eventType,jobId,invoiceId,clientId:context.client_id,recipient,language,status:"sent",providerMessageId:delivery.providerMessageId,dedupeKey,metadata:{outbox_id:row.id}});
    }catch(error){
      record({eventType,jobId,invoiceId,clientId:context.client_id,recipient,language,status:"failed",errorCode:text(error?.code||error?.message||"EMAIL_DELIVERY_FAILED",120),dedupeKey,metadata:{outbox_id:row.id}});
      throw error;
    }
  });

  function enqueueJobMilestone(jobId,eventType,{dedupeSuffix=""}={}){
    if(!JOB_EVENTS.has(eventType))throw new Error("CUSTOMER_JOB_EVENT_INVALID");
    const job=jobContext(Number(jobId));if(!job)return null;
    const suffix=dedupeSuffix||((eventType==="APPOINTMENT_SCHEDULED"||eventType==="APPOINTMENT_REMINDER")?String(job.scheduled_at||"unscheduled"):"once");
    return automationOutbox.enqueue({
      eventType:"SEND_CUSTOMER_COMMUNICATION",entityType:"job",entityId:String(job.id),
      payload:{event_type:eventType,job_id:job.id},dedupeKey:`customer-job-${job.id}-${eventType}-${suffix}`
    });
  }
  function enqueueInvoiceReminder(invoiceId,eventType){
    if(!INVOICE_EVENTS.has(eventType))throw new Error("CUSTOMER_INVOICE_EVENT_INVALID");
    const invoice=invoiceContext(Number(invoiceId));if(!invoice||invoice.status!=="sent")return null;
    return automationOutbox.enqueue({
      eventType:"SEND_CUSTOMER_COMMUNICATION",entityType:"invoice",entityId:String(invoice.id),
      payload:{event_type:eventType,invoice_id:invoice.id},dedupeKey:`customer-invoice-${invoice.id}-${eventType}`
    });
  }
  function sweep(){
    const today=nyDate(),due3=addDays(today,3),overdue7=addDays(today,-7);
    for(const row of db.prepare("SELECT id,due_date FROM invoices WHERE deleted_at IS NULL AND direction='receivable' AND status='sent' AND due_date IN (?,?,?)").all(due3,today,overdue7)){
      if(row.due_date===due3)enqueueInvoiceReminder(row.id,"INVOICE_DUE_3_DAYS");
      else if(row.due_date===today)enqueueInvoiceReminder(row.id,"INVOICE_DUE_TODAY");
      else if(row.due_date===overdue7)enqueueInvoiceReminder(row.id,"INVOICE_OVERDUE_7_DAYS");
    }
    const now=Date.now(),from=now+23*60*60*1000,to=now+25*60*60*1000;
    for(const row of db.prepare("SELECT id,scheduled_at FROM jobs WHERE cancelled_at IS NULL AND stage<>'completed' AND scheduled_at IS NOT NULL").all()){
      const at=new Date(row.scheduled_at).getTime();
      if(Number.isFinite(at)&&at>=from&&at<=to)enqueueJobMilestone(row.id,"APPOINTMENT_REMINDER",{dedupeSuffix:String(row.scheduled_at)});
    }
    return {today,due3,overdue7};
  }
  function logForJob(jobId){return db.prepare("SELECT * FROM customer_communication_log WHERE job_id=? ORDER BY created_at DESC,id DESC").all(Number(jobId));}
  function logForInvoice(invoiceId){return db.prepare("SELECT * FROM customer_communication_log WHERE invoice_id=? ORDER BY created_at DESC,id DESC").all(Number(invoiceId));}

  return {enqueueJobMilestone,enqueueInvoiceReminder,sweep,logForJob,logForInvoice,JOB_EVENTS,INVOICE_EVENTS};
}

module.exports={createCustomerAutomation,JOB_EVENTS,INVOICE_EVENTS,nyDate,addDays};

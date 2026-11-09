"use strict";

// Every website lead is visible to the calendar inbox. Only an explicit,
// machine-readable proposed time can be positioned on the calendar grid.
function parseLeadTime(value) {
  const raw=String(value||"").trim();
  if(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)){
    const parsed=new Date(raw.replace(" ","T"));
    return Number.isFinite(parsed.getTime())?parsed.toISOString():null;
  }
  // Admin datetime-local inputs have no timezone. Treat them as New York wall time,
  // never as the Render server's UTC timezone.
  const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/);
  if(!match)return null;
  const parts=match.slice(1).map(Number);
  const [y,m,d,h,minute]=parts;
  if(y<2000||m<1||m>12||d<1||d>31||h>23||minute>59)return null;
  const intended=Date.UTC(y,m-1,d,h,minute);
  if(new Date(intended).getUTCMonth()!==m-1||new Date(intended).getUTCDate()!==d)return null;
  let candidate=intended;
  const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",hourCycle:"h23",
    year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
  for(let i=0;i<4;i++){
    const found=formatter.formatToParts(new Date(candidate)).reduce((out,p)=>(out[p.type]=p.value,out),{});
    const displayed=Date.UTC(Number(found.year),Number(found.month)-1,Number(found.day),Number(found.hour),Number(found.minute));
    candidate+=intended-displayed;
  }
  const found=formatter.formatToParts(new Date(candidate)).reduce((out,p)=>(out[p.type]=p.value,out),{});
  if(Number(found.year)!==y||Number(found.month)!==m||Number(found.day)!==d||Number(found.hour)!==h||Number(found.minute)!==minute)return null;
  return new Date(candidate).toISOString();
}
function calendarLeadRows(db,{from,to,technicianId=""}={}) {
  const lower=Date.parse(from),upper=Date.parse(to),rows=db.prepare(
    "SELECT id,name,email,phone,lead_type,status,service_id,preferred_time,agreed_appointment_at,"+
    "assigned_user_id,message,service_address,created_at,updated_at FROM website_contact_leads "+
    "WHERE status NOT IN ('CLOSED','REJECTED') ORDER BY created_at DESC LIMIT 1000"
  ).all();
  const scheduled=[],inbox=[];
  for(const row of rows) {
    if(technicianId&&String(row.assigned_user_id||"")!==String(technicianId))continue;
    const start=parseLeadTime(row.agreed_appointment_at)||parseLeadTime(row.preferred_time);
    const record={id:row.id,name:row.name,email:row.email,phone:row.phone,lead_type:row.lead_type,status:row.status,
      service_id:row.service_id,preferred_time:row.preferred_time,agreed_appointment_at:row.agreed_appointment_at,
      assigned_user_id:row.assigned_user_id,message:row.message,service_address:row.service_address,created_at:row.created_at};
    if(!start) {
      inbox.push({...record,needs_time:true});
      continue;
    }
    const at=Date.parse(start),duration=60;
    if(at>=lower-60*60000&&at<upper)scheduled.push({...record,website_lead:true,lead_id:row.id,
      scheduled_at:start,scheduled_end:new Date(at+duration*60000).toISOString(),estimated_duration_min:duration,
      title:"Website request · "+(row.lead_type||"Service"),client_name:row.name,
      location_type:"on_site",site_address:row.service_address||"",workflow_status:"tentative",
      assigned_technician_id:row.assigned_user_id||null,assigned_technician_name:"",status:"PENDING_CONFIRMATION"});
  }
  return {scheduled,inbox};
}
module.exports={parseLeadTime,calendarLeadRows};

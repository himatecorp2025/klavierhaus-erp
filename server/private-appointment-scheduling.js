"use strict";

const BUFFER_MIN=15;
const DEFAULT_DURATION_MIN=60;
const HOLD_HOURS=48;
const REQUEST_HOLD_HOURS=48;

const toDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?null:date;};
const addMinutes=(value,minutes)=>new Date(toDate(value).getTime()+minutes*60*1000).toISOString();
const durationMin=value=>{
  const n=Math.round(Number(value||DEFAULT_DURATION_MIN));
  if(!Number.isFinite(n)||n<15||n>480||n%15!==0)throw Object.assign(new Error("INVALID_PRIVATE_APPOINTMENT_DURATION"),{status:400});
  return n;
};
function interval({startsAt,endsAt,duration}){
  const start=toDate(startsAt);if(!start)throw Object.assign(new Error("PRIVATE_APPOINTMENT_TIME_REQUIRED"),{status:400});
  const mins=durationMin(duration||DEFAULT_DURATION_MIN),end=endsAt?toDate(endsAt):new Date(start.getTime()+mins*60*1000);
  if(!end||end<=start)throw Object.assign(new Error("INVALID_PRIVATE_APPOINTMENT_TIME"),{status:400});
  const actual=Math.round((end-start)/60000);
  if(actual<15||actual>480||actual%15!==0)throw Object.assign(new Error("INVALID_PRIVATE_APPOINTMENT_DURATION"),{status:400});
  return {starts_at:start.toISOString(),ends_at:end.toISOString(),duration_min:actual};
}
function overlapsWithBuffer(aStart,aEnd,bStart,bEnd,bufferMin=BUFFER_MIN){
  const buffer=bufferMin*60*1000;
  return aStart.getTime()<bEnd.getTime()+buffer&&aEnd.getTime()+buffer>bStart.getTime();
}
function expireHolds(db){
  try{db.prepare("UPDATE customer_appointment_proposals SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE status='PROPOSED' AND private_appointment_id IS NULL AND expires_at IS NOT NULL AND expires_at<=CURRENT_TIMESTAMP").run();}
  catch(_error){}
}
function availability(db,{startsAt,endsAt,duration,excludeAppointmentId=null,excludeProposalId=null,excludeRequestId=null}={}){
  expireHolds(db);
  const slot=interval({startsAt,endsAt,duration}),start=new Date(slot.starts_at),end=new Date(slot.ends_at);
  const appointmentRows=db.prepare("SELECT id,scheduled_at,scheduled_end_at FROM private_appointments WHERE status='SCHEDULED'").all();
  for(const row of appointmentRows){
    if(excludeAppointmentId&&String(row.id)===String(excludeAppointmentId))continue;
    const otherStart=toDate(row.scheduled_at);if(!otherStart)continue;
    const otherEnd=toDate(row.scheduled_end_at)||new Date(otherStart.getTime()+DEFAULT_DURATION_MIN*60*1000);
    if(overlapsWithBuffer(start,end,otherStart,otherEnd))return {ok:false,code:"PRIVATE_APPOINTMENT_CONFLICT",conflict_type:"APPOINTMENT",conflict_id:row.id,...slot};
  }
  try{
    const requestRows=db.prepare(`SELECT id,requested_at,requested_duration_min FROM private_appointment_requests
      WHERE status='REQUESTED' AND datetime(created_at)>datetime('now','-${REQUEST_HOLD_HOURS} hours')`).all();
    for(const row of requestRows){
      if(excludeRequestId&&String(row.id)===String(excludeRequestId))continue;
      const otherStart=toDate(row.requested_at);if(!otherStart)continue;
      const otherEnd=new Date(otherStart.getTime()+durationMin(row.requested_duration_min||DEFAULT_DURATION_MIN)*60*1000);
      if(overlapsWithBuffer(start,end,otherStart,otherEnd))return {ok:false,code:"PRIVATE_APPOINTMENT_REQUEST_HOLD_CONFLICT",conflict_type:"REQUEST",conflict_id:row.id,...slot};
    }
  }catch(_error){}
  const holds=db.prepare(`SELECT id,starts_at,ends_at FROM customer_appointment_proposals
    WHERE private_appointment_id IS NULL AND status IN ('PROPOSED','ACCEPTED')
      AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`).all();
  for(const row of holds){
    if(excludeProposalId&&String(row.id)===String(excludeProposalId))continue;
    const otherStart=toDate(row.starts_at),otherEnd=toDate(row.ends_at);if(!otherStart||!otherEnd)continue;
    if(overlapsWithBuffer(start,end,otherStart,otherEnd))return {ok:false,code:"PRIVATE_APPOINTMENT_SOFT_HOLD_CONFLICT",conflict_type:"PROPOSAL",conflict_id:row.id,...slot};
  }
  return {ok:true,...slot};
}
function assertAvailable(db,options){
  const result=availability(db,options);if(!result.ok)throw Object.assign(new Error(result.code),{status:409,details:result});return result;
}
function holdExpiry(hours=HOLD_HOURS){return new Date(Date.now()+Number(hours||HOLD_HOURS)*60*60*1000).toISOString();}

module.exports={BUFFER_MIN,DEFAULT_DURATION_MIN,HOLD_HOURS,REQUEST_HOLD_HOURS,durationMin,interval,availability,assertAvailable,holdExpiry,expireHolds,addMinutes};

"use strict";

const SERVICE_KEYS=Object.freeze({
  status:"service_access_status",
  reason:"service_access_reason",
  invoiceReference:"service_access_invoice_reference",
  note:"service_access_note",
  changedAt:"service_access_changed_at",
  changedBy:"service_access_changed_by",
  version:"service_access_version"
});

function createServiceSuspension({db}={}){
  if(!db)throw new Error("SERVICE_SUSPENSION_DB_REQUIRED");
  const keys=Object.values(SERVICE_KEYS);
  const read=db.prepare(`SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN (${keys.map(()=>"?").join(",")})`);
  const write=db.prepare(`INSERT INTO app_settings(setting_key,setting_value,updated_by,updated_at)
    VALUES(?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`);

  function status(){
    const values=Object.fromEntries(read.all(...keys).map(row=>[row.setting_key,row.setting_value]));
    const suspended=String(values[SERVICE_KEYS.status]||"ACTIVE").toUpperCase()==="SUSPENDED";
    return {
      status:suspended?"SUSPENDED":"ACTIVE",
      suspended,
      reason:suspended?(values[SERVICE_KEYS.reason]||"PAYMENT_OVERDUE"):"",
      invoice_reference:values[SERVICE_KEYS.invoiceReference]||"",
      note:values[SERVICE_KEYS.note]||"",
      changed_at:values[SERVICE_KEYS.changedAt]||"",
      changed_by:values[SERVICE_KEYS.changedBy]||"",
      version:values[SERVICE_KEYS.version]||"1"
    };
  }

  function publicStatus(){
    const row=status();
    return {available:!row.suspended,status:row.suspended?"UNAVAILABLE":"AVAILABLE",updated_at:row.changed_at||"",version:row.version||"1"};
  }

  function setState({suspended,actorId="",actorName="",invoiceReference="",note=""}={}){
    const before=status(),nextSuspended=Boolean(suspended);
    if(before.suspended===nextSuspended)return {before,after:before,changed:false};
    const now=new Date().toISOString(),version=String(Date.now()),updatedBy=String(actorName||actorId||"SUPERADMIN").slice(0,200);
    db.transaction(()=>{
      write.run(SERVICE_KEYS.status,nextSuspended?"SUSPENDED":"ACTIVE",updatedBy);
      write.run(SERVICE_KEYS.reason,nextSuspended?"PAYMENT_OVERDUE":"",updatedBy);
      write.run(SERVICE_KEYS.invoiceReference,nextSuspended?String(invoiceReference||"").trim().slice(0,240):"",updatedBy);
      write.run(SERVICE_KEYS.note,nextSuspended?String(note||"").trim().slice(0,2000):"",updatedBy);
      write.run(SERVICE_KEYS.changedAt,now,updatedBy);
      write.run(SERVICE_KEYS.changedBy,String(actorId||"").slice(0,160),updatedBy);
      write.run(SERVICE_KEYS.version,version,updatedBy);
      if(nextSuspended){
        db.prepare(`UPDATE users SET session_version=COALESCE(session_version,0)+1,updated_at=CURRENT_TIMESTAMP
          WHERE status='Active' AND COALESCE(is_superadmin,0)=0`).run();
      }
    })();
    return {before,after:status(),changed:true};
  }

  return Object.freeze({status,publicStatus,isSuspended:()=>status().suspended,setState});
}

module.exports={createServiceSuspension,SERVICE_KEYS};

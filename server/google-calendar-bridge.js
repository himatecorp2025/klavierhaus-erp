"use strict";

const crypto=require("node:crypto");
const {parseLeadTime}=require("./calendar-leads");
const CALENDAR_ID="KH-GOOGLE-WRITER";
const TYPES=new Set(["JOB","PRIVATE_APPOINTMENT","PRIVATE_REQUEST","WEBSITE_LEAD"]);
const parseDate=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null;};
const fp=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function createGoogleCalendarBridge({db,env,config,fetchImpl,encrypt,decrypt,exchangeToken,logger=console}) {
  function writer(){return db.prepare("SELECT * FROM google_calendar_write_connections WHERE id=?").get(CALENDAR_ID);}
  function status(){
    const row=writer();
    return {configured:Boolean(config.clientId&&config.clientSecret),connected:Boolean(row?.refresh_token_encrypted&&row?.status==="CONNECTED"),
      enabled:Boolean(row?.enabled),calendar_id:row?.calendar_id||"",last_error:row?.last_error||null,
      last_success_at:row?.last_success_at||null,direction:"ERP_GOOGLE_BIDIRECTIONAL"};
  }
  function configure({calendar_id,enabled}={}){
    const previous=writer();
    const target=String(calendar_id===undefined?(previous?.calendar_id||""):calendar_id||"").trim();
    if(target&&(target.length>320||!target.includes("@")||target.toLowerCase()==="primary"))
      throw Object.assign(new Error("INVALID_GOOGLE_MASTER_CALENDAR"),{status:400});
    const wanted=enabled===true||enabled===1;
    if(wanted&&(!target||!previous?.refresh_token_encrypted))
      throw Object.assign(new Error("GOOGLE_WRITE_AUTH_AND_CALENDAR_REQUIRED"),{status:409});
    db.prepare("UPDATE google_calendar_write_connections SET calendar_id=?,enabled=?,sync_token=CASE WHEN calendar_id<>? THEN NULL ELSE sync_token END,last_sync_at=CASE WHEN calendar_id<>? THEN NULL ELSE last_sync_at END,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(target,wanted?1:0,target,target,CALENDAR_ID);
    return status();
  }
  function createAuthUrl(userId){
    if(!config.clientId||!config.clientSecret||!config.redirectUri)throw new Error("GOOGLE_WRITE_OAUTH_NOT_CONFIGURED");
    db.prepare("DELETE FROM google_calendar_write_oauth_states WHERE expires_at<?").run(new Date().toISOString());
    const state=crypto.randomBytes(30).toString("base64url");
    db.prepare("INSERT INTO google_calendar_write_oauth_states(state,user_id,expires_at) VALUES(?,?,?)")
      .run(state,userId,new Date(Date.now()+600000).toISOString());
    const params=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,
      response_type:"code",access_type:"offline",prompt:"consent",state,
      scope:"https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendars.readonly"});
    return config.authUrl+"?"+params;
  }
  function isState(state){
    return Boolean(db.prepare("SELECT 1 FROM google_calendar_write_oauth_states WHERE state=?").get(String(state||"")));
  }
  async function handleCallback(code,state){
    const entry=db.prepare("SELECT * FROM google_calendar_write_oauth_states WHERE state=?").get(String(state||""));
    db.prepare("DELETE FROM google_calendar_write_oauth_states WHERE state=?").run(String(state||""));
    if(!entry||Date.parse(entry.expires_at)<=Date.now()||!code)throw new Error("GOOGLE_WRITE_OAUTH_INVALID_STATE");
    const token=await exchangeToken({code,client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirectUri,grant_type:"authorization_code"});
    if(!token.access_token||!token.refresh_token)throw new Error("GOOGLE_WRITE_REFRESH_TOKEN_MISSING");
    // Do not allow an administrator to grant an unrelated personal account's token.
    const who=await requestWithToken("/calendars/primary",token.access_token);
    if(String(who.id||"").toLowerCase()!==config.centralEmail.toLowerCase())
      throw new Error("GOOGLE_WRITE_WRONG_ACCOUNT_USE_KLAVIERHAUS_WORK");
    db.prepare("UPDATE google_calendar_write_connections SET access_token_encrypted=?,refresh_token_encrypted=?,token_expiry=?,status='CONNECTED',enabled=0,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(encrypt(token.access_token),encrypt(token.refresh_token),new Date(Date.now()+Number(token.expires_in||3600)*1000).toISOString(),CALENDAR_ID);
    return status();
  }
  async function requestWithToken(path,token,init={}){
    const response=await fetchImpl(config.apiBase+path,{...init,headers:{...(init.headers||{}),Authorization:"Bearer "+token}});
    const raw=await response.text();
    let body={};try{body=raw?JSON.parse(raw):{}}catch(_error){body={};}
    if(!response.ok){
      const error=new Error(body.error?.message||body.error||"GOOGLE_HTTP_"+response.status);
      error.status=response.status;throw error;
    }
    return body;
  }
  async function accessToken(refresh=false){
    const row=writer();
    if(!row?.refresh_token_encrypted||row.status!=="CONNECTED")throw new Error("GOOGLE_WRITE_NOT_CONNECTED");
    if(!refresh&&row.access_token_encrypted&&Date.parse(row.token_expiry||"")>Date.now()+60000)return decrypt(row.access_token_encrypted);
    const token=await exchangeToken({client_id:config.clientId,client_secret:config.clientSecret,
      refresh_token:decrypt(row.refresh_token_encrypted),grant_type:"refresh_token"});
    db.prepare("UPDATE google_calendar_write_connections SET access_token_encrypted=?,token_expiry=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(encrypt(token.access_token),new Date(Date.now()+Number(token.expires_in||3600)*1000).toISOString(),CALENDAR_ID);
    return token.access_token;
  }
  async function request(path,init={},retry=true){
    const token=await accessToken();
    try{return await requestWithToken(path,token,init);}
    catch(error){
      if(error.status===401&&retry){const replacement=await accessToken(true);return requestWithToken(path,replacement,init);}
      throw error;
    }
  }
  async function verifyTarget(calendarId){
    const id=String(calendarId||writer()?.calendar_id||"").trim();
    if(!id)throw new Error("GOOGLE_MASTER_CALENDAR_REQUIRED");
    const metadata=await request("/calendars/"+encodeURIComponent(id));
    return {calendar_id:id,summary:metadata.summary||id};
  }
  async function pullIncoming() {
    const state=status();
    if(!state.enabled||!state.connected||!state.calendar_id)return {disabled:true,events:[]};
    const calendarId=state.calendar_id,events=[];
    let token=writer()?.sync_token||"",page=null,nextToken=null,reset=false;
    try{
      do{
        const q=new URLSearchParams({showDeleted:"true",singleEvents:"true",maxResults:"2500"});
        if(token)q.set("syncToken",token);
        else q.set("timeMin",new Date(Date.now()-30*86400000).toISOString());
        if(page)q.set("pageToken",page);
        let payload;
        try{payload=await request("/calendars/"+encodeURIComponent(calendarId)+"/events?"+q);}
        catch(error){
          if(error.status===410&&token&&!reset){
            reset=true;token="";page=null;
            db.prepare("UPDATE google_calendar_write_connections SET sync_token=NULL WHERE id=?").run(CALENDAR_ID);
            continue;
          }
          throw error;
        }
        events.push(...(payload.items||[]));
        page=payload.nextPageToken||null;nextToken=payload.nextSyncToken||nextToken;
      }while(page);
      db.prepare("UPDATE google_calendar_write_connections SET sync_token=COALESCE(?,sync_token),last_sync_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(nextToken,CALENDAR_ID);
      return {calendar_id:calendarId,events};
    }catch(error){
      const message=String(error.message||error).slice(0,200);
      db.prepare("UPDATE google_calendar_write_connections SET last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run("GOOGLE_MASTER_READ_FAILED: "+message,CALENDAR_ID);
      logger.warn?.("Google master calendar incoming sync failed: "+message);
      return {calendar_id:calendarId,events:[],error:message};
    }
  }

  function makeRecord(type,id,title,start,duration,details,confirmed=false,assigned=null,location=""){
    const startsAt=parseDate(start);if(!startsAt)return null;
    const minutes=Math.max(15,Math.min(Number(duration||60),480));
    const end=new Date(Date.parse(startsAt)+minutes*60000).toISOString();
    const item={type,id:String(id),title:String(title||"Klavierhaus appointment").slice(0,220),start:startsAt,end,
      description:String(details||"").slice(0,500),location:String(location||"").slice(0,1200),confirmed:Boolean(confirmed),assigned_user_id:assigned||null};
    item.fingerprint=fp([item.title,item.start,item.end,item.description,item.location,item.confirmed]);
    return item;
  }
  function sources(){
    const items=[];
    for(const row of db.prepare("SELECT id,title,description,scheduled_at,estimated_duration_min,site_address,stage,cancelled_at,assigned_technician_id FROM jobs WHERE scheduled_at IS NOT NULL AND stage<>'planned'").all()){
      const cancelled=Boolean(row.cancelled_at);
      const item=makeRecord("JOB",row.id,(cancelled?"Cancelled · ":"")+"Klavierhaus work · "+row.title,row.scheduled_at,row.estimated_duration_min,
        row.description||"","received"===row.stage||row.stage==="in_progress"||row.stage==="completed",row.assigned_technician_id,row.site_address||"");
      if(item)items.push(item);
    }
    for(const row of db.prepare("SELECT id,name,appointment_type,scheduled_at,duration_min,status,assigned_user_id FROM private_appointments WHERE status='SCHEDULED'").all()){
      const item=makeRecord("PRIVATE_APPOINTMENT",row.id,"Confirmed · "+row.appointment_type+" · "+row.name,row.scheduled_at,row.duration_min,
        "Confirmed private appointment in Klavierhaus ERP",true,row.assigned_user_id);
      if(item)items.push(item);
    }
    for(const row of db.prepare("SELECT id,name,appointment_type,requested_at,requested_duration_min,status,assigned_user_id FROM private_appointment_requests WHERE status IN ('REQUESTED','PROPOSED')").all()){
      const item=makeRecord("PRIVATE_REQUEST",row.id,"Request (call required) · "+row.appointment_type+" · "+row.name,
        row.requested_at,row.requested_duration_min,"Tentative time. Contact the customer before confirmation.",false,row.assigned_user_id);
      if(item)items.push(item);
    }
    for(const row of db.prepare("SELECT id,name,lead_type,preferred_time,agreed_appointment_at,assigned_user_id,status FROM website_contact_leads WHERE status NOT IN ('CLOSED','REJECTED')").all()){
      const start=parseLeadTime(row.agreed_appointment_at)||parseLeadTime(row.preferred_time);
      if(!start)continue; // No fabricated Google time: these remain in the ERP's unscheduled inbox.
      const item=makeRecord("WEBSITE_LEAD",row.id,"Web enquiry · "+row.lead_type+" · "+row.name,start,60,
        "Customer requested contact. Time is not confirmed until staff contacts customer.",false,row.assigned_user_id);
      if(item)items.push(item);
    }
    return items;
  }
  function storedLink(type,id,calendarId){
    return db.prepare("SELECT * FROM calendar_outbound_links WHERE source_type=? AND source_id=? AND calendar_id=?")
      .get(type,String(id),calendarId);
  }
  function saveLink(item,calendarId,event,exported=true){
    db.prepare("INSERT INTO calendar_outbound_links(source_type,source_id,calendar_id,google_event_id,google_etag,fingerprint,state,last_error,last_success_at,updated_at) VALUES(?,?,?,?,?,?,'SYNCED',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(source_type,source_id,calendar_id) DO UPDATE SET google_event_id=excluded.google_event_id,google_etag=excluded.google_etag,fingerprint=excluded.fingerprint,state='SYNCED',last_error=NULL,last_success_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP")
      .run(item.type,item.id,calendarId,event.id,event.etag||null,item.fingerprint);
    if(exported&&item.type==="JOB")
      db.prepare("UPDATE external_calendar_events SET event_etag=?,raw_json=?,review_status='REVIEWED',updated_at=CURRENT_TIMESTAMP WHERE provider='GOOGLE' AND job_id=? AND calendar_id=? AND external_event_id=?")
        .run(event.etag||null,JSON.stringify(event),Number(item.id),calendarId,event.id);
  }
  function reportError(item,calendarId,message,googleEventId=null,etag=null){
    const state=message==="GOOGLE_VERSION_CONFLICT"||message==="BOTH_SIDES_CHANGED"?"CONFLICT":"ERROR";
    db.prepare("INSERT INTO calendar_outbound_links(source_type,source_id,calendar_id,google_event_id,google_etag,fingerprint,state,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(source_type,source_id,calendar_id) DO UPDATE SET state=excluded.state,last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP")
      .run(item.type,item.id,calendarId,googleEventId,etag,item.fingerprint,state,String(message).slice(0,250));
  }
  function eventBody(item){
    return {summary:item.title,description:item.description,location:item.location||"",start:{dateTime:item.start},end:{dateTime:item.end},
      transparency:item.confirmed?"opaque":"transparent",
      extendedProperties:{private:{kh_origin:"ERP",kh_type:item.type,kh_id:item.id}}};
  }
  function googleId(item,calendarId){
    return "kh"+fp([item.type,item.id,calendarId]).slice(0,30);
  }
  async function exportOne(item,calendarId,original=null){
    let link=storedLink(item.type,item.id,calendarId);
    if(!link&&original){
      // Adopt an imported Google job without rewriting it on the first pass.
      saveLink(item,calendarId,{id:original.external_event_id,etag:original.event_etag},false);
      return {adopted:1};
    }
    if(link&&link.fingerprint===item.fingerprint&&link.state==="SYNCED")return {skipped:1};
    if(link&&link.google_event_id){
      const endpoint="/calendars/"+encodeURIComponent(calendarId)+"/events/"+encodeURIComponent(link.google_event_id);
      const headers={"Content-Type":"application/json"};
      if(!link.google_etag)throw Object.assign(new Error("GOOGLE_ETAG_REQUIRED"),{status:409});
      headers["If-Match"]=link.google_etag;
      const remote=await request(endpoint+"?sendUpdates=none",{method:"PATCH",headers,body:JSON.stringify(eventBody(item))});
      saveLink(item,calendarId,remote);return {updated:1};
    }
    const event={...eventBody(item),id:googleId(item,calendarId)};
    const endpoint="/calendars/"+encodeURIComponent(calendarId)+"/events";
    try{
      const created=await request(endpoint+"?sendUpdates=none",{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(event)});
      saveLink(item,calendarId,created);return {created:1};
    }catch(error){
      if(error.status===409){
        const existing=await request(endpoint+"/"+encodeURIComponent(event.id));
        if(existing.extendedProperties?.private?.kh_id===item.id&&existing.extendedProperties?.private?.kh_type===item.type){
          saveLink(item,calendarId,existing);return {adopted:1};
        }
      }
      throw error;
    }
  }
  async function reconcile({limit=40}={}){
    const state=status();
    if(!state.enabled||!state.connected||!state.calendar_id)return {disabled:true};
    const master=state.calendar_id,items=sources(),max=Math.min(100,Math.max(1,Number(limit)||40));
    let changed=0,skipped=0,failed=0;
    for(const item of items){
      // Do not backfill years of stale history into newly connected Google calendars.
      if(Date.parse(item.start)<Date.now()-30*86400000)continue;
      const linked=item.type==="JOB"?db.prepare(
        "SELECT * FROM external_calendar_events WHERE provider='GOOGLE' AND job_id=? AND review_status='REVIEWED' ORDER BY imported_at DESC LIMIT 1"
      ).get(Number(item.id)):null;
      const targets=[master];
      if(item.assigned_user_id) {
        const assigned=db.prepare("SELECT calendar_id FROM staff_calendar_sync WHERE user_id=? AND enabled=1 AND write_enabled=1").get(item.assigned_user_id);
        if(assigned?.calendar_id&&!targets.includes(assigned.calendar_id))targets.push(assigned.calendar_id);
      }
      if(linked&&linked.calendar_id!==master) {
        // Write only to staff calendars explicitly enabled by an administrator.
        const allowed=db.prepare("SELECT 1 FROM staff_calendar_sync WHERE enabled=1 AND write_enabled=1 AND calendar_id=?").get(linked.calendar_id);
        if(allowed&&!targets.includes(linked.calendar_id))targets.push(linked.calendar_id);
      }
      for(const target of targets){
        const current=storedLink(item.type,item.id,target);
        if(current?.state==="CONFLICT"||(current?.state==="SYNCED"&&current.fingerprint===item.fingerprint)){skipped++;continue;}
        if(changed>=max)break;
        try{
          const source=linked&&linked.calendar_id===target?linked:null;
          const outcome=await exportOne(item,target,source);
          changed+=Number(outcome.created||0)+Number(outcome.updated||0)+Number(outcome.adopted||0);
          skipped+=Number(outcome.skipped||0);
        }catch(error){
          failed++;
          reportError(item,target,error.status===412?"GOOGLE_VERSION_CONFLICT":String(error.message||error),
            current?.google_event_id||null,current?.google_etag||null);
        }
      }
      if(changed>=max)break;
    }
    // A tentative request must disappear from Google once confirmed, declined or
    // closed. Delete only deterministic ERP-created events, never adopted Google events.
    const liveSources=new Set(items.map(item=>item.type+":"+item.id));
    const obsolete=db.prepare("SELECT * FROM calendar_outbound_links WHERE state='SYNCED'").all();
    let deleted=0;
    for(const link of obsolete){
      if(changed+deleted>=max)break;
      if(liveSources.has(link.source_type+":"+link.source_id))continue;
      if(link.google_event_id!==googleId({type:link.source_type,id:link.source_id},link.calendar_id))continue;
      if(!link.google_etag)continue;
      const endpoint="/calendars/"+encodeURIComponent(link.calendar_id)+"/events/"+encodeURIComponent(link.google_event_id);
      try{
        await request(endpoint+"?sendUpdates=none",{method:"DELETE",headers:{"If-Match":link.google_etag}});
        db.prepare("DELETE FROM calendar_outbound_links WHERE source_type=? AND source_id=? AND calendar_id=?")
          .run(link.source_type,link.source_id,link.calendar_id);
        deleted++;
      }catch(error){
        if(error.status===404||error.status===410){
          db.prepare("DELETE FROM calendar_outbound_links WHERE source_type=? AND source_id=? AND calendar_id=?")
            .run(link.source_type,link.source_id,link.calendar_id);
          deleted++;
          continue;
        }
        failed++;
        reportError({type:link.source_type,id:link.source_id,fingerprint:link.fingerprint},link.calendar_id,
          error.status===412?"GOOGLE_VERSION_CONFLICT":String(error.message||error),link.google_event_id,link.google_etag);
      }
    }
    db.prepare("UPDATE google_calendar_write_connections SET last_success_at=CURRENT_TIMESTAMP,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(failed?failed+" Google calendar export error(s)":null,CALENDAR_ID);
    return {created_or_updated:changed,deleted,skipped,failed};
  }
  function outboundErrors(limit=30){
    return db.prepare("SELECT source_type,source_id,calendar_id,state,last_error,last_success_at FROM calendar_outbound_links WHERE state IN ('ERROR','CONFLICT') ORDER BY updated_at DESC LIMIT ?").all(Math.min(100,Math.max(1,Number(limit)||30)));
  }
  function applyIncoming(event,calendarId,{overrideLocal=false}={}){
    if(!status().enabled||!event?.id)return false;
    const link=db.prepare("SELECT * FROM calendar_outbound_links WHERE calendar_id=? AND google_event_id=?").get(calendarId,event.id);
    if(!link)return event.extendedProperties?.private?.kh_origin==="ERP"; // never duplicate our own calendar events
    if(!overrideLocal&&link.state==='SYNCED'&&link.google_etag===event.etag)return true;
    if(event.status==="cancelled"){db.prepare("UPDATE calendar_outbound_links SET state='CONFLICT',last_error='GOOGLE_EVENT_CANCELLED' WHERE source_type=? AND source_id=? AND calendar_id=?").run(link.source_type,link.source_id,calendarId);return true;}
    const item=sources().find(row=>row.type===link.source_type&&row.id===link.source_id);
    if(!item||(!overrideLocal&&item.fingerprint!==link.fingerprint)){
      db.prepare("UPDATE calendar_outbound_links SET state='CONFLICT',last_error='BOTH_SIDES_CHANGED' WHERE source_type=? AND source_id=? AND calendar_id=?")
        .run(link.source_type,link.source_id,calendarId);
      return true;
    }
    const start=parseDate(event.start?.dateTime),end=parseDate(event.end?.dateTime);
    if(!start||!end||Date.parse(end)<=Date.parse(start))return true;
    const duration=Math.round((Date.parse(end)-Date.parse(start))/60000);
    if(duration<15||duration>480)return true;
    if(link.source_type==="JOB"){
      const job=db.prepare("SELECT stage,cancelled_at,assigned_technician_id FROM jobs WHERE id=?").get(Number(link.source_id));
      if(!job||job.cancelled_at||job.stage==="completed")return true;
      // Keep Google-initiated changes within the exact ERP job schedule rules:
      // 30-minute boundaries, no sub-minute values, 07:00-20:00 America/New_York.
      const nyParts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{
        timeZone:"America/New_York",hourCycle:"h23",hour:"2-digit",minute:"2-digit",second:"2-digit"
      }).formatToParts(new Date(start)).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
      const minute=Number(nyParts.minute),clock=Number(nyParts.hour)*60+minute;
      let block=minute%30!==0||Number(nyParts.second)!==0||new Date(start).getUTCMilliseconds()!==0?
        "WORK_TIME_HALF_HOUR_REQUIRED":clock<7*60||clock>20*60?
        "WORK_TIME_OUTSIDE_BUSINESS_HOURS":null;
      if(!block&&job.assigned_technician_id){
        const others=db.prepare("SELECT id,scheduled_at,estimated_duration_min FROM jobs WHERE assigned_technician_id=? AND id<>? AND cancelled_at IS NULL AND stage NOT IN ('planned','completed') AND scheduled_at IS NOT NULL")
          .all(job.assigned_technician_id,Number(link.source_id));
        if(others.some(row=>Date.parse(row.scheduled_at)<Date.parse(end)&&Date.parse(row.scheduled_at)+Number(row.estimated_duration_min||120)*60000>Date.parse(start)))
          block="SCHEDULE_CONFLICT";
      }
      if(block){
        db.prepare("UPDATE calendar_outbound_links SET state='CONFLICT',last_error=? WHERE source_type=? AND source_id=? AND calendar_id=?")
          .run(block,link.source_type,link.source_id,calendarId);
        return true;
      }
      db.prepare("UPDATE jobs SET title=?,description=?,scheduled_at=?,estimated_duration_min=?,site_address=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(String(event.summary||item.title).replace(/^Klavierhaus work · /,"").slice(0,240),String(event.description??item.description).slice(0,10000),start,duration,String(event.location??item.location??"").slice(0,1200),Number(link.source_id));
      db.prepare("UPDATE job_workflow_phases SET starts_at=?,updated_at=CURRENT_TIMESTAMP WHERE job_id=? AND stage_key=? AND enabled=1")
        .run(start,Number(link.source_id),job.stage);
    }else if(link.source_type==="PRIVATE_APPOINTMENT"){
      db.prepare("UPDATE private_appointments SET scheduled_at=?,scheduled_end_at=?,duration_min=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(start,end,duration,link.source_id);
    }else if(link.source_type==="PRIVATE_REQUEST"){
      db.prepare("UPDATE private_appointment_requests SET requested_at=?,requested_duration_min=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .run(start,duration,link.source_id);
    }else if(link.source_type==="WEBSITE_LEAD"){
      db.prepare("UPDATE website_contact_leads SET preferred_time=?,agreed_appointment_at=CASE WHEN agreed_appointment_at IS NULL THEN NULL ELSE ? END,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(start,start,link.source_id);
    }
    const updated=sources().find(row=>row.type===link.source_type&&row.id===link.source_id);
    if(updated)saveLink(updated,calendarId,event,false);
    if(link.source_type==="JOB")db.prepare("UPDATE external_calendar_events SET event_etag=?,raw_json=?,updated_at=CURRENT_TIMESTAMP WHERE provider='GOOGLE' AND calendar_id=? AND external_event_id=?")
      .run(event.etag||null,JSON.stringify(event),calendarId,event.id);
    return true;
  }

  async function resolveConflict({source_type,source_id,calendar_id,decision}={}) {
    const type=String(source_type||""),id=String(source_id||""),calendarId=String(calendar_id||"");
    const choice=String(decision||"").toUpperCase();
    if(!TYPES.has(type)||!id||!calendarId||!["ERP","GOOGLE"].includes(choice))
      throw Object.assign(new Error("INVALID_CALENDAR_CONFLICT_RESOLUTION"),{status:400});
    if(!status().enabled||!status().connected)
      throw Object.assign(new Error("GOOGLE_WRITE_INTEGRATION_DISABLED"),{status:409});
    const link=storedLink(type,id,calendarId);
    if(!link||!link.google_event_id)throw Object.assign(new Error("CALENDAR_LINK_NOT_FOUND"),{status:404});
    if(!["CONFLICT","ERROR"].includes(link.state))
      throw Object.assign(new Error("CALENDAR_CONFLICT_NOT_OPEN"),{status:409});
    const endpoint="/calendars/"+encodeURIComponent(calendarId)+"/events/"+encodeURIComponent(link.google_event_id);
    const remote=await request(endpoint);
    if(choice==="GOOGLE"){
      applyIncoming(remote,calendarId,{overrideLocal:true});
      const after=storedLink(type,id,calendarId);
      if(after?.state!=="SYNCED")
        throw Object.assign(new Error(after?.last_error||"CALENDAR_GOOGLE_RESOLUTION_FAILED"),{status:409});
      return {ok:true,decision:choice,state:after.state};
    }
    const item=sources().find(row=>row.type===type&&row.id===id);
    if(!item)throw Object.assign(new Error("CALENDAR_ERP_SOURCE_NOT_FOUND"),{status:404});
    db.prepare("UPDATE calendar_outbound_links SET google_etag=?,state='PENDING',updated_at=CURRENT_TIMESTAMP WHERE source_type=? AND source_id=? AND calendar_id=?")
      .run(remote.etag||null,type,id,calendarId);
    try{
      const outcome=await exportOne(item,calendarId);
      return {ok:true,decision:choice,state:"SYNCED",outcome};
    }catch(error){
      reportError(item,calendarId,error.status===412?"GOOGLE_VERSION_CONFLICT":String(error.message||error),
        link.google_event_id,remote.etag||null);
      throw error;
    }
  }

  db.prepare("INSERT OR IGNORE INTO google_calendar_write_connections(id,calendar_id,central_email) VALUES(?,?,?)")
    .run(CALENDAR_ID,"",config.centralEmail);
  return {status,configure,createAuthUrl,isState,handleCallback,verifyTarget,pullIncoming,reconcile,outboundErrors,applyIncoming,resolveConflict,
    _test:{sources,eventBody,googleId}};
}
module.exports={createGoogleCalendarBridge};
